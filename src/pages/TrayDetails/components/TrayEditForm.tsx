import React, { ChangeEvent, FormEvent } from 'react';
import { Body1, Button, Field, Input, Dropdown, Option, Combobox } from '@fluentui/react-components';
import { MaterialTray } from '../../../api/client';
import { TrayFormState, TrayFormErrors } from '../TrayDetails.types';
import { TRAY_PURPOSE_OPTIONS } from '@/constants/trayPurposeOptions';

interface TrayEditFormProps {
  formValues: TrayFormState;
  formErrors: TrayFormErrors;
  materialsError: string | null;
  canUseMaterialDropdown: boolean;
  currentTypeHasMaterial: boolean;
  isLoadingMaterials: boolean;
  isSubmitting: boolean;
  materialTrays: MaterialTray[];
  onFieldChange: (field: keyof TrayFormState) => (
    _event: ChangeEvent<HTMLInputElement>,
    data: { value: string }
  ) => void;
  onTypeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  onPurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  styles: Record<string, string>;
}

export const TrayEditForm: React.FC<TrayEditFormProps> = ({
  formValues,
  formErrors,
  materialsError,
  canUseMaterialDropdown,
  currentTypeHasMaterial,
  isLoadingMaterials,
  isSubmitting,
  materialTrays,
  onFieldChange,
  onTypeSelect,
  onPurposeSelect,
  onSubmit,
  onCancel,
  styles
}) => {
  const hasCustomPurposeOption =
    formValues.purpose.trim() !== '' &&
    !TRAY_PURPOSE_OPTIONS.some((purpose) => purpose === formValues.purpose);

  return (
    <form className={styles.grid} onSubmit={onSubmit}>
      {materialsError ? (
        <Body1 className={styles.errorText}>{materialsError}</Body1>
      ) : null}
      <Field
        label="Name"
        required
        validationState={formErrors.name ? 'error' : undefined}
        validationMessage={formErrors.name}
      >
        <Input
          value={formValues.name}
          onChange={onFieldChange('name')}
          required
        />
      </Field>
      <Field
        label="Type"
        validationState={formErrors.type ? 'error' : undefined}
        validationMessage={formErrors.type}
      >
        {canUseMaterialDropdown ? (
          <Dropdown
            placeholder="Select tray type"
            selectedOptions={formValues.type ? [formValues.type] : []}
            value={formValues.type || undefined}
            onOptionSelect={onTypeSelect}
          >
            {materialTrays.map((material) => (
              <Option key={material.id} value={material.type}>
                {material.type}
              </Option>
            ))}
            {!currentTypeHasMaterial && formValues.type ? (
              <Option key="custom" value={formValues.type}>
                {formValues.type}
              </Option>
            ) : null}
          </Dropdown>
        ) : (
          <Input
            value={formValues.type}
            onChange={onFieldChange('type')}
            placeholder={isLoadingMaterials ? 'Loading types...' : undefined}
            readOnly={isLoadingMaterials}
          />
        )}
      </Field>
      <Field
        label="Purpose"
        validationState={formErrors.purpose ? 'error' : undefined}
        validationMessage={formErrors.purpose}
      >
        <Combobox
          placeholder="Select purpose"
          selectedOptions={formValues.purpose ? [formValues.purpose] : []}
          value={formValues.purpose}
          onOptionSelect={onPurposeSelect}
          freeform={false}
        >
          {TRAY_PURPOSE_OPTIONS.map((purpose) => (
            <Option key={purpose} value={purpose}>
              {purpose}
            </Option>
          ))}
          {hasCustomPurposeOption ? (
            <Option key="custom-purpose" value={formValues.purpose}>
              {formValues.purpose}
            </Option>
          ) : null}
        </Combobox>
      </Field>
      <Field
        label="Width [mm]"
        validationState={formErrors.widthMm ? 'error' : undefined}
        validationMessage={formErrors.widthMm}
      >
        <Input value={formValues.widthMm} readOnly />
      </Field>
      <Field
        label="Height [mm]"
        validationState={formErrors.heightMm ? 'error' : undefined}
        validationMessage={formErrors.heightMm}
      >
        <Input value={formValues.heightMm} readOnly />
      </Field>
      <Field label="Weight [kg/m]">
        <Input value={formValues.weightKgPerM} readOnly />
      </Field>
      <Field
        label="Length [mm]"
        validationState={formErrors.lengthMm ? 'error' : undefined}
        validationMessage={formErrors.lengthMm}
      >
        <Input
          value={formValues.lengthMm}
          onChange={onFieldChange('lengthMm')}
        />
      </Field>
      <div className={styles.actions}>
        <Button
          type="button"
          appearance="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button appearance="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
};
