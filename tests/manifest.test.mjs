import assert from 'node:assert/strict';
import test from 'node:test';
import { validateComponentManifest } from '@eosrio/hyperion-sdk';

const plugin = {
  schemaVersion: 1,
  package: '@example/assets',
  version: '0.1.0-dev.1',
  kind: 'plugin',
  compatibility: { hyperion: '^4.5.0', sdk: '^0.0.0-dev.1' },
};

test('catalog consumers can validate a portable plugin manifest without executing it', () => {
  assert.equal(validateComponentManifest(plugin).valid, true);
});

test('protocol providers use the same core and SDK compatibility declaration', () => {
  assert.equal(validateComponentManifest({ ...plugin, kind: 'protocol' }).valid, true);
});

test('schema rejects malformed versions, unknown fields and unsupported manifest versions', () => {
  for (const manifest of [
    null, {}, { ...plugin, schemaVersion: 2 }, { ...plugin, kind: 'sdk' },
    { ...plugin, version: '^1.0.0' }, { ...plugin, version: 'v1.0.0' },
    { ...plugin, version: '1.2.3 ' }, { ...plugin, execute: './plugin.js' },
    { ...plugin, package: '../plugin' },
    { ...plugin, compatibility: { hyperion: 'banana', sdk: '^1.0.0' } },
    { ...plugin, compatibility: { hyperion: '^4.5.0', sdk: '' } },
    { ...plugin, compatibility: { hyperion: '^4.5.0' } },
  ]) {
    const result = validateComponentManifest(manifest);
    assert.equal(result.valid, false, JSON.stringify(manifest));
    assert.ok(result.errors.every(error => error.code && typeof error.path === 'string' && error.message));
  }
  assert.equal(validateComponentManifest({ ...plugin, version: '1.2.3+build.42' }).valid, true);
});

test('engine requirements belong to adapters and must be present and uniquely named', () => {
  const engines = [{ name: 'custom-db', range: '^2.0.0' }];
  const compatibility = { ...plugin.compatibility, engines };
  assert.equal(validateComponentManifest({ ...plugin, compatibility }).valid, false);
  assert.equal(validateComponentManifest({ ...plugin, kind: 'backend-adapter' }).valid, false);
  assert.equal(validateComponentManifest({ ...plugin, kind: 'backend-adapter', compatibility }).valid, true);
  for (const invalid of [[], [{ name: '', range: '^1.0.0' }], [{ name: 'mongodb', range: '' }],
    [{ name: 'mongodb', range: '^7.0.0' }, { name: 'mongodb', range: '^8.0.0' }]]) {
    assert.equal(validateComponentManifest({ ...plugin, kind: 'backend-adapter',
      compatibility: { ...plugin.compatibility, engines: invalid } }).valid, false);
  }
});
