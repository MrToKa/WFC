export type PaginationMeta = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type ApiErrorPayload =
  | string
  | {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
    };

export type ExcelImportIssue = {
  row: number;
  column: string;
  message: string;
};

export type ExcelImportSummary = {
  inserted?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  imported?: number;
  importedPoints?: number;
  issues?: ExcelImportIssue[];
  totalIssues?: number;
};
