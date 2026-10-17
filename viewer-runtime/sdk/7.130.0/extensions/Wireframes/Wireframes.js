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
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
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
/*!*********************************************!*\
  !*** ./extensions/Wireframes/Wireframes.js ***!
  \*********************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ WireframesExtension)
/* harmony export */ });


const av = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;

/**
 * Provides the ability of rendering the model in wireframe mode.
 * The method implemented is not very performant, so it's best to
 * avoid using it with large models.
 *
 * The extension id is: `Autodesk.Viewing.Wireframes`
 *
 * @example
 *   viewer.loadExtension('Autodesk.Viewing.Wireframes')
 *
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.WireframesExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
class WireframesExtension extends av.Extension {

  constructor(viewer, options) {
    super(viewer, options);

    this.groups = [];
    this.geometries = [];
    this.materials = [];
    this.lines = [];

    this.lightPreset = 4; //"Photo Booth";
    this.viewerLightPreset = 4;

    this.showingSolidMaterials = true;
    this.showingLines = true;

    this.linesMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(0x00000000),
      opacity: 0.03,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });

    this.solidMaterial = new Autodesk.Viewing.Scene.StandardMaterial({
      color: 0xFFCFCFCF,
      specular: 0x00000000,
      emissive: 0xFFCFCFCF,
      opacity: 1.0,
      transparent: false,
      polygonOffset: true,
      polygonOffsetFactor: 1.0,
      polygonOffsetUnits: 5
    });
    this.solidMaterial.packedNormals = true;
    this.name = 'wireframes';
    this.onProgressUpdate = this.onProgressUpdate.bind(this);
    this.onModelChanged = this.onModelChanged.bind(this);
  }

  onProgressUpdate(event) {
    if (event.state === av.ProgressState.LOADING) {

      // Add wireframes for newly loaded fragments.
      this.createAndAddWireframes();
    }
  }

  onModelChanged() {
    this.reset();
    this.createAndAddWireframes();
  }

  togglePolygonOffset() {
    // Functionality available in Viewer 2.15 and up, to make wireframe lines
    // look better.
    // However, wirelines may still work (though not as good) when the function is not present.
    const matManager = this.viewer.impl.getMaterials();
    if (matManager && matManager.togglePolygonOffset) {
      matManager.togglePolygonOffset(true, 1.0, 5.0);
    }
  }

  // Create and add wireframe geometry.
  createAndAddWireframes() {

    const viewer = this.viewer;
    const models = viewer.impl.modelQueue().getModels();
    const modelsCount = models.length;

    for (let i = 0; i < modelsCount; ++i) {

      if (!models[i].getData().instanceTree) {
        continue;
      }

      // Create group with all lines obtained for the model.
      const group = createWireframes(models[i], this.geometries, this.lines, this.materials, this.linesMaterial);
      group.model = models[i];
      this.groups.push(group);

      // Set solid material to new fragments only when tool is activated.
      if (this.activeStatus) {
        addWireframes(this.viewer, this.groups);
        this.setSolidMaterial(this.solidMaterial);
      }

    }

    this.togglePolygonOffset();
    viewer.impl.invalidate(true, true, true);
  }

  reset() {
    revertSolidMaterials(this.viewer, this.materials);
    revertWireframes(this.viewer, this.groups);

    this.geometries = [];
    this.materials = [];
    this.lines = [];
    this.groups = [];
  }

  load() {
    this.createAndAddWireframes();

    // Keep adding wireframes if model is still loading.
    this.viewer.addEventListener(av.PROGRESS_UPDATE_EVENT, this.onProgressUpdate);
    this.viewer.addEventListener(av.MODEL_REMOVED_EVENT, this.onModelChanged);
    this.viewer.addEventListener(av.FRAGMENTS_LOADED_EVENT, this.onModelChanged);
    this.viewer.addEventListener(av.FRAGMENTS_UNLOADED_EVENT, this.onModelChanged);

    // Enable line offset.
    this.togglePolygonOffset();

    return true;
  }

  unload() {

    this.activeStatus = false;
    this.reset();
    this.viewer.removeEventListener(av.PROGRESS_UPDATE_EVENT, this.onProgressUpdate);
    this.viewer.removeEventListener(av.MODEL_REMOVED_EVENT, this.onModelChanged);
    this.viewer.removeEventListener(av.FRAGMENTS_LOADED_EVENT, this.onModelChanged);
    this.viewer.removeEventListener(av.FRAGMENTS_UNLOADED_EVENT, this.onModelChanged);

    return true;
  }

  /**
   * Enters wireframe mode.
   *
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#activate
   * @public
   */
  activate() {

    this.activeStatus = true;

    this.viewerLightPreset = this.viewer.prefs.get('lightPreset');
    this.viewer.setLightPreset(this.lightPreset);

    this.setSolidMaterial(this.solidMaterial);
    this.setLinesMaterial(this.linesMaterial);

    addWireframes(this.viewer, this.groups);

    this.showSolidMaterial(this.showingSolidMaterials);
    this.showLines(this.showingLines);

    return true;
  }

  /**
   * Exits wireframe mode.
   *
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#deactivate
   * @public
   */
  deactivate() {

    this.activeStatus = false;
    this.viewer.setLightPreset(this.viewerLightPreset);
    revertWireframes(this.viewer, this.groups);
    revertSolidMaterials(this.viewer, this.materials);
    return true;
  }

  /**
   * Whether to replace the standard materials with a solid one, or not.
   *
   * @param {boolean} show
   *
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#showSolidMaterial
   * @public
   */
  showSolidMaterial(show) {

    this.showingSolidMaterials = show;

    if (!this.activeStatus) {
      return;
    }

    if (this.showingSolidMaterials) {
      this.setSolidMaterial(this.solidMaterial);
    } else {
      revertSolidMaterials(this.viewer, this.materials);
    }
  }

  /**
   * Whether to render line edges or not.
   *
   * @param {boolean} show
   *
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#showLines
   * @public
   */
  showLines(show) {

    this.showingLines = show;

    if (!this.activeStatus) {
      return;
    }

    const lines = this.lines;
    const linesCount = lines.length;

    for (let i = 0; i < linesCount; ++i) {

      const line = lines[i];
      line.visible = show;
    }

    this.viewer.impl.invalidate(true, true, true);
  }

  /**
   * Replaces the solid material.
   *
   * @param {THREE.Material} material
   *
   * @see {@link Autodesk.Viewing.Extensions.WireframesExtension#showSolidMaterial}
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#setSolidMaterial
   * @public
   */
  setSolidMaterial(material) {

    this.solidMaterial = material;
    // TODO: We don't dispose of the material we may be replacing. It isn't
    // clear whether we should do that, or whether it is the reponsibility of
    // the application to dispose of materials.
    const matman = this.viewer.impl.matman();
    const name = matman._getMaterialHash(null, "Autodesk.Viewing.Wireframes.solid");
    matman.addMaterial(name, material, true);

    // Replace all fragments materials if extension active and showing solid materials.
    if (!this.activeStatus || !this.showingSolidMaterials) {
      return;
    }

    const materials = this.materials;
    const materialsCount = materials.length;

    for (let i = 0; i < materialsCount; ++i) {
      let materialEntry = materials[i];
      materialEntry.fragments.setMaterial(materialEntry.fragment, this.solidMaterial);
    }

    this.viewer.impl.invalidate(true, true, true);
  }

  /**
   * Replaces the line material.
   *
   * @param {THREE.Material} material
   *
   * @see {@link Autodesk.Viewing.Extensions.WireframesExtension#showLines}
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#setLinesMaterial
   * @public
   */
  setLinesMaterial(material) {

    this.linesMaterial = material;
    // TODO: We don't dispose of the material we may be replacing. It isn't
    // clear whether we should do that, or whether it is the reponsibility of
    // the application to dispose of materials.
    const matman = this.viewer.impl.matman();
    const name = matman._getMaterialHash(null, "Autodesk.Viewing.Wireframes.lines");
    matman.addMaterialNonHDR(name, material);

    // Replace all lines materials if extension is active and showing lines.
    if (!this.activeStatus || !this.showingLines) {
      return;
    }

    const lines = this.lines;
    const linesCount = lines.length;

    for (let i = 0; i < linesCount; ++i) {

      const line = lines[i];
      line.material = this.linesMaterial;
    }

    this.viewer.impl.invalidate(true, true, true);
  }

  /**
   * Specifies the light preset to use when wireframe mode is activated.
   *
   * @param {string} name - the name of the light preset
   *
   * @memberof Autodesk.Viewing.Extensions.WireframesExtension
   * @alias Autodesk.Viewing.Extensions.WireframesExtension#setLightPreset
   * @public
   */
  setLightPreset(name) {

    this.lightPreset = name;
    if (this.activeStatus) {
      this.viewer.setLightPreset(name);
    }
  }

}


/**
 * @param model
 * @param geometries
 * @param lines
 * @param materials
 * @param linesMaterial
 * @private
 */
function createWireframes(model, geometries, lines, materials, linesMaterial) {

  // Get Meshes in the model.
  const tree = model.getData().instanceTree;
  const fragments = model.getFragmentList();
  const newGeometries = [];

  tree.enumNodeChildren(model.getRootId(), function (dbId) {

    if (tree.isNodeHidden(dbId) || tree.isNodeOff(dbId)) {
      return;
    }

    //All fragments that belong to the same node make part of the
    //same object so we have to accumulate all their intersections into one list
    tree.enumNodeFragments(dbId, function (fragmentId) {
      if (!fragments.isFragVisible(fragmentId))
      return;

      const geometry = fragments.getGeometry(fragmentId);

      if (!geometry) {
        return;
      }

      if (geometry.is2d || geometry.isLines) {
        return;
      }

      if (!fragments.getMaterial(fragmentId)?.cutplanes) {
        return;
      }

      // Save materials to restore later.
      materials.push({ fragment: fragmentId, fragments: fragments, material: fragments.getMaterial(fragmentId) });

      // Add geometry if not already present.
      if (!find(geometry, fragmentId, geometries)) {

        const world = new THREE.Matrix4();
        fragments.getWorldMatrix(fragmentId, world);
        newGeometries.push({ geometry: geometry, world: world, fragment: fragmentId });
      }
    }.bind(this), false);
  }, true);

  // Create wire lines.
  const group = new THREE.Group();

  let geometry = new THREE.BufferGeometry();
  geometry.isLines = true;

  let vertices = [];
  let indices = [];

  let runningIndex = 0;

  // we will run into array length limitations if we don't limit the size of a batch
  const batchSizeLimit = 2 ** 24;
  const tmpVec3 = new THREE.Vector3();

  const createBatch = () => {
    // create batched mesh
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 2));
    const mesh = new THREE.LineSegments(geometry, linesMaterial);
    lines.push(mesh);
    group.add(mesh);

    // reset
    geometry = new THREE.BufferGeometry();
    geometry.isLines = true;
    vertices = [];
    indices = [];
    runningIndex = 0;
  };

  for (const geom of newGeometries) {

    const srcWorld = geom.world;
    const srcGeometry = geom.geometry;

    const readPosition = avp.VertexEnumerator.makeReadPositionFunc(srcGeometry);
    const srcIndices = srcGeometry.ib;

    // create batch if it would surpass the limit
    if (vertices.length + srcIndices.length * 9 > batchSizeLimit) {
      createBatch();
    }

    for (let i = 0; i < srcIndices.length; i += 3) {

      for (let j = 0; j < 3; j++) {
        readPosition(srcIndices[i + j], tmpVec3);
        tmpVec3.applyMatrix4(srcWorld);
        vertices.push(tmpVec3.x, tmpVec3.y, tmpVec3.z);
      }

      indices.push(runningIndex + 0, runningIndex + 1);
      indices.push(runningIndex + 1, runningIndex + 2);
      indices.push(runningIndex + 2, runningIndex + 0);

      runningIndex += 3;
    }

    geometries.push(geom);
  }

  // create batch from remaining vertices
  createBatch();

  return group;
}

/**
 * @param {Viewer3D} viewer - Viewer instance
 * @param groups
 * @private
 */
function addWireframes(viewer, groups) {

  const groupsCount = groups.length;
  for (let i = 0; i < groupsCount; ++i) {

    viewer.impl.sceneAfter.add(groups[i]);
  }
  viewer.impl.invalidate(true, true, true);
}

/**
 * @param {Viewer3D} viewer - Viewer instance
 * @param materials
 * @private
 */
function revertSolidMaterials(viewer, materials) {

  const materialsLength = materials.length;
  for (let i = 0; i < materialsLength; ++i) {

    const material = materials[i];
    material.fragments.setMaterial(material.fragment, material.material);
  }
  viewer.impl.invalidate(true, true, true);
}

/**
 * @param {Viewer3D} viewer - Viewer instance
 * @param groups
 * @private
 */
function revertWireframes(viewer, groups) {

  const groupsCount = groups.length;
  for (let i = 0; i < groupsCount; ++i) {

    viewer.impl.sceneAfter.remove(groups[i]);
  }
  viewer.impl.invalidate(true, true, true);
}

/**
 * @param geometry
 * @param fragment
 * @param geometries
 * @private
 */
function find(geometry, fragment, geometries) {

  const geometryCount = geometries.length;
  for (let i = 0; i < geometryCount; ++i) {

    if (geometries[i].geometry === geometry && geometries[i].fragment === fragment) {
      return geometries[i];
    }
  }

  return null;
}


Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Viewing.Wireframes', WireframesExtension);
})();

Autodesk.Extensions.Wireframes = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Wireframes.js.map