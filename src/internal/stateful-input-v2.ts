import {canonicalStructuredJsonRecord} from './structured-values.js';
import type {StatefulLimits, StatefulView} from '../stateful-types.js';

/** Private proposed-v2 capture primitives. No package export, storage or execution authority. */
export type OriginalTableIdentity =
  | {readonly kind: 'contract-row'; readonly scope: string; readonly primaryKey: string}
  | {readonly kind: 'kv-primary'; readonly tableId: number; readonly keyHex: string}
  | {readonly kind: 'kv-secondary'; readonly tableId: number; readonly secondaryKeyHex: string; readonly primaryKeyHex: string};
export interface RawStatefulTarget {
  readonly schemaVersion: 2;
  readonly chainId: string;
  readonly declarationDigest: string;
  readonly owner: {readonly id: string; readonly generation: string};
  readonly previous: StatefulView;
  readonly block: {readonly blockNum: number; readonly blockId: string; readonly previousBlockId: string};
  readonly rawSource: {readonly selectionId: string; readonly observationId: string;
    readonly observationDigest: string; readonly captureSha256: string; readonly frameSha256: string};
}
export interface CapturedRawStatefulTarget {readonly target: RawStatefulTarget; readonly digest: string}
type ObjectData = Record<string, unknown>;
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
function object(value: unknown): asserts value is ObjectData {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected original input object');
}
function keys(value: ObjectData, expected: readonly string[]): void {
  check(Object.keys(value).length === expected.length && expected.every(name => Object.hasOwn(value, name)), 'Unexpected original input fields');
}
function hash(value: unknown): asserts value is string {check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Expected exact digest');}
function text(value: unknown, empty = false): asserts value is string {
  // The enclosing inert capture already checks well-formed Unicode without invoking accessors.
  check(typeof value === 'string' && (empty || value.length > 0), 'Expected original text');
}
function count(value: unknown, minimum: number): asserts value is number {check(Number.isSafeInteger(value) && Number(value) >= minimum, 'Expected original integer');}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function inert(input: unknown, limits: StatefulLimits): unknown {
  const captured = canonicalStructuredJsonRecord(input, [], {...limits.envelope,
    recordBytes: Math.min(limits.envelope.recordBytes, limits.candidateBytes)});
  return freeze(JSON.parse(captured.canonical));
}
function bytes(value: unknown, limits: StatefulLimits): asserts value is string {
  check(typeof value === 'string' && /^(?:[0-9a-f]{2})*$/.test(value)
    && value.length / 2 <= limits.inputBytes, 'Expected bounded original key bytes');
}

/** Preserve actual identity; this shape check neither decodes source nor invents a missing scope. */
export function captureOriginalTableIdentity(input: unknown, limits: StatefulLimits): OriginalTableIdentity {
  const value = inert(input, limits); object(value);
  if (value.kind === 'contract-row') {
    keys(value, ['kind', 'scope', 'primaryKey']); text(value.scope, true); text(value.primaryKey);
  } else {
    check(value.kind === 'kv-primary' || value.kind === 'kv-secondary', 'Unknown original table identity');
    keys(value, value.kind === 'kv-primary' ? ['kind', 'tableId', 'keyHex'] : ['kind', 'tableId', 'secondaryKeyHex', 'primaryKeyHex']);
    // Wire's offered profile is bound to uint16 in node source, serialization and captured SHiP ABI.
    count(value.tableId, 0); check(value.tableId <= 65535, 'Physical table ID exceeds offered uint16 profile');
    if (value.kind === 'kv-primary') bytes(value.keyHex, limits);
    else {bytes(value.secondaryKeyHex, limits); bytes(value.primaryKeyHex, limits);}
  }
  return value as unknown as OriginalTableIdentity;
}

/** Known canonical target reference before decoding. Host/store checks still own every grant. */
export async function captureRawStatefulTarget(input: unknown, limits: StatefulLimits): Promise<CapturedRawStatefulTarget> {
  const value = inert(input, limits); object(value);
  keys(value, ['schemaVersion', 'chainId', 'declarationDigest', 'owner', 'previous', 'block', 'rawSource']);
  check(value.schemaVersion === 2, 'Raw target requires explicitly selected schema version2');
  hash(value.chainId); hash(value.declarationDigest);
  object(value.owner); keys(value.owner, ['id', 'generation']); text(value.owner.id); text(value.owner.generation);
  object(value.previous); keys(value.previous, ['declarationDigest', 'backendId', 'generation', 'revision', 'checkpoint']);
  check(value.previous.declarationDigest === value.declarationDigest, 'Raw target declaration differs');
  text(value.previous.backendId); text(value.previous.generation); hash(value.previous.revision);
  object(value.previous.checkpoint); keys(value.previous.checkpoint, ['blockNum', 'blockId']);
  count(value.previous.checkpoint.blockNum, 0); hash(value.previous.checkpoint.blockId);
  if (value.previous.checkpoint.blockNum === 0) check(value.previous.checkpoint.blockId === '0'.repeat(64), 'Raw target genesis differs');
  object(value.block); keys(value.block, ['blockNum', 'blockId', 'previousBlockId']);
  count(value.block.blockNum, 1); hash(value.block.blockId); hash(value.block.previousBlockId);
  check(value.block.blockNum === value.previous.checkpoint.blockNum + 1
    && value.block.previousBlockId === value.previous.checkpoint.blockId, 'Raw target is not checkpoint+1');
  object(value.rawSource); keys(value.rawSource, ['selectionId', 'observationId', 'observationDigest', 'captureSha256', 'frameSha256']);
  text(value.rawSource.selectionId); text(value.rawSource.observationId);
  hash(value.rawSource.observationDigest); hash(value.rawSource.captureSha256); hash(value.rawSource.frameSha256);
  const raw = new TextEncoder().encode(canonicalStructuredJsonRecord(value, [], {...limits.envelope,
    recordBytes: Math.min(limits.envelope.recordBytes, limits.candidateBytes)}).canonical);
  const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', raw)), byte => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({target: value as unknown as RawStatefulTarget, digest});
}
