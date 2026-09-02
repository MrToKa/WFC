import { useEffect, useState, type FormEvent } from 'react';
import {
  Body1,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ApiError,
  updateMaterialCableInstallationMaterial,
  updateMaterialTrayInstallationMaterial,
  updateMaterialCableType,
  updateMaterialSupport,
  updateMaterialTray,
  type MaterialCableInstallationMaterial,
  type MaterialCableType,
  type MaterialSupport,
  type MaterialTray,
  type StandardMaterialOwner,
  type StandardMaterialOwnerCategory,
} from '@/api/client';

const useStyles = makeStyles({
  content: {
    display: 'grid',
    gap: tokens.spacingVerticalM,
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
  },
});

type FormState = {
  name: string;
  type: string;
  purpose: string;
  material: string;
  description: string;
  manufacturer: string;
  partNo: string;
  remarks: string;
  diameterMm: string;
  dimensionMm: string;
  weightKgPerM: string;
  heightMm: string;
  rungHeightMm: string;
  widthMm: string;
  lengthMm: string;
  weightKg: string;
  minimumOrderQuantity: string;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  source: string;
};

const emptyForm: FormState = {
  name: '',
  type: '',
  purpose: '',
  material: '',
  description: '',
  manufacturer: '',
  partNo: '',
  remarks: '',
  diameterMm: '',
  dimensionMm: '',
  weightKgPerM: '',
  heightMm: '',
  rungHeightMm: '',
  widthMm: '',
  lengthMm: '',
  weightKg: '',
  minimumOrderQuantity: '1',
  orderMeasurement: 'pcs',
  packaging: 'pcs',
  source: '',
};

const numberValue = (value: number | null): string => (value === null ? '' : String(value));
const nullableText = (value: string): string | null => value.trim() || null;

const formFromMaterial = (
  category: StandardMaterialOwnerCategory,
  material: StandardMaterialOwner,
): FormState => {
  const common = {
    ...emptyForm,
    minimumOrderQuantity: String(material.minimumOrderQuantity),
    orderMeasurement: material.orderMeasurement,
    packaging: material.packaging,
    source: material.source ?? '',
  };

  switch (category) {
    case 'cable-type': {
      const item = material as MaterialCableType;
      return {
        ...common,
        name: item.name,
        purpose: item.purpose ?? '',
        material: item.material ?? '',
        description: item.description ?? '',
        manufacturer: item.manufacturer ?? '',
        partNo: item.partNo ?? '',
        remarks: item.remarks ?? '',
        diameterMm: numberValue(item.diameterMm),
        weightKgPerM: numberValue(item.weightKgPerM),
      };
    }
    case 'cable-installation-material':
    case 'tray-installation-material': {
      const item = material as MaterialCableInstallationMaterial;
      return {
        ...common,
        type: item.type,
        purpose: item.purpose ?? '',
        material: item.material ?? '',
        description: item.description ?? '',
        manufacturer: item.manufacturer ?? '',
        partNo: item.partNo ?? '',
        dimensionMm: item.dimensionMm ?? '',
        weightKg: numberValue(item.weightKg),
      };
    }
    case 'tray': {
      const item = material as MaterialTray;
      return {
        ...common,
        type: item.type,
        manufacturer: item.manufacturer ?? '',
        heightMm: numberValue(item.heightMm),
        rungHeightMm: numberValue(item.rungHeightMm),
        widthMm: numberValue(item.widthMm),
        weightKgPerM: numberValue(item.weightKgPerM),
      };
    }
    case 'support': {
      const item = material as MaterialSupport;
      return {
        ...common,
        type: item.type,
        manufacturer: item.manufacturer ?? '',
        heightMm: numberValue(item.heightMm),
        widthMm: numberValue(item.widthMm),
        lengthMm: numberValue(item.lengthMm),
        weightKg: numberValue(item.weightKg),
      };
    }
  }
};

const optionalNumber = (value: string, label: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
};

type MaterialEditDialogProps = {
  open: boolean;
  category: StandardMaterialOwnerCategory;
  material: StandardMaterialOwner;
  token: string;
  onDismiss: () => void;
  onSaved: () => Promise<void>;
};

export const MaterialEditDialog = ({
  open,
  category,
  material,
  token,
  onDismiss,
  onSaved,
}: MaterialEditDialogProps) => {
  const styles = useStyles();
  const [form, setForm] = useState<FormState>(() => formFromMaterial(category, material));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(formFromMaterial(category, material));
      setError(null);
    }
  }, [category, material, open]);

  const setField = (field: keyof FormState, value: string): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setError(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const minimumOrderQuantity = Number(form.minimumOrderQuantity.replace(',', '.'));
    if (!Number.isFinite(minimumOrderQuantity) || minimumOrderQuantity <= 0) {
      setError('Minimum order quantity must be greater than zero.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      switch (category) {
        case 'cable-type':
          if (!form.name.trim()) throw new Error('Name is required.');
          await updateMaterialCableType(token, material.id, {
            name: form.name.trim(),
            purpose: nullableText(form.purpose),
            material: nullableText(form.material),
            description: nullableText(form.description),
            manufacturer: nullableText(form.manufacturer),
            partNo: nullableText(form.partNo),
            remarks: nullableText(form.remarks),
            diameterMm: optionalNumber(form.diameterMm, 'Diameter'),
            weightKgPerM: optionalNumber(form.weightKgPerM, 'Weight'),
            minimumOrderQuantity,
            orderMeasurement: form.orderMeasurement,
            packaging: form.packaging,
            source: nullableText(form.source),
          });
          break;
        case 'cable-installation-material':
        case 'tray-installation-material':
          if (!form.type.trim()) throw new Error('Type is required.');
          await (
            category === 'cable-installation-material'
              ? updateMaterialCableInstallationMaterial
              : updateMaterialTrayInstallationMaterial
          )(token, material.id, {
            type: form.type.trim(),
            purpose: nullableText(form.purpose),
            material: nullableText(form.material),
            description: nullableText(form.description),
            manufacturer: nullableText(form.manufacturer),
            partNo: nullableText(form.partNo),
            dimensionMm: nullableText(form.dimensionMm),
            weightKg: optionalNumber(form.weightKg, 'Weight'),
            minimumOrderQuantity,
            orderMeasurement: form.orderMeasurement,
            packaging: form.packaging,
            source: nullableText(form.source),
          });
          break;
        case 'tray':
          if (!form.type.trim()) throw new Error('Type is required.');
          await updateMaterialTray(token, material.id, {
            type: form.type.trim(),
            manufacturer: nullableText(form.manufacturer),
            heightMm: optionalNumber(form.heightMm, 'Height'),
            rungHeightMm: optionalNumber(form.rungHeightMm, 'Rung height'),
            widthMm: optionalNumber(form.widthMm, 'Width'),
            weightKgPerM: optionalNumber(form.weightKgPerM, 'Weight'),
            minimumOrderQuantity,
            orderMeasurement: form.orderMeasurement,
            packaging: form.packaging,
            source: nullableText(form.source),
          });
          break;
        case 'support':
          if (!form.type.trim()) throw new Error('Type is required.');
          await updateMaterialSupport(token, material.id, {
            type: form.type.trim(),
            manufacturer: nullableText(form.manufacturer),
            heightMm: optionalNumber(form.heightMm, 'Height'),
            widthMm: optionalNumber(form.widthMm, 'Width'),
            lengthMm: optionalNumber(form.lengthMm, 'Length'),
            weightKg: optionalNumber(form.weightKg, 'Weight'),
            minimumOrderQuantity,
            orderMeasurement: form.orderMeasurement,
            packaging: form.packaging,
            source: nullableText(form.source),
          });
          break;
      }
      await onSaved();
      onDismiss();
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : 'Unable to update material.',
      );
    } finally {
      setSaving(false);
    }
  };

  const textField = (label: string, field: keyof FormState, type: 'text' | 'url' = 'text') => (
    <Field label={label} required={field === 'name' || field === 'type'}>
      <Input
        type={type}
        value={form[field]}
        onChange={(_, data) => setField(field, data.value)}
        required={field === 'name' || field === 'type'}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onDismiss()}>
      <DialogSurface>
        <form onSubmit={(event) => void save(event)}>
          <DialogBody>
            <DialogTitle>Edit material</DialogTitle>
            <DialogContent className={styles.content}>
              {category === 'cable-type' ? (
                <>
                  {textField('Name', 'name')}
                  {textField('Purpose', 'purpose')}
                  {textField('Material', 'material')}
                  {textField('Description', 'description')}
                  {textField('Manufacturer', 'manufacturer')}
                  {textField('Part No.', 'partNo')}
                  {textField('Remarks', 'remarks')}
                  {textField('Diameter [mm]', 'diameterMm')}
                  {textField('Weight [kg/m]', 'weightKgPerM')}
                </>
              ) : category === 'cable-installation-material' ||
                category === 'tray-installation-material' ? (
                <>
                  {textField('Type', 'type')}
                  {textField('Purpose', 'purpose')}
                  {textField('Material', 'material')}
                  {textField('Description', 'description')}
                  {textField('Manufacturer', 'manufacturer')}
                  {textField('Part No.', 'partNo')}
                  {textField('Dimension [mm]', 'dimensionMm')}
                  {textField('Weight [kg]', 'weightKg')}
                </>
              ) : category === 'tray' ? (
                <>
                  {textField('Type', 'type')}
                  {textField('Manufacturer', 'manufacturer')}
                  {textField('Height [mm]', 'heightMm')}
                  {textField('Rung height [mm]', 'rungHeightMm')}
                  {textField('Width [mm]', 'widthMm')}
                  {textField('Weight [kg/m]', 'weightKgPerM')}
                </>
              ) : (
                <>
                  {textField('Type', 'type')}
                  {textField('Manufacturer', 'manufacturer')}
                  {textField('Height [mm]', 'heightMm')}
                  {textField('Width [mm]', 'widthMm')}
                  {textField('Length [mm]', 'lengthMm')}
                  {textField('Weight [kg]', 'weightKg')}
                </>
              )}
              <Field label="Minimum order quantity" required>
                <Input
                  type="number"
                  min={0.000001}
                  step="any"
                  value={form.minimumOrderQuantity}
                  onChange={(_, data) => setField('minimumOrderQuantity', data.value)}
                  required
                />
              </Field>
              <Field label="Order measurement" required>
                <Select
                  value={form.orderMeasurement}
                  onChange={(event) => setField('orderMeasurement', event.target.value)}
                >
                  <option value="pcs">pcs</option>
                  <option value="pack">pack</option>
                  <option value="meters">meters</option>
                </Select>
              </Field>
              <Field label="Packaging" required>
                <Select
                  value={form.packaging}
                  onChange={(event) => setField('packaging', event.target.value)}
                >
                  <option value="m">m</option>
                  <option value="Package">Package</option>
                  <option value="Box">Box</option>
                  <option value="Drum">Drum</option>
                  <option value="pcs">pcs</option>
                </Select>
              </Field>
              {textField('Source', 'source', 'url')}
              {error ? <Body1 className={styles.error}>{error}</Body1> : null}
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={onDismiss} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" appearance="primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
