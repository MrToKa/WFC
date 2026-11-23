import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { assistantMaxJobFiles, type AssistantFile } from '../../shared/projectAssistant.js';
import { PROJECT_FILE_MAX_BYTES } from '../../shared/projectFileSize.js';
import { deleteObject, getProjectBucket, uploadObject } from '../services/objectStorageService.js';
import { PathFinderError } from '../pathfinder/errors.js';

const receive = multer({
  dest: tmpdir(),
  limits: {
    files: assistantMaxJobFiles,
    fileSize: PROJECT_FILE_MAX_BYTES + 1,
    fields: 1,
    fieldSize: 100_000,
  },
}).array('documents', assistantMaxJobFiles);

export const receiveTaskDocuments: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  receive(req, res, (error) => {
    if (error) {
      if (!(error instanceof multer.MulterError)) return next(error);
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.message });
      return;
    }
    const documents = req.files as Express.Multer.File[];
    const cleanup = () => {
      void Promise.all(documents.map((file) => rm(file.path, { force: true }))).catch((error) =>
        console.error('Unable to clean up staged assistant documents', error),
      );
    };
    res.once('close', cleanup);
    try {
      req.body = JSON.parse(req.body.job);
    } catch {
      res.status(400).json({ error: 'Invalid task metadata' });
      return;
    }
    next();
  });
};

export async function saveTaskDocuments(
  project: string,
  jobId: string,
  documents: Express.Multer.File[],
  selected: { id: string; versionId: string | null }[],
  stored: AssistantFile[],
) {
  if (
    !documents.length ||
    documents.length !== selected.length ||
    new Set(selected.map((f) => f.id)).size !== selected.length
  )
    throw new PathFinderError('INVALID_TASK_DOCUMENTS', 400);
  for (const [index, file] of documents.entries()) {
    const name = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    if (file.size > PROJECT_FILE_MAX_BYTES) throw new PathFinderError('FILE_TOO_LARGE', 413);
    if (!/\.(pdf|png|jpe?g|csv)$/i.test(name) || selected[index].versionId !== null)
      throw new PathFinderError('UNSUPPORTED_TASK_DOCUMENT', 400);
    const key = `projects/${project}/assistant/jobs/${jobId}/${randomUUID()}`;
    stored.push({ id: selected[index].id, versionId: null, key, name, taskDocument: true });
    await uploadObject({
      bucket: getProjectBucket(),
      objectKey: key,
      data: createReadStream(file.path),
      size: file.size,
    });
  }
}

export async function discardTaskDocuments(files: AssistantFile[]) {
  await Promise.all(
    files.map((file) =>
      deleteObject(getProjectBucket(), file.key).catch((error) =>
        console.error('Unable to remove unclaimed assistant document', file.key, error),
      ),
    ),
  );
}
