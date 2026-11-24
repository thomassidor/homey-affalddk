import { describe, expect, it } from 'vitest';
import corpus from './fixtures/const_tests.json';
import { cleanFractionString, getGarbageTypes, NOT_SUPPORTED, splitIcalGarbageTypes, compareAddresses } from '../lib/affalddk/fractions';
import { NAME_LIST, SUPPORTED_ITEMS } from '../lib/affalddk/const';
import da from '../lib/affalddk/data/i18n.da.json';
import en from '../lib/affalddk/data/i18n.en.json';

const c = corpus as unknown as {
  SUPPORTED_ITEMS: Record<string, string[]>;
  MATERIAL_LIST: Record<string, string[]>;
  NON_MATERIAL_LIST: string[];
};

function failures(list: Record<string, string[]>) {
  const bad: string[] = [];
  for (const [category, vals] of Object.entries(list)) {
    for (const val of vals) {
      const got = getGarbageTypes(val)[0];
      if (got !== category) bad.push(`${JSON.stringify(val)} -> ${got} (want ${category}; cleaned ${JSON.stringify(cleanFractionString(val))})`);
    }
  }
  return bad;
}

describe('fraction mapping (upstream test_api.py corpora)', () => {
  it('maps every SUPPORTED_ITEMS test name', () => {
    expect(failures(c.SUPPORTED_ITEMS)).toEqual([]);
  });

  it('maps every MATERIAL_LIST name', () => {
    expect(failures(c.MATERIAL_LIST)).toEqual([]);
  });

  it('rejects NON_MATERIAL_LIST names', () => {
    for (const val of c.NON_MATERIAL_LIST) expect(getGarbageTypes(val)[0], val).toBe(NOT_SUPPORTED);
  });

  it('library SUPPORTED_ITEMS map to themselves', () => {
    expect(failures(SUPPORTED_ITEMS)).toEqual([]);
  });

  it('every key has a name in NAME_LIST and both translations', () => {
    for (const key of Object.keys(SUPPORTED_ITEMS)) {
      expect(NAME_LIST[key], key).toBeTruthy();
      expect((da as any).waste_name[key], key).toBeTruthy();
      expect((en as any).waste_name[key], key).toBeTruthy();
    }
  });
});

describe('helpers', () => {
  it('splits iCal summaries', () => {
    expect(splitIcalGarbageTypes('Tømning af Madaffald, Restaffald, Papir & småt pap på Flakhaven 2'))
      .toEqual(['Madaffald', 'Restaffald', 'Papir & småt pap']);
  });

  it('sorts addresses by house number', () => {
    const list = ['Vej 10', 'Vej 2, 1. th', 'Vej 2', 'Vej', 'Vej 2, 1. tv'];
    expect([...list].sort(compareAddresses)).toEqual(['Vej 2', 'Vej 2, 1. th', 'Vej 2, 1. tv', 'Vej 10', 'Vej']);
  });
});
