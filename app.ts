import Homey from 'homey';
import { addDays, diffDays, localParts, setMissingTypeLogger, weekday } from './lib/affalddk';
import { widgetIconPath } from './lib/icons';
import {
  daysText, fractionName, longDate, monthName, toLang, weekdayLetters,
} from './lib/names';
import type { AddressDevice } from './drivers/address/device';

export interface WidgetPickup {
  date: string;
  daysUntil: number;
  when: string;
  dateLong: string;
  fractions: Array<{ key: string; name: string; icon: string }>;
}

export interface WidgetData {
  status: 'ok' | 'no_device' | 'no_pickups' | 'unavailable';
  message?: string;
  name?: string;
  pickups: WidgetPickup[];
}

export interface OverviewType {
  key: string;
  name: string;
  icon: string;
  /** null when the type has no upcoming pickup in the data */
  daysUntil: number | null;
  /** "I dag", "1 d", "5 d", or "–" */
  when: string;
  /** "Glas: søndag d. 29. november" */
  label: string;
}

export interface OverviewData {
  status: 'ok' | 'no_device' | 'no_pickups' | 'unavailable';
  message?: string;
  name?: string;
  types: OverviewType[];
}

export interface CalendarDay {
  date: string;
  day: number;
  /** "dec." on the first day of a month (and the first cell), else '' */
  month: string;
  today: boolean;
  past: boolean;
  label: string;
  fractions: Array<{ key: string; name: string; icon: string }>;
}

export interface CalendarData {
  status: 'ok' | 'no_device' | 'unavailable';
  message?: string;
  name?: string;
  title?: string;
  weekdays?: string[];
  days?: CalendarDay[];
  legend?: Array<{ key: string; name: string; icon: string }>;
}

class AffaldApp extends Homey.App {
  async onInit(): Promise<void> {
    setMissingTypeLogger((msg) => this.log(`[unknown waste type] ${msg}`));

    for (const id of ['upcoming', 'calendar', 'overview']) {
      this.homey.dashboards.getWidget(id).registerSettingAutocompleteListener('device', async (query: string) => {
        const q = query.trim().toLowerCase();
        return this.addressDevices()
          .map((d) => ({ id: d.getId(), name: d.getName(), description: d.getStoreValue('municipality') as string }))
          .filter((d) => !q || d.name.toLowerCase().includes(q));
      });
    }

    // The overview's waste type slots: the chosen address's types, and "none" to empty a slot
    const overview = this.homey.dashboards.getWidget('overview');
    const typeAutocomplete = async (query: string, settings: Record<string, any>) => {
      const lang = toLang(this.homey.i18n.getLanguage());
      const device = this.widgetDevice(settings?.device?.id);
      const keys = device ? this.overviewKeys(device) : [];
      const q = query.trim().toLowerCase();
      const items = keys.map((k) => ({ id: k, name: fractionName(k, lang) }))
        .sort((a, b) => a.name.localeCompare(b.name, lang))
        .filter((i) => !q || i.name.toLowerCase().includes(q));
      return [{ id: '', name: this.homey.__('widget.no_type') }, ...items];
    };
    for (let i = 1; i <= 8; i++) overview.registerSettingAutocompleteListener(`type${i}`, typeAutocomplete);

    this.log('Affald DK started');
  }

  addressDevices(): AddressDevice[] {
    return this.homey.drivers.getDriver('address').getDevices() as unknown as AddressDevice[];
  }

  /** The widget's device, or the only one when none is chosen yet. */
  private widgetDevice(deviceId: string | undefined): AddressDevice | undefined {
    const devices = this.addressDevices();
    return devices.find((d) => d.getId() === deviceId) ?? (devices.length === 1 ? devices[0] : undefined);
  }

  /** Data for the Waste pickups widget, localised server-side. */
  getWidgetData(deviceId: string | undefined, rows: number): WidgetData {
    const lang = toLang(this.homey.i18n.getLanguage());
    const device = this.widgetDevice(deviceId);
    if (!device) return { status: 'no_device', message: this.homey.__('widget.no_device'), pickups: [] };

    const days = device.upcoming(Math.max(1, Math.min(rows || 4, 10)));
    if (!days.length) {
      const unavailable = !device.getAvailable();
      return {
        status: unavailable ? 'unavailable' : 'no_pickups',
        message: this.homey.__(unavailable ? 'widget.unavailable' : 'widget.no_pickups'),
        name: device.getName(),
        pickups: [],
      };
    }
    return {
      status: 'ok',
      name: device.getName(),
      pickups: days.map((d) => ({
        date: d.date,
        daysUntil: d.daysUntil,
        when: daysText(d.daysUntil, lang),
        dateLong: longDate(d.date, lang),
        fractions: d.keys.map((key) => ({ key, name: fractionName(key, lang), icon: widgetIconPath(key) })),
      })),
    };
  }

  /** Waste types at the address: those it has had pickups for, and any in the current data. */
  private overviewKeys(device: AddressDevice): string[] {
    return [...new Set([...device.knownKeys, ...device.getEvents().map((e) => e.key)])];
  }

  /**
   * Data for the Waste overview widget: each waste type (the chosen ones, or all at the
   * address) with the days until its next pickup, soonest first.
   */
  getOverviewData(deviceId: string | undefined, chosen: string[], iconBase = ''): OverviewData {
    const lang = toLang(this.homey.i18n.getLanguage());
    const device = this.widgetDevice(deviceId);
    if (!device) return { status: 'no_device', message: this.homey.__('widget.no_device'), types: [] };

    const today = localParts(new Date(), device.tz).date;
    const next = new Map<string, string>();
    for (const e of device.getEvents()) {
      if (e.date >= today && (!next.has(e.key) || e.date < next.get(e.key)!)) next.set(e.key, e.date);
    }
    const keys = chosen.length ? [...new Set(chosen)] : this.overviewKeys(device);
    if (!keys.length) {
      const unavailable = !device.getAvailable();
      return {
        status: unavailable ? 'unavailable' : 'no_pickups',
        message: this.homey.__(unavailable ? 'widget.unavailable' : 'widget.no_pickups'),
        name: device.getName(),
        types: [],
      };
    }
    const types = keys.map((key): OverviewType => {
      const name = fractionName(key, lang);
      const date = next.get(key);
      const daysUntil = date ? diffDays(today, date) : null;
      return {
        key, name, icon: iconBase + widgetIconPath(key), daysUntil,
        when: daysUntil == null ? '–' : daysUntil === 0 ? daysText(0, lang) : `${daysUntil} d`,
        label: date ? `${name}: ${longDate(date, lang)}` : name,
      };
    });
    types.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity) || a.name.localeCompare(b.name, lang));
    return { status: 'ok', name: device.getName(), types };
  }

  /**
   * Data for the Pickup calendar widget: `weeks` whole weeks from this week's Monday,
   * each day with the waste types collected. `iconBase` prefixes the icon paths (the
   * calendar loads the icons from the Waste pickups widget's folder).
   */
  getCalendarData(deviceId: string | undefined, weeks: number, iconBase = ''): CalendarData {
    const lang = toLang(this.homey.i18n.getLanguage());
    const device = this.widgetDevice(deviceId);
    if (!device) return { status: 'no_device', message: this.homey.__('widget.no_device') };
    if (!device.getAvailable() && !device.getEvents().length) {
      return { status: 'unavailable', message: this.homey.__('widget.unavailable'), name: device.getName() };
    }

    const today = localParts(new Date(), device.tz).date;
    const start = addDays(today, -weekday(today));
    const count = Math.max(1, Math.min(weeks || 5, 8)) * 7;
    const byDate = new Map<string, string[]>();
    for (const e of device.getEvents()) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      const keys = byDate.get(e.date)!;
      if (!keys.includes(e.key)) keys.push(e.key);
    }
    const frac = (key: string) => ({ key, name: fractionName(key, lang), icon: iconBase + widgetIconPath(key) });

    const days: CalendarDay[] = [];
    const legend = new Map<string, { key: string; name: string; icon: string }>();
    for (let i = 0; i < count; i++) {
      const date = addDays(start, i);
      const day = Number(date.slice(8));
      const keys = (byDate.get(date) ?? []).sort();
      for (const k of keys) if (!legend.has(k)) legend.set(k, frac(k));
      days.push({
        date, day,
        month: day === 1 ? monthName(date, lang, true) : '',
        today: date === today,
        past: date < today,
        label: longDate(date, lang) + (keys.length ? `: ${keys.map((k) => fractionName(k, lang)).join(', ')}` : ''),
        fractions: keys.map(frac),
      });
    }
    const first = monthName(start, lang);
    const last = monthName(addDays(start, count - 1), lang);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return {
      status: 'ok',
      name: device.getName(),
      title: cap(first === last ? first : `${first} – ${last}`),
      weekdays: weekdayLetters(lang),
      days,
      legend: [...legend.values()],
    };
  }
}

module.exports = AffaldApp;
