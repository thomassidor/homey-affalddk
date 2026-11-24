/**
 * The store PNGs at their other sizes, with sharp:
 *  - assets/images/large.png (500x350) and small.png (250x175) from xlarge.png,
 *    which `node scripts/render.mjs store` renders from dev/store-art.html (direction D, Mosaik)
 *  - drivers/address/assets/images/{small,large,xlarge}.png: the app icon on the app's colours
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const img = (...p) => join(ROOT, ...p);

const xlarge = img('assets', 'images', 'xlarge.png');
for (const [name, w, h] of [['large', 500, 350], ['small', 250, 175]]) {
  await sharp(xlarge).resize(w, h, { kernel: 'lanczos3' }).png().toFile(img('assets', 'images', `${name}.png`));
  console.log(`wrote assets/images/${name}.png`);
}

// Driver images: the wheelie bin in the app's green on a soft green disc, on white (Homey's pairing list).
const glyph = readFileSync(img('assets', 'icon.svg'), 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const driverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <rect width="1000" height="1000" fill="#ffffff"/>
  <circle cx="500" cy="500" r="420" fill="#E3F0E2"/>
  <g transform="translate(206 174) scale(0.625)" fill="none" stroke="#2E7D32" stroke-width="48" stroke-linecap="round" stroke-linejoin="round">${glyph.replace(/stroke="#000"/g, '')}</g>
</svg>`;
for (const [name, size] of [['xlarge', 1000], ['large', 500], ['small', 75]]) {
  await sharp(Buffer.from(driverSvg), { density: 300 }).resize(size, size).png().toFile(img('drivers', 'address', 'assets', 'images', `${name}.png`));
  console.log(`wrote drivers/address/assets/images/${name}.png`);
}
