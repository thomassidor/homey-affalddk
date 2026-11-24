import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { GarbageCollection } from '../lib/affalddk/collection';
import { diffDays, isoWeek, localParts, parseDate, weekdayWeekToDate } from '../lib/affalddk/dates';
import { parseIcs } from '../lib/affalddk/parsers/ics';
import { nextPickup, upcomingByDate } from '../lib/affalddk/summary';
import { nextUpcomingDayMonth } from '../lib/affalddk/providers/scrapers';

const openexp = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'openexp.data'), 'utf8'));

function holstebro(today: string, raw: unknown = openexp) {
  const gc = new GarbageCollection('Holstebro', { today: () => today });
  return gc.normalize(gc.api.parse(raw));
}

describe('weekdayWeekToDate (upstream test_weekday_conversion, frozen 2025-06-16)', () => {
  const today = '2025-06-16';
  it('converts', () => {
    expect(weekdayWeekToDate('Mandag', 26, 2024, today)).toBe('2024-06-24');
    expect(weekdayWeekToDate('MANDAG', 26, 2025, today)).toBe('2025-06-23');
    expect(weekdayWeekToDate('Mandag', 26, undefined, today)).toBe('2025-06-23');
    expect(weekdayWeekToDate('Onsdag', -1, undefined, today)).toBe('2025-06-18');
    expect(weekdayWeekToDate('Onsdag', -2, undefined, today)).toBe('2025-06-25');
  });
});

describe('date helpers', () => {
  it('parses provider formats', () => {
    expect(parseDate('2025-04-28T00:00:00+00:00')).toBe('2025-04-28');
    expect(parseDate('2025-05-05T00:00:00.000Z')).toBe('2025-05-05');
    expect(parseDate('10-06-2025', true)).toBe('2025-06-10');
    expect(parseDate('20250522')).toBe('2025-05-22');
    expect(parseDate('5. maj 2025')).toBe('2025-05-05');
    expect(parseDate('Ingen tømningsdato fundet!')).toBeNull();
  });
  it('iso weeks', () => {
    expect(isoWeek('2025-06-16')).toEqual({ year: 2025, week: 25 });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
  });
  it('local time in Copenhagen, across DST', () => {
    expect(localParts(new Date('2025-06-15T22:30:00Z'))).toEqual({ date: '2025-06-16', hour: 0, minute: 30 });
    expect(localParts(new Date('2025-01-15T23:30:00Z'))).toEqual({ date: '2025-01-16', hour: 0, minute: 30 });
    expect(diffDays('2025-03-29', '2025-03-31')).toBe(2);
  });
  it('dd-mm lists roll over to next year', () => {
    expect(nextUpcomingDayMonth('03-01, 20-12', '2025-12-21')).toBe('2026-01-03');
    expect(nextUpcomingDayMonth('03-01, 22-12', '2025-12-21')).toBe('2025-12-22');
  });
  it('parses ICS with TZID and VALUE=DATE', () => {
    const ics = fs.readFileSync(path.join(__dirname, 'fixtures', 'odense_ics.data'), 'utf8');
    const ev = parseIcs(ics)[0];
    expect(ev.date).toBe('2025-04-25');
    expect(ev.summary.startsWith('Tømning af')).toBe(true);
    const kbh = parseIcs(fs.readFileSync(path.join(__dirname, 'fixtures', 'kbh_ics.data'), 'utf8'));
    expect(kbh[0]).toEqual({ summary: 'Rest/Madaffald', date: '2025-05-05' });
  });
});

describe('next pickup (upstream test_api.py)', () => {
  it('icon: genbrug unless dynamic', () => {
    const events = holstebro('2025-05-20');
    expect(nextPickup(events, { today: '2025-05-20', hour: 0 })!.icon).toBe('genbrug');
    expect(nextPickup(events, { today: '2025-05-20', hour: 0, dynamicIcon: true })!.icon).toBe('restaffaldmadaffald');
  });

  it('switch time moves next pickup past today', () => {
    const events = holstebro('2025-05-22');
    expect(nextPickup(events, { today: '2025-05-22', hour: 12, minute: 30 })!.date).toBe('2025-05-22');
    expect(nextPickup(events, { today: '2025-05-22', hour: 12, minute: 30, switchHour: 12 })!.date).toBe('2025-06-04');
  });

  it('next of the same fraction', () => {
    const only = { collections: openexp.collections.filter((c: any) => c.fraction.name === 'Rest/Madaffald') };
    const events = holstebro('2025-05-22', only);
    expect(nextPickup(events, { today: '2025-05-22', hour: 12, minute: 30 })!.date).toBe('2025-05-22');
    expect(nextPickup(events, { today: '2025-05-22', hour: 12, minute: 30, switchHour: 12 })!.date).toBe('2025-06-05');
  });

  it('after switch time with all pickups today does not crash', () => {
    const events = holstebro('2025-05-22', { collections: [
      { fraction: { name: 'Rest/Madaffald' }, dates: ['2025-05-22'] },
      { fraction: { name: 'Papir/Pap' }, dates: ['2025-05-22'] },
    ] });
    const next = nextPickup(events, { today: '2025-05-22', hour: 15, minute: 30 })!;
    expect(next.date).toBe('2025-05-22');
    expect(next.keys).toEqual(['pappapir', 'restaffaldmadaffald']);
  });

  it('groups upcoming per date', () => {
    const groups = upcomingByDate(holstebro('2025-05-20'), '2025-05-20', 3);
    expect(groups).toHaveLength(3);
    expect(groups[0].daysUntil).toBeGreaterThanOrEqual(0);
  });
});
