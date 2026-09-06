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
  referencedMaterialCategory: StandardMaterialAssignment['referencedMaterialCategory'] = 'cable-installation-material',
  unitPrice = 0,
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
    unitPrice,
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
  it('expands an instrument through nested installation materials with their own prices and units', () => {
    const assignments = [
      assignment(
        'i1',
        'instrument',
        'sensor',
        'bracket',
        'Bracket',
        2,
        'pcs',
        'instrument-installation-material',
        10,
      ),
      assignment(
        'i2',
        'instrument-installation-material',
        'bracket',
        'bolt',
        'Bolt',
        4,
        'pcs',
        'instrument-installation-material',
        0.5,
      ),
      // Another catalog can contain the same ID without contributing descendants.
      assignment(
        't1',
        'tray-installation-material',
        'bracket',
        'washer',
        'Washer',
        100,
        'pcs',
        'tray-installation-material',
      ),
    ];
    expect(expandStandardMaterialsFromAssignments(assignments, 'instrument', 'sensor')).toEqual([
      expect.objectContaining({
        referencedMaterialId: 'bolt',
        referencedMaterialCategory: 'instrument-installation-material',
        quantity: 8,
        unit: 'pcs',
        unitPrice: 0.5,
        depth: 2,
      }),
      expect.objectContaining({
        referencedMaterialId: 'bracket',
        referencedMaterialCategory: 'instrument-installation-material',
        quantity: 2,
        unit: 'pcs',
        unitPrice: 10,
        depth: 1,
      }),
    ]);
  });

  it('rejects instrument installation cycles reached through an instrument', () => {
    const assignments = [
      assignment(
        'i1',
        'instrument',
        'sensor',
        'first',
        'First',
        1,
        'pcs',
        'instrument-installation-material',
      ),
      assignment(
        'i2',
        'instrument-installation-material',
        'first',
        'second',
        'Second',
        1,
        'pcs',
        'instrument-installation-material',
      ),
      assignment(
        'i3',
        'instrument-installation-material',
        'second',
        'first',
        'First',
        1,
        'pcs',
        'instrument-installation-material',
      ),
    ];
    expect(() =>
      expandStandardMaterialsFromAssignments(assignments, 'instrument', 'sensor'),
    ).toThrowError(StandardMaterialDomainError);
  });

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
        1.25,
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
        0.1,
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
        unitPrice: 1.25,
        depth: 1,
      }),
      expect.objectContaining({
        referencedMaterialId: 'washer',
        referencedMaterialCategory: 'tray-installation-material',
        name: 'Washer',
        quantity: 8,
        unit: 'pcs',
        unitPrice: 0.1,
        depth: 2,
      }),
    ]);
  });

  it('multiplies recursive quantities, retains child units, and orders deterministically', () => {
    const assignments = [
      assignment('a1', 'cable-type', 'cable', 'gland', 'Cable gland', 2, 'pcs'),
      assignment('a2', 'cable-installation-material', 'gland', 'washer', 'Washer', 3, 'meters'),
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
      assignment('a1', 'cable-installation-material', 'first', 'second', 'Second', 1, 'pcs'),
      assignment('a2', 'cable-installation-material', 'second', 'first', 'First', 1, 'pcs'),
    ];

    expect(() =>
      expandStandardMaterialsFromAssignments(assignments, 'cable-installation-material', 'first'),
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
        unitPrice: 3.5,
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
        unitPrice: 3.5,
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
