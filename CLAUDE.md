# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

UltraRPC is a lightweight, cross-platform desktop API client for REST and gRPC, built with Electron + React. All data is stored locally in human-readable files — no accounts or cloud sync.

Current version: **1.1.0**

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server with hot reload + Electron
bun run build        # Full production build (clean + tsc + vite)
bun run lint         # ESLint
npx tsc --noEmit     # TypeScript type checking

# Testing
bun run test:unit                                     # Run unit tests (bun test)
bun run test:e2e                                      # Build then run all E2E tests (Playwright)
npx playwright test tests/e2e/rest-flow.spec.ts       # Run a single E2E test file
npx playwright test --ui                              # Interactive Playwright UI

# Packaging
bun run package:mac
bun run package:win
bun run package:linux
```

## Architecture

The app is split into two Electron processes:

**Renderer process** (`src/`) — React 19 + TypeScript UI
- `src/App.tsx` — root component, owns all tab/collection/environment/flow state
- `src/components/` — UI components (see full list below)
- `src/types/index.ts` — domain types: RequestConfig, ResponseData, Collection, etc.
- `src/types/flow.ts` — Flow and FlowStep types
- `src/types/electron.d.ts` — TypeScript declarations for the `window.ultraRpc` API
- `src/lib/helpers.ts` — uid generators, empty-object factories
- `src/lib/json-utils.ts` — JSON formatting utilities
- `src/lib/proto-helpers.ts` — protobuf field helpers for gRPC schema tooltips
- `src/lib/toaster-store.ts` — global toast notification store
- `src/hooks/useTreeOpenState.ts` — persists collection tree expansion state
- `src/hooks/useScriptValidation.ts` — validates pre/post scripts before saving

**Main process** (`electron/`) — Node.js, handles side effects
- `electron/main.ts` — Electron lifecycle, window creation, IPC routing, app menu
- `electron/preload.ts` — IPC bridge exposing `window.ultraRpc` to the renderer
- `electron/rest-handler.ts` — executes HTTP requests (Native Node http/https, supports HTTP/1.1 and HTTP/2)
- `electron/grpc-handler.ts` — gRPC calls, server reflection, proto file loading, payload generation, streaming, rich error decoding
- `electron/storage-handler.ts` — reads/writes collections, environments, flows, libraries, and settings as JSON files on disk
- `electron/flow-handler.ts` — IPC handler for Flow execution lifecycle (delegates to the engine)
- `electron/engine/flow-engine.ts` — executes multi-step Flows: steps run in sequence, supports variable passing between steps, timeout/cancel
- `electron/vault-handler.ts` — encrypted secrets vault (per-environment, OS keychain via Electron safeStorage)
- `electron/mcp-server.ts` — Model Context Protocol (MCP) HTTP server; exposes UltraRPC collections to AI assistants as tools
- `electron/bruno-importer.ts` — imports Bruno API collection format
- `electron/format-handler.ts` — code formatting via Prettier (IPC: `code:format`)

**IPC flow:** React calls `window.ultraRpc.*` → preload forwards to main process via `ipcRenderer.invoke` → handler executes and returns result.

**Scripting:** Pre-request and post-response scripts run in the renderer via `new Function()`. They receive an `ultra` object with `request`, `response`, and `variables` APIs for request chaining and variable extraction.

**Storage:** Collections are directory trees with `_meta.json` for metadata. Environments, history, settings, and libraries are JSON files in the Electron `userData` directory. Flows are `.json` files stored alongside collections. Tab state and UI preferences use `localStorage`.

## Components

| Component | Purpose |
|-----------|---------|
| `AboutModal` | Application info and versioning |
| `AiInfoModal` | MCP server status and configuration UI |
| `CollectionPanel` | Sidebar: collections, folders, drag-and-drop reordering |
| `Editor` | CodeMirror 6 wrapper for JSON/code editing with gRPC schema tooltips |
| `EnvironmentPanel` | Sidebar: environments, variables, SSL toggle, vault access |
| `FlowCanvas` | Visual canvas for building and editing multi-step request flows |
| `FlowLogViewer` | Displays real-time execution logs during flow runs |
| `FlowPanel` | Sidebar: flow list management |
| `FlowSettingsDrawer` | Per-flow settings (timeout, variables, etc.) |
| `GrpcReflectionPanel` | gRPC service/method discovery via reflection or proto file |
| `HistoryPanel` | Sidebar: request history timeline (persists 100 entries) |
| `InterpolatedInput` | Input with `{{variable}}` autocomplete and interpolation |
| `IntroPage` | Welcome screen shown when no tabs are open |
| `JsonResponsePickerModal` | Pick a JSON path from a response to use as a flow variable |
| `KeyValueEditor` | Reusable key-value pair editor (headers, params, etc.) |
| `LibraryModal` | Code Library: manage reusable JS script snippets |
| `ProtoDefinitionModal` | Proto Definition Browser: browse and search gRPC schema types |
| `RequestSelectorModal` | Modal to pick an existing request to add to a flow |
| `ResponseViewer` | Response display: formatted JSON, trailers, metrics |
| `StepCard` | Individual flow step card on the FlowCanvas |
| `TabGroupsModal` | Tab group management: create, rename, assign tabs to groups |
| `Toaster` | Toast notification system |
| `Tooltip` | Reusable tooltip wrapper |
| `ValidationBanner` | Inline warning banner for script validation errors |

## Key Patterns

- **Variable interpolation** — `{{variableName}}` syntax resolved at request time; resolution order is collection variables → environment variables
- **gRPC reflection** — services are discovered dynamically without `.proto` files; falls back to local `.proto` if reflection is unavailable
- **gRPC schema tooltips** — CodeMirror editor shows field type/description on hover using the schema registry discovered during reflection
- **Proto Definition Browser** — `ProtoDefinitionModal` lets users browse all message types discovered from reflection or a proto file
- **Tab state** — each request tab is self-contained; `App.tsx` manages an array of tab objects and passes handlers down as props
- **Tab groups** — tabs can be organised into named groups; group membership is persisted in `settings.json`
- **Flows** — multi-step request automation with a visual canvas (`FlowCanvas`). Steps link outputs to inputs via variable extraction (JSONPath). Flows are stored as `.json` files and executed in the main process via `flow-engine.ts`
- **Vault** — per-environment encrypted secret storage using Electron `safeStorage`. Vault entries are used like environment variables with `{{secret:key}}` syntax
- **MCP server** — an HTTP server (Express + SSE) runs in the main process and exposes UltraRPC collections to AI assistants (Claude, Cursor, etc.) using the Model Context Protocol
- **Code Library** — reusable JavaScript snippets that can be inserted into pre/post-request scripts
- **Bruno import** — collections exported from Bruno can be imported via `electron/bruno-importer.ts`
- **E2E tests** — 37 Playwright specs in `tests/e2e/`; use mock servers in `tests/mocks/` (rest-server.ts, grpc-server.ts); tests build the app first via `bun run build`
- **Unit tests** — in `tests/unit/`; run with `bun test`

## Known Constraints & Gotchas

- **Bidi-streaming is not yet fully supported** — only unary and server-streaming are implemented.
- **SSL Verification toggle** is at the Environment level and affects all requests using that environment.
- **Proto file path** is supported in the gRPC call handler; the UI uses Reflection by default.
- **The reflection proto** is written to `os.tmpdir()` on each call — intentional to avoid shipping a proto file.
- **Module format**: ESM (`"type": "module"`), but `grpc-js` and `protobufjs` interop is handled via `createRequire` in `main.ts`.
- **MCP server port** is chosen dynamically at startup; the port is persisted in settings so the UI can display the connection URL.
- **`window.ultraRpc`** is the IPC bridge name (not `window.electronAPI` as referenced in older docs).
- **Flow order** is stored in each collection's `_meta.json` (not in the global `settings.json`).
