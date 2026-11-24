/**
 * Calendar-date helpers. A date is a 'YYYY-MM-DD' string (lexicographically
 * comparable). "Today" is always evaluated in a named IANA time zone, because
 * the Homey app process itself runs in UTC.
 */
import { WEEKDAYS } from './const';

export type DateStr = string;
export const DEFAULT_TZ = 'Europe/Copenhagen';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function ymd(y: number, m: number, d: number): DateStr {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function toUTC(d: DateStr): Date {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

function fromUTC(dt: Date): DateStr {
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function isValidDate(d: DateStr): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return fromUTC(toUTC(d)) === d;
}

export function addDays(d: DateStr, n: number): DateStr {
  const dt = toUTC(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** 0 = Monday ... 6 = Sunday (Python date.weekday()) */
export function weekday(d: DateStr): number {
  return (toUTC(d).getUTCDay() + 6) % 7;
}

export function isoWeek(d: DateStr): { year: number; week: number } {
  const dt = toUTC(d);
  const wd = weekday(d);
  dt.setUTCDate(dt.getUTCDate() - wd + 3); // Thursday of this week
  const year = dt.getUTCFullYear();
  const firstThu = toUTC(ymd(year, 1, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  return { year, week: 1 + Math.round((dt.getTime() - firstThu.getTime()) / (7 * 86_400_000)) };
}

/** Python date.fromisocalendar(year, week, isoWeekday 1..7) */
export function fromIsoCalendar(year: number, week: number, isoWeekday: number): DateStr {
  const jan4 = ymd(year, 1, 4);
  const mondayW1 = addDays(jan4, -weekday(jan4));
  return addDays(mondayW1, (week - 1) * 7 + (isoWeekday - 1));
}

/** Local wall-clock parts of `now` in time zone `tz`. */
export function localParts(now: Date = new Date(), tz = DEFAULT_TZ): { date: DateStr; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export function today(now: Date = new Date(), tz = DEFAULT_TZ): DateStr {
  return localParts(now, tz).date;
}

/** Calendar date in `tz` of an absolute instant. */
export function dateInTz(instant: Date, tz = DEFAULT_TZ): DateStr {
  return localParts(instant, tz).date;
}

const DANISH_MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthFromName(name: string): number | undefined {
  const n = name.toLowerCase().replace(/\.$/, '');
  for (const list of [DANISH_MONTHS, EN_MONTHS]) {
    const i = list.findIndex((m) => m === n || (n.length >= 3 && m.startsWith(n)));
    if (i >= 0) return i + 1;
  }
  return undefined;
}

/**
 * Replacement for `dateutil.parser.parse(text, dayfirst=...).date()` covering
 * the formats the providers deliver. The wall-clock date as written is used
 * (time zone suffixes are ignored, as `.date()` does upstream).
 * Returns null for "Ingen tømningsdato fundet!" or unparseable input.
 */
export function parseDate(text: string | number | null | undefined, dayfirst = false): DateStr | null {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (!s || s === 'Ingen tømningsdato fundet!') return null;
  let m: RegExpMatchArray | null;

  // ISO 8601: 2025-05-22, 2025-05-22T06:00:00+02:00, 2025/05/22
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/))) return checked(+m[1], +m[2], +m[3]);
  // Compact: 20250522 or 20250522T060000
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:$|T)/))) return checked(+m[1], +m[2], +m[3]);
  // Numeric with year last: 22-05-2025, 22.05.2025, 05/22/2025
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:$|[T\s])/))) {
    const a = +m[1]; const b = +m[2]; let y = +m[3];
    if (y < 100) y += 2000;
    // dateutil: month-first unless dayfirst, swapping when the month is impossible
    let [d, mo] = dayfirst ? [a, b] : [b, a];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return checked(y, mo, d);
  }
  // Textual: "fredag den 22. maj 2025", "22. maj 2025", "May 22, 2025", "22 May 2025"
  const cleaned = s.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if ((m = cleaned.match(/(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})/u))) {
    const mo = monthFromName(m[2]);
    if (mo) return checked(+m[3], mo, +m[1]);
  }
  if ((m = cleaned.match(/([a-zæøå]+)\.?\s+(\d{1,2})\.?\s+(\d{4})/u))) {
    const mo = monthFromName(m[1]);
    if (mo) return checked(+m[3], mo, +m[2]);
  }
  return null;
}

function checked(y: number, m: number, d: number): DateStr | null {
  const r = ymd(y, m, d);
  return isValidDate(r) ? r : null;
}

/**
 * Weekday name (Danish) + ISO week number -> date. week -1: next date with that
 * weekday in an odd week; -2: in an even week (searching 2 weeks ahead).
 */
export function weekdayWeekToDate(weekdayName: string, weekNumber: number, year: number | undefined, todayStr: DateStr): DateStr | null {
  const idx = WEEKDAYS.map((d) => d.toLowerCase()).indexOf(weekdayName.toLowerCase());
  if (idx < 0) return null;
  if (weekNumber < 0) {
    const remain = weekNumber === -2 ? 0 : 1;
    for (let i = 0; i < 14; i++) {
      const candidate = addDays(todayStr, i);
      if (weekday(candidate) === idx && isoWeek(candidate).week % 2 === remain) return candidate;
    }
    return null;
  }
  return fromIsoCalendar(year ?? Number(todayStr.slice(0, 4)), weekNumber, idx + 1);
}
