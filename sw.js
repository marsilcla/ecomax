// Ecomax Equipo · la app carga rápido y sin conexión; los datos siempre vienen del servidor.
const CACHE='ecomax-equipo-v2-28';
const SHELL=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png?v=2','./icons/icon-512.png?v=2','./icons/maskable-512.png?v=2','./icons/apple-touch-icon.png?v=2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.hostname.endsWith('supabase.co'))return;
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put('./index.html',cp));return r}).catch(()=>caches.match('./index.html')));return}
  if(u.origin===location.origin){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request)));return}
  if(/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)||u.hostname==='cdnjs.cloudflare.com'||u.hostname==='cdn.jsdelivr.net'){
    e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque'){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}return r})));
  }
});
// Avisos con la app cerrada: el servidor manda {titulo, texto, tag, eid}
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(x){d={texto:e.data?e.data.text():''}}
  const op={body:d.texto||'',icon:'./icons/icon-192.png?v=2',badge:'./icons/badge-96.png',tag:d.tag||undefined,renotify:!!d.tag,data:{eid:d.eid||null},vibrate:[180,90,180],silent:false,requireInteraction:!/Android|Mobi|iP(hone|ad|od)/i.test(navigator.userAgent)};
  e.waitUntil(Promise.all([self.registration.showNotification(d.titulo||'Ecomax Equipo',op),clients.matchAll({type:'window',includeUncontrolled:true}).then(L=>L.forEach(c=>c.postMessage({tipo:'sonar'})))]));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();const eid=e.notification.data&&e.notification.data.eid;
  const url=new URL(eid?'./?abrir='+eid:'./',self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(L=>{
    for(const c of L){if(c.url.startsWith(self.registration.scope)&&'focus' in c){c.postMessage({tipo:'abrir',eid});return c.focus()}}
    return clients.openWindow(url);
  }));
});
