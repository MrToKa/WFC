import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  fetchAllMaterialTrays,
  fetchMaterialCableInstallationMaterials,
  fetchMaterialCableTypes,
  fetchMaterialInstruments,
  fetchMaterialInstrumentInstallationMaterials,
  fetchMaterialSupports,
  fetchMaterialTrayInstallationMaterials,
  type ChangeOrderSourceCatalog,
} from '@/api/client';

type CatalogChoice = {
  id: string;
  category: ChangeOrderSourceCatalog;
  purpose: string;
  description: string;
  details: string;
  manufacturer: string;
  partNumber: string;
};

const useStyles = makeStyles({
  controls: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalM,
  },
  tableWrap: {
    maxHeight: '430px',
    overflowY: 'auto',
  },
  message: {
    padding: tokens.spacingVerticalL,
  },
});

const loadAllSupports = async (): Promise<CatalogChoice[]> => {
  const first = await fetchMaterialSupports({ page: 1, pageSize: 100 });
  const supports = [...first.supports];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    const next = await fetchMaterialSupports({ page, pageSize: 100 });
    supports.push(...next.supports);
  }
  return supports.map((support) => ({
    id: support.id,
    category: 'support' as const,
    purpose: '',
    description: support.type,
    details: [
      support.heightMm !== null ? `H ${support.heightMm}` : '',
      support.widthMm !== null ? `W ${support.widthMm}` : '',
      support.lengthMm !== null ? `L ${support.lengthMm}` : '',
    ]
      .filter(Boolean)
      .join(' × '),
    manufacturer: support.manufacturer ?? '',
    partNumber: '',
  }));
};

type Props = {
  open: boolean;
  adding: boolean;
  documentName?: string;
  onDismiss: () => void;
  onSelect: (choice: Pick<CatalogChoice, 'id' | 'category'>) => Promise<void>;
};

export const ChangeOrderMaterialDialog = ({
  open,
  adding,
  documentName = 'Change Order',
  onDismiss,
  onSelect,
}: Props) => {
  const styles = useStyles();
  const [category, setCategory] = useState<ChangeOrderSourceCatalog>('cable-type');
  const [purpose, setPurpose] = useState('');
  const [search, setSearch] = useState('');
  const [choices, setChoices] = useState<CatalogChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      fetchMaterialCableTypes(),
      fetchMaterialCableInstallationMaterials(),
      fetchMaterialTrayInstallationMaterials(),
      fetchMaterialInstruments(),
      fetchMaterialInstrumentInstallationMaterials(),
      fetchAllMaterialTrays(),
      loadAllSupports(),
    ])
      .then((catalogs) => {
        const [
          cables,
          cableInstallation,
          trayInstallation,
          instruments,
          instrumentInstallation,
          trays,
          supports,
        ] = catalogs;
        if (!active) return;
        setChoices([
          ...cables.cableTypes.map((item) => ({
            id: item.id,
            category: 'cable-type' as const,
            purpose: item.purpose?.trim() ?? '',
            description: item.name,
            details: [
              item.diameterMm !== null ? `Ø ${item.diameterMm} mm` : '',
              item.description ?? item.purpose ?? '',
              item.material ?? '',
            ]
              .filter(Boolean)
              .join(' · '),
            manufacturer: item.manufacturer ?? '',
            partNumber: item.partNo ?? '',
          })),
          ...cableInstallation.cableInstallationMaterials.map((item) => ({
            id: item.id,
            category: 'cable-installation-material' as const,
            purpose: item.purpose?.trim() ?? '',
            description: item.type,
            details: [item.description ?? item.purpose ?? '', item.material ?? '']
              .filter(Boolean)
              .join(' · '),
            manufacturer: item.manufacturer ?? '',
            partNumber: item.partNo ?? '',
          })),
          ...trayInstallation.trayInstallationMaterials.map((item) => ({
            id: item.id,
            category: 'tray-installation-material' as const,
            purpose: item.purpose?.trim() ?? '',
            description: item.type,
            details: [item.description ?? item.purpose ?? '', item.material ?? '']
              .filter(Boolean)
              .join(' · '),
            manufacturer: item.manufacturer ?? '',
            partNumber: item.partNo ?? '',
          })),
          ...instruments.instruments.map((item) => ({
            id: item.id,
            category: 'instrument' as const,
            purpose: item.purpose?.trim() ?? '',
            description: item.type,
            details: [item.description ?? item.purpose ?? '', item.material ?? '']
              .filter(Boolean)
              .join(' · '),
            manufacturer: item.manufacturer ?? '',
            partNumber: item.partNo ?? '',
          })),
          ...instrumentInstallation.instrumentInstallationMaterials.map((item) => ({
            id: item.id,
            category: 'instrument-installation-material' as const,
            purpose: item.purpose?.trim() ?? '',
            description: item.type,
            details: [item.description ?? item.purpose ?? '', item.material ?? '']
              .filter(Boolean)
              .join(' · '),
            manufacturer: item.manufacturer ?? '',
            partNumber: item.partNo ?? '',
          })),
          ...trays.trays.map((item) => ({
            id: item.id,
            category: 'tray' as const,
            purpose: '',
            description: item.type,
            details: [
              item.heightMm !== null ? `H ${item.heightMm}` : '',
              item.rungHeightMm !== null ? `RH ${item.rungHeightMm}` : '',
              item.widthMm !== null ? `W ${item.widthMm}` : '',
            ]
              .filter(Boolean)
              .join(' × '),
            manufacturer: item.manufacturer ?? '',
            partNumber: '',
          })),
          ...supports,
        ]);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Failed to load materials');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const purposeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          choices
            .filter((choice) => choice.category === category && choice.purpose !== '')
            .map((choice) => choice.purpose),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [category, choices],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return choices.filter(
      (choice) =>
        choice.category === category &&
        (!purpose || choice.purpose === purpose) &&
        (!needle ||
          [choice.description, choice.details, choice.manufacturer, choice.partNumber].some(
            (value) => value.toLowerCase().includes(needle),
          )),
    );
  }, [category, choices, purpose, search]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onDismiss()}>
      <DialogSurface aria-label={`Add material to ${documentName}`}>
        <DialogBody>
          <DialogTitle>Add material</DialogTitle>
          <DialogContent>
            <div className={styles.controls}>
              <Field label="Catalog category">
                <Select
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value as ChangeOrderSourceCatalog);
                    setPurpose('');
                  }}
                >
                  <option value="cable-type">Cable material types</option>
                  <option value="cable-installation-material">Cable installation materials</option>
                  <option value="tray-installation-material">Trays installation materials</option>
                  <option value="tray">Trays</option>
                  <option value="instrument">Instruments</option>
                  <option value="instrument-installation-material">
                    Instruments installation materials
                  </option>
                  <option value="support">Supports</option>
                </Select>
              </Field>
              <Field label="Purpose">
                <Select
                  value={purpose}
                  disabled={loading || purposeOptions.length === 0}
                  onChange={(event) => setPurpose(event.target.value)}
                >
                  <option value="">
                    {purposeOptions.length === 0 ? 'No purposes available' : 'All purposes'}
                  </option>
                  {purposeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Search">
                <Input
                  value={search}
                  onChange={(_, data) => setSearch(data.value)}
                  placeholder="Description, manufacturer, part number…"
                />
              </Field>
            </div>
            {loading ? <Spinner label="Loading material catalogs" /> : null}
            {error ? <Text className={styles.message}>{error}</Text> : null}
            {!loading && !error && filtered.length === 0 ? (
              <Text className={styles.message}>No matching materials found.</Text>
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <div className={styles.tableWrap}>
                <Table size="small" aria-label="Available materials">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Description</TableHeaderCell>
                      <TableHeaderCell>Details</TableHeaderCell>
                      <TableHeaderCell>Manufacturer</TableHeaderCell>
                      <TableHeaderCell>Part No.</TableHeaderCell>
                      <TableHeaderCell />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((choice) => (
                      <TableRow key={`${choice.category}-${choice.id}`}>
                        <TableCell>{choice.description}</TableCell>
                        <TableCell>{choice.details || '—'}</TableCell>
                        <TableCell>{choice.manufacturer || '—'}</TableCell>
                        <TableCell>{choice.partNumber || '—'}</TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            disabled={adding}
                            onClick={() => void onSelect(choice)}
                          >
                            Add
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss} disabled={adding}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
