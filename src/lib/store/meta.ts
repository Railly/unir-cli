// Per-course meta.json read/write helpers.
// Stored at ~/.unir/data/<profile>/<courseSlug>/meta.json.

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteJson } from "../../cli/foundation/atomic-write";
import { courseDataPath } from "../paths";

export type CourseMeta = {
  courseId: number;
  slug: string;
  fullname: string;
  lastSyncAt?: string;
  temas?: Record<
    string,
    {
      cmsId?: string;
      title?: string;
      bloque?: string;
      downloadedAt?: string;
      bytes?: number;
      sha256?: string;
      transcriptAt?: string;
      summarizedAt?: string;
      narratedAt?: string;
      publishedAt?: string;
    }
  >;
  clases?: Record<
    string,
    {
      panoptoUuid?: string;
      title?: string;
      durationMin?: number;
      downloadedAt?: string;
      bytes?: number;
      transcriptPath?: string;
    }
  >;
  anuncios?: {
    lastPolledAt?: string;
    knownDiscussionIds?: string[];
  };
};

function metaPath(profile: string, slug: string): string {
  return join(courseDataPath(profile, slug), "meta.json");
}

export function loadMeta(profile: string, slug: string): CourseMeta | null {
  const p = metaPath(profile, slug);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CourseMeta;
  } catch {
    return null;
  }
}

export function saveMeta(profile: string, slug: string, meta: CourseMeta): void {
  const p = metaPath(profile, slug);
  mkdirSync(dirname(p), { recursive: true });
  atomicWriteJson(p, meta as unknown as Record<string, unknown>, { mode: 0o644 });
}

export function ensureMeta(
  profile: string,
  slug: string,
  defaults: () => CourseMeta,
): CourseMeta {
  const existing = loadMeta(profile, slug);
  if (existing) return existing;
  const fresh = defaults();
  saveMeta(profile, slug, fresh);
  return fresh;
}
