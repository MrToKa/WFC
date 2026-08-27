import type { ChangeEvent, FormEvent } from 'react';
import {
  Body1,
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  useComboboxFilter,
} from '@fluentui/react-components';
import type {
  CableInstallationMaterialFormErrors,
  CableInstallationMaterialFormState,
} from '../CableInstallationMaterials.forms';
import type { ProjectDetailsStyles } from '../../ProjectDetails.styles';

type CableInstallationMaterialDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: CableInstallationMaterialFormState;
  errors: CableInstallationMaterialFormErrors;
  submitting: boolean;
  purposeOptions: string[];
  onFieldChange: (
    field: keyof CableInstallationMaterialFormState,
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onPurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
};

export const CableInstallationMaterialDialog = ({
  styles,
  open,
  mode,
  values,
  errors,
  submitting,
  purposeOptions,
  onFieldChange,
  onPurposeSelect,
  onSubmit,
  onDismiss,
}: CableInstallationMaterialDialogProps) => {
  const filteredPurposeOptions = useComboboxFilter(values.purpose, purposeOptions, {
    noOptionsMessage: 'No existing purpose found. Type a new purpose to create it.',
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) {
          onDismiss();
        }
      }}
    >
      <DialogSurface>
        <form className={styles.dialogForm} onSubmit={onSubmit}>
          <DialogBody>
            <DialogTitle>
              {mode === 'create'
                ? 'Add cable installation material'
                : 'Edit cable installation material'}
            </DialogTitle>
            <DialogContent>
              <Field
                label="Type"
                required
                validationState={errors.type ? 'error' : undefined}
                validationMessage={errors.type}
              >
                <Input value={values.type} onChange={onFieldChange('type')} required />
              </Field>
              <Field
                label="Purpose"
                validationState={errors.purpose ? 'error' : undefined}
                validationMessage={errors.purpose}
              >
                <Combobox
                  placeholder="Select or type a purpose"
                  selectedOptions={values.purpose ? [values.purpose] : []}
                  value={values.purpose}
                  onChange={(event) =>
                    onFieldChange('purpose')(event, { value: event.target.value })
                  }
                  onOptionSelect={onPurposeSelect}
                  freeform
                >
                  {filteredPurposeOptions}
                </Combobox>
              </Field>
              <Field
                label="Material"
                validationState={errors.material ? 'error' : undefined}
                validationMessage={errors.material}
              >
                <Input value={values.material} onChange={onFieldChange('material')} />
              </Field>
              <Field
                label="Description"
                validationState={errors.description ? 'error' : undefined}
                validationMessage={errors.description}
              >
                <Input value={values.description} onChange={onFieldChange('description')} />
              </Field>
              <Field
                label="Manufacturer"
                validationState={errors.manufacturer ? 'error' : undefined}
                validationMessage={errors.manufacturer}
              >
                <Input value={values.manufacturer} onChange={onFieldChange('manufacturer')} />
              </Field>
              <Field
                label="Part No."
                validationState={errors.partNo ? 'error' : undefined}
                validationMessage={errors.partNo}
              >
                <Input value={values.partNo} onChange={onFieldChange('partNo')} />
              </Field>
              <Field
                label="Dimension [mm]"
                validationState={errors.dimensionMm ? 'error' : undefined}
                validationMessage={errors.dimensionMm}
              >
                <Input value={values.dimensionMm} onChange={onFieldChange('dimensionMm')} />
              </Field>
              <Field
                label="Weight [kg]"
                validationState={errors.weightKg ? 'error' : undefined}
                validationMessage={errors.weightKg}
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={values.weightKg}
                  onChange={onFieldChange('weightKg')}
                />
              </Field>
              <Field
                label="Minimum order quantity"
                required
                validationState={errors.minimumOrderQuantity ? 'error' : undefined}
                validationMessage={errors.minimumOrderQuantity}
              >
                <Input
                  type="number"
                  min={0.000001}
                  step="any"
                  value={values.minimumOrderQuantity}
                  onChange={onFieldChange('minimumOrderQuantity')}
                  required
                />
              </Field>
              <Field label="Order measurement" required>
                <Select
                  value={values.orderMeasurement}
                  onChange={(event) =>
                    onFieldChange('orderMeasurement')(
                      event as unknown as ChangeEvent<HTMLInputElement>,
                      { value: event.target.value },
                    )
                  }
                >
                  <option value="pcs">pcs</option>
                  <option value="pack">pack</option>
                  <option value="meters">meters</option>
                </Select>
              </Field>
              <Field label="Packaging" required>
                <Select
                  value={values.packaging}
                  onChange={(event) =>
                    onFieldChange('packaging')(event as unknown as ChangeEvent<HTMLInputElement>, {
                      value: event.target.value,
                    })
                  }
                >
                  <option value="m">m</option>
                  <option value="Package">Package</option>
                  <option value="Box">Box</option>
                  <option value="Drum">Drum</option>
                  <option value="pcs">pcs</option>
                </Select>
              </Field>
              <Field
                label="Source"
                hint="Internet link to the material"
                validationState={errors.source ? 'error' : undefined}
                validationMessage={errors.source}
              >
                <Input
                  type="url"
                  value={values.source}
                  onChange={onFieldChange('source')}
                  placeholder="https://example.com/material"
                />
              </Field>
              {errors.general ? <Body1 className={styles.errorText}>{errors.general}</Body1> : null}
            </DialogContent>
            <DialogActions className={styles.dialogActions}>
              <Button type="button" onClick={onDismiss} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" appearance="primary" disabled={submitting}>
                {submitting ? 'Saving...' : mode === 'create' ? 'Add' : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
