// Resolves a course id/slug input + finds Moodle cmids per LTI app
// (Temario, Recursos audiovisuales, Anuncios forum, etc.)

import type { UnirSession } from "../auth/session-store";
import { unirError } from "../errors";
import { courseSlug } from "../slug";
import { moodleAjax } from "./moodle-ajax";

export type ResolvedCourse = {
  id: number;
  fullname: string;
  slug: string;
  start: string;
  end: string;
};

export type CourseModule = {
  id: string;
  name: string;
  module: string; // 'lti', 'forum', 'quiz', 'assign', 'label', 'resource', ...
  url: string | null;
  sectionTitle: string;
};

type RawCourse = {
  id: number;
  fullname: string;
  shortname: string;
  startdate: number;
  enddate: number;
  viewurl: string;
};

export async function resolveCourse(
  session: UnirSession,
  input: string,
): Promise<ResolvedCourse> {
  const payload = await moodleAjax<{ courses: RawCourse[] }>(session, {
    methodname: "core_course_get_enrolled_courses_by_timeline_classification",
    args: { classification: "all", limit: 0, offset: 0, sort: "fullname" },
  });
  const asNum = Number.parseInt(input, 10);
  let match: RawCourse | undefined;
  if (!Number.isNaN(asNum)) match = payload.courses.find((c) => c.id === asNum);
  if (!match) {
    const slug = input.toLowerCase();
    match =
      payload.courses.find((c) => courseSlug(c.fullname) === slug) ??
      payload.courses.find((c) => courseSlug(c.fullname).includes(slug));
  }
  if (!match) throw unirError("course-not-found");
  return {
    id: match.id,
    fullname: match.fullname.trim(),
    slug: courseSlug(match.fullname),
    start: new Date(match.startdate * 1000).toISOString().slice(0, 10),
    end: new Date(match.enddate * 1000).toISOString().slice(0, 10),
  };
}

export async function getCourseModules(
  session: UnirSession,
  courseId: number,
): Promise<CourseModule[]> {
  const stateRaw = await moodleAjax<string>(session, {
    methodname: "core_courseformat_get_state",
    args: { courseid: courseId },
  });
  const state = JSON.parse(stateRaw) as {
    section: Array<{ id: string; title: string; cmlist: string[] }>;
    cm: Array<{ id: string; name: string; module: string; url: string; sectionid: string }>;
  };
  const sectionTitles = new Map(state.section.map((s) => [s.id, s.title]));
  return state.cm.map((m) => ({
    id: m.id,
    name: m.name,
    module: m.module,
    url: m.url ?? null,
    sectionTitle: sectionTitles.get(m.sectionid) ?? "",
  }));
}

export type LtiSlots = {
  programacionSemanal?: number;
  temario?: number;
  recursosAudiovisuales?: number;
  clases?: number;
  anunciosForum?: number;
};

export function pickLtiSlots(modules: CourseModule[]): LtiSlots {
  const out: LtiSlots = {};
  for (const m of modules) {
    if (m.module === "lti" && /Programaci.n\s+semanal/i.test(m.name))
      out.programacionSemanal = Number.parseInt(m.id, 10);
    else if (m.module === "lti" && /^Temario$/i.test(m.name))
      out.temario = Number.parseInt(m.id, 10);
    else if (m.module === "lti" && /Recursos\s+audiovisuales/i.test(m.name))
      out.recursosAudiovisuales = Number.parseInt(m.id, 10);
    else if (m.module === "lti" && /^Clases$/i.test(m.name))
      out.clases = Number.parseInt(m.id, 10);
    else if (m.module === "forum" && /^Anuncios$/i.test(m.name))
      out.anunciosForum = Number.parseInt(m.id, 10);
  }
  return out;
}
