import { createApp } from './app.js';
import { config } from './config.js';
import { initializeDatabase } from './db.js';

const app = createApp();

const startServer = async (): Promise<void> => {
  try {
    await initializeDatabase();
    app.listen(config.port, () => {
      console.log(`API listening on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

void startServer();
