# Legacy plugin migration and support constraints

This SDK foundation is not a replacement implementation of `@eosrio/hyperion-plugin-core`.
There is no package alias, dependency override, `HyperionPlugin` re-export, compatibility shim
or new host loader in this change. Existing source consumers keep their current dependency and
host path. That preserves the transition boundary; it does not certify legacy plugins for 4.5.

## Audited source baselines

The inventory below records inspected source revisions, not tested compatibility. Package manifests
declare requirements; they do not prove installed versions or successful runtime behavior.

| Component | Exact inspected revision | Observed contract |
|---|---|---|
| [hyperion-plugin-core](https://github.com/eosrio/hyperion-plugin-core/tree/7cb27f2defcbd8c493d28070d00252e56b86158f) | `7cb27f2defcbd8c493d28070d00252e56b86158f` | Package `@eosrio/hyperion-plugin-core` 0.1.0, ESM, Fastify peer `^5.4.0`. Exports `HyperionPlugin`, action/delta/stream interfaces and Fastify-bound `addRoutes`. |
| [hyperion-history-api](https://github.com/eosrio/hyperion-history-api/tree/79af10986bc0e2aa84cce3788aea202d23547818) | `79af10986bc0e2aa84cce3788aea202d23547818` | Package declares core `^0.1.0`, Node `>=22`, Fastify `5.8.5`. Loader imports enabled plugin `build/index.js`, constructs the default class and registers handlers; API host calls `addRoutes` when `hasApiRoutes` is set. |
| [DelphiOracle](https://github.com/eosrio/hyperion-delphioracle-plugin/tree/544eca5e67453a4d66c7047ec22cb1ef97060b95) | `544eca5e67453a4d66c7047ec22cb1ef97060b95` | ESM source imports the legacy package, peers core `^0.1.0` and Fastify `^5.4.0`; registers a delta transform and API route. A package-backed migration candidate, not an SDK-qualified plugin. |
| [Explorer](https://github.com/eosrio/hyperion-explorer-plugin/tree/e193f52dfc2e2dbd9a592cb830dbef632f90c315) | `e193f52dfc2e2dbd9a592cb830dbef632f90c315` | Root `index.ts` imports `../../hyperion-plugin` and `../../../helpers/common_functions`, uses CommonJS APIs and old `fastify-static`/`fastify-compress` dependencies; package declares Node `^16`. It is not a current plugin-core package consumer. |
| [Sample](https://github.com/eosrio/hyperion-sample-plugin/tree/924fc77c8293938e8c86e692b7a440f8c50d386c) | `924fc77c8293938e8c86e692b7a440f8c50d386c` | Root `index.ts` imports `../../hyperion-plugin`; CommonJS configuration, Node `^16`, stream handler and `initOnce` override. It is not a current plugin-core package consumer. |

The decisive files are `package.json`, `src/hyperion-plugin.ts` and `src/interfaces.ts` in core;
`package.json`, `src/indexer/modules/loader.ts` and `src/api/server.ts` in History API; Delphi's
`package.json`/`src/index.ts`; and Explorer/Sample's `package.json`, `index.ts`, `tsconfig.json`.
README statements about old Hyperion versions are not 4.5 qualification evidence.

## Transition policy

Keep legacy loading explicit while implementing and qualifying the new SDK host path. Do not
silently route old plugins through new interfaces or mark them compatible because metadata parses.
Existing first-party DelphiOracle, Explorer and Sample each require migration qualification before
a release can advertise them as SDK/4.5 supported. Explorer and Sample additionally need their
source-relative dependencies and declared Node/CommonJS assumptions resolved against the host.

For each migrated plugin, pin its source and dependency versions; build against the actual host;
exercise its registered actions, deltas, streams and public routes as applicable; and verify
configuration, lifecycle and failure behavior. If legacy and new loading coexist, test that boundary
explicitly. Record the exact tested component combination and preserve the existing public API
behavior where compatibility is promised. A future shim, if justified, needs its own implementation
and acceptance evidence.

The next SDK slice remains [SDK #1](https://github.com/eosrio/hyperion-sdk/issues/1): a real MongoDB
projection round-trip with portable contracts and durability evidence. This metadata foundation
does not implement that slice or qualify any backend. Runtime/adapter source homes are recorded
in the [release ownership work](https://github.com/eosrio/hyperion-tools/issues/19).
