/** Port of upstream tests/test_affaldonline_pdf.py */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import { parseAffaldonlinePdf } from '../lib/affalddk/parsers/pdf';

const FIX = path.join(__dirname, 'fixtures');
const read = (f: string) => fs.readFileSync(path.join(FIX, f));
const asObj = (m: Map<string, Set<string>>) => Object.fromEntries([...m].map(([d, s]) => [d, [...s].sort()]));

type Op = ['T' | 'I', number, number, string];
function pdfFromOps(ops: Op[]): Buffer {
  const lines = ops.map(([kind, x, y, v]) => (kind === 'T'
    ? `q 0.000 g BT ${x} ${y} Td (${v}) Tj ET Q`
    : `q 11.34 0 0 11.34 ${x} ${y} cm /${v} Do Q`));
  const content = Buffer.from(lines.join('\n'), 'latin1');
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n<< /Filter /FlateDecode /Length ${content.length} >>\nstream\n`, 'latin1'),
    zlib.deflateSync(content),
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]);
}

describe('affaldonline PDF parser', () => {
  it('Sorø Rådhus 2026', () => {
    const cal = parseAffaldonlinePdf(read('soroe_raadhus_2026.pdf'), 2026);
    expect(cal.size).toBe(91);
    const o = asObj(cal);
    expect(o['2026-01-03']).toEqual(['Plast/mad- og drikkekarton', 'Restaffald']);
    expect(o['2026-01-16']).toEqual(['Glas', 'Metal', 'Plast/mad- og drikkekarton', 'Restaffald']);
    expect(o['2026-01-21']).toEqual(['Storskrald']);
    expect(o['2026-03-18']).toEqual(['Haveaffald']);
    expect(o['2026-06-12']).toEqual(['Pap/papir', 'Plast/mad- og drikkekarton', 'Restaffald']);
  });

  it('Fanø Hovedgaden 2026', () => {
    const cal = parseAffaldonlinePdf(read('fanoe_hovedgaden_2026.pdf'), 2026);
    expect(cal.size).toBe(51);
    const o = asObj(cal);
    expect(o['2026-01-02']).toEqual(['Bioaffald', 'Restaffald']);
    expect(o['2026-01-06']).toEqual(['Haveaffald']);
    expect(o['2026-01-15']).toEqual(['Bioaffald', 'Restaffald']);
    expect(o['2026-02-17']).toEqual(['Haveaffald']);
  });

  it('Nyborg Slotsgade 2026', () => {
    const cal = parseAffaldonlinePdf(read('nyborg_slotsgade_2026.pdf'), 2026);
    expect(cal.size).toBe(33);
    const o = asObj(cal);
    expect(o['2026-01-06']).toEqual(['Haveaffald', 'Papir/Pap/Plast/Mad-drikkekarton', 'Restaffald']);
    expect(o['2026-01-20']).toEqual(['Haveaffald', 'Restaffald']);
    expect(o['2026-02-03']).toEqual(['Haveaffald', 'Papir/Pap/Plast/Mad-drikkekarton', 'Restaffald']);
    expect(o['2026-03-17']).toEqual(['Haveaffald', 'Restaffald']);
  });

  it('pairs legend icons with the nearest label to the right, in any op order', () => {
    const warnings: string[] = [];
    const cal = parseAffaldonlinePdf(pdfFromOps([
      ['T', 39.69, 186.64, 'JANUAR'],
      ['T', 39.69, 641.88, 'FRE'], ['T', 68.10, 641.88, '9'],
      ['I', 79.94, 640.63, 'I1'], ['I', 92.69, 640.63, 'I4'],
      ['T', 39.69, 627.71, 'MAN'], ['T', 62.50, 627.71, '12'],
      ['I', 79.94, 626.46, 'I9'],
      ['T', 55.28, 172.46, 'Restaffald'], ['I', 39.69, 170.65, 'I1'],
      ['T', 141.41, 172.46, 'Pap'], ['I', 113.06, 170.65, 'I4'],
      ['T', 300.31, 172.46, 'Storskrald'], ['I', 271.96, 170.65, 'I9'],
    ]), 2026, (m) => warnings.push(m));
    expect(asObj(cal)).toEqual({ '2026-01-09': ['Pap', 'Restaffald'], '2026-01-12': ['Storskrald'] });
    expect(warnings).toEqual([]);
  });

  it('adjacent legend icons form a group; the same icon alone means less', () => {
    const cal = parseAffaldonlinePdf(pdfFromOps([
      ['T', 39.69, 186.64, 'JANUAR'],
      ['T', 39.69, 641.88, 'FRE'], ['T', 68.10, 641.88, '9'],
      ['I', 79.94, 640.63, 'I4'], ['I', 92.69, 640.63, 'I5'],
      ['T', 39.69, 627.71, 'MAN'], ['T', 62.50, 627.71, '12'],
      ['I', 79.94, 626.46, 'I4'], ['I', 92.69, 626.46, 'I6'],
      ['T', 271.96, 172.46, 'Pap/papir'], ['I', 246.44, 170.65, 'I4'], ['I', 259.20, 170.65, 'I5'],
      ['T', 371.60, 172.46, 'Pap'], ['I', 356.01, 170.65, 'I4'],
      ['T', 417.57, 172.46, 'Glas'], ['I', 401.98, 170.65, 'I6'],
    ]), 2026);
    expect(asObj(cal)).toEqual({ '2026-01-09': ['Pap/papir'], '2026-01-12': ['Glas', 'Pap'] });
  });

  it('reports icons missing from the legend and rows without fractions', () => {
    const warnings: string[] = [];
    const cal = parseAffaldonlinePdf(pdfFromOps([
      ['T', 39.69, 186.64, 'JANUAR'],
      ['T', 39.69, 641.88, 'FRE'], ['T', 68.10, 641.88, '9'],
      ['I', 79.94, 640.63, 'I1'], ['I', 92.69, 640.63, 'I99'],
      ['T', 39.69, 627.71, 'MAN'], ['T', 62.50, 627.71, '12'],
      ['T', 39.69, 613.54, 'ONS'], ['T', 62.50, 613.54, '21'],
      ['I', 79.94, 612.28, 'I1'],
      ['T', 55.28, 172.46, 'Restaffald'], ['I', 39.69, 170.65, 'I1'],
    ]), 2026, (m) => warnings.push(m));
    expect(asObj(cal)).toEqual({ '2026-01-09': ['Restaffald'], '2026-01-21': ['Restaffald'] });
    expect(warnings).toEqual([
      'missing: icon I99 is not defined by the affaldonline legend',
      'missing: no fraction found for 2026-01-12 in the affaldonline PDF',
    ]);
  });
});
