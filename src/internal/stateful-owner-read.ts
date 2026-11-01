import {canonicalStructuredJsonRecord} from './structured-values.js';
import {captureStatefulDeclaration, StatefulContractError} from '../projection-stateful.js';
import type {StatefulDeclaration, StatefulGuard, StatefulView} from '../stateful-types.js';
import type {StatefulCompletedReadV2, StatefulOwnerAdapterV2, StatefulOwnerCapabilitiesV2,
  StatefulOwnerDeclarationV2, StatefulOwnerIdentityV2} from '../stateful-owner-v2-types.js';

function check(ok: unknown, message: string, code = 'stateful.invalid-contract'): asserts ok {
  if (!ok) throw new StatefulContractError(code, message);
}
/** Shared validation, not a new owner negotiation or authority issuer. */
export async function validateOwnerCapabilities(projection: StatefulDeclaration, input: unknown, required: readonly string[]): Promise<void> {
  const value = canonicalStructuredJsonRecord(input, [], {...projection.limits.envelope,
    recordBytes: Math.min(projection.limits.envelope.recordBytes, projection.limits.candidateBytes)}).value as unknown as StatefulOwnerCapabilitiesV2;
  const names = ['family', 'interfaceVersion', 'sourceInputVersions', 'supported', 'limits'];
  check(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), 'Unexpected owner capability fields');
  check(value.family === 'stateful-projection-owner-recovery' && value.interfaceVersion === 2
    && Array.isArray(value.sourceInputVersions) && value.sourceInputVersions.length === 1 && value.sourceInputVersions[0] === 2,
    'Owner source version/capability family differs', 'stateful.capability-unavailable');
  check(Array.isArray(value.supported) && value.supported.length === required.length
    && new Set(value.supported).size === value.supported.length && required.every(item => value.supported.includes(item)),
    'Missing/unknown owner capabilities', 'stateful.capability-unavailable');
  const offered = (await captureStatefulDeclaration(projection.definition, value.limits)).limits;
  const limits = projection.limits;
  for (const name of Object.keys(limits) as (keyof typeof limits)[]) {
    if (name === 'value' || name === 'envelope') {
      for (const field of Object.keys(limits[name]) as (keyof typeof limits.value)[])
        check(limits[name][field] <= offered[name][field], 'Owner structured bound unavailable', 'stateful.capability-unavailable');
    } else check(limits[name] <= offered[name], 'Owner family bound unavailable', 'stateful.capability-unavailable');
  }
}

/** Private lifecycle used by the owner get-only and additive query composers. Never exported by a package entry point. */
export async function withOwnerCompletedRead<T>(d: StatefulOwnerDeclarationV2, adapter: StatefulOwnerAdapterV2,
  expectedOwner: StatefulOwnerIdentityV2, expectedView: StatefulView, guard: StatefulGuard,
  policy: {admit(): void; view(input: unknown): StatefulView; readonly requiredCapabilities: readonly string[]},
  use: (read: StatefulCompletedReadV2, view: StatefulView) => Promise<T>): Promise<T> {
  policy.admit();
  const owner = canonicalStructuredJsonRecord(expectedOwner, [], {...d.projection.limits.envelope,
    recordBytes: Math.min(d.projection.limits.envelope.recordBytes, d.projection.limits.candidateBytes)}).value as unknown as StatefulOwnerIdentityV2;
  check(Object.keys(owner).length === 2 && Object.hasOwn(owner, 'id') && Object.hasOwn(owner, 'generation'), 'Unexpected owner identity fields');
  for (const value of [owner.id, owner.generation]) {
    check(typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= d.projection.limits.keyBytes,
      'Expected bounded owner text');
  }
  const view = policy.view(expectedView);
  guard();
  try {await validateOwnerCapabilities(d.projection, adapter.capabilities, policy.requiredCapabilities);} finally {guard();}
  let read: StatefulCompletedReadV2 | undefined;
  try {
    guard(); read = await adapter.completedRead(owner, view, guard); guard();
    return await use(read, view);
  } finally {if (read !== undefined) adapter.closeRead(read);}
}
