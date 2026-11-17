// Adapter for the pinned 7.130.0 Model Browser's synchronous Searchbox contract.
// Keep Autodesk's tree, result list and selection handlers; only extend its query.
const tagProperty = property => [property.attributeName, property.displayName]
  .some(name => typeof name === 'string' && name.toLowerCase() === 'tag');

function searchTags(model, text, isCurrent) {
  return new Promise((resolve, reject) => {
    // Search all attributes first: the displayed "Tag" may have a different raw
    // attribute name. Verify actual Tag values below, excluding other properties.
    model.search(text, resolve, reject, null, { searchHidden: true, includeInherited: true });
  }).then(async ids => {
    const matches = new Map(), term = text.toLowerCase();
    const unique = [...new Set(ids)];
    for (let offset = 0; offset < unique.length; offset += 500) {
      if (!isCurrent()) return matches;
      const rows = await new Promise((resolve, reject) => {
        // Unfiltered properties preserve the distinction between displayName
        // and attributeName and include inherited values shown by Properties.
        model.getBulkProperties2(unique.slice(offset, offset + 500), { ignoreHidden: false }, resolve, reject);
      });
      if (!isCurrent()) return matches;
      for (const row of rows) {
        const tag = row.properties?.find(property => tagProperty(property)
          && String(property.displayValue ?? '').toLowerCase().includes(term));
        if (tag) matches.set(row.dbId, String(tag.displayValue));
      }
    }
    return matches;
  });
}

function resultDelegate(delegate, tags) {
  // SDK highlighting assumes the query occurs in the node's displayed name.
  // A result-only facade includes the real Tag without changing the model tree.
  const tree = delegate.instanceTree;
  const facade = Object.create(delegate);
  facade.instanceTree = new Proxy(tree, {
    get(target, key) {
      if (key === 'getNodeName') return id => {
        const name = target.getNodeName(id) ?? '';
        return tags.has(id) ? `${name} — ${tags.get(id)}` : name;
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return facade;
}

export function installModelBrowserSearch(viewer, viewing) {
  let disposed = false;
  const panels = new Map();
  const install = () => {
    const panel = viewer.modelstructure, box = panel?.searchbox;
    if (disposed || !box || panels.has(panel) || typeof box._searchFunction !== 'function') return;
    const input = box.searchbox, original = box._searchFunction;
    const originalPlaceholder = input.placeholder, originalLabel = input.getAttribute('aria-label');
    let revision = 0;
    const invalidate = () => { revision++; input.removeAttribute('aria-busy'); };
    input.placeholder = 'Search name or Tag';
    input.setAttribute('aria-label', 'Search name or Tag');
    input.addEventListener('input', invalidate);
    const search = text => {
      const token = ++revision;
      const names = original.call(box, text);
      const groups = [];
      panel.tree.forEachDelegate(delegate => groups.push(delegate));
      input.setAttribute('aria-busy', 'true');
      const current = () => !disposed && viewer.modelstructure === panel && token === revision
        && input.value.trim() === text;
      // Native Searchbox sets name results immediately after this function
      // returns. Defer even synchronous SDK callbacks until that has happened.
      void Promise.resolve().then(async () => {
        const results = await Promise.allSettled(groups.map(delegate => searchTags(delegate.model, text, current)));
        if (!current()) return;
        const merged = [];
        groups.forEach((delegate, index) => {
          if (panel.tree.getDelegate(delegate.model.id) !== delegate) return;
          const tags = results[index].status === 'fulfilled' ? results[index].value : new Map();
          const ids = [...new Set([...(names.find(group => group.delegate === delegate)?.ids ?? []), ...tags.keys()])];
          merged.push({ delegate: tags.size ? resultDelegate(delegate, tags) : delegate, ids });
        });
        box.searchResults.setResults(text, merged);
        input.removeAttribute('aria-busy');
      }).catch(() => { if (current()) input.removeAttribute('aria-busy'); });
      return names;
    };
    box._searchFunction = search;
    panels.set(panel, () => {
      invalidate();
      input.removeEventListener('input', invalidate);
      if (box._searchFunction === search) box._searchFunction = original;
      input.placeholder = originalPlaceholder;
      if (originalLabel === null) input.removeAttribute('aria-label');
      else input.setAttribute('aria-label', originalLabel);
    });
  };
  const events = [viewing.TOOLBAR_CREATED_EVENT, viewing.EXTENSION_LOADED_EVENT, viewing.OBJECT_TREE_CREATED_EVENT].filter(Boolean);
  for (const event of events) viewer.addEventListener(event, install);
  install();
  return { dispose() {
    disposed = true;
    for (const event of events) viewer.removeEventListener(event, install);
    for (const cleanup of panels.values()) cleanup();
    panels.clear();
  } };
}
