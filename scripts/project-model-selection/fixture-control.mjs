import assert from 'node:assert/strict';
import { fixturePool, prepareModels, actor, emptyProject, safeFacts, makeVariantUnavailable } from './fixture-helpers.mjs';

const pool = fixturePool(); let input = '';
for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length < 16_384); }
const spec = JSON.parse(input);
try {
  if (spec.action === 'make-variant-unavailable') console.log(JSON.stringify(await makeVariantUnavailable(pool, spec.projectId, spec.modelVersionId)));
  else {
    assert.match(spec.email, /^stage6-[a-f0-9-]+@fixture\.invalid$/); assert.ok(spec.password?.length >= 24);
    const fixture = await prepareModels(pool, spec);
    const reader = await actor(pool, fixture.projectId, { role: 'basic', email: spec.readerEmail, password: spec.readerPassword });
    const emptyId = await emptyProject(pool, 'Stage6 empty selector project');
    await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [fixture.editor.userId, emptyId]);
    console.log(JSON.stringify({ ...safeFacts(fixture), editorId: fixture.editor.userId, readerId: reader.userId, emptyProjectId: emptyId }));
  }
} finally { await pool.end(); }
