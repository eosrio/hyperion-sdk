# Indexed query foundation

This optional family captures a finite one-projection model and validates requests against
independently offered declaration digests, comparison profiles and explicit limits. The
selection and declaration are local identities; cloning either grants nothing. A comparison
profile is a negotiated name, not an SDK claim that PostgreSQL and another engine agree.
The SDK implements no adapter, execution, publication or endpoint in this slice. In particular,
the PostgreSQL en_US.utf8 observation does not establish a binary comparison profile.

All predicates are conjunctive. Empty `in` remains a match-none predicate; `not-in` applies
only to declared nonnullable text. Nulls-last remains explicit for every allowed order tuple.
Offsets and exact counts are signed-int64 decimal strings; count is nonnegative. Pages use
an offset and limit, never a hidden substitution to keyset or application-side full-kind scan.

The future host and adapter must bind actual owner epoch, view, snapshot, materialization
coverage and cancellation separately from this declaration. Completed-read capability is
adapter-issued. Adapters must account for native attempts, records and all response bytes,
including count work and final envelopes. A full page is the requested window, not global
exhaustion; an incomplete or budget-cut window refuses. Host composition must serialize
operations, poison caught failures, reject unawaited work, close on every exit and revalidate
at every asynchronous boundary and final serialization/cache/onSend publication. No model,
selection or result grants owner authority, coverage or readiness.
