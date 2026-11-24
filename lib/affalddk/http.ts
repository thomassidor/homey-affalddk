import { AffaldDKNoConnection, AffaldDKNotSupportedError } from './errors';

const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const INITIAL_DELAY_MS = 100;

export type Params = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Sent as an OPTIONS preflight before the real request. */
  preHeaders?: Record<string, string>;
  /** Query string parameters */
  params?: Params;
  /** JSON body */
  json?: unknown;
  /** url-encoded form body */
  form?: Params;
  /** Return text instead of parsed JSON */
  text?: boolean;
  /** Return raw bytes as a Buffer */
  binary?: boolean;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withParams(url: string, params?: Params): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.append(k, String(v));
  }
  return u.toString();
}

function encodeForm(form: Params): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) p.append(k, String(v));
  return p.toString();
}

function decode(buf: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  if (charset && ['iso-8859-1', 'latin1', 'windows-1252', 'cp1252', 'latin-1'].includes(charset)) return buf.toString('latin1');
  return buf.toString('utf8').replace(/^﻿/, '');
}

function hasHeader(h: Record<string, string>, name: string): boolean {
  return Object.keys(h).some((k) => k.toLowerCase() === name);
}

/**
 * HTTP client mirroring pyaffalddk's AffaldDKAPIBase.async_api_request:
 * 30s timeout, 5 tries with exponential backoff on connection errors / non-200,
 * 400/404 -> AffaldDKNotSupportedError (no retry). Keeps a cookie jar like an
 * aiohttp session does.
 */
export class HttpClient {
  private cookies = new Map<string, string>();
  retryDelayMs = INITIAL_DELAY_MS;

  constructor(private readonly fetchImpl: FetchLike = (u, i) => globalThis.fetch(u, i)) {}

  clearCookies(): void { this.cookies.clear(); }

  get<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', url, opts);
  }

  post<T = any>(url: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', url, opts);
  }

  async request<T = any>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
    const target = withParams(url, opts.params);
    if (opts.preHeaders && Object.keys(opts.preHeaders).length) {
      const res = await this.fetchWithTimeout(target, { method: 'OPTIONS', headers: opts.preHeaders });
      if (!res.ok) throw new AffaldDKNoConnection(`Preflight error ${res.status} from ${url}`);
    }

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: string | undefined;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    } else if (opts.form !== undefined) {
      body = encodeForm(opts.form);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await this.fetchWithTimeout(target, { method, headers: this.withCookies(headers), body });
        this.storeCookies(res);
        if (res.status === 200) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (opts.binary) return buf as unknown as T;
          const txt = decode(buf, res.headers.get('content-type'));
          return (opts.text ? txt : JSON.parse(txt)) as T;
        }
        if (res.status === 400 || res.status === 404) throw new AffaldDKNotSupportedError('Municipality not supported');
        throw new AffaldDKNoConnection(res.status === 503
          ? 'System API is currently not available'
          : `Error ${res.status} from ${url}`);
      } catch (err) {
        if (err instanceof AffaldDKNotSupportedError) throw err;
        if (err instanceof SyntaxError) throw new AffaldDKNoConnection(`Invalid JSON from ${url}`);
        lastError = err instanceof AffaldDKNoConnection
          ? err
          : new AffaldDKNoConnection(`${(err as Error)?.message ?? err} (${url})`);
        if (attempt < MAX_RETRIES - 1) await sleep(this.retryDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
    } finally {
      clearTimeout(t);
    }
  }

  private withCookies(headers: Record<string, string>): Record<string, string> {
    if (!this.cookies.size || hasHeader(headers, 'cookie')) return headers;
    return { ...headers, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  }

  private storeCookies(res: Response): void {
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const list = typeof h?.getSetCookie === 'function' ? h.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
}
