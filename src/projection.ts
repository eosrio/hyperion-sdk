import type {Diagnostic} from './manifest.js';

/** Development-only baseline exercised by the first portable table projection. */
export const PROJECTION_CAPABILITIES = Object.freeze([
  'table-fixed-abi', 'genesis-initialization', 'full-put-delete',
  'contiguous-durable-apply', 'conflict-checked-replay', 'checkpoint-read-view',
  'eq-filter', 'keyset-order', 'bounded-count', 'durable-incomplete',
] as const);
export type ProjectionCapability = typeof PROJECTION_CAPABILITIES[number];

export const PROJECTION_LIMITS = Object.freeze({
  fields: 64, pathSegments: 16, keyBytes: 1024, stringBytes: 65536,
  recordBytes: 262144, mutations: 1000, batchBytes: 4194304,
  filterTerms: 16, queryLimit: 1000, queryBytes: 4194304, countUpTo: 100000,
});

export type ProjectionScalar = string | number | boolean | null;
export type ProjectionRecord = Readonly<Record<string, ProjectionScalar>>;
export interface ProjectionField {
  readonly name: string;
  /** Required own-property path in the decoded source row; not a native database path. */
  readonly path: readonly string[];
  readonly type: 'string' | 'boolean' | 'integer' | 'null';
}
export interface ProjectionDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  /** Immutable SHA-256 identifying this off-chain mapping revision. */
  readonly mappingRevision: string;
  readonly source: {
    readonly contract: string;
    readonly table: string;
    readonly abiDeployment: string;
    readonly abiSha256: string;
  };
  readonly fields: readonly ProjectionField[];
  /** This slice requires complete table input coverage from block one. */
  readonly initialization: {readonly kind: 'genesis'};
}
export interface ProjectionBinding {
  readonly chainId: string;
  readonly backendId: string;
  readonly projectionId: string;
  readonly mappingRevision: string;
  readonly abiDeployment: string;
  readonly abiSha256: string;
  /** Runtime-selected immutable instance identity; it is not a mutable progress counter. */
  readonly generation: string;
}
export interface ProjectionCheckpoint {
  readonly blockNum: number;
  readonly blockId: string;
}
export interface ProjectionBlock extends ProjectionCheckpoint {
  readonly previousBlockId: string;
}
export interface ProjectionReadView {
  readonly binding: ProjectionBinding;
  /** Completed progress context; open/query separately enforce current serving readiness. */
  readonly checkpoint: ProjectionCheckpoint;
}
/** Durable source retry identity. A digest is opaque backend-neutral batch evidence. */
export interface ProjectionPendingSource {
  readonly block: ProjectionBlock;
  readonly digest: string | null;
  readonly reason: string | null;
}
/** Recovery inspection is progress evidence only; it is never a serving/readiness grant. */
export interface ProjectionRecoveryView {
  readonly binding: ProjectionBinding;
  readonly checkpoint: ProjectionCheckpoint;
  readonly initialized: boolean;
  readonly pending: ProjectionPendingSource | null;
  readonly gap: ProjectionPendingSource | null;
}
export type ProjectionMutation =
  | {readonly kind: 'put'; readonly key: string; readonly value: ProjectionRecord}
  | {readonly kind: 'delete'; readonly key: string};
export interface ProjectionApplyRequest {
  readonly binding: ProjectionBinding;
  readonly previous: ProjectionCheckpoint;
  readonly block: ProjectionBlock;
  /** Ordered full replacements/deletes. Repeated keys preserve this array's order. */
  readonly mutations: readonly ProjectionMutation[];
}
export interface ProjectionApplyResult {
  readonly status: 'applied' | 'duplicate';
  /**
   * Current durably completed checkpoint, not a readiness/serving grant. Gap recovery may advance
   * contiguous missing blocks while queries remain unavailable; old duplicates never regress it.
   */
  readonly view: ProjectionReadView;
}
export interface ProjectionQuery {
  /** AND of required typed scalar equalities, including explicit null. */
  readonly filter: readonly {readonly field: string; readonly op: 'eq'; readonly value: ProjectionScalar}[];
  /** Exclusive cursor, using the same binary UTF-8 key order as the returned rows. */
  readonly afterKey?: string;
  /** Maximum row count. The 4 MiB page budget may produce a shorter nonempty page. */
  readonly limit: number;
  /** Counts all filter matches, independently of afterKey and limit. Probe upTo + 1. */
  readonly count?: {readonly upTo: number};
}
export interface ProjectionQueryResult {
  readonly view: ProjectionReadView;
  readonly rows: readonly {readonly key: string; readonly value: ProjectionRecord}[];
  /** Present only if another matching row exists after the returned page. */
  readonly nextAfterKey?: string;
  /** exact:false is a lower bound (value === upTo), not a complete count. */
  readonly count?: {readonly value: number; readonly exact: boolean};
}
export interface ProjectionAdapterCapabilities {
  readonly interfaceVersion: 1;
  readonly supported: readonly ProjectionCapability[];
}
export interface ProjectionActivation {
  readonly definition: ProjectionDefinition;
  readonly binding: ProjectionBinding;
  readonly capabilities: ProjectionAdapterCapabilities;
}

/**
 * Native execution belongs to the adapter. Implementations validate all inputs before native I/O.
 * initialize checks capabilities before creating storage; genesis is explicitly {0, zero block ID}.
 * An existing pending instance may throw projection.incomplete only after its immutable definition,
 * binding and storage have been verified, permitting the runtime to attach without a serving view.
 * apply acknowledges only durable effects and recoverable progress, fences incomplete work, and
 * distinguishes retained exact replay from conflict/uncovered replay. open/query reject incomplete
 * or stale views. An old duplicate returns the current completed checkpoint without granting serving
 * readiness. A failed-contract/applying marker requires exact same-source recovery. A durable future
 * source-gap marker allows contiguous missing blocks to complete while queries remain unavailable
 * until the observed target source (and any known batch digest) is successfully replayed.
 * Fork rollback uses the separate opt-in interface below; live activation and arbitrary hooks
 * remain later contracts.
 */
export interface ProjectionAdapter {
  readonly capabilities: ProjectionAdapterCapabilities;
  initialize(definition: ProjectionDefinition, binding: ProjectionBinding,
    genesis: ProjectionCheckpoint): Promise<ProjectionReadView>;
  open(binding: ProjectionBinding): Promise<ProjectionReadView>;
  /**
   * Optional additive inspection for production schedulers. Validate binding/storage integrity
   * and return a detached durable snapshot even when pending work fences open/query. The next
   * source is checkpoint + 1; pending/gap identities constrain exact recovery. Missing storage,
   * corrupt metadata and unavailable durable reads must fail, never return invented progress.
   * Hosts requiring restart recovery reject adapters without this method before activation.
   */
  recovery?(binding: ProjectionBinding): Promise<ProjectionRecoveryView>;
  apply(request: ProjectionApplyRequest): Promise<ProjectionApplyResult>;
  markIncomplete(binding: ProjectionBinding, failedBlock: ProjectionBlock, reason: string): Promise<void>;
  query(view: ProjectionReadView, query: ProjectionQuery): Promise<ProjectionQueryResult>;
}

/** Explicitly opted-in recovery interface; the existing v1 capability baseline is unchanged. */
export const PROJECTION_ROLLBACK_CAPABILITIES = Object.freeze([
  ...PROJECTION_CAPABILITIES, 'fork-rollback',
] as const);
export type ProjectionRollbackCapability = typeof PROJECTION_ROLLBACK_CAPABILITIES[number];
export const PROJECTION_ROLLBACK_LIMITS = Object.freeze({
  maxSteps: 256, retainedBlocks: 4096, retainedBytes: 1073741824,
});
export interface ProjectionRollbackAdapterCapabilities {
  readonly interfaceVersion: 2;
  readonly supported: readonly ProjectionRollbackCapability[];
}
export interface ProjectionRollbackActivation {
  readonly definition: ProjectionDefinition;
  readonly binding: ProjectionBinding;
  readonly capabilities: ProjectionRollbackAdapterCapabilities;
}
export interface ProjectionRollbackReadView extends ProjectionReadView {
  /** Opaque persisted fence, separate from the immutable binding generation. */
  readonly revision: string;
}
export interface ProjectionRollbackCoverage {
  /** Oldest exact ancestor reachable using the actually retained contiguous undo window. */
  readonly floor: ProjectionCheckpoint;
  readonly retainedBlocks: number;
  /** Adapter-documented encoded undo bytes, including block descriptors. */
  readonly retainedBytes: number;
  readonly maxBlocks: number;
  readonly maxBytes: number;
}
export interface ProjectionRollbackState {
  readonly operationId: string;
  /** Fence supplied when this recovery operation was first admitted. */
  readonly sourceRevision: string;
  readonly from: ProjectionCheckpoint;
  readonly ancestor: ProjectionCheckpoint;
  readonly status: 'running' | 'complete' | 'unavailable';
  readonly reason: string | null;
}
/** Inspection is never a serving grant, including after a completed rollback operation. */
export interface ProjectionRollbackRecoveryView extends ProjectionRecoveryView {
  readonly revision: string;
  readonly coverage: ProjectionRollbackCoverage;
  /** Includes the last completed operation so a lost response cannot repeat its effects. */
  readonly rollback: ProjectionRollbackState | null;
}
export interface ProjectionRollbackApplyRequest {
  readonly revision: string;
  readonly batch: ProjectionApplyRequest;
}
export interface ProjectionRollbackApplyResult {
  readonly status: 'applied' | 'duplicate';
  readonly view: ProjectionRollbackReadView;
}
export interface ProjectionRollbackIncompleteRequest {
  readonly binding: ProjectionBinding;
  readonly revision: string;
  readonly block: ProjectionBlock;
  readonly reason: string;
}
export interface ProjectionRollbackRequest {
  readonly binding: ProjectionBinding;
  readonly revision: string;
  readonly operationId: string;
  /** Exact expected completed checkpoint when admitting a new operation. */
  readonly from: ProjectionCheckpoint;
  readonly ancestor: ProjectionCheckpoint;
  /** Per-call work budget, excluded from the durable operation identity. */
  readonly maxBlocks: number;
}
export interface ProjectionRollbackResult {
  readonly status: 'in-progress' | 'rolled-back' | 'duplicate';
  readonly recovery: ProjectionRollbackRecoveryView;
}
export interface ProjectionRollbackQueryResult {
  readonly view: ProjectionRollbackReadView;
  readonly rows: ProjectionQueryResult['rows'];
  readonly nextAfterKey?: string;
  readonly count?: {readonly value: number; readonly exact: boolean};
}
/**
 * Separate opt-in interface: existing v1 objects and validators keep their exact contract.
 * Activating this interface on existing storage durably rejects unfenced v1 access to that instance;
 * it never invents inverse effects for previously applied blocks. Coverage starts at the actual
 * completed checkpoint. Every state-changing operation, including failure/source-gap admission,
 * checks the caller's revision. open/query require a matching revision and exact checkpoint.
 *
 * The runtime selects canonical ancestry, quiesces its local owner and supplies a stable operation
 * ID. Before undo starts, the adapter durably rotates the revision and records the exact operation,
 * fencing all earlier writers/read views. Each rollback call undoes at most maxBlocks complete
 * source blocks, preserving effects/checkpoint/undo progress atomically. Exact original-operation
 * retries resume with its sourceRevision; a completed retry returns duplicate without undoing a
 * subsequently applied replacement branch. A later recovery may supersede the retained operation
 * receipt; an older request then fails its revision check, never starts again implicitly.
 *
 * An exact ancestor equal to from may cancel orphan pending/gap work and rotate the revision even
 * when no effects need undo. Wrong branch identity or unavailable older coverage durably leaves the
 * affected instance incomplete before throwing projection.rollback-unavailable. Unavailable undo
 * is not permission to skip effects or advance completed progress. Historical replay/reinitialization
 * requires separately qualified sources. initialize/open/query do not expose partial rollback state.
 * Native undo layout and durability execution belong to adapters, not projection plugins.
 */
export interface ProjectionRollbackAdapter {
  readonly capabilities: ProjectionRollbackAdapterCapabilities;
  initialize(definition: ProjectionDefinition, binding: ProjectionBinding,
    genesis: ProjectionCheckpoint): Promise<ProjectionRollbackReadView>;
  open(binding: ProjectionBinding): Promise<ProjectionRollbackReadView>;
  recovery(binding: ProjectionBinding): Promise<ProjectionRollbackRecoveryView>;
  apply(request: ProjectionRollbackApplyRequest): Promise<ProjectionRollbackApplyResult>;
  markIncomplete(request: ProjectionRollbackIncompleteRequest): Promise<void>;
  rollback(request: ProjectionRollbackRequest): Promise<ProjectionRollbackResult>;
  query(view: ProjectionRollbackReadView, query: ProjectionQuery): Promise<ProjectionRollbackQueryResult>;
}

export type ProjectionErrorCode =
  | 'projection.invalid-contract' | 'projection.capability-unavailable'
  | 'projection.not-initialized' | 'projection.incomplete' | 'projection.stale-view'
  | 'projection.conflicting-replay' | 'projection.source-gap'
  | 'projection.replay-unavailable' | 'projection.apply-unavailable'
  | 'projection.stale-revision' | 'projection.rollback-unavailable';
export class ProjectionContractError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: ProjectionErrorCode, message: string) {
    super(message);
    this.name = 'ProjectionContractError';
    this.retryable = ['projection.not-initialized', 'projection.incomplete', 'projection.stale-view',
      'projection.replay-unavailable', 'projection.apply-unavailable',
      'projection.stale-revision', 'projection.rollback-unavailable'].includes(code);
  }
}
export type ProjectionValidationResult<T> =
  | {valid: true; value: T}
  | {valid: false; errors: Diagnostic[]};

const encoder = new TextEncoder();
const sha256 = /^[0-9a-f]{64}$/;
const fieldName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const forbiddenPath = new Set(['__proto__', 'prototype', 'constructor']);
const pointer = (part: string): string => part.replace(/~/g, '~0').replace(/\//g, '~1');
const diagnostics = new WeakMap<object, Diagnostic>();

function fail(path: string, message: string, code = 'projection.invalid-contract'): never {
  const error = new Error(message);
  diagnostics.set(error, {code, path, message});
  throw error;
}
function caught(error: unknown): Diagnostic {
  return (typeof error === 'object' && error !== null ? diagnostics.get(error) : undefined)
    ?? {code: 'projection.invalid-contract', path: '', message: 'Expected bounded, plain JSON data'};
}
function check(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) fail(path, message);
}
function record(input: unknown, path: string): Record<string, unknown> {
  check(typeof input === 'object' && input !== null && !Array.isArray(input), path, 'Expected an object');
  return input as Record<string, unknown>;
}
function keys(input: Record<string, unknown>, required: readonly string[], optional: readonly string[] = [], path = ''): void {
  for (const key of required) check(Object.hasOwn(input, key), `${path}/${pointer(key)}`, 'Required property is missing');
  for (const key of Object.keys(input)) check(required.includes(key) || optional.includes(key), `${path}/${pointer(key)}`, 'Unknown property');
}
function wellFormed(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function string(input: unknown, path: string, maxBytes = 256, empty = false): asserts input is string {
  check(typeof input === 'string' && (empty || input.length > 0) && input.length <= maxBytes
    && wellFormed(input) && encoder.encode(input).length <= maxBytes, path, `Expected well-formed UTF-8 text within ${maxBytes} bytes`);
}
function hash(input: unknown, path: string): void {
  check(typeof input === 'string' && sha256.test(input), path, 'Expected lowercase hexadecimal SHA-256 identity');
}
function integer(input: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): asserts input is number {
  check(typeof input === 'number' && Number.isSafeInteger(input) && input >= min && input <= max,
    path, `Expected a safe integer in [${min}, ${max}]`);
}

/** Copy inert JSON without invoking getters/toJSON, with explicit traversal and memory bounds. */
function snapshot(input: unknown, path = '', depth = 0,
  budget = {nodes: 200000, bytes: PROJECTION_LIMITS.batchBytes}, ancestors = new Set<object>()): unknown {
  if (--budget.nodes < 0 || depth > 32) fail(path, 'Input traversal budget exceeded');
  if (input === null || typeof input === 'boolean') {budget.bytes -= 5; return input;}
  if (typeof input === 'number') {
    integer(input, path, -Number.MAX_SAFE_INTEGER);
    budget.bytes -= 24;
    return Object.is(input, -0) ? 0 : input;
  }
  if (typeof input === 'string') {
    string(input, path, PROJECTION_LIMITS.batchBytes, true);
    budget.bytes -= encoder.encode(input).length + 2;
    if (budget.bytes < 0) fail(path, 'Input byte budget exceeded');
    return input;
  }
  check(typeof input === 'object' && input !== null, path, 'Expected plain JSON data');
  check(!ancestors.has(input), path, 'Cyclic input is unsupported');
  const array = Array.isArray(input);
  const prototype = Object.getPrototypeOf(input);
  check(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    path, 'Expected a plain JSON object or array');
  check(Object.getOwnPropertySymbols(input).length === 0, path, 'Symbol properties are unsupported');
  if (array) check(input.length <= budget.nodes, path, 'Array traversal budget exceeded');
  ancestors.add(input);
  const output: unknown[] | Record<string, unknown> = array ? [] : Object.create(null) as Record<string, unknown>;
  const properties = Object.getOwnPropertyDescriptors(input);
  for (const [key, property] of Object.entries(properties)) {
    if (array && key === 'length') continue;
    check(property.enumerable && Object.hasOwn(property, 'value'), path, 'Expected enumerable data properties');
    string(key, path, 1024, true);
    if (array) check(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < input.length, path, 'Expected array elements');
    budget.bytes -= encoder.encode(key).length + 3;
    if (budget.bytes < 0) fail(path, 'Input byte budget exceeded');
    const child = snapshot(property.value, `${path}/${pointer(key)}`, depth + 1, budget, ancestors);
    Object.defineProperty(output, key, {value: child, enumerable: true, configurable: true, writable: true});
  }
  if (array) check(Object.keys(output).length === input.length, path, 'Sparse arrays are unsupported');
  ancestors.delete(input);
  return output;
}
function freeze<T>(input: T): T {
  if (typeof input === 'object' && input !== null) {
    for (const child of Object.values(input)) freeze(child);
    Object.freeze(input);
  }
  return input;
}
function canonical(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
  if (typeof input === 'object' && input !== null) return `{${Object.keys(input).sort()
    .map(key => `${JSON.stringify(key)}:${canonical((input as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(input);
}
function validating<T>(input: unknown, validate: (copy: unknown) => void): ProjectionValidationResult<T> {
  try {
    const copy = snapshot(input);
    validate(copy);
    check(encoder.encode(canonical(copy)).length <= PROJECTION_LIMITS.batchBytes, '', 'Canonical input byte budget exceeded');
    return {valid: true, value: freeze(copy as T)};
  } catch (error) {
    return {valid: false, errors: [caught(error)]};
  }
}

function definitionShape(input: unknown, path = ''): void {
  const value = record(input, path);
  keys(value, ['schemaVersion', 'id', 'mappingRevision', 'source', 'fields', 'initialization'], [], path);
  check(value.schemaVersion === 1, `${path}/schemaVersion`, 'Expected definition schemaVersion 1');
  string(value.id, `${path}/id`, 128);
  hash(value.mappingRevision, `${path}/mappingRevision`);
  const source = record(value.source, `${path}/source`);
  keys(source, ['contract', 'table', 'abiDeployment', 'abiSha256'], [], `${path}/source`);
  for (const key of ['contract', 'table', 'abiDeployment']) string(source[key], `${path}/source/${key}`);
  hash(source.abiSha256, `${path}/source/abiSha256`);
  check(Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= PROJECTION_LIMITS.fields,
    `${path}/fields`, `Expected 1 to ${PROJECTION_LIMITS.fields} field declarations`);
  const names = new Set<string>();
  for (const [i, inputField] of value.fields.entries()) {
    const fieldPath = `${path}/fields/${i}`;
    const field = record(inputField, fieldPath);
    keys(field, ['name', 'path', 'type'], [], fieldPath);
    check(typeof field.name === 'string' && fieldName.test(field.name) && !forbiddenPath.has(field.name), `${fieldPath}/name`, 'Expected a safe logical field identifier');
    check(!names.has(field.name), `${fieldPath}/name`, 'Duplicate logical field');
    names.add(field.name);
    check(Array.isArray(field.path) && field.path.length > 0 && field.path.length <= PROJECTION_LIMITS.pathSegments,
      `${fieldPath}/path`, 'Expected 1 to 16 own-property path segments');
    for (const [j, part] of field.path.entries()) {
      string(part, `${fieldPath}/path/${j}`, 128);
      check(!forbiddenPath.has(part), `${fieldPath}/path/${j}`, 'Prototype traversal is unsupported');
    }
    check(['string', 'boolean', 'integer', 'null'].includes(field.type as string), `${fieldPath}/type`, 'Unsupported scalar type');
  }
  const initialization = record(value.initialization, `${path}/initialization`);
  keys(initialization, ['kind'], [], `${path}/initialization`);
  check(initialization.kind === 'genesis', `${path}/initialization/kind`, 'Only genesis initialization is implemented');
}
function bindingShape(input: unknown, definition?: ProjectionDefinition, path = ''): void {
  const value = record(input, path);
  keys(value, ['chainId', 'backendId', 'projectionId', 'mappingRevision', 'abiDeployment', 'abiSha256', 'generation'], [], path);
  for (const key of ['chainId', 'mappingRevision', 'abiSha256']) hash(value[key], `${path}/${key}`);
  for (const key of ['backendId', 'projectionId', 'abiDeployment', 'generation']) string(value[key], `${path}/${key}`);
  if (definition) for (const [key, expected] of [['projectionId', definition.id], ['mappingRevision', definition.mappingRevision],
    ['abiDeployment', definition.source.abiDeployment], ['abiSha256', definition.source.abiSha256]] as const) {
    check(value[key] === expected, `${path}/${key}`, 'Binding differs from the fixed definition');
  }
}
function checkpointShape(input: unknown, path = '', block = false): void {
  const value = record(input, path);
  keys(value, block ? ['blockNum', 'blockId', 'previousBlockId'] : ['blockNum', 'blockId'], [], path);
  integer(value.blockNum, `${path}/blockNum`, block ? 1 : 0);
  hash(value.blockId, `${path}/blockId`);
  if (block) hash(value.previousBlockId, `${path}/previousBlockId`);
  else if (value.blockNum === 0) check(value.blockId === '0'.repeat(64), `${path}/blockId`, 'Genesis checkpoint requires zero block ID');
}
function scalarShape(input: unknown, path: string, type?: ProjectionField['type']): void {
  if (input === null) check(type === undefined || type === 'null', path, 'Scalar differs from its declared type');
  else if (typeof input === 'string') {
    string(input, path, PROJECTION_LIMITS.stringBytes, true);
    check(type === undefined || type === 'string', path, 'Scalar differs from its declared type');
  } else if (typeof input === 'boolean') check(type === undefined || type === 'boolean', path, 'Scalar differs from its declared type');
  else {
    integer(input, path, -Number.MAX_SAFE_INTEGER);
    check(type === undefined || type === 'integer', path, 'Scalar differs from its declared type');
  }
}
function recordShape(input: unknown, path: string, definition?: ProjectionDefinition): void {
  const value = record(input, path);
  const names = Object.keys(value);
  check(names.length <= PROJECTION_LIMITS.fields, path, 'Projected field count exceeded');
  if (definition) keys(value, definition.fields.map(field => field.name), [], path);
  for (const key of names) {
    check(fieldName.test(key) && !forbiddenPath.has(key), `${path}/${pointer(key)}`, 'Expected a safe logical field identifier');
    scalarShape(value[key], `${path}/${pointer(key)}`, definition?.fields.find(field => field.name === key)?.type);
  }
  check(encoder.encode(canonical(value)).length <= PROJECTION_LIMITS.recordBytes, path, 'Projected record byte budget exceeded');
}
function applyShape(input: unknown, definition?: ProjectionDefinition): void {
  const value = record(input, '');
  keys(value, ['binding', 'previous', 'block', 'mutations']);
  bindingShape(value.binding, definition, '/binding');
  checkpointShape(value.previous, '/previous');
  checkpointShape(value.block, '/block', true);
  const previous = value.previous as ProjectionCheckpoint;
  const block = value.block as ProjectionBlock;
  check(block.blockNum === previous.blockNum + 1 && block.previousBlockId === previous.blockId, '/block', 'Apply must extend the exact preceding checkpoint');
  check(Array.isArray(value.mutations) && value.mutations.length <= PROJECTION_LIMITS.mutations,
    '/mutations', `Expected at most ${PROJECTION_LIMITS.mutations} ordered mutations`);
  for (const [i, inputMutation] of value.mutations.entries()) {
    const path = `/mutations/${i}`;
    const mutation = record(inputMutation, path);
    check(mutation.kind === 'put' || mutation.kind === 'delete', `${path}/kind`, 'Unsupported mutation');
    keys(mutation, mutation.kind === 'put' ? ['kind', 'key', 'value'] : ['kind', 'key'], [], path);
    string(mutation.key, `${path}/key`, PROJECTION_LIMITS.keyBytes);
    if (mutation.kind === 'put') recordShape(mutation.value, `${path}/value`, definition);
  }
}
function unwrap<T>(result: ProjectionValidationResult<T>): T {
  if (!result.valid) throw new ProjectionContractError('projection.invalid-contract', result.errors.map(error => `${error.path}: ${error.message}`).join('; '));
  return result.value;
}

/** Successful validation returns a detached, recursively frozen snapshot. */
export function validateProjectionDefinition(input: unknown): ProjectionValidationResult<ProjectionDefinition> {
  return validating(input, definitionShape);
}
export function validateProjectionBinding(definition: unknown, input: unknown): ProjectionValidationResult<ProjectionBinding> {
  const checked = validateProjectionDefinition(definition);
  if (!checked.valid) return checked;
  return validating(input, copy => bindingShape(copy, checked.value));
}
export function validateProjectionActivation(definition: unknown, binding: unknown,
  capabilities: unknown): ProjectionValidationResult<ProjectionActivation> {
  return validating({definition, binding, capabilities}, copy => {
    const value = record(copy, '');
    definitionShape(value.definition, '/definition');
    bindingShape(value.binding, value.definition as ProjectionDefinition, '/binding');
    const caps = record(value.capabilities, '/capabilities');
    keys(caps, ['interfaceVersion', 'supported'], [], '/capabilities');
    check(caps.interfaceVersion === 1 && Array.isArray(caps.supported) && caps.supported.length <= PROJECTION_CAPABILITIES.length,
      '/capabilities', 'Expected projection capability interfaceVersion 1');
    const seen = new Set<string>();
    for (const [i, supported] of caps.supported.entries()) {
      check(typeof supported === 'string' && (PROJECTION_CAPABILITIES as readonly string[]).includes(supported), `/capabilities/supported/${i}`, 'Unknown capability');
      check(!seen.has(supported), `/capabilities/supported/${i}`, 'Duplicate capability');
      seen.add(supported);
    }
    for (const required of PROJECTION_CAPABILITIES) if (!seen.has(required)) {
      fail('/capabilities/supported', `Adapter does not support required capability ${required}`, 'projection.capability-unavailable');
    }
  });
}
export function validateProjectionApply(definition: unknown, input: unknown): ProjectionValidationResult<ProjectionApplyRequest> {
  const checked = validateProjectionDefinition(definition);
  if (!checked.valid) return checked;
  return validating(input, copy => applyShape(copy, checked.value));
}
function queryShape(input: unknown, definition?: ProjectionDefinition): void {
  const value = record(input, '');
  keys(value, ['filter', 'limit'], ['afterKey', 'count']);
  integer(value.limit, '/limit', 1, PROJECTION_LIMITS.queryLimit);
  if (Object.hasOwn(value, 'afterKey')) string(value.afterKey, '/afterKey', PROJECTION_LIMITS.keyBytes);
  check(Array.isArray(value.filter) && value.filter.length <= PROJECTION_LIMITS.filterTerms, '/filter', 'Expected at most 16 equality predicates');
  const fields = new Set<string>();
  for (const [i, inputTerm] of value.filter.entries()) {
    const path = `/filter/${i}`;
    const term = record(inputTerm, path);
    keys(term, ['field', 'op', 'value'], [], path);
    check(typeof term.field === 'string' && fieldName.test(term.field) && !forbiddenPath.has(term.field), `${path}/field`, 'Expected a safe logical field identifier');
    const field = definition?.fields.find(field => field.name === term.field);
    if (definition) check(field !== undefined, `${path}/field`, 'Unknown logical field');
    check(!fields.has(term.field), `${path}/field`, 'Duplicate equality field');
    fields.add(term.field);
    check(term.op === 'eq', `${path}/op`, 'Only scalar equality is implemented');
    scalarShape(term.value, `${path}/value`, field?.type);
  }
  if (Object.hasOwn(value, 'count')) {
    const count = record(value.count, '/count');
    keys(count, ['upTo'], [], '/count');
    integer(count.upTo, '/count/upTo', 1, PROJECTION_LIMITS.countUpTo);
  }
}
/** Capture bounded query syntax before awaiting a durable definition lookup. */
export function validateProjectionQueryInput(input: unknown): ProjectionValidationResult<ProjectionQuery> {
  return validating(input, copy => queryShape(copy));
}
export function validateProjectionQuery(definition: unknown, input: unknown): ProjectionValidationResult<ProjectionQuery> {
  const checked = validateProjectionDefinition(definition);
  if (!checked.valid) return checked;
  return validating(input, copy => queryShape(copy, checked.value));
}
export function validateProjectionView(input: unknown): ProjectionValidationResult<ProjectionReadView> {
  return validating(input, copy => {
    const value = record(copy, '');
    keys(value, ['binding', 'checkpoint']);
    bindingShape(value.binding, undefined, '/binding');
    checkpointShape(value.checkpoint, '/checkpoint');
  });
}

function rollbackViewShape(input: unknown): void {
  const value = record(input, '');
  keys(value, ['binding', 'checkpoint', 'revision']);
  bindingShape(value.binding, undefined, '/binding');
  checkpointShape(value.checkpoint, '/checkpoint');
  hash(value.revision, '/revision');
}
function rollbackPendingShape(input: unknown, path: string): void {
  const value = record(input, path);
  keys(value, ['block', 'digest', 'reason'], [], path);
  checkpointShape(value.block, `${path}/block`, true);
  if (value.digest !== null) hash(value.digest, `${path}/digest`);
  if (value.reason !== null) string(value.reason, `${path}/reason`, 4096, true);
}
function sameCheckpoint(a: ProjectionCheckpoint, b: ProjectionCheckpoint): boolean {
  return a.blockNum === b.blockNum && a.blockId === b.blockId;
}

/** Explicit activation of the independently fenced interface; never widens the v1 validator. */
export function validateProjectionRollbackActivation(definition: unknown, binding: unknown,
  capabilities: unknown): ProjectionValidationResult<ProjectionRollbackActivation> {
  return validating({definition, binding, capabilities}, copy => {
    const value = record(copy, '');
    definitionShape(value.definition, '/definition');
    bindingShape(value.binding, value.definition as ProjectionDefinition, '/binding');
    const caps = record(value.capabilities, '/capabilities');
    keys(caps, ['interfaceVersion', 'supported'], [], '/capabilities');
    check(caps.interfaceVersion === 2 && Array.isArray(caps.supported)
      && caps.supported.length <= PROJECTION_ROLLBACK_CAPABILITIES.length,
    '/capabilities', 'Expected projection rollback capability interfaceVersion 2');
    const seen = new Set<string>();
    for (const [i, supported] of caps.supported.entries()) {
      check(typeof supported === 'string' && (PROJECTION_ROLLBACK_CAPABILITIES as readonly string[]).includes(supported),
        `/capabilities/supported/${i}`, 'Unknown capability');
      check(!seen.has(supported), `/capabilities/supported/${i}`, 'Duplicate capability');
      seen.add(supported);
    }
    for (const required of PROJECTION_ROLLBACK_CAPABILITIES) if (!seen.has(required)) {
      fail('/capabilities/supported', `Adapter does not support required capability ${required}`, 'projection.capability-unavailable');
    }
  });
}
export function validateProjectionRollbackView(input: unknown): ProjectionValidationResult<ProjectionRollbackReadView> {
  return validating(input, rollbackViewShape);
}
function rollbackApplyShape(input: unknown, definition?: ProjectionDefinition): void {
  const value = record(input, '');
  keys(value, ['revision', 'batch']);
  hash(value.revision, '/revision');
  applyShape(value.batch, definition);
}
/** Capture the complete inert fenced batch before awaiting a durable definition lookup. */
export function validateProjectionRollbackApplyInput(input: unknown): ProjectionValidationResult<ProjectionRollbackApplyRequest> {
  return validating(input, copy => rollbackApplyShape(copy));
}
export function validateProjectionRollbackApply(definition: unknown,
  input: unknown): ProjectionValidationResult<ProjectionRollbackApplyRequest> {
  const checked = validateProjectionDefinition(definition);
  if (!checked.valid) return checked;
  return validating(input, copy => rollbackApplyShape(copy, checked.value));
}
export function validateProjectionRollbackIncomplete(input: unknown): ProjectionValidationResult<ProjectionRollbackIncompleteRequest> {
  return validating(input, copy => {
    const value = record(copy, '');
    keys(value, ['binding', 'revision', 'block', 'reason']);
    bindingShape(value.binding, undefined, '/binding');
    hash(value.revision, '/revision');
    checkpointShape(value.block, '/block', true);
    string(value.reason, '/reason', 4096);
  });
}
export function validateProjectionRollbackRequest(input: unknown): ProjectionValidationResult<ProjectionRollbackRequest> {
  return validating(input, copy => {
    const value = record(copy, '');
    keys(value, ['binding', 'revision', 'operationId', 'from', 'ancestor', 'maxBlocks']);
    bindingShape(value.binding, undefined, '/binding');
    hash(value.revision, '/revision');
    string(value.operationId, '/operationId', 128);
    checkpointShape(value.from, '/from');
    checkpointShape(value.ancestor, '/ancestor');
    check((value.ancestor as ProjectionCheckpoint).blockNum <= (value.from as ProjectionCheckpoint).blockNum,
      '/ancestor', 'Rollback ancestor cannot follow the expected completed checkpoint');
    integer(value.maxBlocks, '/maxBlocks', 1, PROJECTION_ROLLBACK_LIMITS.maxSteps);
  });
}
export function validateProjectionRollbackRecovery(input: unknown): ProjectionValidationResult<ProjectionRollbackRecoveryView> {
  return validating(input, copy => {
    const value = record(copy, '');
    keys(value, ['binding', 'checkpoint', 'initialized', 'pending', 'gap', 'revision', 'coverage', 'rollback']);
    bindingShape(value.binding, undefined, '/binding');
    checkpointShape(value.checkpoint, '/checkpoint');
    const checkpoint = value.checkpoint as ProjectionCheckpoint;
    hash(value.revision, '/revision');
    check(typeof value.initialized === 'boolean', '/initialized', 'Expected initialization status');
    if (value.pending !== null) {
      rollbackPendingShape(value.pending, '/pending');
      const pending = value.pending as ProjectionPendingSource;
      check(pending.block.blockNum === checkpoint.blockNum + 1 && pending.block.previousBlockId === checkpoint.blockId,
        '/pending/block', 'Pending source must extend the exact completed checkpoint');
    }
    if (value.gap !== null) {
      rollbackPendingShape(value.gap, '/gap');
      const gap = value.gap as ProjectionPendingSource;
      check(gap.block.blockNum > checkpoint.blockNum, '/gap/block', 'Source gap must follow completed progress');
      if (gap.block.blockNum === checkpoint.blockNum + 1) {
        check(gap.block.previousBlockId === checkpoint.blockId, '/gap/block', 'Next gap source must extend the exact checkpoint');
      }
      if (value.pending !== null) {
        const pending = value.pending as ProjectionPendingSource;
        check(pending.block.blockNum <= gap.block.blockNum, '/pending/block', 'Pending source cannot follow the observed source gap');
        if (pending.block.blockNum === gap.block.blockNum) {
          check(sameCheckpoint(pending.block, gap.block) && pending.block.previousBlockId === gap.block.previousBlockId
            && (pending.digest === null || gap.digest === null || pending.digest === gap.digest),
          '/gap', 'Pending and gap source identities conflict');
        } else if (pending.block.blockNum === gap.block.blockNum - 1) {
          check(pending.block.blockId === gap.block.previousBlockId, '/gap/block', 'Adjacent pending and gap sources conflict');
        }
      }
    }
    const coverage = record(value.coverage, '/coverage');
    keys(coverage, ['floor', 'retainedBlocks', 'retainedBytes', 'maxBlocks', 'maxBytes'], [], '/coverage');
    checkpointShape(coverage.floor, '/coverage/floor');
    const floor = coverage.floor as ProjectionCheckpoint;
    integer(coverage.maxBlocks, '/coverage/maxBlocks', 1, PROJECTION_ROLLBACK_LIMITS.retainedBlocks);
    integer(coverage.maxBytes, '/coverage/maxBytes', 1, PROJECTION_ROLLBACK_LIMITS.retainedBytes);
    integer(coverage.retainedBlocks, '/coverage/retainedBlocks', 0, coverage.maxBlocks);
    integer(coverage.retainedBytes, '/coverage/retainedBytes', 0, coverage.maxBytes);
    check(floor.blockNum <= checkpoint.blockNum && checkpoint.blockNum - floor.blockNum === coverage.retainedBlocks,
      '/coverage', 'Coverage must describe the contiguous retained window ending at the completed checkpoint');
    check(coverage.retainedBlocks === 0
      ? sameCheckpoint(floor, checkpoint) && coverage.retainedBytes === 0
      : coverage.retainedBytes > 0,
    '/coverage', 'Empty coverage has no retained undo bytes; retained blocks require encoded undo data');
    if (value.rollback !== null) {
      const rollback = record(value.rollback, '/rollback');
      keys(rollback, ['operationId', 'sourceRevision', 'from', 'ancestor', 'status', 'reason'], [], '/rollback');
      string(rollback.operationId, '/rollback/operationId', 128);
      hash(rollback.sourceRevision, '/rollback/sourceRevision');
      check(rollback.sourceRevision !== value.revision, '/rollback/sourceRevision', 'Recovery must rotate the persisted revision before undo');
      checkpointShape(rollback.from, '/rollback/from');
      checkpointShape(rollback.ancestor, '/rollback/ancestor');
      const from = rollback.from as ProjectionCheckpoint;
      const ancestor = rollback.ancestor as ProjectionCheckpoint;
      check(ancestor.blockNum <= from.blockNum, '/rollback/ancestor', 'Rollback ancestor cannot follow its starting checkpoint');
      check(['running', 'complete', 'unavailable'].includes(rollback.status as string), '/rollback/status', 'Unknown rollback status');
      if (rollback.status === 'unavailable') string(rollback.reason, '/rollback/reason', 4096);
      else check(rollback.reason === null, '/rollback/reason', 'Only unavailable recovery carries a failure reason');
      if (rollback.status === 'running') {
        check(ancestor.blockNum >= floor.blockNum
          && (ancestor.blockNum !== floor.blockNum || sameCheckpoint(ancestor, floor)),
        '/rollback/ancestor', 'Running rollback ancestor is outside the retained recovery coverage');
        check(checkpoint.blockNum >= ancestor.blockNum && checkpoint.blockNum <= from.blockNum,
          '/checkpoint', 'Running rollback checkpoint is outside its source range');
        if (checkpoint.blockNum === from.blockNum) check(sameCheckpoint(checkpoint, from), '/checkpoint', 'Rollback start identity differs');
        if (checkpoint.blockNum === ancestor.blockNum) check(sameCheckpoint(checkpoint, ancestor), '/checkpoint', 'Rollback ancestor identity differs');
      } else if (rollback.status === 'complete') {
        check(checkpoint.blockNum >= ancestor.blockNum, '/checkpoint', 'Completed recovery cannot precede its ancestor');
        if (checkpoint.blockNum === ancestor.blockNum) check(sameCheckpoint(checkpoint, ancestor), '/checkpoint', 'Completed ancestor identity differs');
      }
    }
    if (!value.initialized) check(checkpoint.blockNum === 0 && value.pending === null && value.gap === null
      && value.rollback === null, '/initialized', 'Uninitialized recovery cannot contain applied or pending source work');
  });
}

/** Canonical UTF-8 text for SHA-256 replay receipts. Array order is significant. */
export function canonicalProjectionBatch(input: unknown): string {
  return canonical(unwrap(validating<ProjectionApplyRequest>(input, copy => applyShape(copy))));
}

/** Pure mapping helper: nested decoded source members become the complete flat scalar record. */
export function projectTableValue(definition: unknown, input: unknown): ProjectionValidationResult<ProjectionRecord> {
  const checked = validateProjectionDefinition(definition);
  if (!checked.valid) return checked;
  try {
    const source = snapshot(input);
    record(source, '');
    const output: Record<string, ProjectionScalar> = Object.create(null) as Record<string, ProjectionScalar>;
    for (const field of checked.value.fields) {
      let value: unknown = source;
      for (const segment of field.path) {
        const parent = record(value, `/source/${field.path.map(pointer).join('/')}`);
        check(Object.hasOwn(parent, segment), `/source/${field.path.map(pointer).join('/')}`, 'Required source field is missing');
        value = parent[segment];
      }
      scalarShape(value, `/value/${field.name}`, field.type);
      output[field.name] = value as ProjectionScalar;
    }
    recordShape(output, '/value', checked.value);
    return {valid: true, value: freeze(output)};
  } catch (error) {
    return {valid: false, errors: [caught(error)]};
  }
}

/**
 * Stable source-row identity without concatenation collisions or numeric coercion. Providers own
 * canonical decimal/hex/other key encoding. Ordering is lexical UTF-8, never numeric key ordering.
 */
export function projectionRowKey(scope: unknown, primaryKey: unknown): string {
  const input = unwrap(validating<{scope: string; primaryKey: string}>({scope, primaryKey}, copy => {
    const value = record(copy, '');
    string(value.scope, '/scope', 256, true);
    string(value.primaryKey, '/primaryKey', 512);
  }));
  const key = JSON.stringify([input.scope, input.primaryKey]);
  if (encoder.encode(key).length > PROJECTION_LIMITS.keyBytes) throw new ProjectionContractError('projection.invalid-contract', 'Encoded row key exceeds the key byte budget');
  return key;
}
