import { DateStr, DEFAULT_TZ, today as tzToday } from './dates';
import { AffaldDKNotSupportedError, AffaldDKNotValidAddressError } from './errors';
import { compareAddresses, getGarbageTypes, MISSING_TYPE, NOT_SUPPORTED } from './fractions';
import { HttpClient } from './http';
import { resolveMunicipality } from './municipalities';
import { ProviderBase, ProviderContext, RawPickup } from './providers/base';
import { PROVIDERS } from './providers';

/** A normalised pickup: one fraction key on one date. */
export interface PickupEvent {
  date: DateStr;
  key: string;
  /** Raw provider text, e.g. "Restaffald 240 l" */
  description: string;
  containerCount?: number;
}

export interface AddressInfo {
  uid: string;
  addressId: string;
  municipality: string;
  address: string;
}

export interface CollectionOptions {
  http?: HttpClient;
  tz?: string;
  /** Override "today" (tests) */
  today?: () => DateStr;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Orchestrates one municipality's provider. Port of pyaffalddk.api.GarbageCollection. */
export class GarbageCollection {
  readonly municipality: string;
  readonly apiType: string;
  readonly api: ProviderBase;
  private readonly ctx: ProviderContext;

  constructor(municipality: string, opts: CollectionOptions = {}) {
    const resolved = resolveMunicipality(municipality);
    if (!resolved) throw new AffaldDKNotSupportedError(`Unknown municipality: "${municipality}"`);
    const Provider = PROVIDERS[resolved.apiType];
    if (!Provider) throw new AffaldDKNotSupportedError(`Provider "${resolved.apiType}" not implemented`);
    const tz = opts.tz ?? DEFAULT_TZ;
    this.ctx = { http: opts.http ?? new HttpClient(), tz, today: opts.today ?? (() => tzToday(new Date(), tz)) };
    this.municipality = resolved.name;
    this.apiType = resolved.apiType;
    this.api = new Provider(resolved.id, this.ctx);
  }

  async init(): Promise<void> {
    await this.api.init();
  }

  async getAddressList(zipcode: string, street: string, houseNumber = ''): Promise<string[]> {
    const list = await this.api.getAddressList(zipcode.trim(), street.trim(), houseNumber.trim());
    return [...list].sort(compareAddresses);
  }

  async getAddress(addressName: string): Promise<AddressInfo> {
    const [id, address] = await this.api.getAddress(addressName);
    if (id === null || address === null) throw new AffaldDKNotValidAddressError('Address not found');
    const municipality = capitalize(this.municipality);
    return { uid: `${municipality}_${id}`, addressId: id, municipality, address };
  }

  async initAddress(addressId: string): Promise<void> {
    await this.api.initAddress(addressId);
  }

  /**
   * Fetch and normalise all pickups from today onwards, sorted by date.
   * Unknown fraction names are reported through setMissingTypeLogger and skipped.
   */
  async getPickupEvents(addressId: string): Promise<PickupEvent[]> {
    return this.normalize(await this.api.getPickups(addressId), addressId);
  }

  normalize(raw: RawPickup[], addressId = ''): PickupEvent[] {
    const today = this.ctx.today();
    const seen = new Set<string>();
    const out: PickupEvent[] = [];
    for (const item of raw) {
      if (!item.date || item.date < today || !item.fraction) continue;
      const keys = getGarbageTypes(item.fraction, this.municipality, addressId);
      if (keys[0] === NOT_SUPPORTED || keys[0] === MISSING_TYPE) continue;
      for (const key of keys) {
        const id = `${item.date}|${key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ date: item.date, key, description: item.fraction, containerCount: item.containerCount });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key.localeCompare(b.key)));
  }
}
