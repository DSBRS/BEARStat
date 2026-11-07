var G="https://dsbrs.github.io/BEARStat/",$=`CREATE TABLE IF NOT EXISTS subscription_preferences (endpoint_hash TEXT PRIMARY KEY, record_updates INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS record_publications (fingerprint TEXT PRIMARY KEY, published_at TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS record_publication_details (fingerprint TEXT PRIMARY KEY, payload_json TEXT NOT NULL);`;async function v(t,e){return(await t.DB.prepare("SELECT record_updates FROM subscription_preferences WHERE endpoint_hash=?").bind(e).first())?.record_updates!==0}async function k(t,e,r){await t.DB.prepare("INSERT INTO subscription_preferences(endpoint_hash,record_updates) VALUES(?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET record_updates=excluded.record_updates").bind(e,r?1:0).run()}async function X(t,{setting:e,putSetting:r,hash:a},o=Date.now()){
 if(o-Number(await e(t,"record-checked")||0)<3e5)return;
 await r(t,"record-checked",String(o));
 try{
  const response=await fetch(G+"data/manifest.json",{cf:{cacheTtl:60},signal:AbortSignal.timeout(1e4)});
  if(!response.ok)return;
  const manifest=await response.json(),info=manifest.recordNotifications;
  if(manifest.schemaVersion!==1||manifest.project!=="https://maxtwmgfobrnpxbjdzjl.supabase.co"||!Number.isFinite(Date.parse(manifest.generatedAt)))return;
  if(info?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(info.fingerprint)||!Number.isSafeInteger(info.total)||info.total<0||!Array.isArray(info.changes)||info.changes.length>8||info.changes.some(x=>typeof x!=="string"||!x.trim()||x.length>200)||info.total<info.changes.length)return;
  if(Date.parse(manifest.generatedAt)<Date.parse(await e(t,"record-notification-published-v2")||"1970-01-01"))return;
  const prior=await e(t,"record-notification-fingerprint-v2");
  if(prior&&prior!==info.fingerprint&&info.total>0&&info.changes.length){
   const fingerprint=await a(prior+"|"+info.fingerprint+"|"+manifest.generatedAt);
   const shown=info.changes.slice(0,2),remaining=info.total-shown.length;
   const body=(shown.join(" / ")+(remaining>0?" 외 "+remaining+"건":"")).slice(0,280);
   const payload={kind:"records-updated",title:"BEARStat · 기록 업데이트",body,tag:"bearstat-records-"+fingerprint.slice(0,16),url:G+"#/records"};
   // Publish details first. Only publications with details are eligible for delivery.
   await t.DB.prepare("INSERT OR IGNORE INTO record_publication_details(fingerprint,payload_json) VALUES(?,?)").bind(fingerprint,JSON.stringify(payload)).run();
   await t.DB.prepare("INSERT OR IGNORE INTO record_publications(fingerprint,published_at,created_at) VALUES(?,?,?)").bind(fingerprint,manifest.generatedAt,o).run();
  }
  await r(t,"record-notification-fingerprint-v2",info.fingerprint);
  await r(t,"record-notification-published-v2",manifest.generatedAt);
 }catch{}
}
async function W(t,e,r=20,a=Date.now()){if(r<=0)return{sent:0,attempts:0};let{results:o}=await t.DB.prepare("SELECT p.fingerprint,p.published_at,p.created_at,d.payload_json FROM record_publications p INNER JOIN record_publication_details d ON d.fingerprint=p.fingerprint WHERE p.created_at>? ORDER BY p.created_at ASC LIMIT 24").bind(a-864e5).all();if(!o.length)return{sent:0,attempts:0};let{results:i}=await t.DB.prepare("SELECT s.endpoint_hash,s.subscription,s.updated_at FROM subscriptions s LEFT JOIN subscription_preferences p ON p.endpoint_hash=s.endpoint_hash WHERE COALESCE(p.record_updates,1)=1 ORDER BY s.updated_at DESC LIMIT 100").all(),u=0,n=0;for(let s of o)for(let c of i){if(n>=r||c.updated_at>s.created_at)continue;let d="records:"+s.fingerprint;if(await t.DB.prepare("INSERT INTO deliveries(endpoint_hash,event_key,starts_at,state,lease_until) VALUES(?,?,?,'sending',?) ON CONFLICT(endpoint_hash,event_key,starts_at) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state<>'sent' AND deliveries.lease_until<? RETURNING endpoint_hash").bind(c.endpoint_hash,d,s.published_at,a+6e4,a).first()){n++;try{let f=await e(t,JSON.parse(c.subscription),JSON.parse(s.payload_json));f>=200&&f<300?(await t.DB.prepare("UPDATE deliveries SET state='sent' WHERE endpoint_hash=? AND event_key=? AND starts_at=?").bind(c.endpoint_hash,d,s.published_at).run(),u++):(f===404||f===410)&&await t.DB.prepare("DELETE FROM subscriptions WHERE endpoint_hash=?").bind(c.endpoint_hash).run()}catch{}}}return{sent:u,attempts:n}}var ht=Object.prototype.toString,yt="[object Uint8Array]";function bt(t,e,r){return t?t.constructor===e?!0:ht.call(t)===r:!1}function mt(t){return bt(t,Uint8Array,yt)}function z(t){if(!mt(t))throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof t}\``)}function J(t){if(t instanceof ArrayBuffer)return new Uint8Array(t);if(ArrayBuffer.isView(t))return new Uint8Array(t.buffer,t.byteOffset,t.byteLength);throw new TypeError(`Unsupported value, got \`${typeof t}\`.`)}function Y(t,e){if(t.length===0)return new Uint8Array(0);e??=t.reduce((o,i)=>o+i.length,0);let r=new Uint8Array(e),a=0;for(let o of t)z(o),r.set(o,a),a+=o.length;return r}var Dt={utf8:new globalThis.TextDecoder("utf8")};function Z(t){if(typeof t!="string")throw new TypeError(`Expected \`string\`, got \`${typeof t}\``)}var Et=new globalThis.TextEncoder;function m(t){return Z(t),Et.encode(t)}function gt(t){return t.replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"")}function wt(t){let e=t.replaceAll("-","+").replaceAll("_","/"),r=(4-e.length%4)%4;return e+"=".repeat(r)}var V=65535;function q(t,{urlSafe:e=!1}={}){z(t);let r="";for(let a=0;a<t.length;a+=V){let o=t.subarray(a,a+V);r+=globalThis.btoa(String.fromCodePoint.apply(void 0,o))}return e?gt(r):r}function _(t){return Z(t),Uint8Array.from(globalThis.atob(wt(t)),e=>e.codePointAt(0))}var xt=Array.from({length:256},(t,e)=>e.toString(16).padStart(2,"0"));function Q(t){let e=new Uint8Array(4);return new DataView(e.buffer).setUint32(0,t),e}function y(t,e){if(!t)throw new Error(e)}async function tt(t){let e=_(t.keys.p256dh),r=_(t.keys.auth);return y(e.byteLength===65&&e[0]===4,"Subscription p256dh is not an uncompressed P-256 point"),y(r.byteLength===16,"Subscription auth secret is not 16 bytes"),{publicKeyBytes:e,publicKey:await crypto.subtle.importKey("raw",e,{name:"ECDH",namedCurve:"P-256"},!1,[]),authSecretBytes:r}}function et(t){let e=crypto.subtle.importKey("raw",t,{name:"HMAC",hash:"SHA-256"},!1,["sign"]);return{hash:async r=>{let a=await e;return crypto.subtle.sign("HMAC",a,r)}}}async function R(t,e){let r=et(t).hash(e).then(a=>et(a));return{extract:async(a,o)=>{let i=await r,u=await Array.from({length:Math.ceil(o/32)},(n,s)=>s).reduce(async(n,s)=>{let c=await n,d=await i.hash(new Uint8Array([...c.at(-1)??[],...a,s+1]));return[...c,new Uint8Array(d)]},Promise.resolve([]));return Y(u).slice(0,o)}}}function rt(t,e){return new Uint8Array([...m("WebPush: info\0"),...t,...e])}function D(t){return m(`Content-Encoding: ${t}\0`)}async function nt(){let t=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},!1,["deriveBits"]);return{privateKey:t.privateKey,publicKeyBytes:new Uint8Array(await crypto.subtle.exportKey("raw",t.publicKey))}}async function at(){return crypto.getRandomValues(new Uint8Array(16))}var it=4096,Tt=86,x=it-Tt-17;async function I(t,e,r={}){y(e.byteLength<=x,`Payload is ${e.byteLength} bytes, the maximum is ${x}`);let a=await tt(t),o=await at(),i=await nt(),u=await crypto.subtle.deriveBits({name:"ECDH",public:a.publicKey},i.privateKey,256),n=rt(a.publicKeyBytes,i.publicKeyBytes),s=D("aes128gcm"),c=D("nonce"),p=await(await R(a.authSecretBytes,u)).extract(n,32),f=await R(o,p),l=await f.extract(s,16),w=await f.extract(c,12),b=await crypto.subtle.importKey("raw",l,{name:"AES-GCM",length:128},!1,["encrypt"]),g=r.pad??!0?x:e.byteLength,T=new Uint8Array(g+1);T.set(e),T[e.byteLength]=2;let ft=await crypto.subtle.encrypt({name:"AES-GCM",iv:w},b,T);return new Uint8Array([...o,...Q(it),i.publicKeyBytes.byteLength,...i.publicKeyBytes,...new Uint8Array(ft)])}function A(t){return q(J(t),{urlSafe:!0})}function L(t){return A(m(JSON.stringify(t)))}async function ot(t,e){let r=L({typ:"JWT",alg:"ES256"}),a=L({iat:Math.floor(Date.now()/1e3),...t}),o=`${r}.${a}`,i=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},e,m(o));return`${o}.${A(i)}`}async function B(t,e){y(e.subject,"Vapid subject is empty"),y(e.privateKey,"Vapid private key is empty"),y(e.publicKey,"Vapid public key is empty");let r=new URL(t.endpoint);y(r.protocol==="https:",`Subscription endpoint is not https: ${r.protocol}`);let a=_(e.publicKey),o=await crypto.subtle.importKey("jwk",{kty:"EC",crv:"P-256",x:A(a.slice(1,33)),y:A(a.slice(33,65)),d:e.privateKey},{name:"ECDSA",namedCurve:"P-256"},!1,["sign"]);return{headers:{authorization:`vapid t=${await ot({aud:r.origin,exp:Math.floor(Date.now()/1e3)+720*60,sub:e.subject},o)}, k=${e.publicKey}`}}}async function C(t,e,r){let{headers:a}=await B(e,r),o=await I(e,m(typeof t.data=="string"||typeof t.data=="number"?t.data.toString():JSON.stringify(t.data)));return{headers:{...a,ttl:(t.options?.ttl||60).toString(),...t.options?.urgency&&{urgency:t.options.urgency},...t.options?.topic&&{topic:t.options.topic},"content-encoding":"aes128gcm","content-length":o.byteLength.toString(),"content-type":"application/octet-stream"},method:"post",body:o}}var h=t=>t==null?"":String(t).trim();function At(t){return t?.score&&["d","v"].every(e=>h(t.score[e])!==""&&Number.isFinite(Number(t.score[e])))}function St(t){if(!/^\d{4}-\d{2}-\d{2}$/.test(h(t.date))||!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(h(t.time)))return null;let e=h(t.time),r=new Date(t.date+"T"+e+(e.length===5?":00":"")+"+09:00");return Number.isFinite(+r)?r:null}function P(t,e=new Date){if(!t||t.demo||t.cancelled||t.cancelReason||/^(cancelled|canceled|final|finished|completed|live|playing|inprogress|in_progress)$/i.test(h(t.status))||["kbo","futures","edu"].includes(t.type)&&At(t))return null;let r=St(t);return!r||+r<=+e||+r-+e>3e5?null:{event:t,start:r,key:h(t.type)+":"+h(t.kboGameId||t.id)}}function st(t,e,r=[]){let a=t.filter(n=>!n.demo).map(n=>({...n})),o=new Set(r.map(h)),i=n=>[n.type,n.date,n.opp].map(h).join("|"),u=new Map;for(let n of e){let s=i(n)+"|"+h(n.homeAway);u.set(s,(u.get(s)||0)+1)}for(let n of e){let s=a.filter(p=>p.type===n.type&&(p.kboGameId&&p.kboGameId===n.kboGameId||p.id===n.id));if(!s.length&&(s=a.filter(p=>!p.kboGameId&&i(p)===i(n)&&(!p.homeAway||p.homeAway===n.homeAway)),s.length)){let p=s[0],f=e.filter(l=>i(l)===i(p)&&(!p.homeAway||l.homeAway===p.homeAway)).length;if(s.length!==1||f!==1||n.headerNo>0)continue}if(s.length>1)continue;if(!s.length){a.push({...n});continue}let c=s[0],d=c.manualOverride?{...n,...c}:{...c,...n};for(let p of["title","desc","channel","program","players","series"])c[p]!==void 0&&c[p]!==""&&(d[p]=c[p]);(c.cancellationOverride||c.cancellationOverride===void 0&&h(c.cancelReason))&&(d.cancelReason=h(c.cancelReason),d.cancelled=!!(c.cancelled||c.status==="cancelled"||c.cancelReason),d.status=d.cancelled?"cancelled":n.status),d.id=c.id,d.kboGameId=n.kboGameId,a[a.indexOf(c)]=d}return a.filter(n=>!o.has(h(n.kboGameId)))}function K(t){try{let e=new URL(t.endpoint),r=["fcm.googleapis.com","updates.push.services.mozilla.com","push.services.mozilla.com","web.push.apple.com"];if(e.protocol!=="https:"||e.username||e.password||e.port||!r.includes(e.hostname)&&!e.hostname.endsWith(".push.apple.com")&&!e.hostname.endsWith(".notify.windows.com")||e.href.length>2048||!t.keys||!/^[A-Za-z0-9_-]{87}=?$/.test(t.keys.p256dh)||!/^[A-Za-z0-9_-]{22}={0,2}$/.test(t.keys.auth))return!1;let a=u=>Uint8Array.from(atob(u.replace(/-/g,"+").replace(/_/g,"/")),n=>n.charCodeAt(0)),o=a(t.keys.p256dh),i=a(t.keys.auth);return o.length===65&&o[0]===4&&i.length===16}catch{return!1}}function ct(t,e,r){let a=new URL(r);return a.hash="/?date="+t.date,{title:"BEARStat \xB7 5\uBD84 \uC804 \uC54C\uB9BC",body:(h(t.title)||"\uC608\uC815\uB41C \uC77C\uC815")+" \xB7 "+t.time.slice(0,5)+(t.venue||t.place?" \xB7 "+h(t.venue||t.place):""),tag:"bearstat-"+h(t.type)+"-"+h(t.kboGameId||t.id)+"-"+e.toISOString(),url:a.href,startAt:e.toISOString()}}var N="https://dsbrs.github.io/BEARStat/",ut="https://maxtwmgfobrnpxbjdzjl.supabase.co",dt="sb_publishable_6ZxZjyKxvsUspmmG6K8RPg_xq_sL6Qu",_t=`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (endpoint_hash TEXT PRIMARY KEY, subscription TEXT NOT NULL, token_hash TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (endpoint_hash TEXT NOT NULL, event_key TEXT NOT NULL, starts_at TEXT NOT NULL, state TEXT NOT NULL, lease_until INTEGER NOT NULL, PRIMARY KEY(endpoint_hash,event_key,starts_at));
CREATE INDEX IF NOT EXISTS deliveries_expiry ON deliveries(lease_until);
CREATE TABLE IF NOT EXISTS request_limits (ip_hash TEXT PRIMARY KEY, minute INTEGER NOT NULL, count INTEGER NOT NULL);
`,O=async t=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t))),e=>e.toString(16).padStart(2,"0")).join(""),Nt=t=>btoa(String.fromCharCode(...new Uint8Array(t))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""),U=new WeakMap;async function pt(t){if(!t.DB)throw Error("\uC54C\uB9BC \uC800\uC7A5\uC18C\uB97C \uC5F0\uACB0\uD574\uC8FC\uC138\uC694.");U.has(t.DB)||U.set(t.DB,t.DB.exec(_t+$+"CREATE TABLE IF NOT EXISTS notification_preferences_v2 (endpoint_hash TEXT PRIMARY KEY, preferences_json TEXT NOT NULL);").catch(e=>{throw U.delete(t.DB),e})),await U.get(t.DB)}async function E(t,e){return(await t.DB.prepare("SELECT value FROM settings WHERE key=?").bind(e).first())?.value}async function S(t,e,r){await t.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(e,r).run()}async function M(t){let e=await E(t,"vapid");if(e)return JSON.parse(e);let r=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},!0,["sign","verify"]),a=await crypto.subtle.exportKey("jwk",r.privateKey),o=await crypto.subtle.exportKey("raw",r.publicKey),i={publicKey:Nt(o),privateKey:a.d,subject:N};return await t.DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").bind("vapid",JSON.stringify(i)).run(),JSON.parse(await E(t,"vapid"))}async function H(t,e,r=""){let a=await fetch(ut+"/rest/v1/"+t+"?"+new URLSearchParams(e),{headers:{apikey:dt,...r?{Authorization:"Bearer "+r}:{}},signal:AbortSignal.timeout(1e4)});if(!a.ok)throw Error("\uC77C\uC815 \uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694.");return a.json()}async function Ut(t){let e=t.headers.get("authorization")||"";if(!/^Bearer [A-Za-z0-9_.-]{20,}$/.test(e))return!1;let r=await fetch(ut+"/auth/v1/user",{headers:{apikey:dt,Authorization:e},signal:AbortSignal.timeout(8e3)});if(!r.ok)return!1;let a=await r.json();return a.id?(await H("admins",{select:"user_id",user_id:"eq."+a.id},e.slice(7))).length===1:!1}function j(t){return t?.schemaVersion===1&&Array.isArray(t.events)&&Array.isArray(t.automatic)&&Array.isArray(t.hidden)&&[...t.events,...t.automatic].every(e=>e&&typeof e=="object"&&/^\d{4}-\d{2}-\d{2}$/.test(e.date))}async function lt(t,e=!1){let r=Date.now(),a=Number(await E(t,"schedule-checked"))||0;if(!e&&r-a<3e5)return;await S(t,"schedule-checked",String(r));let o=null;try{let u=await fetch(N+"data/schedules.json",{cf:{cacheTtl:120},signal:AbortSignal.timeout(1e4)});if(u.ok){let n=await u.json();j(n)&&(o=n)}}catch{}let i=Number(await E(t,"live-retry"))||0;if(e||r>=i)try{let u=new Date(r+324e5).toISOString().slice(0,10),n=new Date(r+9*36e5+45*864e5).toISOString().slice(0,10),s=async(l,w)=>{let b=[];for(let g=0;;g+=500){let T=await H(l,{select:w+",date,body",and:"(date.gte."+u+",date.lte."+n+")",order:w+".asc",limit:"500",offset:String(g)});if(b.push(...T),T.length<500)return b}},[c,d,p,f]=await Promise.all([s("events","id"),s("kbo_game_records","game_id"),s("futures_game_records","game_id"),H("kv",{select:"body",key:"eq.hidden_auto_events"})]);o={schemaVersion:1,generatedAt:new Date().toISOString(),events:c.map(l=>({...l.body,id:l.id,date:l.date})),automatic:[...d.map(l=>({...l.body,id:l.body.id||l.game_id,kboGameId:l.body.kboGameId||l.game_id,date:l.date,type:l.body.type||"kbo"})),...p.map(l=>({...l.body,id:l.body.id||l.game_id,kboGameId:l.body.kboGameId||l.game_id,date:l.date,type:"futures"}))],hidden:f[0]?.body||[]},await S(t,"live-retry","0")}catch{await S(t,"live-retry",String(r+36e5))}if(o&&j(o)){let u=JSON.parse(await E(t,"schedules")||"null");(!u||Date.parse(o.generatedAt)>=Date.parse(u.generatedAt))&&await S(t,"schedules",JSON.stringify(o))}}async function F(t,e,r){if(!K(e))throw Error("\uC218\uC2E0 \uAE30\uAE30 \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC544\uC694.");let a=await M(t),o={data:r,options:{ttl:["records-updated","feature-added"].includes(r.kind)?86400:Math.max(1,Math.min(120,Math.floor(((Date.parse(r.expiresAt||r.startAt)||Date.now()+6e4)-Date.now())/1e3))),urgency:"high"}},i=await C(o,e,a);return delete i.headers["content-length"],(await fetch(e.endpoint,{...i,redirect:"manual",signal:AbortSignal.timeout(8e3)})).status}// Additive preference storage: existing subscriptions, tokens and VAPID keys stay intact.
const NOTIFICATION_KEYS=['features','records','kbo','futures','edu','handball','national','ticket','club','fan','broadcast','radio','etc'];
const NOTIFICATION_LABELS={kbo:'야구',futures:'퓨처스',edu:'교육리그',handball:'핸드볼',national:'국가대표',ticket:'티켓 예매',club:'구단 행사',fan:'팬 행사',broadcast:'방송',radio:'라디오·유튜브',etc:'일정'};
function normalizeNotificationPreferences(input={},legacyRecord=true){
 const categories=Object.fromEntries(NOTIFICATION_KEYS.map(key=>[key,typeof input.categories?.[key]==='boolean'?input.categories[key]:key==='features'?false:key==='records'?legacyRecord!==false:true]));
 const minutes=Number(input.reminderMinutes??5);
 return {categories,recordUpdates:categories.records,reminderMinutes:Number.isInteger(minutes)&&minutes>=0&&minutes<=10080?minutes:5,ticketAtStart:input.ticketAtStart!==false};
}
function validateNotificationPreferences(input){
 if(input.categories!==undefined&&(!input.categories||Array.isArray(input.categories)||typeof input.categories!=='object'||Object.entries(input.categories).some(([k,v])=>!NOTIFICATION_KEYS.includes(k)||typeof v!=='boolean')))return false;
 if(input.recordUpdates!==undefined&&typeof input.recordUpdates!=='boolean')return false;
 if(input.reminderMinutes!==undefined&&(!Number.isInteger(input.reminderMinutes)||input.reminderMinutes<0||input.reminderMinutes>10080))return false;
 return input.ticketAtStart===undefined||typeof input.ticketAtStart==='boolean';
}
async function readNotificationPreferences(env,hash){
 const row=await env.DB.prepare('SELECT preferences_json FROM notification_preferences_v2 WHERE endpoint_hash=?').bind(hash).first();
 let input={};try{input=JSON.parse(row?.preferences_json||'{}')}catch{}
 return normalizeNotificationPreferences(input,await v(env,hash));
}
async function saveNotificationPreferences(env,hash,input){
 const current=await readNotificationPreferences(env,hash),categories={...current.categories,...input.categories};
 if(typeof input.recordUpdates==='boolean'&&typeof input.categories?.records!=='boolean')categories.records=input.recordUpdates;
 const value=normalizeNotificationPreferences({...current,...input,categories});
 await env.DB.batch([
  env.DB.prepare('INSERT INTO notification_preferences_v2(endpoint_hash,preferences_json) VALUES(?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET preferences_json=excluded.preferences_json').bind(hash,JSON.stringify(value)),
  env.DB.prepare('INSERT INTO subscription_preferences(endpoint_hash,record_updates) VALUES(?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET record_updates=excluded.record_updates').bind(hash,value.categories.records?1:0)
 ]);return value;
}
function notificationCategory(event){
 if(NOTIFICATION_KEYS.includes(event.notificationCategory)&&!['features','records'].includes(event.notificationCategory))return event.notificationCategory;
 if(['national','national-team','national_team','international'].includes(event.type))return 'national';
 if(['kbo','edu','etc'].includes(event.type)&&/국가대표|대표팀|국대|\bWBC\b|\bAPBC\b|\bWBSC\b|프리미어\s*12|아시안게임/i.test([event.title,event.series,event.competition].filter(Boolean).join(' ')))return 'national';
 return NOTIFICATION_KEYS.includes(event.type)?event.type:'etc';
}
function notificationReminder(event,preferences,now=Date.now()){
 if(!event||event.demo||event.cancelled||event.cancelReason||/^(cancelled|canceled|final|finished|completed|live|playing|inprogress|in_progress)$/i.test(h(event.status))||['kbo','futures','edu','national'].includes(event.type)&&At(event))return [];
 const start=St(event),category=notificationCategory(event);
 if(!start||!preferences.categories[category]||+start+60000<=now)return [];
 const key=h(event.type)+':'+h(event.kboGameId||event.id),out=[];
 if(preferences.reminderMinutes>0){const due=+start-preferences.reminderMinutes*60000;if(now>=due&&now<due+60000&&now<+start)out.push({event,start,category,key:key+':before:'+preferences.reminderMinutes,due,atStart:false});}
 if(category==='ticket'&&preferences.ticketAtStart&&now>=+start&&now<+start+60000)out.push({event,start,category,key:key+':ticket-start',due:+start,atStart:true});
 return out;
}
function notificationReminderPayload(reminder,preferences){
 const {event,start,category,atStart}=reminder,url=new URL(N);url.hash='/?date='+event.date;
 const title='BEARStat · '+NOTIFICATION_LABELS[category]+(atStart?' 지금 예매 시작':` ${preferences.reminderMinutes}분 전`);
 const name=h(event.title)||(h(event.opp)?'두산 vs '+h(event.opp):NOTIFICATION_LABELS[category]);
 return {kind:atStart?'ticket-start':'schedule-reminder',category,type:event.type,eventId:event.id,title,body:[name,h(event.time).slice(0,5),category==='ticket'?h(event.ticketSite||event.bookingSite||event.venue||event.place):h(event.venue||event.place),h(event.channel||event.program)].filter(Boolean).join(' · ').slice(0,300),ticketSite:category==='ticket'?h(event.ticketSite||event.bookingSite||event.venue||event.place):undefined,tag:'bearstat-'+reminder.key+'-'+start.toISOString(),url:url.href,startAt:start.toISOString(),expiresAt:new Date(atStart?+start+60000:+start).toISOString()};
}
async function deliverNotification(env,subscriber,key,startsAt,payload,send=F,now=Date.now()){
 const lease=await env.DB.prepare("INSERT INTO deliveries(endpoint_hash,event_key,starts_at,state,lease_until) VALUES(?,?,?,'sending',?) ON CONFLICT(endpoint_hash,event_key,starts_at) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state<>'sent' AND deliveries.lease_until<? RETURNING endpoint_hash").bind(subscriber.endpoint_hash,key,startsAt,now+60000,now).first();
 if(!lease)return {sent:0,attempts:0};
 try{
  const status=await send(env,JSON.parse(subscriber.subscription),payload);
  if(status>=200&&status<300){await env.DB.prepare("UPDATE deliveries SET state='sent' WHERE endpoint_hash=? AND event_key=? AND starts_at=?").bind(subscriber.endpoint_hash,key,startsAt).run();return {sent:1,attempts:1};}
  if(status===404||status===410)await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint_hash=?').bind(subscriber.endpoint_hash).run();
 }catch{}
 return {sent:0,attempts:1};
}
async function notificationPublications(env,send=F,budget=20,now=Date.now()){
 if(budget<=0)return {sent:0,attempts:0};
 const {results:publications}=await env.DB.prepare('SELECT p.fingerprint,p.published_at,p.created_at,d.payload_json FROM record_publications p INNER JOIN record_publication_details d ON d.fingerprint=p.fingerprint WHERE p.created_at>? ORDER BY p.created_at ASC LIMIT 24').bind(now-86400000).all();
 const {results:subscribers}=await env.DB.prepare('SELECT endpoint_hash,subscription,updated_at FROM subscriptions ORDER BY updated_at ASC LIMIT 100').all();
 let sent=0,attempts=0;
 for(const subscriber of subscribers){
  const preferences=await readNotificationPreferences(env,subscriber.endpoint_hash);
  for(const publication of publications){
   if(attempts>=budget)return {sent,attempts};
   if(subscriber.updated_at>publication.created_at)continue;
   let payload;try{payload=JSON.parse(publication.payload_json)}catch{continue;}
   const category=payload.kind==='feature-added'?'features':'records';if(!preferences.categories[category])continue;
   const result=await deliverNotification(env,subscriber,category+':'+publication.fingerprint,publication.published_at,{...payload,category},send,now);sent+=result.sent;attempts+=result.attempts;
  }
 }
 return {sent,attempts};
}
async function refreshNotificationBuiltins(env,now=Date.now()){
 if(now-Number(await E(env,'notification-builtins-checked')||0)<300000)return;
 await S(env,'notification-builtins-checked',String(now));
 try{const response=await fetch(N+'data/notification-events.json',{cf:{cacheTtl:120},signal:AbortSignal.timeout(10000)});if(!response.ok)return;const value=await response.json();if(value.schemaVersion===1&&Array.isArray(value.events)&&value.events.length<=1000&&value.events.every(e=>e&&typeof e.id==='string'&&typeof e.type==='string'&&St(e)))await S(env,'notification-builtins',JSON.stringify(value.events));}catch{}
}
async function dispatchNotifications(env){
 await pt(env);await lt(env);await X(env,{setting:E,putSetting:S,hash:O});await refreshNotificationBuiltins(env);
 const schedule=JSON.parse(await E(env,'schedules')||'null'),builtins=JSON.parse(await E(env,'notification-builtins')||'[]');
 const events=schedule?st(schedule.events,schedule.automatic,schedule.hidden):[];
 const ids=new Set(events.map(e=>e.id)),hidden=new Set(schedule?.hidden||[]);
 for(const event of builtins)if(!ids.has(event.id)&&!hidden.has(event.id))events.push(event);
 const {results:subscribers}=await env.DB.prepare('SELECT endpoint_hash,subscription FROM subscriptions ORDER BY updated_at ASC LIMIT 100').all();
 let sent=0,attempts=0;
 // Bound schedule work to the existing 100-device subscription capacity.
 for(const subscriber of subscribers){
  const preferences=await readNotificationPreferences(env,subscriber.endpoint_hash);
  for(const event of events)for(const reminder of notificationReminder(event,preferences)){
   if(attempts>=100)break;
   const result=await deliverNotification(env,subscriber,reminder.key,reminder.start.toISOString(),notificationReminderPayload(reminder,preferences));sent+=result.sent;attempts+=result.attempts;
  }
  if(attempts>=100)break;
 }
 const publications=await notificationPublications(env,F,20);sent+=publications.sent;
 if(new Date().getUTCHours()===0&&new Date().getUTCMinutes()===17){await env.DB.prepare('DELETE FROM deliveries WHERE lease_until<?').bind(Date.now()-7*86400000).run();await env.DB.prepare('DELETE FROM request_limits WHERE minute<?').bind(Math.floor(Date.now()/60000)-1440).run();}
 return {sent,ready:!!schedule,preferencesVersion:2};
}
async function featureAnnouncement(request,env,input,respond){
 if(!await Ut(request))return respond({error:'관리자 로그인 후 사용할 수 있어요.'},403);
 const title=h(input.title),body=h(input.body),routes=['#/','#/numbers','#/records','#/player-cards','#/awards','#/standings','#/h2h','#/milestones'];
 if(!title||title.length>80||!body||body.length>280||!routes.includes(input.route))return respond({error:'안내 제목·내용과 연결 화면을 확인해주세요.'},400);
 const fingerprint=await O('feature-v1|'+title+'|'+body+'|'+input.route),existing=await env.DB.prepare('SELECT fingerprint FROM record_publications WHERE fingerprint=?').bind(fingerprint).first();
 if(existing)return respond({ok:true,duplicate:true});
 const now=Date.now(),publishedAt=new Date(now).toISOString(),payload={kind:'feature-added',category:'features',title:'BEARStat · '+title,body,url:N+input.route,tag:'bearstat-feature-'+fingerprint.slice(0,16)};
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO record_publication_details(fingerprint,payload_json) VALUES(?,?)').bind(fingerprint,JSON.stringify(payload)),
  env.DB.prepare('INSERT OR IGNORE INTO record_publications(fingerprint,published_at,created_at) VALUES(?,?,?)').bind(fingerprint,publishedAt,now)
 ]);return respond({ok:true});
}
async function handleNotifications(request,env){
 const origin=request.headers.get('origin')||'',allowedOrigin=new URL(N).origin;
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Vary:'Origin',...(origin===allowedOrigin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,authorization,apikey','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}:{})};
 const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&origin!==allowedOrigin)return respond({error:'허용되지 않은 사이트예요.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!['GET','POST'].includes(request.method))return respond({error:'지원하지 않는 요청이에요.'},405);
 try{
  await pt(env);
  if(request.method==='GET'){const vapid=await M(env),schedule=JSON.parse(await E(env,'schedules')||'null');return respond({ready:!!schedule,publicKey:vapid.publicKey,backend:'cloudflare',preferencesVersion:2,categories:NOTIFICATION_KEYS,scheduleUpdatedAt:schedule?.generatedAt||null});}
  if(Number(request.headers.get('content-length')||0)>12000)return respond({error:'요청이 너무 커요.'},413);
  const text=await request.text();if(text.length>12000)return respond({error:'요청이 너무 커요.'},413);
  let input;try{input=JSON.parse(text)}catch{return respond({error:'요청 내용을 확인해주세요.'},400)}
  if(input.action==='announce')return await featureAnnouncement(request,env,input,respond);
  if(['setup','sync'].includes(input.action)){
   if(!await Ut(request))return respond({error:'관리자 로그인 후 사용할 수 있어요.'},403);
   if(input.action==='sync'&&j(input.schedules))await S(env,'schedules',JSON.stringify({...input.schedules,generatedAt:new Date().toISOString()}));else await lt(env,true);
   await M(env);await refreshNotificationBuiltins(env);return respond({ok:true,ready:!!await E(env,'schedules')});
  }
  if(!['subscribe','unsubscribe','status','test','preferences'].includes(input.action)||!K(input.subscription)||!/^[a-f0-9]{64}$/.test(input.token||''))return respond({error:'기기 알림 정보가 올바르지 않아요.'},400);
  const endpointHash=await O(input.subscription.endpoint),tokenHash=await O(input.token),existing=await env.DB.prepare('SELECT token_hash FROM subscriptions WHERE endpoint_hash=?').bind(endpointHash).first();
  if(existing&&existing.token_hash!==tokenHash)return respond({error:'이 기기에서 알림을 다시 연결해주세요.'},403);
  if(input.action==='status')return respond({enabled:!!existing,preferencesVersion:2,...existing?await readNotificationPreferences(env,endpointHash):normalizeNotificationPreferences()});
  if(input.action==='unsubscribe'){await env.DB.batch([env.DB.prepare('DELETE FROM subscriptions WHERE endpoint_hash=? AND token_hash=?').bind(endpointHash,tokenHash),env.DB.prepare('DELETE FROM notification_preferences_v2 WHERE endpoint_hash=?').bind(endpointHash),env.DB.prepare('DELETE FROM subscription_preferences WHERE endpoint_hash=?').bind(endpointHash)]);return respond({ok:true});}
  if(input.action==='preferences'){
   if(!existing||!validateNotificationPreferences(input))return respond({error:'기기 알림 설정을 확인해주세요.'},400);
   return respond({ok:true,preferencesVersion:2,...await saveNotificationPreferences(env,endpointHash,input)});
  }
  if(input.action==='test'){
   if(!existing)return respond({error:'먼저 이 기기 알림을 켜주세요.'},403);
   const sent=await F(env,input.subscription,{kind:'test',title:'BEARStat · 알림 연결 확인',body:'이 기기에 알림이 연결됐어요. 저장한 항목만 받아요.',tag:'bearstat-test',url:N,expiresAt:new Date(Date.now()+60000).toISOString()});
   return sent>=200&&sent<300?respond({ok:true}):respond({error:'기기 알림 전송을 확인하지 못했어요.'},502);
  }
  if(!validateNotificationPreferences(input))return respond({error:'알림 설정을 확인해주세요.'},400);
  const minute=Math.floor(Date.now()/60000),ipHash=await O(request.headers.get('cf-connecting-ip')||'unknown');
  const limit=await env.DB.prepare('INSERT INTO request_limits(ip_hash,minute,count) VALUES(?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET minute=excluded.minute,count=CASE WHEN request_limits.minute=excluded.minute THEN request_limits.count+1 ELSE 1 END RETURNING count').bind(ipHash,minute).first();
  if(limit.count>10)return respond({error:'잠시 후 다시 시도해주세요.'},429);
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions').first();
  if(!existing&&count.n>=100)return respond({error:'현재 알림 등록 한도에 도달했어요.'},429);
  await env.DB.prepare('INSERT INTO subscriptions(endpoint_hash,subscription,token_hash,updated_at) VALUES(?,?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription=excluded.subscription WHERE subscriptions.token_hash=excluded.token_hash').bind(endpointHash,JSON.stringify(input.subscription),tokenHash,Date.now()).run();
  return respond({ok:true,preferencesVersion:2,...await saveNotificationPreferences(env,endpointHash,input)});
 }catch{return respond({error:'알림 서버 연결을 확인하지 못했어요. 잠시 후 다시 시도해주세요.'},503)}
}
var Ee={fetch:handleNotifications,scheduled:(event,env,ctx)=>ctx.waitUntil(dispatchNotifications(env))};
export {Ee as default,dispatchNotifications as dispatch,handleNotifications as handle};
