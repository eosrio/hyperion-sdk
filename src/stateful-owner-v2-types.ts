import type {ProjectionCheckpoint, ProjectionRollbackCoverage, ProjectionRollbackState} from './projection.js';
import type {CapturedRawStatefulTarget, RawStatefulTarget} from './internal/stateful-input-v2.js';
import type {CapturedStatefulSourceV2, StatefulSourceV2} from './projection-stateful-source-v2.js';
import type {StatefulApplyResult, StatefulDeclaration, StatefulGuard, StatefulKey, StatefulLimits, StatefulMutation,
  StatefulObservation, StatefulQueryRead, StatefulRead, StatefulRollback, StatefulView} from './stateful-types.js';
import type {StructuredRecord} from './internal/structured-values.js';

export type RawStatefulTargetV2 = RawStatefulTarget;
export type CapturedRawStatefulTargetV2 = CapturedRawStatefulTarget;
export interface StatefulOwnerDeclarationV2 {
  readonly family: 'stateful-projection-owner-recovery'; readonly interfaceVersion: 2;
  readonly sourceInputVersion: 2; readonly projection: StatefulDeclaration; readonly digest: string;
}
export interface StatefulOwnerCapabilitiesV2 {
  readonly family: 'stateful-projection-owner-recovery'; readonly interfaceVersion: 2;
  readonly sourceInputVersions: readonly [2]; readonly supported: readonly string[]; readonly limits: StatefulLimits;
}
export interface StatefulOwnerIdentityV2 {readonly id: string; readonly generation: string}
export interface StatefulOwnerClaimV2 {readonly identity: StatefulOwnerIdentityV2; readonly claimDigest: string}
export interface StatefulRawAdmissionV2 {
  /** The original target is retained across owner takeover; its original owner is not rewritten. */
  readonly target: CapturedRawStatefulTargetV2; readonly sourceDigest: string | null;
}
export type StatefulFailureV2 =
  | {readonly kind: 'raw'; readonly targetDigest: string; readonly block: ProjectionCheckpoint; readonly reason: string}
  | {readonly kind: 'source'; readonly targetDigest: string; readonly sourceDigest: string;
      readonly block: ProjectionCheckpoint; readonly reason: string};
/** Native inspection DTO only. No field here grants canonicality, reduction or API readiness. */
export interface StatefulOwnerRecoveryV2 {
  readonly interfaceVersion: 2; readonly sourceInputVersion: 2; readonly version: string;
  readonly view: StatefulView; readonly initialized: boolean; readonly owner: StatefulOwnerClaimV2 | null;
  readonly raw: StatefulRawAdmissionV2 | null;
  readonly pending: {readonly sourceDigest: string; readonly candidateDigest: string} | null;
  readonly gap: StatefulFailureV2 | null; readonly rollback: ProjectionRollbackState | null;
  readonly coverage: ProjectionRollbackCoverage;
}
export interface StatefulOwnerAcquireV2 {
  /** null is explicit fresh storage bootstrap, never adoption of a v1 namespace. */
  readonly expected: {readonly version: string; readonly view: StatefulView; readonly owner: StatefulOwnerClaimV2 | null} | null;
  readonly nextOwner: StatefulOwnerIdentityV2;
}
declare const ownerBrand: unique symbol, reductionBrand: unique symbol, completedBrand: unique symbol;
/** Runtime issued by one native adapter instance, never by a serialized DTO or a copied object. */
export interface StatefulOwnerLeaseV2 {readonly [ownerBrand]: true}
export interface StatefulReductionReadV2 {readonly [reductionBrand]: true}
export interface StatefulCompletedReadV2 {readonly [completedBrand]: true}
export interface StatefulCandidateV2 {
  readonly declarationDigest: string; readonly source: CapturedStatefulSourceV2; readonly view: StatefulView;
  readonly observations: readonly StatefulObservation[]; readonly mutations: readonly StatefulMutation[]; readonly digest: string;
}
export interface StatefulCandidateStoreV2 {
  load(declarationDigest: string, sourceDigest: string): Promise<unknown | null>;
  retain(candidate: StatefulCandidateV2): Promise<void>;
}
export interface StatefulReductionV2 {
  readonly source: StatefulSourceV2; readonly view: StatefulView;
  get(kind: string, key: string): Promise<Exclude<StatefulRead, {status: 'unavailable'}>>;
  put(kind: string, key: string, value: unknown): void; delete(kind: string, key: string): void;
}
export interface StatefulOwnedInspectionV2 {
  readonly phase: 'idle' | 'raw' | 'bound' | 'failed' | 'pending' | 'rollback';
  readonly status: 'new' | 'pending' | 'committed' | 'uncovered';
  readonly targetDigest: string | null; readonly sourceDigest: string | null; readonly candidateDigest: string | null;
  readonly progress: StatefulView;
}
/**
 * Host/native recovery extension. Plugins receive only the bounded SDK reduction/query callbacks,
 * never this port, the worker-local owner lease, or either private native read capability.
 * Every issued capability retains its actual host guard before/after native awaits.
 */
export interface StatefulOwnerAdapterV2 {
  readonly capabilities: StatefulOwnerCapabilitiesV2;
  recovery(): Promise<StatefulOwnerRecoveryV2 | null>;
  acquireOwner(request: StatefulOwnerAcquireV2, guard: StatefulGuard): Promise<StatefulOwnerLeaseV2>;
  admitRaw(lease: StatefulOwnerLeaseV2, target: CapturedRawStatefulTargetV2): Promise<void>;
  markRawFailure(lease: StatefulOwnerLeaseV2, targetDigest: string, reason: string): Promise<void>;
  markSourceFailure(lease: StatefulOwnerLeaseV2, targetDigest: string, sourceDigest: string, reason: string): Promise<void>;
  bindSource(lease: StatefulOwnerLeaseV2, targetDigest: string, source: CapturedStatefulSourceV2): Promise<void>;
  reductionRead(lease: StatefulOwnerLeaseV2, targetDigest: string, sourceDigest: string): Promise<StatefulReductionReadV2>;
  reductionView(read: StatefulReductionReadV2): Promise<StatefulView>;
  readReduction(read: StatefulReductionReadV2, expected: StatefulView, keys: readonly StatefulKey[]):
    Promise<{readonly view: StatefulView; readonly results: readonly StatefulRead[]}>;
  inspectOwned(lease: StatefulOwnerLeaseV2, targetDigest: string, source: CapturedStatefulSourceV2): Promise<StatefulOwnedInspectionV2>;
  applyOwned(lease: StatefulOwnerLeaseV2, targetDigest: string, candidate: StatefulCandidateV2): Promise<StatefulApplyResult>;
  retireRaw(lease: StatefulOwnerLeaseV2, targetDigest: string, sourceDigest: string, candidateDigest: string): Promise<void>;
  rollbackOwned(lease: StatefulOwnerLeaseV2, request: StatefulRollback):
    Promise<{readonly status: 'in-progress' | 'rolled-back' | 'duplicate'; readonly recovery: StatefulOwnerRecoveryV2}>;
  retainedCheckpoints(lease: StatefulOwnerLeaseV2):
    Promise<{readonly recovery: StatefulOwnerRecoveryV2; readonly checkpoints: readonly ProjectionCheckpoint[]}>;
  /** API-local only: actual host live-owner/request authority is additional to native owner/view checks. */
  completedRead(expectedOwner: StatefulOwnerIdentityV2, expectedView: StatefulView, authority: StatefulGuard): Promise<StatefulCompletedReadV2>;
  completedView(read: StatefulCompletedReadV2): Promise<StatefulView>;
  readCompleted(read: StatefulCompletedReadV2, expected: StatefulView, keys: readonly StatefulKey[]):
    Promise<{readonly view: StatefulView; readonly results: readonly StatefulRead[]}>;
  closeRead(read: StatefulReductionReadV2 | StatefulCompletedReadV2): void;
}
export interface StatefulQueryHostV2 {
  compose(projectionId: string, compose: (reader: StatefulQueryRead) => Promise<StructuredRecord>):
    Promise<{readonly view: StatefulView; readonly value: StructuredRecord}>;
}
