"""List upstream commits since the last sync, triaged by what they mean for this port.

Usage:  python -I scripts/upstream_changes.py <path-to-affalddk-checkout> [--out FILE]

Reads the synced commit from lib/affalddk/data/upstream.json and prints a Markdown
report of newer upstream commits (git only, no upstream code is run):

  provider  pyaffalddk code: port by hand
  data      fraction names, municipalities, i18n, icons, fixtures: re-run sync_upstream.py
  ignored   Home Assistant integration, CI, docs

Exit code 0 = something to look at, 3 = nothing relevant (only ignored commits or none).
The weekly .github/workflows/upstream-watch.yml turns the report into an issue.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = 'https://github.com/briis/affalddk'
COMP = 'custom_components/affalddk/'
LIB = COMP + 'pyaffalddk/'
DATA_FILES = {LIB + 'const.py', LIB + 'municipalities.py', LIB + 'supported_items.json'}
DATA_DIRS = (COMP + 'i18n/', COMP + 'images/', 'tests/data/')


def git(src: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(src), *args], capture_output=True, text=True, check=True).stdout


def kind(path: str) -> str:
    if path in DATA_FILES or path.startswith(DATA_DIRS):
        return 'data'
    if path.startswith(LIB) and path.endswith('.py'):
        return 'provider'
    return 'ignored'


def safe(subject: str) -> str:
    """Upstream text goes into an issue here: link PR refs upstream, don't ping anyone."""
    subject = re.sub(r'#(\d+)', rf'[#\1]({UPSTREAM}/pull/\1)', subject)
    return subject.replace('@', '@​').replace('<', '&lt;')


def main(src: Path, out: Path | None) -> int:
    base = json.loads((ROOT / 'lib' / 'affalddk' / 'data' / 'upstream.json').read_text())['commit']
    head = git(src, 'rev-parse', 'HEAD').strip()
    log = git(src, 'log', '--reverse', '--no-merges', '--format=%x00%H%x09%cs%x09%s', '--name-only', f'{base}..HEAD')

    groups: dict[str, list[str]] = {'provider': [], 'data': [], 'ignored': []}
    for entry in filter(None, log.split('\0')):
        header, *files = [l for l in entry.splitlines() if l]
        sha, date, subject = header.split('\t', 2)
        kinds = {kind(f) for f in files} or {'ignored'}
        k = 'provider' if 'provider' in kinds else 'data' if 'data' in kinds else 'ignored'
        touched = ', '.join(f'`{f.removeprefix(LIB).removeprefix(COMP)}`' for f in files if kind(f) == k)
        line = f'- {"" if k == "ignored" else "[ ] "}{date} [{sha[:7]}]({UPSTREAM}/commit/{sha}) {safe(subject)}'
        groups[k].append(line + (f' ({touched})' if touched and k != 'ignored' else ''))

    relevant = bool(groups['provider'] or groups['data'])
    md = [f'Upstream [briis/affalddk]({UPSTREAM}) has moved from '
          f'[{base[:7]}]({UPSTREAM}/commit/{base}) (last sync) to '
          f'[{head[:7]}]({UPSTREAM}/commit/{head}). '
          f'[Full diff]({UPSTREAM}/compare/{base[:7]}...{head[:7]})', '']
    if groups['provider']:
        md += ['### Provider code: port by hand', 'Compare with `lib/affalddk/` and port what applies.', '',
               *groups['provider'], '']
    if groups['data']:
        md += ['### Data: re-run the sync', '```bash',
               'python -I scripts/sync_upstream.py ../affalddk && npm test', '```', '', *groups['data'], '']
    if groups['ignored']:
        md += ['<details><summary>Ignored (Home Assistant, CI, docs): '
               f'{len(groups["ignored"])} commits</summary>', '', *groups['ignored'], '', '</details>', '']
    if not relevant:
        md += ['Nothing that affects this app.', '']
    md += ['When done, run the sync (it updates `lib/affalddk/data/upstream.json`) and close this issue.']

    text = '\n'.join(md) + '\n'
    if out:
        out.write_text(text, encoding='utf-8')
    else:
        sys.stdout.write(text)
    return 0 if relevant else 3


if __name__ == '__main__':
    args = sys.argv[1:]
    out = Path(args[args.index('--out') + 1]) if '--out' in args else None
    sys.exit(main(Path(args[0]), out))
