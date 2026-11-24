/**
 * Find one working address per supported municipality and store it in
 * test/fixtures/live-addresses.json (used by test/live/municipalities.live.test.ts).
 *
 *   npx tsx scripts/find-addresses.ts                 # all municipalities missing from the file
 *   npx tsx scripts/find-addresses.ts --all           # redo all
 *   npx tsx scripts/find-addresses.ts Roskilde Køge   # only these
 *   npx tsx scripts/find-addresses.ts "Frederiksberg=2000/Smallegade/3"   # a specific address
 *
 * Candidates are random single-family addresses from the DAWA mirror
 * (dawa.companydata.dk), checked through the same pipeline the app uses:
 * provider address search -> address -> pickups.
 */
import fs from 'fs';
import path from 'path';
import { GarbageCollection, setMissingTypeLogger } from '../lib/affalddk';
import { MUNICIPALITIES_IDS, MUNICIPALITIES_LIST } from '../lib/affalddk/municipalities';

const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'live-addresses.json');
const CANDIDATES_PER_MUNICIPALITY = 10;
const CONCURRENCY = 3;

export interface LiveAddress {
  municipality: string;
  apiType: string;
  zipcode: string;
  street: string;
  houseNumber: string;
  /** Address text as the provider lists it */
  providerAddress: string;
  verified: string;
  eventCount: number;
  keys: string[];
  missingTypes: string[];
}

interface DawaAddress { vejnavn: string; husnr: string; postnr: string; etage: string | null; dør: string | null; betegnelse: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dawaPage(code: string, side: number): Promise<DawaAddress[]> {
  const url = `https://dawa.companydata.dk/adresser?kommunekode=${code}&per_side=100&side=${side}&struktur=mini`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json() as DawaAddress[];
    } catch { /* retry */ }
    await sleep(1000 * 2 ** attempt);
  }
  return [];
}

/** Random single-family addresses (no floor/door, plain house number) spread over a few DAWA pages. */
async function dawaCandidates(kommunekode: number): Promise<DawaAddress[]> {
  const code = String(kommunekode).padStart(4, '0');
  const seen = new Map<string, DawaAddress>();
  const pages = [...new Set([1 + Math.floor(Math.random() * 20), 1 + Math.floor(Math.random() * 5), 2, 1])];
  for (const side of pages) {
    for (const a of await dawaPage(code, side)) {
      if (!a.etage && !a.dør && /^\d+$/.test(a.husnr)) seen.set(a.betegnelse, a);
    }
    if (seen.size >= CANDIDATES_PER_MUNICIPALITY * 2) break;
  }
  // prefer different streets: a street can be outside the scheme (private road, business area)
  const byStreet = new Map<string, DawaAddress[]>();
  for (const a of [...seen.values()].sort(() => Math.random() - 0.5)) {
    if (!byStreet.has(a.vejnavn)) byStreet.set(a.vejnavn, []);
    byStreet.get(a.vejnavn)!.push(a);
  }
  const out: DawaAddress[] = [];
  for (let round = 0; out.length < seen.size; round++) {
    let added = false;
    for (const list of byStreet.values()) if (list[round]) { out.push(list[round]); added = true; }
    if (!added) break;
  }
  return out;
}

function pickMatch(list: string[], street: string, houseNumber: string): string | undefined {
  const num = new RegExp(`(^|\\D)${houseNumber}(\\D|$)`);
  const st = street.toLowerCase();
  return list.find((a) => a.toLowerCase().includes(st) && num.test(a))
    ?? list.find((a) => num.test(a));
}

async function tryAddress(municipality: string, c: DawaAddress): Promise<LiveAddress | null> {
  const missing: string[] = [];
  setMissingTypeLogger((m) => missing.push(m));
  const gc = new GarbageCollection(municipality);
  await gc.init();
  const list = await gc.getAddressList(c.postnr, c.vejnavn, c.husnr);
  const name = pickMatch(list, c.vejnavn, c.husnr);
  if (!name) return null;
  const info = await gc.getAddress(name);
  await gc.initAddress(info.addressId);
  const events = await gc.getPickupEvents(info.addressId);
  if (!events.length) return null;
  return {
    municipality,
    apiType: gc.apiType,
    zipcode: c.postnr,
    street: c.vejnavn,
    houseNumber: c.husnr,
    providerAddress: name,
    verified: new Date().toISOString().slice(0, 10),
    eventCount: events.length,
    keys: [...new Set(events.map((e) => e.key))].sort(),
    missingTypes: [...new Set(missing.map((m) => m.match(/\[(.*?)\]/)?.[1] ?? m))],
  };
}

async function findFor(municipalityArg: string): Promise<{ found?: LiveAddress; log: string }> {
  let municipality = municipalityArg;
  // Explicit address: "Frederiksberg=2000/Smallegade/3"
  const [name, spec] = municipality.split('=');
  if (spec) {
    const [postnr, vejnavn, husnr] = spec.split('/');
    municipality = name;
    try {
      const found = await tryAddress(municipality, { postnr, vejnavn, husnr, etage: null, dør: null, betegnelse: spec });
      return found ? { found, log: `${spec} (${found.eventCount} events)` } : { log: `NOT FOUND: ${spec} gave no pickups` };
    } catch (e) {
      return { log: `NOT FOUND: ${spec}: ${(e as Error).message.slice(0, 120)}` };
    }
  }
  const code = MUNICIPALITIES_IDS[municipality.toLowerCase()];
  if (!code) return { log: 'no kommunekode' };
  const candidates = (await dawaCandidates(code)).slice(0, CANDIDATES_PER_MUNICIPALITY);
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const found = await tryAddress(municipality, c);
      if (found) return { found, log: `${c.betegnelse} (${found.eventCount} events)` };
      errors.push(`${c.vejnavn} ${c.husnr}: none`);
    } catch (e) {
      errors.push(`${c.vejnavn} ${c.husnr}: ${(e as Error).message.slice(0, 80)}`);
    }
    await sleep(300);
  }
  return { log: `NOT FOUND after ${candidates.length} candidates; ${errors.slice(-3).join('; ')}` };
}

async function main() {
  const args = process.argv.slice(2);
  const existing: Record<string, LiveAddress> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const named = args.filter((a) => !a.startsWith('--'));
  const all = Object.keys(MUNICIPALITIES_LIST).sort((a, b) => a.localeCompare(b, 'da'));
  const todo = named.length ? named : all.filter((m) => args.includes('--all') || !existing[m]);
  console.log(`${todo.length} municipalities to check`);

  const failed: string[] = [];
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const m = todo[i++];
      const { found, log } = await findFor(m);
      const name = m.split('=')[0];
      if (found) existing[name] = found; else failed.push(name);
      console.log(`${found ? 'OK  ' : 'FAIL'} ${name.padEnd(18)} ${log}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b, 'da')));
  fs.writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`\n${Object.keys(sorted).length}/${all.length} municipalities have a verified address`);
  if (failed.length) console.log(`Not found: ${failed.join(', ')}`);
}

main();
