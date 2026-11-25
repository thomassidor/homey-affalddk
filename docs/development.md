# Developing Affald DK

The app is TypeScript on Homey's SDK v3. Its core, `lib/affalddk/`, is a port of [`pyaffalddk`](https://github.com/briis/affalddk/tree/main/custom_components/affalddk/pyaffalddk), the Python library inside Bjarne Riis' and TermeHansen's Home Assistant integration. The port keeps upstream's structure, so changes there can be carried over provider by provider.

## Commands

```bash
npm install
npm test                 # vitest: fraction mapping, providers vs. upstream, PDF/ICS/dates
npm run test:live        # live: one real address per municipality (all 93), ~1 min, needs internet
npm run typecheck
npx tsx scripts/probe.ts Roskilde --zip 4040 --street Bygaden --number 3   # live probe of one address
npx tsx scripts/smoke.ts                                                    # one address per provider
homey app run            # run on a Homey Pro with live logs
homey app install        # install on the active Homey
homey app validate --level publish
```

## Layout

```
lib/affalddk/        Port of pyaffalddk (no Homey imports)
  providers/         One class per backend: fetchRaw() (network) + parse() (pure, tested)
  parsers/           PDF (affaldonline calendars), ICS, HTML helpers
  data/*.json        Tables generated from upstream (scripts/sync_upstream.py)
  fractions.ts       Free-text fraction name -> waste type key
  collection.ts      GarbageCollection: municipality -> provider, address search, events
  summary.ts         Per-type next date, "next pickup" with switch hour
lib/names.ts         Localised waste type and day names
lib/icons.ts         Waste type icons (upstream's), for the widgets and pairing
drivers/address/     Device, driver (pairing + flow cards), pair view
widgets/upcoming/    "Waste pickups" widget (the icons live in its public/icons)
widgets/calendar/    "Pickup calendar" widget (loads the icons from widgets/upcoming)
dev/                 Preview pages with a simulated Homey and made-up data
scripts/             Upstream sync, live checks, renders
```

## Keeping up with upstream

Upstream regularly adds waste type names and municipalities. To pull them in:

```bash
git clone https://github.com/briis/affalddk ../affalddk
python -I scripts/sync_upstream.py ../affalddk        # regenerates lib/affalddk/data, test fixtures, icons
npm test
```

The sync records the upstream commit it came from in `lib/affalddk/data/upstream.json`. To see what upstream has done since, sorted into provider code (port by hand), data (re-run the sync) and Home Assistant parts (ignore):

```bash
git -C ../affalddk pull && python -I scripts/upstream_changes.py ../affalddk
```

The `Upstream watch` workflow runs the same check every Monday. If anything relevant has changed, it opens or updates a single issue labelled `upstream`, with a checklist of the new commits. Work through the list, run the sync, commit, and close the issue. The next report then starts from the new commit.

`test/reference.test.ts` compares the port with upstream's own output on the same fixtures. To regenerate `test/fixtures/reference.json`, run `scripts/upstream_reference.py` in a venv that has `aiohttp beautifulsoup4 ical python-dateutil freezegun` installed.

Provider changes, such as new endpoints, have to be ported by hand from `pyaffalddk/interface.py`.

## Live tests

`test/fixtures/live-addresses.json` holds one verified address for each supported municipality. `test/live/municipalities.live.test.ts` runs each of them through address search, address lookup and pickups against the real provider APIs.

`scripts/find-addresses.ts` finds these addresses. It takes random single-family addresses from DAWA (`dawa.companydata.dk`) and keeps the first one that gives pickups. If an address stops working, pick a new one:

```bash
npx tsx scripts/find-addresses.ts Roskilde                          # new random address
npx tsx scripts/find-addresses.ts "Frederiksberg=2000/Smallegade/3"  # a specific address
npx tsx scripts/find-addresses.ts                                   # fill in any missing municipality
```

When the live tests meet waste type names that upstream's mapping doesn't know, they print them at the end. Those pickups are skipped, as upstream does. Report new names to [briis/affalddk](https://github.com/briis/affalddk/issues).

## Graphics

Everything visual is rendered from HTML with headless Edge or Chrome (`scripts/render.mjs`), from the pages in `dev/`, using made-up data:

| Command | Output |
|---|---|
| `node scripts/render.mjs pair widget calendar overview` | Dev renders in `.renders/` (gitignored) |
| `node scripts/render.mjs previews` | The widgets' store previews (`widgets/*/preview-*.png`) |
| `node scripts/render.mjs docs` | The README screenshots (`docs/screenshots/`) |
| `npm run store-images` | The App Store images (`assets/images/`) and driver images |

The store art comes from `dev/store-art.src.html` (direction D, "Mosaik"). Build the page with `node scripts/build-store-art.mjs` before rendering it.

## Provider status (2026-11-24)

- All 93 municipalities pass the live tests.
- Vest Forbrænding and Odense answer HTTP 500 for some addresses, while other addresses work. Upstream behaves the same way.
- NemAffald (the old København API) isn't ported, because no municipality uses it any more.
