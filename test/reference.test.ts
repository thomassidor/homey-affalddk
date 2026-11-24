/**
 * Cross-check against upstream: test/fixtures/reference.json is produced by
 * running the original Python pyaffalddk on the same fixtures
 * (scripts/upstream_reference.py). The port must give identical results.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { GarbageCollection } from '../lib/affalddk/collection';
import { fractionSummaries, nextPickup, NEXT_PICKUP } from '../lib/affalddk/summary';

const FIX = path.join(__dirname, 'fixtures');
const reference = JSON.parse(fs.readFileSync(path.join(FIX, 'reference.json'), 'utf8')) as Record<string, {
  municipality: string; fixture: string; loader: string; today: string; address_id: string;
  pickups: Record<string, { date: string; group: string[]; description: string; container_count: number | null }>;
}>;

function load(fixture: string, loader: string): unknown {
  const text = fs.readFileSync(path.join(FIX, fixture), 'utf8');
  if (loader === 'text') return text;
  let data: any = JSON.parse(text);
  for (const part of loader.split(':').slice(1)) data = /^\d+$/.test(part) ? data[Number(part)] : data[part];
  return data;
}

describe('port matches upstream pyaffalddk output', () => {
  for (const [name, ref] of Object.entries(reference)) {
    it(`${name} (${ref.municipality}, ${ref.fixture})`, () => {
      const gc = new GarbageCollection(ref.municipality, { today: () => ref.today });
      expect(gc.apiType).toBe(name);
      const events = gc.normalize(gc.api.parse(load(ref.fixture, ref.loader), ref.address_id), ref.address_id);

      const actual: Record<string, unknown> = {};
      for (const s of fractionSummaries(events, ref.today)) {
        actual[s.key] = { date: s.date, group: [s.key], description: s.description, container_count: s.containerCount ?? null };
      }
      // upstream freezes time at 00:00, i.e. before the switch hour
      const next = nextPickup(events, { today: ref.today, hour: 0, dynamicIcon: true });
      if (next) actual[NEXT_PICKUP] = { date: next.date, group: next.keys, description: next.description, container_count: null };

      expect(actual).toEqual(ref.pickups);
    });
  }
});
