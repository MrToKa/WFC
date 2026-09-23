import { ChangeLogTable } from '@/components/ChangeLogTable';
import { canEditProject, canExportChangeLogs } from '@/utils/permissions';
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
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
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
  ToggleButton,
  Toolbar,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  createChangeOrder,
  deleteChangeOrder,
  exportChangeOrder,
  previewChangeOrderMaterials,
  saveChangeOrderMaterials,
  type ChangeOrderDetails,
  type ChangeOrderMaterialOperation,
  updateChangeOrder,
  type ChangeOrderCollection,
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
import { ChangeOrderSummaryTable } from './ChangeOrderSummaryTable';
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
  viewButtons: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
  },
  viewButton: {
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    ':hover': {
      color: tokens.colorBrandForeground1,
      backgroundColor: tokens.colorBrandBackground2,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
    },
    '&[aria-pressed="true"]': {
      color: tokens.colorNeutralForegroundOnBrand,
      backgroundColor: tokens.colorBrandBackground,
      ...shorthands.borderColor(tokens.colorBrandBackground),
      ':hover': {
        color: tokens.colorNeutralForegroundOnBrand,
        backgroundColor: tokens.colorBrandBackgroundHover,
        ...shorthands.borderColor(tokens.colorBrandBackgroundHover),
      },
    },
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

const createMaterialOperationId = (): string => {
  // getRandomValues also works when the app is opened over HTTP on the local network.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

type Props = {
  project: Project;
  token: string | null;
  currentUser: User | null;
  canEdit?: boolean;
  collection?: ChangeOrderCollection;
};

const DOCUMENT_LABELS: Record<
  ChangeOrderCollection,
  { singular: string; plural: string; article: 'a' | 'an' }
> = {
  'change-orders': { singular: 'Change Order', plural: 'Change Orders', article: 'a' },
  'internal-ncrs': { singular: 'Internal NCR', plural: 'Internal NCRs', article: 'an' },
};

export const ChangeOrdersTab = ({
  project,
  token,
  currentUser,
  canEdit = canEditProject(currentUser, project),
  collection = 'change-orders',
}: Props) => {
  const styles = useStyles();
  const { showToast } = useToast();
  const labels = DOCUMENT_LABELS[collection];
  const {
    changeOrders,
    selectedId,
    details: savedDetails,
    loading,
    detailsLoading,
    error,
    setDetails,
    loadList,
    selectChangeOrder,
  } = useChangeOrders(project.id, token, {
    collection,
    singularLabel: labels.singular,
    pluralLabel: labels.plural,
  });
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
  const [expandedParentIds, setExpandedParentIds] = useState<Set<string>>(() => new Set());
  const [materialView, setMaterialView] = useState<'detailed' | 'compact'>('detailed');

  const [materialsEditing, setMaterialsEditing] = useState(false);
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [newRevision, setNewRevision] = useState(false);
  const [draftDetails, setDraftDetails] = useState<ChangeOrderDetails | null>(null);
  const [operations, setOperations] = useState<ChangeOrderMaterialOperation[]>([]);
  const [savingMaterials, setSavingMaterials] = useState(false);
  const details = draftDetails ?? savedDetails;
  const materialsDirty = materialsEditing && (operations.length > 0 || newRevision);
  const materialBusy = pendingAction || addingMaterial || savingItem || savingMaterials;
  const materialsLocked = !canEdit || !materialsEditing || materialBusy;

  useEffect(() => {
    if (!savedDetails) return;
    setHeader(toHeader(savedDetails));
    setHeaderDirty(false);
    setNewMode(false);
  }, [savedDetails]);

  useEffect(() => {
    setExpandedParentIds(new Set());
  }, [selectedId]);

  useEffect(() => {
    setMaterialsEditing(false);
    setMaterialView('detailed');
    setDraftDetails(null);
    setOperations([]);
    setNewRevision(false);
    setEditingItem(null);
    setMaterialDialogOpen(false);
    setRevisionDialogOpen(false);
    setHeaderDirty(false);
    setNewMode(false);
  }, [project.id, collection, token, canEdit]);

  const items = details?.items ?? [];
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const mainItems = useMemo(() => items.filter((item) => item.lineKind !== 'inherited'), [items]);
  const mainItemIndexes = useMemo(
    () => new Map(mainItems.map((item, index) => [item.id, index])),
    [mainItems],
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
    setExpandedParentIds((current) => {
      const next = new Set(current);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  useEffect(() => {
    if (!materialsDirty && !headerDirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [materialsDirty, headerDirty]);

  const resetMaterials = (): void => {
    setMaterialsEditing(false);
    setDraftDetails(null);
    setOperations([]);
    setNewRevision(false);
    setEditingItem(null);
    setMaterialDialogOpen(false);
    setRevisionDialogOpen(false);
  };

  const canLeave = (): boolean =>
    (!headerDirty && !materialsDirty) || window.confirm('Discard unsaved document changes?');

  const startMaterials = (createRevision: boolean): void => {
    if (!canEdit || !savedDetails) return;
    setMaterialView('detailed');
    setNewRevision(createRevision);
    setOperations([]);
    setDraftDetails({
      ...savedDetails,
      revision: createRevision
        ? String(
            (/^\d+$/.test(savedDetails.revision) ? BigInt(savedDetails.revision) : 0n) + 1n,
          ).padStart(2, '0')
        : savedDetails.revision,
    });
    setMaterialsEditing(true);
    setRevisionDialogOpen(false);
  };

  const stageMaterialOperation = async (
    operation: ChangeOrderMaterialOperation,
  ): Promise<ChangeOrderDetails> => {
    if (!canEdit || !token || !selectedId || !savedDetails || !materialsEditing)
      throw new Error('Start editing materials first.');
    const nextOperations = [...operations, operation];
    const response = await previewChangeOrderMaterials(
      token,
      project.id,
      selectedId,
      {
        expectedUpdatedAt: savedDetails.updatedAt,
        newRevision,
        operations: nextOperations,
      },
      collection,
    );
    setOperations(nextOperations);
    setDraftDetails(response.changeOrder);
    return response.changeOrder;
  };

  const saveMaterials = async (): Promise<void> => {
    if (!canEdit || !token || !selectedId || !savedDetails || !materialsEditing || materialBusy)
      return;
    setSavingMaterials(true);
    try {
      const response = await saveChangeOrderMaterials(
        token,
        project.id,
        selectedId,
        {
          expectedUpdatedAt: savedDetails.updatedAt,
          newRevision,
          operations,
        },
        collection,
      );
      resetMaterials();
      setDetails(response.changeOrder);
      await loadList();
      showToast({ title: 'Materials saved', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Could not save materials',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setSavingMaterials(false);
    }
  };

  const choose = async (id: string): Promise<void> => {
    if (!canLeave()) return;
    resetMaterials();
    setNewMode(false);
    await selectChangeOrder(id || null);
  };

  const startNew = async (): Promise<void> => {
    if (!canEdit) return;
    if (!canLeave()) return;
    resetMaterials();
    await selectChangeOrder(null);
    setNewMode(true);
    setHeader(defaultHeader(project, currentUser));
    setHeaderDirty(false);
  };

  const setHeaderField = (field: keyof ChangeOrderHeaderInput, value: string): void => {
    if (!canEdit) return;
    setHeader((current) => ({ ...current, [field]: value }));
    setHeaderDirty(true);
  };

  const saveHeader = async (): Promise<void> => {
    if (!canEdit || !token) return;
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
        const response = await createChangeOrder(token, project.id, header, collection);
        await loadList();
        await selectChangeOrder(response.changeOrder.id);
        showToast({ title: `${labels.singular} created`, intent: 'success' });
      } else if (selectedId) {
        const response = await updateChangeOrder(token, project.id, selectedId, header, collection);
        setDetails(response.changeOrder);
        setHeader(toHeader(response.changeOrder));
        setHeaderDirty(false);
        await loadList();
        showToast({ title: `${labels.singular} saved`, intent: 'success' });
      }
    } catch (caught) {
      showToast({
        title: `Could not save ${labels.singular}`,
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setSavingHeader(false);
    }
  };

  const removeChangeOrder = async (): Promise<void> => {
    if (!canEdit) return;
    if (
      !token ||
      !selectedId ||
      !window.confirm(`Delete this ${labels.singular} and all its rows?`)
    )
      return;
    setPendingAction(true);
    try {
      await deleteChangeOrder(token, project.id, selectedId, collection);
      const remaining = await loadList();
      await selectChangeOrder(remaining[0]?.id ?? null);
      showToast({ title: `${labels.singular} deleted`, intent: 'success' });
    } catch (caught) {
      showToast({
        title: `Could not delete ${labels.singular}`,
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setPendingAction(false);
    }
  };

  const addMaterial = async (choice: {
    id: string;
    category: ChangeOrderSourceCatalog;
  }): Promise<void> => {
    if (!canEdit || !token || !selectedId) return;
    setAddingMaterial(true);
    try {
      const updated = await stageMaterialOperation({
        type: 'add',
        id: createMaterialOperationId(),
        sourceCatalog: choice.category,
        sourceMaterialId: choice.id,
      });
      const added = updated.items.find(
        (item) => item.lineKind !== 'inherited' && !itemsById.has(item.id),
      );
      setMaterialDialogOpen(false);
      setEditingItem(added ?? null);
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
    if (!canEdit || !token || !selectedId || !editingItem) return;
    setSavingItem(true);
    try {
      await stageMaterialOperation({ type: 'update', itemId: editingItem.id, input: update });
      setEditingItem(null);
      showToast({ title: 'Item updated in draft', intent: 'success' });
    } catch (caught) {
      throw caught instanceof Error ? caught : new Error('Could not save item');
    } finally {
      setSavingItem(false);
    }
  };

  const removeItem = async (item: ChangeOrderItem): Promise<void> => {
    const confirmation =
      item.lineKind === 'inherited'
        ? `Remove "${item.descriptionEn}" from this ${labels.singular}? The source material and its Standard Materials will remain unchanged.`
        : `Remove "${item.descriptionEn}"?`;
    if (!canEdit || !token || !selectedId || !window.confirm(confirmation)) return;
    setPendingAction(true);
    try {
      await stageMaterialOperation({ type: 'delete', itemId: item.id });
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
    if (!canEdit || !token || !selectedId) return;
    setPendingAction(true);
    try {
      const updated = await stageMaterialOperation({
        type: 'duplicate',
        id: createMaterialOperationId(),
        itemId: item.id,
      });
      const added = updated.items.find(
        (row) => row.lineKind !== 'inherited' && !itemsById.has(row.id),
      );
      setEditingItem(added ?? null);
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

  const moveItem = async (itemId: string, direction: -1 | 1): Promise<void> => {
    if (!canEdit || !token || !selectedId) return;
    const mainItemIndex = mainItemIndexes.get(itemId);
    if (mainItemIndex === undefined) return;
    const targetMainItemIndex = mainItemIndex + direction;
    if (targetMainItemIndex < 0 || targetMainItemIndex >= mainItems.length) return;

    const reorderedMainItems = [...mainItems];
    [reorderedMainItems[mainItemIndex], reorderedMainItems[targetMainItemIndex]] = [
      reorderedMainItems[targetMainItemIndex],
      reorderedMainItems[mainItemIndex],
    ];

    const groupedItemIds = new Set<string>();
    const ids = reorderedMainItems.flatMap((mainItem) => {
      const group = [
        mainItem.id,
        ...items
          .filter((item) => item.lineKind === 'inherited' && item.parentItemId === mainItem.id)
          .map((item) => item.id),
      ];
      group.forEach((id) => groupedItemIds.add(id));
      return group;
    });

    // Keep any legacy orphaned rows in the request so the API still receives every item exactly once.
    ids.push(...items.filter((item) => !groupedItemIds.has(item.id)).map((item) => item.id));
    setPendingAction(true);
    try {
      await stageMaterialOperation({ type: 'reorder', orderedItemIds: ids });
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
      const result = await exportChangeOrder(
        token,
        project.id,
        selectedId,
        details.title,
        collection,
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
      showToast({ title: `${labels.singular} exported`, intent: 'success' });
    } catch (caught) {
      showToast({
        title: `Could not export ${labels.singular}`,
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
          Sign in to view project {labels.plural} and commercial prices.
        </MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <section className={styles.root} aria-label={labels.plural}>
      <div className={styles.selectorRow}>
        <Field label={labels.singular} className={styles.selector}>
          <Select
            value={newMode ? '__new__' : (selectedId ?? '')}
            onChange={(event) => void choose(event.target.value)}
            disabled={loading || materialBusy || savingHeader}
          >
            <option value="">
              Select {labels.article} {labels.singular}
            </option>
            {newMode ? <option value="__new__">New unsaved {labels.singular}</option> : null}
            {changeOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.title} · Rev {order.revision} · {order.itemCount} items
              </option>
            ))}
          </Select>
        </Field>
        {canEdit ? (
          <Button
            icon={<AddRegular />}
            disabled={materialBusy || savingHeader}
            onClick={() => void startNew()}
          >
            New {labels.singular}
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            icon={<DeleteRegular />}
            disabled={!selectedId || newMode || materialBusy || materialsEditing || savingHeader}
            onClick={() => void removeChangeOrder()}
          >
            Delete {labels.singular}
          </Button>
        ) : null}
      </div>

      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      {detailsLoading ? <Spinner label={`Loading ${labels.singular}`} /> : null}
      {loading ? <Spinner label={`Loading ${labels.plural}`} /> : null}

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
                  disabled={!canEdit || materialsEditing || savingHeader}
                  value={header.title}
                  onChange={(_, data) => setHeaderField('title', data.value)}
                />
              </Field>
              <Field label="Project reference">
                <Input
                  disabled={!canEdit || materialsEditing || savingHeader}
                  value={header.projectReference ?? ''}
                  onChange={(_, data) => setHeaderField('projectReference', data.value)}
                />
              </Field>
              <Field label="Prepared by" required>
                <Input aria-label="Prepared by" value={header.preparedBy} disabled />
              </Field>
              <Field label="Date" required>
                <Input
                  aria-label="Date"
                  type="date"
                  disabled={!canEdit || materialsEditing || savingHeader}
                  value={header.reportDate}
                  onChange={(_, data) => setHeaderField('reportDate', data.value)}
                />
              </Field>
              <Field label="Revision" required>
                <Input
                  aria-label="Revision"
                  value={
                    materialsEditing ? (details?.revision ?? header.revision) : header.revision
                  }
                  disabled
                />
              </Field>
            </div>
            <Toolbar>
              {canEdit ? (
                <Button
                  appearance="primary"
                  icon={<SaveRegular />}
                  disabled={materialsEditing || savingHeader || (!newMode && !headerDirty)}
                  onClick={() => void saveHeader()}
                >
                  {savingHeader ? 'Saving…' : 'Save'}
                </Button>
              ) : null}
              {headerDirty ? <Text>Unsaved header changes</Text> : null}
            </Toolbar>
          </div>

          <div className={styles.card}>
            <div className={styles.selectorRow}>
              <Title3>Materials</Title3>
              {canEdit ? (
                <Button
                  icon={<EditRegular />}
                  disabled={
                    newMode ||
                    !selectedId ||
                    headerDirty ||
                    materialsEditing ||
                    materialBusy ||
                    savingHeader
                  }
                  onClick={() => setRevisionDialogOpen(true)}
                >
                  Edit materials
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  appearance="primary"
                  icon={<SaveRegular />}
                  disabled={
                    !materialsEditing || materialBusy || editingItem !== null || materialDialogOpen
                  }
                  onClick={() => void saveMaterials()}
                >
                  {savingMaterials ? 'Saving materials…' : 'Save materials'}
                </Button>
              ) : null}
              {materialsEditing ? (
                <Button
                  disabled={materialBusy}
                  onClick={() => {
                    if (!materialsDirty || window.confirm('Discard unsaved material changes?'))
                      resetMaterials();
                  }}
                >
                  Cancel editing
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  icon={<AddRegular />}
                  disabled={newMode || !selectedId || headerDirty || materialsLocked}
                  onClick={() => {
                    setMaterialView('detailed');
                    setMaterialDialogOpen(true);
                  }}
                >
                  Add material
                </Button>
              ) : null}
              <Button
                icon={<ArrowDownloadRegular />}
                disabled={
                  newMode ||
                  materialsEditing ||
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
              {!newMode && items.length > 0 ? (
                <div className={styles.viewButtons} role="group" aria-label="Materials view">
                  <ToggleButton
                    className={styles.viewButton}
                    checked={materialView === 'detailed'}
                    onClick={() => setMaterialView('detailed')}
                  >
                    Detailed view
                  </ToggleButton>
                  <ToggleButton
                    className={styles.viewButton}
                    checked={materialView === 'compact'}
                    onClick={() => setMaterialView('compact')}
                  >
                    Export view
                  </ToggleButton>
                </div>
              ) : null}
            </div>
            {materialsEditing ? (
              <Text>
                {materialsDirty ? 'Unsaved material changes. ' : ''}Use Save materials to save and
                lock the table.
              </Text>
            ) : null}
            {newMode ? (
              <Text>Save the {labels.singular} header before adding materials.</Text>
            ) : items.length === 0 ? (
              <Text>No materials have been added.</Text>
            ) : (
              <>
                {materialView === 'compact' ? (
                  <ChangeOrderSummaryTable
                    items={items}
                    documentLabel={labels.singular}
                    canEdit={canEdit}
                  />
                ) : (
                  <div className={styles.tableWrap}>
                    <Table size="small" aria-label={`${labels.singular} items`}>
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
                            !expandedParentIds.has(item.parentItemId)
                          ) {
                            return null;
                          }

                          const hasInheritedItems = parentIdsWithInheritedItems.has(item.id);
                          const inheritedItemsExpanded = expandedParentIds.has(item.id);
                          const mainItemIndex = mainItemIndexes.get(item.id);
                          // Match Excel's full-package quantity; orderQuantity stores unrounded demand.
                          const displayedOrderQuantity =
                            item.packagingQuantity !== null &&
                            item.packagingQuantity > 0 &&
                            item.orderedQuantity !== null
                              ? item.packagingQuantity * item.orderedQuantity
                              : item.orderQuantity;

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
                                        inheritedItemsExpanded ? (
                                          <ChevronDownRegular />
                                        ) : (
                                          <ChevronRightRegular />
                                        )
                                      }
                                      aria-label={`${
                                        inheritedItemsExpanded ? 'Collapse' : 'Expand'
                                      } inherited standard materials for item ${index + 1}`}
                                      aria-expanded={inheritedItemsExpanded}
                                      title={
                                        inheritedItemsExpanded
                                          ? 'Hide inherited standard materials'
                                          : 'Show inherited standard materials'
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
                              <TableCell className={styles.numeric}>
                                {item.designQuantity}
                              </TableCell>
                              <TableCell className={styles.numeric}>
                                {displayedOrderQuantity}
                              </TableCell>
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
                                  {canEdit ? (
                                    <Button
                                      size="small"
                                      appearance="subtle"
                                      icon={<EditRegular />}
                                      aria-label={`Edit item ${index + 1}`}
                                      title="Edit"
                                      disabled={materialsLocked}
                                      onClick={() => setEditingItem(item)}
                                    />
                                  ) : null}
                                  {canEdit ? (
                                    <Button
                                      size="small"
                                      appearance="subtle"
                                      icon={<CopyRegular />}
                                      aria-label={`Duplicate item ${index + 1}`}
                                      title={
                                        item.lineKind === 'inherited'
                                          ? 'Duplicate as main material'
                                          : 'Duplicate'
                                      }
                                      disabled={materialsLocked}
                                      onClick={() => void duplicateItem(item)}
                                    />
                                  ) : null}
                                  {canEdit ? (
                                    <Button
                                      size="small"
                                      appearance="subtle"
                                      icon={<DeleteRegular />}
                                      aria-label={`Delete item ${index + 1}`}
                                      title={`Remove from this ${labels.singular}`}
                                      disabled={materialsLocked}
                                      onClick={() => void removeItem(item)}
                                    />
                                  ) : null}
                                  {canEdit ? (
                                    <Button
                                      size="small"
                                      appearance="subtle"
                                      icon={<ArrowUpRegular />}
                                      aria-label={`Move item ${index + 1} up`}
                                      title="Move up"
                                      disabled={
                                        mainItemIndex === undefined ||
                                        mainItemIndex === 0 ||
                                        materialsLocked
                                      }
                                      onClick={() => void moveItem(item.id, -1)}
                                    />
                                  ) : null}
                                  {canEdit ? (
                                    <Button
                                      size="small"
                                      appearance="subtle"
                                      icon={<ArrowDownRegular />}
                                      aria-label={`Move item ${index + 1} down`}
                                      title="Move down"
                                      disabled={
                                        mainItemIndex === undefined ||
                                        mainItemIndex === mainItems.length - 1 ||
                                        materialsLocked ||
                                        mainItems.length === 0
                                      }
                                      onClick={() => void moveItem(item.id, 1)}
                                    />
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : null}

      {!loading && !detailsLoading && !newMode && !details && changeOrders.length > 0 ? (
        <div className={styles.card}>
          <Title3>All {labels.plural}</Title3>
          <div className={styles.tableWrap}>
            <Table size="small" aria-label={`All ${labels.plural}`}>
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
        <Text>No {labels.plural} yet. Create the first one to begin.</Text>
      ) : null}

      {savedDetails && !newMode ? (
        <Accordion collapsible defaultOpenItems={[]} key={`${collection}-${savedDetails.id}`}>
          <AccordionItem value="change-log" className={styles.card}>
            <AccordionHeader>Change log</AccordionHeader>
            <AccordionPanel>
              <ChangeLogTable
                entries={savedDetails.changeLog}
                showRevision
                fileName={`${collection}-${savedDetails.title}-change-log`}
                canExport={canExportChangeLogs(currentUser, token)}
              />
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      ) : null}
      <Dialog
        open={revisionDialogOpen}
        onOpenChange={(_, data) => setRevisionDialogOpen(data.open)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Edit materials</DialogTitle>
            <DialogContent>
              Create a new revision for these material changes? The revision and changes will be
              saved when you select Save materials.
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRevisionDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => startMaterials(false)}>Keep current revision</Button>
              <Button appearance="primary" onClick={() => startMaterials(true)}>
                New revision
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <ChangeOrderMaterialDialog
        open={materialDialogOpen}
        adding={addingMaterial}
        documentName={labels.singular}
        onDismiss={() => setMaterialDialogOpen(false)}
        onSelect={addMaterial}
      />
      <ChangeOrderItemDialog
        item={editingItem}
        saving={savingItem}
        currentRevision={details?.revision ?? header.revision}
        documentName={labels.singular}
        onDismiss={() => setEditingItem(null)}
        onSave={saveItem}
      />
    </section>
  );
};
