import path from 'node:path';
import type { RequestHandler } from 'express';
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('file');

/** Keep upload failures in the JSON format used by the import Snackbar. */
export const uploadExcelFile: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error) {
      const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({
        error: tooLarge
          ? 'The Excel file exceeds the 5 MB limit. Split it into smaller workbooks and upload again.'
          : 'The file upload could not be read. Select one .xlsx file and upload it again.',
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Select an .xlsx workbook to import.' });
      return;
    }
    if (path.extname(req.file.originalname).toLowerCase() !== '.xlsx') {
      res
        .status(400)
        .json({
          error:
            'Only .xlsx workbooks are supported. Save the file as an Excel Workbook (.xlsx) and upload it again.',
        });
      return;
    }
    // SheetJS also reads CSV/HTML/plain text; a renamed text file is not an XLSX workbook.
    if (!req.file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      res
        .status(400)
        .json({
          error:
            'The file is not a valid .xlsx workbook. Open it in Excel and save it as an Excel Workbook (.xlsx), then upload it again.',
        });
      return;
    }
    next();
  });
};
