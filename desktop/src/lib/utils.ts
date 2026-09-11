import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Quantity columns are NUMERIC(12,3) in Postgres, which the driver
// returns as a string ("1.000") rather than a JS number, to avoid
// float rounding -- displaying that raw string put a distracting
// ".000" on every whole-number quantity. This parses it and trims
// trailing zeros, while still keeping real fractional amounts
// (e.g. "2.5 kg" of a bulk material) instead of rounding them away.
export function formatQuantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return '0';
  return num.toFixed(3).replace(/\.?0+$/, '');
}

