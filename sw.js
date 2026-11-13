const CACHE='retrowave-v21';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./family-sync.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('retrowave-v')&&key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  // Cross-origin family API requests and authorization headers are never cached.
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
      return response;
    }).catch(()=>caches.match(event.request).then(response=>response||caches.match('./index.html'))));return;
  }
  event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));
});
