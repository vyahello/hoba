import { AnimatePresence, motion } from "framer-motion";
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
import { FlyingReactions } from "@/components/room/FlyingReactions";
import { ReactionsBar } from "@/components/room/ReactionsBar";
import { computeCanSpin } from "@/features/rooms/permissions";
import { Wheel } from "@/features/wheel/Wheel";
import {
  type SegmentDef,
  type SpinResult,
  type WheelState,
} from "@/features/wheel/types";
import { haptics } from "@/lib/haptics";
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

  const segments: SegmentDef[] = useMemo(() => {
    if (snapshot?.active_question == null) return [];
    return snapshot.active_question.segments.map((s) => ({
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
              navigate(-1);
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
            navigate(-1);
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

      <section className="px-4 pt-3 flex items-center gap-3">
        <RoomCodePill code={snapshot.room.code} />
        <IconButton
          aria-label={t("room:actions.share")}
          variant="filled"
          size="md"
          icon={<span aria-hidden>📤</span>}
          onClick={() => {
            void handleShare();
          }}
        />
      </section>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4 relative">
        <Wheel
          segments={segments}
          state={wheelState}
          spin={wheelSpin}
          ariaLabel={snapshot.active_question?.text ?? t("room:header.wheel_aria")}
          // Only attach the hub-tap handler when this user is actually
          // allowed to spin (host_only policy) — otherwise the hub
          // would invite a tap that the server then rejects.
          onSpinClick={canSpin ? triggerSpin : undefined}
          className="max-w-md mx-auto"
        />

        <div className="mt-auto flex flex-col gap-3">
          <ReactionsBar />
          {canSpin && wheelState === "idle" ? (
            <Button variant="accent" size="xl" fullWidth onClick={triggerSpin}>
              {t("common:actions.spin").toUpperCase()}
            </Button>
          ) : null}
          {!canSpin && wheelState === "idle" ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-3">
              {t("room:spin.host_only_hint")}
            </p>
          ) : null}
          {wheelState === "spinning" ? (
            <Button variant="accent" size="xl" fullWidth disabled loading>
              {t("common:actions.spin").toUpperCase()}…
            </Button>
          ) : null}
          {wheelState === "settled" && canSpin ? (
            <Button variant="primary" size="lg" fullWidth onClick={triggerSpin}>
              {t("common:actions.spin")} →
            </Button>
          ) : null}
        </div>

        <FlyingReactions />

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
