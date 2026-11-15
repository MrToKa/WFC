export class TrayAutoLengthError extends Error {
  readonly status: number;
  constructor(public readonly code: string, message: string, status = 409) {
    super(message); this.name = 'TrayAutoLengthError'; this.status = status;
  }
}
