/**
 * Pull an emoji out of a free-text option label so it can render BIG on the
 * wheel (the dedicated `emoji` slot, ~26px) instead of small inline text.
 *
 * Built-in presets ship a separate `emoji` field; custom wheels only have a
 * label, so a user typing "🍕 Pizza" otherwise gets a tiny inline glyph. We
 * lift the first emoji into `emoji` and strip emoji from the visible label.
 *
 * Emoji-only labels (e.g. "🍕") are left untouched — there'd be no text left,
 * and the cleaned-segment filter drops empty labels.
 */

// One emoji = a pictographic base + optional ZWJ (‍) sequence +
// optional variation selector (️) / combining keycap (⃣).
const EMOJI_RE = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*[️⃣]?/gu;

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
