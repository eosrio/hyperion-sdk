// Controlled native-port semantics only; this is neither MongoDB nor durability qualification.
import assert from 'node:assert/strict';
import * as v1 from '../../dist/projection-stateful.js';
import * as owner from '../../dist/projection-stateful-owner-v2.js';
import {definition, limits, hex} from './stateful-reference.mjs';

export const completeLimits = () => ({readAttempts: 12, responseRecords: 8, responseBytes: 65536});
export const offer = (bounds = completeLimits()) => ({family: owner.STATEFUL_COMPLETE_KIND_FAMILY_V1, interfaceVersion: 1, limits: bounds});
const ownerOffer = (supported, bounds = limits()) => ({family: owner.STATEFUL_OWNER_FAMILY_V2, interfaceVersion: 2,
  sourceInputVersions: [2], supported, limits: bounds});
const clone = value => structuredClone(value);
const unavailable = message => {throw new v1.StatefulContractError('stateful.unavailable', message);};

/** Adapter-local identities and retained guards exercise the actual completedRead composition path. */
export class CompleteKindReference {
  #reads = new WeakMap();
  constructor(declaration) {
    this.declaration = declaration;
    this.capabilities = ownerOffer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2, declaration.projection.limits);
    this.completeKindCapabilities = offer();
    this.identity = {id: 'fixture-owner', generation: 'owner-one'};
    this.view = {declarationDigest: declaration.digest, backendId: declaration.projection.definition.binding.backendId,
      generation: declaration.projection.definition.binding.generation, revision: hex(77), checkpoint: {blockNum: 1, blockId: hex(1)}};
    this.phase = 'idle'; this.live = true; this.closed = 0; this.acquired = 0; this.kindCalls = 0; this.getCalls = 0;
    this.requests = []; this.keyRequests = []; this.rows = new Map(); this.pageSize = 2; this.beforeReturn = undefined;
    this.keyedAttempts = 1; this.nativeDataAttempts = 0;
  }
  guard = () => {if (!this.live || this.phase !== 'idle') unavailable('Actual owner/request/phase authority is unavailable');};
  async completedRead(identity, view, guard) {
    this.guard(); guard(); assert.deepEqual(clone(identity), this.identity); assert.deepEqual(clone(view), this.view);
    const read = Object.freeze({}); this.#reads.set(read, {active: true, identity: clone(identity), view: clone(view), guard});
    this.acquired++; return read;
  }
  use(read, expected) {
    const state = this.#reads.get(read);
    if (!state?.active) unavailable('Foreign or closed native capability');
    state.guard(); this.guard(); assert.deepEqual(state.identity, this.identity); assert.deepEqual(state.view, this.view);
    if (expected) assert.deepEqual(clone(expected), this.view);
    return state;
  }
  async completedView(read) {this.use(read); return clone(this.view);}
  async keyData(read, expected, keys, maximumAttempts) {
    this.use(read, expected); this.getCalls++;
    for (let attempt = 1; attempt <= this.keyedAttempts; attempt++) {
      if (attempt > maximumAttempts) unavailable('Native keyed data-read attempt budget before retry');
      this.use(read, expected); this.nativeDataAttempts++; await Promise.resolve(); this.use(read, expected);
    }
    const answer = {view: clone(this.view), results: keys.map(({kind, key}) => {
      const value = this.rows.get(kind)?.get(key); return value === undefined ? {status: 'covered-absent'} : {status: 'present', value: clone(value)};
    })};
    return answer;
  }
  async readCompleted(read, expected, keys) {
    const answer = await this.keyData(read, expected, keys, Infinity);
    if (this.beforeReturn) await this.beforeReturn('legacy-get', answer);
    this.use(read, expected); return answer;
  }
  async readCompletedKey(read, expected, key, remaining) {
    this.keyRequests.push(clone(remaining));
    if (remaining.responseRecords < 1) unavailable('Native keyed record total exceeded');
    const answer = await this.keyData(read, expected, [key], remaining.readAttempts);
    const counted = {view: answer.view, result: answer.results[0], attempts: this.keyedAttempts};
    if (Buffer.byteLength(JSON.stringify(counted)) > remaining.responseBytes) unavailable('Native keyed serialized byte bound');
    if (this.beforeReturn) await this.beforeReturn('get', counted);
    this.use(read, expected); return counted;
  }
  async readCompletedKind(read, expected, kind, remaining) {
    this.use(read, expected); this.kindCalls++; this.requests.push(clone(remaining));
    const source = [...(this.rows.get(kind) ?? [])], rows = [];
    let offset = 0, attempts = 0;
    // Explicit empty terminal page; a short nonempty page is never interpreted as exhaustion.
    for (;;) {
      if (++attempts > remaining.readAttempts) unavailable('Native attempt budget before exhaustion');
      this.nativeDataAttempts++;
      const page = source.slice(offset, offset + this.pageSize); offset += page.length;
      if (page.length === 0) break;
      for (const [key, value] of page) {
        rows.push({key, value: clone(value)});
        if (rows.length > remaining.responseRecords) unavailable('Native row overflow probe');
      }
    }
    const answer = {view: clone(this.view), kind, complete: true, rows, attempts};
    if (Buffer.byteLength(JSON.stringify(answer)) > remaining.responseBytes) unavailable('Native serialized byte bound');
    if (this.beforeReturn) await this.beforeReturn('all', answer);
    this.use(read, expected); return answer;
  }
  closeRead(read) {const state = this.#reads.get(read); if (state?.active) {state.active = false; this.closed++;}}
}

export async function prepared(requested = completeLimits(), bounds = limits()) {
  const projection = await v1.captureStatefulDeclaration(definition(), bounds);
  const declaration = await owner.negotiateStatefulOwnerV2(projection,
    ownerOffer(owner.STATEFUL_OWNER_HOST_CAPABILITIES_V2, bounds), ownerOffer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2, bounds));
  const adapter = new CompleteKindReference(declaration);
  const selection = owner.negotiateStatefulCompleteKindV1(declaration, requested, offer(), adapter.completeKindCapabilities);
  const compose = (callback, guard = adapter.guard) => owner.composeStatefulOwnerCompleteKindReadV1(selection, adapter,
    clone(adapter.identity), clone(adapter.view), callback, guard);
  return {projection, declaration, adapter, selection, compose};
}
