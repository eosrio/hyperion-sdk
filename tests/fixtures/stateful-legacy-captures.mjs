import {createHash} from 'node:crypto';
import * as v1 from '../../dist/projection-stateful.js';
import * as owner from '../../dist/projection-stateful-owner-v2.js';
import {captureStatefulSourceV2} from '../../dist/projection-stateful-source-v2.js';
import {definition, limits, source, hex} from './stateful-reference.mjs';

/** Same explicit inputs are run against the frozen pre-extension tree and current/packed SDK. */
export async function legacyCaptures() {
  const projection = await v1.captureStatefulDeclaration(definition(), limits());
  const declaration = await owner.captureStatefulOwnerDeclarationV2(projection, 2);
  const input = source(projection, 1, hex(1), {blockNum: 0, blockId: hex(0)}, []);
  const sourceV1 = await v1.captureStatefulSource(projection, input), sourceV2 = await captureStatefulSourceV2(declaration, input);
  const view = digest => ({declarationDigest: digest, backendId: projection.definition.binding.backendId,
    generation: projection.definition.binding.generation, revision: hex(11), checkpoint: input.previous});
  const target = await owner.captureStatefulRawTargetV2(declaration, {schemaVersion: 2,
    chainId: projection.definition.binding.chainId, declarationDigest: declaration.digest,
    owner: {id: 'owner', generation: 'one'}, previous: view(declaration.digest),
    block: {blockNum: input.block.blockNum, blockId: input.block.blockId, previousBlockId: input.block.previousBlockId},
    rawSource: {commitId: 'commit', selectionId: 'selection', observationId: 'observation', observationDigest: hex(8)}});
  const candidate = (digest, captured) => {
    const body = {declarationDigest: digest, source: captured, view: view(digest), observations: [], mutations: []};
    return {...body, digest: createHash('sha256').update(v1.canonicalStatefulRecord(projection, 'config', body).canonical).digest('hex')};
  };
  return Object.fromEntries(Object.entries({projection, declaration, sourceV1, sourceV2, target,
    candidateV1: await v1.captureStatefulCandidate(projection, candidate(projection.digest, sourceV1)),
    candidateV2: await owner.captureStatefulOwnerCandidateV2(declaration, candidate(declaration.digest, sourceV2))})
    .map(([name, value]) => [name, JSON.stringify(value)]));
}
