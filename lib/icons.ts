/**
 * The waste type icons (upstream's SVGs) live in the widget's public folder, so the
 * widget can load them by relative URL. The pairing view can't reach that folder,
 * so it gets them inline as data URLs.
 */
import fs from 'fs';
import path from 'path';

const ICON_DIR = path.join(__dirname, '..', 'widgets', 'upcoming', 'public', 'icons');
const FALLBACK = 'genbrug';

let available: Set<string> | undefined;
const dataUrls = new Map<string, string>();

function list(): Set<string> {
  if (!available) {
    try {
      available = new Set(fs.readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));
    } catch {
      available = new Set();
    }
  }
  return available;
}

/** The icon's file name (without .svg) for a waste type key, falling back to the recycling icon. */
export function iconKey(key: string): string {
  return list().has(key) ? key : FALLBACK;
}

/** `icons/<key>.svg`, relative to the widget's public folder. */
export function widgetIconPath(key: string): string {
  return `icons/${iconKey(key)}.svg`;
}

export function iconDataUrl(key: string): string | null {
  const k = iconKey(key);
  if (!dataUrls.has(k)) {
    try {
      dataUrls.set(k, `data:image/svg+xml;base64,${fs.readFileSync(path.join(ICON_DIR, `${k}.svg`)).toString('base64')}`);
    } catch {
      return null;
    }
  }
  return dataUrls.get(k)!;
}
