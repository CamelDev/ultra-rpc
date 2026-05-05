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
- [x] Browser-style tab grouping, custom colors, renaming, and expand/collapse (`tab-groups.spec.ts`)
- [x] Tab group management modal (visibility toggling, renaming, deletion, color picking) (`tab-groups.spec.ts`)
- [x] Tab persistence across application restarts (`workspace-ui.spec.ts`)
- [x] Active tab restoration (`workspace-ui.spec.ts`)
- [x] Unsaved changes (dirty state) tracking and prompt (`workspace-ui.spec.ts`)
- [x] Two-column vs Three-column layout switching (`workspace-ui.spec.ts`)
- [x] Dark/Light theme switching and persistence (`workspace-ui.spec.ts`)
- [x] Config tab persistence per request tab (`config-tab-persistence.spec.ts`)
- [x] JSON body auto-formatting with variable support (`json-format.spec.ts`)

#### REST Client
- [x] Request Timeout (Configurable per-request timeouts) (`timeout.spec.ts`)
- [x] Simple GET request execution (`rest-flow.spec.ts`)
- [x] POST request with JSON body and syntax highlighting (`rest-flow.spec.ts`)
- [x] Headers & Query Parameters handling (`rest-flow.spec.ts`)
- [x] Method switching logic (`mock-rest.spec.ts`)
- [x] Response display (`rest-flow.spec.ts`)

#### gRPC Client
- [x] Client-side Server Reflection (`mock-grpc.spec.ts`)
- [x] Unary call execution (`mock-grpc.spec.ts`)
- [x] Server Streaming response accumulation and display (`mock-grpc.spec.ts`)
- [x] Rich error decoding (`mock-grpc.spec.ts`)
- [x] One-click request payload generation (`mock-grpc.spec.ts`)
- [x] `oneof` field handling in request payload generation (picks first field by default) (`grpc-discovery-oneof.spec.ts`)
- [x] Local `.proto` file discovery and field syncing (`grpc-proto-discovery.spec.ts`)

#### Collection Management
- [x] Create new collection (`collection-management.spec.ts`)
- [x] Save request to collection via modal (`collection-management.spec.ts`)
- [x] Delete request from collection tree (`collection-management.spec.ts`)
- [x] Collection renaming and cloning (`collection-management.spec.ts`)
- [x] Folder creation and drag-and-drop reordering (`folder-support.spec.ts` & `collection-management.spec.ts`)
- [x] Collection-level variable editing and persistence (`collection-management.spec.ts`)
- [x] Postman Collection v2.1 Import (`collection-management.spec.ts`)
- [x] Bruno Collection Import (`bruno-import.spec.ts`)
- [x] Additional Formats Import (`import-formats.spec.ts`)
- [x] Collection tree search and filtering (`collection-search.spec.ts`)
- [x] Request renaming during save flow (`save-modal-name.spec.ts`)
- [x] **Single Request Import** (Bruno `.yml` or Postman item `.json`) (`import-request.spec.ts`)

#### Environment & Variable Resolution
- [x] Global active environment switching (`environment-workspace.spec.ts`)
- [x] Per-tab environment assignment (`environment-workspace.spec.ts`)
- [x] Apply environment to all tabs (`environment-propagation.spec.ts`)
- [x] Variable interpolation (`environment-workspace.spec.ts`)
- [x] Advanced variable persistence logic (`variable-persistence.spec.ts`)
- [x] SSL/TLS verification toggle (`environment-workspace.spec.ts`)
- [x] Postman Environment Import (`environment-workspace.spec.ts`)
- [x] Workspace state saved (`environment-workspace.spec.ts`)
- [x] Selective Variable Enabling (`environment-workspace.spec.ts`)

#### Scripting & Automation
- [x] Pre-request script execution (`scripting-automation.spec.ts`)
- [x] Post-response script execution (`scripting-automation.spec.ts`)
- [x] `ultra` object API verification (`scripting-ultra.spec.ts`)
- [x] Script console log capturing and display (`scripting-automation.spec.ts`)
- [x] Persistent Global variables (`scripting-ultra.spec.ts`)
- [x] Script validation and error reporting (`script-validation.spec.ts`)

#### 🔄 Flow Runner (Orchestration)
- [x] Create, rename, reorder, and delete flows (`flow-management.spec.ts`)
- [x] Step variable persistence via `ultra.context.set` (`flow-variables.spec.ts`)
- [x] Flow sub-flow linking and referencing (`flow-linking.spec.ts`)
- [x] Flow advanced features scenarios (`flow-advanced-features.spec.ts`)
- [x] Cloning and Exporting flows (`flow-panel-advanced.spec.ts` & `flow-cloning.spec.ts`)
- [x] Navigation from flow step to Request Tab (`flow-edit-request.spec.ts`)
- [x] Reset flow state with baseline preservation (`flow-reset.spec.ts`)
- [x] Request Selector Modal for step linking (`request-selector-modal.spec.ts`)
- [x] Comprehensive orchestration: Auto-run vs Step-by-step (`flow-scenarios.spec.ts`)

#### 📚 Code Library
- [x] Library script management (CRUD) (`library-management.spec.ts`)
- [x] Library script validation and syntax error reporting (`library-validation.spec.ts`)

#### 🛡️ Vault & Security
- [x] Vault access denial handling (`vault-denial.spec.ts`)
- [x] Vault data moving/transfer handling (`vault-move.spec.ts`)
- [x] Conditional deletion logic (`conditional-deletion.spec.ts`)

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
| gRPC Advanced Suite | ✅ Automated (`mock-grpc.spec.ts`) |
| Scripting & Automation | ✅ Automated (`scripting-ultra.spec.ts`) |
| Collection & Folder Mgmt | ✅ Automated (`collection-management.spec.ts`) |
| Environment & Variable Mgmt | ✅ Automated (`environment-workspace.spec.ts`) |
| **Flow Runner Orchestration** | ✅ Automated (`flow-management.spec.ts`) |
| **Code Library Persistence** | ✅ Automated (`library-management.spec.ts`) |
| **Secret Vault & Security** | ✅ Automated (`vault-denial.spec.ts`) |

---

### Verified Scenarios & Results

#### 1. Advanced gRPC Verification
- **Location**: [`tests/e2e/mock-grpc.spec.ts`](/tests/e2e/mock-grpc.spec.ts)
- **Scenarios**:
    - **Service Discovery**: Verified that clicking "Discover Services" successfully fetches and expands the service/method list via Server Reflection.
    - **Payload Generation**: Verified that selecting a method automatically populates the JSON editor with a sample request body.
    - **Server Streaming**: Verified that multiple response items from a server stream are correctly accumulated and displayed in the UI as a JSON array.
    - **Rich Error Decoding**: Verified that decoded `google.rpc.Status` messages and `ErrorInfo` details from the `grpc-status-details-bin` trailer are correctly displayed.
- **OneOf Handling**: Verified that gRPC reflection and proto discovery both correctly handle `oneof` fields by picking the first field in the set during sample body generation. (`grpc-discovery-oneof.spec.ts`)

#### 2. REST Method Switching
- **Location**: [`tests/e2e/mock-rest.spec.ts`](/tests/e2e/mock-rest.spec.ts)
- **Scenarios**:
    - **Method Selection**: Verified that picking GET, POST, PUT, DELETE, or PATCH correctly updates the request.
    - **Round-trip Verification**: Confirmed via the local mock server that the exact selected method was received and echoed back.

#### 3. Collection Management Lifecycle
- **Location**: [`tests/e2e/collection-management.spec.ts`](/tests/e2e/collection-management.spec.ts)
- **Scenarios**:
    - **Renaming/Cloning**: Verified that collections can be renamed and cloned successfully, with unique IDs generated for duplicates.
    - **Folder Creation**: Verified that the new `CreateFolderModal` (replacing `window.prompt`) correctly triggers and saves new folders with sanitized names (allowing hyphens).
    - **Nesting & Cleanup**: Verified that folders appear correctly in the tree after expansion and that both folders and collections can be deleted.
    - **Variable Editing**: Verified that collection-level variables can be added, edited, and persisted successfully via the custom modal and CodeMirror editors.
    - **Postman Import**: Verified that Postman v2.1 collections (with folders, requests, and variables) can be imported and correctly reflected in the application tree.

#### 4. Scripting & Automation
- **Location**: [`tests/e2e/scripting-automation.spec.ts`](/tests/e2e/scripting-automation.spec.ts), [`tests/e2e/scripting-ultra.spec.ts`](/tests/e2e/scripting-ultra.spec.ts)
- **Scenarios**:
    - **Pre-request Injection**: Verified that `ultra.env.set` in a pre-request script correctly updates variables used in the URL interpolation of the outgoing request.
    - **Ultra API**: Verified that `ultra.sendRequest` can be used to chain requests and that `ultra.globals` correctly persists across multiple script executions.
    - **Asynchronous Execution**: Confirmed that scripts wait for all `ultra.sendRequest` callbacks to complete before finishing the script execution phase.
    - **Test Assertions**: Verified that `ultra.test` and `ultra.expect` correctly run and report results (PASS/FAIL) to the console.
    - **Console Logging**: Verified that `console.log` output from scripts is captured with timestamps and displayed in the UI.

#### 5. UI & Workspace Sophistication
- **Location**: [`tests/e2e/workspace-ui.spec.ts`](/tests/e2e/workspace-ui.spec.ts), [`tests/e2e/config-tab-persistence.spec.ts`](/tests/e2e/config-tab-persistence.spec.ts), [`tests/e2e/json-format.spec.ts`](/tests/e2e/json-format.spec.ts)
- **Scenarios**:
    - **Tab Persistence**: Verified that each tab maintains its own active config section (e.g., Tab A is on "Headers" while Tab B is on "Body") and this state is restored after application restart.
    - **Smart Formatting**: Verified that the JSON "Format" button handles unquoted template variables `{{like_this}}` correctly, preserving the template syntax while beautifying the surrounding JSON.
    - **Dirty State**: Verified that modifying a request marks the tab as dirty (`*`) and triggers a confirmation dialog when attempting to close without saving.
    - **Theme & Layout**: Verified that light/dark theme and two/three-column layout settings are persisted across restarts.
- **Tab Grouping Sophistication**: Verified full lifecycle of tab groups including right-click creation, inline renaming (auto-focus and double-click), dragging tabs into groups, collapsing/expanding groups, and persistence across restarts.
- **Tab Management Modal**: Verified that the new "Tab Groups" modal allows for global visibility toggling (hide/show), mass deletion (ungrouping), and color customization. (`tab-groups.spec.ts`)

#### 6. Search & Discovery
- **Location**: [`tests/e2e/collection-search.spec.ts`](/tests/e2e/collection-search.spec.ts), [`tests/e2e/grpc-proto-discovery.spec.ts`](/tests/e2e/grpc-proto-discovery.spec.ts)
- **Scenarios**:
    - **Fuzzy Search**: Verified that the collection tree correctly filters items based on search input (3-char minimum), keeping parent collections visible if their children match.
    - **Proto Import**: Verified that gRPC services can be discovered by selecting a local `.proto` file, and that the selection correctly syncs between the Discovery Modal and the main request view.

#### 7. Environment Propagation
- **Location**: [`tests/e2e/environment-propagation.spec.ts`](/tests/e2e/environment-propagation.spec.ts)
- **Scenarios**:
    - **Global Apply**: Verified that "Apply to all tabs" correctly propagates the selected environment to all currently open request tabs.

#### 8. Bruno Collection Import
- **Location**: [`tests/e2e/bruno-import.spec.ts`](/tests/e2e/bruno-import.spec.ts)
- **Scenarios**:
    - **Multi-protocol Import**: Verified that Bruno collections containing both REST and gRPC requests are imported correctly.
    - **Script Conversion**: Verified that Bruno-specific scripting (`bru.*`) is automatically converted to the `ultra.*` API during import.
    - **Vault Integration**: Verified that secrets from Bruno collections are correctly identified and moved to the UltraRPC secret vault.

#### 9. Save Flow Enhancements
- **Location**: [`tests/e2e/save-modal-name.spec.ts`](/tests/e2e/save-modal-name.spec.ts)
- **Scenarios**:
    - **Custom Naming**: Verified that users can rename a request directly within the "Save to Collection" modal before confirming.

#### 10. Single Request Import
- **Location**: [`tests/e2e/import-request.spec.ts`](/tests/e2e/import-request.spec.ts)
- **Scenarios**:
    - **Bruno Import**: Verified that individual Bruno request files (`.yml` starting with `info:`) can be imported into any collection or folder.
    - **Postman Import**: Verified that individual Postman request items (`.json` with a `"request"` object) are correctly detected and imported.
    - **Smart Body Detection**: Verified that imported gRPC and HTTP requests automatically default to `JSON` body type if a payload is present, ensuring the editor is visible.
    - **Protocol Conversion**: Confirmed that Postman scripts and Bruno metadata are correctly mapped to the UltraRPC internal format during single-file import.

---

## 4. Flow Runner Use Cases

The Flow Runner is designed for complex API orchestration and automation. Below are the primary use cases verified by the test suite:

### 4.1 Authentication Chaining
**Scenario**: Login to a REST API, extract the Bearer token, and use it in a subsequent gRPC call.
- **Verification**: Step A (REST) executes → Script extracts token to `ultra.context` → Step B (gRPC) uses `{{auth_token}}` in metadata.

### 4.2 Data Seeding & Cleanup
**Scenario**: Create a sequence of related records in a development environment before starting a test run.
- **Verification**: Multiple POST/PUT requests run in a specific order, passing the IDs of created entities via context variables.

### 4.3 Integrated Persistence
**Scenario**: Perform an operation and verify that the results are reflected on disk.
- **Verification**: Flow Runner enables verifying that operations (like renaming or deleting requests) are correctly mirrored in the local filesystem.

### 4.4 Multi-Protocol Validation
**Scenario**: Trigger an event via REST and verify its effects by calling a gRPC service.
- **Verification**: Verify that data consistency is maintained across different protocols (e.g., checking if a gRPC stream receives updates after a REST PATCH).

---

## 5. Future Roadmap & Gaps

While we have achieved high coverage, the following areas are prioritized for future automation:

- [ ] **Flow Branching & Loops**: Automated verification for conditional step execution based on previous results.
- [ ] **Complex JSONPath Extraction**: Testing deep nesting and array filtering in the Flow step settings.
- [ ] **Error Propagation**: Verifying that a flow correctly halts or follows an error-handler path when a request fails.
- [ ] **Large Response Handling**: Benchmark and E2E verification for responses exceeding 50MB.
- [ ] **Global Search**: E2E testing for the upcoming cross-tab and cross-collection search feature.

---

## Final Verification Result

The automated suite results in a stable and passing verification for all core and advanced features:

```text
  79 tests in 38 files passed (approx. 3.6m)
```
