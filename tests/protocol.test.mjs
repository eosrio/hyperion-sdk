import assert from 'node:assert/strict';
import test from 'node:test';
import {validateProtocolSelection} from '@eosrio/hyperion-sdk/protocol';
import {validateProtocolSelection as rootValidator, validateComponentManifest} from '@eosrio/hyperion-sdk';

const revision = 'a'.repeat(40);
const component = runtime => ({id: 'wire-codec', runtime, version: '0.0.0-dev.1', sourceRevision: revision,
  sha256: (runtime === 'node' ? '1' : '2').repeat(64)});
const descriptor = () => ({interfaceVersion: 1,
  manifest: {schemaVersion: 1, package: '@example/wire', version: '0.0.0-dev.1', kind: 'protocol',
    compatibility: {hyperion: '^4.5.0-dev.1', sdk: '^0.0.0-dev.1'}},
  profiles: [{id: 'wire-engineering-v1', components: [component('node'), component('rust')]}]});
const selection = () => ({profileId: 'wire-engineering-v1', environment: {hyperion: '4.5.0-dev.1', sdk: '0.0.0-dev.1'},
  components: [component('node'), component('rust')]});
const rejects = (input, selected, code) => {
  const result = validateProtocolSelection(input, selected);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result));
  assert.ok(result.errors.every(error => typeof error.path === 'string' && error.message));
};

test('additive root and protocol exports retain existing metadata behavior', () => {
  assert.equal(rootValidator, validateProtocolSelection);
  assert.equal(validateComponentManifest(descriptor().manifest).valid, true);
  assert.equal(validateProtocolSelection(descriptor(), selection()).valid, true);
});

test('selection requires the entire declared Node/Rust set, including offline components', () => {
  const installed = selection();
  installed.components = [component('node')];
  rejects(descriptor(), installed, 'protocol.missing-component');
  assert.equal(validateProtocolSelection(descriptor(), selection()).valid, true);
});

test('versions, exact source and build identity independently gate activation', () => {
  for (const [field, value, code] of [
    ['version', '0.0.0-dev.2', 'protocol.component-version-mismatch'],
    ['sourceRevision', 'b'.repeat(40), 'protocol.component-source-mismatch'],
    ['sha256', 'f'.repeat(64), 'protocol.component-integrity-mismatch'],
  ]) {
    const actual = selection();
    actual.components[0][field] = value;
    rejects(descriptor(), actual, code);
  }
});

test('unselected and unknown profiles cannot silently select the first declared profile', () => {
  rejects(descriptor(), {...selection(), profileId: 'unknown'}, 'protocol.unknown-profile');
  rejects(descriptor(), {...selection(), profileId: ''}, 'protocol.invalid-descriptor');
});

test('invalid profiles, duplicate identities and missing pins fail explicitly', () => {
  const duplicate = descriptor();
  duplicate.profiles.push(structuredClone(duplicate.profiles[0]));
  rejects(duplicate, selection(), 'protocol.duplicate-profile');
  const repeatedComponent = descriptor();
  repeatedComponent.profiles[0].components.push(component('node'));
  rejects(repeatedComponent, selection(), 'protocol.duplicate-component');
  const actual = selection();
  actual.components.push(component('rust'));
  rejects(descriptor(), actual, 'protocol.duplicate-component');
  for (const field of ['version', 'sourceRevision', 'sha256']) {
    const input = descriptor();
    delete input.profiles[0].components[0][field];
    rejects(input, selection(), 'protocol.invalid-descriptor');
  }
});

test('unsupported descriptor versions, unknown fields and incompatible metadata fail', () => {
  for (const input of [null, [], {}, {...descriptor(), interfaceVersion: 2}, {...descriptor(), executable: 'addon.node'}]) {
    rejects(input, selection(), 'protocol.invalid-descriptor');
  }
  const wrongKind = descriptor();
  wrongKind.manifest.kind = 'plugin';
  rejects(wrongKind, selection(), 'protocol.invalid-descriptor');
  rejects(descriptor(), {...selection(), environment: {hyperion: '4.4.0', sdk: '0.0.0-dev.1'}}, 'compatibility.out-of-range');
  rejects(descriptor(), {...selection(), environment: {hyperion: '4.5.0-dev.1'}}, 'compatibility.missing-version');
});

test('diagnostic paths distinguish descriptor requirements from installed environment', () => {
  const input = descriptor();
  input.manifest.compatibility.sdk = 'bad range';
  let result = validateProtocolSelection(input, selection());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path.startsWith('/descriptor/manifest')));
  result = validateProtocolSelection(descriptor(), {...selection(), environment: {hyperion: '4.4.0', sdk: '0.0.0-dev.1'}});
  assert.ok(result.errors.some(error => error.path === '/selection/environment/hyperion'));
});

test('successful selection is an immutable snapshot independent of later caller mutations', () => {
  const input = descriptor();
  const actual = selection();
  const result = validateProtocolSelection(input, actual);
  assert.equal(result.valid, true);
  input.profiles[0].components[0].sourceRevision = 'b'.repeat(40);
  actual.components[0].sha256 = '3'.repeat(64);
  input.manifest.compatibility.sdk = '^9.0.0';
  assert.equal(result.profile.components[0].sourceRevision, revision);
  assert.equal(result.descriptor.manifest.compatibility.sdk, '^0.0.0-dev.1');
  for (const value of [result.descriptor, result.descriptor.manifest, result.descriptor.manifest.compatibility,
    result.descriptor.profiles, result.profile, result.profile.components, result.profile.components[0]]) assert.ok(Object.isFrozen(value));
  assert.throws(() => {result.profile.components[0].sha256 = '3'.repeat(64);}, TypeError);
});

test('metadata validation does not call accessors or toJSON functions', () => {
  let executions = 0;
  const input = descriptor();
  Object.defineProperty(input, 'manifest', {enumerable: true, get() {executions++; throw new Error('executed');}});
  rejects(input, selection(), 'protocol.invalid-descriptor');
  const functionInput = descriptor();
  functionInput.toJSON = () => {executions++; return descriptor();};
  rejects(functionInput, selection(), 'protocol.invalid-descriptor');
  assert.equal(executions, 0);
});

test('malformed, cyclic and sparse metadata are bounded validation failures', () => {
  const cycle = descriptor();
  cycle.profiles[0].components[0].extra = cycle;
  const sparse = descriptor();
  delete sparse.profiles[0].components[0];
  for (const input of [cycle, sparse, {...descriptor(), profiles: new Array(65)},
    {...descriptor(), manifest: new Date()}, {...descriptor(), interfaceVersion: NaN}]) {
    rejects(input, selection(), 'protocol.invalid-descriptor');
  }
});
