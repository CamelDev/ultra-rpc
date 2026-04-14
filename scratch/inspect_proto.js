
import protobuf from 'protobufjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.join(__dirname, '../tests/mocks/test.proto');

const root = new protobuf.Root();
root.loadSync(protoPath, { keepCase: true });
root.resolveAll();

const type = root.lookupType('test.HelloRequest');
console.log('Type:', type.name);

for (const field of type.fieldsArray) {
  console.log(`Field: ${field.name}`);
  console.log(`  oneof: ${field.oneof}`);
  console.log(`  partOf: ${field.partOf ? field.partOf.name : 'null'}`);
  console.log(`  optional: ${field.optional}`);
}

console.log('Oneofs:', type.oneofsArray.map(o => o.name));
