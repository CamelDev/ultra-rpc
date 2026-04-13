/// <reference types="bun-types" />
import { describe, it, expect, beforeAll } from "bun:test";
import protobuf from "protobufjs";
import { 
  setProtobuf, 
  generateSampleBody, 
  indexDescriptorTypes,
  processDescriptorBuffers
} from "../../electron/lib/grpc-discovery-utils";

// Initialize the utility with live protobufjs instance for tests
beforeAll(() => {
  setProtobuf(protobuf);
});

describe("gRPC Discovery Utils", () => {
  const testProto = `
    syntax = "proto3";
    package test;

    message Simple {
      string name = 1;
      int32 age = 2;
      bool active = 3;
    }

    message Nested {
      string title = 1;
      Simple inner = 2;
      repeated string tags = 3;
    }

    message WithMap {
      map<string, string> attributes = 1;
      map<int32, Simple> complex_map = 2;
    }

    message WithOneof {
      string id = 1;
      oneof payload {
        string text = 2;
        int32 number = 3;
        Simple data = 4;
      }
    }

    enum Status {
      UNKNOWN = 0;
      ACTIVE = 1;
      INACTIVE = 2;
    }

    message WithEnum {
      Status status = 1;
    }

    service TestService {
      rpc GetSimple(Simple) returns (Nested);
    }
  `;

  let root: protobuf.Root;
  let messageTypes: Map<string, any>;
  let enumTypes: Map<string, any>;

  beforeAll(() => {
    root = protobuf.parse(testProto).root;
    messageTypes = new Map();
    enumTypes = new Map();
    
    // We need to simulate the raw descriptor structure for the tests
    // because indexDescriptorTypes expects the descriptor object, not the Root object.
    // However, for testing generateSampleBody, we just need a way to look up fields.
    
    // Let's use the Root objects and mock the lookup if needed.
    // Actually, generateSampleBody expects the "msg" object from the descriptor.
    // I will mock a descriptor-like structure for the tests to avoid dependencies on reflection.
  });

  describe("generateSampleBody", () => {
    it("generates a sample for a simple message", () => {
      const msg = {
        name: "Simple",
        field: [
          { name: "name", type: 9, jsonName: "name" }, // TYPE_STRING
          { name: "age", type: 5, jsonName: "age" },   // TYPE_INT32
          { name: "active", type: 8, jsonName: "active" } // TYPE_BOOL
        ]
      };
      const msgs = new Map([["test.Simple", msg]]);
      const results = generateSampleBody(msgs, new Map(), "test.Simple", new Set());
      
      expect(results).toEqual({
        name: "name_sample",
        age: 1,
        active: true
      });
    });

    it("handles repeated fields", () => {
      const msg = {
        name: "WithRepeated",
        field: [
          { name: "tags", type: 9, label: 3, jsonName: "tags" } // LABEL_REPEATED, TYPE_STRING
        ]
      };
      const msgs = new Map([["test.WithRepeated", msg]]);
      const results = generateSampleBody(msgs, new Map(), "test.WithRepeated", new Set());
      
      expect(results.tags).toBeArray();
      expect(results.tags).toEqual(["tags_sample"]);
    });

    it("handles nested messages", () => {
      const inner = {
        name: "Inner",
        field: [{ name: "val", type: 5, jsonName: "val" }]
      };
      const outer = {
        name: "Outer",
        field: [{ name: "nested", type: 11, typeName: "test.Inner", jsonName: "nested" }]
      };
      const msgs = new Map([
        ["test.Inner", inner],
        ["test.Outer", outer]
      ]);
      const results = generateSampleBody(msgs, new Map(), "test.Outer", new Set());
      
      expect(results.nested).toEqual({ val: 1 });
    });

    it("handles oneofs by picking the first field by default", () => {
      const msg = {
        name: "OneofMsg",
        field: [
          { name: "f1", type: 9, oneofIndex: 0, jsonName: "f1" },
          { name: "f2", type: 5, oneofIndex: 0, jsonName: "f2" }
        ]
      };
      const msgs = new Map([["test.OneofMsg", msg]]);
      const results = generateSampleBody(msgs, new Map(), "test.OneofMsg", new Set());
      
      expect(results).toEqual({ f1: "f1_sample" });
      expect(results.f2).toBeUndefined();
    });

    it("handles oneof selection via options", () => {
      const msg = {
        name: "OneofMsg",
        field: [
          { name: "f1", type: 9, oneofIndex: 0, jsonName: "f1" },
          { name: "f2", type: 5, oneofIndex: 0, jsonName: "f2" }
        ]
      };
      const msgs = new Map([["test.OneofMsg", msg]]);
      const results = generateSampleBody(msgs, new Map(), "test.OneofMsg", new Set(), {
        oneofSelection: { 0: "f2" }
      });
      
      expect(results).toEqual({ f2: 1 });
      expect(results.f1).toBeUndefined();
    });

    it("handles recursive messages by stopping at depth to avoid infinite loops", () => {
      const msg: any = {
        name: "Loop",
        field: [{ name: "self", type: 11, typeName: "test.Loop", jsonName: "self" }]
      };
      const msgs = new Map([["test.Loop", msg]]);
      const results = generateSampleBody(msgs, new Map(), "test.Loop", new Set());
      
      expect(results).toEqual({ self: {} });
    });

    it("handles enums", () => {
      const enm = {
        name: "Status",
        value: [{ name: "ACTIVE", number: 1 }]
      };
      const msg = {
        name: "WithEnum",
        field: [{ name: "status", type: 14, typeName: "test.Status", jsonName: "status" }]
      };
      const msgs = new Map([["test.WithEnum", msg]]);
      const enums = new Map([["test.Status", enm]]);
      const results = generateSampleBody(msgs, enums, "test.WithEnum", new Set());
      
      expect(results.status).toBe("ACTIVE");
    });
  });

  describe("indexDescriptorTypes", () => {
    it("correctly indexes nested message types", () => {
      const msg = {
        name: "Parent",
        nestedType: [
          { name: "Child", field: [] }
        ]
      };
      const messageTypes = new Map();
      const enumTypes = new Map();
      indexDescriptorTypes("test", msg, messageTypes, enumTypes);
      
      expect(messageTypes.has("test.Parent")).toBeTrue();
      expect(messageTypes.has("test.Parent.Child")).toBeTrue();
    });
  });
});
