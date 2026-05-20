import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose Tailwind class strings, deduping conflicting utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
