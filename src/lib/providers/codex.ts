// Codex CLI wrapper. Spawns `codex exec --skip-git-repo-check --sandbox
// read-only --model gpt-5.5 -o <out>` with the prompt on stdin and
// returns the final message text.

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unirError } from "../errors";

export type CodexOptions = {
  model?: string;
  /** Working directory; defaults to system tmp. */
  cwd?: string;
};

export function runCodex(prompt: string, opts: CodexOptions = {}): string {
  const out = join(tmpdir(), `unir-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  const r = spawnSync(
    "codex",
    [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "-m",
      opts.model ?? "gpt-5.5",
      "-o",
      out,
      "-",
    ],
    {
      input: prompt,
      encoding: "utf8",
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (r.status !== 0) {
    let stderr = (r.stderr ?? "").slice(0, 500);
    throw unirError("unknown-error", `codex exec failed (status ${r.status}): ${stderr}`);
  }
  let body = "";
  try {
    body = readFileSync(out, "utf8");
  } catch {
    body = (r.stdout ?? "").trim();
  }
  try {
    unlinkSync(out);
  } catch {
    // ignore
  }
  if (!body.trim()) {
    throw unirError("unknown-error", "codex returned empty output");
  }
  return body;
}
