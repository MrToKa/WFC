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

/***/ "./extensions/Edit3D/CoordPicker.js"
/*!******************************************!*\
  !*** ./extensions/Edit3D/CoordPicker.js ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ CoordPicker)
/* harmony export */ });
const ToolName = 'ModelAlignment.CoordPicker';

const Events = {
  POINT_CLICKED: 'pointClicked',
  POINT_HOVERED: 'pointHovered', // point param may be undefined if no object was hit at the current mouse position
  ESCAPE: 'escape',
  SELECTION_PLANE_CHANGED: 'selectionPlaneChanged'
};

class CoordPicker {

  constructor(viewer, snapper) {
    this.viewer = viewer;
    this.snapper = snapper;

    // Bind function so that we can use it for event listeners
    this.onCameraChanged = this.onCameraChanged.bind(this);

    Autodesk.Viewing.EventDispatcher.prototype.apply(this);

    // Optional: If a plane is set, we select points on this plane instead of the model
    this.selectionPlane = null;

    this.enableSnapper = true;
    this.snapperActive = false;
    this.isDragging = false;

    this.keyMap = {
      SnapKey: Autodesk.Viewing.KeyCode.SHIFT // Holding this key suppresses snapping
    };

    // Track last mouse position in canvas coords. Note that derived classes must call
    // the base class mouse handlers to keep this value valid.
    this.canvasPos = new THREE.Vector2();

    this.tmpPoint = new THREE.Vector3();
    this.tmpMatrix3 = new THREE.Matrix3();

    // Last successful hit under mouse.
    this.lastHit = null;
    this.consumeClickEvents = true;

    this.snapFilter = null; // Optional snapping filter, based on snapResult. (snapResult) => boolean.
    this.ignore2dModelsOnPick = false;

    // Set default cursor.
    this.setCursor();
  }

  // @param {THREE.Plane} [plane] - If a plane is set, we are selecting points on that plane instead of the model.
  setSelectionPlane(plane) {
    this.selectionPlane = plane;
    this.fireEvent({ type: Events.SELECTION_PLANE_CHANGED, plane });
  }

  getName() {
    return ToolName;
  }

  getNames() {
    return [ToolName];
  }

  setCursor(cursor) {
    this.cursor = cursor ? cursor : 'crosshair';
  }

  getCursor() {
    return this.isDragging ? 'grabbing' : this.active && this.lastHit ? this.cursor : null;
  }

  snapperOn() {
    if (!this.snapperActive) {
      this.viewer.toolController.activateTool(this.snapper.getName());
      this.snapperActive = true;
    }
  }

  snapperOff() {
    if (this.snapperActive) {
      this.viewer.toolController.deactivateTool(this.snapper.getName());
      this.snapperActive = false;
    }
  }

  setSnapperEnabled(enabled) {
    this.enableSnapper = enabled;
    if (enabled) {
      this.snapperOn();
    } else {
      this.snapperOff();
    }
  }

  setSnapFilter(snapFilter) {
    this.snapFilter = snapFilter;
    this.snapper.setSnapFilter(snapFilter);
  }

  setIgnore2dModelsOnPick(ignore) {
    this.ignore2dModelsOnPick = !!ignore;
    if (this.snapper.setIgnore2dModelsOn3d) {
      this.snapper.setIgnore2dModelsOn3d(ignore);
    }
  }

  activate() {
    this.active = true;

    if (this.enableSnapper) {
      this.snapperOn();
    }

    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);
    this.viewer.impl.pauseHighlight(true);
  }

  deactivate() {
    this.active = false;
    this.isDragging = false;
    this.lastHit = null;

    this.snapperOff();

    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChanged);
    this.viewer.impl.pauseHighlight(false);
  }

  register() {}

  // Remember last mouse position
  trackMousePos(e) {
    this.canvasPos.set(e.canvasX, e.canvasY);
  }

  handleMouseMove(event) {
    this.trackMousePos(event);

    // Make sure that snapping result is up-to-date
    this.snapper.onMouseMove({ x: event.canvasX, y: event.canvasY });

    if (this.snapper.indicator) {
      this.snapper.indicator.render();
    }

    // Note that we always fire, even if hit is undefined. This is needed to clear indicators and edit
    // values if the mouse is not on an object anymore.
    const result = this.getHitResultUnderMouse(event);
    this.fireEvent({ type: Events.POINT_HOVERED, ...result });

    return this.isDragging;
  }

  // Returns hitPoint under mouse or null if no object under mouse.
  getHitResultUnderMouse(event) {

    let point = null;
    let normal = null;
    let modelId = null;
    let dbId = null;

    if (this.snapperActive && this.snapper.isSnapped()) {
      // Get snapped position.
      const hitResult = this.snapper.getSnapResult();
      point = Autodesk.Viewing.MeasureCommon.getSnapResultPosition(hitResult, this.viewer);
      normal = hitResult?.faceNormal;
      modelId = hitResult?.modelId;
      dbId = hitResult?.snapNode;
    } else {
      // When snapper is not active, or no point resulted, perform a simple hit test.
      const hitTestOptions = this.ignore2dModelsOnPick ? { ignore2dModelsOn3d: true } : undefined;
      const hitResult = this.viewer.impl.hitTest(
        event.canvasX,
        event.canvasY,
        false,
        undefined,
        undefined,
        hitTestOptions
      );
      point = hitResult?.point;

      // Extract normal
      if (hitResult?.face?.normal) {
        const worldMatrix = new THREE.Matrix4();
        hitResult.model.getFragmentList()?.getWorldMatrix(hitResult.fragId, worldMatrix);
        const normalMatrix = this.tmpMatrix3.getNormalMatrix(worldMatrix);
        normal = hitResult.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      }

      modelId = hitResult?.model?.id;
      dbId = hitResult?.dbId;
    }

    if (this.snapFilter && !this.snapFilter({ modelId })) {
      point = null;
      normal = null;
      modelId = null;
      dbId = null;
    }

    // If selection plane is set, project the hit point on the plane.
    if (point && this.selectionPlane) {
      point = this.selectionPlane.projectPoint(point, this.tmpPoint);
    }

    const result = { point, normal, modelId, dbId };

    // Update lastHit only if we have an actual hit.
    this.lastHit = point ? result : null;

    return result;
  }

  setConsumeClickEvents(consumeClickEvents) {
    this.consumeClickEvents = consumeClickEvents;
  }

  handleSingleClick(event, button) {
    this.trackMousePos(event);

    // Only respond to left button
    if (button !== 0) {
      return false;
    }

    const result = this.getHitResultUnderMouse(event);

    this.fireEvent({ type: Events.POINT_CLICKED, ...result });

    return this.consumeClickEvents;
  }

  handleDoubleClick(event) {
    this.trackMousePos(event);
  }

  handleButtonDown(event) {
    this.trackMousePos(event);

    // In case of start dragging, make sure to turn on the snapper first.
    if (this.isDragging) {
      this.snapperOn();
    }

    return this.handleMouseMove(event);
  }

  handleButtonUp(event) {
    this.trackMousePos(event);
    return this.isDragging;
  }

  // Simulate mouse move instantly when snapper is being toggled.
  onSnappingToggled() {
    this.handleMouseMove({
      canvasX: this.canvasPos.x,
      canvasY: this.canvasPos.y
    });
  }

  handleKeyDown(event, keyCode) {
    switch (keyCode) {
      case Autodesk.Viewing.KeyCode.BACKSPACE:
      case Autodesk.Viewing.KeyCode.DELETE:
      case Autodesk.Viewing.KeyCode.ESCAPE:
        this.fireEvent({ type: Events.ESCAPE });
        return true;
      case this.keyMap.SnapKey:
        if (this.snapperActive) {
          this.snapperOff();
          this.onSnappingToggled();
          return true;
        }
        return false;
      default:
        break;
    }

    return false;
  }


  handleKeyUp(event, keyCode) {
    switch (keyCode) {
      case this.keyMap.SnapKey:
        if (!this.snapperActive && this.enableSnapper) {
          this.snapperOn();
          this.onSnappingToggled();
          return true;
        }
        return false;
      default:
        break;
    }

    return false;
  }

  onCameraChanged() {
    if (this.snapper.indicator) {
      this.snapper.indicator.render();
    }
  }

  setDragging(isDragging) {
    this.isDragging = isDragging;
  }

  getDragging() {
    return this.isDragging;
  }

  // Make sure that this tool takes preference over OrbitDollyPanTool (which has default priority 0) and the ModelTransformTool (which has priority 1)
  getPriority() {
    return 2;
  }
}

CoordPicker.Events = Events;
CoordPicker.Name = ToolName;

/***/ },

/***/ "./extensions/Edit3D/Gizmo3D.js"
/*!**************************************!*\
  !*** ./extensions/Edit3D/Gizmo3D.js ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ Gizmo3D)
/* harmony export */ });

let nextId = 1;

// Helper class for displaying a 3D shape that is scaled to keep approximately constant screen-size.
// Example:
//   const gizmo = new Gizmo3D(viewer).makeCube();
//   gizmo.setPosition(10, 10, 10);
//   gizmo.setVisible(true);
class Gizmo3D {

  // @param {Viewer3d} viewer
  // @param {number}   [pixelSize]   - Size of the gizmo in pixels
  // @param {Vector3}  [pos]         - Initial position. Default (0,0,0)
  // @param {string}   [overlayName] - Name of an (existing) viewer overlay used to display the gizmo. If not specified, the Gizmo creates its own.
  constructor(viewer, pixelSize = 30, pos = null, overlayName = null) {

    this.id = nextId++;

    this.viewer = viewer;

    // The shape is auto-scaled in a way that the projected screen-size of the unitBox diagonal
    // keeps equal to this value.
    this.pixelSize = pixelSize;

    // Container for the gizmo shape. Matrix of this scene is controlled by the gizmo
    this.scene = new THREE.Scene();

    // Shape or scene to be displayed. BBox should be the unit box [-0.5, 0.5]^2, so that
    // uto-scaling works properly.
    this.shape = null;

    // Connect event listener
    this.onCameraChange = this.onCameraChange.bind(this);
    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);

    // Make sure that matrix is recomputed after position/scale changes.
    this.scene.matrixAutoUpdate = true;

    // Overlay name that we use to display the gizmo
    this.overlayName = overlayName;

    // create own overlay if none specified
    this.overlayOwned = !overlayName;
    if (this.overlayOwned) {
      this.overlayName = `Gizmo3D_Overlay_${this.id}`;
      this.viewer.impl.createOverlayScene(this.overlayName);
    }

    this.visible = false;

    if (pos) {
      this.setPosition(pos);
    }
  }

  setPosition(x, y, z) {

    // Suppoer call with single Vec3 param
    if (typeof x === 'object') {
      this.scene.position.copy(x);
    } else {
      this.scene.position.set(x, y, z);
    }
    this.scene.matrixWorldNeedsUpdate;

    this.update();

    return this;
  }

  dtor() {
    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);

    if (this.overlayOwned) {
      this.viewer.impl.removeOverlayScene(this.overlayName);
    }
  }

  clearShape() {
    if (this.shape) {
      this.scene.remove(this.shape);
      this.shape = null;
    }
  }

  // Set a gizmo shape to display. Must be scaled to unitBox.
  setShape(shape) {
    this.clearShape();
    this.shape = shape;
    this.scene.add(shape);
    return this;
  }

  // Set shape to sphere
  makeSphere(color = 0xff0000) {

    // create sphere mesh, centered at (0,0,0)
    const radius = 0.5;
    const widthSegments = 22;
    const heightSegments = 16;
    const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
    const material = new Autodesk.Viewing.Scene.StandardMaterial({ color });
    const shape = new THREE.Mesh(geometry, material);

    return this.setShape(shape);
  }

  makeCube(color = 0xff0000) {

    // create box mesh of edgeLength 1, centered at (0,0,0)
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new Autodesk.Viewing.Scene.StandardMaterial({ color });
    const shape = new THREE.Mesh(geometry, material);
    return this.setShape(shape);
  }

  setVisible(visible) {
    if (this.visible == visible) {
      return;
    }

    if (visible) {
      this.viewer.impl.addOverlay(this.overlayName, this.scene);
    } else {
      this.viewer.impl.removeOverlay(this.overlayName, this.scene);
    }

    this.visible = visible;

    // trigger overlay update
    this.viewer.impl.invalidate(false, false, true);

    return this;
  }

  update() {
    // compute screenSize that we get with scaling 1.0
    const dist = this.viewer.impl.camera.position.distanceTo(this.scene.position);
    const worldToPixelScale = this.viewer.impl.camera.pixelsPerUnitAtDistance(dist);

    // compute and apply scale in world-space
    const scale = this.pixelSize / worldToPixelScale;
    this.scene.scale.set(scale, scale, scale);

    // make sure that scale changes takes effect
    this.scene.matrixWorldNeedsUpdate = true;

    this.viewer.impl.invalidate(false, false, true);
  }

  // On camera changes, update scaling to keep constant pixel-size
  onCameraChange() {
    this.update();
  }
}

/***/ },

/***/ "./extensions/Edit3D/Label3D.js"
/*!**************************************!*\
  !*** ./extensions/Edit3D/Label3D.js ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ Label3D)
/* harmony export */ });

const av = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;

// Given two points p1, p2 in worldSpace, this function computes
// the pixel distance of their screen projections.
const getPixelDistance = (viewer, p1, p2) => {

  const p1Screen = viewer.impl.worldToClient(p1);
  const p2Screen = viewer.impl.worldToClient(p2);

  const dx = p2Screen.x - p1Screen.x;
  const dy = p2Screen.y - p1Screen.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const Events = {
  DRAG_START: "dragStart",
  DRAG_END: "dragEnd"
};

// A Label3D is an html div whose position is synchronized with a fixed world-space position in LMV.
class Label3D extends Autodesk.Viewing.EventDispatcher {
  #opacity = 1.0;
  // @param {Viewer3D}      viewer
  // @param {THREE.Vector3} [pos3D] - By default (0,0,0). Can be set later by changing this.pos3D.
  // @param {string}        [text]  - If undefined, label will be empty/invisible by default and you have to configure this.container yourself.
  constructor(viewer, pos3D = new THREE.Vector3(), text = '<Empty>') {
    super();
    this.viewer = viewer;
    this.pos3D = pos3D;
    this.pos2D = new THREE.Vector3(); // updated automatically. z is the depth value
    this.draggable = false;
    this.setGlobalManager(viewer.globalManager);

    // keep position in-sync with camera changes
    this.cameraChangeCb = this.update.bind(this);
    this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this.cameraChangeCb);
    this.viewer.addEventListener(av.VIEWER_RESIZE_EVENT, this.cameraChangeCb);

    // Create container
    const document = viewer.canvasWrap.ownerDocument; // (might be != global document in popout scenarios)
    this.container = document.createElement('div');

    // Note: It's essential that we add it to viewer.canvasWrap instead of viewer.container:
    //       ToolController listens to events on canvasWrap. Therefore, if we would add
    //       it to viewer.container, all mouse events captured would never reach the ToolController
    //       no matter whether the gizmo handles them or not.
    viewer.canvasWrap.appendChild(this.container);

    // For fadeIn/Out effects
    const opacityChangeCb = this.#updateOpacity.bind(this);
    this.opacityParam = new avp.AnimatedParam(0.0, opacityChangeCb, 0.5);

    // Initial fade-in
    this.opacityParam.fadeTo(1.0);

    // We control position via transform. So, left/top usually keep (0,0)
    this.container.style.left = '0px';
    this.container.style.top = '0px';
    this.container.style.position = 'absolute';
    this.container.style.pointerEvents = 'none';

    // Only used for text labels
    this.textDiv = null;
    if (text) {
      this.setText(text);
    }

    // Level-of-detail (optional)
    this.worldBox = null;
    this.minPixels = 0;

    // Update position and fade-in
    this.setVisible(true);

    this.onMouseDown = this.onMouseDown.bind(this);
  }

  // Decides if the label should be shown or hidden.
  // We hide the label the projected box diagonal falls below this.minPixels.
  shouldBeHidden() {
    if (!this.worldBox) {
      return false;
    }

    const boxSizeScreen = getPixelDistance(this.viewer, this.worldBox.min, this.worldBox.max);
    return boxSizeScreen < this.minPixels;
  }

  // Optional: WorldBox of the annotated object. Used for level-of-detail: We only show the label
  //           if the projected screen-size of the box is >= a given minimum pixel size.
  // @param {Box3}   worldBox
  // @param {number} minPixels
  setWorldBox(box, minPixels) {
    this.worldBox = box;
    this.minPixels = minPixels;
    this.update(); // hide this label immediately if projected world-box is very small
  }

  // Configure this label to display text
  initTextLabel() {

    // Create textDiv child div
    const document = this.viewer.container.ownerDocument;
    this.textDiv = document.createElement('div');
    this.container.appendChild(this.textDiv);

    // Use measure-tool styles by default
    this.container.classList.add('measure-length');
    this.container.classList.add('visible');
    this.textDiv.classList.add('measure-length-text');
  }

  setText(text) {
    if (!this.textDiv) {
      this.initTextLabel();
    }
    this.textDiv.textContent = Autodesk.Viewing.i18n.translate(text);
  }

  dtor() {
    this.container.remove();
    this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this.cameraChangeCb);
    this.viewer.removeEventListener(av.VIEWER_RESIZE_EVENT, this.cameraChangeCb);
  }

  // To change the position, just modify this.pos3D directly and call update().
  update() {
    // Get canvas position corresponding to this.pos3D
    const { x, y } = this.viewer.impl.worldToClient(this.pos3D);

    // Transform the div, so that its center is anchored in (x,y)
    this.container.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;

    // Hide label if the annotated object is small on screen
    const hidden = !this.visible || this.shouldBeHidden();

    // If the label should be visible, immediately restore the container visibility, so the fade-in will be displayed.
    if (!hidden) {
      this.changeContainerVisibility(!hidden);
    }

    // this.opacityParam.skipAnim();
    this.opacityParam.fadeTo(hidden ? 0.0 : 1.0, () => {
      // If the label should be hidden, change container visibility only after the fade-out animation finished.
      // This is needed in order that the element won't be touchable while hidden.
      this.changeContainerVisibility(!hidden);
    });
  }

  // Necessary in addition to the opacity change, in order to remove from the DOM rendering.
  changeContainerVisibility(show) {
    if (!show && !this.styleHidden) {
      this.styleHidden = true;
      this.container.style.display = 'none';
    } else if (show && this.styleHidden) {
      this.styleHidden = false;
      this.container.style.display = 'block';
    }
  }

  // update style opacity if opacity was changed or due to visibility fading
  #updateOpacity() {
    // The opacity is specified by this.opacity, but the finally applied value
    // can also be affected by visibility fading.
    // 1 if label is fully visible and no fadeIn/fadeOut is active
    // If this.opacityParam is not defined yet, the visOpacity is set to 1.0
    const visOpacity = this.opacityParam ? this.opacityParam.curValue : 1.0;
    this.container.style.opacity = visOpacity * this.opacity;
  }

  get opacity() {
    return this.#opacity;
  }

  /**
   * @param {number} value
   */
  set opacity(value) {
    this.#opacity = value;
    this.#updateOpacity();
  }

  setPosition(pos) {
    this.pos3D.copy(pos);
    this.update();
  }

  setVisible(visible) {
    this.visible = visible;
    this.update();
  }

  // Fade out and dispose label when done
  dispose() {
    this.setVisible(false);

    // Make sure that we clean up when fading is done.
    window.setTimeout(() => this.dtor(), 1000 * this.opacityParam.animTime);
  }

  // @param {number} offset - Optional: Vertical offset in screen-pixels. Positive values shift down.
  setVerticalOffset(offset) {
    this.container.style.top = offset + 'px';
  }

  onMouseDown(event) {
    this.container.style.cursor = "grabbing";

    this.viewer.toolController.__clientToCanvasCoords(event);

    this.fireEvent({ type: Events.DRAG_START, event });

    const handleMouseUp = (e) => {
      this.onMouseUp(e);
      this.removeDocumentEventListener("mouseup", handleMouseUp);
    };

    this.addDocumentEventListener("mouseup", handleMouseUp);
  }

  onMouseUp(event) {
    this.container.style.cursor = "grab";

    this.viewer.toolController.__clientToCanvasCoords(event);

    this.fireEvent({ type: Events.DRAG_END, event });
  }

  setDraggable(draggable) {
    if (draggable && !this.draggable) {
      this.container.addEventListener("mousedown", this.onMouseDown);
      this.container.style.cursor = "grab";
      this.container.style.pointerEvents = 'auto';
    } else if (!draggable && this.draggable) {
      this.container.removeEventListener("mousedown", this.onMouseDown);
      this.container.style.cursor = "";
      this.container.style.pointerEvents = 'none';
    }

    this.draggable = draggable;
  }
}

av.GlobalManagerMixin.call(Label3D.prototype);

Label3D.Events = Events;

/***/ },

/***/ "./extensions/Edit3D/NPointPicker.js"
/*!*******************************************!*\
  !*** ./extensions/Edit3D/NPointPicker.js ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ NPointPicker)
/* harmony export */ });
/* harmony import */ var _CoordPicker_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./CoordPicker.js */ "./extensions/Edit3D/CoordPicker.js");
/* harmony import */ var _PointMarker_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./PointMarker.js */ "./extensions/Edit3D/PointMarker.js");



// Controls the user interaction workflow for picking N points

const Events = {
  POINT_SELECTED: "pointSelected",
  POINT_HOVERED: "pointHovered",
  POINT_SELECTION_STARTED: "pointSelectionStarted",
  CLEAR: "clear"
};

const Colors = {
  Blue: "rgb(6, 150, 215)", // adskBlue500
  Red: "rgb(236, 74, 65)", // red500
  Black: "rgb(0,0,0)",
  White: "rgb(255,255,255)"
};

const ConnectorTypes = {
  Line: "line",
  Arrow: "arrow"
};

// N point picker - allows picking N points.
//  @param {Viewer3D}      viewer
//  @param {CoordPicker}   coordPicker
//  @param {ScreenOverlay} screenOverlay
//  @param {number}        N - number of points to select
//  @param {Object}        [options]
//  @param {Boolean}          [options.draggable] -      Whether points are draggable or not
//  @param {String[]}      [options.colors] -         Array of colors
//  @param {String[]}      [options.labels] -         Array of labels
//  @param {String[]}      [options.icons] -          Array of icons
//  @param {Object[]}      [options.connections] -    Array of point connections metadata.
//  @param {Object[]}      [options.stops] -          Array of point indexes that the tool shouldn't automatically continue positioning new points after them.
class NPointPicker {
  constructor(viewer, coordPicker, screenOverlay, N, options = {}) {
    this.viewer = viewer;
    this.options = options;
    this.coordPicker = coordPicker;
    this.N = N;

    Autodesk.Viewing.EventDispatcher.prototype.apply(this);

    // Current active point - the one that is currently being picked or hovered.
    this.selectingIndex = -1;

    // A fresh pick and a drag of an existing point both commit through onPointClicked, so the
    // distinction has to be remembered here to reach POINT_SELECTED.
    this.selectingIsDrag = false;

    // Last valid point that was selected. Drag an exising previous point won't change this value.
    this.lastSelectedPoint = -1;

    this.coordPicker.addEventListener(
      _CoordPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events.POINT_CLICKED,
      (event) => this.onPointClicked(event)
    );
    this.coordPicker.addEventListener(
      _CoordPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events.POINT_HOVERED,
      (event) => this.onPointHovered(event)
    );
    this.coordPicker.addEventListener(
      _CoordPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events.SELECTION_PLANE_CHANGED,
      () => this.onSelectionPlaneChanged()
    );
    this.coordPicker.addEventListener(_CoordPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events.ESCAPE, () => {
      // Reset point only when dragging.
      if (this.coordPicker.isDragging) {
        this.cancelPointSelection();
      }
    });

    this.points = [];
    this.pointValid = [];
    this.markers = [];
    this.showMarkers = this.options.showMarkers || new Array(this.N).fill(true); // If showMarkers array is not supplied, default to true.

    for (let i = 0; i < this.N; i++) {
      this.points.push(new THREE.Vector3());
      this.pointValid.push(false);
      const color = options.colors ? options.colors[i] : Colors.Blue;
      const label = options.labels ? options.labels[i] : undefined;
      const icon = options.icons ? options.icons[i] : undefined;
      const marker = new _PointMarker_js__WEBPACK_IMPORTED_MODULE_1__["default"](this.viewer, undefined, label, icon);
      this.markers.push(marker);

      if (this.options.draggable) {
        marker.addEventListener(_PointMarker_js__WEBPACK_IMPORTED_MODULE_1__["default"].Events.DRAG_START, () =>
        this.startSelectPoint(i, true)
        );
        marker.addEventListener(_PointMarker_js__WEBPACK_IMPORTED_MODULE_1__["default"].Events.DRAG_END, (event) =>
        this.onDragEnded(event)
        );
      }

      // Hide the markers until we have valid from/to point
      marker.setVisible(false);
      marker.setColor(color);

      // Custom label style
      if (options.labelStyles && options.labelStyles[i]) {
        Object.keys(options.labelStyles[i]).forEach((key) => {
          marker.label.container.style[key] = options.labelStyles[i][key];
        });
      }
    }

    // {Autodesk.Edit2D.ScreenOverlay}
    this.screenOverlay = screenOverlay;

    const connectionsData = this.options.connections || [];
    this.connectors = [];

    for (let i = 0; i < connectionsData.length; i++) {
      const connectionData = connectionsData[i];

      // Configure style of line/arrow connection
      const lineStyle = new Autodesk.Edit2D.Style({
        lineStyle: 10,
        lineWidth: 1.5,
        lineColor: connectionData.color || Colors.Blue
      });

      let gizmo;
      let attachableObject;
      let setFrom;
      let setTo;

      if (connectionData.type === ConnectorTypes.Line) {
        // Dashed line connecting from/to point
        gizmo = new Autodesk.Edit2D.ScreenOverlay.Line3DGizmo();
        gizmo.line2D.style.copy(lineStyle);

        // Define attachable object for the label
        attachableObject = gizmo.line2D;

        // Define position setters
        setFrom = gizmo.a.copy.bind(gizmo.a);
        setTo = gizmo.b.copy.bind(gizmo.b);
      } else if (connectionData.type === ConnectorTypes.Arrow) {
        // Dashed arrow connecting from/to point
        gizmo = new Autodesk.Edit2D.ScreenOverlay.Arrow3DGizmo();
        gizmo.arrow.line.style.copy(lineStyle);
        gizmo.arrow.head.style.fillColor = lineStyle.lineColor;
        gizmo.arrow.setHeadLength(18); // in pixels, because layer is screen-aligned
        gizmo.arrow.setHeadAngle(40); // in degrees

        // Define attachable object for the label
        attachableObject = gizmo.arrow.line;

        // Define position setters
        setFrom = gizmo.setFrom.bind(gizmo);
        setTo = gizmo.setTo.bind(gizmo);
      } else {
        console.warn("Invalid connector type.");
        continue;
      }

      let label;

      if (connectionData.getEdgeLabelText) {
        label = new Autodesk.Edit2D.EdgeLabel(screenOverlay.layer);
        label.attachToEdge(attachableObject, 0, 0);

        // Custom label style
        if (connectionData.labelStyle) {
          Object.keys(connectionData.labelStyle).forEach((key) => {
            label.container.style[key] = connectionData.labelStyle[key];
          });
        }
      }

      this.connectors.push({
        fromIndex: connectionData.fromIndex,
        toIndex: connectionData.toIndex,
        getEdgeLabelText: connectionData.getEdgeLabelText,
        gizmo,
        label,
        setFrom,
        setTo
      });
    }

    this.visible = true;

    this.stops = this.options.stops || [];

    this.onModelTransformChanged = this.onModelTransformChanged.bind(this);
    this.onSelectionPlaneChanged = this.onSelectionPlaneChanged.bind(this);

    this.modelsToPointsMap = {}; // { modelId: [indexes] }
  }

  dtor() {
    this.viewer.removeEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onModelTransformChanged);
    this.viewer = null;
  }

  startSelectPoint(index, enableDrag) {
    // Backup current point's position in case the drag won't be valid. In this case, we'll restore the current point.
    this.pointBackup = this.pointValid[index] ?
    this.points[index].clone() :
    null;

    // Start coord picker
    if (!this.viewer.toolController.isToolActivated(this.coordPicker.getName())) {
      this.viewer.toolController.activateTool(this.coordPicker.getName());
    }

    this.selectingIndex = index;
    this.selectingIsDrag = !!enableDrag;

    if (this.options.draggable) {
      this.coordPicker.setDragging(enableDrag);
      this.setMarkersDraggable(false);
    }

    this.fireEvent({
      type: Events.POINT_SELECTION_STARTED,
      index: this.selectingIndex
    });
  }

  onDragEnded({ event }) {
    if (!this.coordPicker.getDragging()) {
      return;
    }

    this.coordPicker.handleSingleClick(event, 0);
    this.coordPicker.setDragging(false);
  }

  startSelect() {
    this.isActive = true;
    this.continuePointSelectionIfNeeded();
  }

  // @param {Vector3} [from] - Use null/undefined for clearing the fromPoint.
  setPoint(index, point) {
    this.pointValid[index] = !!point;

    if (this.pointValid[index]) {
      this.points[index].copy(point);

      // update point marker
      this.markers[index].setPosition(point);
    }

    this.updateGizmos();
  }

  updateGizmoVisibility(gizmo, visible, skipFade) {
    if (visible || skipFade) {
      // Show/Hide immediately.
      this.screenOverlay.setGizmoVisible(gizmo, visible);
    } else {
      // By default, hiding is done as smooth fadeout.
      this.screenOverlay.fadeOutGizmo(gizmo);
    }
  }

  // Show dashed line or arrow if from/to are both valid
  updateGizmos(skipFade) {
    for (let i = 0; i < this.N; i++) {
      const visible = this.showMarkers[i] && this.visible && this.pointValid[i];
      this.markers[i].setVisible(visible);
    }

    for (let i = 0; i < this.connectors.length; i++) {
      const connector = this.connectors[i];
      // Decide whether to show the connection between both points
      const showGizmo =
      this.visible &&
      this.pointValid[connector.fromIndex] &&
      this.pointValid[connector.toIndex];

      this.updateGizmoVisibility(connector.gizmo, showGizmo, skipFade);

      if (showGizmo) {
        connector.setFrom(this.points[connector.fromIndex]);
        connector.setTo(this.points[connector.toIndex]);
      }

      if (connector.label) {
        connector.label.setOpacity(showGizmo ? 1 : 0, true);

        // Update distance value only if label is visible.
        if (showGizmo) {
          const text = connector.getEdgeLabelText(i);
          connector.label.setText(text);
        }
      }
    }

    // ensure refresh if only position has changed
    this.screenOverlay.update();
  }

  clearPoint(index) {
    this.pointValid[index] = false;
    this.markers[index].setVisible(false);

    this.updateGizmos();
  }

  clear() {
    this.cancelPointSelection();

    for (let i = 0; i < this.N; i++) {
      this.pointValid[i] = false;
      this.markers[i].setVisible(false);
    }

    this.selectingIndex = -1;
    this.selectingIsDrag = false;
    this.lastSelectedPoint = -1;

    this.updateGizmos();

    this.isActive = false;

    this.fireEvent({ type: Events.CLEAR });
  }

  onPointHovered(event) {
    if (this.selectingIndex === -1) {
      return;
    }

    this.setPoint(this.selectingIndex, event.point);
    this.fireEvent({
      type: Events.POINT_HOVERED,
      point: event.point,
      index: this.selectingIndex
    });
  }

  onPointClicked({ point }, pickAnother = true) {
    if (this.selectingIndex === -1) {
      return;
    }

    // In case not point was selected, try restoring point backup.
    point = point || this.pointBackup;

    // Clear point backup
    this.pointBackup = null;

    // TODO: Avoid this hack. For this, the OrbitDollyPanTool should stop locking the ToolController and
    //       properly handle the case to be disabled within an interaction - without global blocking the ToolController.
    this.viewer.toolController.setIsLocked(false);
    this.viewer.toolController.deactivateTool(this.coordPicker.getName());

    if (point) {
      // Set pivot to selected point, so that we can orbit around it
      this.viewer.impl.camera.pivot.copy(point);
      this.viewer.impl.camera.dirty = true;
    }

    this.setPoint(this.selectingIndex, point);

    this.setMarkersDraggable(true);

    const index = this.selectingIndex;
    const isDrag = this.selectingIsDrag;

    this.selectingIndex = -1;
    this.selectingIsDrag = false;

    if (point) {
      this.lastSelectedPoint = Math.max(index, this.lastSelectedPoint);
      this.fireEvent({ type: Events.POINT_SELECTED, point, index, isDrag });
    }

    // Start picking another point if:
    // - pickAnother flag is set
    // - We just selected a point, and it's not a stop point index.
    if (pickAnother && !(point && this.stops.includes(this.lastSelectedPoint))) {
      this.continuePointSelectionIfNeeded();
    }
  }

  setMarkersDraggable(enable) {
    if (!this.options.draggable) {
      return;
    }

    for (let i = 0; i < this.N; i++) {
      const draggable =
      enable && this.visible && this.pointValid[i] && this.showMarkers[i];
      this.markers[i].setDraggable(draggable);
    }
  }

  cancelPointSelection() {
    this.onPointClicked({}, false);
  }

  continuePointSelectionIfNeeded() {
    if (!this.isPickerActive()) {
      return;
    }

    // Make sure the tool is visible.
    this.setVisible(true);

    for (let i = 0; i < this.N; i++) {
      if (!this.pointValid[i]) {
        this.startSelectPoint(i, false);
        break;
      }
    }
  }

  // Note: By default, setVisible(false) triggers a smooth fadeout. Use skipFade=true if you want to ensure that everything is instantly hidden.
  setVisible(visible, skipFade) {
    if (visible !== this.visible) {
      this.visible = visible;
      this.updateGizmos(skipFade);
    }
  }

  // Shortcut for readability: Hide immediately without any fade-out.
  forceHide() {
    this.setVisible(false, true);
  }

  areAllPointsSet() {
    if (this.selectingIndex !== -1) {
      return false;
    }

    for (let i = 0; i < this.N; i++) {
      if (!this.pointValid[i]) {
        return false;
      }
    }

    return true;
  }

  isPickerActive() {
    return this.isActive;
  }

  attachPointsToModel(model, points) {
    this.setModelsToPointsMap(Object.assign({}, this.modelsToPointsMap, { [model.id]: points }));
  }

  // ModelsToPointsMap is used to define a connection between points and specific models.
  // It is currently being used in order to update the points according to model transform changes.
  // Could be also used in the future for limiting the snapper to snap only on the attached model.
  setModelsToPointsMap(map) {
    this.modelsToPointsMap = map;

    const ids = Object.keys(this.modelsToPointsMap);

    if (ids.length > 0) {
      ids.forEach((id) => {
        const model = this.viewer.impl.findModel(Number(id), true);

        // Used in order to calculate the initial transform diff later.
        const matrix = model.getModelTransform()?.clone();
        this.modelsToPointsMap[id].matrix = matrix || new Autodesk.Viewing.Private.LmvMatrix4(true);
      });

      if (!this.viewer.hasEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onModelTransformChanged)) {
        this.viewer.addEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onModelTransformChanged);
      }

    } else {
      // Remove event if there is no mapping.
      this.viewer.removeEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onModelTransformChanged);
    }
  }

  // Update points that are attached to a specific model, in case it moved.
  onModelTransformChanged({ model, matrix }) {
    // No map;
    if (!this.modelsToPointsMap) {
      return;
    }

    const pointIndexes = this.modelsToPointsMap[model.id];

    // Model not in map - nothing to update.
    if (!pointIndexes) {
      return;
    }

    // Calculate diff matrix.
    const previousMatrix = this.modelsToPointsMap[model.id].matrix;
    const diffMatrix = previousMatrix.invert();
    diffMatrix.multiplyMatrices(matrix, diffMatrix);

    // Update for next time.
    this.modelsToPointsMap[model.id].matrix = matrix.clone();

    for (let i = 0; i < this.N; i++) {
      if (pointIndexes.includes(i) && this.pointValid[i]) {

        const point = this.points[i];
        point.applyMatrix4(diffMatrix);
        this.setPoint(i, point);
      }
    }
  }

  // Reproject all valid points onto the current selection plane when it changes
  onSelectionPlaneChanged() {
    const plane = this.coordPicker.selectionPlane;
    if (!plane) {
      return;
    }

    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.N; i++) {
      if (this.pointValid[i]) {
        plane.projectPoint(this.points[i], tmp);
        this.setPoint(i, tmp);
      }
    }
  }
}

NPointPicker.Events = Events;
NPointPicker.Colors = Colors;
NPointPicker.ConnectorTypes = ConnectorTypes;

/***/ },

/***/ "./extensions/Edit3D/PointMarker.js"
/*!******************************************!*\
  !*** ./extensions/Edit3D/PointMarker.js ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ PointMarker)
/* harmony export */ });
/* harmony import */ var _Label3D_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Label3D.js */ "./extensions/Edit3D/Label3D.js");



const createIcon = (icon) => {
  return [
  '<svg width="50" height="50" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
  '<g stroke-width="2" stroke="currentColor" fill="none">',
  icon,
  '</g>',
  '</svg>'].
  join('');
};

const Icons = {
  Cross: '<path d="M0 25 L50 25 M25 0 L25 50"/>',
  Circle: '<circle r="5" cx="25" cy="27.5" fill="currentColor" stroke-width="0" />',
  Empty: ''
};

class PointMarker extends _Label3D_js__WEBPACK_IMPORTED_MODULE_0__["default"] {

  constructor(viewer, pos3D, labelText, icon = Icons.Cross) {
    super(viewer, pos3D, null);

    this.container.innerHTML = createIcon(icon);

    // Create another label for the text
    if (labelText) {
      this.label = new _Label3D_js__WEBPACK_IMPORTED_MODULE_0__["default"](viewer, pos3D, labelText);

      // Center text above the actual position
      this.label.setVerticalOffset(-45);
    }

    // Set label visible by default. If text is empty, it is hidden anyway.
    this.labelVisible = true;
  }

  dtor() {
    super.dtor();
    this.label.dtor();
  }

  // @param {string} Color string in css style (e.g. 'rgb(255, 255, 255)');
  setColor(color) {
    this.container.style.color = color;
  }

  setPosition(pos) {
    super.setPosition(pos);
    this.label && this.label.setPosition(pos);
  }

  setVisible(visible) {
    super.setVisible(visible);
    this.label && this.label.setVisible(this.labelVisible && visible);
  }

  setLabelVisible(visible) {
    this.label && this.label.setVisible(this.visible && visible);
  }
}

PointMarker.Events = _Label3D_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events;
PointMarker.Icons = Icons;

/***/ },

/***/ "./extensions/Edit3D/TwoPointPicker.js"
/*!*********************************************!*\
  !*** ./extensions/Edit3D/TwoPointPicker.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ TwoPointPicker)
/* harmony export */ });
/* harmony import */ var _NPointPicker_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NPointPicker.js */ "./extensions/Edit3D/NPointPicker.js");


// Controls the user interaction workflow for aligning a model based on two selected points

// Extend NPointPicker events.
const Events = Object.assign({}, _NPointPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events, {
  FROM_POINT_SELECTED: 'fromPointSelected',
  TO_POINT_SELECTED: 'toPointSelected',
  FROM_POINT_HOVERED: 'fromPointHovered',
  TO_POINT_HOVERED: 'toPointHovered'
});

// Implements the interaction to select two points: A 'fromPoint' and a 'toPoint'.
class TwoPointPicker extends _NPointPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"] {

  constructor(viewer, coordPicker, screenOverlay, options) {
    super(viewer, coordPicker, screenOverlay, 2, options);

    this.addEventListener(_NPointPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events.POINT_SELECTED, ({ point, index }) => {
      if (index === 0) {
        this.fireEvent({ type: Events.FROM_POINT_SELECTED, point });
      } else {
        this.fireEvent({ type: Events.TO_POINT_SELECTED, point });
      }
    });

    this.addEventListener(_NPointPicker_js__WEBPACK_IMPORTED_MODULE_0__["default"].Events.POINT_HOVERED, ({ point, index }) => {
      if (index === 0) {
        this.fireEvent({ type: Events.FROM_POINT_HOVERED, point });
      } else {
        this.fireEvent({ type: Events.TO_POINT_HOVERED, point });
      }
    });
  }

  setOffset(offset) {
    this.offset.copy(offset);
  }

  startSelectFrom() {
    this.startSelectPoint(0);
  }

  startSelectTo() {
    this.startSelectPoint(1);
  }
}

TwoPointPicker.Events = Events;

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
  !*** ./extensions/Edit3D/Edit3D.js ***!
  \*************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ Edit3DExtension)
/* harmony export */ });
/* harmony import */ var _Gizmo3D_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Gizmo3D.js */ "./extensions/Edit3D/Gizmo3D.js");
/* harmony import */ var _Label3D_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./Label3D.js */ "./extensions/Edit3D/Label3D.js");
/* harmony import */ var _PointMarker_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./PointMarker.js */ "./extensions/Edit3D/PointMarker.js");
/* harmony import */ var _CoordPicker_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./CoordPicker.js */ "./extensions/Edit3D/CoordPicker.js");
/* harmony import */ var _TwoPointPicker_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./TwoPointPicker.js */ "./extensions/Edit3D/TwoPointPicker.js");
/* harmony import */ var _NPointPicker_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./NPointPicker.js */ "./extensions/Edit3D/NPointPicker.js");

const av = Autodesk.Viewing;
const namespace = AutodeskNamespace('Autodesk.Edit3D');
const myExtensionName = 'Autodesk.Edit3D';








/**
 * Edit3D extension is a collection of general-purpose helper classes to faciliate
 * implementation of 3D EditTools.
 * Loading the extension does not add UI or changes behavior in the viewer. Its purpose is only
 * to provide a basis for other extensions and client applications.
 *
 * The extension id is: `Autodesk.Edit3D`
 *
 * @example
 *   viewer.loadExtension('Autodesk.Edit3D')
 *
 * @memberof Autodesk.Viewing.Extensions
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 */
class Edit3DExtension extends av.Extension {
  constructor(viewer, options) {
    super(viewer, options);
  }
}

namespace.Gizmo3D = _Gizmo3D_js__WEBPACK_IMPORTED_MODULE_0__["default"];
namespace.Label3D = _Label3D_js__WEBPACK_IMPORTED_MODULE_1__["default"];
namespace.PointMarker = _PointMarker_js__WEBPACK_IMPORTED_MODULE_2__["default"];
namespace.CoordPicker = _CoordPicker_js__WEBPACK_IMPORTED_MODULE_3__["default"];
namespace.TwoPointPicker = _TwoPointPicker_js__WEBPACK_IMPORTED_MODULE_4__["default"];
namespace.NPointPicker = _NPointPicker_js__WEBPACK_IMPORTED_MODULE_5__["default"];

// Register the extension with the extension manager.
av.theExtensionManager.registerExtension(myExtensionName, Edit3DExtension);
})();

Autodesk.Extensions.Edit3D = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Edit3D.js.map