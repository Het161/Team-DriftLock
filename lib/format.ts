/**
 * Wire formatting. Everything a dateline, ID or stamp renders goes through here
 * so the vernacular stays identical across all three pages.
 */

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** "07 AUG 2026 · 15:33 UTC" — always UTC, never the reader's timezone. */
export function wireDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "DATE UNKNOWN";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

/** "15:33 UTC" */
export function wireClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:-- UTC";
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** The full dateline slug that heads every dispatch. */
export function dateline(domain: string, iso: string): string {
  return `TAAR WIRE · ${domain} DESK · ${wireDate(iso)}`;
}

/** "thestar.com.my" — what a reader actually wants to see in a source list. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "23 min ago" / "4 hr ago" / "2 days ago". Coarse on purpose. */
export function ago(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
