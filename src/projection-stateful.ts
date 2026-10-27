import {canonicalStructuredJsonRecord, validateStructuredInteger} from './internal/structured-values.js';
import type {StructuredRecord} from './internal/structured-values.js';
import {PROJECTION_ROLLBACK_LIMITS, type ProjectionCheckpoint} from './projection.js';
import type {CapturedStatefulSource, StatefulAdapter, StatefulApplyResult, StatefulCandidate,
  StatefulCandidateStore, StatefulCapabilities, StatefulDeclaration, StatefulDefinition, StatefulGuard,
  StatefulInput, StatefulInspection, StatefulKey, StatefulLimits, StatefulMutation, StatefulObservation,
  StatefulQueryRead, StatefulRead, StatefulRecovery, StatefulReduction, StatefulRollback, StatefulSource, StatefulView} from './stateful-types.js';
export type * from './stateful-types.js';

export const STATEFUL_FAMILY = 'stateful-projection-recovery' as const;
export const STATEFUL_HOST_CAPABILITIES = Object.freeze(['ordered-inputs', 'source-authority-revalidation', 'bounded-reduction', 'runtime-recovery'] as const);
export const STATEFUL_ADAPTER_CAPABILITIES = Object.freeze(['structured-records', 'coherent-keyed-reads', 'atomic-group', 'fixed-replay-receipts', 'revision-checkpoint-fence', 'bounded-undo', 'retained-inspection'] as const);
/** Existing recovery ceilings are reused; there are no new workload or aggregate-budget defaults. */
export const STATEFUL_RECOVERY_LIMITS = PROJECTION_ROLLBACK_LIMITS;
const declarations = new WeakSet<object>(), negotiated = new WeakSet<object>();
function captured(declaration: StatefulDeclaration, execution = false): void {
  check(typeof declaration === 'object' && declaration !== null && declarations.has(declaration), 'Recapture the immutable declaration before use');
  if (execution) check(negotiated.has(declaration), 'Explicit host/adapter negotiation is required', 'stateful.capability-unavailable');
}
export class StatefulContractError extends Error {
  constructor(readonly code: string, message: string) {super(message); this.name = 'StatefulContractError';}
}
function check(ok: unknown, message: string, code = 'stateful.invalid-contract'): asserts ok {
  if (!ok) throw new StatefulContractError(code, message);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), 'Expected a record');
}
function keys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  object(value); check(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), 'Unexpected record fields');
}
function count(value: unknown, min = 0): asserts value is number {check(Number.isSafeInteger(value) && (value as number) >= min, 'Expected a bounded integer');}
function hash(value: unknown): asserts value is string {check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Expected SHA-256 identity');}
function text(value: unknown, limits: StatefulLimits): asserts value is string {
  check(typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= limits.keyBytes, 'Expected bounded logical text');
}
function profile(value: unknown): StatefulLimits {
  // Inspect only data descriptors before using untrusted limits as capture bounds.
  object(value); check([Object.prototype, null].includes(Object.getPrototypeOf(value)), 'Expected plain limits');
  check(Object.getOwnPropertySymbols(value).length === 0, 'Symbol limits');
  const p = Object.getOwnPropertyDescriptors(value);
  const names = ['selectors', 'recordKinds', 'inputOccurrences', 'inputBytes', 'keyBytes', 'readKeys', 'readAttempts', 'mutations', 'candidateBytes', 'responseRecords', 'responseBytes'];
  check(Object.keys(p).length === names.length + 2, 'All explicit limits are required');
  for (const name of [...names, 'value', 'envelope']) check(p[name]?.enumerable && Object.hasOwn(p[name]!, 'value'), 'Accessor limits');
  for (const name of names) count(p[name]!.value);
  const structured = p.value!.value;
  // This validates every structured-value bound without inheriting legacy codec restrictions.
  canonicalStructuredJsonRecord({}, [], structured);
  const envelope = p.envelope!.value;
  canonicalStructuredJsonRecord({}, [], envelope);
  check(p.selectors!.value > 0 && p.recordKinds!.value > 0 && p.keyBytes!.value > 0 && p.candidateBytes!.value > 0, 'Empty family bounds');
  return canonicalStructuredJsonRecord(value, [], {...envelope, recordBytes: Math.min(envelope.recordBytes, p.candidateBytes!.value)}).value as unknown as StatefulLimits;
}
function detached<T>(value: unknown, limits: StatefulLimits, bytes = limits.candidateBytes): T {
  return canonicalStructuredJsonRecord(value, [], {...limits.envelope, recordBytes: Math.min(limits.envelope.recordBytes, bytes)}).value as unknown as T;
}
function canonical(value: unknown, limits: StatefulLimits): string {
  return canonicalStructuredJsonRecord(value, [], {...limits.envelope, recordBytes: Math.min(limits.envelope.recordBytes, limits.candidateBytes)}).canonical;
}
async function digest(text: string): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
}
function checkpoint(value: unknown): asserts value is ProjectionCheckpoint {
  keys(value, ['blockNum', 'blockId']); count(value.blockNum); hash(value.blockId);
  if (value.blockNum === 0) check(value.blockId === '0'.repeat(64), 'Genesis identity differs');
}
function same(a: unknown, b: unknown, limits: StatefulLimits): boolean {return canonical(a, limits) === canonical(b, limits);}
export function canonicalStatefulRecord(declaration: StatefulDeclaration, kind: string, value: unknown) {
  captured(declaration);
  const policy = declaration.definition.records.find(r => r.kind === kind);
  check(policy, 'Undeclared record kind');
  return canonicalStructuredJsonRecord(value, policy.integers, declaration.limits.value);
}
/** Capture/identity only. Hosts still own actual declaration, canonical source and ABI authority. */
export async function captureStatefulDeclaration(input: unknown, requested: StatefulLimits): Promise<StatefulDeclaration> {
  const limits = profile(requested), value = detached<StatefulDefinition>(input, limits);
  keys(value, ['family', 'interfaceVersion', 'id', 'binding', 'selectors', 'records']);
  check(value.family === STATEFUL_FAMILY && value.interfaceVersion === 1, 'Unsupported stateful family/version'); text(value.id, limits);
  keys(value.binding, ['chainId', 'backendId', 'generation', 'mappingRevision', 'hookArtifact', 'hookRevision', 'codecRevision', 'normalizerRevision']);
  for (const name of ['chainId', 'mappingRevision', 'hookArtifact', 'hookRevision', 'codecRevision', 'normalizerRevision'] as const) hash(value.binding[name]);
  text(value.binding.backendId, limits); text(value.binding.generation, limits);
  check(Array.isArray(value.selectors) && value.selectors.length > 0 && value.selectors.length <= limits.selectors, 'Selector bound');
  const seen = new Set<string>();
  for (const selector of value.selectors) {
    keys(selector, ['id', 'kind', 'contract', 'name', 'abiDeployment', 'abiSha256']);
    check(selector.kind === 'action' || selector.kind === 'table', 'Selector kind');
    for (const name of ['id', 'contract', 'name', 'abiDeployment'] as const) text(selector[name], limits);
    hash(selector.abiSha256); text(selector.id, limits); check(!seen.has(selector.id), 'Duplicate selector'); seen.add(selector.id);
  }
  check(Array.isArray(value.records) && value.records.length > 0 && value.records.length <= limits.recordKinds, 'Record kind bound'); seen.clear();
  for (const record of value.records) {
    keys(record, ['kind', 'integers']); text(record.kind, limits); check(!seen.has(record.kind), 'Duplicate record kind'); seen.add(record.kind);
    canonicalStructuredJsonRecord({}, record.integers as StatefulDefinition['records'][number]['integers'], limits.value);
  }
  const body = detached<{definition: StatefulDefinition; limits: StatefulLimits}>({definition: value, limits}, limits);
  const result = detached<StatefulDeclaration>({...body, digest: await digest(canonical(body, limits))}, limits);
  declarations.add(result); return result;
}
function capabilities(input: unknown, required: readonly string[], requested: StatefulLimits): void {
  const value = detached<StatefulCapabilities>(input, requested); keys(value, ['family', 'interfaceVersion', 'supported', 'limits']);
  check(value.family === STATEFUL_FAMILY && value.interfaceVersion === 1, 'Unsupported capability family/version', 'stateful.capability-unavailable');
  check(Array.isArray(value.supported) && new Set(value.supported).size === value.supported.length
    && value.supported.every(item => required.includes(item)) && required.every(item => value.supported.includes(item)), 'Missing/unknown capabilities', 'stateful.capability-unavailable');
  const offered = profile(value.limits);
  for (const name of Object.keys(requested) as (keyof StatefulLimits)[]) {
    if (name === 'value' || name === 'envelope') {
      for (const k of Object.keys(requested[name]) as (keyof StatefulLimits['value'])[])
        check(requested[name][k] <= offered[name][k], 'Structured bound unavailable', 'stateful.capability-unavailable');
    } else check(requested[name] <= offered[name], 'Family bound unavailable', 'stateful.capability-unavailable');
  }
}
/** Pure opt-in negotiation before hooks or storage. Advertising these labels proves no implementation. */
export async function negotiateStatefulProjection(input: unknown, requested: StatefulLimits, host: unknown, adapter: unknown): Promise<StatefulDeclaration> {
  const limits = profile(requested); capabilities(host, STATEFUL_HOST_CAPABILITIES, limits); capabilities(adapter, STATEFUL_ADAPTER_CAPABILITIES, limits);
  const declaration = await captureStatefulDeclaration(input, limits); negotiated.add(declaration); return declaration;
}
function sequence(value: unknown): void {
  validateStructuredInteger(value, 'uint64');
}
/** Retains raw bytes, occurrence coordinates and caller order; it does not manufacture chronology. */
export async function captureStatefulSource(declaration: StatefulDeclaration, input: unknown): Promise<CapturedStatefulSource> {
  captured(declaration);
  const limits = declaration.limits, source = detached<StatefulSource>(input, limits);
  keys(source, ['previous', 'block', 'inputs']); checkpoint(source.previous);
  keys(source.block, ['blockNum', 'blockId', 'previousBlockId', 'timeMs']);
  count(source.block.blockNum, 1); hash(source.block.blockId); hash(source.block.previousBlockId); sequence(source.block.timeMs);
  check(source.block.blockNum === source.previous.blockNum + 1 && source.block.previousBlockId === source.previous.blockId, 'Noncontiguous source');
  check(Array.isArray(source.inputs) && source.inputs.length <= limits.inputOccurrences, 'Input occurrence bound');
  let bytes = 0; const occurrences = new Set<string>();
  for (const [index, occurrence] of source.inputs.entries()) {
    const common = ['selector', 'order', 'kind', 'contract', 'name', 'abiDeployment', 'abiSha256', 'mappingRevision', 'codecRevision', 'normalizerRevision', 'rawHex', 'rawSha256', 'sourceEvidence', 'transactionId', 'data'];
    keys(occurrence, [...common, ...(occurrence.kind === 'action' ? ['actionOrdinal', 'receiver', 'receiptOrdinal', 'sequence'] : ['scope', 'primaryKey', 'present', 'deltaOrdinal', 'rowOrdinal'])]);
    const selected = declaration.definition.selectors.find(s => s.id === occurrence.selector);
    check(selected && selected.kind === occurrence.kind && selected.contract === occurrence.contract && selected.name === occurrence.name, 'Undeclared source selector');
    check(occurrence.order === index && occurrence.abiDeployment === selected.abiDeployment && occurrence.abiSha256 === selected.abiSha256
      && occurrence.mappingRevision === declaration.definition.binding.mappingRevision && occurrence.codecRevision === declaration.definition.binding.codecRevision
      && occurrence.normalizerRevision === declaration.definition.binding.normalizerRevision, 'Source occurrence/ABI epoch differs');
    hash(occurrence.sourceEvidence); hash(occurrence.rawSha256);
    check(typeof occurrence.rawHex === 'string' && /^(?:[0-9a-f]{2})*$/.test(occurrence.rawHex), 'Original raw bytes required');
    bytes += occurrence.rawHex.length / 2; check(bytes <= limits.inputBytes, 'Raw input byte bound');
    const raw = Uint8Array.from(occurrence.rawHex.match(/../g) ?? [], s => parseInt(s, 16));
    const observed = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', raw)), n => n.toString(16).padStart(2, '0')).join('');
    check(observed === occurrence.rawSha256, 'Raw payload hash differs');
    let identity: unknown;
    if (occurrence.kind === 'action') {
      hash(occurrence.transactionId); count(occurrence.actionOrdinal, 1); count(occurrence.receiptOrdinal); text(occurrence.receiver, limits);
      if (occurrence.sequence !== null) sequence(occurrence.sequence);
      object(occurrence.data); identity = ['action', occurrence.contract, occurrence.name, occurrence.transactionId, occurrence.receiver, occurrence.actionOrdinal, occurrence.receiptOrdinal];
    } else {
      check(occurrence.kind === 'table' && typeof occurrence.present === 'boolean', 'Table status required');
      if (occurrence.transactionId !== null) hash(occurrence.transactionId);
      text(occurrence.scope, limits); text(occurrence.primaryKey, limits); count(occurrence.deltaOrdinal); count(occurrence.rowOrdinal);
      if (occurrence.present || occurrence.data !== null) object(occurrence.data);
      identity = ['table', occurrence.contract, occurrence.name, occurrence.scope, occurrence.primaryKey, occurrence.deltaOrdinal, occurrence.rowOrdinal];
    }
    const id = JSON.stringify(identity); check(!occurrences.has(id), 'Duplicate original occurrence'); occurrences.add(id);
  }
  const body = detached<{declarationDigest: string; source: StatefulSource}>({declarationDigest: declaration.digest, source}, limits);
  return detached({...body, digest: await digest(canonical(body, limits))}, limits);
}
export function captureStatefulView(declaration: StatefulDeclaration, input: unknown): StatefulView {
  captured(declaration);
  const view = detached<StatefulView>(input, declaration.limits); keys(view, ['declarationDigest', 'backendId', 'generation', 'revision', 'checkpoint']);
  check(view.declarationDigest === declaration.digest && view.backendId === declaration.definition.binding.backendId
    && view.generation === declaration.definition.binding.generation, 'View belongs to another declaration/backend/generation');
  hash(view.revision); checkpoint(view.checkpoint); return view;
}
export function assertStatefulView(declaration: StatefulDeclaration, current: unknown, expected: unknown): void {
  check(same(captureStatefulView(declaration, current), captureStatefulView(declaration, expected), declaration.limits), 'Revision or checkpoint changed', 'stateful.stale-view');
}
/** Durable metadata inspection is not a ready read view or a canonical-source decision. */
export function captureStatefulRecovery(declaration: StatefulDeclaration, input: unknown): StatefulRecovery {
  captured(declaration); const state = detached<StatefulRecovery>(input, declaration.limits);
  keys(state, ['view', 'initialized', 'pending', 'gap', 'rollback', 'coverage']); captureStatefulView(declaration, state.view);
  check(typeof state.initialized === 'boolean', 'Initialization state required');
  if (state.pending !== null) {keys(state.pending, ['sourceDigest', 'candidateDigest']); hash(state.pending.sourceDigest); hash(state.pending.candidateDigest);}
  if (state.gap !== null) {keys(state.gap, ['sourceDigest', 'block', 'reason']); hash(state.gap.sourceDigest); checkpoint(state.gap.block); text(state.gap.reason, declaration.limits);}
  if (state.rollback !== null) {
    const operation = state.rollback; keys(operation, ['operationId', 'sourceRevision', 'from', 'ancestor', 'status', 'reason']);
    hash(operation.operationId); hash(operation.sourceRevision); checkpoint(operation.from); checkpoint(operation.ancestor);
    check(operation.from.blockNum >= operation.ancestor.blockNum && ['running', 'complete', 'unavailable'].includes(operation.status), 'Rollback metadata differs');
    if (operation.status === 'unavailable') text(operation.reason, declaration.limits); else check(operation.reason === null, 'Unexpected rollback failure reason');
  }
  const coverage = state.coverage; keys(coverage, ['floor', 'retainedBlocks', 'retainedBytes', 'maxBlocks', 'maxBytes']); checkpoint(coverage.floor);
  for (const name of ['retainedBlocks', 'retainedBytes', 'maxBlocks', 'maxBytes'] as const) count(coverage[name]);
  check(coverage.maxBlocks > 0 && coverage.maxBlocks <= STATEFUL_RECOVERY_LIMITS.retainedBlocks
    && coverage.maxBytes > 0 && coverage.maxBytes <= STATEFUL_RECOVERY_LIMITS.retainedBytes
    && coverage.retainedBlocks <= coverage.maxBlocks && coverage.retainedBytes <= coverage.maxBytes
    && coverage.floor.blockNum <= state.view.checkpoint.blockNum
    && coverage.retainedBlocks === state.view.checkpoint.blockNum - coverage.floor.blockNum, 'Retained recovery coverage differs');
  return state;
}
/** Same existing rollback lifecycle: exact retry uses its original revision; maxBlocks is work only. */
export function captureStatefulRollback(declaration: StatefulDeclaration, input: unknown, current: unknown):
  {readonly request: StatefulRollback; readonly mode: 'start' | 'resume' | 'duplicate'} {
  captured(declaration); const request = detached<StatefulRollback>(input, declaration.limits), state = captureStatefulRecovery(declaration, current);
  keys(request, ['declarationDigest', 'revision', 'operationId', 'from', 'ancestor', 'maxBlocks']);
  check(request.declarationDigest === declaration.digest, 'Rollback declaration differs'); hash(request.revision); hash(request.operationId);
  checkpoint(request.from); checkpoint(request.ancestor); count(request.maxBlocks, 1);
  check(request.maxBlocks <= STATEFUL_RECOVERY_LIMITS.maxSteps && request.ancestor.blockNum <= request.from.blockNum, 'Rollback call bound');
  check(state.initialized, 'Projection is not initialized', 'stateful.not-initialized');
  const retained = state.rollback;
  if (retained?.operationId === request.operationId) {
    check(retained.sourceRevision === request.revision && same(retained.from, request.from, declaration.limits)
      && same(retained.ancestor, request.ancestor, declaration.limits), 'Rollback operation conflicts', 'stateful.replay-conflict');
    check(retained.status !== 'unavailable', 'Retained undo is unavailable', 'stateful.rollback-unavailable');
    return Object.freeze({request, mode: retained.status === 'complete' ? 'duplicate' : 'resume'});
  }
  check(state.initialized && retained?.status !== 'running', 'Recovery is incomplete', 'stateful.incomplete');
  check(request.revision === state.view.revision && same(request.from, state.view.checkpoint, declaration.limits), 'Rollback fence differs', 'stateful.stale-view');
  return Object.freeze({request, mode: 'start'});
}
function logicalKey(declaration: StatefulDeclaration, input: unknown): StatefulKey {
  const key = detached<StatefulKey>(input, declaration.limits); keys(key, ['kind', 'key']); text(key.key, declaration.limits);
  check(declaration.definition.records.some(r => r.kind === key.kind), 'Undeclared logical kind'); return key;
}
function readValue(declaration: StatefulDeclaration, key: StatefulKey, input: unknown): StatefulRead {
  object(input);
  if (input.status === 'present') {keys(input, ['status', 'value']); return Object.freeze({status: 'present', value: canonicalStatefulRecord(declaration, key.kind, input.value).value});}
  if (input.status === 'covered-absent') {keys(input, ['status']); return Object.freeze({status: 'covered-absent'});}
  keys(input, ['status', 'reason']); check(input.status === 'unavailable', 'Unknown read coverage'); text(input.reason, declaration.limits);
  return Object.freeze({status: 'unavailable', reason: input.reason});
}
async function guarded<T>(guard: StatefulGuard, work: () => Promise<T>): Promise<T> {
  guard(); try {return await work();} finally {guard();}
}
/** Exact-key API composition validates the same revision AND checkpoint around every awaited read. */
export async function readStatefulRecords(declaration: StatefulDeclaration, adapter: StatefulAdapter, expected: StatefulView,
  requested: readonly StatefulKey[], guard: StatefulGuard): Promise<readonly StatefulRead[]> {
  captured(declaration, true); capabilities(adapter.capabilities, STATEFUL_ADAPTER_CAPABILITIES, declaration.limits);
  guard(); const view = captureStatefulView(declaration, expected), limits = declaration.limits;
  const selected = detached<{keys: readonly StatefulKey[]}>({keys: requested}, limits).keys;
  check(Array.isArray(selected) && selected.length <= limits.readKeys && selected.length <= limits.responseRecords, 'Key/read response bound');
  const selectedKeys = selected.map(k => logicalKey(declaration, k));
  assertStatefulView(declaration, await guarded(guard, () => adapter.open(declaration)), view);
  const answer = detached<{view: StatefulView; results: StatefulRead[]}>(await guarded(guard, () => adapter.read(view, selectedKeys)), limits, limits.responseBytes);
  keys(answer, ['results', 'view']);
  check(Array.isArray(answer.results) && answer.results.length === selectedKeys.length, 'Incomplete keyed response');
  assertStatefulView(declaration, answer.view, view);
  const results = answer.results.map((result, i) => readValue(declaration, selectedKeys[i]!, result));
  assertStatefulView(declaration, await guarded(guard, () => adapter.open(declaration)), view); guard();
  return Object.freeze(results);
}
/** Finite keyed API composition: one view, total read/record/output bounds, no native query language. */
export async function composeStatefulRead(declaration: StatefulDeclaration, adapter: StatefulAdapter, expected: StatefulView,
  compose: (port: StatefulQueryRead) => Promise<unknown>, guard: StatefulGuard): Promise<{readonly view: StatefulView; readonly value: StructuredRecord}> {
  captured(declaration, true); capabilities(adapter.capabilities, STATEFUL_ADAPTER_CAPABILITIES, declaration.limits);
  guard(); const view = captureStatefulView(declaration, expected), limits = declaration.limits;
  assertStatefulView(declaration, await guarded(guard, () => adapter.open(declaration)), view);
  let active = true, attempts = 0, records = 0, bytes = 0;
  const admit = () => {guard(); check(active, 'Query read port is closed');};
  const port: StatefulQueryRead = Object.freeze({view, async get(kind: string, key: string) {
    admit(); check(++attempts <= limits.readAttempts && ++records <= limits.responseRecords, 'Composed read/record bound');
    const result = (await readStatefulRecords(declaration, adapter, view, [{kind, key}], guard))[0]; admit();
    check(result && result.status !== 'unavailable', 'Required query coverage unavailable', 'stateful.unavailable');
    bytes += new TextEncoder().encode(canonical({result}, limits)).length;
    check(bytes <= limits.responseBytes, 'Composed read byte bound'); return result;
  }});
  let result: unknown;
  try {result = await guarded(guard, () => compose(port));} finally {active = false;}
  assertStatefulView(declaration, await guarded(guard, () => adapter.open(declaration)), view);
  const value = detached<StructuredRecord>(result, limits, limits.responseBytes); guard();
  return Object.freeze({view, value});
}
function mutation(declaration: StatefulDeclaration, input: unknown): StatefulMutation {
  object(input); keys(input, input.kind === 'put' ? ['kind', 'target', 'value'] : ['kind', 'target']);
  const target = logicalKey(declaration, input.target);
  if (input.kind === 'put') return Object.freeze({kind: 'put', target, value: canonicalStatefulRecord(declaration, target.kind, input.value).value});
  check(input.kind === 'delete', 'Unknown mutation'); return Object.freeze({kind: 'delete', target});
}
/** Revalidate recoverable custody bytes before a fixed plan can reach an adapter. */
export async function captureStatefulCandidate(declaration: StatefulDeclaration, input: unknown): Promise<StatefulCandidate> {
  captured(declaration);
  const limits = declaration.limits, value = detached<StatefulCandidate>(input, limits);
  keys(value, ['declarationDigest', 'source', 'view', 'observations', 'mutations', 'digest']); hash(value.digest);
  check(value.declarationDigest === declaration.digest, 'Candidate declaration differs');
  const source = await captureStatefulSource(declaration, value.source.source);
  check(same(source, value.source, limits), 'Original candidate source differs');
  const view = captureStatefulView(declaration, value.view); check(same(view.checkpoint, source.source.previous, limits), 'Candidate predecessor differs');
  check(Array.isArray(value.observations) && value.observations.length <= limits.readAttempts
    && (limits.readKeys > 0 || value.observations.length === 0), 'Observation bound');
  const seen = new Set<string>();
  for (const observation of value.observations) {
    keys(observation, ['key', 'result']); const key = logicalKey(declaration, observation.key), id = JSON.stringify(key);
    check(!seen.has(id), 'Duplicate base observation'); seen.add(id);
    check(readValue(declaration, key, observation.result).status !== 'unavailable', 'Unavailable candidate observation');
  }
  check(Array.isArray(value.mutations) && value.mutations.length <= limits.mutations, 'Mutation bound');
  for (const item of value.mutations) mutation(declaration, item);
  const {digest: expected, ...body} = value;
  check(await digest(canonical(body, limits)) === expected, 'Fixed candidate identity differs', 'stateful.replay-conflict'); return value;
}
/** A real reduction uses only exact-key reads and whole local puts/deletes; plugin scheduling stays outside. */
export async function reduceStatefulBlock(declaration: StatefulDeclaration, source: CapturedStatefulSource, adapter: StatefulAdapter,
  hook: (port: StatefulReduction) => Promise<void>, guard: StatefulGuard): Promise<StatefulCandidate> {
  captured(declaration, true); capabilities(adapter.capabilities, STATEFUL_ADAPTER_CAPABILITIES, declaration.limits);
  guard(); const selectedSource = detached<CapturedStatefulSource>(source, declaration.limits);
  const original = await guarded(guard, () => captureStatefulSource(declaration, selectedSource.source));
  check(same(original, selectedSource, declaration.limits), 'Source capture identity differs');
  const view = captureStatefulView(declaration, await guarded(guard, () => adapter.open(declaration)));
  check(same(view.checkpoint, original.source.previous, declaration.limits), 'Reduction predecessor is not current', 'stateful.stale-view');
  const overlay = new Map<string, Exclude<StatefulRead, {status: 'unavailable'}>>(), base = new Map<string, StatefulObservation>(), mutations: StatefulMutation[] = [];
  const limits = declaration.limits; let attempts = 0, stagedBytes = 0, active = true;
  const admit = () => {guard(); check(active, 'Reduction port is closed');};
  const stage = (input: unknown) => {
    admit(); check(mutations.length < limits.mutations, 'Mutation bound'); const item = mutation(declaration, input);
    stagedBytes += new TextEncoder().encode(canonical(item, limits)).length; check(stagedBytes <= limits.candidateBytes, 'Staged candidate byte bound');
    mutations.push(item); overlay.set(JSON.stringify(item.target), item.kind === 'put' ? Object.freeze({status: 'present', value: item.value}) : Object.freeze({status: 'covered-absent'}));
  };
  const port: StatefulReduction = Object.freeze({source: original.source, view,
    async get(kind: string, value: string) {
      admit(); check(++attempts <= limits.readAttempts && limits.readKeys >= 1, 'Read attempt bound');
      const key = logicalKey(declaration, {kind, key: value}), id = JSON.stringify(key), staged = overlay.get(id);
      if (staged) return staged;
      const cached = base.get(id); if (cached) return cached.result;
      const [result] = await readStatefulRecords(declaration, adapter, view, [key], guard); admit();
      check(result && result.status !== 'unavailable', 'Required source/relationship coverage unavailable', 'stateful.unavailable');
      base.set(id, Object.freeze({key, result})); return result;
    },
    put: (kind: string, key: string, value: unknown) => stage({kind: 'put', target: {kind, key}, value}),
    delete: (kind: string, key: string) => stage({kind: 'delete', target: {kind, key}})});
  try {await guarded(guard, () => hook(port));} finally {active = false;}
  assertStatefulView(declaration, await guarded(guard, () => adapter.open(declaration)), view);
  const body = {declarationDigest: declaration.digest, source: original, view, observations: [...base.values()], mutations};
  // Reserve the complete digest member before hashing, not just the smaller unhashed body.
  detached({...body, digest: '0'.repeat(64)}, limits);
  const candidate = detached<StatefulCandidate>({...body, digest: await guarded(guard, () => digest(canonical(body, limits)))}, limits);
  return guarded(guard, () => captureStatefulCandidate(declaration, candidate));
}
/**
 * Receipt inspection and host input custody precede hooks/storage. Exact redelivery and uncertain
 * retries reuse the original candidate; pending/gap/rollback/expired coverage cannot grant readiness.
 */
export async function executeStatefulBlock(declaration: StatefulDeclaration, input: unknown, adapter: StatefulAdapter,
  custody: StatefulCandidateStore, hook: (port: StatefulReduction) => Promise<void>, guard: StatefulGuard): Promise<StatefulApplyResult> {
  captured(declaration, true); capabilities(adapter.capabilities, STATEFUL_ADAPTER_CAPABILITIES, declaration.limits);
  const source = await guarded(guard, () => captureStatefulSource(declaration, input)), limits = declaration.limits;
  const raw = await guarded(guard, () => adapter.inspect(declaration, source));
  const inspection = detached<StatefulInspection>(raw, limits);
  keys(inspection, ['phase', 'status', 'sourceDigest', 'candidateDigest', 'progress']);
  const progress = captureStatefulView(declaration, inspection.progress);
  check(['ready', 'pending', 'gap', 'rollback'].includes(inspection.phase) && ['new', 'pending', 'committed', 'uncovered'].includes(inspection.status), 'Unknown inspection state');
  if (inspection.sourceDigest !== null) hash(inspection.sourceDigest);
  if (inspection.candidateDigest !== null) hash(inspection.candidateDigest);
  check(inspection.phase === 'ready' || inspection.phase === 'pending' && inspection.status === 'pending', 'Projection is incomplete', 'stateful.incomplete');
  check(inspection.status !== 'uncovered', 'Source receipt coverage expired', 'stateful.receipt-unavailable');
  if (inspection.status === 'new') check(inspection.sourceDigest === null && inspection.candidateDigest === null, 'New inspection carries a retained identity');
  if (inspection.status === 'pending') check(inspection.sourceDigest !== null && inspection.candidateDigest !== null, 'Pending inspection has no retained identity');
  if (inspection.status === 'committed') {
    check(inspection.sourceDigest === source.digest && inspection.candidateDigest !== null, 'Conflicting committed source', 'stateful.replay-conflict');
    check(progress.checkpoint.blockNum >= source.source.block.blockNum && (progress.checkpoint.blockNum !== source.source.block.blockNum
      || progress.checkpoint.blockId === source.source.block.blockId), 'Committed progress does not contain the source');
    return Object.freeze({status: 'duplicate', progress});
  }
  const saved = await guarded(guard, () => custody.load(declaration.digest, source.digest));
  let candidate: StatefulCandidate;
  if (saved !== null) candidate = await guarded(guard, () => captureStatefulCandidate(declaration, saved));
  else {
    check(inspection.status === 'new' && inspection.phase === 'ready' && inspection.sourceDigest === null && inspection.candidateDigest === null, 'Original pending candidate is unavailable', 'stateful.incomplete');
    candidate = await reduceStatefulBlock(declaration, source, adapter, hook, guard);
    await guarded(guard, () => custody.retain(candidate));
  }
  check(same(candidate.source, source, limits), 'Custody belongs to another source', 'stateful.replay-conflict');
  if (inspection.status === 'pending') check(inspection.sourceDigest === source.digest && inspection.candidateDigest === candidate.digest, 'Pending candidate differs', 'stateful.replay-conflict');
  assertStatefulView(declaration, progress, candidate.view);
  const result = detached<StatefulApplyResult>(await guarded(guard, () => adapter.apply(candidate)), limits);
  keys(result, ['status', 'progress']); check(result.status === 'applied' || result.status === 'duplicate', 'Unknown apply outcome');
  captureStatefulView(declaration, result.progress);
  check(result.progress.checkpoint.blockNum >= source.source.block.blockNum && (result.progress.checkpoint.blockNum !== source.source.block.blockNum
    || result.progress.checkpoint.blockId === source.source.block.blockId), 'Apply progress does not contain the source');
  if (result.status === 'applied') check(result.progress.checkpoint.blockNum === source.source.block.blockNum
    && result.progress.revision === candidate.view.revision, 'Applied progress changed its revision or advanced beyond its source');
  return result;
}
