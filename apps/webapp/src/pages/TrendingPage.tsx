import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { IconButton } from "@/components/ds/IconButton";
import { Input } from "@/components/ds/Input";
import { Skeleton } from "@/components/ds/Skeleton";
import { RoomModePickerSheet } from "@/components/room/RoomModePickerSheet";
import { PublicWheelCard } from "@/components/trending/PublicWheelCard";
import { type GameMode, type PunishmentDeck, type SavedWheel, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { toast } from "@/stores/toast";

const CATEGORIES = ["food", "social", "fun", "party", "decide", "other"] as const;
type Category = (typeof CATEGORIES)[number];

export function TrendingPage(): JSX.Element {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();

  const [wheels, setWheels] = useState<SavedWheel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [useId, setUseId] = useState<number | null>(null);
  const [useLoading, setUseLoading] = useState(false);
  const [reportConfirmId, setReportConfirmId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setWheels(null);
    const trimmed = query.trim();
    const fetcher =
      trimmed.length > 0
        ? api.searchTrending(trimmed)
        : api.listTrending(category !== null ? { category } : {});
    const timer = window.setTimeout(() => {
      void fetcher
        .then((list) => {
          if (!cancelled) setWheels(list);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, trimmed.length > 0 ? 250 : 0); // debounce search input
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, category]);

  function patchWheel(id: number, patch: Partial<SavedWheel>): void {
    setWheels((prev) => (prev ?? []).map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  async function handleLike(wheel: SavedWheel): Promise<void> {
    haptics.medium();
    // Optimistic toggle; reconcile with the server's authoritative count.
    const optimistic = !wheel.liked;
    patchWheel(wheel.id, {
      liked: optimistic,
      like_count: wheel.like_count + (optimistic ? 1 : -1),
    });
    try {
      const res = await api.likeWheel(wheel.id);
      patchWheel(wheel.id, { liked: res.liked, like_count: res.like_count });
    } catch {
      patchWheel(wheel.id, { liked: wheel.liked, like_count: wheel.like_count });
      toast({ title: t("home:trending.like_failed"), intent: "error" });
    }
  }

  async function handleReport(wheel: SavedWheel): Promise<void> {
    if (reportConfirmId !== wheel.id) {
      haptics.warning();
      setReportConfirmId(wheel.id);
      return;
    }
    setReportConfirmId(null);
    try {
      await api.reportWheel({ wheel_id: wheel.id });
      haptics.success();
      toast({ title: t("home:trending.reported"), intent: "success" });
    } catch {
      toast({ title: t("home:trending.report_failed"), intent: "error" });
    }
  }

  async function handleUse(
    mode: GameMode, deck?: PunishmentDeck, spinCount?: number,
  ): Promise<void> {
    if (useId === null || useLoading) return;
    setUseLoading(true);
    try {
      const state = await api.useWheel(useId, {
        game_mode: mode,
        ...(deck !== undefined ? { punishment_deck: deck } : {}),
        ...(spinCount !== undefined ? { spin_count: spinCount } : {}),
      });
      navigate(`/room/${state.room.code}`);
    } catch {
      toast({ title: t("home:trending.use_failed"), intent: "error" });
      setUseLoading(false);
      setUseId(null);
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
        <h1 className="font-display font-bold text-xl flex-1 truncate text-ds-text">
          {t("home:trending.title")}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4">
        <Input
          label={t("home:trending.search_placeholder")}
          placeholder={t("home:trending.search_placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />

        {query.trim().length === 0 ? (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
            <CategoryChip
              label={t("home:trending.categories.all")}
              active={category === null}
              onClick={() => {
                setCategory(null);
              }}
            />
            {CATEGORIES.map((c) => (
              <CategoryChip
                key={c}
                label={t(`home:trending.categories.${c}`)}
                active={category === c}
                onClick={() => {
                  setCategory(c);
                }}
              />
            ))}
          </div>
        ) : null}

        {failed ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-ds-text-muted">
              {t("home:trending.load_failed")}
            </p>
          </div>
        ) : wheels === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : wheels.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="text-5xl" aria-hidden>🌶️</span>
            <p className="text-sm text-ds-text-muted px-6">
              {t("home:trending.empty")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {wheels.map((w) => (
              <PublicWheelCard
                key={w.id}
                wheel={w}
                liked={w.liked}
                reportConfirming={reportConfirmId === w.id}
                onUse={() => {
                  haptics.medium();
                  setUseId(w.id);
                }}
                onLike={() => {
                  void handleLike(w);
                }}
                onReport={() => {
                  void handleReport(w);
                }}
              />
            ))}
          </div>
        )}
      </main>

      <RoomModePickerSheet
        open={useId !== null}
        loading={useLoading}
        onClose={() => {
          if (!useLoading) setUseId(null);
        }}
        onCreate={(mode, deck, spinCount) => {
          void handleUse(mode, deck, spinCount);
        }}
      />
    </>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold transition-colors",
        active
          ? "bg-brand-primary text-white"
          : "bg-ds-surface-2 text-ds-text",
      )}
    >
      {label}
    </button>
  );
}
