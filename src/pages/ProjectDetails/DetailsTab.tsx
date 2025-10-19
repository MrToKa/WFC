import { Body1, Caption1 } from '@fluentui/react-components';

import type { Project } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type FormattedDates = {
  created: string;
  updated: string;
} | null;

type DetailsTabProps = {
  styles: ProjectDetailsStyles;
  project: Project;
  formattedDates: FormattedDates;
};

export const DetailsTab = ({
  styles,
  project,
  formattedDates
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
  </div>
);
