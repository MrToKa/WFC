/*!
 * LMV v7.130.0
 *
 * Copyright 2026 Autodesk, Inc.
 * All rights reserved.
 *
 * This computer source code and related instructions and comments are the
 * unpublished confidential and proprietary information of Autodesk, Inc.
 * and are protected under Federal copyright and state trade secret law.
 * They may not be disclosed to, copied or used by any third party without
 * the prior written consent of Autodesk, Inc.
 *
 * Autodesk Viewer SDK Usage Limitations:
 *
 * The Autodesk Viewer SDK JavaScript must be delivered from an
 * Autodesk-hosted URL.
 */
/******/ (() => { // webpackBootstrap
/******/ 	// runtime can't be in strict mode because a global variable is assign and maybe created.
/******/ 	var __webpack_modules__ = ({

/***/ "./extensions/ModelSheetTransition/ModelSheetConstants.js"
/*!****************************************************************!*\
  !*** ./extensions/ModelSheetTransition/ModelSheetConstants.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ALIGNMENT_SECTION_SET: () => (/* binding */ ALIGNMENT_SECTION_SET),
/* harmony export */   FIT_TO_SHEET_DURATION: () => (/* binding */ FIT_TO_SHEET_DURATION),
/* harmony export */   FLY_TO_DURATION: () => (/* binding */ FLY_TO_DURATION),
/* harmony export */   HIDE_DURATION: () => (/* binding */ HIDE_DURATION),
/* harmony export */   MODEL_SHEET_SECTION_SET: () => (/* binding */ MODEL_SHEET_SECTION_SET),
/* harmony export */   SHOW_DURATION: () => (/* binding */ SHOW_DURATION)
/* harmony export */ });
const HIDE_DURATION = 2.5; // In seconds
const SHOW_DURATION = 1.5; // In seconds
const FLY_TO_DURATION = 1.0; // In seconds
const FIT_TO_SHEET_DURATION = 0.5; // In seconds

const ALIGNMENT_SECTION_SET = 'Autodesk.Viewing.Extension.SheetAlignment';
const MODEL_SHEET_SECTION_SET = 'Autodesk.Viewing.Extension.ModelSheetTransition';

/***/ },

/***/ "./extensions/SmartSection/NavAdjustor.js"
/*!************************************************!*\
  !*** ./extensions/SmartSection/NavAdjustor.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavAdjustor: () => (/* binding */ NavAdjustor),
/* harmony export */   getViewableKey: () => (/* binding */ getViewableKey)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _SectionBox_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SectionBox.js */ "./extensions/SmartSection/SectionBox.js");
/* harmony import */ var _OBBUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./OBBUtils.js */ "./extensions/SmartSection/OBBUtils.js");




/** @import {SectionPlane} from './SectionPlane' */

class NavAdjustor {

  static clearCachedModels() {
    this._cachedModels.clear();
  }

  static _calcModelObb(model, callback) {
    const viewableKey = getViewableKey(model);
    const { aabb, noFrags } = this.getBestFitModelAABB(model);
    // triggered from onModelAdded
    // => either fragments are not loaded yet, or model has no geoms
    // => anyway postpone
    if (isBoxEmpty(aabb)) {
      this._cachedModels.set(viewableKey, { obbPromise: null });
    } else {
      const obb = (0,_OBBUtils_js__WEBPACK_IMPORTED_MODULE_2__.boxToOBB)(aabb, model.getModelToViewerTransform());
      const fragCount = model.getFragmentList()?.fragments?.length ?? 0;
      const data = { obb, model, obbPromise: null, noFrags, fragCount };
      const cached = this._cachedModels.get(viewableKey) ?? { model };
      this._cachedModels.set(viewableKey, Object.assign(cached, data));
      callback?.();
    }
  }

  static _promiseModelObb(model, callback) {
    return new Promise((resolve) => {
      this._calcModelObb(model, () => {
        this._resetWorldBox();
        callback?.();
      });
      resolve();
    });
  }

  /**
   * Caches the model and attempts to calculate its OBB, if fragments are already loaded.
   * If the model is already cached but not resolved, it will attempt once more,
   * otherwise it will reset the world box to trigger a recalculation with the new model included.
   * @param {*} model
   * @param {() => {}} callback - optional callback after the OBB is calculated
   */
  static addModel(model, callback) {
    if (model.is2d()) return;

    const viewableKey = getViewableKey(model);
    const cached = this._cachedModels.get(viewableKey) ?? { model };
    this._cachedModels.set(viewableKey, cached);
    if (!cached.obb || cached.noFrags) {
      cached.obbPromise = this._promiseModelObb(model, callback);
    } else {
      cached.model = model;
      this._resetWorldBox();
      callback?.();
    }
  }

  /**
   * Invalidates the cached model, so that it will not be used in the world box recalculation,
   * but keeps the cached OBB data for the case the model gets added again.
   */
  static invalidateModel(model) {
    const viewableKey = getViewableKey(model);
    if (this._cachedModels.has(viewableKey)) {
      const cached = this._cachedModels.get(viewableKey);
      cached.model = null;
      this._resetWorldBox();
      return true;
    }
  }

  /**
   * @returns The cached OBBs of the models that are currently visible (i.e., have a model instance) and resolved
   */
  static _getVisibleCachedModels() {
    const visibleModels = this.viewer.getVisibleModels().filter((m) => !m.is2d());
    return [...this._cachedModels.values()].filter((v) => v.obb && visibleModels.includes(v.model));
  }

  /** @type {THREE.Vector3[]} */
  static _worldOBB = [];

  static _cachedModels = new Map();

  /**
   * Get the new nav parameters for the nav speed and pivot
   * If there is a selected object visible inside the sectioned area, the adjustment will be skipped
   *
   * TODO can't adjust the navspeed for section plane reliably (easy with box) because would need to calculate the convex polyhedron
   *   generated by the section planes and tesslate it and use convex hull and that is out of scope for now.
   *
   * For a general purpose algorithm for calculating this properly see
   * "Finding the intersection of n half-spaces in time O(n log n) by Franco Preparata and D. Muller
   *
   * @returns {null | {pivot: any} | {polygon: [], pivot: exports.Vector3, speedScale: number} | {pivot: (any | exports.Vector3)}} The new nav parameters
   * @param viewer
   * @param {SectionPlane[]|SectionBox} planes
   */
  static getParameters(viewer, planes) {

    if (!planes || Array.isArray(planes) && !planes.length) {
      return { pivot: viewer?.navigation?.getPivotPoint() };

    } else if (planes instanceof _SectionBox_js__WEBPACK_IMPORTED_MODULE_1__.SectionBox) {
      const min = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5, -0.5).applyMatrix4(planes.object.matrixWorld);
      const max = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0.5).applyMatrix4(planes.object.matrixWorld);

      if (planes.inverted) {
        return {};
      }

      return {
        pivot: min.add(
          max.clone().sub(min).normalize().multiplyScalar(0.5 * min.distanceTo(max))
        )
      };
    }

    if (planes.length !== 1) {
      return null; // Box and multiplane not supported right now
    }

    // still need to calculate bounds if skipping the pivot adjustment
    const result = this.sliceSingleHalfSpace(viewer, planes[0]);
    // @todo: re-enable pivot adjustment when the requirement is clarified
    if (result /* && !this.isPivotAdjustmentNeeded(viewer, planes) */) {
      delete result.pivot;
    }

    return result;
  }

  /**
   * Check if the pivot adjustment is needed, i.e., if there was any visible selected object,
   * which was cut by the section planes
   * Currently supports only a single plane
   */
  static isPivotAdjustmentNeeded(viewer, planes) {
    const bounds = new three__WEBPACK_IMPORTED_MODULE_0__.Box3();
    const fragBounds = new three__WEBPACK_IMPORTED_MODULE_0__.Box3();

    const aggregatedSelection = viewer.getAggregateSelection();
    for (const { model, selection: selectedDbIds } of aggregatedSelection) {
      const it = model.getObjectTree();

      if (!it || !selectedDbIds?.length) continue;

      const fragList = model.getFragmentList();
      selectedDbIds.forEach((dbid) => {
        it.enumNodeFragments(
          dbid,
          (fragId) => {
            fragList.getWorldBounds(fragId, fragBounds);
            bounds.union(fragBounds);
          },
          true
        );
      });

      const hessianPlane = planes[0].toVector4();
      if (this.isOutOfBounds(bounds.min, hessianPlane) || this.isOutOfBounds(bounds.max, hessianPlane)) {
        return true;
      }
    }
    return false;
  }

  /**
   *
   * @param viewer
   * @param plane
   * @param {number} cutoutScalar Will scale the boundary polygon generated by this amount
   * @returns {{polygon: *[], pivot: exports.Vector3, speedScale: number}|null}
   */
  static sliceSingleHalfSpace(viewer, plane, cutoutScalar = 1.3) {

    // TODO witnessed a strange bug where the model bounding box isn't available on the MODEL_ROOT_LOADED event. Using this as a fallback as I cannot reliably repro
    //     The caching of model bounds was added as a workaround for the section caps breaking the model bounds function in the first place, so this branch will only
    //     be entered when there is not a single plane added yet (and consequently no section caps), which will give a proper bounds
    // Upd. also witnessed when min and max are all zero
    this.calculateOptimizedModelOBB(viewer);

    const hessianPlane = plane.toVector4();

    const outOfBounds = [];
    const inBounds = [];
    for (const vertex of this._worldOBB) {
      if (this.isOutOfBounds(vertex, hessianPlane)) {
        outOfBounds.push(vertex);
      } else {
        inBounds.push(vertex);
      }
    }

    if (!outOfBounds.length && !inBounds.length) {
      return null;
    }

    const intersectedVertices = [];
    const negatedNormal = plane.normal.clone().negate();

    outOfBounds.forEach((vertex) => {
      const intersection = plane.intersectRay(TMP_RAY.set(vertex, negatedNormal));
      intersection && intersectedVertices.push(intersection);
    });

    inBounds.forEach((vertex) => {
      const intersection = plane.intersectRay(TMP_RAY.set(vertex, plane.normal));
      intersection && intersectedVertices.push(intersection);
    });

    const allVtx = [...inBounds, ...intersectedVertices];

    const pivot = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
    for (let i = 0; i < allVtx.length; i++) {
      pivot.x += allVtx[i].x;
      pivot.y += allVtx[i].y;
      pivot.z += allVtx[i].z;
    }
    pivot.divideScalar(allVtx.length);

    // TODO these vertices are not sorted counter/clockwise like should be
    return { pivot, speedScale: 1, bounds: intersectedVertices, scale: cutoutScalar };
  }

  static isOutOfBounds(vec3, plane) {
    return plane.x * vec3.x + plane.y * vec3.y + plane.z * vec3.z + plane.w > 1E-4;
  }

  static isWorldBoxEmpty() {
    return this._worldOBB.length === 0;
  }

  static _resetWorldBox() {
    this._worldOBB.length = 0;
  }

  /**
   * Calculates a custom optimized model OBB by using the best fit of either the bounding box or - in case of outliers - the fuzzy box of each model.
   * The result is stored in NavAdjustor.modelOBB
   * @param {Autodesk.Viewing.Viewer3D} viewer
   */
  static calculateOptimizedModelOBB(viewer) {

    if (!this.isWorldBoxEmpty()) return;

    this._worldOBB.length = 0;
    for (let i = 0; i < 8; i++) {
      this._worldOBB.push(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3());
    }

    const cachedModels = this._getVisibleCachedModels();

    if (cachedModels.length === 0) {
      // dummy case, no models visible, just set something
      const viewerBox = viewer.impl.getVisibleBounds(true, true, null, true);
      const { max, min } = viewerBox;
      this.minWorldSize = Math.min(max.x - min.x, max.y - min.y, max.z - min.z);
      (0,_OBBUtils_js__WEBPACK_IMPORTED_MODULE_2__.boxToVertices)(viewerBox, null, this._worldOBB);
      return;
    }

    // if there is only one model, we can just use its bounds
    if (cachedModels.length === 1) {
      const { obb } = cachedModels[0];

      for (let i = 0; i < obb.bounds.length; i++) {
        const p = obb.bounds[i];
        this._worldOBB[i].copy(p);
      }
      // normally, size is half of the box edges, but we use x2
      // to be in sync with other cases and already tested UI
      this.minWorldSize = Math.min(obb.size.x, obb.size.y, obb.size.z) * 2;

      return;
    }

    // otherwise we need to calculate a fuzzy box from the fuzzy boxes - aka sort out the outliers

    const aggregateCenter = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
    const modelOBBs = [];
    let mass = 0;

    for (const { obb, fragCount } of cachedModels) {
      modelOBBs.push(obb);

      // weight by box size and fragment count
      const size = obb.size.length();
      obb.weight = size * fragCount;

      aggregateCenter.addScaledVector(obb.centroid, obb.weight);
      mass += obb.weight;
    }

    aggregateCenter.divideScalar(mass);

    // sort by increasing distance
    for (let i = 0; i < modelOBBs.length; i++) {
      modelOBBs[i].squaredDistance = modelOBBs[i].centroid.distanceToSquared(aggregateCenter);
    }
    modelOBBs.sort((a, b) => a.squaredDistance - b.squaredDistance);

    // use interquartile range to detect outliers
    const q1 = modelOBBs[Math.floor(modelOBBs.length * 0.25)].squaredDistance;
    const q3 = modelOBBs[Math.floor(modelOBBs.length * 0.75)].squaredDistance;
    const iqr = q3 - q1;
    const threshold = q3 + 1.5 * iqr;

    // now take all our 8-vertex OBBs and merge them
    // until the first outlier is detected
    const tooFar = modelOBBs.findIndex((b) => b.squaredDistance > threshold);
    tooFar > -1 && (modelOBBs.length = tooFar);
    const aggregateAABB = new three__WEBPACK_IMPORTED_MODULE_0__.Box3();
    TMP_QUAT.set(0, 0, 0, 1);

    // re-calculate the aggregate center for the remaining boxes
    mass = 0;
    aggregateCenter.set(0, 0, 0);
    for (const obb of modelOBBs) {
      aggregateCenter.addScaledVector(obb.centroid, obb.weight);
      mass += obb.weight;
    }
    aggregateCenter.divideScalar(mass);

    for (let i = 0; i < modelOBBs.length; i++) {
      const { bounds, rotation } = modelOBBs[i];
      TMP_QUAT.slerp(rotation, Number(!i) || 1 / modelOBBs.length);

      bounds.forEach((vertex) => {
        aggregateAABB.expandByPoint(TMP_VEC3.copy(vertex).sub(aggregateCenter));
      });
    }

    const worldTransform = TMP_MAT4.makeRotationFromQuaternion(TMP_QUAT);
    worldTransform.setPosition(aggregateCenter);

    const { min, max } = aggregateAABB;
    this.minWorldSize = Math.min(max.x - min.x, max.y - min.y, max.z - min.z);

    (0,_OBBUtils_js__WEBPACK_IMPORTED_MODULE_2__.boxToVertices)(aggregateAABB, worldTransform, this._worldOBB);
  }

  /**
   * Returns the best fit AABB for a model based on the error between the model's bounding box and the fuzzy box.
   * In case of outliers the bounding box will be way larger than the fuzzy box, so we use the fuzzy box in that case.
   * @param {Autodesk.Viewing.Model} model
   * @param {number} threshold The threshold to decide which box to use. Default is 1.5.
   * @returns {{ aabb: Box3, noFrags?: boolean }} A non-transformed AABB and a flag indicating if the model has no fragments
   * or if the fragments are not loaded yet
   */
  static getBestFitModelAABB(model, threshold = 1.5) {
    const modelBox = model.getBoundingBox(true, true);
    const frags = model.getFragmentList();
    // quick'n'dirty way to check if the fragments are loaded and the bounds can be calculated
    if (!frags?.fragments?.length || frags.fragments.length > frags.fragments.numLoaded) return { aabb: modelBox, noFrags: true };
    // For OTG, `numLoaded` is not enough: it only tells us that the fragment *list* was parsed, while the
    // bounding boxes arrive later, so `frags.boxes` can still be all zeros. The fuzzy box is then not just
    // meaningless: its center of mass becomes 0/0 = NaN, which degenerates getFuzzyBox()'s quickSelect
    // into O(n^2) and stalls the load. isLoadDone() covers models added after they finished loading.
    if (model.isOTG() && !frags.fragments.boxesLoaded && !model.isLoadDone()) return { aabb: modelBox, noFrags: true };
    const fuzzyBox = model.getFuzzyBox({ ignoreTransforms: true });
    const error = modelBox.getSize(TMP_VEC3).length() / fuzzyBox.getSize(TMP_VEC3).length();
    const isFuzzy = Number.isFinite(error) && error >= threshold;
    return { aabb: isFuzzy ? fuzzyBox : modelBox };
  }
}

const getViewableKey = (model) => {
  const docNode = model.getDocumentNode();
  if (!docNode) {
    // fallback, used in tests w/o manifest
    return '';
  }
  return `${docNode.data?.viewableID}${docNode.getViewableRootPath()}`;
};

function isBoxEmpty(box) {
  if (!box || box.isEmpty()) return true;
  const size = box.getSize(TMP_VEC3).length();
  return !Number.isFinite(size) || size < 1E-7;
}

const TMP_QUAT = new THREE.Quaternion();
const TMP_VEC3 = new THREE.Vector3();

const TMP_MAT4 = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();
const TMP_RAY = new three__WEBPACK_IMPORTED_MODULE_0__.Ray();

/***/ },

/***/ "./extensions/SmartSection/OBBUtils.js"
/*!*********************************************!*\
  !*** ./extensions/SmartSection/OBBUtils.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   boxToOBB: () => (/* binding */ boxToOBB),
/* harmony export */   boxToVertices: () => (/* binding */ boxToVertices),
/* harmony export */   calculateBoundingBoxVolume: () => (/* binding */ calculateBoundingBoxVolume),
/* harmony export */   findMinVolumeRotation: () => (/* binding */ findMinVolumeRotation),
/* harmony export */   getOBBoxFaceRotation: () => (/* binding */ getOBBoxFaceRotation)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);


/** @import { SectionBox } from "./SectionBox" */

/**
 * Utilities for calculating Oriented Bounding Boxes (OBB) with optimal rotation
 */

const TMP_QUAT = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
const TMP_BOX3 = new three__WEBPACK_IMPORTED_MODULE_0__.Box3();
const TMP_VEC3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const TMP_RAY = new three__WEBPACK_IMPORTED_MODULE_0__.Ray();
const TMP_MAT4 = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();

// obb face vertices ordered CCW
// plane requires only 3, but needed all 4 to properly calculate the centroid
const faces = [
[0, 1, 2, 3],
[4, 7, 6, 5],
[0, 4, 5, 1],
[3, 2, 6, 7],
[0, 3, 7, 4],
[1, 5, 6, 2]];

const _max = { x: 0.5, y: 0.5, z: 0.5 };
const _min = { x: -0.5, y: -0.5, z: -0.5 };
function obbToFaceVertices(normal, obbMatrix4) {
  const vertices = [
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_min.x, _min.y, _min.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_min.x, _max.y, _min.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_max.x, _max.y, _min.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_max.x, _min.y, _min.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_min.x, _min.y, _max.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_min.x, _max.y, _max.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_max.x, _max.y, _max.z),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(_max.x, _min.y, _max.z)].
  map((v) => v.applyMatrix4(obbMatrix4));

  const centroid = vertices.reduce((a, b) => a.add(b), TMP_VEC3.set(0, 0, 0)).divideScalar(vertices.length);
  const planes = faces.map(([a, b, c]) => new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setFromCoplanarPoints(vertices[a], vertices[b], vertices[c]).normalize());

  TMP_RAY.set(centroid, normal);
  let faceIndex = -1;
  let minDist = +Infinity;
  for (let i = 0; i < planes.length; i++) {
    const intersect = TMP_RAY.intersectPlane(planes[i]);
    if (intersect) {
      const distance = intersect.distanceTo(centroid);
      if (distance < minDist) {
        minDist = distance;
        faceIndex = i;
      }
    }
  }

  if (faceIndex > -1) {
    return faces[faceIndex].map((i) => vertices[i]);
  }
  return null;
}

/**
 * @param {Vector3} faceNormal
 * @param {SectionBox} obb
 * @returns {{ zAxis: Vector3; quaternion: Quaternion }|undefined}
 */
function getOBBoxFaceRotation(faceNormal, obb) {
  if (!obb || !faceNormal) return;

  obb.updateMatrixWorld();
  const obbFaceVertices = obbToFaceVertices(faceNormal, obb.matrixWorld);

  if (!obbFaceVertices) return;

  const faceCenter = obbFaceVertices.reduce((a, b) => a.add(b), new three__WEBPACK_IMPORTED_MODULE_0__.Vector3()).divideScalar(obbFaceVertices.length);
  obbFaceVertices.forEach((v) => v.sub(faceCenter));

  // calculate rotation from the face vertices, 3 points are enough, 4 needed to calculate centroid above
  const [a, b, c] = obbFaceVertices;
  const xAxis = b.clone().sub(a).normalize();
  const yAxis = c.clone().sub(b).normalize();
  const zAxis = xAxis.clone().cross(yAxis).normalize();

  TMP_QUAT.setFromRotationMatrix(TMP_MAT4.set(
    xAxis.x, yAxis.x, zAxis.x, 0,
    xAxis.y, yAxis.y, zAxis.y, 0,
    xAxis.z, yAxis.z, zAxis.z, 0,
    0, 0, 0, 1
  ));
  return { zAxis, quaternion: TMP_QUAT };
}

/**
 * Find a rotation, which minimizes the bounding volume for the given vertices
 *
 * @param {Vector3[]} vertices
 * @param {Vector3} centroid
 * @param {Quaternion} rotation
 * @returns {{ rotation: Quaternion; localVertices: Vector3[] }} volume and transformed local vertices
 */
function findMinVolumeRotation(worldVertices, centroid, rotations) {

  let minVolume = Infinity;

  const rotation = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
  const localCenter = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
  const scale = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();

  const result = { rotation, localCenter, scale };

  for (let i = 0; i < rotations.length; i++) {
    const { volume, localCenter, scale } = calculateBoundingBoxVolume(worldVertices, centroid, rotations[i]);

    if (volume < minVolume * 0.9) {
      minVolume = volume;
      result.rotation.copy(rotations[i]);
      result.localCenter.copy(localCenter);
      result.scale.copy(scale);
    }
  }

  return result;
}

/**
 * Calculate bounding box volume for given rotation
 *
 * @param {Vector3[]} vertices
 * @param {Vector3} centroid
 * @param {Quaternion} rotation
 * @returns {{ volume: number; localVertices: Vector3[] }} volume and transformed local vertices
 */
function calculateBoundingBoxVolume(vertices, centroid, rotation) {

  const inverseRotation = TMP_QUAT.clone().copy(rotation).conjugate().normalize();

  const { min: localMin, max: localMax } = TMP_BOX3.makeEmpty();

  for (const v of vertices) {
    TMP_VEC3.copy(v).sub(centroid).applyQuaternion(inverseRotation);
    localMin.min(TMP_VEC3);
    localMax.max(TMP_VEC3);
  }

  const { x, y, z } = localMin;
  const localCenter = localMin.add(localMax).multiplyScalar(0.5);
  const scale = localMax.sub({ x, y, z });
  const volume = scale.x * scale.y * scale.z;
  return { volume, localCenter, scale };
}

const TMP_BOUNDS = [TMP_VEC3, TMP_VEC3, TMP_VEC3, TMP_VEC3, TMP_VEC3, TMP_VEC3, TMP_VEC3, TMP_VEC3];

/**
 * Converts an AABB to an OBB in the form of 8 vertices. The result is stored in targetBounds.
 * @param {THREE.Box3} box
 * @param {THREE.Matrix4} transform
 * @param {THREE.Vector3[]} targetBounds
 * @returns {THREE.Vector3[]} OBB as 8 vertices
 */
function boxToVertices(box, transform, targetBounds) {
  targetBounds = targetBounds || TMP_BOUNDS.map((v) => v.clone());

  const { min, max } = box;

  targetBounds[0].set(min.x, min.y, min.z);
  targetBounds[1].set(min.x, min.y, max.z);
  targetBounds[2].set(min.x, max.y, min.z);
  targetBounds[3].set(min.x, max.y, max.z);
  targetBounds[4].set(max.x, max.y, max.z);
  targetBounds[5].set(max.x, max.y, min.z);
  targetBounds[6].set(max.x, min.y, max.z);
  targetBounds[7].set(max.x, min.y, min.z);

  if (transform) {
    for (let i = 0; i < 8; i++) {
      targetBounds[i].applyMatrix4(transform);
    }
  }

  return targetBounds;
}

function boxToOBB(box, transform) {

  const bounds = boxToVertices(box, transform);

  const { min, max } = box;

  const centroid = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    centroid.add(bounds[i]);
  }
  centroid.multiplyScalar(0.125); // 1/8

  const rotation = new THREE.Quaternion();
  const scale = TMP_VEC3.set(1, 1, 1);

  if (transform) {
    transform.decompose(TMP_VEC3, rotation, scale);
  }

  const size = max.clone().sub(min).multiplyScalar(0.5).multiply(scale);

  return { bounds, centroid, rotation, size };
}

/***/ },

/***/ "./extensions/SmartSection/OneDGizmo.js"
/*!**********************************************!*\
  !*** ./extensions/SmartSection/OneDGizmo.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   OneDGizmo: () => (/* binding */ OneDGizmo)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _RayCasterUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./RayCasterUtils.js */ "./extensions/SmartSection/RayCasterUtils.js");




class OneDGizmo extends three__WEBPACK_IMPORTED_MODULE_0__.Group {

  constructor() {
    super();

    this._createMaterials();
    this._createGeometry();
  }

  _createMaterials() {
    this.material = new Autodesk.Viewing.Scene.UnlitMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: three__WEBPACK_IMPORTED_MODULE_0__.FrontSide,
      color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(1, 0, 0),
      opacity: 0.7
    });

    this.highlightMaterial = this.material.clone();
    this.highlightMaterial.color.setRGB(1, 1, 0);
    this.highlightMaterial.opacity = 1;
  }

  _createGeometry() {
    const material = this.material;

    // point object local direction/front
    const rotation = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationX(90 * Math.PI / 180);
    const arrowGeometry = new three__WEBPACK_IMPORTED_MODULE_0__.CylinderBufferGeometry(0, 0.05, .3 /*height*/, 12, 1, false);
    arrowGeometry.applyMatrix4(rotation);
    arrowGeometry.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeTranslation(0, 0, .7 + .3 / 2));
    const arrowMesh = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowGeometry, material.clone());

    const cylinderGeom = new three__WEBPACK_IMPORTED_MODULE_0__.CylinderBufferGeometry(0.02, 0.02, .7 /*height*/, 8, 1, false);
    cylinderGeom.applyMatrix4(rotation);
    cylinderGeom.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeTranslation(0, 0, .7 / 2));
    const cylinderMesh = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(cylinderGeom, material.clone());

    const hitboxGeom = new three__WEBPACK_IMPORTED_MODULE_0__.CylinderBufferGeometry(0.08, 0.05, 1 /*height*/, 8, 1, false);
    hitboxGeom.applyMatrix4(rotation);
    const mat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();
    hitboxGeom.applyMatrix4(mat.makeScale(1.8, 1.8, 1.1));
    hitboxGeom.applyMatrix4(mat.makeTranslation(0, 0, 0.5 + .1 / 2));
    const hitboxMesh = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(hitboxGeom, material.clone());
    hitboxMesh.visible = false;

    this.add(arrowMesh);
    this.add(cylinderMesh);
    this.add(hitboxMesh);

    this.visible = false;
  }

  onDragStart(event, camera) {
    const normal1 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 0, 0).applyQuaternion(this.getWorldQuaternion());
    const normal2 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 1, 0).applyQuaternion(this.getWorldQuaternion());

    const raycaster = (0,_RayCasterUtils_js__WEBPACK_IMPORTED_MODULE_1__.updateRayCasterFromNdc)(camera, new three__WEBPACK_IMPORTED_MODULE_0__.Raycaster(), event.normalizedX, event.normalizedY);
    const intersects = raycaster.intersectObject(this, true);
    const anchorPoint = intersects.length ? intersects[0].point : this.getWorldPosition();

    this.hitplanes = [
    new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setFromNormalAndCoplanarPoint(normal1, anchorPoint),
    new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setFromNormalAndCoplanarPoint(normal2, anchorPoint)];

    this.intersectStart = anchorPoint;
    const thisPlane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setFromNormalAndCoplanarPoint(this.face.getWorldDirection(), this.face.getWorldPosition());
    this.intersectionOffset = thisPlane.projectPoint(this.intersectStart.clone()).distanceTo(this.intersectStart);
  }

  handleMove(event, camera, raycaster, box) {

    (0,_RayCasterUtils_js__WEBPACK_IMPORTED_MODULE_1__.updateRayCasterFromNdc)(camera, raycaster, event.normalizedX, event.normalizedY);

    let minIntersection;
    this.hitplanes.forEach((plane) => {
      const intersection = raycaster.ray.intersectPlane(plane);

      if (intersection) {
        const cameraRay = intersection.clone().sub(camera.position).normalize();

        if (Math.abs(cameraRay.dot(plane.normal)) <= 0.15) {// small angles cause glitching/teleporting
          return;
        }

        if (!minIntersection || intersection && intersection.distanceTo(camera.position) < minIntersection.distanceTo(camera.position)) {
          minIntersection = intersection;
        }
      }

    });

    if (!minIntersection) return;

    const dir = this.face.getWorldDirection();
    const oppositeFace = this.face.parent.children.find((it) => dir.clone().add(it.getWorldDirection()).length() < 1E-6);
    const oppositePlane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setFromNormalAndCoplanarPoint(oppositeFace.getWorldDirection(), oppositeFace.getWorldPosition());

    let newScale = -oppositePlane.distanceToPoint(minIntersection) - this.intersectionOffset;
    if (newScale < 1) {
      newScale = 1;
    }

    const normal = this.face.getWorldPosition().sub(oppositeFace.getWorldPosition()).normalize();
    const newBoxPos = oppositeFace.getWorldPosition().add(normal.clone().multiplyScalar(newScale / 2));

    box.position.copy(newBoxPos);
    this.face.setBoxScale(newScale);
    // update gizmo pos, not a child of box
    this.position.copy(this.face.getWorldPosition());
  }

  isHighlighted() {
    return Boolean(this.highlighted);
  }

  // gizmo highlight is separate from face highlighing
  setHighlight(enabled, color) {
    if (color) {
      this.highlightMaterial.color.copy(color);
    }
    this.traverse((it) => {
      if (it.type !== 'Mesh') return;
      it.material = enabled ? this.highlightMaterial : this.material;
    });
    this.highlighted = enabled;
  }

  onCameraChanged(camera, canvas) {
    let factor;
    if (camera.isOrthographicCamera) {
      factor = (camera.top - camera.bottom) / camera.zoom;
    } else {
      const dist = this.getWorldPosition().distanceTo(camera.position);
      factor = 2 * Math.tan(Math.PI * camera.fov / 360) * dist;
    }
    const currentScale = factor * OneDGizmo.INITIAL_SIZE * 150 / canvas.getBoundingClientRect().height;
    this.scale.set(currentScale, currentScale, currentScale);
  }

  attach(face) {
    this.face = face;
    this.setRotationFromQuaternion(this.face.getWorldQuaternion());
    this.position.copy(this.face.getWorldPosition());
  }

  static INITIAL_SIZE = 1;

}

/***/ },

/***/ "./extensions/SmartSection/PlacementIndicator.js"
/*!*******************************************************!*\
  !*** ./extensions/SmartSection/PlacementIndicator.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PlacementBox: () => (/* binding */ PlacementBox),
/* harmony export */   PlacementPlane: () => (/* binding */ PlacementPlane)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _SmartSection_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SmartSection.js */ "./extensions/SmartSection/SmartSection.js");
/* harmony import */ var _SectionPlane_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SectionPlane.js */ "./extensions/SmartSection/SectionPlane.js");
/* harmony import */ var _NavAdjustor_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./NavAdjustor.js */ "./extensions/SmartSection/NavAdjustor.js");
/* harmony import */ var _SectionBox_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./SectionBox.js */ "./extensions/SmartSection/SectionBox.js");
/* harmony import */ var _OBBUtils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./OBBUtils.js */ "./extensions/SmartSection/OBBUtils.js");







const { VertexEnumerator } = Autodesk.Viewing.Private;

// a conservative heuristic to avoid stutterings when calculating OBB for large geometries
const MAX_SUPPORTED_VERTICES = 1E6;

class PlacementPlane {

  static PLACEMENT_DIST_Z_SCALING = 1 / 10;
  static BASE_DIMENSION = 3;

  type = 'plane';

  scaleUpAnimationTime = 200;
  cutoutAnimationTime = 200;
  outerWidthAnimationTime = 50;

  plane;

  #trueNorthRotation = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();

  get isAnimating() {
    return Boolean(this.pendingAnimationCallback);
  }

  get mesh() {
    return this.plane.root;
  }

  _cameraPlane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane();
  get cameraPlane() {
    this._cameraPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(), this.camera.position);
    return this._cameraPlane;
  }

  get camera() {
    return this.viewer.getCamera();
  }

  /** @type {PlacementBox} a helper box to assist with plane orientation for complex transforms */
  #placementBox;

  /**
   * Visualization for interactively placing a section plane
   * @param viewer
   */
  constructor(viewer, options = { animate: false }) {
    this.viewer = viewer;
    this.options = options;
    this.plane = new _SectionPlane_js__WEBPACK_IMPORTED_MODULE_2__.SectionPlane();
    this.plane.setColor(0, 1, 0.85, 'NONE'); // for non-ortho axes for easier viewing


    // hide the selection structure (only for already placed planes)
    this.plane.outerMeshVisible = false;
    this.plane.setInnerFillPercentage(1);

    this.plane.width = PlacementPlane.BASE_DIMENSION;
    this.plane.height = PlacementPlane.BASE_DIMENSION;

    this.lastPosition = this.plane.root.position.clone();
    this.lastPick = null;

    // prevent initial rendering at the world center
    this.plane.root.visible = false;

    viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.SMART_SECTION_OVERLAY_KEY, this.plane.root);
  }

  place(pick) {

    if (this.isPaused()) {
      return Promise.resolve(null);
    }

    this.updatePlacement(pick);

    // Push back because the z-fighting issue
    const resultOrigin = pick.intersectPoint.clone().add(this.plane.normal.clone().multiplyScalar(-1 * this.getZFightingOffset(pick)));
    const plane = this.resultPlane = new _SectionPlane_js__WEBPACK_IMPORTED_MODULE_2__.SectionPlane(resultOrigin, this.plane.normal, this.plane.normalPlacementTransformInverse);
    this.resultPlane.rotation = this.plane.rotation;
    this.plane.origin = plane.origin;
    if (!this.options.animate) {
      return new Promise((res) => res(this.resultPlane));
    }

    const params = _NavAdjustor_js__WEBPACK_IMPORTED_MODULE_3__.NavAdjustor.sliceSingleHalfSpace(this.viewer, plane);
    const { position, width, height } = plane.updateMeshFromBounds(params);

    // get from-to cut plane
    const bbox = this.viewer.impl.getVisibleBounds();
    const origin = this.plane.root.getWorldPosition().clone();
    const ray = new three__WEBPACK_IMPORTED_MODULE_0__.Ray(origin, this.plane.normal);

    const fromPlaneOrigin = Autodesk.Viewing.Private.SceneMath.
    box2CutPlanes(bbox).
    map((vec4) => new three__WEBPACK_IMPORTED_MODULE_0__.Plane(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(vec4.x, vec4.y, vec4.z), vec4.w)).
    map((plane) => ray.intersectPlane(plane)).
    filter((it) => it).
    sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))[0];

    const fromPlane = new _SectionPlane_js__WEBPACK_IMPORTED_MODULE_2__.SectionPlane(fromPlaneOrigin, plane.normal).toVector4();

    this.animation = {
      startTime: performance.now(),
      fromPos: this.plane.root.getWorldPosition().clone(),
      fromWidth: this.plane.width,
      fromHeight: this.plane.height,
      toPos: position,
      toWidth: width,
      toHeight: height,
      fromPlane,
      toPlane: plane.toVector4(),
      fromFillPercentage: 1,
      toFillPercentage: 0,
      fromOuterWidth: 1e-6,
      toOuterWidth: _SectionPlane_js__WEBPACK_IMPORTED_MODULE_2__.SectionPlane.OUTER_WIDTH,
      toBounds: params.polygon
    };

    this.animation.endScaleUpAnimation = this.animation.startTime + this.scaleUpAnimationTime;
    this.animation.endCutoutAnimation = this.animation.endScaleUpAnimation + this.cutoutAnimationTime;
    this.animation.endOuterWidthAnimation = this.animation.endCutoutAnimation + this.outerWidthAnimationTime;

    return new Promise((resolve) => {
      this.pendingAnimationCallback = resolve;
    });
  }


  update() {
    if (!this.animation) return;

    const anim = this.animation;
    const now = performance.now();

    if (now >= anim.endScaleUpAnimation) {
      // kinda a hack: translation & resize operates on scaling the entire mesh,
      // while animating the cutout operates on scaling the vertices of the mesh
      if (!this.secondKeyframe) {
        this.secondKeyframe = true;
        this.plane.width = 1;
        this.plane.height = 1;
        this.plane.root.outerMeshVisible = false;
        this.viewer.impl.setCutPlaneSet('PLACEMENT_PLANE', [anim.toPlane.clone()]);
      }
      const params = _NavAdjustor_js__WEBPACK_IMPORTED_MODULE_3__.NavAdjustor.sliceSingleHalfSpace(this.viewer, this.resultPlane);
      this.plane.updateMeshFromBounds(params);
      this.animateCutout();
      return;
    }

    const baseAlpha = (now - anim.startTime) / this.scaleUpAnimationTime;

    // ease in calculation
    const alpha = 1 - Math.cos(baseAlpha * Math.PI / 2);

    const newPos = this.animation.fromPos.lerp(anim.toPos, alpha);
    const newWidth = (anim.toWidth - anim.fromWidth) * alpha + anim.fromWidth;
    const newHeight = (anim.toHeight - anim.fromHeight) * alpha + anim.fromHeight;

    this.plane.width = newWidth;
    this.plane.height = newHeight;
    this.plane.root.position.copy(newPos);

    const newConstant = (anim.toPlane.w - anim.fromPlane.w) * alpha + anim.fromPlane.w;
    this.viewer.impl.setCutPlaneSet('PLACEMENT_PLANE', [anim.fromPlane.clone().setW(newConstant)]);

    // TODO maybe this anim should just run strictly on the overlay... but also animating the plane constant is a full redraw
    this.viewer.impl.invalidate(true, true, true);
  }


  animateCutout() {
    const anim = this.animation;
    const now = performance.now();

    if (now >= anim.endCutoutAnimation) {
      this.plane.innerMeshVisible = false;
      this.plane.outerMeshVisible = true;
      this.animateOuterWidth();
      return;
    }

    const baseAlpha = (now - anim.endScaleUpAnimation) / this.cutoutAnimationTime;

    // ease out calculation
    const alpha = Math.sqrt(1 - Math.pow(baseAlpha - 1, 2));

    const newCutoutScale = (anim.toFillPercentage - anim.fromFillPercentage) * alpha + anim.fromFillPercentage;
    this.plane.setInnerFillPercentage(newCutoutScale);
    this.viewer.impl.invalidate(false, false, true);
  }

  animateOuterWidth() {
    const anim = this.animation;
    const now = performance.now();

    if (now >= anim.endOuterWidthAnimation) {
      this.pendingAnimationCallback(this.resultPlane);
      setTimeout(() => this.viewer.impl.setCutPlaneSet('PLACEMENT_PLANE', null));
      return;
    }

    // TODO fix hack
    const alpha = Math.abs(1 - Math.abs((now - anim.endOuterWidthAnimation) / this.outerWidthAnimationTime));
    const newOuterWidth = (anim.toOuterWidth - anim.fromOuterWidth) * alpha + anim.fromOuterWidth;
    this.plane.setOuterWidth(newOuterWidth);
    this.viewer.impl.invalidate(false, false, true);
  }

  updatePlacement(pick, mode, vpVec) {

    this.mode = mode ?? this.mode;

    // happens if camera moves before the mouse intersects the geometry
    if (!pick) {

      const mousePosition = !vpVec ? this.lastPosition : getMousePosition(vpVec, this.camera, this.viewer, this.lastPosition);
      if (!mousePosition) {
        this.pausePlacement();
        return;
      }

      const distance = this.camera.position.distanceTo(mousePosition);

      const scaling = this.camera.isPerspective ?
      distance * PlacementPlane.PLACEMENT_DIST_Z_SCALING * (this.camera.fov * Math.PI / 180) :
      (this.camera.top - this.camera.bottom) / this.camera.zoom * PlacementPlane.PLACEMENT_DIST_Z_SCALING;

      this.plane.width = PlacementPlane.BASE_DIMENSION * scaling;
      this.plane.height = PlacementPlane.BASE_DIMENSION * scaling;

      this.plane.resetRotation();
      this.plane.rotation = this.plane.rotation.multiply(this.#trueNorthRotation); // plane.rotation is a setter, so we need to call it like this

      this.plane.origin = mousePosition;

      this.lastPick = null;
      this.lastPosition = mousePosition;

      // trigger a visual update instead of a custom event
      this.viewer.impl.invalidate(false, false, true);
      // "mousePosition" is projected to the ground plane and might be outside the view frustum
      // calling invalidate doesn't suffice since near/far are already determined before this update so we need to call updateCameraMatrices
      this.viewer.impl.updateCameraMatrices();

      return;
    }

    this.lastPick = pick;

    const distance = this.cameraPlane.projectPoint(pick.intersectPoint.clone()).distanceTo(pick.intersectPoint);
    const scaling = this.camera.isPerspective ?
    distance * PlacementPlane.PLACEMENT_DIST_Z_SCALING * (this.camera.fov * Math.PI / 180) :
    (this.camera.top - this.camera.bottom) / this.camera.zoom * PlacementPlane.PLACEMENT_DIST_Z_SCALING;

    this.plane.width = PlacementPlane.BASE_DIMENSION * scaling;
    this.plane.height = PlacementPlane.BASE_DIMENSION * scaling;

    if (this.mode === _SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.PlacementStrategy.PLANE_SURFACE_NORMAL) {
      pick.model.getFragmentList()?.getWorldMatrix(pick.fragId, TMP_MAT4);
      TMP_MAT3.getNormalMatrix(TMP_MAT4);
      // NOTE !!! pick.intersectPoint is in world space, whereas pick.face.normal is in local space !!!
      const normal = pick.face.normal.clone().applyMatrix3(TMP_MAT3).normalize();

      // we explicitly need the placement transform without the model transform, so model.getInverseModelToViewerTransform won't work
      TMP_MAT4.copy(pick.model.getPlacementTransform()).invert();
      TMP_MAT3.getNormalMatrix(TMP_MAT4);
      this.plane.normalPlacementTransformInverse.copy(TMP_MAT3);

      this.trySetRotationFromOBB(pick, normal);
    } else {
      this.plane.resetRotation();
      this.plane.rotation = this.plane.rotation.multiply(this.#trueNorthRotation); // plane.rotation is a setter, so we need to call it like this
    }

    // Z fighting workaround
    const adjusted = pick.intersectPoint.clone().add(
      this.plane.normal.clone().multiplyScalar(this.getZFightingOffset(pick, 2)));
    this.plane.origin = adjusted;

    this.viewer.impl.invalidate(false, false, true);
  }

  /**
  * Pause the placement process - Preview plane will be hidden and no updates will be made to the placement
  * Will do nothing if the placement is already paused
  * Currently used to prevent the placement from being updated when we are hovering over a cap mesh
  */
  pausePlacement() {
    if (this.isPaused()) {
      return;
    }

    this.setVisible(false);
    this.lastPosition = null;
    this.lastPick = null;
    this._placementPaused = true;
    this.viewer.impl.invalidate(false, false, true);
  }

  /**
   * Resume the placement process
   * Will do nothing if the placement is not paused
   */
  resumePlacement() {
    this.setVisible(true);

    if (!this.isPaused()) {
      return;
    }

    this.lastPosition = this.plane.root.position.clone();

    this._placementPaused = false;
    this.viewer.impl.invalidate(false, false, true);
  }

  isPaused() {
    return this._placementPaused;
  }

  /**
   * Try to find a rotation from the obb of the object being picked.
   * This results in a better alignment of the preview plane.
   */
  trySetRotationFromOBB(pick, faceNormal) {

    if (!this.#placementBox) {
      this.#placementBox = new PlacementBox(this.viewer);
      // this.placementBox.setVisible(true); // uncomment for debugging
    }
    if (this.#placementBox.updatePlacementByObb(pick)) {
      // get obb face closest to the picked face normal
      const obbFaceRotation = (0,_OBBUtils_js__WEBPACK_IMPORTED_MODULE_5__.getOBBoxFaceRotation)(faceNormal, this.#placementBox.box);

      if (obbFaceRotation) {
        // rotate preview plane first to the obb face and then to the picked face normal
        this.plane.rotation = this.plane.rotation.setFromUnitVectors(obbFaceRotation.zAxis, faceNormal).multiply(obbFaceRotation.quaternion);
        return;
      }
    }

    this.plane.normal = faceNormal;
  }

  onCameraChanged() {
    !this.isAnimating && this.updatePlacement(this.lastPick, this.mode);
  }

  onPlacementModeChange(mode) {
    !this.isAnimating && this.updatePlacement(this.lastPick, mode);
  }

  setVisible(vis) {
    this.plane.root.visible = vis;
  }

  /**
   * Dynamic offset applied based off of camera distance to the intersection
   */
  getZFightingOffset(pick, max = 1) {
    const distance = this.cameraPlane.projectPoint(pick.intersectPoint.clone()).distanceTo(pick.intersectPoint);
    return Math.min(max, PlacementPlane.BASE_Z_FIGHTING_OFFSET * distance * (this.camera.fov * Math.PI / 180));
  }

  dispose() {
    this.#placementBox?.dispose();
    this.viewer.impl.removeOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.SMART_SECTION_OVERLAY_KEY, this.plane.root);
  }

  setTrueNorthRotation(rotation) {
    if (rotation.equals(this.#trueNorthRotation)) {
      // don't trigger an update when nothing has changed
      return;
    }
    this.#trueNorthRotation.copy(rotation);
    this.plane.setTrueNorthRotation(rotation);
    this.updatePlacement(this.lastPick, this.mode, null);
  }

  static BASE_Z_FIGHTING_OFFSET = 0.001;
}


class PlacementBox {

  type = 'box';
  fragObbCache = new Map();

  #trueNorthRotation = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();

  get isAnimating() {
    return false;
  }

  get mesh() {
    return this.box;
  }

  _cameraPlane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane();
  get cameraPlane() {
    this._cameraPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(), this.camera.position);
    return this._cameraPlane;
  }

  get camera() {
    return this.viewer.getCamera();
  }

  /**
   * Visualization for interactively placing a section box
   * @param viewer
   */
  constructor(viewer) {
    this.viewer = viewer;

    // todo delegate initialization to placement indicator
    this.box = new three__WEBPACK_IMPORTED_MODULE_0__.Object3D();
    this.box.applyMatrix(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeScale(1.618, 1.618, 1));
    // prevent initial rendering at the world center
    this.box.visible = false;

    // custom face material with depth test etc for placement
    const faceMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
      opacity: 0.25,
      color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(0, 0.2, 1),
      side: three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide,
      depthTest: true,
      depthWrite: false, // Letting placement highlight to write to depth buffer causes flickering
      transparent: true
    });

    const box = _SectionBox_js__WEBPACK_IMPORTED_MODULE_4__.SectionBox.createMesh(this.box, {
      faceMaterial
    });

    box.children.forEach((it) => {
      it.setHighlightEnabled(true);
      it.gizmo.visible = false;
    });

    this.lastPosition = this.box.position.clone();

    this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.SMART_SECTION_OVERLAY_KEY, this.box);
  }


  place(pick) {
    if (this.updatePlacement(pick, this.mode, null, true)) {
      this.box.scale.sub(PlacementBox.BBOX_Z_FIGHTING_SCALER);
      this.box.updateMatrixWorld();
      const sectionBox = new _SectionBox_js__WEBPACK_IMPORTED_MODULE_4__.SectionBox(this.viewer, { transform: this.box.matrixWorld });
      return Promise.resolve(sectionBox);
    }
    return Promise.resolve();
  }

  pausePlacement() {
    if (this.isPaused()) {
      return;
    }

    this.setVisible(false);
    this.lastPosition = null;
    this.lastPick = null;
    this._placementPaused = true;
    this.viewer.impl.invalidate(false, false, true);
  }

  /**
   * Resume the placement process
   * Will do nothing if the placement is not paused
   */
  resumePlacement() {
    this.setVisible(true);

    if (!this.isPaused()) {
      return;
    }

    this.lastPosition = this.box.position.clone();

    this._placementPaused = false;
    this.viewer.impl.invalidate(false, false, true);
  }

  isPaused() {
    return this._placementPaused;
  }

  updatePlacement(pick, mode, vpVec, placing = false) {
    this.mode = mode ?? this.mode;

    // happens if camera moves before the mouse intersects the geometry
    if (!pick) {

      const mousePosition = !vpVec ? this.lastPosition : getMousePosition(vpVec, this.camera, this.viewer, this.lastPosition);
      if (!mousePosition) {
        this.pausePlacement();
        return;
      }

      const distance = this.camera.position.distanceTo(mousePosition);

      const scaling = this.camera.isPerspective ?
      distance * (1 / PlacementBox.SCREEN_SPACE_Z_SCALING) * (this.camera.fov * Math.PI / 180) :
      (this.camera.top - this.camera.bottom) / this.camera.zoom / PlacementBox.SCREEN_SPACE_Z_SCALING;

      this.box.scale.copy(PlacementBox.BASE_DIMENSIONS).multiplyScalar(scaling);

      this.box.setRotationFromQuaternion(this.#trueNorthRotation);

      this.box.position.copy(mousePosition);
      this.box.children.forEach((it) => {it.setHighlightEnabled(false);});

      this.lastPick = null;
      this.lastPosition = mousePosition;

      this.viewer.impl.invalidate(false, false, true);
      // "mousePosition" is projected to the ground plane and might be outside the view frustum
      // calling invalidate doesn't suffice since near/far are already determined before this update so we need to call updateCameraMatrices
      this.viewer.impl.updateCameraMatrices();

      return false;

    }
    this.box.children.forEach((it) => {it.setHighlightEnabled(true);});

    this.lastPick = pick;

    // for alt placement mode....
    if (this.mode === _SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.PlacementStrategy.BOX_TO_BOUNDING_BOX) {
      if (this.updatePlacementByObb(pick)) {
        this.viewer.impl.invalidate(false, false, true);
        return true;
      } else if (placing) {
        console.warn('Sectioning: failed to calculate the section box. Is the model still loading?');
        return false;
      }
      // fall through to free placement
    }

    const distance = this.cameraPlane.projectPoint(pick.intersectPoint.clone()).distanceTo(pick.intersectPoint);
    const scaling = this.camera.isPerspective ?
    distance * (1 / PlacementBox.SCREEN_SPACE_Z_SCALING) * (this.camera.fov * Math.PI / 180) :
    (this.camera.top - this.camera.bottom) / this.camera.zoom / PlacementBox.SCREEN_SPACE_Z_SCALING;

    this.box.scale.copy(PlacementBox.BASE_DIMENSIONS).multiplyScalar(scaling);

    this.box.setRotationFromQuaternion(this.#trueNorthRotation);

    this.box.position.copy(pick.intersectPoint);

    this.viewer.impl.invalidate(false, false, true);

    return true;
  }


  /**
   * Attempts to generate an OBB from the DbID and all fragments associated with it.
   * Generally this will only work with SVF2 data from what I can tell. SVF1 data
   * normalizes/aligns all fragment rotations. In that case this will just generate an AABB
   * @param pick
   * @returns {boolean} true if OBB is successfully calculated and box is updated, false otherwise
   */
  updatePlacementByObb(pick) {
    const { model, dbId } = pick;

    const cacheKey = pick.model && `${model.getSeedUrn()}|${dbId}`;
    const cachedTransform = this.fragObbCache.get(cacheKey);
    // Currently, `aggregateSelection` is always a one-time action triggered from the context menu.
    // It always ends the placement and thus all cache gets garbage-collected anyway.
    if (cachedTransform && !(pick?.aggregateSelection?.length > 1)) {
      // matrix auto update on...
      this.box.position.copy(cachedTransform.position);
      this.box.setRotationFromQuaternion(cachedTransform.rotation);
      this.box.scale.copy(cachedTransform.scale);

      return true;
    }

    const worldVertices = [];
    const centroid = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
    const rotations = [new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion()];
    const aggregateSelection = pick.aggregateSelection || [{ model: pick.model, selection: [pick.dbId] }];
    for (const { model, selection } of aggregateSelection) {
      if (model.is2d()) {
        console.warn('Section Box not supported for 2D models');
        continue;
      }

      const fragmentList = model.getFragmentList();
      if (!fragmentList) {
        // if fragmentList is not yet loaded, we can't get aligned OBB for Section Box
        continue;
      }

      const transform = model.getModelToViewerTransform();
      if (transform) {
        transform.decompose(TMP_VEC3, TMP_QUAT, TMP_VEC3);
        if (!rotations.find((r) => quatEquals(r, TMP_QUAT))) {
          rotations.push(TMP_QUAT.clone());
        }
      }

      for (const dbId of selection) {
        let vertexCount = 0;
        let fragCount = 0;
        VertexEnumerator.enumObjectGeometries(model, dbId, (geometry, fragWorldMatrix, fragId) => {
          fragCount++;
          vertexCount += VertexEnumerator.getVertexCount(fragmentList.getGeometry(fragId));
        });
        if (vertexCount === 0) {
          continue;
        }
        if (vertexCount > MAX_SUPPORTED_VERTICES) {
          // fallback to the fragment's AABB
          VertexEnumerator.enumObjectGeometries(model, dbId, (geometry, fragWorldMatrix, fragId) => {
            fragmentList.getWorldBounds(fragId, TMP_BOX3);
            const vertices = (0,_OBBUtils_js__WEBPACK_IMPORTED_MODULE_5__.boxToVertices)(TMP_BOX3);
            for (let i = 0; i < vertices.length; i++) {
              worldVertices.push(vertices[i]);
              centroid.add(vertices[i]);
            }
          });
          continue;
        }

        VertexEnumerator.enumObjectGeometries(model, dbId, (geometry, fragWorldMatrix, fragId) => {
          fragWorldMatrix.decompose(TMP_VEC3, TMP_QUAT, TMP_VEC3);
          if (!rotations.find((r) => quatEquals(r, TMP_QUAT))) {
            rotations.push(TMP_QUAT.clone());
          }
          VertexEnumerator.enumMeshVertices(geometry, (vertex) => {
            worldVertices.push(vertex.clone());
            centroid.add(vertex);
          }, fragWorldMatrix);
        });
      }
    }
    if (!worldVertices.length) {
      return false;
    }
    centroid.divideScalar(worldVertices.length);

    if (worldVertices.length * rotations.length > MAX_SUPPORTED_VERTICES) {
      const cut = Math.ceil(MAX_SUPPORTED_VERTICES / worldVertices.length);
      rotations.splice(cut);
    }

    const { rotation, scale, localCenter } = (0,_OBBUtils_js__WEBPACK_IMPORTED_MODULE_5__.findMinVolumeRotation)(worldVertices, centroid, rotations);

    scale.add(PlacementBox.BBOX_Z_FIGHTING_SCALER);

    const worldCenter = localCenter.applyQuaternion(rotation).add(centroid);

    // update the box
    this.box.position.copy(worldCenter);
    this.box.setRotationFromQuaternion(rotation);
    this.box.scale.copy(scale);

    if (aggregateSelection.length === 1) {
      this.fragObbCache.set(cacheKey, { position: worldCenter, rotation, scale });
    }
    return true;
  }


  onCameraChanged() {
    this.updatePlacement(this.lastPick, this.mode);
  }

  onPlacementModeChange(mode) {
    this.updatePlacement(this.lastPick, mode);
  }

  setVisible(vis) {
    this.box.visible = vis;
  }

  dispose() {
    this.viewer.impl.removeOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.SMART_SECTION_OVERLAY_KEY, this.box);
  }

  update() {
  }

  setTrueNorthRotation(rotation) {
    if (rotation.equals(this.#trueNorthRotation)) {
      // don't trigger an update when nothing has changed
      return;
    }
    this.#trueNorthRotation.copy(rotation);
    this.updatePlacement(this.lastPick, this.mode, null);
  }

  static BASE_DIMENSIONS = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1.618, 1.618, 1);
  static SCREEN_SPACE_Z_SCALING = 6;

  static BBOX_Z_FIGHTING_SCALER = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.3, 0.3, 0.3);

}

const TMP_PLANE = new THREE.Plane();
const TMP_RAY = new THREE.Ray();
function getMousePosition(vpVec, camera, viewer, lastPosition) {
  TMP_VEC3.copy(vpVec);
  if (!camera.isPerspective) {
    return viewer.impl.intersectGroundViewport(TMP_VEC3);
  }
  const ray = camera.viewportToRay(TMP_VEC3, TMP_RAY);

  const normal = ray.direction.clone().normalize();
  TMP_PLANE.set(normal, -lastPosition.dot(normal));
  return ray.intersectPlane(TMP_PLANE) || lastPosition;
}

const TMP_MAT4 = new THREE.Matrix4();
const TMP_MAT3 = new THREE.Matrix3();
const TMP_QUAT = new THREE.Quaternion();
const IDENTITY4 = new THREE.Matrix4();
const TMP_BOX3 = new THREE.Box3();
const TMP_VEC3 = new THREE.Vector3();

function quatEquals(a, b, delta = 1E-3) {
  return Math.abs(a.dot(b)) > 1 - delta;
}

/***/ },

/***/ "./extensions/SmartSection/RayCasterUtils.js"
/*!***************************************************!*\
  !*** ./extensions/SmartSection/RayCasterUtils.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   updateRayCasterFromNdc: () => (/* binding */ updateRayCasterFromNdc)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);


function updateRayCasterFromNdc(camera, raycaster, ndcX, ndcY) {
  const pointerVector = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
  const pointerDir = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();

  if (camera.isPerspective) {
    pointerVector.copy(camera.position);
    pointerDir.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    raycaster.set(pointerVector, pointerDir);
  } else {
    pointerVector.set(ndcX, ndcY, -1);
    pointerVector.unproject(camera);
    pointerDir.set(0, 0, -1);
    raycaster.set(pointerVector, pointerDir.transformDirection(camera.matrixWorld));
  }

  return raycaster;
}

/***/ },

/***/ "./extensions/SmartSection/SectionBox.js"
/*!***********************************************!*\
  !*** ./extensions/SmartSection/SectionBox.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BOX_STATE_CHANGED_EVENT: () => (/* reexport safe */ _SmartSectionConstants_js__WEBPACK_IMPORTED_MODULE_5__.BOX_STATE_CHANGED_EVENT),
/* harmony export */   SectionBox: () => (/* binding */ SectionBox),
/* harmony export */   updateRayCasterFromNdc: () => (/* reexport safe */ _RayCasterUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateRayCasterFromNdc)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _OneDGizmo_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./OneDGizmo.js */ "./extensions/SmartSection/OneDGizmo.js");
/* harmony import */ var _RayCasterUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./RayCasterUtils.js */ "./extensions/SmartSection/RayCasterUtils.js");
/* harmony import */ var _SmartSection_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./SmartSection.js */ "./extensions/SmartSection/SmartSection.js");
/* harmony import */ var _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./SmartSectionAnalytics.js */ "./extensions/SmartSection/SmartSectionAnalytics.js");
/* harmony import */ var _SmartSectionConstants_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./SmartSectionConstants.js */ "./extensions/SmartSection/SmartSectionConstants.js");





// Re-exported for backwards compatibility; implementation lives in RayCasterUtils to avoid
// a SectionBox <-> OneDGizmo import cycle.





const av = Autodesk.Viewing;


const MIN_NORMAL_LEN = 1e-8;

/**
 * Reads a plane given as Vector4, {x,y,z,w} or [x,y,z,w] and converts it to the same
 * representation as THREE.Plane: for a point x on the plane, `normal · x + constant = 0`,
 * with a unit-length normal.
 *
 * @param {Vector4|{x:number,y:number,z:number,w:number}|number[]} p
 * @returns {{normal: Vector3, constant: number}|null} null if the plane is malformed
 */
function toNormalizedPlane(p) {
  const nx = p.x ?? (Array.isArray(p) ? p[0] : undefined);
  const ny = p.y ?? (Array.isArray(p) ? p[1] : undefined);
  const nz = p.z ?? (Array.isArray(p) ? p[2] : undefined);
  const nw = p.w ?? (Array.isArray(p) ? p[3] : undefined);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz) || !Number.isFinite(nw)) {
    return null;
  }

  const normal = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(nx, ny, nz);
  const len = normal.length();
  if (len < MIN_NORMAL_LEN) {
    return null;
  }

  return { normal: normal.divideScalar(len), constant: nw / len };
}


/**
 * Section box implements `Autodesk.Viewing.ToolInterface` and handles its own events for gizmos, etc.
 * While the box is active. Call `SectionBox#dispose` to pop the tool from the toolstack
 */
class SectionBox extends av.ToolInterface {

  // use order +X, +Y, +Z, -X, -Y, -Z - aligned with LMV SceneMath normals
  static NORMALS = [
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 0, 0),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 1, 0),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 1),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-1, 0, 0),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, -1, 0),
  new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, -1)];


  /**
   * Validates whether the provided six planes describe a proper oriented bounding box (OBB).
   * The order of planes is not verified (see normalizeOrder)
   *
   * @param {(Vector4|{x:number,y:number,z:number,w:number}|number[])[]} planes
   * @returns {boolean}
   */
  static formsValidBox(planes = []) {
    if (!Array.isArray(planes) || planes.length !== 6) {
      return false;
    }

    const EPS_GROUPING = 1e-3;
    const EPS_SIZE = 1e-6;
    const EPS_DOT = 5e-3;

    // Dot-product helpers for unit vectors.
    const almostParallel = (a, b, eps) => 1 - Math.abs(a.dot(b)) < eps;
    const almostOpposite = (a, b, eps) => 1 + a.dot(b) < eps; // a·b ≈ -1
    const almostOrthogonal = (a, b, eps) => Math.abs(a.dot(b)) < eps;

    // Step 1: normalize all planes (unit normal, scaled constant).
    const normalizedPlanes = planes.map(toNormalizedPlane);
    if (normalizedPlanes.some((plane) => plane === null)) {
      return false;
    }

    // Step 2: group planes by axis, treating n and -n as the same axis.
    // Result should be 3 axes, each with 2 planes.
    const axes = [];
    for (const plane of normalizedPlanes) {
      const axis = axes.find((a) => almostParallel(a.axisDir, plane.normal, EPS_GROUPING));
      if (axis) {
        axis.planes.push(plane);
      } else {
        axes.push({ axisDir: plane.normal.clone(), planes: [plane] });
      }
    }

    if (axes.length !== 3) {
      return false;
    }

    // Step 3: each axis must have exactly 2 opposite-facing planes.
    for (const axis of axes) {
      if (axis.planes.length !== 2) {
        return false;
      }
      const [a, b] = axis.planes;
      if (!almostOpposite(a.normal, b.normal, EPS_DOT)) {
        return false;
      }
    }

    // Step 4: the 3 axes must be mutually orthogonal.
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        if (!almostOrthogonal(axes[i].axisDir, axes[j].axisDir, EPS_DOT)) {
          return false;
        }
      }
    }

    // Step 5: extents along each axis must be non-degenerate.
    // For opposite planes (n, c1) and (-n, c2), the separation along n is |c1 + c2|.
    for (const axis of axes) {
      const [p1, p2] = axis.planes;
      const extent = Math.abs(p1.constant + p2.constant);
      if (extent <= EPS_SIZE) {
        return false;
      }
    }

    return true;
  }

  /**
   * Reorders six box planes into the order expected by {@link SectionBox.fromPlanes},
   * i.e. [+X, +Y, +Z, -X, -Y, -Z] with respect to the box's own (possibly rotated) axes:
   * the first three entries are pairwise orthogonal and form a right-handed basis, and
   * entry `i + 3` is the plane opposite to entry `i`.
   *
   * Each box axis is matched to the world axis it is most closely aligned with, so an
   * axis-aligned set of planes ends up in world [+X, +Y, +Z, -X, -Y, -Z] order.
   *
   * The returned array holds the original plane objects - only their order changes.
   *
   * @param {(Vector4|{x:number,y:number,z:number,w:number}|number[])[]} planes - Six planes of a box, in any order.
   * @returns {(Vector4|{x:number,y:number,z:number,w:number}|number[])[]} The reordered planes.
   */
  static normalizeOrder(planes = []) {
    const EPS_GROUPING = 1e-3;

    const normalizedPlanes = planes.map((p) => toNormalizedPlane(p));

    if (normalizedPlanes.some((p) => p === null)) throw new Error('Zero-length normal in plane');

    // Group the planes into the three pairs of opposite faces, treating n and -n as the same
    // axis. formsValidBox already guarantees that this yields exactly 3 pairs.
    const pairs = [];
    for (let i = 0; i < normalizedPlanes.length; i++) {
      const { normal } = normalizedPlanes[i];
      const pair = pairs.find((p) => 1 - Math.abs(p.axisDir.dot(normal)) < EPS_GROUPING);
      if (pair) {
        pair.indices.push(i);
      } else {
        pairs.push({ axisDir: normal.clone(), indices: [i] });
      }
    }

    if (pairs.length !== 3 || pairs.some((p) => p.indices.length !== 2)) {
      throw new Error('Planes do not form a box; validate with SectionBox.formsValidBox() first');
    }

    // Assign the pairs to the world axes, strongest alignment first, and point each box axis
    // along its world axis. Flipping an axis only swaps which of its two planes is the
    // positive one, the box itself stays the same.
    const axes = [];
    for (const worldAxis of SectionBox.NORMALS.slice(0, 3)) {
      let best = 0;
      for (let i = 1; i < pairs.length; i++) {
        if (Math.abs(pairs[i].axisDir.dot(worldAxis)) > Math.abs(pairs[best].axisDir.dot(worldAxis))) {
          best = i;
        }
      }
      const [pair] = pairs.splice(best, 1);
      const dir = pair.axisDir.dot(worldAxis) < 0 ? pair.axisDir.negate() : pair.axisDir;
      axes.push({ dir, indices: pair.indices });
    }

    // Keep the basis right-handed: fromPlanes derives the box's Z axis from X × Y, which would
    // otherwise contradict the plane picked as +Z.
    if (new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().crossVectors(axes[0].dir, axes[1].dir).dot(axes[2].dir) < 0) {
      axes[2].dir.negate();
    }

    // The positive face of an axis is the plane whose normal points along it.
    const positive = axes.map(({ dir, indices }) => indices.find((i) => normalizedPlanes[i].normal.dot(dir) > 0));
    const negative = axes.map(({ indices }, i) => indices.find((i2) => i2 !== positive[i]));

    return [...positive, ...negative].map((i) => planes[i]);
  }

  /**
   * Creates a SectionBox from six clipping planes describing a rectangular box (possibly rotated).
   *
   * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance used to create/place the box.
   * @param {(Vector4|{x:number,y:number,z:number,w:number}|number[])[]} planes - Six planes in order [+X, +Y, +Z, -X, -Y, -Z].
   * @returns {SectionBox} Newly constructed section box matching the given planes.
   */
  static fromPlanes(viewer, planes = []) {
    if (planes.length !== 6) {
      throw new Error("fromPlanes expects 6 planes");
    }

    // Normalize planes and store as objects
    const normPlanes = planes.map((p) => toNormalizedPlane(p));

    if (normPlanes.some((p) => p === null)) throw new Error('Zero-length normal in plane');

    // Reorder planes to match a box origin
    const normalsOrder = [
    [3, 0], // -X, +X
    [4, 1], // -Y, +Y
    [5, 2] // -Z, +Z
    ];

    // For each axis, get the two planes and their normals/constants
    // We'll use +X, +Y, +Z as axes and the -X, -Y, -Z planes to determine size
    const planePairs = normalsOrder.map(([neg, pos]) => [normPlanes[neg], normPlanes[pos]]);

    const sizes = [];
    const centers = [];

    // For each axis, use the + side normal, and ensure the constant for the - side is negated
    for (let i = 0; i < 3; i++) {
      const [neg, pos] = planePairs[i];

      // For the + side, use -constant; for the - side, use constant
      const dNeg = neg.constant;
      const dPos = -pos.constant;

      // Center along this axis
      const center = pos.normal.clone().multiplyScalar((dNeg + dPos) / 2);
      centers.push(center);

      // Size along this axis
      const size = Math.abs(dPos - dNeg);
      sizes.push(size);
    }

    // The box center is at the intersection of the three median planes
    // (since axes are orthogonal, just sum)
    const center = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().add(centers[0]).add(centers[1]).add(centers[2]);

    // Both normals should be (anti)parallel, use the + side
    let [xAxis, yAxis, zAxis] = planePairs.map(([, pos]) => pos.normal);
    // Build rotation matrix, orthonormalize to ensure right-handed system
    zAxis = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().crossVectors(xAxis, yAxis).normalize();
    yAxis = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().crossVectors(zAxis, xAxis).normalize();

    const rotMat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const scaleMat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeScale(sizes[0], sizes[1], sizes[2]);
    const transMat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeTranslation(center.x, center.y, center.z);

    // Compose transform: scale -> rotate -> translate (SRT)
    const transform = transMat.multiply(rotMat).multiply(scaleMat);

    const sectionBox = new SectionBox(viewer, { transform });
    return sectionBox;
  }

  /**
   * Creates a SectionBox from an axis-aligned bounding box (AABB) defined by min/max
   * and a rotation that turns this AABB into the final oriented bounding box (OBB).
   *
   * The resulting transform is composed as: translate(center) * rotate(rotation) * scale(size)
   *
   * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance used to create/place the box.
   * @param {Vector3|number[]} min - Minimum corner of the AABB (world space).
   * @param {Vector3|number[]} max - Maximum corner of the AABB (world space).
   * @param {Quaternion|number[]} rotation - Rotation to apply to the AABB to obtain the OBB.
   *                                         If array, interpreted as [x, y, z, w].
   * @param {{faceMaterial?:Autodesk.Viewing.Scene.UnlitMaterial, lineColor?:Color}} [options] - Mesh/visual options.
   * @returns {SectionBox} Newly constructed section box matching the provided AABB and rotation.
   */
  static fromMinMaxRotation(viewer, min, max, rotation, options = {}) {
    const minVec = Array.isArray(min) ? new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(min[0], min[1], min[2]) : min.clone();
    const maxVec = Array.isArray(max) ? new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(max[0], max[1], max[2]) : max.clone();

    const size = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().subVectors(maxVec, minVec);
    const center = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().addVectors(minVec, maxVec).multiplyScalar(0.5);

    const quat = Array.isArray(rotation) ?
    new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]) :
    rotation.clone();

    const rotMat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationFromQuaternion(quat);
    const scaleMat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeScale(size.x, size.y, size.z);
    const transMat = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeTranslation(center.x, center.y, center.z);

    const transform = transMat.multiply(rotMat).multiply(scaleMat);
    return new SectionBox(viewer, { ...options, transform });
  }

  _inverted = false;

  set inverted(val) {
    val = Boolean(val);
    if (val === this._inverted) return;
    this._inverted = val;
    this.onBoxChanged();
  }
  get inverted() {
    return this._inverted;
  }

  object = new three__WEBPACK_IMPORTED_MODULE_0__.Object3D();
  raycaster = new three__WEBPACK_IMPORTED_MODULE_0__.Raycaster();
  planes = [];
  translateGizmo;
  rotateGizmo;
  controlledObject = new three__WEBPACK_IMPORTED_MODULE_0__.Object3D();

  events = new three__WEBPACK_IMPORTED_MODULE_0__.EventDispatcher();
  analyticsAdjustType = null;

  lastHoveredBoxFace = null;
  isBoxGizmoHovered = false;
  lastTranslateGizmoAxis = null;

  set visible(value) {
    this.object.visible = Boolean(value);
    if (!value) {// only hide when false because gizmos set to visible with mouse
      this.object.children.forEach((side) => side.setHighlightEnabled(false));
    }
  }

  get width() {
    return this.object.scale.x;
  }
  set width(value) {
    this.object.scale.setX(Number(value));
    this.onBoxChanged();
  }
  get height() {
    return this.object.scale.z;
  }
  set height(value) {
    this.object.scale.setZ(Number(value));
    this.onBoxChanged();
  }
  get depth() {
    return this.object.scale.y;
  }
  set depth(value) {
    this.object.scale.setY(Number(value));
    this.onBoxChanged();
  }

  set gizmoColor(color) {
    this.object.children.forEach((face) => {
      face.gizmo.material.color.copy(color);
    });
  }
  set wireframeColor(color) {
    this.object.children.forEach((face) => {
      face.outline.material.color.copy(color);
    });
  }
  set faceColor(color) {
    this.object.children.forEach((face) => {
      face.highlightMesh.material.color.copy(color);
    });
  }

  constructor(viewer, options = {}) {
    const transform = options.transform || new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeScale(100, 100, 75);
    super(viewer, options);

    this.object.applyMatrix(transform);
    SectionBox.createMesh(this.object, options);
    this.object.updateMatrixWorld();

    this.names = [];
    this.viewer = viewer;

    // make sure the controlled object and box are in sync
    this.controlledObject.position.copy(this.object.localToWorld(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0.5)));
    this.controlledObject.setRotationFromQuaternion(this.object.getWorldQuaternion());

    this.handleMouseMove = (e) => this.onMouseMoved(e);
    this.handleButtonDown = (e) => this.onMouseDown(e);
    this.handleButtonUp = (e) => this.onMouseUp(e);
    this.handleSingleClick = (event, button) => {
      return Boolean(
        this.object.children.map((it) => it.gizmo).find((it) => it.isHighlighted()) ||
        this.rotateGizmo?.axis || this.translateGizmo?.axis
      );
    };
    this.getPriority = this._getPriority.bind(this);

    // this.initializeSectionBoxTool();
  }

  /**
   * Initializes gizmos, overlays, and registers/activates the tool to make this SectionBox interactive.
   */
  initializeSectionBoxTool() {
    this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.SMART_SECTION_OVERLAY_KEY, this.object);

    // Attach face gizmos and hitboxes to overlay and configure
    this.object.children.forEach((face) => {
      this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.SMART_SECTION_OVERLAY_KEY, face.gizmo);
      this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.SMART_SECTION_OVERLAY_KEY, face.hitbox);
      face.gizmo.attach(face);
      face.gizmo.onCameraChanged(this.viewer.getCamera(), this.viewer.canvas);
    });

    // Translation gizmo
    this.translateGizmo = new av.Private.TransformControls(this.viewer.getCamera(), this.viewer.canvas, 'translate');
    this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.SMART_SECTION_OVERLAY_KEY, this.translateGizmo);
    this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.SMART_SECTION_OVERLAY_KEY, this.controlledObject);
    this.translateGizmo.attach(this.controlledObject);
    this.updateTranslateGizmo();
    this.translateGizmo.addEventListener('objectChange', (event) => this.onTranslateGizmoChanged());

    // Rotation gizmo
    this.rotateGizmo = new Autodesk.Viewing.Private.SectionTransformControls(
      this.viewer.getCamera(), this.viewer.canvas, { isPlane: false });
    this.rotateGizmo.mode = 'rotate';
    this.rotateGizmo.space = 'local';
    this.viewer.impl.addOverlay(_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.SMART_SECTION_OVERLAY_KEY, this.rotateGizmo);
    this.rotateGizmo.attach(this.object);
    this.setRotateEnabled(false);
    this.rotateGizmo.addEventListener('objectChange', (e) => this.onRotateGizmoChanged());

    // Register and activate tool
    this.names = ['SectionBoxTool'];
    this.viewer.toolController.registerTool(this);
    const prev = this.viewer.toolController.setIsLocked(false); // todo why is orbitdollypan locking when placing?
    this.viewer.toolController.activateTool('SectionBoxTool');
    this.viewer.toolController.setIsLocked(prev);
  }

  get mesh() {
    return this.object;
  }

  _getPriority() {
    return 90;
  }

  setGizmoEnabled(enabled) {
    if (!this.translateGizmo || !this.rotateGizmo) return;
    this.rotateGizmo.visible = this.mode === 'rotate' && enabled;
    this.rotateGizmo.enabled = this.mode === 'rotate' && enabled;
    this.translateGizmo.visible = this.mode === 'translate' && enabled;
    this.translateGizmo.enabled = this.mode === 'translate' && enabled;
  }

  setRotateEnabled(enabled) {
    const mode = this.mode = enabled ? 'rotate' : 'translate';

    if (!this.rotateGizmo || !this.translateGizmo) {
      return;
    }

    const visible = this.rotateGizmo.visible || this.translateGizmo.visible;

    this.rotateGizmo.visible = mode === 'rotate' && visible;
    this.rotateGizmo.enabled = mode === 'rotate' && visible;
    this.translateGizmo.visible = mode === 'translate' && visible;
    this.translateGizmo.enabled = mode === 'translate' && visible;

    this.viewer.impl.invalidate(false, false, true);
  }

  onMouseDown(event) {

    if (event.button !== 0) {
      return;
    }

    this.activeGizmo = this.object.children.find((it) => it.gizmo.isHighlighted())?.gizmo;

    if (this.activeGizmo) {
      this.activeGizmo.onDragStart(event, this.viewer.getCamera());
      this.analyticsAdjustType = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.ADJUSTMENT_TYPES.PUSH_PULL;
      return true;
    }

    return this.translateGizmo.enabled ?
    this.translateGizmo.onPointerDown(event) :
    this.rotateGizmo.pointerDown(event);
  }

  onMouseUp(event) {

    const gizmo = this.activeGizmo;
    this.activeGizmo = null;
    const pointerUp = this.translateGizmo.onPointerUp(event) || this.rotateGizmo.pointerUp(event);

    if (this.analyticsAdjustType) {
      (0,_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.trackBoxAdjusted)(this.viewer, this.analyticsAdjustType);
      this.analyticsAdjustType = null;
    }

    return Boolean(gizmo || pointerUp);
  }

  onMouseMoved(event) {
    let overlayChanged = false;

    if (this.activeGizmo) {
      this.activeGizmo.handleMove(event, this.viewer.getCamera(), this.raycaster, this.object);
      this.object.children.forEach((it) => it.gizmo.attach(it)); // update all sides
      this.object.updateMatrixWorld();
      this.updateTranslateGizmo();
      this.events.dispatchEvent(_SmartSectionConstants_js__WEBPACK_IMPORTED_MODULE_5__.BOX_STATE_CHANGED_EVENT);
      return true;
    }

    // Handle translate/rotate gizmo
    const moved = this.translateGizmo.enabled ?
    this.translateGizmo.onPointerMove(event) :
    this.rotateGizmo.pointerMove(event);
    this.translateGizmo.enabled ?
    this.translateGizmo.onPointerHover(event) :
    this.rotateGizmo.pointerHover(event);

    // Track axis change to detect actual hover state change
    const currentAxis = this.translateGizmo.enabled ? this.translateGizmo.axis : this.rotateGizmo.axis;
    const axisChanged = currentAxis !== this.lastTranslateGizmoAxis;
    this.lastTranslateGizmoAxis = currentAxis;

    if (moved || axisChanged) {
      this.translateGizmo.update(true);
      this.viewer.impl.invalidate(false, false, true);
      return moved;
    }

    if (!this.object.visible) return;

    (0,_RayCasterUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateRayCasterFromNdc)(this.viewer.getCamera(), this.raycaster, event.normalizedX, event.normalizedY);

    const faceIntersect = this.object.children.
    map((face) => this.raycaster.intersectObject(face.hitbox)).
    flatMap((it) => it).
    sort((a, b) => a.distance - b.distance)[0];

    if (faceIntersect?.object) {
      const boxFace = this.object.children.find((it) => it.hitbox === faceIntersect.object);

      let gizmoIntersect = [];
      this.raycaster.intersectObject(boxFace.gizmo);
      boxFace.gizmo.traverse((it) => {
        if (it.type !== 'Mesh') return;
        gizmoIntersect = gizmoIntersect.concat(this.raycaster.intersectObject(it));
      });

      // Track box face hover change
      if (this.lastHoveredBoxFace !== boxFace) {
        this.lastHoveredBoxFace?.setHighlightEnabled(false);
        this.lastHoveredBoxFace?.gizmo.setHighlight(false);
        boxFace?.setHighlightEnabled(true);
        this.lastHoveredBoxFace = boxFace;
        overlayChanged = true;
      }

      // Track OneDGizmo hover change
      const isGizmoHovered = gizmoIntersect.length > 0;
      if (this.isBoxGizmoHovered !== isGizmoHovered) {
        this.isBoxGizmoHovered = isGizmoHovered;
        boxFace?.gizmo.setHighlight(isGizmoHovered);
        this.isBoxGizmoHovered = isGizmoHovered;
        overlayChanged = true;
      }
    } else {
      if (this.lastHoveredBoxFace !== null || this.isBoxGizmoHovered !== false) {
        this.lastHoveredBoxFace?.setHighlightEnabled(false);
        this.lastHoveredBoxFace?.gizmo.setHighlight(false);
        this.lastHoveredBoxFace = null;
        this.isBoxGizmoHovered = false;
        overlayChanged = true;
      }
    }

    if (overlayChanged) {
      this.viewer.impl.invalidate(false, false, true);
    }
  }

  highlightFace(boxFace) {
    if (!boxFace) return;
    boxFace.setHighlightEnabled(true);
    this.viewer.impl.invalidate(false, false, true);
  }

  toHessianPlanes() {
    this.object.updateMatrixWorld();

    return SectionBox.NORMALS.
    map((normal) =>
    new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setFromNormalAndCoplanarPoint(
      this.object.localToWorld(normal.clone()).clone().sub(this.object.getWorldPosition()).normalize(),
      this.object.localToWorld(normal.clone().multiplyScalar(0.5)))).
    map((plane) => new three__WEBPACK_IMPORTED_MODULE_0__.Vector4(...plane.normal.toArray(), plane.constant));
  }

  /**
   * Computes the axis-aligned bounding box (AABB) of the section box in world space
   * and returns its minimum corner.
   *
   * @returns {Vector3} Minimum corner of the world-space AABB
   */
  min() {
    this.object.updateMatrixWorld(true);

    const corners = [
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5, 0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5, 0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5, 0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0.5)];


    const min = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(Infinity, Infinity, Infinity);

    for (const local of corners) {
      const world = this.object.localToWorld(local.clone());
      min.min(world);
    }

    return min;
  }

  /**
   * Computes the axis-aligned bounding box (AABB) of the section box in world space
   * and returns its maximum corner.
   *
   * @returns {Vector3} Maximum corner of the world-space AABB
   */
  max() {
    this.object.updateMatrixWorld(true);

    const corners = [
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, -0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5, 0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5, 0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5, 0.5),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0.5)];


    const max = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-Infinity, -Infinity, -Infinity);

    for (const local of corners) {
      const world = this.object.localToWorld(local.clone());
      max.max(world);
    }

    return max;
  }

  /**
   * Returns the world-space rotation of the section box as a quaternion.
   * This rotation can be applied to the AABB defined by {@link min} and {@link max}
   * to obtain the oriented bounding box (OBB).
   *
   * @returns {Quaternion} World rotation quaternion
   */
  rotation() {
    this.object.updateMatrixWorld(true);
    return this.object.getWorldQuaternion().clone();
  }

  /**
   * Serializes this SectionBox into ViewerState 2.0 object.
   *
   * Fields:
   * - rotation: [x, y, z] Euler angles in radians (three.js default order, 'XYZ')
   * - scale: [sx, sy, sz] world-space box dimensions
   * - position: [x, y, z] world-space position of the box origin
   * - inverted: boolean indicating whether the box is inverted
   *
   * @returns {{rotation:number[], scale:number[], position:number[], inverted:boolean}} Serialized state
   */
  toViewerStateV2() {
    this.object.updateMatrixWorld();

    const rotation = this.object.getWorldRotation().toArray();
    const scale = this.object.getWorldScale().toArray();
    const position = this.object.getWorldPosition().toArray();

    return { rotation, scale, position, inverted: this.inverted };
  }

  /**
   * Reconstructs a SectionBox instance from a serialized ViewerState 2.0 object.
   *
   * State fields:
   * - rotation: [x, y, z] Euler angles in radians (three.js default order, 'XYZ')
   * - scale: [sx, sy, sz] world-space box dimensions
   * - position: [x, y, z] world-space position of the box origin
   * - inverted: boolean indicating whether the box is inverted (optional)
   *
   * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance used to attach and manage the box.
   * @param {{rotation:number[], scale:number[], position:number[], inverted?:boolean}} state - Serialized box state.
   * @returns {SectionBox} A SectionBox matching the provided state.
   */
  static fromViewerStateV2(viewer, state) {
    const { rotation, scale, position, inverted } = state;

    const transform = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();
    transform.makeRotationFromEuler(new three__WEBPACK_IMPORTED_MODULE_0__.Euler(...rotation));
    transform.scale(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(...scale));
    transform.setPosition(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(...position));

    const sectionBox = new SectionBox(viewer, { transform });
    sectionBox.inverted = inverted;
    return sectionBox;
  }

  onCameraChanged(camera) {
    this.object.children.forEach((face) => {
      face.gizmo.onCameraChanged(camera, this.viewer.canvas);
      face.updateHitbox(face.gizmo.scale.z);
    });
    if (this.translateGizmo) {
      this.translateGizmo.update(true);
    }
  }

  onBoxChanged() {
    this.object.updateMatrixWorld();
    this.updateTranslateGizmo();
    this.onTranslateGizmoChanged();
    this.events.dispatchEvent(_SmartSectionConstants_js__WEBPACK_IMPORTED_MODULE_5__.BOX_STATE_CHANGED_EVENT);
  }

  /**
   * Updates the translation gizmo from the box object's state
   */
  updateTranslateGizmo() {
    if (!this.translateGizmo) return;
    const pos = this.object.localToWorld(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0.5));
    this.controlledObject.position.copy(pos);
    this.controlledObject.setRotationFromQuaternion(this.object.getWorldQuaternion());
    this.translateGizmo.update(true);
    this.viewer.impl.invalidate(false, false, true);
  }

  /**
   * Updates the box object from the translation gizmo state
   */
  onTranslateGizmoChanged() {
    if (!this.translateGizmo) return;
    this.object.children.forEach((boxSide) => {
      // infinite recursion when updating this in updateMatrixWorld
      boxSide.gizmo.attach(boxSide);
    });
    const offset = this.object.localToWorld(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0.5)).
    sub(this.object.getWorldPosition());
    this.object.position.copy(this.controlledObject.position.clone().sub(offset));
    this.object.setRotationFromQuaternion(this.controlledObject.getWorldQuaternion());
    this.object.updateMatrixWorld(true);
    this.viewer.impl.invalidate(false, false, true);
    this.events.dispatchEvent(_SmartSectionConstants_js__WEBPACK_IMPORTED_MODULE_5__.BOX_STATE_CHANGED_EVENT);

    this.analyticsAdjustType = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.ADJUSTMENT_TYPES.MOVE;
  }

  onRotateGizmoChanged() {
    if (!this.rotateGizmo) return;
    this.updateTranslateGizmo();
    this.object.children.forEach((side) => side.gizmo.attach(side));
    this.viewer.impl.invalidate(false, false, true);
    this.events.dispatchEvent(_SmartSectionConstants_js__WEBPACK_IMPORTED_MODULE_5__.BOX_STATE_CHANGED_EVENT);

    this.analyticsAdjustType = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.ADJUSTMENT_TYPES.ROTATE;
  }

  dispose() {
    this.rotateGizmo?.detach(this.object);
    this.object.parent?.remove(this.rotateGizmo);
    this.translateGizmo?.detach(this.controlledObject);
    this.object.parent?.remove(this.controlledObject);
    this.object.parent?.remove(this.translateGizmo);
    this.object.parent?.remove(this.object);
    this.object.children.forEach((it) => {
      it.gizmo?.parent?.remove(it.gizmo);
      it.hitbox?.parent?.remove(it.hitbox);
    });
    if (this.names?.includes('SectionBoxTool')) {
      this.viewer.toolController.deactivateTool('SectionBoxTool');
    }
  }

  /**
   * This is a static function so that the placement flow can drag+drop the box without activating a tool and binding events, etc.
   * @param rootGroup Group/Object3D to attach it to. Use the scaling to size the sides of the box
   * @param options Highlight, outline color etc.
   */
  static createMesh(rootGroup, options = {}) {

    const highlightMat = options.faceMaterial || new Autodesk.Viewing.Scene.UnlitMaterial({
      opacity: 0.1,
      color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(0, 0.2, 1),
      side: three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });

    const hitboxMat = new Autodesk.Viewing.Scene.UnlitMaterial({
      opacity: 0,
      color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(0, 1, 0),
      side: three__WEBPACK_IMPORTED_MODULE_0__.FrontSide,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });


    for (let i = 0; i < 6; i++) {

      const lineMaterial = new three__WEBPACK_IMPORTED_MODULE_0__.LineBasicMaterial({
        color: options.lineColor || new three__WEBPACK_IMPORTED_MODULE_0__.Color(1, 0, 0),
        linewidth: 1,
        depthTest: false,
        depthWrite: false,
        transparent: true
      });

      // Emit explicit line segment pairs (AB, BC, CD, DA)
      const geometry = new three__WEBPACK_IMPORTED_MODULE_0__.Geometry();
      geometry.isLines = true; // Needed for WebGPU
      geometry.vertices.push(
        // AB
        new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5), new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5),
        // BC
        new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5), new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5),
        // CD
        new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5), new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5),
        // DA
        new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5), new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5)
      );

      const outline = new three__WEBPACK_IMPORTED_MODULE_0__.Line(geometry, lineMaterial);

      const highlightGeom = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(1, 1);
      // TODO need unique materials per mesh because of front/back-sidedness
      const highlight = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(highlightGeom, highlightMat);

      const hitbox = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(SectionBox.createPyramidGeometry(), hitboxMat);
      const gizmo = new _OneDGizmo_js__WEBPACK_IMPORTED_MODULE_1__.OneDGizmo();
      const group = new BoxSide(outline, highlight, gizmo, hitbox);
      gizmo.attach(group);
      rootGroup.add(group);
    }

    const scaleX = (n) => rootGroup.scale.setX(n);
    const scaleY = (n) => rootGroup.scale.setY(n);
    const scaleZ = (n) => rootGroup.scale.setZ(n);

    const rotations = [
    [new three__WEBPACK_IMPORTED_MODULE_0__.Euler(0, -90 * Math.PI / 180, 0), 3, scaleX, () => rootGroup.scale.x], // -X
    [new three__WEBPACK_IMPORTED_MODULE_0__.Euler(90 * Math.PI / 180, 0, 0), 4, scaleY, () => rootGroup.scale.y], // -Y
    [new three__WEBPACK_IMPORTED_MODULE_0__.Euler(0, 180 * Math.PI / 180, 0), 5, scaleZ, () => rootGroup.scale.z], // -Z
    [new three__WEBPACK_IMPORTED_MODULE_0__.Euler(0, 90 * Math.PI / 180, 0), 0, scaleX, () => rootGroup.scale.x], // +X
    [new three__WEBPACK_IMPORTED_MODULE_0__.Euler(-90 * Math.PI / 180, 0, 0), 1, scaleY, () => rootGroup.scale.y], // +Y
    [new three__WEBPACK_IMPORTED_MODULE_0__.Euler(0, 0, 0), 2, scaleZ, () => rootGroup.scale.z] // +Z
    ];

    rootGroup.children.forEach((group, i) => {
      const [euler, opposite, scalingFn, scalingGetter] = rotations[i];
      group.setRotationFromEuler(euler);
      group.oppositeFace = rootGroup.children[opposite];
      group.setBoxScale = scalingFn;
      group.getBoxScale = scalingGetter;
      group.position.copy(SectionBox.NORMALS[i].clone().multiplyScalar(-0.5));
    });

    return rootGroup;
  }

  static createPyramidGeometry() {
    var geometry = new three__WEBPACK_IMPORTED_MODULE_0__.Geometry();

    geometry.vertices = [
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, -0.5, 0),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-0.5, 0.5, 0),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, 0.5, 0),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0.5, -0.5, 0),
    new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 1)];


    geometry.faces = [
    new three__WEBPACK_IMPORTED_MODULE_0__.Face3(0, 1, 2),
    new three__WEBPACK_IMPORTED_MODULE_0__.Face3(0, 2, 3),
    new three__WEBPACK_IMPORTED_MODULE_0__.Face3(1, 0, 4),
    new three__WEBPACK_IMPORTED_MODULE_0__.Face3(2, 1, 4),
    new three__WEBPACK_IMPORTED_MODULE_0__.Face3(3, 2, 4),
    new three__WEBPACK_IMPORTED_MODULE_0__.Face3(0, 3, 4)];


    return geometry;
  }

}


class BoxSide extends three__WEBPACK_IMPORTED_MODULE_0__.Group {

  constructor(outline, highlightMesh, gizmo, hitbox) {
    super();
    this.highlightMesh = highlightMesh;
    this.outline = outline;
    this.gizmo = gizmo;
    this.hitbox = hitbox;
    this.add(highlightMesh);
    this.add(outline);
    this.setHighlightEnabled(false);
    this.updateHitbox();
  }

  setHighlightEnabled(enabled) {
    this.highlightMesh.visible = enabled;
    this.gizmo.visible = enabled;
  }

  updateHitbox() {
    if (!this.parent) return;

    // TODO why isn't this working, also can't force call updateMatrixWorld here
    // const width = this.localToWorld(new Vector3(1, 0, 0)).x;
    // const height = this.localToWorld(new Vector3(0, 1, 0)).y;

    // This could be a lot simpler if the rotations of the sides were proper
    let width, height;
    if (Math.abs(Math.abs(this.position.x) - 0.5) < 1E-6) {
      width = this.parent.scale.z;
      height = this.parent.scale.y;
    } else if (Math.abs(Math.abs(this.position.y) - 0.5) < 1E-6) {
      width = this.parent.scale.x;
      height = this.parent.scale.z;
    } else {
      width = this.parent.scale.x;
      height = this.parent.scale.y;
    }

    const worldScale = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
    this.matrixWorld.decompose(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(), new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion(), worldScale);

    this.hitbox.scale.set(width, height, 1 / worldScale.z + this.gizmo.scale.z);
    this.hitbox.position.copy(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().setFromMatrixPosition(this.matrixWorld));
    const worldQuat = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
    this.matrixWorld.decompose(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(), worldQuat, new three__WEBPACK_IMPORTED_MODULE_0__.Vector3());
    this.hitbox.setRotationFromQuaternion(worldQuat);
  }

  updateMatrixWorld(force) {
    super.updateMatrixWorld(force);
    this.updateHitbox();
  }
}

/***/ },

/***/ "./extensions/SmartSection/SectionPlane.js"
/*!*************************************************!*\
  !*** ./extensions/SmartSection/SectionPlane.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Directions: () => (/* binding */ Directions),
/* harmony export */   HighlightState: () => (/* binding */ HighlightState),
/* harmony export */   SectionPlane: () => (/* binding */ SectionPlane),
/* harmony export */   setPlaneFrameWidth: () => (/* binding */ setPlaneFrameWidth)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);


const Directions = {
  X: {
    'up': new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 0, 0),
    'down': new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-1, 0, 0)
  },
  Y: {
    'up': new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 1, 0),
    'down': new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, -1, 0)
  },
  Z: {
    'up': new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 1),
    'down': new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, -1)
  }
};

const HighlightState = {
  NONE: 'NONE',
  HOVERED: 'HOVERED',
  ACTIVE: 'ACTIVE'
};


const _m0 = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();
const _m1 = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();

const ZERO_VEC3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const TMP_VEC3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const NO_SCALE_VEC3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 1, 1);
const TMP_BOX3 = new three__WEBPACK_IMPORTED_MODULE_0__.Box3();

class SectionPlane {

  #plane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane();
  #rot = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
  #opacity = SectionPlane.DEFAULT_OPACITY;
  #origin = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
  #associativity = [// outer to inner edges
  [0, 0], [1, 3], [2, 2], [3, 1]];


  #innerFillPercentage = 0;

  #trueNorthRotation = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();

  root = null;

  #active = true;
  get active() {
    return this.#active;
  }
  set active(value) {
    this.#active = Boolean(value);
    this.root.visible = this.#active;
  }

  /**
   * Used for determining the color of the plane. this.normal doesn't consider placement transforms, so we have to transform it back
   * @type {Matrix3}
   */
  normalPlacementTransformInverse = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix3();

  #axisColors = new Map([
  ['X', [1, 0, 0]],
  ['Y', [0, 1, 0]],
  ['Z', [0, 0, 1]],
  ['NONE', [0.1, 0.1, 0.1]]]
  );

  #highlights = new Map([
  [HighlightState.NONE, NONE_MATERIAL],
  [HighlightState.HOVERED, HOVER_MATERIAL],
  [HighlightState.ACTIVE, ACTIVE_MATERIAL]]
  );

  get plane() {
    return this.#plane;
  }

  get normal() {
    return this.#plane.normal;
  }

  /**
   * Set the plane normal. This will affect the plane as well as the mesh
   * @param {Vector3} n The normal
   */
  set normal(n) {
    n.normalize();
    this.#plane.setFromNormalAndCoplanarPoint(n, this.#origin);
    this.createRotation(n);
    this.#update();
  }

  get origin() {
    return this.#origin.clone();
  }

  /**
   * Set the plane origin. This will affect the mesh placement as well as the gizmo attachment point
   * @param {Vector3} o The origin
   */
  set origin(o) {
    const normal = this.#plane.normal;
    this.#plane.setFromNormalAndCoplanarPoint(normal, o);
    this.#origin.copy(o);
    this.#update();
  }

  /**
   * Set the rotation for the plane. This will apply to the overlay mesh as well as the plane normal
   * @param {Quaternion} quat
   */
  set rotation(quat) {
    this.#rot.copy(quat);
    const n = Directions.Z.up.clone().applyQuaternion(quat).normalize();
    this.#plane.setFromNormalAndCoplanarPoint(n, this.#origin);
    this.#update();
  }

  set outerMeshVisible(value) {
    this.root.outerMesh.visible = Boolean(value);
    this.root.innerLine.visible = Boolean(value);
    this.root.outerLine.visible = Boolean(value);
  }
  get outerMeshVisible() {
    return this.root.outerMesh.visible;
  }
  set innerMeshVisible(value) {
    this.root.innerMesh.visible = Boolean(value);
  }
  get innerMeshVisible() {
    return this.root.innerMesh.visible;
  }

  #_sharedRot = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
  get rotation() {
    this.#_sharedRot.copy(this.#rot);
    return this.#_sharedRot;
  }

  /**
   * Set the width of the plane's mesh
   * @param {number} value The width
   */
  set width(value) {
    this.root.scale.x = Number(value);
    this.#update();
  }

  /**
   * Get the width of the plane's mesh
   * @returns {number} The current width
   */
  get width() {
    return this.root.scale.x;
  }

  /**
   * Set the height of the plane's mesh
   * @param {number} value The height
   */
  set height(value) {
    this.root.scale.y = Number(value);
    this.#update();
  }

  /**
   * Get the height of the plane's mesh
   * @returns {number} The current height
   */
  get height() {
    return this.root.scale.y;
  }

  #highlightState = HighlightState.NONE;
  get highlightState() {
    return this.#highlightState;
  }

  set highlightState(state) {
    this.#highlightState = state;
    this.root?.children.
    forEach((child) => {
      if (!child.geometry) return;
      if (child instanceof three__WEBPACK_IMPORTED_MODULE_0__.Line) {
        child.material = this.#highlights.get(state) || this.#highlights.get(HighlightState.NONE);
      } else if (state === HighlightState.NONE) {
        child.material.opacity = this.#opacity;
        child.material.uniformsNeedUpdate = true;
      } else {// HOVERED or ACTIVE
        child.material.opacity = this.#opacity + 0.25;
        child.material.uniformsNeedUpdate = true;
      }
    });
  }

  get displayMesh() {
    return this.root.outerMesh;
  }

  constructor(origin = ZERO_VEC3, normal, normalPlacementTransformInverse = null) {
    normal = normal?.normalize() ?? SectionPlane.WORLD_UP.clone();
    this.#plane.setFromNormalAndCoplanarPoint(normal, origin).normalize();
    this.root = this.createMeshStructure();
    this.setInnerFillPercentage(SectionPlane.DEFAULT_INNER_FILL);
    this.setOuterWidth(SectionPlane.OUTER_WIDTH);
    this.origin = origin;
    this.rotation = this.createRotation(normal);
    normalPlacementTransformInverse && this.normalPlacementTransformInverse.copy(normalPlacementTransformInverse);

    this.#update();
  }

  /**
   * Set color of the section plane
   *
   * If not overriden, the section plane will be colored based on its nearest axis in world space
   * @param {number} r Red channel
   * @param {number} g Green channel
   * @param {number} b Blue channel
   * @param {'X'|'Y'|'Z'|'NONE'} axis The axis to use the color on. If no axis is specified, the color will be applied in all directions
   */
  setColor(r, g, b, axis) {
    if (!['X', 'Y', 'Z'].find((dir) => axis === dir) && axis !== 'NONE') {
      axis = null;
    }

    const col = [Number(r), Number(g), Number(b)];

    if (!axis) {
      this.#axisColors.set('X', col);
      this.#axisColors.set('Y', col);
      this.#axisColors.set('Z', col);
      this.#axisColors.set('NONE', col);

    } else {
      this.#axisColors.set(axis, col);
    }

    this.#update();
  }

  /**
   * Set the opacity of the section plane mesh
   * @param {number} opacity Opacity value
   */
  set opacity(opacity) {
    this.#opacity = Number(opacity);
    this.displayMesh.material.opacity = this.#opacity;
    this.displayMesh.material.uniformsNeedUpdate = true;
  }

  /**
   * Intersect this plane
   * @param {Ray} ray The input ray
   * @returns {Vector3} The intersection point. Will be null if no intersection
   */
  intersectRay(ray) {
    return ray?.intersectPlane(this.#plane);
  }

  #getActiveColor() {
    const n = this.normal.clone().applyMatrix3(this.normalPlacementTransformInverse);
    n.applyQuaternion(this.#trueNorthRotation);
    n.normalize();
    const axis = getClosestAxis(n);
    const axisName = Object.entries(Directions).
    find(([axisStr, vec]) => vec.up.equals(axis))[0];
    const isOrthogonal = Math.abs(1 - Math.abs(Math.max(...n.toArray().map((it) => Math.abs(it))))) < 1E-4;
    return this.#axisColors.get(isOrthogonal ? axisName : 'NONE') || [1, 0, 0];
  }

  /**
   * Creates and sets mesh for the given plane
   */
  #update() {
    this.root.position.copy(this.#origin);
    this.root.rotation.setFromQuaternion(this.#rot);
    this.root.scale.set(this.width, this.height, 1);

    this.displayMesh.material.color.setRGB(...this.#getActiveColor());
    this.displayMesh.material.uniformsNeedUpdate = true;
  }

  createRotation(normal, up) {
    const m = SectionPlane.getRotationMatrix(normal, up);

    return (this.#rot || new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion()).setFromRotationMatrix(m);
  }

  resetRotation() {
    this.normalPlacementTransformInverse.identity();
    this.createRotation(SectionPlane.WORLD_UP, SectionPlane.WORLD_FRONT);
    this.#plane.setFromNormalAndCoplanarPoint(SectionPlane.WORLD_UP.clone(), this.origin);
    this.#update();
  }

  /**
   * Must be in range 0-1
   * @param percentage
   */
  setInnerFillPercentage(percentage) {

    if (percentage <= 0) {
      this.root.innerMesh.visible = false;
      this.#innerFillPercentage = 0;
      return;
    }

    this.root.innerMesh.visible = true;

    percentage = Math.max(1e-10, percentage);
    percentage = Math.min(1 - 1e-10, percentage);

    // invert the percentage for scaling the boundary
    const scalingFactor = 1 - percentage;

    const outerVertices = this.root.innerMesh.geometry.vertices.slice(0, 4);
    const innerVertices = this.root.innerMesh.geometry.vertices.slice(5, 9);
    const innerLinkBackVx = this.root.innerMesh.geometry.vertices[9];

    const scaling = _m0.identity().makeScale(scalingFactor, scalingFactor, 0);
    for (let i = 0; i < this.#associativity.length; i++) {
      const [outer, inner] = this.#associativity[i];
      innerVertices[inner].copy(
        outerVertices[outer].clone().applyMatrix4(scaling)
      );
    }

    const distance = (1 - 1e-10) * innerVertices[3].distanceTo(innerVertices[0]);
    innerLinkBackVx.set(
      innerVertices[3].x,
      innerVertices[3].y - distance, 0
    );

    this.root.innerMesh.geometry.vertices.forEach((it) => it.setZ(0));
    this.root.innerMesh.geometry.verticesNeedUpdate = true;
    this.root.innerMesh.geometry.computeBoundingBox();
    this.root.innerMesh.geometry.computeBoundingSphere();
    this.#innerFillPercentage = percentage;
  }

  /**
   * @param {number} width Must be a positive integer
   */
  setOuterWidth(width) {
    width = Math.max(0.01, width);

    const outerVertices = this.root.outerMesh.geometry.vertices.slice(0, 4);
    const innerVertices = this.root.outerMesh.geometry.vertices.slice(5, 9);
    const outerLinkVx = this.root.outerMesh.geometry.vertices[4];

    const scaling = _m0.identity().makeScale(1 + width * (1 / innerVertices[2].x), 1 + width * (1 / innerVertices[2].y), 0);
    for (let i = 0; i < this.#associativity.length; i++) {
      const [outer, inner] = this.#associativity[i];
      outerVertices[outer].copy(
        innerVertices[inner].clone().applyMatrix4(scaling)
      );
    }

    // link vertex
    const distance = (1 - 1e-10) * outerVertices[3].distanceTo(outerVertices[0]);
    outerLinkVx.set(
      outerVertices[3].x - distance,
      outerVertices[3].y, 0
    );

    // update outer line
    const outer = this.root.outerLine.geometry.vertices;
    for (let i = 0; i < 5; i++) {
      outer[i].copy(outerVertices[i === 4 ? 0 : i]);
    }

    this.root.outerLine.geometry.verticesNeedsUpdate = true;
    this.root.outerMesh.geometry.verticesNeedUpdate = true;
    this.root.outerMesh.geometry.computeBoundingBox();
    this.root.outerMesh.geometry.computeBoundingSphere();
  }

  /**
   * Create local min & max for the bounds, then update the inner and outer meshes & outlines
   * @param polygonBounds
   */
  updateMeshFromBounds({ bounds, scale }) {

    const center = TMP_VEC3.set(0, 0, 0);
    for (let i = 0; i < bounds.length; i++) {
      center.add(bounds[i]);
    }
    center.divideScalar(bounds.length);

    const inverse = _m1.getInverse(_m0.compose(center, this.rotation, NO_SCALE_VEC3));
    const transform = _m0.makeScale(scale, scale, 1).multiply(inverse);

    const localBounds = bounds.map((it) => it.clone().applyMatrix4(transform));

    const { min, max } = TMP_BOX3.makeEmpty().setFromPoints(localBounds);

    // update outer mesh, inner vertices are fixed
    const innerVertices = this.root.outerMesh.geometry.vertices.slice(5, 9);
    innerVertices[0].copy(min);
    innerVertices[1].set(max.x, min.y, 0);
    innerVertices[2].copy(max);
    innerVertices[3].set(min.x, max.y, 0);

    // update inner mesh, outer vertices are fixed
    for (let i = 0; i < 4; i++) {
      this.root.innerMesh.geometry.vertices[i].copy(innerVertices[this.#associativity[i][1]]);
    }
    // update outer mesh, innerLinkBackVx needs update
    const innerDistance = (1 - 1e-10) * innerVertices[3].distanceTo(innerVertices[0]);
    const innerLinkBackVx = this.root.outerMesh.geometry.vertices[9];
    innerLinkBackVx.set(
      innerVertices[3].x,
      innerVertices[3].y - innerDistance, 0
    );
    // update inner mesh, outerLinkVx needs update
    const outerVertices = this.root.innerMesh.geometry.vertices;
    const distance = (1 - 1e-10) * outerVertices[3].distanceTo(outerVertices[0]);
    const outerLinkVx = this.root.innerMesh.geometry.vertices[4];
    outerLinkVx.set(
      outerVertices[3].x - distance,
      outerVertices[3].y, 0
    );

    // update the innerLine
    const inner = this.root.innerLine.geometry.vertices;
    for (let i = 0; i < 5; i++) {
      inner[i].copy(innerVertices[i === 4 ? 0 : i]);
    }

    // update the inverse
    this.setInnerFillPercentage(this.#innerFillPercentage);
    this.setOuterWidth(SectionPlane.OUTER_WIDTH);

    this.root.position.copy(center);

    this.root.children.forEach((it) => it.geometry.verticesNeedUpdate = true);

    return { position: center.clone(), width: max.x - min.x, height: max.y - min.y };
  }

  createMeshStructure() {
    // create default bounds, 1 unit size scaled from origin
    const root = new three__WEBPACK_IMPORTED_MODULE_0__.Group();

    // displayMesh
    const outerMesh = this.createCutoutBox();
    const innerMesh = this.createCutoutBox();

    // inline, outline
    const createLineGeometry = (v) => {
      const g = new three__WEBPACK_IMPORTED_MODULE_0__.Geometry();
      g.isLines = true;
      v.forEach((it) => g.vertices.push(it));
      g.vertices.push(v[0].clone());
      return g;
    };

    const outerLine = new three__WEBPACK_IMPORTED_MODULE_0__.Line(
      createLineGeometry(outerMesh.geometry.vertices.slice(0, 4)),
      NONE_MATERIAL
    );
    const innerLine = new three__WEBPACK_IMPORTED_MODULE_0__.Line(
      createLineGeometry(outerMesh.geometry.vertices.slice(5, 9)),
      NONE_MATERIAL
    );

    root.add(outerMesh);
    root.add(innerMesh);
    root.add(outerLine);
    root.add(innerLine);

    Object.assign(root, { outerMesh, innerMesh, outerLine, innerLine });

    return root;
  }

  createCutoutBox() {
    const vec3 = (x, y, z) => new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(x, y, z);

    let inner = [
    vec3(-0.25, -0.25, 0),
    vec3(-0.25, 0.25, 0),
    vec3(0.25, 0.25, 0),
    vec3(0.25, -0.25, 0)];


    const scaling = _m0.identity().makeScale(2, 2, 2);
    const outer = inner.map((vx) => vx.clone().applyMatrix4(scaling));
    const outerLinkVx = vec3(-1, 0, 0).
    multiplyScalar((1 - 1e-6) * outer[2].distanceTo(outer[3])).
    add(outer[3]);

    // make inner ccw starting from min
    inner = this.#associativity.map((assoc) => inner[assoc[1]]);

    const innerLinkBackVx = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, -0.5 * (1 - 1e-6)).add(inner[3]);

    const shape = new three__WEBPACK_IMPORTED_MODULE_0__.Shape([...outer, outerLinkVx, ...inner, innerLinkBackVx]);
    const geometry = new three__WEBPACK_IMPORTED_MODULE_0__.ShapeGeometry(shape);
    const planeColor = new three__WEBPACK_IMPORTED_MODULE_0__.Color(...this.#getActiveColor());
    return new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(geometry, this.#getMaterial(planeColor));
  }


  #material;
  #getMaterial(color) {
    const planeMaterial = this.#material || new Autodesk.Viewing.Scene.UnlitMaterial({
      opacity: this.#opacity,
      color: color,
      side: three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    this.#material = planeMaterial;
    planeMaterial.color.set(color.toArray());
    planeMaterial.opacity = this.#opacity;
    return planeMaterial;
  }

  equals(otherPlane, delta = 1E-7) {
    const ourPlane = this.toVector4().normalize();
    return ourPlane.sub(otherPlane.toVector4().normalize()).length() <= delta;
  }

  /**
   * Vector4 representation of the plane inferred from the plane equation
   * Plane Equation:         A*x + B*y + C*z + D = 0
   * @returns {Vector4}
   */
  toVector4() {
    const { x, y, z } = this.normal;
    const d1 = -1 * (x * this.origin.x + y * this.origin.y + z * this.origin.z);

    return new three__WEBPACK_IMPORTED_MODULE_0__.Vector4(this.normal.x, this.normal.y, this.normal.z, d1);
  }

  setTrueNorthRotation(rotation) {
    if (rotation.equals(this.#trueNorthRotation)) {
      // don't trigger an update when nothing has changed
      return;
    }
    this.#trueNorthRotation.copy(rotation);
    this.#update();
  }

  /**
   * Create a section plane from Hession normal form
   * @param {Vector4} vector4
   */
  static fromVector4(vector4) {
    // get gizmo attachment point (origin) from signed distance and normal
    const { x, y, z, w } = vector4;
    const normal = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(x, y, z).normalize();
    const origin = normal.clone().multiplyScalar(-w); // TODO: For some reason, requires a negative (Data Persistence Extension buidling the Plane )

    return new SectionPlane(origin, normal);
  }

  static setWorldUp(up, right) {
    this.WORLD_UP = up?.clone().normalize() ?? this.WORLD_UP;
    this.WORLD_FRONT = right ? this.WORLD_UP.clone().cross(right).normalize() : this.WORLD_FRONT;
    this.WORLD_DOWN = this.WORLD_UP.clone().multiplyScalar(-1);
  }

  static getRotationMatrix(normal, up) {
    up = up || vecEquals(normal, SectionPlane.WORLD_UP) || vecEquals(normal, SectionPlane.WORLD_DOWN) ?
    SectionPlane.WORLD_FRONT : SectionPlane.WORLD_UP;

    const right = up.clone().cross(normal).normalize();
    up = normal.clone().cross(right);

    // Set a transposed lookAt matrix, where normal is our front vector
    _m0.identity().set(
      right.x, up.x, normal.x, 0,
      right.y, up.y, normal.y, 0,
      right.z, up.z, normal.z, 0,
      0, 0, 0, 1
    );
    return _m0;
  }

  static WORLD_UP = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 1);
  static WORLD_FRONT = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 1, 0);
  static WORLD_DOWN = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, -1);

  static DEFAULT_CUTOUT_SCALE = 0.92;

  static DEFAULT_OPACITY = 0.25;
  static DEFAULT_HIGHLIGHT_OPACITY = SectionPlane.DEFAULT_OPACITY + 0.25;
  static DEFAULT_OUTER_WIDTH = 10;
  static DEFAULT_INNER_FILL = 0;

  // if set, will override the default and model outer widths
  static OVERRIDE_OUTER_WIDTH = null;

  static get OUTER_WIDTH() {
    const _overriden = SectionPlane.OVERRIDE_OUTER_WIDTH;
    const _fromModel = OUTER_WIDTH_FROM_MODEL;
    return _overriden || _fromModel || SectionPlane.DEFAULT_OUTER_WIDTH;
  }

}

const PLANE_FRAME_WIDTH_SCALE = 0.035;

let OUTER_WIDTH_FROM_MODEL = null;

/**
 * @param {number} minWorldSize - the minimum dimension of the world AABB
 */
function setPlaneFrameWidth(minWorldSize) {
  const planeFrameWidth = PLANE_FRAME_WIDTH_SCALE * minWorldSize;
  if (isFinite(planeFrameWidth) && planeFrameWidth > 0) {
    OUTER_WIDTH_FROM_MODEL = planeFrameWidth;
  }
}


const xDir = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 0, 0);
const yDir = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 1, 0);
const zDir = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 1);

function getClosestAxis(normal) {
  const xn = Math.abs(normal.x);
  const yn = Math.abs(normal.y);
  const zn = Math.abs(normal.z);

  if (xn >= yn && xn >= zn) {
    return xDir;
  } else if (yn > xn && yn >= zn) {
    return yDir;
  } else {
    return zDir;
  }
}

const _v0 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
function vecEquals(a, b, delta = 1E-10) {
  return _v0.copy(a).sub(b).length() <= delta;
}


const ACTIVE_MATERIAL = new three__WEBPACK_IMPORTED_MODULE_0__.LineBasicMaterial({
  color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(0, 0, 0),
  linewidth: 2,
  depthTest: false,
  depthWrite: false,
  transparent: true
});
const NONE_MATERIAL = new three__WEBPACK_IMPORTED_MODULE_0__.LineBasicMaterial({
  color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(0, 0, 0),
  linewidth: 2,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: 0
});
const HOVER_MATERIAL = new three__WEBPACK_IMPORTED_MODULE_0__.LineBasicMaterial({
  color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(0, 1, 1),
  linewidth: 2,
  depthTest: false,
  depthWrite: false,
  transparent: true
});

/***/ },

/***/ "./extensions/SmartSection/SmartGizmo.js"
/*!***********************************************!*\
  !*** ./extensions/SmartSection/SmartGizmo.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ SmartGizmo)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _SmartSection_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SmartSection.js */ "./extensions/SmartSection/SmartSection.js");
/* harmony import */ var _SectionPlane_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SectionPlane.js */ "./extensions/SmartSection/SectionPlane.js");




/** @import { Viewer3DImpl } from "src/application/Viewer3DImpl" */
/** @import { SectionTransformControls } from "src/tools/SectionTransformControls" */

class SmartGizmo {
  overlayName = _SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.SMART_SECTION_OVERLAY_KEY;
  initialized = false;
  sectionPlanes = [];

  /** @type {SectionTransformControls} the transform gizmo */
  transControl;
  isDragging = false;
  touchType = null;
  plane = null;
  smartSection;
  mesh;
  analyticsAdjusting = false;
  isHighlightPausedMemorized = false;

  constructor(viewer, smartSection) {
    this.viewer = viewer;
    /** @type {Viewer3DImpl} */
    this.viewerImpl = viewer.impl;
    this.smartSection = smartSection;
  }

  init() {
    if (this.initialized) {
      // Verify overlays are added.
      this.viewerImpl.addOverlay(this.overlayName, this.transControl);
      return;
    }

    this.transControl = new Autodesk.Viewing.Private.SectionTransformControls(this.viewerImpl.camera, this.viewerImpl.canvas);


    this.transControl.space = 'local';

    if (this.viewerImpl.overlayScenes[this.overlayName] === undefined) {
      this.viewerImpl.createOverlayScene(this.overlayName);
    }

    this.viewerImpl.addOverlay(this.overlayName, this.transControl);

    this.transControl.addEventListener('change', () => {this.viewerImpl.invalidate(false, false, true);});
    this.transControl.addEventListener('mode-changed', (e) => {
      const plane = this.smartSection.activePlane;
      if (e.value === 'translate' && plane) {
        this.mesh.setRotationFromQuaternion(plane.rotation);
        this.viewerImpl.invalidate(false, false, true);
      }
    });

    const boxGeometry = new three__WEBPACK_IMPORTED_MODULE_0__.BufferGeometry().fromGeometry(new three__WEBPACK_IMPORTED_MODULE_0__.BoxGeometry(10, 10, 10));
    const boxMaterial = new Autodesk.Viewing.Scene.StandardMaterial({ color: new three__WEBPACK_IMPORTED_MODULE_0__.Color(1, 0, 0) });
    const boxMesh = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(boxGeometry, boxMaterial);
    boxMesh.matrix = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().compose(
      new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-10, -10, 0),
      new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion(0, 0, 0, 1),
      new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 1, 1)
    );
    boxMesh.visible = false;
    boxMesh.name = "section-gizmo-helper-cube";
    boxMesh.dbId = 62910032;
    this.mesh = boxMesh;

    this.viewerImpl.addOverlay(this.overlayName, boxMesh);
    this.transControl.attach(boxMesh);
    this.setGizmoEnabled(false);


    // Setup listeners
    this.transControl.addEventListener('mouseDown', () => {
      if (!this.sectionPlane) {
        return;
      }
      this.smartSection.setActivePlane(this.sectionPlane);
    });

    this.transControl.addEventListener('mouseUp', () => {
      if (this.smartSection.activePlane) {
        this.clampPlane(this.smartSection.activePlane);
        this.smartSection.analytics.trackPlaneAdjustedOnMouseUp(this.transControl, this.analyticsAdjusting);
        this.analyticsAdjusting = false;
      }
    });

    this.transControl.addEventListener('objectChange', (event) => {
      // update position of the plane
      const newPos = event.target.worldPosition;
      const activePlane = this.smartSection.activePlane;
      if (activePlane) {
        this.viewerImpl.removeOverlay(this.overlayName, activePlane.root);
        activePlane.rotation = this.mesh.getWorldQuaternion();
        activePlane.origin = newPos;
        this.viewerImpl.addOverlay(this.overlayName, activePlane.root);
        this.smartSection.updateState();
        activePlane.root.updateMatrixWorld();
        this.analyticsAdjusting = true;

        if (!this.transControl.isTranslatingZ()) {
          this.clampPlane(activePlane);
        }
      }
    });


    this.transControl.addEventListener('axisClick', (e) => {
      const activePlane = this.smartSection.activePlane;
      if (!activePlane) {
        return;
      }

      this.transControl.updateMatrixWorld();
      const origin = this.transControl.worldPosition;

      this.viewerImpl.removeOverlay(this.overlayName, activePlane.root);
      activePlane.rotation = activePlane.rotation.multiply(e.delta);
      activePlane.origin = origin;
      this.viewerImpl.addOverlay(this.overlayName, activePlane.root);
      this.smartSection.updateState();
      this.mesh.setRotationFromQuaternion(activePlane.rotation);
      this.viewerImpl.invalidate(false, false, true);
      this.smartSection.events.dispatchEvent(_SmartSection_js__WEBPACK_IMPORTED_MODULE_1__.STATE_CHANGED_EVENT.type);

      this.smartSection.analytics.trackPlaneAdjustedOnAxisClick();
    });

    this.transControl.addEventListener('axisHover', (e) => {
      const isHighlightPaused = this.viewer.isHighlightPaused();
      // If highlight was resumed externally since the last event, our ownership token is stale — reset it.
      if (!isHighlightPaused && this.isHighlightPausedMemorized) {
        this.isHighlightPausedMemorized = false;
      }
      if (isHighlightPaused && !this.isHighlightPausedMemorized) {
        return;
      }
      const isAxisHovered = Boolean(e.axis);
      if (isHighlightPaused !== isAxisHovered) {
        this.isHighlightPausedMemorized = isAxisHovered;
        this.viewerImpl.pauseHighlight(isAxisHovered);
        this.viewerImpl.invalidate(false, false, true);
      }
    });

    this.initialized = true;
  }

  setGizmoEnabled(enabled) {
    this.transControl.visible = enabled;
    this.transControl.enabled = enabled;
  }

  getGizmoVisible() {
    return this.transControl.visible;
  }

  removeControl() {
    if (!this.initialized)
    return;

    this.viewerImpl.removeOverlay(this.overlayName, this.transControl);
    this.viewerImpl.removeOverlay(this.overlayName, this.mesh);
    this.viewerImpl.removeOverlayScene(this.overlayName);
    this.transControl.removeEventListener('change', () => {
      this.viewerImpl.invalidate(false, false, true);
    });
    this.transControl = null;
    this.initialized = false;
  }

  attachToPlane(plane, followMe = false, forceUpdate = false) {
    if (!plane.active) {
      return;
    }
    if (!forceUpdate && this.sectionPlane?.equals(plane)) {
      // just update the ref
      this.sectionPlane = plane;
      return;
    }
    this.transControl.reset();
    this.mesh.setRotationFromQuaternion(plane.rotation);
    this.mesh.position.copy(plane.origin);
    this.sectionPlane = plane;
    this.transControl.setModelTransform(plane.normalPlacementTransformInverse);
    this.transControl.updateMatrixWorld();
    if (followMe) {
      this.followMe(this.viewer.getCamera(), plane);
    }
  }

  displayControl(visible) {
    this.transControl.visible = visible;
  }

  /**
   * Keeps the gizmo in bounds of the camera, but also in bounds of the section plane bbox
   * @param camera
   * @param sectionPlane
   */
  followMe(camera, sectionPlane) {
    this.clampScreen(camera, sectionPlane);
    this.clampPlane(sectionPlane);
  }

  clampScreen(camera, sectionPlane) {

    // Skip if a very narrow angle relative to the plane
    const dot = camera.position.clone().sub(camera.target).normalize().dot(sectionPlane.normal);
    if (Math.abs(dot) < 0.15) {
      return;
    }

    const objects = this.transControl._gizmo.getAllDisplayObjects();
    const box = new three__WEBPACK_IMPORTED_MODULE_0__.Box3().setFromObject(objects[0]);
    objects.forEach((obj) => box.union(new three__WEBPACK_IMPORTED_MODULE_0__.Box3().setFromObject(obj)));
    const { min, max } = box;

    const corners = [
    min, min.clone().setX(max.x), min.clone().setY(max.y), min.clone().setZ(max.z),
    max, max.clone().setX(min.x), max.clone().setY(min.y), max.clone().setZ(min.z)];



    const viewport = this.viewerImpl.getCanvasBoundingClientRect();
    const viewportBb = new three__WEBPACK_IMPORTED_MODULE_0__.Box2(new three__WEBPACK_IMPORTED_MODULE_0__.Vector2(0, 0), new three__WEBPACK_IMPORTED_MODULE_0__.Vector2(viewport.width, viewport.height));
    const gizmoScreenCoords = corners.map((it) => this.viewerImpl.worldToClient(it));
    const gizmoBbox = new three__WEBPACK_IMPORTED_MODULE_0__.Box2().setFromPoints(gizmoScreenCoords);

    const union = gizmoBbox.clone().union(viewportBb);
    const area = (box) => Math.abs(box.max.x - box.min.x) * Math.abs(box.max.y - box.min.y);
    if (area(union) - area(viewportBb) < 1e-6) {
      return;
    }

    const intersect = gizmoBbox.clone().intersect(viewportBb);
    const offsetMin = intersect.min.clone().sub(gizmoBbox.min);
    const offsetMax = intersect.max.clone().sub(gizmoBbox.max);

    const gizmoPosScreen = this.viewerImpl.worldToClient(this.mesh.getWorldPosition());
    const newGizmoPosScreen = gizmoPosScreen.
    clone().
    add(offsetMin).
    add(offsetMax);


    const ndcVector = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(
      2 * newGizmoPosScreen.x / viewport.width - 1,
      1 - 2 * newGizmoPosScreen.y / viewport.height,
      camera.isPerspective ? 0.5 : -1
    );

    const worldSpace = ndcVector.clone().unproject(camera);
    const cameraPos = this.viewer.getCamera().getWorldPosition();

    const ray = camera.isPerspective ?
    new three__WEBPACK_IMPORTED_MODULE_0__.Ray(cameraPos, worldSpace.clone().sub(cameraPos).normalize()) :
    new three__WEBPACK_IMPORTED_MODULE_0__.Ray(worldSpace, new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, -1).transformDirection(camera.matrixWorld));

    const intersection = ray.intersectPlane(sectionPlane.plane);

    if (intersection) {
      this.mesh.position.copy(intersection);
    }
  }


  clampPlane(sectionPlane) {
    const planeBounds = new three__WEBPACK_IMPORTED_MODULE_0__.Box2().setFromPoints(sectionPlane.displayMesh.geometry.vertices);
    const gizmoPosPlane = sectionPlane.root.worldToLocal(this.mesh.getWorldPosition());
    const clamped = planeBounds.clampPoint(gizmoPosPlane.clone());

    if (clamped.distanceTo(gizmoPosPlane) < 1E-6) {
      return;
    }

    const newPos = sectionPlane.root.localToWorld(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(...clamped.toArray()));
    this.mesh.position.copy(newPos);
  }

}

/***/ },

/***/ "./extensions/SmartSection/SmartSection.js"
/*!*************************************************!*\
  !*** ./extensions/SmartSection/SmartSection.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CUT_PLANE_SET: () => (/* binding */ CUT_PLANE_SET),
/* harmony export */   PlacementStrategy: () => (/* binding */ PlacementStrategy),
/* harmony export */   SMART_SECTION_ACTIVATED_EVENT: () => (/* binding */ SMART_SECTION_ACTIVATED_EVENT),
/* harmony export */   SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT: () => (/* binding */ SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT),
/* harmony export */   SMART_SECTION_DEACTIVATED_EVENT: () => (/* binding */ SMART_SECTION_DEACTIVATED_EVENT),
/* harmony export */   SMART_SECTION_OVERLAY_KEY: () => (/* binding */ SMART_SECTION_OVERLAY_KEY),
/* harmony export */   STATE_CHANGED_EVENT: () => (/* binding */ STATE_CHANGED_EVENT),
/* harmony export */   SmartSectionExtension: () => (/* binding */ SmartSectionExtension),
/* harmony export */   UI_CUTPLANES_CHANGED_EVENT: () => (/* binding */ UI_CUTPLANES_CHANGED_EVENT),
/* harmony export */   UI_HIDE_PANEL_EVENT: () => (/* binding */ UI_HIDE_PANEL_EVENT),
/* harmony export */   UI_SELECT_TAB_EVENT: () => (/* binding */ UI_SELECT_TAB_EVENT),
/* harmony export */   UI_SHOW_PANEL_EVENT: () => (/* binding */ UI_SHOW_PANEL_EVENT),
/* harmony export */   equalsTolerance: () => (/* binding */ equalsTolerance)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _SmartSectionTool_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SmartSectionTool.js */ "./extensions/SmartSection/SmartSectionTool.js");
/* harmony import */ var _SmartGizmo_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SmartGizmo.js */ "./extensions/SmartSection/SmartGizmo.js");
/* harmony import */ var _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./SectionPlane.js */ "./extensions/SmartSection/SectionPlane.js");
/* harmony import */ var _NavAdjustor_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./NavAdjustor.js */ "./extensions/SmartSection/NavAdjustor.js");
/* harmony import */ var _SmartSectionLocales_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./SmartSectionLocales.js */ "./extensions/SmartSection/SmartSectionLocales.js");
/* harmony import */ var _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./SectionBox.js */ "./extensions/SmartSection/SectionBox.js");
/* harmony import */ var _PlacementIndicator_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./PlacementIndicator.js */ "./extensions/SmartSection/PlacementIndicator.js");
/* harmony import */ var _SmartSectionCapMeshes_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./SmartSectionCapMeshes.js */ "./extensions/SmartSection/SmartSectionCapMeshes.js");
/* harmony import */ var _ModelSheetTransition_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ../ModelSheetTransition/ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");
/* harmony import */ var _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./SmartSectionAnalytics.js */ "./extensions/SmartSection/SmartSectionAnalytics.js");












const SMART_SECTION_OVERLAY_KEY = 'smartGizmo';

const av = Autodesk.Viewing;
const avp = av.Private;

const namespace = AutodeskNamespace('Autodesk.Viewing.Extensions.SmartSection');

namespace.Analytics = {
  FROM: _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM,
  ACTIONS: _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS
};

const STATE_CHANGED_EVENT = { type: "SmartSection.SectionStateChange" };
const CUT_PLANE_SET = 'Autodesk.Viewing.Extension.Section.SectionTool';
const UI_SHOW_PANEL_EVENT = { type: 'SmartSectionUI.ShowPanel' };
const UI_HIDE_PANEL_EVENT = { type: 'SmartSectionUI.HidePanel' };
const UI_SELECT_TAB_EVENT = { type: 'SmartSectionUI.SelectTab' };
const UI_CUTPLANES_CHANGED_EVENT = { type: 'SmartSectionUI.CutplanesChanged' };

const SMART_SECTION_ACTIVATED_EVENT = { type: "SmartSection.Activated" };
const SMART_SECTION_DEACTIVATED_EVENT = { type: "SmartSection.Deactivated" };

/**
 * Fired when the box feature availability changes.
 * @event Autodesk.Viewing.Extensions.SmartSection#SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT
 * @property {boolean} boxFeatureAvailable - True if the box feature is available, false otherwise.
*/
const SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT = "SmartSection.BoxFeatureAvailabilityChanged";

namespace.SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT = SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT;

const PlacementStrategy = Object.freeze({
  PLANE_SURFACE_NORMAL: 0,
  PLANE_ORTHOGONAL_GUESS: 1,
  BOX_TO_BOUNDING_BOX: 0,
  BOX_FREE_PLACEMENT: 1
});

const GIZMO_MODE = Object.freeze({
  TRANSLATE: 'translate',
  ROTATE: 'rotate'
});

const DEFAULT_CONTROL_STATE = Object.freeze({
  box: Object.freeze({
    visible: true,
    inverted: false
  }),
  plane: Object.freeze({
    visible: true
  }),
  gizmoEnabled: true,
  gizmoMode: GIZMO_MODE.TRANSLATE,
  hatchesEnabled: true,
  alignTrueNorthEnabled: false
});

// This needs to be in sync with Autodesk.AEC.FloorSelector.SELECTION_SETTLED
// however, we define it here to avoid a dependency on the FloorSelector extension
const SELECTION_SETTLED_EVENT = 'selectionSettled';

// When used externally aka 3rd party, sometimes namespace classes like SectionPlane !== Autodesk.SmartSection.SectionPlane,
// consequently new Autodesk.SmartSection.SectionPlane() is not instanceof SectionPlane.
// This is unrelated to the namespace name, same for Autodesk.SmartSection and Autodesk.Viewing.Extensions.SmartSection.
// To be checked with LMV colleagues.
// In addition, a side-note:
// >>> export { SectionPlane, SectionBox }; <-- this exports them into 'Autodesk.Extensions.SmartSection'
namespace.SectionPlane = _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane;
namespace.SectionBox = _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox;
namespace.PlacementStrategy = PlacementStrategy;
namespace.STATE_CHANGED_EVENT = STATE_CHANGED_EVENT.type;
namespace.UI_SHOW_PANEL_EVENT = UI_SHOW_PANEL_EVENT.type;
namespace.UI_HIDE_PANEL_EVENT = UI_HIDE_PANEL_EVENT.type;
namespace.UI_SELECT_TAB_EVENT = UI_SELECT_TAB_EVENT.type;
namespace.UI_CUTPLANES_CHANGED_EVENT = UI_CUTPLANES_CHANGED_EVENT.type;
namespace.SMART_SECTION_ACTIVATED_EVENT = SMART_SECTION_ACTIVATED_EVENT.type;
namespace.SMART_SECTION_DEACTIVATED_EVENT = SMART_SECTION_DEACTIVATED_EVENT.type;
namespace.SMART_SECTION_OVERLAY_KEY = SMART_SECTION_OVERLAY_KEY;

/**
 * The extension id is: 'Autodesk.SmartSection'. Used for Sectioning models quickly
 *
 * @memberof Autodesk.Viewing.Extensions
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 */
class SmartSectionExtension extends av.Extension {
  /** @type {string} */
  get TOOL_SCHEMA() {return 'autodesk.viewer:section-1.0.0';}

  #controlState;
  #maxNumberSectionPlanes = 6;

  #boxFeatureAvailable = false;

  #enabled = false;

  /** @type {SectionBox|null} */
  activeBox = null;

  planeDisplayMode = SmartSectionExtension.PLANE_DISPLAY_MODES.WORLD_SPACE;
  onBoxToolChanged = () => this.updateState();
  deactivateOnEvent = () => this.deactivate();

  _sessionState = new Map();

  navAdjustor = _NavAdjustor_js__WEBPACK_IMPORTED_MODULE_4__.NavAdjustor;

  isActive() {
    return this.#enabled;
  }

  isFrameVisible = () => this.#controlState.plane.visible;

  isBoxVisible = () => this.#controlState.box.visible;

  isGizmoEnabled = () => this.#controlState.gizmoEnabled;

  isRotationEnabled = () => this.#controlState.gizmoMode === GIZMO_MODE.ROTATE;

  isHatchesEnabled = () => this.#controlState.hatchesEnabled;

  isAlignTrueNorthEnabled = () => this.#controlState.alignTrueNorthEnabled;

  /**
   * Autodesk.SmartSectionExtension constructor
   * @constructor
   * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
   * @param {Object} [options] Options for the SmartSectionExtension
   * @param {boolean} [options.someOption=false] This is how options should be documented
   */
  constructor(viewer, options) {
    super(viewer, options);

    // Extend the localization strings
    this.extendLocalization(_SmartSectionLocales_js__WEBPACK_IMPORTED_MODULE_5__.locales);

    this.modes = [];
    this.mode = '';
    this.name = 'SmartSection';
    /** @type {SmartGizmo|null} */
    this.gizmo;
    this.viewer = viewer;
    this.navAdjustor.viewer = viewer;
    this.events = new three__WEBPACK_IMPORTED_MODULE_0__.EventDispatcher();

    /** @type {SectionPlane[]} */
    this.planes = [];
    this.activePlane = null;
    this.followMeEnabled = true;
    this.modelTools;

    /** @type {SmartSectionAnalytics} */
    this.analytics = new _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.SmartSectionAnalytics(this);

    this.#resetControlState();

    this._capMeshes = new _SmartSectionCapMeshes_js__WEBPACK_IMPORTED_MODULE_8__.SmartSectionCapMeshes(viewer, { cutPlaneSetName: CUT_PLANE_SET });

    // TODO - when this is implemented, should move to the SmartGizmo wrapper
    this.onCameraChanged = this.onCameraChanged.bind(this);

    this.onModelAdded = this.onModelAdded.bind(this);
    this.onModelRemoved = this.onModelRemoved.bind(this);
    this.onModelRootLoaded = this.onModelRootLoaded.bind(this);
    this.onModelBoxesReady = this.onModelBoxesReady.bind(this);
    this.onObjectTreeCreated = this.onObjectTreeCreated.bind(this);
    this.onFirstPixel = this.onFirstPixel.bind(this);

    this.onSceneUpdated = this.onSceneUpdated.bind(this);
    this.setCapMeshesEnabled = this.setCapMeshesEnabled.bind(this);
    this.onCutPlanesChange = this.onCutPlanesChange.bind(this);
    this.onFloorSelectorSelectionSettled = this.onFloorSelectorSelectionSettled.bind(this);
    this.onShowAll = this.onShowAll.bind(this);

    this.onViewerToolChanged = this.onViewerToolChanged.bind(this);
  }

  setUIPanel(panel) {
    this.panel = panel;
  }

  /**
   * If tools conflicting with the Section Tool are currently active, starting SmartSection placement should cancel those,
   * to avoids conflicting click-handling between tools and SmartSection placement mode.
   *
   * At the moment, such conflicting tools include the Measure Tool only.
   *
   * @private
   */
  #cancelOtherTools() {
    const measureExt = this.viewer?.getExtension?.('Autodesk.Measure');
    if (measureExt?.isActive()) {
      measureExt.deactivate();
    }
  }

  onFirstPixel() {
    this.#applyWorldBasis();
    // restore session, if models were switched while the extension was active
    if (this.#enabled && !this.hasSections()) this.#restoreSessionState();
  }

  /**
   * Triggered as part of Switching Views (3D Viewables) in Sheets & Views Panel (Docs)
   * Not triggered at initial load, e.g., when the file gets opened in FDM
   */
  onModelAdded(event) {
    // For shallow copies of the same model, or when switching the already loaded Viewables, e.g., from
    // ACCViewer's "Sheets & Views", `onModelRootLoaded` is never triggered,
    // so we need to duplicate all logic even though it will be executed twice in case of real model loading.
    this.#updateBoxFeatureAvailability();
    this.#watchModelBoxes(event.model);
    this.navAdjustor.addModel(event.model);

    const hasVisible3dModel = event.model.is3d() ||
    this.viewer.getVisibleModels().some((model) => model.is3d());
    if (!this.#enabled || !hasVisible3dModel) {
      return;
    }

    if (!this.#restoreSessionState()) {
      this.resetState();
    }
  }

  onModelRemoved(event) {
    this.#unwatchModelBoxes(event.model);
    if (this.navAdjustor.invalidateModel(event.model)) {
      this.updateState({ skipStoreSessionState: true });
    }
  }

  /**
   * The fragment bounding boxes only arrive after MODEL_ADDED_EVENT/MODEL_ROOT_LOADED_EVENT, so the OBB that
   * NavAdjustor computes there is based on boxes that are still (partially) zero. It therefore caches the model
   * as `noFrags` and we have to ask it again once the boxes are final.
   *
   * MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT is fired on the model (not on the viewer) by Model.boxesLoadingDone(),
   * which is usually well before the geometry finished streaming. Only OtgLoader triggers it, which is exactly
   * the format that needs it: for SVF & co. the boxes are part of the fragment list and are therefore already
   * available once it is parsed.
   * @private
   */
  #watchModelBoxes(model) {
    if (!model.is3d()) return;
    if (!model.hasEventListener(Autodesk.Viewing.MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT, this.onModelBoxesReady)) {
      model.addEventListener(Autodesk.Viewing.MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT, this.onModelBoxesReady);
    }
  }

  /** @private */
  #unwatchModelBoxes(model) {
    model.removeEventListener(Autodesk.Viewing.MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT, this.onModelBoxesReady);
  }

  /**
   * Triggered once a model's fragment bounding boxes are final, i.e. once its best-fit AABB can actually be
   * computed. Only then does NavAdjustor replace the `noFrags` placeholder OBB with the real one.
   */
  onModelBoxesReady(event) {
    this.navAdjustor.addModel(event.model, () => {
      this.updateState({ skipStoreSessionState: true });
    });
  }

  // triggered after `onModelAdded`
  onModelRootLoaded(event) {
    this.#updateBoxFeatureAvailability();

    this.navAdjustor.addModel(event.model, () => {
      this.updateState({ skipStoreSessionState: true });
    });
  }

  onObjectTreeCreated() {
    this.#updateBoxFeatureAvailability();
  }

  /**
   * Called by the viewer once for the lifetime of the extension (unload() ends it)
   * Perform all initializations here.
   * The viewer sends `EXTENSION_LOADED_EVENT` after the load succeeds.
   * @returns {boolean} True if the load was successful. Optionally, the function can return a Promise to indicate success (resolve) or failure (reject).
   * @memberof Autodesk.Viewing.Extensions.SmartSection
   * @private
   */
  async load() {
    super.load();

    // Without this edge materials are not being sectioned properly in LeechViewer
    // See also ViewerState.js restoreSectionPlanes
    // TODO: https://autodesk.atlassian.net/browse/VIZX-3137
    this.viewer.impl.setCutPlaneSetFor2DRendering(CUT_PLANE_SET);

    this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelAdded);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.onModelRemoved);
    this.viewer.addEventListener(Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT, this.onModelRemoved);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, this.onModelRootLoaded);
    this.viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, this.onObjectTreeCreated);
    this.viewer.addEventListener(Autodesk.Viewing.RENDER_FIRST_PIXEL, this.onFirstPixel);

    this.viewer.addEventListener(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this.onCutPlanesChangeFromAlignment);

    this.#initGizmosAndTools();
    this.#updateBoxFeatureAvailability();

    // cache already loaded models, as otherwise they might never be handled with `onModelRootLoaded`
    for (const model of this.viewer.getVisibleModels()) {
      this.#watchModelBoxes(model);
      this.navAdjustor.addModel(model);
    }

    // Load the required dependency (and return the pending load as the load completion Promise)
    const compGeom = await this.viewer.loadExtension('Autodesk.CompGeom');

    this.viewer.registerContextMenuCallback('Autodesk.SmartSection', this.onContextMenu.bind(this));

    return compGeom !== undefined;
  }

  #updatePlaneFrameWidth() {
    if (this.navAdjustor.isWorldBoxEmpty()) {
      return;
    }
    (0,_SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.setPlaneFrameWidth)(this.navAdjustor.minWorldSize);
  }

  #applyWorldBasis() {
    if (this.viewer.navigation) {
      _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane.setWorldUp(this.viewer.navigation.getWorldUpVector(), this.viewer.navigation.getWorldRightVector());
    }

    // default section box dimensions are based off of world up
    const defaultDimensions = _PlacementIndicator_js__WEBPACK_IMPORTED_MODULE_7__.PlacementBox.BASE_DIMENSIONS;
    const upDimension = Math.min(...defaultDimensions.toArray());
    const otherDimension = Math.max(...defaultDimensions.toArray());
    const upValue = Object.entries(_SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane.WORLD_UP).
    sort((a, b) => b[1] - a[1])[0][0];

    const dimensions = {
      x: otherDimension,
      y: otherDimension,
      z: otherDimension
    };

    dimensions[upValue] = upDimension;

    _PlacementIndicator_js__WEBPACK_IMPORTED_MODULE_7__.PlacementBox.BASE_DIMENSIONS.copy(dimensions);
  }

  /**
   * Clear all planes and reset the state of the extension.
   * Does not automatically stores session state.
   *
   * @param {resetAllSectionPlanes} - if true, the Viewer's cutplanes set is also reset if
   *                                  the section tool has no section planes.
   */
  resetState(resetAllSectionPlanes = false, fireEvent = true) {
    if (!this.hasSections() && resetAllSectionPlanes) {
      this.viewer.impl.setCutPlaneSet('__set_view', undefined);
    }
    this.planes.forEach((it) => this.viewer.impl.removeOverlay(SMART_SECTION_OVERLAY_KEY, it.root));
    this.activeBox?.events?.removeEventListener(_SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.BOX_STATE_CHANGED_EVENT.type, this.onBoxToolChanged);
    this.activeBox?.dispose();
    const needsClear = this._capMeshes?.clear();
    this.planes = [];
    this.activePlane = null;
    this.activeBox = null;
    if (this.gizmo) {
      this.gizmo.setGizmoEnabled(false);
    }
    this.viewer.impl.setCutPlaneSet(CUT_PLANE_SET, null, fireEvent);
    this.viewer.impl.invalidate(needsClear, false, true);
    this.events.dispatchEvent(STATE_CHANGED_EVENT);
  }

  toggle() {
    if (!this.planes.length) {
      return false;
    }

    // All are active, or none right now
    const toggleFlag = !this.planes[0].active;

    this.planes.forEach((plane) => plane.active = toggleFlag);
    this.updateState();
    return toggleFlag;
  }

  /**
   * Changes the active state of a section plane.
   *
   * When inactive, the section plane is not applied to the model.
   *
   * @param {SectionPlane} plane - the plane to change active state for
   * @param {boolean} active - new active state
   * @param {boolean} selectPlane - if true, the plane will also become selected, i.e.,
   *                                it will be highlighted and the control gizmo will be attached to it
   */
  setPlaneActive(plane, active, selectPlane = false) {
    const wasActive = plane.active;
    plane.active = active;

    if (selectPlane) {
      this.setActivePlane(plane, true, false);
    }

    this.#applyControlState({ needsUpdateState: false });

    this.analytics.trackPlaneVisibilityToggled(wasActive, active);

    this.updateState();
  }

  /**
   * Return true if the plane exists and is active, false otherwise.
   *
   * @param {SectionPlane|Number} - an instance of type SectionPlane or a plane's index
   */
  isPlaneActive(plane) {
    if (plane instanceof _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane) {
      return plane.active;
    }

    const planeIndex = Number(plane);
    if (!isNaN(planeIndex)) {
      return this.planes[planeIndex].active;
    }

    console.assert('Invalid input type provided');
  }

  /**
   * Legacy compatibility
   * @returns {null}
   */
  getSectionStyle() {
    if (this.activeBox) {
      return 'BOX';
    }if (!this.activePlane) {
      return null;
    }

    const match = Object.entries(_SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.Directions).
    find(([style, normals]) => equalsTolerance(normals.up, this.activePlane.normal) ||
    equalsTolerance(normals.down, this.activePlane.normal));

    return match ? match[0] : null;
  }

  /**
   * Legacy compatibility
   * @param style
   * @param preserveSection
   */
  setSectionStyle(style, preserveSection) {
    console.warn("Automatic placement not supported. See compatibility.md");
  }


  /**
   * Override the unload method to perform some cleanup of operations that were done in load.
   * This function will be invoked when viewer.unloadExtension("Autodesk.SmartSection") is called.
   * @returns {boolean} True if the load was successful. Optionally, the function can return a Promise to indicate success (resolve) or failure (reject).
   * @memberof Autodesk.Viewing.Extensions.SmartSection
   * @private
   */
  unload() {
    super.unload();

    this.deactivate();

    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelAdded);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.onModelRemoved);
    this.viewer.removeEventListener(Autodesk.Viewing.BEFORE_MODEL_UNLOAD_EVENT, this.onModelRemoved);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, this.onModelRootLoaded);
    this.viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, this.onObjectTreeCreated);
    this.viewer.removeEventListener(Autodesk.Viewing.RENDER_FIRST_PIXEL, this.onFirstPixel);
    this.viewer.removeEventListener(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this.onCutPlanesChangeFromAlignment);

    for (const model of this.viewer.getAllModels()) {
      this.#unwatchModelBoxes(model);
    }

    this.viewer.toolController.deregisterTool(this.tool);

    this.viewer.unregisterContextMenuCallback('Autodesk.SmartSection');

    this.gizmo.removeControl();
    this.gizmo = null;
    this.viewer.impl.removeOverlayScene(SMART_SECTION_OVERLAY_KEY);

    this.navAdjustor.clearCachedModels();

    return true;
  }

  /**
   * Override the activate method to enable the functionality of the extension.
   * @see {@link Autodesk.Viewing.Extension#getModes }
   * @param {boolean} [restoreSession=true] - If true (default), will restore the section state from session storage, if available.
   * @returns {boolean} True if the extension activation was successful.
   */
  activate(restoreSession = true) {
    super.activate();

    this.#addEventListeners();
    this.#activateTool();

    this.#enabled = true;

    this.#loadControlState();

    // In case we pick up a cut plane from Hypermodeling, it has the upper hand over the session state.
    const alignmentCutPlanePresent = this.#transferAlignmentCutPlane();
    if (!alignmentCutPlanePresent && restoreSession) {
      this.#restoreSessionState();
    }

    this.#saveControlState();

    this.events.dispatchEvent(SMART_SECTION_ACTIVATED_EVENT);

    return true;
  }

  /**
   * Override the deactivate method to disable the functionality of the extension.
   * @returns {boolean} True if the extension deactivation was successful.
   */
  deactivate() {
    this.cancelMousePlacementMode();
    this.#removeEventListeners();
    this.storeSessionState();
    this.resetState();
    this.#enabled = false;
    this.viewer.impl.setCutPlaneSet(CUT_PLANE_SET, null);
    this.events.dispatchEvent(SMART_SECTION_DEACTIVATED_EVENT);
    this.#deactivateTool();
    super.deactivate();
    return true;
  }

  #activateTool() {
    const controller = this.viewer.toolController;
    const toolName = this.tool.getName();
    const wasLocked = controller.getIsLocked();

    if (wasLocked) {
      controller.setIsLocked(false);
    }

    if (!controller.isToolActivated(toolName)) {
      controller.activateTool(toolName);
    }

    if (wasLocked) {
      controller.setIsLocked(true);
    }
  }

  #deactivateTool() {
    const controller = this.viewer.toolController;
    const toolName = this.tool.getName();
    const wasLocked = controller.getIsLocked();

    if (wasLocked) {
      controller.setIsLocked(false);
    }

    if (controller.isToolActivated(toolName)) {
      controller.deactivateTool(toolName);
    }

    if (wasLocked) {
      controller.setIsLocked(true);
    }
  }

  /**
   * Set a section box around the passed in Box3
   * @param {Box3} box Used to set the section box
   */
  setSectionBox(box) {
    if (!box) {
      return false;
    }

    this.viewer.clearSelection();
    this.activate();

    const transform = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeScale(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z
    ).setPosition(box.min.clone().add(box.max).multiplyScalar(0.5));

    const trueNorthRotation = this.#getTrueNorthRotation(this.viewer.model);
    transform.multiply(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationFromQuaternion(trueNorthRotation));

    const sectionBox = new _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox(this.viewer, { transform: transform });

    this.onBoxAdded(sectionBox);

    this.updateState();

    return true;
  }

  /**
   * Place a section plane on the Intersection.
   * This method will also enable the section tool.
   *
   * @param {THREE.Vector3} normal - plane normal.
   * @param {THREE.Vector3} point - position to place the plane.
   */
  setSectionPlane(normal, point) {
    if (!normal || !point) {
      return;
    }

    this.viewer.clearSelection();
    this.activate();

    this.resetState();

    this.onPlaneAdded(new _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane(point, normal), _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API);

    this.updateState({ forceCenterGizmo: true });
  }

  /**
   * Removes all section planes that are oriented in the xy-plane, given the world up direction.
   *
   * @param {THREE.Vector3} worldUp - normalized world up direction
   */
  removeTopViewSectionPlanes(worldUp = new THREE.Vector3(0, 0, 1)) {
    const sectionPlanesToRemove = new Set();
    this.planes.forEach((sectionPlane) => {
      let angle = worldUp.angleTo(sectionPlane.normal);
      if (angle >= Math.PI) {
        angle -= Math.PI; // support upside down section planes
      }

      const AngleThreshold = 0.05;
      const isTopView = Math.abs(angle) < AngleThreshold;
      if (isTopView) {
        sectionPlanesToRemove.add(sectionPlane);
      }
    });

    if (sectionPlanesToRemove.size === 0) {
      return;
    }

    // delete found section planes now
    const sectionPlanesNew = new Array();
    this.planes.forEach((sectionPlane) => {
      if (sectionPlanesToRemove.has(sectionPlane)) {
        this.removeSection(sectionPlane, false, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API);
      } else {
        sectionPlanesNew.push(sectionPlane);
      }
    });

    this.planes = sectionPlanesNew;

    // update state
    if (this.planes.length === 0) {
      this.resetState();
      this.storeSessionState();
      return;
    }
    this.updateState();
  }

  hasSections() {
    return this.planes.length > 0 || this.activeBox !== null;
  }

  /**
   * Returns Single Section Planes.
   *
   * @param {boolean} excludeInactivePlanes - if true, only active Section Planes are returned. Otherwise all.
   * @returns {Array[Vector4]}
   */
  getSectionPlanes(excludeInactivePlanes = false) {
    return this.planes.
    filter((plane) => !excludeInactivePlanes || this.isPlaneActive(plane)).
    map((plane) => plane.toVector4());
  }

  getSectionBoxPlanes() {
    if (!this.activeBox) {
      return [];
    }
    return this.activeBox.toHessianPlanes();
  }

  // APIs for Section Panel controls

  addSectionPlane(plane) {
    if (plane instanceof _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane) {
      this.onPlaneAdded(plane);
    } else if (Array.isArray(plane)) {
      this.onPlaneAdded(_SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane.fromVector4(new THREE.Vector4().fromArray(plane)));
    } else if (plane instanceof THREE.Vector4) {
      this.onPlaneAdded(_SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane.fromVector4(plane));
    } else {
      throw new Error('Invalid argument: plane must be a Vector4 or an array of 4 numbers');
    }
    this.updateState();
  }

  addSectionBox(box) {
    if (box instanceof _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox) {
      this.onBoxAdded(box, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API);
    } else if (Array.isArray(box)) {
      const planes = box.map((maybePlane, i) => {
        if (Array.isArray(maybePlane)) {
          return maybePlane;
        } else if (maybePlane instanceof THREE.Vector4) {
          return maybePlane.toArray();
        } else {
          throw new Error(`Invalid element at index ${i}: plane must be a Vector4 or an array of 4 numbers`);
        }
      });
      this.onBoxAdded(_SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.fromPlanes(this.viewer, planes), _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API);
    } else if (box instanceof THREE.Box3) {
      const transform = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeScale(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z
      ).setPosition(box.min.clone().add(box.max).multiplyScalar(0.5));

      this.onBoxAdded(new _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox(this.viewer, { transform }), _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API);
    } else if (box instanceof THREE.Matrix4) {
      this.onBoxAdded(new _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox(this.viewer, { transform: box }), _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API);
    } else {
      throw new Error('Invalid argument: box must be a Box3, Matrix4 or an array of 6 planes (as arrays or Vector4)');
    }
    this.updateState();
  }

  /**
   * Sets which section plane is to be controlled by the gizmo.
   *
   * It also defines if the plane's frame and UI list item are highlighted.
   *
   * @param {SectionPlane} activePlane
   * @param {boolean} [clampGizmo=false]
   * @param {boolean} [activate=true]
   */
  setActivePlane(activePlane, clampGizmo = false, activate = !activePlane?.active) {
    if (this.activePlane === activePlane) {
      return;
    }

    if (this.activePlane) {
      this.activePlane.highlightState = _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.HighlightState.NONE;
    }
    this.activePlane = activePlane;

    if (!activePlane) {
      return;
    }

    activePlane.highlightState = _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.HighlightState.ACTIVE;
    if (activate) {
      this.setPlaneActive(activePlane, true);
    } else {
      this.#applyControlState({ needsUpdateState: false });
    }
    // this must be called after the control state is applied,
    // as otherwise the gizmo might be disabled and won't update properly
    this.gizmo.attachToPlane(activePlane, clampGizmo);
    // When supported, makes sure other tools (like measure),
    // deactivate their selections, for better focus on this tool
    this.tool.controller.reportSelectionChange(this.tool);
  }

  removeSection(section, triggerUpdateState = true, analyticsFrom = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.PANEL) {
    if (section instanceof _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane) {
      this.viewer.impl.removeOverlay(SMART_SECTION_OVERLAY_KEY, section.root);
      let idx = this.planes.findIndex((it) => it === section);
      if (idx === -1) {
        return;
      }
      this.planes.splice(idx, 1);
      this.analytics.trackPlaneDeleted(analyticsFrom);

      // auto-select another plane if the removed one was active
      if (section === this.activePlane) {
        if (this.planes.length > 0) {
          let newActivePlane;
          const indexedPlanes = this.planes.map((plane, index) => ({ index, plane }));
          const allVisiblePlanes = indexedPlanes.filter((it) => it.plane.active);
          const firstVisiblePlanes = allVisiblePlanes.filter((it) => it.index < idx);
          if (firstVisiblePlanes.length > 0) {
            // pick the last visible plane before the removed one
            newActivePlane = firstVisiblePlanes[firstVisiblePlanes.length - 1].plane;
          } else if (allVisiblePlanes.length > 0) {
            // pick the first visible plane after the removed one
            newActivePlane = allVisiblePlanes[0].plane;
          } else {// no visible planes => pick the previous one, or the first one
            idx = idx > 0 ? idx - 1 : 0;
            newActivePlane = this.planes[idx];
          }
          this.setActivePlane(newActivePlane, true, false);
        } else {
          this.activePlane = null;
        }
      }
    } else if (section instanceof _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox) {
      this.analytics.trackBoxDeleted(analyticsFrom);
      section.dispose();
      if (section === this.activeBox) {
        this.activeBox = null;
      }
    }

    if (!triggerUpdateState) {
      return;
    }

    if (this.planes.length === 0) {
      this.resetState();
      this.storeSessionState();
      return;
    }

    this.updateState();
  }

  removeActiveSection() {
    const activeSection = this.activePlane || this.activeBox;
    if (!activeSection) {
      return false;
    }
    this.removeSection(activeSection, true, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.KEYBOARD);
    return true;
  }

  /**
   * Cancel the current mouse placement mode listener.
   * Will do nothing if there is no active mouse placement mode
   */
  cancelMousePlacementMode() {
    return this.tool.cancelMousePlacementMode(); // SmartSection tool is not public
  }

  /**
   * Create interactive visualizer for the type of section to place
   *
   * Indicators share the same interface
   *
   * @param {'plane'|'box'} [type='plane'] - The indicator type, defaults to `plane`
   * @param {boolean} [animate=false] - Whether to animate the placement, false by default
   * @param {number} [mode=0] The placement strategy mode, see `Autodesk.Viewing.Extensions.SmartSection.PlacementStrategy`.
   * Defaults to `PLANE_SURFACE_NORMAL` (0).
   * @returns {PlacementPlane|PlacementBox}
   */
  createPlacementIndicator(type = 'plane', animate = false, mode = PlacementStrategy.PLANE_SURFACE_NORMAL) {
    const indicator = type === 'plane' ?
    new _PlacementIndicator_js__WEBPACK_IMPORTED_MODULE_7__.PlacementPlane(this.viewer, { animate }) :
    new _PlacementIndicator_js__WEBPACK_IMPORTED_MODULE_7__.PlacementBox(this.viewer);
    indicator.mode = mode;
    indicator.setTrueNorthRotation(this.#getTrueNorthRotation(this.viewer.model));
    return indicator;
  }

  onContextMenu(menu, event) {
    if (this.options.disableDefaultContextMenu) {
      return;
    }

    const hoveredPlane = this.tool.getNearestHoveredPlane(event) || this.tool.hoveredPlane;
    if (hoveredPlane) {
      menu.push({
        title: 'Delete plane',
        target: () => {
          this.removeSection(hoveredPlane, true, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.CANVAS);
        }
      });
    }

    if (!event.hasSelected) {
      return;
    }

    const menuEntry = { title: 'Section', target: [] };

    const aggregateSelection = this.viewer.getAggregateSelection();

    const modelIds = aggregateSelection.map((selectionObject) => selectionObject.model.id);
    const selected = [];
    for (const perModelSelection of aggregateSelection) {
      const instanceTree = perModelSelection.model.getObjectTree();
      // gather each node that has fragments
      if (!instanceTree) {
        selected.push(perModelSelection.selection);
        continue;
      }
      const dbIds = [];
      perModelSelection.selection.forEach((nodeId) => {
        instanceTree.enumNodeChildren(nodeId, (id) => {
          if (instanceTree.getFragmentCount(id) > 0) {
            dbIds.push(id);
          }
        }, true);
      });

      selected.push(dbIds);
    }

    // hitTest() eventually calls RenderScene.rayIntersect(), which do not handle nested arrays of dbIds for exactly one model
    const intersection = this.viewer.impl.hitTest(event.canvasX, event.canvasY, false, modelIds.length === 1 ? selected.flat() : selected, modelIds);

    const hasSelectedCapMeshes = aggregateSelection.some((it, i) => this._capMeshes.findCapMeshes(it.model.id, selected[i]).length > 0);

    // This case is relevant mostly for hypermodel viewing, when there are 2D planes living in a 3D scene.
    // In this case, it make no sense to allow "section-box" for a plane.
    const isSelected2d = aggregateSelection.length === 1 && aggregateSelection[0].model.is2d();

    if (this.isBoxFeatureAvailable() && !hasSelectedCapMeshes && !isSelected2d) {
      menuEntry.target.push({
        title: 'Section Box',
        target: async () => {
          if (this.tool.isPlacing) {
            this.cancelMousePlacementMode();
          }
          if (!this.isActive()) {
            this.activate(false); // don't restore session state during activation
          }
          const indicator = this.createPlacementIndicator('box', false, PlacementStrategy.BOX_TO_BOUNDING_BOX);
          if (intersection && aggregateSelection) {
            intersection.aggregateSelection = aggregateSelection;
          }
          const section = await indicator.place(intersection || { aggregateSelection });
          indicator.dispose();
          if (section) {
            this.onBoxAdded(section, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.CANVAS);
            this.updateState();
          }
        }
      });
    }

    const modelIndex = modelIds.findIndex((id) => id === intersection?.modelId);
    const isValidIntersection = intersection?.face?.normal && intersection.model && selected[modelIndex].indexOf(intersection.dbId) !== -1;
    if (!hasSelectedCapMeshes && isValidIntersection) {
      menuEntry.target.push({
        title: 'Section Plane',
        target: async () => {
          if (this.tool.isPlacing) {
            this.cancelMousePlacementMode();
          }
          if (!this.isActive()) {
            this.activate(false); // don't restore session state during activation
          }
          const indicator = this.createPlacementIndicator('plane', false, PlacementStrategy.PLANE_SURFACE_NORMAL);
          const section = await indicator.place(intersection);
          indicator.dispose();
          if (section) {
            if (this.activeBox) {
              this.resetState();
            }
            this.onPlaneAdded(section, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.CANVAS);
            this.updateState();
          }
        }
      });
    }

    // Don't add the menu entry if no section options are available
    if (menuEntry.target.length > 0) {
      menu.push(menuEntry);
    }
  }

  /**
   * Callback method to enter placement mode from UI panel
   * @param {string} type 'box' | 'plane'
   * @param {object} options Optional parameters
   * @param {number} options.placementStrategy Optional, see `Autodesk.Viewing.PlacementStrategy`
   * @param {boolean} options.animate Optional, defaults to true. Animates the placement of the section plane. SectionBox has no animation
   * @return {Promise<SectionPlane>}
   */
  async enterMousePlacementMode(type, options = {}) {

    if (this.activeBox && type === 'box') {
      console.info('Only one section box allowed at a time');
      return;
    }

    if (this.isMaxLimitSectionPlanesReached()) {
      console.info('Only 6 section planes allowed at a time');
      return;
    }

    this.#cancelOtherTools();

    const result = await this.tool.enterMousePlacementMode({
      type,
      placementStrategy: options?.placementStrategy,
      animate: options?.animate
    });

    if (result instanceof _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane) {
      this.onPlaneAdded(result, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.PANEL);
    } else if (result instanceof _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox) {
      this.onBoxAdded(result, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.PANEL);
    } else {
      return;
    }

    this.updateState();

    return result;
  }

  getPlacementStrategy() {
    return this.tool.getPlacementStrategy();
  }

  /**
   * Serializes current SmartSection Section Planes or Section Box into ViewerState 2.0 fields.
   */
  toViewerStateV2(viewerState) {
    this.getToolState(viewerState, "1.0.0");

    this.getRenderingState(viewerState.cutplanes, "1.0.0");

    // ViewerState v2 has a single `cutplanes` array, but not all active cutplanes are owned by SmartSection.
    // The viewer also maintains a "default" cutplane set (`__set_view`) that can be populated by other
    // features/APIs (e.g. `viewer.setCutPlanes`) and should be preserved when exporting/restoring ViewerState.
    // Tool state alone (`autodesk.viewer:section-1.0.0`) would miss these, so we append them manually.
    const planesFromDefaultCutplaneSet = this.viewer.impl.getCutPlaneSet('__set_view');
    planesFromDefaultCutplaneSet.forEach((plane) => viewerState.cutplanes.push(plane.toArray()));
  }

  /**
   * Writes the current SmartSection tool state into the provided ViewerState root.
   *
   * See https://git.autodesk.com/BIM360/visualization-schemas/blob/main/autodesk.viewer_section-1.0.0.yaml
   *
   * @param {{ [key:string]: any }} root - Root object in which the SmartSection tool state is recorded.
   * @param {string} version - Supported: "1.0.0". Others will throw.
   * @param {?import('../../src/application/CoordinateSystem').CoordinateSystem} [coordinateSystem]
   *        Optional helper to transform planes into the target coordinate system before serialization.
   * @returns {void}
   */
  getToolState(root, version, coordinateSystem) {
    if (!this.hasSections()) {
      return;
    }

    if (version !== "1.0.0") {
      throw new Error(`Unsupported version: ${version}`);
    }

    const sectionToolState = root[this.TOOL_SCHEMA] = {};

    const sectionPlanes = this.getSectionPlanes();

    if (sectionPlanes.length > 0) {
      coordinateSystem?.transformSectionPlanesToCS(sectionPlanes);
      const planes = sectionToolState['planes'] = [];
      for (let i = 0; i < sectionPlanes.length; ++i) {
        const sectionPlane = sectionPlanes[i];
        const planeJSON = {
          "plane": sectionPlane.toArray()
        };
        if (!this.isPlaneActive(i)) {
          Object.assign(planeJSON, { "active": false });
        }
        planes.push(planeJSON);
      }
      return;
    }

    const boxPlanes = this.getSectionBoxPlanes();
    if (boxPlanes.length > 0) {
      coordinateSystem?.transformSectionPlanesToCS(boxPlanes);
      const boxPlanesArray = boxPlanes.map((boxPlane) => boxPlane.toArray());
      const box_transformed = _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.fromPlanes(this.viewer, boxPlanesArray);
      const position = box_transformed.object.getWorldPosition();
      const scale = box_transformed.object.getWorldScale();
      const halfSize = scale.clone().multiplyScalar(0.5);
      const min = position.clone().sub(halfSize);
      const max = position.clone().add(halfSize);
      const rotation = box_transformed.rotation();

      const boxes = sectionToolState['boxes'] = [];
      boxes.push({
        "min": min.toArray(),
        "max": max.toArray(),
        "rotation": rotation.toArray()
      });
    }
  }

  /**
   * Writes SmartSection's current rendering state (section planes) into the provided array root.
   * Intended for the viewer state's rendering section (e.g., an array that aggregates active cut planes).
   *
   * @param {Array<number[]>} sectionPlanesRoot - Destination array to which plane arrays are appended.
   * @param {string} version - Supported: "1.0.0". Others will throw.
   * @param {?import('../../src/application/CoordinateSystem').CoordinateSystem} [coordinateSystem]
   *        Optional helper to transform planes into the target coordinate system before serialization.
   * @returns {void}
   */
  getRenderingState(sectionPlanesRoot, version, coordinateSystem) {
    if (!this.hasSections()) {
      return;
    }

    if (version !== "1.0.0") {
      throw new Error(`Unsupported version: ${version}`);
    }

    let planes = this.getSectionPlanes(true);
    if (planes.length > 0) {
      coordinateSystem?.transformSectionPlanesToCS(planes);
      planes.forEach((plane) => sectionPlanesRoot.push(plane.toArray()));
      return;
    }

    planes = this.getSectionBoxPlanes();
    if (planes.length > 0) {
      coordinateSystem?.transformSectionPlanesToCS(planes);
      planes.forEach((plane) => sectionPlanesRoot.push(plane.toArray()));
    }
  }

  /**
   * Restores the SmartSection tool state from the provided ViewerState root.
   *
   * Expects schema at key "autodesk.viewer:section-1.0.0" with either:
   * - planes: [{ plane: [x, y, z, w] }, ...] to restore section planes, or
   * - boxes: [{ min: [x, y, z], max: [x, y, z], rotation: [x, y, z, w] }, ...]
   *          to restore one or multiple section boxes.
   *
   * See https://git.autodesk.com/BIM360/visualization-schemas/blob/main/autodesk.viewer_section-1.0.0.yaml
   *
   * @param {{ [key:string]: any }|undefined} sectionToolState - The state as per "autodesk.viewer:section-1.0.0" schema
   * @param {string} version - Supported: "1.0.0". Others will throw.
   * @param {?import('../../src/application/CoordinateSystem').CoordinateSystem} [coordinateSystem]
   *        Optional coordinate system helper used to transform planes from the saved CS.
   * @returns {void}
   */
  restoreToolState(sectionToolState, version, coordinateSystem) {
    if (version !== "1.0.0") {
      throw new Error(`Unsupported version: ${version}`);
    }

    if (!sectionToolState) {
      this.resetState();
      return;
    }

    const planes = sectionToolState['planes'];
    const boxes = sectionToolState['boxes'];

    // Observe that the property "active" is optional
    const hasActivePlanes = planes?.length > 0 && !planes.every((p) => p.active === false);
    const hasBoxes = boxes?.length > 0;
    if ((hasActivePlanes || hasBoxes) && !this.isActive()) {
      this.activate(false);
    }

    // if we are restoring the same tool state, there is no need to notify listeners with a CUTPLANES_CHANGE_EVENT - addresses VIZX-5016
    // however, we still need to run through the reset and update logic in order for smart section to work properly
    const modelChanged = this.viewer.model !== this.lastRestoredStateModel;
    const fireEvent = !this.hasSections() || modelChanged;
    this.lastRestoredStateModel = this.viewer.model;

    this.resetState(false, fireEvent);

    if (planes) {
      const indices = sectionToolState._savedPlaneIndices || [];
      const planesVec4 = [];
      const states = [];
      for (const planeObj of planes) {
        const planeVec4 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector4().fromArray(planeObj.plane);
        planesVec4.push(planeVec4);
        states.push({ active: planeObj.active ?? true, index: indices.shift() });
      }
      coordinateSystem?.transformSectionPlanesFromCS(planesVec4);
      this.setSectionPlanes(planesVec4, states, fireEvent);
    }

    if (boxes) {
      boxes.forEach((boxObj) => {
        const min = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().fromArray(boxObj.min);
        const max = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3().fromArray(boxObj.max);
        const rotation = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion().fromArray(boxObj.rotation);
        const box = _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.fromMinMaxRotation(this.viewer, min, max, rotation);
        const boxPlanes = box.toHessianPlanes();
        coordinateSystem?.transformSectionPlanesFromCS(boxPlanes);
        const boxPlanesArray = boxPlanes.map((boxPlane) => boxPlane.toArray());
        const box_transformed = _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.fromPlanes(this.viewer, boxPlanesArray);
        this.onBoxAdded(box_transformed, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API, fireEvent);
      });
      // this is called inside setSectionPlanes, but for boxes it must be called explicitly
      this.updateState({ fireEvent: fireEvent });
    }

    // When active, this already happens inside updateState()
    if (!this.isActive()) {
      this.updateViewerCutPlanes(fireEvent);
    }
  }

  /**
   * Restores SmartSection state from ViewerState
   */
  fromViewerState(cutplanes) {
    if (cutplanes.length === 0) {
      this.resetState();
      return;
    }

    if (!this.isActive()) {
      this.activate(false);
    }

    // 6 planes define a box
    if (_SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.formsValidBox(cutplanes)) {
      // the order is not guaranteed to be correct for V2 Viewer states, so let's fix it here
      const orderedPlanes = _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.normalizeOrder(cutplanes);
      this.addSectionBox(orderedPlanes);
      return;
    }

    this.setSectionPlanes(cutplanes);
  }

  /**
   * Initializes SmartSection from the viewer's default cutplane set.
   *
   * @param {(THREE.Vector4|{x:number,y:number,z:number,w:number})[]} planesFromViewer - Array of planes from the viewer's default set.
   * @param {Boolean} [fireEvent] - if set to false the av.CUTPLANES_CHANGE_EVENT event will not be fired.
   * @param {Boolean|undefined} [isSectionBox] - to set 6 planes as a box. When undefined, it
   * will try to create a box from 6 planes automatically.
   */
  fromViewerDefaultCutplaneSet(planesFromViewer, fireEvent = true, isSectionBox) {
    const numPlanes = planesFromViewer?.length || 0;

    // No planes: clear SmartSection state
    if (numPlanes === 0) {
      this.resetState();
      return;
    }

    if (numPlanes > 6) {
      console.warn('Too many planes in the default cutplane set');
      return;
    }

    if (!this.isActive()) {
      this.activate(false);
    }

    // Normalize into THREE.Vector4 for internal APIs
    const toVector4 = (p) => p instanceof three__WEBPACK_IMPORTED_MODULE_0__.Vector4 ? p : new three__WEBPACK_IMPORTED_MODULE_0__.Vector4(p.x, p.y, p.z, p.w);
    const planesAsV4 = planesFromViewer.map(toVector4);

    // 6 planes → attempt to interpret 6 planes as a SectionBox
    // If interpretation fails, fall back to 6 individual planes.
    if ((typeof isSectionBox !== 'boolean' || isSectionBox) && _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.formsValidBox(planesAsV4)) {
      const orderedPlanes = _SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.SectionBox.normalizeOrder(planesAsV4);
      this.addSectionBox(orderedPlanes);
    } else {
      // Could not interpret as a valid box → use planes as individual planes
      this.setSectionPlanes(planesAsV4);
    }

    this.updateViewerCutPlanes();

    // fire event of changed Viewer default CutPlaneSet
    if (fireEvent) {
      this.viewer.dispatchEvent({ type: Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, planes: planesFromViewer });
    }
  }

  #restoreSessionState() {
    const key = this.#getSessionKey();
    const root = this._sessionState.get(key);
    if (!root) {
      return false;
    }

    this.restoreToolState(root[this.TOOL_SCHEMA], "1.0.0");
    return true;
  }

  storeSessionState() {
    const key = this.#getSessionKey();
    const root = {};
    this.getToolState(root, "1.0.0");

    if (!root[this.TOOL_SCHEMA]) {
      this._sessionState.delete(key);
      return;
    }
    root[this.TOOL_SCHEMA]._savedPlaneIndices = this.planes.map((p) => p.index);

    this._sessionState.set(key, root);
  }

  /**
   * Creates an order-independent hash of the currently displayed viewable(s).
   *
   * @returns {String}
   */
  #getSessionKey() {
    const allModelKeys = this.viewer.getVisibleModels().
    filter((model) => model.is3d() && model.getDocumentNode()).
    map(_NavAdjustor_js__WEBPACK_IMPORTED_MODULE_4__.getViewableKey);
    return allModelKeys.sort().join('|');
  }

  /**
   * Updates the viewer's cut plane set based on the current box or planes.
   * @private
   */
  updateViewerCutPlanes(fireEvent = true, skipUpdateCapMeshes = false) {
    const planes = this.activeBox?.toHessianPlanes() || this.planes.filter((it) => it.active).map((it) => it.toVector4());

    this.viewer.impl.setCutPlaneSet(CUT_PLANE_SET, planes, fireEvent);

    if (!skipUpdateCapMeshes) {
      this.updateCapMeshes();
    }

    this.viewer.impl.invalidate(false, false, true);
  }

  /**
   * Called when modifying the planes
   * TODO should maybe break up the box and section plane updating logic
   * @private
   */
  updateState({ skipStoreSessionState = false, forceCenterGizmo = false, clampGizmo = false, fireEvent = true, skipCapMeshes = false } = {}) {
    if (!skipStoreSessionState) {
      this.storeSessionState();
    }

    if (!this.isActive() || !this.hasSections()) return;

    this.navAdjustor.calculateOptimizedModelOBB(this.viewer);

    this.#updatePlaneFrameWidth();

    // updating all planes here?
    for (let i = 0; i < this.planes.length; i++) {
      const plane = this.planes[i];
      const result = this.navAdjustor.sliceSingleHalfSpace(this.viewer, plane);
      if (result?.bounds) {
        plane.updateMeshFromBounds(result);
      }
    }

    this.updatePlaneSizing();

    if (this.activePlane) {
      if (forceCenterGizmo) {
        this.activePlane.root.updateMatrixWorld();
        this.activePlane.origin = this.activePlane.root.position;
        this.gizmo.attachToPlane(this.activePlane, false, forceCenterGizmo);
      }
      if (clampGizmo) {
        this.gizmo.followMe(this.viewer.getCamera(), this.activePlane);
      }
    }

    this.viewer.impl.setCutplanesHideInterior(this?.activeBox?.inverted);

    this.updateViewerCutPlanes(fireEvent, skipCapMeshes);

    this.events.dispatchEvent(STATE_CHANGED_EVENT);
  }

  setCapMeshesEnabled(enabled, forceUpdate = false, analyticsFrom) {
    if (!forceUpdate && this.#controlState.hatchesEnabled === Boolean(enabled)) {
      return;
    }
    this.#controlState.hatchesEnabled = Boolean(enabled);
    if (enabled) {
      if (!this.viewer.hasEventListener(Autodesk.Viewing.RENDER_OPTION_CHANGED_EVENT, this._capMeshes.onRenderOptionChanged)) {
        this.viewer.addEventListener(Autodesk.Viewing.RENDER_OPTION_CHANGED_EVENT, this._capMeshes.onRenderOptionChanged);
      }
    } else {
      this.viewer.removeEventListener(Autodesk.Viewing.RENDER_OPTION_CHANGED_EVENT, this._capMeshes.onRenderOptionChanged);
    }
    this.updateCapMeshes();
    this.#saveControlState();

    analyticsFrom && this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_HATCHES_TOGGLED, enabled, analyticsFrom);
  }

  updateCapMeshes() {
    const needsClear = this._capMeshes.clear();

    if (!this.#controlState.hatchesEnabled) {
      needsClear && this.viewer.impl.invalidate(true, false, true);
      return;
    }

    if (this.planes.length > 0) {
      const activePlanes = this.planes.filter((it) => it.active);
      this._capMeshes.update(activePlanes.map((plane) => new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setComponents(...plane.toVector4().toArray())));
      needsClear && this.viewer.impl.invalidate(true, false, true);
      return;
    }

    if (this.activeBox) {
      this._capMeshes.update(this.activeBox.toHessianPlanes().map((plane) => new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setComponents(...plane.toArray())));
      needsClear && this.viewer.impl.invalidate(true, false, true);
    }
  }

  onCameraChanged(e) {
    if (this.followMeEnabled && this.activePlane) {
      this.gizmo.followMe(e.camera, this.activePlane);
    }
    this.activeBox?.onCameraChanged(e.camera);
    this.tool?.onCameraChanged();
    this.updatePlaneSizing();
  }

  updatePlaneSizing() {
    if (this.planeDisplayMode !== SmartSectionExtension.PLANE_DISPLAY_MODES.SCREEN_SPACE) {
      return;
    }

    // constant base plane width
    const BASE_WIDTH = 0.02;

    // update bounds sizing
    this.planes.forEach((plane) => {
      const camera = this.viewer.getCamera();
      const distance = plane.plane.projectPoint(camera.position).distanceTo(camera.position);
      const newOuter = distance * BASE_WIDTH * (camera.fov * Math.PI / 180);
      plane.setOuterWidth(Math.min(newOuter, _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane.OUTER_WIDTH));
    });
  }

  getMaxNumberSectionPlanes() {
    return this.#maxNumberSectionPlanes;
  }

  isMaxLimitSectionPlanesReached() {
    return this.planes.length === this.#maxNumberSectionPlanes;
  }

  /**
   * Adds a new Section Box and syncs UI with it.
   *
   * @param {SectionBox} box
   * @param {string} analyticsFrom - Source of creation (panel, canvas, api)
   * @private
   */
  onBoxAdded(box, analyticsFrom, fireEvent = true) {
    this.resetState(false, fireEvent); // only one box allowed

    box.initializeSectionBoxTool();
    this.activeBox = box;

    // If tool is not active, ensure overlay and gizmos are hidden
    if (!this.isActive()) {
      this.activeBox.visible = false;
      this.activeBox.setGizmoEnabled(false);
    } else {
      // TODO: This calculation should be added for planes in
      // https://autodesk.atlassian.net/browse/VIZX-3407
      const params = this.navAdjustor.getParameters(this.viewer, this.activeBox);
      params?.pivot && this.viewer.navigation.setPivotPoint(params.pivot);
    }

    box.events.addEventListener(_SectionBox_js__WEBPACK_IMPORTED_MODULE_6__.BOX_STATE_CHANGED_EVENT.type, this.onBoxToolChanged);
    this.#applyControlState();

    this.analytics.trackBoxCreated(analyticsFrom);
    this.events.dispatchEvent({ ...UI_SELECT_TAB_EVENT, tab: 'box' });
  }

  /**
   * Adds a new Section Plane and syncs UI with it.
   *
   * @param {SectionPlane} plane
   * @param {string} analyticsFrom - Source of creation (panel, canvas, api)
   * @private
   */
  onPlaneAdded(plane, analyticsFrom, setAsActive = true) {
    // Assign the next sequential index if one was not already provided (e.g. by restoreToolState).
    plane.index ??= (this.planes.map((p) => p.index).pop() ?? 0) + 1;
    this.planes.push(plane);

    if (this.isActive()) {
      this.viewer.impl.addOverlay(SMART_SECTION_OVERLAY_KEY, plane.root);
      setAsActive && this.setActivePlane(plane, false, false);
    }

    this.analytics.trackPlaneCreated(analyticsFrom);
    this.events.dispatchEvent({ ...UI_SELECT_TAB_EVENT, tab: 'plane' });
  }

  #initGizmosAndTools() {
    this.gizmo = new _SmartGizmo_js__WEBPACK_IMPORTED_MODULE_2__["default"](this.viewer, this);
    this.gizmo.init();

    this.tool = new _SmartSectionTool_js__WEBPACK_IMPORTED_MODULE_1__.SmartSectionTool(this.viewer, {
      delegate: this,
      gizmo: this.gizmo
    });
    this.viewer.toolController.registerTool(this.tool);
  }

  onSceneUpdated({ objectsMoved }) {
    if (objectsMoved) {
      this.updateCapMeshes();
    }
  }

  onCutPlanesChange() {
    this.events.dispatchEvent(UI_CUTPLANES_CHANGED_EVENT);
    // update materials for cap meshes
    if (this.isActive() && this.#controlState.hatchesEnabled) {
      this._capMeshes.onCutPlanesChange();
    }
  }

  onCutPlanesChangeFromAlignment = () => {
    if (this.viewer.impl.getCutPlaneSet(_ModelSheetTransition_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_9__.MODEL_SHEET_SECTION_SET).length === 0) {
      return;
    }
    if (this.isActive()) {
      this.#transferAlignmentCutPlane();
      return;
    }
    this.activate(false); // activate() already transfers internally
  };

  onFloorSelectorSelectionSettled() {
    if (this.isActive() && this.#controlState.hatchesEnabled) {
      this.updateCapMeshes();
    }
  }

  /**
   * Sets the Section Tool to the given section planes.
   * If an empty array is provided, the section tool will have no section planes.
   *
   * @param {Array<THREE.Vector4>} sectionPlanes - Array of planes in Hessian form
   * @param {Array<{ active: boolean|undefined; index: number|undefined }>} [states] - optional: Array of planes containing the active state and index
   *
   * @todo If going public (APS), make sure states are documented/safeguarded and the "index" behavior is clear.
   * @private
   */
  setSectionPlanes(sectionPlanes, states, fireEvent = true) {
    this.resetState(false, fireEvent);

    states = Array.isArray(states) && states.length === sectionPlanes.length ? states : undefined;

    for (let i = 0; i < sectionPlanes.length; ++i) {
      const planeVector4 = Array.isArray(sectionPlanes[i]) ? new three__WEBPACK_IMPORTED_MODULE_0__.Vector4().fromArray(sectionPlanes[i]) : sectionPlanes[i];
      const sectionPlane = _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane.fromVector4(planeVector4);
      const state = states?.[i];
      sectionPlane.active = state ? state.active === true : true;
      sectionPlane.index = state?.index;
      this.onPlaneAdded(sectionPlane, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API, false);
    }
    if (this.isActive() && !this.activePlane) {
      const iActivePlane = this.planes.findIndex((it) => it.active);
      this.setActivePlane(this.planes[iActivePlane], false, false);
    }

    // clamp gizmo after updating the plane bounds to get the correct size for clamping
    this.updateState({ clampGizmo: true, fireEvent: fireEvent });
  }

  /**
   * If the user starts another tool while we're in placement mode, we should cancel placement to avoid conflicting tool interactions.
   */
  onViewerToolChanged(e) {
    if (!e?.active) {
      return;
    }

    // Only relevant while SmartSection is active and awaiting a placement click.
    if (!this.#enabled || !this.tool?.isPlacing) {
      return;
    }

    const startedToolName = e.toolName;
    const smartSectionToolName = this.tool.getName?.();

    // Ignore activations of our own tool (and internal helpers).
    if (startedToolName === smartSectionToolName || startedToolName === 'SectionBoxTool' || startedToolName === 'intercept') {
      return;
    }

    this.cancelMousePlacementMode();
  }

  onShowAll() {
    this.deactivate();
  }

  #addEventListeners() {
    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);
    this.viewer.addEventListener(Autodesk.Viewing.SCENE_UPDATED_EVENT, this.onSceneUpdated);
    this.viewer.addEventListener(Autodesk.Viewing.SHOW_ALL_EVENT, this.onShowAll);

    this.viewer.addEventListener(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this.onCutPlanesChange);
    this.viewer.addEventListener(SELECTION_SETTLED_EVENT, this.onFloorSelectorSelectionSettled);
    this.viewer.addEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this.onViewerToolChanged);
  }

  #removeEventListeners() {
    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);
    this.viewer.removeEventListener(Autodesk.Viewing.SCENE_UPDATED_EVENT, this.onSceneUpdated);
    this.viewer.removeEventListener(Autodesk.Viewing.SHOW_ALL_EVENT, this.onShowAll);
    this.viewer.removeEventListener(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this.onCutPlanesChange);
    this.viewer.removeEventListener(SELECTION_SETTLED_EVENT, this.onFloorSelectorSelectionSettled);
    this.viewer.removeEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this.onViewerToolChanged);
  }

  static PLANE_DISPLAY_MODES = {
    SCREEN_SPACE: 0,
    WORLD_SPACE: 1
  };

  setFrameVisible(visible, analyticsFrom = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API) {
    this.#controlState.plane.visible = visible;
    this.#applyControlState({ needsUpdateState: true });
    this.#saveControlState();
    this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_TOGGLED, visible, analyticsFrom);
  }

  setRotationEnabled(enabled, analyticsFrom = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API) {
    const newMode = enabled ? GIZMO_MODE.ROTATE : GIZMO_MODE.TRANSLATE;
    const stateChanged = this.#controlState.gizmoMode !== newMode;
    if (!stateChanged) return;
    this.#controlState.gizmoMode = newMode;
    this.#applyControlState();
    this.#saveControlState();
    this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_ROTATE_TOGGLED, enabled, analyticsFrom);
  }

  setBoxVisible(visible, analyticsFrom = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API) {
    this.#controlState.box.visible = visible;
    this.#applyControlState({ needsUpdateState: true });
    this.#saveControlState();
    this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_TOGGLED, visible, analyticsFrom);
  }

  setGizmoEnabled(enabled, analyticsFrom = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API) {
    this.#controlState.gizmoEnabled = enabled;
    this.#applyControlState({ needsUpdateState: true });
    this.#saveControlState();
    this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_GIZMO_TOGGLED, enabled, analyticsFrom);
  }

  setAlignTrueNorthEnabled(enabled, analyticsFrom = _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API) {
    this.#controlState.alignTrueNorthEnabled = Boolean(enabled);
    this.#applyControlState({ needsUpdateState: true });
    this.#saveControlState();
    this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_ALIGN_TRUE_NORTH_TOGGLED, enabled, analyticsFrom);
  }

  #applyControlState({ needsUpdateState = false, forceUpdateCapMeshes = false } = {}) {
    this.setCapMeshesEnabled(this.#controlState.hatchesEnabled, forceUpdateCapMeshes);

    if (this.tool?.placementIndicator) {
      this.tool.placementIndicator.setTrueNorthRotation(this.#getTrueNorthRotation(this.viewer.model));
    }

    if (!(this.isActive() && this.hasSections())) {
      return;
    }
    if (this.activeBox) {
      this.activeBox.visible = this.#controlState.box.visible;
      this.activeBox.setRotateEnabled(this.#getEffectiveGizmoMode() === GIZMO_MODE.ROTATE);
      this.activeBox.setGizmoEnabled(this.#controlState.gizmoEnabled);
    } else if (this.planes.length > 0) {
      this.planes.forEach((it) => it.root.visible = it.active && this.#controlState.plane.visible);
      this.planes.forEach((it) => it.setTrueNorthRotation(this.#getTrueNorthRotation(this.viewer.model)));
      this.gizmo.transControl.mode = this.#getEffectiveGizmoMode();
      this.gizmo.setGizmoEnabled(this.activePlane?.active && this.#controlState.gizmoEnabled);
    }
    if (needsUpdateState) this.updateState({ skipStoreSessionState: true, skipCapMeshes: true });
  }

  /**
   * The gizmo mode from the control state, inverted while the tool is SHIFT toggling.
   * @returns {string}
   */
  #getEffectiveGizmoMode() {
    const mode = this.#controlState.gizmoMode;
    if (this.isGizmoEnabled() && this.tool?.isShiftToggling()) {
      return mode === GIZMO_MODE.ROTATE ? GIZMO_MODE.TRANSLATE : GIZMO_MODE.ROTATE;
    }
    return mode;
  }

  /**
   * Applies the (temporarily inverted) gizmo mode, after the tool's SHIFT toggling state changed.
   *
   * @param {boolean} toggle
   * @param {string} [analyticsFrom]
   */
  toggleRotation(toggle, analyticsFrom) {
    if (!(this.isActive() && this.hasSections() && this.isGizmoEnabled())) {
      return;
    }

    this.#applyControlState();

    if (toggle) {
      this.analytics.trackToggle(_SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.ACTIONS.SECTION_ROTATE_TOGGLED, this.#getEffectiveGizmoMode() === GIZMO_MODE.ROTATE, analyticsFrom);
    }
  }

  #loadControlState() {
    const controlStateString = avp.LocalStorage.getItem(CUT_PLANE_SET + '.controlState');
    if (controlStateString === null) {
      return;
    }

    this.#controlState = JSON.parse(controlStateString);

    // verify state (ignore old versions)
    if (!this.#controlState?.gizmoMode) {
      console.warn('Invalid control state found in local storage. Resetting to defaults.');
      this.#resetControlState();
    }

    this.#applyControlState({ forceUpdateCapMeshes: true });
  }

  #saveControlState() {
    avp.LocalStorage.setItem(CUT_PLANE_SET + '.controlState', JSON.stringify(this.#controlState));
  }

  #resetControlState() {
    this.#controlState = Object.assign({}, DEFAULT_CONTROL_STATE, {
      plane: Object.assign({}, DEFAULT_CONTROL_STATE.plane),
      box: Object.assign({}, DEFAULT_CONTROL_STATE.box)
    });
  }

  isBoxFeatureAvailable() {
    return this.#boxFeatureAvailable;
  }

  /**
   * In order to calculate fragment OBBs, we need the instance tree or the dbId2fragId map. If none of these are available, the box feature is disabled.
   * Will fire a SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT event if the availability changes.
   */
  #updateBoxFeatureAvailability() {
    const models = this.viewer.getVisibleModels().filter((model) => model.is3d());
    const dbId2fragIdAvailable = models.length > 0 && models.every((model) => model.getFragmentList()?.fragments?.dbId2fragId?.length > 0);
    const instanceTreeAvailable = models.length > 0 && models.every((model) => model.getObjectTree());
    const boxFeatureAvailable = dbId2fragIdAvailable || instanceTreeAvailable;
    if (boxFeatureAvailable !== this.#boxFeatureAvailable) {
      this.#boxFeatureAvailable = boxFeatureAvailable;
      this.events.dispatchEvent({ type: SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT, boxFeatureAvailable });
    }
  }

  /**
   * Returns the true north rotation for the given model if align true north is enabled, otherwise returns the identity quaternion
   * @param {Model} model The model to get the true north rotation for
   * @returns {Quaternion} The true north rotation or the identity quaternion if align true north is disabled
   */
  #getTrueNorthRotation(model) {
    if (!this.#controlState.alignTrueNorthEnabled) {
      return new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
    }

    const trueNorthAngle = model?.getMetadata("custom values")?.angleToTrueNorth ?? 0;
    const radians = trueNorthAngle * (Math.PI / 180);
    return new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion().setFromAxisAngle(this.viewer.navigation.getWorldUpVector(), radians);
  }

  /**
   * If there is an alignment present, transfers the cut plane from the Hypermodeling to the section tool.
   * @returns {boolean} True if alignment cut plane was transferred, false otherwise
   */
  #transferAlignmentCutPlane() {
    const alignmentCutPlanes = this.viewer.impl.getCutPlaneSet(_ModelSheetTransition_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_9__.MODEL_SHEET_SECTION_SET);
    const bounds = this.viewer.impl.getVisibleBounds(true, true);

    if (!alignmentCutPlanes || alignmentCutPlanes.length === 0 || bounds.isEmpty()) {
      return false;
    }

    const hessian = alignmentCutPlanes[0];

    // The alignment cut plane is stored as a Hessian Vector4 in viewer space. We cannot use
    // SectionPlane.fromVector4() here: it places the gizmo at -w * normal (nearest point on the
    // plane to the world origin), which preserves the cut but puts the overlay on the wrong
    // height/location relative to the model. Instead, normalize the equation via THREE.Plane
    // and pick a coplanar anchor by projecting the visible model center onto that plane.
    const plane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setComponents(hessian.x, hessian.y, hessian.z, hessian.w).normalize();
    const normal = plane.normal.clone();
    const center = bounds.getCenter(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3());
    const origin = center.addScaledVector(normal, -plane.distanceToPoint(center));
    const sectionPlane = new _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.SectionPlane(origin, normal);

    // remove cut plane from the alignment while section tool is active so it doesn't interfere
    this.viewer.impl.setCutPlaneSet(_ModelSheetTransition_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_9__.MODEL_SHEET_SECTION_SET, null);

    this.resetState();
    this.onPlaneAdded(sectionPlane, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_10__.FROM.API, true);
    this.updateState({ forceCenterGizmo: true });

    return true;
  }
}

function equalsTolerance(a, b, EPSILON = 1E-6) {
  return a.clone().sub(b).length() < EPSILON;
}


namespace.SmartSectionExtension = SmartSectionExtension;
av.theExtensionManager.registerExtension('Autodesk.SmartSection', SmartSectionExtension);

/***/ },

/***/ "./extensions/SmartSection/SmartSectionAnalytics.js"
/*!**********************************************************!*\
  !*** ./extensions/SmartSection/SmartSectionAnalytics.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ACTIONS: () => (/* binding */ ACTIONS),
/* harmony export */   ADJUSTMENT_TYPES: () => (/* binding */ ADJUSTMENT_TYPES),
/* harmony export */   EVENT_NAME: () => (/* binding */ EVENT_NAME),
/* harmony export */   FROM: () => (/* binding */ FROM),
/* harmony export */   SmartSectionAnalytics: () => (/* binding */ SmartSectionAnalytics),
/* harmony export */   TYPE: () => (/* binding */ TYPE),
/* harmony export */   trackBoxAdjusted: () => (/* binding */ trackBoxAdjusted)
/* harmony export */ });
const avp = Autodesk.Viewing.Private;

const EVENT_NAME = 'viewer.advancedSection';

const ACTIONS = {
  SECTION_CREATED: 'section_created',
  SECTION_PLACEMENT_CANCELLED: 'section_placement_cancelled',
  SECTION_DELETED: 'section_deleted',
  SECTION_CLEARED: 'section_cleared',
  SECTION_VISIBILITY_TOGGLED: 'section_visibility_toggled',
  SECTION_TOGGLED: 'section_toggled',
  SECTION_GIZMO_TOGGLED: 'section_gizmo_toggled',
  SECTION_ROTATE_TOGGLED: 'section_rotate_toggled',
  SECTION_HATCHES_TOGGLED: 'section_hatches_toggled',
  SECTION_ALIGN_TRUE_NORTH_TOGGLED: 'section_align_true_north_toggled',
  SECTION_ADJUSTED: 'section_adjusted',
  SECTION_TOOL_OPENED: 'section_tool_opened',
  SECTION_TOOL_CLOSED: 'section_tool_closed'
};

const FROM = {
  PANEL: 'panel',
  CANVAS: 'canvas',
  API: 'api',
  KEYBOARD: 'keyboard',
  TOOLBAR: 'toolbar'
};

const TYPE = {
  PLANE: 'plane',
  BOX: 'box'
};

const ADJUSTMENT_TYPES = {
  MOVE: 'move',
  PUSH_PULL: 'push_pull',
  ROTATE: 'rotate',
  CHANGE_DIRECTION_GIZMO: 'change_direction_gizmo'
};

function sendAnalytics(from, type, action, metadata = {}) {
  avp.analytics.track(EVENT_NAME, {
    from: from,
    type: type,
    action: action,
    metadata: metadata
  });
}

class SmartSectionAnalytics {
  constructor(extension) {
    this.extension = extension;
  }

  #send(from, type, action, metadata = {}) {
    sendAnalytics(from, type, action, metadata);
  }

  trackPlaneCreated(from) {
    if (!from) return;
    this.#send(
      from,
      TYPE.PLANE,
      ACTIONS.SECTION_CREATED,
      {
        count: this.extension.planes.length
      }
    );
  }

  trackBoxCreated(from) {
    if (!from) return;
    this.#send(
      from,
      TYPE.BOX,
      ACTIONS.SECTION_CREATED,
      {}
    );
  }

  trackPlaneDeleted(from) {
    this.#send(
      from,
      TYPE.PLANE,
      ACTIONS.SECTION_DELETED,
      {}
    );
  }

  trackBoxDeleted(from) {
    this.#send(
      from,
      TYPE.BOX,
      ACTIONS.SECTION_DELETED,
      {}
    );
  }

  trackPlaneCleared() {
    this.#send(
      FROM.PANEL,
      TYPE.PLANE,
      ACTIONS.SECTION_CLEARED,
      {
        count: this.extension.planes.length
      }
    );
  }

  trackBoxCleared() {
    this.#send(
      FROM.PANEL,
      TYPE.BOX,
      ACTIONS.SECTION_CLEARED,
      {}
    );
  }

  trackPlaneVisibilityToggled(wasActive, newActive) {
    if (wasActive !== newActive) {
      this.#send(
        FROM.PANEL,
        TYPE.PLANE,
        ACTIONS.SECTION_VISIBILITY_TOGGLED,
        {
          on: newActive
        }
      );
    }
  }

  trackPlaneAdjustedOnMouseUp(transControl, adjusting) {
    if (adjusting && this.extension.activePlane) {
      let adjustmentType;
      if (transControl.mode === 'rotate') {
        adjustmentType = ADJUSTMENT_TYPES.ROTATE;
      } else if (transControl.isTranslatingZ && transControl.isTranslatingZ()) {
        adjustmentType = ADJUSTMENT_TYPES.PUSH_PULL;
      } else {
        adjustmentType = ADJUSTMENT_TYPES.MOVE;
      }
      this.#send(
        FROM.CANVAS,
        TYPE.PLANE,
        ACTIONS.SECTION_ADJUSTED,
        {
          adjustment_type: adjustmentType
        }
      );
    }
  }

  trackPlaneAdjustedOnAxisClick() {
    this.#send(
      FROM.CANVAS,
      TYPE.PLANE,
      ACTIONS.SECTION_ADJUSTED,
      {
        adjustment_type: ADJUSTMENT_TYPES.CHANGE_DIRECTION_GIZMO
      }
    );
  }

  trackBoxAdjusted(adjustmentType) {
    this.#send(
      FROM.CANVAS,
      TYPE.BOX,
      ACTIONS.SECTION_ADJUSTED,
      {
        adjustment_type: adjustmentType
      }
    );
  }

  trackPlanePlacementCancelled(from = FROM.PANEL) {
    this.#send(
      from,
      TYPE.PLANE,
      ACTIONS.SECTION_PLACEMENT_CANCELLED,
      {}
    );
  }

  trackBoxPlacementCancelled(from = FROM.PANEL) {
    this.#send(
      from,
      TYPE.BOX,
      ACTIONS.SECTION_PLACEMENT_CANCELLED,
      {}
    );
  }

  trackPlacementCancelled(mode = 'plane', from = FROM.PANEL) {
    if (mode.toLowerCase() === 'plane') {
      this.trackPlanePlacementCancelled(from);
    } else if (mode.toLowerCase() === 'box') {
      this.trackBoxPlacementCancelled(from);
    }
  }

  trackCleared() {
    if (this.extension.planes.length > 0) {
      this.trackPlaneCleared();
    }
    if (this.extension.activeBox !== null) {
      this.trackBoxCleared();
    }
  }

  trackToggle(action, enabled, from = FROM.PANEL) {
    let messageType;
    if (this.extension.panel) {
      messageType = this.extension.panel.getActiveMode() === 'Plane' ?
      TYPE.PLANE :
      TYPE.BOX;
    } else {
      messageType = this.extension.activeBox ?
      TYPE.BOX :
      this.extension.planes.length > 0 ?
      TYPE.PLANE :
      null;
    }
    if (messageType) {
      this.#send(from, messageType, action, { on: enabled });
    }
  }

  trackToolOpened(from = FROM.TOOLBAR) {
    this.#send(
      from,
      null,
      ACTIONS.SECTION_TOOL_OPENED,
      {}
    );
  }

  trackToolClosed(from = FROM.TOOLBAR) {
    this.#send(
      from,
      null,
      ACTIONS.SECTION_TOOL_CLOSED,
      {}
    );
  }
}

function trackBoxAdjusted(viewer, adjustmentType) {
  const extension = viewer.getExtension('Autodesk.SmartSection');
  if (extension && extension.analytics) {
    extension.analytics.trackBoxAdjusted(adjustmentType);
  }
}

/***/ },

/***/ "./extensions/SmartSection/SmartSectionCapMeshes.js"
/*!**********************************************************!*\
  !*** ./extensions/SmartSection/SmartSectionCapMeshes.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmartSectionCapMeshes: () => (/* binding */ SmartSectionCapMeshes)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);


const avp = Autodesk.Viewing.Private;

const tintColor = { r: 1, g: 1, b: 0 };
const tintIntensity = 0.2;

const tmpBox = new three__WEBPACK_IMPORTED_MODULE_0__.Box3();
const tmpVector = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const tmpVector2 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const tmpMatrix = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();
const CURR_VEC3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const NEXT_VEC3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
const tmpPlane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane();

// upper limit of edges to be processed at once to limit performance impact
const MAX_EDGES = 10000;

/**
 * Creates the material for a section cap mesh, derived from the material of the object
 * being cut.
 *
 * Prism and other custom-shader materials render via a per-material shader variant. A flat
 * cap has no UVs and discards all of the source material's texturing anyway, so on WebGPU we
 * do not clone them: cloning dragged the strict WGSL shader-variant system into the cap path
 * and crashed with "[wgpu] Missing value for ..." when a required $TOKEN (e.g.
 * $USE_SURFACE_ALBEDO_MAP) was absent. Instead we use a plain default phong material (uber
 * pipeline, supports hatching). All other materials, and the whole WebGL path, keep the
 * original clone behaviour.
 */
function createCapMaterial(matman, material, model) {
  const useFixedCap = avp.USE_WEBGPU && material.needsCustomPipeline;
  if (useFixedCap) {
    return matman.cloneMaterial(matman.defaultMaterial, model);
  }

  const mat = matman.cloneMaterial(material, model);
  // WebGL prism: GLSL treats undefined macros as false, so a minimal defines set is fine.
  // (WebGPU prism/custom-shader materials are handled by the fixed-cap branch above.)
  if (mat.prismType != null) {
    mat.defines = {};
    mat.defines[mat.prismType.toUpperCase()] = "";
    if (mat.prismType == "PrismWood") {
      mat.defines["NO_UVW"] = "";
    }
  }
  return mat;
}

class SmartSectionCapMeshes {
  #fragIterator = new avp.FragmentIterator({ delay: 150 });
  #otherCutPlanes = [];

  constructor(viewer, options) {
    this.viewerImpl = viewer.impl;
    this.cutPlaneSetName = options?.cutPlaneSetName;

    this.onRenderOptionChanged = this.onRenderOptionChanged.bind(this);
    this.onCutPlanesChange = this.onCutPlanesChange.bind(this);
  }

  clear() {
    this.stopUpdate();

    const dispose = (mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    };

    const oldsection3D = this.viewerImpl.scene.getObjectByName("section3D");
    if (oldsection3D) {
      this.viewerImpl.scene.remove(oldsection3D);
      oldsection3D.children.forEach((child) => dispose(child));
      oldsection3D.children.length = 0;
    }

    const oldsection2D = this.viewerImpl.sceneAfter.getObjectByName("section2D");
    if (oldsection2D) {
      this.viewerImpl.sceneAfter.remove(oldsection2D);
      oldsection2D.children.forEach((child) => dispose(child));
      oldsection2D.children.length = 0;
    }

    return !!(oldsection2D || oldsection3D);
  }

  get otherCutPlanes() {
    this.#otherCutPlanes.length = 0;
    const cpSets = this.viewerImpl.getCutPlaneSets();
    for (let i = 0; i < cpSets.length; i++) {

      // skip our own cut planes
      const cutPlaneSetName = cpSets[i];
      if (cutPlaneSetName === this.cutPlaneSetName) {
        continue;
      }

      // add cutplanes of this set
      const cutPlane = this.viewerImpl.getCutPlaneSet(cutPlaneSetName);
      for (let j = 0; j < cutPlane.length; j++) {
        this.#otherCutPlanes.push(cutPlane[j]);
      }
    }
    return this.#otherCutPlanes;
  }

  #accumulatePlaneIntersects(planes, model, fragId, intersects, materials) {

    const fragList = model.getFragmentList();

    if (!fragList.isFragVisible(fragId) || fragList.isPoint(fragId)) {
      return;
    }

    const cg = Autodesk.Viewing.Extensions.CompGeom;
    fragList.getWorldBounds(fragId, tmpBox);

    for (let planeIndex = 0; planeIndex < planes.length; planeIndex++) {
      const plane = planes[planeIndex];
      if (cg.xBoxPlane(plane, tmpBox)) {
        const geometry = fragList.getGeometry(fragId);
        const material = fragList.getMaterial(fragId);

        if (geometry && !geometry.is2d && !geometry.isLines && material.cutplanes) {
          materials[planeIndex] = material;
          fragList.getWorldMatrix(fragId, tmpMatrix);
          cg.xMeshPlane(plane, { geometry, matrixWorld: tmpMatrix, fragId }, intersects[planeIndex]);
        }
      }
    }
  }

  #clipContourAgainstPlane(contour, plane, vertices) {
    const cg = Autodesk.Viewing.Extensions.CompGeom;
    const clippedContour = [];

    for (let i = 0; i < contour.length; i++) {
      const currentIdx = contour[i];
      const nextIdx = contour[(i + 1) % contour.length]; // wrap around

      const currentPt = vertices.pts[currentIdx];
      const nextPt = vertices.pts[nextIdx];

      // convert 2D points to 3D (z = 0 in local plane coordinates)
      CURR_VEC3.set(currentPt.x, currentPt.y, 0);
      NEXT_VEC3.set(nextPt.x, nextPt.y, 0);

      const currentDistance = plane.distanceToPoint(CURR_VEC3);
      const nextDistance = plane.distanceToPoint(NEXT_VEC3);

      // check if vertex is on the plane or in the negative half space
      if (currentDistance <= 0) {
        clippedContour.push(currentIdx);
      }

      // if the product of the distances is negative, the vertices lie on opposite sides of the plane and thus the edge intersects the plane
      if (currentDistance * nextDistance < 0) {
        // find the intersection and add it as a new vertex
        cg.xPlaneSegment(plane, CURR_VEC3, NEXT_VEC3, tmpVector, tmpVector2);
        const point = vertices.findOrAddPoint(tmpVector.x, tmpVector.y);
        clippedContour.push(point.id);
      }
    }
    const isContourClosed = contour[0] === contour[contour.length - 1];
    const isClippedContourOpen = clippedContour[0] !== clippedContour[clippedContour.length - 1];
    if (isContourClosed && isClippedContourOpen) {
      clippedContour.push(clippedContour[0]);
    }

    return clippedContour;
  }

  #clipEdgeSetAgainstPlanes(eset, planes) {
    const cg = Autodesk.Viewing.Extensions.CompGeom;

    // do the clipping for each plane
    for (const plane of planes) {
      // clip each contour against this plane
      for (let i = 0; i < eset.contours.length; i++) {
        const contour = eset.contours[i];
        const clippedContour = this.#clipContourAgainstPlane(contour, plane, eset.verts);
        eset.contours[i] = clippedContour;
      }

      // remove empty and open contours
      eset.contours = eset.contours.filter((contour) => contour.length > 2 && contour[0] === contour[contour.length - 1]);
    }

    // rebuild the edge set from the new contours
    const newEdges = [];
    tmpBox.makeEmpty();

    for (let ci = 0; ci < eset.contours.length; ci++) {
      const contour = eset.contours[ci];
      for (let i = 0; i < contour.length; i++) {
        const currentIdx = contour[i];
        const nextIdx = contour[(i + 1) % contour.length]; // wrap around

        const currentPt = eset.verts.pts[currentIdx];
        const nextPt = eset.verts.pts[nextIdx];

        CURR_VEC3.set(currentPt.x, currentPt.y, 0);
        NEXT_VEC3.set(nextPt.x, nextPt.y, 0);

        tmpBox.expandByPoint(CURR_VEC3);

        const edge = new cg.Edge(CURR_VEC3, NEXT_VEC3); // vectors are cloned in constructor
        newEdges.push(edge);
      }
    }

    const newEset = new cg.EdgeSet(newEdges, tmpBox, tmpBox.getSize(tmpVector).length() * 1e-6);
    newEset.snapEdges();
    newEset.sanitizeEdges();
    newEset.stitchContours(true);

    return newEset;
  }

  stopUpdate() {
    if (this.#pendingUpdate) {
      clearTimeout(this.#pendingUpdate);
      this.#pendingUpdate = 0;
    }
    this.#fragIterator.stop();
  }

  #pendingUpdate = 0;
  update(planes) {
    this.stopUpdate();
    this.#pendingUpdate = setTimeout(() => {
      this._update(planes);
    }, 50);
  }

  _update(planes) {
    const otherCutPlanes = this.otherCutPlanes;

    this._mat2d = null; // reset cached 2D material so that it gets recreated with the latest otherCutPlanes

    const cg = Autodesk.Viewing.Extensions.CompGeom;

    //When drawing a 2D material in 3D space we will want to skip binding the G-buffer
    //when rendering the scene that contains that material
    this.viewerImpl.sceneAfter.skipDepthTarget = true;

    const section3D = new three__WEBPACK_IMPORTED_MODULE_0__.Object3D();
    section3D.name = `section3D`;
    this.viewerImpl.scene.add(section3D);

    const section2D = new three__WEBPACK_IMPORTED_MODULE_0__.Object3D();
    section2D.name = `section2D`;
    this.viewerImpl.sceneAfter.add(section2D);

    // these transform back-and-forth between local plane space and world space
    const toPlaneCoords = planes.map((plane) => cg.makePlaneBasis(plane));
    const fromPlaneCoords = toPlaneCoords.map((coords) => coords.clone().invert());

    // pre-filter models that 1) have the do not cut flag and 2) do not intersect any of the planes.
    const models = this.viewerImpl.modelQueue().getModels().filter((m) => {
      if (m.getDoNotCut()) {
        return false;
      }

      // Use placement/model bounds instead of getVisibleBounds() to avoid a full BVH bbox recompute.
      // It'll be visisted by the frag iterator below anyway.
      const bounds = m.getModelBounds(false, false);
      if (!bounds) {
        return true;
      }
      return planes.some((plane) => cg.xBoxPlane(plane, bounds));
    });

    //create an empty array for each plane
    const intersects = planes.map(() => []);
    const materials = [];

    // Start iterating the fragments
    this.#fragIterator.start(models, (fragId, dbId, model, lastFrag) => {

      this.#accumulatePlaneIntersects(planes, model, fragId, intersects, materials);

      // If this is the last fragment for dbId, process the intersections
      if (lastFrag) {

        for (let planeIndex = 0; planeIndex < planes.length; planeIndex++) {

          const planeIntersects = intersects[planeIndex];

          if (!planeIntersects.length) {
            continue;
          }

          cg.convertToPlaneCoords(toPlaneCoords[planeIndex], planeIntersects, tmpBox);

          // convert to edge set
          const eset = new cg.EdgeSet(planeIntersects, tmpBox, tmpBox.getSize(tmpVector).length() * 1e-6);
          if (eset.edges.length > MAX_EDGES) {
            console.warn(`Skipping large edge set with ${eset.edges.length} edges, max is ${MAX_EDGES}`);
            continue;
          }
          eset.snapEdges();
          eset.sanitizeEdges();
          eset.stitchContours(true);

          // we clip the edge set against all other planes to get rid of outlying geometry
          // since the vertices of the edge set are in local space of the current plane, we need to transform the planes as well
          const otherPlanes = planes.filter((_, i) => i !== planeIndex);
          const otherPlanesLocal = otherPlanes.map((plane) => plane.clone().applyMatrix4(toPlaneCoords[planeIndex]));

          // Also clip against cutplanes from other tools, to make sure the cap meshes respect those
          for (const cutPlane of otherCutPlanes) {
            const extraPlane = new three__WEBPACK_IMPORTED_MODULE_0__.Plane().setComponents(...cutPlane.toArray());
            otherPlanesLocal.push(extraPlane.applyMatrix4(toPlaneCoords[planeIndex]));
          }

          const clippedEset = otherPlanesLocal.length > 0 ?
          this.#clipEdgeSetAgainstPlanes(eset, otherPlanesLocal) :
          eset;

          //Create the 3D mesh
          const cset = clippedEset.triangulate({ skipOpenContour: true });

          if (!cset || cset.triangulationFailed) {
            continue;
          }

          const material = materials[planeIndex];

          const mesh2d = this._createMesh2D(cset, material, fromPlaneCoords[planeIndex], model, dbId, otherCutPlanes);
          const capmesh = this._createCapmesh(cset, material, fromPlaneCoords[planeIndex], model, dbId, otherCutPlanes, planeIntersects.fragId);

          section2D.add(mesh2d);
          section3D.add(capmesh);
        }

        // Clear intersections for the next dbId
        for (let i = 0; i < planes.length; i++) {
          intersects[i].length = 0;
        }
      } // last Fragment for dbId

    }, () => {
      // The cap scene is in sceneAfter, so we need to redraw the model to see the caps.
      // LMV-2571 - clear the render, as otherwise we will draw transparent objects atop themselves.
      this.viewerImpl.invalidate(true, true);
    }); //_fragIterator.start
  }

  _create2DMaterial(otherCutPlanes) {
    if (this._mat2d) {
      return this._mat2d;
    }
    const mat2dname = this.viewerImpl.matman().create2DMaterial(null, { skipCircles: true, skipEllipticals: true, isScreenSpace: true, noIdOutput: true }, false, false);
    this._mat2d = this.viewerImpl.matman().findMaterial(null, mat2dname);
    this._mat2d.transparent = true;
    this._mat2d.depthTest = true;
    this._mat2d.polygonOffset = true;
    this._mat2d.polygonOffsetFactor = -1;
    this._mat2d.polygonOffsetUnits = 0.1; // 1.0 is usually way too high, see LMV-1072
    this._mat2d.cutplanes = otherCutPlanes; // make sure that cap meshes respect cutplanes from other tools
    this._mat2d.doNotCut = true;
    return this._mat2d;
  }

  _cloneMaterial(material, model, otherCutPlanes) {
    const matman = this.viewerImpl.matman();
    const mat = createCapMaterial(matman, material, model);

    mat.packedNormals = material.packedNormals;
    mat.mrtIdBuffer = material.mrtIdBuffer;
    mat.mrtNormals = material.mrtNormals;
    mat.cutplanes = otherCutPlanes; // make sure that cap meshes respect cutplanes from other tools
    // sometimes the triangulated geometry has reversed winding order.
    // rendering double sided should not be a problem since cap meshes are occluded by geometry they sit on anyways
    mat.side = three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide;
    mat.depthTest = true;
    mat.map = null;
    mat.bumpMap = null;
    mat.normalMap = null;
    mat.alphaMap = null;
    mat.specularMap = null;
    mat.transparent = false;
    mat.depthWrite = true;
    mat.hatchPattern = true;
    mat.needsUpdate = true;
    mat.doNotCut = true;

    let materialId = material.id + 3;
    if (Autodesk.Viewing.Private.USE_OUT_OF_CORE_TILE_MANAGER && !Autodesk.Viewing.Private.USE_WEBGPU) {
      // with incremental consolidation, the material ids are not the same so we need to account for this
      // to keep the same visual results for testing (because hash pattern orientation is chosen based on material id).
      materialId -= 6;
    }

    const angle = materialId * Math.PI * 0.125;
    const tan = Math.tan(angle);
    mat.hatchParams = new three__WEBPACK_IMPORTED_MODULE_0__.Vector2(tan, 10.0);
    mat.hatchTintColor = new three__WEBPACK_IMPORTED_MODULE_0__.Color(tintColor.r, tintColor.g, tintColor.b);
    mat.hatchTintIntensity = tintIntensity;
    return mat;
  }

  _createCapmesh(cset, material, fromPlaneCoords, model, dbId, otherCutPlanes, fragId) {
    const bg = cset.toPolygonMesh(material.packedNormals);

    const mat = this._cloneMaterial(material, model, otherCutPlanes);

    const capmesh = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(bg, mat);
    capmesh.matrix.copy(fromPlaneCoords);
    capmesh.matrixAutoUpdate = false;
    capmesh.modelId = model.id; // So we can look it up later
    capmesh.dbId = dbId;
    capmesh.fragId = fragId;
    return capmesh;
  }

  _createMesh2D(cset, material, fromPlaneCoords, model, dbId, otherCutPlanes) {
    //Create the 2D line geometry
    const vbb = new avp.VertexBufferBuilder(false, 8 * cset.pts.length);

    const color = material && material.color || new three__WEBPACK_IMPORTED_MODULE_0__.Color(0xffffff);
    const r = 0 | color.r * 0.25 * 255.5;
    const g = 0 | color.g * 0.25 * 255.5;
    const b = 0 | color.b * 0.25 * 255.5;

    const c = 0xff000000 | b << 16 | g << 8 | r;

    for (let j = 0; j < cset.contours.length; j++) {

      const contour = cset.contours[j];

      for (let k = 1; k < contour.length; k++) {
        const pt1 = cset.pts[contour[k - 1]];
        const pt2 = cset.pts[contour[k]];
        vbb.addSegment(pt1.x, pt1.y, pt2.x, pt2.y, 0, -2.0, /*isClosed ? c : rc*/c, dbId, 0);
      }

    }

    const mdata = { mesh: vbb.toMesh() };

    const bg2d = avp.BufferGeometryUtils.meshToGeometry(mdata);

    bg2d.streamingDraw = true;
    bg2d.streamingIndex = true;

    const mesh2d = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(bg2d, this._create2DMaterial(otherCutPlanes));

    mesh2d.matrix.copy(fromPlaneCoords);
    mesh2d.matrixAutoUpdate = false;
    mesh2d.frustumCulled = false;
    mesh2d.modelId = model.id; // So we can look it up later
    mesh2d.dbId = dbId;
    return mesh2d;
  }

  // Trigger update of cap mesh materials if number of cutplanes have changed by other tools
  updateCapMaterials(mrtOnly) {

    const update = (section) => {
      // apply cutplanes to all active cap meshes
      if (!section) {
        return;
      }

      section.traverse((obj) => {
        // we only care for Mesh with material
        if (!(obj instanceof three__WEBPACK_IMPORTED_MODULE_0__.Mesh) || !obj.material) {
          return;
        }
        if (mrtOnly) {
          this.viewerImpl.matman().adjustMaterialMRTSetting(obj.material);
        } else {
          obj.material.needsUpdate = true;
        }
      });
    };

    update(this.viewerImpl.scene.getObjectByName("section3D"));
    update(this.viewerImpl.sceneAfter.getObjectByName("section2D"));
  }

  // Sections use cloned materials outside the control of MaterialManager. Thus, when rendering options change, materials need to get recompiled
  onRenderOptionChanged() {
    this.updateCapMaterials(true);
  }

  onCutPlanesChange() {
    const numCutPlanesBefore = this.#otherCutPlanes.length;
    // If the number of cutplanes changed, this requires a shader recompile of the cap materials
    if (numCutPlanesBefore !== this.otherCutPlanes.length) {
      this.updateCapMaterials(false);
    }
  }

  findCapMeshes(modelId, dbIds) {
    const section3D = this.viewerImpl.scene.getObjectByName("section3D");
    let capMeshes = [];

    section3D && section3D.traverse((obj) => {
      if (obj instanceof three__WEBPACK_IMPORTED_MODULE_0__.Mesh && obj.modelId === modelId && dbIds.indexOf(obj.dbId) !== -1) {
        capMeshes.push(obj);
      }
    });

    return capMeshes;
  }
}

/***/ },

/***/ "./extensions/SmartSection/SmartSectionConstants.js"
/*!**********************************************************!*\
  !*** ./extensions/SmartSection/SmartSectionConstants.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BOX_STATE_CHANGED_EVENT: () => (/* binding */ BOX_STATE_CHANGED_EVENT)
/* harmony export */ });
const BOX_STATE_CHANGED_EVENT = { type: "SmartSection.BoxStateChanged" };

/***/ },

/***/ "./extensions/SmartSection/SmartSectionLocales.js"
/*!********************************************************!*\
  !*** ./extensions/SmartSection/SmartSectionLocales.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   locales: () => (/* binding */ locales)
/* harmony export */ });
/* harmony import */ var _res_locales_en_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../res/locales/en/nobundle-SmartSection.loc.json */ "./res/locales/en/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_cs_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../res/locales/cs/nobundle-SmartSection.loc.json */ "./res/locales/cs/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_da_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../res/locales/da/nobundle-SmartSection.loc.json */ "./res/locales/da/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_de_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../res/locales/de/nobundle-SmartSection.loc.json */ "./res/locales/de/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_en_GB_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../../res/locales/en-GB/nobundle-SmartSection.loc.json */ "./res/locales/en-GB/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_es_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../../res/locales/es/nobundle-SmartSection.loc.json */ "./res/locales/es/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_fr_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../../res/locales/fr/nobundle-SmartSection.loc.json */ "./res/locales/fr/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_fr_CA_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../../res/locales/fr-CA/nobundle-SmartSection.loc.json */ "./res/locales/fr-CA/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_it_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ../../res/locales/it/nobundle-SmartSection.loc.json */ "./res/locales/it/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_ja_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ../../res/locales/ja/nobundle-SmartSection.loc.json */ "./res/locales/ja/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_ko_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ../../res/locales/ko/nobundle-SmartSection.loc.json */ "./res/locales/ko/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_nl_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ../../res/locales/nl/nobundle-SmartSection.loc.json */ "./res/locales/nl/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_no_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ../../res/locales/no/nobundle-SmartSection.loc.json */ "./res/locales/no/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_pl_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ../../res/locales/pl/nobundle-SmartSection.loc.json */ "./res/locales/pl/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_pt_BR_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ../../res/locales/pt-BR/nobundle-SmartSection.loc.json */ "./res/locales/pt-BR/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_ru_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_15__ = __webpack_require__(/*! ../../res/locales/ru/nobundle-SmartSection.loc.json */ "./res/locales/ru/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_sv_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_16__ = __webpack_require__(/*! ../../res/locales/sv/nobundle-SmartSection.loc.json */ "./res/locales/sv/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_tr_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_17__ = __webpack_require__(/*! ../../res/locales/tr/nobundle-SmartSection.loc.json */ "./res/locales/tr/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_zh_Hans_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_18__ = __webpack_require__(/*! ../../res/locales/zh-Hans/nobundle-SmartSection.loc.json */ "./res/locales/zh-Hans/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_zh_Hant_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_19__ = __webpack_require__(/*! ../../res/locales/zh-Hant/nobundle-SmartSection.loc.json */ "./res/locales/zh-Hant/nobundle-SmartSection.loc.json");
/* harmony import */ var _res_locales_zh_HK_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_20__ = __webpack_require__(/*! ../../res/locales/zh-HK/nobundle-SmartSection.loc.json */ "./res/locales/zh-HK/nobundle-SmartSection.loc.json");
/**
 * Include each locale json file and return it in an object
 * that can be consumed by i18n
 */



// These languages should be uncommented once all of the other languages are provided.





















const locales = {
  en: _res_locales_en_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_0__,

  cs: _res_locales_cs_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_1__,
  da: _res_locales_da_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_2__,
  de: _res_locales_de_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_3__,
  "en-GB": _res_locales_en_GB_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_4__,
  es: _res_locales_es_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_5__,
  fr: _res_locales_fr_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_6__,
  "fr-CA": _res_locales_fr_CA_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_7__,
  it: _res_locales_it_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_8__,
  ja: _res_locales_ja_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_9__,
  ko: _res_locales_ko_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_10__,
  nl: _res_locales_nl_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_11__,
  no: _res_locales_no_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_12__,
  pl: _res_locales_pl_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_13__,
  "pt-BR": _res_locales_pt_BR_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_14__,
  ru: _res_locales_ru_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_15__,
  sv: _res_locales_sv_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_16__,
  tr: _res_locales_tr_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_17__,
  "zh-Hans": _res_locales_zh_Hans_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_18__,
  "zh-Hant": _res_locales_zh_Hant_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_19__,
  "zh-HK": _res_locales_zh_HK_nobundle_SmartSection_loc_json__WEBPACK_IMPORTED_MODULE_20__
};

/***/ },

/***/ "./extensions/SmartSection/SmartSectionTool.js"
/*!*****************************************************!*\
  !*** ./extensions/SmartSection/SmartSectionTool.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmartSectionTool: () => (/* binding */ SmartSectionTool)
/* harmony export */ });
/* harmony import */ var _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SmartSection.js */ "./extensions/SmartSection/SmartSection.js");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _SectionBox_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SectionBox.js */ "./extensions/SmartSection/SectionBox.js");
/* harmony import */ var _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./SectionPlane.js */ "./extensions/SmartSection/SectionPlane.js");
/* harmony import */ var _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./SmartSectionAnalytics.js */ "./extensions/SmartSection/SmartSectionAnalytics.js");

 // todo the functionality for these imports and below should be in a separate file




/** @import {SmartSectionExtension} from './SmartSection' */

const av = Autodesk.Viewing;

/** @import { PlacementPlane, PlacementBox } from './PlacementIndicator' */

class SmartSectionTool extends av.ToolInterface {

  /**
   * This is a promise resolver which will be resolved when the user places the section plane or cancels the placement
   */
  #pendingSectionPlacementCallback = null;

  // Visual aid for placing the plane
  /** @type {PlacementPlane|PlacementBox|null} */
  placementIndicator = null;
  placementStrategy;
  defaultPlacementStrategy = Object.freeze({ plane: _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__.PlacementStrategy.PLANE_SURFACE_NORMAL, box: _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__.PlacementStrategy.BOX_FREE_PLACEMENT });
  type = null; // 'plane' | 'box' | null

  hoveredPlane = null;

  get isPlacing() {
    return !!this.#pendingSectionPlacementCallback;
  }

  constructor(viewer, options = {}) {
    super(viewer, options);

    this.names = ["SmartSectionTool"];

    this.options = options;

    this.gizmo = options.gizmo;

    this.viewer = viewer;
    /** @type {SmartSectionExtension} */
    this.delegate = options.delegate;

    this.handleMouseMove = this.#onMouseMove.bind(this);
    this.handleSingleClick = this.#onSingleClick.bind(this);

    this._modifierState = { shift: false };

    this.init();
  }

  /**
   * Initialize the tool
   */
  init() {

    this.update = this.onBeforeDraw.bind(this);

    this.getPriority = function () {
      return 80;
    };

    this.handleKeyDown = (event) => {
      let handled = false;

      switch (event.code) {
        case 'ControlLeft':
        case 'ControlRight':
        case 'AltLeft':
        case 'AltRight':
        case 'MetaLeft':
        case 'MetaRight':
          // exit alternative placement mode when other modifier is pressed
          // this is mostly for convenience when using screenshot shortcuts
          handled = this.#releaseShift();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          if (event.ctrlKey || event.altKey || event.metaKey) {
            break;
          }
          if (!this.isShiftToggling()) {
            this._modifierState.shift = true;
            if (this.isPlacing) {
              this.setPlacementStrategy(this.type === 'plane' ? _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__.PlacementStrategy.PLANE_ORTHOGONAL_GUESS : _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__.PlacementStrategy.BOX_TO_BOUNDING_BOX);
              this.placementIndicator?.onPlacementModeChange(this.placementStrategy);
              this.viewer.impl.invalidate(false, false, true);
              handled = true;
            } else {
              this.delegate.toggleRotation(true, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.FROM.KEYBOARD);
            }
          }
          break;
        case 'Escape':
          handled = true;
          if (this.isPlacing) {
            this.delegate.analytics.trackPlacementCancelled(this.type, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.FROM.KEYBOARD);
            this.cancelMousePlacementMode();
          } else {
            if (this.delegate.isActive()) {
              this.delegate.deactivate();
            } else {
              handled = false;
            }
          }
          break;

        case 'Delete':
          if (!this.isPlacing && !this.delegate.activeBox) {
            handled = this.delegate.removeActiveSection();
          }
          break;
      }

      return handled;
    };

    this.handleKeyUp = (event) => {
      let handled = false;

      switch (event.code) {
        case 'ShiftLeft':
        case 'ShiftRight':
          handled = this.#releaseShift();
          break;
      }

      return handled;
    };

    this.handleButtonDown = (e) => {
      if (e.button !== 0) {
        return;
      }
      return this.gizmo.transControl.pointerDown(e);
    };
    this.handleButtonUp = (e) => {
      if (e.button !== 0) {
        return;
      }
      return this.gizmo.transControl.pointerUp(e);
    };

    // keyup is never received when the window loses focus while SHIFT is held
    this.handleBlur = () => {
      this.#releaseShift();
      return false;
    };

    this.isShiftToggling = () => this._modifierState.shift;

    this.activate = () => {
      this._modifierState.shift = false;
    };
  }

  /**
   * Ends the SHIFT toggling, restoring the default placement strategy or the gizmo mode from the control state
   * @returns {boolean} true if the placement strategy was changed
   */
  #releaseShift() {
    if (!this.isShiftToggling()) {
      return false;
    }
    this._modifierState.shift = false;
    let handled = false;
    if (this.isPlacing && !this.placementIndicator?.isAnimating) {
      this.setPlacementStrategy(this.defaultPlacementStrategy[this.type]);
      this.placementIndicator?.onPlacementModeChange(this.placementStrategy);
      this.viewer.impl.invalidate(false, false, true);
      handled = true;
    }
    this.delegate.toggleRotation(false, _SmartSectionAnalytics_js__WEBPACK_IMPORTED_MODULE_4__.FROM.KEYBOARD);
    return handled;
  }

  #getObjectUnderTheMouse(vpVec) {
    const id = this.viewer.impl.renderer().idAtPixel(vpVec.x, vpVec.y, []);

    let result;
    if (typeof id === 'number' && id > 0) {
      result = this.viewer.impl.hitTestViewport(vpVec.clone(), false, [id]);
    }

    if (!result) {
      result = this.viewer.impl.hitTestViewport(vpVec.clone(), false);
    }

    return result;
  }

  /**
  * Handles placement of a new Section Plane/Box when in placement mode,
  * and editing/highlighting of an existing Section Plane/Box otherwise.
  *
  * Returns true if this tool handled the mouse move (and the viewer should not handle it),
  * false otherwise.
  *
  * @param {MouseEvent & { canvasX: number, canvasY: number, normalizedX: number, normalizedY: number, buttons: number }} event
  * @returns {boolean}
   */
  #onMouseMove(event) {
    // Editing of an existing Section Plane or Box
    if (!this.isPlacing || this.placementIndicator?.isAnimating) {
      if (!this.delegate.hasSections()) {
        return false;
      }
      const moved = this.gizmo.transControl.pointerMove(event);
      const hovered = this.gizmo.transControl.pointerHover(event);
      if (!moved) {
        this._updatePlaneHighlight(event, hovered);
        return false;
      }
      return moved;
    }

    // Some Mouse Button is hold - moving model or camera - let onCameraChanged do its job
    // W/o this it causes unnecessary re-calculation of the placement including a new intersection point,
    // which might be very costly performance-wise
    if (event.buttons > 0) {
      return false;
    }

    const vpVec = this.viewer.impl.clientToViewport(event.canvasX, event.canvasY);
    const result = this.#getObjectUnderTheMouse(vpVec);
    const dbId = result?.dbId;

    // if we don't have a valid fragId it means we are hovering over a cap mesh
    // this is not a valid placement location
    const hitCapMeshGeometry = result && (result.fragId === undefined || result.fragId === null);

    if (this.type === 'box' || !hitCapMeshGeometry) {
      this.placementIndicator.placementOverCapMesh = false;
      this.placementIndicator.resumePlacement();
    } else {
      this.placementIndicator.placementOverCapMesh = hitCapMeshGeometry;
      if (hitCapMeshGeometry) {
        this.placementIndicator.pausePlacement();
        return false;
      }
    }

    // fallback to free placement.
    const invalidIntersection = !result?.face?.normal || !result?.intersectPoint;
    const invalidObject = !dbId || dbId === 0 && !this.placementIndicator.lastPick;
    if (invalidObject || invalidIntersection) {
      this.placementIndicator.updatePlacement(null, this.placementStrategy, vpVec.clone());
      return false;
    }

    // Sometimes idAtPixel returns 0, while hovering over the model.
    // This can especially happen on WebGPU right after camera changes.
    // In that case we use the last picked dbId.
    if (dbId === 0 && this.placementIndicator.lastPick) {
      this.placementIndicator.updatePlacement(this.placementIndicator.lastPick, this.placementStrategy);
      return false;
    }

    // dbId is valid - allows aligning the plane to the hovered object.
    if (dbId > 0) {
      this.placementIndicator.updatePlacement(result, this.placementStrategy);
      return false;
    }

    return false;
  }

  #onSingleClick(event, button) {
    if (button !== 0) {
      return false;
    }

    if (!this.isPlacing) {
      if (!this.delegate.hasSections()) {
        return false;
      }
      // Interactions which should not happen while in placement mode
      if (this.gizmo.transControl.axis) {
        return this.gizmo.transControl.rotateActiveAxis();
      }
      const nearestHoveredPlane = this.getNearestHoveredPlane(event);
      this._setActivePlane(nearestHoveredPlane);
      return !!nearestHoveredPlane;
    }

    const vpVec = this.viewer.impl.clientToViewport(event.canvasX, event.canvasY);
    const result = this.#getObjectUnderTheMouse(vpVec);
    const dbId = result?.dbId;

    if (typeof dbId !== 'number' || dbId <= 0) {
      // User did not click on a mesh
      this.cancelMousePlacementMode();
      return false;
    }

    if (result?.face?.normal && result?.intersectPoint) {
      this.onPlacementCompleted(result);
    } else {
      this.cancelMousePlacementMode();
    }

    return typeof result?.intersectPoint === 'object';
  }

  async onPlacementCompleted(pick) {
    if (!this.isPlacing) {
      return;
    }

    // run animation
    const result = await this.placementIndicator.place(pick);

    this.#pendingSectionPlacementCallback(result);
  }


  /**
   * Enter SectionPlane mouse placement mode. Next user click on the canvas will be used to pick
   * the location of the section plane.
   *
   * This process can be cancelled by calling `SmartSectionTool.cancelMousePlacementMode`
   *
   * @param options Used for placementStrategy
   * @param {'plane'|'box'} options.type Defaults to plane
   * @param {PlacementStrategy} [options.placementStrategy] Placement strategy
   * @param {boolean} options.animate Whether or not to animate the placement
   * @returns {Promise<SectionPlane>} The newly created section instance. Either a SectionPlane or a SectionBox
   */
  async enterMousePlacementMode(options = { type: 'plane', animate: false }) {
    this.type = options?.type || 'plane';

    const placementStrategy = typeof options?.placementStrategy === 'number' && (options.placementStrategy === 0 || options.placementStrategy === 1) ?
    options.placementStrategy :
    this.isShiftToggling() ?
    this.type === 'plane' ? _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__.PlacementStrategy.PLANE_ORTHOGONAL_GUESS : _SmartSection_js__WEBPACK_IMPORTED_MODULE_0__.PlacementStrategy.BOX_TO_BOUNDING_BOX :
    this.defaultPlacementStrategy[this.type];

    this.setPlacementStrategy(placementStrategy);

    this.delegate.toggleRotation(false);

    this.placementIndicator = this.delegate.createPlacementIndicator(this.type, options.animate, this.getPlacementStrategy());

    return new Promise((resolve) => {
      this.#pendingSectionPlacementCallback = (result) => {
        this.placementIndicator?.dispose();
        this.placementIndicator = null;
        this.type = null;
        this.#pendingSectionPlacementCallback = null;
        resolve(result);
      };
    });
  }

  /**
   * Cancel the current mouse placement mode listener.
   * Will do nothing if there is no active mouse placement mode
   */
  cancelMousePlacementMode() {
    // Resolve the promise with undefined value so listeners know that no section was placed
    // and the active process of placing the plane was cancelled
    if (this.isPlacing) {
      this.#pendingSectionPlacementCallback();
    }

    this.placementIndicator?.dispose();
    this.delegate.panel?.updatePlacementAvailability();
  }

  onBeforeDraw() {
    this.placementIndicator?.update();
  }

  onCameraChanged() {
    this?.placementIndicator?.onCameraChanged();
  }

  /**
   * Finds the nearest SectionPlane under the mouse based on canvas coordinates.
   *
   * @param {{ canvasX: number, canvasY: number }} event
   * @returns {SectionPlane|undefined}
   */
  getNearestHoveredPlane(event) {
    const camera = this.viewer.getCamera();
    const vpVec = this.viewer.impl.clientToViewport(event.canvasX, event.canvasY);

    const planesToMeshes = new Map(this.delegate.planes.filter((it) => it.active).map((it) => [it.displayMesh, it]));
    const intersects = (0,_SectionBox_js__WEBPACK_IMPORTED_MODULE_2__.updateRayCasterFromNdc)(camera, new three__WEBPACK_IMPORTED_MODULE_1__.Raycaster(), vpVec.x, vpVec.y).
    intersectObjects(Array.from(planesToMeshes.keys()));

    if (!intersects.length) return;

    return planesToMeshes.get(intersects[0].object);
  }


  _updatePlaneHighlight(event, isGizmoHovered = false) {
    this.delegate.planes.forEach((it) => {
      if (it !== this.delegate.activePlane) it.highlightState = _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.HighlightState.NONE;
    });

    const hoveredPlane = isGizmoHovered ? this.gizmo.sectionPlane : this.getNearestHoveredPlane(event);
    if (hoveredPlane && hoveredPlane !== this.delegate.activePlane) {
      hoveredPlane.highlightState = _SectionPlane_js__WEBPACK_IMPORTED_MODULE_3__.HighlightState.HOVERED;
    }
    // Update only when the currently hovered plane changes
    if (hoveredPlane === this.hoveredPlane) {
      return;
    }

    this.hoveredPlane = hoveredPlane;

    this.delegate.panel?.updatePlaneListState();
    this.viewer.impl.invalidate(false, false, true);

    return false;
  }

  _setActivePlane(plane = null) {
    this.delegate.setActivePlane(plane, true);
    this.delegate.panel?.updatePlaneListState();
    this.viewer.impl.invalidate(false, false, true);
  }

  /**
   * Triggered when **other** tools (like measure) report selection change
   */
  handleSelectionChange() {
    // Deselect the currently active plane for better focus on the other tool
    this._setActivePlane(null);
  }

  getPlacementStrategy() {
    return this.placementStrategy;
  }

  /**
   * Set the placement strategy for the smart section tool
   * @param {number} strategy - The placement strategy to set. 0: SURFACE_NORMAL, 1: ORTHOGONAL_GUESS, 2: BOUNDING_BOX, 3: FREE_PLACEMENT
   */
  setPlacementStrategy(strategy) {
    this.placementStrategy = strategy;
  }

  getCursor() {
    if (!this.isPlacing) return null;
    // Invalid placement location: show a red X cursor.
    if (this.placementIndicator?.placementOverCapMesh) return `url(${av.getResourceUrl('extensions/SmartSection/res/cursor_error_state.svg')}), auto`;
    return 'url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIwIDExLjc1QzIwIDEyLjA4MTUgMTkuODY4MiAxMi4zOTk0IDE5LjYzMzggMTIuNjMzOEMxOS4zOTk0IDEyLjg2ODIgMTkuMDgxNSAxMyAxOC43NSAxM0gxM1YxOC43NUMxMyAxOS4wODE1IDEyLjg2ODIgMTkuMzk5NCAxMi42MzM4IDE5LjYzMzhDMTIuMzk5NCAxOS44NjgyIDEyLjA4MTUgMjAgMTEuNzUgMjBDMTEuNDE4NSAyMCAxMS4xMDA2IDE5Ljg2ODIgMTAuODY2MiAxOS42MzM4QzEwLjYzMTggMTkuMzk5NCAxMC41IDE5LjA4MTUgMTAuNSAxOC43NVYxM0g0Ljc1QzQuNDE4NDggMTMgNC4xMDA2MyAxMi44NjgyIDMuODY2MjEgMTIuNjMzOEMzLjYzMTc5IDEyLjM5OTQgMy41IDEyLjA4MTUgMy41IDExLjc1QzMuNSAxMS40MTg1IDMuNjMxNzkgMTEuMTAwNiAzLjg2NjIxIDEwLjg2NjJDNC4xMDA2MyAxMC42MzE4IDQuNDE4NDggMTAuNSA0Ljc1IDEwLjVIMTAuNVY0Ljc1QzEwLjUgNC40MTg0OCAxMC42MzE4IDQuMTAwNjMgMTAuODY2MiAzLjg2NjIxQzExLjEwMDYgMy42MzE3OSAxMS40MTg1IDMuNSAxMS43NSAzLjVMMTEuODc0IDMuNTA1ODZDMTIuMTYgMy41MzQzNiAxMi40Mjg4IDMuNjYxMiAxMi42MzM4IDMuODY2MjFDMTIuODY4MiA0LjEwMDYzIDEzIDQuNDE4NDggMTMgNC43NVYxMC41SDE4Ljc1NjhDMTkuMDg1MiAxMC41MDQ0IDE5LjM5ODcgMTAuNjM2OSAxOS42MzA5IDEwLjg2OTFDMTkuODYzMSAxMS4xMDEzIDE5Ljk5NTYgMTEuNDE0OCAyMCAxMS43NDMyVjExLjc1WiIgZmlsbD0id2hpdGUiIHN0cm9rZT0iYmxhY2siLz4KPC9zdmc+Cg==), auto';
  }

}

/***/ },

/***/ "./extensions/SmartSectionUI/SmartSectionPanel.js"
/*!********************************************************!*\
  !*** ./extensions/SmartSectionUI/SmartSectionPanel.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BOX_TAB_ID: () => (/* binding */ BOX_TAB_ID),
/* harmony export */   PLANE_TAB_ID: () => (/* binding */ PLANE_TAB_ID),
/* harmony export */   SmartSectionPanel: () => (/* binding */ SmartSectionPanel)
/* harmony export */ });
/* harmony import */ var _SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SmartSectionTooltip.js */ "./extensions/SmartSectionUI/SmartSectionTooltip.js");


/** @import {SmartSectionExtension} from '../SmartSection/SmartSection' */

const av = Autodesk.Viewing;
const SettingsPanel = av.UI.SettingsPanel;
const PLANE_TAB_ID = "Plane Mode";
const PLANE_CONTROLS_ID = "Controls";
const PLANE_TAB_LABEL = "Plane";
const PLANE_TAB_MODE = "Plane";
const BOX_TAB_ID = "Box Mode";
const BOX_TAB_LABEL = "Box";
const BOX_TAB_MODE = "Box";
const PANEL_ID = "smart-section-panel";
const PANEL_TITLE = Autodesk.Viewing.i18n.translate("Sectioning Tools");
const MAX_SECTION_PLANES = 6;
const PLANE_LIST_ROW_AMOUNT = 1;
/**
 * Autodesk.Viewing.Extensions.SmartSection.Analytics constants,
 * they become available after the main extension is loaded
 */
let Analytics;

class SmartSectionPanel extends Autodesk.Viewing.UI.SettingsPanel {

  _showPlanesCheckId;
  _showPlaneGizmoCheckId;
  _showPlaneHatchesCheckId;
  _rotatePlaneCheckId;
  _alignTrueNorthPlaneCheckId;
  _showBoxCheckId;
  _showBoxGizmoCheckId;
  _showBoxHatchesCheckId;
  _rotateBoxCheckId;
  _invertedCheckId;
  _alignTrueNorthBoxCheckId;

  /** @type {SmartSectionExtension} */
  smartSectionExtension;

  /**
   * @param {SmartSectionExtension} smartSectionExtension
   * @param {Autodesk.Viewing.Viewer3D} viewer
   * @param {{ heightAdjustment: number, width: number, hideTabBar: boolean }} options
   */
  constructor(smartSectionExtension, viewer, options) {

    Analytics = Autodesk.Viewing.Extensions.SmartSection.Analytics;

    super(viewer.container, PANEL_ID, PANEL_TITLE, options);
    this.smartSectionExtension = smartSectionExtension;
    this.viewer = viewer;
    this.setGlobalManager(this.viewer.globalManager);

    this.onSmartSectionStateChanged = this.onSmartSectionStateChanged.bind(this);
    this.onSelectTab = this.onSelectTab.bind(this);
    this.onShowPanel = this.onShowPanel.bind(this);
    this.onHidePanel = this.onHidePanel.bind(this);
    this.onModelLoaded = this.onModelLoaded.bind(this);
    this.onModelUnloaded = this.onModelUnloaded.bind(this);

    this.container.classList.add("section-panel");
    this.container.dockRight = true;
    this.container.style.top = "260px";

    // Need to override the default kMinHeight to allow smaller min-height
    this.kMinHeight = 70;

    // Section Plane Mode Tab
    this.addTab(PLANE_TAB_ID, PLANE_TAB_LABEL, { className: "smartsection" });
    this.selectTab(PLANE_TAB_ID);
    let plane_tab = document.getElementById(PANEL_ID + '-' + PLANE_TAB_ID).firstChild;
    let plane_icon = document.createElement('div');
    plane_icon.id = "plane-icon-div";
    plane_icon.classList.add("adsk-icon-plane-x");
    plane_tab.insertBefore(plane_icon, plane_tab.firstChild);

    // Section Box Mode Tab
    this.addTab(BOX_TAB_ID, BOX_TAB_LABEL, { className: "smartsection" });
    let box_tab = document.getElementById(PANEL_ID + '-' + BOX_TAB_ID).firstChild;
    let box_icon = document.createElement('div');
    box_icon.id = "box-icon-div";
    box_icon.classList.add("adsk-icon-box");
    box_tab.insertBefore(box_icon, box_tab.firstChild);
    this.boxTab = box_tab;

    this.tooltipManager = new _SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.SmartSectionTooltip(this.viewer);

    this.tabContainer.addEventListener('click', () => {
      this.updatePlacementAvailability();
    });

    this.createMinimizeButton();

    // Create panels for the Plane and Box tabs
    this.createPlanePanel();
    this.createBoxPanel();
    this.#syncOptionsClick();

    this.viewer.addPanel?.(this);

    // Resize observer to handle minimized state of the panel
    this._resizeObserver = new ResizeObserver(() => {
      const titleHeight = this.title?.offsetHeight || 0;
      const footerHeight = this.footer?.offsetHeight || 0;
      const settingsTabsHeight = this.tabContainer?.offsetHeight || 0;
      const threshold = titleHeight + footerHeight + settingsTabsHeight;
      this.container.classList.toggle('minimized', this.container.offsetHeight < threshold);
    });
    this._resizeObserver.observe(this.container);

    const avext = Autodesk.Viewing.Extensions.SmartSection;

    // Update UI based on current state
    this.updatePlacementAvailability();

    // plane list
    this.updatePlaneList();

    this.smartSectionExtension.events.addEventListener(avext.STATE_CHANGED_EVENT, this.onSmartSectionStateChanged);

    // Box mode needs either the instance tree or the dbId2fragId map to fully function
    // If we don't have them yet, disable the tab until the feature is available
    if (!this.smartSectionExtension.isBoxFeatureAvailable()) {
      this.#disableBoxTab();
    }
    this.onBoxAvailablityChanged = (event) => {
      if (event.boxFeatureAvailable) {
        this.#enableBoxTab();
      } else {
        this.#disableBoxTab();
      }
    };
    this.smartSectionExtension.events.addEventListener(avext.SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT, this.onBoxAvailablityChanged);

    this.smartSectionExtension.events.addEventListener(avext.UI_SHOW_PANEL_EVENT, this.onShowPanel);
    this.smartSectionExtension.events.addEventListener(avext.UI_HIDE_PANEL_EVENT, this.onHidePanel);
    this.smartSectionExtension.events.addEventListener(avext.UI_SELECT_TAB_EVENT, this.onSelectTab);

    this.viewer.addEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, this.onModelLoaded);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_UNLOADED_EVENT, this.onModelUnloaded);

    this.#updateAlignTrueNorthAvailability();
  }

  createMinimizeButton() {
    const _document = this.getDocument();
    this.minimizeButton = _document.createElement('div');
    this.minimizeButton.className = 'section-panel-minimize';
    this.container.insertBefore(this.minimizeButton, this.closer);
  }

  onSmartSectionStateChanged() {
    this.updatePlacementAvailability();
    this.updatePlaneList();
  }

  onShowPanel() {
    this.setVisible(true);
  }
  onHidePanel() {
    this.setVisible(false);
  }

  onModelLoaded() {
    this.#updateAlignTrueNorthAvailability();
  }

  onModelUnloaded() {
    this.#updateAlignTrueNorthAvailability();
  }

  uninitialize() {
    const avext = Autodesk.Viewing.Extensions.SmartSection;
    this.smartSectionExtension.events.removeEventListener(avext.STATE_CHANGED_EVENT, this.onSmartSectionStateChanged);
    this.smartSectionExtension.events.removeEventListener(avext.SMART_SECTION_BOX_FEATURE_AVAILABILITY_CHANGED_EVENT, this.onBoxAvailablityChanged);
    this.smartSectionExtension.events.removeEventListener(avext.UI_SHOW_PANEL_EVENT, this.onShowPanel);
    this.smartSectionExtension.events.removeEventListener(avext.UI_HIDE_PANEL_EVENT, this.onHidePanel);
    this.smartSectionExtension.events.removeEventListener(avext.UI_SELECT_TAB_EVENT, this.onSelectTab);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, this.onModelLoaded);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_UNLOADED_EVENT, this.onModelUnloaded);
    this.smartSectionExtension = null;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this.minimizeButton = null;
    this.tooltipManager?.dispose();
    this.tooltipManager = null;
    this.viewer?.removePanel?.(this);
    super.uninitialize();
  }

  addCheckbox(tabId, name, initialState, onchange) {
    function onChangeCB(checked) {
      onchange && onchange(checked);
    }

    const checkboxId = SettingsPanel.prototype.addCheckbox.call(
      this,
      tabId,
      name,
      initialState,
      onChangeCB
    );

    return checkboxId;
  }

  /**
   * Adds toggle functionality to OptionLabel headers to collapse and expand the next countsToCollapse rows on click.
   * @param headerRows
   * @param {Number} countsToCollapse
   */
  #makeCollapsible(headerRows, countsToCollapse) {
    const collapseIcons = [];
    for (const headerRow of headerRows) {
      const collapseIcon = this.getDocument().createElement('i');
      collapseIcon.classList.add('logic-group-collapse-icon');
      collapseIcon.classList.add('adsk-icon-caret-down');
      headerRow.cells[0].prepend(collapseIcon);
      collapseIcons.push(collapseIcon);
    }

    const onClick = function () {
      for (let i = 0; i < headerRows.length; i++) {
        const collapsed = collapseIcons[i].classList.toggle('collapsed');
        let currentRow = headerRows[i].nextElementSibling;
        for (let j = 0; j < countsToCollapse[i]; j++) {
          currentRow.classList.toggle('collapsed-item', collapsed);
          currentRow = currentRow.nextElementSibling;
        }
      }
    };

    for (const headerRow of headerRows) {
      headerRow.addEventListener('click', onClick.bind(this));
    }
  }

  createPlanePanel() {
    this.#addControlsLabel();

    this.createControlPanel(PLANE_TAB_ID, PLANE_TAB_MODE);

    // Planes list
    const planesLabel = this.addLabel(PLANE_TAB_ID, 'Planes');
    this.createPlaneList();
    planesLabel.sliderRow.id = 'Plane-List-Header';
    this.#makeCollapsible([planesLabel.sliderRow], [PLANE_LIST_ROW_AMOUNT]);

    // Options
    const optionsLabel = this.addLabel(PLANE_TAB_ID, 'Options');
    optionsLabel.sliderRow.id = 'Plane-Options-Header';

    this._showPlanesCheckId = this.addCheckbox(PLANE_TAB_ID, 'Show frame', true, (checked) => {
      this.smartSectionExtension.setFrameVisible(checked, Analytics.FROM.PANEL);
    });

    this._showPlaneGizmoCheckId = this.addCheckbox(PLANE_TAB_ID, 'Show gizmo', true, (checked) => {
      this.smartSectionExtension.setGizmoEnabled(checked, Analytics.FROM.PANEL);
      this.smartSectionExtension.setRotationEnabled(false, Analytics.FROM.PANEL);
      this.#syncTogglesFromControlState();
    });

    this._rotatePlaneCheckId = this.addCheckbox(PLANE_TAB_ID, 'Rotate gizmo', false, (checked) => {
      if (checked && !this.smartSectionExtension.isGizmoEnabled()) {
        this.smartSectionExtension.setGizmoEnabled(true, Analytics.FROM.PANEL);
      }
      if (this.smartSectionExtension.isGizmoEnabled()) {
        this.smartSectionExtension.setRotationEnabled(checked, Analytics.FROM.PANEL);
      }
      this.#syncTogglesFromControlState();
    });

    this._showPlaneHatchesCheckId = this.addCheckbox(PLANE_TAB_ID, 'Show hatches', true, (checked) => {
      this.smartSectionExtension.setCapMeshesEnabled(checked, false, Analytics.FROM.PANEL);
      this.getControl(this._showBoxHatchesCheckId).setValue(checked);
    });

    this._alignTrueNorthPlaneCheckId = this.addCheckbox(PLANE_TAB_ID, 'Align true north', false, (checked) => {
      this.smartSectionExtension.setAlignTrueNorthEnabled(checked, Analytics.FROM.PANEL);
      this.getControl(this._alignTrueNorthBoxCheckId).setValue(checked);
    });
  }

  #syncOptionsClick() {
    const _document = this.getDocument();
    const planeOptions = _document.getElementById('Plane-Options-Header');
    const boxOptions = _document.getElementById('Box-Options-Header');

    this.#makeCollapsible([planeOptions, boxOptions], [5, 5]);
  }

  #addControlsLabel() {
    const _document = this.getDocument();

    const infoIcon = _document.createElement('a');
    infoIcon.id = "info-icon";
    infoIcon.classList.add("adsk-icon-info");
    const tooltipText = "Maximum of 6 planes. Each is named sequentially.";
    this.tooltipManager.addListenersForTooltip(_SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.TooltipPositions.TOP, infoIcon, tooltipText, 'section-control-tooltip');
    const label = this.addLabel(PLANE_TAB_ID, PLANE_CONTROLS_ID);
    label.sliderRow.cells[0].appendChild(infoIcon);
  }

  createBoxPanel() {
    this.addLabel(BOX_TAB_ID, 'Controls');
    this.createControlPanel(BOX_TAB_ID, BOX_TAB_MODE);

    const optionsLabel = this.addLabel(BOX_TAB_ID, 'Options');
    optionsLabel.sliderRow.id = 'Box-Options-Header';

    this._showBoxCheckId = this.addCheckbox(BOX_TAB_ID, 'Show box', true, (checked) => {
      this.smartSectionExtension.setBoxVisible(checked, Analytics.FROM.PANEL);
    });

    this._showBoxGizmoCheckId = this.addCheckbox(BOX_TAB_ID, 'Show gizmo', true, (checked) => {
      this.smartSectionExtension.setGizmoEnabled(checked, Analytics.FROM.PANEL);
      this.smartSectionExtension.setRotationEnabled(false, Analytics.FROM.PANEL);
      this.#syncTogglesFromControlState();
    });

    this._rotateBoxCheckId = this.addCheckbox(BOX_TAB_ID, 'Rotate gizmo', false, (checked) => {
      if (checked && !this.smartSectionExtension.isGizmoEnabled()) {
        this.smartSectionExtension.setGizmoEnabled(true, Analytics.FROM.PANEL);
      }
      if (this.smartSectionExtension.isGizmoEnabled()) {
        this.smartSectionExtension.setRotationEnabled(checked, Analytics.FROM.PANEL);
      }
      this.#syncTogglesFromControlState();
    });

    this._showBoxHatchesCheckId = this.addCheckbox(BOX_TAB_ID, 'Show hatches', true, (checked) => {
      this.smartSectionExtension.setCapMeshesEnabled(checked, false, Analytics.FROM.PANEL);
      this.getControl(this._showPlaneHatchesCheckId).setValue(checked);
    });

    this._alignTrueNorthBoxCheckId = this.addCheckbox(BOX_TAB_ID, 'Align true north', false, (checked) => {
      this.smartSectionExtension.setAlignTrueNorthEnabled(checked, Analytics.FROM.PANEL);
      this.getControl(this._alignTrueNorthPlaneCheckId).setValue(checked);
    });

    // Disabled for now, see https://autodesk.atlassian.net/browse/VIZX-3211
    // this.#invertedCheckId = this.addCheckbox(BOX_TAB_ID, 'Invert', false, checked => {
    //     if (this.smartSectionExtension.activeBox) {
    //         this.smartSectionExtension.activeBox.inverted = Boolean(checked);
    //     }
    // });
  }

  addRowForCancelOption(table, mode) {
    const _document = this.getDocument();
    // Cancel Adding Row
    const cancelRow = table.tBodies[0].insertRow(-1);
    this.cancelRows = this.cancelRows || [];
    this.cancelRows.push(cancelRow);
    cancelRow.classList.add('switch-slider-row');
    cancelRow.id = mode + "-Cancel-Row";

    const cancelCell = cancelRow.insertCell();
    const cancelCont = _document.createElement("a");
    cancelCont.classList.add("settings-control-cell");

    // Cancel Icon
    const cancelIcon = _document.createElement("div");
    cancelIcon.classList.add("adsk-icon-undo");
    cancelIcon.classList.add("settings-control-image");
    cancelIcon.style.fontSize = '21px';
    cancelIcon.style.transform = 'translate(0px, -1px)';

    // Cancel Row title
    const cancelSpan = _document.createElement("span");
    cancelSpan.classList.add("settings-control-name");
    cancelSpan.setAttribute("data-i18n", "Cancel");
    cancelSpan.textContent = av.i18n.t("Cancel");
    cancelSpan.style.display = 'inline-block';
    cancelSpan.style.transform = 'translate(0px, -3px)';

    cancelCont.appendChild(cancelIcon);
    cancelCont.appendChild(cancelSpan);
    cancelCell.appendChild(cancelCont);
    cancelRow.style.display = 'none';

    const cancelAddingSection = (e) => {
      this.smartSectionExtension.tool.cancelMousePlacementMode();
      this.smartSectionExtension.analytics.trackPlacementCancelled(mode, Autodesk.Viewing.Extensions.SmartSection.Analytics.FROM.PANEL);
    };
    cancelCont.addEventListener('click', cancelAddingSection, false);

    return cancelRow;
  }

  createControlPanel(tabId, mode) {
    const _document = this.getDocument();
    const table = _document.getElementById(PANEL_ID + '-' + tabId + '-table');

    // Add Row
    const addRow = table.tBodies[0].insertRow(-1);
    this.addRows = this.addRows || [];
    this.addRows.push(addRow);
    addRow.classList.add('switch-slider-row');
    addRow.id = mode + "-Row";

    const addCell = addRow.insertCell();
    const addCont = _document.createElement("a");
    addCont.classList.add("settings-control-cell");

    // Add Icon
    const addIcon = _document.createElement("div");
    addIcon.classList.add("settings-control-image");
    addIcon.style.fontSize = '21px';

    // Add Row title
    const span = _document.createElement("span");
    span.classList.add("settings-control-name");
    span.style.display = 'inline-block';
    span.style.transform = 'translate(0px, -3px)';

    addCont.appendChild(addIcon);
    addCont.appendChild(span);
    addCell.appendChild(addCont);

    const cancelRow = this.addRowForCancelOption(table, mode);

    // Clear all Row
    const clearRow = table.tBodies[0].insertRow();
    clearRow.id = mode + "-Clear-Row";
    this.clearRows = this.clearRows || [];
    this.clearRows.push(clearRow);
    clearRow.classList.add('switch-slider-row');

    const clearCell = clearRow.insertCell();
    const clearCont = _document.createElement("a");
    clearCont.classList.add("settings-control-cell");


    const clearIcon = _document.createElement("div");
    clearIcon.classList.add("adsk-icon-axis-x");
    clearIcon.classList.add("settings-control-image");
    clearIcon.style.transform = 'translate(1px, 1px)';


    const clearSpan = _document.createElement("span");
    clearSpan.classList.add("settings-control-name");
    clearSpan.setAttribute("data-i18n", "Clear all");
    clearSpan.textContent = av.i18n.t("Clear all");

    clearCont.appendChild(clearIcon);
    clearCont.appendChild(clearSpan);
    clearCell.appendChild(clearCont);
    clearRow.style.display = 'none';

    const clearSection = () => {
      if (this.isPlacing) {
        this.smartSectionExtension.tool.cancelMousePlacementMode();
      }
      this.isPlacing = false;

      this.smartSectionExtension.analytics.trackCleared();

      this.smartSectionExtension.resetState();
      this.smartSectionExtension.storeSessionState();

      this.updatePlacementAvailability();
      this.updatePlaneList();
    };

    clearCont.addEventListener('click', clearSection, false);

    const addSection = (e) => {
      this.isPlacing = true;
      this.updatePlacementAvailability();
      this.smartSectionExtension.enterMousePlacementMode(mode.toLowerCase()).then((boxOrPlane) => {
        this.isPlacing = false;
        this.updatePlacementAvailability();
        cancelRow.style.display = 'none';
      });
      addRow.style.display = 'none';
      cancelRow.style.display = '';
    };

    addCont.addEventListener('click', addSection, false);

    // Add icon and label based on mode
    switch (mode) {
      case PLANE_TAB_MODE:{
          const i18nKey = "Add plane";
          span.setAttribute("data-i18n", i18nKey);
          span.textContent = av.i18n.t(i18nKey);

          addIcon.classList.add("adsk-icon-plane-x");
          this.planeRow = addRow;
          this.planeClearRow = clearRow;
          break;
        }
      case BOX_TAB_MODE:{
          const i18nKey = "Add box";
          span.setAttribute("data-i18n", i18nKey);
          span.textContent = av.i18n.t(i18nKey);

          addIcon.classList.add("adsk-icon-box");
          this.boxRow = addRow;
          this.boxClearRow = clearRow;
          break;
        }
      default:
        throw new Error(`[Advanced Sectioning] Unsupported panel mode "${mode}"`);
    }
  }

  createPlaneList() {
    const _document = this.getDocument();
    const table = _document.getElementById(PANEL_ID + '-Plane Mode-table');
    this.planeList = table.tBodies[0].insertRow();
    this.planeList.innerHTML = '<td colspan="3"></td>';
    this.planeList.classList.add('plane-list');
    this.planeListRows = [];
  }

  /**
   * Handles tab selection requested by SmartSection events.
   * @param {{ tab: ('plane'|'box') }} event Event with tab key to select ('plane' or 'box').
   */
  onSelectTab({ tab }) {
    if (tab === 'plane') {
      this.selectTab(PLANE_TAB_ID);
    } else if (tab === 'box') {
      this.selectTab(BOX_TAB_ID);
    }
    this.updatePlacementAvailability();
  }

  /**
   * Updates the state of the plane list rows based on the planes' highlight and visibility states.
   * Does not rebuild the plane list.
   */
  updatePlaneListState() {

    if (!Array.isArray(this.planeListRows) || this.planeListRows.length === 0) {
      return;
    }

    const planes = this.smartSectionExtension.planes;

    for (let i = 0; i < planes.length; i++) {
      const plane = planes[i];
      const row = this.planeListRows[i];

      row.classList.remove('hovered');
      row.classList.remove('selected');

      if (!plane) {
        continue;
      }

      if (plane.highlightState === 'HOVERED') {
        row.classList.add('hovered');
      } else if (plane.highlightState === 'ACTIVE') {
        row.classList.add('selected');
      }

      row.classList.toggle('hidden', !plane.active);

      const visibilityBtn = row.querySelector('a.visibility');
      visibilityBtn.classList.toggle('adsk-icon-visible', plane.active);
      visibilityBtn.classList.toggle('adsk-icon-invisible', !plane.active);
    }
  }

  /**
   * Updates the whole plane list and rebuilds it from scratch.
   * Needed when the number of planes changes.
   */
  updatePlaneList() {

    const planes = this.smartSectionExtension.planes;
    const _document = this.getDocument();

    // reset plane list
    this.planeList.cells[0].innerHTML = '';
    while (this.planeListRows.length) {
      const row = this.planeListRows.pop();
      const visibilityBtn = row.querySelector('a.visibility');
      const deleteBtn = row.querySelector('.btn.delete');
      this.tooltipManager.removeListenersForTooltip(visibilityBtn);
      this.tooltipManager.removeListenersForTooltip(deleteBtn);
    }

    // if the plane list is empty, show the empty state
    if (!planes || planes.length === 0) {
      const emptyRow = _document.createElement('div');

      const background = _document.createElement('div');
      background.className = 'empty-planes-background';

      const icon = _document.createElement('img');
      icon.className = 'folder-icon';
      background.appendChild(icon);

      const text = _document.createElement('p');
      text.setAttribute("data-i18n", "Nothing to display. Add planes.");
      text.textContent = av.i18n.t("Nothing to display. Add planes.");
      text.className = 'empty-planes-text';
      background.appendChild(text);

      emptyRow.appendChild(background);
      this.planeList.cells[0].appendChild(emptyRow);
      return;
    }

    const createListRow = (plane) => {
      const row = _document.createElement('div');
      row.className = 'plane';

      row.classList.toggle('hidden', !plane.active);

      if (plane.highlightState === 'HOVERED') {
        row.classList.add('hovered');
      } else if (plane.highlightState === 'ACTIVE') {
        row.classList.add('selected');
      }

      // visibility button
      const visibilityBtn = _document.createElement('a');
      visibilityBtn.className = 'visibility';
      this.tooltipManager.addListenersForTooltip(_SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.TooltipPositions.TOP, visibilityBtn, "Visibility");

      visibilityBtn.classList.toggle('adsk-icon-visible', plane.active);
      visibilityBtn.classList.toggle('adsk-icon-invisible', !plane.active);

      row.appendChild(visibilityBtn);

      // name label
      const nameSpan = _document.createElement('span');
      nameSpan.className = 'name';
      const i18nKey = 'Plane %(index)';
      const label = av.i18n.t(i18nKey, { index: plane.index });
      nameSpan.setAttribute('data-i18n', JSON.stringify([null, i18nKey, { index: plane.index }]));
      nameSpan.textContent = label;
      row.appendChild(nameSpan);

      // delete button
      const deleteBtn = _document.createElement('a');
      deleteBtn.className = 'btn delete';
      this.tooltipManager.addListenersForTooltip(_SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.TooltipPositions.TOP, deleteBtn, "Delete");
      row.appendChild(deleteBtn);

      return row;
    };

    for (let i = 0; i < planes.length; i++) {
      const plane = planes[i];

      if (!plane) {
        continue;
      }

      const row = createListRow(plane);

      row.addEventListener('mouseenter', () => {
        const plane = this.smartSectionExtension.planes[i];
        if (plane && plane !== this.smartSectionExtension.activePlane) {
          plane.highlightState = 'HOVERED';
          this.viewer.impl.invalidate(false, false, true);
          this.updatePlaneListState();
        }
      });

      row.addEventListener('mouseleave', () => {
        const plane = this.smartSectionExtension.planes[i];
        if (plane && plane !== this.smartSectionExtension.activePlane) {
          plane.highlightState = 'NONE';
          this.viewer.impl.invalidate(false, false, true);
          this.updatePlaneListState();
        }
      });

      row.querySelector('a.visibility').addEventListener('click', (event) => {
        // prevent row click event to simplify the logic
        event.stopPropagation();

        const plane = this.smartSectionExtension.planes[i];

        const active = !plane.active;
        // if the plane is being activated and the currently selected plane is inactive,
        // select the newly activated plane
        const selectPlane = active && !this.smartSectionExtension.activePlane?.active;

        this.smartSectionExtension.setPlaneActive(plane, active, selectPlane);
        this.updatePlaneListState();
      });

      row.querySelector('.btn.delete').addEventListener('click', (event) => {
        event.stopPropagation();
        const plane = this.smartSectionExtension.planes[i];
        this.smartSectionExtension.removeSection(plane, true, Autodesk.Viewing.Extensions.SmartSection.Analytics.FROM.PANEL);
      });

      row.addEventListener('click', () => {
        const plane = this.smartSectionExtension.planes[i];

        const shouldInvalidate = this.smartSectionExtension.activePlane !== plane;

        // activate and select the plane
        this.smartSectionExtension.setActivePlane(plane, true);
        if (shouldInvalidate) {
          this.viewer.impl.invalidate(false, false, true);
        }

        this.updatePlaneListState();
      });

      this.planeList.cells[0].appendChild(row);
      this.planeListRows.push(row);
    }
  }

  getActiveMode() {
    return this.panelTabs.find((it) => /Plane Mode/.test(it.id)).classList.contains('tabselected') ?
    'Plane' : 'Box';
  }

  isInvertChecked() {
    return !!this.getControl(this._invertedCheckId)?.checked;
  }

  updatePlacementAvailability() {
    // show clear option while placementMode is active
    if (this.isPlacing) {
      this.clearRows.forEach((row) => row.style.display = 'none');
      this.addRows.forEach((row) => row.style.display = 'none');
      this.cancelRows.forEach((row) => row.style.display = '');
      return;
    } else {
      this.cancelRows.forEach((row) => row.style.display = 'none');
    }

    // show clear option and add plane
    if (this.smartSectionExtension.hasSections() && !this.smartSectionExtension.isMaxLimitSectionPlanesReached()) {
      this.clearRows.forEach((row) => row.style.display = '');
      const hasBox = !!this.smartSectionExtension.activeBox;
      this.addRows.forEach((row) => {
        row.style.display = this.getActiveMode() === 'Plane' && !hasBox ? '' : 'none';
        row.classList.remove("disabled");
      });
      return;
    }

    if (this.smartSectionExtension.hasSections() && this.smartSectionExtension.isMaxLimitSectionPlanesReached()) {
      this.clearRows.forEach((row) => row.style.display = '');
      if (this.getActiveMode() === 'Plane') {
        this.addRows.forEach((row) => {
          row.classList.add("disabled");
          row.style.display = '';
        });
      } else {
        this.addRows.forEach((row) => row.style.display = 'none');
      }
      return;
    }

    // 0 planes
    this.clearRows.forEach((row) => row.style.display = 'none');
    this.addRows.forEach((row) => {
      row.style.display = '';
      row.classList.remove("disabled");
    });
  }

  #updateAlignTrueNorthAvailability() {
    const alignTrueNorthPlaneCheck = this.getControl(this._alignTrueNorthPlaneCheckId);
    const alignTrueNorthBoxCheck = this.getControl(this._alignTrueNorthBoxCheckId);

    if (!(alignTrueNorthPlaneCheck && alignTrueNorthBoxCheck)) {
      return;
    }

    const noModels = this.viewer.getAllModels().length === 0; // edge case
    const multipleModels = this.viewer.getAllModels().length > 1;
    const trueNorthAngle = this.viewer.model?.getMetadata("custom values")?.angleToTrueNorth;
    const disabled = noModels || multipleModels || !trueNorthAngle; // we treat 0 as true north angle not defined as the toggle won't have any effect

    alignTrueNorthPlaneCheck.setDisabled(disabled);
    alignTrueNorthBoxCheck.setDisabled(disabled);

    if (disabled) {
      alignTrueNorthPlaneCheck.setValue(false);
      alignTrueNorthBoxCheck.setValue(false);
      this.smartSectionExtension?.setAlignTrueNorthEnabled(false, Analytics.FROM.PANEL);

      const tooltipText = noModels ? "No models are loaded" : multipleModels ? "Multiple models are not supported" : "True north not defined for model";
      this.tooltipManager.addListenersForTooltip(_SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.TooltipPositions.TOP, alignTrueNorthPlaneCheck.sliderRow, tooltipText);
      this.tooltipManager.addListenersForTooltip(_SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.TooltipPositions.TOP, alignTrueNorthBoxCheck.sliderRow, tooltipText);
    } else {
      this.tooltipManager.removeListenersForTooltip(alignTrueNorthPlaneCheck.sliderRow);
      this.tooltipManager.removeListenersForTooltip(alignTrueNorthBoxCheck.sliderRow);
    }
  }

  // Initial requirement: https://autodesk.atlassian.net/browse/VIZX-3613
  // Required bug fix: https://autodesk.atlassian.net/browse/VIZX-4305
  #ensureMinOffsetFromRight() {
    const MIN_OFFSET = 65;
    const parentWidth = this.viewer.container.clientWidth;
    const containerWidth = this.container.offsetWidth;
    const currentLeft = parseInt(this.container.style.left) || 0;
    const offsetFromRight = parentWidth - currentLeft - containerWidth;

    // Offset from right edge to avoid Issues toolbar overlap in ACC
    if (this.viewer.isExtensionLoaded('Autodesk.BIM360.Extension.PushPin') && (
    this.container.dockRight || offsetFromRight < MIN_OFFSET)) {
      const newLeft = Math.max(0, parentWidth - containerWidth - MIN_OFFSET);
      this.container.style.left = newLeft + "px";
    }
  }

  setVisible(show) {
    show && this.#syncTogglesFromControlState();
    super.setVisible(show);
    if (show) {
      this.#ensureMinOffsetFromRight();
      this.updatePlacementAvailability();
    }
  }

  #syncTogglesFromControlState() {
    const ext = this.smartSectionExtension;
    // setValue does not fire events, which is what we want here, as the state is already set
    this.getControl(this._showPlanesCheckId)?.setValue(ext.isFrameVisible());
    this.getControl(this._showPlaneGizmoCheckId)?.setValue(ext.isGizmoEnabled());
    this.getControl(this._showPlaneHatchesCheckId)?.setValue(ext.isHatchesEnabled());
    this.getControl(this._rotatePlaneCheckId)?.setValue(ext.isRotationEnabled());
    this.getControl(this._alignTrueNorthPlaneCheckId)?.setValue(ext.isAlignTrueNorthEnabled());
    this.getControl(this._showBoxCheckId)?.setValue(ext.isBoxVisible());
    this.getControl(this._showBoxGizmoCheckId)?.setValue(ext.isGizmoEnabled());
    this.getControl(this._showBoxHatchesCheckId)?.setValue(ext.isHatchesEnabled());
    this.getControl(this._rotateBoxCheckId)?.setValue(ext.isRotationEnabled());
    this.getControl(this._alignTrueNorthBoxCheckId)?.setValue(ext.isAlignTrueNorthEnabled());
  }

  #disableBoxTab() {
    this.#setTabEnabled(BOX_TAB_ID, false);
    this.tooltipManager.addListenersForTooltip(_SmartSectionTooltip_js__WEBPACK_IMPORTED_MODULE_0__.TooltipPositions.TOP, this.boxTab, "Model still loading", 'box-mode-not-available-tooltip');
  }

  #enableBoxTab() {
    this.#setTabEnabled(BOX_TAB_ID, true);
    this.tooltipManager.removeListenersForTooltip(this.boxTab);
  }

  // Helper function as SettingsPanel does not support disabling tabs
  #setTabEnabled(tabId, enabled) {
    const tab = document.getElementById(PANEL_ID + '-' + tabId);

    // Override SettingsPanel.selectTab to enable disabling
    if (!this.originalSelectTab) {
      this.originalSelectTab = this.selectTab.bind(this);
      this.selectTab = (tabId) => {
        if (tab.classList.contains('tab-disabled')) {
          return false;
        }
        return this.originalSelectTab(tabId);
      };
    }

    tab.classList.toggle('tab-disabled', !enabled);
  }

  // Tooltip behavior migrated to TooltipManager
}

/***/ },

/***/ "./extensions/SmartSectionUI/SmartSectionTooltip.js"
/*!**********************************************************!*\
  !*** ./extensions/SmartSectionUI/SmartSectionTooltip.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SmartSectionTooltip: () => (/* binding */ SmartSectionTooltip),
/* harmony export */   TooltipPositions: () => (/* binding */ TooltipPositions)
/* harmony export */ });
const av = Autodesk.Viewing;

const TooltipPositions = {
  TOP: 'top',
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right'
};

/** Gap in pixels between the tooltip and the element it points at, per position. */
const TOOLTIP_GAP = {
  [TooltipPositions.TOP]: 2,
  [TooltipPositions.BOTTOM]: 2,
  [TooltipPositions.LEFT]: 8,
  [TooltipPositions.RIGHT]: 8
};

/** All position modifier classes, so the shared element can be fully reset between shows. */
const POSITION_CLASSES = Object.values(TooltipPositions).map((p) => `adsk-control-tooltip-${p}`);

/**
 * Manages a single reusable tooltip for SmartSection UI controls.
 *
 * The tooltip element is created lazily and appended to the viewer's overlay
 * container (not the control it describes) so it is never clipped by the
 * scrollable panel body. Only one control can be hovered at a time, so a single
 * element is shared and fully reset on every show.
 */
class SmartSectionTooltip {

  /**
   * The mouseover/mouseout listeners registered per element, kept so they can
   * be detached again.
   * @type {Map<HTMLElement, { show: () => void, hide: () => void }>}
   */
  #listeners = new Map();

  /** @type {HTMLElement|null} The shared tooltip element, created on first use. */
  #tooltip = null;

  /** @type {HTMLElement|null} The element the tooltip is currently shown for. */
  #activeElement = null;

  /**
   * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer used to locate the overlay container.
   */
  constructor(viewer) {
    this.viewer = viewer;
  }

  /**
   * Shows a tooltip next to `element` while the pointer is over it.
   * @param {('top'|'bottom'|'left'|'right')} position - Side of the element to show the tooltip on.
   * @param {HTMLElement} element - Element to attach the tooltip to.
   * @param {string} text - Localization key / text to display.
   * @param {string} [id=''] - Optional id for the tooltip element (used for per-tooltip CSS overrides).
   */
  addListenersForTooltip(position = TooltipPositions.TOP, element, text, id = '') {
    if (!element || this.#listeners.has(element)) {
      return;
    }

    const show = () => this._show(position, element, text, id);
    const hide = () => this._hide(element);

    element.addEventListener('mouseover', show);
    element.addEventListener('mouseout', hide);

    this.#listeners.set(element, { show, hide });
  }

  /**
   * Detaches the tooltip listeners from `element` and hides the tooltip if it
   * is currently shown for it.
   * @param {HTMLElement} element - Element to remove tooltip listeners from.
   */
  removeListenersForTooltip(element) {
    const listener = this.#listeners.get(element);
    if (!listener) {
      return;
    }

    this._hide(element);
    element.removeEventListener('mouseover', listener.show);
    element.removeEventListener('mouseout', listener.hide);
    this.#listeners.delete(element);
  }

  /**
   * Detaches all listeners and removes the tooltip element from the DOM.
   */
  dispose() {
    for (const element of [...this.#listeners.keys()]) {
      this.removeListenersForTooltip(element);
    }
    this.#tooltip?.remove();
    this.#tooltip = null;
    this.#activeElement = null;
  }

  /**
   * Positions and reveals the shared tooltip for `element`.
   * @param {('top'|'bottom'|'left'|'right')} position
   * @param {HTMLElement} element
   * @param {string} text
   * @param {string} id
   */
  _show(position, element, text, id) {
    const parentContainer = this.viewer?.clientContainer || this.viewer?.container;
    const container = parentContainer?.firstElementChild;
    const tooltip = this.#getTooltip(container);
    if (!tooltip || !container) {
      return;
    }

    // Reset the shared element to this control's state.
    tooltip.id = id || 'smart-section-tooltip';
    tooltip.classList.remove(...POSITION_CLASSES);
    tooltip.classList.add(`adsk-control-tooltip-${position}`);
    tooltip.setAttribute('data-i18n', text);
    tooltip.textContent = av.i18n.t(text);

    // Measure only after the content is set so centering is accurate.
    const elementBounds = element.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();

    const left = elementBounds.left - containerBounds.left;
    const top = elementBounds.top - containerBounds.top;
    const centerX = left + (elementBounds.width - tooltipBounds.width) / 2;
    const centerY = top + (elementBounds.height - tooltipBounds.height) / 2;

    switch (position) {
      case TooltipPositions.BOTTOM:
        tooltip.style.left = `${centerX}px`;
        tooltip.style.top = `${top + elementBounds.height + TOOLTIP_GAP.bottom}px`;
        break;
      case TooltipPositions.LEFT:
        tooltip.style.left = `${left - tooltipBounds.width - TOOLTIP_GAP.left}px`;
        tooltip.style.top = `${centerY}px`;
        break;
      case TooltipPositions.RIGHT:
        tooltip.style.left = `${left + elementBounds.width + TOOLTIP_GAP.right}px`;
        tooltip.style.top = `${centerY}px`;
        break;
      case TooltipPositions.TOP:
      default:
        tooltip.style.left = `${centerX}px`;
        tooltip.style.top = `${top - tooltipBounds.height - TOOLTIP_GAP.top}px`;
        break;
    }

    this.#activeElement = element;
    tooltip.style.visibility = 'visible';
  }

  /**
   * Hides the tooltip, but only if it is currently shown for `element` so a
   * stale mouseout can't hide another control's tooltip.
   * @param {HTMLElement} element
   */
  _hide(element) {
    if (!this.#tooltip || this.#activeElement !== element) {
      return;
    }
    this.#tooltip.style.visibility = 'hidden';
    this.#activeElement = null;
  }

  /**
   * Lazily creates the shared tooltip element and appends it to `container`.
   * @param {HTMLElement|null} container
   * @returns {HTMLElement|null}
   */
  #getTooltip(container) {
    if (this.#tooltip) {
      return this.#tooltip;
    }
    if (!container) {
      return null;
    }
    this.#tooltip = this.#getDocument().createElement('div');
    // Hide until first positioned so it doesn't flash at the top-left corner.
    this.#tooltip.style.visibility = 'hidden';
    this.#tooltip.style.position = 'absolute';
    container.appendChild(this.#tooltip);
    return this.#tooltip;
  }

  /**
   * Returns the document associated with the viewer environment.
   * @returns {Document}
   */
  #getDocument() {
    // SmartSectionPanel uses SettingsPanel.getDocument(); in viewer context it's window.document.
    return this.viewer?.container?.ownerDocument || window.document;
  }
}



/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/SmartSectionUI/SmartSectionPanel.css"
/*!*********************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/SmartSectionUI/SmartSectionPanel.css ***!
  \*********************************************************************************************************************************************************************************************************************************************************************/
(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/noSourceMaps.js */ "./node_modules/css-loader/dist/runtime/noSourceMaps.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/api.js */ "./node_modules/css-loader/dist/runtime/api.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/getUrl.js */ "./node_modules/css-loader/dist/runtime/getUrl.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);
// Imports



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! ./res/minimize_dark.svg */ "./extensions/SmartSectionUI/res/minimize_dark.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! ./res/minimize_dark_hover.svg */ "./extensions/SmartSectionUI/res/minimize_dark_hover.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_2___ = new URL(/* asset import */ __webpack_require__(/*! ./res/minimize.svg */ "./extensions/SmartSectionUI/res/minimize.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_3___ = new URL(/* asset import */ __webpack_require__(/*! ./res/minimize_hover.svg */ "./extensions/SmartSectionUI/res/minimize_hover.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_4___ = new URL(/* asset import */ __webpack_require__(/*! res/delete-icon.svg */ "./extensions/SmartSectionUI/res/delete-icon.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_5___ = new URL(/* asset import */ __webpack_require__(/*! res/delete-icon-light.svg */ "./extensions/SmartSectionUI/res/delete-icon-light.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_6___ = new URL(/* asset import */ __webpack_require__(/*! ./res/folder_dark.svg */ "./extensions/SmartSectionUI/res/folder_dark.svg"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_7___ = new URL(/* asset import */ __webpack_require__(/*! ./res/folder_light.svg */ "./extensions/SmartSectionUI/res/folder_light.svg"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);
var ___CSS_LOADER_URL_REPLACEMENT_2___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_2___);
var ___CSS_LOADER_URL_REPLACEMENT_3___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_3___);
var ___CSS_LOADER_URL_REPLACEMENT_4___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_4___);
var ___CSS_LOADER_URL_REPLACEMENT_5___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_5___);
var ___CSS_LOADER_URL_REPLACEMENT_6___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_6___);
var ___CSS_LOADER_URL_REPLACEMENT_7___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_7___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-viewing-viewer .section-panel.docking-panel {
  top: 15px;
  border-radius: 6px;
  width: 230px;
  height: 500px;
  min-width: 225px !important;
  min-height: 70px;
}

/* Scroller */
.adsk-viewing-viewer .section-panel.docking-panel .docking-panel-scroll.right {
  top: 40px !important;
}

.adsk-viewing-viewer .section-panel.docking-panel.minimized .settings-tabs {
  z-index: -1;
}

.adsk-viewing-viewer .section-panel.docking-panel .section-panel-minimize {
  top: 0;
  right: 25px;
  width: 25px;
  height: 50px;
  background-position: 0px 19px;
  background-repeat: no-repeat;
  cursor: pointer;
  position: absolute;
  z-index: 1;
}

.adsk-viewing-viewer.dark-theme .section-panel.docking-panel .section-panel-minimize {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
}

.adsk-viewing-viewer.dark-theme .section-panel.docking-panel .section-panel-minimize:hover {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});
}

.adsk-viewing-viewer.light-theme .section-panel.docking-panel .section-panel-minimize,
.adsk-viewing-viewer.acs-theme .section-panel.docking-panel .section-panel-minimize {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});
}

.adsk-viewing-viewer.light-theme .section-panel.docking-panel .section-panel-minimize:hover,
.adsk-viewing-viewer.acs-theme .section-panel.docking-panel .section-panel-minimize:hover {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_3___});
}

.adsk-viewing-viewer .section-panel.docking-panel .docking-panel-scroll.right .settings-tabs-tables-container .adsk-lmv-tftable tr.switch-slider-row td {
  padding: 8px;
  height: 28px;
}

.adsk-viewing-viewer .section-panel.docking-panel .docking-panel-scroll.right .settings-tabs-tables-container .adsk-lmv-tftable tr.switch-slider-row td:nth-child(2) {
  width: 20%;
}

.adsk-viewing-viewer .section-panel.docking-panel .docking-panel-scroll.right .settings-tabs-tables-container .adsk-lmv-tftable tr.switch-slider-row td:nth-child(1) {
  width: 65px;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs ul li {
  overflow: hidden;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs ul li a {
  display: flex;
  align-items: center;
  position: static;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs ul li a:hover {
  color: #1dc6f2;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs .tabselected a {
  border: 1px solid transparent;
  color: #38abdf;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs .tabselected a:hover {
  border: 1px solid transparent;
  color: #38abdf;
}

.adsk-viewing-viewer.dark-theme .section-panel.docking-panel .settings-tabs .tabselected a {
  border: 1px solid transparent;
  color: #1dc6f2;
}

.adsk-viewing-viewer.dark-theme .section-panel.docking-panel .settings-tabs .tabselected a:hover {
  border: 1px solid transparent;
  color: #1dc6f2;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs a {
  min-width: inherit;
  padding-right: 5px;
  color: currentColor;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-tabs span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  top: 2px;
  padding-right: 6px;
  text-align: center;
}

#smart-section-panel .docking-panel-title {
  padding-right: 58px;
}

#plane-icon-div,
#box-icon-div {
  font-size: 24px;
  cursor: pointer;
  width: 28px;
  height: 28px;
  padding: 4px;
  margin: 4px 4px 2px 6px;
  flex-shrink: 0;
}

#info-icon.adsk-icon-info {
  font-size: 16px;
  margin: 4px;
  top: 2px;
  position: relative;
  color: #38abdf;
}

.smartsection {
  min-width: 50% !important;
}

.disabled {
  color: lightgray;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-control-cell {
  height: 32px;
  width: 100%;
  display: block;
  text-align: left;
  cursor: pointer;
  color: currentColor;
  text-decoration: none;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-control-image {
  top: 4px;
  width: 28px;
  height: 24px;
  position: relative;
  display: inline-block;
  font-size: 17px;
}

.adsk-viewing-viewer .section-panel.docking-panel .settings-control-name {
  position: relative;
  font-size: 13px;
  font-weight: 600;
  top: 1px;
}

.adsk-viewing-viewer .section-panel .adsk-lmv-tftable tr.logical-group td div {
  padding-left: 3px;
}

.adsk-viewing-viewer .section-panel .adsk-lmv-tftable tr.logical-group:first-child td {
  padding: 0px 10px 0px 16px;
}

.adsk-viewing-viewer .section-panel .adsk-lmv-tftable tr.logical-group:first-child {
  height: 40px;
}

.adsk-viewing-viewer .section-panel .logic-group-collapse-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  font-size: 16px;
  background-size: contain;
  background-repeat: no-repeat;
  margin-right: 7px;
  cursor: pointer;
}

/* Fallback for any theme */
.adsk-viewing-viewer .section-panel .logic-group-collapse-icon.collapsed {
  transform: translateX(-3px) translateY(3px) rotate(-90deg);
}

.adsk-viewing-viewer .section-panel .logic-group-collapse-icon:not(.collapsed) {
  transform: translateX(-2px) translateY(3px);
}

/* Theme-specific overrides */
.adsk-viewing-viewer.dark-theme .section-panel .logic-group-collapse-icon.collapsed {
  transform: translateX(-3px) translateY(3px) rotate(-90deg);
}

.adsk-viewing-viewer.light-theme .section-panel .logic-group-collapse-icon.collapsed {
  transform: translateX(-3px) translateY(3px) rotate(-90deg);
}

.adsk-viewing-viewer.dark-theme .section-panel .logic-group-collapse-icon:not(.collapsed) {
  transform: translateX(-2px) translateY(3px);
}

.adsk-viewing-viewer.light-theme .section-panel .logic-group-collapse-icon:not(.collapsed) {
  transform: translateX(-2px) translateY(3px);
}

/* Section plane List */
#smart-section-panel .plane {
  display: flex;
  align-items: center;
}

#smart-section-panel .plane a.visibility {
  cursor: pointer;
  flex-shrink: 0;
  font-size: 21px;
  padding-top: 4px;
  margin-right: 8px;
}

#smart-section-panel .plane .btn {
  cursor: pointer;
  width: 16px;
  height: 16px;
  display: block;
  padding: 10px;
  background-repeat: no-repeat;
  background-position: center;
}

#smart-section-panel .plane .btn.delete {
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.2s;
  background-size: 19px;
  padding-top: 9px;
  flex-shrink: 0;
  margin-left: auto;
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_4___});
}

#smart-section-panel .plane:hover .btn.delete {
  visibility: visible;
  opacity: 1;
}

.adsk-viewing-viewer.dark-theme #smart-section-panel .plane .btn.delete {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_5___});
}

#smart-section-panel .plane .name {
  line-height: 36px;
  font-size: 13px;
  flex: 1;
  min-width: 0;
}

#smart-section-panel .plane.hidden .name {
  opacity: 0.5;
}

#smart-section-panel .plane.hovered {
  background-color: rgba(204, 204, 204, 0.2);
}

.adsk-viewing-viewer.dark-theme #smart-section-panel .plane.hovered {
  background-color: rgba(255, 255, 255, 0.1);
}

#smart-section-panel .plane.selected {
  background-color: rgba(205, 234, 247, 0.6);
}

.adsk-viewing-viewer.dark-theme #smart-section-panel .plane.selected {
  background-color: rgba(255, 255, 255, 0.2);
}

#smart-section-panel .collapsed-item {
  display: none;
}

#smart-section-panel .plane-list {
  height: 108px;
  vertical-align: top;
}

#smart-section-panel .plane-list td {
  padding: 0px;
}

#smart-section-panel .empty-planes-background {
  padding: 0px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#smart-section-panel .empty-planes-background .folder-icon {
  padding-top: 5px;
}

#smart-section-panel .empty-planes-background .empty-planes-text {
  margin: 0px;
  font-weight: 300;
  font-size: 0.65rem;
}

.adsk-viewing-viewer.dark-theme #smart-section-panel .empty-planes-background .folder-icon {
  content: url(${___CSS_LOADER_URL_REPLACEMENT_6___});
}

.adsk-viewing-viewer.acs-theme #smart-section-panel .empty-planes-background .folder-icon,
.adsk-viewing-viewer.light-theme #smart-section-panel .empty-planes-background .folder-icon {
  /* acc-viewer-ui uses \`acs-theme\` for its light theme; without this, the <img> has no src/content and renders blank. */
  content: url(${___CSS_LOADER_URL_REPLACEMENT_7___});
}

#smart-section-panel .settings-control-name {
  display: inline-block;
  vertical-align: middle;
  max-width: calc(100% - 40px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#smart-section-panel .tab-disabled {
  opacity: 0.5;
  color: lightgray;
}

#smart-section-panel .tab-disabled a:hover {
  color: lightgray;
}

#smart-section-panel .disabled .adsk-icon-plane-x {
  color: inherit;
}

#smart-section-panel tr.switch-slider-row:has(input:disabled) {
  opacity: 0.5;
}`, ""]);
// Exports
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);


/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/SmartSectionUI/SmartSectionPanelTooltips.css"
/*!*****************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/SmartSectionUI/SmartSectionPanelTooltips.css ***!
  \*****************************************************************************************************************************************************************************************************************************************************************************/
(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/noSourceMaps.js */ "./node_modules/css-loader/dist/runtime/noSourceMaps.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/api.js */ "./node_modules/css-loader/dist/runtime/api.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-viewing-viewer .adsk-control:hover > .adsk-control-tooltip-top,
.adsk-viewing-viewer .adsk-control:hover > .adsk-control-tooltip-bottom,
.adsk-viewing-viewer .adsk-control:hover > .adsk-control-tooltip-left,
.adsk-viewing-viewer .adsk-control:hover > .adsk-control-tooltip-right {
  visibility: visible;
}

/* Base tooltip styles */
.adsk-viewing-viewer .adsk-control-tooltip-top,
.adsk-viewing-viewer .adsk-control-tooltip-bottom,
.adsk-viewing-viewer .adsk-control-tooltip-left,
.adsk-viewing-viewer .adsk-control-tooltip-right {
  position: absolute;
  z-index: 30;
  font-size: 11px;
  text-align: left;
  line-height: 1.2;
  white-space: normal;
  opacity: 1;
  border-radius: 2px;
  visibility: hidden;
  padding: 8px !important;
  height: auto;
  width: auto;
  pointer-events: none;
}

/**
** Tooltip arrow styles
    acc-viewer-ui uses dark-theme and acs-theme for theming.
    light-theme is added here for consistency with other tooltips in the viewer.
    To make it work in acc-viewer-ui, acs-theme styles classes had to be added.
**/
.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-top,
.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-bottom,
.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-left,
.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-right,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-top,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-bottom,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-left,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-right {
  background-color: #3C3C3C;
  color: #FFFFFF;
}

.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-top,
.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-bottom,
.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-left,
.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-right {
  background-color: #DCDCDC;
  color: #3C3C3C;
}

.adsk-viewing-viewer .adsk-control-tooltip-top::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -4px;
  border-width: 4px 4px 0 4px;
  border-style: solid;
  clip-path: polygon(50% 100%, 0 0, 100% 0);
}

.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-top::after,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-top::after {
  border-color: #3C3C3C transparent transparent transparent;
}

.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-top::after {
  border-color: #DCDCDC transparent transparent transparent;
}

.adsk-viewing-viewer .adsk-control-tooltip-bottom::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  margin-left: -4px;
  border-width: 0 4px 4px 4px;
  border-style: solid;
  clip-path: polygon(50% 0, 0 100%, 100% 100%);
}

.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-bottom::after,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-bottom::after {
  border-color: transparent transparent #3C3C3C transparent;
}

.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-bottom::after {
  border-color: transparent transparent #DCDCDC transparent;
}

.adsk-viewing-viewer .adsk-control-tooltip-left::after {
  content: "";
  position: absolute;
  left: 100%;
  top: 50%;
  margin-top: -4px;
  border-width: 4px 0 4px 4px;
  border-style: solid;
  clip-path: polygon(100% 46%, 0 0, 0 100%);
}

.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-left::after,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-left::after {
  border-color: transparent transparent transparent #3C3C3C;
}

.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-left::after {
  border-color: transparent transparent transparent #DCDCDC;
}

.adsk-viewing-viewer .adsk-control-tooltip-right::after {
  content: "";
  position: absolute;
  right: 100%;
  top: 50%;
  margin-top: -4px;
  border-width: 4px 4px 4px 0;
  border-style: solid;
  clip-path: polygon(0 50%, 100% 0, 100% 100%);
}

.adsk-viewing-viewer.acs-theme .adsk-control-tooltip-right::after,
.adsk-viewing-viewer.light-theme .adsk-control-tooltip-right::after {
  border-color: transparent #3C3C3C transparent transparent;
}

.adsk-viewing-viewer.dark-theme .adsk-control-tooltip-right::after {
  border-color: transparent #DCDCDC transparent transparent;
}

.adsk-viewing-viewer .adsk-control-tooltip-parent {
  position: relative;
}

#section-control-tooltip {
  text-transform: none;
  width: 153px;
  max-height: 40px;
  height: auto;
  word-wrap: break-word;
  text-wrap-mode: wrap;
  text-align: left;
  transform: none;
}`, ""]);
// Exports
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);


/***/ },

/***/ "./node_modules/css-loader/dist/runtime/api.js"
/*!*****************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/api.js ***!
  \*****************************************************/
(module) {

"use strict";


/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
module.exports = function (cssWithMappingToString) {
  var list = [];

  // return the list of modules as css string
  list.toString = function toString() {
    return this.map(function (item) {
      var content = "";
      var needLayer = typeof item[5] !== "undefined";
      if (item[4]) {
        content += "@supports (".concat(item[4], ") {");
      }
      if (item[2]) {
        content += "@media ".concat(item[2], " {");
      }
      if (needLayer) {
        content += "@layer".concat(item[5].length > 0 ? " ".concat(item[5]) : "", " {");
      }
      content += cssWithMappingToString(item);
      if (needLayer) {
        content += "}";
      }
      if (item[2]) {
        content += "}";
      }
      if (item[4]) {
        content += "}";
      }
      return content;
    }).join("");
  };

  // import a list of modules into the list
  list.i = function i(modules, media, dedupe, supports, layer) {
    if (typeof modules === "string") {
      modules = [[null, modules, undefined]];
    }
    var alreadyImportedModules = {};
    if (dedupe) {
      for (var k = 0; k < this.length; k++) {
        var id = this[k][0];
        if (id != null) {
          alreadyImportedModules[id] = true;
        }
      }
    }
    for (var _k = 0; _k < modules.length; _k++) {
      var item = [].concat(modules[_k]);
      if (dedupe && alreadyImportedModules[item[0]]) {
        continue;
      }
      if (typeof layer !== "undefined") {
        if (typeof item[5] === "undefined") {
          item[5] = layer;
        } else {
          item[1] = "@layer".concat(item[5].length > 0 ? " ".concat(item[5]) : "", " {").concat(item[1], "}");
          item[5] = layer;
        }
      }
      if (media) {
        if (!item[2]) {
          item[2] = media;
        } else {
          item[1] = "@media ".concat(item[2], " {").concat(item[1], "}");
          item[2] = media;
        }
      }
      if (supports) {
        if (!item[4]) {
          item[4] = "".concat(supports);
        } else {
          item[1] = "@supports (".concat(item[4], ") {").concat(item[1], "}");
          item[4] = supports;
        }
      }
      list.push(item);
    }
  };
  return list;
};

/***/ },

/***/ "./node_modules/css-loader/dist/runtime/getUrl.js"
/*!********************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/getUrl.js ***!
  \********************************************************/
(module) {

"use strict";


module.exports = function (url, options) {
  if (!options) {
    options = {};
  }
  if (!url) {
    return url;
  }
  url = String(url.__esModule ? url.default : url);

  // If url is already wrapped in quotes, remove them
  if (/^['"].*['"]$/.test(url)) {
    url = url.slice(1, -1);
  }
  if (options.hash) {
    url += options.hash;
  }

  // Should url be wrapped?
  // See https://drafts.csswg.org/css-values-3/#urls
  if (/["'() \t\n]|(%20)/.test(url) || options.needQuotes) {
    return "\"".concat(url.replace(/"/g, '\\"').replace(/\n/g, "\\n"), "\"");
  }
  return url;
};

/***/ },

/***/ "./node_modules/css-loader/dist/runtime/noSourceMaps.js"
/*!**************************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/noSourceMaps.js ***!
  \**************************************************************/
(module) {

"use strict";


module.exports = function (i) {
  return i[1];
};

/***/ },

/***/ "./extensions/SmartSectionUI/SmartSectionPanel.css"
/*!*********************************************************!*\
  !*** ./extensions/SmartSectionUI/SmartSectionPanel.css ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js */ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/styleDomAPI.js */ "./node_modules/style-loader/dist/runtime/styleDomAPI.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/insertBySelector.js */ "./node_modules/style-loader/dist/runtime/insertBySelector.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js */ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/insertStyleElement.js */ "./node_modules/style-loader/dist/runtime/insertStyleElement.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/styleTagTransform.js */ "./node_modules/style-loader/dist/runtime/styleTagTransform.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanel_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./SmartSectionPanel.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/SmartSectionUI/SmartSectionPanel.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanel_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanel_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanel_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanel_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


/***/ },

/***/ "./extensions/SmartSectionUI/SmartSectionPanelTooltips.css"
/*!*****************************************************************!*\
  !*** ./extensions/SmartSectionUI/SmartSectionPanelTooltips.css ***!
  \*****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js */ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/styleDomAPI.js */ "./node_modules/style-loader/dist/runtime/styleDomAPI.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/insertBySelector.js */ "./node_modules/style-loader/dist/runtime/insertBySelector.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js */ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/insertStyleElement.js */ "./node_modules/style-loader/dist/runtime/insertStyleElement.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/styleTagTransform.js */ "./node_modules/style-loader/dist/runtime/styleTagTransform.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanelTooltips_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./SmartSectionPanelTooltips.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/SmartSectionUI/SmartSectionPanelTooltips.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanelTooltips_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanelTooltips_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanelTooltips_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_SmartSectionPanelTooltips_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


/***/ },

/***/ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js"
/*!****************************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js ***!
  \****************************************************************************/
(module) {

"use strict";


var stylesInDOM = [];
function getIndexByIdentifier(identifier) {
  var result = -1;
  for (var i = 0; i < stylesInDOM.length; i++) {
    if (stylesInDOM[i].identifier === identifier) {
      result = i;
      break;
    }
  }
  return result;
}
function modulesToDom(list, options) {
  var idCountMap = {};
  var identifiers = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var id = options.base ? item[0] + options.base : item[0];
    var count = idCountMap[id] || 0;
    var identifier = "".concat(id, " ").concat(count);
    idCountMap[id] = count + 1;
    var indexByIdentifier = getIndexByIdentifier(identifier);
    var obj = {
      css: item[1],
      media: item[2],
      sourceMap: item[3],
      supports: item[4],
      layer: item[5]
    };
    if (indexByIdentifier !== -1) {
      stylesInDOM[indexByIdentifier].references++;
      stylesInDOM[indexByIdentifier].updater(obj);
    } else {
      var updater = addElementStyle(obj, options);
      options.byIndex = i;
      stylesInDOM.splice(i, 0, {
        identifier: identifier,
        updater: updater,
        references: 1
      });
    }
    identifiers.push(identifier);
  }
  return identifiers;
}
function addElementStyle(obj, options) {
  var api = options.domAPI(options);
  api.update(obj);
  var updater = function updater(newObj) {
    if (newObj) {
      if (newObj.css === obj.css && newObj.media === obj.media && newObj.sourceMap === obj.sourceMap && newObj.supports === obj.supports && newObj.layer === obj.layer) {
        return;
      }
      api.update(obj = newObj);
    } else {
      api.remove();
    }
  };
  return updater;
}
module.exports = function (list, options) {
  options = options || {};
  list = list || [];
  var lastIdentifiers = modulesToDom(list, options);
  return function update(newList) {
    newList = newList || [];
    for (var i = 0; i < lastIdentifiers.length; i++) {
      var identifier = lastIdentifiers[i];
      var index = getIndexByIdentifier(identifier);
      stylesInDOM[index].references--;
    }
    var newLastIdentifiers = modulesToDom(newList, options);
    for (var _i = 0; _i < lastIdentifiers.length; _i++) {
      var _identifier = lastIdentifiers[_i];
      var _index = getIndexByIdentifier(_identifier);
      if (stylesInDOM[_index].references === 0) {
        stylesInDOM[_index].updater();
        stylesInDOM.splice(_index, 1);
      }
    }
    lastIdentifiers = newLastIdentifiers;
  };
};

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/insertBySelector.js"
/*!********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/insertBySelector.js ***!
  \********************************************************************/
(module) {

"use strict";


var memo = {};

/* istanbul ignore next  */
function getTarget(target) {
  if (typeof memo[target] === "undefined") {
    var styleTarget = document.querySelector(target);

    // Special case to return head of iframe instead of iframe itself
    if (window.HTMLIFrameElement && styleTarget instanceof window.HTMLIFrameElement) {
      try {
        // This will throw an exception if access to iframe is blocked
        // due to cross-origin restrictions
        styleTarget = styleTarget.contentDocument.head;
      } catch (e) {
        // istanbul ignore next
        styleTarget = null;
      }
    }
    memo[target] = styleTarget;
  }
  return memo[target];
}

/* istanbul ignore next  */
function insertBySelector(insert, style) {
  var target = getTarget(insert);
  if (!target) {
    throw new Error("Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.");
  }
  target.appendChild(style);
}
module.exports = insertBySelector;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/insertStyleElement.js"
/*!**********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/insertStyleElement.js ***!
  \**********************************************************************/
(module) {

"use strict";


/* istanbul ignore next  */
function insertStyleElement(options) {
  var element = document.createElement("style");
  options.setAttributes(element, options.attributes);
  options.insert(element, options.options);
  return element;
}
module.exports = insertStyleElement;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js"
/*!**********************************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js ***!
  \**********************************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";


/* istanbul ignore next  */
function setAttributesWithoutAttributes(styleElement) {
  var nonce =  true ? __webpack_require__.nc : 0;
  if (nonce) {
    styleElement.setAttribute("nonce", nonce);
  }
}
module.exports = setAttributesWithoutAttributes;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/styleDomAPI.js"
/*!***************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/styleDomAPI.js ***!
  \***************************************************************/
(module) {

"use strict";


/* istanbul ignore next  */
function apply(styleElement, options, obj) {
  var css = "";
  if (obj.supports) {
    css += "@supports (".concat(obj.supports, ") {");
  }
  if (obj.media) {
    css += "@media ".concat(obj.media, " {");
  }
  var needLayer = typeof obj.layer !== "undefined";
  if (needLayer) {
    css += "@layer".concat(obj.layer.length > 0 ? " ".concat(obj.layer) : "", " {");
  }
  css += obj.css;
  if (needLayer) {
    css += "}";
  }
  if (obj.media) {
    css += "}";
  }
  if (obj.supports) {
    css += "}";
  }
  var sourceMap = obj.sourceMap;
  if (sourceMap && typeof btoa !== "undefined") {
    css += "\n/*# sourceMappingURL=data:application/json;base64,".concat(btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))), " */");
  }

  // For old IE
  /* istanbul ignore if  */
  options.styleTagTransform(css, styleElement, options.options);
}
function removeStyleElement(styleElement) {
  // istanbul ignore if
  if (styleElement.parentNode === null) {
    return false;
  }
  styleElement.parentNode.removeChild(styleElement);
}

/* istanbul ignore next  */
function domAPI(options) {
  if (typeof document === "undefined") {
    return {
      update: function update() {},
      remove: function remove() {}
    };
  }
  var styleElement = options.insertStyleElement(options);
  return {
    update: function update(obj) {
      apply(styleElement, options, obj);
    },
    remove: function remove() {
      removeStyleElement(styleElement);
    }
  };
}
module.exports = domAPI;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/styleTagTransform.js"
/*!*********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/styleTagTransform.js ***!
  \*********************************************************************/
(module) {

"use strict";


/* istanbul ignore next  */
function styleTagTransform(css, styleElement) {
  if (styleElement.styleSheet) {
    styleElement.styleSheet.cssText = css;
  } else {
    while (styleElement.firstChild) {
      styleElement.removeChild(styleElement.firstChild);
    }
    styleElement.appendChild(document.createTextNode(css));
  }
}
module.exports = styleTagTransform;

/***/ },

/***/ "./extensions/SmartSectionUI/res/delete-icon-light.svg"
/*!*************************************************************!*\
  !*** ./extensions/SmartSectionUI/res/delete-icon-light.svg ***!
  \*************************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE4LjUzIDE3LjQ3QzE4LjY3MDQgMTcuNjEwNiAxOC43NDkzIDE3LjgwMTIgMTguNzQ5MyAxOEMxOC43NDkzIDE4LjE5ODcgMTguNjcwNCAxOC4zODk0IDE4LjUzIDE4LjUzQzE4LjM4OTMgMTguNjcwNSAxOC4xOTg3IDE4Ljc0OTMgMTggMTguNzQ5M0MxNy44MDEyIDE4Ljc0OTMgMTcuNjEwNiAxOC42NzA1IDE3LjQ2OTkgMTguNTNMMTIgMTMuMDZMNi41Mjk5NSAxOC41M0M2LjM4OTMzIDE4LjY3MDUgNi4xOTg3IDE4Ljc0OTMgNS45OTk5NSAxOC43NDkzQzUuODAxMiAxOC43NDkzIDUuNjEwNTggMTguNjcwNSA1LjQ2OTk1IDE4LjUzQzUuMzI5NSAxOC4zODk0IDUuMjUwNjEgMTguMTk4NyA1LjI1MDYxIDE4QzUuMjUwNjEgMTcuODAxMiA1LjMyOTUgMTcuNjEwNiA1LjQ2OTk1IDE3LjQ3TDEwLjkzOTkgMTJMNS40Njk5NSA2LjUzQzUuMzM3NDcgNi4zODc4MiA1LjI2NTM1IDYuMTk5NzggNS4yNjg3OCA2LjAwNTQ4QzUuMjcyMiA1LjgxMTE4IDUuMzUwOTIgNS42MjU3OSA1LjQ4ODMzIDUuNDg4MzhDNS42MjU3NCA1LjM1MDk2IDUuODExMTMgNS4yNzIyNSA2LjAwNTQzIDUuMjY4ODJDNi4xOTk3MyA1LjI2NTQgNi4zODc3OCA1LjMzNzUyIDYuNTI5OTUgNS40N0wxMiAxMC45NEwxNy40Njk5IDUuNDdDMTcuNjEyMSA1LjMzNzUyIDE3LjgwMDIgNS4yNjU0IDE3Ljk5NDUgNS4yNjg4MkMxOC4xODg4IDUuMjcyMjUgMTguMzc0MiA1LjM1MDk2IDE4LjUxMTYgNS40ODgzOEMxOC42NDkgNS42MjU3OSAxOC43Mjc3IDUuODExMTggMTguNzMxMSA2LjAwNTQ4QzE4LjczNDYgNi4xOTk3OCAxOC42NjI0IDYuMzg3ODIgMTguNTMgNi41M0wxMy4wNiAxMkwxOC41MyAxNy40N1oiIGZpbGw9IiNFQkVCRUIiLz4KPC9zdmc+Cg==";

/***/ },

/***/ "./extensions/SmartSectionUI/res/delete-icon.svg"
/*!*******************************************************!*\
  !*** ./extensions/SmartSectionUI/res/delete-icon.svg ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE4LjUzIDE3LjQ3QzE4LjY3MDQgMTcuNjEwNiAxOC43NDkzIDE3LjgwMTIgMTguNzQ5MyAxOEMxOC43NDkzIDE4LjE5ODcgMTguNjcwNCAxOC4zODk0IDE4LjUzIDE4LjUzQzE4LjM4OTMgMTguNjcwNSAxOC4xOTg3IDE4Ljc0OTMgMTggMTguNzQ5M0MxNy44MDEyIDE4Ljc0OTMgMTcuNjEwNiAxOC42NzA1IDE3LjQ2OTkgMTguNTNMMTIgMTMuMDZMNi41Mjk5NSAxOC41M0M2LjM4OTMzIDE4LjY3MDUgNi4xOTg3IDE4Ljc0OTMgNS45OTk5NSAxOC43NDkzQzUuODAxMiAxOC43NDkzIDUuNjEwNTggMTguNjcwNSA1LjQ2OTk1IDE4LjUzQzUuMzI5NSAxOC4zODk0IDUuMjUwNjEgMTguMTk4NyA1LjI1MDYxIDE4QzUuMjUwNjEgMTcuODAxMiA1LjMyOTUgMTcuNjEwNiA1LjQ2OTk1IDE3LjQ3TDEwLjkzOTkgMTJMNS40Njk5NSA2LjUzQzUuMzM3NDcgNi4zODc4MiA1LjI2NTM1IDYuMTk5NzggNS4yNjg3OCA2LjAwNTQ4QzUuMjcyMiA1LjgxMTE4IDUuMzUwOTIgNS42MjU3OSA1LjQ4ODMzIDUuNDg4MzhDNS42MjU3NCA1LjM1MDk2IDUuODExMTMgNS4yNzIyNSA2LjAwNTQzIDUuMjY4ODJDNi4xOTk3MyA1LjI2NTQgNi4zODc3OCA1LjMzNzUyIDYuNTI5OTUgNS40N0wxMiAxMC45NEwxNy40Njk5IDUuNDdDMTcuNjEyMSA1LjMzNzUyIDE3LjgwMDIgNS4yNjU0IDE3Ljk5NDUgNS4yNjg4MkMxOC4xODg4IDUuMjcyMjUgMTguMzc0MiA1LjM1MDk2IDE4LjUxMTYgNS40ODgzOEMxOC42NDkgNS42MjU3OSAxOC43Mjc3IDUuODExMTggMTguNzMxMSA2LjAwNTQ4QzE4LjczNDYgNi4xOTk3OCAxOC42NjI0IDYuMzg3ODIgMTguNTMgNi41M0wxMy4wNiAxMkwxOC41MyAxNy40N1oiIGZpbGw9IiMzQzNDM0MiLz4KPC9zdmc+Cg==";

/***/ },

/***/ "./extensions/SmartSectionUI/res/folder_dark.svg"
/*!*******************************************************!*\
  !*** ./extensions/SmartSectionUI/res/folder_dark.svg ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzMiIGhlaWdodD0iNzMiIHZpZXdCb3g9IjAgMCA3MyA3MyIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTYwLjg2NzIgNTkuNTI4OUg4Ljc1OTc3TDE1LjEyMDUgMjguNTEzNkMxNS4yNTA0IDI3Ljc4MTEgMTUuNjI5NSAyNy4xMTYgMTYuMTkzNiAyNi42MzA4QzE2Ljc1NzYgMjYuMTQ1NyAxNy40NzIgMjUuODcwNCAxOC4yMTU3IDI1Ljg1MTZINjQuNjI0MkM2NS4wMTc1IDI1Ljg2ODYgNjUuNDAyMiAyNS45NzI1IDY1Ljc1MDYgMjYuMTU1OEM2Ni4wOTkgMjYuMzM5MSA2Ni40MDI1IDI2LjU5NzMgNjYuNjM5MyAyNi45MTE4QzY2Ljg3NjEgMjcuMjI2MyA2Ny4wNDA0IDI3LjU4OTMgNjcuMTIwMyAyNy45NzQ4QzY3LjIwMDEgMjguMzYwMyA2Ny4xOTM3IDI4Ljc1ODcgNjcuMTAxNCAyOS4xNDE0TDYwLjg2NzIgNTkuNTI4OVoiIGZpbGw9IiM5OTk5OTkiIHN0cm9rZT0iIzk5OTk5OSIgc3Ryb2tlLXdpZHRoPSIwLjc1IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPHBhdGggZD0iTTguNzU5NzcgNTkuNTI4OFYxMy40NzA3SDIzLjUwNThMMjYuMzU3NiAxOC40NjM5SDU3LjUwNDNDNTguMTAxOSAxOC40NjM5IDU4LjY3NSAxOC43MDEzIDU5LjA5NzYgMTkuMTIzOUM1OS41MjAyIDE5LjU0NjQgNTkuNzU3NiAyMC4xMTk2IDU5Ljc1NzYgMjAuNzE3MlYyNC4wMDIyIiBzdHJva2U9IiNDQ0NDQ0MiIHN0cm9rZS13aWR0aD0iMC43NSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=";

/***/ },

/***/ "./extensions/SmartSectionUI/res/folder_light.svg"
/*!********************************************************!*\
  !*** ./extensions/SmartSectionUI/res/folder_light.svg ***!
  \********************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzQiIGhlaWdodD0iNzQiIHZpZXdCb3g9IjAgMCA3NCA3NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzFfMikiPgo8bWFzayBpZD0ibWFzazBfMV8yIiBzdHlsZT0ibWFzay10eXBlOmx1bWluYW5jZSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMCIgeT0iMCIgd2lkdGg9Ijc0IiBoZWlnaHQ9Ijc0Ij4KPHBhdGggZD0iTTc0IDBIMFY3NEg3NFYwWiIgZmlsbD0id2hpdGUiLz4KPC9tYXNrPgo8ZyBtYXNrPSJ1cmwoI21hc2swXzFfMikiPgo8cGF0aCBkPSJNNjEuNzAxMiA2MC4zNDQ1SDguODhMMTUuMzI3OSAyOC45MDQ1QzE1LjQ1OTYgMjguMTYxOSAxNS44NDM4IDI3LjQ4NzYgMTYuNDE1NiAyNi45OTU5QzE2Ljk4NzQgMjYuNTA0MSAxNy43MTE2IDI2LjIyNTEgMTguNDY1NSAyNi4yMDU5SDY1LjUwOTdDNjUuOTA4MyAyNi4yMjMyIDY2LjI5ODYgMjYuMzI4NSA2Ni42NTEzIDI2LjUxNDRDNjcuMDA0NSAyNi43MDAyIDY3LjMxMjQgMjYuOTYxOSA2Ny41NTI2IDI3LjI4MDdDNjcuNzkyNCAyNy41OTk1IDY3Ljk1OTEgMjcuOTY3NSA2OC4wNCAyOC4zNTgzQzY4LjEyMSAyOC43NDkxIDY4LjExNDUgMjkuMTUyOSA2OC4wMjA4IDI5LjU0MDlMNjEuNzAxMiA2MC4zNDQ1WiIgZmlsbD0iI0NERDlFMiIgc3Ryb2tlPSIjQ0REOUUyIiBzdHJva2Utd2lkdGg9IjAuNzUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8cGF0aCBkPSJNOC44OCA2MC4zNDQ1VjEzLjY1NTRIMjMuODI4TDI2LjcxODkgMTguNzE3SDU4LjI5MjNDNTguODk4MSAxOC43MTcgNTkuNDc5MiAxOC45NTc3IDU5LjkwNzQgMTkuMzg2QzYwLjMzNTcgMTkuODE0NCA2MC41NzY0IDIwLjM5NTQgNjAuNTc2NCAyMS4wMDEyVjI0LjMzMTIiIHN0cm9rZT0iIzFGMzIzRCIgc3Ryb2tlLXdpZHRoPSIwLjc1IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9nPgo8L2c+CjxkZWZzPgo8Y2xpcFBhdGggaWQ9ImNsaXAwXzFfMiI+CjxyZWN0IHdpZHRoPSI3NCIgaGVpZ2h0PSI3NCIgZmlsbD0id2hpdGUiLz4KPC9jbGlwUGF0aD4KPC9kZWZzPgo8L3N2Zz4K";

/***/ },

/***/ "./extensions/SmartSectionUI/res/minimize.svg"
/*!****************************************************!*\
  !*** ./extensions/SmartSectionUI/res/minimize.svg ***!
  \****************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTEiIGhlaWdodD0iMTEiIHZpZXdCb3g9IjAgMCAxMSAxMSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEgNS41SDEwIiBzdHJva2U9IiM0QTU1NUIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K";

/***/ },

/***/ "./extensions/SmartSectionUI/res/minimize_dark.svg"
/*!*********************************************************!*\
  !*** ./extensions/SmartSectionUI/res/minimize_dark.svg ***!
  \*********************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTEiIGhlaWdodD0iMTEiIHZpZXdCb3g9IjAgMCAxMSAxMSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEgNS41SDEwIiBzdHJva2U9IiM5MzlCQTUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K";

/***/ },

/***/ "./extensions/SmartSectionUI/res/minimize_dark_hover.svg"
/*!***************************************************************!*\
  !*** ./extensions/SmartSectionUI/res/minimize_dark_hover.svg ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTEiIGhlaWdodD0iMTEiIHZpZXdCb3g9IjAgMCAxMSAxMSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEgNS41SDEwIiBzdHJva2U9IiNCRUM4RDIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K";

/***/ },

/***/ "./extensions/SmartSectionUI/res/minimize_hover.svg"
/*!**********************************************************!*\
  !*** ./extensions/SmartSectionUI/res/minimize_hover.svg ***!
  \**********************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTEiIGhlaWdodD0iMTEiIHZpZXdCb3g9IjAgMCAxMSAxMSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEgNS41SDEwIiBzdHJva2U9IiMwQTEzMUMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K";

/***/ },

/***/ "three"
/*!************************!*\
  !*** external "THREE" ***!
  \************************/
(module) {

"use strict";
module.exports = THREE;

/***/ },

/***/ "./res/locales/cs/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/cs/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"cs","@@context":"Rozšíření SmartSection","Clear all":"Vymazat vše","Reset Controls":"Obnovit ovládací prvky","Rotate gizmo":"Otočit gizmo","Show gizmo":"Zobrazit gizmo","Show hatches":"Zobrazit šrafy","Section Cap":"Zakončení řezu","Show frame":"Zobrazit rámeček","Show box":"Zobrazit pole","Options":"Možnosti","Plane":"Rovina","Planes":"Roviny","Plane %(index)":"Rovina %(index)","Box":"Pole","Sectioning Tools":"Nástroje pro tvorbu řezů","Reset":"Obnovit","Note that all existing section planes and boxes will be removed (if any).":"Všimněte si, že budou odebrány všechny existující roviny řezu a kvádry (pokud existují).","Use enhanced Sectioning Analysis.":"Použijte rozšířenou analýzu řezů.","Enhanced Sectioning":"Rozšířené řezy","Controls":"Ovládací prvky","Add plane":"Přidat rovinu","Add box":"Přidat pole","Sectioning":"Řezy","You can add up to 6 planes":"Můžete přidat až 6 rovin","Maximum of 6 planes. Each is named sequentially.":"Nejvýše 6 rovin. Každá je pojmenována postupně.","Nothing to display. Add planes.":"Není co zobrazit. Přidejte roviny.","Visibility":"Viditelnost","Delete":"Odstranit","Delete plane":"Odstranit  rovinu","Align true north":"Zarovnat skutečný sever","No models are loaded":"Nejsou načteny žádné modely","Multiple models are not supported":"Více modelů není podporováno","True north not defined for model":"Skutečný sever není pro model definován"}');

/***/ },

/***/ "./res/locales/da/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/da/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"da","@@context":"SmartSection-udvidelse","Clear all":"Ryd alle","Reset Controls":"Nulstil kontrolelementer","Rotate gizmo":"Rotér gizmo","Show gizmo":"Vis gizmo","Show hatches":"Vis skraveringer","Section Cap":"Afsnitsbjælke","Show frame":"Vis ramme","Show box":"Vis boks","Options":"Indstillinger","Plane":"Plan","Planes":"Planer","Plane %(index)":"Plan %(index)","Box":"Boks","Sectioning Tools":"Sektionsværktøjer","Reset":"Nulstil","Note that all existing section planes and boxes will be removed (if any).":"Bemærk, at alle eksisterende sektionsplaner og -bokse fjernes (hvis der er nogen).","Use enhanced Sectioning Analysis.":"Brug forbedret sektionsanalyse.","Enhanced Sectioning":"Forbedret opdeling i sektioner","Controls":"Kontrolelementer","Add plane":"Tilføj plan","Add box":"Tilføj boks","Sectioning":"Sektionsopdeling","You can add up to 6 planes":"Du kan tilføje op til 6 planer","Maximum of 6 planes. Each is named sequentially.":"Maksimalt 6 planer. Hver navngives sekventielt.","Nothing to display. Add planes.":"Der er intet at vise. Tilføj planer.","Visibility":"Synlighed","Delete":"Slet","Delete plane":"Slet plan","Align true north":"Juster det ægte nord","No models are loaded":"Der indlæses ingen modeller","Multiple models are not supported":"Flere modeller understøttes ikke","True north not defined for model":"Ægte nord er ikke defineret for model"}');

/***/ },

/***/ "./res/locales/de/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/de/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"de","@@context":"Erweiterung SmartSection","Clear all":"Alle löschen","Reset Controls":"Steuerungen zurücksetzen","Rotate gizmo":"Gizmo drehen","Show gizmo":"Gizmo anzeigen","Show hatches":"Schraffuren anzeigen","Section Cap":"Abschnittsabschluss","Show frame":"Rahmen anzeigen","Show box":"Feld anzeigen","Options":"Optionen","Plane":"Ebene","Planes":"Ebenen","Plane %(index)":"Ebene %(index)","Box":"Feld","Sectioning Tools":"Schnittwerkzeuge","Reset":"Zurücksetzen","Note that all existing section planes and boxes will be removed (if any).":"Beachten Sie, dass alle vorhandenen Schnittebenen und 3D-Schnittbereiche entfernt werden (falls vorhanden).","Use enhanced Sectioning Analysis.":"Verwenden Sie die erweiterte Schnittanalyse.","Enhanced Sectioning":"Erweiterte Schnittdarstellung","Controls":"Steuerelemente","Add plane":"Ebene hinzufügen","Add box":"Feld hinzufügen","Sectioning":"Schnittdarstellung","You can add up to 6 planes":"Sie können bis zu sechs Ebenen hinzufügen","Maximum of 6 planes. Each is named sequentially.":"Maximal 6 Ebenen. Jede wird fortlaufend benannt.","Nothing to display. Add planes.":"Nichts zum Anzeigen vorhanden. Fügen Sie Ebenen hinzu.","Visibility":"Sichtbarkeit","Delete":"Löschen","Delete plane":"Ebene löschen","Align true north":"Geografischen Norden ausrichten","No models are loaded":"Es sind keine Modelle geladen","Multiple models are not supported":"Mehrere Modelle werden nicht unterstützt","True north not defined for model":"Geografischer Norden nicht für Modell definiert"}');

/***/ },

/***/ "./res/locales/en-GB/nobundle-SmartSection.loc.json"
/*!**********************************************************!*\
  !*** ./res/locales/en-GB/nobundle-SmartSection.loc.json ***!
  \**********************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"en-uk","@@context":"SmartSection extension","Clear all":"Clear all","Reset Controls":"Reset controls","Rotate gizmo":"Rotate gizmo","Show gizmo":"Show gizmo","Show hatches":"Show hatches","Section Cap":"Section cap","Show frame":"Show frame","Show box":"Show box","Options":"Options","Plane":"Plane","Planes":"Planes","Plane %(index)":"Plane %(index)","Box":"Box","Sectioning Tools":"Sectioning tools","Reset":"Reset","Note that all existing section planes and boxes will be removed (if any).":"Note that all existing section planes and boxes will be removed (if any).","Use enhanced Sectioning Analysis.":"Use enhanced sectioning analysis.","Enhanced Sectioning":"Enhanced sectioning","Controls":"Controls","Add plane":"Add plane","Add box":"Add box","Sectioning":"Sectioning","You can add up to 6 planes":"You can add up to 6 planes","Maximum of 6 planes. Each is named sequentially.":"Maximum of 6 planes. Each is named sequentially.","Nothing to display. Add planes.":"Nothing to display. Add planes.","Visibility":"Visibility","Delete":"Delete","Delete plane":"Delete plane","Align true north":"Align true north","No models are loaded":"No models are loaded","Multiple models are not supported":"Multiple models are not supported","True north not defined for model":"True north not defined for model"}');

/***/ },

/***/ "./res/locales/en/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/en/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"en","@@context":"SmartSection Extension","Clear all":"Clear all","Reset Controls":"Reset Controls","Rotate gizmo":"Rotate gizmo","Show gizmo":"Show gizmo","Show hatches":"Show hatches","Section Cap":"Section Cap","Show frame":"Show frame","Show box":"Show box","Options":"Options","Plane":"Plane","Planes":"Planes","Plane %(index)":"Plane %(index)","Box":"Box","Sectioning Tools":"Sectioning Tools","Reset":"Reset","Note that all existing section planes and boxes will be removed (if any).":"Note that all existing section planes and boxes will be removed (if any).","Use enhanced Sectioning Analysis.":"Use enhanced Sectioning Analysis.","Enhanced Sectioning":"Enhanced Sectioning","Controls":"Controls","Add plane":"Add plane","Add box":"Add box","Sectioning":"Sectioning","You can add up to 6 planes":"You can add up to 6 planes","Maximum of 6 planes. Each is named sequentially.":"Maximum of 6 planes. Each is named sequentially.","Nothing to display. Add planes.":"Nothing to display. Add planes.","Visibility":"Visibility","Delete":"Delete","Delete plane":"Delete plane","Align true north":"Align true north","No models are loaded":"No models are loaded","Multiple models are not supported":"Multiple models are not supported","True north not defined for model":"True north not defined for model"}');

/***/ },

/***/ "./res/locales/es/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/es/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"es","@@context":"Extensión SmartSection","Clear all":"Borrar todo","Reset Controls":"Restablecer controles","Rotate gizmo":"Rotar gizmo","Show gizmo":"Mostrar gizmo","Show hatches":"Mostrar sombreados","Section Cap":"Remate de sección","Show frame":"Mostrar marco","Show box":"Mostrar cuadro","Options":"Opciones","Plane":"Plano","Planes":"Planos","Plane %(index)":"Plano %(index)","Box":"Box","Sectioning Tools":"Herramientas de sección","Reset":"Restablecer","Note that all existing section planes and boxes will be removed (if any).":"Tenga en cuenta que se eliminarán todos los planos y los cuadros de sección existentes (si los hay).","Use enhanced Sectioning Analysis.":"Utilice Análisis de sección mejorado.","Enhanced Sectioning":"Sección mejorada","Controls":"Controles","Add plane":"Añadir plano","Add box":"Añadir cuadro","Sectioning":"Sección","You can add up to 6 planes":"Puede añadir hasta seis planos.","Maximum of 6 planes. Each is named sequentially.":"Máximo de 6 planos. A cada uno se le asigna un nombre de forma secuencial.","Nothing to display. Add planes.":"No hay nada que mostrar. Añada planos.","Visibility":"Visibilidad","Delete":"Suprimir","Delete plane":"Suprimir plano","Align true north":"Alinear norte real","No models are loaded":"No se ha cargado ningún modelo.","Multiple models are not supported":"No se admiten varios modelos.","True north not defined for model":"No se ha definido el norte real para el modelo."}');

/***/ },

/***/ "./res/locales/fr-CA/nobundle-SmartSection.loc.json"
/*!**********************************************************!*\
  !*** ./res/locales/fr-CA/nobundle-SmartSection.loc.json ***!
  \**********************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"fr-CA","@@context":"Extension SmartSection","Clear all":"Tout effacer","Reset Controls":"Réinitialiser les contrôles","Rotate gizmo":"Faire pivoter un gizmo","Show gizmo":"Afficher gizmo","Show hatches":"Afficher les hachures","Section Cap":"Chapeau de coupe","Show frame":"Afficher le cadre","Show box":"Afficher la zone de coupe","Options":"Options","Plane":"Plan","Planes":"Plans","Plane %(index)":"Plan %(index)","Box":"Boîte","Sectioning Tools":"Outils de coupe","Reset":"Réinitialiser","Note that all existing section planes and boxes will be removed (if any).":"Notez que les zones et plans de coupe existants seront tous supprimés (le cas échéant).","Use enhanced Sectioning Analysis.":"Utiliser l’analyse de coupe améliorée.","Enhanced Sectioning":"Coupe améliorée","Controls":"Contrôles","Add plane":"Ajouter un plan","Add box":"Isoler une zone de coupe","Sectioning":"Coupe","You can add up to 6 planes":"Vous pouvez ajouter jusqu’à 6 plans","Maximum of 6 planes. Each is named sequentially.":"Maximum de 6 plans. Chacun d’eux est nommé de manière séquentielle.","Nothing to display. Add planes.":"Rien à afficher. Ajouter des plans.","Visibility":"Visibilité","Delete":"Supprimer","Delete plane":"Supprimer le plan","Align true north":"Aligner le nord géographique","No models are loaded":"Aucun modèle n’est chargé","Multiple models are not supported":"Plusieurs modèles ne sont pas pris en charge","True north not defined for model":"Nord géographique non défini pour le modèle"}');

/***/ },

/***/ "./res/locales/fr/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/fr/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"fr","@@context":"Extension SmartSection","Clear all":"Tout effacer","Reset Controls":"Réinitialiser les contrôles","Rotate gizmo":"Faire pivoter le gizmo","Show gizmo":"Afficher le gizmo","Show hatches":"Afficher les hachures","Section Cap":"Chapeau de coupe","Show frame":"Afficher le cadre","Show box":"Afficher la boîte","Options":"Options","Plane":"Plan","Planes":"Plans","Plane %(index)":"Plan %(index)","Box":"Zone","Sectioning Tools":"Outils de coupe","Reset":"Réinitialiser","Note that all existing section planes and boxes will be removed (if any).":"Notez que tous les plans de coupe et toutes les boîtes existantes seront supprimées (le cas échéant).","Use enhanced Sectioning Analysis.":"Utiliser l\'analyse de coupe améliorée.","Enhanced Sectioning":"Coupe améliorée","Controls":"Contrôles","Add plane":"Ajouter un plan","Add box":"Isoler une boîte","Sectioning":"Coupe","You can add up to 6 planes":"Vous pouvez ajouter jusqu\'à 6 plans","Maximum of 6 planes. Each is named sequentially.":"Maximum de 6 plans, dont chacun est nommé de manière séquentielle.","Nothing to display. Add planes.":"Rien à afficher. Ajouter des plans.","Visibility":"Visibilité","Delete":"Supprimer","Delete plane":"Supprimer le plan","Align true north":"Aligner le nord géographique","No models are loaded":"Aucun modèle n\'est chargé","Multiple models are not supported":"Plusieurs modèles ne sont pas pris en charge","True north not defined for model":"Nord géographique non défini pour le modèle"}');

/***/ },

/***/ "./res/locales/it/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/it/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"it","@@context":"Estensione SmartSection","Clear all":"Deseleziona tutto","Reset Controls":"Reimposta controlli","Rotate gizmo":"Ruota gizmo","Show gizmo":"Mostra gizmo","Show hatches":"Mostra tratteggi","Section Cap":"Estremità sezione","Show frame":"Mostra cornice","Show box":"Mostra riquadro","Options":"Opzioni","Plane":"Piano","Planes":"Piani","Plane %(index)":"Piano %(index)","Box":"Riquadro","Sectioning Tools":"Strumenti di sezionamento","Reset":"Reimposta","Note that all existing section planes and boxes will be removed (if any).":"Notare che tutti i piani di sezione e i riquadri esistenti verranno rimossi (se presenti).","Use enhanced Sectioning Analysis.":"Utilizzare l\'analisi di sezionamento avanzato.","Enhanced Sectioning":"Sezionamento avanzato","Controls":"Controlli","Add plane":"Aggiungi piano","Add box":"Aggiungi riquadro","Sectioning":"Sezionamento","You can add up to 6 planes":"È possibile aggiungere fino a 6 piani","Maximum of 6 planes. Each is named sequentially.":"Massimo 6 piani. Ciascuno di essi viene denominato in sequenza.","Nothing to display. Add planes.":"Nessun elemento da visualizzare. Aggiungere piani.","Visibility":"Visibilità","Delete":"Elimina","Delete plane":"Elimina piano","Align true north":"Allinea nord reale","No models are loaded":"Nessun modello caricato","Multiple models are not supported":"Non sono supportati più modelli","True north not defined for model":"Nord reale non definito per il modello"}');

/***/ },

/***/ "./res/locales/ja/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/ja/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"ja","@@context":"SmartSection Extension","Clear all":"すべてクリア","Reset Controls":"コントロールをリセット","Rotate gizmo":"ギズモを回転","Show gizmo":"ギズモを表示","Show hatches":"ハッチングを表示","Section Cap":"断面キャップ","Show frame":"フレームを表示","Show box":"ボックスを表示","Options":"オプション","Plane":"平面","Planes":"平面","Plane %(index)":"平面 %(index)","Box":"ボックス","Sectioning Tools":"断面化ツール","Reset":"リセット","Note that all existing section planes and boxes will be removed (if any).":"既存の断面とボックスはすべて削除されることに注意してください。","Use enhanced Sectioning Analysis.":"強化された断面化解析を使用します。","Enhanced Sectioning":"強化された断面化","Controls":"コントロール","Add plane":"平面を追加","Add box":"ボックスを追加","Sectioning":"断面化","You can add up to 6 planes":"最大 6 つの平面を追加できます","Maximum of 6 planes. Each is named sequentially.":"最大 6 つの平面。それぞれ名前に連番が付けられています。","Nothing to display. Add planes.":"表示するものがありません。平面を追加してください。","Visibility":"表示","Delete":"削除","Delete plane":"平面を削除","Align true north":"真北に位置合わせ","No models are loaded":"モデルがロードされていません","Multiple models are not supported":"複数のモデルはサポートされていません","True north not defined for model":"モデルに真北が定義されていません"}');

/***/ },

/***/ "./res/locales/ko/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/ko/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"ko","@@context":"SmartSection 확장","Clear all":"모두 지우기","Reset Controls":"컨트롤 재설정","Rotate gizmo":"기즈모 회전","Show gizmo":"기즈모 표시","Show hatches":"해치 표시","Section Cap":"단면 캡","Show frame":"프레임 표시","Show box":"상자 표시","Options":"옵션","Plane":"평면","Planes":"평면","Plane %(index)":"평면 %(index)","Box":"상자","Sectioning Tools":"단면 처리 도구","Reset":"재설정","Note that all existing section planes and boxes will be removed (if any).":"존재하는 모든 단면 평면 및 상자가 제거됩니다(존재하는 경우).","Use enhanced Sectioning Analysis.":"향상된 단면 분석을 사용합니다.","Enhanced Sectioning":"향상된 단면 처리","Controls":"컨트롤","Add plane":"평면 추가","Add box":"상자 추가","Sectioning":"단면 처리","You can add up to 6 planes":"최대 6개의 평면을 추가할 수 있습니다","Maximum of 6 planes. Each is named sequentially.":"최대 6개의 평면. 각 이름은 순차적으로 지정됩니다.","Nothing to display. Add planes.":"표시할 항목이 없습니다. 평면을 추가합니다.","Visibility":"가시성","Delete":"삭제","Delete plane":"평면 삭제","Align true north":"진북 정렬","No models are loaded":"로드된 모델이 없습니다.","Multiple models are not supported":"여러 모델이 지원되지 않습니다.","True north not defined for model":"모델의 진북이 정의되지 않았습니다."}');

/***/ },

/***/ "./res/locales/nl/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/nl/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"nl","@@context":"SmartSection-extensie","Clear all":"Alles wissen","Reset Controls":"Besturingselementen opnieuw instellen","Rotate gizmo":"Gizmo roteren","Show gizmo":"Gizmo weergeven","Show hatches":"Arceringen weergeven","Section Cap":"Sectieafdekking","Show frame":"Frame weergeven","Show box":"Vak weergeven","Options":"Opties","Plane":"Vlak","Planes":"Vlakken","Plane %(index)":"Vlak %(index)","Box":"Vak","Sectioning Tools":"Tools voor doorsnede","Reset":"Opnieuw instellen","Note that all existing section planes and boxes will be removed (if any).":"Let op: alle bestaande sectievlakken en -vakken worden verwijderd (indien aanwezig).","Use enhanced Sectioning Analysis.":"Gebruik verbeterde analyse van doorsneden.","Enhanced Sectioning":"Verbeterde doorsneden","Controls":"Besturingselementen","Add plane":"Vlak toevoegen","Add box":"Vak toevoegen","Sectioning":"Doorsneden","You can add up to 6 planes":"U kunt maximaal 6 vlakken toevoegen","Maximum of 6 planes. Each is named sequentially.":"Maximaal 6 vlakken. Elk heeft een opeenvolgende naam.","Nothing to display. Add planes.":"Niets om weer te geven. Vlakken toevoegen.","Visibility":"Zichtbaarheid","Delete":"Verwijderen","Delete plane":"Vlak verwijderen","Align true north":"Uitlijnen op geografisch noorden","No models are loaded":"Er worden geen modellen geladen","Multiple models are not supported":"Meerdere modellen worden niet ondersteund","True north not defined for model":"Geografisch noorden niet gedefinieerd voor model"}');

/***/ },

/***/ "./res/locales/no/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/no/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"no","@@context":"SmartSection-utvidelse","Clear all":"Fjern alle","Reset Controls":"Tilbakestill kontroller","Rotate gizmo":"Rotere dingsen","Show gizmo":"Vis dingsen","Show hatches":"Vis luker","Section Cap":"Seksjonsende","Show frame":"Vis ramme","Show box":"Vis boks","Options":"Alternativer","Plane":"Plan","Planes":"Plan","Plane %(index)":"Planprosent %(index)","Box":"Boks","Sectioning Tools":"Seksjoneringsverktøy","Reset":"Tilbakestill","Note that all existing section planes and boxes will be removed (if any).":"Merk at alle eksisterende seksjonsplaner og -bokser vil bli fjernet (hvis noen).","Use enhanced Sectioning Analysis.":"Bruk forbedret seksjoneringsanalyse.","Enhanced Sectioning":"Forbedret seksjonering","Controls":"Kontroller","Add plane":"Legg til plan","Add box":"Legg til boks","Sectioning":"Seksjonering","You can add up to 6 planes":"Du kan legge til opptil 6 planer","Maximum of 6 planes. Each is named sequentially.":"Maksimalt 6 plan. Hver av dem navngis i rekkefølge.","Nothing to display. Add planes.":"Ingenting å vise frem. Legg til plan.","Visibility":"Synlighet","Delete":"Slett","Delete plane":"Slett planet","Align true north":"Juster mot sann nord","No models are loaded":"Ingen modeller er lastet","Multiple models are not supported":"Flere modeller støttes ikke","True north not defined for model":"Sann nord er ikke definert for modellen"}');

/***/ },

/***/ "./res/locales/pl/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/pl/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"pl","@@context":"Rozszerzenie SmartSection","Clear all":"Wyczyść wszystkie","Reset Controls":"Resetuj elementy sterujące","Rotate gizmo":"Obróć metauchwyt","Show gizmo":"Pokaż metauchwyt","Show hatches":"Pokaż kreskowania","Section Cap":"Zaślepka przekroju","Show frame":"Pokaż ramkę","Show box":"Pokaż pole","Options":"Opcje","Plane":"Płaszczyzna","Planes":"Płaszczyzny","Plane %(index)":"Płaszczyzna %(index)","Box":"Zakres","Sectioning Tools":"Narzędzia do tworzenia przekrojów","Reset":"Resetuj","Note that all existing section planes and boxes will be removed (if any).":"Należy pamiętać, że wszystkie istniejące płaszczyzny przekroju i zakresy zostaną usunięte (jeśli istnieją).","Use enhanced Sectioning Analysis.":"Użyj udoskonalonej analizy przekrojów.","Enhanced Sectioning":"Udoskonalone przekroje","Controls":"Elementy storujące","Add plane":"Dodaj płaszczyznę","Add box":"Dodaj pole","Sectioning":"Tworzenie przekrojów","You can add up to 6 planes":"Można dodać maksymalnie 6 płaszczyzn.","Maximum of 6 planes. Each is named sequentially.":"Maksymalnie 6 płaszczyzn. Każda otrzymuje kolejną nazwę.","Nothing to display. Add planes.":"Brak elementów do wyświetlenia. Dodaj płaszczyzny.","Visibility":"Widoczność","Delete":"Usuń","Delete plane":"Usuń płaszczyznę","Align true north":"Wyrównaj północ rzeczywistą","No models are loaded":"Brak wczytanych modeli","Multiple models are not supported":"Wiele nieobsługiwanych modeli","True north not defined for model":"Nie zdefiniowano północy rzeczywistej modelu"}');

/***/ },

/***/ "./res/locales/pt-BR/nobundle-SmartSection.loc.json"
/*!**********************************************************!*\
  !*** ./res/locales/pt-BR/nobundle-SmartSection.loc.json ***!
  \**********************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"pt","@@context":"Extensão SmartSection","Clear all":"Limpar tudo","Reset Controls":"Redefinir controles","Rotate gizmo":"Rotacionar meta-alça","Show gizmo":"Mostrar meta-alça","Show hatches":"Mostrar hachuras","Section Cap":"Cobertura de corte","Show frame":"Mostrar quadro","Show box":"Mostrar caixa","Options":"Opções","Plane":"Plano","Planes":"Planos","Plane %(index)":"Plano %(index)","Box":"Caixa","Sectioning Tools":"Ferramentas de seccionamento","Reset":"Restaurar","Note that all existing section planes and boxes will be removed (if any).":"Observe que todos os planos e caixas de corte existentes serão removidos (se houver).","Use enhanced Sectioning Analysis.":"Usar análise de seccionamento aprimorado.","Enhanced Sectioning":"Seccionamento aprimorado","Controls":"Controles","Add plane":"Adicionar plano","Add box":"Adicionar caixa","Sectioning":"Seccionamento","You can add up to 6 planes":"É possível adicionar até seis planos","Maximum of 6 planes. Each is named sequentially.":"Máximo de 6 planos. Cada um é nomeado sequencialmente.","Nothing to display. Add planes.":"Não há nada para exibir. Adicione planos.","Visibility":"Visibilidade","Delete":"Excluir","Delete plane":"Excluir plano","Align true north":"Alinhar norte verdadeiro","No models are loaded":"Nenhum modelo carregado","Multiple models are not supported":"Não há suporte para múltiplos modelos","True north not defined for model":"Norte verdadeiro não definido para o modelo"}');

/***/ },

/***/ "./res/locales/ru/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/ru/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"ru","@@context":"Расширение SmartSection","Clear all":"Очистить все","Reset Controls":"Сбросить элементы управления","Rotate gizmo":"Гизмо поворота","Show gizmo":"Показать гизмо","Show hatches":"Показать штриховку","Section Cap":"Ограничитель сечения","Show frame":"Показать кадр","Show box":"Показать рамку","Options":"Параметры","Plane":"Плоскость","Planes":"Плоскости","Plane %(index)":"Плоскость %(index)","Box":"Рамка","Sectioning Tools":"Инструменты сечения","Reset":"Сброс","Note that all existing section planes and boxes will be removed (if any).":"Обратите внимание, что все существующие секущие плоскости и рамки (если они существуют) будут удалены.","Use enhanced Sectioning Analysis.":"Используйте расширенный анализ сечения.","Enhanced Sectioning":"Улучшенное создание сечений","Controls":"Элементы управления","Add plane":"Добавить плоскость","Add box":"Добавить рамку","Sectioning":"Сечения","You can add up to 6 planes":"Можно добавить не более 6 плоскостей","Maximum of 6 planes. Each is named sequentially.":"Не более 6 плоскостей. Имена для них назначаются последовательно.","Nothing to display. Add planes.":"Нет объектов для отображения. Добавьте плоскости.","Visibility":"Видимость","Delete":"Удалить","Delete plane":"Удалить плоскость","Align true north":"Выровнять истинный север","No models are loaded":"Модели не загружены","Multiple models are not supported":"Несколько моделей не поддерживаются","True north not defined for model":"Истинный север для модели не определен"}');

/***/ },

/***/ "./res/locales/sv/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/sv/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"sv","@@context":"SmartSection-tillägg","Clear all":"Rensa alla","Reset Controls":"Återställ kontroller","Rotate gizmo":"Rotera pryl","Show gizmo":"Visa pryl","Show hatches":"Visa luckor","Section Cap":"Sektionsöversikt","Show frame":"Visa ram","Show box":"Visa ruta","Options":"Alternativ","Plane":"Plan","Planes":"Plan","Plane %(index)":"Plan %(index)","Box":"Ruta","Sectioning Tools":"Verktyg för sektionering","Reset":"Återställ","Note that all existing section planes and boxes will be removed (if any).":"Observera att alla befintliga sektionsplan och lådor kommer att tas bort (i förekommande fall).","Use enhanced Sectioning Analysis.":"Använd förbättrad sektioneringsanalys.","Enhanced Sectioning":"Förbättrad sektionering","Controls":"Kontroller","Add plane":"Lägg till plan","Add box":"Lägg till ruta","Sectioning":"Sektionering","You can add up to 6 planes":"Du kan lägga till upp till 6 plan","Maximum of 6 planes. Each is named sequentially.":"Högst 6 plan. Var och en namnges i följd.","Nothing to display. Add planes.":"Inget att visa. Lägg till plan.","Visibility":"Synlighet","Delete":"Ta bort","Delete plane":"Ta bort plan","Align true north":"Justera mot geografiskt norr","No models are loaded":"Inga modeller har lästs in","Multiple models are not supported":"Flera modeller stöds inte","True north not defined for model":"Geografisk norr har inte definierats för modellen"}');

/***/ },

/***/ "./res/locales/tr/nobundle-SmartSection.loc.json"
/*!*******************************************************!*\
  !*** ./res/locales/tr/nobundle-SmartSection.loc.json ***!
  \*******************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"tr","@@context":"SmartSection Uzantısı","Clear all":"Tümünü temizle","Reset Controls":"Kontrolleri Sıfırla","Rotate gizmo":"Nesneyi döndür","Show gizmo":"Gizmo\'yu göster","Show hatches":"Taramaları göster","Section Cap":"Bölüm Kapağı","Show frame":"Çerçeveyi göster","Show box":"Kutuyu göster","Options":"Seçenekler","Plane":"Düzlem","Planes":"Düzlemler","Plane %(index)":"Düzlem %(index)","Box":"Kutu","Sectioning Tools":"Bölüm Araçları","Reset":"Sıfırla","Note that all existing section planes and boxes will be removed (if any).":"Mevcut tüm kesit düzlemlerinin ve kutularının (varsa) kaldırılacağını unutmayın.","Use enhanced Sectioning Analysis.":"Gelişmiş Kesit Oluşturma Analizi\'ni kullanın.","Enhanced Sectioning":"Gelişmiş Kesit Alma","Controls":"Kontroller","Add plane":"Düzlem ekle","Add box":"Kutu ekle","Sectioning":"Kesit Alma","You can add up to 6 planes":"En fazla 6 düzlem ekleyebilirsiniz","Maximum of 6 planes. Each is named sequentially.":"Maksimum 6 düzlem. Her biri sırayla adlandırılır.","Nothing to display. Add planes.":"Görüntülenecek bir şey yok. Düzlemler ekleyin.","Visibility":"Görünürlük","Delete":"Sil","Delete plane":"Düzlemi sil","Align true north":"Gerçek kuzeye hizala","No models are loaded":"Hiçbir model yüklenmedi","Multiple models are not supported":"Birden çok model desteklenmiyor","True north not defined for model":"Model için gerçek kuzey tanımlanmamış"}');

/***/ },

/***/ "./res/locales/zh-HK/nobundle-SmartSection.loc.json"
/*!**********************************************************!*\
  !*** ./res/locales/zh-HK/nobundle-SmartSection.loc.json ***!
  \**********************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"zh-hk","@@context":"SmartSection 擴充功能","Clear all":"全部清除","Reset Controls":"重設控制項","Rotate gizmo":"旋轉控點","Show gizmo":"顯示控點","Show hatches":"顯示填充線","Section Cap":"剖面端點","Show frame":"展示外框","Show box":"顯示方框","Options":"選項","Plane":"平面","Planes":"平面","Plane %(index)":"平面 %(index)","Box":"框","Sectioning Tools":"剖面工具","Reset":"重設","Note that all existing section planes and boxes will be removed (if any).":"請注意，系統將移除所有現有剖面平面和框 (如有)。","Use enhanced Sectioning Analysis.":"使用增強型剖面分析。","Enhanced Sectioning":"增強型剖面","Controls":"控制選項","Add plane":"加入平面","Add box":"加入方框","Sectioning":"剖面","You can add up to 6 planes":"您最多可以加入 6 個平面","Maximum of 6 planes. Each is named sequentially.":"最多 6 個平面，各自按順序命名。","Nothing to display. Add planes.":"沒有可顯示的內容。新增平面。","Visibility":"透明度","Delete":"刪除","Delete plane":"刪除平面","Align true north":"對齊正北","No models are loaded":"未載入任何模型","Multiple models are not supported":"不支援多個模型","True north not defined for model":"未為模型定義正北"}');

/***/ },

/***/ "./res/locales/zh-Hans/nobundle-SmartSection.loc.json"
/*!************************************************************!*\
  !*** ./res/locales/zh-Hans/nobundle-SmartSection.loc.json ***!
  \************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"zh-Hans","@@context":"SmartSection 扩展","Clear all":"全部清除","Reset Controls":"重置控件","Rotate gizmo":"旋转小控件","Show gizmo":"显示小控件","Show hatches":"显示图案填充","Section Cap":"截面封口","Show frame":"显示帧","Show box":"显示框","Options":"选项","Plane":"平面","Planes":"平面","Plane %(index)":"平面 %(index)","Box":"框","Sectioning Tools":"剖分工具","Reset":"重置","Note that all existing section planes and boxes will be removed (if any).":"请注意，将删除所有现有剖面和框(如果有)。","Use enhanced Sectioning Analysis.":"使用增强的剖分分析。","Enhanced Sectioning":"增强的剖分","Controls":"控件","Add plane":"添加平面","Add box":"添加框","Sectioning":"剖分","You can add up to 6 planes":"最多可以添加 6 个平面","Maximum of 6 planes. Each is named sequentially.":"最多 6 个平面。每个都按顺序命名。","Nothing to display. Add planes.":"没有显示任何内容。添加平面。","Visibility":"可见性","Delete":"删除","Delete plane":"删除平面","Align true north":"对齐正北","No models are loaded":"未加载任何模型","Multiple models are not supported":"不支持多个模型","True north not defined for model":"未为模型定义正北"}');

/***/ },

/***/ "./res/locales/zh-Hant/nobundle-SmartSection.loc.json"
/*!************************************************************!*\
  !*** ./res/locales/zh-Hant/nobundle-SmartSection.loc.json ***!
  \************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"zh-Hant","@@context":"SmartSection 延伸","Clear all":"全部清除","Reset Controls":"重置控制項","Rotate gizmo":"旋轉控點","Show gizmo":"展示控點","Show hatches":"展示填充線","Section Cap":"剖面收頭","Show frame":"展示外框","Show box":"展示方塊","Options":"選項","Plane":"平面","Planes":"平面","Plane %(index)":"第 %(index) 個平面","Box":"方塊","Sectioning Tools":"剖面工具","Reset":"重置","Note that all existing section planes and boxes will be removed (if any).":"請注意，將移除所有既有的剖面平面和剖面框 (如果有)。","Use enhanced Sectioning Analysis.":"使用增強的剖面分析。","Enhanced Sectioning":"增強的剖面","Controls":"控制項","Add plane":"加入平面","Add box":"加入方塊","Sectioning":"剖面","You can add up to 6 planes":"您最多可以加入 6 個平面","Maximum of 6 planes. Each is named sequentially.":"最多 6 個平面。每個平面會依序命名。","Nothing to display. Add planes.":"沒有內容可顯示。加入平面。","Visibility":"可見性","Delete":"刪除","Delete plane":"刪除平面","Align true north":"對齊正北","No models are loaded":"未載入任何模型","Multiple models are not supported":"不支援多個模型","True north not defined for model":"未定義模型的正北"}');

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = (typeof document !== 'undefined' && document.baseURI) || self.location.href;
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"SmartSectionUI": 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		// no jsonp function
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/nonce */
/******/ 	(() => {
/******/ 		__webpack_require__.nc = undefined;
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";
/*!*****************************************************!*\
  !*** ./extensions/SmartSectionUI/SmartSectionUI.js ***!
  \*****************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _SmartSectionPanel_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SmartSectionPanel.js */ "./extensions/SmartSectionUI/SmartSectionPanel.js");
/* harmony import */ var _SmartSectionPanel_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SmartSectionPanel.css */ "./extensions/SmartSectionUI/SmartSectionPanel.css");
/* harmony import */ var _SmartSectionPanelTooltips_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SmartSectionPanelTooltips.css */ "./extensions/SmartSectionUI/SmartSectionPanelTooltips.css");
/* harmony import */ var _extensions_SmartSection_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../extensions/SmartSection/SmartSection.js */ "./extensions/SmartSection/SmartSection.js");
/* harmony import */ var _extensions_ModelSheetTransition_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../../extensions/ModelSheetTransition/ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");







/** @import {SmartSectionExtension} from '../SmartSection/SmartSection' */

const av = Autodesk.Viewing;
const ui = Autodesk.Viewing.UI;

/**
 * Autodesk.Viewing.Extensions.SmartSection.Analytics constants,
 * they become available after the main extension is loaded
 */
let Analytics;

// UI wrapper for Autodesk.SmartSection: provides panel, toolbar button, and context menu
class SmartSectionUIExtension extends av.Extension {

  /** @type {SmartSectionExtension} */
  sectionExt;

  constructor(viewer, options) {
    super(viewer, options);
    this.viewer = viewer;
    this.options = options || {};
    Analytics = Autodesk.Viewing.Extensions.SmartSection.Analytics;
  }

  async load() {
    this.sectionExt = await this.viewer.getExtensionAsync('Autodesk.SmartSection');
    if (!this.sectionExt) {
      console.error('SmartSection extension not found');
      return;
    }
    this.panel = new _SmartSectionPanel_js__WEBPACK_IMPORTED_MODULE_0__.SmartSectionPanel(this.sectionExt, this.viewer, { heightAdjustment: 110, width: 150, hideTabBar: false });

    this.sectionExt.setUIPanel(this.panel);

    this.onSmartSectionActivated = () => {
      this.updateToolButtonState();
      this.panel?.setVisible(true);
    };

    this.onSmartSectionDeactivated = () => {
      this.updateToolButtonState();
      this.panel?.setVisible(false);
    };

    this.onCutPlanesChanged = () => {
      // Keeps the button in sync with cut planes applied while the tool is closed,
      // e.g. when restoring a view or a viewer state containing section planes.
      this.updateToolButtonState();
    };

    const avext = Autodesk.Viewing.Extensions.SmartSection;

    this.sectionExt.events.addEventListener(avext.SMART_SECTION_ACTIVATED_EVENT, this.onSmartSectionActivated);
    this.sectionExt.events.addEventListener(avext.SMART_SECTION_DEACTIVATED_EVENT, this.onSmartSectionDeactivated);
    this.viewer.addEventListener(av.CUTPLANES_CHANGE_EVENT, this.onCutPlanesChanged);

    if (this.sectionExt.isActive()) {
      this.onSmartSectionActivated();
    }

    return true;
  }

  /**
   * Reflects in the toolbar button whether the tool is open or cut planes are applied.
   */
  updateToolButtonState() {

    const sectionCutPlanes = this.viewer.impl.getCutPlaneSet(_extensions_SmartSection_SmartSection_js__WEBPACK_IMPORTED_MODULE_3__.CUT_PLANE_SET);
    const sheetAlignmentCutPlanes = this.viewer.impl.getCutPlaneSet(_extensions_ModelSheetTransition_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_4__.MODEL_SHEET_SECTION_SET);

    const active = this.sectionExt?.isActive() || sectionCutPlanes.length > 0 || sheetAlignmentCutPlanes.length > 0;

    this.sectionToolButton?.setState(active ? ui.Button.State.ACTIVE : ui.Button.State.INACTIVE);
  }

  unload() {
    // Panel cleanup
    this.panel?.uninitialize();
    this.panel = null;

    this.viewer.removeEventListener(av.CUTPLANES_CHANGE_EVENT, this.onCutPlanesChanged);

    if (this.sectionExt) {
      // Clear reference from logic extension
      this.sectionExt.panel = null;

      // Detach event listeners
      if (this.sectionExt?.events) {
        const avext = Autodesk.Viewing.Extensions.SmartSection;

        this.sectionExt.events.removeEventListener(avext.SMART_SECTION_ACTIVATED_EVENT, this.onSmartSectionActivated);
        this.sectionExt.events.removeEventListener(avext.SMART_SECTION_DEACTIVATED_EVENT, this.onSmartSectionDeactivated);
      }
    }

    // Toolbar cleanup
    this.sectionToolButton?.removeFromParent();
    this.sectionToolButton = null;

    return true;
  }

  onToolbarCreated(toolbar) {
    super.onToolbarCreated(toolbar);

    if (this.options.disableDefaultUi) {
      return;
    }

    // Prevent duplicate
    if (this.sectionToolButton) {
      return;
    }

    const sectionToolButton = this.sectionToolButton = new ui.Button('toolbar-sectionTool');
    sectionToolButton.setToolTip('Sectioning');
    sectionToolButton.setIcon('adsk-icon-section-analysis');

    this.updateToolButtonState();

    this.panel?.addEventListener(this.panel?.closer, 'click', () => {
      this.sectionExt.deactivate();
      this.sectionExt.analytics.trackToolClosed(Analytics.FROM.PANEL);
    });

    this.panel?.addEventListener(this.panel?.minimizeButton, 'click', () => {
      this.panel?.setVisible(false);
    });

    // Deactivate Button when docking panel is closed
    this.panel?.addVisibilityListener((visible) => {
      if (visible) {
        this.panel && this.viewer.onPanelVisible?.(this.panel);
      }
    });

    sectionToolButton.onClick = () => {
      if (!this.sectionExt.isActive()) {
        this.sectionExt.activate();
        this.sectionExt.analytics.trackToolOpened(Analytics.FROM.TOOLBAR);
      } else if (this.panel && !this.panel.isVisible()) {
        this.panel.setVisible(true);
      } else {
        this.sectionExt.deactivate();
        this.sectionExt.analytics.trackToolClosed(Analytics.FROM.TOOLBAR);
      }
    };

    const modelTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);
    if (modelTools) {
      const existing = modelTools.getControl('toolbar-sectionTool');
      let sectionIndex;
      if (existing) {
        sectionIndex = modelTools.indexOf(existing.getId());
        modelTools.removeControl(existing);
      }
      const resetTool = modelTools.getControl('toolbar-resetTool');
      if (resetTool) {
        modelTools.addControl(sectionToolButton, { index: modelTools.indexOf(resetTool.getId()) });
      } else {
        modelTools.addControl(sectionToolButton, { index: sectionIndex ?? 0 });
      }
    }
  }
}

av.theExtensionManager.registerExtension('Autodesk.SmartSectionUI', SmartSectionUIExtension);
})();

Autodesk.Extensions.SmartSectionUI = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=SmartSectionUI.js.map