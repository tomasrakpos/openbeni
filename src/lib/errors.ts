/**
 * Remove API-key-shaped tokens from any text that reaches the UI, a log, or an
 * export. The server also scrubs its own pool, but BYOK errors can echo a key
 * from an upstream gateway, so the client applies a final textual guard.
 */
const KEY_PATTERNS: RegExp[] = [
  /\bcoa_[A-Za-z0-9]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bgsk_[A-Za-z0-9]{8,}\b/g,
  /\bhf_[A-Za-z0-9]{8,}\b/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

export function localizeError(
  message: string | undefined,
  t: (key: string) => string,
): string {
  if (!message) return t("error.generic");
  if (/^(error|attach|providers|settings|chat)\./.test(message)) return t(message);
  return redactSecrets(message);
}
