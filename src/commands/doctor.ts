// `unir doctor` — health check. Uses cligentic doctor block.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Command } from "commander";
import { renderDoctor, runDoctor } from "../cli/agent/doctor";
import type { GlobalFlags } from "../cli/foundation/global-flags";
import { ensureUnirHome } from "../lib/paths";

function hasBin(name: string): boolean {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Run health checks (auth, deps, paths)")
    .action(async (opts: GlobalFlags & { json?: boolean }) => {
      const paths = ensureUnirHome();
      const result = await runDoctor([
        async () => {
          const v = Bun.version;
          const major = Number.parseInt(v.split(".")[0] ?? "0", 10);
          return { name: "bun version", ok: major >= 1, detail: `bun ${v}` };
        },
        async () => {
          const ok = hasBin("agent-browser");
          return {
            name: "agent-browser CLI",
            ok,
            detail: ok ? "found on PATH" : "missing — needed for `unir auth login`",
          };
        },
        async () => {
          const ok = hasBin("trx");
          return {
            name: "trx CLI",
            ok,
            detail: ok
              ? "found on PATH"
              : "missing — needed for transcribe. `bun install -g @crafter/trx`",
          };
        },
        async () => {
          const ok = hasBin("codex");
          return {
            name: "codex CLI",
            ok,
            detail: ok
              ? "found on PATH"
              : "missing — needed for resumir/tareas-detect. `npm i -g @openai/codex`",
          };
        },
        async () => {
          const ok = Boolean(process.env.ELEVENLABS_API_KEY);
          return {
            name: "ELEVENLABS_API_KEY",
            ok,
            detail: ok ? "set" : "missing — needed for narrar. Export in shell rc.",
          };
        },
        async () => {
          const ok = existsSync(paths.home);
          return { name: "unir home dir", ok, detail: paths.home };
        },
      ]);

      renderDoctor(result, opts);
      if (!result.ok) process.exitCode = 1;
    });
}
