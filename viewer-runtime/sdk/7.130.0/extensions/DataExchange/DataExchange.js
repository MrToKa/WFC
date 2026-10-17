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

/***/ "./extensions/DataExchange/fdxs/actions.js"
/*!*************************************************!*\
  !*** ./extensions/DataExchange/fdxs/actions.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createExchange: () => (/* binding */ createExchange),
/* harmony export */   getExchangeContainer: () => (/* binding */ getExchangeContainer)
/* harmony export */ });
/* harmony import */ var _constants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./constants.js */ "./extensions/DataExchange/fdxs/constants.js");


async function createExchange(params, bubbleNode) {
  if (params && bubbleNode) {
    const {
      fdxEnv,
      exchangeName,
      destProjectUrn,
      destFolderUrn,
      srcProjectUrn,
      srcFolderUrn,
      rootFolderUrn,
      headers = {}
    } = params;

    const viewName = bubbleNode.data.name;
    const viewableId = bubbleNode.data.viewableID;
    const viewGuid = bubbleNode.data.guid;

    const srcFile = bubbleNode.findViewableParent();

    const documentUrn = srcFile.getDocument().myData.urn;
    const srcVersionUrn = Autodesk.Viewing.fromUrlSafeBase64(documentUrn);
    const srcFileUrn = srcFile.lineageUrn();

    const accessToken = Autodesk.Viewing.token.accessToken;

    const requestBody = {
      type: "autodesk.fdx:space.exchangecontainer-1.0.0",
      components: {
        insert: {
          "autodesk.fdx:contract.revitViewGeometry-1.0.0": {
            contract: {
              String: {
                viewableId: viewableId,
                viewName: viewName,
                viewGuid: viewGuid
              }
            }
          },
          "autodesk.fdx:source.acc-1.0.0": {
            source: {
              String: {
                fileUrn: srcFileUrn,
                versionUrn: srcVersionUrn,
                folderUrn: srcFolderUrn,
                projectUrn: srcProjectUrn
              }
            }
          },
          "autodesk.fdx:host.acc-1.0.0": {
            host: {
              String: {
                folderUrn: destFolderUrn,
                projectUrn: destProjectUrn,
                fileName: exchangeName,
                rootFolderUrn
              }
            }
          }
        }
      }
    };

    const fdxs_url = `${_constants_js__WEBPACK_IMPORTED_MODULE_0__.FDXS_URL[fdxEnv]}${_constants_js__WEBPACK_IMPORTED_MODULE_0__.FDXS_API[_constants_js__WEBPACK_IMPORTED_MODULE_0__.CREATE_EXCHANGE]}`;
    let result = {};
    let data;

    try {
      const response = await fetch(fdxs_url, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...headers
        },
        redirect: "follow",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(requestBody)
      });

      result = { status: response.status, ok: response.ok };
      data = await response.json();
    } catch (error) {
      return error;
    }

    result = Object.assign(result, data);

    return result;
  }
  return {};
}

async function getExchangeContainer(params) {
  const { fdxEnv, versionUrn, fileUrn, headers = {} } = params;

  let fdxs_url = `${_constants_js__WEBPACK_IMPORTED_MODULE_0__.FDXS_URL[fdxEnv]}${_constants_js__WEBPACK_IMPORTED_MODULE_0__.FDXS_API[_constants_js__WEBPACK_IMPORTED_MODULE_0__.GET_EXCHANGE_CONTAINER]}`;

  if (fileUrn) {
    fdxs_url = fdxs_url.concat(
      `?filters=attribute.exchangeFileUrn==${fileUrn}`
    );
  } else if (versionUrn) {
    fdxs_url = fdxs_url.concat(
      `?filters=attribute.exchangeFileVersionUrn==${versionUrn}`
    );
  }

  const accessToken = Autodesk.Viewing.token.accessToken;
  let result = {};
  let data;

  try {
    const response = await fetch(fdxs_url, {
      method: "GET",
      mode: "cors",
      cache: "no-cache",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...headers
      },
      redirect: "follow",
      referrerPolicy: "no-referrer"
    });

    result = { status: response.status, ok: response.ok };
    data = await response.json();
  } catch (error) {
    return error;
  }

  if (result.ok) {
    result = Object.assign(result, data.results[0]);
  } else {
    result = Object.assign(result, data);
  }

  return result;
}

/***/ },

/***/ "./extensions/DataExchange/fdxs/constants.js"
/*!***************************************************!*\
  !*** ./extensions/DataExchange/fdxs/constants.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CREATE_EXCHANGE: () => (/* binding */ CREATE_EXCHANGE),
/* harmony export */   FDXS_API: () => (/* binding */ FDXS_API),
/* harmony export */   FDXS_URL: () => (/* binding */ FDXS_URL),
/* harmony export */   GET_EXCHANGE_CONTAINER: () => (/* binding */ GET_EXCHANGE_CONTAINER),
/* harmony export */   GET_NUM_OF_OBJECTS: () => (/* binding */ GET_NUM_OF_OBJECTS)
/* harmony export */ });
const CREATE_EXCHANGE = "createExchange";
const GET_EXCHANGE_CONTAINER = "getExchangeContainer";
const GET_NUM_OF_OBJECTS = "getNumOfObjects";

const FDXS_URL = {
  development: "https://developer-stg.api.autodesk.com/exchange-dev",
  staging: "https://developer-stg.api.autodesk.com/exchange",
  production: "https://developer.api.autodesk.com/exchange"
};

const FDXS_API = {
  createExchange: "/v1/exchanges",
  getExchangeContainer: "/v1/exchanges"
};

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
/*!*************************************************!*\
  !*** ./extensions/DataExchange/DataExchange.js ***!
  \*************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DataExchangeExtension: () => (/* binding */ DataExchangeExtension)
/* harmony export */ });
/* harmony import */ var _fdxs_actions_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./fdxs/actions.js */ "./extensions/DataExchange/fdxs/actions.js");
/* harmony import */ var _fdxs_constants_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./fdxs/constants.js */ "./extensions/DataExchange/fdxs/constants.js");






const av = Autodesk.Viewing;
const namespace = AutodeskNamespace("Autodesk.Viewing.Extensions.DataExchange");

/**
 * Extension description
 *
 * The extension id is: 'Autodesk.DataExchange'
 *
 * @example
 *   viewer.loadExtension('Autodesk.DataExchange', options)
 *
 * @memberof Autodesk.Viewing.Extensions
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 */
class DataExchangeExtension extends av.Extension {
  constructor(viewer, options = {}) {
    super(viewer, options);
    this.name = "DataExchange";

    this.onModelAdded = this.onModelAdded.bind(this);
    this.execute = this.execute.bind(this);
  }

  load() {
    this.viewer?.addEventListener(av.MODEL_ADDED_EVENT, this.onModelAdded);
    return true;
  }

  unload() {
    this.viewer?.removeEventListener(av.MODEL_ADDED_EVENT, this.onModelAdded);
    return true;
  }

  activate() {
    return true;
  }

  deactivate() {
    return true;
  }

  async execute(action, params) {
    if (action == _fdxs_constants_js__WEBPACK_IMPORTED_MODULE_1__.CREATE_EXCHANGE) {
      return (0,_fdxs_actions_js__WEBPACK_IMPORTED_MODULE_0__.createExchange)(params, this.bubbleNode);
    } else if (action == _fdxs_constants_js__WEBPACK_IMPORTED_MODULE_1__.GET_EXCHANGE_CONTAINER) {
      return (0,_fdxs_actions_js__WEBPACK_IMPORTED_MODULE_0__.getExchangeContainer)(params);
    } else if (action == _fdxs_constants_js__WEBPACK_IMPORTED_MODULE_1__.GET_NUM_OF_OBJECTS) {
      let getTree = new Promise((resolve, reject) => {
        let count = 0;

        let interval = setInterval(() => {
          const instanceTree = this.model?.getObjectTree();
          count = count + 1;

          if (
          instanceTree &&
          this.bubbleNode.data.guid == params.guid &&
          this.bubbleNode.data.viewableID == params.viewableID)
          {
            clearInterval(interval);
            resolve(instanceTree);
          } else if (count == 10) {
            clearInterval(interval);
            reject("no instance tree found");
          }
        }, 1000);
      });

      return getTree.
      then((tree) => {
        let objectCount = 0;

        tree.enumNodeChildren(
          1,
          (node) => {
            objectCount = objectCount + 1;
          },
          true
        );
        return objectCount;
      }).
      catch((error) => {
        console.log(error);
        return error;
      });
    }

    return true;
  }

  onModelAdded({ model }) {
    this.bubbleNode = model.getDocumentNode();
    this.model = model;
  }
}

namespace.DataExchangeExtension = DataExchangeExtension;

av.theExtensionManager.registerExtension(
  "Autodesk.DataExchange",
  DataExchangeExtension
);
})();

Autodesk.Extensions.DataExchange = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=DataExchange.js.map