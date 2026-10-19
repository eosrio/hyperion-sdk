import {valid} from 'semver';
import {checkCompatibility, type CompatibilityEnvironment, type ComponentManifest, type Diagnostic} from './manifest.js';

/** Exact, inert artifact pin. An installed component is evidence of availability, not qualification. */
export interface ProtocolComponent {
  readonly id: string;
  readonly runtime: 'node' | 'rust';
  readonly version: string;
  /** Exact source commit for this component. */
  readonly sourceRevision: string;
  /** SHA-256 of the host-verified artifact or canonical artifact manifest. */
  readonly sha256: string;
}

export interface ProtocolProfile {
  readonly id: string;
  /** The coordinated component set required by this profile, including offline consumers. */
  readonly components: readonly ProtocolComponent[];
}

/** Read this JSON descriptor before importing an executable provider entry point. */
export interface ProtocolDescriptor {
  readonly interfaceVersion: 1;
  readonly manifest: ComponentManifest & {kind: 'protocol'};
  readonly profiles: readonly ProtocolProfile[];
}

export interface ProtocolSelection {
  readonly profileId: string;
  readonly environment: CompatibilityEnvironment;
  /** Installed artifacts discovered by the host without importing their executable entry points. */
  readonly components: readonly ProtocolComponent[];
}

export type ProtocolSelectionResult =
  | {valid: true; descriptor: ProtocolDescriptor; profile: ProtocolProfile}
  | {valid: false; errors: Diagnostic[]};

/** A session owns the advertised handshake and the selected protocol's scalar interpretation. */
export interface ProtocolShipSession {
  encodeRequest(request: unknown): Uint8Array;
  decodeResult(bytes: Uint8Array): unknown;
  decodeBlock(bytes: Uint8Array): unknown;
  decodeTraces(bytes: Uint8Array): unknown;
  decodeDeltas(bytes: Uint8Array): unknown;
  /** The host calls this before deciding whether it has a downstream handler for the stream. */
  decodeRow(stream: string, bytes: Uint8Array): unknown;
  /** Optional idempotent resource release; an implemented close invalidates subsequent session use. */
  close?(): void;
}

/** ABI is portable metadata. Implementations must preserve their protocol's complete ABI dialect. */
export interface ProtocolContractCodec<Abi = unknown> {
  decodeAbi(bytes: Uint8Array): Abi;
  encodeAbi(abi: Abi): Uint8Array;
  decodeValue(abi: Abi, type: string, bytes: Uint8Array): unknown;
  encodeValue(abi: Abi, type: string, value: unknown): Uint8Array;
}

/** Canonical deployment/fork selection belongs to the host; codecs must not infer a head ABI. */
export interface ProtocolSource {
  readonly chainId: string;
  readonly blockId: string;
  readonly blockNum: number;
  readonly ordinal: number;
  readonly abiDeployment: string;
}

export interface ProtocolPosition {
  readonly blockNum: number;
  readonly ordinal: number;
}

/** A deployment selected from the host's canonical view, never inferred by a codec. */
export interface ProtocolAbiDeployment<Abi = unknown> {
  readonly id: string;
  readonly from: ProtocolPosition;
  /** Exclusive end of this deployment's applicability. */
  readonly until?: ProtocolPosition;
  readonly abi: Abi;
  readonly abiHex: string;
}

export interface ProtocolDeltaInput {
  readonly stream: string;
  readonly present: boolean;
  readonly raw: Uint8Array;
  readonly value: unknown;
}

export interface ProtocolNormalizationContext<Abi = unknown> {
  readonly chainId: string;
  readonly blockId: string;
  readonly blockNum: number;
  readonly ordinal: number;
  /** Required when this stream depends on a contract's deployed ABI. */
  readonly abiDeployment?: ProtocolAbiDeployment<Abi>;
}

/** Complete logical identity is retained separately from any database's physical document ID. */
export type ProtocolNormalizedDelta =
  | {kind: 'passthrough'; value: unknown}
  | {kind: 'ignore'; reason: string}
  /** Request a position-bound deployment lookup before normalization can continue. */
  | {kind: 'abi-required'; account: string}
  | {kind: 'record'; identity: string; record: unknown; source: ProtocolSource;
    tableName: string; value?: unknown; metadata: Record<string, unknown>};

/** Providers are instantiated per chain/worker; executable loading belongs to the host. */
export interface ProtocolProvider<Abi = unknown> {
  readonly profileId: string;
  readonly contractCodec: ProtocolContractCodec<Abi>;
  createShipSession(handshake: unknown): ProtocolShipSession;
  /** Unknown required streams/features must throw; ignoring a known stream requires a reason. */
  normalizeDelta(input: ProtocolDeltaInput, context: ProtocolNormalizationContext<Abi>): ProtocolNormalizedDelta;
}

function fail(path: string, message: string, code = 'protocol.invalid-descriptor'): Diagnostic {
  return {code, path, message};
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/** Inspect JSON data without calling user-defined accessors or toJSON methods. */
function snapshot(input: unknown, path: string, state = {nodes: 0, characters: 0}, ancestors = new Set<object>(), depth = 0): unknown {
  if (++state.nodes > 65_536 || depth > 16) throw fail(path, 'Protocol metadata exceeds validation limits');
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    state.characters += input.length;
    if (state.characters > 4_194_304) throw fail(path, 'Protocol metadata exceeds validation limits');
    return input;
  }
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'object' || input === null || ancestors.has(input)) throw fail(path, 'Expected acyclic JSON metadata');
  const prototype = Object.getPrototypeOf(input);
  const array = Array.isArray(input);
  if ((!array && prototype !== null && prototype !== Object.prototype) || (array && prototype !== Array.prototype)) {
    throw fail(path, 'Expected plain JSON metadata');
  }
  if (Object.getOwnPropertySymbols(input).length) throw fail(path, 'Symbol metadata properties are unsupported');
  ancestors.add(input);
  const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
  const properties = Object.getOwnPropertyDescriptors(input);
  for (const [key, property] of Object.entries(properties)) {
    if (array && key === 'length') continue;
    if (!property.enumerable || !Object.hasOwn(property, 'value')) throw fail(path, 'Expected enumerable JSON data properties');
    if (array && !/^(0|[1-9][0-9]*)$/.test(key)) throw fail(path, 'Expected JSON array elements');
    const child = snapshot(property.value, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, state, ancestors, depth + 1);
    Object.defineProperty(output, key, {value: child, enumerable: true, configurable: true, writable: true});
  }
  if (array && Object.keys(output).length !== (input as unknown[]).length) throw fail(path, 'Sparse metadata arrays are unsupported');
  ancestors.delete(input);
  return output;
}

function keys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every(key => allowed.includes(key));
}

const identifier = /^[a-z][a-z0-9._-]{0,127}$/;
const exactVersion = (input: unknown): input is string => typeof input === 'string'
  && input.trim() === input && /^[0-9]/.test(input) && valid(input) !== null;

function components(input: unknown, path: string, errors: Diagnostic[]): ProtocolComponent[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 64) {
    errors.push(fail(path, 'Expected 1 to 64 exact component pins'));
    return undefined;
  }
  const result: ProtocolComponent[] = [];
  const seen = new Set<string>();
  for (const [index, component] of input.entries()) {
    const itemPath = `${path}/${index}`;
    if (!record(component) || !keys(component, ['id', 'runtime', 'version', 'sourceRevision', 'sha256'])
      || typeof component.id !== 'string' || !identifier.test(component.id)
      || (component.runtime !== 'node' && component.runtime !== 'rust') || !exactVersion(component.version)
      || typeof component.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(component.sourceRevision)
      || typeof component.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(component.sha256)) {
      errors.push(fail(itemPath, 'Expected a component identifier, node/rust runtime, exact version, source commit and SHA-256'));
      continue;
    }
    const key = `${component.runtime}:${component.id}`;
    if (seen.has(key)) errors.push(fail(itemPath, 'Duplicate component identifier and runtime', 'protocol.duplicate-component'));
    seen.add(key);
    result.push(Object.freeze({id: component.id, runtime: component.runtime, version: component.version,
      sourceRevision: component.sourceRevision, sha256: component.sha256}));
  }
  return result;
}

/**
 * Validate only inert metadata. This function does not import providers, load native code,
 * open a SHiP session, choose a backend, or establish tested runtime compatibility.
 * Successful output is a frozen snapshot, so later input mutation cannot change the selection.
 */
export function validateProtocolSelection(descriptor: unknown, selection: unknown): ProtocolSelectionResult {
  const errors: Diagnostic[] = [];
  for (const [path, value] of [['/descriptor', descriptor], ['/selection', selection]] as const) {
    try {
      const copy = snapshot(value, path);
      if (path === '/descriptor') descriptor = copy;
      else selection = copy;
    } catch {
      return {valid: false, errors: [fail(path, 'Expected bounded, plain, acyclic JSON metadata')]};
    }
  }
  if (!record(descriptor) || !keys(descriptor, ['interfaceVersion', 'manifest', 'profiles'])
    || descriptor.interfaceVersion !== 1) {
    return {valid: false, errors: [fail('/descriptor', 'Expected protocol descriptor interfaceVersion 1')]};
  }
  if (!record(selection) || !keys(selection, ['profileId', 'environment', 'components'])
    || typeof selection.profileId !== 'string' || !identifier.test(selection.profileId)) {
    return {valid: false, errors: [fail('/selection', 'Expected a selected profile, environment and installed components')]};
  }
  const compatibility = checkCompatibility(descriptor.manifest, selection.environment);
  errors.push(...compatibility.errors.map(error => ({...error,
    path: error.path.startsWith('/manifest') ? `/descriptor${error.path}` : `/selection${error.path}`})));
  if (!record(descriptor.manifest) || descriptor.manifest.kind !== 'protocol') {
    errors.push(fail('/descriptor/manifest/kind', 'A protocol descriptor requires a protocol component manifest'));
  }
  const profiles: ProtocolProfile[] = [];
  if (!Array.isArray(descriptor.profiles) || descriptor.profiles.length === 0 || descriptor.profiles.length > 64) {
    errors.push(fail('/descriptor/profiles', 'Expected 1 to 64 declared profiles'));
  } else {
    const ids = new Set<string>();
    for (const [index, profile] of descriptor.profiles.entries()) {
      const path = `/descriptor/profiles/${index}`;
      if (!record(profile) || !keys(profile, ['id', 'components']) || typeof profile.id !== 'string' || !identifier.test(profile.id)) {
        errors.push(fail(path, 'Expected a profile identifier and coordinated components'));
        continue;
      }
      if (ids.has(profile.id)) errors.push(fail(`${path}/id`, 'Duplicate profile identifier', 'protocol.duplicate-profile'));
      ids.add(profile.id);
      const pins = components(profile.components, `${path}/components`, errors);
      if (pins) profiles.push(Object.freeze({id: profile.id, components: Object.freeze(pins)}));
    }
  }
  const installed = components(selection.components, '/selection/components', errors);
  const profile = profiles.find(profile => profile.id === selection.profileId);
  if (!profile) errors.push(fail('/selection/profileId', 'Selected profile is not declared by this package', 'protocol.unknown-profile'));
  if (profile && installed) for (const required of profile.components) {
    const found = installed.find(entry => entry.id === required.id && entry.runtime === required.runtime);
    if (!found) errors.push(fail('/selection/components', `Missing ${required.runtime} component ${required.id}`, 'protocol.missing-component'));
    else if (found.version !== required.version) errors.push(fail('/selection/components', `Component ${required.id} requires exact version ${required.version}`, 'protocol.component-version-mismatch'));
    else if (found.sourceRevision !== required.sourceRevision) errors.push(fail('/selection/components', `Component ${required.id} source differs from the declared pin`, 'protocol.component-source-mismatch'));
    else if (found.sha256 !== required.sha256) errors.push(fail('/selection/components', `Component ${required.id} artifact differs from the declared digest`, 'protocol.component-integrity-mismatch'));
  }
  if (errors.length || !profile) return {valid: false, errors};
  const manifest = descriptor.manifest as ComponentManifest & {kind: 'protocol'};
  const manifestSnapshot = Object.freeze({
    schemaVersion: manifest.schemaVersion, package: manifest.package, version: manifest.version,
    kind: 'protocol' as const,
    compatibility: Object.freeze({hyperion: manifest.compatibility.hyperion, sdk: manifest.compatibility.sdk}),
  });
  return {valid: true, descriptor: Object.freeze({interfaceVersion: 1, manifest: manifestSnapshot, profiles: Object.freeze(profiles)}), profile};
}
