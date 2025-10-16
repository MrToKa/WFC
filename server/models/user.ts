export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PublicUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export const mapUserRow = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name ?? null,
  lastName: row.last_name ?? null,
  isAdmin: row.is_admin,
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});
