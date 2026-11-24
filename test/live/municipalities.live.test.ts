/**
 * Live end-to-end check of every supported municipality against the real
 * provider APIs, using the addresses in test/fixtures/live-addresses.json
 * (found and verified by scripts/find-addresses.ts).
 *
 *   npm run test:live
 *   npm run test:live -- -t Roskilde          # one municipality
 *
 * Needs internet access (some providers only answer Danish IPs). A failure
 * means the provider changed or is down - or that the address lost service:
 * re-run `npx tsx scripts/find-addresses.ts <Municipality>` to pick a new one.
 */
import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { GarbageCollection, setMissingTypeLogger, today } from '../../lib/affalddk';
import { MUNICIPALITIES_LIST } from '../../lib/affalddk/municipalities';

interface LiveAddress {
  municipality: string; apiType: string; zipcode: string; street: string; houseNumber: string;
  providerAddress: string; eventCount: number; keys: string[]; missingTypes: string[];
}

const addresses = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'live-addresses.json'), 'utf8')) as Record<string, LiveAddress>;

// The fraction logger is global; messages carry the municipality name, so they can be attributed.
const missingMessages: string[] = [];
setMissingTypeLogger((m) => missingMessages.push(m));

describe('live-addresses.json', () => {
  it('has an address for every supported municipality', () => {
    const missing = Object.keys(MUNICIPALITIES_LIST).filter((m) => !addresses[m]);
    expect(missing, 'run: npx tsx scripts/find-addresses.ts').toEqual([]);
  });
});

describe.concurrent('live: municipalities', () => {
  for (const [name, a] of Object.entries(addresses)) {
    it(`${name} (${a.apiType}) – ${a.street} ${a.houseNumber}, ${a.zipcode}`, async () => {
      const gc = new GarbageCollection(name);
      expect(gc.apiType).toBe(a.apiType);
      await gc.init();

      const list = await gc.getAddressList(a.zipcode, a.street, a.houseNumber);
      expect(list.length, 'address search returned nothing').toBeGreaterThan(0);
      const match = list.includes(a.providerAddress) ? a.providerAddress
        : list.find((l) => l.toLowerCase().includes(a.street.toLowerCase()) && new RegExp(`(^|\\D)${a.houseNumber}(\\D|$)`).test(l));
      expect(match, `"${a.providerAddress}" not in search result: ${list.slice(0, 5).join(' | ')}`).toBeTruthy();

      const info = await gc.getAddress(match!);
      expect(info.addressId).toBeTruthy();
      await gc.initAddress(info.addressId);

      const events = await gc.getPickupEvents(info.addressId);
      expect(events.length, 'no upcoming pickups').toBeGreaterThan(0);
      const now = today();
      for (const e of events) {
        expect(e.date >= now, `past date ${e.date}`).toBe(true);
        expect(e.key).toMatch(/^[a-zæøå]+$/);
      }
    });
  }
});

afterAll(() => {
  if (!missingMessages.length) return;
  const unique = [...new Set(missingMessages.map((m) => m.replace(/, Address ID: .*$/, '')))];
  console.warn(`\nUnknown waste type names (skipped, as upstream does - report to briis/affalddk):\n  ${unique.join('\n  ')}`);
});
