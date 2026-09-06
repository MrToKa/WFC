import { createInstallationMaterialCatalogRouter } from './installationMaterialCatalogRoutes.js';

export const materialTrayInstallationMaterialsRouter = createInstallationMaterialCatalogRouter({
  category: 'tray-installation-material',
  table: 'material_tray_installation_materials',
  label: 'Tray installation material',
  collectionKey: 'trayInstallationMaterials',
  itemKey: 'trayInstallationMaterial',
  idParam: 'trayInstallationMaterialId',
  worksheetName: 'Tray Installation Materials',
  excelTableName: 'MaterialTrayInstallationMaterials',
  fileSlug: 'tray-installation-materials',
});
