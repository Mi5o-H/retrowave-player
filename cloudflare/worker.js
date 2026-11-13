// RetroWave Family Sync — standalone Cloudflare module Worker.
// No credentials belong in this file. No request/token logging.
const ORIGIN = 'https://retrowave-family-sync.moyassar-h.workers.dev';
const CALLBACK = ORIGIN + '/auth/dropbox/callback';
const COOKIE = '__Host-rw_oauth';
const enc = new TextEncoder();
const headers = {
  'Cache-Control': 'no-store', 'Pragma': 'no-cache',
  'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://www.dropbox.com; frame-ancestors 'none'; base-uri 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
};
function reply(body, status = 200, extra = {}) {
  return new Response(body, {status, headers: {...headers, ...extra}});
}
function page(body, status = 200, extra = {}) {
  return reply('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RetroWave setup</title><style>body{font:18px system-ui;max-width:760px;margin:3em auto;padding:1em}input,button,textarea{font:inherit;max-width:100%}textarea{width:100%;height:8em}</style><h1>RetroWave Family Sync</h1>' + body, status, {'Content-Type':'text/html; charset=utf-8', ...extra});
}
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function unb64(s) { return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0)); }
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
async function key(secret) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256',enc.encode(secret)), 'AES-GCM', false, ['encrypt','decrypt']);
}
async function seal(data, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(CALLBACK)},await key(secret),enc.encode(JSON.stringify(data)));
  return b64(iv)+'.'+b64(cipher);
}
async function open(value, secret) {
  const [iv,cipher] = value.split('.');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode(CALLBACK)},await key(secret),unb64(cipher))));
}
async function equal(a,b) {
  const [x,y] = await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',enc.encode(s))));
  const xx=new Uint8Array(x), yy=new Uint8Array(y); let diff=0;
  for(let i=0;i<xx.length;i++) diff |= xx[i]^yy[i];
  return diff===0;
}
const cookie = value => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`;
const clear = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
function safeFailure(message) {
  const error = new Error('Private upstream failure');
  error.safeMessage = message;
  return error;
}
async function token(env, fields) {
  try { return await exchangeToken(env, fields); }
  catch (error) {
    if (error.safeMessage) throw error;
        const category = error?.name === 'AbortError' ? 'TOKEN_TIMEOUT' : error?.name === 'TypeError' ? 'TOKEN_REQUEST_TYPE' : 'TOKEN_CONNECTION';
    throw safeFailure(category + ': The Worker could not complete its Dropbox token request. No credentials or raw error details are shown.');
  }
}
async function exchangeToken(env, fields) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try { response=await fetch('https://api.dropbox.com/oauth2/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({...fields,client_id:env.DROPBOX_APP_KEY,client_secret:env.DROPBOX_APP_SECRET}),
    signal:controller.signal, redirect:'manual',
  }); } finally { clearTimeout(timer); }
  if(!response.ok) {
    let code; try { code=(await response.json()).error; } catch {}
    const known={
      invalid_client:'Dropbox rejected the app credentials. Verify DROPBOX_APP_KEY and DROPBOX_APP_SECRET belong to this same Dropbox app, with no extra spaces.',
      invalid_grant:'Dropbox rejected the authorization grant. Start again from the setup page; do not refresh or reuse the callback. If repeated, verify the callback URI and app credentials.',
      invalid_request:'Dropbox rejected the token request parameters. Verify the exact registered callback URI and restart setup.',
      unauthorized_client:'Dropbox does not allow this authorization method for the app. Check its OAuth settings.',
    };
    const error=new Error('Dropbox token request failed');
    error.safeMessage=Object.hasOwn(known,code) ? known[code] : 'Dropbox rejected the token exchange (HTTP '+response.status+'). Check the app configuration and try again.';
    throw error;
  }
    try { return await response.json(); }
  catch { throw safeFailure('TOKEN_RESPONSE: Dropbox returned an unreadable token response. No response contents are shown.'); }
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if(url.origin===ORIGIN && url.pathname.startsWith('/api/')) return await familyApi(request,env);
      return await handle(request,env);
    }
    catch (error) { return page('<p>'+escape(error.safeMessage || 'Request failed. Check secret bindings, Dropbox permissions and callback URL, then start again. No token details are included.')+'</p>',502,{'Set-Cookie':clear}); }
  }
};
async function handle(request,env) {
  const url=new URL(request.url);
  if(url.origin!==ORIGIN) return reply('Use the production Worker URL.',400);
  if(url.pathname==='/health' && request.method==='GET') return reply(JSON.stringify({service:'retrowave-family-sync',version:'1.1.0',ok:true}),200,{'Content-Type':'application/json'});
  if(!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET || typeof env.ADMIN_SETUP_KEY!=='string' || env.ADMIN_SETUP_KEY.length<32)
    return page('<p>Configure DROPBOX_APP_KEY, DROPBOX_APP_SECRET and an ADMIN_SETUP_KEY of at least 32 random characters as Cloudflare secrets.</p>',503);
  if(url.pathname==='/' && request.method==='GET') return page('<p>Private Dropbox setup. Enter your admin setup key. It is sent in the form body, never the URL.</p><form method="post" action="/auth/dropbox/start"><label>Admin setup key <input type="password" name="admin_key" required minlength="32" autocomplete="off"></label> <button>Connect Dropbox</button></form>');
  if(url.pathname==='/auth/dropbox/start' && request.method==='POST') {
    if(request.headers.get('Origin')!==ORIGIN) return reply('Forbidden',403);
    if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return reply('Unsupported form',415);
    const raw=await request.text(); if(raw.length>4096) return reply('Form too large',413);
    if(!await equal(new URLSearchParams(raw).get('admin_key')||'',env.ADMIN_SETUP_KEY)) return reply('Unauthorized',401);
    const state=random(), verifier=random();
    const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier)));
    const target=new URL('https://www.dropbox.com/oauth2/authorize');
    target.search=new URLSearchParams({client_id:env.DROPBOX_APP_KEY,response_type:'code',redirect_uri:CALLBACK,token_access_type:'offline',state,code_challenge:challenge,code_challenge_method:'S256',scope:'files.metadata.read files.content.read'}).toString();
    return reply(null,303,{'Location':target.href,'Set-Cookie':cookie(await seal({state,verifier,expires:Date.now()+600000},env.ADMIN_SETUP_KEY))});
  }
  if(url.pathname==='/auth/dropbox/callback' && request.method==='GET') {
    const value=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    let session; try { session=await open(value||'',env.ADMIN_SETUP_KEY); } catch { return page('<p>Missing or invalid setup session. Start again in the same browser.</p>',400,{'Set-Cookie':clear}); }
    if(session.expires<Date.now() || !await equal(session.state,url.searchParams.get('state')||'')) return page('<p>Expired or mismatched setup session. Start again.</p>',400,{'Set-Cookie':clear});
    if(url.searchParams.has('error')) return page('<p>Dropbox authorization was declined. Start again when ready.</p>',400,{'Set-Cookie':clear});
    const code=url.searchParams.get('code'); if(!code) return reply('Missing authorization code',400,{'Set-Cookie':clear});
    const result=await token(env,{grant_type:'authorization_code',code,redirect_uri:CALLBACK,code_verifier:session.verifier});
    if(typeof result.refresh_token!=='string' || !result.refresh_token) throw safeFailure('NO_REFRESH_TOKEN: Dropbox completed the exchange without a refresh token. Restart setup from the main page and approve offline access.');
    return page('<h2>Save the refresh token privately</h2><p>Copy this directly into a new Cloudflare secret named <strong>DROPBOX_REFRESH_TOKEN</strong> on this Worker. Do not paste it into chat, GitHub, URLs or screenshots. This page is not stored by the Worker; closing it removes this display.</p><textarea readonly autocomplete="off" spellcheck="false">'+escape(result.refresh_token)+'</textarea><p>After saving and deploying the secret, close this tab and clear the clipboard. Use the private library check in the supplied instructions.</p>',200,{'Set-Cookie':clear});
  }
  if(url.pathname==='/admin/library' && request.method==='GET') {
    if(!await equal(request.headers.get('Authorization')||'','Bearer '+env.ADMIN_SETUP_KEY)) return reply('Unauthorized',401);
    if(!env.DROPBOX_REFRESH_TOKEN) return reply('Save DROPBOX_REFRESH_TOKEN as a Cloudflare secret first.',503);
    const auth=await token(env,{grant_type:'refresh_token',refresh_token:env.DROPBOX_REFRESH_TOKEN});
    if(typeof auth.access_token!=='string') throw new Error('No access token');
    let cursor, files=[];
    for(let n=0;n<100;n++) {
      const response=await fetch('https://api.dropboxapi.com/2/files/'+(cursor?'list_folder/continue':'list_folder'),{
        method:'POST',headers:{'Authorization':'Bearer '+auth.access_token,'Content-Type':'application/json'},
        body:JSON.stringify(cursor?{cursor}:{path:'/RetroWave Family Music',recursive:false,include_deleted:false}),signal:AbortSignal.timeout(15000),redirect:'manual'
      });
      if(!response.ok) throw new Error('Dropbox listing failed');
      const data=await response.json();
      files.push(...data.entries.filter(f=>f['.tag']==='file' && /\.mp3$/i.test(f.name)).map(f=>({name:f.name,size:f.size,rev:f.rev})));
      if(!data.has_more) return reply(JSON.stringify({folder:'/RetroWave Family Music',mp3Count:files.length,files}),200,{'Content-Type':'application/json'});
      if(typeof data.cursor!=='string') throw new Error('Missing cursor'); cursor=data.cursor;
    }
    throw new Error('Listing limit reached');
  }
  return reply('Not found',404);
}

// Family API: a separate read-only key; Dropbox/admin credentials never reach the PWA.
async function familyApi(request, env) {
  const allowed = env.PLAYER_ORIGIN || 'https://mi5o-h.github.io';
  const origin = request.headers.get('Origin');
  const cors = {'Access-Control-Allow-Origin':allowed,'Vary':'Origin',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  const respond = (body,status=200,extra={}) => reply(body,status,{...cors,...extra});
  const json = (body,status=200) => respond(JSON.stringify(body),status,{'Content-Type':'application/json'});
  if(origin && origin !== allowed) return reply('Origin not allowed',403);
  if(request.method==='OPTIONS') return respond(null,204);
  if(typeof env.FAMILY_SYNC_KEY!=='string' || env.FAMILY_SYNC_KEY.length<32 || env.FAMILY_SYNC_KEY===env.ADMIN_SETUP_KEY)
    return json({error:'Family access is not configured. Add a separate FAMILY_SYNC_KEY secret of at least 32 random characters.'},503);
  if(!await equal(request.headers.get('Authorization')||'', 'Bearer '+env.FAMILY_SYNC_KEY)) return json({error:'Family key not accepted.'},401);
  const path=new URL(request.url).pathname;
  if(!((path==='/api/library' && request.method==='GET') || (path==='/api/download' && request.method==='POST'))) return json({error:'Not found'},404);
  if(!env.DROPBOX_REFRESH_TOKEN) return json({error:'Dropbox is not connected.'},503);
  try {
    // Validate the folder-bound ticket before any Dropbox calls.
    let grant;
    if(path==='/api/download') {
      if(!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'JSON required'},415);
      const raw=await request.text(); if(raw.length>8192)return json({error:'Request too large'},413);
      try {grant=await open(JSON.parse(raw).ticket,env.FAMILY_SYNC_KEY);}catch{return json({error:'Download link expired. Refresh Library and retry.'},400);}
      if(!Number.isFinite(grant.expires) || grant.expires<Date.now() || typeof grant.path!=='string' ||
        !/^\/RetroWave Family Music\/[^/]+\.mp3$/i.test(grant.path) || typeof grant.rev!=='string' ||
        !Number.isSafeInteger(grant.size) || grant.size<=0 || grant.size>100*1024*1024)
        return json({error:'Download not permitted. Refresh Library; maximum track size is 100 MB.'},400);
    }
    const auth=await token(env,{grant_type:'refresh_token',refresh_token:env.DROPBOX_REFRESH_TOKEN});
    if(typeof auth.access_token!=='string')throw new Error('No access token');
    if(grant) {
      const argument=JSON.stringify({path:grant.path,rev:grant.rev}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
      const upstream=await fetch('https://content.dropboxapi.com/2/files/download',{
        method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'Dropbox-API-Arg':argument},redirect:'manual'
      });
      if(!upstream.ok)return json({error:'Track unavailable. Refresh Library and retry.'},502);
      return respond(upstream.body,200,{'Content-Type':'audio/mpeg','Content-Length':String(grant.size)});
    }
    let cursor;const files=[];
    for(let n=0;n<100;n++) {
      const response=await fetch('https://api.dropboxapi.com/2/files/'+(cursor?'list_folder/continue':'list_folder'),{
        method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json'},
        body:JSON.stringify(cursor?{cursor}:{path:'/RetroWave Family Music',recursive:false,include_deleted:false}),redirect:'manual'
      });
      if(!response.ok)throw new Error('List failed');
      const data=await response.json();
      for(const file of data.entries) {
        if(file['.tag']!=='file'|| !/\.mp3$/i.test(file.name))continue;
        const path=file.path_display;
        if(typeof path!=='string'||!/^\/RetroWave Family Music\/[^/]+\.mp3$/i.test(path))continue;
        files.push({id:file.id,name:file.name,rev:file.rev,size:file.size,
          ticket:await seal({path,rev:file.rev,size:file.size,expires:Date.now()+600000},env.FAMILY_SYNC_KEY)});
      }
      if(!data.has_more)return json({files});
      if(typeof data.cursor!=='string')throw new Error('Missing cursor');cursor=data.cursor;
    }
    throw new Error('Listing limit');
  }catch{return json({error:'Dropbox could not complete the request. Your downloaded music is still available.'},502);}
}
