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
  getTemplateBucket,
  uploadObject
} from '../services/objectStorageService.js';
import {
  mapTemplateFileRow,
  type TemplateFileRow
} from '../models/templateFile.js';
import {
  mapTemplateFileVersionRow,
  type TemplateFileVersionRow
} from '../models/templateFileVersion.js';

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

type TemplateFilesRequest = AuthenticatedRequest & {
  params: { templateId?: string; versionId?: string };
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
    : 'template';
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

const buildContentDisposition = (fileName: string): string => {
  const sanitized = fileName.replace(/["\r\n]/g, '').trim() || 'download';
  const encoded = encodeURIComponent(sanitized);
  return `attachment; filename="${sanitized}"; filename*=UTF-8''${encoded}`;
};

const buildObjectKey = (originalFileName: string): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const nameWithoutExt = path.basename(originalFileName, extension);
  const sanitizedBase = sanitizeObjectFileName(nameWithoutExt);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `templates/${timestamp}-${randomUUID()}-${sanitizedBase || 'template'}${
    extension
  }`;
};

export const templateFilesRouter = (() => {
  const router = Router();

  router.use(authenticate);

  router.get('/', async (req: TemplateFilesRequest, res: Response) => {
    try {
      const result = await pool.query<TemplateFileRow>(
        `
          SELECT
            tf.id,
            tf.object_key,
            tf.file_name,
            tf.content_type,
            tf.size_bytes,
            tf.uploaded_by,
            tf.uploaded_at,
            u.first_name AS uploaded_by_first_name,
            u.last_name AS uploaded_by_last_name,
            u.email AS uploaded_by_email
          FROM template_files tf
          LEFT JOIN users u ON u.id = tf.uploaded_by
          ORDER BY tf.uploaded_at DESC;
        `
      );

      const files = result.rows.map((row) =>
        mapTemplateFileRow(row, { canDelete: req.isAdmin === true })
      );

      res.json({ files });
    } catch (error) {
      console.error('Failed to list template files', error);
      res.status(500).json({ error: 'Failed to load template files' });
    }
  });

  router.post(
    '/',
    requireAdmin,
    upload.single('file'),
    async (req: TemplateFilesRequest, res: Response) => {
      if (!req.userId) {
        res.status(401).json({ error: 'Authentication required' });
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
      const objectKey = buildObjectKey(displayFileName);
      const contentType = determineContentType(extension, file.mimetype);
      const replaceTemplateId =
        typeof req.query.replaceId === 'string' &&
        req.query.replaceId.trim() !== ''
          ? req.query.replaceId.trim()
          : undefined;

      const deleteUploadedObject = async (): Promise<void> => {
        try {
          await deleteObject(getTemplateBucket(), objectKey);
        } catch (cleanupError) {
          console.warn(
            `Failed to clean up uploaded template object "${objectKey}"`,
            cleanupError
          );
        }
      };

      try {
        if (!replaceTemplateId) {
          const existing = await pool.query<{ id: string }>(
            `
              SELECT id
              FROM template_files
              WHERE LOWER(file_name) = LOWER($1)
              LIMIT 1;
            `,
            [displayFileName]
          );

          if (existing.rowCount > 0) {
            res.status(409).json({
              error: 'A template with this name already exists',
              templateId: existing.rows[0].id
            });
            return;
          }
        }

        await uploadObject({
          bucket: getTemplateBucket(),
          objectKey,
          data: file.buffer,
          size: file.size,
          contentType
        });

        if (replaceTemplateId) {
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
                FROM template_files
                WHERE id = $1
                LIMIT 1;
              `,
              [replaceTemplateId]
            );

            const existingTemplate = existingResult.rows[0];

            if (!existingTemplate) {
              await client.query('ROLLBACK');
              await deleteUploadedObject();
              res.status(404).json({ error: 'Template file not found' });
              return;
            }

            if (
              existingTemplate.file_name.toLowerCase() !==
              displayFileName.toLowerCase()
            ) {
              const conflict = await client.query<{ id: string }>(
                `
                  SELECT id
                  FROM template_files
                  WHERE LOWER(file_name) = LOWER($1)
                    AND id <> $2
                  LIMIT 1;
                `,
                [displayFileName, replaceTemplateId]
              );

              if (conflict.rowCount > 0) {
                await client.query('ROLLBACK');
                await deleteUploadedObject();
                res.status(409).json({
                  error: 'A template with this name already exists',
                  templateId: conflict.rows[0].id
                });
                return;
              }
            }

            const versionResult = await client.query<{ version: number }>(
              `
                SELECT COALESCE(MAX(version_number), 0) AS version
                FROM template_file_versions
                WHERE template_id = $1;
              `,
              [replaceTemplateId]
            );

            const nextVersion =
              Number(versionResult.rows[0]?.version ?? 0) + 1;

            await client.query(
              `
                INSERT INTO template_file_versions (
                  id,
                  template_id,
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
                replaceTemplateId,
                nextVersion,
                existingTemplate.object_key,
                existingTemplate.file_name,
                existingTemplate.content_type,
                existingTemplate.size_bytes ?? null,
                existingTemplate.uploaded_by
              ]
            );

            await client.query(
              `
                UPDATE template_files
                SET
                  object_key = $1,
                  file_name = $2,
                  content_type = $3,
                  size_bytes = $4,
                  uploaded_by = $5,
                  uploaded_at = NOW()
                WHERE id = $6;
              `,
              [
                objectKey,
                displayFileName,
                contentType,
                file.size,
                req.userId,
                replaceTemplateId
              ]
            );

            const updatedResult = await client.query<TemplateFileRow>(
              `
                SELECT
                  tf.id,
                  tf.object_key,
                  tf.file_name,
                  tf.content_type,
                  tf.size_bytes,
                  tf.uploaded_by,
                  tf.uploaded_at,
                  u.first_name AS uploaded_by_first_name,
                  u.last_name AS uploaded_by_last_name,
                  u.email AS uploaded_by_email
                FROM template_files tf
                LEFT JOIN users u ON u.id = tf.uploaded_by
                WHERE tf.id = $1;
              `,
              [replaceTemplateId]
            );

            await client.query('COMMIT');

            const updatedTemplate = mapTemplateFileRow(
              updatedResult.rows[0],
              { canDelete: true }
            );

            res.json({ file: updatedTemplate });
            return;
          } catch (error) {
            try {
              await client.query('ROLLBACK');
            } catch (rollbackError) {
              console.warn(
                'Failed to rollback template replace transaction',
                rollbackError
              );
            }
            await deleteUploadedObject();
            console.error('Replace template file error', error);
            res.status(500).json({ error: 'Failed to replace template file' });
            return;
          } finally {
            client.release();
          }
        }

        const id = randomUUID();

        await pool.query(
          `
            INSERT INTO template_files (
              id,
              object_key,
              file_name,
              content_type,
              size_bytes,
              uploaded_by
            ) VALUES ($1, $2, $3, $4, $5, $6);
          `,
          [id, objectKey, displayFileName, contentType, file.size, req.userId]
        );

        const result = await pool.query<TemplateFileRow>(
          `
            SELECT
              tf.id,
              tf.object_key,
              tf.file_name,
              tf.content_type,
              tf.size_bytes,
              tf.uploaded_by,
              tf.uploaded_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM template_files tf
            LEFT JOIN users u ON u.id = tf.uploaded_by
            WHERE tf.id = $1;
          `,
          [id]
        );

        const newFile = mapTemplateFileRow(result.rows[0], {
          canDelete: true
        });

        res.status(201).json({ file: newFile });
      } catch (error) {
        await deleteUploadedObject();
        console.error('Failed to upload template file', error);
        res.status(500).json({ error: 'Failed to upload template file' });
      }
    }
  );

  router.delete(
    '/:templateId',
    requireAdmin,
    async (req: TemplateFilesRequest, res: Response) => {
      const { templateId } = req.params;

      if (!templateId) {
        res.status(400).json({ error: 'Template ID is required' });
        return;
      }

      try {
        const result = await pool.query<{
          object_key: string;
        }>(
          `
            SELECT object_key
            FROM template_files
            WHERE id = $1;
          `,
          [templateId]
        );

        const fileRow = result.rows[0];

        if (!fileRow) {
          res.status(404).json({ error: 'Template file not found' });
          return;
        }

        const versions = await pool.query<{ object_key: string }>(
          `
            SELECT object_key
            FROM template_file_versions
            WHERE template_id = $1;
          `,
          [templateId]
        );

        try {
          await deleteObject(getTemplateBucket(), fileRow.object_key);
        } catch (error) {
          console.warn(
            `Failed to delete template file object "${fileRow.object_key}" from storage`,
            error
          );
        }

        for (const version of versions.rows) {
          try {
            await deleteObject(getTemplateBucket(), version.object_key);
          } catch (error) {
            console.warn(
              `Failed to delete template file version object "${version.object_key}" from storage`,
              error
            );
          }
        }

        await pool.query(`DELETE FROM template_files WHERE id = $1;`, [
          templateId
        ]);

        res.status(204).send();
      } catch (error) {
        console.error('Failed to delete template file', error);
        res.status(500).json({ error: 'Failed to delete template file' });
      }
    }
  );

  router.get(
    '/:templateId/download',
    async (req: TemplateFilesRequest, res: Response) => {
      const { templateId } = req.params;

      if (!templateId) {
        res.status(400).json({ error: 'Template ID is required' });
        return;
      }

      try {
        const result = await pool.query<TemplateFileRow>(
          `
            SELECT
              tf.id,
              tf.object_key,
              tf.file_name,
              tf.content_type,
              tf.size_bytes,
              tf.uploaded_by,
              tf.uploaded_at,
              u.first_name AS uploaded_by_first_name,
              u.last_name AS uploaded_by_last_name,
              u.email AS uploaded_by_email
            FROM template_files tf
            LEFT JOIN users u ON u.id = tf.uploaded_by
            WHERE tf.id = $1
            LIMIT 1;
          `,
          [templateId]
        );

        const templateRow = result.rows[0];

        if (!templateRow) {
          res.status(404).json({ error: 'Template file not found' });
          return;
        }

        const stream = await getObjectStream(
          getTemplateBucket(),
          templateRow.object_key
        );

        const contentType =
          templateRow.content_type ??
          determineContentType(
            path.extname(templateRow.file_name).toLowerCase(),
            ''
          );

        res.setHeader('Content-Type', contentType);
        res.setHeader(
          'Content-Disposition',
          buildContentDisposition(templateRow.file_name)
        );

        if (templateRow.size_bytes !== null) {
          res.setHeader('Content-Length', String(templateRow.size_bytes));
        }

        stream.on('error', (error) => {
          console.error('Stream error while downloading template file', error);
          if (!res.headersSent) {
            res.status(500).end('Failed to download template file');
          } else {
            res.end();
          }
        });

        stream.pipe(res);
      } catch (error) {
        console.error('Failed to download template file', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download template file' });
        } else {
          res.end();
        }
      }
    }
  );

  router.get(
    '/:templateId/versions',
    async (req: TemplateFilesRequest, res: Response) => {
      const { templateId } = req.params;

      if (!templateId) {
        res.status(400).json({ error: 'Template ID is required' });
        return;
      }

      try {
        const result = await pool.query<TemplateFileVersionRow>(
          `
            SELECT
              v.id,
              v.template_id,
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
            FROM template_file_versions v
            LEFT JOIN users u ON u.id = v.uploaded_by
            WHERE v.template_id = $1
            ORDER BY v.version_number DESC;
          `,
          [templateId]
        );

        const versions = result.rows.map(mapTemplateFileVersionRow);
        res.json({ versions });
      } catch (error) {
        console.error('Failed to list template versions', error);
        res.status(500).json({ error: 'Failed to load template versions' });
      }
    }
  );

  router.get(
    '/:templateId/versions/:versionId/download',
    async (req: TemplateFilesRequest, res: Response) => {
      const { templateId, versionId } = req.params as {
        templateId: string;
        versionId: string;
      };

      if (!templateId || !versionId) {
        res
          .status(400)
          .json({ error: 'Template ID and version ID are required' });
        return;
      }

      try {
        const result = await pool.query<TemplateFileVersionRow>(
          `
            SELECT
              v.id,
              v.template_id,
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
            FROM template_file_versions v
            LEFT JOIN users u ON u.id = v.uploaded_by
            WHERE v.template_id = $1 AND v.id = $2
            LIMIT 1;
          `,
          [templateId, versionId]
        );

        const versionRow = result.rows[0];

        if (!versionRow) {
          res.status(404).json({ error: 'Template version not found' });
          return;
        }

        const stream = await getObjectStream(
          getTemplateBucket(),
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
            'Stream error while downloading template version',
            error
          );
          if (!res.headersSent) {
            res.status(500).end('Failed to download template version');
          } else {
            res.end();
          }
        });

        stream.pipe(res);
      } catch (error) {
        console.error('Failed to download template version', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download template version' });
        } else {
          res.end();
        }
      }
    }
  );

  router.delete(
    '/:templateId/versions/:versionId',
    requireAdmin,
    async (req: TemplateFilesRequest, res: Response) => {
      const { templateId, versionId } = req.params as {
        templateId: string;
        versionId: string;
      };

      if (!templateId || !versionId) {
        res
          .status(400)
          .json({ error: 'Template ID and version ID are required' });
        return;
      }

      try {
        const result = await pool.query<{
          object_key: string;
        }>(
          `
            SELECT object_key
            FROM template_file_versions
            WHERE template_id = $1 AND id = $2
            LIMIT 1;
          `,
          [templateId, versionId]
        );

        const versionRow = result.rows[0];

        if (!versionRow) {
          res.status(404).json({ error: 'Template version not found' });
          return;
        }

        try {
          await deleteObject(getTemplateBucket(), versionRow.object_key);
        } catch (error) {
          console.warn(
            `Failed to delete template version object "${versionRow.object_key}" from storage`,
            error
          );
        }

        await pool.query(
          `DELETE FROM template_file_versions WHERE template_id = $1 AND id = $2;`,
          [templateId, versionId]
        );

        res.status(204).send();
      } catch (error) {
        console.error('Failed to delete template version', error);
        res.status(500).json({ error: 'Failed to delete template version' });
      }
    }
  );

  return router;
})();
