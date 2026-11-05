"""Archive official OB season splits; publish only complete, verified season files."""
import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

PREFIX = 'ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$'
CATEGORIES = {'hitter': {'41': 'pitcherType', '43': 'runners', '44': 'count', '45': 'outs', '46': 'inning', '47': 'order'},
              'pitcher': {'42': 'batterType', '43': 'runners', '44': 'count', '45': 'outs', '46': 'inning', '47': 'order'}}


def field(name):
    return PREFIX + name + '$' + name


def selected(soup, name):
    element = soup.find('select', attrs={'name': field(name)})
    option = element.select_one('option[selected]') or element.select_one('option')
    return option.get('value', '')


class OfficialPage:
    def __init__(self, role, year):
        self.year = year
        self.url = 'https://www.koreabaseball.com/Record/Player/' + ('HitterBasic' if role == 'hitter' else 'PitcherBasic') + '/Situation.aspx'
        self.session = requests.Session()
        self.session.headers['User-Agent'] = 'Mozilla/5.0'
        self.soup = self.request()
        # Season/series changes rebuild the team options. Select each in order.
        for name, value in [('ddlSeason', str(year)), ('ddlSeries', '0'), ('ddlTeam', 'OB')]:
            self.post(field(name), {field(name): value})
        self.verify()

    def request(self, data=None):
        for attempt in range(3):
            try:
                response = self.session.get(self.url, timeout=40) if data is None else self.session.post(self.url, data=data, timeout=40)
                response.raise_for_status()
                soup = BeautifulSoup(response.content, 'html.parser')
                if not soup.find('select', attrs={'name': field('ddlSeason')}):
                    raise ValueError('Official record form missing')
                return soup
            except (requests.RequestException, ValueError):
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)

    def post(self, target, changes=None):
        data = {x['name']: x.get('value', '') for x in self.soup.select('input[name][type=hidden]')}
        for element in self.soup.select('select[name]'):
            option = element.select_one('option[selected]') or element.select_one('option')
            data[element['name']] = option.get('value', '') if option else ''
        data.update({'__EVENTTARGET': target, '__EVENTARGUMENT': ''})
        data.update(changes or {})
        if changes:
            data[PREFIX + 'hfPage'] = '1'
        self.soup = self.request(data)

    def verify(self):
        for name, value in [('ddlSeason', str(self.year)), ('ddlSeries', '0'), ('ddlTeam', 'OB')]:
            if selected(self.soup, name) != value:
                raise ValueError(f'Wrong official filter: {name} expected {value}')

    def rows(self, role, dimension, situation):
        self.verify()
        table = self.soup.select_one('table.tData01')
        if table is None:
            raise ValueError('Official split table missing')
        headers = [x.get_text(strip=True) for x in table.select('thead th')]
        if '선수명' not in headers or 'H' not in headers or (role == 'hitter' and 'AB' not in headers):
            raise ValueError(f'Unexpected split columns: {headers}')
        output = []
        for tr in table.select('tbody tr'):
            cells = tr.select('td')
            if len(cells) != len(headers):
                if len(cells) == 1 and re.search('없|존재', cells[0].get_text()):
                    continue
                raise ValueError('Unexpected split row shape')
            row = dict(zip(headers, [x.get_text(strip=True) for x in cells]))
            if row['팀명'] not in ('두산', 'OB'):
                raise ValueError('Record belongs to another team')
            name = row['선수명']
            stats = {}
            for key, value in row.items():
                value = value.replace(',', '')
                if re.fullmatch(r'\d+(?:\.\d+)?', value):
                    stats[key] = float(value) if '.' in value else int(value)
            if 'AB' in stats and stats.get('H', 0) > stats['AB']:
                raise ValueError('Hits exceed at-bats')
            output.append({'name': name, 'role': role, 'dimension': dimension, 'situation': situation, 'stats': stats})
        return output


def collect(year):
    rows = []
    coverage = []
    for role, categories in CATEGORIES.items():
        page = OfficialPage(role, year)
        available = {x.get('value') for x in page.soup.find('select', attrs={'name': field('ddlSituation')}).select('option')}
        for code, dimension in categories.items():
            if code not in available:
                raise ValueError(f'Official category missing: {role} {code}')
            page.post(field('ddlSituation'), {field('ddlSituation'): code})
            details = [(x.get('value'), x.get_text(strip=True)) for x in page.soup.find('select', attrs={'name': field('ddlSituationDetail')}).select('option') if x.get('value') != '']
            if not details:
                raise ValueError(f'No official situations: {year} {role} {dimension}')
            for value, label in details:
                page.post(field('ddlSituationDetail'), {field('ddlSituationDetail'): value})
                if selected(page.soup, 'ddlSituation') != code or selected(page.soup, 'ddlSituationDetail') != value:
                    raise ValueError('Wrong official situation')
                seen_pages = set()
                while True:
                    current = page.rows(role, dimension, '언더투수' if dimension == 'pitcherType' and label == '언더' else label)
                    signature = tuple(x['name'] for x in current)
                    if signature in seen_pages:
                        raise ValueError('Repeated official pagination')
                    seen_pages.add(signature)
                    rows.extend(current)
                    active = page.soup.select_one('[id$="ucPager"] a.on, .paging a.on')
                    # Pager IDs are stable even when the surrounding CSS changes.
                    if active is None:
                        active = page.soup.find('a', id=re.compile(r'ucPager_btnNo\d+$'), class_='on')
                    number = int(active.get_text(strip=True)) if active and active.get_text(strip=True).isdigit() else 1
                    next_link = next((x for x in page.soup.find_all('a', id=re.compile(r'ucPager_btnNo\d+$')) if x.get_text(strip=True) == str(number + 1)), None)
                    if next_link is None:
                        break
                    match = re.search(r"__doPostBack\('([^']+)'", next_link.get('href', ''))
                    if not match:
                        raise ValueError('Unknown pagination action')
                    page.post(match[1])
                coverage.append({'role': role, 'dimension': dimension, 'situation': label})
            print(f'{year} {role} {dimension}: {len(rows)} rows', flush=True)
    if not rows:
        raise ValueError('Empty season; preserving previous archive')
    unique = {(x['role'], x['name'], x['dimension'], x['situation']) for x in rows}
    if len(unique) != len(rows):
        raise ValueError('Duplicate player split')
    return {'schemaVersion': 1, 'source': 'kbo', 'scope': 'season', 'teamId': 'OB', 'season': year,
            'updatedAt': datetime.now(timezone.utc).isoformat(), 'coverage': coverage, 'rows': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--output-dir', default='data')
    args = parser.parse_args()
    result = collect(args.year)
    output = Path(args.output_dir) / f'kbo-situational-{args.year}.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(output)
    print(f'Saved {output}: {len(result["rows"])} verified rows')
