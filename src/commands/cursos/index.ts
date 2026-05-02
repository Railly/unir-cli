// `unir cursos ...` — list/info subcommands.

import type { Command } from "commander";
import { emit, reportError } from "../../cli/agent/json-mode";
import type { GlobalFlags } from "../../cli/foundation/global-flags";
import { isUnirSessionExpired, loadUnirSession } from "../../lib/auth/session-store";
import { unirError } from "../../lib/errors";
import { moodleAjax } from "../../lib/api/moodle-ajax";
import { courseSlug } from "../../lib/slug";
import { theme } from "../../lib/theme";

type RawCourse = {
  id: number;
  fullname: string;
  shortname: string;
  startdate: number;
  enddate: number;
  viewurl: string;
};

type CoursesPayload = { courses: RawCourse[] };

function ensureSession(opts: GlobalFlags & { profile?: string }) {
  const profile = opts.profile ?? "default";
  const session = loadUnirSession(profile);
  if (!session) throw unirError("auth-required");
  if (isUnirSessionExpired(session)) throw unirError("auth-expired");
  return session;
}

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export function registerCursos(program: Command): void {
  const cursos = program.command("cursos").description("List enrolled courses, course info");

  cursos
    .command("list")
    .description("List all enrolled courses")
    .action(async () => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      try {
        const session = ensureSession(opts);
        const payload = await moodleAjax<CoursesPayload>(session, {
          methodname: "core_course_get_enrolled_courses_by_timeline_classification",
          args: { classification: "all", limit: 0, offset: 0, sort: "fullname" },
        });

        const courses = payload.courses.map((c) => ({
          id: c.id,
          fullname: c.fullname.trim(),
          slug: courseSlug(c.fullname),
          shortname: c.shortname,
          start: fmtDate(c.startdate),
          end: fmtDate(c.enddate),
          viewurl: c.viewurl,
        }));

        emit({ ok: true, data: { courses } }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} ${theme.bold(String(courses.length))} ${theme.soft("cursos enrolados")}\n\n`,
          );
          for (const c of courses) {
            process.stdout.write(
              `  ${theme.primary(String(c.id).padStart(5, " "))}  ${theme.bold(c.slug)}  ${theme.muted(`${c.start} → ${c.end}`)}\n`,
            );
            process.stdout.write(`         ${theme.muted(c.fullname)}\n`);
          }
          process.stdout.write("\n");
        });
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });

  cursos
    .command("info <idOrSlug>")
    .description("Show details + sections of a course")
    .action(async (idOrSlug: string) => {
      const opts = program.opts() as GlobalFlags & { profile?: string };
      try {
        const session = ensureSession(opts);
        // Resolve id from slug if needed
        const all = await moodleAjax<CoursesPayload>(session, {
          methodname: "core_course_get_enrolled_courses_by_timeline_classification",
          args: { classification: "all", limit: 0, offset: 0, sort: "fullname" },
        });
        const matched = resolveCourse(idOrSlug, all.courses);
        if (!matched) throw unirError("course-not-found");

        // Pull sections via core_courseformat_get_state (returns JSON-string)
        const stateRaw = await moodleAjax<string>(session, {
          methodname: "core_courseformat_get_state",
          args: { courseid: matched.id },
        });
        const state = JSON.parse(stateRaw) as {
          course: { id: string; numsections: number };
          section: Array<{ id: string; number: number; title: string; cmlist: string[] }>;
          cm: Array<{ id: string; name: string; module: string; url: string; sectionid: string }>;
        };

        const sections = state.section.map((s) => ({
          number: s.number,
          title: s.title,
          modules: s.cmlist
            .map((cmid) => state.cm.find((m) => m.id === cmid))
            .filter(Boolean)
            .map((m) => ({
              id: m?.id,
              name: m?.name,
              module: m?.module,
              url: m?.url,
            })),
        }));

        const data = {
          course: {
            id: matched.id,
            fullname: matched.fullname.trim(),
            slug: courseSlug(matched.fullname),
            start: fmtDate(matched.startdate),
            end: fmtDate(matched.enddate),
            viewurl: matched.viewurl,
          },
          sections,
        };

        emit({ ok: true, data }, opts, () => {
          process.stdout.write(
            `\n  ${theme.emoji.bullet} ${theme.bold(data.course.slug)} ${theme.muted(`(id ${data.course.id})`)}\n`,
          );
          process.stdout.write(
            `  ${theme.muted(`${data.course.start} → ${data.course.end}`)}\n\n`,
          );
          for (const sec of sections) {
            process.stdout.write(
              `  ${theme.emoji.spark} ${theme.primary(`section ${sec.number}`)} ${theme.bold(sec.title)}\n`,
            );
            for (const m of sec.modules) {
              process.stdout.write(
                `       ${theme.muted(m?.module ?? "")}  ${m?.name}\n`,
              );
            }
          }
          process.stdout.write("\n");
        });
      } catch (err) {
        reportError(err, opts);
        process.exitCode = 1;
      }
    });
}

function resolveCourse(input: string, courses: RawCourse[]): RawCourse | null {
  // Numeric id?
  const asNum = Number.parseInt(input, 10);
  if (!Number.isNaN(asNum)) {
    return courses.find((c) => c.id === asNum) ?? null;
  }
  // Exact slug match
  const slug = input.toLowerCase();
  const exact = courses.find((c) => courseSlug(c.fullname) === slug);
  if (exact) return exact;
  // Substring match
  const sub = courses.find((c) => courseSlug(c.fullname).includes(slug));
  if (sub) return sub;
  return null;
}
