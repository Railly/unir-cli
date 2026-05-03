// Lecciones magistrales (lm.lti.unir.net) scraper.
// LTI launch from Moodle's "Recursos audiovisuales" (cmid 501004 in Gobierno
// del Dato). The hub renders a Panopto-embedded video player + a sidebar
// playlist. The first video has its UUID in the iframe `src`; the rest of
// the playlist titles + thumbnails are server-rendered in <li> items, but
// the UUIDs are NOT in the DOM as data attrs — clicking each playlist
// item swaps the iframe via JS.
//
// Strategy v1: extract the FIRST video's UUID from the iframe, then walk
// the playlist items by clicking each <li> (one at a time) and re-reading
// the iframe src after a short wait.

import { spawnSync } from "node:child_process";
import { load } from "cheerio";
import { unirError } from "../errors";
import { downloadBinaryViaCookies, navigateAndDump } from "../auth/browser";

const MOODLE_BASE = "https://campusonline.unir.net";
const PANOPTO_HOST = "https://unir.cloud.panopto.eu";

export type ClaseListing = {
  /** 1-based index in the playlist. */
  n: number;
  title: string;
  slug: string;
  /** Panopto recording UUID. */
  panoptoUuid: string | null;
  /** Display duration parsed from the playlist (e.g. "14 minutos") if available. */
  durationLabel?: string;
};

export async function listClases(
  profile: string,
  ltiCmid: number,
): Promise<ClaseListing[]> {
  // Bounce to /my/ to clear stale state.
  await navigateAndDump(profile, `${MOODLE_BASE}/my/`, 1500);

  const launchUrl = `${MOODLE_BASE}/mod/lti/launch.php?id=${ltiCmid}&triggerview=0`;
  const first = await navigateAndDump(profile, launchUrl, 6500);

  if (!first.url.startsWith("https://lm.lti.unir.net")) {
    throw unirError(
      "unknown-error",
      `expected lm.lti.unir.net redirect, landed on ${first.url}`,
    );
  }

  // Parse the playlist titles + the currently-playing iframe UUID.
  const playlist = parsePlaylist(first.html);
  if (playlist.length === 0) return [];

  // The first item's UUID is in the embedded iframe src.
  const firstUuid = extractCurrentUuid(first.html);
  if (firstUuid && playlist[0]) playlist[0].panoptoUuid = firstUuid;

  // For each subsequent item, click the playlist row, wait, then re-read
  // the iframe src.
  for (let i = 1; i < playlist.length; i++) {
    const clickRes = spawnSync(
      "agent-browser",
      [
        "--session-name",
        `unir-${profile}`,
        "eval",
        `(()=>{
          const rows = document.querySelectorAll('.video-playlist-list > li');
          const target = rows[${i}];
          if (!target) return 'not-found';
          const clickable = target.querySelector('button, [class*="container"]') || target;
          clickable.click();
          return 'clicked';
        })()`,
      ],
      { encoding: "utf8" },
    );
    if (clickRes.status !== 0) continue;
    Bun.sleepSync(2500);
    const iframeRes = spawnSync(
      "agent-browser",
      [
        "--session-name",
        `unir-${profile}`,
        "eval",
        `document.querySelector('#lm-player-frame, iframe[src*="panopto"]')?.src || ''`,
      ],
      { encoding: "utf8" },
    );
    const src = parseRawString(iframeRes.stdout);
    const m = src.match(/[?&]id=([0-9a-f-]+)/i);
    if (m && playlist[i]) playlist[i].panoptoUuid = m[1] ?? null;
  }

  return playlist;
}

export async function downloadPanoptoMp4(
  profile: string,
  uuid: string,
  outPath: string,
): Promise<{ status: number; bytes: number }> {
  const url = `${PANOPTO_HOST}/Panopto/Podcast/Download/${uuid}.mp4?mediaTargetType=videoPodcast`;
  const r = await downloadBinaryViaCookies(profile, url, outPath);
  return { status: r.status, bytes: r.bytes };
}

// --- internal helpers ---

function parsePlaylist(html: string): ClaseListing[] {
  const $ = load(html);
  const out: ClaseListing[] = [];
  // Each playlist row is one <li>; pick exactly that.
  $(".video-playlist-list > li").each((i, el) => {
    const title = $(el).find(".video-title").first().text().trim();
    const duration = $(el).find(".video-duration span").first().text().trim();
    if (!title) return;
    out.push({
      n: i + 1,
      title,
      slug: slugify(title),
      panoptoUuid: null,
      durationLabel: duration || undefined,
    });
  });
  return out;
}

function extractCurrentUuid(html: string): string | null {
  const $ = load(html);
  const src = $("#lm-player-frame, iframe[src*='panopto']").attr("src") ?? "";
  const m = src.match(/[?&]id=([0-9a-f-]+)/i);
  return m ? m[1] ?? null : null;
}

function parseRawString(stdout: string): string {
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
