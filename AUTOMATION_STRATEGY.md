# Automation Strategy: UltraRPC Testing

To ensure the reliability of UltraRPC as more features are added, we use a multi-layered testing approach focusing on automated End-to-End (E2E) and Unit tests. This document tracks our progress and outlines mandatory requirements for all future development.

> [!IMPORTANT]
> ### ⚠️ Mandatory Testing Policy
> Starting from version **1.0.10**, all new features and significant bug fixes **must** be accompanied by a corresponding Playwright E2E test. 
> 1. **Zero-Regression**: New code will not be merged without passing the `test:e2e` suite in GitHub Actions.
> 2. **Isolations**: Whenever possible, tests should use local mock servers instead of external APIs to ensure determinism and speed.

---

## 1. End-to-End (E2E) Testing with Playwright
Playwright is our primary tool for testing the Electron application, verifying UI interactions and IPC communications.

### 🛠️ Mock Server Infrastructure (Recommended)
To keep tests fast and reliable, avoid hitting real external APIs. Instead, implement a mock server in `tests/mocks/`:
- **REST**: Use `express` to simulate the exact headers, error codes, and JSON payloads your feature expects.
- **gRPC**: Use `@grpc/grpc-js` with `grpc-node-reflection` to mock service discovery and streaming calls.

---

### Core Feature Automation Checklist

#### Workspace & UI State
- [ ] Tab persistence across application restarts
- [ ] Active tab restoration
- [ ] Unsaved changes (dirty state) tracking and prompt
- [ ] Two-column vs Three-column layout switching
- [ ] Dark/Light theme switching and persistence

#### REST Client
- [ ] Simple GET request execution
- [ ] POST request with JSON body and syntax highlighting
- [ ] Headers & Query Parameters handling (enable/disable toggles)
- [ ] Method switching logic (GET/POST/PUT/DELETE/PATCH)
- [ ] Response display (formatted JSON, status code, time, size)

#### gRPC Client
- [ ] Client-side Server Reflection (Service/Method discovery)
- [ ] Unary call execution
- [ ] Server Streaming response accumulation and display
- [ ] Rich error decoding (decoding `grpc-status-details-bin` trailers)
- [ ] One-click request payload generation from reflection sample

#### Collection Management
- [x] Create new collection
- [x] Save request to collection via modal
- [x] Delete request from collection tree
- [ ] Collection renaming and cloning
- [ ] Folder creation and drag-and-drop reordering
- [ ] Collection-level variable editing and persistence
- [ ] Postman Collection v2.1 Import

#### Environment & Variable Resolution
- [ ] Global active environment switching
- [ ] Per-tab environment assignment (override global)
- [ ] Variable interpolation (`{{key}}`) in URL, Headers, and Body
- [ ] SSL/TLS verification toggle (Insecure mode)
- [ ] Postman Environment Import

#### Scripting & Automation
- [ ] Pre-request script execution (variable injection)
- [ ] Post-response script execution (value extraction)
- [ ] `ultra` object API verification (`ultra.env.set`, `ultra.response`)
- [ ] Script console log capturing and display

---

## 2. Unit & Component Testing (Planned)
We intend to use Vitest for fast, isolated testing of individual React components and utility functions.

- **Helper Functions**: `helpers.ts` (UID generation, request creation).
- **Domain Logic**: Logic for proto parsing and variable interpolation.
- **UI Components**: `KeyValueEditor`, `ResponseViewer`, etc.

---

## 3. Implementation Status

| Milestone | Status |
|-----------|--------|
| Playwright Infrastructure | ✅ Configured |
| GitHub Actions Quality Gate | ✅ Active on PR/Push |
| Core REST Flow | ✅ Automated (`rest-flow.spec.ts`) |
| gRPC Feature Suite | 🏗️ Planned |
| Scripting Sandbox Tests | 🏗️ Planned |
