import {
  Body1,
  Button,
  Caption1,
  Field,
  Input
} from '@fluentui/react-components';

import type { Project } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import { formatNumeric } from '../ProjectDetails.utils';

type FormattedDates = {
  created: string;
  updated: string;
} | null;

type DetailsTabProps = {
  styles: ProjectDetailsStyles;
  project: Project;
  formattedDates: FormattedDates;
  isAdmin: boolean;
  secondaryTrayLengthInput: string;
  onSecondaryTrayLengthInputChange: (value: string) => void;
  onSaveSecondaryTrayLength: () => void;
  secondaryTrayLengthSaving: boolean;
  secondaryTrayLengthError: string | null;
};

export const DetailsTab = ({
  styles,
  project,
  formattedDates,
  isAdmin,
  secondaryTrayLengthInput,
  onSecondaryTrayLengthInputChange,
  onSaveSecondaryTrayLength,
  secondaryTrayLengthSaving,
  secondaryTrayLengthError
}: DetailsTabProps) => (
  <div className={styles.tabPanel} role="tabpanel" aria-label="Details">
    {formattedDates ? (
      <div className={styles.metadata}>
        <div className={styles.panel}>
          <Caption1>Created</Caption1>
          <Body1>{formattedDates.created}</Body1>
        </div>
        <div className={styles.panel}>
          <Caption1>Last updated</Caption1>
          <Body1>{formattedDates.updated}</Body1>
        </div>
      </div>
    ) : null}

    <div className={styles.panel}>
      <Caption1>Description</Caption1>
      <Body1>
        {project.description
          ? project.description
          : 'No description provided.'}
      </Body1>
    </div>
    <div className={styles.panel}>
      <Caption1>Project manager</Caption1>
      <Body1>
        {project.manager ? project.manager : 'No manager specified.'}
      </Body1>
    </div>
    <div className={styles.panel}>
      <Caption1>Secondary tray length</Caption1>
      {!isAdmin ? (
        <Body1>
          {project.secondaryTrayLength !== null
            ? `${formatNumeric(project.secondaryTrayLength)} m`
            : 'Not specified'}
        </Body1>
      ) : (
        <>
          <Body1>
            Current value:{' '}
            {project.secondaryTrayLength !== null
              ? `${formatNumeric(project.secondaryTrayLength)} m`
              : 'Not specified'}
          </Body1>
          <Field
            label="Update value [m]"
            validationState={secondaryTrayLengthError ? 'error' : undefined}
            validationMessage={secondaryTrayLengthError}
          >
            <Input
              value={secondaryTrayLengthInput}
              onChange={(_, data) => onSecondaryTrayLengthInputChange(data.value)}
              disabled={secondaryTrayLengthSaving}
              inputMode="decimal"
            />
          </Field>
          <Button
            appearance="primary"
            onClick={onSaveSecondaryTrayLength}
            disabled={secondaryTrayLengthSaving}
          >
            {secondaryTrayLengthSaving ? 'Saving...' : 'Save'}
          </Button>
        </>
      )}
    </div>
  </div>
);
