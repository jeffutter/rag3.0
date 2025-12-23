---
id: task-17
title: Create comprehensive streaming pipeline examples and documentation
status: Done
assignee: []
created_date: '2025-12-22 16:38'
updated_date: '2025-12-23 20:28'
labels:
  - streaming
  - documentation
  - examples
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build example pipelines and documentation showing how to use streaming pipelines effectively.

**Examples to Create** (`src/core/pipeline/examples/streaming/`):

1. **Basic Streaming** (`01-basic-streaming.ts`):
   - Simple map/filter/tap operations
   - Streaming from array
   - Consuming with for-await-of
   - Shows lazy evaluation benefits

2. **Parallel Processing** (`02-parallel-streaming.ts`):
   - Parallel map with concurrency control
   - Ordered vs unordered results
   - Backpressure demonstration
   - Performance comparison to batch

3. **Error Handling** (`03-error-handling.ts`):
   - Retry logic with exponential backoff
   - Different error strategies (fail-fast, skip-failed, wrap)
   - Error recovery patterns
   - Metadata for failed items

4. **Real-World RAG Pipeline** (`04-rag-pipeline.ts`):
   - Stream documents from source
   - Chunk in parallel
   - Batch for embedding API
   - Stream to vector store
   - Show memory savings vs batch
   - Show latency to first result

5. **Advanced Windowing** (`05-windowing.ts`):
   - Fixed-size batches
   - Sliding windows
   - Time-based batching
   - Custom windowing logic

6. **State Management** (`06-state-management.ts`):
   - Reduction points for materialization
   - Accessing accumulated state
   - Stateful transformations
   - When to use batch vs streaming for state

**Documentation** (`docs/streaming-pipelines.md`):

1. **Conceptual Overview:**
   - Push vs pull execution models
   - When to use streaming vs batch
   - Benefits and tradeoffs
   - Memory and performance characteristics

2. **API Reference:**
   - StreamingPipeline builder methods
   - All streaming operations
   - Options and configuration
   - Type signatures

3. **Patterns and Best Practices:**
   - Composing streaming operations
   - Error handling patterns
   - Backpressure management
   - Performance optimization
   - Testing streaming pipelines

4. **Migration Guide:**
   - Converting batch pipelines to streaming
   - Identifying candidates for streaming
   - Handling non-streamable operations
   - Performance tuning

5. **Comparison Table:**
   | Feature | Batch Pipeline | Streaming Pipeline |
   |---------|---------------|-------------------|
   | Execution | Eager | Lazy |
   | Memory | Full dataset | Bounded |
   | Latency | All items | First item fast |
   | Backpressure | No | Yes |
   | State | Accumulated | Reduction points |

**Interactive Examples:**
- Code snippets with expected output
- Performance metrics showing benefits
- Memory usage graphs
- Visual diagrams of data flow

**Testing:**
- All examples must run successfully
- Examples should be tested in CI
- Output should be deterministic where possible

**Documentation Quality:**
- Clear explanations for beginners
- Deep dives for advanced users
- Real-world use cases
- Troubleshooting section
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Six comprehensive example files covering all streaming features
- [x] #2 Examples demonstrate lazy evaluation, parallel processing, error handling
- [x] #3 Real-world RAG pipeline example with metrics
- [x] #4 Complete API reference documentation
- [x] #5 Migration guide from batch to streaming pipelines
- [x] #6 Patterns and best practices documented
- [x] #7 Comparison table highlighting differences
- [x] #8 All examples tested and working
- [x] #9 Documentation reviewed for clarity and completeness
<!-- AC:END -->
