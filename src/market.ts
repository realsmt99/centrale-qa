/**
 * "Today" for the synthetic market. Data generation and pricing use the same
 * year, so results don't change when the real calendar moves on.
 */
export const REFERENCE_YEAR = 2026;

/** The years a version was actually sold (up to the reference year). */
export function soldYears(v: { year_start: number; year_end: number | null }): { from: number; to: number } {
  return { from: v.year_start, to: Math.min(v.year_end ?? REFERENCE_YEAR, REFERENCE_YEAR) };
}
