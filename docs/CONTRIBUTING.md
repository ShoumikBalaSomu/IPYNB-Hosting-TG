# Contributing to TeleBook

Contributions are welcome. Please adhere to these project guidelines:

1. **Architecture Boundaries**:
   - `packages/shared`: Universal cryptographic primitives and data schemas. Zero external web framework dependencies.
   - `apps/worker`: Cloudflare Worker API. Must observe 10ms CPU budget and avoid storing plaintext.
   - `apps/web`: React client and Mini App. Enforces iframe sandbox boundaries for untrusted execution outputs.
   - `apps/local-server`: Python FastAPI companion maintaining API compatibility with the edge worker.
   - `packages/cli`: Python CLI interface.

2. **Testing**:
   - Add unit tests for every new feature or bug fix.
   - All tests must pass before submitting a pull request:
     ```bash
     npm test
     pytest
     ```

3. **Code Style**:
   - TypeScript must pass strict typechecks (`noImplicitAny: true`).
   - Python code must be formatted cleanly.
