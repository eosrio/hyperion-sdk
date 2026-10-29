# Original action authorization in source-input v2

SDK #40 adds an optional source-v2 variant selected by `actionMetadataVersion: 1`.
Every action in that variant requires an ordered `authorization` array of exact
`{actor, permission}` records beside decoded `data`. An explicit empty list is
valid original data. Missing/unavailable metadata is never replaced with `[]`.
Tables carry no authorization. Existing key, envelope and candidate bounds apply.

Without the marker, the old strict source fields and captures remain byte-exact;
authorization extras are rejected. V1 captures, owner declarations, recovery
storage and capability lists are unchanged. The new metadata participates in the
normal source/candidate digest. Pure capture does not prove canonical authority
or derive authorization from the action-data raw hash.

`original-action-authorization-v1` is an explicit source capability.
`negotiateStatefulActionMetadataV2(required, supported)` rejects absent/unknown
support and selects the source variant. This is configuration negotiation, never
a source/owner/readiness grant. A requiring plugin must reject old host contexts;
the actual registry must verify requirements before creating an owner.

History API #397 must copy the actual `deriveProtocolActionOccurrences` fields
under the original retained trace/capture proof and all current fences. Atomic
plugin #46 needs that capability for the original `lognewbuyo` authorization check.
Do not inject authorization into contract data or accept a plugin-supplied list.

Both the caller SDK and the native MongoDB adapter's own SDK recapture dependency
must use this implementation before activation. Updating only the caller leaves
old native recapture unable to accept the new variant. Consumer pins, original
source/tamper controls and actual host integration are separate delivery gates;
these SDK controls establish no database, chain, API or full parity acceptance.
