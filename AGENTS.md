# UltraRPC — Agent Context

> This file provides AI coding assistants with the essential context needed to understand, modify, and extend UltraRPC.

---

## Project Identity

- **Name**: UltraRPC
- **Type**: Desktop application (Electron)
- **Purpose**: Robust API client for REST and gRPC testing — like Postman with native gRPC reflection support and file-based collections
- **Version**: 1.0.0
- **License**: MIT

---

## Tech Stack

| Role | Technology | Version | Notes |
|------|-----------|---------|-------|
| Desktop Runtime | Electron | 41.x | Multi-process: main (Node.js) + renderer (Chromium) |
| Frontend Framework | React | 19.x | Functional components, hooks only |
| Language | TypeScript | 5.9.x | Strict mode enabled, separate tsconfigs for app and node |
| Build Tool | Vite | 7.x | Dev server with HMR for both React and Electron |
| Electron ↔ Vite | vite-plugin-electron + vite-plugin-electron-renderer | 0.29.x / 0.14.x | Handles main/preload compilation |
| Styling | Vanilla CSS | — | No utility frameworks. Custom dark theme with glassmorphism. Component-scoped CSS files. |
| Animations | Framer Motion | 12.x | Micro-animations, layout transitions |
| Icons | Lucide React | 0.577.x | Tree-shakable SVG icon library |
| HTTP Client | Node.js native `http`/`https` | — | Used in main process to bypass CORS |
| REST Client Fallback | Fetch API | — | Used in renderer when Electron IPC unavailable (dev mode in browser) |
| gRPC | @grpc/grpc-js | 1.14.x | Pure JavaScript gRPC implementation, no native addons |
| Proto Loading | @grpc/proto-loader | 0.8.x | Loads `.proto` files to gRPC package definitions |
| Proto Parsing | protobufjs | transitive | Used for decoding FileDescriptorProto from reflection responses |
| Packaging | electron-builder | 26.x | NSIS (Win), DMG (Mac), AppImage (Linux) |
| Linting | ESLint + typescript-eslint | 9.x | React hooks and refresh plugins |
| Module System | ESM | — | `"type": "module"` in package.json. `createRequire` for CJS interop in main process. |

---

## Architecture Overview

### Process Model

UltraRPC uses the standard Electron two-process architecture:

1. **Main Process** (`electron/`) — Runs in Node.js. Handles:
   - Window lifecycle management
   - HTTP/HTTPS requests (bypasses CORS)
   - gRPC connections, reflection, and calls
   - Filesystem read/write for collections, history, environments
   
2. **Renderer Process** (`src/`) — Runs in Chromium. Handles:
   - React UI rendering
   - User interaction and state management
   - Request composition and response display

3. **Preload Script** (`electron/preload.ts`) — Bridge between main and renderer:
   - Uses `contextBridge.exposeInMainWorld` to expose `window.ultraRpc` API
   - All IPC is request-response via `ipcRenderer.invoke` / `ipcMain.handle`
   - Context isolation is ON, node integration is OFF

### Directory Structure

```
electron/                  # Main process code (Node.js runtime)
  main.ts                  # Entry: creates BrowserWindow, registers IPC handlers
  preload.ts               # Context bridge: exposes window.ultraRpc to renderer
  rest-handler.ts           # IPC handler for REST HTTP/HTTPS requests
  grpc-handler.ts           # IPC handler for gRPC reflection, method discovery, unary calls
  storage-handler.ts        # IPC handler for collections, history, environments (filesystem)

src/                       # Renderer process code (React/Chromium)
  main.tsx                 # React DOM mount point
  App.tsx                  # Root component: tab management, request lifecycle, env interpolation
  index.css                # Global design system: CSS variables, dark theme, glassmorphism, typography
  App.css                  # Minimal app-level CSS overrides
  
  components/              # UI components (each with .tsx + .css pair)
    CollectionPanel.tsx     # Sidebar: create/import/export/open collections, browse requests
    EnvironmentPanel.tsx    # Sidebar: environment CRUD, variable editing
    GrpcReflectionPanel.tsx # gRPC: service discovery, method listing, auto-fill
    HistoryPanel.tsx        # Sidebar: request history timeline
    KeyValueEditor.tsx      # Reusable: key-value pair editor for params & headers
    ResponseViewer.tsx      # Response display: formatted JSON, status, headers, metrics
  
  types/
    index.ts               # Domain types: RequestConfig, ResponseData, Collection, Environment, etc.
    electron.d.ts           # TypeScript declarations for the window.ultraRpc IPC bridge API
  
  lib/
    helpers.ts              # Utilities: createEmptyRequest, emptyKV, uid generator

public/
  icon.png                 # Application icon

index.html                 # HTML entry point (Vite serves this)
vite.config.ts             # Vite config with electron plugin and path aliases
package.json               # Dependencies, scripts, electron-builder config
```

---

## Key Patterns & Conventions

### Component Pattern
- Each component is a **functional React component** with hooks
- Each component has a **colocated CSS file** (e.g., `CollectionPanel.tsx` + `CollectionPanel.css`)
- Components import their CSS directly: `import './Component.css'`
- **No CSS-in-JS**, no utility frameworks (no Tailwind)

### State Management
- **React `useState` + `useCallback`** — no external state libraries (no Redux, Zustand, etc.)
- All state lives in `App.tsx` and is passed down via props
- Per-tab state for responses, errors, and loading is managed via `Record<tabId, value>` objects

### IPC Pattern
When adding a new IPC channel, modify these three files in order:
1. `electron/{handler}.ts` — Add `ipcMain.handle('channel:name', ...)` handler
2. `electron/preload.ts` — Add `channelName: (args) => ipcRenderer.invoke('channel:name', args)` to the context bridge
3. `src/types/electron.d.ts` — Add the method signature to the `UltraRpcApi` interface

### Naming Conventions
- IPC channels use **colon-separated namespaces**: `rest:send`, `grpc:reflect`, `storage:listCollections`
- Component files use **PascalCase**: `CollectionPanel.tsx`
- CSS files match component names: `CollectionPanel.css`
- TypeScript types use **PascalCase interfaces**: `RequestConfig`, `ResponseData`
- Utility functions use **camelCase**: `createEmptyRequest`, `emptyKV`

### CSS Design System
The global design system is defined in `src/index.css` using CSS custom properties:
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary` — background layers
- `--text-primary`, `--text-secondary`, `--text-muted` — text hierarchy
- `--accent`, `--accent-hover` — brand accent color (purple-ish)
- `--border`, `--border-light` — border colors
- `--glass` — glassmorphism with `backdrop-filter: blur()`
- Dark theme only (no light mode toggle currently)

### Type System
- All domain types are in `src/types/index.ts`
- The IPC bridge API is typed in `src/types/electron.d.ts` which extends the global `Window` interface
- The requests use a **discriminated union** pattern: `type: 'REST' | 'GRPC'` on `RequestConfig`
- gRPC-specific fields (`grpcService`, `grpcMethod`, `grpcPayload`, `grpcReflection`) are optional on `RequestConfig`

---

## IPC API Reference

### REST
| Channel | Arguments | Returns |
|---------|-----------|---------|
| `rest:send` | `{ method, url, headers, body? }` | `{ success, data?: { status, statusText, headers, body, time, size }, error? }` |

### gRPC
| Channel | Arguments | Returns |
|---------|-----------|---------|
| `grpc:reflect` | `{ host, insecure, headers }` | `{ success, services?: string[], error? }` |
| `grpc:methods` | `{ host, insecure, headers, serviceName }` | `{ success, methods?: MethodInfo[], error? }` |
| `grpc:call` | `{ host, insecure, headers, service, method, payload, protoPath? }` | `{ success, data?: ResponseData, error?, code? }` |

### Storage — Collections
| Channel | Arguments | Returns |
|---------|-----------|---------|
| `storage:listCollections` | _(none)_ | `{ success, collections?: Collection[] }` |
| `storage:createCollection` | `{ name }` | `{ success, id? }` |
| `storage:saveRequest` | `{ collectionId, request }` | `{ success }` |
| `storage:deleteRequest` | `{ collectionId, requestId }` | `{ success }` |
| `storage:deleteCollection` | `{ collectionId }` | `{ success }` |
| `storage:renameCollection` | `{ collectionId, newName }` | `{ success }` |
| `storage:exportCollection` | `{ collectionId }` | `{ success, path? }` |
| `storage:importCollection` | _(dialog)_ | `{ success, id?, name?, requestCount? }` |
| `storage:openFolder` | _(dialog)_ | `{ success, id?, name?, requestCount?, path? }` |

### Storage — History & Environments
| Channel | Arguments | Returns |
|---------|-----------|---------|
| `storage:getHistory` | _(none)_ | `{ success, history?: HistoryEntry[] }` |
| `storage:addHistory` | `HistoryEntry` | `{ success }` |
| `storage:clearHistory` | _(none)_ | `{ success }` |
| `storage:getEnvironments` | _(none)_ | `{ success, environments?: Environment[] }` |
| `storage:saveEnvironments` | `Environment[]` | `{ success }` |

---

## Data Storage

All data is persisted to the Electron `userData` directory:
- **Windows**: `%APPDATA%/ultrarpc/`
- **macOS**: `~/Library/Application Support/ultrarpc/`
- **Linux**: `~/.config/ultrarpc/`

### Layout
```
<userData>/
  collections/
    <collection-id>/
      _meta.json           # { id, name, externalPath? }
      <request-id>.json    # Individual request definition
  history.json             # Array of HistoryEntry (max 100)
  environments.json        # Array of Environment
```

---

## Build & Bundling Details

### Vite Configuration
- **Path alias**: `@` maps to `src/` directory
- **External packages**: `@grpc/grpc-js`, `@grpc/proto-loader`, `protobufjs` are kept external in the main process bundle (Rollup). They must run in Node.js where `require()` works — bundling into ESM breaks dynamic `require()` calls.
- **Main process CJS interop**: `globalThis.require = createRequire(import.meta.url)` in `main.ts` enables `require()` for externalized CJS packages.

### Electron Window Configuration
- Min size: 900×600, default: 1280×860
- Custom title bar (Windows): `titleBarStyle: 'hidden'` with `titleBarOverlay`
- Background color: `#09090b` (near-black)
- Context isolation: ON, node integration: OFF, sandbox: OFF

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

## gRPC Reflection Implementation

The gRPC reflection client uses the **gRPC Server Reflection v1alpha** protocol:

1. An inline `.proto` definition for `grpc.reflection.v1alpha.ServerReflection` is written to a temp file and loaded via `@grpc/proto-loader`
2. `list_services` discovers available service names
3. `file_containing_symbol` retrieves `FileDescriptorProto` binary blobs for a given service
4. `protobufjs` decodes the descriptors to extract:
   - Service names and method signatures
   - Input/output message types
   - Field-level schema for **auto-generating sample request JSON bodies**
5. For making calls, a `protobufjs.Root` is built from `FileDescriptorSet` to serialize/deserialize messages with a generic `grpc.Client.makeUnaryRequest()`

---

## Known Constraints & Gotchas

- **gRPC streaming is not yet supported** — only unary calls work. Streaming methods are listed in the UI but will fail if called.
- **TLS for gRPC** currently defaults to `insecure: true`. There is no UI toggle for TLS/SSL configuration.
- **Proto file path** is supported in the call handler but there is no UI for uploading/selecting proto files yet.
- **The reflection proto** is written to `os.tmpdir()` on each call — this is intentional to avoid shipping a proto file.
- **Module format**: The project is ESM (`"type": "module"`), but grpc-js is CJS. The `createRequire` workaround in `main.ts` and Rollup `external` config handle this interop.
- **No tests** — the project currently has no unit or integration test infrastructure.
- **No router** — the app is a single-page application with no client-side routing. Navigation is tab-based.
