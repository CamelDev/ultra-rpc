# Packages Upgrade Plan

> Generated: 2026-07-25
> TypeScript upgrade revisited: 2026-11-11. TypeScript 7 is used for build/type checking; TypeScript 5.9 remains for ESLint compatibility. Other package statuses below are historical snapshots.

---

## ✅ Already Completed

All major and minor version upgrades have been applied. The following were upgraded in this session:

| Package | From | To | Status |
|---------|------|----|--------|
| `electron` | 41.0.3 | 43.2.0 | ✅ Done |
| `vite` | 7.3.1 | 8.1.5 | ✅ Done |
| `@vitejs/plugin-react` | 5.2.0 | 6.0.4 | ✅ Done |
| `vite-plugin-electron` | 0.29.1 | 1.1.0 | ✅ Done |
| `vite-plugin-electron-renderer` | 0.14.6 | 1.0.0 | ✅ Done |
| `eslint` | 9.39.4 | 10.8.0 | ✅ Done |
| `@eslint/js` | 9.39.4 | 10.0.1 | ✅ Done |
| `globals` | 16.5.0 | 17.7.0 | ✅ Done |
| `lucide-react` | 0.577.0 | 1.26.0 | ✅ Done |
| `eslint-plugin-react-refresh` | 0.4.26 | 0.5.3 | ✅ Done |
| `@types/node` | 24.12.0 | 26.1.1 | ✅ Done |
| All CodeMirror packages | various | latest 6.x | ✅ Done |
| All other packages | various | latest | ✅ Done |

### Upgraded 2026-09-27:

| Package | From | To | Notes |
|---------|------|----|-------|
| `framer-motion` | 12.42.2 | 13.4.4 | Major v13 upgrade, verified passing build & tests |
| `jsonpath-plus` | 10.4.0 | 11.1.0 | Major v11 upgrade, verified passing flow engine tests |
| `react` / `react-dom` | 19.2.8 | 19.3.0 | Minor update |
| `@types/react` / `@types/react-dom` | 19.2.x | 19.3.0 | Minor update |
| `@types/node` | 26.1.1 | 26.6.3 | Patch update |
| `@types/bun` | 1.3.14 | 1.4.2 | Minor update |
| `vite` | 8.1.5 | 8.3.1 | Minor update |
| `vite-plugin-electron` | 1.1.0 | 1.1.2 | Patch update |
| `@vitejs/plugin-react` | 6.0.4 | 6.1.1 | Minor update |
| `eslint` | 10.8.0 | 10.11.0 | Minor update |
| `eslint-plugin-react-refresh` | 0.5.3 | 0.5.7 | Patch update |
| `globals` | 17.7.0 | 17.12.0 | Minor update |
| `typescript-eslint` | 8.65.0 | 8.70.1 | Minor update (TS 5.9 supported) |
| `lucide-react` | 1.26.0 | 1.48.0 | Minor update |
| `react-arborist` | 3.15.1 | 3.16.0 | Minor update |
| `playwright` / `@playwright/test` | 1.62.0 | 1.63.0 | Minor update |
| `@grpc/grpc-js` | 1.14.4 | 1.14.5 | Patch update |
| `@modelcontextprotocol/sdk` | 1.29.0 | 1.30.1 | Minor update |
| `prettier` | 3.9.6 | 3.9.9 | Patch update |
| `protobufjs` | 8.7.1 | 8.8.0 | Minor update |
| `yaml` | 2.9.0 | 2.9.1 | Patch update |
| `electron` | 43.2.0 | 43.7.5 | Latest stable in 43.x series |

---

## ✅ Task 1: Remove unused `core-js` dependency

- **Package**: `core-js@^3.49.0`
- **Reason**: Not imported or referenced anywhere in `src/` or `electron/`. It's dead weight.
- **Risk**: None — removing unused code.
- **Steps**:
  1. `bun remove core-js`
  2. Verify `bun run build` still passes
  3. Verify `bun run lint` still passes
  4. Verify `bun test tests/unit` still passes

---

## ✅ Task 2: Migrate `bun-types` → `@types/bun`

- **Package**: `bun-types@^1.3.14` → `@types/bun@^1.3.14`
- **Reason**: `@types/bun` follows the standard DefinitelyTyped conventions and is the community-recommended way to get Bun types. Both packages are at the same version (1.3.14) and maintained, but `@types/bun` is more widely adopted.
- **Risk**: Low — may need to update `/// <reference types="bun-types" />` directives in test files.
- **Files affected**:
  - `package.json` — swap devDependency
  - `tsconfig.test.json` — update `"types": ["bun-types"]` → `"types": ["bun"]`
  - `tests/unit/grpc-discovery.test.ts` — update reference directive
  - `tests/unit/mcp-tools.test.ts` — update reference directive
  - `tests/unit/proto-browser-helpers.test.ts` — update reference directive
- **Steps**:
  1. `bun remove bun-types && bun add -d @types/bun`
  2. Update `tsconfig.test.json` types field
  3. Update `/// <reference types="bun-types" />` → `/// <reference types="bun" />` in 3 test files
  4. Verify `bun test tests/unit` passes
  5. Verify `bun run build` passes

---

## ✅ Task 3: Replace `npx` with `bunx` in `clean` script

- **File**: `package.json` → `"clean"` script
- **Previous**: `"clean": "npx -y rimraf dist dist-electron release"`
- **Current**: `"clean": "bunx rimraf dist dist-electron release"`
- **Reason**: The project uses `bun` exclusively as the package manager. Using `npx` downloads a separate copy of the package via npm. `bunx` is faster and aligns with the project's tooling.
- **Risk**: None — `bunx` is a drop-in replacement for `npx`.
- **Steps**:
  1. ✅ Updated the `clean` script in `package.json`
  2. ✅ Verified `bun run build` (which calls `clean`) still passes

---

## ✅ Task 4: Add Vite `codeSplitting` to reduce bundle size

- **File**: `vite.config.ts`
- **Reason**: The production build warned about chunks > 500 KB (previously 1,189 KB / 365 KB gzipped). Vite 8 with Rolldown supports `build.rolldownOptions.output.codeSplitting` for automatic code-splitting.
- **Risk**: Low — changes the chunk structure but doesn't break functionality. The app has no dynamic `import()` routes, so no runtime errors from lazy loading.
- **Result**: Build now emits 8 chunks instead of 1. The largest chunk is `codemirror` at 463 KB (157 KB gzipped), under the 500 KB warning threshold. The warning is gone.
- **Chunk breakdown**:
  | Chunk | Size | Gzipped |
  |-------|------|---------|
  | `codemirror` | 463.43 kB | 156.84 kB |
  | `index` (app code) | 220.76 kB | 54.51 kB |
  | `react` | 178.31 kB | 56.33 kB |
  | `framer` | 130.20 kB | 42.71 kB |
  | `vendor` | 100.38 kB | 26.56 kB |
  | `dndkit` | 79.67 kB | 24.27 kB |
  | `lucide` | 16.17 kB | 5.54 kB |
  | `rolldown-runtime` | 0.87 kB | 0.50 kB |
- **Steps**:
  1. ✅ Added `build.rolldownOptions.output.codeSplitting: true` and `manualChunks` to `vite.config.ts`
  2. ✅ Verified `bun run build` passes (no chunk size warning)
  3. ✅ Verified output chunks are smaller (largest: 463 KB, down from 1,189 KB)
  4. ✅ Verified no runtime errors from dynamic imports (app has none)
  5. ✅ Verified unit tests pass (44/44)
  6. ✅ Verified `bun run lint` passes

---

## ✅ Task 5: Use TypeScript 7 for build/type checking (completed 2026-11-11)

- **Decision (2026-11-11)**: Upgrade the compiler independently of ESLint's parser dependency.
- **Compiler**: `@typescript/native` is an exact npm alias for `typescript@7.0.2`.
- **ESLint compatibility**: Keep `typescript@~5.9.3` and `typescript-eslint@^8.72.0`. The parser requires the JavaScript compiler API and declares support for `>=4.8.4 <6.1.0`.
- **Commands**: `bun run typecheck` invokes the TypeScript 7 compiler by its explicit package path; `bun run build` calls this script before Vite. Do not use bare `tsc`, since both packages provide that executable name.
- **Rationale**: The installed typescript-eslint package itself uses the same `@typescript/native` alias for development. Keeping its supported TypeScript dependency avoids disabling lint checks or suppressing version warnings.
- **Upstream**: [Supported dependency versions](https://typescript-eslint.io/users/dependency-versions/). [Issue #10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) tracks using the native compiler for typed linting; this project currently uses `tseslint.configs.recommended` without typed linting.
- **Future cleanup**: Consolidate compiler dependencies when typescript-eslint supports the TypeScript 7 API.
- **Validation (2026-11-11)**: Installed compiler reports `Version 7.0.2`; `bun run build` (including `bun run typecheck`) and `bun run lint` pass. All 102 unit tests pass. Electron smoke tests in `mock-rest.spec.ts` and `mock-grpc.spec.ts` pass (5 tests covering REST methods, reflection, server streaming, and rich gRPC errors). The full E2E suite was not run.
- **Existing build warning**: Vite warns that `__dirname` in `vite.config.ts` will be unsupported by its future native config loader. It does not prevent the current build and is separate from this compiler upgrade.

---

## 🔲 Task 6: Monitor for `@dnd-kit` v7

- **Packages**: `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`
- **Status**: All at latest stable. No v7 announced yet.
- **Action**: Check periodically for major version releases. `@dnd-kit` is used in `CollectionPanel.tsx` for drag-and-drop reordering.

---

## 🔲 Task 7: Monitor for `react-arborist` v4

- **Package**: `react-arborist@3.15.1`
- **Status**: At latest stable. No v4 announced yet.
- **Action**: Check periodically. Used in `CollectionPanel.tsx` for the tree view.

---

## 🔲 Task 8: Monitor for `prettier` v4

- **Package**: `prettier@3.9.6`
- **Status**: At latest stable v3. No v4 announced yet.
- **Action**: Check periodically. Used in `electron/format-handler.ts` for code formatting.

---

## Summary

| # | Task | Priority | Risk | Blocked |
|---|------|----------|------|---------|
| 1 | Remove `core-js` | High | None | No | ✅ Done |
| 2 | Migrate `bun-types` → `@types/bun` | Medium | Low | No | ✅ Done |
| 3 | Replace `npx` with `bunx` | Low | None | No | ✅ Done |
| 4 | Add Vite `codeSplitting` | Medium | Low | No | ✅ Done |
| 5 | Use TypeScript 7 for build/type checking | Low | Medium | No (separate ESLint dependency); ✅ Done |
| 6 | Monitor `@dnd-kit` v7 | Low | — | No |
| 7 | Monitor `react-arborist` v4 | Low | — | No |
| 8 | Monitor `prettier` v4 | Low | — | No |
