import { Router } from 'express';
import { pool } from '../db.js';
import { mapMaterialTrayRow, type MaterialTrayRow } from '../models/materialTray.js';
import { mapMaterialSupportRow, type MaterialSupportRow } from '../models/materialSupport.js';
import {
  mapMaterialLoadCurveRow,
  mapMaterialLoadCurvePointRow,
  type MaterialLoadCurveRow,
  type MaterialLoadCurvePointRow,
} from '../models/materialLoadCurve.js';

// Engineering inputs for viewing an assigned project, without opening the global catalogs.
export const projectTrayDataRouter = Router({ mergeParams: true });
projectTrayDataRouter.get('/', async (req, res) => {
  const { projectId } = req.params as { projectId: string };
  try {
    const trays = await pool.query<MaterialTrayRow>(
      `
      SELECT mt.*, lc.name AS load_curve_name
      FROM material_trays mt
      LEFT JOIN material_load_curves lc ON lc.id = mt.load_curve_id
      WHERE EXISTS (
        SELECT 1 FROM trays t WHERE t.project_id = $1
        AND LOWER(TRIM(t.tray_type)) = LOWER(TRIM(mt.tray_type))
      ) ORDER BY mt.tray_type
    `,
      [projectId],
    );
    const supports = await pool.query<MaterialSupportRow>(
      `
      SELECT s.* FROM material_supports s
      WHERE EXISTS (
        SELECT 1 FROM project_support_distances d
        WHERE d.project_id = $1 AND d.support_id = s.id
      ) ORDER BY s.support_type
    `,
      [projectId],
    );
    const curveIds = [
      ...new Set(trays.rows.flatMap((tray) => (tray.load_curve_id ? [tray.load_curve_id] : []))),
    ];
    const curves = await pool.query<MaterialLoadCurveRow>(
      'SELECT * FROM material_load_curves WHERE id = ANY($1::uuid[])',
      [curveIds],
    );
    const points = await pool.query<MaterialLoadCurvePointRow>(
      'SELECT * FROM material_load_curve_points WHERE load_curve_id = ANY($1::uuid[]) ORDER BY point_order',
      [curveIds],
    );
    const hideImage = {
      imageTemplateId: null,
      imageTemplateFileName: null,
      imageTemplateContentType: null,
    };
    res.json({
      trays: trays.rows.map((row) => ({ ...mapMaterialTrayRow(row), ...hideImage })),
      supports: supports.rows.map((row) => ({ ...mapMaterialSupportRow(row), ...hideImage })),
      loadCurves: curves.rows.map((row) =>
        mapMaterialLoadCurveRow(
          { ...row, tray_id: null },
          points.rows
            .filter((point) => point.load_curve_id === row.id)
            .map(mapMaterialLoadCurvePointRow),
        ),
      ),
    });
  } catch (error) {
    console.error('Project tray data error', error);
    res.status(500).json({ error: 'Failed to load project tray data' });
  }
});
