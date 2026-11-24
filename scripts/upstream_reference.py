"""Generate test/fixtures/reference.json by running upstream pyaffalddk on the fixtures.

The TypeScript port is checked against this file (test/reference.test.ts).
Needs a venv with: aiohttp beautifulsoup4 ical python-dateutil freezegun

Usage: <venv>/python -I scripts/upstream_reference.py <path-to-affalddk-checkout>
"""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / 'test' / 'fixtures'

# (name, municipality, fixture, loader, frozen date, address id) - mirrors upstream tests/test_interface.py
CASES = [
    ('openexplive', 'Fredericia', 'openexplive.data', 'json', '2025-05-25', '14578'),
    ('openexp', 'Holstebro', 'openexp.data', 'json', '2025-05-20', '14738'),
    ('affaldonline', 'Vejle', 'affaldonline.data', 'json', '2025-05-20', '1111'),
    ('perfectwaste', 'Køge', 'Koege.data', 'json:result', '2025-05-04', '1111'),
    ('renoweb', 'Aalborg', 'Aalborg_gh.data', 'json', '2025-05-04', '1111'),
    ('odense', 'Odense', 'odense_ics.data', 'text', '2025-04-25', '1111'),
    ('aarhus', 'Aarhus', 'Aarhus.data', 'json:0:plannedLoads', '2025-04-25', '1111'),
    ('provas', 'Haderslev', 'provas.data', 'json', '2025-06-04', '1111'),
    ('renodjurs', 'Norddjurs', 'renodjurs.data', 'json', '2025-06-04', '1111'),
    ('herning', 'Herning', 'herning.data', 'json', '2025-06-17', '1111'),
    ('wastewatch', 'Tønder', 'tonfor.data', 'json', '2026-01-06', '1111'),
]


def load(fixture, loader):
    text = (FIX / fixture).read_text(encoding='utf-8')
    if loader == 'text':
        return text
    data = json.loads(text)
    for part in loader.split(':')[1:]:
        data = data[int(part)] if part.isdigit() else data[part]
    return data


async def run_case(GarbageCollection, freeze_time, case):
    name, municipality, fixture, loader, date, address_id = case
    raw = load(fixture, loader)
    with freeze_time(date):
        gc = GarbageCollection(municipality)

        async def get_data(*args, **kwargs):
            return raw
        gc._api.get_garbage_data = get_data
        pickups = await gc.get_pickup_data(address_id, dynamic_next_icon=True)
        await gc._api.session.close()
    out = {}
    for key, p in pickups.items():
        out[key] = {
            'date': str(p.date), 'group': p.group, 'description': p.description,
            'container_count': p.container_count,
        }
    return {'municipality': municipality, 'fixture': fixture, 'loader': loader, 'today': date,
            'address_id': address_id, 'pickups': out}


async def main(src: Path):
    sys.path.append(str(src / 'custom_components' / 'affalddk'))  # append: the folder has a calendar.py shadowing stdlib
    from freezegun import freeze_time
    from pyaffalddk.api import GarbageCollection

    result = {}
    for case in CASES:
        result[case[0]] = await run_case(GarbageCollection, freeze_time, case)
        print(case[0], len(result[case[0]]['pickups']), 'keys')
    (FIX / 'reference.json').write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('wrote test/fixtures/reference.json')


if __name__ == '__main__':
    asyncio.run(main(Path(sys.argv[1])))
