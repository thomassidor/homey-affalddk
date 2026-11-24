/**
 * Minimal iCalendar reader: enough for the provider feeds (VEVENT with
 * SUMMARY + DTSTART, no recurring events). Returns the start date of each
 * event as a calendar date.
 */
import { DateStr, dateInTz, DEFAULT_TZ, ymd } from '../dates';

export interface IcsEvent { summary: string; date: DateStr }

function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function parseIcs(text: string, tz = DEFAULT_TZ): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let inEvent = false;
  let summary = '';
  let date: DateStr | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; summary = ''; date = null; continue; }
    if (line === 'END:VEVENT') {
      if (inEvent && date) events.push({ summary, date });
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    if (name.toUpperCase() === 'SUMMARY') summary = unescapeText(value);
    else if (name.toUpperCase() === 'DTSTART') date = icsDate(value, params, tz);
  }
  return events;
}

function icsDate(value: string, _params: string[], tz: string): DateStr | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (m[7] === 'Z') {
    // UTC instant -> local calendar date
    return dateInTz(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), tz);
  }
  // VALUE=DATE, TZID=... or floating time: the wall-clock date as written
  return ymd(+m[1], +m[2], +m[3]);
}
