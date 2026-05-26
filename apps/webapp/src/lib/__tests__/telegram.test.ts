import { describe, expect, it } from "vitest";

import {
  buildRoomInviteLink,
  extractStartParam,
  parseRoomDeepLink,
} from "@/lib/startParam";

describe("extractStartParam", () => {
  it("returns SDK value when present", () => {
    expect(
      extractStartParam({
        sdkStartParam: "room_ABC123",
        hash: "",
        search: "",
      }),
    ).toBe("room_ABC123");
  });

  it("falls back to tgWebAppStartParam from URL hash when SDK missing", () => {
    // Modern Telegram (Direct Link Mini Apps) puts start_param at the
    // top level of the hash, not inside tgWebAppData — @twa-dev/sdk
    // v7.10.1 doesn't pick that up. This fallback is what makes the
    // share-deep-link land.
    expect(
      extractStartParam({
        sdkStartParam: undefined,
        hash: "#tgWebAppStartParam=room_XYZ789&tgWebAppVersion=7.0",
        search: "",
      }),
    ).toBe("room_XYZ789");
  });

  it("URL-decodes the hash value", () => {
    expect(
      extractStartParam({
        sdkStartParam: undefined,
        hash: "#tgWebAppStartParam=room_with%20space",
        search: "",
      }),
    ).toBe("room_with space");
  });

  it("falls back to ?startapp= query param (dev browser entry)", () => {
    expect(
      extractStartParam({
        sdkStartParam: undefined,
        hash: "",
        search: "?startapp=room_DEV01",
      }),
    ).toBe("room_DEV01");
  });

  it("prefers SDK over hash over query", () => {
    expect(
      extractStartParam({
        sdkStartParam: "from_sdk",
        hash: "#tgWebAppStartParam=from_hash",
        search: "?startapp=from_query",
      }),
    ).toBe("from_sdk");
    expect(
      extractStartParam({
        sdkStartParam: undefined,
        hash: "#tgWebAppStartParam=from_hash",
        search: "?startapp=from_query",
      }),
    ).toBe("from_hash");
  });

  it("returns undefined when nothing present", () => {
    expect(
      extractStartParam({ sdkStartParam: undefined, hash: "", search: "" }),
    ).toBeUndefined();
  });

  it("treats empty values as missing", () => {
    expect(
      extractStartParam({
        sdkStartParam: "",
        hash: "#tgWebAppStartParam=",
        search: "?startapp=",
      }),
    ).toBeUndefined();
  });

  it("ignores unrelated hash params", () => {
    expect(
      extractStartParam({
        sdkStartParam: undefined,
        hash: "#tgWebAppVersion=7.0&tgWebAppPlatform=ios",
        search: "",
      }),
    ).toBeUndefined();
  });
});

describe("parseRoomDeepLink", () => {
  it("extracts uppercased room code from room_ prefix", () => {
    expect(parseRoomDeepLink("room_abc123")).toBe("ABC123");
    expect(parseRoomDeepLink("room_ABC123")).toBe("ABC123");
  });

  it("returns undefined for non-room start params", () => {
    expect(parseRoomDeepLink("wheel_42")).toBeUndefined();
    expect(parseRoomDeepLink("invalid")).toBeUndefined();
    expect(parseRoomDeepLink("")).toBeUndefined();
  });

  it("rejects an empty code after the prefix", () => {
    expect(parseRoomDeepLink("room_")).toBeUndefined();
    expect(parseRoomDeepLink("room_   ")).toBeUndefined();
  });
});

describe("buildRoomInviteLink", () => {
  it("builds menu-button form when no app short name is configured", () => {
    expect(
      buildRoomInviteLink({
        roomCode: "ABC123",
        botUsername: "hobagame_bot",
        appShortName: undefined,
      }),
    ).toBe("https://t.me/hobagame_bot?startapp=room_ABC123");
  });

  it("builds direct-link-mini-app form when short name is configured", () => {
    expect(
      buildRoomInviteLink({
        roomCode: "ABC123",
        botUsername: "hobagame_bot",
        appShortName: "play",
      }),
    ).toBe("https://t.me/hobagame_bot/play?startapp=room_ABC123");
  });

  it("uppercases the room code (codes are case-insensitive on the wire)", () => {
    expect(
      buildRoomInviteLink({
        roomCode: "abc123",
        botUsername: "hobagame_bot",
        appShortName: undefined,
      }),
    ).toBe("https://t.me/hobagame_bot?startapp=room_ABC123");
  });
});
