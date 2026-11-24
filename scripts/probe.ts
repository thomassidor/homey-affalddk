/**
 * Live probe of one municipality, like upstream scripts/async_test_module.py.
 *   npm run probe -- Roskilde --zip 4040 --street Bygaden [--number 2] [--pick 0]
 */
import { GarbageCollection, fractionSummaries, nextPickup, localParts, setMissingTypeLogger, MUNICIPALITY_NAMES } from '../lib/affalddk';

async function main() {
  const args = process.argv.slice(2);
  const get = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--municipalities')) { console.log(MUNICIPALITY_NAMES.join('\n')); return; }
  const muni = args[0];
  setMissingTypeLogger((m) => console.warn('WARN', m));
  const gc = new GarbageCollection(muni);
  console.log(`${gc.municipality} -> ${gc.apiType}`);
  await gc.init();
  const list = await gc.getAddressList(get('zip') ?? '', get('street') ?? '', get('number') ?? '');
  console.log(`${list.length} addresses`, list.slice(0, 10));
  if (!list.length) return;
  const info = await gc.getAddress(list[Number(get('pick') ?? 0)]);
  console.log(info);
  await gc.initAddress(info.addressId);
  if (args.includes("--raw")) console.log(JSON.stringify(await gc.api.getPickups(info.addressId)).slice(0, 1500));
  const events = await gc.getPickupEvents(info.addressId);
  const { date, hour, minute } = localParts();
  console.table(fractionSummaries(events, date));
  console.log('next:', nextPickup(events, { today: date, hour, minute, dynamicIcon: true }));
  console.log(`${events.length} events total`);
}
main().catch((e) => { console.error(e); process.exit(1); });
