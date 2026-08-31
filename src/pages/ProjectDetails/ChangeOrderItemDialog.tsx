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
  sapNumber: string;
  descriptionEn: string;
  descriptionDe: string;
  dimensionMm: string;
  material: string;
  weightKg: string;
  clearDescription: string;
  unitPrice: string;
  countryOfOrigin: string;
  hsCode: string;
  tagNo: string;
  drawingNo: string;
  shippingList: string;
  revisionNumber: string;
  clientBarcode: string;
  manufacturer: string;
  manufacturerPartNo: string;
  acsBarcode: string;
  remarks: string;
};

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
  sapNumber: value(item.sapNumber),
  descriptionEn: item.descriptionEn,
  descriptionDe: value(item.descriptionDe),
  dimensionMm: value(item.dimensionMm),
  material: value(item.material),
  weightKg: value(item.weightKg),
  clearDescription: value(item.clearDescription),
  unitPrice: value(item.unitPrice),
  countryOfOrigin: value(item.countryOfOrigin),
  hsCode: value(item.hsCode),
  tagNo: value(item.tagNo),
  drawingNo: value(item.drawingNo),
  shippingList: value(item.shippingList),
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

const parseOptionalNumber = (input: string, label: string): number | null => {
  if (input.trim() === '') return null;
  return parseRequiredNumber(input, label);
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
    if (!form.descriptionEn.trim()) {
      setError('Description (EN) is required');
      return;
    }
    try {
      const inherited = item?.lineKind === 'inherited';
      const minimumOrderManaged = Boolean(item?.minimumOrderQuantity && item.orderMeasurement);
      const update: ChangeOrderItemUpdate = {
        ...(inherited
          ? {}
          : {
              designQuantity: parseRequiredNumber(form.designQuantity, 'Design quantity'),
              orderQuantity: parseRequiredNumber(form.orderQuantity, 'Order quantity'),
              unit: nullable(form.unit),
              revisionNumber: nullable(form.revisionNumber),
            }),
        ...(minimumOrderManaged
          ? {}
          : {
              packaging: nullable(form.packaging),
              packagingQuantity: parseOptionalNumber(form.packagingQuantity, 'Packaging quantity'),
              packagingUnit: nullable(form.packagingUnit),
              orderedQuantity: parseOptionalNumber(form.orderedQuantity, 'Ordered quantity'),
              orderedUnit: nullable(form.orderedUnit),
            }),
        sapNumber: nullable(form.sapNumber),
        descriptionEn: form.descriptionEn.trim(),
        descriptionDe: nullable(form.descriptionDe),
        dimensionMm: nullable(form.dimensionMm),
        material: nullable(form.material),
        weightKg: parseOptionalNumber(form.weightKg, 'Weight'),
        clearDescription: nullable(form.clearDescription),
        unitPrice: parseRequiredNumber(form.unitPrice, 'Unit price'),
        countryOfOrigin: nullable(form.countryOfOrigin),
        hsCode: nullable(form.hsCode),
        tagNo: nullable(form.tagNo),
        drawingNo: nullable(form.drawingNo),
        shippingList: nullable(form.shippingList),
        clientBarcode: nullable(form.clientBarcode),
        manufacturer: nullable(form.manufacturer),
        manufacturerPartNo: nullable(form.manufacturerPartNo),
        acsBarcode: nullable(form.acsBarcode),
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
          (item?.lineKind === 'inherited' &&
            (field === 'designQuantity' ||
              field === 'orderQuantity' ||
              field === 'unit' ||
              field === 'revisionNumber')) ||
          (Boolean(item?.minimumOrderQuantity) &&
            [
              'packaging',
              'packagingQuantity',
              'packagingUnit',
              'orderedQuantity',
              'orderedUnit',
            ].includes(field))
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
              {input('descriptionDe', 'Description (DE)')}
              {input('designQuantity', 'Design Qty', 'number')}
              {input('orderQuantity', 'Order Qty', 'number')}
              {input('unit', 'Unit')}
              {input('unitPrice', 'Price/pcs', 'number')}
              {input('packaging', 'Packaging')}
              {input('packagingQuantity', 'Packaging Qty', 'number')}
              {input('packagingUnit', 'Packaging Unit')}
              {input('orderedQuantity', 'Ordered Qty', 'number')}
              {input('orderedUnit', 'Ordered Unit')}
              {input('weightKg', 'Weight [kg]', 'number')}
              {input('sapNumber', 'SAP number')}
              {input('dimensionMm', 'Dimension [mm]')}
              {input('material', 'Material')}
              {input('manufacturer', 'Manufacturer')}
              {input('manufacturerPartNo', 'Manufacturer Part No.')}
              {input('countryOfOrigin', 'Country of origin')}
              {input('hsCode', 'HS Code')}
              {input('tagNo', 'Pos./TAG-No')}
              {input('drawingNo', 'Drawing No.')}
              {input('shippingList', 'Shipping list')}
              {input('revisionNumber', 'Revision number')}
              {input('clientBarcode', 'Client Barcode')}
              {input('acsBarcode', 'ACS barcode')}
              <Field label="Clear description" className={styles.wide}>
                <Textarea
                  resize="vertical"
                  value={form?.clearDescription ?? ''}
                  onChange={(_, data) => set('clearDescription', data.value)}
                />
              </Field>
              <Field label="Remarks" className={styles.wide}>
                <Textarea
                  resize="vertical"
                  value={form?.remarks ?? ''}
                  onChange={(_, data) => set('remarks', data.value)}
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
