import {type StatefulQueryRead} from '@eosrio/hyperion-sdk/projection-stateful';
import {STATEFUL_COMPLETE_KIND_FAMILY_V1, negotiateStatefulCompleteKindV1, composeStatefulOwnerCompleteKindReadV1,
  type StatefulOwnerAdapterV2, type StatefulOwnerDeclarationV2, type StatefulOwnerIdentityV2,
  type StatefulCompleteKindAdapterV1, type StatefulCompleteKindCapabilitiesV1, type StatefulCompleteKindSelectionV1,
  type StatefulCompleteKindReadV1, type StatefulCompleteKindQueryHostV1}
  from '@eosrio/hyperion-sdk/projection-stateful-owner-v2';

const offer = {family: STATEFUL_COMPLETE_KIND_FAMILY_V1, interfaceVersion: 1,
  limits: {readAttempts: 8, responseRecords: 4, responseBytes: 65536}} satisfies StatefulCompleteKindCapabilitiesV1;
if (offer.family !== 'stateful-owner-complete-kind') throw new Error('Packed complete-kind contract missing');
function compose(host: StatefulCompleteKindQueryHostV1) {
  return host.compose('declared', async read => ({rows: await read.all('declared-kind'), keyed: await read.get('declared-kind', 'known')}));
}
function boundaries(old: StatefulOwnerAdapterV2, d: StatefulOwnerDeclarationV2, extended: StatefulCompleteKindAdapterV1,
  identity: StatefulOwnerIdentityV2, keyed: StatefulQueryRead, reader: StatefulCompleteKindReadV1) {
  const stillOld: StatefulOwnerAdapterV2 = extended;
  // @ts-expect-error the old get-only adapter has no required complete-kind capability
  const notExtended: StatefulCompleteKindAdapterV1 = old;
  // @ts-expect-error copying data cannot mint a negotiated selection
  const forged: StatefulCompleteKindSelectionV1 = {family: offer.family, interfaceVersion: 1, declarationDigest: '', limits: offer.limits};
  // @ts-expect-error get-only readers remain get-only
  keyed.all('declared-kind');
  const selected = negotiateStatefulCompleteKindV1(d, offer.limits, offer, extended.completeKindCapabilities);
  const run = () => composeStatefulOwnerCompleteKindReadV1(selected, extended, identity, reader.view,
    async port => ({rows: await port.all('declared-kind')}), () => {});
  void run; void stillOld; void notExtended; void forged;
}
void compose; void boundaries;
