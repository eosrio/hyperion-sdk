import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {canonicalStructuredRecord as record} from '../dist/internal/structured-values.js';

// Explicit fixture settings, not SDK defaults or a per-chain aggregate budget.
const limits = () => ({depth: 16, nodes: 4096, fields: 64, arrayElements: 1000,
  stringBytes: 65536, recordBytes: 262144, integerFields: 16, pathSegments: 16});
const integer = (path, type = 'int64', vector = false) => ({path, type, vector});
const snapshot = (value, fields = [], bounds = limits()) => record(value, fields, bounds);

test('original 2.7/real PG tracer-shaped values roundtrip through the actual record function', () => {
  // Original0aabc47d / locked codec2.2.0; PG oracle tree6a25f8a8. Constructed fixture,
  // not a source receipt, genesis proof or PostgreSQL/Mongo/WormDB execution here.
  const input = {asset_id: '9007199254740993', owner: 'bob', template_id: null,
    immutable_data: {serial: '18446744073709551615', sv: ['-9223372036854775808', '9223372036854775807'],
      uv: ['0', '18446744073709551615'], floats: [.1, 1.25, -0], ordinary: '0001'},
    mutable_data: {name: 'replacement mutable', signed: '-9223372036854775808'},
    collection: {market_fee: .05, authorized_accounts: ['author', 'editor'], created_at_block: '123456'},
    schema: {format: [{name: 'image', type: 'string', mediatype: 'video', info: 'video/mp4'}]}};
  const fields = [integer(['asset_id'], 'uint64'), integer(['immutable_data', 'serial'], 'uint64'),
    integer(['immutable_data', 'sv'], 'int64', true), integer(['immutable_data', 'uv'], 'uint64', true),
    integer(['mutable_data', 'signed'])];
  const result = snapshot(input, fields);
  assert.deepEqual(JSON.parse(result.canonical), JSON.parse(JSON.stringify(input)));
  assert.equal(result.bytes, Buffer.byteLength(result.canonical));
  assert.equal(result.value.immutable_data.serial, '18446744073709551615');
  assert.equal(result.value.immutable_data.ordinary, '0001');
  assert.equal(Object.is(result.value.immutable_data.floats[2], -0), false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.value.schema.format[0]));
  input.schema.format[0].info = 'changed'; input.immutable_data.sv.push('1');
  assert.equal(result.value.schema.format[0].info, 'video/mp4');
  assert.equal(result.value.immutable_data.sv.length, 2);
});

test('object key order is canonical and ordered arrays retain distinct identities', () => {
  const first = snapshot({z: {b: 2, a: 1}, a: ['x', 'y']});
  const second = snapshot({a: ['x', 'y'], z: {a: 1, b: 2}});
  assert.equal(first.canonical, '{"a":["x","y"],"z":{"a":1,"b":2}}');
  const hash = result => createHash('sha256').update(result.canonical).digest('hex');
  assert.equal(hash(first), hash(second));
  assert.notEqual(hash(first), hash(snapshot({z: {a: 1, b: 2}, a: ['y', 'x']})));
  assert.equal(snapshot({items: Array.from({length: 12}, (_, i) => i)}).canonical,
    '{"items":[0,1,2,3,4,5,6,7,8,9,10,11]}');
});

test('whole replacements keep null separate from absence without merging old mutable data', () => {
  const before = snapshot({owner: 'alice', mutable_data: {old: 'drop', name: 'before'}});
  const after = snapshot({owner: null, mutable_data: {name: 'replacement'}});
  assert.equal(after.value.owner, null);
  assert.equal(Object.hasOwn(after.value.mutable_data, 'old'), false);
  assert.equal(before.value.mutable_data.old, 'drop');
  assert.notEqual(after.canonical, snapshot({mutable_data: {name: 'replacement'}}).canonical);
  assert.equal(snapshot({}, [integer(['optional'])]).canonical, '{}');
});

test('exact integer scalar/vector ranges and canonical decimal spellings are enforced without Number', () => {
  for (const value of ['0', '-9223372036854775808', '9223372036854775807'])
    assert.equal(snapshot({n: value}, [integer(['n'])]).value.n, value);
  assert.equal(snapshot({n: '18446744073709551615'}, [integer(['n'], 'uint64')]).value.n, '18446744073709551615');
  for (const value of ['+1', '01', '-0', '-01', ' 1', '1 ', '1e3', '1.0', '', '9223372036854775808',
    '-9223372036854775809', '9'.repeat(100000), 9007199254740993, null])
    assert.throws(() => snapshot({n: value}, [integer(['n'])]), TypeError);
  for (const value of ['-1', '18446744073709551616'])
    assert.throws(() => snapshot({n: value}, [integer(['n'], 'uint64')]), TypeError);
  assert.throws(() => snapshot({n: ['1', '01']}, [integer(['n'], 'int64', true)]), TypeError);
  assert.throws(() => snapshot({n: '1'}, [integer(['n'], 'int64', true)]), TypeError);
  assert.equal(snapshot({n: '01'}).value.n, '01', 'Ordinary strings are not implicitly integer leaves');
});

test('the native JSONB number hazard is distinct from declared mint metadata', () => {
  const generic = JSON.parse('{"integer":9007199254740993,"fraction":0.1,"nil":null}');
  assert.equal(generic.integer, 9007199254740992);
  assert.throws(() => snapshot(generic, [integer(['integer'])]), TypeError);
  const typed = snapshot({...generic, integer: '9007199254740993'}, [integer(['integer'])]);
  assert.equal(typed.value.integer, '9007199254740993');
  assert.equal(typed.value.fraction, .1); assert.equal(typed.value.nil, null);
});

test('caller-supplied traversal, structure, UTF8 and canonical byte boundaries are exact', () => {
  const value = {a: ['é', '\n', '🌍']};
  const bytes = Buffer.byteLength('{"a":["é","\\n","🌍"]}');
  assert.equal(snapshot(value, [], {...limits(), depth: 2, nodes: 5, fields: 1, arrayElements: 3,
    stringBytes: 4, recordBytes: bytes}).bytes, bytes);
  for (const bound of [{depth: 1}, {nodes: 4}, {fields: 0}, {arrayElements: 2}, {stringBytes: 3}, {recordBytes: bytes - 1}])
    assert.throws(() => snapshot(value, [], {...limits(), ...bound}), TypeError);
  assert.equal(snapshot({}, [], {...limits(), depth: 0, nodes: 1, fields: 0, arrayElements: 0,
    stringBytes: 0, recordBytes: 2, integerFields: 0, pathSegments: 0}).canonical, '{}');
  assert.throws(() => record({}, [], undefined), TypeError);
  for (const bound of [{nodes: Infinity}, {depth: -1}, {recordBytes: NaN}, {extra: 1}])
    assert.throws(() => snapshot({}, [], {...limits(), ...bound}), TypeError);
});

test('data properties named __proto__ and constructor stay inert and detached', () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"name":"ordinary"}}');
  const result = snapshot(input);
  assert.equal(Object.getPrototypeOf(result.value), null);
  assert.equal(Object.hasOwn(result.value, '__proto__'), true);
  assert.equal(result.value.__proto__.polluted, true);
  assert.equal(result.value.constructor.name, 'ordinary');
  assert.equal(Object.prototype.polluted, undefined);
});

test('accessors never execute and noninert data, cycles and sparse/extended arrays refuse', () => {
  let calls = 0;
  const accessor = {}; Object.defineProperty(accessor, 'x', {enumerable: true, get() {calls++; return 1;}});
  assert.throws(() => snapshot(accessor), TypeError); assert.equal(calls, 0);
  const cycle = {}; cycle.self = cycle;
  const sparse = Array(2); sparse[1] = 'x'; const extended = ['x']; extended.extra = true;
  const hidden = {}; Object.defineProperty(hidden, 'x', {value: 1});
  for (const value of [undefined, () => 1, 1n, Symbol('x'), Infinity, NaN, new Date(), new Map(),
    new Number(1), sparse, extended, hidden, cycle, {[Symbol('x')]: 1}])
    assert.throws(() => snapshot({value}), TypeError);
});

test('malformed Unicode and unresolved original NUL conversion inputs refuse without normalization', () => {
  for (const text of ['\ud800', '\udc00', 'x\ud800z', 'a\0b', 'a\\u0000b'])
    assert.throws(() => snapshot({text}), TypeError);
  assert.throws(() => snapshot({['\ud800']: 1}), TypeError);
  assert.equal(snapshot({text: '\u0001\b\t\n\f\r"\\é🌍'}).bytes,
    Buffer.byteLength(snapshot({text: '\u0001\b\t\n\f\r"\\é🌍'}).canonical));
});

test('integer declarations are inert, bounded object paths with optional missing leaves', () => {
  assert.throws(() => snapshot({n: '1'}, [integer(['n']), integer(['n'])]), TypeError);
  assert.throws(() => snapshot({n: '1'}, [integer(['n'])], {...limits(), integerFields: 0}), TypeError);
  assert.throws(() => snapshot({}, [integer(['parent', 'n'])], {...limits(), pathSegments: 1}), TypeError);
  assert.throws(() => snapshot({}, [integer(['parent']), integer(['parent', 'n'])]), TypeError);
  assert.throws(() => snapshot({parent: []}, [integer(['parent', 'n'])]), TypeError);
  let called = false; const accessor = {get path() {called = true; return ['n'];}, type: 'int64', vector: false};
  assert.throws(() => snapshot({n: '1'}, [accessor]), TypeError); assert.equal(called, false);
});

test('caller depth can exceed the JavaScript call stack without a hidden SDK ceiling', () => {
  let value = {last: true}; for (let i = 0; i < 12000; i++) value = {next: value};
  const result = snapshot(value, [], {...limits(), depth: 12001, nodes: 12002, recordBytes: 200000});
  assert.ok(result.canonical.startsWith('{"next":')); assert.equal(result.bytes, Buffer.byteLength(result.canonical));
});

test('the draft utility has no public SDK export or package subpath', async () => {
  assert.equal(Object.hasOwn(await import('@eosrio/hyperion-sdk'), 'canonicalStructuredRecord'), false);
  await assert.rejects(import('@eosrio/hyperion-sdk/internal/structured-values'), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
});
