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
- [x] Tab persistence across application restarts (`Tab Persistence & Active Tab Restoration`)
- [x] Active tab restoration (`Tab Persistence & Active Tab Restoration`)
- [x] Unsaved changes (dirty state) tracking and prompt (`Unsaved Changes (Dirty State) Prompt`)
- [x] Two-column vs Three-column layout switching (`Layout Switching & Persistence`)
- [x] Dark/Light theme switching and persistence (`Theme Switching & Persistence`)

#### REST Client
- [x] Request Timeout (Configurable per-request timeouts) `timeout.spec.ts`
- [x] Simple GET request execution (`Should hit local REST mock server and get response`)
- [x] POST request with JSON body and syntax highlighting (`should create, save, run and delete a REST request`)
- [x] Headers & Query Parameters handling (`should create, save, run and delete a REST request`)
- [x] Method switching logic (`Should correctly switch between HTTP methods`)
- [x] Response display (`Should hit local REST mock server and get response`)

#### gRPC Client
- [x] Client-side Server Reflection (`Should discover services via reflection and generate payload`)
- [x] Unary call execution (`Should discover services via reflection and generate payload`)
- [x] Server Streaming response accumulation and display (`Should handle server streaming and accumulate responses`)
- [x] Rich error decoding (`Should decode rich gRPC error details (grpc-status-details-bin)`)
- [x] One-click request payload generation (`Should discover services via reflection and generate payload`)

#### Collection Management
- [x] Create new collection (`should perform full collection management lifecycle`)
- [x] Save request to collection via modal (`should perform full collection management lifecycle`)
- [x] Delete request from collection tree (`should perform full collection management lifecycle`)
- [x] Collection renaming and cloning (`should perform full collection management lifecycle`)
- [x] Folder creation and drag-and-drop reordering (`should perform full collection management lifecycle`)
- [x] Collection-level variable editing and persistence (`should perform full collection management lifecycle`)
- [x] Postman Collection v2.1 Import (`should perform full collection management lifecycle`)

#### Environment & Variable Resolution
- [x] Global active environment switching (`Should handle environment variables, SSL toggle, and persistence`)
- [x] Per-tab environment assignment (`Should handle environment variables, SSL toggle, and persistence`)
- [x] Apply environment to all tabs (`Apply to all tabs should propagate environment to every open tab`)
- [x] Variable interpolation (`Should handle environment variables, SSL toggle, and persistence`)
- [x] SSL/TLS verification toggle (`Should handle environment variables, SSL toggle, and persistence`)
- [x] Postman Environment Import (`Should import a Postman environment successfully`)
- [x] Workspace state saved (`Should handle environment variables, SSL toggle, and persistence`)

#### Scripting & Automation
- [x] Pre-request script execution (`Pre-request script should inject value into environment and URL`)
- [x] Post-response script execution (`Post-response script should extract value and run assertions`)
- [x] `ultra` object API verification (`Post-response script should extract value and run assertions`)
- [x] Script console log capturing and display (`Pre-request script should inject value into environment and URL`)

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
| gRPC Unary Suite | ✅ Automated (`mock-grpc.spec.ts`) |
| gRPC Advanced Suite (Reflection/Streaming/Error) | ✅ Automated (`mock-grpc.spec.ts`) |
| Scripting Sandbox Tests | ✅ Automated (`scripting-automation.spec.ts`) |
| Collection Management Suite | ✅ Automated (`collection-management.spec.ts`) |

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

#### 3. Collection Management Lifecycle
- **Location**: [`tests/e2e/collection-management.spec.ts`](file:///Users/kamildabrowski/projects/ultra-rpc/tests/e2e/collection-management.spec.ts)
- **Scenarios**:
    - **Renaming/Cloning**: Verified that collections can be renamed and cloned successfully, with unique IDs generated for duplicates.
    - **Folder Creation**: Verified that the new `CreateFolderModal` (replacing `window.prompt`) correctly triggers and saves new folders with sanitized names (allowing hyphens).
    - **Nesting & Cleanup**: Verified that folders appear correctly in the tree after expansion and that both folders and collections can be deleted.
    - **Variable Editing**: Verified that collection-level variables can be added, edited, and persisted successfully via the custom modal and CodeMirror editors.
    - **Postman Import**: Verified that Postman v2.1 collections (with folders, requests, and variables) can be imported and correctly reflected in the application tree.

#### 4. Scripting & Automation
- **Location**: [`tests/e2e/scripting-automation.spec.ts`](file:///Users/kamildabrowski/projects/ultra-rpc/tests/e2e/scripting-automation.spec.ts)
- **Scenarios**:
    - **Pre-request Injection**: Verified that `ultra.env.set` in a pre-request script correctly updates variables used in the URL interpolation of the outgoing request.
    - **Post-response Extraction**: Verified that values can be extracted from JSON responses and saved to collection variables using `ultra.collection.set`.
    - **Test Assertions**: Verified that `ultra.test` and `ultra.expect` correctly run and report results (PASS/FAIL) to the console.
    - **Console Logging**: Verified that `console.log` output from scripts is captured with timestamps and displayed in the UI.

## Final Verification Result

The automated suite results in a stable and passing verification for all core and advanced features:

```text
  10 passed (45.3s)
```
