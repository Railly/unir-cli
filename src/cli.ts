#!/usr/bin/env bun
// unir-cli entrypoint. Minimal commander shell + register* commands.

import { Command } from "commander";
import { registerRoot } from "./commands/_root";
import { registerAuth } from "./commands/auth/index";
import { registerCursos } from "./commands/cursos/index";
import { registerDoctor } from "./commands/doctor";
import { registerSchema } from "./commands/schema";
import { VERSION } from "./lib/version";

const program = new Command();

program
  .name("unir")
  .description("agent-first CLI for UNIR campus online")
  .version(VERSION)
  .option("--json", "emit JSON envelope (no banner, no prompts)")
  .option("--dry-run", "preview side effects, do not write")
  .option("--profile <name>", "profile to use", "default")
  .option("--no-input", "fail instead of prompting interactively")
  .option("--quiet, -q", "suppress non-essential output")
  .option("--verbose, -v", "verbose logs to stderr")
  .option("-y, --yes", "skip confirmations for T2 commands");

registerRoot(program);
registerAuth(program);
registerCursos(program);
registerDoctor(program);
registerSchema(program);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${String(err?.message ?? err)}\n`);
  process.exit(1);
});
