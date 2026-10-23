// Vercel function entrypoint.
//
// Vercel only turns files inside a root-level `api/` directory into Serverless
// Functions. A `functions` pattern pointing at `apps/api/...` fails with:
//   Error: [unused_function] The pattern "apps/api/handler/vercel.js" defined
//   in `functions` doesn't match any Serverless Functions inside the `api`
//   directory.
// So this file exists purely to satisfy that rule and delegates to the real
// handler, which stays next to the code it owns.
export { default } from '../apps/api/handler/vercel.js';
