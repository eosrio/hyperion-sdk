import assert from 'node:assert/strict';
import test from 'node:test';
import {captureStatefulDeclaration, negotiateStatefulProjection} from '../dist/projection-stateful.js';
import {isCapturedStatefulDeclaration, isNegotiatedStatefulDeclaration} from '../dist/internal/stateful-ownership.js';
import {caps, definition, host, limits} from './fixtures/stateful-reference.mjs';

test('private declaration ownership rejects DTOs before any projection field access', async () => {
  let reads = 0;
  const foreign = Object.defineProperty({}, 'definition', {get() {reads++; throw new Error('Getter executed');}});
  assert.equal(isCapturedStatefulDeclaration(foreign), false);
  assert.equal(isCapturedStatefulDeclaration(null), false);
  assert.equal(isCapturedStatefulDeclaration(undefined), false);
  assert.equal(reads, 0);
  const declaration = await captureStatefulDeclaration(definition(), limits());
  assert.equal(isCapturedStatefulDeclaration(declaration), true);
  assert.equal(isNegotiatedStatefulDeclaration(declaration), false);
  assert.equal(isCapturedStatefulDeclaration(structuredClone(declaration)), false);
  const negotiated = await negotiateStatefulProjection(definition(), limits(), host(limits()), caps(limits()));
  assert.equal(isCapturedStatefulDeclaration(negotiated), true);
  assert.equal(isNegotiatedStatefulDeclaration(negotiated), true);
  assert.deepEqual(negotiated, declaration, 'Registry ownership cannot alter v1 captured bytes');
});
