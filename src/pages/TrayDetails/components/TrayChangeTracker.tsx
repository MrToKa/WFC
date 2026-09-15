import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Body1,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { Tray } from '@/api/types/tray';

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tableContainer: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '28rem', borderCollapse: 'collapse' },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
});

export const TrayChangeTracker = ({ tray }: { tray: Tray }) => {
  const styles = useStyles();
  return (
    <Accordion collapsible defaultOpenItems={[]} key={tray.id}>
      <AccordionItem value="change-tracker" className={styles.card}>
        <AccordionHeader>Change tracker</AccordionHeader>
        <AccordionPanel>
          {tray.changeLog?.length ? (
            <div className={styles.tableContainer}>
              <table className={styles.table} aria-label="Change tracker">
                <thead>
                  <tr>
                    {['Who', 'When', 'Changes'].map((label) => (
                      <th key={label} className={styles.tableHeadCell}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...tray.changeLog].reverse().map((entry) => (
                    <tr key={entry.id}>
                      <td className={styles.tableCell}>{entry.userName}</td>
                      <td className={styles.tableCell}>
                        {new Date(entry.changedAt).toLocaleString()}
                      </td>
                      <td className={styles.tableCell}>
                        <ul>
                          {entry.changes.map((change, index) => (
                            <li key={index}>{change}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Body1>No recorded changes yet. Future saved changes will appear here.</Body1>
          )}
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
};
