import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/http';
import { excelImportErrorToast, excelImportSuccessToast } from './excelImportFeedback';

describe('Excel import Snackbar', () => {
  it('identifies the workbook, affected cells and how to retry without hiding the server error', () => {
    const error = new ApiError(400, 'Invalid workbook. No data was changed.');
    error.issues = [
      { row: 4, column: 'Name', message: 'Required.' },
      { row: 8, column: 'Price', message: 'Must be a non-negative number.' },
    ];
    const toast = excelImportErrorToast(error, 'materials.xlsx');
    expect(toast.intent).toBe('error');
    expect(toast.body).toContain('"materials.xlsx"');
    expect(toast.body).toContain('Invalid workbook. No data was changed.');
    expect(toast.body).toContain('Row 4, Name: Required.');
    expect(toast.body).toContain('Row 8, Price: Must be a non-negative number.');
    expect(toast.body).toContain('Correct the workbook and upload the .xlsx file again.');
    expect(toast.timeout).toBeGreaterThanOrEqual(20000);
  });

  it('keeps large error reports readable while exposing the total number of remaining issues', () => {
    const error = new ApiError(400, 'Invalid workbook.');
    error.issues = Array.from({ length: 100 }, (_, index) => ({
      row: index + 2,
      column: 'Name',
      message: 'Required.',
    }));
    error.totalIssues = 125;
    const toast = excelImportErrorToast(error, 'materials.xlsx');
    expect(toast.body).toContain('Row 4, Name');
    expect(toast.body).not.toContain('Row 5, Name');
    expect(toast.body).toContain('122 more issues found.');
  });

  it.each([
    [401, 'Sign in again'],
    [403, 'permission to import'],
    [404, 'check that this item still exists'],
    [413, '5 MB or less'],
    [500, 'contact an administrator'],
  ])('provides actionable guidance for HTTP %i', (status, guidance) => {
    const toast = excelImportErrorToast(new ApiError(status, 'Server details'), 'data.xlsx');
    expect(toast.body).toContain('Server details');
    expect(toast.body).toContain(guidance);
    expect(toast.body).not.toContain('restart the API');
  });

  it('explains connection and unreadable-response failures', () => {
    expect(excelImportErrorToast(new TypeError('Failed to fetch'), 'data.xlsx').body).toContain(
      'Check your connection',
    );
    expect(
      excelImportErrorToast(new Error('Received invalid JSON response from API'), 'data.xlsx').body,
    ).toContain('check whether the import completed');
  });

  it('distinguishes a committed import from a failed list refresh', () => {
    const error = new ApiError(500, 'Cable types imported but failed to refresh list');
    error.summary = { inserted: 3, updated: 2, skipped: 0 };
    const toast = excelImportErrorToast(error, 'data.xlsx');
    expect(toast).toMatchObject({ intent: 'warning', title: 'Import saved; refresh failed' });
    expect(toast.body).toContain('3 added, 2 updated, 0 skipped.');
    expect(toast.body).toContain('Refresh the page to see the imported data before uploading');
    expect(toast.body).not.toContain('try again');
  });

  it('avoids repeating correction guidance already provided by the API', () => {
    const error = new ApiError(
      400,
      'Import cancelled. No data was changed. Correct the workbook and upload it again.',
    );
    expect(
      excelImportErrorToast(error, 'data.xlsx').body.match(/Correct the workbook/g),
    ).toHaveLength(1);
  });

  it.each([
    { inserted: 3, updated: 2, skipped: 0 },
    { created: 3, updated: 2, skipped: 0 },
  ])('shows accurate added and updated counts for successful imports', (summary) => {
    const toast = excelImportSuccessToast('data.xlsx', summary, 'Materials');
    expect(toast.intent).toBe('success');
    expect(toast.body).toBe('"data.xlsx" — Materials: 3 added, 2 updated, 0 skipped.');
  });

  it.each([{ imported: 4 }, { importedPoints: 4 }])('reports replacement imports', (summary) => {
    expect(excelImportSuccessToast('data.xlsx', summary, 'Points')).toMatchObject({
      intent: 'success',
      body: '"data.xlsx" — Points: 4 imported.',
    });
  });

  it('warns when only part of the workbook was imported and explains skipped rows', () => {
    const toast = excelImportSuccessToast(
      'data.xlsx',
      {
        inserted: 2,
        updated: 0,
        skipped: 1,
        issues: [{ row: 5, column: 'Name', message: 'Duplicate name.' }],
      },
      'Materials',
    );
    expect(toast.intent).toBe('warning');
    expect(toast.title).toContain('skipped rows');
    expect(toast.body).toContain('2 added, 0 updated, 1 skipped.');
    expect(toast.body).toContain('Row 5, Name: Duplicate name.');
    expect(toast.body).toContain('correct their values');
  });

  it.each([
    { inserted: 0, updated: 0, skipped: 3 },
    { created: 0, updated: 0, skipped: 0 },
    { importedPoints: 0 },
  ])('never reports success when no rows were imported', (summary) => {
    const toast = excelImportSuccessToast('empty.xlsx', summary, 'Materials');
    expect(toast.intent).toBe('warning');
    expect(toast.title).toBe('No rows imported');
    expect(toast.body).toContain('required template columns');
  });
});
