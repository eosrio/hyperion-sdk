import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCompatibility } from '@eosrio/hyperion-sdk';

const adapter = {
  schemaVersion: 1,
  package: '@example/mongo-adapter',
  version: '2.0.0-dev.1',
  kind: 'backend-adapter',
  compatibility: {
    hyperion: '^4.5.0', sdk: '^1.0.0',
    engines: [{ name: 'mongodb', range: '>=7.0.0 <9.0.0' }],
  },
};

test('adapter eligibility checks the engine independently from the adapter package version', () => {
  assert.deepEqual(checkCompatibility(adapter, {
    hyperion: '4.5.1', sdk: '1.1.0', engines: { mongodb: '8.0.1' },
  }), { compatible: true, errors: [] });
  const result = checkCompatibility(adapter, {
    hyperion: '4.5.1', sdk: '1.1.0', engines: { mongodb: '6.0.0' },
  });
  assert.equal(result.compatible, false);
  assert.equal(result.errors[0].code, 'compatibility.out-of-range');
  assert.equal(result.errors[0].path, '/environment/engines/mongodb');
});

test('missing, malformed and incompatible installed versions produce actionable diagnostics', () => {
  const result = checkCompatibility(adapter, { hyperion: '5.0.0', sdk: '^1.0.0' });
  assert.equal(result.compatible, false);
  assert.deepEqual(result.errors.map(error => [error.code, error.path]), [
    ['compatibility.out-of-range', '/environment/hyperion'],
    ['compatibility.invalid-version', '/environment/sdk'],
    ['compatibility.missing-version', '/environment/engines/mongodb'],
  ]);
  assert.equal(checkCompatibility(adapter, null).errors[0].code, 'compatibility.invalid-environment');
  assert.equal(checkCompatibility(adapter, { hyperion: '4.5.0', sdk: '1.0.0', engines: [] })
    .errors[0].code, 'compatibility.invalid-engines');
  assert.equal(checkCompatibility({}, {}).errors[0].path, '/manifest');
});

test('all declared engines are required, and inherited engine properties are not installed versions', () => {
  const manifest = { ...adapter, compatibility: { ...adapter.compatibility,
    engines: [...adapter.compatibility.engines, { name: 'custom-db', range: '2.x' }] } };
  const environment = { hyperion: '4.5.0', sdk: '1.0.0', engines: { mongodb: '8.0.0', 'custom-db': '2.1.0' } };
  assert.equal(checkCompatibility(manifest, environment).compatible, true);
  delete environment.engines['custom-db'];
  assert.equal(checkCompatibility(manifest, environment).errors[0].path, '/environment/engines/custom-db');
  assert.equal(checkCompatibility(adapter, { ...environment, engines: Object.create({ mongodb: '8.0.0' }) })
    .errors[0].code, 'compatibility.missing-version');
});

test('standard prerelease rules require an explicit matching prerelease range', () => {
  const environment = { hyperion: '4.5.0-dev.1', sdk: '1.0.0-dev.1', engines: { mongodb: '8.0.0' } };
  assert.equal(checkCompatibility(adapter, environment).compatible, false);
  const development = { ...adapter, compatibility: { ...adapter.compatibility,
    hyperion: '^4.5.0-dev.1', sdk: '^1.0.0-dev.1' } };
  assert.equal(checkCompatibility(development, environment).compatible, true);
  assert.equal(checkCompatibility(development, { ...environment, hyperion: '4.6.0-dev.1' }).compatible, false);
});

test('standard range forms are accepted without treating a range as qualification evidence', () => {
  for (const range of ['4.5.x', '4.5.0 - 4.6.0', '~4.5.0', '^4.0.0 || ^5.0.0', '>=4.5.0 <5.0.0']) {
    const manifest = { ...adapter, compatibility: { ...adapter.compatibility, hyperion: range } };
    assert.deepEqual(checkCompatibility(manifest, { hyperion: '4.5.1', sdk: '1.0.0', engines: { mongodb: '8.0.0' } }),
      { compatible: true, errors: [] });
  }
});

test('supplied engine versions must be exact even when the component does not require them', () => {
  const plugin = { ...adapter, kind: 'plugin', compatibility: { hyperion: '^4.5.0', sdk: '^1.0.0' } };
  const result = checkCompatibility(plugin, { hyperion: '4.5.0', sdk: '1.0.0', engines: { mongodb: '^8.0.0' } });
  assert.equal(result.compatible, false);
  assert.equal(result.errors[0].code, 'compatibility.invalid-version');
  assert.equal(result.errors[0].path, '/environment/engines/mongodb');
});
