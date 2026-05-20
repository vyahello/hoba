import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AuroraBackground } from "@/components/ds/AuroraBackground";
import { Avatar } from "@/components/ds/Avatar";
import { AvatarStack } from "@/components/ds/AvatarStack";
import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { fireConfetti } from "@/components/ds/ConfettiBurst";
import { EmptyState } from "@/components/ds/EmptyState";
import { HobaWord } from "@/components/ds/HobaWord";
import { IconButton } from "@/components/ds/IconButton";
import { Input, Textarea } from "@/components/ds/Input";
import { Modal } from "@/components/ds/Modal";
import { QuickWheelCard } from "@/components/ds/QuickWheelCard";
import { RealtimeIndicator } from "@/components/ds/RealtimeIndicator";
import { ResultBanner } from "@/components/ds/ResultBanner";
import { RoomCodePill } from "@/components/ds/RoomCodePill";
import { SegmentChip } from "@/components/ds/SegmentChip";
import { Sheet } from "@/components/ds/Sheet";
import { Skeleton } from "@/components/ds/Skeleton";
import { QUICK_WHEELS } from "@/data/quickWheels";
import { type Locale, SUPPORTED_LOCALES, setLocale } from "@/i18n";
import { cn } from "@/lib/cn";
import { toast } from "@/stores/toast";

function Section({
  title,
  children,
  id,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section id={id} className="flex flex-col gap-3">
      <h2 className="font-display font-bold text-xl text-ink-light-1 dark:text-ink-dark-1">
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2">
      {children}
    </p>
  );
}

export function DevDSPage(): JSX.Element {
  const { t, i18n } = useTranslation(["dev", "common"]);
  const currentLocale = (i18n.resolvedLanguage ?? "en") as Locale;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [segments, setSegments] = useState([
    { label: "Pizza", emoji: "🍕", seed: 0 },
    { label: "Sushi", emoji: "🍣", seed: 1 },
    { label: "Burger", emoji: "🍔", seed: 2 },
    { label: "Salad", emoji: "🥗", seed: 3 },
  ]);

  return (
    <>
      <header className="ds-glass-header px-4 py-3 pt-safe">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display font-bold text-xl text-ink-light-1 dark:text-ink-dark-1">
            {t("dev:title")}
          </h1>
          <div className="flex items-center gap-1.5">
            {SUPPORTED_LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                onClick={() => {
                  setLocale(locale);
                }}
                className={cn(
                  "ds-tactile min-h-[44px] px-3 rounded-md text-sm font-medium uppercase tracking-wider",
                  locale === currentLocale
                    ? "bg-brand-primary text-white"
                    : "bg-surface-light-2 text-ink-light-1 dark:bg-surface-dark-2 dark:text-ink-dark-1",
                )}
              >
                {locale}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 mt-1">
          {t("dev:subtitle")}
        </p>
      </header>

      <main className="flex-1 px-4 pt-4 pb-12 flex flex-col gap-10">
        <Section title={t("dev:sections.brand")} id="brand">
          <Card padding="lg" className="text-center">
            <div className="py-6">
              <HobaWord />
            </div>
            <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 mt-3">
              Locale-aware — tap the chip above to switch between Hoba! / Хоба!
            </p>
          </Card>
        </Section>

        <Section title={t("dev:sections.typography")} id="typography">
          <Card>
            <p className="font-display font-extrabold text-3xl mb-2">
              Display · Manrope ExtraBold
            </p>
            <p className="font-ui text-base mb-1">
              UI · Inter Regular — primary text reads at 16px on mobile.
            </p>
            <p className="font-mono text-sm tracking-widest mb-1">
              MONO · K7M9X2 (JetBrains Mono)
            </p>
            <p className="font-ui text-sm text-ink-light-2 dark:text-ink-dark-2">
              Secondary — 14px minimum body text per §3.
            </p>
          </Card>
        </Section>

        <Section title={t("dev:sections.buttons")} id="buttons">
          <Label>Variants</Label>
          <Row>
            <Button variant="primary">Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </Row>
          <Label>Sizes</Label>
          <Row>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="xl" variant="accent">
              XL — Spin
            </Button>
          </Row>
          <Label>States</Label>
          <Row>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
            <Button fullWidth>Full width</Button>
          </Row>
          <Label>IconButtons</Label>
          <Row>
            <IconButton
              aria-label="Settings"
              icon={<span aria-hidden>⚙️</span>}
              variant="filled"
            />
            <IconButton
              aria-label="Share"
              icon={<span aria-hidden>📤</span>}
              variant="tonal"
            />
            <IconButton
              aria-label="Close"
              icon={<span aria-hidden>✕</span>}
              variant="ghost"
            />
          </Row>
        </Section>

        <Section title={t("dev:sections.cards")} id="cards">
          <Card>Default card — soft shadow, no padding override.</Card>
          <Card glow>Glow card — `shadow-spin` for lobby / result.</Card>
          <Card interactive onClick={() => toast({ title: "Card tapped" })}>
            Interactive card — tactile press, fires haptic.
          </Card>
        </Section>

        <Section title={t("dev:sections.inputs")} id="inputs">
          <Input
            label="Question"
            placeholder="What's for dinner?"
            counter={60}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
            }}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            error="Invalid address"
          />
          <Textarea
            label="Notes"
            placeholder="Optional notes"
            counter={200}
            hint="Up to 200 characters"
          />
          <Label>Segment chips</Label>
          <div className="flex flex-wrap gap-2">
            {segments.map((s, i) => (
              <SegmentChip
                key={`${s.label}-${i}`}
                label={s.label}
                emoji={s.emoji}
                colorSeed={s.seed}
                editable
                onRemove={() => {
                  setSegments((curr) => curr.filter((_, idx) => idx !== i));
                }}
              />
            ))}
            <SegmentChip label="Read-only" colorSeed={5} />
          </div>
        </Section>

        <Section title={t("dev:sections.media")} id="media">
          <Label>Avatars</Label>
          <Row>
            <Avatar fallback="Volo" size="sm" />
            <Avatar fallback="Volo" size="md" status="online" />
            <Avatar fallback="Anna Petrenko" size="lg" status="offline" />
            <Avatar fallback="V" size="xl" />
          </Row>
          <Label>Avatar stack</Label>
          <AvatarStack
            users={[
              { fallback: "Volo" },
              { fallback: "Anna" },
              { fallback: "Maks" },
              { fallback: "Olga" },
              { fallback: "Sasha" },
              { fallback: "Yura" },
            ]}
            max={4}
          />
          <Label>Realtime indicators</Label>
          <Row>
            <RealtimeIndicator />
            <RealtimeIndicator label="syncing" />
            <RealtimeIndicator label="offline" active={false} />
          </Row>
          <Label>Room code</Label>
          <RoomCodePill code="K7M9X2" />
          <Label>Skeletons</Label>
          <div className="flex flex-col gap-2">
            <Skeleton height={20} width="60%" />
            <Skeleton height={16} width="80%" />
            <Skeleton height={16} width="40%" />
            <Skeleton height={48} radius="sm" />
          </div>
        </Section>

        <Section title={t("dev:sections.feedback")} id="feedback">
          <Label>Toasts (taps fire the toast + matching haptic)</Label>
          <Row>
            <Button
              variant="secondary"
              onClick={() => {
                toast({ title: "Saved", intent: "info" });
              }}
            >
              info
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                toast({
                  title: "Room created",
                  description: "K7M9X2 is live.",
                  intent: "success",
                });
              }}
            >
              success
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                toast({ title: "Heads up", intent: "warning" });
              }}
            >
              warning
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                toast({ title: "Something broke", intent: "error" });
              }}
            >
              error
            </Button>
          </Row>
          <Label>Confetti</Label>
          <Row>
            <Button
              variant="accent"
              onClick={() => {
                fireConfetti();
              }}
            >
              Fire confetti
            </Button>
          </Row>
          <Label>Empty state</Label>
          <Card padding="none" className="overflow-hidden">
            <EmptyState
              title="No saved wheels yet"
              description="Build one and tap Save to keep it."
              action={{
                label: "Create",
                onClick: () => {
                  toast({ title: "Would route to /create" });
                },
              }}
            />
          </Card>
        </Section>

        <Section title={t("dev:sections.overlays")} id="overlays">
          <Row>
            <Button
              variant="primary"
              onClick={() => {
                setSheetOpen(true);
              }}
            >
              Open Sheet
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setModalOpen(true);
              }}
            >
              Open Modal
            </Button>
          </Row>
          <Sheet
            open={sheetOpen}
            onClose={() => {
              setSheetOpen(false);
            }}
            title="Sheet header"
          >
            <p className="text-base text-ink-light-2 dark:text-ink-dark-2 mb-4">
              Sheets are the default overlay. Drag down or tap the backdrop to dismiss.
            </p>
            <div className="flex flex-col gap-2">
              <SegmentChip label="Pizza" emoji="🍕" colorSeed={0} editable />
              <SegmentChip label="Sushi" emoji="🍣" colorSeed={1} editable />
              <SegmentChip label="Burger" emoji="🍔" colorSeed={2} editable />
            </div>
          </Sheet>
          <Modal
            open={modalOpen}
            onClose={() => {
              setModalOpen(false);
            }}
            title="Close this room?"
            description="All guests will be disconnected. This can't be undone."
            primaryAction={{
              label: "Close room",
              destructive: true,
              onClick: () => {
                setModalOpen(false);
                toast({ title: "Room closed", intent: "warning" });
              },
            }}
            secondaryAction={{
              label: "Cancel",
              onClick: () => {
                setModalOpen(false);
              },
            }}
          />
        </Section>

        <Section title="Result banner" id="result">
          <ResultBanner
            segmentLabel="Pizza"
            segmentEmoji="🍕"
            segmentColor="#FF5C9C"
            triggeredByName="Volo"
          />
          <ResultBanner
            segmentLabel="Truth"
            segmentEmoji="😈"
            segmentColor="#7C5CFF"
            triggeredByName="Anna"
            modeEffects={
              <span className="text-sm font-medium opacity-90">
                ⚡ Chaos: speed run — wheel spins 2× fast
              </span>
            }
          />
        </Section>

        <Section title="Aurora background" id="aurora">
          <Card padding="none" className="relative h-40 overflow-hidden">
            <AuroraBackground fixed={false} />
            <div className="relative h-full flex items-center justify-center">
              <span className="font-display font-bold text-2xl text-ink-light-1 dark:text-ink-dark-1">
                Aurora drifts behind content
              </span>
            </div>
          </Card>
        </Section>

        <Section title="Quick wheel cards" id="quickwheels">
          <div className="grid grid-cols-2 gap-3">
            {QUICK_WHEELS.map((wheel) => (
              <QuickWheelCard
                key={wheel.id}
                wheel={wheel}
                onTap={() => {
                  toast({ title: wheel.id });
                }}
              />
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}
