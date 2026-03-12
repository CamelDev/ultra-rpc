<p align="center">
  <img src="public/icon.png" alt="UltraRPC Logo" width="100" />
</p>

<h1 align="center">⚡ UltraRPC</h1>

<p align="center">
  <em>A premium desktop API client for <strong>REST</strong> and <strong>gRPC</strong> — built with Electron, React, and TypeScript.</em>
</p>


---

## 🎯 Overview

UltraRPC is a cross-platform desktop application designed for developers who need a single tool to test and debug both REST APIs and gRPC services. Unlike cloud-based alternatives, UltraRPC stores everything locally in human-readable files — no accounts, no subscriptions, no data leaving your machine.

### Why UltraRPC?

| Challenge | UltraRPC Solution |
|-----------|-------------------|
| Need separate tools for REST and gRPC | Unified interface with one-click REST/gRPC toggle |
| gRPC proto files are tedious to manage | **Server Reflection** auto-discovers services and methods |
| API collections locked in proprietary clouds | File-per-request storage — commit to git, share as folders |
| CORS blocks browser-based API clients | Electron's Node.js backend bypasses CORS entirely |
| No auto-generated request payloads | Reflection parses proto descriptors to generate sample JSON bodies |

---

## ✨ Features

### 🌐 REST Client
- Full HTTP method support — **GET**, **POST**, **PUT**, **DELETE**, **PATCH**
- Key-value editors for **query parameters** and **headers** with enable/disable toggles
- JSON and plain text body editor with syntax highlighting
- Formatted JSON response viewer
- Status codes, response time, and size metrics
- One-click copy response to clipboard

### ⚡ gRPC Client
- Native gRPC support via `@grpc/grpc-js` — no CLI tools or Docker needed
- **Server Reflection** — auto-discover services and methods without proto files (same as `grpcui`)
- **Auto-generated sample request bodies** — reflection parses protobuf descriptors and generates scaffold JSON payloads for each method
- **Custom metadata/auth headers** — e.g. `Authorization: Basic <token>`
- Proto file loading as fallback when reflection is unavailable
- Unary call support (streaming planned)
- Method type indicators (unary, client stream, server stream, bidi)

### 📁 Collections (Bruno-style)
- **File-based storage** — each collection is a folder, each request is a `.json` file
- Commit collections to git alongside your source code
- Create, rename, delete collections through the UI
- **Import** collections from `.json` files (supports multiple formats)
- **Export** collections as `.ultrarpc.json` archive
- **Open any folder** from disk as a collection — point to your repo

### 🔧 Environments & Variables
- Create multiple environments (Development, Staging, Production, etc.)
- Define variables like `BASE_URL`, `AUTH_TOKEN`, `API_KEY`
- Reference variables in URLs, headers, and body using `{{VARIABLE}}` syntax
- Switch active environment with one click
- Auto-persisted to disk

### 📜 Request History
- Automatic request history with timestamps and status codes
- Click to re-open any past request in a new tab
- Capped at 100 entries, auto-rotated
- Persisted between sessions

### 🎨 Premium UI
- Custom dark theme with glassmorphism effects
- Smooth micro-animations via Framer Motion
- Inter + JetBrains Mono typography
- Multi-tab interface with tab management
- REST/gRPC toggle per request
- Windows custom title bar integration

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org/) | v18 or higher |
| npm | v9 or higher (ships with Node.js) |

### Install & Run

```bash
# Clone the repository
git clone <your-repo-url>
cd UltraRPC

# Install dependencies
npm install

# Start in development mode (Electron + Vite HMR)
npm run dev
```

The Electron app will launch automatically with hot module replacement enabled.

### Build for Distribution

```bash
# Windows (NSIS installer)
npm run package:win

# macOS (DMG)
npm run package:mac

# Linux (AppImage)
npm run package:linux
```

Built artifacts will appear in the `release/` directory.

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Electron + Vite HMR |
| `npm run build` | TypeScript compile + Vite production build |
| `npm run package:win` | Build + package for Windows (NSIS) |
| `npm run package:mac` | Build + package for macOS (DMG) |
| `npm run package:linux` | Build + package for Linux (AppImage) |
| `npm run lint` | Run ESLint across the project |
| `npm run preview` | Preview the production build locally |

---

## 🧪 Testing

### REST — Public APIs

Try these free public APIs to verify the REST client:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `https://jsonplaceholder.typicode.com/posts` | GET | List of 100 posts |
| `https://httpbin.org/post` | POST | Echoes your request body |
| `https://api.github.com/users/octocat` | GET | GitHub user profile |
| `https://catfact.ninja/fact` | GET | Random cat fact |
| `https://jsonplaceholder.typicode.com/posts` | POST | Create a new post |

### gRPC — Public Test Servers

Use **grpcb.in** — a free public gRPC test server:

| Endpoint | TLS | Notes |
|----------|-----|-------|
| `grpcb.in:9000` | No (insecure) | Supports server reflection |
| `grpcb.in:9001` | Yes | TLS-enabled endpoint |

**Walkthrough:**
1. Switch to **gRPC** mode using the REST/gRPC toggle
2. Enter `grpcb.in:9000` as the host
3. Click **Discover Services** in the reflection panel
4. Click on a service to expand its methods
5. Click **Use →** on a method — it auto-fills the service, method, and a sample request body
6. Click **Send** to execute the call

---

## 📂 Project Structure

```
UltraRPC/
├── electron/                        # Electron main process (Node.js)
│   ├── main.ts                      # App entry: window creation, IPC registration
│   ├── preload.ts                   # Context bridge: exposes safe IPC API to renderer
│   ├── rest-handler.ts              # HTTP/HTTPS request handler (Node native)
│   ├── grpc-handler.ts              # gRPC reflection + unary calls
│   └── storage-handler.ts           # Filesystem: collections, history, environments
│
├── src/                             # React renderer process
│   ├── App.tsx                      # Root component: tabs, request lifecycle, routing
│   ├── main.tsx                     # React DOM entry point
│   ├── index.css                    # Global CSS: design system, dark theme, glassmorphism
│   ├── App.css                      # App-specific minimal overrides
│   │
│   ├── components/
│   │   ├── CollectionPanel.tsx      # Collections sidebar (create, import, export, open)
│   │   ├── CollectionPanel.css
│   │   ├── EnvironmentPanel.tsx     # Environment variable management
│   │   ├── EnvironmentPanel.css
│   │   ├── GrpcReflectionPanel.tsx  # gRPC server reflection UI (discover → methods → use)
│   │   ├── GrpcReflectionPanel.css
│   │   ├── HistoryPanel.tsx         # Request history sidebar
│   │   ├── HistoryPanel.css
│   │   ├── KeyValueEditor.tsx       # Reusable key-value pair editor (params, headers)
│   │   ├── KeyValueEditor.css
│   │   ├── ResponseViewer.tsx       # Response display: status, body, headers, metrics
│   │   └── ResponseViewer.css
│   │
│   ├── types/
│   │   ├── index.ts                 # Domain types: RequestConfig, ResponseData, Collection, etc.
│   │   └── electron.d.ts            # TypeScript declarations for window.ultraRpc IPC API
│   │
│   └── lib/
│       └── helpers.ts               # Utility functions: createEmptyRequest, emptyKV, uid
│
├── public/
│   └── icon.png                     # Application icon
│
├── index.html                       # HTML entry point
├── package.json                     # Dependencies, scripts, electron-builder config
├── vite.config.ts                   # Vite config: React plugin, Electron integration
├── tsconfig.json                    # TypeScript project references
├── tsconfig.app.json                # TS config for renderer (React/DOM)
├── tsconfig.node.json               # TS config for main process (Node.js)
└── eslint.config.js                 # ESLint configuration
```

---

## 🏛 Architecture

UltraRPC follows the standard **Electron multi-process architecture** with a clear separation between the main process (Node.js) and the renderer process (React/Chromium).

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                   (Node.js runtime)                      │
│                                                         │
│  ┌──────────────────┐  ┌───────────────────────────┐    │
│  │  rest-handler.ts  │  │   grpc-handler.ts         │    │
│  │  ─────────────── │  │   ────────────────         │    │
│  │  HTTP/HTTPS via   │  │  @grpc/grpc-js             │    │
│  │  Node native API  │  │  Server Reflection v1α     │    │
│  └────────┬─────────┘  │  Proto file fallback        │    │
│           │            │  Protobuf descriptor parse   │    │
│           │            └─────────────┬───────────────┘    │
│  ┌────────┴──────────────────────────┴──────────────┐    │
│  │             storage-handler.ts                    │    │
│  │  ───────────────────────────────────────          │    │
│  │  File-based collections (folder-per-collection)   │    │
│  │  JSON history, JSON environments                  │    │
│  │  Import / Export / Open-folder                    │    │
│  └────────────────────┬─────────────────────────────┘    │
│                       │                                   │
│  ┌────────────────────┴───────────────────────────┐      │
│  │             preload.ts (Context Bridge)         │      │
│  │  ──────────────────────────────────────────     │      │
│  │  Exposes IPC methods to renderer as             │      │
│  │  window.ultraRpc.*                              │      │
│  └────────────────────┬───────────────────────────┘      │
└───────────────────────┼──────────────────────────────────┘
                        │  IPC (contextBridge)
┌───────────────────────┼──────────────────────────────────┐
│                       ▼                                   │
│              Renderer Process (Chromium)                   │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │                    App.tsx                          │   │
│  │  ──────────────────────────────────────────────    │   │
│  │  Tab management, request lifecycle,                │   │
│  │  env interpolation, history recording              │   │
│  │                                                    │   │
│  │  ┌────────────────┐  ┌────────────────────────┐   │   │
│  │  │ CollectionPanel│  │ GrpcReflectionPanel     │   │   │
│  │  │ HistoryPanel   │  │   - Discover services   │   │   │
│  │  │ EnvironmentPanel│ │   - Load methods        │   │   │
│  │  └────────────────┘  │   - Auto-fill payload   │   │   │
│  │                      └────────────────────────┘   │   │
│  │  ┌────────────────┐  ┌────────────────────────┐   │   │
│  │  │ KeyValueEditor │  │ ResponseViewer          │   │   │
│  │  │ (params/headers│  │   - JSON formatting     │   │   │
│  │  │  editor)       │  │   - Status/time/size    │   │   │
│  │  └────────────────┘  └────────────────────────┘   │   │
│  └────────────────────────────────────────────────────┘   │
│                                                           │
│  Styling: Vanilla CSS (dark theme, glassmorphism)         │
│  Animations: Framer Motion                                │
│  Icons: Lucide React                                      │
└───────────────────────────────────────────────────────────┘
```

### IPC Communication

All communication between the renderer and main process uses Electron's `ipcRenderer.invoke()` / `ipcMain.handle()` pattern. The preload script creates a **context bridge** that exposes a typed `window.ultraRpc` API with the following channels:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `rest:send` | Renderer → Main | Execute HTTP/HTTPS request |
| `grpc:reflect` | Renderer → Main | List gRPC services via reflection |
| `grpc:methods` | Renderer → Main | Get methods for a service (with sample bodies) |
| `grpc:call` | Renderer → Main | Execute unary gRPC call |
| `storage:listCollections` | Renderer → Main | List all saved collections |
| `storage:createCollection` | Renderer → Main | Create a new collection folder |
| `storage:saveRequest` | Renderer → Main | Save a request to a collection |
| `storage:deleteRequest` | Renderer → Main | Delete a request file |
| `storage:deleteCollection` | Renderer → Main | Delete an entire collection folder |
| `storage:renameCollection` | Renderer → Main | Rename a collection |
| `storage:exportCollection` | Renderer → Main | Export collection as `.ultrarpc.json` |
| `storage:importCollection` | Renderer → Main | Import from JSON file |
| `storage:openFolder` | Renderer → Main | Open any folder as a collection |
| `storage:getHistory` | Renderer → Main | Load request history |
| `storage:addHistory` | Renderer → Main | Add entry to history |
| `storage:clearHistory` | Renderer → Main | Clear all history |
| `storage:getEnvironments` | Renderer → Main | Load saved environments |
| `storage:saveEnvironments` | Renderer → Main | Persist environments to disk |

### gRPC Reflection Flow

```
User enters host:port
        │
        ▼
  grpc:reflect ──► ServerReflectionInfo (list_services)
        │
        ▼
  Services displayed in UI
        │
  User clicks a service
        │
        ▼
  grpc:methods ──► ServerReflectionInfo (file_containing_symbol)
        │          ├── Receives FileDescriptorProto buffers
        │          ├── Parses proto descriptors via protobufjs
        │          ├── Extracts method signatures
        │          └── Generates sample JSON body from field types
        ▼
  Methods displayed with "Use →" button
        │
  User clicks "Use →"
        │
        ▼
  Auto-fills: service name, method name, sample payload
        │
  User clicks "Send"
        │
        ▼
  grpc:call ──► Creates generic gRPC client
               ├── Fetches file descriptor for the service
               ├── Parses to build protobufjs Root
               ├── Encodes request, makes unary call
               └── Decodes + returns JSON response
```

---

## 🔑 Data Storage

All data is stored locally on disk — no cloud, no accounts:

| Data | Location (Windows) | Location (macOS) |
|------|---------------------|-------------------|
| Collections | `%APPDATA%/ultrarpc/collections/` | `~/Library/Application Support/ultrarpc/collections/` |
| History | `%APPDATA%/ultrarpc/history.json` | `~/Library/Application Support/ultrarpc/history.json` |
| Environments | `%APPDATA%/ultrarpc/environments.json` | `~/Library/Application Support/ultrarpc/environments.json` |

### Collection File Format

```
collections/
├── my-api/
│   ├── _meta.json              # { "id": "my-api", "name": "My API" }
│   ├── abc123def.json          # Individual request file
│   └── xyz789ghi.json          # Another request
├── payment-service/
│   ├── _meta.json
│   └── ...
```

Each request file is a self-contained JSON document:

```json
{
  "id": "abc123def",
  "name": "Get User",
  "type": "REST",
  "method": "GET",
  "url": "https://api.example.com/users/1",
  "params": [{ "id": "p1", "key": "include", "value": "profile", "enabled": true }],
  "headers": [{ "id": "h1", "key": "Authorization", "value": "Bearer {{TOKEN}}", "enabled": true }],
  "body": "",
  "bodyType": "json"
}
```

This design means you can:
- **Copy** collection folders into your project repository
- **Version control** your API definitions with git
- **Share** collections by sharing folders
- **Edit** request files manually if needed

---

## 🛠 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop Framework | [Electron](https://www.electronjs.org/) | 41.x |
| Frontend | [React](https://react.dev/) + TypeScript | 19.x |
| Build Tool | [Vite](https://vite.dev/) | 7.x |
| Electron ↔ Vite | [vite-plugin-electron](https://github.com/nicepkg/vite-plugin-electron) | 0.29.x |
| Styling | Vanilla CSS (dark theme, glassmorphism) | — |
| Animations | [Framer Motion](https://motion.dev/) | 12.x |
| Icons | [Lucide React](https://lucide.dev/) | 0.577.x |
| HTTP Client | Node.js native `http`/`https` (no CORS) | — |
| gRPC | [@grpc/grpc-js](https://www.npmjs.com/package/@grpc/grpc-js) + [@grpc/proto-loader](https://www.npmjs.com/package/@grpc/proto-loader) | 1.14.x / 0.8.x |
| Proto Parsing | [protobufjs](https://www.npmjs.com/package/protobufjs) (runtime dependency of grpc-js) | — |
| Packaging | [electron-builder](https://www.electron.build/) | 26.x |
| Linting | [ESLint](https://eslint.org/) + TypeScript ESLint | 9.x |
| Language | [TypeScript](https://www.typescriptlang.org/) | 5.9.x |
| REST Client (browser fallback) | Fetch API | — |

---

## 🔒 Security Model

- **Context Isolation** is enabled — the renderer cannot access Node.js APIs directly
- **Node Integration** is disabled — no `require()` in the renderer
- All IPC is channeled through the **preload context bridge** (`window.ultraRpc`)
- Sandbox mode is disabled to allow preload scripts to use Node.js modules for IPC
- No telemetry, no analytics, no external data collection

---

## 🗺 Roadmap

- [ ] gRPC streaming support (server, client, bidirectional)
- [ ] TLS/SSL configuration panel for gRPC
- [ ] Proto file upload UI (currently code-level only)
- [ ] WebSocket support
- [ ] GraphQL support
- [ ] Request scripting (pre-request & post-response)
- [ ] Response diffing
- [ ] Code generation (cURL, Python, Go, etc.)
- [ ] Collaborative workspaces
- [ ] Plugin system

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Tips

- **Hot reload**: The Vite dev server supports HMR for React components. Electron main process changes require a restart.
- **gRPC debugging**: Use `grpcb.in:9000` for testing reflection. The inline reflection proto is written to a temp file at runtime.
- **File structure**: Follow the existing component pattern — each component gets a `.tsx` + `.css` pair in `src/components/`.
- **IPC pattern**: Add new IPC channels in three places: `electron/*.ts` handler → `electron/preload.ts` bridge → `src/types/electron.d.ts` type declaration.

---

## 📄 License

MIT
