import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECTION_CAPABILITIES, PROJECTION_ROLLBACK_CAPABILITIES, PROJECTION_ROLLBACK_LIMITS,
  ProjectionContractError, validateProjectionActivation, validateProjectionApply, validateProjectionView,
  validateProjectionRollbackActivation, validateProjectionRollbackApply, validateProjectionRollbackApplyInput, validateProjectionRollbackView,
  validateProjectionRollbackIncomplete, validateProjectionRollbackRequest, validateProjectionRollbackRecovery,
} from '@eosrio/hyperion-sdk/projection';
import {validateProjectionRollbackRequest as rootValidator} from '@eosrio/hyperion-sdk';
import {exampleTableDefinition, createTableProjectionExample} from '@eosrio/hyperion-sdk/examples/table-projection';

const binding = () => ({chainId: 'c'.repeat(64), backendId: 'recovery-backend', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision, abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'immutable-instance'});
const point = number => ({blockNum: number, blockId: String(number).repeat(64)});
const revision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const capabilities = () => ({interfaceVersion: 2, supported: [...PROJECTION_ROLLBACK_CAPABILITIES]});
const batch = () => structuredClone(createTableProjectionExample(binding()).requests[0]);
const request = () => ({binding: binding(), revision, operationId: 'fork-operation-1', from: point(3), ancestor: point(1), maxBlocks: 1});
const recovery = () => ({binding: binding(), revision, checkpoint: point(3), initialized: true, pending: null, gap: null,
  coverage: {floor: point(0), retainedBlocks: 3, retainedBytes: 1024, maxBlocks: 16, maxBytes: 1048576}, rollback: null});
const valid = result => {
  assert.equal(result.valid, true, JSON.stringify(result));
  return result.value;
};
const invalid = result => {
  assert.equal(result.valid, false, JSON.stringify(result));
  assert.ok(result.errors.length && result.errors.every(error => error.code && typeof error.path === 'string' && error.message));
  return result.errors;
};

test('opt-in rollback exports preserve every exact v1 contract and require their own activation', () => {
  assert.equal(rootValidator, validateProjectionRollbackRequest);
  assert.deepEqual(PROJECTION_ROLLBACK_CAPABILITIES, [...PROJECTION_CAPABILITIES, 'fork-rollback']);
  valid(validateProjectionActivation(exampleTableDefinition, binding(), {interfaceVersion: 1, supported: PROJECTION_CAPABILITIES}));
  valid(validateProjectionApply(exampleTableDefinition, batch()));
  valid(validateProjectionView({binding: binding(), checkpoint: point(0)}));
  valid(validateProjectionRollbackActivation(exampleTableDefinition, binding(), capabilities()));
  invalid(validateProjectionActivation(exampleTableDefinition, binding(), capabilities()));
  invalid(validateProjectionRollbackActivation(exampleTableDefinition, binding(), {interfaceVersion: 1, supported: PROJECTION_CAPABILITIES}));
  for (const required of PROJECTION_ROLLBACK_CAPABILITIES) {
    const caps = capabilities();
    caps.supported = caps.supported.filter(value => value !== required);
    assert.ok(invalid(validateProjectionRollbackActivation(exampleTableDefinition, binding(), caps))
      .some(error => error.code === 'projection.capability-unavailable' && error.message.includes(required)));
  }
  for (const caps of [{...capabilities(), supported: [...PROJECTION_ROLLBACK_CAPABILITIES, 'unknown']},
    {...capabilities(), supported: [PROJECTION_ROLLBACK_CAPABILITIES[0], PROJECTION_ROLLBACK_CAPABILITIES[0]]},
    {...capabilities(), nativeRollback: true}]) invalid(validateProjectionRollbackActivation(exampleTableDefinition, binding(), caps));
});

test('fenced apply and read inputs cannot be substituted for unfenced v1 objects', () => {
  const input = {revision, batch: batch()};
  const captured = valid(validateProjectionRollbackApply(exampleTableDefinition, input));
  input.batch.mutations[0].value.owner = 'changed';
  input.revision = nextRevision;
  assert.equal(captured.revision, revision);
  assert.equal(captured.batch.mutations[0].value.owner, 'alice');
  assert.ok(Object.isFrozen(captured.batch.mutations[0].value));
  invalid(validateProjectionApply(exampleTableDefinition, captured));
  invalid(validateProjectionRollbackApply(exampleTableDefinition, batch()));
  invalid(validateProjectionRollbackApply(exampleTableDefinition, {revision, batch: {...batch(), previous: point(2)}}));
  const view = {binding: binding(), checkpoint: point(1), revision};
  valid(validateProjectionRollbackView(view));
  invalid(validateProjectionView(view));
  const oldView = {binding: binding(), checkpoint: point(1)};
  invalid(validateProjectionRollbackView(oldView));
  invalid(validateProjectionRollbackView({...view, revision: 'unfenced'}));
  invalid(validateProjectionRollbackView({...view, checkpoint: {...point(0), blockId: 'f'.repeat(64)}}));
});

test('incomplete admission captures the writer fence and cannot accept native mutation syntax', () => {
  const input = {binding: binding(), revision, block: batch().block, reason: 'Source admitted before mapping'};
  const captured = valid(validateProjectionRollbackIncomplete(input));
  input.binding.generation = 'changed'; input.block.blockId = 'f'.repeat(64);
  assert.equal(captured.binding.generation, 'immutable-instance');
  assert.equal(captured.block.blockId, batch().block.blockId);
  for (const mutate of [value => {delete value.revision;}, value => {value.revision = 'A'.repeat(64);},
    value => {value.block.blockNum = 0;}, value => {value.reason = '';},
    value => {value.reason = 'é'.repeat(2049);}, value => {value.$set = {ready: false};}]) {
    const value = structuredClone(captured); mutate(value); invalid(validateProjectionRollbackIncomplete(value));
  }
});

test('pre-I/O apply capture preserves the fence and batch before durable definition validation', () => {
  const input = {revision, batch: batch()};
  const captured = valid(validateProjectionRollbackApplyInput(input));
  input.revision = nextRevision; input.batch.mutations.length = 0;
  assert.equal(captured.revision, revision);
  assert.equal(captured.batch.mutations.length, 2);
  valid(validateProjectionRollbackApply(exampleTableDefinition, captured));
  const unknown = {revision, batch: {...batch(), mutations: [{kind: 'put', key: 'unknown', value: {different: 'allowed syntax'}}]}};
  valid(validateProjectionRollbackApplyInput(unknown));
  invalid(validateProjectionRollbackApply(exampleTableDefinition, unknown));
  let executions = 0;
  const getter = {batch: batch()};
  Object.defineProperty(getter, 'revision', {enumerable: true, get() {executions++; return revision;}});
  invalid(validateProjectionRollbackApplyInput(getter));
  invalid(validateProjectionRollbackApplyInput({revision, batch: {...batch(), mutations: [{kind: 'increment', key: 'x'}]}}));
  assert.equal(executions, 0);
});

test('rollback requests bind exact branch identities and independently bound per-call work', () => {
  const input = request();
  const captured = valid(validateProjectionRollbackRequest(input));
  input.from.blockId = 'f'.repeat(64); input.ancestor.blockId = 'e'.repeat(64); input.binding.generation = 'changed';
  assert.equal(captured.from.blockId, '3'.repeat(64));
  assert.equal(captured.ancestor.blockId, '1'.repeat(64));
  assert.equal(captured.binding.generation, 'immutable-instance');
  valid(validateProjectionRollbackRequest({...request(), maxBlocks: PROJECTION_ROLLBACK_LIMITS.maxSteps}));
  valid(validateProjectionRollbackRequest({...request(), from: point(0), ancestor: point(0)}));
  valid(validateProjectionRollbackRequest({...request(), ancestor: point(3)}));
  // A syntactically valid claimed ancestor still needs retained-ancestry validation in the adapter.
  valid(validateProjectionRollbackRequest({...request(), ancestor: {...point(3), blockId: 'f'.repeat(64)}}));
  for (const mutate of [value => {value.ancestor = point(4);}, value => {value.maxBlocks = 0;},
    value => {value.maxBlocks = 257;}, value => {value.maxBlocks = 1.5;}, value => {value.operationId = '';},
    value => {value.operationId = 'é'.repeat(65);}, value => {value.revision = 'f'.repeat(63);},
    value => {value.from.blockNum = Number.MAX_SAFE_INTEGER + 1;}, value => {value.ancestor = {blockNum: 0, blockId: 'f'.repeat(64)};},
    value => {value.nativeUndo = []; }]) {
    const value = request(); mutate(value); invalid(validateProjectionRollbackRequest(value));
  }
});

test('recovery reports actual contiguous coverage and a truthful empty legacy-upgrade floor', () => {
  valid(validateProjectionRollbackRecovery(recovery()));
  const upgraded = recovery();
  upgraded.coverage.floor = point(3); upgraded.coverage.retainedBlocks = 0; upgraded.coverage.retainedBytes = 0;
  valid(validateProjectionRollbackRecovery(upgraded));
  const uninitialized = recovery();
  uninitialized.initialized = false; uninitialized.checkpoint = point(0);
  uninitialized.coverage.retainedBlocks = 0; uninitialized.coverage.retainedBytes = 0;
  valid(validateProjectionRollbackRecovery(uninitialized));
  for (const mutate of [value => {value.coverage.retainedBlocks = 2;},
    value => {value.coverage.floor = point(4);}, value => {value.coverage.retainedBytes = 0;},
    value => {value.coverage.maxBlocks = 2;}, value => {value.coverage.maxBlocks = 4097;},
    value => {value.coverage.maxBytes = 1073741825;}, value => {value.coverage.retainedBytes = 1048577;},
    value => {value.coverage.floor = {...point(0), blockId: 'f'.repeat(64)};}, value => {value.initialized = false;},
    value => {value.coverage.retainedBlocks = 0; value.coverage.floor = point(3);},
    value => {delete value.coverage;}, value => {value.revision = 'a'.repeat(63);}]) {
    const value = recovery(); mutate(value); invalid(validateProjectionRollbackRecovery(value));
  }
});

test('running and completed rollback receipts preserve original operation identity across replacement', () => {
  const input = recovery();
  input.revision = nextRevision;
  input.rollback = {operationId: 'fork-operation-1', sourceRevision: revision, from: point(3), ancestor: point(1), status: 'running', reason: null};
  input.checkpoint = point(2); input.coverage.retainedBlocks = 2;
  valid(validateProjectionRollbackRecovery(input));
  const completed = structuredClone(input);
  completed.rollback.status = 'complete';
  completed.checkpoint = {blockNum: 4, blockId: 'f'.repeat(64)};
  completed.coverage.retainedBlocks = 4;
  valid(validateProjectionRollbackRecovery(completed));
  const unavailable = structuredClone(input);
  unavailable.rollback.status = 'unavailable'; unavailable.rollback.reason = 'Ancestor outside retained recovery coverage';
  valid(validateProjectionRollbackRecovery(unavailable));
  for (const mutate of [value => {value.rollback.sourceRevision = nextRevision;},
    value => {value.rollback.from = point(1);}, value => {value.rollback.ancestor = point(3);},
    value => {value.rollback.status = 'ready';}, value => {value.rollback.reason = 'partial';},
    value => {value.rollback.status = 'unavailable'; value.rollback.reason = null;},
    value => {value.checkpoint = {...point(3), blockId: 'f'.repeat(64)}; value.coverage.retainedBlocks = 3;},
    value => {value.checkpoint = {...point(1), blockId: 'f'.repeat(64)}; value.coverage.retainedBlocks = 1;}]) {
    const value = structuredClone(input); mutate(value); invalid(validateProjectionRollbackRecovery(value));
  }
});

test('recovery source markers preserve exact next-block and observed future-gap identity', () => {
  const input = recovery();
  input.pending = {block: {...point(4), previousBlockId: input.checkpoint.blockId}, digest: 'd'.repeat(64), reason: 'pending'};
  input.gap = {block: {...point(5), previousBlockId: input.pending.block.blockId}, digest: null, reason: 'future'};
  valid(validateProjectionRollbackRecovery(input));
  const next = structuredClone(input); next.gap = structuredClone(next.pending);
  valid(validateProjectionRollbackRecovery(next));
  for (const mutate of [value => {value.pending.block.previousBlockId = 'f'.repeat(64);},
    value => {value.gap.block.blockNum = 3;}, value => {value.gap.block.previousBlockId = 'f'.repeat(64);},
    value => {value.gap = {...value.pending, digest: 'e'.repeat(64)};},
    value => {value.pending.digest = 'opaque';}, value => {value.pending.reason = 'x'.repeat(4097);}]) {
    const value = structuredClone(input); mutate(value); invalid(validateProjectionRollbackRecovery(value));
  }
});

test('new validation remains inert and detached across nested recovery input', () => {
  let executions = 0;
  const input = recovery();
  Object.defineProperty(input.coverage, 'floor', {enumerable: true, get() {executions++; return point(0);}});
  invalid(validateProjectionRollbackRecovery(input));
  const malicious = request(); malicious.toJSON = () => {executions++; return request();};
  invalid(validateProjectionRollbackRequest(malicious));
  assert.equal(executions, 0);
  const original = recovery();
  const captured = valid(validateProjectionRollbackRecovery(original));
  original.coverage.floor.blockId = 'f'.repeat(64);
  assert.equal(captured.coverage.floor.blockId, '0'.repeat(64));
  assert.ok(Object.isFrozen(captured.coverage.floor));
  assert.equal(new ProjectionContractError('projection.stale-revision', 'old owner').retryable, true);
  assert.equal(new ProjectionContractError('projection.rollback-unavailable', 'missing undo').retryable, true);
});
