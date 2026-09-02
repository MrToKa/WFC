import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { ChangeOrderItem, ChangeOrderItemUpdate } from '@/api/client';

type FormState = {
  designQuantity: string;
  orderQuantity: string;
  unit: string;
  packaging: string;
  packagingQuantity: string;
  packagingUnit: string;
  orderedQuantity: string;
  orderedUnit: string;
  descriptionEn: string;
  dimensionMm: string;
  material: string;
  weightKg: string;
  clearDescription: string;
  unitPrice: string;
  countryOfOrigin: string;
  tagNo: string;
  drawingNo: string;
  revisionNumber: string;
  clientBarcode: string;
  manufacturer: string;
  manufacturerPartNo: string;
  acsBarcode: string;
  remarks: string;
};

const EDITABLE_FIELDS: ReadonlySet<keyof FormState> = new Set([
  'designQuantity',
  'orderQuantity',
  'unitPrice',
  'countryOfOrigin',
  'tagNo',
  'drawingNo',
  'revisionNumber',
  'remarks',
]);

const useStyles = makeStyles({
  surface: {
    width: 'min(1000px, 96vw)',
    maxWidth: '1000px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
  },
  wide: {
    gridColumn: '1 / -1',
  },
});

const value = (input: string | number | null): string => (input === null ? '' : String(input));

const toForm = (item: ChangeOrderItem): FormState => ({
  designQuantity: value(item.designQuantity),
  orderQuantity: value(item.orderQuantity),
  unit: value(item.unit),
  packaging: value(item.packaging),
  packagingQuantity: value(item.packagingQuantity),
  packagingUnit: value(item.packagingUnit),
  orderedQuantity: value(item.orderedQuantity),
  orderedUnit: value(item.orderedUnit),
  descriptionEn: item.descriptionEn,
  dimensionMm: value(item.dimensionMm),
  material: value(item.material),
  weightKg: value(item.weightKg),
  clearDescription: value(item.clearDescription),
  unitPrice: value(item.unitPrice),
  countryOfOrigin: value(item.countryOfOrigin),
  tagNo: value(item.tagNo),
  drawingNo: value(item.drawingNo),
  revisionNumber: value(item.revisionNumber),
  clientBarcode: value(item.clientBarcode),
  manufacturer: value(item.manufacturer),
  manufacturerPartNo: value(item.manufacturerPartNo),
  acsBarcode: value(item.acsBarcode),
  remarks: value(item.remarks),
});

const parseRequiredNumber = (input: string, label: string): number => {
  const number = Number(input);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return number;
};

const nullable = (input: string): string | null => input.trim() || null;

type Props = {
  item: ChangeOrderItem | null;
  saving: boolean;
  documentName?: string;
  onDismiss: () => void;
  onSave: (update: ChangeOrderItemUpdate) => Promise<void>;
};

export const ChangeOrderItemDialog = ({
  item,
  saving,
  documentName = 'Change Order',
  onDismiss,
  onSave,
}: Props) => {
  const styles = useStyles();
  const [form, setForm] = useState<FormState | null>(item ? toForm(item) : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(item ? toForm(item) : null);
    setError(null);
  }, [item]);

  const set = (field: keyof FormState, next: string): void => {
    setForm((current) => (current ? { ...current, [field]: next } : current));
  };

  const submit = async (): Promise<void> => {
    if (!form) return;
    try {
      const inherited = item?.lineKind === 'inherited';
      const update: ChangeOrderItemUpdate = {
        ...(inherited
          ? {}
          : {
              designQuantity: parseRequiredNumber(form.designQuantity, 'Design quantity'),
              orderQuantity: parseRequiredNumber(form.orderQuantity, 'Order quantity'),
              revisionNumber: nullable(form.revisionNumber),
            }),
        unitPrice: parseRequiredNumber(form.unitPrice, 'Price'),
        countryOfOrigin: nullable(form.countryOfOrigin),
        tagNo: nullable(form.tagNo),
        drawingNo: nullable(form.drawingNo),
        remarks: nullable(form.remarks),
      };
      setError(null);
      await onSave(update);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save item');
    }
  };

  const input = (field: keyof FormState, label: string, type: 'text' | 'number' = 'text') => (
    <Field label={label}>
      <Input
        type={type}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 'any' : undefined}
        value={form?.[field] ?? ''}
        onChange={(_, data) => set(field, data.value)}
        disabled={
          saving ||
          !EDITABLE_FIELDS.has(field) ||
          (item?.lineKind === 'inherited' &&
            (field === 'designQuantity' ||
              field === 'orderQuantity' ||
              field === 'revisionNumber'))
        }
      />
    </Field>
  );

  const orderBelowDesign =
    form !== null &&
    Number.isFinite(Number(form.orderQuantity)) &&
    Number.isFinite(Number(form.designQuantity)) &&
    Number(form.orderQuantity) < Number(form.designQuantity);

  return (
    <Dialog open={item !== null} onOpenChange={(_, data) => !data.open && onDismiss()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Edit {documentName} item</DialogTitle>
          <DialogContent>
            {error ? (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            ) : null}
            {orderBelowDesign ? (
              <MessageBar intent="warning">
                <MessageBarBody>
                  Order quantity is lower than design quantity; spare quantity will be negative.
                </MessageBarBody>
              </MessageBar>
            ) : null}
            {item?.minimumOrderQuantity && item.orderMeasurement ? (
              <MessageBar intent="info">
                <MessageBarBody>
                  Packaging: {item.packaging ?? '—'} × {item.minimumOrderQuantity}{' '}
                  {item.orderMeasurement}. Ordered Qty and Spare Qty are calculated automatically
                  from Order Qty.
                </MessageBarBody>
              </MessageBar>
            ) : null}
            <div className={styles.grid}>
              {input('descriptionEn', 'Description (EN)')}
              {input('designQuantity', 'Design Qty', 'number')}
              {input('orderQuantity', 'Order Qty', 'number')}
              {input('unit', 'Unit')}
              {input('unitPrice', 'Price', 'number')}
              {input('packaging', 'Packaging')}
              {input('packagingQuantity', 'Packaging Qty', 'number')}
              {input('packagingUnit', 'Packaging Unit')}
              {input('orderedQuantity', 'Ordered Qty', 'number')}
              {input('orderedUnit', 'Ordered Unit')}
              {input('weightKg', 'Weight [kg]', 'number')}
              {input('dimensionMm', 'Dimension [mm]')}
              {input('material', 'Material')}
              {input('manufacturer', 'Manufacturer')}
              {input('manufacturerPartNo', 'Manufacturer Part No.')}
              {input('countryOfOrigin', 'Country of origin')}
              {input('tagNo', 'Pos./TAG-No')}
              {input('drawingNo', 'Drawing No.')}
              {input('revisionNumber', 'Revision number')}
              {input('clientBarcode', 'Client Barcode')}
              {input('acsBarcode', 'ACS barcode')}
              <Field label="Clear description" className={styles.wide}>
                <Textarea
                  resize="vertical"
                  value={form?.clearDescription ?? ''}
                  disabled
                />
              </Field>
              <Field label="Remarks" className={styles.wide}>
                <Textarea
                  resize="vertical"
                  value={form?.remarks ?? ''}
                  onChange={(_, data) => set('remarks', data.value)}
                  disabled={saving}
                />
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss} disabled={saving}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={() => void submit()} disabled={saving}>
              {saving ? 'Saving…' : 'Save item'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
