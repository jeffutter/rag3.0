---
id: task-12
title: Design and implement state management for streaming pipelines
status: To Do
assignee: []
created_date: '2025-12-22 16:37'
labels:
  - streaming
  - state-management
  - architecture
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Solve the state accumulation problem for streaming pipelines where execution is lazy and pull-based.

**Current State Management:**
In batch pipeline (`builder.ts:573-575`):
```typescript
accumulatedState[stage.key] = result.data;
currentData = result.data;
```
- Each step adds its final result to accumulated state
- Later steps access earlier results via `state.stepName`
- Type-safe through TypeScript generics

**Streaming Challenge:**
With generators, execution is lazy:
- Step N might not execute until step N+5 pulls
- Can't accumulate "final result" because there isn't one
- State might be needed mid-stream (e.g., item 100 needs to reference step 2's aggregation)

**Potential Approaches:**

1. **Per-Item State Context:**
   - Each yielded item carries state context
   - Type: `{ value: T, state: AccumulatedState }`
   - Pros: Type-safe, explicit
   - Cons: Overhead, unclear semantics for aggregations

2. **Shared Mutable State:**
   - Steps write to shared state object as they process
   - Accessible via closure or context parameter
   - Pros: Similar to current model
   - Cons: Race conditions if parallel, unclear lifecycle

3. **Two-Phase: Setup + Stream:**
   - "Setup" phase: eager execution for state-building steps
   - "Stream" phase: lazy execution with access to setup state
   - Pros: Explicit, no surprises
   - Cons: Less flexible, breaks pure streaming

4. **State Reduction Points:**
   - Mark certain steps as "materialization points"
   - Entire stream up to that point executes, result stored
   - Subsequent steps can access materialized state
   - Pros: Explicit control, predictable
   - Cons: Breaks streaming at materialization points

**Design Questions:**
- Should state be per-item or pipeline-global?
- How to handle aggregations (need full stream to compute)?
- How to type accumulated state with generators?
- Migration path from current state model?

**Recommended Approach to Design:**
Start with approach #4 (State Reduction Points) because:
- Explicit and understandable
- Compatible with current mental model
- Allows optimization (only materialize when needed)
- Clear semantics for when state is available

**Implementation Tasks:**
- Define API for marking reduction points
- Implement state accumulation at reduction points
- Type-safe state access in downstream steps
- Handle branching (different branches need different state)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 State management approach selected and documented
- [ ] #2 API designed for accessing accumulated state in streaming context
- [ ] #3 Type safety preserved for state access
- [ ] #4 Handles both per-item and aggregated state scenarios
- [ ] #5 Clear semantics for when state is available
- [ ] #6 Migration path from current batch pipeline state model
- [ ] #7 Examples demonstrating state access patterns
<!-- AC:END -->
