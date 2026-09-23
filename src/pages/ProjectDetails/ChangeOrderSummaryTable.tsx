import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Caption1,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import type { ChangeOrderItem } from '@/api/types/changeOrder';
import { consolidateChangeOrderItems } from '../../../shared/changeOrderSummary';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalM,
  },
  tableWrap: {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: '70vh',
    minWidth: 0,
  },
  table: {
    tableLayout: 'fixed',
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
    verticalAlign: 'bottom',
    ...shorthands.padding('10px', '12px'),
    lineHeight: '20px',
    whiteSpace: 'normal',
  },
  cell: {
    verticalAlign: 'top',
    ...shorthands.padding('8px', '12px'),
    lineHeight: '20px',
    whiteSpace: 'normal',
    overflowWrap: 'break-word',
  },
  numeric: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  noWrap: {
    whiteSpace: 'nowrap',
  },
  number: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  textPreview: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    maxHeight: '60px',
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  },
  expandedText: {
    overflowWrap: 'anywhere',
  },
  expandButton: {
    minWidth: 0,
    ...shorthands.padding('2px', '0'),
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  warning: {
    color: tokens.colorPaletteRedForeground1,
  },
  total: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const quantityFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const weightFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

const SummaryText = ({ text, label }: { text: string; label: string }) => {
  const styles = useStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = (): void => {
      setOverflows(
        element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <>
      <div ref={ref} className={expanded ? styles.expandedText : styles.textPreview}>
        {text}
      </div>
      {overflows ? (
        <Button
          size="small"
          appearance="transparent"
          className={styles.expandButton}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Show all'} ${label}`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
    </>
  );
};

// These quantities mirror the formulas in the exported workbook.
const orderQuantity = (item: ChangeOrderItem): number =>
  (item.packagingQuantity ?? 0) * (item.orderedQuantity ?? 0);
const spareQuantity = (item: ChangeOrderItem): number => orderQuantity(item) - item.designQuantity;

type Column = {
  header: string;
  width: number;
  value: (item: ChangeOrderItem, index: number) => string | number | null;
  numeric?: boolean;
  precision?: 2 | 3;
  warning?: (item: ChangeOrderItem) => boolean;
};

const columns: Column[] = [
  { header: 'Item No.', width: 64, value: (_, index) => index + 1, numeric: true },
  { header: 'Design Qty', width: 104, value: (item) => item.designQuantity, numeric: true },
  { header: 'Order Qty', width: 104, value: orderQuantity, numeric: true },
  {
    header: 'Spare Qty',
    width: 104,
    value: spareQuantity,
    numeric: true,
    warning: (item) => spareQuantity(item) < 0,
  },
  { header: 'Unit', width: 76, value: (item) => item.unit },
  { header: 'Packaging', width: 104, value: (item) => item.packaging },
  { header: 'Packaging Qty', width: 112, value: (item) => item.packagingQuantity, numeric: true },
  { header: 'Unit', width: 76, value: (item) => item.packagingUnit },
  { header: 'Ordered Qty', width: 112, value: (item) => item.orderedQuantity, numeric: true },
  { header: 'Unit', width: 76, value: (item) => item.orderedUnit },
  { header: 'Description (EN)', width: 300, value: (item) => item.descriptionEn },
  { header: 'Dimension [mm]', width: 128, value: (item) => item.dimensionMm },
  { header: 'Material', width: 280, value: (item) => item.material },
  {
    header: 'Weight [kg]',
    width: 104,
    value: (item) => item.weightKg,
    numeric: true,
    precision: 3,
  },
  {
    header: 'Clear description of content of a set and type designation',
    width: 400,
    value: (item) => item.clearDescription,
  },
  {
    header: 'Price/pcs',
    width: 120,
    value: (item) => moneyFormatter.format(item.unitPrice),
    numeric: true,
  },
  {
    header: 'Total Price',
    width: 144,
    value: (item) => moneyFormatter.format(item.totalPrice),
    numeric: true,
  },
  { header: 'Country of origin', width: 128, value: (item) => item.countryOfOrigin },
  { header: 'Pos./TAG-No', width: 240, value: (item) => item.tagNo },
  { header: 'Drawing No.', width: 200, value: (item) => item.drawingNo },
  { header: 'Revision number', width: 96, value: (item) => item.revisionNumber },
  { header: 'Certificates', width: 160, value: (item) => item.clientBarcode },
  { header: 'Original Equipment Manufacturer', width: 200, value: (item) => item.manufacturer },
  { header: 'Manufacturer Part No.', width: 200, value: (item) => item.manufacturerPartNo },
  { header: 'ACS barcode', width: 160, value: (item) => item.acsBarcode },
  { header: 'Remarks', width: 320, value: (item) => item.remarks },
];

// Fluent's fixed table layout needs column widths; min-width on header cells
// alone otherwise leaves all 26 columns equally narrow.
const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

const displayValue = (column: Column, item: ChangeOrderItem, index: number): string => {
  const value = column.value(item, index);
  if (typeof value !== 'number') return value ?? '—';
  const precision = column.precision ?? 2;
  // Format display values only; preserve full precision for Excel and calculations.
  const rounded = Number(value.toFixed(precision));
  return (precision === 3 ? weightFormatter : quantityFormatter).format(
    rounded === 0 ? 0 : rounded,
  );
};

type Props = {
  items: readonly ChangeOrderItem[];
  documentLabel: string;
  canEdit: boolean;
};

export const ChangeOrderSummaryTable = ({ items, documentLabel, canEdit }: Props) => {
  const styles = useStyles();
  const summaryItems = useMemo(() => consolidateChangeOrderItems(items), [items]);
  const total = summaryItems.reduce((sum, item) => sum + item.totalPrice, 0);

  return (
    <div className={styles.root}>
      <Caption1>
        {summaryItems.length} summary {summaryItems.length === 1 ? 'row' : 'rows'} from{' '}
        {items.length} material {items.length === 1 ? 'row' : 'rows'}. Materials and quantities are
        grouped as in Excel, including inherited Standard Materials.
        {canEdit ? ' Use Detailed view to edit individual rows.' : ''}
      </Caption1>
      <div className={styles.tableWrap}>
        <Table
          size="small"
          className={styles.table}
          style={{ minWidth: tableWidth }}
          aria-label={`${documentLabel} material summary`}
        >
          <colgroup>
            {columns.map((column, index) => (
              <col key={index} style={{ width: column.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHeaderCell
                  key={index}
                  className={mergeClasses(styles.header, column.numeric && styles.numeric)}
                >
                  {column.header}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {summaryItems.map((item, itemIndex) => (
              <TableRow key={item.id}>
                {columns.map((column, columnIndex) => {
                  const value = displayValue(column, item, itemIndex);
                  return (
                    <TableCell
                      key={columnIndex}
                      className={mergeClasses(
                        styles.cell,
                        column.numeric && styles.numeric,
                        column.numeric && styles.noWrap,
                        column.warning?.(item) && styles.warning,
                      )}
                    >
                      {column.numeric ? (
                        <div className={styles.number} title={value}>
                          {value}
                        </div>
                      ) : (
                        <SummaryText
                          text={value}
                          label={`${column.header} for item ${itemIndex + 1}`}
                        />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            <TableRow className={styles.total}>
              <TableCell colSpan={16} className={styles.numeric}>
                TOTAL:
              </TableCell>
              <TableCell className={mergeClasses(styles.cell, styles.numeric, styles.noWrap)}>
                <div className={styles.number} title={moneyFormatter.format(total)}>
                  {moneyFormatter.format(total)}
                </div>
              </TableCell>
              <TableCell colSpan={9} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
