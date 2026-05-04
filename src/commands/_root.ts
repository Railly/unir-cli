// `unir` (no args) — banner + panorama stub.
// Full panorama (cursos en curso, deadlines, último anuncio) lands when
// auth + cursos commands exist; this is the placeholder for now.

import type { Command } from "commander";
import { emit } from "../cli/agent/json-mode";
import { printBanner } from "../cli/foundation/banner";
import type { GlobalFlags } from "../cli/foundation/global-flags";
import { BANNER_GRADIENT, theme } from "../lib/theme";
import { APP_NAME, VERSION } from "../lib/version";

export function registerRoot(program: Command): void {
  program.action((opts: GlobalFlags & { json?: boolean }) => {
    if (opts.json) {
      emit(
        {
          ok: true,
          data: {
            app: APP_NAME,
            version: VERSION,
            authed: false,
            note: "Panorama not implemented yet — run `unir doctor` for health.",
          },
        },
        opts,
      );
      return;
    }

    printBanner({
      name: "unir",
      tagline: "agent-first CLI for UNIR campus online",
      version: VERSION,
      gradient: BANNER_GRADIENT,
    });

    process.stdout.write(
      `\n  ${theme.emoji.bullet} ${theme.soft("Run")} ${theme.primary("unir doctor")} ${theme.soft("to verify your setup.")}\n`,
    );
    process.stdout.write(
      `  ${theme.emoji.spark} ${theme.soft("Run")} ${theme.primary("unir auth login --profile <name>")} ${theme.soft("to start.")}\n\n`,
    );
  });
}
