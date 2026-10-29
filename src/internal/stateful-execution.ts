import type {ProjectionCheckpoint} from '../projection.js';
import type {StructuredRecord} from './structured-values.js';
import type {StatefulApplyResult, StatefulGuard, StatefulKey, StatefulLimits, StatefulMutation,
  StatefulObservation, StatefulQueryRead, StatefulRead, StatefulView} from '../stateful-types.js';

export interface ExecutionSource {
  readonly declarationDigest: string; readonly digest: string;
  readonly source: {readonly previous: ProjectionCheckpoint; readonly block: ProjectionCheckpoint;
    readonly inputs: readonly unknown[]};
}
export interface ExecutionCandidate<S extends ExecutionSource> {
  readonly declarationDigest: string; readonly source: S; readonly view: StatefulView;
  readonly observations: readonly StatefulObservation[]; readonly mutations: readonly StatefulMutation[]; readonly digest: string;
}
export interface ExecutionInspection {
  readonly status: 'new' | 'pending' | 'committed' | 'uncovered';
  readonly sourceDigest: string | null; readonly candidateDigest: string | null; readonly progress: StatefulView;
  /** Internal execution permission after the selected family's exact phase/owner checks; never serving. */
  readonly mayReduce: boolean;
}
/** Validation policy only. V1 and owner-v2 use their real captures, never translated input or ready phases. */
export interface ExecutionPolicy<S extends ExecutionSource, C extends ExecutionCandidate<S>> {
  readonly digest: string; readonly limits: StatefulLimits;
  admit(): void;
  error(code: string, message: string): Error;
  detach<T>(input: unknown, maximumBytes?: number): T;
  canonical(input: unknown): string; hash(text: string): Promise<string>;
  source(input: unknown): Promise<S>; candidate(input: unknown): Promise<C>;
  view(input: unknown): StatefulView; assertView(current: unknown, expected: unknown): void;
  inspection(input: unknown): ExecutionInspection;
  key(input: unknown): StatefulKey; mutation(input: unknown): StatefulMutation;
  readValue(key: StatefulKey, input: unknown): StatefulRead;
}
export interface ExecutionReadPort {
  currentView(): Promise<StatefulView>;
  read(expected: StatefulView, keys: readonly StatefulKey[]): Promise<unknown>;
}
export interface ExecutionPort<S extends ExecutionSource, C extends ExecutionCandidate<S>> extends ExecutionReadPort {
  inspect(source: S): Promise<unknown>; apply(candidate: C): Promise<unknown>;
}
export interface ExecutionCustody<C> {
  load(declarationDigest: string, sourceDigest: string): Promise<unknown | null>;
  retain(candidate: C): Promise<void>;
}
export interface ExecutionReduction<S extends ExecutionSource> {
  readonly source: S['source']; readonly view: StatefulView;
  get(kind: string, key: string): Promise<Exclude<StatefulRead, {status: 'unavailable'}>>;
  put(kind: string, key: string, value: unknown): void; delete(kind: string, key: string): void;
}
function check(p: {error(code: string, message: string): Error}, ok: unknown, message: string,
  code = 'stateful.invalid-contract'): asserts ok {if (!ok) throw p.error(code, message);}
function fields(p: {error(code: string, message: string): Error}, value: unknown, names: readonly string[]):
  asserts value is Record<string, unknown> {
  check(p, typeof value === 'object' && value !== null && !Array.isArray(value), 'Expected a record');
  check(p, Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), 'Unexpected record fields');
}
const same = (p: {canonical(input: unknown): string}, left: unknown, right: unknown) => p.canonical(left) === p.canonical(right);
async function guarded<T>(guard: StatefulGuard, operation: () => Promise<T>): Promise<T> {
  guard(); try {return await operation();} finally {guard();}
}

export async function executionReads<S extends ExecutionSource, C extends ExecutionCandidate<S>>(p: ExecutionPolicy<S, C>,
  port: ExecutionReadPort, expected: StatefulView, requested: readonly StatefulKey[], guard: StatefulGuard): Promise<readonly StatefulRead[]> {
  p.admit();
  guard(); const view = p.view(expected), limits = p.limits;
  const selected = p.detach<{keys: readonly StatefulKey[]}>({keys: requested}).keys;
  check(p, Array.isArray(selected) && selected.length <= limits.readKeys && selected.length <= limits.responseRecords, 'Key/read response bound');
  const selectedKeys = selected.map(key => p.key(key));
  p.assertView(await guarded(guard, () => port.currentView()), view);
  const raw = await guarded(guard, () => port.read(view, selectedKeys));
  const answer = p.detach<{view: StatefulView; results: readonly StatefulRead[]}>(raw, limits.responseBytes);
  fields(p, answer, ['results', 'view']);
  check(p, Array.isArray(answer.results) && answer.results.length === selectedKeys.length, 'Incomplete keyed response');
  p.assertView(answer.view, view);
  const results = answer.results.map((result, index) => p.readValue(selectedKeys[index]!, result));
  p.assertView(await guarded(guard, () => port.currentView()), view); guard();
  return Object.freeze(results);
}

export async function executionCompose<S extends ExecutionSource, C extends ExecutionCandidate<S>>(p: ExecutionPolicy<S, C>,
  port: ExecutionReadPort, expected: StatefulView, compose: (reader: StatefulQueryRead) => Promise<unknown>, guard: StatefulGuard):
  Promise<{readonly view: StatefulView; readonly value: StructuredRecord}> {
  p.admit();
  guard(); const view = p.view(expected), limits = p.limits;
  p.assertView(await guarded(guard, () => port.currentView()), view);
  let active = true, attempts = 0, records = 0, bytes = 0;
  const admit = () => {guard(); check(p, active, 'Query read port is closed');};
  const reader: StatefulQueryRead = Object.freeze({view, async get(kind: string, key: string) {
    admit(); check(p, ++attempts <= limits.readAttempts && ++records <= limits.responseRecords, 'Composed read/record bound');
    const result = (await executionReads(p, port, view, [{kind, key}], guard))[0]; admit();
    check(p, result && result.status !== 'unavailable', 'Required query coverage unavailable', 'stateful.unavailable');
    bytes += new TextEncoder().encode(p.canonical({result})).length;
    check(p, bytes <= limits.responseBytes, 'Composed read byte bound'); return result;
  }});
  let result: unknown;
  try {result = await guarded(guard, () => compose(reader));} finally {active = false;}
  p.assertView(await guarded(guard, () => port.currentView()), view);
  const value = p.detach<StructuredRecord>(result, limits.responseBytes); guard(); return Object.freeze({view, value});
}

export async function executionReduce<S extends ExecutionSource, C extends ExecutionCandidate<S>>(p: ExecutionPolicy<S, C>,
  selectedSource: S, port: ExecutionReadPort, hook: (reader: ExecutionReduction<S>) => Promise<void>, guard: StatefulGuard): Promise<C> {
  p.admit();
  guard(); const selected = p.detach<S>(selectedSource);
  const original = await guarded(guard, () => p.source(selected.source));
  check(p, same(p, original, selected), 'Source capture identity differs');
  const view = p.view(await guarded(guard, () => port.currentView()));
  check(p, same(p, view.checkpoint, original.source.previous), 'Reduction predecessor is not current', 'stateful.stale-view');
  const overlay = new Map<string, Exclude<StatefulRead, {status: 'unavailable'}>>(), base = new Map<string, StatefulObservation>(), mutations: StatefulMutation[] = [];
  const limits = p.limits; let attempts = 0, stagedBytes = 0, active = true;
  const admit = () => {guard(); check(p, active, 'Reduction port is closed');};
  const stage = (input: unknown) => {
    admit(); check(p, mutations.length < limits.mutations, 'Mutation bound'); const item = p.mutation(input);
    stagedBytes += new TextEncoder().encode(p.canonical(item)).length; check(p, stagedBytes <= limits.candidateBytes, 'Staged candidate byte bound');
    mutations.push(item); overlay.set(JSON.stringify(item.target), item.kind === 'put' ? Object.freeze({status: 'present', value: item.value}) : Object.freeze({status: 'covered-absent'}));
  };
  const reader: ExecutionReduction<S> = Object.freeze({source: original.source, view, async get(kind: string, value: string) {
    admit(); check(p, ++attempts <= limits.readAttempts && limits.readKeys >= 1, 'Read attempt bound');
    const key = p.key({kind, key: value}), id = JSON.stringify(key), staged = overlay.get(id); if (staged) return staged;
    const cached = base.get(id); if (cached) return cached.result;
    const [result] = await executionReads(p, port, view, [key], guard); admit();
    check(p, result && result.status !== 'unavailable', 'Required source/relationship coverage unavailable', 'stateful.unavailable');
    base.set(id, Object.freeze({key, result})); return result;
  }, put: (kind: string, key: string, value: unknown) => stage({kind: 'put', target: {kind, key}, value}),
    delete: (kind: string, key: string) => stage({kind: 'delete', target: {kind, key}})});
  try {await guarded(guard, () => hook(reader));} finally {active = false;}
  p.assertView(await guarded(guard, () => port.currentView()), view);
  const body = {declarationDigest: p.digest, source: original, view, observations: [...base.values()], mutations};
  p.detach({...body, digest: '0'.repeat(64)});
  const candidate = p.detach<C>({...body, digest: await guarded(guard, () => p.hash(p.canonical(body)))});
  return guarded(guard, () => p.candidate(candidate));
}

export async function executionApply<S extends ExecutionSource, C extends ExecutionCandidate<S>>(p: ExecutionPolicy<S, C>,
  input: unknown, port: ExecutionPort<S, C>, custody: ExecutionCustody<C>, hook: (reader: ExecutionReduction<S>) => Promise<void>,
  guard: StatefulGuard): Promise<StatefulApplyResult> {
  p.admit();
  const source = await guarded(guard, () => p.source(input)), limits = p.limits;
  const inspection = p.inspection(await guarded(guard, () => port.inspect(source))), progress = inspection.progress;
  if (inspection.status === 'committed') {
    check(p, inspection.sourceDigest === source.digest && inspection.candidateDigest !== null, 'Conflicting committed source', 'stateful.replay-conflict');
    check(p, progress.checkpoint.blockNum >= source.source.block.blockNum && (progress.checkpoint.blockNum !== source.source.block.blockNum
      || progress.checkpoint.blockId === source.source.block.blockId), 'Committed progress does not contain the source');
    return Object.freeze({status: 'duplicate', progress});
  }
  const saved = await guarded(guard, () => custody.load(p.digest, source.digest)); let candidate: C;
  if (saved !== null) candidate = await guarded(guard, () => p.candidate(saved));
  else {
    check(p, inspection.status === 'new' && inspection.mayReduce && inspection.sourceDigest === null && inspection.candidateDigest === null,
      'Original pending candidate is unavailable', 'stateful.incomplete');
    candidate = await executionReduce(p, source, port, hook, guard); await guarded(guard, () => custody.retain(candidate));
  }
  check(p, same(p, candidate.source, source), 'Custody belongs to another source', 'stateful.replay-conflict');
  if (inspection.status === 'pending') check(p, inspection.sourceDigest === source.digest && inspection.candidateDigest === candidate.digest, 'Pending candidate differs', 'stateful.replay-conflict');
  p.assertView(progress, candidate.view);
  const result = p.detach<StatefulApplyResult>(await guarded(guard, () => port.apply(candidate)));
  fields(p, result, ['status', 'progress']); check(p, result.status === 'applied' || result.status === 'duplicate', 'Unknown apply outcome');
  p.view(result.progress);
  check(p, result.progress.checkpoint.blockNum >= source.source.block.blockNum && (result.progress.checkpoint.blockNum !== source.source.block.blockNum
    || result.progress.checkpoint.blockId === source.source.block.blockId), 'Apply progress does not contain the source');
  if (result.status === 'applied') check(p, result.progress.checkpoint.blockNum === source.source.block.blockNum
    && result.progress.revision === candidate.view.revision, 'Applied progress changed its revision or advanced beyond its source');
  return result;
}
