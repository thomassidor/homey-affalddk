/**
 * Live check of every provider with one known address each (addresses from
 * upstream tests/test_interface.py and scripts/weekly_api_check.py).
 *   npx tsx scripts/smoke.ts [apiType ...]
 * Some endpoints only answer from Danish IP addresses.
 */
import { GarbageCollection, setMissingTypeLogger } from '../lib/affalddk';

const PROBES: Record<string, [string, string, string, string]> = {
  perfectwaste: ['Roskilde', '4040', 'Bygaden', '3'],
  renoweb: ['Aalborg', '9000', 'Boulevarden', '13'],
  affaldonline: ['Vejle', '7100', 'Klostergade', '2A'],
  // 2026-11: ToemmeDates answers 500 for upstream too (site change)
  vestfor: ['Albertslund', '2620', 'Nordmarks Alle', '1'],
  openexp: ['Holstebro', '7500', 'Kirkestræde', '11'],
  openexplive: ['Fredericia', '7000', 'Prinsessegade', '10'],
  affaldonlinepdf: ['Sorø', '4180', 'Rådhusvej', '8'],
  renodjurs: ['Norddjurs', '8500', 'Torvet', '3'],
  renosyd: ['Odder', '8300', 'Nørregade', '12b'],
  aarhus: ['Aarhus', '8000', 'Rådhuspladsen', '2'],
  provas: ['Haderslev', '6100', 'Christian X Vej', '29'],
  herning: ['Herning', '7400', 'Torvet', '5'],
  ikastbrande: ['Ikast-Brande', '7430', 'Gammelagervej', '8'],
  kolding: ['Kolding', '6000', 'Skovbrynet', '2'],
  affaldkk: ['København', '2300', 'Irlandsvej', '1'],
  odense: ['Odense', '5000', 'Flakhaven', '2'],
  affaldonlineweb: ['Silkeborg', '8600', 'Vestergade', '3'],
  wastewatch: ['Tønder', '6261', 'Håndværkervej', '4'],
};

async function probe(type: string): Promise<string> {
  const [muni, zip, street, no] = PROBES[type];
  const missing: string[] = [];
  setMissingTypeLogger((m) => missing.push(m));
  const gc = new GarbageCollection(muni);
  await gc.init();
  const list = await gc.getAddressList(zip, street, no);
  if (!list.length) return `NO ADDRESSES for ${street} ${no}, ${zip}`;
  const info = await gc.getAddress(list[0]);
  await gc.initAddress(info.addressId);
  const events = await gc.getPickupEvents(info.addressId);
  const keys = [...new Set(events.map((e) => e.key))];
  const first = events[0] ? `${events[0].date} ${events[0].key}` : '-';
  return `${list.length} addr, "${info.address}" -> ${events.length} events, keys [${keys.join(', ')}], first ${first}`
    + (missing.length ? `\n      MISSING: ${missing.join('\n      ')}` : '');
}

async function main() {
  const types = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROBES);
  let failed = 0;
  await Promise.all(types.map(async (t) => {
    try {
      const r = await probe(t);
      if (r.startsWith('NO ') || r.includes('-> 0 events')) failed++;
      console.log(`${t.padEnd(16)} ${r}`);
    } catch (e) {
      failed++;
      console.log(`${t.padEnd(16)} ERROR ${(e as Error).name}: ${(e as Error).message}`);
    }
  }));
  console.log(failed ? `${failed} provider(s) failed` : 'all providers OK');
  process.exitCode = failed ? 1 : 0;
}
main();
