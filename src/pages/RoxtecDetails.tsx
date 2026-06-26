import { useMemo } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Spinner,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';

import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';
import { getRoxtecEntryById } from '@/utils/roxtecEntries';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  panel: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  fieldList: {
    display: 'grid',
    gridTemplateColumns: 'minmax(10rem, 16rem) 1fr',
    gap: '0.75rem 1rem'
  },
  fieldName: {
    fontWeight: tokens.fontWeightSemibold
  },
  actionsRow: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  }
});

export const RoxtecDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, roxtecId } = useParams<{ projectId: string; roxtecId: string }>();
  const { project, projectLoading, projectError } = useProjectDetailsData({ projectId });

  const entry = useMemo(() => {
    const id = Number(roxtecId);
    if (!projectId || !Number.isInteger(id)) {
      return null;
    }
    return getRoxtecEntryById(projectId, id);
  }, [projectId, roxtecId]);

  const backToRoxtec = () => {
    if (!projectId) {
      navigate('/');
      return;
    }
    navigate(`/projects/${projectId}?tab=roxtec`);
  };

  if (projectLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading Roxtec details..." />
      </section>
    );
  }

  if (projectError) {
    return (
      <section className={styles.root}>
        <Body1>{projectError}</Body1>
        <Button onClick={backToRoxtec}>Back to Roxtec</Button>
      </section>
    );
  }

  if (!project || !entry) {
    return (
      <section className={styles.root}>
        <Body1>Roxtec entry not found.</Body1>
        <Button onClick={backToRoxtec}>Back to Roxtec</Button>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="roxtec-details-heading">
      <div className={styles.header}>
        <Title3 id="roxtec-details-heading">
          {project.projectNumber} &mdash; {project.name}
        </Title3>
        <Body1>Roxtec entry {entry.id}</Body1>
      </div>

      <div className={styles.panel}>
        <div className={styles.fieldList}>
          <Caption1 className={styles.fieldName}>ID</Caption1>
          <Body1>{String(entry.id)}</Body1>
          <Caption1 className={styles.fieldName}>Rev.</Caption1>
          <Body1>{entry.revision}</Body1>
          <Caption1 className={styles.fieldName}>Tag</Caption1>
          <Body1>{entry.tag}</Body1>
          <Caption1 className={styles.fieldName}>Type</Caption1>
          <Body1>{entry.type}</Body1>
          <Caption1 className={styles.fieldName}>Description</Caption1>
          <Body1>{entry.description || '-'}</Body1>
        </div>
      </div>

      <div className={styles.actionsRow}>
        <Button appearance="secondary" onClick={backToRoxtec}>
          Back to Roxtec
        </Button>
      </div>
    </section>
  );
};