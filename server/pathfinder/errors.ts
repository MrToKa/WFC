export class PathFinderError extends Error {
  constructor(public readonly code: string, public readonly status = 400, message = code) {
    super(message); this.name = 'PathFinderError';
  }
}
