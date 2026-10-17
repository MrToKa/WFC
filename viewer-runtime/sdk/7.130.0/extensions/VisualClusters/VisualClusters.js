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

/***/ "./extensions/VisualClusters/AnimController.js"
/*!*****************************************************!*\
  !*** ./extensions/VisualClusters/AnimController.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ AnimController)
/* harmony export */ });
/* harmony import */ var _AnimState_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./AnimState.js */ "./extensions/VisualClusters/AnimState.js");
//
// Controls animations between different animation states.
//




// An AnimController contains multiple scene animation states and can smoothly interpolate between those. Each state defines the positions for several objects.
//
// Example: Transition from "original shape positions" to "shapes are grouped by categories".
class AnimController {

  constructor(viewer) {

    // Describes animation state at the current time.
    this.currentState = new _AnimState_js__WEBPACK_IMPORTED_MODULE_0__.SceneAnimState();

    // Different states that we can interpolate between - indexed by stateName.
    this.states = {}; // string => SceneAnimState

    // Animation state at the point when the last animation had started
    this.startState = new _AnimState_js__WEBPACK_IMPORTED_MODULE_0__.SceneAnimState();

    // {Viewer3D}
    this.viewer = viewer;

    // Used to interrupt running in-progress animations
    this.animControl = null;
  }

  // Start animation to a target state.
  //
  // @param {string} [stateName] - A previously registered stateName or null. Null returns to original shape positions.
  //
  // @returns {AnimControl} Control in-progress animation..
  //                          control.stop(): to interrupt it.
  //                          control.isRunning(): to check whether it is in progress.
  animateTo(stateName = null, animTime = 2.0) {

    // Make sure that we don't run any previous animation concurrently
    this.stopAnim();

    const endState = this.states[stateName];

    const onTimer = (t) => {

      // Ensure that motion speed is changed smoothly
      t = Autodesk.Viewing.Private.smootherStep(t);

      this.currentState.lerp(this.startState, endState, t);
      this.currentState.apply(this.viewer);
    };

    // Freeze current SceneAnimState and keep it as start for interpolation
    this.startState.copyFrom(this.currentState);

    return Autodesk.Viewing.Private.fadeValue(0, 1, animTime, onTimer, () => this.onAnimEnded());
  }

  // Immediately stop current animation at its current state. No-op if no animation is running
  stopAnim() {
    if (this.animControl && this.animControl.isRunning) {
      this.animControl.stop();
      this.animControl = null;
    }
  }

  // Register new SceneState that we can animate to
  registerState(stateName, sceneState) {
    this.states[stateName] = sceneState;

    // Make sure that currentState addresses all objects that are modified by the new SceneAnimState.
    this.currentState.createObjectAnimStates(sceneState);
  }

  // Immediately apply a given animation state
  setState(stateName) {
    let state = this.states[stateName];
    if (state) {
      this.currentState.copyFrom(state);
    } else {
      // Recover shape transforms
      this.currentState.resetTransforms();
    }
    this.currentState.apply(this.viewer);
  }

  onAnimEnded() {
    //this should trigger ANIM_ENDED event
    this.viewer.dispatchEvent({ type: Autodesk.Viewing.ANIM_ENDED });
  }

  // Ensures that no animation is active and all anim transform is being cleared for all fragments that we modified before.
  reset() {
    this.stopAnim();
    this.currentState.resetTransforms();
    this.currentState.apply(this.viewer);

    // Drop all states to free some memory
    this.currentState = new _AnimState_js__WEBPACK_IMPORTED_MODULE_0__.SceneAnimState();
    this.states = {};
    this.startState = new _AnimState_js__WEBPACK_IMPORTED_MODULE_0__.SceneAnimState();
  }
};

/***/ },

/***/ "./extensions/VisualClusters/AnimState.js"
/*!************************************************!*\
  !*** ./extensions/VisualClusters/AnimState.js ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ModelAnimState: () => (/* binding */ ModelAnimState),
/* harmony export */   ObjectAnimState: () => (/* binding */ ObjectAnimState),
/* harmony export */   SceneAnimState: () => (/* binding */ SceneAnimState)
/* harmony export */ });
// Contains classes to control the animation state of animation for objects of one or more models.

const tmpMatrix = new THREE.Matrix4();
const tmpVec1 = new THREE.Vector3();

// Get translation offset that is needed to make the given
// point center of the rotation.
//  @param {Quaternion} rotation
//  @param {Vector3}    center
//  @param {Vecotr3}    [optionalTarget]
//  @returns {THREE.Vector3}
const getRotationOffset = (rotation, center, optionalTarget) => {

  const result = optionalTarget || new THREE.Vector3();

  // get rotation as matrix
  let rotMatrix = tmpMatrix.makeRotationFromQuaternion(rotation);

  // Compute where center would be moved when just applying rotation alone
  const p = center.clone().applyMatrix4(rotMatrix);

  // Return correction offset to bring center back at its original position
  return result.copy(center).sub(p);
};

// Describes an animation transform to be applied to single object.
// Note that placement is relative to original position, i.e., identity means shape appears at original position.
class ObjectAnimState {

  constructor(dbId) {

    // id of the object being animated
    this.dbId = dbId;

    // translation
    this.move = new THREE.Vector3(0, 0, 0);

    // scale
    this.scale = new THREE.Vector3(1, 1, 1);

    // rotation (as Quaternion)
    //
    // Note: Note that fragment animTransforms always rotate around the world origin,
    //       because the original matrix is applied first.
    this.rot = new THREE.Quaternion();

    // By default, fragment rotations in LMV rotate around the world-origin.
    this.rotCenter = new THREE.Vector3(0, 0, 0);
  }

  apply(model) {

    const fragList = model.getFragmentList();
    const it = model.getObjectTree();

    // Apply additional correction offset when rotating around a center != origin.
    // Note that rotations set by updateAnimTransform always rotate around world origin.
    const move = getRotationOffset(this.rot, this.rotCenter, tmpVec1).add(this.move);

    // Update fragment animation transforms
    it.enumNodeFragments(this.dbId, (fragId) => {
      fragList.updateAnimTransform(fragId, this.scale, this.rot, move);
    });
  }

  // Set this placement by interpolating between a start and end placement
  //  @param {ItemPlacement} start, end - If null, we assume identity transform.
  //  @param {number}        t          - interpolation param in [0,1]
  lerp(start, end, t) {

    // use identiy transform if start or end is missing
    start = start || ObjectAnimState.Identity;
    end = end || ObjectAnimState.Identity;

    // Interpolate move/scale/rotation
    this.move.lerpVectors(start.move, end.move, t);
    this.scale.lerpVectors(start.scale, end.scale, t);
    this.rotCenter.lerpVectors(start.rotCenter, end.rotCenter, t);
    this.rot.slerpQuaternions(start.rot, end.rot, t);
  }

  copyFrom(src) {
    this.dbId = src.dbId;
    this.move.copy(src.move);
    this.scale.copy(src.scale);
    this.rot.copy(src.rot);
    this.rotCenter.copy(src.rotCenter);
  }

  resetTransform() {
    this.move.set(0, 0, 0);
    this.scale.set(1, 1, 1);
    this.rot.set(0, 0, 0, 1); // = identity Quaternion
    this.rotCenter.set(0, 0, 0);
  }

  // Set rotation center.
  // @param {Vector3} center
  // @param {bool}    ajdustMove - If true, the move vector is changed so that the effect of the AnimState keeps the same.
  setRotationCenter(newCenter, adjustMove) {

    // Adjust translation offset to keep position
    if (adjustMove) {

      // Compute the shift that the shape position would do without move adjustment.
      // This could be optimized by avoiding double-computation of the rotation matrix.
      const oldOffset = getRotationOffset(this.rot, this.rotCenter);
      const newOffset = getRotationOffset(this.rot, newCenter);

      // Modify translation to eliminate the position shift
      this.move.add(oldOffset).sub(newOffset);
    }

    // Change rotationCenter
    this.rotCenter.copy(newCenter);
  }
}

// Represents the original state of an object when no anim transform is applied.
ObjectAnimState.Identity = new ObjectAnimState(-1);

// Describes animation transforms for a set of objects within the same RenderModel
class ModelAnimState {

  constructor(model) {

    this.model = model;

    // Indexed by dbId.
    this.animStates = []; // ObjectAnimState[]
  }

  apply() {
    for (var dbId in this.animStates) {
      this.animStates[dbId].apply(this.model);
    }

    // Make sure that hierarchical bboxes are updated
    this.model.invalidateBBoxes();
  }

  // Finds or creates an animState for the given dbId.
  //  @param {number}          dbId
  //  @param {ObjectAnimState} animState
  setAnimState(dbId, animState) {
    this.animStates[dbId] = animState;
  }

  getAnimState(dbId, createIfMissing = false) {

    let animState = this.animStates[dbId];

    // Create new one if needed
    if (!animState && createIfMissing) {
      animState = new ObjectAnimState(dbId);
      this.setAnimState(dbId, animState);
    }

    return animState;
  }

  // Adds new ObjectAnimStates for all dbIds in srcState.
  //
  // This is important if you use this to interpolate between other ModelStates and want to make sure that this ModelState
  // affects all dbIds that are affected either by startState or endState.
  //
  // @param {ModelAnimState} srcState
  createObjctAnimStates(srcState) {
    for (let key in srcState.animStates) {

      // Note that key is the dbId as string.
      // => Use the integer variant from srcState instead.
      const dbId = srcState.animStates[key].dbId;

      // Make sure that we have an ObjectAnimState for this dbId
      this.getAnimState(dbId, true);
    }
  }

  // Prepares this ModelState to interpolate between two others:
  // For this, we make sure that this ModelState affects all dbIds that are modified by either start or end.
  prepareLerp(start, end) {
    this.createObjectAnimStates(start);
    this.createObjectAnimStates(end);
  }

  // Updates all ObjectAnimStates by interpolating between a start and end anim state.
  //
  // Note: This only affects the existing ObjectAnimStates within this ModelAnimState.
  //       It does NOT create new AnimStates. See prepareLerp()
  //
  //  @param {ModelAnimState} start, end - may be null (= original state)
  //  @param {number}         t          - interpolation param in [0,1]
  lerp(start, end, t) {
    for (let dbId in this.animStates) {
      const objStart = start && start.animStates[dbId];
      const objEnd = end && end.animStates[dbId];
      this.animStates[dbId].lerp(objStart, objEnd, t);
    }
  }

  copyFrom(src) {

    this.model = src.model;

    // Make sure that we set the same ObjectAnimStates as src.
    // Avoid re-allocations if possible.
    for (let dbId in src.animStates) {
      // get or create state
      const srcObj = src.animStates[dbId];
      const dstObj = this.getAnimState(dbId, true);
      dstObj.copyFrom(srcObj);
    }

    // Clean all object animStates that src doesn't have
    for (let dbId in this.animStates) {
      if (!src.animStates[dbId]) {
        delete this.animStates[dbId];
      }
    }
  }

  // Reset anim transforms for all fragments that were modified by this state
  resetTransforms() {
    for (let dbId in this.animStates) {
      this.animStates[dbId].resetTransform();
    }
  }
}

// Describes animations for several objects within a scene composed from multiple models.
class SceneAnimState {

  constructor(models) {

    // ModelAnimState[] - indexed by modelId
    this.animStates = [];

    // Create a model placement for each model, indexed by modelId
    models && models.forEach((m) => this.animStates[m.id] = new ModelAnimState(m));
  }

  apply(viewer) {
    // Apply all model anim states
    for (let modelId in this.animStates) {
      this.animStates[modelId].apply();
    }

    // Force re-render
    viewer.impl.invalidate(true, true, true);
  }

  // Set animation state for a single object
  // Note that modelId must be the id of one of the models used for construction
  setAnimState(modelId, dbId, animState) {
    this.animStates[modelId].setAnimState(dbId, animState);
  }

  // Adds new ObjectAnimStates for all dbIds in srcState.
  // see ModelAnimState.createObjectAnimStates for details.
  //
  // @param {ModelAnimState} srcState
  createObjectAnimStates(srcState) {
    for (let modelId in srcState.animStates) {
      // get src ModelAnimState
      const src = srcState.animStates[modelId];

      // Get or create target ModelState for this model
      let dst = this.animStates[modelId];
      if (!dst) {
        dst = new ModelAnimState(src.model);
        this.animStates[modelId] = dst;
      }

      // Make sure that this ModelState operates on the same dbIds as src
      dst.createObjctAnimStates(src);
    }
  }

  // Prepares this SceneAnimState to interpolate between two others:
  // For this, we make sure that this SceneAnimState affects all dbIds that are modified by either start or end.
  //  @param {SceneAnimState} start, end
  prepareLerp(start, end) {
    this.createObjctAnimStates(start);
    this.createObjctAnimStates(end);
  }

  // Set this placement by interpolating between a start and end placement
  // Note:
  //  - All placements must refer to the same list of models
  //  - For each model, all placements must enlist the same dbIds
  //
  //  @param {ScenePlacement} start, end
  //  @param {number}         t          - interpolation param in [0,1]
  lerp(start, end, t) {
    for (let modelId in this.animStates) {
      const modelStart = start && start.animStates[modelId];
      const modelEnd = end && end.animStates[modelId];
      this.animStates[modelId].lerp(modelStart, modelEnd, t);
    }
  }

  // Makes this SceneState equal to the src state.
  copyFrom(srcState) {

    for (let modelId in srcState.animStates) {
      const src = srcState.animStates[modelId];
      let dst = this.animStates[modelId];

      // In case we don't have a ModelState for this model, create one
      if (!dst) {
        dst = new ModelAnimState(src.model);
        this.animStates[modelId] = dst;
      }

      dst.copyFrom(src);
    }

    // Erase any modelState that src doesn't have
    for (let modelId in this.animStates) {
      if (!srcState.animStates[modelId]) {
        delete this.animStates[modelId];
      }
    }
  }

  // Reset anim transforms for all fragments that were modified by this state
  resetTransforms() {
    for (let modelId in this.animStates) {
      this.animStates[modelId].resetTransforms();
    }
  }
}

/***/ },

/***/ "./extensions/VisualClusters/Cluster.js"
/*!**********************************************!*\
  !*** ./extensions/VisualClusters/Cluster.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Cluster: () => (/* binding */ Cluster),
/* harmony export */   buildClustersFromAttribute: () => (/* binding */ buildClustersFromAttribute),
/* harmony export */   createShapeId: () => (/* binding */ createShapeId),
/* harmony export */   hasVisibleFragments: () => (/* binding */ hasVisibleFragments)
/* harmony export */ });

// A ShapeID references a single object within a multi-models scene.
const createShapeId = (modelId, dbId) => {
  return {
    modelId,
    dbId
  };
};

// A Cluster is a group of objects that is supposed to be positions close to each other.
class Cluster {

  constructor(name) {

    // string
    this.name = name;

    // ShapeID[]
    this.shapeIds = [];
  }
}

// Checks if all fragments of a given dbId are hidden. If so, we exclude it from layout algorithm, because it would just produce empty space.
const hasVisibleFragments = (model, dbId) => {

  const it = model.getObjectTree();
  const fragList = model.getFragmentList();

  // Update fragment animation transforms
  let allHidden = true;
  it.enumNodeFragments(dbId, (fragId) => {

    // For OTG models, isNotLoaded tells us which fragments have been skipped by OtgLoader. This applies for Revit Room geometry.
    // For Svf, these flags may not exist, because they are deleted after loading. However, SvfLoader then sets the corresponding fragments to invisible.
    const skipped = fragList.isNotLoaded(fragId);
    const hidden = !fragList.isFragVisible(fragId);

    if (!skipped && !hidden) {
      // We found a visible fragment
      allHidden = false;

      // No need to continue traversal
      return true;
    }
  });
  return !allHidden;
};

// Remove duplicates from array
//  @param {[]} a
//  @returns {[]} Deduplicated copy.
const uniq = (a) => {
  return Array.from(new Set(a));
};

// Creates a set of clusters based on the values of a certain propertyDB attribute.
// Note that you have to wait for an async propDB call to finish.
//
// By default, we only categorize leaf objects. This requires that all leaf objects contain the attribute to search for.
// The searchParents option enables to allow parent nodes as well:
//      i.e. we search all levels of the model tree and consider inner nodes as a single object if they contain
//           the search attribute.
//
//  @param {Model[]}   models
//  @param {string}    attribName
//  @param {boolean}   searchParents
//  @returns {Promise} When done, it resolves to a {Cluster[]}, where each element is...
//                       - named by an attribute value
//                       - containing all ShapeIds that match that value
const buildClustersFromAttribute = async (models, attribName = 'Category', searchAncestors = false) => {

  // Collects result
  const clustersByName = {};

  // For each model, we run an async propDB worker query
  const promises = [];

  for (let i = 0; i < models.length; i++) {

    let model = models[i];
    const tree = model.getData().instanceTree;
    let dbIds;

    if (searchAncestors) {
      // Use all the dbIds in the model
      const ids = Object.keys(tree.nodeAccess.dbIdToIndex);
      dbIds = ids.map((item) => parseInt(item, 10));
    } else {
      // get all dbIds with visual representation
      dbIds = model.myData.fragments.fragId2dbId;

      // Exclude all dbIds that only contain hidden fragments (like room geometries)
      dbIds = dbIds.filter((dbId) => hasVisibleFragments(model, dbId));

      // Remove duplicates. Note that this is necessary, because dbIds with multiple fragments will
      // occur several times in fragId2dbId.
      dbIds = uniq(dbIds);
    }

    const options = {
      ignoreHidden: false,
      propFilter: [attribName]
    };

    promises.push(new Promise((resolve, reject) => {

      // Process dbIds. result is an array of item,
      // each containing the props for a single dbId
      const onDone = (result) => {
        for (let i = 0; i < result.length; i++) {

          // item contains props of a single db object
          const item = result[i];

          // get category of this db item
          const category = item.properties[0].displayValue;

          // get or create cluster for this category
          let cluster = clustersByName[category];
          if (!cluster) {
            cluster = new Cluster(category);
            clustersByName[category] = cluster;
          }

          if (searchAncestors) {
            // Append IDs of visible children
            tree.enumNodeChildren(item.dbId, (child) => {
              if (hasVisibleFragments(model, child)) {
                cluster.shapeIds.push(createShapeId(model.id, child));
              }
            }, true);
          } else {
            // Append current dbId to this cluster
            cluster.shapeIds.push(createShapeId(model.id, item.dbId));
          }
        }
        resolve();
      };

      model.getBulkProperties2(dbIds, options, onDone);
    }));
  }

  await Promise.all(promises);

  // Flatten to an array
  let clusters = Object.values(clustersByName);

  return clusters;
};



/***/ },

/***/ "./extensions/VisualClusters/ClusterGizmo.js"
/*!***************************************************!*\
  !*** ./extensions/VisualClusters/ClusterGizmo.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ClusterGizmo: () => (/* binding */ ClusterGizmo),
/* harmony export */   ClusterGizmoController: () => (/* binding */ ClusterGizmoController)
/* harmony export */ });

// Disable packed normals for now, because it sometimes causes wrong values in the normal-depth-buffer (not clear why).
// The number of cluster boxes is small anyway, so using unpacked is okay here.
const UsePackedNormals = false;

const avp = Autodesk.Viewing.Private;

// Creates a quad with xy in [-0.5, 0.5] and z=0. Normal is +z
const createUnitQuadGeom = () => {

  const l = -0.5;
  const h = +0.5;

  // vertex positions (3-floats per vertex)
  const positions = Float32Array.from([
  l, l, 0,
  l, h, 0,
  h, l, 0,
  h, h, 0]
  );

  // index buffer for triangles
  const indices = Uint16Array.from([0, 3, 1, 0, 2, 3]);

  // index buffer for edges
  const iblines = Uint16Array.from([0, 1, 1, 3, 3, 2, 2, 0]);

  // create interleaved vertex buffer
  const vertexCount = 4;
  const vbstride = UsePackedNormals ? 4 : 6; // float32 values per vertex
  const vb = new Float32Array(vertexCount * vbstride);

  // write positions to interleaved buffer
  for (let i = 0; i < vertexCount; i++) {
    const srcOffset = 3 * i;
    const dstOffset = vbstride * i;
    vb[dstOffset] = positions[srcOffset];
    vb[dstOffset + 1] = positions[srcOffset + 1];
    vb[dstOffset + 2] = positions[srcOffset + 2];
  }

  if (UsePackedNormals) {
    // encode (0,0,1) as packed Uint16 normal
    const toUint16 = 0xFFFF; // for upscaling from [0,1]-floats to Uint16-scale
    const nx = 0.5 * toUint16;
    const ny = 1.0 * toUint16;

    // The first 3 floats per vertex are used by positions.
    // Counting in Uint16 values, this makes 6.
    const normalOffset = 6;

    // write normals to interleaved buffer
    const vbUint16 = new Uint16Array(vb.buffer);
    const vbUint16Stride = vbstride * 2; // 2 Uint16 per float32
    for (let i = 0; i < vertexCount; i++) {
      const dstOffset = vbUint16Stride * i + normalOffset;
      vbUint16[dstOffset] = nx;
      vbUint16[dstOffset + 1] = ny;
    }
  } else {
    const normalOffset = 3;

    // write normals to interleaved buffer
    for (let i = 0; i < vertexCount; i++) {
      const dstOffset = vbstride * i + normalOffset;
      vb[dstOffset] = 0;
      vb[dstOffset + 1] = 0;
      vb[dstOffset + 2] = 1;
    }
  }

  // create result geometry
  const geom = new THREE.BufferGeometry();
  geom.streamingDraw = true;

  geom.vbstride = vbstride;
  geom.vb = vb;
  geom.ib = indices;
  geom.iblines = iblines;
  // position attribute
  var attrPos = new THREE.BufferAttribute(undefined, 3);
  attrPos.offset = 0;
  geom.attributes.position = attrPos;

  // normal attribute
  var attrNormal = new THREE.BufferAttribute(undefined, 3);
  attrNormal.offset = 3;
  attrNormal.bytesPerItem = UsePackedNormals ? 2 : 6;
  attrNormal.normalized = true;
  geom.attributes.normal = attrNormal;

  // index attribute
  var attrIndex = new THREE.BufferAttribute(undefined, 1);
  attrIndex.bytesPerItem = 2;
  geom.index = attrIndex;

  // add attribute for edge rendering
  var attrIndexLines = new THREE.BufferAttribute(undefined, 1);
  attrIndexLines.bytesPerItem = 2;
  geom.setAttribute('indexlines', attrIndexLines);

  // attribute keys
  geom.attributesKeys = Object.keys(geom.attributes);

  return geom;
};

// Creates a quad mesh that corresponds to the z-Min face of the given bbox
//  @param {Box3}            bbox
//  @param {BufferGeometry}  unitQuadGeom
//  @param {Material}        matman       - must be registered at materialManager and use packedNormals
const createGizmoMesh = (bbox, material) => {

  // In theory, we could share a static one here. However, this would introduce subtle detail problems
  // when using multiple viewer instances, because WebGLRenderer attaches gl-context-specific resources.
  // The number of gizmo boxes is not big anyway, so what.
  const geom = createUnitQuadGeom();

  // create mesh
  var boxMesh = new THREE.Mesh(geom, material);

  // move mesh origin to center of bbox z-min face
  bbox.getCenter(boxMesh.position);
  bbox.getSize(boxMesh.scale);
  boxMesh.position.z = bbox.min.z;

  // Attach mesh bbox
  boxMesh.boundingBox = bbox.clone();
  boxMesh.boundingBox.max.z = bbox.min.z; // The mesh only spans the z-min surface of bbox

  return boxMesh;
};

// @param {MaterialManager} matman - needed to register the material
const createGizmoMaterial = (matman) => {

  // create material
  var material = new Autodesk.Viewing.Scene.StandardMaterial({
    color: 0xffffff, // white
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,

    // Disable z-buffer: It doesn't work with fading and the quads are below all the shapes anyway.
    depthTest: false,
    depthWrite: false
  });

  // Note: This is must be set separately, because it's a custom-lmv property and not supported by the material ctor
  material.packedNormals = UsePackedNormals;

  // Register at MaterialManager
  material.name = 'ClusterGizmoMaterial_' + material.id;
  matman.addHDRMaterial(material.name, material);

  return material;
};

const disposeGizmoMesh = (mesh, matman) => {
  mesh.geometry.dispose();
  mesh.material.dispose();
  matman.removeMaterial(mesh.material.name);
};

// A ClusterGizmo is a quad below an object cluster that helps to distinguish different clusters.
class ClusterGizmo {

  // @param {Box3}   clusterBox - bbox of the cluster
  // @param {string} [meshName] - Attached to the mesh to simplify debugging
  constructor(viewer, clusterBox, meshName) {

    this.viewer = viewer;

    // create mesh
    const material = createGizmoMaterial(viewer.impl.matman());
    this.mesh = createGizmoMesh(clusterBox, material);

    this.mesh.name = meshName;

    // add it to viewer scene
    this.viewer.impl.scene.add(this.mesh);

    // For smooth fadeIn/Out
    const setOpacity = (t) => {
      // Fade-in quad
      this.mesh.material.opacity = t;

      // Fade-in outline: Edges should have 0.5 opacity when fully faded in
      this.mesh.material.edgeOpacity = 0.5 * t;

      this.mesh.material.uniformsNeedUpdate = true;
      this.viewer.impl.invalidate(true, true);
    };
    this.opacityParam = new avp.AnimatedParam(0.0, setOpacity, 1.0);

    // Initial fade-in
    this.opacityParam.fadeTo(1);
  }

  dtor() {
    // remove from viewer scene
    this.viewer.impl.scene.remove(this.mesh);
    this.viewer.impl.invalidate(true, true);

    // dispose gpu resources
    disposeGizmoMesh(this.mesh, this.viewer.impl.matman());

    this.mesh = null;
    this.viewer = null;
  }

  // Fade out and dispose mesh when done
  dispose() {
    this.opacityParam.fadeTo(0.0, () => this.dtor());
  }
}

// ClusterGizmoController takes care that ClusterGizmos and corresponding labels are created/disposed according to the currently shown layout.
class ClusterGizmoController {

  constructor(viewer) {

    this.viewer = viewer;

    this.gizmos = []; // ClusterGizmo[]
    this.labels = []; // Label3D[]

    // We delay fade-in, so that gizmos/labels appear shortly before the cluster animation ends
    this.fadeInDelay = 1.8; // in seconds
    this.timerId = null;
  }

  createGizmos(sceneLayout) {

    // For each cluster...
    const layouts = sceneLayout.clusterLayouts;
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i];

      // create quad gizmo
      const bbox = layout.getBBox();
      const gizmo = new ClusterGizmo(this.viewer, bbox, layout.cluster.name);
      this.gizmos.push(gizmo);

      // get label position (center of the bbox zMin-face)
      const labelPos = bbox.getCenter(new THREE.Vector3());
      labelPos.z = bbox.min.z;

      // create label
      const text = this.getLabelText(layout);
      const label = new Autodesk.Edit3D.Label3D(this.viewer, labelPos, text);
      this.labels.push(label);

      // Hide label if ClusterGizmo size on screen is below MinPixels threshold.
      //
      // Note: We could use the screen-size of the label text. However, this looks confusing
      //       if some cluster labels are shown and others are not (due to longer text that you don't see).
      //       So, it looks more consistent to use a fixed minPixelSize for all clusters.
      //       For super-long cluster names, we will introduce abbreviations instead.
      const MinPixels = 75;
      label.setWorldBox(gizmo.mesh.boundingBox, MinPixels);

      // When clicking a label, fly to the cluster
      const flyToCluster = (e) => {
        const camera = this.viewer.impl.camera;

        // get cluster-platform center and box size
        const gizmoBox = gizmo.mesh.boundingBox;
        const p = gizmoBox.getCenter(new THREE.Vector3());
        const size = gizmoBox.getSize(new THREE.Vector3());

        // Setup view diagonally to look at p
        const dstView = camera.clone();
        dstView.target.copy(p);

        // get current distance from target point
        const curDistance = camera.position.distanceTo(p);

        // Place the camera on the line between target and start camera position.
        // Choose distance close enough to the cluster to clearly focus it.
        let dist = Math.max(size.x, size.y, size.z);
        dist = Math.min(dist, curDistance); // if already close, never move away from target
        let dir = camera.position.clone().sub(p).normalize();
        dstView.position.set(
          p.x + dir.x * dist,
          p.y + dir.y * dist,
          p.z + dir.z * dist
        );

        // trigger animation
        avp.flyToView(this.viewer, dstView, 1.5);

        // Mark click as consumed, so that it doesn't trigger selection of objects behind the label.
        e.stopPropagation();
      };
      label.container.style.pointerEvents = 'auto';
      label.container.addEventListener('click', flyToCluster);
    }
  }

  getLabelText(layout) {
    let text = layout.cluster.name;

    // Remove "Revit " prefix
    // For now, we hard-wire this, but this function will be customizable by clients later.
    const prefix = 'Revit ';
    if (isNaN(text) && text.startsWith(prefix)) {
      text = text.substring(prefix.length);
    }

    return text;
  }

  disposeGizmos() {
    this.gizmos.forEach((g) => g.dispose());
    this.labels.forEach((l) => l.dispose());
    this.gizmos.length = 0;
    this.labels.length = 0;
  }

  // If a delayed fade-in of gizmos is pending for prior layout, cancel it
  cancelTimer() {
    if (this.timerId) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  onLayoutChanged(sceneLayout) {

    // Make sure that there is no concurrent delayed fade-in of a prior layout
    this.cancelTimer();

    // Fade-out and dispose any outdated gizmos
    this.disposeGizmos();

    // Fade-in new gizmos after some delay
    if (sceneLayout) {
      this.timerId = window.setTimeout(
        () => this.createGizmos(sceneLayout),
        this.fadeInDelay * 1000
      );
    }
  }

  // Dispose all resources immediately
  reset() {
    this.gizmos.forEach((g) => g.dtor());
    this.labels.forEach((l) => l.dtor());
    this.gizmos.length = 0;
    this.labels.length = 0;
  }
}

/***/ },

/***/ "./extensions/VisualClusters/ClusterLayout.js"
/*!****************************************************!*\
  !*** ./extensions/VisualClusters/ClusterLayout.js ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ClusterRowLayout: () => (/* binding */ ClusterRowLayout),
/* harmony export */   ClusterSetLayout: () => (/* binding */ ClusterSetLayout),
/* harmony export */   ShapeBoxes: () => (/* reexport safe */ _ShapeBoxes_js__WEBPACK_IMPORTED_MODULE_1__["default"])
/* harmony export */ });
/* harmony import */ var _AnimState_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./AnimState.js */ "./extensions/VisualClusters/AnimState.js");
/* harmony import */ var _ShapeBoxes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ShapeBoxes.js */ "./extensions/VisualClusters/ShapeBoxes.js");




const tmpBox = new THREE.Box3();

// Rotate an item by 90 degrees to make sure that width >= height.
// This is done in a way that the box minPoint keeps the same.
//
// Note: Rotations using animTransform rotate around the world origin
//
// @param {THREE.Box3}      box - Original worldBox of a shape (without any animTransform applied)
// @param {ObjectAnimState} dst - animState on which we set the rotation
const applyAlignmentTransform = (box, dst) => {

  // rotate by 90 degrees
  let angle = 90;
  let axis = new THREE.Vector3(0, 0, 1);
  dst.rot.setFromAxisAngle(axis, THREE.Math.degToRad(angle));

  // Rotations work around the world origin.
  // Now, we modify the move vector to make sure that the bbox keeps the same

  // get rotation as matrix
  let rotTf = new THREE.Matrix4().makeRotationFromQuaternion(dst.rot);

  // get box after rotation
  const box2 = tmpBox.copy(box).applyMatrix4(rotTf);

  // modify move vector to obtain the same box minPoint as before rotation
  // Note that box2.min is not simply the same as we would get when rotating the point box.min.
  dst.move.sub(box2.min).add(box.min);
};

// A ClusterRowLayout defines how to line up a group of objects along one or more rows.
class ClusterRowLayout {

  constructor(cluster) {

    // MinPoint of the whole cluster.
    this.position = new THREE.Vector3(0, 0, 0);

    // {Cluster} - The cluster defining the object that this layout refers to
    this.cluster = cluster;

    // For each dbId cluster.shapeIds[i], positions[i] defines the corresponding position.
    // Each object is anchored at the bbox minPoint.
    this.positions = []; // Vector3[]

    // If rotated[i] is true, the shape with id clusterShapeIds[i] will be rotated by 90 degree around z,
    // so that x/y are swapped - while preserving the bbox minPoint.
    this.rotated = []; // bool[]

    // Spatial extent of this cluster.
    this.size = new THREE.Vector3(0, 0, 0);
  }

  getBBox(optionalTarget) {
    let target = optionalTarget || new THREE.Box3();
    target.min.copy(this.position);
    target.max.copy(this.position).add(this.size);
    return target;
  }

  // Modifies the given scene anim state so that all objects in the cluster are properly placed and rotated.
  //
  //  @param {SceneAnimState} sceneAnimState - SceneAnimState to be modified.
  //  @param {Vector3}        offset         - Additional translation offset applied to all objects
  //  @param {ShapeBoxes}     shapeBoxes     - access to shape bboxes
  //  @param {RotationAlignment} [rotationAlignment] - Optional: Defines rotations that are applied per shape.
  apply(sceneAnimState, offset, shapeBoxes, rotationAlignment) {

    // reused tmp-vector
    const targetPos = new THREE.Vector3();

    // Reused below
    const tmpBox = new THREE.Box3();
    const tmpVec = new THREE.Vector3();

    for (let i = 0; i < this.cluster.shapeIds.length; i++) {

      // get shapeId
      let shapeId = this.cluster.shapeIds[i];

      // init itemPlacement for this shape
      const animState = new _AnimState_js__WEBPACK_IMPORTED_MODULE_0__.ObjectAnimState(shapeId.dbId);

      // get final position of this shape:
      targetPos.copy(this.positions[i]) // position of the shape within the cluster
      .add(this.position) // position of this cluster within the cluster set
      .add(offset); // cluster set position

      // get original shape minPoint
      let originalBox = shapeBoxes.getShapeBox(shapeId, tmpBox);
      const originalPos = originalBox.min;

      // Set move-vector so that originalPos is moved to targePos
      animState.move.subVectors(targetPos, originalPos);

      if (rotationAlignment) {
        // Apply rotation
        rotationAlignment.getShapeRotation(shapeId, animState.rot);

        // Set original shape box center as rotation anchor
        const shapeBox = shapeBoxes.getUnrotatedShapeBox(shapeId, tmpBox);
        const center = shapeBox.getCenter(tmpVec);
        animState.setRotationCenter(center, true);
      }

      // If needed, apply rotation while keeping bbox.min the same.
      // Note: When using RotationAlignments, the auto-flip is not needed anymore.
      //       So, this code path will be removed as soon as the new variant is sufficiently tested.
      const needsRotate = this.rotated[i];
      if (needsRotate) {

        // get shape bbox
        originalBox = shapeBoxes.getShapeBox(shapeId, originalBox);

        // apply rotation
        applyAlignmentTransform(originalBox, animState);
      }

      // Add object anim state to scene anim state
      sceneAnimState.setAnimState(shapeId.modelId, shapeId.dbId, animState);
    }
  }
}

// Defines the placement for a set of object clusters
class ClusterSetLayout {

  // @param {ClusterLayout}     layouts
  // @param {RotationAlignment} [rotationAlignment] - only needed if shapes are rotated for alignment.
  constructor(layouts, rotationAlignment) {

    // ClusterSet position. ClusterSets are anchored at the minPoint
    this.position = new THREE.Vector3(0, 0, 0);

    // {ClusterLayout[]}
    this.clusterLayouts = layouts || [];

    // {RotationAlignment}
    this.rotationAlignment = rotationAlignment;
  }

  // Modifies the given scene anim state so that all objects in all cluster are properly placed and rotated.
  //
  //  @param {SceneAnimState} sceneAnimState - SceneAnimState to be modified.
  //  @param {ShapeBoxes}     shapeBoxes     - access to shape bboxes
  apply(sceneAnimState, shapeBoxes) {
    this.clusterLayouts.forEach((l) => l.apply(sceneAnimState, this.position, shapeBoxes, this.rotationAlignment));
  }

  // Creates a SceneAnimState that brings all shapes to their target positions
  createSceneState(models) {
    let shapeBoxes = new _ShapeBoxes_js__WEBPACK_IMPORTED_MODULE_1__["default"](models, this.rotationAlignment);
    let state = new _AnimState_js__WEBPACK_IMPORTED_MODULE_0__.SceneAnimState(models);
    this.apply(state, shapeBoxes);
    return state;
  }
}



/***/ },

/***/ "./extensions/VisualClusters/RotationAlignment.js"
/*!********************************************************!*\
  !*** ./extensions/VisualClusters/RotationAlignment.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   RotationAlignment: () => (/* binding */ RotationAlignment),
/* harmony export */   collectFragBoxAxes: () => (/* binding */ collectFragBoxAxes),
/* harmony export */   computeObjectAlignment: () => (/* binding */ computeObjectAlignment),
/* harmony export */   computeTransformedObjectBox: () => (/* binding */ computeTransformedObjectBox),
/* harmony export */   findAlignmentRotation: () => (/* binding */ findAlignmentRotation),
/* harmony export */   getAngleToXAxis: () => (/* binding */ getAngleToXAxis),
/* harmony export */   getBoxCorner: () => (/* binding */ getBoxCorner),
/* harmony export */   getRotatedFragmentBox: () => (/* binding */ getRotatedFragmentBox)
/* harmony export */ });
// The purpose of this file is to compute the necessary transforms to rotate
// all objects in a way that...
//
//  1. Identical objects are oriented in the same way
//  2. Objects are horizontally aligned with the main axes x/y to reduce bbox extents.
//  3. Up-Vector is preserved
//
// It also provides methods to consider these rotations during computation of
// cluster layout and animation.

// @param {Box3}   box
// @param {number} i - in [0, 7]
const getBoxCorner = (box, i) => {
  return new THREE.Vector3(
    i & 1 ? box.min.x : box.max.x,
    i & 2 ? box.min.y : box.max.y,
    i & 4 ? box.min.z : box.max.z
  );
};

// Each element is a corner index. Each pair of two forms a main axis direction.
const BoxAxisIndices = Uint32Array.from([
0, 1, 0, 2, 0, 4]
);

// Helper class to enumerate the main axis directions of one or more rotated bboxes.
class BoxAxes {

  constructor() {
    // Transforming vertices turned out to be the major cost factor. So we use indexing to reduce it.
    this.vertices = [];

    this.tmpPoint = new THREE.Vector3();
  }

  // @param {Box3}    box
  // @param {Matrix4} matrix - orientation of the box
  addBox(box, matrix) {

    // It's important to skip empty boxes. Otherwise, we would produce infinite
    // extents after transforming min/max
    if (box.isEmpty()) {
      return;
    }

    // add 8 box corners
    for (let i = 0; i < 8; i++) {
      const p = getBoxCorner(box, i).applyMatrix4(matrix);
      this.vertices.push(p);
    }
  }

  // Sets outAxis.indexA and outAxis.indexB to vertex numbers of the given edge
  //
  // @param {number} axisIndex
  // @param {Object} outAxis.indexA and outAxis.indexB will be set.
  getAxis(axisIndex, outAxis) {
    // Get offset where the vertices of the box start
    const boxIndex = Math.floor(axisIndex / 3); // 3 axes per box
    const vertexOffset = 8 * boxIndex; // 8 vertices per box

    // Get index into BoxAxisIndices
    const localIndex = 2 * axisIndex % BoxAxisIndices.length; // 2 values per axis

    outAxis.indexA = vertexOffset + BoxAxisIndices[localIndex];
    outAxis.indexB = vertexOffset + BoxAxisIndices[localIndex + 1];
  }

  getAxisCount() {
    const boxCount = this.vertices.length / 8;
    const AxesPerBox = 3;
    return boxCount * AxesPerBox;
  }

  // Returns bounding rectangle of all boxes if we transform all points by the given matrix
  //  @param {Box2}    outRect
  //  @param {Matrix4} matrix
  getBoundingRect(outRect, matrix) {
    for (let v of this.vertices) {
      // add transformed vertex to bbox
      const p = this.tmpPoint.copy(v).applyMatrix4(matrix);
      outRect.expandByPoint(p);
    }
  }
};

// Find rotation around z-axis that brings the given (horizontal) direction to the x-axis
//
//  @param {Vector2}  dir - Does not need to be normalized
//  @returns {number} ccw angle in radians. Rotate by this angle to bring dir to xAxis.
const getAngleToXAxis = (dir) => {
  return -Math.atan2(dir.y, dir.x);
};

// Collects main axes of all fragment geometry boxes and projects them to world-space.
//  @returns {BoxAxes}
const collectFragBoxAxes = (model, dbId) => {

  let boxAxes = new BoxAxes();

  const geomList = model.getGeometryList();
  const fragList = model.getFragmentList();

  // Reused tmp-values
  const geomBox = new THREE.Box3();
  const worldMatrix = new THREE.Matrix4();

  // For each fragment...
  const it = model.getObjectTree();
  it.enumNodeFragments(dbId, (fragId) => {

    // Set geomBox to geometry bbox in object-space (for otg, it will simply be the unit box)
    const geomId = fragList.getGeometryId(fragId);
    geomList.getModelBox(geomId, geomBox);

    // get fragment world matrix
    fragList.getOriginalWorldMatrix(fragId, worldMatrix);

    // collect bbox with transform
    boxAxes.addBox(geomBox, worldMatrix);
  });
  return boxAxes;
};

// Given vertices and axis directions of bboxes, this function finds a rotation around z so that...
//  - area of the boundsXY is minimized
//  - We always have xExtent <= yExtent for boundsXY
// where boundsXY is the bounding box of the xy-projection of all boxes.
//
// Note: We assume here that the optimal solution will align one of the edges with the x-axis.
//
//  @param {BoxAxes} boxAxes
//  @returns {Quaternion}
const findAlignmentRotation = (boxAxes) => {

  // Reused in the loop below
  const edgeDir = new THREE.Vector2();
  const quaternion = new THREE.Quaternion();
  const rotMatrix = new THREE.Matrix4();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const rect = new THREE.Box2();

  let minArea = Infinity;
  let bestAngle = null;
  let minExtent = new THREE.Vector2();

  // An axis direction, given by two indices into boxAxes.vertices
  const axis = {
    indexA: 0,
    indexB: 0
  };
  let a = null;
  let b = null;

  // For each edge...
  const axisCount = boxAxes.getAxisCount();
  for (let i = 0; i < axisCount; i++) {

    // get edge
    boxAxes.getAxis(i, axis);
    a = boxAxes.vertices[axis.indexA];
    b = boxAxes.vertices[axis.indexB];

    // get edge direction
    edgeDir.set(b.x - a.x, b.y - a.y);

    // compute rotation matrix that brings that angle to x-axis (ccw radians)
    let angleToXAxis = getAngleToXAxis(edgeDir);
    quaternion.setFromAxisAngle(zAxis, angleToXAxis);
    rotMatrix.makeRotationFromQuaternion(quaternion);

    // compute xy-bounding rectangle that we get when using this angle
    boxAxes.getBoundingRect(rect, rotMatrix);

    // compute area
    const dx = rect.max.x - rect.min.x;
    const dy = rect.max.y - rect.min.y;
    const area = dx * dy;

    // If this area is better than our candidates so far, use it
    if (area < minArea) {
      // keep rotation that minimized area so far
      minExtent.set(dx, dy);
      minArea = area;
      bestAngle = angleToXAxis;
    }
  }

  // If needed, rotate by another 90 degree to ensure xExtent < yExtent.
  // Note that this doesn't change the area
  if (minExtent.x > minExtent.y) {
    bestAngle += THREE.Math.degToRad(90.0);
  }

  // Compute final quaternion
  quaternion.setFromAxisAngle(zAxis, bestAngle);
  return quaternion;
};

// Computes a rotation transform for a given dbId that aligns the object horizontally, so that:
//  - xy extent of the bbox is minimized
//  - xExtent <= yExtent
// @returns {Quaternion}
const computeObjectAlignment = (model, dbId) => {

  // project the main axes of all fragment geometry boxes to world-space
  const axes = collectFragBoxAxes(model, dbId); // {Vector3[]} with two vectors per edge

  // find rotation that minimizes the x/y-bbox of all transformed boxes
  return findAlignmentRotation(axes);
};

const tmpMatrix = new THREE.Matrix4();
const tmpMatrix2 = new THREE.Matrix4();

// Returns the bbox that we obtain when applying the given rotationMatrix
// to the given fragment as animation transform, i.e., applied after world matrix.
const getRotatedFragmentBox = (model, fragId, rotMatrix, optionalTarget) => {

  const result = optionalTarget || new THREE.Box3();

  const fragList = model.getFragmentList();
  const geomList = model.getGeometryList();

  // Get fragment worldMatrix. Note that we don't want it to be affected by current animation state.
  const worldMatrix = tmpMatrix;
  fragList.getOriginalWorldMatrix(fragId, worldMatrix);

  // Apply worldMatrix then rotMatrix
  const fullMatrix = tmpMatrix2.copy(rotMatrix).multiply(worldMatrix);

  // Get geometry bbox in object-space (for otg, it will simply be the unit box)
  const geomId = fragList.getGeometryId(fragId);
  geomList.getModelBox(geomId, result);

  // Applying a matrix turns an empty box into an infinite one. So, we must skip it for empty boxes
  if (!result.isEmpty()) {
    // Apply combined matrix to geometry box.
    // Note that we cannot simply rotate the fragment's worldBox here, because
    // this would sometimes result in an unnecessary large bbox.
    result.applyMatrix4(fullMatrix);
  }

  return result;
};

// Given a list of fragment ids and an addtional transform to be applied to each of those,
// this function computes the resulting bbox when applying fragment worldMatrix + given transform to each
// fragment geometry.
//
//  @param {Model}   model
//  @param {dbId}    dbId
//  @param {Matrix4} matrix
const computeTransformedObjectBox = (model, dbId, matrix) => {

  const summedBox = new THREE.Box3();
  const tmpBox = new THREE.Box3();

  // For each fragment...
  const it = model.getObjectTree();
  it.enumNodeFragments(dbId, (fragId) => {
    // add aligned box of this fragment
    const fragBox = getRotatedFragmentBox(model, fragId, matrix, tmpBox);
    summedBox.union(fragBox);
  });

  return summedBox;
};

// Computes for each object an alignment rotation with the goal that...
//  - x/y extent is minimized
//  - z-axis is preserved
//  - xExtent <= yExtent
class RotationAlignment {

  // @param {Model[]}
  constructor(models) {

    // Index modely by modelId
    this.modelsById = [];
    models.forEach((m) => this.modelsById[m.id] = m);

    // Caches of rotations and bboxes for rotated shapes
    this.rotations = []; // {Quaternion[][]}
    this.boxes = []; // {Box3[][]} - boxes of rotated fragments

    // Reused tmp matrix
    this.rotMatrix = new THREE.Matrix4();
  }

  // Store alignment rotation and bbox for a shape in cache
  _addToCache(modelId, dbId, rotation, bbox) {

    // Get or create arrays for cached rotations and boxes for this model
    let modelRotations = this.rotations[modelId];
    let modelBoxes = this.boxes[modelId];
    if (!this.rotations[modelId]) {
      // first rotation for this model => create new array
      modelRotations = [];
      modelBoxes = [];
      this.rotations[modelId] = modelRotations;
      this.boxes[modelId] = modelBoxes;
    }

    // store rotation and bbox in cache
    modelRotations[dbId] = rotation;
    modelBoxes[dbId] = bbox;
  }

  // Make sure that rotation and rotated box are in cache
  _computeAlignmentAndBox(modelId, dbId) {

    // Skip if already cached
    if (this._isInCache(modelId, dbId)) {
      return;
    }

    // compute Quaternion to align the shape
    const model = this.modelsById[modelId];
    const rotation = computeObjectAlignment(model, dbId);

    // compute bbox that we get after rotation
    this.rotMatrix.makeRotationFromQuaternion(rotation);
    const box = computeTransformedObjectBox(model, dbId, this.rotMatrix);

    // Store both for next time
    this._addToCache(modelId, dbId, rotation, box);

    return box;
  }

  // Check if alignment transform and bbox are already computed
  _isInCache(modelId, dbId) {
    const modelBoxes = this.boxes[modelId];
    return Boolean(modelBoxes && modelBoxes[dbId]);
  }

  // Get resulting bbox that a shape has - assuming that the alignment rotation was already applied.
  //
  // Note: We cannot simply transform the fragment world-box here, because this results in a larger
  //       bbox than transforming the geometry boxes directly to the rotated world position.
  getAlignedBox(shapeId, optionalTarget) {

    const { modelId, dbId } = shapeId;

    const result = optionalTarget || new THREE.Box3();

    // Make sure that box is in cache
    this._computeAlignmentAndBox(modelId, dbId);

    // Return box from cache
    const box = this.boxes[modelId][dbId];
    return result.copy(box);
  }

  // Returns the alignment rotation for a shape.
  // @param {ShapeId}      shapeId
  // @param {Quaternion}   [optionalTarget]
  // @returns {Quaternion}
  getShapeRotation(shapeId, optionalTarget) {

    const { modelId, dbId } = shapeId;

    const result = optionalTarget || new THREE.Quaternion();

    // Make sure that rotation is in cache
    this._computeAlignmentAndBox(modelId, dbId);

    // Return rotation from cache
    const rotation = this.rotations[modelId][dbId];
    return result.copy(rotation);
  }
};

/***/ },

/***/ "./extensions/VisualClusters/RowLayoutBuilder.js"
/*!*******************************************************!*\
  !*** ./extensions/VisualClusters/RowLayoutBuilder.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createClusterSetLayout: () => (/* binding */ createClusterSetLayout)
/* harmony export */ });
/* harmony import */ var _ClusterLayout_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ClusterLayout.js */ "./extensions/VisualClusters/ClusterLayout.js");
//
// An algorithm to computes the placement (ClusterSetLayout) for a set of object clusters.
//




// Computes the x/y extent that we obtain when lining up all shapes in a single row.
//
//  @param {bool} autoRotate - If true, we assume that each object is rotated in a way that sizeX <= sizeY.
const getRowExtent = (cluster, shapeBoxes, spacing, autoRotate) => {

  // Reused tmp vector
  let boxDiag = new THREE.Vector3();

  // Accumulated row width
  let rowSize = new THREE.Vector2();

  for (let i = 0; i < cluster.shapeIds.length; i++) {

    // get shape box diagonal
    let shapeId = cluster.shapeIds[i];
    boxDiag = shapeBoxes.getShapeSize(shapeId, boxDiag);

    // get width/height along row
    const shapeSizeX = autoRotate ? Math.min(boxDiag.x, boxDiag.y) : boxDiag.x;
    const shapeSizeY = autoRotate ? Math.max(boxDiag.x, boxDiag.y) : boxDiag.y;

    // sum up shape with along the row
    rowSize.x += shapeSizeX;

    // Track y-extent of row (determined by largest shape along y)
    rowSize.y = Math.max(rowSize.y, shapeSizeY);
    rowSize.z = Math.max(rowSize.z, boxDiag.z);
  }

  // consider spacing
  rowSize.x += (cluster.shapeIds.length - 1) * spacing;

  return rowSize;
};

// Given a list of bboxes, this function creates a ClusterLayout that stacks all items vertically.
//  @param {Cluster}    cluster
//  @param {ShapeBoxes} shapeBoxes
//  @param {number}     spacing
const createStack = (cluster, shapeBoxes, spacing) => {

  let shapeIds = cluster.shapeIds;

  let layout = new _ClusterLayout_js__WEBPACK_IMPORTED_MODULE_0__.ClusterRowLayout(cluster);

  // Track position where to add next shape
  let zOffset = 0.0;

  // Reused tmp vector
  let boxSize = new THREE.Vector3();

  // Why backwards?: Shapes are ordered by increasing size. For stacking, it looks better to start with the largest.
  for (let i = shapeIds.length - 1; i >= 0; i--) {
    let shapeId = shapeIds[i];

    // Place shape i
    layout.positions[i] = new THREE.Vector3(0, 0, zOffset);

    // Size along the row is alway min(sizeX, sizeY)
    boxSize = shapeBoxes.getShapeSize(shapeId, boxSize);

    // Track layout size
    layout.size.x = Math.max(layout.size.x, boxSize.x);
    layout.size.y = Math.max(layout.size.y, boxSize.y);
    layout.size.z = zOffset + boxSize.y;

    // Step up to next stack level
    zOffset += boxSize.z + spacing;
  }
  return layout;
};

// Given a list of bboxes, this function creates a ClusterLayout that lines them up in one or more rows.
//  @param {Cluster}    cluster
//  @param {ShapeBoxes} shapeBoxes
//  @param {number}     rowWidth
//  @param {number}     spacing
//  @param {number}     autoRotate - If true, each shape is aligned so that sizeX <= sizeY
const createRows = (cluster, shapeBoxes, rowWidth, spacing, autoRotate) => {

  let shapeIds = cluster.shapeIds;

  let layout = new _ClusterLayout_js__WEBPACK_IMPORTED_MODULE_0__.ClusterRowLayout(cluster);

  // Track position where to add next shape
  let nextPos = new THREE.Vector3(0, 0, 0);

  // Reused tmp vector
  let boxSize = new THREE.Vector3();

  // Track y-extent of current row
  let rowSizeY = 0;

  for (let i = 0; i < shapeIds.length; i++) {
    let shapeId = shapeIds[i];

    // Place shape i
    layout.positions[i] = nextPos.clone();

    // Size along the row is alway min(sizeX, sizeY)
    boxSize = shapeBoxes.getShapeSize(shapeId, boxSize);

    // If wanted, we orient all shapes so that sizeX < sizeY.
    layout.rotated[i] = autoRotate && boxSize.x > boxSize.y;

    // get shapeSize in x/y - after rotating in a way that sizeX <= sizeY
    const shapeSizeX = autoRotate ? Math.min(boxSize.x, boxSize.y) : boxSize.x;
    const shapeSizeY = autoRotate ? Math.max(boxSize.x, boxSize.y) : boxSize.y;

    // Track y-extent of current row
    rowSizeY = Math.max(rowSizeY, shapeSizeY);

    // Track overall extent of the whole layout
    layout.size.x = Math.max(layout.size.x, nextPos.x + shapeSizeX);
    layout.size.y = Math.max(layout.size.y, nextPos.y + shapeSizeY); //
    layout.size.z = Math.max(layout.size.z, boxSize.z); // max over all shape heights

    // Shift position along x to next new slot
    nextPos.x += shapeSizeX + spacing;

    // If width of current row reached the target row width...
    if (nextPos.x >= rowWidth) {
      // Start a new row
      nextPos.x = 0;
      nextPos.y += rowSizeY + spacing;
      rowSizeY = 0;
    }
  }

  return layout;
};

// Given a list of shapeIds, this function computes how these can be positioned in order to form a compact block.
//
//   @param {Cluster}    cluster    - Note: cluster.shapeIds within the claster will be sorted within this function.
//   @param {ShapeBoxes} shapeBoxes - to get shape sizes per shapeId
//   @param {bool}       autoRotate - Ensure sizeX <= sizeY for each shape by auto-rotating by 90 degree if necessary.
//   @returns {ClusterRowLayout}
const createClusterRowLayout = (cluster, shapeBoxes, spacing, autoRotate, enableStacking = true) => {

  // Sort shapes by increasing yExtent.
  //
  // When using autoRotate, we must consider that shapes will be xy-flipped, so that we
  // must sort by max{xExtent, yExtent} instead.
  //
  // Note: The autoRotate option will eventually be removed, because the rotationAlignment can already ensure xExtent <= yExtent,
  //       so that the layout algorithm can just assume it and always sort by y-extent only.
  let shapeIds = cluster.shapeIds;
  const byY = (a, b) => bySizeY(a, b, shapeBoxes);
  const byMaxXY = (a, b) => byMaxXYSize(a, b, shapeBoxes);
  const pred = autoRotate ? byMaxXY : byY;

  // Sort shapeIds
  shapeIds.sort(pred);

  // Compute x/y-extent that we would get when lining up all objects in a single row
  const singleRowSize = getRowExtent(cluster, shapeBoxes, spacing, autoRotate);

  // For simplicity and performance, the code below is just a heuristic: We neglect the fact
  // that y-extents of rows may be varying. So, depending on the variance of y-extents
  // we may not get an actual squre. However, at least we usually avoid to odd aspect ratios.
  //
  // We would like to choose the number of rows in a way that the cluster gets approximately squared.
  // Given n rows, we would approximately obtain a cluster for which...
  //  - sizeX = singleRowSizeX / numRows
  //  - sizeY = singleRowSizeY * numRows
  //
  // To get it approximately square, we choose so that
  //    sizeX = sizeY
  //
  const numRows = Math.sqrt(singleRowSize.x / singleRowSize.y);
  const rowWidth = singleRowSize.x / numRows;

  const rows = createRows(cluster, shapeBoxes, rowWidth, spacing, autoRotate);

  // For large flat shapes (like floors/ceilings), it may be better to just stack them on top of each other.
  // So, we try stacking them as well.
  if (enableStacking) {
    const stack = createStack(cluster, shapeBoxes, spacing);

    // If the stack height is smaller than the horizonal extent, we use the stack.
    const useStack = stack.size.z < Math.max(rows.size.x, rows.size.y);
    if (useStack) {
      return stack;
    }
  }

  return rows;
};

// Sort predicate to order objects by increasing y-extent
// Input:
//   @param {ShapeId}    a          - shapeID a
//   @param {ShapeId}    b          - shapeID b
//   @param {ShapeBoxes} shapeBoxes - shape sizes per shapeId
//
// Output: -1, if the max extent of object a is greater than of object b
//          1, otherwise
const bySizeY = (a, b, shapeBoxes) => {

  // Get bbox extents
  const diagA = shapeBoxes.getShapeSize(a);
  const diagB = shapeBoxes.getShapeSize(b);

  // If y-extent is different, use it
  if (diagA.y != diagB.y) {
    return diagA.y - diagB.y;
  }

  // Among shapes with equal y-extent, sort by increasing x-extent
  if (diagA.x != diagB.x) {
    return diagA.x - diagB.x;
  }

  return 0;
};


// Sort predicate to order objects by increasing maxXYExtent (=max(xExtent, yExtent)).
// Input:
//   @param {ShapeId}    a          - shapeID a
//   @param {ShapeId}    b          - shapeID b
//   @param {ShapeBoxes} shapeBoxes - shape sizes per shapeId
//
// Output: -1, if the max extent of object a is greater than of object b
//          1, otherwise
const byMaxXYSize = (a, b, shapeBoxes) => {

  // Get bbox extents
  const diagA = shapeBoxes.getShapeSize(a);
  const diagB = shapeBoxes.getShapeSize(b);

  // Sort based on the max axis extent.
  const sizeA = Math.max(diagA.x, diagA.y);
  const sizeB = Math.max(diagB.x, diagB.y);
  if (sizeA < sizeB) {
    return -1;
  } else
  if (sizeA > sizeB) {
    return 1;
  }

  // If max-entents are equal, sort by minExtent
  const minExtA = Math.min(diagA.x, diagA.y);
  const minExtB = Math.min(diagB.x, diagB.y);
  if (minExtA > minExtB) {
    return -1;
  } else if (minExtA < minExtB) {
    return 1;
  }

  // If min/max extents are both equal, just sort by id for consistency
  return b - a;
};

// Given a set of individual ClusterRowLayouts, this function sets their positions, so that clusters are lined up in a grid or stack as well.
//
//  @param {ClusterRowLayout[]} layouts
//  @param {number}             clusterSpacing - Minimum distance between two clusters
//  @param {Box3}               sceneBox       - bbox of the full scene (without anim transforms)
const setClusterPositions = (layouts, clusterSpacing, sceneBox) => {

  // For placing the clusters, we use the same code that we used for arranging the shapes within
  // the cluster.
  //
  // Only difference is that the shapes to be placed are actually clusters instead of shapes.

  const parentCluster = {
    // In this case, shapeIds are just indices into the layouts array
    shapeIds: new Int32Array(layouts.length)
  };

  // Enlist all cluster indices 0, 1, ..., layouts.length-1.
  for (let i = 0; i < layouts.length; i++) {
    parentCluster.shapeIds[i] = i;
  }

  // ShapeBoxes access when using clusters as shapes.
  const clusterBoxes = {
    // Return cluster size
    getShapeSize: (shapeId, target) => {
      target = target || new THREE.Vector3();
      const layout = layouts[shapeId];
      target.copy(layout.size);
      return target;
    }
  };

  // We only align single shapes, but don't rotate clusters. Note that the aspect ratio
  const autoRotate = false;

  // Run layout to place the clusters
  const enableStacking = false; // We only use stacking inside clusters. But the clusters themselves are always layouted horizontally.
  const parentLayout = createClusterRowLayout(parentCluster, clusterBoxes, clusterSpacing, autoRotate, enableStacking);

  // Parent cluster should be horizonally centered at the scene midpoint
  let origin = sceneBox.getCenter(new THREE.Vector3());

  origin.x -= 0.5 * parentLayout.size.x;

  // Start the flea-market behind the actual building
  origin.y = sceneBox.min.y + 1.1 * (sceneBox.max.y - sceneBox.min.y);

  // Copy positions from parent clusterLayout to the individual cluster positions
  for (let i = 0; i < parentCluster.shapeIds.length; i++) {
    // get position for next cluster
    const clusterPos = parentLayout.positions[i];

    // Find the corresponding cluster
    const clusterIndex = parentCluster.shapeIds[i];
    const layout = layouts[clusterIndex]; // Note that shapeIds is reordered during layout process. So we cannot assume shapeIds[i]==i anymore

    // set cluster position
    layout.position.copy(clusterPos).add(origin);
  }
};

const getDefaultOptions = () => {
  return {
    // minimum distance between two shapes within a group
    spacing: 1.0,

    // minimum distance between different groups
    clusterSpacing: 10.0,

    // If true, we stack clusters vertically - otherwise, we line up along x/y
    stackClusters: true
  };
};

// Computes a ClusterSetLayout from a set of object clusters.
//
// @param {Cluster[]}         layouts    - Each shape group is given by an array of shapeIds
// @param {ShapeBoxes}        shapeBoxes - Provides bboxes per shape
// @param {RotationAlignment} [rotationAlignment] - Defines rotations per shape (optional)
// @param {Object}            options    - configuration params (see getDefaultOptions)
// @returns {ClusterSetLayout}
const createClusterSetLayout = (clusters, shapeBoxes, rotationAlignment, options = getDefaultOptions()) => {

  // When using pre-rotated shapes, the algorithm doesn't need to flipXY for items anymore.
  const enableXYFlip = !rotationAlignment;

  // Create layout for each cluster
  const layouts = clusters.map((c) => createClusterRowLayout(c, shapeBoxes, options.spacing, enableXYFlip));

  // Based on layouts and known cluster sizes, determine the placement of each cluster
  //setClusterPositions(layouts, shapeBoxes, options.stackClusters, options.clusterSpacing);
  setClusterPositions(layouts, options.clusterSpacing, shapeBoxes.sceneBox);

  return new _ClusterLayout_js__WEBPACK_IMPORTED_MODULE_0__.ClusterSetLayout(layouts, rotationAlignment);
};



/***/ },

/***/ "./extensions/VisualClusters/ShapeBoxes.js"
/*!*************************************************!*\
  !*** ./extensions/VisualClusters/ShapeBoxes.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ ShapeBoxes)
/* harmony export */ });

const getSummedModelBox = (models) => {
  let bbox = new THREE.Box3();
  for (let i = 0; i < models.length; i++) {
    const modelBox = models[i].getBoundingBox();
    bbox.union(modelBox);
  }
  return bbox;
};

// Helper class to faciliate access to shape bboxes across multiple models
class ShapeBoxes {

  // @param {bool} [rotationAlignment] - If specified, we don't return the original fragment boxes. Instead, we return the boxes obtained
  //                                     assuming that an alignment rotation has been applied to each shape. (see RotationAlignment.js for details)
  constructor(models, rotationAlignment) {

    // Index modely by modelId
    this.modelsById = [];
    models.forEach((m) => this.modelsById[m.id] = m);

    // reused for bbox access
    this.tmpFloat6 = new Float32Array(6);
    this.tmpBox = new THREE.Box3();

    // Compute summed scene box. Note that sceneBox is always the original scene bbox - not considering alignment rotations per object.
    this.sceneBox = getSummedModelBox(models);

    // {RotationAlignment}
    this.rotationAlignment = rotationAlignment;
  }

  // Return shapeBox that we obtain when not applying any rotationAlignment.
  // @param {ShapeId} shapeId
  // @param {Box3}    [optionalTarget]
  getUnrotatedShapeBox(shapeId, optionalTarget) {
    const box = optionalTarget || new THREE.Box3();

    const { modelId, dbId } = shapeId;

    // get instanceTree
    const model = this.modelsById[modelId];
    const it = model.getObjectTree();

    // get box as 6 floats in tmpArray
    it.getNodeBox(dbId, this.tmpFloat6);

    // convert to Box3
    const values = this.tmpFloat6;
    box.min.set(values[0], values[1], values[2]);
    box.max.set(values[3], values[4], values[5]);

    return box;
  }

  // @param {ShapeId} shapeId
  // @param {Box3}    [optionalTarget]
  getShapeBox(shapeId, optionalTarget) {

    // If shapes are rotated, we must return the bboxes of the rotated shapes instead
    // of the original fragment boxes.
    // It would be nice if AlignmentRotation could simply provide only the rotations and ShapeBoxes
    // apply them to the fragment boxes. Unfortunately, this would not work, because it would unnecessarily
    // increase the bbox sizes. So, RotationAlignment has to provide own bboxes that are computed by transforming the geometry boxes directly.
    if (this.rotationAlignment) {
      return this.rotationAlignment.getAlignedBox(shapeId, optionalTarget);
    }

    // No rotation applied - just use original boxes.
    return this.getUnrotatedShapeBox(shapeId, optionalTarget);
  }

  // get shape box diagonal from a given ShapeId
  getShapeSize(shapeId, optionalTarget) {
    const target = optionalTarget || new THREE.Vector3();

    const box = this.getShapeBox(shapeId, this.tmpBox);

    // For empty boxes, the diagonal contains -infinity - which isn't helpful for layouting.
    // So, we return zero extent for this case.
    if (box.isEmpty()) {
      target.set(0, 0, 0);
    } else {
      box.getSize(target);
    }
    return target;
  }
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
/*!*****************************************************!*\
  !*** ./extensions/VisualClusters/VisualClusters.js ***!
  \*****************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ VisualClustersExtension)
/* harmony export */ });
/* harmony import */ var _Cluster_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Cluster.js */ "./extensions/VisualClusters/Cluster.js");
/* harmony import */ var _RowLayoutBuilder_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./RowLayoutBuilder.js */ "./extensions/VisualClusters/RowLayoutBuilder.js");
/* harmony import */ var _AnimController_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./AnimController.js */ "./extensions/VisualClusters/AnimController.js");
/* harmony import */ var _ShapeBoxes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./ShapeBoxes.js */ "./extensions/VisualClusters/ShapeBoxes.js");
/* harmony import */ var _AnimState_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./AnimState.js */ "./extensions/VisualClusters/AnimState.js");
/* harmony import */ var _ClusterGizmo_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./ClusterGizmo.js */ "./extensions/VisualClusters/ClusterGizmo.js");
/* harmony import */ var _RotationAlignment_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./RotationAlignment.js */ "./extensions/VisualClusters/RotationAlignment.js");











const av = Autodesk.Viewing;
const avu = av.UI;

const namespace = AutodeskNamespace('Autodesk.Viewing.Extensions.VisualClusters');

// Name of the animation state that organizes all objects in clusters based on Category attribute.
const ClusteredStateName = 'ByCategory';

const createClusterIcon = () => {
  return [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 143 135">',
  '<g fill="currentColor">',
  '<polygon points="29.275 51 9.725 51 0 68.05 9.725 85 29.275 85 39 68.05"/>',
  '<polygon points="133.275 51 113.725 51 104 68.05 113.725 85 133.275 85 143 68.05"/>',
  '<polygon points="89.05 0 55.05 0 38 29.55 55.05 59 89.05 59 106 29.55"/>',
  '<polygon points="89.05 76 55.05 76 38 105.45 55.05 135 89.05 135 106 105.45"/>',
  '</g>',
  '</svg>'].
  join('');
};

// Create a clustering layout that forms clusters of objects based on Category attribute.
const createDefaultLayout = async (models, alignShapeRotation, attribName, searchAncestors) => {

  // Make sure that we only work on supported models
  const modelSupported = (model) => model.is3d() && Boolean(model.getObjectTree());
  models = models.filter(modelSupported);

  // build clusters
  let clusters = await (0,_Cluster_js__WEBPACK_IMPORTED_MODULE_0__.buildClustersFromAttribute)(models, attribName, searchAncestors);

  // Exclude topography & rooms
  const filter = (c) => c.name != 'Revit Topography' && c.name != 'Revit Rooms' && c.name != 'Revit <Sketch>';
  clusters = clusters.filter(filter);

  // Use RotationLayout to orient all shapes in a way that the projected x/y-extent is small
  const rotationAlignment = alignShapeRotation ? new _RotationAlignment_js__WEBPACK_IMPORTED_MODULE_6__.RotationAlignment(models) : null;

  // Create helper for bbox access
  const shapeBoxes = new _ShapeBoxes_js__WEBPACK_IMPORTED_MODULE_3__["default"](models, rotationAlignment);

  // Compute layouts
  return (0,_RowLayoutBuilder_js__WEBPACK_IMPORTED_MODULE_1__.createClusterSetLayout)(clusters, shapeBoxes, rotationAlignment);
};

/**
 * Purpose of VisualClusters extension is to group objects into clusters.
 *
 * This means:
 *  1. Categories: Form categories by assigning each shape in a model (or multiple) to a unique category, e.g. based on values of a database property.
 *  2. Layout:     Compute a "layout" that places all shapes in a way that shapes of the same group are located closeby.
 *  3. Animation:  Animate between original shape positions and new positions according to cluster layout.
 *
 * Example: By default, the clustering extension forms clusters based on the "Category" Given a building model and 2 groups - windows and doors - the result is that all windows and doors are moved away from their
 *          original positions, so that you have one cluster of windows and one cluster of doors located outside the original building.
 *
 * The extension id is: `Autodesk.VisualClusters`
 *
 * @example
 *   viewer.loadExtension('Autodesk.VisualClusters')
 *
 *   If you have a 3D model with propertyDb loaded, you should now see a button in the toolbar to trigger clustering based on Category attribute.
 *
 * @memberof Autodesk.Viewing.Extensions
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @constructor
*/
class VisualClustersExtension extends av.Extension {
  constructor(viewer, options) {
    super(viewer, options);

    // If true, the toggle button for the layout is pressed and all objects
    // are arranged in clusters (or being computed or animating towards that state)
    this.layoutActive = false;

    // Used to detect if an async layout computation is meanwhile outdated.
    this.layoutTimeStamp = 0;

    // Controls transitions between clustered and original state
    this.animController = new _AnimController_js__WEBPACK_IMPORTED_MODULE_2__["default"](this.viewer);

    // Controls gizmos and labels for clusters
    this.gizmoController = new _ClusterGizmo_js__WEBPACK_IMPORTED_MODULE_5__.ClusterGizmoController(this.viewer);

    // Bind event listener callbacks
    this.onModelAddedCb = this.onModelAdded.bind(this);
    this.onModelRemovedCb = this.onModelRemoved.bind(this);
    this.dbLoadedCb = this.onDbLoaded.bind(this);
    this.onTransitionEndedCb = this.onTransitionEnded.bind(this);
  }

  async load() {

    await this.viewer.loadExtension('Autodesk.Edit3D');

    if (this.options.skipDefaultListeners) {
      return true;
    }

    this.viewer.addEventListener(av.MODEL_ADDED_EVENT, this.onModelAddedCb);
    this.viewer.addEventListener(av.MODEL_REMOVED_EVENT, this.onModelRemovedCb);
    this.viewer.addEventListener(av.OBJECT_TREE_CREATED_EVENT, this.dbLoadedCb);
    this.viewer.addEventListener(av.ANIM_ENDED, this.onTransitionEndedCb);
    return true;
  }

  unload() {
    if (!this.options.skipDefaultListeners) {
      this.viewer.removeEventListener(av.MODEL_ADDED_EVENT, this.onModelAddedCb);
      this.viewer.removeEventListener(av.MODEL_REMOVED_EVENT, this.onModelRemovedCb);
      this.viewer.removeEventListener(av.OBJECT_TREE_CREATED_EVENT, this.onDbLoaded);
      this.viewer.removeEventListener(av.ANIM_ENDED, this.onTransitionEndedCb);
    }

    // Revert all anim transform changes.
    this.animController.reset();

    this._destroyUI();
    return true;
  }

  // Reset to initial state.
  reset() {
    this.animController.reset();
    this.gizmoController.reset();
    this.layoutActive = false;
    this.updateButton();
  }

  onModelAdded() {
    this.updateButton();
  }

  onModelRemoved() {
    this.updateButton();

    // Auto-reset: When reset all animation transforms and extension state.
    // This avoids leaking any state information when switching between views.
    //
    // Note: When temporarily switching all models off in a multi-model scenario, auto-reset might
    //       not be wanted. If we need to support that case, we need a concept to tell the extension
    //       explicitly whether a view-switch occurred or leave the reset to the client.
    const lastModelRemoved = !this.viewer.getVisibleModels().length;
    if (lastModelRemoved) {
      this.reset();
    }
  }

  onDbLoaded() {
    this.updateButton();
  }

  onToolbarCreated() {
    if (this.options.skipDefaultButton) {
      return;
    }

    this.clusterButton = new avu.Button("toolbar-clusterTool");
    this.clusterButton.icon.innerHTML = createClusterIcon();

    // add button to toolbar section 'Model Tools'
    let toolbar = this.viewer.getToolbar && this.viewer.getToolbar();
    if (toolbar) {
      let modelTools = toolbar.getControl(av.TOOLBAR.MODELTOOLSID);

      // Add our button to the toolbar
      if (modelTools) {
        modelTools.addControl(this.clusterButton);
      }
    }

    this.clusterButton.onClick = () => {
      this.setLayoutActive(!this.layoutActive);
    };

    this.updateButton();
  }

  onTransitionStarted() {
    // check if animation state is available and whether there are clusters
    // (models with clusters have an animStates array with length bigger than 0)
    if (ClusteredStateName in this.animController.states &&
    this.animController.states[ClusteredStateName].animStates.filter(Boolean)[0].animStates.length > 0) {
      this.viewer.fireEvent({ type: av.TRANSITION_STARTED, sceneAnimState: this.animController.states[ClusteredStateName] });
    } else {
      this.viewer.fireEvent({ type: av.TRANSITION_STARTED, sceneAnimState: null });
    }
  }

  onTransitionEnded() {
    if (ClusteredStateName in this.animController.states &&
    this.animController.states[ClusteredStateName].animStates.filter(Boolean)[0].animStates.length > 0) {
      this.viewer.fireEvent({ type: av.TRANSITION_ENDED, sceneAnimState: this.animController.states[ClusteredStateName] });
    } else {
      this.viewer.fireEvent({ type: av.TRANSITION_ENDED, sceneAnimState: null });
    }
  }

  _destroyUI() {
    // Remove button from toolbar
    if (this.clusterButton) {
      const toolbar = this.viewer.getToolbar && this.viewer.getToolbar();
      const modelTools = toolbar && toolbar.getControl(av.TOOLBAR.MODELTOOLSID);
      if (modelTools) {
        modelTools.removeControl(this.clusterButton);
      }
      this.clusterButton = null;
    }
    this.setLayoutActive(false);
  }

  setLayoutActive(active, attributeName) {
    if (this.layoutActive === active) {
      return;
    }

    // Indicate that layout is activated
    this.layoutActive = active;

    this.updateButton();

    // Layout disabled: Animate back to original state
    if (!active) {
      this.onTransitionStarted();
      this.animController.animateTo(null);
      this.gizmoController.onLayoutChanged(null);
      return;
    }

    this.applyLayout(attributeName);
  }

  async applyLayout(attributeName) {

    // get currently visible/loaded models
    const models = this.viewer.getVisibleModels();

    // If a layout computation is active, mark it as outdated.
    this.layoutTimeStamp++;

    // Remember timestamp so that we can check later if result is still wanted
    const layoutTimeStamp = this.layoutTimeStamp;

    const sceneLayout = this.customSceneLayout ?
    this.customSceneLayout :
    await createDefaultLayout(
      models,
      true,
      attributeName ? attributeName : this.options.attribName,
      this.options.searchAncestors
    );

    // If this.layoutTimeStamp has changed, the result is outdated.
    if (!this.layoutActive || layoutTimeStamp !== this.layoutTimeStamp) {
      return;
    }

    this.sceneLayout = sceneLayout;

    // Create animation state that represents this layout
    this.sceneAnimState = sceneLayout.createSceneState(models);

    // Make animation state available
    this.animController.registerState(ClusteredStateName, this.sceneAnimState);

    this.onTransitionStarted();

    // Animate to clustered layout
    this.animController.animateTo(ClusteredStateName);
    this.gizmoController.onLayoutChanged(this.sceneLayout);
  }

  updateButton() {
    if (!this.clusterButton) {
      return;
    }

    const models = this.viewer.getVisibleModels();

    // Only show button if we have >=1 3D model. Note that we cannot rely on this.viewer.impl.is2d, because it
    // is set after addModel event is fired.
    const showButton = models.some((model) => model.is3d());
    this.clusterButton.setVisible(showButton);
    if (!showButton) {
      return;
    }

    // Disable button if some propDb is still loading or if we don't have any propDb at all.
    const propDbLoading = (model) => model.getPropertyDb() && !model.getPropertyDb().isLoadDone();
    const propDbMissing = (model) => !propDbLoading(model) && !model.getObjectTree();
    const waitForDb = models.some(propDbLoading);
    const noPropDb = models.some(propDbMissing);
    const disable = waitForDb || noPropDb;

    // Choose button tooltip. If we disable, explain why.
    let tooltip = 'Form Clusters by Category';
    if (disable) {
      tooltip = waitForDb ? 'Waiting for database to load' : 'Visual Clustering can only be used if a database is available';
    }
    this.clusterButton.setToolTip(tooltip);

    // Set button state
    if (disable) {
      this.clusterButton.setState(avu.Button.State.DISABLED);
    } else {
      this.clusterButton.setState(this.layoutActive ? avu.Button.State.ACTIVE : avu.Button.State.INACTIVE);
    }
  }
}

av.theExtensionManager.registerExtension('Autodesk.VisualClusters', VisualClustersExtension);

namespace.buildClustersFromAttribute = _Cluster_js__WEBPACK_IMPORTED_MODULE_0__.buildClustersFromAttribute;
namespace.Cluster = _Cluster_js__WEBPACK_IMPORTED_MODULE_0__.Cluster;
namespace.createShapeId = _Cluster_js__WEBPACK_IMPORTED_MODULE_0__.createShapeId;
namespace.createClusterSetLayout = _RowLayoutBuilder_js__WEBPACK_IMPORTED_MODULE_1__.createClusterSetLayout;
namespace.ShapeBoxes = _ShapeBoxes_js__WEBPACK_IMPORTED_MODULE_3__["default"];
namespace.AnimConstroller = _AnimController_js__WEBPACK_IMPORTED_MODULE_2__["default"];
namespace.hasVisibleFragments = _Cluster_js__WEBPACK_IMPORTED_MODULE_0__.hasVisibleFragments;
namespace.ObjectAnimState = _AnimState_js__WEBPACK_IMPORTED_MODULE_4__.ObjectAnimState;
namespace.ModelAnimState = _AnimState_js__WEBPACK_IMPORTED_MODULE_4__.ModelAnimState;
namespace.SceneAnimState = _AnimState_js__WEBPACK_IMPORTED_MODULE_4__.SceneAnimState;
namespace.getBoxCorner = _RotationAlignment_js__WEBPACK_IMPORTED_MODULE_6__.getBoxCorner;
namespace.findAlignmentRotation = _RotationAlignment_js__WEBPACK_IMPORTED_MODULE_6__.findAlignmentRotation;
namespace.computeObjectAlignment = _RotationAlignment_js__WEBPACK_IMPORTED_MODULE_6__.computeObjectAlignment;
namespace.RotationAlignment = _RotationAlignment_js__WEBPACK_IMPORTED_MODULE_6__.RotationAlignment;
})();

Autodesk.Extensions.VisualClusters = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=VisualClusters.js.map