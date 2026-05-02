// Slug derivation for course names. UNIR fullnames are like:
//   "Gobierno del Dato y Toma de Decisiones (VIDAMA - J) - PER14059 OCT2025"
// We strip the program/promotion suffix, lowercase, kebab.

export function courseSlug(fullname: string): string {
  // Drop "(...)" and trailing "- PER..." segments
  const noParens = fullname.replace(/\s*\([^)]*\)\s*/g, " ");
  const stripped = noParens.replace(/\s*-\s*PER\d+.*$/i, "").trim();

  return stripped
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
