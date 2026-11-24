import Homey from 'homey';
import { addDays, localParts, setMissingTypeLogger, weekday } from './lib/affalddk';
import { widgetIconPath } from './lib/icons';
import {
  daysText, fractionName, longDate, monthName, shortDate, toLang, weekdayLetters,
} from './lib/names';
import type { AddressDevice } from './drivers/address/device';

export interface WidgetPickup {
  date: string;
  daysUntil: number;
  when: string;
  dateLabel: string;
  dateLong: string;
  fractions: Array<{ key: string; name: string; icon: string }>;
}

export interface WidgetData {
  status: 'ok' | 'no_device' | 'no_pickups' | 'unavailable';
  message?: string;
  name?: string;
  pickups: WidgetPickup[];
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

    for (const id of ['upcoming', 'calendar']) {
      this.homey.dashboards.getWidget(id).registerSettingAutocompleteListener('device', async (query: string) => {
        const q = query.trim().toLowerCase();
        return this.addressDevices()
          .map((d) => ({ id: d.getId(), name: d.getName(), description: d.getStoreValue('municipality') as string }))
          .filter((d) => !q || d.name.toLowerCase().includes(q));
      });
    }

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
        dateLabel: shortDate(d.date, lang),
        dateLong: longDate(d.date, lang),
        fractions: d.keys.map((key) => ({ key, name: fractionName(key, lang), icon: widgetIconPath(key) })),
      })),
    };
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
