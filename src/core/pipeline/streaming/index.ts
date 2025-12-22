/**
 * Streaming pipeline primitives for async generator-based processing.
 *
 * This module provides the foundational building blocks for creating
 * pull-based, demand-driven streaming pipelines with lazy evaluation,
 * backpressure, and incremental processing.
 *
 * @module streaming
 */

// Export composition utilities
export type { GeneratorFn } from "./compose";
export { compose, identity, lift, liftFilter, liftFlatMap, pipe } from "./compose";
// Export generator utilities
export {
  batch,
  filter,
  flatMap,
  flatten,
  fromArray,
  fromAsyncIterable,
  map,
  skip,
  take,
  tap,
  toArray,
} from "./generators";
// Export all types
export type {
  AddToState,
  KeyExists,
  StreamError,
  StreamItemMetadata,
  StreamingPipeline,
  StreamingState,
  StreamingStep,
  StreamingStepAccumulated,
  StreamingStepContext,
  StreamingStepFn,
  StreamingStepInput,
  StreamingStepOutput,
  StreamResult,
  ValidateNewKey,
} from "./types";
