/** BeautifulSoup-compatible text helpers on top of cheerio. */
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export { cheerio };
export type { AnyNode, Element };

function collect(node: AnyNode, out: string[]): void {
  if (node.type === 'text') { out.push((node as any).data as string); return; }
  if (node.type === 'tag' || node.type === 'root') {
    const el = node as Element;
    if (el.name === 'script' || el.name === 'style') return;
    for (const child of el.children ?? []) collect(child as AnyNode, out);
  }
}

/** bs4 `el.get_text(separator, strip=True)` */
export function textStrip(node: AnyNode | undefined | null, separator = ''): string {
  if (!node) return '';
  const parts: string[] = [];
  collect(node, parts);
  return parts.map((s) => s.trim()).filter(Boolean).join(separator);
}

/** bs4 `el.get_text()` (no stripping) */
export function textRaw(node: AnyNode | undefined | null): string {
  if (!node) return '';
  const parts: string[] = [];
  collect(node, parts);
  return parts.join('');
}

/** Element children that are tags with the given name (bs4 find_all(name, recursive=False)) */
export function childTags(node: AnyNode | undefined, name: string): Element[] {
  if (!node || !('children' in node)) return [];
  return ((node as Element).children as AnyNode[]).filter((c): c is Element => c.type === 'tag' && (c as Element).name === name);
}

/** Python urllib.parse.quote (safe='/') */
export function pyQuote(s: string): string {
  return encodeURIComponent(s).replace(/%2F/g, '/').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** quote(s.encode('windows-1252')) */
export function pyQuoteCp1252(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (/[A-Za-z0-9_.\-~/]/.test(ch)) out += ch;
    else if (code < 256) out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    else out += encodeURIComponent(ch);
  }
  return out;
}

export function htmlUnescape(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (_m, e: string) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&';
    if (l === 'lt') return '<';
    if (l === 'gt') return '>';
    if (l === 'quot') return '"';
    if (l === 'apos') return "'";
    if (l.startsWith('#x')) return String.fromCodePoint(parseInt(l.slice(2), 16));
    return String.fromCodePoint(parseInt(l.slice(1), 10));
  });
}
