declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      loginId?: string;
      loginExpiresAt?: number;
      isAdmin?: boolean;
      canEditProject?: boolean;
      role?: import('../models/user.js').UserRole;
    }
  }
}

export {};
