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

/***/ "./extensions/StringExtractor/StringHelpers.js"
/*!*****************************************************!*\
  !*** ./extensions/StringExtractor/StringHelpers.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _src_file_loaders_lmvtk_common_StringUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../src/file-loaders/lmvtk/common/StringUtils.js */ "./src/file-loaders/lmvtk/common/StringUtils.js");


/**
 * Format output from F2D myData object
 * @param {Object} data - myData object that contains strings and relevant bounding boxes
 * @returns {Array} strings - Array with String ojects. Each object contains text and bounding box as THREE.Box2.
 */
function loadStringsFromModel(data) {
  let formattedStrings = [];
  const anglesExist = data.stringAngles ? true : false;

  for (let i = 0; i < data.strings.length; i++) {
    const tempStringBox = data.stringBoxes.slice(i * 4, i * 4 + 4);
    const min = new THREE.Vector2(tempStringBox[0], tempStringBox[1]);
    const max = new THREE.Vector2(tempStringBox[2], tempStringBox[3]);
    const bBox = new THREE.Box2(min, max);
    const stringData = {
      string: data.strings[i],
      boundingBox: bBox,
      stringCharWidths: data.stringCharWidths[i],
      stringPosition: data.stringPositions[i],
      stringHeight: data.stringHeights[i],
      ...(data.stringWidths && { stringWidth: data.stringWidths[i] })
    };

    // Add angle for text rotation if available
    if (anglesExist) {
      stringData.angle = data.stringAngles[i];
    }
    formattedStrings.push(stringData);
  }
  return formattedStrings;
}

/**
 * Performs string extraction from Leaflet PDF file
 * @returns {Object} return JSON object with all strings in Leaflet document.
 */
function loadLeafletStrings(model) {
  const role = 'pdf-strings';
  const bubble = model.getData().loadOptions.bubbleNode;
  const doc = model.getDocumentNode().getRootNode().getDocument();
  const nodes = bubble ? bubble.search({ role }) : null;

  if (!nodes || !nodes[0]) {
    return Promise.reject(`Node for ${role} not found`);
  }

  return fetchLeafletStrings(nodes[0].urn(), nodes[0].guid(), doc).
  then((data) => {
    const strings = data ? (0,_src_file_loaders_lmvtk_common_StringUtils_js__WEBPACK_IMPORTED_MODULE_0__.utf8BlobToStr)(data, 0, data.length) : null;
    return Promise.resolve(strings ? JSON.parse(strings) : null);
  }).
  catch(function (error) {
    return Promise.reject(`No data in ${role}`);
  });
}

/**
 * Format output from loadLeafletStrings, remove duplicated data from JSON as "text" item
 * @param {Object} model - model of loaded document
 * @param {Object} pdfStrings - JSON with all strings from Leaflet.
 * @returns {Array} formattedStrings - Array with String objects. Each object contains text and bounding box as THREE.Box2.
 */
function formatleafletStrings(model, leafletStrings) {
  let formattedStrings = [];
  const modelBBox = model.getBoundingBox(true);
  let size = new THREE.Vector3();
  modelBBox.getSize(size);
  // 10000 values are related Extractor where string’s bounding box is in a normalized space defined by 10000*10000
  // Relevant code in extractor repo: https://git.autodesk.com/BIM360/PDFExtractor/blob/3cdaa75fbc9fb80419b65073b17d2e7fb1357541/PDFExtractor/RasterExtractor/StringExtractor.cpp#L46
  const extractorScaleFactor = 10000;

  /**
   * Since there 2 sources of strings, ACC Build and BIM360,
   * A different formatting needed for those cases.
   */

  // Page dimension retrieval for ACC Build based strings
  if (leafletStrings.items) {
    leafletStrings = leafletStrings.items;
    for (let i = 0; i < leafletStrings.length; i++) {
      if (leafletStrings[i].text && leafletStrings[i].frame) {
        const p1X = leafletStrings[i].frame[0] * size.x;
        const p2X = leafletStrings[i].frame[2] * size.x;
        let p1Y;
        let p2Y;

        // Different calculation needed if fitPaperSize provided
        if (model.isPageCoordinates()) {
          p1Y = (1 - leafletStrings[i].frame[1]) * size.y;
          p2Y = (1 - leafletStrings[i].frame[3]) * size.y;
        } else {
          p1Y = 1 - leafletStrings[i].frame[1] * size.y;
          p2Y = 1 - leafletStrings[i].frame[3] * size.y;
        }

        const p1 = new THREE.Vector2(p1X, p1Y);
        const p2 = new THREE.Vector2(p2X, p2Y);
        const bBox = new THREE.Box2().setFromPoints([p1, p2]);

        formattedStrings.push({
          string: leafletStrings[i].text,
          boundingBox: bBox
        });
      }
    }
  } else {
    // Page dimension retrieval for BIM360-like OCR extraction
    const xUnit = size.x / extractorScaleFactor;
    const yUnit = size.y / extractorScaleFactor;

    for (let i = 0; i < leafletStrings.length; i++) {
      const tempString = leafletStrings[i];

      if (tempString.words) {
        for (let j = 0; j < tempString.words.length; j++) {
          const top = tempString.words[j].bbox.top;
          const height = tempString.words[j].bbox.height;
          const width = tempString.words[j].bbox.width;
          const left = tempString.words[j].bbox.left;

          const minX = modelBBox.min.x + left * xUnit;
          const minY = modelBBox.min.y + (extractorScaleFactor - top - height) * yUnit;
          const maxX = modelBBox.min.x + (left + width) * xUnit;
          const maxY = modelBBox.min.y + (extractorScaleFactor - top) * yUnit;

          const min = new THREE.Vector2(minX, minY);
          const max = new THREE.Vector2(maxX, maxY);
          const bBox = new THREE.Box2(min, max);

          formattedStrings.push({
            string: tempString.words[j].text,
            boundingBox: bBox
          });
        }
      }
    }
  }

  return formattedStrings;
}

/**
 * Intiate HTTP request to get strings from Leaflet file
 * @param {*} urn URN for Leaflet PDF document
 * @param {*} guid Sheet ID of Leaflet document
 * @param {*} doc document from rootNode
 */
function fetchLeafletStrings(urn, guid, doc) {
  const av = Autodesk.Viewing;
  const avp = av.Private;
  return new Promise((resolve, reject) => {
    urn = doc.getFullPath(urn);
    const onSuccess = function (response) {
      resolve(response);
    };

    const onFailure = function (error) {
      reject(error);
    };

    const acmSessionId = doc.getAcmSessionId();

    const getItemOptions = {
      responseType: 'arraybuffer',
      skipAssetCallback: true,
      guid: encodeURIComponent(guid),
      acmsession: acmSessionId
    };

    const msg = {
      queryParams: acmSessionId ? 'acmsession=' + acmSessionId : ''
    };

    if (av.isOffline()) {
      urn = window.location.origin + '/' + urn;
    }
    avp.ViewingService.getItem(av.initLoadContext(msg), urn, onSuccess, onFailure, getItemOptions);
  });
}

const StringHelpers = {
  loadLeafletStrings,
  loadStringsFromModel,
  formatleafletStrings
};

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (StringHelpers);

/***/ },

/***/ "./src/file-loaders/lmvtk/common/StringUtils.js"
/*!******************************************************!*\
  !*** ./src/file-loaders/lmvtk/common/StringUtils.js ***!
  \******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   blobToJson: () => (/* binding */ blobToJson),
/* harmony export */   findValueOffsets: () => (/* binding */ findValueOffsets),
/* harmony export */   parseIntArray: () => (/* binding */ parseIntArray),
/* harmony export */   safeUtf8BlobToStr: () => (/* binding */ safeUtf8BlobToStr),
/* harmony export */   subBlobToJson: () => (/* binding */ subBlobToJson),
/* harmony export */   subBlobToJsonInt: () => (/* binding */ subBlobToJsonInt),
/* harmony export */   utf16to8: () => (/* binding */ utf16to8),
/* harmony export */   utf8ArrayToString: () => (/* binding */ utf8ArrayToString),
/* harmony export */   utf8BlobToStr: () => (/* binding */ utf8BlobToStr)
/* harmony export */ });


// http://www.onicos.com/staff/iz/amuse/javascript/expert/utf.txt
/* utf.js - UTF-8 <=> UTF-16 convertion
 *
 * Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0
 * LastModified: Dec 25 1999
 * This library is free.  You can redistribute it and/or modify it.
 */
function utf8BlobToStr(array, start, length) {
  var out, i, len, c;
  var char2, char3;

  out = '';
  len = length;
  i = 0;
  while (i < len) {
    c = array[start + i++];
    switch (c >> 4) {

      case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:
        // 0xxxxxxx
        out += String.fromCharCode(c);
        break;
      case 12:case 13:
        // 110x xxxx   10xx xxxx
        char2 = array[start + i++];
        out += String.fromCharCode((c & 0x1F) << 6 | char2 & 0x3F);
        break;
      case 14:
        // 1110 xxxx  10xx xxxx  10xx xxxx
        char2 = array[start + i++];
        char3 = array[start + i++];
        out += String.fromCharCode((c & 0x0F) << 12 |
        (char2 & 0x3F) << 6 |
        (char3 & 0x3F) << 0);
        break;
    }
  }

  return out;
}

/**
 * Safe version of utf8BlobToStr(), where Arrays are used to concatenate chars via join().
 * This function exists because string::operator += crashes on Chrome with large inputs.
 */
function safeUtf8BlobToStr(array, start, length) {
  var out, i, len, c, outArray, count;
  var char2, char3;

  var STR_CVT_LIMIT = 32 * 1024;
  out = '';
  outArray = [];
  len = length;
  count = 0;
  i = 0;
  while (i < len) {
    c = array[start + i++];
    switch (c >> 4) {

      case 0:case 1:case 2:case 3:case 4:case 5:case 6:case 7:
        // 0xxxxxxx
        outArray.push(String.fromCharCode(c));
        break;
      case 12:case 13:
        // 110x xxxx   10xx xxxx
        char2 = array[start + i++];
        outArray.push(String.fromCharCode((c & 0x1F) << 6 | char2 & 0x3F));
        break;
      case 14:
        // 1110 xxxx  10xx xxxx  10xx xxxx
        char2 = array[start + i++];
        char3 = array[start + i++];
        outArray.push(String.fromCharCode((c & 0x0F) << 12 |
        (char2 & 0x3F) << 6 |
        (char3 & 0x3F) << 0));
        break;
    }
    if (++count >= STR_CVT_LIMIT || i >= len) {
      out += outArray.join("");
      outArray.length = 0;
      count = 0;
    }
  }

  return out;
}


function utf16to8(str, array, start) {
  var i, len, c;

  var j = start || 0;
  len = str.length;

  if (array) {
    for (i = 0; i < len; i++) {
      c = str.charCodeAt(i);
      if (c >= 0x0001 && c <= 0x007F) {
        array[j++] = c;
      } else if (c > 0x07FF) {
        array[j++] = 0xE0 | c >> 12 & 0x0F;
        array[j++] = 0x80 | c >> 6 & 0x3F;
        array[j++] = 0x80 | c >> 0 & 0x3F;
      } else {
        array[j++] = 0xC0 | c >> 6 & 0x1F;
        array[j++] = 0x80 | c >> 0 & 0x3F;
      }
    }
  } else {
    //If no output buffer is passed in, estimate the required
    //buffer size and return that.
    for (i = 0; i < len; i++) {
      c = str.charCodeAt(i);
      if (c >= 0x0001 && c <= 0x007F) {
        j++;
      } else if (c > 0x07FF) {
        j += 3;
      } else {
        j += 2;
      }
    }
  }

  return j - (start || 0);
}


var USE_MANUAL_UTF8 = true;
var SAFE_UTF_LENGTH = 1024 * 1024;

function utf8ArrayToString(array, start, length) {

  if (start === undefined)
  start = 0;
  if (length === undefined)
  length = array.length;

  if (USE_MANUAL_UTF8) {
    if (length > SAFE_UTF_LENGTH) {
      return safeUtf8BlobToStr(array, start, length);
    }
    return utf8BlobToStr(array, start, length);
  } else {
    var encodedString = "";
    for (var i = start, iEnd = start + length; i < iEnd; i++)
    encodedString += String.fromCharCode(array[i]);

    return decodeURIComponent(escape(encodedString));
  }
}

function blobToJson(blob) {

  var decodedString = utf8ArrayToString(blob, 0, blob.length);

  const regex = /\u000e/gi; // eslint-disable-line no-control-regex
  // LMV-6005 Some blobs contained a Shift Out unicode character that could not be parsed by JSON.parse
  // This caused the property data base to not load.
  decodedString = decodedString.replace(regex, '');

  return JSON.parse(decodedString);
}

//parses a piece of json from a given blob (representing an array of json values)
//up to the next comma+newline combo (i.e. array delimiter).
function subBlobToJson(blob, startIndex) {
  if (startIndex === undefined) {
    return '';
  }

  var i = startIndex;

  while (i < blob.length - 1) {
    var c = blob[i];
    if (c == 44 && (blob[i + 1] == 10 || blob[i + 1] == 13)) //comma followed by newline?
      break;
    if (c == 10 || c == 13) //detect newline or line feed
      break;
    i++;
  }

  var decodedString = utf8ArrayToString(blob, startIndex, i - startIndex);
  try {
    return JSON.parse(decodedString);
  } catch (e) {
    console.error("Error parsing property blob to JSON : " + decodedString);
    return decodedString;
  }
}

function subBlobToJsonInt(blob, startIndex) {
  var val = 0;
  var i = startIndex;

  //Check for integers that were serialized as strings.
  //This should not happen, ever, but hey, it does.
  if (blob[i] == 34)
  i++;

  while (i < blob.length - 1) {
    var c = blob[i];
    if (c == 44 && (blob[i + 1] == 10 || blob[i + 1] == 13))
    break;
    if (c == 10 || c == 13 || c == 34)
    break;
    if (c >= 48 && c <= 57)
    val = val * 10 + (c - 48);

    i++;
  }

  return val;
}

//Simple integer array parse -- expects the array in property database
//format, where the array is packed with possibly newline separator,
//but no other white space. Does not do extensive error checking
function parseIntArray(blob, wantSentinel) {

  //find out how many items we have
  var count = 0;
  for (var i = 0, iEnd = blob.length; i < iEnd; i++)
  if (blob[i] == 44) //44 = ','
    count++;

  count++; //last item has no comma after it

  var items = new Uint32Array(count + (wantSentinel ? 1 : 0));

  i = 0;
  var end = blob.length;

  while (blob[i] != 91 && i < end) //91 = '['
  i++;

  if (i == blob.length)
  return null;

  i++;

  var seenDigit = false;
  count = 0;
  var curInt = 0;
  while (i < end) {
    var c = blob[i];
    if (c >= 48 && c <= 57) {//digit
      curInt = 10 * curInt + (c - 48);
      seenDigit = true;
    } else
    if (c == 44 || c == 93) {//',' or ']'
      if (seenDigit) {
        items[count++] = curInt;
        seenDigit = false;
        curInt = 0;
      }
    } else {
      seenDigit = false; //most likely a newline (the only other thing we have in our arrays
      curInt = 0;
    }
    i++;
  }

  return items;
}

//Scans an array of json values (strings, integers, doubles) and finds the
//offset of each value in the array, so that we can later pick off that
//specific value, without parsing the whole (potentially huge) json array up front.
//This expects the input blob to be in the form serialized by the property database
//C++ component -- one value per line. A more sophisticated parser would be needed
//in case the format changes and this assumption is not true anymore.
function findValueOffsets(blob) {

  //first, count how many items we have
  var count = 0;
  var end = blob.length - 1;

  for (var i = 0; i < end; i++) {
    if (blob[i] == 44 && (blob[i + 1] == 10 || blob[i + 1] == 13)) // ',' + newline is the item delimiter
      count++;
  }

  if (!count)
  return null;

  count++; //one for the last item

  var items = new Uint32Array(count);

  i = 0;
  count = 0;

  //find opening [
  while (blob[i] != 91 && i < end) //91 = '['
  i++;

  i++;

  items[count++] = i;
  var seenEol = false;
  while (i < end) {
    if (blob[i] == 10 || blob[i] == 13)
    seenEol = true;else
    if (seenEol) {
      seenEol = false;
      items[count++] = i;
    }

    i++;
  }

  return items;
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
/*!*******************************************************!*\
  !*** ./extensions/StringExtractor/StringExtractor.js ***!
  \*******************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ StringExtractor)
/* harmony export */ });
/* harmony import */ var _StringHelpers_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./StringHelpers.js */ "./extensions/StringExtractor/StringHelpers.js");

'use strict';

const av = Autodesk.Viewing;
const myExtensionName = 'Autodesk.StringExtractor';

class StringExtractor extends av.Extension {
  constructor(viewer, options) {
    super(viewer, options);
    this.documentStrings = {};
    this.extractStringsFromModels = this.extractStringsFromModels.bind(this);
  }

  async load() {
    // Since content of Viewer might change, as while switching sheets, string extraction repeated on every model load.
    this.viewer.addEventListener(av.MODEL_ROOT_LOADED_EVENT, this.extractStringsFromModels);
    this.viewer.addEventListener(av.GEOMETRY_LOADED_EVENT, this.extractStringsFromModels);
    return true;
  }

  unload() {
    this.viewer.removeEventListener(av.MODEL_ROOT_LOADED_EVENT, this.extractStringsFromModels);
    this.viewer.removeEventListener(av.GEOMETRY_LOADED_EVENT, this.extractStringsFromModels);
    return true;
  }

  /**
   * Performs string extraction from all models in scene
   * @returns {Promise} Function returns a Promise with array of results all models in scene.
   */
  extractStringsFromModels() {
    const models = this.viewer.getVisibleModels();
    const promisesArray = [];
    let result;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];

      result = this.extractStringsFromModel(model);
      promisesArray.push(result);
    }
    // promisesArray for all request for string extraction.
    return Promise.all(promisesArray);
  }

  /**
   * Performs string extraction from specific model
   * @param {Object} model - model within which string extraction performed.
   * @returns {Promise} Promise which is resolved when the data from F2D/Leaflet/PDF document by model type is fetched.
   */
  extractStringsFromModel(model) {
    // Do not extract strings if already cached
    // Do not fetch temporary leaflet data since vector will load
    if (!model.isLoadDone() || !model.is2d() || this.documentStrings[model.id] || model.getData().underlayRaster) {
      return Promise.resolve();
    }

    if (model.isPdf()) {

      const data = model.getData();
      if (typeof data.extractPdfStrings === 'function') {
        return data.extractPdfStrings().then(() => {
          const vectorStrings = _StringHelpers_js__WEBPACK_IMPORTED_MODULE_0__["default"].loadStringsFromModel(data);
          this.documentStrings[model.id] = { model, strings: vectorStrings };
        });
      }

      const vectorStrings = _StringHelpers_js__WEBPACK_IMPORTED_MODULE_0__["default"].loadStringsFromModel(data);
      this.documentStrings[model.id] = {
        model,
        strings: vectorStrings
      };
      return Promise.resolve();
    } else
    if (model.isLeaflet()) {
      return _StringHelpers_js__WEBPACK_IMPORTED_MODULE_0__["default"].loadLeafletStrings(model).then((result) => {
        this.documentStrings[model.id] = {
          model,
          strings: _StringHelpers_js__WEBPACK_IMPORTED_MODULE_0__["default"].formatleafletStrings(model, result)
        };
      });
    } else
    {
      const f2dStrings = _StringHelpers_js__WEBPACK_IMPORTED_MODULE_0__["default"].loadStringsFromModel(model.getData());
      this.documentStrings[model.id] = {
        model,
        strings: f2dStrings
      };
      return Promise.resolve();
    }
  }

  /**
   * @returns {Array} with all strings within scene by initiating String Extraction
   */
  getDocumentStrings() {
    return this.extractStringsFromModels().then(() => {
      return Promise.resolve(this.documentStrings);
    });
  }
}

av.theExtensionManager.registerExtension(myExtensionName, StringExtractor);
})();

Autodesk.Extensions.StringExtractor = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=StringExtractor.js.map