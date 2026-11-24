import { parseDate } from '../dates';
import { ProviderBase, RawPickup } from './base';

const BASE = 'https://europe-west3-perfect-waste.cloudfunctions.net';

/** Perfect Waste (Roskilde, Gladsaxe, Frederiksberg, ...) */
export class PerfectWasteAPI extends ProviderBase {
  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const para = {
      data: { query: `${street} ${houseNumber}`.trim(), municipality: this.municipalityId, page: 1, onlyManual: false },
    };
    let page = await this.http.post<{ result: any[] }>(`${BASE}/searchExternalAddresses`, { json: para });
    const data = [...page.result];
    while (page.result.length === 30) {
      para.data.page += 1;
      page = await this.http.post(`${BASE}/searchExternalAddresses`, { json: para });
      data.push(...page.result);
    }
    this.addressList = {};
    for (const item of data) {
      if (String(item.displayName).includes(String(zipcode))) this.updateAddressList(item, 'displayName', 'addressID');
    }
    return Object.keys(this.addressList);
  }

  async initAddress(addressId: string): Promise<void> {
    await this.http.post(`${BASE}/fetchAddressAndSaveToDb`, {
      json: { data: { addressID: addressId, municipality: this.municipalityId, caretakerCode: null, isCaretaker: null } },
    });
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const res = await this.http.post<{ result: any[] }>(`${BASE}/getAddressCollections`, {
      json: { data: { addressID: addressId, municipality: this.municipalityId } },
    });
    return res.result ?? [];
  }

  parse(raw: any[]): RawPickup[] {
    const out: RawPickup[] = [];
    for (const row of raw) {
      const date = parseDate(row.date);
      for (const item of row.fractions ?? []) {
        out.push({ date, fraction: item.fractionName, containerCount: item.containerCount ?? undefined });
      }
    }
    return out;
  }
}
