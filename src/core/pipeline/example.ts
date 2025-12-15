/**
 * Example demonstrating the enhanced type-safe pipeline with accumulated state.
 *
 * This file shows how:
 * 1. Steps can reference outputs from ANY previous step (not just the immediate predecessor)
 * 2. TypeScript validates at compile-time that referenced steps exist
 * 3. Duplicate step names are prevented at compile time
 * 4. Type safety is maintained throughout the pipeline
 */

import { Pipeline } from './builder';
import { createStep } from './steps';

// Example types
interface User {
  id: string;
  name: string;
}

interface UserProfile {
  user: User;
  email: string;
  age: number;
}

interface Embedding {
  vector: number[];
  text: string;
}

interface SearchResult {
  id: string;
  score: number;
  content: string;
}

// Example 1: Simple linear pipeline (works like before)
// Steps are defined inline in the pipeline for maximum flexibility
const simplePipeline = Pipeline.start<string>()
  .add('user', createStep<string, User>('fetchUser', async ({ input }) => {
    return { id: input, name: 'John Doe' };
  }))
  .add('profile', createStep<User, UserProfile, { user: User }>('enrichProfile', async ({ input, state }) => {
    // Can access state.user here if needed
    return { user: input, email: 'john@example.com', age: 30 };
  }));

// Example 2: Pipeline where steps reference previous steps by name
const ragPipeline = Pipeline.start<string>()
  .add('embed', createStep<string, Embedding>('embed', async ({ input }) => {
    return {
      vector: [0.1, 0.2, 0.3],
      text: input
    };
  }))
  .add('search', createStep<Embedding, SearchResult[], { embed: Embedding }>(
    'search',
    async ({ input, state }) => {
      // input is the Embedding from the previous step
      // state.embed is ALSO available and is the same as input in this case
      // In a real scenario, a later step could reference state.embed even if
      // there were other steps in between

      console.log('Searching with vector:', input.vector);
      console.log('Original text from state:', state.embed.text);

      return [
        { id: '1', score: 0.9, content: 'Result 1' },
        { id: '2', score: 0.8, content: 'Result 2' }
      ];
    }
  ))
  .add('rerank', createStep<
    SearchResult[],
    SearchResult[],
    { embed: Embedding; search: SearchResult[] }  // TypeScript validates these exist!
  >(
    'rerank',
    async ({ input, state }) => {
      // input is the SearchResult[] from the previous step
      // state.embed is the Embedding from the 'embed' step
      // state.search is the SearchResult[] from the 'search' step

      console.log('Reranking with original query:', state.embed.text);
      console.log('Previous results count:', state.search.length);

      return input.sort((a, b) => b.score - a.score);
    }
  ));

// Example 3: Compile-time validation

// ❌ This would NOT compile - trying to reference a step that doesn't exist yet
// const invalidStep = createStep<string, number, { nonexistent: string }>('invalid', async ({ state }) => {
//   return state.nonexistent.length;  // TypeScript error: 'nonexistent' doesn't exist in state
// });

// ❌ This would NOT compile - duplicate step names are prevented
// const duplicatePipeline = Pipeline.start<string>()
//   .add('step1', simpleStep1)
//   .add('step1', simpleStep2);  // TypeScript error: 'step1' already exists

// Example 4: Complex pipeline with branching
const complexPipeline = Pipeline.start<string>()
  .add('embed', createStep<string, Embedding>('embed', async ({ input }) => {
    return { vector: [0.1, 0.2, 0.3], text: input };
  }))
  .add('search', createStep<Embedding, SearchResult[], { embed: Embedding }>(
    'search',
    async ({ input, state }) => {
      console.log('Searching for:', state.embed.text);
      return [
        { id: '1', score: 0.9, content: 'Result 1' },
        { id: '2', score: 0.8, content: 'Result 2' }
      ];
    }
  ))
  .add('rerank', createStep<
    SearchResult[],
    SearchResult[],
    { embed: Embedding; search: SearchResult[] }
  >('rerank', async ({ input, state }) => {
    return input.sort((a, b) => b.score - a.score);
  }))
  .add('analyze', createStep<
    SearchResult[],
    { decision: 'good' | 'bad'; reason: string },
    { embed: Embedding; search: SearchResult[]; rerank: SearchResult[] }
  >(
    'analyze',
    async ({ input, state }) => {
      // Can access all previous steps!
      const topResult = input[0];
      const originalQuery = state.embed.text;

      if (topResult && topResult.score > 0.85) {
        return { decision: 'good', reason: `High confidence match for "${originalQuery}"` };
      }
      return { decision: 'bad', reason: 'Low confidence results' };
    }
  ));

// Example usage:
export async function runExamples() {
  console.log('=== Example 1: Simple Pipeline ===');
  const result1 = await simplePipeline.execute('user-123');
  if (result1.success) {
    console.log('Profile:', result1.data);
  }

  console.log('\n=== Example 2: RAG Pipeline with State Access ===');
  const result2 = await ragPipeline.execute('What is TypeScript?');
  if (result2.success) {
    console.log('Reranked results:', result2.data);
  }

  console.log('\n=== Example 3: Complex Pipeline with Analysis ===');
  const result3 = await complexPipeline.execute('Explain closures in JavaScript');
  if (result3.success) {
    console.log('Analysis:', result3.data);
  }
}

// Export for documentation
export {
  simplePipeline,
  ragPipeline,
  complexPipeline
};
