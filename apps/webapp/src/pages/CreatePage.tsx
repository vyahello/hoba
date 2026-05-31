import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ds/Button";
import { IconButton } from "@/components/ds/IconButton";
import { Input, Textarea } from "@/components/ds/Input";
import { splitEmoji } from "@/features/wheel/emoji";
import { type SavedWheel, api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { useCustomWheel } from "@/stores/spinHistory";
import { toast } from "@/stores/toast";

const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 12;
const QUESTION_LIMIT = 80;
const SEGMENT_LIMIT = 60;
// Generous enough for ZWJ sequences + flags (multiple UTF-16 units = one glyph).
const EMOJI_LIMIT = 16;

interface DraftSegment {
  id: string;
  label: string;
  /** Preserved through edit (the builder edits labels only, not emoji/colour). */
  emoji?: string;
  colorSeed?: number;
}

function makeSegmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `seg-${Math.random().toString(36).slice(2, 10)}`;
}

function starterSegments(): DraftSegment[] {
  return [
    { id: makeSegmentId(), label: "" },
    { id: makeSegmentId(), label: "" },
  ];
}

export function CreatePage(): JSX.Element {
  const { t } = useTranslation(["create", "common"]);
  const navigate = useNavigate();
  const location = useLocation();
  const setCustomWheel = useCustomWheel((s) => s.set);

  // When navigated from the library "Edit" action, prefill + save = update.
  const editWheel = (location.state as { editWheel?: SavedWheel } | null)?.editWheel;
  const [editId] = useState<number | null>(editWheel?.id ?? null);
  const [question, setQuestion] = useState(editWheel?.title ?? "");
  const [segments, setSegments] = useState<DraftSegment[]>(
    editWheel
      ? editWheel.segments.map((s) => ({
          id: makeSegmentId(),
          label: s.label,
          emoji: s.emoji ?? undefined,
          colorSeed: s.color_seed,
        }))
      : starterSegments(),
  );
  const [saving, setSaving] = useState(false);

  const nonEmptyCount = segments.filter((s) => s.label.trim().length > 0).length;
  const ready = nonEmptyCount >= MIN_SEGMENTS && question.trim().length > 0;

  function addSegment(): void {
    if (segments.length >= MAX_SEGMENTS) return;
    haptics.selection();
    setSegments((prev) => [...prev, { id: makeSegmentId(), label: "" }]);
  }

  function removeSegment(id: string): void {
    if (segments.length <= MIN_SEGMENTS) return;
    haptics.warning();
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSegment(id: string, label: string): void {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  }

  function updateSegmentEmoji(id: string, emoji: string): void {
    const trimmed = emoji.trim();
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, emoji: trimmed === "" ? undefined : trimmed } : s)),
    );
  }

  /** Cleaned, non-empty segments with stable colours + promoted emoji.
   *
   * If the segment has no explicit emoji (a fresh custom wheel), lift any
   * emoji the user typed into the label up to the dedicated `emoji` slot so
   * it renders large on the wheel — matching the built-in presets. */
  function cleanedSegments(): Array<{ label: string; emoji?: string; colorSeed: number }> {
    return segments
      .map((s, i) => {
        const split = s.emoji ? { emoji: s.emoji, label: s.label.trim() } : splitEmoji(s.label);
        return { label: split.label, emoji: split.emoji, colorSeed: s.colorSeed ?? i % 12 };
      })
      .filter((s) => s.label.length > 0);
  }

  function handleSpin(): void {
    if (!ready) return;
    setCustomWheel({
      id: "custom",
      source: "custom",
      questionText: question.trim(),
      segments: cleanedSegments().map((s, i) => ({
        id: `seg-${i}`,
        label: s.label,
        emoji: s.emoji,
        colorSeed: s.colorSeed,
      })),
    });
    haptics.heavy();
    navigate("/spin/custom");
  }

  async function handleSave(): Promise<void> {
    if (!ready || saving) return;
    setSaving(true);
    const payload = {
      title: question.trim(),
      segments: cleanedSegments().map((s) => ({
        label: s.label,
        emoji: s.emoji ?? null,
        color_seed: s.colorSeed,
      })),
    };
    try {
      if (editId !== null) {
        await api.updateWheel(editId, payload);
      } else {
        await api.createWheel(payload);
      }
      haptics.success();
      toast({ title: t("create:saved"), intent: "success" });
      navigate("/library");
    } catch {
      toast({ title: t("create:save_failed"), intent: "error" });
      setSaving(false);
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
        <h1 className="font-display font-bold text-xl flex-1 truncate text-ink-light-1 dark:text-ink-dark-1">
          {editId !== null ? t("create:edit_title") : t("create:title")}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-5">
        <Textarea
          label={t("create:question_label")}
          placeholder={t("create:question_placeholder")}
          counter={QUESTION_LIMIT}
          maxLength={QUESTION_LIMIT}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          rows={2}
        />

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display font-bold text-lg text-ink-light-1 dark:text-ink-dark-1">
              {t("create:segments_label")}
            </h2>
            <span className="text-xs font-mono tabular-nums text-ink-light-2 dark:text-ink-dark-2">
              {segments.length}/{MAX_SEGMENTS}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {segments.map((segment, index) => (
              <div key={segment.id} className="flex items-end gap-2">
                <Input
                  label={t("create:emoji_label")}
                  placeholder="🙂"
                  value={segment.emoji ?? ""}
                  maxLength={EMOJI_LIMIT}
                  inputMode="text"
                  onChange={(e) => {
                    updateSegmentEmoji(segment.id, e.target.value);
                  }}
                  className="w-16 shrink-0 text-center text-xl"
                />
                <Input
                  label={t("create:segment_placeholder", { index: index + 1 })}
                  placeholder={t("create:segment_placeholder", { index: index + 1 })}
                  value={segment.label}
                  maxLength={SEGMENT_LIMIT}
                  onChange={(e) => {
                    updateSegment(segment.id, e.target.value);
                  }}
                  className="flex-1"
                />
                {segments.length > MIN_SEGMENTS ? (
                  <IconButton
                    aria-label={t("create:remove_segment")}
                    variant="ghost"
                    icon={<span aria-hidden>✕</span>}
                    onClick={() => {
                      removeSegment(segment.id);
                    }}
                    className="mb-[2px]"
                  />
                ) : null}
              </div>
            ))}
          </div>
          {segments.length < MAX_SEGMENTS ? (
            <Button
              variant="ghost"
              onClick={addSegment}
              fullWidth
              icon={<span aria-hidden>+</span>}
            >
              {t("create:add_segment")}
            </Button>
          ) : (
            <p className="text-xs text-ink-light-2 dark:text-ink-dark-2 text-center">
              {t("create:too_many")}
            </p>
          )}
        </section>

        <div className="mt-auto flex flex-col gap-2">
          <Button
            variant="accent"
            size="xl"
            fullWidth
            disabled={!ready}
            onClick={handleSpin}
          >
            {t("create:spin_solo")}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            disabled={!ready}
            loading={saving}
            onClick={() => {
              void handleSave();
            }}
          >
            {editId !== null ? t("create:save_changes") : t("create:save_to_library")}
          </Button>
          {!ready && nonEmptyCount < MIN_SEGMENTS ? (
            <p className="text-xs text-ink-light-2 dark:text-ink-dark-2 text-center">
              {t("create:too_few")}
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
