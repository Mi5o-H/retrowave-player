import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const script=fs.readFileSync('family-sync.js','utf8');
const nodes=new Map();function node(){return {value:'',checked:false,disabled:false,hidden:false,textContent:'',children:[],setAttribute(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}}}
const records=[{id:1,name:'existing-import.mp3',blob:new Blob(['local'])}];let failure=false;
const context={console,Blob,DOMException,AbortController,Event,document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node,addEventListener(){}},navigator:{storage:{estimate:async()=>({quota:10000000,usage:0}),persist:async()=>false}},tracks:records.slice(),db:{transaction(){const transaction={error:null};const store={getAll(){const req={};queueMicrotask(()=>{req.result=records.slice();req.onsuccess()});return req},put(data){queueMicrotask(()=>{if(failure){transaction.error=new DOMException('Full','QuotaExceededError');transaction.onabort();return}const row={...data,id:data.id||Math.max(...records.map(t=>t.id))+1};const i=records.findIndex(t=>t.id===row.id);if(i<0)records.push(row);else records[i]=row;transaction.oncomplete()})}};transaction.objectStore=()=>store;return transaction}},refresh:async()=>{context.tracks=records.slice()},window:{retrowaveReady:Promise.resolve()}};
const track={id:'id:cloud',name:'family.mp3',rev:'r1',size:3,ticket:'fake-ticket'};let downloadBytes='abc';let online=true;const requests=[];
context.fetch=async(url,options)=>{requests.push({url,options});if(!online)throw new TypeError('Offline');if(url.endsWith('/api/library'))return Response.json({files:[track]});return new Response(downloadBytes)};
vm.createContext(context);
vm.runInContext(script.replace(/\}\)\(\);\s*$/,`globalThis.test={listing,download,save,run,downloadAll,setKey:value=>familyKey=value};})();`),context);
context.test.setKey('fake-family-key');let n=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);n++};
await check('download saves blob alongside existing imports',async()=>{await context.test.run(()=>context.test.download(track));assert.equal(records.length,2);assert.equal(records[0].name,'existing-import.mp3');assert.equal(await records[1].blob.text(),'abc')});
await check('repeat download does not duplicate saved revision',async()=>{await context.test.run(()=>context.test.download(track));assert.equal(records.length,2)});
await check('revision update keeps local ID',async()=>{track.rev='r2';downloadBytes='xyz';await context.test.run(()=>context.test.download(track));assert.equal(records.length,2);assert.equal(records[1].id,2);assert.equal(records[1].cloudRev,'r2')});
await check('incomplete download preserves previous playable blob',async()=>{track.rev='r3';downloadBytes='a';await context.test.run(()=>context.test.download(track));assert.equal(records[1].cloudRev,'r2');assert.equal(await records[1].blob.text(),'xyz');assert.match(nodes.get('family-status').textContent,/Incomplete/)});
await check('storage failure leaves previous revision intact',async()=>{downloadBytes='abc';failure=true;await context.test.run(()=>context.test.download(track));failure=false;assert.equal(records[1].cloudRev,'r2');assert.match(nodes.get('family-status').textContent,/storage/)});
await check('offline refresh preserves all saved music',async()=>{online=false;await context.test.run(()=>context.test.listing());online=true;assert.equal(records.length,2);assert.equal(await records[0].blob.text(),'local')});
await check('disconnect clears in-memory access without deleting downloads',async()=>{nodes.get('family-forget').onclick();assert.equal(records.length,2);await context.test.run(()=>context.test.listing());assert.match(nodes.get('family-status').textContent,/Enter the family key/)});
await check('no admin or Dropbox credentials sent by player',async()=>{for(const {options}of requests){assert.equal(options.headers.Authorization,'Bearer fake-family-key');assert.equal(options.credentials,'omit')}});
// Exercise the actual refresh function against a library whose indices shift.
const html=fs.readFileSync('index.html','utf8');
const fn=html.match(/async function refresh\(\)\{[^\n]+/)[0];
const refreshContext={tracks:[{id:1},{id:2}],current:1,all:async()=>[{id:2},{id:3}],$:()=>({}),render(){},document:{dispatchEvent(){}},Event};vm.createContext(refreshContext);vm.runInContext(fn,refreshContext);
await check('library refresh keeps current selection by track identity',async()=>{await refreshContext.refresh();assert.equal(refreshContext.current,0);assert.equal(refreshContext.tracks[0].id,2)});
console.log(n+' player checks passed; browser and iOS testing still required.');
