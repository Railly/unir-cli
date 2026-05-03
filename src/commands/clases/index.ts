// `unir clases list/pull` — Panopto recordings (Lecciones magistrales).

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { emit, note, reportError } from "../../cli/agent/json-mode";
import type { GlobalFlags } from "../../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../../lib/auth/session-store";
import { downloadPanoptoMp4, listClases } from "../../lib/api/lm-masterclasses";
import { registerClasesTranscribe } from "./transcribe";
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

export function registerClases(program: Command): void {
  const clases = program
    .command("clases")
    .description("List + download Panopto class recordings + transcribe");

  registerClasesTranscribe(clases);

  clases
    .command("list <courseIdOrSlug>")
    .description("List clases (Lecciones magistrales)")
    .action(async (input: string) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      try {
        const session = ensureSession(profile);
        const course = await resolveCourse(session, input);
        const modules = await getCourseModules(session, course.id);
        const slots = pickLtiSlots(modules);
        const cmid = slots.recursosAudiovisuales ?? slots.clases;
        if (!cmid) throw unirError("clase-not-found", "no LTI slot for clases/recursos audiovisuales");

        if (!opts.json) note(`launching Lecciones magistrales LTI (cmid ${cmid})...`, opts);
        const items = await listClases(profile, cmid);

        const meta = ensureMeta(profile, course.slug, () => ({
          courseId: course.id,
          slug: course.slug,
          fullname: course.fullname,
        }));
        meta.clases = meta.clases ?? {};
        for (const c of items) {
          const key = String(c.n);
          meta.clases[key] = {
            ...meta.clases[key],
            panoptoUuid: c.panoptoUuid ?? meta.clases[key]?.panoptoUuid,
            title: c.title,
          };
        }
        saveMeta(profile, course.slug, meta);

        emit({ ok: true, data: { course, clases: items } }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} ${theme.bold(course.slug)} · ${items.length} clases\n\n`,
          );
          for (const c of items) {
            const tag = c.panoptoUuid ? theme.ok("✓") : theme.warn("○");
            process.stdout.write(
              `  ${tag} ${theme.primary(`clase ${pad2(c.n)}`)} ${theme.muted(c.durationLabel ?? "")}  ${c.title}\n`,
            );
          }
          process.stdout.write("\n");
        });
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });

  clases
    .command("pull <courseIdOrSlug>")
    .description("Download class mp4(s) into ~/.unir/data/<profile>/<slug>/clases/")
    .option("--n <n>", "single clase index (1-based)")
    .option("--all", "download all available")
    .action(async (input: string, cmdOpts: { n?: string; all?: boolean }) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      try {
        const session = ensureSession(profile);
        const course = await resolveCourse(session, input);
        const modules = await getCourseModules(session, course.id);
        const slots = pickLtiSlots(modules);
        const cmid = slots.recursosAudiovisuales ?? slots.clases;
        if (!cmid) throw unirError("clase-not-found", "no LTI slot for clases");

        const items = await listClases(profile, cmid);
        if (items.length === 0) throw unirError("clase-not-found", "playlist returned empty");
        const targets = cmdOpts.n
          ? items.filter((t) => String(t.n) === String(cmdOpts.n))
          : cmdOpts.all
            ? items
            : [];
        if (targets.length === 0) {
          throw unirError(
            "validation-error",
            `--n ${cmdOpts.n} not in available (${items.length} items)`,
          );
        }

        const dir = join(courseDataPath(profile, course.slug), "clases");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const meta = ensureMeta(profile, course.slug, () => ({
          courseId: course.id,
          slug: course.slug,
          fullname: course.fullname,
        }));
        meta.clases = meta.clases ?? {};

        const results: Array<Record<string, unknown>> = [];
        for (const t of targets) {
          if (!t.panoptoUuid) {
            results.push({ n: t.n, status: "skipped", reason: "panopto-uuid-missing" });
            continue;
          }
          if (!opts.json) note(`downloading clase ${pad2(t.n)} — ${t.title}...`, opts);
          const filename = `clase-${pad2(t.n)}-${t.slug}.mp4`;
          const path = join(dir, filename);
          try {
            const dl = await downloadPanoptoMp4(profile, t.panoptoUuid, path);
            meta.clases[String(t.n)] = {
              ...meta.clases[String(t.n)],
              panoptoUuid: t.panoptoUuid,
              title: t.title,
              downloadedAt: new Date().toISOString(),
              bytes: dl.bytes,
            };
            results.push({ n: t.n, status: "ok", path, bytes: dl.bytes });
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
              r.status === "ok" ? theme.ok("✓") : r.status === "skipped" ? theme.warn("○") : theme.err("✗");
            process.stdout.write(
              `  ${tag} clase ${theme.primary(pad2(Number(r.n)))} ${theme.muted(String(r.path ?? r.reason ?? r.error ?? ""))}\n`,
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
