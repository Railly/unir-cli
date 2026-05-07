---
name: unir-cli
description: |
  Pipeline operator for Hunter's vidama-curso project — the private Astro Starlight
  site that mirrors the student's UNIR VIDAMA master (Visual Analytics & Big Data,
  OCT2025 cohort). Wraps the @crafter/unir-cli adapter (Moodle 4.1.x + Akamai +
  LTI hub + Panopto) and the local processing pipeline (codex GPT-5.5 → ElevenLabs
  Matilda → MDX render → Vercel deploy). Use when Hunter mentions UNIR, VIDAMA,
  vidama-curso, campusonline.unir.net, "Gobierno del Dato", "Herramientas de
  Visualización", "Trabajo Fin de Máster" / TFM, profile vidama, or asks to:
  (1) sync new temas after UNIR publishes material, (2) re-render the site after
  a template change, (3) deploy vidama-curso to Vercel, (4) debug the CLI /
  agent-browser session, (5) check coverage of which temas are processed /
  missing transcripts, (6) start the TFM anuncios watcher, (7) check what's new
  in UNIR. Spanish triggers: "sincroniza UNIR", "deploy vidama", "qué falta
  procesar", "TFM watcher", "nuevo tema en gobierno del dato", "transcribe la
  clase magistral", "publica el tema N", "panorama UNIR". Read-only towards UNIR
  (no submit). Do NOT use for: writing CLI features (those live in this repo's
  `src/` — separate work) or re-architecting the site itself (touch sparingly;
  consult PROJECT.md first).
---

# unir-cli

Operator skill for the two-repo pipeline that turns UNIR campus material into a
self-contained Astro Starlight site for the student.

## What this skill operates

Two repos:

- `~/Programming/railly/unir-cli/` (this repo) — public OSS, npm
  `@crafter/unir-cli@0.2.3`. Adapter only (read UNIR, no submit).
- `~/Programming/railly/vidama-curso/` — private Astro Starlight site that
  consumes the CLI. Deployed at <https://vidama-curso.vercel.app> on Vercel team
  `crafter-station`.

Processing logic (PDF → codex GPT-5.5 → MDX, mp4 → whisper → transcript, summary
→ ElevenLabs Matilda → mp3) lives in `vidama-curso/scripts/sync.ts`. **Do not
put processing logic back in the CLI.**

**Always read `04_Projects/_active/unir-cli/PROJECT.md` in hunter-brain before
doing anything destructive** — it documents the bodies (Akamai, browser daemon
stalls, defaultLocale gotcha, pdf-parse bun bug, Vercel auto-deploy quirk, etc).

## State of play

Coverage as of 2026-05-03:

- 21/21 temas published as MDX with 3-tab UI (Guía / Transcripción / PDF)
- 8/21 with full ElevenLabs Scribe + whisper transcript integrated (Gobierno
  1-8). The other 13 show "transcript not yet available" — P0 work to finish.
- 21/21 with codex GPT-5.5 summary
- 21/21 with ElevenLabs Matilda mp3 narration
- 21/21 with original UNIR PDF in `/public/pdf/`

Profile: `vidama`. Sessions in `~/Library/Application Support/unir/`. Cookies
last ~90 min of inactivity; sesskey rotates each login.

## Daily ops

### Sync new content

```bash
# 1. Bounce the agent-browser daemon to /my/ first (gotcha: stale tab → empty list)
agent-browser --session-name unir-vidama open https://campusonline.unir.net/my/
sleep 5

# 2. Verify auth
unir --profile vidama auth status

# 3. If expired, re-login
UNIR_USERNAME=… UNIR_PASSWORD=… unir --profile vidama --no-input auth login

# 4. Run the sync (idempotent — skips already-published temas)
cd ~/Programming/railly/vidama-curso
bun run sync                                       # both courses
bun run sync gobierno-del-dato-y-toma-de-decisiones
bun run sync herramientas-de-visualizacion
bun run sync gobierno-del-dato-y-toma-de-decisiones --tema 3 --force

# Useful flags:
#   --tema N          single tema only
#   --force           re-process even if MDX exists
#   --force-render    only re-render MDX (no codex / no narrar — token-free)
#   --skip-clases     don't pull mp4 / transcribe
#   --skip-narrar     don't call ElevenLabs (mp3 must already exist)

# 5. Build + deploy
bun run build
vercel deploy --prod -y --no-wait --scope crafter-station
```

### Re-render with new template (no LLM cost)

When the MDX template or component changes and you need to refresh all pages
without re-spending LLM/TTS tokens:

```bash
cd ~/Programming/railly/vidama-curso
bun run sync --force-render --skip-clases --skip-narrar
bun run build
vercel deploy --prod -y --no-wait --scope crafter-station
```

### Coverage check

```bash
# Count published temas
find ~/Programming/railly/vidama-curso/src/content/docs/ -name "tema-*.mdx" | wc -l

# Audit which temas have transcript integrated (vs. "transcript not yet available")
for f in ~/Programming/railly/vidama-curso/src/content/docs/*/tema-*.mdx; do
  grep -q "Transcripción literal de la clase magistral, generada con ElevenLabs" "$f" \
    && echo "✓ $(basename $(dirname $f))/$(basename $f)" \
    || echo "○ $(basename $(dirname $f))/$(basename $f) (sin transcript)"
done
```

### Tail running sync

```bash
tail -f /tmp/sync*.log
pgrep -fl "scripts/sync.ts"
```

### TFM anuncios watcher

```bash
# Single poll for testing
unir --profile vidama anuncios watch trabajo-fin-de-master \
  --interval 6h --notify whatsapp --once

# Drop --once and run as a daemon (kai-autopilot can schedule it)
unir --profile vidama anuncios watch trabajo-fin-de-master \
  --interval 6h --notify whatsapp
```

Notifies via Kapso WhatsApp at the operator's phone when a new discussion
appears in the TFM forum.

### Panorama (qué hay)

```bash
unir --profile vidama cursos list
unir --profile vidama cursos info gobierno-del-dato-y-toma-de-decisiones
unir --profile vidama anuncios list trabajo-fin-de-master | head
```

## Trust ladder

Low-stakes domain. Read-only towards UNIR; only writes to local repos and
Vercel.

| Level | Examples | Friction |
|-------|----------|----------|
| **T0 (auto)** | `unir cursos list`, `auth status`, `temas list`, `clases list`, `anuncios list/show`, `unir doctor`, `bun run build`, coverage checks | None |
| **T1 (note)** | `bun run sync` (read UNIR + write to ~/Library + write to repo), `unir temas pull`, `unir clases pull`, `unir auth refresh` | Log only |
| **T2 (confirm)** | `unir auth login` (fresh creds), `vercel deploy --prod`, `git push`, anything with `--force` that re-spends LLM tokens or ElevenLabs credits | Show preview, await user "yes" |
| **T3 (killswitch)** | NONE — the CLI is read-only towards UNIR. |

Pass `--yes` to skip T2 confirmations in scripted flows. Use `--dry-run` first
when unsure.

## Common gotchas

1. **agent-browser daemon stale.** The persistent session-named browser is
   shared across CLI invocations. If the previous command left the tab on
   `cms.unir.net` or another sub-app, the next `unir temas list` LTI launch
   resumes on the stale view, parses empty, and returns 0 temas. **Always
   bounce to `/my/` first**:
   `agent-browser --session-name unir-vidama open https://campusonline.unir.net/my/`
   then `sleep 5`.

2. **Cookies expire ~90 min of inactivity.** After expiry the next CLI call
   returns `auth-expired`. Re-run `unir auth login` from scratch (refresh
   sometimes works, sometimes not because Akamai resets state).

3. **Akamai "Access Denied" page in agent-browser.** Kill the browser daemon
   and start fresh:
   ```bash
   agent-browser close --all
   pkill -f agent-browser
   ```

4. **Whisper local is slow but free.** `trx --backend local` ~3-5 min per
   14-min clase on M-series Mac. ElevenLabs Scribe (`--backend openai`) is
   ~1-2 min but spends credits. Hunter's default: local. Switch only when
   quality > cost.

5. **`--skip-clases` does NOT skip reading existing transcripts** (fixed in
   commit `811d68e`). `pickClaseFromDisk` parses filenames like
   `clase-N-NN-MM-slug.txt` to recover clase metadata without needing the
   live playlist. Don't regress this when refactoring.

6. **Vercel GitHub auto-deploy is broken for vidama-curso.** GitHub App for
   `crafter-station` doesn't have access to `Railly/vidama-curso` (private
   under personal account). Push to main triggers an error deploy with
   "account configuration" hint. **Workaround: manual `vercel deploy --prod
   -y --no-wait --scope crafter-station`** until the GitHub App scope is
   fixed.

7. **pdf-parse v2 native resolver fails inside the bun-compiled CLI binary.**
   Symptom: `Cannot find module './pdf.js/v1.10.100/build/pdf.js'` when
   calling `unir temas extract`. Fix in place: `vidama-curso/scripts/sync.ts`
   calls pdf-parse **directly** (not via the CLI) using the `PDFParse` class
   from v2. The CLI's `temas extract` command still uses the broken path; the
   site script bypasses it. Don't try to "fix" extract from the CLI without
   understanding this.

8. **Don't move processing logic back into the CLI.** The CLI is an adapter.
   The pipeline lives in `vidama-curso/scripts/sync.ts`. Keep the separation
   clean: CLI reads UNIR, site builds the experience.

9. **Starlight `defaultLocale: "es"` breaks the autogenerate sidebar.** It
   prefixes every URL with `/es/` while pages still build at `/`. Symptom:
   sidebar groups expand but show no items. Fix in place: `astro.config.mjs`
   uses `defaultLocale: "root"` with `root.lang: "es"`. **Don't change this**
   without re-checking the sidebar.

10. **CLI binary lives at `~/.bun/bin/unir`** (linked locally via `bun link`).
    If you re-install from npm (`bun install -g @crafter/unir-cli`), the local
    link is replaced. After local `bun run build`, run `bun link` again to use
    your dev version.

## File layout (for orientation)

```
~/Library/Application Support/unir/
├── profiles/vidama.json                     # active profile
├── sessions/vidama.json                     # auth bundle (cookies + sesskey)
├── data/vidama/<courseSlug>/
│   ├── meta.json
│   ├── temario/tema-NN-*.pdf
│   ├── clases/clase-NN-NN.NN-*.mp4
│   ├── transcripts/clase-NN-NN.NN-*.{txt,wav,wav.srt}
│   └── derivados/{tema-NN-raw.md, tema-NN-resumen.md, tema-NN.mp3}
└── audit/<YYYY-MM-DD>.jsonl

~/Programming/railly/vidama-curso/
├── astro.config.mjs                         # Starlight config (defaultLocale: "root")
├── scripts/
│   ├── sync.ts                              # pipeline orchestrator
│   └── lib/{codex,elevenlabs,unir,render}.ts
├── src/
│   ├── components/{AudioPlayer,ContentTabs,CopyClaseButton}.astro
│   ├── content/docs/<courseSlug>/{index,tema-NN}.mdx
│   └── styles/custom.css                    # pinky palette + tabs
└── public/{audio,pdf}/<courseSlug>/         # generated assets (committed)
```

## Recommended sequencing

When Hunter says "sincroniza UNIR" / "procesa el tema N":

1. `agent-browser --session-name unir-vidama open https://campusonline.unir.net/my/`
   (gotcha 1).
2. `unir --profile vidama auth status`. If expired → `unir auth login`.
3. `cd ~/Programming/railly/vidama-curso && bun run sync [args]`.
4. `bun run build`.
5. `vercel deploy --prod -y --no-wait --scope crafter-station`.
6. Report deploy URL + tema count + any temas without transcript.

When Hunter says "qué falta procesar" / "coverage":

1. Run the coverage one-liner from the Coverage check section.
2. Report counts: total temas, with transcript, without transcript, by curso.
3. If asked, suggest the next sync command for missing temas.

When Hunter says "TFM watcher":

1. Verify auth (`unir auth status`).
2. Run `unir anuncios watch trabajo-fin-de-master --interval 6h --notify
   whatsapp --once` first to validate the flow.
3. If clean, drop `--once` and run as a daemon.

When Hunter says "deploy vidama" / "deploy":

1. `cd ~/Programming/railly/vidama-curso && git status` (check repo is clean).
2. `bun run build`.
3. `vercel deploy --prod -y --no-wait --scope crafter-station`.
4. Report the deploy URL.

## Defensive prompts

- **Before any T2:** show the preview / `--dry-run` first.
- **Before `bun run sync --force`:** confirm with Hunter — `--force`
  re-spends codex tokens (free with subscription) AND ElevenLabs credits
  (paid). Use `--force-render` if only the MDX template changed.
- **Before `vercel deploy --prod`:** verify the build passed locally
  (`bun run build`).
- **If Akamai blocks repeatedly:** stop retrying. Bounce the browser daemon,
  re-run `unir auth login`. If it still fails, ask Hunter to login manually
  in the headed browser and resume.
- **If `codex` is rate-limited or model unavailable:** report it and wait.
  Don't fall back silently to a different model — Hunter wants the canonical
  pipeline output.

## Reference repos

- **`Railly/qf-academia-curso`** — precedent site Hunter built for his mom.
  AudioPlayer + ContentTabs + CopyClaseButton components originated here. Tab
  styling in vidama-curso is inspired by qf's custom.css.
- **`Railly/wiener-cli`** — sibling pattern for "agent-first CLI for student
  portal" (Norbert Wiener, Peru). Reference for the recon/shaping/scaffold/
  skill-draft 4-doc structure.
- **`crafter-research/sunat-cli`** — same agent-first pattern for SUNAT (tax).
  Inspiration for the LATAM gov-tech adapter family.
- **`crafter-station/trx`** — wraps whisper / ElevenLabs Scribe. vidama-curso
  depends on this for transcripts.
- **`cligentic.railly.dev`** — shadcn-style block registry. unir-cli uses 18
  blocks from here (banner, json-mode, error-map, audit-log, xdg-paths, etc).

## State files

- CLI: `@crafter/unir-cli@0.2.3` on npm, `Railly/unir-cli` on GitHub.
- Site: `Railly/vidama-curso` (private), live at <https://vidama-curso.vercel.app>.
- Project handoff: `04_Projects/_active/unir-cli/PROJECT.md` in hunter-brain
  (read first when in doubt).
- Recon notes: `04_Projects/_active/unir-cli/recon.md` in hunter-brain
  (endpoint mapping).

## When this should be archived

Move to `_archive/` only when **all three** are true:

1. The student has graduated (last semester ends approximately 2027).
2. Hunter is no longer running the sync (deferred indefinitely or handed off).
3. There's no plan to recycle the pipeline for another student / another
   master.

Until then, this lives in `_active/`.
