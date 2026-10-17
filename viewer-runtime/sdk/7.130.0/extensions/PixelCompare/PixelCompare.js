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

/***/ "./extensions/PixelCompare/shaders/diff_frag.glsl"
/*!********************************************************!*\
  !*** ./extensions/PixelCompare/shaders/diff_frag.glsl ***!
  \********************************************************/
(module) {

module.exports = "#define OVERLAY 0\n#define SIDE_BY_SIDE 1\n#define FXAA_EDGE_SHARPNESS (8.0)\n#define FXAA_EDGE_THRESHOLD (0.125)\n#define FXAA_EDGE_THRESHOLD_MIN (0.05)\n#define FXAA_RCP_FRAME_OPT (0.5)\n#define FXAA_RCP_FRAME_OPT2 (2.0)\nuniform sampler2D texture1;\nuniform sampler2D texture2;\nuniform float diff_threshold;\nuniform highp vec2 resolution;\nuniform int diffMode;\nuniform float colorIntensity;\nuniform vec4 texture1DiffColor;\nuniform vec4 texture2DiffColor;\nuniform bool mainModelHidden;\nuniform bool secondaryModelHidden;\nuniform vec4 visibleModelBounds;\nin vec2 vUv;\nuniform float splitPosition;\nuniform highp float splitLineWidth;\nuniform vec3 splitLineColor;\nuniform highp float t;\nuniform sampler2D overlayTexture1;\nuniform sampler2D overlayTexture2;\nuniform vec4 overlayColor1;\nuniform vec4 overlayColor2;\nuniform bool hasOverlayTexture1;\nuniform bool hasOverlayTexture2;\nuniform bool mainOverlayHidden;\nuniform bool secondaryOverlayHidden;\nuniform vec4 blendedOverlayColor;\nfloat toGrayscale(vec4 v) {\n    return dot(v.rgb, vec3(0.299, 0.587, 0.114));\n}\nfloat getGrayAt(sampler2D texInput, float i, float j) {\n    vec4 tex = texture(texInput, vUv + resolution*vec2(i, j));\n    float gray = toGrayscale(tex);\n    return gray;\n}\nfloat getDarkestGray(float i, float j) {\n    float gray1 = mainModelHidden ? 1.0 : getGrayAt(texture1, i, j);\n    float gray2 = secondaryModelHidden ? 1.0 : getGrayAt(texture2, i, j);\n    return min(gray1, gray2);\n}\nfloat getDeltaAt(float i, float j) {\n    float gray1 = mainModelHidden ? 1.0 : getGrayAt(texture1, i, j);\n    float gray2 = secondaryModelHidden ? 1.0 : getGrayAt(texture2, i, j);\n    return gray1 - gray2;\n}\nvec4 getColorAt(float i, float j) {\n    if (mainModelHidden || secondaryModelHidden) {\n        if (vUv.x <= visibleModelBounds.x || vUv.y <= visibleModelBounds.y || vUv.x >= visibleModelBounds.z || vUv.y >= visibleModelBounds.w) {\n            if (mainModelHidden) {\n                return texture(texture2, vUv);\n            } else {\n                return texture(texture1, vUv);\n            }\n        }\n    }\n    float maxGray = getDarkestGray(i, j);\n    float delta = getDeltaAt(i, j);\n    if (abs(delta) > diff_threshold) {\n        if (delta < 0.0) {\n            return vec4(texture1DiffColor.rgb * colorIntensity, 1.0);\n        }\n        return vec4(texture2DiffColor.rgb * colorIntensity, 1.0);\n    }\n    return vec4(vec3(maxGray), 1.0);\n}\n#ifdef ANTI_ALIASING\n    void applyAntiAliasing() {\n        float lumaNw = toGrayscale(getColorAt(-0.5, -0.5));\n        float lumaSw = toGrayscale(getColorAt(0.5, -0.5));\n        float lumaNe = toGrayscale(getColorAt(-0.5, 0.5)) + 1.0/384.0;\n        float lumaSe = toGrayscale(getColorAt(0.5, 0.5));\n        vec4 rgbaM = getColorAt(0.0, 0.0);\n        float lumaM = toGrayscale(rgbaM);\n        float lumaMax = max(max(lumaNe, lumaSe), max(lumaNw, lumaSw));\n        float lumaMin = min(min(lumaNe, lumaSe), min(lumaNw, lumaSw));\n        float lumaMaxSubMinM = max(lumaMax, lumaM) - min(lumaMin, lumaM);\n        float lumaMaxScaledClamped = max(FXAA_EDGE_THRESHOLD_MIN, lumaMax * FXAA_EDGE_THRESHOLD);\n        if (lumaMaxSubMinM < lumaMaxScaledClamped) {\n            outFragColor = rgbaM;\n            return;\n        }\n        float dirSwMinusNe = lumaSw - lumaNe;\n        float dirSeMinusNw = lumaSe - lumaNw;\n        vec2 dir1 = normalize(vec2(dirSwMinusNe + dirSeMinusNw, dirSwMinusNe - dirSeMinusNw));\n        vec3 rgbN1 = getColorAt((-dir1 * FXAA_RCP_FRAME_OPT).x ,(-dir1 * FXAA_RCP_FRAME_OPT).y).rgb;\n        vec3 rgbP1 = getColorAt((dir1 * FXAA_RCP_FRAME_OPT).x ,(dir1 * FXAA_RCP_FRAME_OPT).y).rgb;\n        float dirAbsMinTimesC = min(abs(dir1.x), abs(dir1.y)) * FXAA_EDGE_SHARPNESS;\n        vec2 dir2 = clamp(dir1.xy / dirAbsMinTimesC, -2.0, 2.0);\n        vec3 rgbN2 = getColorAt((-dir2 * FXAA_RCP_FRAME_OPT2).x ,(-dir2 * FXAA_RCP_FRAME_OPT2).y).rgb;\n        vec3 rgbP2 = getColorAt((dir2 * FXAA_RCP_FRAME_OPT2).x ,(dir2 * FXAA_RCP_FRAME_OPT2).y).rgb;\n        vec3 rgbA = rgbN1 + rgbP1;\n        vec3 rgbB = ((rgbN2 + rgbP2) * 0.25) + (rgbA * 0.25);\n        float lumaB = toGrayscale(vec4(rgbB, 1.0));\n        float alpha = rgbaM.a;\n        if ((lumaB < lumaMin) || (lumaB > lumaMax))\n            outFragColor = vec4(rgbA * 0.5, rgbaM.a);\n        else\n            outFragColor = vec4(rgbB, rgbaM.a);\n    }\n#endif\nvoid main() {\n    vec4 tex1 = texture(texture1, vUv);\n    vec4 tex2 = texture(texture2, vUv);\n    vec4 overlay1 = hasOverlayTexture1 && !mainOverlayHidden ? texture(overlayTexture1, vUv) : vec4(0.0, 0.0, 0.0, 0.0);\n    vec4 overlay2 = hasOverlayTexture2 && !secondaryOverlayHidden ? texture(overlayTexture2, vUv) : vec4(0.0, 0.0, 0.0, 0.0);\n    if (diffMode == SIDE_BY_SIDE) {\n        if (abs(vUv.x - splitPosition) <= splitLineWidth) {\n            outFragColor = vec4(mix(tex1.rgb, splitLineColor, t), 1.0);\n        } else {\n            vec4 tex = vUv.x < splitPosition ? tex1 : tex2;\n            vec3 overlayRgb = vUv.x < splitPosition ? overlay1.rgb : overlay2.rgb;\n            float overlayAlpha = vUv.x < splitPosition ? overlay1.a : overlay2.a;\n            outFragColor = vec4(mix(tex1.rgb, tex.rgb, t) * (1.0 - overlayAlpha) + overlayRgb, 1.0);\n        }\n    } else if (diffMode == OVERLAY) {\n        vec4 overlayColor = vec4(0.0, 0.0, 0.0, 0.0);\n        if (mainOverlayHidden) {\n            overlayColor = overlay2;\n        } else if (secondaryOverlayHidden) {\n            overlayColor = overlay1;\n        } else if (overlay1.a > 0.0 && overlay2.a > 0.0) {\n            overlayColor = vec4(blendedOverlayColor.rgb * max(overlay1.a, overlay2.a), max(overlay1.a, overlay2.a));\n        } else if (overlay1.a > 0.0) {\n            overlayColor = vec4(overlayColor1.rgb * overlay1.a, overlay1.a);\n        } else if (overlay2.a > 0.0) {\n            overlayColor = vec4(overlayColor2.rgb * overlay2.a, overlay2.a);\n        }\n        outFragColor = vec4(mix(tex1.rgb, getColorAt(0.0, 0.0).rgb, t) * (1.0 - overlayColor.a) + overlayColor.rgb, 1.0);\n        #ifdef ANTI_ALIASING\n            float delta = getDeltaAt(0.0, 0.0);\n            if (abs(delta) > diff_threshold) {\n                return;\n            }\n            for (int i = -1; i <= 1; i++) {\n                for (int j = -1; j <= 1; j++) {\n                    if (i != 0 && j!= 0) {\n                        float delta = getDeltaAt(float(i), float(j));\n                        if (abs(delta) > diff_threshold) {\n                            applyAntiAliasing();\n                            return;\n                        }\n                    }\n                }\n            }\n        #endif\n    }\n}\n";

/***/ },

/***/ "./extensions/PixelCompare/shaders/diff_vert.glsl"
/*!********************************************************!*\
  !*** ./extensions/PixelCompare/shaders/diff_vert.glsl ***!
  \********************************************************/
(module) {

module.exports = "out vec2 vUv;\nuniform vec2 resolution;\nvoid main() {\n    vUv = uv;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}";

/***/ },

/***/ "./extensions/PixelCompare/PixelCompareConstants.js"
/*!**********************************************************!*\
  !*** ./extensions/PixelCompare/PixelCompareConstants.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DEFAULTS: () => (/* binding */ DEFAULTS),
/* harmony export */   DIFF_CONTROL_GROUP_ID: () => (/* binding */ DIFF_CONTROL_GROUP_ID),
/* harmony export */   DIFF_MODES: () => (/* binding */ DIFF_MODES),
/* harmony export */   DIFF_MODES_SHADER: () => (/* binding */ DIFF_MODES_SHADER),
/* harmony export */   EVENTS: () => (/* binding */ EVENTS)
/* harmony export */ });
// Values correspond to the ones inside Design-Diff
const DIFF_MODES = {
  OVERLAY: 'overlay',
  SIDE_BY_SIDE: 'sidebyside'
};

// Values correspond to the the diff fragment shader.
const DIFF_MODES_SHADER = {
  [DIFF_MODES.OVERLAY]: 0,
  [DIFF_MODES.SIDE_BY_SIDE]: 1
};

const EVENTS = {
  DIFF_TOOL_DIFF_MODE_CHANGED: 'diff.tool.diff.mode.changed',
  DIFF_TOOL_DEACTIVATED: 'diff.tool.deactivated',
  DIFF_TOOL_MODEL_VISIBILITY_CHANGED: 'diff.tool.model.visibility.changed',
  DIFF_TOOL_OVERLAY_VISIBILITY_CHANGED: 'diff.tool.overlay.visibility.changed'
};

const DEFAULTS = {
  SPLIT_LINE_MARGIN: 50,
  SPLIT_LINE_POSITION: 0.5,
  SPLIT_LINE_WIDTH: 1,
  SPLIT_LINE_COLOR: 0x73a9e8,
  ANIMATION_DURATION: 0.3,
  DEFAULT_DIFF_MODE: DIFF_MODES.OVERLAY
};

const DIFF_CONTROL_GROUP_ID = 'pixel_compare_control_group';

/***/ },

/***/ "./extensions/PixelCompare/PixelCompareTool.js"
/*!*****************************************************!*\
  !*** ./extensions/PixelCompare/PixelCompareTool.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ PixelCompareTool)
/* harmony export */ });
/* harmony import */ var _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./PixelCompareConstants.js */ "./extensions/PixelCompare/PixelCompareConstants.js");


const av = Autodesk.Viewing;

class PixelCompareTool {
  constructor(extension) {
    this.extension = extension;
    this.viewer = extension.viewer;
    this.options = extension.options;

    this.setGlobalManager(this.viewer.globalManager);

    this.names = ['pixelCompare'];

    this.splitLineMinTouchArea = Autodesk.Viewing.isMobileDevice() ? 44 : 10; // Amount of minimum touch area pixels for the split line.
    this.splitLineLimit = _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DEFAULTS.SPLIT_LINE_MARGIN; // Limit of pixels from each side of the canvas.

    this.lastDragPos = new THREE.Vector2();
  }

  getNames() {
    return this.names;
  }

  getName() {
    return this.names[0];
  }

  getCursor() {
    if (this.lastMouseEvent) {
      if (this.extension.diffMode === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE && this.intersectSplitLine(this.lastMouseEvent)) {
        return 'col-resize';
      }
    }

    if (this.extension.changeOffsetMode) {
      return 'move';
    }

    return null;
  }

  isActive() {
    return this.isActive;
  }

  activate(name) {
    if (name === this.getName() && !this.isActive) {
      this.isActive = true;

    }
  }

  deactivate(name) {
    if (name === this.getName() && this.isActive) {
      this.isActive = false;

    }
  }

  getRelativeX(event) {
    var rect = this.viewer.impl.getCanvasBoundingClientRect();
    var posRatio = event.canvasX / rect.width;
    return posRatio;
  }

  intersectSplitLine(event) {
    const pos = this.getRelativeX(event);
    const { width } = this.viewer.impl.getCanvasBoundingClientRect();

    return Math.abs(pos - this.extension.splitPosition) * width < Math.max(this.extension.splitLineWidth, this.splitLineMinTouchArea);
  }

  handleButtonDown(event, button) {
    if (this.extension.diffMode === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE && this.intersectSplitLine(event)) {
      this.draggingSplitLine = true;

      return true;
    }

    if (this.extension.changeOffsetMode && !Autodesk.Viewing.Private.isRightClick(event, this.viewer.navigation)) {
      this.draggingOffset = true;
      this.lastDragPos.set(event.canvasX, event.canvasY);

      return true;
    }

    return false;
  }

  handleButtonUp(event, button) {
    let consume = false;

    if (this.extension.diffMode === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE) {
      consume = this.draggingSplitLine;
      this.draggingSplitLine = false;
    }

    if (this.draggingOffset) {
      this.draggingOffset = false;
      consume = true;
    }

    return consume;
  }

  handleMouseMove(event) {
    let consume = false;

    this.lastMouseEvent = event;

    if (this.draggingSplitLine && this.extension.diffMode === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE) {
      const relativePos = this.getRelativeX(event);

      const { width } = this.viewer.impl.getCanvasBoundingClientRect();
      const absolutePos = relativePos * width;

      if (absolutePos >= this.splitLineLimit && absolutePos <= width - this.splitLineLimit) {
        this.extension.setSplitPosition(relativePos);
      }

      consume = true;
    }

    if (this.draggingOffset) {
      const point = new THREE.Vector2(event.canvasX, event.canvasY);
      this.translateSecondaryModel(point.clone().sub(this.lastDragPos));
      this.lastDragPos = point;

      consume = true;
    }

    return consume;
  }

  handleKeyDown(event, keyCode) {
    if (!this.extension.changeOffsetMode) {
      return;
    }

    let translation;

    switch (keyCode) {
      case Autodesk.Viewing.KeyCode.LEFT:
      case Autodesk.Viewing.KeyCode.a:
        translation = new THREE.Vector3(-1, 0, 0);
        break;
      case Autodesk.Viewing.KeyCode.RIGHT:
      case Autodesk.Viewing.KeyCode.d:
        translation = new THREE.Vector3(1, 0, 0);
        break;
      case Autodesk.Viewing.KeyCode.UP:
      case Autodesk.Viewing.KeyCode.w:
        translation = new THREE.Vector3(0, -1, 0);
        break;
      case Autodesk.Viewing.KeyCode.DOWN:
      case Autodesk.Viewing.KeyCode.s:
        translation = new THREE.Vector3(0, 1, 0);
        break;
    }

    // When pressing the arrows, move the secondary model by one pixel.
    if (translation) {
      this.translateSecondaryModel(translation);
      return true;
    }

    return false;
  }

  translateSecondaryModel(translation) {
    // Convert client coords (pixels) to world coords
    const p1 = this.viewer.clientToWorld(translation.x, translation.y, false, true).point;
    const p2 = this.viewer.clientToWorld(0, 0, false, true).point;
    const worldTranslation = p1.sub(p2);
    this.extension.translateSecondaryModel(worldTranslation);
  }

  handleGesture(event) {
    switch (event.type) {

      case 'dragstart':
        return this.handleButtonDown(event);

      case 'dragmove':
        return this.handleMouseMove(event);

      case 'dragend':
        return this.handleButtonUp(event);
    }
    return false;
  }
}

av.GlobalManagerMixin.call(PixelCompareTool.prototype);

/***/ },

/***/ "./extensions/PixelCompare/PixelCompareUI.js"
/*!***************************************************!*\
  !*** ./extensions/PixelCompare/PixelCompareUI.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ PixelCompareUI)
/* harmony export */ });
/* harmony import */ var _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./PixelCompareConstants.js */ "./extensions/PixelCompare/PixelCompareConstants.js");
/* harmony import */ var _PixelCompareUI_scss__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./PixelCompareUI.scss */ "./extensions/PixelCompare/PixelCompareUI.scss");



const av = Autodesk.Viewing;

class PixelCompareUI {
  constructor(extension) {
    this.extension = extension;
    this.viewer = extension.viewer;
    this.options = extension.options;
    this.viewerContainer = this.viewer.container;
    this.setGlobalManager(this.viewer.globalManager);
  }

  createUI() {
    const _document = this.getDocument();
    this.documents = [this.extension.mainModelInfo, this.extension.secondaryModelInfo];

    const title = Autodesk.Viewing.i18n.translate('Compared Documents');
    this.panel = new Autodesk.Viewing.UI.DockingPanel(this.viewerContainer, 'ComparePanel', title, { addFooter: false });

    this.panel.container.classList.add('ComparePanel');

    const scrollContainer = this.panel.createScrollContainer();
    this.mainContainer = _document.createElement('div');
    this.mainContainer.className = 'ComparePanel__main-container';

    this.createButtonsContainer();

    this.itemsContainer = _document.createElement('div');
    this.itemsContainer.className = 'ComparePanel__items-container';
    this.mainContainer.appendChild(this.itemsContainer);

    this.colorStrips = [];
    this.documentContainers = [];
    this.visibilityButtons = [];
    this.labels = [];
    this.colorButtonStateBackup = undefined;

    this.documents.forEach((doc, i) => {
      this.createDocumentContainer(doc, i);
    });

    this.onDiffModeChanged();

    scrollContainer.appendChild(this.mainContainer);

    if (this.options.defaultComparePanelVisibility === undefined || !!this.options.defaultComparePanelVisibility) {
      this.panel.setVisible(true);
    }

    this.toolbarVisibilityBackup = {};

    this.addToolbar();

    this.toggleColorStrips(true);

    this.panel.addVisibilityListener((visible) => {
      const state = visible ? Autodesk.Viewing.UI.Button.State.ACTIVE : Autodesk.Viewing.UI.Button.State.INACTIVE;
      this.toolbarControls.showPanelButton.setState(state);

      const tooltip = visible ? 'Close Panel' : 'Open Panel';
      this.toolbarControls.showPanelButton.setToolTip(Autodesk.Viewing.i18n.t(tooltip));
    });

    this.onDiffModeChangedBinded = this.onDiffModeChanged.bind(this);
    this.updateVisibilityButtonsBinded = this.updateVisibilityButtons.bind(this);

    this.viewer.addEventListener(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.EVENTS.DIFF_TOOL_DIFF_MODE_CHANGED, this.onDiffModeChangedBinded);
    this.viewer.addEventListener(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.EVENTS.DIFF_TOOL_MODEL_VISIBILITY_CHANGED, this.updateVisibilityButtonsBinded);
  }

  destroyUI() {
    this.panel.uninitialize();

    if (!this.hadToolbar) {
      this.viewerContainer.removeChild(this.toolbar.container);
      this.viewer.toolbar = undefined;
    } else {
      this.toolbar.removeControl(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_CONTROL_GROUP_ID);
    }

    this.toolbar = null;
    this.clearLabels();
    this.colorStrips = null;
    this.documentContainer = null;
    this.documents = null;
    this.colorButtonStateBackup = undefined;

    this.restoreLMVToolbar();

    this.toolbarVisibilityBackup = {};

    this.viewer.removeEventListener(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.EVENTS.DIFF_TOOL_DIFF_MODE_CHANGED, this.onDiffModeChangedBinded);
    this.viewer.removeEventListener(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.EVENTS.DIFF_TOOL_MODEL_VISIBILITY_CHANGED, this.updateVisibilityButtonsBinded);
  }

  hideLMVToolbar() {
    const lmvToolbar = this.viewer.getToolbar && this.viewer.getToolbar();

    if (lmvToolbar) {
      lmvToolbar._controls.forEach((control) => {
        this.toolbarVisibilityBackup[control.getId()] = control.isVisible();

        // keep only navigation tools
        if (control.getId() !== Autodesk.Viewing.TOOLBAR.NAVTOOLSID) {
          control.setVisible(false);
        }
      });
    }
  }

  restoreLMVToolbar() {
    const lmvToolbar = this.viewer.getToolbar && this.viewer.getToolbar();

    if (lmvToolbar) {
      lmvToolbar._controls.forEach((control) => {
        control.setVisible(this.toolbarVisibilityBackup[control.getId()]);
      });
    }
  }

  createButtonsContainer() {
    const _document = this.getDocument();
    const buttonsContainer = _document.createElement('div');
    buttonsContainer.className = 'ComparePanel__buttons-container';
    this.mainContainer.appendChild(buttonsContainer);

    this.colorButton = this.createColorButton();
    buttonsContainer.appendChild(this.colorButton.container);

    this.moveButton = this.createMoveButton();
    buttonsContainer.appendChild(this.moveButton.container);
  }

  toggleColorStrips(show) {
    this.colorStrips.forEach((colorStrip) => {
      if (show) {
        colorStrip.classList.add('active');
      } else {
        colorStrip.classList.remove('active');
      }
    });

    this.extension.changeColorIntensity(show ? 1.0 : 0.0);
  }

  colorButtonOnClick() {
    const currentState = this.colorButton.getState();
    if (currentState === Autodesk.Viewing.UI.Button.State.ACTIVE) {
      this.toggleColorStrips(false);
      this.colorButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
      this.colorButton.setIcon('pixelCompareFont-show-colors-btn');
      this.colorButton.setToolTip(Autodesk.Viewing.i18n.translate('Show colors'));
    } else {
      this.toggleColorStrips(true);
      this.colorButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
      this.colorButton.setIcon('pixelCompareFont-hide-colors-btn');
      this.colorButton.setToolTip(Autodesk.Viewing.i18n.translate('Hide colors'));
    }
  }

  createColorButton() {
    const colorButton = new Autodesk.Viewing.UI.Button('compare-panel-color-button');
    colorButton.setIcon('pixelCompareFont-show-colors-btn');
    colorButton.setToolTip(Autodesk.Viewing.i18n.translate('Show colors'));
    colorButton.addEventListener('click', this.colorButtonOnClick.bind(this));
    colorButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);

    return colorButton;
  }

  isMoveActive() {
    return this.moveButton && this.moveButton.getState() === Autodesk.Viewing.UI.Button.State.ACTIVE;
  }

  moveButtonOnClick() {
    const currentState = this.moveButton.getState();
    if (currentState === Autodesk.Viewing.UI.Button.State.INACTIVE) {
      this.moveButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
      this.documentContainers[0].classList.add('align');
      this.extension.setChangeOffsetMode(true);
      this.moveButton.setToolTip(Autodesk.Viewing.i18n.translate('Finish align'));
    } else if (currentState === Autodesk.Viewing.UI.Button.State.ACTIVE) {
      this.moveButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
      this.extension.setChangeOffsetMode(false);
      this.documentContainers[0].classList.remove('align');
      this.moveButton.setToolTip(Autodesk.Viewing.i18n.translate('Align'));
    }
  }

  createMoveButton() {
    const moveButton = new Autodesk.Viewing.UI.Button('compare-panel-move-button');
    moveButton.setIcon('pixelCompareFont-move-btn');
    moveButton.setToolTip(Autodesk.Viewing.i18n.translate('Align'));
    moveButton.addEventListener('click', this.moveButtonOnClick.bind(this));

    return moveButton;
  }

  createDocumentContainer(doc, index) {

    const _document = this.getDocument();
    const documentContainer = _document.createElement('div');
    documentContainer.className = 'ComparePanel__document-container';
    this.itemsContainer.appendChild(documentContainer);
    this.documentContainers.push(documentContainer);

    const colorStrip = _document.createElement("div");
    colorStrip.className = "ComparePanel__doc-color";
    colorStrip.classList.add(index === 0 ? "main" : "secondary");
    const mainColor = this.extension.mainModelDiffColor;
    const secondaryColor = this.extension.secondaryModelDiffColor;
    if (mainColor) {
      colorStrip.style.setProperty('--mainColor', new THREE.Color(mainColor.x, mainColor.y, mainColor.z).getStyle());
    }
    if (secondaryColor) {
      colorStrip.style.setProperty('--secondaryColor', new THREE.Color(secondaryColor.x, secondaryColor.y, secondaryColor.z).getStyle());
    }
    documentContainer.appendChild(colorStrip);

    this.colorStrips.push(colorStrip);

    const title = _document.createElement('div');
    title.className = 'ComparePanel__doc-title';
    const titleFormatted = doc.title && `${doc.title}`;
    title.textContent = titleFormatted || `${Autodesk.Viewing.i18n.translate('Document')} ${index + 1}`;
    colorStrip.appendChild(title);

    const descriptionContainer = _document.createElement('div');
    descriptionContainer.className = 'ComparePanel__doc-description treeview';
    colorStrip.appendChild(descriptionContainer);

    const documentVersion = this.getFormattedVersionHeading(doc);
    if (documentVersion) {
      const heading = _document.createElement('div');
      heading.className = 'ComparePanel__doc-heading';
      heading.textContent = documentVersion;
      descriptionContainer.appendChild(heading);
    }

    const descriptionData = _document.createElement('div');
    descriptionData.className = 'ComparePanel__doc-description-data';
    descriptionContainer.appendChild(descriptionData);

    if (doc.creator && doc.creationTime) {
      const creator = _document.createElement('div');
      creator.textContent = `${Autodesk.Viewing.i18n.translate('Uploaded By')}: ${doc.creator}`;
      descriptionData.appendChild(creator);

      const date = _document.createElement('div');
      const formattedDate = doc.creationTime;
      date.textContent = `${Autodesk.Viewing.i18n.translate('At')}: ${formattedDate}`;
      descriptionData.appendChild(date);
    }

    if (doc.issuanceDate) {
      const date = _document.createElement('div');
      date.textContent = `${Autodesk.Viewing.i18n.translate('Issuance date')}: ${doc.issuanceDate}`;
      descriptionData.appendChild(date);
    }

    const visibilityButton = _document.createElement('div');
    visibilityButton.className = 'visibility';
    visibilityButton.id = `pixelCompare-visibility-button-${index}`;
    visibilityButton.addEventListener('click', () => {
      if (index === 0) {
        this.extension.changeMainModelVisibility(!this.extension.getMainModelVisibility());
      } else {
        this.extension.changeSecondaryModelVisibility(!this.extension.getSecondaryModelVisibility());
      }
    });

    const visibilityButtonContainer = _document.createElement('div');
    visibilityButtonContainer.appendChild(visibilityButton);

    this.visibilityButtons.push(visibilityButtonContainer);
    descriptionContainer.appendChild(visibilityButtonContainer);
  }

  clearLabels() {
    this.labels.forEach((label) => {
      this.viewerContainer.removeChild(label);
    });

    this.labels = [];
  }

  getFormattedVersionLabel(doc) {
    const versionFormatted = doc.version && `V${doc.version}`;
    const versionSetFormatted = doc.versionSet && `${doc.versionSet}`;
    const formattedVersionLabel = versionFormatted || versionSetFormatted || '';
    return formattedVersionLabel;
  }

  getFormattedVersionHeading(doc) {
    const formattedVersion = this.getFormattedVersionLabel(doc);
    const formattedRevision = doc.revision ? ` | ${doc.revision}` : '';

    let formattedVersionIndicator = '';
    if (doc.isCurrentVersion !== undefined) {
      const versionIndicator = doc.isCurrentVersion ? 'Current' : 'Not-current';
      formattedVersionIndicator = ` (${Autodesk.Viewing.i18n.translate(versionIndicator)})`;
    }

    const formattedCollectionName = doc.collection?.name ? ` | ${doc.collection.name}` : '';

    return formattedVersion ? `${formattedVersion}${formattedRevision}${formattedVersionIndicator}${formattedCollectionName}` : '';
  }

  onDiffModeChanged() {
    const getDocText = (index) => {
      if (this.documents[index].title) {
        const formattedVersionLabel = this.getFormattedVersionLabel(this.documents[index]);
        const collectionName = this.documents[index].collection?.name;
        if (collectionName?.length) {
          const versionText = !!formattedVersionLabel ? ` (${formattedVersionLabel}) ` : ' ';
          return `${this.documents[index].title}${versionText}| ${collectionName}`;
        } else {
          return `${this.documents[index].title} ${formattedVersionLabel}`;
        }
      } else {
        return `${Autodesk.Viewing.i18n.translate('Document')} ${index + 1}`;
      }
    };

    const positions = ['left', 'right'];

    this.clearLabels();

    if (this.extension.getDiffMode() === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE) {
      this.documents.forEach((doc, i) => {
        this.createLabel(getDocText(i), positions[i]);
      });

      const currentState = this.colorButton.getState();

      // Backup current state only if it's not disabled.
      if (currentState !== Autodesk.Viewing.UI.Button.State.DISABLED) {
        this.colorButtonStateBackup = currentState;
      }

      // Disable button if it's currently active. Colors are not allowed on side-by-side mode.
      if (currentState === Autodesk.Viewing.UI.Button.State.ACTIVE) {
        this.colorButtonOnClick();
      }

      this.colorButton.setState(Autodesk.Viewing.UI.Button.State.DISABLED);
    } else {
      this.createLabel(`${getDocText(0)} vs. ${getDocText(1)}`, 'left');

      if (this.colorButtonStateBackup !== undefined) {
        if (this.colorButtonStateBackup === Autodesk.Viewing.UI.Button.State.ACTIVE) {
          this.colorButtonOnClick();
        }

        this.colorButton.setState(this.colorButtonStateBackup);
      }
    }

    this.updateVisibilityButtons();
  }

  updateVisibilityButtons() {
    for (let i = 0; i <= 1; i++) {
      this.visibilityButtons[i].className = this.extension.modelHiddenMap[i] ? 'dim' : '';
      this.visibilityButtons[i].style.opacity = this.extension.getDiffMode() === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE ? 0.3 : 1.0;
    }
  }

  createLabel(text, pos) {
    const _document = this.getDocument();
    const label = _document.createElement('div');
    label.className = 'CompareUI__label';
    label.textContent = text;

    if (pos === 'left') {
      label.style.left = '0px';
    } else {
      label.style.right = '0px';
    }

    this.viewerContainer.appendChild(label);
    this.labels.push(label);
  }

  sideBySideButtonOnClick() {
    const state = this.toolbarControls.sideBySideButton.getState();
    if (state === Autodesk.Viewing.UI.Button.State.INACTIVE) {
      this.toolbarControls.sideBySideButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
      this.showDiffButton.setIcon('pixelCompareFont-sidebyside-btn');
      this.extension.setDiffMode(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE);

      if (this.isMoveActive()) {
        this.moveButtonOnClick();
      }
    }

    this.showDiffButton.onClick = this.showDiffButton.arrowButton.onClick;
  }

  overlayButtonOnClick() {
    const state = this.toolbarControls.overlayButton.getState();
    if (state === Autodesk.Viewing.UI.Button.State.INACTIVE) {
      this.toolbarControls.overlayButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
      this.showDiffButton.setIcon('pixelCompareFont-overlay-btn');
      this.extension.setDiffMode(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.OVERLAY);
    }

    this.showDiffButton.onClick = this.showDiffButton.arrowButton.onClick;
  }

  showPanelOnClick() {
    const isVisible = this.panel.isVisible();
    this.panel.setVisible(!isVisible);
  }

  exitButtonOnClick() {
    const state = this.toolbarControls.exitButton.getState();
    if (state === Autodesk.Viewing.UI.Button.State.INACTIVE) {
      this.toolbarControls.exitButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
      this.extension.deactivate();
    } else {
      this.toolbarControls.exitButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
    }
  }

  addToolbar() {
    this.hadToolbar = !!this.viewer.getToolbar();

    if (!this.hadToolbar) {
      this.viewer._createToolbar();
      this.viewer.loadExtension('Autodesk.DefaultTools.NavTools', this.viewer.config);
    }

    this.hideLMVToolbar();

    this.toolbar = this.viewer.getToolbar();

    this.toolbarControls = {};

    this.viewerToolbarDiffGroup = new Autodesk.Viewing.UI.ControlGroup(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_CONTROL_GROUP_ID);
    this.toolbar.addControl(this.viewerToolbarDiffGroup);
    this.toolbar.container.classList.add('CompareUI__toolbar');
    this.viewerContainer.appendChild(this.toolbar.container);

    this.showDiffButton = new Autodesk.Viewing.UI.ComboButton('diff-tool-button-combo');
    this.showDiffButton.setIcon('pixelCompareFont-overlay-btn');
    this.showDiffButton.setToolTip(Autodesk.Viewing.i18n.translate('Show Differences'));
    this.showDiffButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
    this.showDiffButton.setDisplay('block');
    this.viewerToolbarDiffGroup.addControl(this.showDiffButton);

    this.toolbarControls.sideBySideButton = new Autodesk.Viewing.UI.Button('diff-tool-button-sidebyside-diff');
    this.toolbarControls.sideBySideButton.setIcon('pixelCompareFont-sidebyside-btn');
    this.toolbarControls.sideBySideButton.setToolTip(Autodesk.Viewing.i18n.translate('Side by Side'));
    this.toolbarControls.sideBySideButton.onClick = this.sideBySideButtonOnClick.bind(this);

    this.showDiffButton.addControl(this.toolbarControls.sideBySideButton);

    this.toolbarControls.overlayButton = new Autodesk.Viewing.UI.Button('diff-tool-button-overlay-diff');
    this.toolbarControls.overlayButton.setIcon('pixelCompareFont-overlay-btn');
    this.toolbarControls.overlayButton.setToolTip(Autodesk.Viewing.i18n.translate('Overlay'));
    this.toolbarControls.overlayButton.onClick = this.overlayButtonOnClick.bind(this);

    this.showDiffButton.addControl(this.toolbarControls.overlayButton);

    if (this.extension.getDiffMode() === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_0__.DIFF_MODES.SIDE_BY_SIDE) {
      this.toolbarControls.sideBySideButton.onClick();
    } else {
      this.toolbarControls.overlayButton.onClick();
    }

    this.toolbarControls.showPanelButton = new Autodesk.Viewing.UI.Button('diff-tool-button-changes');
    this.toolbarControls.showPanelButton.setIcon('pixelCompareFont-panel-btn');
    this.toolbarControls.showPanelButton.onClick = this.showPanelOnClick.bind(this);

    this.toolbarControls.showPanelButton.setToolTip(Autodesk.Viewing.i18n.translate('Close Panel'));
    this.toolbarControls.showPanelButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
    this.viewerToolbarDiffGroup.addControl(this.toolbarControls.showPanelButton);

    this.toolbarControls.exitButton = new Autodesk.Viewing.UI.Button('diff-tool-button-exit');
    this.toolbarControls.exitButton.setIcon('pixelCompareFont-exit-compare-btn');
    this.toolbarControls.exitButton.setToolTip(Autodesk.Viewing.i18n.translate('Exit comparing'));

    this.toolbarControls.exitButton.onClick = this.exitButtonOnClick.bind(this);

    this.viewerToolbarDiffGroup.addControl(this.toolbarControls.exitButton);
  }
}

av.GlobalManagerMixin.call(PixelCompareUI.prototype);

/***/ },

/***/ "./extensions/PixelCompare/shaders/DiffShader.js"
/*!*******************************************************!*\
  !*** ./extensions/PixelCompare/shaders/DiffShader.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DiffShader: () => (/* binding */ DiffShader)
/* harmony export */ });
/* harmony import */ var _diff_vert_glsl__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./diff_vert.glsl */ "./extensions/PixelCompare/shaders/diff_vert.glsl");
/* harmony import */ var _diff_vert_glsl__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_diff_vert_glsl__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _diff_frag_glsl__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./diff_frag.glsl */ "./extensions/PixelCompare/shaders/diff_frag.glsl");
/* harmony import */ var _diff_frag_glsl__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_diff_frag_glsl__WEBPACK_IMPORTED_MODULE_1__);



const avp = Autodesk.Viewing.Private;
const chunks = avp.ShaderChunks;

let DiffShader = {

  uniforms: THREE.UniformsUtils.merge([

  chunks.DepthTextureUniforms,

  {
    diff_threshold: { type: 'f', value: 0.1 },
    texture1: { type: 't', value: null },
    texture2: { type: 't', value: null },
    texture1DiffColor: { type: 'v4', value: new THREE.Vector4(1, 0, 0, 1) },
    texture2DiffColor: { type: 'v4', value: new THREE.Vector4(0, 0, 1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1 / 1024, 1 / 512) },
    splitPosition: { type: 'f', value: 0.0 },
    splitLineColor: { type: 'c', value: null },
    diffMode: { type: 'i', value: 0 },
    splitLineWidth: { type: 'f', value: 1.0 },
    colorIntensity: { type: 'f', value: 1.0 },
    t: { type: 'f', value: 1.0 },
    mainModelHidden: { type: 'i', value: 0 },
    secondaryModelHidden: { type: 'i', value: 0 },
    visibleModelBounds: { type: 'v4', value: new THREE.Vector4() },
    overlayTexture1: { type: 't', value: null },
    overlayColor1: { type: 'v4', value: new THREE.Vector4(135 / 255, 179 / 255, 64 / 255, 1) },
    hasOverlayTexture1: { type: 'i', value: 0 },
    mainOverlayHidden: { type: 'i', value: 0 },
    overlayTexture2: { type: 't', value: null },
    overlayColor2: { type: 'v4', value: new THREE.Vector4(236 / 255, 74 / 255, 65 / 255, 1) },
    hasOverlayTexture2: { type: 'i', value: 0 },
    secondaryOverlayHidden: { type: 'i', value: 0 },
    blendedOverlayColor: { type: 'v4', value: new THREE.Vector4(156 / 255, 156 / 255, 156 / 255, 1) }
  }]
  ),

  vertexShader: (_diff_vert_glsl__WEBPACK_IMPORTED_MODULE_0___default()),
  fragmentShader: (_diff_frag_glsl__WEBPACK_IMPORTED_MODULE_1___default())

};

/***/ },

/***/ "./src/wgs/wgsl-preprocessor/wgsl-preprocessor.js"
/*!********************************************************!*\
  !*** ./src/wgs/wgsl-preprocessor/wgsl-preprocessor.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $wgsl: () => (/* binding */ $wgsl),
/* harmony export */   wgsl: () => (/* reexport safe */ wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)
/* harmony export */ });
/* harmony import */ var wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! wgsl-preprocessor/wgsl-preprocessor */ "./node_modules/wgsl-preprocessor/wgsl-preprocessor.js");

/**
 * Checks if there is "enough" `values` for the given `tokens`.
 * Expects `tokens` to be an existing array.
 */
function check(tokens, values) {
  if (!values || values.length < tokens.length) {
    const noValues = tokens.slice(values?.length || 0).map((t) => `"$${t}"`).join(', ');
    throw new Error(`[wgpu] Missing values for: ${noValues}`);
  }
  return values;
}

/**
 * Reifies `$...` tokens in wgsl shaders. `...` should follow the `\w+` pattern to be discoverable.
 *
 * Supported cases depending on a type of `values`:
 * - if `values` is a primitive, rest arguments after `code` will be used as token values;
 * - if `values` is an object, it's used as a simple single-level dictionary, e.g.,
 *   for the object `{ foo: 'bar' }`, `bar` replaces the token `$foo`;
 * - if `values` is an array, tokens are replaced with its elements by order of their occurence.
 *
 * In each of the non-primitive cases, rest `...args` is ignored.
*/
function $wgsl(code, values, ...args) {
  const $ = /\$\w+/;
  const tokens = code.match(/(?<=\$)(\w+)/g);
  if (!tokens || !tokens.length) return code;

  if (Array.isArray(values)) {
    return (0,wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)(code.split($), ...check(tokens, values));
  }
  if (values && !Array.isArray(values) && typeof values === 'object') {
    return (0,wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)(code.split($), ...tokens.map((token) => {
      if (!Object.hasOwn(values, token)) {
        throw new Error(`[wgpu] Missing value for "$${token}"`);
      }
      const value = values[token];
      if (typeof value === 'object' && value !== null || typeof value === 'function') {
        throw new Error(`[wgpu] Unsupported value type "${typeof value}"`);
      }
      return value;
    }));
  }
  return (0,wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)(code.split($), ...check(tokens, [values, ...args]));
}



/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/PixelCompare/PixelCompareUI.scss"
/*!*****************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/PixelCompare/PixelCompareUI.scss ***!
  \*****************************************************************************************************************************************************************************************************************************************************************/
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAAAlUAA0AAAAADOwAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABGRlRNAAAJOAAAABwAAAAcgdOIaEdERUYAAAkcAAAAHAAAAB4AJwAXT1MvMgAAAaAAAAA/AAAAYA8TBkpjbWFwAAACBAAAAGAAAAFuAJHDXGdhc3AAAAkUAAAACAAAAAgAAAAQZ2x5ZgAAAogAAAVHAAAGuDC/sv9oZWFkAAABMAAAADUAAAA2EOq202hoZWEAAAFoAAAAIAAAACQH0wPGaG10eAAAAeAAAAAiAAAALgxlAspsb2NhAAACZAAAACQAAAAkCv4MnG1heHAAAAGIAAAAGAAAACAAGABabmFtZQAAB9AAAADlAAABv5krYsVwb3N0AAAIuAAAAFwAAACzVE7OgXicY2BkYGAA4g+t7hzx/DZfGbhZGEDgiucOSxB9s3CXLAPD/wMsAswHgFwOBiaQKAAgRwpEAAAAeJxjYGRgYD7w/wADAwsDA8P//ywCDEARFMAGAHhdBKF4nGNgZGBgEGSIYGBjAAEmBjQAAAtOAHN4nGNgZr7NOIGBlYGBaSbTGQYGhn4IzfiawZiRkwEVMAqgCTA4MDC+dGE+8P8AgwMzEIPUIMkqMDACAHGjC2gAeJxjYYAAxlAIzQTELBDmMiDuZggFw1cMaQxRDAwANtcEOwAAeJxjYGBgZoBgGQZGBhDIAPIYwXwWBh8gzcfAwcDEwAYUU3jJ+NLkpcv/v///g1UqvGQA8m0g/P9PxFnFLoudAevmY0AGjCDzGdmAmBkqwAQkmBgY0FQBLRzeAABnkBOjAAAAAAAIAAgAEAAYAJgA7AEyAYIBugHSAfACIAJYAsADGgNceJyFVE1sE0cUnrfj7DZO1s7au3ZsiO21sV2cYCde2xvnx3ECUVMof42dlqhBIUGEkFaAKghVC7htqIQgFbTKgYJS0UpUSiiQW2+hTShp1UiVKirEBfUQVEEPPZUe7E3frgk9VV3tm503773Z75v5ZgiQtYchJM2Q//NNhKw+NRF6kawjcdJOXiMEQn4rRCHgtzBckwecHCs6HXEVUokwJDKMEnc4uQiGWWk9SFwilHTGU8lEKMx5QAlGQf9KooUJ+MtD8QyjNtFp3s8vhrdH+qbPjPjqBtJTPI8jdAvPl6bk5q2RmgCvmlja0ttsWm7pZelNXjQzxDeaLZir9bi7QRzYuLfRKKcTPL9oronnj2bThyJTOA/P0+5qP6956repPpZTc2nKUdUerJnMpc0if5Oyk9kjkYK90aknVJv31tiasBpXgaKNmQjzgEikgaSRvU5bNnh6GEmOUrvBJcokZQ81yMgBkUVyyUQKl0JiiIEJFB1lZGuzDIpv5Mz0+JqrLetun5GkLWd7W1p6dWMe6PB1NHpi9mg+ri3pnk/dVo9ekw6vnNnbou+WiVwjr9BJeo3wxEZqST0hQRlBCIhCdgoiC4IshJ2yoEgKfRZoBSkgyElFElma01Iun88FnhWfVgc/LjzUVtNLS5rq9nrd0Sj8kPb+7XUzbS7finbE7WWOlRbhnYUVgKXSOZ+baXV706U7mza5fc+UQwZQM6PEiZohwLEeiHegPmIQsoDDC7KfFR0KyLhaKIyArGYMTbGiFxzxDITp9UscWERugcNXsgB3uTRvtlrN2iMmU1HJmazm0vxlzJDKGSJmgO8z/HKLnMQuGLWXrDicN3GVFWbLJU60ct9xIrf4AkZwT8+RbbRAs4RDhDIh9kBSScqCTFGzAiKTUbACAqOyJHPODpTst6kUc7Y0XmVzuWzM53r7pxaCB6dC1+3zIei/f780zsy7bKV9awna1VQ5aKxHnrjpFB0iFaQS10NSBEUA/B98UXxavM04So/p0BPtE2ZP8Rsmomsuj80sLRj5PCGyItSDENQr0BgiSZJ2CApaAX7VW1ooFiTaV5yhfYTFWglrx3AWjlQRK7EjRwKKEABZ51g2w0ejZHa2lC/Xlg36Zma0mdlZJgv1WiyvPclrj/rgHjpoOpfHpJ7W0mEikA04r4c1TrKKurdQiXXoJyBKYwBFV2N6U8TOrk8Mdp0eBdi9LxDclVNh4uP97zdyDc0729cJtM6/daB/eE+uW6kben37L1+Nx05Nf909+l5q8MT5iYk3NjiQxYHVIj1M95P1JEq24B/VGHB4BFkP43Rg3wL+cBTUlE11qmtgEhlQLaY1NBWI5p7QJQhNI6M1VXy4L1ubBmCFhoqD3YL06a74eQOqWLEuOdh1ahR2D/nrMj1qCM5M7n67zWN2K4n2mENgnvB5hyPz5cpAYnhnuspkkhwAYDt98DjUvtnRHtgxNHhwb3+P6jkw8Opvc++Ghz768GLrWx+ENu8ZOzI+NvKyx6mfDZb0oxau0QO4t1biIl6ykSjIKiC0gsA5VVRbDKxgRzZe/MbwimkH2amGVX3YC8GwGu4APWTI4Jhtxw6bbdB413p/Mb+Xak9UHz9eXX3B7b4Afzzv0hdLjczP/4Y08Xm3+B+TkfIduHrbVENvG5rCXa+kQYQKHmA5C170YRUXOqUfYtyJgBRWpbgDWqBVu6N9Dy1zc3MwlWtry2Wu5g8P92x+qetkU2c02tl0smt5OX+VuaXd1e5C+tYtzIvmHj7MZTpTPR6lsfPGjc7G+JXln650EvIPpdRymQB4nI2QMQrCQBBFfzQqRrASC6v1AkHBxgsIFiJYWNjFOISA7EqMingMD+AN7Ow9lbU/y/S6MMvbP//PLgugiycCVCtAhL5yDS2MlevUl8oh+aDcQAd35Sb1l3KEAT5MBWGbSs9PqLjGu4bKdepT5ZC8UW7wBTflJvWHcoQJ3jgjh+DCKkgpHCxwzuUiRZ468oqtDCfskdCClWSnfUL4GfxpWPvWkc2qZfg5MUaUpTjmzppxPPpjyMxLJeMZTdYbE54FO2pbXLnPfXDBqrwxQ86WJhMrRVLKzmyvZp66hXM2xhcXcEmzAAAAeJx9y7kOQGAUhNE7v32PN7m4jdryKkhENApvL2Fq05xM8YmT/9UicOLgiQcfAUJEiJEgRYYcBUpU4bLf59pE17Gp6uvUq1L+zuhARzrR+dPYGTtraUftATY7H90AAQAB//8AD3icY2BkYGDgAWIxIGZiYARCASBmAfMYAAROAD8AAAABAAAAANQYFhEAAAAA1Em4OQAAAADZcbod */ "data:application/font-woff;charset=utf-8;base64,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"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.pixelCompareFont-compare-btn:before {
  content: "\\e93c";
}

.pixelCompareFont-overlay-btn:before {
  content: "\\e93e";
}

.pixelCompareFont-sidebyside-btn:before {
  content: "\\e93f";
}

.pixelCompareFont-exit-compare-btn:before {
  content: "\\e93d";
}

.pixelCompareFont-panel-btn:before {
  content: "\\e940";
}

.pixelCompareFont-show-colors-btn:before {
  content: "\\e941";
}

.pixelCompareFont-hide-colors-btn:before {
  content: "\\e942";
}

.pixelCompareFont-move-btn:before {
  content: "\\e943";
}

.CompareUI__toolbar {
  z-index: 5;
}

.CompareUI__label {
  position: absolute;
  display: block;
  border-radius: 5px;
  background-color: rgba(78, 78, 78, 0.95);
  top: 0px;
  font-size: 12px;
  color: #FFFFFF;
  text-align: center;
  margin: 10px;
  padding: 10px;
  white-space: pre;
  pointer-events: none;
  z-index: 5;
}

.docking-panel.ComparePanel {
  top: 25%;
  left: 10%;
  width: 340px;
  height: initial;
  resize: none;
  z-index: 5;
}
.docking-panel.ComparePanel .adsk-button {
  box-sizing: content-box;
}
.docking-panel.ComparePanel .adsk-control-tooltip {
  bottom: auto;
  top: 120%;
}
.docking-panel.ComparePanel .ComparePanel__main-container {
  display: flex;
  flex-direction: column;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__buttons-container {
  background-color: rgba(0, 0, 0, 0.05);
  padding: 10px;
  text-align: center;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__buttons-container .adsk-button.inactive {
  border: 1px solid #cccccc;
  border-radius: 3px;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container {
  padding: 10px;
  padding-top: 0px;
  display: flex;
  flex-direction: column;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container {
  padding-left: 5px;
  margin-left: -2px;
  margin-top: 10px;
  border: 1px solid rgba(0, 0, 0, 0);
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container.align {
  border: 1px solid #cccccc;
  border-radius: 3px;
  background-color: rgba(0, 0, 0, 0.05);
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-version {
  display: flex;
  width: 42px;
  min-height: 30px;
  border: 1px solid #cccccc;
  border-radius: 3px;
  background-color: rgba(0, 0, 0, 0.05);
  margin-right: 10px;
  font-weight: bold;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-visibility {
  display: flex;
  width: 42px;
  min-height: 30px;
  border: 1px solid #cccccc;
  border-radius: 3px;
  background-color: rgba(0, 0, 0, 0.05);
  margin-right: 10px;
  font-weight: bold;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-description-data {
  margin-right: 40px;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-version-text {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 30px;
  padding-left: 2px;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-color {
  border-radius: 3px 0 0 3px;
  width: 100%;
  height: 100%;
  border-left: solid 5px transparent;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-color.secondary.active {
  border-left: solid 5px var(--secondaryColor, #0696D7);
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-color.main.active {
  border-left: solid 5px var(--mainColor, #FF0000);
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-title {
  font-size: 15px;
  font-weight: bold;
  padding-bottom: 5px;
  padding-left: 5px;
  word-break: break-all;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-heading {
  font-size: 15px;
  word-break: break-all;
  margin-right: 40px;
  padding-bottom: 10px;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-description.treeview {
  display: flex;
  flex-direction: column;
}
.docking-panel.ComparePanel .ComparePanel__main-container .ComparePanel__items-container .ComparePanel__document-container .ComparePanel__doc-description {
  font-size: 13px;
  line-height: 1.2;
  font-weight: 300;
  padding: 5px 0px;
  padding-left: 5px;
  display: flex;
  flex-direction: row;
}

@font-face {
  font-family: "pixelCompareFont";
  src: url(${___CSS_LOADER_URL_REPLACEMENT_0___}) format("woff");
  font-weight: normal;
  font-style: normal;
}
[class^=pixelCompareFont-],
[class*=" pixelCompareFont-"] {
  font-family: "pixelCompareFont";
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  line-height: 1;
  padding-top: 2px;
  speak: none;
  text-transform: none;
  /* Better Font Rendering =========== */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
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

/***/ "./extensions/PixelCompare/PixelCompareUI.scss"
/*!*****************************************************!*\
  !*** ./extensions/PixelCompare/PixelCompareUI.scss ***!
  \*****************************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_PixelCompareUI_scss__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./PixelCompareUI.scss */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/PixelCompare/PixelCompareUI.scss");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_PixelCompareUI_scss__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_PixelCompareUI_scss__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_PixelCompareUI_scss__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_PixelCompareUI_scss__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "data:application/font-woff;charset=utf-8;base64,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"
/*!************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:application/font-woff;charset=utf-8;base64,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 ***!
  \************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:application/font-woff;charset=utf-8;base64,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";

/***/ },

/***/ "./extensions/PixelCompare/shaders/diff_shader.wgsl"
/*!**********************************************************!*\
  !*** ./extensions/PixelCompare/shaders/diff_shader.wgsl ***!
  \**********************************************************/
(module) {

"use strict";
module.exports = "const SIDE_BY_SIDE = 1;\nconst OVERLAY = 0;\n\nstruct Uniforms {\n    projInfo: vec4f,\n    isOrtho: f32,\n    worldMatrix_mainPass: mat4x4f,\n    diff_threshold: f32,\n    texture1DiffColor: vec4f,\n    texture2DiffColor: vec4f,\n    resolution: vec2f,\n    splitPosition: f32,\n    splitLineColor: vec3f,\n    diffMode: i32,\n    splitLineWidth: f32,\n    colorIntensity: f32,\n    t: f32,\n    mainModelHidden: u32,\n    secondaryModelHidden: u32,\n    visibleModelBounds: vec4f,\n    overlayColor1: vec4f,\n    hasOverlayTexture1: u32,\n    mainOverlayHidden: u32,\n    overlayColor2: vec4f,\n    hasOverlayTexture2: u32,\n    secondaryOverlayHidden: u32,\n    blendedOverlayColor: vec4f,\n};\n\n@group(0) @binding(0) var<uniform> uniforms: Uniforms;\n@group(0) @binding(1) var samp: sampler;\n@group(0) @binding(2) var texture1: texture_2d<f32>;\n@group(0) @binding(3) var texture2: texture_2d<f32>;\n@group(0) @binding(4) var overlayTexture1: texture_2d<f32>;\n@group(0) @binding(5) var overlayTexture2: texture_2d<f32>;\n\nfn toGrayscale(v: vec4f) -> f32 {\n    return dot(v.rgb, vec3f(0.299, 0.587, 0.114));\n}\n\nfn getGrayAt(texInput: texture_2d<f32>, i: f32, j: f32, uv: vec2f) -> f32 {\n    let tex = textureSample(texInput, samp, uv + uniforms.resolution * vec2f(i, j));\n    return toGrayscale(tex);\n}\n\nfn getDarkestGray(i: f32, j: f32, uv: vec2f) -> f32 {\n    var gray1 = getGrayAt(texture1, i, j, uv);\n    if (uniforms.mainModelHidden != 0u) {\n        gray1 = 1.0;\n    }\n\n    var gray2 = getGrayAt(texture2, i, j, uv);\n    if (uniforms.secondaryModelHidden != 0u) {\n        gray2 = 1.0;\n    }\n\n    return min(gray1, gray2);\n}\n\nfn getDeltaAt(i: f32, j: f32, uv: vec2f) -> f32 {\n    var gray1 = getGrayAt(texture1, i, j, uv);\n    if (uniforms.mainModelHidden != 0u) {\n        gray1 = 1.0;\n    }\n\n    var gray2 = getGrayAt(texture2, i, j, uv);\n    if (uniforms.secondaryModelHidden != 0u) {\n        gray2 = 1.0;\n    }\n\n    return gray1 - gray2;\n}\n\nfn getColorAt(i: f32, j: f32, uv: vec2f, tex1Color: vec4f, tex2Color: vec4f) -> vec4f {\n    let maxGray = getDarkestGray(i, j, uv);\n    let delta = getDeltaAt(i, j, uv);\n\n    if (uniforms.mainModelHidden != 0u || uniforms.secondaryModelHidden != 0u) {\n        if (any(uv <= uniforms.visibleModelBounds.xy) ||\n            any(uv >= uniforms.visibleModelBounds.zw)) {\n            if (uniforms.mainModelHidden != 0u) {\n                return tex2Color;\n            } else {\n                return tex1Color;\n            }\n        }\n    }\n\n    if (abs(delta) > uniforms.diff_threshold) {\n        if (delta < 0.0) {\n            return vec4f(uniforms.texture1DiffColor.rgb * uniforms.colorIntensity, 1.0); // Model A\n        }\n        return vec4f(uniforms.texture2DiffColor.rgb * uniforms.colorIntensity, 1.0); // Model B\n    }\n\n    return vec4f(vec3f(maxGray), 1.0);\n}\n\n@fragment\nfn psmain(\n    @builtin(position) coord: vec4f,\n    @location(0) @interpolate(linear) vUv: vec2f\n) -> @location(0) vec4f {\n    var tex1 = textureSample(texture1, samp, vUv);\n    var tex2 = textureSample(texture2, samp, vUv);\n\n    var overlay1: vec4f;\n    if (uniforms.hasOverlayTexture1 != 0u && uniforms.mainOverlayHidden == 0u) {\n        overlay1 = textureSample(overlayTexture1, samp, vUv);\n    } else {\n        overlay1 = vec4f(0.0, 0.0, 0.0, 0.0);\n    }\n\n    var overlay2: vec4f;\n    if (uniforms.hasOverlayTexture2 != 0u && uniforms.secondaryOverlayHidden == 0u) {\n        overlay2 = textureSample(overlayTexture2, samp, vUv);\n    } else {\n        overlay2 = vec4f(0.0, 0.0, 0.0, 0.0);\n    }\n\n    var outColor = vec4f(0.0, 0.0, 0.0, 1.0);\n\n    let colorAt = getColorAt(0.0, 0.0, vUv, tex1, tex2);\n\n    if (uniforms.diffMode == SIDE_BY_SIDE) {\n        if (abs(vUv.x - uniforms.splitPosition) <= uniforms.splitLineWidth) {\n            outColor = vec4f(mix(tex1.rgb, uniforms.splitLineColor, uniforms.t), 1.0);\n        } else {\n            var tex: vec4f;\n            var overlayRgb: vec3f;\n            var overlayAlpha: f32;\n\n            if (vUv.x < uniforms.splitPosition) {\n                tex = tex1;\n                overlayRgb = overlay1.rgb;\n                overlayAlpha = overlay1.a;\n            } else {\n                tex = tex2;\n                overlayRgb = overlay2.rgb;\n                overlayAlpha = overlay2.a;\n            }\n\n            outColor = vec4f(mix(tex1.rgb, tex.rgb, uniforms.t) * (1.0 - overlayAlpha) + overlayRgb, 1.0);\n        }\n    } else if (uniforms.diffMode == OVERLAY) {\n        var overlayColor = vec4f(0.0, 0.0, 0.0, 0.0);\n        if (uniforms.mainOverlayHidden != 0u) {\n            overlayColor = overlay2;\n        } else if (uniforms.secondaryOverlayHidden != 0u) {\n            overlayColor = overlay1;\n        } else if (overlay1.a > 0.0 && overlay2.a > 0.0) {\n            overlayColor = vec4f(uniforms.blendedOverlayColor.rgb * max(overlay1.a, overlay2.a), max(overlay1.a, overlay2.a));\n        } else if (overlay1.a > 0.0) {\n            overlayColor = vec4f(uniforms.overlayColor1.rgb * overlay1.a, overlay1.a);\n        } else if (overlay2.a > 0.0) {\n            overlayColor = vec4f(uniforms.overlayColor2.rgb * overlay2.a, overlay2.a);\n        }\n\n        outColor = vec4f(mix(tex1.rgb, colorAt.rgb, uniforms.t) * (1.0 - overlayColor.a) + overlayColor.rgb, 1.0);\n    }\n\n    return outColor;\n}";

/***/ },

/***/ "./node_modules/wgsl-preprocessor/wgsl-preprocessor.js"
/*!*************************************************************!*\
  !*** ./node_modules/wgsl-preprocessor/wgsl-preprocessor.js ***!
  \*************************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   wgsl: () => (/* binding */ wgsl)
/* harmony export */ });
/** WGSL Preprocessor v1.0.1 **/
const preprocessorSymbols = /#([^\s]*)(\s*)/gm

class ConditionalState {
  elseIsValid = true;
  branches = [];

  constructor(initialExpression) {
    this.pushBranch('if', initialExpression);
  }

  pushBranch(token, expression) {
    if (!this.elseIsValid) {
      throw new Error(`#${token} not preceeded by an #if or #elif`);
    }
    this.elseIsValid = (token === 'if' || token === 'elif');
    this.branches.push({
      expression: !!expression,
      string: ''
    });
  }

  appendStringToCurrentBranch(...strings) {
    for (const string of strings) {
      this.branches[this.branches.length-1].string += string;
    }
  }

  resolve() {
    for (const branch of this.branches) {
      if (branch.expression) {
        return branch.string;
      }
    }

    return '';
  }
}

// Template literal tag that handles simple preprocessor symbols for WGSL
// shaders. Supports #if/elif/else/endif statements.
function wgsl(strings, ...values) {
  const stateStack = [];
  let state = new ConditionalState(true);
  state.elseIsValid = false;
  let depth = 1;

  const assertTemplateFollows = (match, string) => {
    if (match.index + match[0].length != string.length) {
      throw new Error(`#${match[1]} must be immediately followed by a template expression (ie: \${value})`);
    }
  }

  for (let i = 0; i < strings.length; ++i) {
    const string = strings[i];
    const matchedSymbols = string.matchAll(preprocessorSymbols);

    let lastIndex = 0;
    let valueConsumed = false;

    for (const match of matchedSymbols) {
      state.appendStringToCurrentBranch(string.substring(lastIndex, match.index));

      switch (match[1]) {
        case 'if':
          assertTemplateFollows(match, string);

          valueConsumed = true;
          stateStack.push(state);
          state = new ConditionalState(values[i]);
          break;
        case 'elif':
          assertTemplateFollows(match, string);

          valueConsumed = true;
          state.pushBranch(match[1], values[i]);
          break;
        case 'else':
          state.pushBranch(match[1], true);
          state.appendStringToCurrentBranch(match[2]);
          break;
        case 'endif':
          if (!stateStack.length) {
            throw new Error(`#${match[1]} not preceeded by an #if`);
          }

          const result = state.resolve();

          state = stateStack.pop();
          state.appendStringToCurrentBranch(result, match[2]);
          break;
        default:
          // Unknown preprocessor symbol. Emit it back into the output string unchanged.
          state.appendStringToCurrentBranch(match[0]);
          break;
      }

      lastIndex = match.index + match[0].length;
    }

    // If the string didn't end on one of the preprocessor symbols append the rest of it here.
    if (lastIndex != string.length) {
      state.appendStringToCurrentBranch(string.substring(lastIndex, string.length));
    }

    // If the next value wasn't consumed by the preprocessor symbol, append it here.
    if (!valueConsumed && values.length > i) {
      state.appendStringToCurrentBranch(values[i]);
    }
  }

  if (stateStack.length) {
    throw new Error('Mismatched #if/#endif count');
  }

  return state.resolve();
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
/******/ 			"PixelCompare": 0
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
/*!*************************************************!*\
  !*** ./extensions/PixelCompare/PixelCompare.js ***!
  \*************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _shaders_DiffShader_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./shaders/DiffShader.js */ "./extensions/PixelCompare/shaders/DiffShader.js");
/* harmony import */ var _shaders_diff_shader_wgsl__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./shaders/diff_shader.wgsl */ "./extensions/PixelCompare/shaders/diff_shader.wgsl");
/* harmony import */ var _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./PixelCompareConstants.js */ "./extensions/PixelCompare/PixelCompareConstants.js");
/* harmony import */ var _PixelCompareTool_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./PixelCompareTool.js */ "./extensions/PixelCompare/PixelCompareTool.js");
/* harmony import */ var _PixelCompareUI_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./PixelCompareUI.js */ "./extensions/PixelCompare/PixelCompareUI.js");
/* harmony import */ var _src_wgs_wgsl_preprocessor_wgsl_preprocessor_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../../src/wgs/wgsl-preprocessor/wgsl-preprocessor.js */ "./src/wgs/wgsl-preprocessor/wgsl-preprocessor.js");







const ShaderPass = Autodesk.Viewing.Private.ShaderPass;
const ShaderPassWebGPU = Autodesk.Viewing.Private.ShaderPassWebGPU;
class PixelCompare extends Autodesk.Viewing.Extension {
  constructor(viewer, options = {}) {
    super(viewer, options);
    this.viewer = viewer;
    this.options = options;

    this.mainModel = null;
    this.secondaryModel = null;
    this.mainModelDiffColor = this.options.mainModelDiffColor;
    this.secondaryModelDiffColor = this.options.secondaryModelDiffColor;

    this.secondaryRenderContext = null;
    this.mainModelVisibilityBackup = false; // Save the visibility state of the main model.
    this.secondaryModelVisibilityBackup = false; // Save the visibility state of the secondary model.
    this.mainOverlayScenes = options.mainOverlayScenes;
    this.secondaryOverlayScenes = options.secondaryOverlayScenes;

    this.mainOverlayColor = options.mainOverlayColor;
    this.secondaryOverlayColor = options.secondaryOverlayColor;
    this.blendedOverlayColor = options.blendedOverlayColor;

    this.splitPosition = _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULTS.SPLIT_LINE_POSITION;
    this.splitLineWidth = _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULTS.SPLIT_LINE_WIDTH;
    this.splitLineColor = new THREE.Color(_PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULTS.SPLIT_LINE_COLOR);
    this.duration = _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULTS.ANIMATION_DURATION;
    this.transitionVal = 0.0;

    this.changeOffsetMode = false;

    this.diffMode = options.diffMode;
    this.defaultDiffMode = _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DEFAULTS.DEFAULT_DIFF_MODE;
    this.colorIntensity = 1.0;
    this.modelHiddenMap = {}; // Used for toggle model visibility.
    this.overlayHiddenMap = {}; // Used for toggle overlays visibility.

    this.tool = new _PixelCompareTool_js__WEBPACK_IMPORTED_MODULE_3__["default"](this);

    if (!this.viewer.config.headlessViewer) {
      this.compareUI = new _PixelCompareUI_js__WEBPACK_IMPORTED_MODULE_4__["default"](this);
    }

    this.diffPass = new ShaderPass(_shaders_DiffShader_js__WEBPACK_IMPORTED_MODULE_0__.DiffShader);

    this.renderer = this.viewer.impl.renderer();
    this.glrenderer = this.viewer.impl.glrenderer();

    if (this.viewer.impl.isWebGPU()) {
      this.diffPass.material.webGPU = {
        labelPrefix: "PixelCompare Shader",
        uniformBufferVisibility: GPUShaderStage.FRAGMENT,
        textureBindings: [
        {
          uniformKey: 'texture1',
          binding: 2
        },
        {
          uniformKey: 'texture2',
          binding: 3
        },
        {
          uniformKey: 'overlayTexture1',
          binding: 4
        },
        {
          uniformKey: 'overlayTexture2',
          binding: 5
        }],

        samplers: [
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT
        }]

      };

      const device = this.glrenderer.getDevice();
      this.diffPassWebGPU = new ShaderPassWebGPU(
        device, this.diffPass.material.webGPU.labelPrefix, this.glrenderer);
      this.diffPassWebGPU.setFragmentShader((0,_src_wgs_wgsl_preprocessor_wgsl_preprocessor_js__WEBPACK_IMPORTED_MODULE_5__.$wgsl)(_shaders_diff_shader_wgsl__WEBPACK_IMPORTED_MODULE_1__), "psmain");
      this.diffPassWebGPU.setIgnoreSourceTexture(true);
    }

    this.frustum = new Autodesk.Viewing.Private.FrustumIntersector();

    this.renderSecondaryModelBinded = this.renderSecondaryModel.bind(this);
    this.initDiffBinded = this.initDiff.bind(this);
    this.onResizeBinded = this.onResize.bind(this);
  }

  /**
   * @param model
   * @private
   */
  getModel(model) {
    return typeof model === 'number' ? this.viewer.impl.findModel(model, true) : model;
  }

  /**
   * Compare two models.
   *
   * @param {Autodesk.Viewing.Model|number} mainModel - Main model instance or id.
   * @param {Autodesk.Viewing.Model|number} secondaryModel - Secondary model instance or id.
   * @param {object} mainModelInfo - Main model info. Info can contain 'title', 'version', 'creationTime' & 'creator'.
   * @param {object} secondaryModelInfo - Secondary model info. Info can contain 'title', 'version', 'creationTime' & 'creator'.
   */
  compareTwoModels(mainModel, secondaryModel, mainModelInfo = {}, secondaryModelInfo = {}) {
    // If already comparing these two models, don't do anything.
    if (this.getModel(mainModel) === this.mainModel && this.getModel(secondaryModel) === this.secondaryModel) {
      return;
    }

    this.deactivate().then(() => {
      this.mainModel = this.getModel(mainModel);
      this.secondaryModel = this.getModel(secondaryModel);
      this.mainModelInfo = mainModelInfo;
      this.secondaryModelInfo = secondaryModelInfo;

      this.activate();
    });
  }

  unload() {
    this.deactivate();

    return true;
  }

  /**
   * @private
   */
  activate() {
    if (!this.mainModel || !this.secondaryModel) {
      console.warn('Pixel Compare requires two models. Use compareTwoModels and supply the models.');
      return false;
    }

    if (!this.isActive()) {
      this.initDiff();

      this.viewer.toolController.registerTool(this.tool);
      this.viewer.toolController.activateTool(this.tool.getName());
      return true;
    }
  }

  /**
   * Deactivate the comparison.
   */
  deactivate() {
    if (!this.isActive()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.exitPreviousDiffMode(() => {
        this.activeStatus = false;
        this.diffMode = null;

        this.viewer.impl.setPlacementTransform(this.secondaryModel, this.secondaryModelTransformBackup);

        if (!this.mainModelVisibilityBackup) {
          this.viewer.hideModel(this.mainModel);
        }

        if (this.options.restoreModelVisibilityOnExit && this.secondaryModelVisibilityBackup) {
          this.viewer.showModel(this.secondaryModel);
        }

        this.viewer.toolController.deregisterTool(this.tool);

        this.viewer.removeEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, this.renderSecondaryModelBinded);
        this.viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onResizeBinded);

        if (this.clearColorTopBackup && this.clearColorBottomBackup) {
          this.viewer.setBackgroundColor(
            this.clearColorTopBackup.x, this.clearColorTopBackup.y, this.clearColorTopBackup.z,
            this.clearColorBottomBackup.x, this.clearColorBottomBackup.y, this.clearColorBottomBackup.z
          );
        }

        this.viewer.impl.toggleSwapBlackAndWhite(this.swapBlackAndWhiteBackup);

        this.cleanRenderContext();
        this.invalidate();

        if (this.compareUI) {
          this.compareUI.destroyUI();
        }

        this.mainModel = null;
        this.secondaryModel = null;
        this.mainModelDiffColor = null;
        this.secondaryModelDiffColor = null;
        this.secondaryModelTransformBackup = null;

        this.mainModelInfo = null;
        this.secondaryModelInfo = null;

        this.modelHiddenMap = {};

        this.viewer.dispatchEvent({ type: _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.EVENTS.DIFF_TOOL_DEACTIVATED }),

        resolve();
      }, true);
    });
  }

  /**
   * @param model
   * @private
   */
  isModelVisible(model) {
    return !!this.viewer.impl.findModel(model.id);
  }

  getModelAlignmentTransform() {
    let matrix;
    const mainDoc = this.mainModel.getDocumentNode().getRootNode();
    const secondaryDoc = this.secondaryModel.getDocumentNode().getRootNode();

    if (this.mainModel.getDocumentNode().isSmartPdf() && mainDoc.getInputFileType() === 'dwg' // PDF created from DWG
    && mainDoc.lineageUrn() === secondaryDoc.lineageUrn() // Same model
    && this.mainModel.getData().viewports.length === 2 & this.secondaryModel.getData().viewports.length === 2) {// one viewport defined (second one is attached by LMV)
      // Model Transformation based alignment
      // Currently only used for comparing different versions of the same DWG file. Fixes misalignement when the page size changes (BLMV-8072)

      matrix = this.mainModel.getPageToModelTransform(1).clone().invert().multiply(this.secondaryModel.getPageToModelTransform(1).clone());
    } else
    {
      // Model Bounding Box based aligment (default)

      // It's important to get the trimmed bounds, without the annoying paper shadow, so in case there is one model with a shadow,
      // and another one without - it won't cause a different scale.
      const mainBounds = this.mainModel.getBoundingBox(false, true);
      const secondaryBounds = this.secondaryModel.getBoundingBox(false, true);

      this.modelsRatio = mainBounds.getSize(new THREE.Vector3()).divide(secondaryBounds.getSize(new THREE.Vector3()));

      const translationToOrigin = new THREE.Matrix4().makeTranslation(-secondaryBounds.min.x, -secondaryBounds.min.y, 0);

      // We use modelsRatio.y also for Z coordinate (instead of 1), so that getMaxScaleOnAxis will always return a relevant value, and won't
      // return a fixed 1 in case we are scaling down the model.
      const scaleMatrix = new THREE.Matrix4().makeScale(this.modelsRatio.x, this.modelsRatio.y, this.modelsRatio.y);
      const translationToModelOrigin = new THREE.Matrix4().makeTranslation(mainBounds.min.x, mainBounds.min.y, 0);
      const originalTransform = this.secondaryModel.getPlacementTransform();

      matrix = translationToModelOrigin.multiply(scaleMatrix).multiply(translationToOrigin).multiply(originalTransform);
    }

    return matrix;
  }

  alignSecondaryModel() {
    this.viewer.impl.setPlacementTransform(this.secondaryModel, this.getModelAlignmentTransform());
  }

  /**
   * @private
   */
  initDiff() {
    if (this.viewer.impl.modelQueue().getModels().concat(this.viewer.impl.modelQueue().getHiddenModels()).some((model) => !model.isLoadDone())) {
      this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.initDiffBinded, { once: true });
    } else {
      this.activeStatus = true;

      this.mainModelVisibilityBackup = this.isModelVisible(this.mainModel);
      this.secondaryModelVisibilityBackup = this.isModelVisible(this.secondaryModel);

      if (!this.mainModelVisibilityBackup) {
        this.viewer.showModel(this.mainModel); // Main model has to be visible when activating diff.
      }

      // when the main and secondary models are the same do not attempt to hide the secondary model
      if (this.secondaryModelVisibilityBackup && this.mainModel !== this.secondaryModel) {
        this.viewer.hideModel(this.secondaryModel); // Secondary model has to be hidden during diff.
      }

      // Backup original transform, in order to restore it later on cleanup.
      this.secondaryModelTransformBackup = this.secondaryModel.getPlacementTransform().clone();
      this.alignSecondaryModel();

      this.clearColorTopBackup = this.viewer.impl.clearColorTop.clone().multiplyScalar(255);
      this.clearColorBottomBackup = this.viewer.impl.clearColorBottom.clone().multiplyScalar(255);

      // If one of the models has no background, we have to give it a white background - otherwise the diff will fail.
      if (this.mainModel.getMetadata('page_dimensions', 'hide_paper') || this.secondaryModel.getMetadata('page_dimensions', 'hide_paper')) {
        this.viewer.setBackgroundColor(255, 255, 255, 255, 255, 255);
      }

      this.setDiffMode(this.diffMode || this.defaultDiffMode);

      this.swapBlackAndWhiteBackup = this.viewer.impl.swapBlackAndWhite;
      this.viewer.impl.toggleSwapBlackAndWhite(false);

      if (this.compareUI) {
        this.compareUI.createUI();
      }

      this.viewer.addEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, this.renderSecondaryModelBinded);
      this.viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.onResizeBinded);
    }
  }

  /**
   * @private
   */
  renderDiff() {
    const pixelRatio = this.glrenderer.getPixelRatio();
    const resolution = {
      x: 1 / (this.viewer.canvas.clientWidth * pixelRatio),
      y: 1 / (this.viewer.canvas.clientHeight * pixelRatio)
    };

    this.diffPass.uniforms['texture1'].value = this.renderer.getColorTarget();
    if (this.mainModelDiffColor) {
      this.diffPass.uniforms['texture1DiffColor'].value = this.mainModelDiffColor;
    }

    if (this.mainOverlayScenes) {
      this.diffPass.uniforms['overlayTexture1'].value = this.renderer.getOverlayTarget();
      this.diffPass.uniforms['hasOverlayTexture1'].value = true;
      this.diffPass.uniforms['mainOverlayHidden'].value = this.overlayHiddenMap[0];
      if (this.mainOverlayColor) {
        this.diffPass.uniforms['overlayColor1'].value = this.mainOverlayColor;
      }
    }

    this.diffPass.uniforms['diffMode'].value = _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DIFF_MODES_SHADER[this.diffMode];
    this.diffPass.uniforms['splitPosition'].value = this.splitPosition;
    this.diffPass.uniforms['splitLineWidth'].value = this.splitLineWidth / this.viewer.getCamera().clientWidth;
    this.diffPass.uniforms['splitLineColor'].value = this.splitLineColor;
    this.diffPass.uniforms['t'].value = this.transitionVal;
    this.diffPass.uniforms['resolution'].value = resolution;
    this.diffPass.uniforms['colorIntensity'].value = this.colorIntensity;
    this.diffPass.uniforms['mainModelHidden'].value = this.modelHiddenMap[0];
    this.diffPass.uniforms['secondaryModelHidden'].value = this.modelHiddenMap[1];

    if (this.modelHiddenMap[1]) {
      this.diffPass.uniforms['visibleModelBounds'].value = this.getModelNormalizedProjectedBounds(this.mainModel);
    } else if (this.modelHiddenMap[0]) {
      this.diffPass.uniforms['visibleModelBounds'].value = this.getModelNormalizedProjectedBounds(this.secondaryModel);
    }

    if (this.blendedOverlayColor) {
      this.diffPass.uniforms['blendedOverlayColor'] = this.blendedOverlayColor;
    }

    if (this.viewer.impl.isWebGPU()) {
      this.diffPassWebGPU.updateFromMaterial(this.diffPass.material);
      this.renderer.presentBuffer(this.diffPassWebGPU);
    } else {
      this.renderer.presentBuffer(this.diffPass);
    }
  }

  /**
   *  Needed when size of the canvas is changing.
   *
   * @private
   */
  cleanRenderContext() {
    this.secondaryRenderContext && this.secondaryRenderContext.cleanup();
    this.secondaryRenderContext = null;
  }

  /**
   * Normalized bounds needed for shader.
   *
   * @param model
   * @private
  */
  getModelNormalizedProjectedBounds(model) {
    const bounds = model.getBoundingBox(false, true);

    // Get bounds positions in UV space.
    const uvCorner1 = this.worldToClient(bounds.min);
    const uvCorner2 = this.worldToClient(bounds.max);

    // Compute min and max UV bounds.
    const min = uvCorner1.clone().min(uvCorner2);
    const max = uvCorner1.clone().max(uvCorner2);

    return new THREE.Vector4(min.x, min.y, max.x, max.y);
  }

  /**
   * @param point
   * @private
  */
  worldToClient(point) {
    const camera = this.viewer.getCamera();
    const p = point.clone().project(camera);

    // UV coordinates in WebGPU have their y-value flipped compared to
    // WebGL. This is necessary for proper clipping against the
    // `visibleModelBounds` uniform value in the shader.
    if (this.viewer.impl.isWebGPU()) {
      return new THREE.Vector2((p.x + 1) / 2, (1 - p.y) / 2);
    } else {
      return new THREE.Vector2((p.x + 1) / 2, (p.y + 1) / 2);
    }
  }

  /**
   * @private
   */
  onResize() {
    this.cleanRenderContext();
  }

  /**
   * @private
  */
  renderSecondaryModel() {
    const canvasBounds = this.viewer.impl.getCanvasBoundingClientRect();
    const pixelRatio = this.glrenderer.getPixelRatio();
    const width = canvasBounds.width * pixelRatio;
    const height = canvasBounds.height * pixelRatio;

    const onFinished = (ctx, target, _camera, _sheetRenderer, extraTargets) => {
      this.diffPass.uniforms['texture2'].value = target;
      if (this.secondaryModelDiffColor) {
        this.diffPass.uniforms['texture2DiffColor'].value = this.secondaryModelDiffColor;
      }
      if (extraTargets && extraTargets[0]) {

        this.diffPass.uniforms['overlayTexture2'].value = extraTargets[0];
        this.diffPass.uniforms['hasOverlayTexture2'].value = true;
        this.diffPass.uniforms['secondaryOverlayHidden'].value = this.overlayHiddenMap[1];
        if (this.secondaryOverlayColor) {
          this.diffPass.uniforms['overlayColor2'].value = this.secondaryOverlayColor;
        }
      }

      this.secondaryRenderContext = ctx;

      this.renderDiff();
    };

    const options = {
      returnAsTarget: true,
      models: [this.secondaryModel],
      renderContext: this.secondaryRenderContext,
      dontWaitForLeafletTiles: true
    };

    // In case that the secondary model is leaflet - we do want that the diff will be rendered even if
    // The tiles are not fully refined. This is why we use `dontWaitForLeafletTiles`.
    // However, in order for them to get refined eventually, we need to call invalidate, so even if the main model
    // is fully loaded, the secondary model will continue loading.
    if (this.secondaryModel.isLeaflet()) {
      const camera = this.viewer.getCamera();
      this.frustum.reset(camera);

      if (!this.secondaryModel.getIterator().reset(this.frustum, camera)) {
        this.invalidate();
      }
    }

    const getOverlayScenesToRender = (overlayScenes) => {
      const overlayScenesToRender = {};
      let renderOverlayScenes = false;
      overlayScenes.forEach((overlaySceneName) => {
        if (this.viewer.overlays.hasScene(overlaySceneName)) {
          overlayScenesToRender[overlaySceneName] = this.viewer.impl.overlayScenes[overlaySceneName];
          renderOverlayScenes = true;
        }
      });
      if (renderOverlayScenes) {
        return overlayScenesToRender;
      }
    };

    // If secondary overlay scenes are desired, then this will instruct ScreenShot.getScreenShot() render specific
    // overlay scenes with the screenshot to overlayTarget.
    if (this.secondaryOverlayScenes) {
      let overlayScenesToRender = getOverlayScenesToRender(this.secondaryOverlayScenes);
      if (overlayScenesToRender) {
        options.renderOverlayScenes = true;
        options.overlayScenes = overlayScenesToRender;
        // Don't blend overlays onto the final target to allow for more
        // precise diff rendering.
        options.disableOverlayBlend = true;
        options.extraTargets = ['overlay'];
      }
    }

    Autodesk.Viewing.ScreenShot.getScreenShot(width, height, onFinished, options, this.viewer.impl);
  }

  /**
   * @private
   */
  invalidate() {
    this.viewer.impl?.invalidate(true, true, false);
  }

  /**
   * Change split line position.
   *
   * @param {number} value - Value between 0 to 1.
   */
  setSplitPosition(value) {
    this.splitPosition = value;
    this.invalidate();
  }

  /**
   * Get split line position.
   *
   * @returns {number}
   */
  getSplitPosition() {
    return this.splitPosition;
  }

  /**
   * Change diff mode. Options are split mode & color mode.
   *
   * @param {number} value - Autodesk.PixelCompare.DIFF_MODES.OVERLAY | Autodesk.PixelCompare.DIFF_MODES.SIDE_BY_SIDE
   */
  setDiffMode(value) {
    if (!this.isActive()) {
      console.warn('Pixel Compare is not active.');
      return;
    }

    if (this.diffMode === value && this.transitionVal !== 0) {
      return;
    }

    this.exitPreviousDiffMode(() => {
      this.enterNewDiffMode(value);
    });
  }

  /**
   * @param cb
   * @param immediate
   * @private
   */
  exitPreviousDiffMode(cb, immediate) {
    if (this.fadeAnim) {
      this.fadeAnim.stop();
      this.fadeAnim = null;
    }

    if (immediate || this.diffMode === null || this.diffMode === undefined) {
      this.transitionVal = 0.0;
      cb();
    } else {
      const onTimer = (value) => {
        this.transitionVal = value;
        this.invalidate();
      };

      const onFadeEnd = () => {
        this.fadeAnim = null;
        cb();
      };

      this.fadeAnim = Autodesk.Viewing.Private.fadeValue(this.transitionVal, 0.0, this.duration, onTimer, onFadeEnd);
    }
  }

  /**
   * @param diffMode
   * @param immediate
   * @private
   */
  enterNewDiffMode(diffMode, immediate) {
    this.diffMode = diffMode;

    this.viewer.dispatchEvent({
      type: _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.EVENTS.DIFF_TOOL_DIFF_MODE_CHANGED,
      newDiffMode: this.diffMode
    });

    if (this.fadeAnim) {
      this.fadeAnim.stop();
      this.fadeAnim = null;
    }

    if (immediate) {
      this.transitionVal = 1.0;
      this.invalidate();
    }

    // Don't allow hiding models on side by side mode.
    if (diffMode === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DIFF_MODES.SIDE_BY_SIDE) {
      this.changeMainModelVisibility(true);
      this.changeSecondaryModelVisibility(true);
    }

    const onTimer = (value) => {
      this.transitionVal = value;
      this.invalidate();
    };

    const onFadeEnd = () => {
      this.fadeAnim = null;
    };

    this.fadeAnim = Autodesk.Viewing.Private.fadeValue(this.transitionVal, 1.0, this.duration, onTimer, onFadeEnd);
  }

  /**
   * Get diff mode.
   *
   * @returns {number}
   */
  getDiffMode() {
    return this.diffMode;
  }

  /**
   * Change split line width.
   *
   * @param {number} value - width in pixels.
   */
  setSplitLineWidth(value) {
    this.splitLineWidth = value;
    this.invalidate();
  }

  /**
   * Change split line color.
   *
   * @param {number} value - color in hex.
   */
  setSplitLineColor(value) {
    this.splitLineColor = new THREE.Color(value);
    this.invalidate();
  }

  /**
   * Enable / Disable offset mode.
   *
   * @param {boolean} enable - enable / disable.
   */
  setChangeOffsetMode(enable) {
    if (this.getDiffMode() === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DIFF_MODES.OVERLAY && this.mainModel === this.secondaryModel) {
      // Don't allow aligning when rendering the same model in overlay mode
      return;
    }
    this.changeOffsetMode = enable;
  }

  /**
   * Reset offset to initial position.
   */
  resetOffset() {
    this.alignSecondaryModel();
  }

  /**
   * Change color intensity value of overlay mode.
   *
   * @param {number} value - number between 0 to 1.
   */
  changeColorIntensity(value) {
    this.colorIntensity = value;
    this.invalidate();
  }


  /**
   * Translates secondary model.
   * @private
   */
  translateSecondaryModel(translation) {
    const translationMatrix = new THREE.Matrix4().makeTranslation(translation.x, translation.y, 0);
    const currentMatrix = this.secondaryModel.getPlacementTransform().clone();
    this.viewer.impl.setPlacementTransform(this.secondaryModel, translationMatrix.multiply(currentMatrix));
  }

  /**
   * @param index
   * @param visible
   * @private
   */
  changeModelVisibility(index, visible) {
    // Don't allow hiding models on side by side mode.
    if (!visible && this.getDiffMode() === _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DIFF_MODES.SIDE_BY_SIDE) {
      return;
    }

    this.modelHiddenMap[index] = !visible;
    // Make sure main and secondary model visibility are in-sync when rendering the same model
    if (this.mainModel === this.secondaryModel) {
      this.modelHiddenMap[1 - index] = !visible;
    }

    // when rendering overlays on top of models, allow both models to be hidden to diff the overlays only
    if (!this.mainOverlayScenes && !this.secondaryOverlayScenes) {
      // Make sure at least one model stays visible.
      if (!visible && this.modelHiddenMap[1 - index]) {
        this.changeModelVisibility(1 - index, true);
      }
    }

    this.viewer.dispatchEvent({
      type: _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.EVENTS.DIFF_TOOL_MODEL_VISIBILITY_CHANGED
    });

    this.invalidate();
  }

  /**
   * Show / Hide main model inside diff mode.
   *
   * @param {boolean} visible - visible / invisible.
   */
  changeMainModelVisibility(visible) {
    this.changeModelVisibility(0, visible);
  }

  /**
   * Show / Hide secondary model inside diff mode.
   *
   * @param {boolean} visible - visible / invisible.
   */
  changeSecondaryModelVisibility(visible) {
    this.changeModelVisibility(1, visible);
  }

  /**
   * Get main model visibility.
   *
   * @returns {boolean}
   */
  getMainModelVisibility() {
    return !this.modelHiddenMap[0];
  }

  /**
   * Get secondary model visibility.
   *
   * @returns {boolean}
   */
  getSecondaryModelVisibility() {
    return !this.modelHiddenMap[1];
  }

  changeOverlayVisibility(index, visible) {
    this.overlayHiddenMap[index] = !visible;

    this.viewer.dispatchEvent({
      type: _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.EVENTS.DIFF_TOOL_OVERLAY_VISIBILITY_CHANGED
    });

    this.invalidate();
  }

  /**
   * Show / Hide main overlay inside diff mode.
   *
   * @param {boolean} visible - visible / invisible.
   */
  changeMainOverlayVisibility(visible) {
    this.changeOverlayVisibility(0, visible);
  }

  /**
   * Show / Hide secondary overlay inside diff mode.
   *
   * @param {boolean} visible - visible / invisible.
   */
  changeSecondaryOverlayVisibility(visible) {
    this.changeOverlayVisibility(1, visible);
  }

  /**
   * Get main overlay visibility.
   *
   * @returns {boolean}
   */
  getMainOverlayVisibility() {
    return !this.overlayHiddenMap[0];
  }

  /**
   * Get secondary overlay visibility.
   *
   * @returns {boolean}
   */
  getSecondaryOverlayVisibility() {
    return !this.overlayHiddenMap[1];
  }
}

const namespace = AutodeskNamespace('Autodesk.Viewing.PixelCompare');
namespace.DIFF_MODES = Object.assign({}, _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.DIFF_MODES);
namespace.EVENTS = Object.assign({}, _PixelCompareConstants_js__WEBPACK_IMPORTED_MODULE_2__.EVENTS);

// Register the extension with the extension manager.
Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Viewing.PixelCompare', PixelCompare);

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (PixelCompare);
})();

Autodesk.Extensions.PixelCompare = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=PixelCompare.js.map