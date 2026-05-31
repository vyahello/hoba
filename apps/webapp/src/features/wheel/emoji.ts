/**
 * Pull an emoji out of a free-text option label so it can render BIG on the
 * wheel (the dedicated `emoji` slot, ~26px) instead of small inline text.
 *
 * Used as a fallback when the user types an emoji into the label rather than
 * the dedicated emoji field. Handles the cases people actually paste:
 *   - flags / regional-indicator pairs (🇺🇦, 🇮🇹),
 *   - ZWJ sequences incl. non-obvious ones (😶‍🌫️ Face in Clouds, families),
 *   - keycaps (1️⃣) and variation-selector forms.
 *
 * Emoji-only labels (e.g. "🍕") are left untouched — there'd be no text left,
 * and the cleaned-segment filter drops empty labels.
 */

// Flag pair OR a pictographic base + optional ZWJ chain + optional
// variation-selector (U+FE0F) / combining keycap (U+20E3).
const EMOJI_RE =
  /\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*[️⃣]?/gu;

export interface SplitLabel {
  emoji?: string;
  label: string;
}

export function splitEmoji(text: string): SplitLabel {
  const trimmed = text.trim();
  const matches = trimmed.match(EMOJI_RE);
  if (matches === null) return { label: trimmed };
  const stripped = trimmed.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
  // Emoji-only label → keep it as the label so it isn't dropped downstream.
  if (stripped.length === 0) return { label: trimmed };
  return { emoji: matches[0], label: stripped };
}

/** True if the whole string is exactly one emoji (used to validate the
 *  dedicated emoji field — we accept any single grapheme emoji incl. custom
 *  ZWJ sequences, and reject plain letters). */
export function isSingleEmoji(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  const matches = t.match(EMOJI_RE);
  return matches !== null && matches.join("") === t;
}
