// `unir anuncios list/show/watch` — forum scraper for Anuncios.

import type { Command } from "commander";
import { emit, note, reportError } from "../../cli/agent/json-mode";
import type { GlobalFlags } from "../../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../../lib/auth/session-store";
import { getCourseModules, pickLtiSlots, resolveCourse } from "../../lib/api/course-resolver";
import { listDiscussions, showDiscussion } from "../../lib/api/forum";
import { unirError } from "../../lib/errors";
import { sendWhatsApp } from "../../lib/providers/kapso";
import { ensureMeta, saveMeta } from "../../lib/store/meta";
import { theme } from "../../lib/theme";

function ensureSession(profile: string) {
  const s = loadUnirSession(profile);
  if (!s) throw unirError("auth-required");
  if (isUnirSessionExpired(s)) throw unirError("auth-expired");
  return s;
}

const INTERVAL_RE = /^(\d+)([smhd])$/;

function parseInterval(s: string): number {
  const m = s.match(INTERVAL_RE);
  if (!m) throw unirError("validation-error", `bad --interval ${s} (use 30m, 6h, 1d)`);
  const n = Number.parseInt(m[1] ?? "0", 10);
  const unit = m[2] ?? "m";
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (mult[unit] ?? 60) * 1000;
}

export function registerAnuncios(program: Command): void {
  const anuncios = program.command("anuncios").description("List + show + watch the Anuncios forum");

  anuncios
    .command("list <courseIdOrSlug>")
    .description("List discussions in the Anuncios forum of a course")
    .action(async (input: string) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      try {
        const session = ensureSession(profile);
        const course = await resolveCourse(session, input);
        const modules = await getCourseModules(session, course.id);
        const slots = pickLtiSlots(modules);
        if (!slots.anunciosForum) throw unirError("course-not-found", "no Anuncios forum in course");

        const discussions = await listDiscussions(profile, slots.anunciosForum);

        emit({ ok: true, data: { course, forumCmid: slots.anunciosForum, discussions } }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} ${theme.bold(course.slug)} · ${discussions.length} anuncios\n\n`,
          );
          for (const d of discussions) {
            process.stdout.write(
              `  ${theme.primary(`#${d.id}`)} ${theme.muted(d.author ?? "")}  ${d.title}\n`,
            );
          }
          if (discussions.length === 0) {
            process.stdout.write(`  ${theme.muted("(sin anuncios todavía)")}\n`);
          }
          process.stdout.write("\n");
        });
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });

  anuncios
    .command("show <courseIdOrSlug>")
    .description("Show posts of a forum discussion (--d <discussionId>)")
    .option("--d <id>", "discussion id (required)")
    .action(async (input: string, cmdOpts: { d?: string }) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      const profile = opts.profile ?? "default";
      try {
        if (!cmdOpts.d) throw unirError("validation-error", "--d <discussionId> required");
        const session = ensureSession(profile);
        const course = await resolveCourse(session, input);
        const r = await showDiscussion(profile, cmdOpts.d);
        emit(
          {
            ok: true,
            data: {
              course,
              discussionId: cmdOpts.d,
              subject: r.subject,
              posts: r.posts.map((p) => ({
                id: p.id,
                author: p.author,
                subject: p.subject,
                ts: p.ts,
                text: p.text,
              })),
            },
          },
          opts,
          (env) => {
            const d = (env as { data: { posts: Array<{ author: string; subject: string; text: string }> } })
              .data;
            for (const p of d.posts) {
              process.stdout.write(
                `\n  ${theme.emoji.bullet} ${theme.bold(p.subject || "(sin asunto)")}\n  ${theme.muted(p.author)}\n\n${p.text.slice(0, 600)}\n`,
              );
            }
            process.stdout.write("\n");
          },
        );
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });

  anuncios
    .command("watch <courseIdOrSlug>")
    .description("Poll the Anuncios forum and notify on new discussions")
    .option("--interval <n>", "poll interval e.g. 30m, 6h, 1d", "6h")
    .option("--notify <channel>", "notification channel (whatsapp|none)", "whatsapp")
    .option("--once", "single poll then exit (good for cron)")
    .action(
      async (
        input: string,
        cmdOpts: { interval?: string; notify?: string; once?: boolean },
      ) => {
        const opts = program.opts() as GlobalFlags & { profile?: string };
        const profile = opts.profile ?? "default";
        try {
          const session = ensureSession(profile);
          const course = await resolveCourse(session, input);
          const modules = await getCourseModules(session, course.id);
          const slots = pickLtiSlots(modules);
          if (!slots.anunciosForum)
            throw unirError("course-not-found", "no Anuncios forum in course");

          const intervalMs = parseInterval(cmdOpts.interval ?? "6h");
          const meta = ensureMeta(profile, course.slug, () => ({
            courseId: course.id,
            slug: course.slug,
            fullname: course.fullname,
          }));
          meta.anuncios = meta.anuncios ?? {};
          let known = new Set(meta.anuncios.knownDiscussionIds ?? []);

          const tick = async () => {
            const ts = new Date().toISOString();
            try {
              const list = await listDiscussions(profile, slots.anunciosForum!);
              const fresh = list.filter((d) => !known.has(d.id));
              if (fresh.length > 0) {
                if (cmdOpts.notify === "whatsapp") {
                  const msg = `*UNIR · ${course.slug}* — ${fresh.length} anuncio${fresh.length > 1 ? "s" : ""} nuevo${fresh.length > 1 ? "s" : ""}:\n${fresh.map((f) => `- ${f.title}`).join("\n")}`;
                  await sendWhatsApp(msg).catch((e) => {
                    process.stderr.write(`[watch] whatsapp send failed: ${String(e)}\n`);
                  });
                }
              }
              for (const d of list) known.add(d.id);
              meta.anuncios = {
                lastPolledAt: ts,
                knownDiscussionIds: Array.from(known),
              };
              saveMeta(profile, course.slug, meta);
              const event = {
                type: "poll",
                ts,
                course: course.slug,
                total: list.length,
                new: fresh.length,
                items: fresh.map((f) => ({ id: f.id, title: f.title })),
              };
              process.stdout.write(`${JSON.stringify(event)}\n`);
            } catch (err) {
              process.stderr.write(
                `[watch] error: ${err instanceof Error ? err.message : String(err)}\n`,
              );
            }
          };

          await tick();
          if (cmdOpts.once) return;

          if (!opts.json) note(`watching ${course.slug} every ${cmdOpts.interval}...`, opts);
          while (true) {
            await new Promise((res) => setTimeout(res, intervalMs));
            await tick();
          }
        } catch (err) {
          reportError(err, opts);
          process.exitCode = 1;
        }
      },
    );
}
