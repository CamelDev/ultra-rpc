# UltraRPC — Agent Context

> This file provides AI coding assistants with the essential context needed to understand, modify, and extend UltraRPC.

---

## Project Identity

- **Name**: UltraRPC
- **Type**: Desktop application (Electron)
- **Purpose**: Lightweight API client for REST and gRPC testing — like Postman with native gRPC reflection support and file-based collections
- **License**: MIT
- **Documentation**: See [README.md](file:///Users/kamildabrowski/projects/ultra-rpc/README.md) for user-facing features and screenshots.

---

## Tech Stack

# UltraRPC: Agent Context & Gotchas

This file summarizes critical, non-obvious context for working in UltraRPC.

## 💡 Key Constraints & Gotchas (High Priority)
*   **Process Model**: UltraRPC is a two-process Electron app (Main Process in Node.js, Renderer in Chromium). System APIs (IPC, HTTP, FS) must be handled by the Main Process and exposed via the `window.ultraRpc` bridge.
*   **Native Modules Interop**: The `@grpc/grpc-js` and `protobufjs` packages are externalized CJS modules. Their usage in the main process relies on `globalThis.require = createRequire(import.meta.url)` in `main.ts` to enable dynamic `require()` calls, which is non-standard for a pure ESM build.
*   **File System Mapping**: The UI sidebar maintains a strict, physical one-to-one mapping with the filesystem. Deleting or renaming an item in the UI physically affects the file/directory on disk.
*   **Variable Resolution Order**: Variables resolve in the order: **Vault** (`{{secret:key}}`) → **Collection** → **Environment**.
*   **Data Passing**: Data between flow steps is passed via JSONPath extraction, requiring careful handling of step outputs.

## 🛠️ Development Commands & Workflow
*   **Package Manager**: Use `bun` exclusively for all dependency management and script execution.
*   **Dev Server**: `bun run dev` starts the combined Electron + Vite HMR environment.
*   **Build**: `bun run build` compiles TypeScript and generates the Vite production bundle.
*   **Linting**: Always run `bun run lint` before committing code changes.
*   **Testing**:
    *   Unit tests: `bun test` (in `tests/unit/`).
    *   E2E tests: Requires a full build first: `bun run build` then execute Playwright specs in `tests/e2e/`.

## 🏗️ Architecture Notes
*   **Core IPC**: All system-level communication (network, file system) must be handled by IPC handlers in `electron/` and exposed via `preload.ts`.
*   **Storage**: All persistent user data (`history.json`, `environments.json`, `settings.json`, collections) is stored in the Electron `userData` directory.
*   **gRPC Reflection**: Service discovery uses `grpc.reflection.v1alpha.ServerReflection` and decodes `FileDescriptorProto`. The reflection proto is temporarily written to `os.tmpdir()` during the call.

## 🗑️ To Ignore / General Knowledge
*   Do not treat the detailed Tech Stack, IPC API Reference, or Component lists as instructions; they are for reference only.
*   The core React/TS/CSS structure is standard; focus only on the Electron/Node.js specific constraints.
|------|-----------|---------|-------|
| Desktop Runtime | Electron | 41.x | Multi-process: main (Node.js) + renderer (Chromium) |
| Frontend Framework | React | 19.x | Functional components, hooks only |
| Language | TypeScript | 5.9.x | Strict mode enabled, separate tsconfigs for app and node |
| Build Tool | Bun + Vite | 7.x | Dev server with HMR for both React and Electron |
| Electron ↔ Vite | vite-plugin-electron + vite-plugin-electron-renderer | 0.29.x / 0.14.6 | Handles main/preload compilation |
| Styling | Vanilla CSS | — | No utility frameworks. Custom dark theme with glassmorphism. |
| Animations | Framer Motion | 12.x | Micro-animations, layout transitions, reordering |
| Icons | Lucide React | 0.577.x | Tree-shakable SVG icon library |
| Editor | CodeMirror | 6.x | Used for request/response JSON and script editing |
| HTTP Client | Node.js native `http`/`https` | — | Used in main process to bypass CORS and handle SSL bypass |
| REST Client Fallback | Fetch API | — | Used in renderer when Electron IPC unavailable (dev mode in browser) |
| gRPC | @grpc/grpc-js | 1.14.x | Pure JavaScript gRPC implementation |
| Proto Loading | @grpc/proto-loader | 0.8.x | Loads `.proto` files to gRPC package definitions |
| Proto Parsing | protobufjs | 7.x | Used for reflection decoding and gRPC status details parsing |
| Packaging | electron-builder | 26.x | NSIS (Win), DMG (Mac), AppImage (Linux) |
| Linting | ESLint + typescript-eslint | 9.x | React hooks and refresh plugins |
| Module System | ESM | — | `"type": "module"` in package.json. `createRequire` for CJS interop in main. |

---

## Architecture Overview

### Process Model

UltraRPC uses the standard Electron two-process architecture:

1. **Main Process** (`electron/`) — Runs in Node.js. Handles:
   - Window lifecycle management
   - HTTP/HTTPS requests (bypasses CORS, handles SSL validation toggles)
   - gRPC connections, reflection, unary/streaming calls, and rich error decoding
   - Filesystem persistence for collections, history, and environments
   
2. **Renderer Process** (`src/`) — Runs in Chromium. Handles:
   - React UI rendering
   - User interaction and state management (Tabs, Environments, Collections)
   - Request composition and response display

3. **Preload Script** (`electron/preload.ts`) — Bridge between main and renderer:
   - Uses `contextBridge.exposeInMainWorld` to expose `window.ultraRpc` API
   - All IPC is request-response via `ipcRenderer.invoke`
   - Context isolation is ON, node integration is OFF

### Directory Structure

```
electron/                  # Main process code (Node.js runtime)
  main.ts                  # Entry: creates BrowserWindow, registers IPC handlers
  preload.ts               # Context bridge: exposes window.ultraRpc to renderer
  rest-handler.ts           # IPC handler for REST HTTP/HTTPS requests (Native Node http/https)
  grpc-handler.ts           # IPC: gRPC reflection, method discovery, unary/server-stream calls, rich error decoding
  storage-handler.ts        # IPC: collections, history, environments, settings (filesystem)
  flow-handler.ts           # IPC handler for Flow execution lifecycle
  engine/flow-engine.ts     # Multi-step Flow execution engine (variable passing, sequence)
  vault-handler.ts          # Encrypted secrets vault (Native OS keychain via safeStorage)
  mcp-server.ts             # Model Context Protocol (MCP) server for AI integration
  bruno-importer.ts         # Handles importing Bruno API collections
  format-handler.ts         # Code formatting via Prettier (IPC: `code:format`)

src/                       # Renderer process code (React/Chromium)
  main.tsx                 # React DOM mount point
  App.tsx                  # Root: tab management, request lifecycle, variable interpolation
  index.css                # Global design system: CSS variables, dark theme, glassmorphism
  App.css                  # Minimal app-level CSS overrides
  
  components/              # UI components (.tsx + .css pair)
    AboutModal.tsx          # Application info and versioning
    CollectionPanel.tsx     # Sidebar: collections, folders, drag-and-drop reordering
    EnvironmentPanel.tsx    # Sidebar: environments, variables, SSL verification toggle
    GrpcReflectionPanel.tsx # gRPC: service/method discovery via reflection
    HistoryPanel.tsx        # Sidebar: request history timeline (persists 100 entries)
    KeyValueEditor.tsx      # Reusable: key-value pair editor
    InterpolatedInput.tsx   # Specialized input with variable interpolation & autocomplete
    Editor.tsx              # CodeMirror wrapper for JSON/Code editing with gRPC schema tooltips
    LibraryModal.tsx        # Code Library: manage reusable JS script snippets
    ResponseViewer.tsx      # Response display: formatted JSON, trailers, metrics
    Toaster.tsx             # Notification system (toasts)
  
  hooks/
    useTreeOpenState.ts     # Persists collection tree expansion state to settings
    useScriptValidation.ts  # Validates pre/post scripts before saving

  types/
    index.ts               # Domain types: RequestConfig, ResponseData, Collection, etc.
    flow.ts                # Flow and FlowStep types
    electron.d.ts           # TypeScript declarations for the window.ultraRpc API
  
  lib/
    helpers.ts              # Utilities: empty object generators, uid generators
    json-utils.ts           # JSON formatting utilities
    proto-helpers.ts        # Protobuf field helpers for gRPC schema tooltips
```

### Component Reference

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

---

## Key Patterns & Conventions

### Variable Interpolation
UltraRPC supports dynamic variables using `{{variable_name}}` syntax:
- **Environment Variables**: Defined in the active environment.
- **Collection Variables**: Defined in the collection metadata.
- **Resolution Order**: Collection variables take precedence over Environment variables.

### Component Pattern
- Functional React components with hooks.
- Colocated CSS files (e.g., `Component.tsx` + `Component.css`).
- **No CSS-in-JS**, no utility frameworks (no Tailwind).

### State Management
- **React `useState` + `useCallback`** — no external state libraries.
- All primary app state lives in `App.tsx`.
- Tab state (responses, errors) managed via `Record<tabId, value>`.

### Persistence
- Data is stored in `userData` as JSON files: `history.json`, `environments.json`, `settings.json`.
- Collections are stored as directory trees with `_meta.json` for metadata (ID, variables, request order).
- Tree expansion state is persisted via `tree:setOpenState` / `tree:getOpenState`.

### Strict File System Mapping
UltraRPC maintains a **strict one-to-one mapping** between the UI sidebar and the local filesystem:
- **Collections/Folders**: Represented by physical directories.
- **Requests/Flows**: Represented by `.json` files.
- **Renaming**: Renaming in the UI physically renames the file/folder on disk.
- **Deletion**: Deleting in the UI physically removes the file/folder (with backups for internal collections).
- **Sanitization**: Names are sanitized using `text.replace(/[<>:"/\\|?*]/g, '_').trim()`. This is enforced in `electron/storage-handler.ts`.

### Scripting & Variables
- **Variable Resolution Order**: `Vault` → `Collection` → `Environment`.
- **Script Engine**: Pre-request and post-response scripts run via `new Function()`.
- **API Object**: Scripts receive an `ultra` object with `env`, `context`, `globals`, and `network` APIs.
- **Async Requests**: `ultra.sendRequest` allows chaining multiple APIs.

### Automation: Flows
- **Visual Orchestration**: Users build multi-step flows on a `FlowCanvas`.
- **Data Passing**: Output of one step is passed to another via JSONPath extraction.
- **Execution Engine**: `flow-engine.ts` runs flows sequentially in the main process for stability.

### Security: Vault
- **Encrypted Storage**: Uses Electron `safeStorage` (OS keychain) for sensitive keys.
- **Reference Syntax**: Vault entries are accessed via `{{secret:key}}`.

### AI Integration: MCP
- **MCP Server**: Built-in HTTP server (Express + SSE) exposing collections as tools to AI agents.
- **Default Port**: Port 3000 (configurable, persisted in settings).
- **Tooling**: Supports `list_collections`, `add_rest_request`, `add_flow`, etc.

### Development Conventions
- **Package Manager**: Strictly use `bun` for managing dependencies and running scripts.
- **IPC Architecture**: UI features requiring system resources (network, filesystem) must be IPC handlers in `electron/` and exposed via `preload.ts`.
- **Native Node Modules**: `@grpc/grpc-js` and `protobufjs` are kept external in the Vite build (`vite.config.ts`) to allow native Node.js loading.

---

## IPC API Reference

### REST
| Method | Arguments | Returns |
|--------|-----------|---------|
| `sendRestRequest` | `{ method, url, headers, body?, insecure? }` | `{ success, data?: ResponseData, error? }` |

### gRPC
| Method | Arguments | Returns |
|--------|-----------|---------|
| `grpcReflect` | `{ host, insecure, headers }` | `{ success, services?: string[], error? }` |
| `grpcMethods` | `{ host, insecure, headers, serviceName }` | `{ success, methods?: MethodInfo[], error? }` |
| `grpcCall` | `{ host, insecure, headers, service, method, payload, protoPath?, timeoutMs? }` | `{ success, data?: ResponseData, error? }` |

### Storage — Collections
| Method | Arguments | Returns |
|--------|-----------|---------|
| `listCollections` | _(none)_ | `{ success, collections?: Collection[] }` |
| `createCollection` | `{ name, path? }` | `{ success, id? }` |
| `saveRequest` | `{ collectionId, request }` | `{ success }` |
| `deleteRequest` | `{ collectionId, requestId }` | `{ success }` |
| `deleteFolder` | `{ collectionId, folderPath }` | `{ success }` |
| `renameCollection` | `{ collectionId, newName }` | `{ success, newId? }` |
| `cloneCollection` | `{ collectionId }` | `{ success, id? }` |
| `cloneRequest` | `{ collectionId, requestId }` | `{ success, id? }` |
| `moveItem` | `{ collectionId, itemId, targetCollectionId?, targetParentId, newIndex }` | `{ success }` |
| `openFolder` | _(dialog)_ | `{ success, id?, path? }` |
| `linkCollection` | _(dialog)_ | `{ success, path? }` |

---

## gRPC Implementation Details

### Server Reflection & Discovery
1. Discovers services via `grpc.reflection.v1alpha.ServerReflection`.
2. Decodes `FileDescriptorProto` to extract method signatures and message types.
---

## Data Storage

All data is persisted to the Electron `userData` directory:
- **Windows**: `%APPDATA%/ultrarpc/`
- **macOS**: `~/Library/Application Support/ultrarpc/`
- **Linux**: `~/.config/ultrarpc/`
---

## Build & Bundling Details

### Vite Configuration
- **Path alias**: `@` maps to `src/` directory
- **External packages**: `@grpc/grpc-js`, `@grpc/proto-loader`, `protobufjs` are kept external in the main process bundle (Rollup). They must run in Node.js where `require()` works — bundling into ESM breaks dynamic `require()` calls.
- **Main process CJS interop**: `globalThis.require = createRequire(import.meta.url)` in `main.ts` enables `require()` for externalized CJS packages.


### Packaging
- **electron-builder** handles cross-platform packaging
- App ID: `com.ultrarpc.app`
- Output targets: NSIS (Windows), DMG (macOS), AppImage (Linux)
- Build output: `release/` directory

---

## Development Commands

```bash
bun install          # Install all dependencies
bun run dev          # Start Electron + Vite dev server with HMR
bun run build        # TypeScript compile + Vite production build
bun run package:win  # Build + package Windows installer (NSIS)
bun run package:mac  # Build + package macOS DMG
bun run package:linux # Build + package Linux AppImage
bun run lint         # Run ESLint
bun run preview      # Preview production build
```

---

---

## Known Constraints & Gotchas

- **Bidi-streaming is not yet fully supported** — only unary and server-streaming are implemented.
- **SSL Verification toggle** is available at the Environment level but affects all requests using that environment. Note: Automated E2E testing for SSL Verification is performed against `grpcb.in`.
- **Proto file path** is supported in the call handler but there is no UI for selecting/uploading proto files yet (uses Reflection by default).
- **The reflection proto** is written to `os.tmpdir()` on each call — this is intentional to avoid shipping a proto file.
- **Module format**: ESM (`"type": "module"`), but `grpc-js` and `protobufjs` interop is handled via `createRequire`.
- **Testing**:
    - **E2E**: 37 Playwright specs in `tests/e2e/`. Use mock servers in `tests/mocks/`. Requires `bun run build` before running.
    - **Unit**: Managed in `tests/unit/`, run via `bun test`.
- **`window.ultraRpc`**: The IPC bridge name (not `window.electronAPI`).
