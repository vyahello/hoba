import { describe, expect, it } from "vitest";

import {
  DEFAULT_GAME_MODE,
  PICKABLE_GAME_MODES,
  getGameModeMeta,
  shouldShowBadge,
} from "../gameModes";

describe("PICKABLE_GAME_MODES", () => {
  it("has exactly 4 entries", () => {
    expect(PICKABLE_GAME_MODES).toHaveLength(4);
  });

  it("excludes Rigged (spec §5.5 reserves it for long-press reveal)", () => {
    expect(PICKABLE_GAME_MODES.map((m) => m.id)).not.toContain("rigged");
  });

  it("includes the 4 normal modes in display order", () => {
    expect(PICKABLE_GAME_MODES.map((m) => m.id)).toEqual([
      "classic",
      "elimination",
      "punishment",
      "chaos",
    ]);
  });

  it("every entry has an emoji and i18nKey", () => {
    for (const m of PICKABLE_GAME_MODES) {
      expect(m.emoji.length).toBeGreaterThan(0);
      expect(m.i18nKey).toMatch(/^modes\./);
    }
  });
});

describe("getGameModeMeta", () => {
  it("returns the entry for a pickable mode", () => {
    const meta = getGameModeMeta("elimination");
    expect(meta).toBeDefined();
    expect(meta?.id).toBe("elimination");
    expect(meta?.emoji).toBe("💥");
  });

  it("returns meta for rigged (host badge) but keeps it out of the picker", () => {
    const meta = getGameModeMeta("rigged");
    expect(meta?.id).toBe("rigged");
    expect(meta?.emoji).toBe("🎭");
    // Still excluded from the room-creation picker (entered via long-press).
    expect(PICKABLE_GAME_MODES.some((m) => m.id === "rigged")).toBe(false);
  });
});

describe("DEFAULT_GAME_MODE", () => {
  it("is classic (party-game default)", () => {
    expect(DEFAULT_GAME_MODE).toBe("classic");
  });
});

describe("shouldShowBadge", () => {
  it("returns true for elimination, punishment, chaos", () => {
    expect(shouldShowBadge("elimination")).toBe(true);
    expect(shouldShowBadge("punishment")).toBe(true);
    expect(shouldShowBadge("chaos")).toBe(true);
  });

  it("returns false for classic (default — no badge for boring case)", () => {
    expect(shouldShowBadge("classic")).toBe(false);
  });

  it("returns true for rigged (host sees the 🎭 badge; guests get redacted 'classic')", () => {
    expect(shouldShowBadge("rigged")).toBe(true);
  });
});
