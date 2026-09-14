export type User = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  role?: 'basic' | 'technician' | 'admin';
  createdAt: string;
  updatedAt: string;
};

export type FileUploader = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export type AuthSuccess = {
  user: User;
  token: string;
  expiresInSeconds: number;
};
