"""Extract data tables from a checkout of github.com/briis/affalddk into JSON.

Usage:  python -I scripts/sync_upstream.py <path-to-affalddk-checkout>

Only literal assignments are read (via ast.literal_eval) - no upstream code
is imported or executed. Re-run whenever upstream adds fraction names or
municipalities, then run `npm test`.
"""
import ast
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_LIB = ROOT / 'lib' / 'affalddk' / 'data'
OUT_FIX = ROOT / 'test' / 'fixtures'


def literals(path: Path) -> dict:
    tree = ast.parse(path.read_text(encoding='utf-8'))
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                out[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                pass
    return out


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('wrote', path.relative_to(ROOT))


def main(src: Path) -> None:
    comp = src / 'custom_components' / 'affalddk'
    lib = comp / 'pyaffalddk'

    const = literals(lib / 'const.py')
    const.pop('GH_API', None)  # bytes; kept in TS source
    const['SUPPORTED_ITEMS'] = json.loads((lib / 'supported_items.json').read_text(encoding='utf-8'))
    dump(OUT_LIB / 'const.json', const)

    muni = literals(lib / 'municipalities.py')
    ids = {}
    for line in muni['data'].splitlines():
        if ':' in line:
            code, name = line.split(':', 1)
            ids[name.strip().lower()] = int(code)
    dump(OUT_LIB / 'municipalities.json', {'ids': ids, 'list': muni['MUNICIPALITIES_LIST']})

    for lang in ('da', 'en'):
        dump(OUT_LIB / f'i18n.{lang}.json', json.loads((comp / 'i18n' / f'{lang}.json').read_text(encoding='utf-8')))

    tests = src / 'tests'
    dump(OUT_FIX / 'const_tests.json', literals(tests / 'data' / 'const_tests.py'))
    for f in (tests / 'data').iterdir():
        if f.suffix in ('.data', '.pdf', '.json') and f.name != 'vestfor.data':  # vestfor.data is a pickle
            OUT_FIX.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, OUT_FIX / f.name)
    print('copied fixtures')

    img_out = ROOT / 'widgets' / 'upcoming' / 'public' / 'icons'
    img_out.mkdir(parents=True, exist_ok=True)
    for f in (comp / 'images').glob('*.svg'):
        shutil.copyfile(f, img_out / f.name)
    print('copied icons')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
