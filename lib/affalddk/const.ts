import data from './data/const.json';

export const SUPPORTED_ITEMS: Record<string, string[]> = data.SUPPORTED_ITEMS;
export const NON_SUPPORTED_ITEMS: string[] = data.NON_SUPPORTED_ITEMS;
export const SPECIAL_MATERIALS: Record<string, string[]> = data.SPECIAL_MATERIALS;
export const NAME_LIST: Record<string, string> = data.NAME_LIST;
export const STRIPS: string[] = data.STRIPS;
export const RE_WORDS: string[] = data.RE_WORDS;
export const RE_RAW: string[] = data.RE_RAW;
export const WEEKDAYS: string[] = data.WEEKDAYS;
export const DANISH_MONTHS: Record<string, string> = data.DANISH_MONTHS;
export const AV_ADRESSER: string = data.AV_ADRESSER;
export const AV_ADRESSER_SOEG: string = data.AV_ADRESSER_SOEG;
export const AV_TOKEN: string = data.AV_TOKEN;
/** base64 RenoWeb (servicesgh) api key, as upstream const.GH_API */
export const GH_API = 'NDc5RDQwRjQtQjNFMS00MDM4LTkxMzAtNzY0NTMxODhDNzRD';
