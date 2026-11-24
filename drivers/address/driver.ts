import Homey from 'homey';
import {
  AffaldDKNoConnection, AffaldDKNotSupportedError, AffaldDKNotValidAddressError,
  GarbageCollection, localParts, MUNICIPALITY_NAMES, resolveMunicipality,
} from '../../lib/affalddk';
import { fractionName, toLang } from '../../lib/names';
import type { AddressDevice, PickupDay } from './device';

interface SearchInput { municipality: string; zipcode: string; street: string; houseNumber?: string }

const ANY = 'any';

class AddressDriver extends Homey.Driver {
  private lastReminderMinute = '';

  async onInit(): Promise<void> {
    this.registerFlowCards();
    // Minute tick for the time-based reminder trigger
    const msToNextMinute = 60_000 - (Date.now() % 60_000) + 1_000;
    this.homey.setTimeout(() => {
      this.reminderTick().catch(this.error);
      this.homey.setInterval(() => this.reminderTick().catch(this.error), 60_000);
    }, msToNextMinute);
  }

  private get devicesTyped(): AddressDevice[] {
    return this.getDevices() as unknown as AddressDevice[];
  }

  // ---------------------------------------------------------------- pairing

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let gc: GarbageCollection | undefined;

    session.setHandler('init', async () => ({
      municipalities: MUNICIPALITY_NAMES,
      suggested: await this.guessMunicipality().catch(() => null),
    }));

    session.setHandler('search', async (input: SearchInput) => {
      if (!resolveMunicipality(input.municipality)) throw new Error(this.homey.__('pair.unknown_municipality'));
      if (!input.zipcode?.trim() || !input.street?.trim()) throw new Error(this.homey.__('pair.missing_fields'));
      try {
        gc = new GarbageCollection(input.municipality, { tz: this.homey.clock.getTimezone() });
        await gc.init();
        const list = await gc.getAddressList(input.zipcode, input.street, input.houseNumber ?? '');
        if (!list.length) throw new AffaldDKNotValidAddressError();
        return list;
      } catch (err) {
        throw new Error(this.pairError(err as Error));
      }
    });

    session.setHandler('select', async (address: string) => {
      if (!gc) throw new Error(this.homey.__('pair.search_first'));
      try {
        const info = await gc.getAddress(address);
        if (this.devicesTyped.some((d) => d.getData().id === info.uid)) throw new Error(this.homey.__('pair.already_added'));
        await gc.initAddress(info.addressId);
        const events = await gc.getPickupEvents(info.addressId);
        if (!events.length) throw new Error(this.homey.__('pair.no_pickups'));
        return {
          name: info.address,
          data: { id: info.uid },
          store: { municipality: info.municipality, addressId: info.addressId, address: info.address, events },
          settings: { municipality_label: info.municipality, address_label: info.address },
          preview: events.slice(0, 6).map((e) => ({ date: e.date, name: fractionName(e.key, toLang(this.homey.i18n.getLanguage())) })),
        };
      } catch (err) {
        throw new Error(this.pairError(err as Error));
      }
    });
  }

  private pairError(err: Error): string {
    if (err instanceof AffaldDKNotSupportedError) return this.homey.__('errors.not_supported');
    if (err instanceof AffaldDKNotValidAddressError) return this.homey.__('errors.address_not_found');
    if (err instanceof AffaldDKNoConnection) return this.homey.__('errors.no_connection');
    return err.message;
  }

  /** Municipality from Homey's location (same lookup as upstream's config flow). */
  private async guessMunicipality(): Promise<string | null> {
    const lat = this.homey.geolocation.getLatitude();
    const lon = this.homey.geolocation.getLongitude();
    if (!lat || !lon) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    try {
      const res = await fetch(`https://dawa.companydata.dk/kommuner/reverse?x=${lon}&y=${lat}`, { signal: ctrl.signal });
      if (!res.ok) return null;
      const js = await res.json() as { navn?: string };
      const name = js.navn ? js.navn.charAt(0).toUpperCase() + js.navn.slice(1).toLowerCase() : '';
      return resolveMunicipality(name)?.name ?? null;
    } finally {
      clearTimeout(t);
    }
  }

  // ---------------------------------------------------------------- flow cards

  private registerFlowCards(): void {
    const fractionAutocomplete = async (query: string, args: { device?: AddressDevice }) => {
      const lang = toLang(this.homey.i18n.getLanguage());
      const keys = args.device ? args.device.knownKeys : [];
      const items = [
        { id: ANY, name: this.homey.__('flow.any_fraction') },
        ...keys.map((k) => ({ id: k, name: fractionName(k, lang) })).sort((a, b) => a.name.localeCompare(b.name, lang)),
      ];
      const q = query.trim().toLowerCase();
      return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    };

    const matches = (fractionArg: { id: string } | undefined, keys: string[]) => !fractionArg || fractionArg.id === ANY || keys.includes(fractionArg.id);

    const reminder = this.homey.flow.getDeviceTriggerCard('pickup_reminder');
    reminder.registerArgumentAutocompleteListener('fraction', fractionAutocomplete);
    reminder.registerRunListener(async (args, state: { time: string; daysUntil: number; keys: string[] }) => args.time === state.time
      && Number(args.days) === state.daysUntil
      && matches(args.fraction, state.keys));

    const collectedIn = this.homey.flow.getConditionCard('collected_in_days');
    collectedIn.registerArgumentAutocompleteListener('fraction', fractionAutocomplete);
    collectedIn.registerRunListener(async (args: { device: AddressDevice; fraction: { id: string }; days: number }) => {
      return args.device.upcoming(60).some((d) => d.daysUntil === Number(args.days) && matches(args.fraction, d.keys));
    });

    const collectedWithin = this.homey.flow.getConditionCard('collected_within_days');
    collectedWithin.registerArgumentAutocompleteListener('fraction', fractionAutocomplete);
    collectedWithin.registerRunListener(async (args: { device: AddressDevice; fraction: { id: string }; days: number }) => {
      return args.device.upcoming(60).some((d) => d.daysUntil <= Number(args.days) && matches(args.fraction, d.keys));
    });

    this.homey.flow.getActionCard('refresh').registerRunListener(async (args: { device: AddressDevice }) => {
      await args.device.refresh();
    });
  }

  /** Fire "pickup_reminder" when the current local time matches a time used in any flow. */
  private async reminderTick(): Promise<void> {
    const { hour, minute } = localParts(new Date(), this.homey.clock.getTimezone());
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (time === this.lastReminderMinute) return;
    this.lastReminderMinute = time;

    const card = this.homey.flow.getDeviceTriggerCard('pickup_reminder');
    for (const device of this.devicesTyped) {
      const argValues = await card.getArgumentValues(device as unknown as Homey.Device).catch(() => []);
      if (!argValues.some((a) => a.time === time)) continue;
      const days: PickupDay[] = device.upcoming(31);
      for (const day of days) {
        await card.trigger(device as unknown as Homey.Device, device.nextTokens(day), { time, daysUntil: day.daysUntil, keys: day.keys })
          .catch(this.error);
      }
    }
  }
}

module.exports = AddressDriver;
