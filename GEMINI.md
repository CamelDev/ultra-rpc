# UltraRPC - Gemini Context

This file provides project context for the Gemini assistant.

## Project Overview
UltraRPC is a cross-platform, lightweight desktop API client designed for testing and debugging both REST and gRPC services. It acts as a local-first alternative to cloud-based API clients, storing all collections and requests locally in human-readable `.json` files.

## Technical Context
> [!IMPORTANT]
> For detailed technical architecture, IPC API references, directory structure, and development conventions, refer to **[AGENTS.md](file:///Users/kamildabrowski/projects/ultra-rpc/AGENTS.md)**.

## Commands

### Development
- **Install dependencies**: `bun install`
- **Start Development Server**: `bun run dev`
- **Type Checking**: `npx tsc --noEmit`
- **Linting**: `bun run lint`
- **Build**: `bun run build`

### Testing
- **E2E Tests**: `bun run test:e2e` (Requires build)
- **Unit Tests**: `bun test`

### Packaging
- **macOS**: `bun run package:mac`
- **Windows**: `bun run package:win`
- **Linux**: `bun run package:linux`

## Documentation
See [README.md](file:///Users/kamildabrowski/projects/ultra-rpc/README.md) for user-facing features and screenshots.