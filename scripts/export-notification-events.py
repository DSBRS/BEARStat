"""Export HTML schedule literals for push delivery without executing HTML or JS."""
import argparse
import ast
import datetime as dt
import json
import re
from pathlib import Path

TOKEN = re.compile(r'''\s+|//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?|[\[\]{},:]''')

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

def notification_events(html):
    result, seen = [], set()
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
            if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?', event['time']):
                raise ValueError('Invalid schedule time: ' + event['id'])
            dt.date.fromisoformat(event['date'])
            if event.get('type') not in ('national', 'handball'):
                raise ValueError('Unexpected built-in schedule type: ' + event['id'])
            result.append(event)
    return {'schemaVersion': 1, 'source': 'index.html: HANDBALL_AUTO + NATIONAL_TEAM_GAMES', 'events': result}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', default='index.html')
    parser.add_argument('--output', default='data/notification-events.json')
    args = parser.parse_args()
    value = notification_events(Path(args.html).read_text())
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    counts = {t: sum(e['type'] == t for e in value['events']) for t in ('national', 'handball')}
    print('Exported notification schedules:', counts)

if __name__ == '__main__':
    main()
