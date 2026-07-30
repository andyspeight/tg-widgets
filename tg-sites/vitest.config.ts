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
  },
  resolve: {
    alias: {
      // See tests/stubs/server-only.ts. The real package throws on import
      // anywhere that is not a React Server Component, which is every test.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
