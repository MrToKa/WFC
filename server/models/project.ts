export type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  customer: string;
  manager: string | null;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PublicProject = {
  id: string;
  projectNumber: string;
  name: string;
  customer: string;
  manager: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapProjectRow = (row: ProjectRow): PublicProject => ({
  id: row.id,
  projectNumber: row.project_number,
  name: row.name,
  customer: row.customer,
  manager: row.manager ?? null,
  description: row.description ?? null,
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});
