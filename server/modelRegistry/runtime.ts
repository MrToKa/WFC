import { pool } from '../db.js';
import { createModelRegistryRepository } from './repository.js';
import { createModelStorage } from './storage.js';
import { createModelImportService, type ModelImportService } from './importService.js';

let service: ModelImportService | undefined;
export function getModelRegistry(): ModelImportService {
  service ??= createModelImportService({ repository: createModelRegistryRepository(pool), storage: createModelStorage() });
  return service;
}
export async function initializeModelRegistry(): Promise<void> { await getModelRegistry().initialize(); }
export async function stopModelRegistry(): Promise<void> { await service?.close(); }
