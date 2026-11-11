import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const production = read('docker/nginx.conf');
const local = read('docker/pathfinder.nginx.conf');
const project = '0c0007c9-d73f-4d13-bc87-601c544727b7';
const id = 'a613151e-c370-45c5-80f3-42ae58603b9a';

function streamingLocation(config, route) {
  // Location patterns contain repetition braces, so parse the quoted pattern
  // separately from its directive block.
  return [...config.matchAll(/location ~\* "([^"]+)" \{([^]*?)\n    \}/g)]
    .find(([, pattern]) => new RegExp(pattern, 'i').test(route));
}

test('production web image uses the tested nginx configuration', () => {
  assert.match(read('Dockerfile'), /COPY docker\/nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
});

test('preparation captures and trace bodies reach API admission without the generic 10 MiB rejection', () => {
  const suffixes = [
    'preparations', `preparations/${id}`, `preparations/${id}/parts/${id}`,
    `preparations/${id}/publish`, 'geometry-traces', `geometry-traces/${id}`,
    'geometry-evidence', 'endpoint-bindings', 'revision-comparisons',
    'recalculations', `locations/${id}/endpoint-binding`, `locations/${id}/binding-history`,
  ];
  for (const suffix of suffixes) {
    const route = `/api/projects/${project}/pathfinder/${suffix}`;
    const actual = streamingLocation(production, route);
    const reference = streamingLocation(local, route);
    assert.ok(actual, `Missing production streaming location for ${route}`);
    assert.ok(reference, `Missing local reference location for ${route}`);
    assert.equal(actual[2].trim(), reference[2].trim(), `Proxy settings differ for ${route}`);
    for (const directive of [
      'client_max_body_size 0;', 'proxy_request_buffering off;',
      'proxy_http_version 1.1;', 'proxy_pass http://api:4000;',
    ]) assert.ok(actual[2].includes(directive), `${route}: ${directive}`);
  }
});

test('streaming exceptions do not expand the generic API request limit', () => {
  assert.match(production.split(/\n    location /)[0], /client_max_body_size 10m;/);
  for (const suffix of ['preparations-extra', 'geometry-traces-extra', 'cables', 'barriers']) {
    assert.equal(streamingLocation(production, `/api/projects/${project}/pathfinder/${suffix}`), undefined);
  }
  const generic = production.match(/location \/api\/ \{([^]*?)\n    \}/)?.[1];
  assert.ok(generic);
  assert.doesNotMatch(generic, /client_max_body_size/);
});
