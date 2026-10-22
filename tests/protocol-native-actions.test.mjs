import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {
  protocolNativeActionBounds,
  validateProtocolNativeActionObservations,
  validateProtocolNativeActions,
  validateProtocolSelection,
} from '@eosrio/hyperion-sdk/protocol';
import {validateProtocolNativeActions as rootValidator} from '@eosrio/hyperion-sdk';

const component = {id: 'fixture-codec', runtime: 'node', version: '0.0.0-dev.1',
  sourceRevision: 'a'.repeat(40), sha256: '1'.repeat(64)};
const descriptor = () => ({interfaceVersion: 1,
  manifest: {schemaVersion: 1, package: '@example/native-fixture', version: '0.0.0-dev.1', kind: 'protocol',
    compatibility: {hyperion: '^4.5.0-dev.1', sdk: '^0.0.0-dev.1'}},
  profiles: [{id: 'fixture', components: [component], nativeActions: {interfaceVersion: 1}}]});
const selection = () => ({profileId: 'fixture', environment: {hyperion: '4.5.0-dev.1', sdk: '0.0.0-dev.1'},
  components: [component], nativeActionInterfaceVersions: [1]});
const origin = ordinal => ({transactionId: 'b'.repeat(64), actionOrdinal: ordinal, rawSha256: 'c'.repeat(64)});
const observations = () => ({schemaVersion: 1, decisions: [
  {origin: origin(1), kind: 'contract'},
  {origin: origin(2), kind: 'native', nativeKind: 'fixture-envelope-v1'},
  {origin: origin(3), kind: 'incomplete', error: {code: 'unsupported-membership', message: 'Source needs a supported verifier'}},
]});
const checkInvalid = input => {
  const result = validateProtocolNativeActionObservations(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.every(error => error.code && error.path && error.message));
};

test('native requirements refuse old callers before the host imports executable code', async () => {
  let imports = 0;
  const load = async selected => {
    const result = validateProtocolSelection(descriptor(), selected);
    if (!result.valid) throw new Error(result.errors[0].code);
    imports++;
    return import('data:text/javascript,export const fixture = true');
  };
  const legacy = selection();
  delete legacy.nativeActionInterfaceVersions;
  await assert.rejects(load(legacy), /protocol.unsupported-native-interface/);
  await assert.rejects(load({...selection(), nativeActionInterfaceVersions: []}), /protocol.unsupported-native-interface/);
  await assert.rejects(load({...selection(), nativeActionInterfaceVersions: [2]}), /protocol.unsupported-native-interface/);
  assert.equal(imports, 0);
  assert.equal((await load(selection())).fixture, true);
  assert.equal(imports, 1);
});

test('legacy profile snapshots stay unchanged and new requirements are frozen independently', () => {
  const input = descriptor();
  delete input.profiles[0].nativeActions;
  const legacy = selection();
  delete legacy.nativeActionInterfaceVersions;
  const oldResult = validateProtocolSelection(input, legacy);
  const newResult = validateProtocolSelection(input, selection());
  assert.equal(oldResult.valid, true);
  assert.deepEqual(newResult, oldResult);
  assert.equal(Object.hasOwn(oldResult.profile, 'nativeActions'), false);
  const native = descriptor();
  const selected = validateProtocolSelection(native, selection());
  assert.equal(selected.valid, true);
  native.profiles[0].nativeActions.interfaceVersion = 2;
  assert.equal(selected.profile.nativeActions.interfaceVersion, 1);
  assert.ok(Object.isFrozen(selected.profile.nativeActions));
});

test('unsupported or malformed interface declarations fail without weakening component pins', () => {
  for (const requirement of [null, [], {}, {interfaceVersion: 0}, {interfaceVersion: '1'},
    {interfaceVersion: 1.5}, {interfaceVersion: 2}, {interfaceVersion: 1, executable: true}]) {
    const input = descriptor();
    input.profiles[0].nativeActions = requirement;
    assert.equal(validateProtocolSelection(input, selection()).valid, false);
  }
  for (const versions of [null, '1', [0], [-1], [1.5], ['1'], [1, 1], [65536], new Array(17).fill(1)]) {
    assert.equal(validateProtocolSelection(descriptor(), {...selection(), nativeActionInterfaceVersions: versions}).valid, false);
  }
  const wrongPin = selection();
  wrongPin.components = [{...component, sha256: '2'.repeat(64)}];
  const result = validateProtocolSelection(descriptor(), wrongPin);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'protocol.component-integrity-mismatch'));
});

test('selection does not evaluate inert requirement getters', () => {
  let executions = 0;
  const input = descriptor();
  Object.defineProperty(input.profiles[0].nativeActions, 'interfaceVersion', {enumerable: true, get() {executions++; return 1;}});
  assert.equal(validateProtocolSelection(input, selection()).valid, false);
  assert.equal(executions, 0);
});

test('runtime validation checks agreement without invoking methods and preserves their receiver', () => {
  assert.equal(rootValidator, validateProtocolNativeActions);
  let calls = 0;
  const capability = {interfaceVersion: 1, marker: 7,
    observe() {calls++; assert.equal(this.marker, 7); return observations();},
    decodeValue() {calls++; return this.marker;}, encodeValue() {calls++; return new Uint8Array([this.marker]);}};
  const result = validateProtocolNativeActions(capability, {interfaceVersion: 1});
  assert.equal(result.valid, true);
  assert.equal(calls, 0);
  capability.observe = () => {throw new Error('method replaced');};
  assert.equal(result.nativeActions.observe({}, {}).schemaVersion, 1);
  assert.equal(result.nativeActions.decodeValue('fixture', new Uint8Array()), 7);
  assert.deepEqual(result.nativeActions.encodeValue('fixture', 7), new Uint8Array([7]));
  assert.equal(calls, 3);
  assert.ok(Object.isFrozen(result.nativeActions));
});

test('missing methods, incompatible runtime versions and accessor methods fail before decoding', () => {
  let executions = 0;
  const capability = {interfaceVersion: 1, observe() {}, decodeValue() {}, encodeValue() {}};
  for (const input of [null, {}, {...capability, interfaceVersion: 2},
    {...capability, observe: null}, {...capability, decodeValue: undefined}, {...capability, encodeValue: 1}]) {
    assert.equal(validateProtocolNativeActions(input, {interfaceVersion: 1}).valid, false);
  }
  const getter = {...capability};
  Object.defineProperty(getter, 'decodeValue', {get() {executions++; return () => 7;}});
  assert.equal(validateProtocolNativeActions(getter, {interfaceVersion: 1}).valid, false);
  assert.equal(executions, 0);
  assert.equal(validateProtocolNativeActions(capability, {interfaceVersion: 2}).valid, false);
});

test('detached per-origin decisions round-trip as immutable data with no authority claim', () => {
  const input = observations();
  const result = validateProtocolNativeActionObservations(input);
  assert.equal(result.valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.observations)), input);
  input.decisions[1].origin.rawSha256 = 'd'.repeat(64);
  input.decisions[2].error.message = 'changed';
  assert.equal(result.observations.decisions[1].origin.rawSha256, 'c'.repeat(64));
  assert.equal(result.observations.decisions[2].error.message, 'Source needs a supported verifier');
  for (const value of [result.observations, result.observations.decisions,
    result.observations.decisions[1], result.observations.decisions[1].origin, result.observations.decisions[2].error]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.equal(Object.hasOwn(result.observations, 'canonical'), false);
  assert.equal(validateProtocolNativeActionObservations({schemaVersion: 1, decisions: []}).valid, true);
});

test('origins must be exact-shaped unique anchors with lowercase digests and safe ordinals', () => {
  for (const patch of [{transactionId: 'B'.repeat(64)}, {transactionId: 'bad'}, {actionOrdinal: 0},
    {actionOrdinal: 1.5}, {actionOrdinal: Number.MAX_SAFE_INTEGER + 1}, {rawSha256: 'C'.repeat(64)},
    {rawSha256: 'bad'}, {inputActionOrdinal: 1}, {receiver: 'notification'}]) {
    const input = observations();
    Object.assign(input.decisions[0].origin, patch);
    checkInvalid(input);
  }
  const input = observations();
  input.decisions.push({...input.decisions[0]});
  checkInvalid(input);
});

test('unknown decision fields, incompatible variants and malformed reasons fail closed', () => {
  for (const decision of [
    {origin: origin(1), kind: 'native'}, {origin: origin(1), kind: 'contract', nativeKind: 'hidden'},
    {origin: origin(1), kind: 'unknown'}, {origin: origin(1), kind: 'incomplete', error: {code: '', message: 'x'}},
    {origin: origin(1), kind: 'incomplete', error: {code: 'x', message: 'x', ready: true}},
    {origin: origin(1), kind: 'native', nativeKind: ''}, {origin: origin(1), kind: 'native', nativeKind: '\ud800'},
    {origin: origin(1), kind: 'native', nativeKind: 'x'.repeat(protocolNativeActionBounds.kindCharacters + 1)},
  ]) checkInvalid({schemaVersion: 1, decisions: [decision]});
  checkInvalid({...observations(), ready: true});
  checkInvalid({...observations(), schemaVersion: 2});
});

test('observation accessors, sparse arrays, symbols and cycles cannot execute source-like data', () => {
  let executions = 0;
  const input = observations();
  Object.defineProperty(input.decisions[0], 'origin', {enumerable: true, get() {executions++; return origin(1);}});
  checkInvalid(input);
  const sparse = observations();
  delete sparse.decisions[0];
  checkInvalid(sparse);
  const symbol = observations();
  symbol.decisions[0][Symbol('claim')] = true;
  checkInvalid(symbol);
  const cyclic = observations();
  cyclic.decisions[0].origin = cyclic;
  checkInvalid(cyclic);
  assert.equal(executions, 0);
});

test('decision and aggregate text limits bound malformed observation work', () => {
  checkInvalid({schemaVersion: 1, decisions: new Array(protocolNativeActionBounds.decisions + 1).fill(null)});
  const message = 'x'.repeat(protocolNativeActionBounds.messageCharacters);
  checkInvalid({schemaVersion: 1, decisions: Array.from({length: 17_000}, (_, index) => ({
    origin: origin(index + 1), kind: 'incomplete', error: {code: 'unsupported', message},
  }))});
});

test('unreadable records cannot supply executable error diagnostics', () => {
  let executions = 0;
  const foreignError = Object.defineProperty({}, 'code', {get() {executions++; throw new Error('foreign diagnostic getter');}});
  const trapped = new Proxy({}, {ownKeys() {throw foreignError;}});
  checkInvalid(trapped);
  assert.equal(validateProtocolNativeActions(trapped, {interfaceVersion: 1}).valid, false);
  assert.equal(executions, 0);
});

test('a synthetic native codec preserves exact bytes independently of any contract ABI', () => {
  let contractReads = 0;
  const bytes = new Uint8Array([0x34, 0x12]);
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  const codec = {interfaceVersion: 1,
    observe(input, source) {
      assert.equal(input.schemaJson, 'original handshake');
      assert.deepEqual(input.block, new Uint8Array([7]));
      assert.deepEqual(input.traces, bytes);
      assert.equal(source.blockNum, 12);
      return {schemaVersion: 1, decisions: [{origin: {...origin(2), rawSha256}, kind: 'native', nativeKind: 'fixture-envelope-v1'}]};
    },
    decodeValue(kind, input) {
      if (kind !== 'fixture-envelope-v1' || input.length !== 2) throw new Error('unsupported native bytes');
      return {sample: input[0] | input[1] << 8};
    },
    encodeValue(kind, value) {
      if (kind !== 'fixture-envelope-v1' || !Number.isInteger(value.sample) || value.sample < 0 || value.sample > 65535) {
        throw new Error('unsupported native value');
      }
      return new Uint8Array([value.sample & 255, value.sample >>> 8]);
    }};
  const provider = {nativeActions: codec, get contractCodec() {contractReads++; throw new Error('ABI accessed');}};
  const checked = validateProtocolNativeActions(provider.nativeActions, {interfaceVersion: 1});
  assert.equal(checked.valid, true);
  const native = checked.nativeActions;
  const facts = native.observe({schemaJson: 'original handshake', block: new Uint8Array([7]), traces: bytes}, {blockNum: 12});
  assert.equal(validateProtocolNativeActionObservations(facts).valid, true);
  const value = native.decodeValue('fixture-envelope-v1', bytes);
  assert.deepEqual(value, {sample: 4660});
  assert.deepEqual(native.encodeValue('fixture-envelope-v1', value), bytes);
  for (const bad of [bytes.subarray(0, 1), new Uint8Array([...bytes, 0])]) {
    assert.throws(() => native.decodeValue('fixture-envelope-v1', bad));
  }
  assert.equal(contractReads, 0);
});
