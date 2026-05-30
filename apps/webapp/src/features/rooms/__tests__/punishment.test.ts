import { describe, expect, it } from "vitest";

import { type PunishmentCard, type RoomState } from "@/lib/api";

import {
  activeCard,
  allPresentLocked,
  doneCount,
  hasPendingCard,
  isEveryoneEscaped,
  isPunishment,
  lockedUserIds,
  myPrediction,
  pendingCards,
  punishmentPhase,
  waitingOnUserIds,
} from "../punishment";

const baseRoom = {
  code: "ABCDE",
  game_mode: "punishment",
} as RoomState["room"];

function makeSnap(over: Partial<RoomState["room"]>): RoomState {
  return {
    room: {
      ...baseRoom,
      ...over,
    },
    participants: [],
    me_user_id: 1,
  } as RoomState;
}

function card(over: Partial<PunishmentCard> = {}): PunishmentCard {
  return {
    text: "Do a dance",
    deck: "mild",
    card_index: 3,
    card_id: "mild-3",
    done: false,
    ...over,
  };
}

describe("punishment helpers", () => {
  it("isPunishment true for punishment mode", () => {
    expect(isPunishment(makeSnap({ game_mode: "punishment" }))).toBe(true);
  });

  it("isPunishment false for other modes", () => {
    expect(isPunishment(makeSnap({ game_mode: "classic" }))).toBe(false);
  });

  it("isPunishment false for null snapshot", () => {
    expect(isPunishment(null)).toBe(false);
  });

  it("doneCount reads count, 0 when absent", () => {
    expect(doneCount(makeSnap({ punishment_done_count: 2 }))).toBe(2);
    expect(doneCount(makeSnap({}))).toBe(0);
  });

  // STOPGAP: activeCard/hasPendingCard are inert until the RoomPage v2
  // rewrite (plan Task 10). They always report "no pending card".
  it("activeCard is inert (always null)", () => {
    expect(activeCard(makeSnap({ punishment_cards: { 2: card() } }))).toBeNull();
    expect(activeCard(null)).toBeNull();
  });

  it("hasPendingCard is inert (always false)", () => {
    expect(hasPendingCard(makeSnap({ punishment_cards: { 2: card() } }))).toBe(
      false,
    );
  });
});

describe("punishmentPhase", () => {
  it("predicting when cards null", () => {
    expect(punishmentPhase(makeSnap({ punishment_cards: null }))).toBe(
      "predicting",
    );
  });

  it("predicting when cards field absent", () => {
    expect(punishmentPhase(makeSnap({}))).toBe("predicting");
  });

  it("predicting for null snapshot", () => {
    expect(punishmentPhase(null)).toBe("predicting");
  });

  it("resolved when cards has losers", () => {
    expect(
      punishmentPhase(makeSnap({ punishment_cards: { 2: card() } })),
    ).toBe("resolved");
  });

  it("resolved when everyone escaped (cards is empty object)", () => {
    expect(punishmentPhase(makeSnap({ punishment_cards: {} }))).toBe(
      "resolved",
    );
  });
});

describe("lockedUserIds", () => {
  it("returns the locked ids", () => {
    expect(
      lockedUserIds(makeSnap({ punishment_locked_user_ids: [2, 5] })),
    ).toEqual([2, 5]);
  });

  it("empty when absent", () => {
    expect(lockedUserIds(makeSnap({}))).toEqual([]);
  });

  it("empty for null snapshot", () => {
    expect(lockedUserIds(null)).toEqual([]);
  });
});

describe("myPrediction", () => {
  it("returns the viewer's pick", () => {
    expect(myPrediction(makeSnap({ punishment_my_prediction: 9 }))).toBe(9);
  });

  it("null when absent", () => {
    expect(myPrediction(makeSnap({}))).toBeNull();
  });

  it("null for null snapshot", () => {
    expect(myPrediction(null)).toBeNull();
  });
});

describe("pendingCards", () => {
  it("empty while predicting (cards null)", () => {
    expect(pendingCards(makeSnap({ punishment_cards: null }))).toEqual([]);
  });

  it("empty for null snapshot", () => {
    expect(pendingCards(null)).toEqual([]);
  });

  it("empty when everyone escaped (cards {})", () => {
    expect(pendingCards(makeSnap({ punishment_cards: {} }))).toEqual([]);
  });

  it("maps loser entries to {userId, ...card} with numeric ids", () => {
    const result = pendingCards(
      makeSnap({
        punishment_cards: {
          2: card({ text: "Sing", card_index: 1, card_id: "mild-1" }),
          7: card({
            text: "Hop",
            card_index: 2,
            card_id: "mild-2",
            done: true,
          }),
        },
      }),
    );
    expect(result).toEqual([
      {
        userId: 2,
        text: "Sing",
        deck: "mild",
        card_index: 1,
        card_id: "mild-1",
        done: false,
      },
      {
        userId: 7,
        text: "Hop",
        deck: "mild",
        card_index: 2,
        card_id: "mild-2",
        done: true,
      },
    ]);
  });
});

describe("isEveryoneEscaped", () => {
  it("true when a real round resolved with no losers", () => {
    expect(
      isEveryoneEscaped(
        makeSnap({
          punishment_cards: {},
          punishment_predictions: { 1: 3, 2: 3 },
        }),
      ),
    ).toBe(true);
  });

  it("false while predicting (cards null)", () => {
    expect(
      isEveryoneEscaped(
        makeSnap({
          punishment_cards: null,
          punishment_predictions: null,
        }),
      ),
    ).toBe(false);
  });

  it("false when resolved with losers", () => {
    expect(
      isEveryoneEscaped(
        makeSnap({
          punishment_cards: { 2: card() },
          punishment_predictions: { 1: 3, 2: 9 },
        }),
      ),
    ).toBe(false);
  });

  it("false when cards empty but no round ran (predictions empty)", () => {
    expect(
      isEveryoneEscaped(
        makeSnap({
          punishment_cards: {},
          punishment_predictions: {},
        }),
      ),
    ).toBe(false);
  });
});

describe("allPresentLocked", () => {
  it("true when every present id is locked", () => {
    expect(
      allPresentLocked(
        makeSnap({ punishment_locked_user_ids: [1, 2, 3] }),
        [1, 2],
      ),
    ).toBe(true);
  });

  it("false when someone present has not locked", () => {
    expect(
      allPresentLocked(makeSnap({ punishment_locked_user_ids: [1] }), [1, 2]),
    ).toBe(false);
  });

  it("false when nobody is present", () => {
    expect(
      allPresentLocked(makeSnap({ punishment_locked_user_ids: [1, 2] }), []),
    ).toBe(false);
  });
});

describe("waitingOnUserIds", () => {
  it("returns present ids that have not locked", () => {
    expect(
      waitingOnUserIds(
        makeSnap({ punishment_locked_user_ids: [1] }),
        [1, 2, 3],
      ),
    ).toEqual([2, 3]);
  });

  it("empty when all present are locked", () => {
    expect(
      waitingOnUserIds(
        makeSnap({ punishment_locked_user_ids: [1, 2] }),
        [1, 2],
      ),
    ).toEqual([]);
  });

  it("returns all present when nobody locked", () => {
    expect(waitingOnUserIds(makeSnap({}), [4, 5])).toEqual([4, 5]);
  });
});
