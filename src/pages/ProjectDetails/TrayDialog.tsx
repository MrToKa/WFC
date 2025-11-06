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

import type { MaterialTray } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import type { TrayFormErrors, TrayFormState } from '../ProjectDetails.forms';

type TrayDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: TrayFormState;
  errors: TrayFormErrors;
  submitting: boolean;
  materialTrays: MaterialTray[];
  onFieldChange: (
    field: keyof TrayFormState
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onTypeSelect?: (_event: unknown, data: { optionValue?: string }) => void;
  onPurposeSelect?: (_event: unknown, data: { optionValue?: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
};

const PURPOSE_OPTIONS = [
  'Medium voltage cable tray',
  'Low voltage cable tray',
  'EMC cable tray',
  'Instrumentation and control cables tray',
  'LV and I and C cable tray'
] as const;

export const TrayDialog = ({
  styles,
  open,
  mode,
  values,
  errors,
  submitting,
  materialTrays,
  onFieldChange,
  onTypeSelect,
  onPurposeSelect,
  onSubmit,
  onDismiss
}: TrayDialogProps) => {
  const trayTypes = Array.from(
    new Set(
      materialTrays
        .map((material) => material.type)
        .filter((type) => type.trim() !== '')
    )
  ).sort((a, b) => a.localeCompare(b));
  const hasTrayTypes = trayTypes.length > 0;

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
              {mode === 'create' ? 'Add tray' : 'Edit tray'}
            </DialogTitle>
            <DialogContent>
              <Field
                label="Name"
                required
                validationState={errors.name ? 'error' : undefined}
                validationMessage={errors.name}
              >
                <Input
                  value={values.name}
                  onChange={onFieldChange('name')}
                  required
                />
              </Field>
              <Field
                label="Type"
                required
                validationState={errors.type ? 'error' : undefined}
                validationMessage={errors.type}
              >
                <Combobox
                  placeholder={
                    hasTrayTypes ? 'Select or search tray type' : 'No tray types available'
                  }
                  selectedOptions={values.type ? [values.type] : []}
                  value={values.type}
                  onOptionSelect={onTypeSelect}
                  disabled={!hasTrayTypes}
                >
                  {trayTypes.map((trayType) => (
                    <Option key={trayType} value={trayType}>
                      {trayType}
                    </Option>
                  ))}
                </Combobox>
              </Field>
              <Field
                label="Purpose"
                validationState={errors.purpose ? 'error' : undefined}
                validationMessage={errors.purpose}
              >
                <Combobox
                  placeholder="Select purpose"
                  selectedOptions={values.purpose ? [values.purpose] : []}
                  value={values.purpose}
                  onOptionSelect={onPurposeSelect}
                  freeform={false}
                >
                  {PURPOSE_OPTIONS.map((purpose) => (
                    <Option key={purpose} value={purpose}>
                      {purpose}
                    </Option>
                  ))}
                </Combobox>
              </Field>
              <Field
                label="Length"
                validationState={errors.lengthMm ? 'error' : undefined}
                validationMessage={errors.lengthMm}
              >
                <Input
                  value={values.lengthMm}
                  onChange={onFieldChange('lengthMm')}
                />
              </Field>
              {errors.general ? (
                <Body1 className={styles.errorText}>{errors.general}</Body1>
              ) : null}
            </DialogContent>
            <DialogActions className={styles.dialogActions}>
              <Button
                type="button"
                appearance="secondary"
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
                    ? 'Add tray'
                    : 'Save changes'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
