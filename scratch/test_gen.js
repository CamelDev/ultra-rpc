
import { generateSampleBody, setProtobuf } from '../electron/lib/grpc-discovery-utils.ts';
import protobuf from 'protobufjs';

// Initialize protobuf for the test
setProtobuf(protobuf);

// Mock messageTypes and enumTypes
const messageTypes = new Map();
const enumTypes = new Map();

const HelloRequest = {
  name: 'HelloRequest',
  field: [
    { name: 'name', number: 1, type: 9, label: 1 }, // string
    { name: 'email', number: 2, type: 9, label: 1, oneofIndex: 0 },
    { name: 'phone', number: 3, type: 9, label: 1, oneofIndex: 0 }
  ],
  oneofDecl: [{ name: 'contact' }]
};

messageTypes.set('test.HelloRequest', HelloRequest);
messageTypes.set('.test.HelloRequest', HelloRequest);

console.log('--- Default Variant ---');
const body1 = generateSampleBody(messageTypes, enumTypes, 'test.HelloRequest', new Set());
console.log(JSON.stringify(body1, null, 2));

console.log('\n--- Selected Variant (phone) ---');
const body2 = generateSampleBody(messageTypes, enumTypes, 'test.HelloRequest', new Set(), {
  oneofSelection: { 0: 'phone' }
});
console.log(JSON.stringify(body2, null, 2));
