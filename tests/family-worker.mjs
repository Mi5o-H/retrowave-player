import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile('cloudflare/worker.js','utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const base='https://retrowave-family-sync.moyassar-h.workers.dev', origin='https://mi5o-h.github.io';
const env={DROPBOX_APP_KEY:'fake-key',DROPBOX_APP_SECRET:'fake-secret',ADMIN_SETUP_KEY:'admin-'.repeat(8),FAMILY_SYNC_KEY:'family-'.repeat(8),DROPBOX_REFRESH_TOKEN:'fake-refresh'};
const call=(path,init={},e=env)=>worker.fetch(new Request(base+path,init),e);
const headers={Origin:origin,Authorization:'Bearer '+env.FAMILY_SYNC_KEY};
let count=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++};
const original=globalThis.fetch;let requests=[];
globalThis.fetch=async(url,init)=>{
 requests.push({url,init});assert.equal(init.redirect,'manual');
 if(url.endsWith('/oauth2/token'))return Response.json({access_token:'fake-sensitive-access'});
 if(url.includes('list_folder'))return Response.json({entries:[{'.tag':'file',id:'id:1',name:'أغنية.mp3',rev:'r1',size:3,path_display:'/RetroWave Family Music/أغنية.mp3'},{'.tag':'file',id:'id:2',name:'outside.mp3',rev:'r2',size:3,path_display:'/elsewhere/outside.mp3'}],has_more:false});
 if(url.includes('/files/download')){assert.ok(!/[^\x00-\x7f]/.test(init.headers['Dropbox-API-Arg']));return new Response(new Uint8Array([1,2,3]));}
 throw new Error('Unexpected destination');
};
try{
 await check('preflight allows only intended player origin',async()=>{const r=await call('/api/library',{method:'OPTIONS',headers:{Origin:origin}});assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin)});
 await check('foreign origin denied',async()=>assert.equal((await call('/api/library',{headers:{...headers,Origin:'https://evil.example'}})).status,403));
 await check('missing family key fails closed',async()=>assert.equal((await call('/api/library',{headers},{...env,FAMILY_SYNC_KEY:undefined})).status,503));
 await check('admin key cannot access family endpoints',async()=>assert.equal((await call('/api/library',{headers:{...headers,Authorization:'Bearer '+env.ADMIN_SETUP_KEY}})).status,401));
 let ticket;
 await check('library contains folder-bound grants and no Dropbox credentials',async()=>{const r=await call('/api/library',{headers});assert.equal(r.status,200);const text=await r.text();assert.ok(!text.includes('fake-sensitive-access'));assert.ok(!text.includes(env.DROPBOX_REFRESH_TOKEN));const data=JSON.parse(text);assert.equal(data.files.length,1);ticket=data.files[0].ticket;assert.ok(!ticket.includes('أغنية'))});
 await check('tampered ticket rejected before Dropbox call',async()=>{requests=[];const r=await call('/api/download',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ticket:ticket+'x'})});assert.equal(r.status,400);assert.equal(requests.length,0)});
 await check('valid download streams audio without upstream headers',async()=>{const r=await call('/api/download',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ticket})});assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'audio/mpeg');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin)});
 await check('ticket expires before any Dropbox call',async()=>{const originalNow=Date.now;Date.now=()=>originalNow()+700000;requests=[];try{assert.equal((await call('/api/download',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ticket})})).status,400);assert.equal(requests.length,0)}finally{Date.now=originalNow}});
 await check('upstream failure retains CORS and redacts content',async()=>{globalThis.fetch=async()=>{throw new Error('fake-sensitive-secret')};const r=await call('/api/library',{headers});assert.equal(r.status,502);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.ok(!(await r.text()).includes('fake-sensitive-secret'))});
}finally{globalThis.fetch=original}
console.log(count+' family API checks passed.');
