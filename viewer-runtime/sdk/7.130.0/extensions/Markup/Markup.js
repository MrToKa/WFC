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

/***/ "./extensions/Markup/core/DomElementStyle.js"
/*!***************************************************!*\
  !*** ./extensions/Markup/core/DomElementStyle.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DomElementStyle: () => (/* binding */ DomElementStyle)
/* harmony export */ });


/**
 * Curring object which generate a string that can be used
 * as a Dom element's 'style' value.
 *
 * @constructor
 */
function DomElementStyle() {

  this.reset();
}

/*
 * Constants
 */
var BROWSER_PREFIXES = ['-ms-', '-webkit-', '-moz-', '-o-'];

var proto = DomElementStyle.prototype;

proto.reset = function () {

  this.attributes = {};
  this.dirty = false;
  this.styleString = '';

  return this;
};

/**
 *
 * @param {String} key
 * @param {*} value
 * @param {Object} [options]
 * @param {Boolean} [options.allBrowsers] - Whether to add browser prefix to key
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.Utils.DomeElemStyle}
 */
proto.setAttribute = function (key, value, options) {

  this.attributes[key] = value;

  if (options && options.allBrowsers) {
    var that = this;
    BROWSER_PREFIXES.forEach(function (prefix) {
      that.attributes[prefix + key] = value;
    });
  }
  this.dirty = true; // Could be optimized
  return this;
};

/**
 * Removes one or more attributes
 * @param {String|Array} key - Key or Keys to be removed
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.Utils.DomElemStyle} this
 */
proto.removeAttribute = function (key) {

  if (!Array.isArray(key)) {
    key = [key];
  }

  var self = this;
  key.forEach(function (k) {
    if (k in self.attributes) {
      delete self.attributes[k];
      self.dirty = true;
    }
  });
  return this;
};

/**
 * Gets the String representation of this style object
 * @returns {string}
 */
proto.getStyleString = function () {

  if (this.dirty) {
    this.styleString = generateStyle(this.attributes);
    this.dirty = false;
  }
  return this.styleString;
};

/**
 * Clones the current Object
 *
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.Utils.DomElemStyle}
 */
proto.clone = function () {

  var clone = new DomElementStyle();
  var attributes = this.attributes;

  for (var key in attributes) {
    clone.setAttribute(key, attributes[key]);
  }
  return clone;
};

/**
 * Generates the style value string. Non mutable function.
 *
 * @param {Object} attributes
 * @private
 */
function generateStyle(attributes) {

  var elements = [];
  for (var key in attributes) {
    var val = attributes[key];
    elements.push(key);
    elements.push(':');
    elements.push(val);
    elements.push('; ');
  }
  return elements.join('');
}

/***/ },

/***/ "./extensions/Markup/core/EditFrame.js"
/*!*********************************************!*\
  !*** ./extensions/Markup/core/EditFrame.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditFrame: () => (/* binding */ EditFrame)
/* harmony export */ });
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _edit_actions_CloneMarkup_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./edit-actions/CloneMarkup.js */ "./extensions/Markup/core/edit-actions/CloneMarkup.js");
/* harmony import */ var _edit_actions_SetPosition_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./edit-actions/SetPosition.js */ "./extensions/Markup/core/edit-actions/SetPosition.js");
/* harmony import */ var _edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-actions/SetSize.js */ "./extensions/Markup/core/edit-actions/SetSize.js");
/* harmony import */ var _edit_actions_SetRotation_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./edit-actions/SetRotation.js */ "./extensions/Markup/core/edit-actions/SetRotation.js");









var av = Autodesk.Viewing;
var avp = Autodesk.Viewing.Private;

/**
 * A component to handle the selection of markups.
 *
 *
 *      Sample
 *
 *      var containingDiv = document.getElementById('containingDiv3d-app-wrapper');
 *      var selectionComponent = new EditFrame(containingDiv);
 *      selectionComponent.setSelection(100, 100, 300, 150, 0);
 *
 * @param {HTMLElement} containingDiv The container where the selection layer will live.
 * @param {Object} editor
 * @constructor
 */
function EditFrame(containingDiv, editor) {

  this.containingDiv = containingDiv;
  this.editor = editor;
  this.setGlobalManager(this.editor.viewer.globalManager);
  this.selectionLayer = createSelectionLayer.bind(this)();

  this.frameMargin = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.EDIT_FRAME_DEFAULT_MARGIN;

  this.selection = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    element: null,
    active: false,
    dragging: false,
    resizing: false,
    //a dictionary of all the drag points
    //the key for each drag point will be its cardinal/ordinal direction
    handle: {}
  };

  createSelectorBox.bind(this)();

  if ((0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.isTouchDevice)()) {
    this.hammer = new av.Hammer.Manager(this.selectionLayer, {
      recognizers: [
      av.GestureRecognizers.drag,
      av.GestureRecognizers.doubletap,
      av.GestureRecognizers.doubletap2,
      av.GestureRecognizers.pan,
      av.GestureRecognizers.pinch],

      handlePointerEventMouse: false,
      inputClass: av.Hammer.TouchInput
    });

    this.onHammerDragBinded = this.onHammerDrag.bind(this);
    this.onHammerDoubleTapBinded = this.onHammerDoubleTap.bind(this);
    this.onTouchPanBinded = this.onTouchPan.bind(this);
    this.onTouchPinchBinded = this.onTouchPinch.bind(this);

    this.hammer.on("dragstart dragmove dragend", this.onHammerDragBinded);
    this.hammer.on("doubletap", this.onHammerDoubleTapBinded);
    this.hammer.on("doubletap2", this.onHammerDoubleTapBinded);
    this.hammer.on("panstart panmove panend", this.onTouchPanBinded);
    this.hammer.on("pinchstart pinchmove pinchend", this.onTouchPinchBinded);

    this.hammer.get('drag').requireFailure('pinch');
    this.hammer.get('drag').requireFailure('pan');
  }

  handleSelectionBoxDragging.bind(this)();
  handleSelectionBoxResizing.bind(this)();
  handleSelectionDoubleClick.bind(this)();
  handleSelectionBoxRotating.bind(this)();

  //add the selection into the container given to us
  this.containingDiv.appendChild(this.selectionLayer);

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.addTraitEventDispatcher)(this);
}

av.GlobalManagerMixin.call(EditFrame.prototype);
var proto = EditFrame.prototype;

proto.unload = function () {

  this.containingDiv.removeChild(this.selectionLayer);
  this.selectionLayer = null;
};
/**
 * Draws a selection box with the given attributes
 *
 * @param {number} x - The x coordinate to place the selection box
 * @param {number} y - The y coordinate to place the selection box
 * @param {number} width - The width of the selection box
 * @param {number} height - The height of the selection box
 * @param {number} rotation - The amount of degrees to rotate the selection box
 */
proto.setSelection = function (x, y, width, height, rotation) {

  var margin = this.frameMargin;
  var doubleMargin = margin * 2;

  updateSelectorBoxDimensions.bind(this)(width + doubleMargin, height + doubleMargin);
  updateSelectorBoxPosition.bind(this)(x - margin, y - margin, rotation);
  updateSelectionBoxState.bind(this)(true); //activate the selection box
  this.selectionLayer.style.visibility = 'visible';
};

/**
 * Displays the selection box based on the position, dimension, and rotation of a given markup
 *
 * @param {Autodesk.Viewing.Extensions.Markups.Core.Markup} markup - the markup that should appear as selected
 */
proto.setMarkup = function (markup) {

  this.hammer && this.hammer.set({ enable: markup !== null });
  this.markup = markup;

  updateSelectionBoxState.bind(this)(false);

  if (markup) {
    var boundingBox = markup.getBoundingRect();
    var rotation = markup.getRotation();
    this.frameMargin = boundingBox.margin !== undefined ? boundingBox.margin : _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.EDIT_FRAME_DEFAULT_MARGIN;

    this.setSelection(boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height, rotation);

    this.enableResizeHandles();
    this.enableRotationHandle();

    if (markup.preventReposition) {
      this.selectionLayer.firstChild.style.cursor = '';
    } else
    {
      this.selectionLayer.firstChild.style.cursor = 'move';
    }
  }
};

proto.startDrag = function (event) {

  if (this.markup && this.markup.preventReposition) return;

  this.onMouseMove = this._onRepositionMouseMove.bind(this);
  this.onMouseUp = this._onRepositionMouseUp.bind(this);
  this._onRepositionMouseDown(event, this.editor.getMousePosition());
};

proto.isActive = function () {
  return this.selection.active;
};

proto.isDragging = function () {

  return this.selection.dragging;
};

proto.isResizing = function () {

  return this.selection.resizing;
};

proto.isRotating = function () {

  return this.selection.rotating;
};

proto.onMouseMove = function (event) {


  //dummy fn
};
proto.onMouseUp = function (event) {

  //dummy fn
};
proto.onWheel = function (event) {
  this.editor.viewer.toolController.mousewheel(event);
};

proto.onTouchPan = function (event) {
  var gestureHandler = this.editor.viewer.toolController.getTool("gestures");
  gestureHandler.distributeGesture(event);
  event.preventDefault();
};

proto.onTouchPinch = function (event) {
  var gestureHandler = this.editor.viewer.toolController.getTool("gestures");
  gestureHandler.distributeGesture(event);
  event.preventDefault();
};

proto.onHammerDrag = function (event) {

  function updateEditorInput(input, parent, event) {

    //TODO: Change this when refactoring input in edit frame.
    var rect = parent.getBoundingClientRect();
    input.mousePosition.x = event.pageX - rect.left;
    input.mousePosition.y = event.pageY - rect.top;
  }

  //console.log('EditFrame drag ' + event.type);
  convertEventHammerToMouse(event);
  switch (event.type) {
    case 'dragstart':
      updateEditorInput(this.editor.input, this.editor.svg, event);
      this.editor.callSnapperMouseDown();
      // Check whether to translate, rotate or resize
      if (isRotatePoint(event.target)) {
        // Rotate
        this._onRotationMouseDown(event);
      } else if (isDragPoint(event.target)) {
        // Resize
        this._onResizeMouseDown(event);
      } else {
        this.startDrag(event);
      }
      event.preventDefault();
      break;
    case 'dragmove':
      updateEditorInput(this.editor.input, this.editor.svg, event);
      this.editor.callSnapperMouseMove();
      this.onMouseMove(event);
      event.preventDefault();
      break;
    case 'dragend':
      updateEditorInput(this.editor.input, this.editor.svg, event);
      this.onMouseUp(event);
      event.preventDefault();
      break;
  }
};

proto.onHammerDoubleTap = function (event) {

  function updateEditorInput(input, parent, event) {

    //TODO: Change this when refactoring input in edit frame.
    var rect = parent.getBoundingClientRect();
    input.mousePosition.x = event.pageX - rect.left;
    input.mousePosition.y = event.pageY - rect.top;
  }

  convertEventHammerToMouse(event);
  updateEditorInput(this.editor.input, this.editor.svg, event);

  this.selection.dragging = false;
  this.editor.editMode && this.editor.editMode.onMouseDoubleClick(this.markup);
};

proto.enableResizeHandles = function () {

  var markup = this.markup;
  var handle;

  if (markup.isHeightConstrained() || markup.isWidthConstrained()) {
    //hide all the handles
    for (var direction in this.selection.handle) {
      handle = this.selection.handle[direction];
      if (handle) handle.style.display = 'none';
    }

    //show only the resize points that are allowed
    if (!markup.isHeightConstrained()) {
      this.selection.handle['n'].style.display = 'block';
      this.selection.handle['s'].style.display = 'block';
    }
    if (!markup.isWidthConstrained()) {
      this.selection.handle['w'].style.display = 'block';
      this.selection.handle['e'].style.display = 'block';
    }
  } else {
    //no constraints, show all resize handles
    for (let direction in this.selection.handle) {
      handle = this.selection.handle[direction];
      if (handle) handle.style.display = 'block';
    }
  }
};

proto.enableRotationHandle = function () {

  var markup = this.markup;
  var display = markup.isRotationConstrained() ? 'none' : 'block';
  this.selection.rotationHandle.style.display = display;
  this.selection.rotationBridge.style.display = display;
};

function convertEventHammerToMouse(event) {
  // Convert Hammer touch-event X,Y into mouse-event X,Y.
  event.pageX = event.pointers[0].clientX;
  event.pageY = event.pointers[0].clientY;
}

/**
 * Creates an element spanning the full height and width of its parent.
 * It serves as our surface to draw the selection box.
 *
 * @return {HTMLElement}
 */
function createSelectionLayer() {

  const _document = this.getDocument();
  var selectionLayer = _document.createElement('div');
  selectionLayer.style.position = 'absolute';
  selectionLayer.style.top = 0;
  selectionLayer.style.bottom = 0;
  selectionLayer.style.left = 0;
  selectionLayer.style.right = 0;
  //don't let the selection box be visible outside the selection layer
  selectionLayer.style.overflow = 'hidden';
  selectionLayer.style.visibility = 'hidden';
  togglePointerEvents(selectionLayer, false);
  return selectionLayer;
}

/**
 * Creates a single drag point with the corresponding styles
 *
 * @param {number} diameter - The size of the drag point
 * @param {string} position - The cardinal(n, s, w, e) or ordinal(nw, nw, sw, se) direction of the point
 * @return {HTMLElement}
 */
function createDragPoint(position) {

  const _document = this.getDocument();
  var point = _document.createElement('div');

  setResizeCursor(point, position);
  point.className = 'selector-drag-point autodesk-markups-extension-core-make-me-bigger sdp-handle-' + position;
  point.classList.add('adsk-viewing-viewer');
  point.setAttribute('data-sdp-handle', position);

  return point;
}

function createRotatePoint() {
  const _document = this.getDocument();
  var point = _document.createElement('div');
  point.classList.add('adsk-viewing-viewer');
  point.classList.add('selector-rotate-point');
  point.classList.add('autodesk-markups-extension-core-make-me-bigger');
  setResizeCursor(point, 'w');

  return point;
}

function createRotationBridge() {
  const _document = this.getDocument();
  var rotationBridge = _document.createElement('div');
  rotationBridge.classList.add('adsk-viewing-viewer');
  rotationBridge.classList.add('selector-rotate-point');
  rotationBridge.classList.add('autodesk-markups-extension-core-make-me-bigger');
  rotationBridge.classList.add('rotation-bridge');
  setResizeCursor(rotationBridge, 'w');

  return rotationBridge;
}

function setResizeCursor(element, direction) {

  var cursor;
  switch (direction) {
    case 'n':
    case 's':
      cursor = 'ns-resize';
      break;
    case 'w':
    case 'e':
      cursor = 'ew-resize';
      break;
    case 'ne':
    case 'sw':
      cursor = 'nesw-resize';
      break;
    case 'nw':
    case 'se':
      cursor = 'nwse-resize';
      break;
  }
  element.style.cursor = cursor;
}

/**
 * Creates the 8 drag points of the selection box.
 *
 * @this EditFrame
 */
function createDragPoints(selector) {

  ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(function (direction) {
    //store the drag point and put it in the DOM
    this.selection.handle[direction] = createDragPoint.call(this, direction);
    selector.appendChild(this.selection.handle[direction]);
  }.bind(this));
}

/**
 * Determines if an element is a drag point
 *
 * @return {boolean}
 */
function isDragPoint(element) {

  return matchesSelectorAux(element, '.selector-drag-point');
}

/**
 * Determines if an element is a rotate point
 *
 * @return {boolean}
 */
function isRotatePoint(element) {

  return matchesSelectorAux(element, '.selector-rotate-point');
}

/**
 * Creates the element that will be used as the selection box. It also
 * takes care of adding the drag handles
 *
 * @return {HTMLElement} - the selection box
 * @this EditFrame
 */
function createSelectorBox() {

  const _document = this.getDocument();
  var selectorBox = _document.createElement('div');
  togglePointerEvents(selectorBox, true);
  selectorBox.classList.add('selector-box');

  this.selection.rotationBridge = createRotationBridge.bind(this)();
  selectorBox.appendChild(this.selection.rotationBridge);

  this.selection.rotationHandle = createRotatePoint.bind(this)();
  selectorBox.appendChild(this.selection.rotationHandle);

  createDragPoints.bind(this)(selectorBox);

  //store the selector box
  this.selection.element = selectorBox;

  if (!av.isMobileDevice()) {
    this.onWheelBinded = this.onWheel.bind(this);
    this.selection.element.addEventListener('wheel', this.onWheelBinded);
    this.selection.element.addEventListener('DOMMouseScroll', this.onWheelBinded); // firefox
  }

  //add the selection box to the selection layer
  this.selectionLayer.appendChild(this.selection.element);

  //we are just creating the box, start it out hidden
  updateSelectionBoxState.bind(this)(false);

  return selectorBox;
}

/**
 * Utility to create the CSS translate3d value from a given 2d point
 *
 * @param {number} x - coordinate
 * @param {number} y - coordinate
 * @return {string}
 */
function toTranslate3d(x, y) {

  return 'translate3d(' + x + 'px,' + y + 'px,0)';
}


/**
 * Updates the display state of the selection box
 *
 * @param {boolean} active - The new state of the the selection box
 * @this EditFrame
 */
function updateSelectionBoxState(active) {

  this.selection.active = active;
  this.selection.element.style.display = active ? 'block' : 'none';
}

/**
 * Updates the position and rotation of the selection box.
 *
 * @param {number} x - The x coordinate to place the selection box
 * @param {number} y - The y coordinate to place the selection box
 * @param {number} rotation - The amount of degrees to rotate the selection box
 * @this EditFrame
 */
function updateSelectorBoxPosition(x, y, rotation) {

  this.selection.x = x;
  this.selection.y = y;
  this.selection.rotation = rotation;
  var size = this.markup.getBoundingRect();
  //TODO: consider DomElementStyle

  size.width += this.frameMargin * 2;
  size.height += this.frameMargin * 2;

  var transform = toTranslate3d(x, y) + ' rotate(' + rotation + 'rad)';
  var transformOrigin = size.width / 2 + 'px ' + size.height / 2 + 'px';

  this.selection.element.style.msTransform =
  this.selection.element.style.webkitTransform =
  this.selection.element.style.transform = transform;
  this.selection.element.style.msTransformOrigin =
  this.selection.element.style.webkitTransformOrigin =
  this.selection.element.style.transformOrigin = transformOrigin;
}

/**
 * Updates the dimensions of the selection box (width and height).
 *
 * @param {number} width - The new width of the selection box
 * @param {number} height - The new height of the selection box
 * @this EditFrame
 */
function updateSelectorBoxDimensions(width, height) {

  this.selection.width = width;
  this.selection.height = height;
  this.selection.element.style.width = width + 'px';
  this.selection.element.style.height = height + 'px';
}

/**
 * Attaches all the necessary listeners to handle a drag action.
 *
 * @this EditFrame
 */
function handleSelectionBoxDragging() {

  this.selection.element.addEventListener('mousedown', this._onRepositionMouseDown.bind(this));
}

/**
 * Handles panning when right clicking down
 * @param event
 * @returns {boolean} returns true if the event was handled
 * @private
 */
proto._handleRightClickDown = function (event) {

  if (!av.isMobileDevice() && (avp.isRightClick(event, this.editor.viewer.navigation) || avp.isMiddleClick(event))) {
    this.editor.input.onMouseDownRightClick(event);
    return true;
  }

  return false;
};

var ignoreFirstMouseMove = false;
proto._onRepositionMouseDown = function (event, cursor) {

  if (this._handleRightClickDown(event))
  return;

  // Return for markups that are not allowed to be repositioned.
  if (this.markup && this.markup.preventReposition) return;

  // ignore the first mouse move for the Microsoft Surface
  ignoreFirstMouseMove = !av.isMobileDevice() && av.isTouchDevice();
  //a synthetic start means that the event was triggered manually and not as a
  //result of a mousedown on the edit frame
  const _window = this.getWindow();
  var syntheticStart = !(event instanceof _window.MouseEvent);

  //during a real mousedown, ignore events originating from a resizing handle
  if (!syntheticStart && (isDragPoint(event.target) || isRotatePoint(event.target))) return;

  //get the cursor position
  cursor = syntheticStart ? cursor : this.editor.getMousePosition();

  //store the initial cursor and axis constrains
  this.initialCursor = cursor;
  this.initialPosition = this.markup.getClientPosition();
  this.areAxisConstrained = false;
  this.axisConstrains = new THREE.Vector2(1, 1);

  //update the function that will handle the mousemove and mouseup events
  this.onMouseMove = this._onRepositionMouseMove.bind(this);
  this.onMouseUp = this._onRepositionMouseUp.bind(this);

  if (this.selection.dragging)
  return;

  this.selection.dragging = true;
  this.editor.beginActionGroup();

  //if alt down I drop a clone.
  if (event && event.altKey) {
    var editor = this.editor;
    var cloneMarkup = new _edit_actions_CloneMarkup_js__WEBPACK_IMPORTED_MODULE_2__.CloneMarkup(editor, editor.getId(), this.markup, this.markup.position);
    cloneMarkup.execute();
  }

  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_START }); // Moving around
};

proto._onRepositionMouseMove = function (event) {

  // This check is needed for selecting markups on devices that have touch screen + mouse (eg: Microsoft Surface)
  if (ignoreFirstMouseMove) {
    ignoreFirstMouseMove = false;
    return false;
  }
  //ignore mousemove events if the dragging state hasn't been activated
  if (!this.selection.dragging || !this.markup || this.markup.preventReposition) return false;

  //get the position of the cursor relative to selection layer
  var cursor = this.editor.getMousePosition();

  //constrain axis if shift key is down.
  var constrainAxis = this.editor.input.constrainAxis;
  if (this.areAxisConstrained !== constrainAxis) {
    this.areAxisConstrained = constrainAxis;
    this.axisConstrains = constrainAxis ? new THREE.Vector2(0, 0) : new THREE.Vector2(1, 1);

    this.initialPosition.x += cursor.x - this.initialCursor.x;
    this.initialPosition.y += cursor.y - this.initialCursor.y;

    this.initialCursor.x = cursor.x;
    this.initialCursor.y = cursor.y;
  }

  //determine how many pixel we have to shift the
  //selection box to keep the cursor on the drag point
  var movement = {
    x: cursor.x - this.initialCursor.x,
    y: cursor.y - this.initialCursor.y
  };

  var deadZone = 15;
  if (this.axisConstrains.x === 0 && this.axisConstrains.y === 0) {

    if (Math.abs(movement.x) > deadZone) {
      this.axisConstrains.x = 1;
      movement.x += movement.x < 0 ? deadZone : -deadZone;
    } else
    if (Math.abs(movement.y) > deadZone) {
      this.axisConstrains.y = 1;
      movement.y += movement.y < 0 ? deadZone : -deadZone;
    }
  }

  var x = this.initialPosition.x + movement.x * this.axisConstrains.x;
  var y = this.initialPosition.y + movement.y * this.axisConstrains.y;

  updateSelectorBoxPosition.bind(this)(x, y, this.selection.rotation);

  //tell the markup to start transforming
  //the markup expects an (x, y) coordinate that
  //uses an origin at the center, adjust our x, y because
  //our origin starts at the top left
  var position = this.editor.positionFromClientToMarkups(x, y);
  var setPosition = new _edit_actions_SetPosition_js__WEBPACK_IMPORTED_MODULE_3__.SetPosition(this.editor, this.markup, position);
  setPosition.execute();
  return true;
};

proto._onRepositionMouseUp = function () {

  if (this.markup && this.markup.preventReposition) return;

  this.last = null;

  //this should never be called after the mouse up because we are no longer repositioning
  this.onMouseMove = function () {/*do nothing*/};
  this.onMouseUp = function () {/*do nothing*/};

  if (!this.selection.dragging) {
    return;
  }

  this.editor.closeActionGroup();
  this.selection.dragging = false;
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_END }); // Moving around
};

proto._onResizeMouseDown = function (event) {

  if (this._handleRightClickDown(event))
  return;

  var target = event.target;

  //is the target where the mousedown occurred a drag point
  if (!isDragPoint(target)) {
    return;
  }

  //keep a reference to the point where the drag started
  this.selection.handle.resizing = target;
  //figure out which direction this point should resize
  var direction = this.selection.handle.resizing.getAttribute('data-sdp-handle');
  //set the cursor position for the entire layer
  this.containingDiv.style.cursor = direction + '-resize';

  var cursor = this.editor.getMousePosition();

  var position = this.markup.getClientPosition();
  var size = this.markup.getBoundingRect();

  //store the center
  this.initial = {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    mouseX: cursor.x,
    mouseY: cursor.y
  };

  this.onMouseMove = this._onResizeMouseMove.bind(this);
  this.onMouseUp = this._onResizeMouseUp.bind(this);

  if (this.selection.resizing) {
    return;
  }

  this.selection.resizing = true;
  this.editor.beginActionGroup();

  setHandleSelected(event.target, true);

  //notify the markup that dragging has started
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_START }); // Resizing
};

proto._onResizeMouseMove = function (event) {

  if (!this.selection.resizing) return false;

  var cursor = this.editor.getMousePosition();
  var initial = this.initial;

  var movement = {
    x: cursor.x - initial.mouseX,
    y: cursor.y - initial.mouseY
  };

  // Skip resize if there is no movement
  if (movement.x === 0 && movement.y === 0) return;

  var vector = new THREE.Vector3(movement.x, movement.y, 0);
  var undoRotation = new THREE.Matrix4().makeRotationZ(-this.selection.rotation);
  movement = vector.applyMatrix4(undoRotation);

  var x = initial.x,
    y = initial.y,
    width = initial.width,
    height = initial.height;

  var localSpaceDelta = new THREE.Vector3();

  //get the direction of the arrow being dragged
  var direction = this.selection.handle.resizing.getAttribute('data-sdp-handle');

  // TODO: Make a mechanism to configure and use this feature from Markups Core.
  // If shift is pressed, figure aspect ratio is maintained.
  if (this.editor.input.keepAspectRatio && ['nw', 'ne', 'sw', 'se'].indexOf(direction) !== -1) {

    var delta = new THREE.Vector3(movement.x, movement.y, 0);
    switch (direction) {
      case 'nw':movement.set(-initial.width, -initial.height, 0);break;
      case 'ne':movement.set(initial.width, -initial.height, 0);break;
      case 'sw':movement.set(initial.width, -initial.height, 0);break;
      case 'se':movement.set(initial.width, initial.height, 0);break;
    }
    movement.normalize();
    movement = delta.projectOnVector(movement);
  }

  var translations = {
    n: function () {
      height -= movement.y;
      localSpaceDelta.y = movement.y;
    },
    s: function () {
      height += movement.y;
      localSpaceDelta.y = movement.y;
    },
    w: function () {
      width -= movement.x;
      localSpaceDelta.x = movement.x;
    },
    e: function () {
      width += movement.x;
      localSpaceDelta.x = movement.x;
    },
    nw: function () {
      this.n();
      this.w();
    },
    ne: function () {
      this.n();
      this.e();
    },
    sw: function () {
      this.s();
      this.w();
    },
    se: function () {
      this.s();
      this.e();
    }
  };

  translations[direction]();

  // Check if new size is smaller than min width or height
  if (width <= this.markup.getMinWidth() || height <= this.markup.getMinHeight()) return;

  var redoRotation = new THREE.Matrix4().makeRotationZ(this.selection.rotation);
  var actualDelta = localSpaceDelta.applyMatrix4(redoRotation);

  var newPos = this.editor.positionFromClientToMarkups(
    x + actualDelta.x * 0.5,
    y + actualDelta.y * 0.5);

  var newSize = this.editor.sizeFromClientToMarkups(width, height);

  var setSize = new _edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_4__.SetSize(this.editor, this.markup, newPos, newSize.x, newSize.y);
  setSize.execute();
  return true;
};

function setHandleSelected(handle, isSelected) {
  if (isSelected) {
    handle.classList.add('selected');
  } else {
    handle.classList.remove('selected');
  }
}

proto._onResizeMouseUp = function (event) {
  this.selection.resizing = false;
  this.selection.handle.resizing = null;
  this.containingDiv.style.cursor = '';

  for (var direction in this.selection.handle) {
    if (this.selection.handle[direction]) {
      setHandleSelected(this.selection.handle[direction], false);
    }
  }


  this.editor.closeActionGroup();
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_END }); // Resizing

  //this should never be called after the mouse up because we are no longer resizing
  this.onMouseMove = function () {
    /*do nothing*/};
  this.onMouseUp = function () {
    /*do nothing*/};
};


/**
 * Attaches all the necessary listeners to handle a resizing action.
 *
 * @this EditFrame
 */
function handleSelectionBoxResizing() {
  this.selectionLayer.addEventListener('mousedown', this._onResizeMouseDown.bind(this));
}

function handleSelectionBoxRotating() {

  this.selection.element.addEventListener('mousedown', this._onRotationMouseDown.bind(this));
}

var initialRotation;
var initialHandlePosition;

proto._onRotationMouseDown = function (event) {

  if (this._handleRightClickDown(event))
  return;

  //ignore anything not coming from the rotation point
  if (!isRotatePoint(event.target)) return;

  this.editor.beginActionGroup();
  this.selection.rotating = true;

  //store the initial cursor
  initialHandlePosition = this.editor.getMousePosition();

  initialRotation = this.selection.rotation || 0;

  //update the function that will handle the mousemove and mouseup events
  this.onMouseMove = this._onRotationMouseMove.bind(this);
  this.onMouseUp = this._onRotationMouseUp.bind(this);

  setHandleSelected(event.target, true);

  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_START }); // Rotating
};

proto._onRotationMouseMove = function (event) {

  //ignore mousemove events if the dragging state hasn't been activated
  if (!this.selection.rotating) return false;

  var cursor = this.editor.getMousePosition();
  var position = this.markup.getClientPosition();

  var r = getAngleBetweenPoints(position, cursor);
  var r2 = getAngleBetweenPoints(position, initialHandlePosition);
  var rotation = r - r2 + initialRotation;

  // TODO: Make a mechanism to configure and use this feature from Markups Core.
  if (this.editor.input.snapRotations) {
    var snap = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.degreesToRadians)(22.5);
    rotation = Math.ceil(rotation / snap) * snap;
  }

  //pass rotation as degrees
  updateSelectorBoxPosition.bind(this)(this.selection.x, this.selection.y, rotation);

  //convert to radians
  var setRotation = new _edit_actions_SetRotation_js__WEBPACK_IMPORTED_MODULE_5__.SetRotation(this.editor, this.markup, rotation);
  setRotation.execute();
  return true;
};

proto._onRotationMouseUp = function (event) {

  this.selection.rotating = false;
  initialRotation = null;
  initialHandlePosition = null;
  setHandleSelected(this.selection.rotationHandle, false);
  this.editor.closeActionGroup();
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_END }); // Rotating
};

/**
 * Attaches double click listener and pass events to markup, markups such as text use it to enter text edit
 * mode.
 *
 * @this EditFrame
 */
function handleSelectionDoubleClick() {

  var doubleClick = function (event) {
    if (event.defaultPrevented) {
      return;
    }
    this.selection.dragging = false;
    var editMode = this.editor.editMode;
    editMode && editMode.onMouseDoubleClick(this.markup);
  }.bind(this);

  var selectorBoxWrapper = this.selectionLayer;
  selectorBoxWrapper.addEventListener('dblclick', doubleClick);
}

function togglePointerEvents(element, state) {

  element.style.pointerEvents = state ? 'auto' : 'none';
}

function getAngleBetweenPoints(p1, p2) {

  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

function matchesSelectorAux(domElem, selector) {
  if (domElem.matches) return domElem.matches(selector); //Un-prefixed
  if (domElem.msMatchesSelector) return domElem.msMatchesSelector(selector); //IE
  if (domElem.mozMatchesSelector) return domElem.mozMatchesSelector(selector); //Firefox (Gecko)
  if (domElem.webkitMatchesSelector) return domElem.webkitMatchesSelector(selector); // Opera, Safari, Chrome
  return false;
}

/***/ },

/***/ "./extensions/Markup/core/EditModeManager.js"
/*!***************************************************!*\
  !*** ./extensions/Markup/core/EditModeManager.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   theEditModeManager: () => (/* binding */ theEditModeManager)
/* harmony export */ });

// Maps EditMode id (string) into a contructor/class
var _editModes = {};

class EditModeManager {
  constructor() {

    // nothing //
  }
  register(id, clazz) {
    if (id in _editModes)
    throw new Error(`EditMode with id (${id}) already registered.`);

    _editModes[id] = clazz;
  }

  unregister(id) {
    if (id in _editModes)
    delete _editModes[id];
  }

  getClass(id) {
    return _editModes[id] || null;
  }

  getRegistered() {
    var ret = {};
    for (var id in _editModes) {
      if (Object.prototype.hasOwnProperty.call(_editModes, id)) {
        ret[id] = _editModes[id];
      }
    }
    return ret; // shallow copy.
  }
}


var theEditModeManager = new EditModeManager();

/***/ },

/***/ "./extensions/Markup/core/Markup.js"
/*!******************************************!*\
  !*** ./extensions/Markup/core/Markup.js ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Markup: () => (/* binding */ Markup)
/* harmony export */ });
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");






var av = Autodesk.Viewing;

/**
 * Base class for all markups.
 *
 * A Markup is a class that is capable of rendering itself as an Svg node.<br>
 * It can also render itself into a canvas-2d context.
 * Component within {@link Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore MarkupsCore} extension.
 *
 * Any class extending Markup should contain at least the following methods:
 * - getEditMode()
 * - set()
 * - updateStyle()
 * - setParent()
 * - setRotation()
 * - setSize()
 * - setPosition()
 * - renderToCanvas()
 * - setMetadata()
 *
 * A good reference is the rectangle markup implementation available in
 * {@link Autodesk.Viewing.Extensions.Markups.Core.MarkupRectangle|MarkupRectangle}.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 *
 * @param {number} id - Identifier, populated with return value of {@link Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore#getId getId()}.
 * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore} editor - Markups extension
 * @param {Array} styleAttributes - Attributes for customization. Related to {@link Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore#setStyle setStyle()}.
 * @constructor
 */
function Markup(id, editor, styleAttributes) {

  this.id = id;
  this.type = "";
  this.editor = editor;
  this.viewer = editor.viewer;
  this.setGlobalManager(this.viewer.globalManager);
  this.position = { x: 0, y: 0 };
  this.size = { x: 0, y: 0 };
  this.rotation = 0;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.createStyle)(styleAttributes, this.editor);
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.copyStyle)(editor.getDefaultStyle(), this.style);
  this.highlightColor = '#0696D7';
  this.constraintWidth = false;
  this.constraintHeight = false;
  this.constraintRotation = false;
  this.minWidth = -10000;
  this.minHeight = -10000;
  this.highlighted = false;
  this.selected = false;

  // bind to this to pass this.globalManager
  this.checkLineSegment = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.checkLineSegment.bind(this);
  this.checkPolygon = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.checkPolygon.bind(this);
  this.renderToCanvasX = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.renderToCanvas.bind(this);

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.addTraitEventDispatcher)(this);
}

av.GlobalManagerMixin.call(Markup.prototype);
var proto = Markup.prototype;

proto.destroy = function () {

  this.unselect();
  this.setParent(null);
};

/**
 * Specifies the parent layer which will contain the markup.
 * @param {HTMLElement} parent
 */
proto.setParent = function (parent) {

  var div = this.shape;
  div.parentNode && div.parentNode.removeChild(div);
  parent && parent.appendChild(div);
};

/**
 * Clones (deep-copy) the markup. Used internally by the copy/cut/paste mechanism in
 * {@link Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore MarkupsCore}.
 *
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.Markup} clone of the current markup
 */
proto.clone = function () {

  var clone = Object.create(this.__proto__);
  var overrides = this.getCloneOverrides();

  for (var name in this) {

    if (!Object.prototype.hasOwnProperty.call(this, name)) {
      continue;
    }

    var member = this[name];

    // Is there an override for this member?
    if (Object.prototype.hasOwnProperty.call(overrides, name)) {
      clone[name] = overrides[name];
      continue;
    }

    // Member is null or undefined?
    if (member === null || member === undefined) {
      clone[name] = member;
      continue;
    }

    // Member has a clone function?
    if (member['clone'] instanceof Function) {
      clone[name] = member.clone();
      continue;
    }

    // Is it a function?
    if (member instanceof Function) {
      clone[name] = member.bind(clone);
      continue;
    }

    // Is it an html node?
    if (member.nodeType) {
      clone[name] = member.cloneNode(true);
      continue;
    }

    // Is it the globalManager?
    if (member instanceof av.GlobalManager) {
      av.GlobalManagerMixin.call(clone);
      clone.setGlobalManager(member);
      continue;
    }

    // Just a plain object?
    if (member instanceof Object) {
      clone[name] = JSON.parse(JSON.stringify(member));
      continue;
    }

    // Ok, it seems it's just a primitive type.
    clone[name] = member;
  }

  this.cloneShape(clone);
  return clone;
};

proto.cloneShape = function (clone) {

  clone.shape.markup = clone.shape.childNodes.item(0);
  clone.shape.hitarea = clone.shape.childNodes.item(1);
  clone.bindDomEvents();
};

/**
 * Used internally by
 * {@link Autodesk.Viewing.Extensions.Markups.Core.Markup#clone clone()},
 * provides a mechanism to avoid cloning specific attributes.<br>
 * Developers only need to override this method when creating new Markup types.
 * When overriding, first call the super() implementation and then include additional attribute/value pairs to it.
 * @returns {Object} containing attributes that need not to be cloned.
 */
proto.getCloneOverrides = function () {

  return {
    viewer: this.viewer,
    editor: this.editor,
    hammer: null,
    listeners: {}
  };
};

/**
 * Used internally to select a markup.<br>
 * Fires event Autodesk.Viewing.Extensions.Markups.Core.EVENT_MARKUP_SELECTED.
 */
proto.select = function () {

  if (this.selected) {
    return;
  }

  this.selected = true;
  this.highlighted = false;
  this.updateStyle();
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_2__.EVENT_MARKUP_SELECTED, markup: this });
};

/**
 * Used internally to signal that the current markup has been unselected.<br>
 * No event is fired.
 */
proto.unselect = function () {

  this.selected = false;
};

proto.highlight = function (highlight) {

  if (this.interactionsDisabled) {
    return;
  }

  this.highlighted = highlight;
  this.updateStyle();
};

/**
 * Returns a copy of the markup's style.
 * @returns {Object}
 */
proto.getStyle = function () {

  return (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.cloneStyle)(this.style);
};

/**
 * Used internally to set the style object. Triggers a re-render of the markup (Svg)
 * @param {Object} style - Dictionary with key/value pairs
 */
proto.setStyle = function (style) {

  (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.copyStyle)(style, this.style);
  this.updateStyle();
};

/**
 * Used internally and implemented by specific Markup types to render themselves as Svg.
 */
proto.updateStyle = function () {

};

/**
 * Used internally to notify the markup that it is now being edited.<br>
 * Fires event Autodesk.Viewing.Extensions.Markups.Core.EVENT_MARKUP_ENTER_EDITION.
 */
proto.edit = function () {

  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_2__.EVENT_MARKUP_ENTER_EDITION, markup: this });
};

/**
 * Used internally to signal that it is no longer being edited.<br>
 * Fires event Autodesk.Viewing.Extensions.Markups.Core.EVENT_MARKUP_CANCEL_EDITION.
 */
proto.cancel = function () {

  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_2__.EVENT_MARKUP_CANCEL_EDITION, markup: this });
};

/**
 * Used internally to signal that the markup is being deleted.<br>
 * Fires event Autodesk.Viewing.Extensions.Markups.Core.EVENT_MARKUP_DELETE_EDITION.
 */
proto.deleteMarkup = function () {

  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_2__.EVENT_MARKUP_DELETE_EDITION, markup: this });
};

/**
 * Used internally to get the {@link Autodesk.Viewing.Extensions.Markups.Core.EditMode EditMode}
 * associated with the current Markup.<br>
 * Implemented by classes extending this one.
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.EditMode}
 */
proto.getEditMode = function () {

  console.warn('EditMode of markup type' + this.type + ' not defined.');
  return null;
};

/**
 * Used internally to get the markup's position in browser pixel space.<br>
 * Notice that (0,0) is top left.<br>
 * See also
 * {@link Autodesk.Viewing.Extensions.Markups.Core.Markup#getClientSize|getClientSize()}.
 * @returns {*}
 */
proto.getClientPosition = function () {

  var position = this.position;
  return this.editor.positionFromMarkupsToClient(position.x, position.y);
};

/**
 * Used internally to get the markup's bounding rect in browser pixel space.<br>
 * See also
 * {@link Autodesk.Viewing.Extensions.Markups.Core.Markup#getClientPosition|getClientPosition()}.
 * @returns {*}
 */
proto.getClientSize = function () {

  var size = this.size;
  return this.editor.sizeFromMarkupsToClient(size.x, size.y);
};

/**
 * Used internally to get the markup's bounding rect in browser pixel space, including the stroke width.<br>
 * @returns {Object} a rectangle with right, top, left, bottom attributes
 */
proto.getBoundingRect = function () {

  var rotation = this.rotation;

  if (rotation !== 0) {// Undo rotation to find a tight bounding rect
    this.setRotation(0);
  }

  var parentRect = this.viewer.impl.getCanvasBoundingClientRect();

  var boundRect = this.shape.markup.getBoundingClientRect();
  var top = boundRect.top - parentRect.top;

  var strokeWidth = this.style['stroke-width'] || 0;
  var offset = this.editor.sizeFromMarkupsToClient(strokeWidth, 0).x;

  if (rotation !== 0) {
    this.setRotation(rotation);
  }

  return {
    x: boundRect.left - parentRect.left - offset,
    y: top - offset,
    width: boundRect.width + 2 * offset,
    height: boundRect.height + 2 * offset
  };
};

/**
 * Changes the rotation of the markup to the given angle.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetRotation edit action
 *
 * @param {Number} angle
 */
proto.setRotation = function (angle) {

  this.rotation = angle;
  this.updateStyle();
};

proto.getRotation = function () {

  return this.rotation;
};

/**
 * Used by the EditFrame to move the markup in Client Space coordinates
 * @param {Number} x - New X location for the markup. Notice that markups are centered on this value.
 * @param {Number} y - New Y location for the markup. Notice that markups are centered on this value.
 */
proto.setPosition = function (x, y) {

  this.position.x = x;
  this.position.y = y;

  this.updateStyle();
};

/**
 * Changes the position and size of the markup.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetSize edit action
 * @param {{x: Number, y: Number}} position
 * @param {Number} width
 * @param {Number} height
 */
proto.setSize = function (position, width, height) {

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = width;
  this.size.y = height;

  this.updateStyle();
};

proto.isWidthConstrained = function () {

  return this.constraintWidth;
};

proto.isHeightConstrained = function () {

  return this.constraintHeight;
};

proto.isRotationConstrained = function () {

  return this.constraintRotation;
};

proto.setMinWidth = function (minWidth) {
  this.minWidth = minWidth;
};

proto.setMinHeight = function (minHeight) {
  this.minHeight = minHeight;
};

proto.getMinWidth = function () {
  return this.minWidth;
};

proto.getMinHeight = function () {
  return this.minHeight;
};

/**
 * Used to disable highlight on annotations while a new annotation is being created.
 * @param {Boolean} disable - Whether (mouse) interactions are enable.
 */
proto.disableInteractions = function (disable) {

  this.interactionsDisabled = disable;
};

/**
 *
 * @param width
 */
proto.setStrokeWidth = function (width) {

};

proto.constrainsToBounds = function (bounds) {

};

proto.onMouseDown = function (event) {

  if (this.interactionsDisabled) {
    return;
  }

  this.select();
  this.editor.editFrame.startDrag(event);
};

/**
 *
 * @param idTarget
 * @returns *
 */
proto.generatePoint3d = function (idTarget) {

  var viewer = this.viewer;
  var polygon = this.generateBoundingPolygon();
  var self = this;

  function checkLineSegmentAux(a, b) {

    var point2d = self.checkLineSegment(a.x, a.y, b.x, b.y, idTarget);
    var point3d = point2d && viewer.clientToWorld(point2d.x, point2d.y);
    return point3d && point3d.point;
  }

  function checkPolygonAux(polygon) {

    var point2d = self.checkPolygon(polygon, idTarget);
    var point3d = point2d && viewer.clientToWorld(point2d.x, point2d.y);
    return point3d && point3d.point;
  }

  // Try to avoid expensive calculations by checking some lines segments first.
  // If line check cannot find a point the costly one by area is used.
  // A ----midAB---- B
  // |               |
  // |     center    |
  // |               |
  // C --------------D

  var xVertices = polygon.xVertices;
  var yVertices = polygon.yVertices;

  var midAB = new THREE.Vector2(xVertices[0] + xVertices[1], yVertices[0] + yVertices[1]).multiplyScalar(0.5);
  var midAC = new THREE.Vector2(xVertices[0] + xVertices[3], yVertices[0] + yVertices[3]).multiplyScalar(0.5);
  var midDB = new THREE.Vector2(xVertices[2] + xVertices[1], yVertices[2] + yVertices[1]).multiplyScalar(0.5);
  var midDC = new THREE.Vector2(xVertices[2] + xVertices[3], yVertices[2] + yVertices[3]).multiplyScalar(0.5);
  var center = midAC.clone().add(midDB).multiplyScalar(0.5);

  var point3d =
  checkLineSegmentAux(center, midDB) ||
  checkLineSegmentAux(center, midAC) ||
  checkLineSegmentAux(center, midAB) ||
  checkLineSegmentAux(center, midDC);

  return point3d || checkPolygonAux(polygon);
};

/**
 *
 * @returns {{min: {x: number, y: number}, max: {x: number, y: number}}}
 */
proto.generateBoundingBox = function () {

  var boundingBox = { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };

  // Get bounding box from markup bounding polygon.
  var polygon = this.generateBoundingPolygon();

  var vertexCount = polygon.vertexCount;
  var xVertices = polygon.xVertices;
  var yVertices = polygon.yVertices;

  var bbX0 = Number.POSITIVE_INFINITY;
  var bbY0 = Number.POSITIVE_INFINITY;
  var bbX1 = Number.NEGATIVE_INFINITY;
  var bbY1 = Number.NEGATIVE_INFINITY;

  for (var i = 0; i < vertexCount; ++i) {

    var bbX = xVertices[i];
    var bbY = yVertices[i];

    bbX0 = Math.min(bbX0, bbX);
    bbY0 = Math.min(bbY0, bbY);
    bbX1 = Math.max(bbX1, bbX);
    bbY1 = Math.max(bbY1, bbY);
  }

  boundingBox.min.x = bbX0;
  boundingBox.min.y = bbY0;
  boundingBox.max.x = bbX1;
  boundingBox.max.y = bbY1;

  return boundingBox;
};

/**
 *
 * @returns {{vertexCount: number, xVertices: Float32Array, yVertices: Float32Array}}
 */
proto.generateBoundingPolygon = function () {

  var position = this.getClientPosition();
  var halfSize = this.getClientSize();

  halfSize.x *= 0.5;
  halfSize.y *= 0.5;

  var lt = new THREE.Vector3(-halfSize.x, -halfSize.y).add(position);
  var rt = new THREE.Vector3(halfSize.x, -halfSize.y).add(position);
  var rb = new THREE.Vector3(halfSize.x, halfSize.y).add(position);
  var lb = new THREE.Vector3(-halfSize.x, halfSize.y).add(position);

  if (this.rotation !== 0) {

    var m1 = new THREE.Matrix4().makeTranslation(-position.x, -position.y, 0);
    var m2 = new THREE.Matrix4().makeRotationZ(this.rotation);
    var m3 = new THREE.Matrix4().makeTranslation(position.x, position.y, 0);
    var transform = m3.multiply(m2).multiply(m1);

    lt.applyMatrix4(transform);
    rt.applyMatrix4(transform);
    rb.applyMatrix4(transform);
    lb.applyMatrix4(transform);
  }

  return { // packed for fast access in test algorithm.
    vertexCount: 4,
    xVertices: new Float32Array([lt.x, rt.x, rb.x, lb.x]),
    yVertices: new Float32Array([lt.y, rt.y, rb.y, lb.y])
  };
};

/**
 * Implemented by extending classes.<br>
 * Gets called automatically when
 * {@link Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore#generateData|generateData()}
 * @returns {null|Element} - Either null (default) or the metadata Svg node
 */
proto.setMetadata = function () {

  return null; // No metadata is injected by default.
};

proto.setMouseDisabledWhenTouching = function (event) {

  if (event.isFirst) {
    this.shape.removeEventListener('mousedown', this.onMouseDownBinded);
  } else if (event.isFinal) {
    var _this = this;
    setTimeout(function () {
      _this.shape.addEventListener('mousedown', _this.onMouseDownBinded);
    }, 10);
  }
};

proto.bindDomEvents = function () {

  if ((0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.isTouchDevice)()) {

    this.hammer = new av.Hammer.Manager(this.shape, {
      recognizers: [
      av.GestureRecognizers.singletap],

      handlePointerEventMouse: false,
      inputClass: av.Hammer.TouchInput
    });

    this.onSingleTapBinded = function (event) {

      this.onMouseDown(event);
    }.bind(this);

    this.onHammerInputBinded = function (event) {

      this.setMouseDisabledWhenTouching(event);
    }.bind(this);

    this.hammer.on('singletap', this.onSingleTapBinded);
    this.hammer.on('hammer.input', this.onHammerInputBinded);
  }

  this.onMouseDownBinded = this.onMouseDown.bind(this);
  this.onMouseOutBinded = function () {

    this.highlight(false);
  }.bind(this);

  this.onMouseOverBinded = function () {

    this.highlight(true);
  }.bind(this);

  this.shape.addEventListener('mousedown', this.onMouseDownBinded);
  this.shape.addEventListener('mouseout', this.onMouseOutBinded);
  this.shape.addEventListener('mouseover', this.onMouseOverBinded);
};

proto.renderToCanvas = function (ctx, viewBox, width, height, callback) {

  this.renderToCanvasX(this.shape, viewBox, width, height, ctx, callback);
};

proto.getPath = function () {

};

proto.getTransform = function () {

  return [
  'translate(', this.position.x, ',', this.position.y, ')',
  'rotate(', (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.radiansToDegrees)(-this.rotation), ')'].
  join(' ');
};

/***/ },

/***/ "./extensions/Markup/core/MarkupArrow.js"
/*!***********************************************!*\
  !*** ./extensions/Markup/core/MarkupArrow.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupArrow: () => (/* binding */ MarkupArrow)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeArrow_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeArrow.js */ "./extensions/Markup/core/edit-modes/EditModeArrow.js");








/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupArrow(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);
  this.checkLineSegment = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.checkLineSegment.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_ARROW;
  this.constraintHeight = true;

  // Create head and tail.
  this.head = new THREE.Vector3();
  this.tail = new THREE.Vector3();
  this.size.y = this.style['stroke-width'] * 3;
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();

  this.bindDomEvents();
}

MarkupArrow.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupArrow.prototype.constructor = MarkupArrow;

var proto = MarkupArrow.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeArrow_js__WEBPACK_IMPORTED_MODULE_4__.EditModeArrow(this.editor);
};

/**
 * Sets top-left and bottom-right values in client space coordinates (2d).
 * Notice that for the arrow, the top left is the "tail" of the arrow and
 * the bottom right is the "head" of it.
 *
 * @param {Number} xO - tail
 * @param {Number} yO - tail
 * @param {Number} xF - head
 * @param {Number} yF - head
 */
proto.set = function (xO, yO, xF, yF) {

  var vO = new THREE.Vector2(xO, yO);
  var vF = new THREE.Vector2(xF, yF);
  var vDir = vF.clone().sub(vO).normalize();

  this.size.x = vO.distanceTo(vF); // TODO: Clamp min length
  this.rotation = Math.acos(vDir.dot(new THREE.Vector2(1, 0)));
  this.rotation = yF > yO ? Math.PI * 2 - this.rotation : this.rotation;

  var head = this.head;
  var tail = this.tail;

  head.set(xF, yF, 0);
  tail.set(xO, yO, 0);

  this.position.x = tail.x + (head.x - tail.x) * 0.5;
  this.position.y = tail.y + (head.y - tail.y) * 0.5;

  this.updateStyle();
};

/**
 * Changes the rotation of the markup to the given angle.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetRotation edit action
 *
 * @param {Number} angle
 */
proto.setRotation = function (angle) {

  this.rotation = angle;

  var xF = Math.cos(-angle);
  var yF = Math.sin(-angle);
  var vFDir = new THREE.Vector2(xF, yF); // already normalized
  vFDir.multiplyScalar(this.size.x * 0.5);

  var vCenter = new THREE.Vector2(this.position.x, this.position.y);
  var vO = vCenter.clone().sub(vFDir);
  var vF = vCenter.clone().add(vFDir);

  this.head.set(vF.x, vF.y, 0);
  this.tail.set(vO.x, vO.y, 0);

  this.updateStyle();
};

/**
 * Changes the position and size of the markup.
 * This gets called by the namespace.SetSize edit action
 * @param {{x: Number, y: Number}} position - arrow's center
 * @param {Number} width - Arrow's length
 * @param {Number} height - We ignore this one because we use the arrow's stroke width instead
 */
proto.setSize = function (position, width, height) {

  var xF = Math.cos(-this.rotation);
  var yF = Math.sin(-this.rotation);
  var vFDir = new THREE.Vector2(xF, yF); // already normalized
  vFDir.multiplyScalar(width * 0.5);

  var vCenter = new THREE.Vector2(position.x, position.y);
  var vO = vCenter.clone().sub(vFDir);
  var vF = vCenter.clone().add(vFDir);

  this.head.set(vF.x, vF.y, 0);
  this.tail.set(vO.x, vO.y, 0);

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = width;

  this.updateStyle();
};

proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var strokeWidth = style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var transform = this.getTransform();

  this.size.y = strokeWidth * 3;
  this.style['fill-color'] = style['stroke-color'];
  this.style['fill-opacity'] = style['stroke-opacity'];

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', this.getPath().join(' '));
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

/**
 * Used by the EditFrame to move the markup in Client Space coordinates
 * @param {Number} x - New X location for the markup. Notice that markups are centered on this value.
 * @param {Number} y - New Y location for the markup. Notice that markups are centered on this value.
 */
proto.setPosition = function (x, y) {

  var head = this.head;
  var tail = this.tail;

  var dx = head.x - tail.x;
  var dy = head.y - tail.y;

  var xo = x + dx * 0.5;
  var yo = y + dy * 0.5;

  head.x = xo;
  head.y = yo;

  tail.x = xo - dx;
  tail.y = yo - dy;

  this.position.x = tail.x + (head.x - tail.x) * 0.5;
  this.position.y = tail.y + (head.y - tail.y) * 0.5;

  this.updateStyle();
};

proto.generatePoint3d = function (idTarget) {

  var head = this.editor.positionFromMarkupsToClient(this.head.x, this.head.y);
  var tail = this.editor.positionFromMarkupsToClient(this.tail.x, this.tail.y);

  var direction = head.clone().sub(tail).normalize();

  var point2d = this.checkLineSegment(head.x, head.y, head.x + direction.x * 200, head.y + direction.y * 200, idTarget);
  var point3d = point2d && this.viewer.clientToWorld(point2d.x, point2d.y);

  return point3d && point3d.point;
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.head = [this.head.x, this.head.y].join(" ");
  metadata.tail = [this.tail.x, this.tail.y].join(" ");
  metadata.rotation = String(this.rotation);

  return this.addMarkupMetadata(this.shape, metadata);
};

proto.getPath = function () {

  // To build the arrow we need 7 points in total
  // The 'default' arrow built here has the following characteristics:
  //
  // 1. It is built horizontally facing right
  // 2. It's bounding rectangle has length: this.size.x
  // 3. It's bounding rectangle has height: 2 * this.strokeWidth
  // 4. The arrow tail's thickness is: this.strokeWidth
  // 5. The arrow head's length is: 2/3 of (point 3)
  // 6. The arrow head's thickness is: (point 3)
  // 7. The arrow generated is centered in its local (0,0), meaning that
  //    two points are placed with negative x values, and all other have
  //    positive x values:
  //
  //                            (3)\
  //                              \  \
  //             (1)-------------(2)   \
  //              |         (0)        (4)
  //             (7)-------------(6)   /
  //                              /  /
  //                            (5)/
  //

  var sizeX = this.size.x;
  var sizeY = this.size.y;
  var sizeYOver3 = sizeY / 3;
  var strokeWidth = this.style['stroke-width'];
  var tailW = sizeX - strokeWidth * 3;
  var headW = sizeX - tailW;
  var spikeOffset = strokeWidth * 0.3;

  return [
  'M', -sizeX * 0.5, -sizeY * 0.5 + sizeYOver3, // (1)
  'l', tailW, 0, // (2)
  'l', -spikeOffset, -sizeYOver3, // (3)
  'l', headW + spikeOffset, sizeYOver3 * 1.5, // (4)
  'l', -headW - spikeOffset, sizeYOver3 * 1.5, // (5)
  'l', spikeOffset, -sizeYOver3, // (6)
  'l', -tailW, 0, // (7)
  'z'];

};

/***/ },

/***/ "./extensions/Markup/core/MarkupCallout.js"
/*!*************************************************!*\
  !*** ./extensions/Markup/core/MarkupCallout.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupCallout: () => (/* binding */ MarkupCallout)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeCallout_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeCallout.js */ "./extensions/Markup/core/edit-modes/EditModeCallout.js");








// LMV ViewerLMV-2170 [Markup] [PDF] Text markup missing/cutoff for normal sized text.
// If the font size of an SVG text is too small, the text is not rendered independently of its final screen size.
// To solve the issue we multiply font size by 100 and scale down the text in its transform.
var FONT_SIZE_SCALE = 100;

var STARTING_WIDTH_FACTOR = 6;

/**
 * Callout Markup.
 * @constructor
 */
function MarkupCallout(id, editor, size) {

  var styleAttributes = [
  'font-size',
  'stroke-width',
  'stroke-color',
  'stroke-opacity',
  'fill-color',
  'fill-opacity',
  'font-family',
  'font-style',
  'font-weight'];


  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);
  this.createSvgElement = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createSvgElement.bind(this);


  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_CALLOUT;
  this.textShape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupTextSvg)();
  this.rectShape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupGroupSvg)([this.rectShape, this.textShape]);
  this.isFrameUsed = true;
  this.constraintRotation = true;
  this.constraintHeight = true;
  this.constraintWidth = false;
  this.size.x = size.x;
  this.size.y = size.y;
  this.currentText = "";
  this.currentTextLines = [""];
  this.prevHighlight = false;
  this.isHelperTextActive = false;

  // Note: We could have this property be a style property.
  // However, there is no need for this property to be exposed to the user for alteration
  // This value is a percentage of the font size used to offset vertically 2 text lines
  // of the same paragraph.
  // Notice that this value is used by EditorTextInput.js
  this.lineHeight = 130;

  this.minWidth = this.getClientFontSize() * STARTING_WIDTH_FACTOR;

  this.bindDomEvents();
}

MarkupCallout.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupCallout.prototype.constructor = MarkupCallout;

var proto = MarkupCallout.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeCallout_js__WEBPACK_IMPORTED_MODULE_4__.EditModeCallout(this.editor);
};

/**
 *
 * @param {Object} position
 * @param {Object} size
 * @param {String} textString
 */
proto.set = function (position, size, textString, isFrameUsed) {

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = size.x;
  this.size.y = size.y;
  this.setIsFilledFrameUsed(isFrameUsed);
  this.setText(textString);
};

proto.setSize = function (position, width, height) {

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = width;
  this.size.y = height;

  var sizeUpdateRequired = true;

  if (this.isHelperTextActive) {
    this.updateTextBoxStyle();
  } else {
    this.updateStyle(sizeUpdateRequired);
  }
};

proto.setPosition = function (x, y) {

  this.position.x = x;
  this.position.y = y;

  if (this.isHelperTextActive) {
    this.updateTextBoxStyle();
  } else {
    this.updateStyle();
  }
};

proto.setStyle = function (style) {
  var stylesEqual = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.isStyleEqual)(style, this.style);

  if (!stylesEqual) {
    (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.copyStyle)(style, this.style);
  }

  this.updateStyle(!stylesEqual);
};

proto.setText = function (text) {

  this.currentText = text;
};

/**
 * Returns the raw string value
 * @returns {String}
 */
proto.getText = function () {

  return this.currentText;
};

/**
 * Returns a shallow copy of the text lines used for rendering SVG text
 * @returns {Array.<String>}
 */
proto.getTextLines = function () {

  return this.currentTextLines.concat();
};

proto.highlightChanged = function () {

  if (this.highlighted && this.highlighted !== this.prevHighlight) {
    var rect = this.rectShape;
    var text = this.textShape;
    var strokeColor = this.highlightColor;
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'fill', strokeColor);

    if (this.isFrameUsed) {
      (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(rect, 'stroke', strokeColor);
    }

    this.prevHighlight = true;
    return false;
  }

  return true;
};

proto.updateTextBoxStyle = function () {
  var editMode = this.editor.duringEditMode && this.editor.editMode;

  if (!editMode || editMode.type !== this.type) {
    editMode = this.getEditMode();
  }

  editMode.updateTextBoxStyle();
};

proto.setIsHelperTextActive = function (isActive) {
  this.isHelperTextActive = isActive;
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function (sizeUpdateRequired) {

  if (this.highlightChanged()) {
    this.prevHighlight = false;
    var style = this.style;
    var rect = this.rectShape;
    var text = this.textShape;
    var fontSize = this.style['font-size'];
    var fontFamily = this.style['font-family'];
    var fontWeight = this.style['font-weight'];
    var fontStyle = this.style['font-style'];
    var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
    var strokeWidth = this.style['stroke-width'];

    // FONT_SIZE_SCALE is used to scale up fontSize, but it is only needed in cases where the font size is too small
    FONT_SIZE_SCALE = fontSize > 1 ? 1 : 100;

    this.rebuildTextSvg(sizeUpdateRequired);

    var editor = this.editor;
    var textContainerTransform = this.getTextContainerTransform();
    var textTransform = this.getTextTransform();

    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-family', fontFamily);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-size', fontSize * FONT_SIZE_SCALE);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'fill', strokeColor);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-weight', fontWeight);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-style', fontStyle);

    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setMarkupTextSvgTransform)(text, textContainerTransform, textTransform);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgClipper)(text, this.size.x, this.size.y);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgHitarea)(text, this.size.x, this.size.y, editor);

    var path = this.getPath().join(' ');
    var transform = this.getTransform();
    var fillColor = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']);

    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(rect, 'd', path);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(rect, 'stroke-width', strokeWidth);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(rect, 'stroke', strokeColor);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(rect, 'transform', transform);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(rect, 'fill', fillColor);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(rect, editor);
  }
};

/**
 * Re-creates SVG tags that render SVG text.
 * Each line is placed around tspan tags which are vertically offset to each other.
 */
proto.rebuildTextSvg = function (sizeUpdateRequired) {

  // TODO: Remove the need to get text values from an object in edit mode, should be a function.
  // editMode needs to be set to load markups in view mode
  var editMode = this.editor.duringEditMode && this.editor.editMode;

  if (!editMode || editMode.type !== this.type) {
    editMode = this.getEditMode();
    editMode.textInputHelper.textArea.value = this.currentText;
    editMode.textInputHelper.setStyle(this.style);
  }

  if (editMode.textInputHelper.textMarkup && editMode.textInputHelper.textMarkup !== this) {
    return;
  }

  var style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(editMode.textInputHelper.style);
  var text = editMode.textInputHelper.textArea.value;

  var textHelperValues = editMode.textInputHelper.getTextValuesForMarkup(this, sizeUpdateRequired);

  this.currentTextLines = textHelperValues.textValues.lines;

  if (textHelperValues.newPos) {
    var position = this.editor.positionFromClientToMarkups(textHelperValues.newPos.x, textHelperValues.newPos.y);
    var size = this.editor.sizeFromClientToMarkups(textHelperValues.width, textHelperValues.height);

    this.position.x = position.x;
    this.position.y = position.y;
    this.size.x = size.x;
    this.size.y = size.y;
  }

  if (editMode.selectedMarkup !== this && !editMode.textInputHelper.firstEdit) {
    editMode.textInputHelper.textArea.value = text;
    editMode.textInputHelper.setStyle(style);
  }

  var markup = this.createSvgElement('text');
  markup.setAttribute('id', 'markup');
  markup.setAttribute('alignment-baseline', 'middle');

  this.textShape.childNodes[0].removeChild(this.textShape.markup);
  this.textShape.childNodes[0].appendChild(markup);
  this.textShape.markup = markup;

  // For each line, create a tspan, add as child and offset it vertically.
  var yOffset = this.getLineHeight() * FONT_SIZE_SCALE * (this.lineHeight / 100);

  var padding = this.getLineHeight() * FONT_SIZE_SCALE / 2;
  var dx = padding;
  var dy = padding;

  this.currentTextLines.forEach(function (line) {

    var tspan = this.createSvgElement('tspan');

    tspan.setAttribute('x', dx);
    tspan.setAttribute('y', dy);
    tspan.textContent = line;

    markup.appendChild(tspan);
    dy += yOffset;
  }.bind(this));
};

proto.setIsFilledFrameUsed = function (isFrameUsed) {

  this.isFrameUsed = isFrameUsed;

  var hasRectShape = this.rectShape.parentNode === this.shape;
  if (isFrameUsed && !hasRectShape) {
    this.shape.insertBefore(this.rectShape, this.shape.firstChild);
  } else if (!isFrameUsed && hasRectShape) {
    this.shape.removeChild(this.rectShape);
  }
};

proto.setIsFilledFrameVisible = function (isVisible) {

  this.rectShape.markup.style.display = isVisible && this.isFrameUsed ? 'block' : 'none';
};

proto.setIsShapeVisible = function (isVisible) {

  this.shape.style.display = isVisible ? 'block' : 'none';
};

proto.setMetadata = function () {
  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.text = String(this.currentText);
  metadata.isframeused = this.isFrameUsed ? 1 : 0;

  return this.addMarkupMetadata(this.shape, metadata);
};

/**
 * Helper method that returns the font size in client space coords.
 * @returns {Number}
 */
proto.getClientFontSize = function () {

  return this.editor.sizeFromMarkupsToClient(0, this.style['font-size']).y;
};

proto.getLineHeight = function () {
  return this.style['font-size'];
};

proto.getTextContainerTransform = function () {

  var x = this.position.x - this.size.x * 0.5;
  var y = this.position.y + this.size.y * 0.5;

  return [
  'translate(', x, ',', y, ')',
  'rotate(', (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(-this.rotation), ')',
  'scale(1,-1)'].
  join(' ');
};

proto.getTextTransform = function () {

  var lineHeight = this.getLineHeight();

  var x = this.position.x - this.size.x * 0.5;
  var y = this.position.y + this.size.y * 0.5 - lineHeight;

  return [
  'translate(', x, ',', y, ')',
  'rotate(', (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(-this.rotation), ')',
  'scale(' + 1 / FONT_SIZE_SCALE + ',' + -1 / FONT_SIZE_SCALE + ')'].
  join(' ');
};

proto.cloneShape = function (clone) {

  clone.textShape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupTextSvg)();
  clone.rectShape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();
  clone.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupGroupSvg)([clone.rectShape, clone.textShape]);
  clone.bindDomEvents();
};

proto.getPath = function () {
  var strokeWidth = this.style['stroke-width'];

  var w = this.size.x + strokeWidth;
  var h = this.size.y + strokeWidth;
  var x = -w * 0.5;
  var y = -h * 0.5;

  var path = [];
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createRectanglePath)(x, y, w, h, false, path);

  return path;
};

proto.getBoundingRect = function () {

  var pos = this.getClientPosition();
  var size = this.getClientSize();
  var strokeWidth = this.style['stroke-width'];
  var width = this.editor.sizeFromMarkupsToClient(strokeWidth, 0).x;
  var margin = width + _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.EDIT_FRAME_DEFAULT_MARGIN;

  return {
    x: pos.x - size.x / 2,
    y: pos.y - size.y / 2,
    width: size.x,
    height: size.y,
    margin: margin
  };
};

/***/ },

/***/ "./extensions/Markup/core/MarkupCircle.js"
/*!************************************************!*\
  !*** ./extensions/Markup/core/MarkupCircle.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupCircle: () => (/* binding */ MarkupCircle)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeCircle_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeCircle.js */ "./extensions/Markup/core/edit-modes/EditModeCircle.js");








/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupCircle(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_CIRCLE;
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();

  this.bindDomEvents();
}

MarkupCircle.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupCircle.prototype.constructor = MarkupCircle;

var proto = MarkupCircle.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeCircle_js__WEBPACK_IMPORTED_MODULE_4__.EditModeCircle(this.editor);
};

proto.set = function (position, size) {

  this.setSize(position, size.x, size.y);
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var path = this.getPath().join(' ');

  var strokeWidth = this.style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var fillColor = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']);
  var transform = this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', path);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', fillColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.rotation = String(this.rotation);

  return this.addMarkupMetadata(this.shape, metadata);
};

proto.getPath = function () {

  var size = this.size;
  if (size.x === 1 || size.y === 1) {
    return [''];
  }

  var strokeWidth = this.style['stroke-width'];

  var ellipseW = size.x - strokeWidth;
  var ellipseH = size.y - strokeWidth;

  var ellipseX = -0.5 * ellipseW;
  var ellipseY = 0;

  var path = [];
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createEllipsePath)(ellipseX, ellipseY, ellipseW, ellipseH, false, path);

  return path;
};

/***/ },

/***/ "./extensions/Markup/core/MarkupCloud.js"
/*!***********************************************!*\
  !*** ./extensions/Markup/core/MarkupCloud.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupCloud: () => (/* binding */ MarkupCloud)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeCloud_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeCloud.js */ "./extensions/Markup/core/edit-modes/EditModeCloud.js");








/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupCloud(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-linejoin', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_CLOUD;
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();

  this.bindDomEvents();
}

MarkupCloud.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupCloud.prototype.constructor = MarkupCloud;

var proto = MarkupCloud.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeCloud_js__WEBPACK_IMPORTED_MODULE_4__.EditModeCloud(this.editor);
};

/**
 * Sets position and size in markup space coordinates.
 * @param {Object} position
 * @param {Object} size
 */
proto.set = function (position, size) {

  this.setSize(position, size.x, size.y);
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var path = this.getPath().join(' ');

  var strokeWidth = this.style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var fillColor = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']);
  var transform = this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', path);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', fillColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.rotation = String(this.rotation);

  return this.addMarkupMetadata(this.shape, metadata);
};

/**
 * Helper function that creates intermediate points given the
 * current position and size.
 * @returns {Array}
 */
proto.getPath = function () {

  var position = this.position;
  var size = this.size;
  var strokeWidth = this.style['stroke-width'];
  var radius = strokeWidth * 2;

  function createArcTo(x, y, xRadius, yRadius, path) {

    path.push('a');
    path.push(xRadius);
    path.push(yRadius);
    path.push(0);
    path.push(1);
    path.push(1);
    path.push(x);
    path.push(y);

    return path;
  }

  function createCorner(corner, xRadius, yRadius, strokeWidth, path) {

    switch (corner) {

      case 'LT':
        return createArcTo(xRadius, -yRadius, xRadius, yRadius, path);

      case 'RT':
        return createArcTo(xRadius, yRadius, xRadius, yRadius, path);

      case 'RB':
        return createArcTo(-xRadius, yRadius, xRadius, yRadius, path);

      case 'LB':
        return createArcTo(-xRadius, -yRadius, xRadius, yRadius, path);
    }
  }

  function getSideParameters(x1, x2, radius, strokeWidth) {

    var diameter = radius * 2;
    var length = Math.abs(x2 - x1 - strokeWidth);
    var count = Math.round(length / diameter);

    diameter += (length - diameter * count) / count;
    radius = diameter * 0.5;

    var xValueInset = diameter * 0.05;
    var yValueOffset = radius * 3.5 / 3.0;

    return {
      count: count,
      radius: radius,
      diameter: diameter,
      p1: { x: xValueInset, y: -yValueOffset },
      p2: { x: diameter - xValueInset, y: -yValueOffset },
      p3: { x: diameter, y: 0 }
    };
  }

  function createTSide(hSidesParameters, path) {

    var sp = hSidesParameters;
    for (var i = 0; i < sp.count; ++i) {

      path.push('c');
      path.push(sp.p1.x);
      path.push(sp.p1.y);
      path.push(sp.p2.x);
      path.push(sp.p2.y);
      path.push(sp.p3.x);
      path.push(sp.p3.y);
    }

    return path;
  }

  function createRSide(vSidesParameters, path) {

    var sp = vSidesParameters;
    for (var i = 0; i < sp.count; ++i) {
      path.push('c');
      path.push(-sp.p1.y);
      path.push(sp.p1.x);
      path.push(-sp.p2.y);
      path.push(sp.p2.x);
      path.push(-sp.p3.y);
      path.push(sp.p3.x);
    }

    return path;
  }

  function createBSide(hSidesParameters, path) {

    var sp = hSidesParameters;
    for (var i = 0; i < sp.count; ++i) {
      path.push('c');
      path.push(-sp.p1.x);
      path.push(-sp.p1.y);
      path.push(-sp.p2.x);
      path.push(-sp.p2.y);
      path.push(-sp.p3.x);
      path.push(-sp.p3.y);
    }

    return path;
  }

  function createLSide(vSidesParameters, path) {

    var sp = vSidesParameters;
    for (var i = 0; i < sp.count; ++i) {
      path.push('c');
      path.push(sp.p1.y);
      path.push(-sp.p1.x);
      path.push(sp.p2.y);
      path.push(-sp.p2.x);
      path.push(sp.p3.y);
      path.push(-sp.p3.x);
    }

    return path;
  }

  var l = position.x;
  var t = position.y;
  var r = position.x + size.x;
  var b = position.y + size.y;

  var minSize = radius * 5;
  var path = [];

  if (size.x < minSize || size.y < minSize) {

    var w = size.x - strokeWidth;
    var h = size.y - strokeWidth;
    var x = -w * 0.5;
    var y = 0;

    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createEllipsePath)(x, y, w, h, false, path);
  } else {

    var hSidesParameters = getSideParameters(l, r, radius, strokeWidth);
    var vSidesParameters = getSideParameters(t, b, radius, strokeWidth);

    var cornerSizeX = hSidesParameters.diameter;
    var cornerSizeY = vSidesParameters.diameter;
    var cornerRadiusX = hSidesParameters.radius;
    var cornerRadiusY = vSidesParameters.radius;

    hSidesParameters = getSideParameters(l + cornerSizeX, r - cornerSizeX, radius, strokeWidth);
    vSidesParameters = getSideParameters(t + cornerSizeY, b - cornerSizeY, radius, strokeWidth);

    var halfStrokeWidth = strokeWidth * 0.5;
    let x = -size.x * 0.5 + halfStrokeWidth + cornerRadiusX;
    let y = -size.y * 0.5 + halfStrokeWidth + cornerRadiusY * 2;

    path.push('M');
    path.push(x);
    path.push(y);

    createCorner('LT', cornerRadiusX, cornerRadiusY, strokeWidth, path);
    createTSide(hSidesParameters, path);
    createCorner('RT', cornerRadiusX, cornerRadiusY, strokeWidth, path);
    createRSide(vSidesParameters, path);
    createCorner('RB', cornerRadiusX, cornerRadiusY, strokeWidth, path);
    createBSide(hSidesParameters, path);
    createCorner('LB', cornerRadiusX, cornerRadiusY, strokeWidth, path);
    createLSide(vSidesParameters, path);
  }

  path.push('z');
  return path;
};

/***/ },

/***/ "./extensions/Markup/core/MarkupDimension.js"
/*!***************************************************!*\
  !*** ./extensions/Markup/core/MarkupDimension.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupDimension: () => (/* binding */ MarkupDimension)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeDimension_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeDimension.js */ "./extensions/Markup/core/edit-modes/EditModeDimension.js");








var DIMENSION_MARKUP_HEIGHT = 10;
var TEXT_OFFSET = 2;
var DEFAULT_TEXT = 'Add Length';
var BACKGROUND_COLOR = 'none'; //'#ffffff';

/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupDimension(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'font-size', 'font-family', 'font-style', 'font-weight'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_DIMENSION;
  this.constraintHeight = true;
  this.constraintWidth = true;

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);
  this.createSvgElement = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createSvgElement.bind(this);
  this.checkLineSegment = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.checkLineSegment.bind(this);
  this.measureTextLines = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.measureTextLines.bind(this);


  this.firstAnchor = new THREE.Vector3();
  this.secondAnchor = new THREE.Vector3();
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();
  this.text = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupTextSvg)();
  this.shape.appendChild(this.text);
  this.textSize = { x: 0, y: 0 };
  this.initialText = DEFAULT_TEXT;
  this.currentText = ' ';

  if (!this.viewer.model.is2d()) {
    this.preventReposition = true;
    this.constraintRotation = true;
  }

  this.bindDomEvents();
}

MarkupDimension.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupDimension.prototype.constructor = MarkupDimension;

var proto = MarkupDimension.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeDimension_js__WEBPACK_IMPORTED_MODULE_4__.EditModeDimension(this.editor);
};

/**
 * Sets top-left and bottom-right values in client space coordinates (2d).
 * Notice that for the Dimension, the top left is the "secondAnchor" of the Dimension and
 * the bottom right is the "firstAnchor" of it.
 *
 * @param {Number} xO - secondAnchor
 * @param {Number} yO - secondAnchor
 * @param {Number} xF - firstAnchor
 * @param {Number} yF - firstAnchor
 */
proto.set = function (xO, yO, xF, yF, text) {

  var vO = new THREE.Vector2(xO, yO);
  var vF = new THREE.Vector2(xF, yF);
  var vDir = vF.clone().sub(vO).normalize();

  this.size.x = vO.distanceTo(vF); // TODO: Clamp min length
  this.rotation = Math.acos(vDir.dot(new THREE.Vector2(1, 0)));
  this.rotation = yF > yO ? Math.PI * 2 - this.rotation : this.rotation;

  var firstAnchor = this.firstAnchor;
  var secondAnchor = this.secondAnchor;

  firstAnchor.set(xF, yF, 0);
  secondAnchor.set(xO, yO, 0);

  this.position.x = secondAnchor.x + (firstAnchor.x - secondAnchor.x) * 0.5;
  this.position.y = secondAnchor.y + (firstAnchor.y - secondAnchor.y) * 0.5;

  this.currentText = text;
  this.updateStyle();
};

/**
 * Changes the rotation of the markup to the given angle.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetRotation edit action
 *
 * @param {Number} angle
 */
proto.setRotation = function (angle) {

  if ((0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(angle) === 90) {
    angle = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.degreesToRadians)(-90);
  }

  this.rotation = angle;

  var xF = Math.cos(-angle);
  var yF = Math.sin(-angle);
  var vFDir = new THREE.Vector2(xF, yF); // already normalized
  vFDir.multiplyScalar(this.size.x * 0.5);

  var vCenter = new THREE.Vector2(this.position.x, this.position.y);
  var vO = vCenter.clone().sub(vFDir);
  var vF = vCenter.clone().add(vFDir);

  this.firstAnchor.set(vF.x, vF.y, 0);
  this.secondAnchor.set(vO.x, vO.y, 0);

  this.updateStyle();
};

/**
 * Changes the position and size of the markup.
 * This gets called by the namespace.SetSize edit action
 * @param {{x: Number, y: Number}} position - Dimension's center
 * @param {Number} width - Dimension's length
 * @param {Number} height - We ignore this one because we use the Dimension's stroke width instead
 */
proto.setSize = function (position, width, height) {

  var xF = Math.cos(-this.rotation);
  var yF = Math.sin(-this.rotation);
  var vFDir = new THREE.Vector2(xF, yF); // already normalized
  vFDir.multiplyScalar(width * 0.5);

  var vCenter = new THREE.Vector2(position.x, position.y);
  var vO = vCenter.clone().sub(vFDir);
  var vF = vCenter.clone().add(vFDir);

  this.firstAnchor.set(vF.x, vF.y, 0);
  this.secondAnchor.set(vO.x, vO.y, 0);

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = width;

  this.updateStyle();
};

/**
 * Helper method that returns the font size in client space coords.
 * @returns {Number}
 */
proto.getClientFontSize = function () {

  return this.editor.sizeFromMarkupsToClient(0, this.style['font-size']).y;
};

proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var strokeWidth = style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var transform = this.getTransform();

  this.rebuildTextSvg(this.currentText);

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', this.getPath().join(' '));
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth / 2);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

proto.rebuildTextSvg = function (value) {
  var style = this.style;
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var strokeWidth = style['stroke-width'];
  var backgroundColor = value === ' ' ? 'none' : BACKGROUND_COLOR;

  var markup = this.createSvgElement('text');
  markup.setAttribute('id', 'markup');
  markup.setAttribute('alignment-baseline', 'middle');

  var text = this.text;
  var editor = this.editor;

  text.childNodes[0].removeChild(text.markup);
  text.childNodes[0].appendChild(markup);
  text.markup = markup;

  var tspan = this.createSvgElement('tspan');
  tspan.textContent = value;
  markup.appendChild(tspan);

  var lineSize = this.measureTextLines([value], style, editor)[0]; // Only one line for measurement
  var textSize = this.textSize = editor.sizeFromClientToMarkups(lineSize.width, lineSize.height);

  var edgeH = DIMENSION_MARKUP_HEIGHT * strokeWidth / 2;
  var textOffset = TEXT_OFFSET * strokeWidth / 2;
  var offset = textSize.x + 2 * strokeWidth >= this.size.x ? textOffset + edgeH / 2 : textOffset; // If the line is too short for the given text, put it under.

  this.size.y = edgeH + textSize.y + offset;

  var textTransform = this.getTextTransform(4 / 5 * textSize.y + offset, true); // Text height is Always 4/5 of the entire label height.
  var backgroundTransform = this.getTextTransform(textSize.y + offset, false);

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-family', style['font-family']);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-size', style['font-size']);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-weight', style['font-weight']);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'font-style', style['font-style']);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'text-rendering', 'auto');
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(text, 'fill', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setMarkupTextSvgTransform)(text, backgroundTransform, textTransform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgBackground)(text, textSize.x, textSize.y, backgroundColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgClipper)(text, textSize.x, textSize.y);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgHitarea)(text, textSize.x, textSize.y, editor);
};

proto.shouldFlip = function () {
  return this.firstAnchor.x < this.secondAnchor.x;
};

proto.getTextTransform = function (offset, inverse) {

  var flip = this.shouldFlip() ? -1 : 1;

  inverse = inverse ? -1 : 1;

  if ((0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(this.rotation) === 90) {
    this.rotation = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.degreesToRadians)(-90);
  }

  return [
  'translate(', this.position.x, ',', this.position.y, ')',
  'rotate(', (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(-this.rotation), ')',
  'translate(', -flip * this.textSize.x / 2, ',', -flip * offset, ')',
  'scale(' + flip + ',' + flip * inverse + ')'].
  join(' ');
};

/**
 * Used by the EditFrame to move the markup in Client Space coordinates
 * @param {Number} x - New X location for the markup. Notice that markups are centered on this value.
 * @param {Number} y - New Y location for the markup. Notice that markups are centered on this value.
 */
proto.setPosition = function (x, y) {

  var firstAnchor = this.firstAnchor;
  var secondAnchor = this.secondAnchor;

  var dx = firstAnchor.x - secondAnchor.x;
  var dy = firstAnchor.y - secondAnchor.y;

  var xo = x + dx * 0.5;
  var yo = y + dy * 0.5;

  firstAnchor.x = xo;
  firstAnchor.y = yo;

  secondAnchor.x = xo - dx;
  secondAnchor.y = yo - dy;

  this.position.x = secondAnchor.x + (firstAnchor.x - secondAnchor.x) * 0.5;
  this.position.y = secondAnchor.y + (firstAnchor.y - secondAnchor.y) * 0.5;

  this.updateStyle();
};

proto.generatePoint3d = function (idTarget) {

  var firstAnchor = this.editor.positionFromMarkupsToClient(this.firstAnchor.x, this.firstAnchor.y);
  var secondAnchor = this.editor.positionFromMarkupsToClient(this.secondAnchor.x, this.secondAnchor.y);

  var direction = firstAnchor.clone().sub(secondAnchor).normalize();

  var point2d = this.checkLineSegment(firstAnchor.x, firstAnchor.y, firstAnchor.x + direction.x * 200, firstAnchor.y + direction.y * 200, idTarget);
  var point3d = point2d && this.viewer.clientToWorld(point2d.x, point2d.y);

  return point3d && point3d.point;
};

proto.setMetadata = function () {

  this.text.setAttribute('pointer-events', 'none');

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.firstAnchor = [this.firstAnchor.x, this.firstAnchor.y].join(" ");
  metadata.secondAnchor = [this.secondAnchor.x, this.secondAnchor.y].join(" ");
  metadata.text = String(this.currentText);

  return this.addMarkupMetadata(this.shape, metadata);
};


/**
 * Returns the raw string value
 * @returns {String}
 */
proto.getText = function () {

  // if the current text is 'Add Length', you want the textbox will be empty when the user open it.
  return this.currentText === this.initialText ? '' : this.currentText;
};

proto.getPath = function () {

  //   1_                            _4
  //   | |                          | |
  //   | |2                        3| |
  //  0|  --------------------------  |
  //   |  --------------------------  |
  //   | |7                       6 | |
  //   |_|          TEXT            |_|
  //   8                             5

  var strokeWidth = this.style['stroke-width'];
  var segmentLength = this.size.x - strokeWidth / 2; // segment length (p2 to p3 length)
  var edgeH = DIMENSION_MARKUP_HEIGHT * strokeWidth / 2; // Edge height (p1 to p8 length)

  return [
  'M', -segmentLength * 0.5, 0, // 0
  'l', 0, edgeH / 2, // 1
  'l', 0, -edgeH / 2, // 2
  'l', segmentLength, 0, // 3
  'l', 0, edgeH / 2, // 4
  'l', 0, -edgeH, // 5
  'l', 0, edgeH / 2, // 6
  'l', -segmentLength, 0, // 7
  'l', 0, -edgeH / 2, // 8
  'z'];

};

proto.cloneShape = function (clone) {

  clone.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();
  clone.text = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupTextSvg)();
  clone.shape.appendChild(clone.text);
  clone.bindDomEvents();
};

proto.getBoundingRect = function () {
  var pos = this.getClientPosition();
  var size = this.getClientSize();
  return {
    x: pos.x - size.x / 2,
    y: pos.y - size.y / 2,
    width: size.x,
    height: size.y
  };
};

/***/ },

/***/ "./extensions/Markup/core/MarkupEvents.js"
/*!************************************************!*\
  !*** ./extensions/Markup/core/MarkupEvents.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EVENT_EDITFRAME_EDITION_END: () => (/* binding */ EVENT_EDITFRAME_EDITION_END),
/* harmony export */   EVENT_EDITFRAME_EDITION_START: () => (/* binding */ EVENT_EDITFRAME_EDITION_START),
/* harmony export */   EVENT_EDITMODE_CHANGED: () => (/* binding */ EVENT_EDITMODE_CHANGED),
/* harmony export */   EVENT_EDITMODE_CREATION_BEGIN: () => (/* binding */ EVENT_EDITMODE_CREATION_BEGIN),
/* harmony export */   EVENT_EDITMODE_CREATION_END: () => (/* binding */ EVENT_EDITMODE_CREATION_END),
/* harmony export */   EVENT_EDITMODE_ENTER: () => (/* binding */ EVENT_EDITMODE_ENTER),
/* harmony export */   EVENT_EDITMODE_LEAVE: () => (/* binding */ EVENT_EDITMODE_LEAVE),
/* harmony export */   EVENT_HISTORY_CHANGED: () => (/* binding */ EVENT_HISTORY_CHANGED),
/* harmony export */   EVENT_MARKUP_CANCEL_EDITION: () => (/* binding */ EVENT_MARKUP_CANCEL_EDITION),
/* harmony export */   EVENT_MARKUP_DELETE_EDITION: () => (/* binding */ EVENT_MARKUP_DELETE_EDITION),
/* harmony export */   EVENT_MARKUP_DESELECT: () => (/* binding */ EVENT_MARKUP_DESELECT),
/* harmony export */   EVENT_MARKUP_DRAGGING: () => (/* binding */ EVENT_MARKUP_DRAGGING),
/* harmony export */   EVENT_MARKUP_ENTER_EDITION: () => (/* binding */ EVENT_MARKUP_ENTER_EDITION),
/* harmony export */   EVENT_MARKUP_SELECTED: () => (/* binding */ EVENT_MARKUP_SELECTED)
/* harmony export */ });


/**
 * Fired whenever the drawing tool changes. For example, when the Arrow drawing
 * tool changes into the Rectangle drawing tool.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITMODE_CHANGED
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITMODE_CHANGED = "EVENT_EDITMODE_CHANGED";

/**
 * Fired when Edit mode has been enabled, which allows the end user to start
 * drawing markups over the Viewer canvas.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITMODE_ENTER
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITMODE_ENTER = "EVENT_EDITMODE_ENTER";

/**
 * Fired when Edit mode has been disabled, preventing the end user from
 * drawing markups over the Viewer canvas.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITMODE_LEAVE
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITMODE_LEAVE = "EVENT_EDITMODE_LEAVE";

/**
 * Fired when a drawn markup has been selected by the end user with a click command.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_MARKUP_SELECTED
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {object}
 * @property {Markup} markup The selected markup
 * @public
 */
const EVENT_MARKUP_SELECTED = "EVENT_MARKUP_SELECTED";

/**
 * Fired when a drawn markup is being dragged over the Viewer canvas.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_MARKUP_DRAGGING
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_MARKUP_DRAGGING = "EVENT_MARKUP_DRAGGING";

/**
 * Internal usage only.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_MARKUP_ENTER_EDITION
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @private
 */
const EVENT_MARKUP_ENTER_EDITION = "EVENT_MARKUP_ENTER_EDITION";

/**
 * Internal usage only.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_MARKUP_CANCEL_EDITION
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @private
 */
const EVENT_MARKUP_CANCEL_EDITION = "EVENT_MARKUP_CANCEL_EDITION";

/**
 * Internal usage only.
 *
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_MARKUP_DELETE_EDITION
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @private
 */
const EVENT_MARKUP_DELETE_EDITION = "EVENT_MARKUP_DELETE_EDITION";

/**
 * @typedef {object} EventHistoryChangedData
 The event data to identify the action and target for MarkupCore.EVENT_HISTORY_CHANGED event.
 * @property {string} action A string identifier for the action taken, like redo, undo, cancel, execute, clear
 * @property {number} targetId A number targetId based on the action.
 * @public
 */

/**
 * Fired whenever a new undo or redo action is available.
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_HISTORY_CHANGED
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {object}
 * @property {EventHistoryChangedData} data The event data to identify the action and target
 * @public
 */
const EVENT_HISTORY_CHANGED = "EVENT_HISTORY_CHANGED";

/**
 * Fired when a markup creation begins.
 * For example, as soon as the user starts dragging with the mouse
 * to draw an arrow on the screen.
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITMODE_CREATION_BEGIN
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITMODE_CREATION_BEGIN = "EVENT_EDITMODE_CREATION_BEGIN";

/**
 * Fired when a markup has been created.
 * For example, as soon as the user stops dragging and releases the
 * mouse button to finish drawing an arrow on the screen
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITMODE_CREATION_END
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITMODE_CREATION_END = "EVENT_EDITMODE_CREATION_END";

/**
 * Fired when a markup is no longer selected.
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_MARKUP_DESELECT
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {object}
 * @property {number} markupId The id of the selected markup
 * @public
 */
const EVENT_MARKUP_DESELECT = "EVENT_MARKUP_DESELECT";

/**
 * The selected markup is being modified, i.e, resizing, rotating, moving around
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITFRAME_EDITION_START
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITFRAME_EDITION_START = "EVENT_EDITFRAME_EDITION_START";

/**
 * The selected markup is no longer being modified
 * @event Autodesk.Viewing.Extensions.MarkupsCore#EVENT_EDITFRAME_EDITION_END
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @type {string}
 * @public
 */
const EVENT_EDITFRAME_EDITION_END = "EVENT_EDITFRAME_EDITION_END";

/***/ },

/***/ "./extensions/Markup/core/MarkupFreehand.js"
/*!**************************************************!*\
  !*** ./extensions/Markup/core/MarkupFreehand.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupFreehand: () => (/* binding */ MarkupFreehand)
/* harmony export */ });
/* harmony import */ var _MarkupPen_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MarkupPen.js */ "./extensions/Markup/core/MarkupPen.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _edit_modes_EditModeFreehand_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./edit-modes/EditModeFreehand.js */ "./extensions/Markup/core/edit-modes/EditModeFreehand.js");







/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupFreehand(id, editor) {

  _MarkupPen_js__WEBPACK_IMPORTED_MODULE_0__.MarkupPen.call(this, id, editor);
  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_FREEHAND;
}

MarkupFreehand.prototype = Object.create(_MarkupPen_js__WEBPACK_IMPORTED_MODULE_0__.MarkupPen.prototype);
MarkupFreehand.prototype.constructor = MarkupFreehand;

var proto = MarkupFreehand.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeFreehand_js__WEBPACK_IMPORTED_MODULE_2__.EditModeFreehand(this.editor);
};

/***/ },

/***/ "./extensions/Markup/core/MarkupHighlight.js"
/*!***************************************************!*\
  !*** ./extensions/Markup/core/MarkupHighlight.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupHighlight: () => (/* binding */ MarkupHighlight)
/* harmony export */ });
/* harmony import */ var _MarkupPen_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MarkupPen.js */ "./extensions/Markup/core/MarkupPen.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _edit_modes_EditModeHighlight_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./edit-modes/EditModeHighlight.js */ "./extensions/Markup/core/edit-modes/EditModeHighlight.js");






/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupHighlight(id, editor) {

  _MarkupPen_js__WEBPACK_IMPORTED_MODULE_0__.MarkupPen.call(this, id, editor);
  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_HIGHLIGHT;
}

MarkupHighlight.prototype = Object.create(_MarkupPen_js__WEBPACK_IMPORTED_MODULE_0__.MarkupPen.prototype);
MarkupHighlight.prototype.constructor = MarkupHighlight;

var proto = MarkupHighlight.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeHighlight_js__WEBPACK_IMPORTED_MODULE_2__.EditModeHighlight(this.editor);
};

/***/ },

/***/ "./extensions/Markup/core/MarkupPen.js"
/*!*********************************************!*\
  !*** ./extensions/Markup/core/MarkupPen.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupPen: () => (/* binding */ MarkupPen)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 * Base class for Pen Markup rendering (currently freehand and highlighter)
 *
 * Derived classes must implement getEditMode()
 * @param id
 * @param editor
 * @constructor
 */
function MarkupPen(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.addMarkupMetadata.bind(this);

  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.createMarkupPathSvg)();

  this.bindDomEvents();
}

MarkupPen.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupPen.prototype.constructor = MarkupPen;

var proto = MarkupPen.prototype;

/**
 * Sets top-left and bottom-right values in client space coordinates (2d).
 *
 * @param position
 * @param size
 * @param locations
 */
proto.set = function (position, size, locations, isAbsoluteCoords) {

  this.rotation = 0; // Reset angle //
  this.isAbsoluteCoords = isAbsoluteCoords;
  if (this.isAbsoluteCoords) {
    this.updatePath(locations);
  } else {
    this.locations = locations.slice(0);

    this.size.x = size.x === 0 ? 1 : size.x;
    this.size.y = size.y === 0 ? 1 : size.y;

    this.setSize(position, size.x, size.y);
    this.updateStyle();
  }
};

proto.setPosition = function (x, y) {

  this.position.x = x;
  this.position.y = y;

  var shape = this.shape;
  var transform = this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var path = this.getPath().join(' ');

  var strokeWidth = this.style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var fillColor = 'none';

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'stroke-linejoin', 'round');
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'stroke-linecap', 'round');
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'fill', fillColor);

  this.updatePath(path);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

proto.updatePath = function (path) {
  var shape = this.shape;
  var transform = this.isAbsoluteCoords ? 'scale(1)' : this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.setAttributeToMarkupSvg)(shape, 'd', path);
};

/**
 * Changes the position and size of the markup.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetSize edit action
 * @param {{x: Number, y: Number}} position
 * @param {Number} width
 * @param {Number} height
 */
proto.setSize = function (position, width, height) {

  width = width === 0 ? 1 : width;
  height = height === 0 ? 1 : height;

  var locations = this.locations;
  var locationsCount = locations.length;

  var scaleX = width / this.size.x;
  var scaleY = height / this.size.y;

  for (var i = 0; i < locationsCount; ++i) {

    var point = locations[i];

    point.x *= scaleX;
    point.y *= scaleY;
  }

  this.position.x = position.x;
  this.position.y = position.y;

  this.size.x = width;
  this.size.y = height;

  this.updateStyle();
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.rotation = String(this.rotation);
  metadata.locations = this.locations.map(function (point) {
    return [point.x, point.y].join(" ");
  }).join(" ");

  return this.addMarkupMetadata(this.shape, metadata);
};

proto.getPath = function () {

  var path = [];
  var locations = this.locations;
  var locationsCount = locations.length;

  if (locationsCount > 1) {

    path.push('M');
    path.push(+locations[0].x.toFixed(6));
    path.push(+locations[0].y.toFixed(6));

    for (var i = 1; i < locationsCount; ++i) {

      var locationA = locations[i - 1];
      var locationB = locations[i];

      path.push('l');
      path.push(+(locationB.x - locationA.x).toFixed(6));
      path.push(+(locationB.y - locationA.y).toFixed(6));
    }
  }

  return path;
};

/***/ },

/***/ "./extensions/Markup/core/MarkupPolyLine.js"
/*!**************************************************!*\
  !*** ./extensions/Markup/core/MarkupPolyLine.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupPolyline: () => (/* binding */ MarkupPolyline)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModePolyline_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModePolyline.js */ "./extensions/Markup/core/edit-modes/EditModePolyline.js");








/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupPolyline(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_POLYLINE;
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)('path');

  this.bindDomEvents();
}

MarkupPolyline.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupPolyline.prototype.constructor = MarkupPolyline;

var proto = MarkupPolyline.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModePolyline_js__WEBPACK_IMPORTED_MODULE_4__.EditModePolyline(this.editor);
};

/**
 * Sets top-left and bottom-right values in client space coordinates (2d).
 *
 * @param position
 * @param size
 * @param locations
 * @param closed
 */
proto.set = function (position, size, locations, closed) {

  this.rotation = 0; // Reset angle //
  this.locations = locations.concat();

  this.size.x = size.x === 0 ? 1 : size.x;
  this.size.y = size.y === 0 ? 1 : size.y;

  this.closed = closed;

  this.setSize(position, size.x, size.y);
  this.updateStyle();
};


/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;

  var strokeWidth = this.style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var fillColor = this.closed ? (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']) : 'none';
  var transform = this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', this.getPath().join(' '));
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', fillColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

/**
 * Changes the position and size of the markup.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetSize edit action
 * @param {{x: Number, y: Number}} position
 * @param {Number} width
 * @param {Number} height
 */
proto.setSize = function (position, width, height) {

  width = width === 0 ? 1 : width;
  height = height === 0 ? 1 : height;

  var locations = this.locations;
  var locationsCount = locations.length;

  var scaleX = width / this.size.x;
  var scaleY = height / this.size.y;

  for (var i = 0; i < locationsCount; ++i) {

    var point = locations[i];

    point.x *= scaleX;
    point.y *= scaleY;
  }

  this.position.x = position.x;
  this.position.y = position.y;

  this.size.x = width;
  this.size.y = height;

  this.updateStyle();
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.rotation = String(this.rotation);
  metadata.locations = this.locations.map(function (point) {
    return [point.x, point.y].join(" ");
  }).join(" ");

  return this.addMarkupMetadata(this.shape, metadata);
};

proto.getPath = function () {

  var path = [];
  var locations = this.locations;
  var locationsCount = locations.length;

  if (locationsCount === 0) {
    return ' ';
  }

  path.push('M');
  path.push(locations[0].x);
  path.push(locations[0].y);

  for (var i = 1; i < locationsCount; ++i) {

    var locationA = locations[i - 1];
    var locationB = locations[i];

    path.push('l');
    path.push(locationB.x - locationA.x);
    path.push(locationB.y - locationA.y);
  }

  this.closed && path.push('z');
  return path;
};

/***/ },

/***/ "./extensions/Markup/core/MarkupPolycloud.js"
/*!***************************************************!*\
  !*** ./extensions/Markup/core/MarkupPolycloud.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupPolycloud: () => (/* binding */ MarkupPolycloud)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModePolycloud_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModePolycloud.js */ "./extensions/Markup/core/edit-modes/EditModePolycloud.js");








/**
 *
 * @param id
 * @param editor
 * @constructor
 */
function MarkupPolycloud(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_POLYCLOUD;
  this.locations = [];
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();

  this.bindDomEvents();
}

MarkupPolycloud.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupPolycloud.prototype.constructor = MarkupPolycloud;

var proto = MarkupPolycloud.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModePolycloud_js__WEBPACK_IMPORTED_MODULE_4__.EditModePolycloud(this.editor);
};

/**
 *
 * Sets top-left and bottom-right values in client space coordinates (2d).
 * @param position
 * @param size
 * @param locations
 * @param closed
 */
proto.set = function (position, size, locations, closed) {

  this.rotation = 0; // Reset angle //
  this.locations = locations.concat();

  this.size.x = size.x === 0 ? 1 : size.x;
  this.size.y = size.y === 0 ? 1 : size.y;

  this.closed = closed;

  this.setSize(position, size.x, size.y);
  this.updateStyle();
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var path = this.getPath().join(' ');

  var strokeWidth = this.style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var fillColor = this.closed ? (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']) : 'none';
  var transform = this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', path);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', fillColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

/**
 * Changes the position and size of the markup.
 * This gets called by the Autodesk.Viewing.Extensions.Markups.Core.SetSize edit action
 * @param {{x: Number, y: Number}} position
 * @param {Number} width
 * @param {Number} height
 */
proto.setSize = function (position, width, height) {

  width = width === 0 ? 1 : width;
  height = height === 0 ? 1 : height;

  var locations = this.locations;
  var locationsCount = locations.length;

  var scaleX = width / this.size.x;
  var scaleY = height / this.size.y;

  for (var i = 0; i < locationsCount; ++i) {

    var point = locations[i];

    point.x *= scaleX;
    point.y *= scaleY;
  }

  this.position.x = position.x;
  this.position.y = position.y;

  this.size.x = width;
  this.size.y = height;

  this.updateStyle();
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.rotation = String(this.rotation);
  metadata.locations = this.locations.map(function (point) {
    return [point.x, point.y].join(" ");
  }).join(" ");

  return this.addMarkupMetadata(this.shape, metadata);
};

proto.getPath = function () {

  function getOrientation(locations) {

    switch (locations.length) {

      case 0:
      case 1:
        return 1;
      case 2:

        var fstPoint = locations[0];
        var sndPoint = locations[1];

        return fstPoint.y > sndPoint.y ? 1 : -1;
      default:

        var pointA = locations[0];
        var pointB = locations[1];
        var pointC = locations[2];

        var orientation =
        (pointB.x - pointA.x) * (pointB.y + pointA.y) +
        (pointC.x - pointB.x) * (pointC.y + pointB.y);

        return orientation < 0 ? 1 : -1;
    }
  }

  function getSides(locations, closed) {

    var locationsCount = locations.length;

    var sides = [];
    var sidesCount = locationsCount - (closed ? 0 : 1);

    for (var i = 0; i < sidesCount; ++i) {

      var locationA = locations[i];
      var locationB = locations[(i + 1) % locationsCount];

      var dx = locationB.x - locationA.x;
      var dy = locationB.y - locationA.y;

      var length = Math.sqrt(dx * dx + dy * dy);

      sides.push({
        index: i,
        pointA: new THREE.Vector3(locationA.x, locationA.y, 0),
        pointB: new THREE.Vector3(locationB.x, locationB.y, 0),
        vecAB: new THREE.Vector3(dx / length, dy / length, 0),
        vecBA: new THREE.Vector3(-dx / length, -dy / length, 0),
        length: length
      });
    }

    return sides;
  }

  function updateCorners(side, cornerA, cornerB, orientation) {
    var rA = cornerA.radius;
    var rB = cornerB.radius;
    var D = side.length;

    if (rA > 0 && rB > 0 && rA + rB > D && Math.abs(rA - rB) < D) {
      // Corner arcs overlap, so correct them by finding the circle-circle intersection
      var a = side.pointA.x;
      var b = side.pointA.y;
      var c = side.pointB.x;
      var d = side.pointB.y;

      var delta = 0.25 * Math.sqrt((D + rA + rB) * (D + rA - rB) * (D - rA + rB) * (-D + rA + rB));
      var xS = (a + c) / 2 + (c - a) * (rA * rA - rB * rB) / (2 * D * D);
      var xT = 2 * (b - d) / (D * D) * delta;
      var yS = (b + d) / 2 + (d - b) * (rA * rA - rB * rB) / (2 * D * D);
      var yT = 2 * (a - c) / (D * D) * delta;
      var x1 = xS + xT;
      var x2 = xS - xT;
      var y1 = yS - yT;
      var y2 = yS + yT;
      var testPointOnCircle = Math.abs((x1 - a) * (x1 - a) + (y1 - b) * (y1 - b) - rA * rA);
      if (testPointOnCircle > 0.0000001) {
        var tmp = y1;
        y1 = y2;
        y2 = tmp;
      }

      var intersec = new THREE.Vector3(x1, y1, 0);
      var intersecSide = Math.sign(intersec.clone().sub(side.pointA).cross(side.vecAB).z);
      if (intersecSide !== orientation) {
        intersec.set(x2, y2, 0);
      }

      cornerA.pointB = intersec.clone();
      cornerB.pointA = intersec.clone();

      return true;
    }

    return false;
  }

  function updateSides(sides, corners, radius, orientation) {

    var diameter = radius * 2;
    var sidesCount = sides.length;

    for (var i = 0; i < sidesCount; ++i) {

      var side = sides[i];
      var cornerA = corners[i];
      var cornerB = corners[(i + 1) % sidesCount];

      side.bodyA = side.vecAB.clone().multiplyScalar(cornerA.radius).add(side.pointA);
      side.bodyB = side.vecBA.clone().multiplyScalar(cornerB.radius).add(side.pointB);

      if (updateCorners(side, cornerA, cornerB, orientation)) {
        side.body = 0;
        side.bodyDiameter = side.bodyCount = 0;
      } else {
        side.body = side.bodyB.clone().sub(side.bodyA).length();
        side.bodyCount = Math.round(side.body / diameter);
        if (side.bodyCount === 0 && side.body > 0.5 * radius) {
          side.bodyCount = 1;
        }
        side.bodyDiameter = diameter + (side.body - diameter * side.bodyCount) / side.bodyCount;
      }

      side.bodyRadius = side.bodyDiameter * 0.5;
    }
  }

  function getCorners(sides, radius, closed) {

    var corners = [];
    var sidesCount = sides.length;

    for (var i = 0; i < sidesCount; ++i) {

      var sideA = sides[i !== 0 ? i - 1 : sidesCount - 1];
      var sideB = sides[i];
      var large = sideA.vecBA.clone().cross(sideB.vecAB).z < 0;

      var sidesTooShort = sideA.length < radius || sideB.length < radius;
      if (sidesTooShort || i === 0 && !closed) {

        corners.push({
          pointA: sideB.pointA.clone(),
          pointB: sideB.pointA.clone(),
          radius: 0,
          large: false
        });
      } else {

        corners.push({
          pointA: sideB.pointA.clone().add(sideA.vecBA.clone().multiplyScalar(radius)),
          pointB: sideB.pointA.clone().add(sideB.vecAB.clone().multiplyScalar(radius)),
          radius: radius,
          large: large
        });
      }
    }

    return corners;
  }

  function createSidePath(side, orientation, path) {

    var count = side.bodyCount;
    if (count === 0) {
      return;
    }

    var radius = side.bodyRadius;
    var diameter = side.bodyDiameter;

    var xValueInset = diameter * 0.05;
    var yValueOffset = radius * 3.5 / 3.0;

    var p1 = new THREE.Vector3(xValueInset, orientation * -yValueOffset);
    var p2 = new THREE.Vector3(diameter - xValueInset, orientation * -yValueOffset);
    var p3 = new THREE.Vector3(diameter, 0);

    var angle = Math.acos(side.vecAB.x) * (side.vecAB.y < 0 ? -1 : 1);
    var rotation = new THREE.Matrix4().makeRotationZ(angle);

    p1.applyMatrix4(rotation);
    p2.applyMatrix4(rotation);
    p3.applyMatrix4(rotation);

    for (var i = 0; i < count; ++i) {

      path.push('c');
      path.push(p1.x);
      path.push(p1.y);
      path.push(p2.x);
      path.push(p2.y);
      path.push(p3.x);
      path.push(p3.y);
    }
  }

  function createCornerPath(corner, first, orientation, path) {

    if (first) {

      path.push('M');
      path.push(corner.pointA.x);
      path.push(corner.pointA.y);
    }

    var large = orientation === 1 ? corner.large : !corner.large;

    if (corner.radius !== 0) {

      path.push('a');
      path.push(corner.radius);
      path.push(corner.radius);
      path.push(0);
      path.push(large ? 1 : 0);
      path.push(orientation === 1 ? 1 : 0);
      path.push(corner.pointB.x - corner.pointA.x);
      path.push(corner.pointB.y - corner.pointA.y);
    }
    return path;
  }


  var strokeWidth = this.style['stroke-width'];
  var radius = strokeWidth * 2;
  var orientation = getOrientation(this.locations);
  var closed = this.closed;
  var path = [];

  var sides = getSides(this.locations, closed);
  var corners = getCorners(sides, radius, closed);
  var cornersCount = corners.length;

  updateSides(sides, corners, radius, orientation);

  for (var i = 0; i < cornersCount; ++i) {

    createCornerPath(corners[i], i === 0, orientation, path);
    createSidePath(sides[i], orientation, path);
  }

  closed && path.push('z');
  return path;
};

/***/ },

/***/ "./extensions/Markup/core/MarkupRectangle.js"
/*!***************************************************!*\
  !*** ./extensions/Markup/core/MarkupRectangle.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupRectangle: () => (/* binding */ MarkupRectangle)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeRectangle_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeRectangle.js */ "./extensions/Markup/core/edit-modes/EditModeRectangle.js");








/**
 * Rectangle markup.
 *
 * Implements a Rectangle {@link Autodesk.Viewing.Extensions.Markups.Core.Markup|Markup}.
 * Included in documentation as an example of how to create
 * a specific markup type. Developers are encourage to look into this class's source code and copy
 * as much code as they need. Find link to source code below.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 * @extends Autodesk.Viewing.Extensions.Markups.Core.Markup
 *
 * @param {number} id
 * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore} editor
 * @constructor
 */
function MarkupRectangle(id, editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // Bind to this to pass this.globalManager
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_RECTANGLE;
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupPathSvg)();

  this.bindDomEvents();
}

MarkupRectangle.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupRectangle.prototype.constructor = MarkupRectangle;

var proto = MarkupRectangle.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeRectangle_js__WEBPACK_IMPORTED_MODULE_4__.EditModeRectangle(this.editor);
};

/**
 * Sets position and size in markup space coordinates
 * @param {Object} position
 * @param {Object} size
 */
proto.set = function (position, size) {

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = size.x;
  this.size.y = size.y;

  this.updateStyle();
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function () {

  var style = this.style;
  var shape = this.shape;
  var path = this.getPath().join(' ');

  var strokeWidth = this.style['stroke-width'];
  var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
  var fillColor = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']);
  var transform = this.getTransform();

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'd', path);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke-width', strokeWidth);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'stroke', strokeColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', fillColor);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'transform', transform);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupPathSvgHitarea)(shape, this.editor);
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.rotation = String(this.rotation);

  return this.addMarkupMetadata(this.shape, metadata);
};

proto.getPath = function () {

  var strokeWidth = this.style['stroke-width'];

  var w = this.size.x - strokeWidth;
  var h = this.size.y - strokeWidth;
  var x = -w * 0.5;
  var y = -h * 0.5;

  var path = [];
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createRectanglePath)(x, y, w, h, false, path);

  return path;
};

/***/ },

/***/ "./extensions/Markup/core/MarkupStamp.js"
/*!***********************************************!*\
  !*** ./extensions/Markup/core/MarkupStamp.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupStamp: () => (/* binding */ MarkupStamp)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeStamp_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeStamp.js */ "./extensions/Markup/core/edit-modes/EditModeStamp.js");










class MarkupStamp extends _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup {
  /**
   * @param {number} id
   * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore} editor
   */
  constructor(id, editor, svgData) {
    const styleAttributes = [
    'text-data'];

    super(id, editor, styleAttributes);
    this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_STAMP;
    this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

    this.createShapeGroup();

    this.scriptSvgData = svgData;
    this.loadSvgData();

    this.bindDomEvents();
  }

  createShapeGroup() {
    /*
    * shape
    *    group
    *      customSvg
    *    hitarea (aka markup)
    */
    this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createSvgElement)('g');
    this.shape.group = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createSvgElement)('g');
    this.shape.appendChild(this.shape.group);

    let hitarea = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createSvgElement)('path');
    hitarea.setAttribute('id', "hitarea");
    hitarea.setAttribute('fill', "none");
    this.shape.appendChild(hitarea);

    this.shape.hitarea = hitarea;
    this.shape.markup = hitarea;
  }

  loadSvgData() {
    let svgString = this.scriptSvgData || this.style['text-data'];
    let svgNode = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.stringToSvgNode)(svgString);

    // null if parsing fails, so exit
    if (svgNode === null) {
      console.warn("SVG data " + svgString + " is invalid, skipping shape update");
      return;
    }

    let [width, height] = this.getDimensions(svgNode);

    // update the bounding box when the SVG is changed
    let path = `M 0 0 l ${width} 0 l 0 ${height} l ${-width} 0 z`;
    this.shape.hitarea.setAttribute('d', path);

    this.shape.group.innerHTML = svgNode.innerHTML;

    // This is to standardize things:
    // width and height are 1 unit
    // position is in the centre
    // have to flip things because of y axis going upwards
    this.shape.group.setAttribute('transform', `translate( -0.5 , 0.5 ) scale( ${1 / width} , ${-1 / height} )`);
    // then copy to the hitarea because it's outside the SVG
    this.shape.hitarea.setAttribute('transform', this.shape.group.getAttribute('transform'));
  }

  getEditMode() {
    return new _edit_modes_EditModeStamp_js__WEBPACK_IMPORTED_MODULE_4__.EditModeStamp(this.editor);
  }

  set(position, size) {
    this.setSize(position, size.x, size.y);
    this.updateStyle();
  }

  updateStyle(styleChanged) {
    const strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(this.style['stroke-color'], this.style['stroke-opacity']);
    this.shape.hitarea.setAttribute('stroke', strokeColor);

    // This only provides translation and rotation, not scale
    const transform = this.getTransform() + ` scale( ${this.size.x} , ${this.size.y} )`;
    this.shape.setAttribute('transform', transform);

    if (styleChanged) {
      this.loadSvgData();
    }
  }

  getDimensions(customSvg) {
    let vb = customSvg.getAttribute('viewBox');
    if (!vb) {
      // if no viewbox is specified, check for width and height
      let width = customSvg.getAttribute('width') || 100;
      let height = customSvg.getAttribute('height') || 100;
      return [width, height];
    }
    let strings = vb.split(' ');
    let width = parseInt(strings[2]);
    let height = parseInt(strings[3]);

    return [width, height];
  }

  setMetadata() {

    var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

    metadata.type = this.type;
    metadata.position = [this.position.x, this.position.y].join(" ");
    metadata.size = [this.size.x, this.size.y].join(" ");
    metadata.rotation = String(this.rotation);

    return this.addMarkupMetadata(this.shape, metadata);
  }

  setStyle(style) {
    let stylesEqual = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.isStyleEqual)(style, this.style);
    if (!stylesEqual) {
      (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.copyStyle)(style, this.style);
    }

    this.updateStyle(!stylesEqual);
  }
}

/***/ },

/***/ "./extensions/Markup/core/MarkupText.js"
/*!**********************************************!*\
  !*** ./extensions/Markup/core/MarkupText.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupText: () => (/* binding */ MarkupText)
/* harmony export */ });
/* harmony import */ var _Markup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_modes_EditModeText_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-modes/EditModeText.js */ "./extensions/Markup/core/edit-modes/EditModeText.js");








// LMV ViewerLMV-2170 [Markup] [PDF] Text markup missing/cutoff for normal sized text.
// If the font size of an SVG text is too small, the text is not rendered independently of its final screen size.
// To solve the issue we multiply font size by 100 and scale down the text in its transform.
var FONT_SIZE_SCALE = 100;

var STARTING_WIDTH_FACTOR = 6;

/**
 * Text Markup.
 * @constructor
 */
function MarkupText(id, editor, size) {

  var styleAttributes = [
  'font-size',
  'stroke-color',
  'stroke-opacity',
  'fill-color',
  'fill-opacity',
  'font-family',
  'font-style',
  'font-weight'];


  _Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.call(this, id, editor, styleAttributes);

  // Bind to this to pass globalManager
  this.createSvgElement = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createSvgElement.bind(this);
  this.addMarkupMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addMarkupMetadata.bind(this);

  this.type = _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_TEXT;
  this.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupTextSvg)();
  this.constraintRotation = true;
  this.constraintHeight = true;
  this.constraintWidth = false;
  this.size.x = size.x;
  this.size.y = size.y;
  this.currentText = "";
  this.currentTextLines = [""];
  this.textDirty = true;
  this.textSize = { x: 0, y: 0 };
  this.prevHighlight = false;
  this.isHelperTextActive = false;

  // Note: We could have this property be a style property.
  // However, there is no need for this property to be exposed to the user for alteration
  // This value is a percentage of the font size used to offset vertically 2 text lines
  // of the same paragraph.
  // Notice that this value is used by EditorTextInput.js
  this.lineHeight = 130;

  this.minWidth = this.getClientFontSize() * STARTING_WIDTH_FACTOR;

  this.bindDomEvents();
}

MarkupText.prototype = Object.create(_Markup_js__WEBPACK_IMPORTED_MODULE_0__.Markup.prototype);
MarkupText.prototype.constructor = MarkupText;

var proto = MarkupText.prototype;

proto.getEditMode = function () {

  return new _edit_modes_EditModeText_js__WEBPACK_IMPORTED_MODULE_4__.EditModeText(this.editor);
};

/**
 *
 * @param {String} position
 * @param {String} size
 * @param {String} textString
 */
proto.set = function (position, size, textString) {

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = size.x;
  this.size.y = size.y;

  this.setText(textString);
};

proto.setSize = function (position, width, height) {

  this.position.x = position.x;
  this.position.y = position.y;
  this.size.x = width;
  this.size.y = height;

  var sizeUpdateRequired = true;

  if (this.isHelperTextActive) {
    this.updateTextBoxStyle();
  } else {
    this.updateStyle(sizeUpdateRequired);
  }
};

proto.setPosition = function (x, y) {

  this.position.x = x;
  this.position.y = y;

  if (this.isHelperTextActive) {
    this.updateTextBoxStyle();
  } else {
    this.updateStyle();
  }
};

proto.setStyle = function (style) {

  var stylesEqual = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.isStyleEqual)(style, this.style);

  if (!stylesEqual) {
    (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.copyStyle)(style, this.style);
  }

  this.updateStyle(!stylesEqual);
};

/**
 *
 * @param {String} text
 */
proto.setText = function (text) {

  this.currentText = text;
};

/**
 * Returns the raw string value
 * @returns {String}
 */
proto.getText = function () {

  return this.currentText;
};

/**
 * Returns a shallow copy of the text lines used for rendering SVG text
 * @returns {Array.<String>}
 */
proto.getTextLines = function () {

  return this.currentTextLines.concat();
};

proto.highlightChanged = function () {

  if (this.highlighted && this.highlighted !== this.prevHighlight) {
    var shape = this.shape;
    var strokeColor = this.highlightColor;
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', strokeColor);

    this.prevHighlight = true;
    return false;
  }

  return true;
};

proto.updateTextBoxStyle = function () {
  var editMode = this.editor.duringEditMode && this.editor.editMode;

  if (!editMode || editMode.type !== this.type) {
    editMode = this.getEditMode();
  }

  editMode.updateTextBoxStyle();
};

proto.setIsHelperTextActive = function (isActive) {
  this.isHelperTextActive = isActive;
};

/**
 * Applies data values into DOM element style/attribute(s)
 *
 */
proto.updateStyle = function (sizeUpdateRequired) {

  if (this.highlightChanged()) {
    this.prevHighlight = false;
    var style = this.style;
    var shape = this.shape;
    var fontSize = this.style['font-size'];
    var fontFamily = this.style['font-family'];
    var fontWeight = this.style['font-weight'];
    var fontStyle = this.style['font-style'];
    var strokeColor = this.highlighted ? this.highlightColor : (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['stroke-color'], style['stroke-opacity']);
    var fillColor = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.composeRGBAString)(style['fill-color'], style['fill-opacity']);

    // FONT_SIZE_SCALE is used to scale up fontSize, but it is only needed in cases where the font size is too small
    FONT_SIZE_SCALE = fontSize > 1 ? 1 : 100;

    this.rebuildTextSvg(sizeUpdateRequired);

    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'font-family', fontFamily);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'font-size', fontSize * FONT_SIZE_SCALE);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'fill', strokeColor);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'font-weight', fontWeight);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setAttributeToMarkupSvg)(shape, 'font-style', fontStyle);

    var editor = this.editor;
    var transform = this.getTransform();
    var textTransform = this.getTextTransform();

    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.setMarkupTextSvgTransform)(shape, transform, textTransform);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgBackground)(shape, this.size.x, this.size.y, fillColor);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgClipper)(shape, this.size.x, this.size.y);
    (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateMarkupTextSvgHitarea)(shape, this.size.x, this.size.y, editor);
  }
};

/**
 * Re-creates SVG tags that render SVG text.
 * Each line is placed around tspan tags which are vertically offset to each other.
 */
proto.rebuildTextSvg = function (sizeUpdateRequired) {

  // TODO: Remove the need to get text values from an object in edit mode, should be a function.
  // editMode needs to be set to load markups in view mode
  var editMode = this.editor.duringEditMode && this.editor.editMode;

  if (!editMode || editMode.type !== this.type) {
    editMode = this.getEditMode();
    editMode.textInputHelper.textArea.value = this.currentText;
    editMode.textInputHelper.setStyle(this.style);
  }

  if (editMode.textInputHelper.textMarkup && editMode.textInputHelper.textMarkup !== this) {
    return;
  }

  var style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(editMode.textInputHelper.style);
  var text = editMode.textInputHelper.textArea.value;

  var textHelperValues = editMode.textInputHelper.getTextValuesForMarkup(this, sizeUpdateRequired);

  this.currentTextLines = textHelperValues.textValues.lines;

  if (textHelperValues.newPos) {
    var position = this.editor.positionFromClientToMarkups(textHelperValues.newPos.x, textHelperValues.newPos.y);
    var size = this.editor.sizeFromClientToMarkups(textHelperValues.width, textHelperValues.height);

    this.position.x = position.x;
    this.position.y = position.y;
    this.size.x = size.x;
    this.size.y = size.y;
  }

  if (editMode.selectedMarkup !== this && !editMode.textInputHelper.firstEdit) {
    editMode.textInputHelper.textArea.value = text;
    editMode.textInputHelper.setStyle(style);
  }

  var markup = this.createSvgElement('text');
  markup.setAttribute('id', 'markup');
  markup.setAttribute('alignment-baseline', 'middle');

  this.shape.childNodes[0].removeChild(this.shape.markup);
  this.shape.childNodes[0].appendChild(markup);
  this.shape.markup = markup;

  // For each line, create a tspan, add as child and offset it vertically.
  var yOffset = this.getLineHeight() * FONT_SIZE_SCALE * (this.lineHeight / 100);

  var padding = this.getLineHeight() * FONT_SIZE_SCALE / 2;
  var dx = padding;
  var dy = padding;

  this.currentTextLines.forEach(function (line) {

    var tspan = this.createSvgElement('tspan');

    tspan.setAttribute('x', dx);
    tspan.setAttribute('y', dy);
    tspan.textContent = line;

    markup.appendChild(tspan);
    dy += yOffset;
  }.bind(this));
};

proto.setIsShapeVisible = function (isVisible) {

  this.shape.style.display = isVisible ? 'block' : 'none';
};

proto.setMetadata = function () {

  var metadata = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_3__.cloneStyle)(this.style);

  metadata.type = this.type;
  metadata.position = [this.position.x, this.position.y].join(" ");
  metadata.size = [this.size.x, this.size.y].join(" ");
  metadata.text = String(this.currentText);

  return this.addMarkupMetadata(this.shape, metadata);
};

/**
 * Helper method that returns the font size in client space coords.
 * @returns {Number}
 */
proto.getClientFontSize = function () {

  return this.editor.sizeFromMarkupsToClient(0, this.style['font-size']).y;
};

proto.getLineHeight = function () {

  return this.style['font-size'];
};

proto.getTransform = function () {

  var x = this.position.x - this.size.x * 0.5;
  var y = this.position.y + this.size.y * 0.5;

  return [
  'translate(', x, ',', y, ')',
  'rotate(', (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(-this.rotation), ')',
  'scale(1,-1)'].
  join(' ');
};

proto.getTextTransform = function () {

  var lineHeight = this.getLineHeight();

  var x = this.position.x - this.size.x * 0.5;
  var y = this.position.y + this.size.y * 0.5 - lineHeight;

  return [
  'translate(', x, ',', y, ')',
  'rotate(', (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.radiansToDegrees)(-this.rotation), ')',
  'scale(' + 1 / FONT_SIZE_SCALE + ',' + -1 / FONT_SIZE_SCALE + ')'].
  join(' ');
};

proto.cloneShape = function (clone) {

  clone.shape = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.createMarkupTextSvg)();
  clone.bindDomEvents();
};

proto.getBoundingRect = function () {
  var pos = this.getClientPosition();
  var size = this.getClientSize();
  return {
    x: pos.x - size.x / 2,
    y: pos.y - size.y / 2,
    width: size.x,
    height: size.y
  };
};

/***/ },

/***/ "./extensions/Markup/core/MarkupTool.js"
/*!**********************************************!*\
  !*** ./extensions/Markup/core/MarkupTool.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupTool: () => (/* binding */ MarkupTool)
/* harmony export */ });


var avp = Autodesk.Viewing.Private;

// Custom tools passed via MarkupsCore's `markupToolClass` option may reuse MarkupTool in the function style,
// `MarkupTool.call(this)`, which v7 supports through LegacyConstructible (the base class of ToolInterface).
// Such tools don't necessarily inherit from MarkupTool.prototype, so the constructor has to assign all methods
// on the instance. Declaring them in the class body instead (and opting in via avp.usePrototypeToolMethods)
// can only be done in v8, which doesn't support `MarkupTool.call(this)`.
class MarkupTool extends Autodesk.Viewing.ToolInterface {

  constructor() {
    super();
    this.names = ["markups.core"];
    this.panTool = null;
    this.allowNav = false;
    this.is2d = false;

    this.coreExt = null;
    this.hotkeysEnabled = true;

    var _ctrlDown = false;
    var _shiftDown = false;

    // Non-ToolInterface methods //

    this.allowNavigation = function (allow) {
      this.allowNav = allow;
    };
    this.setCoreExtension = function (coreExt) {
      this.coreExt = coreExt;
    };
    this.setHotkeysEnabled = function (enabled) {
      this.hotkeysEnabled = enabled;
    };


    // ToolInterface methods //

    this.activate = function (name, viewerApi) {
      this.panTool = viewerApi.toolController.getTool("pan");
      if (this.panTool) {
        this.panTool.activate("pan"); // TODO: What if we want "zoom" here?
      }

      this.is2d = viewerApi.model.is2d();
      this.viewer = viewerApi;
    };

    this.deactivate = function (name) {
      if (this.panTool) {
        this.panTool.deactivate("pan");
      }
    };

    this.handleKeyDown = function (event, keyCode) {

      if (!this.coreExt.editMode) {
        return false;
      }

      if (!this.hotkeysEnabled) {
        return true; // Consume event
      }

      // Don't propagate key handling down to tool //

      switch (keyCode) {
        case Autodesk.Viewing.KeyCode.CONTROL:_ctrlDown = true;break;
        case Autodesk.Viewing.KeyCode.SHIFT:_shiftDown = true;break;

        case Autodesk.Viewing.KeyCode.x:_ctrlDown && !this.allowNav && this.coreExt.cut();break;
        case Autodesk.Viewing.KeyCode.c:_ctrlDown && !this.allowNav && this.coreExt.copy();break;
        case Autodesk.Viewing.KeyCode.v:_ctrlDown && !this.allowNav && this.coreExt.paste();break;
        case Autodesk.Viewing.KeyCode.d:
          if (_ctrlDown && !this.allowNav) {
            // Duplicate
            this.coreExt.copy();
            this.coreExt.paste();
          }
          break;
        case Autodesk.Viewing.KeyCode.z:
          if (_ctrlDown && !_shiftDown && !this.allowNav) {
            this.coreExt.undo();
          } else
          if (_ctrlDown && _shiftDown && !this.allowNav) {
            this.coreExt.redo(); // Also support Ctrl+Y
          }
          break;
        case Autodesk.Viewing.KeyCode.y:_ctrlDown && !this.allowNav && this.coreExt.redo();break; // Also support ctrl+shift+z
        case Autodesk.Viewing.KeyCode.ESCAPE:this.coreExt.onUserCancel();break;

        case Autodesk.Viewing.KeyCode.BACKSPACE: // Fall through
        case Autodesk.Viewing.KeyCode.DELETE:
          var selectedMarkup = this.coreExt.getSelection();
          if (selectedMarkup) {
            this.coreExt.deleteMarkup(selectedMarkup);
          }
          break;
        case Autodesk.Viewing.KeyCode.F12:
          return false; // To allow opening developer console.
        default:break;
      }

      return true; // Consume event
    };
    this.handleKeyUp = function (event, keyCode) {

      if (!this.coreExt.editMode) {
        return false;
      }

      if (!this.hotkeysEnabled) {
        return true; // Consume event
      }

      // Don't propagate key handling down to tool

      switch (keyCode) {
        case Autodesk.Viewing.KeyCode.CONTROL:_ctrlDown = false;break;
        case Autodesk.Viewing.KeyCode.SHIFT:_shiftDown = false;break;
        default:break;
      }

      return true; // Consume event ONLY
    };

    this.update = function () {
      if (this.allowNav && this.panTool && this.panTool.update) {
        return this.panTool.update();
      }
      return false;
    };

    this.handleSingleClick = function (event, button) {
      if (this.allowNav) {
        // If pan tool won't handle single click, then pass over the event.
        if (this.panTool && this.panTool.handleSingleClick)
        return this.panTool.handleSingleClick(event, button);else

        return false;
      }
      return true; // Consume event
    };
    this.handleDoubleClick = function (event, button) {
      if (this.allowNav) {
        // If pan tool won't handle double click, then pass over the event
        if (this.panTool && this.panTool.handleDoubleClick) {
          return this.panTool.handleDoubleClick(event, button);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleSingleTap = function (event) {
      if (this.allowNav) {
        // If pan tool won't handle single tap, then pass over the event
        if (this.panTool && this.panTool.handleSingleTap) {
          return this.panTool.handleSingleTap(event);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleDoubleTap = function (event) {
      if (this.allowNav) {
        // If pan tool won't handle double tap, then pass over the event
        if (this.panTool && this.panTool.handleDoubleTap) {
          return this.panTool.handleDoubleTap(event);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleWheelInput = function (delta, event) {
      if (this.allowNav || this.is2d) {
        // If pan tool won't handle wheel input, then pass over the event
        if (this.panTool && this.panTool.handleWheelInput) {
          this.coreExt.callSnapperMouseMove();
          return this.panTool.handleWheelInput(delta, event);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleButtonDown = function (event, button) {
      if (this.allowNav || this.is2d && (avp.isRightClick(event, this.viewer.navigation) || avp.isMiddleClick(event))) {
        // If pan tool won't handle button down, then pass over the event
        if (this.panTool && this.panTool.handleButtonDown) {
          return this.panTool.handleButtonDown(event, button);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleButtonUp = function (event, button) {
      if (this.allowNav || this.is2d && (avp.isRightClick(event, this.viewer.navigation) || avp.isMiddleClick(event))) {
        // If pan tool won't handle button up, then pass over the event
        if (this.panTool && this.panTool.handleButtonUp) {
          return this.panTool.handleButtonUp(event, button);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleMouseMove = function (event) {
      if (this.allowNav || this.is2d) {
        // If pan tool won't handle button move, then pass over the event
        if (this.panTool && this.panTool.handleMouseMove) {
          return this.panTool.handleMouseMove(event);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleGesture = function (event) {
      if (this.allowNav || this.is2d) {
        // If pan tool won't handle gesture, then pass over the event
        if (this.panTool && this.panTool.handleGesture) {
          return this.panTool.handleGesture(event);
        } else

        return false;
      }
      return true; // Consume event
    };
    this.handleBlur = function (event) {
      if (this.allowNav) {
        // If pan tool won't handle blur, then pass over the event
        if (this.panTool && this.panTool.handleBlur) {
          return this.panTool.handleBlur(event);
        } else

        return false;
      }
      return true; // Consume event
    };
  }
}

/***/ },

/***/ "./extensions/Markup/core/MarkupTypes.js"
/*!***********************************************!*\
  !*** ./extensions/Markup/core/MarkupTypes.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MARKUP_TYPE_ARROW: () => (/* binding */ MARKUP_TYPE_ARROW),
/* harmony export */   MARKUP_TYPE_CALLOUT: () => (/* binding */ MARKUP_TYPE_CALLOUT),
/* harmony export */   MARKUP_TYPE_CIRCLE: () => (/* binding */ MARKUP_TYPE_CIRCLE),
/* harmony export */   MARKUP_TYPE_CLOUD: () => (/* binding */ MARKUP_TYPE_CLOUD),
/* harmony export */   MARKUP_TYPE_DIMENSION: () => (/* binding */ MARKUP_TYPE_DIMENSION),
/* harmony export */   MARKUP_TYPE_FREEHAND: () => (/* binding */ MARKUP_TYPE_FREEHAND),
/* harmony export */   MARKUP_TYPE_HIGHLIGHT: () => (/* binding */ MARKUP_TYPE_HIGHLIGHT),
/* harmony export */   MARKUP_TYPE_POLYCLOUD: () => (/* binding */ MARKUP_TYPE_POLYCLOUD),
/* harmony export */   MARKUP_TYPE_POLYLINE: () => (/* binding */ MARKUP_TYPE_POLYLINE),
/* harmony export */   MARKUP_TYPE_RECTANGLE: () => (/* binding */ MARKUP_TYPE_RECTANGLE),
/* harmony export */   MARKUP_TYPE_STAMP: () => (/* binding */ MARKUP_TYPE_STAMP),
/* harmony export */   MARKUP_TYPE_TEXT: () => (/* binding */ MARKUP_TYPE_TEXT)
/* harmony export */ });

// These are all the supported markup types.

const MARKUP_TYPE_ARROW = "arrow";
const MARKUP_TYPE_TEXT = "label";
const MARKUP_TYPE_RECTANGLE = "rectangle";
const MARKUP_TYPE_CIRCLE = "ellipse";
const MARKUP_TYPE_CLOUD = "cloud";
const MARKUP_TYPE_FREEHAND = "freehand";
const MARKUP_TYPE_HIGHLIGHT = "highlight";
const MARKUP_TYPE_POLYLINE = "polyline";
const MARKUP_TYPE_POLYCLOUD = "polycloud";
const MARKUP_TYPE_CALLOUT = "callout";
const MARKUP_TYPE_DIMENSION = "dimension";
const MARKUP_TYPE_STAMP = "stamp";

/***/ },

/***/ "./extensions/Markup/core/MarkupsCore.js"
/*!***********************************************!*\
  !*** ./extensions/Markup/core/MarkupsCore.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupsCore: () => (/* binding */ MarkupsCore)
/* harmony export */ });
/* harmony import */ var _edit_actions_EditActionManager_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./edit-actions/EditActionManager.js */ "./extensions/Markup/core/edit-actions/EditActionManager.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _edit_clipboard_Clipboard_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./edit-clipboard/Clipboard.js */ "./extensions/Markup/core/edit-clipboard/Clipboard.js");
/* harmony import */ var _edit_input_InputHandler_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./edit-input/InputHandler.js */ "./extensions/Markup/core/edit-input/InputHandler.js");
/* harmony import */ var _EditFrame_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./EditFrame.js */ "./extensions/Markup/core/EditFrame.js");
/* harmony import */ var _MarkupTool_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./MarkupTool.js */ "./extensions/Markup/core/MarkupTool.js");
/* harmony import */ var _edit_modes_EditModeArrow_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./edit-modes/EditModeArrow.js */ "./extensions/Markup/core/edit-modes/EditModeArrow.js");
/* harmony import */ var _edit_modes_BuiltinEditModes_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./edit-modes/BuiltinEditModes.js */ "./extensions/Markup/core/edit-modes/BuiltinEditModes.js");
/* harmony import */ var _Markups_css__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./Markups.css */ "./extensions/Markup/core/Markups.css");













 // IMPORTANT!! HAS SIDE EFFECTS
 // IMPORTANT!!


var MeasureCommon = Autodesk.Viewing.MeasureCommon;

var PERSPECTIVE_MODE_SCALE = 1000;


/**
 * Extension that allows end users to draw 2D markups on top of 2D and 3D models.
 *
 * @tutorial feature_markup
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance used to operate on.
 * @param {object} options - Same Dictionary object passed into {@link Autodesk.Viewing.Viewer3D|Viewer3D}'s constructor.
 * @param {boolean} [options.markupDisableHotkeys] - Disables hotkeys for copy, cut, paste, duplicate, undo, redo and deselect.
 * @param {Autodesk.Viewing.ToolInterface} [options.markupToolClass] - Class override for input handling.
 * Use it to override/extend default hotkeys and/or mouse/gesture input.
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.MarkupsCore
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
function MarkupsCore(viewer, options) {

  Autodesk.Viewing.Extension.call(this, viewer, options);

  this.options = this.options || {};
  this.markups = [];
  this.styles = {};

  this.activeLayer = '';
  this.duringViewMode = false;
  this.duringEditMode = false;

  this.svgLayersMap = {};

  // Add action manager.
  this.actionManager = new _edit_actions_EditActionManager_js__WEBPACK_IMPORTED_MODULE_0__.EditActionManager(50); // history of 50 actions.
  this.actionManager.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_HISTORY_CHANGED, this.onEditActionHistoryChanged.bind(this));

  this.nextId = 0; // Used to identify markups by id during an edit session.

  // Clipboard.
  this.clipboard = new _edit_clipboard_Clipboard_js__WEBPACK_IMPORTED_MODULE_5__.Clipboard(this);

  // Default Input handler.
  this.input = new _edit_input_InputHandler_js__WEBPACK_IMPORTED_MODULE_6__.InputHandler();
  this.input.setGlobalManager(this.globalManager);

  // Bind functions so they have access to globalManager
  this.createSvgElement = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.createSvgElement.bind(this);
  this.addSvgMetadata = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.addSvgMetadata.bind(this);
  this.checkPolygon = _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.checkPolygon.bind(this);

  // Extension will dispatch events.
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.addTraitEventDispatcher)(this);

  const initStrokeAndFontWidths = (model) => {
    // For 2d, set these widths once, and not recalculate again
    if (model.is2d()) {
      this.getStrokeWidth();
      this.getFontWidth();
    }
  };

  if (viewer.model) {
    initStrokeAndFontWidths(viewer.model);
  } else {
    // Camera is reset right after a model load
    // This is the right camera to use for widths initialization
    viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, ({ model }) => {
      viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => {
        initStrokeAndFontWidths(model);
      }, { once: true });
    }, { once: true });
  }

  // Handled events.
  this.onCameraChangeBinded = this.onCameraChange.bind(this);
  this.onViewerResizeBinded = function (event) {
    // This is ugly, but we need to do this twice
    var self = this;
    // First usage is to avoid a blinking scenario
    self.onViewerResize(event);
    requestAnimationFrame(function () {
      // Second one is to actually make it work on some resize scenarios.
      // Check the unlikely scenario that we are no longer in view mode.
      if (self.duringViewMode) {
        self.onViewerResize(event);
      }
    });
  }.bind(this);

  this.onMarkupSelectedBinded = this.onMarkupSelected.bind(this);
  this.onMarkupEnterEditionBinded = this.onMarkupEnterEdition.bind(this);
  this.onMarkupCancelEditionBinded = this.onMarkupCancelEdition.bind(this);
  this.onMarkupDeleteEditionBinded = this.onMarkupDeleteEdition.bind(this);
  this.onToolChangeBinded = this.onToolChange.bind(this);
  this.onUnitsCalibrationStartsBinded = this.onUnitsCalibrationStarts.bind(this);

  viewer.addEventListener(MeasureCommon.Events.UNITS_CALIBRATION_STARTS_EVENT, this.onUnitsCalibrationStartsBinded);
}

MarkupsCore.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
MarkupsCore.prototype.constructor = MarkupsCore;

var proto = MarkupsCore.prototype;

proto.load = async function () {

  // Add layer where annotations will actually live
  var svg = this.svg = this.createSvgElement('svg');
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.setSvgParentAttributes)(svg);

  // NOTE: Required since LMV renders Y coordinates upwards,
  // while browser's Y coordinates goes downwards.
  // SVG has 0 0 as default transform-origin: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/transform-origin
  const svgStyle = svg.style;
  svgStyle.position = 'absolute';
  svgStyle.left = '0';
  svgStyle.top = '0';
  svgStyle.transform = 'scale(1, -1)';
  svgStyle.transformOrigin = 'center center';

  this.bounds = { x: 0, y: 0, width: 0, height: 0 };

  this.input.attachTo(this);

  //Instantiate edit frame.
  this.editFrame = new _EditFrame_js__WEBPACK_IMPORTED_MODULE_7__.EditFrame(this.viewer.container, this);
  this.editFrame.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_START, function () {this.disableMarkupInteractions(true);}.bind(this));
  this.editFrame.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITFRAME_EDITION_END, function () {this.disableMarkupInteractions(false);}.bind(this));

  // Register tool
  var toolClass = this.options.markupToolClass || _MarkupTool_js__WEBPACK_IMPORTED_MODULE_8__.MarkupTool;
  this.changeMarkupTool(toolClass, !this.options.markupDisableHotkeys);

  await this.viewer.loadExtension('Autodesk.Snapping');

  this.snapper = new Autodesk.Viewing.Extensions.Snapping.Snapper(this.viewer, { markupMode: true });
  this.viewer.toolController.registerTool(this.snapper);

  return true;
};

/**
 * Change the markup tool's class in order to implement a different behaviour to the UI.
 *
 * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupTool} toolClass - Implementation or extension of MarkupTool's class.
 * @param {boolean} enableHotKeys - Whether to enable markup's hot-keys or not.
 */
proto.changeMarkupTool = function (toolClass, enableHotKeys) {
  if (this.markupTool) {
    this.viewer.toolController.deregisterTool(this.markupTool);
    this.markupTool = null;
  }

  this.markupTool = new toolClass();
  this.markupTool.setCoreExtension(this);
  this.markupTool.setHotkeysEnabled(enableHotKeys);
  this.viewer.toolController.registerTool(this.markupTool);
};

proto.unload = function () {

  this.hide();

  this.input.detachFrom(this);

  this.editFrame.unload();

  if (this.markupTool) {
    this.viewer.toolController.deregisterTool(this.markupTool);
    this.markupTool = null;
  }

  if (this.snapper) {
    this.viewer.toolController.deregisterTool(this.snapper);
    this.snapper = null;
  }

  var svg = this.svg;
  if (svg && this.onMouseDownBinded) {
    svg.removeEventListener("mousedown", this.onMouseDownBinded);
    this.onMouseDownBinded = null;
  }
  if (svg.parentNode) {
    svg.parentNode.removeChild(svg);
  }
  this.editModeSvgLayerNode = null;
  this.svg = null;

  return true;
};

MarkupsCore.prototype.getStrokeWidth = function () {

  if (!this.initialStrokeWidth || this.viewer.model && !this.viewer.model.is2d()) {
    this.initialStrokeWidth = this.sizeFromClientToMarkups(0, _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.MARKUP_DEFAULT_STROKE_WIDTH_IN_PIXELS).y;
  }

  return this.initialStrokeWidth;
};

MarkupsCore.prototype.getFontWidth = function () {

  if (!this.initialFontWidth || this.viewer.model && !this.viewer.model.is2d()) {
    this.initialFontWidth = this.sizeFromClientToMarkups(0, _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.MARKUP_DEFAULT_FONT_WIDTH_IN_PIXELS).y;
  }

  return this.initialFontWidth;
};

/**
 * Toggle in and out of Edit mode. In Edit mode the user is able to draw markups on the canvas.
 *
 * See also
 * {@link Autodesk.Viewing.Extensions.MarkupsCore/#enterEditMode|enterEditMode()} and
 * {@link Autodesk.Viewing.Extensions.MarkupsCore/#leaveEditMode|leaveEditMode()}
 */
MarkupsCore.prototype.toggleEditMode = function () {

  if (this.duringEditMode) {
    this.leaveEditMode();
  } else {
    this.enterEditMode();
  }
};

/**
 * Enables mouse interactions and mobile device gestures over the Viewer canvas to create or draw markups.
 *
 * Exit Edit mode by calling {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#leaveeditmode-1|leaveEditMode()}.
 *
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#show|show()}
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#enterEditMode
 * @param {string} layerId - [optional] Identifier for the layer of markups to be edited. Example "Layer1".
 * @returns {boolean} Returns true if editMode is active
 * @public
 */
MarkupsCore.prototype.enterEditMode = function (layerId) {

  /**
   * @param layer
   * @param disable
   * @private
   */
  function disableLayerMarkups(layer, disable) {
    if (layer) {
      var layerMarkups = layer.markups;
      for (var k = 0; k < layerMarkups.length; k++) {
        var m = layerMarkups[k];
        m.disableInteractions(disable);
      }
    }
  }
  if (layerId) {
    if (!this.svgLayersMap[layerId]) {
      // if layerId is supplied but it does not exist in the svgLayerMap then create the new layer
      console.warn("No such layer exists.");
      return false;
    }
  }

  // If not currently shown, then show
  if (!this.duringViewMode) {
    if (!this.show()) {
      return false; // Failed to enter view mode.
    }
  }

  // Initialize the edit mode layer if it does not exist
  if (!this.editModeSvgLayerNode) {
    var parSvg = this.createSvgElement('g');
    this.editModeSvgLayerNode = {
      markups: [],
      svg: parSvg
    };
    this.editModeSvgLayerNode.svg.setAttribute('cursor', 'default');
  }


  if (this.editModeSvgLayerNode.svg.parentNode != this.svg || !layerId) {
    this.svg.appendChild(this.editModeSvgLayerNode.svg);
  }
  this.svg.setAttribute('cursor', 'crosshair');


  if (layerId) {
    var layer = this.svgLayersMap[layerId];
    // If the layer exists in the layer map, use the information stored for that specific layer.
    if (layer) {
      // Remove the edit layer when entering edit mode of a specific edit mode.
      var editModeLayerParentNode = this.editModeSvgLayerNode.svg.parentNode;
      editModeLayerParentNode && editModeLayerParentNode.removeChild(this.editModeSvgLayerNode.svg);

      // disable the markups in the editModeLayer
      disableLayerMarkups(this.editModeSvgLayerNode, true);

      // Enable interactions for markups in the current edit layer and disable interactions for markups in
      // the other layers.
      for (var key in this.svgLayersMap) {
        var markups = this.svgLayersMap[key].markups;
        for (var i = 0; i < markups.length; i++) {
          var markup = markups[i];
          if (key !== layerId.toString()) {
            // disable all not in the current layer.
            markup.disableInteractions(true);
          } else {
            // enable all markups in current layer.
            markup.disableInteractions(false);
          }
        }
      }

      // assign the current layer to the global active layer
      this.activeLayer = layerId;
      this.editingLayer = layerId;
      var svgParent = layer.svg;

      // remove previous svg layer child from svg
      svgParent.parentNode && this.svg.removeChild(svgParent);

      // reassign the markups in that layer to the global markups list
      this.markups = layer.markups.slice();

      // re-append svg layer child to svg to make it the top most layer
      this.svg.appendChild(svgParent);
    }
  } else {
    // disable interactions for the previous markups
    // Example: enterEditMode(layer) -> enterEditMode()
    if (this.editingLayer) {
      for (var k = 0; k < this.markups.length; k++) {
        var m = this.markups[k];
        m.disableInteractions(true);
      }
      disableLayerMarkups(this.editModeSvgLayerNode, false);
    }
    this.editingLayer = '';
    if (!this.editModeSvgLayerNode) {
      this.markups = [];
    } else {
      this.markups = this.editModeSvgLayerNode.markups.slice();
    }
    this.activeLayer = '';
  }

  this.input.enterEditMode();
  this.activateTool(true);
  this.styles = {}; // Clear EditMode styles.
  this.defaultStyle = null;
  this.duringEditMode = true;
  this.changeEditMode(new _edit_modes_EditModeArrow_js__WEBPACK_IMPORTED_MODULE_9__.EditModeArrow(this));
  this.actionManager.clear();
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_ENTER });
  this.allowNavigation(false);
  return true;
};

/**
 * Exits Edit mode.
 *
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|enterEditMode()}.
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#leaveEditMode
 *
 * @returns {boolean} Returns true if Edit mode has been deactivated
 * @public
 */
MarkupsCore.prototype.leaveEditMode = function () {

  var NOT_IN_EDIT_MODE = true;
  var WE_ARE_STILL_IN_EDIT_MODE = false;

  if (!this.duringEditMode || !this.duringViewMode) {
    return NOT_IN_EDIT_MODE;
  }

  var viewer = this.viewer;
  if (!viewer) {
    return WE_ARE_STILL_IN_EDIT_MODE; // something is very wrong...
  }

  this.editMode.destroy();
  this.editMode = null;
  this.duringEditMode = false;

  if (this.snapper) {
    this.snapper.indicator.clearOverlays();
    this.snapper.clearSnapped();
  }

  // Remove the edit layer
  if (this.editModeSvgLayerNode && this.editModeSvgLayerNode.svg.parentNode) {
    this.svg.removeChild(this.editModeSvgLayerNode.svg);
  }
  this.svg.setAttribute('cursor', 'default');

  this.input.leaveEditMode();
  this.editFrame.setMarkup(null);
  this.activateTool(true);

  this.allowNavigation(true);
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_LEAVE });
  return NOT_IN_EDIT_MODE;
};

/**
 * Toggle between visible markups, i.e., show() and hidden markups, i.e., hide().
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.toggle
 * @method toggle
 * @public
 */
MarkupsCore.prototype.toggle = function () {

  if (this.duringViewMode) {
    this.hide();
  } else {
    this.show();
  }
};

/**
 * Enables loading of previously saved markups.
 * Exit Edit mode by calling {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hide|hide()}.
 *
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|enterEditMode()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#show
 * @method show
 *
 * @returns {boolean} Whether it successfully entered view mode or not.
 * @public
 */
MarkupsCore.prototype.show = function () {

  var viewer = this.viewer;
  if (!viewer || !viewer.model || !this.svg) {
    return false;
  }

  // Return if already showing or in edit-mode.
  // Notice that edit mode requires that we are currently show()-ing.
  if (this.duringViewMode || this.duringEditMode) {
    return true;
  }

  viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
  viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onViewerResizeBinded);

  // Add parent svg of all markups.
  viewer.container.appendChild(this.svg);
  viewer.reorderElements(this.svg);

  this.input.enterViewMode();
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.hideLmvUi)(viewer);

  // TODO: Nasty hack, currently there is no API to disable mouse highlighting in 3d models.
  // TODO: We nuke rollover function in viewer, for now, public api will be added soon.
  this.onViewerRolloverObject = viewer.impl.rolloverObject;
  viewer.impl.rolloverObject = function () {};

  this.activateTool(true);
  var camera = viewer.impl.camera;
  this.onViewerResize({ width: camera.clientWidth, height: camera.clientHeight });

  // See function loadMarkups() for when the actual SVG gets added onstage //
  this.svgLayersMap = {};
  this.duringViewMode = true;
  this.allowNavigation(true);
  return true;
};

/**
 * Removes any markup currently overlaid on the viewer. It exits Edit mode if it is active.
 *
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#show|show()}
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#hide
 * @method hide
 *
 * @returns {boolean} Whether it successfully left view mode or not.
 * @public
 */
MarkupsCore.prototype.hide = function () {

  var RESULT_HIDE_OK = true;
  var RESULT_HIDE_FAIL = false;

  var viewer = this.viewer;
  if (!viewer || !this.duringViewMode) {
    return RESULT_HIDE_OK;
  }

  if (this.duringEditMode) {
    if (!this.leaveEditMode()) {
      return RESULT_HIDE_FAIL;
    }
  }

  viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
  viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onViewerResizeBinded);

  var svg = this.svg;
  svg.parentNode && svg.parentNode.removeChild(svg);

  // Remove all Markups and metadata (if any)
  this.unloadMarkupsAllLayers();
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.removeAllMetadata)(svg);

  this.input.leaveViewMode();
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.restoreLmvUi)(viewer);
  this.viewer.impl.rolloverObject = this.onViewerRolloverObject;

  this.activateTool(false);
  this.duringViewMode = false;
  return RESULT_HIDE_OK;
};

/**
 * Removes newly created markups in the current editing layer.
 * Markups that were created in a specific layer will not be removed.
 *
 * Markups should have been added while in
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|enterEditMode()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.clear
 * @method clear
 * @public
 */
MarkupsCore.prototype.clear = function () {
  // Can only clear specific layers when in the edit mode of that layer.
  if (!this.duringEditMode) {
    console.warn("Clear only removes markups when in Edit Mode.");
    return;
  }
  var editModeLayer = this.editingLayer ? this.svgLayersMap[this.editingLayer] : this.editModeSvgLayerNode;
  if (editModeLayer) {
    var markups = editModeLayer.markups;
    var svg = editModeLayer.svg;
    if (svg && svg.childNodes.length > 0) {
      while (svg.childNodes.length) {
        svg.removeChild(svg.childNodes[0]);
      }
    }
    while (markups.length > 0) {
      var markup = markups[0];
      this.removeMarkup(markup);
      markup.destroy();
    }
  }
};

/**
 * Returns an SVG string with the markups created so far.
 * The SVG string can be reloaded using {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#loadmarkups-markupstring-layerid|loadMarkups()}.
 *
 * Markups should have been added while in {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|enterEditMode()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.generateData
 * @method generateData
 *
 * @returns {string} Returns an SVG element with all of the created markups in a string format.
 * @public
 */
MarkupsCore.prototype.generateData = function () {

  var defaultLayer = this.editModeSvgLayerNode.svg;

  if (this.editMode) {
    this.editMode.onSave();
  }

  // Sanity check, remove any lingering metadata nodes
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.removeAllMetadata)(this.svg);

  if (this.activeLayer) {
    defaultLayer = this.svgLayersMap[this.activeLayer].svg;
  }

  var tmpNode = this.createSvgElement("svg");
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.transferChildNodes)(this.svg, tmpNode); // Transfer includes this.editModeSvgLayerNode
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.transferChildNodes)(defaultLayer, this.svg);

  // version 1: first implementation.
  // version 2: added global offset to markup positions.
  // version 3: change node structure to include hitareas, hit areas are not exported.
  // version 4: scale perspective markups space by PERSPECTIVE_MODE_SCALE because bug in firefox. LMV-1150
  var metadataObject = {
    "data-model-version": "4"
  };
  var metadataNode = this.addSvgMetadata(this.svg, metadataObject);
  var metadataNodes = [metadataNode];

  // Notify each markup to inject metadata
  this.markups.forEach(function (markup) {
    var addedNode = markup.setMetadata();
    if (addedNode) {
      metadataNodes.push(addedNode);
    }
  });

  // Generate the data!
  var data = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.svgNodeToString)(this.svg);

  // Remove metadataObject before returning
  metadataNodes.forEach(function (metadataNode) {
    metadataNode.parentNode.removeChild(metadataNode);
  });

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.transferChildNodes)(this.svg, defaultLayer);
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.transferChildNodes)(tmpNode, this.svg);
  tmpNode = null; // get rid of it.

  return data;
};

/**
 * @private
 */
MarkupsCore.prototype.generatePoints3d = function () {

  var result = { markups: [], main: null };
  var markups = this.markups;
  var markupsCount = markups.length;

  if (markupsCount === 0) {
    return result;
  }

  // Gather a 3d point for markup.
  var idTarget = this.viewer.impl.renderer().readbackTargetId();
  for (let i = 0; i < markupsCount; ++i) {

    var markup = markups[i];
    var point = markup.generatePoint3d(idTarget) || null;
    result.markups.push(
      {
        id: markup.id,
        type: markup.type,
        point: point || null
      });
  }


  // If there is 3d point associated with an arrow, we use that as main point.
  if (markupsCount === 1) {

    var main = result.markups[0].point;
    result.main = main && main.clone();
    return result;
  }

  for (let i = 0; i < markupsCount; ++i) {

    var collision = result.markups[i];
    if (collision.type === _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_ARROW && collision.point !== null) {

      result.main = collision.point.clone();
      return result;
    }
  }

  // If there is no arrows, we average bounding boxes and get a 3d point inside it.
  var bbX0 = Number.POSITIVE_INFINITY;
  var bbY0 = Number.POSITIVE_INFINITY;
  var bbX1 = Number.NEGATIVE_INFINITY;
  var bbY1 = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < markupsCount; ++i) {

    var boundingBox = markups[i].generateBoundingBox();

    bbX0 = Math.min(bbX0, boundingBox.min.x);
    bbY0 = Math.min(bbY0, boundingBox.min.y);
    bbX1 = Math.max(bbX1, boundingBox.max.x);
    bbY1 = Math.max(bbY1, boundingBox.max.y);
  }

  var polygon = {};

  polygon.vertexCount = 4;
  polygon.xVertices = new Float32Array([bbX0, bbX1, bbX1, bbX0]);
  polygon.yVertices = new Float32Array([bbY0, bbY0, bbY1, bbY1]);

  var point2d = this.checkPolygon(polygon, idTarget);
  var point3d = point2d && this.viewer.clientToWorld(point2d.x, point2d.y);
  result.main = point3d && point3d.point;

  return result;
};

/**
 * Renders the markups onto a 2D canvas context to generate an image.
 *
 * @param {CanvasRenderingContext2D} context - Markups are drawn using the context provided
 * @param callback
 * @param renderAllMarkups
 * @private
 */
MarkupsCore.prototype.renderToCanvas = function (context, callback, renderAllMarkups) {

  var width = this.bounds.width;
  var height = this.bounds.height;
  var viewBox = this.getSvgViewBox(width, height);
  var numberOfScreenshotsTaken = 0;
  var markups = [];
  var layer;

  var onMarkupScreenshotTaken = function () {
    if (callback && ++numberOfScreenshotsTaken === markups.length) {
      callback();
    }
  }.bind(this);

  if (renderAllMarkups) {
    var svgKeys = Object.keys(this.svg.childNodes);
    var layersKeys = Object.keys(this.svgLayersMap);

    // Append only markups that their parent layer is contained inside the svg main container.
    for (var i = 0; i < svgKeys.length; i++) {
      for (var j = 0; j < layersKeys.length; j++) {
        layer = this.svgLayersMap[layersKeys[j]];
        if (this.svg.childNodes[svgKeys[i]] === layer.svg) {
          markups = markups.concat(layer.markups);
        }
      }
    }
  } else {
    layer = this.svgLayersMap[this.activeLayer] || this.editModeSvgLayerNode;
    markups = layer.markups;
  }

  if (markups.length === 0) {
    callback();
  } else {
    markups.forEach(function (markup) {
      markup.renderToCanvas(context, viewBox, width, height, onMarkupScreenshotTaken);
    });
  }
};

/**
 * Changes the active drawing tool. For example, from the Arrow drawing tool to the Rectangle drawing tool.
 * Only applicable while in {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|Edit Mode}.
 *
 * Supported values are:
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModeArrow(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModeRectangle(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModeCircle(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModeCloud(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModeText(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModeFreehand(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModePolyline(MarkupsCoreInstance)`
 * - `new Autodesk.Viewing.Extensions.Markups.Core.EditModePolycloud(MarkupsCoreInstance)`
 *
 * This function fires event `Autodesk.Viewing.Extensions.MarkupsCore.EVENT_EDITMODE_CHANGED`.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#changeEditMode
 * @method changeEditMode
 *
 * @param {object} editMode - Object instance for the drawing tool
 * @fires Autodesk.Viewing.Extensions.MarkupsCore.EVENT_EDITMODE_CHANGED
 * @public
 */
MarkupsCore.prototype.changeEditMode = function (editMode) {

  var oldEditMode = this.editMode;
  oldEditMode && oldEditMode.destroy();

  editMode.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_CREATION_BEGIN, function () {this.disableMarkupInteractions(true);}.bind(this));
  editMode.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_CREATION_END, function () {this.disableMarkupInteractions(false);}.bind(this));
  editMode.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_DESELECT, function (event) {this.dispatchEvent(event);}.bind(this));

  this.editMode = editMode;
  this.styles[editMode.type] = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_4__.cloneStyle)(editMode.getStyle());

  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_CHANGED, target: editMode });
};

/**
 * Check whether a user can perform camera navigation operations on the current loaded model.
 * While the extension is active, the user can still draw markups.
 * Panning and zooming are only supported for orthographic cameras.
 *
 * @returns {boolean} Whether {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#allownavigation-allow|allowNavigation()} can succeed.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.isNavigationAllowed
 * @method isNavigationAllowed
 * @public
 */
MarkupsCore.prototype.isNavigationAllowed = function () {

  return !this.viewer.impl.camera.isPerspective;
};

/**
 * Enables click, tap, and swipe behavior to allow camera zoom and panning operations. It is only available in
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|Edit mode}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.allowNavigation
 * @method allowNavigation
 *
 * @param {boolean} allow - Whether camera navigation interactions are active or not.
 * @public
 */
MarkupsCore.prototype.allowNavigation = function (allow) {

  //we will still need to update the markup styles even if in perspective mode
  var editMode = this.editMode;
  this.navigating = allow;

  if (allow) {
    this.svg.setAttribute("pointer-events", "none");
    editMode && this.selectMarkup(null);
  } else {
    this.svg.setAttribute("pointer-events", "painted");
  }

  // Update pointer events for all markups.
  var markups = this.markups;
  var markupsCount = markups.length;

  for (var i = 0; i < markupsCount; ++i) {
    markups[i].updateStyle();
  }
  editMode && editMode.notifyAllowNavigation(allow);

  // Navigation is not allowed while in perspective mode.
  if (allow && (this.duringEditMode || this.duringViewMode) && !this.isNavigationAllowed()) {
    return false;
  }

  // Clear snapper.
  if (allow && this.snapper) {
    this.snapper.indicator.clearOverlays();
    this.snapper.clearSnapped();
  }

  this.markupTool.allowNavigation(allow);

};

/**
 * Sets mouse interactions and mobile device gestures with markups. Only applicable in
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|Edit mode}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.disableMarkupInteractions
 * @method disableMarkupInteractions
 *
 * @param {boolean} disable - true to disable interactions with markups; false to enable interactions with markups; default false.
 * @public
 */
MarkupsCore.prototype.disableMarkupInteractions = function (disable) {

  if (this.editModeSvgLayerNode) {
    this.editModeSvgLayerNode.svg.setAttribute('cursor', disable ? 'inherit' : 'default');
  }
  this.markups.forEach(function (markup) {markup.disableInteractions(disable);});
};

/**
 *
 * @param isActive
 * @private
 */
MarkupsCore.prototype.activateTool = function (isActive) {
  if (isActive) {
    if (!this.cachedNavigationTool) {
      this.cachedNavigationTool = this.viewer.getActiveNavigationTool();
      this.viewer.addEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this.onToolChangeBinded);
    }
    this.viewer.setActiveNavigationTool(this.markupTool.getName());
  } else {

    if (this.cachedNavigationTool) {
      this.viewer.setActiveNavigationTool(this.cachedNavigationTool);
      this.cachedNavigationTool = null;
    } else {
      var defaultToolName = this.viewer.getDefaultNavigationToolName();
      this.viewer.setActiveNavigationTool(defaultToolName);
    }

    this.viewer.removeEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this.onToolChangeBinded);
  }
};

/**
 *
 * @param event
 * @private
 */
MarkupsCore.prototype.onToolChange = function (event) {

  if (event.toolName !== this.markupTool.getName())
  return;

  if (event.active) {
    var navAllowed = this.isNavigationAllowed();
    this.viewer.setNavigationLockSettings({
      pan: navAllowed,
      zoom: navAllowed,
      orbit: false,
      roll: false,
      fov: false,
      walk: false,
      gotoview: false
    });
  }
  this.viewer.setNavigationLock(event.active);
};

MarkupsCore.prototype.onUnitsCalibrationStarts = function () {
  if (this.duringEditMode) {
    this.hide();
  }
};

//// Input /////////////////////////////////////////////////////////////////////////////////////////////////////////

proto.changeInputHandler = function (inputHandler) {

  this.input.detachFrom(this);
  inputHandler.attachTo(this);
  this.input = inputHandler;

  if (this.duringEditMode) {
    inputHandler.enterEditMode();
  }

  if (this.duringViewMode) {
    inputHandler.enterViewMode();
  }
};

//// Copy and Paste System /////////////////////////////////////////////////////////////////////////////////////////

/**
 * Standard copy operation. Applies to any selected markup.<br>
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#cut-1|cut()} and
 *{@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#paste-2|paste()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#copy
 * @method copy
 * @public
 */
MarkupsCore.prototype.copy = function () {

  this.clipboard.copy();
};

/**
 * Standard cut operation. Applies to any selected markup, which gets removed from the screen at call time.<br>
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#copy|copy()} and
 *{@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#paste-2|paste()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#cut
 * @method cut
 * @public
 */
MarkupsCore.prototype.cut = function () {

  this.clipboard.cut();
};

/**
 * Standard paste operation. This function will paste any previously copied or cut markup.
 * Can be called repeatedly after a single copy or cut operation.<br>
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#copy|copy()} and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#cut-1|cut()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#paste
 * @method paste
 * @public
 */
MarkupsCore.prototype.paste = function () {

  this.clipboard.paste();
};

//// Undo and Redo System //////////////////////////////////////////////////////////////////////////////////////////
/**
 * Will undo the previous operation.<br>
 * The Undo/Redo stacks will track any change done to the existing markups.<br>
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#redo-1|redo()} and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#isUndoStackEmpty|isUndoStackEmpty()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#undo
 * @method undo
 * @public
 */
MarkupsCore.prototype.undo = function () {

  this.actionManager.undo();
};

/**
 * Will redo any previously undo operation.<br>
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#undo|undo()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#isRedoStackEmpty|isRedoStackEmpty()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#redo
 * @method redo
 * @public
 */
MarkupsCore.prototype.redo = function () {

  this.actionManager.redo();
};

/**
 * Returns true when {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#undo|undo()} produces no changes.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#isUndoStackEmpty
 * @method isUndoStackEmpty
 *
 * @returns {boolean} true if there are no changes to undo; false if there are changes to undo.
 * @public
 */
MarkupsCore.prototype.isUndoStackEmpty = function () {

  return this.actionManager.isUndoStackEmpty();
};

/**
 * Returns true when {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#redo-1|redo()} produces no changes.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#isRedoStackEmpty
 * @method isRedoStackEmpty
 *
 * @returns {boolean} true if there are no changes to redo; false if there are changes to redo.
 * @public
 */
MarkupsCore.prototype.isRedoStackEmpty = function () {

  return this.actionManager.isRedoStackEmpty();
};

proto.beginActionGroup = function () {

  this.actionManager.beginActionGroup();
};

proto.closeActionGroup = function () {

  this.actionManager.closeActionGroup();
};

proto.cancelActionGroup = function () {

  this.actionManager.cancelActionGroup();
};

/**
 * Helper function for generating unique markup ids.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#getId
 * @method getId
 *
 * @returns {number}
 * @public
 */
proto.getId = function () {

  return ++this.nextId;
};

/**
 * @param event
 * @private
 */
proto.onEditActionHistoryChanged = function (event) {

  var data = event.data;
  if (data.action !== 'undo' && data.targetId !== -1) {

    // Markup can be null when deleting, that's ok, we unselect in that case.
    let markup = this.getMarkup(data.targetId);
    this.selectMarkup(markup);
  }
  if (data.action === 'undo' && !this.isUndoStackEmpty()) {

    let markup = this.getMarkup(this.actionManager.getLastElementInUndoStack().getTargetId());
    this.selectMarkup(markup);
  }

  this.dispatchEvent(event);
};

/**
 * Returns a markup with the specified ID. Returns null when not found.
 * The ID can be retrieved from the return value of getSelection(). <br>
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#getselection-1|getSelection()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#getMarkup
 * @method getMarkup
 *
 * @param {string} id Markup identifier.
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.Markup} Returns markup object.
 * @public
 */
MarkupsCore.prototype.getMarkup = function (id) {

  var markups = this.markups;
  var markupsCount = markups.length;

  for (var i = 0; i < markupsCount; ++i) {
    if (markups[i].id == id) {
      return markups[i];
    }
  }

  return null;
};


/**
 * Selects or deselects a markup. A selected markup gets an overlayed UI that allows you to perform transformations
 * such as resizing, rotations, and translations. To deselect a markup, send a null value. <br>
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#getmarkup-id|getMarkup()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#selectMarkup
 * @method selectMarkup
 *
 * @param {Autodesk.Viewing.Extensions.Markups.Core.Markup|null} markup The markup instance to select. Set the value to null to deselect a markup.
 * @public
 */
MarkupsCore.prototype.selectMarkup = function (markup) {

  if (markup) {

    if (this.editMode.type === markup.type) {
      this.editMode.setSelection(markup);
    } else {

      var editMode = markup.getEditMode();
      editMode.setSelection(null);

      this.changeEditMode(editMode);
      this.setStyle(markup.getStyle());
      this.editMode.setSelection(markup);
    }
  } else {
    // fix for text markup in view mode
    if (this.editMode) {
      this.editMode.setSelection(null);
    }
  }
};

/**
 * Returns the currently selected markup. A selected markup has a custom UI overlayed that allows you to perform
 * resizing, rotations and translations.<br>
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#selectmarkup-markup|selectMarkup()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#getSelection
 * @method getSelection
 *
 * @returns {Autodesk.Viewing.Extensions.Markups.Core.Markup|null} Returns selected markup object; null if no markup is selected.
 * @public
 */
MarkupsCore.prototype.getSelection = function () {

  return this.editMode.getSelection();
};

/**
 * Deletes a markup from the canvas. Only applies while in
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|Edit mode}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore#deleteMarkup
 * @method deleteMarkup
 *
 * @param {Autodesk.Viewing.Extensions.Markups.Core.Markup} markup - Markup object.
 * @param {boolean} [dontAddToHistory] Whether delete action can be {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#undo|undone}.
 * @public
 */
MarkupsCore.prototype.deleteMarkup = function (markup, dontAddToHistory) {

  if (!this.editMode || this.editMode && this.editMode.selectedMarkup.id !== markup.id) {
    this.editMode = markup.getEditMode();
  }
  this.editMode.deleteMarkup(markup, dontAddToHistory);
};

proto.addMarkup = function (markup) {

  var markups;
  var layer = this.activeLayer;
  var layerObject = this.svgLayersMap[layer] || '';

  if (layerObject) {
    var svgParent = layerObject.svg;
    // append markup svg to layer svg
    markup.setParent(svgParent);
    // Add markup to layer markups if it does not exist
    layerObject.markups.push(markup);
    markups = layerObject.markups.slice();
  } else {
    // if layer is undefined create a edit mode svg layer
    markup.setParent(this.editModeSvgLayerNode.svg);
    this.editModeSvgLayerNode.markups.push(markup);
    markups = this.editModeSvgLayerNode.markups.slice();
  }

  markup.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_SELECTED, this.onMarkupSelectedBinded);
  markup.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_ENTER_EDITION, this.onMarkupEnterEditionBinded);
  markup.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_CANCEL_EDITION, this.onMarkupCancelEditionBinded);
  markup.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_DELETE_EDITION, this.onMarkupDeleteEditionBinded);
  // Only set the global markups array when in edit mode
  if (this.duringEditMode) {
    this.markups = markups;
  }
};

/**
 *
 * @param markup
 * @private
 */
proto.removeMarkup = function (markup) {

  if (!markup) {
    return false;
  }
  var self = this;

  /**
   * Get the layer markups in which the markup exists.
   * This function will remove the markup if it exists in the corresponding layer markups array.
   *
   * @param markup
   * @returns {number} returns -1 if the markup does not exist in a layer markups array
   */
  function removeMarkupIfExists(markup) {
    var markupIndex;
    var layerMarkups = -1;
    // check if the markup exists in the edit layer
    if (self.editModeSvgLayerNode) {
      var editLayerMarkups = self.editModeSvgLayerNode.markups;
      markupIndex = editLayerMarkups.indexOf(markup);
      if (markupIndex !== -1) {
        // remove the markup from the corresponding markup array
        editLayerMarkups.splice(markupIndex, 1);
        layerMarkups = editLayerMarkups.slice();
        // update the global markups array if the markup is in the active layer
        if (self.activeLayer === '') {
          self.markups = layerMarkups;
        }
        return layerMarkups;
      }
    }
    // check if the markup exists in a layer
    if (self.svgLayersMap) {
      for (var layer in self.svgLayersMap) {
        var markups = self.svgLayersMap[layer].markups;
        markupIndex = markups.indexOf(markup);
        if (markupIndex !== -1) {
          // remove the markup from the corresponding markup array
          markups.splice(markupIndex, 1);
          layerMarkups = markups.slice();
          // update the global markups array if the markup is in the active layer
          if (self.activeLayer === layer) {
            self.markups = layerMarkups;
          }
          return layerMarkups;
        }
      }
    }
    return layerMarkups;
  }

  var layerMarkups = removeMarkupIfExists(markup);
  if (layerMarkups === -1)
  return false;

  markup.setParent(null);

  markup.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_SELECTED, this.onMarkupSelectedBinded);
  markup.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_ENTER_EDITION, this.onMarkupEnterEditionBinded);
  markup.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_CANCEL_EDITION, this.onMarkupCancelEditionBinded);
  markup.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_DELETE_EDITION, this.onMarkupDeleteEditionBinded);

  var editMode = this.editMode;
  if (editMode) {
    var selectedMarkup = editMode.getSelection();
    if (selectedMarkup === markup) {
      this.selectMarkup(null);
    }
  }
};

//// Markups style /////////////////////////////////////////////////////////////////////////////////////////////////

MarkupsCore.prototype.setStyle = function (style) {

  var styles = this.styles;
  var editMode = this.editMode;

  (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_4__.copyStyle)(style, styles[editMode.type]);
  // copyStyle(styles[editMode.type], style);
  editMode.setStyle(styles[editMode.type]);
};

MarkupsCore.prototype.getStyle = function () {

  return (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_4__.cloneStyle)(this.styles[this.editMode.type]);
};

MarkupsCore.prototype.getDefaultStyle = function () {

  var defaultStyleAttributes = [
  'stroke-width',
  'font-size',
  'font-family',
  'font-style',
  'font-weight',
  'stroke-color',
  'stroke-opacity',
  'fill-color',
  'text-data',
  'fill-opacity'];
  this.defaultStyle = this.defaultStyle || (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_4__.createStyle)(defaultStyleAttributes, this);

  return this.defaultStyle;
};

//// Markups depth order ///////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 * @param markup
 * @private
 */
proto.bringToFront = function (markup) {

  this.sendMarkupTo(markup, this.markups.length - 1);
};

/**
 *
 * @param markup
 * @private
 */
proto.sendToBack = function (markup) {

  this.sendMarkupTo(markup, 0);
};

/**
 *
 * @param markup
 * @private
 */
proto.bringForward = function (markup) {

  var markupIndex = this.markups.indexOf(markup);
  this.sendMarkupTo(markup, markupIndex + 1);
};

/**
 *
 * @param markup
 * @private
 */
proto.bringBackward = function (markup) {

  var markupIndex = this.markups.indexOf(markup);
  this.sendMarkupTo(markup, markupIndex - 1);
};

/**
 *
 * @param markup
 * @param index
 * @private
 */
proto.sendMarkupTo = function (markup, index) {

  var markups = this.markups;
  var markupIndex = markups.indexOf(markup);

  if (markupIndex === -1 || index < 0 || index >= markups.length) {
    return;
  }

  markups.splice(markupIndex, 1);
  index = markupIndex > index ? index - 1 : index;
  markups.splice(index, 0, markup);

  // TODO: Add markup in right position not always at the end.
  markup.setParent(null);
  if (this.activeLayer) {
    var parent = this.svgLayersMap[this.activeLayer].svg;
    markup.setParent(parent);
  } else {
    markup.setParent(this.editModeSvgLayerNode.svg);
  }
};


/**
 * Loads data (SVG string) for all markups in a specified layer (layerId) to the Viewer's canvas.<br>
 *
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#unloadmarkups-layerid|unloadMarkups()}, and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hidemarkups-layerid|hideMarkups()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.loadMarkups
 * @method loadMarkups
 *
 * @param {string} markupString - SVG string with markups. See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#generatedata|generateData()}.
 * @param {string} layerId - Identifier for the layer where the markup should be loaded to. Example "Layer1".
 * @returns {boolean} Whether the markup string was able to be loaded successfully
 * @public
 */
MarkupsCore.prototype.loadMarkups = function (markupString, layerId) {

  if (this.duringEditMode) {
    console.warn("Markups will not be loaded during the edit mode");
    return false;
  }

  if (!this.duringViewMode) {
    return false;
  }

  if (!layerId) {
    console.warn("loadMarkups failed; missing 2nd argument 'layerId'");
    return false;
  }

  // Can it be parsed into SVG?
  var parent = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.stringToSvgNode)(markupString);
  if (!parent) {
    return false;
  }

  // If the supplied layerId exists in the svg layers map and there are children in the svg then return false.
  if (layerId in this.svgLayersMap && this.svg.childNodes.length > 0) {
    console.warn("This layer is already loaded, will not load again.");
    return false;
  }
  this.activeLayer = layerId;
  var svgLayerNode = this.svgLayersMap[layerId];

  // if the layer exists, delete it
  if (svgLayerNode)
  delete this.svgLayersMap[layerId];

  // create an empty parent svg layer node for layerId
  // Child markups will get added to th parent svg layer node in the addMarkup function
  var newSvg = this.createLayerNode();

  svgLayerNode = {
    markups: [],
    svgString: markupString,
    svg: newSvg
  };
  this.svgLayersMap[layerId] = svgLayerNode;

  var children = parent.childNodes;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var markup = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.createMarkupFromSVG)(child, this);
    // Disable markups if already in edit mode and the active layer is different
    if (markup && this.duringEditMode && this.editingLayer !== this.activeLayer) {
      markup.disableInteractions(true);
    }

    if (!markup && child.localName !== "metadata") {
      // Append child removes it from parent and copies it over to the new svg layer node,
      // so we need to reduce index by 1 to continue proper iteration
      svgLayerNode.svg.appendChild(child);
      i--;
      if (typeof child.setAttribute === 'function') {
        child.setAttribute("pointer-events", "none");
      }
    }
  }

  var svgParentNode = this.svgLayersMap[this.activeLayer].svg;

  this.svg.appendChild(svgParentNode);
  // If already in an edit mode layer then reassign active layer to edit layer
  if (this.duringEditMode && this.editingLayer !== this.activeLayer) {
    this.activeLayer = this.editingLayer;
    if (this.editingLayer)
    this.markups = this.svgLayersMap[this.activeLayer].markups.slice();
  }
  return true;
};

/**
 * TODO: Probably this function needs to be moved to MarkupCoreUtils.js
 * Creates a new layer node
 * */

proto.createLayerNode = function () {

  var newSvgLayerNode = this.createSvgElement('g');
  newSvgLayerNode.setAttribute('cursor', 'default');
  return newSvgLayerNode;
};

/**
 * Revert any changes made to the specific layer.
 *
 * See also {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#loadmarkups-markupstring-layerid|loadMarkups()} and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#entereditmode-layerid|enterEditMode()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.revertLayer
 * @method revertLayer
 *
 * @param {string} layerId - ID of the layer to revert any changes that were made to it.
 * @returns {boolean} true if the layer was unloaded, false if the layer was not unloaded.
 * @public
 */
MarkupsCore.prototype.revertLayer = function (layerId) {
  if (!layerId) {
    console.warn("revertLayer failed because no layerId was supplied.");
    return false;
  }
  var svgLayerNode = this.svgLayersMap[layerId];
  if (!svgLayerNode) {
    console.warn("The supplied layer does not exist.");
    return false;
  }
  var inEditMode = this.duringEditMode;
  // Leave editMode to revert a layer
  if (inEditMode)
  this.leaveEditMode();

  // keep track of previous global markups.
  var currentMarkups = this.markups.slice();
  // Set the global markups to the markups in the current layer. These ones get removed in the unloadMarkups
  this.markups = svgLayerNode.markups;
  var layerSvg = svgLayerNode.svgString;
  this.unloadMarkups(layerId);
  this.loadMarkups(layerSvg, layerId);
  // Assign markups
  if (this.editingLayer) {
    if (this.editingLayer !== layerId) {
      this.markups = currentMarkups;
      var layerObject = this.svgLayersMap[this.editingLayer];
      if (layerObject) {
        layerObject.markups = currentMarkups;
      }
    }
  } else {
    if (this.editModeSvgLayerNode) {
      this.editModeSvgLayerNode.markups = currentMarkups;
    }
  }

  if (this.editingLayer || this.editingLayer.length === 0) {
    var svg = this.editingLayer.length === 0 ? this.editModeSvgLayerNode.svg : this.svgLayersMap[this.editingLayer].svg;
    if (svg.parentNode == this.svg) {
      this.svg.removeChild(svg);
      this.svg.appendChild(svg);
    }
  }
  return true;
};

/**
 * Removes markups from the DOM (Document Object Model). This is helpful for freeing up memory.<br>
 *
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#loadmarkups-markupstring-layerid|loadMarkups()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#unloadmarkupsalllayers-1|unloadMarkupsAllLayers()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#clear|clear()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hide-1|hide()}, and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hidemarkups-layerid|hideMarkups()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.unloadMarkups
 * @method unloadMarkups
 *
 * @param {string} layerId - ID of the layer containing all markups to unload (from the DOM).
 * @returns {boolean} Whether the operation succeeded or not.
 * @public
 */
MarkupsCore.prototype.unloadMarkups = function (layerId) {

  if (!layerId) {
    console.warn("unloadMarkups failed; No layerId provided.");
    return false;
  }

  var svgLayerNode = this.svgLayersMap[layerId];
  if (!svgLayerNode) {
    // TODO: Do we need to log anything here?
    console.warn('No such layer exists to unload.');
    return false;
  }

  var layerMarkups = svgLayerNode.markups.slice();
  var numMarkups = layerMarkups.length;
  for (var i = 0; i < numMarkups; i++) {
    var markup = layerMarkups[i];
    this.removeMarkup(markup);
    markup.destroy();
  }

  // Remove the markups in the layer from the svg canvas
  if (svgLayerNode.svg.parentNode === this.svg)
  this.svg.removeChild(svgLayerNode.svg);

  // Delete the layer from the layer map.
  delete this.svgLayersMap[layerId];
  // Reset the active layer if the supplied layer id is the same as the active layer
  if (this.activeLayer.toString() === layerId.toString()) {
    this.activeLayer = '';
  }
  // Leave edit mode and reset the editing layer if the supplied layer is the same as the current editing layer
  if (this.editingLayer && this.editingLayer.toString() === layerId.toString()) {
    this.editingLayer = '';
    this.duringEditMode && this.leaveEditMode();
  }

  return true;
};

/**
 * Removes all markups loaded so far. Great for freeing up memory.
 *
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#loadmarkups-markupstring-layerid|loadMarkups()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#unloadmarkups-layerid|unloadMarkups()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#clear|clear()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hide-1|hide()}, and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hidemarkups-layerid|hideMarkups()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.unloadMarkupsAllLayers
 * @method unloadMarkupsAllLayers
 * @public
 */
MarkupsCore.prototype.unloadMarkupsAllLayers = function () {
  this.activeLayer = '';
  var self = this;

  //this is specific to the editModeSvgLayerNode, enterEditMode().
  var unloadSvgLayerNode = function () {
    if (self.editModeSvgLayerNode) {
      var layerMarkups = self.editModeSvgLayerNode.markups.slice();
      var numMarkups = layerMarkups.length;
      for (var i = 0; i < numMarkups; i++) {
        var markup = layerMarkups[i];
        self.removeMarkup(markup);
        markup.destroy();
      }
    }
  };

  // Unload the markups in the editModeSvgLayerNode
  unloadSvgLayerNode();
  var layerId;
  for (layerId in this.svgLayersMap) {
    this.unloadMarkups(layerId);
  }
};

/**
 * Hides all markups in a specified layer. Note that hidden markups will not be unloaded.
 * Use the {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#showmarkups-layerid|showMarkups()} method to make
 * them visible again; no additional parsing is required.
 *
 * See also
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#showmarkups-layerid|showMarkups()},
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#unloadmarkups-layerid|unloadMarkups()}, and
 * {@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#loadmarkups-markupstring-layerid|loadMarkups()}.
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.hideMarkups
 * @method hideMarkups
 *
 * @param {string} layerId - ID of the layer containing all markups that should be hidden (in the DOM).
 * @returns {boolean} Whether the operation succeeded or not.
 * @public
 */
MarkupsCore.prototype.hideMarkups = function (layerId) {

  if (!layerId) {
    console.warn("hideMarkups failed; No layerId provided.");
    return false;
  }

  var svgLayerNode = this.svgLayersMap[layerId];
  if (!svgLayerNode) {
    // TODO: Do we need to log anything here?
    return false;
  }
  var layerSvg = svgLayerNode.svg;

  // Return false if the layer svg is not present in the main svg
  if (layerSvg.parentNode != this.svg) {
    console.warn("Layer is already hidden.");
    return false;
  }
  // remove the layer svg from the main svg
  this.svg.removeChild(layerSvg);
  return true;
};

/**
 * Unhides a layer of hidden markups
 * ({@link /en/docs/viewer/v7/reference/Extensions/MarkupsCore/#hidemarkups-layerid|hideMarkups()}).
 *
 * @memberof Autodesk.Viewing.Extensions.MarkupsCore
 * @alias Autodesk.Viewing.Extensions.MarkupsCore.showMarkups
 * @method showMarkups
 *
 * @param {string} layerId - ID of the layer containing all markups to unload (from the DOM).
 * @returns {boolean} Whether the operation succeeded or not.
 * @public
 */
MarkupsCore.prototype.showMarkups = function (layerId) {

  if (!layerId) {
    console.warn("showMarkups failed; No layerId provided.");
    return false;
  }

  var svgLayerNode = this.svgLayersMap[layerId];
  if (!svgLayerNode) {
    // TODO: Do we need to log anything here?
    return false;
  }
  // Append the layer svg to the main svg
  var layerSvg = svgLayerNode.svg;
  this.svg.appendChild(layerSvg);
};

//// Client Space <-> Markup Space /////////////////////////////////////////////////////////////////////////////////

proto.positionFromClientToMarkups = function (x, y) {

  return this.clientToMarkups(x, y);
};

proto.positionFromMarkupsToClient = function (x, y) {

  return this.markupsToClient(x, y);
};

proto.vectorFromClientToMarkups = function (x, y) {

  var a = this.clientToMarkups(0, 0);
  var b = this.clientToMarkups(x, y);

  return { x: b.x - a.x, y: b.y - a.y };
};

proto.vectorFromMarkupsToClient = function (x, y) {

  var a = this.markupsToClient(0, 0);
  var b = this.markupsToClient(x, y);

  return { x: b.x - a.x, y: b.y - a.y };
};

proto.sizeFromClientToMarkups = function (w, h) {

  var a = this.clientToMarkups(0, 0);
  var b = this.clientToMarkups(w, h);

  return { x: Math.abs(b.x - a.x), y: Math.abs(b.y - a.y) };
};

proto.sizeFromMarkupsToClient = function (w, h) {

  var a = this.markupsToClient(0, 0);
  var b = this.markupsToClient(w, h);

  return { x: Math.abs(b.x - a.x), y: Math.abs(b.y - a.y) };
};

proto.markupsToClient = function (x, y) {

  var camera = this.viewer.impl.camera;
  var point = new THREE.Vector3(x, y, 0);

  if (camera.isPerspective) {

    var bb = this.viewer.impl.getCanvasBoundingClientRect();

    point.x = point.x / PERSPECTIVE_MODE_SCALE * (bb.height * 0.5) + bb.width * 0.5;
    point.y = -point.y / PERSPECTIVE_MODE_SCALE * (bb.height * 0.5) + bb.height * 0.5;
  } else {

    point.applyMatrix4(camera.matrixWorld);
    point.sub(camera.position);

    // In LMV model is offset by a global offset, we correct this offset when transforming to markups space, so
    // exported markups don't have the offset.
    var globalOffset = this.viewer.model && this.viewer.model.getData().globalOffset;
    if (globalOffset) {
      point.sub(globalOffset);
    }

    point = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.worldToClient)(point, this.viewer, false);
    point.z = 0;
  }

  return point;
};

proto.clientToMarkups = function (x, y) {

  var camera = this.viewer.impl.camera;
  var point = new THREE.Vector3(x, y, 0);

  if (camera.isPerspective) {

    var bb = this.viewer.impl.getCanvasBoundingClientRect();

    // Multiply by PERSPECTIVE_MODE_SCALE because Firfox on Windows machines have problems to deal with very small paths.
    point.x = (point.x - bb.width * 0.5) / (bb.height * 0.5) * PERSPECTIVE_MODE_SCALE;
    point.y = -(point.y - bb.height * 0.5) / (bb.height * 0.5) * PERSPECTIVE_MODE_SCALE;
  } else {

    point = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.clientToWorld)(point.x, point.y, 0, this.viewer);

    // In LMV model is offset by a global offset, we correct this offset when transforming to markups space, so
    // exported markups don't have the offset.
    var globalOffset = this.viewer.model && this.viewer.model.getData().globalOffset;
    if (globalOffset) {
      point.add(globalOffset);
    }

    point.add(camera.position);
    point.applyMatrix4(camera.matrixWorldInverse);
    point.z = 0;
  }

  return point;
};

proto.getSvgViewBox = function (clientWidth, clientHeight) {

  // Get pan offset.
  var lt = this.clientToMarkups(0, 0);
  var rb = this.clientToMarkups(clientWidth, clientHeight);

  var l = Math.min(lt.x, rb.x);
  var t = Math.min(lt.y, rb.y);
  var r = Math.max(lt.x, rb.x);
  var b = Math.max(lt.y, rb.y);

  return [l, t, r - l, b - t].join(' ');
};

proto.getBounds = function () {

  return this.bounds;
};

proto.getMousePosition = function () {

  // When snapping, use the snap position instead of the mouse position
  // as the start point of the markup drawing.
  // For now only works for 2D.
  if (this.editMode.useWithSnapping() && this.snapper && this.snapper.isSnapped()) {
    return this.getSnapPosition();
  }
  return this.input.getMousePosition();
};

proto.getSnapPosition = function () {

  var point = MeasureCommon.getSnapResultPosition(this.snapper.getSnapResult(), this.viewer);
  var p = this.project(point);
  return { x: p.x, y: p.y };
};

proto.project = function (position) {
  var camera = this.viewer.navigation.getCamera();
  var containerBounds = this.viewer.navigation.getScreenViewport();

  var p = new THREE.Vector3().copy(position);
  p.project(camera);

  return new THREE.Vector3(Math.round((p.x + 1) / 2 * containerBounds.width),
  Math.round((-p.y + 1) / 2 * containerBounds.height), p.z);
};

//// Handled Events ////////////////////////////////////////////////////////////////////////////////////////////////

proto.onCameraChange = function () {

  // Update annotations' parent transform.
  var viewBox = this.getSvgViewBox(this.bounds.width, this.bounds.height);

  // HACK, for some reason the 2nd frame returns an empty canvas.
  // The reason why this happens is that the code above calls into the viewer
  // and a division by zero occurs due to LMV canvas having zero width and height
  // When we detect this case, avoid setting the viewBox value and rely on one
  // previously set.
  if (viewBox === "NaN NaN NaN NaN") {
    return;
  }

  if (this.svg) {
    this.svg.setAttribute('viewBox', viewBox);
  }


  var editMode = this.editMode;

  if (editMode) {
    // Edit frame has to be updated, re-setting the selected markup does the job.
    if (this.editFrame.isActive()) {
      var selectedMarkup = editMode.getSelection();
      this.editFrame.setMarkup(selectedMarkup);
    }

    if (editMode.updateTextBoxStyle) {
      editMode.updateTextBoxStyle();
    }

    if (this.snapper && editMode.useWithSnapping()) {
      this.snapper.indicator.render();
    }
  }
};

proto.onViewerResize = function (event) {

  this.bounds.x = 0;
  this.bounds.y = 0;
  this.bounds.width = event.width;
  this.bounds.height = event.height;

  if (this.svg) {
    this.svg.setAttribute('width', this.bounds.width);
    this.svg.setAttribute('height', this.bounds.height);
  }

  this.onCameraChange();
};

proto.callSnapperMouseDown = function () {

  // Disable snapper in freehand mode
  if (this.editMode && this.editMode.useWithSnapping()) {
    var mousePosition = this.input.getMousePosition();
    if (this.snapper) {
      this.snapper.onMouseDown(mousePosition);
      this.snapper.indicator.render();
    }
  } else {
    // Clear the snapper when selecting a markup that does not allow snapping.
    if (this.snapper) {
      this.snapper.clearSnapped();
      this.snapper.indicator.clearOverlays();
    }
  }
};

proto.callSnapperMouseMove = function () {

  if (this.editMode && this.editMode.useWithSnapping()) {
    var mousePosition = this.input.getMousePosition();
    if (this.snapper) {
      this.snapper.onMouseMove(mousePosition);
      this.snapper.indicator.render();
    }
  }
};

/**
 * Handler to mouse move events, used to create markups.
 *
 * @param event
 * @returns {boolean} - if the event was handed by the editor
 * @private
 */
proto.onMouseMove = function (event) {

  if (this.navigating) {
    return false;
  }

  let eventHandled = false;
  if (this.editFrame.isActive() && event.type === 'mousemove') {
    eventHandled = this.editFrame.onMouseMove(event);
  }

  this.callSnapperMouseMove();

  eventHandled = this.editMode && this.editMode.onMouseMove(event) || eventHandled;

  return eventHandled;
};

/**
 * Handler to mouse down events, used to start creation markups.
 *
 * @param event
 * @private
 */
proto.onMouseDown = function (event) {

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_3__.dismissLmvHudMessage)();

  this.callSnapperMouseDown();

  var bounds = this.getBounds();
  var mousePosition = this.getMousePosition();

  if (mousePosition.x >= bounds.x && mousePosition.x <= bounds.x + bounds.width &&
  mousePosition.y >= bounds.y && mousePosition.y <= bounds.y + bounds.height) {
    this.editMode.onMouseDown(event);
  }

  // TODO: There is a better way to do this, implement when undo/redo group.
  if (!this.editMode.creating && event.target === this.svg) {
    this.selectMarkup(null);
  }
  this.ignoreNextMouseUp = false;
};

/**
 *
 * @param {*} event
 * @returns {boolean} - true / false means the editor did / didn't handle the event
 * @private
 */
proto.onMouseUp = function (event) {

  if (this.navigating) {
    return false;
  }

  if (this.editFrame.isActive()) {
    this.editFrame.onMouseUp(event);
    return true;
  }

  if (!this.ignoreNextMouseUp) {
    return this.editMode.onMouseUp(event);
  }
};

proto.onMouseDoubleClick = function (event) {

  if (this.navigating) {
    return;
  }

  if (this.editFrame.isActive()) {
    return;
  }

  this.editMode.onMouseDoubleClick(event);
};

proto.onUserCancel = function () {
  if (!this.editMode) {
    return;
  } else
  if (this.editMode.creating) {
    this.editMode.creationCancel();
  } else {
    this.editMode.unselect();
  }
};

/**
 *
 * @param event
 * @private
 */
proto.onMarkupSelected = function (event) {

  this.selectMarkup(event.markup);
  this.dispatchEvent(event);
};

proto.onMarkupEnterEdition = function () {

};

proto.onMarkupCancelEdition = function () {

  this.onUserCancel();
};

proto.onMarkupDeleteEdition = function (event) {

  this.removeMarkup(event.markup);
  this.editMode.deleteMarkup();
};

Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Viewing.MarkupsCore', MarkupsCore);

/***/ },

/***/ "./extensions/Markup/core/MarkupsCoreUtils.js"
/*!****************************************************!*\
  !*** ./extensions/Markup/core/MarkupsCoreUtils.js ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EDIT_FRAME_DEFAULT_MARGIN: () => (/* binding */ EDIT_FRAME_DEFAULT_MARGIN),
/* harmony export */   MARKUP_DEFAULT_FONT_WIDTH_IN_PIXELS: () => (/* binding */ MARKUP_DEFAULT_FONT_WIDTH_IN_PIXELS),
/* harmony export */   MARKUP_DEFAULT_HITAREAS_MARGIN_IN_PIXELS: () => (/* binding */ MARKUP_DEFAULT_HITAREAS_MARGIN_IN_PIXELS),
/* harmony export */   MARKUP_DEFAULT_STROKE_WIDTH_IN_PIXELS: () => (/* binding */ MARKUP_DEFAULT_STROKE_WIDTH_IN_PIXELS),
/* harmony export */   addMarkupMetadata: () => (/* binding */ addMarkupMetadata),
/* harmony export */   addRuleToStyleSheet: () => (/* binding */ addRuleToStyleSheet),
/* harmony export */   addSvgMetadata: () => (/* binding */ addSvgMetadata),
/* harmony export */   addTraitEventDispatcher: () => (/* binding */ addTraitEventDispatcher),
/* harmony export */   areMarkupsPointsInClientRange: () => (/* binding */ areMarkupsPointsInClientRange),
/* harmony export */   checkLineSegment: () => (/* binding */ checkLineSegment),
/* harmony export */   checkPolygon: () => (/* binding */ checkPolygon),
/* harmony export */   clientToViewport: () => (/* binding */ clientToViewport),
/* harmony export */   clientToWorld: () => (/* binding */ clientToWorld),
/* harmony export */   composeRGBAString: () => (/* binding */ composeRGBAString),
/* harmony export */   createArcTo: () => (/* binding */ createArcTo),
/* harmony export */   createEllipsePath: () => (/* binding */ createEllipsePath),
/* harmony export */   createMarkupFromSVG: () => (/* binding */ createMarkupFromSVG),
/* harmony export */   createMarkupGroupSvg: () => (/* binding */ createMarkupGroupSvg),
/* harmony export */   createMarkupPathSvg: () => (/* binding */ createMarkupPathSvg),
/* harmony export */   createMarkupTextSvg: () => (/* binding */ createMarkupTextSvg),
/* harmony export */   createRectanglePath: () => (/* binding */ createRectanglePath),
/* harmony export */   createStyleSheet: () => (/* binding */ createStyleSheet),
/* harmony export */   createSvgElement: () => (/* binding */ createSvgElement),
/* harmony export */   degreesToRadians: () => (/* binding */ degreesToRadians),
/* harmony export */   dismissLmvHudMessage: () => (/* binding */ dismissLmvHudMessage),
/* harmony export */   getStrokeWidth: () => (/* binding */ getStrokeWidth),
/* harmony export */   getUniqueID: () => (/* binding */ getUniqueID),
/* harmony export */   hideLmvPanels: () => (/* binding */ hideLmvPanels),
/* harmony export */   hideLmvToolsAndPanels: () => (/* binding */ hideLmvToolsAndPanels),
/* harmony export */   hideLmvUi: () => (/* binding */ hideLmvUi),
/* harmony export */   isTouchDevice: () => (/* binding */ isTouchDevice),
/* harmony export */   measureTextLines: () => (/* binding */ measureTextLines),
/* harmony export */   metersToModel: () => (/* binding */ metersToModel),
/* harmony export */   radiansToDegrees: () => (/* binding */ radiansToDegrees),
/* harmony export */   removeAllMetadata: () => (/* binding */ removeAllMetadata),
/* harmony export */   removeTraitEventDispatcher: () => (/* binding */ removeTraitEventDispatcher),
/* harmony export */   renderToCanvas: () => (/* binding */ renderToCanvas),
/* harmony export */   restoreLmvUi: () => (/* binding */ restoreLmvUi),
/* harmony export */   setAttributeToMarkupSvg: () => (/* binding */ setAttributeToMarkupSvg),
/* harmony export */   setMarkupTextSvgTransform: () => (/* binding */ setMarkupTextSvgTransform),
/* harmony export */   setSvgParentAttributes: () => (/* binding */ setSvgParentAttributes),
/* harmony export */   showLmvToolsAndPanels: () => (/* binding */ showLmvToolsAndPanels),
/* harmony export */   sign: () => (/* binding */ sign),
/* harmony export */   simplify: () => (/* binding */ simplify),
/* harmony export */   stringToSvgNode: () => (/* binding */ stringToSvgNode),
/* harmony export */   svgNodeToString: () => (/* binding */ svgNodeToString),
/* harmony export */   transferChildNodes: () => (/* binding */ transferChildNodes),
/* harmony export */   updateMarkupPathSvgHitarea: () => (/* binding */ updateMarkupPathSvgHitarea),
/* harmony export */   updateMarkupTextSvgBackground: () => (/* binding */ updateMarkupTextSvgBackground),
/* harmony export */   updateMarkupTextSvgClipper: () => (/* binding */ updateMarkupTextSvgClipper),
/* harmony export */   updateMarkupTextSvgHitarea: () => (/* binding */ updateMarkupTextSvgHitarea),
/* harmony export */   viewportToClient: () => (/* binding */ viewportToClient),
/* harmony export */   worldToClient: () => (/* binding */ worldToClient),
/* harmony export */   worldToViewport: () => (/* binding */ worldToViewport)
/* harmony export */ });
/* harmony import */ var _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../core/MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _edit_actions_CreateArrow_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./edit-actions/CreateArrow.js */ "./extensions/Markup/core/edit-actions/CreateArrow.js");
/* harmony import */ var _edit_actions_CreateRectangle_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./edit-actions/CreateRectangle.js */ "./extensions/Markup/core/edit-actions/CreateRectangle.js");
/* harmony import */ var _edit_actions_CreateText_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./edit-actions/CreateText.js */ "./extensions/Markup/core/edit-actions/CreateText.js");
/* harmony import */ var _edit_actions_CreateCallout_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./edit-actions/CreateCallout.js */ "./extensions/Markup/core/edit-actions/CreateCallout.js");
/* harmony import */ var _edit_actions_CreateCircle_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./edit-actions/CreateCircle.js */ "./extensions/Markup/core/edit-actions/CreateCircle.js");
/* harmony import */ var _edit_actions_CreateCloud_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./edit-actions/CreateCloud.js */ "./extensions/Markup/core/edit-actions/CreateCloud.js");
/* harmony import */ var _edit_actions_CreateFreehand_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./edit-actions/CreateFreehand.js */ "./extensions/Markup/core/edit-actions/CreateFreehand.js");
/* harmony import */ var _edit_actions_CreatePolyline_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./edit-actions/CreatePolyline.js */ "./extensions/Markup/core/edit-actions/CreatePolyline.js");
/* harmony import */ var _edit_actions_CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./edit-actions/CreatePolycloud.js */ "./extensions/Markup/core/edit-actions/CreatePolycloud.js");
/* harmony import */ var _edit_actions_CreateHighlight_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./edit-actions/CreateHighlight.js */ "./extensions/Markup/core/edit-actions/CreateHighlight.js");
/* harmony import */ var _edit_actions_CreateDimension_js__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./edit-actions/CreateDimension.js */ "./extensions/Markup/core/edit-actions/CreateDimension.js");
/* harmony import */ var _DomElementStyle_js__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./DomElementStyle.js */ "./extensions/Markup/core/DomElementStyle.js");
/* harmony import */ var _edit_actions_CreateStamp_js__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ./edit-actions/CreateStamp.js */ "./extensions/Markup/core/edit-actions/CreateStamp.js");
















var av = Autodesk.Viewing;
var avp = Autodesk.Viewing.Private;

const _gWindow = av.getGlobal();
const _gDocument = _gWindow.document;

// Change these constants to alter the default sizes in pixels of strokes and fonts.
var MARKUP_DEFAULT_STROKE_WIDTH_IN_PIXELS = 1;
var MARKUP_DEFAULT_FONT_WIDTH_IN_PIXELS = 10;
var MARKUP_DEFAULT_HITAREAS_MARGIN_IN_PIXELS = 15;
var EDIT_FRAME_DEFAULT_MARGIN = 7;

/**
 * // isTouchDevice is an LMV function. Hammer is included by LMV as well
 * @returns {boolean}
 */
var isTouchDevice = function () {
  // isTouchDevice() is an LMV function.
  // Hammer (a touch detection lib) is packaged with LMV as well
  if (av.isTouchDevice && typeof Hammer === "function") {
    return av.isTouchDevice();
  }
  return false;
};

//// SVG  //////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 * @param type
 * @returns {Element}
 */
var createSvgElement = function (type) {

  const _document = this && this.getDocument && this.getDocument() || _gDocument;
  // See https://developer.mozilla.org/en-US/docs/Web/API/Document/createElementNS
  var namespace = 'http://www.w3.org/2000/svg';
  return _document.createElementNS(namespace, type);
};

/**
 *
 * @param {Element} svg - an SVGElement
 * @returns {Element} svg param is returned back
 */
var setSvgParentAttributes = function (svg) {

  // See: https://developer.mozilla.org/en-US/docs/Web/SVG/Namespaces_Crash_Course
  svg.setAttribute('version', '1.1'); // Notice that this is the SVG version, not the "MARKUP DATA VERSION"!
  svg.setAttribute('baseProfile', 'full');
  svg.setAttribute('layer-order-id', 'markups-svg');
  return svg;
};

var createMarkupGroupSvg = function (children) {
  children = children || [];
  var svg = createSvgElement('g');
  svg.setAttribute('cursor', 'default');
  svg.setAttribute('pointer-events', 'none');

  for (var i = 0; i < children.length; i++) {
    svg.appendChild(children[i]);
  }

  return svg;
};

var createMarkupPathSvg = function () {

  var svg = createSvgElement('g');
  svg.setAttribute('cursor', 'inherit');
  svg.setAttribute('pointer-events', 'none');

  var markup = createSvgElement('path');
  markup.setAttribute('id', 'markup');

  var hitarea = createSvgElement('path');
  hitarea.setAttribute('id', 'hitarea');
  hitarea.setAttribute('fill', 'transparent');
  hitarea.setAttribute('stroke', 'transparent');

  svg.markup = markup;
  svg.hitarea = hitarea;

  svg.appendChild(markup);
  svg.appendChild(hitarea);

  return svg;
};

var setAttributeToMarkupSvg = function (svg, attribute, value) {

  svg.markup.setAttribute(attribute, value);
};

var updateMarkupPathSvgHitarea = function (svg, editor) {

  var markup = svg.markup;
  var hitarea = svg.hitarea;

  var hitareaMargin = editor.sizeFromClientToMarkups(0, MARKUP_DEFAULT_HITAREAS_MARGIN_IN_PIXELS).y;
  hitareaMargin += parseFloat(markup.getAttribute('stroke-width')) + hitareaMargin;

  var markupFill = markup.getAttribute('fill');
  var markupStroke = markup.getAttribute('stroke');
  var strokeEnabled = markupStroke !== '' && markupStroke !== 'none';
  var fillEnabled = markupFill !== '' && markupFill !== 'none';

  hitarea.setAttribute('d', markup.getAttribute('d'));
  hitarea.setAttribute('stroke-width', hitareaMargin);
  hitarea.setAttribute('transform', markup.getAttribute('transform'));

  if (editor.duringEditMode && !editor.navigating) {
    if (strokeEnabled && fillEnabled) {
      svg.setAttribute('pointer-events', 'painted');
      return;
    }

    if (strokeEnabled) {
      svg.setAttribute('pointer-events', 'stroke');
      return;
    }

    if (fillEnabled) {
      svg.setAttribute('pointer-events', 'fill');
      return;
    }
  }

  svg.setAttribute('pointer-events', 'none');
};

var createMarkupTextSvg = function () {

  var svg = createSvgElement('g');
  svg.setAttribute('cursor', 'default');

  var clipperId = 'markup-clipper-' + getUniqueID();
  var clipperUrl = 'url(#' + clipperId + ')';

  var clipper = createSvgElement('clipPath');
  clipper.setAttribute('id', clipperId);
  clipper.removeAttribute('pointer-events');
  clipper.rect = createSvgElement('rect');
  clipper.appendChild(clipper.rect);

  var background = createSvgElement('rect');
  background.setAttribute('id', 'markup-background');
  background.removeAttribute('pointer-events');

  var markup = createSvgElement('text');
  markup.setAttribute('id', 'markup');

  var hitarea = createSvgElement('rect');
  hitarea.setAttribute('id', 'hitarea');
  hitarea.setAttribute('fill', 'transparent');
  hitarea.setAttribute('stroke', 'none');
  hitarea.setAttribute('stroke-width', '0');

  var clippedArea = createSvgElement('g');
  clippedArea.setAttribute('clip-path', clipperUrl);
  clippedArea.appendChild(clipper);
  clippedArea.appendChild(background);
  clippedArea.appendChild(markup);

  svg.appendChild(clippedArea);
  svg.appendChild(hitarea);

  svg.clipper = clipper;
  svg.background = background;
  svg.markup = markup;
  svg.hitarea = hitarea;

  return svg;
};

var setMarkupTextSvgTransform = function (svg, transform, textTransform) {

  svg.clipper.rect.setAttribute('transform', transform);
  svg.background.setAttribute('transform', transform);
  svg.markup.setAttribute('transform', textTransform);
  svg.hitarea.setAttribute('transform', transform);
};

var updateMarkupTextSvgHitarea = function (svg, w, h, editor) {

  var hitarea = svg.hitarea;
  var hitareaMargin = editor.sizeFromClientToMarkups(0, MARKUP_DEFAULT_HITAREAS_MARGIN_IN_PIXELS).y;

  hitarea.setAttribute('x', -hitareaMargin);
  hitarea.setAttribute('y', -hitareaMargin);
  hitarea.setAttribute('width', w + hitareaMargin * 2);
  hitarea.setAttribute('height', h + hitareaMargin * 2);
  svg.setAttribute("pointer-events", editor.navigating ? "none" : "painted");
};

var updateMarkupTextSvgBackground = function (svg, w, h, color) {

  var background = svg.background;

  background.setAttribute('x', 0);
  background.setAttribute('y', 0);
  background.setAttribute('width', w);
  background.setAttribute('height', h);
  background.setAttribute('fill', color);
};

var updateMarkupTextSvgClipper = function (svg, w, h) {

  var clipper = svg.clipper;

  clipper.rect.setAttribute('x', 0);
  clipper.rect.setAttribute('y', 0);
  clipper.rect.setAttribute('width', w);
  clipper.rect.setAttribute('height', h);
};

/**
 * Helper function that injects metadata for the whole Markup document.
 * Metadata includes: version.
 * @param {Element} svg - an SVGElement
 * @param {Object} metadata - Dictionary with attributes
 */
var addSvgMetadata = function (svg, metadata) {

  const _document = this && this.getDocument && this.getDocument() || _gDocument;

  var metadataNode = _document.createElementNS('http://www.w3.org/2000/svg', 'metadata');
  var dataVersionNode = _document.createElement('markup_document');

  metadataNode.appendChild(dataVersionNode);

  // NOTE: We could iterate over the properties, but we don't because these are the only ones supported
  dataVersionNode.setAttribute("data-model-version", metadata["data-model-version"]); // Version. For example: "1"

  svg.insertBefore(metadataNode, svg.firstChild);
  return metadataNode;
};

/**
 * Helper function that injects metadata for specific markup svg nodes.
 * @param {Element} markupNode - an SVGElement for the markup
 * @param {Object} metadata - Dictionary where all key/value pairs are added as metadata entries.
 * @returns {Element}
 */
var addMarkupMetadata = function (markupNode, metadata) {

  const _document = this && this.getDocument && this.getDocument() || _gDocument;

  var metadataNode = _document.createElementNS('http://www.w3.org/2000/svg', 'metadata');
  var dataVersionNode = _document.createElement('markup_element');

  metadataNode.appendChild(dataVersionNode);
  for (var key in metadata) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      dataVersionNode.setAttribute(key, metadata[key]);
    }
  }

  markupNode.insertBefore(metadataNode, markupNode.firstChild);
  return metadataNode;
};

/**
 * Removes al metadata nodes from an Svg node structure.
 * Method will remove all metadata nodes from children nodes as well.
 * @param svgNode
 */
var removeAllMetadata = function (svgNode) {

  if (svgNode.getElementsByTagName) {
    var nodes = svgNode.getElementsByTagName("metadata");
    for (var i = 0; i < nodes.length; ++i) {
      var metadataNode = nodes[i];
      metadataNode.parentNode && metadataNode.parentNode.removeChild(metadataNode);
    }
  }

  // Transverse children nodes
  var svgChildren = svgNode.children || svgNode.childNodes;
  if (svgChildren) {
    for (i = 0; i < svgChildren.length; ++i) {
      removeAllMetadata(svgChildren[i]);
    }
  }
};

/**
 * Utility function that transfers children from an Html/Svg node into another one.
 * @param nodeFrom - The node instance from where children will be taken.
 * @param nodeInto - The node that's going to parent the transferred children.
 */
var transferChildNodes = function (nodeFrom, nodeInto) {

  var svgChildren = nodeFrom.children || nodeFrom.childNodes;
  var tmpArray = [];
  for (var i = 0; i < svgChildren.length; ++i) {
    tmpArray.push(svgChildren[i]); // Avoid appendChild
  }
  tmpArray.forEach(function (node) {
    nodeInto.appendChild(node);
  });
};

/**
 * Generate a unique id.
 * @returns {string}
 */
var getUniqueID = function () {
  return Autodesk.Viewing.Private.randomUUID();
};


/**
 * Serializes an SVG node into a String.
 * @param domNode
 * @returns {string}
 */
var svgNodeToString = function (domNode) {

  function removeHitareas(svg, hitareas) {

    var hitarea = svg.hitarea;
    var hitareaParent = hitarea && hitarea.parentNode;

    if (hitareaParent) {

      hitareas.push({ hitarea: hitarea, parent: hitareaParent });
      hitareaParent.removeChild(hitarea);
    }

    var children = svg.childNodes;
    var childrenCount = children.length;

    for (var i = 0; i < childrenCount; ++i) {
      removeHitareas(children.item(i), hitareas);
    }
  }

  function addHitareas(hitareas) {

    var hitareasCount = hitareas.length;
    for (var i = 0; i < hitareasCount; ++i) {

      var hitarea = hitareas[i];
      hitarea.parent.appendChild(hitarea.hitarea);
    }
  }

  var result;
  try {
    var hitareas = [];
    removeHitareas(domNode, hitareas);

    var xmlSerializer = new XMLSerializer();
    result = xmlSerializer.serializeToString(domNode);

    addHitareas(hitareas);

  } catch (err) {
    result = '';
    console.warn('svgNodeToString failed to generate string representation of domNode.');
  }
  return result;
};

var stringToSvgNode = function (stringNode) {

  var node = null;
  try {
    var domParser = new DOMParser();
    var doc = domParser.parseFromString(stringNode, "text/xml");
    node = doc.firstChild; // We should only be getting 1 child anyway.
  } catch (err) {
    node = null;
    console.warn('stringToSvgNode failed to generate an HTMLElement from its string representation.');
  }
  return node;
};

/**
 * Injects functions and members to a client object which will
 * receive the ability to dispatch events.
 * Mechanism is the same as in Autodesk.Viewing.Viewer.
 *
 * Note: All of the code here comes from Autodesk.Viewing.Viewer
 *
 * @param {Object} client - Object that will become an event dispatcher.
 */
var addTraitEventDispatcher = function (client) {

  // Inject member variable
  client.listeners = {};

  // Inject functions
  client.addEventListener = function (type, listener) {
    if (typeof this.listeners[type] == "undefined") {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  };
  client.hasEventListener = function (type, listener) {
    if (this.listeners === undefined) return false;
    var listeners = this.listeners;
    if (listeners[type] !== undefined && listeners[type].indexOf(listener) !== -1) {
      return true;
    }
    return false;
  };
  client.removeEventListener = function (type, listener) {
    if (this.listeners[type] instanceof Array) {
      var li = this.listeners[type];
      for (var i = 0, len = li.length; i < len; i++) {
        if (li[i] === listener) {
          li.splice(i, 1);
          break;
        }
      }
    }
  };
  client.dispatchEvent = function (event) {
    if (typeof event == "string") {
      event = { type: event };
    }
    if (!event.target) {
      event.target = this;
    }

    if (!event.type) {
      throw new Error("event type unknown.");
    }

    if (this.listeners[event.type] instanceof Array) {
      var typeListeners = this.listeners[event.type].slice();
      for (var i = 0; i < typeListeners.length; i++) {
        typeListeners[i].call(this, event);
      }
    }
  };
};

/**
 * Removes the EventDispatcher trait
 *
 * @param {Object} client
 */
var removeTraitEventDispatcher = function (client) {

  try {
    delete client.listeners;
    delete client.addEventListener;
    delete client.hasEventListener;
    delete client.removeEventListener;
    delete client.dispatchEvent;
  } catch (e) {

    // nothing
  }};

//// Math  /////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Calculates the pixel position in client space coordinates of a point in world space.
 * @param {THREE.Vector3} point Point in world space coordinates.
 * @param viewer
 * @param snap Round values to closest pixel center.
 * @returns {THREE.Vector3} Point transformed and projected into client space coordinates.
 */
var worldToClient = function (point, viewer, snap) {

  var p = worldToViewport(point, viewer);
  var result = viewportToClient(p.x, p.y, viewer);
  result.z = 0;

  // snap to the center of the
  if (snap) {
    result.x = Math.floor(result.x) + 0.5;
    result.y = Math.floor(result.y) + 0.5;
  }

  return result;
};

var clientToWorld = function (clientX, clientY, depth, viewer) {

  var point = clientToViewport(clientX, clientY, viewer);
  point.z = depth;

  point.unproject(viewer.impl.camera);
  return point;
};

var clientToViewport = function (clientX, clientY, viewer) {

  return viewer.impl.clientToViewport(clientX, clientY);
};

var viewportToClient = function (viewportX, viewportY, viewer) {

  return viewer.impl.viewportToClient(viewportX, viewportY);
};

/**
 * Calculates the world position of a point in client space coordinates.
 * @param {Object} point - { x:Number, y:Number, z:Number }
 * @param {Object} viewer - LMV instance
 * @returns {THREE.Vector3}
 */
var worldToViewport = function (point, viewer) {

  var p = new THREE.Vector3();

  p.x = point.x;
  p.y = point.y;
  p.z = point.z;

  p.project(viewer.impl.camera);
  return p;
};

var metersToModel = function (meters, viewer) {

  var modelToMeter = viewer.model.getUnitScale();
  var meterToModel = 1 / modelToMeter;

  return meterToModel * meters;
};

var radiansToDegrees = function (radians) {

  return radians * (180 / Math.PI);
};

var degreesToRadians = function (degrees) {

  return degrees * (Math.PI / 180);
};

/**
 *
 * @param value
 * @returns {number}
 */
var sign = function (value) {

  return value >= 0 ? 1 : -1;
};

/**
 *
 * @param pointA
 * @param pointB
 * @param range
 * @param editor
 * @returns {boolean}
 */
var areMarkupsPointsInClientRange = function (pointA, pointB, range, editor) {

  range = editor.sizeFromClientToMarkups(0, range).y;

  var dx = pointA.x - pointB.x;
  var dy = pointA.y - pointB.y;

  return range * range >= dx * dx + dy * dy;
};

//// LMV ui ////////////////////////////////////////////////////////////////////////////////////////////////////////

var hideLmvUi = function (viewer) {

  // If the viewer is no gui, then there is nothing to hide
  if (!viewer.toolbar) {
    return;
  }

  // Exit other tools and hide HudMessages.
  viewer.setActiveNavigationTool();

  dismissLmvHudMessage();
  hideLmvPanels(true, viewer);
  hideLmvToolsAndPanels(viewer);
};

var restoreLmvUi = function (viewer) {

  // If the viewer is no gui, then there is nothing to hide
  if (!viewer.toolbar) {
    return;
  }

  dismissLmvHudMessage();
  hideLmvPanels(false, viewer);
  showLmvToolsAndPanels(viewer);
};

/**
 *
 * @param hide
 * @param viewer
 */
var hideLmvPanels = function (hide, viewer) {

  var dockingPanels = viewer.dockingPanels;

  // Panels may not be present when dealing with an instance of Viewer3D.js
  // (as opposed to an instance of GuiViewer3D.js)
  if (!dockingPanels) return;

  for (var i = 0; i < dockingPanels.length; ++i) {

    var panel = dockingPanels[i];
    var panelContainer = panel.container;

    if (panelContainer.classList.contains("dockingPanelVisible")) {
      panelContainer.style.display = hide ? "none" : "block";

      // Call the visibility changed notification if any additional
      // stuff needs to be done (update the date i.e. PropertyPanel, etc).
      panel.visibilityChanged();
    }
  }
};

/**
 * Shows panels and tools in the viewer.
 * @param viewer
 */
var showLmvToolsAndPanels = function (viewer) {

  // Restore view cube.
  if (viewer && viewer.model && !viewer.model.is2d()) {
    viewer.getExtension("Autodesk.ViewCubeUi", function (ext) {
      ext.displayViewCube(true, false);
      ext.displayHomeButton(true);
    });
  }

  // TODO: Find or ask for a better way to restore this buttons.
  const _document = viewer.getDocument();
  var anim = _document.getElementsByClassName('toolbar-animation-subtoolbar');

  if (anim.length > 0) {
    anim[0].style.display = '';
  }

  // toolbar is absent when dealing with an instance of Viewer3D (instead of GuiViewer3D)
  if (viewer.toolbar) {
    var viewerContainer = viewer.toolbar.container;
    var viewerContainerChildrenCount = viewerContainer.children.length;
    for (var i = 0; i < viewerContainerChildrenCount; ++i) {
      viewerContainer.children[i].style.display = "";
    }
  }
};

/**
 * Hides panels and tools in the viewer.
 * @param viewer
 */
var hideLmvToolsAndPanels = function (viewer) {

  // Hide Panels and tools.
  if (viewer && viewer.model && !viewer.model.is2d()) {
    viewer.getExtension("Autodesk.ViewCubeUi", function (ext) {
      ext.displayViewCube(false, false);
      ext.displayHomeButton(false);
    });

  }

  const _document = viewer.getDocument();
  // TODO: Find or ask for a better way to hide this buttons.
  var anim = _document.getElementsByClassName('toolbar-animation-subtoolbar');

  if (anim.length > 0) {
    anim[0].style.display = 'none';

    var animator = viewer.impl.keyFrameAnimator;
    if (animator && !animator.isPaused) {
      animator.pauseCameraAnimations();
      animator.pause();

      var playButton = viewer.modelTools.getControl('toolbar-animationPlay');
      if (playButton) {
        playButton.setIcon('toolbar-animation-pause-icon');
        playButton.setToolTip('Pause');
      }
    }
  }

  // toolbar is absent when dealing with an instance of Viewer3D (instead of GuiViewer3D)
  if (viewer.toolbar) {
    var viewerContainer = viewer.toolbar.container;
    var viewerContainerChildrenCount = viewerContainer.children.length;
    for (var i = 0; i < viewerContainerChildrenCount; ++i) {
      viewerContainer.children[i].style.display = "none";
    }
  }
};

/**
 * Dismisses all LMV HudMessages
 */
var dismissLmvHudMessage = function () {

  // Using try/catch block since we are accessing the Private namespace of LMV.
  try {
    var keepDismissing = true;
    while (keepDismissing) {
      keepDismissing = Autodesk.Viewing.Private.HudMessage.dismiss();
    }
  } catch (ignore) {
    // Failing to show the message is an okay fallback scenario
    console.warn("[CO2]Failed to dismiss LMV HudMessage");
  }
};

//// Styles ////////////////////////////////////////////////////////////////////////////////////////////////////////

var getStrokeWidth = function (widthInPixels, editor) {

  var size = editor.sizeFromClientToMarkups(0, widthInPixels);
  return size.y;
};

/**
 * Creates markups from a parsed svg string child
 * @param child - child of a parsed SVG string
 * @param editor - MarkupsCore
 * @returns {*} Markup Object
 */
var createMarkupFromSVG = function (child, editor) {
  // var self = this;
  if (!child.childNodes[0]) {
    return null;
  }

  var meta = child.childNodes[0].childNodes[0] || '';

  var getCurrentStyle = function (editor, metadata) {

    var source = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity',
    'font-family', 'font-size', 'font-style', 'font-weight', 'stroke-linejoin'];
    var style = {};
    for (var i = 0; i < source.length; i++) {
      var value = metadata.getAttribute(source[i]);
      if (value == null) {
        continue;
      }
      switch (source[i]) {
        case 'font-size':
        case 'stroke-width':
        case 'stroke-opacity':
        case 'fill-opacity':
          style[source[i]] = parseFloat(value);
          break;
        case 'stroke-linejoin':
          break;
        case 'font-family':
        case 'font-style':
        case 'font-weight':
        case 'stroke-color':
        case 'text-data':
        case 'fill-color':
          style[source[i]] = value;
          break;
        default:
          avp.logger.warn('Style not recognized.');
          break;
      }
    }
    return style;
  };

  var isClosed = function () {
    var path = child.childNodes[1] || '';
    var closed = false;
    if (typeof path !== 'string') {
      var d = path.getAttribute('d').split(' ');
      if (d[d.length - 1].toLowerCase() === 'z') {
        closed = true;
      }
    }
    return closed;
  };

  var getLocations = function () {
    var locations = [];
    var locStr = meta.getAttribute('locations').split(" ") || '';

    for (var i = 0; i < locStr.length; i += 2) {
      var pointPair = { x: parseFloat(locStr[i]), y: parseFloat(locStr[i + 1]) };
      locations.push(pointPair);
    }
    return locations;
  };

  var getAttributeVector = function (attribute) {
    var posVec = new THREE.Vector3();
    var value = meta.getAttribute(attribute) || meta.getAttribute(attribute.toLowerCase());
    var strPos = value.split(" ");
    posVec.x = parseFloat(strPos[0]);
    posVec.y = parseFloat(strPos[1]);
    return posVec;
  };

  var getPosition = function () {
    return getAttributeVector('position');
  };

  var getSize = function () {
    return getAttributeVector('size');
  };

  var getRotation = function () {
    var strRot = meta.getAttribute('rotation') || '';
    return parseFloat(strRot);
  };

  var getText = function () {
    return meta.getAttribute('text') || '';
  };

  var getIsFrameUsed = function () {
    return !!parseInt(meta.getAttribute('isframeused'));
  };

  if (typeof meta !== 'string') {
    // get the type of the child
    var position, size, rotation, locations, tail, head, closed, text, firstAnchor, secondAnchor;
    var id = editor.getId();
    var style = getCurrentStyle(editor, meta);
    var type = meta.getAttribute('type') || '';
    var createMarkup;
    switch (type) {
      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_ARROW:
        tail = getAttributeVector('tail');
        head = getAttributeVector('head');
        createMarkup = new _edit_actions_CreateArrow_js__WEBPACK_IMPORTED_MODULE_1__.CreateArrow(editor, id, tail, head, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_RECTANGLE:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        createMarkup = new _edit_actions_CreateRectangle_js__WEBPACK_IMPORTED_MODULE_2__.CreateRectangle(editor, id, position, size, rotation, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_TEXT:
        position = getPosition();
        size = getSize();
        text = getText();
        createMarkup = new _edit_actions_CreateText_js__WEBPACK_IMPORTED_MODULE_3__.CreateText(editor, id, position, size, text, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_CALLOUT:
        position = getPosition();
        size = getSize();
        text = getText();
        var isFrameUsed = getIsFrameUsed();
        createMarkup = new _edit_actions_CreateCallout_js__WEBPACK_IMPORTED_MODULE_4__.CreateCallout(editor, id, position, size, text, style, isFrameUsed);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_CIRCLE:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        createMarkup = new _edit_actions_CreateCircle_js__WEBPACK_IMPORTED_MODULE_5__.CreateCircle(editor, id, position, size, rotation, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_CLOUD:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        createMarkup = new _edit_actions_CreateCloud_js__WEBPACK_IMPORTED_MODULE_6__.CreateCloud(editor, id, position, size, rotation, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_FREEHAND:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        locations = getLocations();
        createMarkup = new _edit_actions_CreateFreehand_js__WEBPACK_IMPORTED_MODULE_7__.CreateFreehand(editor, id, position, size, rotation, locations, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_POLYLINE:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        locations = getLocations();
        closed = isClosed();
        createMarkup = new _edit_actions_CreatePolyline_js__WEBPACK_IMPORTED_MODULE_8__.CreatePolyline(editor, id, position, size, rotation, locations, style, closed);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_POLYCLOUD:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        locations = getLocations();
        closed = isClosed();
        createMarkup = new _edit_actions_CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_9__.CreatePolycloud(editor, id, position, size, rotation, locations, style, closed);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_HIGHLIGHT:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        locations = getLocations();
        createMarkup = new _edit_actions_CreateHighlight_js__WEBPACK_IMPORTED_MODULE_10__.CreateHighlight(editor, id, position, size, rotation, locations, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_DIMENSION:
        firstAnchor = getAttributeVector('firstAnchor');
        secondAnchor = getAttributeVector('secondAnchor');
        text = getText();
        createMarkup = new _edit_actions_CreateDimension_js__WEBPACK_IMPORTED_MODULE_11__.CreateDimension(editor, id, firstAnchor, secondAnchor, text, style);
        break;

      case _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_0__.MARKUP_TYPE_STAMP:
        position = getPosition();
        size = getSize();
        rotation = getRotation();
        createMarkup = new _edit_actions_CreateStamp_js__WEBPACK_IMPORTED_MODULE_13__.CreateStamp(editor, id, position, size, rotation, style, child);
        break;

      default:
        createMarkup = null;
        break;
    }
    if (createMarkup) {
      createMarkup.addToHistory = false;
      createMarkup.execute();
      var markupList = editor.svgLayersMap[editor.activeLayer].markups;

      for (var i = 0; i < markupList.length; ++i) {
        if (markupList[i].id === id) {
          return markupList[i];
        }
      }
    }
    return null;
  }
};


var composeRGBAString = function (hexRGBString, opacity) {

  if (!hexRGBString || !opacity || opacity <= 0) {
    return 'none';
  }

  return ['rgba(' +
  parseInt('0x' + hexRGBString.substr(1, 2)), ',',
  parseInt('0x' + hexRGBString.substr(3, 2)), ',',
  parseInt('0x' + hexRGBString.substr(5, 2)), ',', opacity, ')'].join('');
};

//// Id Target Collision ///////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 * @param x0
 * @param y0
 * @param x1
 * @param y1
 * @param idTarget
 */
var checkLineSegment = function (x0, y0, x1, y1, idTarget) {

  const _window = this && this.getWindow && this.getWindow() || _gWindow;
  var deviceRatio = _window.devicePixelRatio || 1;

  x0 *= deviceRatio;
  y0 *= deviceRatio;
  x1 *= deviceRatio;
  y1 *= deviceRatio;

  var idTargetWidth = idTarget.width;
  var idTargetHeight = idTarget.height;
  var idTargetBuffer = idTarget.buffer;

  x0 = Math.round(x0);
  x1 = Math.round(x1);
  y0 = Math.round(idTargetHeight - y0);
  y1 = Math.round(idTargetHeight - y1);

  function point(x, y) {

    x = Math.round(x);
    y = Math.round(y);

    var dx = 0;
    var dy = 0;

    for (var j = -deviceRatio; j <= deviceRatio; j += deviceRatio * 2) {
      dy += check(x, y + j) ? j : 0;
    }

    for (var i = -deviceRatio; i <= deviceRatio; i += deviceRatio * 2) {
      dx += check(x + i, y) ? i : 0;
    }

    return {
      x: Math.round(x / deviceRatio + dx),
      y: Math.round((idTargetHeight - y) / deviceRatio - dy) };
  }

  function check(x, y) {

    // Probably better to clip line at the beginning.
    if (x < 0 || x >= idTargetWidth ||
    y < 0 || y >= idTargetHeight) {
      return false;
    }

    var index = (y * idTargetWidth + x) * 4;
    return (
      idTargetBuffer[index] !== 0xFF ||
      idTargetBuffer[index + 1] !== 0xFF ||
      idTargetBuffer[index + 2] !== 0xFF);
  }

  // DDA Line algorithm
  var dx = x1 - x0;
  var dy = y1 - y0;

  var m = dx !== 0 ? dy / dx : 1;
  var x = x0;
  var y = y0;

  if (dx !== 0 && Math.abs(m) <= 1) {

    if (x0 <= x1) {
      for (; x <= x1; ++x, y += m) {
        if (check(x, Math.round(y))) {
          return point(x, y);
        }
      }
    } else {
      for (; x >= x1; --x, y -= m) {
        if (check(x, Math.round(y))) {
          return point(x, y);
        }
      }
    }
  } else {

    m = dx !== 0 ? 1 / m : 0;
    if (y0 <= y1) {
      for (; y <= y1; ++y, x += m) {
        if (check(Math.round(x), y)) {
          return point(x, y);
        }
      }
    } else {
      for (; y >= y1; --y, x -= m) {
        if (check(Math.round(x), y)) {
          return point(x, y);
        }
      }
    }
  }
};

/**
 *
 * @param polygon
 * @param idTarget
 */
var checkPolygon = function (polygon, idTarget) {

  // Return if incorrect parameters.
  if (!polygon || polygon.verxtexCount < 3 || !idTarget) {
    return null;
  }

  const _window = this && this.getWindow && this.getWindow() || _gWindow;
  var deviceRatio = _window.devicePixelRatio || 1;

  var idTargetWidth = idTarget.width;
  var idTargetHeight = idTarget.height;
  var idTargetBuffer = idTarget.buffer;

  var vertexCount = polygon.vertexCount;
  var xVertices = Float32Array.from(polygon.xVertices); // Clone to scale by device pixel ratio and to
  var yVertices = Float32Array.from(polygon.yVertices); // change y coordinates to OpenGL style.

  function point(x, y) {

    var dx = 0;
    var dy = 0;

    for (var j = -deviceRatio; j <= deviceRatio; j += deviceRatio * 2) {
      dy += check(x, y + j) ? j : 0;
    }

    for (var i = -deviceRatio; i <= deviceRatio; i += deviceRatio * 2) {
      dx += check(x + i, y) ? i : 0;
    }

    return {
      x: Math.round(x / deviceRatio) + dx,
      y: Math.round((idTargetHeight - y) / deviceRatio - dy) };
  }

  function check(x, y) {

    if (x < 0 || x >= idTargetWidth ||
    y < 0 || y >= idTargetHeight) {
      return false;
    }

    var index = (y * idTargetWidth + x) * 4;
    return (
    idTargetBuffer[index] !== 0xFF ||
    idTargetBuffer[index + 1] !== 0xFF ||
    idTargetBuffer[index + 2] !== 0xFF) && isInsidePolygon(x, y);
  }

  function isInsidePolygon(x, y) {

    var result = false;
    var vertexCount = polygon.vertexCount;
    for (var i = 0, j = vertexCount - 1; i < vertexCount; j = i++) {

      if (yVertices[i] > y != yVertices[j] > y &&
      x < (xVertices[j] - xVertices[i]) * (y - yVertices[i]) / (yVertices[j] - yVertices[i]) + xVertices[i]) {
        result = !result;
      }
    }
    return result;
  }

  // Change coordinates to OpenGL style and calculate polygon's bounding box.
  var bbX0 = Number.POSITIVE_INFINITY;
  var bbY0 = Number.POSITIVE_INFINITY;
  var bbX1 = Number.NEGATIVE_INFINITY;
  var bbY1 = Number.NEGATIVE_INFINITY;

  for (var i = 0; i < vertexCount; ++i) {

    var bbX = xVertices[i] = xVertices[i] * deviceRatio;
    var bbY = yVertices[i] = idTargetHeight - yVertices[i] * deviceRatio;

    bbX0 = Math.min(bbX0, bbX);
    bbY0 = Math.min(bbY0, bbY);
    bbX1 = Math.max(bbX1, bbX);
    bbY1 = Math.max(bbY1, bbY);
  }

  if (bbX1 < 0 || bbX0 > idTargetWidth ||
  bbY1 < 0 || bbY0 > idTargetHeight) {
    return null;
  }

  var bbW = Math.round(bbX1 - bbX0);
  var bbH = Math.round(bbY1 - bbY0);

  var bbCenterX = Math.round((bbX0 + bbX1) * 0.5);
  var bbCenterY = Math.round((bbY0 + bbY1) * 0.5);

  // Check
  var x = bbCenterX;
  var y = bbCenterY;

  var w = 1;
  var h = 1;

  do {

    var endX = x + w;
    var endY = y + h;

    for (; x < endX; ++x) {
      if (check(x, y)) {
        return point(x, y);
      }
    }

    for (; y < endY; ++y) {
      if (check(x, y)) {
        return point(x, y);
      }
    }

    if (w < bbW) {
      endX = x - ++w;++w;
    } else {
      endX = x - w;
    }

    if (h < bbH) {
      endY = y - ++h;++h;
    } else {
      endY = y - h;
    }

    for (; x > endX; --x) {
      if (check(x, y)) {
        return point(x, y);
      }
    }

    for (; y > endY; --y) {
      if (check(x, y)) {
        return point(x, y);
      }
    }
  } while (w < bbW || h < bbH);
};

//// CSS ///////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 * @returns {*}
 */
var createStyleSheet = function () {

  const _document = this && this.getDocument && this.getDocument() || _gDocument;
  var style = _document.createElement("style");

  // This is WebKit hack.
  style.appendChild(_document.createTextNode(""));
  _document.head.appendChild(style);

  return style.sheet;
};

/**
 *
 * @param styleSheet
 * @param selector
 * @param styles
 * @param index
 */
var addRuleToStyleSheet = function (styleSheet, selector, styles, index) {

  if ("insertRule" in styleSheet) {
    styleSheet.insertRule(selector + "{" + styles + "}", index);
  } else
  if ("addRule" in styleSheet) {
    styleSheet.addRule(selector, styles, index);
  }
};

//// SVG ///////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 *
 * @param lines
 * @param style
 * @param editor
 */
var measureTextLines = function (lines, style, editor) {

  // Measure div style is line style with some custom layout properties.
  var fontSize = editor.sizeFromMarkupsToClient(0, style['font-size']).y;

  var measureStyle = new _DomElementStyle_js__WEBPACK_IMPORTED_MODULE_12__.DomElementStyle().
  setAttribute('font-family', style['font-family']).
  setAttribute('font-size', fontSize + 'px').
  setAttribute('font-weight', style['font-weight'] ? 'bold' : '').
  setAttribute('font-style', style['font-style'] ? 'italic' : '').

  removeAttribute(['top', 'left', 'width', 'height', 'overflow-y']).
  setAttribute('position', 'absolute').
  setAttribute('white-space', 'nowrap').
  setAttribute('float', 'left').
  setAttribute('visibility', 'hidden').
  getStyleString();

  const _document = this && this.getDocument && this.getDocument() || _gDocument;
  // Create measure div.
  var measure = _document.createElement('div');

  measure.setAttribute('style', measureStyle);
  editor.viewer.container.appendChild(measure);

  // Measure.
  var result = [];

  var linesCount = lines.length;
  for (var i = 0; i < linesCount; ++i) {

    measure.innerText = lines[i];
    result.push({
      line: lines[i],
      width: measure.clientWidth,
      height: measure.clientHeight
    });
  }

  // Remove measure div and return result.
  editor.viewer.container.removeChild(measure);
  return result;
};

var createArcTo = function (x, y, xRadius, yRadius, relative, path) {

  path.push(relative ? 'a' : 'A');
  path.push(xRadius);
  path.push(yRadius);
  path.push(0);
  path.push(1);
  path.push(1);
  path.push(x);
  path.push(y);

  return path;
};

var createEllipsePath = function (x, y, w, h, relative, path) {

  var halfW = w * 0.5;
  var halfH = h * 0.5;

  path.push(relative ? 'm' : 'M');
  path.push(x);
  path.push(y);

  createArcTo(w, 0, halfW, halfH, true, path);
  createArcTo(-w, 0, halfW, halfH, true, path);

  path.push('z');
};

var createRectanglePath = function (x, y, w, h, relative, path) {

  path.push(relative ? 'm' : 'M');
  path.push(x);
  path.push(y);
  path.push('l');
  path.push(w);
  path.push(0);
  path.push('l');
  path.push(0);
  path.push(h);
  path.push('l');
  path.push(-w);
  path.push(0);
  path.push('z');
};

var renderToCanvas = function (svg, viewBox, width, height, ctx, callback) {

  const svgMarkup = svg.outerHTML;

  // Apply y-invert due to markups being defined in the LMV coordinate system. CSS is used here due to
  // poor Safari support: https://bugs.webkit.org/show_bug.cgi?id=201854
  const style = 'transform: scale(1, -1); transform-origin: center center';

  // Creating a new svg element, that will be drawn into the canvas.
  const tmpSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" style="${style}">
          ${svgMarkup}
        </svg>
        `;

  const blob = new Blob([tmpSvg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const img = new Image();

  img.onload = function () {
    ctx.drawImage(img, 0, 0);
    callback();
  };

  img.src = url;
};

/*
 Taken from Simplify.js, a high-performance JS polyline simplification library
 (c) 2013, Vladimir Agafonkin
 mourner.github.io/simplify-js
*/
var simplify = function (points, tolerance, highestQuality) {

  if (points.length <= 2) return points;

  // square distance between 2 points
  function getSqDist(p1, p2) {

    var dx = p1.x - p2.x,
      dy = p1.y - p2.y;

    return dx * dx + dy * dy;
  }

  // square distance from a point to a segment
  function getSqSegDist(p, p1, p2) {

    var x = p1.x,
      y = p1.y,
      dx = p2.x - x,
      dy = p2.y - y;

    if (dx !== 0 || dy !== 0) {

      var t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);

      if (t > 1) {
        x = p2.x;
        y = p2.y;

      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p.x - x;
    dy = p.y - y;

    return dx * dx + dy * dy;
  }
  // rest of the code doesn't care about point format

  // basic distance-based simplification
  function simplifyRadialDist(points, sqTolerance) {

    var prevPoint = points[0],
      newPoints = [prevPoint],
      point;

    for (var i = 1, len = points.length; i < len; i++) {
      point = points[i];

      if (getSqDist(point, prevPoint) > sqTolerance) {
        newPoints.push(point);
        prevPoint = point;
      }
    }

    if (prevPoint !== point) newPoints.push(point);

    return newPoints;
  }

  function simplifyDPStep(points, first, last, sqTolerance, simplified) {
    var maxSqDist = sqTolerance,
      index;

    for (var i = first + 1; i < last; i++) {
      var sqDist = getSqSegDist(points[i], points[first], points[last]);

      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  }

  // simplification using Ramer-Douglas-Peucker algorithm
  function simplifyDouglasPeucker(points, sqTolerance) {
    var last = points.length - 1;

    var simplified = [points[0]];
    simplifyDPStep(points, 0, last, sqTolerance, simplified);
    simplified.push(points[last]);

    return simplified;
  }

  // both algorithms combined for awesome performance
  var sqTolerance = tolerance !== undefined ? tolerance * tolerance : 1;

  points = highestQuality ? points : simplifyRadialDist(points, sqTolerance);
  points = simplifyDouglasPeucker(points, sqTolerance);

  return points;
};

/***/ },

/***/ "./extensions/Markup/core/StyleUtils.js"
/*!**********************************************!*\
  !*** ./extensions/Markup/core/StyleUtils.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   cloneStyle: () => (/* binding */ cloneStyle),
/* harmony export */   copyStyle: () => (/* binding */ copyStyle),
/* harmony export */   createStyle: () => (/* binding */ createStyle),
/* harmony export */   getStyleDefaultValues: () => (/* binding */ getStyleDefaultValues),
/* harmony export */   isStyleEqual: () => (/* binding */ isStyleEqual)
/* harmony export */ });

/**
 *
 * @param {*} attributes
 * @param {*} editor
 */
var createStyle = function (attributes, editor) {

  var style = {};

  for (var i = 0; i < attributes.length; ++i) {

    style[attributes[i]] = null;
  }

  var defaults = getStyleDefaultValues(style, editor);

  for (let i = 0; i < attributes.length; ++i) {

    var attribute = attributes[i];
    style[attribute] = defaults[attribute].values[defaults[attribute].default].value;
  }

  return style;
};

/**
 *
 * @param source
 * @param destination
 * @returns {*}
 */
var copyStyle = function (source, destination) {

  for (var attribute in destination) {
    if (Object.prototype.hasOwnProperty.call(source, attribute)) {
      destination[attribute] = source[attribute];
    }
  }

  return destination;
};

/**
 *
 * @param source
 * @param destination
 * @returns {*}
 */
var isStyleEqual = function (source, destination) {

  for (var attribute in destination) {
    if (Object.prototype.hasOwnProperty.call(source, attribute) && source[attribute] !== destination[attribute]) {
      return false;
    }
  }

  return true;
};

/**
 *
 * @param source
 * @returns {{}}
 */
var cloneStyle = function (source) {

  var clone = {};

  for (var attribute in source) {
    clone[attribute] = source[attribute];
  }

  return clone;
};

/**
 *
 * @param style
 * @param editor
 * @returns {{}}
 */
var getStyleDefaultValues = function (style, editor) {

  function getWidths(normalWidth) {

    return {
      values: [
      { name: 'Thin', value: normalWidth / 3 },
      { name: 'Normal', value: normalWidth },
      { name: 'Thick', value: normalWidth * 3 },
      { name: 'Very Thick', value: normalWidth * 9 }],
      default: 1
    };
  }

  function getLineJoins() {

    return {
      values: [
      { name: 'Miter', value: 'miter' },
      { name: 'Round', value: 'round' },
      { name: 'Bevel', value: 'bevel' }],
      default: 0
    };
  }

  function getFontSizes(normalWidth) {

    return {
      values: [
      { name: 'Thin', value: normalWidth / 2 },
      { name: 'Normal', value: normalWidth },
      { name: 'Thick', value: normalWidth * 4 }],
      default: 1
    };
  }

  function getColors() {

    return {
      values: [
      { name: 'red', value: '#ff0000' },
      { name: 'green', value: '#00ff00' },
      { name: 'blue', value: '#0000ff' },
      { name: 'white', value: '#ffffff' },
      { name: 'black', value: '#000000' },
      { name: 'yellow', value: '#ffff00' }],
      default: 0
    };
  }

  function getOpacities(defaultTransparent) {

    return {
      values: [
      { name: '100%', value: 1.00 },
      { name: '75%', value: 0.75 },
      { name: '50%', value: 0.50 },
      { name: '25%', value: 0.25 },
      { name: '0%', value: 0.00 }],
      default: defaultTransparent ? 4 : 0
    };
  }

  function getFontFamilies() {

    // TODO: Localize?
    // TODO: Validate fonts with design
    // Source: http://www.webdesigndev.com/web-development/16-gorgeous-web-safe-fonts-to-use-with-css
    return {
      values: [
      { name: 'Arial', value: 'Arial' },
      { name: 'Arial Black', value: 'Arial Black' },
      { name: 'Arial Narrow', value: 'Arial Narrow' },
      { name: 'Century Gothic', value: 'Century Gothic' },
      { name: 'Courier New', value: 'Courier New' },
      { name: 'Georgia', value: 'Georgia' },
      { name: 'Impact', value: 'Impact' },
      { name: 'Lucida Console', value: 'Lucida Console' },
      { name: 'Tahoma', value: 'Tahoma' },
      { name: 'Verdana', value: 'Verdana' }],

      default: 0
    };
  }

  function getFontStyles() {
    return {
      values: [
      { name: 'Normal', value: 'normal' },
      { name: 'Italic', value: 'italic' }],
      default: 0
    };
  }

  function getFontWeights() {
    return {
      values: [
      { name: 'Normal', value: 'normal' },
      { name: 'Bold', value: 'bold' }],
      default: 0 };
  }

  function getSvgString() {
    return {
      values: [
      {
        name: 'DefaultValue',
        value: '<svg height="100" width="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" /></svg>'
      }],

      default: 0
    };
  }

  var values = cloneStyle(style);
  var normaStrokeWidth = editor.getStrokeWidth();
  var normaFontWidth = editor.getFontWidth();

  for (var attribute in values) {

    switch (attribute) {
      case 'stroke-width':
        values[attribute] = getWidths(normaStrokeWidth);
        break;

      case 'stroke-linejoin':
        values[attribute] = getLineJoins();
        break;

      case 'font-size':
        values[attribute] = getFontSizes(normaFontWidth);
        break;

      case 'font-family':
        values[attribute] = getFontFamilies();
        break;

      case 'font-style':
        values[attribute] = getFontStyles();
        break;

      case 'font-weight':
        values[attribute] = getFontWeights();
        break;

      case 'stroke-color':
      case 'fill-color':
        values[attribute] = getColors();
        break;

      case 'stroke-opacity':{
          let defaultTransparent = false;
          values[attribute] = getOpacities(defaultTransparent);
          break;
        }

      case 'fill-opacity':{
          let defaultTransparent = true;
          values[attribute] = getOpacities(defaultTransparent);
          break;
        }

      case 'text-data':
        values[attribute] = getSvgString();
        break;

      default:
        break;
    }
  }

  return values;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CloneMarkup.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CloneMarkup.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CloneMarkup: () => (/* binding */ CloneMarkup)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param id
 * @param markup
 * @param position
 * @constructor
 */
function CloneMarkup(editor, id, markup, position) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CLONE-MARKUP', id);

  this.clone = markup.clone();
  this.clone.id = id;
  this.position = { x: position.x, y: position.y };
}

CloneMarkup.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CloneMarkup.prototype.constructor = CloneMarkup;

var proto = CloneMarkup.prototype;

proto.redo = function () {

  var editor = this.editor;
  var clone = this.clone;
  var position = this.position;

  if (editor.getMarkup(this.targetId)) {
    return;
  }

  var markup = clone.clone();
  markup.setPosition(position.x, position.y);

  editor.addMarkup(markup);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateArrow.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateArrow.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateArrow: () => (/* binding */ CreateArrow)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupArrow_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupArrow.js */ "./extensions/Markup/core/MarkupArrow.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 * @constructor
 */
function CreateArrow(editor, id, head, tail, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-ARROW', id);

  this.selectOnExecution = false;
  this.tail = tail;
  this.head = head;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateArrow.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateArrow.prototype.constructor = CreateArrow;

var proto = CreateArrow.prototype;

proto.redo = function () {

  var editor = this.editor;
  var arrow = new _MarkupArrow_js__WEBPACK_IMPORTED_MODULE_1__.MarkupArrow(this.targetId, editor);

  editor.addMarkup(arrow);

  // Confusing naming here. in arrow.set the first two numbers are
  // the point you drag from and the second two are the point you
  // drag to. So the head point is actually where the tail of the
  // arrow is positioned and the tail point is the head is positioned.

  //TODO: In MarkupArrow "set" function has tail x, tail y, head x, head y but used here in the opposite way
  arrow.set(this.head.x, this.head.y, this.tail.x, this.tail.y);
  arrow.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateCallout.js"
/*!**************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateCallout.js ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateCallout: () => (/* binding */ CreateCallout)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupCallout_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupCallout.js */ "./extensions/Markup/core/MarkupCallout.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param text
 * @param style
 * @constructor
 */
function CreateCallout(editor, id, position, size, text, style, isFrameUsed) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-CALLOUT', id);

  this.text = text;
  this.position = { x: position.x, y: position.y };
  this.size = { x: size.x, y: size.y };
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
  this.isFrameUsed = isFrameUsed;
}

CreateCallout.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateCallout.prototype.constructor = CreateCallout;

var proto = CreateCallout.prototype;

proto.redo = function () {

  var editor = this.editor;
  var position = this.position;
  var size = this.size;

  var callout = new _MarkupCallout_js__WEBPACK_IMPORTED_MODULE_1__.MarkupCallout(this.targetId, editor, size);

  editor.addMarkup(callout);

  callout.setIsFilledFrameUsed(this.isFrameUsed);
  callout.setText(this.text);
  callout.setSize(position, size.x, size.y);
  callout.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  if (markup) {
    this.editor.removeMarkup(markup);
    markup.destroy();
  }
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateCircle.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateCircle.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateCircle: () => (/* binding */ CreateCircle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupCircle_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupCircle.js */ "./extensions/Markup/core/MarkupCircle.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 * Markup create circle action.
 *
 * Implements an {@link Autodesk.Viewing.Extensions.Markups.Core.EditAction|EditAction}
 * for creating a Circle {@link Autodesk.Viewing.Extensions.Markups.Core.Markup|Markup}.
 * Included in documentation as an example of how to create
 * a specific EditAction that deals with Markup creation.
 * Developers are encourage to look into this class's source code and copy
 * as much code as they need. Find link to source code below.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 * @extends Autodesk.Viewing.Extensions.Markups.Core.EditAction
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param style
 */
function CreateCircle(editor, id, position, size, rotation, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-CIRCLE', id);

  this.selectOnExecution = false;
  this.position = { x: position.x, y: position.y };
  this.size = { x: size.x, y: size.y };
  this.rotation = rotation;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateCircle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateCircle.prototype.constructor = CreateCircle;

var proto = CreateCircle.prototype;

proto.redo = function () {

  var editor = this.editor;
  var circle = new _MarkupCircle_js__WEBPACK_IMPORTED_MODULE_1__.MarkupCircle(this.targetId, editor);

  editor.addMarkup(circle);

  circle.setSize(this.position, this.size.x, this.size.y);
  circle.setRotation(this.rotation);
  circle.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateCloud.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateCloud.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateCloud: () => (/* binding */ CreateCloud)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupCloud_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupCloud.js */ "./extensions/Markup/core/MarkupCloud.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param style
 * @constructor
 */
function CreateCloud(editor, id, position, size, rotation, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-CLOUD', id);

  this.selectOnExecution = false;
  this.position = { x: position.x, y: position.y };
  this.size = { x: size.x, y: size.y };
  this.rotation = rotation;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateCloud.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateCloud.prototype.constructor = CreateCloud;

var proto = CreateCloud.prototype;

proto.redo = function () {

  var editor = this.editor;
  var cloud = new _MarkupCloud_js__WEBPACK_IMPORTED_MODULE_1__.MarkupCloud(this.targetId, editor);

  editor.addMarkup(cloud);

  cloud.set(this.position, this.size);
  cloud.setRotation(this.rotation);
  cloud.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateDimension.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateDimension.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateDimension: () => (/* binding */ CreateDimension)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupDimension_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupDimension.js */ "./extensions/Markup/core/MarkupDimension.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 * @constructor
 */
function CreateDimension(editor, id, firstAnchor, secondAnchor, text, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-DIMENSION', id);

  this.selectOnExecution = false;
  this.secondAnchor = secondAnchor;
  this.firstAnchor = firstAnchor;
  this.text = text;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateDimension.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateDimension.prototype.constructor = CreateDimension;

var proto = CreateDimension.prototype;

proto.redo = function () {

  var editor = this.editor;
  var dimension = new _MarkupDimension_js__WEBPACK_IMPORTED_MODULE_1__.MarkupDimension(this.targetId, editor);

  editor.addMarkup(dimension);

  // Don't display the dimension markup when there is only one Anchor (First click, before mouse move).
  if (this.secondAnchor) {
    dimension.set(this.firstAnchor.x, this.firstAnchor.y, this.secondAnchor.x, this.secondAnchor.y, this.text);
    dimension.setStyle(this.style);
  }
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateFreehand.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateFreehand.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateFreehand: () => (/* binding */ CreateFreehand)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupFreehand_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupFreehand.js */ "./extensions/Markup/core/MarkupFreehand.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param locations
 * @param style
 * @constructor
 */
function CreateFreehand(editor, id, position, size, rotation, locations, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-FREEHAND', id);

  this.selectOnExecution = false;
  this.position = position;
  this.size = size;
  this.rotation = rotation;
  this.movements = locations.slice(0);
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateFreehand.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateFreehand.prototype.constructor = CreateFreehand;

var proto = CreateFreehand.prototype;

proto.redo = function () {

  var editor = this.editor;
  var freehand = new _MarkupFreehand_js__WEBPACK_IMPORTED_MODULE_1__.MarkupFreehand(this.targetId, editor);

  editor.addMarkup(freehand);

  freehand.set(this.position, this.size, this.movements, false);
  freehand.setRotation(this.rotation);
  freehand.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateHighlight.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateHighlight.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateHighlight: () => (/* binding */ CreateHighlight)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupHighlight_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupHighlight.js */ "./extensions/Markup/core/MarkupHighlight.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param locations
 * @param style
 * @constructor
 */
function CreateHighlight(editor, id, position, size, rotation, locations, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-HIGHLIGHT', id);

  this.selectOnExecution = false;
  this.position = position;
  this.size = size;
  this.rotation = rotation;
  this.movements = locations.slice(0);
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateHighlight.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateHighlight.prototype.constructor = CreateHighlight;

var proto = CreateHighlight.prototype;

proto.redo = function () {

  var editor = this.editor;
  var highlight = new _MarkupHighlight_js__WEBPACK_IMPORTED_MODULE_1__.MarkupHighlight(this.targetId, editor);

  editor.addMarkup(highlight);

  highlight.set(this.position, this.size, this.movements, false);
  highlight.setRotation(this.rotation);
  highlight.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreatePolycloud.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreatePolycloud.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreatePolycloud: () => (/* binding */ CreatePolycloud)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupPolycloud_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupPolycloud.js */ "./extensions/Markup/core/MarkupPolycloud.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param locations
 * @param closed
 * @param style
 * @constructor
 */
function CreatePolycloud(editor, id, position, size, rotation, locations, style, closed) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-POLYCLOUD', id);

  this.selectOnExecution = false;
  this.position = position;
  this.size = size;
  this.rotation = rotation;
  this.movements = locations.concat();
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
  this.closed = closed;
}

CreatePolycloud.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreatePolycloud.prototype.constructor = CreatePolycloud;

var proto = CreatePolycloud.prototype;

proto.redo = function () {

  var editor = this.editor;
  var polyline = new _MarkupPolycloud_js__WEBPACK_IMPORTED_MODULE_1__.MarkupPolycloud(this.targetId, editor);

  editor.addMarkup(polyline);

  polyline.set(this.position, this.size, this.movements, this.closed);
  polyline.setRotation(this.rotation);
  polyline.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreatePolyline.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreatePolyline.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreatePolyline: () => (/* binding */ CreatePolyline)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupPolyLine_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupPolyLine.js */ "./extensions/Markup/core/MarkupPolyLine.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param locations
 * @param closed
 * @param style
 * @constructor
 */
function CreatePolyline(editor, id, position, size, rotation, locations, style, closed) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-POLYLINE', id);

  this.selectOnExecution = false;
  this.position = position;
  this.size = size;
  this.rotation = rotation;
  this.movements = locations.concat();
  this.closed = closed;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreatePolyline.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreatePolyline.prototype.constructor = CreatePolyline;

var proto = CreatePolyline.prototype;

proto.redo = function () {

  var editor = this.editor;
  var polyline = new _MarkupPolyLine_js__WEBPACK_IMPORTED_MODULE_1__.MarkupPolyline(this.targetId, editor);

  editor.addMarkup(polyline);

  polyline.set(this.position, this.size, this.movements, this.closed);
  polyline.setRotation(this.rotation);
  polyline.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateRectangle.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateRectangle.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateRectangle: () => (/* binding */ CreateRectangle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupRectangle_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupRectangle.js */ "./extensions/Markup/core/MarkupRectangle.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param rotation
 * @param style
 * @constructor
 */
function CreateRectangle(editor, id, position, size, rotation, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-RECTANGLE', id);

  this.selectOnExecution = false;
  this.position = { x: position.x, y: position.y };
  this.size = { x: size.x, y: size.y };
  this.rotation = rotation;
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateRectangle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateRectangle.prototype.constructor = CreateRectangle;

var proto = CreateRectangle.prototype;

proto.redo = function () {

  var editor = this.editor;
  var rectangle = new _MarkupRectangle_js__WEBPACK_IMPORTED_MODULE_1__.MarkupRectangle(this.targetId, editor);

  editor.addMarkup(rectangle);

  rectangle.set(this.position, this.size);
  rectangle.setRotation(this.rotation);
  rectangle.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && this.editor.removeMarkup(markup);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateStamp.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateStamp.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateStamp: () => (/* binding */ CreateStamp)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupStamp_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupStamp.js */ "./extensions/Markup/core/MarkupStamp.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");








/**
 * @constructor
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param style
 * @param {string} svg
 */

class CreateStamp extends _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction {
  constructor(editor, id, position, size, rotation, style, svgData) {
    super(editor, 'CREATE-STAMP', id);

    this.selectOnExecution = false;
    this.position = { x: position.x, y: position.y };
    this.size = { x: size.x, y: size.y };
    this.rotation = rotation;
    this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
    this.svgData = svgData;
  }

  redo() {
    const stamp = new _MarkupStamp_js__WEBPACK_IMPORTED_MODULE_1__.MarkupStamp(this.targetId, this.editor, this.svgData);

    this.editor.addMarkup(stamp);

    stamp.setSize(this.position, this.size.x, this.size.y);
    stamp.setRotation(this.rotation);
    stamp.setStyle(this.style);
  }

  undo() {
    const markup = this.editor.getMarkup(this.targetId);
    this.editor.removeMarkup(markup);
  }
}

/***/ },

/***/ "./extensions/Markup/core/edit-actions/CreateText.js"
/*!***********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/CreateText.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CreateText: () => (/* binding */ CreateText)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _MarkupText_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupText.js */ "./extensions/Markup/core/MarkupText.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");






/**
 *
 * @param editor
 * @param id
 * @param position
 * @param size
 * @param text
 * @param style
 * @constructor
 */
function CreateText(editor, id, position, size, text, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'CREATE-TEXT', id);

  this.text = text;
  this.position = { x: position.x, y: position.y };
  this.size = { x: size.x, y: size.y };
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
}

CreateText.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
CreateText.prototype.constructor = CreateText;

var proto = CreateText.prototype;

proto.redo = function () {

  var editor = this.editor;
  var position = this.position;
  var size = this.size;

  var text = new _MarkupText_js__WEBPACK_IMPORTED_MODULE_1__.MarkupText(this.targetId, editor, size);

  editor.addMarkup(text);

  text.set(position, size, this.text);
  text.setStyle(this.style);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  if (markup) {
    this.editor.removeMarkup(markup);
    markup.destroy();
  }
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteArrow.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteArrow.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteArrow: () => (/* binding */ DeleteArrow)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateArrow_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateArrow.js */ "./extensions/Markup/core/edit-actions/CreateArrow.js");





/**
 *
 * @param editor
 * @param arrow
 * @constructor
 */
function DeleteArrow(editor, arrow) {

  // Confusing naming here. Arrow.tail is the starting point of the arrow,
  // and arrow.head is the final point. In CreateArrow the head argument
  // is the first point of the arrow and the tail argument is the second
  // point of the argument. So construct CreateArrow with the tail before
  // the head.
  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-ARROW', arrow.id);
  this.createArrow = new _CreateArrow_js__WEBPACK_IMPORTED_MODULE_1__.CreateArrow(
    editor,
    arrow.id,
    arrow.tail,
    arrow.head,
    arrow.getStyle());
}

DeleteArrow.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteArrow.prototype.constructor = DeleteArrow;

var proto = DeleteArrow.prototype;

proto.redo = function () {

  this.createArrow.undo();
};

proto.undo = function () {

  this.createArrow.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteCallout.js"
/*!**************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteCallout.js ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteCallout: () => (/* binding */ DeleteCallout)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateCallout_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateCallout.js */ "./extensions/Markup/core/edit-actions/CreateCallout.js");





/**
 *
 * @param editor
 * @param text
 * @constructor
 */
function DeleteCallout(editor, callout) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-CALLOUT', callout.id);

  var position = { x: callout.position.x, y: callout.position.y };
  var size = { x: callout.size.x, y: callout.size.y };

  this.createCallout = new _CreateCallout_js__WEBPACK_IMPORTED_MODULE_1__.CreateCallout(
    editor,
    callout.id,
    position,
    size,
    callout.getText(),
    callout.getStyle(),
    callout.isFrameUsed);
}

DeleteCallout.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteCallout.prototype.constructor = DeleteCallout;

var proto = DeleteCallout.prototype;

proto.redo = function () {

  this.createCallout.undo();
};

proto.undo = function () {

  this.createCallout.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteCircle.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteCircle.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteCircle: () => (/* binding */ DeleteCircle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateCircle_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateCircle.js */ "./extensions/Markup/core/edit-actions/CreateCircle.js");





/**
 * Markup delete circle action.
 *
 * Implements an {@link Autodesk.Viewing.Extensions.Markups.Core.EditAction|EditAction}
 * for deleting a Circle {@link Autodesk.Viewing.Extensions.Markups.Core.Markup|Markup}.
 * Included in documentation as an example of how to create
 * a specific EditAction that deals with Markup deletion.
 * Developers are encourage to look into this class's source code and copy
 * as much code as they need. Find link to source code below.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 * @extends Autodesk.Viewing.Extensions.Markups.Core.EditAction
 *
 * @param editor
 * @param circle
 */
function DeleteCircle(editor, circle) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-CIRCLE', circle.id);
  this.createCircle = new _CreateCircle_js__WEBPACK_IMPORTED_MODULE_1__.CreateCircle(
    editor,
    circle.id,
    circle.position,
    circle.size,
    circle.rotation,
    circle.getStyle());
}

DeleteCircle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteCircle.prototype.constructor = DeleteCircle;

var proto = DeleteCircle.prototype;

proto.redo = function () {

  this.createCircle.undo();
};

proto.undo = function () {

  this.createCircle.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteCloud.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteCloud.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteCloud: () => (/* binding */ DeleteCloud)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateCloud_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateCloud.js */ "./extensions/Markup/core/edit-actions/CreateCloud.js");





/**
 *
 * @param editor
 * @param cloud
 * @constructor
 */
function DeleteCloud(editor, cloud) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-CLOUD', cloud.id);
  this.createCloud = new _CreateCloud_js__WEBPACK_IMPORTED_MODULE_1__.CreateCloud(
    editor,
    cloud.id,
    cloud.position,
    cloud.size,
    cloud.rotation,
    cloud.getStyle());
}

DeleteCloud.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteCloud.prototype.constructor = DeleteCloud;

var proto = DeleteCloud.prototype;

proto.redo = function () {

  this.createCloud.undo();
};

proto.undo = function () {

  this.createCloud.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteDimension.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteDimension.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteDimension: () => (/* binding */ DeleteDimension)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateDimension_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateDimension.js */ "./extensions/Markup/core/edit-actions/CreateDimension.js");





/**
 *
 * @param editor
 * @param dimension
 * @constructor
 */
function DeleteDimension(editor, dimension) {

  // Confusing naming here. Dimension.secondAnchor is the starting point of the dimension,
  // and dimension.firstAnchor is the final point. In CreateDimension the firstAnchor argument
  // is the first point of the dimension and the secondAnchor argument is the second
  // point of the argument. So construct CreateDimension with the secondAnchor before
  // the firstAnchor.
  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-DIMENSION', dimension.id);
  this.createDimension = new _CreateDimension_js__WEBPACK_IMPORTED_MODULE_1__.CreateDimension(
    editor,
    dimension.id,
    dimension.secondAnchor,
    dimension.firstAnchor,
    dimension.currentText,
    dimension.getStyle());
}

DeleteDimension.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteDimension.prototype.constructor = DeleteDimension;

var proto = DeleteDimension.prototype;

proto.redo = function () {

  this.createDimension.undo();
};

proto.undo = function () {

  this.createDimension.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteFreehand.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteFreehand.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteFreehand: () => (/* binding */ DeleteFreehand)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateFreehand_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateFreehand.js */ "./extensions/Markup/core/edit-actions/CreateFreehand.js");





/**
 *
 * @param editor
 * @param freehand
 * @constructor
 */
function DeleteFreehand(editor, freehand) {
  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-FREEHAND', freehand.id);
  this.createFreehand = new _CreateFreehand_js__WEBPACK_IMPORTED_MODULE_1__.CreateFreehand(
    editor,
    freehand.id,
    freehand.position,
    freehand.size,
    freehand.rotation,
    freehand.locations,
    freehand.getStyle());
}

DeleteFreehand.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteFreehand.prototype.constructor = DeleteFreehand;

var proto = DeleteFreehand.prototype;

proto.redo = function () {

  this.createFreehand.undo();
};

proto.undo = function () {

  this.createFreehand.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteHighlight.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteHighlight.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteHighlight: () => (/* binding */ DeleteHighlight)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateHighlight_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateHighlight.js */ "./extensions/Markup/core/edit-actions/CreateHighlight.js");





/**
 *
 * @param editor
 * @param highlight
 * @constructor
 */
function DeleteHighlight(editor, highlight) {
  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-HIGHLIGHT', highlight.id);
  this.createHighlight = new _CreateHighlight_js__WEBPACK_IMPORTED_MODULE_1__.CreateHighlight(
    editor,
    highlight.id,
    highlight.position,
    highlight.size,
    highlight.rotation,
    highlight.locations,
    highlight.getStyle());
}

DeleteHighlight.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteHighlight.prototype.constructor = DeleteHighlight;

var proto = DeleteHighlight.prototype;

proto.redo = function () {

  this.createHighlight.undo();
};

proto.undo = function () {

  this.createHighlight.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeletePolycloud.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeletePolycloud.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeletePolycloud: () => (/* binding */ DeletePolycloud)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreatePolycloud.js */ "./extensions/Markup/core/edit-actions/CreatePolycloud.js");





/**
 *
 * @param editor
 * @param polycloud
 * @constructor
 */
function DeletePolycloud(editor, polycloud) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-POLYCLOUD', polycloud.id);
  this.createPolycloud = new _CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_1__.CreatePolycloud(
    editor,
    polycloud.id,
    polycloud.position,
    polycloud.size,
    polycloud.rotation,
    polycloud.locations,
    polycloud.getStyle(),
    polycloud.closed);
}

DeletePolycloud.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeletePolycloud.prototype.constructor = DeletePolycloud;

var proto = DeletePolycloud.prototype;

proto.redo = function () {

  this.createPolycloud.undo();
};

proto.undo = function () {

  this.createPolycloud.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeletePolyline.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeletePolyline.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeletePolyline: () => (/* binding */ DeletePolyline)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreatePolyline_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreatePolyline.js */ "./extensions/Markup/core/edit-actions/CreatePolyline.js");





/**
 *
 * @param editor
 * @param polyline
 * @constructor
 */
function DeletePolyline(editor, polyline) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-POLYLINE', polyline.id);
  this.createPolyline = new _CreatePolyline_js__WEBPACK_IMPORTED_MODULE_1__.CreatePolyline(
    editor,
    polyline.id,
    polyline.position,
    polyline.size,
    polyline.rotation,
    polyline.locations,
    polyline.getStyle(),
    polyline.closed);
}

DeletePolyline.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeletePolyline.prototype.constructor = DeletePolyline;

var proto = DeletePolyline.prototype;

proto.redo = function () {

  this.createPolyline.undo();
};

proto.undo = function () {

  this.createPolyline.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteRectangle.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteRectangle.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteRectangle: () => (/* binding */ DeleteRectangle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateRectangle_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateRectangle.js */ "./extensions/Markup/core/edit-actions/CreateRectangle.js");





/**
 *
 * @param editor
 * @param rectangle
 * @constructor
 */
var DeleteRectangle = function (editor, rectangle) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-RECTANGLE', rectangle.id);
  this.createRectangle = new _CreateRectangle_js__WEBPACK_IMPORTED_MODULE_1__.CreateRectangle(
    editor,
    rectangle.id,
    rectangle.position,
    rectangle.size,
    rectangle.rotation,
    rectangle.getStyle());
};

DeleteRectangle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteRectangle.prototype.constructor = DeleteRectangle;

var proto = DeleteRectangle.prototype;

proto.redo = function () {

  this.createRectangle.undo();
};

proto.undo = function () {

  this.createRectangle.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteStamp.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteStamp.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteStamp: () => (/* binding */ DeleteStamp)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateStamp_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateStamp.js */ "./extensions/Markup/core/edit-actions/CreateStamp.js");







class DeleteStamp extends _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction {
  constructor(editor, stamp) {
    super(editor, 'DELETE-STAMP', stamp.id);

    this.createStamp = new _CreateStamp_js__WEBPACK_IMPORTED_MODULE_1__.CreateStamp(
      editor,
      stamp.id,
      stamp.position,
      stamp.size,
      stamp.rotation,
      stamp.getStyle()
    );
  }

  redo() {
    this.createStamp.undo();
  }

  undo() {
    this.createStamp.redo();
  }
}

/***/ },

/***/ "./extensions/Markup/core/edit-actions/DeleteText.js"
/*!***********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/DeleteText.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DeleteText: () => (/* binding */ DeleteText)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _CreateText_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CreateText.js */ "./extensions/Markup/core/edit-actions/CreateText.js");





/**
 *
 * @param editor
 * @param text
 * @constructor
 */
function DeleteText(editor, text) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'DELETE-TEXT', text.id);

  var position = { x: text.position.x, y: text.position.y };
  var size = { x: text.size.x, y: text.size.y };

  this.createText = new _CreateText_js__WEBPACK_IMPORTED_MODULE_1__.CreateText(
    editor,
    text.id,
    position,
    size,
    text.getText(),
    text.getStyle());
}

DeleteText.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
DeleteText.prototype.constructor = DeleteText;

var proto = DeleteText.prototype;

proto.redo = function () {

  this.createText.undo();
};

proto.undo = function () {

  this.createText.redo();
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/EditAction.js"
/*!***********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/EditAction.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditAction: () => (/* binding */ EditAction)
/* harmony export */ });


/**
 * Base class for all markup edit actions.
 *
 * EditActions encapsulate {@link Autodesk.Viewing.Extensions.Markups.Core.Markup|Markup}
 * operations (such as creation, edition and deletion) that hook into the undo/redo system.
 *
 * The minimum set of methods to implement on an EditAction extension are:
 * - execute()
 * - undo()
 * - redo()
 *
 * A good set of classes to check their implementation are:
 * {@link Autodesk.Viewing.Extensions.Markups.Core.CreateCircle|CreateCircle}.
 * {@link Autodesk.Viewing.Extensions.Markups.Core.DeleteCircle|DeleteCircle}.
 * {@link Autodesk.Viewing.Extensions.Markups.Core.SetCircle|SetCircle}.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 *
 * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore} editor
 * @param {String} type - An identifier for the EditAction.
 * @param {number} targetId - The id of the markup being affected.
 */
function EditAction(editor, type, targetId) {

  this.type = type;
  this.editor = editor;
  this.targetId = targetId;
  this.addToHistory = true;
  this.selectOnExecution = true;
}

/**
 * Performs the action.
 */
EditAction.prototype.execute = function () {

  this.editor.actionManager.execute(this);
};

/**
 * @abstract
 */
EditAction.prototype.redo = function () {

};

/**
 * @abstract
 */
EditAction.prototype.undo = function () {

};

/**
 * Provides a mechanism to merge consecutive actions of the same type.
 * @param {Autodesk.Viewing.Extensions.Markups.Core.EditAction} action - Action to check if it can be merged with 'this'.
 * @returns {boolean} Returns true if merge has been applied. Parameter will be discarded.
 */
EditAction.prototype.merge = function (action) {

  return false;
};

/**
 * Provides a mechanism to check whether the action yields no results.
 * @returns {boolean} Returns true if no changes happen with this action.
 */
EditAction.prototype.isIdentity = function () {

  return false;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/EditActionGroup.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/EditActionGroup.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditActionGroup: () => (/* binding */ EditActionGroup)
/* harmony export */ });


/**
 * This class will group actions edit actions that should be executed as a whole.
 * When a group is open actions can be added to it, similar actions will be merged into one during this process.
 * This class is not intended to be used by users, it's a helper class of EditActionManager.
 * @constructor
 */
function EditActionGroup() {

  this.actions = [];
  this.closed = true;
}

var proto = EditActionGroup.prototype;

/**
 *
 * @returns {boolean}
 */
proto.open = function () {

  if (!this.closed) {
    return false;
  }

  this.closed = false;
  return true;
};

/**
 *
 * @returns {boolean}
 */
proto.close = function () {

  if (this.closed) {
    return false;
  }

  this.closed = true;
  return true;
};

/**
 *
 * @returns {number} targetId
 */
proto.undo = function () {

  var actions = this.actions;
  var actionsMaxIndex = actions.length - 1;

  var targetId = -1;
  for (var i = actionsMaxIndex; i >= 0; --i) {

    var action = actions[i];
    action.undo();

    if (action.targetId !== -1) {
      targetId = action.targetId;
    }
  }

  return targetId;
};

/**
 *
 * @returns {number} targetId
 */
proto.redo = function () {

  var actions = this.actions;
  var actionsCount = actions.length;

  var targetId = -1;
  for (var i = 0; i < actionsCount; ++i) {

    var action = actions[i];
    action.redo();

    if (action.targetId !== -1) {
      targetId = action.targetId;
    }
  }

  return targetId;
};

/**
 *
 * @returns {boolean}
 */
proto.isOpen = function () {

  return !this.closed;
};

/**
 *
 * @returns {boolean}
 */
proto.isClosed = function () {

  return this.closed;
};

/**
 *
 * @returns {boolean}
 */
proto.isEmpty = function () {

  return this.actions.length === 0;
};

/**
 *
 * @param {EditAction} action
 */
proto.addAction = function (action) {

  if (this.closed) {
    return false;
  }

  this.actions.push(action);
  this.compact();

  return true;
};

/**
 * @private
 */
proto.compact = function () {

  var actions = this.actions;
  var actionsCount = actions.length;

  for (var i = 0; i < actionsCount; ++i) {

    // If an action does nothing, remove it.
    var actionA = actions[i];
    if (actionA.isIdentity()) {
      actions.splice(i, 1);
      --actionsCount;
      --i;
      continue;
    }

    // If an action can be merged, merge it.
    for (var j = i + 1; j < actionsCount; ++j) {

      var actionB = actions[j];
      if (actionA.type === actionB.type &&
      actionA.merge(actionB)) {
        actions.splice(j, 1);
        --actionsCount;
        --i;
        break;
      }
    }
  }
};

proto.getTargetId = function () {
  var actions = this.actions;
  var actionsCount = actions.length;
  var targetId = -1;
  for (var i = 0; i < actionsCount; ++i) {
    var action = actions[i];
    if (action.targetId !== -1) {
      targetId = action.targetId;
    }
  }
  return targetId;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/EditActionManager.js"
/*!******************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/EditActionManager.js ***!
  \******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditActionManager: () => (/* binding */ EditActionManager)
/* harmony export */ });
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _EditActionGroup_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./EditActionGroup.js */ "./extensions/Markup/core/edit-actions/EditActionGroup.js");






/**
 *
 * @param historySize
 * @constructor
 */
function EditActionManager(historySize) {

  this.historySize = historySize;

  this.undoStack = [];
  this.redoStack = [];

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.addTraitEventDispatcher)(this);
}

var proto = EditActionManager.prototype;

/**
 *
 * @param action
 */
proto.execute = function (action) {

  var redoStack = this.redoStack;
  var undoStack = this.undoStack;

  redoStack.splice(0, redoStack.length);

  action.redo();

  var group = this.getEditActionGroup();
  if (group.isOpen()) {
    group.addAction(action);
  } else {
    group.open();
    group.addAction(action);
    group.close();
  }

  if (undoStack.length > this.historySize) {
    undoStack.splice(0, 1);
  }

  var targetId = action.selectOnExecution ? action.targetId : -1;
  this.dispatchEvent(
    { type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_HISTORY_CHANGED, data: { action: 'execute', targetId: targetId } });
};

proto.beginActionGroup = function () {

  var undoStack = this.undoStack;
  var undoStackCount = undoStack.length;
  var group = null;

  if (undoStackCount === 0 || undoStack[undoStackCount - 1].isClosed()) {

    group = this.getEditActionGroup();
    group.open();
  } else {
    console.warn('Markups - Undo/Redo - Action edit group already open.');
  }
};

proto.closeActionGroup = function () {

  var undoStack = this.undoStack;
  var undoStackCount = undoStack.length;

  if (undoStackCount === 0) {

    console.warn('Markups - Undo/Redo - There is no action edit group to close.');
    return;
  }

  var group = undoStack[undoStackCount - 1];
  if (!group.close()) {
    console.warn('Markups - Undo/Redo - Action edit group already closed.');
  }

  if (group.isEmpty()) {
    undoStack.pop();
  }
};

proto.cancelActionGroup = function () {

  var undoStack = this.undoStack;
  var undoStackCount = undoStack.length;

  if (undoStackCount === 0) {

    console.warn('Markups - Undo/Redo - There is no action edit group to close.');
    return;
  }

  var group = undoStack[undoStackCount - 1];
  if (!group.close()) {
    console.warn('Markups - Undo/Redo - Action edit group already closed.');
    return;
  }

  group.undo();
  undoStack.pop();

  this.dispatchEvent(
    { type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_HISTORY_CHANGED, data: { action: 'cancel', targetId: -1 } });
};

proto.undo = function () {

  var undoStack = this.undoStack;
  var redoStack = this.redoStack;

  if (undoStack.length === 0) {
    return;
  }

  var group = undoStack.pop();
  var targetId = group.undo();

  redoStack.push(group);

  this.dispatchEvent(
    { type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_HISTORY_CHANGED, data: { action: 'undo', targetId: targetId } });
};

proto.redo = function () {

  var undoStack = this.undoStack;
  var redoStack = this.redoStack;

  if (redoStack.length === 0) {
    return;
  }

  var group = redoStack.pop();
  var targetId = group.redo();

  undoStack.push(group);

  this.dispatchEvent(
    { type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_HISTORY_CHANGED, data: { action: 'redo', targetId: targetId } });
};

proto.clear = function () {

  this.undoStack.splice(0, this.undoStack.length);
  this.redoStack.splice(0, this.redoStack.length);

  this.dispatchEvent(
    { type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_HISTORY_CHANGED, data: { action: 'clear', targetId: -1 } });
};

proto.isUndoStackEmpty = function () {

  return this.undoStack.length === 0;
};

proto.isRedoStackEmpty = function () {

  return this.redoStack.length === 0;
};

proto.getLastElementInUndoStack = function () {

  var undoStack = this.undoStack;
  var undoStackCount = undoStack.length;
  return undoStack[undoStackCount - 1];
};

/**
 *
 * @return action
 * @private
 */
proto.getEditActionGroup = function () {

  var undoStack = this.undoStack;
  var undoStackCount = this.undoStack.length;

  var group = null;

  if (undoStackCount === 0 || undoStack[undoStackCount - 1].isClosed()) {
    group = new _EditActionGroup_js__WEBPACK_IMPORTED_MODULE_2__.EditActionGroup();
    undoStack.push(group);
  } else {
    group = undoStack[undoStackCount - 1];
  }

  return group;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetArrow.js"
/*!*********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetArrow.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetArrow: () => (/* binding */ SetArrow)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param arrow
 * @param head
 * @param tail
 * @constructor
 */
function SetArrow(editor, arrow, head, tail) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-ARROW', arrow.id);

  this.newHead = { x: head.x, y: head.y };
  this.newTail = { x: tail.x, y: tail.y };
  this.oldHead = { x: arrow.head.x, y: arrow.head.y };
  this.oldTail = { x: arrow.tail.x, y: arrow.tail.y };
}

SetArrow.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetArrow.prototype.constructor = SetArrow;

var proto = SetArrow.prototype;

proto.redo = function () {

  this.applyState(this.targetId, this.newHead, this.newTail);
};

proto.undo = function () {

  this.applyState(this.targetId, this.oldHead, this.oldTail);
};

proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newHead = action.newHead;
    this.newTail = action.newTail;
    return true;
  }
  return false;
};

/**
 *
 * @private
 */
proto.applyState = function (targetId, head, tail) {

  var arrow = this.editor.getMarkup(targetId);
  if (!arrow) {
    return;
  }

  // Different stroke widths make positions differ at sub-pixel level.
  var epsilon = 0.0001;

  if (Math.abs(arrow.head.x - head.x) >= epsilon || Math.abs(arrow.head.y - head.y) >= epsilon ||
  Math.abs(arrow.tail.x - tail.x) >= epsilon || Math.abs(arrow.tail.y - tail.y) >= epsilon) {

    // Confusing naming here. in arrow.set the first two numbers are
    // the point you drag from and the second two are the point you
    // drag to. So the head point is actually where the tail of the
    // arrow is positioned and the tail point is the head is positioned.
    arrow.set(head.x, head.y, tail.x, tail.y);
  }
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return (
    this.newHead.x === this.oldHead.x &&
    this.newHead.y === this.oldHead.y &&
    this.newTail.x === this.oldTail.x &&
    this.newTail.y === this.oldTail.y);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetCallout.js"
/*!***********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetCallout.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetCallout: () => (/* binding */ SetCallout)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param markup
 * @param position
 * @param size
 * @param text
 * @constructor
 */
function SetCallout(editor, markup, position, size, text, isFrameUsed) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-CALLOUT', markup.id);

  this.newPosition = { x: position.x, y: position.y };
  this.oldPosition = { x: markup.position.x, y: markup.position.y };
  this.newSize = { x: size.x, y: size.y };
  this.oldSize = { x: markup.size.x, y: markup.size.y };
  this.newText = text;
  this.oldText = markup.getText();
  this.newIsFrameUsed = isFrameUsed;
  this.oldIsFrameUsed = markup.isFrameUsed;
}

SetCallout.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetCallout.prototype.constructor = SetCallout;

var proto = SetCallout.prototype;

proto.redo = function () {

  var callout = this.editor.getMarkup(this.targetId);
  callout && callout.set(this.newPosition, this.newSize, this.newText, this.newIsFrameUsed);
};

proto.undo = function () {

  var callout = this.editor.getMarkup(this.targetId);
  callout && callout.set(this.oldPosition, this.oldSize, this.oldText, this.oldIsFrameUsed);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetCircle.js"
/*!**********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetCircle.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetCircle: () => (/* binding */ SetCircle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 * Markup set circle action.
 *
 * Implements an {@link Autodesk.Viewing.Extensions.Markups.Core.EditAction|EditAction}
 * for editing properties of a Circle {@link Autodesk.Viewing.Extensions.Markups.Core.Markup|Markup}.
 * Included in documentation as an example of how to create
 * a specific EditAction that deals with Markup edition.
 * Developers are encourage to look into this class's source code and copy
 * as much code as they need. Find link to source code below.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 * @extends Autodesk.Viewing.Extensions.Markups.Core.EditAction
 *
 * @param editor
 * @param circle
 * @param position
 * @param size
 */
function SetCircle(editor, circle, position, size) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-CIRCLE', circle.id);

  this.newPosition = { x: position.x, y: position.y };
  this.newSize = { x: size.x, y: size.y };
  this.oldPosition = { x: circle.position.x, y: circle.position.y };
  this.oldSize = { x: circle.size.x, y: circle.size.y };
}

SetCircle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetCircle.prototype.constructor = SetCircle;

var proto = SetCircle.prototype;

proto.redo = function () {

  this.applyState(this.targetId, this.newPosition, this.newSize);
};

proto.undo = function () {

  this.applyState(this.targetId, this.oldPosition, this.oldSize);
};

proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newPosition = action.newPosition;
    this.newSize = action.newSize;
    return true;
  }
  return false;
};

/**
 *
 * @private
 */
proto.applyState = function (targetId, position, size) {

  var circle = this.editor.getMarkup(targetId);
  if (!circle) {
    return;
  }

  // Different stroke widths make positions differ at sub-pixel level.
  var epsilon = 0.0001;

  if (Math.abs(circle.position.x - position.x) > epsilon || Math.abs(circle.size.y - size.y) > epsilon ||
  Math.abs(circle.position.y - position.y) > epsilon || Math.abs(circle.size.y - size.y) > epsilon) {

    circle.set(position, size);
  }
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return (
    this.newPosition.x === this.oldPosition.x &&
    this.newPosition.y === this.oldPosition.y &&
    this.newSize.x === this.oldSize.x &&
    this.newSize.y === this.oldSize.y);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetCloud.js"
/*!*********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetCloud.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetCloud: () => (/* binding */ SetCloud)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param cloud
 * @param position
 * @param size
 * @constructor
 */
function SetCloud(editor, cloud, position, size) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-CLOUD', cloud.id);

  this.newPosition = { x: position.x, y: position.y };
  this.newSize = { x: size.x, y: size.y };
  this.oldPosition = { x: cloud.position.x, y: cloud.position.y };
  this.oldSize = { x: cloud.size.x, y: cloud.size.y };
}

SetCloud.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetCloud.prototype.constructor = SetCloud;

var proto = SetCloud.prototype;

proto.redo = function () {

  this.applyState(this.targetId, this.newPosition, this.newSize, this.newStrokeWidth, this.newColor);
};

proto.undo = function () {

  this.applyState(this.targetId, this.oldPosition, this.oldSize, this.oldStrokeWidth, this.oldColor);
};

proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newPosition = action.newPosition;
    this.newSize = action.newSize;
    return true;
  }
  return false;
};

/**
 *
 * @private
 */
proto.applyState = function (targetId, position, size) {

  var cloud = this.editor.getMarkup(targetId);
  if (!cloud) {
    return;
  }

  // Different stroke widths make positions differ at sub-pixel level.
  var epsilon = 0.0001;

  if (Math.abs(cloud.position.x - position.x) > epsilon || Math.abs(cloud.size.y - size.y) > epsilon ||
  Math.abs(cloud.position.y - position.y) > epsilon || Math.abs(cloud.size.y - size.y) > epsilon) {

    cloud.set(position, size);
  }
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return (
    this.newPosition.x === this.oldPosition.x &&
    this.newPosition.y === this.oldPosition.y &&
    this.newSize.x === this.oldSize.x &&
    this.newSize.y === this.oldSize.y);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetDimension.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetDimension.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetDimension: () => (/* binding */ SetDimension)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param dimension
 * @param firstAnchor
 * @param secondAnchor
 * @constructor
 */
function SetDimension(editor, dimension, firstAnchor, secondAnchor, text) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-DIMENSION', dimension.id);

  this.newFirstAnchor = { x: firstAnchor.x, y: firstAnchor.y };
  this.newSecondAnchor = { x: secondAnchor.x, y: secondAnchor.y };
  this.oldFirstAnchor = { x: dimension.firstAnchor.x, y: dimension.firstAnchor.y };
  this.oldSecondAnchor = { x: dimension.secondAnchor.x, y: dimension.secondAnchor.y };
  this.newText = text;
  this.oldText = dimension.currentText;
}

SetDimension.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetDimension.prototype.constructor = SetDimension;

var proto = SetDimension.prototype;

proto.redo = function () {

  this.applyState(this.newFirstAnchor, this.newSecondAnchor, this.newText);

};

proto.undo = function () {

  this.applyState(this.oldFirstAnchor, this.oldSecondAnchor, this.oldText);

};

proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newFirstAnchor = action.newFirstAnchor;
    this.newSecondAnchor = action.newSecondAnchor;
    this.newText = action.newText;
    return true;
  }
  return false;
};

/**
 *
 * @private
 */
proto.applyState = function (firstAnchor, secondAnchor, text) {

  var dimension = this.editor.getMarkup(this.targetId);

  if (!dimension) {
    return;
  }

  dimension.set(firstAnchor.x, firstAnchor.y, secondAnchor.x, secondAnchor.y, text);

};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return this.newText === this.oldText && (
  !this.newFirstAnchor || !this.newSecondAnchor ||
  this.newFirstAnchor.x === this.oldFirstAnchor.x &&
  this.newFirstAnchor.y === this.oldFirstAnchor.y &&
  this.newSecondAnchor.x === this.oldSecondAnchor.x &&
  this.newSecondAnchor.y === this.oldSecondAnchor.y);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetFreehand.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetFreehand.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetFreehand: () => (/* binding */ SetFreehand)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param freehand
 * @param position
 * @param size
 * @param locations
 * @constructor
 */
function SetFreehand(editor, freehand, position, size, locations, isAbsoluteCoords) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-FREEHAND', freehand.id);

  this.position = position;
  this.size = size;
  this.locations = isAbsoluteCoords ? locations : locations.slice(0);
  this.isAbsoluteCoords = isAbsoluteCoords;

  // No need to save old data
}

SetFreehand.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetFreehand.prototype.constructor = SetFreehand;

var proto = SetFreehand.prototype;

proto.redo = function () {

  var freehand = this.editor.getMarkup(this.targetId);
  if (!freehand) {
    return;
  }

  freehand.set(this.position, this.size, this.locations, this.isAbsoluteCoords);
};

proto.undo = function () {

  // No need for undo.
};
proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.locations = action.isAbsoluteCoords ? action.locations : action.locations.slice(0);
    this.position = action.position;
    this.size = action.size;
    this.isAbsoluteCoords = action.isAbsoluteCoords;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return false; // No need to optimize, always false.
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetHighlight.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetHighlight.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetHighlight: () => (/* binding */ SetHighlight)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param highlight
 * @param position
 * @param size
 * @param locations
 * @constructor
 */
function SetHighlight(editor, highlight, position, size, locations, isAbsoluteCoords) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-HIGHLIGHT', highlight.id);

  this.position = position;
  this.size = size;
  this.locations = isAbsoluteCoords ? locations : locations.slice(0);
  this.isAbsoluteCoords = isAbsoluteCoords;

  // No need to save old data
}

SetHighlight.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetHighlight.prototype.constructor = SetHighlight;

var proto = SetHighlight.prototype;

proto.redo = function () {

  var highlight = this.editor.getMarkup(this.targetId);
  if (!highlight) {
    return;
  }

  highlight.set(this.position, this.size, this.locations, this.isAbsoluteCoords);
};

proto.undo = function () {

  // No need for undo.
};
proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.locations = action.isAbsoluteCoords ? action.locations : action.locations.slice(0);
    this.position = action.position;
    this.size = action.size;
    this.isAbsoluteCoords = action.isAbsoluteCoords;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return false; // No need to optimize, always false.
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetPolycloud.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetPolycloud.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetPolycloud: () => (/* binding */ SetPolycloud)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param polycloud
 * @param position
 * @param size
 * @param locations
 * @param closed
 * @constructor
 */
function SetPolycloud(editor, polycloud, position, size, locations, closed) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-POLYCLOUD', polycloud.id);

  this.position = position;
  this.size = size;
  this.locations = locations.concat();
  this.closed = closed;

  // No need to save old data
}

SetPolycloud.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetPolycloud.prototype.constructor = SetPolycloud;

var proto = SetPolycloud.prototype;

proto.redo = function () {

  var polycloud = this.editor.getMarkup(this.targetId);
  if (!polycloud) {
    return;
  }

  polycloud.set(this.position, this.size, this.locations, this.closed);
};

proto.undo = function () {

  // No need for undo.
};
proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.locations = action.locations.concat();
    this.position = action.position;
    this.size = action.size;
    this.closed = action.closed;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return false; // No need to optimize, always false.
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetPolyline.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetPolyline.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetPolyline: () => (/* binding */ SetPolyline)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param polyline
 * @param position
 * @param size
 * @param locations
 * @param closed
 * @constructor
 */
function SetPolyline(editor, polyline, position, size, locations, closed) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-POLYLINE', polyline.id);

  this.position = position;
  this.size = size;
  this.locations = locations.concat();
  this.closed = closed;

  // No need to save old data
}

SetPolyline.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetPolyline.prototype.constructor = SetPolyline;

var proto = SetPolyline.prototype;

proto.redo = function () {

  var polyline = this.editor.getMarkup(this.targetId);
  if (!polyline) {
    return;
  }

  polyline.set(this.position, this.size, this.locations, this.closed);
};

proto.undo = function () {

  // No need for undo.
};
proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.locations = action.locations.concat();
    this.position = action.position;
    this.size = action.size;
    this.closed = action.closed;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return false; // No need to optimize, always false.
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetPosition.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetPosition.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetPosition: () => (/* binding */ SetPosition)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




function SetPosition(editor, markup, position) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-POSITION', markup.id);

  this.newPosition = { x: position.x, y: position.y };
  this.oldPosition = { x: markup.position.x, y: markup.position.y };
}

SetPosition.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetPosition.prototype.constructor = SetPosition;

var proto = SetPosition.prototype;

proto.redo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setPosition(this.newPosition.x, this.newPosition.y);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setPosition(this.oldPosition.x, this.oldPosition.y);
};

/**
 *
 * @param action
 * @returns {boolean}
 */
proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newPosition = action.newPosition;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  var newPosition = this.newPosition;
  var oldPosition = this.oldPosition;

  return newPosition.x === oldPosition.x && newPosition.y === oldPosition.y;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetRectangle.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetRectangle.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetRectangle: () => (/* binding */ SetRectangle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param rectangle
 * @param position
 * @param size
 * @constructor
 */
function SetRectangle(editor, rectangle, position, size) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-RECTANGLE', rectangle.id);

  this.newPosition = { x: position.x, y: position.y };
  this.newSize = { x: size.x, y: size.y };
  this.oldPosition = { x: rectangle.position.x, y: rectangle.position.y };
  this.oldSize = { x: rectangle.size.x, y: rectangle.size.y };
}

SetRectangle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetRectangle.prototype.constructor = SetRectangle;

var proto = SetRectangle.prototype;

proto.redo = function () {

  this.applyState(this.targetId, this.newPosition, this.newSize);
};

proto.undo = function () {

  this.applyState(this.targetId, this.oldPosition, this.oldSize);
};

proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newPosition = action.newPosition;
    this.newSize = action.newSize;
    return true;
  }
  return false;
};

/**
 *
 * @private
 */
proto.applyState = function (targetId, position, size) {

  var rectangle = this.editor.getMarkup(targetId);
  if (!rectangle) {
    return;
  }

  // Different stroke widths make positions differ at sub-pixel level.
  var epsilon = 0.0001;

  if (Math.abs(rectangle.position.x - position.x) > epsilon || Math.abs(rectangle.size.y - size.y) > epsilon ||
  Math.abs(rectangle.position.y - position.y) > epsilon || Math.abs(rectangle.size.y - size.y) > epsilon) {

    rectangle.set(position, size);
  }
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return (
    this.newPosition.x === this.oldPosition.x &&
    this.newPosition.y === this.oldPosition.y &&
    this.newSize.x === this.oldSize.x &&
    this.newSize.y === this.oldSize.y);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetRotation.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetRotation.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetRotation: () => (/* binding */ SetRotation)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param markup
 * @param angle
 * @constructor
 */
function SetRotation(editor, markup, angle) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-ROTATION', markup.id);

  var curAngle = markup.getRotation();

  this.newRotation = { angle: angle };
  this.oldRotation = { angle: curAngle };
}

SetRotation.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetRotation.prototype.constructor = SetRotation;

var proto = SetRotation.prototype;

proto.redo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setRotation(this.newRotation.angle);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setRotation(this.oldRotation.angle);
};

/**
 *
 * @param action
 * @returns {boolean}
 */
proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newRotation = action.newRotation;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  return this.newRotation.angle === this.oldRotation.angle;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetSize.js"
/*!********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetSize.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetSize: () => (/* binding */ SetSize)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param markup
 * @param position
 * @param width
 * @param height
 * @constructor
 */
function SetSize(editor, markup, position, width, height) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-SIZE', markup.id);

  this.newPosition = { x: position.x, y: position.y };
  this.oldPosition = { x: markup.position.x, y: markup.position.y };
  this.newWidth = width;
  this.oldWidth = markup.size.x;
  this.newHeight = height;
  this.oldHeight = markup.size.y;
}

SetSize.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetSize.prototype.constructor = SetSize;

var proto = SetSize.prototype;

proto.redo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setSize(this.newPosition, this.newWidth, this.newHeight);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setSize(this.oldPosition, this.oldWidth, this.oldHeight);
};

proto.merge = function (action) {

  if (this.targetId === action.targetId &&
  this.type === action.type) {

    this.newPosition = action.newPosition;
    this.newWidth = action.newWidth;
    this.newHeight = action.newHeight;
    return true;
  }
  return false;
};

/**
 * @returns {boolean}
 */
proto.isIdentity = function () {

  var identity =
  this.newPosition.x === this.oldPosition.x &&
  this.newPosition.y === this.oldPosition.y &&
  this.newWidth === this.oldWidth &&
  this.newHeight === this.oldHeight;

  return identity;
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetStamp.js"
/*!*********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetStamp.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetStamp: () => (/* binding */ SetStamp)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");






class SetStamp extends _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction {
  constructor(editor, stamp, position, size) {
    super(editor, 'SET-STAMP', stamp.id);

    this.newPosition = { x: position.x, y: position.y };
    this.newSize = { x: size.x, y: size.y };
    this.oldPosition = { x: stamp.position.x, y: stamp.position.y };
    this.oldSize = { x: stamp.size.x, y: stamp.size.y };
  }

  redo() {
    this.applyState(this.targetId, this.newPosition, this.newSize);
  }

  undo() {
    this.applyState(this.targetId, this.oldPosition, this.oldSize);
  }

  merge(action) {
    if (this.targetId === action.targetId && this.type === action.type) {
      this.newPosition = action.newPosition;
      this.newSize = action.newSize;
      return true;
    }

    return false;
  }

  applyState(targetId, position, size) {
    const stamp = this.editor.getMarkup(targetId);
    if (!stamp) {
      return;
    }

    // Different stroke widths make positions differ at sub-pixel level.
    const epsilon = 0.0001;
    if (
    Math.abs(stamp.position.x - position.x) > epsilon ||
    Math.abs(stamp.position.y - position.y) > epsilon ||
    Math.abs(stamp.size.x - size.x) > epsilon ||
    Math.abs(stamp.size.y - size.y) > epsilon)
    {
      stamp.set(position, size);
    }
  }

  isIdentity() {
    return (
      this.newPosition.x === this.oldPosition.x &&
      this.newPosition.y === this.oldPosition.y &&
      this.newSize.x === this.oldSize.x &&
      this.newSize.y === this.newSize.y);

  }
}

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetStyle.js"
/*!*********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetStyle.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetStyle: () => (/* binding */ SetStyle)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");





/**
 *
 * @param editor
 * @param markup
 * @param style
 * @constructor
 */
function SetStyle(editor, markup, style) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-STYLE', markup.id);

  this.newStyle = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.cloneStyle)(style);
  this.oldStyle = markup.getStyle();
}

SetStyle.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetStyle.prototype.constructor = SetStyle;

var proto = SetStyle.prototype;

proto.redo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setStyle(this.newStyle);
};

proto.undo = function () {

  var markup = this.editor.getMarkup(this.targetId);
  markup && markup.setStyle(this.oldStyle);
};

/***/ },

/***/ "./extensions/Markup/core/edit-actions/SetText.js"
/*!********************************************************!*\
  !*** ./extensions/Markup/core/edit-actions/SetText.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SetText: () => (/* binding */ SetText)
/* harmony export */ });
/* harmony import */ var _EditAction_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");




/**
 *
 * @param editor
 * @param markup
 * @param position
 * @param size
 * @param text
 * @constructor
 */
function SetText(editor, markup, position, size, text) {

  _EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.call(this, editor, 'SET-TEXT', markup.id);

  this.newPosition = { x: position.x, y: position.y };
  this.oldPosition = { x: markup.position.x, y: markup.position.y };
  this.newSize = { x: size.x, y: size.y };
  this.oldSize = { x: markup.size.x, y: markup.size.y };
  this.newText = text;
  this.oldText = markup.getText();
}

SetText.prototype = Object.create(_EditAction_js__WEBPACK_IMPORTED_MODULE_0__.EditAction.prototype);
SetText.prototype.constructor = SetText;

var proto = SetText.prototype;

proto.redo = function () {

  var text = this.editor.getMarkup(this.targetId);
  text && text.set(this.newPosition, this.newSize, this.newText);
};

proto.undo = function () {

  var text = this.editor.getMarkup(this.targetId);
  text && text.set(this.oldPosition, this.oldSize, this.oldText);
};

/***/ },

/***/ "./extensions/Markup/core/edit-clipboard/Clipboard.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-clipboard/Clipboard.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Clipboard: () => (/* binding */ Clipboard)
/* harmony export */ });
/* harmony import */ var _edit_actions_CloneMarkup_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../edit-actions/CloneMarkup.js */ "./extensions/Markup/core/edit-actions/CloneMarkup.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");





/**
 *
 * @param editor
 * @constructor
 */
function Clipboard(editor) {

  this.editor = editor;
  this.content = null;
  this.pastePosition = { x: 0, y: 0 };

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.addTraitEventDispatcher)(this);
}

var proto = Clipboard.prototype;

proto.copy = function () {

  var selectedMarkup = this.editor.getSelection();
  if (!selectedMarkup) {
    return;
  }

  this.content = selectedMarkup.clone();
  this.pastePosition.x = selectedMarkup.position.x;
  this.pastePosition.y = selectedMarkup.position.y;
};

proto.cut = function () {

  var selectedMarkup = this.editor.getSelection();
  if (!selectedMarkup) {
    return;
  }

  this.copy();
  this.editor.deleteMarkup(selectedMarkup);
};

proto.paste = function () {

  var content = this.content;
  if (!content) {
    return;
  }

  var editor = this.editor;
  var position = this.pastePosition;
  var delta = editor.sizeFromClientToMarkups(20, 20);

  position.x += delta.x;
  position.y -= delta.y;

  var cloneMarkup = new _edit_actions_CloneMarkup_js__WEBPACK_IMPORTED_MODULE_0__.CloneMarkup(editor, editor.getId(), content, position);
  cloneMarkup.execute();
};

/***/ },

/***/ "./extensions/Markup/core/edit-input/InputHandler.js"
/*!***********************************************************!*\
  !*** ./extensions/Markup/core/edit-input/InputHandler.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   InputHandler: () => (/* binding */ InputHandler)
/* harmony export */ });
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");




var av = Autodesk.Viewing;
var avp = av.Private;

var _mouseEnabled = false;
var _mousePrevValue = false;
var _lock = false;

function InputHandler() {

  this.editor = null;
  this.mousePosition = { x: 0, y: 0 };
  this.makeSameXY = false; // TODO: FIND a better way to name and communicate these.
  this.snapRotations = false;
  this.keepAspectRatio = false;
  this.constrainAxis = false;
  this.duringEditMode = false;

  this.onWheelBinded = this.onWheel.bind(this);
  this.onTouchDragBinded = this.onTouchDrag.bind(this);
  this.onTouchPanBinded = this.onTouchPan.bind(this);
  this.onTouchPinchBinded = this.onTouchPinch.bind(this);
  this.onSingleTapBinded = this.onSingleTap.bind(this);
  this.onDoubleTapBinded = this.onDoubleTap.bind(this);
  this.onMouseMoveBinded = this.onMouseMove.bind(this);
  this.onMouseUpBinded = this.onMouseUp.bind(this);
  this.onMouseDownBinded = this.onMouseDown.bind(this);
  this.onMouseDoubleClickBinded = this.onMouseDoubleClick.bind(this);
  this.onHammerInputBinded = this.onHammerInput.bind(this);
  this.isMouseDown = false;
}

av.GlobalManagerMixin.call(InputHandler.prototype);
var proto = InputHandler.prototype;

proto.attachTo = function (editor) {

  this.editor && this.detachFrom(this.editor);
  this.editor = editor;

  if ((0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_0__.isTouchDevice)()) {

    this.hammer = new av.Hammer.Manager(editor.svg, {
      recognizers: [
      av.GestureRecognizers.drag,
      av.GestureRecognizers.doubletap,
      av.GestureRecognizers.doubletap2,
      av.GestureRecognizers.singletap,
      av.GestureRecognizers.singletap2,
      av.GestureRecognizers.press,
      av.GestureRecognizers.pan,
      av.GestureRecognizers.pinch],

      handlePointerEventMouse: false,
      inputClass: av.Hammer.TouchInput
    });

    this.hammer.get('doubletap2').recognizeWith('doubletap');
    this.hammer.get('singletap2').recognizeWith('singletap');
    this.hammer.get('singletap').requireFailure('doubletap');
  }
};

proto.onHammerInput = function (event) {

  this.setMouseDisabledWhenTouching(event);
};

proto.setMouseDisabledWhenTouching = function (event) {

  if (event.isFirst && !_lock) {
    this.enableMouseButtons(false);
    _lock = true;
  } else if (event.isFinal) {
    var _this = this;
    setTimeout(function () {
      _this.enableMouseButtons(_mousePrevValue);
      _lock = false;
    }, 10);
  }
};

proto.enableMouseButtons = function (state) {

  if (state && !_mouseEnabled)
  {
    this.editor.svg.addEventListener('mousedown', this.onMouseDownBinded);
    this.editor.svg.addEventListener('dblclick', this.onMouseDoubleClickBinded);
    this.editor.svg.addEventListener('wheel', this.onWheelBinded);
    this.editor.svg.addEventListener('DOMMouseScroll', this.onWheelBinded); // Firefox

    // The mouseup and mousemove listeners are at the document level to handle the case where
    // mouse was held inside the canvas and released outside.
    // When this happens, we don't want the editing to be in a hung state and cancel it
    this.addDocumentEventListener('mousemove', this.onMouseMoveBinded);
    this.addDocumentEventListener('mouseup', this.onMouseUpBinded);
  } else
  if (!state && _mouseEnabled)
  {
    this.editor.svg.removeEventListener('mousedown', this.onMouseDownBinded);
    this.editor.svg.removeEventListener('dblclick', this.onMouseDoubleClickBinded);
    this.editor.svg.removeEventListener('wheel', this.onWheelBinded);
    this.editor.svg.removeEventListener('DOMMouseScroll', this.onWheelBinded);
    this.removeDocumentEventListener('mousemove', this.onMouseMoveBinded);
    this.removeDocumentEventListener('mouseup', this.onMouseUpBinded);

  }

  _mousePrevValue = _mouseEnabled;
  _mouseEnabled = state;
};

proto.detachFrom = function (editor) {

  this.hammer && this.hammer.destroy();

  this.removeDocumentEventListener('mousemove', this.onMouseMoveBinded);
  this.removeDocumentEventListener('mouseup', this.onMouseUpBinded);

  if (this.editor) {
    this.editor.svg.removeEventListener('mousedown', this.onMouseDownBinded);
    this.editor.svg.removeEventListener('dblclick', this.onMouseDoubleClickBinded);
  }

  this.editor = editor;
};

proto.enterEditMode = function () {
  if (this.duringEditMode) {
    return;
  }

  if (this.hammer) {
    this.hammer.on('dragstart dragmove dragend', this.onTouchDragBinded);
    this.hammer.on('panstart panmove panend', this.onTouchPanBinded);
    this.hammer.on('pinchstart pinchmove pinchend', this.onTouchPinchBinded);
    this.hammer.on('singletap', this.onSingleTapBinded);
    this.hammer.on('singletap2', this.onSingleTapBinded);
    this.hammer.on('doubletap', this.onDoubleTapBinded);
    this.hammer.on('doubletap2', this.onDoubleTapBinded);
    this.hammer.on('hammer.input', this.onHammerInputBinded);

    this.hammer.get('drag').requireFailure('pinch');
    this.hammer.get('drag').requireFailure('pan');
  }

  if (!av.isMobileDevice()) {
    this.enableMouseButtons(true);
  }

  this.duringEditMode = true;
};

proto.leaveEditMode = function () {
  if (!this.duringEditMode) {
    return;
  }

  if (this.hammer) {
    this.hammer.off('dragstart dragmove dragend', this.onTouchDragBinded);
    this.hammer.off('panstart panmove panend', this.onTouchPanBinded);
    this.hammer.off('pinchstart pinchmove pinchend', this.onTouchPinchBinded);
    this.hammer.off('singletap', this.onSingleTapBinded);
    this.hammer.off('singletap2', this.onSingleTapBinded);
    this.hammer.off('doubletap', this.onDoubleTapBinded);
    this.hammer.off('doubletap2', this.onDoubleTapBinded);
    this.hammer.off('hammer.input', this.onHammerInputBinded);
  }

  if (!av.isMobileDevice()) {
    this.enableMouseButtons(false);
  }

  this.duringEditMode = false;
};

proto.enterViewMode = function () {

};

proto.leaveViewMode = function () {

};

proto.getMousePosition = function () {

  return { x: this.mousePosition.x, y: this.mousePosition.y };
};

proto.onWheel = function (event) {

  if (!av.isMobileDevice()) {
    this.editor.viewer.toolController.mousewheel(event);
  }

  event.preventDefault();
};

proto.onMouseMove = function (event) {

  processMouseEvent(this, event);

  if (!av.isMobileDevice() && this.editor.viewer.container.contains(event.target)) {
    this.editor.viewer.toolController.mousemove(event);
  }

  if (this.editor.onMouseMove(event)) {
    // editor handled the event
    event.preventDefault();
  }
};


proto.onMouseDownRightClick = function (event) {

  const _document = this.getDocument();
  _document.activeElement && _document.activeElement.blur && _document.activeElement.blur();

  var controller = this.editor.viewer.toolController;
  controller.__clientToCanvasCoords(event);

  this.editor.markupTool.handleButtonDown(event, 2);
};

proto.onMouseUpRightClick = function (event) {

  var controller = this.editor.viewer.toolController;
  controller.__clientToCanvasCoords(event);

  this.editor.markupTool.handleButtonUp(event, 2);
};

proto.onMouseDown = function (event) {

  processMouseEvent(this, event);

  // Panning when right clicking
  if (!av.isMobileDevice() && (avp.isRightClick(event, this.editor.viewer.navigation) || avp.isMiddleClick(event))) {
    this.onMouseDownRightClick(event);
    return;
  }

  this.isMouseDown = true;
  this.editor.onMouseDown(event);
  event.preventDefault();
};

proto.onMouseUp = function (event) {

  processMouseEvent(this, event);

  if (!av.isMobileDevice() && this.editor.viewer.container.contains(event.target) && (
  avp.isRightClick(event, this.editor.viewer.navigation) || avp.isMiddleClick(event)))
  {
    this.onMouseUpRightClick(event);
    return;
  }

  this.isMouseDown = false;
  if (this.editor.onMouseUp(event)) {
    // editor handled the event
    event.preventDefault();
  }
};

proto.onMouseDoubleClick = function (event) {

  processMouseEvent(this, event);
  this.editor.onMouseDoubleClick(event);
  event.preventDefault();
};

proto.onTouchDrag = function (event) {

  convertEventHammerToMouse(event);
  switch (event.type) {
    case 'dragstart':
      this.onMouseDown(event);
      break;
    case 'dragmove':
      this.onMouseMove(event);
      break;
    case 'dragend':
      this.onMouseUp(event);
      break;
  }
  event.preventDefault();
};

proto.onTouchPan = function (event) {

  var gestureHandler = this.editor.viewer.toolController.getTool("gestures");
  gestureHandler.distributeGesture(event);
  event.preventDefault();
};

proto.onTouchPinch = function (event) {

  processMouseEvent(this, event);

  var gestureHandler = this.editor.viewer.toolController.getTool("gestures");
  gestureHandler.distributeGesture(event);

  this.mousePosition.x = this.mousePosition.y = null;
  this.editor.callSnapperMouseMove();

  event.preventDefault();
};

proto.onSingleTap = function (event) {

  convertEventHammerToMouse(event);

  this.onMouseDown(event);
  this.onMouseUp(event);
  event.preventDefault();
};

proto.onDoubleTap = function (event) {

  convertEventHammerToMouse(event);
  this.onMouseDoubleClick(event);
  event.preventDefault();
};

function processMouseEvent(input, event) {

  var rect = input.editor.svg.getBoundingClientRect();

  input.makeSameXY = event.shiftKey;
  input.snapRotations = event.shiftKey;
  input.keepAspectRatio = event.shiftKey;
  input.constrainAxis = event.shiftKey;

  input.mousePosition.x = event.clientX - rect.left;
  input.mousePosition.y = event.clientY - rect.top;
}

function convertEventHammerToMouse(event) {

  // Convert Hammer touch-event X,Y into mouse-event X,Y.
  event.shiftKey = false;
  event.clientX = event.pointers[0].clientX;
  event.clientY = event.pointers[0].clientY;
}

/***/ },

/***/ "./extensions/Markup/core/edit-modes/BuiltinEditModes.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/BuiltinEditModes.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../EditModeManager.js */ "./extensions/Markup/core/EditModeManager.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _EditModeArrow_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./EditModeArrow.js */ "./extensions/Markup/core/edit-modes/EditModeArrow.js");
/* harmony import */ var _EditModeText_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./EditModeText.js */ "./extensions/Markup/core/edit-modes/EditModeText.js");
/* harmony import */ var _EditModeRectangle_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./EditModeRectangle.js */ "./extensions/Markup/core/edit-modes/EditModeRectangle.js");
/* harmony import */ var _EditModeCircle_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./EditModeCircle.js */ "./extensions/Markup/core/edit-modes/EditModeCircle.js");
/* harmony import */ var _EditModeCloud_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./EditModeCloud.js */ "./extensions/Markup/core/edit-modes/EditModeCloud.js");
/* harmony import */ var _EditModeFreehand_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./EditModeFreehand.js */ "./extensions/Markup/core/edit-modes/EditModeFreehand.js");
/* harmony import */ var _EditModeHighlight_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./EditModeHighlight.js */ "./extensions/Markup/core/edit-modes/EditModeHighlight.js");
/* harmony import */ var _EditModePolyline_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./EditModePolyline.js */ "./extensions/Markup/core/edit-modes/EditModePolyline.js");
/* harmony import */ var _EditModePolycloud_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./EditModePolycloud.js */ "./extensions/Markup/core/edit-modes/EditModePolycloud.js");
/* harmony import */ var _EditModeCallout_js__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./EditModeCallout.js */ "./extensions/Markup/core/edit-modes/EditModeCallout.js");
/* harmony import */ var _EditModeDimension_js__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./EditModeDimension.js */ "./extensions/Markup/core/edit-modes/EditModeDimension.js");
/* harmony import */ var _EditModeStamp_js__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ./EditModeStamp.js */ "./extensions/Markup/core/edit-modes/EditModeStamp.js");


















_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_ARROW, _EditModeArrow_js__WEBPACK_IMPORTED_MODULE_2__.EditModeArrow);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_TEXT, _EditModeText_js__WEBPACK_IMPORTED_MODULE_3__.EditModeText);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_RECTANGLE, _EditModeRectangle_js__WEBPACK_IMPORTED_MODULE_4__.EditModeRectangle);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_CIRCLE, _EditModeCircle_js__WEBPACK_IMPORTED_MODULE_5__.EditModeCircle);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_CLOUD, _EditModeCloud_js__WEBPACK_IMPORTED_MODULE_6__.EditModeCloud);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_FREEHAND, _EditModeFreehand_js__WEBPACK_IMPORTED_MODULE_7__.EditModeFreehand);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_HIGHLIGHT, _EditModeHighlight_js__WEBPACK_IMPORTED_MODULE_8__.EditModeHighlight);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_POLYLINE, _EditModePolyline_js__WEBPACK_IMPORTED_MODULE_9__.EditModePolyline);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_POLYCLOUD, _EditModePolycloud_js__WEBPACK_IMPORTED_MODULE_10__.EditModePolycloud);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_CALLOUT, _EditModeCallout_js__WEBPACK_IMPORTED_MODULE_11__.EditModeCallout);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_DIMENSION, _EditModeDimension_js__WEBPACK_IMPORTED_MODULE_12__.EditModeDimension);
_EditModeManager_js__WEBPACK_IMPORTED_MODULE_0__.theEditModeManager.register(_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_1__.MARKUP_TYPE_STAMP, _EditModeStamp_js__WEBPACK_IMPORTED_MODULE_13__.EditModeStamp);

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditMode.js"
/*!*******************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditMode.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditMode: () => (/* binding */ EditMode)
/* harmony export */ });
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetStyle.js */ "./extensions/Markup/core/edit-actions/SetStyle.js");







const av = Autodesk.Viewing;

/**
 * Base class for all markup edit modes.
 *
 * An EditMode is responsible for handling user input to create and edit a
 * {@link Autodesk.Viewing.Extensions.Markups.Core.Markup|Markup}.
 *
 * Any class extending Markup should contain at least the following methods:
 * - deleteMarkup()
 * - onMouseDown()
 * - onMouseMove()
 *
 * A good reference is the Circle EditMode implementation available in
 * {@link Autodesk.Viewing.Extensions.Markups.Core.EditModeCircle|EditModeCircle}.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 *
 * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore} editor - Markups extension.
 * @param {String} type - An identifier for the EditMode type. Not to be confused by the Markup's id.
 * @param {Array} styleAttributes - Attributes for customization.
 * @constructor
 */
function EditMode(editor, type, styleAttributes) {

  this.editor = editor;
  this.viewer = editor.viewer;
  this.setGlobalManager(this.viewer.globalManager);
  this.type = type;
  this.selectedMarkup = null;
  this.dragging = false;
  this.draggingAnnotationIniPosition = null;
  this.draggingMouseIniPosition = new THREE.Vector2();
  this.initialX = 0;
  this.initialY = 0;
  this.minSize = 9; // In pixels
  this.creating = false;
  this.size = { x: 0, y: 0 };
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.createStyle)(styleAttributes, this.editor);
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_1__.copyStyle)(editor.getDefaultStyle(), this.style);

  this.CREATION_METHOD_DRAG = 'CREATION_METHOD_DRAG';
  this.CREATION_METHOD_CLICK = 'CREATION_METHOD_CLICK';
  this.CREATION_METHOD_CLICKS = 'CREATION_METHOD_CLICKS';
  this.creationMethod = this.CREATION_METHOD_DRAG;

  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.addTraitEventDispatcher)(this);
}

av.GlobalManagerMixin.call(EditMode.prototype);
var proto = EditMode.prototype;

proto.destroy = function () {

  this.unselect();
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.removeTraitEventDispatcher)(this);
};

proto.unselect = function () {

  var fireEv = false;
  var selectedMarkup = this.selectedMarkup;
  var selectedId = null;

  if (selectedMarkup) {
    selectedId = selectedMarkup.id;
    selectedMarkup.unselect();
    this.selectedMarkup = null;
    fireEv = true;
  }

  this.editor.editFrame.setMarkup(null);

  if (fireEv) {
    this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_0__.EVENT_MARKUP_DESELECT, markupId: selectedId });
  }
};

proto.creationBegin = function () {

  if (this.creating) {
    return;
  }

  this.creating = true;
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_0__.EVENT_EDITMODE_CREATION_BEGIN });
};

proto.creationEnd = function (isCancelling) {

  if (!this.creating) {
    return false;
  }

  if (this.creationMethod !== this.CREATION_METHOD_CLICK) {

    if (this.selectedMarkup && !this.isMinSizeValid()) {

      this.creationCancel();
      isCancelling = true;
    } else {

      if (this.creationMethod === this.CREATION_METHOD_DRAG) {
        this.finishDragging();
      }

      if (this.selectedMarkup) {

        // Opened on mouse down.
        this.editor.closeActionGroup();
        this.selectedMarkup = null;
      }
    }
  }

  this.creating = false;
  this.dispatchEvent({ type: _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_0__.EVENT_EDITMODE_CREATION_END, creationCancelled: !!isCancelling });
  return true;
};

proto.creationCancel = function () {

  this.editor.cancelActionGroup();
  this.creationEnd(true);
  this.selectedMarkup = null; // No need to call unselect
};

/**
 *
 * @param style
 */
proto.setStyle = function (style) {

  this.style = style;

  var selectedMarkup = this.selectedMarkup;
  if (!selectedMarkup) {
    return;
  }

  var setStyle = new _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_3__.SetStyle(this.editor, selectedMarkup, style);
  setStyle.execute();
};

proto.getStyle = function () {

  return this.style;
};

proto.setSelection = function (markup) {

  if (this.selectedMarkup !== markup) {
    this.unselect();
    markup && markup.select();
  }

  this.selectedMarkup = markup;

  var editor = this.editor;
  markup && editor.bringToFront(markup);

  if (this.isTextInputHelperActive() && editor.editFrame.markup) {
    this.textInputHelper.setEditFrame();
  } else if (!this.creating) {
    editor.editFrame.setMarkup(markup);
  }
};

proto.getSelection = function () {

  return this.selectedMarkup;
};

/**
 *
 * @param [markup] If provided deletes markup (has to have same type that the edit mode), otherwise deletes selected one.
 * @param [cantUndo] If true to not add deletion to undo history.
 * @returns {boolean}
 */
proto.deleteMarkup = function (markup, cantUndo) {

  return false;
};

/**
 * Used by classes extending EditMode to validate the minimum size (in screen coordinates) of the markup.
 * See minSize attribute
 * @return {Boolean} Whether current size is valid for creating the markup
 * @private
 */
proto.isMinSizeValid = function () {

  if (this.minSize !== 0) {

    var tmp = this.editor.sizeFromMarkupsToClient(this.size.x, this.size.y);
    return tmp.x * tmp.x + tmp.y * tmp.y >= this.minSize * this.minSize;

  }
  return true;
};

/**
 * @private
 */
proto.startDragging = function () {

  var selectedMarkup = this.selectedMarkup;
  var mousePosition = this.editor.getMousePosition();

  if (selectedMarkup) {

    this.dragging = true;
    this.draggingAnnotationIniPosition = selectedMarkup.getClientPosition();
    this.draggingMouseIniPosition.set(mousePosition.x, mousePosition.y);
  }
};

/**
 * @private
 */
proto.finishDragging = function () {

  var dragging = this.dragging;
  var selectedMarkup = this.selectedMarkup;

  this.dragging = false;

  if (selectedMarkup && dragging) {

    selectedMarkup.finishDragging();
  }
};

/**
 *
 * @returns {{x: number, y: number}}
 */
proto.getFinalMouseDraggingPosition = function () {

  var editor = this.editor;
  var bounds = editor.getBounds();
  var mousePosition = editor.getMousePosition();

  var initialX = this.initialX;
  var initialY = this.initialY;

  var finalX = Math.min(Math.max(bounds.x, mousePosition.x), bounds.x + bounds.width);
  var finalY = Math.min(Math.max(bounds.y, mousePosition.y), bounds.y + bounds.height);

  if (finalX == initialX &&
  finalY == initialY) {
    finalX++;
    finalY++;
  }

  // Make equal x/y when shift is down
  if (editor.input.makeSameXY) {
    var dx = Math.abs(finalX - initialX);
    var dy = Math.abs(finalY - initialY);

    var maxDelta = Math.max(dx, dy);

    // These calculations have the opportunity to go beyond 'bounds'.
    finalX = initialX + maxDelta * (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.sign)(finalX - initialX);
    finalY = initialY + maxDelta * (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_2__.sign)(finalY - initialY);
  }

  return { x: finalX, y: finalY };
};

proto.notifyAllowNavigation = function (allows) {

};

proto.onMouseMove = function (event) {
  if (!this.selectedMarkup || !this.creating) {
    return false;
  }
  return true;
};

proto.onMouseDown = function () {

};

/**
 * Handler to mouse up events, used to start annotations creation.
 * It will cancel the creation of a markup if its minSize conditions are not met.
 *
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseUp = function (event) {

  if (this.creationMethod !== this.CREATION_METHOD_DRAG) {
    return false;
  }

  return this.creationEnd();
};

proto.onMouseDoubleClick = function (event) {

  if (this.creationMethod !== this.CREATION_METHOD_CLICKS) {
    return;
  }

  this.creationEnd();
};

/**
 * Notify the markup that the displayed markups are being saved so edit mode can finish current editions.
 */
proto.onSave = function () {

  if (this.creating) {
    this.creationCancel();
  }
};

/**
 *
 * @returns {{x: *, y: *}}
 */
proto.getDraggingPosition = function () {

  var mousePosition = this.editor.getMousePosition();

  var dx = mousePosition.x - this.draggingMouseIniPosition.x;
  var dy = mousePosition.y - this.draggingMouseIniPosition.y;

  return {
    x: this.draggingAnnotationIniPosition.x + dx,
    y: this.draggingAnnotationIniPosition.y + dy
  };
};

/**
 *
 * @param x
 * @param y
 * @param bounds
 * @returns {boolean}
 * @orivate
 */
proto.isInsideBounds = function (x, y, bounds) {

  return x >= bounds.x && x <= bounds.x + bounds.width &&
  y >= bounds.y && y <= bounds.y + bounds.height;
};

/*
 * Decides whether to use the snapper in the current edit mode or not.
 *
 * @returns {boolean}
 */
proto.useWithSnapping = function () {
  return this.viewer.model.is2d();
};


proto.isTextInputHelperActive = function () {
  return this.textInputHelper && this.textInputHelper.isActive();
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeArrow.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeArrow.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeArrow: () => (/* binding */ EditModeArrow)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteArrow_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteArrow.js */ "./extensions/Markup/core/edit-actions/DeleteArrow.js");
/* harmony import */ var _edit_actions_CreateArrow_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateArrow.js */ "./extensions/Markup/core/edit-actions/CreateArrow.js");
/* harmony import */ var _edit_actions_SetArrow_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetArrow.js */ "./extensions/Markup/core/edit-actions/SetArrow.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");









var MeasureCommon = Autodesk.Viewing.MeasureCommon;

/**
 *
 * @param editor
 * @constructor
 */
function EditModeArrow(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_ARROW, styleAttributes);
}

EditModeArrow.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeArrow.prototype.constructor = EditModeArrow;


var proto = EditModeArrow.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var deleteArrow = new _edit_actions_DeleteArrow_js__WEBPACK_IMPORTED_MODULE_1__.DeleteArrow(this.editor, markup);
    deleteArrow.addToHistory = !cantUndo;
    deleteArrow.execute();
    return true;
  }
  return false;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;
  var mousePosition = editor.getMousePosition();

  this.initialX = mousePosition.x;
  this.initialY = mousePosition.y;

  this.size.x = 0;
  this.size.y = 0;

  // Snap to parallel/perpendicular of underlying vectors
  this.lineSnapped = null;
  if (editor.snapper) {
    var geomType = editor.snapper.getGeometryType();
    if (geomType === MeasureCommon.SnapType.SNAP_VERTEX ||
    geomType === MeasureCommon.SnapType.SNAP_EDGE ||
    geomType === MeasureCommon.SnapType.SNAP_MIDPOINT ||
    geomType === MeasureCommon.SnapType.SNAP_CIRCLE_CENTER)
    {
      this.lineSnapped = editor.snapper.getEdge();
    }
  }

  // Calculate head and tail.
  var arrowMinSize = this.style['stroke-width'] * 3.5;

  var head = this.head = editor.positionFromClientToMarkups(this.initialX, this.initialY);
  var tail = {
    x: head.x + Math.cos(Math.PI * 0.25) * arrowMinSize,
    y: head.y + Math.sin(-Math.PI * 0.25) * arrowMinSize
  };
  // Constrain head and tail inside working area.
  var constrain = function (head, tail, size, bounds) {

    if (this.isInsideBounds(tail.x, tail.y, bounds)) {
      return;
    }

    tail.y = head.y + Math.sin(Math.PI * 0.25) * size;
    if (this.isInsideBounds(tail.x, tail.y, bounds)) {
      return;
    }

    tail.x = head.x + Math.cos(-Math.PI * 0.25) * size;
    if (this.isInsideBounds(tail.x, tail.y, bounds)) {
      return;
    }

    tail.y = head.y + Math.sin(-Math.PI * 0.25) * size;

  }.bind(this);

  constrain(head, tail, arrowMinSize, editor.getBounds());

  // Create arrow.
  editor.beginActionGroup();

  var arrowVector = new THREE.Vector2(tail.x - head.x, tail.y - head.y);
  if (arrowVector.lengthSq() < arrowMinSize * arrowMinSize) {

    arrowVector = arrowVector.normalize().multiplyScalar(arrowMinSize);
    tail.x = head.x + arrowVector.x;
    tail.y = head.y + arrowVector.y;
  }

  var arrowId = editor.getId();
  var create = new _edit_actions_CreateArrow_js__WEBPACK_IMPORTED_MODULE_2__.CreateArrow(editor, arrowId, head, tail, this.style);
  create.execute();

  this.selectedMarkup = editor.getMarkup(arrowId);
  this.creationBegin();
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }

  var selectedMarkup = this.selectedMarkup;

  var editor = this.editor;
  var final = this.getFinalMouseDraggingPosition();
  var initialX = this.initialX;
  var initialY = this.initialY;

  // Snap to parallel/perpendicular of underlying vectors
  if (editor.snapper && !editor.snapper.isSnapped() && this.lineSnapped) {
    var start = editor.project(this.lineSnapped.vertices[0]);
    var end = editor.project(this.lineSnapped.vertices[1]);
    var p = new THREE.Vector3(final.x, final.y, start.z);

    var parallel = MeasureCommon.nearestPointInPointToLine(p, start, end);

    // select an arbitrary point on the perpendicular line
    var k = -(start.x - end.x) / (start.y - end.y);
    var b = initialY - k * initialX;
    var x = initialX + 1;
    var y = k * x + b;
    var pEnd = new THREE.Vector3(x, y, start.z);

    var pStart = new THREE.Vector3(initialX, initialY, start.z);
    var perpendicular = MeasureCommon.nearestPointInPointToLine(p, pStart, pEnd);

    // Snap to parallel of underlying vectors
    if (parallel.distanceTo(p) <= 20) {
      final.x = parallel.x;
      final.y = parallel.y;
    }
    // Snap to perpendicular of underlying vectors
    else if (perpendicular.distanceTo(p) <= 20) {
      final.x = perpendicular.x;
      final.y = perpendicular.y;
    }
  }

  var head = this.head;
  var tail = editor.positionFromClientToMarkups(final.x, final.y);

  var arrowVector = new THREE.Vector2(tail.x - head.x, tail.y - head.y);
  var arrowMinSize = selectedMarkup.style['stroke-width'] * 3.5;

  if (arrowVector.lengthSq() < arrowMinSize * arrowMinSize) {

    arrowVector = arrowVector.normalize().multiplyScalar(arrowMinSize);
    tail.x = head.x + arrowVector.x;
    tail.y = head.y + arrowVector.y;
  }

  this.size = editor.sizeFromClientToMarkups(final.x - initialX, final.y - initialY);

  var setArrow = new _edit_actions_SetArrow_js__WEBPACK_IMPORTED_MODULE_3__.SetArrow(editor, selectedMarkup, head, tail);
  setArrow.execute();
  return true;
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeCallout.js"
/*!**************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeCallout.js ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeCallout: () => (/* binding */ EditModeCallout)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteCallout.js */ "./extensions/Markup/core/edit-actions/DeleteCallout.js");
/* harmony import */ var _edit_actions_CreateCallout_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateCallout.js */ "./extensions/Markup/core/edit-actions/CreateCallout.js");
/* harmony import */ var _edit_actions_SetCallout_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetCallout.js */ "./extensions/Markup/core/edit-actions/SetCallout.js");
/* harmony import */ var _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../edit-actions/SetStyle.js */ "./extensions/Markup/core/edit-actions/SetStyle.js");
/* harmony import */ var _edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../edit-actions/SetSize.js */ "./extensions/Markup/core/edit-actions/SetSize.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _EditorTextInput_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./EditorTextInput.js */ "./extensions/Markup/core/edit-modes/EditorTextInput.js");













var STARTING_WIDTH_FACTOR = 6;

/**
 *
 * @param editor
 * @constructor
 */
function EditModeCallout(editor) {

  var styleAttributes = [
  'font-size',
  'stroke-width',
  'stroke-color',
  'stroke-opacity',
  'fill-color',
  'fill-opacity',
  'font-family',
  'font-style',
  'font-weight'];

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_6__.MARKUP_TYPE_CALLOUT, styleAttributes);

  this.style['fill-opacity'] = 1.0;
  this.style['fill-color'] = '#ffffff';

  var helper = new _EditorTextInput_js__WEBPACK_IMPORTED_MODULE_8__.EditorTextInput(this.viewer.container, this.editor, false, 'Text', 360);
  helper.addEventListener(helper.EVENT_TEXT_CHANGE, this.onHelperTextChange.bind(this), false);
  helper.addEventListener(helper.EVENT_TEXT_SET_ACTIVE, this.onHelperSetActive.bind(this), false);
  helper.addEventListener(helper.EVENT_TEXT_SET_INACTIVE, this.onHelperSetActive.bind(this), false);

  this.textInputHelper = helper;
  this.onHistoryChangeBinded = this.onHistoryChange.bind(this);
  this.minSize = 0; // No need to size it initially
  this.creationMethod = this.CREATION_METHOD_CLICK;
}

EditModeCallout.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeCallout.prototype.constructor = EditModeCallout;

var proto = EditModeCallout.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type === this.type) {
    var deleteCallout = new _edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_1__.DeleteCallout(this.editor, markup);
    deleteCallout.addToHistory = !cantUndo;
    deleteCallout.execute();
    return true;
  }
  return false;
};

proto.setStyle = function (style) {

  if (this.textInputHelper && this.textInputHelper.isActive()) {

    this.textInputHelper.setStyle(style);
  } else {
    _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.setStyle.call(this, style);
  }
};

proto.notifyAllowNavigation = function (allows) {

  if (allows && this.textInputHelper && this.textInputHelper.isActive()) {
    this.textInputHelper.acceptAndExit();
  }
};

proto.destroy = function () {

  if (this.textInputHelper) {
    if (this.textInputHelper.isActive()) {
      this.textInputHelper.acceptAndExit();
    }
    this.textInputHelper.destroy();
    this.textInputHelper = null;
  }
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.destroy.call(this);
};

/**
 * Handler to mouse down events, used to start markups creation.
 */
proto.onMouseDown = function () {

  if (this.textInputHelper && this.textInputHelper.isActive()) {
    this.textInputHelper.acceptAndExit();
    return;
  }

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;
  var mousePosition = editor.getMousePosition();
  var clientFontSize = editor.sizeFromMarkupsToClient(0, this.style['font-size']).y;
  var initialWidth = clientFontSize * STARTING_WIDTH_FACTOR; // Find better way to initialize size.
  var initialHeight = clientFontSize * 1;

  // Center position.
  var size = this.size = editor.sizeFromClientToMarkups(initialWidth, initialHeight);
  var position = editor.positionFromClientToMarkups(
    mousePosition.x + initialWidth * 0.5,
    mousePosition.y + initialHeight * 0.5);

  this.creationBegin();
  editor.beginActionGroup();

  // Given the initial width and font size, we assume that the text fits in one line.
  var createCallout = new _edit_actions_CreateCallout_js__WEBPACK_IMPORTED_MODULE_2__.CreateCallout(
    editor,
    editor.getId(),
    position,
    size,
    '',
    this.style,
    true);

  createCallout.execute();
  this.creationEnd();

  this.selectedMarkup = editor.getMarkup(createCallout.targetId);
  this.textInputHelper && this.textInputHelper.setActive(this.selectedMarkup, true);
  this.editor.actionManager.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_7__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
};

proto.onMouseUp = function (event) {

};

proto.onMouseDoubleClick = function (markup) {

  if (markup === this.selectedMarkup) {
    this.editor.selectMarkup(markup);
    this.editor.editFrame.setMarkup(markup);
    this.textInputHelper && this.textInputHelper.setActive(markup, false);
  }
};

proto.onHelperSetActive = function (event) {
  var databag = event.data;
  var markup = databag.markup;
  if (markup) {
    markup.setIsHelperTextActive(databag.isActive);
    markup.setIsShapeVisible(!databag.isActive);
  }
};

proto.onHelperTextChange = function (event) {

  var dataBag = event.data;
  var textMarkup = dataBag.markup;
  var textStyle = dataBag.style;
  var curSelection = this.selectedMarkup;

  this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_7__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);

  // Deal with edge case first: Creating a Label without text
  if (dataBag.newText === '') {
    this.editor.cancelActionGroup();

    var deleteCallout = new _edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_1__.DeleteCallout(this.editor, textMarkup);
    deleteCallout.execute();

    if (textMarkup !== curSelection) {
      this.editor.selectMarkup(curSelection);
    }

    return;
  }

  // When the text is created for the first time, an action group
  // is already created and it includes the CreateCallout action.
  // Thus, no need to begin another action group.
  if (!dataBag.firstEdit) {
    this.editor.beginActionGroup();
  }

  // Size change action //
  var position = this.editor.positionFromClientToMarkups(
    dataBag.newPos.x, dataBag.newPos.y
  );
  var size = this.editor.sizeFromClientToMarkups(
    dataBag.width, dataBag.height
  );
  var setSize = new _edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_5__.SetSize(
    this.editor,
    textMarkup,
    position,
    size.x,
    size.y);
  setSize.execute();

  // Text change action //
  var setCallout = new _edit_actions_SetCallout_js__WEBPACK_IMPORTED_MODULE_3__.SetCallout(
    this.editor,
    textMarkup,
    textMarkup.position,
    textMarkup.size,
    dataBag.newText,
    textMarkup.isFrameUsed);
  setCallout.execute();

  var setStyle = new _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_4__.SetStyle(
    this.editor,
    textMarkup,
    textStyle
  );
  setStyle.execute();

  // However, we do need to close the action group at this point. For both cases.
  this.editor.closeActionGroup();
  this.editor.selectMarkup(curSelection);
};

/**
 * We want to make sure that the Input Helper gets removed from the screen
 * whenever the user attempts to perform an undo or redo action.
 * @param {Event} event
 * @private
 */
proto.onHistoryChange = function (event) {

  if (this.textInputHelper && this.textInputHelper.isActive()) {
    this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_7__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
    this.textInputHelper.setInactive();
  }
};

/**
 * Notify the markup that the displayed markups are being saved so edit mode can finish current editions.
 */
proto.onSave = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onSave.call(this);

  // Close input helper if it's open.
  if (this.textInputHelper && this.textInputHelper.isActive()) {
    var firstEdit = this.textInputHelper.firstEdit;

    this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_7__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
    this.textInputHelper.setInactive();

    // Close action group if open (first edit).
    if (firstEdit) {
      this.editor.cancelActionGroup();
    }

    this.editor.selectMarkup(null);
    this.selectedMarkup = null;
  }
};

proto.updateTextBoxStyle = function () {
  if (this.isTextInputHelperActive()) {
    this.textInputHelper.onCameraChanged();
  }
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeCircle.js"
/*!*************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeCircle.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeCircle: () => (/* binding */ EditModeCircle)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteCircle_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteCircle.js */ "./extensions/Markup/core/edit-actions/DeleteCircle.js");
/* harmony import */ var _edit_actions_CreateCircle_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateCircle.js */ "./extensions/Markup/core/edit-actions/CreateCircle.js");
/* harmony import */ var _edit_actions_SetCircle_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetCircle.js */ "./extensions/Markup/core/edit-actions/SetCircle.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");








/**
 * Markup circle edit mode.
 *
 * Implements a Circle {@link Autodesk.Viewing.Extensions.Markups.Core.EditMode|EditMode}.
 * Included in documentation as an example of how to create
 * an EditMode for a specific markup type. Developers are encourage to look into this class's source code and copy
 * as much code as they need. Find link to source code below.
 *
 * @tutorial feature_markup
 * @constructor
 * @memberof Autodesk.Viewing.Extensions.Markups.Core
 * @extends Autodesk.Viewing.Extensions.Markups.Core.EditMode
 * @param {Autodesk.Viewing.Extensions.Markups.Core.MarkupsCore} editor
 */
function EditModeCircle(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_CIRCLE, styleAttributes);
}

EditModeCircle.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeCircle.prototype.constructor = EditModeCircle;

var proto = EditModeCircle.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var deleteCircle = new _edit_actions_DeleteCircle_js__WEBPACK_IMPORTED_MODULE_1__.DeleteCircle(this.editor, markup);
    deleteCircle.addToHistory = !cantUndo;
    deleteCircle.execute();
    return true;
  }
  return false;
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }

  var selectedMarkup = this.selectedMarkup;

  var editor = this.editor;

  var final = this.getFinalMouseDraggingPosition();
  final = editor.clientToMarkups(final.x, final.y);

  var sizeX = Math.abs(this.firstPosition.x - final.x);
  var sizeY = Math.abs(this.firstPosition.y - final.y);

  var position = { x: (this.firstPosition.x + final.x) * 0.5, y: (this.firstPosition.y + final.y) * 0.5 };
  var size = this.size = { x: sizeX, y: sizeY };

  var setCircle = new _edit_actions_SetCircle_js__WEBPACK_IMPORTED_MODULE_3__.SetCircle(
    editor,
    selectedMarkup,
    position,
    size);

  setCircle.execute();
  return true;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;
  var mousePosition = editor.getMousePosition();

  this.initialX = mousePosition.x;
  this.initialY = mousePosition.y;

  // Calculate center and size.
  var position = this.firstPosition = editor.clientToMarkups(this.initialX, this.initialY);
  var size = this.size = editor.sizeFromClientToMarkups(1, 1);

  // Create circle.
  editor.beginActionGroup();

  var markupId = editor.getId();
  var create = new _edit_actions_CreateCircle_js__WEBPACK_IMPORTED_MODULE_2__.CreateCircle(
    editor,
    markupId,
    position,
    size,
    0,
    this.style);
  create.execute();

  this.selectedMarkup = editor.getMarkup(markupId);
  this.creationBegin();
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeCloud.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeCloud.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeCloud: () => (/* binding */ EditModeCloud)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteCloud_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteCloud.js */ "./extensions/Markup/core/edit-actions/DeleteCloud.js");
/* harmony import */ var _edit_actions_CreateCloud_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateCloud.js */ "./extensions/Markup/core/edit-actions/CreateCloud.js");
/* harmony import */ var _edit_actions_SetCloud_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetCloud.js */ "./extensions/Markup/core/edit-actions/SetCloud.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");








/**
 *
 * @param editor
 * @constructor
 */
function EditModeCloud(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_CLOUD, styleAttributes);
}

EditModeCloud.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeCloud.prototype.constructor = EditModeCloud;

var proto = EditModeCloud.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var deleteCloud = new _edit_actions_DeleteCloud_js__WEBPACK_IMPORTED_MODULE_1__.DeleteCloud(this.editor, markup);
    deleteCloud.addToHistory = !cantUndo;
    deleteCloud.execute();
    return true;
  }
  return false;
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }

  var selectedMarkup = this.selectedMarkup;

  var editor = this.editor;

  var pos = this.getFinalMouseDraggingPosition();
  var final = editor.clientToMarkups(pos.x, pos.y);
  var position = { x: (this.firstPosition.x + final.x) / 2, y: (this.firstPosition.y + final.y) / 2 };
  var size = this.size = { x: Math.abs(final.x - this.firstPosition.x), y: Math.abs(final.y - this.firstPosition.y) };
  var setCloud = new _edit_actions_SetCloud_js__WEBPACK_IMPORTED_MODULE_3__.SetCloud(
    editor,
    selectedMarkup,
    position,
    size);

  setCloud.execute();
  return true;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;
  var mousePosition = editor.getMousePosition();

  this.initialX = mousePosition.x;
  this.initialY = mousePosition.y;

  // Calculate center and size.
  var position = this.firstPosition = editor.clientToMarkups(this.initialX, this.initialY);
  var size = this.size = editor.sizeFromClientToMarkups(1, 1);

  // Create Cloud.
  editor.beginActionGroup();

  var markupId = editor.getId();
  var create = new _edit_actions_CreateCloud_js__WEBPACK_IMPORTED_MODULE_2__.CreateCloud(
    editor,
    markupId,
    position,
    size,
    0,
    this.style);

  create.execute();

  this.selectedMarkup = editor.getMarkup(markupId);
  this.creationBegin();
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeDimension.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeDimension.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeDimension: () => (/* binding */ EditModeDimension)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteDimension_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteDimension.js */ "./extensions/Markup/core/edit-actions/DeleteDimension.js");
/* harmony import */ var _edit_actions_CreateDimension_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateDimension.js */ "./extensions/Markup/core/edit-actions/CreateDimension.js");
/* harmony import */ var _edit_actions_SetDimension_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetDimension.js */ "./extensions/Markup/core/edit-actions/SetDimension.js");
/* harmony import */ var _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../edit-actions/SetStyle.js */ "./extensions/Markup/core/edit-actions/SetStyle.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _EditorTextInput_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./EditorTextInput.js */ "./extensions/Markup/core/edit-modes/EditorTextInput.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");












var MeasureCommon = Autodesk.Viewing.MeasureCommon;

var MAX_LETTERS = 15;
var SPACE = '\u00A0'; // Non-breaking space
var _cursorPosition;

/**
 *
 * @param editor
 * @constructor
 */
function EditModeDimension(editor) {

  var self = this;

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'font-size', 'font-family', 'font-style', 'font-weight'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_5__.MARKUP_TYPE_DIMENSION, styleAttributes);

  this.onHistoryChangeBinded = this.onHistoryChange.bind(this);

  this.measurement = new MeasureCommon.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE);
  var viewer = this.viewer;
  var measureExt = viewer.getExtension('Autodesk.Measure');

  function abortDimensionMarkup() {
    self.cancelEditModeChange = true;
    editor.enterEditMode(); // Selects default edit mode.
  }

  if (!measureExt) {
    console.error('Demension markup cant work without measure extension. Please load measure extension first');
    abortDimensionMarkup();
  }

  this.sharedMeasureConfig = measureExt.sharedMeasureConfig;

  // If PDF, force calibration
  if ((measureExt.forceCalibrate || viewer.model.isLeaflet() || viewer.model.isPdf(true)) && !measureExt.calibrationTool.isCalibrated()) {
    measureExt.openCalibrationRequiredDialog('dimension');
    abortDimensionMarkup();
  }
}

EditModeDimension.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeDimension.prototype.constructor = EditModeDimension;

var proto = EditModeDimension.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var deleteDimension = new _edit_actions_DeleteDimension_js__WEBPACK_IMPORTED_MODULE_1__.DeleteDimension(this.editor, markup);
    deleteDimension.addToHistory = !cantUndo;
    deleteDimension.execute();
    this.creating = false;
    this.dragging = false;
    return true;
  }
  return false;
};

proto.updateTextBoxStyle = function (style) {
  if (this.isTextInputHelperActive()) {
    if (!style) {
      style = this.textInputHelper.textMarkup.getStyle();
    }

    this.textInputHelper.setStyle(style);
    this.updateTextBox(this.textInputHelper.textMarkup);
  }
};

proto.setStyle = function (style) {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.setStyle.call(this, style);
  this.updateTextBoxStyle(style);

};

proto.notifyAllowNavigation = function (allows) {

  if (allows && this.isTextInputHelperActive()) {
    this.textInputHelper.acceptAndExit();
  }
};

proto.creationBegin = function () {
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationBegin.call(this);
};

proto.creationEnd = function () {

  this.dragging = false;
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationEnd.call(this);
};

proto.isMinSizeValid = function () {

  if (this.minSize !== 0) {
    var tmp = this.editor.sizeFromMarkupsToClient(this.selectedMarkup.size.x, this.selectedMarkup.size.y);
    return tmp.x * tmp.x >= this.minSize * this.minSize;
  }

  return true;
};

proto.creationCancel = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationCancel.call(this);

  this.creating = false;
  this.dragging = false;

};

proto.destroy = function () {

  if (this.textInputHelper) {

    if (this.textInputHelper.isActive()) {
      this.textInputHelper.acceptAndExit();
    }

    this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_6__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);

    this.textInputHelper.destroy();
    this.textInputHelper = null;
  }

  this.updateViewportId();

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.destroy.call(this);
};

proto.getDistance = function () {

  var distance = null;

  this.measurement.computeResult(this.measurement.picks, this.viewer);

  if (this.viewer.model && this.measurement.distanceXYZ) {
    var d = Autodesk.Viewing.Private.convertUnits(this.viewer.model.getUnitString(), this.sharedMeasureConfig.units, this.sharedMeasureConfig.calibrationFactor, this.measurement.distanceXYZ);
    return Autodesk.Viewing.Private.formatValueWithUnits(d, this.sharedMeasureConfig.units, 3, this.sharedMeasureConfig.precision);
  }

  return distance;
};

proto.updateMeasurement = function (measurementNumber) {
  var editor = this.editor;

  var pick = this.measurement.getPick(measurementNumber);

  if (_cursorPosition) {
    pick.geomType = MeasureCommon.SnapType.SNAP_VERTEX;
    pick.geomVertex = _cursorPosition;
    pick.intersectPoint = _cursorPosition;
  } else {
    editor.snapper.copyResults(pick);
  }

  return pick;
};

proto.updateViewportId = function (viewportId) {
  if (this.viewer.model && this.viewer.model.is2d()) {
    if (!viewportId) {
      this.viewer.impl.updateViewportId(0);
      this.editor.snapper.setViewportId(null);
    } else
    {
      // Pass viewport Id to LineShader to make all other geometries with different viewport transparent
      this.viewer.impl.updateViewportId(viewportId);
      this.editor.snapper.setViewportId(viewportId);

    }
  }
};

proto.pickFirstAnchor = function () {
  var editor = this.editor;
  this.measurement.clearAllPicks();
  var mousePosition = editor.getMousePosition();

  this.initialX = mousePosition.x;
  this.initialY = mousePosition.y;

  this.firstAnchor = editor.positionFromClientToMarkups(this.initialX, this.initialY);

  editor.beginActionGroup();

  var dimensionId = editor.getId();
  var create = new _edit_actions_CreateDimension_js__WEBPACK_IMPORTED_MODULE_2__.CreateDimension(editor, dimensionId, this.firstAnchor, null, this.currentText, this.style);
  create.execute();

  this.selectedMarkup = editor.getMarkup(dimensionId);
  this.creationBegin();

  var pick = this.updateMeasurement(1);
  this.updateViewportId(pick.viewportIndex2d);
};

proto.pickSecondAnchor = function (mouseDown) {

  var editor = this.editor;
  var selectedMarkup = this.selectedMarkup;

  this.secondAnchor = this.getFinalMouseDraggingPosition();

  this.updateMeasurement(2);

  // Correct Perpendicular
  if (MeasureCommon.correctPerpendicularPicks(this.measurement.getPick(1), this.measurement.getPick(2), this.viewer, editor.snapper)) {
    var newPos = MeasureCommon.getSnapResultPosition(this.measurement.getPick(2), this.viewer);
    this.secondAnchor = editor.project(newPos);
    editor.snapper.indicator.render();
  }

  var secondAnchor = editor.positionFromClientToMarkups(this.secondAnchor.x, this.secondAnchor.y);

  this.size.x = selectedMarkup.size.x;
  this.size.y = selectedMarkup.size.y;

  selectedMarkup.currentText = this.getDistance();

  var setDimension = new _edit_actions_SetDimension_js__WEBPACK_IMPORTED_MODULE_3__.SetDimension(editor, selectedMarkup, this.firstAnchor, secondAnchor, selectedMarkup.currentText);
  setDimension.execute();

  var setStyle = new _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_4__.SetStyle(editor, selectedMarkup, this.style);
  setStyle.execute();

  // Open 'Add Length' textbox if no measurement has being taken.
  if (mouseDown && !selectedMarkup.currentText && this.isMinSizeValid()) {
    selectedMarkup.currentText = '';
    this.editor.selectMarkup(null);
    this.updateTextBox(selectedMarkup);
  }
};


/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function (event) {

  // Right click - do nothing.
  if (Autodesk.Viewing.Private.isRightClick(event, this.viewer.navigation)) {
    return;
  }

  _cursorPosition = null;

  // Textbox is open.
  if (this.isTextInputHelperActive()) {
    this.textInputHelper.acceptAndExit();
    return;
  }

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  // User selected an already created markup.
  if (this.selectedMarkup && !this.creating) {
    return;
  }

  var isSnapped = this.editor.snapper.isSnapped();

  // Picked first point.
  if (!this.selectedMarkup && !this.creating && isSnapped) {
    this.pickFirstAnchor();
  }

  // Picked second point.
  else if (this.selectedMarkup && this.creating) {

    if (isSnapped) {
      this.pickSecondAnchor(true);
    } else {
      this.deleteMarkup(this.selectedMarkup, true);
      this.creating = true;
    }

    this.updateViewportId();
    this.creationEnd();
  }
};

proto.onMouseUp = function (event) {

  if (this.dragging) {
    this.onMouseDown(event);
    this.dragging = false;
  }
};


/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  _cursorPosition = null;

  if (!this.selectedMarkup || !this.creating) {
    return;
  }

  this.dragging = true;
  this.pickSecondAnchor(false);
};

proto.getFinalMouseDraggingPosition = function () {

  var editor = this.editor;
  var bounds = editor.getBounds();
  var mousePosition = editor.getMousePosition();

  if (!editor.snapper.isSnapped()) {
    if (editor.viewer.model && editor.viewer.model.is2d()) {
      _cursorPosition = MeasureCommon.inverseProject(mousePosition, editor.viewer);
    }
  }

  var initialX = this.initialX;
  var initialY = this.initialY;

  var finalX = Math.min(Math.max(bounds.x, mousePosition.x), bounds.x + bounds.width);
  var finalY = Math.min(Math.max(bounds.y, mousePosition.y), bounds.y + bounds.height);

  if (finalX == initialX &&
  finalY == initialY) {
    finalX++;
    finalY++;
  }

  // Make straight line when shift key is down.
  if (editor.input.constrainAxis && editor.viewer.model.is2d()) {
    var dx = Math.abs(finalX - initialX);
    var dy = Math.abs(finalY - initialY);

    if (dx > dy) {
      finalY = initialY;
    } else
    {
      finalX = initialX;
    }

    editor.snapper.onMouseMove({ x: finalX, y: finalY });

    if (editor.snapper.isSnapped()) {
      editor.snapper.copyResults(this.measurement.getPick(2));
      _cursorPosition = null;
    } else {
      _cursorPosition = MeasureCommon.inverseProject({ x: finalX, y: finalY }, editor.viewer);
    }
  }

  return { x: finalX, y: finalY };
};

proto.isVisibleChar = function (keyCode) {

  return keyCode > 47 && keyCode < 58 || // number keys
  keyCode == 32 || // spacebar
  keyCode > 64 && keyCode < 91 || // letter keys
  keyCode > 95 && keyCode < 112 || // numpad keys
  keyCode > 185 && keyCode < 193 || // ;=,-./` (in order)
  keyCode > 218 && keyCode < 223; // [\]' (in order)
};

proto.measureTextLine = function (text, markup, editor) {

  text = text.replace(new RegExp(' ', 'g'), SPACE);
  text = text.length === 0 ? markup.initialText : text;
  return (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_8__.measureTextLines)([text + '|'], this.style, editor)[0];

};

proto.handleKeyDown = function (e) {
  var textInputHelper = this.textInputHelper;

  if (e.keyCode === Autodesk.Viewing.KeyCode.ENTER) {
    return;
  }

  var markup = textInputHelper.textMarkup;
  var text = textInputHelper.textArea.value;

  if (e.keyCode === Autodesk.Viewing.KeyCode.BACKSPACE) {
    text = text.substring(0, text.length - 1);
  }

  if (text.length < MAX_LETTERS && this.isVisibleChar(e.keyCode)) {
    text = text + e.key;
  }

  var size = this.measureTextLine(text, markup, this.editor);

  this.updateTextBox(markup, size);
};

proto.updateTextBox = function (markup, size) {

  if (!this.textInputHelper) {
    this.textInputHelper = new _EditorTextInput_js__WEBPACK_IMPORTED_MODULE_7__.EditorTextInput(this.viewer.container, this.editor, true, markup.initialText, MAX_LETTERS);
    this.textInputHelper.addEventListener(this.textInputHelper.EVENT_TEXT_CHANGE, this.onHelperTextChange.bind(this), false);
    this.handleKeyDownBinded = this.handleKeyDown.bind(this);
  }

  markup.text.style.display = 'none';

  if (!size) {
    size = this.measureTextLine(this.textInputHelper.textArea.value, markup, this.editor);
  }

  var transform = this.getTextAreaTransform(markup, size);

  this.textInputHelper.styleTextArea.setAttribute('text-align', 'center');

  this.textInputHelper.setActive(markup, false);


  // Override textArea attributes
  this.textInputHelper.textArea.style.position = 'static';
  this.textInputHelper.textArea.style.padding = '0';
  this.textInputHelper.textArea.style.width = size.width + 'px';
  this.textInputHelper.textArea.style.height = size.height + 'px';
  this.textInputHelper.textArea.style.transform = transform; // Maybe need to add 'allBrowsers' support

  this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_6__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
  this.editor.actionManager.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_6__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
  this.textInputHelper.textArea.removeEventListener('keydown', this.handleKeyDownBinded);
  this.textInputHelper.textArea.addEventListener('keydown', this.handleKeyDownBinded);

};

proto.getTextAreaTransform = function (markup, size) {

  var position = markup.getClientPosition();
  var rotation = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_8__.radiansToDegrees)(markup.rotation) % 360;

  if (rotation > 90 && rotation <= 270 && markup.shouldFlip()) {
    rotation = 180 + rotation;
  }

  return [
  'translate(', position.x - size.width / 2 + 'px,', position.y - this.viewer.container.clientHeight - size.height + 'px)',
  'rotate(', rotation + 'deg)',
  'translate(0px,', size.height + 'px)'].
  join(' ');
};

proto.onMouseDoubleClick = function (markup) {

  if (markup === this.selectedMarkup) {
    this.editor.selectMarkup(null);
    this.updateTextBox(markup);
  }
};

proto.onHelperTextChange = function (event) {

  var dataBag = event.data;
  var markup = dataBag.markup;
  var textStyle = dataBag.style;
  var editor = this.editor;

  markup.text.style.display = 'block';

  if (dataBag.newText === '') {
    dataBag.newText = markup.initialText;
  }

  // When the text is created for the first time, an action group
  // is already created and it includes the CreateText action.
  // Thus, no need to begin another action group.
  if (!dataBag.firstEdit) {
    editor.beginActionGroup();
  }

  var setStyle = new _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_4__.SetStyle(editor, markup, textStyle);
  setStyle.execute();

  var setDimension = new _edit_actions_SetDimension_js__WEBPACK_IMPORTED_MODULE_3__.SetDimension(editor, markup, markup.firstAnchor, markup.secondAnchor, dataBag.newText);
  setDimension.execute();

  editor.closeActionGroup();
  editor.selectMarkup(null);
};

/**
 * We want to make sure that the Input Helper gets removed from the screen
 * whenever the user attempts to perform an undo or redo action.
 * @param {Event} event
 * @private
 */
proto.onHistoryChange = function (event) {
  if (this.isTextInputHelperActive()) {
    this.textInputHelper.textMarkup.text.style.display = 'block';
    this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_6__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
    this.textInputHelper.setInactive();
  }
};

/**
 * Notify the markup that the displayed markups are being saved so edit mode can finish current editions.
 */
proto.onSave = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onSave.call(this);

  // Close input helper if it's open.
  if (this.isTextInputHelperActive()) {
    var editor = this.editor;
    editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_6__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
    var markup = this.textInputHelper.textMarkup;
    this.textInputHelper.acceptAndExit();
    markup.text.style.display = 'block';
  }
};

proto.useWithSnapping = function () {
  return true;
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeFreehand.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeFreehand.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeFreehand: () => (/* binding */ EditModeFreehand)
/* harmony export */ });
/* harmony import */ var _EditModePen_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditModePen.js */ "./extensions/Markup/core/edit-modes/EditModePen.js");
/* harmony import */ var _edit_actions_DeleteFreehand_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteFreehand.js */ "./extensions/Markup/core/edit-actions/DeleteFreehand.js");
/* harmony import */ var _edit_actions_CreateFreehand_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateFreehand.js */ "./extensions/Markup/core/edit-actions/CreateFreehand.js");
/* harmony import */ var _edit_actions_SetFreehand_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetFreehand.js */ "./extensions/Markup/core/edit-actions/SetFreehand.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");








/**
 *
 * @param editor
 * @constructor
 */
function EditModeFreehand(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity'];
  _EditModePen_js__WEBPACK_IMPORTED_MODULE_0__.EditModePen.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_FREEHAND, styleAttributes);
}

EditModeFreehand.prototype = Object.create(_EditModePen_js__WEBPACK_IMPORTED_MODULE_0__.EditModePen.prototype);
EditModeFreehand.prototype.constructor = EditModeFreehand;

var proto = EditModeFreehand.prototype;

proto.createPen = function (markupId, position, size, rotation, locations) {
  return new _edit_actions_CreateFreehand_js__WEBPACK_IMPORTED_MODULE_2__.CreateFreehand(this.editor,
  markupId,
  position,
  size,
  rotation,
  locations,
  this.style);
};

proto.deletePen = function (markup) {
  return new _edit_actions_DeleteFreehand_js__WEBPACK_IMPORTED_MODULE_1__.DeleteFreehand(this.editor, markup);
};

proto.setPen = function (position, size, locations, isAbsoluteCoords) {
  return new _edit_actions_SetFreehand_js__WEBPACK_IMPORTED_MODULE_3__.SetFreehand(this.editor,
  this.selectedMarkup,
  position,
  size,
  locations,
  isAbsoluteCoords);
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeHighlight.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeHighlight.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeHighlight: () => (/* binding */ EditModeHighlight)
/* harmony export */ });
/* harmony import */ var _EditModePen_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditModePen.js */ "./extensions/Markup/core/edit-modes/EditModePen.js");
/* harmony import */ var _edit_actions_DeleteHighlight_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteHighlight.js */ "./extensions/Markup/core/edit-actions/DeleteHighlight.js");
/* harmony import */ var _edit_actions_CreateHighlight_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateHighlight.js */ "./extensions/Markup/core/edit-actions/CreateHighlight.js");
/* harmony import */ var _edit_actions_SetHighlight_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetHighlight.js */ "./extensions/Markup/core/edit-actions/SetHighlight.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");








/**
 *
 * @param editor
 * @constructor
 */
function EditModeHighlight(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity'];
  _EditModePen_js__WEBPACK_IMPORTED_MODULE_0__.EditModePen.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_HIGHLIGHT, styleAttributes);

  var normaStrokeWidth = editor.getStrokeWidth();
  this.style['stroke-opacity'] = 0.50;
  this.style['stroke-color'] = '#ffff00';
  this.style['stroke-width'] = 4 * normaStrokeWidth; // Very Thick
}

EditModeHighlight.prototype = Object.create(_EditModePen_js__WEBPACK_IMPORTED_MODULE_0__.EditModePen.prototype);
EditModeHighlight.prototype.constructor = EditModeHighlight;

var proto = EditModeHighlight.prototype;

proto.createPen = function (markupId, position, size, rotation, locations) {
  return new _edit_actions_CreateHighlight_js__WEBPACK_IMPORTED_MODULE_2__.CreateHighlight(this.editor,
  markupId,
  position,
  size,
  rotation,
  locations,
  this.style);
};

proto.deletePen = function (markup) {
  return new _edit_actions_DeleteHighlight_js__WEBPACK_IMPORTED_MODULE_1__.DeleteHighlight(this.editor, markup);
};

proto.setPen = function (position, size, locations, isAbsoluteCoords) {
  return new _edit_actions_SetHighlight_js__WEBPACK_IMPORTED_MODULE_3__.SetHighlight(this.editor,
  this.selectedMarkup,
  position,
  size,
  locations,
  isAbsoluteCoords);
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModePen.js"
/*!**********************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModePen.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModePen: () => (/* binding */ EditModePen)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");





/**
 * Base class for editing Pen tools (currently freehand and highlighter)
 *
 * Any class extending EditModePen should contain at least the following methods:
 * - createPen()
 * - deletePen()
 * - setPen()
 *
 * @param editor
 * @constructor
 */
function EditModePen(editor, type, styleAttributes) {
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, type, styleAttributes);

  this.smoothen = true;
  this.bufferSize = 8;
}

EditModePen.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);

var proto = EditModePen.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type === this.type) {
    var deleteMarkup = this.deletePen(markup);
    deleteMarkup.addToHistory = !cantUndo;
    deleteMarkup.execute();
    return true;
  }
  return false;
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }


  var editor = this.editor;
  var mousePosition = editor.getMousePosition();
  var movements = this.movements;

  var location = editor.clientToMarkups(mousePosition.x, mousePosition.y);
  if (this.smoothen) {
    this.appendToBuffer(location);
    this.amendPath();
  } else {
    var dx = this.lastX - mousePosition.x;
    var dy = this.lastY - mousePosition.y;
    var moveTol = 25; // 5^2, compare to square to avoid using square root of distance

    if (movements.length > 1 && dx * dx + dy * dy < moveTol) {
      movements[movements.length - 1] = location;
      this.removeFromAbsolutePath(1);
    } else {
      movements.push(location);
      this.lastX = mousePosition.x;
      this.lastY = mousePosition.y;
    }

    this.addToAbsolutePath([location]);
  }

  var setPen = this.setPen(this.position, this.size, this.absolutePath, true);
  setPen.execute();
  return true;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;

  editor.snapper && editor.snapper.clearSnapped();
  var mousePosition = editor.getMousePosition();

  this.lastX = this.initialX = mousePosition.x;
  this.lastY = this.initialY = mousePosition.y;

  //set the starting point
  var position = this.position = editor.clientToMarkups(this.initialX, this.initialY);
  this.movements = [position];
  if (this.smoothen) {
    this.buffer = []; // Reset buffer
    this.movementsLastIndex = null;
    this.appendToBuffer(position);
  }

  var size = this.size = editor.sizeFromClientToMarkups(1, 1);

  // Create pen.
  editor.beginActionGroup();

  var markupId = editor.getId();
  var create = this.createPen(markupId, position, size, 0, [{ x: 0, y: 0 }]);

  create.execute();

  this.createAbsolutePath(position);

  this.selectedMarkup = editor.getMarkup(markupId);
  this.creationBegin();
};

proto.onMouseUp = function () {

  if (!this.creating) {
    _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseUp.call(this);
    return;
  }

  var movements = this.movements;
  var cameraWidth = this.viewer.impl.camera.right - this.viewer.impl.camera.left;
  var cameraHeight = this.viewer.impl.camera.top - this.viewer.impl.camera.bottom;
  var cameraDiagSq = cameraWidth * cameraWidth + cameraHeight * cameraHeight;

  movements = (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.simplify)(movements, cameraDiagSq * 0.00000001, true);

  var xs = movements.map(function (item) {return item.x;});
  var ys = movements.map(function (item) {return item.y;});

  var l = Math.min.apply(null, xs);
  var t = Math.min.apply(null, ys);
  var r = Math.max.apply(null, xs);
  var b = Math.max.apply(null, ys);

  var width = r - l; // Already in markup coords space
  var height = b - t; // Already in markup coords space

  var position = {
    x: l + width * 0.5,
    y: t + height * 0.5
  };
  var size = this.size = { x: width, y: height };

  // Adjust points to relate from the shape's center
  var locations = movements.map(function (point) {
    return {
      x: point.x - position.x,
      y: point.y - position.y
    };
  });

  var setPen = this.setPen(position, size, locations, false);
  setPen.execute();

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseUp.call(this);
};

proto.createPen = function () {
  console.error('createPen not implemented');
};

proto.deletePen = function () {
  console.error('deletePen not implemented');
};

proto.setPen = function () {
  console.error('setPen not implemented');
};

proto.useWithSnapping = function () {
  return false;
};

proto.createAbsolutePath = function (point) {

  this.absolutePath = 'M' + +point.x.toFixed(6) + ' ' + +point.y.toFixed(6);
  this.absolutePathIndexes = [0];
};

proto.removeFromAbsolutePath = function (numToRemove) {

  numToRemove = Math.min(numToRemove, this.absolutePathIndexes.length);
  if (numToRemove > 0) {
    this.absolutePath = this.absolutePath.slice(0, this.absolutePathIndexes[this.absolutePathIndexes.length - numToRemove]);
    this.absolutePathIndexes.splice(this.absolutePathIndexes.length - numToRemove);
  }
};

proto.addToAbsolutePath = function (points) {

  for (var i = 0; i < points.length; i++) {
    this.absolutePathIndexes.push(this.absolutePath.length);
    this.absolutePath += ' L' + +points[i].x.toFixed(6) + ' ' + +points[i].y.toFixed(6);
  }
};

proto.appendToBuffer = function (point) {

  this.buffer.push(point);
  while (this.buffer.length > this.bufferSize) {
    this.buffer.shift();
  }
};

proto.amendPath = function () {

  var point = this.getAveragePoint(0);
  if (point) {
    if (this.movementsLastIndex) {
      this.removeFromAbsolutePath(this.movements.length - this.movementsLastIndex);
      this.movements.splice(this.movementsLastIndex);
    }

    // Add the smoothed part of the path that will not change
    var tmpBuffer = [point];
    this.movementsLastIndex = this.movements.length + 1;

    // Get the last part of the path (close to the current mouse position)
    // This part will change if the mouse moves again
    for (var offset = 2; offset < this.buffer.length; offset += 2) {
      var pt = this.getAveragePoint(offset);
      tmpBuffer.push(pt);
    }

    this.addToAbsolutePath(tmpBuffer);

    // Set the complete current path coordinates
    this.movements.push.apply(this.movements, tmpBuffer);

  }
};

// Calculate the average point, starting at offset in the buffer
proto.getAveragePoint = function (offset) {

  var len = this.buffer.length;
  if (len % 2 === 1 || len >= this.bufferSize) {
    var totalX = 0;
    var totalY = 0;
    var pt;
    var count = 0;
    for (var i = offset; i < len; i++) {
      count++;
      pt = this.buffer[i];
      totalX += pt.x;
      totalY += pt.y;
    }
    return {
      x: totalX / count,
      y: totalY / count
    };
  }
  return null;
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModePolycloud.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModePolycloud.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModePolycloud: () => (/* binding */ EditModePolycloud)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeletePolycloud_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeletePolycloud.js */ "./extensions/Markup/core/edit-actions/DeletePolycloud.js");
/* harmony import */ var _edit_actions_CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreatePolycloud.js */ "./extensions/Markup/core/edit-actions/CreatePolycloud.js");
/* harmony import */ var _edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetPolycloud.js */ "./extensions/Markup/core/edit-actions/SetPolycloud.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");









var SNAP_RANGE = 25;

/**
 *
 * @param editor
 * @constructor
 */
function EditModePolycloud(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_POLYCLOUD, styleAttributes);

  this.creationMethod = this.CREATION_METHOD_CLICKS;
  this.movements = [];
}

EditModePolycloud.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModePolycloud.prototype.constructor = EditModePolycloud;

var proto = EditModePolycloud.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var movements = this.movements;
    if (this.creating && movements.length >= 2) {
      movements.pop();
      movements.pop();
      var lastIndex = movements.length - 1;
      if (lastIndex >= 0) {
        // duplicate last location
        var lastMove = movements[lastIndex];
        movements.push(lastMove);
        var locations = setPositionAndSize(movements, this);
        var setPolycloud = new _edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_3__.SetPolycloud(
          this.editor,
          markup,
          this.position,
          this.size,
          locations);

        setPolycloud.execute();
      }
    } else
    {
      var deletePolycloud = new _edit_actions_DeletePolycloud_js__WEBPACK_IMPORTED_MODULE_1__.DeletePolycloud(this.editor, markup);
      deletePolycloud.addToHistory = !cantUndo;
      deletePolycloud.execute();
      this.creationEnd();
      return true;
    }
  }
  return false;
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }

  var selectedMarkup = this.selectedMarkup;

  var editor = this.editor;

  this.dragging = true;

  var movements = this.movements;
  movements.splice(movements.length - 1, 1);

  var mousePosition = editor.getMousePosition();
  mousePosition = editor.clientToMarkups(mousePosition.x, mousePosition.y);

  // Close polycloud if user clicks close to initial point.
  if (movements.length >= 2 &&
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__.areMarkupsPointsInClientRange)(movements[0], mousePosition, SNAP_RANGE, this.editor)) {
    mousePosition = movements[0]; // Snap!
  }

  movements.push(mousePosition);

  var locations = setPositionAndSize(movements, this);
  var setPolycloud = new _edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_3__.SetPolycloud(
    editor,
    selectedMarkup,
    this.position,
    this.size,
    locations);

  setPolycloud.execute();
  return true;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  // User selected an already created markup.
  if (this.selectedMarkup && !this.creating) {
    return;
  }

  if (this.creating) {
    return;
  }

  // Creation process.
  var editor = this.editor;
  var mousePosition = editor.getMousePosition();

  mousePosition = editor.clientToMarkups(mousePosition.x, mousePosition.y);

  var size = this.size = editor.sizeFromClientToMarkups(1, 1);
  this.movements = [mousePosition, mousePosition];

  editor.beginActionGroup();

  var markupId = editor.getId();
  var create = new _edit_actions_CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_2__.CreatePolycloud(
    editor,
    markupId,
    mousePosition,
    size,
    0,
    [{ x: 0, y: 0 }],
    this.style);

  create.execute();

  this.selectedMarkup = editor.getMarkup(markupId);
  this.creationBegin();
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseUp = function (event) {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseUp.call(this);

  if (!this.creating) {
    return;
  }

  this.dragging = false;

  // Creation process.
  var editor = this.editor;
  var mousePosition = editor.getMousePosition();
  var movements = this.movements;
  var closed = false;

  mousePosition = editor.clientToMarkups(mousePosition.x, mousePosition.y);

  if (movements.length > 1 &&
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__.areMarkupsPointsInClientRange)(movements[movements.length - 2], mousePosition, SNAP_RANGE, this.editor)) {
    return;
  }

  // Close polycloud if user clicks close to initial point.
  if (movements.length > 2 &&
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__.areMarkupsPointsInClientRange)(movements[0], mousePosition, SNAP_RANGE, this.editor)) {
    mousePosition = movements[0]; // Snap!
    closed = true;
  }

  movements.splice(movements.length - 1, 1);

  if (!closed) {
    movements.push(mousePosition);
    movements.push(mousePosition);
  }

  var polycloud = this.selectedMarkup;
  var locations = setPositionAndSize(movements, polycloud);
  var setPolycloud = new _edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_3__.SetPolycloud(
    editor,
    polycloud,
    polycloud.position,
    polycloud.size,
    locations,
    closed);

  setPolycloud.execute();

  if (closed) {
    this.creationEnd();
  }
};

proto.onMouseDoubleClick = function (event) {

  if (!this.creating) {
    return;
  }

  var movements = this.movements;
  movements.splice(Math.max(0, movements.length - 1));

  if (movements.length < 2) {

    this.creationCancel();
  } else {

    var polycloud = this.selectedMarkup;
    var locations = setPositionAndSize(movements, polycloud);
    var setPolycloud = new _edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_3__.SetPolycloud(
      this.editor,
      polycloud,
      polycloud.position,
      polycloud.size,
      locations,
      true);

    setPolycloud.execute();
    this.creationEnd();
  }
};

proto.destroy = function () {
  this.onMouseDoubleClick();
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationEnd.call(this);
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.destroy.call(this);
};

proto.creationEnd = function () {

  // To pass isMinSizeValid,
  // probably that test should be done with the markup size (not the recorded by the edit mode).
  if (this.selectedMarkup) {
    this.size.x = this.selectedMarkup.size.x;
    this.size.y = this.selectedMarkup.size.y;
  }

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationEnd.call(this);

  this.closed = false;
  this.movements = [];
  this.dragging = false;
  this.creating = false;
};

proto.creationCancel = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationCancel.call(this);

  this.closed = false;
  this.movements = [];
  this.dragging = false;
  this.creating = false;
};

function setPositionAndSize(locations, markup) {

  // determine the position of the top-left and bottom-right points
  var minFn = function (collection, key) {
    var targets = collection.map(function (item) {
      return item[key];
    });
    return Math.min.apply(null, targets);
  };

  var maxFn = function (collection, key) {
    var targets = collection.map(function (item) {
      return item[key];
    });
    return Math.max.apply(null, targets);
  };

  var strokeWidth = markup.style['stroke-width'];
  var radius = strokeWidth * 2 + strokeWidth * 0.5;

  var l = minFn(locations, 'x') - radius;
  var t = minFn(locations, 'y') - radius;
  var r = maxFn(locations, 'x') + radius;
  var b = maxFn(locations, 'y') + radius;
  var w = r - l;
  var h = b - t;

  markup.size = { x: w, y: h };
  markup.position = { x: l + w * 0.5, y: t + h * 0.5 };

  // Adjust points to relate from the shape's center
  var position = markup.position;
  return locations.map(function (point) {
    return {
      x: point.x - position.x,
      y: point.y - position.y
    };
  });
}

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModePolyline.js"
/*!***************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModePolyline.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModePolyline: () => (/* binding */ EditModePolyline)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeletePolyline_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeletePolyline.js */ "./extensions/Markup/core/edit-actions/DeletePolyline.js");
/* harmony import */ var _edit_actions_CreatePolyline_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreatePolyline.js */ "./extensions/Markup/core/edit-actions/CreatePolyline.js");
/* harmony import */ var _edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetPolyline.js */ "./extensions/Markup/core/edit-actions/SetPolyline.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");









var SNAP_RANGE = 25;

/**
 *
 * @param editor
 * @constructor
 */
function EditModePolyline(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_POLYLINE, styleAttributes);

  this.creationMethod = this.CREATION_METHOD_CLICKS;
  this.movements = [];
}

EditModePolyline.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModePolyline.prototype.constructor = EditModePolyline;

var proto = EditModePolyline.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var movements = this.movements;
    if (this.creating && movements.length >= 2) {
      movements.pop();
      movements.pop();
      var lastIndex = movements.length - 1;
      if (lastIndex >= 0) {
        // duplicate last location
        var lastMove = movements[lastIndex];
        movements.push(lastMove);
        var locations = setPositionAndSize(movements, this);
        var setPolyline = new _edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_3__.SetPolyline(
          this.editor,
          markup,
          this.position,
          this.size,
          locations);

        setPolyline.execute();
      }
    } else
    {
      var deletePolyline = new _edit_actions_DeletePolyline_js__WEBPACK_IMPORTED_MODULE_1__.DeletePolyline(this.editor, markup);
      deletePolyline.addToHistory = !cantUndo;
      deletePolyline.execute();
      this.creationEnd();
      return true;
    }
  }
  return false;
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }

  var selectedMarkup = this.selectedMarkup;

  var editor = this.editor;

  this.dragging = true;

  var movements = this.movements;
  movements.splice(movements.length - 1, 1);

  var mousePosition = editor.getMousePosition();
  mousePosition = editor.clientToMarkups(mousePosition.x, mousePosition.y);

  // Close polyline if user clicks close to initial point.
  if (movements.length >= 2 &&
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__.areMarkupsPointsInClientRange)(movements[0], mousePosition, SNAP_RANGE, this.editor)) {
    mousePosition = movements[0]; // Snap!
  }

  movements.push(mousePosition);

  var locations = setPositionAndSize(movements, this);
  var setPolyline = new _edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_3__.SetPolyline(
    editor,
    selectedMarkup,
    this.position,
    this.size,
    locations);

  setPolyline.execute();
  return true;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function (event) {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  // User selected an already created markup.
  if (this.selectedMarkup && !this.creating) {
    return;
  }

  if (this.creating) {
    return;
  }

  // Creation process.
  var editor = this.editor;
  var mousePosition = editor.getMousePosition();

  mousePosition = editor.clientToMarkups(mousePosition.x, mousePosition.y);

  var size = this.size = editor.sizeFromClientToMarkups(1, 1);
  this.movements = [mousePosition, mousePosition];

  editor.beginActionGroup();

  var markupId = editor.getId();
  var create = new _edit_actions_CreatePolyline_js__WEBPACK_IMPORTED_MODULE_2__.CreatePolyline(
    editor,
    markupId,
    mousePosition,
    size,
    0,
    [{ x: 0, y: 0 }],
    this.style);

  create.execute();

  this.selectedMarkup = editor.getMarkup(markupId);
  this.creationBegin();
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseUp = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseUp.call(this);

  if (!this.creating) {
    return;
  }

  this.dragging = false;

  // Creation process.
  var editor = this.editor;
  var mousePosition = editor.getMousePosition();
  var movements = this.movements;
  var closed = false;

  mousePosition = editor.clientToMarkups(mousePosition.x, mousePosition.y);

  if (movements.length > 1 &&
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__.areMarkupsPointsInClientRange)(movements[movements.length - 2], mousePosition, SNAP_RANGE, this.editor)) {
    return;
  }

  // Close polyline if user clicks close to initial point.
  if (movements.length > 2 &&
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_5__.areMarkupsPointsInClientRange)(movements[0], mousePosition, SNAP_RANGE, this.editor)) {
    mousePosition = movements[0]; // Snap!
    closed = true;
  }

  movements.splice(movements.length - 1, 1);

  if (!closed) {
    movements.push(mousePosition);
    movements.push(mousePosition);
  }

  var polyline = this.selectedMarkup;
  var locations = setPositionAndSize(movements, polyline);
  var setPolyline = new _edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_3__.SetPolyline(
    editor,
    polyline,
    polyline.position,
    polyline.size,
    locations,
    closed);

  setPolyline.execute();

  if (closed) {
    this.creationEnd();
  }
};

proto.destroy = function () {
  this.onMouseDoubleClick();
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationEnd.call(this);
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.destroy.call(this);
};

proto.creationEnd = function () {

  // To pass isMinSizeValid,
  // probably that test should be done with the markup size (not the recorded by the edit mode).
  if (this.selectedMarkup) {
    this.size.x = this.selectedMarkup.size.x;
    this.size.y = this.selectedMarkup.size.y;
  }

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationEnd.call(this);

  this.closed = false;
  this.movements = [];
  this.dragging = false;
  this.creating = false;
};

proto.creationCancel = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.creationCancel.call(this);

  this.closed = false;
  this.movements = [];
  this.dragging = false;
  this.creating = false;
};


proto.onMouseDoubleClick = function (event) {

  if (!this.creating) {
    return;
  }

  var movements = this.movements;
  movements.splice(Math.max(0, movements.length - 1));

  if (movements.length < 2) {

    this.creationCancel();
  } else {

    var polyline = this.selectedMarkup;
    var locations = setPositionAndSize(movements, polyline);
    var setPolyline = new _edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_3__.SetPolyline(
      this.editor,
      polyline,
      polyline.position,
      polyline.size,
      locations,
      this.closed);

    setPolyline.execute();
    this.creationEnd();
  }
};

function setPositionAndSize(locations, markup) {

  // determine the position of the top-left and bottom-right points
  var minFn = function (collection, key) {
    var targets = collection.map(function (item) {
      return item[key];
    });
    return Math.min.apply(null, targets);
  };

  var maxFn = function (collection, key) {
    var targets = collection.map(function (item) {
      return item[key];
    });
    return Math.max.apply(null, targets);
  };

  var l = minFn(locations, 'x');
  var t = minFn(locations, 'y');
  var r = maxFn(locations, 'x');
  var b = maxFn(locations, 'y');
  var w = r - l;
  var h = b - t;

  markup.size = { x: w, y: h };
  markup.position = { x: l + w * 0.5, y: t + h * 0.5 };

  // Adjust points to relate from the shape's center
  var position = markup.position;
  return locations.map(function (point) {
    return {
      x: point.x - position.x,
      y: point.y - position.y
    };
  });
}

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeRectangle.js"
/*!****************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeRectangle.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeRectangle: () => (/* binding */ EditModeRectangle)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteRectangle_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteRectangle.js */ "./extensions/Markup/core/edit-actions/DeleteRectangle.js");
/* harmony import */ var _edit_actions_CreateRectangle_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateRectangle.js */ "./extensions/Markup/core/edit-actions/CreateRectangle.js");
/* harmony import */ var _edit_actions_SetRectangle_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetRectangle.js */ "./extensions/Markup/core/edit-actions/SetRectangle.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");








var MeasureCommon = Autodesk.Viewing.MeasureCommon;

/**
 *
 * @param editor
 * @constructor
 */
function EditModeRectangle(editor) {

  var styleAttributes = ['stroke-width', 'stroke-color', 'stroke-opacity', 'fill-color', 'fill-opacity'];
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_RECTANGLE, styleAttributes);
}

EditModeRectangle.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeRectangle.prototype.constructor = EditModeRectangle;

var proto = EditModeRectangle.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var deleteRectangle = new _edit_actions_DeleteRectangle_js__WEBPACK_IMPORTED_MODULE_1__.DeleteRectangle(this.editor, markup);
    deleteRectangle.addToHistory = !cantUndo;
    deleteRectangle.execute();
    return true;
  }
  return false;
};

/**
 * Handler to mouse move events, used to create markups.
 * @param {MouseEvent} event Mouse event.
 * @private
 */
proto.onMouseMove = function (event) {

  if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
    return false;
  }

  var selectedMarkup = this.selectedMarkup;

  var editor = this.editor;

  var pos = this.getFinalMouseDraggingPosition();
  var final = editor.clientToMarkups(pos.x, pos.y);
  var position = { x: (this.firstCorner.x + final.x) / 2, y: (this.firstCorner.y + final.y) / 2 };

  var width, height;
  // Snap to parallel/perpendicular of underlying vectors
  if (editor.snapper && this.lineSnapped) {
    var start = editor.project(this.lineSnapped.vertices[0]);
    var end = editor.project(this.lineSnapped.vertices[1]);

    var startZ = start.z;

    start = editor.clientToMarkups(start.x, start.y);
    end = editor.clientToMarkups(end.x, end.y);

    start = new THREE.Vector3(start.x, start.y, startZ);
    end = new THREE.Vector3(end.x, end.y, startZ);

    var p = new THREE.Vector3(final.x, final.y, startZ);

    var parallel = MeasureCommon.nearestPointInPointToLine(p, start, end);
    height = p.distanceTo(parallel);

    // select an arbitrary point on the perpendicular line
    var k = -(start.x - end.x) / (start.y - end.y);
    var b = this.firstCorner.y - k * this.firstCorner.x;
    var x = this.firstCorner.x + 1;
    var y = k * x + b;
    var pEnd = new THREE.Vector3(x, y, startZ);

    var pStart = new THREE.Vector3(this.firstCorner.x, this.firstCorner.y, startZ);
    var perpendicular = MeasureCommon.nearestPointInPointToLine(p, pStart, pEnd);
    width = p.distanceTo(perpendicular);
  } else
  {
    width = final.x - this.firstCorner.x;
    height = final.y - this.firstCorner.y;
  }

  var size = this.size = { x: Math.abs(width), y: Math.abs(height) };

  var setRectangle = new _edit_actions_SetRectangle_js__WEBPACK_IMPORTED_MODULE_3__.SetRectangle(
    editor,
    selectedMarkup,
    position,
    size);

  setRectangle.execute();
  return true;
};

/**
 * Handler to mouse down events, used to start markups creation.
 * @private
 */
proto.onMouseDown = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;
  var mousePosition = editor.getMousePosition();

  this.initialX = mousePosition.x;
  this.initialY = mousePosition.y;

  // Calculate center and size.
  var position = this.firstCorner = editor.clientToMarkups(this.initialX, this.initialY);
  var size = this.size = editor.sizeFromClientToMarkups(1, 1);

  // Calculate rotation
  var rotation = 0;
  this.lineSnapped = null;
  if (editor.snapper) {
    // Snap to parallel/perpendicular of underlying vectors
    var geomType = editor.snapper.getGeometryType();
    if (geomType === MeasureCommon.SnapType.SNAP_EDGE) {
      this.lineSnapped = editor.snapper.getEdge();
      var start = editor.project(this.lineSnapped.vertices[0]);
      var end = editor.project(this.lineSnapped.vertices[1]);
      var dx = end.x - start.x;
      var dy = end.y - start.y;
      rotation = this.rotation = Math.atan2(dy, dx);
    }
  }

  // Create rectangle.
  editor.beginActionGroup();

  var markupId = editor.getId();
  var create = new _edit_actions_CreateRectangle_js__WEBPACK_IMPORTED_MODULE_2__.CreateRectangle(
    editor,
    markupId,
    position,
    size,
    rotation,
    this.style);

  create.execute();

  this.selectedMarkup = editor.getMarkup(markupId);
  this.creationBegin();
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeStamp.js"
/*!************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeStamp.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeStamp: () => (/* binding */ EditModeStamp)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteStamp_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteStamp.js */ "./extensions/Markup/core/edit-actions/DeleteStamp.js");
/* harmony import */ var _edit_actions_CreateStamp_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/CreateStamp.js */ "./extensions/Markup/core/edit-actions/CreateStamp.js");
/* harmony import */ var _edit_actions_SetStamp_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/SetStamp.js */ "./extensions/Markup/core/edit-actions/SetStamp.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");










class EditModeStamp extends _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode {
  constructor(editor, svgData) {
    var styleAttributes = [
    'text-data'];

    super(editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_4__.MARKUP_TYPE_STAMP, styleAttributes);
    this.svgData = svgData;
  }

  deleteMarkup(markup, cantUndo) {
    markup = markup || this.selectedMarkup;
    if (markup && markup.type == this.type) {
      var deleteStamp = new _edit_actions_DeleteStamp_js__WEBPACK_IMPORTED_MODULE_1__.DeleteStamp(this.editor, markup);
      deleteStamp.addToHistory = !cantUndo;
      deleteStamp.execute();
      return true;
    }
    return false;
  }

  onMouseMove(event) {
    if (!_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseMove.call(this, event)) {
      return false;
    }

    const { selectedMarkup, editor } = this;

    let final = this.getFinalMouseDraggingPosition();
    final = editor.clientToMarkups(final.x, final.y);
    let position = {
      x: (this.firstPosition.x + final.x) / 2,
      y: (this.firstPosition.y + final.y) / 2
    };
    let size = this.size = {
      x: Math.abs(final.x - this.firstPosition.x),
      y: Math.abs(final.y - this.firstPosition.y)
    };

    const action = new _edit_actions_SetStamp_js__WEBPACK_IMPORTED_MODULE_3__.SetStamp(editor, selectedMarkup, position, size);
    action.execute();
    return true;
  }

  onMouseDown() {
    _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onMouseDown.call(this);

    if (this.selectedMarkup) {
      return;
    }

    const editor = this.editor;
    let mousePosition = editor.getMousePosition();

    this.initialX = mousePosition.x;
    this.initialY = mousePosition.y;
    this.firstPosition = editor.clientToMarkups(this.initialX, this.initialY);
    this.size = editor.sizeFromClientToMarkups(1, 1);

    editor.beginActionGroup();
    const markupId = editor.getId();
    const action = new _edit_actions_CreateStamp_js__WEBPACK_IMPORTED_MODULE_2__.CreateStamp(editor, markupId, this.firstPosition, this.size, 0, this.style, this.svgData);
    action.execute();

    // maybe this isn't being called right, that would explain it
    this.selectedMarkup = editor.getMarkup(markupId);
    this.creationBegin();
  }
}

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditModeText.js"
/*!***********************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditModeText.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditModeText: () => (/* binding */ EditModeText)
/* harmony export */ });
/* harmony import */ var _EditMode_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _edit_actions_DeleteText_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../edit-actions/DeleteText.js */ "./extensions/Markup/core/edit-actions/DeleteText.js");
/* harmony import */ var _edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../edit-actions/DeleteCallout.js */ "./extensions/Markup/core/edit-actions/DeleteCallout.js");
/* harmony import */ var _edit_actions_CreateText_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../edit-actions/CreateText.js */ "./extensions/Markup/core/edit-actions/CreateText.js");
/* harmony import */ var _edit_actions_SetText_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../edit-actions/SetText.js */ "./extensions/Markup/core/edit-actions/SetText.js");
/* harmony import */ var _edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../edit-actions/SetSize.js */ "./extensions/Markup/core/edit-actions/SetSize.js");
/* harmony import */ var _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../edit-actions/SetStyle.js */ "./extensions/Markup/core/edit-actions/SetStyle.js");
/* harmony import */ var _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _MarkupEvents_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ../MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _EditorTextInput_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./EditorTextInput.js */ "./extensions/Markup/core/edit-modes/EditorTextInput.js");














/**
 *
 * @param editor
 * @constructor
 */
function EditModeText(editor) {

  var styleAttributes = [
  'font-size',
  'stroke-color',
  'stroke-opacity',
  'fill-color',
  'fill-opacity',
  'font-family',
  'font-style',
  'font-weight'];

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.call(this, editor, _MarkupTypes_js__WEBPACK_IMPORTED_MODULE_7__.MARKUP_TYPE_TEXT, styleAttributes);

  var helper = new _EditorTextInput_js__WEBPACK_IMPORTED_MODULE_9__.EditorTextInput(this.viewer.container, this.editor, false, 'Text', 260);
  helper.addEventListener(helper.EVENT_TEXT_CHANGE, this.onHelperTextChange.bind(this), false);
  helper.addEventListener(helper.EVENT_TEXT_SET_ACTIVE, this.onHelperSetActive.bind(this), false);
  helper.addEventListener(helper.EVENT_TEXT_SET_INACTIVE, this.onHelperSetActive.bind(this), false);

  this.textInputHelper = helper;
  this.onHistoryChangeBinded = this.onHistoryChange.bind(this);
  this.minSize = 0; // No need to size it initially
  this.creationMethod = this.CREATION_METHOD_CLICK;
}

EditModeText.prototype = Object.create(_EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype);
EditModeText.prototype.constructor = EditModeText;

var proto = EditModeText.prototype;

proto.deleteMarkup = function (markup, cantUndo) {

  markup = markup || this.selectedMarkup;
  if (markup && markup.type == this.type) {
    var deleteText = new _edit_actions_DeleteText_js__WEBPACK_IMPORTED_MODULE_1__.DeleteText(this.editor, markup);
    deleteText.addToHistory = !cantUndo;
    deleteText.execute();
    return true;
  }
  return false;
};

/**
 *
 * @param style
 */
proto.setStyle = function (style) {

  if (this.textInputHelper && this.textInputHelper.isActive()) {

    this.textInputHelper.setStyle(style);
  } else {
    _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.setStyle.call(this, style);
  }
};

proto.notifyAllowNavigation = function (allows) {

  if (allows && this.textInputHelper && this.textInputHelper.isActive()) {
    this.textInputHelper.acceptAndExit();
  }
};

proto.destroy = function () {

  if (this.textInputHelper) {
    if (this.textInputHelper.isActive()) {
      this.textInputHelper.acceptAndExit();
    }
    this.textInputHelper.destroy();
    this.textInputHelper = null;
  }
  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.destroy.call(this);
};

/**
 * Handler to mouse down events, used to start markups creation.
 */
proto.onMouseDown = function () {

  if (this.textInputHelper && this.textInputHelper.isActive()) {
    this.textInputHelper.acceptAndExit();
    return;
  }

  if (this.selectedMarkup) {
    return;
  }

  var editor = this.editor;
  var mousePosition = editor.getMousePosition();
  var clientFontSize = editor.sizeFromMarkupsToClient(0, this.style['font-size']).y;
  var initialWidth = clientFontSize * 15; // Find better way to initialize size.
  var initialHeight = clientFontSize * 1;

  // Center position.
  var size = this.size = editor.sizeFromClientToMarkups(initialWidth, initialHeight);
  var position = editor.positionFromClientToMarkups(
    mousePosition.x + initialWidth * 0.5,
    mousePosition.y + initialHeight * 0.5);

  this.creationBegin();
  editor.beginActionGroup();

  // Given the initial width and font size, we assume that the text fits in one line.
  var createText = new _edit_actions_CreateText_js__WEBPACK_IMPORTED_MODULE_3__.CreateText(
    editor,
    editor.getId(),
    position,
    size,
    '',
    this.style);

  createText.execute();
  this.creationEnd();

  this.selectedMarkup = editor.getMarkup(createText.targetId);
  this.textInputHelper && this.textInputHelper.setActive(this.selectedMarkup, true);
  this.editor.actionManager.addEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_8__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
};

proto.updateTextBoxStyle = function () {
  if (this.isTextInputHelperActive()) {
    this.textInputHelper.onCameraChanged();
  }
};

proto.onMouseUp = function (event) {

};

proto.onMouseDoubleClick = function (markup) {

  if (markup === this.selectedMarkup) {
    this.editor.selectMarkup(markup);
    this.editor.editFrame.setMarkup(markup);
    this.textInputHelper && this.textInputHelper.setActive(markup, false);
  }
};

proto.onHelperSetActive = function (event) {
  var databag = event.data;
  var markup = databag.markup;
  if (markup) {
    markup.setIsHelperTextActive(databag.isActive);
    markup.setIsShapeVisible(!databag.isActive);
  }
};

proto.onHelperTextChange = function (event) {

  var dataBag = event.data;
  var textMarkup = dataBag.markup;
  var textStyle = dataBag.style;
  var curSelection = this.selectedMarkup;

  this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_8__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);

  // Deal with edge case first: Creating a Label without text
  if (dataBag.newText === '') {
    this.editor.cancelActionGroup();

    var deleteCallout = new _edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_2__.DeleteCallout(this.editor, textMarkup);
    deleteCallout.execute();

    if (textMarkup !== curSelection) {
      this.editor.selectMarkup(curSelection);
    }

    return;
  }

  // When the text is created for the first time, an action group
  // is already created and it includes the CreateText action.
  // Thus, no need to begin another action group.
  if (!dataBag.firstEdit) {
    this.editor.beginActionGroup();
  }

  // Size change action //
  var position = this.editor.positionFromClientToMarkups(
    dataBag.newPos.x, dataBag.newPos.y
  );
  var size = this.editor.sizeFromClientToMarkups(
    dataBag.width, dataBag.height
  );
  var setSize = new _edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_5__.SetSize(
    this.editor,
    textMarkup,
    position,
    size.x,
    size.y);
  setSize.execute();

  // Text change action //
  var setText = new _edit_actions_SetText_js__WEBPACK_IMPORTED_MODULE_4__.SetText(
    this.editor,
    textMarkup,
    textMarkup.position,
    textMarkup.size,
    dataBag.newText);
  setText.execute();

  var setStyle = new _edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_6__.SetStyle(
    this.editor,
    textMarkup,
    textStyle
  );
  setStyle.execute();

  // However, we do need to close the action group at this point. For both cases.
  this.editor.closeActionGroup();
  this.editor.selectMarkup(curSelection);
};

/**
 * We want to make sure that the Input Helper gets removed from the screen
 * whenever the user attempts to perform an undo or redo action.
 * @param {Event} event
 * @private
 */
proto.onHistoryChange = function (event) {

  if (this.textInputHelper && this.textInputHelper.isActive()) {
    this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_8__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
    this.textInputHelper.setInactive();
  }
};

/**
 * Notify the markup that the displayed markups are being saved so edit mode can finish current editions.
 */
proto.onSave = function () {

  _EditMode_js__WEBPACK_IMPORTED_MODULE_0__.EditMode.prototype.onSave.call(this);

  // Close input helper if it's open.
  if (this.textInputHelper && this.textInputHelper.isActive()) {
    var firstEdit = this.textInputHelper.firstEdit;

    this.editor.actionManager.removeEventListener(_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_8__.EVENT_HISTORY_CHANGED, this.onHistoryChangeBinded);
    this.textInputHelper.setInactive();

    // Close action group if open (first edit).s
    if (firstEdit) {
      this.editor.cancelActionGroup();
    }

    this.editor.selectMarkup(null);
    this.selectedMarkup = null;
  }
};

proto.updateTextBoxStyle = function () {
  if (this.isTextInputHelperActive()) {
    this.textInputHelper.onCameraChanged();
  }
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditorTextAutosize.js"
/*!*****************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditorTextAutosize.js ***!
  \*****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   autosize: () => (/* binding */ autosize)
/* harmony export */ });



/*!
    Based on Autosize 4.0.0
    license: MIT
    http://www.jacklmoore.com/autosize
*/
var map = typeof Map === "function" ? new Map() : function () {
  var keys = [];
  var values = [];

  return {
    has: function has(key) {
      return keys.indexOf(key) > -1;
    },
    get: function get(key) {
      return values[keys.indexOf(key)];
    },
    set: function set(key, value) {
      if (keys.indexOf(key) === -1) {
        keys.push(key);
        values.push(value);
      }
    },
    'delete': function _delete(key) {
      var index = keys.indexOf(key);
      if (index > -1) {
        keys.splice(index, 1);
        values.splice(index, 1);
      }
    }
  };
}();

var createEvent = function createEvent(name) {
  return new Event(name, { bubbles: true });
};

function assign(ta) {
  if (!ta || !ta.nodeName || ta.nodeName !== 'TEXTAREA' || map.has(ta)) return;

  var heightOffset = null;
  var clientWidth = ta.clientWidth;
  var cachedHeight = null;

  const self = this;
  function init() {
    const _window = self.getWindow();
    var style = _window.getComputedStyle(ta, null);

    if (style.resize === 'vertical') {
      ta.style.resize = 'none';
    } else if (style.resize === 'both') {
      ta.style.resize = 'horizontal';
    }

    if (style.boxSizing === 'content-box') {
      heightOffset = -(parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
    } else {
      heightOffset = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    }
    // Fix when a textarea is not on document body and heightOffset is Not a Number
    if (isNaN(heightOffset)) {
      heightOffset = 0;
    }

    update();
  }

  function changeOverflow(value) {
    {
      // Chrome/Safari-specific fix:
      // When the textarea y-overflow is hidden, Chrome/Safari do not reflow the text to account for the space
      // made available by removing the scrollbar. The following forces the necessary text reflow.
      var width = ta.style.width;
      ta.style.width = '0px';
      // Force reflow:
      /* jshint ignore:start */
      ta.offsetWidth;
      /* jshint ignore:end */
      ta.style.width = width;
    }

    ta.style.overflow = value;
  }

  function getParentOverflows(el) {
    var arr = [];

    while (el && el.parentNode && el.parentNode instanceof Element) {
      if (el.parentNode.scrollTop) {
        arr.push({
          node: el.parentNode,
          scrollTop: el.parentNode.scrollTop
        });
      }
      el = el.parentNode;
    }

    return arr;
  }

  function resize() {
    var originalHeight = ta.style.height;
    var overflows = getParentOverflows(ta);
    const _document = self.getDocument();
    var docTop = _document.documentElement && _document.documentElement.scrollTop; // Needed for Mobile IE (ticket #240)

    ta.style.height = '';

    var endHeight = ta.scrollHeight + heightOffset;

    if (ta.scrollHeight === 0) {
      // If the scrollHeight is 0, then the element probably has display:none or is detached from the DOM.
      ta.style.height = originalHeight;
      return;
    }

    ta.style.height = endHeight + 'px';

    // used to check if an update is actually necessary on window.resize
    clientWidth = ta.clientWidth;

    // prevents scroll-position jumping
    overflows.forEach(function (el) {
      // This condition is necessary for iOS 11, where you can't assign value to body.scrollTop
      if (el.node.scrollTop !== el.scrollTop) {
        el.node.scrollTop = el.scrollTop;
      }
    });

    if (docTop) {
      _document.documentElement.scrollTop = docTop;
    }
  }

  function update() {
    resize();

    const _window = self.getWindow();
    var styleHeight = Math.round(parseFloat(ta.style.height));
    var computed = _window.getComputedStyle(ta, null);

    // Using offsetHeight as a replacement for computed.height in IE, because IE does not account use of border-box
    var actualHeight = computed.boxSizing === 'content-box' ? Math.round(parseFloat(computed.height)) : ta.offsetHeight;

    // The actual height not matching the style height (set via the resize method) indicates that
    // the max-height has been exceeded, in which case the overflow should be allowed.
    if (actualHeight !== styleHeight) {
      if (computed.overflow === 'hidden') {
        changeOverflow('scroll');
        resize();
        actualHeight = computed.boxSizing === 'content-box' ? Math.round(parseFloat(window.getComputedStyle(ta, null).height)) : ta.offsetHeight;
      }
    } else {
      // Normally keep overflow set to hidden, to avoid flash of scrollbar as the textarea expands.
      if (computed.overflow !== 'hidden') {
        changeOverflow('hidden');
        resize();
        actualHeight = computed.boxSizing === 'content-box' ? Math.round(parseFloat(window.getComputedStyle(ta, null).height)) : ta.offsetHeight;
      }
    }

    if (cachedHeight !== actualHeight) {
      cachedHeight = actualHeight;
      var evt = createEvent('autosize:resized');
      try {
        ta.dispatchEvent(evt);
      } catch (err) {


        // Firefox will throw an error on dispatchEvent for a detached element
        // https://bugzilla.mozilla.org/show_bug.cgi?id=889376
      }}}

  var pageResize = function pageResize() {
    if (ta.clientWidth !== clientWidth) {
      update();
    }
  };

  var destroy = function (style) {
    self.removeWindowEventListener('resize', pageResize, false);
    ta.removeEventListener('input', update, false);
    ta.removeEventListener('keyup', update, false);
    ta.removeEventListener('autosize:destroy', destroy, false);
    ta.removeEventListener('autosize:update', update, false);

    Object.keys(style).forEach(function (key) {
      ta.style[key] = style[key];
    });

    map['delete'](ta);
  }.bind(ta, {
    height: ta.style.height,
    resize: ta.style.resize,
    overflow: ta.style.overflow,
    overflowX: ta.style.overflowX,
    wordWrap: ta.style.wordWrap
  });

  ta.addEventListener('autosize:destroy', destroy, false);

  // IE9 does not fire onpropertychange or oninput for deletions,
  // so binding to onkeyup to catch most of those events.
  // There is no way that I know of to detect something like 'cut' in IE9.
  if ('onpropertychange' in ta && 'oninput' in ta) {
    ta.addEventListener('keyup', update, false);
  }

  self.addWindowEventListener('resize', pageResize, false);
  ta.addEventListener('input', update, false);
  ta.addEventListener('autosize:update', update, false);
  ta.style.overflowX = 'hidden';
  ta.style.wordWrap = 'break-word';

  map.set(ta, {
    destroy: destroy,
    update: update
  });

  init();
}

function destroy(ta) {
  var methods = map.get(ta);
  if (methods) {
    methods.destroy();
  }
}

function update(ta) {
  var methods = map.get(ta);
  if (methods) {
    methods.update();
  }
}

function isRuntimeSupported() {
  // Don't support Node.js and IE8 (or lower)
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function')
  return false;
  return true;
}

const RUNTIME_SUPPORTED = isRuntimeSupported();


var autosize = function (el, options) {
  const self = this;
  if (RUNTIME_SUPPORTED && el) {
    Array.prototype.forEach.call(el.length ? el : [el], function (x) {
      return assign.bind(self)(x, options);
    });
  }
  return el;
};

autosize.destroy = function (el) {
  if (RUNTIME_SUPPORTED && el) {
    Array.prototype.forEach.call(el.length ? el : [el], destroy);
  }
  return el;
};

autosize.update = function (el) {
  if (RUNTIME_SUPPORTED && el) {
    Array.prototype.forEach.call(el.length ? el : [el], update);
  }
  return el;
};

/***/ },

/***/ "./extensions/Markup/core/edit-modes/EditorTextInput.js"
/*!**************************************************************!*\
  !*** ./extensions/Markup/core/edit-modes/EditorTextInput.js ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EditorTextInput: () => (/* binding */ EditorTextInput)
/* harmony export */ });
/* harmony import */ var _EditorTextAutosize_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./EditorTextAutosize.js */ "./extensions/Markup/core/edit-modes/EditorTextAutosize.js");
/* harmony import */ var _MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _DomElementStyle_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../DomElementStyle.js */ "./extensions/Markup/core/DomElementStyle.js");







const av = Autodesk.Viewing;

/**
 * Auxiliary class that handles all input for the Label Markup (MarkupText.js)
 * It instantiates a TEXTAREA where the user can input text. When user input is
 * disabled, the textarea gets hidden and further rendering is delegated to
 * MarkupText.js
 *
 * @param {HTMLElement} parentDiv
 * @param {Object} editor - Core Extension
 * @constructor
 */
function EditorTextInput(parentDiv, editor, singleLine, defaultText, maxLength) {

  this.parentDiv = parentDiv;
  this.editor = editor;
  this.setGlobalManager(editor.viewer.globalManager);

  // Constants
  this.EVENT_TEXT_CHANGE = 'EVENT_CO2_TEXT_CHANGE';
  this.EVENT_TEXT_SET_ACTIVE = 'EVENT_CO2_TEXT_SET_ACTIVE';
  this.EVENT_TEXT_SET_INACTIVE = 'EVENT_CO2_TEXT_SET_INACTIVE';

  const _document = this.getDocument();
  // The actual TextArea input
  if (singleLine) {
    this.textArea = _document.createElement('input');
    this.textArea.setAttribute('type', 'text');
  } else
  {
    this.textArea = _document.createElement('textarea');
    this.textArea.rows = '1';
    this.textArea.dir = 'auto';
  }

  this.firstEdit = true;
  this.defaultText = defaultText;
  this.textArea.setAttribute('maxlength', maxLength); // TODO: Make constant? Change value?
  this.textArea.setAttribute('data-i18n', defaultText);
  this.startingHeight = 0;

  _EditorTextAutosize_js__WEBPACK_IMPORTED_MODULE_0__.autosize.bind(this)(this.textArea);

  var ro = new ResizeObserver(function (entries, observer) {
    this.setEditFrame();
  }.bind(this));

  ro.observe(this.textArea);

  this.styleTextArea = new _DomElementStyle_js__WEBPACK_IMPORTED_MODULE_3__.DomElementStyle(); // TODO: Move this to EditMode.
  this.styleTextArea.
  setAttribute('position', 'absolute').
  setAttribute('resize', 'none').
  setAttribute('box-sizing', 'border-box').
  setAttribute('-moz-box-sizing', 'border-box').
  setAttribute('-webkit-box-sizing', 'border-box').
  setAttribute('overflow', 'hidden').
  setAttribute('outline', 'none').
  setAttribute('border', 'none').
  setAttribute('z-index', '1').
  setAttribute('padding', '10px');

  // Helper div to measure text width
  this.measureDiv = _document.createElement('div');

  // Become an event dispatcher
  (0,_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_1__.addTraitEventDispatcher)(this);
}

av.GlobalManagerMixin.call(EditorTextInput.prototype);
var proto = EditorTextInput.prototype;

proto.destroy = function () {

  this.setInactive();
};

/**
 * Initializes itself given an Label Markup (textMarkup)
 * @param {Object} textMarkup
 * @param {Boolean} firstEdit - Whether the markup is being edited for the first time.
 */
proto.setActive = function (textMarkup, firstEdit) {

  if (this.textMarkup === textMarkup) {
    return;
  }

  var placeholderText = Autodesk.Viewing.i18n.translate(this.defaultText);
  this.textArea.setAttribute('placeholder', placeholderText);

  this.setInactive();
  this.parentDiv.appendChild(this.textArea);
  this.textMarkup = textMarkup;
  this.firstEdit = firstEdit || false;

  this.constrainToCanvas = firstEdit;

  this.initFromMarkup();

  this.constrainToCanvas = false;

  // On iOS this doesn't work quite well, the keyboard will dismiss after call focus programatically.
  // http://stackoverflow.com/questions/32407185/wkwebview-cant-open-keyboard-for-input-field
  if (!Autodesk.Viewing.isIOSDevice()) {
    // Focus on next frame
    var txtArea = this.textArea;
    const _window = this.getWindow();
    _window.requestAnimationFrame(function () {
      txtArea.focus();
    });
  }

  var dataBag = {
    markup: this.textMarkup,
    firstEdit: this.firstEdit,
    isActive: true
  };
  this.dispatchEvent({ type: this.EVENT_TEXT_SET_ACTIVE, data: dataBag });
};

/**
 * Closes the editor text input and goes back into normal markup edition mode.
 */
proto.setInactive = function () {
  var dataBag = {
    markup: this.textMarkup,
    isActive: false
  };

  // In iOS10, the keyboard always show on screen after tap screen out of text
  // area or save markup to end text edit, call blur to make sure keyboard dismiss.
  if (Autodesk.Viewing.isIOSDevice())
  {
    this.textArea.blur();
  }

  this.removeWindowEventListener('resize', this.onResizeBinded);

  if (this.textMarkup) {
    this.textMarkup = null;
    this.parentDiv.removeChild(this.textArea);
  }
  this.style = null;

  this.dispatchEvent({ type: this.EVENT_TEXT_SET_INACTIVE, data: dataBag });
};

proto.isActive = function () {

  return !!this.textMarkup;
};

proto.setEditFrame = function () {
  if (this.editor.editFrame.markup && this.textMarkup && this.editor.editFrame.markup === this.textMarkup) {
    var frameWidth = parseFloat(this.textArea.style.width);
    var frameHeight = parseFloat(this.textArea.style.height);

    var position = this.textMarkup.getClientPosition();
    var rotation = this.textMarkup.getRotation();

    var xPos = position.x - frameWidth / 2;
    var yPos = position.y - this.startingHeight / 2;

    this.editor.editFrame.setSelection(xPos, yPos, frameWidth, frameHeight, rotation);
  }
};

/**
 * Applies Markup styles to TextArea used for editing.
 * It also saves a copy of the style object.
 * @private
 */
proto.initFromMarkup = function (updateStyleFirst) {

  var markup = this.textMarkup;
  var position = markup.getClientPosition();
  var size = markup.getClientSize();

  // Text area padding is relative to the current font size
  var padding = markup.getClientFontSize() / 2;

  this.startingHeight = size.y;

  var left = position.x - size.x * 0.5;
  var top = position.y - size.y * 0.5;

  var lineHeightPercentage = markup.lineHeight + "%";
  this.styleTextArea.setAttribute('line-height', lineHeightPercentage);
  this.styleTextArea.setAttribute('padding', padding + 'px');

  this.setPosAndSize(left, top, size.x, size.y);
  if (updateStyleFirst) {
    this.setStyle(markup.getStyle());
    this.textArea.value = markup.getText();
  } else {
    this.textArea.value = markup.getText();
    this.setStyle(markup.getStyle());
  }
};

proto.setPosAndSize = function (left, top, width, height) {
  if (this.constrainToCanvas) {
    // Check that it doesn't overflow out of the canvas
    if (left + width >= this.editor.viewer.container.clientWidth) {
      left = this.editor.viewer.container.clientWidth - (width + 10);
    }
    if (top + height >= this.editor.viewer.container.clientHeight) {
      top = this.editor.viewer.container.clientHeight - (height + 10);
    }

    // Make sure text input left side always in the canvas area.
    // Especially on iPhone6 & iPhone7
    if (left < 5) {
      left = 5;
      width = this.editor.viewer.container.clientWidth - 10;
    }
  }

  this.styleTextArea
  // Size and position
  .setAttribute('left', left + 'px').
  setAttribute('top', top + 'px').
  setAttribute('width', width + 'px').
  setAttribute('height', height + 'px');
};

proto.setStyle = function (style) {

  if (this.style) {
    // An already present style means that the user
    // has changed the style using the UI buttons.
    // We need to account for the user having changed the
    // width/height of the TextArea. Since there is no event
    // we can detect for it, we do it here.
    var temp = {};
    this.injectSizeValues(temp);
    this.setPosAndSize(
      temp.newPos.x - temp.width * 0.5,
      temp.newPos.y - temp.height * 0.5,
      temp.width, temp.height);
  }
  var fontHeight = this.editor.sizeFromMarkupsToClient(0, style['font-size']).y;
  var strokeWidth = this.editor.sizeFromMarkupsToClient(0, style['stroke-width']).y;
  var textAreaStyle = this.styleTextArea
  // Visuals
  .setAttribute('color', style['stroke-color']).
  setAttribute('outline', strokeWidth + 'px solid ' + style['stroke-color']).
  setAttribute('font-family', style['font-family']).
  setAttribute('font-size', fontHeight + 'px').
  setAttribute('font-weight', style['font-weight']).
  setAttribute('font-style', style['font-style']).
  getStyleString();
  this.textArea.setAttribute('style', textAreaStyle);
  this.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(style);
  _EditorTextAutosize_js__WEBPACK_IMPORTED_MODULE_0__.autosize.update(this.textArea);
};

/**
 * Helper function that, for a given markup with some text in it
 * returns an Array of lines in it.
 * @param {Object} markup
 * @returns {{text, lines}|{text: String, lines: Array.<String>}}
 */
proto.getTextValuesForMarkup = function (markup, sizeUpdateRequired) {
  var active = this.isActive();
  var activeMarkup = this.textMarkup;
  var activeFirstEdit = this.firstEdit;

  this.setActive(markup, false);
  var textValues = this.getTextValues();

  var dataBag = {
    markup: markup,
    textValues: textValues
  };

  if (active) {
    this.setActive(activeMarkup, activeFirstEdit);
  } else {
    if (sizeUpdateRequired) {
      this.injectSizeValues(dataBag);
    }

    this.setInactive();
  }

  return dataBag;
};

/**
 * Returns the current text as one string and an array of lines
 * of how the text is being rendered (1 string per line)
 * @returns {{text: String, lines: Array.<String>}}
 */
proto.getTextValues = function () {

  var newText = this.textArea.value;
  if (newText === this.defaultText) {
    newText = '';
  }
  return {
    text: newText,
    lines: this.generateLines()
  };
};

/**
 * Function called by UI
 */
proto.acceptAndExit = function () {

  // If placeholder text, then remove.
  var textValues = this.getTextValues();
  var textMarkup = this.textMarkup;

  var dataBag = {
    markup: this.textMarkup,
    style: this.style,
    firstEdit: this.firstEdit,
    newText: textValues.text,
    newLines: textValues.lines
  };
  this.injectSizeValues(dataBag);

  this.dispatchEvent({ type: this.EVENT_TEXT_CHANGE, data: dataBag });
  this.setInactive();
  textMarkup.updateStyle(true); // Hack: LMV-3628
};

/**
 * Injects position, width and height of the textarea rect
 * @param {Object} dataBag
 * @private
 */
proto.injectSizeValues = function (dataBag) {

  // Explicit usage of parseFloat to remove the 'px' suffix.
  var width = parseFloat(this.textArea.style.width);
  var height = parseFloat(this.textArea.style.height);
  var ox = parseFloat(this.textArea.style.left);
  var oy = parseFloat(this.textArea.style.top);

  dataBag.width = width;
  dataBag.height = height;
  dataBag.newPos = {
    x: ox + width * 0.5,
    y: oy + height * 0.5
  };
};

/**
 * Handler for when the camera moves
 * @param {Object} event - Camera moves event
 * @private
 */
proto.onCameraChanged = function (event) {
  var str = this.textArea.value;
  this.textMarkup.style = (0,_StyleUtils_js__WEBPACK_IMPORTED_MODULE_2__.cloneStyle)(this.style);
  this.style = null; // TODO: Revisit this code because style changes are lost by doing this.
  this.initFromMarkup(true);
  this.textArea.value = str;
  this.setEditFrame();
};

/**
 * Grabs the text content of the textarea and returns
 * an Array of lines.  Wrapped lines are returned as 2 lines.
 */
proto.generateLines = function () {

  // First, get lines separated by line breaks:
  var textContent = this.textArea.value;
  var linesBreaks = textContent.split(/\r*\n/);

  var styleMeasureStr = this.styleTextArea.clone().
  removeAttribute(['top', 'left', 'width', 'height']).
  setAttribute('position', 'absolute').
  setAttribute('white-space', 'nowrap').
  setAttribute('float', 'left').
  setAttribute('visibility', 'hidden').
  getStyleString();
  this.measureDiv.setAttribute('style', styleMeasureStr);
  this.parentDiv.appendChild(this.measureDiv);

  var maxLineLength = this.textArea.clientWidth - 2 * parseFloat(this.textArea.style.padding);

  // Now check whether the lines are wrapped.
  // If so, subdivide into other lines.
  var linesOutput = [];

  for (var i = 0, len = linesBreaks.length; i < len; ++i) {
    var line = trimRight(linesBreaks[i]);

    // Add a space in an empty line so it appears in the lines output
    line = line === '' ? ' ' : line;
    this.splitLine(line, maxLineLength, linesOutput);
  }

  this.parentDiv.removeChild(this.measureDiv);
  return linesOutput;
};

/**
 * Given a String that represents one line of text that is
 * longer than the max length a line is allowed, this method
 * cuts text into several ones that are no longer than the max
 * length.
 *
 * @param {String} text
 * @param {Number} maxLength
 * @param {Array} output
 * @private
 */
proto.splitLine = function (text, maxLength, output) {

  // End condition
  if (text === '') {
    return;
  }

  var remaining = '';
  var done = false;

  while (!done) {
    this.measureDiv.innerText = text;
    var lineLen = this.measureDiv.clientWidth - 2 * parseFloat(this.measureDiv.style.padding);
    if (lineLen <= maxLength) {
      output.push(text);
      this.splitLine(trimLeft(remaining), maxLength, output);
      done = true;
    } else {
      // Need to try with a shorter word!
      var parts = this.getShorterLine(text);
      if (parts.length === 1) {
        // text is only one word that is way too long.
        this.splitWord(text, remaining, maxLength, output);
        done = true;
      } else {
        text = parts[0];
        remaining = parts[1] + remaining;
      }
    }
  }
};

/**
 * Given a line of text such as "hi there programmer", it returns
 * an array with 2 parts: ["hi there", " programmer"].
 *
 * It accounts for special cases with multi-spaces, such as for
 * "hi there  two-spaces" returns ["hi there", "  two-spaces"]
 *
 * When there is only one word, it returns the whole word:
 * "JustOneWord" returns ["JustOneWord"] (an array of 1 element)
 *
 * @param {String} line
 * @returns {Array}
 */
proto.getShorterLine = function (line) {

  // TODO: Account for TABs
  // Will probably never do unless a bug is reported.

  var iLastSpace = line.lastIndexOf(' ');
  if (iLastSpace === -1) {
    return [line]; // This is a single word
  }

  // Else
  // Iterate back removing additional spaces (multi spaces)
  while (line.charAt(iLastSpace - 1) === ' ') {
    iLastSpace--;
  }

  var trailingWord = line.substr(iLastSpace); // Contains the spaces
  var shorterLine = line.substr(0, iLastSpace);
  return [shorterLine, trailingWord];
};

/**
 * Given a single word, splits it into multiple lines that fits in maxWidth
 * @param {String} word
 * @param {String} remaining
 * @param {Number} maxLength
 * @param {Array} output
 */
proto.splitWord = function (word, remaining, maxLength, output) {

  var lenSoFar = 1;
  var fits = true;
  while (fits) {

    var part = word.substr(0, lenSoFar);
    this.measureDiv.innerText = part;
    var lineLen = this.measureDiv.clientWidth - 2 * parseFloat(this.measureDiv.style.padding);

    if (lineLen > maxLength) {

      if (lenSoFar === 1) {
        // we can't split 1 character any longer.
        output.push(part);
        this.splitWord(word.substr(1), remaining, maxLength, output);
        return;
      }

      // It was fine until one less char //
      var okayWord = word.substr(0, lenSoFar - 1);
      output.push(okayWord);
      var extraWord = word.substr(lenSoFar - 1);
      this.splitLine(extraWord + remaining, maxLength, output);
      return;
    }

    // Try one more character
    lenSoFar++;

    // Check if we are done with all characters
    if (lenSoFar > word.length) {
      // Okay it fits
      output.push(word);
      return;
    }
  }
};

function trimRight(text) {
  if (text.length === 0) {
    return "";
  }
  var lastNonSpace = text.length - 1;
  for (var i = lastNonSpace; i >= 0; --i) {
    if (text.charAt(i) !== ' ') {
      lastNonSpace = i;
      break;
    }
  }
  return text.substr(0, lastNonSpace + 1);
}

function trimLeft(text) {
  if (text.length === 0) {
    return "";
  }
  var firstNonSpace = 0;
  for (var i = 0; i < text.length; ++i) {
    if (text.charAt(i) !== ' ') {
      firstNonSpace = i;
      break;
    }
  }
  return text.substr(firstNonSpace);
}

/***/ },

/***/ "./extensions/Markup/gui/MarkupsGui.js"
/*!*********************************************!*\
  !*** ./extensions/Markup/gui/MarkupsGui.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MarkupsGui: () => (/* binding */ MarkupsGui)
/* harmony export */ });
/* harmony import */ var _core_StyleUtils_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../core/StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../core/MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../core/MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _core_EditModeManager_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../core/EditModeManager.js */ "./extensions/Markup/core/EditModeManager.js");
/* harmony import */ var _MarkupsGui_css__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./MarkupsGui.css */ "./extensions/Markup/gui/MarkupsGui.css");





 // IMPORTANT!!

var CORE_EXTENSION = 'Autodesk.Viewing.MarkupsCore';

function MarkupsGui(viewer, options) {
  Autodesk.Viewing.Extension.call(this, viewer, options);
  this.domEvents = [];
  this.name = 'markup';
  this.onEditModeEnter = this.onEditModeEnter.bind(this);
  this.onEditModeLeave = this.onEditModeLeave.bind(this);
  this.onEditModeChange = this.onEditModeChange.bind(this);
  this.onMarkupSelected = this.onMarkupSelected.bind(this);
}

MarkupsGui.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
MarkupsGui.prototype.constructor = MarkupsGui;
var proto = MarkupsGui.prototype;
var av = Autodesk.Viewing;
var avp = av.Private;

proto.load = function () {

  this.viewer.loadExtension(CORE_EXTENSION).then((coreExt) => {

    this.core = coreExt;

    // Hook into markup core events
    this.core.addEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_ENTER, this.onEditModeEnter);
    this.core.addEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_LEAVE, this.onEditModeLeave);
    this.core.addEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_CHANGED, this.onEditModeChange);
    this.core.addEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_SELECTED, this.onMarkupSelected);
  });

  return true;
};

proto.unload = function () {

  this.deactivate(); // not necessary, but leaves the viewer in an unusable state without it
  this.unhookAllEvents();

  this.core.removeEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_ENTER, this.onEditModeEnter);
  this.core.removeEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_LEAVE, this.onEditModeLeave);
  this.core.removeEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_EDITMODE_CHANGED, this.onEditModeChange);
  this.core.removeEventListener(_core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_1__.EVENT_MARKUP_SELECTED, this.onMarkupSelected);

  this.destroyToolUi();
  this.destroyToolbarUI();
  this.core = null;

  return true;
};

proto.onToolbarCreated = function (toolbar) {

  var self = this;

  this.markupToolButton = new Autodesk.Viewing.UI.Button("toolbar-markupTool");
  this.markupToolButton.setToolTip("Markup");
  this.markupToolButton.setIcon("adsk-icon-markup");
  this.markupToolButton.onClick = function () {
    // Since the bar will get hidden when closed, there
    // is no need to track button state (active or not)
    self.activate();
  };

  var modelTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);
  if (modelTools) {
    modelTools.addControl(this.markupToolButton, { index: 0 });
  }
};

proto.destroyToolbarUI = function () {
  if (this.markupToolButton) {
    var toolbar = this.viewer.getToolbar();
    if (toolbar) {
      this.markupToolButton.removeFromParent();
    }
    this.markupToolButton = null;
  }
};

proto.onEditModeEnter = function () {
  avp.logger.log('ENTER edit mode');
  this.showToolsUi();
};

proto.onEditModeLeave = function () {
  avp.logger.log('LEAVE edit mode');
  this.hideToolsUi();
};

proto.onEditModeChange = function (event) {
  if (!this.domToolSelect || this.ignoreChangeEvent)
  return;
  var editMode = this.core.editMode;
  var optionList = this.domToolSelect.options;
  for (var i = 0, len = optionList.length; i < len; i++) {
    var option = optionList[i];
    if (option.value === editMode.type) {
      this.domToolSelect.selectedIndex = i; // doesn't fire event
      break;
    }
  }
};

proto.onMarkupSelected = function (event) {

  var markup = event.markup;
  var editMode = this.core.editMode;
  this.setStylesUi(editMode, markup);
};

proto.showToolsUi = function () {
  this.createToolsUi();

  // Hide some UI
  var canNavigate = this.core.isNavigationAllowed();
  this.setControlVisibility('.lmv-markup-gui-enterNavMode', canNavigate, 'inline-block');
  this.exitNavigationMode();
  this.domContent.style.display = 'block'; // remove collapsed state

  // It's okay if we call these many times in a row, no biggie.
  this.viewer.container.appendChild(this.domRoot);
};

proto.hideToolsUi = function () {
  if (this.domRoot && this.domRoot.parentNode) {
    this.domRoot.parentNode.removeChild(this.domRoot);
  }
};

proto.createToolsUi = function () {

  if (this.domRoot)
  return;

  function createEditModeOption(locLabel, editModeType) {
    return [
    '<option value="', editModeType, '">',
    locLabel,
    '</option>'].
    join('');
  }

  var html = [
  '<div class="lmv-markup-gui-toolbar-content">',

  '<button class="lmv-markup-gui-collapse-btn">&lt;-&gt;</button>',
  '<button class="lmv-markup-editmode-done">Exit</button>',
  '<div class="lmv-markup-gui-collapse-content">',
  '<div class="lmv-markup-gui-editMode">',
  '<button class="lmv-markup-gui-enterNavMode">Navigate</button>',
  '<button class="lmv-markup-gui-undo">&#8617;</button>',
  '<button class="lmv-markup-gui-redo">&#8618;</button>',
  '<br>',
  '<button class="lmv-markup-gui-delete">Delete</button>',
  '<button class="lmv-markup-gui-duplicate">Duplicate</button>',
  '<br>',
  '<button class="lmv-markup-gui-cut">Cut</button>',
  '<button class="lmv-markup-gui-copy">Copy</button>',
  '<button class="lmv-markup-gui-paste">Paste</button>',
  '<br>',
  '<span>Markup:</span>', // TODO: Localize
  '<select class="lmv-markup-tool-select">',
  createEditModeOption('Arrow', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_ARROW),
  createEditModeOption('Rectangle', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_RECTANGLE),
  createEditModeOption('Circle', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_CIRCLE),
  createEditModeOption('Text', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_TEXT),
  createEditModeOption('Callout', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_CALLOUT),
  createEditModeOption('Cloud', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_CLOUD),
  createEditModeOption('PolyLine', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_POLYLINE),
  createEditModeOption('Polycloud', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_POLYCLOUD),
  createEditModeOption('Freehand', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_FREEHAND),
  createEditModeOption('Highlight', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_HIGHLIGHT),
  createEditModeOption('Dimension', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_DIMENSION),
  createEditModeOption('SVG Stamp', _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_2__.MARKUP_TYPE_STAMP),
  '</select>',
  '<br>',
  '<div class="lmv-markup-gui-style-options"></div>',
  '</div>',
  '<div class="lmv-markup-gui-navMode" style="display:none;">',
  '<button class="lmv-markup-gui-exitNavMode">Back to Markup</button>',
  '</div>',
  '</div>',
  '</div>'].
  join('');

  const _document = this.getDocument();
  this.domRoot = _document.createElement('div');
  this.domRoot.className = 'lmv-markup-gui-toolbar';
  this.domRoot.innerHTML = html;

  this.domContent = this.domRoot.querySelector('.lmv-markup-gui-collapse-content');
  this.domToolSelect = this.domRoot.querySelector('.lmv-markup-tool-select');
  this.domStylesRoot = this.domRoot.querySelector('.lmv-markup-gui-style-options');

  // General
  this.hookEvent('click', '.lmv-markup-gui-collapse-btn', this.onToggleCollapse.bind(this));
  this.hookEvent('click', '.lmv-markup-editmode-done', this.onEditModeDone.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-enterNavMode', this.enterNavigationMode.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-exitNavMode', this.exitNavigationMode.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-undo', this.onUndoClick.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-redo', this.onRedoClick.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-delete', this.onDeleteClick.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-cut', this.onCutClick.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-copy', this.onCopyClick.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-paste', this.onPasteClick.bind(this));
  this.hookEvent('click', '.lmv-markup-gui-duplicate', this.onDuplicateClick.bind(this));
  // Tools
  this.hookEvent('change', '.lmv-markup-tool-select', this.onSelectEditMode.bind(this));
  this.hookEvent('change', '.lmv-markup-gui-style-select', this.onStyleChange.bind(this));
  // Text input fields for tools
  this.hookEvent('input', '.lmv-markup-gui-style-textarea', this.onStyleChange.bind(this));
  this.hookEvent('propertychange', '.lmv-markup-gui-style-textarea', this.onStyleChange.bind(this));

  this.setStylesUi(this.core.editMode);
};

proto.destroyToolUi = function () {
  if (this.domRoot) {
    this.hideToolsUi();
    this.domRoot = null;
  }
};

proto.getEditMode = function (editModeType) {
  var EditModeClass = _core_EditModeManager_js__WEBPACK_IMPORTED_MODULE_3__.theEditModeManager.getClass(editModeType);
  if (!EditModeClass)
  return null;

  var editMode = new EditModeClass(this.core);
  return editMode;
};

proto.onToggleCollapse = function () {
  var curr = this.domContent.style.display;
  if (curr === 'none')
  this.domContent.style.display = 'block';else

  this.domContent.style.display = 'none';
};

proto.onEditModeDone = function () {
  this.deactivate();
};

proto.enterNavigationMode = function () {
  this.core.allowNavigation(true);
  this.setControlVisibility('.lmv-markup-gui-editMode', false);
  this.setControlVisibility('.lmv-markup-gui-navMode', true);
};
proto.exitNavigationMode = function () {
  this.core.allowNavigation(false);
  this.setControlVisibility('.lmv-markup-gui-editMode', true);
  this.setControlVisibility('.lmv-markup-gui-navMode', false);
};

proto.onUndoClick = function () {
  this.core.undo();
};
proto.onRedoClick = function () {
  this.core.redo();
};
proto.onDeleteClick = function () {
  var markup = this.core.getSelection();
  if (markup) {
    this.core.deleteMarkup(markup);
  }
};
proto.onCutClick = function () {
  this.core.cut();
};
proto.onCopyClick = function () {
  this.core.copy();
};
proto.onPasteClick = function () {
  this.core.paste();
};
proto.onDuplicateClick = function () {
  // only when there's a selection
  var markup = this.core.getSelection();
  if (markup) {
    this.core.copy();
    this.core.paste();
  }
};

proto.onSelectEditMode = function (event) {
  var editModeType = event.target.value;
  var editMode = this.getEditMode(editModeType);
  if (!editMode) {
    avp.logger.error('Markup editMode not found for type: ' + editModeType);
    return;
  }

  if (editMode.cancelEditModeChange) {
    avp.logger.warn('There was a problem selecting current editMode');
    return;
  }

  this.ignoreChangeEvent = true;
  this.core.changeEditMode(editMode);
  this.ignoreChangeEvent = false;
  this.setStylesUi(editMode);
  this.domToolSelect.blur(); // remove focus from UI
};

proto.onStyleChange = function (event) {
  var select = event.target;
  var styleKey = select.getAttribute('style-key');
  var valueType = select.getAttribute('value-type');

  var markup = this.core.getSelection();
  var style = markup ? markup.getStyle() : this.core.getStyle();

  // if it's a string input, just take the raw value
  if (valueType === 'string') {
    style[styleKey] = select.value;
  } else {
    var option = select.options[select.selectedIndex];
    style[styleKey] = getTypedValue(option.value, valueType);
    select.blur(); // remove focus from UI
  }
  this.core.setStyle(style);

  function getTypedValue(val, type) {
    if (type === 'number')
    return Number(val);
    if (type === 'boolean')
    return val === 'true';
    return val;
  }
};

proto.setStylesUi = function (editMode, markup) {

  var style = markup ? markup.style : editMode.style;
  var defaults = (0,_core_StyleUtils_js__WEBPACK_IMPORTED_MODULE_0__.getStyleDefaultValues)(style, this.core);

  this.domStylesRoot.innerHTML = ''; // flush UI
  for (var key in defaults) {
    // Quite inefiient because we are re-creating DOM constantly
    // Consider optimize if it becomes a problem
    var domElem = this.getUiForStyleKey(key, defaults[key], style[key]);
    this.domStylesRoot.appendChild(domElem);
  }
};

proto.getUiForStyleKey = function (key, defaults, current) {

  var selectionIndex = defaults.default;
  var options = [];
  var values = defaults.values;
  for (var i = 0, len = values.length; i < len; ++i) {
    var optLine = [
    '<option value="', values[i].value, '">',
    values[i].name,
    '</option>'].
    join('');
    options.push(optLine);

    if (this.valueEquals(values[i].value, current)) {
      selectionIndex = i;
    }
  }

  var valueType = typeof values[0].value;

  // TODO: Build specialized controls for each style-attribute
  const _document = this.getDocument();
  var domElem = _document.createElement('div');
  var html = [];
  let isText = key.includes('text');

  if (isText) {
    html = [
    '<span>', key, '</span>',
    '<br>',
    '<textarea class="lmv-markup-gui-style-textarea" style-key="', key, '" value-type="', valueType, '">',
    current || '',
    '</textarea>'].
    join('');
  } else {
    html = [
    '<span>', key, '</span>',
    '<select class="lmv-markup-gui-style-select" style-key="', key, '" value-type="', valueType, '">',
    options.join(''),
    '</select>'].
    join('');
  }

  domElem.innerHTML = html;

  if (!isText) {
    // select index
    var domSelect = domElem.querySelector('select');
    domSelect.selectedIndex = selectionIndex;
  }

  return domElem;
};
proto.valueEquals = function (value1, value2) {

  return value1 === value2;
};

proto.setControlVisibility = function (selector, isVisible, visibleValue) {
  var elem = this.domRoot.querySelector(selector);
  if (!visibleValue)
  visibleValue = 'block';
  elem.style.display = isVisible ? visibleValue : 'none';
};

proto.hookEvent = function (eventStr, selector, callbackFn) {
  var handler = function (event) {
    if (this.matchesSelector(event.target, selector)) {
      callbackFn(event);
    }
  }.bind(this);
  this.domRoot.addEventListener(eventStr, handler);
  this.domEvents.push({ str: eventStr, handler: handler });
};

proto.unhookAllEvents = function () {
  var domRoot = this.domRoot;
  this.domEvents.forEach(function (event) {
    domRoot.removeEventListener(event.str, event.handler);
  });
  this.domEvents = [];
};

proto.matchesSelector = function (domElem, selector) {
  if (domElem.matches) return domElem.matches(selector); //Un-prefixed
  if (domElem.msMatchesSelector) return domElem.msMatchesSelector(selector); //IE
  if (domElem.mozMatchesSelector) return domElem.mozMatchesSelector(selector); //Firefox (Gecko)
  if (domElem.webkitMatchesSelector) return domElem.webkitMatchesSelector(selector); // Opera, Safari, Chrome
  return false;
};

proto.getStyleOptions = function (editMode) {
  var style = editMode.getStyle();
  return (0,_core_StyleUtils_js__WEBPACK_IMPORTED_MODULE_0__.getStyleDefaultValues)(style, this.core);
};

proto.activate = function () {
  if (!this.activeStatus) {
    this.core.enterEditMode();
    this.activeStatus = true;
  }
  return true;
};

proto.deactivate = function () {
  if (this.activeStatus) {
    this.core.hide();
    this.activeStatus = false;
  }
  return true;
};


Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Viewing.MarkupsGui', MarkupsGui);

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Markup/core/Markups.css"
/*!********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Markup/core/Markups.css ***!
  \********************************************************************************************************************************************************************************************************************************************************/
(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../node_modules/css-loader/dist/runtime/noSourceMaps.js */ "./node_modules/css-loader/dist/runtime/noSourceMaps.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../node_modules/css-loader/dist/runtime/api.js */ "./node_modules/css-loader/dist/runtime/api.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-viewing-viewer .autodesk-markups-extension-core-make-me-bigger:after {
  content: "";
  position: absolute;
  top: -15px;
  bottom: -15px;
  left: -15px;
  right: -15px;
}

.adsk-viewing-viewer .autodesk-markups-extension-core-make-me-bigger.rotation-bridge:after {
  top: 0;
  bottom: 0px;
}

.adsk-viewing-viewer .selector-box {
  position: absolute;
  border: 1px dashed #0696D7;
  background: rgba(6, 150, 215, 0.05);
  z-index: 1;
  cursor: move;
  box-sizing: border-box;
}

.adsk-viewing-viewer .selector-drag-point,
.adsk-viewing-viewer .selector-rotate-point {
  position: absolute;
  height: 8px;
  width: 8px;
  border-radius: 8px; /*HANDLE_SIZE*/
  background: #FFFFFF; /*HANDLE_BACKGROUND_COLOR*/
  border-color: rgba(107, 120, 127, 0.7); /* HANDLE_BORDER_COLOR; */
  border-width: 1px; /* BORDER_WIDTH */
  border-style: solid;
}

.adsk-viewing-viewer .selector-rotate-point {
  top: calc(100% + 22px); /* 30 - 8 = 22 */
  left: calc(50% + 1px);
  transform: translate3d(-50%, 0px, 0px);
}

.adsk-viewing-viewer .selector-drag-point.selected,
.adsk-viewing-viewer .selector-rotate-point.selected:not(.rotation-bridge) {
  background: #0696D7;
  border-color: #0696D7;
}

.adsk-viewing-viewer .rotation-bridge {
  position: absolute;
  background-color: rgba(0, 0, 0, 0);
  height: 30px;
  width: 0px;
  top: 100%;
  left: calc(50% + 1px);
  border: unset;
  border-left: 1px dashed #0696D7;
}

/*var placementOffset = -6;*/
.adsk-viewing-viewer .selector-drag-point.sdp-handle-n {
  top: -6px;
  left: calc(50% - 4px);
  position: relative;
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-s {
  top: calc(100% - 14px);
  left: calc(50% - 4px);
  position: relative;
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-w {
  left: -6px;
  top: 50%;
  transform: translate3d(0, -50%, 0);
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-e {
  right: -6px;
  top: 50%;
  transform: translate3d(0, -50%, 0);
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-nw {
  top: -6px;
  left: -6px;
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-ne {
  top: -6px;
  right: -6px;
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-sw {
  bottom: -6px;
  left: -6px;
}

.adsk-viewing-viewer .selector-drag-point.sdp-handle-se {
  bottom: -6px;
  right: -6px;
}`, ""]);
// Exports
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);


/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Markup/gui/MarkupsGui.css"
/*!**********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Markup/gui/MarkupsGui.css ***!
  \**********************************************************************************************************************************************************************************************************************************************************/
(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../node_modules/css-loader/dist/runtime/noSourceMaps.js */ "./node_modules/css-loader/dist/runtime/noSourceMaps.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../node_modules/css-loader/dist/runtime/api.js */ "./node_modules/css-loader/dist/runtime/api.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-icon-markup:before {
  content: "a";
}

.lmv-markup-gui-toolbar {
  position: absolute;
  top: 0;
  margin: 5px 5px;
  color: #000000;
}

.lmv-markup-gui-toolbar-content > * {
  margin: 0 2px;
}

.lmv-markup-gui-style-options {
  display: inline-block;
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

/***/ "./extensions/Markup/core/Markups.css"
/*!********************************************!*\
  !*** ./extensions/Markup/core/Markups.css ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js */ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/styleDomAPI.js */ "./node_modules/style-loader/dist/runtime/styleDomAPI.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/insertBySelector.js */ "./node_modules/style-loader/dist/runtime/insertBySelector.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js */ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/insertStyleElement.js */ "./node_modules/style-loader/dist/runtime/insertStyleElement.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/styleTagTransform.js */ "./node_modules/style-loader/dist/runtime/styleTagTransform.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Markups_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./Markups.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Markup/core/Markups.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Markups_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Markups_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Markups_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Markups_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


/***/ },

/***/ "./extensions/Markup/gui/MarkupsGui.css"
/*!**********************************************!*\
  !*** ./extensions/Markup/gui/MarkupsGui.css ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js */ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/styleDomAPI.js */ "./node_modules/style-loader/dist/runtime/styleDomAPI.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/insertBySelector.js */ "./node_modules/style-loader/dist/runtime/insertBySelector.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js */ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/insertStyleElement.js */ "./node_modules/style-loader/dist/runtime/insertStyleElement.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! !../../../node_modules/style-loader/dist/runtime/styleTagTransform.js */ "./node_modules/style-loader/dist/runtime/styleTagTransform.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MarkupsGui_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./MarkupsGui.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Markup/gui/MarkupsGui.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MarkupsGui_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MarkupsGui_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MarkupsGui_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_MarkupsGui_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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
/*!*************************************!*\
  !*** ./extensions/Markup/Markup.js ***!
  \*************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Core: () => (/* binding */ Core),
/* harmony export */   Gui: () => (/* binding */ Gui)
/* harmony export */ });
/* harmony import */ var _core_MarkupsCore_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./core/MarkupsCore.js */ "./extensions/Markup/core/MarkupsCore.js");
/* harmony import */ var _gui_MarkupsGui_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./gui/MarkupsGui.js */ "./extensions/Markup/gui/MarkupsGui.js");
/* harmony import */ var _core_edit_clipboard_Clipboard_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./core/edit-clipboard/Clipboard.js */ "./extensions/Markup/core/edit-clipboard/Clipboard.js");
/* harmony import */ var _core_edit_actions_CloneMarkup_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./core/edit-actions/CloneMarkup.js */ "./extensions/Markup/core/edit-actions/CloneMarkup.js");
/* harmony import */ var _core_edit_actions_CreateArrow_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./core/edit-actions/CreateArrow.js */ "./extensions/Markup/core/edit-actions/CreateArrow.js");
/* harmony import */ var _core_edit_actions_CreateCallout_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./core/edit-actions/CreateCallout.js */ "./extensions/Markup/core/edit-actions/CreateCallout.js");
/* harmony import */ var _core_edit_actions_CreateCircle_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./core/edit-actions/CreateCircle.js */ "./extensions/Markup/core/edit-actions/CreateCircle.js");
/* harmony import */ var _core_edit_actions_CreateCloud_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./core/edit-actions/CreateCloud.js */ "./extensions/Markup/core/edit-actions/CreateCloud.js");
/* harmony import */ var _core_edit_actions_CreateDimension_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./core/edit-actions/CreateDimension.js */ "./extensions/Markup/core/edit-actions/CreateDimension.js");
/* harmony import */ var _core_edit_actions_CreateFreehand_js__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./core/edit-actions/CreateFreehand.js */ "./extensions/Markup/core/edit-actions/CreateFreehand.js");
/* harmony import */ var _core_edit_actions_CreateHighlight_js__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./core/edit-actions/CreateHighlight.js */ "./extensions/Markup/core/edit-actions/CreateHighlight.js");
/* harmony import */ var _core_edit_actions_CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./core/edit-actions/CreatePolycloud.js */ "./extensions/Markup/core/edit-actions/CreatePolycloud.js");
/* harmony import */ var _core_edit_actions_CreatePolyline_js__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./core/edit-actions/CreatePolyline.js */ "./extensions/Markup/core/edit-actions/CreatePolyline.js");
/* harmony import */ var _core_edit_actions_CreateRectangle_js__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ./core/edit-actions/CreateRectangle.js */ "./extensions/Markup/core/edit-actions/CreateRectangle.js");
/* harmony import */ var _core_edit_actions_CreateText_js__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ./core/edit-actions/CreateText.js */ "./extensions/Markup/core/edit-actions/CreateText.js");
/* harmony import */ var _core_edit_actions_DeleteArrow_js__WEBPACK_IMPORTED_MODULE_15__ = __webpack_require__(/*! ./core/edit-actions/DeleteArrow.js */ "./extensions/Markup/core/edit-actions/DeleteArrow.js");
/* harmony import */ var _core_edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_16__ = __webpack_require__(/*! ./core/edit-actions/DeleteCallout.js */ "./extensions/Markup/core/edit-actions/DeleteCallout.js");
/* harmony import */ var _core_edit_actions_DeleteCircle_js__WEBPACK_IMPORTED_MODULE_17__ = __webpack_require__(/*! ./core/edit-actions/DeleteCircle.js */ "./extensions/Markup/core/edit-actions/DeleteCircle.js");
/* harmony import */ var _core_edit_actions_DeleteCloud_js__WEBPACK_IMPORTED_MODULE_18__ = __webpack_require__(/*! ./core/edit-actions/DeleteCloud.js */ "./extensions/Markup/core/edit-actions/DeleteCloud.js");
/* harmony import */ var _core_edit_actions_DeleteStamp_js__WEBPACK_IMPORTED_MODULE_19__ = __webpack_require__(/*! ./core/edit-actions/DeleteStamp.js */ "./extensions/Markup/core/edit-actions/DeleteStamp.js");
/* harmony import */ var _core_edit_actions_DeleteDimension_js__WEBPACK_IMPORTED_MODULE_20__ = __webpack_require__(/*! ./core/edit-actions/DeleteDimension.js */ "./extensions/Markup/core/edit-actions/DeleteDimension.js");
/* harmony import */ var _core_edit_actions_DeleteFreehand_js__WEBPACK_IMPORTED_MODULE_21__ = __webpack_require__(/*! ./core/edit-actions/DeleteFreehand.js */ "./extensions/Markup/core/edit-actions/DeleteFreehand.js");
/* harmony import */ var _core_edit_actions_DeleteHighlight_js__WEBPACK_IMPORTED_MODULE_22__ = __webpack_require__(/*! ./core/edit-actions/DeleteHighlight.js */ "./extensions/Markup/core/edit-actions/DeleteHighlight.js");
/* harmony import */ var _core_edit_actions_DeletePolycloud_js__WEBPACK_IMPORTED_MODULE_23__ = __webpack_require__(/*! ./core/edit-actions/DeletePolycloud.js */ "./extensions/Markup/core/edit-actions/DeletePolycloud.js");
/* harmony import */ var _core_edit_actions_DeletePolyline_js__WEBPACK_IMPORTED_MODULE_24__ = __webpack_require__(/*! ./core/edit-actions/DeletePolyline.js */ "./extensions/Markup/core/edit-actions/DeletePolyline.js");
/* harmony import */ var _core_edit_actions_DeleteRectangle_js__WEBPACK_IMPORTED_MODULE_25__ = __webpack_require__(/*! ./core/edit-actions/DeleteRectangle.js */ "./extensions/Markup/core/edit-actions/DeleteRectangle.js");
/* harmony import */ var _core_edit_actions_DeleteText_js__WEBPACK_IMPORTED_MODULE_26__ = __webpack_require__(/*! ./core/edit-actions/DeleteText.js */ "./extensions/Markup/core/edit-actions/DeleteText.js");
/* harmony import */ var _core_edit_actions_EditAction_js__WEBPACK_IMPORTED_MODULE_27__ = __webpack_require__(/*! ./core/edit-actions/EditAction.js */ "./extensions/Markup/core/edit-actions/EditAction.js");
/* harmony import */ var _core_edit_actions_EditActionGroup_js__WEBPACK_IMPORTED_MODULE_28__ = __webpack_require__(/*! ./core/edit-actions/EditActionGroup.js */ "./extensions/Markup/core/edit-actions/EditActionGroup.js");
/* harmony import */ var _core_edit_actions_EditActionManager_js__WEBPACK_IMPORTED_MODULE_29__ = __webpack_require__(/*! ./core/edit-actions/EditActionManager.js */ "./extensions/Markup/core/edit-actions/EditActionManager.js");
/* harmony import */ var _core_EditFrame_js__WEBPACK_IMPORTED_MODULE_30__ = __webpack_require__(/*! ./core/EditFrame.js */ "./extensions/Markup/core/EditFrame.js");
/* harmony import */ var _core_edit_modes_EditMode_js__WEBPACK_IMPORTED_MODULE_31__ = __webpack_require__(/*! ./core/edit-modes/EditMode.js */ "./extensions/Markup/core/edit-modes/EditMode.js");
/* harmony import */ var _core_edit_modes_EditModeArrow_js__WEBPACK_IMPORTED_MODULE_32__ = __webpack_require__(/*! ./core/edit-modes/EditModeArrow.js */ "./extensions/Markup/core/edit-modes/EditModeArrow.js");
/* harmony import */ var _core_edit_modes_EditModeCallout_js__WEBPACK_IMPORTED_MODULE_33__ = __webpack_require__(/*! ./core/edit-modes/EditModeCallout.js */ "./extensions/Markup/core/edit-modes/EditModeCallout.js");
/* harmony import */ var _core_edit_modes_EditModeCircle_js__WEBPACK_IMPORTED_MODULE_34__ = __webpack_require__(/*! ./core/edit-modes/EditModeCircle.js */ "./extensions/Markup/core/edit-modes/EditModeCircle.js");
/* harmony import */ var _core_edit_modes_EditModeCloud_js__WEBPACK_IMPORTED_MODULE_35__ = __webpack_require__(/*! ./core/edit-modes/EditModeCloud.js */ "./extensions/Markup/core/edit-modes/EditModeCloud.js");
/* harmony import */ var _core_edit_modes_EditModeStamp_js__WEBPACK_IMPORTED_MODULE_36__ = __webpack_require__(/*! ./core/edit-modes/EditModeStamp.js */ "./extensions/Markup/core/edit-modes/EditModeStamp.js");
/* harmony import */ var _core_edit_modes_EditModeDimension_js__WEBPACK_IMPORTED_MODULE_37__ = __webpack_require__(/*! ./core/edit-modes/EditModeDimension.js */ "./extensions/Markup/core/edit-modes/EditModeDimension.js");
/* harmony import */ var _core_edit_modes_EditModeFreehand_js__WEBPACK_IMPORTED_MODULE_38__ = __webpack_require__(/*! ./core/edit-modes/EditModeFreehand.js */ "./extensions/Markup/core/edit-modes/EditModeFreehand.js");
/* harmony import */ var _core_edit_modes_EditModeHighlight_js__WEBPACK_IMPORTED_MODULE_39__ = __webpack_require__(/*! ./core/edit-modes/EditModeHighlight.js */ "./extensions/Markup/core/edit-modes/EditModeHighlight.js");
/* harmony import */ var _core_edit_modes_EditModePen_js__WEBPACK_IMPORTED_MODULE_40__ = __webpack_require__(/*! ./core/edit-modes/EditModePen.js */ "./extensions/Markup/core/edit-modes/EditModePen.js");
/* harmony import */ var _core_edit_modes_EditModePolycloud_js__WEBPACK_IMPORTED_MODULE_41__ = __webpack_require__(/*! ./core/edit-modes/EditModePolycloud.js */ "./extensions/Markup/core/edit-modes/EditModePolycloud.js");
/* harmony import */ var _core_edit_modes_EditModePolyline_js__WEBPACK_IMPORTED_MODULE_42__ = __webpack_require__(/*! ./core/edit-modes/EditModePolyline.js */ "./extensions/Markup/core/edit-modes/EditModePolyline.js");
/* harmony import */ var _core_edit_modes_EditModeRectangle_js__WEBPACK_IMPORTED_MODULE_43__ = __webpack_require__(/*! ./core/edit-modes/EditModeRectangle.js */ "./extensions/Markup/core/edit-modes/EditModeRectangle.js");
/* harmony import */ var _core_edit_modes_EditModeText_js__WEBPACK_IMPORTED_MODULE_44__ = __webpack_require__(/*! ./core/edit-modes/EditModeText.js */ "./extensions/Markup/core/edit-modes/EditModeText.js");
/* harmony import */ var _core_edit_modes_EditorTextInput_js__WEBPACK_IMPORTED_MODULE_45__ = __webpack_require__(/*! ./core/edit-modes/EditorTextInput.js */ "./extensions/Markup/core/edit-modes/EditorTextInput.js");
/* harmony import */ var _core_Markup_js__WEBPACK_IMPORTED_MODULE_46__ = __webpack_require__(/*! ./core/Markup.js */ "./extensions/Markup/core/Markup.js");
/* harmony import */ var _core_MarkupArrow_js__WEBPACK_IMPORTED_MODULE_47__ = __webpack_require__(/*! ./core/MarkupArrow.js */ "./extensions/Markup/core/MarkupArrow.js");
/* harmony import */ var _core_MarkupCallout_js__WEBPACK_IMPORTED_MODULE_48__ = __webpack_require__(/*! ./core/MarkupCallout.js */ "./extensions/Markup/core/MarkupCallout.js");
/* harmony import */ var _core_MarkupCircle_js__WEBPACK_IMPORTED_MODULE_49__ = __webpack_require__(/*! ./core/MarkupCircle.js */ "./extensions/Markup/core/MarkupCircle.js");
/* harmony import */ var _core_MarkupCloud_js__WEBPACK_IMPORTED_MODULE_50__ = __webpack_require__(/*! ./core/MarkupCloud.js */ "./extensions/Markup/core/MarkupCloud.js");
/* harmony import */ var _core_MarkupDimension_js__WEBPACK_IMPORTED_MODULE_51__ = __webpack_require__(/*! ./core/MarkupDimension.js */ "./extensions/Markup/core/MarkupDimension.js");
/* harmony import */ var _core_MarkupFreehand_js__WEBPACK_IMPORTED_MODULE_52__ = __webpack_require__(/*! ./core/MarkupFreehand.js */ "./extensions/Markup/core/MarkupFreehand.js");
/* harmony import */ var _core_MarkupHighlight_js__WEBPACK_IMPORTED_MODULE_53__ = __webpack_require__(/*! ./core/MarkupHighlight.js */ "./extensions/Markup/core/MarkupHighlight.js");
/* harmony import */ var _core_MarkupPen_js__WEBPACK_IMPORTED_MODULE_54__ = __webpack_require__(/*! ./core/MarkupPen.js */ "./extensions/Markup/core/MarkupPen.js");
/* harmony import */ var _core_MarkupPolycloud_js__WEBPACK_IMPORTED_MODULE_55__ = __webpack_require__(/*! ./core/MarkupPolycloud.js */ "./extensions/Markup/core/MarkupPolycloud.js");
/* harmony import */ var _core_MarkupPolyLine_js__WEBPACK_IMPORTED_MODULE_56__ = __webpack_require__(/*! ./core/MarkupPolyLine.js */ "./extensions/Markup/core/MarkupPolyLine.js");
/* harmony import */ var _core_MarkupRectangle_js__WEBPACK_IMPORTED_MODULE_57__ = __webpack_require__(/*! ./core/MarkupRectangle.js */ "./extensions/Markup/core/MarkupRectangle.js");
/* harmony import */ var _core_MarkupText_js__WEBPACK_IMPORTED_MODULE_58__ = __webpack_require__(/*! ./core/MarkupText.js */ "./extensions/Markup/core/MarkupText.js");
/* harmony import */ var _core_MarkupStamp_js__WEBPACK_IMPORTED_MODULE_59__ = __webpack_require__(/*! ./core/MarkupStamp.js */ "./extensions/Markup/core/MarkupStamp.js");
/* harmony import */ var _core_MarkupTool_js__WEBPACK_IMPORTED_MODULE_60__ = __webpack_require__(/*! ./core/MarkupTool.js */ "./extensions/Markup/core/MarkupTool.js");
/* harmony import */ var _core_edit_actions_SetArrow_js__WEBPACK_IMPORTED_MODULE_61__ = __webpack_require__(/*! ./core/edit-actions/SetArrow.js */ "./extensions/Markup/core/edit-actions/SetArrow.js");
/* harmony import */ var _core_edit_actions_SetCallout_js__WEBPACK_IMPORTED_MODULE_62__ = __webpack_require__(/*! ./core/edit-actions/SetCallout.js */ "./extensions/Markup/core/edit-actions/SetCallout.js");
/* harmony import */ var _core_edit_actions_SetCircle_js__WEBPACK_IMPORTED_MODULE_63__ = __webpack_require__(/*! ./core/edit-actions/SetCircle.js */ "./extensions/Markup/core/edit-actions/SetCircle.js");
/* harmony import */ var _core_edit_actions_SetCloud_js__WEBPACK_IMPORTED_MODULE_64__ = __webpack_require__(/*! ./core/edit-actions/SetCloud.js */ "./extensions/Markup/core/edit-actions/SetCloud.js");
/* harmony import */ var _core_edit_actions_SetDimension_js__WEBPACK_IMPORTED_MODULE_65__ = __webpack_require__(/*! ./core/edit-actions/SetDimension.js */ "./extensions/Markup/core/edit-actions/SetDimension.js");
/* harmony import */ var _core_edit_actions_SetFreehand_js__WEBPACK_IMPORTED_MODULE_66__ = __webpack_require__(/*! ./core/edit-actions/SetFreehand.js */ "./extensions/Markup/core/edit-actions/SetFreehand.js");
/* harmony import */ var _core_edit_actions_SetHighlight_js__WEBPACK_IMPORTED_MODULE_67__ = __webpack_require__(/*! ./core/edit-actions/SetHighlight.js */ "./extensions/Markup/core/edit-actions/SetHighlight.js");
/* harmony import */ var _core_edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_68__ = __webpack_require__(/*! ./core/edit-actions/SetPolycloud.js */ "./extensions/Markup/core/edit-actions/SetPolycloud.js");
/* harmony import */ var _core_edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_69__ = __webpack_require__(/*! ./core/edit-actions/SetPolyline.js */ "./extensions/Markup/core/edit-actions/SetPolyline.js");
/* harmony import */ var _core_edit_actions_SetPosition_js__WEBPACK_IMPORTED_MODULE_70__ = __webpack_require__(/*! ./core/edit-actions/SetPosition.js */ "./extensions/Markup/core/edit-actions/SetPosition.js");
/* harmony import */ var _core_edit_actions_SetRectangle_js__WEBPACK_IMPORTED_MODULE_71__ = __webpack_require__(/*! ./core/edit-actions/SetRectangle.js */ "./extensions/Markup/core/edit-actions/SetRectangle.js");
/* harmony import */ var _core_edit_actions_SetRotation_js__WEBPACK_IMPORTED_MODULE_72__ = __webpack_require__(/*! ./core/edit-actions/SetRotation.js */ "./extensions/Markup/core/edit-actions/SetRotation.js");
/* harmony import */ var _core_edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_73__ = __webpack_require__(/*! ./core/edit-actions/SetSize.js */ "./extensions/Markup/core/edit-actions/SetSize.js");
/* harmony import */ var _core_edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_74__ = __webpack_require__(/*! ./core/edit-actions/SetStyle.js */ "./extensions/Markup/core/edit-actions/SetStyle.js");
/* harmony import */ var _core_edit_actions_SetText_js__WEBPACK_IMPORTED_MODULE_75__ = __webpack_require__(/*! ./core/edit-actions/SetText.js */ "./extensions/Markup/core/edit-actions/SetText.js");
/* harmony import */ var _core_edit_actions_SetStamp_js__WEBPACK_IMPORTED_MODULE_76__ = __webpack_require__(/*! ./core/edit-actions/SetStamp.js */ "./extensions/Markup/core/edit-actions/SetStamp.js");
/* harmony import */ var _core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_77__ = __webpack_require__(/*! ./core/MarkupEvents.js */ "./extensions/Markup/core/MarkupEvents.js");
/* harmony import */ var _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_78__ = __webpack_require__(/*! ./core/MarkupTypes.js */ "./extensions/Markup/core/MarkupTypes.js");
/* harmony import */ var _core_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_79__ = __webpack_require__(/*! ./core/MarkupsCoreUtils.js */ "./extensions/Markup/core/MarkupsCoreUtils.js");
/* harmony import */ var _core_StyleUtils_js__WEBPACK_IMPORTED_MODULE_80__ = __webpack_require__(/*! ./core/StyleUtils.js */ "./extensions/Markup/core/StyleUtils.js");
/* harmony import */ var _core_EditModeManager_js__WEBPACK_IMPORTED_MODULE_81__ = __webpack_require__(/*! ./core/EditModeManager.js */ "./extensions/Markup/core/EditModeManager.js");































































































// All the things
const Core = {
  Clipboard: _core_edit_clipboard_Clipboard_js__WEBPACK_IMPORTED_MODULE_2__.Clipboard,
  CloneMarkup: _core_edit_actions_CloneMarkup_js__WEBPACK_IMPORTED_MODULE_3__.CloneMarkup,
  CreateArrow: _core_edit_actions_CreateArrow_js__WEBPACK_IMPORTED_MODULE_4__.CreateArrow,
  CreateCallout: _core_edit_actions_CreateCallout_js__WEBPACK_IMPORTED_MODULE_5__.CreateCallout,
  CreateCircle: _core_edit_actions_CreateCircle_js__WEBPACK_IMPORTED_MODULE_6__.CreateCircle,
  CreateCloud: _core_edit_actions_CreateCloud_js__WEBPACK_IMPORTED_MODULE_7__.CreateCloud,
  CreateDimension: _core_edit_actions_CreateDimension_js__WEBPACK_IMPORTED_MODULE_8__.CreateDimension,
  CreateFreehand: _core_edit_actions_CreateFreehand_js__WEBPACK_IMPORTED_MODULE_9__.CreateFreehand,
  CreateHighlight: _core_edit_actions_CreateHighlight_js__WEBPACK_IMPORTED_MODULE_10__.CreateHighlight,
  CreatePolycloud: _core_edit_actions_CreatePolycloud_js__WEBPACK_IMPORTED_MODULE_11__.CreatePolycloud,
  CreatePolyline: _core_edit_actions_CreatePolyline_js__WEBPACK_IMPORTED_MODULE_12__.CreatePolyline,
  CreateRectangle: _core_edit_actions_CreateRectangle_js__WEBPACK_IMPORTED_MODULE_13__.CreateRectangle,
  CreateText: _core_edit_actions_CreateText_js__WEBPACK_IMPORTED_MODULE_14__.CreateText,
  DeleteArrow: _core_edit_actions_DeleteArrow_js__WEBPACK_IMPORTED_MODULE_15__.DeleteArrow,
  DeleteCallout: _core_edit_actions_DeleteCallout_js__WEBPACK_IMPORTED_MODULE_16__.DeleteCallout,
  DeleteCircle: _core_edit_actions_DeleteCircle_js__WEBPACK_IMPORTED_MODULE_17__.DeleteCircle,
  DeleteCloud: _core_edit_actions_DeleteCloud_js__WEBPACK_IMPORTED_MODULE_18__.DeleteCloud,
  DeleteDimension: _core_edit_actions_DeleteDimension_js__WEBPACK_IMPORTED_MODULE_20__.DeleteDimension,
  DeleteFreehand: _core_edit_actions_DeleteFreehand_js__WEBPACK_IMPORTED_MODULE_21__.DeleteFreehand,
  DeleteHighlight: _core_edit_actions_DeleteHighlight_js__WEBPACK_IMPORTED_MODULE_22__.DeleteHighlight,
  DeletePolycloud: _core_edit_actions_DeletePolycloud_js__WEBPACK_IMPORTED_MODULE_23__.DeletePolycloud,
  DeletePolyline: _core_edit_actions_DeletePolyline_js__WEBPACK_IMPORTED_MODULE_24__.DeletePolyline,
  DeleteRectangle: _core_edit_actions_DeleteRectangle_js__WEBPACK_IMPORTED_MODULE_25__.DeleteRectangle,
  DeleteText: _core_edit_actions_DeleteText_js__WEBPACK_IMPORTED_MODULE_26__.DeleteText,
  DeleteStamp: _core_edit_actions_DeleteStamp_js__WEBPACK_IMPORTED_MODULE_19__.DeleteStamp,

  EditAction: _core_edit_actions_EditAction_js__WEBPACK_IMPORTED_MODULE_27__.EditAction,
  EditActionGroup: _core_edit_actions_EditActionGroup_js__WEBPACK_IMPORTED_MODULE_28__.EditActionGroup,
  EditActionManager: _core_edit_actions_EditActionManager_js__WEBPACK_IMPORTED_MODULE_29__.EditActionManager,
  EditFrame: _core_EditFrame_js__WEBPACK_IMPORTED_MODULE_30__.EditFrame,

  EditMode: _core_edit_modes_EditMode_js__WEBPACK_IMPORTED_MODULE_31__.EditMode,
  EditModeArrow: _core_edit_modes_EditModeArrow_js__WEBPACK_IMPORTED_MODULE_32__.EditModeArrow,
  EditModeCallout: _core_edit_modes_EditModeCallout_js__WEBPACK_IMPORTED_MODULE_33__.EditModeCallout,
  EditModeCircle: _core_edit_modes_EditModeCircle_js__WEBPACK_IMPORTED_MODULE_34__.EditModeCircle,
  EditModeCloud: _core_edit_modes_EditModeCloud_js__WEBPACK_IMPORTED_MODULE_35__.EditModeCloud,
  EditModeDimension: _core_edit_modes_EditModeDimension_js__WEBPACK_IMPORTED_MODULE_37__.EditModeDimension,
  EditModeFreehand: _core_edit_modes_EditModeFreehand_js__WEBPACK_IMPORTED_MODULE_38__.EditModeFreehand,
  EditModeHighlight: _core_edit_modes_EditModeHighlight_js__WEBPACK_IMPORTED_MODULE_39__.EditModeHighlight,
  EditModePen: _core_edit_modes_EditModePen_js__WEBPACK_IMPORTED_MODULE_40__.EditModePen,
  EditModePolycloud: _core_edit_modes_EditModePolycloud_js__WEBPACK_IMPORTED_MODULE_41__.EditModePolycloud,
  EditModePolyline: _core_edit_modes_EditModePolyline_js__WEBPACK_IMPORTED_MODULE_42__.EditModePolyline,
  EditModeRectangle: _core_edit_modes_EditModeRectangle_js__WEBPACK_IMPORTED_MODULE_43__.EditModeRectangle,
  EditModeText: _core_edit_modes_EditModeText_js__WEBPACK_IMPORTED_MODULE_44__.EditModeText,
  EditModeStamp: _core_edit_modes_EditModeStamp_js__WEBPACK_IMPORTED_MODULE_36__.EditModeStamp,
  EditorTextInput: _core_edit_modes_EditorTextInput_js__WEBPACK_IMPORTED_MODULE_45__.EditorTextInput,

  Markup: _core_Markup_js__WEBPACK_IMPORTED_MODULE_46__.Markup,
  MarkupArrow: _core_MarkupArrow_js__WEBPACK_IMPORTED_MODULE_47__.MarkupArrow,
  MarkupCallout: _core_MarkupCallout_js__WEBPACK_IMPORTED_MODULE_48__.MarkupCallout,
  MarkupCircle: _core_MarkupCircle_js__WEBPACK_IMPORTED_MODULE_49__.MarkupCircle,
  MarkupCloud: _core_MarkupCloud_js__WEBPACK_IMPORTED_MODULE_50__.MarkupCloud,
  MarkupDimension: _core_MarkupDimension_js__WEBPACK_IMPORTED_MODULE_51__.MarkupDimension,
  MarkupFreehand: _core_MarkupFreehand_js__WEBPACK_IMPORTED_MODULE_52__.MarkupFreehand,
  MarkupHighlight: _core_MarkupHighlight_js__WEBPACK_IMPORTED_MODULE_53__.MarkupHighlight,
  MarkupPen: _core_MarkupPen_js__WEBPACK_IMPORTED_MODULE_54__.MarkupPen,
  MarkupPolycloud: _core_MarkupPolycloud_js__WEBPACK_IMPORTED_MODULE_55__.MarkupPolycloud,
  MarkupPolyline: _core_MarkupPolyLine_js__WEBPACK_IMPORTED_MODULE_56__.MarkupPolyline,
  MarkupRectangle: _core_MarkupRectangle_js__WEBPACK_IMPORTED_MODULE_57__.MarkupRectangle,
  MarkupText: _core_MarkupText_js__WEBPACK_IMPORTED_MODULE_58__.MarkupText,
  MarkupStamp: _core_MarkupStamp_js__WEBPACK_IMPORTED_MODULE_59__.MarkupStamp,
  MarkupTool: _core_MarkupTool_js__WEBPACK_IMPORTED_MODULE_60__.MarkupTool,

  MarkupsCore: _core_MarkupsCore_js__WEBPACK_IMPORTED_MODULE_0__.MarkupsCore,

  SetArrow: _core_edit_actions_SetArrow_js__WEBPACK_IMPORTED_MODULE_61__.SetArrow,
  SetCallout: _core_edit_actions_SetCallout_js__WEBPACK_IMPORTED_MODULE_62__.SetCallout,
  SetCircle: _core_edit_actions_SetCircle_js__WEBPACK_IMPORTED_MODULE_63__.SetCircle,
  SetCloud: _core_edit_actions_SetCloud_js__WEBPACK_IMPORTED_MODULE_64__.SetCloud,
  SetDimension: _core_edit_actions_SetDimension_js__WEBPACK_IMPORTED_MODULE_65__.SetDimension,
  SetFreehand: _core_edit_actions_SetFreehand_js__WEBPACK_IMPORTED_MODULE_66__.SetFreehand,
  SetHighlight: _core_edit_actions_SetHighlight_js__WEBPACK_IMPORTED_MODULE_67__.SetHighlight,
  SetPolycloud: _core_edit_actions_SetPolycloud_js__WEBPACK_IMPORTED_MODULE_68__.SetPolycloud,
  SetPolyline: _core_edit_actions_SetPolyline_js__WEBPACK_IMPORTED_MODULE_69__.SetPolyline,
  SetPosition: _core_edit_actions_SetPosition_js__WEBPACK_IMPORTED_MODULE_70__.SetPosition,
  SetRectangle: _core_edit_actions_SetRectangle_js__WEBPACK_IMPORTED_MODULE_71__.SetRectangle,
  SetRotation: _core_edit_actions_SetRotation_js__WEBPACK_IMPORTED_MODULE_72__.SetRotation,
  SetSize: _core_edit_actions_SetSize_js__WEBPACK_IMPORTED_MODULE_73__.SetSize,
  SetStyle: _core_edit_actions_SetStyle_js__WEBPACK_IMPORTED_MODULE_74__.SetStyle,
  SetText: _core_edit_actions_SetText_js__WEBPACK_IMPORTED_MODULE_75__.SetText,
  SetStamp: _core_edit_actions_SetStamp_js__WEBPACK_IMPORTED_MODULE_76__.SetStamp,


  MarkupEvents: _core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_77__,
  MarkupTypes: _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_78__,
  theEditModeManager: _core_EditModeManager_js__WEBPACK_IMPORTED_MODULE_81__.theEditModeManager,
  Utils: _core_MarkupsCoreUtils_js__WEBPACK_IMPORTED_MODULE_79__
};

// Spread the markup types to minimize breaking changes (sigh)
for (var markupType in _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_78__) {
  Core[markupType] = _core_MarkupTypes_js__WEBPACK_IMPORTED_MODULE_78__[markupType];
}

// Spread the event ids to minimize breaking changes (sigh)
for (var eventType in _core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_77__) {
  Core[eventType] = _core_MarkupEvents_js__WEBPACK_IMPORTED_MODULE_77__[eventType];
}

// Merge StyleUtils with utils (because those methods used to live in Utils)
for (var thing in _core_StyleUtils_js__WEBPACK_IMPORTED_MODULE_80__) {
  if (thing in Core.Utils)
  throw new Error(`Property ${thing} from StyleUtils already present in MarkupsCoreUtils.`);

  Core.Utils[thing] = _core_StyleUtils_js__WEBPACK_IMPORTED_MODULE_80__[thing];
}


const Gui = {
  MarkupsGui: _gui_MarkupsGui_js__WEBPACK_IMPORTED_MODULE_1__.MarkupsGui
};


// Also map back to legacy namespace
Autodesk.Viewing.Extensions.Markups = {
  Core
};
})();

Autodesk.Extensions.Markup = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Markup.js.map