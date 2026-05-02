// Resolves where unir-cli stores state. Wraps cligentic xdg-paths with
// unir-specific subdirs for blob storage (data/<profile>/<courseSlug>/...).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { type AppPaths, ensureHome, getAppPaths } from "../cli/foundation/xdg-paths";
import { APP_NAME } from "./version";

export type UnirPaths = AppPaths & {
  /** Per-profile course blobs: PDFs, mp4s, transcripts, derivados. */
  data: string;
  /** Per-profile config JSON files (no secrets). */
  profiles: string;
  /** Per-day rolling logs for long-running ops. */
  logs: string;
};

export function getUnirPaths(): UnirPaths {
  const base = getAppPaths(APP_NAME);
  return {
    ...base,
    data: join(base.home, "data"),
    profiles: join(base.home, "profiles"),
    logs: join(base.home, "logs"),
  };
}

export function ensureUnirHome(paths: UnirPaths = getUnirPaths()): UnirPaths {
  ensureHome(paths);
  // Extra subdirs unir needs:
  for (const dir of [paths.data, paths.profiles, paths.logs]) {
    if (!existsSync(dir)) {
      // mkdir is sync but cligentic ensureHome already handled the parents
      // — we just need the leaf dirs.
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return paths;
}

export function profileConfigPath(profile: string): string {
  return join(getUnirPaths().profiles, `${profile}.json`);
}

export function courseDataPath(profile: string, courseSlug: string): string {
  return join(getUnirPaths().data, profile, courseSlug);
}
