# Hyperion SDK

Public extension contracts and TypeScript authoring support for Hyperion protocol providers,
contract projections, backend adapters and API plugins.

Status: Private development package for Hyperion 4.5, maintained by EOS Rio. This foundation
implements inert component manifests and declared version checks. It provides no projection
runtime, database adapter or qualified stable SDK release.

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

## First work

Track [SDK issue #1](https://github.com/eosrio/hyperion-sdk/issues/1) and
[release coordination #24](https://github.com/eosrio/hyperion-tools/issues/24).

The next implementation target is one declarative contract round-tripping through the SDK and
a real MongoDB adapter. See P05 in the
[approved issue batch](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/roadmap/hyperion-4.5-initial-issues.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
Run `npm ci`, `npm run typecheck`, `npm test`, `npm run test:package` and `npm run check:docs`.
Development requires Node.js 22 or newer and Bun 1.4.3, pinned in `.bun-version`.
`npm run typecheck` uses `bun check -p tsconfig.json`; `npm run build` uses TypeScript 7.0.2
to emit JavaScript and declarations. Keep `npm ci` and the committed npm lockfile for dependency
installation. CI exercises Node.js 22 and 24 with the pinned Bun checker. `npm pack` and Git
dependency installation build through `prepare`. `private: true` prevents accidental registry publication.
These checks cover metadata validation and a packed ESM/TypeScript consumer, not runtime qualification.
Licensed under [MIT](LICENSE).
