# @crafter/unir-cli

Agent-first CLI for UNIR (Universidad Internacional de La Rioja) campus
online. A thin adapter that surfaces what the campus hides behind LTI
launches:

- **list/pull** Temario PDFs from `cms.unir.net`
- **list/pull** Lecciones magistrales from `unir.cloud.panopto.eu`
- **transcribe** recorded classes via [`trx`](https://github.com/crafter-station/trx) (ElevenLabs Scribe)
- **read** course state, sections, modules through Moodle's internal AJAX
- **watch** the Anuncios forum and notify on new posts (Kapso WhatsApp)

Multi-profile, dev-first DX, JSON envelope on every command, T2 confirm
gates only where it matters. Read-only towards UNIR (no submit).

Per-student processing pipelines (PDF → codex GPT-5.5 → ElevenLabs TTS →
Astro/Starlight site) live in the consumer project, not in this CLI.

## Install

```bash
bun install -g @crafter/unir-cli
unir doctor
```

Dependencies:

- [`bun`](https://bun.sh) ≥ 1.3
- [`agent-browser`](https://github.com/Railly/agent-browser) (OAuth2 form-post login + LTI launches)
- [`trx`](https://github.com/crafter-station/trx) (recording transcription)
- `KAPSO_API_KEY` (optional — WhatsApp watcher notifications)

## Quick start

```bash
# 1. Authenticate (browser opens, form-post via crosscutting.unir.net)
UNIR_USERNAME=alguien@correo UNIR_PASSWORD=xxx \
  unir auth login --profile myprofile --no-input

# 2. List enrolled courses
unir cursos list --profile myprofile

# 3. Inspect a course
unir cursos info gobierno-del-dato --profile myprofile

# 4. Pull Temario PDFs
unir temas list  gobierno-del-dato                       --profile myprofile
unir temas pull  gobierno-del-dato --tema 1              --profile myprofile
unir temas extract gobierno-del-dato --tema 1            --profile myprofile

# 5. Pull and transcribe a recorded class
unir clases list       gobierno-del-dato                 --profile myprofile
unir clases pull       gobierno-del-dato --n 1           --profile myprofile
unir clases transcribe gobierno-del-dato --n 1           --profile myprofile

# 6. Read or watch the Anuncios forum
unir anuncios list  trabajo-fin-de-master                --profile myprofile
unir anuncios watch trabajo-fin-de-master \
  --interval 6h --notify whatsapp --profile myprofile
```

## Commands

| Noun | Verbs |
|---|---|
| `auth` | `login`, `status`, `refresh`, `logout` |
| `cursos` | `list`, `info` |
| `temas` | `list`, `pull`, `extract` |
| `clases` | `list`, `pull`, `transcribe` |
| `anuncios` | `list`, `show`, `watch` |
| `doctor` | health check (deps + paths) |
| `schema` | `<command>` — JSON Schema introspection for agents |

Run `unir <noun> --help` for verb-level options.

## Storage

| What | Where |
|------|-------|
| Profile config (no secrets) | `~/Library/Application Support/unir/profiles/<profile>.json` (macOS) |
| Sessions (cookies, sesskey) | `~/Library/Application Support/unir/sessions/<profile>.json` (chmod 0600) |
| Course blobs (PDFs, mp4, transcripts) | `~/Library/Application Support/unir/data/<profile>/<courseSlug>/...` |
| Audit logs | `~/Library/Application Support/unir/audit/*.jsonl` |

XDG-compliant on Linux. Override with `APP_HOME=` (per [cligentic xdg-paths](https://cligentic.railly.dev)).

## Trust ladder

Low-stakes domain (read-only towards UNIR). Two effective levels:

| Level | Friction | Examples |
|-------|----------|----------|
| **T1** | none — runs silently | `auth status`, `cursos list/info`, `temas list/extract`, `clases list/transcribe`, `anuncios list/show/watch`, `doctor`, `schema` |
| **T2** | `--yes` or interactive confirm | `auth login/refresh/logout`, `temas pull`, `clases pull` |

T3 (writing back to UNIR — submitting assignments, answering quizzes)
is intentionally not implemented.

## Built with

- 18 [`cligentic`](https://cligentic.railly.dev) blocks (banner, json-mode, error-map, audit-log, xdg-paths, atomic-write, config, session, doctor, trust-ladder, next-steps, etc.)
- `commander` for the CLI surface
- `@clack/prompts` for interactive flows
- `cheerio` for HTML scraping (Moodle forum, CMS hub, Panopto playlist)
- `picocolors` for the pink theme (pink-500 / pink-300 / pink-700)

Stack confirmed working with UNIR Moodle 4.1.x + Akamai edge + OAuth2 IdP
(`crosscutting.unir.net`) + Panopto SaaS.

## License

MIT — Railly Hugo.
