import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import type { AuthenticatedRequest } from '../middleware.js';
import { authenticate } from '../middleware.js';
import { pool } from '../db.js';
import {
  deleteObject,
  getObjectStream,
  getProjectBucket,
  uploadObject
} from '../services/objectStorageService.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  mapProjectFileRow,
  type ProjectFileRow
} from '../models/projectFile.js';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

type ProjectFilesRequest = AuthenticatedRequest & {
  params: {
    projectId: string;
    fileId?: string;
  };
};

const ALLOWED_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png'
]);

const FALLBACK_MIME_BY_EXTENSION: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

const sanitizeObjectFileName = (name: string): string => {
  const normalized = name.normalize('NFKD').replace(/[^\w.-]+/g, '-');
  return normalized.replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'file';
};

const normalizeOriginalFileName = (
  originalName: string,
  extension: string
): string => {
  const baseName = path.basename(originalName, extension).trim();
  const normalizedBase = baseName
    ? baseName
        .normalize('NFKD')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 200)
    : 'file';
  return `${normalizedBase}${extension}`;
};

const buildObjectKey = (
  projectId: string,
  originalFileName: string
): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const nameWithoutExt = path.basename(originalFileName, extension);
  const sanitizedBase = sanitizeObjectFileName(nameWithoutExt);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `projects/${projectId}/${timestamp}-${randomUUID()}-${
    sanitizedBase || 'file'
  }${extension}`;
};

const determineContentType = (
  extension: string,
  mimetype: string
): string => {
  const normalizedMime = mimetype && mimetype !== 'application/octet-stream'
    ? mimetype
    : FALLBACK_MIME_BY_EXTENSION[extension];
  return normalizedMime ?? 'application/octet-stream';
};

const buildContentDisposition = (fileName: string): string => {
  const sanitized = fileName.replace(/["\r\n]/g, '').trim() || 'download';
  const encoded = encodeURIComponent(sanitized);
  return `attachment; filename="${sanitized}"; filename*=UTF-8''${encoded}`;
};

const getProjectFilesRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get(
    '/',
    async (req: ProjectFilesRequest, res: Response): Promise<void> => {
      const { projectId } = req.params;

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      const project = await ensureProjectExists(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      try {
        const result = await pool.query<ProjectFileRow>(
          `
            SELECT
              pf.id,
              pf.project_id,
              pf.object_key,
              pf.file_name,
              pf.content_type,
              pf.size_bytes,
              pf.uploaded_by,
              pf.uploaded_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM project_files pf
            LEFT JOIN users u ON u.id = pf.uploaded_by
            WHERE pf.project_id = $1
            ORDER BY pf.uploaded_at DESC;
          `,
          [projectId]
        );

        const files = result.rows.map((row) =>
          mapProjectFileRow(row, {
            canDelete:
              req.isAdmin === true ||
              (req.userId !== undefined && req.userId === row.uploaded_by)
          })
        );

        res.json({ files });
      } catch (error) {
        console.error('Failed to list project files', error);
        res.status(500).json({ error: 'Failed to load project files' });
      }
    }
  );

  router.post(
    '/',
    upload.single('file'),
    async (req: ProjectFilesRequest, res: Response): Promise<void> => {
      const { projectId } = req.params;

      if (!projectId) {
        res.status(400).json({ error: 'Project ID is required' });
        return;
      }

      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const project = await ensureProjectExists(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'File is required' });
        return;
      }

      const extension = path.extname(file.originalname).toLowerCase();

      if (!ALLOWED_EXTENSIONS.has(extension)) {
        res.status(400).json({
          error:
            'Unsupported file type. Allowed extensions: .doc, .docx, .xls, .xlsx, .pdf, .jpg, .jpeg, .png'
        });
        return;
      }

      const displayFileName = normalizeOriginalFileName(
        file.originalname,
        extension
      );

      const objectKey = buildObjectKey(projectId, displayFileName);
      const contentType = determineContentType(extension, file.mimetype);

      try {
        await uploadObject({
          bucket: getProjectBucket(),
          objectKey,
          data: file.buffer,
          size: file.size,
          contentType
        });

        const id = randomUUID();

        await pool.query(
          `
            INSERT INTO project_files (
              id,
              project_id,
              object_key,
              file_name,
              content_type,
              size_bytes,
              uploaded_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7);
          `,
          [
            id,
            projectId,
            objectKey,
            displayFileName,
            contentType,
            file.size,
            req.userId
          ]
        );

        const result = await pool.query<ProjectFileRow>(
          `
            SELECT
              pf.id,
              pf.project_id,
              pf.object_key,
              pf.file_name,
              pf.content_type,
              pf.size_bytes,
              pf.uploaded_by,
              pf.uploaded_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM project_files pf
            LEFT JOIN users u ON u.id = pf.uploaded_by
            WHERE pf.id = $1;
          `,
          [id]
        );

        const newFile = mapProjectFileRow(result.rows[0], {
          canDelete: true
        });

        res.status(201).json({ file: newFile });
      } catch (error) {
        console.error('Failed to upload project file', error);
        res.status(500).json({ error: 'Failed to upload file' });
      }
    }
  );

  router.delete(
    '/:fileId',
    async (req: ProjectFilesRequest, res: Response): Promise<void> => {
      const { projectId, fileId } = req.params;

      if (!projectId || !fileId) {
        res.status(400).json({ error: 'Project ID and file ID are required' });
        return;
      }

      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      try {
        const result = await pool.query<{
          object_key: string;
          uploaded_by: string | null;
        }>(
          `
            SELECT object_key, uploaded_by
            FROM project_files
            WHERE id = $1 AND project_id = $2;
          `,
          [fileId, projectId]
        );

        const fileRow = result.rows[0];

        if (!fileRow) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        const isUploader =
          fileRow.uploaded_by !== null && fileRow.uploaded_by === req.userId;

        if (!isUploader && req.isAdmin !== true) {
          res
            .status(403)
            .json({ error: 'Only the uploader or an admin can delete a file' });
          return;
        }

        try {
          await deleteObject(getProjectBucket(), fileRow.object_key);
        } catch (error) {
          console.warn(
            `Failed to delete project file object "${fileRow.object_key}" from storage`,
            error
          );
        }

        await pool.query(
          `DELETE FROM project_files WHERE id = $1 AND project_id = $2;`,
          [fileId, projectId]
        );

        res.status(204).send();
      } catch (error) {
        console.error('Failed to delete project file', error);
        res.status(500).json({ error: 'Failed to delete file' });
      }
    }
  );

  router.get(
    '/:fileId/download',
    async (req: ProjectFilesRequest, res: Response): Promise<void> => {
      const { projectId, fileId } = req.params;

      if (!projectId || !fileId) {
        res.status(400).json({ error: 'Project ID and file ID are required' });
        return;
      }

      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      try {
        const result = await pool.query<ProjectFileRow>(
          `
            SELECT
              pf.id,
              pf.project_id,
              pf.object_key,
              pf.file_name,
              pf.content_type,
              pf.size_bytes,
              pf.uploaded_by,
              pf.uploaded_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM project_files pf
            LEFT JOIN users u ON u.id = pf.uploaded_by
            WHERE pf.id = $1 AND pf.project_id = $2;
          `,
          [fileId, projectId]
        );

        const fileRow = result.rows[0];

        if (!fileRow) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        const stream = await getObjectStream(
          getProjectBucket(),
          fileRow.object_key
        );

        const contentType =
          fileRow.content_type ?? determineContentType(
            path.extname(fileRow.file_name).toLowerCase(),
            ''
          );

        res.setHeader('Content-Type', contentType);
        res.setHeader(
          'Content-Disposition',
          buildContentDisposition(fileRow.file_name)
        );

        if (fileRow.size_bytes !== null) {
          res.setHeader('Content-Length', String(fileRow.size_bytes));
        }

        stream.on('error', (error) => {
          console.error('Stream error while downloading project file', error);
          if (!res.headersSent) {
            res.status(500).end('Failed to download file');
          } else {
            res.end();
          }
        });

        stream.pipe(res);
      } catch (error) {
        console.error('Failed to download project file', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download file' });
        } else {
          res.end();
        }
      }
    }
  );

  return router;
};

export const projectFilesRouter = getProjectFilesRouter();
