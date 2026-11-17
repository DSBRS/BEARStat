"""Export HTML schedule literals for push delivery without executing HTML or JS."""
import argparse
import ast
import datetime as dt
import json
import re
from pathlib import Path

TOKEN = re.compile(r'''\s+|//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?|[\[\]{},:]''')
TIME = re.compile(r'(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?')
KST = dt.timezone(dt.timedelta(hours=9), 'KST')

# Birthday pushes go out once, on the morning of the day itself.
BIRTHDAY_TIME = '09:00'
# Export this month through December of the next year, so the feed keeps working
# until the roster data gains the next season.
BIRTHDAY_MONTHS = 14
# A birthday year with no roster data yet uses the latest recorded season,
# but only one season ahead: older data must not invent a current roster.
BIRTHDAY_MAX_SEASON_GAP = 1

def array_literal(html, name):
    found = re.search(r'\bconst\s+' + re.escape(name) + r'\s*=\s*', html)
    if not found:
        raise ValueError('Missing schedule array: ' + name)
    text = html[found.end():]
    parts, position, depth = [], 0, 0
    for match in TOKEN.finditer(text):
        if match.start() != position:
            raise ValueError('Unsupported schedule syntax in ' + name)
        position = match.end()
        token = match.group()
        if token.isspace() or token.startswith('//') or token.startswith('/*'):
            continue
        if not parts and token != '[':
            raise ValueError('Schedule must be an array: ' + name)
        if token[0] in "\"'":
            parts.append(json.dumps(json.loads(token) if token[0] == '"' else ast.literal_eval(token), ensure_ascii=False))
        elif re.fullmatch(r'[A-Za-z_$][\w$]*', token):
            # Only object keys and the JSON literal values are permitted.
            rest = text[position:].lstrip()
            if rest.startswith(':'):
                parts.append(json.dumps(token))
            elif token in ('true', 'false', 'null'):
                parts.append(token)
            else:
                raise ValueError('Executable schedule value rejected: ' + token)
        else:
            if token in ('}', ']') and parts and parts[-1] == ',':
                parts.pop()
            parts.append(token)
        if token == '[': depth += 1
        if token == ']':
            depth -= 1
            if depth == 0:
                return json.loads(''.join(parts))
    raise ValueError('Unclosed schedule array: ' + name)

def month_start(day, months):
    """First day of the month `months` after the month containing `day`."""
    index = day.year * 12 + (day.month - 1) + months
    return dt.date(index // 12, index % 12 + 1, 1)

def birthday_events(html, today=None):
    """Roster birthdays in the export window, one event per date.

    The roster rule matches the calendar: a player gets a birthday when the
    season of that birthday is one of the years he was on the 두산 roster.
    For a season the data does not cover yet, the latest recorded season is
    used (the current squad), and only for one season ahead.
    """
    players = array_literal(html, 'BEARS_HARU_BIRTHDAYS')
    today = today or dt.datetime.now(KST).date()
    seasons = sorted({int(year) for player in players for year in (player.get('y') or []) if isinstance(year, int)})
    if not seasons:
        return []
    latest = seasons[-1]
    start = today.replace(day=1)
    end = month_start(start, BIRTHDAY_MONTHS) - dt.timedelta(days=1)
    days = {}
    for player in players:
        name, born = player.get('n'), player.get('b')
        if not isinstance(name, str) or not name.strip():
            raise ValueError('Birthday entry needs a name')
        if not isinstance(born, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', born):
            raise ValueError('Birthday entry needs a birth date: ' + name)
        years = player.get('y') or []
        birth = dt.date.fromisoformat(born)
        for year in range(start.year, end.year + 1):
            if year - latest > BIRTHDAY_MAX_SEASON_GAP:
                continue
            if min(year, latest) not in years:
                continue
            try:
                day = dt.date(year, birth.month, birth.day)
            except ValueError:
                continue  # February 29 has no birthday event in a common year.
            if not start <= day <= end:
                continue
            days.setdefault(day, []).append(name)
    events = []
    for day in sorted(days):
        names = []
        for name in days[day]:
            if name not in names:
                names.append(name)
        events.append({
            'id': 'birthday-' + day.isoformat(),
            'type': 'birthday',
            'source': 'index.html: BEARS_HARU_BIRTHDAYS',
            'date': day.isoformat(),
            'time': BIRTHDAY_TIME,
            'title': (names[0] if len(names) == 1 else ' · '.join(names)) + ' 선수 생일',
            'desc': (names[0] + ' 선수의 생일입니다!' if len(names) == 1 else ', '.join(names) + ' 선수의 생일입니다!'),
            'place': '',
            'players': names,
            'notificationCategory': 'birthday',
        })
    return events

def notification_events(html, today=None):
    result, seen, events = [], set(), []
    for name in ('HANDBALL_AUTO', 'NATIONAL_TEAM_GAMES'):
        for event in array_literal(html, name):
            if not isinstance(event, dict) or not isinstance(event.get('id'), str):
                raise ValueError('Schedule needs an event id: ' + name)
            if event['id'] in seen:
                raise ValueError('Duplicate schedule id: ' + event['id'])
            seen.add(event['id'])
            # Historical records without a start time remain in HTML, never invented here.
            if not event.get('time'):
                continue
            if not TIME.fullmatch(event['time']):
                raise ValueError('Invalid schedule time: ' + event['id'])
            dt.date.fromisoformat(event['date'])
            if event.get('type') not in ('national', 'handball'):
                raise ValueError('Unexpected built-in schedule type: ' + event['id'])
            events.append(event)
    for event in birthday_events(html, today):
        if event['id'] in seen:
            raise ValueError('Duplicate schedule id: ' + event['id'])
        seen.add(event['id'])
        if not TIME.fullmatch(event['time']):
            raise ValueError('Invalid birthday time: ' + event['id'])
        events.append(event)
    events.sort(key=lambda e: (e['date'], e['time'], e['type'], e['id']))
    return {'schemaVersion': 1, 'source': 'index.html: HANDBALL_AUTO + NATIONAL_TEAM_GAMES + BEARS_HARU_BIRTHDAYS', 'events': events}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', default='index.html')
    parser.add_argument('--output', default='data/notification-events.json')
    parser.add_argument('--today', help='Export as if this date were today (YYYY-MM-DD, KST)')
    args = parser.parse_args()
    today = dt.date.fromisoformat(args.today) if args.today else None
    value = notification_events(Path(args.html).read_text(), today)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    counts = {t: sum(e['type'] == t for e in value['events']) for t in ('national', 'handball', 'birthday')}
    print('Exported notification schedules:', counts)

if __name__ == '__main__':
    main()
