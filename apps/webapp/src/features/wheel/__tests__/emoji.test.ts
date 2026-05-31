import { describe, expect, it } from "vitest";

import { splitEmoji } from "@/features/wheel/emoji";

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
});
