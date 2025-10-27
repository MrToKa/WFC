import type { FormEvent, ChangeEvent } from 'react';
import {
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
import { MaterialTray } from '@/api/client';
import { TrayFormErrors, TrayFormState } from '../Materials.types';

type TrayDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  editingTray: MaterialTray | null;
  form: TrayFormState;
  formErrors: TrayFormErrors;
  isSubmitting: boolean;
  onFieldChange: (field: keyof TrayFormState) => (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

export const TrayDialog = ({
  open,
  mode,
  editingTray,
  form,
  formErrors,
  isSubmitting,
  onFieldChange,
  onSubmit,
  onClose,
  dialogActionsClassName
}: TrayDialogProps) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) {
          onClose();
        }
      }}
    >
      <DialogSurface>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <DialogTitle>
              {mode === 'create'
                ? 'Add tray'
                : `Edit tray${editingTray ? `: ${editingTray.type}` : ''}`}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Type'
                required
                validationState={formErrors.type ? 'error' : undefined}
                validationMessage={formErrors.type}
              >
                <Input value={form.type} onChange={onFieldChange('type')} required />
              </Field>
              <Field
                label='Height [mm]'
                validationState={formErrors.heightMm ? 'error' : undefined}
                validationMessage={formErrors.heightMm}
              >
                <Input value={form.heightMm} onChange={onFieldChange('heightMm')} />
              </Field>
              <Field
                label='Width [mm]'
                validationState={formErrors.widthMm ? 'error' : undefined}
                validationMessage={formErrors.widthMm}
              >
                <Input value={form.widthMm} onChange={onFieldChange('widthMm')} />
              </Field>
              <Field
                label='Weight [kg/m]'
                validationState={formErrors.weightKgPerM ? 'error' : undefined}
                validationMessage={formErrors.weightKgPerM}
              >
                <Input
                  value={form.weightKgPerM}
                  onChange={onFieldChange('weightKgPerM')}
                />
              </Field>
            </DialogContent>
            <DialogActions className={dialogActionsClassName}>
              <Button appearance='secondary' onClick={onClose}>
                Cancel
              </Button>
              <Button appearance='primary' type='submit' disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
