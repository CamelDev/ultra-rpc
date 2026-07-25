# Packages Upgrade Plan

> Generated: 2026-07-25
> Status: All packages are at their latest stable versions (except TypeScript, which is blocked).

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

## 🔲 Task 4: Add Vite `codeSplitting` to reduce bundle size

- **File**: `vite.config.ts`
- **Reason**: The production build warns about chunks > 500 KB (currently 1,189 KB / 365 KB gzipped). Vite 8 with Rolldown supports `build.rolldownOptions.output.codeSplitting` for automatic code-splitting.
- **Risk**: Low — may change the chunk structure but shouldn't break functionality. Needs testing of lazy-loaded routes.
- **Steps**:
  1. Add `build.rolldownOptions.output.codeSplitting: true` to `vite.config.ts`
  2. Verify `bun run build` passes
  3. Check that the output chunks are smaller
  4. Run the app to verify no runtime errors from dynamic imports
  5. Run unit tests to verify

---

## 🔲 Task 5: Upgrade TypeScript to 7.0 (BLOCKED — do not proceed yet)

- **Package**: `typescript@~5.9.3` → `typescript@7.0.2`
- **Blocker**: `typescript-eslint@8.65.0` does not support TS 7.0 yet. Upgrading TS to 7.0 causes `bun run lint` to fail with: `typescript-eslint does not support TS 7.0`.
- **Tracking issue**: https://github.com/typescript-eslint/typescript-eslint/issues/10940
- **Action**: Wait for `typescript-eslint` v9 (or v8.x patch) that adds TS 7.0 support, then upgrade both together.
- **When ready, steps**:
  1. `bun add -d typescript@latest`
  2. Check if `typescript-eslint` supports TS 7.0
  3. If not, wait. If yes, verify `bun run lint` passes
  4. Verify `bun run build` passes
  5. Run unit tests

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
| 4 | Add Vite `codeSplitting` | Medium | Low | No |
| 5 | Upgrade TypeScript to 7.0 | Low | Medium | Yes (typescript-eslint) |
| 6 | Monitor `@dnd-kit` v7 | Low | — | No |
| 7 | Monitor `react-arborist` v4 | Low | — | No |
| 8 | Monitor `prettier` v4 | Low | — | No |