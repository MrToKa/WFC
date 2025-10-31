export type TemplateFileVersionRow = {
  id: string;
  template_id: string;
  version_number: number;
  object_key: string;
  file_name: string;
  content_type: string | null;
  size_bytes: string | number | null;
  uploaded_by: string | null;
  created_at: Date | string;
  uploaded_by_first_name: string | null;
  uploaded_by_last_name: string | null;
  uploaded_by_email: string | null;
};

export type PublicTemplateFileVersion = {
  id: string;
  templateId: string;
  versionNumber: number;
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
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export const mapTemplateFileVersionRow = (
  row: TemplateFileVersionRow
): PublicTemplateFileVersion => ({
  id: row.id,
  templateId: row.template_id,
  versionNumber: row.version_number,
  fileName: row.file_name,
  contentType: row.content_type ?? null,
  sizeBytes: row.size_bytes === null ? 0 : Number(row.size_bytes),
  uploadedAt: toIsoString(row.created_at),
  uploadedBy: row.uploaded_by
    ? {
        id: row.uploaded_by,
        firstName: row.uploaded_by_first_name,
        lastName: row.uploaded_by_last_name,
        email: row.uploaded_by_email
      }
    : null
});
