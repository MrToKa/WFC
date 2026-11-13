const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Object.keys(value).length === keys.length &&
  keys.every(
    (key) =>
      Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined,
  );
const text = (value, limit) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= limit &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const nullable = (value, check) => value === null || check(value);
const dimension = (value) =>
  nullable(
    value,
    (item) => typeof item === 'number' && Number.isFinite(item) && item > 0 && item <= 1e6,
  );

/** Canonical API/STEP section metadata; never accept SDK IDs from the host. */
export function validateCadProperties(componentId, metadata, route) {
  return (
    uuid(componentId) &&
    exact(metadata, [
      'instanceId',
      'name',
      'actualLengthMm',
      'widthMm',
      'heightMm',
      'partNumber',
      'manufacturer',
      'purpose',
      'componentKind',
      'cadAssetId',
      'cadRevision',
    ]) &&
    metadata.instanceId === componentId &&
    text(metadata.name, 512) &&
    dimension(metadata.actualLengthMm) &&
    dimension(metadata.widthMm) &&
    dimension(metadata.heightMm) &&
    text(metadata.partNumber, 200) &&
    text(metadata.manufacturer, 200) &&
    nullable(metadata.purpose, (item) => text(item, 500)) &&
    nullable(metadata.componentKind, (item) => text(item, 80)) &&
    nullable(metadata.cadAssetId, uuid) &&
    nullable(
      metadata.cadRevision,
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647,
    ) &&
    exact(route, ['id', 'name', 'purpose']) &&
    nullable(route.id, uuid) &&
    text(route.name, 200) &&
    nullable(route.purpose, (value) => text(value, 500)) &&
    metadata.purpose === route.purpose
  );
}

export function cadPropertyRows(metadata, route, dbId) {
  const row = (displayName, value, category = 'CAD section', units = null) => ({
    displayName,
    displayValue: value == null ? 'Unknown' : value,
    displayCategory: category,
    attributeName: displayName,
    type: typeof value === 'number' ? 3 : 20,
    units: value == null ? null : units,
    hidden: false,
    precision: 3,
    dbId,
    parentName: metadata.name,
  });
  return [
    row('Name', metadata.name, null),
    row('Actual length', metadata.actualLengthMm, 'CAD section', 'mm'),
    row('Width', metadata.widthMm, 'CAD section', 'mm'),
    row('Height', metadata.heightMm, 'CAD section', 'mm'),
    row('Part number', metadata.partNumber),
    row('Manufacturer', metadata.manufacturer),
    row('Purpose', metadata.purpose),
    row('Instance ID', metadata.instanceId, 'Identity'),
    row('Route', route.name, 'Identity'),
    row('Route ID', route.id, 'Identity'),
    row('CAD asset ID', metadata.cadAssetId, 'Catalogue revision'),
    row(
      'CAD revision',
      metadata.cadRevision == null ? null : String(metadata.cadRevision),
      'Catalogue revision',
    ),
  ];
}

/** Use the existing SDK Properties toolbar/dock and its native source behavior. */
export function installCadPropertyPanel(viewer, av, lookup) {
  const manager = viewer.getExtension?.('Autodesk.PropertiesManager');
  const NativePanel = av.Extensions?.ViewerPropertyPanel;
  if (!manager?.setPanel || !NativePanel || !av.PropertySet)
    throw new Error('The native CAD Properties panel is unavailable.');
  class CadPropertyPanel extends NativePanel {
    normalizeOwnedZeroSelection() {
      const selected = this.viewer?.getAggregateSelection();
      if (!Array.isArray(selected) || !selected.some(row => row.selection?.includes(0) && lookup(row.model, 0) !== undefined)) return false;
      // The SDK's public getter retains 0; only its aggregate event omits it.
      this.currentSelections = selected.map(row => ({ model: row.model, selection: [...row.selection] }));
      this.currentModel = selected[0].model;
      this.currentNodeIds = [...selected[0].selection];
      return true;
    }
    requestProperties() {
      this.normalizeOwnedZeroSelection();
      super.requestProperties();
    }
    layoutAfterCadRender(generation) {
      const window = viewer.container?.ownerDocument?.defaultView ?? globalThis;
      window.requestAnimationFrame?.(() => {
        if (!this.viewer || generation !== this.cadGeneration || !this.isVisible()) return;
        this.respositionPanel();
        // SDK CSS starts this panel 180px down. Its resizeToContent reserves
        // another 75px below the panel, which can cap a short Viewer at its
        // 100px minimum even though the property tree has a measured height.
        // Fit its position first, using the same native viewport reservation.
        const bounds = this.getContainerBoundingRect();
        const rect = this.container.getBoundingClientRect();
        const wanted = Math.min(this.getContentSize().height, Math.max(0, bounds.height - 75));
        const top = Math.max(0, Math.min(rect.top - bounds.top, bounds.height - wanted - 75));
        if (top < rect.top - bounds.top) this.container.style.top = `${top}px`;
        this.resizeToContent();
      });
    }
    requestAggregatedNodeProperties(input) {
      const selections = Array.isArray(input) ? input : [input];
      this.cadGeneration = (this.cadGeneration ?? 0) + 1;
      const generation = this.cadGeneration;
      const entries = selections.flatMap((selection) =>
        (selection.selection ?? []).map((id) => ({
          id,
          selection,
          section: lookup(selection.model, id),
        })),
      );
      this.cadActive = entries.some((entry) => entry.section !== undefined);

      if (entries.length === 1 && entries[0].section) {
        const { section, id } = entries[0];
        this.propertyNodeId = id;
        super.setPropertiesIntoUI({
          name: section.metadata.name,
          properties: cadPropertyRows(section.metadata, section.route, id).filter(
            (row) => row.displayName !== 'Name',
          ),
        });
        this.layoutAfterCadRender(generation);
        return;
      }
      if (entries.length === 1 && entries[0].section === null) {
        super.onPropError();
        return;
      }
      const pending = selections.map((selection) => {
        const own = (selection.selection ?? []).map((id) => ({
          id,
          section: lookup(selection.model, id),
        }));
        if (!own.some((entry) => entry.section !== undefined))
          return selection.model.getPropertySetAsync(selection.selection, {
            needsExternalId: selection.model.getData()?.loadOptions?.needsExternalId,
          });
        const map = { __selected_dbIds__: own.map((entry) => entry.id) };
        for (const { id, section } of own) {
          if (!section) continue;
          for (const row of cadPropertyRows(section.metadata, section.route, id)) {
            const key = row.displayCategory
              ? `${row.displayCategory}/${row.displayName}`
              : row.displayName;
            (map[key] ??= []).push(row);
          }
        }
        return new av.PropertySet(map);
      });
      void Promise.all(pending)
        .then((sets) => {
          if (!this.viewer || generation !== this.cadGeneration) return;
          for (let index = 1; index < sets.length; index++) sets[0].merge(sets[index]);
          return this.renderPropertySet(sets[0], generation);
        })
        .catch(() => {
          if (this.viewer && generation === this.cadGeneration) super.onPropError();
        });
    }
    async renderPropertySet(result, generation) {
      if (!this.viewer || generation !== this.cadGeneration) return;
      if (!result.getVisibleKeys().length) {
        super.onPropError();
        return;
      }
      // Preserve the pinned native panel's SolidWorks internal-reference expansion.
      const model = this.currentModel,
        referenced = [];
      for (const key of result.getValidIds(null, '__internalref__'))
        for (const row of result.map[key])
          if (!referenced.includes(row.displayValue)) referenced.push(row.displayValue);
      const documentName = model?.getDocumentNode?.()?.findViewableParent?.()?.name?.() ?? '';
      if (model?.is3d?.() && documentName.toLowerCase().includes('.sld') && referenced.length)
        result = await new Promise((yes, no) =>
          model.getPropertySet(referenced, (extra) => yes(result.merge(extra)), no, {
            ignoreHidden: true,
          }),
        );
      if (this.viewer && generation === this.cadGeneration) {
        super.setAggregatedPropertiesIntoUI(result);
        if (this.cadActive) this.layoutAfterCadRender(generation);
      }
    }
    refreshCadProperties() {
      if (
        !this.cadActive &&
        !this.currentSelections?.some((selection) =>
          (selection.selection ?? []).some((id) => lookup(selection.model, id) !== undefined),
        )
      )
        return;
      this.isDirty = true;
      this.requestProperties();
    }
    resetCurrentModel() {
      this.cadActive = false;
      this.cadGeneration = (this.cadGeneration ?? 0) + 1;
      super.resetCurrentModel();
    }
  }
  const original = manager.getPanel?.();
  const visible = original?.isVisible?.() ?? false;
  const panel = new CadPropertyPanel(viewer);
  if (manager.setPanel(panel) === false) {
    panel.uninitialize();
    throw new Error('The native Properties panel rejected CAD sections.');
  }
  // Registered after native manager/panel listeners. Restore auto-open only
  // after a real selection event; a user explicitly closing the panel stays closed.
  const rescueZeroSelection = () => {
    if (panel.normalizeOwnedZeroSelection() && viewer.prefs.get('openPropertiesOnSelect')) panel.setVisible(true);
  };
  viewer.addEventListener(av.AGGREGATE_SELECTION_CHANGED_EVENT, rescueZeroSelection);
  panel.setVisible(visible);
  return {
    refresh: () => panel.refreshCadProperties(),
    dispose() {
      viewer.removeEventListener(av.AGGREGATE_SELECTION_CHANGED_EVENT, rescueZeroSelection);
      if (manager.getPanel?.() === panel) manager.setDefaultPanel();
    },
  };
}
