/**
 * Parser for the affaldonline.dk tømningskalender PDF (showToemCal.php).
 * Port of pyaffalddk/affaldonline_pdf.py - see there for the background.
 *
 * The fraction of a pickup is only shown as icon images next to the date.
 * The legend at the bottom puts the same icons next to the fraction name, so
 * icon -> fraction is read from the legend (nearest label to the right on the
 * same baseline). Adjacent legend icons sharing a label form a group; a date
 * row decodes greedily from the longest group it fully contains.
 */
import zlib from 'zlib';
import { DateStr, weekday, ymd } from '../dates';

const PDF_MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const PDF_WEEKDAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
const PDF_STREAM = /<<([^<>]*?)>>\s*stream\r?\n([\s\S]*?)endstream/g;
const PDF_TEXT = /BT ([\d.]+) ([\d.]+) Td \((.*)\) Tj ET/;
const PDF_ICON = /[\d.]+ 0 0 [\d.]+ ([\d.]+) ([\d.]+) cm \/(I\d+) Do/;
const PDF_ROW_TOLERANCE = 4; // pt; icons sit ~1.25 pt below their row's baseline
const PDF_ICON_GROUP_GAP = 14; // pt; icons within one legend entry sit ~12.76 pt apart

type Op = { kind: 'T' | 'I'; x: number; y: number; value: string };

const isDigits = (s: string) => /^\d+$/.test(s);

function inflate(buf: Buffer): string | null {
  try {
    return zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1');
  } catch {
    return null;
  }
}

export function parseAffaldonlinePdf(pdf: Buffer, year: number, warn: (msg: string) => void = () => {}): Map<DateStr, Set<string>> {
  const raw = pdf.toString('latin1');
  const ops: Op[] = [];
  for (const m of raw.matchAll(PDF_STREAM)) {
    if (!m[1].includes('/FlateDecode') || m[1].includes('/Subtype')) continue;
    const content = inflate(Buffer.from(m[2], 'latin1'));
    if (content === null) continue;
    for (const line of content.split(/\r\n|\r|\n/)) {
      let t: RegExpMatchArray | null;
      if ((t = line.match(PDF_TEXT))) ops.push({ kind: 'T', x: parseFloat(t[1]), y: parseFloat(t[2]), value: t[3].trim() });
      else if ((t = line.match(PDF_ICON))) ops.push({ kind: 'I', x: parseFloat(t[1]), y: parseFloat(t[2]), value: t[3] });
    }
  }

  // Legend pairing: day numbers, weekday names and empty strings are not labels.
  const icons = ops.filter((o) => o.kind === 'I');
  const labels = ops.filter((o) => o.kind === 'T' && o.value && !PDF_WEEKDAYS.includes(o.value.toLowerCase()) && !isDigits(o.value));
  const iconLabel: Array<{ icon: string; x: number; y: number; label: string }> = [];
  for (const { x, y, value: icon } of icons) {
    let best: { dx: number; ly: number; label: string } | null = null;
    for (const l of labels) {
      if (l.x > x && Math.abs(l.y - y) < PDF_ROW_TOLERANCE) {
        const c = { dx: l.x - x, ly: l.y, label: l.value };
        if (!best || c.dx < best.dx || (c.dx === best.dx && c.ly < best.ly)) best = c;
      }
    }
    if (best) {
      // dict semantics: same (icon, x, y) key keeps the last assignment
      const existing = iconLabel.find((e) => e.icon === icon && e.x === x && e.y === y);
      if (existing) existing.label = best.label;
      else iconLabel.push({ icon, x, y, label: best.label });
    }
  }

  // Adjacent legend icons with the same label form one group.
  const sorted = [...iconLabel].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const legendGroups: Array<{ y: number; label: string; members: Array<{ icon: string; x: number }> }> = [];
  for (const e of sorted) {
    const last = legendGroups[legendGroups.length - 1];
    if (last && last.y === e.y && last.label === e.label && e.x - last.members[last.members.length - 1].x < PDF_ICON_GROUP_GAP) {
      last.members.push({ icon: e.icon, x: e.x });
    } else {
      legendGroups.push({ y: e.y, label: e.label, members: [{ icon: e.icon, x: e.x }] });
    }
  }
  const groups = legendGroups
    .map((g) => ({ icons: new Set(g.members.map((m) => m.icon)), label: g.label }))
    .sort((a, b) => (b.icons.size - a.icons.size) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  let headers: Array<{ x: number; y: number; month: number }> = [];
  let current: { date: DateStr; y: number } | null = null;
  let wd: number | null = null;
  const rowIcons = new Map<DateStr, string[]>();
  for (const op of ops) {
    const lower = op.value.toLowerCase();
    if (op.kind === 'T' && PDF_MONTHS.includes(lower)) {
      headers = headers.filter((h) => Math.abs(h.y - op.y) < 1);
      headers.push({ x: op.x, y: op.y, month: PDF_MONTHS.indexOf(lower) + 1 });
    } else if (op.kind === 'T' && PDF_WEEKDAYS.includes(lower)) {
      wd = PDF_WEEKDAYS.indexOf(lower);
    } else if (op.kind === 'T' && isDigits(op.value) && headers.length && wd !== null) {
      const month = headers.reduce((best, h) => (Math.abs(h.x - op.x) < Math.abs(best.x - op.x) ? h : best)).month;
      const date = ymd(year, month, parseInt(op.value, 10));
      if (weekday(date) !== wd) throw new Error(`Weekday mismatch for ${date} in affaldonline PDF`);
      current = { date, y: op.y };
      wd = null;
      rowIcons.set(date, []);
    } else if (op.kind === 'I' && current && Math.abs(current.y - op.y) < PDF_ROW_TOLERANCE) {
      rowIcons.get(current.date)!.push(op.value);
    }
  }

  const result = new Map<DateStr, Set<string>>();
  const warned = new Set<string>();
  for (const date of [...rowIcons.keys()].sort()) {
    const remaining = new Set(rowIcons.get(date));
    const fractions = new Set<string>();
    for (const g of groups) {
      if ([...g.icons].every((i) => remaining.has(i))) {
        for (const i of g.icons) remaining.delete(i);
        fractions.add(g.label);
      }
    }
    for (const icon of [...remaining].sort()) {
      if (!warned.has(icon)) {
        warned.add(icon);
        warn(`missing: icon ${icon} is not defined by the affaldonline legend`);
      }
    }
    if (fractions.size) result.set(date, fractions);
    else warn(`missing: no fraction found for ${date} in the affaldonline PDF`);
  }
  return result;
}
