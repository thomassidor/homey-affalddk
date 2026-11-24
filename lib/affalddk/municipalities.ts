import data from './data/municipalities.json';

/** lower-case municipality name -> 4-digit kommunekode */
export const MUNICIPALITIES_IDS: Record<string, number> = data.ids;
/** Municipality name -> [api type, optional provider-specific id] */
export const MUNICIPALITIES_LIST = data.list as Record<string, Array<string | number>>;

export const MUNICIPALITY_NAMES = Object.keys(MUNICIPALITIES_LIST).sort((a, b) => a.localeCompare(b, 'da'));

export function resolveMunicipality(name: string): { name: string; apiType: string; id: string | number } | undefined {
  // Legacy name: the openexplive provider (Thisted) was listed as "Thy" before 3.6.0
  const wanted = name.toLowerCase() === 'thy' ? 'thisted' : name.toLowerCase();
  for (const [key, value] of Object.entries(MUNICIPALITIES_LIST)) {
    if (key.toLowerCase() === wanted) {
      return { name: key, apiType: String(value[0]), id: value.length > 1 ? value[1] : (MUNICIPALITIES_IDS[wanted] ?? '') };
    }
  }
  return undefined;
}
