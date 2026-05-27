import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ds/Button";
import { IconButton } from "@/components/ds/IconButton";
import { Input, Textarea } from "@/components/ds/Input";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { useCustomWheel } from "@/stores/spinHistory";

const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 12;
const QUESTION_LIMIT = 80;
const SEGMENT_LIMIT = 60;

interface DraftSegment {
  id: string;
  label: string;
}

function makeSegmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `seg-${Math.random().toString(36).slice(2, 10)}`;
}

const STARTER_SEGMENTS: DraftSegment[] = [
  { id: makeSegmentId(), label: "" },
  { id: makeSegmentId(), label: "" },
];

export function CreatePage(): JSX.Element {
  const { t } = useTranslation(["create", "common"]);
  const navigate = useNavigate();
  const setCustomWheel = useCustomWheel((s) => s.set);

  const [question, setQuestion] = useState("");
  const [segments, setSegments] = useState<DraftSegment[]>(STARTER_SEGMENTS);

  const nonEmptyCount = segments.filter((s) => s.label.trim().length > 0).length;
  const canSpin = nonEmptyCount >= MIN_SEGMENTS && question.trim().length > 0;

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
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, label } : s)),
    );
  }

  function handleSpin(): void {
    if (!canSpin) return;
    const cleaned = segments
      .map((s, i) => ({
        id: s.id,
        label: s.label.trim(),
        colorSeed: i % 12,
      }))
      .filter((s) => s.label.length > 0);

    setCustomWheel({
      id: "custom",
      source: "custom",
      questionText: question.trim(),
      segments: cleaned,
    });
    haptics.heavy();
    navigate("/spin/custom");
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
          {t("create:title")}
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

        <div className="mt-auto">
          <Button
            variant="accent"
            size="xl"
            fullWidth
            disabled={!canSpin}
            onClick={handleSpin}
          >
            {t("create:spin_solo")}
          </Button>
          {!canSpin && nonEmptyCount < MIN_SEGMENTS ? (
            <p className="mt-2 text-xs text-ink-light-2 dark:text-ink-dark-2 text-center">
              {t("create:too_few")}
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}
