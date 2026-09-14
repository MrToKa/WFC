declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      isAdmin?: boolean;
      role?: import('../models/user.js').UserRole;
    }
  }
}

export {};
