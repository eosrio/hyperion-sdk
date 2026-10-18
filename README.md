# Hyperion SDK

Public extension contracts and TypeScript authoring support for Hyperion protocol providers,
contract projections, backend adapters and API plugins.

Status: Development scaffold for Hyperion 4.5. No SDK implementation or compatible release is
provided by this initial repository. Maintained by EOS Rio.

Read the [architecture definition](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/architecture/hyperion-4.5.md),
[ADRs](https://github.com/eosrio/hyperion-tools/tree/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/adr)
and [release roadmap](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/roadmap/hyperion-4.5.md).

## Scope

- Independently versioned SDK contracts, compatible within each major; breaking contracts require
  a new major.
- Backend-neutral mutations and logical queries, explicit capabilities and reusable conformance fixtures.
- Shared semantics for required language bindings; build on the existing worker infrastructure.
- Explicit migration from @eosrio/hyperion-plugin-core. The old package is not replaced by this
  scaffold. Initial package names and migration policy remain foundation work.

## First work

The first implementation target is one declarative contract round-tripping through the SDK and
a real MongoDB adapter. See P05 in the
[approved issue batch](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/roadmap/hyperion-4.5-initial-issues.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
Repository checks validate scaffold documents and local links; runtime qualification is pending.
Licensed under [MIT](LICENSE).
