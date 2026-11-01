import test from 'node:test';
import assert from 'node:assert/strict';
import {negotiateOperatorListsV1 as negotiate, readOperatorListsV1 as read} from '../dist/operator-lists.js';
const limits={names:3,items:5,bytes:100,attempts:2};
const cap={family:'operator-list-read',interfaceVersion:1,limits};
const select=()=>negotiate(limits,cap,cap);
const provider=(entries, extra={})=>({capabilities:cap,read:async()=>({source:'operator',generation:'config-1',complete:true,attempts:1,entries,...extra})});
const run=(p,n=['a'])=>read(select(),p,n,'operator','config-1',()=>{});
test('negotiation requires independent compatible bounded offers',()=>{
  assert.throws(()=>negotiate(limits,cap,{...cap,interfaceVersion:2}));
  assert.throws(()=>negotiate({...limits,items:6},cap,cap));
  assert.throws(()=>negotiate({...limits,attempts:0},cap,cap));
});
test('complete empty and missing results remain distinct from unavailable',async()=>{
  assert.deepEqual((await run(provider([{name:'a',items:[]}]))).entries[0].items,[]);
  for(const bad of [provider([]),provider([{name:'a',items:[]}],{complete:false}),provider([{name:'a',items:[]}],{source:'other'}),provider([{name:'a',items:[]}],{generation:'other'}),provider([{name:'a',items:[]}],{attempts:3})]) await assert.rejects(run(bad));
});
test('results detach and freeze, preserve duplicate items and byte budgets',async()=>{
  const rows=[{name:'a',items:['x','x']}]; const result=await run(provider(rows)); rows[0].items.push('later');
  assert.deepEqual(result.entries[0].items,['x','x']); assert.ok(Object.isFrozen(result.entries[0].items));
  assert.equal((await run(provider([{name:'a',items:['\u00e9'.repeat(49)]}]))).entries[0].items[0].length,49);
  await assert.rejects(run(provider([{name:'a',items:['\u00e9'.repeat(50)]}])));
  await assert.rejects(run(provider([{name:'a',items:Array(6).fill('x')}])));
  await assert.rejects(run(provider([]),['a','a']));
});
test('host cancellation after pending provider and malformed accessors fail closed',async()=>{
  let release; let cancelled=false; const p=provider([]); p.read=()=>new Promise(r=>{release=r});
  const pending=read(select(),p,['a'],'operator','config-1',()=>{if(cancelled) throw Error('cancelled')});
  cancelled=true; release({source:'operator',generation:'config-1',complete:true,attempts:1,entries:[{name:'a',items:[]}]}); await assert.rejects(pending,/cancelled/);
  let called=0; const row={name:'a'}; Object.defineProperty(row,'items',{enumerable:true,get(){called++;return []}});
  await assert.rejects(run(provider([row]))); assert.equal(called,0);
});
test('Atomic schema request shape: comma tokens, nonrecursive expansion, duplicates and empty filter',async()=>{
  // Mirrors reference lists.ts and schemas.ts; the SDK deliberately does not parse domain input.
  const tokens='$list:whitelist,alpha,$list:missing,$list:whitelist'.split(',');
  const names=[...new Set(tokens.filter(x=>x.startsWith('$list:')).map(x=>x.slice(6)))];
  const out=await run(provider([{name:'whitelist',items:['beta','$list:nested']},{name:'missing',items:[]}]),names);
  const map=new Map(out.entries.map(e=>[e.name,e.items]));
  const expanded=tokens.flatMap(x=>x.startsWith('$list:')?map.get(x.slice(6)):[x]);
  assert.deepEqual(expanded,['beta','$list:nested','alpha','beta','$list:nested']);
  assert.equal((await run(provider([{name:'missing',items:[]}]),['missing'])).entries[0].items.length,0);
});

test('five-minute reference cache keeps old data on ordinary update but isolates source generations',async()=>{
  let now=0, items=['old']; const cache=new Map();
  const cached=(generation)=>({capabilities:cap,read:async names=>{const key=`operator:${generation}:${names[0]}`; let hit=cache.get(key);
    if (!hit || now-hit.at>=300000) {hit={at:now,items:[...items]};cache.set(key,hit)}
    return {source:'operator',generation,complete:true,attempts:1,entries:[{name:names[0],items:hit.items}]};}});
  const get=async generation=>(await read(select(),cached(generation),['a'],'operator',generation,()=>{})).entries[0].items;
  assert.deepEqual(await get('config-1'),['old']); items=['new']; now=299999;
  assert.deepEqual(await get('config-1'),['old']); assert.deepEqual(await get('config-2'),['new']);
  now=300000; assert.deepEqual(await get('config-1'),['new']);
});

test('proxy names, entries, items and records are rejected without invoking traps',async()=>{
  let traps=0; const proxy=x=>new Proxy(x,{get(t,k,r){traps++; return Reflect.get(t,k,r)},getPrototypeOf(t){traps++;return Reflect.getPrototypeOf(t)},ownKeys(t){traps++;return Reflect.ownKeys(t)},getOwnPropertyDescriptor(t,k){traps++;return Reflect.getOwnPropertyDescriptor(t,k)}});
  await assert.rejects(run(provider([]),proxy(['a']))); assert.equal(traps,0);
  await assert.rejects(run(provider(proxy([{name:'a',items:['alice']}])))); assert.equal(traps,0);
  await assert.rejects(run(provider([{name:'a',items:proxy(['alice'])}]))); assert.equal(traps,0);
  await assert.rejects(run(provider([proxy({name:'a',items:[]})]))); assert.equal(traps,0);
  let intercepted=0; const entries=new Proxy([{name:'a',items:['alice']}],{get(t,k,r){intercepted++; if(k==='map') return ()=>[]; return Reflect.get(t,k,r)}});
  await assert.rejects(run(provider(entries))); assert.equal(intercepted,0);
});
test('sparse extended and accessor arrays refuse before invoking accessors',async()=>{
  let called=0; const sparse=Array(1); const extended=['a']; extended.extra=true;
  const accessor=['a']; Object.defineProperty(accessor,0,{enumerable:true,get(){called++;return 'a'}});
  for(const a of [sparse,extended,accessor]) await assert.rejects(run(provider([]),a));
  assert.equal(called,0);
  const items=['x']; Object.defineProperty(items,0,{enumerable:true,get(){called++;return 'x'}});
  await assert.rejects(run(provider([{name:'a',items}]))); assert.equal(called,0);
});
test('capability drift while provider is pending fails before accepting results',async()=>{
  for(const changed of [{...cap,family:'other'},{...cap,interfaceVersion:2},{...cap,limits:{...limits,items:0}}]) {
    let release; const p=provider([]); p.read=()=>new Promise(r=>{release=r});
    const pending=run(p); p.capabilities=changed;
    release({source:'operator',generation:'config-1',complete:true,attempts:1,entries:[{name:'a',items:[]}]});
    await assert.rejects(pending);
  }
});

test('instrumented cache reports actual native attempts and preserves all result checks',async()=>{
  let now=0, nativeReads=0, stored=['old']; const cache=new Map(), attempts=[];
  const make=generation=>({capabilities:cap,async read(names) {
    const key=`operator:${generation}:${names[0]}`; let hit=cache.get(key), actual=0;
    if (!hit || now-hit.at>=300000) {nativeReads++; actual++; hit={at:now,items:[...stored]}; cache.set(key,hit);}
    attempts.push(actual); return {source:'operator',generation,complete:true,attempts:actual,entries:[{name:names[0],items:hit.items}]};
  }});
  const get=async generation=>(await read(select(),make(generation),['a'],'operator',generation,()=>{})).entries[0].items;
  assert.deepEqual(await get('g1'),['old']); stored=['new']; now=299999;
  assert.deepEqual(await get('g1'),['old']); now=300000; assert.deepEqual(await get('g1'),['new']);
  assert.deepEqual(await get('g2'),['new']); assert.deepEqual(await get('g2'),['new']);
  assert.deepEqual(attempts,[1,0,1,1,0]); assert.equal(nativeReads,3);
  for(const value of [-1,0.5,3]) await assert.rejects(run(provider([{name:'a',items:[]}],{attempts:value})));
  for(const invalid of [{complete:false},{source:'other'},{generation:'other'}]) await assert.rejects(run(provider([{name:'a',items:[]}],{attempts:0,...invalid})));
  await assert.rejects(run(provider([{name:'a',items:Array(6).fill('x')}],{attempts:0})));
  await assert.rejects(run(provider([{name:'a',items:['x'.repeat(100)]}],{attempts:0})));
  await assert.rejects(read(select(),make('g1'),['a','b','c','d'],'operator','g1',()=>{}));
  await assert.rejects(read(select(),provider([{name:'a',items:[]}],{attempts:0}),['a'],'operator','config-1',()=>{throw Error('cancelled')}));
  const bad=provider([{name:'a',items:[]}],{attempts:0}); bad.capabilities={...cap,interfaceVersion:2}; await assert.rejects(run(bad));
});
