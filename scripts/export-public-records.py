#!/usr/bin/env python3
"""Read-only export of existing public BEARStat rows. Never deletes source rows."""
import argparse, datetime, hashlib, json, os, re, tempfile, urllib.request
from pathlib import Path
TABLES={'events':('id','id,date,body'),'kbo_game_records':('game_id','game_id,date,body'),'futures_game_records':('game_id','game_id,date,body')}
PUBLIC_KEYS=['bears_career_%','bears_franchise_%','bears_roster%','edu_roster_%','standings_others%','standings_auto_%','standings_official_%','kbo_situational_%','kbo_pinch_hit_%','naver_advanced_%','futures_sync_%','bearstat_player_visibility_v1','hidden_auto_events','kbo_history_sync','bearstat_awards_v1']
def public_key(k):
 return any(re.fullmatch(re.escape(p).replace('%','.*'),k) for p in PUBLIC_KEYS)
def encode(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
VOLATILE_KEYS={'fetchedAt','updatedAt','generatedAt','syncedAt','lastSyncedAt','lastFetchedAt','lastCheckedAt','checkedAt','collectedAt','parserVersion'}
def notification_content(value):
 if isinstance(value,dict):return {k:notification_content(v) for k,v in sorted(value.items()) if k not in VOLATILE_KEYS}
 if isinstance(value,list):return [notification_content(v) for v in value]
 return value
def notification_digest(value):return hashlib.sha256(encode(notification_content(value))).hexdigest()
def notification_index(records):
 index={}
 for table,rows in records.items():
  for row in rows:
   key=str(row.get('key') if table=='kv' else row.get('id') if table=='events' else row.get('game_id'))
   if table=='kv' and (key.startswith(('futures_sync_','kbo_history_sync'))):continue
   index[table+':'+key]=(notification_digest(row),row)
 return index
def previous_notification_records(root,manifest):
 if not manifest:return None
 records={}
 for table,meta in manifest['tables'].items():
  rows=[]
  for shard in meta['shards']:
   name=shard['file']
   if Path(name).name!=name:raise ValueError('Invalid archive shard path')
   data=(root/name).read_bytes()
   if hashlib.sha256(data).hexdigest()!=shard['sha256']:raise ValueError('Invalid previous archive shard')
   rows.extend(json.loads(data))
  records[table]=rows
 return records
def notification_label(table,row,before=None):
 body=row.get('body') or {};body=body if isinstance(body,dict) else {}
 if table=='kv':
  key=row['key'];year=re.search(r'(?:19|20)\d{2}',key);prefix=(year[0]+'년 ') if year else ''
  labels=[('kbo_situational_','상황별 기록'),('kbo_pinch_hit_','대타 기록'),('naver_advanced_','세부 기록'),('standings_','팀 순위'),('bears_roster','선수단'),('edu_roster_','교육리그 선수단'),('bears_career_','선수 통산 기록'),('bears_franchise_','팀 통산 기록'),('bearstat_awards_','수상 기록'),('hidden_auto_events','일정 표시'),('bearstat_player_visibility','선수 표시')]
  return prefix+next((label for start,label in labels if key.startswith(start)),'기록 설정')
 date=str(row.get('date',''));opp=str(body.get('opp') or '')
 game=table!='events' or body.get('type') in ('kbo','futures','edu')
 title=('두산 vs '+opp) if game and opp else str(body.get('title') or ('경기' if game else '일정'))
 parts=[];old=(before or {}).get('body') or {};old=old if isinstance(old,dict) else {}
 if before and game:
  for label,fields in [('경기 결과',('score','status','result')),('타자 기록',('batting','hitters')),('투수 기록',('pitching','pitchers')),('경기 세부 기록',('kbo',))]:
   if any(notification_digest(body.get(k))!=notification_digest(old.get(k)) for k in fields):parts.append(label)
 return (date+' '+title+(' · '+', '.join(parts[:2]) if parts else '')).strip()[:160]
def record_notification_summary(root,old,records):
 previous=previous_notification_records(root,old);current=notification_index(records);prior=notification_index(previous) if previous is not None else None
 fingerprint=lambda index:notification_digest([[key,value[0]] for key,value in sorted(index.items())])
 changes=[]
 if prior is not None:
  for key in sorted(set(current)|set(prior)):
   after=current.get(key);before=prior.get(key)
   if after and before and after[0]==before[0]:continue
   table=key.split(':',1)[0];row=(after or before)[1]
   action='추가' if before is None else '삭제' if after is None else '수정'
   changes.append(notification_label(table,row,before[1] if before else None)+' '+action)
  changes=sorted(set(changes),reverse=True)
 return {'schemaVersion':1,'fingerprint':fingerprint(current),'previousFingerprint':fingerprint(prior) if prior is not None else None,'total':len(changes),'changes':changes[:8]}
def configuration(html):
 s=Path(html).read_text();get=lambda name:re.search(r'\b'+name+r'\s*=\s*[\'\"]([^\'\"]+)',s)[1]
 return os.getenv('SUPABASE_URL') or get('SUPABASE_URL'),os.getenv('SUPABASE_ANON_KEY') or get('SUPABASE_KEY')
def get_rows(url,key,table,columns,order,extra=None):
 from urllib.parse import urlencode
 rows=[]
 for start in range(0,1000000,500):
  q={'select':columns,'order':order+'.asc','limit':'500','offset':str(start),**(extra or {})}
  req=urllib.request.Request(url.rstrip('/')+'/rest/v1/'+table+'?'+urlencode(q),headers={'apikey':key,'Accept':'application/json'})
  with urllib.request.urlopen(req,timeout=60) as response:part=json.load(response)
  if not isinstance(part,list):raise ValueError('Invalid public table response: '+table)
  rows.extend(part)
  if len(part)<500:return rows
 raise ValueError('Export exceeded row limit')
def export(html,destination):
 url,key=configuration(html);root=Path(destination);root.mkdir(parents=True,exist_ok=True)
 old=json.loads((root/'manifest.json').read_text()) if (root/'manifest.json').exists() else None
 records={}
 for table,(idkey,columns) in TABLES.items():
  rows=get_rows(url,key,table,columns,idkey)
  if old and old['tables'].get(table,{}).get('count',0)>0 and not rows:raise ValueError('Refusing to overwrite a nonempty archive with an empty response: '+table)
  if len({r[idkey] for r in rows})!=len(rows):raise ValueError('Duplicate row ids: '+table)
  if any(not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(r.get('date',''))) for r in rows):raise ValueError('Invalid date: '+table)
  records[table]=rows
  print(table,len(rows),'rows')
 filters='('+','.join('key.like.'+p if '%' in p else 'key.eq.'+p for p in PUBLIC_KEYS)+')'
 records['kv']=[r for r in get_rows(url,key,'kv','key,body','key',{'or':filters}) if public_key(r['key'])]
 notification=record_notification_summary(root,old,records)
 # Fetch everything before publishing anything; a failed query never replaces the last good manifest.
 tables={};objects={}
 for table,rows in records.items():
  groups={}
  for row in rows:groups.setdefault(str(row.get('date','metadata'))[:4] if table!='kv' else 'metadata',[]).append(row)
  shards=[]
  for group,items in sorted(groups.items()):
   data=encode(items);digest=hashlib.sha256(data).hexdigest();name=table+'-'+group+'-'+digest[:16]+'.json';objects[name]=data
   dates=[r['date'] for r in items if 'date'in r]
   shards.append({'file':name,'sha256':digest,'count':len(items),'minDate':min(dates) if dates else None,'maxDate':max(dates) if dates else None})
  tables[table]={'count':len(rows),'shards':shards}
 manifest={'schemaVersion':1,'project':url,'tables':tables,'recordNotifications':notification}
 # Refresh the small rolling schedule even when the underlying rows did not change.
 manifest['generatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 for name,data in objects.items():
  if not (root/name).exists():(root/name).write_bytes(data)
 # A small near-term schedule file is also usable by the independent notification server.
 today=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=9)).date();end=(today+datetime.timedelta(days=45)).isoformat();start=(today-datetime.timedelta(days=1)).isoformat()
 schedules={'schemaVersion':1,'generatedAt':manifest['generatedAt'],'events':[r['body'] for r in records['events'] if start<=r['date']<=end], 'automatic':[{**r['body'],'date':r['date'],'id':r['body'].get('id') or r['game_id'],'kboGameId':r['body'].get('kboGameId') or r['game_id'],'type':r['body'].get('type') or ('futures' if table=='futures_game_records' else 'kbo')} for table in ['kbo_game_records','futures_game_records'] for r in records[table] if start<=r['date']<=end], 'hidden':next((r['body'] for r in records['kv'] if r['key']=='hidden_auto_events'),[])}
 for name,data in [('schedules.json',encode(schedules)),('manifest.json',encode(manifest))]:
  fd,tmp=tempfile.mkstemp(dir=root);os.close(fd);Path(tmp).write_bytes(data);os.replace(tmp,root/name)
 print('Published archive:',sum(map(len,objects.values())),'bytes')
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--html',default='index.html');a.add_argument('--output',default='data');args=a.parse_args()
 try:export(args.html,args.output)
 except Exception as e:raise SystemExit('Public export failed; last good archive preserved. '+type(e).__name__)
