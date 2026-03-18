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

import type { CableType } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import type { CableFormErrors, CableFormState } from '../ProjectDetails.forms';

export type CableDialogField =
  | 'tag'
  | 'cableTypeId'
  | 'fromLocation'
  | 'toLocation'
  | 'routing'
  | 'designLength';

type CableDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: CableFormState;
  errors: CableFormErrors;
  submitting: boolean;
  cableTypes: CableType[];
  visibleFields: CableDialogField[];
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
  visibleFields,
  onFieldChange,
  onCableTypeSelect,
  onSubmit,
  onDismiss
}: CableDialogProps) => {
  const selectedCableType = cableTypes.find(
    (type) => type.id === values.cableTypeId
  );

  const isFieldVisible = (field: CableDialogField) => visibleFields.includes(field);

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
              {isFieldVisible('tag') ? (
                <Field
                  label="Tag"
                  required
                  validationState={errors.tag ? 'error' : undefined}
                  validationMessage={errors.tag}
                >
                  <Input
                    value={values.tag}
                    onChange={onFieldChange('tag')}
                    required
                  />
                </Field>
              ) : null}
              {isFieldVisible('cableTypeId') ? (
                <Field
                  label="Cable type"
                  required
                  validationState={errors.cableTypeId ? 'error' : undefined}
                  validationMessage={errors.cableTypeId}
                >
                  <Combobox
                    placeholder="Select or search cable type"
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
                  </Combobox>
                </Field>
              ) : null}
              {isFieldVisible('fromLocation') ? (
                <Field label="From location">
                  <Input
                    value={values.fromLocation}
                    onChange={onFieldChange('fromLocation')}
                  />
                </Field>
              ) : null}
              {isFieldVisible('toLocation') ? (
                <Field label="To location">
                  <Input
                    value={values.toLocation}
                    onChange={onFieldChange('toLocation')}
                  />
                </Field>
              ) : null}
              {isFieldVisible('routing') ? (
                <Field label="Routing">
                  <Input
                    value={values.routing}
                    onChange={onFieldChange('routing')}
                  />
                </Field>
              ) : null}
              {isFieldVisible('designLength') ? (
                <Field
                  label="Design length [m]"
                  validationState={
                    errors.designLength ? 'error' : undefined
                  }
                  validationMessage={errors.designLength}
                >
                  <Input
                    type="number"
                    min={0}
                    value={values.designLength}
                    onChange={onFieldChange('designLength')}
                  />
                </Field>
              ) : null}
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
