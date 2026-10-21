import {
  PROJECTION_ROLLBACK_CAPABILITIES, validateProjectionRollbackActivation, validateProjectionRollbackApply, validateProjectionRollbackApplyInput,
  validateProjectionRollbackRecovery, validateProjectionRollbackRequest, validateProjectionRollbackView,
  type ProjectionAdapter, type ProjectionBinding, type ProjectionCheckpoint, type ProjectionRollbackAdapter,
  type ProjectionRollbackReadView, type ProjectionRollbackRecoveryView, type ProjectionRollbackResult,
} from '@eosrio/hyperion-sdk/projection';
import {validateProjectionRollbackIncomplete} from '@eosrio/hyperion-sdk';
import {exampleTableDefinition, createTableProjectionExample} from '@eosrio/hyperion-sdk/examples/table-projection';

const binding: ProjectionBinding = {chainId: 'c'.repeat(64), backendId: 'packed-recovery', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision, abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'packed-immutable-instance'};
const selected = validateProjectionRollbackActivation(exampleTableDefinition, binding,
  {interfaceVersion: 2, supported: PROJECTION_ROLLBACK_CAPABILITIES});
if (!selected.valid) throw new Error('Packed rollback activation failed');
const example = createTableProjectionExample(binding);
const revision = 'a'.repeat(64);
const first = example.requests[0]!;
if (!validateProjectionRollbackApplyInput({revision, batch: first}).valid
  || !validateProjectionRollbackApply(exampleTableDefinition, {revision, batch: first}).valid
  || !validateProjectionRollbackIncomplete({binding, revision, block: first.block, reason: 'source admitted'}).valid)
  throw new Error('Packed fenced writer validation failed');
if (!validateProjectionRollbackView({binding, checkpoint: example.genesis, revision}).valid)
  throw new Error('Packed fenced read validation failed');
const last = example.requests[2]!.block;
const from: ProjectionCheckpoint = {blockNum: last.blockNum, blockId: last.blockId};
const request = {binding, revision, operationId: 'packed-fork-1', from, ancestor: example.genesis, maxBlocks: 1};
if (!validateProjectionRollbackRequest(request).valid) throw new Error('Packed rollback request failed');
if (!validateProjectionRollbackRecovery({binding, revision, checkpoint: example.genesis,
  initialized: true, pending: null, gap: null, rollback: null,
  coverage: {floor: example.genesis, retainedBlocks: 0, retainedBytes: 0, maxBlocks: 4, maxBytes: 4096}}).valid)
  throw new Error('Packed recovery inspection failed');

// Compile the complete opt-in interface with no native driver or @types/node dependency.
async function consume(adapter: ProjectionRollbackAdapter): Promise<ProjectionRollbackResult> {
  const initial: ProjectionRollbackReadView = await adapter.initialize(exampleTableDefinition, binding, example.genesis);
  let view = initial;
  for (const batch of example.requests) {
    await adapter.markIncomplete({binding, revision: initial.revision, block: batch.block, reason: 'source admitted'});
    view = (await adapter.apply({revision: initial.revision, batch})).view;
  }
  view = await adapter.open(binding);
  await adapter.query(view, example.query);
  const progress: ProjectionRollbackRecoveryView = await adapter.recovery(binding);
  return adapter.rollback({binding, revision: progress.revision, operationId: 'compiled-fork-1',
    from: progress.checkpoint, ancestor: example.genesis, maxBlocks: 1});
}
function notAnUnfencedAdapter(adapter: ProjectionRollbackAdapter): void {
  // @ts-expect-error Recovery requires an explicit opt-in adapter, not implicit v1 substitution.
  const old: ProjectionAdapter = adapter;
  void old;
}
void consume;
void notAnUnfencedAdapter;
