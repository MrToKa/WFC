import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import type { AuthenticatedRequest } from '../middleware.js';
import { authenticate, requireAdmin } from '../middleware.js';
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
import {
  mapProjectFileVersionRow,
  type ProjectFileVersionRow
} from '../models/projectFileVersion.js';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

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

type ProjectFilesRequest = AuthenticatedRequest & {
  params: {
    projectId: string;
    fileId?: string;
    versionId?: string;
  };
};

type ProjectFilesUploadRequest = ProjectFilesRequest & {
  file?: Express.Multer.File;
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

const determineContentType = (
  extension: string,
  mimetype: string
): string => {
  if (mimetype && mimetype !== 'application/octet-stream') {
    return mimetype;
  }

  return FALLBACK_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
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

const buildContentDisposition = (fileName: string): string => {
  const sanitized = fileName.replace(/["\r\n]/g, '').trim() || 'download';
  const encoded = encodeURIComponent(sanitized);
  return `attachment; filename="${sanitized}"; filename*=UTF-8''${encoded}`;
};

export const projectFilesRouter = (() => {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get('/', async (req: ProjectFilesRequest, res: Response) => {
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
  });

  router.post(
    '/',
    requireAdmin,
    upload.single('file'),
    async (req: ProjectFilesUploadRequest, res: Response) => {
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
      const replaceFileId =
        typeof req.query.replaceId === 'string' &&
        req.query.replaceId.trim() !== ''
          ? req.query.replaceId.trim()
          : undefined;

      const deleteUploadedObject = async (): Promise<void> => {
        try {
          await deleteObject(getProjectBucket(), objectKey);
        } catch (cleanupError) {
          console.warn(
            `Failed to clean up uploaded project file object "${objectKey}"`,
            cleanupError
          );
        }
      };

      let uploaded = false;

      try {
        if (replaceFileId) {
          const existingResult = await pool.query<{
            object_key: string;
            file_name: string;
            content_type: string | null;
            size_bytes: string | number | null;
            uploaded_by: string | null;
          }>(
            `
              SELECT
                object_key,
                file_name,
                content_type,
                size_bytes,
                uploaded_by
              FROM project_files
              WHERE id = $1 AND project_id = $2
              LIMIT 1;
            `,
            [replaceFileId, projectId]
          );

          const existingTarget = existingResult.rows[0] ?? null;

          if (!existingTarget) {
            res.status(404).json({ error: 'File not found' });
            return;
          }

          if (
            existingTarget.file_name.toLowerCase() !==
            displayFileName.toLowerCase()
          ) {
            const conflict = await pool.query<{ id: string }>(
              `
                SELECT id
                FROM project_files
                WHERE project_id = $1
                  AND LOWER(file_name) = LOWER($2)
                  AND id <> $3
                LIMIT 1;
              `,
              [projectId, displayFileName, replaceFileId]
            );

            if (conflict.rowCount > 0) {
              res.status(409).json({
                error: 'A file with this name already exists for this project',
                fileId: conflict.rows[0].id
              });
              return;
            }
          }
        } else {
          const existing = await pool.query<{ id: string }>(
            `
              SELECT id
              FROM project_files
              WHERE project_id = $1 AND LOWER(file_name) = LOWER($2)
              LIMIT 1;
            `,
            [projectId, displayFileName]
          );

          if (existing.rowCount > 0) {
            res.status(409).json({
              error: 'A file with this name already exists for this project',
              fileId: existing.rows[0].id
            });
            return;
          }
        }

        await uploadObject({
          bucket: getProjectBucket(),
          objectKey,
          data: file.buffer,
          size: file.size,
          contentType
        });
        uploaded = true;

        if (replaceFileId) {
          const client = await pool.connect();

          try {
            await client.query('BEGIN');

            const existingResult = await client.query<{
              object_key: string;
              file_name: string;
              content_type: string | null;
              size_bytes: string | number | null;
              uploaded_by: string | null;
            }>(
              `
                SELECT
                  object_key,
                  file_name,
                  content_type,
                  size_bytes,
                  uploaded_by
                FROM project_files
                WHERE id = $1 AND project_id = $2
                FOR UPDATE;
              `,
              [replaceFileId, projectId]
            );

            const existingFile = existingResult.rows[0];

            if (!existingFile) {
              await client.query('ROLLBACK');
              await deleteUploadedObject();
              res.status(404).json({ error: 'File not found' });
              return;
            }

            const versionResult = await client.query<{ version: number }>(
              `
                SELECT COALESCE(MAX(version_number), 0) AS version
                FROM project_file_versions
                WHERE project_file_id = $1;
              `,
              [replaceFileId]
            );

            const nextVersion =
              Number(versionResult.rows[0]?.version ?? 0) + 1;

            await client.query(
              `
                INSERT INTO project_file_versions (
                  id,
                  project_file_id,
                  version_number,
                  object_key,
                  file_name,
                  content_type,
                  size_bytes,
                  uploaded_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
              `,
              [
                randomUUID(),
                replaceFileId,
                nextVersion,
                existingFile.object_key,
                existingFile.file_name,
                existingFile.content_type,
                existingFile.size_bytes ?? null,
                existingFile.uploaded_by
              ]
            );

            await client.query(
              `
                UPDATE project_files
                SET
                  object_key = $1,
                  file_name = $2,
                  content_type = $3,
                  size_bytes = $4,
                  uploaded_by = $5,
                  uploaded_at = NOW()
                WHERE id = $6 AND project_id = $7;
              `,
              [
                objectKey,
                displayFileName,
                contentType,
                file.size,
                req.userId,
                replaceFileId,
                projectId
              ]
            );

            const updatedResult = await client.query<ProjectFileRow>(
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
              [replaceFileId]
            );

            await client.query('COMMIT');

            const updatedFile = mapProjectFileRow(updatedResult.rows[0], {
              canDelete: true
            });

            res.json({ file: updatedFile });
            return;
          } catch (error) {
            try {
              await client.query('ROLLBACK');
            } catch (rollbackError) {
              console.warn(
                'Failed to rollback project file replace transaction',
                rollbackError
              );
            }

            await deleteUploadedObject();

            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              (error as { code?: string }).code === '23505'
            ) {
              const conflict = await pool.query<{ id: string }>(
                `
                  SELECT id
                  FROM project_files
                  WHERE project_id = $1 AND LOWER(file_name) = LOWER($2)
                  LIMIT 1;
                `,
                [projectId, displayFileName]
              );

              res.status(409).json({
                error: 'A file with this name already exists for this project',
                fileId: conflict.rows[0]?.id
              });
              return;
            }

            console.error('Replace project file error', error);
            res.status(500).json({ error: 'Failed to replace project file' });
            return;
          } finally {
            client.release();
          }
        }

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
        if (uploaded) {
          await deleteUploadedObject();
        }

        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === '23505'
        ) {
          const conflict = await pool.query<{ id: string }>(
            `
              SELECT id
              FROM project_files
              WHERE project_id = $1 AND LOWER(file_name) = LOWER($2)
              LIMIT 1;
            `,
            [projectId, displayFileName]
          );

          res.status(409).json({
            error: 'A file with this name already exists for this project',
            fileId: conflict.rows[0]?.id
          });
          return;
        }

        console.error('Failed to upload project file', error);
        res.status(500).json({ error: 'Failed to upload file' });
      }
    }
  );

  router.delete(
    '/:fileId',
    async (req: ProjectFilesRequest, res: Response) => {
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
            WHERE id = $1 AND project_id = $2
            LIMIT 1;
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
          res.status(403).json({
            error: 'Only the uploader or an admin can delete this file'
          });
          return;
        }

        const versions = await pool.query<{ object_key: string }>(
          `
            SELECT object_key
            FROM project_file_versions
            WHERE project_file_id = $1;
          `,
          [fileId]
        );

        try {
          await deleteObject(getProjectBucket(), fileRow.object_key);
        } catch (error) {
          console.warn(
            `Failed to delete project file object "${fileRow.object_key}" from storage`,
            error
          );
        }

        for (const version of versions.rows) {
          try {
            await deleteObject(getProjectBucket(), version.object_key);
          } catch (error) {
            console.warn(
              `Failed to delete project file version object "${version.object_key}" from storage`,
              error
            );
          }
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
    async (req: ProjectFilesRequest, res: Response) => {
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
            WHERE pf.id = $1 AND pf.project_id = $2
            LIMIT 1;
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
          fileRow.content_type ??
          determineContentType(
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

  router.get(
    '/:fileId/versions',
    async (req: ProjectFilesRequest, res: Response) => {
      const { projectId, fileId } = req.params;

      if (!projectId || !fileId) {
        res.status(400).json({ error: 'Project ID and file ID are required' });
        return;
      }

      try {
        const result = await pool.query<ProjectFileVersionRow>(
          `
            SELECT
              v.id,
              v.project_file_id,
              v.version_number,
              v.object_key,
              v.file_name,
              v.content_type,
              v.size_bytes,
              v.uploaded_by,
              v.created_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM project_file_versions v
            LEFT JOIN users u ON u.id = v.uploaded_by
            INNER JOIN project_files pf ON pf.id = v.project_file_id
            WHERE pf.project_id = $1 AND v.project_file_id = $2
            ORDER BY v.version_number DESC;
          `,
          [projectId, fileId]
        );

        const versions = result.rows.map(mapProjectFileVersionRow);
        res.json({ versions });
      } catch (error) {
        console.error('Failed to list project file versions', error);
        res.status(500).json({ error: 'Failed to load project file versions' });
      }
    }
  );

  router.get(
    '/:fileId/versions/:versionId/download',
    async (req: ProjectFilesRequest, res: Response) => {
      const { projectId, fileId, versionId } = req.params;

      if (!projectId || !fileId || !versionId) {
        res.status(400).json({
          error: 'Project ID, file ID, and version ID are required'
        });
        return;
      }

      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      try {
        const result = await pool.query<ProjectFileVersionRow>(
          `
            SELECT
              v.id,
              v.project_file_id,
              v.version_number,
              v.object_key,
              v.file_name,
              v.content_type,
              v.size_bytes,
              v.uploaded_by,
              v.created_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM project_file_versions v
            LEFT JOIN users u ON u.id = v.uploaded_by
            INNER JOIN project_files pf ON pf.id = v.project_file_id
            WHERE pf.project_id = $1
              AND v.project_file_id = $2
              AND v.id = $3
            LIMIT 1;
          `,
          [projectId, fileId, versionId]
        );

        const versionRow = result.rows[0];

        if (!versionRow) {
          res.status(404).json({ error: 'File version not found' });
          return;
        }

        const stream = await getObjectStream(
          getProjectBucket(),
          versionRow.object_key
        );

        const contentType =
          versionRow.content_type ??
          determineContentType(
            path.extname(versionRow.file_name).toLowerCase(),
            ''
          );

        res.setHeader('Content-Type', contentType);
        res.setHeader(
          'Content-Disposition',
          buildContentDisposition(versionRow.file_name)
        );

        if (versionRow.size_bytes !== null) {
          res.setHeader('Content-Length', String(versionRow.size_bytes));
        }

        stream.on('error', (error) => {
          console.error(
            'Stream error while downloading project file version',
            error
          );
          if (!res.headersSent) {
            res.status(500).end('Failed to download project file version');
          } else {
            res.end();
          }
        });

        stream.pipe(res);
      } catch (error) {
        console.error('Failed to download project file version', error);
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: 'Failed to download project file version' });
        } else {
          res.end();
        }
      }
    }
  );

  router.delete(
    '/:fileId/versions/:versionId',
    requireAdmin,
    async (req: ProjectFilesRequest, res: Response) => {
      const { projectId, fileId, versionId } = req.params;

      if (!projectId || !fileId || !versionId) {
        res.status(400).json({
          error: 'Project ID, file ID, and version ID are required'
        });
        return;
      }

      try {
        const result = await pool.query<{ object_key: string }>(
          `
            SELECT v.object_key
            FROM project_file_versions v
            INNER JOIN project_files pf ON pf.id = v.project_file_id
            WHERE pf.project_id = $1
              AND v.project_file_id = $2
              AND v.id = $3
            LIMIT 1;
          `,
          [projectId, fileId, versionId]
        );

        const versionRow = result.rows[0];

        if (!versionRow) {
          res.status(404).json({ error: 'File version not found' });
          return;
        }

        try {
          await deleteObject(getProjectBucket(), versionRow.object_key);
        } catch (error) {
          console.warn(
            `Failed to delete project file version object "${versionRow.object_key}" from storage`,
            error
          );
        }

        await pool.query(
          `
            DELETE FROM project_file_versions
            WHERE id = $1
              AND project_file_id = $2;
          `,
          [versionId, fileId]
        );

        res.status(204).send();
      } catch (error) {
        console.error('Failed to delete project file version', error);
        res.status(500).json({ error: 'Failed to delete project file version' });
      }
    }
  );

  return router;
})();
