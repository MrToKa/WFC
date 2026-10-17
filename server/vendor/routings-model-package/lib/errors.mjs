export class PackageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PackageError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details = {}) {
  throw new PackageError(code, message, details);
}
