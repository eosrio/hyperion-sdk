import {PROJECTION_CAPABILITIES, canonicalProjectionBatch, validateProjectionActivation,
  validateProjectionApply, validateProjectionQuery, validateProjectionQueryInput,
  type ProjectionAdapter, type ProjectionApplyResult, type ProjectionReadView,
  type ProjectionQueryResult} from '@eosrio/hyperion-sdk/projection';
import {validateProjectionDefinition} from '@eosrio/hyperion-sdk';
import {exampleTableDefinition, createTableProjectionExample} from '@eosrio/hyperion-sdk/examples/table-projection';

const binding = {chainId: 'c'.repeat(64), backendId: 'packed-example', projectionId: exampleTableDefinition.id,
  mappingRevision: exampleTableDefinition.mappingRevision,
  abiDeployment: exampleTableDefinition.source.abiDeployment,
  abiSha256: exampleTableDefinition.source.abiSha256, generation: 'packed-consumer-1'};
const selected = validateProjectionActivation(exampleTableDefinition, binding,
  {interfaceVersion: 1, supported: PROJECTION_CAPABILITIES});
if (!selected.valid || !validateProjectionDefinition(exampleTableDefinition).valid) throw new Error('Packed projection exports failed');
const example = createTableProjectionExample(selected.value.binding);
for (const request of example.requests) {
  if (!validateProjectionApply(selected.value.definition, request).valid) throw new Error('Packed apply contract failed');
  if (!canonicalProjectionBatch(request).includes('abiDeployment')) throw new Error('Packed replay identity failed');
}
if (!validateProjectionQueryInput(example.query).valid
  || !validateProjectionQuery(selected.value.definition, example.query).valid) throw new Error('Packed query contract failed');

// Compile the whole portable adapter boundary without importing a native driver or @types/node.
async function consume(adapter: ProjectionAdapter): Promise<ProjectionQueryResult> {
  const initial: ProjectionReadView = await adapter.initialize(selected.valid ? selected.value.definition : exampleTableDefinition,
    binding, example.genesis);
  await adapter.open(initial.binding);
  let result: ProjectionApplyResult | undefined;
  for (const request of example.requests) result = await adapter.apply(request);
  if (!result) throw new Error('Example has no source block');
  // Completed application may still be filling a durably recorded source gap. Reopen for serving.
  const serving = await adapter.open(result.view.binding);
  const data = await adapter.query(serving, example.query);
  await adapter.markIncomplete(binding, example.requests[0]!.block, 'compiled portable contract');
  return data;
}
void consume;
