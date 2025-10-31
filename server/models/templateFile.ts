export type TemplateFileRow = {
  id: string;
  object_key: string;
  file_name: string;
  content_type: string | null;
  size_bytes: string | number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  uploaded_by_first_name: string | null;
  uploaded_by_last_name: string | null;
  uploaded_by_email: string | null;
};

export type PublicTemplateFile = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  canDelete: boolean;
};

export const mapTemplateFileRow = (
  row: TemplateFileRow,
  options?: { canDelete?: boolean }
): PublicTemplateFile => ({
  id: row.id,
  fileName: row.file_name,
  contentType: row.content_type ?? null,
  sizeBytes: row.size_bytes === null ? 0 : Number(row.size_bytes),
  uploadedAt: row.uploaded_at,
  uploadedBy: row.uploaded_by
    ? {
        id: row.uploaded_by,
        firstName: row.uploaded_by_first_name,
        lastName: row.uploaded_by_last_name,
        email: row.uploaded_by_email
      }
    : null,
  canDelete: options?.canDelete ?? false
});
