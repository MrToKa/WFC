import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  mapStandardMaterialAssignmentRow,
  type ExpandedStandardMaterial,
  type StandardMaterialAssignment,
  type StandardMaterialAssignmentRow,
  type StandardMaterialOwnerCategory,
  type StandardMaterialUnit,
} from '../models/standardMaterial.js';
import { getMaterialCapability } from './materialCapabilities.js';

export type StandardMaterialInput = {
  referencedMaterialId: string;
  quantity: number;
  unit: StandardMaterialUnit;
  remarks?: string | null;
};

export type StandardMaterialUpdateInput = Partial<StandardMaterialInput>;
type Queryable = Pick<PoolClient, 'query'> | Pick<Pool, 'query'>;

export class StandardMaterialDomainError extends Error {
  constructor(
    public readonly code:
      | 'OWNER_NOT_FOUND'
      | 'REFERENCED_MATERIAL_NOT_FOUND'
      | 'ASSIGNMENT_NOT_FOUND'
      | 'DUPLICATE_ASSIGNMENT'
      | 'SELF_REFERENCE'
      | 'CYCLE'
      | 'INTEGRITY_CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

const assignmentSelect = (category: StandardMaterialOwnerCategory, whereClause: string): string => {
  const capability = getMaterialCapability(category);
  return `
    SELECT
      a.id,
      a.${capability.assignmentOwnerColumn} AS owner_id,
      '${category}'::text AS owner_category,
      a.referenced_material_id,
      '${capability.referencedMaterialCategory}'::text AS referenced_material_category,
      child.type AS referenced_material_name,
      child.purpose AS referenced_material_purpose,
      child.material AS referenced_material_material,
      child.description AS referenced_material_description,
      child.dimension_mm AS referenced_material_dimension_mm,
      child.weight_kg AS referenced_material_weight_kg,
      child.unit_price AS referenced_material_unit_price,
      child.manufacturer AS referenced_material_manufacturer,
      child.part_no AS referenced_material_part_no,
      child.minimum_order_quantity AS referenced_material_minimum_order_quantity,
      child.order_measurement AS referenced_material_order_measurement,
      child.packaging AS referenced_material_packaging,
      a.quantity,
      a.unit,
      a.remarks,
      a.created_at,
      a.updated_at
    FROM ${capability.assignmentTable} a
    JOIN ${capability.referencedMaterialTable} child
      ON child.id = a.referenced_material_id
    ${whereClause}
  `;
};

export const listStandardMaterialAssignments = async (
  queryable: Queryable,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): Promise<StandardMaterialAssignment[]> => {
  const capability = getMaterialCapability(category);
  const result = await queryable.query<StandardMaterialAssignmentRow>(
    `${assignmentSelect(category, `WHERE a.${capability.assignmentOwnerColumn} = $1`)}
     ORDER BY LOWER(child.type), a.id`,
    [ownerId],
  );
  return result.rows.map(mapStandardMaterialAssignmentRow);
};

const ownerExists = async (
  queryable: Queryable,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): Promise<boolean> => {
  const capability = getMaterialCapability(category);
  const result = await queryable.query(
    `SELECT 1 FROM ${capability.ownerTable}
     WHERE ${capability.ownerIdColumn} = $1 LIMIT 1`,
    [ownerId],
  );
  return Boolean(result.rows[0]);
};

const referencedMaterialExists = async (
  queryable: Queryable,
  referencedMaterialTable: string,
  referencedMaterialId: string,
): Promise<boolean> => {
  const result = await queryable.query(
    `SELECT 1 FROM ${referencedMaterialTable} WHERE id = $1 LIMIT 1`,
    [referencedMaterialId],
  );
  return Boolean(result.rows[0]);
};

const loadAllAssignments = async (queryable: Queryable): Promise<StandardMaterialAssignment[]> => {
  const categories: StandardMaterialOwnerCategory[] = [
    'cable-type',
    'cable-installation-material',
    'tray-installation-material',
    'tray',
    'support',
  ];
  const result = await queryable.query<StandardMaterialAssignmentRow>(
    categories.map((category) => `(${assignmentSelect(category, '')})`).join('\nUNION ALL\n'),
  );
  return result.rows.map(mapStandardMaterialAssignmentRow);
};

type ExpansionGraph = Map<string, StandardMaterialAssignment[]>;

const ownerKey = (category: StandardMaterialOwnerCategory, id: string): string =>
  `${category}:${id}`;

const buildGraph = (assignments: StandardMaterialAssignment[]): ExpansionGraph => {
  const graph: ExpansionGraph = new Map();
  for (const assignment of assignments) {
    const key = ownerKey(assignment.ownerCategory, assignment.ownerId);
    const existing = graph.get(key);
    if (existing) {
      existing.push(assignment);
    } else {
      graph.set(key, [assignment]);
    }
  }
  for (const values of graph.values()) {
    values.sort(
      (left, right) =>
        left.referencedMaterial.type.localeCompare(right.referencedMaterial.type, undefined, {
          sensitivity: 'base',
        }) || left.id.localeCompare(right.id),
    );
  }
  return graph;
};

const normalizeRemarks = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

export const aggregateExpandedStandardMaterials = (
  materials: ExpandedStandardMaterial[],
): ExpandedStandardMaterial[] => {
  const aggregated = new Map<string, ExpandedStandardMaterial>();
  for (const material of materials) {
    const key = [
      material.referencedMaterialCategory,
      material.referencedMaterialId,
      material.unit,
      normalizeRemarks(material.remarks) ?? '',
    ].join('|');
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, {
        ...material,
        sourceAssignmentIds: [...material.sourceAssignmentIds],
      });
      continue;
    }
    existing.quantity += material.quantity;
    existing.depth = Math.min(existing.depth, material.depth);
    existing.sourceAssignmentIds = Array.from(
      new Set([...existing.sourceAssignmentIds, ...material.sourceAssignmentIds]),
    ).sort();
  }
  return Array.from(aggregated.values()).sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
      left.referencedMaterialCategory.localeCompare(right.referencedMaterialCategory) ||
      left.unit.localeCompare(right.unit) ||
      (left.remarks ?? '').localeCompare(right.remarks ?? '') ||
      left.referencedMaterialId.localeCompare(right.referencedMaterialId),
  );
};

const expandFromGraph = (
  graph: ExpansionGraph,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): ExpandedStandardMaterial[] => {
  const memo = new Map<string, ExpandedStandardMaterial[]>();

  const expandOwner = (
    currentCategory: StandardMaterialOwnerCategory,
    currentOwnerId: string,
    path: Set<string>,
  ): ExpandedStandardMaterial[] => {
    const key = ownerKey(currentCategory, currentOwnerId);
    if (path.has(key)) {
      throw new StandardMaterialDomainError(
        'CYCLE',
        'Standard Material composition contains a cycle.',
      );
    }
    const cached = memo.get(key);
    if (cached) {
      return cached.map((item) => ({
        ...item,
        sourceAssignmentIds: [...item.sourceAssignmentIds],
      }));
    }

    const nextPath = new Set(path);
    nextPath.add(key);
    const expanded: ExpandedStandardMaterial[] = [];
    for (const assignment of graph.get(key) ?? []) {
      const child = assignment.referencedMaterial;
      expanded.push({
        referencedMaterialId: child.id,
        referencedMaterialCategory: assignment.referencedMaterialCategory,
        name: child.type,
        purpose: child.purpose,
        material: child.material,
        description: child.description,
        dimensionMm: child.dimensionMm,
        weightKg: child.weightKg,
        unitPrice: child.unitPrice,
        manufacturer: child.manufacturer,
        partNo: child.partNo,
        minimumOrderQuantity: child.minimumOrderQuantity,
        orderMeasurement: child.orderMeasurement,
        packaging: child.packaging,
        quantity: assignment.quantity,
        unit: assignment.unit,
        remarks: assignment.remarks,
        sourceAssignmentIds: [assignment.id],
        depth: 1,
      });

      const descendants = expandOwner(assignment.referencedMaterialCategory, child.id, nextPath);
      for (const descendant of descendants) {
        expanded.push({
          ...descendant,
          quantity: assignment.quantity * descendant.quantity,
          sourceAssignmentIds: [assignment.id, ...descendant.sourceAssignmentIds],
          depth: descendant.depth + 1,
        });
      }
    }
    const result = aggregateExpandedStandardMaterials(expanded);
    memo.set(key, result);
    return result.map((item) => ({ ...item, sourceAssignmentIds: [...item.sourceAssignmentIds] }));
  };

  return expandOwner(category, ownerId, new Set());
};

export const expandStandardMaterialsFromAssignments = (
  assignments: StandardMaterialAssignment[],
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): ExpandedStandardMaterial[] => expandFromGraph(buildGraph(assignments), category, ownerId);

export const expandStandardMaterials = async (
  queryable: Queryable,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
): Promise<ExpandedStandardMaterial[]> =>
  expandStandardMaterialsFromAssignments(await loadAllAssignments(queryable), category, ownerId);

const assertAssignmentValid = async (
  queryable: Queryable,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  input: StandardMaterialInput,
  ignoredAssignmentId?: string,
): Promise<void> => {
  const capability = getMaterialCapability(category);
  if (!(await ownerExists(queryable, category, ownerId))) {
    throw new StandardMaterialDomainError('OWNER_NOT_FOUND', 'Owner material was not found.');
  }
  if (
    !(await referencedMaterialExists(
      queryable,
      capability.referencedMaterialTable,
      input.referencedMaterialId,
    ))
  ) {
    throw new StandardMaterialDomainError(
      'REFERENCED_MATERIAL_NOT_FOUND',
      `Referenced ${capability.referencedMaterialLabel} was not found.`,
    );
  }
  if (
    category === capability.referencedMaterialCategory &&
    ownerId === input.referencedMaterialId
  ) {
    throw new StandardMaterialDomainError('SELF_REFERENCE', 'A material cannot reference itself.');
  }

  const duplicate = await queryable.query(
    `SELECT id FROM ${capability.assignmentTable}
     WHERE ${capability.assignmentOwnerColumn} = $1
       AND referenced_material_id = $2
       AND ($3::uuid IS NULL OR id <> $3)
     LIMIT 1`,
    [ownerId, input.referencedMaterialId, ignoredAssignmentId ?? null],
  );
  if (duplicate.rows[0]) {
    throw new StandardMaterialDomainError(
      'DUPLICATE_ASSIGNMENT',
      'This Standard Material is already assigned to the owner.',
    );
  }

  const assignments = await loadAllAssignments(queryable);
  if (ignoredAssignmentId) {
    const index = assignments.findIndex((assignment) => assignment.id === ignoredAssignmentId);
    if (index >= 0) assignments.splice(index, 1);
  }
  assignments.push({
    id: ignoredAssignmentId ?? randomUUID(),
    ownerId,
    ownerCategory: category,
    referencedMaterialId: input.referencedMaterialId,
    referencedMaterialCategory: capability.referencedMaterialCategory,
    referencedMaterial: {
      id: input.referencedMaterialId,
      type: '',
      purpose: null,
      material: null,
      description: null,
      dimensionMm: null,
      weightKg: null,
      unitPrice: 0,
      manufacturer: null,
      partNo: null,
      minimumOrderQuantity: 1,
      orderMeasurement: 'pcs',
      packaging: 'pcs',
    },
    quantity: input.quantity,
    unit: input.unit,
    remarks: normalizeRemarks(input.remarks),
    createdAt: '',
    updatedAt: '',
  });
  expandFromGraph(buildGraph(assignments), category, ownerId);
};

export const createStandardMaterialAssignment = async (
  client: PoolClient,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  input: StandardMaterialInput,
): Promise<StandardMaterialAssignment> => {
  await assertAssignmentValid(client, category, ownerId, input);
  const capability = getMaterialCapability(category);
  const id = randomUUID();
  await client.query(
    `INSERT INTO ${capability.assignmentTable} (
       id, ${capability.assignmentOwnerColumn}, referenced_material_id, quantity, unit, remarks
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      ownerId,
      input.referencedMaterialId,
      input.quantity,
      input.unit,
      normalizeRemarks(input.remarks),
    ],
  );
  const assignments = await listStandardMaterialAssignments(client, category, ownerId);
  const created = assignments.find((assignment) => assignment.id === id);
  if (!created) throw new Error('Created Standard Material assignment could not be loaded.');
  return created;
};

export const updateStandardMaterialAssignment = async (
  client: PoolClient,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  assignmentId: string,
  input: StandardMaterialUpdateInput,
): Promise<StandardMaterialAssignment> => {
  const capability = getMaterialCapability(category);
  const currentResult = await client.query<{
    referenced_material_id: string;
    quantity: string | number;
    unit: StandardMaterialUnit;
    remarks: string | null;
  }>(
    `SELECT referenced_material_id, quantity, unit, remarks
     FROM ${capability.assignmentTable}
     WHERE id = $1 AND ${capability.assignmentOwnerColumn} = $2
     LIMIT 1`,
    [assignmentId, ownerId],
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw new StandardMaterialDomainError(
      'ASSIGNMENT_NOT_FOUND',
      'Standard Material assignment was not found.',
    );
  }
  const merged: StandardMaterialInput = {
    referencedMaterialId: input.referencedMaterialId ?? current.referenced_material_id,
    quantity: input.quantity ?? Number(current.quantity),
    unit: input.unit ?? current.unit,
    remarks: input.remarks === undefined ? current.remarks : input.remarks,
  };
  await assertAssignmentValid(client, category, ownerId, merged, assignmentId);
  await client.query(
    `UPDATE ${capability.assignmentTable}
     SET referenced_material_id = $3, quantity = $4, unit = $5, remarks = $6, updated_at = NOW()
     WHERE id = $1 AND ${capability.assignmentOwnerColumn} = $2`,
    [
      assignmentId,
      ownerId,
      merged.referencedMaterialId,
      merged.quantity,
      merged.unit,
      normalizeRemarks(merged.remarks),
    ],
  );
  const assignments = await listStandardMaterialAssignments(client, category, ownerId);
  const updated = assignments.find((assignment) => assignment.id === assignmentId);
  if (!updated) throw new Error('Updated Standard Material assignment could not be loaded.');
  return updated;
};

export const deleteStandardMaterialAssignment = async (
  client: PoolClient,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
  assignmentId: string,
): Promise<void> => {
  const capability = getMaterialCapability(category);
  const result = await client.query(
    `DELETE FROM ${capability.assignmentTable}
     WHERE id = $1 AND ${capability.assignmentOwnerColumn} = $2`,
    [assignmentId, ownerId],
  );
  if (result.rowCount === 0) {
    throw new StandardMaterialDomainError(
      'ASSIGNMENT_NOT_FOUND',
      'Standard Material assignment was not found.',
    );
  }
};
