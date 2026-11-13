/* Family downloads use the existing local library. No Dropbox/admin secrets here. */
(() => {
  'use strict';
  const endpoint='https://retrowave-family-sync.moyassar-h.workers.dev';
  let familyKey='', remote=[], busy=false, controller=null;
  const el=id=>document.getElementById(id);
  const say=message=>{el('family-status').textContent=message;};
  function setBusy(value){
    busy=value;
    for(const id of ['family-connect','family-refresh','family-all','family-forget','family-auto'])el(id).disabled=value;
    el('family-cancel').hidden=!value;
    draw();
  }
  function showKeyEntry(show){el('family-key').closest('label').hidden=!show;el('family-connect').hidden=!show;}
  function forgetKey(){try{localStorage.removeItem('retrowave-family-key')}catch{}}
  function rememberKey(){try{localStorage.setItem('retrowave-family-key',familyKey)}catch{}}
  async function api(path, options={}){
    const response=await fetch(endpoint+path,{...options,credentials:'omit',cache:'no-store',redirect:'error',
      signal:controller?.signal,headers:{Authorization:'Bearer '+familyKey,...options.headers}});
    if(!response.ok){
      if(response.status===401){forgetKey();familyKey='';showKeyEntry(true);throw new Error('Family key not accepted. Re-enter your family key.');}
      if(response.status===503)throw new Error('Family sync needs setup on the Worker. Local playback is available.');
      throw new Error('Dropbox request failed. Refresh Library and retry; local music is safe.');
    }
    return response;
  }
  async function listing(){
    const data=await (await api('/api/library')).json();
    if(!Array.isArray(data.files)||data.files.some(t=>typeof t.id!=='string'||typeof t.rev!=='string'||typeof t.name!=='string'||typeof t.ticket!=='string'||!Number.isSafeInteger(t.size)))
      throw new Error('Library response was not valid.');
    remote=data.files;rememberKey();showKeyEntry(false);
  }
  function localFor(track){return tracks.find(t=>t.cloudId===track.id);}
  function draw(){
    const root=el('family-tracks');root.replaceChildren();
    for(const track of remote){
      const saved=localFor(track), upToDate=saved?.cloudRev===track.rev;
      const row=document.createElement('div');row.className='row';
      const name=document.createElement('span');name.className='family-name';name.textContent=track.name;
      const button=document.createElement('button');button.type='button';
      button.textContent=upToDate?'✓ OFFLINE':saved?'UPDATE':'DOWNLOAD';
      button.disabled=busy||upToDate||track.size<=0||track.size>100*1024*1024;
      button.setAttribute('aria-label',button.textContent+' '+track.name);
      button.onclick=()=>run(async()=>{await download(track);say('Saved for offline playback: '+track.name);});
      row.append(name,button);root.append(row);
    }
  }
  function save(track,blob){
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('tracks','readwrite');const store=transaction.objectStore('tracks');
      const request=store.getAll();
      request.onsuccess=()=>{
        const old=request.result.find(t=>t.cloudId===track.id);
        store.put({...old,name:track.name,blob,added:old?.added||Date.now(),cloudId:track.id,cloudRev:track.rev});
      };
      transaction.oncomplete=resolve;
      transaction.onerror=()=>reject(transaction.error||new Error('Could not save track.'));
      transaction.onabort=()=>reject(transaction.error||new Error('Storage write cancelled.'));
    });
  }
  async function download(track){
    if(localFor(track)?.cloudRev===track.rev)return;
    if(track.size<=0||track.size>100*1024*1024)throw new Error('Track exceeds the 100 MB download limit.');
    const estimate=await navigator.storage?.estimate?.().catch(()=>null);
    if(estimate?.quota && estimate.quota-estimate.usage < track.size*1.15)throw new Error('Not enough device storage. Free space and retry.');
    // Tickets expire; obtain a fresh revision-bound ticket before each download.
    await listing();
    const latest=remote.find(t=>t.id===track.id);
    if(!latest)throw new Error('Track was removed from Dropbox. Your existing local copy is kept.');
    if(latest.rev!==track.rev)throw new Error('Track changed in Dropbox. Refresh Library and retry.');
    say('Downloading '+track.name+'… Keep RetroWave open.');
    const response=await api('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:latest.ticket})});
    const blob=await response.blob();
    if(blob.size!==track.size)throw new Error('Incomplete download. Existing local copy was kept; retry.');
    if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    try{await save(track,blob);}catch{throw new Error('Could not save audio. Free device storage and retry.');}
    await refresh();draw();
  }
  async function downloadAll(){
    const pending=remote.filter(t=>localFor(t)?.cloudRev!==t.rev);
    let done=0;
    for(const track of pending){
      if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
      await download(track);done++;
      say('Saved '+done+' / '+pending.length+' tracks.');
    }
    say(pending.length?'Downloads complete. Saved tracks work offline.':'All family tracks are already saved offline.');
  }
  async function run(task){
    if(busy)return;
    if(!familyKey){say('Enter the family key and choose Connect.');return;}
    controller=new AbortController();setBusy(true);
    try{await window.retrowaveReady;if(!db)throw new Error('Device storage is unavailable.');await task();}
    catch(error){say(error.name==='AbortError'?'Download cancelled. Completed tracks remain saved.':error.message);}
    finally{controller=null;setBusy(false);}
  }
  el('family-connect').onclick=()=>{
    const value=el('family-key').value.trim();
    if(value.length<32){say('Enter the separate family key (at least 32 characters), not the admin password.');return;}
    familyKey=value;el('family-key').value='';
    run(async()=>{await listing();say(remote.length+' family tracks found.');if(el('family-auto').checked)await downloadAll();});
  };
  el('family-refresh').onclick=()=>run(async()=>{await listing();say(remote.length+' family tracks found.');if(el('family-auto').checked)await downloadAll();});
  el('family-all').onclick=()=>run(async()=>{await listing();await downloadAll();});
  el('family-cancel').onclick=()=>controller?.abort();
  el('family-forget').onclick=()=>{forgetKey();familyKey='';showKeyEntry(true);remote=[];el('family-key').value='';draw();say('Disconnected. Downloaded music stays on this device.');};
  el('family-auto').onchange=()=>{if(el('family-auto').checked)say('New and updated tracks download when you connect or refresh. Keep the app open.');};
  document.addEventListener('retrowave-library-changed',draw);
  navigator.storage?.persist?.().catch(()=>{});
  try{const saved=localStorage.getItem('retrowave-family-key');if(saved&&saved.length>=32){familyKey=saved;showKeyEntry(false);say('Family key remembered on this device. Refresh Library when online.');if(navigator.onLine!==false)run(async()=>{await listing();say(remote.length+' family tracks found. Family key remembered on this device.');});}}catch{}
})();
