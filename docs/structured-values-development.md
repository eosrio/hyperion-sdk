# Internal structured record experiment

SDK #32's first implementation slice is internal development code, separate from the
[proposed family](projection-stateful-proposal.md). It adds no package export/subpath, metadata
capability, activation, adapter support or accepted family interface. Existing scalar and contextual
contracts remain unchanged. Source occurrences, staged reduction, candidate receipts, coherent
views and runtime recovery still require their own reviewed implementation.

The internal record function validates inert JSON, then creates a detached deeply frozen record,
canonical JSON text and its exact UTF-8 byte count. Object keys use deterministic UTF-16 code-unit
lexical order; arrays retain their numeric order. Missing members remain absent, present null stays
null, finite numbers retain JSON meaning and negative zero becomes zero. Calling it with a new
record is a complete replacement; it does not merge with prior values or preserve lifecycle fields
on the plugin's behalf. Record canonical text identifies the value only; future candidate identity
must also bind the separate definition and source/view identities.

Every invocation requires explicit depth, traversal-node, per-object field, per-array element,
string-byte, record-byte, integer-declaration and path-segment bounds. These are caller experiment
inputs, with no production defaults or aggregate per-chain byte-budget selection. Record size counts
JSON escaping, keys, punctuation and UTF-8 bytes before creating the returned copy/text. Iterative
traversal avoids selecting a hidden call-stack depth ceiling. Invalid input produces no returned
record; no hook, database operation or hash is performed.

The minimal **internal** integer declaration is an object-key path, `int64` or `uint64`, and an
explicit scalar/vector flag. A present declared leaf must be a canonical exact decimal string in
range; it never passes through `Number` or an unbounded `BigInt` parse. Missing leaves remain absent.
Ordinary strings are not interpreted as integers. Paths through arrays of structured objects and a
public declaration language remain future contract decisions; vectors at declared object paths are
supported. Overlapping/duplicate declarations refuse.

Objects with null or ordinary prototypes and dense ordinary arrays are accepted. Accessors,
nonenumerable/symbol properties, custom prototypes, cycles, functions, undefined, sparse/extended
arrays, nonfinite numbers and malformed Unicode refuse. Own `__proto__` and `constructor` data stay
inert in null-prototype output objects. This is a trusted-code data contract, not a general Proxy
detector or preemption/security boundary.

Fixtures use the original AtomicAssets 2.7.0 `0aabc47dcf8bd0804d4dcecb336c90fc02a9c89e` / codec2.2.0
expectations and the constructed real-PostgreSQL oracle at tree
`6a25f8a8cbe9bf9c48f768bc7603ab4482cb5b93`: exact scalar/vector integer strings, fractions, ordered
schema metadata, whole mutable replacement and null/missing. The standalone generic JSONB number
rounding control is explicitly not mint-state proof. These local value tests execute no PostgreSQL,
MongoDB, WormDB or original processors and establish no backend, full API or AtomicMarket parity.

The original NUL/literal-backslash conversion policy remains undecided. This experiment refuses
strings and keys containing NUL or the literal `\u0000` sequence, preserving the original baseline's
separate NUL-to-space and invalid-JSON controls rather than choosing a replacement policy.
