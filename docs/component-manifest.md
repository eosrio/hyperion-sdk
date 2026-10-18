# Component manifest

Development schema 1 is owned by this SDK. The catalog consumes the public validator and canonical
[JSON Schema](../src/component-manifest.schema.json), pinned to an exact SDK source revision.
The SDK's package version, manifest schema version and a component's package version are separate.
This private `@eosrio/hyperion-sdk` package is `0.0.0-dev.1`; no stable release or support matrix is
established by these examples. Published SDK contracts must stay compatible within their major;
breaking public contracts require a new major. Development changes must update pinned consumers.

```json
{
  "schemaVersion": 1,
  "package": "@example/mongodb-adapter",
  "version": "0.1.0-dev.1",
  "kind": "backend-adapter",
  "compatibility": {
    "hyperion": "^4.5.0-dev.1",
    "sdk": "^0.0.0-dev.1",
    "engines": [{ "name": "mongodb", "range": ">=7.0.0 <9.0.0" }]
  }
}
```

All five top-level properties are required; unknown properties fail validation. `package` is a
lowercase scoped or unscoped package identifier. `version` is an exact semantic version, including
optional prerelease/build metadata, without a `v`/`=` prefix or surrounding whitespace. `kind` is
`plugin`, `protocol` or `backend-adapter`. A plugin can contain multiple internal components;
the manifest describes the operator's package and does not prescribe process boundaries.

`compatibility.hyperion` and `compatibility.sdk` are nonempty node-semver ranges. Only backend
adapters declare `compatibility.engines`, and they must declare at least one. Engine identifiers
match `^[a-z][a-z0-9._-]*$`; current examples use `mongodb` and `wormdb`. Names must be unique and
**every** listed engine is required. Alternative backends have separate adapter manifests. An
adapter's package version never substitutes for the database-engine version.

Use `validateComponentManifest(input: unknown)` as the complete metadata validator. It returns
`{valid:true, manifest}` or `{valid:false, errors}`. Errors have `code`, JSON Pointer `path` and
`message`. Structural error codes are `manifest.<JSON Schema keyword>`; repeated engine names
produce `manifest.duplicate-engine`. The function does not mutate input or execute components.

The draft-07 schema uses the `semver-version` and `semver-range` formats, implemented using
node-semver by the SDK validator. A generic JSON Schema validator must register those formats
and enforce unique engine names to match the complete validator. Consumers should call the public
SDK validator instead of maintaining a second implementation. A JSON Schema validator that ignores
formats is insufficient for compatibility decisions.

`checkCompatibility(manifest: unknown, environment: unknown)` validates the manifest, then compares
its ranges with exact installed versions. The typed environment is:

```typescript
interface CompatibilityEnvironment {
  hyperion: string;
  sdk: string;
  engines?: Record<string, string>;
}
```

It returns `{compatible:boolean, errors}`. Invalid manifest errors use `/manifest` paths. Environment
errors use `/environment` paths with `compatibility.invalid-environment`, `invalid-engines`, `invalid-engine-name`,
`missing-version`, `invalid-version` or `out-of-range` codes. Missing required versions fail;
they are never inferred. All supplied engine identifiers and versions are validated, including
engines this component does not require. Extra entries do not create additional range requirements.

Range semantics use standard node-semver defaults, including its prerelease exclusion rules.
For example, `^4.5.0` excludes `4.5.0-dev.1`; `^4.5.0-dev.1` admits it but excludes `4.6.0-dev.1`.
There is no global `includePrerelease` override or custom range dialect.

A successful result establishes **declared range eligibility only**. Tested compatibility requires
separate evidence for the exact core/SDK/plugin/adapter/engine combination. Validation does not
test capabilities, resolve dependencies, select a backend, activate a plugin or authorize updates.
