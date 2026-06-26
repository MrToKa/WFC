import { useEffect, useMemo, useState } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Input,
  Spinner,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';

import { fetchCables } from '@/api/cables';
import { fetchRoxtecEntry } from '@/api/roxtec';
import type { Cable, RoxtecEntry } from '@/api/types';
import { getRoxtecRoutings, setRoxtecRoutings } from '@/utils/roxtecRoutings';
import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';

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
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  routingForm: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: '1rem'
  },
  routingInput: {
    minWidth: '16rem'
  },
  routingList: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginTop: '1rem'
  },
  routingChip: {
    display: 'flex',
    gap: '0.25rem',
    alignItems: 'center',
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.padding('0.25rem', '0.5rem')
  },
  tableContainer: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'middle',
    wordBreak: 'break-word'
  },
  numericCell: {
    textAlign: 'right'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  }
});

const normalizeRouting = (value: string) => value.trim();
const routingMatches = (cableRouting: string | null, filters: string[]) => {
  const normalizedCableRouting = cableRouting?.toLowerCase() ?? '';
  return filters.some((filter) =>
    normalizedCableRouting.includes(filter.toLowerCase())
  );
};

export const RoxtecDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, roxtecId } = useParams<{ projectId: string; roxtecId: string }>();
  const { project, projectLoading, projectError } = useProjectDetailsData({ projectId });
  const [entry, setEntry] = useState<RoxtecEntry | null>(null);
  const [entryLoading, setEntryLoading] = useState(true);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [routingInput, setRoutingInput] = useState('');
  const [routings, setRoutings] = useState<string[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [cablesLoading, setCablesLoading] = useState(false);
  const [cablesError, setCablesError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(roxtecId);

    if (!projectId || !Number.isInteger(id) || id < 1) {
      setEntry(null);
      setEntryError('Roxtec entry not found.');
      setEntryLoading(false);
      return;
    }

    let active = true;
    setEntryLoading(true);
    setEntryError(null);

    void (async () => {
      try {
        const response = await fetchRoxtecEntry(projectId, id);
        if (!active) {
          return;
        }
        setEntry(response.entry);
      } catch (error) {
        if (!active) {
          return;
        }
        console.error('Failed to load Roxtec entry', error);
        setEntry(null);
        setEntryError('Roxtec entry not found.');
      } finally {
        if (active) {
          setEntryLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, roxtecId]);

  useEffect(() => {
    if (!projectId || !entry) {
      setRoutings([]);
      return;
    }
    setRoutings(getRoxtecRoutings(projectId, entry.id));
  }, [entry, projectId]);

  useEffect(() => {
    if (!projectId || !entry) {
      setCables([]);
      return;
    }

    let isMounted = true;
    setCablesLoading(true);
    setCablesError(null);

    fetchCables(projectId)
      .then((response) => {
        if (isMounted) {
          setCables(response.cables);
        }
      })
      .catch((error) => {
        console.error('Failed to load cables for Roxtec routings', error);
        if (isMounted) {
          setCables([]);
          setCablesError('Failed to load cables.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setCablesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [entry, projectId]);

  const matchingCables = useMemo(() => {
    if (routings.length === 0) {
      return [];
    }

    const uniqueCables = new Map<string, Cable>();
    cables.forEach((cable) => {
      if (routingMatches(cable.routing, routings)) {
        uniqueCables.set(cable.id, cable);
      }
    });

    return Array.from(uniqueCables.values());
  }, [cables, routings]);

  const saveRoutings = (nextRoutings: string[]) => {
    if (!projectId || !entry) {
      return;
    }
    setRoutings(nextRoutings);
    setRoxtecRoutings(projectId, entry.id, nextRoutings);
  };

  const addRouting = () => {
    const nextRouting = normalizeRouting(routingInput);
    if (!nextRouting) {
      return;
    }
    const duplicate = routings.some(
      (routing) => routing.toLowerCase() === nextRouting.toLowerCase()
    );
    if (duplicate) {
      setRoutingInput('');
      return;
    }
    saveRoutings([...routings, nextRouting]);
    setRoutingInput('');
  };

  const removeRouting = (routingToRemove: string) => {
    saveRoutings(routings.filter((routing) => routing !== routingToRemove));
  };

  const backToRoxtec = () => {
    if (!projectId) {
      navigate('/');
      return;
    }

    navigate(`/projects/${projectId}?tab=roxtec`);
  };

  if (projectLoading || entryLoading) {
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
        <Body1>{entryError ?? 'Roxtec entry not found.'}</Body1>
        <Button onClick={backToRoxtec}>Back to Roxtec</Button>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="roxtec-details-heading">
      <div className={styles.header}>
        <Title3 id="roxtec-details-heading">
          {project.projectNumber} - {project.name}
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

      <div className={styles.panel}>
        <Title3>Routings</Title3>
        <Body1>
          Add one or more routings to filter the cable list for this Roxtec entry.
        </Body1>
        <div className={styles.routingForm}>
          <Input
            className={styles.routingInput}
            value={routingInput}
            placeholder="Add routing, e.g. A001"
            onChange={(_, data) => setRoutingInput(data.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                addRouting();
              }
            }}
            aria-label="Routing"
          />
          <Button appearance="primary" onClick={addRouting}>
            Add routing
          </Button>
        </div>
        {routings.length > 0 ? (
          <div className={styles.routingList} aria-label="Routings filters">
            {routings.map((routing) => (
              <span className={styles.routingChip} key={routing}>
                <Body1>{routing}</Body1>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() => removeRouting(routing)}
                  aria-label={`Remove routing ${routing}`}
                >
                  Remove
                </Button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.panel}>
        <Title3>Matching cables</Title3>
        {cablesError ? <Body1 className={styles.errorText}>{cablesError}</Body1> : null}
        {cablesLoading ? (
          <Spinner label="Loading cables..." />
        ) : routings.length === 0 ? (
          <div className={styles.emptyState}>
            <Caption1>No routing filters added</Caption1>
            <Body1>Add a routing above to show matching cables.</Body1>
          </div>
        ) : matchingCables.length === 0 ? (
          <div className={styles.emptyState}>
            <Caption1>No cables found</Caption1>
            <Body1>No cables match the current routing filters.</Body1>
          </div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCell}>ID</th>
                  <th className={styles.tableHeadCell}>Rev.</th>
                  <th className={styles.tableHeadCell}>MTO</th>
                  <th className={styles.tableHeadCell}>Tag</th>
                  <th className={styles.tableHeadCell}>Type</th>
                  <th className={styles.tableHeadCell}>From location</th>
                  <th className={styles.tableHeadCell}>To location</th>
                  <th className={styles.tableHeadCell}>Routing</th>
                  <th className={`${styles.tableHeadCell} ${styles.numericCell}`}>
                    Design length [m]
                  </th>
                </tr>
              </thead>
              <tbody>
                {matchingCables.map((cable) => (
                  <tr key={cable.id}>
                    <td className={styles.tableCell}>{cable.cableId}</td>
                    <td className={styles.tableCell}>{cable.revision ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.mto ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.tag ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.typeName}</td>
                    <td className={styles.tableCell}>{cable.fromLocation ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.toLocation ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.routing ?? '-'}</td>
                    <td className={`${styles.tableCell} ${styles.numericCell}`}>
                      {cable.designLength ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.actionsRow}>
        <Button appearance="secondary" onClick={backToRoxtec}>
          Back to Roxtec
        </Button>
      </div>
    </section>
  );
};
