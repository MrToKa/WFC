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

/***/ "./extensions/CrossFadeEffects/TargetCrossFade.js"
/*!********************************************************!*\
  !*** ./extensions/CrossFadeEffects/TargetCrossFade.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   FadeMode: () => (/* binding */ FadeMode),
/* harmony export */   TargetCrossFade: () => (/* binding */ TargetCrossFade)
/* harmony export */ });

// Controls the way in which fading targets are applied in the blend shader
const FadeMode = {
  // Just blend each target independently on top of main color target (default)
  DECAL: 0,

  // Crossfades between target 0 and 1 using crossFadeOpacity1 as mix param.
  // crossFadeOpacity0 is not used in this mode. Advantage is that colors keep
  // more consistent when fading between two images.
  CROSSFADE: 1
};


/**
 * @class TargetCrossFade is used by RenderContext to implement optional cross-fading
 * between different render targets. By default (no cross-fading), all scenes are rendered
 * to the default color buffer by RenderContext. When using targetCrossFade, a scene may
 * be rendered to a separate target, which is blended with the default color target in the blend pass.
 *  @param {LmvShaderPass} blendPass      - see RenderContext
 */
function TargetCrossFade(blendPass) {

  // {THREE.WebGLRenderTarget} of type RGBA with own depth buffer. Selected scenes are rendered into this target
  // and overlayed on top of the main scene.
  var _fadeTargets = [];
  var _numFadeTargets = 2;
  var _enableClear = [true, true]; // Clear may be disabled when fading to static images

  var _blendPass = blendPass;

  var _clearColor = new THREE.Color();

  // {number[]} Indexed by modelId. Defines the index of the Render target to which a RenderModel is rendered.
  //           0/undefined: default color buffer, 1:
  var _modelId2TargetIndex = [];

  var _fadeMode = FadeMode.DECAL;

  // see setSaoHeuristicEnabled() comment
  var _enableSaoHeuristic = true;

  this.setModelTargetIndex = function (modelId, targetIndex) {
    _modelId2TargetIndex[modelId] = targetIndex;
  };

  // By default (true), we exclude models from depth buffer rendering (used for SAO) if they have reduced opacity.
  // Disabling it makes sure that models are always rendered to the depth target - no matter which opacity they have.
  this.setSaoHeuristicEnabled = function (enabled) {
    _enableSaoHeuristic = enabled;
  };

  //which model is used for AO (i.e. which one is more opaque)
  this.getRenderSao = function (scene) {

    if (!_enableSaoHeuristic) {
      // Never suppress depth-writing - independent of target opacity.
      return true;
    }

    var index = scene.modelId && _modelId2TargetIndex[scene.modelId];

    if (index === undefined)
    return true;

    var idx = index;
    var maxOpacity = this.getCrossFadeOpacity(index);

    var numTargets = 2;
    for (var i = 0; i < numTargets; i++) {
      var op = this.getCrossFadeOpacity(i);
      if (op > maxOpacity) {
        idx = i;
        maxOpacity = op;
      }
    }

    return idx == index;
  };

  this.setCrossFadeOpacity = function (targetIndex, opacity) {
    var uniformName = 'crossFadeOpacity' + targetIndex;
    _blendPass.uniforms[uniformName].value = opacity;
  };

  this.getCrossFadeOpacity = function (targetIndex) {
    var uniformName = 'crossFadeOpacity' + targetIndex;
    return _blendPass.uniforms[uniformName].value;
  };

  // Activate target-blending for blendPass and assigns current _blendTarget as source
  this.updateBlendPass = function (numFadeTargets) {

    if (numFadeTargets === undefined) {
      numFadeTargets = _fadeTargets.length;
    }

    // Update NUM_CROSSFADE_TARGETS shader-define if necessary
    var macroName = 'NUM_CROSSFADE_TARGETS';
    var oldMacroVal = _blendPass.material.defines[macroName];
    var newMacroVal = numFadeTargets ? numFadeTargets : undefined;
    if (oldMacroVal !== newMacroVal) {

      if (numFadeTargets) {
        _blendPass.material.defines[macroName] = newMacroVal;
      } else {
        // remove define from blend pass. Note that setting to 'undefined' would not work here,
        // because the macro would still exist and would have the text value 'undefined'
        delete _blendPass.material.defines[macroName];
      }
      _blendPass.material.needsUpdate = true;
    }

    for (var i = 0; i < numFadeTargets; i++) {
      var uniformName = 'tCrossFadeTex' + i;
      _blendPass.uniforms[uniformName].value = _fadeTargets[i];
    }

    // Update fade-mode macro
    var modeMacroName = 'TARGET_FADE_MODE';
    var prevMode = _blendPass.material.defines[modeMacroName];
    if (prevMode !== _fadeMode) {
      _blendPass.material.defines[modeMacroName] = _fadeMode;
      _blendPass.material.needsUpdate = true;
    }
  };

  /* @param {number} mode - See FadeMode enum above. */
  this.setFadeMode = function (mode) {
    if (mode !== FadeMode.DECAL && mode !== FadeMode.CROSSFADE) {
      // A wrong value causes a shader compile error - so it's better to check here.
      console.error("Unexpected fade mode enum");
      return;
    }
    _fadeMode = mode;
    this.updateBlendPass();
  };

  /** Clear with opacity 0.0 */
  this.clearTarget = function (renderer) {
    // clear RGBA blend target with black + opacity 0.0 and default clearDepth
    // Note that the blend target needs an own z-buffer.
    renderer.setClearColor(_clearColor, 0.0);

    for (var i = 0; i < _fadeTargets.length; i++) {
      if (_enableClear[i]) {
        renderer.setRenderTarget(_fadeTargets[i]);
        renderer.clear(true, true, false);
      }
    }
  };

  // Clear can be temporarily disabled when using targets for static image fading.
  this.setClearEnabled = function (targetIndex, enabled) {
    _enableClear[targetIndex] = enabled;
  };

  this.disposeTargets = function () {
    for (var i = 0; i < _fadeTargets.length; i++) {
      var target = _fadeTargets[i];
      if (target) {
        target.dispose();
      }
      _fadeTargets[i] = null;
    }
  };

  this.dtor = function () {
    this.disposeTargets();
    this.updateBlendPass();

    this.setCrossFadeOpacity(0, 0);
    this.setCrossFadeOpacity(1, 0);
  };

  /* Determines to which color target a scene will be rendered.
   *  @param {THREE.Scene|RenderBatch} scene         - scene to be rendered
   *  @param {THREE.WebGLRenderTarget} defaultTarget - color target that RenderContext would use by default
   */
  this.chooseColorTarget = function (scene, defaultTarget) {

    // Check if scene is associated with a render model that is assigned to a cross-fade target
    var index = scene.modelId && _modelId2TargetIndex[scene.modelId];

    // use default target if nothing else is assigned
    if (index === undefined) {
      return defaultTarget;
    }

    // use cross-fade target
    return _fadeTargets[index];
  };

  /* Called by RenderContext if target sizes or formats may change. Makes sure that
   * the blendTarget exists and has matching size.
   *  @param {number} width          - render target width
   *  @param {number} height         - ...
   *  @param {bool}   [useHdrTarget] - if true, we use a float-type target
   *  @param {bool}   [force]        - force reallocate, even if width/height keep the same
   */
  this.updateTargets = function (width, height, force, useHdrTarget) {

    for (var i = 0; i < _numFadeTargets; i++) {

      var target = _fadeTargets[i];

      // skip if no update is needed
      if (!force && target && target.width === width && target.height === height) {
        continue;
      }

      // dispose any old target
      if (target) {
        target.dispose();
      }

      target = new THREE.WebGLRenderTarget(width, height,
      { minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: useHdrTarget ? THREE.FloatType : THREE.UnsignedByteType,
        //anisotropy: Math.min(this.getMaxAnisotropy(), 4),
        stencilBuffer: false
      });
      // three.js has a flaw in its constructor: the generateMipmaps value is always initialized to true
      target.texture.generateMipmaps = false;

      _fadeTargets[i] = target;
    }
  };

  /**
   * Starts offscreen rendering into one of the cross-fade targets.
   * Frames rendered between beginRenderFadeImage(i) and endRenderFadeImage() are rendered into a fading target
   * instead of the canvas. In this way, static images can be pre-rendered and faded.
   *  @param {number}        fadeTargetIndex - must be 0 or 1.
   *  @param {RenderContext} renderContext
   */
  this.beginRenderToFadeTarget = function (fadeTargetIndex, renderContext) {

    // Make sure that blend pass does not use the fadingTargets for reading while we are writing to one of them
    this.updateBlendPass(0);

    // make presentBuffer calls write into _offscreenTarget
    var target = _fadeTargets[fadeTargetIndex];
    renderContext.setOffscreenTarget(target);

    // protect fade-target from clear, so that the image will not be overwritten in subsequent frames
    this.setClearEnabled(fadeTargetIndex, false);
  };

  /**
   * Finish offscreen rendering into fading target. The rendered result is now overlayed on top of
   * the normal rendering result.
   *
   * @param {RenderContext} renderContext
   */
  this.endRenderFadeTarget = function (renderContext) {

    // render to canvas again
    renderContext.setOffscreenTarget(null);

    // make blend pass use fade targets again
    this.updateBlendPass();
  };
}

// expose enum
TargetCrossFade.FadeMode = FadeMode;

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
/*!*********************************************************!*\
  !*** ./extensions/CrossFadeEffects/CrossFadeEffects.js ***!
  \*********************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ CrossFadeEffects)
/* harmony export */ });
/* harmony import */ var _TargetCrossFade_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./TargetCrossFade.js */ "./extensions/CrossFadeEffects/TargetCrossFade.js");


const myExtensionName = 'Autodesk.CrossFadeEffects';

const av = Autodesk.Viewing;
const avp = av.Private;



/** CrossFadeEffects extension provides API for implementing smooth fading effects in LMV, e.g.
 *  - CrossFading between models or model configurations (e.g. color theming, hiding objects etc.)
 *  - Image-based "ghosting" effect, i.e. showing a semitransparent snapshot of a model on top of another one.
 *
 * The extension id is: `Autodesk.CrossFadeEffects`
 *
 * Note:
 *  - Note that CrossFadeEffects require 2 extra RenderTargets. So, they should only be used for optional effects that can be skipped on weak devices.
 *  - CrossFade effects can only be used for one purpose at a time. When using them for a new feature, you have to make sure
 *    that they don't conflict with existing features.
 *
 * @example
 *   viewer.loadExtension('Autodesk.CrossFadeEffects')
 *
 * @memberof Autodesk.Viewing.Extensions
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @alias Autodesk.Viewing.Extensions.CrossFadeEffects
 * @class
 * @hideConstructor
 * @public
 */
class CrossFadeEffects extends av.Extension {
  constructor(viewer, options) {

    super(viewer, options);
    this.crossFade = null;

    // Used to handle conflicts if this extension is used for different purposes
    this.clientId = null;
    this.onClientChanged = null;
  }

  static isSupported() {
    // CrossFadeEffects uses legacy blend-pass APIs that are not available on the WebGPU renderer.
    // Read the global rather than impl.isWebGPU(): impl only snapshots it in initialize(), so a load
    // before viewer.start() would see false. It is never overridden per viewer.
    return !avp.USE_WEBGPU;
  }

  /**
   * Enables cross frade effects.
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#load
   * @public
   */
  load() {
    this.setCrossFadeEnabled(true);
    return true;
  }

  /**
   * Disables cross frade effects.
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#unload
   * @public
   */
  unload() {
    this.setCrossFadeEnabled(false);
  }

  /**
   * Fading targets may be used by different clients for different purposes. That's okay as long
   * as it does not happen concurrently.
   *
   * In case of conflicts, the last caller takes precedence.
   *
   * If you start an effect using this extension, always call this function to notify client
   * code that was using it before. Vice versa, provide an onClientChanged() callback to handle the case
   * that someone else overtakes.
   *
   * Example: If start a fading effect while the ghost floors of the LevelsExtension are fading
   * out, the LevelsExtension will be notified to skip the fade-out anim to avoid conflicts.
   *
   * @param {string} clientId - Some identifier unique for the code component using the effect, e.g. the name of an extension.
   * @param {Function} [onClientChanged] - Will be called if another client called acquireControl.
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#acquireControl
   * @public
   */
  acquireControl(clientId, onClientChanged) {
    this.clientId = clientId;
    this.onClientChanged && this.onClientChanged(); // let previous client code now that we took control
    this.onClientChanged = onClientChanged; // call onClientChanged if someone else overtakes later
  }

  /**
   * Only allowed if modelCrossFade is enabled. Determines to which target a RenderModel will be rendered.
   *
   *  @param {number} modelId - The model id
   *  @param {undefined|0|1} targetIndex - index of the crossFade target or undefined (default) to use default color buffer
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#setModelTargetIndex
   * @public
   */
  setModelTargetIndex(modelId, targetIndex) {
    this.crossFade.setModelTargetIndex(modelId, targetIndex);
    this.viewer.impl.invalidate(true);
  }

  /**
   * Only allowed if modelCrossFade is enabled. Determines to which target a RenderModel will be rendered.
   *
   * @param {undefined|0|1} index - index of the crossFade target or undefined (default) to use default color buffer
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#setModelTargetIndexForAll
   * @public
   */
  setModelTargetIndexForAll(index) {
    const models = this.viewer.getVisibleModels();
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      this.setModelTargetIndex(model.id, index);
    }
  }

  /**
   * Only allowed if modelCrossFade is enabled. Assigns a blending opacity to a cross-fading
   * extra target.
   *
   *  @param {number} targetIndex - must be >0
   *  @param {number} opacity     - in [0,1]
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#setCrossFadeOpacity
   * @public
   */
  setCrossFadeOpacity(targetIndex, opacity) {
    this.crossFade.setCrossFadeOpacity(targetIndex, opacity);
    this.viewer.impl?.invalidate(true);
  }

  /*
   * @param {number} targetIndex - must be >0
   * @returns {number} opacity
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#getCrossFadeOpacity
   */
  getCrossFadeOpacity(targetIndex) {
    return this.crossFade.getCrossFadeOpacity(targetIndex);
  }

  /**
   * Enable/Disable model cross-fading. Must be enabled in order to render models to different render targets
   * for cross-fading effects (see below). If no cross-fading effects are used, it should be disabled to save
   * GPU memory and performance.
   *
   * @param {boolean} enable - Whether to enable(true) or disable(false) cross fade effects.
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#setCrossFadeEnabled
   * @public
   */
  setCrossFadeEnabled(enable) {
    if (enable === Boolean(this.crossFade)) {
      return;
    }

    let renderer = this.viewer.impl.renderer();
    if (enable) {
      let blendPass = renderer.getBlendPass();
      this.crossFade = new _TargetCrossFade_js__WEBPACK_IMPORTED_MODULE_0__.TargetCrossFade(blendPass);
      renderer.setCrossFade(this.crossFade);
    } else {
      this.crossFade.dtor();
      renderer.setCrossFade(null);
    }

    // If targets have been created already, call resize to make sure that
    //   1. crossFade targets are created and have correct size/format
    //   2. colorTarget/idTarget are reallocated with correct format
    //      Note that toggling crossFade affects color/id target format as well, because
    //      RGB and RGBA targets cannot be used at once when using MRT.
    let colorTarget = renderer.getColorTarget();
    if (colorTarget) {
      const pixelRatio = this.viewer.impl.glrenderer().getPixelRatio(); //setSize expects the size without pixelRatio
      renderer.setSize(colorTarget.width / pixelRatio, colorTarget.height / pixelRatio);
    }
  }

  /*
   * Renders a frame into a fading target, so that we can use it for a static-image fade.
   * The target will be protected from cleaning, so that it will overdraw the main scene.
   * To go back to normal rendering, call releaseFadingImage(fadeTargetIndex) afterwards.
   *  @param {0|1} fadeTargetIndex
   *  @param {number} [frameBudget] - time budget in ms that can be used for rendering this image.
   *                                  Only relevant if progressive rendering is on.
   *                                  (note: this is only an approximate value)
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#renderFadingImage
   */
  renderFadingImage(fadeTargetIndex, frameBudget) {
    // Make sure last frame was rendered to main target.
    // This is needed in case there were changes made (like cutplanes applied), before the viewer was able to render them.
    let timestamp = performance.now();
    this.viewer.impl.tick(timestamp);

    // make RenderContext render into fadeTarget
    let renderer = this.viewer.impl.renderer();
    this.crossFade.beginRenderToFadeTarget(fadeTargetIndex, renderer);

    // start new frame
    this.viewer.impl.invalidate(true, true, true);

    // temporarily overload rendering budget (if wanted). Cache the accurate render budget so it
    // can be restored exactly, independent of the ms-based estimate used to set the override.
    const originalRenderBudget = this.viewer.impl.getTargetRenderBudget();
    if (frameBudget) {
      this.viewer.impl.setTargetFrameBudget(frameBudget);
    }

    timestamp = performance.now();
    this.viewer.impl.tick(timestamp);

    // recover original render budget
    if (frameBudget) {
      this.viewer.impl.setTargetRenderBudget(originalRenderBudget);
    }

    // make RenderContext render to the main scene canvas again
    this.crossFade.endRenderFadeTarget(renderer);
  }

  /* Must be called when a baked fading image (see renderFadingImage) is not needed anymore. */
  releaseFadingImage(fadeTargetIndex) {
    this.setClearEnabled(fadeTargetIndex, true);
  }

  setClearEnabled(targetIndex, enabled) {
    this.crossFade.setClearEnabled(targetIndex, enabled);
  }

  /**
   * Runs a fading-animation on a cross-fading target.
   *
   *  @param {number}        targetIndex        - see setModelTargetIndex()
   *  @param {number}        startOpacity       - in [0,1]
   *  @param {number}        endOpacity         - in [0,1]
   *  @param {number}       [duration=5]        - in seconds
   *  @param {Function}     [onFinished]        - optional callback triggered when animation is finished
   *  @returns {object}     AnimControl instance
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#fadeTarget
   * @public
   */
  fadeTarget(targetIndex, startOpacity, endOpacity, duration, onFinished) {

    let setTargetOpacity = (val) => {
      this.setCrossFadeOpacity(targetIndex, val);
    };
    return avp.fadeValue(startOpacity, endOpacity, duration, setTargetOpacity, onFinished);
  }

  // Performs an image cross-fade between fade-target 0 and 1, assuming that the main scene is not visible.
  fadeImage(startVal, endVal, duration, onFinished) {

    // Temporarily hide all models during the image fade. They would be overdrawn anyway, so rendering them would just waste time.
    let mq = this.viewer.impl.modelQueue();
    let models = mq.getModels().slice(); // We have to copy - otherwise the array would be empty after hiding the models
    for (let i = 0; i < models.length; i++) {
      let model = models[i];
      mq.hideModel(model.id);
    }

    let onFadeDone = () => {

      // Set fading mode back to the default (independent decal of both targets)
      this.crossFade.setFadeMode(_TargetCrossFade_js__WEBPACK_IMPORTED_MODULE_0__.TargetCrossFade.FadeMode.CROSSFADE);

      // Reactivate all temporarily hidden models
      for (let i = 0; i < models.length; i++) {
        let model = models[i];
        mq.showModel(model.id);
      }

      if (onFinished) {
        onFinished();
      }
    };

    // fade between both targets
    let setTargetOpacity = (val) => {

      // Fade opacity of cross-fade target 1
      this.setCrossFadeOpacity(0, 1.0 - val);
      this.setCrossFadeOpacity(1, val);

      // Viewer3DImpl skips the present step if scene is empty. Therefore, we enforce
      // present from outside when cross-fading images.
      let renderer = this.viewer.impl.renderer();
      renderer.presentBuffer();
    };

    // For static image fading, we use the cross-fade mode. This ensures that identical pixels between both
    // images do not vary during transition.
    this.crossFade.setFadeMode(_TargetCrossFade_js__WEBPACK_IMPORTED_MODULE_0__.TargetCrossFade.FadeMode.CROSSFADE);

    return avp.fadeValue(startVal, endVal, duration, setTargetOpacity, onFadeDone);
  }

  /**
   * Runs a static image fade between the current view and a modified view.
   * (e.g. with changed model/fragment visiblity, ghosting etc.)
   * The modified view is specified via function applyState.
   *
   *  @param {Function} applyState - applied after rendering the fading start image.
   *  @param {number} duration - in seconds
   *
   * @alias Autodesk.Viewing.Extensions.CrossFadeEffects#fadeToViewerState
   * @public
   */
  fadeToViewerState(applyState, duration) {

    // time-limit in ms that we allow for rendering static images
    var renderBudget = 300;

    // Render "before" state into target 0
    this.renderFadingImage(0, renderBudget);

    // apply viewer state modification
    applyState();

    // render image that we fade to
    this.renderFadingImage(1, renderBudget);

    // remember if SAO was enabled before image fade, because we temporarily disable it, because
    // AO is already baked into the images that we fade.
    var rc = this.viewer.impl.renderer();
    var aoEnabled = rc.getAOEnabled();

    let onFadeDone = () => {
      // unlock targets again, so that we see the main color target again (instead of the static images)
      this.releaseFadingImage(0);
      this.releaseFadingImage(1);

      // recover original AO-enabled state
      rc.setAOEnabled(aoEnabled);
    };

    // disable SAO during fading
    rc.setAOEnabled(false);

    // run image fading
    this.fadeImage(0.0, 1.0, duration, onFadeDone);
  }
}

// Register the extension with the extension manager.
Autodesk.Viewing.theExtensionManager.registerExtension(myExtensionName, CrossFadeEffects);
})();

Autodesk.Extensions.CrossFadeEffects = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=CrossFadeEffects.js.map