import { describe, expect, it } from "vitest";

import { isSingleEmoji, lastEmoji, splitEmoji } from "@/features/wheel/emoji";

describe("splitEmoji", () => {
  it("lifts a leading emoji out of the label", () => {
    expect(splitEmoji("🍕 Піца")).toEqual({ emoji: "🍕", label: "Піца" });
  });

  it("lifts a trailing emoji too", () => {
    expect(splitEmoji("Pizza 🍕")).toEqual({ emoji: "🍕", label: "Pizza" });
  });

  it("returns no emoji for plain text", () => {
    expect(splitEmoji("Just words")).toEqual({ label: "Just words" });
  });

  it("leaves an emoji-only label intact (so it isn't dropped)", () => {
    expect(splitEmoji("🍕")).toEqual({ label: "🍕" });
  });

  it("takes the first emoji when several are present", () => {
    const out = splitEmoji("🔥 Spicy 🌶️");
    expect(out.emoji).toBe("🔥");
    expect(out.label).toBe("Spicy");
  });

  it("trims surrounding whitespace", () => {
    expect(splitEmoji("  🎮  PS5  ")).toEqual({ emoji: "🎮", label: "PS5" });
  });

  it("lifts a flag (regional-indicator pair)", () => {
    expect(splitEmoji("Мілан 🇮🇹")).toEqual({ emoji: "🇮🇹", label: "Мілан" });
  });

  it("lifts a ZWJ emoji like Face in Clouds", () => {
    expect(splitEmoji("😶‍🌫️ Fog")).toEqual({ emoji: "😶‍🌫️", label: "Fog" });
  });
});

describe("isSingleEmoji", () => {
  it("accepts a plain emoji, a flag, and a ZWJ emoji", () => {
    expect(isSingleEmoji("🍕")).toBe(true);
    expect(isSingleEmoji("🇺🇦")).toBe(true);
    expect(isSingleEmoji("😶‍🌫️")).toBe(true);
  });

  it("rejects text and empties", () => {
    expect(isSingleEmoji("pizza")).toBe(false);
    expect(isSingleEmoji("")).toBe(false);
    expect(isSingleEmoji("🍕 x")).toBe(false);
  });

  it("accepts a skin-toned emoji", () => {
    expect(isSingleEmoji("👍🏽")).toBe(true);
  });
});

describe("lastEmoji", () => {
  it("returns the most recent emoji (replace, not append)", () => {
    expect(lastEmoji("🙂😘")).toBe("😘");
  });

  it("keeps a skin-tone modifier whole", () => {
    expect(lastEmoji("👍🏽")).toBe("👍🏽");
  });

  it("keeps a flag and a ZWJ emoji whole", () => {
    expect(lastEmoji("🇺🇦")).toBe("🇺🇦");
    expect(lastEmoji("😶‍🌫️")).toBe("😶‍🌫️");
  });

  it("ignores plain text in the slot", () => {
    expect(lastEmoji("d")).toBeUndefined();
    expect(lastEmoji("🍕 x")).toBe("🍕");
  });

  it("is undefined for empty input", () => {
    expect(lastEmoji("")).toBeUndefined();
  });
});
