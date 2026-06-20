/**
 * Pull an emoji out of a free-text option label so it can render BIG on the
 * wheel (the dedicated `emoji` slot, ~26px) instead of small inline text.
 *
 * Used as a fallback when the user types an emoji into the label rather than
 * the dedicated emoji field. Handles the cases people actually paste:
 *   - flags / regional-indicator pairs (🇺🇦, 🇮🇹),
 *   - skin-tone modifiers (👍🏽),
 *   - ZWJ sequences incl. non-obvious ones (😶‍🌫️ Face in Clouds, families),
 *   - keycaps (1️⃣) and variation-selector forms.
 *
 * Emoji-only labels (e.g. "🍕") are left untouched — there'd be no text left,
 * and the cleaned-segment filter drops empty labels.
 */

// One emoji grapheme: a flag pair, OR a pictographic base + optional skin-tone
// modifier + optional ZWJ chain (each link itself optionally skin-toned) +
// optional variation-selector (U+FE0F) / combining keycap (U+20E3). Escapes
// used for the invisible joiners so the source stays readable.
const EMOJI_RE =
  /\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}\p{Emoji_Modifier}?)*[\u{FE0F}\u{20E3}]?/gu;

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
 *  ZWJ / skin-toned sequences, and reject plain letters). */
export function isSingleEmoji(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  const matches = t.match(EMOJI_RE);
  return matches !== null && matches.join("") === t;
}

/**
 * The LAST emoji grapheme in `text`, or undefined if there's none. The
 * single-emoji slot uses this so picking a new emoji REPLACES the previous one
 * (the OS appends into the field; we keep only the most recent emoji) and so
 * plain text typed into the slot is rejected. Custom ZWJ / skin-toned /
 * flag emojis are kept whole.
 */
export function lastEmoji(text: string): string | undefined {
  const matches = text.match(EMOJI_RE);
  if (matches === null || matches.length === 0) return undefined;
  return matches[matches.length - 1];
}
