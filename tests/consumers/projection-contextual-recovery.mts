import {
  CONTEXTUAL_PROJECTION_RECOVERY_HOST_CAPABILITIES, CONTEXTUAL_PROJECTION_RECOVERY_ADAPTER_CAPABILITIES,
  validateContextualProjectionRecoveryActivation, validateContextualProjectionRecoveryApplyInput,
  validateContextualProjectionRecoveryApply, validateContextualProjectionRecoveryIncomplete,
  validateContextualProjectionRecoveryRollback, validateContextualProjectionRecoveryQuery,
  validateContextualProjectionRecoveryRetainedRequest, validateProjectionRetainedCheckpoints,
  type ContextualProjectionDefinition, type ContextualProjectionRecoveryAdapter,
  type ContextualProjectionRecoveryApplyRequest, type ContextualProjectionAdapter,
  type ProjectionRecoveryAdapter, type ProjectionRollbackRecoveryView,
} from '@eosrio/hyperion-sdk/projection';
import {validateContextualProjectionRecoveryApply as rootValidator} from '@eosrio/hyperion-sdk';

const definition: ContextualProjectionDefinition = {schemaVersion: 2, id: 'packed-context', mappingRevision: 'a'.repeat(64),
  source: {contract: 'contract', table: 'items', abiDeployment: 'deployment', abiSha256: 'b'.repeat(64)},
  fields: [{name: 'created', type: 'string', source: {kind: 'context', field: 'blockNum', format: 'decimal'}}],
  initialization: {kind: 'genesis'}, preserveOnReplace: ['created'], onAbsent: 'incomplete'};
const binding = {chainId: 'c'.repeat(64), backendId: 'packed', projectionId: definition.id,
  mappingRevision: definition.mappingRevision, abiDeployment: definition.source.abiDeployment,
  abiSha256: definition.source.abiSha256, generation: 'instance'};
const revision = 'd'.repeat(64), genesis = {blockNum: 0, blockId: '0'.repeat(64)};
const block = {blockNum: 1, blockId: '1'.repeat(64), previousBlockId: genesis.blockId};
const current: ProjectionRollbackRecoveryView = {binding, revision, checkpoint: genesis, initialized: true, pending: null, gap: null,
  coverage: {floor: genesis, retainedBlocks: 0, retainedBytes: 0, maxBlocks: 16, maxBytes: 1048576}, rollback: null};
const activation = validateContextualProjectionRecoveryActivation(definition, binding,
  {family: 'contextual-table-recovery', interfaceVersion: 1, supported: CONTEXTUAL_PROJECTION_RECOVERY_HOST_CAPABILITIES},
  {family: 'contextual-table-recovery', interfaceVersion: 1, supported: CONTEXTUAL_PROJECTION_RECOVERY_ADAPTER_CAPABILITIES});
const request: ContextualProjectionRecoveryApplyRequest = {revision, batch: {binding, block, previous: genesis,
  source: {contract: 'contract', table: 'items', blockTimeMs: 0},
  policy: {preserveOnReplace: ['created'], onAbsent: 'incomplete'},
  mutations: [{kind: 'put-preserving', key: 'one', value: {created: '1'}, preserveFields: ['created']} ]}};
if (!activation.valid || !validateContextualProjectionRecoveryApplyInput(request).valid
  || !validateContextualProjectionRecoveryApply(definition, request, current).valid || !rootValidator(definition, request, current).valid
  || !validateContextualProjectionRecoveryIncomplete({binding, revision, block, reason: 'missing original time'}, current).valid
  || !validateContextualProjectionRecoveryRollback({binding, revision, operationId: 'fork', from: genesis, ancestor: genesis, maxBlocks: 1}, current).valid
  || !validateContextualProjectionRecoveryQuery(definition, {binding, revision, checkpoint: genesis}, {filter: [], limit: 1}, current).valid
  || !validateContextualProjectionRecoveryRetainedRequest({binding, revision}, current).valid
  || !validateProjectionRetainedCheckpoints({recovery: current, checkpoints: [genesis]}).valid) {
  throw new Error('Packed contextual recovery contracts failed');
}
async function consume(adapter: ContextualProjectionRecoveryAdapter): Promise<void> {
  const view = await adapter.initialize(definition, binding, genesis);
  await adapter.apply({...request, revision: view.revision});
  await adapter.markIncomplete({binding, revision: view.revision, block, reason: 'missing source time'});
  await adapter.recovery(binding);
  await adapter.retainedCheckpoints({binding, revision: view.revision});
  await adapter.rollback({binding, revision: view.revision, operationId: 'fork', from: view.checkpoint, ancestor: genesis, maxBlocks: 1});
  await adapter.query(await adapter.open(binding), {filter: [], limit: 1});
}
function separateFamilies(basic: ContextualProjectionAdapter, old: ProjectionRecoveryAdapter): void {
  // @ts-expect-error Basic contextual adapters cannot implicitly provide revision-fenced recovery.
  const unfenced: ContextualProjectionRecoveryAdapter = basic;
  // @ts-expect-error Legacy recovery adapters cannot accept contextual candidates and policies.
  const legacy: ContextualProjectionRecoveryAdapter = old;
  // @ts-expect-error Fenced apply requires a supplied current durable snapshot; no silent downgrade.
  validateContextualProjectionRecoveryApply(definition, request);
  void unfenced; void legacy;
}
void consume; void separateFamilies;
