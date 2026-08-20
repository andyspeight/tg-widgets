import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Tests deliberately import only from lib/, never from a .tsx component.
 *
 * That is not laziness about component tests, it is where the logic lives:
 * width normalisation, sanitisation and URL resolution are all pure modules,
 * so they are testable without a DOM or a JSX transform. tsconfig sets
 * jsx:"preserve" for Next, and the runner would need its own JSX setting to
 * import a component. When component tests arrive, add that here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The stub is a module, not a suite. Without this it is collected as an
    // empty test file and reported as a failure.
    exclude: ['tests/stubs/**'],
    /*
     * WHY THIS IS NOT THE DEFAULT 5000ms.
     *
     * The suite pulls a module in with `await import()` INSIDE a test, so that
     * vi.mock is registered before the module under test loads. That means the
     * first test in a file pays for transforming the module's whole graph, and
     * for the big ones that is real money: lib/db/pages.ts on a cold Vite cache
     * measured at roughly 5.6 seconds on 20 Aug 2026. Against a 5000ms limit
     * that is a coin toss, not a limit.
     *
     * The symptom was one test failing per few full runs, always a different
     * one, always the first `await import()` of a heavy module in its file, and
     * always on a run that was itself about twice its usual length. It cost
     * several "run it again and it passes" sessions before it was pinned down.
     *
     * 30 seconds is far past anything a real assertion here needs — the whole
     * suite is pure functions and a fake driver — so a test that hits this is
     * genuinely hung rather than merely unlucky, which is what a timeout is for.
     */
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      // See tests/stubs/server-only.ts. The real package throws on import
      // anywhere that is not a React Server Component, which is every test.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
