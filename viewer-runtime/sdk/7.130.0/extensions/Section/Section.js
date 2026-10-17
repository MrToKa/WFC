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

/***/ "./extensions/Section/SectionTool.js"
/*!*******************************************!*\
  !*** ./extensions/Section/SectionTool.js ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SectionTool: () => (/* binding */ SectionTool)
/* harmony export */ });
/* harmony import */ var lodash_es__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! lodash-es */ "./node_modules/lodash-es/debounce.js");



// Declared at the bottom, inside a function.
var SectionMeshClass = null;
var avp = Autodesk.Viewing.Private;

/**
 * Creates the material for a section cap mesh, derived from the material of the object
 * being cut.
 *
 * Prism and other custom-shader materials render via a per-material shader variant. A flat
 * cap has no UVs and discards all of the source material's texturing anyway, so on WebGPU we
 * do not clone them: cloning dragged the strict WGSL shader-variant system into the cap path
 * and crashed with "[wgpu] Missing value for ..." when a required $TOKEN (e.g.
 * $USE_SURFACE_ALBEDO_MAP) was absent. Instead we use a plain default phong material (uber
 * pipeline, supports hatching). All other materials, and the whole WebGL path, keep the
 * original clone behaviour.
 */
function createCapMaterial(matman, material, model) {
  var useFixedCap = avp.USE_WEBGPU && material.needsCustomPipeline;
  if (useFixedCap) {
    return matman.cloneMaterial(matman.defaultMaterial, model);
  }

  var clone = matman.cloneMaterial(material, model);
  // WebGL prism: GLSL treats undefined macros as false, so a minimal defines set is fine.
  // (WebGPU prism/custom-shader materials are handled by the fixed-cap branch above.)
  if (clone.prismType != null) {
    clone.defines = {};
    clone.defines[clone.prismType.toUpperCase()] = "";
    if (clone.prismType == "PrismWood") {
      clone.defines["NO_UVW"] = "";
    }
  }
  return clone;
}

/**
 * Tool that provides visual controls for the user to change the cutplane's position and angle.
 * It can (and should) be hooked to [ToolController's registerTool]{@Autodesk.Viewing.ToolController#registerTool}
 *
 * The tool can operate in a rotated coordinate system to align cutplanes and boxes for example with the project
 * north instead of true north. Cutplanes, normals etc. are internally managed in local space to align with canonical axes.
 * Therefore the coordinate system transformation has to be applied when passing values in and out.
 * By default alignment with project north of the first 3D model is used if loaded with 'applyRefPoint=true', true north otherwise.
 *
 * @param {Autodesk.Viewing.Viewer3D} viewer - Viewer3D instance
 * @param {Object} config - Configuration values
 * @param {Object} options.tintColor - Object containing attributes r, g, b in the range [0..1]
 * @param {Number} options.tintIntensity - Value range [0..1]
 * @param {Number} [options.gizmoOffsetRight] - Right bound for the gizmo position in pixel
 * @param {Number} [options.gizmoOffsetLeft] - Left bound for the gizmo position in pixel
 * @param {Number} [options.gizmoOffsetTop] - Top bound for the gizmo position in pixel
 * @param {Number} [options.gizmoOffsetBottom] - Bottom bound for the gizmo position in pixel
 * @constructor
 */
var SectionTool = function (viewer, options)
{
  var _viewer = viewer.impl;

  var _names = ["section"];
  var _active = false;

  var _isDragging = false;
  var _boxChanged = false;
  var _isPlaneOn = true;
  var _tintColor = options.tintColor;
  var _tintIntensity = options.tintIntensity;

  var _transRotControl;
  var _transControl;
  var _gizmoOffsetRight = isNaN(options.gizmoOffsetRight) ? 200 : options.gizmoOffsetRight; // 200 So the gizmo won't be covered by the View Cube.
  var _gizmoOffsetLeft = isNaN(options.gizmoOffsetLeft) ? 80 : options.gizmoOffsetLeft;
  var _gizmoOffsetTop = isNaN(options.gizmoOffsetTop) ? 80 : options.gizmoOffsetTop;
  var _gizmoOffsetBottom = isNaN(options.gizmoOffsetBottom) ? 80 : options.gizmoOffsetBottom;
  var _controlOffset = new THREE.Vector3();
  var _controlNewPosition = new THREE.Vector3();

  var _sectionGroups = [];
  var _sectionPlanes = [];
  var _sectionPicker = [];
  var _activeMode = "";
  var _overlayName = "gizmo";
  var _touchType = null;
  var _initialized = false;
  var _visibleAtFirst = true;
  var _outlineIndices = [
  0, 1,
  1, 3,
  3, 2,
  2, 0];

  var _priority = 70;
  var _selectionOpacity = 0.25;
  var _selectionColor = 0x287EEA;

  var _displaySectionHatches = true;

  let _transform, _inverseTransform, _normalMatrix, _inverseNormalMatrix;

  let _auxVec3 = new THREE.Vector3();

  /**
   * Stores a custom transform to apply to the section planes and gizmos
   * @param {THREE.Matrix4} transform - Transformation
   */
  function setTransform(transform) {
    _transform = transform;
    _inverseTransform = _transform.clone().invert();
    _normalMatrix = new THREE.Matrix3().getNormalMatrix(_transform);
    _inverseNormalMatrix = new THREE.Matrix3().getNormalMatrix(_inverseTransform);
  }

  /**
   * If the RefPoint transform is applied to the first model (we ignore other models at the moment), we return
   * the rotational part of it to align the section planes to project north. Otherwise we return an identity transform
   * to align with true north.
   *
   * @returns {THREE.Matrix4} Transformation matrix
   */
  function getDefaultTransform() {
    let transform = new THREE.Matrix4();

    const first3DModelData = _viewer.get3DModels()[0]?.getData();
    if (first3DModelData && first3DModelData.loadOptions?.applyRefPoint && first3DModelData.refPointTransform) {
      const refPointTransform = first3DModelData.refPointTransform;

      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      refPointTransform.decompose(position, quaternion, scale);

      transform.makeRotationFromQuaternion(quaternion);
    }

    return transform;
  }

  setTransform(getDefaultTransform());

  const sendAnalyticsDebounced = (0,lodash_es__WEBPACK_IMPORTED_MODULE_0__["default"])((from, type, action) => {
    avp.analytics.track('viewer.section', {
      from: from,
      type: type,
      action: action
    });
  }, 2000);

  init_SectionMesh();

  function initControl() {

    if (_initialized) {
      // Verify overlays are added.
      _viewer.addOverlay(_overlayName, _transRotControl);
      _viewer.addOverlay(_overlayName, _transControl);
      return;
    }

    _transRotControl = new avp.TransformControls(_viewer.camera, _viewer.canvas, "transrotate");
    _transRotControl.addEventListener('change', updateViewer);
    _transRotControl.setSnap(Math.PI / 2, Math.PI / 36); // snap to 90 degs within 5 degs range

    _transControl = new avp.TransformControls(_viewer.camera, _viewer.canvas, "translate");
    _transControl.addEventListener('change', updateViewer);
    _transControl.addEventListener('change', adjustGizmoToBounds);

    // add to overlay scene
    if (_viewer.overlayScenes[_overlayName] === undefined) {
      _viewer.createOverlayScene(_overlayName);
    }
    _viewer.addOverlay(_overlayName, _transRotControl);
    _viewer.addOverlay(_overlayName, _transControl);

    viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, updateControls);
    viewer.addEventListener(Autodesk.Viewing.ISOLATE_EVENT, updateSections);
    viewer.addEventListener(Autodesk.Viewing.HIDE_EVENT, updateSections);
    viewer.addEventListener(Autodesk.Viewing.SHOW_EVENT, updateSections);
    viewer.addEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, updateSections);
    viewer.addEventListener(Autodesk.Viewing.FRAGMENTS_LOADED_EVENT, updateSections);
    viewer.addEventListener(Autodesk.Viewing.FRAGMENTS_UNLOADED_EVENT, updateSections);
    viewer.addEventListener(Autodesk.Viewing.SCENE_UPDATED_EVENT, onSceneUpdated);

    _initialized = true;
  }

  function deinitControl() {

    if (!_initialized)
    return;

    _viewer.removeOverlay(_overlayName, _transRotControl);
    _transRotControl.removeEventListener('change', updateViewer);
    _transRotControl.dispose();
    _transRotControl = null;
    _viewer.removeOverlay(_overlayName, _transControl);
    _transControl.removeEventListener('change', updateViewer);
    _transControl.removeEventListener('change', adjustGizmoToBounds);
    _transControl.dispose();
    _transControl = null;
    _viewer.removeOverlayScene(_overlayName);

    viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, updateControls);
    viewer.removeEventListener(Autodesk.Viewing.ISOLATE_EVENT, updateSections);
    viewer.removeEventListener(Autodesk.Viewing.HIDE_EVENT, updateSections);
    viewer.removeEventListener(Autodesk.Viewing.SHOW_EVENT, updateSections);
    viewer.removeEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, updateSections);
    viewer.removeEventListener(Autodesk.Viewing.FRAGMENTS_LOADED_EVENT, updateSections);
    viewer.removeEventListener(Autodesk.Viewing.FRAGMENTS_UNLOADED_EVENT, updateSections);
    viewer.removeEventListener(Autodesk.Viewing.SCENE_UPDATED_EVENT, onSceneUpdated);

    _initialized = false;
  }

  function updateViewer() {
    _viewer.invalidate(false, false, true);
  }

  function updateControls() {

    adjustGizmoToBounds();

    if (_transRotControl) {
      _transRotControl.update();
    }
    if (_transControl) {
      _transControl.update();
    }
  }

  /**
   * Clamp position to screen bounds
   * @param {THREE.Vector3} position - Position in world space to test
   * @returns {THREE.Vector3|undefined} Clamped if position was out of bounds, undefined otherwise
   */
  function getClampedGizmoPosition(position) {
    const client = _viewer.worldToClient(position);
    const rect = _viewer.getCanvasBoundingClientRect();
    let target = new THREE.Vector3().copy(client);

    if (client.x < _gizmoOffsetLeft) {
      target.x = _gizmoOffsetLeft;
    } else if (client.x > rect.width - _gizmoOffsetRight) {
      target.x = rect.width - _gizmoOffsetRight;
    }

    if (client.y < _gizmoOffsetTop) {
      target.y = _gizmoOffsetTop;
    } else if (client.y > rect.height - _gizmoOffsetBottom) {
      target.y = rect.height - _gizmoOffsetBottom;
    }

    return target.x !== client.x || target.y !== client.y ? target : undefined;
  }

  /**
   * Try to keep the gizmo in the valid screen bounds
   */
  function adjustGizmoToBounds() {

    if (!_transRotControl || !_transRotControl.object) {
      return;
    }

    // Adjust gizmo position if it is out of bounds
    let gizmoNewClientPos = getClampedGizmoPosition(_transRotControl.position);
    if (gizmoNewClientPos) {
      const intersection = avp.TransformControls.intersectObjects(gizmoNewClientPos.x, gizmoNewClientPos.y, [_transRotControl.object], _viewer.camera, false);
      if (intersection) {
        _transRotControl.object.getWorldPosition(_controlOffset);
        _controlNewPosition.copy(intersection.point).sub(_controlOffset);
        _transRotControl.setGizmoOffset(_controlNewPosition);
      }
    }
  }

  function updateSections() {
    if (_active && _sectionPlanes.length === 1) {
      updatePlaneMeshes(true);
      updateControls();
      updateCapMeshes(new THREE.Plane().setComponents(_sectionPlanes[0].x, _sectionPlanes[0].y, _sectionPlanes[0].z, _sectionPlanes[0].w));
    }
  }

  function onSceneUpdated({ objectsMoved }) {
    if (objectsMoved) {
      updateSections();
    }
  }

  /*function mix(a, b, val) {
      return a * (1.0 - val) + b * val;
  }*/

  function getDiffuseColor(material) {
    return material && material.color || new THREE.Color(0xffffff);
  }

  /*function getSpecularColor(material) {
      return (material && material.specular) || new THREE.Color(0xffffff);
  }
   function tintColor(c) {
      var intensity = Autodesk.Viewing.Extensions.Section.tintIntensity;
      var tc = _tintColor;
      c.r = mix(c.r, tc.r, intensity);
      c.g = mix(c.g, tc.g, intensity);
      c.b = mix(c.b, tc.b, intensity);
  }*/


  // Use the same fragment iterator for all fragments
  var _fragIterator = new avp.FragmentIterator({ delay: 50 });

  function updateCapMeshes(plane) {
    if (!_displaySectionHatches) {
      // LMV-5781: Do not render the section hatches if the preference is turned on.
      return;
    }
    const cg = Autodesk.Viewing.Extensions.CompGeom;

    //When drawing a 2D material in 3D space we will want to skip binding the G-buffer
    //when rendering the scene that contains that material
    _viewer.sceneAfter.skipDepthTarget = true;

    _removeSections();

    var section3D = new THREE.Object3D();
    section3D.name = "section3D";
    _viewer.scene.add(section3D);

    var section2D = new THREE.Object3D();
    section2D.name = "section2D";
    _viewer.sceneAfter.add(section2D);

    var toPlaneCoords = cg.makePlaneBasis(plane);
    var fromPaneCoords = toPlaneCoords.clone().invert();

    var mat2dname = _viewer.matman().create2DMaterial(null, { skipCircles: true, skipEllipticals: true, isScreenSpace: true, noIdOutput: true }, false, false);
    var mat2d = _viewer.matman().findMaterial(null, mat2dname);
    mat2d.transparent = true;
    mat2d.depthTest = true;
    mat2d.polygonOffset = true;
    mat2d.polygonOffsetFactor = -1;
    mat2d.polygonOffsetUnits = 0.1; // 1.0 is usually way too high, see LMV-1072
    mat2d.cutplanes = _otherCutPlanes; // make sure that cap meshes respect cutplanes from other tools
    mat2d.doNotCut = true;

    var box = new THREE.Box3();

    var models = _viewer.modelQueue().getModels().filter((m) => !m.getDoNotCut());

    var intersects = [];
    var material;
    const matrixWorld = new THREE.Matrix4();

    // Start iterating the fragments
    _fragIterator.start(models, function (fragId, dbId, model, lastFrag) {

      // Collect intersections for this fragment
      var frags = model.getFragmentList();
      if (frags.isFragVisible(fragId)) {
        frags.getWorldBounds(fragId, box);
        if (cg.xBoxPlane(plane, box)) {
          const geometry = frags.getGeometry(fragId);
          const _material = frags.getMaterial(fragId);

          if (geometry && !geometry.is2d && !geometry.isLines && _material.cutplanes) {
            material = _material;
            frags.getWorldMatrix(fragId, matrixWorld);
            cg.xMeshPlane(plane, { geometry, matrixWorld, fragId }, intersects);
          }
        }
      }

      // If this is the last fragment for dbId, process the intersections
      if (lastFrag) {
        if (intersects.length) {

          var bbox = new THREE.Box3();
          cg.convertToPlaneCoords(toPlaneCoords, intersects, bbox);

          //Create the 2D line geometry
          var vbb = new avp.VertexBufferBuilder(false, 8 * intersects.length);

          var color = getDiffuseColor(material);
          var r = 0 | color.r * 0.25 * 255.5;
          var g = 0 | color.g * 0.25 * 255.5;
          var b = 0 | color.b * 0.25 * 255.5;

          var c = 0xff000000 | b << 16 | g << 8 | r;


          var eset = new cg.EdgeSet(intersects, bbox, bbox.getSize(new THREE.Vector3()).length() * 1e-6);
          eset.snapEdges();
          eset.sanitizeEdges();
          eset.stitchContours();

          //Create the 3D mesh
          var cset = eset.triangulate({ skipOpenContour: true });

          if (cset) {

            for (let j = 0; j < cset.contours.length; j++) {

              var cntr = cset.contours[j];

              for (var k = 1; k < cntr.length; k++) {
                var pt1 = cset.pts[cntr[k - 1]];
                var pt2 = cset.pts[cntr[k]];
                vbb.addSegment(pt1.x, pt1.y, pt2.x, pt2.y, 0, -2.0, /*isClosed ? c : rc*/c, dbId, 0);
              }

            }


            var mdata = { mesh: vbb.toMesh() };

            var bg2d = avp.BufferGeometryUtils.meshToGeometry(mdata);

            bg2d.streamingDraw = true;
            bg2d.streamingIndex = true;

            var mesh2d = new THREE.Mesh(bg2d, mat2d);

            mesh2d.matrix.copy(fromPaneCoords);
            mesh2d.matrixAutoUpdate = false;
            mesh2d.frustumCulled = false;
            mesh2d.modelId = model.id; // So we can look it up later
            mesh2d.dbId = dbId;
            section2D.add(mesh2d);

            //Create triangulated capping polygon
            {
              if (!cset.triangulationFailed) {

                var bg = cset.toPolygonMesh(material.packedNormals);

                var mat = createCapMaterial(_viewer.matman(), material, model);

                mat.packedNormals = material.packedNormals;
                mat.mrtIdBuffer = material.mrtIdBuffer;
                mat.mrtNormals = material.mrtNormals;
                mat.cutplanes = _otherCutPlanes; // make sure that cap meshes respect cutplanes from other tools
                mat.side = THREE.FrontSide;
                mat.depthTest = true;
                mat.map = null;
                mat.bumpMap = null;
                mat.normalMap = null;
                mat.alphaMap = null;
                mat.specularMap = null;
                mat.transparent = false;
                mat.depthWrite = true;
                mat.hatchPattern = true;
                mat.needsUpdate = true;
                mat.doNotCut = true;

                var materialId = material.id + 3;
                if (Autodesk.Viewing.Private.USE_OUT_OF_CORE_TILE_MANAGER && !Autodesk.Viewing.Private.USE_WEBGPU) {
                  // with incremental consolidation, the material ids are not the same so we need to account for this
                  // to keep the same visual results for testing (because hash pattern orientation is chosen based on material id).
                  materialId -= 6;
                }

                var angle = materialId * Math.PI * 0.125;
                var tan = Math.tan(angle);
                mat.hatchParams = new THREE.Vector2(tan, 10.0);
                mat.hatchTintColor = new THREE.Color(_tintColor.r, _tintColor.g, _tintColor.b);
                mat.hatchTintIntensity = _tintIntensity;

                var capmesh = new THREE.Mesh(bg, mat);
                capmesh.matrix.copy(fromPaneCoords);
                capmesh.matrixAutoUpdate = false;
                capmesh.modelId = model.id; // So we can look it up later
                capmesh.dbId = dbId;
                capmesh.fragId = intersects.fragId;

                section3D.add(capmesh);
              }

            }

          }
        }

        // Clear intersections for the next dbId
        intersects.length = 0;
      } // last Fragment for dbId

    }, () => {
      // The cap scene is in sceneAfter, so we need to redraw the model to see the caps.
      // LMV-2571 - clear the render, as otherwise we will draw transparent objects atop themselves.
      _viewer.invalidate(true, true);
    }); //_fragIterator.start

  }

  // We use an own cut plane set to distinguish our own cut planes from others.
  var _ownCutPlaneSet = 'Autodesk.Viewing.Extension.Section.SectionTool';

  // Make sure that the viewer always uses the SectionTool's plane to adjust 2D rendering resolution.
  _viewer.setCutPlaneSetFor2DRendering(_ownCutPlaneSet);

  // Keep track of cutplanes that are not our own, because we have to apply them to our cap meshes
  var _otherCutPlanes = [];

  // Trigger update of cap mesh materials if number of cutplanes have changed by other tools
  function updateCapMaterials(mrtOnly) {

    function update(section) {
      // apply cutplanes to all active cap meshes
      if (!section) {
        return;
      }

      section.traverse(function (obj) {
        // we only care for THREE.Mesh with material
        if (!(obj instanceof THREE.Mesh) || !obj.material) {
          return;
        }
        if (mrtOnly) {
          _viewer.matman().adjustMaterialMRTSetting(obj.material);
        } else {
          obj.material.needsUpdate = true;
        }
      });
    }

    update(_viewer.scene.getObjectByName("section3D"));
    update(_viewer.sceneAfter.getObjectByName("section2D"));
  }

  /**
   * Returns all transformed bounding box corners
   * @param {THREE.Box3} bbox - Input Bounding Box
   * @param {THREE.Matrix4} transform - Transformation to apply to each point
   * @returns {THREE.Vector3[]} Transformed corners
   */
  function getBBoxCorners(bbox, transform) {
    var points = [
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z).applyMatrix4(transform),
    new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z).applyMatrix4(transform)];

    return points;
  }

  /**
   * Creates quadratic triangle and outline meshes for the given plane
   * @param {THREE.Plane} plane
   * @param {THREE.Vector3} position - Mesh position, will be reprojected to plane
   * @param {Number} [size] - Size of the plane mesh
   * @returns {SectionMesh}
   */
  function createPlaneMesh(plane, position, size = 1) {
    var quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    var geometry;

    geometry = new THREE.PlaneBufferGeometry(size, size);

    var material = new Autodesk.Viewing.Scene.UnlitMaterial({
      opacity: 0,
      color: _selectionColor,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });

    var mesh = new SectionMeshClass(geometry, material, plane);
    const pt = plane.projectPoint(position, new THREE.Vector3());
    mesh.position.copy(pt);
    mesh.quaternion.multiply(quat);

    // add outline with inverted background color
    var presetIndex = _viewer.currentLightPreset();
    presetIndex = Math.max(0, presetIndex);
    var bgColor = Autodesk.Viewing.Private.LightPresets[presetIndex].bgColorGradient;
    // TODO: these calculations can lead to float colors, which are ignored by three.js and instead interpreted as white
    // In r125 the float colors generate an "Unknown color" warning
    var color = "rgb(" + (255 - bgColor[0]) + "," + (255 - bgColor[1]) + "," + (255 - bgColor[2]) + ")";
    var lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 1, depthTest: false, depthWrite: false, transparent: true });

    var pos = mesh.geometry.getAttribute('position');
    const vertices = [];
    for (var i = 0; i < _outlineIndices.length; i++) {
      vertices.push(new THREE.Vector3().fromBufferAttribute(pos, _outlineIndices[i]));
    }

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(vertices);
    lineGeometry.isLines = true;

    const line = new THREE.Line(lineGeometry, lineMaterial);
    mesh.add(line);
    mesh.outline = line;

    return mesh;
  }

  function updatePlaneMeshes(rebuild) {

    traverseSections(function (child) {
      if (child instanceof SectionMeshClass) {

        let pos;
        if (child.connectivity.length > 0) {
          // section box
          var minv = child.matrixWorld.clone().invert();
          const pt = new THREE.Vector3();
          pos = child.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            var connect = child.connectivity[i];
            if (intersectPlanes(child.plane, connect[0], connect[1], pt) !== null) {
              pt.applyMatrix4(minv);
              pos.setXYZ(i, pt.x, pt.y, pt.z);
            }
          }
          pos.needsUpdate = true;
          if (avp.USE_WEBGPU) {
            // vbNeedsUpdate forces interleaveGeometry() to rebuild the CPU-side vb from attributes.
            child.geometry.vbNeedsUpdate = true;
            // dispose() frees the stale GPU allocation so VertexBuffer re-uploads on next draw.
            child.geometry.dispose();
          }
          child.geometry.computeBoundingBox();
          child.geometry.computeBoundingSphere();
        } else if (rebuild) {
          // section plane
          var bbox = _viewer.getVisibleBounds();
          var size = 2.0 * bbox.getBoundingSphere(new THREE.Sphere()).radius;
          const pt = child.plane.projectPoint(bbox.getCenter(new THREE.Vector3()), new THREE.Vector3());
          child.geometry = new THREE.PlaneBufferGeometry(size, size);
          child.position.copy(pt);

          pos = child.geometry.getAttribute('position');
        }
        if (pos) {
          for (let i = 0; i < _outlineIndices.length; i++) {
            child.outline.geometry.attributes.position.setXYZ(i,
            pos.getX(_outlineIndices[i]),
            pos.getY(_outlineIndices[i]),
            pos.getZ(_outlineIndices[i])
            );
          }
          child.outline.geometry.attributes.position.needsUpdate = true;
          if (avp.USE_WEBGPU) {
            // vbNeedsUpdate forces interleaveGeometry() to rebuild the CPU-side vb from attributes.
            child.outline.geometry.vbNeedsUpdate = true;
            // dispose() frees the stale GPU allocation so VertexBuffer re-uploads on next draw.
            child.outline.geometry.dispose();
          }
        }
      }
    });
  }

  function traverseSections(callback) {
    for (var i = 0; i < _sectionGroups.length; i++) {
      _sectionGroups[i].traverse(callback);
    }
  }

  function setSectionPlanes(fireEvent = true) {
    traverseSections(function (child) {
      if (child instanceof SectionMeshClass) {
        child.update();
      }
    });
    if (_sectionPlanes.length === 1) {
      updateCapMeshes(new THREE.Plane().setComponents(_sectionPlanes[0].x, _sectionPlanes[0].y, _sectionPlanes[0].z, _sectionPlanes[0].w));
    }
    _viewer.setCutPlaneSet(_ownCutPlaneSet, _sectionPlanes, fireEvent);
  }

  function showPlane(set) {
    for (var i = 0; i < _sectionGroups.length; i++) {
      _sectionGroups[i].visible = set;
    }

    if (_isPlaneOn !== set)
    updateViewer();

    _isPlaneOn = set;
  }

  function showSection(set) {
    if (set && _sectionPlanes.length > 0) {
      if (_sectionPlanes.length === 1) {
        updateCapMeshes(new THREE.Plane().setComponents(_sectionPlanes[0].x, _sectionPlanes[0].y, _sectionPlanes[0].z, _sectionPlanes[0].w));
      }
      _viewer.setCutPlaneSet(_ownCutPlaneSet, _sectionPlanes);
    }
    showPlane(set);
  }

  function attachControl(control, mesh) {
    control.attach(mesh);
    control.setPosition(mesh.position);
    control.visible = true;
  }

  /**
   * Checks whether the normal points away from the camera and if so flips it
   * @param {THREE.Vector3} normal
   * @returns true, if normal was flipped
   */
  function checkNormal(normal) {
    // flip normal if facing inward as eye direction
    var eyeVec = _viewer.api.navigation.getEyeVector();
    if (eyeVec.dot(normal) > 0) {
      normal.negate();
      return true;
    }

    return false;
  }

  /**
   * Does the normal need to be flipped to point to the camera ?
   * @param {THREE.Vector3} normal
   * @returns {Boolean} True, if it needs to be flipped
   */
  function shouldFlipNormal(normal) {
    // flip normal if facing inward as eye direction
    var eyeVec = _viewer.api.navigation.getEyeVector();
    return eyeVec.dot(normal) > 0;
  }

  /**
   * Define plane in local space
   * @param {THREE.Vector3} normal - Plane normal in local space
   */
  this.setPlaneLocal = function (normal) {
    let normalWorld = normal.clone().applyMatrix3(_normalMatrix).normalize();
    this.setPlane(normalWorld, undefined, true, true);
  };

  /**
   * Define plane in world space
   * @param {THREE.Vector3} normal - Plane normal in world space
   * @param {Number} [distance] - Plane distance in world space,
   *                              uses distance to intersection through screen center if none is provided
   * @param {Boolean} [fireEvent] - If ture, fire cutplane change event
   * @param {Boolean} [checkNormal] - If true, plane gets oriented towards the camera
   */
  this.setPlane = function (normal, distance, fireEvent = true, checkNormal = false) {
    var obbox = _viewer.getVisibleBounds();
    var center = obbox.getCenter(new THREE.Vector3());
    var group = new THREE.Group();

    group.applyMatrix4(_transform);
    group.updateMatrixWorld();

    if (!distance)
    distance = this.getSectionDistance(normal);

    if (checkNormal && shouldFlipNormal(normal)) {
      normal.negate();
      distance = -distance;
    }

    // Calculate the plane signed distance using the dot product of the center point of the scene bounding box
    // and the normal vector.
    distance = distance !== undefined ? distance : -1 * center.dot(normal);

    // Plane and mesh are defined in local space so we need to transform normal and center first
    var plane = new THREE.Plane(normal.clone().applyMatrix3(_inverseNormalMatrix).normalize(), distance);
    var mesh = createPlaneMesh(plane,
    center.clone().applyMatrix4(_inverseTransform),
    2.0 * obbox.getBoundingSphere(new THREE.Sphere()).radius);

    group.add(mesh);

    // Apply transformations before using the plane info
    mesh.update();

    _sectionPlanes.push(mesh.planeVec);
    _sectionGroups.push(group);
    _viewer.addOverlay(_overlayName, group);
    if (_transRotControl) {
      attachControl(_transRotControl, mesh);
      mesh.material.opacity = 0;
      mesh.material.uniformsNeedUpdate = true;
      centerPlaneArrow(mesh);
      _transRotControl.showRotationGizmos(true);
      _sectionPicker = _transRotControl.getPicker();

    }
    setSectionPlanes(fireEvent);
    if (_active) {
      updateControls();
    }
  };

  function getCenterPoint(mesh) {
    var middle = new THREE.Vector3();
    var geometry = mesh.geometry;

    geometry.computeBoundingBox();

    middle.x = (geometry.boundingBox.max.x + geometry.boundingBox.min.x) / 2;
    middle.y = (geometry.boundingBox.max.y + geometry.boundingBox.min.y) / 2;
    middle.z = (geometry.boundingBox.max.z + geometry.boundingBox.min.z) / 2;

    mesh.localToWorld(middle);
    return middle;
  }

  /**
   * Places the arrow at the center of the passed mesh.
   * @param {THREE.Mesh} mesh - Plane mesh
   * @returns {Boolean} True, if the arrow could be placed
   */
  function centerPlaneArrow(mesh) {
    if (!_transRotControl || !mesh) return false;
    // Get the center of the plane and
    // calculate the x,y,z offset between the plane position and the plane center
    var centerOffset = getCenterPoint(mesh).sub(mesh.getWorldPosition(new THREE.Vector3()));

    // Set the gizmo offset
    _transRotControl.setGizmoOffset(centerOffset);
    return true;
  }

  /**
   * Computes the maximal distance between the transformed corner points of the AABox and a plane
   * @param {THREE.Box3} bbox - Axis Aligned Bounding Box
   * @param {THREE.Plane} plane
   * @param {THREE.Matrix4} [transform] - Transform to apply
   * @returns {Number} Maximal distance
   */
  function getMaxDistanceToPlane(bbox, plane, transform = new THREE.Matrix4()) {
    let points = getBBoxCorners(bbox, transform);
    let max = Number.MIN_VALUE;

    for (let i = 0; i < points.length; ++i) {
      const perpendicularMagnitude = plane.distanceToPoint(points[i]);
      if (perpendicularMagnitude > max)
      max = perpendicularMagnitude;
    }
    return max;
  }

  function setBox(planeSet) {
    var normals = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, -1)];


    var connectivities = [
    [[1, 2], [1, 5], [2, 4], [4, 5]], // 0
    [[3, 5], [0, 5], [2, 3], [0, 2]], // 1
    [[1, 3], [0, 1], [3, 4], [0, 4]], // 2
    [[1, 5], [1, 2], [4, 5], [2, 4]], // 3
    [[2, 3], [0, 2], [3, 5], [0, 5]], // 4
    [[0, 1], [3, 1], [0, 4], [3, 4]] // 5
    ];

    var group = new THREE.Group();
    var obbox = _viewer.getVisibleBounds();
    var bbox = new THREE.Box3(obbox.min, obbox.getCenter(new THREE.Vector3()));
    var centerGlobal = bbox.getCenter(new THREE.Vector3());
    var planes = [],meshes = [];
    var mesh, plane;

    // Initialize from planeSet ONLY if it's an AABB.
    var loadingBox = false;
    if (planeSet && planeSet.length === 6) {
      // Transform planes to local space
      for (let i = 0; i < planeSet.length; ++i) {
        let plane = new THREE.Plane(new THREE.Vector3(planeSet[i].x, planeSet[i].y, planeSet[i].z), planeSet[i].w);
        plane.applyMatrix4(_inverseTransform);
        planes.push(plane);
      }

      if (1.0 - planes[0].normal.x <= Number.EPSILON) {
        // Assume that the order on planes is the same as in Array of normals defined above
        bbox = new THREE.Box3(
          new THREE.Vector3(planes[3].constant, planes[4].constant, planes[5].constant),
          new THREE.Vector3(-planes[0].constant, -planes[1].constant, -planes[2].constant)
        );

        centerGlobal = bbox.getCenter(new THREE.Vector3()).applyMatrix4(_transform);
        loadingBox = true;
      }
    }

    ////center = obbox.max;   // Use this to initialize the box around the model
    ////bbox = obbox.clone(); // Use this to initialize the box around the model

    group.applyMatrix4(_transform);
    group.updateMatrixWorld();

    for (let i = 0; i < normals.length; i++) {
      if (!loadingBox) {
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normals[i], centerGlobal.clone().applyMatrix4(_inverseTransform));
        let offset = getMaxDistanceToPlane(bbox, plane, _inverseTransform);

        plane.constant -= offset;
        planes.push(plane);
      }

      mesh = createPlaneMesh(planes[i], centerGlobal);

      group.add(mesh);
      meshes.push(mesh);
      mesh.update();

      _sectionPlanes.push(mesh.planeVec);
    }

    // build connectivity
    for (let i = 0; i < meshes.length; i++) {
      mesh = meshes[i];
      var connectivity = connectivities[i];
      for (var j = 0; j < connectivity.length; j++) {
        var nc = [];
        var ct = connectivity[j];
        for (var k = 0; k < ct.length; k++) {
          nc.push(planes[ct[k]]);
        }
        mesh.connectivity.push(nc);
      }
    }

    _sectionGroups.push(group);
    _viewer.addOverlay(_overlayName, group);

    setSectionPlanes();
    updatePlaneMeshes();

    plane = _sectionGroups[0].children[0];
    attachControl(_transRotControl, plane);
    // Set the plane opacity
    plane.material.opacity = _selectionOpacity;
    plane.material.uniformsNeedUpdate = true;
    centerPlaneArrow(plane);

    attachControl(_transControl, _sectionGroups[0]);
    _transRotControl.showRotationGizmos(false);
    _sectionPicker = _transRotControl.getPicker().concat(_transControl.getPicker());
    // Calculate the offset to the max point of the bounding box.
    var cornerOffset = new THREE.Vector3();
    if (intersectPlanes(planes[0], planes[1], planes[2], cornerOffset) !== null) {
      _transControl.setGizmoOffset(cornerOffset.add(new THREE.Vector3().setFromMatrixPosition(_transform).negate()));
    }
  }

  var intersectPlanes = function () {
    var m = new THREE.Matrix3();
    var n23 = new THREE.Vector3();
    var n31 = new THREE.Vector3();
    var n12 = new THREE.Vector3();
    return function (plane1, plane2, plane3, optionalTarget) {
      m.set(plane1.normal.x, plane1.normal.y, plane1.normal.z,
      plane2.normal.x, plane2.normal.y, plane2.normal.z,
      plane3.normal.x, plane3.normal.y, plane3.normal.z);

      var det = m.determinant();
      if (det === 0) return null;

      n23.crossVectors(plane2.normal, plane3.normal).multiplyScalar(-plane1.constant);
      n31.crossVectors(plane3.normal, plane1.normal).multiplyScalar(-plane2.constant);
      n12.crossVectors(plane1.normal, plane2.normal).multiplyScalar(-plane3.constant);

      var result = optionalTarget || new THREE.Vector3();
      return result.copy(n23).add(n31).add(n12).divideScalar(det);
    };
  }();

  var intersectObjects = function (pointer, objects, recursive) {
    return avp.TransformControls.intersectObjects(pointer.canvasX, pointer.canvasY, objects, _viewer.camera, recursive);
  };

  // public functions

  /**
   * When active, the geometry will be sectioned by the current set cut plane.
   * @returns {boolean}
   */
  this.isActive = function () {
    return _active;
  };

  /**
   * Returns the signed distance of the sectioning plane from the origin
   * @returns {Number} distance. Null distance is returned if there is no hit found from raycast
   */
  this.getSectionDistance = function (normal) {
    // Find a target point in the direction of the camera
    var eyeVec = _viewer.api.navigation.getEyeVector();
    var hit = _viewer.rayIntersect(new THREE.Ray(_viewer.camera.position, eyeVec));

    // Distance
    return hit && hit.intersectPoint && -1 * hit.intersectPoint.dot(normal);
  };

  /**
   * Enables the cut planes that were created by the viewer.setCutPlanes() function.
   * @param {boolean} [fireEvent] - if set to false the av.CUTPLANES_CHANGE_EVENT event will not be fired.
   */
  this.setViewerSection = function (fireEvent = true) {
    this.clearSection(fireEvent);
    var normal;
    // Attempt to initialize the tool with a plane that is already set.
    var planeSet = _viewer.getCutPlaneSet('__set_view');
    if (planeSet.length !== 1) return;

    _transRotControl.clientScale = 1;
    var v4 = planeSet[0];
    normal = new THREE.Vector3(v4.x, v4.y, v4.z);
    var distance = v4.w;
    this.setPlane(normal, distance, fireEvent);
    _activeMode = 'SET_VIEW_PLANE';
    // Clear sections from Viewer3D::setView
    _viewer.setCutPlaneSet('__set_view', undefined, fireEvent);
  };



  /**
   * Facilitates the initialization of a cut plane
   *
   * @param {String} name - Either 'X', 'Y', 'Z', 'BOX', 'OBJ_BOX', 'OBJ_SET_VIEW_PLANE' or 'SET_VIEW_PLANE'
   */
  this.setSection = function (name) {
    this.clearSection();
    var normal;
    _transRotControl.clientScale = 1;

    // Attempt to initialize the tool with a plane that is already set.
    var planeSet = _viewer.getCutPlaneSet('__set_view');
    if (planeSet.length === 1 && name !== 'BOX' && name !== 'OBJ_SET_VIEW_PLANE') {
      name = 'SET_VIEW_PLANE';
    }
    switch (name) {
      case 'X':
        normal = new THREE.Vector3(1, 0, 0);
        this.setPlaneLocal(normal);
        break;
      case 'Y':
        normal = new THREE.Vector3(0, 1, 0);
        this.setPlaneLocal(normal);
        break;
      case 'Z':
        normal = new THREE.Vector3(0, 0, 1);
        this.setPlaneLocal(normal);
        break;
      case 'OBJ_SET_VIEW_PLANE':
      case 'SET_VIEW_PLANE':
        var v4 = planeSet[0];
        normal = new THREE.Vector3(v4.x, v4.y, v4.z);
        this.setPlane(normal, v4.w);
        break;
      case 'OBJ_BOX':
      case 'BOX':
        setBox(planeSet);
        _transRotControl.clientScale = 2;
        this.recomputePivot();
        break;
    }
    _activeMode = name;

    // Clear sections from Viewer3D::setView
    _viewer.setCutPlaneSet('__set_view', undefined);
  };

  /**
   * Facilitates the initialization of a cut plane from a normal and distance
   *
   * @param {THREE.Vector4} normal (x,y,z) and distance (w)
   * @param {Number} distance
   */
  this.setSectionFromPlane = function (cutplane) {
    this.clearSection();
    this.setPlane(new THREE.Vector3(cutplane.x, cutplane.y, cutplane.z), cutplane.w);
    _activeMode = "";

    // Clear sections from Viewer3D::setView
    _viewer.setCutPlaneSet('__set_view', undefined);
  };

  /**
   * Set the active mode
   * @param {string} [name] - active mode name
   * @private
   */
  this.setActiveMode = function (name) {
    _activeMode = name || "";
  };

  /**
   * Remove the section graphics
   */
  function _removeSections() {
    var oldsection3D = _viewer.scene.getObjectByName("section3D");
    if (oldsection3D)
    _viewer.scene.remove(oldsection3D);
    var oldsection2D = _viewer.sceneAfter.getObjectByName("section2D");
    if (oldsection2D)
    _viewer.sceneAfter.remove(oldsection2D);
  }

  this.setDisplaySectionHatches = function (value) {
    _displaySectionHatches = value;
  };

  this.clearCapMeshes = function () {
    _removeSections();
  };

  this.updateCapMeshes = function (plane, capMeshOnly) {
    if (!plane) {
      return;
    }

    if (!capMeshOnly) {
      this.setPlane(plane.normal, plane.constant);
    }
    updateCapMeshes(plane);
  };

  /**
   * Removes any (and all) currently set cut plane(s).
   * @param {boolean} [fireEvent] - if set to false the av.CUTPLANES_CHANGE_EVENT event will not be fired.
   */
  this.clearSection = function (fireEvent = true) {

    if (_transRotControl)
    _transRotControl.detach();

    if (_transControl)
    _transControl.detach();

    // remove all sections
    while (_sectionPlanes.length > 0) {
      _sectionPlanes.pop();
    }

    while (_sectionGroups.length > 0) {
      var group = _sectionGroups.pop();
      _viewer.removeOverlay(_overlayName, group);
    }

    _fragIterator.start(null); // Shutdown iterator
    _removeSections();

    _viewer.setCutPlaneSet(_ownCutPlaneSet, null, fireEvent);
  };

  this.isPlaneOn = function () {
    return _isPlaneOn;
  };

  this.showPlane = function (set) {
    showPlane(set);
  };

  /**
   * Whether translation and rotation controls are visible or not.
   * @param {Boolean} set
   */
  this.attachControl = function (set) {
    if (!_transRotControl || !_transControl) {
      return;
    }

    if (set) {
      attachControl(_transRotControl, _sectionGroups[0].children[0]);
      _transRotControl.highlight();
      if (_activeMode === 'BOX')
      attachControl(_transControl, _sectionGroups[0]);
    } else {
      _transRotControl.detach();
      _transControl.detach();
    }
  };

  /**
   * Invokes setSection with the last set of parameters used.
   */
  this.resetSection = function () {
    this.setSection(_activeMode);
  };

  // tool interface

  this.getNames = function () {
    return _names;
  };

  this.getName = function () {
    return _names[0];
  };

  this.register = function () {
  };

  this.deregister = function () {
    this.clearSection();
    deinitControl();
  };

  this.getPriority = function () {
    return _priority;
  };

  /**
   * [ToolInterface] Activates the tool
   * @param {String} name - unused
   */
  this.activate = function /*name*/ () {

    setTransform(getDefaultTransform());

    initControl();

    _active = true;
    _isDragging = false;
    _visibleAtFirst = true;

    // keep only one section all the time per design
    _sectionPlanes = _sectionPlanes || [];

    showSection(true);
  };

  /**
   * [ToolInterface] Deactivates the tool
   * @param {String} name - unused
   */
  this.deactivate = function /*name*/ () {
    _active = false;
    _isDragging = false;

    if (!this.keepCutPlanesOnDeactivate) {
      // Clean sections and gizmos when deactivating the tool.
      _fragIterator.start(null); // Shutdown iterator
      _removeSections();

      showSection(false);
      _viewer.setCutPlaneSet(_ownCutPlaneSet);
    } else {
      // In case that keepCutPlanesOnDeactivate is set, the control gizmos will disappear, but the sections will stay.
      _viewer.removeOverlay(_overlayName, _transRotControl);
      _viewer.removeOverlay(_overlayName, _transControl);

      for (let i = 0; i < _sectionGroups.length; i++) {
        _viewer.removeOverlay(_overlayName, _sectionGroups[i]);
      }
    }

    _transRotControl.detach();
    _transControl.detach();
  };

  this.update = function /*highResTimestamp*/ () {
    return false;
  };

  this.handleSingleClick = function (event /*, button*/) {
    var pointer = event;
    var result = intersectObjects(pointer, _sectionGroups[0]?.children);
    // The section can still receive click events, also if not initialized yet (no children) (VIZX-2900).
    // TODO: This code needs revision to decouple tool state from its internal state, so that
    //       the internal state is always consistent and valid, no matter if the tool is activated or deactivated.
    // TODO: May also need to double-check for revision in event propagation in the Default Handler,
    //       since the Section Tool should not receive a click event, if it is occluded by another object (e.g., a PushPin3D shape).
    _sectionGroups[0]?.children?.forEach(function (child) {
      child.material.opacity = 0;
      child.material.uniformsNeedUpdate = true;
    });

    if (result) {
      const prevObject = _transRotControl.object;
      attachControl(_transRotControl, result.object);
      _transRotControl.highlight();
      result.object.material.opacity = _sectionPlanes.length > 1 ? _selectionOpacity : 0;
      result.object.material.uniformsNeedUpdate = true;
      // Only in case of a section box, and only when clicking on a different plane - re-center the arrow.
      if (_sectionGroups[0]?.children?.length > 1 && prevObject !== result.object) {
        centerPlaneArrow(result.object);
      }
      updateViewer();
      adjustGizmoToBounds();
    }

    return false;
  };

  this.handleDoubleClick = function /*event, button*/ () {
    return false;
  };

  this.handleSingleTap = function (event) {
    return this.handleSingleClick(event, 0);
  };

  this.handleDoubleTap = function /*event*/ () {
    return false;
  };

  this.handleKeyDown = function /*event, keyCode*/ () {
    return false;
  };

  this.handleKeyUp = function /*event, keyCode*/ () {
    return false;
  };

  this.handleWheelInput = function /*delta*/ () {
    return false;
  };

  this.handleButtonDown = function (event /*, button*/) {
    _isDragging = true;
    if (_transControl.onPointerDown(event))
    return true;
    return _transRotControl.onPointerDown(event);
  };

  this.handleButtonUp = function (event /*, button*/) {
    _isDragging = false;
    if (_boxChanged) {
      _boxChanged = false;
      this.recomputePivot();
    }
    if (_transControl.onPointerUp(event))
    return true;
    return _transRotControl.onPointerUp(event);
  };

  this.handleMouseMove = function (event) {
    if (_isDragging) {
      if (_transControl.onPointerMove(event)) {
        _boxChanged = true;
        setSectionPlanes();
        _transRotControl.update();

        sendAnalyticsDebounced('Canvas', 'Box', 'translate');

        return true;
      }
      if (_transRotControl.onPointerMove(event)) {
        _boxChanged = true;
        setSectionPlanes();
        updatePlaneMeshes();
        // TODO: Try to position the triad to the max corner of the section box when moving the plane arrow.
        // Currently, it is positioned at the max point of the section box.

        if (_activeMode.includes('BOX'))
        sendAnalyticsDebounced('Canvas', 'Box', 'transform');else
        {
          const mode = _transRotControl.axis.search("R") != -1 ? "rotate" : "translate";
          sendAnalyticsDebounced('Canvas', 'Plane', mode);
        }

        return true;
      }
    }

    _transControl.visible = _transControl.object !== undefined;

    if (event.pointerType !== 'touch') {
      var pointer = event;
      var result = intersectObjects(pointer, _sectionGroups[0]?.children);
      if (result) {
        _visibleAtFirst = false;
      }

      // show gizmo + plane when intersecting on non-touch
      var visible = _visibleAtFirst || result || intersectObjects(pointer, _sectionPicker, true) ? true : false;
      _transRotControl.visible = visible;
      _transControl.visible = _transControl.visible && visible;
      showPlane(visible);
    }

    if (_transControl.onPointerHover(event))
    return true;

    return _transRotControl.onPointerHover(event);
  };

  this.handleGesture = function (event) {
    switch (event.type) {
      case "dragstart":
        _touchType = "drag";
        // Single touch, fake the mouse for now...
        return this.handleButtonDown(event, 0);

      case "dragmove":
        return _touchType === "drag" ? this.handleMouseMove(event) : false;

      case "dragend":
        if (_touchType === "drag") {
          _touchType = null;
          return this.handleButtonUp(event, 0);
        }
        return false;
    }
    return false;
  };

  this.handleBlur = function /*event*/ () {
    return false;
  };

  this.handleResize = function () {
  };

  this.handlePressHold = function /*event*/ () {
    // When this method returns true, it will not call the DefaultHandler's handlePressHold.
    // This makes it not possible to open the context menu on mobile.
    return false;
  };

  this.recomputePivot = function () {

    var values = this.getSectionBoxValues(true);
    if (!values) return;

    var aabb = values.sectionBox;

    _viewer.api.navigation.setPivotPoint(new THREE.Vector3(
      aabb[0] + (aabb[3] - aabb[0]) * 0.5,
      aabb[1] + (aabb[4] - aabb[1]) * 0.5,
      aabb[2] + (aabb[5] - aabb[2]) * 0.5
    ));
  };

  this.getSectionBoxValues = function (ignoreGlobalOffset) {

    var group = _sectionGroups[0];
    if (!group) {
      return null;
    }

    var planes = group.children;
    if (planes.length < 6) {
      return null;
    }

    var right = planes[0].position.x;
    var top = planes[1].position.y;
    var front = planes[2].position.z;
    var left = planes[3].position.x;
    var bttm = planes[4].position.y;
    var back = planes[5].position.z;

    var off = { x: 0, y: 0, z: 0 };
    if (!ignoreGlobalOffset) {
      off = _viewer.model.getData().globalOffset || off;
    }

    var aabb = [
    Math.min(left, right) + off.x,
    Math.min(top, bttm) + off.y,
    Math.min(front, back) + off.z,
    Math.max(left, right) + off.x,
    Math.max(top, bttm) + off.y,
    Math.max(front, back) + off.z];


    // Box doesn't support rotation at the moment.
    // Will have to take it into account if that becomes a feature.
    var transform = new THREE.Matrix4().identity().toArray();

    return {
      sectionBox: aabb,
      sectionBoxTransform: transform
    };
  };

  this.getSectionPlaneValues = function (ignoreGlobalOffset) {

    var group = _sectionGroups[0];
    if (!group) {
      return null;
    }

    var planes = group.children;
    if (planes.length !== 1) {
      return null;
    }

    var off = { x: 0, y: 0, z: 0 };
    if (!ignoreGlobalOffset) {
      off = _viewer.model.getData().globalOffset || off;
    }

    var plane = planes[0].plane;
    var constant = plane.constant - THREE.Vector3.prototype.dot.call(off, plane.normal);

    return {
      sectionPlane: [
      plane.normal.x,
      plane.normal.y,
      plane.normal.z,
      constant]

    };
  };

  this.getSectionPlaneSet = function () {
    return _viewer.getCutPlaneSet(_ownCutPlaneSet);
  };

  this.getSectionPlanes = function () {
    // When restoring a viewer state it is put in __set_view, so return from that set
    // However, the notifyCutplanesChanged function can call setViewerSection which would
    // move the planes from __set_view into _ownCutPlaneSet
    const viewSet = _viewer.getCutPlaneSet('__set_view');
    if (viewSet.length > 0) {
      return viewSet;
    }

    return _viewer.getCutPlaneSet(_ownCutPlaneSet);
  };

  // Called by viewer if any cutplanes are modified. It makes sure that cutplanes controlled by separate tools
  // (with own cutplane sets) are considered by our cap meshes.
  this.notifyCutplanesChanged = function () {

    var numCutPlanesBefore = _otherCutPlanes.length;

    // Collect all active cutplanes from other tools
    //
    // NOTE: It's essential that we don't create a new array, but just refill the same one.
    //       Since the cap meshes are created async, the cutPlaneChange event may come in the middle of
    //       the cap mesh generation. For consistency, we want all cap meshes to share the same cutplane array.
    _otherCutPlanes.length = 0;
    var cpSets = _viewer.getCutPlaneSets();
    for (var i = 0; i < cpSets.length; i++) {

      // skip our own cut planes
      var cpName = cpSets[i];
      if (cpName === _ownCutPlaneSet) {
        continue;
      }

      // add cutplanes of this set
      var cp = _viewer.getCutPlaneSet(cpName);
      for (var j = 0; j < cp.length; j++) {
        _otherCutPlanes.push(cp[j]);
      }
    }

    // Set the section tool to the viewer defined cutplane.
    if (cpSets.includes("__set_view") && _activeMode !== "" && _activeMode.indexOf("OBJ_") === -1) {
      this.setViewerSection(false);
    }

    // If the number of cutplanes changed, this requires a shader recompile of the cap materials
    if (numCutPlanesBefore !== _otherCutPlanes.length) {
      updateCapMaterials(false);
    }
  };

  // Sections use cloned materials outside the control of MaterialManager. Thus, when rendering options change, materials need to get recompiled
  this.notifyRenderOptionChanged = function () {
    updateCapMaterials(true);
  };

  /**
   * Set a section box around the passed in bounding box.
   * @param {THREE.Box3} box
   * @returns {boolean} - true if the section box was set
   */
  this.setSectionBox = function (box) {
    if (!box) return false;
    const name = 'OBJ_BOX';
    // Convert the bounding box to planes

    let bbox = box;
    let transform = box.transform;

    // If a transform is specified on the bbox, we use it, otherwise we align the box with project north
    if (!box.transform) {
      bbox = bbox.clone().applyMatrix4(_inverseTransform);
      transform = _transform;
    }

    const planes = Autodesk.Viewing.Private.SceneMath.box2CutPlanes(bbox, transform);
    _activeMode = name;
    _viewer.setCutPlaneSet('__set_view', planes);
    this.setSection(name);
    return true;
  };

  /**
   * Set a section plane at the intersection position.
   * @param {Three.Vector3} normal - plane normal.
   * @param {Three.Vector3} position - position to place the plane.
   * @returns {boolean} - true if the section plane was set
   */
  this.setSectionPlane = function (normal, position, enableRotationGizmo = true) {
    if (!normal || !position) return false;

    const name = 'OBJ_SET_VIEW_PLANE';
    const distance = -1 * position.dot(normal);
    const plane = new THREE.Plane(normal, distance);
    _activeMode = name;
    const planeVecs = [new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)];
    _viewer.setCutPlaneSet('__set_view', planeVecs);
    this.setSection(name);
    // RotationGizmos are turned on by default.
    // The option to disable it, is for cases like activating the section tool from the context menu.
    _transRotControl?.showRotationGizmos(enableRotationGizmo);

    const pos = position.clone().sub(_sectionGroups[0].children[0].getWorldPosition(_auxVec3));
    _transRotControl?.setGizmoOffset(pos);

    return true;
  };
};

function init_SectionMesh() {

  if (SectionMeshClass)
  return;

  const tmpWorldPosition = new THREE.Vector3();
  const tmpNormalMatrix = new THREE.Matrix3();

  class SectionMesh extends THREE.Mesh {
    constructor(geometry, material, plane) {

      super(geometry, material, false);

      this.plane = plane;
      this.planeVec = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      this.connectivity = [];
      this.outline = null;
    }

    update() {
      this.updateMatrixWorld();
      this.plane.normal.set(0, 0, 1);

      var normal = this.plane.normal;
      normal.applyMatrix3(tmpNormalMatrix.getNormalMatrix(this.matrixWorld));

      var d = -1 * this.getWorldPosition(tmpWorldPosition).dot(normal);
      this.planeVec.set(normal.x, normal.y, normal.z, d);
      this.plane.constant = d;
    }
  }
  SectionMeshClass = SectionMesh;
}

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Section/Section.css"
/*!****************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Section/Section.css ***!
  \****************************************************************************************************************************************************************************************************************************************************/
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
___CSS_LOADER_EXPORT___.push([module.id, `/**
 * Section CSS
 **/
.sectionPanel {
  line-height: 14px;
  text-align: left;
  z-index: 10;
}

.section-horizontal-divider {
  height: 1px;
  border-top: 1px solid rgba(200, 200, 200, 0.8);
}

.section-submenu-select {
  display: block;
  position: relative;
  width: calc(100% - 40px);
  padding: 10px 20px 0px 20px;
  opacity: 0.3;
}

.section-panel:hover .section-submenu-select {
  opacity: 0.8;
}

.section-submenu-selectlabel {
  position: relative;
  display: inline-block;
  padding-right: 20px;
  padding-bottom: 4px;
}

.section-restart {
  margin: 10px 20px 15px 20px;
  padding: 6px 10px 6px 10px;
  width: calc(100% - 55px);
  cursor: pointer;
}

.docking-panel:hover .section-restart {
  background-color: rgba(255, 255, 255, 0.12);
}

.docking-panel .section-restart:hover {
  background-color: rgba(166, 194, 255, 0.7);
  -webkit-transition: all 0.2s ease;
  -moz-transition: all 0.2s ease;
  -ms-transition: all 0.2s ease;
  -o-transition: all 0.2s ease;
  transition: all 0.2s ease;
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

/***/ "./extensions/Section/Section.css"
/*!****************************************!*\
  !*** ./extensions/Section/Section.css ***!
  \****************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Section_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./Section.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Section/Section.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Section_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Section_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Section_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Section_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "./node_modules/lodash-es/_Symbol.js"
/*!*******************************************!*\
  !*** ./node_modules/lodash-es/_Symbol.js ***!
  \*******************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _root_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_root.js */ "./node_modules/lodash-es/_root.js");


/** Built-in value references. */
var Symbol = _root_js__WEBPACK_IMPORTED_MODULE_0__["default"].Symbol;

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (Symbol);


/***/ },

/***/ "./node_modules/lodash-es/_baseGetTag.js"
/*!***********************************************!*\
  !*** ./node_modules/lodash-es/_baseGetTag.js ***!
  \***********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _Symbol_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_Symbol.js */ "./node_modules/lodash-es/_Symbol.js");
/* harmony import */ var _getRawTag_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./_getRawTag.js */ "./node_modules/lodash-es/_getRawTag.js");
/* harmony import */ var _objectToString_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./_objectToString.js */ "./node_modules/lodash-es/_objectToString.js");




/** `Object#toString` result references. */
var nullTag = '[object Null]',
    undefinedTag = '[object Undefined]';

/** Built-in value references. */
var symToStringTag = _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"] ? _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"].toStringTag : undefined;

/**
 * The base implementation of `getTag` without fallbacks for buggy environments.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
function baseGetTag(value) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return (symToStringTag && symToStringTag in Object(value))
    ? (0,_getRawTag_js__WEBPACK_IMPORTED_MODULE_1__["default"])(value)
    : (0,_objectToString_js__WEBPACK_IMPORTED_MODULE_2__["default"])(value);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (baseGetTag);


/***/ },

/***/ "./node_modules/lodash-es/_baseTrim.js"
/*!*********************************************!*\
  !*** ./node_modules/lodash-es/_baseTrim.js ***!
  \*********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _trimmedEndIndex_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_trimmedEndIndex.js */ "./node_modules/lodash-es/_trimmedEndIndex.js");


/** Used to match leading whitespace. */
var reTrimStart = /^\s+/;

/**
 * The base implementation of `_.trim`.
 *
 * @private
 * @param {string} string The string to trim.
 * @returns {string} Returns the trimmed string.
 */
function baseTrim(string) {
  return string
    ? string.slice(0, (0,_trimmedEndIndex_js__WEBPACK_IMPORTED_MODULE_0__["default"])(string) + 1).replace(reTrimStart, '')
    : string;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (baseTrim);


/***/ },

/***/ "./node_modules/lodash-es/_freeGlobal.js"
/*!***********************************************!*\
  !*** ./node_modules/lodash-es/_freeGlobal.js ***!
  \***********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof __webpack_require__.g == 'object' && __webpack_require__.g && __webpack_require__.g.Object === Object && __webpack_require__.g;

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (freeGlobal);


/***/ },

/***/ "./node_modules/lodash-es/_getRawTag.js"
/*!**********************************************!*\
  !*** ./node_modules/lodash-es/_getRawTag.js ***!
  \**********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _Symbol_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_Symbol.js */ "./node_modules/lodash-es/_Symbol.js");


/** Used for built-in method references. */
var objectProto = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/** Built-in value references. */
var symToStringTag = _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"] ? _Symbol_js__WEBPACK_IMPORTED_MODULE_0__["default"].toStringTag : undefined;

/**
 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the raw `toStringTag`.
 */
function getRawTag(value) {
  var isOwn = hasOwnProperty.call(value, symToStringTag),
      tag = value[symToStringTag];

  try {
    value[symToStringTag] = undefined;
    var unmasked = true;
  } catch (e) {}

  var result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (getRawTag);


/***/ },

/***/ "./node_modules/lodash-es/_objectToString.js"
/*!***************************************************!*\
  !*** ./node_modules/lodash-es/_objectToString.js ***!
  \***************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/** Used for built-in method references. */
var objectProto = Object.prototype;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/**
 * Converts `value` to a string using `Object.prototype.toString`.
 *
 * @private
 * @param {*} value The value to convert.
 * @returns {string} Returns the converted string.
 */
function objectToString(value) {
  return nativeObjectToString.call(value);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (objectToString);


/***/ },

/***/ "./node_modules/lodash-es/_root.js"
/*!*****************************************!*\
  !*** ./node_modules/lodash-es/_root.js ***!
  \*****************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _freeGlobal_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_freeGlobal.js */ "./node_modules/lodash-es/_freeGlobal.js");


/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = _freeGlobal_js__WEBPACK_IMPORTED_MODULE_0__["default"] || freeSelf || Function('return this')();

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (root);


/***/ },

/***/ "./node_modules/lodash-es/_trimmedEndIndex.js"
/*!****************************************************!*\
  !*** ./node_modules/lodash-es/_trimmedEndIndex.js ***!
  \****************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/** Used to match a single whitespace character. */
var reWhitespace = /\s/;

/**
 * Used by `_.trim` and `_.trimEnd` to get the index of the last non-whitespace
 * character of `string`.
 *
 * @private
 * @param {string} string The string to inspect.
 * @returns {number} Returns the index of the last non-whitespace character.
 */
function trimmedEndIndex(string) {
  var index = string.length;

  while (index-- && reWhitespace.test(string.charAt(index))) {}
  return index;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (trimmedEndIndex);


/***/ },

/***/ "./node_modules/lodash-es/debounce.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/debounce.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _isObject_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./isObject.js */ "./node_modules/lodash-es/isObject.js");
/* harmony import */ var _now_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./now.js */ "./node_modules/lodash-es/now.js");
/* harmony import */ var _toNumber_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./toNumber.js */ "./node_modules/lodash-es/toNumber.js");




/** Error message constants. */
var FUNC_ERROR_TEXT = 'Expected a function';

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeMax = Math.max,
    nativeMin = Math.min;

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked. The debounced function comes with a `cancel` method to cancel
 * delayed `func` invocations and a `flush` method to immediately invoke them.
 * Provide `options` to indicate whether `func` should be invoked on the
 * leading and/or trailing edge of the `wait` timeout. The `func` is invoked
 * with the last arguments provided to the debounced function. Subsequent
 * calls to the debounced function return the result of the last `func`
 * invocation.
 *
 * **Note:** If `leading` and `trailing` options are `true`, `func` is
 * invoked on the trailing edge of the timeout only if the debounced function
 * is invoked more than once during the `wait` timeout.
 *
 * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
 * until to the next tick, similar to `setTimeout` with a timeout of `0`.
 *
 * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
 * for details over the differences between `_.debounce` and `_.throttle`.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Function
 * @param {Function} func The function to debounce.
 * @param {number} [wait=0] The number of milliseconds to delay.
 * @param {Object} [options={}] The options object.
 * @param {boolean} [options.leading=false]
 *  Specify invoking on the leading edge of the timeout.
 * @param {number} [options.maxWait]
 *  The maximum time `func` is allowed to be delayed before it's invoked.
 * @param {boolean} [options.trailing=true]
 *  Specify invoking on the trailing edge of the timeout.
 * @returns {Function} Returns the new debounced function.
 * @example
 *
 * // Avoid costly calculations while the window size is in flux.
 * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
 *
 * // Invoke `sendMail` when clicked, debouncing subsequent calls.
 * jQuery(element).on('click', _.debounce(sendMail, 300, {
 *   'leading': true,
 *   'trailing': false
 * }));
 *
 * // Ensure `batchLog` is invoked once after 1 second of debounced calls.
 * var debounced = _.debounce(batchLog, 250, { 'maxWait': 1000 });
 * var source = new EventSource('/stream');
 * jQuery(source).on('message', debounced);
 *
 * // Cancel the trailing debounced invocation.
 * jQuery(window).on('popstate', debounced.cancel);
 */
function debounce(func, wait, options) {
  var lastArgs,
      lastThis,
      maxWait,
      result,
      timerId,
      lastCallTime,
      lastInvokeTime = 0,
      leading = false,
      maxing = false,
      trailing = true;

  if (typeof func != 'function') {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  wait = (0,_toNumber_js__WEBPACK_IMPORTED_MODULE_2__["default"])(wait) || 0;
  if ((0,_isObject_js__WEBPACK_IMPORTED_MODULE_0__["default"])(options)) {
    leading = !!options.leading;
    maxing = 'maxWait' in options;
    maxWait = maxing ? nativeMax((0,_toNumber_js__WEBPACK_IMPORTED_MODULE_2__["default"])(options.maxWait) || 0, wait) : maxWait;
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function invokeFunc(time) {
    var args = lastArgs,
        thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time) {
    // Reset any `maxWait` timer.
    lastInvokeTime = time;
    // Start the timer for the trailing edge.
    timerId = setTimeout(timerExpired, wait);
    // Invoke the leading edge.
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime,
        timeWaiting = wait - timeSinceLastCall;

    return maxing
      ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  function shouldInvoke(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime;

    // Either this is the first call, activity has stopped and we're at the
    // trailing edge, the system time has gone backwards and we're treating
    // it as the trailing edge, or we've hit the `maxWait` limit.
    return (lastCallTime === undefined || (timeSinceLastCall >= wait) ||
      (timeSinceLastCall < 0) || (maxing && timeSinceLastInvoke >= maxWait));
  }

  function timerExpired() {
    var time = (0,_now_js__WEBPACK_IMPORTED_MODULE_1__["default"])();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer.
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timerId = undefined;

    // Only invoke if we have `lastArgs` which means `func` has been
    // debounced at least once.
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = undefined;
  }

  function flush() {
    return timerId === undefined ? result : trailingEdge((0,_now_js__WEBPACK_IMPORTED_MODULE_1__["default"])());
  }

  function debounced() {
    var time = (0,_now_js__WEBPACK_IMPORTED_MODULE_1__["default"])(),
        isInvoking = shouldInvoke(time);

    lastArgs = arguments;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (maxing) {
        // Handle invocations in a tight loop.
        clearTimeout(timerId);
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (debounce);


/***/ },

/***/ "./node_modules/lodash-es/isObject.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/isObject.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return value != null && (type == 'object' || type == 'function');
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (isObject);


/***/ },

/***/ "./node_modules/lodash-es/isObjectLike.js"
/*!************************************************!*\
  !*** ./node_modules/lodash-es/isObjectLike.js ***!
  \************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return value != null && typeof value == 'object';
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (isObjectLike);


/***/ },

/***/ "./node_modules/lodash-es/isSymbol.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/isSymbol.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _baseGetTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_baseGetTag.js */ "./node_modules/lodash-es/_baseGetTag.js");
/* harmony import */ var _isObjectLike_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./isObjectLike.js */ "./node_modules/lodash-es/isObjectLike.js");



/** `Object#toString` result references. */
var symbolTag = '[object Symbol]';

/**
 * Checks if `value` is classified as a `Symbol` primitive or object.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
 * @example
 *
 * _.isSymbol(Symbol.iterator);
 * // => true
 *
 * _.isSymbol('abc');
 * // => false
 */
function isSymbol(value) {
  return typeof value == 'symbol' ||
    ((0,_isObjectLike_js__WEBPACK_IMPORTED_MODULE_1__["default"])(value) && (0,_baseGetTag_js__WEBPACK_IMPORTED_MODULE_0__["default"])(value) == symbolTag);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (isSymbol);


/***/ },

/***/ "./node_modules/lodash-es/now.js"
/*!***************************************!*\
  !*** ./node_modules/lodash-es/now.js ***!
  \***************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _root_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_root.js */ "./node_modules/lodash-es/_root.js");


/**
 * Gets the timestamp of the number of milliseconds that have elapsed since
 * the Unix epoch (1 January 1970 00:00:00 UTC).
 *
 * @static
 * @memberOf _
 * @since 2.4.0
 * @category Date
 * @returns {number} Returns the timestamp.
 * @example
 *
 * _.defer(function(stamp) {
 *   console.log(_.now() - stamp);
 * }, _.now());
 * // => Logs the number of milliseconds it took for the deferred invocation.
 */
var now = function() {
  return _root_js__WEBPACK_IMPORTED_MODULE_0__["default"].Date.now();
};

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (now);


/***/ },

/***/ "./node_modules/lodash-es/toNumber.js"
/*!********************************************!*\
  !*** ./node_modules/lodash-es/toNumber.js ***!
  \********************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _baseTrim_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./_baseTrim.js */ "./node_modules/lodash-es/_baseTrim.js");
/* harmony import */ var _isObject_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./isObject.js */ "./node_modules/lodash-es/isObject.js");
/* harmony import */ var _isSymbol_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./isSymbol.js */ "./node_modules/lodash-es/isSymbol.js");




/** Used as references for various `Number` constants. */
var NAN = 0 / 0;

/** Used to detect bad signed hexadecimal string values. */
var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

/** Used to detect binary string values. */
var reIsBinary = /^0b[01]+$/i;

/** Used to detect octal string values. */
var reIsOctal = /^0o[0-7]+$/i;

/** Built-in method references without a dependency on `root`. */
var freeParseInt = parseInt;

/**
 * Converts `value` to a number.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to process.
 * @returns {number} Returns the number.
 * @example
 *
 * _.toNumber(3.2);
 * // => 3.2
 *
 * _.toNumber(Number.MIN_VALUE);
 * // => 5e-324
 *
 * _.toNumber(Infinity);
 * // => Infinity
 *
 * _.toNumber('3.2');
 * // => 3.2
 */
function toNumber(value) {
  if (typeof value == 'number') {
    return value;
  }
  if ((0,_isSymbol_js__WEBPACK_IMPORTED_MODULE_2__["default"])(value)) {
    return NAN;
  }
  if ((0,_isObject_js__WEBPACK_IMPORTED_MODULE_1__["default"])(value)) {
    var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
    value = (0,_isObject_js__WEBPACK_IMPORTED_MODULE_1__["default"])(other) ? (other + '') : other;
  }
  if (typeof value != 'string') {
    return value === 0 ? value : +value;
  }
  value = (0,_baseTrim_js__WEBPACK_IMPORTED_MODULE_0__["default"])(value);
  var isBinary = reIsBinary.test(value);
  return (isBinary || reIsOctal.test(value))
    ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
    : (reIsBadHex.test(value) ? NAN : +value);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (toNumber);


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
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
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
/*!***************************************!*\
  !*** ./extensions/Section/Section.js ***!
  \***************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SectionExtension: () => (/* binding */ SectionExtension)
/* harmony export */ });
/* harmony import */ var _SectionTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SectionTool.js */ "./extensions/Section/SectionTool.js");
/* harmony import */ var _Section_css__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./Section.css */ "./extensions/Section/Section.css");



const avp = Autodesk.Viewing.Private;
const AVU = Autodesk.Viewing.UI;
const analytics = avp.analytics;

/**
 * The SectionExtension provides ways to cut the geometry using planes or a cube.
 * The extension adds a toolbar button to access the feature.
 *
 * The extension id is: `Autodesk.Section`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example
 * viewer.loadExtension('Autodesk.Section')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.SectionExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
var SectionExtension = function (viewer, options) {
  Autodesk.Viewing.Extension.call(this, viewer, options);
  this.viewer = viewer;
  this.name = 'section';
  this.modes = ['x', 'y', 'z', 'box'];
  this.buttons = {};

  this.onViewerSetView = this.onViewerSetView.bind(this);
  this._onCutPlanesChanged = this._onCutPlanesChanged.bind(this);
  this._onShowAll = this._onShowAll.bind(this);
};

SectionExtension.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
SectionExtension.prototype.constructor = SectionExtension;

var proto = SectionExtension.prototype;

/**
 * Registers the SectionTool, hotkeys and event handlers.
 *
 * @returns {boolean}
 */
proto.load = function () {
  var that = this;
  var viewer = this.viewer;

  this.tool = new _SectionTool_js__WEBPACK_IMPORTED_MODULE_0__.SectionTool(viewer, {
    tintColor: { r: 1, g: 1, b: 0 },
    tintIntensity: 0.2
  });

  viewer.toolController.registerTool(this.tool, this.setActive.bind(this));
  this.sectionStyle = null;
  this.supportedStyles = ["X", "Y", "Z", "BOX"];

  this.displaySectionHatches = this.displaySectionHatches.bind(this);

  this.displaySectionHatches(this.viewer.prefs.get(avp.Prefs3D.DISPLAY_SECTION_HATCHES)); // Set initial value
  this.viewer.prefs.addListeners(avp.Prefs3D.DISPLAY_SECTION_HATCHES, this.displaySectionHatches);

  viewer.addEventListener(Autodesk.Viewing.SET_VIEW_EVENT, this.onViewerSetView);

  // consider cutplane changes of other tools, so that cap meshes consider them too
  viewer.addEventListener(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this._onCutPlanesChanged);
  viewer.addEventListener(Autodesk.Viewing.SHOW_ALL_EVENT, this._onShowAll);
  viewer.addEventListener(Autodesk.Viewing.RENDER_OPTION_CHANGED_EVENT, that.tool.notifyRenderOptionChanged);

  this.HOTKEYS_ID = "Autodesk.Section.Hotkeys";
  var hotkeys = [{
    keycodes: [
    Autodesk.Viewing.KeyCode.ESCAPE],

    onRelease: function () {
      if (that.viewer.getAggregateSelection().length === 0)
      return that.deactivate();
    }
  }];
  viewer.getHotkeyManager().pushHotkeys(this.HOTKEYS_ID, hotkeys);

  this.enableUI();

  //Load the required dependency (and return the pending load as the load completion Promise)
  return this.viewer.loadExtension('Autodesk.CompGeom');
};

proto.enableUI = function () {
  // Invoked when the context menu is about to get opened.
  this.viewer.registerContextMenuCallback('Autodesk.Section', (menu, status) => {
    onContextMenu(this, menu, status);
  });
};

proto.disableUI = function () {
  this.viewer.unregisterContextMenuCallback('Autodesk.Section');
};

/**
 * Unregisters the SectionTool, hotkeys and event handlers.
 *
 * @returns {boolean}
 */
proto.unload = function () {
  var viewer = this.viewer;

  viewer.unregisterContextMenuCallback('Autodesk.Section');

  // remove hotkey
  viewer.getHotkeyManager().popHotkeys(this.HOTKEYS_ID);

  this.destroyUI();

  viewer.removeEventListener(Autodesk.Viewing.SET_VIEW_EVENT, this.onViewerSetView);
  viewer.removeEventListener(Autodesk.Viewing.CUTPLANES_CHANGE_EVENT, this._onCutPlanesChanged);
  viewer.removeEventListener(Autodesk.Viewing.SHOW_ALL_EVENT, this._onShowAll);
  viewer.removeEventListener(Autodesk.Viewing.RENDER_OPTION_CHANGED_EVENT, this.tool.notifyRenderOptionChanged);

  this.viewer.prefs.removeListeners(avp.Prefs3D.DISPLAY_SECTION_HATCHES, this.displaySectionHatches);

  viewer.toolController.deregisterTool(this.tool);
  this.tool = null;

  return true;
};

/**
 * Toggles activeness of section planes.
 *
 * @returns {boolean} Whether the section plane is active or not.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#toggle
 * @public
 */
proto.toggle = function () {
  if (this.isActive()) {
    this.enableSectionTool(false);
  } else {
    var style = this.sectionStyle || "X";
    this.setSectionStyle(style, true);
  }
  return this.isActive(); // Need to check for isActive() again.
};

/**
 * Returns the current type of plane that will cut-though the geometry.
 *
 * @returns {null | string} Either "X" or "Y" or "Z" or "BOX" or null.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#getSectionStyle
 * @public
 */
proto.getSectionStyle = function () {
  return this.sectionStyle;
};

/**
 * Sets the Section plane style.
 *
 * @param {string} style - Accepted values are 'X', 'Y', 'Z' and 'BOX' (in Caps)
 * @param {boolean} [preserveSection] - Whether sending the current style value resets the cut planes.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#setSectionStyle
 * @public
 */
proto.setSectionStyle = function (style, preserveSection) {

  if (this.supportedStyles.indexOf(style) === -1) {
    return false;
  }

  var bActive = this.isActive();
  var bNewStyle = this.sectionStyle !== style || !preserveSection;
  this.sectionStyle = style;

  if (bActive && bNewStyle) {
    this.tool.setSection(style);
  } else
  if (!bActive) {
    this.enableSectionTool(true);
    if (bNewStyle) {
      this.tool.setSection(style);
    } else {
      this.tool.attachControl(true);
    }
  }
  return true;
};

/**
 * Use to set the section from an externally defined plane. For showing with line pattern
 * Tool itself will be disabled when setting the plane
 *
 * @param {Autodesk.Viewing.Math.Vector4} cutplane - send null to clear the section
 */
proto.setSectionFromPlane = function (cutplane) {
  this.deactivate();

  if (cutplane) {
    this.tool.setSectionFromPlane(cutplane);
    this.tool.attachControl(false);
    // LMV-5299
    if (!this.isActive()) {
      this.tool.showPlane(false);
    }
  } else {
    this.tool.clearSection();
    var prevLock = this.viewer.toolController.setIsLocked(false);
    this.enableSectionTool(false);
    this.viewer.toolController.setIsLocked(prevLock);
  }
};

/**
 * Returns the planes belonging only to the Section tool's set*
 */
proto.getSectionPlanes = function () {
  return this.tool.getSectionPlanes();
};

/**
 *
 * @param enable
 * @param keepCutPlanes - keep existing cut planes when deactivating the tool.
 * @returns {boolean}
 * @private
 */
proto.enableSectionTool = function (enable, keepCutPlanes = false) {
  var toolController = this.viewer.toolController,
    isActive = this.tool.isActive();

  if (enable && !isActive) {
    toolController.activateTool("section");
    if (this.sectionToolButton) {
      this.sectionToolButton.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
    }
    return true;

  } else if (!enable && isActive) {
    const prevKeepCutPlanes = this.tool.keepCutPlanesOnDeactivate;
    this.tool.keepCutPlanesOnDeactivate = keepCutPlanes;
    toolController.deactivateTool("section");
    this.tool.keepCutPlanesOnDeactivate = prevKeepCutPlanes;

    if (this.sectionToolButton) {
      this.sectionToolButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
    }
    return true;
  } else if (enable) {
    toolController.activateToolModality("section");
  }
  return false;
};

/**
 * Returns an object that reperesents the state of the section planes
 * currently applied to the viewer by this extension.
 *
 * @param {Autodesk.Viewing.Math.Vector3 | object} [ignoreGlobalOffset=false]
 *
 * @returns {object | null}
 */
proto.getViewValues = function (ignoreGlobalOffset) {

  var boxValues = this.tool.getSectionBoxValues(ignoreGlobalOffset);
  if (boxValues)
  return boxValues;

  var planeValues = this.tool.getSectionPlaneValues(ignoreGlobalOffset);
  if (planeValues)
  return planeValues;

  return null;
};

/**
 * Gets the extension state as a plain object. Invoked automatically by viewer.getState()
 *
 * @param {object} viewerState - Object to inject extension values.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#getState
 * @public
 */
proto.getState = function (viewerState) {
  const model = this.viewer.getFirstModel();
  if (!model || model.is2d()) {
    return;
  }

  viewerState.cutplanes = viewerState.cutplanes || [];
  var planes = this.tool.getSectionPlaneSet();
  for (var i = 0; i < planes.length; i++) {
    viewerState.cutplanes.push(planes[i].toArray());
  }
};

/**
 * Restores the extension state from a given object. Invoked automatically by viewer.restoreState()
 *
 * @param {object} viewerState - Viewer state.
 * @returns {boolean} True if restore operation was successful.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#restoreState
 * @public
 */
proto.restoreState = function (viewerState) {
  // If viewerState doesn't contain cutplanes, we should leave it as is.
  if (!viewerState.cutplanes) {
    return;
  }
  const cutplanes = this.getSectionPlanes();
  this.setSectionFromPlane(null); // Unload any existing planes first
  if (cutplanes.length === 1) {
    this.setSectionFromPlane(cutplanes[0]);
  }

  return true;
};

/**
 * @private
 */
proto._onCutPlanesChanged = function /*event*/ () {
  this.tool.notifyCutplanesChanged();
};


/**
 * @private
 */
proto._onShowAll = function /*event*/ () {
  this.deactivate();
};

/**
 * Set a section box around the passed in box.
 * This method will also enable the section tool.
 *
 * @param {Autodesk.Viewing.Math.Box3} box - used to set the section box.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#setSectionBox
 * @public
 */
proto.setSectionBox = function (box) {
  if (!box) return;
  this.enableSectionTool(true);
  if (this.tool.setSectionBox(box)) {
    this.activeStatus = true;
    this.viewer.clearSelection();

    // Update current mode and button state.
    this.mode = 'box';
    this.buttons[this.mode]?.setState(AVU.Button.State.ACTIVE);
  } else {
    this.enableSectionTool(false);
  }
};

/**
 * Place a section plane on the Intersection.
 * This method will also enable the section tool.
 *
 * @param {Autodesk.Viewing.Math.Vector3} normal - plane normal.
 * @param {Autodesk.Viewing.Math.Vector3} point - position to place the plane.
 * @param enableRotationGizmo
 * @alias Autodesk.Viewing.Extensions.SectionExtension#setSectionPlane
 * @public
 */
proto.setSectionPlane = function (normal, point, enableRotationGizmo) {
  if (!normal || !point) return;
  this.enableSectionTool(true);
  if (this.tool.setSectionPlane(normal, point, enableRotationGizmo)) {
    this.activeStatus = true;
    this.viewer.clearSelection();

    // Update current mode and button state.
    this.mode = this.calculateNearestAxis(normal);
    this.buttons[this.mode]?.setState(AVU.Button.State.ACTIVE);
  } else {
    this.enableSectionTool(false);
  }
};

/**
 * Given a normal, return the x, y or z, according to the nearest world axis.
 *
 * @param {Autodesk.Viewing.Math.Vector3} normal - plane normal.
 */
proto.calculateNearestAxis = function (normal) {
  // absolute values for direction cosines, bigger value equals closer to basis axis
  const xn = Math.abs(normal.x);
  const yn = Math.abs(normal.y);
  const zn = Math.abs(normal.z);

  if (xn >= yn && xn >= zn) {
    return 'x';
  } else if (yn > xn && yn >= zn) {
    return 'y';
  } else {
    return `z`;
  }
};

/**
 * @private
 */
proto.onViewerSetView = function /*event*/ () {
  this.deactivate();
};

/**
 * @param toolbar
 */
proto.onToolbarCreated = function (toolbar) {
  this.sectionToolButton = new AVU.ComboButton("toolbar-sectionTool");
  this.sectionToolButton.setToolTip('Section analysis');
  this.sectionToolButton.setIcon("adsk-icon-section-analysis");
  this.createSubmenu(this.sectionToolButton);

  // place section tool before reset tool
  const modelTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);
  if (modelTools) {
    var resetTool = modelTools.getControl("toolbar-resetTool");
    if (resetTool) {
      modelTools.addControl(this.sectionToolButton, { index: modelTools.indexOf(resetTool.getId()) });
    } else {
      modelTools.addControl(this.sectionToolButton, { index: 0 });
    }
  }
};

/**
 *
 * @param parentButton
 * @private
 */
proto.createSubmenu = function (parentButton)
{
  var that = this;
  var viewer = this.viewer;

  /**
   * @param button
   * @param name
   * @private
   */
  function createNavToggler(button, name) {
    that.buttons[name] = button;

    return function () {
      var state = button.getState();
      var enable = function () {
        if (button instanceof AVU.ComboButton === false) {
          that.activate(name);
        } else {
          that.enableSectionTool(true);
          that.tool.attachControl(true);
        }
      };

      const sectionType = name.toLowerCase().indexOf('box') !== -1 ? 'Box' : 'Plane';

      if (state === AVU.Button.State.INACTIVE) {
        button.setState(AVU.Button.State.ACTIVE);
        // Long initialization may cause issues on touch enabled devices, make it async
        if (Autodesk.Viewing.isMobileDevice()) {
          setTimeout(enable, 1);
        } else {
          enable();
        }
        analytics.track('viewer.section', {
          from: 'Toolbar',
          type: sectionType,
          action: 'Enable'
        });
      } else if (state === AVU.Button.State.ACTIVE) {
        button.setState(AVU.Button.State.INACTIVE);
        that.deactivate();
        analytics.track('viewer.section', {
          from: 'Toolbar',
          type: sectionType,
          action: 'Disable'
        });
      }
      that.sectionStyle = name.toUpperCase();
    };
  }

  /**
   *
   */
  function updateSectionButtons() {
    var areVectorsEqual = function () {
      var v = new THREE.Vector3();
      return function (a, b, sqtol) {
        v.subVectors(a, b);
        return v.lengthSq() < sqtol;
      };
    }();

    var unitx = new THREE.Vector3(1, 0, 0);
    var unity = new THREE.Vector3(0, 1, 0);
    var unitz = new THREE.Vector3(0, 0, 1);
    var right = viewer.autocam.getWorldRightVector();
    var up = viewer.autocam.getWorldUpVector();
    var front = viewer.autocam.getWorldFrontVector();

    var tol = 0.0001;
    if (areVectorsEqual(up, unitx, tol)) {
      that.sectionYButton.setIcon("adsk-icon-plane-x");
    } else if (areVectorsEqual(up, unitz, tol)) {
      that.sectionYButton.setIcon("adsk-icon-plane-z");
    } else {
      that.sectionYButton.setIcon("adsk-icon-plane-y");
    }

    if (areVectorsEqual(right, unity, tol)) {
      that.sectionXButton.setIcon("adsk-icon-plane-y");
    } else if (areVectorsEqual(right, unitz, tol)) {
      that.sectionXButton.setIcon("adsk-icon-plane-z");
    } else {
      that.sectionXButton.setIcon("adsk-icon-plane-x");
    }

    if (areVectorsEqual(front, unitx, tol)) {
      that.sectionZButton.setIcon("adsk-icon-plane-x");
    } else if (areVectorsEqual(front, unity, tol)) {
      that.sectionZButton.setIcon("adsk-icon-plane-y");
    } else {
      that.sectionZButton.setIcon("adsk-icon-plane-z");
    }

  }

  var sectionXButton = this.sectionXButton = new AVU.Button("toolbar-sectionTool-x");
  sectionXButton.setToolTip('Add X plane');
  sectionXButton.setIcon("adsk-icon-plane-x");
  sectionXButton.onClick = createNavToggler(sectionXButton, 'x');
  parentButton.addControl(sectionXButton);

  var sectionYButton = this.sectionYButton = new AVU.Button("toolbar-sectionTool-y");
  sectionYButton.setToolTip('Add Y plane');
  sectionYButton.setIcon("adsk-icon-plane-y");
  sectionYButton.onClick = createNavToggler(sectionYButton, 'y');
  parentButton.addControl(sectionYButton);

  var sectionZButton = this.sectionZButton = new AVU.Button("toolbar-sectionTool-z");
  sectionZButton.setToolTip('Add Z plane');
  sectionZButton.setIcon("adsk-icon-plane-z");
  sectionZButton.onClick = createNavToggler(sectionZButton, 'z');
  parentButton.addControl(sectionZButton);

  var sectionBoxButton = this.sectionBoxButton = new AVU.Button("toolbar-sectionTool-box");
  sectionBoxButton.setToolTip('Add box');
  sectionBoxButton.setIcon("adsk-icon-box");
  sectionBoxButton.onClick = createNavToggler(sectionBoxButton, 'box');
  parentButton.addControl(sectionBoxButton);

  const model = viewer.getFirstModel();
  if (model?.is3d()) {
    updateSectionButtons();
  } else {
    viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, updateSectionButtons, { once: true });
  }
};

/**
 * @private
 */
proto.destroyUI = function () {

  if (this.sectionToolButton) {
    this.sectionToolButton.removeFromParent();
    this.sectionToolButton = null;

    this.buttons = {};
  }
};

/**
 * Activates a section plane for user to interact with.
 * It performs the same action as the UI button.
 *
 * @param {string} mode - Accepted values are 'x', 'y', 'z' and 'box' (in lowercase)
 * @returns {boolean} - true if the activation was successful.
 * @alias Autodesk.Viewing.Extensions.SectionExtension#activate
 * @public
 */
proto.activate = function (mode) {
  if (this.activeStatus && this.mode === mode) {
    return;
  }
  this.enableSectionTool(true);
  switch (mode) {
    default:
    case 'x':
      this.tool.setSection('X');
      this.mode = 'x';
      break;
    case 'y':
      this.tool.setSection('Y');
      this.mode = 'y';
      break;
    case 'z':
      this.tool.setSection('Z');
      this.mode = 'z';
      break;
    case 'box':
      this.tool.setSection('BOX');
      this.mode = 'box';
      break;
  }
  this.activeStatus = true;
  return true;
};

/**
 * Removes the section plane/box from the 3D canvas.
 *
 * @param keepCutPlanes - keep existing cut planes when deactivating the tool. Default is false.
 *
 * @alias Autodesk.Viewing.Extensions.SectionExtension#deactivate
 * @returns {boolean} - returns true if deactivated, false otherwise.
 * @public
 */
proto.deactivate = function (keepCutPlanes) {
  if (this.activeStatus) {
    this.tool.setActiveMode("");
    this.enableSectionTool(false, keepCutPlanes);
    this.activeStatus = false;
    return true;
  }
  return false;
};

/**
 * Turns display hatches on or off.
 * @param {boolean} value - if true all section planes will get the hatches applied, otherwise, the section planes will not have the hatches.
 */
proto.displaySectionHatches = function (value) {

  this.tool.setDisplaySectionHatches(value);

  if (this.activeStatus) {
    const planes = this.getSectionPlanes();
    this.tool.clearSection();
    // update the hatches for each existing plane
    planes.forEach((plane) => {
      this.tool.updateCapMeshes(new THREE.Plane().setComponents(plane.x, plane.y, plane.z, plane.w));
    });
  }
};


/**
 * Invoked when the context menu is about to be created.
 * Adds additional entries to the context menu.
 *
 * @param section
 * @param menu
 * @param status
 * @private
 */
function onContextMenu(section, menu, status) {

  if (!status.hasSelected)
  return;

  const viewer = section.viewer;

  const aggregateSelection = viewer.getAggregateSelection();

  // This case is relevant mostly for hypermodel viewing, when there are 2D planes living in a 3D scene.
  // In this case, it make no sense to allow "section-box" to a plane.
  if (aggregateSelection.length === 1 && aggregateSelection[0].model.is2d()) {
    return;
  }

  const bbox = viewer.impl.selector.getSelectionBounds();

  const menuEntry = {
    title: "Section",
    target: []
  };

  menuEntry.target.push({
    title: 'Section Box',
    target: () => {
      section.setSectionBox(bbox);
      analytics.track('viewer.section', {
        from: 'Contextual',
        type: 'Box',
        action: 'Enable'
      });
    }
  });

  let nodesWithFragments = [];

  for (const perModelSelection of aggregateSelection) {
    const instanceTree = perModelSelection.model.getObjectTree();

    if (!instanceTree) {
      continue;
    }

    // gather each node that has fragments
    const dbIds = [];
    perModelSelection.selection.forEach((nodeId) => {
      instanceTree.enumNodeChildren(nodeId, (id) => {
        if (instanceTree.getFragmentCount(id) > 0) {
          dbIds.push(id);
        }
      }, true);
    });

    nodesWithFragments.push(dbIds);
  }

  const modelIds = aggregateSelection.map((perModelSelection) => perModelSelection.model.id);
  const intersection = viewer.impl.hitTest(status.canvasX, status.canvasY, false, modelIds.length > 1 ? nodesWithFragments : nodesWithFragments[0], modelIds);

  // Ensure that the selected object is the one that received the context click.
  if (intersection?.face?.normal && intersection.model && nodesWithFragments.some((nodes) => nodes.indexOf(intersection.dbId) !== -1)) {

    const worldMatrix = new THREE.Matrix4();
    intersection.model.getFragmentList()?.getWorldMatrix(intersection.fragId, worldMatrix);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    const normal = intersection.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    menuEntry.target.push({
      title: 'Section Plane',
      target: () => {
        section.setSectionPlane(normal, intersection.point, false);
        analytics.track('viewer.section', {
          from: 'Contextual',
          type: 'Plane',
          action: 'Enable'
        });
      }
    });
  }

  menu.push(menuEntry);
}


// Make the extension available
Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Section', SectionExtension);
})();

Autodesk.Extensions.Section = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Section.js.map