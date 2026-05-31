import { AnimatePresence, motion, useAnimate } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { audio } from "@/audio";
import { AvatarStack } from "@/components/ds/AvatarStack";
import { Button } from "@/components/ds/Button";
import { fireConfetti } from "@/components/ds/ConfettiBurst";
import { HobaWord } from "@/components/ds/HobaWord";
import { IconButton } from "@/components/ds/IconButton";
import { RealtimeIndicator } from "@/components/ds/RealtimeIndicator";
import { ResultBanner } from "@/components/ds/ResultBanner";
import { RoomCodePill } from "@/components/ds/RoomCodePill";
import { Skeleton } from "@/components/ds/Skeleton";
import { GameModeBadge } from "@/components/room/GameModeBadge";
import { FlyingReactions } from "@/components/room/FlyingReactions";
import { ReactionsBar } from "@/components/room/ReactionsBar";
import { RigEditorSheet } from "@/components/room/RigEditorSheet";
import { RoomSettingsSheet } from "@/components/room/RoomSettingsSheet";
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
import {
  type SegmentDef,
  type SpinResult,
  type WheelState,
} from "@/features/wheel/types";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import {
  buildRoomInviteLink,
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

  const upperCode = code.toUpperCase();

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rigOpen, setRigOpen] = useState(false);
  // Chaos (§5.4): the rolled event for the in-flight spin while its 1.5 s
  // pre-roll announcement card is showing, then null once the wheel releases.
  const [chaosAnnounce, setChaosAnnounce] = useState<string | null>(null);
  // Chaos multi-phase choreography (multi_spin reps, nudge creep): a local
  // SpinResult that overrides the server one while the sequence plays.
  const [phaseSpin, setPhaseSpin] = useState<SpinResult | null>(null);
  const wheelRef = useRef<WheelHandle>(null);
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
    setPhaseSpin(null);

    async function run(): Promise<void> {
      if (event !== null) {
        setChaosAnnounce(event);
        setWheelState("idle"); // hold while the card is up
        await sleep(CHAOS_ANNOUNCE_MS);
        if (cancelled) return;
        setChaosAnnounce(null);
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
      } else {
        // normal / slow_burn / reverse / swap — one server-driven spin
        // (phaseSpin stays null → the Wheel animates the server result).
        await sleep(baseDur);
        if (cancelled) return;
      }

      haptics.heavy();
      haptics.success();
      audio.play("result_chime");
      setWheelState("settled");

      await sleep(isElimination ? ELIM_REVEAL_DELAY_MS : REVEAL_DELAY_MS);
      if (cancelled) return;
      audio.play("hoba_pop");
      // Chaos: no per-spin confetti — a hit shows the "Hoba! {option}" banner
      // instead, and the win gets its own celebration (effect below).
      if (!isElimination && !isChaos) fireConfetti();
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

  // Crown the survivor: celebrate once when the round ends.
  useEffect(() => {
    if (!roundOver) return;
    audio.play("hoba_pop");
    haptics.success();
    fireConfetti();
  }, [roundOver]);

  // Same celebration when a best-of-N round finalizes a winner.
  useEffect(() => {
    if (!bonOver) return;
    audio.play("hoba_pop");
    haptics.success();
    fireConfetti();
  }, [bonOver]);

  // Chaos has no per-spin confetti, so the bet-race winner gets its own
  // celebration on the winner-hero page. (Punishment keeps its per-spin burst.)
  useEffect(() => {
    if (!(punishOver && isChaos)) return;
    audio.play("hoba_pop");
    haptics.success();
    fireConfetti();
  }, [punishOver, isChaos]);

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
    // Chaos "swap": the server spun over a re-ordered set, so we must render
    // that same order or the wheel lands on the wrong sector.
    const ordered = orderSegmentsForSpin(living, currentSpin?.mode_effects?.segment_order);
    return ordered.map((s) => ({
      id: String(s.id),
      label: s.label,
      emoji: s.emoji ?? undefined,
      colorSeed: s.color_seed,
    }));
  }, [snapshot, currentSpin]);
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
  const turnState = computeTurnState(snapshot);

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

  if (snapshot === null) {
    return (
      <>
        <header className="ds-glass-header px-4 py-3 pt-safe flex items-center gap-3">
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

  return (
    <>
      <header className="ds-glass-header px-4 py-3 pt-safe flex items-center gap-3">
        <IconButton
          aria-label={t("common:actions.back")}
          variant="ghost"
          icon={<span aria-hidden>←</span>}
          onClick={() => {
            safeNavigateBack(navigate);
          }}
        />
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-base truncate text-ink-light-1 dark:text-ink-dark-1">
            {snapshot.active_question?.text ?? "—"}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <RealtimeIndicator active={connected} />
            <span className="text-xs text-ink-light-2 dark:text-ink-dark-2">
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
              aria-label={t("room:actions.share")}
              variant="filled"
              size="md"
              icon={<span aria-hidden>📤</span>}
              onClick={() => {
                void handleShare();
              }}
            />
            {callerIsHost && !isRace ? (
              <IconButton
                aria-label={t("room:settings.open_aria")}
                variant="tonal"
                size="md"
                icon={<span aria-hidden>⚙️</span>}
                onClick={() => {
                  setSettingsOpen(true);
                }}
              />
            ) : null}
          </div>
        </div>
        {/* Own line so a wide mode label can't squeeze the row above.
            Renders null for classic/rigged, so this line vanishes there. */}
        <GameModeBadge mode={snapshot.room.game_mode} />
        {isElimination ? (
          <span className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2">
            {t("room:elimination.remaining", { count: remaining })}
          </span>
        ) : null}
        {isPunish ? (
          <span className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2">
            {t("room:punishment.my_tally", { count: myDoneCount })}
          </span>
        ) : null}
        {/* Prominent "whose turn" banner for turn_based rooms — sits high so
            it's unmissable (the old bottom line hid near the home indicator).
            Only the turn_based kinds render here; classic is not_turn_based. */}
        {turnState.kind === "my_turn" && !roundOver ? (
          <div className="rounded-lg bg-brand-amber-3/15 py-2 px-3 text-center text-sm font-semibold text-brand-amber-3">
            {t("room:turn.my_turn")}
          </div>
        ) : null}
        {turnState.kind === "waiting" && !roundOver ? (
          <div className="rounded-lg bg-surface-light-2 py-2 px-3 text-center text-sm font-medium text-ink-light-1 dark:bg-surface-dark-2 dark:text-ink-dark-1">
            {turnState.whoName !== null
              ? t("room:turn.waiting_named", { name: turnState.whoName })
              : t("room:turn.waiting_unnamed")}
          </div>
        ) : null}
        {turnState.kind === "no_one" && !roundOver ? (
          <div className="rounded-lg bg-surface-light-2 py-2 px-3 text-center text-sm text-ink-light-2 dark:bg-surface-dark-2 dark:text-ink-dark-2">
            {t("room:turn.no_one")}
          </div>
        ) : null}
      </section>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4 relative">
        {roundOver ? (
          // Joyful finish — the lone survivor as a winner hero, in place
          // of a pointless single-wedge wheel. Confetti fires from the
          // roundOver effect above.
          <div className="max-w-md mx-auto w-full flex flex-col items-center justify-center text-center py-10 gap-4">
            {/* Skewed brand exclamation — the celebratory "Хоба!" beat. */}
            <motion.div
              initial={{ scale: 0.3, opacity: 0, skewX: -18, rotate: -10 }}
              animate={{ scale: 1, opacity: 1, skewX: -11, rotate: -4 }}
              transition={{ type: "spring", damping: 9, stiffness: 240 }}
              className="origin-center"
            >
              <HobaWord />
            </motion.div>
            <motion.span
              key={survivor?.id}
              initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ delay: 0.15, type: "spring", damping: 12, stiffness: 220 }}
              className="text-7xl leading-none"
              aria-hidden
            >
              {survivor?.emoji ? `${survivor.emoji} ` : ""}🏆
            </motion.span>
            <h2 className="font-display font-extrabold text-3xl text-brand-amber-3">
              {t("room:elimination.winner_title", { label: survivor?.label ?? "" })}
            </h2>
            {callerIsHost ? (
              <Button variant="primary" size="lg" className="mt-2" onClick={resetRound}>
                {t("room:elimination.new_round")}
              </Button>
            ) : (
              <p className="text-sm text-ink-light-2 dark:text-ink-dark-2">
                {t("room:elimination.waiting_new_round")}
              </p>
            )}
          </div>
        ) : isBon && bonOver ? (
          // Best-of-N finish — winner hero in place of the wheel so the
          // result is unmissable without scrolling.
          <div className="max-w-md mx-auto w-full flex flex-col items-center justify-center text-center py-10 gap-4">
            {(() => {
              const winner = snapshot.active_question?.segments.find(
                (s) => s.id === bonWinnerId,
              );
              return (
                <>
                  {/* Skewed brand exclamation — the celebratory "Хоба!" beat. */}
                  <motion.div
                    initial={{ scale: 0.3, opacity: 0, skewX: -18, rotate: -10 }}
                    animate={{ scale: 1, opacity: 1, skewX: -11, rotate: -4 }}
                    transition={{ type: "spring", damping: 9, stiffness: 240 }}
                    className="origin-center"
                  >
                    <HobaWord />
                  </motion.div>
                  <motion.span
                    key={winner?.id}
                    initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    transition={{ delay: 0.15, type: "spring", damping: 12, stiffness: 220 }}
                    className="text-7xl leading-none"
                    aria-hidden
                  >
                    {winner?.emoji ? `${winner.emoji} ` : ""}🏆
                  </motion.span>
                  <h2 className="font-display font-extrabold text-3xl text-brand-amber-3">
                    {t("room:best_of_n.winner", { label: winner?.label ?? "" })}
                  </h2>
                </>
              );
            })()}
            {callerIsHost ? (
              <Button variant="primary" size="lg" className="mt-2" onClick={bestOfNReset}>
                {t("room:best_of_n.new_round")}
              </Button>
            ) : (
              <p className="text-sm text-ink-light-2 dark:text-ink-dark-2">
                {t("room:elimination.waiting_new_round")}
              </p>
            )}
          </div>
        ) : (
          <motion.div ref={wheelScope}>
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

        {/* Punishment: winner hero (game over). */}
        {punishOver && punishWinnerId !== null ? (
          <div className="max-w-md mx-auto w-full flex flex-col items-center justify-center text-center py-6 gap-3">
            <motion.div
              initial={{ scale: 0.3, opacity: 0, skewX: -18, rotate: -10 }}
              animate={{ scale: 1, opacity: 1, skewX: -11, rotate: -4 }}
              transition={{ type: "spring", damping: 9, stiffness: 240 }}
              className="origin-center"
            >
              <HobaWord />
            </motion.div>
            <span className="text-6xl leading-none" aria-hidden>
              🏆
            </span>
            <h2 className="font-display font-extrabold text-2xl text-brand-amber-3">
              {t("room:punishment.winner_title", {
                item: segLabel(
                  snapshot.room.punishment_bets?.[String(punishWinnerId)] ?? -1,
                ),
              })}
            </h2>
            {callerIsHost ? (
              <Button variant="primary" size="lg" className="mt-2" onClick={resetRound}>
                {t("room:punishment.new_round")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Punishment: betting phase — pick your option (public). */}
        {punishBetting && activeQuestion !== null ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-ink-light-1 dark:text-ink-dark-1">
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
                      className={`min-h-11 px-4 py-2 rounded-full text-sm font-semibold transition active:scale-[0.97] ${
                        picked
                          ? "bg-brand-primary text-white shadow-spin"
                          : unavailable
                            ? "bg-surface-light-2 text-ink-light-2 line-through opacity-50 dark:bg-surface-dark-2 dark:text-ink-dark-2"
                            : "bg-surface-light-2 text-ink-light-1 dark:bg-surface-dark-2 dark:text-ink-dark-1"
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
              <div className="flex flex-col items-center gap-0.5 text-xs text-ink-light-2 dark:text-ink-dark-2">
                {punishBettors.map((uid) => (
                  <span key={uid}>
                    {nameFor(uid)} →{" "}
                    {segLabel(snapshot.room.punishment_bets?.[String(uid)] ?? -1)}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="text-sm font-semibold text-ink-light-2 dark:text-ink-dark-2">
              {t("room:punishment.bet_status", {
                bet: punishBettors.length,
                total: presentUserIds.length,
              })}
            </p>
            {punishWaiting.length > 0 ? (
              <p className="text-xs text-ink-light-2 dark:text-ink-dark-2 text-center px-4">
                {t("room:punishment.waiting_bets", {
                  names: punishWaiting.map(nameFor).join(", "),
                })}
              </p>
            ) : !canStartPunish && punishStarter !== null ? (
              <p className="text-xs text-ink-light-2 dark:text-ink-dark-2">
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
                // Highlight the viewer's OWN row so they always know which
                // option is theirs throughout the game.
                const isMe = uid === snapshot.me_user_id;
                return (
                  <span
                    key={uid}
                    className={`rounded-full px-2.5 py-1 ${
                      isMe
                        ? "bg-brand-primary text-white font-semibold ring-2 ring-brand-primary/40"
                        : "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1"
                    }`}
                  >
                    {isMe ? `★ ${t("room:punishment.you")}` : nameFor(uid)}
                    {betSeg !== undefined ? ` (${segLabel(betSeg)})` : ""}{" "}
                    {matchCount(snapshot, uid)}/{matchesToWin(snapshot)}
                  </span>
                );
              })}
            </div>
            {punishPending !== null ? (
              punishPendingApproval ? (
                // Dare was performed ("Done"): the dare card is gone; only a
                // slim approval prompt remains for the chosen approver.
                <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 px-4 py-3 text-center w-full">
                  {mustApprove ? (
                    <>
                      <p className="text-sm font-semibold text-ink-light-1 dark:text-ink-dark-1">
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
                    <p className="text-sm text-ink-light-2 dark:text-ink-dark-2">
                      {t("room:punishment.waiting_approval", {
                        name: nameFor(punishApproverUserId ?? 0),
                      })}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-xl bg-gradient-to-br from-brand-primary to-brand-amber-3 p-4 text-center text-white shadow-spin">
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
              <div className="flex flex-col items-center gap-1 rounded-xl bg-brand-amber-3/15 px-4 py-3 text-center">
                <HobaWord sizeClass="text-4xl" />
                <p className="text-sm font-semibold text-ink-light-1 dark:text-ink-dark-1">
                  <span className="font-display font-bold text-brand-violet-2">
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
            <span className="text-sm font-semibold text-ink-light-2 dark:text-ink-dark-2">
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
                      className="text-xs font-semibold px-2 py-1 rounded-full bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1"
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
                className="text-xs px-2 py-1 rounded-full grayscale opacity-60 bg-surface-light-2 dark:bg-surface-dark-2 line-through"
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
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-3">
              {t("room:spin.host_only_hint")}
            </p>
          ) : null}
        </div>

        <FlyingReactions />

        {/* Bet-race modes (Punishment, Chaos) are turn_based-only — no
            spin_policy to configure, so the settings gear is hidden. */}
        {callerIsHost && !isRace ? (
          <RoomSettingsSheet
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
            }}
            snapshot={snapshot}
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
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-6 text-center bg-bg-light/95 dark:bg-bg-dark/95 pointer-events-none"
              aria-live="assertive"
              role="status"
            >
              <HobaWord sizeClass="text-5xl sm:text-6xl" />
              {chaosAnnounce === "swap" ? (
                // Show the two sectors actually trading places so it's clear
                // WHICH swapped (the on-wheel swap alone reads as invisible).
                <div className="relative h-20 w-64 mt-1" aria-hidden>
                  <motion.span
                    className="absolute top-6 left-0 max-w-[45%] truncate text-base font-bold px-3 py-1 rounded-full bg-surface-light-2 dark:bg-surface-dark-2"
                    animate={{ x: [0, 0, 150, 150], y: [0, -24, -24, 0] }}
                    transition={{ duration: 1.1, times: [0, 0.25, 0.75, 1], ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
                  >
                    {segLabel(currentSpin?.mode_effects?.swap_pair?.[0] ?? -1) || "🔀"}
                  </motion.span>
                  <motion.span
                    className="absolute top-6 right-0 max-w-[45%] truncate text-base font-bold px-3 py-1 rounded-full bg-surface-light-2 dark:bg-surface-dark-2"
                    animate={{ x: [0, 0, -150, -150], y: [0, 24, 24, 0] }}
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
              <p className="text-sm text-ink-light-2 dark:text-ink-dark-2">
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
                className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-bg-light/95 dark:bg-bg-dark/95 cursor-pointer"
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
                  <p className="font-display font-bold text-2xl text-center px-6 text-ink-light-1 dark:text-ink-dark-1">
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
                className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center bg-bg-light/95 dark:bg-bg-dark/95 cursor-pointer"
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
      </main>
    </>
  );
}
