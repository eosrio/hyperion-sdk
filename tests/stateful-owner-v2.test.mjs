import assert from 'node:assert/strict';
import test from 'node:test';
import * as v1 from '../dist/projection-stateful.js';
import * as owner from '../dist/projection-stateful-owner-v2.js';
import {captureStatefulSourceV2} from '../dist/projection-stateful-source-v2.js';
import {definition, limits, source, hex} from './fixtures/stateful-reference.mjs';

const offer = supported => ({family: owner.STATEFUL_OWNER_FAMILY_V2, interfaceVersion: 2,
  sourceInputVersions: [2], supported, limits: limits()});
async function prepared() {
  const projection = await v1.captureStatefulDeclaration(definition(), limits());
  const declaration = await owner.negotiateStatefulOwnerV2(projection,
    offer(owner.STATEFUL_OWNER_HOST_CAPABILITIES_V2), offer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2));
  return {projection, declaration};
}

test('owner family explicitly negotiates source2 without adopting a copied or v1 declaration', async () => {
  const {projection, declaration} = await prepared();
  assert.equal(declaration.interfaceVersion, 2); assert.equal(declaration.sourceInputVersion, 2);
  assert.equal(declaration.projection, projection); assert.notEqual(declaration.digest, projection.digest);
  assert.equal(Object.isFrozen(declaration), true);
  await assert.rejects(owner.captureStatefulOwnerDeclarationV2(structuredClone(projection), 2), /Recapture/);
  await assert.rejects(owner.captureStatefulOwnerDeclarationV2(projection, 1), /version2/);
  await assert.rejects(owner.negotiateStatefulOwnerV2(projection,
    {...offer(owner.STATEFUL_OWNER_HOST_CAPABILITIES_V2), sourceInputVersions: [1]},
    offer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2)), /source.*version|capabilit/i);
  const received = await owner.receiveStatefulOwnerDeclarationV2(structuredClone(declaration));
  assert.deepEqual(received, declaration);
  const original = source(projection, 1, hex(1), {blockNum: 0, blockId: hex(0)}, []);
  const captured = await captureStatefulSourceV2(received, original);
  assert.equal(captured.declarationDigest, declaration.digest);
  await assert.rejects(v1.executeStatefulBlock(projection, original, {}, {}, async () => {}, () => {}), /negotiation/);
});

test('raw capture admits exact original references and checkpoint+1 without a decoded source digest', async () => {
  const {declaration} = await prepared();
  const previous = {declarationDigest: declaration.digest, backendId: declaration.projection.definition.binding.backendId,
    generation: declaration.projection.definition.binding.generation, revision: hex(11), checkpoint: {blockNum: 0, blockId: hex(0)}};
  const target = {schemaVersion: 2, chainId: declaration.projection.definition.binding.chainId,
    declarationDigest: declaration.digest, owner: {id: 'worker', generation: 'generation-one'}, previous,
    block: {blockNum: 1, blockId: hex(1), previousBlockId: hex(0)}, rawSource: {
      commitId: 'h45abicmt1:' + hex(2), selectionId: 'h45srcsel1:' + hex(3),
      observationId: 'h45abi1:' + hex(4), observationDigest: hex(5)}};
  const captured = await owner.captureStatefulRawTargetV2(declaration, target);
  assert.deepEqual(captured.target, target); assert.equal(Object.hasOwn(captured.target, 'sourceDigest'), false);
  assert.equal(Object.isFrozen(captured.target.rawSource), true);
  await assert.rejects(owner.captureStatefulRawTargetV2(declaration,
    {...target, block: {...target.block, blockNum: 2}}), /checkpoint\+1/);
  await assert.rejects(owner.captureStatefulRawTargetV2(declaration,
    {...target, previous: {...previous, declarationDigest: hex(9)}}));
});

const current = declaration => ({declarationDigest: declaration.digest, backendId: declaration.projection.definition.binding.backendId,
  generation: declaration.projection.definition.binding.generation, revision: hex(11), checkpoint: {blockNum: 0, blockId: hex(0)}});
test('API-local capability acquired just as owner authority closes is always retired before rejection', async () => {
  const {declaration} = await prepared(); let live = true, closed = 0, composed = 0;
  const cap = {}, adapter = {capabilities: offer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2),
    async completedRead() {live = false; return cap;}, closeRead(value) {assert.equal(value, cap); closed++;}};
  await assert.rejects(owner.composeStatefulOwnerReadV2(declaration, adapter, {id: 'worker', generation: 'one'}, current(declaration),
    async () => {composed++; return {};}, () => {if (!live) throw new Error('actual owner changed');}), /actual owner changed/);
  assert.equal(closed, 1); assert.equal(composed, 0);
});
test('late private reduction capability is closed on a post-await fence before hooks', async () => {
  const {declaration} = await prepared(), view = current(declaration); let live = true, closed = 0, hooks = 0, retains = 0;
  const cap = {}, adapter = {capabilities: offer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2), async bindSource() {},
    async inspectOwned() {return {phase: 'bound', status: 'new', targetDigest: hex(8), sourceDigest: null, candidateDigest: null, progress: view};},
    async reductionRead() {live = false; return cap;}, closeRead(value) {assert.equal(value, cap); closed++;}};
  await assert.rejects(owner.executeStatefulOwnerBlockV2(declaration, adapter, {}, hex(8),
    {previous: view.checkpoint, block: {blockNum: 1, blockId: hex(1), previousBlockId: hex(0), timeMs: '1'}, inputs: []},
    {load: async () => null, retain: async () => {retains++;}}, async () => {hooks++;},
    () => {if (!live) throw new Error('actual owner changed');}), /actual owner changed/);
  assert.equal(closed, 1); assert.equal(hooks, 0); assert.equal(retains, 0);
});
test('v2 execution refuses pending identity/custody mismatch before hooks or apply', async () => {
  const {declaration} = await prepared(), view = current(declaration); let hooks = 0, applied = 0;
  const adapter = {capabilities: offer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2), async bindSource() {},
    async inspectOwned() {return {phase: 'pending', status: 'pending', targetDigest: hex(8), sourceDigest: hex(2), candidateDigest: hex(3), progress: view};},
    async applyOwned() {applied++;}};
  await assert.rejects(owner.executeStatefulOwnerBlockV2(declaration, adapter, {}, hex(8),
    {previous: view.checkpoint, block: {blockNum: 1, blockId: hex(1), previousBlockId: hex(0), timeMs: '1'}, inputs: []},
    {load: async () => null}, async () => {hooks++;}, () => {}), /Original pending candidate/);
  assert.equal(hooks, 0); assert.equal(applied, 0);
});
test('foreign source version and malformed recovery do not become portable authority', async () => {
  const {declaration} = await prepared(), view = current(declaration);
  const state = {interfaceVersion: 2, sourceInputVersion: 2, version: hex(1), view, initialized: true,
    owner: {identity: {id: 'worker', generation: 'one'}, claimDigest: hex(2)}, raw: null, pending: null, gap: null, rollback: null,
    coverage: {floor: view.checkpoint, retainedBlocks: 0, retainedBytes: 0, maxBlocks: 4, maxBytes: 10000}};
  assert.equal((await owner.captureStatefulOwnerRecoveryV2(declaration, state)).sourceInputVersion, 2);
  await assert.rejects(owner.captureStatefulOwnerRecoveryV2(declaration, {...state, sourceInputVersion: 1}), /version/);
  await assert.rejects(owner.captureStatefulOwnerRecoveryV2(declaration, {...state, pending: {sourceDigest: hex(1), candidateDigest: hex(2)}}), /raw slot/);
  await assert.rejects(owner.captureStatefulOwnerRecoveryV2(declaration, {...state, coverage: {...state.coverage, retainedBlocks: 1}}), /coverage/);
  await assert.rejects(owner.negotiateStatefulOwnerV2(declaration.projection,
    {...offer(owner.STATEFUL_OWNER_HOST_CAPABILITIES_V2), sourceInputVersions: null}, offer(owner.STATEFUL_OWNER_ADAPTER_CAPABILITIES_V2)), /version/);
});
test('independent SDK module capture stays foreign to canonical v1 and owner-v2 handles', async () => {
  const independent = await import('../dist/projection-stateful.js?owner-v2-independent-control');
  const foreign = await independent.captureStatefulDeclaration(definition(), limits());
  assert.throws(() => v1.canonicalStatefulRecord(foreign, 'asset', {}), /Recapture/);
  await assert.rejects(owner.captureStatefulOwnerDeclarationV2(foreign, 2), /Recapture/);
  await assert.rejects(captureStatefulSourceV2({projection: foreign, sourceInputVersion: 2, digest: hex(90)}, {}), /Recapture/);
});
