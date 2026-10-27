import {
  CONTEXTUAL_PROJECTION_HOST_CAPABILITIES, CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES,
  validateContextualProjectionActivation, projectContextualTableChange, resolveContextualProjectionMutation,
  validateContextualProjectionApply, validateContextualProjectionApplyInput, canonicalContextualProjectionBatch,
  validateContextualProjectionQuery, validateProjectionDefinition, validateProjectionQueryInput,
  type ContextualProjectionDefinition, type ContextualProjectionContext, type ContextualProjectionApplyRequest,
  type ContextualProjectionAdapter, type ProjectionAdapter, type ProjectionQueryResult,
} from '@eosrio/hyperion-sdk/projection';
import {validateContextualProjectionDefinition} from '@eosrio/hyperion-sdk';

const definition = {
  schemaVersion: 2, id: 'packed-contextual', mappingRevision: 'a'.repeat(64),
  source: {contract: 'registry', table: 'entries', abiDeployment: 'deployment-1', abiSha256: 'b'.repeat(64)},
  fields: [
    {name: 'owner', type: 'string', source: {kind: 'row', path: ['owner']}},
    {name: 'contract', type: 'string', source: {kind: 'context', field: 'contract'}},
    {name: 'created_block', type: 'string', source: {kind: 'context', field: 'blockNum', format: 'decimal'}},
    {name: 'created_time', type: 'string', source: {kind: 'context', field: 'blockTimeMs', format: 'decimal'}},
  ], initialization: {kind: 'genesis'}, preserveOnReplace: ['created_block', 'created_time'], onAbsent: 'incomplete',
} satisfies ContextualProjectionDefinition;
const context = {
  binding: {chainId: 'c'.repeat(64), backendId: 'packed-contextual', projectionId: definition.id,
    mappingRevision: definition.mappingRevision, abiDeployment: definition.source.abiDeployment,
    abiSha256: definition.source.abiSha256, generation: 'packed-instance'},
  block: {blockNum: 1, blockId: '1'.repeat(64), previousBlockId: '0'.repeat(64)},
  source: {contract: 'registry', table: 'entries', blockTimeMs: 1792976523500},
} satisfies ContextualProjectionContext;
const selected = validateContextualProjectionActivation(definition, context.binding,
  {family: 'contextual-table', interfaceVersion: 1, supported: CONTEXTUAL_PROJECTION_HOST_CAPABILITIES},
  {family: 'contextual-table', interfaceVersion: 1, supported: CONTEXTUAL_PROJECTION_ADAPTER_CAPABILITIES});
if (!selected.valid || !validateContextualProjectionDefinition(definition).valid) throw new Error('Packed contextual activation failed');
if (validateProjectionDefinition(definition).valid) throw new Error('Old closed v1 definition validator accepted contextual syntax');
const mapped = projectContextualTableChange(definition, context, {key: 'entry', present: true, value: {owner: 'alice'}});
if (!mapped.valid) throw new Error('Packed contextual mapping failed');
const inserted = resolveContextualProjectionMutation(definition, mapped.value, null);
if (!inserted.valid || inserted.value?.created_block !== '1' || inserted.value?.created_time !== '1792976523500')
  throw new Error('Packed original source context was lost');
const laterContext: ContextualProjectionContext = {...context,
  block: {blockNum: 2, blockId: '2'.repeat(64), previousBlockId: '1'.repeat(64)},
  source: {...context.source, blockTimeMs: 1792976524000}};
const replacement = projectContextualTableChange(definition, laterContext, {key: 'entry', present: true, value: {owner: 'bob'}});
if (!replacement.valid) throw new Error('Packed contextual replacement failed');
const updated = resolveContextualProjectionMutation(definition, replacement.value, inserted.value);
if (!updated.valid || updated.value?.owner !== 'bob' || updated.value?.created_block !== '1'
  || updated.value?.created_time !== '1792976523500') throw new Error('Packed first-creation preservation failed');
const batch: ContextualProjectionApplyRequest = {...laterContext, previous: {blockNum: 1, blockId: '1'.repeat(64)},
  policy: {preserveOnReplace: definition.preserveOnReplace, onAbsent: definition.onAbsent}, mutations: [replacement.value]};
if (!validateContextualProjectionApplyInput(batch).valid || !validateContextualProjectionApply(definition, batch).valid
  || !canonicalContextualProjectionBatch(batch).includes('1792976524000')) throw new Error('Packed logical replay identity failed');
const query = {filter: [{field: 'owner', op: 'eq', value: 'bob'}], limit: 1};
if (!validateProjectionQueryInput(query).valid || !validateContextualProjectionQuery(definition, query).valid)
  throw new Error('Packed unchanged logical query failed');

// Declaration-only consumer; no driver or runtime effect is introduced by this SDK fixture.
async function consume(adapter: ContextualProjectionAdapter): Promise<ProjectionQueryResult> {
  await adapter.initialize(definition, context.binding, {blockNum: 0, blockId: '0'.repeat(64)});
  if (adapter.recovery) await adapter.recovery(context.binding);
  await adapter.apply(batch);
  await adapter.markIncomplete(context.binding, batch.block, 'compiled consumer');
  const view = await adapter.open(context.binding);
  return adapter.query(view, {filter: [], limit: 1});
}
function checkLegacyDeclarations(legacy: ProjectionAdapter): void {
  // @ts-expect-error A v1 adapter cannot silently claim the explicitly negotiated contextual contract.
  const incompatible: ContextualProjectionAdapter = legacy;
  const unsupported: ContextualProjectionDefinition = {...definition, fields: [
    // @ts-expect-error Original numeric context requires an explicit exact decimal representation.
    {name: 'time', type: 'string', source: {kind: 'context', field: 'blockTimeMs'}},
  ]};
  void [incompatible, unsupported];
}
void [consume, checkLegacyDeclarations];
console.log('Packed contextual mapping, preserving replacement and legacy refusal passed; engine qualification remains pending.');
