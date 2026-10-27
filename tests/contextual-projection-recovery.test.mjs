import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '@eosrio/hyperion-sdk/projection';
import * as root from '@eosrio/hyperion-sdk';

const definition = () => ({schemaVersion: 2, id: 'contextual-items', mappingRevision: 'a'.repeat(64),
  source: {contract: 'items.test', table: 'items', abiDeployment: 'deployment-1', abiSha256: 'b'.repeat(64)},
  fields: [{name: 'owner', type: 'string', source: {kind: 'row', path: ['owner']}},
    {name: 'created', type: 'string', source: {kind: 'context', field: 'blockNum', format: 'decimal'}},
    {name: 'nullable', type: 'null', source: {kind: 'row', path: ['nullable']}}],
  initialization: {kind: 'genesis'}, preserveOnReplace: ['created', 'nullable'], onAbsent: 'incomplete'});
const binding = () => ({chainId: 'c'.repeat(64), backendId: 'context-recovery', projectionId: 'contextual-items',
  mappingRevision: 'a'.repeat(64), abiDeployment: 'deployment-1', abiSha256: 'b'.repeat(64), generation: 'instance-1'});
const point = number => ({blockNum: number, blockId: number.toString(16).padStart(64, '0')});
const revision = 'd'.repeat(64), nextRevision = 'e'.repeat(64);
const host = () => ({family: 'contextual-table-recovery', interfaceVersion: 1,
  supported: [...sdk.CONTEXTUAL_PROJECTION_HOST_CAPABILITIES, 'runtime-coordinated-recovery']});
const adapter = () => ({family: 'contextual-table-recovery', interfaceVersion: 1,
  supported: [...sdk.CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES, 'revision-fenced', 'fork-rollback', 'retained-checkpoints']});
const recovery = () => ({binding: binding(), checkpoint: point(2), revision, initialized: true, pending: null, gap: null,
  coverage: {floor: point(0), retainedBlocks: 2, retainedBytes: 1024, maxBlocks: 16, maxBytes: 1048576}, rollback: null});
const batch = () => ({binding: binding(), previous: point(2), block: {...point(3), previousBlockId: point(2).blockId},
  source: {contract: 'items.test', table: 'items', blockTimeMs: 1793067000500},
  policy: {preserveOnReplace: ['created', 'nullable'], onAbsent: 'incomplete'},
  mutations: [{kind: 'put-preserving', key: 'one', value: {owner: 'alice', created: '3', nullable: null},
    preserveFields: ['created', 'nullable']}]});
const valid = result => {assert.equal(result.valid, true, JSON.stringify(result)); return result.value;};
const invalid = (result, code) => {
  assert.equal(result.valid, false, JSON.stringify(result));
  if (code) assert.equal(result.errors[0].code, code);
  return result.errors;
};

test('contextual recovery requires both explicit capability families before activation', () => {
  assert.equal(typeof sdk.validateContextualProjectionRecoveryActivation, 'function');
  assert.equal(root.validateContextualProjectionRecoveryActivation, sdk.validateContextualProjectionRecoveryActivation);
  const selected = valid(sdk.validateContextualProjectionRecoveryActivation(definition(), binding(), host(), adapter()));
  assert.ok(Object.isFrozen(selected.definition.fields));
  for (const side of ['host', 'adapter']) for (const required of (side === 'host' ? host() : adapter()).supported) {
    const h = host(), a = adapter(), caps = side === 'host' ? h : a;
    caps.supported = caps.supported.filter(item => item !== required);
    invalid(sdk.validateContextualProjectionRecoveryActivation(definition(), binding(), h, a), 'projection.capability-unavailable');
  }
  for (const mutate of [caps => {caps.family = 'contextual-table';}, caps => {caps.interfaceVersion = 2;},
    caps => {caps.supported.push('native-undo');}, caps => {caps.supported[1] = caps.supported[0];},
    caps => {caps.driver = {}; }]) {
    const caps = adapter(); mutate(caps);
    invalid(sdk.validateContextualProjectionRecoveryActivation(definition(), binding(), host(), caps));
  }
  const wrong = binding(); wrong.mappingRevision = 'f'.repeat(64);
  invalid(sdk.validateContextualProjectionRecoveryActivation(definition(), wrong, host(), adapter()));
  invalid(sdk.validateContextualProjectionActivation(definition(), binding(), host(), adapter()));
  invalid(sdk.validateProjectionRollbackActivation(definition(), binding(), {interfaceVersion: 2,
    supported: sdk.PROJECTION_ROLLBACK_CAPABILITIES}));
});

test('fenced contextual apply retains the original complete ordered candidate and refuses stale owners', () => {
  assert.equal(typeof sdk.validateContextualProjectionRecoveryApplyInput, 'function');
  const input = {revision, batch: batch()};
  input.batch.mutations.push({...structuredClone(input.batch.mutations[0]), value: {owner: 'bob', created: '3', nullable: null}});
  const captured = valid(sdk.validateContextualProjectionRecoveryApplyInput(input));
  input.revision = nextRevision; input.batch.source.blockTimeMs = 0;
  input.batch.mutations[0].value.created = 'changed'; input.batch.policy.preserveOnReplace.reverse();
  const output = valid(sdk.validateContextualProjectionRecoveryApply(definition(), captured, recovery()));
  assert.equal(output.revision, revision);
  assert.equal(output.batch.source.blockTimeMs, 1793067000500);
  assert.deepEqual(output.batch.mutations.map(item => item.value.owner), ['alice', 'bob']);
  assert.equal(output.batch.mutations[0].value.nullable, null);
  assert.equal(output.batch.mutations[0].value.created, '3');
  assert.deepEqual(output.batch.policy.preserveOnReplace, ['created', 'nullable']);
  assert.ok(Object.isFrozen(output.batch.mutations[0].preserveFields));
  const identity = sdk.canonicalContextualProjectionBatch(output.batch);
  assert.notEqual(identity, sdk.canonicalContextualProjectionBatch({...output.batch,
    mutations: [...output.batch.mutations].reverse()}));
  assert.notEqual(identity, sdk.canonicalContextualProjectionBatch({...output.batch,
    source: {...output.batch.source, blockTimeMs: 1793067001000}}));
  invalid(sdk.validateContextualProjectionRecoveryApply(definition(), captured,
    {...recovery(), revision: nextRevision}), 'projection.stale-revision');
  invalid(sdk.validateContextualProjectionRecoveryApply(definition(), captured));
  for (const mutate of [value => {delete value.revision;}, value => {value.batch.source.blockTimeMs = 0.5;},
    value => {delete value.batch.source;}, value => {value.batch.source.contract = 'wrong';},
    value => {value.batch.policy.onAbsent = 'delete';}, value => {value.batch.mutations[0].kind = 'put';},
    value => {delete value.batch.mutations[0].value.nullable;}, value => {value.batch.binding.generation = 'foreign';}]) {
    const value = {revision, batch: batch()}; mutate(value);
    invalid(sdk.validateContextualProjectionRecoveryApply(definition(), value, recovery()));
  }
  invalid(sdk.validateProjectionRollbackApply(definition(), captured));
  invalid(sdk.validateContextualProjectionApply(definition(), captured));
  const running = recovery(); running.rollback = {operationId: 'fork', sourceRevision: nextRevision,
    from: point(3), ancestor: point(0), status: 'running', reason: null};
  invalid(sdk.validateContextualProjectionRecoveryApply(definition(), captured, running), 'projection.incomplete');
  const pending = recovery(); pending.pending = {block: batch().block, digest: null, reason: 'unknown result'};
  valid(sdk.validateContextualProjectionRecoveryApply(definition(), captured, pending));
  valid(sdk.validateContextualProjectionRecoveryApply(definition(), {revision, batch: {...batch(), mutations: []}}, recovery()));
});

test('missing original time can be marked incomplete without inventing an apply or bypassing the fence', () => {
  assert.equal(typeof sdk.validateContextualProjectionRecoveryIncomplete, 'function');
  const request = {binding: binding(), revision, block: batch().block, reason: 'Original source time unavailable'};
  const output = valid(sdk.validateContextualProjectionRecoveryIncomplete(request, recovery()));
  request.reason = 'changed'; request.binding.generation = 'changed';
  assert.equal(output.reason, 'Original source time unavailable');
  assert.equal(output.binding.generation, 'instance-1');
  assert.equal(Object.hasOwn(output, 'source'), false);
  invalid(sdk.validateContextualProjectionRecoveryIncomplete(output, {...recovery(), revision: nextRevision}), 'projection.stale-revision');
  invalid(sdk.validateContextualProjectionRecoveryIncomplete({...output, source: {blockTimeMs: 0}}, recovery()));
  invalid(sdk.validateContextualProjectionRecoveryIncomplete({...output, revision: undefined}, recovery()));
  invalid(sdk.validateContextualProjectionRecoveryIncomplete({...output, reason: ''}, recovery()));
  invalid(sdk.validateContextualProjectionRecoveryIncomplete({...output, reason: 'é'.repeat(2049)}, recovery()));
  const uninitialized = recovery(); uninitialized.initialized = false; uninitialized.checkpoint = point(0);
  uninitialized.coverage = {...uninitialized.coverage, floor: point(0), retainedBlocks: 0, retainedBytes: 0};
  invalid(sdk.validateContextualProjectionRecoveryIncomplete(output, uninitialized), 'projection.not-initialized');
});

test('resumable rollback keeps original recovery identity across rotation and a replacement branch', () => {
  assert.equal(typeof sdk.validateContextualProjectionRecoveryRollback, 'function');
  const request = {binding: binding(), revision, operationId: 'fork-one', from: point(2), ancestor: point(0), maxBlocks: 1};
  valid(sdk.validateContextualProjectionRecoveryRollback(request, recovery()));
  const running = recovery(); running.revision = nextRevision;
  running.rollback = {operationId: 'fork-one', sourceRevision: revision, from: point(2), ancestor: point(0), status: 'running', reason: null};
  valid(sdk.validateContextualProjectionRecoveryRollback({...request, maxBlocks: 2}, running));
  invalid(sdk.validateContextualProjectionRecoveryRollback({...request, operationId: 'other'}, running), 'projection.stale-revision');
  for (const mutate of [value => {value.revision = nextRevision;}, value => {value.ancestor = point(1);},
    value => {value.from = point(1);}]) {
    const value = structuredClone(request); mutate(value);
    invalid(sdk.validateContextualProjectionRecoveryRollback(value, running), 'projection.conflicting-replay');
  }
  const completed = structuredClone(running); completed.rollback.status = 'complete';
  completed.checkpoint = {blockNum: 3, blockId: 'f'.repeat(64)}; completed.coverage.retainedBlocks = 3;
  valid(sdk.validateContextualProjectionRecoveryRollback(request, completed));
  const superseded = recovery(); superseded.revision = 'f'.repeat(64);
  superseded.rollback = {operationId: 'fork-two', sourceRevision: nextRevision,
    from: point(2), ancestor: point(0), status: 'complete', reason: null};
  invalid(sdk.validateContextualProjectionRecoveryRollback(request, superseded), 'projection.stale-revision');
  invalid(sdk.validateContextualProjectionRecoveryRollback({...request, from: point(3)}, recovery()), 'projection.stale-view');
  for (const mutate of [value => {delete value.revision;}, value => {value.maxBlocks = 257;},
    value => {value.operationId = 'é'.repeat(65);}, value => {value.ancestor = point(3);},
    value => {value.undo = []; }]) {
    const value = structuredClone(request); mutate(value);
    invalid(sdk.validateContextualProjectionRecoveryRollback(value, recovery()));
  }
  const unavailable = structuredClone(running); unavailable.rollback.status = 'unavailable'; unavailable.rollback.reason = 'Missing undo';
  invalid(sdk.validateContextualProjectionRecoveryRollback(request, unavailable), 'projection.rollback-unavailable');
  // Availability is decided from actual retained ancestry by the adapter, which must durably mark
  // an unavailable recovery. A pure SDK request check cannot invent or deny that evidence.
  const trimmed = recovery(); trimmed.coverage = {...trimmed.coverage, floor: point(1), retainedBlocks: 1};
  valid(sdk.validateContextualProjectionRecoveryRollback(request, trimmed));
  const wrongBranch = {...request, ancestor: {blockNum: 1, blockId: 'f'.repeat(64)}};
  valid(sdk.validateContextualProjectionRecoveryRollback(wrongBranch, trimmed));
});

test('queries require current exact views and completed recovery without widening the query language', () => {
  assert.equal(typeof sdk.validateContextualProjectionRecoveryQuery, 'function');
  const view = {binding: binding(), revision, checkpoint: point(2)};
  const query = {filter: [{field: 'nullable', op: 'eq', value: null}], limit: 1, count: {upTo: 10}};
  const output = valid(sdk.validateContextualProjectionRecoveryQuery(definition(), view, query, recovery()));
  query.filter[0].value = 'changed'; view.binding.generation = 'changed';
  assert.equal(output.query.filter[0].value, null);
  assert.equal(output.view.binding.generation, 'instance-1');
  assert.ok(Object.isFrozen(output.view.checkpoint) && Object.isFrozen(output.query.filter));
  invalid(sdk.validateContextualProjectionRecoveryQuery(definition(), {...output.view, revision: nextRevision}, output.query, recovery()), 'projection.stale-revision');
  invalid(sdk.validateContextualProjectionRecoveryQuery(definition(), {...output.view, checkpoint: point(1)}, output.query, recovery()), 'projection.stale-view');
  for (const phase of ['pending', 'gap', 'running', 'unavailable']) {
    const current = recovery();
    if (phase === 'pending' || phase === 'gap') current[phase] = {block: batch().block, digest: null, reason: 'missing source'};
    else current.rollback = {operationId: 'fork', sourceRevision: nextRevision, from: point(2), ancestor: point(0),
      status: phase, reason: phase === 'unavailable' ? 'missing undo' : null};
    invalid(sdk.validateContextualProjectionRecoveryQuery(definition(), output.view, output.query, current), 'projection.incomplete');
  }
  const complete = recovery(); complete.rollback = {operationId: 'fork', sourceRevision: nextRevision,
    from: point(3), ancestor: point(1), status: 'complete', reason: null};
  valid(sdk.validateContextualProjectionRecoveryQuery(definition(), output.view, output.query, complete));
  for (const query of [{filter: [], limit: 1001}, {filter: [{field: 'owner', op: 'regex', value: 'a'}], limit: 1},
    {filter: [{field: 'native.path', op: 'eq', value: 1}], limit: 1}, {filter: [], limit: 1, $where: 'native'}]) {
    invalid(sdk.validateContextualProjectionRecoveryQuery(definition(), output.view, query, recovery()));
  }
  invalid(sdk.validateContextualProjectionRecoveryQuery(definition(), {...output.view, revision: undefined}, output.query, recovery()));
});

test('retained inspection remains revision-fenced and truthful during incomplete and running recovery', () => {
  assert.equal(typeof sdk.validateContextualProjectionRecoveryRetainedRequest, 'function');
  const input = {binding: binding(), revision};
  const captured = valid(sdk.validateContextualProjectionRecoveryRetainedRequest(input, recovery()));
  input.binding.generation = 'changed'; input.revision = nextRevision;
  assert.equal(captured.revision, revision);
  assert.equal(captured.binding.generation, 'instance-1');
  invalid(sdk.validateContextualProjectionRecoveryRetainedRequest(captured,
    {...recovery(), revision: nextRevision}), 'projection.stale-revision');
  const running = recovery(); running.rollback = {operationId: 'fork', sourceRevision: nextRevision,
    from: point(3), ancestor: point(0), status: 'running', reason: null};
  valid(sdk.validateContextualProjectionRecoveryRetainedRequest(captured, running));
  const result = {recovery: running, checkpoints: [point(2), point(1), point(0)]};
  const output = valid(sdk.validateProjectionRetainedCheckpoints(result));
  assert.equal(output.recovery.rollback.status, 'running', 'Inspection is not a serving grant');
  for (const mutate of [value => {value.checkpoints.reverse();}, value => {value.checkpoints.pop();},
    value => {value.checkpoints[1].blockId = value.checkpoints[0].blockId;},
    value => {value.recovery.coverage.retainedBytes = 0;}, value => {value.recovery.rollback.sourceRevision = revision;},
    value => {value.recovery.rollback.ancestor = point(3);}, value => {value.recovery.phase = 'ready';}]) {
    const value = structuredClone(result); mutate(value); invalid(sdk.validateProjectionRetainedCheckpoints(value));
  }
  invalid(sdk.validateContextualProjectionRecoveryRetainedRequest({...captured, session: {}}, recovery()));
});

test('all recovery captures reject accessors and oversized/native data without evaluating user code', () => {
  let executions = 0;
  const request = {revision, batch: batch()};
  Object.defineProperty(request.batch.source, 'blockTimeMs', {enumerable: true, get() {executions++; return 0;}});
  invalid(sdk.validateContextualProjectionRecoveryApplyInput(request));
  const current = recovery();
  Object.defineProperty(current, 'revision', {enumerable: true, get() {executions++; return revision;}});
  invalid(sdk.validateContextualProjectionRecoveryApply(definition(), {revision, batch: batch()}, current));
  invalid(sdk.validateContextualProjectionRecoveryRetainedRequest({binding: binding(), revision}, current));
  const caps = adapter();
  Object.defineProperty(caps, 'supported', {enumerable: true, get() {executions++; return [];}});
  invalid(sdk.validateContextualProjectionRecoveryActivation(definition(), binding(), host(), caps));
  assert.equal(executions, 0);
  for (const mutate of [value => {value.batch.mutations[0].key = 'é'.repeat(513);},
    value => {value.batch.mutations[0].value.owner = 'x'.repeat(65537);},
    value => {value.batch.mutations = Array.from({length: 1001}, () => batch().mutations[0]);},
    value => {value.batch.mutations[0].preserveFields = ['native.path'];},
    value => {value.batch.mutations[0].$set = {};}, value => {value.batch.source.blockTimeMs = Number.MAX_SAFE_INTEGER + 1;},
    value => {value.batch = new Date();}, value => {value.batch.extra = 'x'.repeat(sdk.PROJECTION_LIMITS.batchBytes + 1);}]) {
    const value = {revision, batch: batch()}; mutate(value);
    invalid(sdk.validateContextualProjectionRecoveryApplyInput(value));
  }
});

test('contextual recovery keeps the old basic and rollback validators closed', () => {
  const basicHost = {family: 'contextual-table', interfaceVersion: 1, supported: sdk.CONTEXTUAL_PROJECTION_HOST_CAPABILITIES};
  const basicAdapter = {family: 'contextual-table', interfaceVersion: 1, supported: sdk.CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES};
  valid(sdk.validateContextualProjectionActivation(definition(), binding(), basicHost, basicAdapter));
  valid(sdk.validateContextualProjectionApply(definition(), batch()));
  invalid(sdk.validateContextualProjectionRecoveryActivation(definition(), binding(), basicHost, basicAdapter));
  invalid(sdk.validateProjectionRollbackApplyInput({revision, batch: batch()}));
  invalid(sdk.validateProjectionApply({schemaVersion: 1}, batch()));
  invalid(sdk.validateProjectionView({binding: binding(), checkpoint: point(2), revision}));
  invalid(sdk.validateProjectionRollbackRecovery({...recovery(), context: batch().source}));
  invalid(sdk.validateContextualProjectionRecoveryApply(definition(), {revision, batch: batch()},
    {...recovery(), phase: 'ready'}));
});
