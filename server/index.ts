import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { createApp } from './app.js';
import { config } from './config.js';
import { initializeDatabase } from './db.js';
import { initializeObjectStorage } from './services/objectStorageService.js';

const app = createApp();

const startServer = async (): Promise<void> => {
  try {
    await initializeDatabase();
    await initializeObjectStorage();
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

      server.listen(config.port, config.host, () => {
        console.log(`API listening on https://${config.host}:${config.port}`);
      });
      return;
    }

    app.listen(config.port, config.host, () => {
      console.log(`API listening on http://${config.host}:${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();
