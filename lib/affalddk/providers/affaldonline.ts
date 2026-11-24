import { parseDate } from '../dates';
import { ProviderBase, ProviderContext, RawPickup } from './base';

const URL_BASE = 'https://www.affaldonline.dk/api/address/';

/** AffaldOnline app API (Assens, Favrskov, Faaborg-Midtfyn, ...) */
export class AffaldOnlineAPI extends ProviderBase {
  private readonly headers: Record<string, string>;

  constructor(municipalityId: string | number, ctx: ProviderContext) {
    super(municipalityId, ctx);
    this.headers = {
      'X-Client-Provider': Buffer.from(String(municipalityId), 'base64').toString('utf8'),
      'X-Client-Type': 'Kunde app',
      'X-Client-Version': '22',
    };
  }

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const params = { q: `${street} ${houseNumber}`.trim(), page: 1 };
    let page = await this.http.get(`${URL_BASE}search`, { params, headers: this.headers });
    const data = [...page.results];
    while (page.results.length === 50) {
      params.page += 1;
      page = await this.http.get(`${URL_BASE}search`, { params, headers: this.headers });
      data.push(...page.results);
    }
    this.addressList = {};
    for (const item of data) if (String(item.displayName).includes(zipcode)) this.updateAddressList(item, 'displayName', 'addressId');
    return Object.keys(this.addressList);
  }

  fetchRaw(addressId: string): Promise<any[]> {
    return this.http.get(`${URL_BASE}collections`, { params: { groupBy: 'date', addressId }, headers: this.headers });
  }

  parse(raw: any[]): RawPickup[] {
    const out: RawPickup[] = [];
    for (const item of raw) {
      const date = parseDate(item.date);
      for (const collection of item.collections ?? []) {
        const descriptions = new Set<string>((collection.containers ?? []).map((c: any) => c.description));
        for (const fraction of descriptions) out.push({ date, fraction });
      }
    }
    return out;
  }
}
