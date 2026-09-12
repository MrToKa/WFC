import { initializeObjectStorage } from './services/objectStorageService.js';

try {
  await initializeObjectStorage();
  console.log('Configured object-storage buckets are ready.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Object storage initialization failed');
  process.exitCode = 1;
}
