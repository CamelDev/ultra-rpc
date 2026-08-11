import { describe, it, expect, beforeAll } from "bun:test";
import protobuf from "protobufjs";
import "protobufjs/ext/descriptor";
import { setProtobuf, fixMapEntryTypes, parseMapsToArrays } from "../../electron/lib/grpc-discovery-utils";

beforeAll(() => {
  setProtobuf(protobuf);
});

describe("Map field payload parsing and encoding", () => {
  const protoSource = `
    syntax = "proto3";
    package test;

    message CarrierCriteria {
      string marketing_carrier_code = 1;
    }

    message SupplierCriteria {
      repeated CarrierCriteria carrier_criteria = 1;
      string pcc = 2;
      bool live_search_preferred = 3;
    }

    message FlightRelatedCriteria {
      map<string, SupplierCriteria> supplier_criteria = 1;
      bool search_only_specified_suppliers = 2;
    }

    message SearchRequest {
      FlightRelatedCriteria flight_related_criteria = 1;
    }
  `;

  it("correctly maps snake_case JSON with map fields through gRPC reflection encoding and decoding", () => {
    const root = protobuf.parse(protoSource).root;
    root.resolveAll();
    
    const descriptorSet = (root as any).toDescriptor("proto3");
    const reflectionRoot = protobuf.Root.fromDescriptor(descriptorSet);
    reflectionRoot.resolveAll();
    fixMapEntryTypes(reflectionRoot);

    const requestType = reflectionRoot.lookupType("test.SearchRequest");

    const inputJson = {
      flight_related_criteria: {
        supplier_criteria: {
          britishairwaysndc: {
            carrier_criteria: [
              { marketing_carrier_code: "BA" }
            ],
            pcc: "PCCBA",
            live_search_preferred: true
          }
        },
        search_only_specified_suppliers: true
      }
    };

    const fixedPayload = parseMapsToArrays(requestType, inputJson);

    const msg = requestType.fromObject(fixedPayload);
    const encodedBuffer = requestType.encode(msg).finish();

    // Server decoding with original proto root
    const origRequestType = root.lookupType("test.SearchRequest");
    const decoded = origRequestType.decode(encodedBuffer);
    const obj = origRequestType.toObject(decoded, { defaults: true, keepCase: false });

    expect(obj.flightRelatedCriteria.supplierCriteria.britishairwaysndc).toBeDefined();
    expect(obj.flightRelatedCriteria.supplierCriteria.britishairwaysndc.pcc).toBe("PCCBA");
    expect(obj.flightRelatedCriteria.supplierCriteria.britishairwaysndc.liveSearchPreferred).toBeTrue();
    expect(obj.flightRelatedCriteria.supplierCriteria.britishairwaysndc.carrierCriteria[0].marketingCarrierCode).toBe("BA");
  });
});
