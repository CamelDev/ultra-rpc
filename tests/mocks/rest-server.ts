import http from 'http';

export class MockRestServer {
  private server: http.Server | null = null;
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Log for debugging (optional for tests)
        console.log(`[MockServer] ${req.method} ${req.url}`);

        if (req.url === '/data' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            message: 'Hello from mock server!',
            timestamp: new Date().toISOString()
          }));
          return;
        }

        if (req.url === '/echo' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              echoed: JSON.parse(body),
              received_at: new Date().toISOString()
            }));
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      });

      this.server.listen(this.port, () => {
        console.log(`[MockServer] Running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        // Force close all active connections to prevent hanging on stop()
        if (typeof (this.server as any).closeAllConnections === 'function') {
          (this.server as any).closeAllConnections();
        }
        
        this.server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  get url() {
    return `http://localhost:${this.port}`;
  }
}
