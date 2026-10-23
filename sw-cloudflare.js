const TICKET_DB_URL="https://maxtwmgfobrnpxbjdzjl.supabase.co";
const TICKET_PUBLIC_KEY="sb_publishable_6ZxZjyKxvsUspmmG6K8RPg_xq_sL6Qu";
// Enrich ticket notifications with the current booking site, including older server payloads.
async function ticketNotificationBody(data){
 const body=String(data.body||'');
 const isTicket=data.type==='ticket'||data.kind==='ticket'||/ticket/i.test(String(data.tag||''))||/티켓|예매/.test(String(data.title||'')+' '+body);
 if(!isTicket)return body;
 let site=String(data.ticketSite||data.bookingSite||data.venue||data.place||'').trim();
 if(!site){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
  try{
   const start=new Date(data.startAt||Date.now());
   const day=new Date(start.getTime()+9*60*60*1000).toISOString().slice(0,10);
   const query=new URLSearchParams({select:'id,body',date:'eq.'+day});
   const response=await fetch(TICKET_DB_URL+'/rest/v1/events?'+query,{headers:{apikey:TICKET_PUBLIC_KEY,Authorization:'Bearer '+TICKET_PUBLIC_KEY},signal:controller.signal,cache:'no-store'});
   if(response.ok){
    const rows=await response.json();
    if(Array.isArray(rows)){
     const tickets=rows.map(r=>({...r.body,id:r.id})).filter(e=>e.type==='ticket');
     const tag=String(data.tag||'');
     const byId=tickets.filter(e=>String(data.eventId||'')===String(e.id)||tag.includes('-'+e.id+'-')||tag.endsWith('-'+e.id));
     let matches=byId;
     if(!matches.length)matches=tickets.filter(e=>e.title&&body.includes(String(e.title)));
     if(matches.length>1&&Number.isFinite(start.getTime()))matches=matches.filter(e=>Math.abs(Date.parse(e.date+'T'+e.time.slice(0,5)+':00+09:00')-start.getTime())<1000);
     if(matches.length===1){const e=matches[0];site=String(e.ticketSite||e.bookingSite||e.venue||e.place||'').trim();}
    }
   }
  }catch{}finally{clearTimeout(timer)}
 }
 if(!site||body.includes(site))return body;
 const suffix=' · '+site.slice(0,150);
 return body.slice(0,Math.max(0,300-suffix.length))+suffix;
}
// Push only: no fetch interception or offline cache, so records stay fresh.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let data;try{data=event.data?.json()}catch{return;}
  if(!data||typeof data.title!=='string')return;
  if(data.startAt&&(!Number.isFinite(Date.parse(data.startAt))||Date.parse(data.startAt)<=Date.now()))return;
  const base=new URL('../',self.registration.scope);let url=base.href;
  try{const candidate=new URL(data.url,base);if(candidate.origin===base.origin&&candidate.pathname.startsWith(base.pathname))url=candidate.href}catch{}
  const body=await ticketNotificationBody(data);
  await self.registration.showNotification(data.title.slice(0,100),{body:body.slice(0,300),tag:String(data.tag||'bearstat-reminder'),icon:new URL('favicon.png',base).href,badge:new URL('favicon.png',base).href,data:{url},renotify:false});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const target=new URL(event.notification.data?.url||new URL('../',self.registration.scope).href),base=new URL('../',self.registration.scope);if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>{const u=new URL(client.url);return u.origin===base.origin&&u.pathname.startsWith(base.pathname)});
  if(existing){await existing.navigate(target.href);await existing.focus();}else await self.clients.openWindow(target.href);
 })());
});
