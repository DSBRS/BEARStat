#!/usr/bin/env python3
"""Read-only export of existing public BEARStat rows. Never deletes source rows.

Every run lists only the row ids of each public table (a few tens of KB) and then
reads row bodies only where something can have changed:

  * rows that are new since the last archive,
  * rows inside the live window (recent or upcoming dates, which the site still edits),
  * the whole `kv` table, which is small.

A full re-read of every table happens on the first run, with --full, or once every
RECONCILE_DAYS days; that is what catches in-place edits of older rows. The row ids
the project reports are authoritative: when the published set would not match them
(count change, missing row, empty response) nothing is published and the last good
archive keeps being served.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlencode

TABLES = {'events': 'id', 'kbo_game_records': 'game_id', 'futures_game_records': 'game_id'}
COLUMNS = {table: idkey + ',date,body' for table, idkey in TABLES.items()}
PUBLIC_KEYS = ['bears_career_%', 'bears_franchise_%', 'bears_roster%', 'edu_roster_%', 'standings_others%', 'standings_auto_%', 'standings_official_%', 'kbo_situational_%', 'kbo_pinch_hit_%', 'naver_advanced_%', 'futures_sync_%', 'bearstat_player_visibility_v1', 'hidden_auto_events', 'kbo_history_sync', 'bearstat_awards_v1']
VOLATILE_KEYS = {'fetchedAt', 'updatedAt', 'generatedAt', 'syncedAt', 'lastSyncedAt', 'lastFetchedAt', 'lastCheckedAt', 'checkedAt', 'collectedAt', 'parserVersion'}
SHARD_NAME = re.compile(r'^(?:events|kbo_game_records|futures_game_records|kv)-[A-Za-z0-9]+-[0-9a-f]{16}\.json$')
SAFE_ID = re.compile(r'[A-Za-z0-9_.:-]+')
DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
PAGE = 500
ID_PAGE = 1000
ID_CHUNK = 40
LIVE_DAYS = int(os.getenv('BEARSTAT_LIVE_DAYS') or 45)
RECONCILE_DAYS = int(os.getenv('BEARSTAT_RECONCILE_DAYS') or 14)


def public_key(k):
    return any(re.fullmatch(re.escape(p).replace('%', '.*'), k) for p in PUBLIC_KEYS)


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def notification_content(value):
    if isinstance(value, dict):
        return {k: notification_content(v) for k, v in sorted(value.items()) if k not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [notification_content(v) for v in value]
    return value


def notification_digest(value):
    return hashlib.sha256(encode(notification_content(value))).hexdigest()


def notification_index(records):
    index = {}
    for table, rows in records.items():
        for row in rows:
            key = str(row.get('key') if table == 'kv' else row.get('id') if table == 'events' else row.get('game_id'))
            if table == 'kv' and key.startswith(('futures_sync_', 'kbo_history_sync')):
                continue
            index[table + ':' + key] = (notification_digest(row), row)
    return index


def previous_notification_records(root, manifest):
    if not manifest:
        return None
    records = {}
    for table, meta in manifest['tables'].items():
        rows = []
        for shard in meta['shards']:
            name = shard['file']
            if Path(name).name != name:
                raise ValueError('Invalid archive shard path')
            data = (root / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != shard['sha256']:
                raise ValueError('Invalid previous archive shard')
            rows.extend(json.loads(data))
        records[table] = rows
    return records


def notification_label(table, row, before=None):
    body = row.get('body') or {}
    body = body if isinstance(body, dict) else {}
    if table == 'kv':
        key = row['key']
        year = re.search(r'(?:19|20)\d{2}', key)
        prefix = (year[0] + '년 ') if year else ''
        labels = [('kbo_situational_', '상황별 기록'), ('kbo_pinch_hit_', '대타 기록'), ('naver_advanced_', '세부 기록'), ('standings_', '팀 순위'), ('bears_roster', '선수단'), ('edu_roster_', '교육리그 선수단'), ('bears_career_', '선수 통산 기록'), ('bears_franchise_', '팀 통산 기록'), ('bearstat_awards_', '수상 기록'), ('hidden_auto_events', '일정 표시'), ('bearstat_player_visibility', '선수 표시')]
        return prefix + next((label for start, label in labels if key.startswith(start)), '기록 설정')
    date = str(row.get('date', ''))
    opp = str(body.get('opp') or '')
    game = table != 'events' or body.get('type') in ('kbo', 'futures', 'edu')
    title = ('두산 vs ' + opp) if game and opp else str(body.get('title') or ('경기' if game else '일정'))
    parts = []
    old = (before or {}).get('body') or {}
    old = old if isinstance(old, dict) else {}
    if before and game:
        for label, fields in [('경기 결과', ('score', 'status', 'result')), ('타자 기록', ('batting', 'hitters')), ('투수 기록', ('pitching', 'pitchers')), ('경기 세부 기록', ('kbo',))]:
            if any(notification_digest(body.get(k)) != notification_digest(old.get(k)) for k in fields):
                parts.append(label)
    return (date + ' ' + title + (' · ' + ', '.join(parts[:2]) if parts else '')).strip()[:160]


def record_notification_summary(root, old, records):
    previous = previous_notification_records(root, old)
    current = notification_index(records)
    prior = notification_index(previous) if previous is not None else None
    fingerprint = lambda index: notification_digest([[key, value[0]] for key, value in sorted(index.items())])
    changes = []
    if prior is not None:
        for key in sorted(set(current) | set(prior)):
            after = current.get(key)
            before = prior.get(key)
            if after and before and after[0] == before[0]:
                continue
            table = key.split(':', 1)[0]
            row = (after or before)[1]
            action = '추가' if before is None else '삭제' if after is None else '수정'
            changes.append(notification_label(table, row, before[1] if before else None) + ' ' + action)
        changes = sorted(set(changes), reverse=True)
    return {'schemaVersion': 1, 'fingerprint': fingerprint(current), 'previousFingerprint': fingerprint(prior) if prior is not None else None, 'total': len(changes), 'changes': changes[:8]}


def configuration(html):
    s = Path(html).read_text()
    get = lambda name: re.search(r'\b' + name + r'\s*=\s*[\'\"]([^\'\"]+)', s)[1]
    return os.getenv('SUPABASE_URL') or get('SUPABASE_URL'), os.getenv('SUPABASE_ANON_KEY') or get('SUPABASE_KEY')


class Download:
    """Minimal PostgREST reader that counts what it pulls from the project."""

    def __init__(self, url, key):
        self.url = url.rstrip('/')
        self.key = key
        self.bytes = 0
        self.requests = 0

    def page(self, table, params):
        req = urllib.request.Request(self.url + '/rest/v1/' + table + '?' + urlencode(params), headers={'apikey': self.key, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = response.read()
        self.bytes += len(payload)
        self.requests += 1
        rows = json.loads(payload)
        if not isinstance(rows, list):
            raise ValueError('Invalid public table response: ' + table)
        return rows

    def paged(self, table, columns, idkey, extra=None, page=PAGE):
        """Keyset paging by the id column: a row added mid-read cannot shift the pages."""
        rows = []
        params = {'select': columns, 'order': idkey + '.asc', 'limit': str(page), **(extra or {})}
        while True:
            if rows:
                params[idkey] = 'gt.' + str(rows[-1][idkey])
            part = self.page(table, params)
            rows.extend(part)
            if len(part) < page:
                return rows
            if len(rows) > 1000000:
                raise ValueError('Export exceeded row limit: ' + table)

    def ids(self, table, idkey):
        rows = self.paged(table, idkey, idkey, page=ID_PAGE)
        ids = [str(row[idkey]) for row in rows]
        if len(set(ids)) != len(ids):
            raise ValueError('Duplicate row ids: ' + table)
        return ids


def fetch_by_ids(dl, table, idkey, ids):
    rows = []
    for start in range(0, len(ids), ID_CHUNK):
        chunk = ids[start:start + ID_CHUNK]
        rows.extend(dl.page(table, {'select': COLUMNS[table], 'order': idkey + '.asc', 'limit': str(len(chunk) + 1), idkey: 'in.(' + ','.join(chunk) + ')'}))
    if len({str(row[idkey]) for row in rows}) != len(rows):
        raise ValueError('Duplicate row ids: ' + table)
    return rows


def table_rows(dl, table, idkey, old_rows, mode, cutoff, allow_shrink=False):
    """Read one table, fetching bodies only for rows that are new or inside the live window."""
    ids = dl.ids(table, idkey)
    old = {str(row[idkey]): row for row in (old_rows or [])}
    wanted = set(ids)
    if not ids:
        if old:
            raise ValueError('Refusing to publish an empty table over a nonempty archive: ' + table)
        return [], {'ids': 0, 'read': 0, 'kept': 0, 'removed': 0}
    gone = [key for key in old if key not in wanted]
    if gone and not allow_shrink and len(gone) > max(10, len(old) // 50):
        raise ValueError('Refusing to drop %d of %d archived rows (%s); use --allow-shrink after confirming the deletion.'
                         % (len(gone), len(old), table))
    kept = {} if mode == 'full' else {key: row for key, row in old.items() if key in wanted and str(row.get('date', '')) < cutoff}
    refresh = [key for key in ids if key not in kept]
    full_read = mode == 'full' or len(refresh) > max(200, len(ids) * 2 // 5) or not all(SAFE_ID.fullmatch(key) for key in refresh)
    read = dl.paged(table, COLUMNS[table], idkey) if full_read else fetch_by_ids(dl, table, idkey, refresh)
    fresh = {str(row[idkey]): row for row in read}
    rows, missing = [], []
    for key in ids:
        row = fresh.get(key) or kept.get(key)
        if row is None:
            missing.append(key)
        else:
            rows.append(row)
    if missing:
        raise ValueError('Export is missing rows the project still reports: %s %s' % (table, ','.join(missing[:5])))
    if any(not DATE.fullmatch(str(row.get('date', ''))) for row in rows):
        raise ValueError('Invalid date: ' + table)
    return rows, {'ids': len(ids), 'read': len(read), 'kept': len(kept), 'removed': len(gone)}


def kv_rows(dl, old_rows):
    """The kv table is small, so it is read whole on every run."""
    filters = '(' + ','.join('key.like.' + p if '%' in p else 'key.eq.' + p for p in PUBLIC_KEYS) + ')'
    rows = [row for row in dl.paged('kv', 'key,body', 'key', {'or': filters}) if public_key(row['key'])]
    if old_rows and not rows:
        raise ValueError('Refusing to overwrite a nonempty archive with an empty response: kv')
    return rows


def build_shards(records):
    tables, objects = {}, {}
    for table, rows in records.items():
        groups = {}
        for row in rows:
            groups.setdefault(str(row.get('date', 'metadata'))[:4] if table != 'kv' else 'metadata', []).append(row)
        shards = []
        for group, items in sorted(groups.items()):
            data = encode(items)
            digest = hashlib.sha256(data).hexdigest()
            name = table + '-' + group + '-' + digest[:16] + '.json'
            objects[name] = data
            dates = [row['date'] for row in items if 'date' in row]
            shards.append({'file': name, 'sha256': digest, 'count': len(items), 'minDate': min(dates) if dates else None, 'maxDate': max(dates) if dates else None})
        tables[table] = {'count': len(rows), 'shards': shards}
    return tables, objects


def build_schedules(records, today, generated_at):
    start = (today - datetime.timedelta(days=1)).isoformat()
    end = (today + datetime.timedelta(days=45)).isoformat()
    return {'schemaVersion': 1, 'generatedAt': generated_at,
            'events': [row['body'] for row in records['events'] if start <= row['date'] <= end],
            'automatic': [{**row['body'], 'date': row['date'], 'id': row['body'].get('id') or row['game_id'], 'kboGameId': row['body'].get('kboGameId') or row['game_id'], 'type': row['body'].get('type') or ('futures' if table == 'futures_game_records' else 'kbo')} for table in ['kbo_game_records', 'futures_game_records'] for row in records[table] if start <= row['date'] <= end],
            'hidden': next((row['body'] for row in records['kv'] if row['key'] == 'hidden_auto_events'), [])}


def write_atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    os.close(fd)
    Path(tmp).write_bytes(data)
    os.replace(tmp, path)


def prune_stale(root, keep):
    """Remove shards this exporter wrote earlier that the new manifest no longer lists."""
    removed, freed = [], 0
    for path in sorted(root.iterdir()):
        if path.is_file() and SHARD_NAME.fullmatch(path.name) and path.name not in keep:
            freed += path.stat().st_size
            path.unlink()
            removed.append(path.name)
    return removed, freed


def timestamp(value):
    try:
        return datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def export(html, destination, full=False, today=None, allow_shrink=False, keep_stale=False, now=None):
    url, key = configuration(html)
    root = Path(destination)
    root.mkdir(parents=True, exist_ok=True)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    today = today or (now + datetime.timedelta(hours=9)).date()
    old = json.loads((root / 'manifest.json').read_text()) if (root / 'manifest.json').exists() else None
    old_rows = None
    if old:
        try:
            old_rows = previous_notification_records(root, old)
        except Exception as error:
            print('Previous archive could not be verified; reading everything again:', type(error).__name__)
            old = old_rows = None
    last_full = timestamp((old or {}).get('refresh', {}).get('lastFullRefresh')) or timestamp((old or {}).get('generatedAt'))
    mode = 'full' if full or not old or last_full is None or now - last_full > datetime.timedelta(days=RECONCILE_DAYS) else 'incremental'
    cutoff = (today - datetime.timedelta(days=LIVE_DAYS)).isoformat()
    dl = Download(url, key)
    records, stats = {}, {}
    for table, idkey in TABLES.items():
        rows, stats[table] = table_rows(dl, table, idkey, (old_rows or {}).get(table), mode, cutoff, allow_shrink)
        records[table] = rows
        print('%s: %d rows, read %d bodies, kept %d from the last archive%s' % (table, stats[table]['ids'], stats[table]['read'], stats[table]['kept'], ', %d removed' % stats[table]['removed'] if stats[table]['removed'] else ''))
    records['kv'] = kv_rows(dl, (old_rows or {}).get('kv'))
    print('kv: %d rows' % len(records['kv']))
    notification = record_notification_summary(root, old, records)
    # Fetch everything before publishing anything; a failed query never replaces the last good manifest.
    tables, objects = build_shards(records)
    manifest = {'schemaVersion': 1, 'project': url, 'tables': tables, 'recordNotifications': notification,
                'refresh': {'mode': mode, 'lastFullRefresh': (now if mode == 'full' else last_full).isoformat(), 'liveDays': LIVE_DAYS, 'reconcileDays': RECONCILE_DAYS},
                'generatedAt': now.isoformat()}
    schedules = build_schedules(records, today, manifest['generatedAt'])
    for name, data in objects.items():
        if not (root / name).exists():
            (root / name).write_bytes(data)
    write_atomic(root / 'schedules.json', encode(schedules))
    write_atomic(root / 'manifest.json', encode(manifest))
    pruned, freed = ([], 0) if keep_stale else prune_stale(root, set(objects))
    print('Published archive: %d shards, %d bytes; read %.1f MB in %d requests from Supabase (%s).'
          % (len(objects), sum(map(len, objects.values())), dl.bytes / 1048576, dl.requests, mode))
    if pruned:
        print('Removed %d stale shard files (%.1f MB) no longer listed in the manifest.' % (len(pruned), freed / 1048576))
    return {'mode': mode, 'bytes': dl.bytes, 'requests': dl.requests, 'tables': stats, 'kv': len(records['kv']), 'pruned': pruned}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', default='index.html')
    parser.add_argument('--output', default='data')
    parser.add_argument('--full', action='store_true', help='re-read every row of every table')
    parser.add_argument('--today', help='YYYY-MM-DD used for the live window (defaults to today in Asia/Seoul)')
    parser.add_argument('--allow-shrink', action='store_true', help='accept a large drop in archived rows')
    parser.add_argument('--keep-stale-shards', action='store_true', help='leave shard files the manifest no longer lists on disk')
    args = parser.parse_args()
    force = args.full or os.getenv('BEARSTAT_FORCE_FULL', '').strip().lower() in ('1', 'true', 'yes')
    try:
        export(args.html, args.output, full=force, today=datetime.date.fromisoformat(args.today) if args.today else None,
               allow_shrink=args.allow_shrink, keep_stale=args.keep_stale_shards)
    except Exception as e:
        raise SystemExit('Public export failed; last good archive preserved. ' + type(e).__name__ + ': ' + str(e)[:200])
