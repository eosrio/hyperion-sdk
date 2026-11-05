import assert from 'node:assert/strict';
import test from 'node:test';
import * as execution from '../dist/projection-stateful-indexed-execution-v1.js';
import * as indexed from '../dist/projection-stateful-indexed-query-v1.js';
import {prepared as legacy,indexedLimits,page,count,pageResult,deferred} from './fixtures/stateful-indexed-runtime-reference.mjs';

const value=()=>({kind:'outcome',code:'execution-error',profile:'controlled-execution-v1'});
const success=()=>({kind:'result',result:{kind:'count',exact:true,value:'9007199254740993'}});
async function prepared(bounds=indexedLimits()){
 const s=await legacy(bounds);
 const declaration=await execution.captureIndexedExecutionDeclarationV1(s.declaration,s.selection,'execution-one',{
  profile:'controlled-execution-v1',outcomes:[{code:'execution-error',requestKinds:['page']},{code:'statement-timeout',requestKinds:['page','count']}]});
 const offer={family:execution.STATEFUL_INDEXED_EXECUTION_FAMILY_V1,interfaceVersion:1,
  executionDeclarationDigests:[declaration.digest],profiles:['controlled-execution-v1'],limits:bounds};
 const selection=execution.negotiateIndexedExecutionV1(declaration,offer,offer);
 s.adapter.indexedExecutionCapabilities=structuredClone(offer);
 s.events=[];s.candidate=value();s.attempts=1;s.nativeId=0;
 const port={async begin(context){
  s.events.push('begin');assert.equal(Object.isFrozen(context.request),true);s.context=context;
  if(s.reuse)return s.nativeOperation;
  const executionId=s.idOverride??String(++s.nativeId),expected=structuredClone(s.candidate);
  const native={executionId,async verifyTerminal(candidate){s.events.push('terminal');assert.deepEqual(JSON.parse(JSON.stringify(candidate.result)),expected);if(s.terminalFailure)throw Error('terminal unverified');if(s.afterTerminal)s.afterTerminal();return s.terminalReturn;},
   async closeOwned(){s.events.push('close');if(s.closeUndefined)throw undefined;if(s.closeFailure)throw Error('close failed');if(s.afterClose)s.afterClose();return s.closeReturn;},
   async assertClosed(){s.events.push('closure');if(s.closureUndefined)throw undefined;if(s.closureFailure)throw Error('closure unverified');if(s.afterClosed)s.afterClosed();return s.closureReturn;}};
  if(s.missing)delete native[s.missing];s.nativeOperation=native;return native;
 }};
 const observer=execution.createIndexedExecutionObserverV1(selection,offer,port);
 s.adapter.executeCompleted=async function(read,view,request,remaining,selected,operation){
  s.events.push('execute');this.use(read,view);s.operation=operation;s.remaining=remaining;
  if(s.beforeExecute)await s.beforeExecute();
  return {view:structuredClone(view),executionDeclarationDigest:selected.digest,executionId:operation.executionId,
   result:structuredClone(s.candidate),attempts:s.attempts};
 };
 const identity=structuredClone(s.adapter.identity),view=structuredClone(s.adapter.view);
 const authority=()=>{s.adapter.guard();assert.deepEqual(s.adapter.identity,identity,'owner generation changed');assert.deepEqual(s.adapter.view,view,'source view changed');};
 s.compose=(use,guard=authority)=>execution.composeStatefulOwnerIndexedExecutionV1(selection,s.adapter,observer,identity,view,use,guard);
 return Object.assign(s,{selection,declaration,offer,observer,port});
}
const query=s=>s.compose(async read=>({answer:await read.query(page())}));

test('independently negotiated semantic outcome closes the exact owned operation before publication',async()=>{
 const s=await prepared();const result=await query(s);
 assert.deepEqual(JSON.parse(JSON.stringify(result.value.answer)),value());assert.deepEqual(s.events,['begin','execute','terminal','close','closure']);
 assert.equal(s.adapter.closed,1);assert.equal(execution.serializeIndexedExecutionResultV1(result),JSON.stringify(result.value));
 assert.throws(()=>execution.assertIndexedExecutionPublicationV1(structuredClone(result)),/locally completed/);
 s.adapter.flags.fork=true;assert.throws(()=>execution.serializeIndexedExecutionResultV1(result),/fork/);
});
test('success preserves the old exact count shape and cumulative totals',async()=>{
 const s=await prepared();s.candidate=success();let second;
 const native=s.adapter.executeCompleted;s.adapter.executeCompleted=async(...args)=>{if(second===undefined)second=false;else assert.equal(args[3].responseRecords,7);return native.apply(s.adapter,args);};
 const result=await s.compose(async read=>({one:await read.query(count()),two:await read.query(count())}));
 assert.equal(result.value.one.result.value,'9007199254740993');assert.equal(result.value.two.result.value,'9007199254740993');
 assert.equal(s.adapter.closed,1);
});
test('old closed success family refuses semantic errors and thrown failures even when plugin catches them',async()=>{
 const s=await legacy();s.adapter.plan(page(),value());
 await assert.rejects(s.compose(async read=>{try{await read.query(page());}catch{}return {};}));
 assert.equal(s.adapter.closed,1);assert.throws(()=>indexed.captureIndexedResultV1(s.selection,page(),value()));
});
test('missing, foreign or cloned observer and changed offers refuse before acquisition',async()=>{
 const s=await prepared(),other=await prepared();
 for(const observer of [undefined,{},structuredClone(s.observer),other.observer])
  await assert.rejects(execution.composeStatefulOwnerIndexedExecutionV1(s.selection,s.adapter,observer,s.adapter.identity,s.adapter.view,async()=>({}),s.adapter.guard));
 assert.equal(s.adapter.acquired,0);
 s.adapter.indexedExecutionCapabilities.profiles=[];await assert.rejects(query(s));assert.equal(s.adapter.acquired,0);
});
test('host terminal/close/closure failure poisons even caught semantic outcomes',async()=>{
 for(const flag of ['terminalFailure','closeFailure','closureFailure']){
  const s=await prepared();s[flag]=true;
  await assert.rejects(s.compose(async read=>{try{await read.query(page());}catch{}return {};}));
  assert.ok(s.events.includes('close'));assert.ok(s.events.includes('closure'));assert.equal(s.adapter.closed,1);
 }
});
test('native throws are never converted to semantic outcomes and still close owned resources',async()=>{
 const s=await prepared();s.beforeExecute=()=>{throw Error('native statement timeout');};
 await assert.rejects(query(s),/native statement timeout/);assert.deepEqual(s.events,['begin','execute','close','closure']);
});
test('unsupported semantic code/request, forged native identity and incomplete pages refuse',async()=>{
 for(const change of [s=>s.candidate={...value(),code:'cancelled'},s=>s.candidate={...value(),profile:'foreign'},
  s=>s.candidate={kind:'result',result:{...pageResult(),complete:false}},s=>{const original=s.adapter.executeCompleted;s.adapter.executeCompleted=async(...args)=>({...await original(...args),executionId:'foreign'});}]){
  const s=await prepared();change(s);await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
 const s=await prepared();await assert.rejects(s.compose(async read=>({answer:await read.query(count())})),/not declared/);
});
test('cancellation/source/generation/owner authority changes at closure and final publication refuse outcomes',async()=>{
 for(const flag of ['cancelled','expired','fork','mapping','coverage']){
  const s=await prepared();s.beforeExecute=()=>{s.adapter.flags[flag]=true;};await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
 const s=await prepared();const result=await query(s);s.adapter.identity.generation='retired';
 // Actual host guards retain live owner checks; the SDK does not infer authority from labels.
 assert.throws(()=>execution.assertIndexedExecutionPublicationV1(result),/owner|Owner|generation/);
});
test('unawaited/concurrent work and exhausted attempt budgets poison composition',async()=>{
 const s=await prepared(),gate=deferred();s.beforeExecute=()=>gate.promise;
 await assert.rejects(s.compose(async read=>{void read.query(page());return {};}),/unawaited/);gate.resolve();
 const budget=await prepared({...indexedLimits(),readAttempts:1});
 await assert.rejects(budget.compose(async read=>{await read.query(page());await read.query(page());return {};}),/total exceeded/);
});
test('Boolean self-attestation, missing commands and undefined cleanup rejections never grant completion',async()=>{
 for(const flag of ['terminalReturn','closeReturn','closureReturn','closeUndefined','closureUndefined']){
  const s=await prepared();s[flag]=true;await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
 for(const command of ['verifyTerminal','closeOwned','assertClosed']){
  const s=await prepared();s.missing=command;await assert.rejects(query(s));assert.equal(s.adapter.closed,1);
 }
});
test('host operation and native identity reuse across queries refuse and poison a caught failure',async()=>{
 for(const sameObject of [true,false]){
  const s=await prepared();s.idOverride='same-native-execution';
  await assert.rejects(s.compose(async read=>{await read.query(page());s.reuse=sameObject;try{await read.query(page());}catch{}return {};}),/reused/);
  assert.equal(s.adapter.closed,1);
 }
});
test('terminal or closure-time authority invalidation and completed-read close failures block publication',async()=>{
 for(const callback of ['afterTerminal','afterClose','afterClosed']){
  const s=await prepared();s[callback]=()=>{s.adapter.flags.cancelled=true;};await assert.rejects(query(s));
  assert.ok(s.events.includes('close'));assert.ok(s.events.includes('closure'));assert.equal(s.adapter.closed,1);
 }
 const s=await prepared(),close=s.adapter.closeRead.bind(s.adapter);
 s.adapter.closeRead=read=>{close(read);throw Error('owner read closure failed');};await assert.rejects(query(s),/closure failed/);
});
test('response/syntax resources remain cumulative for semantic outcomes and success pages use old capture',async()=>{
 const s=await prepared({...indexedLimits(),responseRecords:1});
 await assert.rejects(s.compose(async read=>{await read.query(page());await read.query(page());return {};}),/total exceeded/);
 const large=await prepared();large.candidate={kind:'result',result:pageResult()};const answer=await query(large);
 assert.equal(answer.value.answer.result.rows[0].fields.created,'9007199254740993');
 const syntax=await prepared({...indexedLimits(),predicates:1});
 await assert.rejects(syntax.compose(async read=>{await read.query(page());await read.query(page());return {};}),/predicates total/);
});
test('concurrent operations poison both the request and publication even when their errors are caught',async()=>{
 const s=await prepared(),gate=deferred();s.beforeExecute=()=>gate.promise;
 await assert.rejects(s.compose(async read=>{
  const first=read.query(page());await Promise.resolve();
  try{await read.query(page());}catch{}gate.resolve();try{await first;}catch{}return {};
 }),/concurrent/);assert.equal(s.adapter.closed,1);
});
test('a statement timeout is explicit model semantics and never a cancellation/error-message fallback',async()=>{
 const s=await prepared();s.candidate={kind:'outcome',code:'statement-timeout',profile:'controlled-execution-v1'};
 const completed=await s.compose(async read=>({answer:await read.query(count())}));
 assert.equal(completed.value.answer.code,'statement-timeout');assert.equal(s.adapter.closed,1);
 const invalid=await prepared();invalid.attempts=100;await assert.rejects(query(invalid),/readAttempts total/);
});
test('observer and execution negotiation reject copied authority and mismatched model/profile before reads',async()=>{
 const s=await prepared();
 assert.throws(()=>execution.negotiateIndexedExecutionV1(structuredClone(s.declaration),s.offer,s.offer),/local/);
 for(const change of [o=>o.profiles=[],o=>o.executionDeclarationDigests=[],o=>o.limits.readAttempts=0,o=>o.family='stateful-owner-indexed-query']){
  const offer=structuredClone(s.offer);change(offer);assert.throws(()=>execution.negotiateIndexedExecutionV1(s.declaration,offer,s.offer));
 }
 await assert.rejects(execution.composeStatefulOwnerIndexedExecutionV1(structuredClone(s.selection),s.adapter,s.observer,s.adapter.identity,s.adapter.view,async()=>({}),s.adapter.guard));
 assert.equal(s.adapter.acquired,0);
});
test('a reused host handle in an overlapping request cannot close the first request resources',async()=>{
 const s=await prepared(),started=deferred(),gate=deferred();
 s.beforeExecute=async()=>{started.resolve();await gate.promise;};
 const first=query(s);await started.promise;s.reuse=true;
 await assert.rejects(query(s),/host operation reused/);
 assert.equal(s.events.filter(x=>x==='close').length,0);assert.equal(s.events.filter(x=>x==='closure').length,0);
 gate.resolve();assert.equal((await first).value.answer.code,'execution-error');
 assert.equal(s.events.filter(x=>x==='close').length,1);assert.equal(s.adapter.closed,2);
});
