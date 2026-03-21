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

### Core Feature Automation Checklist

#### Workspace & UI State
- [x] Tab persistence across application restarts
- [x] Active tab restoration
- [x] Unsaved changes (dirty state) tracking and prompt
- [x] Two-column vs Three-column layout switching
- [x] Dark/Light theme switching and persistence

#### REST Client
- [x] Simple GET request execution
- [x] POST request with JSON body and syntax highlighting
- [x] Headers & Query Parameters handling (enable/disable toggles)
- [x] Method switching logic (GET/POST/PUT/DELETE/PATCH)
- [x] Response display (formatted JSON, status code, time, size)

#### gRPC Client
- [x] Client-side Server Reflection (Service/Method discovery)
- [x] Unary call execution
- [x] Server Streaming response accumulation and display
- [x] Rich error decoding (decoding `grpc-status-details-bin` trailers)
- [x] One-click request payload generation from reflection sample

#### Collection Management
- [x] Create new collection
- [x] Save request to collection via modal
- [x] Delete request from collection tree
- [ ] Collection renaming and cloning
- [ ] Folder creation and drag-and-drop reordering
- [ ] Collection-level variable editing and persistence
- [ ] Postman Collection v2.1 Import

#### Environment & Variable Resolution
- [x] Global active environment switching
- [x] Per-tab environment assignment (override global)
- [x] Variable interpolation (`{{key}}`) in URL, Headers, and Body
- [x] SSL/TLS verification toggle (Insecure mode)
- [x] Postman Environment Import
- [x] Workspace state saved (Window bounds, sidebars etc.)

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
| Workspace & UI Suite | ✅ Automated (`workspace-ui.spec.ts`) |
- [x] gRPC Unary Suite | ✅ Automated (`mock-grpc.spec.ts`)
- [x] gRPC Advanced Suite (Reflection/Streaming/Error) | ✅ Automated (`mock-grpc.spec.ts`)
- [ ] Scripting Sandbox Tests | 🏗️ Planned

---

### Verified Scenarios & Results

#### 1. Advanced gRPC Verification
- **Location**: [`tests/e2e/mock-grpc.spec.ts`](file:///Users/kamildabrowski/projects/ultra-rpc/tests/e2e/mock-grpc.spec.ts)
- **Scenarios**:
    - **Service Discovery**: Verified that clicking "Discover Services" successfully fetches and expands the service/method list via Server Reflection.
    - **Payload Generation**: Verified that selecting a method automatically populates the JSON editor with a sample request body.
    - **Server Streaming**: Verified that multiple response items from a server stream are correctly accumulated and displayed in the UI as a JSON array.
    - **Rich Error Decoding**: Verified that decoded `google.rpc.Status` messages and `ErrorInfo` details from the `grpc-status-details-bin` trailer are correctly displayed.

#### 2. REST Method Switching
- **Location**: [`tests/e2e/mock-rest.spec.ts`](file:///Users/kamildabrowski/projects/ultra-rpc/tests/e2e/mock-rest.spec.ts)
- **Scenarios**:
    - **Method Selection**: Verified that picking GET, POST, PUT, DELETE, or PATCH correctly updates the request.
    - **Round-trip Verification**: Confirmed via the local mock server that the exact selected method was received and echoed back.

## Final Verification Result

The automated suite results in a stable and passing verification for all core and advanced features:

```text
  10 passed (45.3s)
```
