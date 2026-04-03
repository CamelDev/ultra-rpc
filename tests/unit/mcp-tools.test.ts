/// <reference types="bun-types" />
/**
 * Unit tests for MCP tool business logic.
 *
 * These tests exercise the core request-building and file-writing logic used by
 * `add_rest_request` and `update_rest_request` without launching Electron.
 * They use Bun's native test runner.
 *
 * Run: bun test tests/unit/mcp-tools.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Helpers that mirror mcp-server.ts logic exactly ─────────────────────────
// We duplicate the logic here (rather than importing from Electron main process
// files that depend on `electron` globals) so tests can run in plain Node/Bun.

function resolveBodyType(
  bodyType: string | undefined | null,
  body: string | undefined | null
): string {
  const bt = bodyType ?? "none";
  if ((bt === "none" || !bt) && body && body.trim()) return "json";
  return bt || "none";
}

function buildAddRequestPayload(args: {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: object[];
  params?: object[];
  bodyType?: string;
  body?: string;
  preRequestScript?: string;
  postResponseScript?: string;
}): Record<string, unknown> {
  const resolvedBodyType = resolveBodyType(args.bodyType, args.body);
  const requestToSave: Record<string, unknown> = {
    id: args.id,
    type: "REST",
    name: args.name,
    method: args.method,
    url: args.url,
    headers: args.headers ?? [],
    params: args.params ?? [],
    bodyType: resolvedBodyType,
    body: args.body ?? "",
  };
  if (args.preRequestScript) requestToSave.preRequestScript = args.preRequestScript;
  if (args.postResponseScript) requestToSave.postResponseScript = args.postResponseScript;
  return requestToSave;
}

function buildUpdateRequestPayload(
  currentContent: Record<string, unknown>,
  patch: {
    name?: string;
    method?: string;
    url?: string;
    headers?: object[];
    params?: object[];
    bodyType?: string;
    body?: string;
    preRequestScript?: string;
    postResponseScript?: string;
  }
): Record<string, unknown> {
  const incomingBody = patch.body !== undefined ? patch.body : (currentContent.body as string);
  const resolvedBodyType =
    patch.bodyType !== undefined
      ? patch.bodyType
      : currentContent.bodyType === "none" && incomingBody && incomingBody.trim()
      ? "json"
      : (currentContent.bodyType as string);

  const updatedRequest: Record<string, unknown> = {
    ...currentContent,
    name: patch.name !== undefined ? patch.name : currentContent.name,
    method: patch.method !== undefined ? patch.method : currentContent.method,
    url: patch.url !== undefined ? patch.url : currentContent.url,
    headers: patch.headers !== undefined ? patch.headers : currentContent.headers,
    params: patch.params !== undefined ? patch.params : currentContent.params,
    bodyType: resolvedBodyType,
    body: patch.body !== undefined ? patch.body : currentContent.body,
    preRequestScript:
      patch.preRequestScript !== undefined
        ? patch.preRequestScript
        : currentContent.preRequestScript,
    postResponseScript:
      patch.postResponseScript !== undefined
        ? patch.postResponseScript
        : currentContent.postResponseScript,
  };

  // Treat empty string as "clear"
  if (!updatedRequest.preRequestScript) delete updatedRequest.preRequestScript;
  if (!updatedRequest.postResponseScript) delete updatedRequest.postResponseScript;

  return updatedRequest;
}

// ─── File-system round-trip helper ───────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultra-mcp-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAndRead(payload: Record<string, unknown>): Record<string, unknown> {
  const filePath = path.join(tmpDir, "request.json");
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("add_rest_request — bodyType auto-inference", () => {
  it("keeps bodyType as 'none' when no body is provided", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Ping", method: "GET", url: "https://example.com",
      bodyType: "none",
    });
    expect(payload.bodyType).toBe("none");
    expect(payload.body).toBe("");
  });

  it("keeps explicitly provided bodyType 'json' regardless of body content", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Create", method: "POST", url: "https://example.com",
      bodyType: "json", body: '{"key":"val"}',
    });
    expect(payload.bodyType).toBe("json");
  });

  it("auto-infers bodyType as 'json' when body is provided but bodyType defaults to 'none'", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Create", method: "POST", url: "https://example.com",
      // bodyType omitted — Zod default is "none"
      bodyType: "none",
      body: '{"key":"val"}',
    });
    expect(payload.bodyType).toBe("json");
  });

  it("auto-infers bodyType as 'json' when bodyType is undefined and body is present", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Create", method: "POST", url: "https://example.com",
      body: '{"key":"val"}',
      // bodyType not provided at all
    });
    expect(payload.bodyType).toBe("json");
  });

  it("does NOT infer bodyType when body is empty string", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Ping", method: "POST", url: "https://example.com",
      bodyType: "none", body: "",
    });
    expect(payload.bodyType).toBe("none");
  });

  it("does NOT infer bodyType when body is only whitespace", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Ping", method: "POST", url: "https://example.com",
      bodyType: "none", body: "   ",
    });
    expect(payload.bodyType).toBe("none");
  });

  it("preserves explicit non-json bodyType (e.g. 'text') even when body is present", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Submit", method: "POST", url: "https://example.com",
      bodyType: "text", body: "plain text body",
    });
    expect(payload.bodyType).toBe("text");
  });
});

describe("add_rest_request — script fields", () => {
  it("does not include script fields when not provided", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Ping", method: "GET", url: "https://example.com",
    });
    expect(payload.preRequestScript).toBeUndefined();
    expect(payload.postResponseScript).toBeUndefined();
  });

  it("saves preRequestScript when provided", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Auth", method: "POST", url: "https://example.com",
      body: '{"user":"me"}',
      preRequestScript: "ultra.env.set('token', 'abc');",
    });
    expect(payload.preRequestScript).toBe("ultra.env.set('token', 'abc');");
    expect(payload.postResponseScript).toBeUndefined();
  });

  it("saves postResponseScript when provided", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Login", method: "POST", url: "https://example.com",
      body: '{}',
      postResponseScript: "ultra.context.set('offerId', ultra.response.body.id);",
    });
    expect(payload.postResponseScript).toBe("ultra.context.set('offerId', ultra.response.body.id);");
  });

  it("saves both pre and post scripts simultaneously", () => {
    const payload = buildAddRequestPayload({
      id: "abc", name: "Full", method: "POST", url: "https://example.com",
      body: '{}',
      preRequestScript: "// before",
      postResponseScript: "// after",
    });
    expect(payload.preRequestScript).toBe("// before");
    expect(payload.postResponseScript).toBe("// after");
  });

  it("persists scripts through JSON file round-trip", () => {
    const payload = buildAddRequestPayload({
      id: "rnd123", name: "BookOffer", method: "POST",
      url: "https://api.example.com/book",
      body: '{"offerId":"{{offerId}}"}',
      postResponseScript: "ultra.context.set('bookingId', ultra.response.body.bookingId);",
    });
    const saved = writeAndRead(payload);
    expect(saved.bodyType).toBe("json");
    expect(saved.postResponseScript).toBe(
      "ultra.context.set('bookingId', ultra.response.body.bookingId);"
    );
    expect(saved.preRequestScript).toBeUndefined();
  });
});

describe("update_rest_request — bodyType auto-inference", () => {
  it("infers 'json' when updating body on a request with bodyType 'none'", () => {
    const current = {
      id: "x", name: "Req", method: "GET", url: "https://a.com",
      bodyType: "none", body: "",
    };
    const updated = buildUpdateRequestPayload(current, { body: '{"hello":"world"}' });
    expect(updated.bodyType).toBe("json");
    expect(updated.body).toBe('{"hello":"world"}');
  });

  it("does not change bodyType when request already has bodyType 'json'", () => {
    const current = {
      id: "x", name: "Req", method: "POST", url: "https://a.com",
      bodyType: "json", body: '{"old":"data"}',
    };
    const updated = buildUpdateRequestPayload(current, { body: '{"new":"data"}' });
    expect(updated.bodyType).toBe("json");
  });

  it("allows explicitly setting bodyType to 'text'", () => {
    const current = {
      id: "x", name: "Req", method: "POST", url: "https://a.com",
      bodyType: "none", body: "",
    };
    const updated = buildUpdateRequestPayload(current, { body: "raw text", bodyType: "text" });
    expect(updated.bodyType).toBe("text");
  });

  it("does not change bodyType when body is updated but remains empty", () => {
    const current = {
      id: "x", name: "Req", method: "GET", url: "https://a.com",
      bodyType: "none", body: "",
    };
    const updated = buildUpdateRequestPayload(current, { body: "" });
    expect(updated.bodyType).toBe("none");
  });
});

describe("update_rest_request — script fields", () => {
  it("preserves existing scripts when not mentioned in the patch", () => {
    const current = {
      id: "x", name: "Req", method: "GET", url: "https://a.com",
      bodyType: "none", body: "",
      preRequestScript: "// existing pre",
      postResponseScript: "// existing post",
    };
    const updated = buildUpdateRequestPayload(current, { url: "https://b.com" });
    expect(updated.preRequestScript).toBe("// existing pre");
    expect(updated.postResponseScript).toBe("// existing post");
  });

  it("adds postResponseScript to a request that had none", () => {
    const current: Record<string, unknown> = {
      id: "x", name: "GetOffer", method: "GET", url: "https://a.com",
      bodyType: "none", body: "",
    };
    const updated = buildUpdateRequestPayload(current, {
      postResponseScript: "ultra.context.set('offerId', ultra.response.body.id);",
    });
    expect(updated.postResponseScript).toBe(
      "ultra.context.set('offerId', ultra.response.body.id);"
    );
    expect(updated.preRequestScript).toBeUndefined();
  });

  it("clears postResponseScript when empty string is passed", () => {
    const current = {
      id: "x", name: "Req", method: "GET", url: "https://a.com",
      bodyType: "none", body: "",
      postResponseScript: "// old",
    };
    const updated = buildUpdateRequestPayload(current, { postResponseScript: "" });
    expect(updated.postResponseScript).toBeUndefined();
  });

  it("updates preRequestScript independently from postResponseScript", () => {
    const current = {
      id: "x", name: "Req", method: "POST", url: "https://a.com",
      bodyType: "json", body: "{}",
      postResponseScript: "// keep me",
    };
    const updated = buildUpdateRequestPayload(current, {
      preRequestScript: "ultra.env.set('x', '1');",
    });
    expect(updated.preRequestScript).toBe("ultra.env.set('x', '1');");
    expect(updated.postResponseScript).toBe("// keep me");
  });

  it("persists added post script through file round-trip", () => {
    const current: Record<string, unknown> = {
      id: "rnd456", name: "GetOffer", method: "GET",
      url: "https://api.example.com/offer",
      bodyType: "none", body: "",
    };
    const updated = buildUpdateRequestPayload(current, {
      postResponseScript: "ultra.context.set('offerId', ultra.response.body.offerId);",
    });
    const saved = writeAndRead(updated);
    expect(saved.postResponseScript).toBe(
      "ultra.context.set('offerId', ultra.response.body.offerId);"
    );
  });
});
