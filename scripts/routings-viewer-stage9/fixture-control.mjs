import assert from 'node:assert/strict';
import { fixturePool, prepareModel, safeFacts, actor, emptyProject, changeTray, changeCable, seedCables, requireFixtureProject, list, select } from './fixture-helpers.mjs';

const pool = fixturePool(); let input = '';
for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length < 16_384); }
const spec = JSON.parse(input);
try {
  if (spec.action === 'change-cable' || spec.action === 'change-panel-cable') console.log(JSON.stringify(await changeCable(pool, spec.projectId, { ...spec, action: spec.change })));
  else if (['remove-model-tray', 'restore-model-tray', 'add-collision', 'remove-collision'].includes(spec.action)) console.log(JSON.stringify(await changeTray(pool, spec.projectId, spec.action)));
  else if (spec.action === 'set-selection') {
    await requireFixtureProject(pool, spec.projectId); const editor = await actor(pool, spec.projectId);
    const current = await list(spec.projectId, editor.token);
    const value = spec.selected ? current.versions[0].id : null;
    const response = await select(spec.projectId, editor.token, value, current.selection.selectionRevision); assert.equal(response.status, 200);
    console.log(JSON.stringify({ projectId: spec.projectId, selection: response.value.selection }));
  } else if (['revoke-reader', 'restore-reader'].includes(spec.action)) {
    await requireFixtureProject(pool, spec.projectId);
    const user = (await pool.query('SELECT email FROM users WHERE id=$1', [spec.userId])).rows[0]; assert.match(user?.email ?? '', /^stage9-[a-f0-9-]+@fixture\.invalid$/);
    if (spec.action === 'revoke-reader') await pool.query('DELETE FROM user_project_access WHERE project_id=$1 AND user_id=$2', [spec.projectId, spec.userId]);
    else await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [spec.userId, spec.projectId]);
    console.log(JSON.stringify({ projectId: spec.projectId, action: spec.action, userId: spec.userId }));
  } else {
    assert.match(spec.email, /^stage9-[a-f0-9-]+@fixture\.invalid$/); assert.ok(spec.password?.length >= 24);
    const fixture = await prepareModel(pool, spec), actors = {};
    for (const [name, role, assigned] of [['reader', 'basic', true], ['technician', 'technician', true], ['readOnlyEngineer', 'engineer', false]]) {
      assert.match(spec[name]?.email ?? '', /^stage9-[a-f0-9-]+@fixture\.invalid$/); assert.ok(spec[name].password?.length >= 24);
      actors[name] = (await actor(pool, fixture.projectId, { ...spec[name], role, assigned })).userId;
    }
    const emptyId = await emptyProject(pool, 'Stage9 no selected model');
    await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [fixture.editor.userId, emptyId]);
    const infoId = await emptyProject(pool, 'Stage9 cable information without an active model');
    const infoCables = await seedCables(pool, infoId);
    for (const userId of [fixture.editor.userId, actors.reader, actors.technician]) await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [userId, infoId]);
    console.log(JSON.stringify({ ...safeFacts(fixture), editorId: fixture.editor.userId, actorIds: actors, emptyProjectId: emptyId, infoOnlyProjectId: infoId, infoOnlyCables: infoCables }));
  }
} finally { await pool.end(); }
