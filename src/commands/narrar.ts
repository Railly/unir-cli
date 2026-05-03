// `unir narrar <courseIdOrSlug> --tema N` — generates mp3 of the resumen
// using ElevenLabs Matilda (default).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { emit, note, reportError } from "../cli/agent/json-mode";
import type { GlobalFlags } from "../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../lib/auth/session-store";
import { resolveCourse } from "../lib/api/course-resolver";
import { unirError } from "../lib/errors";
import { courseDataPath } from "../lib/paths";
import { narrateToMp3 } from "../lib/providers/elevenlabs";
import { ensureMeta, saveMeta } from "../lib/store/meta";
import { theme } from "../lib/theme";

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

export function registerNarrar(program: Command): void {
  program
    .command("narrar <courseIdOrSlug>")
    .description("Narrate the resumen of a tema with ElevenLabs Matilda → mp3")
    .option("--tema <n>", "tema number (required)")
    .option("--voice <id>", "ElevenLabs voice id (override Matilda default)")
    .option("--model <id>", "ElevenLabs model id", "eleven_multilingual_v2")
    .action(
      async (
        input: string,
        cmdOpts: { tema?: string; voice?: string; model?: string },
      ) => {
        const opts = program.opts() as GlobalFlags & { profile?: string };
        const profile = opts.profile ?? "default";
        try {
          const session = loadUnirSession(profile);
          if (!session) throw unirError("auth-required");
          if (isUnirSessionExpired(session)) throw unirError("auth-expired");
          if (!cmdOpts.tema) throw unirError("validation-error", "--tema <n> is required");

          const course = await resolveCourse(session, input);
          const dataDir = courseDataPath(profile, course.slug);
          const resumenPath = join(dataDir, "derivados", `tema-${pad2(cmdOpts.tema)}-resumen.md`);
          if (!existsSync(resumenPath))
            throw unirError("tema-not-found", `run \`unir resumir --tema ${cmdOpts.tema}\` first`);
          const text = readFileSync(resumenPath, "utf8");

          const outPath = join(dataDir, "derivados", `tema-${pad2(cmdOpts.tema)}.mp3`);
          if (!opts.json)
            note(`narrating tema ${cmdOpts.tema} via ElevenLabs (model=${cmdOpts.model})...`, opts);
          const r = await narrateToMp3({
            text,
            voiceId: cmdOpts.voice,
            modelId: cmdOpts.model,
            outPath,
          });

          const meta = ensureMeta(profile, course.slug, () => ({
            courseId: course.id,
            slug: course.slug,
            fullname: course.fullname,
          }));
          meta.temas = meta.temas ?? {};
          meta.temas[cmdOpts.tema] = {
            ...meta.temas[cmdOpts.tema],
            narratedAt: new Date().toISOString(),
          };
          saveMeta(profile, course.slug, meta);

          emit(
            { ok: true, data: { course, tema: Number.parseInt(cmdOpts.tema, 10), path: outPath, bytes: r.bytes } },
            opts,
            (env) => {
              const d = (env as { data: Record<string, unknown> }).data;
              process.stdout.write(
                `  ${theme.ok("✓")} narración tema ${theme.primary(pad2(Number(d.tema)))} ${theme.muted(`(${Math.round(Number(d.bytes) / 1024)} KB)`)}\n  ${theme.muted(String(d.path))}\n`,
              );
            },
          );
        } catch (err) {
          reportError(err, opts);
          process.exitCode = 1;
        }
      },
    );
}
