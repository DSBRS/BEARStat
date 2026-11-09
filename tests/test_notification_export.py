import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('notification_export',Path(__file__).parents[1]/'scripts/export-notification-events.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class NotificationExportTests(unittest.TestCase):
 def test_static_national_and_handball_are_both_exported(self):
  html=Path(__file__).parents[1].joinpath('index.html').read_text()
  value=module.notification_events(html)
  source=module.array_literal(html,'NATIONAL_TEAM_GAMES')
  expected={e['id']:e for e in source if e.get('time')}
  actual={e['id']:e for e in value['events'] if e['type']=='national'}
  self.assertTrue(expected)
  self.assertEqual(actual,expected)
  self.assertTrue(any(e['type']=='handball' for e in value['events']))
 def test_js_literals_and_punctuation_in_titles(self):
  html='''const HANDBALL_AUTO=[{id:'a',type:'handball',title:'quote \\' and comma,]',date:'2026-12-01',time:'17:00',players:[],},]; const NATIONAL_TEAM_GAMES=[];'''
  self.assertEqual(module.notification_events(html)['events'][0]['title'],"quote ' and comma,]")
 def test_untimed_history_stays_out_of_push_feed(self):
  html='const HANDBALL_AUTO=[]; const NATIONAL_TEAM_GAMES='+json.dumps([{'id':'history','type':'national','date':'2006-03-03','time':''}])+';'
  self.assertEqual(module.notification_events(html)['events'],[])
 def test_executable_source_is_never_evaluated(self):
  with self.assertRaises(ValueError):module.array_literal('const NATIONAL_TEAM_GAMES=[fetch("http://example.invalid")];','NATIONAL_TEAM_GAMES')
 def test_duplicate_ids_fail_instead_of_silently_overwriting(self):
  e={'id':'same','type':'national','date':'2026-11-10','time':'09:30'}
  with self.assertRaises(ValueError):module.notification_events('const HANDBALL_AUTO=[]; const NATIONAL_TEAM_GAMES='+json.dumps([e,e])+';')

if __name__=='__main__':unittest.main()
