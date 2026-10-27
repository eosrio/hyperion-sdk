# Hyperion SDK

Public extension contracts and TypeScript authoring support for Hyperion protocol providers,
contract projections, backend adapters and API plugins.

Status: Private development package for Hyperion 4.5, maintained by EOS Rio. This foundation
implements inert component manifests, declared version checks, portable protocol-provider
contracts and a bounded declarative table projection contract. It provides no projection runtime,
database adapter or qualified stable SDK release.

Read the [architecture definition](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/architecture/hyperion-4.5.md),
[ADRs](https://github.com/eosrio/hyperion-tools/tree/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/adr)
and [release roadmap](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/roadmap/hyperion-4.5.md).

[SDK, runtime and adapter source homes](https://github.com/eosrio/hyperion-tools/blob/458e1127b99c025251055e160129010edcecc78a/docs/architecture/hyperion-4.5-component-homes.md)
define package ownership; assigned homes are not implementation or release-support claims.

## Scope

Follow the [shared TypeScript 7 and Bun toolchain policy](https://github.com/eosrio/hyperion-tools/blob/1a38d018cbc25aef3ac35636e11761ef8c9863f3/docs/architecture/hyperion-4.5-typescript-toolchain.md) for development and CI.

- Independently versioned SDK contracts, compatible within each major; breaking contracts require
  a new major.
- Backend-neutral mutations and logical queries, explicit capabilities and reusable conformance fixtures.
- Shared semantics for required language bindings; build on the existing worker infrastructure.
- Explicit migration from @eosrio/hyperion-plugin-core. The old package remains separate; see the
  [source-backed migration inventory and qualification policy](docs/migration.md).

## Development metadata API

```typescript
import { validateComponentManifest, checkCompatibility } from '@eosrio/hyperion-sdk';

const manifest = {
  schemaVersion: 1,
  package: '@example/plugin',
  version: '0.1.0-dev.1',
  kind: 'plugin',
  compatibility: { hyperion: '^4.5.0-dev.1', sdk: '^0.0.0-dev.1' },
};

validateComponentManifest(manifest); // { valid: true, manifest }
checkCompatibility(manifest, { hyperion: '4.5.0-dev.1', sdk: '0.0.0-dev.1' });
// { compatible: true, errors: [] }: declared range eligibility, without qualification evidence.
```

The [manifest reference](docs/component-manifest.md) defines the shared metadata and diagnostics.
The canonical [JSON Schema](src/component-manifest.schema.json) is also exported as
`@eosrio/hyperion-sdk/component-manifest.schema.json`. Metadata validation never loads code,
installs dependencies, updates plugins or establishes tested support. Catalog records and release
qualification must pin exact component revisions separately.

## Protocol-provider development API

The additive [protocol contract](docs/protocol-provider.md) is exercised by
[History API #212](https://github.com/eosrio/hyperion-history-api/issues/212) and tracked in
[SDK #4](https://github.com/eosrio/hyperion-sdk/issues/4). It separates SHiP sessions, contract
ABI/value codecs and normalization from database persistence. Import its portable types and
inert `validateProtocolSelection` validator through `@eosrio/hyperion-sdk/protocol` or the root.

The optional `observeBlockAbi` hook captures separate action-input, native-deployment and
block-end ABI facts for [History API #213](https://github.com/eosrio/hyperion-history-api/issues/213)
and [SDK #6](https://github.com/eosrio/hyperion-sdk/issues/6). Observations preserve raw bytes and
source anchors; they do not establish canonical coverage, ABI applicability or projection readiness.

The optional `verifyNativeGenesis` hook returns native block-one ABI and empty application-state
facts from retained sections for [History API #240](https://github.com/eosrio/hyperion-history-api/issues/240)
and [SDK #9](https://github.com/eosrio/hyperion-sdk/issues/9). The host verifies the selected source and
reruns the hook before granting coverage; ordinary missing-trace guards remain unchanged.

The optional [protocol-native action contract](docs/protocol-native-actions.md), tracked in
[SDK #19](https://github.com/eosrio/hyperion-sdk/issues/19), adds explicit host capability negotiation,
detached per-origin decisions and a separate native value codec. Its validators establish shapes
and declared interface agreement; source verification, canonical authority and activation remain
provider/host work.

## Portable table projection development API

The additive [table projection contract](docs/projection.md) is the first SDK #1 slice. It supplies
fixed-ABI declarative field mapping, complete put/delete mutations, contiguous block/checkpoint
bindings, strict replay identity, capability validation and bounded logical equality/keyset/count
queries. Import through `@eosrio/hyperion-sdk/projection` or the root. The packaged
`@eosrio/hyperion-sdk/examples/table-projection` export provides one reusable synthetic example.
Runtime orchestration and actual native storage/query execution belong to their assigned components.

The separate opt-in [rollback contract](docs/projection-rollback.md) adds fenced reads/writes,
bounded undo coverage and resumable runtime-coordinated recovery for SDK #14 and Tools #21. Existing
v1 consumers remain unchanged. Database and process-restart qualification belongs to the real adapter
and runtime fixtures, not these SDK-only checks.

The additive [retained-checkpoint inspection](docs/projection-recovery.md) lets a host inspect the
adapter's bounded applied branch under its current revision. Its separate capability manifest
leaves both existing interfaces unchanged. Inspection supplies no canonical or serving authority.

The separate opt-in [contextual scalar mapping](docs/projection-contextual.md) family adds original
contract/block/time context, explicit absence policy and a distinct preserving replacement operation.
Existing v1 contracts stay unchanged. Pure helpers and capability negotiation do not qualify runtime,
database atomicity, source authority or production rollback; those remain linked host/adapter work.

The independently activated [contextual recovery family](docs/projection-contextual-recovery.md) keeps
the complete contextual batch under a persisted revision fence and reuses exact rollback, coverage
and retained-inspection semantics. Existing ordinary/basic contextual/rollback contracts stay closed;
SDK snapshot guards do not replace atomic engine checks or host source authority.

## Remaining foundation work

Track [SDK issue #1](https://github.com/eosrio/hyperion-sdk/issues/1) and
[release coordination #24](https://github.com/eosrio/hyperion-tools/issues/24).

The cross-repository implementation target is one declarative contract round-tripping through the SDK
and a real MongoDB adapter. SDK-only checks do not establish that outcome. See P05 in the
[approved issue batch](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/roadmap/hyperion-4.5-initial-issues.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
Run `npm ci`, `npm run typecheck`, `npm test`, `npm run test:package` and `npm run check:docs`.
Development requires Node.js 24 or newer and Bun 1.4.4, pinned in `.bun-version`.
`npm run typecheck` uses `bun check -p tsconfig.json`; `npm run build` uses TypeScript 7.0.2
to emit JavaScript and declarations. Keep `npm ci` and the committed npm lockfile for dependency
installation. CI exercises Node.js 24 and 26 with the pinned Bun checker. `npm pack` and Git
dependency installation build through `prepare`. `private: true` prevents accidental registry publication.
These checks cover metadata/protocol selection, portable projection contracts and a packed ESM/TypeScript consumer. Host execution
and chain/runtime qualification have their own acceptance evidence.
Licensed under [MIT](LICENSE).
