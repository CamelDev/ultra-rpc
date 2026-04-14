
import protobuf from 'protobufjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.join(__dirname, '../tests/mocks/test.proto');

const root = new protobuf.Root();
root.loadSync(protoPath, { keepCase: true });
root.resolveAll();

// This is how descriptors are created in reflection
const descriptor = root.toDescriptor('proto3');
const fileDescriptor = descriptor.file[0];

// In grpc-handler.ts, we decode it:
// protobuf.descriptor.FieldDescriptorProto.decode(buf)
// Wait, toDescriptor returns an object already.
// Let's simulate the decode(encode(...))
const FileDescriptorProto = protobuf.common['google/protobuf/descriptor.proto'].lookupType('google.protobuf.FileDescriptorProto');
const buf = FileDescriptorProto.encode(fileDescriptor).finish();
const decoded = FileDescriptorProto.decode(buf);

const type = decoded.messageType.find(m => m.name === 'HelloRequest');
console.log('Message:', type.name);

for (const field of type.field) {
  console.log(`Field: ${field.name}`);
  console.log(`  oneofIndex: ${field.oneofIndex} (type: ${typeof field.oneofIndex})`);
  console.log(`  oneof_index: ${field.oneof_index} (type: ${typeof field.oneof_index})`);
}
