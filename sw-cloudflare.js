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
  await self.registration.showNotification(data.title.slice(0,100),{body:String(data.body||'').slice(0,300),tag:String(data.tag||'bearstat-reminder'),icon:new URL('favicon.png',base).href,badge:new URL('favicon.png',base).href,data:{url},renotify:false});
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
