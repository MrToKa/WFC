import { ApiError } from '@/api/http';
import type { ExcelImportIssue, ExcelImportSummary } from '@/api/types';

type ImportFeedback = {
  title: string;
  body: string;
  intent: 'success' | 'warning' | 'error';
  timeout: number;
};

const formatIssues = (issues: ExcelImportIssue[] = [], total = issues.length): string => {
  const displayed = issues.slice(0, 3);
  const lines = displayed.map(({ row, column, message }) => `Row ${row}, ${column}: ${message}`);
  const remaining = Math.max(total, issues.length) - displayed.length;
  if (remaining > 0) lines.push(`${remaining} more ${remaining === 1 ? 'issue' : 'issues'} found.`);
  return lines.join('\n');
};

export const excelImportErrorToast = (error: unknown, fileName: string): ImportFeedback => {
  const apiError = error instanceof ApiError ? error : undefined;
  const details = apiError?.message;
  const validationFailure = apiError?.status === 400 || apiError?.status === 413;
  if (apiError?.summary && /imported but failed to refresh/i.test(details ?? '')) {
    const saved = excelImportSuccessToast(fileName, apiError.summary, 'Rows');
    return {
      title: 'Import saved; refresh failed',
      body: [
        saved.body.split('\n')[0],
        details,
        'Refresh the page to see the imported data before uploading this workbook again.',
      ].join('\n'),
      intent: 'warning',
      timeout: 20000,
    };
  }
  let guidance =
    'Check your connection and try again. If the problem continues, contact an administrator.';
  if (validationFailure) guidance = 'Correct the workbook and upload the .xlsx file again.';
  if (apiError?.status === 400 && /correct[\s\S]*upload/i.test(details ?? '')) guidance = '';
  if (apiError?.status === 401) guidance = 'Sign in again, then upload the workbook.';
  if (apiError?.status === 403)
    guidance = 'Ask an administrator for permission to import this workbook.';
  if (apiError?.status === 404)
    guidance = 'Refresh the page and check that this item still exists before trying again.';
  if (apiError?.status === 413)
    guidance = 'Reduce the workbook to 5 MB or less, then upload it again.';
  if (!apiError && error instanceof Error && /JSON|response/i.test(error.message)) {
    guidance =
      'The server returned an unreadable response. Refresh the list to check whether the import completed before trying again.';
  }
  return {
    title: validationFailure ? 'Excel import rejected' : 'Excel import failed',
    body: [
      `"${fileName}"`,
      details || 'The workbook could not be uploaded or its response could not be read.',
      formatIssues(apiError?.issues, apiError?.totalIssues),
      guidance,
    ]
      .filter(Boolean)
      .join('\n'),
    intent: 'error',
    timeout: 20000,
  };
};

export const excelImportSuccessToast = (
  fileName: string,
  summary: ExcelImportSummary,
  itemLabel: string,
): ImportFeedback => {
  const added = summary.inserted ?? summary.created ?? 0;
  const updated = summary.updated ?? 0;
  const skipped = summary.skipped ?? 0;
  const replacementCount = summary.imported ?? summary.importedPoints;
  const imported = replacementCount ?? added + updated;
  const warning = imported === 0 || skipped > 0;
  const counts =
    replacementCount === undefined
      ? `${added} added, ${updated} updated, ${skipped} skipped.`
      : `${replacementCount} imported.`;
  return {
    title:
      imported === 0
        ? 'No rows imported'
        : skipped > 0
          ? 'Excel import completed with skipped rows'
          : 'Excel import complete',
    body: [
      `"${fileName}" — ${itemLabel}: ${counts}`,
      formatIssues(summary.issues, summary.totalIssues),
      imported === 0
        ? 'Check that the workbook contains data rows and the required template columns, then upload it again.'
        : skipped > 0
          ? 'Review the skipped rows, correct their values and upload them again.'
          : '',
    ]
      .filter(Boolean)
      .join('\n'),
    intent: warning ? 'warning' : 'success',
    timeout: warning ? 20000 : 8000,
  };
};
