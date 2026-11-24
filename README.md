# Affald DK for Homey

Danish waste pickup schedules in Homey: one device per address, with days until each waste type is collected, flow cards and a dashboard widget.

This is a TypeScript port of [briis/affalddk](https://github.com/briis/affalddk), the Home Assistant integration by Bjarne Riis and TermeHansen. The port covers its `pyaffalddk` library, including the provider backends and the waste-type mapping, and is used under the MIT license. The waste-type icons also come from that project.

## Features

- **Device per address.** You pair it by choosing a municipality and entering postcode, street and house number. The municipality is pre-selected from Homey's location.
- **Capabilities.** `days_until.<waste type>` is added automatically for each waste type at the address and logged in Insights. `days_until.next_pickup`, `next_pickup_type` and `next_pickup_date` cover the next pickup.
- **Flow cards**
  - Trigger *Pickup reminder*: at a chosen time, fires when a waste type (or any) is collected in N days.
  - Trigger *Next pickup changed*.
  - Conditions *collected in exactly N days* and *collected within N days*.
  - Action *Refresh pickup data*.
- **Widget** *Waste pickups*: lists the upcoming pickup days with icons, in light and dark theme.

Data is fetched once a day, between 03:00 and 06:00. The day counts are recomputed every hour. After the *switch hour* (default 15:00) on a pickup day, "next pickup" moves on to the following pickup, as upstream does.

## Development

```bash
npm install
npm test                 # vitest: fraction mapping, providers vs. upstream, PDF/ICS/dates
npm run typecheck
npx tsx scripts/probe.ts Roskilde --zip 4040 --street Bygaden --number 3   # live probe of one address
npx tsx scripts/smoke.ts                                                    # live check of all providers
homey app run            # run on a Homey Pro
homey app validate --level publish
```

### Layout

```
lib/affalddk/        Port of pyaffalddk (no Homey imports)
  providers/         One class per backend: fetchRaw() (network) + parse() (pure, tested)
  parsers/           PDF (affaldonline calendars), ICS, HTML helpers
  data/*.json        Tables generated from upstream (scripts/sync_upstream.py)
  fractions.ts       Free-text fraction name -> waste type key
  collection.ts      GarbageCollection: municipality -> provider, address search, events
  summary.ts         Per-type next date, "next pickup" with switch hour
lib/names.ts         Localised waste type / day names
drivers/address/     Device, driver (pairing + flow cards), pair view
widgets/upcoming/    Dashboard widget
```

### Keeping up with upstream

New waste-type names and municipalities are added upstream regularly. To pull them in:

```bash
git clone https://github.com/briis/affalddk ../affalddk
python -I scripts/sync_upstream.py ../affalddk        # regenerates lib/affalddk/data, test fixtures, icons
npm test
```

`test/reference.test.ts` compares the port with upstream's output on the same fixtures. To regenerate `test/fixtures/reference.json`, run `scripts/upstream_reference.py` in a venv that has `aiohttp beautifulsoup4 ical python-dateutil freezegun` installed.

Provider changes, such as new endpoints, need to be ported by hand from `pyaffalddk/interface.py`.

### Known provider status (2026-11)

- **Working:** all providers apart from the two below. `scripts/smoke.ts` runs one known address per provider.
- **Vest Forbrænding** (Albertslund, Furesø, Herlev, Ishøj, Vallensbæk): `ToemmeDates` answers HTTP 500, and upstream fails the same way.
- **NemAffald** (old København API): no municipality uses it any more, so it isn't ported.
