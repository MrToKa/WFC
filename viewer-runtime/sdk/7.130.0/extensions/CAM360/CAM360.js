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

/***/ "./extensions/CAM360/CAMModelStructurePanel.js"
/*!*****************************************************!*\
  !*** ./extensions/CAM360/CAMModelStructurePanel.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CAMModelStructurePanel: () => (/* binding */ CAMModelStructurePanel)
/* harmony export */ });



var ave = Autodesk.Viewing.Extensions;

/**
 * This extension supports only 1 model.
 *
 * @param {*} viewer
 * @param {*} title
 * @param {*} options
 */
class CAMModelStructurePanel extends ave.ViewerModelStructurePanel {
  constructor(viewer, title, options) {
    super(viewer, title, options);
    this.viewer = viewer;
    this._addViewerListeners();

    this.delegate = null;
    this.instanceTree = null;
    this.model = null;

    this.camNodes = [];
    this.camModelNodes = [];
    this.camSetupNodes = [];
    this.camStockNodes = [];
    this.camOperationNodes = [];
    this.camToolNodes = [];
    this.camFolderNodes = [];
  }

  sortCamNodes(instanceTree, onCamNodesSorted) {
    var that = this;

    // Find all of the nodes to process.
    //
    var nodeIdsToProcess = [];

    instanceTree.enumNodeChildren(instanceTree.getRootId(), function (dbId) {
      nodeIdsToProcess.push(dbId);
    }, true);

    nodeIdsToProcess.shift(); //take out the root

    function processNodeId(node, onNodeProcessed)
    {

      // Gets the p
      function getPropertyValue(properties, propertyName) {
        for (var i = 0; i < properties.length; ++i) {
          var property = properties[i];
          if (property.displayName === propertyName) {
            return property.displayValue;
          }
        }
        return null;
      }

      function onPropertiesRetrieved(result) {
        // Sort the nodes into the proper containers here.
        //
        var name = getPropertyValue(result.properties, '9429B915-D020-4CEB-971B-6ADD0A5D4BFA');

        if (name) {
          if (name == 'CAM_Setup') {
            that.camSetupNodes.push(node);
          } else
          if (name == 'CAM_Operation') {
            that.camOperationNodes.push(node);
          } else
          if (name === 'CAM_Tool') {// Check this.
            that.camToolNodes.push(node);
          } else if (name === 'CAM_Stock') {// Check this.
            that.camStockNodes.push(node);
          } else if (name == 'CAM_Folder') {
            that.camFolderNodes.push(node);
          }

          that.camNodes.push(node);

        } else {
          that.camModelNodes.push(node);
        }

        onNodeProcessed();
      }

      function onError(status, message, data) {
        onNodeProcessed();
      }

      that.viewer.getProperties(node, onPropertiesRetrieved, onError);

    }

    // Process the nodes one by one.
    //
    function processNext() {
      if (nodeIdsToProcess.length > 0) {
        processNodeId(nodeIdsToProcess.shift(), processNext);
      } else {
        // No more nodes to process - call the provided callback.
        //
        onCamNodesSorted();
      }
    }
    processNext();
  }

  addModel(model) {
    this.model = model;
    this.setVisible(true);
    super.addModel(model);
  }

  setInstanceTree(delegate, instanceTree) {
    super.setInstanceTree(delegate, instanceTree);

    if (!instanceTree)
    return;

    // Keep a reference to a delegate because we only support single model.
    this.delegate = delegate;
    this.instanceTree = instanceTree;

    // Sort all of the cam nodes.  Once done, call setModel on the base class to build the UI, and
    // set the visibilities properly.
    var that = this;
    that.sortCamNodes(instanceTree, function () {
      that.SetCAMNodeVisible(false);
      that.setVisible(true);

      // expand the setup node, and resize to fit.
      that.ExpandSetupNodes();
      that.resizeToContent();
    });
  }

  /** @private */
  _addViewerListeners() {
    var that = this;

    function onGeometryLoaded(e) {
      that.SetCAMNodeVisible(false);
      that.removeEventListener(that.viewer, Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
    }

    if (!this.viewer.model || !this.viewer.model.isLoadDone()) {
      that.addEventListener(that.viewer, Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
    }

    that.addEventListener(that.viewer, Autodesk.Viewing.SHOW_EVENT,
    function (e) {
      var nodes = e.nodeIdArray;
      if (nodes) {
        for (var k = 0; k < nodes.length; k++)
        that.setCamNodeVisibility(nodes[k]);
      }
    });

    that.addEventListener(that.viewer, Autodesk.Viewing.SELECTION_CHANGED_EVENT,
    function (e) {
      var nodes = e.nodeArray;
      if (nodes) {
        for (var k = 0; k < nodes.length; k++)
        that.HideHightlightCAMNode(nodes[k]);
      }
    });

    that.addEventListener(that.viewer, Autodesk.Viewing.ISOLATE_EVENT,
    function (e) {
      var nodes = e.nodeIdArray;
      if (nodes) {
        // show all
        if (nodes.length == 0) {
          that.SetModelVisible();
          that.SetCAMNodeVisible(true);
        } else
        {
          for (var k = 0; k < nodes.length; k++)
          that.setCamNodeVisibility(nodes[k]);
        }
      }
    });
  }

  IsCAMNode(node) {
    return this.camNodes.indexOf(node) !== -1;
  }

  IsCAMSetupNode(node) {
    return this.camSetupNodes.indexOf(node) !== -1;
  }

  IsCAMStockNode(node) {
    return this.camStockNodes.indexOf(node) !== -1;
  }

  IsCAMToolNode(node) {
    return this.camToolNodes.indexOf(node) !== -1;
  }

  IsCAMOperationNode(node) {
    return this.camOperationNodes.indexOf(node) !== -1;
  }

  IsCAMFolderNode(node) {
    return this.camFolderNodes.indexOf(node) !== -1;
  }

  shouldInclude(node) {
    // Exclude all stock nodes.
    //
    return !this.IsCAMStockNode(node);
  }

  isGroupNode(node) {
    // We consider cam operation nodes leaf nodes.
    //
    return this.IsCAMOperationNode(node) ? false : super.isGroupNode(node);
  }

  setNodeVisibility(node, visible) {
    if (visible) {
      this.viewer.show(node);
    } else {
      this.viewer.hide(node);
    }
  }

  SetModelVisible() {
    if (!this.camModelNodes) return;

    for (var k = 0; k < this.camModelNodes.length; k++)
    this.setNodeVisibility(this.camModelNodes[k], true);
  }

  SetCAMNodeVisible(visible) {
    if (!this.camNodes) return;

    for (var k = 0; k < this.camNodes.length; k++) {
      this.setNodeVisibility(this.camNodes[k], visible);
    }
    this.SetToolNodeVisible(false);
  }

  SetToolNodeVisible(visible) {
    if (!this.camToolNodes) return;

    for (var k = 0; k < this.camToolNodes.length; k++)
    this.setNodeVisibility(this.camToolNodes[k], visible);
  }

  HideHightlightNode(node) {

    var viewer = this.viewer.impl;
    var that = this;

    that.instanceTree.enumNodeFragments(node, function (fragId) {
      viewer.highlightFragment(that.model, fragId, false, true);
    }, true);
  }

  // this is to hide the specific child node
  HideHightlightCAMNode(node) {

    var isCamSetupNode = this.IsCAMSetupNode(node);
    var isCamOperaNode = this.IsCAMOperationNode(node);
    var isCamFolderNode = this.IsCAMFolderNode(node);

    var that = this;

    that.instanceTree.enumNodeChildren(node, function (dbId) {
      if (isCamSetupNode) {
        if (!that.IsCAMStockNode(dbId))
        that.HideHightlightNode(dbId);
      } else
      if (isCamOperaNode) {
        if (that.IsCAMToolNode(dbId))
        that.HideHightlightNode(dbId);
      } else
      if (isCamFolderNode) {
        that.HideHightlightNode(dbId);
      }
    }, false);

  }

  setCamNodeVisibility(nodeId) {
    var isCamSetupNode = this.IsCAMSetupNode(nodeId);
    var isCamOperaNode = this.IsCAMOperationNode(nodeId);
    var isCamFolderNode = this.IsCAMFolderNode(nodeId);
    var that = this;

    if (isCamSetupNode) {
      this.instanceTree.enumNodeChildren(nodeId, function (childNodeId) {
        var bStock = that.IsCAMStockNode(childNodeId);
        that.setNodeVisibility(childNodeId, bStock);
      });
    } else
    if (isCamOperaNode) {
      // hide the tool node
      this.instanceTree.enumNodeChildren(nodeId, function (childNodeId) {
        if (that.IsCAMToolNode(childNodeId)) {
          that.setNodeVisibility(childNodeId, false);
        }
      });
    } else
    if (isCamFolderNode) {
      this.instanceTree.enumNodeChildren(nodeId, function (childNodeId) {
        that.setNodeVisibility(childNodeId, false);
      });
    }

  }

  onClick(node, event) {
    super.onClick(node, event);

    this.SetModelVisible();

    this.setCamNodeVisibility(node);

    this.viewer.fitToView();
  }

  ExpandSetupNodes() {

    if (!this.camSetupNodes) return;

    for (var k = 0; k < this.camSetupNodes.length; k++)
    this.tree.setCollapsed(this.delegate, this.camSetupNodes[k], false);
  }
}

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
/*!*************************************!*\
  !*** ./extensions/CAM360/CAM360.js ***!
  \*************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CAM360Extension: () => (/* binding */ CAM360Extension)
/* harmony export */ });
/* harmony import */ var _CAMModelStructurePanel_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./CAMModelStructurePanel.js */ "./extensions/CAM360/CAMModelStructurePanel.js");
/* harmony import */ var _src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../src/application/LoggingUtils.js */ "./src/application/LoggingUtils.js");



'use strict';

/**
 * @deprecated This extension is deprecated and will be removed in a future release.
 */
function CAM360Extension(viewer, options) {
  Autodesk.Viewing.Extension.call(this, viewer, options);
  this.name = 'cam360';
}

CAM360Extension.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
CAM360Extension.prototype.constructor = CAM360Extension;

CAM360Extension.prototype.load = function () {
  (0,_src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_1__.warnOnce)('[Autodesk.CAM360] This extension is deprecated and will be removed in a future release.');
  var viewer = this.viewer;

  var modelStructurePanel = new _CAMModelStructurePanel_js__WEBPACK_IMPORTED_MODULE_0__.CAMModelStructurePanel(this.viewer, 'CAM Model Structure Loading', {});
  this.viewer.getExtension('Autodesk.ModelStructure').setModelStructurePanel(modelStructurePanel);

  // Change these viewer settings for CAM files.
  //
  viewer.hideLines(false);
  viewer.setGhosting(false);
  viewer.setQualityLevel(false, true);

  // Wait till the geometry has loaded before changing the light preset, to ensure that
  // our light preset is the last applied.
  //
  function setLightPresetToSimpleGrey() {
    viewer.impl.setLightPreset(0, true);
    viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, setLightPresetToSimpleGrey);
  }
  viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, setLightPresetToSimpleGrey);

  return true;
};

CAM360Extension.prototype.unload = function () {
  // Remove the panel from the viewer.
  //
  var ext = this.viewer.getExtension('Autodesk.ModelStructure');
  ext.restoreDefaultPanel();
};

CAM360Extension.prototype.activate = function () {
  return this.viewer.activateExtension('Autodesk.ModelStructure');
};

CAM360Extension.prototype.deactivate = function () {
  return this.viewer.deactivateExtension('Autodesk.ModelStructure');
};

CAM360Extension.prototype.isActive = function () {
  return this.viewer.isExtensionActive('Autodesk.ModelStructure');
};

Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.CAM360', CAM360Extension);
})();

Autodesk.Extensions.CAM360 = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=CAM360.js.map