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
