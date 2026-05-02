// cligentic block: session
//
// Auth token persistence. Load on boot, save after login, clear on logout,
// check expiry. Uses atomic writes and 0o600 permissions.
//
// Usage:
//   import { loadSession, saveSession, clearSession, isExpired } from "./foundation/session";
//
//   const session = loadSession<MySession>(paths.sessions);
//   if (!session || isExpired(session.expiresAt)) {
//     // re-auth
//   }

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write";

export type SessionBase = {
  /** ISO 8601 timestamp when the session was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the session expires. Optional. */
  expiresAt?: string;
};

const SESSION_FILE = "current.json";

/**
 * Loads the current session from {sessionsDir}/current.json.
 * Returns null if no session exists or the file is corrupted.
 */
export function loadSession<T extends SessionBase>(sessionsDir: string): T | null {
  const filePath = join(sessionsDir, SESSION_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Saves a session to {sessionsDir}/current.json with 0o600 permissions.
 * Uses atomic write to prevent corruption.
 */
export function saveSession<T extends SessionBase>(sessionsDir: string, session: T): void {
  atomicWriteJson(join(sessionsDir, SESSION_FILE), session, { mode: 0o600 });
}

/**
 * Deletes the current session file.
 */
export function clearSession(sessionsDir: string): void {
  const filePath = join(sessionsDir, SESSION_FILE);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * Checks if an ISO 8601 expiry timestamp has passed.
 */
export function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}
