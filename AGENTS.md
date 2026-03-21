# UltraRPC — Agent Context

> This file provides AI coding assistants with the essential context needed to understand, modify, and extend UltraRPC.

---

## Project Identity

- **Name**: UltraRPC
- **Type**: Desktop application (Electron)
- **Purpose**: Lightweight API client for REST and gRPC testing — like Postman with native gRPC reflection support and file-based collections
- **Version**: 1.0.10
- **License**: MIT

---

## Tech Stack

| Role | Technology | Version | Notes |
|------|-----------|---------|-------|
| Desktop Runtime | Electron | 41.x | Multi-process: main (Node.js) + renderer (Chromium) |
| Frontend Framework | React | 19.x | Functional components, hooks only |
| Language | TypeScript | 5.9.x | Strict mode enabled, separate tsconfigs for app and node |
| Build Tool | Vite | 7.x | Dev server with HMR for both React and Electron |
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
  rest-handler.ts           # IPC handler for REST HTTP/HTTPS requests
  grpc-handler.ts           # IPC: gRPC reflection, method discovery, unary/server-stream calls
  storage-handler.ts        # IPC: collections, history, environments, settings (filesystem)

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
    Editor.tsx              # CodeMirror wrapper for JSON/Code editing
    ResponseViewer.tsx      # Response display: formatted JSON, trailers, metrics
    Toaster.tsx             # Notification system (toasts)
  
  hooks/
    useTreeOpenState.ts     # Persists collection tree expansion state to settings

  types/
    index.ts               # Domain types: RequestConfig, ResponseData, Collection, etc.
    electron.d.ts           # TypeScript declarations for the window.ultraRpc API
  
  lib/
    helpers.ts              # Utilities: empty object generators, uid generators
```

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
npm install          # Install all dependencies
npm run dev          # Start Electron + Vite dev server with HMR
npm run build        # TypeScript compile + Vite production build
npm run package:win  # Build + package Windows installer (NSIS)
npm run package:mac  # Build + package macOS DMG
npm run package:linux # Build + package Linux AppImage
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

---

---

## Known Constraints & Gotchas

- **Bidi-streaming is not yet fully supported** — only unary and server-streaming are implemented.
- **SSL Verification toggle** is available at the Environment level but affects all requests using that environment. Note: Automated E2E testing for SSL Verification is performed against `grpcb.in`.
- **Proto file path** is supported in the call handler but there is no UI for selecting/uploading proto files yet (uses Reflection by default).
- **The reflection proto** is written to `os.tmpdir()` on each call — this is intentional to avoid shipping a proto file.
- **Module format**: ESM (`"type": "module"`), but `grpc-js` and `protobufjs` interop is handled via `createRequire`.
- **No tests**: The project currently lacks automated unit or integration tests.
