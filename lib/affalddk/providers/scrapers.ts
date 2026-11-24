/** Providers that scrape HTML (or a PDF): København, RenoDjurs, Herning, AffaldOnline web/PDF, Ikast-Brande, WasteWatch. */
import { DateStr, isoWeek, parseDate, weekdayWeekToDate, ymd, isValidDate } from '../dates';
import { AffaldDKNoConnection } from '../errors';
import { cheerio, childTags, htmlUnescape, pyQuoteCp1252, textRaw, textStrip } from '../parsers/html';
import { parseAffaldonlinePdf } from '../parsers/pdf';
import { ProviderBase, RawPickup, splitHousenumber } from './base';

const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0';

/**
 * "dd-mm, dd-mm, ..." -> nearest upcoming date (this year, or next year if
 * already passed). Port of get_next_upcoming_date.
 */
export function nextUpcomingDayMonth(dateStr: string, today: DateStr): DateStr | null {
  const year = Number(today.slice(0, 4));
  const candidates: DateStr[] = [];
  for (const part of dateStr.split(',')) {
    const m = part.trim().match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) continue;
    const thisYear = ymd(year, +m[2], +m[1]);
    if (!isValidDate(thisYear)) continue;
    if (thisYear >= today) candidates.push(thisYear);
    else {
      const next = ymd(year + 1, +m[2], +m[1]);
      if (isValidDate(next)) candidates.push(next);
    }
  }
  return candidates.length ? candidates.sort()[0] : null;
}

/** affald.kk.dk (København) */
export class AffaldKKAPI extends ProviderBase {
  private readonly urlSearch = 'https://datascience.kk.dk/affaldkbh/adresse/address';

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const data = await this.http.post(this.urlSearch, { form: { searchQuery: `${street} ${houseNumber}` } });
    this.addressList = {};
    for (const item of data.addresses ?? []) {
      if (item.postalCode === null || String(item.postalCode).includes(zipcode)) this.updateAddressList(item, 'searchQuery', 'searchQuery');
    }
    return Object.keys(this.addressList);
  }

  async getAddress(addressName: string): Promise<[string | null, string | null]> {
    const data = await this.http.post(this.urlSearch, { form: { searchQuery: `${addressName} ` } });
    const item = data.addresses?.[0];
    if (!item) return [null, null];
    return [String(item.id), String(item.searchQuery).trim()];
  }

  async fetchRaw(addressId: string): Promise<Array<{ date: string; fraction: string }>> {
    const htm = await this.http.get<string>('https://affald.kk.dk/din-kalender', { params: { address_id: addressId }, text: true });
    return AffaldKKAPI.scrape(htm);
  }

  static scrape(htm: string): Array<{ date: string; fraction: string }> {
    const $ = cheerio.load(htm);
    const out: Array<{ date: string; fraction: string }> = [];
    $('div.calendar-waste-date').each((_i, dateDiv) => {
      const dateEl = $(dateDiv).find('div.date').get(0);
      const lines = textRaw(dateEl).split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      const dateStr = (lines[0].split(',')[1] ?? '').trim().toLowerCase();
      for (const fraction of lines.slice(1)) out.push({ date: dateStr, fraction });
    });
    return out;
  }

  parse(raw: Array<{ date: string; fraction: string }>): RawPickup[] {
    return raw.map((r) => ({ date: parseDate(r.date, true), fraction: r.fraction }));
  }
}

/** Reno Djurs (Norddjurs, Syddjurs) */
export class RenoDjursAPI extends ProviderBase {
  private readonly urlBase = 'https://minside.renodjurs.dk';

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const address = `${street} ${houseNumber}*, ${zipcode}`.trim();
    const data = await this.http.post(`${this.urlBase}/Default.aspx/GetAddress`, { json: { address } });
    this.addressList = {};
    for (const item of data.d ?? []) if (String(item.label).includes(zipcode)) this.updateAddressList(item, 'label', 'value');
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<Array<Record<string, string>>> {
    const html = await this.http.get<string>(`${this.urlBase}/Ordninger.aspx?id=${addressId}`, { text: true });
    const $ = cheerio.load(html);
    const table = $('table.table--compact').first();
    if (!table.length) throw new AffaldDKNoConnection('RenoDjurs: no pickup table in response');
    const headers = table.find('thead').first().find('th').toArray().map((th) => textStrip(th));
    const rows: Array<Record<string, string>> = [];
    table.find('tbody').first().find('tr').each((_i, tr) => {
      const tds = $(tr).find('td').toArray();
      if (tds.length !== headers.length) return;
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = textStrip(tds[i]); });
      if (row['Næste tømningsdag']) rows.push(row);
    });
    return rows;
  }

  parse(raw: Array<Record<string, string>>): RawPickup[] {
    return raw.map((item) => ({ date: parseDate(item['Næste tømningsdag'], true), fraction: item.Ordning }));
  }
}

/** affaldsweb.net (Herning) - weekday + week numbers */
export class AffaldWebAPI extends ProviderBase {
  async getAddressList(_zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const letters = pyQuoteCp1252(`${street} ${houseNumber}`.trim());
    const data = await this.http.post<string>(
      `https://affaldsweb.net/dagrenovation/find_veje.php?getCountriesByLetters=1&letters=${letters}`,
      { headers: { 'User-Agent': FIREFOX_UA }, text: true },
    );
    this.addressList = {};
    for (const line of data.split('|')) {
      if (!line) continue;
      const [id, name] = line.split('###');
      if (name !== undefined) this.updateAddressList({ name, id }, 'name', 'id');
    }
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<Array<{ fraction: string; day: string; weeks: Array<[number, number]> }>> {
    const html = await this.http.get<string>('https://affaldsweb.net/affaldweb/ruter.php', {
      params: { ejdnr: addressId },
      headers: { 'User-Agent': FIREFOX_UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      text: true,
    });
    const $ = cheerio.load(html);
    const out: Array<{ fraction: string; day: string; weeks: Array<[number, number]> }> = [];
    $('div.route-card').each((_i, card) => {
      const fraction = textStrip($(card).find('div.route-title').get(0));
      const day = textStrip($(card).find('div.day-name').get(0));
      const dayBox = $(card).find('div.day-box').get(0);
      const weekInfo = textStrip(childTags(dayBox, 'div')[1]);
      out.push({ fraction, day, weeks: this.getWeeks(weekInfo) });
    });
    return out;
  }

  getWeeks(rest: string): Array<[number, number]> {
    const weeks: Array<[number, number]> = [];
    if (rest.includes('Ugenumre:')) {
      const thisWeek = isoWeek(this.today).week;
      for (const w of rest.split('Ugenumre:')[1].split(',')) {
        const n = parseInt(w, 10);
        if (Number.isNaN(n)) continue;
        weeks.push([n, n < thisWeek ? this.year + 1 : this.year]);
      }
    } else if (rest.toLowerCase().includes('ulige')) {
      weeks.push([-1, this.year]);
    } else {
      weeks.push([-2, this.year]);
    }
    return weeks;
  }

  parse(raw: Array<{ fraction: string; day: string; weeks: Array<[number, number]> }>): RawPickup[] {
    const out: RawPickup[] = [];
    for (const item of raw) {
      for (const [w, y] of item.weeks) {
        const date = weekdayWeekToDate(item.day, w, y, this.today);
        if (!date) throw new Error(`Failed to convert date for Herning, "${JSON.stringify(item)}"`);
        out.push({ date, fraction: item.fraction });
      }
    }
    return out;
  }
}

type MaterielRow = { Materiel: string; 'Tømningsdag': DateStr | null };

/** affaldonline.dk/kalender web calendar (Silkeborg) */
export class AffaldOnlineWeb extends ProviderBase {
  protected get urlBase(): string { return `https://www.affaldonline.dk/kalender/${this.municipalityId}`; }

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    this.addressList = {};
    const acUrl = `${this.urlBase}/acCal.php`;
    let addresses = JSON.parse(await this.http.get<string>(acUrl, { params: { term: street.trim() }, text: true }) || '[]');

    if (addresses?.length && 'values' in addresses[0]) {
      // Newer installs: full address entries; "values" (pipe separated) is the id posted to showInfo.php.
      // Layout: vejnavn|husnr|bogstav|etage|sidedør|postnr|postdist|...
      if (houseNumber) {
        const narrow = JSON.parse(await this.http.get<string>(acUrl, { params: { term: `${street} ${houseNumber}`.trim() }, text: true }) || '[]');
        if (narrow?.length) addresses = narrow;
      }
      for (const address of addresses) {
        const parts = String(address.values ?? '').split('|');
        if (parts.length < 7 || !String(parts[5]).includes(zipcode)) continue;
        const number = `${parts[1]} ${parts[2]}`.trim();
        if (houseNumber && !number.includes(houseNumber)) continue;
        this.updateAddressList({ name: address.value, id: address.values }, 'name', 'id');
      }
      return Object.keys(this.addressList);
    }

    // Older installs list streets only, then house numbers via husnrCal.php.
    for (const streetItem of addresses ?? []) {
      if (!String(streetItem.postnr).includes(zipcode)) continue;
      const html = await this.http.get<string>(`${this.urlBase}/husnrCal.php`, {
        params: { vejnavn: streetItem.vejnavn, postnr: streetItem.postnr }, text: true,
      });
      const $ = cheerio.load(html);
      $('select#SelHusNr option').each((_i, opt) => {
        const number = $(opt).text().trim();
        if (number.includes(houseNumber)) {
          this.updateAddressList({
            name: `${streetItem.vejnavn} ${number}, ${streetItem.postnr} ${streetItem.Bynavn}`,
            id: $(opt).attr('value'),
          }, 'name', 'id');
        }
      });
    }
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<MaterielRow[]> {
    const html = await this.http.post<string>(`${this.urlBase}/showInfo.php`, { form: { values: addressId }, text: true });
    const $ = cheerio.load(html);
    const table = $('table').get(0);
    if (!table) throw new AffaldDKNoConnection('AffaldOnline: no table in showInfo.php response');
    const results: MaterielRow[] = [];
    // The fraction cell contains a nested table; only the outer table's direct rows carry date/fraction.
    const rows = [...childTags(table, 'tr'), ...childTags(childTags(table, 'tbody')[0], 'tr')];
    for (const row of rows) {
      const cols = childTags(row, 'td');
      if (cols.length !== 2) continue;
      const date = textStrip(cols[0]);
      for (const desc of textStrip(cols[1]).split(', ')) {
        results.push({ Materiel: desc.trim(), 'Tømningsdag': nextUpcomingDayMonth(date, this.today) });
      }
    }
    return results;
  }

  parse(raw: MaterielRow[]): RawPickup[] {
    return raw.filter((r) => r['Tømningsdag']).map((r) => ({ date: r['Tømningsdag'], fraction: r.Materiel }));
  }
}

/**
 * affaldonline.dk calendar where the only data source is a yearly PDF
 * (Fanø, Middelfart, Nyborg, Sorø). Parsed years are cached for 7 days.
 */
export class AffaldOnlinePdfAPI extends AffaldOnlineWeb {
  static readonly PDF_REFRESH_DAYS = 7;
  private pdfCache = new Map<string, { fetched: DateStr; calendar: Map<DateStr, Set<string>> }>();
  warn: (msg: string) => void = () => {};

  private async getPdfCalendar(addressId: string, year: number): Promise<Map<DateStr, Set<string>>> {
    const html = await this.http.post<string>(`${this.urlBase}/showInfo.php`, { form: { values: addressId }, text: true });
    const m = html.match(/showToemCal\.php\?([^'"]+)/);
    if (!m) throw new AffaldDKNoConnection('No calendar link in showInfo.php response');
    // The link is HTML-escaped (&amp;forbid=...); unescape before splitting the query.
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(htmlUnescape(m[1]))) params[k] = v;
    params.year = String(year);
    let pdf: Buffer;
    try {
      pdf = await this.http.get<Buffer>(`${this.urlBase}/showToemCal.php`, { params, binary: true });
    } catch {
      return new Map(); // next year's calendar is published late in the year
    }
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) return new Map();
    return parseAffaldonlinePdf(pdf, year, this.warn);
  }

  async fetchRaw(addressId: string): Promise<MaterielRow[]> {
    const today = this.today;
    const results: MaterielRow[] = [];
    for (const year of [this.year, this.year + 1]) {
      const key = `${addressId}|${year}`;
      let cached = this.pdfCache.get(key);
      if (!cached || daysBetween(cached.fetched, today) >= AffaldOnlinePdfAPI.PDF_REFRESH_DAYS) {
        cached = { fetched: today, calendar: await this.getPdfCalendar(addressId, year) };
        this.pdfCache.set(key, cached);
      }
      for (const [date, fractions] of cached.calendar) {
        for (const fraction of fractions) results.push({ Materiel: fraction, 'Tømningsdag': date });
      }
    }
    return results;
  }
}

function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** skrald.ikast-brande.dk */
export class IkastBrandeAPI extends ProviderBase {
  private readonly urlBase = 'https://skrald.ikast-brande.dk/Adresse';

  async getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    const data = await this.http.post(`${this.urlBase}/Typeahead`, { json: { query: `${street} ${houseNumber}`.trim(), limit: 30000 } });
    this.addressList = {};
    for (const item of data) if (String(item.Beliggenhed).includes(zipcode)) this.updateAddressList(item, 'Beliggenhed', 'AdresseId');
    return Object.keys(this.addressList);
  }

  async fetchRaw(addressId: string): Promise<MaterielRow[]> {
    const html = await this.http.post<string>(`${this.urlBase}/SubmitAdresse`, {
      json: { hiddenPrevController: 'Tomningsinfo', hiddenPrevAction: 'Index', hiddenSiteType: 'R', hiddenId: addressId },
      text: true,
    });
    const $ = cheerio.load(html);
    const table = $('table').first();
    const headers = table.find('tr').first().children('th, td').toArray().map((c) => textStrip(c));
    if (headers[3] !== 'Kommende tømninger') throw new AffaldDKNoConnection('Ikast-Brande: unexpected page layout');
    const data: MaterielRow[] = [];
    table.find('tr').each((_i, row) => {
      const cells = $(row).find('td').toArray();
      if (!cells.length) return;
      const rowData = cells.map((c) => textStrip(c, ' '));
      if (rowData[3]) data.push({ Materiel: rowData[0], 'Tømningsdag': nextUpcomingDayMonth(rowData[3], this.today) });
    });
    return data;
  }

  parse(raw: MaterielRow[]): RawPickup[] {
    return raw.filter((r) => r['Tømningsdag']).map((r) => ({ date: r['Tømningsdag'], fraction: r.Materiel }));
  }
}

/** WasteWatch / forsyningonline (Tønder Forsyning) */
export class WasteWatchAPI extends ProviderBase {
  private static readonly WASTE_IDS: Record<string, string> = { 550: 'tonfor' };

  private get providerId(): string {
    const id = WasteWatchAPI.WASTE_IDS[String(this.municipalityId)];
    if (!id) throw new AffaldDKNoConnection(`WasteWatch: unknown municipality ${this.municipalityId}`);
    return id;
  }

  getAddressList(zipcode: string, street: string, houseNumber: string): Promise<string[]> {
    return this.getAvAddressList(zipcode, street, houseNumber);
  }

  private async getTonforUrl(road: string, number: number, letter: string, zipcode: string): Promise<string | undefined> {
    const html = await this.http.get<string>('https://www.tonfor.dk/affald/toemmedatoer/dine-toemmedatoer', {
      params: { postnr: zipcode, vejnavn: road, husnummer: number, bogstav: letter, Lavopslag: 'Lav opslag' }, text: true,
    });
    const $ = cheerio.load(html);
    let seenH2 = false;
    let href: string | undefined;
    $('h2, a[href]').each((_i, el) => {
      if (href) return;
      if ((el as any).name === 'h2') seenH2 = true;
      else if (seenH2) href = $(el).attr('href');
    });
    return href;
  }

  async fetchRaw(addressId: string): Promise<any[]> {
    const item = await this.getItem(addressId);
    const [number, letter] = splitHousenumber(item.husnr ?? '');
    const road = item.vejnavn ?? '';
    const zipcode = item.postnr ?? '';
    let url = `https://wastewatch.forsyningonline.dk/prod/${this.providerId}?$filter=roadName eq '${road}' and houseNumber eq ${number} and postCode eq '${zipcode}'`;
    if (letter) url += ` and Letter eq '${letter}'`;
    let data = await this.http.get(url);
    if (!(data?.wastewatch ?? []).length && this.providerId === 'tonfor') {
      // tonfor.dk has trouble with lettered addresses; look the feed URL up on their site
      const url2 = await this.getTonforUrl(road, number, '', zipcode);
      if (url2 && url2 !== url) data = await this.http.get(url2);
    }
    return data?.wastewatch ?? [];
  }

  parse(raw: any[]): RawPickup[] {
    return raw.map((item) => ({ date: parseDate(item.dato), fraction: item.container }));
  }
}
