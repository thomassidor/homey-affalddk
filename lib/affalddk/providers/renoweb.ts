import { GH_API } from '../const';
import { dateInTz } from '../dates';
import { ProviderBase, RawPickup } from './base';

const URL_DATA = 'https://servicesgh.renoweb.dk/v1_13/';
const HEADERS = { 'Accept-Encoding': 'gzip' };

/** RenoWeb servicegh API (Aalborg, Esbjerg, Gentofte, ...) */
export class RenowebghAPI extends ProviderBase {
  private readonly apikey = Buffer.from(GH_API, 'base64').toString('utf8');

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const roadId = await this.getRoad(zipcode, street);
    this.addressList = {};
    if (!roadId) return [];
    const params: Record<string, string | number> = { apikey: this.apikey, municipalitycode: this.municipalityId, roadid: roadId };
    if (houseNumber) params.streetBuildingIdentifier = houseNumber;
    const data = await this.http.get(`${URL_DATA}GetJSONAdress.aspx`, { params, headers: HEADERS });
    for (const item of data.list ?? []) {
      if (String(item.presentationString).includes(zipcode)) this.updateAddressList(item, 'presentationString', 'id');
    }
    return Object.keys(this.addressList);
  }

  private async getRoad(zipcode: string, street: string): Promise<string | null> {
    const js = await this.http.get(`${URL_DATA}GetJSONRoad.aspx`, {
      params: { apikey: this.apikey, municipalitycode: this.municipalityId, roadname: street }, headers: HEADERS,
    });
    for (const item of js.list ?? []) if (String(item.name).includes(zipcode)) return item.id;
    return null;
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const js = await this.http.get(`${URL_DATA}GetJSONContainerList.aspx`, {
      params: { apikey: this.apikey, municipalitycode: this.municipalityId, adressId: addressId, fullinfo: 0, supportsSharedEquipment: 0 },
      headers: HEADERS,
    });
    return js?.list ?? [];
  }

  parse(raw: any[]): RawPickup[] {
    return raw.filter((item) => item.nextpickupdatetimestamp).map((item) => ({
      date: dateInTz(new Date(parseInt(item.nextpickupdatetimestamp, 10) * 1000), this.ctx.tz),
      fraction: item.name,
    }));
  }
}
