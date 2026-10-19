# Contributing

EOS Rio maintains this component as part of Hyperion 4.5. Work from a scoped GitHub issue and
follow the [shared architecture](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/architecture/hyperion-4.5.md) and applicable ADRs.

Describe delivered behavior, acceptance evidence, genuine dependencies and compatible component
versions. Keep public contracts in the SDK and database-native operations in adapters.

Install with `npm ci` and the canonical committed npm lockfile. Use TypeScript 7.0.2 and Bun 1.4.3
(pinned in `.bun-version`). Run `npm run typecheck` (`bun check -p tsconfig.json`), `npm test`, `npm run test:package` and
`npm run check:docs`. Behavioral tests use the public manifest/compatibility API; the package check
compiles and runs an isolated consumer of the packed artifact. Keep schema, public validation,
types and metadata documentation aligned. Preserve TypeScript artifact emission and Node 22/24
acceptance; Bun's checker is not a production runtime requirement. These checks do not establish
plugin/runtime compatibility.

Executable plugin upgrades are operator-initiated. Publish package versions and compatibility
claims only through explicit release work with qualification evidence.
