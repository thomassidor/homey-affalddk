/**
 * Renders the dev pages to PNGs with headless Edge (or Chrome), for looking at
 * the pairing view and the widget without a Homey. Output: .renders/ (gitignored).
 *
 *   node scripts/render.mjs                 # everything
 *   node scripts/render.mjs pair widget     # some groups
 *
 * EDGE=<path to a Chromium browser> overrides the browser.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, '.renders');
const BROWSERS = [
  process.env.EDGE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const BROWSER = BROWSERS.find((b) => existsSync(b));

const SHOTS = {
  pair: [
    ['pair-1', '/dev/pair-preview.html?step=1', 422, 900],
    ['pair-1-error', '/dev/pair-preview.html?step=1&error=1', 422, 900],
    ['pair-2', '/dev/pair-preview.html?step=2', 422, 900],
    ['pair-3', '/dev/pair-preview.html?step=3', 422, 1000],
    ['pair-3-en', '/dev/pair-preview.html?step=3&lang=en', 422, 1000],
  ],
  widget: [
    ['widget-all', '/dev/preview.html', 1300, 900],
  ],
  review: [
    ['store-art', '/dev/store-art.html', 1200, 3800],
  ],
  // the store previews: written into the widget folder at 1x, transparent
  previews: [
    ['../widgets/upcoming/preview-dark', '/dev/widget-previews.html?theme=dark', 1024, 1024, 1],
    ['../widgets/upcoming/preview-light', '/dev/widget-previews.html?theme=light', 1024, 1024, 1],
  ],
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  const server = createServer((req, res) => {
    const file = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function shoot(url, file, width, height) {
  const profile = mkdtempSync(join(tmpdir(), 'affald-render-'));
  try {
    execFileSync(BROWSER, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=3000',
      `--user-data-dir=${profile}`, '--force-device-scale-factor=2',
      `--window-size=${width},${height}`, `--screenshot=${file}`, url,
    ], { stdio: 'ignore' });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

if (!BROWSER) throw new Error('No Edge/Chrome found; set EDGE=<path>');
mkdirSync(OUT, { recursive: true });
const groups = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
// The pages run off the repo; serve it in a child process, since the browser call blocks this one.
const server = await serve();
const { port } = server.address();
// execFileSync blocks the event loop, so the server can't answer: run it from a worker instead.
const { Worker } = await import('node:worker_threads');
for (const g of groups) {
  for (const [name, path, w, h, scale = 2] of SHOTS[g] ?? []) {
    const file = join(OUT, `${name}.png`);
    await new Promise((res, rej) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const { execFileSync } = require('node:child_process');
        const { mkdtempSync, rmSync } = require('node:fs');
        const { join } = require('node:path');
        const { tmpdir } = require('node:os');
        const profile = mkdtempSync(join(tmpdir(), 'affald-render-'));
        try {
          execFileSync(workerData.browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=3000',
            '--user-data-dir=' + profile, '--force-device-scale-factor=' + workerData.scale, '--default-background-color=00000000', '--window-size=' + workerData.w + ',' + workerData.h,
            '--screenshot=' + workerData.file, workerData.url], { stdio: 'ignore' });
        } finally { rmSync(profile, { recursive: true, force: true }); }
        parentPort.postMessage('done');
      `, { eval: true, workerData: { browser: BROWSER, url: `http://127.0.0.1:${port}${path}`, file, w, h, scale } });
      worker.on('message', res);
      worker.on('error', rej);
    });
    console.log('wrote', file.slice(ROOT.length + 1));
  }
}
server.close();
void shoot;
