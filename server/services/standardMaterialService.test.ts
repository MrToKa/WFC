import { describe, expect, it } from 'vitest';
import type { StandardMaterialAssignment } from '../models/standardMaterial.js';
import {
  aggregateExpandedStandardMaterials,
  expandStandardMaterialsFromAssignments,
  StandardMaterialDomainError,
} from './standardMaterialService.js';

const assignment = (
  id: string,
  ownerCategory: StandardMaterialAssignment['ownerCategory'],
  ownerId: string,
  childId: string,
  childName: string,
  quantity: number,
  unit: StandardMaterialAssignment['unit'],
  referencedMaterialCategory: StandardMaterialAssignment['referencedMaterialCategory'] =
    'cable-installation-material',
): StandardMaterialAssignment => ({
  id,
  ownerCategory,
  ownerId,
  referencedMaterialId: childId,
  referencedMaterialCategory,
  referencedMaterial: {
    id: childId,
    type: childName,
    purpose: null,
    material: null,
    description: null,
    dimensionMm: null,
    weightKg: null,
    manufacturer: null,
    partNo: null,
    minimumOrderQuantity: 1,
    orderMeasurement: 'pcs',
    packaging: 'pcs',
  },
  quantity,
  unit,
  remarks: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('Standard Material expansion', () => {
  it('recursively expands Tray Installation Materials within their own catalog', () => {
    const assignments = [
      assignment(
        'a1',
        'tray-installation-material',
        'tray-kit',
        'fastener',
        'Fastener',
        4,
        'pcs',
        'tray-installation-material',
      ),
      assignment(
        'a2',
        'tray-installation-material',
        'fastener',
        'washer',
        'Washer',
        2,
        'pcs',
        'tray-installation-material',
      ),
    ];

    expect(
      expandStandardMaterialsFromAssignments(assignments, 'tray-installation-material', 'tray-kit'),
    ).toEqual([
      expect.objectContaining({
        referencedMaterialId: 'fastener',
        referencedMaterialCategory: 'tray-installation-material',
        name: 'Fastener',
        quantity: 4,
        unit: 'pcs',
        depth: 1,
      }),
      expect.objectContaining({
        referencedMaterialId: 'washer',
        referencedMaterialCategory: 'tray-installation-material',
        name: 'Washer',
        quantity: 8,
        unit: 'pcs',
        depth: 2,
      }),
    ]);
  });

  it('multiplies recursive quantities, retains child units, and orders deterministically', () => {
    const assignments = [
      assignment('a1', 'cable-type', 'cable', 'gland', 'Cable gland', 2, 'pcs'),
      assignment(
        'a2',
        'cable-installation-material',
        'gland',
        'washer',
        'Washer',
        3,
        'meters',
      ),
    ];

    expect(expandStandardMaterialsFromAssignments(assignments, 'cable-type', 'cable')).toEqual([
      expect.objectContaining({
        referencedMaterialId: 'gland',
        name: 'Cable gland',
        quantity: 2,
        unit: 'pcs',
        depth: 1,
      }),
      expect.objectContaining({
        referencedMaterialId: 'washer',
        name: 'Washer',
        quantity: 6,
        unit: 'meters',
        depth: 2,
      }),
    ]);
  });

  it('detects cycles with a clear domain error', () => {
    const assignments = [
      assignment(
        'a1',
        'cable-installation-material',
        'first',
        'second',
        'Second',
        1,
        'pcs',
      ),
      assignment(
        'a2',
        'cable-installation-material',
        'second',
        'first',
        'First',
        1,
        'pcs',
      ),
    ];

    expect(() =>
      expandStandardMaterialsFromAssignments(
        assignments,
        'cable-installation-material',
        'first',
      ),
    ).toThrowError(StandardMaterialDomainError);
  });

  it('aggregates the same material and unit without double-counting paths', () => {
    const materials = aggregateExpandedStandardMaterials([
      {
        referencedMaterialId: 'gland',
        referencedMaterialCategory: 'cable-installation-material',
        name: 'Cable gland',
        purpose: null,
        material: null,
        description: null,
        dimensionMm: 'M32',
        weightKg: 0.12,
        manufacturer: null,
        partNo: null,
        minimumOrderQuantity: 1,
        orderMeasurement: 'pcs',
        packaging: 'pcs',
        quantity: 4,
        unit: 'pcs',
        remarks: null,
        sourceAssignmentIds: ['b'],
        depth: 2,
      },
      {
        referencedMaterialId: 'gland',
        referencedMaterialCategory: 'cable-installation-material',
        name: 'Cable gland',
        purpose: null,
        material: null,
        description: null,
        dimensionMm: 'M32',
        weightKg: 0.12,
        manufacturer: null,
        partNo: null,
        minimumOrderQuantity: 1,
        orderMeasurement: 'pcs',
        packaging: 'pcs',
        quantity: 2,
        unit: 'pcs',
        remarks: null,
        sourceAssignmentIds: ['a'],
        depth: 1,
      },
    ]);

    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      quantity: 6,
      sourceAssignmentIds: ['a', 'b'],
      depth: 1,
    });
  });
});
