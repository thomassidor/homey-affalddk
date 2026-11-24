/** Localised labels for fractions and pickup days (from upstream i18n files). */
import da from './affalddk/data/i18n.da.json';
import en from './affalddk/data/i18n.en.json';
import { DateStr, weekday } from './affalddk/dates';
import { NAME_LIST } from './affalddk/const';

type Tr = typeof en;
const TR: Record<string, Tr> = { da, en };

export type Lang = 'da' | 'en';
export const toLang = (l: string | undefined): Lang => (l === 'da' ? 'da' : 'en');

export function fractionName(key: string, lang: Lang): string {
  return (TR[lang].waste_name as Record<string, string>)[key] ?? NAME_LIST[key] ?? key;
}

export function fractionTitle(key: string): { en: string; da: string } {
  return { en: fractionName(key, 'en'), da: fractionName(key, 'da') };
}

/** "I dag" / "I morgen" / "Om 3 dage" */
export function daysText(days: number, lang: Lang): string {
  const d = TR[lang].daynames;
  if (days === 0) return d.today;
  if (days === 1) return d.tomorrow;
  return d.in_days.replace('_state', String(days));
}

export function weekdayName(date: DateStr, lang: Lang, short = false): string {
  const d = TR[lang].daynames;
  return (short ? d.weekdays_short : d.weekdays)[weekday(date)];
}

/** "Tor 27/11" */
export function shortDate(date: DateStr, lang: Lang): string {
  const [, m, d] = date.split('-').map(Number);
  return `${weekdayName(date, lang, true)} ${d}/${m}`;
}

/** "torsdag d. 27. november" / "Thursday 27 November" */
export function longDate(date: DateStr, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number);
  const month = new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : 'en-GB', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
  const wd = weekdayName(date, lang);
  return lang === 'da' ? `${wd.toLowerCase()} d. ${d}. ${month}` : `${wd} ${d} ${month}`;
}
