/**
 * A stand-in for the `server-only` marker package.
 *
 * That package's whole job is to throw when it is imported outside a React
 * Server Component. It does that by having its default export throw and its
 * "react-server" export condition point at an empty file, so bundlers that
 * know about server components get the empty one and everything else gets the
 * error.
 *
 * Vitest is neither, so importing any module marked server-only throws before
 * a single test runs. The alias in vitest.config.ts points here instead.
 *
 * Aliasing rather than adding "react-server" to resolve.conditions on purpose:
 * that condition would also change how React itself resolves, and pulling
 * React's server build into a plain node test run is a much stranger problem
 * to debug than this file is to read.
 */

export {};
