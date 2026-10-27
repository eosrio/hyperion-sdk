// Executable reference semantics for adapter conformance, not a database or durability claim.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as sdk from '../../dist/projection-stateful.js';
export const hex = n => n.toString(16).padStart(64, '0');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const clone = value => structuredClone(value);
export const limits = () => ({value: {depth: 40, nodes: 20000, fields: 64, arrayElements: 1000,
  stringBytes: 65536, recordBytes: 262144, integerFields: 16, pathSegments: 16},
  envelope: {depth: 48, nodes: 100000, fields: 64, arrayElements: 2000,
    stringBytes: 2097152, recordBytes: 4194304, integerFields: 16, pathSegments: 16},
  selectors: 16, recordKinds: 8, inputOccurrences: 1000, inputBytes: 1048576, keyBytes: 1024,
  readKeys: 32, readAttempts: 128, mutations: 1000, candidateBytes: 4194304, responseRecords: 32, responseBytes: 4194304});
export const definition = () => ({family: sdk.STATEFUL_FAMILY, interfaceVersion: 1, id: 'constructed-lifecycle',
  binding: {chainId: hex(10), backendId: 'reference-memory', generation: 'synthetic-genesis', mappingRevision: hex(11),
    hookArtifact: hex(12), hookRevision: hex(13), codecRevision: hex(14), normalizerRevision: hex(15)},
  selectors: [['config', 'table'], ['schema', 'table'], ['collection', 'table'], ['mint', 'action'],
    ['setdata', 'action'], ['transfer', 'action'], ['burn', 'action']].map(([id, kind]) =>
    ({id, kind, contract: 'fixture', name: id, abiDeployment: 'synthetic-epoch-1', abiSha256: hex(16)})),
  records: [{kind: 'config', integers: []}, {kind: 'collection', integers: []}, {kind: 'schema', integers: []},
    {kind: 'mint', integers: [{path: ['asset_id'], type: 'uint64', vector: false}]},
    {kind: 'asset', integers: [{path: ['asset_id'], type: 'uint64', vector: false},
      {path: ['immutable_data', 'serial'], type: 'uint64', vector: false},
      {path: ['immutable_data', 'uv'], type: 'uint64', vector: true},
      {path: ['mutable_data', 'signed'], type: 'int64', vector: false}]}]});
export const host = bounds => ({family: sdk.STATEFUL_FAMILY, interfaceVersion: 1, supported: sdk.STATEFUL_HOST_CAPABILITIES, limits: bounds});
export const caps = bounds => ({family: sdk.STATEFUL_FAMILY, interfaceVersion: 1, supported: sdk.STATEFUL_ADAPTER_CAPABILITIES, limits: bounds});
const key = value => JSON.stringify([value.kind, value.key]);
const fail = (code, message = code) => {throw new sdk.StatefulContractError(code, message);};
export class CandidateStore {
  values = new Map(); loads = 0; retains = 0;
  async load(declaration, source) {this.loads++; return this.values.get(declaration + source) ?? null;}
  async retain(candidate) {
    const id = candidate.declarationDigest + candidate.source.digest, old = this.values.get(id);
    if (old && old.digest !== candidate.digest) fail('stateful.replay-conflict');
    this.retains++; this.values.set(id, clone(candidate));
  }
}
export class ReferenceAdapter {
  constructor(bounds) {this.capabilities = caps(bounds); this.rows = new Map(); this.undo = new Map(); this.receipts = new Map();
    this.points = new Map([[0, {blockNum: 0, blockId: hex(0)}]]); this.revision = 1; this.phase = 'ready';
    this.pending = null; this.gap = null; this.operation = null; this.driverRetries = 0; this.driverPlans = 0; this.readCalls = 0;}
  view() {return {declarationDigest: this.declaration.digest, backendId: this.declaration.definition.binding.backendId,
    generation: this.declaration.definition.binding.generation, revision: hex(this.revision), checkpoint: clone(this.point)};}
  binding(declaration) {if (!this.declaration || declaration.digest !== this.declaration.digest) fail('stateful.declaration-conflict');}
  async initialize(declaration) {
    const checked = await sdk.captureStatefulDeclaration(declaration.definition, declaration.limits);
    if (checked.digest !== declaration.digest) fail('stateful.declaration-conflict');
    if (this.declaration) {this.binding(declaration); return this.open(declaration);}
    this.declaration = checked; this.point = {blockNum: 0, blockId: hex(0)}; return this.view();
  }
  async open(declaration) {this.binding(declaration); if (this.phase !== 'ready') fail('stateful.incomplete'); return this.view();}
  async read(view, keys) {
    this.readCalls++; sdk.assertStatefulView(this.declaration, await this.open(this.declaration), view);
    const results = keys.map(k => this.unavailable === key(k) ? {status: 'unavailable', reason: 'unknown selected source coverage'}
      : this.rows.has(key(k)) ? {status: 'present', value: clone(this.rows.get(key(k)))} : {status: 'covered-absent'});
    if (this.onRead) await this.onRead();
    return {view: clone(view), results};
  }
  async inspect(declaration, source) {
    this.binding(declaration); const receipt = this.receipts.get(source.source.block.blockNum);
    if (receipt && this.resolveCommitted) {this.phase = 'ready'; this.pending = null; this.resolveCommitted = false;}
    return {phase: this.phase, status: receipt ? 'committed' : this.pending ? 'pending'
      : source.source.block.blockNum <= this.point.blockNum ? 'uncovered' : 'new',
      sourceDigest: receipt?.sourceDigest ?? this.pending?.sourceDigest ?? null,
      candidateDigest: receipt?.candidateDigest ?? this.pending?.candidateDigest ?? null, progress: this.view()};
  }
  async apply(candidate) {
    const captured = await sdk.captureStatefulCandidate(this.declaration, candidate);
    const receipt = this.receipts.get(captured.source.source.block.blockNum);
    if (this.phase === 'gap' || this.phase === 'rollback') fail('stateful.incomplete');
    if (receipt) {
      if (receipt.sourceDigest !== captured.source.digest || receipt.candidateDigest !== captured.digest) fail('stateful.replay-conflict');
      if (this.phase !== 'ready') fail('stateful.incomplete'); return {status: 'duplicate', progress: this.view()};
    }
    sdk.assertStatefulView(this.declaration, this.view(), captured.view); // Atomic implementation rechecks here.
    if (this.pending && (this.pending.sourceDigest !== captured.source.digest || this.pending.candidateDigest !== captured.digest)) fail('stateful.replay-conflict');
    if (this.failBefore) {this.failBefore = false; this.pending = {sourceDigest: captured.source.digest, candidateDigest: captured.digest};
      this.phase = 'pending'; fail('stateful.commit-unknown');}
    const next = new Map(this.rows), before = new Map();
    for (const mutation of captured.mutations) {
      const id = key(mutation.target); if (!before.has(id)) before.set(id, this.rows.has(id) ? clone(this.rows.get(id)) : null);
      if (mutation.kind === 'put') next.set(id, clone(mutation.value)); else next.delete(id);
    }
    // Simulated driver retries reuse this same plan and never have a hook callback available.
    this.driverPlans += 1 + this.driverRetries; this.driverRetries = 0;
    this.undo.set(captured.source.source.block.blockNum, {previous: clone(this.point), before});
    this.rows = next; this.point = {blockNum: captured.source.source.block.blockNum, blockId: captured.source.source.block.blockId};
    this.points.set(this.point.blockNum, clone(this.point));
    this.receipts.set(this.point.blockNum, {sourceDigest: captured.source.digest, candidateDigest: captured.digest}); this.phase = 'ready'; this.pending = null;
    if (this.failAfter) {this.failAfter = false; this.phase = 'pending'; this.pending = {sourceDigest: captured.source.digest, candidateDigest: captured.digest}; fail('stateful.commit-unknown');}
    return {status: 'applied', progress: this.view()};
  }
  async recovery(declaration) {
    this.binding(declaration); const retainedBytes = Buffer.byteLength(JSON.stringify([...this.undo].map(([n, u]) => [n, u.previous, [...u.before]])));
    assert.ok(this.undo.size <= sdk.STATEFUL_RECOVERY_LIMITS.retainedBlocks && retainedBytes <= sdk.STATEFUL_RECOVERY_LIMITS.retainedBytes);
    const floor = [...this.undo.values()][0]?.previous ?? this.point;
    return {view: this.view(), initialized: true, pending: clone(this.pending), gap: clone(this.gap),
      rollback: clone(this.operation), coverage: {floor: clone(floor), retainedBlocks: this.undo.size, retainedBytes,
        maxBlocks: sdk.STATEFUL_RECOVERY_LIMITS.retainedBlocks, maxBytes: sdk.STATEFUL_RECOVERY_LIMITS.retainedBytes}};
  }
  async markIncomplete(declaration, view, source, reason) {
    this.binding(declaration);const captured=await sdk.captureStatefulSource(declaration,source.source);assert.equal(captured.digest,source.digest);
    sdk.assertStatefulView(declaration, this.view(), view); assert.ok(reason && source.digest);
    if(this.pending || this.phase==='rollback')fail('stateful.incomplete');
    const gap={sourceDigest:source.digest,block:{blockNum:source.source.block.blockNum,blockId:source.source.block.blockId},reason};
    if(this.gap && JSON.stringify(this.gap)!==JSON.stringify(gap))fail('stateful.replay-conflict');
    this.gap=gap;this.phase = 'gap';
  }
  async rollback(request) {
    const admission=sdk.captureStatefulRollback(this.declaration,request,await this.recovery(this.declaration));
    request=admission.request;
    if (request.declarationDigest !== this.declaration.digest) fail('stateful.declaration-conflict');
    const identity = JSON.stringify([request.declarationDigest, request.revision, request.operationId, request.from, request.ancestor]);
    if (this.operationIdentity === identity) {
      if (this.operation.status === 'complete') return {status: 'duplicate', recovery: await this.recovery(this.declaration)};
      if (this.operation.status === 'unavailable') fail('stateful.rollback-unavailable');
    } else {
      if (this.phase === 'rollback' || request.revision !== hex(this.revision)) fail('stateful.stale-view');
      assert.equal(request.from.blockNum,this.point.blockNum);assert.equal(request.from.blockId,this.point.blockId);
      this.revision++; this.phase = 'rollback'; this.operationIdentity = identity;
      this.operation = {operationId: request.operationId, sourceRevision: request.revision, from: clone(request.from), ancestor: clone(request.ancestor), status: 'running', reason: null};
      const point = this.points.get(request.ancestor.blockNum), floor = (await this.recovery(this.declaration)).coverage.floor;
      if (!point || point.blockId !== request.ancestor.blockId || request.ancestor.blockNum < floor.blockNum) {
        this.operation.status = 'unavailable'; this.operation.reason = 'outside retained canonical undo'; fail('stateful.rollback-unavailable');
      }
    }
    if (this.interruptRollback) {this.interruptRollback = false; fail('stateful.controlled-interruption');}
    let steps = 0;
    while (this.point.blockNum > request.ancestor.blockNum && steps++ < request.maxBlocks) {
      const height = this.point.blockNum, undo = this.undo.get(height); if (!undo) fail('stateful.rollback-unavailable');
      const restored = new Map(this.rows);
      for (const [id, value] of undo.before) if (value === null) restored.delete(id); else restored.set(id, clone(value));
      this.rows = restored; this.point = clone(undo.previous); this.undo.delete(height); this.receipts.delete(height); this.points.delete(height);
    }
    if (this.point.blockNum === request.ancestor.blockNum) {this.operation.status = 'complete'; this.phase = 'ready'; this.pending = null;this.gap=null;}
    return {status: this.phase === 'ready' ? 'rolled-back' : 'in-progress', recovery: await this.recovery(this.declaration)};
  }
  async retainedCheckpoints(declaration, revision) {
    this.binding(declaration); if (revision !== hex(this.revision)) fail('stateful.stale-view');
    const recovery = await this.recovery(declaration);
    return {recovery, checkpoints: [...this.points.values()].filter(p => p.blockNum >= recovery.coverage.floor.blockNum).sort((a,b) => b.blockNum-a.blockNum).map(clone)};
  }
}
export async function setup(backendId = 'reference-memory') {
  const bounds = limits(), input = definition(); input.binding.backendId = backendId;
  const adapter = new ReferenceAdapter(bounds), declaration = await sdk.negotiateStatefulProjection(input, bounds, host(bounds), adapter.capabilities);
  await adapter.initialize(declaration); return {bounds, declaration, adapter, custody: new CandidateStore()};
}
export function source(declaration, blockNum, blockId, previous, events) {
  return {previous, block: {blockNum, blockId, previousBlockId: previous.blockId, timeMs: String(1000 + blockNum)},
    inputs: events.map(([selector, data], order) => {
      const selected = declaration.definition.selectors.find(s => s.id === selector), rawHex = Buffer.from(JSON.stringify(data)).toString('hex');
      return {selector, order, kind: selected.kind, contract: selected.contract, name: selected.name,
        abiDeployment: selected.abiDeployment, abiSha256: selected.abiSha256, mappingRevision: declaration.definition.binding.mappingRevision,
        codecRevision: declaration.definition.binding.codecRevision, normalizerRevision: declaration.definition.binding.normalizerRevision,
        rawHex, rawSha256: hash(Buffer.from(rawHex, 'hex')), sourceEvidence: hash('synthetic-only:' + blockId), data,
        ...(selected.kind === 'action' ? {transactionId: hex(100), actionOrdinal: order + 1, receiver: 'fixture', receiptOrdinal: order, sequence: String(9007199254741093n + BigInt(order))}
          : {transactionId: null, scope: 'fixturecoll', primaryKey: selector, present: true, deltaOrdinal: 0, rowOrdinal: order})};
    })};
}
export const assetId = '9007199254740993';
export const eventsA = () => [['setdata', {name: 'replacement', signed: '-9223372036854775808'}],
  ['mint', {asset_id: assetId, owner: 'alice', mutable_data: {old: 'drop'}, immutable_data: {serial: '18446744073709551615', uv: ['0','18446744073709551615'], fraction: .1}}],
  ['schema', {format: [{name:'image',type:'string'}]}], ['collection', {name:'initial', fee:.05}], ['config',{version:'constructed'}],
  ['transfer', {from:'mallory',to:'wrong'}], ['transfer',{from:'alice',to:'bob'}]];
export function assetReducer(order = []) {
  return async port => {
    const priorities = {config:10,schema:20,collection:20,mint:50,setdata:60,transfer:60,burn:60};
    const ordered = [...port.source.inputs].sort((a,b) => priorities[a.name]-priorities[b.name]); let mintBuffer = [];
    const flush = async () => {for (const data of mintBuffer) {port.put('asset',assetId,{...data,updated_at_block:String(port.source.block.blockNum),owner:data.owner,template_id:null,
      minted_at_block:String(port.source.block.blockNum),minted_at_time:port.source.block.timeMs});
      if ((await port.get('mint',assetId)).status === 'covered-absent') port.put('mint',assetId,{asset_id:assetId,minter:'author'});} mintBuffer=[];};
    for (const input of ordered) {
      if (priorities[input.name]>50 && mintBuffer.length) {order.push('flush');await flush();}
      order.push(input.name);
      if (['config','schema','collection'].includes(input.name)) port.put(input.name,'one',input.data);
      else if (input.name==='mint') mintBuffer.push(input.data);
      else {
        const read = await port.get('asset',assetId); assert.equal(read.status,'present'); const current=read.value;
        if (input.name==='setdata') port.put('asset',assetId,{...current,mutable_data:input.data});
        else if (input.name==='transfer' && current.owner===input.data.from) port.put('asset',assetId,{...current,owner:input.data.to,
          transferred_at_block:String(port.source.block.blockNum),transferred_at_time:port.source.block.timeMs});
        else if (input.name==='burn') port.put('asset',assetId,{...current,owner:null,burned_by_account:current.owner,
          burned_at_block:String(port.source.block.blockNum),burned_at_time:port.source.block.timeMs,updated_at_block:String(port.source.block.blockNum)});
      }
    }
    if (mintBuffer.length) await flush();
    // Final closure is separate from mint; the original mint frontier need not read relationships.
    for (const kind of ['config','collection','schema']) assert.equal((await port.get(kind,'one')).status,'present');
  };
}
