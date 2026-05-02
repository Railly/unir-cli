// Per-profile wrapper around cligentic session block.
// Stores under {sessions}/<profile>.json (cligentic default is current.json).

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../../cli/foundation/atomic-write";
import { type SessionBase, isExpired as isExpiredBase } from "../../cli/foundation/session";
import { ensureUnirHome } from "../paths";

export type UnirSession = SessionBase & {
  profile: string;
  username: string;
  cookies: Record<string, string>;
  sesskey: string;
  userId?: number;
};

function sessionPath(profile: string): string {
  const paths = ensureUnirHome();
  return join(paths.sessions, `${profile}.json`);
}

export function loadUnirSession(profile: string): UnirSession | null {
  const filePath = sessionPath(profile);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as UnirSession;
  } catch {
    return null;
  }
}

export function saveUnirSession(session: UnirSession): void {
  atomicWriteJson(sessionPath(session.profile), session, { mode: 0o600 });
}

export function clearUnirSession(profile: string): void {
  const filePath = sessionPath(profile);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function isUnirSessionExpired(session: UnirSession | null): boolean {
  if (!session) return true;
  return isExpiredBase(session.expiresAt);
}
