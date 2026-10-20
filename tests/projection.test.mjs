import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {
  PROJECTION_CAPABILITIES, PROJECTION_LIMITS, ProjectionContractError,
  validateProjectionDefinition, validateProjectionBinding, validateProjectionActivation,
  validateProjectionApply, validateProjectionQuery, validateProjectionQueryInput,
  validateProjectionView, canonicalProjectionBatch, projectTableValue, projectionRowKey,
} from '@eosrio/hyperion-sdk/projection';
import {validateProjectionDefinition as rootValidator, validateComponentManifest} from '@eosrio/hyperion-sdk';
import {exampleTableAbiJson, exampleTableDefinition, exampleTableQuery,
  createTableProjectionExample} from '@eosrio/hyperion-sdk/examples/table-projection';

const definition = () => structuredClone(exampleTableDefinition);
const binding = () => ({chainId: 'c'.repeat(64), backendId: 'test-backend', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision, abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'engineering-instance-1'});
const capabilities = () => ({interfaceVersion: 1, supported: [...PROJECTION_CAPABILITIES]});
const request = () => structuredClone(createTableProjectionExample(binding()).requests[0]);
const value = () => ({owner: 'alice', quantity: 7, active: true});
const query = () => structuredClone(exampleTableQuery);
const invalid = result => {
  assert.equal(result.valid, false, JSON.stringify(result));
  assert.ok(result.errors.length);
  assert.ok(result.errors.every(error => error.code && typeof error.path === 'string' && error.message));
  return result.errors;
};
const valid = result => {
  assert.equal(result.valid, true, JSON.stringify(result));
  return result.value;
};
const digest = batch => createHash('sha256').update(canonicalProjectionBatch(batch)).digest('hex');

test('additive projection exports retain metadata API and ship an ABI-pinned pure example', () => {
  assert.equal(rootValidator, validateProjectionDefinition);
  assert.equal(typeof validateComponentManifest, 'function');
  valid(validateProjectionDefinition(exampleTableDefinition));
  assert.equal(createHash('sha256').update(exampleTableAbiJson).digest('hex'), exampleTableDefinition.source.abiSha256);
  assert.equal(PROJECTION_LIMITS.queryBytes, 4194304);
});

test('activation checks every declared capability and exact definition binding before native work', () => {
  valid(validateProjectionActivation(definition(), binding(), capabilities()));
  for (const required of PROJECTION_CAPABILITIES) {
    const caps = capabilities();
    caps.supported = caps.supported.filter(capability => capability !== required);
    assert.ok(invalid(validateProjectionActivation(definition(), binding(), caps))
      .some(error => error.code === 'projection.capability-unavailable' && error.message.includes(required)));
  }
  for (const field of ['projectionId', 'mappingRevision', 'abiDeployment', 'abiSha256']) {
    const actual = binding();
    actual[field] = field.endsWith('Sha256') || field === 'mappingRevision' ? 'f'.repeat(64) : 'different';
    invalid(validateProjectionActivation(definition(), actual, capabilities()));
  }
  for (const caps of [{...capabilities(), interfaceVersion: 2}, {...capabilities(), nativeQuery: true},
    {...capabilities(), supported: ['unknown']}, {...capabilities(), supported: [PROJECTION_CAPABILITIES[0], PROJECTION_CAPABILITIES[0]]}]) {
    invalid(validateProjectionActivation(definition(), binding(), caps));
  }
});

test('definition validation keeps this slice strict, fixed ABI-bound, and genesis-only', () => {
  for (const mutate of [
    input => {input.schemaVersion = 2;}, input => {input.initialization.kind = 'snapshot';},
    input => {input.source.abiSha256 = 'A'.repeat(64);}, input => {delete input.source.abiDeployment;},
    input => {input.mappingRevision = 'floating';}, input => {input.fields[0].path = [];},
    input => {input.fields[0].path = new Array(17).fill('member');},
    input => {input.fields[0].path = ['constructor', 'prototype'];},
    input => {input.fields[0].name = '$where';}, input => {input.fields[0].type = 'float';},
    input => {input.fields.push(structuredClone(input.fields[0]));},
    input => {input.fields = [];}, input => {input.fields = new Array(65).fill(input.fields[0]);},
    input => {input.native = {$set: {enabled: true}};},
  ]) {
    const input = definition(); mutate(input); invalid(validateProjectionDefinition(input));
  }
});

test('all successful values are detached recursively frozen snapshots', () => {
  const input = definition();
  const selected = binding();
  const caps = capabilities();
  const output = valid(validateProjectionActivation(input, selected, caps));
  input.fields[0].path[0] = 'wrong'; selected.generation = 'later'; caps.supported.length = 0;
  assert.equal(output.definition.fields[0].path[0], 'account');
  assert.equal(output.binding.generation, 'engineering-instance-1');
  assert.equal(output.capabilities.supported.length, PROJECTION_CAPABILITIES.length);
  for (const part of [output, output.definition, output.definition.source, output.definition.fields,
    output.definition.fields[0], output.definition.fields[0].path, output.binding, output.capabilities.supported]) {
    assert.ok(Object.isFrozen(part));
  }
  assert.throws(() => {output.definition.fields[0].path[0] = 'changed';}, TypeError);
});

test('inert validation never executes accessors, toJSON, or malicious thrown diagnostic getters', () => {
  let executions = 0;
  const getter = definition();
  Object.defineProperty(getter, 'source', {enumerable: true, get() {executions++; throw new Error('called');}});
  const json = definition(); json.toJSON = () => {executions++; return definition();};
  const thrown = Object.defineProperty({}, 'code', {get() {executions++; throw new Error('called');}});
  const trapped = new Proxy({}, {getPrototypeOf() {throw thrown;}});
  for (const input of [getter, json, trapped]) invalid(validateProjectionDefinition(input));
  const row = {account: 'alice', balance: {units: 1}};
  Object.defineProperty(row, 'enabled', {enumerable: true, get() {executions++; return true;}});
  invalid(projectTableValue(definition(), row));
  assert.equal(executions, 0);
});

test('cycles, sparse arrays, symbols, unsafe source numbers and traversal budgets fail boundedly', () => {
  const cycle = definition(); cycle.extra = cycle;
  const sparse = definition(); delete sparse.fields[0];
  const symbol = definition(); symbol[Symbol('hidden')] = true;
  const deep = {}; let cursor = deep;
  for (let i = 0; i < 40; i++) cursor = cursor.child = {};
  for (const input of [cycle, sparse, symbol, new Date(), {...definition(), extra: deep}]) invalid(validateProjectionDefinition(input));
  invalid(projectTableValue(definition(), {account: 'alice', balance: {units: 1.5}, enabled: true}));
  invalid(projectTableValue(definition(), {account: 'alice', balance: {units: Number.MAX_SAFE_INTEGER + 1}, enabled: true}));
});

test('mapping uses required own source paths and emits the complete renamed scalar record', () => {
  const mapped = valid(projectTableValue(definition(), {account: 'alice', balance: {units: 7}, enabled: true, unused: 'source-only'}));
  assert.deepEqual({...mapped}, value());
  assert.ok(Object.isFrozen(mapped));
  for (const row of [{account: 'alice', balance: {}, enabled: true},
    {account: null, balance: {units: 7}, enabled: true},
    {account: 'alice', balance: {units: '7'}, enabled: true},
    {account: 'alice', balance: [{units: 7}], enabled: true},
    {account: 'alice', balance: {units: 7}, enabled: 1}]) invalid(projectTableValue(definition(), row));
  invalid(projectTableValue(definition(), Object.create({account: 'alice', balance: {units: 7}, enabled: true})));
});

test('null is a required typed scalar, distinct from missing or another declared field type', () => {
  const input = definition(); input.fields.push({name: 'note', path: ['memo'], type: 'null'});
  const mapped = valid(projectTableValue(input, {account: 'alice', balance: {units: 7}, enabled: true, memo: null}));
  assert.equal(mapped.note, null);
  invalid(projectTableValue(input, {account: 'alice', balance: {units: 7}, enabled: true}));
  valid(validateProjectionQuery(input, {filter: [{field: 'note', op: 'eq', value: null}], limit: 1}));
  invalid(validateProjectionQuery(input, {filter: [{field: 'owner', op: 'eq', value: null}], limit: 1}));
});

test('opaque row identity preserves full precision and cannot collide through delimiters', () => {
  assert.equal(projectionRowKey('scope', '18446744073709551615'), '["scope","18446744073709551615"]');
  assert.equal(projectionRowKey('scope', '0x00ff:opaque/key'), '["scope","0x00ff:opaque/key"]');
  assert.notEqual(projectionRowKey('a:b', 'c'), projectionRowKey('a', 'b:c'));
  assert.notEqual(projectionRowKey('a","b', 'c'), projectionRowKey('a', 'b","c'));
  assert.notEqual(projectionRowKey('scope', '01'), projectionRowKey('scope', '1'));
  assert.throws(() => projectionRowKey('scope', 9007199254740993), ProjectionContractError);
  assert.throws(() => projectionRowKey('scope', ''), ProjectionContractError);
  assert.throws(() => projectionRowKey('scope', 'x'.repeat(513)), ProjectionContractError);
});

test('UTF-8 identities and values reject lone surrogates and enforce encoded byte limits', () => {
  assert.equal(projectionRowKey('😀', 'opaque'), '["😀","opaque"]');
  for (const malformed of ['\ud800', '\udfff', 'before\ud800after']) {
    assert.throws(() => projectionRowKey(malformed, 'key'), ProjectionContractError);
    assert.throws(() => projectionRowKey('scope', malformed), ProjectionContractError);
    invalid(projectTableValue(definition(), {account: malformed, balance: {units: 1}, enabled: true}));
    const actual = binding(); actual.generation = malformed;
    invalid(validateProjectionBinding(definition(), actual));
  }
  assert.throws(() => projectionRowKey('😀'.repeat(65), 'key'), ProjectionContractError);
  invalid(projectTableValue(definition(), {account: 'é'.repeat(32769), balance: {units: 1}, enabled: true}));
});

test('apply permits empty blocks and ordered full puts/deletes but rejects gaps and malformed records', () => {
  const input = request(); valid(validateProjectionApply(definition(), input));
  valid(validateProjectionApply(definition(), {...input, mutations: []}));
  for (const mutate of [
    actual => {actual.previous.blockNum = 1;}, actual => {actual.block.previousBlockId = 'f'.repeat(64);},
    actual => {actual.previous.blockId = 'f'.repeat(64);}, actual => {actual.block.blockNum = 0;},
    actual => {actual.binding.abiDeployment = 'another';}, actual => {delete actual.mutations[0].value.owner;},
    actual => {actual.mutations[0].value.extra = 'undeclared';}, actual => {actual.mutations[0].value.quantity = 1.25;},
    actual => {actual.mutations[0].kind = 'increment';}, actual => {actual.mutations[0].key = 'x'.repeat(1025);},
    actual => {actual.mutations = new Array(1001).fill(actual.mutations[0]);},
  ]) {
    const actual = request(); mutate(actual); invalid(validateProjectionApply(definition(), actual));
  }
  invalid(validateProjectionApply(definition(), {...input, mutations: [{kind: 'delete', key: 'x', value: value()}]}));
});

test('canonical replay identity includes all source/binding/mutation values and preserves event order', () => {
  const original = request();
  // Reorder every object's insertion order without removing nested properties.
  const reorder = input => Array.isArray(input) ? input.map(reorder) : input && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).reverse().map(([key, value]) => [key, reorder(value)])) : input;
  assert.equal(digest(original), digest(reorder(original)));
  for (const mutate of [
    actual => {actual.binding.generation = 'other';}, actual => {actual.binding.backendId = 'other';},
    actual => {actual.binding.chainId = 'f'.repeat(64);}, actual => {actual.binding.mappingRevision = 'f'.repeat(64);},
    actual => {actual.binding.abiDeployment = 'other';}, actual => {actual.binding.abiSha256 = 'f'.repeat(64);},
    actual => {actual.block.blockId = 'f'.repeat(64);}, actual => {actual.mutations[0].value.quantity++;},
    actual => {actual.mutations.reverse();}, actual => {actual.mutations[0].key += '!';},
  ]) {
    const actual = request(); mutate(actual); assert.notEqual(digest(original), digest(actual));
  }
  assert.throws(() => canonicalProjectionBatch({...original, previous: {blockNum: 0, blockId: 'f'.repeat(64)}}), ProjectionContractError);
});

test('record and full batch byte budgets are distinct from scalar and mutation limits', () => {
  const input = definition(); input.fields = Array.from({length: 8}, (_, index) => ({name: `field${index}`, path: [`field${index}`], type: 'string'}));
  const actual = request();
  actual.mutations = [{kind: 'put', key: 'large', value: Object.fromEntries(input.fields.map(field => [field.name, 'x'.repeat(40000)]))}];
  assert.ok(invalid(validateProjectionApply(input, actual)).some(error => error.message.includes('record byte')));
  const boundedRecord = Object.fromEntries(input.fields.map(field => [field.name, 'x'.repeat(30000)]));
  actual.mutations = Array.from({length: 20}, (_, index) => ({kind: 'put', key: `row-${index}`, value: boundedRecord}));
  invalid(validateProjectionApply(input, actual));
});

test('query syntax, types and bounded counts reject native operators and unsupported behavior', () => {
  valid(validateProjectionQuery(definition(), query()));
  valid(validateProjectionQuery(definition(), {filter: [], limit: 1000, count: {upTo: 100000}}));
  for (const actual of [
    {...query(), limit: 0}, {...query(), limit: 1001}, {...query(), count: {upTo: 0}},
    {...query(), count: {upTo: 100001}}, {...query(), orderBy: 'quantity'},
    {...query(), filter: [{field: 'owner', op: '$where', value: 'alice'}]},
    {...query(), filter: [{field: 'unknown', op: 'eq', value: 'alice'}]},
    {...query(), filter: [{field: 'quantity', op: 'eq', value: '7'}]},
    {...query(), filter: [{field: 'quantity', op: 'eq', value: Infinity}]},
    {...query(), filter: [{field: 'owner', op: 'eq', value: {$ne: 'bob'}}]},
    {...query(), filter: [query().filter[0], query().filter[0]]},
    {...query(), afterKey: '\ud800'}, {...query(), $where: 'javascript()'},
  ]) invalid(validateProjectionQuery(definition(), actual));
  const capturedInput = query();
  const captured = valid(validateProjectionQueryInput(capturedInput));
  capturedInput.filter[0].value = 'bob';
  assert.equal(captured.filter[0].value, 'alice');
  valid(validateProjectionQuery(definition(), captured));
  valid(validateProjectionQueryInput({filter: [{field: 'notDeclaredYet', op: 'eq', value: 'captured'}], limit: 1}));
  invalid(validateProjectionQuery(definition(), {filter: [{field: 'notDeclaredYet', op: 'eq', value: 'captured'}], limit: 1}));
});

test('view shape binds exact backend/generation/checkpoint and cannot invent an arbitrary bootstrap', () => {
  valid(validateProjectionView({binding: binding(), checkpoint: {blockNum: 0, blockId: '0'.repeat(64)}}));
  valid(validateProjectionView({binding: binding(), checkpoint: {blockNum: 2, blockId: '2'.repeat(64)}}));
  for (const checkpoint of [{blockNum: 0, blockId: 'c'.repeat(64)}, {blockNum: -1, blockId: '0'.repeat(64)},
    {blockNum: Number.MAX_SAFE_INTEGER + 1, blockId: '0'.repeat(64)}, {blockNum: 2, blockId: '2'.repeat(64), digest: 'f'.repeat(64)}]) {
    invalid(validateProjectionView({binding: binding(), checkpoint}));
  }
});

test('packaged example demonstrates insert, full update, delete and unchanged logical query', () => {
  const selected = binding();
  const example = createTableProjectionExample(selected);
  selected.generation = 'mutated';
  const rows = new Map();
  let checkpoint = example.genesis;
  for (const input of example.requests) {
    const actual = valid(validateProjectionApply(exampleTableDefinition, input));
    assert.deepEqual({...actual.previous}, {...checkpoint});
    assert.equal(actual.binding.generation, 'engineering-instance-1');
    for (const mutation of actual.mutations) {
      if (mutation.kind === 'put') rows.set(mutation.key, mutation.value);
      else rows.delete(mutation.key);
    }
    checkpoint = {blockNum: actual.block.blockNum, blockId: actual.block.blockId};
  }
  const actualQuery = valid(validateProjectionQuery(exampleTableDefinition, example.query));
  const matches = [...rows.entries()].filter(([, row]) => actualQuery.filter.every(term => row[term.field] === term.value));
  assert.equal(matches.length, 1);
  assert.deepEqual({...matches[0][1]}, {owner: 'alice', quantity: 7, active: true});
  assert.equal(checkpoint.blockNum, 3);
});

test('error types distinguish retryable serving failures from refused contract/conflict input', () => {
  for (const code of ['projection.not-initialized', 'projection.incomplete', 'projection.stale-view',
    'projection.replay-unavailable', 'projection.apply-unavailable']) assert.equal(new ProjectionContractError(code, code).retryable, true);
  for (const code of ['projection.invalid-contract', 'projection.capability-unavailable', 'projection.conflicting-replay',
    'projection.source-gap']) assert.equal(new ProjectionContractError(code, code).retryable, false);
});
