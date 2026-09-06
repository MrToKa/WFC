import { createInstallationMaterialCatalogRouter } from './installationMaterialCatalogRoutes.js';

export const materialInstrumentsRouter = createInstallationMaterialCatalogRouter({
  category: 'instrument',
  table: 'material_instruments',
  label: 'Instrument',
  collectionKey: 'instruments',
  itemKey: 'instrument',
  idParam: 'instrumentId',
  worksheetName: 'Instruments',
  excelTableName: 'MaterialInstruments',
  fileSlug: 'instruments',
});

export const materialInstrumentInstallationMaterialsRouter =
  createInstallationMaterialCatalogRouter({
    category: 'instrument-installation-material',
    table: 'material_instrument_installation_materials',
    label: 'Instrument installation material',
    collectionKey: 'instrumentInstallationMaterials',
    itemKey: 'instrumentInstallationMaterial',
    idParam: 'instrumentInstallationMaterialId',
    // Excel worksheet names have a 31-character limit.
    worksheetName: 'Instrument Installation',
    excelTableName: 'MaterialInstrumentInstallationMaterials',
    fileSlug: 'instrument-installation-materials',
  });
