import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  createStandardMaterial,
  deleteStandardMaterial,
  fetchMaterialCableInstallationMaterials,
  fetchMaterialDetails,
  fetchMaterialTrayInstallationMaterials,
  fetchMaterialInstrumentInstallationMaterials,
  updateStandardMaterial,
  type MaterialCableInstallationMaterial,
  type MaterialTrayInstallationMaterial,
  type MaterialDetailsResponse,
  type StandardMaterialAssignment,
  type StandardMaterialInput,
  type StandardMaterialOwner,
  type StandardMaterialOwnerCategory,
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  MaterialDetailsError,
  MaterialDetailsLayout,
  MaterialDetailsLoading,
  type MaterialProperty,
} from './components/MaterialDetailsLayout';
import { StandardMaterialDialog } from './components/StandardMaterialDialog';
import { MaterialEditDialog } from './components/MaterialEditDialog';
import { StandardMaterialsSection } from './components/StandardMaterialsSection';
import { MATERIAL_DETAILS_CAPABILITIES, materialsBackPath } from './materialCapabilities';

type MasterMaterialDetailsPageProps<T extends StandardMaterialOwner> = {
  category: StandardMaterialOwnerCategory;
  idParam: string;
  getTitle: (material: T) => string;
  getProperties: (material: T) => MaterialProperty[];
};

type StandardMaterialCatalogItem =
  | MaterialCableInstallationMaterial
  | MaterialTrayInstallationMaterial;

export const MasterMaterialDetailsPage = <T extends StandardMaterialOwner>({
  category,
  idParam,
  getTitle,
  getProperties,
}: MasterMaterialDetailsPageProps<T>) => {
  const params = useParams();
  const ownerId = params[idParam] ?? '';
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const capability = MATERIAL_DETAILS_CAPABILITIES[category];
  const [details, setDetails] = useState<MaterialDetailsResponse<T> | null>(null);
  const [catalog, setCatalog] = useState<StandardMaterialCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StandardMaterialAssignment | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAdmin = Boolean(user?.isAdmin);
  const backPath = materialsBackPath(capability.tab);
  const usesTrayInstallationCatalog = category === 'tray-installation-material';
  const usesInstrumentInstallationCatalog =
    category === 'instrument' || category === 'instrument-installation-material';
  const standardMaterialCatalogItemLabel = usesInstrumentInstallationCatalog
    ? 'Instrument Installation Material'
    : usesTrayInstallationCatalog
      ? 'Tray Installation Material'
      : 'Cable Installation Material';

  const loadDetails = useCallback(
    async (silent = false): Promise<void> => {
      if (!ownerId) {
        setError('The material identifier is missing.');
        setLoading(false);
        return;
      }
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        setDetails(await fetchMaterialDetails<T>(category, ownerId));
      } catch (caught) {
        setError(
          caught instanceof ApiError && caught.status === 404
            ? `${capability.label} not found.`
            : `Unable to load ${capability.label.toLowerCase()} details.`,
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [capability.label, category, ownerId],
  );

  const loadCatalog = useCallback(async (): Promise<void> => {
    if (!isAdmin) return;
    setCatalogLoading(true);
    try {
      if (usesInstrumentInstallationCatalog) {
        const response = await fetchMaterialInstrumentInstallationMaterials();
        setCatalog(response.instrumentInstallationMaterials);
      } else if (usesTrayInstallationCatalog) {
        const response = await fetchMaterialTrayInstallationMaterials();
        setCatalog(response.trayInstallationMaterials);
      } else {
        const response = await fetchMaterialCableInstallationMaterials();
        setCatalog(response.cableInstallationMaterials);
      }
    } catch {
      showToast({
        title: `Unable to load ${standardMaterialCatalogItemLabel}s`,
        intent: 'error',
      });
    } finally {
      setCatalogLoading(false);
    }
  }, [
    isAdmin,
    showToast,
    standardMaterialCatalogItemLabel,
    usesTrayInstallationCatalog,
    usesInstrumentInstallationCatalog,
  ]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const openAdd = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (assignment: StandardMaterialAssignment): void => {
    setEditing(assignment);
    setDialogOpen(true);
  };

  const save = async (input: StandardMaterialInput): Promise<void> => {
    if (!token) return;
    setSaving(true);
    try {
      if (editing) {
        await updateStandardMaterial(token, category, ownerId, editing.id, input);
      } else {
        await createStandardMaterial(token, category, ownerId, input);
      }
      setDialogOpen(false);
      setEditing(null);
      await loadDetails(true);
      showToast({
        title: editing ? 'Standard Material updated' : 'Standard Material added',
        intent: 'success',
      });
    } catch (caught) {
      showToast({
        title: 'Unable to save Standard Material',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (assignment: StandardMaterialAssignment): Promise<void> => {
    if (
      !token ||
      !window.confirm(`Delete Standard Material "${assignment.referencedMaterial.type}"?`)
    ) {
      return;
    }
    setBusyId(assignment.id);
    try {
      await deleteStandardMaterial(token, category, ownerId, assignment.id);
      await loadDetails(true);
      showToast({ title: 'Standard Material deleted', intent: 'success' });
    } catch (caught) {
      showToast({
        title: 'Unable to delete Standard Material',
        body: caught instanceof Error ? caught.message : undefined,
        intent: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  const goBack = (): void => {
    void navigate(backPath);
  };

  const editMaterial = (): void => {
    setEditDialogOpen(true);
  };

  if (loading) return <MaterialDetailsLoading />;
  if (error || !details) {
    return (
      <MaterialDetailsError
        message={error ?? 'Material details are unavailable.'}
        onBack={goBack}
        onRetry={() => void loadDetails()}
      />
    );
  }

  return (
    <>
      <MaterialDetailsLayout
        title={getTitle(details.material)}
        categoryLabel={details.category.label}
        properties={getProperties(details.material)}
        createdAt={details.material.createdAt}
        updatedAt={details.material.updatedAt}
        onBack={goBack}
        onEdit={isAdmin ? editMaterial : undefined}
        onRefresh={() => void loadDetails(true)}
        refreshing={refreshing}
      >
        <StandardMaterialsSection
          items={details.standardMaterials}
          isAdmin={isAdmin}
          busyId={busyId}
          catalogLoading={catalogLoading}
          onAdd={openAdd}
          onEdit={openEdit}
          onDelete={(assignment) => void remove(assignment)}
        />
      </MaterialDetailsLayout>
      <StandardMaterialDialog
        open={dialogOpen}
        assignment={editing}
        catalog={catalog}
        catalogItemLabel={standardMaterialCatalogItemLabel}
        ownerMaterialId={ownerId}
        excludeOwnerFromCatalog={
          category === 'cable-installation-material' ||
          category === 'tray-installation-material' ||
          category === 'instrument-installation-material'
        }
        saving={saving}
        onDismiss={() => setDialogOpen(false)}
        onSave={save}
      />
      {token ? (
        <MaterialEditDialog
          open={editDialogOpen}
          category={category}
          material={details.material}
          token={token}
          onDismiss={() => setEditDialogOpen(false)}
          onSaved={async () => {
            await loadDetails(true);
            showToast({ title: `${capability.label} updated`, intent: 'success' });
          }}
        />
      ) : null}
    </>
  );
};
