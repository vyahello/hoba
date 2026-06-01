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
    useSettings.setState({ sound: true, haptics: true, music: true, anonymousDefault: false });
  });

  it("applies + persists the sound toggle to audio and the server", () => {
    useSettings.getState().setSound(false);
    expect(audioSetEnabled).toHaveBeenLastCalledWith(false);
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

  it("persists anonymous-default to the server with no client side effect", () => {
    useSettings.getState().setAnonymousDefault(true);
    expect(patchMe).toHaveBeenCalledWith({ is_anonymous_default: true });
    expect(useSettings.getState().anonymousDefault).toBe(true);
  });

  it("applies + persists the music toggle to the audio bed and the server", () => {
    useSettings.getState().setMusic(false);
    expect(audioSetMusicEnabled).toHaveBeenLastCalledWith(false);
    expect(patchMe).toHaveBeenCalledWith({ music_enabled: false });
    expect(useSettings.getState().music).toBe(false);
  });

  it("hydrate reconciles all four from the server (server wins)", async () => {
    getMe.mockResolvedValueOnce({
      language_code: "en",
      sound_enabled: false,
      haptics_enabled: false,
      music_enabled: false,
      is_anonymous_default: true,
    });
    await useSettings.getState().hydrate();
    expect(audioSetEnabled).toHaveBeenLastCalledWith(false);
    expect(setHapticsEnabled).toHaveBeenLastCalledWith(false);
    expect(audioSetMusicEnabled).toHaveBeenLastCalledWith(false);
    expect(useSettings.getState()).toMatchObject({
      sound: false,
      haptics: false,
      music: false,
      anonymousDefault: true,
    });
  });
});
