import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureStatefulDeclaration, captureStatefulSource, canonicalStatefulRecord} from '../dist/projection-stateful.js';
import {captureStatefulOwnerDeclarationV2, captureStatefulOwnerCandidateV2} from '../dist/projection-stateful-owner-v2.js';
import {captureStatefulSourceV2, negotiateStatefulActionMetadataV2,
  STATEFUL_ACTION_AUTHORIZATION_CAPABILITY_V1 as capability} from '../dist/projection-stateful-source-v2.js';
import {definition, limits, source, hex} from './fixtures/stateful-reference.mjs';

async function prepared(bounds=limits()) {
  const projection=await captureStatefulDeclaration(definition(),bounds);
  return {projection,declaration:{projection,sourceInputVersion:2,digest:hex(90)},
    input:source(projection,1,hex(1),{blockNum:0,blockId:hex(0)},[['setdata',{value:'legacy'}]])};
}
const authorization=()=>[{actor:'fixture',permission:'active'},{actor:'other',permission:'owner'}];
function selected(input) {
  return {...structuredClone(input),actionMetadataVersion:1,
    inputs:input.inputs.map(row=>({...structuredClone(row),authorization:authorization()}))};
}

test('capability negotiation is explicit, inert and rejects absent/unknown/duplicate capabilities',()=>{
  assert.deepEqual(negotiateStatefulActionMetadataV2([],[]),{});
  assert.deepEqual(negotiateStatefulActionMetadataV2([capability],[capability]),{actionMetadataVersion:1});
  for(const [required,supported]of [[[capability],[]],[[capability],undefined],[['foreign'],[capability]],
    [[capability,capability],[capability]],[[],['foreign']]])assert.throws(()=>negotiateStatefulActionMetadataV2(required,supported));
  let touched=0;const bad=[];Object.defineProperty(bad,'0',{enumerable:true,get(){touched++;return capability;}});
  assert.throws(()=>negotiateStatefulActionMetadataV2(bad,[capability]));assert.equal(touched,0);
});

test('legacy v1 and source-v2 captures retain the exact pre-change serialized bytes',async()=>{
  const {projection,declaration,input}=await prepared();
  const golden=JSON.parse(readFileSync(new URL('./fixtures/original-action-metadata-legacy.json',import.meta.url)));
  assert.equal(JSON.stringify(await captureStatefulSource(projection,input)),golden.v1);
  assert.equal(JSON.stringify(await captureStatefulSourceV2(declaration,input)),golden.v2);
});

test('selected metadata preserves every actor/permission and order beside unchanged contract data',async()=>{
  const {declaration,input}=await prepared(), original=selected(input), saved=structuredClone(original);
  const captured=await captureStatefulSourceV2(declaration,original);
  assert.deepEqual(JSON.parse(JSON.stringify(captured.source)),saved);
  assert.equal(Object.hasOwn(captured.source.inputs[0].data,'authorization'),false);
  assert.equal(Object.isFrozen(captured.source.inputs[0].authorization[0]),true);
  assert.equal((await captureStatefulSourceV2(declaration,captured.source)).digest,captured.digest,'receiving SDK recaptures same source');
});

test('an explicitly empty original list is preserved; absence never becomes empty authorization',async()=>{
  const {declaration,input}=await prepared(), original=selected(input);original.inputs[0].authorization=[];
  assert.deepEqual((await captureStatefulSourceV2(declaration,original)).source.inputs[0].authorization,[]);
  for(const value of [undefined,null,{},false]) {
    const changed=selected(input);changed.inputs[0].authorization=value;
    await assert.rejects(captureStatefulSourceV2(declaration,changed));
  }
  const missing=selected(input);delete missing.inputs[0].authorization;
  await assert.rejects(captureStatefulSourceV2(declaration,missing));
});

test('metadata without selection, unsupported versions and extras refuse without changing old captures',async()=>{
  const {projection,declaration,input}=await prepared();
  const noMarker=selected(input);delete noMarker.actionMetadataVersion;
  await assert.rejects(captureStatefulSourceV2(declaration,noMarker));
  for(const version of [0,2,true,'1',null])await assert.rejects(captureStatefulSourceV2(declaration,{...selected(input),actionMetadataVersion:version}));
  await assert.rejects(captureStatefulSource(projection,selected(input)));
  const extra=selected(input);extra.inputs[0].authorization[0].ready=true;
  await assert.rejects(captureStatefulSourceV2(declaration,extra));
});

test('each actor, permission, order and metadata selection changes the source digest',async()=>{
  const {declaration,input}=await prepared(), original=selected(input), baseline=await captureStatefulSourceV2(declaration,original);
  for(const change of [v=>v.inputs[0].authorization[0].actor='changed',v=>v.inputs[0].authorization[0].permission='owner',
    v=>v.inputs[0].authorization.reverse()]) {
    const changed=structuredClone(original);change(changed);
    assert.notEqual((await captureStatefulSourceV2(declaration,changed)).digest,baseline.digest);
  }
  assert.notEqual((await captureStatefulSourceV2(declaration,input)).digest,baseline.digest);
});

test('the receiving owner candidate recaptures authorization and refuses tampering under retained hashes',async()=>{
  const {projection,input}=await prepared(),declaration=await captureStatefulOwnerDeclarationV2(projection,2);
  const captured=await captureStatefulSourceV2(declaration,selected(input));
  const body={declarationDigest:declaration.digest,source:captured,view:{declarationDigest:declaration.digest,
    backendId:projection.definition.binding.backendId,generation:projection.definition.binding.generation,
    revision:hex(11),checkpoint:input.previous},observations:[],mutations:[]};
  // Explicit controlled fixed-candidate fixture; the public canonical record function supplies portable JSON bytes.
  const digest=createHash('sha256').update(canonicalStatefulRecord(projection,'config',body).canonical).digest('hex');
  const candidate={...body,digest};assert.equal((await captureStatefulOwnerCandidateV2(declaration,candidate)).digest,digest);
  for(const change of [v=>v.source.source.inputs[0].authorization[0].actor='forged',
    v=>v.source.source.inputs[0].authorization[0].permission='owner',v=>v.source.source.inputs[0].authorization.reverse()]) {
    const bad=structuredClone(candidate);change(bad);
    await assert.rejects(captureStatefulOwnerCandidateV2(declaration,bad),/Original candidate source differs/);
  }
});

test('metadata is snapshotted before the first await and malformed descriptors never execute',async()=>{
  const {declaration,input}=await prepared(), original=selected(input), saved=structuredClone(original);
  const expected=await captureStatefulSourceV2(declaration,saved);
  const work=captureStatefulSourceV2(declaration,original);original.inputs[0].authorization[0].actor='later';
  assert.deepEqual((await work).source.inputs[0].authorization,expected.source.inputs[0].authorization);
  let touched=0;const bad=selected(input);
  Object.defineProperty(bad.inputs[0].authorization[0],'permission',{enumerable:true,get(){touched++;return 'active';}});
  await assert.rejects(captureStatefulSourceV2(declaration,bad));assert.equal(touched,0);
});

test('existing key/envelope bounds and exact metadata fields apply without truncation',async()=>{
  const bounds=limits();bounds.keyBytes=24;const {declaration,input}=await prepared(bounds);
  for(const change of [v=>v.inputs[0].authorization[0].actor='x'.repeat(25),v=>v.inputs[0].authorization[0].permission='',
    v=>delete v.inputs[0].authorization[0].actor,v=>v.inputs[0].authorization[0].actor=1,
    v=>delete v.inputs[0].authorization[0],v=>v.inputs[0].authorization.extra='bad']) {
    const bad=selected(input);change(bad);await assert.rejects(captureStatefulSourceV2(declaration,bad));
  }
});
