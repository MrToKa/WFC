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

/***/ "./extensions/BimWalk/BimWalkPools.js"
/*!********************************************!*\
  !*** ./extensions/BimWalk/BimWalkPools.js ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   freeTempVectors: () => (/* binding */ freeTempVectors),
/* harmony export */   getTempVector: () => (/* binding */ getTempVector)
/* harmony export */ });

// Extension made lot of vector operations,
// temporal vectors are created to not generate much garbage to be collected.

var temporalVectorSize = 128;
var temporalVectors = [];
var temporalVectorsIndex = 0;
var zero = { x: 0, y: 0, z: 0 };

/**
 * Gets a vector initialized with values or source using a simple pool of temporal intermediate math results objects.
 * Idea is to not make trash for garbage collection.
 * @param source
 * @returns {THREE.Vector3}
 */
function getTempVector(source) {

  // Initialize temporal vectors.
  for (var i = temporalVectors.length; i < temporalVectorSize; ++i) {
    temporalVectors.push(new THREE.Vector3());
  }

  source = source || zero;

  if (temporalVectorsIndex < temporalVectorSize) {
    return temporalVectors[temporalVectorsIndex++].copy(source);
  }

  Autodesk.Viewing.Private.logger.warn('Vector pool in Autodesk.Viewing.Extensions.BimWalk reached maximum size');
  return new THREE.Vector3().copy(source);
}

/**
 * Free vectors acquired from the pool with getTempVector.
 * @param vector
 */
function freeTempVectors() {

  temporalVectorsIndex = 0;
}

/***/ },

/***/ "./extensions/BimWalk/BimWalkTool.js"
/*!*******************************************!*\
  !*** ./extensions/BimWalk/BimWalkTool.js ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BimWalkTool: () => (/* binding */ BimWalkTool)
/* harmony export */ });
/* harmony import */ var _BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./BimWalkPools.js */ "./extensions/BimWalk/BimWalkPools.js");
/* harmony import */ var _BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./BimWalkUtils.js */ "./extensions/BimWalk/BimWalkUtils.js");
/* harmony import */ var _Navigators_NavigatorMobile_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./Navigators/NavigatorMobile.js */ "./extensions/BimWalk/Navigators/NavigatorMobile.js");
/* harmony import */ var _Navigators_NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./Navigators/NavigatorSimple.js */ "./extensions/BimWalk/Navigators/NavigatorSimple.js");
/* harmony import */ var _Navigators_NavigatorAEC_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./Navigators/NavigatorAEC.js */ "./extensions/BimWalk/Navigators/NavigatorAEC.js");







var AutodeskViewing = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;

AutodeskViewing.EVENT_BIMWALK_CONFIG_CHANGED = "EVENT_BIMWALK_CONFIG_CHANGED";

/*
* First Person View tool for LMV
*
* This tool provides a first person view with movement using the standard WASD keys
* to forward/backward/left/right and the QE keys to move vertically.  The mouse or
* cursor is used to orient the view.  Movement is always along or perpendicular to
* the view direction.
*
* The SHIFT key may be used when moving to increase the speed.  Or the default
* movement speed may be increased/decreased with the MINUS or EQUAL keys.  The
* ZERO (0) will reset to the default speed values.
*
* @author Hans Kellner (Oct 2014)
*
*/
function BimWalkTool(viewer, options, extension) {
  this.viewer = viewer;
  this.options = options || {};
  this.names = ["bimwalk"];
  this.navapi = viewer.navigation;
  this.camera = this.navapi.getCamera();
  this.active = false;
  this.clock = new THREE.Clock(true);
  this.bimWalkExtension = extension;

  this.setNavigator(viewer.prefs.get(avp.Prefs3D.BIM_WALK_NAVIGATOR_TYPE));
}

var proto = BimWalkTool.prototype;

/**
 * Sets the tool's navigator.
 * NavigatorMobile will be used if this tool is activated on a mobile device.
 * @param {string} type - 'default' -> NavigatorSimple, 'aec' -> NavigatorAEC
 */
proto.setNavigator = function (type) {
  if (AutodeskViewing.isMobileDevice()) {
    // If using a mobile device default to the mobile navigator.
    this.navigator = this.navigator || new _Navigators_NavigatorMobile_js__WEBPACK_IMPORTED_MODULE_2__.NavigatorMobile(this);
  } else {
    switch (type) {
      case 'aec':
        this.navigator = new _Navigators_NavigatorAEC_js__WEBPACK_IMPORTED_MODULE_4__.NavigatorAEC(this);
        break;
      default:
        this.navigator = new _Navigators_NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_3__.NavigatorSimple(this);
        break;
    }
  }
};

proto.set = function (configuration, value) {

  if (!this.navigator.set(configuration, value)) {
    return false;
  }

  // Value can differ from provided after navigation validations.
  value = this.navigator.get(configuration);

  // Fire config changed event.
  var event = {
    type: AutodeskViewing.EVENT_BIMWALK_CONFIG_CHANGED,
    data: {
      configuration: configuration,
      value: value
    }
  };

  this.viewer.dispatchEvent(event);
  return true;
};

proto.get = function (configuration) {

  if (configuration) {
    return this.navigator.get(configuration);
  }

  return this.navigator.configuration;
};

proto.isActive = function () {

  return this.active;
};

proto.activate = function (name) {

  this.active = true;
  this.clock.start();

  // Pause mouse-over highlight.
  this.viewer.impl.pauseHighlight(true);

  // Change from current camera to perspective camera.
  this.navapi.toPerspective();
  // Clamp camera fov. This is useful when switching from orthogonal view to first person view.
  this.navapi.setVerticalFov(this.camera.fov);

  // Check if look camera is looking straigh up/down, which causes Gimbal Lock.
  // If it is, then clamp pitch to min/max.
  var EPSILON = 0.0001;
  var camera = this.camera;
  var forward = new THREE.Vector3().copy(camera.target).sub(camera.position).normalize();
  var dot = forward.dot(camera.worldup);

  if (Math.abs(dot) >= 1 - EPSILON) {

    var navigator = this.navigator;
    var position = camera.position;
    var target = camera.target;

    // BimWalk limits the camera angle to 20-160 degrees
    // and below the angle is adjusted only when the angle is way closer than 20 degrees or 160 degrees to vertical.
    var angle = dot < 0 ? navigator.getMinPitchLimit() : navigator.getMaxPitchLimit() - Math.PI;

    var offset = target.clone().sub(position);
    // Rotating the offset by certain angle around an axis
    var axis = new THREE.Vector3(1, 0, 0);
    axis.applyQuaternion(camera.quaternion);
    offset.applyAxisAngle(axis, angle);

    this.navapi.setRequestTransition(true, position, offset.add(position), camera.fov);
  }

  if (!AutodeskViewing.isMobileDevice()) {
    // HACK: Place focus in canvas so we get key events.
    // It's important not calling canvas.focus() for mobile devices (especially iOS), since they
    // don't have key events anyway, and it turns out that calling canvas.focus() adds "internal-direct-focus" css attribute to the canvas,
    // which causes major performance issues for iOS.
    this.viewer.canvas.focus();
  }

  this.navigator.activate();
};

proto.deactivate = function (name) {

  this.active = false;
  this.clock.stop();

  this.viewer.impl.pauseHighlight(false);

  this.navigator.deactivate();

  // Make sure that the extension is synced with the tool.
  // This is needed when bimWalkTool.deactivate hasn't been called from the extension, but directly or from the tool controller.
  this.bimWalkExtension.deactivate();
};

proto.update = function () {

  // If this.viewer.model is null, we have no visible model at all - and calling metersToModel would crash.
  if (!this.active || !this.navapi.isActionEnabled('walk') || !this.viewer.model) {
    return false;
  }

  // Returns delta time in seconds since previous call.
  var elapsed = this.clock.getDelta();

  // Update navigator using fixed time step (frame rate of viewer is very unpredictable).
  var FIX_DELTA = 1 / 30;
  var MAX_UPDATES = 15;

  var updateNumber = 0;
  var updatesCount = Math.min(Math.ceil(elapsed / FIX_DELTA) | 0, MAX_UPDATES);

  var navigator = this.navigator;
  var mtsToModel = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__.metersToModel)(1, this.viewer);
  var localCam = this.camera.clone(); // used to modify this camera to see if it will be in viable range
  var deltaPitch = 0;
  var deltaYaw = 0;

  for (var i = 0; i < updatesCount; ++i) {

    var delta = Math.min(elapsed, FIX_DELTA);
    elapsed -= FIX_DELTA;

    (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.freeTempVectors)();
    navigator.update(delta, localCam, updateNumber++, updatesCount);

    // Handle displacement changes.
    var deltaPosition = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(navigator.getVelocity()).multiplyScalar(delta);
    localCam.position.add(deltaPosition.multiplyScalar(mtsToModel));

    // Handle rotation changes.
    var deltaRotation = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(navigator.getAngularVelocity()).multiplyScalar(delta);
    deltaPitch += deltaRotation.x;
    deltaYaw += deltaRotation.y;
  }

  (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.freeTempVectors)();

  let posChanged = localCam.position.distanceToSquared(this.camera.position) !== 0;
  var forward = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(this.camera.target).sub(this.camera.position);
  let newTarget = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(localCam.position).add(forward);
  let targetChanged = newTarget.distanceToSquared(this.camera.target) !== 0;

  // If position or target changed then update camera.
  if (posChanged || targetChanged) {

    this.navapi.setView(localCam.position, newTarget);
    this.navapi.orientCameraUp();
  }

  // From the Collaboration extension:
  //the "go home" call may change the camera back to ortho... and we can't do ortho while walking...
  //HACK: Really, the home view should be set once when launch the extension, then set it back.
  if (!this.camera.isPerspective) {
    console.log("Lost perspective mode: resetting view.");
    this.navapi.toPerspective();
  }

  // Handle look changes
  var directionFwd = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(this.camera.target).sub(this.camera.position);
  var directionRight = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(directionFwd).cross(this.camera.worldup).normalize();

  if (deltaPitch !== 0) {

    var pitchQ = new THREE.Quaternion();
    pitchQ.setFromAxisAngle(directionRight, -deltaPitch);

    var dirFwdTmp = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(directionFwd);
    dirFwdTmp.applyQuaternion(pitchQ);

    var vertical = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(this.camera.worldup);
    var verticalAngle = dirFwdTmp.angleTo(vertical);

    // If new angle is within limits then update values; otherwise ignore
    var minPitchLimit = navigator.getMinPitchLimit();
    var maxPitchLimit = navigator.getMaxPitchLimit();

    var angleBelowLimit = verticalAngle < minPitchLimit;
    var angleOverLimit = verticalAngle > maxPitchLimit;

    if (angleBelowLimit) {
      pitchQ.setFromAxisAngle(directionRight, -(minPitchLimit - verticalAngle + deltaPitch));
    }

    if (angleOverLimit) {
      pitchQ.setFromAxisAngle(directionRight, -(maxPitchLimit - verticalAngle + deltaPitch));
    }

    directionFwd.applyQuaternion(pitchQ);
    localCam.up.applyQuaternion(pitchQ);
  }

  if (deltaYaw !== 0) {

    var yawQ = new THREE.Quaternion();
    yawQ.setFromAxisAngle(this.camera.worldup, -deltaYaw);
    directionFwd.applyQuaternion(yawQ);
    localCam.up.applyQuaternion(yawQ);
  }

  // Now calc new target location and if it changed.
  var newPosition = localCam.position;
  posChanged = newPosition.distanceToSquared(this.camera.position) !== 0;
  newTarget = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(newPosition).add(directionFwd);

  //now fix newPosition for lockInPlane
  targetChanged = newTarget.distanceToSquared(this.camera.target) !== 0;
  // If position or target changed then update camera.
  if (posChanged || targetChanged) {
    this.navapi.setView(newPosition, newTarget);
    this.navapi.orientCameraUp();
  }

  return this.camera.dirty;
};

proto.getNames = function () {

  return this.names;
};

proto.getName = function () {

  return this.names[0];
};

proto.getCursor = function () {

  return this.navigator.getCursor();
};

proto.handleButtonDown = function (event, button) {

  return this.navigator.handleButtonDown(event, button);
};

proto.handleButtonUp = function (event, button) {

  return this.navigator.handleButtonUp(event, button);
};

proto.handleMouseMove = function (event) {

  return this.navigator.handleMouseMove(event);
};

proto.handleGesture = function (event) {

  return this.navigator.handleGesture(event);
};

proto.handleSingleClick = function (event, button) {

  return this.navigator.handleMouseClick(event, button);
};

proto.handleDoubleClick = function (event, button) {

  return this.navigator.handleMouseDoubleClick(event, button);
};

proto.handleKeyDown = function (event, keyCode) {

  return this.navigator.handleKeyDown(event, keyCode);
};

proto.handleKeyUp = function (event, keyCode) {

  return this.navigator.handleKeyUp(event, keyCode);
};

proto.handleWheelInput = function (delta) {

  return this.navigator.handleWheelInput(delta);
};

proto.handleSingleTap = function (event) {
  // In case of a 2 pointers tap - consume the event so it won't trigger a "home view" request by DefaultHandler.
  if (event.pointers?.length === 2) {
    return true;
  }

  return this.handleSingleClick(event, 0);
};

proto.handleDoubleTap = function (event) {

  return this.navigator.handleMouseDoubleClick(event);
};

proto.handleBlur = function (event) {

  return this.navigator.handleBlur(event);
};

proto.activateJoystick = function () {

  if (this.navigator.ui) {
    this.navigator.ui.activate();
  }
};

proto.deactivateJoystick = function () {

  if (this.navigator.ui) {
    this.navigator.ui.deactivate();
  }
};

proto.setJoystickPosition = function (x, y) {

  if (this.navigator.ui) {
    this.navigator.ui.setJoystickPosition(x, y);
  }
};

proto.setJoystickRelativePosition = function (x, y) {

  if (this.navigator.ui) {
    this.navigator.ui.setJoystickRelativePosition(x, y);
  }
};

proto.setJoystickSize = function (backgroundRadius, handleRadius) {

  if (this.navigator.ui) {
    this.navigator.ui.setJoystickSize(backgroundRadius, handleRadius);
  }
};

/***/ },

/***/ "./extensions/BimWalk/BimWalkUtils.js"
/*!********************************************!*\
  !*** ./extensions/BimWalk/BimWalkUtils.js ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   easeInOutQuad: () => (/* binding */ easeInOutQuad),
/* harmony export */   easeInQuad: () => (/* binding */ easeInQuad),
/* harmony export */   getFloorCandidates: () => (/* binding */ getFloorCandidates),
/* harmony export */   getForward: () => (/* binding */ getForward),
/* harmony export */   getMousePosition: () => (/* binding */ getMousePosition),
/* harmony export */   getSmallestFloorSide: () => (/* binding */ getSmallestFloorSide),
/* harmony export */   getWorldPosition: () => (/* binding */ getWorldPosition),
/* harmony export */   getWorldUpComponent: () => (/* binding */ getWorldUpComponent),
/* harmony export */   isFloorIntersection: () => (/* binding */ isFloorIntersection),
/* harmony export */   isWallIntersection: () => (/* binding */ isWallIntersection),
/* harmony export */   metersToModel: () => (/* binding */ metersToModel),
/* harmony export */   setWorldUpComponent: () => (/* binding */ setWorldUpComponent),
/* harmony export */   updateFriction: () => (/* binding */ updateFriction),
/* harmony export */   updateVelocity: () => (/* binding */ updateVelocity)
/* harmony export */ });
/* harmony import */ var _BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./BimWalkPools.js */ "./extensions/BimWalk/BimWalkPools.js");


var tempBoundingBox = new Float32Array(6);
var EPSILON = 0.0001;
const tempMatrixWorld = new THREE.Matrix4();
const tempNormalMatrix = new THREE.Matrix3();
const tempNormal = new THREE.Vector3();

function metersToModel(meters, viewer) {
  const model = viewer.getFirstModel();
  return Autodesk.Viewing.Private.convertUnits('meters', model?.getUnitString(), 1, meters, 'default');
}

function getMousePosition(event, viewer, position) {

  position.x = event.canvasX;
  position.y = event.canvasY;
}

function getWorldPosition(x, y, viewer) {

  const viewport = viewer.navigation.getScreenViewport();

  x /= viewport.width;
  y /= viewport.height;

  return viewer.navigation.getWorldPoint(x, y);
}

function getWorldUpComponent(camera, vector) {

  // Assume up vector can be perfectly aligned to y or z axes.
  if (camera.worldup.y > camera.worldup.z) {
    return vector.y;
  } else {
    return vector.z;
  }
}

function setWorldUpComponent(camera, vector, value) {

  // Assume up vector can be perfectly aligned to y or z axes.
  if (camera.worldup.y > camera.worldup.z) {
    vector.y = value;
  } else {
    vector.z = value;
  }

  return vector;
}

function getSmallestFloorSide(intersection, camera, instanceTree) {

  var w = 0;
  var l = 0;

  instanceTree.getNodeBox(intersection.dbId, tempBoundingBox);

  // Assume up vector can be perfectly aligned to y or z axes.
  if (camera.worldup.y > camera.worldup.z) {
    w = Math.abs(tempBoundingBox[0] - tempBoundingBox[3]);
    l = Math.abs(tempBoundingBox[2] - tempBoundingBox[5]);
  } else {
    w = Math.abs(tempBoundingBox[0] - tempBoundingBox[3]);
    l = Math.abs(tempBoundingBox[1] - tempBoundingBox[4]);
  }

  return Math.min(w, l);
}

function getNormalCameraUpCosine(intersection, camera) {
  // In some cases we don't get a face or a normal, return undefined in that case
  if (intersection.face?.normal) {
    tempNormal.copy(intersection.face.normal);

    // Fragments share three objects, so we cannot use their transformations from intersection.object.
    if (intersection.model && intersection.fragId) {
      intersection.model.getFragmentList().getWorldMatrix(intersection.fragId, tempMatrixWorld);
      tempNormalMatrix.getNormalMatrix(tempMatrixWorld);
      tempNormal.applyMatrix3(tempNormalMatrix);
    } else if (intersection.object?.matrixWorld) {
      // If it is not a fragment it comes from the extra scenes in Viewer3DImpl and has a valid three object
      tempNormalMatrix.getNormalMatrix(intersection.object.matrixWorld);
      tempNormal.applyMatrix3(tempNormalMatrix);
    }

    if (Math.abs(1 - tempNormal.lengthSq()) > EPSILON) {
      tempNormal.normalize();
    }

    return camera.worldup.dot(tempNormal);
  }

  return undefined;
}

function isFloorIntersection(intersection, camera) {
  const cos = getNormalCameraUpCosine(intersection, camera);
  return cos >= 0.5;
}

function isWallIntersection(intersection, camera) {
  const cos = getNormalCameraUpCosine(intersection, camera);
  return cos >= -0.1 && cos <= 0.1;
}

function getFloorCandidates(
position,
cameraDistanceFromFloor,
minAllowedRoofDistance,
smallAllowedVerticalStep,
bigAllowedVerticalStep,
minFloorSidesLengthForBigVerticalStep,
viewer,
candidates,
obstacles,
filterByFloorDistance) {

  var camera = viewer.impl.camera;
  var upVector = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(camera.worldup);

  // Search new floors with a ray downwards starting above the camera position at the maximum allowed roof distance.
  var rayOrigin = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(position).add(upVector.multiplyScalar(minAllowedRoofDistance));
  var rayDirection = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(upVector).multiplyScalar(-1);
  var floorDistance = minAllowedRoofDistance + cameraDistanceFromFloor;

  const rayIntersectOptions = {
    skipLines: true,
    skipPoints: true,
    skipWithoutRaycastBVH: true
  };

  if (filterByFloorDistance) {
    rayIntersectOptions.maxDistance = floorDistance;
  }

  viewer.impl.rayIntersect(new THREE.Ray(rayOrigin, rayDirection), false, false, false, candidates, rayIntersectOptions);
  var candidatesCount = candidates.length;

  // If there are not collisions then return -1 (no best candidate index).
  if (candidatesCount === 0) {

    return -1;
  }

  // If we have just one candidate we take it as a floor only if it has the correct normal and it's below the previous camera position.
  if (candidatesCount === 1) {

    if (!isFloorIntersection(candidates[0], camera)) {

      return -1;
    }

    var allowedRoofDistanceSquared = minAllowedRoofDistance * minAllowedRoofDistance;
    if (candidates[0].point.distanceToSquared(position) < allowedRoofDistanceSquared) {

      return -1;
    }

    return 0;
  }

  // Search for the best candidate.
  var smallVerticalStepDistance = floorDistance - smallAllowedVerticalStep;
  var bigVerticalStepDistance = floorDistance - bigAllowedVerticalStep;

  var bestCandidate = -1;

  var minDistance = Number.MAX_VALUE;
  var instanceTree = viewer.impl.model.getData().instanceTree;

  for (var i = 0; i < candidatesCount; ++i) {

    var candidate = candidates[i];

    // Walls are ignored completely, user goes through them, they are not roofs nor floors.
    if (isWallIntersection(candidate, camera)) {
      continue;
    }

    // Obstacles are geometries between the minimum roof distance and the big vertical step.
    if (obstacles &&
    candidate.distance > minAllowedRoofDistance &&
    candidate.distance < bigAllowedVerticalStep) {
      obstacles.push(candidate);
      continue;
    }

    // Geometry at maximum vertical step or lower is considered a roof if its slope is too steep to be considered a floor.
    if (!isFloorIntersection(candidate, camera)) {
      continue;
    }

    // Choose vertical step.
    var verticalStepDistance = smallVerticalStepDistance;

    // If the instance tree is still loading we use the bigger step (it's better to climb on a table than fall though a floor).
    if (!instanceTree) {
      verticalStepDistance = bigVerticalStepDistance;
    } else {

      var side = getSmallestFloorSide(candidate, camera, instanceTree);
      if (side > minFloorSidesLengthForBigVerticalStep) {
        verticalStepDistance = bigVerticalStepDistance;
      }
    }

    // Check if candidate can be climbed.
    if (candidate.distance < verticalStepDistance) {
      continue;
    }

    // Best candidate is the one closer along the world up vector to the currenct camera position.
    var distance = Math.abs(
      getWorldUpComponent(camera, position) - getWorldUpComponent(camera, candidate.point)
    );

    if (minDistance > distance) {
      minDistance = distance;
      bestCandidate = i;
    }
  }

  return bestCandidate;
}

function easeInOutQuad(t, b, c, d) {

  t /= d / 2;
  if (t < 1) {
    return c / 2 * t * t + b;
  }
  t--;
  return -c / 2 * (t * (t - 2) - 1) + b;
}

function easeInQuad(t, b, c, d) {

  t /= d;
  return c * t * t + b;
}

// Calculate friction contribution to final accelerator vector.
function updateFriction(accelerationModule, velocity, acceleration) {

  var speedSquared = velocity.lengthSq();
  if (speedSquared > 0) {

    var friction = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)();
    friction.copy(velocity).normalize().multiplyScalar(-1);

    // Hack friction factor.
    friction.multiplyScalar(accelerationModule * accelerationModule);
    acceleration.add(friction);
  }
  return speedSquared > 0;
}

// Calculate velocity contribution to velocity vector.
function updateVelocity(elapsed, acceleration, topSpeed, clampSpeed, friction, velocity) {

  var current = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(velocity);
  current.add(acceleration.multiplyScalar(elapsed));

  if (clampSpeed) {

    if (current.lengthSq() > topSpeed * topSpeed) {
      current.normalize();
      current.multiplyScalar(topSpeed);
    }
  }

  if (friction) {

    if (current.lengthSq() < EPSILON || current.dot(velocity) < 0) {
      current.set(0, 0, 0);
    }
  }

  velocity.copy(current);
}

function getForward(camera) {

  return (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_0__.getTempVector)(camera.target).sub(camera.position).normalize();
}

/***/ },

/***/ "./extensions/BimWalk/Navigators/Navigator.js"
/*!****************************************************!*\
  !*** ./extensions/BimWalk/Navigators/Navigator.js ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Navigator: () => (/* binding */ Navigator)
/* harmony export */ });


var Private = Autodesk.Viewing.Private;

/**
 *
 * @constructor
 */
function Navigator(tool) {

  this.tool = tool;
  this.viewer = tool.viewer;
  this.velocity = new THREE.Vector3(0, 0, 0);
  this.angularVelocity = new THREE.Vector3(0, 0, 0);
  this.configuration = {};
}

var proto = Navigator.prototype;

/**
 *
 * @param configuration
 * @param value
 * @returns {boolean}
 */
proto.set = function (configuration, value) {

  if (!Object.prototype.hasOwnProperty.call(this.configuration, configuration)) {
    Private.logger.warn('err! configuration not defined for current navigator in BimWalk: ' + configuration);
    return false;
  }

  if (!value === null || value === undefined) {
    Private.logger.warn('err! configuration value should be a number: ' + value);
    return false;
  }

  this.configuration[configuration] = value;
  return true;
};

/**
 *
 * @param configuration
 * @returns {*}
 */
proto.get = function (configuration) {

  if (!Object.prototype.hasOwnProperty.call(this.configuration, configuration)) {
    Private.logger.warn('err! configuration not defined for current navigator in BimWalk: ' + configuration);
    return undefined;
  }

  return this.configuration[configuration];
};

/**
 *
 *
 */
proto.activate = function () {

};

/**
 *
 *
 */
proto.deactivate = function () {

};

/**
 *
 *
 */
proto.getCursor = function () {

  // Default.
  return null;
};

/**
 *
 * @returns {THREE.Vector3}
 */
proto.getVelocity = function () {

  return this.velocity;
};

/**
 *
 * @returns {THREE.Vector3}
 */
proto.getAngularVelocity = function () {

  return this.angularVelocity;
};

/**
 *
 * @returns {Number}
 */
proto.getMinPitchLimit = function () {

  return THREE.Math.degToRad(20);
};

/**
 *
 * @returns {Number}
 */
proto.getMaxPitchLimit = function () {

  return THREE.Math.degToRad(160);
};

/**
 *
 * @param elapsed
 * @param camera
 * @param updateNumber
 * @param updatesCount
 */
proto.update = function (elapsed, camera, updateNumber, updatesCount) {

};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleGesture = function (event) {

  return false;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleButtonDown = function (event, button) {

  return false;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleButtonUp = function (event, button) {

  return false;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleMouseClick = function (event, button) {

  return false;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleMouseDoubleClick = function (event, button) {

  return false;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleMouseMove = function (event) {

  return false;
};

/**
 *
 * @param event
 * @param keyCode
 * @returns {boolean}
 */
proto.handleKeyDown = function (event, keyCode) {

  return true;
};

/**
 *
 * @param event
 * @param keyCode
 * @returns {boolean}
 */
proto.handleKeyUp = function (event, keyCode) {

  return true;
};

/**
 *
 * @param delta
 * @returns {boolean}
 */
proto.handleWheelInput = function (delta) {

  return false;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleSingleTap = function (event) {

  return false;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleDoubleTap = function (event) {

  return false;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleBlur = function (event) {

  return false;
};

/***/ },

/***/ "./extensions/BimWalk/Navigators/NavigatorAEC.js"
/*!*******************************************************!*\
  !*** ./extensions/BimWalk/Navigators/NavigatorAEC.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavigatorAEC: () => (/* binding */ NavigatorAEC)
/* harmony export */ });
/* harmony import */ var _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NavigatorSimple.js */ "./extensions/BimWalk/Navigators/NavigatorSimple.js");
/* harmony import */ var _BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../BimWalkUtils.js */ "./extensions/BimWalk/BimWalkUtils.js");



/**
 * The AEC Navgator will do the following:
 * 1. Left clicking selection is disabled. Selection can be done through the context menu.
 * 2. Dragging the mouse on the Y axis will move the camera forward|backwards.
 * 3. The 'L' key will enable the look around mode (this is the same as the NavigatorSimple implementation).
 * 4. Cursors change depending on if the user is in walk mode or look mode.
 * 5. The info button is removed and the viewcube is displayed.
 */
class NavigatorAEC extends _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple {
  constructor(tool) {
    super(tool);
    this.lookingEnabled = false;
    this.walkDelta = 0;
    this.onClickMousePosition = new THREE.Vector2(0, 0);
    // minimize the camera movement when releasing the mouse button
    this.configuration.mouseTurnStopDuration = 0.01;
  }

  activate() {
    _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.activate.call(this);
    this.ui.showInfoIcon(false);
    this.viewer.getExtension("Autodesk.ViewCubeUi", function (ext) {
      ext.displayViewCube(true);
      ext.displayHomeButton(true);
    });
    this.viewer.impl.disableSelection(true);
    this.viewer.registerContextMenuCallback('Autodesk.BimWalk', this._onContextMenu.bind(this));
  }

  deactivate() {
    _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.deactivate.call(this);
    this.viewer.impl.disableSelection(false);
    this.viewer.unregisterContextMenuCallback('Autodesk.BimWalk');
  }

  handleKeyDown(event, keyCode) {
    let handled = _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.handleKeyDown.call(this, event, keyCode);

    switch (keyCode) {
      case this.keys.w:
      case this.keys.s:
      case this.keys.a:
      case this.keys.d:
      case this.keys.q:
      case this.keys.e:
      case this.keys.UP:
      case this.keys.DOWN:
      case this.keys.LEFT:
      case this.keys.RIGHT:
      case this.keys.l:
        this.lookingEnabled = true;
        handled = true;
        break;
      default:
        break;
    }

    return handled;
  }

  handleKeyUp(event, keyCode) {
    let handled = _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.handleKeyUp.call(this, event, keyCode);

    switch (keyCode) {
      case this.keys.w:
      case this.keys.s:
      case this.keys.a:
      case this.keys.d:
      case this.keys.q:
      case this.keys.e:
      case this.keys.UP:
      case this.keys.DOWN:
      case this.keys.LEFT:
      case this.keys.RIGHT:
      case this.keys.l:
        this.lookingEnabled = false;
        handled = true;
        break;
      default:
        break;
    }

    return handled;
  }

  handleMouseDoubleClick(event) {
    const ret = _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.handleMouseDoubleClick.call(this, event);
    this.viewer.clearSelection();
    return ret;
  }

  update(elapsed, camera, updateNumber, updatesCount) {
    _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.update.call(this, elapsed, camera, updateNumber, updatesCount);

    if (!this.lookingEnabled) {
      // Disable looking up.
      this.angularVelocity.x = 0;
    }

    if (this.turningWithMouse && !this.lookingEnabled) {
      // sets the moveMouseTargetDistance with the current delta
      this.applyDeltaToMouseTargetDistance(this.walkDelta);
    }
  }

  calculateMouseDisplacementSpeed() {
    // because we love magic.
    const MAGIC_NUBER = 90;
    // The walkDelta is calculated with the mouse y position
    const speedDelta = Math.abs(this.walkDelta / MAGIC_NUBER);
    return speedDelta > 0.5 ? speedDelta : 0;
  }

  updateMoveMouseTargetDistance() {
    this.moveMouseTargetDistance = 0;
  }

  /**
   *
   * @param event
   * @returns {boolean}
   */
  handleMouseMove(event) {
    var prevMousePosition = this.mousePosition;
    var currMousePosition = { x: 0, y: 0, z: 0 };

    (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__.getMousePosition)(event, this.viewer, currMousePosition);

    if (this.turningWithMouse) {
      // let delta;
      if (this.get('mouseTurnInverted')) {
        this.turnMouseDelta.x += currMousePosition.x - prevMousePosition.x;
        this.turnMouseDelta.y += currMousePosition.y - prevMousePosition.y;
      } else {
        this.turnMouseDelta.x -= currMousePosition.x - prevMousePosition.x;
        this.turnMouseDelta.y -= currMousePosition.y - prevMousePosition.y;
      }
      // Calculate the walkDelta
      if (!this.lookingEnabled && this.onClickMousePosition) {
        this.walkDelta = currMousePosition.y - this.onClickMousePosition.y;
      }
    }

    this.mousePosition.copy(currMousePosition);
    return true;
  }

  handleButtonDown(event, button) {
    _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.handleButtonDown.call(this, event, button);
    if (button === 0) {
      (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__.getMousePosition)(event, this.viewer, this.onClickMousePosition);
    }

    return true;
  }

  handleButtonUp(event, button) {
    _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.handleButtonUp.call(this, event, button);
    if (button === 0) {
      this.onClickMousePosition = new THREE.Vector2(0, 0);
      this.walkDelta = 0;
    }

    return true;
  }

  getCursor() {
    if (this.lookingEnabled) {
      return 'url(data:image/x-icon;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAQAAADYBBcfAAAACXBIWXMAABYlAAAWJQFJUiTwAAADGGlDQ1BQaG90b3Nob3AgSUNDIHByb2ZpbGUAAHjaY2BgnuDo4uTKJMDAUFBUUuQe5BgZERmlwH6egY2BmYGBgYGBITG5uMAxIMCHgYGBIS8/L5UBFTAyMHy7xsDIwMDAcFnX0cXJlYE0wJpcUFTCwMBwgIGBwSgltTiZgYHhCwMDQ3p5SUEJAwNjDAMDg0hSdkEJAwNjAQMDg0h2SJAzAwNjCwMDE09JakUJAwMDg3N+QWVRZnpGiYKhpaWlgmNKflKqQnBlcUlqbrGCZ15yflFBflFiSWoKAwMD1A4GBgYGXpf8EgX3xMw8BSMDVQYqg4jIKAUICxE+CDEESC4tKoMHJQODAIMCgwGDA0MAQyJDPcMChqMMbxjFGV0YSxlXMN5jEmMKYprAdIFZmDmSeSHzGxZLlg6WW6x6rK2s99gs2aaxfWMPZ9/NocTRxfGFM5HzApcj1xZuTe4FPFI8U3mFeCfxCfNN45fhXyygI7BD0FXwilCq0A/hXhEVkb2i4aJfxCaJG4lfkaiQlJM8JpUvLS19QqZMVl32llyfvIv8H4WtioVKekpvldeqFKiaqP5UO6jepRGqqaT5QeuA9iSdVF0rPUG9V/pHDBYY1hrFGNuayJsym740u2C+02KJ5QSrOutcmzjbQDtXe2sHY0cdJzVnJRcFV3k3BXdlD3VPXS8Tbxsfd99gvwT//ID6wIlBS4N3hVwMfRnOFCEXaRUVEV0RMzN2T9yDBLZE3aSw5IaUNak30zkyLDIzs+ZmX8xlz7PPryjYVPiuWLskq3RV2ZsK/cqSql01jLVedVPrHzbqNdU0n22VaytsP9op3VXUfbpXta+x/+5Em0mzJ/+dGj/t8AyNmf2zvs9JmHt6vvmCpYtEFrcu+bYsc/m9lSGrTq9xWbtvveWGbZtMNm/ZarJt+w6rnft3u+45uy9s/4ODOYd+Hmk/Jn58xUnrU+fOJJ/9dX7SRe1LR68kXv13fc5Nm1t379TfU75/4mHeY7En+59lvhB5efB1/lv5dxc+NH0y/fzq64Lv4T8Ffp360/rP8f9/AA0ADzT6lvFdAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAAEtSURBVHja7JQxTkJBFEXPQ/xQEDG0ljRYSU1iLN2AtSWlC7Gw04QtGF2ApQVLIDY2hlgIDagJwWCOhf74JXxRYumbaib3ZO7c9zIhq1WBfzAfjJViDWPdYBq/w0pKITjhd7eGJwQkDu2I8rOFHYcmkqgDz4wfoeGZA01BHXtsbSla89ixZsH3an2LtpRUOQde28xFm17PgyPvVK1bl5yYEOtuq3rnyMQCXNJgiiTchuHCnhrGbYBMaXAJULGqlJz54O43bcFdH5xZUqpWJJWW7duza/tDmTWJbbv27Fs2PS2m1iZRNeGcI/aAEevOgCKnbAI7DNjjhUmk1ouf7xgHbLgF3MSzT7wCaxxSiW3hnsf4OngLotj3ILO74CoWTWzOIGcTXab4/6z+CnwbAGjXSZC++vLvAAAAAElFTkSuQmCC), auto';
    } else {
      return 'url(data:image/x-icon;base64,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), auto';
    }
  }

  _onContextMenu(menu, status) {
    const event = status.event;
    const intersection = this.viewer.impl.hitTest(status.canvasX, status.canvasY);
    if (!intersection) return;
    const dbId = intersection.dbId;
    menu.push({
      title: 'Select',
      target: () => {
        const dbIds = event.shiftKey ? this.viewer.getSelection() : [];
        dbIds.push(dbId);
        this.viewer.impl.disableSelection(false);
        this.viewer.select(dbIds);
        this.viewer.impl.disableSelection(true);
      }
    });
  }
}

/***/ },

/***/ "./extensions/BimWalk/Navigators/NavigatorMobile.js"
/*!**********************************************************!*\
  !*** ./extensions/BimWalk/Navigators/NavigatorMobile.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavigatorMobile: () => (/* binding */ NavigatorMobile)
/* harmony export */ });
/* harmony import */ var _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NavigatorSimple.js */ "./extensions/BimWalk/Navigators/NavigatorSimple.js");
/* harmony import */ var _UI_NavigatorMobileJoystick_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../UI/NavigatorMobileJoystick.js */ "./extensions/BimWalk/UI/NavigatorMobileJoystick.js");
/* harmony import */ var _BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../BimWalkPools.js */ "./extensions/BimWalk/BimWalkPools.js");
/* harmony import */ var _BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../BimWalkUtils.js */ "./extensions/BimWalk/BimWalkUtils.js");





var MOBILE_SPEED_FACTOR = 15.0;
const EPSILON = 0.0000125;

/**
 *
 * @constructor
 */
function NavigatorMobile(tool) {

  _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.call(this, tool);
  this.viewer.setGlobalManager(tool.viewer.globalManager);

  this.configuration.keyboardTopTurnSpeed = 0.5;
  this.configuration.keyboardTurnStopDuration = 0.4;
  this.configuration.mouseTurnInverted = true;

  this.ui = new _UI_NavigatorMobileJoystick_js__WEBPACK_IMPORTED_MODULE_1__.NavigatorMobileJoystick(this.viewer, this, tool.options.joystickOptions);
}

NavigatorMobile.prototype = Object.create(_NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype);
NavigatorMobile.prototype.constructor = NavigatorMobile;

let startQuat;
const endQuat = new THREE.Quaternion();
let camOffsetMatrix = new THREE.Matrix4(); // rotation matrix to maintain offset between gyro's and viewer's rotations of cameras.
// offSetQuat compensates caused by initial device's orientation
// facing towards the ground while screen is up
const offsetQuat = new THREE.Quaternion(0, 0, -Math.sqrt(0.5), Math.sqrt(0.5));
var proto = NavigatorMobile.prototype;

/**
 * Extends NavigatorSimple.activate function
 */
proto.activate = function () {
  _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.activate.call(this);
  // Gravity state, Gravity should be ignored by default, until user interacts with joystick.
  // ignoreGravity becomes true again once pinch/rotate/drag used.
  this.ignoreGravity = true;

  // Maintain correct Up Direction across different documents, some may have Up World different than Z axis.
  const worldUp = this.viewer.getCamera().worldup;
  this.worldUpAxis = Object.keys(worldUp).find((axis) => worldUp[axis] === 1);
};

/**
 * Extends NavigatorSimple.deactivate function
 */
proto.deactivate = function () {
  _NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimple.prototype.deactivate.call(this);
  this.deactivateGyroNavigation();
};

/**
 *
 * @param elapsed
 */
proto.updateKeyboardDisplacement = function (elapsed) {

  var running = this.running;
  var moveForward = this.moveForward;
  var moveBackward = this.moveBackward;

  // Update acceleration.
  var topSpeed = running ? this.getTopRunSpeed() : this.get('topWalkSpeed');
  var velocity = this.moveKeyboardVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__.getTempVector)();
  var accelerationModule = topSpeed * MOBILE_SPEED_FACTOR;

  var moving =
  moveForward !== 0 ||
  moveBackward !== 0;

  if (moving) {

    var camera = this.tool.camera;
    var upVector = camera.worldup;
    var speed = Math.max(this.moveForward, this.moveBackward);

    var directionForward = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_3__.getForward)(camera);
    var directionForwardXZ = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__.getTempVector)(directionForward);
    directionForwardXZ.sub((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__.getTempVector)(upVector).multiplyScalar(upVector.dot(directionForward)));
    directionForwardXZ.normalize();

    var directionBackwardXZ = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__.getTempVector)(directionForwardXZ).multiplyScalar(-1);

    acceleration.add(directionForwardXZ.multiplyScalar(moveForward));
    acceleration.add(directionBackwardXZ.multiplyScalar(moveBackward));
    acceleration.normalize();

    velocity.copy(acceleration).multiplyScalar(speed);
    acceleration.multiplyScalar(accelerationModule * Math.max(this.moveForward, this.moveBackward));
  }

  // Decelerate if stop running.
  var deceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__.getTempVector)();
  if (!running && velocity.lengthSq() > topSpeed * topSpeed) {

    deceleration.copy(velocity).normalize();
    deceleration.multiplyScalar(-this.getTopRunSpeed() / 1);

    acceleration.copy(deceleration);
  }

  // Update friction contribution.
  var frictionPresent = !moving && (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_3__.updateFriction)(accelerationModule, velocity, acceleration);

  // Update velocity.
  var clampToTopSpeed = deceleration.lengthSq() === 0;
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_3__.updateVelocity)(elapsed, acceleration, topSpeed, clampToTopSpeed, frictionPresent, velocity);
};

/**
 *
 * @param elapsed
 */
proto.updateKeyboardAngularVelocity = function (elapsed) {

  var topSpeed = this.get('keyboardTopTurnSpeed');
  var stopDuration = this.get('keyboardTurnStopDuration');
  var velocity = this.angularKeyboardVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_2__.getTempVector)();
  var accelerationModule = topSpeed / stopDuration;
  var turning = this.turningWithKeyboard;


  // Update angular acceleration.
  if (turning) {

    var speed = Math.min(topSpeed, Math.max(this.moveLeft, this.moveRight) + accelerationModule * elapsed);

    velocity.y = 0;
    velocity.y -= this.moveLeft;
    velocity.y += this.moveRight;

    velocity.normalize().multiplyScalar(speed);
  }

  // Update friction contribution.
  var friction = !turning && (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_3__.updateFriction)(accelerationModule, velocity, acceleration);

  // Update velocity.
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_3__.updateVelocity)(elapsed, acceleration, topSpeed, true, friction, velocity);
};

/**
 * Function handles movement according to input from Gyroscope
 */
proto.updateGyroscopeVelocity = function () {
  // No navigation without data from device
  if (!this.isGyroEnabled) {
    return;
  }

  // according to BLMV-6838, we would like to disable Avatar's rotation by user
  // setLockDragDirection disables Drag Direction in Avatar extension
  if (!this.minimap3dExt) {
    this.minimap3dExt = this.viewer.getExtension("Autodesk.AEC.Minimap3DExtension");
    this.minimap3dExt?.setLockDragDirection(true);
  }

  const tool = this.tool;
  const tempAngle = new THREE.Euler();
  const camVector = new THREE.Vector3(0, 0, -1); // Default direction of camera
  const camPosition = tool.camera.position;

  endQuat.set(this.x, this.y, this.z, this.w); // create quaternion based Quaternion values from gyroscope

  if (!startQuat) {
    // Refernce point for rotation
    startQuat = endQuat.clone();

    // Calculate and save offset between gyro's and viewer's cameras, around Up direction.
    tempAngle.setFromQuaternion(endQuat);
    const gyroDirection = camVector.applyEuler(tempAngle);
    gyroDirection[this.worldUpAxis] = 0;

    const camTarget = tool.camera.target;
    const camDirection = camTarget.clone().sub(camPosition);
    camDirection[this.worldUpAxis] = 0;

    // accept the offset if problematic angle acquired
    if (gyroDirection.lengthSq() < EPSILON || camDirection.lengthSq() < EPSILON) {
      camOffsetMatrix.identity();
      return;
    }

    gyroDirection.normalize();
    camDirection.normalize();

    // check if vectors are opposite, in this case, rotate camOffsetMatrix by 180 around worldUp direction
    if (gyroDirection.dot(camDirection) < -1 + EPSILON) {
      switch (this.worldUpAxis) {
        case 'x':
          camOffsetMatrix.makeRotationX(Math.PI);
          break;
        case 'y':
          camOffsetMatrix.makeRotationY(Math.PI);
          break;
        case 'z':
          camOffsetMatrix.makeRotationZ(Math.PI);
          break;
      }
    } else {
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(gyroDirection, camDirection);
      camOffsetMatrix.makeRotationFromQuaternion(quaternion);
    }

  } else {
    // Based on THREE JS example, DeviceOrientationControls, which was deleted recently
    // Eliminates minor movements and steadies camera
    const isGyroChanged = 1 - startQuat.dot(endQuat) > EPSILON;
    if (!isGyroChanged) {
      return;
    }
    startQuat = endQuat.clone();
    endQuat.multiply(offsetQuat);

    // setView handles better transition from gyro to touch based movements than trivial quaternion copy
    // in addition, it eliminates yaw (from device's POV) movement
    tempAngle.setFromQuaternion(endQuat);
    const camDirection = camVector.applyEuler(tempAngle);
    camDirection.applyMatrix4(camOffsetMatrix);
    const newTarget = camDirection.add(camPosition);
    tool.navapi.setView(camPosition, newTarget);
    tool.navapi.orientCameraUp();
  }
};

/**
 * Function which updates quaternion values from mobile device's gyro
 * @param {number} w
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
proto.updateGyroValues = function (w, x, y, z) {
  // update quaternion values for camera movement.
  this.w = w;
  this.x = x;
  this.y = y;
  this.z = z;
  this.isGyroEnabled = true;
};


proto.deactivateGyroNavigation = function () {
  this.w = undefined; // reset value since used as updateGyroscopeVelocity exit condition
  this.x = undefined;
  this.y = undefined;
  this.z = undefined;
  this.isGyroEnabled = false;
  startQuat = undefined; // reset value to make sure smooth transition between mouse and gyro navigations persist
  camOffsetMatrix = new THREE.Matrix4();

  if (this.minimap3dExt) {
    this.minimap3dExt.setLockDragDirection(false);
    this.minimap3dExt = undefined;
  }
};

/***/ },

/***/ "./extensions/BimWalk/Navigators/NavigatorSimple.js"
/*!**********************************************************!*\
  !*** ./extensions/BimWalk/Navigators/NavigatorSimple.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavigatorSimple: () => (/* binding */ NavigatorSimple)
/* harmony export */ });
/* harmony import */ var _Navigator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Navigator.js */ "./extensions/BimWalk/Navigators/Navigator.js");
/* harmony import */ var _BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../BimWalkPools.js */ "./extensions/BimWalk/BimWalkPools.js");
/* harmony import */ var _BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../BimWalkUtils.js */ "./extensions/BimWalk/BimWalkUtils.js");
/* harmony import */ var _UI_NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../UI/NavigatorSimple.js */ "./extensions/BimWalk/UI/NavigatorSimple.js");





var EPSILON = 0.0001;
var temporalMousePosition = { x: 0, y: 0 };
var avp = Autodesk.Viewing.Private;

/**
 *
 * @constructor
 */
function NavigatorSimple(tool) {

  _Navigator_js__WEBPACK_IMPORTED_MODULE_0__.Navigator.call(this, tool);

  // Set initial configurable values.
  this.configuration = {

    // Walk and run.
    minWalkSpeed: 2,
    maxWalkSpeed: 6,
    topWalkSpeed: 4,
    minRunSpeed: 4,
    maxRunSpeed: 12,
    runMultiplier: 2,

    // Walk with mouse.
    mouseWalkMaxTargetDistance: 2,
    mouseWalkStopDuration: 0.5,

    // Vertical movement with mouse.
    topVerticalSpeed: 2,
    topVerticalSpeedMultiplier: 1.5,
    allowVerticalSuspension: false,

    // Mobile gestures multipliers.
    panDistanceMultiplier: 150,
    pinchDistanceMultiplier: 250,

    // Turning with keyboard.
    keyboardTopTurnSpeed: 1.5,
    keyboardTurnStopDuration: 0.75,

    // Turning with mouse.
    mouseTurnInverted: false,
    mouseTurnStopDuration: 0.2,
    mouseTurnMinPitchLimit: THREE.Math.degToRad(20),
    mouseTurnMaxPitchLimit: THREE.Math.degToRad(160),

    // Teleport.
    teleportDuration: 0.5,
    teleportWallDistance: 1.0,
    teleportPointCloudDistance: 3.0,

    cameraDistanceFromFloor: 1.8,
    minAllowedRoofDistance: 0.6,
    smallAllowedVerticalStep: 0.3,
    bigAllowedVerticalStep: 0.6,
    minFloorSidesLengthForBigVerticalStep: 5,

    gravityUpdatesBeforeFalling: 10,
    gravityAcceleration: 9.8,
    gravityTopFallSpeed: 10
  };

  this.modelToMeters = 1;
  this.metersToModel = 1;

  this.keys = Autodesk.Viewing.KeyCode;
  this.mousePosition = new THREE.Vector2(0, 0);

  // Keyboard displacement
  this.moveForward = 0;
  this.moveBackward = 0;
  this.moveLeft = 0;
  this.moveRight = 0;

  this.moveKeyboardVelocity = new THREE.Vector3();

  // Mouse displacement.
  this.moveMouseTargetDistance = 0;
  this.moveMouseLastWheelDelta = 0;
  this.moveMouseVelocity = new THREE.Vector3();
  this.moveMouseLastVelocity = new THREE.Vector3();
  this.mouseForwardDirection = new THREE.Ray();

  // Turn with rotations.
  this.turningWithMouse = false;
  this.turnMouseDelta = new THREE.Vector3();
  this.turnMouseLastVelocity = new THREE.Vector3();

  // Turn with Keyboard.
  this.turnLeft = 0;
  this.turnRight = 0;

  this.angularKeyboardVelocity = new THREE.Vector3();
  this.angularMouseVelocity = new THREE.Vector3();

  // Between floors displacement.
  this.moveUp = 0;
  this.moveDown = 0;

  this.moveUpDownKeyboardVelocity = new THREE.Vector3();

  // Gravity displacement.
  this.gravityEnabled = this.viewer.prefs.get(avp.Prefs3D.BIM_WALK_GRAVITY);

  // While moving up/down, gravity is temporarily blocked (even if enabled)
  this.movingUpOrDown = false;

  this.userOverFloor = false;
  this.fallingToCandidate = null;
  this.gravityVelocity = new THREE.Vector3();
  this.updatesToStartFalling = 0;

  // Teleport.
  this.teleporting = false;
  this.teleportInitial = new THREE.Vector3();
  this.teleportTarget = new THREE.Vector3();

  this.teleportTime = 0;
  this.teleportVelocity = new THREE.Vector3();
  this.teleportedDistance = 0;

  this.ui = new _UI_NavigatorSimple_js__WEBPACK_IMPORTED_MODULE_3__.NavigatorSimple(this);

  this.modelAddedCb = this.updateUnits.bind(this);

  this.lastPanPosition = new THREE.Vector2();
  this.lastPinchDistance = new THREE.Vector2();

  this.isPinching = false;
  this.isDragging = false;

  this.immediateDisplacement = false;

  this.enableGravity = this.enableGravity.bind(this);
}

NavigatorSimple.prototype = Object.create(_Navigator_js__WEBPACK_IMPORTED_MODULE_0__.Navigator.prototype);
NavigatorSimple.prototype.constructor = NavigatorSimple;

var proto = NavigatorSimple.prototype;

/**
 *
 * @param configuration
 * @param value
 * @returns {boolean}
 */
proto.set = function (configuration, value) {

  var result = _Navigator_js__WEBPACK_IMPORTED_MODULE_0__.Navigator.prototype.set.call(this, configuration, value);

  // Ensure top walk speed stays in it's limits.
  var minWalkSpeed = this.get('minWalkSpeed');
  var maxWalkSpeed = this.get('maxWalkSpeed');

  this.configuration.topWalkSpeed = Math.min(Math.max(
    this.configuration.topWalkSpeed, minWalkSpeed), maxWalkSpeed);
  return result;
};

/**
 *
 * @param configuration
 * @param value
 * @returns {boolean}
 */
proto.getTopRunSpeed = function () {

  var minRunSpeed = this.get('minRunSpeed');
  var maxRunSpeed = this.get('maxRunSpeed');

  var speed = this.get('topWalkSpeed') * this.get('runMultiplier');
  return Math.min(Math.max(speed, minRunSpeed, maxRunSpeed));
};

/**
 *
 * @returns {Number}
 */
proto.getMinPitchLimit = function () {

  return this.get('mouseTurnMinPitchLimit');
};

/**
 *
 * @returns {Number}
 */
proto.getMaxPitchLimit = function () {

  return this.get('mouseTurnMaxPitchLimit');
};

/**
 *
 *
 */
proto.activate = function () {

  this.updateUnits();
  this.userOverFloor = false;
  this.fallingToCandidate = null;
  this.ui.activate();

  // Make sure that we always use units from latest added model
  this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.modelAddedCb);
  this.viewer.prefs.addListeners(avp.Prefs3D.BIM_WALK_GRAVITY, this.enableGravity);
};

/**
 *
 *
 */
proto.deactivate = function () {
  this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.modelAddedCb);
  this.viewer.prefs.removeListeners(avp.Prefs3D.BIM_WALK_GRAVITY, this.enableGravity);

  // Reset key states and velocities to avoid movement when reactivating the tool
  this.moveForward = this.moveBackward = 0;
  this.moveLeft = this.moveRight = 0;
  this.moveUp = this.moveDown = 0;
  this.moveKeyboardVelocity.set(0, 0, 0);
  this.moveUpDownKeyboardVelocity.set(0, 0, 0);

  this.ui.deactivate();
};

proto.updateUnits = function () {
  // Avoid crash if view is empty
  if (!this.viewer.impl.model) {
    return;
  }

  this.metersToModel = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.metersToModel)(1, this.viewer);
  this.modelToMeters = 1 / this.metersToModel;
};

/**
 *
 *
 */
proto.enableGravity = function (enable) {

  if (this.gravityEnabled === enable) {
    return;
  }

  this.gravityEnabled = enable;
  this.resetGravity();
};

proto.resetGravity = function () {
  this.gravityVelocity.set(0, 0, 0);
  this.userOverFloor = false;
  this.fallingToCandidate = null;
  this.updatesToStartFalling = Number.MAX_VALUE;
};

/**
 *
 * @param elapsed
 * @param camera
 * @param updateNumber
 * @param updatesCount
 */
proto.update = function (elapsed, camera, updateNumber, updatesCount) {

  this.velocity.set(0, 0, 0);
  this.angularVelocity.set(0, 0, 0);

  if (this.ui.isDialogOpen && this.ui.isDialogOpen()) {
    return;
  }

  if (this.viewer.autocam.currentlyAnimating) {
    this.userOverFloor = false;
    this.fallingToCandidate = null;
    this.updatesToStartFalling = this.get('gravityUpdatesBeforeFalling');
    return;
  }

  if (this.teleporting) {

    // Update displacement velocity.
    this.updateTeleportDisplacement(elapsed);
    this.velocity.add(this.teleportVelocity);
  } else {

    if (!this.immediateDisplacement) {
      // Update displacement velocity.
      this.updateKeyboardUpDownDisplacement(elapsed);
      this.updateGravityDisplacement(elapsed, camera, updateNumber, updatesCount);
      this.updateKeyboardDisplacement(elapsed);
      this.updateMouseDisplacement(elapsed);
    }

    this.velocity.add(this.gravityVelocity);
    this.velocity.add(this.moveUpDownKeyboardVelocity);
    this.velocity.add(this.moveKeyboardVelocity);
    this.velocity.add(this.moveMouseVelocity);

    // Update angular velocity.
    this.updateKeyboardAngularVelocity(elapsed);

    // Gyro based Look At movement
    this.updateGyroscopeVelocity();

    // Mouse based Look At movement
    this.updateMouseAngularVelocity(elapsed);

    this.angularVelocity.add(this.angularKeyboardVelocity);
    this.angularVelocity.add(this.angularMouseVelocity);
  }
};

/**
 *
 * @param elapsed
 */
proto.updateTeleportDisplacement = function (elapsed) {

  var initial = this.teleportInitial;
  var target = this.teleportTarget;
  var duration = this.get('teleportDuration');
  var velocity = this.teleportVelocity;

  this.teleportTime = Math.min(duration, this.teleportTime + elapsed);
  var lerp = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.easeInOutQuad)(this.teleportTime, 0, 1, duration);

  var newDisplacement = initial.distanceTo(target) * lerp;
  var oldDisplacement = this.teleportedDistance;

  this.teleportedDistance = newDisplacement;

  if (lerp === 1) {

    this.teleporting = false;
    this.fallingToCandidate = null;
    this.teleportTime = 0;
    this.teleportedDistance = 0;
  }

  velocity.copy(target);
  velocity.sub(initial).normalize();
  velocity.multiplyScalar((newDisplacement - oldDisplacement) * this.modelToMeters / elapsed);
};

proto.updateGravityDisplacement = function (elapsed, camera, updateNumber, updatesCount) {

  if (this.ignoreGravity) {
    this.resetGravity();
    return;
  }

  var viewer = this.viewer;
  var worldDown = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.worldup).multiplyScalar(-1);
  var velocity = this.gravityVelocity;

  // It's assumed the user is still over a floor if it was during the previous frame and he didn't move.
  this.userOverFloor =
  this.userOverFloor &&
  this.moveMouseVelocity.lengthSq() === 0 &&
  this.moveKeyboardVelocity.lengthSq() === 0 &&
  this.moveUpDownKeyboardVelocity.lengthSq() === 0;

  if (!this.gravityEnabled || this.movingUpOrDown) {
    return;
  }

  if (this.userOverFloor) {

    // Position is not updated by the navigator, we stop movement at the beginning of the next frame
    // the floor was found and the user was moved over it.
    velocity.set(0, 0, 0);
    return;
  }

  // Camera x/y changed - reset fallingToCandidate in order to check closer candidates.
  if (this.moveKeyboardVelocity.lengthSq() !== 0) {
    this.fallingToCandidate = null;
  }

  // Get floor candidates.
  var candidates = [];
  var obstacles = [];
  var metersToModel = this.metersToModel;
  var cameraDistanceFromFloor = this.get('cameraDistanceFromFloor');
  var minAllowedRoofDistance = this.get('minAllowedRoofDistance');
  var smallAllowedVerticalStep = this.get('smallAllowedVerticalStep');
  var bigAllowedVerticalStep = this.get('bigAllowedVerticalStep');
  var minFloorSidesLengthForBigVerticalStep = this.get('minFloorSidesLengthForBigVerticalStep');

  const _getFloorCandidates = (filterByFloorDistance) => {
    return (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getFloorCandidates)(
      camera.position,
      cameraDistanceFromFloor * metersToModel,
      minAllowedRoofDistance * metersToModel,
      smallAllowedVerticalStep * metersToModel,
      bigAllowedVerticalStep * metersToModel,
      minFloorSidesLengthForBigVerticalStep * metersToModel,
      viewer,
      candidates,
      obstacles,
      filterByFloorDistance
    );
  };

  // Trying finding candidates only in the close range first. It makes the ray intersection process much faster in case we are on a floor,
  // which is the common use-case anyway.
  var bestCandidateIndex = _getFloorCandidates(true);
  let candidate;

  // No candidate found in the close range.
  if (bestCandidateIndex === -1) {
    // Use cached floor candidate if exists.
    if (this.fallingToCandidate !== null) {
      candidate = this.fallingToCandidate;
    } else {
      // In this case we want to check if there is a far away floor - so we'll know if we need to fall down or stay floating in the air.
      // In order to do that, call _getFloorCandidates without distance filtering (slower).
      bestCandidateIndex = _getFloorCandidates(false);

      if (bestCandidateIndex !== -1) {
        candidate = candidates[bestCandidateIndex];
      }
    }
  } else {
    // Candidate was found in the close range.
    candidate = candidates[bestCandidateIndex];
  }

  // There is no floor, so there is no falling at all, keeping same camera height.
  if (!candidate || obstacles.length > 0) {
    velocity.set(0, 0, 0);
    return;
  }

  // Fall into the floor or stay over it if distance is less that epsilon.
  var candidateDistance = candidate.point.distanceTo(camera.position) * this.modelToMeters;
  var deltaFeetToCandidate = candidateDistance - cameraDistanceFromFloor;

  if (deltaFeetToCandidate < EPSILON || Math.abs(deltaFeetToCandidate) < smallAllowedVerticalStep) {

    velocity.copy(worldDown).multiplyScalar(deltaFeetToCandidate / elapsed);
    this.userOverFloor = true;
    this.fallingToCandidate = null;
    this.updatesToStartFalling = 0;
  } else {
    this.fallingToCandidate = candidate;

    if (this.updatesToStartFalling++ < this.get('gravityUpdatesBeforeFalling')) {
      return;
    }

    var acceleration = this.get('gravityAcceleration');
    var topFallSpeed = this.get('gravityTopFallSpeed');
    var speed = Math.min(topFallSpeed, velocity.length() + acceleration * elapsed);

    velocity.copy(worldDown.multiplyScalar(speed));
  }
};

/**
 *
 * @param elapsed
 */
proto.updateKeyboardUpDownDisplacement = function (elapsed) {

  var tool = this.tool;
  var running = this.running;

  var moveUp = this.moveUp;
  var moveDown = this.moveDown;

  // Update acceleration.
  var topSpeed = this.get('topVerticalSpeed') * (running ? this.get('topVerticalSpeedMultiplier') : 1);
  var velocity = this.moveUpDownKeyboardVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  var accelerationModule = topSpeed / 1;

  var moving = moveUp !== 0 || moveDown !== 0;
  var suspendMoving = this.get('allowVerticalSuspension') && this.moveKeyboardVelocity.lengthSq() > 0;

  if (moving && !suspendMoving) {

    var upVector = tool.camera.worldup;
    var speed = velocity.length();

    var directionUp = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(upVector);
    var directionDown = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(upVector).multiplyScalar(-1);

    acceleration.add(directionUp.multiplyScalar(moveUp));
    acceleration.add(directionDown.multiplyScalar(moveDown));
    acceleration.normalize();

    velocity.copy(acceleration).multiplyScalar(speed);
    acceleration.multiplyScalar(accelerationModule);
  } else {

    velocity.set(0, 0, 0);
  }

  // When starting or ending vertical move, reset gravity
  if (this.gravityEnabled && moving !== this.movingUpOrDown) {
    this.resetGravity();
  }

  // Remember movement state: This blocks gravity during while moving and
  // is used to detect changes between moving/not-moving.
  this.movingUpOrDown = moving;

  // Decelerate if stop running.
  var deceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  if (!running && velocity.lengthSq() > topSpeed * topSpeed) {

    deceleration.copy(velocity).normalize();
    deceleration.multiplyScalar(-this.getTopRunSpeed() / 1);

    acceleration.copy(deceleration);
  }

  // Update velocity.
  var frictionPresent = false;
  var clampToTopSpeed = deceleration.lengthSq() === 0;
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateVelocity)(elapsed, acceleration, topSpeed, clampToTopSpeed, frictionPresent, velocity);
};

/**
 *
 * @param elapsed
 */
proto.updateKeyboardDisplacement = function (elapsed) {

  var running = this.running;

  var moveForward = this.moveForward;
  var moveBackward = this.moveBackward;
  var moveLeft = this.moveLeft;
  var moveRight = this.moveRight;

  // Update acceleration.
  var topSpeed = running ? this.getTopRunSpeed() : this.get('topWalkSpeed');
  var velocity = this.moveKeyboardVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  var accelerationModule = topSpeed / 1;

  var moving =
  moveForward !== 0 ||
  moveBackward !== 0 ||
  moveLeft !== 0 ||
  moveRight !== 0;

  if (moving) {

    var camera = this.tool.camera;
    var upVector = camera.worldup;
    var speed = velocity.length();

    var directionForward = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getForward)(camera);
    var directionForwardXZ = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(directionForward);
    directionForwardXZ.sub((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(upVector).multiplyScalar(upVector.dot(directionForward)));
    directionForwardXZ.normalize();

    var directionRight = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(directionForward).cross(upVector).normalize();
    var directionRightXZ = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(directionRight);
    directionRightXZ.sub((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(upVector).multiplyScalar(upVector.dot(directionRight)));
    directionRightXZ.normalize();

    var directionBackwardXZ = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(directionForwardXZ).multiplyScalar(-1);
    var directionLeftXZ = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(directionRight).multiplyScalar(-1);

    acceleration.add(directionForwardXZ.multiplyScalar(moveForward));
    acceleration.add(directionBackwardXZ.multiplyScalar(moveBackward));
    acceleration.add(directionRightXZ.multiplyScalar(moveRight));
    acceleration.add(directionLeftXZ.multiplyScalar(moveLeft));
    acceleration.normalize();

    velocity.copy(acceleration).multiplyScalar(speed);
    acceleration.multiplyScalar(accelerationModule);
  }

  // Decelerate if stop running.
  var deceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  if (!running && velocity.lengthSq() > topSpeed * topSpeed) {

    deceleration.copy(velocity).normalize();
    deceleration.multiplyScalar(-this.getTopRunSpeed() / 1);

    acceleration.copy(deceleration);
  }

  // Update friction contribution.
  var frictionPresent = !moving && (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateFriction)(accelerationModule, velocity, acceleration);

  // Update velocity.
  var clampToTopSpeed = deceleration.lengthSq() === 0;
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateVelocity)(elapsed, acceleration, topSpeed, clampToTopSpeed, frictionPresent, velocity);
};

/**
 * Returns the speed that is used for the moveMouseLastVelocity.
 * @private
 */
proto.calculateMouseDisplacementSpeed = function (elapsed, velocity, accelerationModule) {
  return velocity.length() + accelerationModule * elapsed;
};

/**
 * Updates the this.moveMouseTargetDistance variable.
 * This method will decelerate the camera to make a smooth transition from 'moving' to 'stopping'.
 * @private
 */
proto.updateMoveMouseTargetDistance = function (elapsed, velocity, target) {
  var displacement = velocity.length() * elapsed;
  this.moveMouseTargetDistance += target < 0 ? displacement : -displacement;
  if (this.moveMouseTargetDistance * target < 0) {
    this.moveMouseTargetDistance = 0;
  }
};

/**
 *
 * @param elapsed
 */
proto.updateMouseDisplacement = function (elapsed) {

  var topSpeed = this.getTopRunSpeed();
  var target = this.moveMouseTargetDistance;
  var velocity = this.moveMouseVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  var moving = this.moveMouseTargetDistance !== 0;
  var accelerationModule =
  (moving ? topSpeed : this.moveMouseLastVelocity.length()) / this.get('mouseWalkStopDuration');

  // Update acceleration module.
  if (moving) {

    var camera = this.tool.camera;
    var upVector = camera.worldup;

    var ray = this.mouseForwardDirection;
    var targetPosition = this.viewer.impl.clientToViewport(this.mousePosition.x, this.mousePosition.y);
    this.viewer.impl.viewportToRay(targetPosition, ray);

    var direction = ray.direction;
    direction.sub((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(upVector).multiplyScalar(upVector.dot(direction)));
    direction.normalize();

    if (target > 0) {
      direction.multiplyScalar(-1);
    }

    var speed = this.calculateMouseDisplacementSpeed(elapsed, velocity, accelerationModule);

    velocity.copy(direction.multiplyScalar(speed));

    this.moveMouseLastVelocity.copy(velocity);

    this.fallingToCandidate = null;
  }

  // Update friction contribution.
  var frictionPresent = !moving && (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateFriction)(accelerationModule, velocity, acceleration);

  // Update velocity.
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateVelocity)(elapsed, acceleration, topSpeed, true, frictionPresent, velocity);

  // Update distance traveled.
  if (moving) {
    this.updateMoveMouseTargetDistance(elapsed, velocity, target);
  }
};

/**
 *
 * @param elapsed
 */
proto.updateKeyboardAngularVelocity = function (elapsed) {

  var topSpeed = this.get('keyboardTopTurnSpeed');
  var stopDuration = this.get('keyboardTurnStopDuration');
  var velocity = this.angularKeyboardVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  var accelerationModule = topSpeed / stopDuration;

  // Update angular acceleration.
  var turning = this.turnLeft !== 0 || this.turnRight !== 0;
  if (turning) {

    var speed = Math.min(topSpeed, velocity.length() + accelerationModule * elapsed);

    velocity.y = 0;
    velocity.y -= this.turnLeft;
    velocity.y += this.turnRight;

    velocity.normalize().multiplyScalar(speed);
  }

  // Update friction contribution.
  var friction = !turning && (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateFriction)(accelerationModule, velocity, acceleration);

  // Update velocity.
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateVelocity)(elapsed, acceleration, topSpeed, true, friction, velocity);
};

/**
*
* @param elapsed
*/
proto.updateMouseAngularVelocity = function (elapsed) {

  // suppress mouse/touch based navigation while gyroscope mode On
  if (this.isGyroEnabled) {
    return;
  }

  var stopDuration = this.get('mouseTurnStopDuration');
  var velocity = this.angularMouseVelocity;
  var acceleration = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)();
  var accelerationModule = this.turnMouseLastVelocity.length() / stopDuration;

  // Update mouse angular acceleration.
  var delta = this.turnMouseDelta;
  var turning = delta.lengthSq() > 0;

  if (turning) {

    var MAGIC_NUMBER = 1 / 200;

    var dx = -delta.y * MAGIC_NUMBER;
    var dy = -delta.x * MAGIC_NUMBER;

    delta.set(0, 0, 0);

    // Average velocity with previous one.
    velocity.add((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)().set(dx / elapsed, dy / elapsed, 0));
    velocity.multiplyScalar(0.5);

    this.turnMouseLastVelocity.copy(velocity);
  }

  // Update friction contribution.
  var friction = !turning && (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateFriction)(accelerationModule, velocity, acceleration);

  // Update velocity.
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.updateVelocity)(elapsed, acceleration, 0, false, friction, velocity);

};

/**
 * Dummy function for Gyroscope on non mobile devices
 */
proto.updateGyroscopeVelocity = function () {
  return;
};

/**
 * Dummy function for Gyroscope on non mobile devices
 */
proto.addDeviceOrientationInputListener = function () {
  return;
};

/**
 * Dummy function for Gyroscope on non mobile devices
 */
proto.removeDeviceOrientationInputListener = function () {
  return;
};

proto.jumpToFloor = function (floorIndex) {
  const levelExt = this.viewer.getExtension('Autodesk.AEC.LevelsExtension');

  if (!levelExt) {
    console.warn('BimWalk.jumpToFloor can be used only when "Autodesk.AEC.LevelsExtension" is loaded.');
    return;
  }

  const floors = levelExt.floorSelector.floorData;

  if (!floors.length) {
    console.warn('BimWalk.jumpToFloor - No floor data available');
    return;
  }

  const floor = floors[floorIndex];

  if (floor) {
    const camera = this.viewer.impl.camera;

    // Floor plus eye height (Should be 1.80m).
    let height = floor.zMin + this.get('cameraDistanceFromFloor') * this.metersToModel;

    // In case the ceiling is lower than 1.80m, we don't want to jump accidentally to the next level,
    // So in that case, just set the camera in the middle of the floor.
    if (height >= floor.zMax) {
      height = (floor.zMin + floor.zMax) / 2;
    }

    const pos = camera.position.clone().setZ(height);

    this.teleportInitial.copy(camera.position);
    this.teleportTarget.copy(pos);
    this.teleporting = true;
    this.teleportTime = 0;
  } else {
    console.warn('BimWalk.jumpToFloor - the given floor index is not available.');
  }
};

/**
 *
 *
 */
proto.getCursor = function () {

  if (this.get('mouseTurnInverted')) {

    if (this.turningWithMouse) {
      return 'url(data:image/x-icon;base64,AAABAAEAICAAAAEAIACoEAAAFgAAACgAAAAgAAAAQAAAAAEAIAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAcAAAAHgAAABwAAAAJAAAAAQAAABQAAAAbAQEBBwEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8ACAgIfD4+PuVbW1vkUFBQ4hkZGY4BAQFRNTU1yiUlJdMAAAAyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMlJSWxwMDA//b29v/u7u7/fn5+9j09PejDw8P/ZmZm6gAAAC8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQGBgYlI+Pj/r5+fn/+/v7///////v7+//5OTk//v7+/+Ghob2AAAAXiUlJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACRISEoWHh4f59/f3//b29v+dnZ3/4eHh/5+fn//j4+P/oKCg/8PDw/9AQEDPAAAALAMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEBAQAAFBQVecXFx8vLy8v//////8PDw/2hoaP/Pz8//ampq/9TU1P9paWn/4uLi/7Kysv8dHR2cAAAABwEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQEAAAAADi8vL7jV1dX////////////w8PD/aGho/83Nzf9qamr/19fX/2lpaf/i4uL/9fX1/1tbW+MAAAAqAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEBAQAAAAAbUlJS3/Dw8P/39/f/9vb2//X19f+enp7/3t7e/56env/m5ub/np6e/+zs7P//////gICA8gAAAEgBAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAAAAABM1NTXGpqam/3V1df+wsLD///////r6+v/9/f3/+vr6//7+/v/6+vr//v7+//////+IiIj0AAAAUgQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQUFBT0RERGQJSUl5tLS0v/29vb//Pz8///////////////////////09PT//////4mJifQAAABTBQUFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADVgYGDo6Ojo/3l5ef/c3Nz/+Pj4/6Wlpf/r6+v/+Pj4/3x8fP+4uLj/eHh48gAAAEoCAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQEAAAAAWktLS/OEhIT7JSUl9sTExP/g4OD/Ozs7/7q6uv/b29v/MzMz4CQkJMIgICClAAAAGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOCQkJWAgICGUICAhxTk5O3lhYWOQLCwujOjo6ykdHR9sMDAxoAAAAEQAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAACMAAAAmAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAApAAAALwAAAAkAAAAVAAAAGgAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATBQUFvg0NDdEAAABFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwdHR3jgoKC/xsbG9cAAABFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHCAgIOPg4OD/o6Oj/xoaGtYAAABFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcHBwc48jIyP/i4uL/goKC/wsLC9EAAAAjAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4FBQWmHBwc5CAgIOMdHR3kBQUFvQAAACIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAAcAAAAHAAAABwAAAATAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////wB///8Af//+AH///AB///gAP//4AB//8AAf//AAH//wAB//8AAf//wAH//8AB///AA//h+A//4f///+D////gf///4D///+A////wP///////////////////////////////////////8=), auto';
    } else {
      return 'url(data:image/x-icon;base64,AAABAAEAICAAAAEAIACoEAAAFgAAACgAAAAgAAAAQAAAAAEAIAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAABQAAAAcAAAAHgAAABoAAAAHAAAAAgAAABYAAAAaAQEBBQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALDQ0Nn0xMTOVbW1vkS0tL3hISEn0GBgZaODg40h8fH8wAAAAhAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAAAAACg6OjrR3Nzc//X19f/o6Oj/bGxs80hISOnHx8f/U1NT4wAAAB0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfJycns62trf7+/v7/+/v7//7+/v/s7Oz/5ubm//f39/90dHTxAAAASgwMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADyAgIKSlpaX+/v7+//X19f+dnZ3/4eHh/5+fn//j4+P/oKCg/7e3t/8zMzPBAAAAIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGNjYwAFBQVkgICA9/v7+///////8PDw/2hoaP/Pz8//ampq/9TU1P9paWn/4eHh/6Ghof4TExOIAAAAAwEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKD8/P9Dd3d3////////////w8PD/aGho/83Nzf9qamr/19fX/2lpaf/i4uL/7e3t/01NTdkAAAAhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYjIyOrsLCw///////9/f3///////X19f+enp7/3t7e/56env/m5ub/nZ2d/+vr6///////f39/8gAAAEoEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAqKioACwsLaoqKivz+/v7/6+vr/5mZmf/w8PD///////r6+v/9/f3/+/v7//7+/v/w8PD/29vb//////+cnJz9CgoKbCAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJiYmAAVFRWHoqKi/93d3f9qamr9V1dX/vT09P/+/v7////////////+/v7//////+7u7v+ampr/9fX1/76+vv8cHByTAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgoKAAMDAzcmJiazLy8vuQkJCcaSkpL+9fX1/5ubm/7u7u7/9/f3/6Kiov/s7Oz/8fHx/2JiYv/MzMz/5ubm/zo6OsYAAAATAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAwAAAAhNDQ0v9ra2v/e3t7/Pz8//ePj4//y8vL/YGBg/9jY2P/09PT/SUlJ/3d3d//z8/P/YWFh5wAAACgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgoKAAAAAEt3d3fy/////6enp/8sLCz95ubm/vLy8v9eXl7/zs7O//Pz8/9NTU3uISEhy5eXl/9LS0vgAAAAJwEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGhoajrm5uf/7+/v/X19f+CUlJe7o6Oj/8vLy/1lZWf+/v7//8vLy/1BQUN0AAABCERERhAoKClsAAAAGAQEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQbGxuXrKys/6ioqP8aGhqtJycnvuHh4f/w8PD/RERE/HJycvysrKz/KysrtAAAAA0DAwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAjAAAAJgAAAAEAAAAADg4OAAUFBTcdHR2jGRkZmQAAACYXFxeGmJiY/7Gxsf8lJSW7DAwMfRkZGZMFBQU4FhYWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEwUFBb4NDQ3RAAAARQAAAAAAAAAAAAAAAAAAAAgAAAAHBAQEAAEBASIXFxeKHBwclgUFBTUAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcHR0d44KCgv8bGxvXAAAARQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwgICDj4ODg/6Ojo/8aGhrWAAAARQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHBwcHOPIyMj/4uLi/4KCgv8LCwvRAAAAIwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBQUFphwcHOQgICDjHR0d5AUFBb0AAAAiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAHAAAABwAAAAcAAAAEwAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA///////////////////////8AP///AD///wA///4AP//8AB///AAP//gAD//wAA//8AAP//AAB//wAAf/8AAH//wAB//4AAf/+AA//wwAf/8OQv//B+f//wP///8B////Af///4H//////////////////////////////////8=), auto';
    }
  } else {
    return "url(data:image/x-icon;base64,AAABAAEAICAAAAEAIACoEAAAFgAAACgAAAAgAAAAQAAAAAEAIAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAP//////////////////////////////////////////////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAP8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA///////+P////j////4////+P////j////4////+P////j////4////+P////j////4////////AA+ABwAPgAcAD4AH///////4////+P////j////4////+P////j////4////+P////j////4////+P////j////////////8=) 16 16, auto";
  }
};

proto.ignoreInput = function () {

  return this.teleporting;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleButtonDown = function (event, button) {
  if (this.viewer.navigation.getIsLocked()) {
    return true;
  }
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, this.viewer, this.mousePosition);

  if (button === 0) {

    this.turningWithMouse = true;
    this.turnMouseDelta.set(0, 0, 0);
  }

  return true;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleButtonUp = function (event, button) {

  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, this.viewer, this.mousePosition);

  if (button === 0) {
    this.turningWithMouse = false;
  }

  return true;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleMouseClick = function (event, button) {

  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, this.viewer, this.mousePosition);
  return false;
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleMouseDoubleClick = function (event, button) {

  // Other than skipping the internal logic here, we consume the event so DefaultHandler won't trigger fitToView.
  if (this.tool.options.disableBimWalkFlyTo) {
    return true;
  }

  var onFloorFound = function (intersection) {

    this.teleporting = true;
    this.teleportTime = 0;

    var camera = this.viewer.impl.camera;

    // Set intial position to current camera position.
    this.teleportInitial.copy(camera.position);

    // Set target position, collision plus camera's height.
    var cameraUp = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.worldup);
    cameraUp.multiplyScalar(this.get('cameraDistanceFromFloor') * this.metersToModel);

    this.teleportTarget.copy(intersection.intersectPoint).add(cameraUp);

    // On floor teleport ends on the spot.
    this.teleportVelocity.set(0, 0, 0);
  }.bind(this);

  var onWallFound = function (intersection) {

    var viewer = this.viewer;
    var camera = this.viewer.impl.camera;
    var metersToModel = this.metersToModel;
    var cameraDistanceFromFloor = this.get('cameraDistanceFromFloor');
    var feetToCameraDelta = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.worldup).multiplyScalar(cameraDistanceFromFloor * metersToModel);

    // Set intial position to current camera position.
    var initial = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.position);

    // Set target position to collision displaced the teleport distance at floor level.
    var direction = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(intersection.intersectPoint);
    direction.sub(camera.position);
    (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.setWorldUpComponent)(camera, direction, 0).normalize();

    var target = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(intersection.intersectPoint);
    target.add(direction.multiplyScalar(this.get('teleportWallDistance') * metersToModel));
    target.add(feetToCameraDelta);

    // Get floor candidates.
    var candidates = [];
    var minAllowedRoofDistance = this.get('minAllowedRoofDistance');
    var bigAllowedVerticalStep = this.get('bigAllowedVerticalStep');
    var minFloorSidesLengthForBigVerticalStep = this.get('minFloorSidesLengthForBigVerticalStep');

    var bestCandidateIndex = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getFloorCandidates)(
      target,
      cameraDistanceFromFloor * metersToModel,
      minAllowedRoofDistance * metersToModel,
      0,
      bigAllowedVerticalStep * metersToModel,
      minFloorSidesLengthForBigVerticalStep * metersToModel,
      viewer,
      candidates);

    // There is no floor, so there is no falling at all, keeping same camera height.
    if (bestCandidateIndex === -1) {
      return;
    }

    // Target is the best floor candidate displaced by the distance from floor.
    target.copy(candidates[bestCandidateIndex].point).add(feetToCameraDelta);

    this.teleporting = true;
    this.teleportTime = 0;
    this.teleportInitial.copy(initial);
    this.teleportTarget.copy(target);
  }.bind(this);

  var onPointCloudFound = function (intersection) {

    var intersectPoint = intersection.intersectPoint;
    if (!intersectPoint) {
      return;
    }

    var camera = this.viewer.impl.camera;
    var metersToModel = this.metersToModel;

    var initial = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.position);

    var direction = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(intersectPoint);
    direction.sub(camera.position);
    var approachDistance = direction.length();
    if (approachDistance <= EPSILON) {
      return;
    }
    direction.normalize();

    var standoff = Math.min(
      this.get('teleportPointCloudDistance') * metersToModel,
      approachDistance
    );

    // When the hit is closer than the standoff distance the target collapses
    // back to the current camera position, so skip the no-op teleport.
    if (approachDistance - standoff <= EPSILON) {
      return;
    }

    // Stop short of the hit, back toward the camera along the approach ray.
    var target = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(intersectPoint);
    target.sub(direction.multiplyScalar(standoff));

    this.teleporting = true;
    this.teleportTime = 0;
    this.teleportInitial.copy(initial);
    this.teleportTarget.copy(target);
    this.teleportVelocity.set(0, 0, 0);
  }.bind(this);

  if (this.teleporting) {
    return true;
  }
  var viewer = this.viewer;
  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, viewer, this.mousePosition);

  var mousePosition = this.mousePosition;
  var viewerportPosition = viewer.impl.clientToViewport(mousePosition.x, mousePosition.y);
  var camera = viewer.impl.camera;

  // No intersection with geometry.
  var intersection = viewer.impl.castRayViewport(viewerportPosition, false, false, false);
  if (intersection) {
    if (intersection.model.isRCS()) {
      onPointCloudFound(intersection);
    } else if (intersection.face) {
      if ((0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.isFloorIntersection)(intersection, camera)) {
        onFloorFound(intersection);
      }

      if ((0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.isWallIntersection)(intersection, camera)) {
        onWallFound(intersection);
      }
    }
  }

  return true;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleMouseMove = function (event) {

  var prevMousePosition = this.mousePosition;
  var currMousePosition = temporalMousePosition;

  (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, this.viewer, currMousePosition);

  if (this.turningWithMouse) {

    if (this.get('mouseTurnInverted')) {
      this.turnMouseDelta.x += currMousePosition.x - prevMousePosition.x;
      this.turnMouseDelta.y += currMousePosition.y - prevMousePosition.y;
    } else {
      this.turnMouseDelta.x -= currMousePosition.x - prevMousePosition.x;
      this.turnMouseDelta.y -= currMousePosition.y - prevMousePosition.y;
    }
  }

  this.mousePosition.copy(currMousePosition);
  return this.turningWithMouse;
};

function getNormalizedPointersDistance(viewer, event)
{
  var rect = viewer.impl.getCanvasBoundingClientRect();
  var dx = (event.pointers[1].clientX - event.pointers[0].clientX) / rect.width;
  var dy = (event.pointers[1].clientY - event.pointers[0].clientY) / rect.height;
  return Math.sqrt(dx * dx + dy * dy);
}

proto.shouldOrbit = function () {
  const floorCandidate = this.getBestFloorCandidate();

  if (!floorCandidate) {
    return true; // There is no floor beneath us - fallback to regular pinch from the orbit tool.
  }

  const bounds = this.viewer.impl.getVisibleBounds();
  const pos = this.viewer.getCamera().position;
  const cameraInBounds = bounds.containsPoint(pos);

  // If there is a floor beneath us, but the camera is outside of the visible bounds,
  // it means that we are way above the model itself. In that case - use regular orbit.
  return !cameraInBounds;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleGesture = function (event) {

  // Convert Hammer touch-event X,Y into mouse-event X,Y.
  if (event.pointers && event.pointers.length > 0) {
    event.pageX = event.pointers[0].pageX;
    event.pageY = event.pointers[0].pageY;
  }

  var handled = false;

  switch (event.type) {
    case "dragstart":
      this.ignoreGravity = true;
      if (this.shouldOrbit()) {
        return false;
      }

      this.isDragging = true;

      // Single touch, fake the mouse for now...
      handled = this.handleButtonDown(event, 0);
      break;

    case "dragmove":
      if (!this.isDragging) return false;

      handled = this.handleMouseMove(event);
      break;

    case "dragend":
      if (!this.isDragging) return false;

      this.isDragging = false;

      handled = this.handleButtonUp(event, 0);
      break;

    case "panstart":
    case "pinchstart":
      this.ignoreGravity = true;
      if (this.shouldOrbit()) {
        return false;
      }

      this.isPinching = true;

      this.lastPinchDistance = getNormalizedPointersDistance(this.viewer, event);
      (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, this.viewer, this.mousePosition);
      this.lastPanPosition.copy(this.mousePosition);

      return true;

    case "panmove":
    case "pinchmove":{

        if (!this.isPinching) return false;

        const rect = this.viewer.impl.getCanvasBoundingClientRect();
        const cameraVector = this.tool.camera.worldup;
        const cameraForward = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getForward)(this.tool.camera);
        const cameraRight = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(cameraForward).cross(cameraVector).normalize();

        // Calculate forward distance.
        const pinchDistance = getNormalizedPointersDistance(this.viewer, event);
        const targetDistance = pinchDistance - this.lastPinchDistance;

        const targetPosition = this.viewer.impl.clientToViewport(this.mousePosition.x, this.mousePosition.y);
        this.viewer.impl.viewportToRay(targetPosition, this.mouseForwardDirection);
        const direction = this.mouseForwardDirection.direction;
        direction.sub((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(cameraVector).multiplyScalar(cameraVector.dot(direction)));
        direction.normalize();

        this.moveMouseVelocity.copy(direction.multiplyScalar(targetDistance * this.get('pinchDistanceMultiplier')));

        // Calculate vertical and horizontal panning vectors.
        (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getMousePosition)(event, this.viewer, temporalMousePosition);

        let panRatio = (temporalMousePosition.y - this.lastPanPosition.y) / rect.height;
        this.moveUpDownKeyboardVelocity.copy(cameraVector).multiplyScalar(panRatio * this.get('panDistanceMultiplier'));

        panRatio = (temporalMousePosition.x - this.lastPanPosition.x) / rect.width;
        this.moveKeyboardVelocity.copy(cameraRight).multiplyScalar(-panRatio * this.get('panDistanceMultiplier'));

        // Update camera now.
        this.immediateDisplacement = true;
        this.tool.update();
        this.immediateDisplacement = false;

        // Update values for next touch event.
        this.lastPinchDistance = pinchDistance;
        this.lastPanPosition.copy(temporalMousePosition);
        this.moveUpDownKeyboardVelocity.set(0, 0, 0);
        this.moveMouseVelocity.set(0, 0, 0);
        this.moveKeyboardVelocity.set(0, 0, 0);

        return true;
      }
    case "panend":
    case "pinchend":
      if (!this.isPinching) return false;

      this.isPinching = false;
      return true;

    // Disable rotation
    case "rotatestart":
    case "rotatemove":
    case "rotateend":
      this.ignoreGravity = true;
      return true;
  }

  return handled;
};

/**
 *
 * @param event
 * @param keyCode
 * @returns {boolean}
 */
proto.handleKeyDown = function (event, keyCode) {

  var handled = true;
  switch (keyCode) {
    case this.keys.SHIFT:
      this.running = true;
      break;

    case this.keys.DASH:{
        const topSpeed = this.get('topWalkSpeed') - 1;
        this.tool.set('topWalkSpeed', topSpeed);
        break;
      }

    case this.keys.EQUALS:
    case this.keys.PLUS:
    case this.keys.PLUSMOZ:{
        const topSpeed = this.get('topWalkSpeed') + 1;
        this.tool.set('topWalkSpeed', topSpeed);
        break;
      }

    case this.keys.CONTROL:
    case this.keys.ALT:
      break;

    case this.keys.SPACE:
      this.enableGravity(!this.gravityEnabled);
      break;

    case this.keys.UP:
    case this.keys.w:
      this.moveForward = 1.0;
      break;

    case this.keys.LEFT:
      this.turnLeft = 1.0;
      break;

    case this.keys.RIGHT:
      this.turnRight = 1.0;
      break;

    case this.keys.DOWN:
    case this.keys.s:
      this.moveBackward = 1.0;
      break;

    case this.keys.a:
      this.moveLeft = 1.0;
      break;

    case this.keys.d:
      this.moveRight = 1.0;
      break;

    case this.keys.e:
      this.moveUp = 1.0;
      break;

    case this.keys.q:
      this.moveDown = 1.0;
      break;

    default:
      handled = false;
      break;
  }

  this.running = event.shiftKey;
  if (this.ui.onKeyDown) {
    handled |= this.ui.onKeyDown(event, keyCode);

  }

  return handled;
};

proto.getBestFloorCandidate = function () {
  var viewer = this.viewer;
  var camera = this.viewer.impl.camera;
  var metersToModel = this.metersToModel;
  var cameraDistanceFromFloor = this.get('cameraDistanceFromFloor');

  var target = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.position);
  target.add((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.worldup).multiplyScalar(1.5 * metersToModel));

  // Get floor candidates.
  var candidates = [];
  var minFloorSidesLengthForBigVerticalStep = this.get('minFloorSidesLengthForBigVerticalStep');

  var bestCandidateIndex = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_2__.getFloorCandidates)(
    target,
    cameraDistanceFromFloor * metersToModel,
    Number.MAX_SAFE_INTEGER,
    0,
    0,
    minFloorSidesLengthForBigVerticalStep * metersToModel,
    viewer,
    candidates);

  if (bestCandidateIndex === -1) {
    return null;
  }

  return candidates[bestCandidateIndex];
};

/**
 *
 * @param event
 * @param keyCode
 * @returns {boolean}
 */
proto.handleKeyUp = function (event, keyCode) {

  var moveToFloor = function () {
    var camera = this.viewer.impl.camera;
    var metersToModel = this.metersToModel;
    var cameraDistanceFromFloor = this.get('cameraDistanceFromFloor');
    var feetToCameraDelta = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.worldup).multiplyScalar(cameraDistanceFromFloor * metersToModel);

    // Set intial position to current camera position.
    var initial = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.position);

    var target = (0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.position);
    target.add((0,_BimWalkPools_js__WEBPACK_IMPORTED_MODULE_1__.getTempVector)(camera.worldup).multiplyScalar(1.5 * metersToModel));

    // Get floor candidates.

    var bestCandidate = this.getBestFloorCandidate();

    // There is no floor, so there is no falling at all, keeping same camera height.
    if (!bestCandidate) {
      return;
    }

    // Target is the best floor candidate displaced by the distance from floor.
    target.copy(bestCandidate.point).add(feetToCameraDelta);

    this.teleporting = true;
    this.teleportTime = 0;
    this.teleportInitial.copy(initial);
    this.teleportTarget.copy(target);
  }.bind(this);

  var handled = true;
  var moveUp = this.moveUp;
  var moveDown = this.moveDown;

  switch (keyCode) {

    case this.keys.SHIFT:
      this.running = false;
      break;

    case this.keys.CONTROL:
    case this.keys.ALT:
      break;

    case this.keys.SPACE:
      break;

    case this.keys.UP:
    case this.keys.w:
      this.moveForward = 0;
      break;

    case this.keys.LEFT:
      this.turnLeft = 0;
      break;

    case this.keys.RIGHT:
      this.turnRight = 0;
      break;

    case this.keys.DOWN:
    case this.keys.s:
      this.moveBackward = 0;
      break;

    case this.keys.a:
      this.moveLeft = 0;
      break;

    case this.keys.d:
      this.moveRight = 0;
      break;

    case this.keys.e:
      this.moveUp = 0;
      break;

    case this.keys.q:
      this.moveDown = 0;
      break;

    default:
      handled = false;
      break;
  }

  if (this.moveUp === 0 && this.moveDown === 0 && (this.moveUp !== moveUp || this.moveDown !== moveDown)) {
    // If gravity is disabled, just keep current altitude.
    if (this.gravityEnabled) {
      moveToFloor();
    }
  }

  this.running = event.shiftKey;
  return handled;
};

/**
 * Calculates a target from the passed in delta and assignes it to the this.moveMouseTargetDistance variable.
 * @param {number} delta
 * @returns {boolean}
 */
proto.applyDeltaToMouseTargetDistance = function (delta) {
  // Add delta to target distance until filling the maximum allowed.
  var curTargetDistance = this.moveMouseTargetDistance;
  var maxTargetDistance = this.get('mouseWalkMaxTargetDistance');

  var MAGIC_NUMBER = 0.5;
  var target = Math.min(maxTargetDistance, Math.abs(curTargetDistance + delta * MAGIC_NUMBER)) * (delta > 0 ? 1 : -1);

  this.moveMouseTargetDistance = target;
  return true;
};

/**
 *
 * @param delta
 * @returns {boolean}
 */
proto.handleWheelInput = function (delta) {
  if (this.viewer.navigation.getIsLocked()) {
    return true;
  }
  // If user changes wheel direction, target distance switches directions.
  if (this.tool.navapi.getReverseZoomDirection()) {
    delta *= -1;
  }
  return this.applyDeltaToMouseTargetDistance(delta);
};

/**
 *
 * @param event
 * @param button
 * @returns {boolean}
 */
proto.handleSingleClick = function (event, button) {

  return false;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleSingleTap = function (event) {

  return false;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleDoubleTap = function (event) {

  return true;
};

/**
 *
 * @param event
 * @returns {boolean}
 */
proto.handleBlur = function (event) {

  // Reset things when we lose focus...
  this.moveForward = this.moveBackward = 0;
  this.moveLeft = this.moveRight = 0;
  this.moveUp = this.moveDown = 0;

  return false;
};

/***/ },

/***/ "./extensions/BimWalk/UI/NavigatorMobileJoystick.js"
/*!**********************************************************!*\
  !*** ./extensions/BimWalk/UI/NavigatorMobileJoystick.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavigatorMobileJoystick: () => (/* binding */ NavigatorMobileJoystick)
/* harmony export */ });
/* harmony import */ var _NavigatorMobileJoystick_css__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NavigatorMobileJoystick.css */ "./extensions/BimWalk/UI/NavigatorMobileJoystick.css");


const av = Autodesk.Viewing;

function NavigatorMobileJoystick(viewer, navigator, options) {

  var _viewer = viewer;
  this.setGlobalManager(viewer.globalManager);

  var _navigator = navigator;
  var _options = options || {};

  var _joystickContainer = null;
  var _joystickHandle = null;
  var _joystickBackCircle = null;

  var _arrowUp = null;
  var _arrowDown = null;
  var _arrowLeft = null;
  var _arrowRight = null;

  var _backCircleRadius = _options.backCircleRadius || 75;
  var _frontCircleRadius = _options.frontCircleRadius || 37.5;
  var _xOffsetFromCorner = _options.xOffsetFromCorner || 100;
  var _yOffsetFromCorner = _options.yOffsetFromCorner || 100;
  var _threshold = _options.threshold || 0.1;
  var _joystickCenter = null;

  var _isDragging = false;

  _navigator.reverseDrag = -1;

  this.updateJoystickHandlePosition = function (x, y) {
    var v = new THREE.Vector2(x - _joystickCenter.x, y - _joystickCenter.y);
    var length = Math.min(v.length(), _frontCircleRadius);
    v.normalize();
    v.multiplyScalar(length);
    v.add(_joystickCenter);

    _joystickHandle.style.left = v.x - _frontCircleRadius + 'px';
    _joystickHandle.style.top = v.y - _frontCircleRadius + 'px';

    return v;
  };

  this.changeJoystickColor = function (isFocused) {
    if (isFocused) {
      _joystickHandle.classList.toggle('focus', true);
      _joystickBackCircle.classList.toggle('focus', true);
      _joystickHandle.classList.remove('transition');
    } else {
      _joystickHandle.classList.remove('focus');
      _joystickBackCircle.classList.remove('focus');
      _joystickHandle.classList.toggle('transition', true);
    }
  };

  this.updateNavigator = function (pos) {
    if (!pos) {
      return;
    }

    var horizontalDelta = (_joystickCenter.x - pos.x) / _backCircleRadius;
    var verticalDelta = (_joystickCenter.y - pos.y) / _backCircleRadius;

    _navigator.moveForward = 0;
    _navigator.moveBackward = 0;
    _navigator.moveLeft = 0;
    _navigator.moveRight = 0;
    _navigator.turningWithKeyboard = false;

    if (verticalDelta > _threshold) {
      _navigator.moveForward = verticalDelta;
    } else
    if (verticalDelta < -_threshold) {
      _navigator.moveBackward = -verticalDelta;
    }

    if (horizontalDelta > _threshold) {
      _navigator.moveLeft = horizontalDelta;
      _navigator.turningWithKeyboard = true;
    } else
    if (horizontalDelta < -_threshold) {
      _navigator.moveRight = -horizontalDelta;
      _navigator.turningWithKeyboard = true;
    }

    // Set blue color only for arrows that are currently active.
    this.updateArrowColor(_arrowUp, _navigator.moveForward !== 0);
    this.updateArrowColor(_arrowDown, _navigator.moveBackward !== 0);
    this.updateArrowColor(_arrowLeft, _navigator.moveLeft !== 0);
    this.updateArrowColor(_arrowRight, _navigator.moveRight !== 0);
  };

  this.handleGesture = function (event) {
    var pos = null;

    switch (event.type) {

      case "dragstart":
        _isDragging = true;
        this.changeJoystickColor(true);
        pos = this.updateJoystickHandlePosition(event.center.x, event.center.y);
        _navigator.ignoreGravity = false;
        break;

      case "dragmove":
        if (_isDragging) {
          this.changeJoystickColor(true);
          pos = this.updateJoystickHandlePosition(event.center.x, event.center.y);
        }
        break;

      case "dragend":
        if (_isDragging) {
          this.changeJoystickColor(false);
          pos = this.updateJoystickHandlePosition(_joystickCenter.x, _joystickCenter.y);
          _isDragging = false;
        }
        break;
    }

    this.updateNavigator(pos);
    event.preventDefault();
  };

  this.setJoystickPosition = function (x, y) {
    _joystickHandle.classList.remove('transition');

    var viewerBounds = _viewer.impl.getCanvasBoundingClientRect();
    x += viewerBounds.left;
    y += viewerBounds.top;

    _joystickCenter = new THREE.Vector2(x, y);
    _joystickHandle.style.left = _joystickCenter.x - _frontCircleRadius + 'px';
    _joystickHandle.style.top = _joystickCenter.y - _frontCircleRadius + 'px';
    _joystickContainer.style.left = _joystickCenter.x - _backCircleRadius + 'px';
    _joystickContainer.style.top = _joystickCenter.y - _backCircleRadius + 'px';
  };

  this.setJoystickRelativePosition = function (x = _xOffsetFromCorner, y = _yOffsetFromCorner) {
    _xOffsetFromCorner = x;
    _yOffsetFromCorner = y;

    var centerX = _viewer.container.clientWidth - _backCircleRadius - _xOffsetFromCorner;
    var centerY = _viewer.container.clientHeight - _backCircleRadius - _yOffsetFromCorner;
    this.setJoystickPosition(centerX, centerY);
  };

  this.setJoystickPositionRelativeToCorner = function () {
    this.setJoystickRelativePosition();
  };

  this.setJoystickSize = function (backgroundRadius, handleRadius) {
    _backCircleRadius = backgroundRadius;
    _joystickContainer.style.width = _backCircleRadius * 2 + 'px';
    _joystickContainer.style.height = _backCircleRadius * 2 + 'px';

    _frontCircleRadius = handleRadius;
    _joystickHandle.style.width = _frontCircleRadius * 2 + 'px';
    _joystickHandle.style.height = _frontCircleRadius * 2 + 'px';

    if (_joystickCenter) {
      this.setJoystickPosition(_joystickCenter.x, _joystickCenter.y);
    }
  };

  this.updateArrowColor = function (arrow, isActive) {
    if (isActive && !arrow.classList.contains('active')) {
      arrow.classList.add('active');
    } else if (!isActive && arrow.classList.contains('active')) {
      arrow.classList.remove('active');
    }
  };

  this.init = function () {
    if (!_joystickContainer) {
      const _document = this.getDocument();
      // joystick container
      _joystickContainer = _document.createElement('div');
      _joystickContainer.className = 'mobile-joystick';
      _viewer.container.appendChild(_joystickContainer);
      _joystickContainer.classList.add(_viewer.theme);

      // joystick background circle
      _joystickBackCircle = _document.createElement('div');
      _joystickBackCircle.className = 'mobile-joystick mobile-joystick-back-circle';
      _joystickContainer.appendChild(_joystickBackCircle);

      // joystick handle
      _joystickHandle = _document.createElement('div');
      _joystickHandle.className = 'mobile-joystick mobile-joystick-handle';
      this.changeJoystickColor(false);
      _joystickContainer.appendChild(_joystickHandle);

      const innerCircle = _document.createElement('div');
      innerCircle.className = 'mobile-joystick mobile-joystick-inner-circle';
      _joystickHandle.appendChild(innerCircle);

      /// Arrows
      _arrowUp = _document.createElement('div');
      _arrowUp.className = 'mobile-joystick-arrow arrow-up';
      _joystickContainer.appendChild(_arrowUp);

      _arrowRight = _document.createElement('div');
      _arrowRight.className = 'mobile-joystick-arrow arrow-right';
      _joystickContainer.appendChild(_arrowRight);

      _arrowDown = _document.createElement('div');
      _arrowDown.className = 'mobile-joystick-arrow arrow-down';
      _joystickContainer.appendChild(_arrowDown);

      _arrowLeft = _document.createElement('div');
      _arrowLeft.className = 'mobile-joystick-arrow arrow-left';
      _joystickContainer.appendChild(_arrowLeft);

      this.setJoystickSize(_backCircleRadius, _frontCircleRadius);
      this.setJoystickPositionRelativeToCorner();

      var av = Autodesk.Viewing;
      this.hammer = new av.Hammer.Manager(_joystickHandle, {
        recognizers: [
        av.GestureRecognizers.drag],

        handlePointerEventMouse: false,
        inputClass: av.Hammer.TouchInput
      });

      this.hammer.on("dragstart dragmove dragend", this.handleGesture.bind(this));

      this.onOrientationChanged = this.setJoystickPositionRelativeToCorner.bind(this);
    }
  };

  this.init();

  this.activate = function () {
    this.updateJoystickHandlePosition(_joystickCenter.x, _joystickCenter.y);
    _joystickContainer.classList.toggle('visible', true);
    _viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onOrientationChanged);
  };

  this.deactivate = function () {
    _joystickContainer.classList.remove('visible');
    _isDragging = false;
    _viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onOrientationChanged);
  };
}

av.GlobalManagerMixin.call(NavigatorMobileJoystick.prototype);

/***/ },

/***/ "./extensions/BimWalk/UI/NavigatorSimple.js"
/*!**************************************************!*\
  !*** ./extensions/BimWalk/UI/NavigatorSimple.js ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavigatorSimple: () => (/* binding */ NavigatorSimple)
/* harmony export */ });
/* harmony import */ var _NavigatorSimpleGuide_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NavigatorSimpleGuide.js */ "./extensions/BimWalk/UI/NavigatorSimpleGuide.js");
/* harmony import */ var _NavigatorSimple_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./NavigatorSimple.css */ "./extensions/BimWalk/UI/NavigatorSimple.css");



var AutodeskViewing = Autodesk.Viewing;

function NavigatorSimple(navigator) {
  this.viewer = navigator.viewer;
  this.setGlobalManager(this.viewer.globalManager);
  this.tool = navigator.tool;
  this.opened = false;
  this.hideTimeoutID;
  this.dontRemindAgain_Message = false;
  this.tooltip = new _NavigatorSimpleGuide_js__WEBPACK_IMPORTED_MODULE_0__.NavigatorSimpleGuide(this);
  var translate = Autodesk.Viewing.i18n.translate;

  var html =
  '<div class="bimwalk">' +
  '<div id = "tooltip-info" class= "tooltip-info">' +
  '<div id = "info-icon" class = "info-icon">' +
  '</div>' +
  '</div>' +
  '<div id = "speed" class= "message-panel docking-panel docking-panel-container-solid-color-b speed">' +
  '<table>' +
  '<tbody>' +
  '<tr>' +
  '<td class="name" data-i18n="Walk Speed">' + translate('Walk Speed') + '</td>' +
  '<td class="value"></td>' +
  '</tr>' +
  '</tbody>' +
  '</table>' +
  '</div>' +
  '</div>';

  const _document = this.getDocument();
  var div = _document.createElement('div');
  div.innerHTML = html;

  this.div = div.childNodes[0];
  this.infoIcon = this.div.childNodes[0];
  this.onSpeedChange = this.onSpeedChange.bind(this);

  // Hide info icon if not wanted
  if (this.tool.options.disableBimWalkInfoIcon) {
    this.infoIcon.style.visibility = 'hidden';
  }
}

var proto = NavigatorSimple.prototype;
AutodeskViewing.GlobalManagerMixin.call(proto);

//Info guide and speedUI gets activated
proto.activate = function () {

  this.viewer.container.appendChild(this.div);
  this.viewer.addEventListener(AutodeskViewing.EVENT_BIMWALK_CONFIG_CHANGED, this.onSpeedChange);

  //Hide viewCube, home, and info button
  this.viewer.getExtension("Autodesk.ViewCubeUi", function (ext) {
    ext.displayViewCube(false);
    ext.displayHomeButton(false);
  });

  if (!AutodeskViewing.isMobileDevice()) {
    var infoButton = this.div.querySelector('#tooltip-info');
    infoButton.classList.add('open');

    var self = this;
    infoButton.addEventListener('click', function () {
      self.tooltip.showToolTipUI(true);
    });
  }

  //Check if don't show remind message is set or not
  if (this.viewer.getBimWalkToolPopup()) {
    this.tooltip.showToolTipUI(false);
  }
};

//Info guide and speedUI gets deactivated
proto.deactivate = function () {
  this.viewer.removeEventListener(AutodeskViewing.EVENT_BIMWALK_CONFIG_CHANGED, this.onSpeedChange);
  this.speedHide();

  var target = this.div.querySelector('#speed');
  target.classList.remove('open');

  if (!AutodeskViewing.isMobileDevice()) {
    //Hide Navigation information
    var target1 = this.div.querySelector('#tooltip-info');
    target1.classList.remove('open');

    this.tooltip.hideToolTipUI();
  }

  this.viewer.getExtension("Autodesk.ViewCubeUi", function (ext) {
    //show viewCube, home, and info button
    ext.displayViewCube(true);
    ext.displayHomeButton(true);
  });

};

proto.isDialogOpen = function () {
  return this.tooltip.opened;
};

proto.onKeyDown = function () {
  if (this.tooltip.opened) {
    this.tooltip.hideToolTipUI();
    return true;
  }
  return false;
};

proto.onSpeedChange = function (event) {
  if (event.data.configuration !== 'topWalkSpeed') {
    return;
  }

  var self = this;

  var speedPanel = this.div.querySelector('#speed');
  speedPanel.classList.add('open');

  var speedValue = this.div.querySelector('.value');
  speedValue.textContent = event.data.value;

  this.hideTimeoutID = setTimeout(function () {
    self.speedHide();
  }, 5000);
  self.opened = true;
};

proto.speedHide = function () {
  var self = this;
  if (self.opened) {
    var target = this.div.querySelector('#speed');
    target.classList.remove('open');

    self.opened = false;
    clearTimeout(this.hideTimeoutID);
  }
};

proto.showInfoIcon = function (show) {
  const visibility = show ? '' : 'hidden';
  this.infoIcon.style.visibility = visibility;
};

/***/ },

/***/ "./extensions/BimWalk/UI/NavigatorSimpleGuide.js"
/*!*******************************************************!*\
  !*** ./extensions/BimWalk/UI/NavigatorSimpleGuide.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   NavigatorSimpleGuide: () => (/* binding */ NavigatorSimpleGuide)
/* harmony export */ });
/* harmony import */ var _guide_html__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./guide.html */ "./extensions/BimWalk/UI/guide.html");


const av = Autodesk.Viewing;
const avp = av.Private;

function NavigatorSimpleGuide(navigator) {
  this.viewer = navigator.viewer;
  this.setGlobalManager(this.viewer);
  this.tool = navigator.tool;
  this.onTemplate = this.onTemplate.bind(this);
  const _document = this.getDocument();
  this.div = _document.createElement('div'); // Div that holds all content
  this.opened = false;

  this.onTemplate(null, _guide_html__WEBPACK_IMPORTED_MODULE_0__);
}

var proto = NavigatorSimpleGuide.prototype;
av.GlobalManagerMixin.call(proto);

proto.showToolTipUI = function (openedByUser) {
  this.viewer.container.appendChild(this.div);

  // Avoid showing panel when preference prevents us.
  var dontRemind = this.div.querySelector('#dontRemind');
  dontRemind.style.display = openedByUser ? "none" : "";

  var tooltipPanel = this.div.querySelector('#tooltipPanel');
  tooltipPanel.classList.add('c-bimwalk-tooltip--open');

  this.opened = true;
};

proto.hideToolTipUI = function () {
  var tooltipPanel = this.div.querySelector('#tooltipPanel');
  tooltipPanel.classList.remove('c-bimwalk-tooltip--open');

  this.opened = false;
};

proto.onTemplate = function (err, content) {
  if (err) {
    avp.logger.error('Failed to show BimWalk guide.');
    return;
  }

  const _document = this.getDocument();
  var tmp = _document.createElement('div');
  tmp.innerHTML = content;
  this.div.appendChild(tmp.childNodes[0]); // Assumes template has only 1 root node.

  var tooltipOK = this.div.querySelector('#tooltipOk');
  tooltipOK.addEventListener('click', this.hideToolTipUI.bind(this));

  var dontRemind = this.div.querySelector('#dontRemind');
  dontRemind.addEventListener('click', function () {
    this.viewer.setBimWalkToolPopup(false);
    this.hideToolTipUI.bind(this);
  }.bind(this));

  this.div.addEventListener('click', function () {
    this.hideToolTipUI();
  }.bind(this));

  // Localize only strings from the newly added DOM
  Autodesk.Viewing.i18n.localize(this.div);
};

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/BimWalk/UI/NavigatorMobileJoystick.css"
/*!***********************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/BimWalk/UI/NavigatorMobileJoystick.css ***!
  \***********************************************************************************************************************************************************************************************************************************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../../node_modules/css-loader/dist/runtime/getUrl.js */ "./node_modules/css-loader/dist/runtime/getUrl.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);
// Imports



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iIzA2OTZENyIvPgo8L3N2Zz4K */ "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iIzA2OTZENyIvPgo8L3N2Zz4K"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iI0JCQkJCQiIvPgo8L3N2Zz4K */ "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iI0JCQkJCQiIvPgo8L3N2Zz4K"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-viewing-viewer .mobile-joystick.visible {
  display: block;
}

.adsk-viewing-viewer .mobile-joystick {
  pointer-events: none;
  display: none;
  position: fixed;
  z-index: 10;
}

.adsk-viewing-viewer .mobile-joystick-handle.transition {
  transition: 0.2s;
}

.adsk-viewing-viewer .dark-theme .mobile-joystick-handle {
  border-color: rgba(0, 0, 0, 0.4);
}

.adsk-viewing-viewer .mobile-joystick-handle {
  pointer-events: all;
  border-radius: 100%;
  border-radius: 100%;
  border: 20px solid;
  border-color: rgba(180, 180, 180, 0.55);
  box-sizing: border-box;
  display: inherit;
  position: fixed;
  z-index: 12;
}

.adsk-viewing-viewer .dark-theme .mobile-joystick-inner-circle {
  background-color: #3C3C3C;
}

.adsk-viewing-viewer .mobile-joystick-inner-circle {
  width: 100%;
  height: 100%;
  display: block;
  position: absolute;
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: 100%;
}

.adsk-viewing-viewer .dark-theme .mobile-joystick-back-circle {
  background: rgba(0, 0, 0, 0.7);
}

.adsk-viewing-viewer .mobile-joystick-back-circle {
  display: block;
  width: 100%;
  height: 100%;
  position: absolute;
  border-radius: 100%;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.adsk-viewing-viewer .mobile-joystick-arrow.active {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
}

.adsk-viewing-viewer .mobile-joystick-arrow {
  position: absolute;
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});
  background-repeat: no-repeat;
  background-size: contain;
  z-index: 11;
  width: 20px;
  height: 20px;
}

.adsk-viewing-viewer .mobile-joystick-arrow.arrow-up {
  left: 50%;
  transform: translate(-50%, 50%);
}

.adsk-viewing-viewer .mobile-joystick-arrow.arrow-right {
  left: 100%;
  top: 50%;
  transform: translate(-150%, -50%) rotate(90deg);
}

.adsk-viewing-viewer .mobile-joystick-arrow.arrow-down {
  left: 50%;
  top: 100%;
  transform: translate(-50%, -150%) rotate(180deg);
}

.adsk-viewing-viewer .mobile-joystick-arrow.arrow-left {
  top: 50%;
  transform: translate(50%, -50%) rotate(270deg);
}`, ""]);
// Exports
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);


/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/BimWalk/UI/NavigatorSimple.css"
/*!***************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/BimWalk/UI/NavigatorSimple.css ***!
  \***************************************************************************************************************************************************************************************************************************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../../node_modules/css-loader/dist/runtime/getUrl.js */ "./node_modules/css-loader/dist/runtime/getUrl.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);
// Imports



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! icon-information.svg */ "./extensions/BimWalk/UI/icon-information.svg"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.adsk-viewing-viewer .bimwalk .speed {
  min-width: 0;
  min-height: 0;
  display: block;
  position: absolute;
  left: calc(50% - 83px);
  top: 30px;
  width: 160px;
  height: 34px;
  opacity: 0;
  transform: translate(0, 10px);
  pointer-events: none;
  webkit-transition: opacity 0.5s ease-in-out, transform 0.5s ease-in-out;
  -moz-transition: opacity 0.5s ease-in-out, transform 0.5s ease-in-out;
  -ms-transition: opacity 0.5 ease-in-out, transform 0.5s ease-in-out;
  -o-transition: opacity 0.5s ease-in-out, transform 0.5s ease-in-out;
  transition: opacity 0.5s ease-in-out, transform 0.5s ease-in-out;
}

.adsk-viewing-viewer .bimwalk .speed-text {
  padding-top: 8px;
}

.adsk-viewing-viewer .bimwalk .speed.open {
  opacity: 1;
  pointer-events: all;
  transform: translate(0, 0);
}

.adsk-viewing-viewer .bimwalk .tooltip-info {
  display: block;
  position: absolute;
  right: 12px;
  cursor: pointer;
  top: 10px;
  opacity: 0;
  width: 30px;
  height: 30px;
  background-color: rgba(34, 34, 34, 0.4);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  transition: opacity 0.2s ease;
  z-index: 1;
  pointer-events: none;
}

.adsk-viewing-viewer .bimwalk .info-icon {
  display: block;
  width: 24px;
  height: 24px;
  margin: 2.5px 2.5px 2.5px 2.5px;
  background: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
  background-size: contain;
}

.adsk-viewing-viewer .bimwalk .tooltip-info.open {
  opacity: 0.7;
  pointer-events: all;
}

.adsk-viewing-viewer .bimwalk .tooltip-info:hover {
  opacity: 1;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  opacity: 0;
  pointer-events: none;
  overflow: auto;
  z-index: 6;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip--open {
  opacity: 1;
  pointer-events: all;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip * {
  box-sizing: border-box !important;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__content {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 620px;
  height: 520px;
  transform: translate(-50%, -50%);
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__title {
  font-size: 16px;
  font-weight: bold;
  display: block;
  text-align: center;
  margin-bottom: 20px;
  line-height: 19px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__close {
  position: absolute;
  top: 5px;
  right: -30px;
  cursor: pointer;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__row {
  clear: left;
  height: 135px;
  margin-bottom: 5px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip {
  border-radius: 5px;
  padding: 28px 0;
  width: 100%;
  position: relative;
  text-align: center;
  font-size: 0;
  height: 135px;
  display: block;
  float: left;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip + .c-bimwalk-tooltip__tip {
  margin-left: 5px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__subtitle {
  position: absolute;
  left: 14px;
  top: 12px;
  font-size: 14px;
  font-weight: bold;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__instruction {
  position: absolute;
  height: 31px;
  left: 14px;
  bottom: 6px;
  font-size: 12px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--walk {
  padding: 26px 14px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--walk svg {
  height: 79px;
  display: inline-block;
  margin: 0 26px;
}

.adsk-viewing-viewer .bimwalk .bimwalk-tooltip-or {
  font-size: 12px;
  font-weight: bold;
  position: absolute;
  bottom: 27px;
  left: 50%;
  transform: translateX(-50%);
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--updown {
  padding: 53px 0 45px;
  width: 307px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--updown svg {
  height: 37px;
  display: block;
  margin: 0 auto;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--run {
  padding: 53px 0 45px;
  width: 308px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__shift {
  height: 37px;
  display: inline-block;
  margin: 0;
  vertical-align: middle;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__plus {
  width: 11px;
  display: inline-block;
  margin: 0 16px 0 19px;
  vertical-align: middle;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__direction {
  font-size: 12px;
  font-weight: bold;
  display: inline-block;
  position: relative;
  top: 4px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--teleport {
  width: 203px;
  padding: 45px 0 44px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--teleport svg {
  height: 46px;
  display: block;
  margin: 0 auto;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--look {
  width: 204px;
  padding: 37px 0;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--look svg {
  height: 56px;
  display: block;
  margin: 0 auto;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--speed {
  width: 203px;
  padding: 55px 0 45px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__tip--speed svg {
  height: 36px;
  display: block;
  margin: 0 auto;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__actions {
  text-align: center;
  margin-top: 35px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__action {
  display: inline-block;
  width: 240px;
}

.adsk-viewing-viewer .bimwalk .c-bimwalk-tooltip__action + .c-bimwalk-tooltip__action {
  margin-left: 1px;
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

/***/ "./extensions/BimWalk/UI/NavigatorMobileJoystick.css"
/*!***********************************************************!*\
  !*** ./extensions/BimWalk/UI/NavigatorMobileJoystick.css ***!
  \***********************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorMobileJoystick_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./NavigatorMobileJoystick.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/BimWalk/UI/NavigatorMobileJoystick.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorMobileJoystick_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorMobileJoystick_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorMobileJoystick_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorMobileJoystick_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


/***/ },

/***/ "./extensions/BimWalk/UI/NavigatorSimple.css"
/*!***************************************************!*\
  !*** ./extensions/BimWalk/UI/NavigatorSimple.css ***!
  \***************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorSimple_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./NavigatorSimple.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/BimWalk/UI/NavigatorSimple.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorSimple_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorSimple_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorSimple_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NavigatorSimple_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "./extensions/BimWalk/UI/icon-information.svg"
/*!****************************************************!*\
  !*** ./extensions/BimWalk/UI/icon-information.svg ***!
  \****************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+Cjxzdmcgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCIgdmlld0JveD0iMCAwIDI0IDI0IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiPgogICAgPHRpdGxlPmljb24taW5mb3JtYXRpb248L3RpdGxlPgogICAgPGRlc2M+Q3JlYXRlZCB3aXRoIFNrZXRjaC48L2Rlc2M+CiAgICA8ZGVmcz48L2RlZnM+CiAgICA8ZyBpZD0iU3ltYm9scyIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiIGZpbGw9Im5vbmUiIGZpbGwtcnVsZT0iZXZlbm9kZCI+CiAgICAgICAgPGcgaWQ9Imljb24taW5mb3JtYXRpb24iIGZpbGw9IiNmZmZmZmYiPgogICAgICAgICAgICA8cGF0aCBkPSJNMTMuNzUsMTEuMTQ4NDM3NSBDMTMuNzUsMTAuNzk2ODc1IDEzLjYzMjgxMjUsMTAuNTYyNSAxMy41MTU2MjUsMTAuMjEwOTM3NSBDMTMuMjgxMjUsOS42MjUgMTIuNjk1MzEyNSw5LjI3MzQzNzUgMTEuODc1LDkuMjczNDM3NSBDMTEuMTcxODc1LDkuMjczNDM3NSAxMC41ODU5Mzc1LDkuNjI1IDEwLjIzNDM3NSwxMC4yMTA5Mzc1IEMxMC4xMTcxODc1LDEwLjU2MjUgMTAsMTAuNzk2ODc1IDEwLDExLjE0ODQzNzUgTDEwLDE4LjI5Njg3NSBMMTAuMjM0Mzc1LDE5LjIzNDM3NSBDMTAuNTg1OTM3NSwxOS44MjAzMTI1IDExLjA1NDY4NzUsMjAuMTcxODc1IDExLjg3NSwyMC4xNzE4NzUgQzEyLjY5NTMxMjUsMjAuMTcxODc1IDEzLjE2NDA2MjUsMTkuODIwMzEyNSAxMy41MTU2MjUsMTkuMjM0Mzc1IEwxMy43NSwxOC4yOTY4NzUgTDEzLjc1LDExLjE0ODQzNzUgTDEzLjc1LDExLjE0ODQzNzUgWiBNMTMuNzUsNS43NTc4MTI1IEMxMy43NSw1LjI4OTA2MjUgMTMuNTE1NjI1LDQuODIwMzEyNSAxMy4xNjQwNjI1LDQuNDY4NzUgQzEyLjgxMjUsNC4xMTcxODc1IDEyLjQ2MDkzNzUsNCAxMS45OTIxODc1LDQgQzExLjUyMzQzNzUsNCAxMS4wNTQ2ODc1LDQuMTE3MTg3NSAxMC43MDMxMjUsNC40Njg3NSBDMTAuMzUxNTYyNSw0LjgyMDMxMjUgMTAuMjM0Mzc1LDUuMjg5MDYyNSAxMC4yMzQzNzUsNS43NTc4MTI1IEMxMC4yMzQzNzUsNi4yMjY1NjI1IDEwLjM1MTU2MjUsNi42OTUzMTI1IDEwLjcwMzEyNSw3LjA0Njg3NSBDMTEuMDU0Njg3NSw3LjM5ODQzNzUgMTEuNTIzNDM3NSw3LjUxNTYyNSAxMS45OTIxODc1LDcuNTE1NjI1IEMxMi40NjA5Mzc1LDcuNTE1NjI1IDEyLjkyOTY4NzUsNy4zOTg0Mzc1IDEzLjE2NDA2MjUsNy4wNDY4NzUgQzEzLjYzMjgxMjUsNi42OTUzMTI1IDEzLjc1LDYuMjI2NTYyNSAxMy43NSw1Ljc1NzgxMjUgWiIgaWQ9IlNoYXBlIj48L3BhdGg+CiAgICAgICAgPC9nPgogICAgPC9nPgo8L3N2Zz4=";

/***/ },

/***/ "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iI0JCQkJCQiIvPgo8L3N2Zz4K"
/*!******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iI0JCQkJCQiIvPgo8L3N2Zz4K ***!
  \******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iI0JCQkJCQiIvPgo8L3N2Zz4K";

/***/ },

/***/ "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iIzA2OTZENyIvPgo8L3N2Zz4K"
/*!******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iIzA2OTZENyIvPgo8L3N2Zz4K ***!
  \******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxNiAxMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE1LjE1NjEgOS4xNDk3TDE1LjE0OTUgOS4xNTYyN0wxNS4xNDMzIDkuMTYzMDdDMTUuMDQxMiA5LjI3MzgzIDE0LjkxOSA5LjM2MDI2IDE0Ljc4NDkgOS40MTc4MkMxNC42NTA4IDkuNDc1MzcgMTQuNTA3MyA5LjUwMzA5IDE0LjM2MzQgOS40OTk3M0wxNC4zNjM0IDkuNDk5NTNMMTQuMzQ5MyA5LjQ5OTZDMTQuMjAyNyA5LjUwMDMxIDE0LjA1NzEgOS40NzA3OCAxMy45MjA4IDkuNDEyMjVDMTMuNzg0NCA5LjM1MzcgMTMuNjU5NSA5LjI2NzA4IDEzLjU1NCA5LjE1NjU4TDEzLjU1MjkgOS4xNTU0M0wxMC4wMDIxIDUuNDYwMzhMMTAuMDAwOSA1LjQ1ODkyTDkuOTU5NTEgNS40MDg0QzkuOTIzOTQgNS4zNjUyOCA5Ljg3Mjk4IDUuMzA0MTEgOS44MTA2MiA1LjIzMDg4QzkuNjg2MzEgNS4wODQ5MSA5LjUxNDc2IDQuODg4NzIgOS4zMjgyMyA0LjY5MTE3QzkuMTQzODQgNC40OTU4OSA4LjkzNDk4IDQuMjg4NzUgOC43MzcxMiA0LjEyNjg1QzguNjM4NyA0LjA0NjMyIDguNTMxNiAzLjk2NzUyIDguNDIzMDIgMy45MDY0NkM4LjMyNzU0IDMuODUyNzYgOC4xNzAyNSAzLjc3NzE5IDcuOTg2NTcgMy43NzcxOUM3LjgwMjg5IDMuNzc3MTkgNy42NDU2IDMuODUyNzYgNy41NTAxMiAzLjkwNjQ2QzcuNDQxNTQgMy45Njc1MiA3LjMzNDQ0IDQuMDQ2MzIgNy4yMzYwMiA0LjEyNjg1QzcuMDM4MTYgNC4yODg3NSA2LjgyOTMgNC40OTU4OSA2LjY0NDkxIDQuNjkxMTdDNi40NTgzOCA0Ljg4ODcyIDYuMjg2ODMgNS4wODQ5MSA2LjE2MjUzIDUuMjMwODhDNi4xMDAxNyA1LjMwNDExIDYuMDQ5MjEgNS4zNjUyOCA2LjAxMzYzIDUuNDA4NEw1Ljk3MjIgNS40NTg5Mkw1Ljk3MTQ5IDUuNDU5NzhMMi40MDYwNyA5LjE0NzQzQzIuMTg5NTkgOS4zNTMyMSAxLjkwODE3IDkuNDYyMzMgMS42MjA2OCA5LjQ1NzA5QzEuMzMwNTYgOS40NTE3OSAxLjA1MDI5IDkuMzMwMzEgMC44Mzk5NSA5LjExMjc2QzAuNjI5MTAyIDguODk0NjkgMC41MDU1NiA4LjU5NzEzIDAuNTAwMTgzIDguMjgxOTRDMC40OTQ4NTMgNy45Njk1IDAuNjA2MTU3IDcuNjY5ODQgMC44MDY0MTIgNy40NDQ0OUw3LjE4NDU4IDAuODQ3NjYxQzcuMjkyMTQgMC43MzkzODcgNy40MTczNiAwLjY1MzQ4NCA3LjU1MzUzIDAuNTkzNjA1TDcuNTUzNTMgMC41OTM2MTVMNy41NTY1NiAwLjU5MjI1N0M3LjY5MjkgMC41MzEyMTYgNy44MzkxOSAwLjUgNy45ODY1NyAwLjVDOC4xMzM5NSAwLjUgOC4yODAyNCAwLjUzMTIxNiA4LjQxNjU4IDAuNTkyMjU2TDguNDE2NTcgMC41OTIyNjdMOC40MTk2MiAwLjU5MzYwNUM4LjU1NTY1IDAuNjUzNDI4IDguNjgwNzYgMC43MzkyMjQgOC43ODgyNSAwLjg0NzM1NEwxNS4xNTA5IDcuNDUwNzZMMTUuMTUwOSA3LjQ1MDhMMTUuMTU2MSA3LjQ1NjAxQzE1LjI2MzggNy41NjQ2MSAxNS4zNTA0IDcuNjk1MzYgMTUuNDA5OCA3Ljg0MTAxQzE1LjQ2OTIgNy45ODY2OSAxNS41IDguMTQzNzcgMTUuNSA4LjMwMjg2QzE1LjUgOC40NjE5NCAxNS40NjkyIDguNjE5MDMgMTUuNDA5OCA4Ljc2NDdDMTUuMzUwNCA4LjkxMDM1IDE1LjI2MzggOS4wNDExIDE1LjE1NjEgOS4xNDk3WiIgZmlsbD0iIzA2OTZENyIvPgo8L3N2Zz4K";

/***/ },

/***/ "./extensions/BimWalk/UI/guide.html"
/*!******************************************!*\
  !*** ./extensions/BimWalk/UI/guide.html ***!
  \******************************************/
(module) {

"use strict";
module.exports = "<div class=\"bimwalk\">\n    <div id=\"tooltipPanel\" class=\"c-bimwalk-tooltip\">\n        <div id=\"tooltipContainer\" class=\"c-bimwalk-tooltip__content\">\n            <span class=\"c-bimwalk-tooltip__title\" data-i18n=\"Navigate in First Person\">Navigate in First Person</span>\n\n            <div id=\"dark-theme\" class=\"bimwalk-guide-dark-theme\">\n                <div class=\"c-bimwalk-tooltip__row\">\n                    <div class=\"docking-panel-close c-bimwalk-tooltip__close\"></div>\n\n                    <div id=\"tooltipMove\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--walk docking-panel-container-solid-color-c\">\n                        <span id=\"moveTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Walk\">Walk</span>\n\n                        <span id=\"tooltipOR\" class=\"bimwalk-tooltip-or\" data-i18n=\"OR\">OR</span>\n\n                        <svg width=\"124px\" height=\"81px\" viewBox=\"0 0 124 81\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-arrows\">\n                                    <rect id=\"Rectangle-3\" fill=\"#FFFFFF\" x=\"44\" y=\"0\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-3\" fill=\"#FFFFFF\" x=\"44\" y=\"45\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-5\" fill=\"#FFFFFF\" x=\"88\" y=\"45\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"45\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <polygon id=\"Triangle\" fill=\"#4E4E4E\" points=\"62.0951782 6 67.1903564 14.7272727 57 14.7272727\"></polygon>\n                                    <polygon id=\"Triangle-Copy\" fill=\"#4E4E4E\" transform=\"translate(62.095178, 69.363636) scale(1, -1) translate(-62.095178, -69.363636) \" points=\"62.0951782 65 67.1903564 73.7272727 57 73.7272727\"></polygon>\n                                    <polygon id=\"Triangle-Copy-2\" fill=\"#4E4E4E\" transform=\"translate(106.095178, 63.363636) scale(1, -1) rotate(90.000000) translate(-106.095178, -63.363636) \" points=\"106.095178 59 111.190356 67.7272727 101 67.7272727\"></polygon>\n                                    <polygon id=\"Triangle-Copy-2\" fill=\"#4E4E4E\" transform=\"translate(18.095178, 63.363636) scale(-1, -1) rotate(90.000000) translate(-18.095178, -63.363636) \" points=\"18.0951782 59 23.1903564 67.7272727 13 67.7272727\"></polygon>\n                                </g>\n                            </g>\n                        </svg>\n\n                        <svg width=\"124px\" height=\"80px\" viewBox=\"0 0 124 80\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-wasd\">\n                                    <rect id=\"Rectangle-3\" fill=\"#FFFFFF\" x=\"44\" y=\"0\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-3\" fill=\"#FFFFFF\" x=\"44\" y=\"44\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-5\" fill=\"#FFFFFF\" x=\"88\" y=\"44\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"44\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <polygon id=\"W\" fill=\"#4E4E4E\" points=\"58.2353516 13 59.5683594 18.7695312 59.8554688 20.3759766 60.1494141 18.8037109 61.2841797 13 63.5058594 13 64.7021484 18.7695312 65.0097656 20.3759766 65.3173828 18.8310547 66.6640625 13 68.8037109 13 65.9667969 23.0761719 63.9570312 23.0761719 62.7402344 17.1835938 62.3847656 15.2353516 62.0292969 17.1835938 60.8125 23.0761719 58.8574219 23.0761719 56 13\"></polygon>\n                                    <path d=\"M60.0097656,65.2597656 C60.073568,65.7200544 60.1988923,66.0641265 60.3857422,66.2919922 C60.7275408,66.7067078 61.3131469,66.9140625 62.1425781,66.9140625 C62.6393254,66.9140625 63.0426417,66.8593755 63.3525391,66.75 C63.9404326,66.5403635 64.234375,66.150719 64.234375,65.5810547 C64.234375,65.2483707 64.0885431,64.9908863 63.796875,64.8085938 C63.5052069,64.6308585 63.0472036,64.4736335 62.4228516,64.3369141 L61.3564453,64.0976562 C60.308263,63.8606759 59.5836609,63.6031915 59.1826172,63.3251953 C58.5035773,62.8603492 58.1640625,62.1334685 58.1640625,61.1445312 C58.1640625,60.242183 58.4921842,59.492516 59.1484375,58.8955078 C59.8046908,58.2984996 60.7685483,58 62.0400391,58 C63.1018933,58 64.007646,58.2814099 64.7573242,58.8442383 C65.5070024,59.4070666 65.9000649,60.223953 65.9365234,61.2949219 L63.9130859,61.2949219 C63.8766274,60.6887991 63.6123071,60.2581393 63.1201172,60.0029297 C62.7919905,59.8343091 62.384117,59.75 61.8964844,59.75 C61.354164,59.75 60.9212256,59.8593739 60.5976562,60.078125 C60.2740869,60.2968761 60.1123047,60.6022116 60.1123047,60.9941406 C60.1123047,61.3541685 60.2718083,61.623046 60.5908203,61.8007812 C60.7958995,61.9192714 61.2333951,62.0582674 61.9033203,62.2177734 L63.6396484,62.6347656 C64.40072,62.8170582 64.974933,63.0608709 65.3623047,63.3662109 C65.9638702,63.8401716 66.2646484,64.5260372 66.2646484,65.4238281 C66.2646484,66.3444056 65.9126012,67.1088837 65.2084961,67.7172852 C64.504391,68.3256866 63.5097721,68.6298828 62.2246094,68.6298828 C60.9121028,68.6298828 59.8798866,68.3302439 59.1279297,67.730957 C58.3759728,67.1316702 58,66.3079479 58,65.2597656 L60.0097656,65.2597656 Z\" id=\"S\" fill=\"#4E4E4E\"></path>\n                                    <path d=\"M104.043945,59.75 L104.043945,66.3261719 L105.985352,66.3261719 C106.978846,66.3261719 107.671548,65.8362679 108.063477,64.8564453 C108.27767,64.3186822 108.384766,63.6783891 108.384766,62.9355469 C108.384766,61.9101511 108.224123,61.1228869 107.902832,60.5737305 C107.581541,60.0245741 106.942388,59.75 105.985352,59.75 L104.043945,59.75 Z M107.899414,58.21875 C108.605798,58.451173 109.177732,58.8772755 109.615234,59.4970703 C109.966148,59.9983749 110.205403,60.5406872 110.333008,61.1240234 C110.460613,61.7073597 110.524414,62.2633437 110.524414,62.7919922 C110.524414,64.1318426 110.255537,65.2665969 109.717773,66.1962891 C108.988603,67.4495505 107.862963,68.0761719 106.34082,68.0761719 L102,68.0761719 L102,58 L106.34082,58 C106.965172,58.0091146 107.484698,58.0820306 107.899414,58.21875 Z\" id=\"D\" fill=\"#4E4E4E\"></path>\n                                    <path d=\"M16.4658203,64.2685547 L19.0224609,64.2685547 L17.7646484,60.3037109 L16.4658203,64.2685547 Z M16.5957031,58 L18.9746094,58 L22.5429688,68.0761719 L20.2597656,68.0761719 L19.6103516,66.0048828 L15.8984375,66.0048828 L15.2011719,68.0761719 L13,68.0761719 L16.5957031,58 Z\" id=\"A\" fill=\"#4E4E4E\"></path>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n                </div>\n\n                <div class=\"c-bimwalk-tooltip__row\">\n                    <div id=\"tooltipUpDown\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--updown docking-panel-container-solid-color-c\" >\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Go Up and Down\">Go Up and Down</span>\n\n                        <span id=\"instruction\" class=\"c-bimwalk-tooltip__instruction\" data-i18n=\"Release key to land on the nearest floor\">Release key to land on the nearest floor.</span>\n\n                        <svg width=\"123px\" height=\"37px\" viewBox=\"0 0 123 37\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"First-Person\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"1st-Person-Guides---Desktop-1\" transform=\"translate(-297.000000, -339.000000)\">\n                                    <g id=\"Group-5\" transform=\"translate(297.000000, 339.000000)\">\n                                        <g id=\"Group-7-Copy\" transform=\"translate(22.000000, 0.321429)\">\n                                            <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"5.68434189e-15\" width=\"36\" height=\"35.7428571\" rx=\"4\"></rect>\n                                            <path d=\"M18.5097656,21.7910156 C18.6328131,21.7591144 18.7900381,21.7021488 18.9814453,21.6201172 L17.9628906,20.6494141 L19.0498047,19.5146484 L20.0683594,20.4853516 C20.2278654,20.1572249 20.3395179,19.8701184 20.4033203,19.6240234 C20.5035812,19.254881 20.5537109,18.8242212 20.5537109,18.3320312 C20.5537109,17.2018173 20.3224307,16.3279653 19.8598633,15.7104492 C19.3972959,15.0929331 18.7216841,14.7841797 17.8330078,14.7841797 C16.9990193,14.7841797 16.3336613,15.0804007 15.8369141,15.6728516 C15.3401668,16.2653024 15.0917969,17.1516868 15.0917969,18.3320312 C15.0917969,19.7128975 15.4472621,20.7018199 16.1582031,21.2988281 C16.6184919,21.6861999 17.1699187,21.8798828 17.8125,21.8798828 C18.0540377,21.8798828 18.2864572,21.8502607 18.5097656,21.7910156 Z M22.3310547,20.4375 C22.1533194,21.0162789 21.8912778,21.4970684 21.5449219,21.8798828 L22.7070312,22.9667969 L21.6064453,24.1152344 L20.3896484,22.9667969 C20.020506,23.1901053 19.7014987,23.3473303 19.4326172,23.4384766 C18.9814431,23.5888679 18.4414094,23.6640625 17.8125,23.6640625 C16.4999934,23.6640625 15.4153689,23.2721393 14.5585938,22.4882812 C13.5195261,21.5449172 13,20.1595143 13,18.3320312 C13,16.4908762 13.5331978,15.0986375 14.5996094,14.1552734 C15.4700564,13.3850873 16.5524024,13 17.8466797,13 C19.1500716,13 20.2438107,13.4078735 21.1279297,14.2236328 C22.1487681,15.1669969 22.6591797,16.4863196 22.6591797,18.1816406 C22.6591797,19.0794316 22.5498058,19.8313772 22.3310547,20.4375 Z\" id=\"Q\" fill=\"#4E4E4E\"></path>\n                                        </g>\n                                        <g id=\"Group-7-Copy-2\" transform=\"translate(65.000000, 0.321429)\">\n                                            <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"5.68434189e-15\" width=\"36\" height=\"35.7428571\" rx=\"4\"></rect>\n                                            <polygon id=\"E\" fill=\"#4E4E4E\" points=\"21.3896484 14.7841797 16.0576172 14.7841797 16.0576172 16.9238281 20.9521484 16.9238281 20.9521484 18.6738281 16.0576172 18.6738281 16.0576172 21.2646484 21.6357422 21.2646484 21.6357422 23.0761719 14 23.0761719 14 13 21.3896484 13\"></polygon>\n                                        </g>\n                                        <g id=\"Group-4\" opacity=\"0.6\" transform=\"translate(5.000000, 18.192857) scale(1, -1) translate(-5.000000, -18.192857) translate(0.000000, 7.271429)\" fill=\"#FFFFFF\">\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 8.439286) rotate(90.000000) translate(-5.000000, -8.439286) \" x=\"0.5\" y=\"6.45357143\" width=\"9\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 16.382143) rotate(90.000000) translate(-5.000000, -16.382143) \" x=\"3.5\" y=\"14.3964286\" width=\"3\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 20.850000) rotate(90.000000) translate(-5.000000, -20.850000) \" x=\"4\" y=\"18.8642857\" width=\"2\" height=\"3.97142857\"></rect>\n                                            <polygon id=\"_Path_2\" transform=\"translate(5.000000, 2.482143) rotate(-90.000000) translate(-5.000000, -2.482143) \" points=\"2.5 7.44642857 2.5 -2.48214286 7.5 2.48214286\"></polygon>\n                                        </g>\n                                        <g id=\"Group-4-Copy\" opacity=\"0.6\" transform=\"translate(118.000000, 18.192857) scale(1, -1) rotate(-180.000000) translate(-118.000000, -18.192857) translate(113.000000, 7.271429)\" fill=\"#FFFFFF\">\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 8.439286) rotate(90.000000) translate(-5.000000, -8.439286) \" x=\"0.5\" y=\"6.45357143\" width=\"9\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 16.382143) rotate(90.000000) translate(-5.000000, -16.382143) \" x=\"3.5\" y=\"14.3964286\" width=\"3\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 20.850000) rotate(90.000000) translate(-5.000000, -20.850000) \" x=\"4\" y=\"18.8642857\" width=\"2\" height=\"3.97142857\"></rect>\n                                            <polygon id=\"_Path_2\" transform=\"translate(5.000000, 2.482143) rotate(-90.000000) translate(-5.000000, -2.482143) \" points=\"2.5 7.44642857 2.5 -2.48214286 7.5 2.48214286\"></polygon>\n                                        </g>\n                                    </g>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n\n                    <div id=\"tooltipRun\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--run docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Run\">Run</span>\n\n                        <svg width=\"72px\" height=\"36px\" viewBox=\"0 0 72 36\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" class=\"c-bimwalk-tooltip__shift\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-shift\">\n                                    <rect id=\"Rectangle-3-Copy-10\" fill=\"#FFFFFF\" x=\"0\" y=\"0\" width=\"72\" height=\"36\" rx=\"4\"></rect>\n                                    <path d=\"M11.4267578,24.6210938 C11.4677736,24.9674496 11.5566399,25.2135409 11.6933594,25.359375 C11.934897,25.6191419 12.3815072,25.7490234 13.0332031,25.7490234 C13.4160175,25.7490234 13.7202137,25.6920579 13.9458008,25.578125 C14.1713878,25.4641921 14.2841797,25.2932954 14.2841797,25.0654297 C14.2841797,24.8466786 14.1930348,24.6803391 14.0107422,24.5664062 C13.8284496,24.4524734 13.1516986,24.2565118 11.9804688,23.9785156 C11.1373656,23.7688792 10.542645,23.5068375 10.1962891,23.1923828 C9.84993316,22.8824854 9.67675781,22.4358753 9.67675781,21.8525391 C9.67675781,21.1643846 9.94677464,20.5730819 10.4868164,20.0786133 C11.0268582,19.5841447 11.786779,19.3369141 12.7666016,19.3369141 C13.6962937,19.3369141 14.4539359,19.5226218 15.0395508,19.894043 C15.6251657,20.2654641 15.9612626,20.9068965 16.0478516,21.8183594 L14.0996094,21.8183594 C14.0722655,21.5677071 14.0016282,21.3694669 13.8876953,21.2236328 C13.6735015,20.9593086 13.3089218,20.8271484 12.7939453,20.8271484 C12.3701151,20.8271484 12.0681975,20.8932285 11.8881836,21.0253906 C11.7081697,21.1575527 11.6181641,21.3124991 11.6181641,21.4902344 C11.6181641,21.7135428 11.7138662,21.875325 11.9052734,21.9755859 C12.0966806,22.0804042 12.7734317,22.2604154 13.9355469,22.515625 C14.7102903,22.6979176 15.2913392,22.973631 15.6787109,23.3427734 C16.0615254,23.7164732 16.2529297,24.1835909 16.2529297,24.7441406 C16.2529297,25.4824256 15.9783556,26.0851214 15.4291992,26.5522461 C14.8800428,27.0193708 14.0312557,27.2529297 12.8828125,27.2529297 C11.7115827,27.2529297 10.8468452,27.0056991 10.2885742,26.5112305 C9.7303032,26.0167619 9.45117188,25.3867226 9.45117188,24.6210938 L11.4267578,24.6210938 Z M23.0581055,19.5966797 C23.4340839,19.7561857 23.7428373,19.9999984 23.984375,20.328125 C24.1894542,20.6061212 24.3147784,20.8920884 24.3603516,21.1860352 C24.4059247,21.4799819 24.4287109,21.9596321 24.4287109,22.625 L24.4287109,27 L22.4394531,27 L22.4394531,22.4677734 C22.4394531,22.0667298 22.3710944,21.7431653 22.234375,21.4970703 C22.0566397,21.1507144 21.7194035,20.9775391 21.2226562,20.9775391 C20.7076797,20.9775391 20.3168959,21.1495751 20.050293,21.4936523 C19.7836901,21.8377296 19.6503906,22.3287729 19.6503906,22.9667969 L19.6503906,27 L17.7089844,27 L17.7089844,16.9580078 L19.6503906,16.9580078 L19.6503906,20.5195312 C19.9329441,20.0865864 20.2599265,19.7846688 20.6313477,19.6137695 C21.0027688,19.4428702 21.3935526,19.3574219 21.8037109,19.3574219 C22.2639997,19.3574219 22.682127,19.4371737 23.0581055,19.5966797 Z M28.25,18.6601562 L26.2744141,18.6601562 L26.2744141,16.8623047 L28.25,16.8623047 L28.25,18.6601562 Z M26.2744141,19.5488281 L28.25,19.5488281 L28.25,27 L26.2744141,27 L26.2744141,19.5488281 Z M33.2197266,16.831543 C33.3199875,16.8383789 33.4567049,16.8486327 33.6298828,16.8623047 L33.6298828,18.4482422 C33.5205073,18.4345702 33.3370781,18.4243164 33.0795898,18.4174805 C32.8221016,18.4106445 32.644369,18.4676101 32.5463867,18.5883789 C32.4484045,18.7091477 32.3994141,18.8424472 32.3994141,18.9882812 L32.3994141,19.6171875 L33.6777344,19.6171875 L33.6777344,20.9912109 L32.3994141,20.9912109 L32.3994141,27 L30.4580078,27 L30.4580078,20.9912109 L29.3710938,20.9912109 L29.3710938,19.6171875 L30.4375,19.6171875 L30.4375,19.1386719 C30.4375,18.3411418 30.5719388,17.7919937 30.8408203,17.4912109 C31.1233738,17.0445941 31.8046821,16.8212891 32.8847656,16.8212891 C33.0078131,16.8212891 33.1194656,16.824707 33.2197266,16.831543 Z M34.0332031,21.0048828 L34.0332031,19.6171875 L35.0722656,19.6171875 L35.0722656,17.5390625 L37,17.5390625 L37,19.6171875 L38.2099609,19.6171875 L38.2099609,21.0048828 L37,21.0048828 L37,24.9423828 C37,25.2477229 37.0387366,25.4379879 37.1162109,25.5131836 C37.1936853,25.5883793 37.4306621,25.6259766 37.8271484,25.6259766 C37.8863935,25.6259766 37.9490557,25.6248373 38.0151367,25.6225586 C38.0812178,25.6202799 38.1461585,25.616862 38.2099609,25.6123047 L38.2099609,27.0683594 L37.2871094,27.1025391 C36.3665319,27.1344403 35.7376319,26.9749367 35.4003906,26.6240234 C35.1816395,26.400715 35.0722656,26.0566429 35.0722656,25.5917969 L35.0722656,21.0048828 L34.0332031,21.0048828 Z\" id=\"shift\" fill=\"#4E4E4E\"></path>\n                                </g>\n                            </g>\n                        </svg>\n\n                        <svg width=\"32px\" height=\"32px\" viewBox=\"0 0 32 32\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" class=\"c-bimwalk-tooltip__plus\">\n                            <path d=\"m 12,12 -10,0 0,8 10,0 0,10 8,0 0,-10 10,0 0,-8 -10,0 0,-10 -8,0 z\" fill=\"#ffffff\"></path>\n                        </svg>\n\n                        <span id=\"directionKey\" class=\"c-bimwalk-tooltip__direction\" data-i18n=\"Direction Key\">Direction Key</span>\n                    </div>\n                </div>\n\n                <div class=\"c-bimwalk-tooltip__row\">\n                    <div id=\"tooltipTeleport\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--teleport docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Teleport\">Teleport</span>\n\n                        <span id=\"instruction\" class=\"c-bimwalk-tooltip__instruction\" data-i18n=\"Double click on destination\">Double click on destination</span>\n\n                        <svg width=\"46px\" height=\"46px\" viewBox=\"0 0 46 46\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"gesture-double-click\" fill=\"#FFFFFF\">\n                                    <circle id=\"Oval-2\" fill-opacity=\"0.1\" cx=\"17.5\" cy=\"17.5\" r=\"17.5\"></circle>\n                                    <circle id=\"Oval-2\" fill-opacity=\"0.2\" cx=\"17.5\" cy=\"17.5\" r=\"12.5\"></circle>\n                                    <circle id=\"Oval-2\" fill-opacity=\"0.3\" cx=\"17.5\" cy=\"17.5\" r=\"7.5\"></circle>\n                                    <path d=\"M44.9736119,25.4255085 L17.6278175,17.7058824 C17.4969764,17.7058824 17.3661352,17.7058824 17.3007147,17.7713029 C17.2352941,17.8367235 17.2352941,18.0329852 17.2352941,18.0984057 L24.7586586,45.6404618 C24.8240792,45.7713029 24.8894997,45.902144 25.0857614,45.902144 L25.0857614,45.902144 C25.2166025,45.902144 25.3474437,45.8367235 25.4128642,45.7058824 L30.9081913,31.3787795 L45.0390324,26.0797141 C45.1698736,26.0142936 45.2352941,25.8834524 45.2352941,25.7526113 C45.2352941,25.6217702 45.104453,25.4909291 44.9736119,25.4255085 Z\" id=\"Shape\"></path>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n\n                    <div id=\"tooltipLookAround\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--look docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Look Around\">Look Around</span>\n\n                        <span id=\"instruction\" class=\"c-bimwalk-tooltip__instruction\" data-i18n=\"Drag with left key on view\">Drag with left key on view</span>\n\n                        <svg id=\"Layer_1\" data-name=\"Layer 1\" xmlns=\"http://www.w3.org/2000/svg\" width=\"66\" height=\"60\" viewBox=\"0 0 66 60\">\n                        <g id=\"_Group_\" data-name=\"&lt;Group&gt;\" opacity=\"0.1\">\n                            <g id=\"_Group_2\" data-name=\"&lt;Group&gt;\">\n                            <rect id=\"_Rectangle_\" data-name=\"&lt;Rectangle&gt;\" x=\"36.9\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" fill=\"#fff\"/>\n                            </g>\n                        </g>\n                        <g id=\"_Group_3\" data-name=\"&lt;Group&gt;\" opacity=\"0.2\">\n                            <g id=\"_Group_4\" data-name=\"&lt;Group&gt;\">\n                            <rect id=\"_Rectangle_2\" data-name=\"&lt;Rectangle&gt;\" x=\"30.8\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" fill=\"#fff\"/>\n                            </g>\n                        </g>\n                        <g id=\"_Group_5\" data-name=\"&lt;Group&gt;\" opacity=\"0.3\">\n                            <g id=\"_Group_6\" data-name=\"&lt;Group&gt;\">\n                            <rect id=\"_Rectangle_3\" data-name=\"&lt;Rectangle&gt;\" x=\"25.1\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" fill=\"#fff\"/>\n                            </g>\n                        </g>\n                        <g id=\"_Group_7\" data-name=\"&lt;Group&gt;\">\n                            <g id=\"_Group_8\" data-name=\"&lt;Group&gt;\" opacity=\"0.1\">\n                            <g id=\"_Group_9\" data-name=\"&lt;Group&gt;\">\n                                <rect id=\"_Rectangle_4\" data-name=\"&lt;Rectangle&gt;\" x=\"0.1\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" transform=\"translate(29.2 74.1) rotate(-180)\" fill=\"#fff\"/>\n                            </g>\n                            </g>\n                            <g id=\"_Group_10\" data-name=\"&lt;Group&gt;\" opacity=\"0.2\">\n                            <g id=\"_Group_11\" data-name=\"&lt;Group&gt;\">\n                                <rect id=\"_Rectangle_5\" data-name=\"&lt;Rectangle&gt;\" x=\"6.2\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" transform=\"translate(41.5 74.1) rotate(180)\" fill=\"#fff\"/>\n                            </g>\n                            </g>\n                            <g id=\"_Group_12\" data-name=\"&lt;Group&gt;\" opacity=\"0.3\">\n                            <g id=\"_Group_13\" data-name=\"&lt;Group&gt;\">\n                                <rect id=\"_Rectangle_6\" data-name=\"&lt;Rectangle&gt;\" x=\"11.9\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" transform=\"translate(52.7 74.1) rotate(-180)\" fill=\"#fff\"/>\n                            </g>\n                            </g>\n                        </g>\n                        <g id=\"_Group_14\" data-name=\"&lt;Group&gt;\">\n                            <g id=\"_Group_15\" data-name=\"&lt;Group&gt;\">\n                            <rect id=\"_Rectangle_7\" data-name=\"&lt;Rectangle&gt;\" x=\"18\" y=\"14\" width=\"29\" height=\"46\" rx=\"14.5\" ry=\"14.5\" fill=\"#fff\"/>\n                            </g>\n                        </g>\n                        <path id=\"_Path_\" data-name=\"&lt;Path&gt;\" d=\"M33.2,30.5v-14h.2c-6.8,0-13.2,5.3-13.2,12.1v1.9h13Z\" fill=\"#4e4e4e\"/>\n                        <rect id=\"_Rectangle_8\" data-name=\"&lt;Rectangle&gt;\" x=\"27.6\" y=\"2\" width=\"9.6\" height=\"4\" transform=\"translate(64.8 8) rotate(180)\" fill=\"#fff\"/>\n                        <polygon id=\"_Path_2\" data-name=\"&lt;Path&gt;\" points=\"36.6 8 36.6 0 40.6 4 36.6 8\" fill=\"#fff\"/>\n                        <g id=\"_Group_16\" data-name=\"&lt;Group&gt;\">\n                            <polygon id=\"_Path_3\" data-name=\"&lt;Path&gt;\" points=\"28.7 0 28.7 8 24.6 4 28.7 0\" fill=\"#fff\"/>\n                        </g>\n                        </svg>\n                    </div>\n\n                    <div id=\"tooltipAdjustSpeed\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--speed docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Adjust Speed\">Adjust Speed</span>\n\n                        <svg width=\"80px\" height=\"36px\" viewBox=\"0 0 80 36\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-minus-plus\">\n                                    <rect id=\"Rectangle-3-Copy-8\" fill=\"#FFFFFF\" x=\"44\" y=\"5.68434189e-15\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <polygon id=\"+\" fill=\"#4E4E4E\" points=\"58 18.5869141 58 16.8027344 60.8027344 16.8027344 60.8027344 14 62.6005859 14 62.6005859 16.8027344 65.4033203 16.8027344 65.4033203 18.5869141 62.6005859 18.5869141 62.6005859 21.4033203 60.8027344 21.4033203 60.8027344 18.5869141\"></polygon>\n                                    <rect id=\"Rectangle-3-Copy-7\" fill=\"#FFFFFF\" x=\"0\" y=\"5.68434189e-15\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <polygon id=\"–\" fill=\"#4E4E4E\" points=\"14 17 21.8408203 17 21.8408203 18.4902344 14 18.4902344\"></polygon>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n                </div>\n            </div>\n\n            <div id=\"light-theme\" class=\"bimwalk-guide-light-theme\">\n                <div class=\"c-bimwalk-tooltip__row\">\n                    <div class=\"docking-panel-close c-bimwalk-tooltip__close\"></div>\n\n                    <div id=\"tooltipMove\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--walk docking-panel-container-solid-color-c\">\n                        <span id=\"moveTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Walk\">Walk</span>\n\n                        <span id=\"tooltipOR\" class=\"bimwalk-tooltip-or\" data-i18n=\"OR\">OR</span>\n\n                        <svg width=\"124px\" height=\"81px\" viewBox=\"0 0 124 81\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-arrows\">\n                                    <rect id=\"Rectangle-3\" fill=\"#FFFFFF\" x=\"44\" y=\"0\" width=\"36\" height=\"35.1111111\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-3\" fill=\"#FFFFFF\" x=\"44\" y=\"43.8888889\" width=\"36\" height=\"35.1111111\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-5\" fill=\"#FFFFFF\" x=\"88\" y=\"43.8888889\" width=\"36\" height=\"35.1111111\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"43.8888889\" width=\"36\" height=\"35.1111111\" rx=\"4\"></rect>\n                                    <polygon id=\"Triangle\" fill=\"#4E4E4E\" points=\"62.0951782 5.85185185 67.1903564 14.3636364 57 14.3636364\"></polygon>\n                                    <polygon id=\"Triangle-Copy\" fill=\"#4E4E4E\" transform=\"translate(62.095178, 67.650954) scale(1, -1) translate(-62.095178, -67.650954) \" points=\"62.0951782 63.3950617 67.1903564 71.9068462 57 71.9068462\"></polygon>\n                                    <polygon id=\"Triangle-Copy-2\" fill=\"#4E4E4E\" transform=\"translate(106.095178, 61.799102) scale(1, -1) rotate(90.000000) translate(-106.095178, -61.799102) \" points=\"106.095178 57.5432099 111.190356 66.0549944 101 66.0549944\"></polygon>\n                                    <polygon id=\"Triangle-Copy-2\" fill=\"#4E4E4E\" transform=\"translate(18.095178, 61.799102) scale(-1, -1) rotate(90.000000) translate(-18.095178, -61.799102) \" points=\"18.0951782 57.5432099 23.1903564 66.0549944 13 66.0549944\"></polygon>\n                                </g>\n                            </g>\n                        </svg>\n\n                        <svg width=\"124px\" height=\"80px\" viewBox=\"0 0 124 80\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-wasd\">\n                                    <rect id=\"Rectangle-3\" fill=\"#FFFFFF\" x=\"44\" y=\"0\" width=\"36\" height=\"35.55\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-3\" fill=\"#FFFFFF\" x=\"44\" y=\"43.45\" width=\"36\" height=\"35.55\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-5\" fill=\"#FFFFFF\" x=\"88\" y=\"43.45\" width=\"36\" height=\"35.55\" rx=\"4\"></rect>\n                                    <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"43.45\" width=\"36\" height=\"35.55\" rx=\"4\"></rect>\n                                    <polygon id=\"W\" fill=\"#4E4E4E\" points=\"58.2353516 12.8375 59.5683594 18.5349121 59.8554688 20.1212769 60.1494141 18.5686646 61.2841797 12.8375 63.5058594 12.8375 64.7021484 18.5349121 65.0097656 20.1212769 65.3173828 18.5956665 66.6640625 12.8375 68.8037109 12.8375 65.9667969 22.7877197 63.9570312 22.7877197 62.7402344 16.9687988 62.3847656 15.0449097 62.0292969 16.9687988 60.8125 22.7877197 58.8574219 22.7877197 56 12.8375\"></polygon>\n                                    <path d=\"M60.0097656,63.4565186 C60.073568,63.9110537 60.1988923,64.2508249 60.3857422,64.4758423 C60.7275408,64.885374 61.3131469,65.0901367 62.1425781,65.0901367 C62.6393254,65.0901367 63.0426417,65.0361334 63.3525391,64.928125 C63.9404326,64.721109 64.234375,64.336335 64.234375,63.7737915 C64.234375,63.4452661 64.0885431,63.1910002 63.796875,63.0109863 C63.5052069,62.8354728 63.0472036,62.6802131 62.4228516,62.5452026 L61.3564453,62.3089355 C60.308263,62.0749174 59.5836609,61.8206516 59.1826172,61.5461304 C58.5035773,61.0870949 58.1640625,60.3693001 58.1640625,59.3927246 C58.1640625,58.5016557 58.4921842,57.7613596 59.1484375,57.171814 C59.8046908,56.5822684 60.7685483,56.2875 62.0400391,56.2875 C63.1018933,56.2875 64.007646,56.5653923 64.7573242,57.1211853 C65.5070024,57.6769783 65.9000649,58.4836536 65.9365234,59.5412354 L63.9130859,59.5412354 C63.8766274,58.9426891 63.6123071,58.5174126 63.1201172,58.2653931 C62.7919905,58.0988802 62.384117,58.015625 61.8964844,58.015625 C61.354164,58.015625 60.9212256,58.1236317 60.5976562,58.3396484 C60.2740869,58.5556651 60.1123047,58.8571839 60.1123047,59.2442139 C60.1123047,59.5997414 60.2718083,59.8652579 60.5908203,60.0407715 C60.7958995,60.1577805 61.2333951,60.2950391 61.9033203,60.4525513 L63.6396484,60.8643311 C64.40072,61.044345 64.974933,61.28511 65.3623047,61.5866333 C65.9638702,62.0546695 66.2646484,62.7319617 66.2646484,63.6185303 C66.2646484,64.5276006 65.9126012,65.2825226 65.2084961,65.8833191 C64.504391,66.4841156 63.5097721,66.7845093 62.2246094,66.7845093 C60.9121028,66.7845093 59.8798866,66.4886158 59.1279297,65.8968201 C58.3759728,65.3050243 58,64.4915986 58,63.4565186 L60.0097656,63.4565186 Z\" id=\"S\" fill=\"#4E4E4E\"></path>\n                                    <path d=\"M104.043945,58.015625 L104.043945,64.5095947 L105.985352,64.5095947 C106.978846,64.5095947 107.671548,64.0258146 108.063477,63.0582397 C108.27767,62.5271987 108.384766,61.8949093 108.384766,61.1613525 C108.384766,60.1487742 108.224123,59.3713508 107.902832,58.8290588 C107.581541,58.2867669 106.942388,58.015625 105.985352,58.015625 L104.043945,58.015625 Z M107.899414,56.5035156 C108.605798,56.7330334 109.177732,57.1538096 109.615234,57.7658569 C109.966148,58.2608952 110.205403,58.7964286 110.333008,59.3724731 C110.460613,59.9485177 110.524414,60.4975519 110.524414,61.0195923 C110.524414,62.3426946 110.255537,63.4632645 109.717773,64.3813354 C108.988603,65.6189312 107.862963,66.2377197 106.34082,66.2377197 L102,66.2377197 L102,56.2875 L106.34082,56.2875 C106.965172,56.2965007 107.484698,56.3685052 107.899414,56.5035156 Z\" id=\"D\" fill=\"#4E4E4E\"></path>\n                                    <path d=\"M16.4658203,62.4776978 L19.0224609,62.4776978 L17.7646484,58.5624146 L16.4658203,62.4776978 Z M16.5957031,56.2875 L18.9746094,56.2875 L22.5429688,66.2377197 L20.2597656,66.2377197 L19.6103516,64.1923218 L15.8984375,64.1923218 L15.2011719,66.2377197 L13,66.2377197 L16.5957031,56.2875 Z\" id=\"A\" fill=\"#4E4E4E\"></path>       </g>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n                </div>\n\n                <div class=\"c-bimwalk-tooltip__row\">\n                    <div id=\"tooltipUpDown\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--updown docking-panel-container-solid-color-c\" >\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Go Up and Down\">Go Up and Down</span>\n\n                        <span id=\"instruction\" class=\"c-bimwalk-tooltip__instruction\" data-i18n=\"Release key to land on the nearest floor\">Release key to land on the nearest floor.</span>\n\n                        <svg width=\"123px\" height=\"37px\" viewBox=\"0 0 123 37\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"First-Person\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"1st-Person-Guides---Desktop-1\" transform=\"translate(-297.000000, -339.000000)\">\n                                    <g id=\"Group-5\" transform=\"translate(297.000000, 339.000000)\">\n                                        <g id=\"Group-7-Copy\" transform=\"translate(22.000000, 0.321429)\">\n                                            <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"5.68434189e-15\" width=\"36\" height=\"35.7428571\" rx=\"4\"></rect>\n                                            <path d=\"M18.5097656,21.7910156 C18.6328131,21.7591144 18.7900381,21.7021488 18.9814453,21.6201172 L17.9628906,20.6494141 L19.0498047,19.5146484 L20.0683594,20.4853516 C20.2278654,20.1572249 20.3395179,19.8701184 20.4033203,19.6240234 C20.5035812,19.254881 20.5537109,18.8242212 20.5537109,18.3320312 C20.5537109,17.2018173 20.3224307,16.3279653 19.8598633,15.7104492 C19.3972959,15.0929331 18.7216841,14.7841797 17.8330078,14.7841797 C16.9990193,14.7841797 16.3336613,15.0804007 15.8369141,15.6728516 C15.3401668,16.2653024 15.0917969,17.1516868 15.0917969,18.3320312 C15.0917969,19.7128975 15.4472621,20.7018199 16.1582031,21.2988281 C16.6184919,21.6861999 17.1699187,21.8798828 17.8125,21.8798828 C18.0540377,21.8798828 18.2864572,21.8502607 18.5097656,21.7910156 Z M22.3310547,20.4375 C22.1533194,21.0162789 21.8912778,21.4970684 21.5449219,21.8798828 L22.7070312,22.9667969 L21.6064453,24.1152344 L20.3896484,22.9667969 C20.020506,23.1901053 19.7014987,23.3473303 19.4326172,23.4384766 C18.9814431,23.5888679 18.4414094,23.6640625 17.8125,23.6640625 C16.4999934,23.6640625 15.4153689,23.2721393 14.5585938,22.4882812 C13.5195261,21.5449172 13,20.1595143 13,18.3320312 C13,16.4908762 13.5331978,15.0986375 14.5996094,14.1552734 C15.4700564,13.3850873 16.5524024,13 17.8466797,13 C19.1500716,13 20.2438107,13.4078735 21.1279297,14.2236328 C22.1487681,15.1669969 22.6591797,16.4863196 22.6591797,18.1816406 C22.6591797,19.0794316 22.5498058,19.8313772 22.3310547,20.4375 Z\" id=\"Q\" fill=\"#4E4E4E\"></path>\n                                        </g>\n                                        <g id=\"Group-7-Copy-2\" transform=\"translate(65.000000, 0.321429)\">\n                                            <rect id=\"Rectangle-3-Copy-4\" fill=\"#FFFFFF\" x=\"0\" y=\"5.68434189e-15\" width=\"36\" height=\"35.7428571\" rx=\"4\"></rect>\n                                            <polygon id=\"E\" fill=\"#4E4E4E\" points=\"21.3896484 14.7841797 16.0576172 14.7841797 16.0576172 16.9238281 20.9521484 16.9238281 20.9521484 18.6738281 16.0576172 18.6738281 16.0576172 21.2646484 21.6357422 21.2646484 21.6357422 23.0761719 14 23.0761719 14 13 21.3896484 13\"></polygon>\n                                        </g>\n                                        <g id=\"Group-4\" opacity=\"0.6\" transform=\"translate(5.000000, 18.614286) scale(1, -1) translate(-5.000000, -18.614286) translate(0.000000, 7.114286)\" fill=\"#939CA5\">\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 9.439286) rotate(90.000000) translate(-5.000000, -9.439286) \" x=\"0.5\" y=\"7.45357143\" width=\"9\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 17.382143) rotate(90.000000) translate(-5.000000, -17.382143) \" x=\"3.5\" y=\"15.3964286\" width=\"3\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 21.850000) rotate(90.000000) translate(-5.000000, -21.850000) \" x=\"4\" y=\"19.8642857\" width=\"2\" height=\"3.97142857\"></rect>\n                                            <polygon id=\"_Path_2\" transform=\"translate(5.000000, 3.482143) rotate(-90.000000) translate(-5.000000, -3.482143) \" points=\"2.5 8.44642857 2.5 -1.48214286 7.5 3.48214286\"></polygon>\n                                        </g>\n                                        <g id=\"Group-4-Copy\" opacity=\"0.6\" transform=\"translate(118.000000, 17.771429) scale(1, -1) rotate(-180.000000) translate(-118.000000, -17.771429) translate(113.000000, 6.271429)\" fill=\"#939CA5\">\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 9.439286) rotate(90.000000) translate(-5.000000, -9.439286) \" x=\"0.5\" y=\"7.45357143\" width=\"9\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 17.382143) rotate(90.000000) translate(-5.000000, -17.382143) \" x=\"3.5\" y=\"15.3964286\" width=\"3\" height=\"3.97142857\"></rect>\n                                            <rect id=\"_Rectangle_8\" transform=\"translate(5.000000, 21.850000) rotate(90.000000) translate(-5.000000, -21.850000) \" x=\"4\" y=\"19.8642857\" width=\"2\" height=\"3.97142857\"></rect>\n                                            <polygon id=\"_Path_2\" transform=\"translate(5.000000, 3.482143) rotate(-90.000000) translate(-5.000000, -3.482143) \" points=\"2.5 8.44642857 2.5 -1.48214286 7.5 3.48214286\"></polygon>\n                                        </g>\n                                    </g>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n\n                    <div id=\"tooltipRun\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--run docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Run\">Run</span>\n\n                        <svg width=\"72px\" height=\"36px\" viewBox=\"0 0 72 36\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" class=\"c-bimwalk-tooltip__shift\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-shift\">\n                                    <rect id=\"Rectangle-3-Copy-10\" fill=\"#FFFFFF\" x=\"0\" y=\"0\" width=\"72\" height=\"36\" rx=\"4\"></rect>\n                                    <path d=\"M11.4267578,24.6210938 C11.4677736,24.9674496 11.5566399,25.2135409 11.6933594,25.359375 C11.934897,25.6191419 12.3815072,25.7490234 13.0332031,25.7490234 C13.4160175,25.7490234 13.7202137,25.6920579 13.9458008,25.578125 C14.1713878,25.4641921 14.2841797,25.2932954 14.2841797,25.0654297 C14.2841797,24.8466786 14.1930348,24.6803391 14.0107422,24.5664062 C13.8284496,24.4524734 13.1516986,24.2565118 11.9804688,23.9785156 C11.1373656,23.7688792 10.542645,23.5068375 10.1962891,23.1923828 C9.84993316,22.8824854 9.67675781,22.4358753 9.67675781,21.8525391 C9.67675781,21.1643846 9.94677464,20.5730819 10.4868164,20.0786133 C11.0268582,19.5841447 11.786779,19.3369141 12.7666016,19.3369141 C13.6962937,19.3369141 14.4539359,19.5226218 15.0395508,19.894043 C15.6251657,20.2654641 15.9612626,20.9068965 16.0478516,21.8183594 L14.0996094,21.8183594 C14.0722655,21.5677071 14.0016282,21.3694669 13.8876953,21.2236328 C13.6735015,20.9593086 13.3089218,20.8271484 12.7939453,20.8271484 C12.3701151,20.8271484 12.0681975,20.8932285 11.8881836,21.0253906 C11.7081697,21.1575527 11.6181641,21.3124991 11.6181641,21.4902344 C11.6181641,21.7135428 11.7138662,21.875325 11.9052734,21.9755859 C12.0966806,22.0804042 12.7734317,22.2604154 13.9355469,22.515625 C14.7102903,22.6979176 15.2913392,22.973631 15.6787109,23.3427734 C16.0615254,23.7164732 16.2529297,24.1835909 16.2529297,24.7441406 C16.2529297,25.4824256 15.9783556,26.0851214 15.4291992,26.5522461 C14.8800428,27.0193708 14.0312557,27.2529297 12.8828125,27.2529297 C11.7115827,27.2529297 10.8468452,27.0056991 10.2885742,26.5112305 C9.7303032,26.0167619 9.45117188,25.3867226 9.45117188,24.6210938 L11.4267578,24.6210938 Z M23.0581055,19.5966797 C23.4340839,19.7561857 23.7428373,19.9999984 23.984375,20.328125 C24.1894542,20.6061212 24.3147784,20.8920884 24.3603516,21.1860352 C24.4059247,21.4799819 24.4287109,21.9596321 24.4287109,22.625 L24.4287109,27 L22.4394531,27 L22.4394531,22.4677734 C22.4394531,22.0667298 22.3710944,21.7431653 22.234375,21.4970703 C22.0566397,21.1507144 21.7194035,20.9775391 21.2226562,20.9775391 C20.7076797,20.9775391 20.3168959,21.1495751 20.050293,21.4936523 C19.7836901,21.8377296 19.6503906,22.3287729 19.6503906,22.9667969 L19.6503906,27 L17.7089844,27 L17.7089844,16.9580078 L19.6503906,16.9580078 L19.6503906,20.5195312 C19.9329441,20.0865864 20.2599265,19.7846688 20.6313477,19.6137695 C21.0027688,19.4428702 21.3935526,19.3574219 21.8037109,19.3574219 C22.2639997,19.3574219 22.682127,19.4371737 23.0581055,19.5966797 Z M28.25,18.6601562 L26.2744141,18.6601562 L26.2744141,16.8623047 L28.25,16.8623047 L28.25,18.6601562 Z M26.2744141,19.5488281 L28.25,19.5488281 L28.25,27 L26.2744141,27 L26.2744141,19.5488281 Z M33.2197266,16.831543 C33.3199875,16.8383789 33.4567049,16.8486327 33.6298828,16.8623047 L33.6298828,18.4482422 C33.5205073,18.4345702 33.3370781,18.4243164 33.0795898,18.4174805 C32.8221016,18.4106445 32.644369,18.4676101 32.5463867,18.5883789 C32.4484045,18.7091477 32.3994141,18.8424472 32.3994141,18.9882812 L32.3994141,19.6171875 L33.6777344,19.6171875 L33.6777344,20.9912109 L32.3994141,20.9912109 L32.3994141,27 L30.4580078,27 L30.4580078,20.9912109 L29.3710938,20.9912109 L29.3710938,19.6171875 L30.4375,19.6171875 L30.4375,19.1386719 C30.4375,18.3411418 30.5719388,17.7919937 30.8408203,17.4912109 C31.1233738,17.0445941 31.8046821,16.8212891 32.8847656,16.8212891 C33.0078131,16.8212891 33.1194656,16.824707 33.2197266,16.831543 Z M34.0332031,21.0048828 L34.0332031,19.6171875 L35.0722656,19.6171875 L35.0722656,17.5390625 L37,17.5390625 L37,19.6171875 L38.2099609,19.6171875 L38.2099609,21.0048828 L37,21.0048828 L37,24.9423828 C37,25.2477229 37.0387366,25.4379879 37.1162109,25.5131836 C37.1936853,25.5883793 37.4306621,25.6259766 37.8271484,25.6259766 C37.8863935,25.6259766 37.9490557,25.6248373 38.0151367,25.6225586 C38.0812178,25.6202799 38.1461585,25.616862 38.2099609,25.6123047 L38.2099609,27.0683594 L37.2871094,27.1025391 C36.3665319,27.1344403 35.7376319,26.9749367 35.4003906,26.6240234 C35.1816395,26.400715 35.0722656,26.0566429 35.0722656,25.5917969 L35.0722656,21.0048828 L34.0332031,21.0048828 Z\" id=\"shift\" fill=\"#4E4E4E\"></path>\n                                </g>\n                            </g>\n                        </svg>\n\n                        <svg width=\"32px\" height=\"32px\" viewBox=\"0 0 32 32\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" class=\"c-bimwalk-tooltip__plus\">\n                            <path d=\"m 12,12 -10,0 0,8 10,0 0,10 8,0 0,-10 10,0 0,-8 -10,0 0,-10 -8,0 z\" fill=\"#939ca5\"></path>\n                        </svg>\n\n                        <span id=\"directionKey\" class=\"c-bimwalk-tooltip__direction\" data-i18n=\"Direction Key\">Direction Key</span>\n                    </div>\n                </div>\n\n                <div class=\"c-bimwalk-tooltip__row\">\n                    <div id=\"tooltipTeleport\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--teleport docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Teleport\">Teleport</span>\n\n                        <span id=\"instruction\" class=\"c-bimwalk-tooltip__instruction\" data-i18n=\"Double click on destination\">Double click on destination</span>\n\n                        <svg width=\"46px\" height=\"46px\" viewBox=\"0 0 46 46\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <!-- Generator: Sketch 47 (45396) - http://www.bohemiancoding.com/sketch -->\n                            <title>gesture-double-click</title>\n                            <desc>Created with Sketch.</desc>\n                            <defs></defs>\n                            <g id=\"3D-LMV\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"First-Person---Guides---Desktop---light\" transform=\"translate(-284.000000, -469.000000)\">\n                                    <g id=\"gesture-double-click\" transform=\"translate(284.000000, 469.385714)\">\n                                        <ellipse id=\"Oval-2\" fill=\"#D4DBE1\" cx=\"17.5\" cy=\"17.375\" rx=\"17.5\" ry=\"17.375\"></ellipse>\n                                        <ellipse id=\"Oval-2\" fill=\"#BEC8D2\" cx=\"17.5\" cy=\"17.375\" rx=\"12.5\" ry=\"12.4107143\"></ellipse>\n                                        <ellipse id=\"Oval-2\" fill=\"#939CA5\" cx=\"17.5\" cy=\"17.375\" rx=\"7.5\" ry=\"7.44642857\"></ellipse>\n                                        <path d=\"M44.9736119,25.2438977 L17.6278175,17.5794118 C17.4969764,17.5794118 17.3661352,17.5794118 17.3007147,17.644365 C17.2352941,17.7093183 17.2352941,17.9041781 17.2352941,17.9691314 L24.7586586,45.3144585 C24.8240792,45.444365 24.8894997,45.5742716 25.0857614,45.5742716 L25.0857614,45.5742716 C25.2166025,45.5742716 25.3474437,45.5093183 25.4128642,45.3794118 L30.9081913,31.1546454 L45.0390324,25.8934305 C45.1698736,25.8284772 45.2352941,25.6985706 45.2352941,25.5686641 C45.2352941,25.4387576 45.104453,25.308851 44.9736119,25.2438977 Z\" id=\"Shape\" fill=\"#4A555B\"></path>\n                                    </g>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n\n                    <div id=\"tooltipLookAround\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--look docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Look Around\">Look Around</span>\n\n                        <span id=\"instruction\" class=\"c-bimwalk-tooltip__instruction\" data-i18n=\"Drag with left key on view\">Drag with left key on view</span>\n\n                        <svg id=\"Layer_1\" data-name=\"Layer 1\" xmlns=\"http://www.w3.org/2000/svg\" width=\"66\" height=\"60\" viewBox=\"0 0 66 60\">\n                            <g id=\"3D-LMV\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"First-Person---Guides---Desktop---light\" transform=\"translate(-477.000000, -462.000000)\">\n                                    <g id=\"gesture-left-drag-w\" transform=\"translate(477.000000, 462.435714)\">\n                                        <g id=\"_Group_\" opacity=\"0.1\" transform=\"translate(36.000000, 13.900000)\" fill=\"#D4DBE1\">\n                                            <g id=\"_Group_2\">\n                                                <rect id=\"_Rectangle_\" x=\"0.9\" y=\"0\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                            </g>\n                                        </g>\n                                        <g id=\"_Group_3\" opacity=\"0.2\" transform=\"translate(30.000000, 13.900000)\" fill=\"#BEC8D2\">\n                                            <g id=\"_Group_4\">\n                                                <rect id=\"_Rectangle_2\" x=\"0.8\" y=\"0\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                            </g>\n                                        </g>\n                                        <g id=\"_Group_5\" opacity=\"0.3\" transform=\"translate(25.000000, 13.900000)\" fill=\"#939CA5\">\n                                            <g id=\"_Group_6\">\n                                                <rect id=\"_Rectangle_3\" x=\"0.1\" y=\"0\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                            </g>\n                                        </g>\n                                        <g id=\"_Group_7\" transform=\"translate(0.000000, 13.900000)\">\n                                            <g id=\"_Group_8\" opacity=\"0.1\" fill=\"#D4DBE1\">\n                                                <g id=\"_Group_9\">\n                                                    <rect id=\"_Rectangle_4\" transform=\"translate(14.600000, 22.935000) rotate(180.000000) translate(-14.600000, -22.935000) \" x=\"0.1\" y=\"0.0992857143\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                                </g>\n                                            </g>\n                                            <g id=\"_Group_10\" opacity=\"0.2\" transform=\"translate(6.000000, 0.000000)\" fill=\"#BEC8D2\">\n                                                <g id=\"_Group_11\">\n                                                    <rect id=\"_Rectangle_5\" transform=\"translate(14.800000, 22.935000) rotate(180.000000) translate(-14.800000, -22.935000) \" x=\"0.3\" y=\"0.0992857143\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                                </g>\n                                            </g>\n                                            <g id=\"_Group_12\" opacity=\"0.3\" transform=\"translate(11.000000, 0.000000)\" fill=\"#939CA5\">\n                                                <g id=\"_Group_13\">\n                                                    <rect id=\"_Rectangle_6\" transform=\"translate(15.300000, 22.935000) rotate(180.000000) translate(-15.300000, -22.935000) \" x=\"0.8\" y=\"0.0992857143\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                                </g>\n                                            </g>\n                                        </g>\n                                        <g id=\"_Group_14\" transform=\"translate(18.000000, 13.900000)\" fill=\"#4A555B\">\n                                            <g id=\"_Group_15\">\n                                                <rect id=\"_Rectangle_7\" x=\"0\" y=\"0\" width=\"29\" height=\"45.6714286\" rx=\"14.5\"></rect>\n                                            </g>\n                                        </g>\n                                        <path d=\"M33.2,30.2821429 L33.2,16.3821429 L33.4,16.3821429 C26.6,16.3821429 20.2,21.6442857 20.2,28.3957143 L20.2,30.2821429 L33.2,30.2821429 Z\" id=\"_Path_\" fill=\"#FFFFFF\"></path>\n                                        <rect id=\"_Rectangle_8\" fill=\"#939CA5\" transform=\"translate(32.400000, 3.971429) rotate(180.000000) translate(-32.400000, -3.971429) \" x=\"27.6\" y=\"1.98571429\" width=\"9.6\" height=\"3.97142857\"></rect>\n                                        <polygon id=\"_Path_2\" fill=\"#939CA5\" points=\"36.6 7.94285714 36.6 0 40.6 3.97142857\"></polygon>\n                                        <g id=\"_Group_16\" transform=\"translate(24.000000, 0.000000)\" fill=\"#939CA5\">\n                                            <polygon id=\"_Path_3\" points=\"4.7 0 4.7 7.94285714 0.6 3.97142857\"></polygon>\n                                        </g>\n                                    </g>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n\n                    <div id=\"tooltipAdjustSpeed\" class=\"c-bimwalk-tooltip__tip c-bimwalk-tooltip__tip--speed docking-panel-container-solid-color-c\">\n                        <span id=\"tipTitle\" class=\"c-bimwalk-tooltip__subtitle\" data-i18n=\"Adjust Speed\">Adjust Speed</span>\n\n                        <svg width=\"80px\" height=\"36px\" viewBox=\"0 0 80 36\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n                            <g id=\"Symbols\" stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n                                <g id=\"graphic-key-minus-plus\">\n                                    <rect id=\"Rectangle-3-Copy-8\" fill=\"#FFFFFF\" x=\"44\" y=\"5.68434189e-15\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <polygon id=\"+\" fill=\"#4E4E4E\" points=\"58 18.5869141 58 16.8027344 60.8027344 16.8027344 60.8027344 14 62.6005859 14 62.6005859 16.8027344 65.4033203 16.8027344 65.4033203 18.5869141 62.6005859 18.5869141 62.6005859 21.4033203 60.8027344 21.4033203 60.8027344 18.5869141\"></polygon>\n                                    <rect id=\"Rectangle-3-Copy-7\" fill=\"#FFFFFF\" x=\"0\" y=\"5.68434189e-15\" width=\"36\" height=\"36\" rx=\"4\"></rect>\n                                    <polygon id=\"–\" fill=\"#4E4E4E\" points=\"14 17 21.8408203 17 21.8408203 18.4902344 14 18.4902344\"></polygon>\n                                </g>\n                            </g>\n                        </svg>\n                    </div>\n                </div>\n            </div>\n\n            <div class=\"c-bimwalk-tooltip__actions\">\n                <span id=\"tooltipOk\" class=\"c-bimwalk-tooltip__action docking-panel-primary-button\" data-i18n=\"Ok Got It\">\n                    OK, got it.\n                </span>\n\n                <span id=\"dontRemind\" class=\"c-bimwalk-tooltip__action docking-panel-secondary-button\" data-i18n=\"Dont remind me again\">\n                    Don't remind me again.\n                </span>\n            </div>\n        </div>\n    </div>\n</div>\n";

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
/******/ 			"BimWalk": 0
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
/*!***************************************!*\
  !*** ./extensions/BimWalk/BimWalk.js ***!
  \***************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   BimWalkExtension: () => (/* binding */ BimWalkExtension)
/* harmony export */ });
/* harmony import */ var _BimWalkTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./BimWalkTool.js */ "./extensions/BimWalk/BimWalkTool.js");
/* harmony import */ var _BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./BimWalkUtils.js */ "./extensions/BimWalk/BimWalkUtils.js");



var avp = Autodesk.Viewing.Private;
const analytics = avp.analytics;

const WORKER_COMPUTE_BVH = "COMPUTE_BVH";

/**
 * First Person navigation tool, similar to those found in videogames.
 * Supports keyboard and mouse input.
 *
 * The extension id is: `Autodesk.BimWalk`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example
 * viewer.loadExtension('Autodesk.BimWalk')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.BimWalkExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
function BimWalkExtension(viewer, options = {}) {

  Autodesk.Viewing.Extension.call(this, viewer, options);
  this.options = options;
  this.name = "bimwalk";
  this._updateButtonState = this._updateButtonState.bind(this);
  this._updateToolNavigator = this._updateToolNavigator.bind(this);
  this._createRaycastIterator = this._createRaycastIterator.bind(this);
  this._setAsDefault = this._setAsDefault.bind(this);
  this._onEscape = this._onEscape.bind(this);
  this._onFitToView = this._onFitToView.bind(this);
  this._isDefault = false;
  this._enableGravityCheckBoxID = null;

}

BimWalkExtension.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
BimWalkExtension.prototype.constructor = BimWalkExtension;

var proto = BimWalkExtension.prototype;


proto.load = function () {

  var viewer = this.viewer;

  // Register tool
  this.tool = new _BimWalkTool_js__WEBPACK_IMPORTED_MODULE_0__.BimWalkTool(viewer, this.options, this);

  viewer.toolController.registerTool(this.tool, this.setActive.bind(this));
  viewer.prefs.addListeners(avp.Prefs3D.DEFAULT_NAVIGATION_TOOL_3D, this._setAsDefault);
  viewer.addEventListener(Autodesk.Viewing.AGGREGATE_FIT_TO_VIEW_EVENT, this._onFitToView);
  viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._createRaycastIterator);
  viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this._createRaycastIterator);

  // Compute Raycasting BVH for all loaded models
  const models = this.viewer.impl.get3DModels();
  for (let i = 0; i < models.length; ++i) {
    this._createRaycastIterator(models[i]);
  }

  return true;
};


proto.unload = function () {

  var viewer = this.viewer;

  // Remove listeners
  viewer.removeEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this._updateButtonState);
  viewer.removeEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this._updateButtonState);
  viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this._updateButtonState);
  viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this._createRaycastIterator);
  viewer.removeEventListener(Autodesk.Viewing.ESCAPE_EVENT, this._onEscape);
  viewer.removeEventListener(Autodesk.Viewing.AGGREGATE_FIT_TO_VIEW_EVENT, this._onFitToView);
  viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._createRaycastIterator);
  viewer.prefs.removeListeners(avp.Prefs3D.BIM_WALK_NAVIGATOR_TYPE, this._updateToolNavigator);
  viewer.prefs.removeListeners(avp.Prefs3D.DEFAULT_NAVIGATION_TOOL_3D, this._setAsDefault);

  this.onToolChanged = undefined;

  // Remove hotkey
  viewer.getHotkeyManager().popHotkeys(this.HOTKEYS_ID);

  // Remove the UI
  if (this.bimWalkToolButton) {
    this.bimWalkToolButton.removeFromParent();
    this.bimWalkToolButton = null;
  }

  if (viewer.getDefaultNavigationToolName() === this.tool.getName()) {
    viewer.setDefaultNavigationTool("orbit");
  }

  //Uh, why does the viewer need to keep track of this in addition to the tool stack?
  if (viewer.getActiveNavigationTool() == this.tool.getName())
  viewer.setActiveNavigationTool();

  // Remove settings from Viewer Settings Panel
  if (this._enableGravityCheckBoxID && viewer.viewerSettingsPanel) {
    const control = this.viewer.viewerSettingsPanel.getControl(this._enableGravityCheckBoxID);
    if (control) viewer.viewerSettingsPanel.removeCheckbox(control);
  }

  // Deregister tool
  viewer.toolController.deregisterTool(this.tool);
  this.tool = null;

  this._isDefault = false;

  return true;
};

proto.set = function (configuration, value) {

  if (this.tool.set(configuration, value)) {
    avp.logger.log('BimWalk ' + configuration + ' was set to: ' + this.tool.get(configuration));
  }
};

proto.get = function (configuration) {

  return this.tool.get(configuration);
};

proto.setJoystickPosition = function (x, y) {

  this.tool.setJoystickPosition(x, y);
};

proto.setJoystickRelativePosition = function (x, y) {

  this.tool.setJoystickRelativePosition(x, y);
};

proto.setJoystickSize = function (backgroundRadius, handleRadius) {

  this.tool.setJoystickSize(backgroundRadius, handleRadius);
};

/**
 * Enables the walk tool.
 *
 * @memberof Autodesk.Viewing.Extensions.BimWalkExtension
 * @alias Autodesk.Viewing.Extensions.BimWalkExtension#activate
 * @public
 */
proto.activate = function () {
  if (!this.activeStatus) {
    this.viewer.setActiveNavigationTool(this.tool.getName());
    this.activeStatus = true;

    const av = Autodesk.Viewing;
    const sectionExtName = av.FeatureFlags.isEnabled(av.Private.InternalFeatureFlags.EnableSmartSection) ? 'Autodesk.SmartSection' : 'Autodesk.Section';
    const isSectionActive = this.viewer.isExtensionActive(sectionExtName);
    const isAecModelData = this.viewer.model?.getDocumentNode()?.getAecModelData();
    analytics.track('viewer.first_person.enable', {
      aec_model_data: !!isAecModelData,
      active_section: !!isSectionActive
    });
  }
  return true;
};

/**
 * Deactivates the walk tool.
 *
 * @memberof Autodesk.Viewing.Extensions.BimWalkExtension
 * @alias Autodesk.Viewing.Extensions.BimWalkExtension#deactivate
 * @public
 */
proto.deactivate = function () {
  if (this.activeStatus) {
    this.activeStatus = false;
    this.viewer.setActiveNavigationTool();
    if (this.viewer.model) {// We might get here when switching models, so check that model exists
      this.setPivotPointAfterBimWalk(this.viewer.getCamera());
    }
  }
  return true;
};

/**
 * Set a Pivot point for camera once BimWalk deactivated.
 * This way we discard previous Pivot point which can cause unpredictable orbiting.
 *
 * @param {object} camera - input camera
 * @private
 */
proto.setPivotPointAfterBimWalk = function (camera) {

  // Pivot point set to 1 meter from camera
  const mtsToModel = (0,_BimWalkUtils_js__WEBPACK_IMPORTED_MODULE_1__.metersToModel)(1, this.viewer);
  const direction = camera.target.clone().sub(camera.position).normalize();
  camera.pivot.copy(camera.position);
  camera.pivot.add(direction.multiplyScalar(mtsToModel));
  camera.dirty = true;
};

/**
 * @param {object} toolbar - toolbar
 * @private
 */
proto.onToolbarCreated = function (toolbar) {

  var viewer = this.viewer;
  var avu = Autodesk.Viewing.UI;
  var navTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);

  // Create a button for the tool.
  var extension = this;
  extension.bimWalkToolButton = new avu.Button('toolbar-bimWalkTool');
  extension.bimWalkToolButton.setToolTip('First Person');
  extension.bimWalkToolButton.onClick = function () {
    const activeNavToolName = extension.viewer.getActiveNavigationTool();
    const defaultNavTool = extension.viewer.getDefaultNavigationToolName();
    const bimwalkToolName = extension.tool.getName();

    // Make sure that the bimwalk tool is set as the default
    if (extension._isDefault && defaultNavTool !== bimwalkToolName) {
      extension._setAsDefault(extension.viewer.prefs.get(avp.Prefs3D.DEFAULT_NAVIGATION_TOOL_3D));
      return;
    }

    if (extension.activeStatus) {
      // Deactivate the tool if it is not the default tool.
      if (!extension._isDefault && activeNavToolName === bimwalkToolName) {
        extension.deactivate();
      }
    } else {
      extension.activate();
    }
  };

  extension.bimWalkToolButton.setIcon("adsk-icon-first-person");

  var cameraSubmenuTool = navTools.getControl('toolbar-cameraSubmenuTool');
  if (cameraSubmenuTool) {
    navTools.addControl(extension.bimWalkToolButton, { index: navTools.indexOf(cameraSubmenuTool.getId()) });
  } else {
    navTools.addControl(extension.bimWalkToolButton);
  }

  // Add settings to Viewer Settings Panel
  const navTab = Autodesk.Viewing.Extensions.ViewerSettingTab.Navigation;
  this._enableGravityCheckBoxID = viewer.viewerSettingsPanel.addCheckbox(navTab,
  "Enable Gravity",
  "Toggles gravity while in first person mode",
  this.tool.navigator.gravityEnabled,
  (checked) => this.tool.navigator.enableGravity(checked),
  avp.Prefs3D.BIM_WALK_GRAVITY
  );

  viewer.addEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, this._updateButtonState);
  viewer.addEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this._updateButtonState);
  viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this._updateButtonState);
  viewer.addEventListener(Autodesk.Viewing.ESCAPE_EVENT, this._onEscape);
  viewer.prefs.addListeners(avp.Prefs3D.BIM_WALK_NAVIGATOR_TYPE, this._updateToolNavigator);

  // Check to see if this tool needs to be set as the default.
  this._setAsDefault(viewer.prefs.get(avp.Prefs3D.DEFAULT_NAVIGATION_TOOL_3D));
};

proto._makeBVHInWorker = function (model) {
  const scope = this;
  // Good trade off between memory consumption and performance
  const options = {
    'useLeanNodes': true,
    'want_sort': false
  };

  if (!scope._bvhWorker) {
    scope._rayCastComputations = new Set();
    scope._bvhWorker = avp.createWorker('BvhWorker');

    const onBvhWorkerEvent = function (e) {
      const model = scope.viewer.impl?.findModel(e.data.modelId);

      if (model) {
        const bvh = new avp.BVH(e.data.bvh.nodes.nodesRaw, e.data.bvh.primitives, options, false, e.data.bvh.nodeParents);
        const iterator = new avp.ModelIteratorBVH(model, bvh, false, true);
        model.setRaycastIterator(iterator);
      }

      scope._rayCastComputations.delete(model);
      if (scope._rayCastComputations.size === 0) {
        scope._bvhWorker.terminate();
        scope._bvhWorker = null;
      }
    };

    scope._bvhWorker.addEventListener('message', onBvhWorkerEvent);
  }

  if (scope._rayCastComputations.has(model))
  return;

  const fragments = model.getFragmentList().fragments;

  const workerContext = {
    operation: WORKER_COMPUTE_BVH,
    raiseError: null,
    onFailureCallback: null,
    bvhOptions: options,
    modelId: model.id,
    fragments: {
      // we don't pass in any flags, i.e. also no transparency flags. This makes the BVHBuilder
      // treat all fragments as opaque, which works because for raycasting we don't care about transparency.
      boxes: fragments.boxes,
      polygonCounts: fragments.polygonCounts,
      length: fragments.length
    }
  };

  scope._rayCastComputations.add(model);
  scope._bvhWorker.doOperation(workerContext);
};

/**
 * Try to create a raycast iterator for the given model or install handler to do that later if necessary
 * @param {Autodesk.Viewing.Model} model
 */
proto._createRaycastIterator = function (model) {
  if (model.model)
  model = model.model;

  // Only create Raycast iterator if non is available and only for static 3D designs
  if (!model.getRaycastIterator() && !model.is2d() && !model.isSceneBuilder() && !model.getData().isDynamic) {
    const frags = model.getFragmentList().fragments;

    // Either the model has to be fully loaded or the final bounding boxes have to be available
    if (model.isLoadDone() || frags.boxesLoaded) {
      this._makeBVHInWorker(model);
    } else {
      if (!model.hasEventListener(Autodesk.Viewing.MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT, this._createRaycastIterator))
      model.addEventListener(Autodesk.Viewing.MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT, this._createRaycastIterator, { once: true });
    }
  }
};

// Reflect active/enabled state in BimWalk button
proto._updateButtonState = function () {
  // BimWalk requires a model to initialize metersPerUnit
  var viewer = this.viewer;
  var isEnabled = !!viewer.model;
  var self = this;
  var avu = Autodesk.Viewing.UI;

  if (self.bimWalkToolButton) {
    var isActive = isEnabled && self.tool && self.tool.isActive();
    var state = isActive ? avu.Button.State.ACTIVE :
    isEnabled ? avu.Button.State.INACTIVE : avu.Button.State.DISABLED;
    self.bimWalkToolButton.setState(state);
  }

  // If we had to disable it on model-remove, we must deactivate the tool too
  // for consistentcy.
  if (self.activeStatus && !isEnabled) {
    self.deactivate();
  }

  // If we had to disable it on model-remove, we must deactivate the tool too
  // for consistentcy.
  if (self.activeStatus && !isEnabled) {
    self.deactivate();
  }
};

/**
 * Updates the tool's navigator
 *
 * @param type
 * @private
 */
proto._updateToolNavigator = function (type) {
  // Just deactivate the tool and then set the navigator
  this.deactivate();
  this.tool.setNavigator(type);
};

/**
 * Sets the default tool depending on the type is passed in.
 * The bimwalk tool will be set as the default for the following two cases:
 * 1. if the `type` is set to 'extractor_defined' and the 'navigation hint' (from metadata.json) is set to 'walk'
 * or
 * 2. if the `type` is set to 'bimwalk'
 *
 * @param {string} type - 'extractor_defined' / 'bimwalk'
 * @private
 */
proto._setAsDefault = function (type) {
  switch (type) {
    case 'extractor_defined':
      var navModeHint = this.viewer.model.getMetadata('navigation hint', 'value', null);
      if (!navModeHint || navModeHint.toLowerCase() !== 'walk') {
        // If the metadata does not contain the 'walk' hint,
        // then this should break before the bimwalk tool is activated and set as the default in the 'bimwalk' case.
        break;
      }
    // falls through
    case 'bimwalk':
      if (this.viewer.getDefaultNavigationToolName() !== this.tool.getName()) {
        // This will set the default tool to bimwalk and it will activate BimWalk's tool.
        // Note that it will not call the activate function of the extension.
        this.viewer.setDefaultNavigationTool(this.tool.getName());
        // Because the this.activate is not called, we still want to set the activeStatus of this extension.
        // NOTE: Calling this.activate() here would make the ui of the orbit tool active while having the bimwalk tool as the default tool.
        this.activeStatus = true;
        this._isDefault = true;
      }
      break;
    default:
      // Activate the default navigation tools (pan or orbit) if the bimwalk was the default tool before.
      if (this._isDefault) {
        this.viewer.activateDefaultNavigationTools(this.viewer.model.is2d());
      }
      // The BimWalk tool should not be the default
      this._isDefault = false;
      break;
  }
};

/**
 * Handler for the escape key.
 *
 * @private
 */
proto._onEscape = function () {
  // When selecting a different navigation tool (zoom, pan), the orbit tool will be set as the default.
  // When the user presses the escape key, we want to bring them back to the bimwalk tool.
  // The logic for checking if the bimwalk tool should be the default tool is done in the _setAsDefault function
  this._setAsDefault(this.viewer.prefs.get(avp.Prefs3D.DEFAULT_NAVIGATION_TOOL_3D));
};

proto._onFitToView = async function () {
  // When focusing on an element, fitToView is used, so the AGGREGATE_FIT_TO_VIEW_EVENT is fired.
  this.disableGravityUntilNextMove();
};

proto.disableGravityUntilNextMove = async function () {
  await Autodesk.Viewing.EventUtils.waitUntilTransitionEnded(this.viewer);
  const nav = this.tool?.navigator;
  if (nav) {
    // We fake that the user is over floor so they don't fall after choosing to focus.
    // After making a walking movement this is rechecked, so if not actually over the floor they will fall.
    nav.userOverFloor = true;
  }
};

// Allow others to relocate the info button to avoid overlap with other widgets
proto.getInfoButton = function () {
  var nav = this.tool && this.tool.navigator;
  var ui = nav && nav.ui;
  return ui && ui.infoIcon;
};

/**
 * Jump to a specific floor.
 *
 * @param {number} floorIndex - Index of the floor to jump to.
 */
proto.jumpToFloor = function (floorIndex) {
  this.tool.navigator.jumpToFloor(floorIndex);
};

Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.BimWalk', BimWalkExtension);
})();

Autodesk.Extensions.BimWalk = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=BimWalk.js.map