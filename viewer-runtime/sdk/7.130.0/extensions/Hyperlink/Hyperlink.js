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

/***/ "./extensions/Hyperlink/HyperlinkBack.js"
/*!***********************************************!*\
  !*** ./extensions/Hyperlink/HyperlinkBack.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HyperlinkBack: () => (/* binding */ HyperlinkBack)
/* harmony export */ });


var av = Autodesk.Viewing;


/**
 * Back button added when user navigates to a new sheet using an hyperlink.
 *
 * @param {*} hyperlinkTool
 * @param {*} viewer
 * @param {*} link
 */
class HyperlinkBack {

  constructor(hyperlinkTool, viewer, itemBack) {
    this.viewer = viewer;
    this.setGlobalManager(viewer.globalManager);

    const _document = this.getDocument();
    this.container = _document.createElement("div");
    this.container.classList.add("docking-panel-primary-button");
    this.container.classList.add("hyperlink-back");
    viewer.container.appendChild(this.container);

    this.backButton = _document.createElement("div");
    this.backButton.className = "hyperlink-back-button";
    this.backButton.setAttribute("data-i18n", "Back");
    this.backButton.textContent = av.i18n.translate("Back");
    this.container.appendChild(this.backButton);
    this.backButton.addEventListener('click', () => {
      this.uninitialize();
      viewer.__hyperlinkBack = null;
      if (hyperlinkTool.panel) {
        hyperlinkTool.panel.uninitialize();
        hyperlinkTool.panel = null;
      }
      hyperlinkTool.navigateToLink(null, itemBack);
    });

    this.closer = _document.createElement("div");
    this.closer.classList.add("docking-panel-close");
    this.closer.classList.add("hyperlink-back-closer");
    this.container.appendChild(this.closer);
    this.closer.addEventListener('click', () => {
      this.uninitialize();
      viewer.__hyperlinkBack = null;
    });

  }

  uninitialize() {
    this.viewer.container.removeChild(this.container);
    this.container = null;
  }

};

av.GlobalManagerMixin.call(HyperlinkBack.prototype);

/***/ },

/***/ "./extensions/Hyperlink/HyperlinkGui.js"
/*!**********************************************!*\
  !*** ./extensions/Hyperlink/HyperlinkGui.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HyperlinkPanel: () => (/* binding */ HyperlinkPanel)
/* harmony export */ });


var aveh = AutodeskNamespace('Autodesk.Viewing.Extensions.Hyperlink'),
  av = Autodesk.Viewing,
  avp = Autodesk.Viewing.Private;

/**
 * Panel displayed on top of the viewer displaying an hint (either a URL or a Thumbnail) of where the
 * hyperlink will be redirecting the user into.
 *
 * URLs will open in a new tab, while thumbnails are shown for models referenced by the same document.
 *
 * @param {*} hyperlinkTool
 * @param {*} viewer
 * @param {*} position
 * @param {*} intersectPoint
 * @param {*} title
 * @param {*} link
 * @param {*} viewableID
 * @param {*} dbId
 * @param {BubbleNode} bubbleNode
 * @param {function} requestThumbnailCb - Callback function
 */
function HyperlinkPanel(hyperlinkTool, viewer, position, intersectPoint, title, link, viewableID, dbId, bubbleNode, requestThumbnailCb) {
  var self = this;
  this.viewer = viewer;
  this.setGlobalManager(viewer.globalManager);

  var item = null;
  if (bubbleNode) {
    item = bubbleNode.data;
  }

  const _document = this.getDocument();
  this.container = _document.createElement("div");
  this.container.className = "hyperlink-container";
  viewer.container.appendChild(this.container);

  this.container.style.left = position.x + "px";
  this.container.style.top = position.y - 70 + "px"; // add the offset to let the triangle point to the position

  this.intersectPoint = intersectPoint; // for updating the panel position when camera is changed.
  this.dbId = dbId;

  // triangle
  this.triangle = _document.createElement("div");
  this.triangle.classList.add("hyperlink-container-triangle");
  this.container.appendChild(this.triangle);

  // panel
  this.panel = _document.createElement("div");
  this.panel.classList.add("docking-panel");
  this.panel.classList.add("docking-panel-container-solid-color-a");
  this.panel.classList.add("hyperlink-panel");
  this.container.appendChild(this.panel);

  // title
  this.title = _document.createElement("div");
  this.title.className = "hyperlink-panel-title";
  if (title) {
    this.title.textContent = title;
  } else
  {
    this.title.setAttribute("data-i18n", "External Link");
    this.title.textContent = av.i18n.translate("External Link");
  }
  this.panel.appendChild(this.title);

  function onGetThumbnail(thumbnailURL) {
    self.spinnerDiv.style.display = 'none'; // Remove spinner
    if (thumbnailURL) {
      self.thumbnail.src = thumbnailURL;
    } else {

      // TODO: Something indicating the thumbnail is not available.
    }}
  if (item) {
    // thumbnail
    this.panel.classList.add("thumbnail");
    this.thumbnail = _document.createElement("img");
    this.thumbnail.className = "hyperlink-panel-thumbnail";

    // loading spinner
    var spinnerImg = _document.createElement('img');
    spinnerImg.src = avp.getResourceUrl('res/ui/spinner.png');
    spinnerImg.classList.add('viewer-ext-hyperlink-thumbnail-spinner');
    this.panel.appendChild(spinnerImg);
    this.spinnerDiv = spinnerImg;

    requestThumbnailCb(dbId, bubbleNode, onGetThumbnail);
    this.panel.appendChild(this.thumbnail);
  } else
  {
    // external link
    this.panel.classList.add("link");
    this.externalLink = _document.createElement("div");
    this.externalLink.className = "hyperlink-panel-external-link";
    this.externalLink.textContent = link;
    this.panel.appendChild(this.externalLink);
  }

  // view button
  this.viewButton = _document.createElement("div");
  this.viewButton.className = "docking-panel-primary-button";
  this.viewButton.setAttribute("data-i18n", "View");
  this.viewButton.textContent = av.i18n.translate("View");
  this.panel.appendChild(this.viewButton);
  this.viewButton.addEventListener('click', function () {
    self.uninitialize();
    hyperlinkTool.panel = null;
    if (viewer.__hyperlinkBack) {
      viewer.__hyperlinkBack.uninitialize();
      viewer.__hyperlinkBack = null;
    }
    var currNode = viewer.model.getDocumentNode();
    hyperlinkTool.navigateToLink(link, bubbleNode);
    if (item) {
      // Cache the hyperlink back button information
      viewer.dispatchEvent({ type: av.HYPERLINK_NAVIGATE, data: { node: currNode } });
    }
  });

  // Set the triangle's position
  this.triangle.style.bottom = this.container.clientHeight - 85 + "px";

  this.boundsCheck();
};

av.GlobalManagerMixin.call(HyperlinkPanel.prototype);

HyperlinkPanel.prototype.uninitialize = function () {
  this.viewer.container.removeChild(this.container);
  this.container = null;
};

HyperlinkPanel.prototype.boundsCheck = function () {
  var containerBounds = this.viewer.navigation.getScreenViewport();
  var wi = this.container.clientWidth;
  var hi = this.container.clientHeight;
  var x1 = parseInt(this.container.style.left, 10);
  var y1 = parseInt(this.container.style.top, 10);

  var x2 = x1,y2 = y1;
  if (x1 < 0)
  x2 = 0;
  if (y1 < 0)
  y2 = 0;
  if (containerBounds.width < x1 + wi) {
    x2 = containerBounds.width - wi;
  }
  if (containerBounds.height < y1 + hi) {
    y2 = containerBounds.height - hi;
  }

  var distance = this.viewer.navigation.getEyeVector().length();
  var delta = this.viewer.impl.clientToViewport(x1, y1);
  var on = this.viewer.impl.clientToViewport(x2, y2);
  delta.subVectors(delta, on);
  this.viewer.navigation.panRelative(delta.x / 2, delta.y / 2, distance);

  this.container.style.left = x2 + "px";
  this.container.style.top = y2 + "px";
};

HyperlinkPanel.prototype.updatePosition = function () {
  var camera = this.viewer.navigation.getCamera();
  var containerBounds = this.viewer.navigation.getScreenViewport();

  var p = new THREE.Vector3().copy(this.intersectPoint);
  p.project(camera);

  var x = Math.round((p.x + 1) / 2 * containerBounds.width);
  var y = Math.round((-p.y + 1) / 2 * containerBounds.height);

  this.container.style.left = x + "px";
  this.container.style.top = y - 70 + "px"; // add the offset to let the triangle point to the position
};

aveh.HyperlinkPanel = HyperlinkPanel;

/***/ },

/***/ "./extensions/Hyperlink/HyperlinkTool.js"
/*!***********************************************!*\
  !*** ./extensions/Hyperlink/HyperlinkTool.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HyperlinkTool: () => (/* binding */ HyperlinkTool)
/* harmony export */ });
/* harmony import */ var _HyperlinkGui_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./HyperlinkGui.js */ "./extensions/Hyperlink/HyperlinkGui.js");
/* harmony import */ var _HyperlinkBack_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./HyperlinkBack.js */ "./extensions/Hyperlink/HyperlinkBack.js");


var av = Autodesk.Viewing;
var avp = av.Private;
var aveh = AutodeskNamespace('Autodesk.Viewing.Extensions.Hyperlink');




const bBoxOverlayName = 'Hyperlink-bBox';
const bBoxSelectOverlayName = 'Hyperlink-bBox-select';

class HyperlinkTool extends av.ToolInterface {
  #viewer;
  #hyperlinkExtension;

  #dbId = -1;
  #dragging = false;
  #linkCache2d = {};
  #linkCache3d = {};
  #tooltip = null;
  #dbIdToIndex = null;

  #stringDbIds = null;
  #stringBoxes = null;
  #thumbnailCache = {};

  #bBoxMaterial = null;
  #bBoxSelectMaterial = null;
  #meshSelected = null;

  #modelHasHyperlinks = false;

  constructor(viewer, config, hyperlinkExtension) {
    super();
    this.setGlobalManager(viewer.globalManager);
    this.names = ['hyperlink'];

    this.#viewer = viewer;
    this.#hyperlinkExtension = hyperlinkExtension;

    this.active = false;

    this.panel = null; // hyperlink panel
    //this.back = null; // hyperlink back button

    /**
     * {number} Hexadecimal color for hyperlink. Default is 0x479299.
     */
    this.fillColor = config.hyperlinkColor || 0x479299;

    /**
     * {number} Hyperlink opacity property. 1 is opaque, 0 is transparent.
     */
    this.opacity = config.hyperlinkOpacity || 0.6;

    /**
     * {number} Hexadecimal color for selected hyperlinks. Default is 0xff7f50.
     */
    this.selectionFillColor = config.hyperlinkColorSelection || 0x708cde;

    /**
     * {number} Hyperlink opacity property. 1 is opaque, 0 is transparent.
     */
    this.selectedOpacity = config.hyperlinkOpacitySelected || 0.4;

    /**
     * {number} Padding added to the hyperlink rectangle.
     */
    this.rectanglePadding = config.hyperlinkPadding || 0.5;
  }

  #showTooltip(x, y, intersectPoint) {
    if (!this.#tooltip) {
      const _document = this.getDocument();
      this.#tooltip = _document.createElement('div');
      this.#viewer.container.appendChild(this.#tooltip);

      this.#tooltip.setAttribute("data-i18n", "Ctrl + Click to preview the link");
      this.#tooltip.textContent = av.i18n.translate("Ctrl + Click to preview the link");
    }
    this.#tooltip.className = 'hyperlink-tooltip';
    this.#tooltip.style.top = y + 20 + 'px';
    this.#tooltip.style.left = x + 20 + 'px';
    this.#tooltip.intersectPoint = intersectPoint;
  }

  #hideTooltip() {
    if (this.#tooltip) {
      this.#viewer.container.removeChild(this.#tooltip);
      this.#tooltip = null;
    }
  }

  #updateTooltipPosition() {
    if (this.#tooltip) {
      var camera = this.#viewer.navigation.getCamera();
      var containerBounds = this.#viewer.navigation.getScreenViewport();

      var p = new THREE.Vector3().copy(this.#tooltip.intersectPoint);
      p.project(camera);

      var x = Math.round((p.x + 1) / 2 * containerBounds.width);
      var y = Math.round((-p.y + 1) / 2 * containerBounds.height);

      this.#tooltip.style.left = x + 20 + "px";
      this.#tooltip.style.top = y + 20 + "px";
    }
  }

  #onGeometryLoaded = (event) => {
    this.#viewer.removeEventListener(av.GEOMETRY_LOADED_EVENT, this.#onGeometryLoaded);
    this.loadHyperlinks();
  };

  #onCameraChange = () => {
    if (this.panel) {
      this.panel.updatePosition();
    }
    this.#updateTooltipPosition();
  };

  #onHyperlinkNavigation = (event) => {
    this.setBackNode(event.data.node);
  };

  activate(name) {
    const viewer = this.#viewer;
    this.active = true;
    if (viewer.model && viewer.model.isLoadDone()) {
      this.loadHyperlinks();
    } else
    {
      viewer.addEventListener(av.GEOMETRY_LOADED_EVENT, this.#onGeometryLoaded);
    }
    viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this.#onCameraChange);
    viewer.addEventListener(av.HYPERLINK_NAVIGATE, this.#onHyperlinkNavigation);

    const backNode = this.getBackNode();
    if (backNode) {
      viewer.__hyperlinkBack = new _HyperlinkBack_js__WEBPACK_IMPORTED_MODULE_1__.HyperlinkBack(this, viewer, backNode);
      this.setBackNode(null);
    }
  }

  deactivate(name) {
    const viewer = this.#viewer;
    this.active = false;
    viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this.#onCameraChange);
    viewer.removeEventListener(av.GEOMETRY_LOADED_EVENT, this.#onGeometryLoaded);
    viewer.removeEventListener(av.HYPERLINK_NAVIGATE, this.#onHyperlinkNavigation);

    this.#linkCache2d = {};
    this.#linkCache3d = {};
    this.#hideTooltip();
    if (this.panel) {
      this.panel.uninitialize();
      this.panel = null;
    }
    if (viewer.__hyperlinkBack) {
      viewer.__hyperlinkBack.uninitialize();
      viewer.__hyperlinkBack = null;
    }
    viewer.impl.clearOverlay(bBoxOverlayName);
    viewer.impl.clearOverlay(bBoxSelectOverlayName);
  }

  isActive() {
    return this.active;
  }

  update(timestamp) {
    return false;
  }

  handleSingleClick(event, button) {
    const viewer = this.#viewer;

    this.clearSelection();
    if (this.panel) {
      this.panel.uninitialize();
      this.panel = null;
    }

    var docNode = viewer.model.getDocumentNode();
    var viewableID = null;
    if (docNode) {
      viewableID = docNode.data.viewableID;
    }
    var position = new THREE.Vector2(event.canvasX, event.canvasY);

    if (!this.#modelHasHyperlinks) {
      return false;
    }
    // 2D
    if (viewer.model.is2d()) {
      var viewportCoords = viewer.impl.clientToViewport(event.canvasX, event.canvasY);
      var intersectPoint = viewer.impl.intersectGroundViewport(viewportCoords);

      for (var index in this.#linkCache2d) {

        if (!this.#linkCache2d.hasOwnProperty(index))
        continue;

        var hyperLink = this.#linkCache2d[index];
        var x = intersectPoint.x;
        var y = intersectPoint.y;
        if (x >= hyperLink.bBox[0] && x <= hyperLink.bBox[2] && y >= hyperLink.bBox[1] && y <= hyperLink.bBox[3]) {
          // Internal links
          if (hyperLink.node) {
            var title = hyperLink.node.data.name;
            this.panel = new _HyperlinkGui_js__WEBPACK_IMPORTED_MODULE_0__.HyperlinkPanel(this, viewer, position, intersectPoint, title, hyperLink.link, viewableID, hyperLink.dbId, hyperLink.node, this.getThumbnail.bind(this));
          }
          // external links
          else {
            this.panel = new _HyperlinkGui_js__WEBPACK_IMPORTED_MODULE_0__.HyperlinkPanel(this, viewer, position, intersectPoint, null, hyperLink.link, viewableID);
          }
          this.highlightSelection(hyperLink.bBoxMesh);
          return true;
        }
      }

      return false;
    }

    // 3D
    if (viewer.model.is3d()) {

      var result = viewer.impl.hitTest(event.canvasX, event.canvasY, false);
      if (!result)
      return false;

      if (event.ctrlKey && this.#linkCache3d[this.#dbId]) {
        this.controller.setIsLocked(false);
        this.#hideTooltip();
        var hyperLink = this.#linkCache3d[this.#dbId];
        // Internal links
        if (hyperLink.node) {
          var title = hyperLink.node.data.name;
          this.panel = new _HyperlinkGui_js__WEBPACK_IMPORTED_MODULE_0__.HyperlinkPanel(this, viewer, position, result.intersectPoint, title, hyperLink.link, viewableID, this.#dbId, hyperLink.node.data, this.getThumbnail.bind(this));
        }
        // external links
        else {
          this.panel = new _HyperlinkGui_js__WEBPACK_IMPORTED_MODULE_0__.HyperlinkPanel(this, viewer, position, result.intersectPoint, null, hyperLink.link, viewableID, this.#dbId);
        }
        return true;
      }
    }
    return false;
  }

  handleButtonDown(event, button) {
    this.#dragging = true;
    return false;
  }

  handleButtonUp(event, button) {
    this.#dragging = false;
    return false;
  }

  /**
   * Specialize base class implementation
   */
  handleMouseMove(event) {
    const viewer = this.#viewer;
    if (this.#dragging) {
      return;
    }

    if (!this.#modelHasHyperlinks) {
      return false;
    }

    if (viewer.model && !viewer.model.is2d()) {
      var result = viewer.impl.hitTest(event.canvasX, event.canvasY, false);
      if (result) {
        var dbId = result.dbId;
        if (dbId != this.#dbId) {
          this.#dbId = dbId;
          this.#hideTooltip();
        }

        // Don't show tooltip for the same object when the popup is shown
        if (this.panel && this.panel.dbId === dbId) {
          return;
        }

        // We're checking the hyperlinks lazily which means that their 1st appearance may be delayed.
        // If this is a problem, consider preloading hyperlinks during HyperlinkTool activation.
        if (this.#linkCache3d.hasOwnProperty(this.#dbId)) {
          if (this.#linkCache3d[this.#dbId]) {
            this.#showTooltip(event.canvasX, event.canvasY, result.intersectPoint);
          }
        } else
        {
          this.#linkCache3d[this.#dbId] = null;
          this.loadHyperlink3d(this.#dbId, event.canvasX, event.canvasY, result.intersectPoint);
        }
      } else
      {
        this.#hideTooltip();
      }
    }
    return false;
  }


  getCursor() {
    return this.#tooltip ? 'pointer' : null;
  }

  loadHyperlinks() {
    if (this.#viewer.model.isPdf()) {
      this.loadHyperlinksPDF();
    } else {
      this.loadHyperlinksF2d();
    }
  }

  loadHyperlinksPDF() {
    const viewer = this.#viewer;
    if (viewer.model.getData().metadata && viewer.model.getData().metadata.hyperLinks) {
      this.#modelHasHyperlinks = true;
      var hyperLinks = viewer.model.getData().metadata.hyperLinks;
      this.#dbIdToIndex = {};
      this.#stringDbIds = [];
      this.#stringBoxes = [];
      this.rectanglePadding = 0;

      for (var i = 0; i < hyperLinks.length; i++) {
        var link = hyperLinks[i];
        this.#dbIdToIndex[link.dbId] = [i];
        this.#stringDbIds.push(link.dbId);
        this.#stringBoxes.push(link.box[0], link.box[1], link.box[2], link.box[3]);
      }

      this._onBulkProperties(hyperLinks, viewer.model);
    } else {
      this.#modelHasHyperlinks = false;
    }
  }

  /**
   * Load hyperlinks for 2D models.
   */
  loadHyperlinksF2d() {
    const viewer = this.#viewer;
    const model = viewer.model;

    // Check if the model has hyperlinks
    if (!this.#modelHasHyperlinks) {
      const pdbLoader = model.getPropertyDb();
      if (pdbLoader) {
        pdbLoader.
        executeUserFunction(`function userFunction(pdb) {
                    var hyperlinkExists = false;
                    pdb.enumAttributes(function(i, attrDef, attrRaw) {
                        var name = attrRaw[0];
                        if (name === 'hyperlink') {
                            hyperlinkExists = true;
                            return true;
                        }
                    });
                    return hyperlinkExists;
                }`).
        then((hasHyperlinks) => {
          model === viewer.model && (this.#modelHasHyperlinks = hasHyperlinks);
        }).
        catch(function (err) {
          const message = typeof err === 'string' ? err : JSON.stringify(err);
          avp.logger.error(`Failed calling executeUserFunction with error ${message}`);
        });
      }
    }

    var data = model.getData();
    this.#stringDbIds = data.stringDbIds;
    this.#stringBoxes = data.stringBoxes;
    this.#linkCache2d = {};

    // We only need to check the dbIds in stringDbIds, since
    // hyperlinks are associated with texts in 2d drawing.
    if (!this.#stringDbIds)
    return;

    // #stringDbIds contains duplicate dbIds and also negative dbIds, which are
    // placeholders for text-only geometry without any property database entry.
    // Need to remove the negative dbIds and delete all other duplicates.
    var uniqueDbIds = [];
    this.#dbIdToIndex = {};
    for (var i = 0, len = this.#stringDbIds.length; i < len; ++i) {

      var candidateId = this.#stringDbIds[i];
      if (candidateId < 1)
      continue;

      if (uniqueDbIds.indexOf(candidateId) === -1) {
        uniqueDbIds.push(candidateId);
        this.#dbIdToIndex[candidateId] = [];
      }

      this.#dbIdToIndex[candidateId].push(i);
    }

    // Ignore error function callback.
    model.getBulkProperties(uniqueDbIds, { propFilter: ['hyperlink'] }, (results) => this._onBulkProperties(results, model));
  }

  /**
   * Parses results from model.getBulkProperties() to initialize hyperlinks on-canvas.
   *
   * @private
   */
  _onBulkProperties(results, model) {
    if (!this.active || model !== this.#viewer.model) return;

    // Get bubble manifest.
    var docNode = model.getDocumentNode();
    if (docNode) {
      docNode = docNode.getRootNode();
    }

    for (var i = 0, len = results.length; i < len; ++i) {
      var result = results[i];
      var dbId = result.dbId;
      var propValue = result.properties[0].displayValue;
      var linkToNode = null; // Object reference
      var link = null; // string

      // Is it a reference to another Document viewable?
      var candidates = docNode ? docNode.search({ 'viewableID': propValue }) : null;
      if (candidates && candidates.length) {
        linkToNode = candidates[0];
      }
      // Or a URL, maybe?
      if (!linkToNode && this._isURL(propValue)) {
        link = propValue;
      }

      if (!linkToNode && !link)
      continue;

      // Cache it
      var indices = this.#dbIdToIndex.hasOwnProperty(dbId) ? this.#dbIdToIndex[dbId] : [];
      for (var x = 0; x < indices.length; ++x) {

        var index = indices[x];
        this.#linkCache2d[index] = {
          dbId: dbId,
          link: link,
          node: linkToNode
        };

        // Highlight the bounding box of text with hyperlink
        this.highlightText(index);
      }

    }
  }

  /**
   * TODO: Refactor to common place.
   *
   * @private
   */
  _isURL(str) {

    //
    // We could have a complex RegExp, but I'm going with a simple check for URLs.
    //
    if (typeof str !== 'string')
    return;

    // check http protocol, it's the only one we care about.
    var protocol = str.substr(0, 4).toLowerCase();
    if (protocol === 'http')
    return true;

    // Find first '/' ...
    var firstSlash = str.indexOf('/');
    if (firstSlash !== -1) {
      // ... and get rid of the rest...
      str = str.substr(0, firstSlash);
    }

    // If there is a slash, check that str has at least 1 dot. Example: autodesk.com/something
    var dotCount = str.split('.').length;
    if (firstSlash > 0 && dotCount > 0)
    return true;

    // If there is no slash, check that the url has at least 2 dots. Example: www.autodesk.com
    if (firstSlash === -1 && dotCount > 1)
    return true;

    // Add more checks as needed...

    return false;
  }

  navigateToLink(link, bubbleNode) {

    if (link) {
      const _window = this.getWindow();
      _window.open(link);
      return;
    }

    if (bubbleNode) {
      this.#viewer.dispatchEvent({ type: av.HYPERLINK_EVENT, data: { bubbleNode: bubbleNode } });

      // Load the new model
      setTimeout(() => {
        let rootNode = bubbleNode.getRootNode();
        this.#viewer.loadDocumentNode(rootNode.getDocument(), bubbleNode);
      }, 1);

      return;
    }
  }

  loadHyperlink3d(dbId, x, y, intersectPoint) {
    const viewer = this.#viewer;
    viewer.getProperties(dbId, (result) => {
      var props = result.properties;
      for (var i = 0, len = props.length; i < len; i++) {
        var prop = props[i];
        if (prop.displayCategory === '__hyperlink__') {
          var linkToNode = null;
          var link = prop.displayValue;
          var docNode = viewer.model.getDocumentNode();
          if (docNode) {
            docNode = docNode.getRootNode();
            var candidates = docNode.search({ 'viewableID': link });
            if (candidates && candidates.length) {
              linkToNode = candidates[0];
            }
          }
          this.#linkCache3d[dbId] = {
            link: link,
            node: linkToNode
          };

          this.#showTooltip(x, y, intersectPoint);

          break;
        }
      }
    });
  }

  getHyperlinks() {
    return _linkCache;
  }

  /**
   * @param {string} item - Document item.
   */
  getThumbnail(dbId, bubbleNode, callback) {

    if (this.#thumbnailCache.hasOwnProperty(dbId)) {
      callback(this.#thumbnailCache[dbId]);
      return;
    }

    av.Thumbnails.getUrlForBubbleNode(bubbleNode).
    then((srcUrl) => {
      this.#thumbnailCache[dbId] = srcUrl;
      callback(srcUrl);
    }).
    catch((err) => {
      callback(null);
    });
  }


  highlightText(index) {
    var padding = this.rectanglePadding;
    var minX = this.#stringBoxes[index * 4] - padding;
    var minY = this.#stringBoxes[index * 4 + 1] - padding;
    var maxX = this.#stringBoxes[index * 4 + 2] + padding;
    var maxY = this.#stringBoxes[index * 4 + 3] + padding;
    this.#linkCache2d[index].bBox = [minX, minY, maxX, maxY];

    // draw a rectangle with these values.
    this.addRectangle(index, minX, minY, maxX, maxY);
  }

  addRectangle(index, minX, minY, maxX, maxY) {

    var z = 0;

    const points = [
    new THREE.Vector3(minX, minY, z),
    new THREE.Vector3(maxX, minY, z),
    new THREE.Vector3(maxX, maxY, z),

    new THREE.Vector3(minX, minY, z),
    new THREE.Vector3(minX, maxY, z),
    new THREE.Vector3(maxX, maxY, z)];

    let geom = new THREE.BufferGeometry().setFromPoints(points);


    if (!this.#bBoxMaterial) {
      var color = this.fillColor;
      var opacity = this.opacity;

      this.#bBoxMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
        color: color,
        opacity: opacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      this.#viewer.impl.createOverlayScene(bBoxOverlayName);
    }

    var mesh = this.#linkCache2d[index].bBoxMesh = new THREE.Mesh(geom, this.#bBoxMaterial, true);

    this.#viewer.impl.addOverlay(bBoxOverlayName, mesh);

  }

  highlightSelection(mesh) {
    this.#meshSelected = mesh;
    this.#viewer.impl.removeOverlay(bBoxOverlayName, mesh);

    if (!this.#bBoxSelectMaterial) {
      var color = this.selectionFillColor;;
      var opacity = this.selectedOpacity;

      this.#bBoxSelectMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
        color: color,
        opacity: opacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      this.#viewer.impl.createOverlayScene(bBoxSelectOverlayName);
    }

    var newMesh = new THREE.Mesh(mesh.geometry, this.#bBoxSelectMaterial);
    this.#viewer.impl.addOverlay(bBoxSelectOverlayName, newMesh);
  }

  clearSelection() {
    if (this.#meshSelected) {
      this.#viewer.impl.clearOverlay(bBoxSelectOverlayName);

      this.#viewer.impl.addOverlay(bBoxOverlayName, this.#meshSelected);
      this.#meshSelected = null;
    }
  }

  setBackNode(node) {
    const cache = this.#hyperlinkExtension.getCache();
    cache.hyperlinkBackNode = node;
  }

  getBackNode() {
    const cache = this.#hyperlinkExtension.getCache();
    return cache.hyperlinkBackNode;
  }
}

av.GlobalManagerMixin.call(HyperlinkTool.prototype);
avp.usePrototypeToolMethods(HyperlinkTool);

aveh.HyperlinkTool = HyperlinkTool;

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Hyperlink/Hyperlink.css"
/*!********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Hyperlink/Hyperlink.css ***!
  \********************************************************************************************************************************************************************************************************************************************************/
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
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-viewing-viewer .hyperlink-tooltip {
  display: block;
  position: absolute;
  left: 0px;
  top: 0px;
  padding: 4px;
  background-color: rgba(196, 196, 196, 0.8);
  box-shadow: 0px 1px 3px rgba(0, 0, 0, 0.3);
  font-size: 12px;
  text-align: center;
  line-height: 1.2;
  white-space: nowrap;
}

.adsk-viewing-viewer .hyperlink-container {
  position: absolute;
  width: 250px;
  z-index: 10;
}

.adsk-viewing-viewer .hyperlink-container-triangle {
  position: relative;
  display: inline-block;
  width: 0;
  height: 0;
  border-top: 11px solid transparent;
  border-bottom: 11px solid transparent;
  z-index: 3;
}

.adsk-viewing-viewer .hyperlink-panel {
  display: inline-block;
  width: 300px;
}

.adsk-viewing-viewer .hyperlink-panel.thumbnail {
  width: 220px;
}

.adsk-viewing-viewer .hyperlink-panel-title {
  padding: 10px 5px 5px 10px;
}

.adsk-viewing-viewer .hyperlink-panel-thumbnail {
  display: block;
  background: #FFFFFF;
  margin: 3px 0px 10px 10px;
  width: 200px;
  height: 200px;
}

.adsk-viewing-viewer .hyperlink-panel-external-link {
  font-size: 12px;
  margin: 5px 10px 10px 10px;
  padding: 5px 5px 5px 5px;
  max-height: 300px;
  word-break: break-all;
  -webkit-user-select: text;
  -khtml-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
  user-select: text;
}

.adsk-viewing-viewer .hyperlink-panel-view-button {
  background-color: #6892C6;
  /*height : 27px;*/
  text-align: center;
  padding: 7px 0px;
  margin: 0px 10px 10px 10px;
  border-radius: 1px;
  -moz-border-radius: 1px;
  -webkit-border-radius: 1px;
  cursor: pointer;
}

.adsk-viewing-viewer .hyperlink-back {
  position: absolute;
  width: 106px;
  height: 38px;
  left: 10px;
  top: 10px;
}

.adsk-viewing-viewer .hyperlink-back-button {
  top: 0;
  left: 0;
  width: 70%;
  cursor: pointer;
  text-align: center;
  position: absolute;
}

.adsk-viewing-viewer .docking-panel-close.hyperlink-back-closer {
  width: 30%;
  cursor: pointer;
  background-position: 3px 12px;
  height: 100%;
}

.adsk-viewing-viewer .viewer-ext-hyperlink-thumbnail-spinner {
  position: absolute;
  top: 104px;
  left: 77px;
  animation: loading-spinner-perpetual-motion 1s infinite linear; /* from styles.css */
  width: 60px;
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

/***/ "./extensions/Hyperlink/Hyperlink.css"
/*!********************************************!*\
  !*** ./extensions/Hyperlink/Hyperlink.css ***!
  \********************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Hyperlink_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./Hyperlink.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Hyperlink/Hyperlink.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Hyperlink_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Hyperlink_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Hyperlink_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Hyperlink_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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
  !*** ./extensions/Hyperlink/Hyperlink.js ***!
  \*******************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HyperlinkExtension: () => (/* binding */ HyperlinkExtension)
/* harmony export */ });
/* harmony import */ var _HyperlinkTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./HyperlinkTool.js */ "./extensions/Hyperlink/HyperlinkTool.js");
/* harmony import */ var _Hyperlink_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./Hyperlink.css */ "./extensions/Hyperlink/Hyperlink.css");


var av = Autodesk.Viewing;
var aveh = AutodeskNamespace('Autodesk.Viewing.Extensions.Hyperlink');




/**
 * Enhances 2D models by adding in-canvas tooltips that on click will navigate
 * the user to another 2D or 3D model.
 *
 * The extension id is: `Autodesk.Hyperlink`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example
 * viewer.loadExtension('Autodesk.Hyperlink')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.HyperlinkExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
function HyperlinkExtension(viewer, options) {
  av.Extension.call(this, viewer, options);
  this.tool = null;
  this.name = 'hyperlink';
}

HyperlinkExtension.prototype = Object.create(av.Extension.prototype);
HyperlinkExtension.prototype.constructor = HyperlinkExtension;

/**
 * Registers the hyperlink tool that will intercept pointer events to provide
 * hyperlinks next to specific nodes in the model.
 *
 * @alias Autodesk.Viewing.Extensions.HyperlinkExtension#load
 * @public
 */
HyperlinkExtension.prototype.load = function () {
  var toolConfig = this.options || {};
  this.tool = new _HyperlinkTool_js__WEBPACK_IMPORTED_MODULE_0__.HyperlinkTool(this.viewer, toolConfig, this);
  this.viewer.toolController.registerTool(this.tool);
  this.viewer.toolController.activateTool(this.tool.getName());
  return true;
};

/**
 * Unregisters the hyperlink tool.
 *
 * @alias Autodesk.Viewing.Extensions.HyperlinkExtension#unload
 * @public
 */
HyperlinkExtension.prototype.unload = function () {
  this.viewer.toolController.deactivateTool(this.tool.getName());
  this.viewer.toolController.deregisterTool(this.tool);
  this.tool = null;
  return true;
};

HyperlinkExtension.prototype.activate = function () {
  return true;
};

HyperlinkExtension.prototype.deactivate = function () {
  return false;
};

aveh.HyperlinkExtension = HyperlinkExtension;
av.theExtensionManager.registerExtension('Autodesk.Hyperlink', HyperlinkExtension);
})();

Autodesk.Extensions.Hyperlink = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Hyperlink.js.map