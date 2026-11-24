/**
 * Builds the store art review page from dev/store-art.src.html with the waste type
 * icons inlined (so it works as a standalone page):
 *   dev/store-art.html          local copy with a doctype, for rendering the PNGs
 *   <out>/store-art.html        the bare page (pass a directory as the first argument)
 *
 * Export one artboard to the store PNGs: node scripts/render.mjs store
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ICON_DIR = join(ROOT, 'widgets', 'upcoming', 'public', 'icons');
const KEYS = ['restaffaldmadaffald', 'pappi', 'metalglas', 'farligtaffald', 'tekstil', 'papir', 'pap', 'glas', 'plastmadkarton',
  'madaffald', 'restaffald', 'haveaffald', 'storskrald', 'plast', 'batterier', 'elektronik', 'pappapir', 'plastmetal'];

const icons = Object.fromEntries(KEYS.map((k) => [k, `data:image/svg+xml;base64,${readFileSync(join(ICON_DIR, `${k}.svg`)).toString('base64')}`]));
const src = readFileSync(join(ROOT, 'dev', 'store-art.src.html'), 'utf8');
const page = src.replace('/*ICONS*/', `var ICONS = ${JSON.stringify(icons)};`);

writeFileSync(join(ROOT, 'dev', 'store-art.html'), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n${page}\n</body></html>\n`);
console.log('wrote dev/store-art.html');
if (process.argv[2]) {
  writeFileSync(join(process.argv[2], 'store-art.html'), page);
  console.log(`wrote ${join(process.argv[2], 'store-art.html')}`);
}
