import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {captureOriginalTableIdentity,captureRawStatefulTarget} from '../dist/internal/stateful-input-v2.js';
import {captureStatefulDeclaration,captureStatefulSource} from '../dist/projection-stateful.js';
import {definition,limits,source,eventsA,hex} from './fixtures/stateful-reference.mjs';

const bounds=()=>limits();
const target=()=>({schemaVersion:2,chainId:hex(1),declarationDigest:hex(2),owner:{id:'physical-owner',generation:'owner-epoch'},
  previous:{declarationDigest:hex(2),backendId:'backend',generation:'mapping-instance',revision:hex(3),
    checkpoint:{blockNum:1,blockId:hex(4)}},block:{blockNum:2,blockId:hex(5),previousBlockId:hex(4)},
  rawSource:{selectionId:'original-selection',observationId:'original-observation',observationDigest:hex(6),captureSha256:hex(7),frameSha256:hex(8)}});

test('proposed identities retain original scope/key and physical KV bytes without substitution',()=>{
  for(const input of [{kind:'contract-row',scope:'collection',primaryKey:'9007199254740993'},
    {kind:'contract-row',scope:'',primaryKey:'0'},
    {kind:'kv-primary',tableId:0,keyHex:'000001'},
    {kind:'kv-primary',tableId:65535,keyHex:''},
    {kind:'kv-secondary',tableId:0,secondaryKeyHex:'00',primaryKeyHex:'0000'}]){
    const captured=captureOriginalTableIdentity(input,bounds());assert.deepEqual(captured,input);
    assert.notEqual(captured,input);assert.equal(Object.isFrozen(captured),true);
    if(input.kind!=='contract-row')assert.equal(Object.hasOwn(captured,'scope'),false);
  }
});

test('mixed/absent identity fields, width overflow and lossy key encodings refuse',()=>{
  for(const input of [{kind:'kv-primary',tableId:1,keyHex:'00',scope:''},
    {kind:'contract-row',primaryKey:'1'},{kind:'contract-row',scope:null,primaryKey:'1'},
    {kind:'kv-primary',tableId:-1,keyHex:''},{kind:'kv-primary',tableId:65536,keyHex:''},
    {kind:'kv-primary',tableId:1.1,keyHex:''},{kind:'kv-primary',tableId:'1',keyHex:''},
    {kind:'kv-primary',tableId:1,keyHex:'0'},{kind:'kv-primary',tableId:1,keyHex:'0A'},
    {kind:'kv-secondary',tableId:1,keyHex:'00'},{kind:'unknown',scope:'x',primaryKey:'1'}])
    assert.throws(()=>captureOriginalTableIdentity(input,bounds()));
  assert.notDeepEqual(captureOriginalTableIdentity({kind:'kv-primary',tableId:1,keyHex:'0001'},bounds()),
    captureOriginalTableIdentity({kind:'kv-primary',tableId:1,keyHex:'01'},bounds()));
});

test('identity traversal/key byte bounds are existing explicit limits and accessors never run',()=>{
  const small=bounds();small.inputBytes=1;
  assert.throws(()=>captureOriginalTableIdentity({kind:'kv-primary',tableId:1,keyHex:'0001'},small));
  const tiny=bounds();tiny.candidateBytes=8;
  assert.throws(()=>captureOriginalTableIdentity({kind:'kv-primary',tableId:1,keyHex:''},tiny));
  let reads=0;const value={kind:'kv-primary',tableId:1};
  Object.defineProperty(value,'keyHex',{enumerable:true,get(){reads++;return '00';}});
  assert.throws(()=>captureOriginalTableIdentity(value,bounds()));assert.equal(reads,0);
});

test('raw target capture needs no decoded block time/data and binds original target/owner/reference',async()=>{
  const input=target(),saved=structuredClone(input),pending=captureRawStatefulTarget(input,bounds());
  input.rawSource.captureSha256=hex(99);input.owner.generation='later';
  const captured=await pending;assert.deepEqual(captured.target,saved);assert.equal(Object.isFrozen(captured.target.rawSource),true);
  assert.match(captured.digest,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(captured.target.block,'timeMs'),false);
  assert.equal(Object.hasOwn(captured.target,'data'),false);
  assert.equal((await captureRawStatefulTarget(saved,bounds())).digest,captured.digest);
  for(const mutate of [v=>v.owner.generation='other',v=>v.rawSource.captureSha256=hex(9),v=>v.chainId=hex(9),
    v=>v.previous.revision=hex(9),v=>{v.declarationDigest=hex(9);v.previous.declarationDigest=hex(9);}]){
    const changed=structuredClone(saved);mutate(changed);
    assert.notEqual((await captureRawStatefulTarget(changed,bounds())).digest,captured.digest);
  }
});

test('raw target rejects skipped/conflicting/cross-declaration and fabricated decoded fields',async()=>{
  for(const mutate of [v=>v.schemaVersion=1,v=>v.block.blockNum=3,v=>v.block.previousBlockId=hex(99),
    v=>v.previous.declarationDigest=hex(99),v=>v.rawSource.frameSha256='bad',v=>v.block.timeMs='1',
    v=>v.data={},v=>v.owner.extra='authority',v=>delete v.rawSource.observationId]){
    const value=target();mutate(value);await assert.rejects(captureRawStatefulTarget(value,bounds()));
  }
  const genesis=target();genesis.previous.checkpoint={blockNum:0,blockId:hex(1)};
  genesis.block={blockNum:1,blockId:hex(2),previousBlockId:hex(1)};
  await assert.rejects(captureRawStatefulTarget(genesis,bounds()));
});

test('existing v1 capture output stays exact and refuses absent/empty scope',async()=>{
  const d=await captureStatefulDeclaration(definition(),bounds());
  const original=source(d,1,hex(1),{blockNum:0,blockId:hex(0)},eventsA());
  const captured=await captureStatefulSource(d,original);
  // Frozen v1 emission 0eff7e35801f... from SDK b64bac4 supplies these independent captures.
  assert.equal(d.digest,'c8c2af12de1a220ab1e551083c8afc44e8d97c524a20113e6150881d75099bbe');
  assert.equal(captured.digest,'1e22c1cb16e966e67befb9b20f99af484e52da6d34227a2e43ce8651995bdfc4');
  assert.equal(Object.hasOwn(captured.source.inputs[0],'identity'),false);
  const table=original.inputs.find(value=>value.kind==='table');assert.ok(table);
  for(const scope of ['',null,undefined]){
    const changed=structuredClone(original),selected=changed.inputs.find(value=>value.kind==='table');
    if(scope===undefined)delete selected.scope;else selected.scope=scope;
    await assert.rejects(captureStatefulSource(d,changed));
  }
});

test('proposed helpers have no public SDK subpath or capability activation',async()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  assert.equal(Object.keys(pkg.exports).some(value=>value.includes('stateful-input')||value.includes('v2')),false);
  await assert.rejects(import('@eosrio/hyperion-sdk/internal/stateful-input-v2'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  const publicModule=await import('@eosrio/hyperion-sdk/projection-stateful');
  assert.equal(publicModule.captureRawStatefulTarget,undefined);
  assert.equal(publicModule.captureOriginalTableIdentity,undefined);
});
