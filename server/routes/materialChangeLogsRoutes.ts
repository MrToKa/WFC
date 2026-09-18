import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { STANDARD_MATERIAL_OWNER_CATEGORIES } from '../models/standardMaterial.js';
import { MATERIAL_CAPABILITIES } from '../services/materialCapabilities.js';
import {
  mapMaterialChangeLogRow,
  type MaterialChangeLogRow,
} from '../services/materialChangeLogService.js';

export const materialChangeLogsRouter = Router();

materialChangeLogsRouter.get('/:category/:materialId', async (req, res): Promise<void> => {
  const parsed = z
    .object({
      category: z.enum([...STANDARD_MATERIAL_OWNER_CATEGORIES, 'load-curve']),
      materialId: z.string().uuid(),
    })
    .safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid material category or ID' });
    return;
  }
  const { category, materialId } = parsed.data;
  const table =
    category === 'load-curve' ? 'material_load_curves' : MATERIAL_CAPABILITIES[category].ownerTable;
  try {
    const owner = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [materialId]);
    if (!owner.rows[0]) {
      res.status(404).json({ error: 'Material not found' });
      return;
    }
    const result = await pool.query<MaterialChangeLogRow>(
      'SELECT id, user_id, user_name, changed_at, events FROM material_change_logs WHERE category = $1 AND material_id = $2 ORDER BY id DESC',
      [category, materialId],
    );
    res.json({
      changeLog: result.rows.map(mapMaterialChangeLogRow).filter((entry) => entry.changes.length),
    });
  } catch (error) {
    console.error('Fetch material change log error', error);
    res.status(500).json({ error: 'Failed to fetch material change log' });
  }
});
