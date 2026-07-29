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
  },
});
