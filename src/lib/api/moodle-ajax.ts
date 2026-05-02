// Moodle internal AJAX client (campusonline.unir.net/lib/ajax/service.php).
//
// Uses agent-browser `eval` to dispatch fetch from inside the persistent
// browser session — that gets us past Akamai bot detection (TLS fingerprint,
// dynamic cookie negotiation, Sec-Fetch-* headers) for free, since the
// browser already passed the JS challenge during login.
//
// Trade-off: ~200-400ms latency per call vs raw fetch. Acceptable for an
// agent-first CLI that does ≤1 req/s by design.

import { spawnSync } from "node:child_process";
import { unirError } from "../errors";
import type { UnirSession } from "../auth/session-store";

const BASE = "https://campusonline.unir.net";

export type MoodleAjaxRequest = {
  methodname: string;
  args: Record<string, unknown>;
};

type Envelope<T> =
  | { error: false; data: T }
  | { error: true; exception: { message: string; errorcode: string } };

/**
 * Single AJAX call dispatched from inside the agent-browser session.
 *
 * The session must be the same one used for login (`unir-<profile>`); the
 * persistent browser holds the cookie jar.
 */
export async function moodleAjax<T>(
  session: UnirSession,
  req: MoodleAjaxRequest,
): Promise<T> {
  const url = `${BASE}/lib/ajax/service.php?sesskey=${encodeURIComponent(session.sesskey)}&info=${encodeURIComponent(req.methodname)}`;
  const body = JSON.stringify([
    { index: 0, methodname: req.methodname, args: req.args ?? {} },
  ]);

  const evalScript = `
    fetch(${JSON.stringify(url)}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ${JSON.stringify(body)}
    })
    .then(async (r) => ({
      status: r.status,
      contentType: r.headers.get("content-type"),
      text: await r.text()
    }))
    .then(JSON.stringify)
  `.trim();

  const r = spawnSync(
    "agent-browser",
    ["--session-name", `unir-${session.profile}`, "eval", evalScript],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw unirError("unknown-error", `agent-browser eval failed: ${r.stderr}`);
  }

  // agent-browser returns the eval result as a JSON-encoded string in stdout
  let raw = r.stdout.trim();
  // Strip leading log lines if any
  const lastLine = raw.split("\n").filter((l) => l.startsWith('"') || l.startsWith("{")).pop();
  if (lastLine) raw = lastLine;

  let resp: { status: number; contentType: string | null; text: string };
  try {
    const unquoted = JSON.parse(raw);
    resp = typeof unquoted === "string" ? JSON.parse(unquoted) : unquoted;
  } catch (err) {
    throw unirError("unknown-error", `failed to parse browser-fetch response: ${String(err)}`);
  }

  if (resp.status === 302 || resp.status === 401 || resp.status === 403) {
    throw unirError("auth-expired", `Moodle returned ${resp.status}`);
  }
  if (!resp.contentType || !resp.contentType.includes("json")) {
    throw unirError("auth-expired", "Moodle returned HTML — session likely expired");
  }
  if (resp.status >= 400) {
    throw unirError("unknown-error", `Moodle returned ${resp.status}: ${resp.text.slice(0, 200)}`);
  }

  let parsed: Array<Envelope<T>> | Envelope<T>;
  try {
    parsed = JSON.parse(resp.text);
  } catch (err) {
    throw unirError("unknown-error", `non-JSON Moodle body: ${String(err)}`);
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!first) throw unirError("unknown-error", "empty Moodle response");
  if (first.error) {
    if (
      first.exception?.errorcode === "servicenotavailable" ||
      first.exception?.errorcode === "invalidsesskey"
    ) {
      throw unirError("auth-expired", first.exception.message);
    }
    throw unirError("unknown-error", `${first.exception?.errorcode}: ${first.exception?.message}`);
  }

  return first.data as T;
}
