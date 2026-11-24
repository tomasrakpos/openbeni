// Dynamic loader for the Persian Vazirmatn font subset so English first-loads
// never download Persian font assets until Persian language or script is used.

const PERSIAN_ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

let loadPromise: Promise<unknown> | null = null;

export function containsPersianOrArabic(text: string | null | undefined): boolean {
  return Boolean(text && PERSIAN_ARABIC_RE.test(text));
}

export function ensurePersianFont(): void {
  if (typeof document === "undefined" || loadPromise) return;
  loadPromise = import("@/styles/vazirmatn.css").catch(() => {
    loadPromise = null;
  });
}
