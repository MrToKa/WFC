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

/***/ "./extensions/ZoomWindow/ZoomWindowTool.js"
/*!*************************************************!*\
  !*** ./extensions/ZoomWindow/ZoomWindowTool.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ZoomWindowTool)
/* harmony export */ });


const _CROSS_MAX_WIDTH = 20;

/**
 *
 * @constructor
 */
class ZoomWindowTool {

  constructor(viewer) {
    this._names = ["zoomwindow"];
    this._isActive = false;
    this._isDragging = false;
    this._mouseStart = new THREE.Vector3(0, 0, -10);
    this._mouseEnd = new THREE.Vector3(0, 0, -10);

    this.materialLine = null;
    this.lineGeom = null;
    this.crossGeomX = null;
    this.crossGeomY = null;

    this.rectGroup = null;
    this.viewer = viewer;
    this._camera = this.viewer.navigation.getCamera();
  }

  isActive() {
    return this._isActive;
  }

  getNames() {
    return this._names;
  }

  getName() {
    return this._names[0];
  }

  onResize() {
    this.rectGroup = null;
    var canvas = this.viewer.canvas;
    var canvasWidth = canvas.clientWidth;
    var canvasHeight = canvas.clientHeight;
    var camera = new THREE.OrthographicCamera(0, canvasWidth, 0, canvasHeight, 1, 1000);
    this.viewer.impl.overlayScenes["ZoomWindowRect"].camera = camera;
  }

  activate(name) {
    this._isActive = true;
    // predefine material for rect
    if (this.materialLine === null) {
      // for 2d file draw rectangle in black
      var rectColor = null;
      if (this.viewer.navigation.getIs2D()) {
        rectColor = new THREE.Color(0x000000);
      } else
      {
        rectColor = new THREE.Color(0xffffff);
      }
      this.materialLine = new THREE.LineBasicMaterial({
        color: rectColor,
        opacity: .6,
        linewidth: 1,
        depthTest: false,
        depthWrite: false
      });
      this.materialLine.doNotCut = true;
    }
    // create overlay scene, with orthographic Camera
    var canvas = this.viewer.canvas;
    var canvasWidth = canvas.clientWidth;
    var canvasHeight = canvas.clientHeight;
    var camera = new THREE.OrthographicCamera(0, canvasWidth, 0, canvasHeight, 1, 1000);

    this.viewer.impl.createOverlayScene("ZoomWindowRect", this.materialLine, this.materialLine, camera);
    this.onResizeBinded = this.onResize.bind(this);
    this.viewer.impl.api.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onResizeBinded);

    // ??? In zoom window tool, we let orbitDollyPanTool to handle
    // ??? pan and dolly. And also we need get correct cursor info
    // ??? in orbitDollyPanTool. But in 2D, orbitDollyPanTool's default
    // ??? cursor is pan, then we have no idea whether orbitDollyPanTool
    // ??? is handling the message.
    // ??? So set orbit tool as active tool when zoom window tool active.
    // ??? On deactive we need set back the correct active tool to orbitDollyPanTool
    var tool = this.viewer.toolController.getTool("dolly");
    tool.activate("orbit");
  }

  deactivate(name) {
    this.rectGroup = null;
    this.viewer.impl.removeOverlayScene("ZoomWindowRect");
    this._isActive = false;
    this._isDragging = false;
    this._mouseStart.set(0, 0, -10);
    this._mouseEnd.set(0, 0, -10);
    this.viewer.impl.api.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onResizeBinded);

    // ??? Refer to the comments in activate
    var tool = this.viewer.toolController.getTool("dolly");
    tool.deactivate("orbit");
  }

  getCursor() {
    var tool = this.viewer.toolController.getTool("dolly");
    var mode = tool.getTriggeredMode();
    switch (mode) {

      case "dolly":
        return "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAgVBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8mJiYAAADNzc2/v7+fn59paWlPT08MDAwICAj6+vqpqak7Ozv29vby8vLp6em2traAgIBkZGRZWVlAQEAaGhpISEgkS7tbAAAAFHRSTlMAOvhpZD8mkQWegMy9qY1YVE01EYiqlE0AAADZSURBVCjPbY9ZloMgEAAbEbfsmRZZXbJn7n/AAX2RQVN/VD26AXLOeZLDGo6IbfI9tHq8cdxuj1HwvgCoaiHqKoRk+M3hB9jueUW8PnfsE/bJ3vms7nCkq7NoE3s99AXxoh8vFoXCpknrn5faAuJCenT0xPkYqnxQFJaU0gdZrsKm8aHZrAIffBj40mc1jsTfIJRWegq6opTMvlfqLqYg7kr1ZB7jFgeaMC59N//8O4WZ1IiPF8b5wMHcJn8zB4g4mc77zpxgAbMSUVoGK4iV0hL4wrksz+H0Bw5+E+HrniDQAAAAAElFTkSuQmCC), auto";
      case "pan":
        return "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAABHVBMVEUAAABPTk4AAAAAAAAJCQkRERE0MzQQEBAODg4QEBB4d3dbWlo9PDw/Pj4vLy8sLCwZGBgWFhYcHBwKCgoSEhIAAAAKCgoICAgKCgoQEBAODg4EBAQICAgPDw8REREMDAx2dnY0NDQvLy9QUFAaGhomJSYjIyM7OjokJCQNDA0mJiYNDQ0AAAAUFBQJCQkQEBAEBAQNDQ0PDw8VFRX///+amJkAAAD5+fnz8/PKycn9/f339vbi4eLR0dDNzMyAgIB8e3xycHH7+/vw7+/o6OjX1ta7urq4t7iwsLCnp6eioqKbmppva21OTk74+Pjl5eXc3Nzb29vLy8vDw8PDwsKrqqqdnZ2WlpaSkpKTkZKMiouEg4NkZGRISEgxLzBpgbsEAAAANHRSTlMA+fiQXgngKSYG/vX17uvBuqackpCNg3BpUkpAPBwTDvj18+vl0s/NwrOwoZZ+TDg4NBkBGrzX8QAAAP5JREFUKM99j9Vuw0AQRdeuKZyGkyZNmbnXDLHDVGb8/8/oy7paK1bO0+oc7WiGnGiaxq+QRTQAOh8f9Jv4H/Ge8PZPrCdlvkxfYluUT2WyyCq3mZ7unwlKVLcqOzA/Mf71j0TWJ/Ym6rPeca05Ni4iIevYc7yoUD2zQFhq71BdI9nvBeBabFDSPe8DswlUc1Riw3VxbH0NHBUPQ0jrbDnPYDjALQBMq9E7nkC5y7VDKTZlUg8Q0lmjvl74zlYErgvKa42GPKf3/a0kQmYCDY1SYMDosqMoiWrGwz/uAbNvc/fNon4kXRKGq+PUo2Mb96afV0iUxqGU2s4VBbKUP65NL/LKF+7ZAAAAAElFTkSuQmCC), auto";
    }
    return "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAALEgAACxIB0t1+/AAAABx0RVh0U29mdHdhcmUAQWRvYmUgRmlyZXdvcmtzIENTNui8sowAAADWSURBVEiJ1ZVNEsIwCEYfTg/UjTPuemcvojfCRRMlNKGdKguZyaLkK4/8EERVybQJQERCUU3C63p+n/Bk9QHDRtbIX2GqKh6woRfxLdL0/M1KzYRaA+7AXDW9wN5fvrXEWud6AOABLD7QwREDgCdw7WV6ZjSAsi0Lzn4JmEcHeHbYWxQXw3FTEWmvaWY1X9Iie4CIKHE1fwfIsnSAZD/X/79FGbdISyzA9QMDG3axTTTVwx3NaNbm5B2dRHY1DWCUyd4qIs0bUB8nuz32/11Cu+KPM7sOXlrOS4sOkzb1AAAAAElFTkSuQmCC), auto";
  }

  /////////////////////////////////////////////////////////////////////////
  // Tool event handler callbacks - can use "this".

  handleGesture(event)
  {
    switch (event.type) {

      case "dragstart":
        return this.handleButtonDown(event, 0);

      case "dragmove":
        return this.handleMouseMove(event);

      case "dragend":
        return this.handleButtonUp(event, 0);
    }
    return false;
  }

  startDrag(event) {
    if (this._isDragging === false) {
      // begin dragging
      this._isDragging = true;
      this._mouseStart.x = event.canvasX;
      this._mouseStart.y = event.canvasY;
      this._mouseEnd.x = event.canvasX;
      this._mouseEnd.y = event.canvasY;
      if (this.rectGroup === null) {
        this.lineGeom = new THREE.Geometry();
        this.lineGeom.isLines = true;
        // rectangle of zoom window
        this.lineGeom.vertices.push(
          this._mouseStart.clone(),
          this._mouseStart.clone(),
          this._mouseStart.clone(),
          this._mouseStart.clone(),
          this._mouseStart.clone());
        // cross for identify zoom window center.
        this.crossGeomX = new THREE.Geometry();
        this.crossGeomX.isLines = true;
        this.crossGeomX.vertices.push(
          this._mouseStart.clone(),
          this._mouseStart.clone());
        this.crossGeomY = new THREE.Geometry();
        this.crossGeomY.isLines = true;
        this.crossGeomY.vertices.push(
          this._mouseStart.clone(),
          this._mouseStart.clone());

        // add geom to group
        var line_mesh = new THREE.Line(this.lineGeom, this.materialLine, THREE.LineStrip);
        var line_cross_x = new THREE.Line(this.crossGeomX, this.materialLine, THREE.LineStrip);
        var line_cross_y = new THREE.Line(this.crossGeomY, this.materialLine, THREE.LineStrip);

        // Extra hint required for WebGPURenderer
        this.lineGeom.isLineStrip = true;
        this.crossGeomX.isLineStrip = true;
        this.crossGeomY.isLineStrip = true;

        this.rectGroup = new THREE.Group();
        this.rectGroup.add(line_mesh);
        this.rectGroup.add(line_cross_x);
        this.rectGroup.add(line_cross_y);
      } else
      {
        this.lineGeom.vertices[0] = this._mouseStart.clone();
        this.lineGeom.vertices[1] = this._mouseStart.clone();
        this.lineGeom.vertices[2] = this._mouseStart.clone();
        this.lineGeom.vertices[3] = this._mouseStart.clone();
        this.lineGeom.vertices[4] = this._mouseStart.clone();

        this.crossGeomX.vertices[0] = this._mouseStart.clone();
        this.crossGeomX.vertices[1] = this._mouseStart.clone();
        this.crossGeomY.vertices[0] = this._mouseStart.clone();
        this.crossGeomY.vertices[1] = this._mouseStart.clone();


        this.crossGeomX.verticesNeedUpdate = true;
        this.crossGeomY.verticesNeedUpdate = true;
        this.lineGeom.verticesNeedUpdate = true;
      }
      this.viewer.impl.addOverlay("ZoomWindowRect", this.rectGroup);
    }
  }

  handleButtonDown(event, button) {
    // only handle left button down
    if (button === 0) {
      this.startDrag(event);
      return true;
    }
    return false;
  }

  handleMouseMove(event) {
    if (this.lineGeom && this._isDragging)
    {
      this._mouseEnd.x = event.canvasX;
      this._mouseEnd.y = event.canvasY;
      return true;
    }

    return false; // Eat all these so default tools don't screw with view
  }

  endDrag(event) {
    if (this._isDragging === true) {
      this.viewer.impl.removeOverlay("ZoomWindowRect", this.rectGroup);
      this._isDragging = false;

    }
  }

  handleButtonUp(event, button) {
    if (button === 0)
    {
      this.endDrag();
      return true;
    }
    return false;
  }

  handleKeyDown(event, keyCode) {
    return false;
  }

  handleKeyUp(event, keyCode) {
    return false;
  }

  handleWheelInput(delta) {
    return false;
  }

  handleSingleClick(event, button) {
    return false;
  }

  handleDoubleClick(event, button) {
    return false;
  }

  handleSingleTap(even) {
    return false;
  }

  handleDoubleTap(event) {
    return false;
  }

  handleBlur(event) {
    return false;
  }

  update() {
    //
    if (!this.isActive())
    return;

    if (this.lineGeom && this._isDragging) {
      // draw rectangle
      this.lineGeom.vertices[1].x = this._mouseStart.x;
      this.lineGeom.vertices[1].y = this._mouseEnd.y;
      this.lineGeom.vertices[2] = this._mouseEnd.clone();
      this.lineGeom.vertices[3].x = this._mouseEnd.x;
      this.lineGeom.vertices[3].y = this._mouseStart.y;
      this.lineGeom.vertices[4] = this.lineGeom.vertices[0];

      // draw cross
      var width = Math.abs(this._mouseEnd.x - this._mouseStart.x);
      var height = Math.abs(this._mouseEnd.y - this._mouseStart.y);
      var length = width > height ? height : width;
      if (length > _CROSS_MAX_WIDTH) {
        length = _CROSS_MAX_WIDTH;
      }
      var half_length = length * 0.5;

      var cross_center = [(this._mouseEnd.x + this._mouseStart.x) * 0.5,
      (this._mouseEnd.y + this._mouseStart.y) * 0.5];

      this.crossGeomX.vertices[0].x = cross_center[0] - half_length;
      this.crossGeomX.vertices[0].y = cross_center[1];
      this.crossGeomX.vertices[1].x = cross_center[0] + half_length;
      this.crossGeomX.vertices[1].y = cross_center[1];

      this.crossGeomY.vertices[0].x = cross_center[0];
      this.crossGeomY.vertices[0].y = cross_center[1] - half_length;
      this.crossGeomY.vertices[1].x = cross_center[0];
      this.crossGeomY.vertices[1].y = cross_center[1] + half_length;

      this.crossGeomX.verticesNeedUpdate = true;
      this.crossGeomY.verticesNeedUpdate = true;
      this.lineGeom.verticesNeedUpdate = true;
      // only redraw overlay
      this.viewer.impl.invalidate(false, false, true);
    } else
    {
      return this.zoomWindow();
    }

    return false;
  }

  getPivot(mouseX, mouseY, screenWidth, screenHeight, camera) {
    // Convert mouse coordinates to clip space (-1 to 1)
    mouseX = 2 * mouseX / screenWidth - 1;
    mouseY = 1 - 2 * mouseY / screenHeight;

    // Get the ray through mouseX, mouseY
    var start = new THREE.Vector3(mouseX, mouseY, -1);
    var dir = new THREE.Vector3(mouseX, mouseY, 1);
    start.unproject(camera);
    dir.unproject(camera);
    dir.sub(start);

    // Now project the ray onto the plane perpendicular to the view direction
    // that contains the camera target. To do this we solve these equations:
    // viewDir.dot(pivot) == viewDir.dot(target), because the pivot is in the plane of the target
    // pivot = start + t * dir for some t, because pivot is on the ray through mouseX, mouseY
    // The solution goes like this:
    // Substitute pivot from the second equation to the first
    // viewDir.dot(start + t * dir) == viewDir.dot(target)
    // Distribut dot()
    // viewDir.dot(start) + t * viewDir.dot(dir) == view.dot(target)
    // t = (viewDir.dot(target) - viewDir.dot(start)) / view.dot(dir)
    var eye = camera.position;
    var target = camera.target;
    var viewDir = target.clone().sub(eye).normalize();
    var t = (viewDir.dot(target) - viewDir.dot(start)) / viewDir.dot(dir);
    start.add(dir.multiplyScalar(t));
    return start;
  }

  queryMouseRaySceneIntersection(centerX, centerY) {
    if (this.viewer == null)
    return null;

    if (this.viewer.model == null)
    return null;

    if (this.viewer.model.is2d()) {
      return null;
    }

    var result = this.viewer.impl.hitTest(centerX, centerY, false);
    return result ? result.intersectPoint : null;
  }

  zoomWindow() {
    var camera = this._camera;
    var canvasWidth = this.viewer.canvas.clientWidth;
    var canvasHeight = this.viewer.canvas.clientHeight;
    var rectMinX = this._mouseStart.x;
    var rectMinY = this._mouseStart.y;
    var rectMaxX = this._mouseEnd.x;
    var rectMaxY = this._mouseEnd.y;

    var rectWidth = Math.abs(rectMaxX - rectMinX);
    var rectHeight = Math.abs(rectMaxY - rectMinY);
    if (rectWidth === 0 || rectHeight === 0) {
      return false;
    }

    this._mouseEnd.copy(this._mouseStart);

    if (this.viewer.navigation.getIs2D()) {
      var vpVec = {
        x: (rectMinX + rectMaxX) * 0.5,
        y: (rectMinY + rectMaxY) * 0.5
      };

      // Pan to the center of the zoom window first.
      var distance = this.viewer.navigation.getEyeVector().length();
      var delta = this.viewer.impl.clientToViewport(vpVec.x, vpVec.y);
      var on = this.viewer.impl.clientToViewport(canvasWidth / 2, canvasHeight / 2);
      delta.subVectors(delta, on);
      this.viewer.navigation.panRelative(delta.x / 2, delta.y / 2, distance);

      // Get scale
      var scaleX = rectWidth / canvasWidth;
      var scaleY = rectHeight / canvasHeight;
      var scale = scaleX > scaleY ? scaleX : scaleY;

      // Dolly
      distance = this.viewer.navigation.getEyeVector().length();
      var dollyTarget = this.viewer.navigation.getWorldPoint(0.5, 0.5);
      this.viewer.navigation.dollyFromPoint(distance * (scale - 1), dollyTarget);

      return true;
    }

    // ??? Should pick with rect first but currently LMV doesn't support rectangle selection
    // ??? So, do hit test only
    var hit = false;
    var pivot = null;
    // if pick up nothing, try ray pick
    if (!hit) {
      var centerX = (rectMinX + rectMaxX) * 0.5;
      var centerY = (rectMinY + rectMaxY) * 0.5;
      pivot = this.queryMouseRaySceneIntersection(centerX, centerY);
      // if pick up nothing, set pivot as intersection point from screen ray to project plane.
      if (pivot === null) {
        pivot = this.getPivot(centerX, centerY, canvasWidth, canvasHeight, this._camera);
      }
    }

    // calculate the basis vectors for the camera frame
    var eye = camera.position;
    var viewDir = camera.target.clone().sub(eye);
    viewDir.normalize();

    // calculate z camera translation for pan and zoom
    var scaleFactor = Math.min(canvasWidth / rectWidth, canvasHeight / rectHeight);
    var distEye2Pivot = pivot.distanceTo(eye);
    var zoomDist = distEye2Pivot * 1 / scaleFactor;

    // Calculate the new eye. The pivot is the new target.
    viewDir.multiplyScalar(-zoomDist);
    viewDir.add(pivot);

    camera.position.set(viewDir.x, viewDir.y, viewDir.z);
    camera.target.set(pivot.x, pivot.y, pivot.z);
    camera.dirty = true;

    return true;
  }
}

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ZoomWindow/ZoomWindow.css"
/*!**********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ZoomWindow/ZoomWindow.css ***!
  \**********************************************************************************************************************************************************************************************************************************************************/
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAWwAAsAAAAABWQAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABCAAAAGAAAABgDxIFKmNtYXAAAAFoAAAAVAAAAFQXVtKHZ2FzcAAAAbwAAAAIAAAACAAAABBnbHlmAAABxAAAAVQAAAFUGr5W0GhlYWQAAAMYAAAANgAAADYLLmLJaGhlYQAAA1AAAAAkAAAAJAevA8ZobXR4AAADdAAAABQAAAAUCgAAK2xvY2EAAAOIAAAADAAAAAwAKAC+bWF4cAAAA5QAAAAgAAAAIAAUAGVuYW1lAAADtAAAAdoAAAHawO5e5HBvc3QAAAWQAAAAIAAAACAAAwAAAAMDAAGQAAUAAAKZAswAAACPApkCzAAAAesAMwEJAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAAAAAAAAAQAAA6QADwP/AAEADwABAAAAAAQAAAAAAAAAAAAAAIAAAAAAAAwAAAAMAAAAcAAEAAwAAABwAAwABAAAAHAAEADgAAAAKAAgAAgACAAEAIOkA//3//wAAAAAAIOkA//3//wAB/+MXBAADAAEAAAAAAAAAAAAAAAEAAf//AA8AAQAAAAAAAAAAAAIAADc5AQAAAAABAAAAAAAAAAAAAgAANzkBAAAAAAEAAAAAAAAAAAACAAA3OQEAAAAADgAr/74D7QOAABQAKAAsADAANAA5AD8AQwBIAE4AUgBXAF0AYgAABSIuAjU0PgIzMh4CFRQOAiMRIg4CFRQeAjMyPgI1NC4CEzcXBwEzESMnIRUhAyM1MxUhIzUzFTMnIzUzNSM1MxURIzUzFSMhIzUzBSM1MxUFIzUjNTMRIzUzFQKrP21QLy9QbT8+bVEuLlFtPixMOCEhOEwsK0w5ISE5TGg2eTb+1jw8YgEA/wBWqqr+1oAqVlYqKioqKoBWAoCqqv8AqqoCACpWgCoqKy9RbT4+bVEvL1FtPj5tUS8B/CE5TCsrTDkhITlMKytMOSH+ZjZ5NgHC/wCePP7zKyuAVdWrVaurASuAKysrKytVVSv+VaurAAEAAAABAAD/0i17Xw889QALBAAAAAAA1BEPRwAAAADUEQ9HAAD/vgPtA4AAAAAIAAIAAAAAAAAAAQAAA8D/wAAABAAAAAAAA+0AAQAAAAAAAAAAAAAAAAAAAAUEAAAAAAAAAAAAAAACAAAABAAAKwAAAAAACgAUAB4AqgABAAAABQBjAA4AAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAADgCuAAEAAAAAAAEADgAAAAEAAAAAAAIABwCfAAEAAAAAAAMADgBLAAEAAAAAAAQADgC0AAEAAAAAAAUACwAqAAEAAAAAAAYADgB1AAEAAAAAAAoAGgDeAAMAAQQJAAEAHAAOAAMAAQQJAAIADgCmAAMAAQQJAAMAHABZAAMAAQQJAAQAHADCAAMAAQQJAAUAFgA1AAMAAQQJAAYAHACDAAMAAQQJAAoANAD4em9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsVmVyc2lvbiAxLjAAVgBlAHIAcwBpAG8AbgAgADEALgAwem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsUmVndWxhcgBSAGUAZwB1AGwAYQByem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsRm9udCBnZW5lcmF0ZWQgYnkgSWNvTW9vbi4ARgBvAG4AdAAgAGcAZQBuAGUAcgBhAHQAZQBkACAAYgB5ACAASQBjAG8ATQBvAG8AbgAuAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA== */ "data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAWwAAsAAAAABWQAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABCAAAAGAAAABgDxIFKmNtYXAAAAFoAAAAVAAAAFQXVtKHZ2FzcAAAAbwAAAAIAAAACAAAABBnbHlmAAABxAAAAVQAAAFUGr5W0GhlYWQAAAMYAAAANgAAADYLLmLJaGhlYQAAA1AAAAAkAAAAJAevA8ZobXR4AAADdAAAABQAAAAUCgAAK2xvY2EAAAOIAAAADAAAAAwAKAC+bWF4cAAAA5QAAAAgAAAAIAAUAGVuYW1lAAADtAAAAdoAAAHawO5e5HBvc3QAAAWQAAAAIAAAACAAAwAAAAMDAAGQAAUAAAKZAswAAACPApkCzAAAAesAMwEJAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAAAAAAAAAQAAA6QADwP/AAEADwABAAAAAAQAAAAAAAAAAAAAAIAAAAAAAAwAAAAMAAAAcAAEAAwAAABwAAwABAAAAHAAEADgAAAAKAAgAAgACAAEAIOkA//3//wAAAAAAIOkA//3//wAB/+MXBAADAAEAAAAAAAAAAAAAAAEAAf//AA8AAQAAAAAAAAAAAAIAADc5AQAAAAABAAAAAAAAAAAAAgAANzkBAAAAAAEAAAAAAAAAAAACAAA3OQEAAAAADgAr/74D7QOAABQAKAAsADAANAA5AD8AQwBIAE4AUgBXAF0AYgAABSIuAjU0PgIzMh4CFRQOAiMRIg4CFRQeAjMyPgI1NC4CEzcXBwEzESMnIRUhAyM1MxUhIzUzFTMnIzUzNSM1MxURIzUzFSMhIzUzBSM1MxUFIzUjNTMRIzUzFQKrP21QLy9QbT8+bVEuLlFtPixMOCEhOEwsK0w5ISE5TGg2eTb+1jw8YgEA/wBWqqr+1oAqVlYqKioqKoBWAoCqqv8AqqoCACpWgCoqKy9RbT4+bVEvL1FtPj5tUS8B/CE5TCsrTDkhITlMKytMOSH+ZjZ5NgHC/wCePP7zKyuAVdWrVaurASuAKysrKytVVSv+VaurAAEAAAABAAD/0i17Xw889QALBAAAAAAA1BEPRwAAAADUEQ9HAAD/vgPtA4AAAAAIAAIAAAAAAAAAAQAAA8D/wAAABAAAAAAAA+0AAQAAAAAAAAAAAAAAAAAAAAUEAAAAAAAAAAAAAAACAAAABAAAKwAAAAAACgAUAB4AqgABAAAABQBjAA4AAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAADgCuAAEAAAAAAAEADgAAAAEAAAAAAAIABwCfAAEAAAAAAAMADgBLAAEAAAAAAAQADgC0AAEAAAAAAAUACwAqAAEAAAAAAAYADgB1AAEAAAAAAAoAGgDeAAMAAQQJAAEAHAAOAAMAAQQJAAIADgCmAAMAAQQJAAMAHABZAAMAAQQJAAQAHADCAAMAAQQJAAUAFgA1AAMAAQQJAAYAHACDAAMAAQQJAAoANAD4em9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsVmVyc2lvbiAxLjAAVgBlAHIAcwBpAG8AbgAgADEALgAwem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsUmVndWxhcgBSAGUAZwB1AGwAYQByem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsRm9udCBnZW5lcmF0ZWQgYnkgSWNvTW9vbi4ARgBvAG4AdAAgAGcAZQBuAGUAcgBhAHQAZQBkACAAYgB5ACAASQBjAG8ATQBvAG8AbgAuAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `@font-face {
  font-family: "zoomwindowtool";
  src: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
  font-weight: normal;
  font-style: normal;
}
.adsk-viewing-viewer [class^=zoomwindowtoolicon-],
.adsk-viewing-viewer [class^=zoomwindowtoolicon-]:before,
[class*=" zoomwindowtoolicon-"],
[class*=" zoomwindowtoolicon-"]:before {
  /* use !important to prevent issues with browser extensions that change fonts */
  font-family: "zoomwindowtool" !important;
  speak: none;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  /* Better Font Rendering =========== */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.adsk-viewing-viewer .zoomwindowtoolicon-zoom-window:before {
  content: "\\e900";
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

/***/ "./extensions/ZoomWindow/ZoomWindow.css"
/*!**********************************************!*\
  !*** ./extensions/ZoomWindow/ZoomWindow.css ***!
  \**********************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ZoomWindow_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./ZoomWindow.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ZoomWindow/ZoomWindow.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ZoomWindow_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ZoomWindow_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ZoomWindow_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ZoomWindow_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAWwAAsAAAAABWQAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABCAAAAGAAAABgDxIFKmNtYXAAAAFoAAAAVAAAAFQXVtKHZ2FzcAAAAbwAAAAIAAAACAAAABBnbHlmAAABxAAAAVQAAAFUGr5W0GhlYWQAAAMYAAAANgAAADYLLmLJaGhlYQAAA1AAAAAkAAAAJAevA8ZobXR4AAADdAAAABQAAAAUCgAAK2xvY2EAAAOIAAAADAAAAAwAKAC+bWF4cAAAA5QAAAAgAAAAIAAUAGVuYW1lAAADtAAAAdoAAAHawO5e5HBvc3QAAAWQAAAAIAAAACAAAwAAAAMDAAGQAAUAAAKZAswAAACPApkCzAAAAesAMwEJAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAAAAAAAAAQAAA6QADwP/AAEADwABAAAAAAQAAAAAAAAAAAAAAIAAAAAAAAwAAAAMAAAAcAAEAAwAAABwAAwABAAAAHAAEADgAAAAKAAgAAgACAAEAIOkA//3//wAAAAAAIOkA//3//wAB/+MXBAADAAEAAAAAAAAAAAAAAAEAAf//AA8AAQAAAAAAAAAAAAIAADc5AQAAAAABAAAAAAAAAAAAAgAANzkBAAAAAAEAAAAAAAAAAAACAAA3OQEAAAAADgAr/74D7QOAABQAKAAsADAANAA5AD8AQwBIAE4AUgBXAF0AYgAABSIuAjU0PgIzMh4CFRQOAiMRIg4CFRQeAjMyPgI1NC4CEzcXBwEzESMnIRUhAyM1MxUhIzUzFTMnIzUzNSM1MxURIzUzFSMhIzUzBSM1MxUFIzUjNTMRIzUzFQKrP21QLy9QbT8+bVEuLlFtPixMOCEhOEwsK0w5ISE5TGg2eTb+1jw8YgEA/wBWqqr+1oAqVlYqKioqKoBWAoCqqv8AqqoCACpWgCoqKy9RbT4+bVEvL1FtPj5tUS8B/CE5TCsrTDkhITlMKytMOSH+ZjZ5NgHC/wCePP7zKyuAVdWrVaurASuAKysrKytVVSv+VaurAAEAAAABAAD/0i17Xw889QALBAAAAAAA1BEPRwAAAADUEQ9HAAD/vgPtA4AAAAAIAAIAAAAAAAAAAQAAA8D/wAAABAAAAAAAA+0AAQAAAAAAAAAAAAAAAAAAAAUEAAAAAAAAAAAAAAACAAAABAAAKwAAAAAACgAUAB4AqgABAAAABQBjAA4AAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAADgCuAAEAAAAAAAEADgAAAAEAAAAAAAIABwCfAAEAAAAAAAMADgBLAAEAAAAAAAQADgC0AAEAAAAAAAUACwAqAAEAAAAAAAYADgB1AAEAAAAAAAoAGgDeAAMAAQQJAAEAHAAOAAMAAQQJAAIADgCmAAMAAQQJAAMAHABZAAMAAQQJAAQAHADCAAMAAQQJAAUAFgA1AAMAAQQJAAYAHACDAAMAAQQJAAoANAD4em9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsVmVyc2lvbiAxLjAAVgBlAHIAcwBpAG8AbgAgADEALgAwem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsUmVndWxhcgBSAGUAZwB1AGwAYQByem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsRm9udCBnZW5lcmF0ZWQgYnkgSWNvTW9vbi4ARgBvAG4AdAAgAGcAZQBuAGUAcgBhAHQAZQBkACAAYgB5ACAASQBjAG8ATQBvAG8AbgAuAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
/*!********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAWwAAsAAAAABWQAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABCAAAAGAAAABgDxIFKmNtYXAAAAFoAAAAVAAAAFQXVtKHZ2FzcAAAAbwAAAAIAAAACAAAABBnbHlmAAABxAAAAVQAAAFUGr5W0GhlYWQAAAMYAAAANgAAADYLLmLJaGhlYQAAA1AAAAAkAAAAJAevA8ZobXR4AAADdAAAABQAAAAUCgAAK2xvY2EAAAOIAAAADAAAAAwAKAC+bWF4cAAAA5QAAAAgAAAAIAAUAGVuYW1lAAADtAAAAdoAAAHawO5e5HBvc3QAAAWQAAAAIAAAACAAAwAAAAMDAAGQAAUAAAKZAswAAACPApkCzAAAAesAMwEJAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAAAAAAAAAQAAA6QADwP/AAEADwABAAAAAAQAAAAAAAAAAAAAAIAAAAAAAAwAAAAMAAAAcAAEAAwAAABwAAwABAAAAHAAEADgAAAAKAAgAAgACAAEAIOkA//3//wAAAAAAIOkA//3//wAB/+MXBAADAAEAAAAAAAAAAAAAAAEAAf//AA8AAQAAAAAAAAAAAAIAADc5AQAAAAABAAAAAAAAAAAAAgAANzkBAAAAAAEAAAAAAAAAAAACAAA3OQEAAAAADgAr/74D7QOAABQAKAAsADAANAA5AD8AQwBIAE4AUgBXAF0AYgAABSIuAjU0PgIzMh4CFRQOAiMRIg4CFRQeAjMyPgI1NC4CEzcXBwEzESMnIRUhAyM1MxUhIzUzFTMnIzUzNSM1MxURIzUzFSMhIzUzBSM1MxUFIzUjNTMRIzUzFQKrP21QLy9QbT8+bVEuLlFtPixMOCEhOEwsK0w5ISE5TGg2eTb+1jw8YgEA/wBWqqr+1oAqVlYqKioqKoBWAoCqqv8AqqoCACpWgCoqKy9RbT4+bVEvL1FtPj5tUS8B/CE5TCsrTDkhITlMKytMOSH+ZjZ5NgHC/wCePP7zKyuAVdWrVaurASuAKysrKytVVSv+VaurAAEAAAABAAD/0i17Xw889QALBAAAAAAA1BEPRwAAAADUEQ9HAAD/vgPtA4AAAAAIAAIAAAAAAAAAAQAAA8D/wAAABAAAAAAAA+0AAQAAAAAAAAAAAAAAAAAAAAUEAAAAAAAAAAAAAAACAAAABAAAKwAAAAAACgAUAB4AqgABAAAABQBjAA4AAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAADgCuAAEAAAAAAAEADgAAAAEAAAAAAAIABwCfAAEAAAAAAAMADgBLAAEAAAAAAAQADgC0AAEAAAAAAAUACwAqAAEAAAAAAAYADgB1AAEAAAAAAAoAGgDeAAMAAQQJAAEAHAAOAAMAAQQJAAIADgCmAAMAAQQJAAMAHABZAAMAAQQJAAQAHADCAAMAAQQJAAUAFgA1AAMAAQQJAAYAHACDAAMAAQQJAAoANAD4em9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsVmVyc2lvbiAxLjAAVgBlAHIAcwBpAG8AbgAgADEALgAwem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsUmVndWxhcgBSAGUAZwB1AGwAYQByem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsRm9udCBnZW5lcmF0ZWQgYnkgSWNvTW9vbi4ARgBvAG4AdAAgAGcAZQBuAGUAcgBhAHQAZQBkACAAYgB5ACAASQBjAG8ATQBvAG8AbgAuAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA== ***!
  \********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAWwAAsAAAAABWQAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABCAAAAGAAAABgDxIFKmNtYXAAAAFoAAAAVAAAAFQXVtKHZ2FzcAAAAbwAAAAIAAAACAAAABBnbHlmAAABxAAAAVQAAAFUGr5W0GhlYWQAAAMYAAAANgAAADYLLmLJaGhlYQAAA1AAAAAkAAAAJAevA8ZobXR4AAADdAAAABQAAAAUCgAAK2xvY2EAAAOIAAAADAAAAAwAKAC+bWF4cAAAA5QAAAAgAAAAIAAUAGVuYW1lAAADtAAAAdoAAAHawO5e5HBvc3QAAAWQAAAAIAAAACAAAwAAAAMDAAGQAAUAAAKZAswAAACPApkCzAAAAesAMwEJAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAAAAAAAAAQAAA6QADwP/AAEADwABAAAAAAQAAAAAAAAAAAAAAIAAAAAAAAwAAAAMAAAAcAAEAAwAAABwAAwABAAAAHAAEADgAAAAKAAgAAgACAAEAIOkA//3//wAAAAAAIOkA//3//wAB/+MXBAADAAEAAAAAAAAAAAAAAAEAAf//AA8AAQAAAAAAAAAAAAIAADc5AQAAAAABAAAAAAAAAAAAAgAANzkBAAAAAAEAAAAAAAAAAAACAAA3OQEAAAAADgAr/74D7QOAABQAKAAsADAANAA5AD8AQwBIAE4AUgBXAF0AYgAABSIuAjU0PgIzMh4CFRQOAiMRIg4CFRQeAjMyPgI1NC4CEzcXBwEzESMnIRUhAyM1MxUhIzUzFTMnIzUzNSM1MxURIzUzFSMhIzUzBSM1MxUFIzUjNTMRIzUzFQKrP21QLy9QbT8+bVEuLlFtPixMOCEhOEwsK0w5ISE5TGg2eTb+1jw8YgEA/wBWqqr+1oAqVlYqKioqKoBWAoCqqv8AqqoCACpWgCoqKy9RbT4+bVEvL1FtPj5tUS8B/CE5TCsrTDkhITlMKytMOSH+ZjZ5NgHC/wCePP7zKyuAVdWrVaurASuAKysrKytVVSv+VaurAAEAAAABAAD/0i17Xw889QALBAAAAAAA1BEPRwAAAADUEQ9HAAD/vgPtA4AAAAAIAAIAAAAAAAAAAQAAA8D/wAAABAAAAAAAA+0AAQAAAAAAAAAAAAAAAAAAAAUEAAAAAAAAAAAAAAACAAAABAAAKwAAAAAACgAUAB4AqgABAAAABQBjAA4AAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAADgCuAAEAAAAAAAEADgAAAAEAAAAAAAIABwCfAAEAAAAAAAMADgBLAAEAAAAAAAQADgC0AAEAAAAAAAUACwAqAAEAAAAAAAYADgB1AAEAAAAAAAoAGgDeAAMAAQQJAAEAHAAOAAMAAQQJAAIADgCmAAMAAQQJAAMAHABZAAMAAQQJAAQAHADCAAMAAQQJAAUAFgA1AAMAAQQJAAYAHACDAAMAAQQJAAoANAD4em9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsVmVyc2lvbiAxLjAAVgBlAHIAcwBpAG8AbgAgADEALgAwem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsUmVndWxhcgBSAGUAZwB1AGwAYQByem9vbXdpbmRvd3Rvb2wAegBvAG8AbQB3AGkAbgBkAG8AdwB0AG8AbwBsRm9udCBnZW5lcmF0ZWQgYnkgSWNvTW9vbi4ARgBvAG4AdAAgAGcAZQBuAGUAcgBhAHQAZQBkACAAYgB5ACAASQBjAG8ATQBvAG8AbgAuAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

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
/******/ 			"ZoomWindow": 0
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
/*!*********************************************!*\
  !*** ./extensions/ZoomWindow/ZoomWindow.js ***!
  \*********************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ZoomWindow)
/* harmony export */ });
/* harmony import */ var _ZoomWindowTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ZoomWindowTool.js */ "./extensions/ZoomWindow/ZoomWindowTool.js");
/* harmony import */ var _ZoomWindow_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ZoomWindow.css */ "./extensions/ZoomWindow/ZoomWindow.css");




const av = Autodesk.Viewing;
const namespace = AutodeskNamespace('Autodesk.Viewing.Extensions.ZoomWindow');

 // IMPORTANT!!

/**
 * Extends the dolly (zoom) button on the toolbar with a tool for end users to specify
 *  a rectangular section for the camera to zoom into and adjust accordingly.
 *
 * The extension id is: `Autodesk.Viewing.ZoomWindow`
 *
 * @example
 *   viewer.loadExtension('Autodesk.Viewing.ZoomWindow')
 *
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.ZoomWindow
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
class ZoomWindow extends av.Extension {

  constructor(viewer, options) {
    super(viewer, options);
    this.name = 'zoomwindow';
    this.modes = ['zoomwindow', 'dolly'];
  }

  load() {
    var viewer = this.viewer;

    // Init & Register tool
    this.tool = new _ZoomWindowTool_js__WEBPACK_IMPORTED_MODULE_0__["default"](viewer);
    viewer.toolController.registerTool(this.tool);

    return true;
  }

  onToolbarCreated(toolbar) {
    var navTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);

    if (!navTools || !navTools.dollybutton) {
      return;
    }

    var self = this;
    // remove default zoom tool
    navTools.removeControl(navTools.dollybutton.getId());
    this.defaultDollyButton = navTools.dollybutton;

    // add combo button for zoom tool
    this.zoomWindowToolButton = new Autodesk.Viewing.UI.ComboButton('toolbar-zoomTools');
    this.zoomWindowToolButton.setIcon('zoomwindowtoolicon-zoom-window');
    this.zoomWindowToolButton.setToolTip('Zoom window');
    this.createZoomSubmenu(this.zoomWindowToolButton);
    navTools.addControl(this.zoomWindowToolButton);

    // Escape hotkey to exit tool.
    //
    var hotkeys = [{
      keycodes: [Autodesk.Viewing.KeyCode.ESCAPE],
      onRelease: function () {
        if (self.zoomWindowToolButton.getState() === Autodesk.Viewing.UI.Button.State.ACTIVE) {
          self.viewer.setActiveNavigationTool();
          self.zoomWindowToolButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
        }
      }
    }];
    this.viewer.getHotkeyManager().pushHotkeys(this.escapeHotkeyId, hotkeys);
  }

  destroyUI() {
    var viewer = this.viewer;
    if (this.zoomWindowToolButton) {
      var toolbar = viewer.getToolbar();
      var navTools = toolbar && toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);
      if (navTools) {
        this.zoomWindowToolButton.subMenu.removeEventListener(
          Autodesk.Viewing.UI.RadioButtonGroup.Event.ACTIVE_BUTTON_CHANGED,
          this.zoomWindowToolButton.subMenuActiveButtonChangedHandler(navTools));
        navTools.removeControl(this.zoomWindowToolButton.getId());
        // set back dolly button
        if (navTools.panbutton && this.defaultDollyButton) {
          navTools.addControl(this.defaultDollyButton);
        } else
        {
          this.defaultDollyButton = null;
        }
      }
      this.zoomWindowToolButton = null;
    }
    viewer.getHotkeyManager().popHotkeys(this.escapeHotkeyId);
  }


  createZoomSubmenu(parentButton) {

    var createNavToggler = function (self, button, name) {
      return function () {
        var state = button.getState();
        if (state === Autodesk.Viewing.UI.Button.State.INACTIVE) {
          self.activate(name);
          button.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
        } else if (state === Autodesk.Viewing.UI.Button.State.ACTIVE) {
          self.deactivate();
          button.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
        }
      };
    };

    // zoom window
    var zoomWindowToolBut = new Autodesk.Viewing.UI.Button('toolbar-zoomWindowTool');
    zoomWindowToolBut.setToolTip(Autodesk.Viewing.i18n.translate("Zoom window"));
    zoomWindowToolBut.setIcon('zoomwindowtoolicon-zoom-window');
    zoomWindowToolBut.onClick = createNavToggler(this, zoomWindowToolBut, 'zoomwindow');
    parentButton.addControl(zoomWindowToolBut);
    // zoom
    var dollyBut = new Autodesk.Viewing.UI.Button('toolbar-zoomTool');
    dollyBut.setToolTip('Zoom');
    dollyBut.setIcon('adsk-icon-zoom');
    dollyBut.onClick = createNavToggler(this, dollyBut, 'dolly');
    parentButton.addControl(dollyBut);
  }

  unload() {
    var viewer = this.viewer;
    if (viewer.getActiveNavigationTool() === "dolly" ||
    viewer.getActiveNavigationTool() === "zoomwindow") {
      viewer.setActiveNavigationTool();
    }
    // Remove the UI
    this.destroyUI();
    // Deregister tool
    viewer.toolController.deregisterTool(this.tool);
    this.tool = null;

    return true;
  }

  /**
   * Activates either ZoomWindow or dolly/zoom tool.
   *
   * @param {string} [mode='zoomwindow'] - Either 'zoomwindow' or 'dolly'
   * @memberof Autodesk.Viewing.Extensions.ZoomWindow
   * @alias Autodesk.Viewing.Extensions.ZoomWindow#activate
   * @public
   */
  activate(mode) {
    if (this.activeStatus && this.mode === mode) {
      return;
    }
    switch (mode) {
      default:
      case 'zoomwindow':
        this.viewer.setActiveNavigationTool('zoomwindow');
        this.mode = 'zoomwindow';
        break;
      case 'dolly':
        this.viewer.setActiveNavigationTool('dolly');
        this.mode = 'dolly';
        break;
    }
    this.activeStatus = true;
    return true;
  }

  /**
   * Deactivates the tool and resets the navigation tool.
   *
   * @memberof Autodesk.Viewing.Extensions.ZoomWindow
   * @alias Autodesk.Viewing.Extensions.ZoomWindow#deactivate
   * @public
   */
  deactivate() {
    if (this.activeStatus) {
      this.viewer.setActiveNavigationTool();
      this.activeStatus = false;
    }
    return true;
  }

}

namespace.ZoomWindow = ZoomWindow;
Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Viewing.ZoomWindow', ZoomWindow);
})();

Autodesk.Extensions.ZoomWindow = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=ZoomWindow.js.map