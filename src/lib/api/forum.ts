// Moodle forum HTML scraper. Used for "Anuncios" foro across courses.

import { load } from "cheerio";
import { navigateAndDump } from "../auth/browser";
import { unirError } from "../errors";

const MOODLE_BASE = "https://campusonline.unir.net";

export type ForumDiscussion = {
  id: string;
  title: string;
  url: string;
  author?: string;
  unread?: number;
  /** Best-effort timestamp from the listing page (might be empty). */
  ts?: string;
};

export type ForumPost = {
  id: string;
  author: string;
  subject: string;
  htmlBody: string;
  /** Plain text approximation of htmlBody. */
  text: string;
  ts?: string;
};

export async function listDiscussions(
  profile: string,
  forumCmid: number,
): Promise<ForumDiscussion[]> {
  const url = `${MOODLE_BASE}/mod/forum/view.php?id=${forumCmid}`;
  const { html } = await navigateAndDump(profile, url, 3000);
  const $ = load(html);
  const out: ForumDiscussion[] = [];
  $("tr.discussion[data-discussionid]").each((_i, row) => {
    const id = $(row).attr("data-discussionid") ?? "";
    const link = $(row).find('a[href*="discuss.php"]').first();
    const title = link.text().trim();
    const href = link.attr("href") ?? "";
    if (!id || !title) return;
    out.push({
      id,
      title,
      url: href.startsWith("http") ? href : new URL(href, MOODLE_BASE).toString(),
      author: $(row).find(".author, .username, [data-region='author']").first().text().trim() || undefined,
      ts: $(row).find("time").first().attr("datetime") || undefined,
    });
  });
  return out;
}

export async function showDiscussion(
  profile: string,
  discussionId: string,
): Promise<{ posts: ForumPost[]; subject: string }> {
  const url = `${MOODLE_BASE}/mod/forum/discuss.php?d=${encodeURIComponent(discussionId)}`;
  const { html } = await navigateAndDump(profile, url, 3000);
  const $ = load(html);
  const posts: ForumPost[] = [];
  let subject = "";
  $("article.forum-post-container, [data-region='post']").each((_i, el) => {
    const id = $(el).attr("data-post-id") ?? $(el).attr("id") ?? "";
    const subjectEl = $(el).find('[data-region-content="forum-post-core-subject"]').first();
    const author = $(el).find("img").first().attr("alt") ?? "";
    const cleanedAuthor = author.replace(/^Imagen de\s+/i, "").trim();
    const subjectText = subjectEl.text().trim();
    if (!subject && subjectText) subject = subjectText;
    const bodyEl = $(el).find('[data-region-content="forum-post-core-body"]').first();
    const htmlBody = bodyEl.html() ?? "";
    const text = bodyEl.text().replace(/\s+\n/g, "\n").trim();
    const ts = $(el).find("time").first().attr("datetime") ?? undefined;
    posts.push({
      id,
      author: cleanedAuthor,
      subject: subjectText,
      htmlBody,
      text,
      ts,
    });
  });
  if (posts.length === 0) throw unirError("unknown-error", "no posts parsed in discussion");
  return { posts, subject };
}
