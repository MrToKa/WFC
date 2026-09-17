import * as XLSX from 'xlsx';
import type { ChangeLogEntry } from '@/components/ChangeLogTable';

type Options = { fileName: string; showItem?: boolean; showRevision?: boolean };

export const buildChangeLogWorkbook = (entries: ChangeLogEntry[], options: Options) => {
  const { showItem, showRevision } = options;
  const rows = [
    [
      ...(showItem ? ['Item'] : []),
      'Who',
      'When',
      ...(showRevision ? ['Revision'] : []),
      'Changes',
    ],
    ...entries.map((entry) => [
      ...(showItem ? [entry.name ?? ''] : []),
      entry.userName,
      entry.changedAt,
      ...(showRevision ? [entry.revision ?? ''] : []),
      entry.changes.join('\n'),
    ]),
  ];
  // aoa_to_sheet writes strings as text, including values starting with '='.
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0].map((heading) => ({ wch: heading === 'Changes' ? 100 : 28 }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Change log');
  return workbook;
};

export const exportChangeLog = (entries: ChangeLogEntry[], options: Options) => {
  const fileName = options.fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 160);
  XLSX.writeFile(buildChangeLogWorkbook(entries, options), `${fileName}.xlsx`, {
    compression: true,
  });
};
