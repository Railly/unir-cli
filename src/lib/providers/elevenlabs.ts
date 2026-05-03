// ElevenLabs HTTP client. We hit the text-to-speech endpoint directly with
// fetch, no SDK dep. Default voice: Matilda (es-ES neutral, used by qf-academia).

import { writeFileSync } from "node:fs";
import { unirError } from "../errors";

// Matilda voice id (ElevenLabs public voice). If you switch voices, override
// via `unir narrar --voice <id>` or env UNIR_TTS_VOICE_ID.
const MATILDA_VOICE_ID = "XrExE9yKIg1WjnnlVkGX";

export type NarrateOptions = {
  text: string;
  voiceId?: string;
  /** model_id; default is the multilingual flash model. */
  modelId?: string;
  /** chars per chunk; ElevenLabs hard cap is 5000, we leave headroom. */
  chunkChars?: number;
  outPath: string;
};

export async function narrateToMp3(opts: NarrateOptions): Promise<{ bytes: number }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw unirError("elevenlabs-no-api-key");

  const voiceId =
    opts.voiceId ?? process.env.UNIR_TTS_VOICE_ID ?? MATILDA_VOICE_ID;
  const modelId = opts.modelId ?? "eleven_multilingual_v2";
  const chunkSize = opts.chunkChars ?? 4500;

  const chunks = chunkText(stripMarkdownHeaders(opts.text), chunkSize);

  const buffers: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: chunk,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.1,
          use_speaker_boost: true,
        },
      }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      throw unirError("unknown-error", `ElevenLabs ${r.status}: ${detail}`);
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    buffers.push(buf);
  }

  const total = buffers.reduce((acc, b) => acc + b.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) {
    merged.set(b, off);
    off += b.length;
  }
  writeFileSync(opts.outPath, merged);
  return { bytes: total };
}

/** Naïve splitter: keep paragraph boundaries; never break a sentence mid-way. */
function chunkText(text: string, max: number): string[] {
  const out: string[] = [];
  let buf = "";
  const paragraphs = text.split(/\n\s*\n/);
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > max && buf) {
      out.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Removes markdown decoration so it doesn't get spoken literally. */
function stripMarkdownHeaders(md: string): string {
  return md
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n/gm, "") // frontmatter
    .replace(/^#{1,6}\s+(.*)$/gm, "$1.") // headers → sentence
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold
    .replace(/\*(.*?)\*/g, "$1") // italic
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^[-•]\s+/gm, "") // bullet markers
    .replace(/\n{3,}/g, "\n\n");
}
