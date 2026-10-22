import type {Diagnostic} from './manifest.js';
import type {ProtocolAbiActionAnchor, ProtocolBlockAbiSource} from './protocol.js';

/** Inert requirement; it does not import a provider or authorize native decoding. */
export interface ProtocolNativeActionRequirement {
  readonly interfaceVersion: 1;
}

/** Original retained sections under the selected provider, before host filtering or mutation. */
export interface ProtocolNativeActionBlockInput {
  readonly schemaJson: string;
  readonly block: Uint8Array;
  readonly traces: Uint8Array;
}

/** The first receiver's occurrence, not a notification's allocated action ordinal. */
export interface ProtocolNativeActionOrigin extends ProtocolAbiActionAnchor {
  /** Lowercase SHA-256 of the exact original action bytes, including empty bytes. */
  readonly rawSha256: string;
}

export type ProtocolNativeActionDecision =
  | {readonly origin: ProtocolNativeActionOrigin; readonly kind: 'contract'}
  | {readonly origin: ProtocolNativeActionOrigin; readonly kind: 'native'; readonly nativeKind: string}
  | {readonly origin: ProtocolNativeActionOrigin; readonly kind: 'incomplete';
    readonly error: {readonly code: string; readonly message: string}};

/** Detached labels only: no canonical membership, durability, decoding or readiness authority. */
export interface ProtocolNativeActionObservations {
  readonly schemaVersion: 1;
  readonly decisions: readonly ProtocolNativeActionDecision[];
}

/** ABI-independent native values remain separate from the deployed contract codec. */
export interface ProtocolNativeActions extends ProtocolNativeActionRequirement {
  /**
   * Observe full original source without mutation. Match first-receiver origins and raw digests;
   * notifications can inherit only after the host binds their certified inputActionOrdinal.
   * Ambiguous or unsupported work is incomplete per origin, never a contract-ABI fallback.
   */
  observe(input: ProtocolNativeActionBlockInput, source: ProtocolBlockAbiSource): ProtocolNativeActionObservations;
  /** A host-authorized opaque kind, never inferred from an action/type name or decode outcome. */
  decodeValue(nativeKind: string, bytes: Uint8Array): unknown;
  /** Strictly reproduce original bytes; schema selection belongs to this pinned provider. */
  encodeValue(nativeKind: string, value: unknown): Uint8Array;
}

export type ProtocolNativeActionsValidationResult =
  | {valid: true; nativeActions: ProtocolNativeActions}
  | {valid: false; errors: Diagnostic[]};

export type ProtocolNativeActionObservationsValidationResult =
  | {valid: true; observations: ProtocolNativeActionObservations}
  | {valid: false; errors: Diagnostic[]};

export const protocolNativeActionBounds = Object.freeze({
  decisions: 100_000,
  kindCharacters: 256,
  codeCharacters: 128,
  messageCharacters: 4096,
  totalCharacters: 64 * 1024 * 1024,
});

const digest = /^[0-9a-f]{64}$/;
const diagnostics = new WeakSet<object>();
function invalid(path: string, message: string, code = 'protocol.invalid-native-observations'): Diagnostic {
  const value = {path, message, code};
  diagnostics.add(value);
  return value;
}
const ownDiagnostic = (error: unknown): error is Diagnostic =>
  typeof error === 'object' && error !== null && diagnostics.has(error);
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum && wellFormed(value);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read only plain, enumerable data. No getter, toJSON or iterator is invoked. */
function dataRecord(input: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  if (!object(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length) throw invalid(path, 'Expected plain JSON data');
  const properties = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(properties).some(key => !allowed.includes(key))) throw invalid(path, 'Unexpected observation field');
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, property] of Object.entries(properties)) {
    if (!property.enumerable || !Object.hasOwn(property, 'value')) throw invalid(path, 'Expected enumerable data properties');
    output[key] = property.value;
  }
  return output;
}

function required(input: Record<string, unknown>, fields: readonly string[], path: string): void {
  if (Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field))) {
    throw invalid(path, 'Missing or incompatible observation fields');
  }
}

/**
 * Check already-loaded executable methods against an inert selected requirement, without calling
 * them. The frozen method snapshot preserves its receiver. This grants no source authority.
 */
export function validateProtocolNativeActions(input: unknown,
  requirement: ProtocolNativeActionRequirement): ProtocolNativeActionsValidationResult {
  const path = '/nativeActions';
  try {
    const requested = dataRecord(requirement, ['interfaceVersion'], '/requirement');
    required(requested, ['interfaceVersion'], '/requirement');
    if (requested.interfaceVersion !== 1) {
      return {valid: false, errors: [invalid('/requirement/interfaceVersion',
        'Unsupported native action interface version', 'protocol.unsupported-native-interface')]};
    }
    if (!object(input)) throw invalid(path, 'Expected a native action capability', 'protocol.invalid-native-actions');
    const properties = Object.getOwnPropertyDescriptors(input);
    const fields = ['interfaceVersion', 'observe', 'decodeValue', 'encodeValue'] as const;
    if (fields.some(field => !properties[field] || !Object.hasOwn(properties[field]!, 'value'))) {
      throw invalid(path, 'Expected own data properties for the version and native action methods', 'protocol.invalid-native-actions');
    }
    if (properties.interfaceVersion!.value !== requested.interfaceVersion) {
      throw invalid(path + '/interfaceVersion', 'Native action implementation differs from the selected requirement',
        'protocol.native-interface-mismatch');
    }
    if (fields.slice(1).some(field => typeof properties[field]!.value !== 'function')) {
      throw invalid(path, 'Expected observe, decodeValue and encodeValue methods', 'protocol.invalid-native-actions');
    }
    const observe = properties.observe!.value as ProtocolNativeActions['observe'];
    const decodeValue = properties.decodeValue!.value as ProtocolNativeActions['decodeValue'];
    const encodeValue = properties.encodeValue!.value as ProtocolNativeActions['encodeValue'];
    return {valid: true, nativeActions: Object.freeze({interfaceVersion: 1,
      observe: observe.bind(input), decodeValue: decodeValue.bind(input), encodeValue: encodeValue.bind(input)})};
  } catch (error) {
    return {valid: false, errors: [ownDiagnostic(error)
      ? {...error, code: error.code === 'protocol.invalid-native-observations' ? 'protocol.invalid-native-actions' : error.code}
      : invalid(path, 'Unreadable native action capability', 'protocol.invalid-native-actions')]};
  }
}

/**
 * Validate bounded detached labels and return an immutable snapshot. The host must separately match
 * every origin/raw digest to its selected original source and revalidate canonical/fork authority.
 * An empty list cannot prove that a source had no actions or that classification was complete.
 */
export function validateProtocolNativeActionObservations(input: unknown): ProtocolNativeActionObservationsValidationResult {
  const path = '/observations';
  try {
    const value = dataRecord(input, ['schemaVersion', 'decisions'], path);
    required(value, ['schemaVersion', 'decisions'], path);
    if (value.schemaVersion !== 1) throw invalid(path + '/schemaVersion', 'Expected native observations schemaVersion 1');
    const list = value.decisions;
    if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype || Object.getOwnPropertySymbols(list).length) {
      throw invalid(path + '/decisions', 'Expected a plain decision array');
    }
    const length = Object.getOwnPropertyDescriptor(list, 'length')?.value;
    if (!Number.isSafeInteger(length) || length > protocolNativeActionBounds.decisions) {
      throw invalid(path + '/decisions', 'Native decision count exceeds its bound');
    }
    const properties = Object.getOwnPropertyDescriptors(list);
    if (Object.keys(properties).length !== length + 1) throw invalid(path + '/decisions', 'Expected a dense decision array');
    const decisions: ProtocolNativeActionDecision[] = [], seen = new Set<string>();
    let characters = 0;
    for (let index = 0; index < length; index++) {
      const itemPath = path + '/decisions/' + index;
      const property = properties[String(index)];
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw invalid(itemPath, 'Expected a decision data element');
      const decision = dataRecord(property.value, ['origin', 'kind', 'nativeKind', 'error'], itemPath);
      const anchor = dataRecord(decision.origin, ['transactionId', 'actionOrdinal', 'rawSha256'], itemPath + '/origin');
      required(anchor, ['transactionId', 'actionOrdinal', 'rawSha256'], itemPath + '/origin');
      if (typeof anchor.transactionId !== 'string' || !digest.test(anchor.transactionId)
        || !Number.isSafeInteger(anchor.actionOrdinal) || Number(anchor.actionOrdinal) < 1
        || typeof anchor.rawSha256 !== 'string' || !digest.test(anchor.rawSha256)) {
        throw invalid(itemPath + '/origin', 'Expected a first-receiver anchor and lowercase raw SHA-256');
      }
      const key = anchor.transactionId + ':' + anchor.actionOrdinal;
      if (seen.has(key)) throw invalid(itemPath + '/origin', 'Duplicate first-receiver decision', 'protocol.duplicate-native-origin');
      seen.add(key);
      const origin = Object.freeze({transactionId: anchor.transactionId, actionOrdinal: Number(anchor.actionOrdinal),
        rawSha256: anchor.rawSha256});
      characters += origin.transactionId.length + origin.rawSha256.length;
      if (decision.kind === 'contract') {
        required(decision, ['origin', 'kind'], itemPath);
        decisions.push(Object.freeze({origin, kind: 'contract'}));
      } else if (decision.kind === 'native') {
        required(decision, ['origin', 'kind', 'nativeKind'], itemPath);
        if (!text(decision.nativeKind, protocolNativeActionBounds.kindCharacters)) {
          throw invalid(itemPath + '/nativeKind', 'Expected a bounded opaque native kind');
        }
        characters += decision.nativeKind.length;
        decisions.push(Object.freeze({origin, kind: 'native', nativeKind: decision.nativeKind}));
      } else if (decision.kind === 'incomplete') {
        required(decision, ['origin', 'kind', 'error'], itemPath);
        const error = dataRecord(decision.error, ['code', 'message'], itemPath + '/error');
        required(error, ['code', 'message'], itemPath + '/error');
        if (!text(error.code, protocolNativeActionBounds.codeCharacters)
          || !text(error.message, protocolNativeActionBounds.messageCharacters)) {
          throw invalid(itemPath + '/error', 'Expected a bounded incomplete reason');
        }
        characters += error.code.length + error.message.length;
        decisions.push(Object.freeze({origin, kind: 'incomplete', error: Object.freeze({code: error.code, message: error.message})}));
      } else throw invalid(itemPath + '/kind', 'Expected contract, native or incomplete');
      characters += decision.kind.length;
      if (characters > protocolNativeActionBounds.totalCharacters) throw invalid(path, 'Native observations exceed the text budget');
    }
    return {valid: true, observations: Object.freeze({schemaVersion: 1, decisions: Object.freeze(decisions)})};
  } catch (error) {
    return {valid: false, errors: [ownDiagnostic(error) ? error : invalid(path, 'Unreadable native action observations')]};
  }
}
