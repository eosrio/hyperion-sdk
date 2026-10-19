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
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer);
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
  // No @types/node dependency is needed by the consumer; declarations must be independently usable.
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict',
    '--target', 'ES2022', '--module', 'NodeNext', '--resolveJsonModule', 'consumer.mts'], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(consumer, 'consumer.mjs')], { cwd: consumer, stdio: 'inherit' });
  console.log('Packed ESM, JSON Schema and TypeScript consumer passed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
