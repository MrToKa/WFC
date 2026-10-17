import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { initializeDatabase } from './db.js';
import { initializeObjectStorage } from './services/objectStorageService.js';
import { initializeModelRegistry, stopModelRegistry } from './modelRegistry/runtime.js';
import { stopViewerSessions } from './viewerSessions/runtime.js';

const app = createApp();
function startListening(server: http.Server | https.Server, protocol: string): void {
  // Suppress Node's automatic 100 Continue until project edit authorization and durable acceptance.
  server.on('checkContinue', (req, res) => {
    // Match raw encoded parameter aliases too: Express decodes :projectId after routing.
    let pathname: string;
    try { pathname = new URL(req.url ?? '/', 'http://wfc.invalid').pathname; }
    catch { res.writeHead(400); res.end(); return; }
    if (!/^\/api\/projects\/[^/]+\/model-imports\/?$/i.test(pathname) || req.method !== 'POST') res.writeContinue();
    app(req, res);
  });
  server.requestTimeout = 900_000;
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    const deadline = setTimeout(() => process.exit(1), 30_000);
    deadline.unref();
    void Promise.allSettled([stopViewerSessions(),stopModelRegistry()]).finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.listen(config.port, config.host, () => {
    console.log(`API listening on ${protocol}://${config.host}:${config.port}`);
  });
}

const startServer = async (): Promise<void> => {
  try {
    await initializeDatabase();
    await initializeObjectStorage();
    await initializeModelRegistry();
    if (config.https.enabled) {
      const resolvePath = (value: string): string =>
        path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);

      const keyPath = config.https.keyPath;
      const certPath = config.https.certPath;

      if (!keyPath || !certPath) {
        throw new Error(
          'HTTPS certificate paths are not configured but HTTPS is enabled'
        );
      }

      const [key, cert, ca] = await Promise.all([
        fs.readFile(resolvePath(keyPath)),
        fs.readFile(resolvePath(certPath)),
        config.https.caPath
          ? fs.readFile(resolvePath(config.https.caPath))
          : Promise.resolve<Buffer | undefined>(undefined)
      ]);

      const tlsOptions: https.ServerOptions = {
        key,
        cert
      };

      if (ca) {
        tlsOptions.ca = ca;
      }

      if (config.https.passphrase) {
        tlsOptions.passphrase = config.https.passphrase;
      }

      const server = https.createServer(tlsOptions, app);

      startListening(server, 'https');
      return;
    }

    startListening(http.createServer(app), 'http');
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();
