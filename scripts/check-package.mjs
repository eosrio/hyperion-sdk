// Exercise the packed package from a separate consumer, including exported TypeScript declarations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'hyperion-sdk-consumer-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run test:package');
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  runNpm(['pack', '--pack-destination', temporary], root);
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'sdk-consumer', private: true, type: 'module' }));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true, 'Foundation remains unpublished development work');
  const tarball = join(temporary, `eosrio-hyperion-sdk-${pkg.version}.tgz`);
  runNpm(['install', '--no-audit', '--no-fund', tarball], consumer);
  await writeFile(join(consumer, 'consumer.mts'), `
import { validateComponentManifest, checkCompatibility, type ComponentManifest } from '@eosrio/hyperion-sdk';
import { validateProtocolSelection, type ProtocolProvider, type ProtocolDescriptor, type ProtocolNormalizedDelta } from '@eosrio/hyperion-sdk/protocol';
import schema from '@eosrio/hyperion-sdk/component-manifest.schema.json' with { type: 'json' };
const manifest = { schemaVersion: 1, package: '@example/plugin', version: '0.1.0', kind: 'plugin',
  compatibility: { hyperion: '^4.5.0', sdk: '^0.0.0-dev.1' } } satisfies ComponentManifest;
if (!validateComponentManifest(manifest).valid) throw new Error('Packed manifest validator failed');
if (!checkCompatibility(manifest, { hyperion: '4.5.0', sdk: '0.0.0-dev.1' }).compatible) throw new Error('Packed compatibility check failed');
if (schema.properties.schemaVersion.const !== 1) throw new Error('Packed schema missing');
const component = {id:'example', runtime:'node' as const, version:'0.1.0', sourceRevision:'a'.repeat(40), sha256:'1'.repeat(64)};
const descriptor = {interfaceVersion:1, manifest:{...manifest, kind:'protocol'},
  profiles:[{id:'example', components:[component]}]} satisfies ProtocolDescriptor;
const result = validateProtocolSelection(descriptor, {profileId:'example',
  environment:{hyperion:'4.5.0', sdk:'0.0.0-dev.1'}, components:[component]});
if (!result.valid) throw new Error('Packed protocol validation failed');
const provider: ProtocolProvider<{version:string}> = {
  profileId: result.profile.id,
  contractCodec: {decodeAbi: () => ({version:'example/1'}), encodeAbi: () => new Uint8Array(),
    decodeValue: () => ({}), encodeValue: () => new Uint8Array()},
  createShipSession: () => ({encodeRequest: () => new Uint8Array(), decodeResult: () => ({}),
    decodeBlock: () => ({}), decodeTraces: () => [], decodeDeltas: () => [], decodeRow: () => ({}), close: () => {}}),
  normalizeDelta: input => ({kind:'passthrough', value:input.value}),
};
if (provider.createShipSession({}).decodeTraces(new Uint8Array()) === undefined) throw new Error('Portable protocol declarations failed');
provider.createShipSession({}).close?.();
const lookup: ProtocolNormalizedDelta = {kind:'abi-required', account:'sysio'};
if (lookup.kind !== 'abi-required' || lookup.account !== 'sysio') throw new Error('ABI lookup request declaration missing');
`);
  await writeFile(join(consumer, 'protocol-abi-observations.mts'),
    await readFile(join(root, 'tests/consumers/protocol-abi-observations.mts'), 'utf8'));
  await writeFile(join(consumer, 'protocol-native-actions.mts'),
    await readFile(join(root, 'tests/consumers/protocol-native-actions.mts'), 'utf8'));
  await writeFile(join(consumer, 'projection.mts'),
    await readFile(join(root, 'tests/consumers/projection.mts'), 'utf8'));
  await writeFile(join(consumer, 'projection-rollback.mts'),
    await readFile(join(root, 'tests/consumers/projection-rollback.mts'), 'utf8'));
  await writeFile(join(consumer, 'projection-recovery.mts'),
    await readFile(join(root, 'tests/consumers/projection-recovery.mts'), 'utf8'));
  await writeFile(join(consumer, 'projection-contextual.mts'),
    await readFile(join(root, 'tests/consumers/projection-contextual.mts'), 'utf8'));
  await writeFile(join(consumer, 'projection-contextual-recovery.mts'),
    await readFile(join(root, 'tests/consumers/projection-contextual-recovery.mts'), 'utf8'));
  await writeFile(join(consumer, 'stateful-projection.mts'),
    await readFile(join(root, 'tests/consumers/stateful-projection.mts'), 'utf8'));
  await writeFile(join(consumer, 'stateful-owner-v2.mts'),
    await readFile(join(root, 'tests/consumers/stateful-owner-v2.mts'), 'utf8'));
  await writeFile(join(consumer, 'stateful-complete-kind.mts'),
    await readFile(join(root, 'tests/consumers/stateful-complete-kind.mts'), 'utf8'));
  await writeFile(join(consumer, 'stateful-runtime.mjs'),
    await readFile(join(root, 'tests/consumers/stateful-projection.mjs'), 'utf8'));
  const reference = await readFile(join(root, 'tests/fixtures/stateful-reference.mjs'), 'utf8');
  const sourceImport = '../../dist/projection-stateful.js';
  assert.equal(reference.split(sourceImport).length, 2, 'One reference adapter import must bind the packed SDK');
  await writeFile(join(consumer, 'stateful-reference.mjs'), reference.replace(sourceImport, '@eosrio/hyperion-sdk/projection-stateful'));
  await mkdir(join(consumer, 'tests/fixtures'), {recursive: true});
  for (const relative of ['stateful-complete-kind.test.mjs', 'fixtures/stateful-complete-kind-reference.mjs', 'fixtures/stateful-reference.mjs',
    'fixtures/stateful-legacy-captures.mjs', 'fixtures/complete-kind-legacy.json']) {
    let content = await readFile(join(root, 'tests', relative), 'utf8');
    content = content.replace('../dist/projection-stateful-owner-v2.js?independent-complete-kind',
      '../node_modules/@eosrio/hyperion-sdk/dist/projection-stateful-owner-v2.js?independent-complete-kind');
    content = content.replaceAll('../../dist/projection-stateful-owner-v2.js', '@eosrio/hyperion-sdk/projection-stateful-owner-v2')
      .replaceAll('../dist/projection-stateful-owner-v2.js', '@eosrio/hyperion-sdk/projection-stateful-owner-v2')
      .replaceAll('../../dist/projection-stateful.js', '@eosrio/hyperion-sdk/projection-stateful')
      .replaceAll('../dist/projection-stateful.js', '@eosrio/hyperion-sdk/projection-stateful');
    content = content.replaceAll('../../dist/projection-stateful-source-v2.js', '@eosrio/hyperion-sdk/projection-stateful-source-v2');
    await writeFile(join(consumer, 'tests', relative), content);
  }
  // No @types/node dependency is needed by the consumer; declarations must be independently usable.
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict',
    '--target', 'ES2022', '--module', 'NodeNext', '--resolveJsonModule', 'consumer.mts',
    'protocol-abi-observations.mts', 'protocol-native-actions.mts', 'projection.mts', 'projection-rollback.mts',
    'projection-recovery.mts', 'projection-contextual.mts', 'projection-contextual-recovery.mts', 'stateful-projection.mts', 'stateful-owner-v2.mts',
    'stateful-complete-kind.mts'], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'consumer.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'protocol-abi-observations.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'protocol-native-actions.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'projection.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'projection-rollback.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'projection-recovery.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'projection-contextual.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'projection-contextual-recovery.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'stateful-projection.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'stateful-runtime.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'stateful-owner-v2.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'stateful-complete-kind.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', join(consumer, 'tests/stateful-complete-kind.test.mjs')], { cwd: consumer, stdio: 'inherit' });
  console.log('Packed ESM, JSON Schema and TypeScript consumer passed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
