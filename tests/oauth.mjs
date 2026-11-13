import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../cloudflare/worker.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const base='https://retrowave-family-sync.moyassar-h.workers.dev';
const env={DROPBOX_APP_KEY:'test-key',DROPBOX_APP_SECRET:'test-secret',ADMIN_SETUP_KEY:'test-admin-'.repeat(5)};
const call=(path,init={},bindings=env)=>worker.fetch(new Request(base+path,init),bindings);
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
await check('health is non-sensitive',async()=>{const r=await call('/health',{},{});assert.equal(r.status,200);assert.equal((await r.json()).ok,true)});
await check('missing secrets fail closed',async()=>assert.equal((await call('/',{},{})).status,503));
await check('library rejects unauthenticated callers',async()=>assert.equal((await call('/admin/library')).status,401));
await check('cross-origin setup rejected',async()=>assert.equal((await call('/auth/dropbox/start',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403));
const start=key=>call('/auth/dropbox/start',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({admin_key:key})});
await check('wrong admin key rejected',async()=>assert.equal((await start('wrong')).status,401));
await check('setup preserves same-origin request metadata',async()=>{const r=await call('/');assert.equal(r.headers.get('Referrer-Policy'),'same-origin')});
await check('form policy permits Dropbox OAuth redirects',async()=>{const r=await call('/');assert.ok(r.headers.get('Content-Security-Policy').includes("form-action 'self' https://www.dropbox.com;"))});
let cookie,state;
await check('OAuth uses offline access, PKCE and secure encrypted cookie',async()=>{const r=await start(env.ADMIN_SETUP_KEY);assert.equal(r.status,303);const u=new URL(r.headers.get('Location'));assert.equal(u.searchParams.get('token_access_type'),'offline');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('redirect_uri'),base+'/auth/dropbox/callback');assert.ok(!u.href.includes(env.ADMIN_SETUP_KEY));state=u.searchParams.get('state');cookie=r.headers.get('Set-Cookie').split(';')[0];assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.ok(!cookie.includes(state))});
await check('callback without session rejected',async()=>assert.equal((await call('/auth/dropbox/callback?code=fake&state='+state)).status,400));
await check('callback with wrong state rejected',async()=>assert.equal((await call('/auth/dropbox/callback?code=fake&state=wrong',{headers:{Cookie:cookie}})).status,400));
const original=globalThis.fetch;
try {
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.dropbox.com/oauth2/token');assert.equal(init.redirect,'manual');assert.equal(init.body.get('code_verifier').length,43);return Response.json({refresh_token:'fake-sensitive-refresh',access_token:'fake-access'})};
 await check('valid callback displays refresh token only on protected no-store page',async()=>{const r=await call('/auth/dropbox/callback?code=fake&state='+state,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);assert.ok((await r.text()).includes('fake-sensitive-refresh'))});
 globalThis.fetch=async()=>Response.json({error:'fake-sensitive-upstream-error'},{status:400});
 await check('upstream error redacted',async()=>{const r=await call('/auth/dropbox/callback?code=fake&state='+state,{headers:{Cookie:cookie}});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('fake-sensitive-upstream-error'))});
 globalThis.fetch=async()=>{throw new Error('fake-sensitive-network-details')};
 await check('connection failures diagnosed without raw exception',async()=>{const r=await call('/auth/dropbox/callback?code=fake&state='+state,{headers:{Cookie:cookie}});const body=await r.text();assert.match(body,/TOKEN_CONNECTION/);assert.ok(!body.includes('fake-sensitive-network-details'))});
 globalThis.fetch=async()=>new Response('fake-sensitive-invalid-json');
 await check('unreadable response diagnosed without content',async()=>{const r=await call('/auth/dropbox/callback?code=fake&state='+state,{headers:{Cookie:cookie}});const body=await r.text();assert.match(body,/TOKEN_RESPONSE/);assert.ok(!body.includes('fake-sensitive-invalid-json'))});
 globalThis.fetch=async()=>Response.json({access_token:'fake-sensitive-access'});
 await check('missing refresh token diagnosed without access token',async()=>{const r=await call('/auth/dropbox/callback?code=fake&state='+state,{headers:{Cookie:cookie}});const body=await r.text();assert.match(body,/NO_REFRESH_TOKEN/);assert.ok(!body.includes('fake-sensitive-access'))});
 let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;if(calls===1)return Response.json({access_token:'fake-access'});assert.equal(JSON.parse(init.body).path,'/RetroWave Family Music');return Response.json({entries:[{'.tag':'file',name:'song.MP3',size:123,rev:'r1'},{'.tag':'file',name:'notes.txt'}],has_more:false})};
 await check('authenticated library refreshes token and filters MP3s',async()=>{const r=await call('/admin/library',{headers:{Authorization:'Bearer '+env.ADMIN_SETUP_KEY}},{...env,DROPBOX_REFRESH_TOKEN:'fake-refresh'});assert.equal(r.status,200);assert.equal((await r.json()).mp3Count,1);assert.equal(calls,2)});
} finally {globalThis.fetch=original}
console.log(`${checks} checks passed; all Dropbox calls mocked; no real credentials used.`);
