// `unir clases transcribe` — wraps `trx transcribe` to produce
// transcripts/N-slug.txt for a downloaded mp4.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Command } from "commander";
import { emit, note, reportError } from "../../cli/agent/json-mode";
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

export function registerClasesTranscribe(clases: Command): void {
  clases
    .command("transcribe <courseIdOrSlug>")
    .description("Transcribe downloaded clase mp4(s) via `trx transcribe` → transcripts/")
    .option("--n <n>", "single clase index")
    .option("--all", "transcribe all downloaded mp4s")
    .option("--backend <backend>", "trx backend (local|openai)", "openai")
    .option("--language <lang>", "force language", "es")
    .action(
      async (
        input: string,
        cmdOpts: { n?: string; all?: boolean; backend?: string; language?: string },
      ) => {
        const opts = ((clases.parent ?? clases) as Command).opts() as GlobalFlags & {
          profile?: string;
        };
        const profile = opts.profile ?? "default";
        try {
          const session = loadUnirSession(profile);
          if (!session) throw unirError("auth-required");
          if (isUnirSessionExpired(session)) throw unirError("auth-expired");
          const course = await resolveCourse(session, input);

          const clasesDir = join(courseDataPath(profile, course.slug), "clases");
          const transDir = join(courseDataPath(profile, course.slug), "transcripts");
          if (!existsSync(clasesDir))
            throw unirError("clase-not-found", "no mp4s downloaded — run clases pull first");
          if (!existsSync(transDir)) mkdirSync(transDir, { recursive: true });

          const mp4s = readdirSync(clasesDir)
            .filter((f) => f.endsWith(".mp4"))
            .map((f) => {
              const m = f.match(/^clase-(\d+)-(.+)\.mp4$/);
              return {
                file: f,
                n: m ? Number.parseInt(m[1] ?? "0", 10) : 0,
                slug: m?.[2] ?? "clase",
              };
            })
            .filter((x) => x.n > 0);

          const targets = cmdOpts.n
            ? mp4s.filter((m) => String(m.n) === String(cmdOpts.n))
            : cmdOpts.all
              ? mp4s
              : [];
          if (targets.length === 0) {
            throw unirError(
              "validation-error",
              `pass --n or --all (downloaded: ${mp4s.map((m) => m.n).join(", ")})`,
            );
          }

          const meta = ensureMeta(profile, course.slug, () => ({
            courseId: course.id,
            slug: course.slug,
            fullname: course.fullname,
          }));
          meta.clases = meta.clases ?? {};

          const results: Array<Record<string, unknown>> = [];
          for (const t of targets) {
            const mp4Path = join(clasesDir, t.file);
            if (!opts.json) note(`transcribing clase ${pad2(t.n)} via trx (${cmdOpts.backend})...`, opts);
            const r = spawnSync(
              "trx",
              [
                "transcribe",
                mp4Path,
                "--backend",
                cmdOpts.backend ?? "openai",
                "--language",
                cmdOpts.language ?? "es",
                "--no-download",
                "--output-dir",
                transDir,
                "--fields",
                "text,files",
                "-o",
                "json",
              ],
              { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            );
            if (r.status !== 0) {
              results.push({
                n: t.n,
                status: "error",
                error: r.stderr?.slice(0, 500) ?? `trx exited ${r.status}`,
              });
              continue;
            }
            // trx writes "<basename>.txt" into output-dir. Find it + rename.
            const txtName = `${basename(t.file, ".mp4")}.txt`;
            const txtSrc = join(transDir, txtName);
            const txtDst = join(transDir, `clase-${pad2(t.n)}-${t.slug}.txt`);
            if (existsSync(txtSrc) && txtSrc !== txtDst) copyFileSync(txtSrc, txtDst);
            const path = existsSync(txtDst) ? txtDst : txtSrc;
            meta.clases[String(t.n)] = {
              ...meta.clases[String(t.n)],
              transcriptPath: path,
            };
            results.push({ n: t.n, status: "ok", path });
          }
          saveMeta(profile, course.slug, meta);
          emit({ ok: true, data: { course, results } }, opts, () => {
            for (const r of results) {
              const tag = r.status === "ok" ? theme.ok("✓") : theme.err("✗");
              process.stdout.write(
                `  ${tag} clase ${theme.primary(pad2(Number(r.n)))} ${theme.muted(String(r.path ?? r.error ?? ""))}\n`,
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
