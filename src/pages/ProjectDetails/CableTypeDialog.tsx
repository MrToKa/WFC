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
  Option
} from '@fluentui/react-components';

import type {
  CableTypeFormErrors,
  CableTypeFormState
} from '../ProjectDetails.forms';
import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type CableTypeDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: CableTypeFormState;
  errors: CableTypeFormErrors;
  submitting: boolean;
  showMaterialFields?: boolean;
  nameOptions?: string[];
  namePlaceholder?: string;
  helperText?: string;
  lockResolvedFields?: boolean;
  onFieldChange: (
    field: keyof CableTypeFormState
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onNameSelect?: (_event: unknown, data: { optionValue?: string }) => void;
  onPurposeSelect?: (_event: unknown, data: { optionValue?: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
};

export const CableTypeDialog = ({
  styles,
  open,
  mode,
  values,
  errors,
  submitting,
  showMaterialFields = false,
  nameOptions,
  namePlaceholder,
  helperText,
  lockResolvedFields = false,
  onFieldChange,
  onNameSelect,
  onPurposeSelect,
  onSubmit,
  onDismiss
}: CableTypeDialogProps) => {
  const resolvedNameOptions =
    nameOptions && values.name && !nameOptions.includes(values.name)
      ? [values.name, ...nameOptions]
      : nameOptions;
  const hasNameOptions = resolvedNameOptions !== undefined;
  const hasSelectableNames = (resolvedNameOptions?.length ?? 0) > 0;

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
              {mode === 'create' ? 'Add cable type' : 'Edit cable type'}
            </DialogTitle>
            <DialogContent>
              <Field
                label="Name"
                required
                validationState={errors.name ? 'error' : undefined}
                validationMessage={errors.name}
              >
                {hasNameOptions ? (
                  <Combobox
                    placeholder={
                      hasSelectableNames
                        ? (namePlaceholder ?? 'Select or search cable type')
                        : 'No material cable types available'
                    }
                    selectedOptions={values.name ? [values.name] : []}
                    value={values.name}
                    onOptionSelect={onNameSelect}
                    freeform={false}
                    disabled={!hasSelectableNames}
                  >
                    {resolvedNameOptions?.map((name) => (
                      <Option key={name} value={name}>
                        {name}
                      </Option>
                    ))}
                  </Combobox>
                ) : (
                  <Input
                    value={values.name}
                    onChange={onFieldChange('name')}
                    required
                  />
                )}
              </Field>
              {helperText ? <Body1>{helperText}</Body1> : null}
              <Field
                label="Purpose"
                validationState={errors.purpose ? 'error' : undefined}
                validationMessage={errors.purpose}
              >
                <Combobox
                  placeholder="Select purpose"
                  selectedOptions={values.purpose ? [values.purpose] : []}
                  value={values.purpose || undefined}
                  onOptionSelect={onPurposeSelect}
                  disabled={lockResolvedFields}
                  freeform={false}
                >
                  <Option value="Grounding">Grounding</Option>
                  <Option value="Control">Control</Option>
                  <Option value="Power">Power</Option>
                  <Option value="VFD">VFD</Option>
                  <Option value="MV">MV</Option>
                </Combobox>
              </Field>
              {showMaterialFields ? (
                <>
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
                    label="Remarks (optional)"
                    validationState={errors.remarks ? 'error' : undefined}
                    validationMessage={errors.remarks}
                  >
                    <Input value={values.remarks} onChange={onFieldChange('remarks')} />
                  </Field>
                </>
              ) : null}
              <Field
                label="Diameter [mm]"
                validationState={errors.diameterMm ? 'error' : undefined}
                validationMessage={errors.diameterMm}
              >
                <Input
                  value={values.diameterMm}
                  onChange={onFieldChange('diameterMm')}
                  inputMode="decimal"
                  disabled={lockResolvedFields}
                />
              </Field>
              <Field
                label="Weight [kg/m]"
                validationState={errors.weightKgPerM ? 'error' : undefined}
                validationMessage={errors.weightKgPerM}
              >
                <Input
                  value={values.weightKgPerM}
                  onChange={onFieldChange('weightKgPerM')}
                  inputMode="decimal"
                  disabled={lockResolvedFields}
                />
              </Field>
              {errors.general ? (
                <Body1 className={styles.errorText}>{errors.general}</Body1>
              ) : null}
            </DialogContent>
            <DialogActions className={styles.dialogActions}>
              <Button
                type="button"
                onClick={onDismiss}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                appearance="primary"
                disabled={submitting}
              >
                {submitting
                  ? 'Saving...'
                  : mode === 'create'
                    ? 'Add'
                    : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
