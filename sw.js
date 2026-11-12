// Ecomax Equipo · la app carga rápido y sin conexión; los datos siempre vienen del servidor.
const CACHE='ecomax-equipo-v2-8';
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
