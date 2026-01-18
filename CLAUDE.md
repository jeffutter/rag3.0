
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Tooling

### Beads

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

#### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

#### Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

### Biome

Use `biome` directly, NOT `bunx biome`. Biome is installed through the nix flake, and running it via `bunx` attempts to download a dynamically linked binary that isn't compatible with NixOS.

- Use `biome check` instead of `bunx biome check`
- Use `biome format` instead of `bunx biome format`
- Use `biome lint` instead of `bunx biome lint`

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Pipeline Architecture

### Steps vs Utility Functions vs Workflows

**CRITICAL RULE: Steps must not call other steps.**

This architecture enforces separation of concerns for better maintainability, testability, and composability.

#### Component Types

- **Steps** are pipeline building blocks that can be composed in workflows
  - Created using `createStep()`
  - Encapsulate a single operation with schema validation and error handling
  - Should appear as distinct pipeline stages
  - May call utility functions for business logic

- **Utility Functions** contain reusable business logic
  - Pure functions that perform specific operations
  - Located in `src/lib/`
  - Can be used by steps, workflows, or other utilities
  - Independently testable without pipeline infrastructure

- **Workflows** compose multiple steps together
  - Located in `src/workflows/`
  - Use the `Pipeline` builder to chain steps
  - Define the overall data flow and orchestration
  - Workflows can call other workflows if needed

#### When to Create a Step

Create a step when:
- The operation will be used in multiple workflows
- The operation needs pipeline integration (error handling, retries, metadata)
- The operation should appear as a distinct, trackable pipeline stage

#### When to Create a Utility Function

Create a utility function when:
- The logic needs to be shared between multiple steps
- The logic needs to be used outside of pipelines
- The logic is a pure transformation, calculation, or I/O operation
- You want to test the logic independently from the pipeline

#### Anti-Pattern: Steps Calling Steps

DO NOT create steps that call other steps. This creates tight coupling and defeats the purpose of the pipeline architecture.

```typescript
// BAD - Step calling another step
const badStep = createStep("bad", async ({ input }) => {
  // This creates tight coupling and makes the step hard to test
  const result = await otherStep.execute({ input, state: {}, context: undefined });
  return result.data;
});
```

Instead, extract shared logic to utility functions:

```typescript
// GOOD - Step using utility function
const goodStep = createStep("good", async ({ input }) => {
  // Clean separation: step handles pipeline integration,
  // utility function contains the business logic
  return await utilityFunction(input);
});
```

#### Examples

**Utility Function (src/lib/file-io.ts):**
```typescript
// Pure function for reading files
export async function readFile(path: string): Promise<FileReadResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  const content = await file.text();
  return { content, source: path };
}
```

**Step Using Utility (inline in workflow):**
```typescript
// Step wraps the utility function with pipeline integration
createStep("readFile", async ({ input }) => {
  try {
    const result = await readFile(input.path);
    return [{ ...result, path: input.path }];
  } catch (error) {
    console.warn(`Error reading file ${input.path}:`, error);
    return [];
  }
})
```

**Workflow Composing Steps (src/workflows/embed-documents.ts):**
```typescript
const pipeline = Pipeline.start<{ path: string; pattern?: string }>()
  .add("discover", discoverFilesStep)
  .flatMap("readFiles", createStep(...), { parallel: true })
  .flatMap("cleanedFiles", createStep(...), { parallel: true })
  .flatMap("chunks", createStep(...), { parallel: true })
  .map("chunksWithEOT", createStep(...), { parallel: false });
```

For more details, see `docs/architecture/steps-and-workflows.md`.

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
