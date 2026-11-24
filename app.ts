import Homey from 'homey';
import { setMissingTypeLogger } from './lib/affalddk';
import { widgetIconPath } from './lib/icons';
import { daysText, fractionName, longDate, shortDate, toLang } from './lib/names';
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

class AffaldApp extends Homey.App {
  async onInit(): Promise<void> {
    setMissingTypeLogger((msg) => this.log(`[unknown waste type] ${msg}`));

    const widget = this.homey.dashboards.getWidget('upcoming');
    widget.registerSettingAutocompleteListener('device', async (query: string) => {
      const q = query.trim().toLowerCase();
      return this.addressDevices()
        .map((d) => ({ id: d.getId(), name: d.getName(), description: d.getStoreValue('municipality') as string }))
        .filter((d) => !q || d.name.toLowerCase().includes(q));
    });

    this.log('Affald DK started');
  }

  addressDevices(): AddressDevice[] {
    return this.homey.drivers.getDriver('address').getDevices() as unknown as AddressDevice[];
  }

  /** Data for the dashboard widget, localised server-side. */
  getWidgetData(deviceId: string | undefined, rows: number): WidgetData {
    const lang = toLang(this.homey.i18n.getLanguage());
    const devices = this.addressDevices();
    // Fall back to the only device when none is chosen yet
    const device = devices.find((d) => d.getId() === deviceId) ?? (devices.length === 1 ? devices[0] : undefined);
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
}

module.exports = AffaldApp;
