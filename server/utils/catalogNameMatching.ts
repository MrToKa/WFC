export const normalizeComparableCatalogName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

export const normalizeFlexibleCatalogName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/,/g, '.')
    .replace(/[\[\](){}]/g, '')
    .replace(/[\s\-_.\\/]+/g, '')
    .replace(/[^a-z0-9+]/g, '');

export type NamedCatalogLookup<T extends { name: string }> = {
  byComparableName: Map<string, T>;
  byFlexibleName: Map<string, T>;
};

export const buildNamedCatalogLookup = <T extends { name: string }>(
  rows: T[],
): NamedCatalogLookup<T> => {
  const byComparableName = new Map<string, T>();
  const byFlexibleName = new Map<string, T>();

  for (const row of rows) {
    const comparableName = normalizeComparableCatalogName(row.name);

    if (comparableName !== '' && !byComparableName.has(comparableName)) {
      byComparableName.set(comparableName, row);
    }

    const flexibleName = normalizeFlexibleCatalogName(row.name);

    if (flexibleName !== '' && !byFlexibleName.has(flexibleName)) {
      byFlexibleName.set(flexibleName, row);
    }
  }

  return {
    byComparableName,
    byFlexibleName,
  };
};

export const findNamedCatalogMatch = <T extends { name: string }>(
  lookup: NamedCatalogLookup<T>,
  value: string,
): T | null => {
  const comparableName = normalizeComparableCatalogName(value);

  if (comparableName !== '') {
    const exactMatch = lookup.byComparableName.get(comparableName);

    if (exactMatch) {
      return exactMatch;
    }
  }

  const flexibleName = normalizeFlexibleCatalogName(value);

  if (flexibleName !== '') {
    return lookup.byFlexibleName.get(flexibleName) ?? null;
  }

  return null;
};
