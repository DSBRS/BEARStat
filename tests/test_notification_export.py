import datetime as dt
import importlib.util
import json
import re
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('notification_export',Path(__file__).parents[1]/'scripts/export-notification-events.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ROOT=Path(__file__).parents[1]

def birthday_html(players):
 return 'const HANDBALL_AUTO=[]; const NATIONAL_TEAM_GAMES=[]; const CLUB_EVENTS=[]; const BEARS_HARU_BIRTHDAYS='+json.dumps(players,ensure_ascii=False)+';'

def birthday_events(players,today):
 return [e for e in module.notification_events(birthday_html(players),dt.date.fromisoformat(today))['events'] if e['type']=='birthday']

class NotificationExportTests(unittest.TestCase):
 def test_static_national_and_handball_are_both_exported(self):
  html=ROOT.joinpath('index.html').read_text()
  value=module.notification_events(html)
  source=module.array_literal(html,'NATIONAL_TEAM_GAMES')
  expected={e['id']:e for e in source if e.get('time')}
  actual={e['id']:e for e in value['events'] if e['type']=='national'}
  self.assertTrue(expected)
  self.assertEqual(actual,expected)
  self.assertTrue(any(e['type']=='handball' for e in value['events']))
 def test_js_literals_and_punctuation_in_titles(self):
  html='''const HANDBALL_AUTO=[{id:'a',type:'handball',title:'quote \\' and comma,]',date:'2026-12-01',time:'17:00',players:[],},]; const NATIONAL_TEAM_GAMES=[]; const CLUB_EVENTS=[]; const BEARS_HARU_BIRTHDAYS=[];'''
  self.assertEqual(module.notification_events(html,dt.date(2026,11,17))['events'][0]['title'],"quote ' and comma,]")
 def test_untimed_history_stays_out_of_push_feed(self):
  html='const HANDBALL_AUTO=[]; const NATIONAL_TEAM_GAMES='+json.dumps([{'id':'history','type':'national','date':'2006-03-03','time':''}])+'; const CLUB_EVENTS=[]; const BEARS_HARU_BIRTHDAYS=[];'
  self.assertEqual(module.notification_events(html,dt.date(2026,11,17))['events'],[])
 def test_executable_source_is_never_evaluated(self):
  with self.assertRaises(ValueError):module.array_literal('const NATIONAL_TEAM_GAMES=[fetch("http://example.invalid")];','NATIONAL_TEAM_GAMES')
 def test_duplicate_ids_fail_instead_of_silently_overwriting(self):
  e={'id':'same','type':'national','date':'2026-11-10','time':'09:30'}
  with self.assertRaises(ValueError):module.notification_events('const HANDBALL_AUTO=[]; const NATIONAL_TEAM_GAMES='+json.dumps([e,e])+'; const CLUB_EVENTS=[]; const BEARS_HARU_BIRTHDAYS=[];',dt.date(2026,11,17))
 def test_builtin_club_and_ticket_events_are_exported(self):
  html=ROOT.joinpath('index.html').read_text()
  source=module.array_literal(html,'CLUB_EVENTS')
  expected={e['id']:e for e in source if e.get('time')}
  actual={e['id']:e for e in module.notification_events(html)['events'] if e['type'] in ('club','fan','ticket','broadcast','radio','etc')}
  self.assertTrue(expected)
  self.assertEqual(actual,expected)
  bears={e['date']:e for e in source}
  self.assertEqual(bears['2026-11-21']['type'],'ticket')
  self.assertEqual(bears['2026-11-28']['type'],'club')
  self.assertEqual(bears['2026-11-28']['time'],'11:00')
 def test_unexpected_type_in_the_club_schedule_fails(self):
  with self.assertRaises(ValueError):module.notification_events("const HANDBALL_AUTO=[]; const NATIONAL_TEAM_GAMES=[]; const CLUB_EVENTS=[{id:'x',type:'kbo',date:'2026-11-21',time:'11:00'}]; const BEARS_HARU_BIRTHDAYS=[];",dt.date(2026,11,17))
 def test_birthday_events_are_push_ready(self):
  players=[{'n':'가선수','b':'1990-11-20','y':[2026],'id':'1'}]
  events=birthday_events(players,'2026-11-17')
  self.assertEqual([e['date'] for e in events],['2026-11-20','2027-11-20'])
  event=events[0]
  self.assertEqual(event['id'],'birthday-2026-11-20')
  self.assertEqual(event['time'],'00:00')
  self.assertEqual(event['title'],'가선수 선수 생일')
  self.assertEqual(event['players'],['가선수'])
  self.assertEqual(event['notificationCategory'],'birthday')
  self.assertIsNotNone(module.TIME.fullmatch(event['time']))
 def test_birthday_window_covers_this_month_through_next_year_december(self):
  players=[{'n':'가선수','b':'1990-10-05','y':[2026],'id':'1'},{'n':'나선수','b':'1990-12-31','y':[2026],'id':'2'},{'n':'다선수','b':'1990-02-01','y':[2026],'id':'3'},{'n':'라선수','b':'1990-03-01','y':[2026],'id':'4'}]
  self.assertEqual([e['date'] for e in birthday_events(players,'2026-11-17')],['2026-12-31','2027-02-01','2027-03-01','2027-10-05','2027-12-31'])
 def test_window_ends_with_next_year(self):
  players=[{'n':'가선수','b':'1990-12-20','y':[2026],'id':'1'}]
  self.assertEqual([e['date'] for e in birthday_events(players,'2026-11-17')],['2026-12-20','2027-12-20'])
  # The month of the export start is dropped, and 2028 is past the roster gap.
  self.assertEqual([e['date'] for e in birthday_events(players,'2027-12-01')],['2027-12-20'])
  self.assertEqual(birthday_events(players,'2028-01-01'),[])
 def test_next_season_birthday_uses_the_latest_recorded_roster(self):
  players=[{'n':'가선수','b':'1990-01-10','y':[2026],'id':'1'}]
  self.assertEqual([e['date'] for e in birthday_events(players,'2026-11-17')],['2027-01-10'])
 def test_stale_roster_data_does_not_invent_a_birthday(self):
  players=[{'n':'가선수','b':'1990-01-10','y':[1995],'id':'1'}]
  self.assertEqual(birthday_events(players,'2026-11-17'),[])
 def test_players_on_the_same_day_share_one_event(self):
  players=[{'n':'가선수','b':'1990-11-20','y':[2026],'id':'1'},{'n':'나선수','b':'1991-11-20','y':[2026],'id':'2'},{'n':'가선수','b':'1992-11-20','y':[2026],'id':'3'}]
  events=birthday_events(players,'2026-11-17')
  self.assertEqual([e['date'] for e in events],['2026-11-20','2027-11-20'])
  self.assertEqual(events[0]['players'],['가선수','나선수'])
  self.assertEqual(events[0]['title'],'가선수 · 나선수 선수 생일')
 def test_february_29_is_skipped_in_a_common_year(self):
  players=[{'n':'가선수','b':'1992-02-29','y':[2026],'id':'1'}]
  self.assertEqual(birthday_events(players,'2027-01-15'),[])
 def test_birthday_entry_without_a_birth_date_fails(self):
  with self.assertRaises(ValueError):birthday_events([{'n':'가선수','b':'','y':[2026],'id':'1'}],'2026-11-17')
 def test_worker_and_site_know_the_same_categories(self):
  worker=(ROOT/'bearstat-cloudflare-worker.js').read_text()
  html=(ROOT/'index.html').read_text()
  keys=re.search(r"const NOTIFICATION_KEYS=\[([^\]]*)\]",worker).group(1)
  server=[k.strip().strip("'") for k in keys.split(',')]
  groups=html[html.index('const PUSH_CATEGORY_GROUPS=['):html.index('const PUSH_CATEGORY_KEYS=')]
  site=[key for key in server if re.search(r"\['" + key + r"',",groups)]
  self.assertEqual(site,server)
  self.assertIn("birthday:'생일'",worker)
  self.assertIn('birthday',server)

if __name__=='__main__':unittest.main()
