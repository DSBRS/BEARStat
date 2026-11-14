import datetime
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('public_export', REPO / 'scripts/export-public-records.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

NOW = datetime.datetime(2026, 11, 14, 7, 0, tzinfo=datetime.timezone.utc)
TODAY = datetime.date(2026, 11, 14)


def project_data():
    """A miniature Supabase project: two live rows, everything else old history."""
    events = [{'id': 'e%04d' % i, 'date': '2015-%02d-01' % (i % 12 + 1), 'body': {'type': 'kbo', 'opp': 'LG', 'score': {'v': 1, 'd': 2}}} for i in range(24)]
    events.append({'id': 'e9001', 'date': '2026-11-10', 'body': {'type': 'kbo', 'opp': 'NC', 'score': {'v': 3, 'd': 5}, 'status': 'final'}})
    games = [{'game_id': '2020%03d' % i, 'date': '2020-05-%02d' % (i + 1), 'body': {'id': '2020%03d' % i, 'kbo': {'etc': {'홈런': '정수빈(5회)' * 20}}, 'boxscore': {'rows': ['x' * 300] * 4}}} for i in range(24)]
    games.append({'game_id': 'g9001', 'date': '2026-11-11', 'body': {'id': 'g9001', 'kbo': {'etc': {'홈런': '양석환(3회)'}}, 'boxscore': {'rows': ['y' * 300]}}})
    futures = [{'game_id': 'f%03d' % i, 'date': '2024-06-%02d' % (i + 1), 'body': {'id': 'f%03d' % i, 'score': {'v': 2, 'd': 4}}} for i in range(4)]
    kv = [{'key': 'bears_career_hitter_' + name, 'body': {'name': name, 'baseline': {'g': i}}} for i, name in enumerate(['강규철', '강동연', '박건우'])]
    kv += [{'key': 'hidden_auto_events', 'body': []}, {'key': 'bearstat_awards_v1', 'body': {'awards': []}}, {'key': 'admin_only_secret', 'body': {'x': 1}}]
    return {'events': events, 'kbo_game_records': games, 'futures_game_records': futures, 'kv': kv}


class FakeProject:
    def __init__(self, tables=None):
        self.tables = tables or project_data()
        self.status = None
        self.drop_body_ids = set()
        self.bytes = 0
        self.log = []

    def reset_log(self):
        self.bytes = 0
        self.log = []

    @staticmethod
    def _matches(row, key, value):
        if value.startswith('in.('):
            return str(row.get(key)) in value[4:-1].split(',')
        if value.startswith('gt.'):
            return str(row.get(key, '')) > value[3:]
        if value.startswith('gte.'):
            return str(row.get(key, '')) >= value[4:]
        if value.startswith('lte.'):
            return str(row.get(key, '')) <= value[4:]
        if value.startswith('eq.'):
            return str(row.get(key)) == value[3:]
        raise AssertionError('unsupported filter ' + value)

    @classmethod
    def _matches_or(cls, row, spec):
        for part in spec.strip('()').split(','):
            if part.startswith('key.like.'):
                pattern = part[len('key.like.'):]
                if re.fullmatch(re.escape(pattern).replace('%', '.*'), str(row.get('key'))):
                    return True
            elif part.startswith('key.eq.') and str(row.get('key')) == part[len('key.eq.'):]:
                return True
        return False

    def rows(self, table, params):
        rows = [dict(row) for row in self.tables[table]]
        for key in ('id', 'game_id', 'key', 'date'):
            if key in params:
                rows = [row for row in rows if self._matches(row, key, params[key])]
        if 'or' in params:
            rows = [row for row in rows if self._matches_or(row, params['or'])]
        if table != 'kv' and 'body' in params.get('select', '') and self.drop_body_ids:
            rows = [row for row in rows if str(row.get('id') or row.get('game_id')) not in self.drop_body_ids]
        order = params.get('order', '')
        if order:
            column, _, direction = order.partition('.')
            rows.sort(key=lambda row: str(row.get(column, '')), reverse=direction == 'desc')
        offset = int(params.get('offset', 0) or 0)
        limit = int(params['limit']) if 'limit' in params else len(rows)
        rows = rows[offset:offset + limit]
        columns = params.get('select', '*').split(',')
        if columns != ['*']:
            rows = [{column: row[column] for column in columns if column in row} for row in rows]
        return rows


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        project = self.server.project
        url = urlparse(self.path)
        table = url.path.rsplit('/rest/v1/', 1)[-1]
        params = {key: values[0] for key, values in parse_qs(url.query, keep_blank_values=True).items()}
        project.log.append((table, params))
        if project.status:
            payload = json.dumps({'message': 'Service for this project is restricted due to the following violations: exceed_egress_quota.'}).encode()
            status = project.status
        else:
            payload = json.dumps(project.rows(table, params), ensure_ascii=False).encode()
            status = 200
        project.bytes += len(payload)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.project = FakeProject()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.project = self.project
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__('shutil').rmtree(self.tmp, ignore_errors=True))
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.html = self.tmp / 'index.html'
        self.html.write_text('const SUPABASE_URL="%s",SUPABASE_KEY="anon";\n' % self.url)
        self.out = self.tmp / 'data'
        self.environ = {key: os.environ.pop(key, None) for key in ('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'BEARSTAT_FORCE_FULL')}
        self.addCleanup(self.restore_env)

    def restore_env(self):
        for key, value in self.environ.items():
            if value is not None:
                os.environ[key] = value

    def run_export(self, **kwargs):
        kwargs.setdefault('now', NOW)
        kwargs.setdefault('today', TODAY)
        self.project.reset_log()
        return module.export(self.html, self.out, **kwargs)

    def manifest(self):
        return json.loads((self.out / 'manifest.json').read_text())

    def rows(self, table):
        rows = []
        for shard in self.manifest()['tables'][table]['shards']:
            rows.extend(json.loads((self.out / shard['file']).read_text()))
        return rows

    def snapshot(self):
        return {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in self.out.iterdir() if path.is_file()}

    def test_first_run_reads_everything_and_publishes(self):
        result = self.run_export()
        self.assertEqual(result['mode'], 'full')
        manifest = self.manifest()
        self.assertEqual(manifest['schemaVersion'], 1)
        self.assertEqual(manifest['tables']['events']['count'], 25)
        self.assertEqual(manifest['tables']['kbo_game_records']['count'], 25)
        self.assertEqual(manifest['tables']['futures_game_records']['count'], 4)
        self.assertEqual(manifest['tables']['kv']['count'], 5)
        self.assertEqual(manifest['refresh']['mode'], 'full')
        self.assertNotIn('admin_only_secret', [row['key'] for row in self.rows('kv')])
        self.assertTrue((self.out / 'schedules.json').exists())
        self.assertEqual(json.loads((self.out / 'schedules.json').read_text())['schemaVersion'], 1)

    def test_second_run_reads_only_ids_and_the_live_window(self):
        first = self.run_export()
        second = self.run_export(now=NOW + datetime.timedelta(days=1), today=TODAY + datetime.timedelta(days=1))
        self.assertEqual(second['mode'], 'incremental')
        self.assertEqual(second['tables']['events']['read'], 1)
        self.assertEqual(second['tables']['events']['kept'], 24)
        self.assertEqual(second['tables']['kbo_game_records']['read'], 1)
        self.assertEqual(second['tables']['futures_game_records']['read'], 0)
        self.assertLess(second['bytes'], first['bytes'] / 5)
        self.assertEqual(self.manifest()['tables']['kbo_game_records']['shards'], json.loads((self.out / 'manifest.json').read_text())['tables']['kbo_game_records']['shards'])

    def test_body_select_is_never_requested_for_old_rows_incremental_run(self):
        self.run_export()
        self.run_export(now=NOW + datetime.timedelta(days=1))
        body_requests = [params for _, params in self.project.log if 'body' in params.get('select', '') and 'in.(' not in params.get('id', '')]
        self.assertEqual([params for params in body_requests if params.get('select', '').startswith('id,date,body')], [])

    def test_edited_live_row_is_picked_up_with_one_notification(self):
        self.run_export()
        for row in self.project.tables['kbo_game_records']:
            if row['game_id'] == 'g9001':
                row['body']['score'] = {'v': 7, 'd': 2}
                row['body']['status'] = 'final'
        self.run_export(now=NOW + datetime.timedelta(days=1), today=TODAY + datetime.timedelta(days=1))
        archived = {row['game_id']: row for row in self.rows('kbo_game_records')}
        self.assertEqual(archived['g9001']['body']['score'], {'v': 7, 'd': 2})
        notification = self.manifest()['recordNotifications']
        self.assertEqual(notification['total'], 1)
        self.assertTrue(notification['changes'][0].endswith('수정'))

    def test_edit_to_an_old_row_waits_for_the_periodic_full_refresh(self):
        self.run_export()
        for row in self.project.tables['events']:
            if row['id'] == 'e0003':
                row['body']['opp'] = 'KIA'
        self.run_export(now=NOW + datetime.timedelta(days=1), today=TODAY + datetime.timedelta(days=1))
        self.assertEqual({row['id']: row for row in self.rows('events')}['e0003']['body']['opp'], 'LG')
        later = self.run_export(now=NOW + datetime.timedelta(days=module.RECONCILE_DAYS + 1), today=TODAY + datetime.timedelta(days=module.RECONCILE_DAYS + 1))
        self.assertEqual(later['mode'], 'full')
        self.assertEqual({row['id']: row for row in self.rows('events')}['e0003']['body']['opp'], 'KIA')

    def test_forced_full_read(self):
        self.run_export()
        forced = self.run_export(full=True, now=NOW + datetime.timedelta(hours=1))
        self.assertEqual(forced['mode'], 'full')
        self.assertEqual(forced['tables']['kbo_game_records']['kept'], 0)

    def test_new_row_is_fetched_on_its_own(self):
        self.run_export()
        self.project.tables['events'].append({'id': 'e9100', 'date': '2026-11-13', 'body': {'type': 'kbo', 'opp': 'SSG', 'score': {'v': 2, 'd': 1}}})
        result = self.run_export(now=NOW + datetime.timedelta(days=1), today=TODAY + datetime.timedelta(days=1))
        self.assertEqual(result['tables']['events']['read'], 2)
        self.assertEqual(len(self.rows('events')), 26)
        self.assertEqual(self.manifest()['recordNotifications']['total'], 1)

    def test_quota_block_keeps_the_last_good_archive(self):
        self.run_export()
        before = self.snapshot()
        self.project.status = 402
        with self.assertRaises(Exception):
            self.run_export(now=NOW + datetime.timedelta(days=1))
        self.assertEqual(self.snapshot(), before)

    def test_cli_reports_failure_and_leaves_archive_alone(self):
        self.run_export()
        before = self.snapshot()
        self.project.status = 402
        environment = dict(os.environ, SUPABASE_URL=self.url, SUPABASE_ANON_KEY='anon')
        completed = subprocess.run([sys.executable, str(REPO / 'scripts/export-public-records.py'), '--html', str(self.html), '--output', str(self.out)],
                                   capture_output=True, text=True, env=environment, cwd=str(REPO))
        self.assertEqual(completed.returncode, 1)
        self.assertIn('last good archive preserved', completed.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_empty_response_never_overwrites_a_nonempty_archive(self):
        self.run_export()
        before = self.snapshot()
        self.project.tables['events'] = []
        with self.assertRaises(ValueError):
            self.run_export(now=NOW + datetime.timedelta(days=1))
        self.assertEqual(self.snapshot(), before)

    def test_missing_row_is_refused(self):
        self.project.drop_body_ids = {'e0002'}
        with self.assertRaises(ValueError):
            self.run_export()
        self.assertFalse((self.out / 'manifest.json').exists())

    def test_large_shrink_needs_explicit_permission(self):
        self.run_export()
        self.project.tables['events'] = [row for row in self.project.tables['events'] if row['id'] >= 'e0015']
        with self.assertRaises(ValueError):
            self.run_export(now=NOW + datetime.timedelta(days=1))
        result = self.run_export(allow_shrink=True, now=NOW + datetime.timedelta(days=1))
        self.assertGreater(result['tables']['events']['removed'], 10)
        self.assertEqual(self.manifest()['tables']['events']['count'], len(self.project.tables['events']))

    def test_stale_shards_are_pruned_and_foreign_files_kept(self):
        self.run_export()
        stale = self.out / 'kv-metadata-0123456789abcdef.json'
        stale.write_bytes(b'[]')
        foreign = self.out / 'kbo-relay-2020.json'
        foreign.write_bytes(b'{}')
        self.run_export(now=NOW + datetime.timedelta(days=1))
        self.assertFalse(stale.exists())
        self.assertTrue(foreign.exists())
        self.assertTrue(set(self.snapshot()) >= {shard['file'] for table in self.manifest()['tables'].values() for shard in table['shards']})

    def test_keep_stale_shards_option(self):
        self.run_export()
        stale = self.out / 'events-2015-fedcba9876543210.json'
        stale.write_bytes(b'[]')
        self.run_export(keep_stale=True, now=NOW + datetime.timedelta(days=1))
        self.assertTrue(stale.exists())

    def test_invalid_date_is_refused(self):
        self.project.tables['events'][0]['date'] = '2015-1-1'
        with self.assertRaises(ValueError):
            self.run_export()

    def test_corrupt_previous_archive_falls_back_to_a_full_read(self):
        self.run_export()
        shard = self.out / self.manifest()['tables']['events']['shards'][0]['file']
        shard.write_bytes(b'[]')
        result = self.run_export(now=NOW + datetime.timedelta(days=1))
        self.assertEqual(result['mode'], 'full')
        self.assertEqual(self.manifest()['tables']['events']['count'], 25)


if __name__ == '__main__':
    unittest.main()
