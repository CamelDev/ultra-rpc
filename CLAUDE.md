# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

UltraRPC is a lightweight, cross-platform desktop API client for REST and gRPC, built with Electron + React. All data is stored locally in human-readable files — no accounts or cloud sync.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server with hot reload + Electron
bun run build        # Full production build
bun run lint         # ESLint
npx tsc --noEmit     # TypeScript type checking

# Testing (Playwright E2E)
bun run test:e2e                                      # Build then run all E2E tests
npx playwright test tests/e2e/rest-flow.spec.ts       # Run a single test file
npx playwright test --ui                              # Interactive test UI

# Packaging
bun run package:mac
bun run package:win
bun run package:linux
```

## Architecture

The app is split into two Electron processes:

**Renderer process** (`src/`) — React 19 + TypeScript UI
- `src/App.tsx` — root component, owns all tab/collection/environment state
- `src/components/` — UI components (ResponseViewer, KeyValueEditor, CollectionPanel, EnvironmentPanel, etc.)
- `src/types/index.ts` — all shared TypeScript types
- `src/lib/helpers.ts` — utility functions including variable interpolation

**Main process** (`electron/`) — Node.js, handles side effects
- `electron/main.ts` — Electron lifecycle, window creation, IPC routing, app menu
- `electron/rest-handler.ts` — executes HTTP requests (Axios, supports HTTP/1.1 and HTTP/2)
- `electron/grpc-handler.ts` — executes gRPC calls, server reflection, proto file loading, streaming
- `electron/storage-handler.ts` — reads/writes collections and environments as JSON files on disk
- `electron/preload.ts` — IPC bridge exposing `window.electronAPI` to the renderer

**IPC flow:** React calls `window.electronAPI.*` → preload forwards to main process via `ipcRenderer.invoke` → handler executes and returns result.

**Scripting:** Pre-request and post-response scripts run in the renderer via `new Function()`. They receive an `ultra` object with `request`, `response`, and `variables` APIs for request chaining and variable extraction.

**Storage:** Collections and environments are JSON files on disk. Tab state and UI preferences use `localStorage`.

## Key Patterns

- **Variable interpolation** — `{{variableName}}` syntax resolved at request time; resolution order is tab environment → collection variables → request-level overrides
- **gRPC reflection** — services are discovered dynamically without `.proto` files; falls back to local `.proto` if reflection is unavailable
- **Tab state** — each request tab is self-contained; `App.tsx` manages an array of tab objects and passes handlers down as props
- **E2E tests** — use mock servers in `tests/mocks/` (rest-server.ts, grpc-server.ts); tests build the app first via `bun run build`
