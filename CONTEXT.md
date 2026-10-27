# Hyperion SDK projection language

The terms below describe the proposed stateful projection family alongside the existing shared
Hyperion language. Their presence does not adopt or implement the proposal.

## Language

**Compound projection**:
A projection whose declared records and source dependencies form one ordered completeness scope.
Its completed checkpoint covers the whole scope, including required relationships.

**Source occurrence**:
One specifically located action or table change in the original selected source. Its identity is
separate from its position in a plugin's processing order.

**Reduction**:
The computation of ordered logical mutations from versioned source inputs and a declared prior view.

**Staged record**:
A record resulting from an earlier mutation in the current reduction, before durable application.

**Covered absence**:
The absence of a requested record in a complete declared source scope at the requested view.
Missing inputs or unknown relationship coverage do not establish covered absence.

**Processing view**:
The coherent prior state used by one reduction. It is distinct from permission to serve an API response.

**Candidate application**:
The captured inputs, prior view, observed records and logical mutations proposed for one source block.
It remains distinct from evidence that those effects committed.

**Coherent keyed read**:
Related exact-key lookups evaluated at the same eligible projection view, including covered absences.
