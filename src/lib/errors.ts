// UNIR-CLI error map. Built on top of the cligentic `error-map` block.
// Codes match those documented in shaping.md / skill-draft.md so agents
// can self-correct based on `error.code` + `hint`.

import { AppError, type ErrorMap } from "../cli/foundation/error-map";

export const UNIR_ERRORS = {
  "auth-required": {
    name: "AuthRequired",
    human: "No active UNIR session for this profile.",
    hint: "Run: unir auth login --profile <name>",
  },
  "auth-expired": {
    name: "AuthExpired",
    human: "Your UNIR session expired.",
    hint: "Run: unir auth refresh --profile <name>",
  },
  "auth-blocked": {
    name: "AuthBlocked",
    human: "UNIR / Akamai rejected the automated login.",
    hint: "Try: unir auth login --interactive (paste cookies manually).",
  },
  "course-not-found": {
    name: "CourseNotFound",
    human: "No enrolled course matches that id or slug.",
    hint: "Run: unir cursos list",
  },
  "course-ambiguous": {
    name: "CourseAmbiguous",
    human: "Multiple courses match — disambiguate.",
    hint: "Pass full id or use --exact.",
  },
  "tema-not-found": {
    name: "TemaNotFound",
    human: "That tema number does not exist in this course.",
    hint: "Run: unir temas list <courseId>",
  },
  "tema-not-yet-published": {
    name: "TemaNotYetPublished",
    human: "The tema appears in the syllabus but the PDF is not yet available.",
    hint: "Wait until UNIR publishes it. Check: unir cursos info <courseId>.",
  },
  "clase-not-found": {
    name: "ClaseNotFound",
    human: "That clase number does not exist in this course.",
    hint: "Run: unir clases list <courseId>",
  },
  "panopto-download-blocked": {
    name: "PanoptoDownloadBlocked",
    human: "This Panopto recording does not allow direct mp4 download.",
    hint: "Report to Hunter; may need to capture via browser.",
  },
  "ratelimit-throttled": {
    name: "RateLimitThrottled",
    human: "Internal throttle hit (1 req/s to UNIR).",
    hint: "Retry after a few seconds.",
  },
  "codex-not-installed": {
    name: "CodexNotInstalled",
    human: "Codex CLI is not on PATH.",
    hint: "Install: npm i -g @openai/codex (then `codex --version`).",
  },
  "trx-not-installed": {
    name: "TrxNotInstalled",
    human: "trx CLI is not on PATH.",
    hint: "Install: bun install -g @crafter/trx",
  },
  "elevenlabs-no-api-key": {
    name: "ElevenLabsNoApiKey",
    human: "ELEVENLABS_API_KEY env var is missing.",
    hint: "Export it in your shell rc and reload.",
  },
  "sitio-not-found": {
    name: "SitioNotFound",
    human: "vidama-curso (Astro site) repo not found at configured path.",
    hint: "Run: unir config sitePath <path>",
  },
  "sitio-uncommitted": {
    name: "SitioUncommitted",
    human: "Site repo has uncommitted changes.",
    hint: "Commit first, or pass --yes to override.",
  },
  "needs-confirmation": {
    name: "NeedsConfirmation",
    human: "This is a T2 command and needs --yes in non-interactive mode.",
    hint: "Add --yes to skip the prompt.",
  },
  "validation-error": {
    name: "ValidationError",
    human: "Invalid arguments.",
    hint: "Check: unir <command> --help",
  },
  "unknown-error": {
    name: "UnknownError",
    human: "Something unexpected went wrong.",
    hint: "Re-run with --verbose for details.",
  },
} as const satisfies ErrorMap;

export type UnirErrorCode = keyof typeof UNIR_ERRORS;

export function unirError(code: UnirErrorCode, cause?: unknown): AppError {
  return new AppError(code, UNIR_ERRORS[code], cause);
}
