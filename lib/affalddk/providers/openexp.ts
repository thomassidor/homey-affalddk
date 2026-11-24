import { parseDate } from '../dates';
import { pyQuote } from '../parsers/html';
import { ProviderBase, ProviderContext, RawPickup, upcoming } from './base';

/** Open Experience (Holstebro, Lemvig, Skive, Struer, Nordfyns) */
export class OpenExperienceAPI extends ProviderBase {
  private readonly urlBase = `https://${this.municipalityId}`;

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const address = `${street} ${houseNumber}`.trim();
    const data = await this.http.get(`${this.urlBase}search/address/${pyQuote(address)}/limit/200`);
    this.addressList = {};
    const results = [...(data.results ?? [])].sort((a: any, b: any) => parseInt(a.addressId, 10) - parseInt(b.addressId, 10));
    for (const item of results) if (String(item.displayName).includes(zipcode)) this.updateAddressList(item, 'displayName', 'addressId');
    return Object.keys(this.addressList);
  }

  fetchRaw(addressId: string): Promise<any> {
    return this.http.get(`${this.urlBase}address/${addressId}/collections`);
  }

  parse(raw: any): RawPickup[] {
    const out: RawPickup[] = [];
    for (const item of raw.collections ?? []) {
      for (const date of upcoming((item.dates ?? []).map((d: string) => parseDate(d)), this.today)) {
        out.push({ date, fraction: item.fraction.name });
      }
    }
    return out;
  }
}

/** Open Experience live.affaldsapi.dk (Fredericia, Thisted) */
export class OpenExperienceLiveAPI extends ProviderBase {
  private readonly headers: Record<string, string>;
  private readonly mid: string;

  constructor(municipalityId: string | number, ctx: ProviderContext) {
    super(municipalityId, ctx);
    const id = String(municipalityId);
    this.mid = id[0];
    this.headers = { 'X-Auth-Token': Buffer.from(id.slice(1), 'base64').toString('utf8') };
  }

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const address = `${street} ${houseNumber}`.trim();
    const data = await this.http.get(`https://live.affaldsapi.dk/address/v1/search/${this.mid}/${pyQuote(address)}/100`, { headers: this.headers });
    this.addressList = {};
    for (const item of [...data].sort((a: any, b: any) => parseInt(a.id, 10) - parseInt(b.id, 10))) {
      if (String(item.name).includes(zipcode)) this.updateAddressList(item, 'name', 'id');
    }
    return Object.keys(this.addressList);
  }

  fetchRaw(addressId: string): Promise<any[]> {
    return this.http.get(`https://live.affaldsapi.dk/arrangements/v1/collections/calendar/${this.mid}/${addressId}`, { headers: this.headers });
  }

  parse(raw: any[]): RawPickup[] {
    const out: RawPickup[] = [];
    for (const item of raw) {
      const dates = (item.upcoming_dates ?? []).map((d: any) => parseDate(d.date));
      for (const date of upcoming(dates, this.today)) out.push({ date, fraction: item.fraction.name });
    }
    return out;
  }
}
