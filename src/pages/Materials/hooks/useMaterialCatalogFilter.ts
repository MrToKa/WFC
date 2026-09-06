import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MaterialSupport, MaterialTray, PaginationMeta } from '@/api/client';
import { PAGE_SIZE } from '../Materials.types';

export type MaterialCatalogSearchCriteria =
  | 'all'
  | 'type'
  | 'manufacturer'
  | 'height'
  | 'rungHeight'
  | 'width'
  | 'length'
  | 'weight'
  | 'loadCurve'
  | 'minimumOrder'
  | 'packaging'
  | 'price';

type CatalogItem = MaterialTray | MaterialSupport;

const getSearchValues = (
  item: CatalogItem,
): Record<Exclude<MaterialCatalogSearchCriteria, 'all'>, string | number | null> => ({
  type: item.type,
  manufacturer: item.manufacturer,
  height: item.heightMm,
  rungHeight: 'rungHeightMm' in item ? item.rungHeightMm : null,
  width: item.widthMm,
  length: 'lengthMm' in item ? item.lengthMm : null,
  weight: 'weightKgPerM' in item ? item.weightKgPerM : item.weightKg,
  loadCurve: 'loadCurveName' in item ? item.loadCurveName : null,
  minimumOrder: `${item.minimumOrderQuantity} ${item.orderMeasurement}`,
  packaging: item.packaging,
  price: item.unitPrice,
});

export const useMaterialCatalogFilter = <T extends CatalogItem>(items: T[]) => {
  const [requestedPage, setRequestedPage] = useState(1);
  const [searchText, setSearchTextValue] = useState('');
  const [searchCriteria, setSearchCriteriaValue] = useState<MaterialCatalogSearchCriteria>('all');
  const [manufacturerFilter, setManufacturerFilterValue] = useState('');

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }),
    [],
  );
  const weightFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
    [],
  );

  const manufacturerFilterOptions = useMemo(() => {
    const manufacturers = new Map<string, string>();
    for (const item of items) {
      const manufacturer = item.manufacturer?.trim();
      if (manufacturer) {
        manufacturers.set(manufacturer.toLocaleLowerCase(), manufacturer);
      }
    }
    return [...manufacturers.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    const manufacturer = manufacturerFilter.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (manufacturer && item.manufacturer?.trim().toLocaleLowerCase() !== manufacturer) {
        return false;
      }
      if (!query) return true;
      const fields = getSearchValues(item);
      return Object.entries(fields).some(([field, value]) => {
        if (searchCriteria !== 'all' && field !== searchCriteria) return false;
        if (
          String(value ?? '')
            .toLocaleLowerCase()
            .includes(query)
        )
          return true;
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;

        const formatter = field === 'weight' ? weightFormatter : numberFormatter;
        return formatter.format(value).toLocaleLowerCase().includes(query);
      });
    });
  }, [items, manufacturerFilter, numberFormatter, searchCriteria, searchText, weightFormatter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const pagedItems = useMemo(
    () => filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredItems, page],
  );
  const pagination: PaginationMeta = {
    page,
    pageSize: PAGE_SIZE,
    totalItems: filteredItems.length,
    totalPages,
  };

  useEffect(() => {
    setRequestedPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const setPage = useCallback(
    (nextPage: number) => {
      setRequestedPage(Math.max(1, Math.min(Math.floor(nextPage) || 1, totalPages)));
    },
    [totalPages],
  );

  const setSearchText = useCallback((value: string) => {
    setSearchTextValue(value);
    setRequestedPage(1);
  }, []);

  const setSearchCriteria = useCallback((value: MaterialCatalogSearchCriteria) => {
    setSearchCriteriaValue(value);
    setRequestedPage(1);
  }, []);

  const setManufacturerFilter = useCallback((value: string) => {
    setManufacturerFilterValue(value);
    setRequestedPage(1);
  }, []);

  return {
    pagedItems,
    page,
    pagination,
    setPage,
    showPagination: totalPages > 1,
    searchText,
    searchCriteria,
    manufacturerFilter,
    manufacturerFilterOptions,
    setSearchText,
    setSearchCriteria,
    setManufacturerFilter,
  };
};
