import type { ChangeEvent, FormEvent } from 'react';

import {
  Body1,
  Button,
  Combobox,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
} from '@fluentui/react-components';

import { CABLE_MTO_OPTIONS, type CableType } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import type { CableFormErrors, CableFormState } from '../ProjectDetails.forms';

export type CableDialogField =
  | 'revision'
  | 'mto'
  | 'tag'
  | 'cableTypeId'
  | 'fromLocation'
  | 'toLocation'
  | 'routing'
  | 'delivery'
  | 'designLength'
  | 'installLength'
  | 'pullDate'
  | 'connectedFrom'
  | 'connectedTo'
  | 'tested';

type CableDialogProps = {
  styles: Pick<ProjectDetailsStyles, 'dialogForm' | 'dialogActions' | 'errorText'>;
  open: boolean;
  mode: 'create' | 'edit';
  values: CableFormState;
  errors: CableFormErrors;
  submitting: boolean;
  cableTypes: Pick<CableType, 'id' | 'name'>[];
  visibleFields: CableDialogField[];
  onFieldChange: (
    field: keyof CableFormState,
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onCableTypeSelect: (event: unknown, data: { optionValue?: string }) => void;
  onMtoSelect: (event: unknown, data: { optionValue?: string }) => void;
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
  onMtoSelect,
  onSubmit,
  onDismiss,
}: CableDialogProps) => {
  const selectedCableType = cableTypes.find((type) => type.id === values.cableTypeId);

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
            <DialogTitle>{mode === 'create' ? 'Add cable' : 'Edit cable'}</DialogTitle>
            <DialogContent>
              {isFieldVisible('revision') ? (
                <Field label="Revision">
                  <Input value={values.revision} onChange={onFieldChange('revision')} />
                </Field>
              ) : null}
              {isFieldVisible('mto') ? (
                <Field
                  label="MTO"
                  validationState={errors.mto ? 'error' : undefined}
                  validationMessage={errors.mto}
                >
                  <Dropdown
                    placeholder="Select MTO"
                    selectedOptions={values.mto ? [values.mto] : []}
                    value={values.mto || undefined}
                    onOptionSelect={onMtoSelect}
                    clearable
                  >
                    {CABLE_MTO_OPTIONS.map((option) => (
                      <Option key={option} value={option}>
                        {option}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              ) : null}
              {isFieldVisible('tag') ? (
                <Field
                  label="Tag"
                  required
                  validationState={errors.tag ? 'error' : undefined}
                  validationMessage={errors.tag}
                >
                  <Input value={values.tag} onChange={onFieldChange('tag')} required />
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
                    selectedOptions={values.cableTypeId ? [values.cableTypeId] : []}
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
                  <Input value={values.fromLocation} onChange={onFieldChange('fromLocation')} />
                </Field>
              ) : null}
              {isFieldVisible('toLocation') ? (
                <Field label="To location">
                  <Input value={values.toLocation} onChange={onFieldChange('toLocation')} />
                </Field>
              ) : null}
              {isFieldVisible('routing') ? (
                <>
                  <Field label="Routing">
                    <Input value={values.routing} onChange={onFieldChange('routing')} />
                  </Field>
                  <Checkbox
                    label="Manually assigned route — keep"
                    checked={values.manualRoutingProtected === 'true'}
                    onChange={(event, data) =>
                      onFieldChange('manualRoutingProtected')(event, {
                        value: data.checked ? 'true' : 'false',
                      })
                    }
                  />
                  <Body1>
                    Clearing the manual route uses the calculated route. Execution protection takes
                    priority.
                  </Body1>
                  {values.executionLocked === 'true' ? (
                    <>
                      <Body1>
                        This cable has execution protection. Clearing dates does not unlock its
                        route automatically.
                      </Body1>
                      <Field
                        label="Execution unlock reason"
                        hint="Clear the execution fields and save first. Enter a reason on a separate save to unlock the route."
                      >
                        <Input
                          value={values.executionUnlockReason ?? ''}
                          onChange={onFieldChange('executionUnlockReason')}
                        />
                      </Field>
                    </>
                  ) : null}
                </>
              ) : null}
              {isFieldVisible('delivery') ? (
                <Field label="Delivery">
                  <Input value={values.delivery} onChange={onFieldChange('delivery')} />
                </Field>
              ) : null}
              {isFieldVisible('designLength') ? (
                <Field
                  label="Design length [m]"
                  validationState={errors.designLength ? 'error' : undefined}
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
              {isFieldVisible('installLength') ? (
                <Field
                  label="Install length [m]"
                  validationState={errors.installLength ? 'error' : undefined}
                  validationMessage={errors.installLength}
                >
                  <Input
                    type="number"
                    min={0}
                    value={values.installLength ?? ''}
                    onChange={onFieldChange('installLength')}
                  />
                </Field>
              ) : null}
              {(['pullDate', 'connectedFrom', 'connectedTo', 'tested'] as const).map((field) =>
                isFieldVisible(field) ? (
                  <Field
                    key={field}
                    label={
                      {
                        pullDate: 'Pull date',
                        connectedFrom: 'Connected From',
                        connectedTo: 'Connected To',
                        tested: 'Cable tested',
                      }[field]
                    }
                    validationState={errors[field] ? 'error' : undefined}
                    validationMessage={errors[field]}
                  >
                    <Input
                      type="date"
                      value={values[field] ?? ''}
                      onChange={onFieldChange(field)}
                    />
                  </Field>
                ) : null,
              )}
              {errors.general ? <Body1 className={styles.errorText}>{errors.general}</Body1> : null}
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
              <Button type="submit" appearance="primary" disabled={submitting}>
                {submitting ? 'Saving...' : mode === 'create' ? 'Add cable' : 'Save changes'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
