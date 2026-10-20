import {projectTableValue, projectionRowKey, validateProjectionBinding, validateProjectionDefinition,
  type ProjectionApplyRequest, type ProjectionBinding, type ProjectionCheckpoint,
  type ProjectionQuery} from '../projection.js';

/** Synthetic ABI bytes for an engineering example, not a chain deployment or launch pin. */
export const exampleTableAbiJson = '{"version":"eosio::abi/1.2","types":[],"structs":[{"name":"balance","base":"","fields":[{"name":"units","type":"int32"}]},{"name":"item","base":"","fields":[{"name":"account","type":"string"},{"name":"balance","type":"balance"},{"name":"enabled","type":"bool"}]}],"actions":[],"tables":[{"name":"items","type":"item","index_type":"i64","key_names":[],"key_types":[]}],"ricardian_clauses":[],"variants":[],"abi_extensions":[]}';
const definition = validateProjectionDefinition({
  schemaVersion: 1, id: 'example-items', mappingRevision: 'a'.repeat(64),
  source: {contract: 'example.store', table: 'items', abiDeployment: 'example-abi-deployment-1',
    abiSha256: '8078c593ece20931345b77be4aa11f5a571cdf59df0a9b1690133b1a75074260'},
  fields: [{name: 'owner', path: ['account'], type: 'string'},
    {name: 'quantity', path: ['balance', 'units'], type: 'integer'},
    {name: 'active', path: ['enabled'], type: 'boolean'}],
  initialization: {kind: 'genesis'},
});
if (!definition.valid) throw new Error('Invalid packaged projection example');
export const exampleTableDefinition = definition.value;
export const exampleTableQuery: ProjectionQuery = Object.freeze({
  filter: Object.freeze([Object.freeze({field: 'owner', op: 'eq' as const, value: 'alice'})]),
  limit: 10, count: Object.freeze({upTo: 100}),
});

/** Unchanged request/definition/query values can drive any conforming adapter. */
export function createTableProjectionExample(binding: ProjectionBinding): {
  genesis: ProjectionCheckpoint; requests: readonly ProjectionApplyRequest[]; query: ProjectionQuery;
} {
  const checkedBinding = validateProjectionBinding(exampleTableDefinition, binding);
  if (!checkedBinding.valid) throw new Error('Example binding differs from the packaged definition');
  binding = checkedBinding.value;
  const mapped = (account: string, units: number) => {
    const result = projectTableValue(exampleTableDefinition, {account, balance: {units}, enabled: true});
    if (!result.valid) throw new Error('Invalid packaged example value');
    return result.value;
  };
  const genesis = Object.freeze({blockNum: 0, blockId: '0'.repeat(64)});
  const first = Object.freeze({blockNum: 1, blockId: '1'.repeat(64), previousBlockId: genesis.blockId});
  const second = Object.freeze({blockNum: 2, blockId: '2'.repeat(64), previousBlockId: first.blockId});
  const third = Object.freeze({blockNum: 3, blockId: '3'.repeat(64), previousBlockId: second.blockId});
  const alice = projectionRowKey('inventory', '18446744073709551615');
  const bob = projectionRowKey('inventory', 'opaque:row/002');
  const requests: readonly ProjectionApplyRequest[] = Object.freeze([
    Object.freeze({binding, previous: genesis, block: first, mutations: Object.freeze([
      Object.freeze({kind: 'put' as const, key: alice, value: mapped('alice', 1)}),
      Object.freeze({kind: 'put' as const, key: bob, value: mapped('bob', 2)}),
    ])}),
    Object.freeze({binding, previous: Object.freeze({blockNum: first.blockNum, blockId: first.blockId}),
      block: second, mutations: Object.freeze([
        Object.freeze({kind: 'put' as const, key: alice, value: mapped('alice', 7)}),
      ])}),
    Object.freeze({binding, previous: Object.freeze({blockNum: second.blockNum, blockId: second.blockId}),
      block: third, mutations: Object.freeze([Object.freeze({kind: 'delete' as const, key: bob})])}),
  ]);
  return Object.freeze({genesis, requests, query: exampleTableQuery});
}
