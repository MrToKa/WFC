import {
  Body1,
  Button,
  Card,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { StandardMaterialAssignment } from '@/api/client';

const useStyles = makeStyles({
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  table: {
    overflowX: 'auto',
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
  },
});

type StandardMaterialsSectionProps = {
  items: StandardMaterialAssignment[];
  isAdmin: boolean;
  busyId: string | null;
  catalogLoading: boolean;
  onAdd: () => void;
  onEdit: (item: StandardMaterialAssignment) => void;
  onDelete: (item: StandardMaterialAssignment) => void;
};

export const StandardMaterialsSection = ({
  items,
  isAdmin,
  busyId,
  catalogLoading,
  onAdd,
  onEdit,
  onDelete,
}: StandardMaterialsSectionProps) => {
  const styles = useStyles();
  return (
    <Card>
      <div className={styles.header}>
        <Title3 as="h2">Standard Materials</Title3>
        {isAdmin ? (
          <Button appearance="primary" onClick={onAdd} disabled={catalogLoading}>
            Add Standard Material
          </Button>
        ) : null}
      </div>
      {catalogLoading ? <Spinner label="Loading material catalog..." /> : null}
      {items.length === 0 ? (
        <Body1>No Standard Materials are assigned.</Body1>
      ) : (
        <div className={styles.table}>
          <Table aria-label="Standard Materials">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Material</TableHeaderCell>
                <TableHeaderCell>Quantity</TableHeaderCell>
                <TableHeaderCell>Unit</TableHeaderCell>
                <TableHeaderCell>Remarks</TableHeaderCell>
                {isAdmin ? <TableHeaderCell>Actions</TableHeaderCell> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.referencedMaterial.type}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell>{item.remarks ?? '—'}</TableCell>
                  {isAdmin ? (
                    <TableCell>
                      <div className={styles.actions}>
                        <Button
                          size="small"
                          onClick={() => onEdit(item)}
                          disabled={busyId === item.id}
                        >
                          Edit
                        </Button>
                        <Button
                          size="small"
                          appearance="secondary"
                          onClick={() => onDelete(item)}
                          disabled={busyId === item.id}
                        >
                          {busyId === item.id ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!isAdmin ? <Body1>Standard Materials are read-only for non-admin users.</Body1> : null}
    </Card>
  );
};
