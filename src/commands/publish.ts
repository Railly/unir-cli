// `unir publish <courseSlug> --tema N` — render MDX from the resumen +
// copy mp3/PDF to the vidama-curso Astro site (or whichever site path
// is configured).
//
// Site path defaults: ~/Programming/railly/vidama-curso (per Hunter).
// Override via env UNIR_SITE_PATH or the profile config (future).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { emit, note, reportError } from "../cli/agent/json-mode";
import type { GlobalFlags } from "../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../lib/auth/session-store";
import { resolveCourse } from "../lib/api/course-resolver";
import { unirError } from "../lib/errors";
import { courseDataPath } from "../lib/paths";
import { ensureMeta, saveMeta } from "../lib/store/meta";
import { theme } from "../lib/theme";

const DEFAULT_SITE = "/Users/raillyhugo/Programming/railly/vidama-curso";

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

function siteRoot(): string {
  return process.env.UNIR_SITE_PATH ?? DEFAULT_SITE;
}

function publishOneTema(opts: {
  profile: string;
  courseSlug: string;
  courseFullname: string;
  temaN: number;
  temaTitle?: string;
  withPdf?: boolean;
}): { mdxPath: string; mp3Path: string | null; pdfPath: string | null } {
  const site = siteRoot();
  if (!existsSync(site)) throw unirError("sitio-not-found", site);

  const dataDir = courseDataPath(opts.profile, opts.courseSlug);
  const resumenPath = join(dataDir, "derivados", `tema-${pad2(opts.temaN)}-resumen.md`);
  if (!existsSync(resumenPath))
    throw unirError("tema-not-found", `run \`unir resumir --tema ${opts.temaN}\` first`);
  const body = readFileSync(resumenPath, "utf8");

  const mp3Src = join(dataDir, "derivados", `tema-${pad2(opts.temaN)}.mp3`);
  const mp3Exists = existsSync(mp3Src);

  // Find a downloaded PDF for this tema (tema-NN-*.pdf)
  let pdfFilename: string | null = null;
  if (opts.withPdf) {
    const fs = require("node:fs") as typeof import("node:fs");
    const temarioDir = join(dataDir, "temario");
    if (existsSync(temarioDir)) {
      const found = fs
        .readdirSync(temarioDir)
        .find((f) => f.startsWith(`tema-${pad2(opts.temaN)}-`) && f.endsWith(".pdf"));
      if (found) pdfFilename = found;
    }
  }

  // Derive a slug for the MDX filename. Use the resumen's first line as
  // hint for the tema title if not provided.
  const titleHint =
    opts.temaTitle ??
    (body.split("\n").find((l) => l.startsWith("**TL;DR")) ?? "")
      .replace(/^\*\*TL;DR:\*\*\s*/, "")
      .slice(0, 80);
  const description = titleHint.replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.,;:'"-]/g, "").slice(0, 220);
  const sidebarLabel = `Tema ${pad2(opts.temaN)}`;

  // Output paths
  const docsDir = join(site, "src", "content", "docs", opts.courseSlug);
  const audioDir = join(site, "public", "audio", opts.courseSlug);
  const pdfDir = join(site, "public", "pdf", opts.courseSlug);
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  if (mp3Exists && !existsSync(audioDir)) mkdirSync(audioDir, { recursive: true });
  if (pdfFilename && !existsSync(pdfDir)) mkdirSync(pdfDir, { recursive: true });

  const mdxName = `tema-${pad2(opts.temaN)}.mdx`;
  const mdxPath = join(docsDir, mdxName);

  const audioRel = mp3Exists ? `/audio/${opts.courseSlug}/tema-${pad2(opts.temaN)}.mp3` : null;
  const pdfRel = pdfFilename ? `/pdf/${opts.courseSlug}/${pdfFilename}` : null;

  const audioBlock = audioRel
    ? `<AudioPlayer src="${audioRel}" title="Narración del Tema ${pad2(opts.temaN)} (ElevenLabs Matilda)" />\n\n`
    : "";
  const pdfBlock = pdfRel
    ? `\n\n[📄 PDF del Tema ${pad2(opts.temaN)}](${pdfRel})\n`
    : "";

  const frontmatter = [
    "---",
    `title: "Tema ${pad2(opts.temaN)} — ${(titleHint || "Resumen").replace(/"/g, "'")}"`,
    `description: "${description.replace(/"/g, "'")}"`,
    `sidebar:`,
    `  order: ${opts.temaN * 10}`,
    `  label: "${sidebarLabel}"`,
    "---",
    "",
    `import AudioPlayer from "../../../components/AudioPlayer.astro";`,
    "",
    audioBlock,
    body.trim(),
    pdfBlock,
    "",
  ].join("\n");

  writeFileSync(mdxPath, frontmatter);
  if (mp3Exists) {
    copyFileSync(mp3Src, join(audioDir, `tema-${pad2(opts.temaN)}.mp3`));
  }
  if (pdfFilename) {
    copyFileSync(join(dataDir, "temario", pdfFilename), join(pdfDir, pdfFilename));
  }

  return {
    mdxPath,
    mp3Path: mp3Exists ? join(audioDir, `tema-${pad2(opts.temaN)}.mp3`) : null,
    pdfPath: pdfFilename ? join(pdfDir, pdfFilename) : null,
  };
}

export function registerPublish(program: Command): void {
  program
    .command("publish <courseIdOrSlug>")
    .description("Render MDX → vidama-curso site (T2 — pass --yes to confirm)")
    .option("--tema <n>", "tema to publish")
    .option("--all", "publish every tema with a resumen")
    .option("--with-pdf", "also copy the PDF into public/pdf/")
    .action(
      async (
        input: string,
        cmdOpts: { tema?: string; all?: boolean; withPdf?: boolean },
      ) => {
        const opts = program.opts() as GlobalFlags & { profile?: string; yes?: boolean };
        const profile = opts.profile ?? "default";
        try {
          const session = loadUnirSession(profile);
          if (!session) throw unirError("auth-required");
          if (isUnirSessionExpired(session)) throw unirError("auth-expired");
          const course = await resolveCourse(session, input);

          if (!opts.yes && opts.json) throw unirError("needs-confirmation");
          if (!opts.yes && !opts.json) {
            // For a non-TTY context this would also fail, but Hunter always
            // runs publish from a TTY. Keep it simple.
            note(
              `dry-run preview only (no --yes). Use --yes to actually write to ${siteRoot()}`,
              opts,
            );
          }

          // Determine which temas to publish.
          const dataDir = courseDataPath(profile, course.slug);
          const fs = require("node:fs") as typeof import("node:fs");
          const derivDir = join(dataDir, "derivados");
          const available = existsSync(derivDir)
            ? fs
                .readdirSync(derivDir)
                .filter((f) => /^tema-(\d+)-resumen\.md$/.test(f))
                .map((f) => Number.parseInt(f.match(/tema-(\d+)/)?.[1] ?? "0", 10))
                .filter((n) => n > 0)
                .sort((a, b) => a - b)
            : [];
          if (available.length === 0)
            throw unirError("tema-not-found", "no resumen MDs found — run resumir first");
          const targetNs = cmdOpts.tema
            ? available.filter((n) => String(n) === String(cmdOpts.tema))
            : cmdOpts.all
              ? available
              : [];
          if (targetNs.length === 0)
            throw unirError(
              "validation-error",
              `pass --tema <n> or --all (available: ${available.join(", ")})`,
            );

          const results: Array<Record<string, unknown>> = [];
          if (!opts.yes) {
            // dry-run preview only
            for (const n of targetNs) {
              results.push({
                n,
                preview: true,
                mdxPath: join(siteRoot(), "src", "content", "docs", course.slug, `tema-${pad2(n)}.mdx`),
              });
            }
          } else {
            const meta = ensureMeta(profile, course.slug, () => ({
              courseId: course.id,
              slug: course.slug,
              fullname: course.fullname,
            }));
            meta.temas = meta.temas ?? {};
            for (const n of targetNs) {
              const r = publishOneTema({
                profile,
                courseSlug: course.slug,
                courseFullname: course.fullname,
                temaN: n,
                temaTitle: meta.temas?.[String(n)]?.title,
                withPdf: cmdOpts.withPdf,
              });
              meta.temas[String(n)] = {
                ...meta.temas[String(n)],
                publishedAt: new Date().toISOString(),
              };
              results.push({ n, status: "published", ...r });
            }
            saveMeta(profile, course.slug, meta);
          }

          emit({ ok: true, data: { course, site: siteRoot(), results } }, opts, () => {
            for (const r of results) {
              const tag = r.preview ? theme.warn("⊘ preview") : theme.ok("✓ published");
              process.stdout.write(
                `  ${tag} tema ${theme.primary(pad2(Number(r.n)))} ${theme.muted(String(r.mdxPath ?? ""))}\n`,
              );
            }
            if (!opts.yes) {
              process.stdout.write(`\n  ${theme.muted("Re-run with --yes to write files.")}\n`);
            }
          });
        } catch (err) {
          reportError(err, opts);
          process.exitCode = 1;
        }
      },
    );
}
