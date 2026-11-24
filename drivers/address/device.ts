import Homey from 'homey';
import {
  AffaldDKNoConnection, AffaldDKNotSupportedError, AffaldDKNotValidAddressError,
  DateStr, fractionSummaries, FractionSummary, GarbageCollection, localParts, nextPickup, NextPickup,
  PickupEvent, upcomingByDate,
} from '../../lib/affalddk';
import { daysText, fractionName, fractionTitle, Lang, longDate, shortDate, toLang } from '../../lib/names';

const HOUR = 60 * 60 * 1000;
/** Retry delays after a failed fetch */
const RETRY_MS = [5 * 60_000, 15 * 60_000, HOUR, 3 * HOUR];
/** Daily refetch window starts at this local hour (plus a per-device jitter) */
const FETCH_HOUR = 3;

export interface DeviceStore {
  municipality: string;
  addressId: string;
  address: string;
}

export interface PickupDay {
  date: DateStr;
  daysUntil: number;
  keys: string[];
}

class AddressDevice extends Homey.Device {
  private gc!: GarbageCollection;
  private events: PickupEvent[] = [];
  private fetching?: Promise<void>;
  private failures = 0;
  private retryTimer?: NodeJS.Timeout;
  private lastNextSignature?: string;

  async onInit(): Promise<void> {
    const store = this.getStore() as DeviceStore;
    this.gc = new GarbageCollection(store.municipality, { tz: this.tz });
    this.events = (this.getStoreValue('events') as PickupEvent[] | null) ?? [];
    this.lastNextSignature = this.getStoreValue('nextSignature') ?? undefined;

    await this.ensureBaseCapabilities();
    if (this.events.length) await this.updateCapabilities(false);

    // Hourly tick shortly after the hour: day rollover, switch hour, daily refetch.
    const msToNextHour = HOUR - (Date.now() % HOUR) + 30_000;
    this.homey.setTimeout(() => {
      this.tick().catch(this.error);
      this.homey.setInterval(() => this.tick().catch(this.error), HOUR);
    }, msToNextHour);

    // Initial fetch (spread out over the first minute when Homey boots with many devices)
    this.homey.setTimeout(() => this.refresh().catch(() => {}), 2_000 + Math.random() * 30_000);
  }

  get tz(): string {
    return this.homey.clock.getTimezone() || 'Europe/Copenhagen';
  }

  get lang(): Lang {
    return toLang(this.homey.i18n.getLanguage());
  }

  private now() {
    return localParts(new Date(), this.tz);
  }

  /** Fraction keys this address has had pickups for (capabilities are kept for these). */
  get knownKeys(): string[] {
    return (this.getStoreValue('knownKeys') as string[] | null) ?? [];
  }

  getEvents(): PickupEvent[] {
    return this.events;
  }

  summaries(): FractionSummary[] {
    return fractionSummaries(this.events, this.now().date);
  }

  next(): NextPickup | null {
    const { date, hour, minute } = this.now();
    return nextPickup(this.events, {
      today: date, hour, minute,
      switchHour: Number(this.getSetting('switch_hour') ?? 15),
      dynamicIcon: !!this.getSetting('dynamic_icon'),
    });
  }

  upcoming(limit = 10): PickupDay[] {
    return upcomingByDate(this.events, this.now().date, limit)
      .map((d) => ({ date: d.date, daysUntil: d.daysUntil, keys: [...new Set(d.events.map((e) => e.key))].sort() }));
  }

  /** Fetch from the provider (deduplicated if already running). */
  refresh(): Promise<void> {
    if (!this.fetching) {
      this.fetching = this.doRefresh().finally(() => { this.fetching = undefined; });
    }
    return this.fetching;
  }

  private async doRefresh(): Promise<void> {
    const store = this.getStore() as DeviceStore;
    try {
      const events = await this.gc.getPickupEvents(store.addressId);
      if (!events.length) throw new AffaldDKNoConnection('No pickups returned');
      this.events = events;
      this.failures = 0;
      if (this.retryTimer) this.homey.clearTimeout(this.retryTimer);
      await this.setStoreValue('events', events);
      await this.setStoreValue('lastFetch', this.now().date);
      await this.setStoreValue('lastFetchAt', new Date().toISOString());
      await this.setAvailable();
      await this.updateCapabilities(true);
      this.log(`Fetched ${events.length} pickups for ${store.address}`);
    } catch (err) {
      this.failures++;
      this.error(`Fetch failed (${this.failures}) for ${store.address}:`, (err as Error).message);
      const delay = RETRY_MS[Math.min(this.failures - 1, RETRY_MS.length - 1)];
      this.retryTimer = this.homey.setTimeout(() => this.refresh().catch(() => {}), delay);
      // Keep serving cached data; only go unavailable when there is nothing upcoming left.
      const hasUpcoming = this.events.some((e) => e.date >= this.now().date);
      if (!hasUpcoming) await this.setUnavailable(this.errorMessage(err as Error)).catch(this.error);
      throw err;
    }
  }

  private errorMessage(err: Error): string {
    if (err instanceof AffaldDKNotSupportedError) return this.homey.__('errors.not_supported');
    if (err instanceof AffaldDKNotValidAddressError) return this.homey.__('errors.address_not_found');
    if (err instanceof AffaldDKNoConnection) return this.homey.__('errors.no_connection');
    return this.homey.__('errors.unknown', { message: err.message });
  }

  private async tick(): Promise<void> {
    const { date, hour } = this.now();
    const jitterHour = FETCH_HOUR + (parseInt(this.getData().id.replace(/\D/g, '').slice(-2) || '0', 10) % 3);
    if (this.getStoreValue('lastFetch') !== date && hour >= jitterHour) {
      await this.refresh().catch(() => {});
    } else {
      await this.updateCapabilities(true);
    }
  }

  private async ensureBaseCapabilities(): Promise<void> {
    for (const cap of ['days_until.next_pickup', 'next_pickup_type', 'next_pickup_date']) {
      if (!this.hasCapability(cap)) await this.addCapability(cap);
    }
    await this.setCapabilityOptions('days_until.next_pickup', {
      title: { en: fractionName('next_pickup', 'en'), da: fractionName('next_pickup', 'da') },
    }).catch(this.error);
  }

  /** Push current values to capabilities; add sub-capabilities for new fractions. */
  async updateCapabilities(fireTriggers: boolean): Promise<void> {
    const summaries = this.summaries();
    const known = new Set(this.knownKeys);
    let changed = false;
    for (const s of summaries) {
      if (!known.has(s.key)) { known.add(s.key); changed = true; }
    }
    if (changed) await this.setStoreValue('knownKeys', [...known]);

    for (const key of [...known].sort()) {
      const cap = `days_until.${key}`;
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap);
        await this.setCapabilityOptions(cap, { title: fractionTitle(key) }).catch(this.error);
      }
      const s = summaries.find((x) => x.key === key);
      await this.setCapabilityValue(cap, s ? s.daysUntil : null).catch(this.error);
    }

    const next = this.next();
    const lang = this.lang;
    await this.setCapabilityValue('days_until.next_pickup', next ? next.daysUntil : null).catch(this.error);
    await this.setCapabilityValue('next_pickup_type', next ? next.keys.map((k) => fractionName(k, lang)).join(', ') : null).catch(this.error);
    await this.setCapabilityValue('next_pickup_date', next ? `${shortDate(next.date, lang)} (${daysText(next.daysUntil, lang).toLowerCase()})` : null).catch(this.error);

    const signature = next ? `${next.date}|${next.keys.join(',')}` : '';
    if (signature !== this.lastNextSignature) {
      this.lastNextSignature = signature;
      await this.setStoreValue('nextSignature', signature);
      if (fireTriggers && next) {
        await this.homey.flow.getDeviceTriggerCard('next_pickup_changed')
          .trigger(this, this.nextTokens(next))
          .catch(this.error);
      }
    }
    this.homey.api.realtime('pickups-updated', { deviceId: this.getId() });
  }

  nextTokens(next: NextPickup | PickupDay): Record<string, string | number> {
    const lang = this.lang;
    return {
      fractions: next.keys.map((k) => fractionName(k, lang)).join(', '),
      date: longDate(next.date, lang),
      days: next.daysUntil,
      description: this.events.filter((e) => e.date === next.date).map((e) => e.description).join(' | '),
    };
  }

  async onSettings(): Promise<void> {
    // values depend on switch hour / icon setting; recompute after the settings are saved
    this.homey.setTimeout(() => this.updateCapabilities(false).catch(this.error), 500);
  }

  async onDeleted(): Promise<void> {
    if (this.retryTimer) this.homey.clearTimeout(this.retryTimer);
  }
}

export type { AddressDevice };
module.exports = AddressDevice;
