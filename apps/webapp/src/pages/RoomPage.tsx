import { AnimatePresence, motion, useAnimate } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { audio } from "@/audio";
import { AvatarStack } from "@/components/ds/AvatarStack";
import { Button } from "@/components/ds/Button";
import { fireConfetti } from "@/components/ds/ConfettiBurst";
import { HobaWord } from "@/components/ds/HobaWord";
import { IconButton } from "@/components/ds/IconButton";
import { IconSave, IconSettings, IconShare } from "@/components/ds/icons";
import { RealtimeIndicator } from "@/components/ds/RealtimeIndicator";
import { ResultBanner } from "@/components/ds/ResultBanner";
import { RoomCodePill } from "@/components/ds/RoomCodePill";
import { Skeleton } from "@/components/ds/Skeleton";
import { GameModeBadge } from "@/components/room/GameModeBadge";
import { FlyingReactions } from "@/components/room/FlyingReactions";
import { ReactionsBar } from "@/components/room/ReactionsBar";
import { RigEditorSheet } from "@/components/room/RigEditorSheet";
import { InviteSheet } from "@/components/room/InviteSheet";
import { RoomModePickerSheet } from "@/components/room/RoomModePickerSheet";
import { RoomSettingsSheet } from "@/components/room/RoomSettingsSheet";
import { WinnerOverlay } from "@/components/room/WinnerOverlay";
import {
  eliminatedSegments,
  isRoundOver,
  livingSegments,
  remainingCount,
} from "@/features/rooms/elimination";
import { buildRoamHops, CHAOS_EVENT_EMOJI, orderSegmentsForSpin } from "@/features/rooms/chaos";
import { computeCanSpin, isHost } from "@/features/rooms/permissions";
import {
  attempts as bonAttemptsCount,
  isBestOfN,
  roundOver as bonRoundOver,
  roundWinnerId,
  tally as bonTallyMap,
  target as bonTargetCount,
} from "@/features/rooms/bestOfN";
import {
  allPresentBet,
  approverUserId,
  bettorIds,
  isBetRace,
  isMyApproval,
  isMyPunishment,
  isPunishment,
  lastOutcome,
  matchCount,
  matchesToWin,
  myBet,
  pendingApproval,
  pendingPunishment,
  perPlayerDoneCount,
  punishmentPhase,
  waitingOnBetIds,
  winnerUserId,
} from "@/features/rooms/punishment";
import { computeTurnState } from "@/features/rooms/turnState";
import { Wheel, type WheelHandle } from "@/features/wheel/Wheel";
import { freshSeed } from "@/features/wheel/seededRandom";
import { segmentUnderPointer } from "@/features/wheel/spinMath";
import {
  type SegmentDef,
  type SpinResult,
  type WheelState,
} from "@/features/wheel/types";
import { type GameMode, type PunishmentDeck, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import {
  buildRoomInviteLink,
  confirmPopup,
  disableClosingConfirmation,
  enableClosingConfirmation,
  openTelegramLink,
} from "@/lib/telegram";
import {
  startPresenceLoop,
  stopPresenceLoop,
  useRoomStore,
} from "@/stores/room";
import { toast } from "@/stores/toast";
import { WHEEL_PALETTE } from "../../tailwind.config";

// Short beat between the wheel stopping and the result reveal — long
// enough to register the landed segment, short enough to feel instant.
const REVEAL_DELAY_MS = 400;
const ELIM_REVEAL_DELAY_MS = 400;
// Chaos (§5.4): how long the pre-spin event announcement card holds before
// the wheel is released — long enough to read the event.
const CHAOS_ANNOUNCE_MS = 2500;
// multi_spin: each short fast spin, and the final (result-bearing) spin.
const MULTI_SPIN_STEP_MS = 620;
const MULTI_SPIN_FINAL_MS = 2200;
// nudge_*: the "thinking" shake, then the one-sector creep to the new result.
const NUDGE_SHAKE_MS = 750;
const NUDGE_CREEP_MS = 900;
// earthquake: a violent tremor before the wheel breaks loose into the spin.
const QUAKE_SHAKE_MS = 950;
// fake_out: settle on a decoy, hold so everyone reacts, then creep to the real one.
const FAKE_OUT_HOLD_MS = 950;
const FAKE_OUT_CREEP_MS = 950;
// shuffle: visibly jump the segments through this many random orders (so the
// scramble is unmistakable) before settling on the real order, then spinning.
const SHUFFLE_SCRAMBLE_STEPS = 7;
const SHUFFLE_STEP_MS = 135;
// glitch: the final "recover" spin onto the real result after the stutter.
const GLITCH_RECOVER_MS = 1100;

/** A new array of `ids` in a random order that is never the identity (so a
 * `shuffle` scramble step always visibly moves). Client-only cosmetic. */
function shuffledIds(ids: number[]): number[] {
  if (ids.length < 2) return [...ids];
  const out = [...ids];
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [out[k], out[j]] = [out[j]!, out[k]!];
  }
  if (out.every((v, i) => v === ids[i])) [out[0], out[1]] = [out[1]!, out[0]!];
  return out;
}

/** Confetti palette biased to the winning segment's colour (dominant) + an
 * accent + a white sparkle, so the burst matches what landed. `undefined`
 * colour seed → undefined (fireConfetti falls back to the brand palette). */
function winnerColors(colorSeed: number | undefined): string[] | undefined {
  if (colorSeed === undefined) return undefined;
  const c = WHEEL_PALETTE[colorSeed % WHEEL_PALETTE.length] ?? "#7C5CFF";
  return [c, c, c, "#FFB84D", "#FFFFFF"];
}

export function RoomPage(): JSX.Element {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["room", "common"]);

  const connected = useRoomStore((s) => s.connected);
  const snapshot = useRoomStore((s) => s.snapshot);
  const currentSpin = useRoomStore((s) => s.currentSpin);
  const spinSettled = useRoomStore((s) => s.spinSettled);
  const lastError = useRoomStore((s) => s.lastError);
  const joinRoom = useRoomStore((s) => s.joinRoom);
  const leaveRoom = useRoomStore((s) => s.leaveRoom);
  const triggerSpin = useRoomStore((s) => s.triggerSpin);
  const resetRound = useRoomStore((s) => s.resetRound);
  const endedReason = useRoomStore((s) => s.endedReason);
  const clearEnded = useRoomStore((s) => s.clearEnded);

  const upperCode = code.toUpperCase();

  // The room ended from under us (host kicked me, or closed the room). Toast
  // the reason once, then go home. clearEnded prevents a re-fire.
  useEffect(() => {
    if (endedReason === null) return;
    toast({
      title: endedReason === "kicked" ? t("room:moderation.kicked") : t("room:moderation.closed"),
      intent: "info",
    });
    clearEnded();
    navigate("/", { replace: true });
  }, [endedReason, clearEnded, navigate, t]);

  useEffect(() => {
    joinRoom(upperCode);
    startPresenceLoop();
    return () => {
      stopPresenceLoop();
      leaveRoom();
    };
  }, [upperCode, joinRoom, leaveRoom]);

  const [wheelState, setWheelState] = useState<WheelState>("idle");
  const [revealed, setRevealed] = useState(false);
  // True when no spin is animating locally — i.e. the wheel has visually
  // landed (or there's no active spin). Server `spin:settled` patches (the
  // per-spin outcome text, the winner) arrive on the server's shorter timer
  // and can beat the local animation (Chaos adds an announce card + extra
  // spin phases the server doesn't wait for). Gating the snapshot-derived
  // result/winner UI on this keeps "what you got" + the winner popup from
  // showing before the wheel lands. Starts true so a rejoin into a finished
  // game shows the result immediately.
  const [spinLanded, setSpinLanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [rigOpen, setRigOpen] = useState(false);
  const [rigRevealShown, setRigRevealShown] = useState(false);
  const [savingWheel, setSavingWheel] = useState(false);
  // Chaos (§5.4): the rolled event for the in-flight spin while its 1.5 s
  // pre-roll announcement card is showing, then null once the wheel releases.
  const [chaosAnnounce, setChaosAnnounce] = useState<string | null>(null);
  // Chaos multi-phase choreography (multi_spin reps, nudge creep): a local
  // SpinResult that overrides the server one while the sequence plays.
  const [phaseSpin, setPhaseSpin] = useState<SpinResult | null>(null);
  // Chaos `shuffle`: a transient segment order shown while the wheel visibly
  // scrambles before the spin (null = use the real server order).
  const [scrambleOrder, setScrambleOrder] = useState<number[] | null>(null);
  // Chaos `fake_out`: the decoy segment id flashed as a "fake win" during the
  // hold, before the wheel creeps off it to the real winner.
  const [fakeWinId, setFakeWinId] = useState<string | null>(null);
  // Chaos `earthquake`: screen-shake the room content while the wheel convulses.
  const [quaking, setQuaking] = useState(false);
  // Chaos `glitch`: render the broken-wheel glitch overlay during the stutter.
  const [glitching, setGlitching] = useState(false);
  const wheelRef = useRef<WheelHandle>(null);
  // The active dare card — scrolled into view when a dare is dealt so the
  // punished player doesn't have to hunt for it below the fold.
  const dareCardRef = useRef<HTMLDivElement>(null);
  const luckyRef = useRef<HTMLDivElement>(null);
  // Latest rendered segments, read inside the spin choreography without making
  // it a hook dep (which would restart the animation when segments change).
  const segmentsRef = useRef<SegmentDef[]>([]);

  // Shatter thunk: when a segment is eliminated, briefly compress the wheel
  // (scale 1 → 0.97 → 1, ~300 ms) so players feel the winner "pop off".
  const [wheelScope, animateWheel] = useAnimate();

  // Active rooms only — a closed swipe mid-spin would orphan everyone
  // else in the room. Lobby is fine to back out of.
  const roomStatus = snapshot?.room.status;
  useEffect(() => {
    if (roomStatus !== "active") return undefined;
    enableClosingConfirmation();
    return () => {
      disableClosingConfirmation();
    };
  }, [roomStatus]);

  // Elimination view-state — derived above the effects so the reveal
  // flow can branch on it (classic celebrates; elimination just flags
  // what's out and saves the celebration for the final survivor).
  const isElimination = snapshot?.room.game_mode === "elimination";
  const activeQuestion = snapshot?.active_question ?? null;
  const remaining = remainingCount(activeQuestion);
  const roundOver = isElimination && isRoundOver(activeQuestion);
  const survivor = roundOver ? livingSegments(activeQuestion)[0] : undefined;

  // Bet-race view-state. Punishment + Chaos share the betting / turn /
  // standings / winner flow (`isBetRace`); `isPunish` stays for the
  // punishment-only dare bits, `isChaos` for the chaos-only differences
  // (no per-spin banner, chaos event card).
  const isPunish = isPunishment(snapshot);
  const isChaos = snapshot?.room.game_mode === "chaos";
  const isRace = isBetRace(snapshot);
  const punishPhase = punishmentPhase(snapshot); // "betting" | "playing" | "over"
  const myDoneCount =
    snapshot != null ? perPlayerDoneCount(snapshot, snapshot.me_user_id) : 0;
  const placeBet = useRoomStore((s) => s.placeBet);
  const resolvePunishment = useRoomStore((s) => s.resolvePunishment);
  const approvePunishment = useRoomStore((s) => s.approvePunishment);
  const rejectPunishment = useRoomStore((s) => s.rejectPunishment);
  // "Present" = everyone currently in the room snapshot. Participant rows are
  // added on room:participant_joined and removed on _left, so the list mirrors
  // live presence (the same source the header count + avatars use).
  const presentUserIds = useMemo(
    () => snapshot?.participants.map((p) => p.user_id) ?? [],
    [snapshot],
  );
  const nameFor = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of snapshot?.participants ?? []) {
      if (p.display_name != null && p.display_name !== "") {
        map.set(p.user_id, p.display_name);
      }
    }
    return (id: number): string =>
      map.get(id) ?? t("room:turn.someone");
  }, [snapshot, t]);
  const segLabel = (id: number): string => {
    const s = activeQuestion?.segments.find((x) => x.id === id);
    return s ? `${s.emoji ?? ""} ${s.label}`.trim() : "";
  };
  const myBetSeg = myBet(snapshot);
  const punishBettors = bettorIds(snapshot);
  // Segments already locked by OTHER players (for the betting chips): which
  // are taken and by whom. Picks are unique, so a chip another player holds is
  // shown as unavailable — unless every segment is taken (more players than
  // segments), where the server allows a duplicate and we keep them tappable.
  const punishTakenByOther = new Map<number, number>();
  if (snapshot != null) {
    for (const [uidStr, segId] of Object.entries(
      snapshot.room.punishment_bets ?? {},
    )) {
      if (Number(uidStr) !== snapshot.me_user_id) {
        punishTakenByOther.set(segId, Number(uidStr));
      }
    }
  }
  const punishFreeExists =
    activeQuestion?.segments.some(
      (s) => !s.is_eliminated && !punishTakenByOther.has(s.id),
    ) ?? false;
  const punishWaiting = isRace ? waitingOnBetIds(snapshot, presentUserIds) : [];
  const punishAllBet = allPresentBet(snapshot, presentUserIds);
  const punishBetting = isRace && punishPhase === "betting";
  const punishPlaying = isRace && punishPhase === "playing";
  const punishOver = isRace && punishPhase === "over";
  const punishCurrentTurn = snapshot?.room.current_turn_user_id ?? null;
  const isMyPunishTurn = isRace && punishCurrentTurn === snapshot?.me_user_id;
  const punishOutcome = lastOutcome(snapshot);
  const punishPending = pendingPunishment(snapshot);
  const mustResolveMyPunish = isMyPunishment(snapshot);
  const punishPendingApproval = pendingApproval(snapshot);
  const punishApproverUserId = approverUserId(snapshot);
  // Auto-scroll the dare card into view once per distinct dare (the task +
  // Done button otherwise sit below the wheel/standings — see IMG_2276).
  const dareKey =
    spinLanded && punishPending !== null && !punishPendingApproval
      ? `${punishPending.spinner_id}:${punishPending.result_segment_id}`
      : null;
  useEffect(() => {
    if (dareKey !== null) {
      dareCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [dareKey]);
  // Same for the lucky "Хоба!" result — show it without scrolling the page.
  const luckyKey =
    spinLanded && punishOutcome?.kind === "lucky"
      ? `${punishOutcome.spinner_id}:${punishOutcome.result_segment_id}`
      : null;
  useEffect(() => {
    if (luckyKey !== null) {
      luckyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [luckyKey]);
  const mustApprove = isMyApproval(snapshot);
  const punishWinnerId = winnerUserId(snapshot);
  const myMatchCount =
    snapshot != null ? matchCount(snapshot, snapshot.me_user_id) : 0;
  // The starter (first bettor in join order) takes the first spin; the server
  // seeds the turn cursor to them at game start. Everyone else waits.
  // The host always takes the first turn (mirrors the server's start_game,
  // which seeds the host as current_turn). Deriving this from presence order
  // is wrong — that order differs per client, so each device would think it
  // is the starter and show an active spin button.
  const punishStarter = isRace ? (snapshot?.room.host_id ?? null) : null;
  const canStartPunish =
    punishBetting && punishAllBet && punishStarter === snapshot?.me_user_id;
  const canSpinPunish =
    punishPlaying && isMyPunishTurn && punishPending === null;

  // Best-of-N view-state.
  const isBon = isBestOfN(snapshot);
  const bonAttempts = bonAttemptsCount(snapshot);
  const bonTarget = bonTargetCount(snapshot);
  const bonTally = bonTallyMap(snapshot);
  const bonWinnerId = roundWinnerId(snapshot);
  const bonOver = bonRoundOver(snapshot);
  const bestOfNReset = useRoomStore((s) => s.bestOfNReset);

  // Spin choreography. Most spins are one animation → settle → reveal. Chaos
  // adds a ~1.5 s announcement card first, and two events are multi-phase:
  //   • multi_spin — `spin_reps` short fast spins, the last lands the result.
  //   • nudge_*    — settle on one segment, "think" (shake), then creep ±1.
  // The sequence runs as an async chain guarded by a `cancelled` flag so a
  // new spin (or unmount) cleanly aborts mid-flight.
  useEffect(() => {
    if (currentSpin === null) {
      setWheelState("idle");
      setRevealed(false);
      setSpinLanded(true); // not animating → result/winner may show
      setChaosAnnounce(null);
      setPhaseSpin(null);
      return undefined;
    }
    const fx = currentSpin.mode_effects;
    const event = fx?.chaos_event ?? null;
    const finalAngle = currentSpin.final_angle_deg;
    const baseDur = currentSpin.duration_ms;
    const resultSegId = currentSpin.result_segment_id;

    let cancelled = false;
    const timers: number[] = [];
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });

    setRevealed(false);
    setSpinLanded(false); // a spin is animating → hold result/winner UI
    setPhaseSpin(null);
    setScrambleOrder(null);
    setFakeWinId(null);
    setQuaking(false);
    setGlitching(false);

    async function run(): Promise<void> {
      if (event !== null) {
        setChaosAnnounce(event);
        audio.playChaos(event); // a distinct synthesised cue per event
        setWheelState("idle"); // hold while the card is up
        await sleep(CHAOS_ANNOUNCE_MS);
        if (cancelled) return;
        setChaosAnnounce(null);
      }

      if (event === "shuffle") {
        // Make the scramble UNMISTAKABLE: while the wheel is still, jump the
        // segments through a series of random orders (each re-render snaps them
        // to new sectors), then settle on the real server order before spinning.
        const ids = segmentsRef.current.map((s) => Number(s.id));
        for (let k = 0; k < SHUFFLE_SCRAMBLE_STEPS; k++) {
          setScrambleOrder(shuffledIds(ids));
          haptics.light();
          audio.play("wheel_tick");
          await sleep(SHUFFLE_STEP_MS);
          if (cancelled) return;
        }
        setScrambleOrder(null); // settle to the real (server) order
        await sleep(260);
        if (cancelled) return;
      }

      setWheelState("spinning");

      if (event === "multi_spin") {
        const reps = Math.max(2, Math.min(5, fx?.spin_reps ?? 3));
        let angle = wheelRef.current?.getCurrentRotation() ?? 0;
        for (let k = 0; k < reps - 1; k++) {
          angle += 360 * 2 + Math.random() * 360;
          setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: angle, durationMs: MULTI_SPIN_STEP_MS, seed: freshSeed() });
          await sleep(MULTI_SPIN_STEP_MS);
          if (cancelled) return;
        }
        // The last spin lands the recorded result; push it past `angle` so it
        // still travels forward (same landing sector — adding 360s is free).
        let target = finalAngle;
        while (target <= angle + 360) target += 360;
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: target, durationMs: MULTI_SPIN_FINAL_MS, seed: freshSeed() });
        await sleep(MULTI_SPIN_FINAL_MS);
        if (cancelled) return;
      } else if (event === "nudge_fwd" || event === "nudge_back") {
        const pre = fx?.nudge_from_angle ?? finalAngle;
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: pre, durationMs: baseDur, seed: freshSeed() });
        await sleep(baseDur);
        if (cancelled) return;
        // "Thinking" wobble — does it stay, or creep forward/back?
        if (wheelScope.current !== null) {
          // Fire the shake; wait its duration with our own timer (the
          // returned controls aren't awaitable in this Framer version).
          void animateWheel(
            wheelScope.current,
            { rotate: [0, -5, 5, -4, 4, -2, 2, 0] },
            { duration: NUDGE_SHAKE_MS / 1000, ease: "easeInOut" },
          );
        }
        await sleep(NUDGE_SHAKE_MS);
        if (cancelled) return;
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: finalAngle, durationMs: NUDGE_CREEP_MS, seed: freshSeed() });
        await sleep(NUDGE_CREEP_MS);
        if (cancelled) return;
      } else if (event === "roaming_pointer") {
        // Wheel stays still (server kept the angle, so the no-op spin doesn't
        // move it); the pointer roams across the options and lands on the
        // result. R = the wheel's resting angle = currentSpin.final_angle_deg.
        const segs = segmentsRef.current;
        const resultIdx = segs.findIndex((s) => s.id === String(resultSegId));
        if (resultIdx >= 0 && wheelRef.current !== null) {
          await wheelRef.current.roamPointer(
            buildRoamHops(segs.length, resultIdx, finalAngle),
          );
        } else {
          await sleep(baseDur);
        }
        if (cancelled) return;
      } else if (event === "fake_out") {
        // Settle on the decoy, FAKE A WIN there (flash the wedge + celebrate),
        // hold so everyone reacts — then yank it away and creep to the real
        // winner. The fake celebration is what sets this apart from `nudge`.
        const decoy = fx?.fake_stop_angle ?? finalAngle;
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: decoy, durationMs: baseDur, seed: freshSeed() });
        await sleep(baseDur);
        if (cancelled) return;
        // "Winner!" — flash the decoy wedge with the celebratory cue.
        const decoyIdx = segmentUnderPointer(decoy, segmentsRef.current.length);
        const decoyId = segmentsRef.current[decoyIdx]?.id ?? null;
        setFakeWinId(decoyId);
        haptics.success();
        audio.play("result_chime");
        await sleep(FAKE_OUT_HOLD_MS);
        if (cancelled) return;
        // …gotcha. Drop the fake win and creep on to the truth — with the
        // comedic "wah-wah" let-down cue.
        setFakeWinId(null);
        haptics.heavy();
        audio.playChaos("fake_out_drop");
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: finalAngle, durationMs: FAKE_OUT_CREEP_MS, seed: freshSeed() });
        await sleep(FAKE_OUT_CREEP_MS);
        if (cancelled) return;
      } else if (event === "earthquake") {
        // Violent tremor: the whole screen shakes, the wheel convulses, and the
        // phone rumbles — THEN it breaks loose and spins to the server result.
        setQuaking(true);
        audio.playChaos("earthquake"); // the rumble, synced to the shake
        if (wheelScope.current !== null) {
          void animateWheel(
            wheelScope.current,
            {
              rotate: [0, -11, 11, -10, 10, -7, 7, -5, 5, -3, 3, 0],
              x: [0, -8, 8, -7, 7, -4, 4, -2, 2, 0],
              y: [0, 5, -5, 4, -4, 2, -2, 0],
            },
            { duration: QUAKE_SHAKE_MS / 1000, ease: "easeInOut" },
          );
        }
        // Rumble: a burst of heavy haptics across the quake.
        for (let r = 0; r < 5; r++) {
          haptics.heavy();
          await sleep(QUAKE_SHAKE_MS / 6);
          if (cancelled) {
            setQuaking(false);
            return;
          }
        }
        setQuaking(false);
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: finalAngle, durationMs: baseDur, seed: freshSeed() });
        await sleep(baseDur);
        if (cancelled) return;
      } else if (event === "glitch") {
        // "Broken wheel": jolt erratically — fast lurches, backward stutters,
        // freezes — under a glitch overlay, then RECOVER smoothly onto the
        // real result. The overlay + the broken motion sell the malfunction.
        setGlitching(true);
        audio.playChaos("glitch"); // the broken-signal stutter, synced to it
        let angle = wheelRef.current?.getCurrentRotation() ?? 0;
        const jolts = [
          { d: 360 * 1.5 + Math.random() * 220, ms: 300 },
          { d: -35 - Math.random() * 45, ms: 130 }, // backward stutter
          { d: 360 + Math.random() * 200, ms: 240 },
          { d: -60, ms: 120 }, // glitch back
          { d: 180 + Math.random() * 160, ms: 200 },
        ];
        for (const j of jolts) {
          angle += j.d;
          setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: angle, durationMs: j.ms, seed: freshSeed() });
          haptics.heavy();
          await sleep(j.ms + 70); // the gap reads as a freeze between jolts
          if (cancelled) {
            setGlitching(false);
            return;
          }
        }
        // Recover: push past the current angle so the settle still travels
        // forward, landing on the real server result.
        let target = finalAngle;
        while (target <= angle + 360) target += 360;
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: target, durationMs: GLITCH_RECOVER_MS, seed: freshSeed() });
        await sleep(GLITCH_RECOVER_MS - 200);
        if (cancelled) {
          setGlitching(false);
          return;
        }
        setGlitching(false); // overlay clears just before the clean stop
        await sleep(200);
        if (cancelled) return;
      } else if (event === "jammed") {
        // FULLY LOCKED: the wheel strains and shudders but never moves — it
        // ends exactly where it started. The server keeps it put and makes the
        // result the segment already under the pointer (so the lock is real,
        // not a fake spin). It never breaks free.
        const base = wheelRef.current?.getCurrentRotation() ?? 0;
        for (let i = 0; i < 4; i++) {
          audio.playChaos("jammed"); // a strained grind each attempt
          haptics.heavy();
          if (wheelScope.current !== null) {
            // A HARD shudder in place — the motor straining violently against
            // the jam (bigger rotate + x/y buzz, more oscillations).
            void animateWheel(
              wheelScope.current,
              {
                rotate: [0, -6, 6, -5, 5, -4, 4, -2, 2, 0],
                x: [0, -4, 4, -3, 3, -2, 2, 0],
                y: [0, 3, -3, 2, -2, 0],
              },
              { duration: 0.3, ease: "easeInOut" },
            );
          }
          // A tiny strain forward… then it's dragged right back. It won't go.
          setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: base + 7 + Math.random() * 5, durationMs: 120, seed: freshSeed() });
          await sleep(150);
          if (cancelled) return;
          setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: base, durationMs: 120, seed: freshSeed() });
          await sleep(165);
          if (cancelled) return;
        }
        // The motor finally dies: a power-down groan + one last weak shudder,
        // then it settles dead on the spot (= the server result).
        audio.playChaos("jammed_dead");
        haptics.heavy();
        if (wheelScope.current !== null) {
          void animateWheel(
            wheelScope.current,
            { rotate: [0, -2, 2, -1, 1, 0] },
            { duration: 0.6, ease: "easeOut" },
          );
        }
        setPhaseSpin({ resultSegmentIndex: 0, finalAngleDeg: base, durationMs: 150, seed: freshSeed() });
        await sleep(620); // let the dying-motor groan play out before the reveal
        if (cancelled) return;
      } else {
        // normal / slow_burn / reverse / swap / shuffle — one server-driven
        // spin (phaseSpin stays null → the Wheel animates the server result;
        // shuffle's reordered segments come through `segment_order`).
        // A quick anticipation squash → pop as it breaks loose for that bit of
        // game-feel (skipped for the deliberately-gentle slow_burn).
        if (wheelScope.current !== null && event !== "slow_burn") {
          void animateWheel(
            wheelScope.current,
            { scale: [1, 0.94, 1.03, 1] },
            { duration: 0.4, ease: "easeOut" },
          );
        }
        await sleep(baseDur);
        if (cancelled) return;
      }

      haptics.heavy();
      haptics.success();
      audio.playThunk(); // the satisfying landing impact
      audio.play("result_chime");
      setWheelState("settled");
      setSpinLanded(true); // wheel has visually landed → reveal result/winner

      await sleep(isElimination ? ELIM_REVEAL_DELAY_MS : REVEAL_DELAY_MS);
      if (cancelled) return;
      audio.play("hoba_pop");
      // Chaos: no per-spin confetti — a hit shows the "Hoba! {option}" banner
      // instead, and the win gets its own celebration (effect below).
      if (!isElimination && !isChaos) {
        const winSeg = snapshot?.active_question?.segments.find((s) => s.id === resultSegId);
        fireConfetti({ colors: winnerColors(winSeg?.color_seed) }); // in the winner's colour
      }
      setRevealed(true);
    }
    void run();

    return () => {
      cancelled = true;
      for (const tmr of timers) window.clearTimeout(tmr);
    };
  }, [currentSpin?.spin_id, currentSpin, isElimination, isChaos, animateWheel, wheelScope]);

  // The result auto-dismisses for every mode — no manual close. The
  // elimination "what's out" flash is quick; the classic celebration
  // lingers a touch longer.
  useEffect(() => {
    if (!revealed || roundOver) return undefined;
    const timer = window.setTimeout(() => {
      setRevealed(false);
    }, isElimination ? 2200 : 2800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [revealed, roundOver, isElimination]);

  // Triumphant winner celebration: fanfare + confetti pop + visual burst.
  // Shared by every "someone won" moment so they all feel like a payoff.
  const celebrateWinner = useCallback((colorSeed?: number): void => {
    audio.play("winner_fanfare");
    audio.play("confetti_burst");
    haptics.success();
    fireConfetti({ colors: winnerColors(colorSeed) });
  }, []);

  // Crown the survivor: celebrate once when the round ends — but only after
  // the wheel has visually landed (spinLanded), so the fanfare + winner popup
  // never beat the final spin.
  useEffect(() => {
    if (!(roundOver && spinLanded)) return;
    const survivor = snapshot?.active_question?.segments.find((s) => !s.is_eliminated);
    celebrateWinner(survivor?.color_seed);
  }, [roundOver, spinLanded, celebrateWinner, snapshot]);

  // Same celebration when a best-of-N round finalizes a winner.
  useEffect(() => {
    if (!(bonOver && spinLanded)) return;
    const seg = snapshot?.active_question?.segments.find((s) => s.id === bonWinnerId);
    celebrateWinner(seg?.color_seed);
  }, [bonOver, spinLanded, celebrateWinner, snapshot, bonWinnerId]);

  // Chaos has no per-spin confetti, so the bet-race winner gets its own
  // celebration on the winner popup. (Punishment keeps its per-spin burst.)
  useEffect(() => {
    if (!(punishOver && isChaos && spinLanded)) return;
    const betId = snapshot?.room.punishment_bets?.[String(punishWinnerId)];
    const seg = snapshot?.active_question?.segments.find((s) => s.id === betId);
    celebrateWinner(seg?.color_seed);
  }, [punishOver, isChaos, spinLanded, celebrateWinner, snapshot, punishWinnerId]);

  // Rigged Mode 🎭 reveal: when the host pulls the trigger, everyone's snapshot
  // un-redacts (rigged_revealed → true). Play the full-screen reveal once.
  const rigRevealed = snapshot?.room.rigged_revealed ?? false;
  useEffect(() => {
    if (!rigRevealed) {
      setRigRevealShown(false);
      return undefined;
    }
    setRigRevealShown(true);
    audio.play("rigged_reveal");
    audio.play("confetti_burst");
    haptics.success();
    fireConfetti();
    const timer = window.setTimeout(() => {
      setRigRevealShown(false);
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [rigRevealed]);

  useEffect(() => {
    if (lastError === null) return;
    // `lastError` is a server-emitted machine code (e.g. "room_closed",
    // "rate_limited"). Look it up in the room.errors namespace; fall
    // back to a generic message so the user never sees raw enum text.
    const key = `room:errors.${lastError}`;
    const localized = t(key);
    const message = localized === key ? t("room:errors.fallback") : localized;
    toast({ title: message, intent: "warning" });
  }, [lastError, t]);

  // Shatter thunk — fires once per elimination settle.
  // Only runs when `eliminated_segment_id` is present; no-ops on classic
  // settles or on re-renders. The spin_id makes the key unique per spin
  // so the same settled event never re-fires if the component re-renders.
  const settledSpinId = spinSettled?.spin_id ?? null;
  const settledEliminatedId = spinSettled?.mode_aftereffects?.eliminated_segment_id;
  useEffect(() => {
    if (settledEliminatedId === undefined) return;
    // On the FINAL elimination the wheel unmounts (the winner hero takes
    // its place), so wheelScope.current is null — calling animate() on it
    // crashes Framer Motion ("WeakMap keys must be objects"). Skip the
    // thunk in that case; the finish has its own celebration.
    if (roundOver || wheelScope.current === null) return;
    haptics.medium();
    void animateWheel(wheelScope.current, { scale: [1, 0.97, 1] }, { duration: 0.3, ease: "easeInOut" });
  }, [settledSpinId, settledEliminatedId, animateWheel, wheelScope, roundOver]);

  const segments: SegmentDef[] = useMemo(() => {
    if (snapshot?.active_question == null) return [];
    const living = snapshot.active_question.segments.filter((s) => !s.is_eliminated);
    // Chaos "swap"/"shuffle": the server spun over a re-ordered set, so we must
    // render that same order or the wheel lands on the wrong sector. While a
    // `shuffle` is visibly scrambling, `scrambleOrder` overrides with a series
    // of random orders (the animation); it clears to the real order before the
    // spin is released.
    const order = scrambleOrder ?? currentSpin?.mode_effects?.segment_order;
    const ordered = orderSegmentsForSpin(living, order);
    return ordered.map((s) => ({
      id: String(s.id),
      label: s.label,
      emoji: s.emoji ?? undefined,
      colorSeed: s.color_seed,
    }));
  }, [snapshot, currentSpin, scrambleOrder]);
  segmentsRef.current = segments;

  const winningSegmentIndex = useMemo(() => {
    if (currentSpin === null || segments.length === 0) return -1;
    const list = snapshot?.active_question?.segments ?? [];
    return list.findIndex((s) => s.id === currentSpin.result_segment_id);
  }, [currentSpin, segments, snapshot]);

  // blind_pointer: the pointer angle that sits on the RESULT segment's centre,
  // derived client-side from `result_segment_id` + the wheel's rest angle —
  // the same geometry as the roaming-pointer landing. Deriving the result from
  // a server pointer angle instead drifted out of sync (pointer on one option,
  // highlight on another), so the client owns the placement; randomness comes
  // from the (server-chosen) result itself.
  const blindPointerDeg = useMemo(() => {
    if (
      currentSpin === null ||
      currentSpin.mode_effects?.chaos_event !== "blind_pointer" ||
      segments.length === 0
    ) {
      return 0;
    }
    const idx = segments.findIndex((s) => s.id === String(currentSpin.result_segment_id));
    if (idx < 0) return 0;
    const sec = 360 / segments.length;
    return idx * sec + sec / 2 + currentSpin.final_angle_deg;
  }, [currentSpin, segments]);

  const wheelSpin: SpinResult | undefined = useMemo(() => {
    if (currentSpin === null || winningSegmentIndex < 0) return undefined;
    return {
      resultSegmentIndex: winningSegmentIndex,
      finalAngleDeg: currentSpin.final_angle_deg,
      durationMs: currentSpin.duration_ms,
      seed: currentSpin.seed,
      // slow_burn: gentle start, then a long flat tail so the END is slow and
      // drawn-out (no fast whip anywhere — paired with the server trimming the
      // turn count). The last ~half of the duration is the slow crawl to stop.
      ...(currentSpin.mode_effects?.chaos_event === "slow_burn"
        ? { ease: [0.2, 0.1, 0.5, 1] as [number, number, number, number] }
        : {}),
    };
  }, [currentSpin, winningSegmentIndex]);

  const winningSegment =
    winningSegmentIndex >= 0
      ? snapshot?.active_question?.segments[winningSegmentIndex]
      : undefined;

  const canSpin = computeCanSpin(snapshot);
  const callerIsHost = isHost(snapshot);
  // The spin-policy gear is only meaningful once someone else is in the room
  // (solo, the host just spins). Shows when ≥1 non-host player is present.
  const hasOtherPlayers = presentUserIds.some((id) => id !== snapshot?.room.host_id);
  const turnState = computeTurnState(snapshot);

  // One source of background music per room: only the host plays the bed, so
  // co-located guests don't stack different tracks. Suppress only once we
  // positively know we're a non-host (avoids dipping the host's music while
  // the snapshot is still loading). Leaving (unmount) restores lobby music.
  const suppressMusic = snapshot !== null && !callerIsHost;
  useEffect(() => {
    audio.setMusicAllowed(!suppressMusic);
    return () => audio.setMusicAllowed(true);
  }, [suppressMusic]);

  // Spinning is the only state without status lines. No mode has a bottom
  // SPIN button anymore (the centered hub is the sole control), so the
  // wheel lingers in "settled" between spins — keep the turn/status
  // indicator visible there too, not just while idle.
  const idleish = wheelState !== "spinning";

  async function handleShare(): Promise<void> {
    if (snapshot === null) return;
    const code = snapshot.room.code;
    const inviteLink = buildRoomInviteLink(code);
    const message = t("room:share.message", { code });
    haptics.medium();

    const shareUrl =
      `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}` +
      `&text=${encodeURIComponent(message)}`;
    if (openTelegramLink(shareUrl)) return;

    // Fallback: copy the deep link (used when openTelegramLink is a
    // no-op outside Telegram — e.g. dev in a regular browser).
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({
        title: t("room:share.copied_title"),
        description: t("room:share.copied_description"),
        intent: "success",
      });
    } catch {
      toast({ title: inviteLink, intent: "info" });
    }
  }

  async function handleCopyLink(): Promise<void> {
    if (snapshot === null) return;
    const inviteLink = buildRoomInviteLink(snapshot.room.code);
    haptics.medium();
    // Plain clipboard copy so the link can be pasted into any messenger
    // (Telegram's native share sheet only forwards within Telegram).
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({
        title: t("room:share.copied_title"),
        description: t("room:share.copied_description"),
        intent: "success",
      });
    } catch {
      toast({ title: inviteLink, intent: "info" });
    }
  }

  async function handleSaveWheel(): Promise<void> {
    const question = snapshot?.active_question;
    if (question == null || savingWheel) return;
    setSavingWheel(true);
    try {
      await api.createWheel({
        title: question.text,
        segments: question.segments.map((s) => ({
          label: s.label,
          emoji: s.emoji,
          color_seed: s.color_seed,
          weight: s.weight,
        })),
      });
      haptics.success();
      toast({ title: t("room:actions.saved"), intent: "success" });
    } catch {
      toast({ title: t("room:actions.save_failed"), intent: "error" });
    } finally {
      setSavingWheel(false);
    }
  }

  async function handleApplyMode(
    mode: GameMode, deck?: PunishmentDeck, spinCount?: number, wildSpins?: boolean,
  ): Promise<void> {
    if (snapshot === null) return;
    setModePickerOpen(false);
    try {
      const updated = await api.patchRoom(snapshot.room.code, {
        game_mode: mode,
        ...(deck !== undefined ? { punishment_deck: deck } : {}),
        ...(mode === "punishment" ? { punishment_wild_spins: Boolean(wildSpins) } : {}),
        ...(spinCount !== undefined ? { spin_count: spinCount } : {}),
      });
      useRoomStore.getState().setSnapshot(updated);
      haptics.success();
    } catch {
      toast({ title: t("room:settings.save_failed"), intent: "error" });
    }
  }

  async function handleCloseRoom(): Promise<void> {
    if (snapshot === null) return;
    const ok = await confirmPopup(t("room:moderation.close_confirm"));
    if (!ok) return;
    try {
      await api.closeRoom(snapshot.room.code);
      navigate("/", { replace: true });
    } catch {
      toast({ title: t("room:settings.save_failed"), intent: "error" });
    }
  }

  async function handleKick(userId: number, name: string): Promise<void> {
    if (snapshot === null) return;
    const ok = await confirmPopup(t("room:moderation.kick_confirm", { name }));
    if (!ok) return;
    try {
      const updated = await api.kickRoom(snapshot.room.code, userId);
      useRoomStore.getState().setSnapshot(updated);
      haptics.warning();
    } catch {
      toast({ title: t("room:settings.save_failed"), intent: "error" });
    }
  }

  async function handleApprove(userId: number): Promise<void> {
    if (snapshot === null) return;
    try {
      const updated = await api.approveRoom(snapshot.room.code, userId);
      useRoomStore.getState().setSnapshot(updated);
      haptics.success();
    } catch {
      toast({ title: t("room:settings.save_failed"), intent: "error" });
    }
  }

  if (snapshot === null) {
    return (
      <>
        <header className="ds-glass-header pl-4 pr-5 py-3 pt-safe flex items-center gap-3">
          <IconButton
            aria-label={t("common:actions.back")}
            variant="ghost"
            icon={<span aria-hidden>←</span>}
            onClick={() => {
              safeNavigateBack(navigate);
            }}
          />
          <RoomCodePill code={upperCode} className="text-base px-4 py-2" />
          <RealtimeIndicator active={connected} className="ml-auto" />
        </header>
        <main className="flex-1 p-4 flex flex-col gap-3">
          <Skeleton height={32} width="70%" />
          <Skeleton height={300} radius="md" />
        </main>
      </>
    );
  }

  // Join-approval: a guest awaiting the host sees a calm waiting screen, not
  // the room — they're not a real participant until approved.
  if (snapshot.me_pending === true) {
    return (
      <>
        <header className="ds-glass-header pl-4 pr-5 py-3 pt-safe flex items-center gap-3">
          <IconButton
            aria-label={t("common:actions.back")}
            variant="ghost"
            icon={<span aria-hidden>←</span>}
            onClick={() => {
              safeNavigateBack(navigate);
            }}
          />
          <RoomCodePill code={snapshot.room.code} className="text-base px-4 py-2" />
          <RealtimeIndicator active={connected} className="ml-auto" />
        </header>
        <main className="flex-1 px-6 flex flex-col items-center justify-center text-center gap-4">
          <span className="text-6xl animate-pulse" aria-hidden>⏳</span>
          <h1 className="font-display font-bold text-xl text-ds-text">
            {t("room:approval.waiting_title")}
          </h1>
          <p className="text-sm text-ds-text-muted max-w-xs">
            {t("room:approval.waiting_body")}
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      {/* Chaos earthquake: a red "danger" vignette pulsing over the whole
          screen while the room shakes — sells the quake far harder. */}
      {quaking ? (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 animate-danger-flash"
          style={{ boxShadow: "inset 0 0 110px 24px rgba(220,38,38,0.6)" }}
        />
      ) : null}
      <header className="ds-glass-header pl-4 pr-5 py-3 pt-safe flex items-center gap-3">
        <IconButton
          aria-label={t("common:actions.back")}
          variant="ghost"
          icon={<span aria-hidden>←</span>}
          onClick={() => {
            safeNavigateBack(navigate);
          }}
        />
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-base truncate text-ds-text">
            {snapshot.active_question?.text ?? "—"}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <RealtimeIndicator active={connected} />
            <span className="text-xs text-ds-text-muted">
              {t("room:header.participants_count", {
                count: snapshot.participants.length,
              })}
            </span>
          </div>
        </div>
        <AvatarStack
          users={snapshot.participants.map((p) => ({
            fallback: p.display_name ?? `#${p.user_id}`,
          }))}
          max={3}
          size="sm"
          className="shrink-0"
        />
      </header>

      <section className="px-4 pt-3 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <RoomCodePill code={snapshot.room.code} />
          {/* ml-auto pins the actions to the right edge; the icon group
              never shrinks (IconButton is shrink-0), so the code pill keeps
              its full brand size and the actions stay 48×48 tap targets. */}
          <div className="ml-auto flex items-center gap-2">
            <IconButton
              aria-label={t("room:actions.invite")}
              variant="filled"
              size="md"
              icon={<IconShare />}
              onClick={() => {
                haptics.selection();
                setInviteOpen(true);
              }}
            />
            {callerIsHost ? (
              <IconButton
                aria-label={t("room:actions.save_wheel")}
                variant="tonal"
                size="md"
                disabled={savingWheel}
                icon={<IconSave />}
                onClick={() => {
                  void handleSaveWheel();
                }}
              />
            ) : null}
            {callerIsHost ? (
              <IconButton
                aria-label={t("room:settings.open_aria")}
                variant="tonal"
                size="md"
                icon={<IconSettings />}
                onClick={() => {
                  setSettingsOpen(true);
                }}
              />
            ) : null}
          </div>
        </div>
        {/* Join-approval: host sees pending requests with inline Approve/Deny. */}
        {callerIsHost && (snapshot.pending_participants ?? []).length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg bg-brand-accent/15 p-3">
            <span className="text-sm font-semibold text-brand-accent">
              {t("room:approval.requests", {
                count: (snapshot.pending_participants ?? []).length,
              })}
            </span>
            {(snapshot.pending_participants ?? []).map((p) => {
              const name = p.display_name ?? `#${p.user_id}`;
              return (
                <div key={p.user_id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-ds-text">
                    {name}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={() => {
                        void handleApprove(p.user_id);
                      }}
                    >
                      {t("room:approval.approve")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void handleKick(p.user_id, name);
                      }}
                    >
                      {t("room:approval.deny")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {/* Own line so a wide mode label can't squeeze the row above.
            Renders null for classic/rigged, so this line vanishes there. */}
        <GameModeBadge mode={snapshot.room.game_mode} />
        {isElimination ? (
          <span className="text-sm font-medium text-ds-text-muted">
            {t("room:elimination.remaining", { count: remaining })}
          </span>
        ) : null}
        {isPunish ? (
          <span className="text-sm font-medium text-ds-text-muted">
            {t("room:punishment.my_tally", { count: myDoneCount })}
          </span>
        ) : null}
        {/* Prominent "whose turn" banner for turn_based rooms — sits high so
            it's unmissable (the old bottom line hid near the home indicator).
            Only the turn_based kinds render here; classic is not_turn_based. */}
        {turnState.kind === "my_turn" && !roundOver ? (
          <div className="rounded-lg bg-brand-accent/15 py-2 px-3 text-center text-sm font-semibold text-brand-accent">
            {t("room:turn.my_turn")}
          </div>
        ) : null}
        {turnState.kind === "waiting" && !roundOver ? (
          <div className="rounded-lg bg-ds-surface-2 border-[3px] border-ds-border py-2 px-3 text-center text-sm font-bold text-ds-text">
            {turnState.whoName !== null
              ? t("room:turn.waiting_named", { name: turnState.whoName })
              : t("room:turn.waiting_unnamed")}
          </div>
        ) : null}
        {turnState.kind === "no_one" && !roundOver ? (
          <div className="rounded-lg bg-ds-surface-2 border-[3px] border-ds-border py-2 px-3 text-center text-sm text-ds-text-muted">
            {t("room:turn.no_one")}
          </div>
        ) : null}
      </section>

      <main
        className={cn(
          "flex-1 px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col gap-4 relative",
          quaking && "animate-screen-quake", // Chaos earthquake: shake the room
        )}
      >
        {roundOver && spinLanded ? (
          // Joyful finish — the lone survivor, as a centered popup so the
          // result is unmissable without scrolling. Gated on spinLanded so it
          // never appears before the final spin lands; confetti fires from the
          // roundOver effect above (also spinLanded-gated).
          <WinnerOverlay
            emoji={survivor?.emoji}
            title={t("room:elimination.winner_title", { label: survivor?.label ?? "" })}
            isHost={callerIsHost}
            actionLabel={t("room:elimination.new_round")}
            onAction={resetRound}
            waitingLabel={t("room:elimination.waiting_new_round")}
          />
        ) : isBon && bonOver && spinLanded ? (
          // Best-of-N finish — same centered popup so the result is
          // unmissable without scrolling.
          <WinnerOverlay
            emoji={
              snapshot.active_question?.segments.find((s) => s.id === bonWinnerId)?.emoji
            }
            title={t("room:best_of_n.winner", {
              label:
                snapshot.active_question?.segments.find((s) => s.id === bonWinnerId)
                  ?.label ?? "",
            })}
            isHost={callerIsHost}
            actionLabel={t("room:best_of_n.new_round")}
            onAction={bestOfNReset}
            waitingLabel={t("room:elimination.waiting_new_round")}
          />
        ) : (
          <motion.div ref={wheelScope} className="relative">
            {/* Chaos `glitch`: a broken-screen overlay (jittering RGB-split
                tint + crawling scanlines) over the wheel while it stutters. */}
            {glitching ? (
              <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-full mix-blend-screen">
                <div className="absolute inset-0 animate-glitch-jitter bg-gradient-to-br from-brand-pink/40 via-transparent to-brand-cyan/40" />
                <div
                  className="absolute inset-0 animate-glitch-scan opacity-60"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 2px, transparent 2px, transparent 5px)",
                  }}
                />
              </div>
            ) : null}
            <Wheel
              ref={wheelRef}
              segments={segments}
              state={wheelState}
              spin={phaseSpin ?? wheelSpin}
              // Chaos blind_pointer: hide the pointer while spinning, then
              // reveal it at the server's random angle once settled.
              pointerHidden={
                currentSpin?.mode_effects?.chaos_event === "blind_pointer" &&
                wheelState === "spinning"
              }
              pointerDeg={
                currentSpin?.mode_effects?.chaos_event === "blind_pointer" &&
                wheelState === "settled"
                  ? blindPointerDeg
                  : 0
              }
              // Bet-race modes have no per-spin result overlay, so flash the
              // landed wedge to show which option came up.
              highlightSegmentId={
                isRace && currentSpin !== null
                  ? String(currentSpin.result_segment_id)
                  : undefined
              }
              // Chaos fake_out: pulse the decoy wedge as a "fake win" during
              // the hold, before the wheel creeps off it to the real winner.
              flashSegmentId={fakeWinId ?? undefined}
              ariaLabel={snapshot.active_question?.text ?? t("room:header.wheel_aria")}
              // Only attach the hub-tap handler when this user is actually
              // allowed to spin (host_only policy) — otherwise the hub
              // would invite a tap that the server then rejects.
              // In Punishment the hub is host-only and gated on everyone
              // having locked a guess ("Spin anyway" below is the force path).
              onSpinClick={
                isRace
                  ? canStartPunish || canSpinPunish
                    ? () => {
                        triggerSpin();
                      }
                    : undefined
                  : canSpin && !bonOver
                    ? () => {
                        triggerSpin();
                      }
                    : undefined
              }
              // Rigged Mode 🎭 (spec §5.5): the host's hidden long-press on the
              // hub opens the secret weight editor. Only in Classic/Rigged
              // rooms (rigging the bet-race / elimination modes is meaningless).
              onHubLongPress={
                callerIsHost &&
                (snapshot.room.game_mode === "classic" ||
                  snapshot.room.game_mode === "rigged")
                  ? () => {
                      setRigOpen(true);
                    }
                  : undefined
              }
              className="max-w-md mx-auto"
            />
          </motion.div>
        )}

        {/* Punishment/Chaos: winner popup (game over) — same centered overlay
            as the other modes, so the result no longer hides below the
            standings. */}
        {punishOver && punishWinnerId !== null && spinLanded ? (
          <WinnerOverlay
            title={t("room:punishment.winner_title", {
              item: segLabel(
                snapshot.room.punishment_bets?.[String(punishWinnerId)] ?? -1,
              ),
            })}
            isHost={callerIsHost}
            actionLabel={t("room:punishment.new_round")}
            onAction={resetRound}
            waitingLabel={t("room:elimination.waiting_new_round")}
          />
        ) : null}

        {/* Punishment: betting phase — pick your option (public). */}
        {punishBetting && activeQuestion !== null ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-ds-text">
              {t("room:punishment.pick_hint")}
            </p>
            <div className="flex flex-wrap gap-2 justify-center px-2">
              {activeQuestion.segments
                .filter((s) => !s.is_eliminated)
                .map((s) => {
                  const picked = myBetSeg === s.id;
                  const ownerUid = punishTakenByOther.get(s.id);
                  // Taken by someone else AND a free option still exists → lock it.
                  const unavailable =
                    ownerUid !== undefined && !picked && punishFreeExists;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={unavailable}
                      onClick={() => {
                        if (unavailable) return;
                        haptics.light();
                        placeBet(s.id);
                      }}
                      aria-pressed={picked}
                      className={`min-h-11 px-4 py-2 rounded-full text-sm font-bold border-[3px] border-ds-border transition-transform active:scale-[0.97] ${
                        picked
                          ? "bg-brand-primary text-white shadow-brutal-sm"
                          : unavailable
                            ? "bg-ds-surface-2 text-ds-text-muted line-through opacity-50"
                            : "bg-ds-surface-2 text-ds-text"
                      }`}
                    >
                      {s.emoji ? `${s.emoji} ` : ""}
                      {s.label}
                      {ownerUid !== undefined ? (
                        <span className="ml-1 no-underline opacity-80">
                          · {nameFor(ownerUid)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
            </div>
            {punishBettors.length > 0 ? (
              <div className="flex flex-col items-center gap-0.5 text-xs text-ds-text-muted">
                {punishBettors.map((uid) => (
                  <span key={uid}>
                    {nameFor(uid)} →{" "}
                    {segLabel(snapshot.room.punishment_bets?.[String(uid)] ?? -1)}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="text-sm font-semibold text-ds-text-muted">
              {t("room:punishment.bet_status", {
                bet: punishBettors.length,
                total: presentUserIds.length,
              })}
            </p>
            {punishWaiting.length > 0 ? (
              <p className="text-xs text-ds-text-muted text-center px-4">
                {t("room:punishment.waiting_bets", {
                  names: punishWaiting.map(nameFor).join(", "),
                })}
              </p>
            ) : !canStartPunish && punishStarter !== null ? (
              <p className="text-xs text-ds-text-muted">
                {t("room:punishment.waiting_start", {
                  name: nameFor(punishStarter),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Punishment: playing phase — turn, standings, last outcome. */}
        {punishPlaying ? (
          <div className="flex flex-col items-center gap-3 max-w-md mx-auto w-full">
            <p className="text-sm font-semibold text-brand-violet-2">
              {isMyPunishTurn
                ? t("room:punishment.your_turn_spin")
                : t("room:punishment.turn_of", {
                    name: nameFor(punishCurrentTurn ?? 0),
                  })}
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              {punishBettors.map((uid) => {
                const betSeg = snapshot.room.punishment_bets?.[String(uid)];
                // Highlight the viewer's OWN row (so they always know which
                // option is theirs) and ring the row whose turn it is now.
                const isMe = uid === snapshot.me_user_id;
                const isTurn = uid === punishCurrentTurn;
                const count = matchCount(snapshot, uid);
                return (
                  <span
                    key={uid}
                    className={cn(
                      "rounded-full px-2.5 py-1 transition-colors",
                      isMe
                        ? "bg-brand-primary text-white font-semibold"
                        : "bg-ds-surface-2 text-ds-text",
                      isTurn && "ring-2 ring-brand-accent", // ← whose turn now
                    )}
                  >
                    {isMe ? `★ ${t("room:punishment.you")}` : nameFor(uid)}
                    {betSeg !== undefined ? ` (${segLabel(betSeg)})` : ""}{" "}
                    {/* Count bumps (re-mounts on change) when a match scores. */}
                    <motion.span
                      key={count}
                      initial={{ scale: 1.7 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", damping: 11, stiffness: 380 }}
                      className="inline-block font-bold"
                    >
                      {count}/{matchesToWin(snapshot)}
                    </motion.span>
                  </span>
                );
              })}
            </div>
            {!spinLanded ? null : punishPending !== null ? (
              punishPendingApproval ? (
                // Dare was performed ("Done"): the dare card is gone; only a
                // slim approval prompt remains for the chosen approver.
                <div className="flex flex-col items-center gap-2 rounded-xl bg-ds-surface-2 px-4 py-3 text-center w-full">
                  {mustApprove ? (
                    <>
                      <p className="text-sm font-semibold text-ds-text">
                        {t("room:punishment.approve_prompt", {
                          name: nameFor(punishPending.spinner_id),
                        })}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="accent"
                          size="md"
                          onClick={() => {
                            approvePunishment();
                          }}
                        >
                          {t("room:punishment.approve_yes")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => {
                            rejectPunishment();
                          }}
                        >
                          {t("room:punishment.approve_no")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-ds-text-muted">
                      {t("room:punishment.waiting_approval", {
                        name: nameFor(punishApproverUserId ?? 0),
                      })}
                    </p>
                  )}
                </div>
              ) : (
                <div
                  ref={dareCardRef}
                  className="flex flex-col items-center gap-2 rounded-xl bg-brand-primary border-[3px] border-ds-border p-4 text-center text-white shadow-brutal scroll-mt-24"
                >
                  <p className="text-base font-display font-bold leading-snug">
                    {t("room:punishment.must_do", {
                      name: nameFor(punishPending.spinner_id),
                      card: punishPending.card?.text ?? "",
                    })}
                  </p>
                  {mustResolveMyPunish ? (
                    <div className="flex gap-2">
                      <Button
                        variant="accent"
                        size="md"
                        onClick={() => {
                          resolvePunishment(false);
                        }}
                      >
                        {t("room:punishment.done")}
                      </Button>
                      {myMatchCount > 0 ? (
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => {
                            resolvePunishment(true);
                          }}
                        >
                          {t("room:punishment.refuse")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            ) : punishOutcome?.kind === "lucky" ? (
              <div
                ref={luckyRef}
                className="flex flex-col items-center gap-1 rounded-xl bg-brand-accent/15 border-[3px] border-ds-border px-4 py-3 text-center scroll-mt-24"
              >
                <HobaWord sizeClass="text-4xl" />
                <p className="text-sm font-semibold text-ds-text">
                  <span className="font-display font-bold text-brand-primary">
                    {punishOutcome.spinner_id === snapshot.me_user_id
                      ? t("room:punishment.lucky_you")
                      : nameFor(punishOutcome.spinner_id)}
                  </span>{" "}
                  {t("room:punishment.lucky_tail", {
                    item: segLabel(punishOutcome.result_segment_id),
                  })}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {isBon ? (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-sm font-semibold text-ds-text-muted">
              {t("room:best_of_n.attempt", {
                k: Math.min(bonAttempts, bonTarget),
                n: bonTarget,
              })}
            </span>
            {bonTally.size > 0 ? (
              <div className="flex flex-wrap gap-1.5 justify-center px-2">
                {[...bonTally.entries()].map(([segId, count]) => {
                  const seg = snapshot.active_question?.segments.find(
                    (s) => s.id === segId,
                  );
                  return (
                    <span
                      key={segId}
                      className="text-xs font-semibold px-2 py-1 rounded-full bg-ds-surface-2 text-ds-text"
                    >
                      {seg?.emoji ? `${seg.emoji} ` : ""}{seg?.label ?? segId} · {count}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {isElimination && eliminatedSegments(activeQuestion).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 justify-center px-2">
            {eliminatedSegments(activeQuestion).map((s) => (
              <span
                key={s.id}
                className="text-xs px-2 py-1 rounded-full grayscale opacity-60 bg-ds-surface-2 line-through"
              >
                {s.emoji ? `${s.emoji} ` : ""}{s.label}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-3">
          <ReactionsBar />
          {/* No bottom SPIN button in any mode — the centered wheel hub is
              the sole spin control. Only status/turn lines live here. */}
          {/* Classic host_only guests get the "host spins" hint here.
              turn_based "whose turn" now shows as a banner up top. */}
          {!isRace && !canSpin && idleish && turnState.kind === "not_turn_based" && !roundOver ? (
            <p className="text-center text-sm text-ds-text-muted py-3">
              {t("room:spin.host_only_hint")}
            </p>
          ) : null}
        </div>

        <FlyingReactions />

        <InviteSheet
          open={inviteOpen}
          onClose={() => {
            setInviteOpen(false);
          }}
          onShare={() => {
            void handleShare();
          }}
          onCopy={() => {
            void handleCopyLink();
          }}
        />

        {/* Host moderation hub: lock, anonymous, mode change, close — always
            available to the host. The spin-policy chooser only applies to
            non-race modes once a guest is present (solo, the host just spins;
            Punishment/Chaos are turn_based-only). */}
        {callerIsHost ? (
          <RoomSettingsSheet
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
            }}
            snapshot={snapshot}
            showSpinPolicy={!isRace && hasOtherPlayers}
            onChangeMode={() => {
              setModePickerOpen(true);
            }}
            onCloseRoom={() => {
              void handleCloseRoom();
            }}
            onKick={(userId, name) => {
              void handleKick(userId, name);
            }}
          />
        ) : null}

        {callerIsHost ? (
          <RoomModePickerSheet
            open={modePickerOpen}
            loading={false}
            onClose={() => {
              setModePickerOpen(false);
            }}
            onCreate={(mode, deck, spinCount, wildSpins) => {
              void handleApplyMode(mode, deck, spinCount, wildSpins);
            }}
          />
        ) : null}

        {callerIsHost ? (
          <RigEditorSheet
            open={rigOpen}
            onClose={() => {
              setRigOpen(false);
            }}
            snapshot={snapshot}
          />
        ) : null}

        {/* Chaos (§5.4): pre-spin event announcement card. Holds for
            CHAOS_ANNOUNCE_MS (the spin-drive effect clears it), then the
            wheel releases. pointer-events-none so it never blocks the hub. */}
        <AnimatePresence>
          {chaosAnnounce !== null ? (
            <motion.div
              key="chaos-announce"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.12 }}
              transition={{ type: "spring", damping: 14, stiffness: 220 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-6 text-center bg-ds-bg pointer-events-none"
              aria-live="assertive"
              role="status"
            >
              <HobaWord sizeClass="text-5xl sm:text-6xl" />
              {chaosAnnounce === "swap" ? (
                // Show the two sectors actually trading places so it's clear
                // WHICH swapped (the on-wheel swap alone reads as invisible).
                <div className="relative h-24 w-full max-w-[19rem] mt-1" aria-hidden>
                  <motion.span
                    className="absolute top-5 left-0 max-w-[46%] text-sm font-bold leading-tight text-center whitespace-normal break-words px-3 py-1.5 rounded-2xl bg-ds-surface-2"
                    animate={{ x: [0, 0, 140, 140], y: [0, -26, -26, 0] }}
                    transition={{ duration: 1.1, times: [0, 0.25, 0.75, 1], ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
                  >
                    {segLabel(currentSpin?.mode_effects?.swap_pair?.[0] ?? -1) || "🔀"}
                  </motion.span>
                  <motion.span
                    className="absolute top-5 right-0 max-w-[46%] text-sm font-bold leading-tight text-center whitespace-normal break-words px-3 py-1.5 rounded-2xl bg-ds-surface-2"
                    animate={{ x: [0, 0, -140, -140], y: [0, 26, 26, 0] }}
                    transition={{ duration: 1.1, times: [0, 0.25, 0.75, 1], ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
                  >
                    {segLabel(currentSpin?.mode_effects?.swap_pair?.[1] ?? -1) || "🔀"}
                  </motion.span>
                </div>
              ) : (
                <span className="text-5xl leading-none mt-1" aria-hidden>
                  {chaosAnnounce.startsWith("nudge")
                    ? "🔁"
                    : CHAOS_EVENT_EMOJI[chaosAnnounce] ?? "🎲"}
                </span>
              )}
              {/* Both nudge directions share one generic card — we don't spoil
                  which way it'll creep; that's revealed only by the wheel. */}
              <p className="font-display font-extrabold text-2xl text-brand-pink">
                {t(`room:chaos.events.${chaosAnnounce.startsWith("nudge") ? "nudge" : chaosAnnounce}.title`)}
              </p>
              <p className="text-sm text-ds-text-muted">
                {t(`room:chaos.events.${chaosAnnounce.startsWith("nudge") ? "nudge" : chaosAnnounce}.desc`)}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {revealed && winningSegment !== undefined && !roundOver && !bonOver && !isRace ? (
            isElimination ? (
              // Elimination: a light "what's out" flash. Auto-dismisses
              // (effect above) and a tap anywhere skips it — no manual close,
              // no "Hoba!"/confetti. The winner here is the eliminated item.
              <motion.div
                key="elim-out"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  setRevealed(false);
                }}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-ds-bg cursor-pointer"
                aria-live="polite"
                role="status"
              >
                {/* Brand beat leads, then the eliminated item drops in. */}
                <HobaWord />
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, type: "spring", damping: 16, stiffness: 240 }}
                  className="flex flex-col items-center gap-2"
                >
                  <span className="text-6xl leading-none grayscale" aria-hidden>
                    {winningSegment.emoji ?? "💥"}
                  </span>
                  <p className="font-display font-bold text-2xl text-center px-6 text-ds-text">
                    {t("room:elimination.eliminated_result", { label: winningSegment.label })}
                  </p>
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key="result"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                onClick={() => {
                  setRevealed(false);
                }}
                className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center bg-ds-bg cursor-pointer"
                aria-live="polite"
                role="status"
              >
                <HobaWord />
                <ResultBanner
                  segmentLabel={winningSegment.label}
                  segmentEmoji={winningSegment.emoji ?? undefined}
                  segmentColor={
                    WHEEL_PALETTE[winningSegment.color_seed % WHEEL_PALETTE.length] ?? "#7C5CFF"
                  }
                  className="mt-6 w-full max-w-sm"
                />
              </motion.div>
            )
          ) : null}
        </AnimatePresence>

        {/* Rigged Mode 🎭 reveal — the catharsis. Full-screen takeover with
            the real weight bars, fired once when the host reveals. */}
        <AnimatePresence>
          {rigRevealShown && activeQuestion !== null ? (
            (() => {
              const segs = activeQuestion.segments.filter((s) => !s.is_eliminated);
              const total = segs.reduce((sum, s) => sum + s.weight, 0) || 1;
              const ranked = [...segs].sort((a, b) => b.weight - a.weight);
              const rigCount = snapshot?.room.rigged_spin_count ?? 0;
              return (
                <motion.div
                  key="rig-reveal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  onClick={() => {
                    setRigRevealShown(false);
                  }}
                  className="fixed inset-0 z-50 px-5 py-6 flex flex-col items-center justify-center gap-3 bg-ds-bg cursor-pointer"
                  aria-live="assertive"
                  role="status"
                >
                  <motion.div
                    initial={{ scale: 0.3, opacity: 0, skewX: -18, rotate: -10 }}
                    animate={{ scale: 1, opacity: 1, skewX: -11, rotate: -4 }}
                    transition={{ type: "spring", damping: 9, stiffness: 240 }}
                    className="origin-center"
                  >
                    <HobaWord sizeClass="text-5xl sm:text-6xl" />
                  </motion.div>
                  <h2 className="font-display font-extrabold text-2xl text-brand-pink text-center">
                    {t("room:rig.revealed_title")}
                  </h2>
                  <div className="w-full max-w-sm flex flex-col gap-2 mt-1">
                    {ranked.map((s, i) => {
                      const pct = Math.round((s.weight / total) * 100);
                      return (
                        <div key={s.id} className="flex items-center gap-2 text-sm">
                          <span className="w-24 shrink-0 truncate text-right text-ds-text">
                            {s.emoji ? `${s.emoji} ` : ""}{s.label}
                          </span>
                          <div className="flex-1 h-5 rounded-full bg-ds-surface-2 overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-brand-primary"
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ delay: 0.3 + i * 0.12, duration: 0.7, ease: "easeOut" }}
                            />
                          </div>
                          <span className="w-9 shrink-0 tabular-nums text-ds-text-muted">
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {rigCount > 0 ? (
                    <p className="text-sm text-ds-text-muted mt-1">
                      {t("room:rig.revealed_count", { count: rigCount })}
                    </p>
                  ) : null}
                </motion.div>
              );
            })()
          ) : null}
        </AnimatePresence>
      </main>
    </>
  );
}
