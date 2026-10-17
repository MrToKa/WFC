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
/******/ 	var __webpack_modules__ = ({

/***/ "./extensions/ViewCubeUi/ViewCube.frag.glsl"
/*!**************************************************!*\
  !*** ./extensions/ViewCubeUi/ViewCube.frag.glsl ***!
  \**************************************************/
(module) {

module.exports = "uniform sampler2D tAtlas;\nvarying vec2 vUv;\nvarying vec3 vNormal;\nvarying vec3 vPosition;\nfloat textCoverage(vec2 uv) {\n    vec2 dx = dFdx(uv);\n    vec2 dy = dFdy(uv);\n    float center = texture2D(tAtlas, uv).r;\n    float radius = clamp(fwidth(center), 0.1, 0.45);\n    float a = smoothstep(0.5 - radius, 0.5 + radius, center)\n            + smoothstep(0.5 - radius, 0.5 + radius, texture2D(tAtlas, uv + dx * -0.375 + dy *  0.125).r)\n            + smoothstep(0.5 - radius, 0.5 + radius, texture2D(tAtlas, uv + dx *  0.125 + dy *  0.375).r)\n            + smoothstep(0.5 - radius, 0.5 + radius, texture2D(tAtlas, uv + dx *  0.375 + dy * -0.125).r)\n            + smoothstep(0.5 - radius, 0.5 + radius, texture2D(tAtlas, uv + dx * -0.125 + dy * -0.375).r);\n    return a / 5.0;\n}\nconst float HALF_SIZE   = 80.0;\nconst vec3 COLOR_TOP    = vec3(1.000, 1.000, 1.000);\nconst vec3 COLOR_BOTTOM = vec3(0.784, 0.784, 0.784);\nconst vec3 COLOR_TEXT   = vec3(0.337, 0.365, 0.404);\nvoid main() {\n    vec3 n = vNormal;\n    vec3 a = abs(n);\n    float face = (a.y + a.z * 2.0) * 2.0 + (1.0 - sign(n.x + n.y + n.z)) * 0.5;\n    float isTop = step(1.5, face) * (1.0 - step(2.5, face));\n    float isBottom = step(2.5, face) * (1.0 - step(3.5, face));\n    float gradientT = vPosition.y / HALF_SIZE * 0.5 + 0.5;\n    vec3 lateralGradient = mix(COLOR_BOTTOM, COLOR_TOP, gradientT);\n    vec3 bgColor = lateralGradient * (1.0 - isTop - isBottom) + COLOR_TOP * isTop + COLOR_BOTTOM * isBottom;\n    vec2 faceUV = mix(vUv, vec2(1.0 - vUv.x, 1.0 - vUv.y), isBottom);\n    vec2 atlasUV = vec2((face + faceUV.x) / 6.0, faceUV.y);\n    float textMask = 1.0 - textCoverage(atlasUV);\n    vec3 finalColor = mix(bgColor, COLOR_TEXT, textMask);\n    gl_FragColor = vec4(finalColor, 1.0);\n}\n";

/***/ },

/***/ "./extensions/ViewCubeUi/ViewCube.vert.glsl"
/*!**************************************************!*\
  !*** ./extensions/ViewCubeUi/ViewCube.vert.glsl ***!
  \**************************************************/
(module) {

module.exports = "varying vec2 vUv;\nvarying vec3 vNormal;\nvarying vec3 vPosition;\nvoid main() {\n    vUv = uv;\n    vNormal = normalize(mat3(modelMatrix) * normal);\n    vPosition = position;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n";

/***/ },

/***/ "./extensions/ViewCubeUi/ViewCube.js"
/*!*******************************************!*\
  !*** ./extensions/ViewCubeUi/ViewCube.js ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ViewCube: () => (/* binding */ ViewCube)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _ViewCubeShader_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ViewCubeShader.js */ "./extensions/ViewCubeUi/ViewCubeShader.js");
/* harmony import */ var _ViewCubeAtlasGenerator_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./ViewCubeAtlasGenerator.js */ "./extensions/ViewCubeUi/ViewCubeAtlasGenerator.js");



const av = Autodesk.Viewing;
const avp = av.Private;

const { createShaderMaterial } = avp.ShaderUtils;
const WebGLRenderer = avp.WebGLRenderer;
const logger = avp.logger;
const isMobileDevice = av.isMobileDevice;
const { errorCodeString, ErrorCodes } = av;
const endpoint = av.endpoint;
const GlobalManagerMixin = av.GlobalManagerMixin;
const EPSILON = 0.00001;

/**
 * Checks if a number is 1 (or really, really close to 1). Things like 0.9999999999999 still count. This is needed
 * because THREE.Vector3.normalize doesn't always create a vector with length exactly 1, sometimes it just gets close.
 * For example:
 * var t = new THREE.Vector3(0, 0, -0.6873695734180347);
 * t.normalize();
 * t.z; // -0.9999999999999999
 *
 * @param {Number} a - Number to check
 * @return {boolean} - True if the given number is within 1e-12 of 1
 */
var equalsOne = function (a) {
  return Math.abs(a - 1) < 1e-12;
};

/**
 * Check if a vector is aligned with an axis and has a length of 1
 *
 * @param {Vector3} vec3 - The vector to check
 * @return {boolean} - True if the vector is aligned to an axis and has length 1
 */
var isAxisAlignedUnit = function (vec3) {
  return !(
  !equalsOne(vec3.length()) ||
  !equalsOne(Math.abs(vec3.x)) && !equalsOne(Math.abs(vec3.y)) && !equalsOne(Math.abs(vec3.z)));

};

const COLOR_ARROW = 0xB7B9BC;

// A Triad representing the model's coordinates
function Triad(triadLength) {
  var offSet = triadLength / 2;
  var triadThickness = 10;
  var spriteSize = 50;
  var triadColors = {
    x: 0xff0000,
    y: 0x00ff00,
    z: 0x0000ff
  };
  var tempMatrix = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4(); // A matrix for temporary calculations
  var sprites = []; // For tracking things that need to always face the camera

  var spriteGeometry = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(spriteSize, spriteSize);
  var getTextSprite = function (text, color) {
    var _document = av.getGlobal().document;
    var textCanvas = _document.createElement('canvas');
    textCanvas.width = textCanvas.height = 128;
    var ctx2d = textCanvas.getContext('2d');
    ctx2d.font = '128px Arial';
    ctx2d.fillStyle = "rgba(255,255,255,1)";
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(text, textCanvas.width / 2, textCanvas.height / 2);

    var textTexture = new three__WEBPACK_IMPORTED_MODULE_0__.Texture(textCanvas);
    textTexture.needsUpdate = true;

    return new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(
      spriteGeometry,
      new Autodesk.Viewing.Scene.UnlitMaterial({
        map: textTexture,
        side: three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide,
        transparent: true,
        color: color,
        depthWrite: false,
        depthTest: true
      })
    );
  };

  this.triadScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();
  this.triadLabelScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();

  // Add the axes.
  var triadGeom = new three__WEBPACK_IMPORTED_MODULE_0__.BoxGeometry(triadLength, triadThickness, triadThickness);
  var xAxis = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(triadGeom, new Autodesk.Viewing.Scene.UnlitMaterial(
    { color: triadColors.x }));
  var yAxis = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(triadGeom, new Autodesk.Viewing.Scene.UnlitMaterial(
    { color: triadColors.y }));
  var zAxis = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(triadGeom, new Autodesk.Viewing.Scene.UnlitMaterial(
    { color: triadColors.z }));

  xAxis.applyMatrix4(tempMatrix.makeTranslation(triadThickness / 2, -offSet, -offSet));
  yAxis.applyMatrix4(tempMatrix.makeRotationZ(Math.PI / 2));
  yAxis.applyMatrix4(tempMatrix.makeTranslation(-offSet, triadThickness / 2, -offSet));
  zAxis.applyMatrix4(tempMatrix.makeRotationY(Math.PI / 2));
  zAxis.applyMatrix4(tempMatrix.makeTranslation(-offSet, -offSet, triadThickness / 2));

  this.triadScene.add(xAxis);
  this.triadScene.add(yAxis);
  this.triadScene.add(zAxis);

  // Add text
  var xSprite = getTextSprite('X', triadColors.x);
  var ySprite = getTextSprite('Y', triadColors.y);
  var zSprite = getTextSprite('Z', triadColors.z);

  // Rotate the text to match the up direction. Only rotate the positions, otherwise orienting them to face the
  // camera becomes more complicated
  var positionLabels = function (quaternion) {
    var spriteSecondaryAxisOffSet = -(spriteSize + offSet) / 2 - 20;
    var spriteMainAxisOffset = offSet + spriteSize;
    xSprite.position.set(spriteMainAxisOffset, spriteSecondaryAxisOffSet, spriteSecondaryAxisOffSet);
    ySprite.position.set(spriteSecondaryAxisOffSet, spriteMainAxisOffset, spriteSecondaryAxisOffSet);
    zSprite.position.set(spriteSecondaryAxisOffSet, spriteSecondaryAxisOffSet, spriteMainAxisOffset);

    if (quaternion) {
      xSprite.position.applyQuaternion(quaternion);
      ySprite.position.applyQuaternion(quaternion);
      zSprite.position.applyQuaternion(quaternion);
    }
  };
  positionLabels();

  // Add them to the list of sprites to keep them oriented correctly
  sprites.push(xSprite);
  sprites.push(ySprite);
  sprites.push(zSprite);

  this.triadLabelScene.add(xSprite);
  this.triadLabelScene.add(ySprite);
  this.triadLabelScene.add(zSprite);

  /**
   * Reorients the triad so that the model coordinates are represented correctly. If the resulting orientation of the
   * triad will not be aligned with X/Y/Z, nothing happens.
   *
   * @param {Vector3} sceneUp - The scene up. Expected to be a unit vector.
   * @param {Vector3} sceneFront - The scene front. Expected to be a unit vector.
   */
  this.orient = function (sceneUp, sceneFront) {
    if (!isAxisAlignedUnit(sceneUp) || !isAxisAlignedUnit(sceneFront)) {
      return;
    }

    // Only reorient if something changed
    if (this.up && this.front && sceneUp.equals(this.up) && sceneFront.equals(this.front)) {
      return;
    }

    this.up = sceneUp.clone();
    this.front = sceneFront.clone();

    // The triad starts with Y up with each line pointing towards the positive direction of its axis.
    // Orienting the triad to align with scene up and world front is done in 2 steps
    // 1. Get the correct axis aligned with vertical (rotate about [1, 1, 1]) and keep it in line with the viewcube
    // 2. Rotate about scene up to align the correct axis and direction with world front
    // 3. Rotate about world front to get the correct direction for scene up

    // Align scene up
    // secondaryAxis and tertiaryAxis are used to work out which axes to check for aligning the front, simplifying
    // the if statements a bit
    var upAxis,secondaryAxis,tertiaryAxis,alignmentAngle = 0,frontAngle = 0,upAngle = 0;
    if (sceneUp.x) {
      upAxis = 'x';
      secondaryAxis = 'y';
      tertiaryAxis = 'z';
      alignmentAngle = 2 * Math.PI / 3;
    } else if (sceneUp.y) {
      upAxis = 'y';
      secondaryAxis = 'z';
      tertiaryAxis = 'x';
    } else if (sceneUp.z) {
      upAxis = 'z';
      secondaryAxis = 'x';
      tertiaryAxis = 'y';
      alignmentAngle = -2 * Math.PI / 3;
    }

    // Align front
    if (equalsOne(-sceneFront[secondaryAxis])) {
      // The 'secondaryAxis' is already parallel to the front so we need to decide we need a half rotation
      frontAngle = Math.PI;
    } else if (sceneFront[tertiaryAxis]) {
      // The 'tertiaryAxis' is orthogonal to the front so we need a quarter rotation but have to decide which way
      // to rotate. Direction is dependent on whether we need front to be + or - as well as whether sceneUp is + or -
      // since that's the axis we'll be rotating around
      frontAngle = -sceneFront[tertiaryAxis] * sceneUp[upAxis] * Math.PI / 2;
    }

    // Correct up direction
    upAngle = equalsOne(-sceneUp[upAxis]) ? Math.PI : 0;

    var tempQuaternion = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();
    var rotationQuaternion = new three__WEBPACK_IMPORTED_MODULE_0__.Quaternion();

    // Step 1
    var rotationAxis = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(1, 1, 1);
    rotationAxis.normalize();
    rotationQuaternion.setFromAxisAngle(rotationAxis, alignmentAngle);

    // Step 2
    tempQuaternion.setFromAxisAngle(sceneUp, frontAngle);
    rotationQuaternion.multiply(tempQuaternion);

    // Step 3
    tempQuaternion.setFromAxisAngle(sceneFront, upAngle);
    rotationQuaternion.multiply(tempQuaternion);

    positionLabels(rotationQuaternion);
    this.triadScene.setRotationFromQuaternion(rotationQuaternion);
  };

  this.getSprites = function () {return sprites;};
}

/* All coordinates in three.js are right handed
 * when looking at the Front of the Cube in the regular upright position: */
/**
 * This is the view cube class subset of Autocam
 * this class renders and provides all functionality for the view cube
 * @class
 * @param {string} tagId - html tag id where you want the view cube to render - OBSOLETE
 * @param {Object} autocam - the autocam controller object
 * @param {HTMLDivElement} cubeContainer - the HTML element to contain the view cube
 * @param {Object} [options] - the optional options
 * @param {string} [options.showTriad] - whether to show the triad. 'up' is given by autocam's world up
 * */
function ViewCube(tagId, autocam, cubeContainer, options) {

  var self = this;
  GlobalManagerMixin.call(this);

  var cam = autocam;
  var camera = autocam.camera;
  autocam.setCube(this);

  const viewDir = cam.center.clone().sub(camera.position).normalize();
  const sceneRight = cam.sceneFrontDirection.clone().cross(cam.sceneUpDirection);
  const dotUp = viewDir.dot(cam.sceneUpDirection);
  const dotFront = viewDir.dot(cam.sceneFrontDirection);
  const dotRight = viewDir.dot(sceneRight);

  if (1 - Math.abs(dotUp) < EPSILON) {
    self.currentFace = dotUp > 0 ? "bottom" : "top";
  } else if (1 - Math.abs(dotFront) < EPSILON) {
    self.currentFace = dotFront > 0 ? "front" : "back";
  } else if (1 - Math.abs(Math.abs(dotRight)) < EPSILON) {
    self.currentFace = dotRight > 0 ? "left" : "right";
  } else {
    self.currentFace = "front";
  }

  self.showTriad = options && options.showTriad;

  var edgeNames = ["top,front", "top right", "top,left", "top,back", "bottom,front", "bottom,right", "bottom,left", "bottom,back", "left,front", "front,right", "right,back", "back,left"];
  var cornerNames = ["front,top,right", "back,top,right", "front,top,left", "back,top,left", "front,bottom,right", "back,bottom,right", "front,bottom,left", "back,bottom,left"];

  /**
    *  A string array which contains the options for the view cube menu. Use null to indicate a section separator
    * @type {Array}
    */
  var menuOptionList = [
  "Go Home", // localized by call to drawDropdownMenu
  null,
  "Orthographic", // localized by call to drawDropdownMenu
  "Perspective", // localized by call to drawDropdownMenu
  "Perspective with Ortho Faces", // localized by call to drawDropdownMenu
  null,
  "Set current view as Home", // localized by call to drawDropdownMenu
  "Focus and set as Home", // localized by call to drawDropdownMenu
  "Reset Home", // localized by call to drawDropdownMenu
  null,
  "Set current view as Front", // localized by call to drawDropdownMenu
  "Set current view as Top", // localized by call to drawDropdownMenu
  "Reset orientation" // localized by call to drawDropdownMenu
  /*
  null,
  "Properties...",
  null,
  "Help..."
  */];

  var menuEnableList = [
  true,
  null,
  true,
  true,
  true,
  null,
  true,
  true,
  true,
  null,
  true,
  true,
  true
  /*
  null,
  "Properties...",
  null,
  "Help..."
  */];

  var menuStateCallbackList = [
  null,
  null,
  function () {return !cam.orthographicFaces && !camera.isPerspective;},
  function () {return !cam.orthographicFaces && camera.isPerspective;},
  function () {return cam.orthographicFaces;},
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null
  /*
  null,
  "Properties...",
  null,
  "Help..."
  */];


  // THREE.js Scenes
  var shadowScene, cubeScene, gridScene, lineScene, triad, controlScene, compassScene;

  // An array of objects that need to always face the camera
  var sprites = [];

  var controlCamera;
  // self.camera = new THREE.PerspectiveCamera( camera.fov, window.innerWidth / window.innerHeight, 1, 10000 );
  // make two cameras to flip between, depending if perspective or orthographic view is used.
  // TODO: scale keeps the size of the view cube the same; 45 fov used to be the default FOV. Problem with this
  // idea is that you also then need to adjust the position (and not below - setting it there does nothing) and this
  // will change the look of the perspective cube.
  self.pcam = new three__WEBPACK_IMPORTED_MODULE_0__.PerspectiveCamera(45, 1.0, 1, 2000); // aspect gets truly set during Init()
  self.ocam = new three__WEBPACK_IMPORTED_MODULE_0__.OrthographicCamera(-265, 265, 265, -265, -1000, 1000);
  self.ocam.fov = self.pcam.fov;
  self.ocam.aspect = self.pcam.aspect;
  self.camera = camera.isPerspective ? self.pcam : self.ocam;
  self.camera.position.copy(camera.position);
  self.center = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 0);
  self.camera.lookAt(self.center);
  // var length = camera.position.length();

  // THREE.js Meshes
  var cube, line, home, shadow, context;
  var gridMeshes = [];
  var arrowGroup;

  // Sizes for Three.js renderers
  //var windowHalfX;
  //var windowHalfY;

  // Buffers and past INTERSECTS used for mouse picking
  var arrowBuffer = [];
  var intersectsFace = [];
  var controlBuffer = [];
  var cubeBuffer = [];
  var INTERSECTED = null;
  var INTERSECTED_F = null;
  var INTERSECTED_C = null;
  var rollLeftOffset, rollRightOffset, rollOffset;
  var homeOffset, menuOffset;

  // Size of cube in relation to HTML tag
  var cubeSize = 0;

  // Position of HTML element
  var position;

  // Used to wait for textures to load before rendering the View Cube
  var loadedTextureCount = 0;

  // Flags
  // Whether arrows (orthogonal and roll) are visible (i.e., you're directly facing a cube face).
  var _orthogonalView = true;
  var _havePointerLockFeature = false;
  var _havePointerLock = false;
  var _pointerLockMoveBugSPK865 = false;
  var _isChrome = navigator.userAgent.search("Chrome") != -1;
  var _isWindows = navigator.platform.search("Win32") != -1;
  var _dragged = false;
  var _transparent = false;

  // Callback for menu selected item
  var _onViewTypeChangedCb = null;

  // store all loaded textures here so we are not constantly re-downloading them
  var changingTextures = [];

  // Height and Width of the renderer
  // may be referred to as self.width and self.height
  this.width = 0;
  this.height = 0;

  // Public changeable values
  /**
   * view cube animation speed (not 0 or negative),
   * specified in time (milliseconds) to complete an animation
   * @type {Number}
   */
  this.animSpeed = 500;
  /**
   * turn on and off animation
   * @type {Boolean}
   */
  this.animate = true;
  /**
   * turn on and off ability to drag the view cube
   * @type {Boolean}
   */

  this.compass = false;
  this.viewScaleFactorCompass = 1.5;
  this.viewScale = 1; // Set in Init based on cubeSize

  this.draggable = true;

  /**
   * turn on and off the availability of the home button;
   * note, this is a "second", smaller home button, you probably
   * do not want it.
   * @type {Boolean}
   */
  this.wantHomeButton = false;

  /**
   * turn on and off the availability of the roll arrows
   * @type {Boolean}
   */
  this.wantRollArrows = true;

  /**
   * turn on and off the availability of the menu icon
   * @type {Boolean}
   */
  this.wantContextMenu = true;

  /**
   * opacity when inactive (transparency must be enabled)
   * @type {Number}
   */
  this.inactiveOpacity = 0.5;

  /** Function to get position of html element on screen
   *
   * @param element - HTML DOM element to find position of
   * @return {Object} - object which specifies x and y screen coordinates of location of input element
   */
  var getPosition = function (element) {
    var rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  };

  /** Used by pointer lock API
   *
   * @param {Object} e - event object
   */
  var pointerLockChange = function (e) {
    e.preventDefault();
    e.stopPropagation();

    var _document = self.getDocument();
    _havePointerLock = _document.pointerLockElement === cubeContainer ||
    _document.mozPointerLockElement === cubeContainer ||
    _document.webkitPointerLockElement === cubeContainer;
  };

  var setControlsPositions = function () {
    const rollArrowMargin = 30;
    if (self.renderCompass) {
      self.rollMesh.position.set(cubeSize + rollArrowMargin, cubeSize + rollArrowMargin, 0);
      self.rollLeftMesh.position.set(cubeSize + rollArrowMargin, 1.5 * cubeSize, 0.1);
      self.rollRightMesh.position.set(1.5 * cubeSize, cubeSize + rollArrowMargin, 0.1);
      self.contextMesh.position.set(1.6 * cubeSize, -1.6 * cubeSize, 0);
    } else {
      self.rollMesh.position.set(cubeSize * 0.5 + 20, cubeSize * 0.5 + 20, 0);
      self.rollLeftMesh.position.set(cubeSize * 0.5 + 20, cubeSize + 20, 0.1);
      self.rollRightMesh.position.set(cubeSize + 20, cubeSize * 0.5 + 20, 0.1);
      self.contextMesh.position.set(cubeSize, -cubeSize, 0);
    }
  };

  /** Create ViewCube and set up renderer and camera
   * sets up all Three.js meshes for the View Cube
   * and initializes all event handlers such as mousemove
   * and mousedown and mouseup and pointerlock
   */
  var Init = function () {
    var bounds = cubeContainer.getBoundingClientRect();
    self.width = bounds.width;
    self.height = bounds.height;

    position = getPosition(cubeContainer);

    //camera for home and arrow
    controlCamera = new three__WEBPACK_IMPORTED_MODULE_0__.PerspectiveCamera(70, self.height / self.width, 1, 10000);
    controlCamera.position.set(0, 0, 500);

    shadowScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();
    cubeScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();
    gridScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();
    lineScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();
    controlScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();
    _orthogonalView = true;

    // This size means that the cube is (cubeSize)x(cubeSize)x(cubeSize) big
    cubeSize = 160;
    // This adjusts the camera position in perspective view. Has no effect on orthographic cams
    self.viewScale = cubeSize * 4;

    /******************************************Create the View Cube***********************************************/

    var material = self.refreshTexture();

    var filteringType = three__WEBPACK_IMPORTED_MODULE_0__.LinearFilter;
    var getResourceUrl = Autodesk.Viewing.Private.getResourceUrl;
    var resRoot = 'res/textures/';

    var cubeGeometry = new three__WEBPACK_IMPORTED_MODULE_0__.BoxGeometry(cubeSize, cubeSize, cubeSize, 4, 4, 4);
    var cubeLine = new three__WEBPACK_IMPORTED_MODULE_0__.BoxGeometry(cubeSize + 1, cubeSize + 1, cubeSize + 1, 4, 4, 4);

    // Create a cube object mesh with specified geometry and faceMap materials
    cube = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(cubeGeometry, material);
    cube.position.set(0.0, 0, 0);
    cubeScene.add(cube);

    // Set up a line segment for the cube border
    var borderTexture = loadTexture(getResourceUrl(resRoot + 'VCedge1.png'));

    borderTexture.minFilter = borderTexture.maxFilter = filteringType;

    line = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(cubeLine, new Autodesk.Viewing.Scene.UnlitMaterial({ map: borderTexture, transparent: true }));
    line.position.set(0.0, 0, 0);
    lineScene.add(line);

    // Set up the triad
    triad = new Triad(cubeSize + 20);
    Array.prototype.push.apply(sprites, triad.getSprites());

    /********************************************Set up the controls**********************************************/

    // Orthogonal Arrows

    var arrowDist = cubeSize + 5;

    var arrowGeo = new three__WEBPACK_IMPORTED_MODULE_0__.BufferGeometry();

    const vertices = new Float32Array([
    -30, 0, 0,
    30, 0, 0,
    0, -30, 0]
    );
    arrowGeo.setAttribute('position', new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(vertices, 3));


    const indices = [1, 0, 2];
    arrowGeo.index = new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(new Uint16Array(indices), 1);

    // Arrows are rendered flat over other mesh, so it's depthTest and depthWrite can be turned off
    var arrowMaterial1 = new Autodesk.Viewing.Scene.UnlitMaterial({ color: COLOR_ARROW,
      depthTest: false, depthWrite: false, transparent: false, opacity: 1 });
    var arrowMaterial2 = new Autodesk.Viewing.Scene.UnlitMaterial({ color: COLOR_ARROW,
      depthTest: false, depthWrite: false, transparent: false, opacity: 1 });
    var arrowMaterial3 = new Autodesk.Viewing.Scene.UnlitMaterial({ color: COLOR_ARROW,
      depthTest: false, depthWrite: false, transparent: false, opacity: 1 });
    var arrowMaterial4 = new Autodesk.Viewing.Scene.UnlitMaterial({ color: COLOR_ARROW,
      depthTest: false, depthWrite: false, transparent: false, opacity: 1 });

    var arrowSelection = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(cubeSize * 0.5, cubeSize * 0.3, 2, 2);
    var arrowSelectionMat = new Autodesk.Viewing.Scene.UnlitMaterial({ transparent: true, opacity: 0.0 });

    var upArrow = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowGeo, arrowMaterial1);
    var upArrowSelect = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowSelection, arrowSelectionMat);
    upArrow.position.set(0, arrowDist, 0.0);
    upArrowSelect.position.set(0, arrowDist * 0.9, 0.1);

    var downArrow = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowGeo, arrowMaterial2);
    var downArrowSelect = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowSelection, arrowSelectionMat);
    downArrow.position.set(0, -arrowDist, 0.0);
    downArrowSelect.position.set(0, -arrowDist * 0.9, 0.1);
    downArrow.rotation.z += Math.PI;
    downArrowSelect.rotation.z += Math.PI;

    var rightArrow = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowGeo, arrowMaterial3);
    var rightArrowSelect = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowSelection, arrowSelectionMat);
    rightArrow.position.set(arrowDist, 0, 0.0);
    rightArrowSelect.position.set(arrowDist * 0.9, 0, 0.1);
    rightArrow.rotation.z -= Math.PI / 2;
    rightArrowSelect.rotation.z -= Math.PI / 2;

    var leftArrow = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowGeo, arrowMaterial4);
    var leftArrowSelect = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(arrowSelection, arrowSelectionMat);
    leftArrow.position.set(-arrowDist, 0, 0.0);
    leftArrowSelect.position.set(-arrowDist * 0.9, 0, 0.1);
    leftArrow.rotation.z += Math.PI / 2;
    leftArrowSelect.rotation.z += Math.PI / 2;

    arrowGroup = new three__WEBPACK_IMPORTED_MODULE_0__.Object3D();
    arrowGroup.position.set(0, 0, 0);
    arrowGroup.add(upArrow);
    arrowGroup.add(downArrow);
    arrowGroup.add(rightArrow);
    arrowGroup.add(leftArrow);

    controlScene.add(upArrowSelect);
    controlScene.add(downArrowSelect);
    controlScene.add(rightArrowSelect);
    controlScene.add(leftArrowSelect);
    controlScene.add(arrowGroup);

    arrowBuffer.push(upArrowSelect);
    arrowBuffer.push(downArrowSelect);
    arrowBuffer.push(rightArrowSelect);
    arrowBuffer.push(leftArrowSelect);

    // Home icon
    var homeGeo = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(cubeSize / 3, cubeSize / 3, 2, 2);
    var homeMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({ map: loadTexture(getResourceUrl(resRoot + 'VChome.png')),
      transparent: true });
    home = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(homeGeo, homeMaterial);
    home.position.set(-cubeSize, cubeSize, 0);

    homeOffset = controlBuffer.length;
    controlScene.add(home);
    controlBuffer.push(home);

    // Arrows for rolling
    var rollArrows = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(cubeSize * 1.5, cubeSize * 1.5, 2, 2);
    var rollMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
      map: loadTexture(getResourceUrl(resRoot + 'VCarrows.png')),
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    var roll = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(rollArrows, rollMaterial);
    self.rollMesh = roll;

    var rollSelectionLeft = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(cubeSize * 0.6, cubeSize * 0.45, 2, 2);
    var rollSelectionLeftMat = new Autodesk.Viewing.Scene.UnlitMaterial({ transparent: true, opacity: 0.0 });
    var rollLeft = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(rollSelectionLeft, rollSelectionLeftMat);
    self.rollLeftMesh = rollLeft;

    var rollSelectionRight = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(cubeSize * 0.45, cubeSize * 0.6, 2, 2);
    var rollSelectionRightMat = new Autodesk.Viewing.Scene.UnlitMaterial({ transparent: true, opacity: 0.0 });
    var rollRight = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(rollSelectionRight, rollSelectionRightMat);
    self.rollRightMesh = rollRight;

    controlScene.add(roll);
    controlScene.add(rollLeft);
    controlScene.add(rollRight);

    rollLeftOffset = controlBuffer.length;
    controlBuffer.push(rollLeft);
    rollRightOffset = controlBuffer.length;
    controlBuffer.push(rollRight);
    rollOffset = controlBuffer.length;
    controlBuffer.push(roll);

    //Menu Icon
    var contextGeo = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(cubeSize / 2.3, cubeSize / 2.3, 2, 2);
    var contextMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
      map: loadTexture(getResourceUrl(resRoot + 'VCcontext.png')),
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    context = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(contextGeo, contextMaterial);
    self.contextMesh = context;

    menuOffset = controlBuffer.length;
    controlScene.add(context);
    controlBuffer.push(context);

    // Move the controls to right positions
    setControlsPositions();

    // Cube Shadow (Plane)

    var shadowGeo = new three__WEBPACK_IMPORTED_MODULE_0__.BufferGeometry();
    const shadowToCubeDist = Math.floor(cubeSize * 0.20 / 2) || 20;

    let vertices2 = new Float32Array(
      [
      0, 0, 0,
      -cubeSize / 2, -cubeSize / 2 - shadowToCubeDist, -cubeSize / 2,
      cubeSize / 2, -cubeSize / 2 - shadowToCubeDist, -cubeSize / 2,
      cubeSize / 2, -cubeSize / 2 - shadowToCubeDist, cubeSize / 2,
      -cubeSize / 2, -cubeSize / 2 - shadowToCubeDist, cubeSize / 2]);
    shadowGeo.setAttribute('position', new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(vertices2, 3));


    const indices1 = [
    4, 3, 2,
    4, 2, 1];


    shadowGeo.index = new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(new Uint16Array(indices1), 1);

    var shadowMat;

    shadowMat = new Autodesk.Viewing.Scene.UnlitMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });

    shadow = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(shadowGeo, shadowMat);
    shadowScene.add(shadow);

    createCubeGrid();

    if (cam.renderer.toUpperCase() === 'CANVAS') {
      self.renderer = new three__WEBPACK_IMPORTED_MODULE_0__.CanvasRenderer();

    } else if (cam.renderer.toUpperCase() === 'WEBGL') {
      self.renderer = new WebGLRenderer({ alpha: true, antialias: true });
      self.renderer.name = 'ViewCubeRenderer';
    } else {
      logger.warn("Incorrect use of Autocam.renderer property");
      self.renderer = new three__WEBPACK_IMPORTED_MODULE_0__.CanvasRenderer();
    }

    self.useTransparency(true);
    self.setSize(self.width, self.height);

    self.camera.topFov = self.camera.bottomFov = self.camera.fov / 2;
    self.camera.leftFov = self.camera.rightFov = self.camera.aspect * self.camera.fov / 2;
    // need to copy to camera templates - half of these statements do nothing, since the camera points at pcam or ocam, but simpler than an if statement.
    self.pcam.topFov = self.ocam.topFov = self.camera.topFov;
    self.pcam.bottomFov = self.ocam.bottomFov = self.camera.bottomFov;
    self.pcam.leftFov = self.ocam.leftFov = self.camera.leftFov;
    self.pcam.rightFov = self.ocam.rightFov = self.camera.rightFov;

    // Auto clear needed because of multiple scenes
    self.renderer.autoClear = false;
    self.renderer.setSize(self.width, self.height);
    self.renderer.sortObjects = false;
    cubeContainer.appendChild(self.renderer.domElement);

    // Initialize all event handlers
    cubeContainer.addEventListener('touchstart', onDocumentMouseDown, false);
    cubeContainer.addEventListener('mousedown', onDocumentMouseDown, false);
    cubeContainer.addEventListener('mousemove', onDocumentMouseMove, false);

    /*
            _havePointerLockFeature = 'pointerLockElement' in document ||
                                      'mozPointerLockElement' in document ||
                                      'webkitPointerLockElement' in document;
    */
    //Disabling this because it causes an intrusive browser pop-up asking
    //whether I want to allow full screen mode to happen (huh?)
    _havePointerLockFeature = false;

    if (_havePointerLockFeature) {
      var _document = self.getDocument();
      _document.exitPointerLock = _document.exitPointerLock ||
      _document.mozExitPointerLock ||
      _document.webkitExitPointerLock;

      cubeContainer.requestPointerLock = cubeContainer.requestPointerLock ||
      cubeContainer.mozRequestPointerLock ||
      cubeContainer.webkitRequestPointerLock;

      // Hook pointer lock state change events
      self.addDocumentEventListener('pointerlockchange', pointerLockChange, false);
      self.addDocumentEventListener('mozpointerlockchange', pointerLockChange, false);
      self.addDocumentEventListener('webkitpointerlockchange', pointerLockChange, false);
    }

    // Changing textures (blue highlighting for home and roll arrows)
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VChomeS.png')));
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VCarrowsS0.png')));
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VCarrowsS1.png')));
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VChome.png')));
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VCarrows.png')));
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VCcontext.png')));
    changingTextures.push(loadTexture(getResourceUrl(resRoot + 'VCcontextS.png')));
  };

  /** Used to make cube visible again when using the transparency option   */
  var mouseOverCube = function () {
    if (cam.navApi.isActionEnabled('orbit')) {
      cubeContainer.style.opacity = "1.0";
      _transparent = false;
    }
    requestAnimationFrame(self.render);
  };

  /** Used to fade in and out the cube when using the transparency option */
  var mouseMoveOverCube = function (event) {
    if (!_transparent && !cam.viewCubeMenuOpen && cam.navApi.isActionEnabled('orbit')) {
      var x = Math.max(Math.abs((event.clientX - position.x) / position.w - 0.5) * 4.0 - 1.0, 0);
      var y = Math.max(Math.abs((event.clientY - position.y) / position.h - 0.5) * 4.0 - 1.0, 0);
      var d = Math.max(0, Math.min(Math.sqrt(x * x + y * y), 1.0));
      cubeContainer.style.opacity = 1.0 - d * (1.0 - self.inactiveOpacity);
    } else
    if (cam.navApi.isActionEnabled('orbit')) {
      cubeContainer.style.opacity = 1.0;
    }
  };

  /** Used to make cube transparent when using the transparency option */
  var mouseOutCube = function () {
    if (cam.viewCubeMenuOpen) {
      return;
    }
    cubeContainer.style.opacity = self.inactiveOpacity;
    _transparent = true;
    requestAnimationFrame(self.render);
  };


  /** Takes in a image url and outputs a THREE.texture to be used
   * by Three.js materials
   * @param {string} url - path to the image you want to load as a texture
   * @return {THREE.Texture}
   */
  var loadTexture = function (url) {
    var image = new Image();
    var _window = self.getWindow();
    var useCredentials = endpoint.getUseCredentials() && (url.indexOf('://') === -1 || url.indexOf(_window.location.host) !== -1);
    if (useCredentials && endpoint.getUseCookie()) {
      image.crossOrigin = "use-credentials";
    } else {
      image.crossOrigin = "anonymous";
    }
    var texture = new three__WEBPACK_IMPORTED_MODULE_0__.Texture(image);
    image.onload = function () {
      texture.needsUpdate = true;
      loadedTextureCount++;
      if (loadedTextureCount >= 11) {
        // all textures are now loaded
        requestAnimationFrame(self.render);
      }
    };

    image.src = url;
    return texture;
  };

  /** Creates the click-able grid around the View Cube
   *  by running functions to create Three.js meshes
   */
  var createCubeGrid = function () {
    var currentGridLength;
    var cubeCorners = [];
    var cubeEdges = [];

    cubeCorners[0] = buildCubeCorner(0, 0);
    cubeCorners[1] = buildCubeCorner(0, Math.PI / 2);
    cubeCorners[2] = buildCubeCorner(0, -Math.PI / 2);
    cubeCorners[3] = buildCubeCorner(0, Math.PI);
    cubeCorners[4] = buildCubeCorner(Math.PI / 2, 0);
    cubeCorners[5] = buildCubeCorner(Math.PI / 2, Math.PI / 2);
    cubeCorners[6] = buildCubeCorner(Math.PI / 2, -Math.PI / 2);
    cubeCorners[7] = buildCubeCorner(Math.PI / 2, Math.PI);

    cubeEdges[0] = buildCubeEdge(0, 0, 0);
    cubeEdges[1] = buildCubeEdge(0, Math.PI / 2, 0);
    cubeEdges[2] = buildCubeEdge(0, -Math.PI / 2, 0);
    cubeEdges[3] = buildCubeEdge(0, Math.PI, 0);
    cubeEdges[4] = buildCubeEdge(Math.PI / 2, 0, 0);
    cubeEdges[5] = buildCubeEdge(Math.PI / 2, Math.PI / 2, 0);
    cubeEdges[6] = buildCubeEdge(Math.PI / 2, -Math.PI / 2, 0);
    cubeEdges[7] = buildCubeEdge(Math.PI / 2, Math.PI, 0);
    cubeEdges[8] = buildCubeEdge(0, 0, Math.PI / 2);
    cubeEdges[9] = buildCubeEdge(0, 0, -Math.PI / 2);
    cubeEdges[10] = buildCubeEdge(-Math.PI / 2, 0, -Math.PI / 2);
    cubeEdges[11] = buildCubeEdge(-Math.PI, 0, -Math.PI / 2);

    // Draw the front square on the grid
    gridMeshes.push(buildCubeFace(0, 0));
    gridMeshes[0].name = 'front';
    intersectsFace.push(gridMeshes[0]);
    cubeBuffer.push(gridMeshes[0]);
    gridScene.add(gridMeshes[0]);

    // Draw the right square on the grid
    gridMeshes.push(buildCubeFace(0, Math.PI / 2));
    gridMeshes[1].name = 'right';
    intersectsFace.push(gridMeshes[1]);
    cubeBuffer.push(gridMeshes[1]);
    gridScene.add(gridMeshes[1]);

    // Draw the back square on the grid
    gridMeshes.push(buildCubeFace(0, Math.PI));
    gridMeshes[2].name = 'back';
    intersectsFace.push(gridMeshes[2]);
    cubeBuffer.push(gridMeshes[2]);
    gridScene.add(gridMeshes[2]);

    // Draw the left grid
    gridMeshes.push(buildCubeFace(0, -Math.PI / 2));
    gridMeshes[3].name = 'left';
    intersectsFace.push(gridMeshes[3]);
    cubeBuffer.push(gridMeshes[3]);
    gridScene.add(gridMeshes[3]);

    // Draw the bottom grid
    gridMeshes.push(buildCubeFace(Math.PI / 2, 0));
    gridMeshes[4].name = 'bottom';
    intersectsFace.push(gridMeshes[4]);
    cubeBuffer.push(gridMeshes[4]);
    gridScene.add(gridMeshes[4]);

    // Draw the top grid
    gridMeshes.push(buildCubeFace(-Math.PI / 2, 0));
    gridMeshes[5].name = 'top';
    intersectsFace.push(gridMeshes[5]);
    cubeBuffer.push(gridMeshes[5]);
    gridScene.add(gridMeshes[5]);

    currentGridLength = gridMeshes.length;

    var i;
    for (i = 0; i < cubeCorners.length; i++) {
      gridMeshes.push(cubeCorners[i]);
      gridMeshes[currentGridLength + i].name = cornerNames[i];
      gridScene.add(gridMeshes[currentGridLength + i]);
      intersectsFace.push(gridMeshes[currentGridLength + i]);
      cubeBuffer.push(gridMeshes[currentGridLength + i]);
    }

    currentGridLength = gridMeshes.length;

    for (i = 0; i < cubeEdges.length; i++) {
      gridMeshes.push(cubeEdges[i]);
      gridMeshes[currentGridLength + i].name = edgeNames[i];
      gridScene.add(gridMeshes[currentGridLength + i]);
      intersectsFace.push(gridMeshes[currentGridLength + i]);
      cubeBuffer.push(gridMeshes[currentGridLength + i]);
    }
  };


  /**
   * Get intersections between a mesh and mouse position (mouse picking)
   * @param {THREE.Vector3} pickingVector - direction vector to find intersections
   * @param {THREE.Camera} camera
   * @param {THREE.Mesh[]} intersectionBuffer - an array of three.js meshes to check for intersections with these specific meshes
   * @return {Object[]} - objects which were intersected
   */
  var findPickingIntersects = function (pickingVector, camera, intersectionBuffer) {
    var raycaster;

    var direction = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
    if (camera.type === "PerspectiveCamera") {
      direction.copy(pickingVector);
      // retrieve point on view plane to shoot ray through
      direction.unproject(camera);
      // direction is target point minus position
      raycaster = new three__WEBPACK_IMPORTED_MODULE_0__.Raycaster(camera.position, direction.sub(camera.position).normalize());
    } else {
      // orthographic
      var target = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3();
      target.copy(pickingVector);
      // retrieve point on view plane to shoot ray through
      target.unproject(camera);

      // direction is constant, from position to origin.
      // direction is negative of position
      direction.copy(camera.position).negate().normalize();
      raycaster = new three__WEBPACK_IMPORTED_MODULE_0__.Raycaster(target, direction);
    }

    return raycaster.intersectObjects(intersectionBuffer);

  };

  var getPickVector = function (event, position) {
    var x = event.clientX - position.x;
    var y = event.clientY - position.y;

    x = x / position.w * 2.0 - 1.0;
    y = (position.h - y) / position.h * 2.0 - 1.0;

    return new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(x, y, 0.5);
  };

  /* never used
  function isFullscreen() {
      return document.fullscreenElement ||
             document.webkitFullscreenElement ||
             document.mozFullScreenElement ||
             document.msFullscreenElement;
  }
  */

  function getEventCoords(event, self) {
    var coords = {};

    if (event.type.indexOf("touch") === 0) {
      if (event.touches.length > 0) {
        coords.clientX = event.touches[0].clientX;
        coords.clientY = event.touches[0].clientY;
        coords.pageX = event.touches[0].pageX;
        coords.pageY = event.touches[0].pageY;
        coords.screenX = event.touches[0].screenX;
        coords.screenY = event.touches[0].screenY;
        coords.movementX = coords.screenX - self.prevX;
        coords.movementY = coords.screenY - self.prevY;
        coords.which = cam.navApi.getUseLeftHandedInput() ? 3 : 1;
      } else
      {
        coords = self.prevCoords;
      }
    } else
    {
      coords.clientX = event.clientX;
      coords.clientY = event.clientY;
      coords.pageX = event.pageX;
      coords.pageY = event.pageY;
      coords.screenX = event.screenX;
      coords.screenY = event.screenY;
      coords.which = event.which;

      if (_havePointerLockFeature) {
        coords.movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        coords.movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;
      } else
      {
        coords.movementX = coords.screenX - self.prevX;
        coords.movementY = coords.screenY - self.prevY;
      }
    }
    self.prevX = coords.screenX;
    self.prevY = coords.screenY;
    self.prevCoords = coords;

    return coords;
  }

  /** All functionality regarding cube clicks starts here
   *
   * @param {Object} event - event when mouse down occurs
   */
  var onDocumentMouseDown = function (event) {
    event.preventDefault();
    event.stopPropagation();

    if (!cam.navApi.isActionEnabled('orbit'))
    return;

    if (cam.currentlyAnimating) {return;}

    var coords = getEventCoords(event, self);

    // Make sure our position is up to date...
    position = getPosition(cubeContainer);

    cubeContainer.removeEventListener('mousemove', onDocumentMouseMove, false);
    self.addDocumentEventListener('mouseup', onDocumentMouseUp, false);
    self.addDocumentEventListener('touchend', onDocumentMouseUp, false);
    // Not needed: document.addEventListener('mousemove', onDocumentMouseMove, false);

    if (!cam.navApi.getUsePivotAlways()) {
      // If the usePivot option is not on, we pivot around the center of the view:
      cam.pivot.copy(cam.center);
      cam.navApi.setPivotPoint(cam.center);
      // This also clears the pivot set flag:
      cam.navApi.setPivotSetFlag(false);
    }

    // Since this mouse down is for dragging the cube we should not be able do this if the cube is animating already
    var intersectsWithCube;
    var pickingVector;

    //If cube is first thing clicked, add the current shot to rewind history
    //if (cam.rewindParams.history.length == 0) cam.addHistoryElement();

    //If clicking cube from anywhere other then end of timeline update history accordingly
    //if (!cam.rewindParams.snapped || cam.rewindParams.timelineIndex +1 != cam.rewindParams.history.length) cam.addIntermediateHistoryElement();

    var rightMouse = cam.navApi.getUseLeftHandedInput() ? 1 : 3;
    if (coords.which === rightMouse) // Right mouse click, handled on mouse up
      return;

    if (self.animSpeed <= 0) {
      logger.error("animSpeed cannot be 0 or less, use ViewCube.animate flag to turn on and off animation", errorCodeString(ErrorCodes.VIEWER_INTERNAL_ERROR));
      return;
    }

    // get mouse picking intersections
    pickingVector = getPickVector(coords, position);
    intersectsWithCube = findPickingIntersects(pickingVector, self.camera, cubeBuffer);


    if (intersectsWithCube.length > 0) {

      hideArrows();
      if (self.draggable) {

        cam.startInteraction(coords.pageX, coords.pageY);
        self.addDocumentEventListener('mousemove', onDocumentMouseMoveCube, false);
        self.addDocumentEventListener('touchmove', onDocumentMouseMoveCube, false);

        // Check if browser has pointer lock support
        if (_havePointerLockFeature) {
          // Ask the browser to lock the pointer
          cubeContainer.requestPointerLock();
          _pointerLockMoveBugSPK865 = _isChrome && _isWindows;
        }
      }
    }
  };

  /** Used for dragging the cube,
   * @param {Object} event - event when mouse move occurs (contains information about pointer position)
   */
  var onDocumentMouseMoveCube = function (event) {

    event.preventDefault();
    event.stopPropagation();

    // This is an error if user puts in self.animSpeed = 0 or less
    if (self.animSpeed <= 0) {
      self.removeDocumentEventListener("mousemove", onDocumentMouseMoveCube, false);
      self.removeDocumentEventListener("touchmove", onDocumentMouseMoveCube, false);
      logger.error("animSpeed cannot be 0 or less", errorCodeString(ErrorCodes.VIEWER_INTERNAL_ERROR));
      return;
    }

    if (cam.currentlyAnimating) {
      return;
    }
    var coords = getEventCoords(event, self);

    if (_havePointerLockFeature) {
      // We skip the first movement event after requesting pointer lock
      // because Chrome on Windows sends out a bogus motion value.
      if (_pointerLockMoveBugSPK865) {
        _pointerLockMoveBugSPK865 = false;
        coords.movementX = coords.movementY = 0;
      }
    }

    if (_havePointerLock) {

      // Ignore erroneous data sent from pointer lock
      // not sure why erroneous data gets received
      // could be bug in pointer lock
      if (coords.movementX > 300 || coords.movementY > 300) {
        coords.movementX = 0;
        coords.movementY = 0;
      }
    }

    // If the mouse hasn't moved ignore this current movement (not sure why the mouse move event gets called)
    // Also used for ignoring erroneous data
    if (coords.movementX === coords.movementY && coords.movementX === 0) {
      cam.currentlyAnimating = false;
      return;
    }
    _orthogonalView = false;
    _dragged = true;
    cam.showPivot(true);
    cam.currentCursor = new three__WEBPACK_IMPORTED_MODULE_0__.Vector2(coords.pageX, coords.pageY);
    cam.orbit(cam.currentCursor, cam.startCursor, new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-coords.movementX, coords.movementY, 0), cam.startState);

    self.camera.lookAt(self.center);

    requestAnimationFrame(self.render);
  };


  var endMouseUp = function (stillNeedUp) {
    if (!stillNeedUp) {
      self.removeDocumentEventListener('mouseup', onDocumentMouseUp, false);
      self.removeDocumentEventListener('touchend', onDocumentMouseUp, false);
    }

    self.removeDocumentEventListener('mousemove', onDocumentMouseMoveCube, false);
    self.removeDocumentEventListener('touchmove', onDocumentMouseMoveCube, false);
    cubeContainer.addEventListener('mousemove', onDocumentMouseMove, false);

    if (_havePointerLock) {
      var _document = self.getDocument();
      _document.exitPointerLock();
    }

  };

  this.registerOnViewTypeChangedCb = function (cb) {
    if (cb instanceof Function) {
      _onViewTypeChangedCb = cb;
    }
  };

  this.setViewType = function (viewType) {
    switch (viewType) {
      case avp.VIEW_TYPES.ORTHOGRAPHIC:
        // change cube appearance
        self.camera = self.ocam;
        break;
      case avp.VIEW_TYPES.PERSPECTIVE:
        // change cube appearance
        self.camera = self.pcam;
        break;
      case avp.VIEW_TYPES.PERSPECTIVE_ORTHO_FACES:
        self.camera = _orthogonalView ? self.ocam : self.pcam;
        break;
      default:
        // This viewType is not supported.
        // We do not want to call the view type callback here
        return;
    }
    _onViewTypeChangedCb && _onViewTypeChangedCb(viewType);
  };

  /** Rotates the cube when a division of the cube grid is clicked,
   * also provides functionality for home button interaction, orthogonal arrows interaction,
   * and roll arrows interaction
   * @param {Object} event - event contains information about mouse position which is used in this function
   */
  var onDocumentMouseUp = function (event) {
    event.preventDefault();
    event.stopPropagation();

    var cubeIntersects;
    var arrowIntersects;
    var controlIntersects;

    if (cam.currentlyAnimating || _dragged) {
      cam.endInteraction();
      cam.showPivot(false);
      _dragged = false;

      endMouseUp(false);
      return;
    }
    var coords = getEventCoords(event, self);

    if (cam.viewCubeMenuOpen) {
      var x = coords.clientX - position.x;
      var y = coords.clientY - position.y;

      //if clicked on the menu
      if (cam.menuOrigin.x <= x && x <= cam.menuOrigin.x + cam.menuSize.x &&
      cam.menuOrigin.y <= y && y <= cam.menuOrigin.y + cam.menuSize.y) {

        // HACK!!
        // TODO: make this a bit more robust. It doesn't take the menu separators
        // into account and makes a gross assumption about the menu entry size.
        var menuItemNumber = Math.floor((y - 5 - cam.menuOrigin.y) / 25);

        var log = function (action) {
          logger.track({ name: 'navigation/' + action, aggregate: 'count' });
        };

        switch (menuItemNumber) {
          case 0: //home
            log('home');
            cam.goHome();
            break;
          case 1: //orthographic
            log('setortho');
            self.setViewType(menuItemNumber);
            break;
          case 2: //perspective
            log('setpersp');
            self.setViewType(menuItemNumber);
            break;
          case 3: //perspective with ortho faces
            self.setViewType(menuItemNumber);
            break;
          case 4: //set current view as home
            log('sethome');
            cam.setCurrentViewAsHome(false);
            break;
          case 5: //focus and set current view as home
            log('focushome');
            cam.setCurrentViewAsHome(true);
            break;
          case 6: //reset home
            log('resethome');
            cam.resetHome();
            break;
          case 7: //set current view as front
            log('setfront');
            cam.setCurrentViewAsFront();
            break;
          case 8: //set current view as top
            log('settop');
            cam.setCurrentViewAsTop();
            break;
          case 9: //reset orientation
            cam.resetOrientation();
            break;
        }
      }

      cam.viewCubeMenuOpen = false;
      cam.removeDropdownMenu(cubeContainer);

      //if clicked off the cube canvas
      if (coords.clientX < position.x || coords.clientX > position.w + position.x ||
      coords.clientY < position.y || coords.clientY > position.h + position.y) {
        mouseOutCube();
      }

      // In case something needs a highlight change:
      if (self.mouseMoveSave)
      self.processMouseMove(self.mouseMoveSave);

      // LMV-1876 and LMV-1986 - re-enable hotkeys, essentially
      cam.endInteraction();

      // remove event listeners
      endMouseUp(false);
      return;
    }
    var rightMouse = cam.navApi.getUseLeftHandedInput() ? 1 : 3;
    if (coords.which === rightMouse) {
      cam.viewCubeMenuOpen = true;
      cam.drawDropdownMenu(menuOptionList, menuEnableList, menuStateCallbackList, coords.clientX, coords.clientY, cubeContainer, position);
      endMouseUp(true);
      return;
    }
    var pickingVector = getPickVector(coords, position);
    cubeIntersects = findPickingIntersects(pickingVector, self.camera, cubeBuffer);
    arrowIntersects = findPickingIntersects(pickingVector, controlCamera, arrowBuffer);
    controlIntersects = findPickingIntersects(pickingVector, controlCamera, controlBuffer);

    // Apply logic for clicking on arrows
    if (arrowIntersects.length > 0 && _orthogonalView) {

      var FACES = ["top", "bottom", "right", "left", "front", "back"];

      var FACE_MAPPING = {
        front: {
          up: [0, 1, 2, 3],
          right: [2, 3, 1, 0],
          down: [1, 0, 3, 2],
          left: [3, 2, 0, 1]
        },
        right: {
          up: [0, 1, 5, 4],
          right: [5, 4, 1, 0],
          down: [1, 0, 4, 5],
          left: [4, 5, 0, 1]
        },
        left: {
          up: [0, 1, 4, 5],
          right: [4, 5, 1, 0],
          down: [1, 0, 5, 4],
          left: [5, 4, 0, 1]
        },
        back: {
          up: [0, 1, 3, 2],
          right: [3, 2, 1, 0],
          down: [1, 0, 2, 3],
          left: [2, 3, 0, 1]
        },
        top: {
          up: [5, 4, 2, 3],
          right: [2, 3, 4, 5],
          down: [4, 5, 3, 2],
          left: [3, 2, 5, 4]
        },
        bottom: {
          up: [4, 5, 2, 3],
          right: [2, 3, 5, 4],
          down: [5, 4, 3, 2],
          left: [3, 2, 4, 5]
        }
      };

      var orientation = cam.getOrientation();
      var order = FACE_MAPPING[self.currentFace][orientation];

      var face;
      for (var f = 0; f < 4; f++) {
        if (arrowIntersects[0].object === arrowBuffer[f]) {
          face = FACES[order[f]];
          break;
        }
      }

      cam.calculateCubeTransform(face);
      self.currentFace = face;

      cam.elapsedTime = 0;
      cam.sphericallyInterpolateTransition();
    }

    if (controlIntersects.length > 0) {
      cam.elapsedTime = 0;

      if (self.wantHomeButton && controlIntersects[0].object === controlBuffer[homeOffset]) {
        cam.goHome();
        endMouseUp(false);
        return;
      }
      if (self.wantContextMenu && controlIntersects[0].object === controlBuffer[menuOffset]) {
        cam.viewCubeMenuOpen = true;
        cam.drawDropdownMenu(menuOptionList, menuEnableList, menuStateCallbackList, coords.clientX, coords.clientY, cubeContainer, position);
        endMouseUp(true);
        return;
      }
      if (self.wantRollArrows && _orthogonalView && (controlIntersects[0].object === controlBuffer[rollLeftOffset] || controlIntersects[0].object === controlBuffer[rollRightOffset])) {
        //TODO: when panning, dir changes -> position
        var clockwise = controlIntersects[0].object === controlBuffer[rollRightOffset];
        var destination = {
          center: cam.center.clone(),
          position: camera.position.clone(),
          pivot: camera.pivot.clone(),
          fov: camera.fov,
          worldUp: cam.sceneUpDirection.clone(),
          isOrtho: camera.isPerspective === false
        };
        var dir = cam.center.clone().sub(camera.position).normalize();

        if (clockwise) {
          destination.up = camera.up.clone().cross(dir);
        } else {
          destination.up = camera.up.clone().multiplyScalar(-1);
          destination.up.cross(dir);
        }
        destination.up.normalize();

        cam.goToView(destination);
      }
    }
    if (cubeIntersects.length > 0) {
      let face = cubeIntersects[0].object.name;
      self.mouseMoveSave = event;
      self.cubeRotateTo(face);
    }
    endMouseUp(false);
  };

  this.cubeRotateTo = function (face) {
    self.currentFace = face;

    // If ortho faces is on and the target is not another face,
    // switch to perspective mode:
    if (cam.orthographicFaces && self.currentFace.indexOf(',') !== -1) {
      cam.setCameraOrtho(false);
    }
    cam.calculateCubeTransform(self.currentFace);

    cam.elapsedTime = 0;

    // After interpolating to the new target we may have to simulate
    // a mouse move event at the final location so that the appropriate
    // part of the cube is highlighted:
    cam.sphericallyInterpolateTransition(function () {
      if (self.mouseMoveSave)
      self.processMouseMove(self.mouseMoveSave);
    });
  };

  /** Used to highlight cube grid divisions/arrows/home
   * @param {Object} event - event contains information about mouse position which is used in this function
   */
  this.processMouseMove = function (event) {
    var intersectsFaces;
    var arrowIntersects;
    var controlIntersects;

    if (cam.viewCubeMenuOpen || cam.currentlyAnimating) {
      self.mouseMoveSave = event;
      return;
    }
    self.mouseMoveSave = null;

    var coords = getEventCoords(event, self);

    var pickingVector = getPickVector(coords, position);

    intersectsFaces = findPickingIntersects(pickingVector, self.camera, intersectsFace);
    arrowIntersects = findPickingIntersects(pickingVector, controlCamera, arrowBuffer);
    controlIntersects = findPickingIntersects(pickingVector, controlCamera, controlBuffer);

    /**********Highlight arrows when hovered over************/

    if (INTERSECTED && !_dragged) {
      INTERSECTED.material.color.setHex(COLOR_ARROW);
      INTERSECTED = null;
      requestAnimationFrame(self.render);
    }

    if (arrowIntersects.length > 0 && !_dragged) {
      INTERSECTED = arrowIntersects[0].object;
      for (var i = arrowGroup.children.length; --i >= 0;) {
        if (INTERSECTED === arrowBuffer[i]) {
          INTERSECTED = arrowGroup.children[i];
          INTERSECTED.material.color.setHex(0x00afff);
          break;
        }
      }
      requestAnimationFrame(self.render);
    }

    /**************Highlight faces on cube******************/

    if (INTERSECTED_F && !_dragged) {
      // Make the previously selected face opacity: 0.0
      INTERSECTED_F.material.opacity = 0.0;
      INTERSECTED_F = null;
      requestAnimationFrame(self.render);
    }

    if (intersectsFaces.length > 0 && !_dragged) {
      // Make the currently selected face opacity: 0.3
      INTERSECTED_F = intersectsFaces[0].object;
      INTERSECTED_F.material.opacity = 0.3;
      requestAnimationFrame(self.render);
    }

    if (controlIntersects.length > 0 && !_dragged) {
      if (INTERSECTED_C !== controlIntersects[0].object) {
        // home mouse over
        if (self.wantHomeButton && controlIntersects[0].object === controlBuffer[homeOffset]) {
          INTERSECTED_C = controlIntersects[0].object;
          controlBuffer[homeOffset].material.map = changingTextures[0];
        }

        // Left roll arrow mouse over
        else if (self.wantRollArrows && controlIntersects[0].object === controlBuffer[rollLeftOffset]) {
          INTERSECTED_C = controlIntersects[0].object;
          controlBuffer[rollOffset].material.map = changingTextures[1];
        }

        // Right roll arrow mouse over
        else if (self.wantRollArrows && controlIntersects[0].object === controlBuffer[rollRightOffset]) {
          INTERSECTED_C = controlIntersects[0].object;
          controlBuffer[rollOffset].material.map = changingTextures[2];
        }

        // Menu Icon
        else if (self.wantContextMenu && controlIntersects[0].object === controlBuffer[menuOffset]) {
          INTERSECTED_C = controlIntersects[0].object;
          controlBuffer[menuOffset].material.map = changingTextures[6];
        } else

        {
          // home mouse over
          if (self.wantHomeButton && INTERSECTED_C === controlBuffer[homeOffset]) {
            INTERSECTED_C = null;
            controlBuffer[homeOffset].material.map = changingTextures[3];
          }

          // Left roll and Right roll arrow
          else if (self.wantRollArrows && (INTERSECTED_C === controlBuffer[rollLeftOffset] ||
          INTERSECTED_C === controlBuffer[rollRightOffset] || INTERSECTED_C === controlBuffer[rollOffset])) {
            INTERSECTED_C = null;
            controlBuffer[rollOffset].material.map = changingTextures[4];
          }

          // menu icon
          else if (self.wantContextMenu && INTERSECTED_C === controlBuffer[menuOffset]) {
            INTERSECTED_C = null;
            controlBuffer[menuOffset].material.map = changingTextures[5];
          }
        }
        requestAnimationFrame(self.render);
      }
    } else if (INTERSECTED_C !== null && !_dragged) {
      // home mouse over
      if (self.wantHomeButton && INTERSECTED_C === controlBuffer[homeOffset]) {
        INTERSECTED_C = null;
        controlBuffer[homeOffset].material.map = changingTextures[3];
      }

      // Left roll and Right roll arrow
      else if (self.wantRollArrows && (INTERSECTED_C === controlBuffer[rollLeftOffset] ||
      INTERSECTED_C === controlBuffer[rollRightOffset] || INTERSECTED_C === controlBuffer[rollOffset])) {
        INTERSECTED_C = null;
        controlBuffer[rollOffset].material.map = changingTextures[4];
      }

      // menu icon
      else if (self.wantContextMenu && INTERSECTED_C === controlBuffer[menuOffset]) {
        INTERSECTED_C = null;
        controlBuffer[menuOffset].material.map = changingTextures[5];
      }

      requestAnimationFrame(self.render);
    }
  };

  var onDocumentMouseMove = function (event) {
    if (cam.navApi.isActionEnabled('orbit'))
    self.processMouseMove(event);
  };

  /** Refreshes values so that renderer is correct size (in pixels) **/
  var onWindowResize = function () {
    position = getPosition(cubeContainer);

    // cubeContainer.style.width = self.width.toString() + "px";
    // cubeContainer.style.height = "inherit";

    self.width = cubeContainer.offsetWidth;
    self.height = cubeContainer.offsetHeight;

    //windowHalfX = self.width / 2;
    //windowHalfY = self.height / 2;

    //self.camera.aspect = self.width / self.height; - one of the two cameras has this aspect, so setting it there sets it here.
    self.pcam.aspect = self.ocam.aspect = self.width / self.height;
    //self.camera.updateProjectionMatrix(); - done by the two calls below:
    self.pcam.updateProjectionMatrix();
    self.ocam.updateProjectionMatrix();

    // PHB added. See Autocam.js windowResize
    self.camera.topFov = self.camera.bottomFov = self.camera.fov / 2;
    self.camera.leftFov = self.camera.rightFov = self.camera.aspect * self.camera.fov / 2;
    // need to copy to camera templates - half of these statements do nothing, since the camera points at pcam or ocam, but simpler than an if statement.
    self.pcam.aspect = self.ocam.aspect = self.camera.aspect;
    self.pcam.topFov = self.ocam.topFov = self.camera.topFov;
    self.pcam.bottomFov = self.ocam.bottomFov = self.camera.bottomFov;
    self.pcam.leftFov = self.ocam.leftFov = self.camera.leftFov;
    self.pcam.rightFov = self.ocam.rightFov = self.camera.rightFov;

    const devicePixelRatio = self.getWindow().devicePixelRatio;
    self.renderer.setPixelRatio(devicePixelRatio);
    self.renderer.setSize(self.width, self.height);
    requestAnimationFrame(self.render);
  };

  /** Builds one square mesh of the grid (located on each face of the cube)
   *
   * @param {Number} rotationX - rotate shape by this amount in X
   * @param {Number} rotationY - rotate shape by this amount in Y
   * @return {THREE.Mesh} - mesh of the cube face (square part) rotated by params
   */
  var buildCubeFace = function (rotationX, rotationY) {

    // These sizes may be changed if cube size is changed
    var material;
    var edge = Math.floor(cubeSize * 0.45 / 2) || 45;
    var square = Math.floor(cubeSize * 0.60 / 2) || 60;
    var masterCubeSize = edge + square;

    var geo = new three__WEBPACK_IMPORTED_MODULE_0__.BufferGeometry();

    // Center of the cube
    var v0 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(0, 0, 0);

    /******************FRONT OF CUBE********************/
    var v1 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, -square, masterCubeSize);
    var v2 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, square, masterCubeSize);
    var v3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-square, square, masterCubeSize);
    var v4 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-square, -square, masterCubeSize);

    var vertices = new Float32Array([
    v0.x, v0.y, v0.z,
    v1.x, v1.y, v1.z,
    v2.x, v2.y, v2.z,
    v3.x, v3.y, v3.z,
    v4.x, v4.y, v4.z]
    );

    geo.setAttribute('position', new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(vertices, 3));

    /******************FRONT FACE********************/

    // Front square
    const indices = [
    1, 2, 3,
    1, 3, 4];

    geo.index = new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(new Uint16Array(indices), 1);

    // Apply matrix rotations for sides which are not the front
    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationX(rotationX));
    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationY(rotationY));

    geo.computeVertexNormals();

    material = new Autodesk.Viewing.Scene.UnlitMaterial({ opacity: 0.0, color: 0x00afff, transparent: true });
    return new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(geo, material);
  };

  /** Builds one edge mesh of the grid
   *
   * @param rotationX - rotate shape by this amount X
   * @param rotationY - rotate shape by this amount Y
   * @param rotationZ - rotate shape by this amount Z
   * @return {THREE.Mesh} - mesh of the cube edge rotated by params
   */
  var buildCubeEdge = function (rotationX, rotationY, rotationZ) {
    var material;
    var edge = Math.floor(cubeSize * 0.45 / 2) || 45;
    var square = Math.floor(cubeSize * 0.60 / 2) || 60;
    var masterCubeSize = edge + square;
    var meshReturn;

    var geo = new three__WEBPACK_IMPORTED_MODULE_0__.BufferGeometry();

    var e0 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, masterCubeSize, masterCubeSize);
    var e1 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-square, masterCubeSize, masterCubeSize);
    var e2 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-square, square, masterCubeSize);
    var e3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, square, masterCubeSize);

    var e4 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, masterCubeSize, square);
    var e5 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-square, masterCubeSize, square);
    var e6 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(-square, masterCubeSize, masterCubeSize);
    var e7 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, masterCubeSize, masterCubeSize);

    var vertices = new Float32Array([
    e0.x, e0.y, e0.z,
    e1.x, e1.y, e1.z,
    e2.x, e2.y, e2.z,
    e3.x, e3.y, e3.z,
    e4.x, e4.y, e4.z,
    e5.x, e5.y, e5.z,
    e6.x, e6.y, e6.z,
    e7.x, e7.y, e7.z]
    );

    geo.setAttribute('position', new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(vertices, 3));

    const indices = [
    0, 1, 2,
    0, 2, 3,
    4, 5, 6,
    4, 6, 7];

    geo.index = new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(new Uint16Array(indices), 1);

    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationX(rotationX));
    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationY(rotationY));
    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationZ(rotationZ));

    geo.computeVertexNormals();

    material = new Autodesk.Viewing.Scene.UnlitMaterial({ opacity: 0.0, color: 0x00afff, transparent: true });
    meshReturn = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(geo, material);
    return meshReturn;
  };

  /** Builds one corner mesh of the grid
   *
   * @param {Number} rotationX - rotate shape by this amount in X
   * @param {Number} rotationY - rotate shape by this amount in Y
   * @return {THREE.Mesh} - the cube corner mesh rotated by params
   */
  var buildCubeCorner = function (rotationX, rotationY) {
    var material;
    var edge = Math.floor(cubeSize * 0.45 / 2) || 45;
    var square = Math.floor(cubeSize * 0.60 / 2) || 60;
    var masterCubeSize = edge + square;
    var meshReturn;

    var geo = new three__WEBPACK_IMPORTED_MODULE_0__.BufferGeometry();

    var c0 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, masterCubeSize, masterCubeSize);
    var c1 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, masterCubeSize, masterCubeSize);
    var c2 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, square, masterCubeSize);
    var c3 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, square, masterCubeSize);

    var c4 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, masterCubeSize, square);
    var c5 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, masterCubeSize, masterCubeSize);
    var c6 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, square, masterCubeSize);
    var c7 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, square, square);

    var c8 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, masterCubeSize, masterCubeSize);
    var c9 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(masterCubeSize, masterCubeSize, square);
    var c10 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, masterCubeSize, square);
    var c11 = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(square, masterCubeSize, masterCubeSize);

    var vertices = new Float32Array([
    c0.x, c0.y, c0.z,
    c1.x, c1.y, c1.z,
    c2.x, c2.y, c2.z,
    c3.x, c3.y, c3.z,
    c4.x, c4.y, c4.z,
    c5.x, c5.y, c5.z,
    c6.x, c6.y, c6.z,
    c7.x, c7.y, c7.z,
    c8.x, c8.y, c8.z,
    c9.x, c9.y, c9.z,
    c10.x, c10.y, c10.z,
    c11.x, c11.y, c11.z]
    );

    geo.setAttribute('position', new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(vertices, 3));

    const indices = [
    0, 1, 2,
    0, 2, 3,
    4, 5, 6,
    4, 6, 7,
    8, 9, 10,
    8, 10, 11];


    geo.index = new three__WEBPACK_IMPORTED_MODULE_0__.BufferAttribute(new Uint16Array(indices), 1);

    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationX(rotationX));
    geo.applyMatrix4(new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4().makeRotationY(rotationY));

    geo.computeVertexNormals();

    material = new Autodesk.Viewing.Scene.UnlitMaterial({ opacity: 0.0, color: 0x00afff, transparent: true });
    meshReturn = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(geo, material);
    return meshReturn;
  };

  var changeBasisWorldToStandard = function (V) {
    var worldD = cam.cubeFront.clone();
    var worldU = cam.sceneUpDirection.clone();
    var worldR = worldD.clone().cross(worldU);
    worldU.copy(worldR).cross(worldD);

    worldD.normalize();
    worldU.normalize();
    worldR.normalize();

    var answer = new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(worldD.x, worldU.x, worldR.x).multiplyScalar(V.x);
    answer.add(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(worldD.y, worldU.y, worldR.y).multiplyScalar(V.y));
    answer.add(new three__WEBPACK_IMPORTED_MODULE_0__.Vector3(worldD.z, worldU.z, worldR.z).multiplyScalar(V.z));

    return answer;
  };

  /** Render the View Cube scenes and perform checks for control visibility **/
  this.render = function () {
    // switch view cube to match whatever camera.isPerspective says to use.
    self.camera = camera.isPerspective ? self.pcam : self.ocam;

    var scale = self.compass ? self.viewScaleFactorCompass * self.viewScale : self.viewScale;
    var viewDir = cam.center.clone().sub(camera.position).normalize();
    var upDir = camera.up.normalize();
    var spriteRotationMatrix = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();

    viewDir = changeBasisWorldToStandard(viewDir);
    upDir = changeBasisWorldToStandard(upDir);

    self.camera.position.copy(viewDir);
    self.camera.position.multiplyScalar(-scale / self.camera.position.length());
    self.camera.up = upDir.normalize();
    self.camera.lookAt(self.center);

    checkControlVisibility();

    // Only render triad if enabled and up/front are axis aligned. Otherwise it looks weird
    var renderTriad = self.renderTriad &&
    isAxisAlignedUnit(cam.sceneUpDirection) &&
    isAxisAlignedUnit(cam.sceneFrontDirection);

    var renderer = self.renderer;
    if (renderer) {
      // Orient any sprites to face the camera
      for (var i = 0; i < sprites.length; i++) {
        spriteRotationMatrix.lookAt(self.camera.position, sprites[i].position, self.camera.up);
        sprites[i].setRotationFromMatrix(spriteRotationMatrix);
      }

      renderer.clear();
      // There are 3 scenes: the first is the shadow, then the cube with textures, then the grid is on top
      renderer.render(shadowScene, self.camera);
      renderer.render(cubeScene, self.camera);
      renderer.render(lineScene, self.camera);

      if (renderTriad) {
        // Reorient in case up/front changed. Weirdly the scene front direction is backwards so we have to
        // multiply by -1
        triad.orient(cam.sceneUpDirection, cam.sceneFrontDirection.clone().multiplyScalar(-1));
        renderer.render(triad.triadScene, self.camera);
        renderer.render(triad.triadLabelScene, self.camera);
      }
      renderer.render(gridScene, self.camera);
      // render the compass after the cube. If we do it before, the cube will be hidden
      if (self.renderCompass) {
        renderer.render(compassScene, self.camera);
      }

      // Different camera since these shouldn't move with the View Cube
      renderer.render(controlScene, controlCamera);
    }
  };

  /**
   * Returns a promise that resolves with an image/png Blob.
   *
   * @returns {Promise}
   */
  this.getScreenShot = function (options) {
    return new Promise(function (resolve, reject) {

      var renderer = self.renderer;
      if (!renderer)
      return reject('No renderer');

      // Add background
      var _document = self.getDocument();
      var canvas = _document.createElement('canvas');
      canvas.width = self.width;
      canvas.height = self.height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, self.width, self.height);

      self.render();
      renderer.domElement.toBlob(onViewCubeBlob, 'image/png');

      function onViewCubeBlob(vcBlob) {
        var img = new Image();
        var _window = self.getWindow();
        img.src = _window.URL.createObjectURL(vcBlob);
        img.onload = () => {
          ctx.drawImage(img, 0, 0, self.width, self.height);
          _window.URL.revokeObjectURL(img.src);
          canvas.toBlob((blob) => {resolve(blob);}, 'image/png');
        };
      }
    });
  };

  /**
   * checks whether arrows (orthogonal and roll), drop down menus, and home button should be visible or not at
   * this current time
   */
  var checkControlVisibility = function () {
    // Arrow Visibility

    _orthogonalView = cam.isFaceView();

    _orthogonalView && !_transparent && !cam.currentlyAnimating ? showArrows() : hideArrows();

    // Menu Visibility
    _transparent ? hideContext() : showContext();

    // Home Visibility
    _transparent ? hideHome() : showHome();
  };

  /** Hide View Cube Arrows **/
  var hideArrows = function () {
    controlScene.remove(arrowGroup);

    controlBuffer[rollOffset].material.opacity = 0.0;
    controlBuffer[menuOffset].material.opacity = 0.0;
  };

  /** Show View Cube Arrows **/
  var showArrows = function () {
    controlScene.add(arrowGroup);

    var opacity = self.wantRollArrows ? 1.0 : 0.0;
    controlBuffer[rollOffset].material.opacity = opacity;
    controlBuffer[menuOffset].material.opacity = opacity;
  };

  /** Hide the view cube menu button **/
  var hideContext = function () {
    context.material.opacity = isMobileDevice() ? 1.0 : 0.0;
  };

  /** Show the view cube menu button **/
  var showContext = function () {
    context.material.opacity = self.wantContextMenu ? 1.0 : 0.0;
  };

  /** Hide the home button **/
  var hideHome = function () {
    home.material.opacity = 0.0;
  };

  /** Show the home button **/
  var showHome = function () {
    home.material.opacity = self.wantHomeButton ? 1.0 : 0.0;
  };

  /* Public Methods */
  /** Update the View Cube camera to a new camera view
   * @public
   * @this ViewCube
   * @param {int[]} eye - client provided camera position (in their world coordinates)
   * @param {int[]} centre - client provided pivot point or centre (where the camera is looking at in their world coordinates)
   * @param {int[]} upVector - client provided up vector
   */

  /** Refresh height and width renderer sizes
   * @public
   * @this ViewCube
   */
  this.refreshCube = function () {
    onWindowResize();
  };

  /** Set the size of the View Cube
   * @public
   * @this ViewCube
   * @param {int} width - in pixels
   * @param {int} height - in pixels
   */
  this.setSize = function (width, height) {
    self.width = width;
    self.height = height;

    if (cubeContainer.children.length > 1) {
      for (var i = 1; i < cubeContainer.children.length; i++)
      cubeContainer.children[i].style.bottom = (self.height / 5).toString() + "px";
    }

    onWindowResize();
  };

  /** Option to turn on and off transparency on mouse out for the view cube
   * @public
   * @this ViewCube
   * @param {boolean} transparent - true to use transparency, false to turn it off
   */
  this.useTransparency = function (transparent) {
    _transparent = transparent;
    if (transparent) {
      cubeContainer.onmouseover = mouseOverCube;
      cubeContainer.onmousemove = mouseMoveOverCube;
      cubeContainer.onmouseout = mouseOutCube;
      mouseOutCube();
    } else
    {
      cubeContainer.onmouseover = null;
      cubeContainer.onmouseout = null;
      cubeContainer.onmousemove = null;
      cubeContainer.style.opacity = "1.0";
    }
  };

  this.showTriad = function (show) {
    if (show !== self.renderTriad) {
      self.renderTriad = show;
      requestAnimationFrame(self.render);
    }
  };

  this.showCompass = function (show = true) {
    this.initCompass();


    if (self.renderCompass !== show) {
      self.prevRenderCompass = self.renderCompass; // prevRenderCompass is used for "Reset Orientation" option
      self.renderCompass = show;
      // Move the controls to right positions
      setControlsPositions();
      requestAnimationFrame(self.render);
    }
  };

  // North angle is the angle to viewcube's back face normal vector
  this.setCompassRotation = function (newNorthAngle = 0) {
    this.initCompass();

    const toRotate = newNorthAngle - self.northAngle;

    if (toRotate === 0) {
      return;
    }

    self.northAngle = newNorthAngle;

    // rotate about world Y which is the same as object Z
    self.compassPointerMeshUp.rotateZ(toRotate);
    self.compassPointerMeshDown.rotateZ(toRotate);

    requestAnimationFrame(self.render);
  };

  this.initCompass = function () {
    if (self.hasCompass) {
      return; // already initialized
    }

    self.hasCompass = true;
    self.northAngle = 0; // Angle of north in radians wrt front

    let resRoot = 'res/textures/';
    let getResourceUrl = Autodesk.Viewing.Private.getResourceUrl;
    // create the mesh for compass and add it to compass scene
    compassScene = new three__WEBPACK_IMPORTED_MODULE_0__.Scene();

    // geometry and material
    const planeSize = cubeSize * 2.9;
    let compassGeom = new three__WEBPACK_IMPORTED_MODULE_0__.PlaneBufferGeometry(planeSize, planeSize, 2, 2);
    let compassPointerMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
      color: 0x000000,
      side: three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide,
      map: loadTexture(getResourceUrl(resRoot + 'VCcompass-pointer-b.png')),
      transparent: true
    });
    let compassBaseMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
      color: 0x000000,
      side: three__WEBPACK_IMPORTED_MODULE_0__.DoubleSide,
      map: loadTexture(getResourceUrl(resRoot + 'VCcompass-base.png')),
      transparent: true
    });

    // mesh
    // We create two meshes for the pointer one on each side of the base mesh, because it causes flicker with transparency set
    const compassPointerMeshUp = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(compassGeom, compassPointerMaterial);
    const compassPointerMeshDown = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(compassGeom, compassPointerMaterial);
    const compassBaseMesh = new three__WEBPACK_IMPORTED_MODULE_0__.Mesh(compassGeom, compassBaseMaterial);
    self.compassPointerMeshUp = compassPointerMeshUp;
    self.compassPointerMeshDown = compassPointerMeshDown;

    const xRot = -Math.PI / 2;
    compassBaseMesh.rotateX(xRot);
    compassPointerMeshUp.rotateX(xRot);
    compassPointerMeshDown.rotateX(xRot);

    // Translate by world Y, which is object's Z after the rotation above
    const yTran = -cubeSize * 0.5 - (Math.floor(cubeSize * 0.25 / 2) || 25);
    compassBaseMesh.translateZ(yTran);
    compassPointerMeshUp.translateZ(yTran + 0.1);
    compassPointerMeshDown.translateZ(yTran - 0.1);

    compassScene.add(compassBaseMesh);
    compassScene.add(compassPointerMeshUp);
    compassScene.add(compassPointerMeshDown);

    requestAnimationFrame(self.render);
  };

  /**
   * Emulates a mouseOver event (when `show=true`) to display the context menu
   * affordance and make the viewcube render fully opaque. Invoking the method with
   * `show=false` will emulate a mouseOut event, hiding the context menu affordance
   * and making the cube transparent.
   *
   * @param {boolean} show - true to emulate a mouseOver event, false to emulate a mouseOut event.
   */
  this.showControls = function (show) {
    if (show || show === undefined)
    mouseOverCube();else

    mouseOutCube();
  };

  this.dtor = function () {
    this._pendingLanguage = null;
    this.renderer = null;
    _onViewTypeChangedCb = null;
  };

  // Create the shader material on first call and kick off atlas generation for the current language. Returns the
  // material synchronously; the atlas is applied asynchronously. Rapid language changes are race-guarded via
  // _pendingLanguage - stale results are disposed without touching the material.
  this.refreshTexture = function () {
    var material = this.material;
    if (!material) {
      material = createShaderMaterial(_ViewCubeShader_js__WEBPACK_IMPORTED_MODULE_1__.ViewCubeShader);
      material.depthWrite = false;
      this.material = material;
    }

    const language = av.i18n?.language || 'en';
    self._pendingLanguage = language;
    (0,_ViewCubeAtlasGenerator_js__WEBPACK_IMPORTED_MODULE_2__.loadAtlasTexture)(language).then((texture) => {
      if (self._pendingLanguage !== language || self._useCustomTexture) {
        texture.dispose();
        return;
      }

      self.texture && self.texture.dispose();
      self.texture = texture;

      material.uniforms['tAtlas'].value = texture;
      requestAnimationFrame(self.render);
    }).catch((error) => {
      console.warn('ViewCube: failed to load atlas texture for language "' + language + '":', error);
    });

    return material;
  };

  this.localize = function () {
    if (this._useCustomTexture) return;

    this.refreshTexture();
  };

  // Swaps the active atlas texture, disposes the previous one, and schedules a re-render. Marks the cube as using
  // a custom texture so that localize() won't override it. Use clearCustomTexture() to revert.
  this._setCustomTexture = function (texture) {
    this._useCustomTexture = true;

    texture.minFilter = three__WEBPACK_IMPORTED_MODULE_0__.LinearFilter;
    texture.magFilter = three__WEBPACK_IMPORTED_MODULE_0__.LinearFilter;
    texture.generateMipmaps = false;

    if (this.texture) {
      this.texture.dispose();
    }
    this.texture = texture;

    if (this.material) {
      this.material.uniforms["tAtlas"].value = texture;
    }

    requestAnimationFrame(this.render);
  };

  /**
   * Replace the default i18n-based face labels with custom text. Generates a new atlas from the provided labels
   * using the standard font and layout, then applies it as a persistent custom texture.
   *
   * Call with no labels (omit the argument, pass undefined/null, or pass []) to restore locale-based atlases —
   * same effect as {@link ViewCube#clearCustomTexture}.
   *
   * @param {string[]} [labels] - Six face labels in order: RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK; omit to reset.
   * @param {Object} [options] - Generator options (resolution, fontSizeRatio, etc.), see AtlasOptions.
   */
  this.setCustomLabels = function (labels, options) {
    const restoreLocaleAtlas = labels === undefined || labels === null || Array.isArray(labels) && labels.length === 0;
    if (restoreLocaleAtlas) {
      this.clearCustomTexture();
      return;
    }

    console.assert(Array.isArray(labels) && labels.length === 6,
    'ViewCube.setCustomLabels: Expected 6 labels [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK]');

    (0,_ViewCubeAtlasGenerator_js__WEBPACK_IMPORTED_MODULE_2__.loadAtlasFont)().
    then(() => {
      const canvas = (0,_ViewCubeAtlasGenerator_js__WEBPACK_IMPORTED_MODULE_2__.generateViewCubeAtlas)(labels, options);
      const texture = (0,_ViewCubeAtlasGenerator_js__WEBPACK_IMPORTED_MODULE_2__.createAtlasTexture)(canvas);
      self._setCustomTexture(texture);
      avp.analytics.track('viewer.cube_atlas_generated', { labels });
    }).
    catch((error) => {
      console.warn('ViewCube.setCustomLabels: failed to generate atlas:', error);
    });
  };

  /**
   * Clears the custom texture and reverts to locale-based texture loading.
   */
  this.clearCustomTexture = function () {
    this._useCustomTexture = false;
    this.localize();
  };

  /* Build the cube */
  Init();
}

avp.ViewCube = ViewCube;

/***/ },

/***/ "./extensions/ViewCubeUi/ViewCubeAtlasGenerator.js"
/*!*********************************************************!*\
  !*** ./extensions/ViewCubeUi/ViewCubeAtlasGenerator.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DEFAULT_ATLAS_OPTIONS: () => (/* binding */ DEFAULT_ATLAS_OPTIONS),
/* harmony export */   FACE_ORDER_KEYS: () => (/* binding */ FACE_ORDER_KEYS),
/* harmony export */   createAtlasTexture: () => (/* binding */ createAtlasTexture),
/* harmony export */   extractRedChannel: () => (/* binding */ extractRedChannel),
/* harmony export */   generateViewCubeAtlas: () => (/* binding */ generateViewCubeAtlas),
/* harmony export */   loadAtlasFont: () => (/* binding */ loadAtlasFont),
/* harmony export */   loadAtlasTexture: () => (/* binding */ loadAtlasTexture)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);



const av = Autodesk.Viewing;

// Face order in the atlas: +x, -x, +y, -y, +z, -z (matches BoxGeometry face order).
const FACE_ORDER_KEYS = Object.freeze(['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK']);

// Artifakt Legend Black is the sole font for ViewCube face labels. It is bundled with LMV at res/fonts/ and loaded
// via FontFace API on first atlas generation. Font family and weight are fixed; only typographic layout parameters
// (size, padding, offset, condensation) are configurable.
const FONT_FAMILY = '"Artifakt Legend Black", sans-serif';
const FONT_WEIGHT = 900;
const FONT_RESOURCE_PATH = 'res/fonts/ArtifaktLegendBlack.woff2';

/**
 * @typedef {Object} AtlasOptions
 * @private
 * @property {number} [resolution] - Face size in pixels.
 * @property {number} [fontSizeRatio] - Font size as ratio of face size.
 * @property {number} [condensedScale] - Horizontal text compression (1.0 = normal, <1.0 = narrower).
 * @property {number} [verticalOffset] - Vertical baseline shift as ratio of font size (cap-height correction).
 * @property {number} [paddingRatio] - Horizontal padding as ratio of face size.
 */
const DEFAULT_ATLAS_OPTIONS = Object.freeze({
  resolution: 128,
  fontSizeRatio: 0.31,
  condensedScale: 0.8,
  verticalOffset: 0.1,
  paddingRatio: 0.0625
});

let fontLoadPromise = null;

/**
 * Load the Artifakt Legend Black font via the FontFace API. The promise is cached so subsequent calls resolve
 * immediately. Must complete before calling generateViewCubeAtlas so the canvas context can measure and render text.
 *
 * @returns {Promise<void>}
 * @private
 */
function loadAtlasFont() {
  if (fontLoadPromise) return fontLoadPromise;

  fontLoadPromise = (async () => {
    const getResourceUrl = Autodesk.Viewing.Private.getResourceUrl;
    const url = getResourceUrl(FONT_RESOURCE_PATH);
    const fontFace = new FontFace('Artifakt Legend Black', `url(${url})`);
    try {
      await fontFace.load();
      document.fonts.add(fontFace);
    } catch (error) {
      fontLoadPromise = null;
      throw error;
    }
  })();

  return fontLoadPromise;
}

/**
 * Generate and return a LuminanceFormat DataTexture for the given language. Loads the Artifakt Legend Black font
 * (cached after first call), translates face labels through i18n, and renders them to a canvas atlas.
 *
 * @param {string} language - Locale code (e.g., 'en', 'de', 'zh-Hans').
 * @returns {Promise<THREE.DataTexture>}
 */
async function loadAtlasTexture(language) {
  await loadAtlasFont();

  const i18n = av.i18n;
  const labels = FACE_ORDER_KEYS.map((key) => {
    if (!i18n) return key;
    const translated = i18n.t(key, { lng: language });
    return translated || key;
  });

  const canvas = generateViewCubeAtlas(labels);
  return createAtlasTexture(canvas);
}

/**
 * Create a single-channel LuminanceFormat DataTexture from a canvas. Extracts the red channel and configures
 * LinearFilter without mipmaps (the ViewCube shader does its own AA via a rotated kernel).
 *
 * @param {HTMLCanvasElement} canvas - Source canvas (typically from generateViewCubeAtlas).
 * @returns {THREE.DataTexture}
 */
function createAtlasTexture(canvas) {
  const { data, width, height } = extractRedChannel(canvas);

  // @todo: Firefox warns "Alpha-premult and y-flip are deprecated for non-DOM-Element uploads" because
  // WebGLRenderer unconditionally sets UNPACK_FLIP_Y_WEBGL/UNPACK_PREMULTIPLY_ALPHA_WEBGL on every texImage call —
  // a renderer-level issue, not specific to this DataTexture.
  const texture = new three__WEBPACK_IMPORTED_MODULE_0__.DataTexture(data, width, height, three__WEBPACK_IMPORTED_MODULE_0__.LuminanceFormat);
  texture.needsUpdate = true;
  texture.minFilter = three__WEBPACK_IMPORTED_MODULE_0__.LinearFilter;
  texture.magFilter = three__WEBPACK_IMPORTED_MODULE_0__.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * Generate a ViewCube face-label atlas as a horizontal strip canvas with 6 columns (one per cube face) at
 * faceSize x faceSize per column. Text is rendered black on white as a grayscale alpha mask; the ViewCube shader
 * applies face colors and text tint at render time.
 *
 * @param {string[]} labels - Six face labels in order: RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK.
 * @param {AtlasOptions} [options]
 * @returns {HTMLCanvasElement}
 * @private
 */
function generateViewCubeAtlas(labels, options = {}) {
  console.assert(Array.isArray(labels) && labels.length === 6,
  'ViewCubeAtlasGenerator: Expected an array of 6 labels [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK]');

  options = { ...DEFAULT_ATLAS_OPTIONS, ...options };
  const condensedScale = Math.max(0.5, Math.min(1.0, options.condensedScale));
  const faceSize = options.resolution;

  const canvas = document.createElement('canvas');
  canvas.width = faceSize * 6;
  canvas.height = faceSize;

  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const padding = options.paddingRatio * faceSize;
  const fontSize = options.fontSizeRatio * faceSize;
  const sizeMinusPadding = faceSize - 2 * padding;

  context.font = `${FONT_WEIGHT} ${fontSize}px ${FONT_FAMILY}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'black';

  for (let i = 0; i < 6; ++i) {
    const label = labels[i];
    const textWidth = context.measureText(label).width;

    const capHeightOffset = fontSize * options.verticalOffset;
    const centerX = faceSize * (i + 0.5);
    const centerY = faceSize / 2 + capHeightOffset;

    const effectiveWidth = textWidth * condensedScale;
    const scaleX = effectiveWidth > sizeMinusPadding ? sizeMinusPadding / effectiveWidth : 1.0;
    const totalScaleX = condensedScale * scaleX;

    context.save();
    context.translate(centerX, centerY);
    context.scale(totalScaleX, 1.0);
    context.fillText(label, 0.0, 0.0);
    context.restore();
  }

  return canvas;
}

/**
 * Extract the red channel from a canvas into a Uint8Array suitable for a single-channel DataTexture. The generator
 * guarantees R=G=B, so extracting R is lossless. Also normalizes any sub-pixel rendering artifacts by only reading
 * the R component.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ data: Uint8Array, width: number, height: number }}
 * @private
 */
function extractRedChannel(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const red = new Uint8Array(width * height);

  for (let i = 0; i < red.length; i++) {
    red[i] = rgba[i * 4];
  }

  return { data: red, width, height };
}

/***/ },

/***/ "./extensions/ViewCubeUi/ViewCubeShader.js"
/*!*************************************************!*\
  !*** ./extensions/ViewCubeUi/ViewCubeShader.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ViewCubeShader: () => (/* binding */ ViewCubeShader)
/* harmony export */ });
/* harmony import */ var _ViewCube_vert_glsl__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ViewCube.vert.glsl */ "./extensions/ViewCubeUi/ViewCube.vert.glsl");
/* harmony import */ var _ViewCube_vert_glsl__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_ViewCube_vert_glsl__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _ViewCube_frag_glsl__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ViewCube.frag.glsl */ "./extensions/ViewCubeUi/ViewCube.frag.glsl");
/* harmony import */ var _ViewCube_frag_glsl__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_ViewCube_frag_glsl__WEBPACK_IMPORTED_MODULE_1__);



/**
 * The atlas-texture is a horizontal strip of six squares with the faces [+X, -X, +Y, -Y, +Z, -Z], corresponding to
 * [RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK]. A BoxGeometry builds faces in that same order and assigns per-face UV in
 * [0,1] with uvs.push(ix/gridX, 1 - iy/gridY). Atlas Lookup: (faceIndex + faceUV.x) / 6.0, faceUV.y.
 *
 * The grayscale texture is used as an alpha mask with white (1.0) = background and black (0.0) = text. The shader
 * tints the face colors as follows:
 * - TOP/+Y: white rgb(255, 255, 255)
 * - BOTTOM/-Y: gray rgb(200, 200, 200)
 * - Lateral faces: vertical gradient from white (top) to gray (bottom)
 * - Text color: dark bluish rgb(86, 93, 103)
 */
const ViewCubeShader = { uniforms: { tAtlas: { type: "t", value: null } }, vertexShader: (_ViewCube_vert_glsl__WEBPACK_IMPORTED_MODULE_0___default()), fragmentShader: (_ViewCube_frag_glsl__WEBPACK_IMPORTED_MODULE_1___default()) };

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ViewCubeUi/ViewCubeUi.css"
/*!**********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ViewCubeUi/ViewCubeUi.css ***!
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,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 */ "data:image/png;base64,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"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `/***
 * view cube
 */
.viewcube, .viewcubeWrapper {
  display: block;
  position: absolute;
  outline: none;
  width: 170px;
  height: 170px;
  right: -1px;
  top: -1px;
  opacity: 0.7;
  margin: 0;
  -webkit-transition: opacity 0.2s ease;
  -moz-transition: opacity 0.2s ease;
  -ms-transition: opacity 0.2s ease;
  -o-transition: opacity 0.2s ease;
  transition: opacity 0.2s ease;
}

.viewcubeWrapper {
  pointer-events: none;
}

.viewcube {
  pointer-events: auto;
}

.rewindFrame {
  background-color: #FFFFFF;
  position: absolute;
  height: 56px;
  width: 56px;
  z-index: 1002;
}

.dropDownMenu {
  position: absolute;
  min-width: 220px;
  margin: 0;
  z-index: 1001;
  background-color: #FFFFFF;
  font-family: sans-serif;
  font-size: 14px;
  list-style-type: none;
  border: solid;
  border-width: 1px;
  border-color: #979797;
}

.dropDownMenuItem {
  position: relative;
  width: calc(100% - 24px);
  height: 21px;
  padding-left: 24px; /* Pad room for checkboxes */
  padding-top: 4px;
  background-color: #FFFFFF;
  cursor: pointer;
}

.dropDownMenuCheckbox {
  position: relative;
  width: calc(100% - 4px);
  padding-top: 4px;
  height: 21px;
  margin-left: 4px;
  background-color: #FFFFFF;
  cursor: pointer;
}

.dropDownMenuCheck {
  padding-top: 2px;
  cursor: pointer;
}

.dropDownMenuCheckText {
  position: relative;
  padding-left: 2px;
  margin: 0;
  cursor: pointer;
}

.dropDownMenuItemDisabled {
  color: #999999;
  position: relative;
  width: calc(100% - 5px);
  height: 23px;
  background-color: #FFFFFF;
  cursor: pointer;
}

.dropDownMenuItem:hover {
  background-color: #E7EEF6;
}

.dropDownMenuCheckbox:hover {
  background-color: #E7EEF6;
}

.textBox {
  font-size: 15px;
  background-color: #000;
  opacity: 0.6;
  padding: 2px 10px;
  border-radius: 2px;
  position: fixed;
  display: none;
  font-family: Monospace;
  color: #fff;
  z-index: 1000;
}

#colorCode {
  position: absolute;
  left: 0px;
  top: 0px;
}

#text, #steeringWheel {
  position: absolute;
  left: 0px;
  top: 0px;
  z-index: 900;
}

.homeViewWrapper {
  display: block;
  outline: none;
  margin: 18px 0px 0px -20px;
  opacity: 0.7;
  width: 24px;
  height: 24px;
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
  cursor: pointer;
  pointer-events: auto;
}

.homeViewWrapper:hover {
  opacity: 1;
}

.homeViewWrapper.no-viewcube {
  position: absolute;
  right: 12px;
  top: 10px;
  margin: 0;
}

.homeViewMenu {
  display: none;
  position: absolute;
  right: 10px;
  top: 28px;
  background-color: #FFFFFF;
  border: 1px solid #979797;
  z-index: 1;
}

.homeViewMenuItem {
  padding: 5px 20px;
  font-family: sans-serif;
  font-size: 14px;
  cursor: pointer;
  z-index: 2;
}

.homeViewMenuItem:hover {
  background-color: #E7EEF6;
}

.homeViewWrapper .homeViewMenuHandle {
  display: none;
  position: relative;
  left: 18px;
  top: 18px;
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

/***/ "./extensions/ViewCubeUi/ViewCubeUi.css"
/*!**********************************************!*\
  !*** ./extensions/ViewCubeUi/ViewCubeUi.css ***!
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ViewCubeUi_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./ViewCubeUi.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/ViewCubeUi/ViewCubeUi.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ViewCubeUi_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ViewCubeUi_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ViewCubeUi_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_ViewCubeUi_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "data:image/png;base64,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"
/*!******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,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 ***!
  \******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,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";

/***/ },

/***/ "three"
/*!************************!*\
  !*** external "THREE" ***!
  \************************/
(module) {

"use strict";
module.exports = THREE;

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
/******/ 			"ViewCubeUi": 0
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
  !*** ./extensions/ViewCubeUi/ViewCubeUi.js ***!
  \*********************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ViewCubeUi: () => (/* binding */ ViewCubeUi)
/* harmony export */ });
/* harmony import */ var _ViewCube_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ViewCube.js */ "./extensions/ViewCubeUi/ViewCube.js");
/* harmony import */ var _ViewCubeUi_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ViewCubeUi.css */ "./extensions/ViewCubeUi/ViewCubeUi.css");





const av = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;


/**
 * Create the UI for the view cube.
 *
 * The extension id is: `Autodesk.ViewCubeUi`
 *
 * @example
 *    viewer.loadExtension('Autodesk.ViewCubeUi');
 *
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.ViewCubeUi
 * @class
 * @hideConstructor
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer instance.
 * @param {object} options - Not used.
 * @public
 */
function ViewCubeUi(viewer, options) {
  av.Extension.call(this, viewer, options);
  // Keep the constructor LEAN
  // The actual initialization happens in create()
  this.container = null;
  this.cube = null; // Autocam.ViewCube
  this.viewcube = null;
  this.homeViewContainer = null;
  this._created = false;
  this._initTriadVisibility = false;
  this.refreshCube = this.refreshCube.bind(this);
  this.displayViewCube = this.displayViewCube.bind(this);
  this.setViewType = this.setViewType.bind(this);
  this._updateView = this._updateView.bind(this);
  this._onModelAdded = this._onModelAdded.bind(this);
}

ViewCubeUi.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
ViewCubeUi.prototype.constructor = ViewCubeUi;

Object.assign(ViewCubeUi.prototype, {
  /**
   * @private
   */
  load: function () {
    this.create();

    this._displayViewCube(this.viewer.impl.is2d);

    this.localize();

    // Listen for the viewer's language-change event to self-localize.
    this._onLanguageChanged = () => this.localize();
    this.viewer.addEventListener(av.LANGUAGE_CHANGED_EVENT, this._onLanguageChanged);

    // Dispatch a view cube created event
    this.viewer.dispatchEvent({ type: av.VIEW_CUBE_CREATED_EVENT });

    // Refresh the cube when resizing
    this.viewer.addEventListener(av.VIEWER_RESIZE_EVENT, this.refreshCube);

    // Register the displayViewCube function as the callback for the viewCube preference.
    this.viewer.prefs.addListeners(avp.Prefs3D.VIEW_CUBE, this.displayViewCube);

    // Change the view when the VIEW_TYPE preference is set.
    this.viewer.prefs.addListeners(avp.Prefs3D.VIEW_TYPE, this.setViewType);

    if (this.viewer.model) {
      // Add first model according to the current mode (2D or 3D)
      const models = this.viewer.getVisibleModels().filter((model) => !!this.viewer.impl.is2d === model.is2d());
      this._onModelAdded({ model: models[0] });
    }

    // Register an event handler to update the view cube (not just once for model unloading/loading use cases)
    this.viewer.addEventListener(av.MODEL_ADDED_EVENT, this._onModelAdded);

    // This needs to be called to ensure that the preference callback is called.
    // By the time the viewer.setProfile function is called in the viewer (which will set the preferences), this extension is not loaded.
    this._setDefaultView();

    return true;
  },

  /**
   * Destroy the view cube.
   *
   * @private
   */
  unload: function () {
    this.viewer.prefs.removeListeners(avp.Prefs3D.VIEW_CUBE, this.displayViewCube);
    this.viewer.prefs.removeListeners(avp.Prefs3D.VIEW_TYPE, this.setViewType);
    this.viewer.removeEventListener(av.VIEWER_RESIZE_EVENT, this.refreshCube);
    this.viewer.removeEventListener(av.MODEL_ADDED_EVENT, this._onModelAdded);

    if (this._onLanguageChanged) {
      this.viewer.removeEventListener(av.LANGUAGE_CHANGED_EVENT, this._onLanguageChanged);
      this._onLanguageChanged = null;
    }

    if (this.container) {
      this.viewer.container.removeChild(this.container);
      this.viewcube = null;
    }

    if (this.cube) {
      this.cube.dtor();
      this.cube = null;
    }

    this.homeViewContainer = null;
    this.hideHomeViewMenu = null;
    this.viewer = null;
    return true;
  },

  /**
   * Initialize the view cube and the home button.
   * This method is called when the extension is loaded.
   */
  create: function () {
    if (this._created)
    return;
    this.initContainer();
    this.initHomeButton();
    this._created = true;
  },

  /**
   * @private
   */
  initContainer: function () {
    var _document = this.getDocument();
    this.container = _document.createElement('div');
    this.container.className = "viewcubeWrapper";
    this.viewer.container.appendChild(this.container);
  },

  /**
   * @private
   */
  initHomeButton: function () {
    if (this.homeViewContainer) {
      return;
    }

    var _document = this.getDocument();
    var homeViewContainer = _document.createElement('div');
    homeViewContainer.className = "homeViewWrapper";

    this.container.appendChild(homeViewContainer);
    this.homeViewContainer = homeViewContainer;

    var self = this;
    homeViewContainer.addEventListener("click", function () {
      self.viewer.navigation.setRequestHomeView(true);
    });
  },

  /**
   * Show or hide the view cube element. This also applies to the home button.
   *
   * @param {boolean} show - If set to false, the view cube and the home button will become invisible.
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#setVisible
   * @public
   */
  setVisible: function (show) {
    this.container.style.display = show ? 'block' : 'none';
  },

  /**
   * Update the VIEW_TYPE preference's default value.
   *
   * @private
   */
  _setDefaultView: function () {
    if (this.viewer.impl.is2d) return;

    if (this.viewer.impl.getModelCamera(this.viewer.model)) {
      return;
    }

    this.viewer.prefs.dispatchEvent(avp.Prefs3D.VIEW_TYPE);
  },

  /**
   * Set the viewType for the VIEW_TYPE preference
   *
   * @param {number} viewType - view index.
   * @private
   */
  _updateView: function (viewType) {
    if (this.viewer.impl.is2d) return;

    if (!this.viewer.prefs.set(avp.Prefs3D.VIEW_TYPE, viewType)) {
      // If the value was not changed, check with autocam as well, in case it was changed programmatically
      const autocamViewType = this.viewer.autocam.getViewType();
      if (viewType !== autocamViewType) {
        this.viewer.prefs.dispatchEvent(avp.Prefs3D.VIEW_TYPE);
      }
    }
  },

  /**
   * Set the viewCube view type.
   *
   * @param {string} viewType - 1 for orthographic, 2 for perspective, 3 for orthoFaces
   */
  setViewType: function (viewType) {
    if (this.viewer.impl.is2d || !this.cube) return;
    this.cube.setViewType(viewType);
  },

  /**
   * Show the x,y,z axes of the view cube.
   *
   * @param {boolean} show - if set to true, the view cube axes will be shown.
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#showTriad
   * @public
   */
  showTriad: function (show) {
    if (this.cube)
    this.cube.showTriad(show);else

    this._initTriadVisibility = show;
  },

  /**
   * Set the face of ViewCube and apply camera transformation according to it.
   *
   * @param {string} face - The face name of ViewCube. The name can contain multiple face names,
   * the format should be `"[front/back], [top/bottom], [left/right]"`.
   *
   * @example
   *    viewer.setViewCube('front top right');
   *    viewer.setViewCube('bottom left');
   *    viewer.setViewCube('back');
   *
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#setViewCube
   * @public
   */
  setViewCube: function (face) {
    if (this.cube) {
      this.cube.cubeRotateTo(face);
    }
  },

  /**
   * Hides the Home button next to the ViewCube.
   *
   * @param {boolean} show
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#displayHomeButton
   * @public
   */
  displayHomeButton: function (show) {// show/hide home button.
    if (this.homeViewContainer)
    this.homeViewContainer.style.display = show ? '' : 'none';
  },

  /**
   * Display the view cube. This will not effect the home button.
   *
   * @param {boolean} display - if set to false the view cube element will be invisible
   * @param {boolean} updatePrefs - update the view cube preference
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#displayViewCube
   * @public
   */
  displayViewCube: function (display, updatePrefs) {
    if (updatePrefs)
    this.viewer.prefs.set(avp.Prefs3D.VIEW_CUBE, display);

    if (display && !this.cube && !this.viewer.impl.is2d) {
      var _document = this.getDocument();
      this.viewcube = _document.createElement("div");
      this.viewcube.className = "viewcube";
      this.container.appendChild(this.viewcube);
      this.cube = new _ViewCube_js__WEBPACK_IMPORTED_MODULE_0__.ViewCube("cube", this.viewer.autocam, this.viewcube);
      this.cube.registerOnViewTypeChangedCb(this._updateView);
      this.cube.setGlobalManager(this.globalManager);

      // Move sibling on top of the viewcube.
      this.container.appendChild(this.homeViewContainer);

      if (this._initTriadVisibility) {
        this.showTriad(true);
      }
      delete this._initTriadVisibility;
    } else
    if (!this.cube) {
      this._positionHomeButton();
      return; //view cube is not existent and we want it off? Just do nothing.
    }

    this.viewcube.style.display = display ? "block" : "none";

    this._positionHomeButton();

    if (display) {
      this.viewer.autocam.refresh();
    }
  },

  /**
   * Localize the view cube
   *
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#localize
   * @public
   */
  localize: function () {
    this.cube && this.cube.localize();
    // Drop the cached context menu so it rebuilds with the active locale on next open.
    this.viewer.autocam?.clearDropdownMenu();
  },

  /**
   * @param {boolean} [show=true] show the compass
   */
  showCompass: function (show = true) {
    this.cube && this.cube.showCompass(show);
  },

  /**
   *
   * @param {number} [radians=0] // Angle of north in radians wrt front
   */
  setCompassRotation: function (radians = 0) {
    this.cube && this.cube.setCompassRotation(radians);
  },

  /**
   * Replace the default i18n-based face labels with custom text. Generates a new atlas from the provided labels
   * using the standard font and layout, then applies it as a persistent custom texture.
   *
   * Omit labels (no argument, undefined, null, or []) to restore locale-based atlases; same as clearing custom
   * texture on the underlying ViewCube.
   *
   * @param {string[]} [labels] - Six face labels in order: RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK; omit to reset.
   * @param {Object} [options] - Generator options (resolution, fontSizeRatio, etc.), see AtlasOptions.
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#setCustomLabels
   * @private
   */
  setCustomLabels: function (labels, options) {
    this.cube && this.cube.setCustomLabels.apply(this.cube, arguments);
  },

  /**
   * @param model
   * @private
   */
  _initCompass: function (model) {

    // calculate the north orientation angle
    const data = model && model.getData();
    const metadata = data && data.metadata;
    const northVector = model && model.getNorthVector();
    const projectNorthVector = northVector && new THREE.Vector3().fromArray(northVector);

    // Skip initialization if the model doesn't have the north vector
    if (!projectNorthVector) {
      return;
    }

    // Calculate the N orientation

    //       Front Direction (usually same as project or world north)
    //             ^
    //             |
    //             |
    //  left <---- o  ----> Right
    //           /
    //          /
    //         /
    //True North

    const customValues = metadata && metadata['custom values'];

    // // If the model has a nwModelToWorldTransform, we can calculate the angle to 'true north'.
    // if (customValues && customValues.nwModelToWorldTransform) {
    //     const m = customValues.nwModelToWorldTransform;
    //     const right = new THREE.Vector3(m[0], m[1], m[2]);
    //     const angle = new THREE.Vector3(1, 0, 0).angleTo(right);
    //     customValues.angleToTrueNorth = 360.0 - angle *(180.0 / Math.PI);
    // }

    // frontDirection is the direction looking into the front face of the cube
    const frontDirection = this.viewer.autocam.sceneFrontDirection.clone();
    const upVector = this.viewer.autocam.sceneUpDirection.clone();
    let cross = new THREE.Vector3();
    cross.crossVectors(frontDirection, projectNorthVector);
    const projectNorthAngle = projectNorthVector.angleTo(frontDirection) * (cross.dot(upVector) < 0 ? -1 : 1);
    let trueNorthAngle = customValues && customValues.angleToTrueNorth || 0;
    trueNorthAngle = trueNorthAngle * (Math.PI / 180);

    // Project North + True North will give us the final angle to point the north
    // Do not rotate the compass in aggregated view which sets applyRefPoint
    const radians = data?.loadOptions?.applyRefPoint ? 0 : projectNorthAngle + trueNorthAngle;
    this.cube.initCompass();
    this.setCompassRotation(radians);

    // Only show compass if preference is set
    this.showCompass(!!this.viewer.prefs.get(avp.Prefs3D.VIEW_CUBE_COMPASS));
  },

  /**
   * @param is2d
   * @private
   */
  _displayViewCube: function (is2d) {
    // Do not display the ViewCube for 2d models
    const display = is2d ? false : this.viewer.prefs.get(avp.Prefs3D.VIEW_CUBE);
    this.displayViewCube(display);
  },

  /**
   * @param event
   * @private
   */
  _onModelAdded: function (event) {
    // As soon as we enter 2D mode, hide the viewcube
    this._displayViewCube(this.viewer.impl.is2d);

    if (this.cube && !this.cube.hasCompass && !this.viewer.impl.is2d) {
      this._initCompass(event.model);
    }
  },

  /**
   * @private
   */
  _positionHomeButton: function () {
    if (this.homeViewContainer) {
      var viewCubeVisible = this.cube && this.viewcube && this.viewcube.style.display === 'block';
      if (viewCubeVisible) {
        this.homeViewContainer.classList.remove('no-viewcube');
      } else {
        this.homeViewContainer.classList.add('no-viewcube');
      }
    }
  },

  /**
   * Refresh the view cube
   *
   * @alias Autodesk.Viewing.Extensions.ViewCubeUi#refreshCube
   * @public
   */
  refreshCube: function () {
    this.cube && this.cube.refreshCube();
  }
});


/**
 * Register the extension with the extension manager.
 */
av.theExtensionManager.registerExtension('Autodesk.ViewCubeUi', ViewCubeUi);
})();

Autodesk.Extensions.ViewCubeUi = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=ViewCubeUi.js.map