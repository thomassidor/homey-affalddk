/**
 * Pure functions turning stored pickup events into what the app shows:
 * per-fraction next date and the combined "next pickup". Port of the
 * PickupEvents / set_next_event logic in pyaffalddk.api.
 */
import type { PickupEvent } from './collection';
import { DateStr, diffDays } from './dates';
import { listToString } from './fractions';

export const NEXT_PICKUP = 'next_pickup';

export interface FractionSummary {
  key: string;
  date: DateStr;
  daysUntil: number;
  description: string;
  containerCount?: number;
}

export interface NextPickup {
  date: DateStr;
  daysUntil: number;
  /** fraction keys collected that day, sorted */
  keys: string[];
  /** raw descriptions joined with " | " (sorted along with keys) */
  description: string;
  /** icon key: first key if dynamic icons are enabled, else "genbrug" */
  icon: string;
}

export interface SummaryOptions {
  today: DateStr;
  /** current local hour (0-23); after switchHour today's pickups count as done for next_pickup */
  hour: number;
  minute?: number;
  switchHour?: number;
  dynamicIcon?: boolean;
}

/** Earliest pickup on or after today for each fraction, ordered by date then key. */
export function fractionSummaries(events: PickupEvent[], today: DateStr): FractionSummary[] {
  const byKey = new Map<string, PickupEvent>();
  for (const e of events) {
    if (e.date < today) continue;
    const cur = byKey.get(e.key);
    if (!cur || e.date < cur.date) byKey.set(e.key, e);
  }
  return [...byKey.values()]
    .map((e) => ({ key: e.key, date: e.date, daysUntil: diffDays(today, e.date), description: e.description, containerCount: e.containerCount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key.localeCompare(b.key)));
}

export function nextPickup(events: PickupEvent[], opts: SummaryOptions): NextPickup | null {
  const { today, hour, minute = 0, switchHour = 15, dynamicIcon = false } = opts;
  const dates = [...new Set(events.map((e) => e.date))].sort();
  if (!dates.length) return null;
  // upstream: now().time() > switch_time  (strictly after hh:00)
  const afterSwitch = hour > switchHour || (hour === switchHour && minute > 0);
  let candidates = dates.filter((d) => (afterSwitch ? d > today : d >= today));
  // After the switch time every remaining pickup can be today's - fall back to them.
  if (!candidates.length) candidates = dates.filter((d) => d >= today);
  if (!candidates.length) return null;
  const date = candidates[0];
  const pairs = events.filter((e) => e.date === date)
    .map((e) => [e.key, e.description] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const keys = pairs.map((p) => p[0]);
  return {
    date,
    daysUntil: diffDays(today, date),
    keys,
    description: listToString(pairs.map((p) => p[1])),
    icon: dynamicIcon ? keys[0] : 'genbrug',
  };
}

/** All pickups from today, grouped per date (for the widget). */
export function upcomingByDate(events: PickupEvent[], today: DateStr, limit = Infinity): Array<{ date: DateStr; daysUntil: number; events: PickupEvent[] }> {
  const map = new Map<DateStr, PickupEvent[]>();
  for (const e of events) {
    if (e.date < today) continue;
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date)!.push(e);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, limit)
    .map(([date, evs]) => ({ date, daysUntil: diffDays(today, date), events: evs }));
}
