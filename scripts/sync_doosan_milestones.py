"""Refresh Doosan's first-team entry from the official KBO register page."""
import datetime as dt
import html
import http.cookiejar
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

URL = 'https://www.koreabaseball.com/Player/Register.aspx'
PREFIX = 'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$'


def fields(source):
    values = {}
    for attrs in re.findall(r'<input\b([^>]*)>', source):
        name = re.search(r'name="([^"]+)"', attrs)
        value = re.search(r'value="([^"]*)"', attrs)
        if name and 'type="hidden"' in attrs:
            values[html.unescape(name[1])] = html.unescape(value[1]) if value else ''
    return values


def parse_entry(source, date):
    values = fields(source)
    if values.get(PREFIX + 'hfSearchTeam') != 'OB':
        raise ValueError('Response belongs to another team')
    if values.get(PREFIX + 'hfSearchDate') != date.strftime('%Y%m%d'):
        raise ValueError('Response date mismatch')
    if '두산 베어스 선수등록명단' not in source:
        raise ValueError('Missing Doosan register heading')
    players = []
    found = set()
    for table in re.findall(r'<table\b[^>]*>(.*?)</table>', source, re.S):
        headers = re.findall(r'<th\b[^>]*>(.*?)</th>', table, re.S)
        positions = [p for p in ['투수', '포수', '내야수', '외야수'] if p in headers]
        if not positions:
            continue
        position = positions[0]
        found.add(position)
        for pid, name in re.findall(r'<a\b[^>]*playerId=(\d+)[^>]*>(.*?)</a>', table, re.S):
            players.append({'id': pid, 'n': html.unescape(re.sub('<[^>]*>', '', name)).strip(),
                            't': 'pitcher' if position == '투수' else 'hitter'})
    if len(found) != 4 or len({p['id'] for p in players}) != len(players):
        raise ValueError('Incomplete or duplicated register tables')
    if len(players) > 45:
        raise ValueError('Unexpected first-team entry size')
    return {'schemaVersion': 1, 'team': 'OB', 'asOf': date.isoformat(),
            'source': URL, 'players': players}


def fetch_entry(today=None):
    today = today or dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    source = opener.open(URL, timeout=25).read().decode('utf-8-sig')
    # KBO can leave today's tables blank until publishing the daily register.
    # Return the most recent published entry, keeping its actual date.
    for offset in range(7):
        date = today - dt.timedelta(days=offset)
        values = fields(source)
        values.update({PREFIX + 'hfSearchTeam': 'OB', PREFIX + 'hfSearchDate': date.strftime('%Y%m%d'),
                       '__EVENTTARGET': PREFIX + 'btnCalendarSelect', '__EVENTARGUMENT': ''})
        source = opener.open(urllib.request.Request(URL, data=urllib.parse.urlencode(values).encode()),
                             timeout=25).read().decode('utf-8-sig')
        entry = parse_entry(source, date)
        if entry['players']:
            return entry
    raise ValueError('No published Doosan entry within the last seven days')


if __name__ == '__main__':
    entry = fetch_entry()
    output = Path('data/bears-entry.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Doosan entry: {entry['asOf']}, {len(entry['players'])} players")
