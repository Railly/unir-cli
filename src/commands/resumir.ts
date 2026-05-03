// `unir resumir <courseIdOrSlug> --tema N [--with-clase N]`
// Combines tema PDF text + (optional) class transcript and runs
// `codex exec --model gpt-5.5` to produce an MDX-ready summary
// (TL;DR + puntos clave + términos clave + narrativa).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { emit, note, reportError } from "../cli/agent/json-mode";
import type { GlobalFlags } from "../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../lib/auth/session-store";
import { resolveCourse } from "../lib/api/course-resolver";
import { unirError } from "../lib/errors";
import { courseDataPath } from "../lib/paths";
import { runCodex } from "../lib/providers/codex";
import { ensureMeta, saveMeta } from "../lib/store/meta";
import { theme } from "../lib/theme";

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

function buildPrompt(
  course: { fullname: string; slug: string },
  temaN: number,
  pdfText: string,
  transcriptText: string | null,
): string {
  const transcriptBlock = transcriptText
    ? `\n## Transcripción de la clase magistral\n\n${transcriptText.trim()}\n`
    : "";
  return `Eres un editor académico que prepara un resumen ejecutivo en Markdown del Tema ${temaN} del curso "${course.fullname}".

Audiencia: una estudiante de máster que va a leer el resumen en un sitio Astro/Starlight + escuchar la versión narrada en mp3.

Devuelve EXCLUSIVAMENTE el cuerpo Markdown (sin frontmatter, sin H1) con esta estructura ordenada:

**TL;DR:** una sola línea, máximo 30 palabras, que captura el corazón del tema.

**Puntos clave:**
- 5 a 8 viñetas, cada una de 1 a 2 oraciones. Mezcla concepto + ejemplo concreto cuando aporte.

**Términos técnicos clave:** lista separada por coma, en orden de aparición. Mínimo 6, máximo 12.

**Fórmulas, procesos o ejemplos relevantes:**
- Si hay procesos paso a paso o ejemplos numéricos, listarlos. Si no, escribe "N/A — el tema es conceptual".

---

## Resumen narrativo

Redacta 4 a 7 párrafos en español neutro, prosa fluida, sin jerga corporativa innecesaria. Conecta los puntos clave con transiciones naturales. Si la transcripción aporta ejemplos o anécdotas que el PDF no incluye, intégralos. Cita herramientas/marcas mencionadas (DAMA, CMI, SCRUM, etc.) con su nombre completo + sigla.

## Para profundizar

Lista de 3 a 5 lecturas / siguientes pasos, basados estrictamente en lo que aparece en el material. Sin inventar referencias.

---

Material fuente — PDF del tema (extracto):

${pdfText.slice(0, 18000)}
${transcriptBlock}

Recuerda: solo Markdown, sin H1, sin "# Tema N", empieza directamente con la línea **TL;DR:**.
`;
}

export function registerResumir(program: Command): void {
  program
    .command("resumir <courseIdOrSlug>")
    .description("Generate MDX summary of a tema (codex GPT-5.5) using PDF + transcript")
    .option("--tema <n>", "tema number (required)")
    .option("--with-clase <n>", "include transcript of clase N (default: same as --tema)")
    .option("--model <model>", "codex model", "gpt-5.5")
    .action(
      async (
        input: string,
        cmdOpts: { tema?: string; withClase?: string; model?: string },
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
          const rawPath = join(dataDir, "derivados", `tema-${pad2(cmdOpts.tema)}-raw.md`);
          if (!existsSync(rawPath))
            throw unirError("tema-not-found", `run \`unir temas extract --tema ${cmdOpts.tema}\` first`);
          const rawText = readFileSync(rawPath, "utf8");
          // Strip the header we added in extract.
          const pdfText = rawText.replace(/^# Tema [\s\S]+?\n---\n\n/, "");

          let transcript: string | null = null;
          const claseN = cmdOpts.withClase ?? cmdOpts.tema;
          if (claseN) {
            const transDir = join(dataDir, "transcripts");
            const candidates = existsSync(transDir)
              ? require("node:fs")
                  .readdirSync(transDir)
                  .filter((f: string) => f.startsWith(`clase-${pad2(claseN)}-`) && f.endsWith(".txt"))
              : [];
            if (candidates.length > 0) {
              transcript = readFileSync(join(transDir, candidates[0]), "utf8");
            }
          }

          if (!opts.json)
            note(
              `running codex (model=${cmdOpts.model}, tema ${cmdOpts.tema}, transcript=${transcript ? "yes" : "no"})...`,
              opts,
            );
          const body = runCodex(
            buildPrompt(course, Number.parseInt(cmdOpts.tema, 10), pdfText, transcript),
            { model: cmdOpts.model },
          );

          const outPath = join(dataDir, "derivados", `tema-${pad2(cmdOpts.tema)}-resumen.md`);
          writeFileSync(outPath, body);

          const meta = ensureMeta(profile, course.slug, () => ({
            courseId: course.id,
            slug: course.slug,
            fullname: course.fullname,
          }));
          meta.temas = meta.temas ?? {};
          meta.temas[cmdOpts.tema] = {
            ...meta.temas[cmdOpts.tema],
            summarizedAt: new Date().toISOString(),
          };
          saveMeta(profile, course.slug, meta);

          emit(
            {
              ok: true,
              data: { course, tema: Number.parseInt(cmdOpts.tema, 10), path: outPath, words: body.split(/\s+/).length },
            },
            opts,
            (env) => {
              const d = (env as { data: Record<string, unknown> }).data;
              process.stdout.write(
                `  ${theme.ok("✓")} resumen tema ${theme.primary(pad2(Number(d.tema)))} ${theme.muted(`(${d.words} words)`)}\n  ${theme.muted(String(d.path))}\n`,
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
