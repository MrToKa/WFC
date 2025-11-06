import { createApp } from './app.js';
import { config } from './config.js';
import { initializeDatabase } from './db.js';
import { initializeObjectStorage } from './services/objectStorageService.js';

const app = createApp();

const startServer = async (): Promise<void> => {
  try {
    await initializeDatabase();
    await initializeObjectStorage();
    app.listen(config.port, config.host, () => {
      console.log(`API listening on http://${config.host}:${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();
