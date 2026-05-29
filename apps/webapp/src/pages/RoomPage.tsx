import { AnimatePresence, motion, useAnimate } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
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
import { RoomSettingsSheet } from "@/components/room/RoomSettingsSheet";
import {
  eliminatedSegments,
  isRoundOver,
  livingSegments,
  remainingCount,
} from "@/features/rooms/elimination";
import { computeCanSpin, isHost } from "@/features/rooms/permissions";
import {
  attempts as bonAttemptsCount,
  isBestOfN,
  roundOver,
  roundWinnerId,
  tally as bonTallyMap,
  target as bonTargetCount,
} from "@/features/rooms/bestOfN";
import { activeCard, doneCount } from "@/features/rooms/punishment";
import { computeTurnState } from "@/features/rooms/turnState";
import { Wheel } from "@/features/wheel/Wheel";
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

  // Punishment view-state.
  const isPunish = snapshot?.room.game_mode === "punishment";
  const pendingCard = activeCard(snapshot);
  const punishDone = doneCount(snapshot);
  const markPunishmentDone = useRoomStore((s) => s.markPunishmentDone);

  // Best-of-N view-state.
  const isBon = isBestOfN(snapshot);
  const bonAttempts = bonAttemptsCount(snapshot);
  const bonTarget = bonTargetCount(snapshot);
  const bonTally = bonTallyMap(snapshot);
  const bonWinnerId = roundWinnerId(snapshot);
  const bonOver = roundOver(snapshot);
  const bestOfNReset = useRoomStore((s) => s.bestOfNReset);

  // Each spin is a single full animation, then settle + reveal.
  useEffect(() => {
    if (currentSpin === null) {
      setWheelState("idle");
      setRevealed(false);
      return undefined;
    }
    setWheelState("spinning");
    setRevealed(false);

    const settleAt = window.setTimeout(() => {
      haptics.heavy();
      haptics.success();
      audio.play("result_chime");
      setWheelState("settled");
    }, currentSpin.duration_ms);

    const revealAt = window.setTimeout(() => {
      audio.play("hoba_pop");
      if (!isElimination) fireConfetti();
      setRevealed(true);
    }, currentSpin.duration_ms + (isElimination ? ELIM_REVEAL_DELAY_MS : REVEAL_DELAY_MS));

    return () => {
      window.clearTimeout(settleAt);
      window.clearTimeout(revealAt);
    };
  }, [currentSpin?.spin_id, currentSpin, isElimination]);

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
    return snapshot.active_question.segments
      .filter((s) => !s.is_eliminated)
      .map((s) => ({
        id: String(s.id),
        label: s.label,
        emoji: s.emoji ?? undefined,
        colorSeed: s.color_seed,
      }));
  }, [snapshot]);

  const winningSegmentIndex = useMemo(() => {
    if (currentSpin === null || segments.length === 0) return -1;
    const list = snapshot?.active_question?.segments ?? [];
    return list.findIndex((s) => s.id === currentSpin.result_segment_id);
  }, [currentSpin, segments, snapshot]);

  const wheelSpin: SpinResult | undefined = useMemo(() => {
    if (currentSpin === null || winningSegmentIndex < 0) return undefined;
    return {
      resultSegmentIndex: winningSegmentIndex,
      finalAngleDeg: currentSpin.final_angle_deg,
      durationMs: currentSpin.duration_ms,
      seed: currentSpin.seed,
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
            {callerIsHost ? (
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
            {t("room:punishment.tally", { count: punishDone })}
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
            <motion.span
              key={survivor?.id}
              initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: "spring", damping: 12, stiffness: 220 }}
              className="text-7xl leading-none"
              aria-hidden
            >
              {survivor?.emoji ?? "🏆"}
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
        ) : (
          <motion.div ref={wheelScope}>
            <Wheel
              segments={segments}
              state={wheelState}
              spin={wheelSpin}
              ariaLabel={snapshot.active_question?.text ?? t("room:header.wheel_aria")}
              // Only attach the hub-tap handler when this user is actually
              // allowed to spin (host_only policy) — otherwise the hub
              // would invite a tap that the server then rejects.
              onSpinClick={canSpin && !pendingCard && !bonOver ? triggerSpin : undefined}
              className="max-w-md mx-auto"
            />
          </motion.div>
        )}

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
          {!canSpin && idleish && turnState.kind === "not_turn_based" && !roundOver ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-3">
              {t("room:spin.host_only_hint")}
            </p>
          ) : null}
          {isPunish && pendingCard ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-2">
              {t("room:punishment.pending_hint")}
            </p>
          ) : null}
          {isBon && bonOver ? (
            <div className="text-center py-2">
              <p className="text-lg font-display font-bold text-brand-amber-3">
                {t("room:best_of_n.winner", {
                  label:
                    snapshot.active_question?.segments.find(
                      (s) => s.id === bonWinnerId,
                    )?.label ?? "",
                })}
              </p>
              {callerIsHost ? (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="mt-3"
                  onClick={bestOfNReset}
                >
                  {t("room:best_of_n.new_round")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <FlyingReactions />

        {callerIsHost ? (
          <RoomSettingsSheet
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
            }}
            snapshot={snapshot}
          />
        ) : null}

        <AnimatePresence>
          {isPunish && pendingCard ? (
            <motion.div
              key="punish-card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center gap-5 bg-bg-light/92 dark:bg-bg-dark/92 backdrop-blur-sm"
              aria-live="polite"
              role="status"
            >
              <motion.div
                initial={{ scale: 0.6, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={{ type: "spring", damping: 16, stiffness: 240 }}
                className="w-full max-w-sm rounded-2xl p-6 shadow-spin bg-gradient-to-br from-brand-primary to-brand-amber-3 text-white"
              >
                <p className="text-xs uppercase tracking-widest opacity-85 mb-2">
                  {t(`room:punishment.deck_${pendingCard.deck}.label`)}
                </p>
                {(() => {
                  const victim = snapshot?.active_question?.segments.find(
                    (s) => s.id === pendingCard.victim_segment_id,
                  );
                  return victim !== undefined ? (
                    <p className="text-sm font-semibold mb-3">
                      {t("room:punishment.victim_card", {
                        victim: `${victim.emoji ? `${victim.emoji} ` : ""}${victim.label}`,
                      })}
                    </p>
                  ) : null;
                })()}
                <p className="text-2xl font-display font-extrabold leading-snug">
                  {pendingCard.text}
                </p>
              </motion.div>
              <Button variant="accent" size="xl" onClick={markPunishmentDone}>
                {t("room:punishment.done")}
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {revealed && winningSegment !== undefined && !roundOver && !isPunish ? (
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
                className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-bg-light/85 dark:bg-bg-dark/85 backdrop-blur-sm cursor-pointer"
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
                className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center bg-bg-light/90 dark:bg-bg-dark/90 backdrop-blur-sm cursor-pointer"
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
