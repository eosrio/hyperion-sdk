import {canonicalStructuredJsonRecord, validateStructuredInteger} from './internal/structured-values.js';
import {captureOriginalTableIdentity, type OriginalTableIdentity} from './internal/stateful-input-v2.js';
import {StatefulContractError} from './projection-stateful.js';
import {isCapturedStatefulDeclaration} from './internal/stateful-ownership.js';
import type {StatefulDeclaration, StatefulInput, StatefulLimits, StatefulSource} from './stateful-types.js';
export type {OriginalTableIdentity} from './internal/stateful-input-v2.js';

/** Opt-in original input representation; the existing v1 input and capture stay closed. */
export interface StatefulActionAuthorizationV1 {readonly actor: string; readonly permission: string}
/** Present only in the explicitly selected original-action metadata source variant. */
export const STATEFUL_ACTION_AUTHORIZATION_CAPABILITY_V1 = 'original-action-authorization-v1' as const;
export interface StatefulActionMetadataOptionsV2 {readonly actionMetadataVersion?: 1}
export type StatefulInputV2 = (Extract<StatefulInput, {kind: 'action'}> & {
    readonly authorization?: readonly StatefulActionAuthorizationV1[];
  })
  | (Omit<Extract<StatefulInput, {kind: 'table'}>, 'scope' | 'primaryKey'> & {
    readonly identity: OriginalTableIdentity;
    /** Actual original payer; null means the selected protocol explicitly has no payer field. */
    readonly payer: string | null;
  });
export interface StatefulSourceV2 extends Omit<StatefulSource, 'inputs'>, StatefulActionMetadataOptionsV2 {
  readonly inputs: readonly StatefulInputV2[];
}
/** The owning version2 family validates/negotiates its entire wrapper, not this structural subset. */
export interface StatefulSourceDeclarationV2 {
  readonly projection: StatefulDeclaration;
  readonly sourceInputVersion: 2;
  readonly digest: string;
}
export interface CapturedStatefulSourceV2 {
  readonly declarationDigest: string;
  readonly sourceInputVersion: 2;
  readonly source: StatefulSourceV2;
  readonly digest: string;
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new StatefulContractError('stateful.invalid-contract', message);
}
function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'Expected inert source record');
  const properties = Object.getOwnPropertyDescriptors(value);
  check(Object.getOwnPropertySymbols(value).length === 0 && Object.keys(properties).length === names.length
    && names.every(name => properties[name]?.enumerable && Object.hasOwn(properties[name]!, 'value')), 'Unexpected source fields/accessors');
}
function hash(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Expected exact source digest');
}
function count(value: unknown, minimum = 0): asserts value is number {
  check(Number.isSafeInteger(value) && Number(value) >= minimum, 'Expected source occurrence coordinate');
}
/** Capability selection only; neither metadata nor this result grants source or serving authority. */
export function negotiateStatefulActionMetadataV2(required: unknown, supported: unknown): StatefulActionMetadataOptionsV2 {
  const list = (value: unknown): string[] => {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
      && Object.getOwnPropertySymbols(value).length === 0 && value.length <= 1, 'Invalid action metadata capabilities');
    const properties = Object.getOwnPropertyDescriptors(value);
    check(Object.keys(properties).length === value.length + 1, 'Invalid action metadata capability fields');
    return Array.from({length: value.length}, (_, index) => {
      const property = properties[String(index)];
      check(property?.enumerable && Object.hasOwn(property, 'value')
        && property.value === STATEFUL_ACTION_AUTHORIZATION_CAPABILITY_V1, 'Unknown action metadata capability');
      return property.value as string;
    });
  };
  const needs = list(required), available = list(supported);
  check(needs.every(name => available.includes(name)), 'Original action authorization capability unavailable');
  return Object.freeze(needs.length ? {actionMetadataVersion: 1 as const} : {});
}
function point(value: unknown): asserts value is StatefulSource['previous'] {
  fields(value, ['blockNum', 'blockId']); count(value.blockNum); hash(value.blockId);
  if (value.blockNum === 0) check(value.blockId === '0'.repeat(64), 'Source genesis differs');
}
function canonical(value: unknown, limits: StatefulLimits) {
  return canonicalStructuredJsonRecord(value, [], {...limits.envelope,
    recordBytes: Math.min(limits.envelope.recordBytes, limits.candidateBytes)});
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
function projection(input: StatefulSourceDeclarationV2): {projection: StatefulDeclaration; wrapperDigest: string} {
  check(input !== null && typeof input === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(input)), 'Expected source declaration');
  // Read only inert required members. The owner family checks the full wrapper and its digest.
  const properties = Object.getOwnPropertyDescriptors(input);
  for (const name of ['projection', 'sourceInputVersion', 'digest'])
    check(properties[name]?.enumerable && Object.hasOwn(properties[name]!, 'value'), 'Source declaration accessor/missing field');
  check(properties.sourceInputVersion!.value === 2, 'Original source version2 must be explicitly selected');
  hash(properties.digest!.value);
  const supplied = properties.projection!.value;
  check(isCapturedStatefulDeclaration(supplied), 'Recapture the immutable projection declaration before source use');
  return {projection: supplied, wrapperDigest: properties.digest!.value as string};
}

/**
 * Pure capture only. No filter, chronology, ABI authority or serving permission is manufactured.
 * Hosts supply all matching original occurrences in their established order and retain absent scope
 * as an actual KV variant, never an empty scoped-row substitute.
 */
export async function captureStatefulSourceV2(declaration: StatefulSourceDeclarationV2, input: unknown): Promise<CapturedStatefulSourceV2> {
  const context = projection(declaration), selected = context.projection, limits = selected.limits;
  const source = canonical(input, limits).value as unknown as StatefulSourceV2;
  const actionMetadata = Object.hasOwn(source, 'actionMetadataVersion');
  fields(source, ['previous', 'block', 'inputs', ...(actionMetadata ? ['actionMetadataVersion'] : [])]);
  if (actionMetadata) check(source.actionMetadataVersion === 1, 'Unsupported original action metadata version');
  point(source.previous);
  fields(source.block, ['blockNum', 'blockId', 'previousBlockId', 'timeMs']);
  count(source.block.blockNum, 1); hash(source.block.blockId); hash(source.block.previousBlockId);
  validateStructuredInteger(source.block.timeMs, 'uint64');
  check(source.block.blockNum === source.previous.blockNum + 1
    && source.block.previousBlockId === source.previous.blockId, 'Noncontiguous original source');
  check(Array.isArray(source.inputs) && source.inputs.length <= limits.inputOccurrences, 'Original occurrence bound');
  let rawBytes = 0;
  const seen = new Set<string>();
  for (const [index, occurrence] of source.inputs.entries()) {
    const common = ['selector', 'order', 'kind', 'contract', 'name', 'abiDeployment', 'abiSha256',
      'mappingRevision', 'codecRevision', 'normalizerRevision', 'rawHex', 'rawSha256', 'sourceEvidence', 'transactionId', 'data'];
    fields(occurrence, [...common, ...(occurrence.kind === 'action'
      ? ['actionOrdinal', 'receiver', 'receiptOrdinal', 'sequence', ...(actionMetadata ? ['authorization'] : [])]
      : ['identity', 'payer', 'present', 'deltaOrdinal', 'rowOrdinal'])]);
    const selector = selected.definition.selectors.find(value => value.id === occurrence.selector);
    check(selector && selector.kind === occurrence.kind && selector.contract === occurrence.contract
      && selector.name === occurrence.name, 'Undeclared original selector');
    check(occurrence.order === index && occurrence.abiDeployment === selector.abiDeployment
      && occurrence.abiSha256 === selector.abiSha256
      && occurrence.mappingRevision === selected.definition.binding.mappingRevision
      && occurrence.codecRevision === selected.definition.binding.codecRevision
      && occurrence.normalizerRevision === selected.definition.binding.normalizerRevision, 'Original occurrence/ABI epoch differs');
    hash(occurrence.rawSha256); hash(occurrence.sourceEvidence);
    check(typeof occurrence.rawHex === 'string' && /^(?:[0-9a-f]{2})*$/.test(occurrence.rawHex), 'Original row/action bytes required');
    rawBytes += occurrence.rawHex.length / 2; check(rawBytes <= limits.inputBytes, 'Original input byte bound');
    const raw = Uint8Array.from(occurrence.rawHex.match(/../g) ?? [], value => parseInt(value, 16));
    check(await digest(raw) === occurrence.rawSha256, 'Original raw payload hash differs');
    let original: unknown;
    if (occurrence.kind === 'action') {
      hash(occurrence.transactionId); count(occurrence.actionOrdinal, 1); count(occurrence.receiptOrdinal);
      check(typeof occurrence.receiver === 'string' && occurrence.receiver.length > 0
        && new TextEncoder().encode(occurrence.receiver).length <= limits.keyBytes, 'Original receiver bound');
      if (occurrence.sequence !== null) validateStructuredInteger(occurrence.sequence, 'uint64');
      check(occurrence.data !== null && typeof occurrence.data === 'object' && !Array.isArray(occurrence.data), 'Original action data required');
      if (actionMetadata) {
        check(Array.isArray(occurrence.authorization), 'Original action authorization is absent');
        for (const permission of occurrence.authorization) {
          fields(permission, ['actor', 'permission']);
          for (const value of [permission.actor, permission.permission])
            check(typeof value === 'string' && value.length > 0
              && new TextEncoder().encode(value).length <= limits.keyBytes, 'Original authorization name bound');
        }
      }
      original = ['action', occurrence.transactionId, occurrence.receiver, occurrence.actionOrdinal, occurrence.receiptOrdinal];
    } else {
      check(occurrence.kind === 'table' && typeof occurrence.present === 'boolean', 'Original table presence required');
      if (occurrence.transactionId !== null) hash(occurrence.transactionId);
      check(occurrence.payer === null || typeof occurrence.payer === 'string'
        && new TextEncoder().encode(occurrence.payer).length <= limits.keyBytes, 'Original payer bound');
      count(occurrence.deltaOrdinal); count(occurrence.rowOrdinal);
      const identity = captureOriginalTableIdentity(occurrence.identity, limits);
      if (identity.kind === 'contract-row')
        for (const text of [identity.scope, identity.primaryKey])
          check(new TextEncoder().encode(text).length <= limits.keyBytes, 'Original scope/key bound');
      if (identity.kind === 'kv-secondary')
        check(occurrence.data === null, 'Physical secondary index has no contract row value');
      else if (occurrence.present || occurrence.data !== null)
        check(occurrence.data !== null && typeof occurrence.data === 'object' && !Array.isArray(occurrence.data), 'Original table data required');
      // One physical delta-row coordinate cannot be relabelled through another selector or identity.
      original = ['table', occurrence.deltaOrdinal, occurrence.rowOrdinal];
    }
    const key = JSON.stringify(original); check(!seen.has(key), 'Duplicate original occurrence'); seen.add(key);
  }
  const body = {declarationDigest: context.wrapperDigest, sourceInputVersion: 2 as const, source};
  // Reserve the digest member before hashing; the receiving owner validates the same capture bytes.
  canonical({...body, digest: '0'.repeat(64)}, limits);
  return canonical({...body, digest: await digest(new TextEncoder().encode(canonical(body, limits).canonical))}, limits)
    .value as unknown as CapturedStatefulSourceV2;
}
