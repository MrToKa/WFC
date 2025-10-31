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
  params: { templateId?: string };
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

const buildObjectKey = (originalFileName: string): string => {
  const extension = path.extname(originalFileName).toLowerCase();
  const nameWithoutExt = path.basename(originalFileName, extension);
  const sanitizedBase = sanitizeObjectFileName(nameWithoutExt);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `templates/${timestamp}-${randomUUID()}-${
    sanitizedBase || 'template'
  }${extension}`;
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

      try {
        await uploadObject({
          bucket: getTemplateBucket(),
          objectKey,
          data: file.buffer,
          size: file.size,
          contentType
        });

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

        try {
          await deleteObject(getTemplateBucket(), fileRow.object_key);
        } catch (error) {
          console.warn(
            `Failed to delete template file object "${fileRow.object_key}" from storage`,
            error
          );
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
            WHERE tf.id = $1;
          `,
          [templateId]
        );

        const fileRow = result.rows[0];

        if (!fileRow) {
          res.status(404).json({ error: 'Template file not found' });
          return;
        }

        const stream = await getObjectStream(
          getTemplateBucket(),
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

  return router;
})();
