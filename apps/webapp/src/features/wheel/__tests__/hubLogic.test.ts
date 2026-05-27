import { describe, expect, it } from "vitest";

import { isHubInteractive } from "../hubLogic";

describe("isHubInteractive", () => {
  it("is interactive in idle when a handler is wired and the wheel has segments", () => {
    expect(
      isHubInteractive({ state: "idle", segmentCount: 6, hasHandler: true }),
    ).toBe(true);
  });

  it("stays interactive in settled — the post-spin tap re-spins the wheel", () => {
    // Regression: the hub was only enabled on the first spin; after the
    // result settled, only the secondary button below the wheel worked.
    expect(
      isHubInteractive({ state: "settled", segmentCount: 6, hasHandler: true }),
    ).toBe(true);
  });

  it("is dead while the wheel is mid-spin", () => {
    expect(
      isHubInteractive({ state: "spinning", segmentCount: 6, hasHandler: true }),
    ).toBe(false);
  });

  it("is dead when no spin handler is wired (guest in a host_only room)", () => {
    // Regression: in host_only rooms, RoomPage passes onSpinClick={undefined}
    // for non-host participants. The hub showed the SPIN label + breath
    // animation anyway, inviting a tap that did nothing.
    expect(
      isHubInteractive({ state: "idle", segmentCount: 6, hasHandler: false }),
    ).toBe(false);
    expect(
      isHubInteractive({ state: "settled", segmentCount: 6, hasHandler: false }),
    ).toBe(false);
  });

  it("is dead when the wheel has fewer than two segments", () => {
    expect(
      isHubInteractive({ state: "idle", segmentCount: 1, hasHandler: true }),
    ).toBe(false);
    expect(
      isHubInteractive({ state: "idle", segmentCount: 0, hasHandler: true }),
    ).toBe(false);
  });
});
