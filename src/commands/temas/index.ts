// `unir temas list/pull` — Temario CMS PDFs.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { emit, note, reportError } from "../../cli/agent/json-mode";
import type { GlobalFlags } from "../../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../../lib/auth/session-store";
import { downloadTemaPdfTo, listTemas } from "../../lib/api/cms-temario";
import { registerTemasExtract } from "./extract";
import { getCourseModules, pickLtiSlots, resolveCourse } from "../../lib/api/course-resolver";
import { unirError } from "../../lib/errors";
import { courseDataPath } from "../../lib/paths";
import { ensureMeta, saveMeta } from "../../lib/store/meta";
import { theme } from "../../lib/theme";

function ensureSession(profile: string) {
  const s = loadUnirSession(profile);
  if (!s) throw unirError("auth-required");
  if (isUnirSessionExpired(s)) throw unirError("auth-expired");
  return s;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function registerTemas(program: Command): void {
  const temas = program.command("temas").description("List + download Temario PDFs (CMS) + extract text");

  registerTemasExtract(temas);

  temas
    .command("list <courseIdOrSlug>")
    .description("List temas + their CMS file IDs (parses LTI Temario hub)")
    .action(async (input: string) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      try {
        const session = ensureSession(profile);
        const course = await resolveCourse(session, input);
        const modules = await getCourseModules(session, course.id);
        const slots = pickLtiSlots(modules);
        if (!slots.temario) throw unirError("tema-not-found", "no Temario LTI module in course");

        if (!opts.json) note(`launching Temario LTI (cmid ${slots.temario})...`, opts);
        const items = await listTemas(profile, slots.temario);

        // Persist to meta.json
        const meta = ensureMeta(profile, course.slug, () => ({
          courseId: course.id,
          slug: course.slug,
          fullname: course.fullname,
        }));
        meta.temas = meta.temas ?? {};
        for (const t of items) {
          const key = String(t.n);
          meta.temas[key] = {
            ...meta.temas[key],
            cmsId: t.cmsId ?? meta.temas[key]?.cmsId,
            title: t.title,
            bloque: t.bloque,
          };
        }
        saveMeta(profile, course.slug, meta);

        emit({ ok: true, data: { course, temas: items } }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} ${theme.bold(course.slug)} · ${items.length} temas\n\n`,
          );
          for (const t of items) {
            const tag = t.cmsId ? theme.ok("✓") : theme.warn("○");
            process.stdout.write(
              `  ${tag} ${theme.primary(`tema ${pad2(t.n)}`)}  ${theme.muted(t.bloque)}  ${t.title}\n`,
            );
          }
          process.stdout.write("\n");
        });
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });

  temas
    .command("pull <courseIdOrSlug>")
    .description("Download Tema PDF(s) into ~/.unir/data/<profile>/<slug>/temario/")
    .option("--tema <n>", "single tema number")
    .option("--all", "download all available temas")
    .action(async (input: string, cmdOpts: { tema?: string; all?: boolean }) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      try {
        const session = ensureSession(profile);
        const course = await resolveCourse(session, input);
        const modules = await getCourseModules(session, course.id);
        const slots = pickLtiSlots(modules);
        if (!slots.temario) throw unirError("tema-not-found", "no Temario LTI module in course");

        const items = await listTemas(profile, slots.temario);
        if (opts.verbose) {
          process.stderr.write(`[verbose] listTemas returned ${items.length} items\n`);
        }
        const targets = cmdOpts.tema
          ? items.filter((t) => String(t.n) === String(cmdOpts.tema))
          : cmdOpts.all
            ? items
            : [];
        if (items.length === 0) {
          throw unirError("tema-not-found", "Temario LTI did not return any temas");
        }
        if (targets.length === 0) {
          throw unirError(
            "validation-error",
            `--tema ${cmdOpts.tema} not in available list (got ${items.length} temas)`,
          );
        }

        const dir = join(courseDataPath(profile, course.slug), "temario");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const meta = ensureMeta(profile, course.slug, () => ({
          courseId: course.id,
          slug: course.slug,
          fullname: course.fullname,
        }));
        meta.temas = meta.temas ?? {};

        const results: Array<Record<string, unknown>> = [];
        for (const t of targets) {
          if (!t.cmsId) {
            results.push({
              n: t.n,
              status: "skipped",
              reason: "tema-not-yet-published",
            });
            continue;
          }
          if (!opts.json) note(`downloading tema ${pad2(t.n)} — ${t.title}...`, opts);
          const filename = `tema-${pad2(t.n)}-${t.slug}.pdf`;
          const path = join(dir, filename);
          try {
            const pdf = await downloadTemaPdfTo(profile, t.cmsId, path);
            meta.temas[String(t.n)] = {
              ...meta.temas[String(t.n)],
              cmsId: t.cmsId,
              title: t.title,
              bloque: t.bloque,
              downloadedAt: new Date().toISOString(),
              bytes: pdf.bytes,
            };
            results.push({ n: t.n, status: "ok", path, bytes: pdf.bytes });
          } catch (err) {
            results.push({
              n: t.n,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        saveMeta(profile, course.slug, meta);

        emit({ ok: true, data: { course, results } }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} ${theme.bold(course.slug)}\n\n`,
          );
          for (const r of results) {
            const tag =
              r.status === "ok"
                ? theme.ok("✓")
                : r.status === "skipped"
                  ? theme.warn("○")
                  : theme.err("✗");
            process.stdout.write(
              `  ${tag} tema ${theme.primary(pad2(Number(r.n)))} ${theme.muted(String(r.path ?? r.reason ?? ""))}\n`,
            );
          }
          process.stdout.write("\n");
        });
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });
}
