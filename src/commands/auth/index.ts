// `unir auth ...` — composite registrar for the 4 auth subcommands.

import { intro, outro, password as passwordPrompt, text, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { emit, note, reportError } from "../../cli/agent/json-mode";
import type { GlobalFlags } from "../../cli/foundation/global-flags";
import { loginViaBrowser, probeSession } from "../../lib/auth/browser";
import {
  clearUnirSession,
  isUnirSessionExpired,
  loadUnirSession,
  saveUnirSession,
} from "../../lib/auth/session-store";
import { unirError } from "../../lib/errors";
import { theme } from "../../lib/theme";

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Login, status, refresh, logout");

  auth
    .command("login")
    .description("Form-post login on crosscutting.unir.net (browser flow)")
    .option("--username <email>", "username/email (override prompt)")
    .option("--password <pw>", "password (override prompt — env safer)")
    .action(async (cmdOpts: { username?: string; password?: string }) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";

      let username = cmdOpts.username ?? process.env.UNIR_USERNAME;
      let password = cmdOpts.password ?? process.env.UNIR_PASSWORD;

      if (!opts.json && !opts.noInput) {
        intro(theme.primary(`unir auth login · profile: ${profile}`));
        if (!username) {
          const r = await text({
            message: "Email UNIR",
            placeholder: "student@unir.net",
          });
          if (isCancel(r)) {
            outro(theme.warn("aborted"));
            return;
          }
          username = String(r);
        }
        if (!password) {
          const r = await passwordPrompt({ message: "Password" });
          if (isCancel(r)) {
            outro(theme.warn("aborted"));
            return;
          }
          password = String(r);
        }
      }

      if (!username || !password) {
        reportError(unirError("validation-error", "username and password required"), opts);
        process.exitCode = 1;
        return;
      }

      try {
        if (!opts.json) note("opening browser, attempting form-post...", opts);
        const result = await loginViaBrowser(profile, username, password);

        const session = {
          profile,
          username,
          sesskey: result.sesskey,
          cookies: result.cookies,
          userId: result.userId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
        };
        saveUnirSession(session);

        emit(
          {
            ok: true,
            data: {
              profile: session.profile,
              username: session.username,
              userId: session.userId,
              sesskey: session.sesskey,
              cookieCount: Object.keys(session.cookies).length,
              expiresAt: session.expiresAt,
            },
          },
          opts,
          (env) => {
            const d = (env as { data: Record<string, unknown> }).data;
            process.stdout.write(
              `\n  ${theme.emoji.bullet} ${theme.ok("logged in")} as ${theme.bold(String(d.username))}\n`,
            );
            process.stdout.write(
              `  ${theme.emoji.spark} sesskey ${theme.muted(String(d.sesskey))} · ${theme.muted(`${String(d.cookieCount)} cookies`)}\n`,
            );
            process.stdout.write(
              `  ${theme.emoji.flower} expires ${theme.muted(String(d.expiresAt))}\n\n`,
            );
          },
        );
        if (!opts.json) outro(theme.primary("ready · run `unir cursos list` next"));
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });

  auth
    .command("status")
    .description("Show auth status for active profile")
    .action(() => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      const session = loadUnirSession(profile);

      if (!session) {
        emit({ ok: true, data: { profile, authed: false } }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} profile ${theme.bold(profile)} · ${theme.warn("not authed")}\n`,
          );
          process.stdout.write(
            `  ${theme.muted("Run")} ${theme.primary("unir auth login")}\n\n`,
          );
        });
        return;
      }

      const expired = isUnirSessionExpired(session);
      emit(
        {
          ok: true,
          data: {
            profile,
            authed: !expired,
            username: session.username,
            sesskey: session.sesskey,
            cookieCount: Object.keys(session.cookies).length,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            expired,
          },
        },
        opts,
        (env) => {
          const d = (env as { data: Record<string, unknown> }).data;
          const tag = expired ? theme.warn("expired") : theme.ok("active");
          process.stdout.write(
            `\n  ${theme.emoji.bullet} profile ${theme.bold(profile)} · ${tag}\n`,
          );
          process.stdout.write(`  ${theme.muted("user:")}  ${String(d.username)}\n`);
          process.stdout.write(`  ${theme.muted("sesskey:")} ${theme.muted(String(d.sesskey))}\n`);
          process.stdout.write(
            `  ${theme.muted("cookies:")} ${String(d.cookieCount)} · expires ${theme.muted(String(d.expiresAt))}\n\n`,
          );
        },
      );
    });

  auth
    .command("logout")
    .description("Clear stored session for the active profile")
    .action(() => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      clearUnirSession(profile);
      emit({ ok: true, data: { profile, cleared: true } }, opts, () => {
        process.stdout.write(
          `\n  ${theme.emoji.bullet} session cleared for ${theme.bold(profile)}\n\n`,
        );
      });
    });

  auth
    .command("refresh")
    .description("Probe session, re-extract sesskey if alive")
    .action(async () => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";

      const session = loadUnirSession(profile);
      if (!session) {
        reportError(unirError("auth-required"), opts);
        process.exitCode = 1;
        return;
      }
      try {
        if (!opts.json) note("probing browser session...", opts);
        const sesskey = await probeSession(profile);
        if (!sesskey) {
          reportError(unirError("auth-expired"), opts);
          process.exitCode = 1;
          return;
        }
        const next = {
          ...session,
          sesskey,
          expiresAt: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
        };
        saveUnirSession(next);
        emit(
          { ok: true, data: { profile, sesskey, expiresAt: next.expiresAt } },
          opts,
          () => {
            process.stdout.write(
              `\n  ${theme.emoji.bullet} ${theme.ok("session refreshed")} · sesskey ${theme.muted(sesskey)}\n\n`,
            );
          },
        );
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });
}
