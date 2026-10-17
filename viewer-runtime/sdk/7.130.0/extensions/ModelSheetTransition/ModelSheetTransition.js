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
/******/ 	var __webpack_modules__ = ({

/***/ "./extensions/ModelSheetTransition/BoundsPlane.js"
/*!********************************************************!*\
  !*** ./extensions/ModelSheetTransition/BoundsPlane.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ BoundsPlane)
/* harmony export */ });
const FillOpacity = 0.7;
const EdgeOpacity = 1.0;
const FadeDuration = 0.3; // In seconds

class BoundsPlane {
  constructor(viewer, overlayName) {
    this.viewer = viewer;
    this.overlayName = overlayName;
    this.materialManager = viewer.impl.matman();
    this.isVisible = false;
    this.lock = false;
  }

  createBoundsPlane() {
    this.viewer.impl.createOverlayScene(this.overlayName);
    // Fill geometry
    const geometry = new THREE.PlaneBufferGeometry(1, 1);

    const points = [];
    points.push(new THREE.Vector3(-0.5, -0.5, 0));
    points.push(new THREE.Vector3(-0.5, 0.5, 0));
    points.push(new THREE.Vector3(0.5, 0.5, 0));
    points.push(new THREE.Vector3(0.5, -0.5, 0));

    // Outline geometry
    const linesGeometry = new THREE.Geometry();
    linesGeometry.isLines = true;

    const verts = linesGeometry.vertices;
    verts.push(points[0]);
    verts.push(points[1]);

    verts.push(points[1]);
    verts.push(points[2]);

    verts.push(points[2]);
    verts.push(points[3]);

    verts.push(points[3]);
    verts.push(points[0]);

    this.fillMaterial = new Autodesk.Viewing.Scene.StandardMaterial({
      color: 0xCDEAF7,
      side: THREE.DoubleSide,
      specular: 0x000000,
      transparent: true,
      opacity: FillOpacity,
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 5,
      depthTest: false,
      depthWrite: false
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      opacity: EdgeOpacity,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    this.fillMaterial.doNotCut = true;
    this.edgeMaterial.doNotCut = true;

    this.solidName = this.materialManager._getMaterialHash(null, 'ModelSheetTransition.solid');
    this.materialManager.addMaterial(this.solidName, this.fillMaterial, true);

    this.edgesName = this.materialManager._getMaterialHash(null, 'ModelSheetTransition.edges');
    this.materialManager.addMaterialNonHDR(this.edgesName, this.edgeMaterial);

    const boundariesMesh = new THREE.Mesh(geometry, this.fillMaterial);
    const lineMesh = new THREE.Line(linesGeometry, this.edgeMaterial, THREE.LinePieces);
    const boundsGroup = new THREE.Group();
    boundsGroup.add(boundariesMesh);
    boundsGroup.add(lineMesh);

    boundsGroup.matrixAutoUpdate = false;

    return boundsGroup;
  }

  getBoundsPlane() {
    if (!this.boundsPlane) {
      this.boundsPlane = this.createBoundsPlane();
    }

    return this.boundsPlane;
  }

  setFromMatrix(matrix) {
    const boundsPlane = this.getBoundsPlane();

    boundsPlane.matrix.copy(matrix);
    boundsPlane.matrixWorldNeedsUpdate = true;
  }

  // Set the material opacitiy to a percentage of their full value
  setMaterialsOpacity(t) {
    this.fillMaterial.opacity = t * FillOpacity;
    this.edgeMaterial.opacity = t * EdgeOpacity;
    this.viewer.impl.invalidate(false, false, true);
  }

  setVisible(isVisible, withAnimation = true) {
    if (this.isVisible === isVisible) {
      return;
    }

    if (this.fadeAnim) {
      this.fadeAnim.stop();
      this.fadeAnim = null;
    }

    this.isVisible = isVisible;
    const boundsPlane = this.getBoundsPlane();

    const startValue = isVisible ? 0 : 1;

    if (isVisible) this.viewer.impl.addOverlay(this.overlayName, boundsPlane);

    if (withAnimation) {
      const onTimer = (t) => {
        t = Autodesk.Viewing.Private.smootherStep(t);
        this.setMaterialsOpacity(t);
      };

      const onFadeEnd = () => {
        if (!isVisible) this.viewer.impl.removeOverlay(this.overlayName, boundsPlane);
        this.fadeAnim = null;
      };

      this.fadeAnim = Autodesk.Viewing.Private.fadeValue(startValue, 1 - startValue, FadeDuration, onTimer, onFadeEnd);
    } else {
      if (isVisible) {
        this.setMaterialsOpacity(1);
      } else {
        this.viewer.impl.removeOverlay(this.overlayName, boundsPlane);
      }
    }

    this.viewer.impl.invalidate(false, false, true);
  }

  destroy() {
    this.setVisible(false);

    if (this.solidName) {
      this.materialManager.removeMaterial(this.solidName);
      this.materialManager.removeNonHDRMaterial(this.edgesName);
    }

    this.viewer.impl.removeOverlayScene(this.overlayName);
  }
}

/***/ },

/***/ "./extensions/ModelSheetTransition/EventTypes.js"
/*!*******************************************************!*\
  !*** ./extensions/ModelSheetTransition/EventTypes.js ***!
  \*******************************************************/
(module) {

/**
 * Fired when a new sheet is being shown.
 * @event SHOW_SHEET_EVENT
 * @property {Autodesk.Viewing.Model} model - The model (sheet) that is being shown.
 */
module.exports.SHOW_SHEET_EVENT = 'showSheet';

/**
 * Fired when a sheet is being hidden.
 * (Note: when we switch to showing a different sheet, the hide event of the current sheet is fired before the next show event)
 * @event HIDE_SHEET_EVENT
 * @property {Autodesk.Viewing.Model} model - The model (sheet) that is being hidden.
 */
module.exports.HIDE_SHEET_EVENT = 'hideSheet';

/***/ },

/***/ "./extensions/ModelSheetTransition/ModelSheetCommon.js"
/*!*************************************************************!*\
  !*** ./extensions/ModelSheetTransition/ModelSheetCommon.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   fitAfterTransformImmediate: () => (/* binding */ fitAfterTransformImmediate),
/* harmony export */   fitCameraToSheet: () => (/* binding */ fitCameraToSheet),
/* harmony export */   fitToBounds: () => (/* binding */ fitToBounds),
/* harmony export */   fitToBoundsWithAnimation: () => (/* binding */ fitToBoundsWithAnimation),
/* harmony export */   getCaptureConfigAnalyticsParams: () => (/* binding */ getCaptureConfigAnalyticsParams),
/* harmony export */   getSuitable2DModel: () => (/* binding */ getSuitable2DModel),
/* harmony export */   resetModelTransformAndViewport: () => (/* binding */ resetModelTransformAndViewport),
/* harmony export */   setCutPlane: () => (/* binding */ setCutPlane),
/* harmony export */   setViewportBounds: () => (/* binding */ setViewportBounds)
/* harmony export */ });
/* harmony import */ var _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");


const TMP_VEC3_1 = new THREE.Vector3();
const TMP_VEC3_2 = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();

const TMP_PLANE = new THREE.Plane();
const TMP_VEC4 = new THREE.Vector4();

const getSuitable2DModel = (viewer) => {
  return viewer.impl.is2d && viewer.impl.get2DModels()[0];
};

// Analytics param for `viewer.hypermodel.view`: whether the viewport carries an issue capture
// config. Only reported while manual alignment adjustments are enabled, since nothing writes one
// otherwise.
const getCaptureConfigAnalyticsParams = (viewport) => {
  const enabled = Autodesk.Viewing.FeatureFlags.isEnabled(
    Autodesk.Viewing.Private.InternalFeatureFlags.EnableManualAlignmentAdjustments
  );

  if (!enabled) {
    return {};
  }

  return { has_capture_config: !!viewport?.getViewType?.() && !!viewport?.getViewOffsets?.() };
};

const setCutPlane = (viewer, matrix, clearSelectedFloor) => {
  matrix.decompose(TMP_VEC3_1, TMP_QUAT, TMP_VEC3_2);

  // Assuming original's sheet normal is +Z (which should be the case)
  TMP_VEC3_2.set(0, 0, 1);
  TMP_VEC3_2.applyQuaternion(TMP_QUAT);

  // Deselect current floor section if exists.
  // This is needed so the viewport's section plane won't collide with a selected floor section.
  if (clearSelectedFloor) {
    const levelsExtension = viewer.getExtension('Autodesk.AEC.LevelsExtension');
    levelsExtension?.floorSelector?.selectFloor(undefined, false);
  }

  TMP_PLANE.setFromNormalAndCoplanarPoint(TMP_VEC3_2, TMP_VEC3_1);
  TMP_VEC4.set(TMP_PLANE.normal.x, TMP_PLANE.normal.y, TMP_PLANE.normal.z, TMP_PLANE.constant); // setCutPlaneSet creates a copy, so it's safe to use TMP_VEC4
  viewer.impl.setCutPlaneSet(_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.MODEL_SHEET_SECTION_SET, [TMP_VEC4]);
};

// Pass endBox=null to reset to original bounds
// Pass a duration > 0 to animate
const setViewportBounds = (() => {
  let viewportBoundsAnim = null;

  const convertToBox3 = (box) => {
    if (!box || box instanceof THREE.Box3) {
      return box;
    }

    // The crop box that is passed sometimes contains only (x, y).
    // To make the lerping consistent this converts the box to a Box3
    box.min.z = box.max.z = 0;
    return new THREE.Box3(box.min, box.max);
  };

  return async (viewer, model, endBox, duration) => {
    if (viewportBoundsAnim) {
      viewportBoundsAnim.skip();
      viewportBoundsAnim = null;
    }

    const dstBox = new THREE.Box3();

    // The initial box is the bounding box
    const originalBounds = model.getBoundingBox(true, false).clone();

    // If the cropping area was changed from the initial one, get the current one
    const currentBounds = model.getViewportBounds()?.clone();

    // When endBox is null, it means we want to restore the original box
    const startBox = currentBounds || originalBounds;
    endBox = convertToBox3(endBox) || originalBounds;

    const setBounds = () => {
      viewer.impl.setViewportBounds(model, dstBox);
    };

    const onTimer = (t) => {
      t = Autodesk.Viewing.Private.smootherStep(t);
      dstBox.min.lerpVectors(startBox.min, endBox.min, t);
      dstBox.max.lerpVectors(startBox.max, endBox.max, t);

      setBounds();
    };

    return new Promise((resolve) => {
      const onFinished = () => {
        viewportBoundsAnim = null;
        setTimeout(resolve);
      };

      if (duration === 0) {// Call directly
        dstBox.copy(endBox);
        setBounds();
        resolve();
      } else {
        viewportBoundsAnim = Autodesk.Viewing.Private.fadeValue(0, 1, duration, onTimer, onFinished);
      }
    });
  };
})();

const resetModelTransformAndViewport = (viewer, model) => {
  // Reset transform
  viewer.impl.setPlacementTransform(model, new THREE.Matrix4());

  model.changePaperVisibility(true);
  viewer.impl.setDoNotCut(model, true);

  // Reset viewport bounds (without animation - duration set to 0)
  setViewportBounds(viewer, model, null, 0);
};

// When transitioning from 2D to 3D, the sheet might end in a completely different position.
// Assuming the sheet has already been fitted, and applying the transform to the camera, we make sure the fitting remains
// while still facing the sheet.
const fitAfterTransformImmediate = (viewer, matrix) => {
  const camera = viewer.getCamera();
  camera.transformCurrentView(matrix);
  camera.updateCameraMatrices();
  // Set pivot point to current target
  viewer.navigation.setPivotPoint(camera.target);
  viewer.navigation.setPivotSetFlag(true);
};

const fitToBounds = (viewer, model) => {
  const bounds = model.getVisibleBounds();
  // fitBounds will also set the pivot point from the camera's target
  viewer.navigation.fitBounds(true, bounds, false, true);

  viewer.impl.invalidate(true);
};

const fitToBoundsWithAnimation = async (viewer, model) => {
  const bounds = model.getVisibleBounds();
  const camera = viewer.getCamera();
  const fit = viewer.navigation.computeFit(camera.position, camera.target, camera.fov, bounds, camera.aspect);

  const dstView = {
    position: fit.position,
    target: fit.target,
    up: camera.up
  };

  return new Promise((resolve) => {
    Autodesk.Viewing.Private.flyToView(viewer, dstView, _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.FLY_TO_DURATION, () => {
      // Wait a frame for last invalidate to take hold, before allowing to continue.
      // Avoids a graphical glitch when the 3D model is already loaded
      setTimeout(resolve);
    }, false);
  });
};

const fitCameraToSheet = (viewer, model) => {
  viewer.navigation.toOrthographic();

  const bbox = model.getBoundingBox(true, false).clone();

  const matrix = model.getModelToViewerTransform() || new THREE.Matrix4();
  const center = bbox.getCenter(new THREE.Vector3());

  // Set the center of the sheet as the target, then move away in the z direction towards the camera
  // to set the desired position. Then apply transform to both.
  // Using this as parameters for computeFit will give us the destination that would be the same as fit To View.
  const position = center.clone();
  position.z += bbox.getSize(new THREE.Vector3()).y;
  position.applyMatrix4(matrix);

  const target = center.applyMatrix4(matrix);

  const rotation = new THREE.Matrix4();
  rotation.extractRotation(matrix);

  // Apply rotation to up vector - according to 2D model default up direction.
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotation).normalize();

  // Transform box to the current state
  bbox.applyMatrix4(matrix);

  const { fov, aspect } = viewer.getCamera();
  const fit = viewer.navigation.computeFit(position, target, fov, bbox, aspect);
  const dstView = {
    position: fit.position,
    target: fit.target,
    up
  };

  return new Promise((resolve) => {
    Autodesk.Viewing.Private.flyToView(viewer, dstView, _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.FIT_TO_SHEET_DURATION, () => {
      // Wait a frame for last invalidate to take hold, before allowing to continue.
      // Avoids a graphical glitch
      setTimeout(resolve);
    }, false);
  });
};

/***/ },

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

/***/ "./extensions/ModelSheetTransition/ModelSheetTransitionLocals.js"
/*!***********************************************************************!*\
  !*** ./extensions/ModelSheetTransition/ModelSheetTransitionLocals.js ***!
  \***********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   locales: () => (/* binding */ locales)
/* harmony export */ });
/* harmony import */ var _res_locales_en_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../res/locales/en/nobundle-modelSheetTransition.loc.json */ "./res/locales/en/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_cs_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../res/locales/cs/nobundle-modelSheetTransition.loc.json */ "./res/locales/cs/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_da_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../res/locales/da/nobundle-modelSheetTransition.loc.json */ "./res/locales/da/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_de_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../res/locales/de/nobundle-modelSheetTransition.loc.json */ "./res/locales/de/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_en_GB_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../../res/locales/en-GB/nobundle-modelSheetTransition.loc.json */ "./res/locales/en-GB/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_es_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../../res/locales/es/nobundle-modelSheetTransition.loc.json */ "./res/locales/es/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_fr_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../../res/locales/fr/nobundle-modelSheetTransition.loc.json */ "./res/locales/fr/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_fr_CA_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../../res/locales/fr-CA/nobundle-modelSheetTransition.loc.json */ "./res/locales/fr-CA/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_it_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ../../res/locales/it/nobundle-modelSheetTransition.loc.json */ "./res/locales/it/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_ja_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ../../res/locales/ja/nobundle-modelSheetTransition.loc.json */ "./res/locales/ja/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_ko_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ../../res/locales/ko/nobundle-modelSheetTransition.loc.json */ "./res/locales/ko/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_nl_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ../../res/locales/nl/nobundle-modelSheetTransition.loc.json */ "./res/locales/nl/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_no_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ../../res/locales/no/nobundle-modelSheetTransition.loc.json */ "./res/locales/no/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_pl_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ../../res/locales/pl/nobundle-modelSheetTransition.loc.json */ "./res/locales/pl/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_pt_BR_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ../../res/locales/pt-BR/nobundle-modelSheetTransition.loc.json */ "./res/locales/pt-BR/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_ru_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_15__ = __webpack_require__(/*! ../../res/locales/ru/nobundle-modelSheetTransition.loc.json */ "./res/locales/ru/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_sv_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_16__ = __webpack_require__(/*! ../../res/locales/sv/nobundle-modelSheetTransition.loc.json */ "./res/locales/sv/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_tr_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_17__ = __webpack_require__(/*! ../../res/locales/tr/nobundle-modelSheetTransition.loc.json */ "./res/locales/tr/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_zh_Hans_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_18__ = __webpack_require__(/*! ../../res/locales/zh-Hans/nobundle-modelSheetTransition.loc.json */ "./res/locales/zh-Hans/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_zh_Hant_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_19__ = __webpack_require__(/*! ../../res/locales/zh-Hant/nobundle-modelSheetTransition.loc.json */ "./res/locales/zh-Hant/nobundle-modelSheetTransition.loc.json");
/* harmony import */ var _res_locales_zh_HK_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_20__ = __webpack_require__(/*! ../../res/locales/zh-HK/nobundle-modelSheetTransition.loc.json */ "./res/locales/zh-HK/nobundle-modelSheetTransition.loc.json");
/**
 * Include each locale json file and return it in an object
 * that can be consumed by i18n
 */
























const locales = {
  en: _res_locales_en_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_0__,

  cs: _res_locales_cs_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_1__,
  da: _res_locales_da_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_2__,
  de: _res_locales_de_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_3__,
  "en-GB": _res_locales_en_GB_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_4__,
  es: _res_locales_es_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_5__,
  fr: _res_locales_fr_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_6__,
  "fr-CA": _res_locales_fr_CA_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_7__,
  it: _res_locales_it_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_8__,
  ja: _res_locales_ja_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_9__,
  ko: _res_locales_ko_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_10__,
  nl: _res_locales_nl_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_11__,
  no: _res_locales_no_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_12__,
  pl: _res_locales_pl_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_13__,
  "pt-BR": _res_locales_pt_BR_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_14__,
  ru: _res_locales_ru_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_15__,
  sv: _res_locales_sv_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_16__,
  tr: _res_locales_tr_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_17__,
  "zh-Hans": _res_locales_zh_Hans_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_18__,
  "zh-Hant": _res_locales_zh_Hant_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_19__,
  "zh-HK": _res_locales_zh_HK_nobundle_modelSheetTransition_loc_json__WEBPACK_IMPORTED_MODULE_20__
};

/***/ },

/***/ "./extensions/ModelSheetTransition/ModelToSheet.js"
/*!*********************************************************!*\
  !*** ./extensions/ModelSheetTransition/ModelToSheet.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ModelToSheet)
/* harmony export */ });
/* harmony import */ var _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");
/* harmony import */ var _ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ModelSheetCommon.js */ "./extensions/ModelSheetTransition/ModelSheetCommon.js");



class ModelToSheet {
  constructor(extension) {
    this.ext = extension;
    this.viewer = extension.viewer;
  }

  async transition3Dto2D(model) {
    if (this.viewer.impl.is2d) {
      return;
    }

    const matrix = model.getPlacementTransform();
    const invMatrix = new Autodesk.Viewing.Private.LmvMatrix4(matrix.isDoublePrecision).copy(matrix).invert();
    this.viewer.setNavigationLock(true);

    (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.setCutPlane)(this.viewer, matrix);

    await (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.fitCameraToSheet)(this.viewer, model);

    // Reset transform
    this.viewer.impl.setPlacementTransform(model, new THREE.Matrix4());
    this.viewer.impl.invalidate(true);
    (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.fitAfterTransformImmediate)(this.viewer, invMatrix);

    // Hide other models
    const otherModels = this.viewer.getVisibleModels().filter((m) => m !== model);
    otherModels.forEach((m) => this.ext.hideModel(m.getDocumentNode()));

    // Show paper and restore viewport
    this.viewer.impl.changePaperVisibility(model, true, true, null, _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.SHOW_DURATION);
    await (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.setViewportBounds)(this.viewer, model, null, _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.SHOW_DURATION);

    this.ext.updateUI({ resetTransformAndViewport: false });

    this.viewer.impl.setDoNotCut(model, true);

    this.viewer.setNavigationLock(false);
  }
}

/***/ },

/***/ "./extensions/ModelSheetTransition/SheetToModel.js"
/*!*********************************************************!*\
  !*** ./extensions/ModelSheetTransition/SheetToModel.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ SheetToModel)
/* harmony export */ });
/* harmony import */ var _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");
/* harmony import */ var _ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ModelSheetCommon.js */ "./extensions/ModelSheetTransition/ModelSheetCommon.js");



class SheetToModel {
  constructor(extension) {
    this.ext = extension;
    this.viewer = extension.viewer;
  }

  async transition2Dto3D(model2D) {
    if (!this.viewer.impl.is2d) {
      return;
    }

    // Start fetching the transforms
    const nodeAndViewportPromise = this.ext.getNodeAndViewport(model2D);

    // First transition to showing whole sheet. Lock navigation until transition is finished.
    this.viewer.setNavigationLock(true);
    await (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.fitToBoundsWithAnimation)(this.viewer, model2D);

    let bubbleNode, viewport;

    try {
      ({ bubbleNode, viewport } = await nodeAndViewportPromise);
    } catch (err) {
      // Restore navigation
      this.viewer.setNavigationLock(false);

      this.ext.displayError(Autodesk.Viewing.i18n.translate('No suitable model found for transition.'));
      console.warn(err);
      return;
    }

    // Prevent sheets from getting cut by cutplanes
    this.viewer.impl.setDoNotCut(model2D, true);

    this.ext.setSelectedViewport(viewport);

    // Hide the 2D model before loading the 3D model to remove it from viewer.model.
    // This ensures that when the 3D model is loaded, it becomes the main model and
    // the UI (including measurement tools) initializes correctly for 3D mode.
    this.viewer.hideModel(model2D);

    // Show the 3D model
    const model3D = await this.ext.showModel(bubbleNode);

    // Hide model until the cutplane is configured.
    model3D.setAllVisibility(false);

    // Disable ghosting for the model as well.
    const prevGhostingState = this.viewer.prefs.get(Autodesk.Viewing.Private.Prefs3D.GHOSTING);
    this.viewer.setGhosting(false);

    // Re-show the 2D model after hiding the 3D model.
    this.viewer.showModel(model2D);

    const unitScale = model2D.getUnitScale();
    let matrix = viewport.get2DTo3DMatrix(unitScale);

    if (viewport.isMatrixInLocalCoords()) {
      const modelToViewerTransform = model3D.getModelToViewerTransform();
      if (modelToViewerTransform) {
        matrix = matrix.clone().multiplyMatrices(modelToViewerTransform, matrix);
      }
    }

    // Set the transform to the sheet
    model2D.setPlacementTransform(matrix);
    (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.fitAfterTransformImmediate)(this.viewer, matrix);

    // Define a cutplane with the sheet's plane, so that it's fully visible and not occluded by the model when we start
    // This cutplane can then be moved in the sheet's normal axis.
    (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.setCutPlane)(this.viewer, matrix);


    model3D.setAllVisibility(true);
    this.viewer.setGhosting(prevGhostingState);


    // Navigation is free from this point
    this.viewer.setNavigationLock(false);

    // Hide paper and crop to viewport
    this.viewer.impl.changePaperVisibility(model2D, false, true, null, _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.HIDE_DURATION);

    const viewportBounds = viewport.getViewportBounds(unitScale);

    if (viewportBounds) {
      await (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.setViewportBounds)(this.viewer, model2D, viewportBounds, _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.HIDE_DURATION);
    }

    Autodesk.Viewing.Private.analytics.track(Autodesk.ModelSheetTransition.AnalyticsEventName, {
      action: 'View',
      alignment: viewport instanceof Autodesk.AEC.ViewportsExtension.AecModelDataViewport ? 'Automatic' : 'Manual',
      from: 'Sheet',
      file_2d_extension: model2D.getDocumentNode().getInputFileType(),
      file_3d_extension: bubbleNode.getInputFileType(),
      ...(0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.getCaptureConfigAnalyticsParams)(viewport)
    });
  }
}

/***/ },

/***/ "./extensions/ModelSheetTransition/UI/ModelSheet3DMarker.js"
/*!******************************************************************!*\
  !*** ./extensions/ModelSheetTransition/UI/ModelSheet3DMarker.js ***!
  \******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ModelSheet3DMarker)
/* harmony export */ });
/* harmony import */ var _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");
/* harmony import */ var _ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../ModelSheetCommon.js */ "./extensions/ModelSheetTransition/ModelSheetCommon.js");



class ModelSheet3DMarker {
  constructor(extension, viewport, model3D, ui, isVisible) {
    this.extension = extension;
    this.viewer = extension.viewer;
    this.viewport = viewport;
    this.viewportGuid = viewport?.getGuid?.();
    this.model3D = model3D;
    this.ui = ui;

    // Generic shared plane to use when sheet is not visible
    this.boundsPlane = extension.boundsPlane;

    // Bounded functions
    this.onShowHide = this.onShowHide.bind(this);
    this.onGoToSheet = this.onGoToSheet.bind(this);
    this.update = this.update.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onMouseEnter = this.onMouseEnter.bind(this);
    this.onMouseLeave = this.onMouseLeave.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);

    this.matrix = new THREE.Matrix4();
    this._hoverPreviewRequestId = 0;

    this.#calculateMatrixAndBounds();
    this.createAndAddMarker();
    this.setVisible(isVisible);
  }

  /**
   * Recomputes the cached viewport bounds and 2D→3D transform used for marker placement and preview.
   */
  #calculateMatrixAndBounds() {
    const dummyScale = 1.0;
    this.viewportBounds = this.viewport.getViewportBounds(dummyScale);
    this.viewportMatrix = this.viewport.get2DTo3DMatrix(dummyScale);
  }

  createAndAddMarker() {
    // Guid is added to the hash to allow multiple copies of the same sheet to be loaded, with different placements
    this.button = new Autodesk.Viewing.UI.Button(`mst-b-${this.viewport.getGuid()}`);
    this.button.setToolTip(this.viewport.getName());

    this.container = this.button.container;
    this.container.classList.add('hyper-sheet-marker', 'hyper-sheet-marker-icon');
    // The icon class adds some styling we don't need (and enlarges the click area)
    this.button.icon.remove("adsk-button-icon");

    this.container.addEventListener('click', this.onClick);
    this.container.addEventListener('mouseenter', this.onMouseEnter);
    this.container.addEventListener('mouseleave', this.onMouseLeave);
    this.container.addEventListener('mousewheel', this.onMouseWheel);

    this.viewer.container.appendChild(this.container);

    this.update();
  }

  setVisible(isVisible) {
    this.button?.setVisible(isVisible);
  }

  setDefaultStyle() {
    this.container.classList.remove('clicked');
  }

  onClick(e) {
    this.boundsPlane.lock = true;
    const viewport = this.viewer.container.getBoundingClientRect();

    // Normalize Hammer events
    if (Array.isArray(e.changedPointers) && e.changedPointers.length > 0) {
      e.clientX = e.changedPointers[0].clientX;
      e.clientY = e.changedPointers[0].clientY;
    }

    const x = e.clientX - viewport.left;
    const y = e.clientY - viewport.top;

    this.container.classList.add('clicked');

    this.ui.show({ x, y }, this.isSheetVisible, this.onShowHide, this.onGoToSheet);
  }

  onShowHide() {
    const from = 'Marker';

    if (this.isSheetVisible) {
      this.hideSheet(from);
    } else {
      this.showSheet(from);
    }
  }

  async getNode() {
    if (!this.nodePromise) {
      this.nodePromise = this.viewport.getParentSheetNode();
    }

    return await this.nodePromise;
  }

  /**
   * Refreshes cached viewport-related data used by the marker preview plane.
   *
   * @param {Autodesk.Viewing.BubbleNode} [node]
   */
  async #refreshViewportData(node) {
    const guid = this.viewport?.getGuid?.() || this.viewportGuid;
    const viewportsExt = this.extension?.viewportsExtension;
    if (!guid || !viewportsExt) {
      return;
    }

    // Prefer the latest cached viewport instance by guid.
    const latestViewport = viewportsExt.findViewportByGuid?.(guid);
    if (latestViewport) {
      this.viewport = latestViewport;
      this.viewportGuid = guid;
    } else if (node && viewportsExt.getViewportsAsync) {
      // Best-effort fallback (may trigger fetch depending on cache state).
      try {
        const vps = await viewportsExt.getViewportsAsync(node, { onlyTopViewPlans: false });
        const resolved = Array.isArray(vps) ? vps.find((vp) => vp?.getGuid?.() === guid) : null;
        if (resolved) {
          this.viewport = resolved;
          this.viewportGuid = guid;
        }
      } catch (e) {

        // Best-effort; keep existing viewport.
      }}

    this.#calculateMatrixAndBounds();
  }

  setMarkerSelected(isSelected) {
    if (isSelected) {
      this.container.classList.add('selected');
      this.isSheetVisible = true;
      this.extension.onMarkerSelected(this);
    } else {
      this.container.classList.remove('selected');
      this.isSheetVisible = false;
      this.extension.onMarkerDeselected(this);
    }
  }

  async hideSheet(from) {
    if (!this.isSheetVisible) {
      return;
    }

    const node = await this.getNode();
    this.setMarkerSelected(false);
    this.extension.hideSheet(node);
    this.viewer.impl.setCutPlaneSet(_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_0__.MODEL_SHEET_SECTION_SET, null);

    // If the sheet is hidden while hovering, we want to re-show the preview plane. However, if it is issued from outside (e.g. when showing a different sheet) we don't want to show it.
    if (from === "Marker" || from === "Panel") {
      this._schedulePreviewPlane(0);
    }

    this.reportAnalytics('Hide', from, node);
  }

  async showSheet(from) {
    if (this.isSheetVisible) {
      return;
    }

    this.setMarkerSelected(true);

    const node = await this.getNode();
    // Ensure we use the latest post-edit viewport transform when restoring the sheet (hide/show flow).
    await this.#refreshViewportData(node);
    const model = await this.extension.showSheetAndSetTransform(node, this.viewport, this.model3D);

    this.reportAnalytics('View', from, node);

    // Make sure that model should still be visible at this step (maybe someone clicked showSheet & hideSheet fast enough so by this point it should be hidden again).
    if (!this.isSheetVisible) {
      this.extension.hideModel(node);
      return null;
    }

    this._cancelPreviewPlane();
    this.removePlane();

    return model;
  }

  async onGoToSheet() {
    let model = await this.getModel();
    if (!this.isSheetVisible || !model) {
      model = await this.showSheet();
    }

    this.extension.transitionModelToSheet(model);
  }

  onMouseEnter() {
    if (this.isSheetVisible) {
      return;
    }

    this._schedulePreviewPlane();
  }

  onMouseLeave() {
    if (!this.boundsPlane.lock) {
      this._cancelPreviewPlane();
      this.removePlane();
    }
  }

  /**
   * Schedules the hover-preview plane.
   *
   * The preview plane uses cached viewport data (`viewportMatrix`/`viewportBounds`) and the marker's cached world
   * matrix. After alignment edits, the viewport transform can change, so we must refresh these caches before
   * showing the preview, otherwise it will appear at the pre-edit position.
   */
  _schedulePreviewPlane(timeout = 300) {
    const requestId = ++this._hoverPreviewRequestId;

    this.enterTimeout = setTimeout(async () => {
      // Hover may have been cancelled while we waited.
      if (requestId !== this._hoverPreviewRequestId) {
        return;
      }

      // Best-effort refresh: fast path uses cached viewports by guid.
      // (We intentionally avoid forcing a service refetch on hover.)
      await this.#refreshViewportData();

      // Refresh marker world transform from the refreshed viewport data.
      this.update();

      if (requestId !== this._hoverPreviewRequestId || this.isSheetVisible || this.boundsPlane.lock) {
        return;
      }

      this.addPlane();
    }, timeout);
  }

  _cancelPreviewPlane() {
    this._hoverPreviewRequestId++;
    clearTimeout(this.enterTimeout);
    this.enterTimeout = null;
  }

  addPlane() {
    // When the sheet is not visible, show a plane to give a sense of its dimensions
    const min = new THREE.Vector3(this.viewportBounds.min.x, this.viewportBounds.min.y, 0);
    const max = new THREE.Vector3(this.viewportBounds.max.x, this.viewportBounds.max.y, 0);
    const bbox = new THREE.Box3(min, max);

    const size = bbox.getSize(new THREE.Vector3());
    const scaleMatrix = new THREE.Matrix4().makeScale(size.x, size.y, 1);
    scaleMatrix.setPosition(bbox.getCenter(new THREE.Vector3()));
    const matrix = this.matrix.clone();
    matrix.multiply(scaleMatrix);

    if (this.viewport.isMatrixInLocalCoords()) {
      const model3DTransform = this.model3D.getModelToViewerTransform();
      if (model3DTransform) {
        matrix.multiplyMatrices(model3DTransform, matrix);
      }
    }

    this.boundsPlane.setFromMatrix(matrix);
    this.boundsPlane.setVisible(true);
  }

  removePlane() {
    this.boundsPlane.setVisible(false);
  }

  onMouseWheel(e) {
    // Propagate mouse wheel event to viewer
    this.viewer.toolController.mousewheel(e);
  }

  async getModel() {
    const node = await this.getNode();

    const models = this.viewer.getAllModels();
    const model = models.find((m) => {
      return m.getDocumentNode() === node;
    });

    return model;
  }

  setWorldPosition() {
    const maxX = this.viewportBounds.max.x;
    const minY = this.viewportBounds.min.y;

    this.matrix.copy(this.viewportMatrix);

    const bottomRight = new THREE.Vector3(maxX, minY, 0.0).applyMatrix4(this.matrix);

    if (this.viewport.isMatrixInLocalCoords()) {
      const model3DTransform = this.model3D.getModelToViewerTransform();
      if (model3DTransform) {
        bottomRight.applyMatrix4(model3DTransform);
      }
    }

    this.location = bottomRight;
  }

  updateClientLocation() {
    const pos = this.viewer.impl.worldToClient(this.location);

    this.container.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }

  update() {
    this.setWorldPosition();
    this.updateClientLocation();
  }

  destroy() {
    if (this.container) {
      this.viewer.container.removeChild(this.container);
    }

    this.button = null;
  }

  reportAnalytics(action, from, node) {
    if (!action || !from || !node) {
      return;
    }

    Autodesk.Viewing.Private.analytics.track(Autodesk.ModelSheetTransition.AnalyticsEventName, {
      action,
      alignment: this.viewport instanceof Autodesk.AEC.ViewportsExtension.AecModelDataViewport ? 'Automatic' : 'Manual',
      from,
      file_2d_extension: node.getInputFileType(),
      file_3d_extension: this.model3D.getDocumentNode().getInputFileType(),
      ...(0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_1__.getCaptureConfigAnalyticsParams)(this.viewport)
    });
  }
}

/***/ },

/***/ "./extensions/ModelSheetTransition/UI/ModelSheetGenericUI.js"
/*!*******************************************************************!*\
  !*** ./extensions/ModelSheetTransition/UI/ModelSheetGenericUI.js ***!
  \*******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ModelSheetGenericUI)
/* harmony export */ });
/*
UI needs to receive the location to display (not dynamic - clicking outside closes the menu)
UI needs to receive the urn / or bubble (see utils in UI repo) to show the correct thumbnail
UI needs to receive state of sheet (is it shown/hidden)
UI needs to receive 2 callbacks to run when show/hide is called, and when go to sheet is called
*/

class ModelSheetGenericUI {
  constructor(viewer, onHide) {
    this.viewer = viewer;
    this.ctxMenu = new Autodesk.Viewing.Private.ContextMenu(this.viewer, { onHide });
  }

  show(position, isVisible, onShowHide, onGoToSheet) {
    const { x, y } = position;

    const menu = [];
    menu.push({
      icon: isVisible ? 'viewericon-model-sheet-eye-hide' : 'viewericon-model-sheet-eye-show',
      title: isVisible ? 'Hide sheet' : 'Show sheet',
      target: onShowHide
    });
    menu.push({
      icon: 'viewericon-model-sheet-sheet',
      title: 'Go to sheet',
      target: onGoToSheet
    });

    this.ctxMenu.showMenu(menu, x, y);
    this.ctxMenu.open = true;
  }

}

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ModelSheetTransition/ModelSheetTransition.css"
/*!******************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ModelSheetTransition/ModelSheetTransition.css ***!
  \******************************************************************************************************************************************************************************************************************************************************************************/
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:application/font-woff;base64,d09GRgABAAAAAAP8AAoAAAAABjgAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAAA9AAAAD4AAABWVsFjP2NtYXAAAAE0AAAAPAAAAUoArAFrZ2x5ZgAAAXAAAADAAAAAwMOBpSJoZWFkAAACMAAAACsAAAA2GlHbmWhoZWEAAAJcAAAAGwAAACQIPQQDaG10eAAAAngAAAAIAAAACAgAAABsb2NhAAACgAAAAAYAAAAGAGAAAG1heHAAAAKIAAAAIAAAACABEABGbmFtZQAAAqgAAAE7AAACbdWMZSRwb3N0AAAD5AAAABUAAAApARAAAHicY2BkYWCcwMDKwMHUyXSGgYGhH0IzvmYwYuRgYGBiYGVmwAoC0lxTGBwYfBl8WUDcGBaIMCOIAACZnwe0AAB4nGNgYGBmgGAZBkYGEHAB8hjBfBYGDSDNBqQZGZiALN///8EqwPT/LVD1QMDIxkBdwEhYyWADAMFRBxMABAAAAAAD4AQAACEAKQAxADkAAAEuAicjJSMmIgcFBgcGBxQVER4BFwUXMyU+ATURNCc4AQEmLwERBREwEyYvASUNATABBg8BESURMAPeAQUFAwP+SQUJFQn+TQYEBwUBDQsBsQ0ZAbcLDQL9+BacsgFkKhaUqgFUAVP+rQGNF5yyAWUDFAUHBgPSBQXNBAcGCQUG/eEMFAXABcIFFAwCIgUG/VQJRU8BxJ3+PAILCkJLoaGX/pIKRU4BxJ3+PAB4nGNgZGBgAOKs5tdr4/ltvjJwszCAwO2Vp/2QaeYHYHEOBiYQBQBAlgphAHicY2BkYGBhAIIYMMnA/ICBkQEVMAEAG9IBTAAEAAAABAAAAAAAAAAAYAAAAAEAAAACADoABAAAAAAAAgAAAAoACgAAAP8AAAAAAAB4nHWPS07DMBCGf/cFtBKqqGCH5AViASh9iFU37Jp9F92nrdOH0jhy3Eo9AOfhCJyAI9AbcAd+0gGhUmJ5/M03k3EC4AI7KOyfS+49K5wy23MJJ7gWLtPfCFfID8JVNPAoXKN/Eq7jHqFwAy04TlCVM2Z3eBZWaOJFuIRzvAqX6d+EK+R34Squ8CFcQ1OVhesYqZZwA7dqEZrUuMibqR5vdZhss7k37vscmtk6idyhHhmXL2yqu0Hnp/R7TL6Z9byPdezsSg9s6k2SWJ05uzQTH8y9z/rtdiw+mNgVf98g5XaI4HlOoTHGljFEwjPDvPDuTz5knGFNGx2pHuajIuZYwPI+jS4CdI689d/X5Njwth6tR8w8Zo/FijQoJn51J1yWJitqS5oJfVBM97R9tLnig/6AXZz0CTRjb6QAeJxjYGKAAC4G7AAozwhSAwAB1gASAAAA */ "data:application/font-woff;base64,d09GRgABAAAAAAP8AAoAAAAABjgAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAAA9AAAAD4AAABWVsFjP2NtYXAAAAE0AAAAPAAAAUoArAFrZ2x5ZgAAAXAAAADAAAAAwMOBpSJoZWFkAAACMAAAACsAAAA2GlHbmWhoZWEAAAJcAAAAGwAAACQIPQQDaG10eAAAAngAAAAIAAAACAgAAABsb2NhAAACgAAAAAYAAAAGAGAAAG1heHAAAAKIAAAAIAAAACABEABGbmFtZQAAAqgAAAE7AAACbdWMZSRwb3N0AAAD5AAAABUAAAApARAAAHicY2BkYWCcwMDKwMHUyXSGgYGhH0IzvmYwYuRgYGBiYGVmwAoC0lxTGBwYfBl8WUDcGBaIMCOIAACZnwe0AAB4nGNgYGBmgGAZBkYGEHAB8hjBfBYGDSDNBqQZGZiALN///8EqwPT/LVD1QMDIxkBdwEhYyWADAMFRBxMABAAAAAAD4AQAACEAKQAxADkAAAEuAicjJSMmIgcFBgcGBxQVER4BFwUXMyU+ATURNCc4AQEmLwERBREwEyYvASUNATABBg8BESURMAPeAQUFAwP+SQUJFQn+TQYEBwUBDQsBsQ0ZAbcLDQL9+BacsgFkKhaUqgFUAVP+rQGNF5yyAWUDFAUHBgPSBQXNBAcGCQUG/eEMFAXABcIFFAwCIgUG/VQJRU8BxJ3+PAILCkJLoaGX/pIKRU4BxJ3+PAB4nGNgZGBgAOKs5tdr4/ltvjJwszCAwO2Vp/2QaeYHYHEOBiYQBQBAlgphAHicY2BkYGBhAIIYMMnA/ICBkQEVMAEAG9IBTAAEAAAABAAAAAAAAAAAYAAAAAEAAAACADoABAAAAAAAAgAAAAoACgAAAP8AAAAAAAB4nHWPS07DMBCGf/cFtBKqqGCH5AViASh9iFU37Jp9F92nrdOH0jhy3Eo9AOfhCJyAI9AbcAd+0gGhUmJ5/M03k3EC4AI7KOyfS+49K5wy23MJJ7gWLtPfCFfID8JVNPAoXKN/Eq7jHqFwAy04TlCVM2Z3eBZWaOJFuIRzvAqX6d+EK+R34Squ8CFcQ1OVhesYqZZwA7dqEZrUuMibqR5vdZhss7k37vscmtk6idyhHhmXL2yqu0Hnp/R7TL6Z9byPdezsSg9s6k2SWJ05uzQTH8y9z/rtdiw+mNgVf98g5XaI4HlOoTHGljFEwjPDvPDuTz5knGFNGx2pHuajIuZYwPI+jS4CdI689d/X5Njwth6tR8w8Zo/FijQoJn51J1yWJitqS5oJfVBM97R9tLnig/6AXZz0CTRjb6QAeJxjYGKAAC4G7AAozwhSAwAB1gASAAAA"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! data:application/font-woff;base64,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 */ "data:application/font-woff;base64,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"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.viewericon-model-sheet-transition:before {
  font-family: "modelSheetTransitionIcon";
  content: "M";
}

@font-face {
  font-family: "modelSheetTransitionIcon";
  src: url(${___CSS_LOADER_URL_REPLACEMENT_0___}) format("woff");
  font-weight: normal;
  font-style: normal;
}
.viewericon-model-sheet-eye-hide:before {
  font-family: "modelSheetContextMenuIcons";
  font-size: 20px;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  content: "\\ea01";
}

.viewericon-model-sheet-eye-show:before {
  font-family: "modelSheetContextMenuIcons";
  font-size: 20px;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  content: "\\ea02";
}

.viewericon-model-sheet-sheet:before {
  font-family: "modelSheetContextMenuIcons";
  font-size: 20px;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  content: "\\ea03";
}

@font-face {
  font-family: "modelSheetContextMenuIcons";
  src: url(${___CSS_LOADER_URL_REPLACEMENT_1___}) format("woff");
  font-weight: 400;
  font-style: normal;
}
.hyper-sheet-marker.adsk-button {
  position: absolute;
  width: 32px;
  height: 32px;
  left: 0;
  top: 0;
  margin: 0;
  padding: 0;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  box-sizing: content-box;
  transition: color 0.2s ease-in-out;
  will-change: transform;
  border: none;
}

.hyper-sheet-marker-icon:before {
  font-family: "modelSheetContextMenuIcons";
  font-size: 16px;
  text-rendering: auto;
  -webkit-font-smoothing: antialiased;
  content: "\\ea03";
  display: flex;
  flex-direction: row;
  transform: translate(-50%, -50%);
  position: absolute;
  left: 50%;
  top: 50%;
}

.hyper-sheet-marker.adsk-button:hover {
  color: #3C3C3C !important;
  background: rgb(255, 255, 255);
}

.hyper-sheet-marker.adsk-button.clicked {
  box-shadow: 0px 0px 0px 2px #006EAF;
}

.hyper-sheet-marker.adsk-button.selected {
  box-shadow: 0px 0px 0px 2px #000000;
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

/***/ "./extensions/ModelSheetTransition/ModelSheetTransition.css"
/*!******************************************************************!*\
  !*** ./extensions/ModelSheetTransition/ModelSheetTransition.css ***!
  \******************************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ModelSheetTransition_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./ModelSheetTransition.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ModelSheetTransition/ModelSheetTransition.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ModelSheetTransition_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ModelSheetTransition_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ModelSheetTransition_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ModelSheetTransition_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "data:application/font-woff;base64,d09GRgABAAAAAAP8AAoAAAAABjgAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAAA9AAAAD4AAABWVsFjP2NtYXAAAAE0AAAAPAAAAUoArAFrZ2x5ZgAAAXAAAADAAAAAwMOBpSJoZWFkAAACMAAAACsAAAA2GlHbmWhoZWEAAAJcAAAAGwAAACQIPQQDaG10eAAAAngAAAAIAAAACAgAAABsb2NhAAACgAAAAAYAAAAGAGAAAG1heHAAAAKIAAAAIAAAACABEABGbmFtZQAAAqgAAAE7AAACbdWMZSRwb3N0AAAD5AAAABUAAAApARAAAHicY2BkYWCcwMDKwMHUyXSGgYGhH0IzvmYwYuRgYGBiYGVmwAoC0lxTGBwYfBl8WUDcGBaIMCOIAACZnwe0AAB4nGNgYGBmgGAZBkYGEHAB8hjBfBYGDSDNBqQZGZiALN///8EqwPT/LVD1QMDIxkBdwEhYyWADAMFRBxMABAAAAAAD4AQAACEAKQAxADkAAAEuAicjJSMmIgcFBgcGBxQVER4BFwUXMyU+ATURNCc4AQEmLwERBREwEyYvASUNATABBg8BESURMAPeAQUFAwP+SQUJFQn+TQYEBwUBDQsBsQ0ZAbcLDQL9+BacsgFkKhaUqgFUAVP+rQGNF5yyAWUDFAUHBgPSBQXNBAcGCQUG/eEMFAXABcIFFAwCIgUG/VQJRU8BxJ3+PAILCkJLoaGX/pIKRU4BxJ3+PAB4nGNgZGBgAOKs5tdr4/ltvjJwszCAwO2Vp/2QaeYHYHEOBiYQBQBAlgphAHicY2BkYGBhAIIYMMnA/ICBkQEVMAEAG9IBTAAEAAAABAAAAAAAAAAAYAAAAAEAAAACADoABAAAAAAAAgAAAAoACgAAAP8AAAAAAAB4nHWPS07DMBCGf/cFtBKqqGCH5AViASh9iFU37Jp9F92nrdOH0jhy3Eo9AOfhCJyAI9AbcAd+0gGhUmJ5/M03k3EC4AI7KOyfS+49K5wy23MJJ7gWLtPfCFfID8JVNPAoXKN/Eq7jHqFwAy04TlCVM2Z3eBZWaOJFuIRzvAqX6d+EK+R34Squ8CFcQ1OVhesYqZZwA7dqEZrUuMibqR5vdZhss7k37vscmtk6idyhHhmXL2yqu0Hnp/R7TL6Z9byPdezsSg9s6k2SWJ05uzQTH8y9z/rtdiw+mNgVf98g5XaI4HlOoTHGljFEwjPDvPDuTz5knGFNGx2pHuajIuZYwPI+jS4CdI689d/X5Njwth6tR8w8Zo/FijQoJn51J1yWJitqS5oJfVBM97R9tLnig/6AXZz0CTRjb6QAeJxjYGKAAC4G7AAozwhSAwAB1gASAAAA"
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:application/font-woff;base64,d09GRgABAAAAAAP8AAoAAAAABjgAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAAA9AAAAD4AAABWVsFjP2NtYXAAAAE0AAAAPAAAAUoArAFrZ2x5ZgAAAXAAAADAAAAAwMOBpSJoZWFkAAACMAAAACsAAAA2GlHbmWhoZWEAAAJcAAAAGwAAACQIPQQDaG10eAAAAngAAAAIAAAACAgAAABsb2NhAAACgAAAAAYAAAAGAGAAAG1heHAAAAKIAAAAIAAAACABEABGbmFtZQAAAqgAAAE7AAACbdWMZSRwb3N0AAAD5AAAABUAAAApARAAAHicY2BkYWCcwMDKwMHUyXSGgYGhH0IzvmYwYuRgYGBiYGVmwAoC0lxTGBwYfBl8WUDcGBaIMCOIAACZnwe0AAB4nGNgYGBmgGAZBkYGEHAB8hjBfBYGDSDNBqQZGZiALN///8EqwPT/LVD1QMDIxkBdwEhYyWADAMFRBxMABAAAAAAD4AQAACEAKQAxADkAAAEuAicjJSMmIgcFBgcGBxQVER4BFwUXMyU+ATURNCc4AQEmLwERBREwEyYvASUNATABBg8BESURMAPeAQUFAwP+SQUJFQn+TQYEBwUBDQsBsQ0ZAbcLDQL9+BacsgFkKhaUqgFUAVP+rQGNF5yyAWUDFAUHBgPSBQXNBAcGCQUG/eEMFAXABcIFFAwCIgUG/VQJRU8BxJ3+PAILCkJLoaGX/pIKRU4BxJ3+PAB4nGNgZGBgAOKs5tdr4/ltvjJwszCAwO2Vp/2QaeYHYHEOBiYQBQBAlgphAHicY2BkYGBhAIIYMMnA/ICBkQEVMAEAG9IBTAAEAAAABAAAAAAAAAAAYAAAAAEAAAACADoABAAAAAAAAgAAAAoACgAAAP8AAAAAAAB4nHWPS07DMBCGf/cFtBKqqGCH5AViASh9iFU37Jp9F92nrdOH0jhy3Eo9AOfhCJyAI9AbcAd+0gGhUmJ5/M03k3EC4AI7KOyfS+49K5wy23MJJ7gWLtPfCFfID8JVNPAoXKN/Eq7jHqFwAy04TlCVM2Z3eBZWaOJFuIRzvAqX6d+EK+R34Squ8CFcQ1OVhesYqZZwA7dqEZrUuMibqR5vdZhss7k37vscmtk6idyhHhmXL2yqu0Hnp/R7TL6Z9byPdezsSg9s6k2SWJ05uzQTH8y9z/rtdiw+mNgVf98g5XaI4HlOoTHGljFEwjPDvPDuTz5knGFNGx2pHuajIuZYwPI+jS4CdI689d/X5Njwth6tR8w8Zo/FijQoJn51J1yWJitqS5oJfVBM97R9tLnig/6AXZz0CTRjb6QAeJxjYGKAAC4G7AAozwhSAwAB1gASAAAA ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:application/font-woff;base64,d09GRgABAAAAAAP8AAoAAAAABjgAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAAA9AAAAD4AAABWVsFjP2NtYXAAAAE0AAAAPAAAAUoArAFrZ2x5ZgAAAXAAAADAAAAAwMOBpSJoZWFkAAACMAAAACsAAAA2GlHbmWhoZWEAAAJcAAAAGwAAACQIPQQDaG10eAAAAngAAAAIAAAACAgAAABsb2NhAAACgAAAAAYAAAAGAGAAAG1heHAAAAKIAAAAIAAAACABEABGbmFtZQAAAqgAAAE7AAACbdWMZSRwb3N0AAAD5AAAABUAAAApARAAAHicY2BkYWCcwMDKwMHUyXSGgYGhH0IzvmYwYuRgYGBiYGVmwAoC0lxTGBwYfBl8WUDcGBaIMCOIAACZnwe0AAB4nGNgYGBmgGAZBkYGEHAB8hjBfBYGDSDNBqQZGZiALN///8EqwPT/LVD1QMDIxkBdwEhYyWADAMFRBxMABAAAAAAD4AQAACEAKQAxADkAAAEuAicjJSMmIgcFBgcGBxQVER4BFwUXMyU+ATURNCc4AQEmLwERBREwEyYvASUNATABBg8BESURMAPeAQUFAwP+SQUJFQn+TQYEBwUBDQsBsQ0ZAbcLDQL9+BacsgFkKhaUqgFUAVP+rQGNF5yyAWUDFAUHBgPSBQXNBAcGCQUG/eEMFAXABcIFFAwCIgUG/VQJRU8BxJ3+PAILCkJLoaGX/pIKRU4BxJ3+PAB4nGNgZGBgAOKs5tdr4/ltvjJwszCAwO2Vp/2QaeYHYHEOBiYQBQBAlgphAHicY2BkYGBhAIIYMMnA/ICBkQEVMAEAG9IBTAAEAAAABAAAAAAAAAAAYAAAAAEAAAACADoABAAAAAAAAgAAAAoACgAAAP8AAAAAAAB4nHWPS07DMBCGf/cFtBKqqGCH5AViASh9iFU37Jp9F92nrdOH0jhy3Eo9AOfhCJyAI9AbcAd+0gGhUmJ5/M03k3EC4AI7KOyfS+49K5wy23MJJ7gWLtPfCFfID8JVNPAoXKN/Eq7jHqFwAy04TlCVM2Z3eBZWaOJFuIRzvAqX6d+EK+R34Squ8CFcQ1OVhesYqZZwA7dqEZrUuMibqR5vdZhss7k37vscmtk6idyhHhmXL2yqu0Hnp/R7TL6Z9byPdezsSg9s6k2SWJ05uzQTH8y9z/rtdiw+mNgVf98g5XaI4HlOoTHGljFEwjPDvPDuTz5knGFNGx2pHuajIuZYwPI+jS4CdI689d/X5Njwth6tR8w8Zo/FijQoJn51J1yWJitqS5oJfVBM97R9tLnig/6AXZz0CTRjb6QAeJxjYGKAAC4G7AAozwhSAwAB1gASAAAA";

/***/ },

/***/ "data:application/font-woff;base64,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"
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:application/font-woff;base64,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 ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:application/font-woff;base64,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";

/***/ },

/***/ "./res/locales/cs/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/cs/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"cs","@@context":"Rozšíření ModelSheetTransition","View drawing in 3D":"Zobrazit výkres ve 3D","Fetching alignment information...":"Načítání informací o zarovnání...\'","Current view is not supported by View drawing in 3D":"Aktuální pohled není podporován funkcí Zobrazit výkres ve 3D."}');

/***/ },

/***/ "./res/locales/da/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/da/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"da","@@context":"Udvidelsen ModelArkOvergang","View drawing in 3D":"Vis tegning i 3D","Fetching alignment information...":"Henter justeringsoplysninger...\'","Current view is not supported by View drawing in 3D":"Det aktuelle billede understøttes ikke af Vis tegning i 3D"}');

/***/ },

/***/ "./res/locales/de/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/de/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"de","@@context":"Modellblechübergangserweiterung","View drawing in 3D":"Zeichnungen in 3D anzeigen","Fetching alignment information...":"Achsinformationen werden abgerufen...","Current view is not supported by View drawing in 3D":"Aktuelle Ansicht wird von Zeichnung in 3D anzeigen nicht unterstützt"}');

/***/ },

/***/ "./res/locales/en-GB/nobundle-modelSheetTransition.loc.json"
/*!******************************************************************!*\
  !*** ./res/locales/en-GB/nobundle-modelSheetTransition.loc.json ***!
  \******************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"en","@@context":"ModelSheetTransition Extension","View drawing in 3D":"View drawing in 3D","Fetching alignment information...":"Fetching Alignment Information...\'","Current view is not supported by View drawing in 3D":"Current view is not supported by \'View drawing in 3D\'"}');

/***/ },

/***/ "./res/locales/en/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/en/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"en","@@context":"ModelSheetTransition Extension","View drawing in 3D":"View drawing in 3D","Fetching alignment information...":"Fetching alignment information...\'","Current view is not supported by View drawing in 3D":"Current view is not supported by View drawing in 3D"}');

/***/ },

/***/ "./res/locales/es/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/es/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"es","@@context":"Extensión ModelSheetTransition","View drawing in 3D":"Ver dibujo en 3D","Fetching alignment information...":"Recuperando información de alineación...","Current view is not supported by View drawing in 3D":"La vista actual no es compatible con el dibujo de vista en 3D."}');

/***/ },

/***/ "./res/locales/fr-CA/nobundle-modelSheetTransition.loc.json"
/*!******************************************************************!*\
  !*** ./res/locales/fr-CA/nobundle-modelSheetTransition.loc.json ***!
  \******************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"fr-CA","@@context":"Extension de la transition de feuille modèle","View drawing in 3D":"Afficher le dessin en 3D","Fetching alignment information...":"Récupération de l\'information sur l\'alignement...","Current view is not supported by View drawing in 3D":"La vue courante n\'est pas prise en charge par l\'affichage du dessin en 3D"}');

/***/ },

/***/ "./res/locales/fr/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/fr/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"fr","@@context":"Extension ModelSheetTransition","View drawing in 3D":"Afficher le dessin en 3D","Fetching alignment information...":"Récupération des informations sur l\'axe...\'","Current view is not supported by View drawing in 3D":"La vue courante n\'est pas prise en charge par l\'option Afficher le dessin en 3D"}');

/***/ },

/***/ "./res/locales/it/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/it/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"it","@@context":"Estensione ModelSheetTransition","View drawing in 3D":"Visualizza disegno in 3D","Fetching alignment information...":"Recupero delle informazioni sul tracciato in corso...\'","Current view is not supported by View drawing in 3D":"La vista corrente non è supportata da Visualizza disegno in 3D"}');

/***/ },

/***/ "./res/locales/ja/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/ja/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"ja","@@context":"ModelSheetTransition エクステンション","View drawing in 3D":"3D で図面を表示","Fetching alignment information...":"位置合わせ情報を取得中...\'","Current view is not supported by View drawing in 3D":"3D で図面を表示では、現在のビューはサポートされていません"}');

/***/ },

/***/ "./res/locales/ko/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/ko/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"ko","@@context":"ModelSheetTransition Extension","View drawing in 3D":"3D로 도면 보기","Fetching alignment information...":"정렬 정보를 가져오는 중...\'","Current view is not supported by View drawing in 3D":"현재 뷰는 3D로 도면 보기에서 지원되지 않습니다."}');

/***/ },

/***/ "./res/locales/nl/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/nl/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"nl","@@context":"ModelSheetTransition-extensie","View drawing in 3D":"Tekening in 3D weergeven","Fetching alignment information...":"Informatie over uitlijning ophalen...\'","Current view is not supported by View drawing in 3D":"De huidige weergave wordt niet ondersteund door \'Tekening in 3D weergeven\'"}');

/***/ },

/***/ "./res/locales/no/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/no/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"no","@@context":"ModelSheetTransition-utvidelse","View drawing in 3D":"Se tegning i 3D","Fetching alignment information...":"Henter justeringsinformasjon ...\'","Current view is not supported by View drawing in 3D":"Nåværende visning støttes ikke av Vis tegning i 3D"}');

/***/ },

/***/ "./res/locales/pl/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/pl/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"pl","@@context":"Przedłużenie arkusza modelu","View drawing in 3D":"Wyświetl rysunek w 3D","Fetching alignment information...":"Pobieranie informacji o wyrównaniu...","Current view is not supported by View drawing in 3D":"Bieżący widok nie jest obsługiwany w ramach funkcji wyświetlania rysunku w 3D"}');

/***/ },

/***/ "./res/locales/pt-BR/nobundle-modelSheetTransition.loc.json"
/*!******************************************************************!*\
  !*** ./res/locales/pt-BR/nobundle-modelSheetTransition.loc.json ***!
  \******************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"pt","@@context":"Extensão ModelSheetTransition","View drawing in 3D":"Visualizar desenho em 3D","Fetching alignment information...":"Buscando informações de alinhamento...\'","Current view is not supported by View drawing in 3D":"A vista atual não é compatível com a exibição do desenho em 3D"}');

/***/ },

/***/ "./res/locales/ru/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/ru/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"ru","@@context":"Расширение ModelSheetTransition","View drawing in 3D":"Просмотр чертежа в 3D","Fetching alignment information...":"Извлечение информации о трассе...","Current view is not supported by View drawing in 3D":"Текущий вид не поддерживается функцией «Просмотр чертежа в 3D»"}');

/***/ },

/***/ "./res/locales/sv/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/sv/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"sv","@@context":"ModelSheetTransition-tillägg","View drawing in 3D":"Visa ritning i 3D","Fetching alignment information...":"Hämtar justeringsinformation...\'","Current view is not supported by View drawing in 3D":"Den aktuella vyn stöds inte av vyritningen i 3D"}');

/***/ },

/***/ "./res/locales/tr/nobundle-modelSheetTransition.loc.json"
/*!***************************************************************!*\
  !*** ./res/locales/tr/nobundle-modelSheetTransition.loc.json ***!
  \***************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"tr","@@context":"ModelSheetTransition Uzantısı","View drawing in 3D":"Çizimi 3B olarak görüntüle","Fetching alignment information...":"Hizalama bilgileri alınıyor...\'","Current view is not supported by View drawing in 3D":"Geçerli görünüm \\"Çizimi 3B olarak görüntüle\\" özelliği tarafından desteklenmiyor"}');

/***/ },

/***/ "./res/locales/zh-HK/nobundle-modelSheetTransition.loc.json"
/*!******************************************************************!*\
  !*** ./res/locales/zh-HK/nobundle-modelSheetTransition.loc.json ***!
  \******************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"zh-hk","@@context":"模型圖紙變化擴充功能","View drawing in 3D":"以 3D 形式檢視繪圖","Fetching alignment information...":"正在擷取定線資訊…","Current view is not supported by View drawing in 3D":"「以 3D 形式檢視繪圖」不支援目前視圖"}');

/***/ },

/***/ "./res/locales/zh-Hans/nobundle-modelSheetTransition.loc.json"
/*!********************************************************************!*\
  !*** ./res/locales/zh-Hans/nobundle-modelSheetTransition.loc.json ***!
  \********************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"zh-Hans","@@context":"ModelSheetTransition Extension","View drawing in 3D":"以三维方式查看图形","Fetching alignment information...":"正在获取路线信息…\'","Current view is not supported by View drawing in 3D":"以三维方式查看图形不支持当前视图"}');

/***/ },

/***/ "./res/locales/zh-Hant/nobundle-modelSheetTransition.loc.json"
/*!********************************************************************!*\
  !*** ./res/locales/zh-Hant/nobundle-modelSheetTransition.loc.json ***!
  \********************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"zh-Hant","@@context":"ModelSheetTransition 延伸","View drawing in 3D":"以 3D 檢視圖面","Fetching alignment information...":"正在擷取定線資訊...","Current view is not supported by View drawing in 3D":"以 3D 檢視圖面不支援目前視圖"}');

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
/******/ 			"ModelSheetTransition": 0
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
/*!*****************************************************************!*\
  !*** ./extensions/ModelSheetTransition/ModelSheetTransition.js ***!
  \*****************************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ModelSheetTransitionExtension)
/* harmony export */ });
/* harmony import */ var _ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ModelSheetCommon.js */ "./extensions/ModelSheetTransition/ModelSheetCommon.js");
/* harmony import */ var _ModelSheetTransitionLocals_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ModelSheetTransitionLocals.js */ "./extensions/ModelSheetTransition/ModelSheetTransitionLocals.js");
/* harmony import */ var _ModelSheetTransition_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./ModelSheetTransition.css */ "./extensions/ModelSheetTransition/ModelSheetTransition.css");
/* harmony import */ var _SheetToModel_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./SheetToModel.js */ "./extensions/ModelSheetTransition/SheetToModel.js");
/* harmony import */ var _ModelToSheet_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./ModelToSheet.js */ "./extensions/ModelSheetTransition/ModelToSheet.js");
/* harmony import */ var _UI_ModelSheetGenericUI_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./UI/ModelSheetGenericUI.js */ "./extensions/ModelSheetTransition/UI/ModelSheetGenericUI.js");
/* harmony import */ var _UI_ModelSheet3DMarker_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./UI/ModelSheet3DMarker.js */ "./extensions/ModelSheetTransition/UI/ModelSheet3DMarker.js");
/* harmony import */ var _BoundsPlane_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./BoundsPlane.js */ "./extensions/ModelSheetTransition/BoundsPlane.js");
/* harmony import */ var _EventTypes_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./EventTypes.js */ "./extensions/ModelSheetTransition/EventTypes.js");
/* harmony import */ var _ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./ModelSheetConstants.js */ "./extensions/ModelSheetTransition/ModelSheetConstants.js");











/**
* ModelSheetTransition is an extension for transitioning from a 2D model to its context inside a 3D model.
* Prerequisite is that the context (relationship and transform) exists and can be provided by a service.
*
*  * @example
*   viewer.loadExtension('Autodesk.ModelSheetTransition')
*
* @memberof Autodesk.Viewing.Extensions
* @see {@link Autodesk.Viewing.Extension} for common inherited methods.
* @class
* @hideConstructor
*/

const extensionName = 'Autodesk.ModelSheetTransition';
const namespace = AutodeskNamespace(extensionName);

const OverlayName = 'ModelSheetTransition_Extension_Overlay';
const LevelsExtensionId = 'Autodesk.AEC.LevelsExtension';
const AnalyticsEventName = 'viewer.hypermodel.view';

class ModelSheetTransitionExtension extends Autodesk.Viewing.Extension {
  /**
  * @param viewer
  * @param options - If no service is provided will just default to looking for available AEC data.
  *                  Must include a loadModel function that loads the related model (to load as hidden)
  *                  Must include a showModel function that shows the related model
  *                  Must include a hideModel function that hides the related model
  *                  Can include a displayError function that uses a custom UI to show errors
  */
  constructor(viewer, options = {}) {
    super(viewer, options);

    this.loadDocument = options.loadDocument;
    this.loadModel = options.loadModel;
    this.showModel = options.showModel;
    this.hideModel = options.hideModel;
    this.displayError = options.displayError || this._displayError.bind(this);

    // Bindings
    this.updateUI = this.updateUI.bind(this);
    this.updateMarkersClientLocation = this.updateMarkersClientLocation.bind(this);
    this.updateMarkers = this.updateMarkers.bind(this);
    this.addMarkersForModel = this.addMarkersForModel.bind(this);
    this.removeMarkersForModel = this.removeMarkersForModel.bind(this);
    this.onViewportDataFetched = this.onViewportDataFetched.bind(this);
    this.onSelectedFloorChanged = this.onSelectedFloorChanged.bind(this);
    this.onExtensionLoaded = this.onExtensionLoaded.bind(this);
    this.onExtensionUnloaded = this.onExtensionUnloaded.bind(this);

    this.sheetToModel = new _SheetToModel_js__WEBPACK_IMPORTED_MODULE_3__["default"](this);
    this.modelToSheet = new _ModelToSheet_js__WEBPACK_IMPORTED_MODULE_4__["default"](this);

    this.defaultPosition2D = new THREE.Vector3(0, 0, 1);
    this.defaultTarget2D = new THREE.Vector3(0, 0, 0);

    this.areMarkersVisible = false;
    this.markers = {};
  }

  async load() {
    if (!this.loadModel || !this.showModel || !this.hideModel) {
      console.error('One of ModelSheetTransition callbacks is missing.');
      return false;
    }

    this.cache = this.getCache();

    if (!this.cache.nodesAndViewports) {
      this.cache.nodesAndViewports = new Map();
    }

    if (!this.cache.transformedModels) {
      this.cache.transformedModels = new Map();
    }

    this.extendLocalization(_ModelSheetTransitionLocals_js__WEBPACK_IMPORTED_MODULE_1__.locales);

    this.viewportsExtension = await this.viewer.loadExtension('Autodesk.AEC.ViewportsExtension');

    this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.updateUI);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.updateUI);
    this.viewportsExtension.addEventListener(Autodesk.AEC.ViewportsExtension.Events.VIEWPORT_DATA_FETCHED_EVENT, this.onViewportDataFetched);

    this.viewer.addEventListener(Autodesk.Viewing.EXTENSION_LOADED_EVENT, this.onExtensionLoaded);
    this.viewer.addEventListener(Autodesk.Viewing.EXTENSION_UNLOADED_EVENT, this.onExtensionUnloaded);

    // Call onExtensionLoaded manually in order to check if the extension was already loaded.
    this.onExtensionLoaded({ extensionId: LevelsExtensionId });

    return true;
  }

  unload() {
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.updateUI);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.updateUI);
    this.viewportsExtension.removeEventListener(Autodesk.AEC.ViewportsExtension.Events.VIEWPORT_DATA_FETCHED_EVENT, this.onViewportDataFetched);

    this.viewer.removeEventListener(Autodesk.Viewing.EXTENSION_LOADED_EVENT, this.onExtensionLoaded);
    this.viewer.removeEventListener(Autodesk.Viewing.EXTENSION_UNLOADED_EVENT, this.onExtensionUnloaded);

    // Call onExtensionUnloaded manually in order to simulate the unloading of the extension.
    this.onExtensionUnloaded({ extensionId: LevelsExtensionId });

    this.hideSelectedSheet();

    this.destroyUIFor2D();
    this.destroyUIFor3D();

    this.viewer = null;
    this.options = null;

    return true;
  }

  onViewportDataFetched() {
    // Create UI according to new viewport data.
    this.updateUI({ resetTransformAndViewport: false });
  }

  async updateUI({ resetTransformAndViewport = true } = {}) {
    const model2D = (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__.getSuitable2DModel)(this.viewer);

    if (model2D) {// A suitable 2D model is only returned in 2D mode
      this.destroyUIFor3D();
      this.createUIfor2D();

      this.resetModelIfNeeded(model2D, resetTransformAndViewport);

      // updateUI is called whenever there's new viewport data, so this function
      // will return from the cached data.
      const viewports = this.getViewportsForModel(model2D);

      if (viewports.length) {
        // Currently, only latest viewport is used
        const vp = viewports[viewports.length - 1];

        try {
          // For a viewport from service, check there's permissions for file (and that it hasn't been deleted)
          // This call will throw in those cases.
          if (vp instanceof Autodesk.AEC.ViewportsExtension.AlignmentServiceViewport) {
            await vp.getRelatedModel3DInfo();
          }

          this.setButtonEnabled(true);
        } catch (e) {
          this.setButtonEnabled(false);
        }
      } else {
        this.setButtonEnabled(false);
      }
    } else {
      this.destroyUIFor2D();

      if (!this.viewer.impl.is2d) {// Is 3D
        this.createUIfor3D();

        // Add / Remove markers according to current viewer state.
        this.viewer.getHiddenModels().forEach(this.removeMarkersForModel);
        this.viewer.getVisibleModels().forEach(this.addMarkersForModel);
      }
    }
  }

  /**
  * Invoked by the viewer when the toolbar UI is available.
  *
  * @param {Autodesk.Viewing.UI.ToolBar} toolbar - toolbar instance.
  */
  onToolbarCreated(toolbar) {
    this.updateUI();
  }

  /**
  * @private
  */
  createUIfor2D() {
    const toolbar = this.viewer.getToolbar && this.viewer.getToolbar();

    if (!toolbar || this.toolbarButton) {
      return;
    }

    const toolbarGroup = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);
    if (!toolbarGroup) {
      return;
    }

    // Create the button first.
    this.toolbarButton = new Autodesk.Viewing.UI.Button('toolbar-model-sheet-transition');
    this.toolbarButton.setToolTip('Fetching alignment information...');
    this.toolbarButton.setIcon('viewericon-model-sheet-transition');
    this.toolbarButton.setState(Autodesk.Viewing.UI.Button.State.DISABLED);
    this.toolbarButton.onClick = async () => {
      if (this.transitionStarted) {
        return;
      }

      this.transitionStarted = true;
      const model = (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__.getSuitable2DModel)(this.viewer);
      if (!model) {
        console.warn('No suitable 2D model found for sheet to model transition');
        return;
      }
      this.setButtonEnabled(false, true);
      await this.sheetToModel.transition2Dto3D(model);
      this.cache.transformedModels.set(model, model); // Save the model in cache to restore its state later (showing page, clear transform, etc.)
      this.setButtonEnabled(true, true);

      this.transitionStarted = false;
    };

    toolbarGroup.addControl(this.toolbarButton);
  }

  setButtonEnabled(enabled, supported = enabled) {
    if (!this.toolbarButton) {
      return;
    }

    const supportedTooltip = 'View drawing in 3D';
    const unsupportedTooltip = 'Current view is not supported by View drawing in 3D';

    this.toolbarButton.setState(enabled ? Autodesk.Viewing.UI.Button.State.INACTIVE : Autodesk.Viewing.UI.Button.State.DISABLED);
    this.toolbarButton.setToolTip(supported ? supportedTooltip : unsupportedTooltip);
  }

  /**
  * @private
  */
  destroyUIFor2D() {
    if (!this.toolbarButton) {
      return;
    }

    const toolbar = this.viewer.getToolbar && this.viewer.getToolbar();
    if (!toolbar) {
      return;
    }

    this.toolbarButton.removeFromParent();
    this.toolbarButton = null;
  }

  /**
   * @private
   */
  createUIfor3D() {
    if (this.ui3DCreated) {
      return;
    }

    const onHide = () => {
      if (!this.markers) {
        return;
      }

      for (let key in this.markers) {
        this.markers[key].setDefaultStyle();
      }

      // When exiting the context menu, remove any bounds plane
      this.boundsPlane.lock = false;
      this.boundsPlane.setVisible(false);
    };

    this.ui3D = this.options.ui3D && new this.options.ui3D(onHide) || new _UI_ModelSheetGenericUI_js__WEBPACK_IMPORTED_MODULE_5__["default"](this.viewer, onHide);

    this.boundsPlane = new _BoundsPlane_js__WEBPACK_IMPORTED_MODULE_7__["default"](this.viewer, OverlayName);

    // For each 3D model in scene, search for viewports in AEC model data. TODO: Also search in alignment service.
    const models3D = this.viewer.impl.get3DModels();

    models3D.forEach(this.addMarkersForModel);

    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.updateMarkersClientLocation);
    this.viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.updateMarkersClientLocation);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT, this.updateMarkers);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.updateMarkers);

    this.ui3DCreated = true;
  }

  async addMarkersForModel(model) {
    if (!model.is3d() || !model.getDocumentNode()) {
      return;
    }

    const relatedViewports = this.getViewportsForModel(model);

    // If we are during model to sheet transition - there is no need to add 3D markers, since they will soon be gone anyway.
    if (this.duringModelToSheetTransition) {
      return;
    }

    // Make sure the model is still visible.
    if (!this.viewer.impl.findModel(model.id)) {
      return;
    }

    // Remove any markers that don't exist anymore
    const vpKeys = relatedViewports.map((vp) => vp.getGuid());
    const keysToRemove = this.getMarkersKeysForModel(model).filter((key) => !vpKeys.includes(key));

    keysToRemove.forEach((key) => this.removeMarker(key));

    // Add new markers
    relatedViewports.forEach((vp) => {
      const vpGuid = vp.getGuid();

      // Marker already exists for this viewport.
      if (this.markers[vpGuid]) {
        return;
      }

      const marker = new _UI_ModelSheet3DMarker_js__WEBPACK_IMPORTED_MODULE_6__["default"](this, vp, model, this.ui3D, this.areMarkersVisible);
      this.markers[vpGuid] = marker;

      // In case that we just created the marker of the currently selected viewport - make it selected.
      if (this.getSelectedViewportGuid() === vpGuid) {
        marker.setMarkerSelected(true);
      }
    });
  }

  getSelectedViewportGuid() {
    const isGuid = typeof this._selectedViewportOrGuid === 'string';

    return isGuid ? this._selectedViewportOrGuid : this._selectedViewportOrGuid?.getGuid();
  }

  getSelectedViewport() {
    const isGuid = typeof this._selectedViewportOrGuid === 'string';

    if (!isGuid) {
      return this._selectedViewportOrGuid;
    }

    // If it's a guid, need to search the corresponding viewport
    const vp = this.viewportsExtension.findViewportByGuid(this._selectedViewportOrGuid);

    if (vp) {
      // Update so we don't need to search again
      this._selectedViewportOrGuid = vp;

      return vp;
    }

    return null;
  }

  setSelectedViewport(viewportOrGuid) {
    this._selectedViewportOrGuid = viewportOrGuid;
  }

  removeMarkersForModel(model) {
    if (!model.getDocumentNode()) {
      return;
    }

    const keys = this.getMarkersKeysForModel(model);

    keys.forEach((key) => this.removeMarker(key));
  }

  // Returns an array with the keys for this model
  getMarkersKeysForModel(model) {
    if (!model.is3d()) {
      return [];
    }

    return Object.keys(this.markers).filter((key) => {
      const marker = this.markers[key];
      return marker.model3D === model;
    });
  }

  removeMarker(key) {
    this.markers[key].destroy();
    delete this.markers[key];
  }

  async showSheetAndSetTransform(node, viewport, model3D) {
    this.setSelectedViewport(viewport);

    const model = await this.loadModel(node);

    this.cache.transformedModels.set(model, model); // Save the model in cache to restore its state later (showing page, clear transform, etc.)

    const unitScale = model.getUnitScale();
    const viewportBounds = viewport.getViewportBounds(unitScale);
    let matrix = viewport.get2DTo3DMatrix(unitScale);

    if (viewport.isMatrixInLocalCoords()) {
      const model3DMatrix = model3D.getModelToViewerTransform();

      if (model3DMatrix) {
        matrix = new THREE.Matrix4().multiplyMatrices(model3DMatrix, matrix);
      }
    }

    model.setPlacementTransform(matrix);
    model.setViewportBounds(this.viewer.impl.matman(), viewportBounds);

    const clearSelectedFloor = viewport.isTopViewViewport();
    (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__.setCutPlane)(this.viewer, matrix, clearSelectedFloor);

    model.changePaperVisibility(false);
    this.viewer.impl.setDoNotCut(model, true);

    // Show model only when everything is ready
    this.showModel(node);

    this.viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_8__.SHOW_SHEET_EVENT, model: model });

    return model;
  }


  hideSelectedSheet() {
    this.selectedMarker?.hideSheet();
  }

  onMarkerSelected(marker) {
    // Hide previously selected node
    this.hideSelectedSheet();

    this.selectedMarker = marker;
  }

  onMarkerDeselected(marker) {
    // Make sure that another marker hasn't taken the spot first
    if (marker === this.selectedMarker) {
      this.selectedMarker = null;
    }
  }

  setAllMarkersVisible(isVisible) {
    if (this.areMarkersVisible === isVisible) {
      return;
    }

    this.areMarkersVisible = isVisible;

    for (let key in this.markers) {
      this.markers[key].setVisible(isVisible);
    }
  }

  hideSheet(node) {
    this.setSelectedViewport(null);
    const model = this.viewer.impl.findModel(node);

    if (model) {
      (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__.resetModelTransformAndViewport)(this.viewer, model);
    }

    this.hideModel(node);

    this.viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_8__.HIDE_SHEET_EVENT, model: model });
  }

  /**
   * @private
   */
  destroyUIFor3D() {
    if (!this.ui3DCreated) {
      return;
    }

    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.updateMarkersClientLocation);
    this.viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.updateMarkersClientLocation);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT, this.updateMarkers);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.updateMarkers);

    for (let key in this.markers) {
      this.markers[key].destroy();
    }

    this.boundsPlane.destroy();
    this.boundsPlane = null;

    this.markers = {};
    this.selectedMarker = null;
    this.setSelectedViewport(null);

    this.ui3DCreated = false;
  }

  // Update the element's location when the camera moves
  updateMarkersClientLocation() {
    if (!this.markers) {
      return;
    }

    for (let key in this.markers) {
      this.markers[key].updateClientLocation();
    }
  }

  // When the bounds move, the marker's world position needs to be readjusted
  updateMarkers() {
    if (!this.markers) {
      return;
    }

    for (let key in this.markers) {
      this.markers[key].update();
    }
  }

  // If this model was changed due to a transition, reset those changes
  resetModelIfNeeded(model, resetTransformAndViewport = true) {
    if (!this.cache.transformedModels.has(model)) {
      return false;
    }

    if (resetTransformAndViewport) {
      // Set camera to a top view position. The initial value is not important,
      // since fitToBounds will fix that afterwards.
      this.viewer.navigation.setView(this.defaultPosition2D, this.defaultTarget2D);
      this.viewer.navigation.orientCameraUp(true);

      (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__.resetModelTransformAndViewport)(this.viewer, model);
      (0,_ModelSheetCommon_js__WEBPACK_IMPORTED_MODULE_0__.fitToBounds)(this.viewer, model);
    }

    // Make sure home view is synced (since we are changing the transform after the model has been added)
    // Wait for next frame to make sure view is updated
    setTimeout(() => this.viewer.impl.controls.recordHomeView());

    this.cache.transformedModels.delete(model);

    return true;
  }

  async getViewportsForModelAsync(model) {
    let viewports = await this.viewportsExtension.getViewportsAsync(model.getDocumentNode(), { onlyTopViewPlans: false });

    if (this.options.useOnlyAecModelDataViewports) {
      viewports = viewports.filter((viewport) => viewport instanceof Autodesk.AEC.ViewportsExtension.AecModelDataViewport);
    }

    return viewports;
  }

  getViewportsForModel(model) {
    let viewports = this.viewportsExtension.getViewports(model.getDocumentNode(), { onlyTopViewPlans: false });

    if (this.options.useOnlyAecModelDataViewports) {
      viewports = viewports.filter((viewport) => viewport instanceof Autodesk.AEC.ViewportsExtension.AecModelDataViewport);
    }

    return viewports;
  }

  // Given a 2D sheet (and optionally a viewport guid), returns a bubbleNode of the 3D node that it's attached to.
  async getNodeAndViewport(model2D, vpGuid) {
    const viewports = await this.getViewportsForModelAsync(model2D);

    // For now we don't have the option to select a viewport, so always take the latest one
    const viewport = vpGuid ?
    viewports.find((vp) => vp.getGuid() === vpGuid) :
    viewports[viewports.length - 1];

    if (!this.cache.nodesAndViewports.has(viewport)) {
      const nodes = await viewport.get3DNodesForViewport();
      const bubbleNode3D = nodes[0];

      if (!bubbleNode3D) {
        return;
      }

      model2D.regionId = viewport.getGuid(); // Save in model, in case the sheet is realigned (so it won't create a new region)

      this.cache.nodesAndViewports.set(viewport, { viewport, bubbleNode: bubbleNode3D });
    }

    return this.cache.nodesAndViewports.get(viewport);
  }

  // Default displayError function. Can be overriden through options
  _displayError(message) {
    Autodesk.Viewing.Private.AlertBox.displayError(this.viewer.container, message, 'Model Sheet Transition');
  }

  async transitionModelToSheet(model) {
    this.duringModelToSheetTransition = true;
    this.destroyUIFor3D();
    await this.modelToSheet.transition3Dto2D(model);
    this.duringModelToSheetTransition = false;
  }

  onExtensionLoaded({ extensionId }) {
    if (extensionId === LevelsExtensionId) {
      const levelsExtension = this.viewer.getExtension(LevelsExtensionId);

      // Register to SELECTED_FLOOR_CHANGED event only if LevelsExtension is being loaded eventually.
      if (levelsExtension) {
        levelsExtension.floorSelector.addEventListener(Autodesk.AEC.FloorSelector.SELECTED_FLOOR_CHANGED, this.onSelectedFloorChanged);
      }
    }
  }

  onExtensionUnloaded({ extensionId }) {
    if (extensionId === LevelsExtensionId) {

      const levelsExtension = this.viewer.getExtension(LevelsExtensionId);

      if (levelsExtension) {
        levelsExtension.floorSelector?.removeEventListener(Autodesk.AEC.FloorSelector.SELECTED_FLOOR_CHANGED, this.onSelectedFloorChanged);
      }
    }
  }

  onSelectedFloorChanged() {
    // In case that we are currently viewing a top-view viewport (z aligned), and a level was
    // selected by the levels extension, clean the section plane that we applied for the viewport.
    // Otherwise we might get a scenario when the entire model is cut.
    if (!this.getSelectedViewport()?.isTopViewViewport()) {
      return;
    }

    this.viewer.impl.setCutPlaneSet(_ModelSheetConstants_js__WEBPACK_IMPORTED_MODULE_9__.MODEL_SHEET_SECTION_SET, null);
  }
}

namespace.ModelSheetTransitionExtension = ModelSheetTransitionExtension;
namespace.AnalyticsEventName = AnalyticsEventName;

// Register the extension with the extension manager.
Autodesk.Viewing.theExtensionManager.registerExtension(extensionName, ModelSheetTransitionExtension);
})();

Autodesk.Extensions.ModelSheetTransition = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=ModelSheetTransition.js.map