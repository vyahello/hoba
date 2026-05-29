import { type ServerQuestion, type ServerSegment } from "@/lib/api";

export function livingSegments(q: ServerQuestion | null): ServerSegment[] {
  if (q === null) return [];
  return q.segments.filter((s) => !s.is_eliminated);
}

export function eliminatedSegments(q: ServerQuestion | null): ServerSegment[] {
  if (q === null) return [];
  return q.segments.filter((s) => s.is_eliminated);
}

export function remainingCount(q: ServerQuestion | null): number {
  return livingSegments(q).length;
}

export function isRoundOver(q: ServerQuestion | null): boolean {
  return remainingCount(q) === 1;
}
