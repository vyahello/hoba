import { type SpinSeriesEntry } from "@/stores/room";

/**
 * Running hit-count per segment for the first `upto` entries (inclusive)
 * of a best-of-N spin series. Used to drive the live tally chip row.
 */
export function runningTally(
  series: SpinSeriesEntry[],
  upto: number,
): Map<number, number> {
  const tally = new Map<number, number>();
  for (let i = 0; i <= upto && i < series.length; i += 1) {
    const id = series[i].segment_id;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  return tally;
}

/** Whether index `i` is the final (dramatic) sub-spin of a series. */
export function isFinalSubSpin(i: number, length: number): boolean {
  return i === length - 1;
}
