# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with UltraRPC.

## About
UltraRPC is a lightweight, cross-platform desktop API client for REST and gRPC, built with Electron + React. All data is stored locally in human-readable files — no accounts or cloud sync.

Current version: **1.1.0**

## Technical Context
> [!IMPORTANT]
> For detailed technical architecture, IPC API references, directory structure, and development conventions, refer to **[AGENTS.md](file:///Users/kamildabrowski/projects/ultra-rpc/AGENTS.md)**.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server with hot reload + Electron
bun run build        # Full production build (clean + tsc + vite)
bun run lint         # ESLint
npx tsc --noEmit     # TypeScript type checking

# Testing
bun run test:unit                                     # Run unit tests (bun test)
bun run test:e2e                                      # Build then run all 37 E2E tests (Playwright)
npx playwright test tests/e2e/rest-flow.spec.ts       # Run a single E2E test file
npx playwright test --ui                              # Interactive Playwright UI

# Packaging
bun run package:mac
bun run package:win
bun run package:linux
```

## User Documentation
See [README.md](file:///Users/kamildabrowski/projects/ultra-rpc/README.md) for the end-user guide and screenshots.
