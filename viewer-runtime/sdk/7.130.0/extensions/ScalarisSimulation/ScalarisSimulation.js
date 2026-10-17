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

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ScalarisSimulation/ScalarisSimulation.css"
/*!**************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ScalarisSimulation/ScalarisSimulation.css ***!
  \**************************************************************************************************************************************************************************************************************************************************************************/
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAAIVBMVEUAAADy8vLq6urg4eTFytS8ws60u8nX2d7O0tnO0djX2t8Cek8BAAAAAXRSTlMAQObYZgAAAHFJREFUGNONzb0JgDAQhmFHOP9tzQaSCYQsYJEBbK63OnACU9rFCVzTs/iEgIJv91ZP9rf8DlMYY/rXKa21A6YVWRdMF0LcMZVzbsTU3vsJ0zDz/KCI4BgtHaBWI6AichLQLR6BgDqNgHqNgLJGKfrdBQMqIVD88IvJAAAAAElFTkSuQmCC */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAAIVBMVEUAAADy8vLq6urg4eTFytS8ws60u8nX2d7O0tnO0djX2t8Cek8BAAAAAXRSTlMAQObYZgAAAHFJREFUGNONzb0JgDAQhmFHOP9tzQaSCYQsYJEBbK63OnACU9rFCVzTs/iEgIJv91ZP9rf8DlMYY/rXKa21A6YVWRdMF0LcMZVzbsTU3vsJ0zDz/KCI4BgtHaBWI6AichLQLR6BgDqNgHqNgLJGKfrdBQMqIVD88IvJAAAAAElFTkSuQmCC"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAASFBMVEUAAADy8vLy8vLy8vJ/+3B3+Z3Y61H8vyT53T7+oQp1986r8mBy8vv+iA91989ryftqyPtjn/us82Gr8mF4+p2s8mH6cif7cicZkx5RAAAAA3RSTlMA9uuPSLkVAAAAn0lEQVQoz63QSw7DIAwE0CTYBgzkA/3c/6adpEJKIasqI7GZJwvwcGtMzdjCtsZZmdm0sETURNRBnFGHp3Sg6IuI6wADWZy1HTAF9N5fgvUpXYA4wKuDn4zjNE3txDt564TYtHckgIQzlO+rPAbOoBg5/mHRF2KtcGxk/7kTyUQ8m3ZXksPexwpr3S4Os8a1woa9Kz/Y4KjGZavQZ/gnH1ycB4VVIzRSAAAAAElFTkSuQmCC */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAASFBMVEUAAADy8vLy8vLy8vJ/+3B3+Z3Y61H8vyT53T7+oQp1986r8mBy8vv+iA91989ryftqyPtjn/us82Gr8mF4+p2s8mH6cif7cicZkx5RAAAAA3RSTlMA9uuPSLkVAAAAn0lEQVQoz63QSw7DIAwE0CTYBgzkA/3c/6adpEJKIasqI7GZJwvwcGtMzdjCtsZZmdm0sETURNRBnFGHp3Sg6IuI6wADWZy1HTAF9N5fgvUpXYA4wKuDn4zjNE3txDt564TYtHckgIQzlO+rPAbOoBg5/mHRF2KtcGxk/7kTyUQ8m3ZXksPexwpr3S4Os8a1woa9Kz/Y4KjGZavQZ/gnH1ycB4VVIzRSAAAAAElFTkSuQmCC"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_2___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAeFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////y8vJ3+p1/+3Cr82B198/8vyT53T7+oQrZ61HY6lFy8vv+iA9ryftqyPtjn/v////6cid09s77cie/h+lKAAAAFXRSTlMA+XApC+re0r2VWUsixbWloXRrQBf0begMAAAAyklEQVQoz53R2Q6CMBAF0GFRQXGX0r1s6v//ocMULMqL8SYlcE9amhZ+zDVK8bmJl7LaAdz6hN7Ld/DjmANs1+Cha50QjDEEKk/5CI3DuqqqAdIooeUInMCaczsAZOckSkeg3hhFEGfxAQJwq6QkKKL9ZQLfa00Am76YgZG6rhF8AhiFcF/AMt8znrWWylYsALf0jxrB8A8wtCs9TJiB8CJL6XsxAxSrSmVxoQDhrAyn3k3Quoc/XRwM+3aCrhnvA4cQrukmWAb+yQsyihxX5vJMsQAAAABJRU5ErkJggg== */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAeFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////y8vJ3+p1/+3Cr82B198/8vyT53T7+oQrZ61HY6lFy8vv+iA9ryftqyPtjn/v////6cid09s77cie/h+lKAAAAFXRSTlMA+XApC+re0r2VWUsixbWloXRrQBf0begMAAAAyklEQVQoz53R2Q6CMBAF0GFRQXGX0r1s6v//ocMULMqL8SYlcE9amhZ+zDVK8bmJl7LaAdz6hN7Ld/DjmANs1+Cha50QjDEEKk/5CI3DuqqqAdIooeUInMCaczsAZOckSkeg3hhFEGfxAQJwq6QkKKL9ZQLfa00Am76YgZG6rhF8AhiFcF/AMt8znrWWylYsALf0jxrB8A8wtCs9TJiB8CJL6XsxAxSrSmVxoQDhrAyn3k3Quoc/XRwM+3aCrhnvA4cQrukmWAb+yQsyihxX5vJMsQAAAABJRU5ErkJggg=="), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_3___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAATlBMVEUAAAD////////////////////////y8vJ3+p1/+3DY61F198/8vySr8mD+oQr53T9y8ftryfus82H9iA/53D7+iA9jn/v7cidz8vtz8fu6p5NCAAAAB3RSTlMATP3tEI4Bd24LZQAAAKpJREFUKM+dkd0OwjAIRv2pUiilrls3ff8XFVfD3DoT43fVnJNCgMPPOZ40lz1xtidYtmLs7iF47xvR3RQjIlgPV4VyxJjp/cM5d61i5kRDU0pFpsTcCI9RuciuYOl7MGSCBpYyNaLN8iNpqQmmXngg9LDqUQoUFRTXQpsIiHD6FEHNPAdXHqqwyRMkooyLWHZFOb74DbbbRcXKO7B7POo9vGLlI3wf8J88AQnTC+OPTK0hAAAAAElFTkSuQmCC */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAATlBMVEUAAAD////////////////////////y8vJ3+p1/+3DY61F198/8vySr8mD+oQr53T9y8ftryfus82H9iA/53D7+iA9jn/v7cidz8vtz8fu6p5NCAAAAB3RSTlMATP3tEI4Bd24LZQAAAKpJREFUKM+dkd0OwjAIRv2pUiilrls3ff8XFVfD3DoT43fVnJNCgMPPOZ40lz1xtidYtmLs7iF47xvR3RQjIlgPV4VyxJjp/cM5d61i5kRDU0pFpsTcCI9RuciuYOl7MGSCBpYyNaLN8iNpqQmmXngg9LDqUQoUFRTXQpsIiHD6FEHNPAdXHqqwyRMkooyLWHZFOb74DbbbRcXKO7B7POo9vGLlI3wf8J88AQnTC+OPTK0hAAAAAElFTkSuQmCC"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_4___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAMAAABFjsb+AAAAQlBMVEUAAAD///8AsDQAqmcfqBM5nhpTkyEApJsFswyHfi9tiCgAns8Am+ihczYGsw0Fsw27aTxUkyLVXkO8aT2idDahdDYBsfjeAAAAAXRSTlMAQObYZgAAAJBJREFUGNNl0FkOhCAQBFB7wwYFdJb7X3UKJjFtrM+XSnpZ6MpyhfZ9W0WYo4EgrUcb5KoabZJZutmglEo01CyVnG+G2plrjcZNUfsc0Z5Bz0evHvR613KaM0waxub6paPmkrQzhbkZZNoFtnL771cGOU8T7vOOZGixrBTuNdXGArv+4uTeB20U/sdTth32zA+qLgW6ibQIVwAAAABJRU5ErkJggg== */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAMAAABFjsb+AAAAQlBMVEUAAAD///8AsDQAqmcfqBM5nhpTkyEApJsFswyHfi9tiCgAns8Am+ihczYGsw0Fsw27aTxUkyLVXkO8aT2idDahdDYBsfjeAAAAAXRSTlMAQObYZgAAAJBJREFUGNNl0FkOhCAQBFB7wwYFdJb7X3UKJjFtrM+XSnpZ6MpyhfZ9W0WYo4EgrUcb5KoabZJZutmglEo01CyVnG+G2plrjcZNUfsc0Z5Bz0evHvR613KaM0waxub6paPmkrQzhbkZZNoFtnL771cGOU8T7vOOZGixrBTuNdXGArv+4uTeB20U/sdTth32zA+qLgW6ibQIVwAAAABJRU5ErkJggg=="), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);
var ___CSS_LOADER_URL_REPLACEMENT_2___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_2___);
var ___CSS_LOADER_URL_REPLACEMENT_3___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_3___);
var ___CSS_LOADER_URL_REPLACEMENT_4___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_4___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `/*! © 2018 Autodesk Inc. All rights reserved */
.adsk-legend-container {
  top: 370px;
  right: 20px;
  height: calc(100% - 400px);
  position: absolute;
  min-height: 100px;
}

.adsk-legend-title {
  height: 20px;
  font-size: 12px;
  font-weight: bold;
  color: #0c0e10;
}

.adsk-legend-title:hover > .adsk-legend-title-tooltip {
  display: block;
}

.adsk-legend-title-tooltip {
  width: 200px;
  position: absolute;
  right: 0;
  border-radius: 3px;
  padding: 4px;
  text-align: left;
  font-size: 11px;
  font-weight: initial;
  line-height: 1.2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transform: translate(0, calc(-100% - 20px));
  color: #f4f4f4;
  background: #4a4a4a;
  display: none;
}

.adsk-legend-scale-container {
  position: relative;
  height: calc(100% - 80px);
  margin-left: 36px;
}

.adsk-legend-container.fos-enabled .adsk-legend-color-scale {
  background: linear-gradient(to bottom, #009BE8, #00B50B, #FC4E4E);
  margin: 0 11px 0 4px;
}

.adsk-legend-container.fos-enabled .adsk-legend-max-label {
  color: #009BE8;
}

.adsk-legend-container.fos-enabled .adsk-legend-min-label {
  color: #FC4E4E;
}

.adsk-legend-color-scale {
  position: relative;
  display: inline-block;
  background: linear-gradient(to bottom, #FC4E4E, #00B50B, #009BE8);
  width: 20px;
  height: calc(100% + 6px);
}

.adsk-legend-tooltip {
  display: none;
  position: absolute;
  right: 28px;
  transform: translate(0, -60%);
  pointer-events: none;
  border: 1px solid #9B9B9B;
  border-radius: 4px;
  width: 152px;
}

.adsk-legend-tooltip-box {
  flex-grow: 1;
  display: flex;
  overflow: hidden;
}

.adsk-legend-tooltip-min-fos {
  font-size: 14px;
  right: 30px;
}

.adsk-legend-tooltip-text {
  flex-grow: 1;
  padding: 10px;
  background-color: #9B9B9B;
  color: #FFFFFF;
  font-size: 11px;
}

.adsk-legend-tooltip-title {
  font-size: 16px;
}

.adsk-legend-tooltip-highlight {
  color: #FFFFFF;
  font-size: 20px;
}

.adsk-legend-tooltip-value {
  line-height: 1.5;
}

.adsk-legend-tooltip-bar {
  width: 10px;
  flex-shrink: 0;
  background-color: black;
}

.adsk-legend-tooltip-arrow {
  display: inline-block;
  position: relative;
}

.adsk-legend-tooltip-arrow:after,
.adsk-legend-tooltip-arrow:before {
  content: "";
  display: block;
  position: absolute;
  left: 100%;
  width: 0;
  height: 0;
  border-style: solid;
}

.adsk-legend-tooltip-arrow:after {
  border-color: transparent transparent transparent red;
  border-width: 8px;
  top: 50%;
  margin-top: -8px;
}

.adsk-legend-tooltip-arrow:before {
  border-color: transparent transparent transparent #9B9B9B;
  border-width: 9px;
  top: 50%;
  margin-top: -9px;
}

.adsk-legend-color-scale:hover .adsk-legend-tooltip {
  display: flex;
}

.adsk-legend-tooltip.adsk-legend-tooltip-active {
  display: flex;
}

.adsk-legend-label-container {
  display: inline-block;
  height: 100%;
  position: relative;
}

.adsk-legend-min-label {
  text-align: right;
  font-size: 14px;
  white-space: nowrap;
  color: #009BE8;
}

.adsk-legend-max-label {
  height: calc(100% - 20px);
  text-align: right;
  font-size: 14px;
  white-space: nowrap;
  color: #FC4E4E;
}

.adsk-legend-title-container {
  display: inline-block;
  height: 100%;
  position: relative;
}

.adsk-legend-min-title {
  margin-left: 5px;
  font-size: 14px;
  color: #009BE8;
}

.adsk-legend-mid-title {
  height: 50%;
  margin-left: 5px;
  font-size: 14px;
  color: #00B50B;
}

.adsk-legend-max-title {
  height: 50%;
  margin-left: 5px;
  font-size: 14px;
  color: #FC4E4E;
}

.adsk-legend-container.fos-enabled .adsk-legend-max-title {
  visibility: hidden;
}

.adsk-legend-container.fos-enabled .adsk-legend-mid-title {
  visibility: hidden;
}

.adsk-legend-container.fos-enabled .adsk-legend-min-title {
  visibility: hidden;
}

.adsk-toolbar-view-modelIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
}

.adsk-toolbar-analysis-displayIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});
}

.adsk-toolbar-view-stressIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});
}

.adsk-toolbar-view-fosIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_3___});
}

.adsk-toolbar-view-stress-referenceIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_4___});
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

/***/ "./extensions/ScalarisSimulation/ScalarisSimulation.css"
/*!**************************************************************!*\
  !*** ./extensions/ScalarisSimulation/ScalarisSimulation.css ***!
  \**************************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ScalarisSimulation_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./ScalarisSimulation.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ScalarisSimulation/ScalarisSimulation.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ScalarisSimulation_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ScalarisSimulation_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ScalarisSimulation_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ScalarisSimulation_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAMAAABFjsb+AAAAQlBMVEUAAAD///8AsDQAqmcfqBM5nhpTkyEApJsFswyHfi9tiCgAns8Am+ihczYGsw0Fsw27aTxUkyLVXkO8aT2idDahdDYBsfjeAAAAAXRSTlMAQObYZgAAAJBJREFUGNNl0FkOhCAQBFB7wwYFdJb7X3UKJjFtrM+XSnpZ6MpyhfZ9W0WYo4EgrUcb5KoabZJZutmglEo01CyVnG+G2plrjcZNUfsc0Z5Bz0evHvR613KaM0waxub6paPmkrQzhbkZZNoFtnL771cGOU8T7vOOZGixrBTuNdXGArv+4uTeB20U/sdTth32zA+qLgW6ibQIVwAAAABJRU5ErkJggg=="
/*!**************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAMAAABFjsb+AAAAQlBMVEUAAAD///8AsDQAqmcfqBM5nhpTkyEApJsFswyHfi9tiCgAns8Am+ihczYGsw0Fsw27aTxUkyLVXkO8aT2idDahdDYBsfjeAAAAAXRSTlMAQObYZgAAAJBJREFUGNNl0FkOhCAQBFB7wwYFdJb7X3UKJjFtrM+XSnpZ6MpyhfZ9W0WYo4EgrUcb5KoabZJZutmglEo01CyVnG+G2plrjcZNUfsc0Z5Bz0evHvR613KaM0waxub6paPmkrQzhbkZZNoFtnL771cGOU8T7vOOZGixrBTuNdXGArv+4uTeB20U/sdTth32zA+qLgW6ibQIVwAAAABJRU5ErkJggg== ***!
  \**************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAMAAABFjsb+AAAAQlBMVEUAAAD///8AsDQAqmcfqBM5nhpTkyEApJsFswyHfi9tiCgAns8Am+ihczYGsw0Fsw27aTxUkyLVXkO8aT2idDahdDYBsfjeAAAAAXRSTlMAQObYZgAAAJBJREFUGNNl0FkOhCAQBFB7wwYFdJb7X3UKJjFtrM+XSnpZ6MpyhfZ9W0WYo4EgrUcb5KoabZJZutmglEo01CyVnG+G2plrjcZNUfsc0Z5Bz0evHvR613KaM0waxub6paPmkrQzhbkZZNoFtnL771cGOU8T7vOOZGixrBTuNdXGArv+4uTeB20U/sdTth32zA+qLgW6ibQIVwAAAABJRU5ErkJggg==";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAAIVBMVEUAAADy8vLq6urg4eTFytS8ws60u8nX2d7O0tnO0djX2t8Cek8BAAAAAXRSTlMAQObYZgAAAHFJREFUGNONzb0JgDAQhmFHOP9tzQaSCYQsYJEBbK63OnACU9rFCVzTs/iEgIJv91ZP9rf8DlMYY/rXKa21A6YVWRdMF0LcMZVzbsTU3vsJ0zDz/KCI4BgtHaBWI6AichLQLR6BgDqNgHqNgLJGKfrdBQMqIVD88IvJAAAAAElFTkSuQmCC"
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAAIVBMVEUAAADy8vLq6urg4eTFytS8ws60u8nX2d7O0tnO0djX2t8Cek8BAAAAAXRSTlMAQObYZgAAAHFJREFUGNONzb0JgDAQhmFHOP9tzQaSCYQsYJEBbK63OnACU9rFCVzTs/iEgIJv91ZP9rf8DlMYY/rXKa21A6YVWRdMF0LcMZVzbsTU3vsJ0zDz/KCI4BgtHaBWI6AichLQLR6BgDqNgHqNgLJGKfrdBQMqIVD88IvJAAAAAElFTkSuQmCC ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYBAMAAAASWSDLAAAAIVBMVEUAAADy8vLq6urg4eTFytS8ws60u8nX2d7O0tnO0djX2t8Cek8BAAAAAXRSTlMAQObYZgAAAHFJREFUGNONzb0JgDAQhmFHOP9tzQaSCYQsYJEBbK63OnACU9rFCVzTs/iEgIJv91ZP9rf8DlMYY/rXKa21A6YVWRdMF0LcMZVzbsTU3vsJ0zDz/KCI4BgtHaBWI6AichLQLR6BgDqNgHqNgLJGKfrdBQMqIVD88IvJAAAAAElFTkSuQmCC";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAASFBMVEUAAADy8vLy8vLy8vJ/+3B3+Z3Y61H8vyT53T7+oQp1986r8mBy8vv+iA91989ryftqyPtjn/us82Gr8mF4+p2s8mH6cif7cicZkx5RAAAAA3RSTlMA9uuPSLkVAAAAn0lEQVQoz63QSw7DIAwE0CTYBgzkA/3c/6adpEJKIasqI7GZJwvwcGtMzdjCtsZZmdm0sETURNRBnFGHp3Sg6IuI6wADWZy1HTAF9N5fgvUpXYA4wKuDn4zjNE3txDt564TYtHckgIQzlO+rPAbOoBg5/mHRF2KtcGxk/7kTyUQ8m3ZXksPexwpr3S4Os8a1woa9Kz/Y4KjGZavQZ/gnH1ycB4VVIzRSAAAAAElFTkSuQmCC"
/*!******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAASFBMVEUAAADy8vLy8vLy8vJ/+3B3+Z3Y61H8vyT53T7+oQp1986r8mBy8vv+iA91989ryftqyPtjn/us82Gr8mF4+p2s8mH6cif7cicZkx5RAAAAA3RSTlMA9uuPSLkVAAAAn0lEQVQoz63QSw7DIAwE0CTYBgzkA/3c/6adpEJKIasqI7GZJwvwcGtMzdjCtsZZmdm0sETURNRBnFGHp3Sg6IuI6wADWZy1HTAF9N5fgvUpXYA4wKuDn4zjNE3txDt564TYtHckgIQzlO+rPAbOoBg5/mHRF2KtcGxk/7kTyUQ8m3ZXksPexwpr3S4Os8a1woa9Kz/Y4KjGZavQZ/gnH1ycB4VVIzRSAAAAAElFTkSuQmCC ***!
  \******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAASFBMVEUAAADy8vLy8vLy8vJ/+3B3+Z3Y61H8vyT53T7+oQp1986r8mBy8vv+iA91989ryftqyPtjn/us82Gr8mF4+p2s8mH6cif7cicZkx5RAAAAA3RSTlMA9uuPSLkVAAAAn0lEQVQoz63QSw7DIAwE0CTYBgzkA/3c/6adpEJKIasqI7GZJwvwcGtMzdjCtsZZmdm0sETURNRBnFGHp3Sg6IuI6wADWZy1HTAF9N5fgvUpXYA4wKuDn4zjNE3txDt564TYtHckgIQzlO+rPAbOoBg5/mHRF2KtcGxk/7kTyUQ8m3ZXksPexwpr3S4Os8a1woa9Kz/Y4KjGZavQZ/gnH1ycB4VVIzRSAAAAAElFTkSuQmCC";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAATlBMVEUAAAD////////////////////////y8vJ3+p1/+3DY61F198/8vySr8mD+oQr53T9y8ftryfus82H9iA/53D7+iA9jn/v7cidz8vtz8fu6p5NCAAAAB3RSTlMATP3tEI4Bd24LZQAAAKpJREFUKM+dkd0OwjAIRv2pUiilrls3ff8XFVfD3DoT43fVnJNCgMPPOZ40lz1xtidYtmLs7iF47xvR3RQjIlgPV4VyxJjp/cM5d61i5kRDU0pFpsTcCI9RuciuYOl7MGSCBpYyNaLN8iNpqQmmXngg9LDqUQoUFRTXQpsIiHD6FEHNPAdXHqqwyRMkooyLWHZFOb74DbbbRcXKO7B7POo9vGLlI3wf8J88AQnTC+OPTK0hAAAAAElFTkSuQmCC"
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAATlBMVEUAAAD////////////////////////y8vJ3+p1/+3DY61F198/8vySr8mD+oQr53T9y8ftryfus82H9iA/53D7+iA9jn/v7cidz8vtz8fu6p5NCAAAAB3RSTlMATP3tEI4Bd24LZQAAAKpJREFUKM+dkd0OwjAIRv2pUiilrls3ff8XFVfD3DoT43fVnJNCgMPPOZ40lz1xtidYtmLs7iF47xvR3RQjIlgPV4VyxJjp/cM5d61i5kRDU0pFpsTcCI9RuciuYOl7MGSCBpYyNaLN8iNpqQmmXngg9LDqUQoUFRTXQpsIiHD6FEHNPAdXHqqwyRMkooyLWHZFOb74DbbbRcXKO7B7POo9vGLlI3wf8J88AQnTC+OPTK0hAAAAAElFTkSuQmCC ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAATlBMVEUAAAD////////////////////////y8vJ3+p1/+3DY61F198/8vySr8mD+oQr53T9y8ftryfus82H9iA/53D7+iA9jn/v7cidz8vtz8fu6p5NCAAAAB3RSTlMATP3tEI4Bd24LZQAAAKpJREFUKM+dkd0OwjAIRv2pUiilrls3ff8XFVfD3DoT43fVnJNCgMPPOZ40lz1xtidYtmLs7iF47xvR3RQjIlgPV4VyxJjp/cM5d61i5kRDU0pFpsTcCI9RuciuYOl7MGSCBpYyNaLN8iNpqQmmXngg9LDqUQoUFRTXQpsIiHD6FEHNPAdXHqqwyRMkooyLWHZFOb74DbbbRcXKO7B7POo9vGLlI3wf8J88AQnTC+OPTK0hAAAAAElFTkSuQmCC";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAeFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////y8vJ3+p1/+3Cr82B198/8vyT53T7+oQrZ61HY6lFy8vv+iA9ryftqyPtjn/v////6cid09s77cie/h+lKAAAAFXRSTlMA+XApC+re0r2VWUsixbWloXRrQBf0begMAAAAyklEQVQoz53R2Q6CMBAF0GFRQXGX0r1s6v//ocMULMqL8SYlcE9amhZ+zDVK8bmJl7LaAdz6hN7Ld/DjmANs1+Cha50QjDEEKk/5CI3DuqqqAdIooeUInMCaczsAZOckSkeg3hhFEGfxAQJwq6QkKKL9ZQLfa00Am76YgZG6rhF8AhiFcF/AMt8znrWWylYsALf0jxrB8A8wtCs9TJiB8CJL6XsxAxSrSmVxoQDhrAyn3k3Quoc/XRwM+3aCrhnvA4cQrukmWAb+yQsyihxX5vJMsQAAAABJRU5ErkJggg=="
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAeFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////y8vJ3+p1/+3Cr82B198/8vyT53T7+oQrZ61HY6lFy8vv+iA9ryftqyPtjn/v////6cid09s77cie/h+lKAAAAFXRSTlMA+XApC+re0r2VWUsixbWloXRrQBf0begMAAAAyklEQVQoz53R2Q6CMBAF0GFRQXGX0r1s6v//ocMULMqL8SYlcE9amhZ+zDVK8bmJl7LaAdz6hN7Ld/DjmANs1+Cha50QjDEEKk/5CI3DuqqqAdIooeUInMCaczsAZOckSkeg3hhFEGfxAQJwq6QkKKL9ZQLfa00Am76YgZG6rhF8AhiFcF/AMt8znrWWylYsALf0jxrB8A8wtCs9TJiB8CJL6XsxAxSrSmVxoQDhrAyn3k3Quoc/XRwM+3aCrhnvA4cQrukmWAb+yQsyihxX5vJMsQAAAABJRU5ErkJggg== ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAeFBMVEUAAAD////////////////////////////////////////////////////////////////////////////////y8vJ3+p1/+3Cr82B198/8vyT53T7+oQrZ61HY6lFy8vv+iA9ryftqyPtjn/v////6cid09s77cie/h+lKAAAAFXRSTlMA+XApC+re0r2VWUsixbWloXRrQBf0begMAAAAyklEQVQoz53R2Q6CMBAF0GFRQXGX0r1s6v//ocMULMqL8SYlcE9amhZ+zDVK8bmJl7LaAdz6hN7Ld/DjmANs1+Cha50QjDEEKk/5CI3DuqqqAdIooeUInMCaczsAZOckSkeg3hhFEGfxAQJwq6QkKKL9ZQLfa00Am76YgZG6rhF8AhiFcF/AMt8znrWWylYsALf0jxrB8A8wtCs9TJiB8CJL6XsxAxSrSmVxoQDhrAyn3k3Quoc/XRwM+3aCrhnvA4cQrukmWAb+yQsyihxX5vJMsQAAAABJRU5ErkJggg==";

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
/******/ 			"ScalarisSimulation": 0
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
/*!*************************************************************!*\
  !*** ./extensions/ScalarisSimulation/ScalarisSimulation.js ***!
  \*************************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ScalarisSimulation: () => (/* binding */ ScalarisSimulation)
/* harmony export */ });
/* harmony import */ var _ScalarisSimulation_css__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ScalarisSimulation.css */ "./extensions/ScalarisSimulation/ScalarisSimulation.css");
/* harmony import */ var _src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../src/application/LoggingUtils.js */ "./src/application/LoggingUtils.js");
 // IMPORTANT!!


/*! @preserve © 2018 Autodesk Inc. All rights reserved */
/*
 * Add/Remove Scalaris Stress Visualization UI to/from the viewer.
 * Toggles the visualization of simulation data in the model.
 */

'use strict';

var av = Autodesk.Viewing;
var avp = av.Private;

var SCALARIS_SIMULATION_EXTENSION_ID = 'Autodesk.Viewing.ScalarisSimulation';
var SCALARIS_SIMULATION_BUTTON_ID = 'toolbar-simulation';

// The legend for factor of safety results defaults to a range of 0–15.
var SCALARIS_FOS_MIN = 0;
var SCALARIS_FOS_MAX = 15;
var SCALARIS_FOS_TARGET = 1;
// The yield strength value for the default physical material AlSi10Mg is 240000000 Pa.
var SCALARIS_YIELD_STRENGTH = 240000000;

// Set the default environment to "Photo Booth".
av.DefaultSettings.lightPreset = 4;

const _gDocument = av.getGlobal().document;

/**
 * Return linear interpolated color.
 * https://gist.github.com/rosszurowski/67f04465c424a9bc0dae
 * @param {String} a - First color.
 * @param {String} b - Second color.
 * @param {Number} amount - Amount to interpolate [0, 1].
 * @return {String} Interpolated color.
 * @private
 */
function _lerpColor(a, b, amount) {
  var ah = parseInt(a.replace(/#/g, ''), 16),
    ar = ah >> 16,ag = ah >> 8 & 0xff,ab = ah & 0xff,
    bh = parseInt(b.replace(/#/g, ''), 16),
    br = bh >> 16,bg = bh >> 8 & 0xff,bb = bh & 0xff,
    rr = ar + amount * (br - ar),
    rg = ag + amount * (bg - ag),
    rb = ab + amount * (bb - ab);

  return '#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb | 0).toString(16).slice(1);
}

/**
 * Return interpolated color for a linear gradient given a number of stops.
 * @param {Array<String>} stops - An array of gradient stops.
 * @param {Number} frac - Fraction [0, 1].
 * @return {String} Interpolated color.
 * @private
 */
function _gradient(stops, frac) {
  var numIntervals = stops.length - 1;
  for (var i = 0; i < numIntervals + 1; ++i) {
    if (frac <= (i + 1) / numIntervals) {
      return _lerpColor(stops[i], stops[i + 1], numIntervals * frac - i);
    }
  }
  return null;
}

/**
 * Creates a dom element.
 * @param {String} tagName - Element tag name.
 * @param {String} [className] - Optional class name.
 * @param {String} [textContent] - Optional text content.
 * @param {Array<Element>} [children] - Optional array of children.
 * @return {Element} New element.
 * @private
 */
function _createElement(tagName, className, textContent, children) {
  const _document = this && this.getDocument && this.getDocument() || _gDocument;
  var elem = _document.createElement(tagName);
  if (className) {
    elem.className = className;
  }
  if (textContent) {
    elem.textContent = textContent;
  }
  if (children) {
    for (var i = 0, length = children.length; i < length; ++i) {
      elem.appendChild(children[i]);
    }
  }
  return elem;
}


/**
 * Convert hexadecimal colors to their RGB values.
 * @return {Array<Number>} RGB colors (range 0-1).
 * @private
 */
function _hex_to_RGB(hex) {
  var m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255
  };
}

/**
 * Return a color map.
 * @param {Number} nColors - Number of colors.
 * @param {Array<Number>} colors - Array of RGB colors.
 * @param {Array<Number>} percents - Array of color percentages.
 * @param {Array<Number>} ranges - Array of color ranges.
 * @return {Array<Number>} Color map.
 * @private
 */
function _buildColorMap(nColors, colors, percents, ranges) {
  var colorMap = [];
  var nbColors = colors.length;
  if (colors === undefined || !nbColors) {
    return colorMap;
  }
  if (nbColors === 1) {
    for (var i = 0; i < nColors; i++) {
      colorMap[i * 3] = colors[0].r;
      colorMap[i * 3 + 1] = colors[0].g;
      colorMap[i * 3 + 2] = colors[0].b;
    }
  } else {
    var nbBands = nbColors - 1;
    var totalSize = 0;
    for (var b = 0; b < nbBands; b++) {
      var size = Math.floor(nColors * (percents[b] / 100));
      if (b === nbBands - 1) {
        size = nColors - totalSize;
      }
      var sc = b;
      var ec = b + 1;
      var li = b === nbBands - 1 ? nColors - totalSize : size;
      var oset = 3 * totalSize;
      for (var c = 0; c < li; c++) {
        var t = c / li;
        colorMap[oset + 3 * c] = colors[sc].r + t * (colors[ec].r - colors[sc].r);
        colorMap[oset + 3 * c + 1] = colors[sc].g + t * (colors[ec].g - colors[sc].g);
        colorMap[oset + 3 * c + 2] = colors[sc].b + t * (colors[ec].b - colors[sc].b);
      }
      totalSize += size;
      ranges[b] = totalSize - 1;
    }
    colorMap[3 * (nColors - 1)] = colors[nbBands].r;
    colorMap[3 * (nColors - 1) + 1] = colors[nbBands].g;
    colorMap[3 * (nColors - 1) + 2] = colors[nbBands].b;
  }
  return colorMap;
}

/**
 * ScalarisSimulationExtension adds a toggle simulation button
 * ('Von Mises stress'/'Factor of safety') to settingsTools toolbar.
 * @constructor
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @param {Object} options - Not used.
 * @deprecated This extension is deprecated and will be removed in a future release.
 */
function ScalarisSimulationExtension(viewer, options) {
  av.Extension.call(this, viewer, options);

  this._autoShowTooltip = true; // Show tooltip automatically?
  this._ignoreCameraChanged = false; // Should we be (temporarily) ignoring camera changed events?
  this._tooltip = null;
  this._tooltipText = null;
  this._tooltipBar = null;
  this._tooltipArrow = null;
  this._styleSheet = null; // Custom stylesheet for the tooltips
  this._eventClientY = 0; // event.clientY result from current mousemove event
  this._moveAnimationRequestId = null; // Used to debounce mousemove
  this._simulationMode = 'fos';
  this._colorMap = [];
  this._colorRange = [];
  this._skip = false;

  this._onToolbarCreated = this._onToolbarCreated.bind(this);
  this._onGeometryLoaded = this._onGeometryLoaded.bind(this);
  this._onMouseMove = this._onMouseMove.bind(this);
  this._handleMouseMove = this._handleMouseMove.bind(this);
  this._onCameraChanged = this._onCameraChanged.bind(this);
  this._defaultFormatter = this._defaultFormatter.bind(this);

  this._config = {
    formatterVms: this._defaultFormatter,
    unitsVms: 'Pa',
    formatterFos: this._defaultFormatter,
    multiple: false,
    min: null,
    max: null
  };
}

ScalarisSimulationExtension.prototype = Object.create(av.Extension.prototype);
av.EventDispatcher.prototype.apply(ScalarisSimulationExtension.prototype);
ScalarisSimulationExtension.prototype.constructor = ScalarisSimulationExtension;

ScalarisSimulationExtension.Events = {
  SCALARIS_SIMULATION_MODE_CHANGED: 'Autodesk.Viewing.ScalarisSimulation.Event.ModeChanged'
};

/**
 * Load the Scalaris simulation extension.
 * @override
 * @returns {boolean}
 */
ScalarisSimulationExtension.prototype.load = function () {
  (0,_src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_1__.warnOnce)('[Autodesk.Viewing.ScalarisSimulation] This extension is deprecated and will be removed in a future release.');
  var viewer = this.viewer;
  var loader = viewer.model.loader;
  var svf = loader.svf;
  if (!loader || !svf) {
    return false;
  }

  if (!(loader instanceof avp.ScalarisLoader)) {
    av.Private.logger.warn('No scalaris loader available for extension', SCALARIS_SIMULATION_EXTENSION_ID);
    return false;
  }

  if (loader.basePath.endsWith('models/')) {
    this._config.min = SCALARIS_FOS_MIN;
    this._config.max = SCALARIS_FOS_MAX;
    viewer.targetFos = SCALARIS_FOS_TARGET;
    viewer.yieldStrength = SCALARIS_YIELD_STRENGTH;
    this._skip = true;
  }

  if (svf.stressData) {
    // Generate the color map.
    var nColors = 256;
    var colors = [];
    var percents = [];
    // Stress reference:
    // High:  [0,FoS target]
    // Ideal: [FoS target,FoS target+2]
    // Low:   [FoS target+2,15+]
    if (viewer.yieldStrength) {
      if (!viewer.targetFos) {
        viewer.targetFos = SCALARIS_FOS_TARGET;
      }
      if (this._config.min === null) {
        this._config.min = SCALARIS_FOS_MIN;
      }
      if (this._config.max === null) {
        this._config.max = SCALARIS_FOS_MAX;
      }
      colors = [_hex_to_RGB('#009BE8'), _hex_to_RGB('#00B50B'), _hex_to_RGB('#00B50B'), _hex_to_RGB('#FC4E4E')];
      percents = [40, 20, 40];
    } else {
      // von Mises Stress:
      // Max: stressMax
      // Min: stressMin
      this._simulationMode = 'vms';
      colors = [_hex_to_RGB('#FC4E4E'), _hex_to_RGB('#00B50B'), _hex_to_RGB('#009BE8')];
      percents = [50, 50];
    }
    this._colorMap = _buildColorMap(nColors, colors, percents, this._colorRange);

    if (viewer.toolbar) {
      this._createUI();
    } else {
      viewer.addEventListener(av.TOOLBAR_CREATED_EVENT, this._onToolbarCreated);
    }

    this._onGeometryLoaded();
    viewer.addEventListener(av.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);
  }

  // Modify the light preset environment for the viewer.
  var preset = av.Private.LightPresets[av.DefaultSettings.lightPreset];
  preset.E_bias = -1.5;
  preset.tonemap = 1;
  preset.lightMultiplier = 2.2973967099940698;
  // Disable the screen space ambient occlusion.
  viewer.setQualityLevel(false, viewer.impl.renderer().getAntialiasing());
  viewer.impl.setLightPreset(av.DefaultSettings.lightPreset, true);
  // Set the background color.
  viewer.setBackgroundColor(255, 255, 255, 255, 255, 255);

  return true;
};

/**
 * Unload the Scalaris simulation extension.
 * @override
 * @returns {boolean}
 */
ScalarisSimulationExtension.prototype.unload = function () {
  // Disable display of simulation data.
  this.setDisplayResult(false);

  // Remove the simulation UI from the viewer.
  if (this._legendContainer) {
    this.viewer.container.removeChild(this._legendContainer);
    // Remove a control from this control group.
    this.viewer.settingsTools.removeControl(SCALARIS_SIMULATION_BUTTON_ID);
  }

  this.viewer.removeEventListener(av.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);

  return true;
};

/**
 * Toggle the display of simulation result on the model and related UI in the viewer.
 * @param {boolean} show - enables or disables the display.
 */
ScalarisSimulationExtension.prototype.setDisplayResult = function (show) {
  var defMaterial = this.viewer.impl.getMaterials().defaultMaterial;
  if (!defMaterial) {
    return;
  }

  if (this._legendContainer) {
    this._legendContainer.hidden = !show;
  }

  if (this._simulationButton) {
    if (show) {
      this._simulationButton.setIcon('adsk-toolbar-view-modelIcon');
      this._simulationButton.setToolTip(av.i18n.translate('Model View'));
    } else {
      this._simulationButton.setIcon('adsk-toolbar-view-stress-referenceIcon');
      if (!this.viewer.yieldStrength) {
        this._simulationButton.setToolTip(av.i18n.translate('Von Mises stress'));
      } else {
        this._simulationButton.setToolTip(av.i18n.translate('Stress View'));
      }
    }
  }

  // If we're turning on the stress display and auto-show-tooltip is enabled,
  // then we need to update the contents of the tooltip.
  if (show && this._autoShowTooltip) {
    this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this._onCameraChanged);
    this._handleMouseMove();
  }

  defMaterial.vertexColors = show ? THREE.VertexColors : THREE.NoColors;
  defMaterial.needsUpdate = true;
  this.viewer.impl.invalidate(true, true, false); // trigger re-render
};

/**
 * Set the range and generate the color vertices for the mesh from the simulation data.
 * @param {number} [min] - minimum von Mises stress/factor of safety value.
 * @param {number} [max] - maximum von Mises stress/factor of safety value.
 */
ScalarisSimulationExtension.prototype.setRange = function (min, max) {
  if (this._skip) {
    return;
  }

  var viewer = this.viewer;
  var geometry = viewer.model.getGeometryList().getGeometry(1);
  if (!geometry) {
    return;
  }

  var svf = viewer.model.loader.svf;
  var stressData = svf.stressData;
  if (!stressData) {
    return;
  }

  var stressCount = stressData.length;
  if (!stressCount) {
    return;
  }

  var nbColors = this._colorMap.length / 3;
  if (nbColors === 0) {
    return;
  }

  if (min === undefined) {
    min = svf.stressMin;
  }
  if (max === undefined) {
    max = svf.stressMax;
  }

  if (min === max) {
    return;
  }

  var colorScale, colorIndex;
  var vertexColors = new Float32Array(stressCount * 3);
  if (this._simulationMode === 'vms') {
    var sRange = max - min;
    for (var i = 0; i < stressCount; i++) {
      colorScale = (stressData[i] - min) / sRange;
      colorIndex = Math.floor((1 - colorScale) * (nbColors - 1));
      vertexColors[i * 3] = this._colorMap[colorIndex * 3];
      vertexColors[i * 3 + 1] = this._colorMap[colorIndex * 3 + 1];
      vertexColors[i * 3 + 2] = this._colorMap[colorIndex * 3 + 2];
    }
  } else if (this._simulationMode === 'fos') {
    var color;
    var maxFos = SCALARIS_FOS_MAX;
    var maxTargetFos = viewer.targetFos + 2;
    if (maxTargetFos > SCALARIS_FOS_MAX) {
      maxFos = viewer.targetFos * 2;
    }
    if (viewer.yieldStrength) {
      min = viewer.yieldStrength / svf.stressMax;
      max = viewer.yieldStrength / svf.stressMin;
    }
    if (!isFinite(min) || isNaN(min)) {
      min = SCALARIS_FOS_MIN;
    }
    if (!isFinite(max) || isNaN(max) || max > maxFos) {
      max = maxFos;
    }
    if (min >= SCALARIS_FOS_MAX || max < 1 || min >= viewer.targetFos && max <= maxTargetFos) {
      if (min >= SCALARIS_FOS_MAX) {
        color = _hex_to_RGB('#009BE8'); // blue
      } else if (max < 1) {
        color = _hex_to_RGB('#FC4E4E'); // red
      } else {
        color = _hex_to_RGB('#00B50B'); // green
      }
      for (let i = 0; i < stressCount; i++) {
        vertexColors[i * 3] = color.r;
        vertexColors[i * 3 + 1] = color.g;
        vertexColors[i * 3 + 2] = color.b;
      }
    } else {
      var fosMin = Infinity,fosMax = -Infinity;
      if (min > max) {
        min = [max, max = min][0];
      }
      if (min < fosMin) {
        fosMin = min;
      }
      if (max > fosMax) {
        fosMax = max;
      }
      color = _hex_to_RGB('#00B50B'); // green
      for (let i = 0; i < stressCount; i++) {
        var fos, size, d1, d2;
        if (viewer.yieldStrength) {
          fos = viewer.yieldStrength / stressData[i];
        }
        if (!isFinite(fos) || fos > maxFos) {
          fos = maxFos;
        } else if (isNaN(fos)) {
          fos = SCALARIS_FOS_MIN;
        }
        if (fos >= viewer.targetFos && fos <= maxTargetFos) {
          // FoS in [target FoS, target FoS+2] is mapped to green (00B50B).
          vertexColors[i * 3] = color.r;
          vertexColors[i * 3 + 1] = color.g;
          vertexColors[i * 3 + 2] = color.b;
        } else {
          if (fos < viewer.targetFos) {
            // FoS mapped from red to green.
            size = this._colorRange[2] - this._colorRange[1];
            d1 = Math.abs(fos - viewer.targetFos);
            d2 = Math.abs(fosMin - viewer.targetFos);
            colorScale = this._colorRange[1] + d1 * size / d2;
            colorIndex = Math.floor(colorScale);
            if (colorIndex > this._colorRange[2]) {
              colorIndex = this._colorRange[2];
            }
          } else if (fos > maxTargetFos) {
            // FoS mapped from green to blue.
            size = this._colorRange[0];
            d1 = Math.abs(fos - viewer.targetFos - 2);
            d2 = Math.abs(fosMax - viewer.targetFos - 2);
            colorScale = d1 * size / d2;
            colorIndex = size - Math.floor(colorScale);
            if (colorIndex < 0) {
              colorIndex = 0;
            }
          }
          vertexColors[i * 3] = this._colorMap[colorIndex * 3];
          vertexColors[i * 3 + 1] = this._colorMap[colorIndex * 3 + 1];
          vertexColors[i * 3 + 2] = this._colorMap[colorIndex * 3 + 2];
        }
      }
    }
  }

  if (vertexColors && vertexColors.byteLength) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexColors), 3));
    geometry.hasColors = true;
    geometry.colorsNeedUpdate = true;
  }
};

/**
 * Set configuration for this extension.
 * @param {Object} config - Configuration.
 */
ScalarisSimulationExtension.prototype.setConfiguration = function (config) {
  var configExt = this._config;
  configExt = Object.assign(configExt, config || {});

  if (!configExt.formatterVms) {
    configExt.formatterVms = this._defaultFormatter;
  }
  if (!configExt.unitsVms) {
    configExt.unitsVms = 'Pa';
  }
  if (!configExt.formatterFos) {
    configExt.formatterFos = this._defaultFormatter;
  }
  if (config.formatterVms || config.formatterFos || config.min || config.max || config.unitsVms) {
    if (this._simulationMode === 'vms' && config.unitsVms) {
      var title = this._legendContainer.getElementsByClassName('adsk-legend-title');
      title[0].textContent = av.i18n.translate('Units Stress', { units: config.unitsVms });
    } else if (this._simulationMode === 'fos') {
      this.setRange(SCALARIS_FOS_MIN, SCALARIS_FOS_MAX);
    }
    this.forceLegendUpdate();
  }
};

/**
 * Set the simulation mode for this extension.
 * @param {String} mode - Simulation mode (should be 'vms' or 'fos').
 */
ScalarisSimulationExtension.prototype.setSimulationMode = function (mode) {
  this._simulationMode = mode;
};

/**
 * Return the simulation mode for this extension.
 * @return {String} - Returns the simulation mode.
 */
ScalarisSimulationExtension.prototype.getSimulationMode = function () {
  return this._simulationMode;
};

/**
 * Forces an update of the legend.
 */
ScalarisSimulationExtension.prototype.forceLegendUpdate = function () {
  this._setLegendLabels();
  this._handleMouseMove();
};

/**
 * Creates the legend min/max labels.
 * @private
 */
ScalarisSimulationExtension.prototype._setLegendLabels = function () {
  if (this._simulationMode === 'vms') {
    this._minTitle.textContent = av.i18n.translate('Min');
    this._maxTitle.textContent = av.i18n.translate('Max');
  } else if (this._simulationMode === 'fos') {
    this._minTitle.textContent = av.i18n.translate('Low');
    this._midTitle.textContent = av.i18n.translate('Ideal');
    this._maxTitle.textContent = av.i18n.translate('High');
  }
};

/**
 * Default numeric value formatter.
 * @param {Number} value - Value to format.
 * @private
 */
ScalarisSimulationExtension.prototype._defaultFormatter = function (value) {
  if (this._simulationMode === 'vms') {
    return Number.isFinite(Number(value)) ? Number.parseFloat(value).toExponential(2) : value.toString();
  }
  return value.toString();
};

/**
 * @private
 * Remove the toolbar creation event listener and create the UI elements for simulation data.
 */
ScalarisSimulationExtension.prototype._onToolbarCreated = function () {
  this.viewer.removeEventListener(av.TOOLBAR_CREATED_EVENT, this._onToolbarCreated);
  this._createUI();
};

/**
 * Callback when the geometry is loaded.
 */
ScalarisSimulationExtension.prototype._onGeometryLoaded = function () {
  this.setRange();
  this._setLegendLabels();

  var isResultVisible = this._legendContainer && !this._legendContainer.hidden;
  this.setDisplayResult(isResultVisible);
  if (isResultVisible && this._autoShowTooltip) {

    // As a result of loadModel(), the listener setup in setDisplayResult() will see some
    // camera changed events. For the purposes of hiding the tooltip, we need to ignore
    // those. Wait for a while until the display stabilizes.
    this._ignoreCameraChanged = true;

    var that = this;
    setTimeout(function () {
      that._ignoreCameraChanged = false;
      that.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, that._onCameraChanged);
    }, 500);
  }
};

/**
 * Handler for camera changed event.
 * Turn off auto-show-tooltip and remove this listener.
 * @private
 */
ScalarisSimulationExtension.prototype._onCameraChanged = function () {
  if (this._ignoreCameraChanged) {
    return;
  }

  if (this._autoShowTooltip) {
    this._tooltip.classList.remove('adsk-legend-tooltip-active');
    this._autoShowTooltip = false;
  }

  this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this._onCameraChanged);
};

/**
 * Handler for mousemove events in the legend.
 * @param {Event} event - Mouse event.
 * @private
 */
ScalarisSimulationExtension.prototype._onMouseMove = function (event) {
  this._eventClientY = event.clientY;

  if (this._autoShowTooltip) {
    this._tooltip.classList.remove('adsk-legend-tooltip-active');
    this._autoShowTooltip = false;
  }

  // Debounce.
  if (!this._moveAnimationRequestId) {
    this._moveAnimationRequestId = requestAnimationFrame(this._handleMouseMove);
  }
};

/**
 * Handler called (via requestAnimationFrame) on mousemove events.
 * @private
 */
ScalarisSimulationExtension.prototype._handleMouseMove = function () {
  this._moveAnimationRequestId = null;

  if (!this._colorScale) {
    return; // No color scale = no legend = shouldn't be trying to display a tooltip
  }

  // Position the tooltip to match the cursor position.
  var rect = this._colorScale.getBoundingClientRect();
  var height = rect.height;
  if (!height) {
    return; // Zero height = legend hasn't been sized yet = don't update tooltip.
  }

  var top = rect.top;
  var bottom = rect.bottom;
  var y = Math.min(Math.max(0, this._eventClientY - top), height);

  // If we're within some margin of the min/max, then clamp.
  var atMax = false;
  var atMin = false;

  if (Math.abs(top - this._eventClientY) < 8) {
    y = 0;
    atMax = true;
  }

  if (Math.abs(bottom - this._eventClientY) < 8) {
    y = height;
    atMin = true;
  }

  // If auto-show-tooltip is enabled, then put the tooltip in the middle;
  if (this._autoShowTooltip) {
    y = height / 2;
    atMax = false;
    atMin = false;
  }

  var config = this._config;
  // Why this tweak to the position?
  this._tooltip.style.top = (config.multiple ? y : y + 7) + 'px';

  // Grab the min/max stress/fos values from the file or the legend config.
  var svf = this.viewer.model.loader.svf;
  var stressMin = config.min != null ? config.min : svf.stressMin;
  var stressMax = config.max != null ? config.max : svf.stressMax;
  var frac = y / height;
  if (this._simulationMode === 'vms') {
    frac = 1 - frac;
  }
  var value = stressMin + (stressMax - stressMin) * frac;

  var scope = this;
  // Build the html for the tooltip.
  function createSpan(className, textContent) {
    return scope._createElement('span', className, textContent);
  }

  function createBR() {
    return scope._createElement('br');
  }

  var content = [];
  var className, textContent;
  var status, statusText;
  if (this._simulationMode === 'vms') {
    if (!this.viewer.yieldStrength) {
      content.push(createSpan('adsk-legend-tooltip-title', av.i18n.translate('Von Mises stress')));
    } else {
      content.push(createSpan('adsk-legend-tooltip-title', av.i18n.translate('Stress reference')));
    }
  } else if (this._simulationMode === 'fos') {
    // The indicator shows 3 possible states of the current design study: low, ideal and high.
    // These states are based on the lowest resultant safety factor in the design and the
    // default or user-specified safety factor targets.
    if (value > 9) {
      status = 'Low Stress';
      statusText = 'Stress in these regions is lower than required';
    } else if (value >= 6 && value <= 9) {
      status = 'Ideal Stress';
      statusText = 'Stress in these regions is the most performant';
    } else if (value < 6) {
      status = 'High Stress';
      statusText = 'Stress in these regions should be noted and may require attention';
    }
    content.push(createSpan('adsk-legend-tooltip-title', av.i18n.translate('Stress Status', { status: status })));
  }
  content.push(createBR());

  /*
  if (config.multiple) {
    content.push(createSpan('adsk-legend-tooltip-subtitle', av.i18n.translate('For all displayed outcomes')));
    content.push(createBR());
  }
  */
  content.push(createBR());

  className = 'adsk-legend-tooltip-value';
  textContent = this._simulationMode === 'vms' ? config.formatterVms(stressMax) : undefined;
  if (atMax) {
    className += ' adsk-legend-tooltip-highlight';
    if (this._simulationMode === 'vms') {
      textContent = av.i18n.translate('Max Value', { max: textContent });
      content.push(createSpan(className, textContent));
    }
  }

  if (!atMax && !atMin && this._simulationMode === 'vms') {
    content.push(createSpan('adsk-legend-tooltip-value adsk-legend-tooltip-highlight', config.formatterVms(value)));
  }

  className = 'adsk-legend-tooltip-value';
  if (this._simulationMode === 'vms') {
    textContent = config.formatterVms(stressMin);
  } else if (this._simulationMode === 'fos') {
    textContent = this._defaultFormatter(stressMin.toFixed(2));
  }

  textContent = this._simulationMode === 'vms' ? config.formatterVms(stressMin) : undefined;
  if (atMin) {
    className += ' adsk-legend-tooltip-highlight';
    if (this._simulationMode === 'vms') {
      textContent = av.i18n.translate('Min Value', { min: textContent });
      content.push(createSpan(className, textContent));
    }
  }

  className = 'adsk-legend-tooltip-value';
  if (this._simulationMode === 'fos') {
    content.push(createSpan(className, av.i18n.translate('Stress Text', { statusText: statusText })));
    content.push(createBR());
  }

  var node = this._tooltipText;
  while (node.hasChildNodes()) {
    node.removeChild(node.lastChild);
  }
  for (var i = 0, length = content.length; i < length; ++i) {
    node.appendChild(content[i]);
  }

  // Set color to match the legend's color scale (emulate the css linear-gradient).
  var color;
  if (this._simulationMode === 'vms') {
    color = _gradient(['#009BE8', '#00B50B', '#FC4E4E'], frac);
  } else if (this._simulationMode === 'fos') {
    color = _gradient(['#009BE8', '#00B50B', '#FC4E4E'], 1 - frac);
  }
  if (color) {
    this._tooltipBar.style.background = color;
    if (this._styleSheet.cssRules.length) {
      this._styleSheet.deleteRule(0);
    }
    this._styleSheet.insertRule('.adsk-legend-tooltip-arrow::after {border-left-color:' + color + '}', 0);
  }
};

/**
 * @private
 * Create the UI elements (legend and simulation button) for displaying simulation results.
 */
ScalarisSimulationExtension.prototype._createUI = function () {
  var viewer = this.viewer;
  var svf = viewer.model.loader.svf;
  var loadOptions = svf.loadOptions;
  var settingsTools = viewer.settingsTools;

  this._createElement = _createElement.bind(this);

  const _document = this.getDocument();
  if (loadOptions) {
    if (svf.stressData && svf.stressData.byteLength) {

      // Add the simulation UI to the viewer .
      this._legendContainer = _document.createElement('div');
      this._legendContainer.classList.add('adsk-legend-container');
      var title = _document.createElement('div');
      if (!viewer.yieldStrength) {
        title.textContent = av.i18n.translate('Von Mises stress (Pa)');
      } else {
        title.textContent = av.i18n.translate('Stress reference');
      }
      title.classList.add('adsk-legend-title');
      var scaleContainer = _document.createElement('div');
      scaleContainer.classList.add('adsk-legend-scale-container');
      this._colorScale = _document.createElement('div');
      this._colorScale.classList.add('adsk-legend-color-scale');
      var labelContainer = _document.createElement('div');
      labelContainer.classList.add('adsk-legend-label-container');
      this._maxLabel = _document.createElement('div');
      this._maxLabel.classList.add('adsk-legend-max-label');
      this._minLabel = _document.createElement('div');
      this._minLabel.classList.add('adsk-legend-min-label');
      var titleContainer = _document.createElement('div');
      titleContainer.classList.add('adsk-legend-title-container');
      this._maxTitle = _document.createElement('div');
      this._maxTitle.classList.add('adsk-legend-max-title');
      this._midTitle = _document.createElement('div');
      this._midTitle.classList.add('adsk-legend-mid-title');
      this._minTitle = _document.createElement('div');
      this._minTitle.classList.add('adsk-legend-min-title');

      this._createTooltip(this._colorScale);

      var titleTooltip = _document.createElement('div');
      titleTooltip.classList.add('adsk-legend-title-tooltip');
      if (!viewer.yieldStrength) {
        titleTooltip.textContent = av.i18n.translate('Displays the distribution of von Mises stress on the surface of the generated outcome.');
      } else {
        titleTooltip.textContent = av.i18n.translate('Displays the distribution of stress based on the factor of safety value set in the Objectives and Limits dialog in the Define workspace.');
      }
      title.appendChild(titleTooltip);
      labelContainer.appendChild(this._maxLabel);
      labelContainer.appendChild(this._minLabel);
      titleContainer.appendChild(this._maxTitle);
      titleContainer.appendChild(this._midTitle);
      titleContainer.appendChild(this._minTitle);
      scaleContainer.appendChild(labelContainer);
      scaleContainer.appendChild(this._colorScale);
      scaleContainer.appendChild(titleContainer);
      this._legendContainer.appendChild(title);
      this._legendContainer.appendChild(scaleContainer);
      let viewCubeContainer = viewer.getExtension('Autodesk.ViewCubeUi');
      viewCubeContainer = viewCubeContainer && viewCubeContainer.container;

      viewer.container.insertBefore(this._legendContainer, viewCubeContainer);

      this._simulationButton = new av.UI.Button(SCALARIS_SIMULATION_BUTTON_ID);
      if (!viewer.yieldStrength) {
        this._simulationButton.setToolTip(av.i18n.translate('Von Mises stress'));
      } else {
        this._simulationButton.setToolTip(av.i18n.translate('Stress View'));
      }

      this._simulationButton.setIcon('adsk-toolbar-view-stress-referenceIcon');
      var scope = this;
      this._simulationButton.onClick = function () {
        if (scope._legendContainer) {
          scope.setDisplayResult(scope._legendContainer.hidden);
        }
      };

      settingsTools.addControl(this._simulationButton, { index: viewer.settingsTools.getNumberOfControls() });
    } else {
      av.Private.logger.warn('No simulation data available to view for extension', SCALARIS_SIMULATION_EXTENSION_ID);
    }
    this.setDisplayResult(false);
  }
};

/**
 * Creates the legend tooltip (popover) ui.
 * @param {Element} parent - Parent element.
 * @private
 */
ScalarisSimulationExtension.prototype._createTooltip = function (parent) {
  var scope = this;
  function createDiv(className, children) {
    return scope._createElement('div', className, null, children);
  }

  // Create the html.
  this._tooltipArrow = createDiv('adsk-legend-tooltip-arrow');
  this._tooltipBar = createDiv('adsk-legend-tooltip-bar');
  this._tooltipText = createDiv('adsk-legend-tooltip-text');
  this._tooltip = createDiv('adsk-legend-tooltip', [
  createDiv('adsk-legend-tooltip-box', [this._tooltipText, this._tooltipBar]),
  this._tooltipArrow]
  );

  if (this._autoShowTooltip) {
    this._tooltip.classList.add('adsk-legend-tooltip-active');
  }
  this._tooltip.style.top = '0';

  // Add the tooltip to the parent and add a mousemove event handler.
  parent.appendChild(this._tooltip);
  parent.onmousemove = this._onMouseMove;

  // Create a custom stylesheet, we'll use this for coloring the pseudo-element arrow.
  const _document = this.getDocument();
  var style = _document.createElement('style');
  style.appendChild(_document.createTextNode('')); // webkit hack: still required?
  _document.head.appendChild(style);
  this._styleSheet = style.sheet;
};

var ScalarisSimulation = ScalarisSimulationExtension;

/*
 * Register the 'Autodesk.Viewing.ScalarisSimulation' extension with the extension manager.
 */
av.theExtensionManager.registerExtension(SCALARIS_SIMULATION_EXTENSION_ID, ScalarisSimulationExtension);
})();

Autodesk.Extensions.ScalarisSimulation = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=ScalarisSimulation.js.map