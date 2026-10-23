# Hyperion SDK: agent guidance

Read [README.md](README.md), the [architecture definition](https://github.com/eosrio/hyperion-tools/blob/a36fda12ba813968ce361e85893206d8f5bceb0f/docs/architecture/hyperion-4.5.md)
and applicable ADRs. Work from the approved release plan and scoped linked issues.

Keep public interfaces portable and capability requirements explicit. Extend the SDK through real
projection, query and protocol slices rather than designing unused interfaces. Do not put native
database execution or domain-specific contract behavior in the SDK.

Keep accepted release constraints, implementation status and qualification evidence distinct.
A scaffold or green documentation check is not a working extension. Add appropriate runtime
checks with implementation. Do not publish versions or compatibility claims implicitly.

Use TypeScript 7.0.2 and Bun 1.4.4 (pinned in `.bun-version`). Install dependencies with
`npm ci` and run `npm run typecheck`, which uses `bun check -p tsconfig.json`, before
committing TypeScript changes. Keep `npm run build` for JavaScript and declaration emission
through the pinned TypeScript compiler. Package tests and consumers continue to run on Node.js.
