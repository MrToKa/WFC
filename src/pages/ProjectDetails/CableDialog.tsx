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

import type { CableType } from '@/api/client';

import type { ProjectDetailsStyles } from './ProjectDetails.styles';
import type { CableFormErrors, CableFormState } from './ProjectDetails.forms';

type CableDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: CableFormState;
  errors: CableFormErrors;
  submitting: boolean;
  cableTypes: CableType[];
  onFieldChange: (
    field: keyof CableFormState
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onCableTypeSelect: (
    event: unknown,
    data: { optionValue?: string }
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
};

export const CableDialog = ({
  styles,
  open,
  mode,
  values,
  errors,
  submitting,
  cableTypes,
  onFieldChange,
  onCableTypeSelect,
  onSubmit,
  onDismiss
}: CableDialogProps) => {
  const selectedCableType = cableTypes.find(
    (type) => type.id === values.cableTypeId
  );

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
              {mode === 'create' ? 'Add cable' : 'Edit cable'}
            </DialogTitle>
            <DialogContent>
              <Field
                label="Cable ID"
                required
                validationState={errors.cableId ? 'error' : undefined}
                validationMessage={errors.cableId}
              >
                <Input
                  value={values.cableId}
                  onChange={onFieldChange('cableId')}
                  required
                />
              </Field>
              <Field label="Tag">
                <Input
                  value={values.tag}
                  onChange={onFieldChange('tag')}
                />
              </Field>
              <Field
                label="Cable type"
                required
                validationState={errors.cableTypeId ? 'error' : undefined}
                validationMessage={errors.cableTypeId}
              >
                <Dropdown
                  placeholder="Select cable type"
                  selectedOptions={
                    values.cableTypeId ? [values.cableTypeId] : []
                  }
                  value={selectedCableType?.name ?? ''}
                  onOptionSelect={onCableTypeSelect}
                >
                  {cableTypes.map((type) => (
                    <Option key={type.id} value={type.id}>
                      {type.name}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label="From location">
                <Input
                  value={values.fromLocation}
                  onChange={onFieldChange('fromLocation')}
                />
              </Field>
              <Field label="To location">
                <Input
                  value={values.toLocation}
                  onChange={onFieldChange('toLocation')}
                />
              </Field>
              <Field label="Routing">
                <Input
                  value={values.routing}
                  onChange={onFieldChange('routing')}
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
                    ? 'Add cable'
                    : 'Save changes'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
