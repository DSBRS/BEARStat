"""Fetch the public data used by Doosan's /stats/expect page; no account required."""
import json
import os
import math
import time
import http.cookiejar
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError, URLError

BASE = 'https://www.doosanbears.com/doosan/v1'
OUTPUT = Path(os.environ.get('MILESTONE_OUTPUT', 'data/doosan-milestones.json'))

SITE = 'https://www.doosanbears.com'
PUBLIC_PAGE = SITE + '/stats/expect'
USER_AGENT = ('Mozilla/5.0 (X11; Linux x86_64) '
              'AppleWebKit/537.36 (KHTML, like Gecko) '
              'Chrome/131.0.0.0 Safari/537.36')
_session = None

def official_open(request):
    for attempt in range(3):
        try:
            return _session.open(request, timeout=25)
        except HTTPError as error:
            if error.code == 403:
                raise RuntimeError(
                    '두산 공식 서버가 이 실행 환경의 요청을 거절했습니다 (HTTP 403). '
                    '파일 업로드 오류가 아닙니다. 기존 기록은 그대로 유지됩니다. '
                    '요청 주소: ' + request.full_url
                ) from error
            if error.code not in (500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)

def prepare_session():
    global _session
    if _session is not None:
        return
    _session = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    # Establish the same public-page cookie session used by the official site.
    request = Request(PUBLIC_PAGE, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    })
    try:
        with official_open(request) as response:
            response.read()
    except Exception:
        _session = None
        raise

def fetch(path):
    prepare_session()
    request = Request(BASE + path, headers={
        'Accept': 'application/json',
        'Content-Type': 'application/json-patch+json',
        'User-Agent': USER_AGENT,
        'Referer': PUBLIC_PAGE,
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    })
    with official_open(request) as response:
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
