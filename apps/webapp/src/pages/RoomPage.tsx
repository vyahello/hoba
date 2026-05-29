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

const REVEAL_DELAY_MS = 1500;

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
      fireConfetti();
      setRevealed(true);
    }, currentSpin.duration_ms + REVEAL_DELAY_MS);

    return () => {
      window.clearTimeout(settleAt);
      window.clearTimeout(revealAt);
    };
  }, [currentSpin?.spin_id, currentSpin]);

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
    haptics.medium();
    void animateWheel(wheelScope.current, { scale: [1, 0.97, 1] }, { duration: 0.3, ease: "easeInOut" });
  }, [settledSpinId, settledEliminatedId, animateWheel, wheelScope]);

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

  const isElimination = snapshot?.room.game_mode === "elimination";
  const activeQuestion = snapshot?.active_question ?? null;
  const remaining = remainingCount(activeQuestion);
  const roundOver = isElimination && isRoundOver(activeQuestion);
  const survivor = roundOver ? livingSegments(activeQuestion)[0] : undefined;
  const resetRound = useRoomStore((s) => s.resetRound);

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
      </section>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4 relative">
        <motion.div ref={wheelScope}>
          <Wheel
            segments={segments}
            state={wheelState}
            spin={wheelSpin}
            ariaLabel={snapshot.active_question?.text ?? t("room:header.wheel_aria")}
            // Only attach the hub-tap handler when this user is actually
            // allowed to spin (host_only policy) — otherwise the hub
            // would invite a tap that the server then rejects.
            onSpinClick={canSpin && !roundOver ? triggerSpin : undefined}
            className="max-w-md mx-auto"
          />
        </motion.div>

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
          {roundOver ? (
            <div className="text-center py-3">
              <p className="text-lg font-display font-bold text-brand-amber-3">
                {t("room:elimination.survivor", { label: survivor?.label ?? "" })}
              </p>
              {callerIsHost ? (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="mt-3"
                  onClick={resetRound}
                >
                  {t("room:elimination.new_round")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {canSpin && wheelState === "idle" && !roundOver ? (
            <Button variant="accent" size="xl" fullWidth onClick={triggerSpin}>
              {t("common:actions.spin").toUpperCase()}
            </Button>
          ) : null}
          {!canSpin && wheelState === "idle" && turnState.kind === "not_turn_based" && !roundOver ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-3">
              {t("room:spin.host_only_hint")}
            </p>
          ) : null}
          {wheelState === "idle" && turnState.kind === "my_turn" && !roundOver ? (
            <p className="text-center text-sm font-medium text-brand-amber-3 py-3">
              {t("room:turn.my_turn")}
            </p>
          ) : null}
          {wheelState === "idle" && turnState.kind === "waiting" && !roundOver ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-3">
              {turnState.whoName !== null
                ? t("room:turn.waiting_named", { name: turnState.whoName })
                : t("room:turn.waiting_unnamed")}
            </p>
          ) : null}
          {wheelState === "idle" && turnState.kind === "no_one" && !roundOver ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-3">
              {t("room:turn.no_one")}
            </p>
          ) : null}
          {wheelState === "spinning" ? (
            <Button variant="accent" size="xl" fullWidth disabled loading>
              {t("common:actions.spin").toUpperCase()}…
            </Button>
          ) : null}
          {wheelState === "settled" && canSpin && !roundOver ? (
            <Button variant="primary" size="lg" fullWidth onClick={triggerSpin}>
              {t("common:actions.spin")} →
            </Button>
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
          {revealed && winningSegment !== undefined ? (
            <motion.div
              key="result"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center bg-bg-light/90 dark:bg-bg-dark/90 backdrop-blur-sm"
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
              <Button
                variant="ghost"
                onClick={() => {
                  setRevealed(false);
                }}
                className="mt-4"
              >
                {t("common:actions.close")}
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </>
  );
}
