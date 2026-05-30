import { describe, expect, it } from "vitest";

import { type RoomState, type ServerRoom } from "@/lib/api";
import {
  allPresentBet,
  bettorIds,
  doneCount,
  isMyPunishment,
  isPunishment,
  lastOutcome,
  matchCount,
  matchesToWin,
  myBet,
  pendingPunishment,
  punishmentPhase,
  waitingOnBetIds,
  winnerUserId,
} from "../punishment";

function makeRoom(overrides: Partial<ServerRoom> = {}): ServerRoom {
  return {
    id: 1,
    code: "ABC123",
    host_id: 10,
    title: null,
    status: "active",
    game_mode: "punishment",
    spin_policy: "turn_based",
    suggestion_policy: "off",
    is_locked: false,
    is_anonymous: false,
    current_turn_user_id: null,
    punishment_deck: "mild",
    punishment_done_count: 0,
    punishment_bets: null,
    punishment_match_counts: null,
    punishment_winner_user_id: null,
    punishment_last_outcome: null,
    spin_count: 3,
    bon_attempts: 0,
    bon_tally: null,
    bon_winner_segment_id: null,
    created_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function snap(room: ServerRoom, meUserId = 10): RoomState {
  return {
    room,
    participants: [],
    active_question: null,
    last_spin: null,
    me_user_id: meUserId,
  };
}

describe("punishment v3 helpers", () => {
  it("isPunishment true only for punishment mode", () => {
    expect(isPunishment(snap(makeRoom()))).toBe(true);
    expect(isPunishment(snap(makeRoom({ game_mode: "classic" })))).toBe(false);
  });

  it("punishmentPhase: betting in lobby, playing when active, over with winner", () => {
    expect(punishmentPhase(snap(makeRoom({ status: "lobby" })))).toBe("betting");
    expect(punishmentPhase(snap(makeRoom({ status: "active" })))).toBe("playing");
    expect(
      punishmentPhase(snap(makeRoom({ punishment_winner_user_id: 7 }))),
    ).toBe("over");
  });

  it("myBet returns the viewer's own bet", () => {
    const room = makeRoom({ punishment_bets: { "10": 5, "11": 6 } });
    expect(myBet(snap(room, 10))).toBe(5);
    expect(myBet(snap(room, 11))).toBe(6);
    expect(myBet(snap(makeRoom()))).toBeNull();
  });

  it("bettorIds returns sorted bettor ids", () => {
    const room = makeRoom({ punishment_bets: { "2": 1, "1": 3 } });
    expect(bettorIds(snap(room))).toEqual([1, 2]);
  });

  it("matchCount + matchesToWin", () => {
    const room = makeRoom({
      punishment_match_counts: { "1": 2 },
      spin_count: 5,
    });
    expect(matchCount(snap(room), 1)).toBe(2);
    expect(matchCount(snap(room), 9)).toBe(0);
    expect(matchesToWin(snap(room))).toBe(5);
    // spin_count 1 = first correct guess wins (host may pick 1 attempt).
    expect(matchesToWin(snap(makeRoom({ spin_count: 1 })))).toBe(1);
  });

  it("winnerUserId + doneCount", () => {
    expect(winnerUserId(snap(makeRoom({ punishment_winner_user_id: 7 })))).toBe(7);
    expect(doneCount(snap(makeRoom({ punishment_done_count: 4 })))).toBe(4);
  });

  it("lastOutcome + pendingPunishment", () => {
    const lucky = makeRoom({
      punishment_last_outcome: {
        spinner_id: 1,
        result_segment_id: 5,
        kind: "lucky",
        card: null,
        resolved: true,
      },
    });
    expect(lastOutcome(snap(lucky))?.kind).toBe("lucky");
    expect(pendingPunishment(snap(lucky))).toBeNull(); // lucky never pends

    const punish = makeRoom({
      punishment_last_outcome: {
        spinner_id: 2,
        result_segment_id: 5,
        kind: "punish",
        card: { text: "dare", deck: "mild", card_index: 0 },
        resolved: false,
      },
    });
    expect(pendingPunishment(snap(punish))?.card?.text).toBe("dare");
    // Resolved punish no longer pends.
    const resolved = makeRoom({
      punishment_last_outcome: {
        spinner_id: 2,
        result_segment_id: 5,
        kind: "punish",
        card: { text: "dare", deck: "mild", card_index: 0 },
        resolved: true,
      },
    });
    expect(pendingPunishment(snap(resolved))).toBeNull();
  });

  it("isMyPunishment true only for the spinner with a pending dare", () => {
    const room = makeRoom({
      punishment_last_outcome: {
        spinner_id: 2,
        result_segment_id: 5,
        kind: "punish",
        card: { text: "dare", deck: "mild", card_index: 0 },
        resolved: false,
      },
    });
    expect(isMyPunishment(snap(room, 2))).toBe(true);
    expect(isMyPunishment(snap(room, 3))).toBe(false);
  });

  it("allPresentBet true when every present id bet", () => {
    const room = makeRoom({ punishment_bets: { "1": 3, "2": 4 } });
    expect(allPresentBet(snap(room), [1, 2])).toBe(true);
    expect(allPresentBet(snap(room), [1, 2, 3])).toBe(false);
    expect(allPresentBet(snap(makeRoom()), [])).toBe(false);
  });

  it("waitingOnBetIds returns present ids without a bet", () => {
    const room = makeRoom({ punishment_bets: { "2": 4 } });
    expect(waitingOnBetIds(snap(room), [1, 2, 3])).toEqual([1, 3]);
  });
});
