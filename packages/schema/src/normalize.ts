import type { LifecycleState } from "./lifecycle";
import type { Provider } from "./providers";
import { PROVIDER_TERM_MAP } from "./providers";

export class UnmappedLifecycleTermError extends Error {
  constructor(
    public readonly provider: Provider,
    public readonly term: string,
  ) {
    super(`Unmapped lifecycle term "${term}" for provider "${provider}"`);
    this.name = "UnmappedLifecycleTermError";
  }
}

/**
 * Map a verbatim provider lifecycle term onto the canonical state machine.
 *
 * Fails loud: an unrecognized term throws rather than guessing. Collectors catch this and route
 * the record into the verification queue, so a provider wording change surfaces for review
 * instead of producing a silently wrong (or missed) lifecycle state.
 */
export function normalizeLifecycle(provider: Provider, term: string): LifecycleState {
  const key = term.trim().toLowerCase();
  const state = PROVIDER_TERM_MAP[provider]?.[key];
  if (!state) {
    throw new UnmappedLifecycleTermError(provider, term);
  }
  return state;
}

/** Non-throwing variant for callers that want to handle the miss themselves. */
export function tryNormalizeLifecycle(provider: Provider, term: string): LifecycleState | null {
  const key = term.trim().toLowerCase();
  return PROVIDER_TERM_MAP[provider]?.[key] ?? null;
}

/**
 * Build the canonical, stable slug for a model: `<provider>/<normalized-key>`.
 * e.g. ("anthropic", "claude-opus-4-1") -> "anthropic/claude-opus-4-1".
 */
export function toCanonicalSlug(provider: Provider, modelKey: string): string {
  const key = modelKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${provider}/${key}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Confirm the day exists in that month (UTC, no timezone drift).
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normalize a free-form date string to `YYYY-MM-DD`, or null if it cannot be parsed *unambiguously*.
 *
 * Deliberately strict to avoid persisting plausible-but-wrong dates: we only accept full
 * year-month-day dates in ISO (`2026-04-14`), US (`April 14, 2026` / `Apr 14 2026` / `4/14/2026`),
 * or day-first (`14 April 2026`) forms. Partial dates (`2026`, `April 2026`, `Q3 2026`), ranges,
 * and sentinels (`TBD`, `N/A`) return null rather than guessing. A trailing parenthetical or
 * footnote marker (e.g. `2026-09-24 (tentative)`, `April 14, 2026*`) is stripped before parsing.
 * All parsing is done in UTC so a date-only input never drifts by a day.
 */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;

  // Strip trailing parentheticals, footnote markers, and surrounding whitespace.
  const trimmed = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/[*†‡¹²³]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (trimmed === "") return null;

  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    return isValidYmd(year, month, day) ? `${y}-${m}-${d}` : null;
  }

  // Numeric slash/dot forms: M/D/YYYY (US-style) or YYYY/M/D.
  const numeric = /^(\d{1,4})[/.](\d{1,2})[/.](\d{1,4})$/.exec(trimmed);
  if (numeric) {
    let year: number, month: number, day: number;
    if (numeric[1]!.length === 4) {
      [year, month, day] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    } else if (numeric[3]!.length === 4) {
      [month, day, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    } else {
      return null; // Ambiguous two-digit year; refuse rather than guess.
    }
    return isValidYmd(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
  }

  // Month-name forms, in either order: "April 14, 2026" or "14 April 2026".
  const tokens = trimmed.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 3) {
    const monthName = tokens.find((t) => t in MONTHS);
    if (monthName) {
      const month = MONTHS[monthName]!;
      const numbers = tokens.filter((t) => t !== monthName).map((t) => Number(t));
      if (numbers.length === 2 && numbers.every((n) => Number.isInteger(n))) {
        // The 4-digit value is the year; the other is the day.
        const year = numbers.find((n) => n > 31);
        const day = numbers.find((n) => n <= 31);
        if (year !== undefined && day !== undefined && isValidYmd(year, month, day)) {
          return `${year}-${pad(month)}-${pad(day)}`;
        }
      }
    }
  }

  return null;
}
