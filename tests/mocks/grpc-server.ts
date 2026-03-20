import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ReflectionService } from '@grpc/reflection';
import protobuf from 'protobufjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MockGrpcServer {
  private server: grpc.Server;
  private port: number;

  constructor(port: number = 50051) {
    this.port = port;
    this.server = new grpc.Server();
  }

  async start(): Promise<void> {
    const protoPath = path.join(__dirname, 'test.proto');
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const greetingService = protoDescriptor.test.GreetingService.service;

    this.server.addService(greetingService, {
      SayHello: (call: any, callback: any) => {
        const name = call.request.name || 'World';
        callback(null, { greeting: `Hello, ${name}!` });
      },
      SayHellos: (call: any) => {
        const name = call.request.name || 'World';
        let count = 0;
        const interval = setInterval(() => {
          call.write({ greeting: `Hello ${count + 1}, ${name}!` });
          count++;
          if (count >= 3) {
            clearInterval(interval);
            call.end();
          }
        }, 100);
      },
      SayHelloError: (call: any, callback: any) => {
        // Construct a rich error using grpc-status-details-bin
        const metadata = new grpc.Metadata();
        
        // Define google.rpc.Status and ErrorInfo inline for encoding
        const statusProtoDef = `
          syntax = "proto3";
          package google.rpc;
          message Status {
            int32 code = 1;
            string message = 2;
            repeated Any details = 3;
          }
          message Any {
            string type_url = 1;
            bytes value = 2;
          }
          message ErrorInfo {
            string reason = 1;
            string domain = 2;
            map<string, string> metadata = 3;
          }
        `;
        const root = protobuf.parse(statusProtoDef).root;
        const Status = root.lookupType("google.rpc.Status");
        const ErrorInfo = root.lookupType("google.rpc.ErrorInfo");

        const errorInfoValue = ErrorInfo.encode({
          reason: "INVALID_USER_ID",
          domain: "example.com",
          metadata: { user_id: "12345" }
        }).finish();

        const status = Status.encode({
          code: 3, // INVALID_ARGUMENT
          message: "The provided user ID is invalid",
          details: [
            {
              type_url: "type.googleapis.com/google.rpc.ErrorInfo",
              value: errorInfoValue
            }
          ]
        }).finish();

        metadata.add('grpc-status-details-bin', Buffer.from(status));

        callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: "Invalid Argument Error",
          metadata: metadata
        });
      }
    });

    // Add Reflection Service
    const reflection = new ReflectionService(packageDefinition);
    reflection.addToServer(this.server);

    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        `0.0.0.0:${this.port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err) return reject(err);
          this.server.start();
          console.log(`[MockGrpcServer] Running at localhost:${port}`);
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.tryShutdown(() => {
        resolve();
      });
    });
  }

  get url() {
    return `localhost:${this.port}`;
  }
}
