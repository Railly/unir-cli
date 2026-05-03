# @crafter/unir-cli

Agent-first CLI for UNIR (Universidad Internacional de La Rioja) campus
online. One binary, full pipeline:

- **download** Temario PDFs from `cms.unir.net`
- **download** Lecciones magistrales from `unir.cloud.panopto.eu`
- **transcribe** mp4 → text via [`trx`](https://github.com/crafter-station/trx) (ElevenLabs Scribe)
- **summarize** PDF + transcript → MDX via Codex (GPT-5.5)
- **narrate** the summary via ElevenLabs Matilda → mp3
- **publish** to a personal Astro Starlight site
- **watch** the Anuncios forum and notify on new posts (Kapso WhatsApp)

Multi-profile, dev-first DX, JSON envelope on every command, T2 confirm
gates only where it matters. Read-only towards UNIR (no submit).

## Install

```bash
bun install -g @crafter/unir-cli
unir doctor
```

Dependencies:

- [`bun`](https://bun.sh) ≥ 1.3
- [`agent-browser`](https://github.com/Railly/agent-browser) (used for
  the OAuth2 form-post login + LTI launches)
- [`trx`](https://github.com/crafter-station/trx) (transcription)
- [`codex`](https://github.com/openai/codex) CLI (resumir / tareas-detect)
- `ELEVENLABS_API_KEY` (TTS)
- `KAPSO_API_KEY` (optional — WhatsApp watcher notifications)

## Quick start

```bash
# 1. Authenticate (browser opens, form-post via crosscutting.unir.net)
UNIR_USERNAME=alguien@correo UNIR_PASSWORD=xxx \
  unir auth login --profile vidama --no-input

# 2. List enrolled courses
unir cursos list --profile vidama

# 3. Pull Tema 1 PDF + lección magistral
unir temas pull gobierno-del-dato --tema 1 --profile vidama
unir clases pull gobierno-del-dato --n 1 --profile vidama

# 4. Process
unir temas extract gobierno-del-dato --tema 1 --profile vidama
unir clases transcribe gobierno-del-dato --n 1 --profile vidama
unir resumir gobierno-del-dato --tema 1 --with-clase 1 --profile vidama
unir narrar gobierno-del-dato --tema 1 --profile vidama

# 5. Publish to your Astro site
UNIR_SITE_PATH=~/Programming/railly/vidama-curso \
  unir publish gobierno-del-dato --tema 1 --with-pdf --yes \
    --profile vidama

# 6. Watch the TFM Anuncios forum
unir anuncios watch trabajo-fin-de-master \
  --interval 6h --notify whatsapp --profile vidama
```

## Storage

| What | Where |
|------|-------|
| Profile config (no secrets) | `~/Library/Application Support/unir/profiles/<profile>.json` (macOS) |
| Sessions (cookies, sesskey) | `~/Library/Application Support/unir/sessions/<profile>.json` (chmod 0600) |
| Course blobs (PDFs, mp4, transcripts, derivados) | `~/Library/Application Support/unir/data/<profile>/<courseSlug>/...` |
| Audit logs | `~/Library/Application Support/unir/audit/*.jsonl` |

XDG-compliant on Linux. Override with `APP_HOME=` (per [cligentic xdg-paths](https://cligentic.railly.dev)).

## Trust ladder

Low-stakes domain (read-only towards UNIR). Two effective levels:

| Level | Friction | Examples |
|-------|----------|----------|
| **T1** | none — runs silently | `auth status`, `cursos list/info`, `temas list/extract`, `clases list/transcribe`, `anuncios list/show/watch`, `resumir`, `narrar`, `doctor`, `schema` |
| **T2** | `--yes` or interactive confirm | `auth login/refresh/logout`, `cursos sync`, `temas pull`, `clases pull`, `publish` |

T3 (write to UNIR — submit assignments / answer quizzes) is intentionally
not implemented in v1.

## Built with

- 18 [`cligentic`](https://cligentic.railly.dev) blocks (banner, json-mode, error-map, audit-log, xdg-paths, atomic-write, config, session, doctor, trust-ladder, next-steps, etc.)
- `commander` for the CLI surface
- `@clack/prompts` for interactive flows (intro/outro/text/password)
- `cheerio` for HTML scraping (Moodle forum, CMS hub, Panopto playlist)
- `picocolors` for the pinky theme (pink-500 / pink-300 / pink-700)

Stack confirmed working with the real UNIR Moodle 4.1.x + Akamai edge
+ OAuth2 IdP (`crosscutting.unir.net`) + Panopto SaaS.

## License

MIT — Railly Hugo.
