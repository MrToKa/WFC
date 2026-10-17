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

/***/ "./extensions/GestureDocumentNavigation/BubbleUtils.js"
/*!*************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/BubbleUtils.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   parseBubble: () => (/* binding */ parseBubble)
/* harmony export */ });
/* harmony import */ var _ModelUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ModelUtils.js */ "./extensions/GestureDocumentNavigation/ModelUtils.js");


const parseBubble = (viewerDoc) => {
  const doc = viewerDoc;
  const viewableItem = doc.getRoot().findAllViewables()[0];
  const fileExtension = _ModelUtils_js__WEBPACK_IMPORTED_MODULE_0__["default"].getModelExtension(viewableItem.name());

  function buildTree(node, role) {
    // Don't save nodes with type other than 'folder' or 'view' or 'geometry'.
    if (!(node.type() === 'folder' || node.type() === 'view' || node.type() === 'geometry')) {
      return null;
    }

    // Don't save a geometry with a different role than the given one (2d or 3d).
    if (node.type() === 'geometry' && node.data.role !== role) {
      return null;
    }

    const outputNode = {
      guid: node.guid(),
      name: node.name(),
      type: node.type()
    };

    if (node.type() === 'geometry') {
      outputNode.order = node.data.order;
      outputNode.status = node.data.status;
      outputNode.role = node.data.role;
      outputNode.hasThumbnail = node.data.hasThumbnail && node.data.hasThumbnail.toLowerCase() === 'true';
    }

    if (node.children) {
      // build the subtree of the node's children.
      const outputChildren = node.children.map((child) => buildTree(child, role)).filter((child) => !!child);

      if (outputChildren.length > 0) {
        outputNode.children = outputChildren;
      }
    }

    // Don't save empty folders
    if (node.type() === 'folder' && !outputNode.children) {
      return null;
    }

    return outputNode;
  }

  const getGeometries = (tree) => {
    if (!tree) {
      return [];
    }
    const wrapper = new Autodesk.Viewing.BubbleNode(tree);
    const geometries = wrapper.search({ type: 'geometry' });
    if (geometries) {
      return geometries.map((geometry) => geometry.data);
    }

    return null;
  };

  const modifyGeometries = (geometries) => {
    geometries.forEach((geometry) => {
      // PDFs can have only one single view - so if there are more, remove them.
      if (fileExtension === 'pdf' && geometry.children && geometry.children.length > 1) {
        geometry.children = [geometry.children[0]];
      }
    });


    // If current document is PDF, then sort geometries by 'order' property.
    // Since pdf extractor will handle pdf by parallel process, the geometries list may out of order.
    if (fileExtension === 'pdf') {
      geometries.sort(function (a, b) {
        return a.order - b.order;
      });
    } else {
      geometries.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
    }

    return geometries;
  };

  const filterGeometries = (geometries) => {
    return geometries.filter((geometry) =>
    // NWD extractor doesn't support 2d files. If they do appear, ignore them.
    !(fileExtension === 'nwd' && geometry.role === '2d')
    );

    // In case you want to add another filter here, just compose like this: a.filter(b => b>2).filter(c => c>3).
  };

  if (fileExtension === 'pdf') {
    const pdfItems = filterGeometries(modifyGeometries(getGeometries(buildTree(viewableItem, '2d'))));

    return [{ type: 'PDF', sheets: pdfItems }];
  } else {
    const geometries3D = filterGeometries(modifyGeometries(getGeometries(buildTree(viewableItem, '3d'))));
    const geometries2D = filterGeometries(modifyGeometries(getGeometries(buildTree(viewableItem, '2d'))));

    return [
    { type: '2D', sheets: geometries2D },
    { type: '3D', sheets: geometries3D }];

  }
};

/***/ },

/***/ "./extensions/GestureDocumentNavigation/CameraUtils.js"
/*!*************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/CameraUtils.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _GeometryUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./GeometryUtils.js */ "./extensions/GestureDocumentNavigation/GeometryUtils.js");


const CameraUtils = {};

// Same as viewer.worldToClient, but with a camera as argument.
CameraUtils.worldToClient = (viewer, point, camera) => {
  var p = new THREE.Vector4(point.x, point.y, point.z, 1);
  p.applyMatrix4(camera.matrixWorldInverse);
  p.applyMatrix4(camera.projectionMatrix);

  // Don't want to mirror values with negative z (behind camera)
  if (p.w > 0) {
    p.x /= p.w;
    p.y /= p.w;
    p.z /= p.w;
  }

  return viewer.impl.viewportToClient(p.x, p.y);
};

CameraUtils.getCameraEyeVector = (camera) => {
  return camera.target.clone().sub(camera.position).normalize();
};

CameraUtils.getCameraRightVector = (camera) => {
  const eye = CameraUtils.getCameraEyeVector(camera);
  return new THREE.Vector3().crossVectors(eye, camera.up).normalize();
};

CameraUtils.getCameraUpVector = (camera) => {
  const right = CameraUtils.getCameraRightVector(camera);
  const eye = CameraUtils.getCameraEyeVector(camera);
  return new THREE.Vector3().crossVectors(right, eye).normalize();
};

CameraUtils.getCameraRotation = (camera) => {
  return _GeometryUtils_js__WEBPACK_IMPORTED_MODULE_0__["default"].getSignedAngle(CameraUtils.getCameraUpVector(camera), new THREE.Vector3(0, 1, 0), CameraUtils.getCameraEyeVector(camera));
};

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (CameraUtils);

/***/ },

/***/ "./extensions/GestureDocumentNavigation/GeometryUtils.js"
/*!***************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/GeometryUtils.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
const GeometryUtils = {};

GeometryUtils.radiansToDegrees = (radians) => {
  return radians * (180 / Math.PI);
};

GeometryUtils.degreesToRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

GeometryUtils.applyRotation = (points, angle, pivot, frontVector) => {
  if (!(points instanceof Array)) {
    points = [points];
  }

  points.forEach((point) => {
    point.sub(pivot);
    point.applyAxisAngle(frontVector, angle);
    point.add(pivot);
  });
};

GeometryUtils.getSignedAngle = (v1, v2, eyeVector) => {
  const angle = v1.angleTo(v2);

  const n = v1.clone().cross(v2).normalize();
  const sign = eyeVector.dot(n) > 0 ? 1 : -1;

  return angle * sign;
};

GeometryUtils.swapBoundingBoxY = (boundingBox) => {
  [boundingBox.max.y, boundingBox.min.y] = [boundingBox.min.y, boundingBox.max.y];

  return boundingBox;
};

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (GeometryUtils);

/***/ },

/***/ "./extensions/GestureDocumentNavigation/GestureDocumentNavigationConstants.js"
/*!************************************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/GestureDocumentNavigationConstants.js ***!
  \************************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NAVIGATION_DISTANCE_2D: () => (/* binding */ NAVIGATION_DISTANCE_2D),
/* harmony export */   NAVIGATION_DISTANCE_3D: () => (/* binding */ NAVIGATION_DISTANCE_3D),
/* harmony export */   NAVIGATION_VELOCITY_2D: () => (/* binding */ NAVIGATION_VELOCITY_2D),
/* harmony export */   NAVIGATION_VELOCITY_3D: () => (/* binding */ NAVIGATION_VELOCITY_3D)
/* harmony export */ });
const NAVIGATION_DISTANCE_2D = 50;
const NAVIGATION_DISTANCE_3D = 350; // In order to prevent unwanted navigation, the minimum navigation distance is pretty high.
const NAVIGATION_VELOCITY_2D = 0.7;
const NAVIGATION_VELOCITY_3D = 1.1;

/***/ },

/***/ "./extensions/GestureDocumentNavigation/GestureDocumentNavigationTool.js"
/*!*******************************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/GestureDocumentNavigationTool.js ***!
  \*******************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ GestureDocumentNavigationTool)
/* harmony export */ });
/* harmony import */ var _GeometryUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./GeometryUtils.js */ "./extensions/GestureDocumentNavigation/GeometryUtils.js");
/* harmony import */ var _GestureDocumentNavigationConstants_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./GestureDocumentNavigationConstants.js */ "./extensions/GestureDocumentNavigation/GestureDocumentNavigationConstants.js");



class GestureDocumentNavigationTool {
  constructor(extension) {
    this.viewer = extension.viewer;
    this.navigationDistance = this.viewer.impl.is2d ? _GestureDocumentNavigationConstants_js__WEBPACK_IMPORTED_MODULE_1__.NAVIGATION_DISTANCE_2D : _GestureDocumentNavigationConstants_js__WEBPACK_IMPORTED_MODULE_1__.NAVIGATION_DISTANCE_3D;
    this.navigationVelocity = this.viewer.impl.is2d ? _GestureDocumentNavigationConstants_js__WEBPACK_IMPORTED_MODULE_1__.NAVIGATION_VELOCITY_2D : _GestureDocumentNavigationConstants_js__WEBPACK_IMPORTED_MODULE_1__.NAVIGATION_VELOCITY_3D;

    this.documents = extension.documents;
    this.sheets = extension.sheets;

    this.extension = extension;

    this.names = ['gesture-document-navigation'];

    this.leftDirection = new THREE.Vector3(1, 0, 0);
    this.rightDirection = new THREE.Vector3(-1, 0, 0);
    this.upDirection = new THREE.Vector3(0, 1, 0);
    this.downDirection = new THREE.Vector3(0, -1, 0);
    this.eyeVector = new THREE.Vector3(0, 0, 1);

    this.currentDirection = null;
  }

  getNames() {
    return this.names;
  }

  getName() {
    return this.names[0];
  }

  activate(name) {
    if (name === this.getName()) {
      this.isActive = true;
    }
  }

  deactivate(name) {
    if (name === this.getName()) {
      this.isActive = false;
    }
  }

  isActive() {
    return this.isActive;
  }

  getPriority() {
    return 100;
  }

  _isCanvasContainsViewport() {
    const bounds = Autodesk.Viewing.ScreenShot.getSceneClientBounds(this.viewer, this.viewer.navigation.getCamera());
    const containerBounds = this.viewer.impl.getCanvasBoundingClientRect();

    return bounds.min.x > containerBounds.left &&
    bounds.max.x < containerBounds.right &&
    bounds.min.y > containerBounds.height - containerBounds.bottom &&
    bounds.max.y < containerBounds.height - containerBounds.top;

  }

  /**
   * On Drag event, gets the the right item to switch to, based on user gesture's direction,
   * @returns {boolean} True if there is an item to move to.
   * @param {boolean} event - Dragmove event.
   * @private
  */
  onDrag(event) {
    const v = new THREE.Vector3(event.canvasX, event.canvasY, 0).sub(this.startPoint);
    const length = v.length();

    let angle = _GeometryUtils_js__WEBPACK_IMPORTED_MODULE_0__["default"].getSignedAngle(v, this.leftDirection, this.eyeVector);

    if (angle < 0) {
      angle += 2 * Math.PI;
    }

    let indexToLoad = null;
    let isSheet;
    let isDocument;

    if (angle > 5 / 4 * Math.PI && angle < 7 / 4 * Math.PI && this.sheets.length > 1) {
      this.currentDirection = this.upDirection;

      if (this.extension.currentSheetIndex === 0) {
        if (this.extension.options.enableCyclicSwipe) {
          indexToLoad = this.sheets.length - 1;
        }
      } else {
        indexToLoad = this.extension.currentSheetIndex - 1;
      }

      isSheet = true;
    } else if (angle > 1 / 4 * Math.PI && angle <= 3 / 4 * Math.PI && this.sheets.length > 1) {
      this.currentDirection = this.downDirection;

      if (this.extension.currentSheetIndex === this.sheets.length - 1) {
        if (this.extension.options.enableCyclicSwipe) {
          indexToLoad = 0;
        }
      } else {
        indexToLoad = this.extension.currentSheetIndex + 1;
      }

      isSheet = true;
    } else if (angle > 3 / 4 * Math.PI && angle <= 5 / 4 * Math.PI && this.documents.length > 1) {
      this.currentDirection = this.leftDirection;

      if (this.extension.currentDocumentIndex === this.documents.length - 1) {
        if (this.extension.options.enableCyclicSwipe) {
          indexToLoad = 0;
        }
      } else {
        indexToLoad = this.extension.currentDocumentIndex + 1;
      }

      isDocument = true;
    } else if ((angle > 7 / 4 * Math.PI || angle <= 1 / 4 * Math.PI) && this.documents.length > 1) {
      this.currentDirection = this.rightDirection;

      if (this.extension.currentDocumentIndex === 0) {
        if (this.extension.options.enableCyclicSwipe) {
          indexToLoad = this.documents.length - 1;
        }
      } else {
        indexToLoad = this.extension.currentDocumentIndex - 1;
      }

      isDocument = true;
    }

    const hasItem = indexToLoad !== null && (isSheet || isDocument);

    if (hasItem && length >= this.navigationDistance) {
      if (isSheet) {
        const { guid } = this.sheets[indexToLoad];
        this.extension.changeSheetRequired(guid);
      } else if (isDocument) {
        const { urn, guid } = this.documents[indexToLoad];
        this.extension.changeDocumentRequired(urn, guid);
      }

      this.changing = true;
    }

    return hasItem;
  }

  _isSwipeEnabled() {
    return this.viewer.model.is3d() || this._isCanvasContainsViewport();
  }

  handleGesture(event) {
    switch (event.type) {
      case 'dragstart':
        this.isSwipeEnabled = this._isSwipeEnabled();
        if (this.isSwipeEnabled) {
          this.startPoint = new THREE.Vector3(event.canvasX, event.canvasY, 0);
        }

        this.swiping = false;
        this.changing = false;

        return false;
      case 'dragmove':
        if (this.changing) {
          return true;
        } else if (this.swiping || this.isSwipeEnabled && Math.abs(event.overallVelocity) > this.navigationVelocity) {
          this.swiping = true;
          return this.onDrag(event);
        }

        return false;
      case 'dragend':
        // When finish swiping, prevent the camera from orbiting. Relevant for 3D only - there is no camera orbit for 2D.
        // I limited this to 3D only, because of a bug I found when returning true when swiping from a 2D document to 3D document - It was blocking orbit.
        return this.changing && this.viewer.model.is3d();

      default:
        break;
    }

    return false;
  }
}

/***/ },

/***/ "./extensions/GestureDocumentNavigation/ModelUtils.js"
/*!************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/ModelUtils.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
const ModelUtils = {};

ModelUtils.getModelExtension = (url) => {
  const match = url && url.toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
  const fileExtension = match ? match[1] : null;
  return fileExtension;
};

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ModelUtils);

/***/ },

/***/ "./src/application/LoggingUtils.js"
/*!*****************************************!*\
  !*** ./src/application/LoggingUtils.js ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   warnOnce: () => (/* binding */ warnOnce)
/* harmony export */ });
// Simple helper to avoid pointless warning repetition
const _alreadyWarned = new Set();
function warnOnce(txt) {
  if (!_alreadyWarned.has(txt)) {
    console.warn(txt);
    _alreadyWarned.add(txt);
  }
}

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
/******/ 			// no module.id needed
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
/************************************************************************/
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
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";
/*!***************************************************************************!*\
  !*** ./extensions/GestureDocumentNavigation/GestureDocumentNavigation.js ***!
  \***************************************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ GestureDocumentNavigationExtension)
/* harmony export */ });
/* harmony import */ var _CameraUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./CameraUtils.js */ "./extensions/GestureDocumentNavigation/CameraUtils.js");
/* harmony import */ var _GeometryUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./GeometryUtils.js */ "./extensions/GestureDocumentNavigation/GeometryUtils.js");
/* harmony import */ var _BubbleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./BubbleUtils.js */ "./extensions/GestureDocumentNavigation/BubbleUtils.js");
/* harmony import */ var _GestureDocumentNavigationTool_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./GestureDocumentNavigationTool.js */ "./extensions/GestureDocumentNavigation/GestureDocumentNavigationTool.js");
/* harmony import */ var _src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../../src/application/LoggingUtils.js */ "./src/application/LoggingUtils.js");






/**
 * Provide an option to switch sheets and documents, using gestures.
 *
 * The extension id is: `Autodesk.BIM360.GestureDocumentNavigation`
 *
 * @example
 *   viewer.loadExtension('Autodesk.BIM360.GestureDocumentNavigation')
 *
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.GestureDocumentNavigationExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @deprecated This extension is deprecated and will be removed in a future release.
 * @public
 */
class GestureDocumentNavigationExtension extends Autodesk.Viewing.Extension {
  /**
   * Load the GestureDocumentNavigation extension.
   *
   * @returns {boolean} True if measure extension is loaded successfully.
   *
   * @alias Autodesk.Viewing.Extensions.GestureDocumentNavigationExtension#load
   * @public
   */
  async load() {
    (0,_src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_4__.warnOnce)('[Autodesk.BIM360.GestureDocumentNavigation] This extension is deprecated and will be removed in a future release.');
    const documentNode = this.viewer.impl.model.getDocumentNode();
    const viewerDoc = documentNode.getRootNode().lmvDocument;

    this.currentGuid = documentNode.guid();
    this.currentUrn = viewerDoc.myData.urn;

    this.documents = [{ urn: this.currentUrn, guid: this.currentGuid }];

    const items = (0,_BubbleUtils_js__WEBPACK_IMPORTED_MODULE_2__.parseBubble)(viewerDoc);
    const items2D = items[0] && items[0].sheets || [];
    const items3D = items[1] && items[1].sheets || [];
    this.sheets = [...items2D, ...items3D];

    this.pivot = new THREE.Vector3();

    this.currentSheetIndex = this.sheets.findIndex((sheet) => sheet.guid === this.currentGuid);
    this.updateCurrentDocumentIndex();

    this.tool = new _GestureDocumentNavigationTool_js__WEBPACK_IMPORTED_MODULE_3__["default"](this);

    this.viewer.toolController.registerTool(this.tool);

    const prevLock = this.viewer.toolController.setIsLocked(false);
    this.viewer.toolController.activateTool(this.tool.getName());
    this.viewer.toolController.setIsLocked(prevLock);

    const cache = this.getCache();

    if (this.viewer.impl.is2d) {
      this.viewer.fitToView(undefined, undefined, true);

      if (cache.direction) {
        const translation = this.getTranslation(cache.direction);
        const negativeTranslation = translation.clone().negate();
        await this.translateCamera(negativeTranslation, true);
        this.viewer.addEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, async () => {
          await this.translateCamera(translation, false);
          cache.direction = undefined;
        }, { once: true });
      }
    } else {
      cache.direction = undefined;
    }

    return true;
  }

  /**
   * Unload the measure extension.
   *
   * @returns {boolean} True if measure extension is unloaded successfully.
   *
   * @alias Autodesk.Viewing.Extensions.GestureDocumentNavigationExtension#unload
   * @public
   */
  unload() {
    if (this.tool) {
      this.viewer.toolController.deregisterTool(this.tool);
      this.tool = null;
    }

    this.viewer = null;
    this.options = null;

    return true;
  }

  updateNextDocument(urn, guid) {
    this.documents.push({ urn, guid });
    this.updateCurrentDocumentIndex();
  }

  updatePrevDocument(urn, guid) {
    this.documents.unshift({ urn, guid });
    this.updateCurrentDocumentIndex();
  }

  updateCurrentDocumentIndex() {
    this.currentDocumentIndex = this.documents.findIndex(
      (doc) => doc.urn === this.currentUrn && doc.guid === this.currentGuid
    );
  }

  /**
   * Prepare current document before switching sheet / document.
   *
   * @param {Function} cb - This callback is called after current document is ready to switch.
   * @alias Autodesk.Viewing.Extensions.GestureDocumentNavigationExtension#prepareChange
   * @public
   */
  async prepareChange(cb) {
    const onDone = () => {
      const cache = this.getCache();
      cache.direction = this.tool.currentDirection;
      cb();
    };

    if (this.viewer.model.is3d()) {
      onDone();
    } else {
      const translation = this.getTranslation(this.tool.currentDirection);
      await this.translateCamera(translation, false);
      onDone();
    }
  }

  /**
   * Change a sheet.
   *
   * @param {number} guid - The guid of the desired sheet.
   * @alias Autodesk.Viewing.Extensions.GestureDocumentNavigationExtension#changeSheetRequired
   * @public
   */
  changeSheetRequired(guid) {
    if (!this.options.enableSheetSwipe || !guid) {
      return;
    }

    this.prepareChange(() => {
      this.viewer.dispatchEvent({ type: Autodesk.Viewing.GestureDocumentNavigationEvents.CHANGE_SHEET_REQUIRED, guid });
    });
  }

  /**
   * Change a document.
   *
   * @param {number} urn - The urn of the desired document.
   * @param {number} guid - The guid of the desired sheet.
   * @alias Autodesk.Viewing.Extensions.GestureDocumentNavigationExtension#changeSheetRequired
   * @public
   */
  changeDocumentRequired(urn, guid) {
    if (!urn) {
      return;
    }

    this.prepareChange(() => {
      this.viewer.dispatchEvent({ type: Autodesk.Viewing.GestureDocumentNavigationEvents.CHANGE_DOCUMENT_REQUIRED, urn, guid });
    });
  }

  getTranslation(direction) {
    const camera = this.viewer.getCamera();
    const size = Math.max(camera.top - camera.bottom, camera.right - camera.left);
    const translation = direction.clone().multiplyScalar(size);

    const cameraRotation = _CameraUtils_js__WEBPACK_IMPORTED_MODULE_0__["default"].getCameraRotation(camera);
    const eyeVec = _CameraUtils_js__WEBPACK_IMPORTED_MODULE_0__["default"].getCameraEyeVector(camera);
    _GeometryUtils_js__WEBPACK_IMPORTED_MODULE_1__["default"].applyRotation(translation, -cameraRotation, this.pivot, eyeVec);

    return translation;
  }

  async translateCamera(translation, immediate) {
    this.viewer.utilities.autocam.endInteraction();

    const camera = this.viewer.getCamera();

    const position = camera.position.clone().add(translation);
    const target = camera.target.clone().add(translation);

    if (immediate) {
      this.viewer.navigation.setView(position, target);
    } else {
      this.viewer.navigation.setRequestTransitionWithUp(true, position, target, camera.fov, camera.up);
      await Autodesk.Viewing.EventUtils.waitUntilTransitionEnded(this.viewer);
    }
  }
}

Autodesk.Viewing.GestureDocumentNavigationEvents = {};
Autodesk.Viewing.GestureDocumentNavigationEvents.CHANGE_DOCUMENT_REQUIRED = 'change.document.required';
Autodesk.Viewing.GestureDocumentNavigationEvents.CHANGE_SHEET_REQUIRED = 'change.sheet.required';

GestureDocumentNavigationExtension.extensionName = 'Autodesk.BIM360.GestureDocumentNavigation';

Autodesk.Viewing.theExtensionManager.registerExtension(GestureDocumentNavigationExtension.extensionName, GestureDocumentNavigationExtension);
})();

Autodesk.Extensions.GestureDocumentNavigation = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=GestureDocumentNavigation.js.map