import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { audio } from "@/audio";
import { Button } from "@/components/ds/Button";
import { fireConfetti } from "@/components/ds/ConfettiBurst";
import { HobaWord } from "@/components/ds/HobaWord";
import { IconButton } from "@/components/ds/IconButton";
import { ResultBanner } from "@/components/ds/ResultBanner";
import { RoomModePickerSheet } from "@/components/room/RoomModePickerSheet";
import { findQuickWheel, type QuickWheel } from "@/data/quickWheels";
import { Wheel, type WheelHandle } from "@/features/wheel/Wheel";
import { freshSeed } from "@/features/wheel/seededRandom";
import { computeSpin } from "@/features/wheel/spinMath";
import {
  type SegmentDef,
  type SpinResult,
  type WheelDef,
  type WheelState,
} from "@/features/wheel/types";
import { api, ApiError, type GameMode, type PunishmentDeck } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { disableVerticalSwipes, enableVerticalSwipes } from "@/lib/telegram";
import { useCustomWheel, useSpinHistory } from "@/stores/spinHistory";
import { toast } from "@/stores/toast";
import { WHEEL_PALETTE } from "../../tailwind.config";

// Short beat between the wheel stopping and the result reveal — long
// enough to register the landed segment, short enough to feel instant.
const REVEAL_DELAY_MS = 400;

function buildQuickWheelDef(
  quick: QuickWheel,
  t: (key: string) => string,
): WheelDef {
  return {
    id: `quick:${quick.id}`,
    source: "quick",
    questionText: t(`home:${quick.titleKey}`),
    segments: quick.segments.map((s) => ({
      id: s.key,
      label: t(`home:quick_segments.${quick.id}.${s.key}`),
      emoji: s.emoji,
      colorSeed: s.colorSeed,
    })),
  };
}

export function SpinPage(): JSX.Element {
  const { wheelId = "" } = useParams<{ wheelId: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["home", "common", "brand", "room"]);
  const customWheel = useCustomWheel((s) => s.current);
  const addToHistory = useSpinHistory((s) => s.add);

  const wheel = useMemo<WheelDef | undefined>(() => {
    if (wheelId === "custom") return customWheel;
    const quick = findQuickWheel(wheelId);
    return quick !== undefined ? buildQuickWheelDef(quick, t) : undefined;
  }, [wheelId, customWheel, t]);

  const [state, setState] = useState<WheelState>("idle");
  const [spin, setSpin] = useState<SpinResult | undefined>(undefined);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [resultRevealed, setResultRevealed] = useState(false);
  const wheelRef = useRef<WheelHandle>(null);

  // Spin screen: block Telegram's vertical swipe-to-close + overscroll so a
  // stray downward drag mid-spin can't pull the Mini App shut. Restored on
  // leave. (Paired with `overscroll-none` on the scroll container below.)
  useEffect(() => {
    disableVerticalSwipes();
    return () => {
      enableVerticalSwipes();
    };
  }, []);

  const result = useMemo(() => {
    if (!resultRevealed || spin === undefined || wheel === undefined) return undefined;
    const segment = wheel.segments[spin.resultSegmentIndex];
    if (segment === undefined) return undefined;
    return {
      segment,
      color: WHEEL_PALETTE[segment.colorSeed % WHEEL_PALETTE.length] ?? "#7C5CFF",
    };
  }, [resultRevealed, spin, wheel]);

  // When a wheel changes (e.g. user backs out + into a different preset),
  // reset state.
  useEffect(() => {
    setState("idle");
    setSpin(undefined);
    setResultRevealed(false);
  }, [wheelId]);

  // Wire the post-spin reveal sequence. Keyed on `spin` only (NOT
  // wheelState) — otherwise setState("settled") inside the settle timer
  // re-runs this effect, whose cleanup clears the not-yet-fired reveal
  // timer, and the result overlay never appears.
  useEffect(() => {
    if (spin === undefined) return undefined;
    const settleAt = window.setTimeout(() => {
      haptics.heavy();
      haptics.success();
      audio.play("result_chime");
      setState("settled");
    }, spin.durationMs);

    const revealAt = window.setTimeout(() => {
      audio.play("hoba_pop");
      fireConfetti();
      setResultRevealed(true);
    }, spin.durationMs + REVEAL_DELAY_MS);

    return () => {
      window.clearTimeout(settleAt);
      window.clearTimeout(revealAt);
    };
  }, [spin]);

  // The result auto-dismisses (no manual close) — tap to skip. Falls back
  // to the settled wheel so the centered hub can re-spin straight away.
  useEffect(() => {
    if (!resultRevealed) return undefined;
    const timer = window.setTimeout(() => {
      setResultRevealed(false);
      setState("settled");
    }, 2500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [resultRevealed]);

  // Record settled spin once revealed.
  useEffect(() => {
    if (!resultRevealed || spin === undefined || wheel === undefined) return;
    const segment = wheel.segments[spin.resultSegmentIndex];
    if (segment === undefined) return;
    addToHistory({
      wheelId: wheel.id,
      questionText: wheel.questionText,
      segmentLabel: segment.label,
      segmentEmoji: segment.emoji,
      segmentColor:
        WHEEL_PALETTE[segment.colorSeed % WHEEL_PALETTE.length] ?? "#7C5CFF",
      timestamp: Date.now(),
    });
  }, [resultRevealed, spin, wheel, addToHistory]);

  if (wheel === undefined) {
    return (
      <>
        <header className="ds-glass-header px-4 py-3 pt-safe">
          <h1 className="font-display font-bold text-xl">
            {t("brand:exclamation")}
          </h1>
        </header>
        <main className="flex-1 px-4 pt-8 flex flex-col items-center text-center gap-4">
          <p className="text-lg font-medium">{t("common:not_found.wheel")}</p>
          <Button
            onClick={() => {
              navigate("/");
            }}
          >
            {t("common:nav.home")}
          </Button>
        </main>
      </>
    );
  }

  function handleSpin(): void {
    // Allow re-spin directly from `settled` (the hub stays tappable after
    // a result lands per hubLogic). Only block while the animation is
    // already mid-flight.
    if (state === "spinning" || wheel === undefined) return;
    // Pass the wheel's current rotation so the new spin always travels
    // forward at least MIN_FULL_ROTATIONS revolutions — fixes the bug
    // where the second spin barely moved / the third reversed direction.
    const startingAngleDeg = wheelRef.current?.getCurrentRotation() ?? 0;
    const next = computeSpin({
      segmentCount: wheel.segments.length,
      seed: freshSeed(),
      startingAngleDeg,
    });
    setSpin(next);
    setResultRevealed(false);
    setState("spinning");
  }

  function handleInviteFriends(): void {
    if (wheel === undefined || inviteLoading) return;
    haptics.medium();
    setModePickerOpen(true);
  }

  async function handleCreateRoom(
    mode: GameMode, deck?: PunishmentDeck, spinCount?: number,
  ): Promise<void> {
    if (wheel === undefined || inviteLoading) return;
    setInviteLoading(true);
    try {
      // Template wheels re-resolve canonically server-side (the client only
      // ever held a localized view); custom/quick wheels send their segments.
      const state =
        wheel.source === "template" && wheel.templateKey !== undefined
          ? await api.createRoomFromTemplate({
              template_key: wheel.templateKey,
              locale: i18n.language,
              game_mode: mode,
              ...(deck !== undefined ? { punishment_deck: deck } : {}),
              ...(spinCount !== undefined ? { spin_count: spinCount } : {}),
            })
          : await api.createRoom({
              question_text: wheel.questionText,
              segments: wheel.segments.map((s) => ({
                label: s.label,
                emoji: s.emoji ?? null,
                color_seed: s.colorSeed,
                weight: s.weight ?? 1,
              })),
              game_mode: mode,
              ...(deck !== undefined ? { punishment_deck: deck } : {}),
              ...(spinCount !== undefined ? { spin_count: spinCount } : {}),
            });
      navigate(`/room/${state.room.code}`);
    } catch (exc) {
      const code = exc instanceof ApiError ? exc.code : "create_failed";
      const key = `room:errors.${code}`;
      const localized = t(key);
      const message = localized === key ? t("room:errors.fallback") : localized;
      toast({ title: message, intent: "error" });
      setInviteLoading(false);
    }
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
        <h1 className="font-display font-bold text-lg flex-1 min-w-0 truncate text-ds-text">
          {wheel.questionText}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-5 relative overscroll-none">
        <Wheel
          ref={wheelRef}
          segments={wheel.segments as SegmentDef[]}
          state={state}
          spin={spin}
          onSpinClick={handleSpin}
          ariaLabel={wheel.questionText}
          className="max-w-md mx-auto"
        />

        <div className="flex flex-col gap-2 mt-auto">
          {/* Spin is the centered wheel hub only. The bottom CTA creates a
              multiplayer room (opens the mode picker first). */}
          {state !== "spinning" ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleInviteFriends}
              loading={inviteLoading}
            >
              {t("room:actions.create_room")}
            </Button>
          ) : null}
        </div>

        <AnimatePresence>
          {resultRevealed && result !== undefined ? (
            <motion.div
              key="result-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => {
                setResultRevealed(false);
                setState("settled");
              }}
              className="absolute inset-0 z-10 px-4 pt-3 pb-6 flex flex-col items-center justify-center bg-ds-bg cursor-pointer"
              aria-live="polite"
              role="status"
            >
              <HobaWord />
              <ResultBanner
                segmentLabel={result.segment.label}
                segmentEmoji={result.segment.emoji}
                segmentColor={result.color}
                className="mt-6 w-full max-w-sm"
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      <RoomModePickerSheet
        open={modePickerOpen}
        loading={inviteLoading}
        onClose={() => {
          setModePickerOpen(false);
        }}
        onCreate={(mode, deck, spinCount) => {
          void handleCreateRoom(mode, deck, spinCount);
        }}
      />
    </>
  );
}
