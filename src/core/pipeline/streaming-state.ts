/**
 * State management implementation for streaming pipelines.
 *
 * Implements the hybrid state management approach from the design document:
 * - Streaming state: Current item flows through async generators
 * - Snapshot state: Accumulated state captured at checkpoints
 * - Lazy materialization: State loaded only when accessed
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/streaming-pipeline-design.md}
 */

import type { StreamingState } from "./streaming-types";

/**
 * Internal representation of state storage.
 */
interface StateStorage {
  /** Snapshots stored at checkpoints (materialized arrays) */
  // biome-ignore lint/suspicious/noExplicitAny: Storage requires any[] to hold arrays of any type from different steps
  snapshots: Record<string, any[]>;

  /** Active generators for non-checkpointed steps */
  // biome-ignore lint/suspicious/noExplicitAny: Generators can yield any type from different steps
  generators: Record<string, AsyncGenerator<any>>;
}

/**
 * Implementation of StreamingState interface.
 *
 * Manages hybrid state access:
 * 1. Checkpointed steps: Access via snapshots (fast, materialized)
 * 2. Non-checkpointed steps: Access via generators (memory-efficient)
 * 3. Lazy materialization: Convert generators to arrays on demand
 */
export class StreamingStateImpl<
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any>,
> implements StreamingState<TAccumulated>
{
  private storage: StateStorage;
  private accumulatedCache: TAccumulated | null = null;

  // biome-ignore lint/suspicious/noExplicitAny: Constructor parameters match StateStorage type requirements
  constructor(snapshots: Record<string, any[]> = {}, generators: Record<string, AsyncGenerator<any>> = {}) {
    this.storage = { snapshots, generators };
  }

  /**
   * Get accumulated state snapshot.
   * Only includes checkpointed steps.
   */
  get accumulated(): TAccumulated {
    if (this.accumulatedCache) {
      return this.accumulatedCache;
    }

    // Build accumulated state from snapshots
    // Note: This only includes checkpointed steps
    this.accumulatedCache = { ...this.storage.snapshots } as TAccumulated;
    return this.accumulatedCache;
  }

  /**
   * Access a step's output as an async generator.
   *
   * If the step has been checkpointed, yields from the snapshot array.
   * Otherwise, yields from the active generator.
   */
  async *stream<K extends keyof TAccumulated>(key: K): AsyncGenerator<TAccumulated[K]> {
    const keyStr = key as string;

    // Check if we have a snapshot
    if (keyStr in this.storage.snapshots) {
      const snapshot = this.storage.snapshots[keyStr];
      if (!snapshot) {
        throw new Error(`Snapshot for key "${keyStr}" is undefined`);
      }
      // Yield from materialized snapshot
      for (const item of snapshot) {
        yield item as TAccumulated[K];
      }
      return;
    }

    // Check if we have an active generator
    if (keyStr in this.storage.generators) {
      const generator = this.storage.generators[keyStr];
      if (!generator) {
        throw new Error(`Generator for key "${keyStr}" is undefined`);
      }
      for await (const item of generator) {
        yield item as TAccumulated[K];
      }
      return;
    }

    throw new Error(
      `State key "${keyStr}" not found. Available keys: ${Object.keys({ ...this.storage.snapshots, ...this.storage.generators }).join(", ")}`,
    );
  }

  /**
   * Materialize a stream to an array.
   *
   * If already checkpointed, returns the snapshot.
   * Otherwise, consumes the generator and caches the result.
   */
  async materialize<K extends keyof TAccumulated>(key: K): Promise<Array<TAccumulated[K]>> {
    const keyStr = key as string;

    // If we have a snapshot, return it
    if (keyStr in this.storage.snapshots) {
      const snapshot = this.storage.snapshots[keyStr];
      if (!snapshot) {
        throw new Error(`Snapshot for key "${keyStr}" is undefined`);
      }
      return [...snapshot] as Array<TAccumulated[K]>;
    }

    // If we have a generator, consume it
    if (keyStr in this.storage.generators) {
      const items: Array<TAccumulated[K]> = [];
      const generator = this.storage.generators[keyStr];

      if (!generator) {
        throw new Error(`Generator for key "${keyStr}" is undefined`);
      }

      for await (const item of generator) {
        items.push(item as TAccumulated[K]);
      }

      // Cache the materialized result as a snapshot
      this.storage.snapshots[keyStr] = items;
      delete this.storage.generators[keyStr];

      // Invalidate accumulated cache
      this.accumulatedCache = null;

      return items;
    }

    throw new Error(
      `State key "${keyStr}" not found. Available keys: ${Object.keys({ ...this.storage.snapshots, ...this.storage.generators }).join(", ")}`,
    );
  }

  /**
   * Check if a key has a snapshot available.
   */
  hasSnapshot(key: keyof TAccumulated): boolean {
    return (key as string) in this.storage.snapshots;
  }

  /**
   * Add a snapshot for a key.
   * Used internally when checkpoints are created.
   */
  addSnapshot<K extends keyof TAccumulated>(key: K, data: Array<TAccumulated[K]>): void {
    const keyStr = key as string;
    this.storage.snapshots[keyStr] = data;

    // Remove any generator for this key
    delete this.storage.generators[keyStr];

    // Invalidate accumulated cache
    this.accumulatedCache = null;
  }

  /**
   * Add a generator for a key.
   * Used internally for non-checkpointed steps.
   */
  addGenerator<K extends keyof TAccumulated>(key: K, generator: AsyncGenerator<TAccumulated[K]>): void {
    const keyStr = key as string;
    this.storage.generators[keyStr] = generator;

    // Invalidate accumulated cache
    this.accumulatedCache = null;
  }

  /**
   * Clone the state for a new pipeline stage.
   * Creates a new instance with the same snapshots and generators.
   */
  clone(): StreamingStateImpl<TAccumulated> {
    return new StreamingStateImpl<TAccumulated>({ ...this.storage.snapshots }, { ...this.storage.generators });
  }

  /**
   * Create a new state instance with an added key.
   * Used when building up state through pipeline stages.
   */
  withKey<K extends string, V>(key: K, generator: AsyncGenerator<V>): StreamingStateImpl<TAccumulated & Record<K, V>> {
    const newState = new StreamingStateImpl<TAccumulated & Record<K, V>>(
      { ...this.storage.snapshots },
      { ...this.storage.generators, [key]: generator },
    );
    return newState;
  }

  /**
   * Create a new state instance with a checkpoint.
   * Materializes the generator and stores as snapshot.
   */
  async withCheckpoint<K extends string, V>(
    key: K,
    generator: AsyncGenerator<V>,
  ): Promise<StreamingStateImpl<TAccumulated & Record<K, V>>> {
    // Materialize the generator
    const items: V[] = [];
    for await (const item of generator) {
      items.push(item);
    }

    const newState = new StreamingStateImpl<TAccumulated & Record<K, V>>(
      { ...this.storage.snapshots, [key]: items },
      { ...this.storage.generators },
    );

    return newState;
  }
}

/**
 * Create an empty streaming state.
 * Used to initialize streaming pipelines.
 */
export function createEmptyStreamingState(): StreamingStateImpl<Record<string, never>> {
  return new StreamingStateImpl<Record<string, never>>({}, {});
}

/**
 * Helper to convert async generator to array.
 * Utility function for testing and debugging.
 */
export async function collectStream<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of generator) {
    items.push(item);
  }
  return items;
}

/**
 * Helper to create async generator from array.
 * Utility function for testing and interop with batch pipelines.
 */
export async function* arrayToGenerator<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Helper to replay a generator (by caching items).
 * Useful when a generator needs to be consumed multiple times.
 *
 * WARNING: This materializes the entire generator in memory.
 * Use sparingly and only for small datasets.
 */
export async function replayableGenerator<T>(generator: AsyncGenerator<T>): Promise<() => AsyncGenerator<T>> {
  const items: T[] = [];
  for await (const item of generator) {
    items.push(item);
  }

  return async function* () {
    for (const item of items) {
      yield item;
    }
  };
}
