import { useMemo } from 'react';

import { Body1, Button, Dropdown, Option } from '@fluentui/react-components';

import type { FilterableTableSectionStyles } from '../ProjectDetails.styles';

type TablePaginationProps = {
  styles: FilterableTableSectionStyles;
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
  onPageSelect: (page: number) => void;
  dropdownAriaLabel: string;
  buttonSize?: 'small' | 'medium' | 'large';
};

export const TablePagination = ({
  styles,
  page,
  totalPages,
  onPrevious,
  onNext,
  onPageSelect,
  dropdownAriaLabel,
  buttonSize = 'small',
}: TablePaginationProps) => {
  const pageOptions = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages],
  );

  return (
    <div className={styles.pagination}>
      <Button size={buttonSize} onClick={onPrevious} disabled={page === 1}>
        Previous
      </Button>
      <Dropdown
        className={styles.paginationDropdown}
        size={buttonSize}
        selectedOptions={[String(page)]}
        value={`Page ${page}`}
        aria-label={dropdownAriaLabel}
        onOptionSelect={(_, data) => {
          const nextPage = Number(data.optionValue);
          if (Number.isInteger(nextPage)) {
            onPageSelect(nextPage);
          }
        }}
      >
        {pageOptions.map((pageOption) => (
          <Option key={pageOption} value={String(pageOption)} text={`Page ${pageOption}`}>
            Page {pageOption}
          </Option>
        ))}
      </Dropdown>
      <Body1>of {totalPages}</Body1>
      <Button size={buttonSize} onClick={onNext} disabled={page === totalPages}>
        Next
      </Button>
    </div>
  );
};
