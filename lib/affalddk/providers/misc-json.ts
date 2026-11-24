/** Smaller JSON providers: Vest Forbrænding, Provas, RenoSyd, Aarhus, Odense, Kolding, Ikast-Brande search. */
import { addDays, parseDate } from '../dates';
import { pyQuote } from '../parsers/html';
import { parseIcs } from '../parsers/ics';
import { splitIcalGarbageTypes } from '../fractions';
import { ProviderBase, RawPickup, upcoming } from './base';

/** Vest Forbrænding (Albertslund, Furesø, Herlev, Ishøj, Vallensbæk) */
export class VestForAPI extends ProviderBase {
  private readonly base = 'https://selvbetjening.vestfor.dk';

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const data = await this.http.get(`${this.base}/Adresse/AddressByName`, {
      params: { term: `${street} ${houseNumber}`.trim(), numberOfResults: 100 },
    });
    this.addressList = {};
    for (const item of data) if (String(item.Postnr).includes(zipcode)) this.updateAddressList(item, 'FuldtVejnavn', 'Id');
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    // selects the address in the server-side session (cookie)
    await this.http.get(`${this.base}/Home/MinSide`, { params: { 'address-selected-id': addressId }, text: true });
    return this.http.get(`${this.base}/Adresse/ToemmeDates`, {
      params: { start: addDays(this.today, -1), end: addDays(this.today, 6 * 30) },
    });
  }

  parse(raw: any[]): RawPickup[] {
    return raw.map((item) => ({ date: parseDate(item.start), fraction: item.title }));
  }
}

/** Provas / WasteHero (Haderslev) */
export class ProvasAPI extends ProviderBase {
  private readonly urlBase = 'https://platform-api.wastehero.io/api-crm-portal/v1/';
  private token?: string;
  private readonly preHeaders = {
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'x-api-key',
    Referer: 'https://provas-portal.wastehero.io/',
    Origin: 'https://provas-portal.wastehero.io',
  };

  private async getToken(): Promise<string> {
    if (!this.token) {
      const data = await this.http.post(`${this.urlBase}company/provas-portal.wastehero.io/login`, { json: { username: '', password: '' } });
      this.token = data?.token;
    }
    return this.token ?? '';
  }

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const headers = { 'X-API-Key': await this.getToken() };
    const search = `${street} ${houseNumber}, ${zipcode}`.trim();
    const data = await this.http.get(`${this.urlBase}property/`, { params: { search, limit: 100 }, headers, preHeaders: this.preHeaders });
    this.addressList = {};
    for (const item of data) {
      item.name = item.location.name;
      if (String(item.name).includes(zipcode)) this.updateAddressList(item, 'name', 'id');
    }
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const headers = { 'X-API-Key': await this.getToken() };
    return this.http.get(`${this.urlBase}property/${addressId}/collection_log`, {
      params: { from_date: addDays(this.today, -1), to_date: addDays(this.today, 60) },
      headers,
      preHeaders: this.preHeaders,
    });
  }

  parse(raw: any[]): RawPickup[] {
    return raw.map((item) => ({ date: parseDate(item.date), fraction: item.container.waste_fraction.name }));
  }
}

/** RenoSyd (Odder, Skanderborg) - address via Adressevælger, then kvhx -> standplads */
export class RenoSydAPI extends ProviderBase {
  private readonly urlBase = 'https://skoda-selvbetjeningsapi.renosyd.dk/api/v1';

  getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    return this.getAvAddressList(zipcode, street, houseNumber);
  }

  async getAddress(addressName: string): Promise<[string | null, string | null]> {
    const id = this.addressList[addressName]?.id;
    if (!id) return [null, null];
    const [kvhx] = await this.getAvKvhx(id);
    const data = await this.http.get(`${this.urlBase}/adresser/${kvhx}/standpladser`);
    if (data?.length) return [String(data[0].nummer), addressName];
    return [null, null];
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const data = await this.http.get(`${this.urlBase}/toemmekalender`, { params: { nummer: addressId } });
    return data[0]['planlagtetømninger'];
  }

  parse(raw: any[]): RawPickup[] {
    return raw.map((item) => ({ date: parseDate(item.dato), fraction: [...item.fraktioner].sort().join(' ') }));
  }
}

/** Kredsløb (Aarhus) */
export class AarhusAffaldAPI extends ProviderBase {
  getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    return this.getAvAddressList(zipcode, street, houseNumber);
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const data = await this.http.get(`https://portal-api.kredslob.dk/api/calendar/address/${addressId}`);
    return data[0].plannedLoads;
  }

  parse(raw: any[]): RawPickup[] {
    const out: RawPickup[] = [];
    for (const row of raw) {
      const date = parseDate(row.date);
      for (const fraction of row.fractions ?? []) out.push({ date, fraction });
    }
    return out;
  }
}

/** Odense Renovation (iCal) */
export class OdenseAffaldAPI extends ProviderBase {
  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const address = `${street} ${houseNumber}`.trim();
    const data = await this.http.get(`https://mit.odenserenovation.dk/api/Calendar/CommunicationHouseNumbers?addressString=${pyQuote(address)}`);
    this.addressList = {};
    for (const item of data) if (String(item.PostCode).includes(zipcode)) this.updateAddressList(item, 'FullAddress', 'AddressNo');
    return Object.keys(this.addressList);
  }

  fetchRaw(addressId: string): Promise<string> {
    return this.http.get(`https://mit.odenserenovation.dk/api/Calendar/GetICalCalendar?addressNo=${addressId}`, { text: true });
  }

  parse(raw: string): RawPickup[] {
    const out: RawPickup[] = [];
    for (const ev of parseIcs(raw, this.ctx.tz)) {
      for (const fraction of splitIcalGarbageTypes(ev.summary)) out.push({ date: ev.date, fraction });
    }
    return out;
  }
}

/** Infovision (Kolding) */
export class InfovisionAPI extends ProviderBase {
  private readonly urlData = 'https://koldingivapi.infovision.dk/api/publiccitizen/';
  private readonly headers = {
    Accept: 'application/json, text/plain, */*',
    publicAccessToken: '__NetDialogCitizenPublicAccessToken__',
  };

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const roads = await this.http.get(`${this.urlData}road/roadName/${pyQuote(street)}`, { headers: this.headers });
    const road = (roads as any[]).find((r) => String(r.postalCode).includes(zipcode));
    this.addressList = {};
    if (!road) return [];
    const data = await this.http.get(`${this.urlData}address/info/road/${road.guid}`, { headers: this.headers });
    for (const item of data) if (String(item.addressString).includes(houseNumber)) this.updateAddressList(item, 'addressString', 'addressGuid');
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const js = await this.http.get(`${this.urlData}container/address/active/${addressId}`, { headers: this.headers });
    const containers: any[] = [];
    for (const section of ['chainDetailsOwn', 'chainDetailsZero', 'chainDetailsUse']) {
      for (const chain of js?.[section] ?? []) containers.push(...(chain.containerDetails ?? []));
    }
    return containers;
  }

  parse(raw: any[]): RawPickup[] {
    const out: RawPickup[] = [];
    for (const item of raw) {
      const dates = (item.collectCalendar ?? []).map((d: any) => parseDate(String(d.collectDate)));
      for (const date of upcoming(dates, this.today)) out.push({ date, fraction: item.containerType.fraction.description });
    }
    return out;
  }
}
