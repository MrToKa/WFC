export class PathFinderError extends Error {
  constructor(public readonly code: string, public readonly status = 400, message = code) {
    super(message); this.name = 'PathFinderError';
  }
}
export class CadTrayCatalogConflict extends PathFinderError {
  constructor(readonly tray: string, readonly fields: string[]) {
    super('CAD_ROUTE_CATALOG_CHANGED', 409, `Published CAD route ${tray} differs from Trays (${fields.join(', ')}).`);
  }
}
