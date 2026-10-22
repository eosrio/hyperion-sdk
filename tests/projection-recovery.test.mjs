import assert from 'node:assert/strict';
import test from 'node:test';
import * as projection from '@eosrio/hyperion-sdk/projection';
import * as root from '@eosrio/hyperion-sdk';
import {exampleTableDefinition} from '@eosrio/hyperion-sdk/examples/table-projection';

const binding = () => ({chainId: 'c'.repeat(64), backendId: 'recovery-backend', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision, abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'immutable-instance'});
const point = number => ({blockNum: number, blockId: number.toString(16).padStart(64, '0')});
const revision = 'a'.repeat(64);
const capabilities = () => ({interfaceVersion: 2, supported: [...projection.PROJECTION_ROLLBACK_CAPABILITIES]});
const recoveryCapabilities = () => ({interfaceVersion: 1, supported: ['retained-checkpoints']});
const retained = () => ({recovery: {binding: binding(), revision, checkpoint: point(3), initialized: true, pending: null, gap: null,
  coverage: {floor: point(0), retainedBlocks: 3, retainedBytes: 1024, maxBlocks: 16, maxBytes: 1048576}, rollback: null},
  checkpoints: [point(3), point(2), point(1), point(0)]});
const valid = result => {assert.equal(result.valid, true, JSON.stringify(result)); return result.value;};
const invalid = result => {assert.equal(result.valid, false, JSON.stringify(result)); assert.ok(result.errors.length); return result.errors;};

test('retained inspection is independently opted in without widening either existing capability manifest', () => {
  assert.equal(typeof projection.validateProjectionRecoveryActivation, 'function');
  assert.equal(root.validateProjectionRetainedCheckpoints, projection.validateProjectionRetainedCheckpoints);
  assert.deepEqual(projection.PROJECTION_RECOVERY_CAPABILITIES, ['retained-checkpoints']);
  const selected = valid(projection.validateProjectionRecoveryActivation(exampleTableDefinition, binding(), capabilities(), recoveryCapabilities()));
  assert.equal(selected.recoveryCapabilities.interfaceVersion, 1);
  valid(projection.validateProjectionRollbackActivation(exampleTableDefinition, binding(), capabilities()));
  invalid(projection.validateProjectionRollbackActivation(exampleTableDefinition, binding(),
    {...capabilities(), recoveryCapabilities: recoveryCapabilities()}));
  invalid(projection.validateProjectionRollbackActivation(exampleTableDefinition, binding(),
    {...capabilities(), supported: [...projection.PROJECTION_ROLLBACK_CAPABILITIES, 'retained-checkpoints']}));
  valid(projection.validateProjectionActivation(exampleTableDefinition, binding(),
    {interfaceVersion: 1, supported: projection.PROJECTION_CAPABILITIES}));
  for (const caps of [null, {interfaceVersion: 2, supported: ['retained-checkpoints']},
    {interfaceVersion: 1, supported: []}, {interfaceVersion: 1, supported: ['retained-checkpoints', 'retained-checkpoints']},
    {interfaceVersion: 1, supported: ['unknown']}, {...recoveryCapabilities(), undo: true}]) {
    invalid(projection.validateProjectionRecoveryActivation(exampleTableDefinition, binding(), capabilities(), caps));
  }
});

test('retained inspection captures the exact descending applied branch through the inclusive floor', () => {
  const input = retained();
  const output = valid(projection.validateProjectionRetainedCheckpoints(input));
  input.checkpoints[1].blockId = 'f'.repeat(64);
  input.recovery.coverage.floor.blockId = 'e'.repeat(64);
  assert.equal(output.checkpoints[1].blockId, point(2).blockId);
  assert.ok(Object.isFrozen(output) && Object.isFrozen(output.checkpoints) && Object.isFrozen(output.checkpoints[0])
    && Object.isFrozen(output.recovery.coverage.floor));
  assert.deepEqual(JSON.parse(JSON.stringify(output.checkpoints)), [point(3), point(2), point(1), point(0)]);
});

test('requests are revision-fenced inert data and reject native syntax before adapter execution', () => {
  const input = {binding: binding(), revision};
  const output = valid(projection.validateProjectionRetainedCheckpointRequest(input));
  input.revision = 'b'.repeat(64); input.binding.generation = 'changed';
  assert.equal(output.revision, revision);
  assert.equal(output.binding.generation, 'immutable-instance');
  assert.ok(Object.isFrozen(output.binding));
  for (const mutate of [value => {delete value.revision;}, value => {value.revision = 'A'.repeat(64);},
    value => {value.binding.chainId = 'bad';}, value => {value.session = {};}, value => {value.binding.$where = 'native';}]) {
    const value = {binding: binding(), revision}; mutate(value); invalid(projection.validateProjectionRetainedCheckpointRequest(value));
  }
  let executions = 0;
  const getter = {binding: binding()};
  Object.defineProperty(getter, 'revision', {enumerable: true, get() {executions++; return revision;}});
  invalid(projection.validateProjectionRetainedCheckpointRequest(getter));
  const resultGetter = retained();
  Object.defineProperty(resultGetter.checkpoints[1], 'blockId', {enumerable: true, get() {executions++; return point(2).blockId;}});
  invalid(projection.validateProjectionRetainedCheckpoints(resultGetter));
  assert.equal(executions, 0);
});

test('coverage is exact: missing, reordered, conflicting and native-detail points are rejected', () => {
  for (const mutate of [value => {value.checkpoints.pop();}, value => {value.checkpoints.splice(1, 1);},
    value => {value.checkpoints.reverse();}, value => {value.checkpoints[1].blockNum = 1;},
    value => {value.checkpoints[0].blockId = 'f'.repeat(64);}, value => {value.checkpoints[3].blockId = 'f'.repeat(64);},
    value => {value.checkpoints[1].blockId = value.checkpoints[2].blockId;},
    value => {value.checkpoints[2].undo = {before: 'hidden'};}, value => {value.undoImages = [];},
    value => {value.recovery.revision = 'invalid';}, value => {value.recovery.coverage.retainedBlocks = 2;},
    value => {value.checkpoints = [];}, value => {value.checkpoints[0].blockNum = Number.MAX_SAFE_INTEGER + 1;},
    value => {value.checkpoints[1] = new Date();}, value => {delete value.checkpoints[1];}]) {
    const value = retained(); mutate(value); invalid(projection.validateProjectionRetainedCheckpoints(value));
  }
  const nonzeroFloor = retained();
  nonzeroFloor.recovery.coverage = {...nonzeroFloor.recovery.coverage, floor: point(2), retainedBlocks: 1};
  nonzeroFloor.checkpoints = [point(3), point(2)];
  valid(projection.validateProjectionRetainedCheckpoints(nonzeroFloor));
  nonzeroFloor.checkpoints[1].blockId = 'f'.repeat(64);
  invalid(projection.validateProjectionRetainedCheckpoints(nonzeroFloor));
});

test('inspection preserves empty migrated coverage and truthful partial rollback or incomplete metadata', () => {
  const migrated = retained();
  migrated.recovery.coverage = {...migrated.recovery.coverage, floor: point(3), retainedBlocks: 0, retainedBytes: 0};
  migrated.checkpoints = [point(3)];
  valid(projection.validateProjectionRetainedCheckpoints(migrated));
  const initial = structuredClone(migrated);
  initial.recovery.checkpoint = point(0); initial.recovery.coverage.floor = point(0);
  initial.recovery.initialized = false; initial.checkpoints = [point(0)];
  valid(projection.validateProjectionRetainedCheckpoints(initial));
  const running = retained();
  running.recovery.revision = 'b'.repeat(64);
  running.recovery.rollback = {operationId: 'fork-one', sourceRevision: revision,
    from: point(4), ancestor: point(1), status: 'running', reason: null};
  valid(projection.validateProjectionRetainedCheckpoints(running));
  const incomplete = retained();
  incomplete.recovery.pending = {block: {...point(4), previousBlockId: point(3).blockId}, digest: null, reason: 'source admitted'};
  incomplete.recovery.gap = {block: {...point(6), previousBlockId: point(5).blockId}, digest: null, reason: 'missing source'};
  const captured = valid(projection.validateProjectionRetainedCheckpoints(incomplete));
  assert.equal(captured.recovery.pending.reason, 'source admitted');
  assert.equal(captured.recovery.gap.block.blockNum, 6);
  const unavailable = retained();
  unavailable.recovery.revision = 'b'.repeat(64);
  unavailable.recovery.rollback = {operationId: 'fork-two', sourceRevision: revision,
    from: point(3), ancestor: point(0), status: 'unavailable', reason: 'native undo is missing'};
  valid(projection.validateProjectionRetainedCheckpoints(unavailable));
});

test('maximum rollback coverage includes its floor while enforcing byte and traversal bounds', () => {
  const value = retained();
  const maximum = projection.PROJECTION_ROLLBACK_LIMITS.retainedBlocks;
  value.recovery.checkpoint = point(maximum);
  value.recovery.coverage = {...value.recovery.coverage, retainedBlocks: maximum, maxBlocks: maximum};
  value.checkpoints = Array.from({length: maximum + 1}, (_, index) => point(maximum - index));
  assert.equal(valid(projection.validateProjectionRetainedCheckpoints(value)).checkpoints.length, maximum + 1);
  value.checkpoints.unshift(point(maximum + 1));
  invalid(projection.validateProjectionRetainedCheckpoints(value));
  const oversized = retained();
  oversized.checkpoints[0].native = 'x'.repeat(projection.PROJECTION_LIMITS.batchBytes + 1);
  invalid(projection.validateProjectionRetainedCheckpoints(oversized));
});
