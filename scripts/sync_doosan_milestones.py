"""Fetch the public data used by Doosan's /stats/expect page; no account required."""
import json
import os
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

BASE = 'https://www.doosanbears.com/doosan/v1'
OUTPUT = Path(os.environ.get('MILESTONE_OUTPUT', 'data/doosan-milestones.json'))

def fetch(path):
    request = Request(BASE + path, headers={'Accept': 'application/json', 'User-Agent': 'BEARStat/1.0'})
    with urlopen(request, timeout=25) as response:
        body = json.load(response)
    if body.get('success') is not True or body.get('code') != 0:
        raise ValueError('Official source returned an unsuccessful response')
    return body

def validate_records(body):
    records = body.get('data', {}).get('records')
    if not isinstance(records, dict):
        raise ValueError('Missing official records')
    for code, rows in records.items():
        if not isinstance(code, str) or not isinstance(rows, list):
            raise ValueError('Invalid record category')
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('name'), str) or not row['name'].strip():
                raise ValueError('Invalid player')
            for field in ('forecast', 'remnant'):
                value = row.get(field)
                if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
                    raise ValueError('Invalid official milestone count')
            if row['remnant'] > row['forecast']:
                raise ValueError('Remaining value exceeds target')
    return records

def main():
    pitchers = validate_records(fetch('/stats/team/forecasts?position=PITCHER'))
    hitters = validate_records(fetch('/stats/team/forecasts?position=BATTER'))
    codes = fetch('/code/subcategory/codes/FOCST').get('list')
    if not isinstance(codes, list):
        raise ValueError('Invalid category labels')
    snapshot = {
        'schemaVersion': 1, 'source': 'doosan-official',
        'sourceUrl': 'https://www.doosanbears.com/stats/expect',
        'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'labels': {row['codeId']: row['codeName'] for row in codes},
        'records': {'pitcher': pitchers, 'hitter': hitters},
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    temporary.replace(OUTPUT)

if __name__ == '__main__':
    main()
