import {canonicalStructuredJsonRecord} from './internal/structured-values.js';
import {isCapturedStatefulDeclaration} from './internal/stateful-ownership.js';
import {captureRawStatefulTarget} from './internal/stateful-input-v2.js';
import {executionApply, executionCompose, type ExecutionPolicy, type ExecutionPort} from './internal/stateful-execution.js';
import {captureStatefulDeclaration, canonicalStatefulRecord, StatefulContractError, STATEFUL_RECOVERY_LIMITS} from './projection-stateful.js';
import {captureStatefulSourceV2, type CapturedStatefulSourceV2} from './projection-stateful-source-v2.js';
import type {ProjectionCheckpoint} from './projection.js';
import type {StructuredRecord} from './internal/structured-values.js';
import type {StatefulDeclaration, StatefulGuard, StatefulKey, StatefulLimits, StatefulMutation,
  StatefulRead, StatefulRollback, StatefulView} from './stateful-types.js';
import type {CapturedRawStatefulTargetV2, StatefulCandidateStoreV2, StatefulCandidateV2,
  StatefulOwnerAdapterV2, StatefulOwnerCapabilitiesV2, StatefulOwnerDeclarationV2, StatefulOwnerIdentityV2,
  StatefulOwnedInspectionV2, StatefulOwnerLeaseV2, StatefulOwnerRecoveryV2, StatefulReductionReadV2, StatefulReductionV2,
  StatefulCompleteKindAdapterV1, StatefulCompleteKindCapabilitiesV1, StatefulCompleteKindLimitsV1,
  StatefulCompleteKindReadV1, StatefulCompleteKindResultV1, StatefulCompleteKindSelectionV1} from './stateful-owner-v2-types.js';
export type * from './stateful-owner-v2-types.js';

export const STATEFUL_OWNER_FAMILY_V2 = 'stateful-projection-owner-recovery' as const;
export const STATEFUL_OWNER_HOST_CAPABILITIES_V2 = Object.freeze(['ordered-inputs', 'source-authority-revalidation',
  'bounded-reduction', 'runtime-recovery', 'raw-before-decode', 'live-owner-query-authority', 'original-input-v2'] as const);
export const STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2 = Object.freeze(['structured-records', 'coherent-keyed-reads',
  'atomic-group', 'fixed-replay-receipts', 'revision-checkpoint-fence', 'bounded-undo', 'retained-inspection',
  'raw-owner-cas', 'same-record-recovery', 'private-reduction-reads', 'exact-raw-retirement', 'original-input-v2'] as const);
const captured = new WeakSet<object>(), negotiated = new WeakSet<object>();
function check(ok: unknown, message: string, code = 'stateful.invalid-contract'): asserts ok {
  if (!ok) throw new StatefulContractError(code, message);
}
function fields(input: unknown, names: readonly string[]): Record<string, PropertyDescriptor> {
  check(typeof input === 'object' && input !== null && !Array.isArray(input)
    && [Object.prototype, null].includes(Object.getPrototypeOf(input)), 'Expected inert owner record');
  const entries = Object.getOwnPropertyDescriptors(input);
  check(Object.getOwnPropertySymbols(input).length === 0 && Object.keys(entries).length === names.length
    && names.every(name => entries[name]?.enumerable && Object.hasOwn(entries[name]!, 'value')), 'Unexpected owner fields/accessors');
  return entries;
}
function hash(value: unknown): asserts value is string {check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Expected exact digest');}
function text(value: unknown, limits: StatefulLimits): asserts value is string {
  check(typeof value === 'string' && value.length > 0
    && new TextEncoder().encode(value).length <= limits.keyBytes, 'Expected bounded owner text');
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {const low = value.charCodeAt(++index); check(low >= 0xdc00 && low <= 0xdfff, 'Malformed owner text');}
    else check(unit < 0xdc00 || unit > 0xdfff, 'Malformed owner text');
  }
}
function owned(d: StatefulOwnerDeclarationV2, execution = false): void {
  check(typeof d === 'object' && d !== null && captured.has(d), 'Recapture the owner declaration before use');
  if (execution) check(negotiated.has(d), 'Explicit owner v2 negotiation is required', 'stateful.capability-unavailable');
}
function canonical(input: unknown, limits: StatefulLimits, maximumBytes = limits.candidateBytes) {
  return canonicalStructuredJsonRecord(input, [], {...limits.envelope,
    recordBytes: Math.min(limits.envelope.recordBytes, maximumBytes)});
}
function detach<T>(input: unknown, limits: StatefulLimits, maximumBytes?: number): T {
  return canonical(input, limits, maximumBytes).value as unknown as T;
}
async function digest(text: string): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
function point(input: unknown): asserts input is ProjectionCheckpoint {
  fields(input, ['blockNum', 'blockId']); const value = input as ProjectionCheckpoint;
  check(Number.isSafeInteger(value.blockNum) && value.blockNum >= 0, 'Expected checkpoint height'); hash(value.blockId);
  if (value.blockNum === 0) check(value.blockId === '0'.repeat(64), 'Owner genesis differs');
}
async function guarded<T>(guard: StatefulGuard, work: () => Promise<T>): Promise<T> {
  guard(); try {return await work();} finally {guard();}
}

/** Explicit opt-in wrapper; the closed v1 projection remains genuinely captured, not recast as v2. */
export async function captureStatefulOwnerDeclarationV2(projection: StatefulDeclaration, sourceInputVersion: 2): Promise<StatefulOwnerDeclarationV2> {
  check(isCapturedStatefulDeclaration(projection), 'Recapture the immutable projection declaration');
  check(sourceInputVersion === 2, 'Original source version2 must be explicitly selected');
  const limits = projection.limits;
  const body = {family: STATEFUL_OWNER_FAMILY_V2, interfaceVersion: 2 as const, sourceInputVersion, projection};
  canonical({...body, digest: '0'.repeat(64)}, limits);
  const result = Object.freeze({...body, digest: await digest(canonical(body, limits).canonical)});
  captured.add(result); return result;
}

/** Receiving DTO validation restores real local v1 capture ownership without granting execution. */
export async function receiveStatefulOwnerDeclarationV2(input: unknown): Promise<StatefulOwnerDeclarationV2> {
  const outer = fields(input, ['family', 'interfaceVersion', 'sourceInputVersion', 'projection', 'digest']);
  check(outer.family!.value === STATEFUL_OWNER_FAMILY_V2 && outer.interfaceVersion!.value === 2
    && outer.sourceInputVersion!.value === 2, 'Unsupported owner family/source version', 'stateful.capability-unavailable');
  const expected = outer.digest!.value; hash(expected);
  const inner = fields(outer.projection!.value, ['definition', 'limits', 'digest']), innerDigest = inner.digest!.value; hash(innerDigest);
  // captureStatefulDeclaration snapshots both inputs before its first hashing await.
  const projection = await captureStatefulDeclaration(inner.definition!.value, inner.limits!.value);
  check(projection.digest === innerDigest, 'Projection declaration digest differs');
  const result = await captureStatefulOwnerDeclarationV2(projection, 2); check(result.digest === expected, 'Owner declaration digest differs'); return result;
}

async function validateCapabilities(projection: StatefulDeclaration, input: unknown, required: readonly string[]): Promise<void> {
  const limits = projection.limits, value = detach<StatefulOwnerCapabilitiesV2>(input, limits);
  fields(value, ['family', 'interfaceVersion', 'sourceInputVersions', 'supported', 'limits']);
  check(value.family === STATEFUL_OWNER_FAMILY_V2 && value.interfaceVersion === 2
    && Array.isArray(value.sourceInputVersions) && value.sourceInputVersions.length === 1 && value.sourceInputVersions[0] === 2,
    'Owner source version/capability family differs', 'stateful.capability-unavailable');
  check(Array.isArray(value.supported) && value.supported.length === required.length
    && new Set(value.supported).size === value.supported.length
    && required.every(item => value.supported.includes(item)), 'Missing/unknown owner capabilities', 'stateful.capability-unavailable');
  const offered = (await captureStatefulDeclaration(projection.definition, value.limits)).limits;
  for (const name of Object.keys(limits) as (keyof StatefulLimits)[]) {
    if (name === 'value' || name === 'envelope') {
      for (const field of Object.keys(limits[name]) as (keyof StatefulLimits['value'])[])
        check(limits[name][field] <= offered[name][field], 'Owner structured bound unavailable', 'stateful.capability-unavailable');
    } else check(limits[name] <= offered[name], 'Owner family bound unavailable', 'stateful.capability-unavailable');
  }
}
export async function negotiateStatefulOwnerV2(projection: StatefulDeclaration, host: unknown, adapter: unknown): Promise<StatefulOwnerDeclarationV2> {
  check(isCapturedStatefulDeclaration(projection), 'Recapture the immutable projection declaration');
  const hostInput = detach(host, projection.limits), adapterInput = detach(adapter, projection.limits);
  await validateCapabilities(projection, hostInput, STATEFUL_OWNER_HOST_CAPABILITIES_V2);
  await validateCapabilities(projection, adapterInput, STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2);
  const declaration = await captureStatefulOwnerDeclarationV2(projection, 2); negotiated.add(declaration); return declaration;
}

export function captureStatefulOwnerViewV2(d: StatefulOwnerDeclarationV2, input: unknown): StatefulView {
  owned(d); const view = detach<StatefulView>(input, d.projection.limits);
  fields(view, ['declarationDigest', 'backendId', 'generation', 'revision', 'checkpoint']);
  check(view.declarationDigest === d.digest && view.backendId === d.projection.definition.binding.backendId
    && view.generation === d.projection.definition.binding.generation, 'Owner view binding differs');
  hash(view.revision); point(view.checkpoint); return view;
}
export function assertStatefulOwnerViewV2(d: StatefulOwnerDeclarationV2, current: unknown, expected: unknown): void {
  check(canonical(captureStatefulOwnerViewV2(d, current), d.projection.limits).canonical
    === canonical(captureStatefulOwnerViewV2(d, expected), d.projection.limits).canonical,
    'Revision or checkpoint changed', 'stateful.stale-view');
}
export async function captureStatefulRawTargetV2(d: StatefulOwnerDeclarationV2, input: unknown): Promise<CapturedRawStatefulTargetV2> {
  owned(d); const capturedTarget = await captureRawStatefulTarget(input, d.projection.limits), target = capturedTarget.target;
  check(target.declarationDigest === d.digest && target.chainId === d.projection.definition.binding.chainId, 'Raw target declaration/chain differs');
  captureStatefulOwnerViewV2(d, target.previous);
  text(target.owner.id, d.projection.limits); text(target.owner.generation, d.projection.limits);
  for (const id of [target.rawSource.commitId, target.rawSource.selectionId, target.rawSource.observationId]) text(id, d.projection.limits);
  return capturedTarget;
}

/** Recovery inspection is inert evidence, never a transferable owner or serving grant. */
export async function captureStatefulOwnerRecoveryV2(d: StatefulOwnerDeclarationV2, input: unknown): Promise<StatefulOwnerRecoveryV2> {
  owned(d); const state = detach<StatefulOwnerRecoveryV2>(input, d.projection.limits);
  fields(state, ['interfaceVersion', 'sourceInputVersion', 'version', 'view', 'initialized', 'owner', 'raw', 'pending', 'gap', 'rollback', 'coverage']);
  check(state.interfaceVersion === 2 && state.sourceInputVersion === 2 && typeof state.initialized === 'boolean', 'Owner recovery version differs');
  hash(state.version); captureStatefulOwnerViewV2(d, state.view);
  if (state.owner !== null) {
    fields(state.owner, ['identity', 'claimDigest']); fields(state.owner.identity, ['id', 'generation']);
    text(state.owner.identity.id, d.projection.limits); text(state.owner.identity.generation, d.projection.limits); hash(state.owner.claimDigest);
  }
  if (state.raw !== null) {
    fields(state.raw, ['target', 'sourceDigest']); fields(state.raw.target, ['target', 'digest']);
    const original = await captureStatefulRawTargetV2(d, state.raw.target.target);
    check(original.digest === state.raw.target.digest, 'Raw target capture differs');
    if (state.raw.sourceDigest !== null) hash(state.raw.sourceDigest);
    const before = original.target.previous, block = original.target.block, current = state.view;
    check(before.revision === current.revision && (canonical(before, d.projection.limits).canonical === canonical(current, d.projection.limits).canonical
      || state.raw.sourceDigest !== null && block.blockNum === current.checkpoint.blockNum && block.blockId === current.checkpoint.blockId),
    'Raw target no longer belongs to its predecessor or just-completed view');
  }
  if (state.pending !== null) {
    fields(state.pending, ['sourceDigest', 'candidateDigest']); hash(state.pending.sourceDigest); hash(state.pending.candidateDigest);
    check(state.raw !== null && state.raw.sourceDigest === state.pending.sourceDigest
      && state.raw.target.target.block.blockNum === state.view.checkpoint.blockNum + 1, 'Pending candidate lacks its original raw slot');
  }
  if (state.gap !== null) {
    const gap = state.gap; fields(gap, gap.kind === 'raw' ? ['kind', 'targetDigest', 'block', 'reason']
      : ['kind', 'targetDigest', 'sourceDigest', 'block', 'reason']);
    check(gap.kind === 'raw' || gap.kind === 'source', 'Unknown owner failure'); hash(gap.targetDigest); point(gap.block); text(gap.reason, d.projection.limits);
    check(state.raw !== null && state.raw.target.digest === gap.targetDigest
      && gap.block.blockNum === state.raw.target.target.block.blockNum && gap.block.blockId === state.raw.target.target.block.blockId,
    'Failure does not own the exact raw target');
    if (gap.kind === 'source') {hash(gap.sourceDigest); check(state.raw.sourceDigest === gap.sourceDigest, 'Failure decoded source differs');}
  }
  if (state.rollback !== null) {
    const r = state.rollback; fields(r, ['operationId', 'sourceRevision', 'from', 'ancestor', 'status', 'reason']);
    hash(r.operationId); hash(r.sourceRevision); point(r.from); point(r.ancestor);
    check(r.from.blockNum >= r.ancestor.blockNum && ['running', 'complete', 'unavailable'].includes(r.status), 'Rollback metadata differs');
    if (r.status === 'unavailable') text(r.reason, d.projection.limits); else check(r.reason === null, 'Unexpected rollback failure reason');
    if (r.status !== 'complete') check(state.raw === null && state.pending === null && state.gap === null, 'Rollback conflicts with raw recovery');
  }
  const coverage = state.coverage; fields(coverage, ['floor', 'retainedBlocks', 'retainedBytes', 'maxBlocks', 'maxBytes']); point(coverage.floor);
  for (const name of ['retainedBlocks', 'retainedBytes', 'maxBlocks', 'maxBytes'] as const)
    check(Number.isSafeInteger(coverage[name]) && coverage[name] >= 0, 'Expected coverage integer');
  check(coverage.maxBlocks > 0 && coverage.maxBlocks <= STATEFUL_RECOVERY_LIMITS.retainedBlocks
    && coverage.maxBytes > 0 && coverage.maxBytes <= STATEFUL_RECOVERY_LIMITS.retainedBytes
    && coverage.retainedBlocks <= coverage.maxBlocks && coverage.retainedBytes <= coverage.maxBytes
    && coverage.floor.blockNum <= state.view.checkpoint.blockNum
    && coverage.retainedBlocks === state.view.checkpoint.blockNum - coverage.floor.blockNum, 'Retained recovery coverage differs');
  if (!state.initialized) check(state.view.checkpoint.blockNum === 0 && state.raw === null && state.pending === null
    && state.gap === null && state.rollback === null && coverage.retainedBlocks === 0 && coverage.retainedBytes === 0, 'Uninitialized owner storage contains effects');
  return state;
}

export async function captureStatefulOwnerRollbackV2(d: StatefulOwnerDeclarationV2, input: unknown, current: unknown):
  Promise<{readonly request: StatefulRollback; readonly mode: 'start' | 'resume' | 'duplicate'}> {
  owned(d); const request = detach<StatefulRollback>(input, d.projection.limits), state = await captureStatefulOwnerRecoveryV2(d, current);
  fields(request, ['declarationDigest', 'revision', 'operationId', 'from', 'ancestor', 'maxBlocks']);
  check(request.declarationDigest === d.digest, 'Rollback declaration differs'); hash(request.revision); hash(request.operationId); point(request.from); point(request.ancestor);
  check(Number.isSafeInteger(request.maxBlocks) && request.maxBlocks > 0 && request.maxBlocks <= STATEFUL_RECOVERY_LIMITS.maxSteps
    && request.ancestor.blockNum <= request.from.blockNum, 'Rollback call bound');
  check(state.initialized, 'Projection is not initialized', 'stateful.not-initialized');
  const retained = state.rollback;
  if (retained?.operationId === request.operationId) {
    check(retained.sourceRevision === request.revision && canonical(retained.from, d.projection.limits).canonical === canonical(request.from, d.projection.limits).canonical
      && canonical(retained.ancestor, d.projection.limits).canonical === canonical(request.ancestor, d.projection.limits).canonical, 'Rollback operation conflicts', 'stateful.replay-conflict');
    check(retained.status !== 'unavailable', 'Retained undo is unavailable', 'stateful.rollback-unavailable');
    return Object.freeze({request, mode: retained.status === 'complete' ? 'duplicate' : 'resume'});
  }
  check(retained?.status !== 'running', 'Recovery is incomplete', 'stateful.incomplete');
  check(request.revision === state.view.revision && canonical(request.from, d.projection.limits).canonical === canonical(state.view.checkpoint, d.projection.limits).canonical,
    'Rollback fence differs', 'stateful.stale-view'); return Object.freeze({request, mode: 'start'});
}

function logicalKey(d: StatefulOwnerDeclarationV2, input: unknown): StatefulKey {
  const key = detach<StatefulKey>(input, d.projection.limits); fields(key, ['kind', 'key']); text(key.key, d.projection.limits);
  check(d.projection.definition.records.some(record => record.kind === key.kind), 'Undeclared logical kind'); return key;
}
function readValue(d: StatefulOwnerDeclarationV2, key: StatefulKey, input: unknown): StatefulRead {
  const value = detach<StatefulRead>(input, d.projection.limits);
  if (value.status === 'present') {fields(value, ['status', 'value']); return Object.freeze({status: 'present',
    value: canonicalStatefulRecord(d.projection, key.kind, value.value).value});}
  if (value.status === 'covered-absent') {fields(value, ['status']); return Object.freeze({status: 'covered-absent'});}
  fields(value, ['status', 'reason']); check(value.status === 'unavailable', 'Unknown read coverage');
  text(value.reason, d.projection.limits); return Object.freeze({status: 'unavailable', reason: value.reason});
}
function mutation(d: StatefulOwnerDeclarationV2, input: unknown): StatefulMutation {
  const value = detach<StatefulMutation>(input, d.projection.limits);
  fields(value, value.kind === 'put' ? ['kind', 'target', 'value'] : ['kind', 'target']);
  const target = logicalKey(d, value.target);
  if (value.kind === 'put') return Object.freeze({kind: 'put', target,
    value: canonicalStatefulRecord(d.projection, target.kind, value.value).value});
  check(value.kind === 'delete', 'Unknown mutation'); return Object.freeze({kind: 'delete', target});
}
/** Real source-v2 capture and fixed candidate validation; no down-conversion to a v1 table source. */
export async function captureStatefulOwnerCandidateV2(d: StatefulOwnerDeclarationV2, input: unknown): Promise<StatefulCandidateV2> {
  owned(d); const limits = d.projection.limits, candidate = detach<StatefulCandidateV2>(input, limits);
  fields(candidate, ['declarationDigest', 'source', 'view', 'observations', 'mutations', 'digest']); hash(candidate.digest);
  check(candidate.declarationDigest === d.digest, 'Candidate declaration differs');
  const source = await captureStatefulSourceV2(d, candidate.source.source);
  check(canonical(source, limits).canonical === canonical(candidate.source, limits).canonical, 'Original candidate source differs');
  const view = captureStatefulOwnerViewV2(d, candidate.view);
  check(canonical(view.checkpoint, limits).canonical === canonical(source.source.previous, limits).canonical, 'Candidate predecessor differs');
  check(Array.isArray(candidate.observations) && candidate.observations.length <= limits.readAttempts
    && (limits.readKeys > 0 || candidate.observations.length === 0), 'Observation bound');
  const seen = new Set<string>();
  for (const observation of candidate.observations) {
    fields(observation, ['key', 'result']); const key = logicalKey(d, observation.key), identity = JSON.stringify(key);
    check(!seen.has(identity), 'Duplicate base observation'); seen.add(identity);
    check(readValue(d, key, observation.result).status !== 'unavailable', 'Unavailable candidate observation');
  }
  check(Array.isArray(candidate.mutations) && candidate.mutations.length <= limits.mutations, 'Mutation bound');
  for (const entry of candidate.mutations) mutation(d, entry);
  const {digest: expected, ...body} = candidate;
  check(await digest(canonical(body, limits).canonical) === expected, 'Fixed candidate identity differs', 'stateful.replay-conflict'); return candidate;
}

function executionPolicy(d: StatefulOwnerDeclarationV2, targetDigest: string): ExecutionPolicy<CapturedStatefulSourceV2, StatefulCandidateV2> {
  return {
    get digest() {return d.digest;}, get limits() {return d.projection.limits;}, admit() {owned(d, true);},
    error: (code, message) => new StatefulContractError(code, message),
    detach: <T>(input: unknown, maximumBytes?: number) => detach<T>(input, d.projection.limits, maximumBytes),
    canonical: input => canonical(input, d.projection.limits).canonical, hash: digest,
    source: input => captureStatefulSourceV2(d, input), candidate: input => captureStatefulOwnerCandidateV2(d, input),
    view: input => captureStatefulOwnerViewV2(d, input), assertView: (current, expected) => assertStatefulOwnerViewV2(d, current, expected),
    key: input => logicalKey(d, input), mutation: input => mutation(d, input), readValue: (key, input) => readValue(d, key, input),
    inspection(input) {
      const inspection = detach<StatefulOwnedInspectionV2>(input, d.projection.limits);
      fields(inspection, ['phase', 'status', 'targetDigest', 'sourceDigest', 'candidateDigest', 'progress']);
      const progress = captureStatefulOwnerViewV2(d, inspection.progress);
      check(['idle', 'raw', 'bound', 'failed', 'pending', 'rollback'].includes(inspection.phase)
        && ['new', 'pending', 'committed', 'uncovered'].includes(inspection.status), 'Unknown owner inspection state');
      check(inspection.targetDigest === targetDigest, 'Owned raw target differs', 'stateful.replay-conflict');
      if (inspection.sourceDigest !== null) hash(inspection.sourceDigest);
      if (inspection.candidateDigest !== null) hash(inspection.candidateDigest);
      check(inspection.phase !== 'rollback' && inspection.phase !== 'idle' && inspection.phase !== 'raw', 'Owned source is not bound', 'stateful.incomplete');
      check(inspection.status !== 'uncovered', 'Source receipt coverage expired', 'stateful.receipt-unavailable');
      if (inspection.status === 'new') check(inspection.sourceDigest === null && inspection.candidateDigest === null, 'New inspection carries a candidate identity');
      if (inspection.status === 'pending') check(inspection.sourceDigest !== null && inspection.candidateDigest !== null, 'Pending inspection lacks its fixed identity');
      return {status: inspection.status, sourceDigest: inspection.sourceDigest, candidateDigest: inspection.candidateDigest,
        progress, mayReduce: inspection.phase === 'bound' || inspection.phase === 'failed'};
    }
  };
}

/** Existing fixed-candidate/custody execution core over an actual owner-bound private reduction port. */
export async function executeStatefulOwnerBlockV2(d: StatefulOwnerDeclarationV2, adapter: StatefulOwnerAdapterV2,
  lease: StatefulOwnerLeaseV2, targetDigest: string, input: unknown, custody: StatefulCandidateStoreV2,
  hook: (port: StatefulReductionV2) => Promise<void>, guard: StatefulGuard) {
  owned(d, true); hash(targetDigest); const selected = detach(input, d.projection.limits);
  await guarded(guard, () => validateCapabilities(d.projection, adapter.capabilities, STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2));
  let read: StatefulReductionReadV2 | undefined, sourceDigest: string | undefined;
  const reduction = async () => {
    check(sourceDigest !== undefined, 'Original source was not bound');
    if (read === undefined) {guard(); read = await adapter.reductionRead(lease, targetDigest, sourceDigest!); guard();}
    return read;
  };
  const port: ExecutionPort<CapturedStatefulSourceV2, StatefulCandidateV2> = {
    async currentView() {return adapter.reductionView(await reduction());},
    async read(view, keys) {return adapter.readReduction(await reduction(), view, keys);},
    async inspect(source) {
      await guarded(guard, () => adapter.bindSource(lease, targetDigest, source)); sourceDigest = source.digest;
      return guarded(guard, () => adapter.inspectOwned(lease, targetDigest, source));
    },
    apply: candidate => adapter.applyOwned(lease, targetDigest, candidate)
  };
  try {return await executionApply(executionPolicy(d, targetDigest), selected, port, custody, hook, guard);}
  finally {if (read !== undefined) adapter.closeRead(read);}
}

/** API-local composition adds actual live-owner/request authority; native labels never issue it. */
export async function composeStatefulOwnerReadV2(d: StatefulOwnerDeclarationV2, adapter: StatefulOwnerAdapterV2,
  expectedOwner: StatefulOwnerIdentityV2, expectedView: StatefulView,
  compose: (reader: import('./stateful-types.js').StatefulQueryRead) => Promise<unknown>, guard: StatefulGuard):
  Promise<{readonly view: StatefulView; readonly value: StructuredRecord}> {
  owned(d, true); const owner = detach<StatefulOwnerIdentityV2>(expectedOwner, d.projection.limits), view = captureStatefulOwnerViewV2(d, expectedView);
  fields(owner, ['id', 'generation']); text(owner.id, d.projection.limits); text(owner.generation, d.projection.limits);
  await guarded(guard, () => validateCapabilities(d.projection, adapter.capabilities, STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2));
  let read: Awaited<ReturnType<StatefulOwnerAdapterV2['completedRead']>> | undefined;
  try {
    guard(); read = await adapter.completedRead(owner, view, guard); guard(); const selected = read;
    return await executionCompose(executionPolicy(d, '0'.repeat(64)), {
      currentView: () => adapter.completedView(selected), read: (expected, keys) => adapter.readCompleted(selected, expected, keys)
    }, view, compose, guard);
  } finally {if (read !== undefined) adapter.closeRead(read);}
}

export const STATEFUL_COMPLETE_KIND_FAMILY_V1 = 'stateful-owner-complete-kind' as const;
const completeKindSelections = new WeakMap<object, StatefulOwnerDeclarationV2>();
function completeKindLimits(d: StatefulOwnerDeclarationV2, input: unknown): StatefulCompleteKindLimitsV1 {
  const value = detach<StatefulCompleteKindLimitsV1>(input, d.projection.limits);
  fields(value, ['readAttempts', 'responseRecords', 'responseBytes']);
  check(Number.isSafeInteger(value.readAttempts) && value.readAttempts > 0
    && Number.isSafeInteger(value.responseRecords) && value.responseRecords >= 0
    && Number.isSafeInteger(value.responseBytes) && value.responseBytes >= 2, 'Explicit complete-kind totals required');
  return value;
}
function completeKindOffer(d: StatefulOwnerDeclarationV2, input: unknown): StatefulCompleteKindCapabilitiesV1 {
  const value = detach<StatefulCompleteKindCapabilitiesV1>(input, d.projection.limits);
  fields(value, ['family', 'interfaceVersion', 'limits']);
  check(value.family === STATEFUL_COMPLETE_KIND_FAMILY_V1 && value.interfaceVersion === 1,
    'Complete-kind capability unavailable', 'stateful.capability-unavailable');
  completeKindLimits(d, value.limits); return value;
}
function completeKindBounds(selected: StatefulCompleteKindLimitsV1, offered: StatefulCompleteKindLimitsV1): void {
  for (const name of ['readAttempts', 'responseRecords', 'responseBytes'] as const)
    check(selected[name] <= offered[name], 'Complete-kind total unavailable', 'stateful.capability-unavailable');
}

/** A separate opt-in selection; no fields or digests of either existing closed family are widened. */
export function negotiateStatefulCompleteKindV1(d: StatefulOwnerDeclarationV2, requested: StatefulCompleteKindLimitsV1,
  host: unknown, adapter: unknown): StatefulCompleteKindSelectionV1 {
  owned(d, true);
  const limits = completeKindLimits(d, requested), hostOffer = completeKindOffer(d, host), adapterOffer = completeKindOffer(d, adapter);
  completeKindBounds(limits, d.projection.limits); completeKindBounds(limits, hostOffer.limits); completeKindBounds(limits, adapterOffer.limits);
  const selection = Object.freeze({family: STATEFUL_COMPLETE_KIND_FAMILY_V1, interfaceVersion: 1 as const,
    declarationDigest: d.digest, limits}) as StatefulCompleteKindSelectionV1;
  completeKindSelections.set(selection, d); return selection;
}

/**
 * Complete one declared kind through the existing API-local completed read, or refuse.
 * Native exhaustion/attempt truthfulness remain adapter obligations; final publication remains host-owned.
 */
export async function composeStatefulOwnerCompleteKindReadV1(selection: StatefulCompleteKindSelectionV1,
  adapter: StatefulCompleteKindAdapterV1, expectedOwner: StatefulOwnerIdentityV2, expectedView: StatefulView,
  compose: (reader: StatefulCompleteKindReadV1) => Promise<unknown>, guard: StatefulGuard):
  Promise<{readonly view: StatefulView; readonly value: StructuredRecord}> {
  check(typeof selection === 'object' && selection !== null && completeKindSelections.has(selection),
    'Explicit local complete-kind negotiation is required', 'stateful.capability-unavailable');
  const d = completeKindSelections.get(selection)!; owned(d, true);
  const limits = selection.limits, owner = detach<StatefulOwnerIdentityV2>(expectedOwner, d.projection.limits),
    view = captureStatefulOwnerViewV2(d, expectedView);
  fields(owner, ['id', 'generation']); text(owner.id, d.projection.limits); text(owner.generation, d.projection.limits);
  guard();
  check(typeof adapter.readCompletedKind === 'function', 'Complete-kind operation unavailable', 'stateful.capability-unavailable');
  completeKindBounds(limits, completeKindOffer(d, adapter.completeKindCapabilities).limits);
  await guarded(guard, () => validateCapabilities(d.projection, adapter.capabilities, STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2));
  let read: Awaited<ReturnType<StatefulOwnerAdapterV2['completedRead']>> | undefined;
  let active = true, busy = false, failed = false, failure: unknown, attempts = 0, records = 0, bytes = 0;
  const admit = () => {
    guard(); check(active, 'Complete-kind query port is closed');
    if (failed) throw failure;
  };
  const fail = (error: unknown) => {if (!failed) {failed = true; failure = error;} return failure;};
  const remaining = (): StatefulCompleteKindLimitsV1 => Object.freeze({readAttempts: limits.readAttempts - attempts,
    responseRecords: limits.responseRecords - records, responseBytes: limits.responseBytes - bytes});
  const begin = () => {
    admit(); check(!busy, 'Concurrent complete-kind reads are unavailable', 'stateful.unavailable');
    const available = remaining();
    check(available.readAttempts > 0 && available.responseBytes >= 2, 'Complete-kind read total exceeded', 'stateful.unavailable');
    attempts++; busy = true; return available;
  };
  const snapshot = (input: unknown) => {
    const value = canonical(input, d.projection.limits, remaining().responseBytes);
    bytes += value.bytes; return value.value;
  };
  const assertCurrent = async () => {
    admit(); assertStatefulOwnerViewV2(d, await guarded(admit, () => adapter.completedView(read!)), view); admit();
  };
  const operation = async <T>(work: (available: StatefulCompleteKindLimitsV1) => Promise<T>): Promise<T> => {
    let started = false;
    try {const available = begin(); started = true; return await work(available);}
    catch (error) {throw fail(error);}
    finally {if (started) busy = false;}
  };
  try {
    guard(); read = await adapter.completedRead(owner, view, guard); guard(); await assertCurrent();
    const reader: StatefulCompleteKindReadV1 = Object.freeze({view,
      get: (kind: string, key: string) => operation(async () => {
        check(d.projection.limits.readKeys >= 1, 'Key/read response bound');
        check(records < limits.responseRecords, 'Complete-kind record total exceeded', 'stateful.unavailable'); records++;
        const target = logicalKey(d, {kind, key}); await assertCurrent();
        const raw = await guarded(admit, () => adapter.readCompleted(read!, view, [target])); admit();
        const answer = snapshot(raw) as unknown as {readonly view: StatefulView; readonly results: readonly StatefulRead[]};
        fields(answer, ['view', 'results']);
        check(Array.isArray(answer.results) && answer.results.length === 1, 'Incomplete keyed response');
        assertStatefulOwnerViewV2(d, answer.view, view);
        const result = readValue(d, target, answer.results[0]);
        check(result.status !== 'unavailable', 'Required query coverage unavailable', 'stateful.unavailable');
        await assertCurrent(); return result;
      }),
      all: (kind: string) => operation(async available => {
        check(d.projection.definition.records.some(record => record.kind === kind), 'Undeclared logical kind');
        await assertCurrent();
        const raw = await guarded(admit, () => adapter.readCompletedKind(read!, view, kind, available)); admit();
        const answer = snapshot(raw) as unknown as StatefulCompleteKindResultV1;
        fields(answer, ['view', 'kind', 'complete', 'rows', 'attempts']);
        check(answer.kind === kind && answer.complete === true, 'Complete declared-kind coverage unavailable', 'stateful.unavailable');
        check(Number.isSafeInteger(answer.attempts) && answer.attempts >= 1 && answer.attempts <= available.readAttempts,
          'Complete-kind native attempt total exceeded', 'stateful.unavailable');
        attempts += answer.attempts - 1; assertStatefulOwnerViewV2(d, answer.view, view);
        check(Array.isArray(answer.rows) && answer.rows.length <= available.responseRecords,
          'Complete-kind record total exceeded', 'stateful.unavailable');
        const keys = new Set<string>();
        const rows = answer.rows.map(row => {
          fields(row, ['key', 'value']); const key = logicalKey(d, {kind, key: row.key});
          check(!keys.has(key.key), 'Duplicate complete-kind key'); keys.add(key.key);
          return Object.freeze({key: key.key, value: canonicalStatefulRecord(d.projection, kind, row.value).value});
        });
        records += rows.length; await assertCurrent(); return Object.freeze(rows);
      })});
    let result: unknown;
    try {
      result = await guarded(admit, () => compose(reader));
      check(!busy, 'Unawaited complete-kind read prevents completion', 'stateful.unavailable');
      // Retire the plugin port before the final native await; escaped callbacks cannot start more work here.
      active = false;
      assertStatefulOwnerViewV2(d, await guarded(guard, () => adapter.completedView(read!)), view);
      if (failed) throw failure;
      const value = snapshot(result); guard(); if (failed) throw failure;
      return Object.freeze({view, value});
    } finally {active = false;}
  } finally {active = false; if (read !== undefined) adapter.closeRead(read);}
}
