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

/***/ "./extensions/Minimap2D/MinimapCanvas.js"
/*!***********************************************!*\
  !*** ./extensions/Minimap2D/MinimapCanvas.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ MinimapCanvas)
/* harmony export */ });
/* harmony import */ var _MinimapStyle_css__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MinimapStyle.css */ "./extensions/Minimap2D/MinimapStyle.css");
/* harmony import */ var _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MinimapThumbnail.js */ "./extensions/Minimap2D/MinimapThumbnail.js");



const av = Autodesk.Viewing;

class MinimapCanvas extends Autodesk.Viewing.EventDispatcher {
  constructor(backgroundImgs, docWidth, docHeight, initialSize = 'large') {
    super();
    this.minimapSize = _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes[initialSize];
    const maxDimension = Math.max(docWidth, docHeight);
    this.widthFactor = docWidth / maxDimension;
    this.heightFactor = docHeight / maxDimension;

    this._initBackground();
    this._initHighlight();
    this._initContainer();

    this.backgroundImgs = backgroundImgs;
    // Keep a cache of different sizes if needed
    this.backgroundImg = new Image(); // The current image
  }

  _initContainer() {
    const _document = this.getDocument();
    this.canvasContainer = _document.createElement('div');
    this.canvasContainer.className = 'minimap-canvas-container';
    this.canvasContainer.appendChild(this.backgroundCanvas);
    this.canvasContainer.appendChild(this.highlightCanvas);
    this._updateCanvasContainerSize();
  }

  _updateCanvasContainerSize() {
    this.canvasContainer.style.width = this.backgroundCanvas.width + 'px';
    this.canvasContainer.style.height = this.backgroundCanvas.height + 'px';
  }

  _initBackground() {
    const _document = this.getDocument();
    this.backgroundCanvas = _document.createElement('canvas');
    this.backgroundCanvas.className = 'minimap-canvas-base minimap-canvas-background';
  }

  _initHighlight() {
    const _document = this.getDocument();
    this.highlightCanvas = _document.createElement('canvas');
    this.highlightCanvas.className = 'minimap-canvas-base minimap-canvas-highlight';
  }

  setSize(newSize) {
    newSize = typeof newSize === 'string' ? _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes[newSize] : newSize;
    return new Promise((resolve, reject) => {
      this.backgroundCanvas.width = this.highlightCanvas.width = Math.round(newSize * this.widthFactor);
      this.backgroundCanvas.height = this.highlightCanvas.height = Math.round(newSize * this.heightFactor);
      this._updateCanvasContainerSize();

      let lowestBound = Number.MAX_VALUE;
      let thumbnailSize = 'large';
      for (const size in _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes) {
        if (newSize <= _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes[size] && _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes[size] < lowestBound && Object.prototype.hasOwnProperty.call(this.backgroundImgs, size)) {
          thumbnailSize = size;
          lowestBound = _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes[size];
        }
      }

      this.setBackground(thumbnailSize).then(() => {
        this.drawBackground();
        resolve();
      });

      this.minimapSize = newSize;
    });
  }

  setBackground(thumbnailSize) {
    return new Promise((resolve, reject) => {
      if (!Object.prototype.hasOwnProperty.call(this.backgroundImgs, thumbnailSize)) {
        reject('thumbnail size not found');
        return;
      }

      if (this.backgroundImg.src === this.backgroundImgs[thumbnailSize]) {
        resolve();
        return;
      }

      this.backgroundImg.onload = () => {
        this.setBackgroundSourceSize(thumbnailSize);
        resolve();
      };
      this.backgroundImg.src = this.backgroundImgs[thumbnailSize];
    });
  }

  setBackgroundSourceSize(thumbnailSize) {
    const size = _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_1__.thumbnailSizes[thumbnailSize];
    this.backgroundWidth = Math.round(size * this.widthFactor);
    this.backgroundHeight = Math.round(size * this.heightFactor);
    this.backgroundOffsetX = (size - this.backgroundWidth) / 2;
    this.backgroundOffsetY = (size - this.backgroundHeight) / 2;
  }

  drawBackground() {
    const ctx = this.backgroundCanvas.getContext('2d');
    // TODO: Consider using smoothing only if size is not power of 2 (or odd number)
    ctx.mozImageSmoothingEnabled = false; // These parameters are reset when resizing the canvas
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.backgroundImg, this.backgroundOffsetX, this.backgroundOffsetY, this.backgroundWidth, this.backgroundHeight,
    0, 0, this.backgroundCanvas.width, this.backgroundCanvas.height);
  }

  drawHighlight(bottomLeft, topRight) {
    const startPos = { x: Math.round(bottomLeft.x), y: Math.round(topRight.y) };
    const width = Math.round(Math.max(topRight.x - bottomLeft.x, 2));
    const height = Math.round(Math.max(bottomLeft.y - topRight.y, 2));

    const ctx = this.highlightCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.highlightCanvas.width, this.highlightCanvas.height);

    ctx.beginPath();
    ctx.lineWidth = '2';
    ctx.strokeStyle = '#CC3B3B';
    ctx.fillStyle = 'rgba(204, 59, 59, 0.2)'; // Same color but in rgba
    ctx.rect(startPos.x, startPos.y, width, height);
    ctx.fill();
    ctx.stroke();
  }

  setVisibility(isVisible) {
    this.backgroundCanvas.style.visibility = isVisible ? 'visible' : 'hidden';
    this.highlightCanvas.style.visibility = isVisible ? 'visible' : 'hidden';
  }

  addListenerToCanvas(event, callback) {
    this.highlightCanvas.addEventListener(event, callback);
  }

  removeListenerFromCanvas(event, callback) {
    this.highlightCanvas.removeEventListener(event, callback);
  }

  getBoundingClientRect() {
    return this.highlightCanvas.getBoundingClientRect();
  }

  unload() {
    const _window = this.getWindow();
    const urlCreator = _window.URL || _window.webkitURL;
    this.backgroundImg = null;
    for (const img in this.backgroundImgs) {
      urlCreator.revokeObjectURL(this.backgroundImgs[img]);
    }
  }

  get width() {
    return this.highlightCanvas.width;
  }

  get height() {
    return this.highlightCanvas.height;
  }
}

av.GlobalManagerMixin.call(MinimapCanvas.prototype);

/***/ },

/***/ "./extensions/Minimap2D/MinimapPanel.js"
/*!**********************************************!*\
  !*** ./extensions/Minimap2D/MinimapPanel.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ MinimapPanel)
/* harmony export */ });
class MinimapPanel extends Autodesk.Viewing.UI.DockingPanel {
  constructor(parentContainer, x, y, options) {
    super(parentContainer, 'MinimapPanel', 'Minimap', options);
    this.container.style.left = x + 'px';
    this.container.style.top = y + 'px';
    this.container.classList.add("docking-panel-container-solid-color-b");

    this.fadeIn = 'opacity 0.5s';
    this.fadeOut = 'opacity 0.1s';
    this.container.addEventListener('transitionend', (e) => {
      if (this.container.style.opacity === '0') {
        this.container.style.display = 'none';
      }
    });

  }

  _addNoMinimapElem() {
    const _document = this.getDocument();
    this.noMinimapDiv = _document.createElement('div');
    this.noMinimapDiv.textContent = Autodesk.Viewing.i18n.translate('Minimap not available');
    this.noMinimapDiv.className = 'minimap-unavailable';
    this.container.appendChild(this.noMinimapDiv);
  }

  _removeNoMinimapElem() {
    if (this.container.contains(this.noMinimapDiv)) {
      this.container.removeChild(this.noMinimapDiv);
    }
  }

  initialize() {
    super.initialize();
    this._addNoMinimapElem();
  }

  appendElement(elem) {
    this._removeNoMinimapElem();
    this.container.appendChild(elem);
  }

  addListenerToCloseButton(cb) {
    this.addEventListener(this.closer, 'click', cb, false);
  }

  _triggerReflow() {
    return this.container.offsetWidth;
  }

  _isVisible() {
    return this.container.style.display === 'block';
  }

  setVisible(show, withTransition) {
    if (withTransition) {
      this.setVisibleWithTransition(show);
    } else {
      this.container.style.display = show ? 'block' : 'none';
      this.container.style.opacity = show ? '1' : '0';
    }
  }

  setVisibleWithTransition(show) {
    if (show) {
      const wasVisible = this._isVisible();
      this.container.style.transition = this.fadeIn;
      this.container.style.display = 'block';
      if (!wasVisible) {
        this.container.style.opacity = '0';
        this._triggerReflow();
      }
      this.container.style.opacity = '1';
    } else {
      this.container.style.transition = this.fadeOut;
      this.container.style.opacity = '0';

    }
  }
}

/***/ },

/***/ "./extensions/Minimap2D/MinimapThumbnail.js"
/*!**************************************************!*\
  !*** ./extensions/Minimap2D/MinimapThumbnail.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   fetchThumbnail: () => (/* binding */ fetchThumbnail),
/* harmony export */   thumbnailDefaultSizes: () => (/* binding */ thumbnailDefaultSizes),
/* harmony export */   thumbnailSizes: () => (/* binding */ thumbnailSizes)
/* harmony export */ });
const thumbnailSizes = {
  'small': 100,
  'medium': 200,
  'large': 400
};

const thumbnailDefaultSizes = {
  'mobile': 200,
  'web': 300
};

function fetchThumbnail(document, node, thumbnailSize, images) {
  return new Promise((resolve, reject) => {
    const size = typeof thumbnailSize === 'string' ? thumbnailSizes[thumbnailSize] : thumbnailSize;
    const options = document.getThumbnailOptions(node.data, size, size);

    Autodesk.Viewing.Document.requestThumbnailWithSecurity(options, (error, response) => {
      if (error) {
        reject('Error requesting thumbnail');
        return;
      }
      const urlCreator = window.URL || window.webkitURL;
      images[thumbnailSize] = urlCreator.createObjectURL(response);
      resolve();
    });
  });
}

/***/ },

/***/ "./extensions/Minimap2D/ThumbnailUtils.js"
/*!************************************************!*\
  !*** ./extensions/Minimap2D/ThumbnailUtils.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
const ThumbnailUtils = {};

ThumbnailUtils.isThumbnailValid = function (canvas) {
  const predominantColorPercentage = ThumbnailUtils.getPredominantColorPercentage(canvas);
  return predominantColorPercentage < ThumbnailUtils.MAX_PREDOMINANT_COLOR_PERCENTAGE;
};

ThumbnailUtils.getPredominantColorPercentage = function (canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  const colors = {};
  // Create a set for the pixels. Compare what percentage the largest color has
  for (let i = 0, n = pixels.length; i < n; i += 4) {
    const hexColor = ThumbnailUtils.rgba2hex(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]);
    colors[hexColor] = Object.prototype.hasOwnProperty.call(colors, hexColor) ? colors[hexColor] + 1 : 1;
  }

  const predominantColorCount = Object.keys(colors).reduce((previous, key) => colors[key] > previous ? colors[key] : previous, 0);
  const predominantColorPercentage = predominantColorCount / (pixels.length / 4);
  // console.log('Percent of predominant color', predominantColorPercentage);

  return predominantColorPercentage;
};

// convert RGBA color data to hex
ThumbnailUtils.rgba2hex = function (r, g, b, a) {
  if (r > 255 || g > 255 || b > 255 || a > 255) {
    throw 'Invalid color component';
  }
  return (256 + r).toString(16).substr(1) + ((1 << 24) + (g << 16) | b << 8 | a).toString(16).substr(1);
};

ThumbnailUtils.MAX_PREDOMINANT_COLOR_PERCENTAGE = 0.97;


/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ThumbnailUtils);

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Minimap2D/MinimapStyle.css"
/*!***********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Minimap2D/MinimapStyle.css ***!
  \***********************************************************************************************************************************************************************************************************************************************************/
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
___CSS_LOADER_EXPORT___.push([module.id, `.minimap-canvas-container {
  position: relative;
  margin: 15px 5px 10px 5px;
}

.minimap-canvas-base {
  position: absolute;
  left: 0px;
  top: 0px;
}

.minimap-canvas-background {
  /*z-index: 100;*/
}

.minimap-canvas-highlight {
  /*z-index: 101;*/
}

.minimap-unavailable {
  color: #dbdbdb;
  margin: 10px;
  text-align: center;
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

/***/ "./extensions/Minimap2D/MinimapStyle.css"
/*!***********************************************!*\
  !*** ./extensions/Minimap2D/MinimapStyle.css ***!
  \***********************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MinimapStyle_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./MinimapStyle.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Minimap2D/MinimapStyle.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MinimapStyle_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MinimapStyle_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MinimapStyle_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MinimapStyle_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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
  !*** ./extensions/Minimap2D/Minimap2D.js ***!
  \*******************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ MinimapExtension)
/* harmony export */ });
/* harmony import */ var _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MinimapThumbnail.js */ "./extensions/Minimap2D/MinimapThumbnail.js");
/* harmony import */ var _MinimapCanvas_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MinimapCanvas.js */ "./extensions/Minimap2D/MinimapCanvas.js");
/* harmony import */ var _MinimapPanel_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MinimapPanel.js */ "./extensions/Minimap2D/MinimapPanel.js");
/* harmony import */ var _ThumbnailUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./ThumbnailUtils.js */ "./extensions/Minimap2D/ThumbnailUtils.js");





const namespace = AutodeskNamespace('Autodesk.BIM360.Minimap');

const MIN_SIZE = 100;
const MAX_SIZE = 400;

const SETTINGS_PROP = 'showMinimap2D';

/**
 * Provides a 2d Minimap to show the view of the current document.
 *
 * The extension id is: `Autodesk.BIM360.Minimap`
 *
 * @example
 *   viewer.loadExtension('Autodesk.BIM360.Minimap')
 *
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.MinimapExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */

class MinimapExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options = {}) {
    super(viewer, options);
    this._isEnabled = false;
    this.isMobile = Autodesk.Viewing.isMobileDevice();
    this.initialSize = this.options.initialSize || null;
    this.wasInit = false;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseLeave = this.onMouseLeave.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);

    this.onCameraChange = this.onCameraChange.bind(this, true); // Binded with transition=true
    this.update = this.update.bind(this);
    this.onCloseButton = this.onCloseButton.bind(this);
    this.setEnabled = this.setEnabled.bind(this);
    this.updateSettingsPanel = this.updateSettingsPanel.bind(this);
  }

  /**
   * Set the minimap extension to be enabled / disabled.
   *
   * @param {boolean} isEnabled - True if enabling the minimap extension.
   * @private
   */
  async setEnabled(isEnabled) {
    if (isEnabled) {
      if (!this.wasInit) {
        await this.init();
      }
      if (!this.viewer.impl) {// Check that viewer wasn't unloaded in the meantime
        return;
      }
      // Enable only after init finished
      this._isEnabled = true;
      // Will show minimap according to camera bounds
      this.onCameraChange(false);
    } else {
      // Disable so that _setVisibility will hide the panel
      this._isEnabled = false;
      this._setVisibility(false, false);
    }
  }

  findAndSetSuitableModel() {
    const models = this.viewer.impl.modelQueue().getModels();

    if (models.length === 1 && models[0].is2d()) {
      const model = models[0];
      const node = model.getDocumentNode();
      const doc = node && node.getDocument();

      if (doc) {
        this.model = model;
        this.node = node;
        this.document = doc;

        return true;
      }
    }

    return false;
  }

  createPanel() {
    if (!this.panel) {
      this.panel = new _MinimapPanel_js__WEBPACK_IMPORTED_MODULE_2__["default"](this.viewer.container, 10, 10, { isMobile: this.isMobile, addFooter: false });
      this.panel.setGlobalManager(this.globalManager);
    }
  }

  /**
   * Creates the minimap extension's canvas.
   *
   * @private
   */
  createMinimapCanvas() {
    if (!this.minimapCanvas) {
      this.minimapCanvas = new _MinimapCanvas_js__WEBPACK_IMPORTED_MODULE_1__["default"](this.backgroundImgs || {}, this.modelWidth, this.modelHeight);
      this.minimapCanvas.setGlobalManager(this.globalManager);
    } else {
      // Just update the images
      this.minimapCanvas.backgroundImgs = this.backgroundImgs;
    }
  }

  setBoundariesFromModel() {
    this.modelBBox = this.model.getBoundingBox().clone();
    this.modelStartPoint = this.modelBBox.min;
    this.modelWidth = this.modelBBox.max.x - this.modelBBox.min.x;
    this.modelHeight = this.modelBBox.max.y - this.modelBBox.min.y;
    this.epsX = 0.02 * this.modelWidth;
    this.epsY = 0.02 * this.modelHeight;
  }

  /**
   * Initializing the minimap extension and getting the thumbnail.
   *
   * @private
   */
  async init() {
    this.mouseDown = false;
    this.mouseDownPos = { x: null, y: null };
    this.isTransitionInactive = true;

    if (!this.model) {
      return;
    }

    this.createPanel();
    this.setBoundariesFromModel();

    this.wasInit = true;
    const model = this.model; // Check that model hasn't changed during async operation (or that unload wasn't called)

    try {
      await this.prefetchThumbnails(['large']);

      if (model !== this.model || !this.viewer.impl) {// Check also that viewer wasn't unloaded in the meantime
        throw new Error('loadCanceled');
      }

      this.createMinimapCanvas();

      await this.minimapCanvas.setSize(this.getInitialSize());

      if (model !== this.model || !this.viewer.impl) {
        throw new Error('loadCanceled');
      }

      const modelData = this.model.getData();
      const hasToCheckThumbnail = !this.model.isLeaflet() && modelData.loadOptions.fileExt !== 'rvt';
      if (hasToCheckThumbnail && !_ThumbnailUtils_js__WEBPACK_IMPORTED_MODULE_3__["default"].isThumbnailValid(this.minimapCanvas.backgroundCanvas)) {
        console.error('Invalid thumbnail!');
      } else {
        this.panel.appendElement(this.minimapCanvas.canvasContainer);
      }
      this.addListeners();
    } catch (e) {
      console.info('Minimap init aborted: ', e.message);
      if (!this.minimapCanvas && e.message !== 'loadCanceled') {// Create mock canvas
        this.createMinimapCanvas();
        this.addListeners();
      }
    }
  }

  /**
   * Get's the minimap extension's initial size.
   *
   * @private
   */
  getInitialSize() {
    if (this.initialSize !== null) {
      return Math.min(Math.max(this.initialSize, MIN_SIZE), MAX_SIZE);
    }
    return this.isMobile ? _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_0__.thumbnailDefaultSizes['mobile'] : _MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_0__.thumbnailDefaultSizes['web'];
  }

  /**
   * Sets the minimap extension's canvas's size.
   *
   * @param {number} size - The minimap's canvas's size.
   * @private
   */
  setSize(size) {
    if (this.minimapCanvas) {
      size = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
      this.minimapCanvas.setSize(size);
    } else {
      this.initialSize = size;
    }
  }

  /**
   * @param {number} requestedSizes - The thumbnails's size.
   * @returns {Promise} Promises of fetching the thumbnails
   * @private
   */
  prefetchThumbnails(requestedSizes) {
    this.backgroundImgs = {};
    const requests = requestedSizes.map((val) => (0,_MinimapThumbnail_js__WEBPACK_IMPORTED_MODULE_0__.fetchThumbnail)(this.document, this.node, val, this.backgroundImgs));
    return Promise.all(requests);
  }

  /**
   * @alias Autodesk.Viewing.Extensions.MinimapExtension#_isTouch
   * @returns {boolean} True is it is a touch device
   * @private
   */
  _isTouch() {
    return Autodesk.Viewing.isTouchDevice();
  }

  /**
   * Addes listeners to user interactions and camera changes
   *
   * @private
   */
  addListeners() {
    if (this._isTouch()) {
      this.minimapCanvas.addListenerToCanvas('touchstart', this.onMouseDown);
      this.minimapCanvas.addListenerToCanvas('touchmove', this.onMouseMove);
      this.minimapCanvas.addListenerToCanvas('touchend', this.onMouseUp);
    }

    if (!this.isMobile) {
      this.minimapCanvas.addListenerToCanvas('mousedown', this.onMouseDown);
      this.minimapCanvas.addListenerToCanvas('mousemove', this.onMouseMove);
      this.minimapCanvas.addListenerToCanvas('mouseup', this.onMouseUp);

      this.minimapCanvas.addListenerToCanvas('mouseleave', this.onMouseLeave);
      this.minimapCanvas.addListenerToCanvas('mousewheel', this.onMouseWheel);
      this.minimapCanvas.addListenerToCanvas('DOMMouseScroll', this.onMouseWheel); // firefox
    }

    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);
    this.panel.addListenerToCloseButton(this.onCloseButton);
  }

  /**
   * @private
   */
  onCloseButton() {
    this.viewer.prefs.set(SETTINGS_PROP, false);
    this.setEnabled(false);
  }

  /**
   * @param {Event} event - Mouse / Touch event.
   * @returns {object} returns an object with x and y coordinates.
   * @private
   */
  getCursorPositionOnCanvas(event) {
    const rect = this.minimapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x: x, y: y };
  }

  onMouseDown(e) {
    if (e.type === 'touchstart') {
      e.clientX = e.touches[0].clientX;
      e.clientY = e.touches[0].clientY;
    }
    this.mouseDown = true;
    this.mouseDownPos.x = e.clientX;
    this.mouseDownPos.y = e.clientY;
    this.onMinimapClicked(e, false);
    this.isTransitionInactive = false;
  }

  onMouseMove(e) {
    if (!this.mouseDown) {
      return;
    }
    if (e.type === 'touchmove') {
      e.clientX = e.touches[0].clientX;
      e.clientY = e.touches[0].clientY;
    }

    if (this.isTransitionInactive || Math.abs(this.mouseDownPos.x - e.clientX) > 5 || Math.abs(this.mouseDownPos.y - e.clientY) > 5) {
      if (this.viewer.autocam.elapsedTime !== undefined) {
        this.viewer.autocam.elapsedTime = this.viewer.autocam.shotParams.duration;
        this.isTransitionInactive = true;
      }

      this.onMinimapClicked(e, true);
    }
  }

  onMouseWheel(e) {
    // Propagate mouse wheel event to viewer
    this.viewer.toolController.mousewheel(e);
  }

  onMouseUp() {
    this.resetMove();
  }

  onMouseLeave() {
    this.resetMove();
  }

  /**
   * @private
   */
  resetMove() {
    this.mouseDown = false;
    this.mouseDownPos.x = null;
    this.mouseDownPos.y = null;
  }

  /**
   * @private
   * @param {event} e the mouse/touch event
   * @param {boolean} isImmediate whether the transition has to be done immediately or with a transition
   */
  onMinimapClicked(e, isImmediate) {
    const clickedCoords = this.minimapToModelCoords(this.getCursorPositionOnCanvas(e));

    const oldTarget = this.viewer.navigation.getTarget();
    const oldPos = this.viewer.navigation.getPosition();
    const eye = oldTarget.clone().sub(oldPos);

    const newPos = new THREE.Vector3(clickedCoords.x, clickedCoords.y, oldPos.z);
    const newTarget = newPos.clone().add(eye);

    if (isImmediate) {
      this.viewer.navigation.setView(newPos, newTarget);
    } else {
      this.viewer.navigation.setRequestTransitionWithUp(true, newPos, newTarget, this.viewer.impl.camera.fov, this.viewer.impl.camera.up);
    }
    this.viewer.navigation.setPivotPoint(newTarget);
    this.viewer.navigation.setPivotSetFlag(true);
  }

  highlightCurrentArea(bottomLeft, topRight) {
    this.minimapCanvas.drawHighlight(bottomLeft, topRight);
  }

  /**
   * @private
   * @param {object} position Position in model coordinates
   * @returns {object} The position in minimap coordinates
   */
  modelToMinimapCoords(position) {
    // Canvas starts from top left, with x growing rightwards, and y growing downwards
    return {
      x: (position.x - this.modelStartPoint.x) * this.minimapCanvas.width / this.modelWidth,
      y: -(position.y - this.modelStartPoint.y - this.modelHeight) * this.minimapCanvas.height / this.modelHeight
    };
  }

  /**
   * @private
   * @param {object} position Position in minimap caretCoordinates
   * @returns {object} The position in model coordinates
   */
  minimapToModelCoords(position) {
    return {
      x: position.x * this.modelWidth / this.minimapCanvas.width + this.modelStartPoint.x,
      y: -(position.y * this.modelHeight / this.minimapCanvas.height) + this.modelHeight + this.modelStartPoint.y
    };
  }

  /**
   * @private
   * @param {boolean} isVisible Change the visibility of the minimap
   * @param {boolean} withTransition Change the visibility with / without a transition
   */
  _setVisibility(isVisible, withTransition) {
    if (this.panel) {
      this.panel.setVisible(this._isEnabled && isVisible, withTransition);
    }
  }

  /**
   * Gets the area of the document currently in view
   *
   * @private
   */
  getViewableArea() {
    let bounds = this.modelBBox.clone();
    const left = this.viewer.impl.camera.left + this.viewer.impl.camera.position.x;
    const right = this.viewer.impl.camera.right + this.viewer.impl.camera.position.x;
    const bottom = this.viewer.impl.camera.bottom + this.viewer.impl.camera.position.y;
    const top = this.viewer.impl.camera.top + this.viewer.impl.camera.position.y;
    if (left > bounds.min.x + this.epsX) {
      bounds.min.x = left;
    }
    if (right < bounds.max.x - this.epsX) {
      bounds.max.x = right;
    }
    if (bottom > bounds.min.y + this.epsY) {
      bounds.min.y = bottom;
    }
    if (top < bounds.max.y - this.epsY) {
      bounds.max.y = top;
    }

    return bounds;
  }

  /**
   * Adding the option to enable/disable the extension in the settings by adding a check box.
   *
   * @private
   */
  updateSettingsPanel() {
    let settingsPanel = this.viewer.getSettingsPanel && this.viewer.getSettingsPanel();

    if (!settingsPanel || settingsPanel.is3dMode || settingsPanel.minimapSettingsCheckboxId)
    return;

    const navTab = Autodesk.Viewing.Extensions.ViewerSettingTab.Navigation;

    settingsPanel.minimapSettingsLabel = settingsPanel.addLabel(navTab, "Minimap");
    settingsPanel.minimapSettingsCheckboxId = settingsPanel.addCheckbox(
      navTab,
      'Show minimap',
      'Toggles availability of the Minimap',
      true,
      this.setEnabled,
      SETTINGS_PROP
    );
  }

  /**
   * Load the minimap extension.
   *
   * @returns {boolean} True if minimap extension is loaded successfully.
   * @alias Autodesk.Viewing.Extensions.MinimapExtension#load
   * @public
   */
  load() {
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.update);
    this.viewer.addEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.update);
    this.viewer.addEventListener(Autodesk.Viewing.SETTINGS_PANEL_CREATED_EVENT, this.updateSettingsPanel);

    this.viewer.prefs.add(SETTINGS_PROP, true, '2d');
    this.updateSettingsPanel();

    this.update();

    return true;
  }

  /**
   * Unload the minimap extension.
   *
   * @returns {boolean} True if minimap extension is unloaded successfully.
   *
   * @alias Autodesk.Viewing.Extensions.MinimapExtension#unload
   * @public
   */
  unload() {
    if (this.minimapCanvas) {
      if (this._isTouch()) {
        this.minimapCanvas.removeListenerFromCanvas('touchstart', this.onMouseDown);
        this.minimapCanvas.removeListenerFromCanvas('touchmove', this.onMouseMove);
        this.minimapCanvas.removeListenerFromCanvas('touchend', this.onMouseUp);
      }

      if (!this.isMobile) {
        this.minimapCanvas.removeListenerFromCanvas('mousedown', this.onMouseDown);
        this.minimapCanvas.removeListenerFromCanvas('mousemove', this.onMouseMove);
        this.minimapCanvas.removeListenerFromCanvas('mouseup', this.onMouseUp);

        this.minimapCanvas.removeListenerFromCanvas('mouseleave', this.onMouseLeave);
        this.minimapCanvas.removeListenerFromCanvas('mousewheel', this.onMouseWheel);
        this.minimapCanvas.removeListenerFromCanvas('DOMMouseScroll', this.onMouseWheel); // firefox
      }

      this.minimapCanvas.unload();
      this.minimapCanvas = null;
    }
    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);

    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.update);
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.update);
    this.viewer.removeEventListener(Autodesk.Viewing.SETTINGS_PANEL_CREATED_EVENT, this.updateSettingsPanel);

    this.destroyUI();
    this.model = null;
    this.document = null;
    this.node = null;

    return true;
  }

  update() {
    this.wasInit = false;
    if (this.findAndSetSuitableModel()) {
      this.setEnabled(this.viewer.prefs && this.viewer.prefs.get(SETTINGS_PROP));
    } else {
      this.setEnabled(false);
    }
  }

  /**
   * Occurs when camera changes
   *
   * @alias Autodesk.Viewing.Extensions.MinimapExtension#onCameraChange
   * @param {boolean} withTransition - True if cameara changed with a transition.
   * @public
   */
  onCameraChange(withTransition) {
    const bounds = this.getViewableArea();
    const isVisible = !bounds.equals(this.modelBBox);
    this._setVisibility(isVisible, withTransition);
    if (isVisible && this.minimapCanvas) {
      this.highlightCurrentArea(this.modelToMinimapCoords(bounds.min), this.modelToMinimapCoords(bounds.max));
    }
  }

  /**
   * Destroys minimap's UI
   *
   * @alias Autodesk.Viewing.Extensions.MinimapExtension#destroyUI
   * @public
   */
  destroyUI() {
    let settingsPanel = this.viewer.getSettingsPanel && this.viewer.getSettingsPanel();
    if (settingsPanel && settingsPanel.minimapSettingsCheckboxId) {
      this.viewer.viewerSettingsPanel.removeCheckbox(settingsPanel.minimapSettingsCheckboxId);
      this.viewer.viewerSettingsPanel.removeControl(settingsPanel.minimapSettingsLabel);
      settingsPanel.minimapSettingsLabel = null;
      settingsPanel.minimapSettingsCheckboxId = null;
    }

    if (this.panel) {
      this.panel.uninitialize();
      this.panel = null;
    }
  }
}

namespace.MinimapExtension = MinimapExtension;
Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.BIM360.Minimap', MinimapExtension);
})();

Autodesk.Extensions.Minimap2D = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Minimap2D.js.map