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
import { MaterialSupport } from '@/api/client';
import { SupportFormErrors, SupportFormState } from '../Materials.types';

type SupportDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  editingSupport: MaterialSupport | null;
  form: SupportFormState;
  formErrors: SupportFormErrors;
  isSubmitting: boolean;
  onFieldChange: (field: keyof SupportFormState) => (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

export const SupportDialog = ({
  open,
  mode,
  editingSupport,
  form,
  formErrors,
  isSubmitting,
  onFieldChange,
  onSubmit,
  onClose,
  dialogActionsClassName
}: SupportDialogProps) => {
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
                ? 'Add support'
                : `Edit support${editingSupport ? `: ${editingSupport.type}` : ''}`}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Type'
                required
                validationState={formErrors.type ? 'error' : undefined}
                validationMessage={formErrors.type}
              >
                <Input
                  value={form.type}
                  onChange={onFieldChange('type')}
                  required
                />
              </Field>
              <Field
                label='Height [mm]'
                validationState={formErrors.heightMm ? 'error' : undefined}
                validationMessage={formErrors.heightMm}
              >
                <Input
                  value={form.heightMm}
                  onChange={onFieldChange('heightMm')}
                />
              </Field>
              <Field
                label='Width [mm]'
                validationState={formErrors.widthMm ? 'error' : undefined}
                validationMessage={formErrors.widthMm}
              >
                <Input
                  value={form.widthMm}
                  onChange={onFieldChange('widthMm')}
                />
              </Field>
              <Field
                label='Length [mm]'
                validationState={formErrors.lengthMm ? 'error' : undefined}
                validationMessage={formErrors.lengthMm}
              >
                <Input
                  value={form.lengthMm}
                  onChange={onFieldChange('lengthMm')}
                />
              </Field>
              <Field
                label='Weight [kg]'
                validationState={formErrors.weightKg ? 'error' : undefined}
                validationMessage={formErrors.weightKg}
              >
                <Input
                  value={form.weightKg}
                  onChange={onFieldChange('weightKg')}
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
