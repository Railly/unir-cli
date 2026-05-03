// CMS Temario scraper. Drives an LTI launch from Moodle to cms.unir.net,
// parses the hub HTML with cheerio, returns the per-tema base64 file IDs.
//
// Endpoints discovered during recon:
// - LTI launch: https://campusonline.unir.net/mod/lti/launch.php?id=<cmid>&triggerview=0
//   redirects to https://cms.unir.net/lti/hub/4/<courseid>/<shortname>?uuid=...
// - Per-tema PDF download: https://cms.unir.net/file/<base64-id>/esl-ES
//
// Note: the temario CMS organizes content into Bloques (tabs) and each tab
// shows N temas. The "Descargar tema en PDF" link inside each tema view
// points at the final mp endpoint. The hub page only shows the first tab
// by default, so to harvest all base64 IDs we click each tab and re-parse.

import { spawnSync } from "node:child_process";
import { load } from "cheerio";
import { unirError } from "../errors";
import { downloadBinaryViaCookies, navigateAndDump } from "../auth/browser";

const MOODLE_BASE = "https://campusonline.unir.net";
const CMS_BASE = "https://cms.unir.net";

export type TemaListing = {
  /** Tema number (1, 2, ...). Inferred from the tab/heading order. */
  n: number;
  /** Bloque header text. */
  bloque: string;
  /** Tema title (e.g. "Dirección Estratégica y Gobierno de Datos"). */
  title: string;
  /** Slug derived from title. */
  slug: string;
  /** Base64 file id used by /file/<id>/esl-ES. May be null if the tema
   * is announced in the syllabus but not yet published. */
  cmsId: string | null;
};

/**
 * Walks the Temario LTI app and returns every tema with its CMS file id.
 *
 * @param profile  unir-cli profile (used for the agent-browser session)
 * @param ltiCmid  cmid of the "Temario" module in Moodle (e.g. 501003 for
 *                 Gobierno del Dato)
 */
export async function listTemas(profile: string, ltiCmid: number): Promise<TemaListing[]> {
  // 0. Bounce back to /my/ first to clear any stale CMS page in the browser tab.
  await navigateAndDump(profile, `${MOODLE_BASE}/my/`, 1500);

  // 1. Trigger LTI launch (sets CMS cookies in the browser jar)
  const launchUrl = `${MOODLE_BASE}/mod/lti/launch.php?id=${ltiCmid}&triggerview=0`;
  let first = await navigateAndDump(profile, launchUrl, 5500);

  if (!first.url.startsWith(CMS_BASE)) {
    throw unirError("unknown-error", `expected cms.unir.net redirect, landed on ${first.url}`);
  }

  // 2. The LTI session may resume on a single-tema view if VIDAMA student opened
  // one earlier. Detect that and click "Menú" to return to the hub.
  if (isSingleTemaView(first.html)) {
    const menuClicked = await clickMenuButton(profile);
    if (menuClicked) {
      await sleepMs(2500);
      first = await dumpCurrent(profile);
    }
  }

  // 3. Parse hub HTML — first tab visible by default. We need ALL tabs.
  const tabs = extractTabs(first.html);
  if (tabs.length === 0) {
    // Single-tab course: scrape current page (still dedupe by tema number).
    return dedupeByN(parseTemaPage(first.html, "Bloque 1", 0));
  }

  // 4. The CMS hub renders ALL Bloque tabs server-side and includes ALL
  // temas in a single HTML payload (tabs are JS show/hide). Parsing the
  // first dump is enough; we just dedupe by tema number.
  const items = parseTemaPage(first.html, "(all)", 0);
  return dedupeByN(items);
}

/** A "single tema" view shows "Ideas clave" + a single Tema header with
 * its 1.X subsections. The hub view shows multiple Tema headers across
 * Bloques, no "Ideas clave" wrapper. */
function isSingleTemaView(html: string): boolean {
  const $ = load(html);
  const ideasClaveBtns = $("button, h3, h2").filter(
    (_i, el) => $(el).text().trim().toLowerCase() === "ideas clave",
  );
  const temaHeaders = $("h1, h2, h3, h4, h5, h6").filter((_i, el) =>
    /^TEMA\s+\d+\./i.test($(el).text().trim()),
  );
  return ideasClaveBtns.length > 0 && temaHeaders.length <= 2;
}

async function clickMenuButton(profile: string): Promise<boolean> {
  const r = spawnSync(
    "agent-browser",
    [
      "--session-name",
      `unir-${profile}`,
      "eval",
      `(()=>{
        const candidates = document.querySelectorAll('button, a, [role="button"]');
        for (const el of candidates) {
          const txt = (el.textContent || '').trim();
          if (/^Men[uú]$/i.test(txt) || /Volver al men[uú]/i.test(txt)) {
            el.click();
            return 'clicked';
          }
        }
        return 'not-found';
      })()`,
    ],
    { encoding: "utf8" },
  );
  return r.status === 0 && r.stdout.includes("clicked");
}

async function dumpCurrent(profile: string): Promise<{ url: string; html: string }> {
  const urlR = spawnSync(
    "agent-browser",
    ["--session-name", `unir-${profile}`, "get", "url"],
    { encoding: "utf8" },
  );
  const htmlR = spawnSync(
    "agent-browser",
    ["--session-name", `unir-${profile}`, "eval", "document.documentElement.outerHTML"],
    { encoding: "utf8" },
  );
  const html = parseEvalRaw(htmlR.stdout);
  return { url: (urlR.stdout ?? "").trim(), html };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function parseEvalRaw(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const v = JSON.parse(trimmed);
    if (typeof v === "string") return v;
  } catch {
    // ignore
  }
  return trimmed.replace(/^"|"$/g, "");
}

/** Collapses duplicate entries by tema number, preferring the one with cmsId set. */
function dedupeByN(items: TemaListing[]): TemaListing[] {
  const byN = new Map<number, TemaListing>();
  for (const t of items) {
    const existing = byN.get(t.n);
    if (!existing) {
      byN.set(t.n, t);
      continue;
    }
    // Prefer entry with cmsId set
    if (!existing.cmsId && t.cmsId) {
      byN.set(t.n, { ...existing, cmsId: t.cmsId });
    }
  }
  return Array.from(byN.values()).sort((a, b) => a.n - b.n);
}

/**
 * Downloads a single tema PDF directly to the given path.
 */
export async function downloadTemaPdfTo(
  profile: string,
  cmsId: string,
  outPath: string,
): Promise<{ status: number; contentType: string | null; bytes: number }> {
  // Make sure we're inside cms.unir.net first so cookies are scoped right.
  // (Then snapshotCookiesFor will pick up the LTI session cookies.)
  const url = `${CMS_BASE}/file/${cmsId}/esl-ES`;
  return downloadBinaryViaCookies(profile, url, outPath);
}

// --- internal parsing helpers ---

function extractTabs(html: string): Array<{ label: string; href: string }> {
  const $ = load(html);
  const out: Array<{ label: string; href: string }> = [];
  // The CMS uses a tab list of <a> with text "Bloque 1" / "Bloque 2"...
  $("a, button").each((_i, el) => {
    const text = $(el).text().trim();
    if (/^Bloque\s+\d+/i.test(text)) {
      const href = $(el).attr("href");
      if (href && href.startsWith("http")) {
        out.push({ label: text, href });
      } else if (href) {
        out.push({ label: text, href: new URL(href, CMS_BASE).toString() });
      }
    }
  });
  // Dedupe by label
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });
}

function parseTemaPage(html: string, bloque: string, startN: number): TemaListing[] {
  const $ = load(html);
  const out: TemaListing[] = [];

  // Each tema is rendered as a card with an <h2>-ish heading "TEMA N. ..." and
  // a download button-link with class="button" pointing to /file/<id>/esl-ES.
  // Strategy: find every "Tema N." header and pair it with the nearest
  // /file/<id>/esl-ES anchor in the same container.

  // Match only direct text-bearing nodes whose own (not descendant) text
  // contains "TEMA N." — this prevents huge ancestors from matching.
  const headers = $("h1, h2, h3, h4, h5, h6").filter((_i, el) => {
    const txt = $(el).text().trim();
    return /^TEMA\s+\d+\.?\s+/i.test(txt);
  });

  let counter = startN;
  headers.each((_i, headerEl) => {
    const headerText = $(headerEl).text().trim();
    const m = headerText.match(/TEMA\s+(\d+)\.?\s*(.+)/i);
    if (!m) return;
    const n = Number.parseInt(m[1] ?? "0", 10);
    const title = (m[2] ?? "").trim();
    counter = Math.max(counter, n);

    // Look for the closest "Descargar tema" / class=button anchor pointing
    // at /file/.../esl-ES.
    let cmsId: string | null = null;
    let scope = $(headerEl).closest("section, article, .tema, .card, div");
    if (scope.length === 0) scope = $(headerEl).parent();
    scope
      .find('a[href*="/file/"], a.button[href*="/file/"]')
      .each((_j, a) => {
        const href = $(a).attr("href") ?? "";
        const fm = href.match(/\/file\/([^/]+)\/esl-ES/);
        if (fm && !cmsId) cmsId = fm[1] ?? null;
      });

    out.push({
      n,
      bloque,
      title,
      slug: slugify(title),
      cmsId,
    });
  });

  // Fallback: if no headers matched, just collect all /file/ links and
  // synthesize sequential numbers.
  if (out.length === 0) {
    $('a[href*="/file/"]').each((i, a) => {
      const href = $(a).attr("href") ?? "";
      const fm = href.match(/\/file\/([^/]+)\/esl-ES/);
      if (fm) {
        out.push({
          n: counter + i + 1,
          bloque,
          title: $(a).text().trim() || `Tema ${counter + i + 1}`,
          slug: slugify($(a).text().trim() || `tema-${counter + i + 1}`),
          cmsId: fm[1] ?? null,
        });
      }
    });
  }

  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
