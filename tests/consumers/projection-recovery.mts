import {
  PROJECTION_ROLLBACK_CAPABILITIES, PROJECTION_RECOVERY_CAPABILITIES,
  validateProjectionRecoveryActivation, validateProjectionRetainedCheckpointRequest,
  validateProjectionRetainedCheckpoints, type ProjectionBinding, type ProjectionRecoveryAdapter,
  type ProjectionRetainedCheckpointView, type ProjectionRollbackAdapter,
} from '@eosrio/hyperion-sdk/projection';
import {validateProjectionRetainedCheckpoints as rootValidator} from '@eosrio/hyperion-sdk';
import {exampleTableDefinition} from '@eosrio/hyperion-sdk/examples/table-projection';

const binding: ProjectionBinding = {chainId: 'c'.repeat(64), backendId: 'packed-recovery', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision, abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'packed-immutable-instance'};
const revision = 'a'.repeat(64);
const genesis = {blockNum: 0, blockId: '0'.repeat(64)};
const activation = validateProjectionRecoveryActivation(exampleTableDefinition, binding,
  {interfaceVersion: 2, supported: PROJECTION_ROLLBACK_CAPABILITIES},
  {interfaceVersion: 1, supported: PROJECTION_RECOVERY_CAPABILITIES});
if (!activation.valid || !validateProjectionRetainedCheckpointRequest({binding, revision}).valid)
  throw new Error('Packed retained inspection activation/request failed');
const result = validateProjectionRetainedCheckpoints({
  recovery: {binding, revision, checkpoint: genesis, initialized: true, pending: null, gap: null, rollback: null,
    coverage: {floor: genesis, retainedBlocks: 0, retainedBytes: 0, maxBlocks: 4, maxBytes: 4096}},
  checkpoints: [genesis],
});
if (!result.valid || !rootValidator(result.value).valid || !Object.isFrozen(result.value.checkpoints))
  throw new Error('Packed retained inspection validation failed');

// The additive interface is usable without a native driver and requires explicit host selection.
async function consume(adapter: ProjectionRecoveryAdapter): Promise<ProjectionRetainedCheckpointView> {
  const view = await adapter.initialize(exampleTableDefinition, binding, genesis);
  return adapter.retainedCheckpoints({binding, revision: view.revision});
}
function existingAdapterRemainsCompatible(adapter: ProjectionRecoveryAdapter, old: ProjectionRollbackAdapter): void {
  const v2: ProjectionRollbackAdapter = adapter;
  // @ts-expect-error A rollback-only adapter cannot implicitly satisfy retained inspection.
  const inspection: ProjectionRecoveryAdapter = old;
  void v2; void inspection;
}
void consume;
void existingAdapterRemainsCompatible;
