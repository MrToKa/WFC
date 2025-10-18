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
  Field,
  Input
} from '@fluentui/react-components';

import type { ProjectDetailsStyles } from './ProjectDetails.styles';
import type { TrayFormErrors, TrayFormState } from './ProjectDetails.forms';

type TrayDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: TrayFormState;
  errors: TrayFormErrors;
  submitting: boolean;
  onFieldChange: (
    field: keyof TrayFormState
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
};

export const TrayDialog = ({
  styles,
  open,
  mode,
  values,
  errors,
  submitting,
  onFieldChange,
  onSubmit,
  onDismiss
}: TrayDialogProps) => (
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
              validationState={errors.type ? 'error' : undefined}
              validationMessage={errors.type}
            >
              <Input
                value={values.type}
                onChange={onFieldChange('type')}
              />
            </Field>
            <Field
              label="Purpose"
              validationState={errors.purpose ? 'error' : undefined}
              validationMessage={errors.purpose}
            >
              <Input
                value={values.purpose}
                onChange={onFieldChange('purpose')}
              />
            </Field>
            <Field
              label="Width [mm]"
              validationState={errors.widthMm ? 'error' : undefined}
              validationMessage={errors.widthMm}
            >
              <Input
                value={values.widthMm}
                onChange={onFieldChange('widthMm')}
              />
            </Field>
            <Field
              label="Height [mm]"
              validationState={errors.heightMm ? 'error' : undefined}
              validationMessage={errors.heightMm}
            >
              <Input
                value={values.heightMm}
                onChange={onFieldChange('heightMm')}
              />
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
