/**
 * Mapping of the free-text fraction names the providers deliver to the fixed
 * set of keys (dagrenovation, madaffald, ...). Port of pyaffalddk.api
 * get_garbage_types / clean_fraction_string.
 */
import {
  NON_SUPPORTED_ITEMS, RE_RAW, RE_WORDS, SPECIAL_MATERIALS, STRIPS, SUPPORTED_ITEMS, WEEKDAYS,
} from './const';
import { pyRegex } from './pyre';

export const NOT_SUPPORTED = 'not-supported';
export const MISSING_TYPE = 'missing-type';

export type MissingTypeLogger = (msg: string) => void;
let missingLogger: MissingTypeLogger = () => {};
export function setMissingTypeLogger(fn: MissingTypeLogger): void { missingLogger = fn; }

const STRIP_LIST = [...WEEKDAYS, ...STRIPS].map((s) => s.toLowerCase());
const RE_RAW_C = RE_RAW.map((r) => pyRegex(r, 'g'));
const RE_WORDS_C = RE_WORDS.map((w) => pyRegex(`(?:\\s|\\b)${w}(?=\\s|$)`, 'g'));
const PAREN_FIND = /\(([^()]*)\)/gu;
const PAREN_STRIP = /\s*\([^()]*\)/gu;
const NON_SUPPORTED_LOWER = NON_SUPPORTED_ITEMS.map((s) => s.toLowerCase());

/** lowercase entry -> key, preserving SUPPORTED_ITEMS order for first-match semantics */
const ENTRY_INDEX: Array<[string, string]> = [];
for (const [key, values] of Object.entries(SUPPORTED_ITEMS)) {
  for (const v of values) ENTRY_INDEX.push([v.toLowerCase(), key]);
}
const FIRST_KEY = new Map<string, string>();
for (const [entry, key] of ENTRY_INDEX) if (!FIRST_KEY.has(entry)) FIRST_KEY.set(entry, key);

/** Python str.lstrip(chars) / rstrip(chars) */
function lstripChars(s: string, chars: string): string {
  let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}
function rstripChars(s: string, chars: string): string {
  let i = s.length;
  while (i > 0 && chars.includes(s[i - 1])) i--;
  return s.slice(0, i);
}

export function cleanFractionString(item: string): string[] {
  let fixed = item.toLowerCase();
  for (const strip of STRIP_LIST) fixed = fixed.split(strip).join('');

  const inParens = [...fixed.matchAll(PAREN_FIND)].map((m) => m[1]);
  fixed = fixed.replace(PAREN_STRIP, '');

  for (const re of RE_RAW_C) fixed = fixed.replace(re, '');
  for (const re of RE_WORDS_C) fixed = fixed.replace(re, '');

  if (fixed.includes(':')) fixed = fixed.split(':')[1];

  fixed = fixed.trim();
  fixed = rstripChars(fixed, ',');
  fixed = lstripChars(fixed, ', ');
  fixed = rstripChars(fixed, ' -');
  fixed = lstripChars(fixed, '- ');
  fixed = lstripChars(fixed, '*');
  return [fixed.trim(), ...inParens];
}

export function getGarbageTypes(item: string, municipality = '', addressId = ''): string[] {
  if (NON_SUPPORTED_ITEMS.includes(item)) return [NOT_SUPPORTED];

  const lowerItem = item.toLowerCase();
  for (const [special, keys] of Object.entries(SPECIAL_MATERIALS)) {
    if (lowerItem.includes(special.toLowerCase())) return keys;
  }

  const fixedItems = cleanFractionString(item);
  if (fixedItems.length === 1 && fixedItems[0] === '') return [NOT_SUPPORTED];
  for (const fixed of fixedItems) {
    if (NON_SUPPORTED_LOWER.includes(fixed)) return [NOT_SUPPORTED];
    const key = FIRST_KEY.get(fixed.toLowerCase());
    if (key) return [key];
  }

  for (const sp of [' - ', ', ', ' og ']) {
    const items: string[] = [];
    for (const part of fixedItems[0].split(sp).map((o) => o.trim())) {
      const lp = part.toLowerCase();
      for (const [entry, key] of ENTRY_INDEX) if (entry === lp) items.push(key);
    }
    if (items.length) return items;
  }

  missingLogger(`Garbage type [${item}] is not defined in the system. `
    + `Please notify the developer. Municipality: ${municipality}, Address ID: ${addressId}`);
  return [MISSING_TYPE];
}

/** Split an iCal SUMMARY at commas; drop a leading "Tømning af" and everything from "på". */
export function splitIcalGarbageTypes(text: string): string[] {
  let t = text;
  if (t.startsWith('Tømning af')) t = t.slice('Tømning af '.length);
  if (t.includes('på')) t = t.split('på')[0];
  return t.split(',').map((s) => s.trim());
}

export function listToString(list: string[]): string {
  return list.join(' | ');
}

/** Sort key for address strings: house number numerically, then the part after the first comma. */
export function compareAddresses(a: string, b: string): number {
  const key = (addr: string): [number, string] => {
    const i = addr.indexOf(',');
    const first = i >= 0 ? addr.slice(0, i) : addr;
    const second = i >= 0 ? addr.slice(i + 1).trim().toLowerCase() : '';
    const m = first.match(/\d+/);
    return [m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY, second];
  };
  const [an, as] = key(a);
  const [bn, bs] = key(b);
  if (an !== bn) return an < bn ? -1 : 1;
  return as < bs ? -1 : as > bs ? 1 : 0;
}
