import type {IntegerField, StructuredRecord, StructuredValueLimits} from './internal/structured-values.js';
import type {ProjectionCheckpoint, ProjectionRollbackCoverage, ProjectionRollbackState} from './projection.js';
export type {IntegerField as StatefulIntegerField, StructuredRecord as StatefulRecord, StructuredValueLimits as StatefulValueLimits};
export interface StatefulLimits {
  readonly value: StructuredValueLimits;
  /** Whole declaration/source/candidate/read-response traversal, distinct from each stored record. */
  readonly envelope: StructuredValueLimits;
  readonly selectors: number; readonly recordKinds: number;
  readonly inputOccurrences: number; readonly inputBytes: number; readonly keyBytes: number;
  readonly readKeys: number; readonly readAttempts: number; readonly mutations: number;
  readonly candidateBytes: number; readonly responseRecords: number; readonly responseBytes: number;
}
export interface StatefulSelector {
  readonly id: string; readonly kind: 'action' | 'table'; readonly contract: string; readonly name: string;
  readonly abiDeployment: string; readonly abiSha256: string;
}
export interface StatefulDefinition {
  readonly family: 'stateful-projection-recovery'; readonly interfaceVersion: 1; readonly id: string;
  readonly binding: {readonly chainId: string; readonly backendId: string; readonly generation: string;
    readonly mappingRevision: string; readonly hookArtifact: string; readonly hookRevision: string;
    readonly codecRevision: string; readonly normalizerRevision: string};
  readonly selectors: readonly StatefulSelector[];
  readonly records: readonly {readonly kind: string; readonly integers: readonly IntegerField[]}[];
}
export interface StatefulDeclaration {readonly definition: StatefulDefinition; readonly limits: StatefulLimits; readonly digest: string}
export interface StatefulCapabilities {
  readonly family: 'stateful-projection-recovery'; readonly interfaceVersion: 1;
  readonly supported: readonly string[]; readonly limits: StatefulLimits;
}
interface Occurrence {
  readonly selector: string; readonly order: number; readonly contract: string; readonly name: string;
  readonly abiDeployment: string; readonly abiSha256: string; readonly mappingRevision: string;
  readonly codecRevision: string; readonly normalizerRevision: string;
  readonly rawHex: string; readonly rawSha256: string; readonly sourceEvidence: string;
}
export type StatefulInput = Occurrence & (
  {readonly kind: 'action'; readonly transactionId: string; readonly actionOrdinal: number;
    readonly receiver: string; readonly receiptOrdinal: number; readonly sequence: string | null; readonly data: StructuredRecord}
  | {readonly kind: 'table'; readonly transactionId: string | null; readonly scope: string; readonly primaryKey: string;
    readonly present: boolean; readonly deltaOrdinal: number; readonly rowOrdinal: number; readonly data: StructuredRecord | null});
export interface StatefulSource {
  readonly previous: ProjectionCheckpoint;
  readonly block: ProjectionCheckpoint & {readonly previousBlockId: string; readonly timeMs: string};
  readonly inputs: readonly StatefulInput[];
}
export interface CapturedStatefulSource {readonly declarationDigest: string; readonly source: StatefulSource; readonly digest: string}
export interface StatefulView {
  readonly declarationDigest: string; readonly backendId: string; readonly generation: string;
  readonly revision: string; readonly checkpoint: ProjectionCheckpoint;
}
export interface StatefulKey {readonly kind: string; readonly key: string}
export type StatefulRead = {readonly status: 'present'; readonly value: StructuredRecord}
  | {readonly status: 'covered-absent'} | {readonly status: 'unavailable'; readonly reason: string};
export interface StatefulObservation {readonly key: StatefulKey; readonly result: Exclude<StatefulRead, {status: 'unavailable'}>}
export type StatefulMutation = {readonly kind: 'put'; readonly target: StatefulKey; readonly value: StructuredRecord}
  | {readonly kind: 'delete'; readonly target: StatefulKey};
export interface StatefulCandidate {
  readonly declarationDigest: string; readonly source: CapturedStatefulSource; readonly view: StatefulView;
  readonly observations: readonly StatefulObservation[]; readonly mutations: readonly StatefulMutation[]; readonly digest: string;
}
/** This is progress metadata, never permission to serve. open/read still enforce readiness. */
export interface StatefulApplyResult {readonly status: 'applied' | 'duplicate'; readonly progress: StatefulView}
export interface StatefulInspection {
  readonly phase: 'ready' | 'pending' | 'gap' | 'rollback';
  readonly status: 'new' | 'pending' | 'committed' | 'uncovered';
  readonly sourceDigest: string | null; readonly candidateDigest: string | null; readonly progress: StatefulView;
}
export interface StatefulRecovery {
  readonly view: StatefulView; readonly initialized: boolean;
  readonly pending: {readonly sourceDigest: string; readonly candidateDigest: string} | null;
  readonly gap: {readonly sourceDigest: string; readonly block: ProjectionCheckpoint; readonly reason: string} | null;
  readonly rollback: ProjectionRollbackState | null;
  readonly coverage: ProjectionRollbackCoverage;
}
export interface StatefulRollback {
  readonly declarationDigest: string; readonly revision: string; readonly operationId: string;
  readonly from: ProjectionCheckpoint; readonly ancestor: ProjectionCheckpoint; readonly maxBlocks: number;
}
/**
 * Adapters atomically recheck declaration/revision/checkpoint/phase with effects, original receipt,
 * one pre-block before-image per changed key and progress. Retry only this fixed plan, never hooks.
 * inspect may resolve an unknown commit; it must not bypass pending/gap/rollback or expired receipts.
 * rollback reuses durable revision rotation, exact operation retry, bounded undo and retained coverage.
 * No new begin/finish protocol or canonical-branch authority is supplied by this interface.
 */
export interface StatefulAdapter {
  readonly capabilities: StatefulCapabilities;
  initialize(declaration: StatefulDeclaration): Promise<StatefulView>;
  open(declaration: StatefulDeclaration): Promise<StatefulView>;
  read(view: StatefulView, keys: readonly StatefulKey[]): Promise<{readonly view: StatefulView; readonly results: readonly StatefulRead[]}>;
  inspect(declaration: StatefulDeclaration, source: CapturedStatefulSource): Promise<StatefulInspection>;
  apply(candidate: StatefulCandidate): Promise<StatefulApplyResult>;
  recovery(declaration: StatefulDeclaration): Promise<StatefulRecovery>;
  markIncomplete(declaration: StatefulDeclaration, view: StatefulView, source: CapturedStatefulSource, reason: string): Promise<void>;
  rollback(request: StatefulRollback): Promise<{readonly status: 'in-progress' | 'rolled-back' | 'duplicate'; readonly recovery: StatefulRecovery}>;
  retainedCheckpoints(declaration: StatefulDeclaration, revision: string): Promise<{readonly recovery: StatefulRecovery; readonly checkpoints: readonly ProjectionCheckpoint[]}>;
}
/** Host-owned bounded durable input custody, retained before any adapter commit attempt. */
export interface StatefulCandidateStore {
  load(declarationDigest: string, sourceDigest: string): Promise<unknown | null>;
  retain(candidate: StatefulCandidate): Promise<void>;
}
/** Host checks cancellation/deadline AND source/canonical/ABI ownership; DTOs never replace it. */
export type StatefulGuard = () => void;
export interface StatefulQueryRead {
  readonly view: StatefulView;
  get(kind: string, key: string): Promise<Exclude<StatefulRead, {status: 'unavailable'}>>;
}
export interface StatefulReduction {
  readonly source: StatefulSource; readonly view: StatefulView;
  get(kind: string, key: string): Promise<Exclude<StatefulRead, {status: 'unavailable'}>>;
  put(kind: string, key: string, value: unknown): void;
  delete(kind: string, key: string): void;
}
