# UltraRPC - Project Context

## Project Overview
UltraRPC is a cross-platform, lightweight desktop API client designed for testing and debugging both REST and gRPC services. It acts as a local-first alternative to cloud-based API clients, storing all collections and requests locally in human-readable `.json` files.

The application is built using **Electron**, **React**, and **TypeScript**, packaged with **Vite**.

### Key Features
- **Unified Interface**: Supports both REST and gRPC in a single tool.
- **gRPC Server Reflection**: Automatically discovers services and methods without needing to manage `.proto` files manually.
- **Local File-Based Storage**: No cloud accounts required; data is stored as local files that can be committed to version control.
- **Scripting & Automation**: Supports pre-request and post-response scripts using a custom `ultra` JavaScript API.
- **Environments & Vault**: Supports environment variables and an encrypted secrets vault for sensitive keys.

## Architecture & Technologies
- **Frontend (Renderer Process)**: React 19, TypeScript, Vite. Located in the `src/` directory. Uses libraries like `framer-motion` for animations and `@codemirror` for syntax-highlighted text editors.
- **Backend (Main Process)**: Electron (Node.js), TypeScript. Located in the `electron/` directory. Handles OS-level operations, secure storage, file system access, and native gRPC calls via `@grpc/grpc-js` and `protobufjs`.
- **Communication**: Uses Electron's IPC (Inter-Process Communication) to bridge the React frontend with Node.js backend handlers (`rest-handler.ts`, `grpc-handler.ts`, `storage-handler.ts`, `vault-handler.ts`).
- **Testing**: End-to-End (E2E) testing powered by Playwright (`tests/e2e/`).

## Building and Running

The project uses `bun` as the primary package manager. Ensure you have Node.js v18+ and Bun v1.x+ installed.

### Commands
- **Install dependencies**: `bun install`
- **Start Development Server (HMR enabled)**: `bun run dev`
- **Type Checking (No emit)**: `npx tsc --noEmit`
- **Linting**: `bun run lint`
- **Build**: `bun run build`
- **Run E2E Tests (Headless)**: `bun run test:e2e` (Note: Requires a build first)
- **Run E2E Tests (UI Mode)**: `npx playwright test --ui`

### Packaging
- **macOS**: `bun run package:mac`
- **Windows**: `bun run package:win`
- **Linux**: `bun run package:linux`

## Development Conventions
- **Package Manager**: Strictly use `bun` for managing dependencies and running scripts.
- **IPC Architecture**: UI features requiring system resources (network requests, file system, secure storage) should be implemented as IPC handlers in the `electron/` folder and exposed to the frontend via `electron/preload.ts`.
- **Native Node Modules**: Packages like `@grpc/grpc-js` and `protobufjs` are kept external in the Vite build configuration (`vite.config.ts`) so they can be loaded natively via Node.js CJS `require()`.
- **Testing**: All critical user flows should be tested using Playwright. E2E tests target the built application.