import { Dropdown, Input, Option } from '@fluentui/react-components';
import type { MaterialCatalogSearchCriteria } from '../hooks/useMaterialCatalogFilter';

type MaterialCatalogFiltersProps = {
  className: string;
  catalog: 'trays' | 'supports';
  searchText: string;
  searchCriteria: MaterialCatalogSearchCriteria;
  manufacturerFilter: string;
  manufacturerOptions: string[];
  onSearchTextChange: (value: string) => void;
  onSearchCriteriaChange: (value: MaterialCatalogSearchCriteria) => void;
  onManufacturerFilterChange: (value: string) => void;
};

const criteriaOptions: {
  value: MaterialCatalogSearchCriteria;
  label: string;
  catalog?: 'trays' | 'supports';
}[] = [
  { value: 'all', label: 'All fields' },
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'type', label: 'Type' },
  { value: 'height', label: 'Height [mm]' },
  { value: 'rungHeight', label: 'Rung height [mm]', catalog: 'trays' },
  { value: 'width', label: 'Width [mm]' },
  { value: 'length', label: 'Length [mm]', catalog: 'supports' },
  { value: 'weight', label: 'Weight' },
  { value: 'loadCurve', label: 'Load curve', catalog: 'trays' },
  { value: 'minimumOrder', label: 'Minimum order' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'price', label: 'Price' },
];

export const MaterialCatalogFilters = ({
  className,
  catalog,
  searchText,
  searchCriteria,
  manufacturerFilter,
  manufacturerOptions,
  onSearchTextChange,
  onSearchCriteriaChange,
  onManufacturerFilterChange,
}: MaterialCatalogFiltersProps) => {
  const options = criteriaOptions.filter((option) => !option.catalog || option.catalog === catalog);

  return (
    <div className={className}>
      <Input
        value={searchText}
        placeholder={`Filter ${catalog}`}
        aria-label={`Filter ${catalog}`}
        onChange={(_, data) => onSearchTextChange(data.value)}
      />
      <Dropdown
        selectedOptions={[searchCriteria]}
        value={options.find((option) => option.value === searchCriteria)?.label ?? 'All fields'}
        aria-label="Search criteria"
        onOptionSelect={(_, data) => {
          const option = options.find((candidate) => candidate.value === data.optionValue);
          if (option) onSearchCriteriaChange(option.value);
        }}
      >
        {options.map((option) => (
          <Option key={option.value} value={option.value}>
            {option.label}
          </Option>
        ))}
      </Dropdown>
      <Dropdown
        selectedOptions={manufacturerFilter ? [manufacturerFilter] : []}
        value={manufacturerFilter || 'All manufacturers'}
        aria-label="Filter by manufacturer"
        onOptionSelect={(_, data) => onManufacturerFilterChange(data.optionValue ?? '')}
      >
        <Option value="">All manufacturers</Option>
        {manufacturerOptions.map((manufacturer) => (
          <Option key={manufacturer.toLocaleLowerCase()} value={manufacturer}>
            {manufacturer}
          </Option>
        ))}
      </Dropdown>
    </div>
  );
};
