import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '@eosrio/hyperion-sdk/projection-stateful';
import {canonicalStructuredRecord} from '../dist/internal/structured-values.js';
import {assetId, assetReducer, caps, clone, definition, eventsA, hex, host, limits, setup, source} from './fixtures/stateful-reference.mjs';
const guard = () => {};
const error = code => e => e.code === code;
const at = (n,id=n) => ({blockNum:n,blockId:hex(id)});
const run = (state,input,hook=assetReducer(),check=guard) => sdk.executeStatefulBlock(state.declaration,input,state.adapter,state.custody,hook,check);
const A = state => source(state.declaration,1,hex(1),at(0),eventsA());
const readAsset = async (state,view) => (await sdk.readStatefulRecords(state.declaration,state.adapter,view,[{kind:'asset',key:assetId}],guard))[0];

test('negotiation is explicit, quantitative and separate from closed existing families', async () => {
  const bounds=limits();
  await assert.rejects(sdk.negotiateStatefulProjection(definition(),bounds,{...host(bounds),family:'contextual-table-recovery'},caps(bounds)),error('stateful.capability-unavailable'));
  await assert.rejects(sdk.negotiateStatefulProjection(definition(),bounds,{...host(bounds),supported:[]},caps(bounds)),error('stateful.capability-unavailable'));
  await assert.rejects(sdk.negotiateStatefulProjection(definition(),bounds,host(bounds),{...caps(bounds),limits:{...bounds,mutations:0}}),error('stateful.capability-unavailable'));
  await assert.rejects(sdk.captureStatefulDeclaration(definition(),undefined));
  const state=await setup(), changed=definition();changed.binding.hookArtifact=hex(999);
  await assert.rejects(state.adapter.initialize(await sdk.captureStatefulDeclaration(changed,bounds)),error('stateful.declaration-conflict'));
  await assert.rejects(run({...state,declaration:clone(state.declaration)},A(state)),/Recapture/);
});

test('source capture retains exact kind-specific occurrence, bytes, ABI epoch and supplied order', async () => {
  const state=await setup(),input=A(state),captured=await sdk.captureStatefulSource(state.declaration,input);
  assert.equal(captured.source.inputs[0].name,'setdata');assert.equal(captured.source.inputs[2].transactionId,null);
  assert.equal(captured.source.inputs[0].sequence,'9007199254741093');assert.ok(Object.isFrozen(captured.source.inputs[0].data));
  for(const change of [v=>delete v.inputs[0].receiver,v=>v.inputs[0].rawSha256=hex(0),v=>v.inputs[0].abiSha256=hex(99),
    v=>v.inputs[0].mappingRevision=hex(99),v=>v.inputs[0].order=4,v=>v.block.timeMs='01',
    v=>v.inputs[2].scope='',v=>delete v.inputs[2].primaryKey,v=>v.inputs[0].sequence=9007199254740992]) {
    const bad=clone(input);change(bad);await assert.rejects(sdk.captureStatefulSource(state.declaration,bad));
  }
  let invoked=0;const bad={get previous(){invoked++;return at(0);}};
  await assert.rejects(sdk.captureStatefulSource(state.declaration,bad));assert.equal(invoked,0);
  const smaller=await sdk.negotiateStatefulProjection(definition(),{...limits(),inputBytes:1},host(limits()),caps(limits()));
  await assert.rejects(sdk.captureStatefulSource(smaller,input),/byte bound/);
  const aliased=definition();aliased.selectors.push({...aliased.selectors.find(s=>s.id==='mint'),id:'same-mint'});
  const selected=await sdk.negotiateStatefulProjection(aliased,limits(),host(limits()),caps(limits()));
  const twice=source(selected,1,hex(1),at(0),[['mint',{}]]);
  twice.inputs.push({...clone(twice.inputs[0]),selector:'same-mint',order:1});
  await assert.rejects(sdk.captureStatefulSource(selected,twice),/Duplicate original occurrence/);
});

test('generic JSON preserves valid NUL/literal escapes while the private legacy experiment still refuses', async () => {
  const state=await setup(),value={text:'a\0b',literal:'a\\u0000b',nil:null,ordinary:'01',fraction:.1};
  const result=sdk.canonicalStatefulRecord(state.declaration,'collection',value);
  assert.deepEqual(JSON.parse(result.canonical),value);assert.equal(result.bytes,Buffer.byteLength(result.canonical));
  assert.throws(()=>canonicalStructuredRecord(value,[],limits().value),/unsupported NUL/);
  assert.throws(()=>sdk.canonicalStatefulRecord(state.declaration,'asset',{asset_id:'01'}));
});

test('record and envelope policies remain separate, immutable and fully caller bounded', async () => {
  const requested=limits(),before=requested.value.recordBytes;
  const pending=sdk.captureStatefulDeclaration(definition(),requested);requested.value.recordBytes=2;
  const captured=await pending;assert.equal(captured.limits.value.recordBytes,before);assert.ok(Object.isFrozen(captured.limits.envelope));
  const tiny={...limits(),value:{...limits().value,fields:1}};
  const selected=await sdk.negotiateStatefulProjection(definition(),tiny,host(limits()),caps(limits()));
  assert.equal(sdk.canonicalStatefulRecord(selected,'collection',{one:1}).bytes,9);
  assert.throws(()=>sdk.canonicalStatefulRecord(selected,'collection',{one:1,two:2}),/field bound/);
  const state=await setup();let calls=0;
  const uncoupled=await sdk.captureStatefulDeclaration(definition(),limits());
  await assert.rejects(run({...state,declaration:uncoupled},A(state),async()=>{calls++;}),error('stateful.capability-unavailable'));
  assert.equal(calls,0);
  const narrow=await sdk.negotiateStatefulProjection(definition(),{...limits(),candidateBytes:20000},host(limits()),caps(limits()));
  const adapter=new state.adapter.constructor(narrow.limits);await adapter.initialize(narrow);
  await assert.rejects(run({declaration:narrow,adapter,custody:state.custody},source(narrow,1,hex(1),at(0),[]),async p=>{
    p.put('collection','one',{large:'x'.repeat(30000)});
  }),/byte bound/);assert.equal(adapter.rows.size,0);
});

// Same reusable semantic exercise for any adapter factory; neither label is a real engine.
export async function statefulAdapterConformance(create) {
  const state=await create(),order=[],a=A(state);let hooks=0;
  await run(state,a,async p=>{hooks++;await assetReducer(order)(p);});
  const viewA=await state.adapter.open(state.declaration),first=await readAsset(state,viewA);
  assert.equal(first.status,'present');assert.equal(first.value.owner,'bob');assert.equal(first.value.template_id,null);
  assert.equal(Object.hasOwn(first.value.mutable_data,'old'),false);assert.equal(first.value.immutable_data.serial,'18446744073709551615');
  assert.deepEqual(order,['config','schema','collection','mint','flush','setdata','transfer','transfer']);
  assert.equal((await run(state,a,async()=>{hooks++;})).status,'duplicate');assert.equal(hooks,1);
  const b=source(state.declaration,2,hex(2),at(1),[['burn',{}]]);await run(state,b);
  const viewB=await state.adapter.open(state.declaration),burned=await readAsset(state,viewB);
  assert.equal(burned.value.owner,null);assert.equal(burned.value.minted_at_block,'1');assert.equal(burned.value.transferred_at_block,'1');
  const rollback={declarationDigest:state.declaration.digest,revision:viewB.revision,operationId:hex(500),from:at(2),ancestor:at(1),maxBlocks:1};
  assert.equal((await state.adapter.rollback(rollback)).status,'rolled-back');
  const restored=await state.adapter.open(state.declaration);assert.equal((await readAsset(state,restored)).value.owner,'bob');
  await assert.rejects(readAsset(state,viewA),error('stateful.stale-view')); // Coincident A checkpoint, new revision.
  const c=source(state.declaration,2,hex(3),at(1),[['collection',{name:'current',fee:.05}],['schema',{format:[{name:'image',type:'string',mediatype:'video'}]}]]);
  await run(state,c);const viewC=await state.adapter.open(state.declaration),current=await readAsset(state,viewC);
  assert.deepEqual(current.value,first.value);assert.equal(current.value.updated_at_block,'1');
  const relationships=await sdk.readStatefulRecords(state.declaration,state.adapter,viewC,[{kind:'collection',key:'one'},{kind:'schema',key:'one'}],guard);
  assert.equal(relationships[0].value.name,'current');assert.equal(relationships[1].value.format[0].mediatype,'video');
  await assert.rejects(readAsset(state,viewB),error('stateful.stale-view'));
  assert.equal((await state.adapter.rollback(rollback)).status,'duplicate');assert.deepEqual((await state.adapter.open(state.declaration)).checkpoint,at(2,3));
  const retained=await state.adapter.retainedCheckpoints(state.declaration,viewC.revision);
  assert.deepEqual(retained.checkpoints,[at(2,3),at(1),at(0)]);return state;
}
for(const name of ['reference-memory-one','reference-memory-two'])test('portable adapter conformance A/B/rollback/C: '+name,async()=>statefulAdapterConformance(()=>setup(name)));

test('local full put/delete overlay, repeated keys and one original before-image remain ordered', async () => {
  const state=await setup(),input=source(state.declaration,1,hex(1),at(0),[]);
  await run(state,input,async p=>{
    assert.equal((await p.get('collection','one')).status,'covered-absent');
    p.put('collection','one',{old:true});assert.equal((await p.get('collection','one')).value.old,true);
    p.delete('collection','one');assert.equal((await p.get('collection','one')).status,'covered-absent');
    p.put('collection','one',{nil:null});
  });
  assert.equal(state.adapter.undo.get(1).before.size,1);assert.equal([...state.adapter.undo.get(1).before.values()][0],null);
  const candidate=[...state.custody.values.values()][0];assert.deepEqual(candidate.mutations.map(m=>m.kind),['put','delete','put']);
  assert.equal(candidate.observations.length,1);assert.equal(state.adapter.readCalls,1);
});

test('wrong-owner transfer has no asset mutation; missing coverage never becomes covered absence', async () => {
  const state=await setup();await run(state,A(state));
  await run(state,source(state.declaration,2,hex(2),at(1),[['transfer',{from:'mallory',to:'wrong'}]]));
  const candidate=[...state.custody.values.values()].at(-1);assert.equal(candidate.mutations.length,0);
  assert.equal((await readAsset(state,await state.adapter.open(state.declaration))).value.owner,'bob');
  const empty=await setup();empty.adapter.unavailable=JSON.stringify(['collection','missing']);let effects=0;
  await assert.rejects(run(empty,source(empty.declaration,1,hex(1),at(0),[]),async p=>{
    await p.get('collection','missing');effects++;p.put('collection','one',{});
  }),error('stateful.unavailable'));
  assert.equal(effects,0);assert.equal(empty.custody.retains,0);assert.equal(empty.adapter.rows.size,0);
});

test('ordinary apply changes checkpoint without revision: stale and concurrent composition reject', async () => {
  const state=await setup();await run(state,A(state));const old=await state.adapter.open(state.declaration);
  await run(state,source(state.declaration,2,hex(2),at(1),[]),async()=>{});
  const current=await state.adapter.open(state.declaration);assert.equal(current.revision,old.revision);
  await assert.rejects(readAsset(state,old),error('stateful.stale-view'));
  state.adapter.onRead=async()=>{state.adapter.onRead=null;await run(state,source(state.declaration,3,hex(3),at(2),[]),async()=>{});};
  await assert.rejects(readAsset(state,current),error('stateful.stale-view'));
});

test('API composition shares one view and enforces total read/output budgets before publication', async () => {
  const state=await setup();await run(state,A(state));const view=await state.adapter.open(state.declaration);let escaped;
  const response=await sdk.composeStatefulRead(state.declaration,state.adapter,view,async p=>{
    escaped=p;const asset=await p.get('asset',assetId),collection=await p.get('collection','one'),schema=await p.get('schema','one');
    return {asset:asset.value,collection:collection.value,schema:schema.value};
  },guard);
  assert.equal(response.value.asset.owner,'bob');assert.equal(response.value.collection.name,'initial');
  await assert.rejects(escaped.get('collection','one'),/closed/);
  await assert.rejects(sdk.composeStatefulRead(state.declaration,state.adapter,view,async()=>{
    await run(state,source(state.declaration,2,hex(2),at(1),[]),async()=>{});return {stale:true};
  },guard),error('stateful.stale-view'));
  const bounds={...limits(),responseRecords:1,responseBytes:8192};
  const declaration=await sdk.negotiateStatefulProjection(definition(),bounds,host(limits()),caps(limits()));
  const adapter=new state.adapter.constructor(bounds);const own={declaration,adapter,custody:new state.custody.constructor()};
  await adapter.initialize(declaration);await run(own,A(own));const current=await adapter.open(declaration);
  await assert.rejects(sdk.composeStatefulRead(declaration,adapter,current,async p=>{await p.get('asset',assetId);await p.get('collection','one');return {};},guard),/read\/record bound/);
  await assert.rejects(sdk.composeStatefulRead(declaration,adapter,current,async()=>({large:'x'.repeat(9000)}),guard),/byte bound/);
  let callbacks=0;
  await assert.rejects(sdk.composeStatefulRead(state.declaration,state.adapter,view,async()=>{callbacks++;return {};},guard),error('stateful.stale-view'));
  const missing={...adapter,capabilities:{...adapter.capabilities,supported:[]}};
  await assert.rejects(sdk.composeStatefulRead(declaration,missing,current,async()=>{callbacks++;return {};},guard),error('stateful.capability-unavailable'));
  assert.equal(callbacks,0);
});

test('exact source replay skips hooks, conflicts and expired/blocked receipts never rerun them', async () => {
  const state=await setup();let calls=0;const hook=async p=>{calls++;await assetReducer()(p);},input=A(state);
  await run(state,input,hook);assert.equal((await run(state,input,hook)).status,'duplicate');assert.equal(calls,1);
  const conflict=clone(input);conflict.block.blockId=hex(99);
  await assert.rejects(run(state,conflict,hook),error('stateful.replay-conflict'));
  const view=await state.adapter.open(state.declaration),next=await sdk.captureStatefulSource(state.declaration,source(state.declaration,2,hex(2),at(1),[]));
  await state.adapter.markIncomplete(state.declaration,view,next,'selected source failed');
  const conflicting=await sdk.captureStatefulSource(state.declaration,source(state.declaration,2,hex(99),at(1),[]));
  await assert.rejects(state.adapter.markIncomplete(state.declaration,view,conflicting,'selected source failed'),error('stateful.replay-conflict'));
  assert.equal((await state.adapter.recovery(state.declaration)).gap.sourceDigest,next.digest);
  await assert.rejects(run(state,input,hook),error('stateful.incomplete'));
  await state.adapter.rollback({declarationDigest:state.declaration.digest,revision:view.revision,operationId:hex(77),from:at(1),ancestor:at(1),maxBlocks:1});
  state.adapter.receipts.delete(1);await assert.rejects(run(state,input,hook),error('stateful.receipt-unavailable'));
  assert.equal(calls,1);
});

for(const mode of ['before','after'])test('uncertain '+mode+' commit uses retained candidate/inspection without hook rerun',async()=>{
  const state=await setup();state.adapter[mode==='before'?'failBefore':'failAfter']=true;let hooks=0;
  const input=A(state),hook=async p=>{hooks++;await assetReducer()(p);};
  await assert.rejects(run(state,input,hook),error('stateful.commit-unknown'));assert.equal(state.custody.retains,1);
  if(mode==='after')state.adapter.resolveCommitted=true;
  assert.equal((await run(state,input,hook)).status,mode==='before'?'applied':'duplicate');assert.equal(hooks,1);
  assert.equal(state.adapter.receipts.size,1);
});

test('driver retry never receives a hook and corrupt candidate custody refuses before application', async () => {
  const state=await setup();state.adapter.driverRetries=2;let hooks=0;
  await run(state,A(state),async p=>{hooks++;await assetReducer()(p);});assert.equal(hooks,1);assert.equal(state.adapter.driverPlans,3);
  const broken=await setup();broken.adapter.failBefore=true;
  await assert.rejects(run(broken,A(broken)));const candidate=[...broken.custody.values.values()][0];candidate.mutations[0].value={corrupt:true};
  await assert.rejects(run(broken,A(broken)),error('stateful.replay-conflict'));assert.equal(broken.adapter.rows.size,0);
});

test('inconsistent retained inspection and applied revision are never accepted as successful progress', async () => {
  const state=await setup();state.adapter.failBefore=true;let hooks=0;
  const input=A(state),hook=async p=>{hooks++;await assetReducer()(p);};
  await assert.rejects(run(state,input,hook),error('stateful.commit-unknown'));
  const inspect=state.adapter.inspect.bind(state.adapter);
  state.adapter.inspect=async(...args)=>({...await inspect(...args),phase:'ready',status:'new'});
  await assert.rejects(run(state,input,hook),/New inspection carries/);assert.equal(hooks,1);assert.equal(state.adapter.rows.size,0);
  const wrong=await setup(),apply=wrong.adapter.apply.bind(wrong.adapter);
  wrong.adapter.apply=async candidate=>{const result=await apply(candidate);return {...result,progress:{...result.progress,revision:hex(99)}};};
  await assert.rejects(run(wrong,A(wrong)),/Applied progress changed/);
  assert.equal(wrong.adapter.receipts.size,1,'An invalid acknowledgment does not undo an actual commit; host recovery must inspect it');
});

test('host cancellation/deadline is checked after awaited reads and durable input custody', async () => {
  const state=await setup();let cancelled=false;state.adapter.onRead=async()=>{cancelled=true;};
  await assert.rejects(run(state,A(state),assetReducer(),()=>{if(cancelled)throw new Error('cancelled');}),/cancelled/);
  assert.equal(state.adapter.rows.size,0);assert.equal(state.custody.retains,0);
  const delayed=await setup();let clock=0;const retain=delayed.custody.retain.bind(delayed.custody);
  delayed.custody.retain=async c=>{await retain(c);clock=2;};
  await assert.rejects(run(delayed,A(delayed),assetReducer(),()=>{if(clock>1)throw new Error('deadline');}),/deadline/);
  assert.equal(delayed.adapter.rows.size,0);assert.equal(delayed.custody.retains,1);
});

test('rollback interruption preserves operation/revision and exact retry; absent coverage stays incomplete', async () => {
  const state=await setup();await run(state,A(state));await run(state,source(state.declaration,2,hex(2),at(1),[['burn',{}]]));
  const view=await state.adapter.open(state.declaration),request={declarationDigest:state.declaration.digest,revision:view.revision,operationId:hex(50),from:at(2),ancestor:at(1),maxBlocks:1};
  state.adapter.interruptRollback=true;await assert.rejects(state.adapter.rollback(request),error('stateful.controlled-interruption'));
  await assert.rejects(state.adapter.open(state.declaration),error('stateful.incomplete'));
  await assert.rejects(state.adapter.rollback({...request,operationId:hex(51)}),error('stateful.incomplete'));
  assert.equal((await state.adapter.rollback(request)).status,'rolled-back');
  await assert.rejects(state.adapter.rollback({...request,maxBlocks:257}));
  const current=await state.adapter.open(state.declaration);state.adapter.undo.clear();state.adapter.points.delete(0);
  await assert.rejects(state.adapter.rollback({...request,revision:current.revision,operationId:hex(52),from:at(1),ancestor:at(0)}),error('stateful.rollback-unavailable'));
  assert.equal((await state.adapter.recovery(state.declaration)).rollback.status,'unavailable');
  await assert.rejects(state.adapter.open(state.declaration),error('stateful.incomplete'));
});

test('closed ports and explicit input/read/mutation/candidate bounds prevent late effects', async () => {
  const state=await setup();let escaped;
  await run(state,source(state.declaration,1,hex(1),at(0),[]),async p=>{escaped=p;});
  assert.throws(()=>escaped.put('collection','one',{}),/closed/);
  await assert.rejects(escaped.get('collection','one'),/closed/);
  const bounds={...limits(),readAttempts:0,mutations:0},input=definition();
  const declaration=await sdk.negotiateStatefulProjection(input,bounds,host(limits()),caps(limits()));
  const own=await setup();await own.adapter.initialize(own.declaration);const adapter=new (own.adapter.constructor)(bounds);await adapter.initialize(declaration);
  const selected={declaration,adapter,custody:own.custody};
  await assert.rejects(run(selected,source(declaration,1,hex(1),at(0),[]),async p=>{await p.get('collection','one');}),/Read attempt/);
  await assert.rejects(run(selected,source(declaration,1,hex(1),at(0),[]),async p=>{p.put('collection','one',{});}),/Mutation bound/);
  assert.equal(adapter.rows.size,0);
});
