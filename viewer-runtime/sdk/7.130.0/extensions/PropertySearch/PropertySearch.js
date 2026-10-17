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
/*!*****************************************************!*\
  !*** ./extensions/PropertySearch/PropertySearch.js ***!
  \*****************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PropertySearch: () => (/* binding */ PropertySearch)
/* harmony export */ });
/* harmony import */ var _src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../src/application/LoggingUtils.js */ "./src/application/LoggingUtils.js");




var av = Autodesk.Viewing;
var avu = Autodesk.Viewing.UI;

/**
 * PropertySearch extension provides UI for end users to search through a design's Property Database.
 *
 * The extension id is: `Autodesk.PropertySearch`
 *
 * @example
 *    viewer.loadExtension('Autodesk.PropertySearch');
 *
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @constructor
 * @deprecated This extension is deprecated and will be removed in a future release.
 */

function PropertySearch(viewer, options) {
  av.Extension.call(this, viewer, options);
  this.viewer = viewer;
  this.name = "propertysearch";
}

PropertySearch.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
PropertySearch.prototype.constructor = PropertySearch;

/**
 * Loads the extension.
 */
PropertySearch.prototype.load = function () {
  (0,_src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_0__.warnOnce)('[Autodesk.PropertySearch] This extension is deprecated and will be removed in a future release.');
  return true;
};

/**
 * Unloads the extension.
 */
PropertySearch.prototype.unload = function () {
  // Remove the UI
  if (this.propertySearchButton) {
    this.propertySearchButton.removeFromParent();
    this.propertySearchButton = null;
  }
  return true;
};

/**
 * Enables the property search tool.
 */
PropertySearch.prototype.activate = function () {
  if (!this.activeStatus) {
    this.activeStatus = true;
  }
  return true;
};

/**
 * Deactivates the property search tool.
 */
PropertySearch.prototype.deactivate = function () {
  if (this.activeStatus) {
    this.activeStatus = false;
  }
  return true;
};

/**
 * @returns {boolean} true when the tool is active
 */
PropertySearch.prototype.isActive = function () {
  return this.activeStatus;
};

/**
 * Invoked by the viewer when the toolbar UI is available.
 * Adds a button to the toolbar.
 */

PropertySearch.prototype.onToolbarCreated = function (toolbar) {
  this.propertySearchButton = new avu.Button('toolbar-property-search-tool');
  this.propertySearchButton.setToolTip('Property Search');
  this.propertySearchButton.setIcon("propertysearch-icon");
  this.propertySearchButton.onClick = (e) => {

    // Property panel is not available
  };
  var modelTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);
  if (modelTools) {
    modelTools.addControl(this.propertySearchButton, { index: 0 });
  }
};

/**
 * Register the extension with the extension manager.
 */
Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.PropertySearch', PropertySearch);
})();

Autodesk.Extensions.PropertySearch = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=PropertySearch.js.map