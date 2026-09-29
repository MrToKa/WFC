import { useMemo } from 'react';

import {
  Body1,
  Button,
  Dropdown,
  Field,
  Option,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';

import type { FilterableTableSectionStyles } from '../ProjectDetails.styles';

const useStyles = makeStyles({
  singleRow: {
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
  },
  rowsPerPageField: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '0.5rem',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
});

type TablePaginationProps = {
  styles: Pick<FilterableTableSectionStyles, 'pagination' | 'paginationDropdown'>;
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
  onPageSelect: (page: number) => void;
  dropdownAriaLabel: string;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
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
  pageSize,
  onPageSizeChange,
}: TablePaginationProps) => {
  const localStyles = useStyles();
  const pageOptions = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages],
  );

  return (
    <div
      className={mergeClasses(styles.pagination, pageSize !== undefined && localStyles.singleRow)}
    >
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
      {pageSize !== undefined && onPageSizeChange ? (
        <Field
          className={localStyles.rowsPerPageField}
          label="Rows per page"
          orientation="horizontal"
        >
          <Dropdown
            className={styles.paginationDropdown}
            size={buttonSize}
            selectedOptions={[String(pageSize)]}
            value={String(pageSize)}
            onOptionSelect={(_, data) => onPageSizeChange(Number(data.optionValue))}
          >
            {[10, 25, 50, 100].map((size) => (
              <Option key={size} value={String(size)}>
                {String(size)}
              </Option>
            ))}
          </Dropdown>
        </Field>
      ) : null}
    </div>
  );
};
