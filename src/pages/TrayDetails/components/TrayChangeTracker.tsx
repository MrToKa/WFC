import { ChangeLogTable } from '@/components/ChangeLogTable';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
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
});

export const TrayChangeTracker = ({
  tray,
  canExport = false,
}: {
  tray: Tray;
  canExport?: boolean;
}) => {
  const styles = useStyles();
  return (
    <Accordion collapsible defaultOpenItems={[]} key={tray.id}>
      <AccordionItem value="change-tracker" className={styles.card}>
        <AccordionHeader>Change tracker</AccordionHeader>
        <AccordionPanel>
          <ChangeLogTable
            entries={tray.changeLog}
            label="Change tracker"
            fileName={`tray-${tray.name}-change-log`}
            canExport={canExport}
          />
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
};
