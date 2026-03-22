import http2 from 'http2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');

const options = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
  allowHTTP1: true
};

const server = http2.createSecureServer(options);

server.on('error', (err) => console.error('[MockServer] Error:', err));

server.on('request', (req, res) => {
  const protocol = req.httpVersion === '2.0' ? 'HTTP/2' : `HTTP/${req.httpVersion}`;
  console.log(`[MockServer] Received ${protocol} request: ${req.method} ${req.url}`);

  res.writeHead(200, { 
    'Content-Type': 'application/json',
    'x-protocol-used': protocol
  });
  
  res.end(JSON.stringify({
    success: true,
    message: `Hello from ${protocol}`,
    protocol: protocol,
    headers: req.headers
  }));
});

const PORT = 3443;
server.listen(PORT, () => {
  console.log(`[MockServer] Protocol Test Server running at https://localhost:${PORT}`);
});
