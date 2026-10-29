import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {captureStatefulDeclaration, captureStatefulSource} from '../dist/projection-stateful.js';
import {captureStatefulSourceV2} from '../dist/projection-stateful-source-v2.js';
import {definition, limits, source, hex} from './fixtures/stateful-reference.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function prepared(bounds = limits()) {
  const projection = await captureStatefulDeclaration(definition(), bounds);
  const declaration = {projection, sourceInputVersion: 2, digest: hex(90)};
  const input = source(projection, 1, hex(1), {blockNum: 0, blockId: hex(0)},
    [['setdata', {value: 'a\0b', exact: '18446744073709551615'}], ['schema', {format: []}],
      ['collection', {name: 'collection'}], ['config', {version: 'constructed'}]]);
  const identities = [{kind: 'contract-row', scope: 'collection', primaryKey: '9007199254740993'},
    {kind: 'kv-primary', tableId: 0, keyHex: '000001'},
    {kind: 'kv-secondary', tableId: 65535, secondaryKeyHex: '', primaryKeyHex: '0000'}];
  let table = 0;
  input.inputs = input.inputs.map(occurrence => {
    if (occurrence.kind === 'action') return occurrence;
    const {scope, primaryKey, ...original} = occurrence;
    const identity = identities[table++];
    return {...original, identity, payer: 'fixturepayer', ...(identity.kind === 'kv-secondary' ? {data: null} : {})};
  });
  return {projection, declaration, input};
}

test('v2 capture preserves every original identity/occurrence and has a distinct versioned digest', async () => {
  const {declaration, input} = await prepared(), saved = structuredClone(input);
  const captured = await captureStatefulSourceV2(declaration, input);
  assert.deepEqual(JSON.parse(JSON.stringify(captured.source)), saved);
  assert.equal(captured.sourceInputVersion, 2); assert.equal(captured.declarationDigest, declaration.digest);
  assert.equal(captured.source.inputs[0].data.value, 'a\0b');
  assert.equal(captured.source.inputs[0].data.exact, '18446744073709551615');
  assert.equal(Object.isFrozen(captured.source.inputs[3].identity), true);
  assert.equal(captured.source.inputs[3].present, true); assert.equal(captured.source.inputs[3].data, null);
  assert.equal(Object.hasOwn(captured.source.inputs[2].identity, 'scope'), false);
  assert.equal(captured.source.inputs[2].payer, 'fixturepayer');
  assert.equal(captured.digest, (await captureStatefulSourceV2(declaration, saved)).digest);
  const changed = structuredClone(saved); changed.inputs[2].identity.keyHex = '01';
  assert.notEqual((await captureStatefulSourceV2(declaration, changed)).digest, captured.digest);
  assert.notEqual((await captureStatefulSourceV2({...declaration, digest: hex(91)}, saved)).digest, captured.digest);
});

test('original scoped rows stay explicit; empty source scope is distinct from absent KV scope', async () => {
  const {declaration, input} = await prepared();
  input.inputs[1].identity = {kind: 'contract-row', scope: '', primaryKey: '0'};
  input.inputs[2].identity = {kind: 'kv-primary', tableId: 65535, keyHex: ''};
  const captured = await captureStatefulSourceV2(declaration, input);
  assert.equal(captured.source.inputs[1].identity.scope, '');
  assert.equal(captured.source.inputs[2].identity.keyHex, '');
  assert.equal(Object.hasOwn(captured.source.inputs[2].identity, 'scope'), false);
  for (const identity of [{kind: 'contract-row', primaryKey: '0'},
    {kind: 'kv-primary', tableId: 0, keyHex: '', scope: ''},
    {kind: 'kv-primary', tableId: 65536, keyHex: ''},
    {kind: 'kv-secondary', tableId: 0, keyHex: ''}]) {
    const changed = structuredClone(input); changed.inputs[1].identity = identity;
    await assert.rejects(captureStatefulSourceV2(declaration, changed));
  }
});

test('v1 inputs and capture bytes are unchanged; neither input format silently substitutes for the other', async () => {
  const {projection, declaration, input} = await prepared();
  const original = source(projection, 1, hex(1), {blockNum: 0, blockId: hex(0)}, [['setdata', {value: 'original'}], ['schema', {format: []}]]);
  const before = await captureStatefulSource(projection, original);
  await assert.rejects(captureStatefulSourceV2(declaration, original));
  await assert.rejects(captureStatefulSource(projection, input));
  const after = await captureStatefulSource(projection, original);
  assert.equal(after.digest, before.digest); assert.deepEqual(after, before);
  await assert.rejects(captureStatefulSourceV2({...declaration, sourceInputVersion: 1}, input));
  await assert.rejects(captureStatefulSourceV2({...declaration, projection: structuredClone(projection)}, input), /Recapture/);
});

test('source snapshot and wrapper digest detach before the first hashing await', async () => {
  const {declaration, input} = await prepared(), saved = structuredClone(input), expectedDigest = declaration.digest;
  const work = captureStatefulSourceV2(declaration, input);
  input.inputs[2].identity.keyHex = '01'; input.inputs[0].data.value = 'later'; declaration.digest = hex(99);
  const captured = await work;
  assert.deepEqual(JSON.parse(JSON.stringify(captured.source)), saved);
  assert.equal(captured.declarationDigest, expectedDigest);
  assert.equal(captured.digest, (await captureStatefulSourceV2({...declaration, digest: expectedDigest}, saved)).digest);
});

test('missing fields, order/epoch/raw mismatches and invented secondary values refuse', async () => {
  const {declaration, input} = await prepared();
  for (const change of [value => delete value.inputs[0].receiptOrdinal,
    value => value.inputs[1].order = 0, value => value.inputs[1].abiSha256 = hex(99),
    value => value.inputs[1].mappingRevision = hex(99), value => value.block.timeMs = '01',
    value => value.block.previousBlockId = hex(99), value => value.inputs[2].rawSha256 = hex(99),
    value => value.inputs[2].identity.keyHex = '0', value => value.inputs[2].identity.keyHex = '0A',
    value => value.inputs[2].scope = '', value => delete value.inputs[3].identity.primaryKeyHex,
    value => value.inputs[3].data = {}, value => delete value.inputs[2].payer,
    value => value.inputs[2].payer = 0]) {
    const changed = structuredClone(input); change(changed);
    await assert.rejects(captureStatefulSourceV2(declaration, changed));
  }
});

test('physical row/action duplication is rejected even when another selector or key is used', async () => {
  const {declaration, input} = await prepared();
  const duplicatedRow = structuredClone(input);
  duplicatedRow.inputs[2].deltaOrdinal = duplicatedRow.inputs[1].deltaOrdinal;
  duplicatedRow.inputs[2].rowOrdinal = duplicatedRow.inputs[1].rowOrdinal;
  await assert.rejects(captureStatefulSourceV2(declaration, duplicatedRow), /Duplicate original occurrence/);
  const duplicatedAction = structuredClone(input);
  duplicatedAction.inputs.push({...structuredClone(duplicatedAction.inputs[0]), order: 4});
  await assert.rejects(captureStatefulSourceV2(declaration, duplicatedAction), /Duplicate original occurrence/);
});

test('source/identity accessors never run and existing configured input/record/key bounds apply', async () => {
  const {declaration, input} = await prepared();
  let invoked = 0;
  const accessor = structuredClone(input);
  Object.defineProperty(accessor.inputs[2].identity, 'keyHex', {enumerable: true, get() {invoked++; return '00';}});
  await assert.rejects(captureStatefulSourceV2(declaration, accessor)); assert.equal(invoked, 0);
  const badDeclaration = {...declaration};
  Object.defineProperty(badDeclaration, 'projection', {enumerable: true, get() {invoked++; return declaration.projection;}});
  await assert.rejects(captureStatefulSourceV2(badDeclaration, input)); assert.equal(invoked, 0);
  for (const change of [bounds => bounds.inputOccurrences = 1, bounds => bounds.inputBytes = 1]) {
    const bounds = limits(); change(bounds);
    const preparedSmall = await prepared(bounds);
    await assert.rejects(captureStatefulSourceV2(preparedSmall.declaration, preparedSmall.input));
  }
  const keyBounds = limits(); keyBounds.keyBytes = 24;
  const keyCase = await prepared(keyBounds);
  keyCase.input.inputs[1].identity.scope = 'x'.repeat(25);
  await assert.rejects(captureStatefulSourceV2(keyCase.declaration, keyCase.input), /scope\/key bound/);
  const deleted = structuredClone(input); deleted.inputs[2].present = false; deleted.inputs[2].data = null;
  const captured = await captureStatefulSourceV2(declaration, deleted);
  assert.equal(captured.source.inputs[2].data, null);
  assert.equal(captured.source.inputs[2].rawSha256, sha(Buffer.from(deleted.inputs[2].rawHex, 'hex')));
});
