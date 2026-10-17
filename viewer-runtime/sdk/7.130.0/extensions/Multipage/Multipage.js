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

/***/ "./extensions/Multipage/MultipageTool.js"
/*!***********************************************!*\
  !*** ./extensions/Multipage/MultipageTool.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ MultipageTool)
/* harmony export */ });
const av = Autodesk.Viewing;
const GlobalManagerMixin = av.GlobalManagerMixin;

const ScrollSpeed = 15;
const ScrollbarRevealArea = 0.75;

class MultipageTool {
  constructor(extension) {

    this.names = ['multipage'];
    this.isActive = false;

    this.extension = extension;
    this.viewer = this.extension.viewer;

    this.setGlobalManager(this.viewer.globalManager);

    this.viewer.toolController.registerTool(this);

    this.ctrlDown = false;
  }

  getPriority() {
    return 10000;
  }

  getNames() {
    return this.names;
  }

  getName() {
    return this.names[0];
  }

  register() {}

  deregister() {}

  activate(name) {
    this.isActive = true;
  }

  deactivate(name) {
    this.isActive = false;
  }

  // Needed since viewer.clientToWorld depends on viewer.model and when using rasterUnderlay, it's not initially available.
  clientToWorld(point) {
    const camera = this.viewer.getCamera();

    const containerBounds = this.viewer.navigation.getScreenViewport();
    const p = new THREE.Vector3();

    p.x = point.x / containerBounds.width * 2 - 1;
    p.y = -(point.y / containerBounds.height * 2 - 1);

    const result = p.unproject(camera);
    result.z = 0;

    return result;
  }

  handleWheelInput(wheelDelta) {
    if (this.ctrlDown) {
      return false;
    }

    const navTool = this.viewer.toolController.getTool('pan');
    const isPanning = navTool.isInteractionActive();

    if (isPanning) {
      return false;
    }

    this.viewer.utilities.autocam.endInteraction();

    const camera = this.viewer.getCamera();

    const p1 = this.clientToWorld(new THREE.Vector3(0, wheelDelta, 0));
    const p2 = this.clientToWorld(new THREE.Vector3());

    const offset = (p2.y - p1.y) * ScrollSpeed;

    const delta = this.getPanningConstraint2D(offset);

    const translation = new THREE.Vector3(0, delta, 0);

    const position = camera.position.clone().add(translation);
    const target = camera.target.clone().add(translation);

    this.viewer.navigation.setView(position, target);

    this.extension.scrollbar.show();

    return true;
  }

  handleDoubleClick() {
    const pageToFocus = this.extension.getFocusedPage();

    if (!pageToFocus) {
      return false;
    }

    this.extension.focusOnPage(pageToFocus);

    return true;
  }

  getPanningConstraint2D(deltaY) {

    const camera = this.viewer.getCamera();
    const maxViewRegion = this.viewer.navigation.getConstrains2D().maxViewRegion;

    // compute new camera pos after offset + constraint
    var newPosY = camera.position.y + deltaY;
    newPosY = THREE.Math.clamp(newPosY, maxViewRegion.min.y, maxViewRegion.max.y);

    // compute resulting adjusted offset
    var offsetY = newPosY - camera.position.y;

    // We only want to restrict the panning movement, but don't jump suddenly
    // back if the camera is already outside. Therefore, we restrict
    // the adjusted offset to be within 0.0 (= no change) and the initial one.
    var offsetYMin = Math.min(deltaY, 0.0);
    var offsetYMax = Math.max(deltaY, 0.0);
    offsetY = THREE.Math.clamp(offsetY, offsetYMin, offsetYMax);

    return offsetY;
  }

  handleKeyDown(event, keyCode) {
    switch (keyCode) {
      case Autodesk.Viewing.KeyCode.CONTROL:this.ctrlDown = true;return true;
      case Autodesk.Viewing.KeyCode.DOWN:this.extension.focusNextPage();return true;
      case Autodesk.Viewing.KeyCode.UP:this.extension.focusPrevPage();return true;
      case Autodesk.Viewing.KeyCode.END:this.extension.focusLastPage();return true;
      case Autodesk.Viewing.KeyCode.HOME:this.extension.focusFirstPage();return true;
      default:break;
    }

    return false;
  }

  handleKeyUp(event, keyCode) {
    switch (keyCode) {
      case Autodesk.Viewing.KeyCode.CONTROL:this.ctrlDown = false;return true;
      default:break;
    }

    return false;
  }

  handleMouseMove(event) {
    if (event.canvasX > this.viewer.impl.getCanvasBoundingClientRect().width * ScrollbarRevealArea) {
      this.extension.scrollbar.show();
    } else {
      this.extension.scrollbar.hide();
    }
  }
}

GlobalManagerMixin.call(MultipageTool.prototype);

/***/ },

/***/ "./extensions/Multipage/Scrollbar.js"
/*!*******************************************!*\
  !*** ./extensions/Multipage/Scrollbar.js ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ Scrollbar)
/* harmony export */ });
/* harmony import */ var _Scrollbar_scss__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Scrollbar.scss */ "./extensions/Multipage/Scrollbar.scss");
 // IMPORTANT!!
const av = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;
const WidgetWidth = 10;
const WidgetHeight = 86;
const GlobalManagerMixin = Autodesk.Viewing.GlobalManagerMixin;

class Scrollbar {
  constructor(extension) {
    this.extension = extension;
    this.viewer = this.extension.viewer;

    this.setGlobalManager(this.viewer.globalManager);

    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onResize = this.onResize.bind(this);

    this.onDragStart = this.onDragStart.bind(this);
    this.onDragMove = this.onDragMove.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  show() {
    if (this.visible) {
      return;
    }

    if (!this.scrollbarContainer) {
      this.initUI();
    }

    this.onResize();
    this.scrollbarContainer.classList.add('visible');

    this.visible = true;
  }

  hide() {
    if (!this.visible) {
      return;
    }

    if (!this.scrollbarContainer) {
      return;
    }

    this.scrollbarContainer.classList.remove('visible');

    this.visible = false;
  }

  initUI() {
    this.scrollbarContainer = document.createElement('div');
    this.scrollbarContainer.className = 'scrollbar-container';
    this.scrollbarContainer.style.width = `${WidgetWidth}px`;
    this.viewer.container.appendChild(this.scrollbarContainer);

    this.widget = document.createElement('div');
    this.widget.className = 'scrollbar-widget';

    this.widget.style.width = `${WidgetWidth}px`;
    this.widget.style.height = `${WidgetHeight}px`;
    this.scrollbarContainer.appendChild(this.widget);

    this.widget.addEventListener('mousewheel', this.onMouseWheel);
    this.widget.addEventListener('DOMMouseScroll', this.onMouseWheel); // Firefox

    this.widget.addEventListener('mousedown', this.onDragStart);

    this.scrollbarHeight = this.scrollbarContainer.getBoundingClientRect().height;

    this.viewer.addEventListener(av.VIEWER_RESIZE_EVENT, this.onResize);
  }

  destroy() {
    if (!this.scrollbarContainer) {
      return;
    }

    this.viewer.removeEventListener(av.VIEWER_RESIZE_EVENT, this.onResize);
    this.viewer.container.removeChild(this.scrollbarContainer);
    this.scrollbarContainer = null;
    this.widget = null;
  }

  // Propagate mouse wheel event to canvas.
  onMouseWheel(e) {
    const newEvent = new MouseEvent(e.type, e);

    newEvent.wheelDelta = e.wheelDelta;
    newEvent.deltaY = e.deltaY;

    this.viewer.canvasWrap.dispatchEvent(newEvent);

    if (newEvent.defaultPrevented) {
      e.preventDefault();
    }
  }

  screenToWidget(e) {
    if (e.type.indexOf('touch') >= 0) {
      e.clientX = e.touches[0].pageX;
      e.clientY = e.touches[0].pageY;
    }

    return e.clientY - this.scrollbarTop;
  }

  onDragStart(e) {
    this.addWindowEventListener('mousemove', this.onDragMove);
    this.addWindowEventListener('mouseup', this.onDragEnd);

    this.widget.classList.add('dragging');

    e.stopPropagation();
    e.preventDefault();

    // This is needed for touch
    this.screenToWidget(e);

    this.offsetY = e.clientY - this.widget.getBoundingClientRect().top;

    this.isDragging = true;
  }

  onDragMove(e) {
    const y = (this.screenToWidget(e) - this.offsetY) / this.scrollbarHeight;
    this.extension.setRelativeCameraPosition(y);
  }

  onDragEnd(e) {
    this.removeWindowEventListener('mousemove', this.onDragMove);
    this.removeWindowEventListener('mouseup', this.onDragEnd);

    this.widget.classList.remove('dragging');

    this.isDragging = false;
  }

  onResize() {
    const bounds = this.scrollbarContainer.getBoundingClientRect();
    this.scrollbarHeight = bounds.height;
    this.scrollbarTop = bounds.top;
    this.update();
  }

  update() {
    if (!this.scrollbarContainer) {
      return;
    }

    const relativePosition = this.extension.getRelativeCameraPosition();

    this.widget.style.transform = `translate(0, ${relativePosition * (this.scrollbarHeight - WidgetHeight)}px)`;
  }
}

GlobalManagerMixin.call(Scrollbar.prototype);

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Multipage/Scrollbar.scss"
/*!*********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Multipage/Scrollbar.scss ***!
  \*********************************************************************************************************************************************************************************************************************************************************/
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
___CSS_LOADER_EXPORT___.push([module.id, `.scrollbar-container {
  height: 90%;
  top: 50%;
  right: 50px;
  transform: translate(0, -50%);
  position: absolute;
  z-index: 100;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 100px;
  pointer-events: none;
  transition: opacity 0.3s;
  opacity: 0;
}
.scrollbar-container.visible {
  opacity: 1;
}

.scrollbar-widget {
  background-color: rgba(255, 255, 255, 0.8);
  border-radius: 100px;
  will-change: transform;
  pointer-events: all;
}
.scrollbar-widget:hover, .scrollbar-widget.dragging {
  box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.3);
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

/***/ "./extensions/Multipage/Scrollbar.scss"
/*!*********************************************!*\
  !*** ./extensions/Multipage/Scrollbar.scss ***!
  \*********************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Scrollbar_scss__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./Scrollbar.scss */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Multipage/Scrollbar.scss");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Scrollbar_scss__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Scrollbar_scss__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Scrollbar_scss__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Scrollbar_scss__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "./node_modules/lodash-es/_Symbol.js"
/*!*******************************************!*\
  !*** ./node_modules/lodash-es/_Symbol.js ***!
  \*******************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _root_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_root.js */ "./node_modules/lodash-es/_root.js");


/** Built-in value references. */
var Symbol = _root_js__WEBPACK_IMPORTED_MODULE_0__["default"].Symbol;

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Symbol);


/***/ },

/***/ "./node_modules/lodash-es/_baseGetTag.js"
/*!***********************************************!*\
  !*** ./node_modules/lodash-es/_baseGetTag.js ***!
  \***********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _Symbol_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_Symbol.js */ "./node_modules/lodash-es/_Symbol.js");
/* harmony import */ var _getRawTag_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./_getRawTag.js */ "./node_modules/lodash-es/_getRawTag.js");
/* harmony import */ var _objectToString_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./_objectToString.js */ "./node_modules/lodash-es/_objectToString.js");




/** `Object#toString` result references. */
var nullTag = '[object Null]',
    undefinedTag = '[object Undefined]';

/** Built-in value references. */
var symToStringTag = _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"] ? _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"].toStringTag : undefined;

/**
 * The base implementation of `getTag` without fallbacks for buggy environments.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
function baseGetTag(value) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return (symToStringTag && symToStringTag in Object(value))
    ? (0,_getRawTag_js__WEBPACK_IMPORTED_MODULE_1__["default"])(value)
    : (0,_objectToString_js__WEBPACK_IMPORTED_MODULE_2__["default"])(value);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (baseGetTag);


/***/ },

/***/ "./node_modules/lodash-es/_baseTrim.js"
/*!*********************************************!*\
  !*** ./node_modules/lodash-es/_baseTrim.js ***!
  \*********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _trimmedEndIndex_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_trimmedEndIndex.js */ "./node_modules/lodash-es/_trimmedEndIndex.js");


/** Used to match leading whitespace. */
var reTrimStart = /^\s+/;

/**
 * The base implementation of `_.trim`.
 *
 * @private
 * @param {string} string The string to trim.
 * @returns {string} Returns the trimmed string.
 */
function baseTrim(string) {
  return string
    ? string.slice(0, (0,_trimmedEndIndex_js__WEBPACK_IMPORTED_MODULE_0__["default"])(string) + 1).replace(reTrimStart, '')
    : string;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (baseTrim);


/***/ },

/***/ "./node_modules/lodash-es/_freeGlobal.js"
/*!***********************************************!*\
  !*** ./node_modules/lodash-es/_freeGlobal.js ***!
  \***********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof __webpack_require__.g == 'object' && __webpack_require__.g && __webpack_require__.g.Object === Object && __webpack_require__.g;

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (freeGlobal);


/***/ },

/***/ "./node_modules/lodash-es/_getRawTag.js"
/*!**********************************************!*\
  !*** ./node_modules/lodash-es/_getRawTag.js ***!
  \**********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _Symbol_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_Symbol.js */ "./node_modules/lodash-es/_Symbol.js");


/** Used for built-in method references. */
var objectProto = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/** Built-in value references. */
var symToStringTag = _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"] ? _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"].toStringTag : undefined;

/**
 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the raw `toStringTag`.
 */
function getRawTag(value) {
  var isOwn = hasOwnProperty.call(value, symToStringTag),
      tag = value[symToStringTag];

  try {
    value[symToStringTag] = undefined;
    var unmasked = true;
  } catch (e) {}

  var result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (getRawTag);


/***/ },

/***/ "./node_modules/lodash-es/_objectToString.js"
/*!***************************************************!*\
  !*** ./node_modules/lodash-es/_objectToString.js ***!
  \***************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/** Used for built-in method references. */
var objectProto = Object.prototype;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/**
 * Converts `value` to a string using `Object.prototype.toString`.
 *
 * @private
 * @param {*} value The value to convert.
 * @returns {string} Returns the converted string.
 */
function objectToString(value) {
  return nativeObjectToString.call(value);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (objectToString);


/***/ },

/***/ "./node_modules/lodash-es/_root.js"
/*!*****************************************!*\
  !*** ./node_modules/lodash-es/_root.js ***!
  \*****************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _freeGlobal_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_freeGlobal.js */ "./node_modules/lodash-es/_freeGlobal.js");


/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = _freeGlobal_js__WEBPACK_IMPORTED_MODULE_0__["default"] || freeSelf || Function('return this')();

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (root);


/***/ },

/***/ "./node_modules/lodash-es/_trimmedEndIndex.js"
/*!****************************************************!*\
  !*** ./node_modules/lodash-es/_trimmedEndIndex.js ***!
  \****************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/** Used to match a single whitespace character. */
var reWhitespace = /\s/;

/**
 * Used by `_.trim` and `_.trimEnd` to get the index of the last non-whitespace
 * character of `string`.
 *
 * @private
 * @param {string} string The string to inspect.
 * @returns {number} Returns the index of the last non-whitespace character.
 */
function trimmedEndIndex(string) {
  var index = string.length;

  while (index-- && reWhitespace.test(string.charAt(index))) {}
  return index;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (trimmedEndIndex);


/***/ },

/***/ "./node_modules/lodash-es/debounce.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/debounce.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _isObject_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./isObject.js */ "./node_modules/lodash-es/isObject.js");
/* harmony import */ var _now_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./now.js */ "./node_modules/lodash-es/now.js");
/* harmony import */ var _toNumber_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./toNumber.js */ "./node_modules/lodash-es/toNumber.js");




/** Error message constants. */
var FUNC_ERROR_TEXT = 'Expected a function';

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeMax = Math.max,
    nativeMin = Math.min;

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked. The debounced function comes with a `cancel` method to cancel
 * delayed `func` invocations and a `flush` method to immediately invoke them.
 * Provide `options` to indicate whether `func` should be invoked on the
 * leading and/or trailing edge of the `wait` timeout. The `func` is invoked
 * with the last arguments provided to the debounced function. Subsequent
 * calls to the debounced function return the result of the last `func`
 * invocation.
 *
 * **Note:** If `leading` and `trailing` options are `true`, `func` is
 * invoked on the trailing edge of the timeout only if the debounced function
 * is invoked more than once during the `wait` timeout.
 *
 * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
 * until to the next tick, similar to `setTimeout` with a timeout of `0`.
 *
 * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
 * for details over the differences between `_.debounce` and `_.throttle`.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Function
 * @param {Function} func The function to debounce.
 * @param {number} [wait=0] The number of milliseconds to delay.
 * @param {Object} [options={}] The options object.
 * @param {boolean} [options.leading=false]
 *  Specify invoking on the leading edge of the timeout.
 * @param {number} [options.maxWait]
 *  The maximum time `func` is allowed to be delayed before it's invoked.
 * @param {boolean} [options.trailing=true]
 *  Specify invoking on the trailing edge of the timeout.
 * @returns {Function} Returns the new debounced function.
 * @example
 *
 * // Avoid costly calculations while the window size is in flux.
 * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
 *
 * // Invoke `sendMail` when clicked, debouncing subsequent calls.
 * jQuery(element).on('click', _.debounce(sendMail, 300, {
 *   'leading': true,
 *   'trailing': false
 * }));
 *
 * // Ensure `batchLog` is invoked once after 1 second of debounced calls.
 * var debounced = _.debounce(batchLog, 250, { 'maxWait': 1000 });
 * var source = new EventSource('/stream');
 * jQuery(source).on('message', debounced);
 *
 * // Cancel the trailing debounced invocation.
 * jQuery(window).on('popstate', debounced.cancel);
 */
function debounce(func, wait, options) {
  var lastArgs,
      lastThis,
      maxWait,
      result,
      timerId,
      lastCallTime,
      lastInvokeTime = 0,
      leading = false,
      maxing = false,
      trailing = true;

  if (typeof func != 'function') {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  wait = (0,_toNumber_js__WEBPACK_IMPORTED_MODULE_2__["default"])(wait) || 0;
  if ((0,_isObject_js__WEBPACK_IMPORTED_MODULE_0__["default"])(options)) {
    leading = !!options.leading;
    maxing = 'maxWait' in options;
    maxWait = maxing ? nativeMax((0,_toNumber_js__WEBPACK_IMPORTED_MODULE_2__["default"])(options.maxWait) || 0, wait) : maxWait;
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function invokeFunc(time) {
    var args = lastArgs,
        thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time) {
    // Reset any `maxWait` timer.
    lastInvokeTime = time;
    // Start the timer for the trailing edge.
    timerId = setTimeout(timerExpired, wait);
    // Invoke the leading edge.
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime,
        timeWaiting = wait - timeSinceLastCall;

    return maxing
      ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  function shouldInvoke(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime;

    // Either this is the first call, activity has stopped and we're at the
    // trailing edge, the system time has gone backwards and we're treating
    // it as the trailing edge, or we've hit the `maxWait` limit.
    return (lastCallTime === undefined || (timeSinceLastCall >= wait) ||
      (timeSinceLastCall < 0) || (maxing && timeSinceLastInvoke >= maxWait));
  }

  function timerExpired() {
    var time = (0,_now_js__WEBPACK_IMPORTED_MODULE_1__["default"])();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer.
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timerId = undefined;

    // Only invoke if we have `lastArgs` which means `func` has been
    // debounced at least once.
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = undefined;
  }

  function flush() {
    return timerId === undefined ? result : trailingEdge((0,_now_js__WEBPACK_IMPORTED_MODULE_1__["default"])());
  }

  function debounced() {
    var time = (0,_now_js__WEBPACK_IMPORTED_MODULE_1__["default"])(),
        isInvoking = shouldInvoke(time);

    lastArgs = arguments;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (maxing) {
        // Handle invocations in a tight loop.
        clearTimeout(timerId);
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (debounce);


/***/ },

/***/ "./node_modules/lodash-es/isObject.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/isObject.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return value != null && (type == 'object' || type == 'function');
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (isObject);


/***/ },

/***/ "./node_modules/lodash-es/isObjectLike.js"
/*!************************************************!*\
  !*** ./node_modules/lodash-es/isObjectLike.js ***!
  \************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return value != null && typeof value == 'object';
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (isObjectLike);


/***/ },

/***/ "./node_modules/lodash-es/isSymbol.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/isSymbol.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _baseGetTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_baseGetTag.js */ "./node_modules/lodash-es/_baseGetTag.js");
/* harmony import */ var _isObjectLike_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./isObjectLike.js */ "./node_modules/lodash-es/isObjectLike.js");



/** `Object#toString` result references. */
var symbolTag = '[object Symbol]';

/**
 * Checks if `value` is classified as a `Symbol` primitive or object.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
 * @example
 *
 * _.isSymbol(Symbol.iterator);
 * // => true
 *
 * _.isSymbol('abc');
 * // => false
 */
function isSymbol(value) {
  return typeof value == 'symbol' ||
    ((0,_isObjectLike_js__WEBPACK_IMPORTED_MODULE_1__["default"])(value) && (0,_baseGetTag_js__WEBPACK_IMPORTED_MODULE_0__["default"])(value) == symbolTag);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (isSymbol);


/***/ },

/***/ "./node_modules/lodash-es/now.js"
/*!***************************************!*\
  !*** ./node_modules/lodash-es/now.js ***!
  \***************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _root_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_root.js */ "./node_modules/lodash-es/_root.js");


/**
 * Gets the timestamp of the number of milliseconds that have elapsed since
 * the Unix epoch (1 January 1970 00:00:00 UTC).
 *
 * @static
 * @memberOf _
 * @since 2.4.0
 * @category Date
 * @returns {number} Returns the timestamp.
 * @example
 *
 * _.defer(function(stamp) {
 *   console.log(_.now() - stamp);
 * }, _.now());
 * // => Logs the number of milliseconds it took for the deferred invocation.
 */
var now = function() {
  return _root_js__WEBPACK_IMPORTED_MODULE_0__["default"].Date.now();
};

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (now);


/***/ },

/***/ "./node_modules/lodash-es/toNumber.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/toNumber.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _baseTrim_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_baseTrim.js */ "./node_modules/lodash-es/_baseTrim.js");
/* harmony import */ var _isObject_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./isObject.js */ "./node_modules/lodash-es/isObject.js");
/* harmony import */ var _isSymbol_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./isSymbol.js */ "./node_modules/lodash-es/isSymbol.js");




/** Used as references for various `Number` constants. */
var NAN = 0 / 0;

/** Used to detect bad signed hexadecimal string values. */
var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

/** Used to detect binary string values. */
var reIsBinary = /^0b[01]+$/i;

/** Used to detect octal string values. */
var reIsOctal = /^0o[0-7]+$/i;

/** Built-in method references without a dependency on `root`. */
var freeParseInt = parseInt;

/**
 * Converts `value` to a number.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to process.
 * @returns {number} Returns the number.
 * @example
 *
 * _.toNumber(3.2);
 * // => 3.2
 *
 * _.toNumber(Number.MIN_VALUE);
 * // => 5e-324
 *
 * _.toNumber(Infinity);
 * // => Infinity
 *
 * _.toNumber('3.2');
 * // => 3.2
 */
function toNumber(value) {
  if (typeof value == 'number') {
    return value;
  }
  if ((0,_isSymbol_js__WEBPACK_IMPORTED_MODULE_2__["default"])(value)) {
    return NAN;
  }
  if ((0,_isObject_js__WEBPACK_IMPORTED_MODULE_1__["default"])(value)) {
    var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
    value = (0,_isObject_js__WEBPACK_IMPORTED_MODULE_1__["default"])(other) ? (other + '') : other;
  }
  if (typeof value != 'string') {
    return value === 0 ? value : +value;
  }
  value = (0,_baseTrim_js__WEBPACK_IMPORTED_MODULE_0__["default"])(value);
  var isBinary = reIsBinary.test(value);
  return (isBinary || reIsOctal.test(value))
    ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
    : (reIsBadHex.test(value) ? NAN : +value);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (toNumber);


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
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
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
/*!*******************************************!*\
  !*** ./extensions/Multipage/Multipage.js ***!
  \*******************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MultipageExtension: () => (/* binding */ MultipageExtension)
/* harmony export */ });
/* harmony import */ var _MultipageTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MultipageTool.js */ "./extensions/Multipage/MultipageTool.js");
/* harmony import */ var _Scrollbar_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./Scrollbar.js */ "./extensions/Multipage/Scrollbar.js");
/* harmony import */ var lodash_es__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! lodash-es */ "./node_modules/lodash-es/debounce.js");




const av = Autodesk.Viewing;
const namespace = AutodeskNamespace('Autodesk.Viewing.Extensions.Multipage');

const Overscan = 15; // Number of pages out of scroll to render in advanced.
const DsThumbnailSize = 400;
const FadeDuration = 0.2;
const OVERLAY_SCENE = 'multipage-overlay-scene';
const MaxLoadedPages = 4;
const MaxPagesInView = 2;
const BorderThickness = 0.2; // In world units
const LoadDebounceTime = 200;

const Events = {
  FocusedPageChanged: "focusedPageChanged",
  PageLoaded: "pageLoaded"
};

class MultipageExtension extends av.Extension {

  constructor(viewer, options) {
    super(viewer, options);
    this.modes = [];
    this.mode = '';
    this.name = 'Multipage';

    this.onModelAdded = this.onModelAdded.bind(this);
    this.onCameraChanged = this.onCameraChanged.bind(this);

    this.frustum = new Autodesk.Viewing.Private.FrustumIntersector();

    this.loadFocusedPageDebounced = (0,lodash_es__WEBPACK_IMPORTED_MODULE_2__["default"])(this.loadFocusedPage.bind(this), LoadDebounceTime);

    Autodesk.Viewing.EventDispatcher.prototype.apply(this);
  }

  load() {
    this.cache = {};

    this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelAdded);
    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);

    this.scrollbar = new _Scrollbar_js__WEBPACK_IMPORTED_MODULE_1__["default"](this);

    this.planeGeometry = new THREE.PlaneBufferGeometry(1, 1);
    this.viewer.impl.createOverlayScene(OVERLAY_SCENE);

    this.multipageTool = new _MultipageTool_js__WEBPACK_IMPORTED_MODULE_0__["default"](this);

    // Call onModelAdded manually for the first time, in case that there is already a loaded model when loading the extension.
    this.onModelAdded({ model: this.viewer.model });
    this.onCameraChanged();

    return true;
  }

  unload() {
    const pages = this.getAllPages();
    pages?.forEach((page) => {
      page.fadeAnim?.stop();
    });

    this.cache = {};

    this.loadFocusedPageDebounced.cancel();

    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelAdded);
    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);

    this.planeGeometry.dispose();
    this.planeGeometry = null;

    this.viewer.impl.removeOverlayScene(OVERLAY_SCENE);

    this.viewer.toolController.deactivateTool(this.multipageTool.getName());
    this.multipageTool = null;

    this.scrollbar.destroy();
    this.scrollbar = null;
    this.viewer = null;

    return true;
  }

  onModelAdded({ model }) {
    const rootNode = model?.getDocumentNode()?.getRootNode();

    if (!rootNode) {
      return;
    }

    const pageStructure = this.getPageStructure(rootNode);

    if (model.is3d() || pageStructure.pages.length === 1) {
      this.scrollbar.hide();

      if (this.viewer.toolController.isToolActivated(this.multipageTool.getName())) {
        this.viewer.toolController.deactivateTool(this.multipageTool.getName());
      }

      // In case of 3D model or only a single page, break.
      return;
    } else {
      this.scrollbar.show();
      if (!this.viewer.toolController.isToolActivated(this.multipageTool.getName())) {
        this.viewer.toolController.activateTool(this.multipageTool.getName());
      }
    }

    if (this.currentRootNode) {
      this.updateNavigationConstrains();
    }

    pageStructure.pages.forEach((page) => {
      if (!this.isPageLoaded(page) && !page.loading) {
        this.createThumbnailMesh(page);
        this.showThumbnail(page);
      }
    });

    this.onCameraChanged();

    this.currentRootNode = rootNode;

    this.drawPageDividers();

    // Handle first loaded model. Since it wasn't loaded with placementTransform load option, we
    // have to change the placement transform only later.
    if (!model.loader.options.placementTransform) {
      const node = model.getDocumentNode();
      const page = pageStructure.pages.find((p) => p.node === node);
      this.viewer.impl.setPlacementTransform(model, page.matrix);
      const immediate = this.getFocusedPage() === page;
      this.focusOnPage(page, immediate);
    }
  }

  getPageStructure(rootNode) {
    if (!rootNode) {
      return null;
    }

    const documentUrn = rootNode.urn();

    if (this.cache[documentUrn]) {
      return this.cache[documentUrn];
    }

    const lmvDocument = rootNode.lmvDocument;

    const combinedBox = new THREE.Box3();

    this.cache[documentUrn] = {
      lmvDocument,
      combinedBox,
      pages: []
    };

    const geomNodes = rootNode.search({ type: 'geometry', role: '2d' });

    let offset = 0;

    geomNodes.forEach((node, i) => {
      const matrix = new THREE.Matrix4().makeTranslation(0, -offset, 0);

      const viewNode = node.search({ type: 'view' })[0];
      const viewBoxValues = viewNode.getViewBox();
      const dimensions = new THREE.Box3();
      dimensions.min.set(viewBoxValues[0], viewBoxValues[1], 0);
      dimensions.max.set(viewBoxValues[2], viewBoxValues[3], 0);

      combinedBox.union(dimensions);

      // Don't add offset for the last page - so it won't mislead the combinedBox.
      if (i !== geomNodes.length - 1) {
        offset += dimensions.size().y;
      }

      this.cache[documentUrn].pages.push({
        node,
        matrix,
        dimensions,
        box: dimensions.clone().applyMatrix4(matrix)
      });
    });

    const firstPage = this.cache[documentUrn].pages[0];
    const lastPage = this.cache[documentUrn].pages[this.cache[documentUrn].pages.length - 1];

    combinedBox.max.y = firstPage.dimensions.max.y / 2;
    combinedBox.min.y = lastPage.dimensions.max.y / 2 - offset;

    return this.cache[documentUrn];
  }

  // Applies css styling on image element, so that the given cropRegion fits the parent div
  //
  // @param {Image} image      - html image element
  // @param {Box2}  cropRegion - in [0,1]^2, relative to the full image
  cropImage(image, cropRegion) {
    const _document = av.getGlobal().document;
    const canvas = _document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // compute size of crop region (relative to full image)
    const cropWidthRatio = cropRegion.max.x - cropRegion.min.x;
    const cropHeightRatio = cropRegion.max.y - cropRegion.min.y;

    const destWidth = cropWidthRatio * image.width;
    const destHeight = cropHeightRatio * image.height;

    canvas.width = destWidth;
    canvas.height = destHeight;

    ctx.drawImage(
      image,
      cropRegion.min.x * image.width, (1 - cropRegion.max.y) * image.height,
      destWidth, destHeight,
      0, 0,
      destWidth, destHeight
    );

    const texImage = new Image();
    texImage.src = canvas.toDataURL();

    return texImage;
  }

  // Expands rect in-place by expanding the smallest axis around the center.
  //  @param {Box2} rect
  expandToSquare(rect) {

    // determine scale factor from max-axis of sheet bounds
    const diag = rect.getSize(new THREE.Vector2());
    const center = rect.getCenter(new THREE.Vector2());

    const radius = 0.5 * Math.max(diag.x, diag.y);

    rect.min.set(center.x - radius, center.y - radius);
    rect.max.set(center.x + radius, center.y + radius);
  }

  // Rescales a point p within srcBounds to [0..1]^2. Works in-place.
  //  @param {Vector2} p
  //  @param {Box2} srcBounds
  boundsToUnitQuad(p, srcBounds) {
    const dx = srcBounds.max.x - srcBounds.min.x;
    const dy = srcBounds.max.y - srcBounds.min.y;

    p.x -= srcBounds.min.x;
    p.y -= srcBounds.min.y;

    p.x /= dx;
    p.y /= dy;
  }

  async fetchThumbnail(page) {
    if (page.img || page.loadingImg) {
      return;
    }

    page.loadingImg = true;

    const node = page.node;

    const imgUrl = await av.Thumbnails.getUrlForBubbleNode(node, { size: DsThumbnailSize });

    return new Promise((resolve) => {
      const squareImage = new Image();
      squareImage.src = imgUrl;

      squareImage.onload = async () => {


        const sheetBox = page.dimensions.clone();
        // Thumbnails are square and contain empty pixels to expand the rectangle to a square.
        // Therefore, the whole thumbnail image does not match the sheet bounds exactly,
        // but actually corresponds to the square containing it.
        this.expandToSquare(sheetBox);

        const cropRelativeRegion = page.dimensions.clone();

        // map from sheetBox to thumbnail pixels
        this.boundsToUnitQuad(cropRelativeRegion.min, sheetBox);
        this.boundsToUnitQuad(cropRelativeRegion.max, sheetBox);

        const croppedThumbnail = this.cropImage(squareImage, cropRelativeRegion);

        croppedThumbnail.onload = () => {
          page.img = croppedThumbnail;
          delete page.loadingImg;
          this.getWindow().URL.revokeObjectURL(squareImage.src);
          this.createThumbnailMesh(page);
          resolve();
        };
      };
    });
  }

  // Create a plane, position it in the correct place in the scene, and assign the thumbnail texture to it.
  createThumbnailMesh(page) {
    if (!page.mesh) {
      const material = new Autodesk.Viewing.Scene.UnlitMaterial({
        color: 0xFFFFFF,
        opacity: 1.0,
        transparent: true
      });

      const mesh = new THREE.Mesh(this.planeGeometry, material);

      const size = page.dimensions.size();
      const position = new THREE.Vector3().setFromMatrixPosition(page.matrix);
      position.add(new THREE.Vector3(size.x / 2, size.y / 2, 0));
      mesh.position.copy(position);
      mesh.scale.set(size.x, size.y, 1);
      mesh.dirty = false;

      page.mesh = mesh;
    }

    if (page.img && !page.mesh.material.map) {
      const texture = new THREE.Texture();
      texture.minFilter = THREE.LinearFilter;
      page.mesh.material.map = texture;

      page.mesh.material.map.image = page.img;
      page.mesh.material.map.needsUpdate = true;
      page.mesh.material.needsUpdate = true;
    }
  }

  showThumbnail(page) {
    if (!page.thumbnailVisible) {
      page.mesh.material.opacity = 1.0;
      this.viewer.impl.addOverlay(OVERLAY_SCENE, page.mesh);
      page.thumbnailVisible = true;
    }

    this.viewer.impl.invalidate(true, true, true);
  }

  hideThumbnail(page) {
    if (page.thumbnailVisible) {

      this.fadeOpacity(page, () => {
        this.viewer.impl.removeOverlay(OVERLAY_SCENE, page.mesh);
      });

      page.thumbnailVisible = false;
    }
  }

  fadeOpacity(page, onDone) {
    if (page.fadeAnim) {
      return;
    }

    const onTimer = (t) => {
      // In case viewer was destroyed during animation.
      if (!this.viewer) {
        return;
      }

      t = Autodesk.Viewing.Private.smootherStep(t);
      const opacity = Autodesk.Viewing.Private.lerp(1.0, 0.0, t);
      page.mesh.material.opacity = opacity;
      this.viewer.impl.invalidate(true, true, true);
    };

    const onFadeEnd = () => {
      delete page.fadeAnim;
      onDone && onDone();
    };

    page.fadeAnim = Autodesk.Viewing.Private.fadeValue(0, 1, FadeDuration, onTimer, onFadeEnd);
  }

  isPageInView(page) {
    return this.frustum.intersectsBox(page.box) > 0;
  }

  getAllPages() {
    const pageStructure = this.getPageStructure(this.currentRootNode);
    return pageStructure?.pages;
  }

  getNearestPages() {
    if (!this.currentRootNode) {
      return [];
    }

    const camera = this.viewer.getCamera();

    const sortedPages = [...this.getAllPages()];

    sortedPages.sort((pageA, pageB) => {
      const distA = pageA.box.getCenter().distanceToSquared(camera.target);
      const distB = pageB.box.getCenter().distanceToSquared(camera.target);

      return distA - distB;
    });

    return sortedPages;
  }

  getFocusedPage() {
    return this.getNearestPages()[0];
  }

  isPageLoaded(page) {
    return this.viewer.impl.findModel(page.node);
  }

  onCameraChanged() {
    if (!this.currentRootNode) {
      return;
    }

    // Needed for isPageInView
    this.frustum.reset(this.viewer.getCamera());

    const nearestPages = this.getNearestPages();

    const count = Math.min(Overscan, nearestPages.length);

    for (let i = 0; i < count; i++) {
      const page = nearestPages[i];

      this.fetchThumbnail(page).then(() => {
        if (!this.isPageLoaded(page) && !page.loading) {
          this.showThumbnail(page);
        }
      });
    }

    this.loadFocusedPageDebounced();

    this.scrollbar.update();

    this.updateFocusedPage();
  }

  updateNavigationConstrains() {
    const focusedPage = this.getFocusedPage();
    const pageStructure = this.getPageStructure(this.currentRootNode);
    const model = this.viewer.impl.findModel(focusedPage.node);

    // Vector models should have this value undefined - no zoom limit.
    let maxPixelPerUnit = undefined;

    if (!model) {
      // Thumbnail
      maxPixelPerUnit = 150; // 150 is usually the pixelPerUnit value of Leaflets.
    } else if (model.isLeaflet()) {
      // Leaflet
      maxPixelPerUnit = model.getData().maxPixelPerUnit;
    }

    this.viewer.navigation.setZoomOutLimitFactor(MaxPagesInView / pageStructure.pages.length);
    this.viewer.navigation.setConstraints2D(pageStructure.combinedBox, maxPixelPerUnit);
  }

  updateFocusedPage() {
    if (this.animatingCamera) {
      return;
    }

    const focusedPage = this.getFocusedPage();
    this.updateNavigationConstrains();

    if (this.focusedPage !== focusedPage) {
      this.focusedPage = focusedPage;

      const documentBrowser = this.viewer.getExtension('Autodesk.DocumentBrowser');
      documentBrowser?.ui?.panel?.setCurrentNode(this.focusedPage.node);

      this.fireEvent({ type: Events.FocusedPageChanged, focusedPage });
    }
  }

  getPagesInView() {
    if (!this.currentRootNode) {
      return [];
    }

    const pages = this.getAllPages();

    const pagesInView = pages.filter((page) => this.isPageInView(page));

    return pagesInView;
  }

  focusOnNode(node) {
    const pages = this.getAllPages();

    if (!pages) {
      return null;
    }

    let pageToFocus = pages.find((page) => page.node === node || page.node.guid() === node || page.node.name() === node);

    // As a last fallback, add "()" to the name.
    if (!pageToFocus) {
      node = `(${node})`;
      pageToFocus = pages.find((page) => page.node.name() === node);
    }

    if (pageToFocus) {
      this.focusOnPage(pageToFocus);
      return pageToFocus.node.guid();
    }

    return null;
  }

  focusOnPage(pageToFocus, immediate) {
    if (immediate) {
      this.viewer.navigation.fitBounds(true, pageToFocus.box);
    } else {
      this.animatingCamera = true;
      this.viewer.navigation.fitBounds(false, pageToFocus.box);

      this.viewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, () => {
        this.animatingCamera = false;
        this.onCameraChanged();
      }, { once: true });
    }
  }

  getCurrentPageIndex() {
    const currentPage = this.getFocusedPage();

    if (!currentPage) {
      return null;
    }

    const pages = this.getAllPages();
    const index = pages.indexOf(currentPage);

    return index;
  }

  focusOnPageIndex(index) {
    const pages = this.getAllPages();

    const pageToFocus = pages[index];

    if (!pageToFocus) {
      return null;
    }

    this.focusOnPage(pageToFocus);

    return pageToFocus.node.guid();
  }

  focusPrevPage() {
    const index = this.getCurrentPageIndex();
    return this.focusOnPageIndex(index - 1);
  }

  focusNextPage() {
    const index = this.getCurrentPageIndex();
    return this.focusOnPageIndex(index + 1);
  }

  focusFirstPage() {
    return this.focusOnPageIndex(0);
  }

  focusLastPage() {
    const pages = this.getAllPages();
    return this.focusOnPageIndex(pages.length - 1);
  }

  // Get all visible non-raster-underlay models.
  getRealModels() {
    return this.viewer.getVisibleModels().filter((m) => !m.getData().underlayRaster);
  }

  cleanup() {
    if (this.getRealModels().length > MaxLoadedPages) {
      const nearestPages = this.getNearestPages();

      const hideFunction = this.options.hideModel || this.viewer.hideModel.bind(this.viewer);

      for (let i = nearestPages.length - 1; i >= 0; i--) {
        const page = nearestPages[i];

        page.loading = false;

        if (this.isPageLoaded(page)) {
          const model = this.viewer.impl.findModel(page.node);
          hideFunction(model);

          if (this.getRealModels().length <= MaxLoadedPages) {
            break;
          }
        }
      }
    }
  }

  async loadFocusedPage() {
    this.cleanup();

    const pages = this.getPagesInView();
    const len = Math.min(pages.length, MaxLoadedPages);

    for (let i = 0; i < len; i++) {
      const pageToLoad = pages[i];

      if (this.isPageLoaded(pageToLoad) || pageToLoad.loading) {
        return;
      }

      const pageStructure = this.getPageStructure(this.currentRootNode);

      pageToLoad.loading = true;

      const viewer = this.viewer;

      const onTempModelAdded = ({ model }) => {
        if (this.viewer.impl.findModel(pageToLoad.node) === model) {
          this.hideThumbnail(pageToLoad);

          this.viewer.removeEventListener(av.MODEL_ADDED_EVENT, onTempModelAdded);
        }
      };

      this.viewer.addEventListener(av.MODEL_ADDED_EVENT, onTempModelAdded);

      const loadFunction = this.options.loadDocumentNode || this.viewer.loadDocumentNode.bind(this.viewer);

      try {
        await loadFunction(pageStructure.lmvDocument, pageToLoad.node, {
          keepCurrentModels: true,
          loadAsHidden: false,
          leafletOptions: {
            fitPaperSize: true
          },
          placementTransform: pageToLoad.matrix,
          noShadow: true
        });

        this.cleanup();

        // In case that raster underlay wasn't available, verify that we hid the thumbnail.
        this.hideThumbnail(pageToLoad);

        this.fireEvent({ type: Events.PageLoaded, page: pageToLoad });

        pageToLoad.loading = false;
      } catch (e) {
        viewer.removeEventListener(av.MODEL_ADDED_EVENT, onTempModelAdded);

        // It is possible that we got here after a model load was canceled, and the viewer instance was cleared in the extension unload.
        // In that case, there is nothing to clean.
        if (!this.viewer) {
          return;
        }

        this.cleanup();
        this.showThumbnail(pageToLoad);
        pageToLoad.loading = false;
      }
    }
  }

  drawPageDividers() {
    const pages = this.getAllPages();

    if (!pages) {
      return;
    }

    const material = new Autodesk.Viewing.Scene.UnlitMaterial({
      color: 0xaaaaaa // F2D gray
    });

    // Skip last page
    for (let i = 0; i < pages.length - 1; i++) {
      const page = pages[i];
      const mesh = new THREE.Mesh(this.planeGeometry, material);
      const size = page.dimensions.size();
      const position = new THREE.Vector3().setFromMatrixPosition(page.matrix);
      position.add(new THREE.Vector3(size.x / 2, 0, 100));
      mesh.position.copy(position);
      mesh.scale.set(size.x, BorderThickness, 1);
      this.viewer.impl.addOverlay(OVERLAY_SCENE, mesh);
    }

    this.viewer.impl.invalidate(true, true, true);
  }

  getRelativeCameraPosition() {
    const pageStructure = this.getPageStructure(this.currentRootNode);

    if (!pageStructure) {
      return 0;
    }

    const camera = this.viewer.getCamera();
    const camHeight = -camera.position.y + pageStructure.pages[0].dimensions.size().y / 2;

    const totalHeight = pageStructure.combinedBox.size().y;

    const relativeHeight = camHeight / totalHeight;

    const clampedHeight = THREE.Math.clamp(relativeHeight, 0, 1);

    return clampedHeight;
  }

  setRelativeCameraPosition(relativeHeight) {
    const pageStructure = this.getPageStructure(this.currentRootNode);

    if (!pageStructure) {
      return;
    }

    const totalHeight = pageStructure.combinedBox.size().y;

    const camera = this.viewer.getCamera();
    const position = camera.position.clone();
    const target = camera.target.clone();

    const y = relativeHeight * (totalHeight + pageStructure.pages[0].dimensions.size().y / 2);
    const yClamped = THREE.Math.clamp(y, -(pageStructure.pages[0].dimensions.size().y / 2), totalHeight - pageStructure.pages[pageStructure.pages.length - 1].dimensions.size().y / 2);

    position.y = -yClamped;
    target.y = -yClamped;

    this.viewer.navigation.setView(position, target);
  }
}

namespace.MultipageExtension = MultipageExtension;
namespace.Events = Events;

av.theExtensionManager.registerExtension('Autodesk.Multipage', MultipageExtension);
})();

Autodesk.Extensions.Multipage = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Multipage.js.map