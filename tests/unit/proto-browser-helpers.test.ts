/// <reference types="bun-types" />
import { describe, it, expect } from "bun:test";
import { 
  getServiceShortName, 
  getPackageName, 
  splitTypeName, 
  streamingLabel,
  MethodInfo 
} from "../../src/lib/proto-helpers";

describe("Proto Browser UI Helpers", () => {
  describe("getServiceShortName", () => {
    it("extracts the last part of a full service name", () => {
      expect(getServiceShortName("greeter.v1.Greeter")).toBe("Greeter");
      expect(getServiceShortName("Greeter")).toBe("Greeter");
    });
  });

  describe("getPackageName", () => {
    it("extracts the package part of a full service name", () => {
      expect(getPackageName("greeter.v1.Greeter")).toBe("greeter.v1");
      expect(getPackageName("Greeter")).toBe("(root)");
    });
  });

  describe("splitTypeName", () => {
    it("splits a type name into package and short name", () => {
      expect(splitTypeName("mypkg.MyMessage")).toEqual({ pkg: "mypkg", short: "MyMessage" });
      expect(splitTypeName(".mypkg.MyMessage")).toEqual({ pkg: "mypkg", short: "MyMessage" });
      expect(splitTypeName("MyMessage")).toEqual({ pkg: "", short: "MyMessage" });
    });
  });

  describe("streamingLabel", () => {
    it("identifies unary calls", () => {
      const m: MethodInfo = { 
        name: "Call", fullName: "x/Call", requestType: "A", responseType: "B",
        clientStreaming: false, serverStreaming: false 
      };
      expect(streamingLabel(m)).toEqual({ label: "unary", cls: "proto-badge-unary" });
    });

    it("identifies server streaming calls", () => {
      const m: MethodInfo = { 
        name: "Call", fullName: "x/Call", requestType: "A", responseType: "B",
        clientStreaming: false, serverStreaming: true 
      };
      expect(streamingLabel(m)).toEqual({ label: "server stream", cls: "proto-badge-server" });
    });

    it("identifies client streaming calls", () => {
      const m: MethodInfo = { 
        name: "Call", fullName: "x/Call", requestType: "A", responseType: "B",
        clientStreaming: true, serverStreaming: false 
      };
      expect(streamingLabel(m)).toEqual({ label: "client stream", cls: "proto-badge-client" });
    });

    it("identifies bidi streaming calls", () => {
      const m: MethodInfo = { 
        name: "Call", fullName: "x/Call", requestType: "A", responseType: "B",
        clientStreaming: true, serverStreaming: true 
      };
      expect(streamingLabel(m)).toEqual({ label: "bidi stream", cls: "proto-badge-bidi" });
    });
  });
});
