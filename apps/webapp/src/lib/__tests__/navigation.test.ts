import { describe, expect, it, vi } from "vitest";

import { safeNavigateBack } from "../navigation";

describe("safeNavigateBack", () => {
  it("calls navigate(-1) when there is history to pop", () => {
    const navigate = vi.fn();
    safeNavigateBack(navigate, { historyLength: 3 });
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it("falls back to navigate('/') when history has a single entry", () => {
    // Deep-link entry path: RootLayout reads `start_param` and
    // navigates to /room/<CODE> with `replace: true`, so history
    // never grew past one entry. -1 would be a no-op — go home.
    const navigate = vi.fn();
    safeNavigateBack(navigate, { historyLength: 1 });
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("falls back to navigate('/') on the impossible historyLength === 0", () => {
    const navigate = vi.fn();
    safeNavigateBack(navigate, { historyLength: 0 });
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
