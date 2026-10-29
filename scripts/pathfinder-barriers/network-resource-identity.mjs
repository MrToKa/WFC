// Docker IP allocation usage changes when the operator stops its own endpoints.
// Every other inspect field remains part of resource identity/configuration.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const need = value => { if (!value) throw Object.assign(Error('B9_NETWORK_RESOURCE_STATUS_INVALID'), {code: 'B9_NETWORK_RESOURCE_STATUS_INVALID'}); };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';

export function sortCanonicalRecords(values) {
  return [...values].sort((left, right) => {
    const a = canonical(left), b = canonical(right); return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function projectNetworkResource(network) {
  need(record(network) && typeof network.Id === 'string' && network.Id.length > 0 && typeof network.Name === 'string' && network.Name.length > 0
    && record(network.IPAM) && Array.isArray(network.IPAM.Config) && network.IPAM.Config.length > 0 && network.IPAM.Config.length <= 32);
  const configured = network.IPAM.Config.map(config => {
    need(record(config) && typeof config.Subnet === 'string' && config.Subnet.length > 0 && config.Subnet.length <= 256); return config.Subnet;
  });
  need(new Set(configured).size === configured.length && exact(network.Status, ['IPAM']) && exact(network.Status.IPAM, ['Subnets'])
    && record(network.Status.IPAM.Subnets));
  const subnets = network.Status.IPAM.Subnets, names = Object.keys(subnets);
  need(names.length === configured.length && names.every(name => configured.includes(name)));
  for (const subnet of names) {
    const usage = subnets[subnet];
    need(exact(usage, ['IPsInUse', 'DynamicIPsAvailable']) && ['IPsInUse', 'DynamicIPsAvailable'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      && Number.isSafeInteger(usage.IPsInUse + usage.DynamicIPsAvailable));
  }
  const identity = structuredClone(network);
  // Preserve Status/IPAM/Subnets and its exact subnet binding. Only these two
  // validated numeric observations leave the equality projection.
  for (const subnet of names) { delete identity.Status.IPAM.Subnets[subnet].IPsInUse; delete identity.Status.IPAM.Subnets[subnet].DynamicIPsAvailable; }
  return {identity, allocation: {id: network.Id, name: network.Name, status: structuredClone(network.Status)}};
}
