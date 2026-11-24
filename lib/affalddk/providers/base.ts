import { AV_ADRESSER, AV_ADRESSER_SOEG, AV_TOKEN } from '../const';
import { DateStr } from '../dates';
import { HttpClient } from '../http';

/** One pickup as delivered by a provider, before fraction mapping. */
export interface RawPickup {
  date: DateStr | null;
  /** Free-text fraction name as the provider writes it */
  fraction: string;
  containerCount?: number;
}

export interface ProviderContext {
  http: HttpClient;
  /** Today's date in the user's time zone */
  today: () => DateStr;
  tz: string;
}

export interface AddressEntry { id: string; fullname: string; [extra: string]: unknown }

/** removes everything from the last comma if a postal code is in the last part */
export function cleanName(name: string): string {
  return name.replace(/,\s*\d{4}.*$/s, '');
}

export function splitHousenumber(s: string): [number, string] {
  if (s.includes(',')) {
    const [num, ch] = s.split(',');
    return [parseInt(num, 10), ch.trim()];
  }
  const m = s.match(/^(\d+)([a-zA-Z]*)$/);
  if (m) return [parseInt(m[1], 10), m[2]];
  return [parseInt(s, 10), ''];
}

/** First n dates >= today, sorted (used by several providers that list many dates). */
export function upcoming(dates: Array<DateStr | null>, today: DateStr, n = 2): DateStr[] {
  return (dates.filter((d): d is DateStr => !!d && d >= today)).sort().slice(0, n);
}

export abstract class ProviderBase {
  addressList: Record<string, AddressEntry> = {};

  constructor(
    readonly municipalityId: string | number,
    protected readonly ctx: ProviderContext,
  ) {}

  protected get http(): HttpClient { return this.ctx.http; }

  protected get today(): DateStr { return this.ctx.today(); }

  protected get year(): number { return Number(this.today.slice(0, 4)); }

  /** Called once before an address search (e.g. to fetch a token). */
  async init(): Promise<void> {}

  /** Called once when a new address is added. */
  async initAddress(_addressId: string): Promise<void> {}

  abstract getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]>;

  async getAddress(addressName: string): Promise<[string | null, string | null]> {
    const entry = this.addressList[addressName];
    return entry ? [String(entry.id), addressName] : [null, null];
  }

  /** Network part: returns the same shape as upstream's get_garbage_data. */
  abstract fetchRaw(addressId: string): Promise<any>;

  /** Pure part: turn fetchRaw's result into pickups (unit-tested with upstream fixtures). */
  abstract parse(raw: any, addressId?: string): RawPickup[];

  async getPickups(addressId: string): Promise<RawPickup[]> {
    return this.parse(await this.fetchRaw(addressId), addressId);
  }

  protected updateAddressList(item: Record<string, any>, nameKey: string, idKey: string, extra: Record<string, unknown> = {}): void {
    let name = cleanName(String(item[nameKey]));
    if (name in this.addressList) {
      name += ' *';
      while (name in this.addressList) name += '*';
    }
    this.addressList[name] = { ...extra, id: String(item[idKey]), fullname: String(item[nameKey]) };
  }

  // ---- Klimadatastyrelsens Adressevælger (replacement for the retired DAWA) ----

  protected async getAvAddressList(zipcode: string, street: string, houseNumber: string, code?: number): Promise<string[]> {
    const params: Record<string, string> = {
      vejnavn: street, postnummer: String(zipcode), maksimum: '200', token: AV_TOKEN,
    };
    if (houseNumber) params.husnummer = houseNumber;
    if (code !== undefined) params.kommunekode = String(code).padStart(4, '0');
    const data = await this.http.get<{ fund?: Array<Record<string, any>> }>(AV_ADRESSER_SOEG, { params });
    this.addressList = {};
    for (const item of data.fund ?? []) {
      if (item.type !== 'adresse') continue;
      this.updateAddressList(item, 'titel', 'id');
    }
    return Object.keys(this.addressList);
  }

  protected async getAvItem(addressId: string): Promise<Record<string, any>> {
    const data = await this.http.get<Record<string, any>>(`${AV_ADRESSER}/${addressId}`, { params: { token: AV_TOKEN } });
    return data.adresse ?? {};
  }

  /** 19-char kvhx key: kommunekode(4) vejkode(4) husnr(4) etage(3) dør(4), '_'-padded. */
  protected async getAvKvhx(addressId: string): Promise<[string, Record<string, any>]> {
    const adresse = await this.getAvItem(addressId);
    const husnummer = adresse.husnummer ?? {};
    const komdel = husnummer.navngivenvejkommunedel ?? {};
    const p = (v: unknown, w: number) => String(v ?? '').padStart(w, '_');
    const kvhx = p(komdel.kommune, 4) + p(komdel.vejkode, 4) + p(husnummer.husnummertekst, 4)
      + p(adresse.etagebetegnelse, 3) + p(adresse.doerbetegnelse, 4);
    return [kvhx, adresse];
  }

  /** Flat DAWA-mini style attributes (husnr, vejnavn, postnr) via the Adressevælger. */
  protected async getItem(addressId: string): Promise<{ husnr?: string; vejnavn?: string; postnr?: string }> {
    const adresse = await this.getAvItem(addressId);
    const husnummer = adresse.husnummer ?? {};
    return {
      husnr: husnummer.husnummertekst,
      vejnavn: husnummer.vejnavn,
      postnr: (husnummer.postnummer ?? {}).postnr,
    };
  }

  protected async getKvhx(addressName: string): Promise<[string, string] | undefined> {
    const item = this.addressList[addressName];
    if (!item) return undefined;
    const [kvhx] = await this.getAvKvhx(item.id);
    return [kvhx, addressName];
  }
}
