import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import {
  getStorageRoot,
  getCollectionDir,
  getUniqueFilename,
  updateIdMap,
  findRequestByIdRecursively,
  sanitizeFolderName,
  getSettingsPath,
  getEnvPath
} from "./storage-handler";

let serverInstance: any = null;
let appInstance: any = null;
let currentPort = 0;

// ─── Renderer Notification ────────────────────────────────────────────────────
// Push an event to the renderer after each successful mutating tool call so
// the UI can refresh the collection panel and show a toast.

export interface McpActionEvent {
  action: 'create_collection' | 'add_rest_request' | 'update_rest_request' | 'add_grpc_request' | 'update_grpc_request' | 'create_environment' | 'update_environment';
  name: string;
  collectionId?: string;
}

function notifyRenderer(event: McpActionEvent) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    console.log(`[MCP] → notifyRenderer: action=${event.action} name="${event.name}"`);
    windows[0].webContents.send('mcp:action', event);
  } else {
    console.warn('[MCP] notifyRenderer: no BrowserWindow found, skipping UI update');
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function logRequest(label: string, req: any) {
  const origin = req.headers["origin"] || req.headers["host"] || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  const bodySnippet = req.body
    ? JSON.stringify(req.body).substring(0, 120)
    : "(empty)";
  console.log(
    `[MCP] ${label} | origin=${origin} | ua=${ua.substring(0, 60)} | body=${bodySnippet}`
  );
}

// ─── McpServer Factory ────────────────────────────────────────────────────────
// A new McpServer instance MUST be created per transport connection.
// The SDK does not allow reusing a single McpServer across multiple transports.

function createMcpServerInstance(): McpServer {
  const mcp = new McpServer({
    name: "UltraRPC MCP Server",
    version: "1.0.0",
  });

  // ─── Tool: List Collections ─────────────────────────────────────────────

  mcp.tool("list_collections", "List all available local API collections", {}, async () => {
    console.log(`[MCP] tool:list_collections invoked`);
    try {
      const root = getStorageRoot();
      console.log(`[MCP] list_collections — storage root: ${root}`);
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const collections: Array<{ id: string; name: string }> = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(root, entry.name, "_meta.json");
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
              collections.push({ id: meta.id, name: meta.name || meta.id });
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Check external paths
      const settingsPath = getSettingsPath();
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
          const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : [];
          for (const p of paths) {
            if (fs.existsSync(p)) {
              try {
                const meta = JSON.parse(fs.readFileSync(path.join(p, "_meta.json"), "utf-8"));
                collections.push({ id: meta.id, name: meta.name || meta.id });
              } catch {
                // Ignore parse errors
              }
            }
          }
        } catch {
          // Ignore settings parse errors
        }
      }

      console.log(`[MCP] list_collections — found ${collections.length} collection(s)`);
      return {
        content: [{ type: "text", text: JSON.stringify({ collections }, null, 2) }],
      };
    } catch (err: any) {
      console.error(`[MCP] list_collections error:`, err);
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });

  // ─── Tool: Create Collection ────────────────────────────────────────────

  mcp.tool(
    "create_collection",
    "Initialize a new API collection.",
    { name: z.string().describe("The name of the new collection") },
    async ({ name }) => {
      console.log(`[MCP] tool:create_collection invoked — name="${name}"`);
      try {
        const root = getStorageRoot();
        const id = sanitizeFolderName(name);
        const collDir = path.join(root, id);

        if (fs.existsSync(collDir)) {
          console.warn(`[MCP] create_collection — already exists: ${id}`);
          return { content: [{ type: "text", text: "Collection with that name already exists." }], isError: true };
        }

        fs.mkdirSync(collDir, { recursive: true });
        const meta = { id, name, path: collDir };
        fs.writeFileSync(path.join(collDir, "_meta.json"), JSON.stringify(meta, null, 2));
        console.log(`[MCP] create_collection — created id="${id}" at ${collDir}`);
        notifyRenderer({ action: 'create_collection', name })

        return { content: [{ type: "text", text: JSON.stringify({ success: true, id, name }) }] };
      } catch (err: any) {
        console.error(`[MCP] create_collection error:`, err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── Tool: Add REST Request ─────────────────────────────────────────────

  mcp.tool(
    "add_rest_request",
    "Add a new REST request to a specific collection.",
    {
      collectionId: z.string().describe("The ID of the collection to add the request to."),
      name: z.string().describe("A human-readable name for the request."),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]).describe("The HTTP method."),
      url: z.string().describe("The endpoint URL."),
      headers: z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().default(true) })).optional(),
      params: z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().default(true) })).optional(),
      bodyType: z.enum(["none", "json", "text", "xml", "form", "multipart"]).optional().default("none"),
      body: z.string().optional(),
    },
    async ({ collectionId, name, method, url, headers, params, bodyType, body }) => {
      console.log(`[MCP] tool:add_rest_request — collectionId="${collectionId}" name="${name}" method=${method} url="${url}"`);
      try {
        const collDir = getCollectionDir(collectionId);
        if (!collDir) {
          console.warn(`[MCP] add_rest_request — collection not found: ${collectionId}`);
          return { content: [{ type: "text", text: `Collection not found: ${collectionId}` }], isError: true };
        }

        const requestId = Math.random().toString(36).substring(2, 11);
        const requestToSave = {
          id: requestId, type: "REST", name, method, url,
          headers: headers || [], params: params || [],
          bodyType: bodyType || "none", body: body || "",
        };

        const newFilename = getUniqueFilename(collDir, name || "Untitled Request", ".json");
        const targetPath = path.join(collDir, newFilename);
        fs.writeFileSync(targetPath, JSON.stringify(requestToSave, null, 2));
        updateIdMap(collDir, requestId, newFilename);
        notifyRenderer({ action: 'add_rest_request', name, collectionId })

        return { content: [{ type: "text", text: JSON.stringify({ success: true, requestId }, null, 2) }] };
      } catch (err: any) {
        console.error("[MCP] add_rest_request error:", err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── Tool: Update REST Request ──────────────────────────────────────────

  mcp.tool(
    "update_rest_request",
    "Update an existing REST request in a specific collection.",
    {
      collectionId: z.string().describe("The ID of the collection containing the request."),
      requestId: z.string().describe("The ID of the request to update."),
      name: z.string().optional().describe("A new human-readable name for the request."),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]).optional().describe("The HTTP method."),
      url: z.string().optional().describe("The endpoint URL."),
      headers: z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().default(true) })).optional(),
      params: z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().default(true) })).optional(),
      bodyType: z.enum(["none", "json", "text", "xml", "form", "multipart"]).optional(),
      body: z.string().optional(),
    },
    async ({ collectionId, requestId, name, method, url, headers, params, bodyType, body }) => {
      console.log(`[MCP] tool:update_rest_request — collectionId="${collectionId}" requestId="${requestId}"`);
      try {
        const collDir = getCollectionDir(collectionId);
        if (!collDir) {
          console.warn(`[MCP] update_rest_request — collection not found: ${collectionId}`);
          return { content: [{ type: "text", text: `Collection not found: ${collectionId}` }], isError: true };
        }

        const filePath = findRequestByIdRecursively(collDir, requestId);
        if (!filePath) {
          console.warn(`[MCP] update_rest_request — request not found: ${requestId}`);
          return { content: [{ type: "text", text: `Request not found: ${requestId}` }], isError: true };
        }

        console.log(`[MCP] update_rest_request — found file: ${filePath}`);
        const currentContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const updatedRequest = {
          ...currentContent,
          name: name !== undefined ? name : currentContent.name,
          method: method !== undefined ? method : currentContent.method,
          url: url !== undefined ? url : currentContent.url,
          headers: headers !== undefined ? headers : currentContent.headers,
          params: params !== undefined ? params : currentContent.params,
          bodyType: bodyType !== undefined ? bodyType : currentContent.bodyType,
          body: body !== undefined ? body : currentContent.body,
        };

        let currentPath = filePath;
        if (name !== undefined && name !== currentContent.name) {
          const targetDir = path.dirname(filePath);
          const newFilename = getUniqueFilename(targetDir, name, ".json", filePath);
          const newPath = path.join(targetDir, newFilename);
          console.log(`[MCP] update_rest_request — renaming to: ${newPath}`);
          fs.renameSync(filePath, newPath);
          updateIdMap(targetDir, requestId, newFilename);
          currentPath = newPath;
        }

        fs.writeFileSync(currentPath, JSON.stringify(updatedRequest, null, 2));
        notifyRenderer({ action: 'update_rest_request', name: updatedRequest.name, collectionId })

        return { content: [{ type: "text", text: JSON.stringify({ success: true, requestId }, null, 2) }] };
      } catch (err: any) {
        console.error("[MCP] update_rest_request error:", err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── Tool: Add gRPC Request ─────────────────────────────────────────────

  mcp.tool(
    "add_grpc_request",
    "Add a new gRPC request to a specific collection.",
    {
      collectionId: z.string().describe("The ID of the collection to add the request to."),
      name: z.string().describe("A human-readable name for the request."),
      url: z.string().describe("The host and port (e.g., localhost:50051)."),
      service: z.string().describe("The gRPC service name."),
      method: z.string().describe("The gRPC method name."),
      payload: z.string().optional().describe("The JSON-encoded payload string."),
      metadata: z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().default(true) })).optional().describe("gRPC metadata (headers)."),
      reflection: z.boolean().optional().default(true).describe("Whether to use server reflection."),
    },
    async ({ collectionId, name, url, service, method, payload, metadata, reflection }) => {
      console.log(`[MCP] tool:add_grpc_request — collectionId="${collectionId}" name="${name}" service="${service}" method="${method}"`);
      try {
        const collDir = getCollectionDir(collectionId);
        if (!collDir) {
          console.warn(`[MCP] add_grpc_request — collection not found: ${collectionId}`);
          return { content: [{ type: "text", text: `Collection not found: ${collectionId}` }], isError: true };
        }

        const requestId = Math.random().toString(36).substring(2, 11);
        const requestToSave = {
          id: requestId, type: "GRPC", name, url,
          grpcService: service, grpcMethod: method,
          grpcPayload: payload || "{}", headers: metadata || [],
          grpcReflection: reflection,
        };

        const newFilename = getUniqueFilename(collDir, name || "Untitled Request", ".json");
        const targetPath = path.join(collDir, newFilename);
        fs.writeFileSync(targetPath, JSON.stringify(requestToSave, null, 2));
        updateIdMap(collDir, requestId, newFilename);
        notifyRenderer({ action: 'add_grpc_request', name, collectionId })

        return { content: [{ type: "text", text: JSON.stringify({ success: true, requestId }, null, 2) }] };
      } catch (err: any) {
        console.error("[MCP] add_grpc_request error:", err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── Tool: Update gRPC Request ──────────────────────────────────────────

  mcp.tool(
    "update_grpc_request",
    "Update an existing gRPC request by ID.",
    {
      collectionId: z.string().describe("The ID of the collection containing the request."),
      requestId: z.string().describe("The ID of the request to update."),
      name: z.string().optional().describe("A new human-readable name for the request."),
      url: z.string().optional().describe("The host and port (e.g., localhost:50051)."),
      service: z.string().optional().describe("The gRPC service name."),
      method: z.string().optional().describe("The gRPC method name."),
      payload: z.string().optional().describe("The JSON-encoded payload string."),
      metadata: z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().default(true) })).optional().describe("gRPC metadata (headers)."),
      reflection: z.boolean().optional().describe("Whether to use server reflection."),
    },
    async ({ collectionId, requestId, name, url, service, method, payload, metadata, reflection }) => {
      console.log(`[MCP] tool:update_grpc_request — collectionId="${collectionId}" requestId="${requestId}"`);
      try {
        const collDir = getCollectionDir(collectionId);
        if (!collDir) {
          console.warn(`[MCP] update_grpc_request — collection not found: ${collectionId}`);
          return { content: [{ type: "text", text: `Collection not found: ${collectionId}` }], isError: true };
        }

        const filePath = findRequestByIdRecursively(collDir, requestId);
        if (!filePath) {
          console.warn(`[MCP] update_grpc_request — request not found: ${requestId}`);
          return { content: [{ type: "text", text: `Request not found: ${requestId}` }], isError: true };
        }

        console.log(`[MCP] update_grpc_request — found file: ${filePath}`);
        const currentContent = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const updatedRequest = {
          ...currentContent,
          name: name !== undefined ? name : currentContent.name,
          url: url !== undefined ? url : currentContent.url,
          grpcService: service !== undefined ? service : currentContent.grpcService,
          grpcMethod: method !== undefined ? method : currentContent.grpcMethod,
          grpcPayload: payload !== undefined ? payload : currentContent.grpcPayload,
          headers: metadata !== undefined ? metadata : currentContent.headers,
          grpcReflection: reflection !== undefined ? reflection : currentContent.grpcReflection,
        };

        let currentPath = filePath;
        if (name !== undefined && name !== currentContent.name) {
          const targetDir = path.dirname(filePath);
          const newFilename = getUniqueFilename(targetDir, name, ".json", filePath);
          const newPath = path.join(targetDir, newFilename);
          console.log(`[MCP] update_grpc_request — renaming to: ${newPath}`);
          fs.renameSync(filePath, newPath);
          updateIdMap(targetDir, requestId, newFilename);
          currentPath = newPath;
        }

        fs.writeFileSync(currentPath, JSON.stringify(updatedRequest, null, 2));
        notifyRenderer({ action: 'update_grpc_request', name: updatedRequest.name, collectionId })

        return { content: [{ type: "text", text: JSON.stringify({ success: true, requestId }, null, 2) }] };
      } catch (err: any) {
        console.error("[MCP] update_grpc_request error:", err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── Tool: List Environments ───────────────────────────────────────────

  mcp.tool("list_environments", "List all available environments (excluding vault secrets)", {}, async () => {
    console.log(`[MCP] tool:list_environments invoked`);
    try {
      const envPath = getEnvPath();
      if (!fs.existsSync(envPath)) {
        return { content: [{ type: "text", text: JSON.stringify({ environments: [] }) }] };
      }
      const data = JSON.parse(fs.readFileSync(envPath, "utf-8"));
      // environments.json already excludes vault variables (those are in .vault files)
      console.log(`[MCP] list_environments — found ${data.length} environment(s)`);
      return {
        content: [{ type: "text", text: JSON.stringify({ environments: data }, null, 2) }],
      };
    } catch (err: any) {
      console.error(`[MCP] list_environments error:`, err);
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });

  // ─── Tool: Create Environment ───────────────────────────────────────────

  mcp.tool(
    "create_environment",
    "Create a new environment (does not support vault secrets).",
    {
      name: z.string().describe("The name of the environment."),
      variables: z.array(z.object({
        id: z.string().optional(),
        key: z.string(),
        value: z.string(),
        enabled: z.boolean().default(true)
      })).optional().describe("Non-sensitive variables."),
      sslVerification: z.boolean().optional().default(true).describe("Enable/disable SSL verification."),
      protocol: z.enum(["auto", "http1", "http2"]).optional().default("auto").describe("Preferred HTTP protocol."),
    },
    async ({ name, variables, sslVerification, protocol }) => {
      console.log(`[MCP] tool:create_environment — name="${name}"`);
      try {
        const envPath = getEnvPath();
        let envs: any[] = [];
        if (fs.existsSync(envPath)) {
          envs = JSON.parse(fs.readFileSync(envPath, "utf-8"));
        }

        const newEnvId = randomUUID();
        const newEnv = {
          id: newEnvId,
          name,
          variables: (variables || []).map(v => ({
            id: v.id || randomUUID(),
            key: v.key,
            value: v.value,
            enabled: v.enabled
          })),
          isActive: false,
          sslVerification: sslVerification !== undefined ? sslVerification : true,
          protocol: protocol || "auto"
        };

        envs.push(newEnv);
        fs.writeFileSync(envPath, JSON.stringify(envs, null, 2));
        console.log(`[MCP] create_environment — created id="${newEnvId}"`);
        notifyRenderer({ action: 'create_environment', name });

        return { content: [{ type: "text", text: JSON.stringify({ success: true, id: newEnvId, name }) }] };
      } catch (err: any) {
        console.error("[MCP] create_environment error:", err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ─── Tool: Update Environment ───────────────────────────────────────────

  mcp.tool(
    "update_environment",
    "Update an existing environment by ID.",
    {
      id: z.string().describe("The ID of the environment to update."),
      name: z.string().optional().describe("New name for the environment."),
      variables: z.array(z.object({
        id: z.string().optional(),
        key: z.string(),
        value: z.string(),
        enabled: z.boolean().default(true)
      })).optional().describe("Updated non-sensitive variables (replaces entire list)."),
      sslVerification: z.boolean().optional().describe("Update SSL verification setting."),
      protocol: z.enum(["auto", "http1", "http2"]).optional().describe("Update preferred HTTP protocol."),
    },
    async ({ id, name, variables, sslVerification, protocol }) => {
      console.log(`[MCP] tool:update_environment — id="${id}"`);
      try {
        const envPath = getEnvPath();
        if (!fs.existsSync(envPath)) {
          return { content: [{ type: "text", text: "No environments found." }], isError: true };
        }

        let envs = JSON.parse(fs.readFileSync(envPath, "utf-8"));
        const index = envs.findIndex((e: any) => e.id === id);
        if (index === -1) {
          return { content: [{ type: "text", text: `Environment not found: ${id}` }], isError: true };
        }

        const currentEnv = envs[index];
        const updatedEnv = {
          ...currentEnv,
          name: name !== undefined ? name : currentEnv.name,
          variables: variables !== undefined ? variables.map(v => ({
            id: v.id || randomUUID(),
            key: v.key,
            value: v.value,
            enabled: v.enabled
          })) : currentEnv.variables,
          sslVerification: sslVerification !== undefined ? sslVerification : currentEnv.sslVerification,
          protocol: protocol !== undefined ? protocol : currentEnv.protocol,
        };

        envs[index] = updatedEnv;
        fs.writeFileSync(envPath, JSON.stringify(envs, null, 2));
        console.log(`[MCP] update_environment — updated id="${id}"`);
        notifyRenderer({ action: 'update_environment', name: updatedEnv.name });

        return { content: [{ type: "text", text: JSON.stringify({ success: true, id, name: updatedEnv.name }) }] };
      } catch (err: any) {
        console.error("[MCP] update_environment error:", err);
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  return mcp;
}

// ─── Server Start ──────────────────────────────────────────────────────────────

export async function startMcpServer(port: number = 3000) {
  console.log(`[MCP] startMcpServer() called with port=${port}`);

  if (serverInstance && currentPort === port) {
    console.log(`[MCP] Server already running on port ${port} — skipping restart`);
    return;
  }

  if (serverInstance) {
    console.log(`[MCP] Port changed (${currentPort} → ${port}), restarting server`);
    await stopMcpServer();
  }

  currentPort = port;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Log every incoming request at the middleware level
  app.use((req, _res, next) => {
    console.log(`[MCP] ← ${req.method} ${req.path} | ip=${req.ip} | session=${req.headers["mcp-session-id"] || req.query.sessionId || "–"}`);
    next();
  });

  // Track active transport instances (one per client connection)
  const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

  // ─── MODERN: Streamable HTTP (/mcp) ─────────────────────────────────────
  // Each initialize creates a NEW McpServer + transport pair.

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string;
      const method = req.body?.method || "unknown";
      logRequest(`POST /mcp method=${method}`, req);

      if (!sessionId && req.body?.method === "initialize") {
        console.log(`[MCP] POST /mcp — no session ID + initialize → creating new Streamable session`);

        const mcp = createMcpServerInstance();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            console.log(`[MCP] ✅ Streamable session created: ${id}`);
            transports[id] = transport;
            console.log(`[MCP] Active sessions: ${Object.keys(transports).join(", ") || "none"}`);
          }
        });

        transport.onclose = () => {
          if (transport.sessionId && transports[transport.sessionId]) {
            console.log(`[MCP] Streamable session closed: ${transport.sessionId}`);
            delete transports[transport.sessionId];
            console.log(`[MCP] Active sessions after close: ${Object.keys(transports).join(", ") || "none"}`);
          }
        };

        console.log(`[MCP] Connecting new McpServer instance to Streamable transport…`);
        await mcp.connect(transport);
        console.log(`[MCP] McpServer connected — handling initialize`);
        await transport.handleRequest(req, res, req.body);

      } else if (sessionId && transports[sessionId]) {
        const transport = transports[sessionId];
        if (transport instanceof StreamableHTTPServerTransport) {
          console.log(`[MCP] POST /mcp — reusing Streamable session ${sessionId} for method=${method}`);
          await transport.handleRequest(req, res, req.body);
        } else {
          console.warn(`[MCP] ⚠️  POST /mcp — session ${sessionId} is SSE, not Streamable. Protocol mismatch.`);
          res.status(400).send("Protocol mismatch: session is SSE, not Streamable HTTP");
        }

      } else if (!sessionId) {
        console.warn(`[MCP] ⚠️  POST /mcp — no session ID, method="${method}" is not 'initialize'. Rejecting.`);
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Missing session ID. Send an 'initialize' request first." },
          id: req.body?.id ?? null
        });
      } else {
        console.warn(`[MCP] ⚠️  POST /mcp — session ID ${sessionId} not found. Known: [${Object.keys(transports).join(", ")}]`);
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: `Session not found: ${sessionId}` },
          id: req.body?.id ?? null
        });
      }
    } catch (err) {
      console.error("[MCP] POST /mcp unhandled error:", err);
      if (!res.headersSent) res.status(500).send("Internal error");
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const transport = transports[sessionId];
    console.log(`[MCP] GET /mcp — session=${sessionId || "MISSING"} | transportType=${transport?.constructor?.name ?? "none"}`);

    if (sessionId && transport instanceof StreamableHTTPServerTransport) {
      console.log(`[MCP] GET /mcp — establishing SSE stream for session ${sessionId}`);
      await transport.handleRequest(req, res);
    } else if (!sessionId) {
      console.warn(`[MCP] ⚠️  GET /mcp rejected — no session ID provided`);
      res.status(400).send("Missing mcp-session-id header");
    } else {
      console.warn(`[MCP] ⚠️  GET /mcp rejected — session ${sessionId} not found or wrong transport. Known: [${Object.keys(transports).join(", ")}]`);
      res.status(400).send("Session not found or protocol mismatch");
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    console.log(`[MCP] DELETE /mcp — session=${sessionId || "MISSING"}`);
    const transport = transports[sessionId];
    if (sessionId && transport instanceof StreamableHTTPServerTransport) {
      await transport.handleRequest(req, res);
    } else {
      res.status(400).send("Session not found");
    }
  });

  // ─── LEGACY: SSE (/sse + /messages) ─────────────────────────────────────
  // Each /sse connection gets its OWN McpServer instance — this is critical.
  // The SDK throws if you call mcp.connect() on an already-connected instance.

  app.get("/sse", async (req, res) => {
    logRequest("GET /sse — new legacy SSE connection", req);
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const mcp = createMcpServerInstance();
      const transport = new SSEServerTransport("/messages", res);
      console.log(`[MCP] ✅ Legacy SSE session created: ${transport.sessionId}`);
      transports[transport.sessionId] = transport;
      console.log(`[MCP] Active sessions: ${Object.keys(transports).join(", ")}`);

      res.on("close", () => {
        console.log(`[MCP] Legacy SSE session closed: ${transport.sessionId}`);
        delete transports[transport.sessionId];
        console.log(`[MCP] Active sessions after close: ${Object.keys(transports).join(", ") || "none"}`);
      });

      console.log(`[MCP] Connecting new McpServer instance to SSE transport ${transport.sessionId}…`);
      await mcp.connect(transport);
      console.log(`[MCP] McpServer connected to SSE transport ${transport.sessionId}`);
    } catch (err) {
      console.error("[MCP] GET /sse error:", err);
      if (!res.headersSent) res.status(500).send("Internal error");
    }
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const method = req.body?.method || "unknown";
    logRequest(`POST /messages sessionId=${sessionId} method=${method}`, req);
    try {
      const transport = transports[sessionId];

      if (transport instanceof SSEServerTransport) {
        console.log(`[MCP] POST /messages — dispatching to SSE session ${sessionId}`);
        await transport.handlePostMessage(req, res, req.body);
      } else if (!sessionId) {
        console.warn(`[MCP] ⚠️  POST /messages — no sessionId query param`);
        res.status(400).send("Missing sessionId query parameter");
      } else if (!transport) {
        console.warn(`[MCP] ⚠️  POST /messages — session ${sessionId} not found. Known: [${Object.keys(transports).join(", ")}]`);
        res.status(400).send(`Session not found: ${sessionId}`);
      } else {
        console.warn(`[MCP] ⚠️  POST /messages — session ${sessionId} is Streamable, not SSE. Protocol mismatch.`);
        res.status(400).send("Protocol mismatch: session is Streamable HTTP, not SSE");
      }
    } catch (err) {
      console.error("[MCP] POST /messages unhandled error:", err);
      if (!res.headersSent) res.status(500).send("Internal error");
    }
  });

  // ─── Health / Diagnostics ────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    const sessionList = Object.entries(transports).map(([id, t]) => ({
      id,
      type: t instanceof SSEServerTransport ? "SSE" : "StreamableHTTP",
    }));
    res.json({
      status: "ok",
      port: currentPort,
      activeSessions: sessionList.length,
      sessions: sessionList,
    });
  });

  // ─── Listen ──────────────────────────────────────────────────────────────

  return new Promise<void>((resolve, reject) => {
    try {
      serverInstance = app.listen(port, "0.0.0.0", () => {
        console.log(`[MCP] ✅ Server started successfully:`);
        console.log(`[MCP]   🚀 Modern  (Gemini CLI):          http://127.0.0.1:${port}/mcp`);
        console.log(`[MCP]   🔗 Legacy  (Claude / mcp-remote): http://127.0.0.1:${port}/sse`);
        console.log(`[MCP]   🩺 Health  (diagnostics):         http://127.0.0.1:${port}/health`);
        resolve();
      });

      serverInstance.on("error", (err: any) => {
        console.error(`[MCP] ❌ Server listen error:`, err);
        if (err.code === "EADDRINUSE") {
          console.error(`[MCP] ❌ Port ${port} is already in use. Change the MCP port in Global Settings.`);
        }
        reject(err);
      });

      appInstance = app;
    } catch (e) {
      reject(e);
    }
  });
}

// ─── Server Stop ──────────────────────────────────────────────────────────────

export async function stopMcpServer() {
  console.log(`[MCP] stopMcpServer() called — serverInstance=${serverInstance ? "present" : "null"}`);
  return new Promise<void>((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        console.log("[MCP] ✅ Server stopped");
        serverInstance = null;
        appInstance = null;
        currentPort = 0;
        resolve();
      });
    } else {
      console.log("[MCP] stopMcpServer() — nothing to stop");
      resolve();
    }
  });
}
