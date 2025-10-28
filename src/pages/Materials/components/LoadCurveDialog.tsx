import type { ChangeEvent, FormEvent } from 'react';
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
  Textarea
} from '@fluentui/react-components';
import type { MaterialLoadCurve } from '@/api/client';
import type { LoadCurveFormErrors, LoadCurveFormState } from '../Materials.types';

type LoadCurveDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  editingLoadCurve: MaterialLoadCurve | null;
  form: LoadCurveFormState;
  formErrors: LoadCurveFormErrors;
  isSubmitting: boolean;
  onFieldChange: (
    field: keyof LoadCurveFormState
  ) => (_event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

export const LoadCurveDialog = ({
  open,
  mode,
  editingLoadCurve,
  form,
  formErrors,
  isSubmitting,
  onFieldChange,
  onSubmit,
  onClose,
  dialogActionsClassName
}: LoadCurveDialogProps) => {
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
                ? 'Add load curve'
                : `Edit load curve${editingLoadCurve ? `: ${editingLoadCurve.name}` : ''}`}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Name'
                required
                validationState={formErrors.name ? 'error' : undefined}
                validationMessage={formErrors.name}
              >
                <Input
                  value={form.name}
                  onChange={onFieldChange('name')}
                  required
                />
              </Field>
              <Field
                label='Description (optional)'
                validationState={formErrors.description ? 'error' : undefined}
                validationMessage={formErrors.description}
              >
                <Textarea
                  value={form.description}
                  onChange={onFieldChange('description')}
                  rows={4}
                />
              </Field>
            </DialogContent>
            <DialogActions className={dialogActionsClassName}>
              <Button appearance='secondary' type='button' onClick={onClose}>
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
