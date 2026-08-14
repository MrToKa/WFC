import { useEffect, useMemo, useState } from 'react';
import {
  AddRegular,
  ArrowDownRegular,
  ArrowDownloadRegular,
  ArrowUpRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  CopyRegular,
  DeleteRegular,
  EditRegular,
  SaveRegular,
} from '@fluentui/react-icons';
import {
  Body1,
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  Toolbar,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  addChangeOrderItem,
  createChangeOrder,
  deleteChangeOrder,
  deleteChangeOrderItem,
  duplicateChangeOrderItem,
  exportChangeOrder,
  reorderChangeOrderItems,
  updateChangeOrder,
  updateChangeOrderItem,
  type ChangeOrderHeaderInput,
  type ChangeOrderItem,
  type ChangeOrderItemUpdate,
  type ChangeOrderSourceCatalog,
  type Project,
  type User,
} from '@/api/client';
import { useToast } from '@/context/ToastContext';
import { ChangeOrderItemDialog } from './ChangeOrderItemDialog';
import { ChangeOrderMaterialDialog } from './ChangeOrderMaterialDialog';
import { useChangeOrders } from './hooks/useChangeOrders';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  selectorRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'end',
    gap: tokens.spacingHorizontalM,
  },
  selector: {
    minWidth: '320px',
    flexGrow: 1,
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  headerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
  },
  fixedInfo: {
    display: 'flex',
    gap: tokens.spacingHorizontalXL,
    flexWrap: 'wrap',
    marginBottom: tokens.spacingVerticalM,
  },
  tableWrap: {
    overflowX: 'auto',
  },
  numeric: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    whiteSpace: 'nowrap',
  },
  itemCell: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    whiteSpace: 'nowrap',
  },
  expansionButton: {
    minWidth: '20px',
    width: '20px',
    height: '20px',
  },
  total: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingTop: tokens.spacingVerticalM,
  },
  warning: {
    color: tokens.colorPaletteRedForeground1,
  },
  inherited: {
    color: tokens.colorNeutralForeground3,
  },
});

const localDate = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const preparedByName = (user: User | null): string => {
  if (!user) return '';
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.email;
};

const defaultHeader = (project: Project, user: User | null): ChangeOrderHeaderInput => ({
  title: '',
  projectReference: project.projectNumber,
  preparedBy: preparedByName(user),
  reportDate: localDate(),
  revision: '00',
});

const toHeader = (details: {
  title: string;
  projectReference: string | null;
  preparedBy: string;
  reportDate: string;
  revision: string;
}): ChangeOrderHeaderInput => ({
  title: details.title,
  projectReference: details.projectReference,
  preparedBy: details.preparedBy,
  reportDate: details.reportDate,
  revision: details.revision,
});

const formatMoney = (amount: number): string =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    amount,
  );

type Props = {
  project: Project;
  token: string | null;
  currentUser: User | null;
};

export const ChangeOrdersTab = ({ project, token, currentUser }: Props) => {
  const styles = useStyles();
  const { showToast } = useToast();
  const {
    changeOrders,
    selectedId,
    details,
    loading,
    detailsLoading,
    error,
    setDetails,
    loadList,
    selectChangeOrder,
  } = useChangeOrders(project.id, token);
  const [header, setHeader] = useState<ChangeOrderHeaderInput>(() =>
    defaultHeader(project, currentUser),
  );
  const [headerDirty, setHeaderDirty] = useState(false);
  const [newMode, setNewMode] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [editingItem, setEditingItem] = useState<ChangeOrderItem | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!details) return;
    setHeader(toHeader(details));
    setHeaderDirty(false);
    setNewMode(false);
  }, [details]);

  useEffect(() => {
    setCollapsedParentIds(new Set());
  }, [selectedId]);

  const items = details?.items ?? [];
  const total = useMemo(() => items.reduce((sum, item) => sum + item.totalPrice, 0), [items]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const parentIdsWithInheritedItems = useMemo(
    () =>
      new Set(
        items
          .filter((item) => item.lineKind === 'inherited' && item.parentItemId)
          .map((item) => item.parentItemId as string),
      ),
    [items],
  );

  const toggleInheritedItems = (parentId: string): void => {
    setCollapsedParentIds((current) => {
      const next = new Set(current);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const canLeave = (): boolean =>
    !headerDirty || window.confirm('Discard unsaved Change Order header changes?');

  const choose = async (id: string): Promise<void> => {
    if (!canLeave()) return;
    setNewMode(false);
    await selectChangeOrder(id || null);
  };

  const startNew = async (): Promise<void> => {
    if (!canLeave()) return;
    await selectChangeOrder(null);
    setNewMode(true);
    setHeader(defaultHeader(project, currentUser));
    setHeaderDirty(false);
  };

  const setHeaderField = (field: keyof ChangeOrderHeaderInput, value: string): void => {
    setHeader((current) => ({ ...current, [field]: value }));
    setHeaderDirty(true);
  };

  const saveHeader = async (): Promise<void> => {
    if (!token) return;
    if (
      !header.title.trim() ||
      !header.preparedBy.trim() ||
      !header.reportDate ||
      !header.revision.trim()
    ) {
      showToast({
        title: 'Complete required fields',
        body: 'Title, Prepared by, Date, and Revision are required.',
        intent: 'error',
      });
      return;
    }
    setSavingHeader(true);
    try {
      if (newMode) {
        const response = await createChangeOrder(token, project.id, header);
        await loadList();
        await selectChangeOrder(response.changeOrder.id);
        showToast({ title: 'Change Order created', intent: 'success' });
      } else if (selectedId) {
        const response = await updateChangeOrder(token, project.id, selectedId, header);
        setHeader(toHeader(response.changeOrder));
        setHeaderDirty(false);
        await loadList();
        showToast({ title: 'Change Order saved', intent: 'success' });
      }
    } catch (caught) {
      showToast({
        title: 'Could not save Change Order',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setSavingHeader(false);
    }
  };

  const removeChangeOrder = async (): Promise<void> => {
    if (!token || !selectedId || !window.confirm('Delete this Change Order and all its rows?'))
      return;
    setPendingAction(true);
    try {
      await deleteChangeOrder(token, project.id, selectedId);
      const remaining = await loadList();
      await selectChangeOrder(remaining[0]?.id ?? null);
      showToast({ title: 'Change Order deleted', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Could not delete Change Order',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setPendingAction(false);
    }
  };

  const reloadActive = async (): Promise<void> => {
    await loadList();
    if (selectedId) await selectChangeOrder(selectedId);
  };

  const addMaterial = async (choice: {
    id: string;
    category: ChangeOrderSourceCatalog;
  }): Promise<void> => {
    if (!token || !selectedId) return;
    setAddingMaterial(true);
    try {
      const result = await addChangeOrderItem(token, project.id, selectedId, {
        sourceCatalog: choice.category,
        sourceMaterialId: choice.id,
      });
      setDetails(result.changeOrder);
      setCollapsedParentIds((current) => {
        const next = new Set(current);
        next.delete(result.item.id);
        return next;
      });
      setMaterialDialogOpen(false);
      await loadList();
      showToast({ title: 'Material added', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Could not add material',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setAddingMaterial(false);
    }
  };

  const saveItem = async (update: ChangeOrderItemUpdate): Promise<void> => {
    if (!token || !selectedId || !editingItem) return;
    setSavingItem(true);
    try {
      await updateChangeOrderItem(token, project.id, selectedId, editingItem.id, update);
      setEditingItem(null);
      await reloadActive();
      showToast({ title: 'Item saved', intent: 'success' });
    } catch (caught) {
      throw caught instanceof Error ? caught : new Error('Could not save item');
    } finally {
      setSavingItem(false);
    }
  };

  const removeItem = async (item: ChangeOrderItem): Promise<void> => {
    if (!token || !selectedId || !window.confirm(`Remove "${item.descriptionEn}"?`)) return;
    setPendingAction(true);
    try {
      await deleteChangeOrderItem(token, project.id, selectedId, item.id);
      await reloadActive();
      showToast({ title: 'Item removed', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Could not remove item',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setPendingAction(false);
    }
  };

  const duplicateItem = async (item: ChangeOrderItem): Promise<void> => {
    if (!token || !selectedId || item.lineKind === 'inherited') return;
    setPendingAction(true);
    try {
      const result = await duplicateChangeOrderItem(
        token,
        project.id,
        selectedId,
        item.id,
      );
      setDetails(result.changeOrder);
      setCollapsedParentIds((current) => {
        const next = new Set(current);
        next.delete(result.item.id);
        return next;
      });
      await loadList();
      setEditingItem(result.item);
      showToast({ title: 'Material duplicated', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Could not duplicate material',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setPendingAction(false);
    }
  };

  const moveItem = async (index: number, direction: -1 | 1): Promise<void> => {
    if (!token || !selectedId) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setPendingAction(true);
    try {
      await reorderChangeOrderItems(token, project.id, selectedId, ids);
      await reloadActive();
    } catch (caught) {
      showToast({
        title: 'Could not reorder items',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setPendingAction(false);
    }
  };

  const download = async (): Promise<void> => {
    if (!token || !selectedId || !details) return;
    setExporting(true);
    try {
      const result = await exportChangeOrder(token, project.id, selectedId, details.title);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
      showToast({ title: 'Change Order exported', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Could not export Change Order',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setExporting(false);
    }
  };

  if (!token) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          Sign in to view project Change Orders and commercial prices.
        </MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <section className={styles.root} aria-label="Change Orders">
      <div className={styles.selectorRow}>
        <Field label="Change Order" className={styles.selector}>
          <Select
            value={newMode ? '__new__' : (selectedId ?? '')}
            onChange={(event) => void choose(event.target.value)}
            disabled={loading || pendingAction}
          >
            <option value="">Select a Change Order</option>
            {newMode ? <option value="__new__">New unsaved Change Order</option> : null}
            {changeOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.title} · Rev {order.revision} · {order.itemCount} items
              </option>
            ))}
          </Select>
        </Field>
        <Button icon={<AddRegular />} onClick={() => void startNew()}>
          New Change Order
        </Button>
        <Button
          icon={<DeleteRegular />}
          disabled={!selectedId || newMode || pendingAction}
          onClick={() => void removeChangeOrder()}
        >
          Delete Change Order
        </Button>
      </div>

      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      {detailsLoading ? <Spinner label="Loading Change Order" /> : null}
      {loading ? <Spinner label="Loading Change Orders" /> : null}

      {(newMode || details) && !detailsLoading ? (
        <>
          <div className={styles.card}>
            <Title3>Header</Title3>
            <div className={styles.fixedInfo}>
              <Body1>
                <strong>Project:</strong> {project.name}
              </Body1>
              <Body1>
                <strong>Customer:</strong> {project.customer}
              </Body1>
            </div>
            <div className={styles.headerGrid}>
              <Field label="Title" required>
                <Input
                  value={header.title}
                  onChange={(_, data) => setHeaderField('title', data.value)}
                />
              </Field>
              <Field label="Project reference">
                <Input
                  value={header.projectReference ?? ''}
                  onChange={(_, data) => setHeaderField('projectReference', data.value)}
                />
              </Field>
              <Field label="Prepared by" required>
                <Input
                  value={header.preparedBy}
                  onChange={(_, data) => setHeaderField('preparedBy', data.value)}
                />
              </Field>
              <Field label="Date" required>
                <Input
                  type="date"
                  value={header.reportDate}
                  onChange={(_, data) => setHeaderField('reportDate', data.value)}
                />
              </Field>
              <Field label="Revision" required>
                <Input
                  value={header.revision}
                  onChange={(_, data) => setHeaderField('revision', data.value)}
                />
              </Field>
            </div>
            <Toolbar>
              <Button
                appearance="primary"
                icon={<SaveRegular />}
                disabled={savingHeader || (!newMode && !headerDirty)}
                onClick={() => void saveHeader()}
              >
                {savingHeader ? 'Saving…' : 'Save'}
              </Button>
              {headerDirty ? <Text>Unsaved header changes</Text> : null}
            </Toolbar>
          </div>

          <div className={styles.card}>
            <div className={styles.selectorRow}>
              <Title3>Materials</Title3>
              <Button
                icon={<AddRegular />}
                disabled={newMode || !selectedId || headerDirty || pendingAction}
                onClick={() => setMaterialDialogOpen(true)}
              >
                Add material
              </Button>
              <Button
                icon={<ArrowDownloadRegular />}
                disabled={
                  newMode ||
                  !selectedId ||
                  headerDirty ||
                  editingItem !== null ||
                  items.length === 0 ||
                  exporting ||
                  pendingAction
                }
                onClick={() => void download()}
              >
                {exporting ? 'Exporting…' : 'Export Excel'}
              </Button>
            </div>
            {newMode ? (
              <Text>Save the Change Order header before adding materials.</Text>
            ) : items.length === 0 ? (
              <Text>No materials have been added.</Text>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <Table size="small" aria-label="Change Order items">
                    <TableHeader>
                      <TableRow>
                        <TableHeaderCell>Item</TableHeaderCell>
                        <TableHeaderCell>Description</TableHeaderCell>
                        <TableHeaderCell>Design Qty</TableHeaderCell>
                        <TableHeaderCell>Order Qty</TableHeaderCell>
                        <TableHeaderCell>Spare Qty</TableHeaderCell>
                        <TableHeaderCell>Unit</TableHeaderCell>
                        <TableHeaderCell>Packaging</TableHeaderCell>
                        <TableHeaderCell>Ordered</TableHeaderCell>
                        <TableHeaderCell>Manufacturer</TableHeaderCell>
                        <TableHeaderCell>Part No.</TableHeaderCell>
                        <TableHeaderCell>Price/pcs</TableHeaderCell>
                        <TableHeaderCell>Total Price</TableHeaderCell>
                        <TableHeaderCell>Actions</TableHeaderCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, index) => {
                        if (
                          item.lineKind === 'inherited' &&
                          item.parentItemId &&
                          collapsedParentIds.has(item.parentItemId)
                        ) {
                          return null;
                        }

                        const hasInheritedItems = parentIdsWithInheritedItems.has(item.id);
                        const inheritedItemsCollapsed = collapsedParentIds.has(item.id);

                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className={styles.itemCell}>
                                <span>{index + 1}</span>
                                {hasInheritedItems ? (
                                  <Button
                                    size="small"
                                    appearance="subtle"
                                    className={styles.expansionButton}
                                    icon={
                                      inheritedItemsCollapsed ? (
                                        <ChevronRightRegular />
                                      ) : (
                                        <ChevronDownRegular />
                                      )
                                    }
                                    aria-label={`${
                                      inheritedItemsCollapsed ? 'Expand' : 'Collapse'
                                    } inherited standard materials for item ${index + 1}`}
                                    aria-expanded={!inheritedItemsCollapsed}
                                    title={
                                      inheritedItemsCollapsed
                                        ? 'Show inherited standard materials'
                                        : 'Hide inherited standard materials'
                                    }
                                    onClick={() => toggleInheritedItems(item.id)}
                                  />
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>{item.descriptionEn}</div>
                              {item.lineKind === 'inherited' ? (
                                <Caption1 className={styles.inherited}>
                                  Inherited Standard Material
                                  {item.parentItemId
                                    ? ` for ${itemsById.get(item.parentItemId)?.descriptionEn ?? 'parent material'}`
                                    : ''}
                                  {item.quantityPerParent !== null &&
                                  item.quantityPerParent !== undefined
                                    ? ` · ${item.quantityPerParent} per ${
                                        item.parentItemId &&
                                        itemsById.get(item.parentItemId)?.sourceCatalog ===
                                          'cable-type'
                                          ? 'cable'
                                          : 'parent'
                                      }`
                                    : ''}
                                </Caption1>
                              ) : null}
                            </TableCell>
                            <TableCell className={styles.numeric}>{item.designQuantity}</TableCell>
                            <TableCell className={styles.numeric}>{item.orderQuantity}</TableCell>
                            <TableCell
                              className={mergeClasses(
                                styles.numeric,
                                item.spareQuantity < 0 && styles.warning,
                              )}
                            >
                              {item.spareQuantity}
                            </TableCell>
                            <TableCell>{item.unit ?? '—'}</TableCell>
                            <TableCell>
                              {[item.packaging, item.packagingQuantity, item.packagingUnit]
                                .filter((part) => part !== null && part !== '')
                                .join(' ') || '—'}
                            </TableCell>
                            <TableCell>
                              {[item.orderedQuantity, item.orderedUnit]
                                .filter((part) => part !== null && part !== '')
                                .join(' ') || '—'}
                            </TableCell>
                            <TableCell>{item.manufacturer ?? '—'}</TableCell>
                            <TableCell>{item.manufacturerPartNo ?? '—'}</TableCell>
                            <TableCell className={styles.numeric}>
                              {formatMoney(item.unitPrice)}
                            </TableCell>
                            <TableCell className={styles.numeric}>
                              {formatMoney(item.totalPrice)}
                            </TableCell>
                            <TableCell>
                              <div className={styles.actions}>
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<EditRegular />}
                                  aria-label={`Edit item ${index + 1}`}
                                  title="Edit"
                                  onClick={() => setEditingItem(item)}
                                />
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<CopyRegular />}
                                  aria-label={`Duplicate item ${index + 1}`}
                                  title="Duplicate"
                                  disabled={pendingAction || item.lineKind === 'inherited'}
                                  onClick={() => void duplicateItem(item)}
                                />
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<DeleteRegular />}
                                  aria-label={`Delete item ${index + 1}`}
                                  title="Delete"
                                  disabled={pendingAction || item.lineKind === 'inherited'}
                                  onClick={() => void removeItem(item)}
                                />
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<ArrowUpRegular />}
                                  aria-label={`Move item ${index + 1} up`}
                                  title="Move up"
                                  disabled={
                                    index === 0 || pendingAction || item.lineKind === 'inherited'
                                  }
                                  onClick={() => void moveItem(index, -1)}
                                />
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<ArrowDownRegular />}
                                  aria-label={`Move item ${index + 1} down`}
                                  title="Move down"
                                  disabled={
                                    index === items.length - 1 ||
                                    pendingAction ||
                                    item.lineKind === 'inherited'
                                  }
                                  onClick={() => void moveItem(index, 1)}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <Body1 className={styles.total}>
                  <strong>Total: {formatMoney(total)}</strong>
                </Body1>
              </>
            )}
          </div>
        </>
      ) : null}

      {!loading &&
      !detailsLoading &&
      !newMode &&
      !details &&
      changeOrders.length > 0 ? (
        <div className={styles.card}>
          <Title3>All Change Orders</Title3>
          <div className={styles.tableWrap}>
            <Table size="small" aria-label="All Change Orders">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Project reference</TableHeaderCell>
                  <TableHeaderCell>Revision</TableHeaderCell>
                  <TableHeaderCell>Report date</TableHeaderCell>
                  <TableHeaderCell>Prepared by</TableHeaderCell>
                  <TableHeaderCell>Items</TableHeaderCell>
                  <TableHeaderCell>Total price</TableHeaderCell>
                  <TableHeaderCell>Updated</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>{order.title}</TableCell>
                    <TableCell>{order.projectReference ?? '—'}</TableCell>
                    <TableCell>{order.revision}</TableCell>
                    <TableCell>{order.reportDate}</TableCell>
                    <TableCell>{order.preparedBy}</TableCell>
                    <TableCell className={styles.numeric}>{order.itemCount}</TableCell>
                    <TableCell className={styles.numeric}>
                      {formatMoney(order.totalPrice)}
                    </TableCell>
                    <TableCell>{order.updatedAt.slice(0, 10)}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        onClick={() => void choose(order.id)}
                        disabled={pendingAction}
                        aria-label={`Open ${order.title}`}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {!loading && !detailsLoading && !newMode && changeOrders.length === 0 ? (
        <Text>No Change Orders yet. Create the first one to begin.</Text>
      ) : null}

      <ChangeOrderMaterialDialog
        open={materialDialogOpen}
        adding={addingMaterial}
        onDismiss={() => setMaterialDialogOpen(false)}
        onSelect={addMaterial}
      />
      <ChangeOrderItemDialog
        item={editingItem}
        saving={savingItem}
        onDismiss={() => setEditingItem(null)}
        onSave={saveItem}
      />
    </section>
  );
};
