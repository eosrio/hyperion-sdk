import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '@eosrio/hyperion-sdk/projection';

const definition = () => ({schemaVersion: 2, id: 'contextual-marketplace', mappingRevision: 'a'.repeat(64),
  source: {contract: 'market.test', table: 'marketplaces', abiDeployment: 'deployment-1', abiSha256: 'b'.repeat(64)},
  fields: [
    {name: 'market_contract', type: 'string', source: {kind: 'context', field: 'contract'}},
    {name: 'marketplace_name', type: 'string', source: {kind: 'row', path: ['marketplace_name']}},
    {name: 'creator', type: 'string', source: {kind: 'row', path: ['creator']}},
    {name: 'created_at_block', type: 'string', source: {kind: 'context', field: 'blockNum', format: 'decimal'}},
    {name: 'created_at_time', type: 'string', source: {kind: 'context', field: 'blockTimeMs', format: 'decimal'}},
  ], initialization: {kind: 'genesis'}, preserveOnReplace: ['created_at_block', 'created_at_time'], onAbsent: 'incomplete'});
const context = () => ({binding: {chainId: 'c'.repeat(64), backendId: 'backend', projectionId: 'contextual-marketplace',
  mappingRevision: 'a'.repeat(64), abiDeployment: 'deployment-1', abiSha256: 'b'.repeat(64), generation: 'instance-1'},
  block: {blockNum: 20, blockId: '2'.repeat(64), previousBlockId: '1'.repeat(64)},
  source: {contract: 'market.test', table: 'marketplaces', blockTimeMs: 1792976523500}});
const row = () => ({marketplace_name: 'marketplace', creator: 'alice',
  market_contract: 'untrusted', created_at_block: '999', created_at_time: '999'});
const valid = result => {assert.equal(result.valid, true, JSON.stringify(result)); return result.value;};
const invalid = result => {assert.equal(result.valid, false, JSON.stringify(result)); return result.errors;};
const batch = () => {
  const selected = definition(), original = context();
  return {...original, previous: {blockNum: 19, blockId: '1'.repeat(64)},
    policy: {preserveOnReplace: selected.preserveOnReplace, onAbsent: selected.onAbsent},
    mutations: [structuredClone(valid(sdk.projectContextualTableChange(selected, original, {key: 'marketplace', present: true, value: row()})))]};
};

test('contextual mapping keeps original contract and exact block/time outside the decoded row', () => {
  assert.equal(typeof sdk.projectContextualTableChange, 'function', 'Contextual mapping must be an additive SDK export');
  const input = context(); input.block.blockNum = Number.MAX_SAFE_INTEGER;
  const result = valid(sdk.projectContextualTableChange(definition(), input,
    {key: 'marketplace', present: true, value: row()}));
  assert.deepEqual({...result, value: {...result.value}}, {kind: 'put-preserving', key: 'marketplace',
    value: {market_contract: 'market.test', marketplace_name: 'marketplace', creator: 'alice',
      created_at_block: '9007199254740991', created_at_time: '1792976523500'},
    preserveFields: ['created_at_block', 'created_at_time']});
  assert.ok(Object.isFrozen(result.value));
});

test('preserving replacement inserts complete candidates and keeps first creation on ordered updates', () => {
  assert.equal(typeof sdk.resolveContextualProjectionMutation, 'function', 'A preserving replacement needs explicit portable semantics');
  const selected = definition(), firstContext = context();
  firstContext.block.blockNum = 10; firstContext.source.blockTimeMs = 1792976520000;
  const first = valid(sdk.projectContextualTableChange(selected, firstContext, {key: 'marketplace', present: true, value: row()}));
  const stored = valid(sdk.resolveContextualProjectionMutation(selected, first, null));
  const update = valid(sdk.projectContextualTableChange(selected, context(), {key: 'marketplace', present: true,
    value: {...row(), creator: 'bob'}}));
  const updated = valid(sdk.resolveContextualProjectionMutation(selected, update, stored));
  assert.deepEqual({...updated}, {market_contract: 'market.test', marketplace_name: 'marketplace', creator: 'bob',
    created_at_block: '10', created_at_time: '1792976520000'});
  assert.equal(update.value.created_at_block, '20', 'The logical candidate is retained, not rewritten using prior state');
  const later = valid(sdk.resolveContextualProjectionMutation(selected, update, updated));
  assert.deepEqual(later, updated, 'Repeating the same pure replacement does not change first creation');
  assert.equal(stored.creator, 'alice', 'Prior state is detached and unchanged');
});

test('combining individually bounded records cannot exceed the final record budget', () => {
  const selected = definition();
  selected.fields = Array.from({length: 8}, (_, index) => ({name: `field${index}`, type: 'string',
    source: {kind: 'row', path: [`field${index}`]}}));
  selected.preserveOnReplace = ['field0', 'field1', 'field2', 'field3'];
  const previous = Object.fromEntries(selected.fields.map((field, index) => [field.name, index < 4 ? 'x'.repeat(60000) : '']));
  const candidate = Object.fromEntries(selected.fields.map((field, index) => [field.name, index < 4 ? '' : 'y'.repeat(60000)]));
  const result = sdk.resolveContextualProjectionMutation(selected,
    {kind: 'put-preserving', key: 'large', value: candidate, preserveFields: selected.preserveOnReplace}, previous);
  assert.equal(result.valid, false, 'The merged record needs its own byte-budget check');
});

test('replay identity retains the original candidate, source context, policy and mutation order', () => {
  assert.equal(typeof sdk.canonicalContextualProjectionBatch, 'function', 'Contextual replay identity must not erase original policy');
  const original = batch(), selected = definition();
  valid(sdk.validateContextualProjectionApply(selected, original));
  const canonical = sdk.canonicalContextualProjectionBatch(original);
  assert.match(canonical, /"created_at_block":"20"/);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  assert.equal(sdk.canonicalContextualProjectionBatch(reorder(original)), canonical);
  for (const mutate of [input => {input.source.blockTimeMs++;}, input => {input.binding.generation = 'other';},
    input => {input.policy.onAbsent = 'delete';}, input => {input.mutations[0].value.created_at_block = '10';}]) {
    const input = structuredClone(original); mutate(input);
    assert.notEqual(sdk.canonicalContextualProjectionBatch(input), canonical);
  }
  const later = structuredClone(original.mutations[0]); later.value.creator = 'bob';
  const forward = {...original, mutations: [original.mutations[0], later]};
  assert.notEqual(sdk.canonicalContextualProjectionBatch(forward),
    sdk.canonicalContextualProjectionBatch({...forward, mutations: [...forward.mutations].reverse()}));
  assert.equal(sdk.validateProjectionApply({schemaVersion: 1}, original).valid, false);
});

test('both the host and adapter must explicitly negotiate the contextual family before activation', () => {
  assert.equal(typeof sdk.validateContextualProjectionActivation, 'function', 'Old capabilities cannot activate a new definition family');
  const host = {family: 'contextual-table', interfaceVersion: 1, supported: [...sdk.CONTEXTUAL_PROJECTION_HOST_CAPABILITIES]};
  const adapter = {family: 'contextual-table', interfaceVersion: 1, supported: [...sdk.CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES]};
  const selected = valid(sdk.validateContextualProjectionActivation(definition(), context().binding, host, adapter));
  assert.ok(Object.isFrozen(selected.hostCapabilities.supported));
  for (const role of ['host', 'adapter']) for (const capability of (role === 'host' ? host : adapter).supported) {
    const actualHost = structuredClone(host), actualAdapter = structuredClone(adapter);
    (role === 'host' ? actualHost : actualAdapter).supported = (role === 'host' ? host : adapter).supported.filter(value => value !== capability);
    const refused = sdk.validateContextualProjectionActivation(definition(), context().binding, actualHost, actualAdapter);
    assert.equal(refused.valid, false, `${role} must support ${capability}`);
    assert.equal(refused.errors[0].code, 'projection.capability-unavailable');
  }
  assert.equal(sdk.validateContextualProjectionActivation(definition(), context().binding,
    {interfaceVersion: 1, supported: sdk.PROJECTION_CAPABILITIES}, adapter).valid, false);
  assert.equal(sdk.validateProjectionDefinition(definition()).valid, false, 'Closed v1 schema stays closed');
});

test('missing required row data retains the precise mapping diagnostic', () => {
  const input = row(); delete input.creator;
  const refused = sdk.projectContextualTableChange(definition(), context(), {key: 'marketplace', present: true, value: input});
  assert.equal(refused.valid, false);
  assert.equal(refused.errors[0].path, '/source/creator');
});

test('original context rejects ABI/mapping/contract changes, invented fields and inexact time', () => {
  for (const mutate of [input => {input.binding.mappingRevision = 'f'.repeat(64);},
    input => {input.binding.abiDeployment = 'current-abi';}, input => {input.binding.abiSha256 = 'f'.repeat(64);},
    input => {input.source.contract = 'unconfigured';}, input => {input.source.table = 'another';},
    input => {input.source.blockTimeMs = Number.MAX_SAFE_INTEGER + 1;}, input => {input.source.blockTimeMs = 1.5;},
    input => {input.source.blockTimeMs = -1;}, input => {input.source.blockTimeMs = Infinity;},
    input => {delete input.source.blockTimeMs;}, input => {input.source.currentHead = 100;},
    input => {input.block.timestamp = 123;}, input => {input.binding.extra = true;}]) {
    const input = context(); mutate(input);
    invalid(sdk.projectContextualTableChange(definition(), input, {key: 'marketplace', present: true, value: row()}));
  }
  const original = context(); original.source.blockTimeMs = Number.MAX_SAFE_INTEGER;
  const mutation = valid(sdk.projectContextualTableChange(definition(), original, {key: 'marketplace', present: true, value: row()}));
  assert.equal(mutation.value.created_at_time, '9007199254740991');
});

test('definitions strictly declare scalar sources, preservation and absence behavior', () => {
  for (const mutate of [input => {input.schemaVersion = 1;}, input => {input.fields[0].source.field = 'currentTime';},
    input => {input.fields[3].source.format = 'number';}, input => {delete input.fields[3].source.format;},
    input => {input.fields[0].source.path = ['fake'];}, input => {input.fields[0].type = 'integer';},
    input => {input.fields[1].source.path = ['__proto__'];}, input => {input.fields.push(input.fields[0]);},
    input => {input.preserveOnReplace = ['creator', 'creator'];}, input => {input.preserveOnReplace = ['missing'];},
    input => {input.preserveOnReplace = ['__proto__'];}, input => {delete input.onAbsent;},
    input => {input.onAbsent = 'skip';}, input => {input.initialization.kind = 'snapshot';},
    input => {input.hook = 'javascript';}]) {
    const input = definition(); mutate(input); invalid(sdk.validateContextualProjectionDefinition(input));
  }
  const selected = definition(); selected.fields = [selected.fields[0]]; selected.preserveOnReplace = [];
  const mutation = valid(sdk.projectContextualTableChange(selected, context(), {key: 'context-only', present: true, value: {}}));
  assert.deepEqual({...mutation.value}, {market_contract: 'market.test'});
  assert.equal(mutation.kind, 'put');
});

test('absence is explicit and required null remains different from missing prior or candidate fields', () => {
  const missing = sdk.projectContextualTableChange(definition(), context(), {key: 'marketplace', present: false});
  assert.equal(invalid(missing)[0].code, 'projection.incomplete');
  const selected = definition(); selected.onAbsent = 'delete';
  const deletion = valid(sdk.projectContextualTableChange(selected, context(), {key: 'marketplace', present: false}));
  assert.deepEqual({...deletion}, {kind: 'delete', key: 'marketplace'});
  assert.equal(valid(sdk.resolveContextualProjectionMutation(selected, deletion, null)), null);
  const inserted = valid(sdk.projectContextualTableChange(selected, context(), {key: 'marketplace', present: true, value: row()}));
  assert.equal(valid(sdk.resolveContextualProjectionMutation(selected, inserted, null)).created_at_block, '20');
  selected.fields = [{name: 'creator', type: 'string', source: {kind: 'row', path: ['creator']}},
    {name: 'memo', type: 'null', source: {kind: 'row', path: ['memo']}}];
  selected.preserveOnReplace = ['memo'];
  const mutation = {kind: 'put-preserving', key: 'null-row', value: {creator: 'bob', memo: null}, preserveFields: ['memo']};
  assert.deepEqual({...valid(sdk.resolveContextualProjectionMutation(selected, mutation, {creator: 'alice', memo: null}))},
    {creator: 'bob', memo: null});
  invalid(sdk.resolveContextualProjectionMutation(selected, mutation, {creator: 'alice'}));
  invalid(sdk.resolveContextualProjectionMutation(selected, {...mutation, value: {creator: 'bob'}}, null));
});

test('apply refuses incomplete candidates, policy bypasses, source gaps and unbounded mutations', () => {
  for (const mutate of [input => {delete input.mutations[0].value.created_at_time;},
    input => {input.mutations[0].value.extra = 'unknown';}, input => {input.mutations[0].value.creator = null;},
    input => {input.mutations[0].preserveFields = ['created_at_block'];}, input => {input.policy.onAbsent = 'delete';},
    input => {input.mutations[0] = {kind: 'put', key: 'marketplace', value: input.mutations[0].value};},
    input => {input.mutations[0] = {kind: 'delete', key: 'marketplace'};},
    input => {input.previous.blockNum = 0;}, input => {input.block.previousBlockId = 'f'.repeat(64);},
    input => {input.mutations[0].key = 'x'.repeat(1025);},
    input => {input.mutations = new Array(1001).fill(input.mutations[0]);}, input => {input.native = {$set: {creator: 'bob'}};}]) {
    const input = batch(); mutate(input); invalid(sdk.validateContextualProjectionApply(definition(), input));
  }
  valid(sdk.validateContextualProjectionApply(definition(), {...batch(), mutations: []}));
  const capturedInput = batch(), captured = valid(sdk.validateContextualProjectionApplyInput(capturedInput));
  capturedInput.mutations[0].value.creator = 'changed'; capturedInput.source.blockTimeMs++;
  assert.equal(captured.mutations[0].value.creator, 'alice'); assert.equal(captured.source.blockTimeMs, 1792976523500);
  for (const value of [captured, captured.binding, captured.block, captured.source, captured.policy,
    captured.policy.preserveOnReplace, captured.mutations, captured.mutations[0], captured.mutations[0].value]) assert.ok(Object.isFrozen(value));
});

test('contextual validation is inert for getters, toJSON, symbols, cycles and malformed Unicode', () => {
  let executions = 0;
  const getter = context(); Object.defineProperty(getter.source, 'blockTimeMs', {enumerable: true, get() {executions++; return 1;}});
  invalid(sdk.validateContextualProjectionContext(definition(), getter));
  const json = definition(); json.toJSON = () => {executions++; return definition();};
  invalid(sdk.validateContextualProjectionDefinition(json));
  const badRow = row(); Object.defineProperty(badRow, 'creator', {enumerable: true, get() {executions++; return 'alice';}});
  invalid(sdk.projectContextualTableChange(definition(), context(), {key: 'marketplace', present: true, value: badRow}));
  const cycle = row(); cycle.self = cycle;
  const symbolic = row(); symbolic[Symbol('hidden')] = true;
  for (const value of [cycle, symbolic, {...row(), creator: '\ud800'}, {creator: 'alice', marketplace_name: NaN}])
    invalid(sdk.projectContextualTableChange(definition(), context(), {key: 'marketplace', present: true, value}));
  const sparse = batch(); delete sparse.mutations[0]; invalid(sdk.validateContextualProjectionApplyInput(sparse));
  const thrown = Object.defineProperty({}, 'code', {get() {executions++; throw new Error('called');}});
  invalid(sdk.validateContextualProjectionDefinition(new Proxy({}, {getPrototypeOf() {throw thrown;}})));
  assert.equal(executions, 0);
});

test('contextual queries reuse scalar equality semantics without native or richer query syntax', () => {
  valid(sdk.validateContextualProjectionQuery(definition(), {filter: [{field: 'created_at_block', op: 'eq', value: '20'}], limit: 1}));
  for (const query of [{filter: [{field: 'created_at_block', op: 'eq', value: 20}], limit: 1},
    {filter: [], limit: 1, orderBy: 'created_at_time'}, {filter: [{field: 'creator', op: '$where', value: 'alice'}], limit: 1}])
    invalid(sdk.validateContextualProjectionQuery(definition(), query));
});
