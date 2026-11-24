/**
 * Translate a Python `re` pattern (str, unicode) into a JS RegExp.
 * Python's \b, \w and \W are Unicode-aware; JS's are ASCII-only even with /u,
 * which matters for Danish letters (æ, ø, å).
 */
const W = '[\\p{L}\\p{N}_]';
const NW = '[^\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

export function pyRegex(src: string, flags = ''): RegExp {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      i++;
      if (n === 'b' && !inClass) out += B;
      else if (n === 'w') out += inClass ? '\\p{L}\\p{N}_' : W;
      else if (n === 'W' && !inClass) out += NW;
      else if ('^$\\.*+?()[]{}|/'.includes(n) || 'dDsSnrtfvux0123456789B'.includes(n)) out += `\\${n}`;
      else if (n === '-') out += inClass ? '\\-' : '-';
      // Python tolerates identity escapes (e.g. "\ ") that are syntax errors in JS /u mode
      else out += n;
      continue;
    }
    if (c === '[' && !inClass) inClass = true;
    else if (c === ']' && inClass) inClass = false;
    out += c;
  }
  return new RegExp(out, `${flags}u`);
}
