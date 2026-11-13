import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync('index.html','utf8');
// Presentation was replaced; test the functional control instead of old CSS.
assert.match(html,/id="eq-bands"/);
const ids=new Map();const get=id=>{if(!ids.has(id))ids.set(id,{value:'flat',checked:true,replaceChildren(){},append(){},setAttribute(){}});return ids.get(id)};
const storage=new Map();const context={navigator:{userAgent:'Desktop',platform:'Win32',maxTouchPoints:0},$:get,document:{addEventListener(){},querySelectorAll:()=>[],createElement:()=>({append(){},setAttribute(){}})},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)}};vm.createContext(context);
const block=html.slice(html.indexOf('const eqFreq='),html.indexOf('function initEq(){'));
vm.runInContext(block,context);
const profiles=vm.runInContext('Object.keys(eqPresets)',context);assert.equal(profiles.length,12);
for(const name of profiles){context.applyPreset(name);const values=vm.runInContext('eqValues',context);assert.equal(values.length,10);assert.ok(values.every(v=>Number.isFinite(v)&&v>=-12&&v<=12));assert.deepEqual(JSON.parse(storage.get('retrowave-eq')).values,Array.from(values))}
console.log('PASS 12 profiles have valid gains and save their values');
vm.runInContext('eqFilters=Array.from({length:10},()=>({gain:{value:0}}))',context);get('eq-on').checked=false;get('eq-on').onchange();assert.ok(vm.runInContext('eqFilters.every(f=>f.gain.value===0)',context));assert.equal(JSON.parse(storage.get('retrowave-eq')).enabled,false);console.log('PASS EQ bypass zeroes gains and persists disabled state');
get('eq-on').checked=true;get('eq-preset').value='dance';get('eq-preset').onchange({target:get('eq-preset')});assert.equal(JSON.parse(storage.get('retrowave-eq')).preset,'dance');console.log('PASS selecting a profile saves selected name');
get('eq-reset').onclick();assert.ok(vm.runInContext('eqValues.every(v=>v===0)',context));assert.equal(get('eq-preset').value,'flat');console.log('PASS reset restores flat profile');
const restore=block.slice(block.indexOf('try{const saved=')).split('// iPhone/iPad')[0];
storage.set('retrowave-eq',JSON.stringify({preset:'jazz',enabled:false,values:[1,2,3,4,5,6,7,8,9,10]}));vm.runInContext(restore,context);assert.equal(get('eq-preset').value,'jazz');assert.equal(get('eq-on').checked,false);assert.equal(get('eq-band-9').value,10);console.log('PASS profile and sliders restore after reload');
storage.set('retrowave-eq','bad json');assert.doesNotThrow(()=>vm.runInContext(restore,context));console.log('PASS corrupt saved settings do not break player');
