// agent-browser wrapper for the UNIR login flow.
// Spawns `agent-browser --headed --session-name unir-<profile>` and walks
// the form-post on crosscutting.unir.net, then extracts cookies + sesskey
// from campusonline.unir.net.

import { spawnSync } from "node:child_process";
import { unirError } from "../errors";

const LOGIN_URL = "https://campusonline.unir.net/my/";

type Cmd = string[];

function ab(profile: string, ...args: Cmd): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    "agent-browser",
    ["--session-name", `unir-${profile}`, "--headed", ...args],
    { encoding: "utf8" },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status ?? -1,
  };
}

function abQuiet(profile: string, ...args: Cmd) {
  // Same but headless (used after login is established).
  const r = spawnSync(
    "agent-browser",
    ["--session-name", `unir-${profile}`, ...args],
    { encoding: "utf8" },
  );
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status ?? -1,
  };
}

function ensureBrowser(): void {
  const r = spawnSync("which", ["agent-browser"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw unirError("auth-blocked");
  }
}

export type LoginResult = {
  cookies: Record<string, string>;
  sesskey: string;
  userId?: number;
};

/**
 * Performs interactive(-ish) login: opens browser, fills creds, waits for
 * /my/, extracts sesskey + cookies. Returns the artifacts to persist.
 *
 * The browser stays open for ~1s after success; the cookies are kept by
 * agent-browser's session profile under the same name (unir-<profile>),
 * so subsequent `agent-browser` invocations with that session reuse them.
 */
export async function loginViaBrowser(
  profile: string,
  username: string,
  password: string,
): Promise<LoginResult> {
  ensureBrowser();

  // Open login page
  const open = ab(profile, "open", LOGIN_URL);
  if (open.status !== 0) throw unirError("auth-blocked", open.stderr);

  // Wait for redirect to crosscutting login form
  await sleep(2000);

  // Reject cookie banner if shown (button "NO")
  const snap1 = ab(profile, "snapshot", "-i");
  const noBtnRef = matchRef(snap1.stdout, /button "NO"/);
  if (noBtnRef) ab(profile, "click", noBtnRef);

  // Find email/password textboxes by their label
  const snap2 = ab(profile, "snapshot", "-i");
  const userRef = matchRef(snap2.stdout, /textbox "Usuario o Correo electrónico/);
  const passRef = matchRef(snap2.stdout, /textbox "Contraseña/);
  const submitRef = matchRef(snap2.stdout, /button "Acceder"/);
  if (!userRef || !passRef || !submitRef) throw unirError("auth-blocked", "form fields not found");

  // Fill credentials
  ab(profile, "fill", userRef, username);
  ab(profile, "fill", passRef, password);

  // Submit
  const submitR = ab(profile, "click", submitRef);
  if (submitR.status !== 0) throw unirError("auth-blocked", submitR.stderr);

  // Wait for redirect to /my/
  await sleep(5000);

  // Verify we landed on /my/
  const urlR = ab(profile, "get", "url");
  const url = urlR.stdout.trim();
  if (!url.includes("campusonline.unir.net/my")) {
    throw unirError(
      "auth-blocked",
      `expected /my/, landed on ${url} — likely wrong creds or MFA challenge`,
    );
  }

  // Extract sesskey + userId from M.cfg
  const evalR = ab(
    profile,
    "eval",
    "JSON.stringify({sesskey: typeof M !== 'undefined' ? M.cfg?.sesskey : null, userId: typeof M !== 'undefined' ? (M.cfg?.userId || null) : null})",
  );
  const m = parseEvalString(evalR.stdout);
  if (!m?.sesskey) throw unirError("auth-blocked", "M.cfg.sesskey not found in DOM");

  // Extract cookies from agent-browser session via eval
  const cookiesR = ab(profile, "eval", "document.cookie");
  const cookieRaw = parseEvalRaw(cookiesR.stdout);
  const cookies = parseCookies(cookieRaw);
  if (!cookies.UNIR_SESSION && !Object.keys(cookies).some((k) => k.startsWith("MoodleSession"))) {
    throw unirError("auth-blocked", "no UNIR_SESSION / MoodleSession cookie found");
  }

  return {
    cookies,
    sesskey: m.sesskey,
    userId: m.userId ?? undefined,
  };
}

/**
 * Probe whether the existing session is still alive for this profile.
 * Returns the current sesskey if logged in, null otherwise.
 */
export async function probeSession(profile: string): Promise<string | null> {
  ensureBrowser();
  // Don't open a fresh page if browser already has the session — just eval
  const open = abQuiet(profile, "open", LOGIN_URL);
  if (open.status !== 0) return null;
  await sleep(1500);
  const evalR = abQuiet(
    profile,
    "eval",
    "JSON.stringify({sesskey: typeof M !== 'undefined' ? M.cfg?.sesskey : null, url: location.href})",
  );
  const m = parseEvalString(evalR.stdout);
  if (!m?.sesskey || !String(m?.url ?? "").includes("/my/")) return null;
  return m.sesskey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function matchRef(snapshot: string, pattern: RegExp): string | null {
  const lines = snapshot.split("\n");
  for (const line of lines) {
    if (pattern.test(line)) {
      const m = line.match(/\[ref=(e\d+)\]/);
      if (m) return `@${m[1]}`;
    }
  }
  return null;
}

function parseEvalString(stdout: string): Record<string, unknown> | null {
  // agent-browser eval returns the value as a JSON string in stdout.
  // For an object literal returned by JSON.stringify in the eval, that's
  // a JSON-encoded string of JSON: "{\"sesskey\":\"...\"}" → unquote → parse.
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const unquoted = JSON.parse(trimmed);
    if (typeof unquoted === "string") {
      try {
        return JSON.parse(unquoted) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (typeof unquoted === "object" && unquoted !== null) {
      return unquoted as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseEvalRaw(stdout: string): string {
  // For evals that return a raw string (not JSON.stringify'd in the eval),
  // agent-browser still wraps it as JSON. Unquote one level.
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const v = JSON.parse(trimmed);
    if (typeof v === "string") return v;
  } catch {
    // fall through to raw
  }
  return trimmed.replace(/^"|"$/g, "");
}

function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = rest.join("=");
  }
  return out;
}
