// Tiny Kapso WhatsApp REST helper for the anuncios watcher.

import { unirError } from "../errors";

const HUNTER_PHONE = "51963422021";

export async function sendWhatsApp(text: string, toPhone?: string): Promise<void> {
  const apiKey = process.env.KAPSO_API_KEY;
  if (!apiKey) {
    process.stderr.write(`[kapso] KAPSO_API_KEY missing; would send: ${text.slice(0, 80)}...\n`);
    return;
  }
  const phone = toPhone ?? process.env.KAPSO_PHONE_NUMBER ?? HUNTER_PHONE;
  const base = process.env.KAPSO_BASE_URL ?? "https://api.kapso.ai";
  const r = await fetch(`${base}/api/v1/whatsapp_messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      to: phone,
      message_type: "text",
      content: text,
    }),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    throw unirError("unknown-error", `kapso ${r.status}: ${detail}`);
  }
}
