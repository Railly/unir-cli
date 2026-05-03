// `unir temas extract` — pdf-parse the downloaded PDF into markdown raw.
// Output: derivados/tema-NN-raw.md

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { emit, reportError } from "../../cli/agent/json-mode";
import type { GlobalFlags } from "../../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../../lib/auth/session-store";
import { resolveCourse } from "../../lib/api/course-resolver";
import { unirError } from "../../lib/errors";
import { courseDataPath } from "../../lib/paths";
import { ensureMeta, saveMeta } from "../../lib/store/meta";
import { theme } from "../../lib/theme";

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

export function registerTemasExtract(temas: Command): void {
  temas
    .command("extract <courseIdOrSlug>")
    .description("Extract text from downloaded tema PDF(s) → derivados/tema-NN-raw.md")
    .option("--tema <n>", "single tema number")
    .option("--all", "extract all downloaded temas")
    .action(
      async (input: string, cmdOpts: { tema?: string; all?: boolean }) => {
        const opts = ((temas.parent ?? temas) as Command).opts() as GlobalFlags & {
          profile?: string;
        };
        const profile = opts.profile ?? "default";
        try {
          const session = loadUnirSession(profile);
          if (!session) throw unirError("auth-required");
          if (isUnirSessionExpired(session)) throw unirError("auth-expired");
          const course = await resolveCourse(session, input);

          const temarioDir = join(courseDataPath(profile, course.slug), "temario");
          const derivDir = join(courseDataPath(profile, course.slug), "derivados");
          if (!existsSync(temarioDir))
            throw unirError("tema-not-found", "no PDFs downloaded yet — run temas pull first");
          if (!existsSync(derivDir)) mkdirSync(derivDir, { recursive: true });

          const meta = ensureMeta(profile, course.slug, () => ({
            courseId: course.id,
            slug: course.slug,
            fullname: course.fullname,
          }));
          meta.temas = meta.temas ?? {};

          // Discover PDFs in the temario dir.
          const pdfs = readdirSync(temarioDir)
            .filter((f) => f.endsWith(".pdf"))
            .map((f) => {
              const m = f.match(/^tema-(\d+)-/);
              return { file: f, n: m ? Number.parseInt(m[1] ?? "0", 10) : 0 };
            })
            .filter((x) => x.n > 0);

          const targets = cmdOpts.tema
            ? pdfs.filter((p) => String(p.n) === String(cmdOpts.tema))
            : cmdOpts.all
              ? pdfs
              : [];
          if (targets.length === 0) {
            throw unirError(
              "validation-error",
              `pass --tema <n> or --all (downloaded: ${pdfs.map((p) => p.n).join(", ")})`,
            );
          }

          const results: Array<Record<string, unknown>> = [];
          // Lazy import pdf-parse to avoid pulling its native deps unless needed.
          const pdfParseMod = await import("pdf-parse");
          // pdf-parse default export is a function
          const pdfParse =
            (pdfParseMod as unknown as { default?: (b: Buffer) => Promise<{ text: string; numpages: number }> })
              .default ??
            (pdfParseMod as unknown as (b: Buffer) => Promise<{ text: string; numpages: number }>);

          for (const t of targets) {
            const pdfPath = join(temarioDir, t.file);
            const buf = readFileSync(pdfPath);
            const parsed = await pdfParse(buf);
            const md = `# Tema ${t.n} — raw extract\n\nSource: ${t.file}\nPages: ${parsed.numpages}\n\n---\n\n${parsed.text.trim()}\n`;
            const outPath = join(derivDir, `tema-${pad2(t.n)}-raw.md`);
            writeFileSync(outPath, md);
            results.push({ n: t.n, status: "ok", path: outPath, words: parsed.text.split(/\s+/).length });
            // Update meta
            meta.temas[String(t.n)] = {
              ...meta.temas[String(t.n)],
            };
          }
          saveMeta(profile, course.slug, meta);

          emit({ ok: true, data: { course, results } }, opts, () => {
            for (const r of results) {
              process.stdout.write(
                `  ${theme.ok("✓")} tema ${theme.primary(pad2(Number(r.n)))} ${theme.muted(`(${r.words} words)`)}  ${theme.muted(String(r.path))}\n`,
              );
            }
          });
        } catch (err) {
          reportError(err, opts);
          process.exitCode = 1;
        }
      },
    );
}
