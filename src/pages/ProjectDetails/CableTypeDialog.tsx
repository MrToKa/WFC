import type { ChangeEvent, FormEvent } from 'react';

import {
  Body1,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
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
  onFieldChange: (
    field: keyof CableTypeFormState
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
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
  onFieldChange,
  onPurposeSelect,
  onSubmit,
  onDismiss
}: CableTypeDialogProps) => (
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
              <Input
                value={values.name}
                onChange={onFieldChange('name')}
                required
              />
            </Field>
            <Field
              label="Purpose"
              validationState={errors.purpose ? 'error' : undefined}
              validationMessage={errors.purpose}
            >
              <Dropdown
                placeholder="Select purpose"
                selectedOptions={values.purpose ? [values.purpose] : []}
                value={values.purpose || undefined}
                onOptionSelect={onPurposeSelect}
              >
                <Option value="Grounding">Grounding</Option>
                <Option value="Control">Control</Option>
                <Option value="Power">Power</Option>
                <Option value="VFD">VFD</Option>
                <Option value="MV">MV</Option>
              </Dropdown>
            </Field>
            <Field
              label="Diameter [mm]"
              validationState={errors.diameterMm ? 'error' : undefined}
              validationMessage={errors.diameterMm}
            >
              <Input
                value={values.diameterMm}
                onChange={onFieldChange('diameterMm')}
                inputMode="decimal"
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
