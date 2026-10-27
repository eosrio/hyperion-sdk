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

/** Additive inspection; neither the v1 nor the v2 capability manifest is widened. */
export const PROJECTION_RECOVERY_CAPABILITIES = Object.freeze(['retained-checkpoints'] as const);
export interface ProjectionRecoveryCapabilities {
  readonly interfaceVersion: 1;
  readonly supported: readonly typeof PROJECTION_RECOVERY_CAPABILITIES[number][];
}
export interface ProjectionRecoveryActivation extends ProjectionRollbackActivation {
  readonly recoveryCapabilities: ProjectionRecoveryCapabilities;
}
export interface ProjectionRetainedCheckpointRequest {
  readonly binding: ProjectionBinding;
  /** Inspection must observe this exact persisted writer fence. */
  readonly revision: string;
}
export interface ProjectionRetainedCheckpointView {
  readonly recovery: ProjectionRollbackRecoveryView;
  /** Exact applied-branch identities, descending from checkpoint through coverage.floor inclusive. */
  readonly checkpoints: readonly ProjectionCheckpoint[];
}
/**
 * Optional bounded applied-branch inspection for a host selecting a canonical rollback ancestor.
 * Validate the binding/revision before native I/O and derive both result members from one validated
 * durable metadata snapshot. Return detached frozen data even when incomplete or rolling back.
 * Stale revisions fail with projection.stale-revision. This is not canonical evidence or a serving
 * readiness grant, and it never exposes native storage, undo descriptors or before-images.
 */
export interface ProjectionRecoveryAdapter extends ProjectionRollbackAdapter {
  readonly recoveryCapabilities: ProjectionRecoveryCapabilities;
  retainedCheckpoints(request: ProjectionRetainedCheckpointRequest): Promise<ProjectionRetainedCheckpointView>;
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

/** Independently activate inspection while preserving the exact existing rollback contract. */
export function validateProjectionRecoveryActivation(definition: unknown, binding: unknown,
  capabilities: unknown, recoveryCapabilities: unknown): ProjectionValidationResult<ProjectionRecoveryActivation> {
  return validating({definition, binding, capabilities, recoveryCapabilities}, copy => {
    const value = record(copy, '');
    const rollback = validateProjectionRollbackActivation(value.definition, value.binding, value.capabilities);
    if (!rollback.valid) {
      const error = rollback.errors[0]!;
      fail(error.path, error.message, error.code);
    }
    const caps = record(value.recoveryCapabilities, '/recoveryCapabilities');
    keys(caps, ['interfaceVersion', 'supported'], [], '/recoveryCapabilities');
    check(caps.interfaceVersion === 1 && Array.isArray(caps.supported)
      && caps.supported.length <= PROJECTION_RECOVERY_CAPABILITIES.length,
    '/recoveryCapabilities', 'Expected projection recovery capability interfaceVersion 1');
    const seen = new Set<string>();
    for (const [i, supported] of caps.supported.entries()) {
      check(typeof supported === 'string' && (PROJECTION_RECOVERY_CAPABILITIES as readonly string[]).includes(supported),
        `/recoveryCapabilities/supported/${i}`, 'Unknown capability');
      check(!seen.has(supported), `/recoveryCapabilities/supported/${i}`, 'Duplicate capability');
      seen.add(supported);
    }
    for (const required of PROJECTION_RECOVERY_CAPABILITIES) if (!seen.has(required)) {
      fail('/recoveryCapabilities/supported', `Adapter does not support required capability ${required}`, 'projection.capability-unavailable');
    }
  });
}

export function validateProjectionRetainedCheckpointRequest(input: unknown): ProjectionValidationResult<ProjectionRetainedCheckpointRequest> {
  return validating(input, copy => {
    const value = record(copy, '');
    keys(value, ['binding', 'revision']);
    bindingShape(value.binding, undefined, '/binding');
    hash(value.revision, '/revision');
  });
}

/** Capture a bounded metadata-only path; its canonicality remains the host's responsibility. */
export function validateProjectionRetainedCheckpoints(input: unknown): ProjectionValidationResult<ProjectionRetainedCheckpointView> {
  return validating(input, copy => {
    const value = record(copy, '');
    keys(value, ['recovery', 'checkpoints']);
    const recovery = validateProjectionRollbackRecovery(value.recovery);
    if (!recovery.valid) {
      const error = recovery.errors[0]!;
      fail(`/recovery${error.path}`, error.message, error.code);
    }
    const {checkpoint, coverage} = recovery.value;
    check(Array.isArray(value.checkpoints) && value.checkpoints.length >= 1
      && value.checkpoints.length <= PROJECTION_ROLLBACK_LIMITS.retainedBlocks + 1,
    '/checkpoints', 'Expected a bounded nonempty retained checkpoint path');
    check(value.checkpoints.length === coverage.retainedBlocks + 1,
      '/checkpoints', 'Retained checkpoint count must include every retained block and its floor');
    const identities = new Set<string>();
    for (const [i, inputPoint] of value.checkpoints.entries()) {
      const path = `/checkpoints/${i}`;
      checkpointShape(inputPoint, path);
      const point = inputPoint as ProjectionCheckpoint;
      check(point.blockNum === checkpoint.blockNum - i, path, 'Retained checkpoints must descend contiguously');
      check(!identities.has(point.blockId), `${path}/blockId`, 'Duplicate retained block identity');
      identities.add(point.blockId);
    }
    check(sameCheckpoint(value.checkpoints[0] as ProjectionCheckpoint, checkpoint),
      '/checkpoints/0', 'Retained path must start at the recovery checkpoint');
    check(sameCheckpoint(value.checkpoints[value.checkpoints.length - 1] as ProjectionCheckpoint, coverage.floor),
      '/checkpoints', 'Retained path must end at the recovery coverage floor');
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

/** Separate opt-in definition family; v1 definitions and full-put semantics stay unchanged. */
export interface ContextualProjectionField {
  readonly name: string;
  readonly type: ProjectionField['type'];
  readonly source:
    | {readonly kind: 'row'; readonly path: readonly string[]}
    | {readonly kind: 'context'; readonly field: 'contract'}
    | {readonly kind: 'context'; readonly field: 'blockNum' | 'blockTimeMs'; readonly format: 'decimal'};
}
export interface ContextualProjectionPolicy {
  readonly preserveOnReplace: readonly string[];
  readonly onAbsent: 'delete' | 'incomplete';
}
export interface ContextualProjectionDefinition extends Omit<ProjectionDefinition, 'schemaVersion' | 'fields'>,
  ContextualProjectionPolicy {
  readonly schemaVersion: 2;
  readonly fields: readonly ContextualProjectionField[];
}
/** Host-supplied original facts, never canonical/ABI/readiness authority by themselves. */
export interface ContextualProjectionContext {
  readonly binding: ProjectionBinding;
  readonly block: ProjectionBlock;
  readonly source: {readonly contract: string; readonly table: string; readonly blockTimeMs: number};
}
export type ContextualProjectionMutation = ProjectionMutation
  | {readonly kind: 'put-preserving'; readonly key: string; readonly value: ProjectionRecord;
    readonly preserveFields: readonly string[]};
export type ContextualProjectionChange =
  | {readonly key: string; readonly present: true; readonly value: unknown}
  | {readonly key: string; readonly present: false};
export interface ContextualProjectionApplyRequest extends ContextualProjectionContext {
  readonly previous: ProjectionCheckpoint;
  readonly policy: ContextualProjectionPolicy;
  readonly mutations: readonly ContextualProjectionMutation[];
}
export const CONTEXTUAL_PROJECTION_HOST_CAPABILITIES = Object.freeze([
  'original-source-context', 'contextual-scalar-mapping', 'declared-absence-policy',
] as const);
export const CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES = Object.freeze([
  ...PROJECTION_CAPABILITIES, 'preserving-replacement',
] as const);
export interface ContextualProjectionHostCapabilities {
  readonly family: 'contextual-table'; readonly interfaceVersion: 1;
  readonly supported: readonly typeof CONTEXTUAL_PROJECTION_HOST_CAPABILITIES[number][];
}
export interface ContextualProjectionAdapterCapabilities {
  readonly family: 'contextual-table'; readonly interfaceVersion: 1;
  readonly supported: readonly typeof CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES[number][];
}
export interface ContextualProjectionActivation {
  readonly definition: ContextualProjectionDefinition;
  readonly binding: ProjectionBinding;
  readonly hostCapabilities: ContextualProjectionHostCapabilities;
  readonly adapterCapabilities: ContextualProjectionAdapterCapabilities;
}
/** Independent opt-in. Atomic preservation is an adapter obligation, not a claim made by validators. */
export interface ContextualProjectionAdapter {
  readonly capabilities: ContextualProjectionAdapterCapabilities;
  initialize(definition: ContextualProjectionDefinition, binding: ProjectionBinding,
    genesis: ProjectionCheckpoint): Promise<ProjectionReadView>;
  open(binding: ProjectionBinding): Promise<ProjectionReadView>;
  recovery?(binding: ProjectionBinding): Promise<ProjectionRecoveryView>;
  apply(request: ContextualProjectionApplyRequest): Promise<ProjectionApplyResult>;
  markIncomplete(binding: ProjectionBinding, failedBlock: ProjectionBlock, reason: string): Promise<void>;
  query(view: ProjectionReadView, query: ProjectionQuery): Promise<ProjectionQueryResult>;
}

/** Storage field/type validation only. This v1 view is never executed against a source row. */
function contextualRecordDefinition(definition: ContextualProjectionDefinition): ProjectionDefinition {
  return {schemaVersion: 1, id: definition.id, mappingRevision: definition.mappingRevision, source: definition.source,
    fields: definition.fields.map(field => ({name: field.name, type: field.type,
      path: field.source.kind === 'row' ? field.source.path : ['context']})), initialization: definition.initialization};
}
function preservationShape(input: unknown, path: string, fields?: readonly string[]): void {
  check(Array.isArray(input) && input.length <= PROJECTION_LIMITS.fields, path, 'Expected a bounded preservation field list');
  const seen = new Set<string>();
  for (const [index, name] of input.entries()) {
    check(typeof name === 'string' && fieldName.test(name) && !forbiddenPath.has(name)
      && (fields === undefined || fields.includes(name)) && !seen.has(name), `${path}/${index}`,
      'Preservation fields must be declared and duplicate-free');
    seen.add(name);
  }
}
function contextualDefinitionShape(input: unknown): void {
  const value = record(input, '');
  keys(value, ['schemaVersion', 'id', 'mappingRevision', 'source', 'fields', 'initialization', 'preserveOnReplace', 'onAbsent']);
  check(value.schemaVersion === 2, '/schemaVersion', 'Expected contextual definition schemaVersion 2');
  check(Array.isArray(value.fields) && value.fields.length > 0 && value.fields.length <= PROJECTION_LIMITS.fields,
    '/fields', 'Expected a bounded nonempty contextual field list');
  for (const [index, inputField] of value.fields.entries()) {
    const path = `/fields/${index}`, field = record(inputField, path);
    keys(field, ['name', 'type', 'source'], [], path);
    const source = record(field.source, `${path}/source`);
    if (source.kind === 'row') keys(source, ['kind', 'path'], [], `${path}/source`);
    else {
      check(source.kind === 'context', `${path}/source/kind`, 'Expected row or context field source');
      check(field.type === 'string', `${path}/type`, 'Context fields require exact string representation');
      if (source.field === 'contract') keys(source, ['kind', 'field'], [], `${path}/source`);
      else {
        keys(source, ['kind', 'field', 'format'], [], `${path}/source`);
        check(source.field === 'blockNum' || source.field === 'blockTimeMs', `${path}/source/field`, 'Unsupported context field');
        check(source.format === 'decimal', `${path}/source/format`, 'Expected exact decimal formatting');
      }
    }
  }
  definitionShape(contextualRecordDefinition(value as unknown as ContextualProjectionDefinition));
  preservationShape(value.preserveOnReplace, '/preserveOnReplace', value.fields.map(field => (field as {name: string}).name));
  check(value.onAbsent === 'delete' || value.onAbsent === 'incomplete', '/onAbsent', 'Expected explicit delete or incomplete policy');
}
export function validateContextualProjectionDefinition(input: unknown): ProjectionValidationResult<ContextualProjectionDefinition> {
  return validating(input, contextualDefinitionShape);
}
export function validateContextualProjectionBinding(definition: unknown, input: unknown): ProjectionValidationResult<ProjectionBinding> {
  const selected = validateContextualProjectionDefinition(definition);
  return selected.valid ? validating(input, copy => bindingShape(copy, contextualRecordDefinition(selected.value))) : selected;
}
function contextualCapabilitiesShape(input: unknown, required: readonly string[], path: string): void {
  const value = record(input, path);
  keys(value, ['family', 'interfaceVersion', 'supported'], [], path);
  check(value.family === 'contextual-table' && value.interfaceVersion === 1, path, 'Unsupported contextual capability family/version');
  check(Array.isArray(value.supported) && value.supported.length <= required.length, `${path}/supported`, 'Expected bounded contextual capabilities');
  const seen = new Set<string>();
  for (const item of value.supported) {
    check(typeof item === 'string' && required.includes(item) && !seen.has(item), `${path}/supported`, 'Unknown or duplicate capability');
    seen.add(item);
  }
  for (const item of required) if (!seen.has(item)) fail(`${path}/supported`, `Required capability ${item} is unavailable`, 'projection.capability-unavailable');
}
/** Pure negotiation. Hosts call this before imports, initialization or native storage effects. */
export function validateContextualProjectionActivation(definition: unknown, binding: unknown,
  hostCapabilities: unknown, adapterCapabilities: unknown): ProjectionValidationResult<ContextualProjectionActivation> {
  return validating({definition, binding, hostCapabilities, adapterCapabilities}, copy => {
    const value = record(copy, '');
    contextualDefinitionShape(value.definition);
    bindingShape(value.binding, contextualRecordDefinition(value.definition as ContextualProjectionDefinition), '/binding');
    contextualCapabilitiesShape(value.hostCapabilities, CONTEXTUAL_PROJECTION_HOST_CAPABILITIES, '/hostCapabilities');
    contextualCapabilitiesShape(value.adapterCapabilities, CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES, '/adapterCapabilities');
  });
}
function contextualContextShape(input: unknown, definition?: ContextualProjectionDefinition): void {
  const value = record(input, '');
  keys(value, ['binding', 'block', 'source']);
  bindingShape(value.binding, definition === undefined ? undefined : contextualRecordDefinition(definition), '/binding');
  checkpointShape(value.block, '/block', true);
  const source = record(value.source, '/source');
  keys(source, ['contract', 'table', 'blockTimeMs'], [], '/source');
  string(source.contract, '/source/contract'); string(source.table, '/source/table');
  integer(source.blockTimeMs, '/source/blockTimeMs', 0);
  if (definition) {
    check(source.contract === definition.source.contract && source.table === definition.source.table,
      '/source', 'Original context differs from the configured contract/table');
  }
}
export function validateContextualProjectionContext(definition: unknown, input: unknown): ProjectionValidationResult<ContextualProjectionContext> {
  const selected = validateContextualProjectionDefinition(definition);
  return selected.valid ? validating(input, copy => contextualContextShape(copy, selected.value)) : selected;
}
/** Pure mapping. Context remains outside the untrusted decoded row; no clock or database is read. */
export function projectContextualTableChange(definition: unknown, context: unknown,
  input: unknown): ProjectionValidationResult<ContextualProjectionMutation> {
  const selected = validateContextualProjectionDefinition(definition);
  if (!selected.valid) return selected;
  const captured = validateContextualProjectionContext(selected.value, context);
  if (!captured.valid) return captured;
  const change = validating<ContextualProjectionChange>(input, copy => {
    const value = record(copy, '');
    check(typeof value.present === 'boolean', '/present', 'Expected explicit row presence');
    keys(value, value.present ? ['key', 'present', 'value'] : ['key', 'present']);
    string(value.key, '/key', PROJECTION_LIMITS.keyBytes);
  });
  if (!change.valid) return change;
  try {
    const {key} = change.value;
    if (!change.value.present) {
      if (selected.value.onAbsent === 'incomplete') fail('/present', 'Absent source row leaves this projection incomplete', 'projection.incomplete');
      return {valid: true, value: freeze({kind: 'delete', key})};
    }
    const row = record(change.value.value, '/value'), output: Record<string, ProjectionScalar> = Object.create(null);
    const base = contextualRecordDefinition(selected.value);
    const rowFields = base.fields.filter((_field, index) => selected.value.fields[index]!.source.kind === 'row');
    if (rowFields.length) {
      const mapped = projectTableValue({...base, fields: rowFields}, row);
      if (!mapped.valid) return mapped;
      Object.assign(output, mapped.value);
    }
    for (const field of selected.value.fields) if (field.source.kind === 'context') {
      output[field.name] = field.source.field === 'contract' ? captured.value.source.contract
        : String(field.source.field === 'blockNum' ? captured.value.block.blockNum : captured.value.source.blockTimeMs);
    }
    recordShape(output, '/value', base);
    const mutation: ContextualProjectionMutation = selected.value.preserveOnReplace.length
      ? {kind: 'put-preserving', key, value: output, preserveFields: selected.value.preserveOnReplace}
      : {kind: 'put', key, value: output};
    return {valid: true, value: freeze(mutation)};
  } catch (error) {return {valid: false, errors: [caught(error)]};}
}

function contextualMutationShape(input: unknown, definition?: ContextualProjectionDefinition): void {
  const mutation = record(input, '/mutation');
  check(['put', 'delete', 'put-preserving'].includes(mutation.kind as string), '/mutation/kind', 'Unsupported contextual mutation');
  keys(mutation, mutation.kind === 'delete' ? ['kind', 'key'] : mutation.kind === 'put'
    ? ['kind', 'key', 'value'] : ['kind', 'key', 'value', 'preserveFields'], [], '/mutation');
  string(mutation.key, '/mutation/key', PROJECTION_LIMITS.keyBytes);
  if (mutation.kind === 'delete') {
    if (definition) check(definition.onAbsent === 'delete', '/mutation/kind', 'Definition rejects absent source rows');
    return;
  }
  recordShape(mutation.value, '/mutation/value', definition === undefined ? undefined : contextualRecordDefinition(definition));
  if (mutation.kind === 'put-preserving') {
    preservationShape(mutation.preserveFields, '/mutation/preserveFields', Object.keys(mutation.value as object));
    check((mutation.preserveFields as string[]).length > 0, '/mutation/preserveFields', 'Preserving replacement requires at least one field');
  }
  if (definition) {
    check(definition.preserveOnReplace.length ? mutation.kind === 'put-preserving' : mutation.kind === 'put',
      '/mutation/kind', 'Replacement kind differs from the declared policy');
    if (mutation.kind === 'put-preserving') check(canonical(mutation.preserveFields) === canonical(definition.preserveOnReplace),
      '/mutation/preserveFields', 'Replacement must preserve the exact declared field list');
  }
}

/**
 * Pure reference semantics, not a read or write grant. An adapter must resolve each operation against
 * its current transactional record, in mutation-array order, and atomically persist effects/progress.
 * Keep the original operation for replay identity; never replace it with this prior-state merge.
 */
export function resolveContextualProjectionMutation(definition: unknown, mutation: unknown,
  previous: unknown): ProjectionValidationResult<ProjectionRecord | null> {
  const selected = validateContextualProjectionDefinition(definition);
  if (!selected.valid) return selected;
  const captured = validating<{mutation: ContextualProjectionMutation; previous: ProjectionRecord | null}>(
    {mutation, previous}, copy => {
      const value = record(copy, '');
      contextualMutationShape(value.mutation, selected.value);
      if (value.previous !== null) recordShape(value.previous, '/previous', contextualRecordDefinition(selected.value));
    });
  if (!captured.valid) return captured;
  const operation = captured.value.mutation;
  if (operation.kind === 'delete') return {valid: true, value: null};
  const result = {...operation.value};
  if (operation.kind === 'put-preserving' && captured.value.previous !== null) {
    for (const field of operation.preserveFields) result[field] = captured.value.previous[field]!;
  }
  try {
    recordShape(result, '/value', contextualRecordDefinition(selected.value));
    return {valid: true, value: freeze(result)};
  } catch (error) {return {valid: false, errors: [caught(error)]};}
}

function contextualApplyShape(input: unknown, definition?: ContextualProjectionDefinition): void {
  const value = record(input, '');
  keys(value, ['binding', 'block', 'source', 'previous', 'policy', 'mutations']);
  contextualContextShape({binding: value.binding, block: value.block, source: value.source}, definition);
  const policy = record(value.policy, '/policy');
  keys(policy, ['preserveOnReplace', 'onAbsent'], [], '/policy');
  preservationShape(policy.preserveOnReplace, '/policy/preserveOnReplace', definition?.fields.map(field => field.name));
  check(policy.onAbsent === 'delete' || policy.onAbsent === 'incomplete', '/policy/onAbsent', 'Expected explicit absence policy');
  if (definition) check(canonical(policy) === canonical({preserveOnReplace: definition.preserveOnReplace, onAbsent: definition.onAbsent}),
    '/policy', 'Apply policy differs from the immutable definition');
  check(Array.isArray(value.mutations) && value.mutations.length <= PROJECTION_LIMITS.mutations,
    '/mutations', 'Expected a bounded ordered mutation list');
  for (const mutation of value.mutations) {
    contextualMutationShape(mutation, definition);
    const item = mutation as ContextualProjectionMutation;
    if (item.kind === 'delete') check(policy.onAbsent === 'delete', '/mutations', 'Policy rejects absent source rows');
    else check((policy.preserveOnReplace as string[]).length ? item.kind === 'put-preserving'
      && canonical(item.preserveFields) === canonical(policy.preserveOnReplace) : item.kind === 'put',
    '/mutations', 'Mutation differs from its captured replacement policy');
  }
  // Reuse exact v1 adjacency, key, record and mutation-budget validation; do not execute this view.
  applyShape({binding: value.binding, block: value.block, previous: value.previous,
    mutations: value.mutations.map(mutation => {
      const item = mutation as ContextualProjectionMutation;
      return item.kind === 'put-preserving' ? {kind: 'put', key: item.key, value: item.value} : item;
    })}, definition === undefined ? undefined : contextualRecordDefinition(definition));
}
/** Capture before any adapter definition lookup or I/O. */
export function validateContextualProjectionApplyInput(input: unknown): ProjectionValidationResult<ContextualProjectionApplyRequest> {
  return validating(input, copy => contextualApplyShape(copy));
}
export function validateContextualProjectionApply(definition: unknown,
  input: unknown): ProjectionValidationResult<ContextualProjectionApplyRequest> {
  const selected = validateContextualProjectionDefinition(definition);
  return selected.valid ? validating(input, copy => contextualApplyShape(copy, selected.value)) : selected;
}
/** Original logical candidate/policy/source, never the prior-state-dependent resolved record. */
export function canonicalContextualProjectionBatch(input: unknown): string {
  return canonical(unwrap(validateContextualProjectionApplyInput(input)));
}
/** Reuse the existing equality/keyset/count vocabulary without extending the query language. */
export function validateContextualProjectionQuery(definition: unknown, input: unknown): ProjectionValidationResult<ProjectionQuery> {
  const selected = validateContextualProjectionDefinition(definition);
  return selected.valid ? validating(input, copy => queryShape(copy, contextualRecordDefinition(selected.value))) : selected;
}

/** Separate opt-in recovery family; neither contextual-basic nor legacy manifests are widened. */
export const CONTEXTUAL_PROJECTION_RECOVERY_HOST_CAPABILITIES = Object.freeze([
  ...CONTEXTUAL_PROJECTION_HOST_CAPABILITIES, 'runtime-coordinated-recovery',
] as const);
export const CONTEXTUAL_PROJECTION_RECOVERY_ADAPTER_CAPABILITIES = Object.freeze([
  ...CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES, 'revision-fenced', 'fork-rollback', 'retained-checkpoints',
] as const);
export interface ContextualProjectionRecoveryHostCapabilities {
  readonly family: 'contextual-table-recovery';
  readonly interfaceVersion: 1;
  readonly supported: readonly typeof CONTEXTUAL_PROJECTION_RECOVERY_HOST_CAPABILITIES[number][];
}
export interface ContextualProjectionRecoveryAdapterCapabilities {
  readonly family: 'contextual-table-recovery';
  readonly interfaceVersion: 1;
  readonly supported: readonly typeof CONTEXTUAL_PROJECTION_RECOVERY_ADAPTER_CAPABILITIES[number][];
}
export interface ContextualProjectionRecoveryActivation {
  readonly definition: ContextualProjectionDefinition;
  readonly binding: ProjectionBinding;
  readonly hostCapabilities: ContextualProjectionRecoveryHostCapabilities;
  readonly adapterCapabilities: ContextualProjectionRecoveryAdapterCapabilities;
}
export interface ContextualProjectionRecoveryApplyRequest {
  readonly revision: string;
  readonly batch: ContextualProjectionApplyRequest;
}
export interface ContextualProjectionRecoveryQueryRequest {
  readonly view: ProjectionRollbackReadView;
  readonly query: ProjectionQuery;
}
/**
 * Explicit opt-in only. Reuse the existing exact revision/coverage/recovery DTOs, but never route
 * contextual batches through legacy apply. initialize persists the full contextual definition and
 * prevents legacy/basic access from bypassing this instance's policy and revision fence.
 *
 * Every mutable operation checks its captured revision against current durable state. Apply keeps
 * the original contextual candidate/policy/source/order for replay identity and resolves preserving
 * mutations against current records in transaction order, atomically with checkpoint, receipt and
 * required undo. Undo restores the pre-block state, including absent records and required nulls.
 * Unknown commits stay incomplete until exact original-batch recovery. No method invents context.
 *
 * rollback admits, advances and completes the existing resumable recovery operation: rotate the
 * revision durably before undo, preserve exact sourceRevision/operation/from/ancestor retries,
 * and durably mark unavailable ancestry. Completion alone grants no serving/canonical authority.
 * Query requires one coherent ready snapshot and the exact captured revision/checkpoint. Returning
 * DTOs or passing validators supplies no engine atomicity, source authority or production activation.
 */
export interface ContextualProjectionRecoveryAdapter {
  readonly capabilities: ContextualProjectionRecoveryAdapterCapabilities;
  initialize(definition: ContextualProjectionDefinition, binding: ProjectionBinding,
    genesis: ProjectionCheckpoint): Promise<ProjectionRollbackReadView>;
  open(binding: ProjectionBinding): Promise<ProjectionRollbackReadView>;
  recovery(binding: ProjectionBinding): Promise<ProjectionRollbackRecoveryView>;
  apply(request: ContextualProjectionRecoveryApplyRequest): Promise<ProjectionRollbackApplyResult>;
  markIncomplete(request: ProjectionRollbackIncompleteRequest): Promise<void>;
  rollback(request: ProjectionRollbackRequest): Promise<ProjectionRollbackResult>;
  retainedCheckpoints(request: ProjectionRetainedCheckpointRequest): Promise<ProjectionRetainedCheckpointView>;
  query(view: ProjectionRollbackReadView, query: ProjectionQuery): Promise<ProjectionRollbackQueryResult>;
}
function contextualRecoveryCapabilitiesShape(input: unknown, required: readonly string[], path: string): void {
  const value = record(input, path);
  keys(value, ['family', 'interfaceVersion', 'supported'], [], path);
  check(value.family === 'contextual-table-recovery' && value.interfaceVersion === 1,
    path, 'Unsupported contextual recovery capability family/version');
  check(Array.isArray(value.supported) && value.supported.length <= required.length,
    `${path}/supported`, 'Expected bounded contextual recovery capabilities');
  const seen = new Set<string>();
  for (const item of value.supported) {
    check(typeof item === 'string' && required.includes(item) && !seen.has(item),
      `${path}/supported`, 'Unknown or duplicate capability');
    seen.add(item);
  }
  for (const item of required) if (!seen.has(item)) {
    fail(`${path}/supported`, `Required capability ${item} is unavailable`, 'projection.capability-unavailable');
  }
}
/** Pure negotiation before imports or effects. Capability labels confer no execution authority. */
export function validateContextualProjectionRecoveryActivation(definition: unknown, binding: unknown,
  hostCapabilities: unknown, adapterCapabilities: unknown): ProjectionValidationResult<ContextualProjectionRecoveryActivation> {
  return validating({definition, binding, hostCapabilities, adapterCapabilities}, copy => {
    const value = record(copy, '');
    contextualDefinitionShape(value.definition);
    bindingShape(value.binding, contextualRecordDefinition(value.definition as ContextualProjectionDefinition), '/binding');
    contextualRecoveryCapabilitiesShape(value.hostCapabilities, CONTEXTUAL_PROJECTION_RECOVERY_HOST_CAPABILITIES, '/hostCapabilities');
    contextualRecoveryCapabilitiesShape(value.adapterCapabilities, CONTEXTUAL_PROJECTION_RECOVERY_ADAPTER_CAPABILITIES, '/adapterCapabilities');
  });
}
function contextualRecoveryApplyShape(input: unknown, definition?: ContextualProjectionDefinition): void {
  const value = record(input, '');
  keys(value, ['revision', 'batch']);
  hash(value.revision, '/revision');
  contextualApplyShape(value.batch, definition);
}
/** Detached capture before awaiting the durable definition/current revision lookup. */
export function validateContextualProjectionRecoveryApplyInput(input: unknown): ProjectionValidationResult<ContextualProjectionRecoveryApplyRequest> {
  return validating(input, copy => contextualRecoveryApplyShape(copy));
}
function contextualRecoveryCurrent(input: unknown, binding: ProjectionBinding, revision: string): ProjectionRollbackRecoveryView {
  const current = unwrap(validateProjectionRollbackRecovery(input));
  check(canonical(current.binding) === canonical(binding), '/current/binding', 'Recovery snapshot belongs to another binding');
  if (current.revision !== revision) fail('/revision', 'Persisted projection revision differs', 'projection.stale-revision');
  return current;
}
function contextualRecoveryWriter(current: ProjectionRollbackRecoveryView): void {
  if (!current.initialized) fail('/current/initialized', 'Initialization has not completed', 'projection.not-initialized');
  if (current.rollback && current.rollback.status !== 'complete') {
    fail('/current/rollback', 'Recovery has not completed', 'projection.incomplete');
  }
}
/**
 * Check against an adapter-supplied durable snapshot. This pure check grants no authority:
 * adapters must recheck its revision/phase atomically with effects and original-batch receipts.
 * Pending/gap states permit exact source recovery; digest/ancestry admission remains adapter work.
 */
export function validateContextualProjectionRecoveryApply(definition: unknown, input: unknown,
  current: unknown): ProjectionValidationResult<ContextualProjectionRecoveryApplyRequest> {
  const selected = validateContextualProjectionDefinition(definition);
  if (!selected.valid) return selected;
  const checked = validating<{request: ContextualProjectionRecoveryApplyRequest; current: ProjectionRollbackRecoveryView}>(
    {request: input, current}, copy => {
      const value = record(copy, '');
      contextualRecoveryApplyShape(value.request, selected.value);
      const request = value.request as ContextualProjectionRecoveryApplyRequest;
      contextualRecoveryWriter(contextualRecoveryCurrent(value.current, request.batch.binding, request.revision));
    });
  return checked.valid ? {valid: true, value: checked.value.request} : checked;
}
/** Failure admission needs exact block identity, not a fabricated contextual batch or source time. */
export function validateContextualProjectionRecoveryIncomplete(input: unknown,
  current: unknown): ProjectionValidationResult<ProjectionRollbackIncompleteRequest> {
  const checked = validating<{request: ProjectionRollbackIncompleteRequest; current: ProjectionRollbackRecoveryView}>(
    {request: input, current}, copy => {
      const value = record(copy, '');
      const request = unwrap(validateProjectionRollbackIncomplete(value.request));
      contextualRecoveryWriter(contextualRecoveryCurrent(value.current, request.binding, request.revision));
    });
  return checked.valid ? {valid: true, value: checked.value.request} : checked;
}
/**
 * Reuse the existing admission/continuation/completion protocol. Only an exact retained operation
 * may use its original sourceRevision after rotation; maxBlocks is a scheduling budget, not identity.
 * Actual ancestry/undo availability and durable unavailable admission remain adapter obligations.
 */
export function validateContextualProjectionRecoveryRollback(input: unknown,
  current: unknown): ProjectionValidationResult<ProjectionRollbackRequest> {
  const checked = validating<{request: ProjectionRollbackRequest; current: ProjectionRollbackRecoveryView}>(
    {request: input, current}, copy => {
      const value = record(copy, '');
      const request = unwrap(validateProjectionRollbackRequest(value.request));
      const state = unwrap(validateProjectionRollbackRecovery(value.current));
      check(canonical(state.binding) === canonical(request.binding), '/current/binding', 'Recovery snapshot belongs to another binding');
      if (state.rollback?.operationId === request.operationId) {
        const operation = state.rollback;
        if (operation.sourceRevision !== request.revision || !sameCheckpoint(operation.from, request.from)
          || !sameCheckpoint(operation.ancestor, request.ancestor)) {
          fail('/request', 'Recovery operation identity was reused with different intent', 'projection.conflicting-replay');
        }
        if (operation.status === 'unavailable') fail('/current/rollback', operation.reason!, 'projection.rollback-unavailable');
      } else {
        contextualRecoveryWriter(contextualRecoveryCurrent(state, request.binding, request.revision));
        if (!sameCheckpoint(state.checkpoint, request.from)) {
          fail('/from', 'Recovery must start at the exact completed checkpoint', 'projection.stale-view');
        }
      }
    });
  return checked.valid ? {valid: true, value: checked.value.request} : checked;
}
/** Capture the unchanged logical query and require a coherent, ready, exact fenced read context. */
export function validateContextualProjectionRecoveryQuery(definition: unknown, view: unknown, query: unknown,
  current: unknown): ProjectionValidationResult<ContextualProjectionRecoveryQueryRequest> {
  const selected = validateContextualProjectionDefinition(definition);
  if (!selected.valid) return selected;
  const checked = validating<ContextualProjectionRecoveryQueryRequest & {current: ProjectionRollbackRecoveryView}>(
    {view, query, current}, copy => {
      const value = record(copy, '');
      const captured = unwrap(validateProjectionRollbackView(value.view));
      bindingShape(captured.binding, contextualRecordDefinition(selected.value), '/view/binding');
      queryShape(value.query, contextualRecordDefinition(selected.value));
      const state = contextualRecoveryCurrent(value.current, captured.binding, captured.revision);
      contextualRecoveryWriter(state);
      if (state.pending !== null || state.gap !== null) fail('/current', 'Source work is incomplete', 'projection.incomplete');
      if (!sameCheckpoint(state.checkpoint, captured.checkpoint)) {
        fail('/view/checkpoint', 'Read view differs from the exact completed checkpoint', 'projection.stale-view');
      }
    });
  return checked.valid ? {valid: true, value: freeze({view: checked.value.view, query: checked.value.query})} : checked;
}
/** Inspection is permitted during incomplete/recovery phases, but never under a stale revision. */
export function validateContextualProjectionRecoveryRetainedRequest(input: unknown,
  current: unknown): ProjectionValidationResult<ProjectionRetainedCheckpointRequest> {
  const checked = validating<{request: ProjectionRetainedCheckpointRequest; current: ProjectionRollbackRecoveryView}>(
    {request: input, current}, copy => {
      const value = record(copy, '');
      const request = unwrap(validateProjectionRetainedCheckpointRequest(value.request));
      contextualRecoveryCurrent(value.current, request.binding, request.revision);
    });
  return checked.valid ? {valid: true, value: checked.value.request} : checked;
}
