import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the side-effect targets so we can assert the store wires them.
// `vi.hoisted` so the fns exist when the hoisted `vi.mock` factories run.
const {
  audioSetEnabled, audioSetMusicEnabled, setHapticsEnabled, setLocale, getLocale, patchMe, getMe,
} = vi.hoisted(() => ({
  audioSetEnabled: vi.fn(),
  audioSetMusicEnabled: vi.fn(),
  setHapticsEnabled: vi.fn(),
  setLocale: vi.fn(),
  getLocale: vi.fn(() => "en"),
  patchMe: vi.fn(() => Promise.resolve({})),
  getMe: vi.fn(),
}));

vi.mock("@/audio", () => ({
  audio: { setEnabled: audioSetEnabled, setMusicEnabled: audioSetMusicEnabled },
}));
vi.mock("@/lib/haptics", () => ({ setHapticsEnabled }));
vi.mock("@/i18n", () => ({ setLocale, getLocale }));
vi.mock("@/lib/api", () => ({ api: { patchMe, getMe } }));

import { useSettings } from "../settings";

describe("settings store", () => {
  beforeEach(() => {
    audioSetEnabled.mockClear();
    audioSetMusicEnabled.mockClear();
    setHapticsEnabled.mockClear();
    setLocale.mockClear();
    patchMe.mockClear();
    getMe.mockClear();
    // Reset to defaults between tests.
    useSettings.setState({ sound: true, haptics: true });
  });

  it("sound toggle gates BOTH sfx and music, and persists to the server", () => {
    useSettings.getState().setSound(false);
    expect(audioSetEnabled).toHaveBeenLastCalledWith(false);
    expect(audioSetMusicEnabled).toHaveBeenLastCalledWith(false);
    expect(patchMe).toHaveBeenCalledWith({ sound_enabled: false });
    expect(useSettings.getState().sound).toBe(false);
  });

  it("applies + persists the vibration toggle to haptics and the server", () => {
    useSettings.getState().setHaptics(false);
    expect(setHapticsEnabled).toHaveBeenLastCalledWith(false);
    expect(patchMe).toHaveBeenCalledWith({ haptics_enabled: false });
    expect(useSettings.getState().haptics).toBe(false);
  });

  it("setLanguage switches i18n AND persists language_code to the server", () => {
    useSettings.getState().setLanguage("uk");
    expect(setLocale).toHaveBeenCalledWith("uk");
    expect(patchMe).toHaveBeenCalledWith({ language_code: "uk" });
  });

  it("hydrate reconciles sound/haptics from the server (server wins), sound gating music", async () => {
    getMe.mockResolvedValueOnce({
      language_code: "en",
      sound_enabled: false,
      haptics_enabled: false,
    });
    await useSettings.getState().hydrate();
    expect(audioSetEnabled).toHaveBeenLastCalledWith(false);
    expect(setHapticsEnabled).toHaveBeenLastCalledWith(false);
    expect(audioSetMusicEnabled).toHaveBeenLastCalledWith(false);
    expect(useSettings.getState()).toMatchObject({
      sound: false,
      haptics: false,
    });
  });
});
