import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../dist/projection-stateful-indexed-query-v1.js';
import {prepared,indexedLimits,page,count,row,pageResult,offer,deferred} from './fixtures/stateful-indexed-runtime-reference.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const query=(state,request=page())=>state.compose(async read=>({result:await read.query(request)}));

test('one actual owner completed-read scope returns immutable joined records and exact integers',async()=>{
 const s=await prepared();s.adapter.plan(page());let escaped;
 const result=await s.compose(async read=>{escaped=read;assert.deepEqual(Object.keys(read),['view','query']);return {result:await read.query(page())};});
 assert.deepEqual(plain(result.value.result),pageResult());assert.equal(Object.isFrozen(result.value.result.rows[0].records.schema.format[0]),true);
 assert.equal(result.value.result.rows[0].fields.created,'9007199254740993');assert.equal(result.value.result.rows[0].fields.assets,null);
 assert.equal(s.adapter.acquired,1);assert.equal(s.adapter.closed,1);assert.equal(s.adapter.kindCalls,0);assert.equal(s.adapter.getCalls,0);
 assert.equal(sdk.serializeIndexedQueryResultV1(result),JSON.stringify(result.value));
 await assert.rejects(escaped.query(page()),/closed/);assert.equal(s.adapter.queryCalls,1);
});

test('exact counts preserve values above Number safety and charge one response slot',async()=>{
 const s=await prepared();s.adapter.plan(count(),{kind:'count',exact:true,value:'9223372036854775807'},3).plan(page(),pageResult([]));
 const result=await s.compose(async read=>({count:await read.query(count()),empty:await read.query(page())}));
 assert.equal(result.value.count.value,'9223372036854775807');assert.equal(s.adapter.remaining[1].responseRecords,7);assert.equal(s.adapter.remaining[1].readAttempts,9);
 assert.equal(s.adapter.remaining[0].queryBytes,indexedLimits().queryBytes);
 assert.equal(s.adapter.remaining[1].queryBytes,indexedLimits().queryBytes-Buffer.byteLength(JSON.stringify(sdk.captureIndexedRequestV1(s.selection,count()))));
 assert.equal(s.adapter.nativeAttempts,4);assert.equal(s.adapter.closed,1);
});

test('empty/beyond-end windows and a full window retain requested offset and completion meaning',async()=>{
 for(const [offset,rows] of [['9007199254740993',[]],['0',[row('one','0'),row('two','2')]]]){
  const s=await prepared(),request=page({offset});s.adapter.plan(request,pageResult(rows));
  assert.deepEqual(plain((await query(s,request)).value.result.rows),rows);assert.equal(s.adapter.kindCalls,0);
 }
});

test('forged, cloned and foreign-module selections refuse before owner acquisition',async()=>{
 const s=await prepared();let callbacks=0;
 for(const selection of [{...s.selection},structuredClone(s.selection),null,{}])await assert.rejects(sdk.composeStatefulOwnerIndexedReadV1(selection,s.adapter,s.adapter.identity,s.adapter.view,async()=>{callbacks++;return {};},s.adapter.guard));
 const independent=await import('../dist/projection-stateful-indexed-query-v1.js?independent-runtime');
 await assert.rejects(independent.composeStatefulOwnerIndexedReadV1(s.selection,s.adapter,s.adapter.identity,s.adapter.view,async()=>{callbacks++;return {};},s.adapter.guard));
 assert.equal(callbacks,0);assert.equal(s.adapter.acquired,0);
});

test('withdrawn/decreased query offers, comparison profiles and missing operations refuse before acquisition',async()=>{
 for(const change of [a=>{a.indexedCapabilities=undefined;},a=>{a.indexedCapabilities.queryDeclarationDigests=[];},a=>{a.indexedCapabilities.comparisonProfiles=[];},
  a=>{a.indexedCapabilities.limits={...indexedLimits(),responseRecords:1};},a=>{a.queryCompleted=undefined;},a=>{a.capabilities={...a.capabilities,supported:[]};}]){
  const s=await prepared();change(s.adapter);await assert.rejects(query(s));assert.equal(s.adapter.acquired,0);assert.equal(s.adapter.queryCalls,0);
 }
});

test('multi-model dispatch receives the selected immutable declaration, while legacy four-argument single-model implementations still work',async()=>{
 const s=await prepared();const model=structuredClone(s.queryDeclaration.model);model.id='second-model';
 const second=await sdk.captureIndexedDeclarationV1(s.declaration,'model-two',model);s.adapter.addDeclaration(second);
 const selection=sdk.negotiateIndexedQueryV1(second,indexedLimits(),offer([s.queryDeclaration,second]),s.adapter.indexedCapabilities);
 s.adapter.plan(count(),{kind:'count',exact:true,value:'1'}).plan(count(),{kind:'count',exact:true,value:'2'},1,second);
 assert.equal((await query(s,count())).value.result.value,'1');
 assert.equal((await sdk.composeStatefulOwnerIndexedReadV1(selection,s.adapter,s.adapter.identity,s.adapter.view,async read=>({result:await read.query(count())}),s.adapter.guard)).value.result.value,'2');
 const native=s.adapter.queryCompleted.bind(s.adapter);s.adapter.queryCompleted=async function(read,view,request,remaining){return native(read,view,request,remaining);};
 await assert.rejects(query(s,count()),/Ambiguous/);
 const legacy=await prepared();legacy.adapter.plan(count(),{kind:'count',exact:true,value:'3'});const old=legacy.adapter.queryCompleted.bind(legacy.adapter);
 legacy.adapter.queryCompleted=async function(read,view,request,remaining){return old(read,view,request,remaining);};
 assert.equal((await query(legacy,count())).value.result.value,'3');
});

test('wrong returned model/view/backend/generation/revision/checkpoint refuses and closes',async()=>{
 for(const change of [a=>{a.queryDeclarationDigest='f'.repeat(64);},a=>{a.view.declarationDigest='f'.repeat(64);},a=>{a.view.backendId='other';},
  a=>{a.view.generation='other';},a=>{a.view.revision='f'.repeat(64);},a=>{a.view.checkpoint.blockNum++;},a=>{a.view.checkpoint.blockId='f'.repeat(64);}]){
  const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async a=>change(a);await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
});

test('malformed/incomplete/extra/duplicate rows and selection fields refuse without filtering',async()=>{
 const changes=[r=>{r.complete=false;},r=>{delete r.complete;},r=>{r.next='cursor';},r=>{r.rows=[row(),row()];},r=>{r.rows[0].key='';},
  r=>{r.rows[0].fields.created=9007199254740992;},r=>{r.rows[0].fields.created='01';},r=>{r.rows[0].fields.created='9223372036854775808';},
  r=>{r.rows[0].fields.schema=null;},r=>{delete r.rows[0].fields.assets;},r=>{r.rows[0].fields.extra='x';},r=>{r.rows[0].records.extra={};},
  r=>{r.rows[0].records.schema=null;},r=>{r.rows[0].records.collection=null;},r=>{r.rows[0].records.schema.name='wrong';},
  r=>{delete r.rows[0].records.schema.created;},r=>{r.rows[0].records.collection.contract='other';},r=>{r.rows[0].fields.authorized=['alice',7];},
  r=>{r.rows[0].fields.assets='0';},r=>{r.rows[0].records.assets={contract:'fixture',collection:'wrong',schema:'schema-one',total:'0'};r.rows[0].fields.assets='0';}];
 for(const change of changes){const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async a=>change(a.result);await assert.rejects(query(s));assert.equal(s.adapter.closed,1);}
});

test('count result must be exact, canonical, nonnegative int64 and match the requested operation',async()=>{
 for(const result of [{kind:'count',exact:false,value:'1'},{kind:'count',exact:true,value:'-1'},{kind:'count',exact:true,value:'01'},
  {kind:'count',exact:true,value:'9223372036854775808'},{kind:'count',exact:true,value:1},pageResult([])]){
  const s=await prepared();s.adapter.plan(count(),result);await assert.rejects(query(s,count()));assert.equal(s.adapter.closed,1);
 }
 const s=await prepared();s.adapter.plan(page(),{kind:'count',exact:true,value:'1'});await assert.rejects(query(s));
});

test('inert output capture never invokes accessors or accepts sparse/proxy fields',async()=>{
 for(const change of [a=>{Object.defineProperty(a.result.rows[0].fields,'schema',{enumerable:true,get(){throw new Error('getter invoked');}});},
  a=>{a.result.rows=new Array(1);},a=>{a.result.rows[0].fields=new Proxy(a.result.rows[0].fields,{});}]){
  const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async a=>change(a);await assert.rejects(query(s),error=>!/getter invoked/.test(error.message));
 }
});

test('query capture happens before its first await and unsupported syntax never executes native data work',async()=>{
 const s=await prepared();s.adapter.plan(page());const input=page();
 const result=await s.compose(async read=>{const pending=read.query(input);input.where[0].value='mutated';input.select=[];return {result:await pending};});
 assert.equal(result.value.result.rows.length,1);
 for(const request of [page({where:[{field:'unknown',op:'eq',value:'x'}]}),page({offset:'01'}),page({records:['unknown']}),page({order:[]})]){
  const invalid=await prepared();await assert.rejects(query(invalid,request));assert.equal(invalid.adapter.queryCalls,0);assert.equal(invalid.adapter.closed,1);
 }
});

test('attempt and returned-row totals include counts and native retries/cursor operations',async()=>{
 const attempts=await prepared({...indexedLimits(),readAttempts:3});attempts.adapter.plan(count(),{kind:'count',exact:true,value:'9'},2);
 await assert.rejects(attempts.compose(async read=>{await read.query(count());await read.query(count());return {};}),/attempt budget/);assert.equal(attempts.adapter.nativeAttempts,3);
 const rows=await prepared({...indexedLimits(),responseRecords:1});rows.adapter.plan(count(),{kind:'count',exact:true,value:'9'}).plan(page(),pageResult([]));
 await assert.rejects(rows.compose(async read=>{await read.query(count());await read.query(page());return {bad:await read.query(count())};}),/responseRecords/);
 assert.equal(rows.adapter.queryCalls,2);assert.equal(rows.adapter.remaining[1].responseRecords,0);
 for(const attempts of [0,-1,1.5,Number.MAX_SAFE_INTEGER,Infinity]){const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async a=>{a.attempts=attempts;};await assert.rejects(query(s));}
});

test('cumulative query byte/predicate/order/set totals refuse before another native command',async()=>{
 const request=page({where:[{field:'schema',op:'in',values:['one','two']}]}),bytes=Buffer.byteLength(JSON.stringify(sdk.captureIndexedRequestV1((await prepared()).selection,request)));
 for(const bounds of [{queryBytes:bytes},{predicates:1},{orderTerms:2},{setValues:2}]){
  const s=await prepared({...indexedLimits(),...bounds});s.adapter.plan(request);
  await assert.rejects(s.compose(async read=>{await read.query(request);await read.query(request);return {};}),/total exceeded/);assert.equal(s.adapter.queryCalls,1);assert.equal(s.adapter.closed,1);
 }
});

test('all envelopes, joined payloads, UTF8/escaping and final view/body consume one byte total',async()=>{
 const first=await prepared();first.adapter.plan(page());const result=await query(first),total=Buffer.byteLength(JSON.stringify(first.adapter.answered[0]))+Buffer.byteLength(JSON.stringify(result));
 const exact=await prepared({...indexedLimits(),responseBytes:total});exact.adapter.plan(page());assert.deepEqual(plain((await query(exact)).value),plain(result.value));
 const short=await prepared({...indexedLimits(),responseBytes:total-1});short.adapter.plan(page());await assert.rejects(query(short),/byte bound/);assert.equal(short.adapter.closed,1);
 const countOnly=await prepared({...indexedLimits(),responseBytes:1});countOnly.adapter.plan(count(),{kind:'count',exact:true,value:'1'});await assert.rejects(query(countOnly,count()));assert.equal(countOnly.adapter.queryCalls,0);
});

test('caught query failures poison completion and prevent subsequent native work',async()=>{
 for(const mode of ['throw','malformed','over-budget']){
  const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async a=>{if(mode==='throw')throw new Error('native failed');if(mode==='malformed')a.result.complete=false;else a.attempts=99;};
  await assert.rejects(s.compose(async read=>{try{await read.query(page());}catch{}try{await read.query(page());}catch{}return {apparently:'fine'};}));
  assert.equal(s.adapter.queryCalls,1);assert.equal(s.adapter.closed,1);
 }
});

test('concurrent operations never share one remaining allowance',async()=>{
 const s=await prepared(),gate=deferred(),entered=deferred();s.adapter.plan(page());s.adapter.beforeQuery=async()=>{entered.resolve();await gate.promise;};let first;
 const composed=s.compose(async read=>{first=read.query(page());await Promise.race([entered.promise,first]);const second=read.query(page());gate.resolve();try{await second;}catch{}try{await first;}catch{}return {};});
 await assert.rejects(composed,/concurrent/);assert.equal(s.adapter.queryCalls,1);assert.equal(s.adapter.closed,1);
});

test('dropped pending work refuses composition, closes immediately, and cannot publish a late answer',async()=>{
 const s=await prepared(),gate=deferred(),entered=deferred();s.adapter.plan(page());s.adapter.beforeQuery=async()=>{entered.resolve();await gate.promise;};let pending;
 try{await assert.rejects(s.compose(async read=>{pending=read.query(page());await Promise.race([entered.promise,pending]);return {};}),/unawaited/);}
 finally{gate.resolve();}
 assert.equal(s.adapter.closed,1);await assert.rejects(pending);assert.equal(s.adapter.answered.length,0);
});

test('callback errors, acquisition fences and every controlled authority failure close existing read capabilities',async()=>{
 const callback=await prepared();await assert.rejects(callback.compose(async()=>{throw new Error('callback failed');}),/callback failed/);assert.equal(callback.adapter.closed,1);
 const acquired=await prepared(),native=acquired.adapter.completedRead.bind(acquired.adapter);
 acquired.adapter.completedRead=async(...args)=>{const read=await native(...args);acquired.adapter.flags.cancelled=true;return read;};
 await assert.rejects(query(acquired));assert.equal(acquired.adapter.closed,1);
 for(const flag of ['cancelled','expired','fork','mapping','coverage']){
  const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async()=>{s.adapter.flags[flag]=true;};await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
});

test('owner takeover, phase failure and dishonest post-query revision movement are fenced',async()=>{
 for(const change of [a=>{a.identity.generation='takeover';},a=>{a.phase='raw';},a=>{a.phase='pending';},a=>{a.phase='gap';},a=>{a.phase='rollback';},
  a=>{a.view.revision='f'.repeat(64);},a=>{a.view.generation='replacement';},a=>{a.view.checkpoint.blockNum++;}]){
  const s=await prepared();s.adapter.plan(page());s.adapter.dishonest=true;s.adapter.beforeAnswer=async()=>change(s.adapter);await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
});

test('the port retires before final asynchronous view validation',async()=>{
 const s=await prepared();s.adapter.plan(page());let escaped,calls=0,late;const current=s.adapter.completedView.bind(s.adapter);
 s.adapter.completedView=async read=>{calls++;if(calls===4){late=escaped.query(page());await assert.rejects(late,/closed/);}return current(read);};
 await assert.rejects(s.compose(async read=>{escaped=read;return {result:await read.query(page())};}),/closed/);assert.equal(s.adapter.closed,1);assert.equal(s.adapter.queryCalls,1);
});

test('final serialization/cache guard retains the original deadline, owner and coverage and refuses copied DTOs',async()=>{
 for(const flag of ['cancelled','expired','fork','mapping','coverage']){
  const s=await prepared();s.adapter.plan(page());const result=await query(s);sdk.assertIndexedQueryPublicationV1(result);s.adapter.flags[flag]=true;
  assert.throws(()=>sdk.serializeIndexedQueryResultV1(result));assert.throws(()=>sdk.assertIndexedQueryPublicationV1(result));assert.equal(s.adapter.acquired,1);assert.equal(s.adapter.closed,1);
  s.adapter.flags[flag]=false;assert.throws(()=>sdk.serializeIndexedQueryResultV1(result));
 }
 const s=await prepared();s.adapter.plan(page());const result=await query(s);assert.throws(()=>sdk.serializeIndexedQueryResultV1(structuredClone(result)),/locally completed/);
 assert.throws(()=>sdk.assertIndexedQueryPublicationV1({view:result.view,value:result.value}),/locally completed/);
});

test('publication uses the same bound owner/view authority after the native capability has closed',async()=>{
 for(const change of [a=>{a.identity.generation='new-owner';},a=>{a.view.revision='f'.repeat(64);},a=>{a.view.generation='new-generation';},
  a=>{a.view.checkpoint.blockId='f'.repeat(64);},a=>{a.phase='pending';}]){
  const s=await prepared();s.adapter.plan(page());const result=await query(s);change(s.adapter);
  assert.throws(()=>sdk.serializeIndexedQueryResultV1(result));assert.equal(s.adapter.closed,1);assert.equal(s.adapter.acquired,1);
 }
});

test('capability retirement during a native await is observed even when plugin code catches the query failure',async()=>{
 const s=await prepared();s.adapter.plan(page());s.adapter.beforeAnswer=async()=>{s.adapter.indexedCapabilities={...s.adapter.indexedCapabilities,queryDeclarationDigests:[]};};
 await assert.rejects(s.compose(async read=>{try{await read.query(page());}catch{}return {};}),error=>error.code==='stateful.capability-unavailable');
 assert.equal(s.adapter.closed,1);
});

test('response capture and cumulative resource failures keep the retryable stateful unavailable code',async()=>{
 const bytes=await prepared({...indexedLimits(),responseBytes:1024});bytes.adapter.plan(page());
 await assert.rejects(query(bytes),error=>error.code==='stateful.unavailable');
 const malformed=await prepared();malformed.adapter.plan(page());malformed.adapter.beforeAnswer=async a=>{a.result.complete=false;};
 await assert.rejects(query(malformed),error=>error.code==='stateful.unavailable');
});

test('optional canonical records never read inherited alias names',async()=>{
 const s=await prepared(),model=structuredClone(s.queryDeclaration.model);model.base.alias='constructor';
 for(const field of model.fields)if(field.alias==='schema')field.alias='constructor';
 const declaration=await sdk.captureIndexedDeclarationV1(s.declaration,'constructor-alias',model);
 const selection=sdk.negotiateIndexedQueryV1(declaration,indexedLimits(),offer([declaration]),offer([declaration]));
 const request=page({records:[]}),result=pageResult([{key:'one',fields:row('one').fields,records:{}}]);
 assert.deepEqual(plain(sdk.captureIndexedResultV1(selection,request,result)),result);
});

test('a well-formed complete DTO cannot establish native window truthfulness by itself',async()=>{
 const s=await prepared();s.adapter.plan(page(),pageResult([row('one'),row('two')]));
 s.adapter.beforeAnswer=async a=>{a.result.rows=[];};
 assert.deepEqual(plain((await query(s)).value.result.rows),[]);
 // The SDK sees the adapter's claim; real native completion/coverage needs independent adapter qualification.
});

test('failed closure cannot return a successful composition',async()=>{
 const s=await prepared();s.adapter.plan(page());const close=s.adapter.closeRead.bind(s.adapter);
 s.adapter.closeRead=read=>{close(read);throw new Error('close failed');};
 await assert.rejects(query(s),/close failed/);assert.equal(s.adapter.closed,1);
});
