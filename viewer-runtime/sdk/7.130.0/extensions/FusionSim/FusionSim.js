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

/***/ "./extensions/FusionSim/GalleryPanel.js"
/*!**********************************************!*\
  !*** ./extensions/FusionSim/GalleryPanel.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GalleryPanel: () => (/* binding */ GalleryPanel)
/* harmony export */ });
/* harmony import */ var _SimulationDef_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SimulationDef.js */ "./extensions/FusionSim/SimulationDef.js");


'use strict';

var av = Autodesk.Viewing;
var avu = av.UI;
var i18n = av.i18n;

var GalleryPanel = function () {
  // helper methods
  function styleBuilder(element, styleObject) {
    if (!element || !styleObject) return;
    var cssText = element.style.cssText.trim();
    var isEndingWithColon = cssText.substring(cssText.length - 1) === ";";
    if (!isEndingWithColon) {
      cssText = cssText + ";";
    }
    var styleString = [];
    for (var style in styleObject) {
      styleString[styleString.length] = [style, styleObject[style]].join(':');
    }
    styleString = styleString.join(';');
    element.style.cssText = styleString;
  }

  function preparePanel() {
    var that = this,labelUndeformed,optUndeformed,resultGroup,legend,resultTypes,resultSteps,divColorScale,colorScale,colorScaleTopText,colorScaleBottomText, /*line1,*/line2,tbl,tblBody;
    avu.DockingPanel.prototype.initialize.call(that);
    var container = that.container;
    container.classList.add('property-panel', 'simulation-container', 'position-' + (that.position || "left") + '-corner');
    container.dockRight = true;

    var _document = that.getDocument();
    legend = that.legend = _document.createElement('div');
    var docfrag = _document.createDocumentFragment();

    //results div//////////
    var divResults = _document.createElement('div');
    divResults.classList.add('sim-div-Results');

    resultGroup = that.resultsGroup = _document.createElement("select");
    resultGroup.classList.add('simulation-resultGroup');
    divResults.appendChild(resultGroup);

    resultTypes = that.resultTypes = _document.createElement("select");
    resultTypes.classList.add('simulation-resultTypes');
    resultTypes.id = 'resultTypes';
    divResults.appendChild(resultTypes);

    resultSteps = that.resultSteps = document.createElement('select');
    resultSteps.classList.add('simulation-resultSteps');
    resultSteps.id = 'resultSteps';
    divResults.appendChild(resultSteps);

    docfrag.appendChild(divResults);
    ///////////////////////
    //sim options
    var divResultsOption = that.divResultsOption = _document.createElement('div');
    divResultsOption.classList.add('sim-div-options');
    optUndeformed = that.optUndeformed = _document.createElement("input");
    optUndeformed.classList.add('sim-undeformedOption');
    optUndeformed.setAttribute("type", "checkbox");
    optUndeformed.setAttribute("name", "optUndeformed");
    optUndeformed.setAttribute("id", "Undeformed");
    optUndeformed.addEventListener('change', function (e) {// When someone clicks on it
      var activeLoadCase = that.simDef.loadCases[that.simDef.activeLoadCaseKey];
      if (activeLoadCase === null) return;
      if (activeLoadCase.undeformedResults === -1)
      return;
      if (that.optUndeformed.checked) {
        //show undeformed state
        that.viewer.show(activeLoadCase.undeformedResults);
      } else
      {
        that.viewer.hide(activeLoadCase.undeformedResults);
      }
    });

    optUndeformed.checked = false;
    divResultsOption.appendChild(optUndeformed);
    //do this after you append it
    optUndeformed.checked = false;

    labelUndeformed = that.labelUndeformed = _document.createElement('label');
    labelUndeformed.classList.add('sim-undeformedOptionText');
    labelUndeformed.htmlFor = "Undeformed";
    labelUndeformed.setAttribute("data-i18n", "Show Undeformed Model");
    labelUndeformed.textContent = i18n.translate("Show Undeformed Model");
    divResultsOption.appendChild(labelUndeformed);
    docfrag.appendChild(divResultsOption);
    ///////////////////////

    //      line1 = that.line1 = document.createElement("hr");
    //      line1.classList.add('sim-line1');
    //      docfrag.appendChild(line1);

    //color scale div
    divColorScale = that.divColorScale = _document.createElement("div");
    divColorScale.classList.add('sim-div-colorscale');
    divColorScale.classList.add('sim-div-colorscale-top1');
    colorScale = that.colorScale = _document.createElement("div");
    colorScale.classList.add('simulation-colorscale');
    divColorScale.appendChild(colorScale);

    colorScaleTopText = that.colorScaleTopText = _document.createElement("div");
    colorScaleTopText.classList.add('sim-colorScaleTopText');
    colorScaleTopText.textContent = "- 3333";
    divColorScale.appendChild(colorScaleTopText);

    colorScaleBottomText = that.colorScaleBottomText = _document.createElement("div");
    colorScaleBottomText.classList.add('sim-colorScaleBottomText');
    colorScaleBottomText.textContent = "- 3333";
    divColorScale.appendChild(colorScaleBottomText);
    docfrag.appendChild(divColorScale);
    ////////////////////////////////////

    line2 = that.line2 = _document.createElement("hr");
    line2.classList.add('sim-line2');
    docfrag.appendChild(line2);

    var divTable = _document.createElement('div');
    divTable.classList.add('sim-div-Table');
    divTable.addEventListener('click', function (e) {// When someone clicks on it
      divTable.classList.add('sim-div-Table-Collapse');
      container.classList.add('simulation-container-Collapse');
      divColorScale.classList.add('sim-div-colorscale-Collapse');
    });

    divColorScale.addEventListener('click', function (e) {// When someone clicks on it
      divTable.classList.remove('sim-div-Table-Collapse');
      container.classList.remove('simulation-container-Collapse');
      divColorScale.classList.remove('sim-div-colorscale-Collapse');
    });

    tbl = that.tbl = _document.createElement("table");
    tblBody = that.tblBody = _document.createElement("tbody");
    tbl.appendChild(tblBody);
    tbl.classList.add('sim-table');
    divTable.appendChild(tbl);
    docfrag.appendChild(divTable);

    legend.appendChild(docfrag);

    container.appendChild(legend);
  }

  function getPropertyValue(properties, propertyName) {
    for (var i = 0; i < properties.length; ++i) {
      var property = properties[i];
      if (property.displayName === propertyName) {
        return property.displayValue;
      }
    }
    return null;
  }

  function toggleDisable(element, len) {
    var resultGroupDisable = false;
    var style = '""';
    if (len <= 1) {
      resultGroupDisable = true;
      style = "none";
    }
    element.disabled = resultGroupDisable;
    styleBuilder(element, {
      "-webkit-appearance": style,
      "-moz-appearance": style,
      appearance: style
    });
  }

  // GalleryPanel class
  class GalleryPanel extends avu.DockingPanel {
    constructor(viewer, options) {
      super(viewer.container, 'Simulation-Panel', 'Simulation Results', { globalManager: viewer.globalManager });
      var that = this;
      options = options || {};
      that.viewer = viewer;
      that.simDef = null;
      // panel position configuration.
      that.position = options.position || "right";
    }
  }

  var prototype = GalleryPanel.prototype;

  prototype.initialize = function () {
    var that = this;
    preparePanel.call(that);
    that.resultsGroup.addEventListener('change', function (event) {
      var simDef = that.simDef;
      var activeLoadCase = simDef.loadCases[that.simDef.activeLoadCaseKey];
      that.viewer.hide(activeLoadCase.resultsNode);
      var caller = 'fillResultTypes';
      if (simDef.modalAnalysis) {
        caller = 'fillModalResultTypes';
      } else if (simDef.analysisType === simDef.SimulationStudies.NLSS) {
        caller = 'fillNLSSResultTypes';
      }
      that[caller](simDef.activeLoadCaseKey, that.resultsGroup.value);
      setTimeout(function () {
        that.setSimObjectsVisibility();
      }, 100);
    });
    that.resultTypes.addEventListener('change', function () {
      var activeLoadCase = that.simDef.loadCases[that.simDef.activeLoadCaseKey];
      that.viewer.hide(activeLoadCase.resultsNode);
      that.setSimObjectsVisibility();
    });
    that.resultSteps.addEventListener('change', function () {
      var activeLoadCase = that.simDef.loadCases[that.simDef.activeLoadCaseKey];
      that.viewer.hide(activeLoadCase.resultsNode);
      that.updateType();
      that.setSimObjectsVisibility();
    });
  };

  prototype.updateType = function () {
    var selectedStep = document.getElementById('resultSteps').selectedIndex;
    document.getElementById('resultTypes').selectedIndex = selectedStep;
  };

  prototype.setSimulationDef = function (simDef) {
    var that = this,studyNode,studyName,tblBody,viewer;
    that.simDef = simDef;
    studyNode = simDef.studyNode * 1;
    function onStudyPropertiesRetrieved(studyNode) {
      var name = getPropertyValue(studyNode.properties, "Name");
      that.setTitle(name);
    }

    //hide undeformed option if neccessary
    if (simDef.undeformedResults === -1) {
      that.optUndeformed.classList.add('sim-hide');
      that.labelUndeformed.classList.add('sim-hide');
      that.divColorScale.classList.remove('sim-div-colorscale-top1');
      that.divColorScale.classList.add('sim-div-colorscale-top2');
    } else {
      if (simDef.analysisType === simDef.SimulationStudies.NLSS) {
        that.resultSteps.classList.remove('sim-hide');
        that.divResultsOption.classList.add('sim-div-options-NLSS');
        that.divColorScale.classList.remove('sim-div-colorscale-top1');
        that.divColorScale.classList.add('sim-div-colorscale-top1-NLSS');
        that.colorScale.classList.add('simulation-colorscale-NLSS');
        that.colorScaleTopText.classList.add('sim-colorScaleTopText-NLSS');
        that.colorScaleBottomText.classList.add('sim-colorScaleBottomText-NLSS');
      } else {
        that.resultSteps.classList.add('sim-hide');
        that.divResultsOption.classList.remove('sim-div-options-NLSS');
        that.divColorScale.classList.add('sim-div-colorscale-top1');
        that.divColorScale.classList.remove('sim-div-colorscale-top1-NLSS');
        that.colorScale.classList.remove('simulation-colorscale-NLSS');
        that.colorScaleTopText.classList.remove('sim-colorScaleTopText-NLSS');
        that.colorScaleBottomText.classList.remove('sim-colorScaleBottomText-NLSS');
      }
    }

    function onError(status, message, data) {
    }

    that.viewer.getProperties(studyNode, onStudyPropertiesRetrieved, onError);
    //result groups
    studyName = i18n.translate(simDef.studyName());
    // info: Analysis type
    tblBody = that.tblBody;
    if (!that.rowType) {
      var rowsToInsert = [
      {
        name: 'rowType',
        content: [i18n.translate("Analysis Type"), studyName]
      },
      {
        name: 'rowNodes',
        content: [i18n.translate("Nodes"), '1872']
      },
      {
        name: 'rowElements',
        content: [i18n.translate("Elements"), '1084']
      },
      {
        name: 'rowMin',
        content: [i18n.translate("Min"), '0.000E+02 MPa']
      },
      {
        name: 'rowMax',
        content: [i18n.translate("Max"), '5.117E+02 MPa']
      }];

      rowsToInsert.forEach(function (row) {
        that[row.name] = tblBody.insertRow(-1);
        row.content.forEach(function (cellValue) {
          that[row.name].insertCell(-1).textContent = cellValue;
        });
      });
    } else {
      that.rowType.cells[1].textContent = studyName;
    }

    viewer = that.viewer;

    viewer.model.getObjectTree(function (instanceTree) {
      that.instanceTree = instanceTree;
      var calleeResultTypes, calleeResultsGroup;
      if (simDef.analysisType === simDef.SimulationStudies.MODAL || simDef.analysisType === simDef.SimulationStudies.BUCKLING) {
        calleeResultsGroup = "fillResultsGroup";
        calleeResultTypes = "fillModalResultTypes";
      } else if (simDef.analysisType === simDef.SimulationStudies.NLSS) {
        calleeResultsGroup = "fillNLSSResultsGroup";
        calleeResultTypes = "fillNLSSResultTypes";
      } else {
        calleeResultsGroup = "fillResultsGroup";
        calleeResultTypes = "fillResultTypes";
      }
      that[calleeResultsGroup](that.simDef.activeLoadCaseKey);
      that[calleeResultTypes](that.simDef.activeLoadCaseKey, that.resultsGroup.value);
      setTimeout(function () {
        simDef.simExt.showResultsDlg(true);
        simDef.simExt.applySettings();
        that.setSimObjectsVisibility();
      }, 500);
    });

    //elements & nodes
    var activeLoadCase = that.simDef.loadCases[that.simDef.activeLoadCaseKey];
    function onResultsPropertiesRetrieved(resultsNode) {
      var elements = getPropertyValue(resultsNode.properties, "Elements");
      var nodes = getPropertyValue(resultsNode.properties, "Nodes");
      that.rowElements.cells[1].innerText = elements;
      that.rowNodes.cells[1].innerText = nodes;
    }

    if (activeLoadCase) {
      var resultsNode = +activeLoadCase.resultsNode;
      viewer.getProperties(resultsNode, onResultsPropertiesRetrieved, onError);
    }

    if (simDef.analysisType === simDef.SimulationStudies.NLSS) that.updateType();
  };

  prototype.processNodes = function (instanceTree, onProcessed) {
    var that = this;
    var nodeIdsToProcess = [];
    var simDef = that.simDef;
    var viewer = that.viewer;
    var loadCase = null;
    if (!simDef) {
      simDef = new _SimulationDef_js__WEBPACK_IMPORTED_MODULE_0__.SimulationDef();
    } else {
      simDef.reset();
    }
    instanceTree.enumNodeChildren(instanceTree.getRootId(), function (dbId) {
      nodeIdsToProcess[nodeIdsToProcess.length] = dbId;
    }, true);
    function processNodeId(node, onNodeProcessed) {
      function onPropertiesRetrieved(result) {
        //force to hide until all init. that.viewer.hide(node);
        var properties = result.properties;
        var name = getPropertyValue(result.properties, 'A1C6011B-E1A6-4ADF-975D-A0003C592F87');
        if (name) {
          var bSimNode = true;
          switch (name) {
            case "SIM_STUDY":
              simDef.studyNode = node;
              var type = getPropertyValue(result.properties, "Study Type");
              simDef.analysisType = type;
              break;
            case "SIM_POINT_MASSES":
              simDef.pointMasssesNode = node;
              break;
            case "SIM_POINT_MASS":
              simDef.pointMassNodes.push(node);
              break;
            case "SIM_CONNECTORS":
              simDef.connectorsNode = node;
              break;
            case "SIM_CONNECTOR":
              //case "SIM_BOLT_CONNECTOR":
              //case "SIM_SPRING_CONNECTOR":
              simDef.connectorNodes.push(node);
              break;
            case "SIM_LOAD_CASE":
              loadCase = simDef.addLoadCase(getPropertyValue(result.properties, 'Name'), node, node);
              break;
            case "SIM_CONSTRAINTS":
              if (loadCase == null) {
                loadCase = simDef.addLoadCase(i18n.translate("Load Case:1"), 0, 0);
              }
              loadCase.constraintsNode = node;
              break;
            case "SIM_CONSTRAINT":
              loadCase.constraintNodes.push(node);
              break;
            case "SIM_LOADS":
              if (loadCase == null) {
                loadCase = simDef.addLoadCase(i18n.translate("Load Case:1"), 0, 0);
              }
              loadCase.loadsNode = node;
              break;
            case "SIM_LOAD":
              loadCase.loadNodes.push(node);
              break;
            case "SIM_RESULTS_SCALAR_PLOT":
              if (loadCase == null) {
                loadCase = simDef.addLoadCase(i18n.translate("Load Case:1"), 0, 0);
              }
              if (simDef.analysisType === simDef.SimulationStudies.LSS || simDef.analysisType === simDef.SimulationStudies.NLSS || simDef.analysisType === simDef.SimulationStudies.THERMAL ||
              simDef.analysisType === simDef.SimulationStudies.THERMALSTRESS || simDef.analysisType === simDef.SimulationStudies.SHAPEGENERATOR) {
                loadCase.associateResult(getPropertyValue(properties, "Name"), node);
              } else {//Buckling, Modal
                loadCase.associateModalResult(getPropertyValue(properties, "Name"), node);
              }
              break;
            case "SIM_RESULTS_GROUP":
              if (loadCase == null) {
                loadCase = simDef.addLoadCase(i18n.translate("Load Case:1"), 0, 0);
              }
              if (simDef.analysisType === simDef.SimulationStudies.LSS || simDef.analysisType === simDef.SimulationStudies.NLSS || simDef.analysisType === simDef.SimulationStudies.THERMAL ||
              simDef.analysisType === simDef.SimulationStudies.THERMALSTRESS || simDef.analysisType === simDef.SimulationStudies.SHAPEGENERATOR) {
                loadCase.associateResultGroup(getPropertyValue(properties, "Name"), node);
              }
              break;
            case "SIM_RESULTS":
              if (loadCase == null) {
                loadCase = simDef.addLoadCase(i18n.translate("Load Case:1"), 0, 0);
              }
              loadCase.resultsNode = node;
              //viewer.hide(node);
              break;
            case "SIM_RESULTS_UNDEFORMED_FEATURE_EDGES_PLOT":
              if (loadCase == null) {
                loadCase = simDef.addLoadCase(i18n.translate("Load Case:1"), 0, 0);
              }
              loadCase.undeformedResults = node;
              //viewer.hide(node);
              break;
            case "SIM_RESULTS_SCALAR_PLOT_BODY":
            case "SIM_RESULTS_SAMPLE":
              // Nothing for now!
              break;
          }
          if (bSimNode === true) {
            simDef.simNodes.push(node);
          }
        } else
        {
          simDef.modelNodes.push(node);
        }
        onNodeProcessed();
      }

      function onError(status, message, data) {
        onNodeProcessed();
      }

      if (node && viewer) {
        viewer.getProperties(node, onPropertiesRetrieved, onError);
      }
    }

    // Process the nodes one by one.
    function processNext() {
      if (nodeIdsToProcess.length > 0) {
        processNodeId(nodeIdsToProcess.shift(), processNext);
      } else {
        // No more nodes to process - call the provided callback.
        onProcessed(simDef);
      }
    }

    processNext();
  };

  prototype.initModel = function (instanceTree, simExt) {
    var that = this;
    var viewer = that.viewer;
    if (!viewer) return;
    that.processNodes(instanceTree, function (simDef) {
      simDef.simExt = simExt;
      that.setSimulationDef(simDef);
    });
    that.addEventListener(that.viewer, av.SELECTION_CHANGED_EVENT, function (e) {
      var nodes = e.nodeArray;
      if (nodes) {
        that.handleClick(nodes[0]);

        //     for (var k = 0; k < nodes.length; k++)
        //     {
        //         if(that.isModelNode(nodes[k]))
        //         {
        //           that.viewer.hide(that.simDef.resultsNode);
        //           break;
        //         }
        //      }
      }
    });
  };

  prototype.fillResultsGroup = function (loadCaseKey) {

    if (!loadCaseKey)
    return;

    var that = this;
    var simDef = that.simDef;
    var loadCase = simDef.loadCases[loadCaseKey];
    var resultsGroup = that.resultsGroup;

    const _document = that.getDocument();
    resultsGroup.options.length = 0;
    var groupKeys = Object.keys(simDef.analysisType === simDef.SimulationStudies.MODAL || simDef.analysisType === simDef.SimulationStudies.BUCKLING ? loadCase.modalResults : loadCase.resultGroups);
    for (var i = 0; i < groupKeys.length; i++) {
      var item = _document.createElement("option");
      item.value = groupKeys[i];
      var name = simDef.analysisType === simDef.SimulationStudies.MODAL || simDef.analysisType === simDef.SimulationStudies.BUCKLING ? groupKeys[i] : loadCase.resultGroups[groupKeys[i]];
      item.setAttribute("data-i18n", name);
      item.textContent = i18n.translate(name);
      resultsGroup.add(item);
    }

    toggleDisable(resultsGroup, resultsGroup.options.length, false);
  };

  prototype.fillNLSSResultsGroup = function (loadCaseKey) {
    var that = this;
    var simDef = that.simDef;
    var loadCase = simDef.loadCases[loadCaseKey];
    var resultsGroup = that.resultsGroup;

    const _document = that.getDocument();
    resultsGroup.options.length = 0;
    var groupKeys = Object.keys(loadCase.resultGroups);
    var groupBuffer;
    groupBuffer = [];
    for (var i = 0; i < groupKeys.length; i++) {
      var name = loadCase.resultGroups[groupKeys[i]];
      if (groupBuffer.includes(name)) continue;
      groupBuffer.push(name);

      var item = _document.createElement("option");
      item.value = name;
      item.setAttribute("data-i18n", name);
      item.textContent = i18n.translate(name);
      resultsGroup.add(item);
    }

    toggleDisable(resultsGroup, resultsGroup.options.length, false);
  };

  prototype.fillResultTypes = function (loadCaseKey, resultGroupKey) {
    var that = this;
    var viewer = that.viewer;
    var resultTypes = that.resultTypes;
    var resultsGroup = that.resultsGroup;
    var loadCase = that.simDef.loadCases[loadCaseKey];

    resultTypes.options.length = 0;
    var node = +resultGroupKey;

    function onError(status, message, data) {

      // onNodeProcessed();
    }
    function onGroupPropertiesRetrieved(groupResult) {
      var key = "Result group";
      var resultGroup = getPropertyValue(groupResult.properties, key);

      const _document = that.getDocument();
      function onResultPropertiesRetrieved(resultType) {
        var resultTypeGroup = getPropertyValue(resultType.properties, key);
        if (resultTypeGroup === resultGroup) {
          var item = _document.createElement("option");
          item.value = resultType.dbId;
          var name = loadCase.resultTypes[resultType.dbId];
          item.setAttribute("data-i18n", name);
          item.textContent = i18n.translate(name);
          resultTypes.add(item);
          toggleDisable(resultTypes, resultTypes.options.length, resultsGroup.options.length === 0);
        }
      }

      //result types
      var keys = Object.keys(loadCase.resultTypes);
      for (var i = 0; i < keys.length; i++) {
        var resultNode = +keys[i];
        viewer.getProperties(resultNode, onResultPropertiesRetrieved, onError);
      }
    }

    viewer.getProperties(node, onGroupPropertiesRetrieved, onError);
  };

  prototype.fillModalResultTypes = function (loadCaseKey, resultGroupKey) {
    var that = this;
    var resultTypes = that.resultTypes;
    var resultsGroup = that.resultsGroup;
    var loadCase = that.simDef.loadCases[loadCaseKey];

    resultTypes.options.length = 0;
    var resultGroup = resultGroupKey;

    const _document = that.getDocument();
    function onResultPropertiesRetrieved(resultType) {
      var resultTypeGroup = getPropertyValue(resultType.properties, "Result type");
      if (resultTypeGroup === resultGroup) {
        var item = _document.createElement("option");
        item.value = resultType.dbId;
        var resultMode = getPropertyValue(resultType.properties, "Mode");
        var name = resultMode;
        item.setAttribute("data-i18n", name);
        item.textContent = name; //Autodesk.Viewing.i18n.translate(name); //Mode 1: 200 Hz -> result from translate 200 Hz -> not acceptable
        that.resultTypes.add(item);
        //that.simDef.associateResult(name, resultType.dbId);
        toggleDisable(resultTypes, resultTypes.options.length, resultsGroup.options.length === 0);
      }
    }

    function onError(status, message, data) {

      // onNodeProcessed();
    }
    //result types
    var keys = loadCase.modalResults[resultGroup] || [];
    for (var i = 0; i < keys.length; i++) {
      var resultNode = +keys[i];
      that.viewer.getProperties(resultNode, onResultPropertiesRetrieved, onError);
    }

  };



  prototype.fillNLSSResultTypes = function (loadCaseKey, resultGroupKey) {
    var that = this;
    var viewer = that.viewer;
    var uiResultTypes = that.resultTypes;
    var uiResultsSteps = that.resultSteps;
    var loadCase = that.simDef.loadCases[loadCaseKey];
    const _document = that.getDocument();

    var node = +resultGroupKey;

    function onError(status, message, data) {

      // onNodeProcessed();
    }
    function onGroupPropertiesRetrieved(groupResult) {
      function onResultPropertiesRetrieved(resultType) {
        var itemType = _document.createElement("option");
        itemType.value = resultType.dbId;
        var itemTypeName = getPropertyValue(resultType.properties, "Result type");
        itemType.setAttribute('data-i18n', itemTypeName);
        itemType.textContent = i18n.translate(itemTypeName);
        uiResultTypes.add(itemType);
        toggleDisable(uiResultTypes, 0);

        var itemStep = _document.createElement("option");
        itemStep.value = resultType.dbId;

        // we do not want to display original display name in "Step X: X" format
        // since for the NLSS, step values and units are irrelevant.
        // Instead, we will parse its name to "Step X" format
        var itemStepName = getPropertyValue(resultType.properties, "Mode");
        var indexDelimiter = itemStepName.indexOf(':');
        if (indexDelimiter != -1) itemStepName = itemStepName.substr(0, indexDelimiter);

        itemStep.setAttribute('data-i18n', itemStepName);
        itemStep.textContent = i18n.translate(itemStepName);
        uiResultsSteps.add(itemStep);
      }

      // first, remove all old entries
      _document.getElementById("resultTypes").options.length = 0;
      _document.getElementById("resultSteps").options.length = 0;

      const keysGroup = Object.keys(loadCase.resultGroups).map((e) => loadCase.resultGroups[e]);
      var keysTypes = Object.keys(loadCase.resultTypes);
      for (var i = 0; i < keysGroup.length; i++) {
        if (resultGroupKey === keysGroup[i]) {
          var resultNode = +keysTypes[i];
          viewer.getProperties(resultNode, onResultPropertiesRetrieved, onError);
        }
      }
    }

    viewer.getProperties(node, onGroupPropertiesRetrieved, onError);
  };

  prototype.uninitialize = function () {
    avu.DockingPanel.prototype.uninitialize.call(this);
    this.viewer = null;
  };

  prototype.setTitle = function (title, options) {
    if (!title) {
      title = 'Simulations';
      options = options || {};
      options.localizeTitle = true;
    }
    avu.DockingPanel.prototype.setTitle.call(this, title, options);
  };

  prototype.setModelNodesVisible = function (bVisible) {
    var that = this;
    var viewer = that.viewer;
    if (!that.simDef) return;
    var modelNodes = that.simDef.modelNodes;
    if (modelNodes && modelNodes.length > 0) {
      for (var k = 0; k < modelNodes.length; k++) {
        viewer[bVisible ? "show" : "hide"](modelNodes[k]);
      }
    }
  };

  //    prototype.isModelNode = function (node) {
  //      var that = this;
  //      if(!that.simDef) return;
  //      var modelNodes = that.simDef.modelNodes;
  //      if (!modelNodes || modelNodes.length === 0) {
  //        return;
  //      }
  //      return modelNodes.indexOf(node) !== -1;
  //    };

  prototype.setNodeVisibility = function (node, visible) {
    this.viewer[visible ? "show" : "hide"](node);
  };

  prototype.isSimStudyNode = function (node) {
    if (!this.simDef.studyNode) return false;
    return this.simDef.studyNode === node;
  };

  prototype.handleClick = function (nodeId) {
    var that = this;
    if (that.simDef === null) return false;
    var activeLoadCase = that.simDef.loadCases[that.simDef.activeLoadCaseKey];
    if (activeLoadCase === null) return false;
    //if(!activeLoadCase.isImportant(node)) return false;
    var groupKeys = Object.keys(that.simDef.loadCases);
    for (var i = 0; i < groupKeys.length; i++) {
      var loadCase = that.simDef.loadCases[groupKeys[i]];
      if (loadCase.isImportant(nodeId) && activeLoadCase !== loadCase) {
        //hide old load case items
        if (activeLoadCase.loadsNode !== -1) that.viewer.hide(activeLoadCase.loadsNode);
        if (activeLoadCase.constraintsNode !== -1) that.viewer.hide(activeLoadCase.constraintsNode);
        if (activeLoadCase.undeformedResults !== -1) that.viewer.hide(activeLoadCase.undeformedResults);
        if (activeLoadCase.resultsNode !== -1) that.viewer.hide(activeLoadCase.resultsNode);
        if (that.simDef.connectorsNode !== -1) that.viewer.hide(that.simDef.connectorsNode);
        //set new active load case
        that.simDef.activeLoadCaseKey = groupKeys[i];
        //fill results group cbo with new items
        that.fillResultsGroup(that.simDef.activeLoadCaseKey);
        var callee;
        if (that.simDef.analysisType === that.simDef.SimulationStudies.MODAL || that.simDef.analysisType === that.simDef.SimulationStudies.BUCKLING) {
          callee = 'fillModalResultTypes';
        } else if (that.simDef.analysisType === that.simDef.SimulationStudies.NLSS) {
          callee = 'fillNLSSResultTypes';
        } else {
          callee = 'fillResultTypes';
        }

        //fill results type cbo with new items
        that[callee](that.simDef.activeLoadCaseKey, that.resultsGroup.value);
        //sets the visibility of new items
        setTimeout(function () {
          that.simDef.simExt.showResultsDlg(true);
          that.setSimObjectsVisibility();
        }, 500);
        return true;
      }
    }

    return false;
  };

  prototype.setSimObjectsVisibility = function (node) {
    var that = this;
    //if no results and no active load then show model and hide results panel
    var activeLoadCase = that.simDef.loadCases[that.simDef.activeLoadCaseKey];
    if (!that.resultTypes || that.resultTypes.options.length === 0 || activeLoadCase === null) {
      that.setModelNodesVisible(true);
      that.simDef.simExt.showResultsDlg(false);
      return;
    }

    var resultNode = +that.resultTypes.value;
    //hide models
    that.setModelNodesVisible(false);
    //show result
    if (resultNode !== -1) that.viewer.show(resultNode);
    //show loads of active load case
    if (activeLoadCase.loadsNode !== -1) that.viewer.show(activeLoadCase.loadsNode);
    //show constraints of active load case
    if (activeLoadCase.constraintsNode !== -1) that.viewer.show(activeLoadCase.constraintsNode);
    //show undeformed style if
    if (that.optUndeformed.checked && activeLoadCase.undeformedResults !== -1)
    that.viewer.show(activeLoadCase.undeformedResults);
    //show connectors
    if (that.simDef.connectorsNode !== -1) that.viewer.show(that.simDef.connectorsNode);

    //this.viewer.fitToView();
    function onResultPropertiesRetrieved(resultType) {
      var minValue = getPropertyValue(resultType.properties, "Minimal value");
      var maxValue = getPropertyValue(resultType.properties, "Maximal value");
      var reversed = getPropertyValue(resultType.properties, "Scale reversed");
      var unit = getPropertyValue(resultType.properties, "Unit");
      that.rowMin.cells[1].innerText = minValue + " " + unit;
      that.rowMax.cells[1].innerText = maxValue + " " + unit;

      var minRefValue = getPropertyValue(resultType.properties, "Lower referential value");
      var maxRefValue = getPropertyValue(resultType.properties, "Upper referential value");
      if (reversed === "True") {
        //var temp = maxRefValue;
        //maxRefValue = minRefValue;
        //minRefValue = temp;
        that.colorScale.style.transform = "rotate(90deg)";
        that.colorScale.style.moztransform = "rotate(90deg)";
        that.colorScale.style.webkittransform = "rotate(90deg)";
      } else
      {
        that.colorScale.style.transform = "rotate(-90deg)";
        that.colorScale.style.moztransform = "rotate(-90deg)";
        that.colorScale.style.webkittransform = "rotate(-90deg)";
      }
      that.colorScaleTopText.textContent = "- " + maxRefValue + " " + unit;
      that.colorScaleBottomText.textContent = "- " + minRefValue + " " + unit;
    }

    function onError(status, message, data) {

      // onNodeProcessed();
    }
    that.viewer.getProperties(resultNode, onResultPropertiesRetrieved, onError);
  };

  return GalleryPanel;
}();

/***/ },

/***/ "./extensions/FusionSim/ModelStructurePanel.js"
/*!*****************************************************!*\
  !*** ./extensions/FusionSim/ModelStructurePanel.js ***!
  \*****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SimModelStructurePanel: () => (/* binding */ SimModelStructurePanel)
/* harmony export */ });


class SimModelStructurePanel extends Autodesk.Viewing.Extensions.ViewerModelStructurePanel {
  constructor(ext, title, options) {
    super(ext.viewer, title, options);
    this.viewer = ext.viewer;
    this.ext = ext;
  }

  setGallery(gallery) {
    this.simGalleryPanel = gallery;
  }

  initialize() {
    super.initialize();
  }

  isSimResultsNode(node) {
    if (!this.simGalleryPanel || !this.simGalleryPanel.simDef || !this.simGalleryPanel.simDef.resultsNode) return false;
    return this.simGalleryPanel.simDef.resultsNode == node;
  }

  isSimStudyNode(node) {
    if (!this.simGalleryPanel || !this.simGalleryPanel.simDef || !this.simGalleryPanel.simDef.studyNode) return false;
    return this.simGalleryPanel.simDef.studyNode == node;
  }

  isModelNode(node) {
    if (!this.simGalleryPanel || !this.simGalleryPanel.simDef || !this.simGalleryPanel.simDef.modelNodes || this.simGalleryPanel.simDef.modelNodes.length == 0)
    return false;

    return this.simGalleryPanel.simDef.modelNodes.indexOf(node) !== -1;
  }

  shouldInclude(node) {
    var that = this;
    if (!that.simGalleryPanel || !that.simGalleryPanel.simDef) return false;
    if (that.isModelNode(node)) return true;
    if (that.isSimStudyNode(node)) return true;

    var simDef = that.simGalleryPanel.simDef;
    var groupKeys = Object.keys(simDef.loadCases);
    for (var i = 0; i < groupKeys.length; i++) {
      var loadCase = simDef.loadCases[groupKeys[i]];
      if (loadCase.resultsNode === node) return false;
    }

    return true;
  }

  onClick(node, event) {
    super.onClick(node, event);

    this.simGalleryPanel.handleClick(node);
  }

  expandStudyNode() {
    if (!this.simGalleryPanel.simDef.studyNode) return;
    this.tree.setCollapsed(this.simGalleryPanel.simDef.studyNode, false);
  }
}

/***/ },

/***/ "./extensions/FusionSim/SimulationDef.js"
/*!***********************************************!*\
  !*** ./extensions/FusionSim/SimulationDef.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SimulationDef: () => (/* binding */ SimulationDef)
/* harmony export */ });
/* harmony import */ var _SimulationLoadCaseDef_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SimulationLoadCaseDef.js */ "./extensions/FusionSim/SimulationLoadCaseDef.js");


'use strict';

var SimulationDef = function () {
  function SimulationDef() {
    var that = this;
    that.SimulationStudies = { LSS: "SimCaseLSS",
      NLSS: "SimCaseNLSS",
      MODAL: "SimCaseModalFrequencies",
      BUCKLING: "SimCaseStructuralBuckling",
      THERMAL: "SimCaseThermalSteady",
      THERMALSTRESS: "SimCaseThermalStress",
      SHAPEGENERATOR: "SimCaseTopOpt",
      NAMES: {
        UNKNOWN: "Unknown",
        LSS: "Static Stress",
        NLSS: "Nonlinear Static Stress",
        MODAL: "Modal Frequencies",
        BUCKLING: "Structural Buckling",
        THERMAL: "Thermal",
        THERMALSTRESS: "Thermal Stress",
        SHAPEGENERATOR: "Shape Optimization"
      } };
    that.studyNode;
    that.loadCases = {};
    that.pointMasssesNode = -1;
    that.pointMassNodes = [];
    that.connectorsNode = -1;
    that.connectorNodes = [];
    that.activeLoadCaseKey = null;
    that.modelNodes = [];
    that.analysisType = that.SimulationStudies.LSS;
    that.modelStructurePanel = null;
    that.simExt = null;
    that.simNodes = [];
  }

  SimulationDef.prototype = {
    constructor: SimulationDef
  };
  var prototype = SimulationDef.prototype;
  prototype.studyName = function () {
    var name = this.SimulationStudies.NAMES.UNKNOWN;
    if (this.analysisType === this.SimulationStudies.LSS)
    name = this.SimulationStudies.NAMES.LSS;else
    if (this.analysisType === this.SimulationStudies.NLSS)
    name = this.SimulationStudies.NAMES.NLSS;else
    if (this.analysisType === this.SimulationStudies.MODAL)
    name = this.SimulationStudies.NAMES.MODAL;else
    if (this.analysisType === this.SimulationStudies.BUCKLING)
    name = this.SimulationStudies.NAMES.BUCKLING;else
    if (this.analysisType === this.SimulationStudies.THERMAL)
    name = this.SimulationStudies.NAMES.THERMAL;else
    if (this.analysisType === this.SimulationStudies.THERMALSTRESS)
    name = this.SimulationStudies.NAMES.THERMALSTRESS;else
    if (this.analysisType === this.SimulationStudies.SHAPEGENERATOR)
    name = this.SimulationStudies.NAMES.SHAPEGENERATOR;
    return name;
  };

  prototype.reset = function () {
    var that = this;
    that.studyNode = -1;
    that.modelNodes = [];
    that.analysisType = that.SimulationStudies.LSS;
    that.loadCases = {};
    that.pointMasssesNode = -1;
    that.pointMassNodes = [];
    that.connectorsNode = -1;
    that.connectorNodes = [];
    that.activeLoadCaseKey = null;
    that.simNodes = [];
    that.modelStructurePanel = null;
  };
  prototype.addLoadCase = function (loadCaseName, loadCaseID, loadCaseNode) {
    var that = this;
    var loadCaseDef = new _SimulationLoadCaseDef_js__WEBPACK_IMPORTED_MODULE_0__.SimulationLoadCaseDef();
    loadCaseDef.loadCase = loadCaseNode;
    loadCaseDef.loadCaseName = loadCaseName;
    //if initialization so set active the first one
    that.loadCases["SIM_LOAD_CASE" + loadCaseID] = loadCaseDef;
    if (Object.keys(that.loadCases).length === 1)
    that.activeLoadCaseKey = "SIM_LOAD_CASE" + loadCaseID;

    return loadCaseDef;
  };

  prototype.shouldDisplayInTree = function (node) {
    var that = this;
    var nodeId = node.dbId;
    if (that.simNodes.indexOf(nodeId) < 0) return false;
    if (that.studyNode === nodeId) return true;
    if (that.activeLoadCaseKey === null) return false;

    if (that.pointMasssesNode === nodeId) return true;
    if (that.pointMassNodes.indexOf(nodeId) !== -1) return true;

    if (that.connectorNodes.indexOf(nodeId) !== -1) return true;
    if (that.connectorsNode === nodeId) return true;

    var groupKeys = Object.keys(that.loadCases);
    for (var i = 0; i < groupKeys.length; i++) {
      var loadCase = that.loadCases[groupKeys[i]];
      if (loadCase.isImportant(nodeId))
      return loadCase.shouldDisplayInTree(nodeId);
    }

    //var activeLoadCase = that.loadCases[that.activeLoadCaseKey];
    //if(activeLoadCase === null) return false;
    //var visible = activeLoadCase.isImportant(node);

    return false;
  };

  return SimulationDef;
}();

/***/ },

/***/ "./extensions/FusionSim/SimulationLoadCaseDef.js"
/*!*******************************************************!*\
  !*** ./extensions/FusionSim/SimulationLoadCaseDef.js ***!
  \*******************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SimulationLoadCaseDef: () => (/* binding */ SimulationLoadCaseDef)
/* harmony export */ });
var SimulationLoadCaseDef = function () {
  function SimulationLoadCaseDef() {
    var that = this;

    that.loadCase = -1;
    that.loadCaseName = "";
    that.constraintsNode = -1;
    that.constraintNodes = [];
    that.loadsNode = -1;
    that.loadNodes = [];
    that.resultsNode = -1;
    that.undeformedResults = -1;
    that.resultTypes = {};
    that.resultGroups = {};
    that.modalResults = {};
  }

  SimulationLoadCaseDef.prototype = {
    constructor: SimulationLoadCaseDef
  };

  var prototype = SimulationLoadCaseDef.prototype;
  prototype.associateResult = function (resultName, resultNode) {
    this.resultTypes[resultNode] = resultName;
  };

  prototype.associateResultGroup = function (resultGroupName, resultGroupNode) {
    this.resultGroups[resultGroupNode] = resultGroupName;
  };

  prototype.associateModalResult = function (resultName, resultNode) {
    var subResultNode = [];
    subResultNode = this.modalResults[resultName];
    if (!subResultNode) {
      var subNode = [];
      subNode.push(resultNode);
      subResultNode = subNode;
    } else {
      subResultNode.push(resultNode);
    }
    this.modalResults[resultName] = subResultNode;
  };

  prototype.isImportant = function (nodeId) {
    var that = this;
    if (that.loadCase === nodeId) return true;
    if (that.loadNodes.indexOf(nodeId) !== -1) return true;
    if (that.constraintNodes.indexOf(nodeId) !== -1) return true;

    //do not show///
    if (that.resultsNode === nodeId) return true;
    ////////////
    if (that.constraintsNode === nodeId) return true;
    if (that.loadsNode === nodeId) return true;

    return false;
  };

  prototype.shouldDisplayInTree = function (nodeId) {
    var that = this;
    if (that.loadCase === nodeId) return true;
    if (that.loadNodes.indexOf(nodeId) !== -1) return true;
    if (that.constraintNodes.indexOf(nodeId) !== -1) return true;

    //do not show///
    if (that.resultsNode === nodeId) return false;
    ////////////
    if (that.constraintsNode === nodeId) return true;
    if (that.loadsNode === nodeId) return true;

    return false;
  };

  prototype.reset = function () {
    var that = this;
    that.loadCase = -1;
    that.loadCaseName = '';
    that.constraintsNode = -1;
    that.constraintNodes = [];
    that.loadsNode = -1;
    that.loadNodes = [];
    that.resultsNode = -1;
    that.undeformedResults = -1;
    that.resultTypes = {};
    that.resultGroups = {};
    that.modalResults = {};
  };
  return SimulationLoadCaseDef;
}();

/***/ },

/***/ "./src/application/LoggingUtils.js"
/*!*****************************************!*\
  !*** ./src/application/LoggingUtils.js ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   warnOnce: () => (/* binding */ warnOnce)
/* harmony export */ });
// Simple helper to avoid pointless warning repetition
const _alreadyWarned = new Set();
function warnOnce(txt) {
  if (!_alreadyWarned.has(txt)) {
    console.warn(txt);
    _alreadyWarned.add(txt);
  }
}

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/FusionSim/FusionSim.css"
/*!********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/FusionSim/FusionSim.css ***!
  \********************************************************************************************************************************************************************************************************************************************************/
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAZCAYAAAArK+5dAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAINJREFUeNpiYKAxYIQxLl299p9ahuppazFiCFLLAnRzmGgdRDS3gIUWwTRwPsAW+5T6ioWayRGbY0i1oBGI60nxHbFxcAGIDYEubqA4iJBdhTVH0iiIDID4PNCARlITAKnJtH7IpyIGWgfRaEajQ0ajeRDhyL1kZzRSK5x6hhEHAAIMAPgbTyRsh4JhAAAAAElFTkSuQmCC */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAZCAYAAAArK+5dAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAINJREFUeNpiYKAxYIQxLl299p9ahuppazFiCFLLAnRzmGgdRDS3gIUWwTRwPsAW+5T6ioWayRGbY0i1oBGI60nxHbFxcAGIDYEubqA4iJBdhTVH0iiIDID4PNCARlITAKnJtH7IpyIGWgfRaEajQ0ajeRDhyL1kZzRSK5x6hhEHAAIMAPgbTyRsh4JhAAAAAElFTkSuQmCC"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAOxJREFUeNpi/P//P8NAAiaGAQajDsDnAFISx38S1Y9GwchwwDuktJGGO/UACyIcGBtAV/MAi5oHSPpd8JgPxoRCgBENo4MCIsUYyA0BBiLwASTfH8ARgkq49FPDAQpIFimg6ScYBSxUSGwPgHgiEhsG3kMx/jjGUxv+xxHv2IAAlP5Aquup5YDRgmjUAQPuAFAuuADFAvQuCQWA+AJSYXQBKkaMXoodYADEH7BUSB+gchQ7AF9tiMtykhzBSGa/gFRNjNROhIJA/BGIFYlkUz0XBEBT/AMi2WTlAmKqYVLYVE0DoyXh8HEAQIABAH7a/BD95CkUAAAAAElFTkSuQmCC */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAOxJREFUeNpi/P//P8NAAiaGAQajDsDnAFISx38S1Y9GwchwwDuktJGGO/UACyIcGBtAV/MAi5oHSPpd8JgPxoRCgBENo4MCIsUYyA0BBiLwASTfH8ARgkq49FPDAQpIFimg6ScYBSxUSGwPgHgiEhsG3kMx/jjGUxv+xxHv2IAAlP5Aquup5YDRgmjUAQPuAFAuuADFAvQuCQWA+AJSYXQBKkaMXoodYADEH7BUSB+gchQ7AF9tiMtykhzBSGa/gFRNjNROhIJA/BGIFYlkUz0XBEBT/AMi2WTlAmKqYVLYVE0DoyXh8HEAQIABAH7a/BD95CkUAAAAAElFTkSuQmCC"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_2___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAABCAYAAABADtw1AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAADdJREFUWIXt1LENACAMxEBn/6HDCFAg5QUurnflgm4AStJ/GtB9BDRIOwELkg4Q0PCc6f1ImgEs9yMAHrvm2CUAAAAASUVORK5CYII= */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAABCAYAAABADtw1AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAADdJREFUWIXt1LENACAMxEBn/6HDCFAg5QUurnflgm4AStJ/GtB9BDRIOwELkg4Q0PCc6f1ImgEs9yMAHrvm2CUAAAAASUVORK5CYII="), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_3___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAVJJREFUeNrslzFOwzAUhh3ETo7AxJoeIQOXYMtAl06dGFAHD52YcgS69wgM5QSElSlHSE9gnqXf0lMi288GlErE0qfW7znPv1/+SElhjFFzjis181gE/ERAQ/SgyS1SZJqwI6pR7JNY/WUHbPETeCYOLHdAzOXlQmwHBLya6bCxGvjy0drXAW0lscX/I05VsXbbWB3Ja8xbYkjxgMbmN5ifUaTH/DYzry/uMfR1wJ7khbjD/I3Yj1q8I+6F+S/iCZ0RmdCNLmLCFQiZsGOxyV6xW1Cxe7om3sED4h9AIebya3baKucx1MTAVIdOFeqWu3ZAzclePgE9sSHakQDDBG6wzq3VnrUtWysWkHKqlG4lC3AXnYhH/CrjH7G1YgGLBxYPzO4BS/mLHih9++S8kKR6IIhUgMKbj9QDtbTu7C+lKR0Y0zAPNLl1iuXb8N8L+BZgAFKZnMHoWj7GAAAAAElFTkSuQmCC */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAVJJREFUeNrslzFOwzAUhh3ETo7AxJoeIQOXYMtAl06dGFAHD52YcgS69wgM5QSElSlHSE9gnqXf0lMi288GlErE0qfW7znPv1/+SElhjFFzjis181gE/ERAQ/SgyS1SZJqwI6pR7JNY/WUHbPETeCYOLHdAzOXlQmwHBLya6bCxGvjy0drXAW0lscX/I05VsXbbWB3Ja8xbYkjxgMbmN5ifUaTH/DYzry/uMfR1wJ7khbjD/I3Yj1q8I+6F+S/iCZ0RmdCNLmLCFQiZsGOxyV6xW1Cxe7om3sED4h9AIebya3baKucx1MTAVIdOFeqWu3ZAzclePgE9sSHakQDDBG6wzq3VnrUtWysWkHKqlG4lC3AXnYhH/CrjH7G1YgGLBxYPzO4BS/mLHih9++S8kKR6IIhUgMKbj9QDtbTu7C+lKR0Y0zAPNLl1iuXb8N8L+BZgAFKZnMHoWj7GAAAAAElFTkSuQmCC"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);
var ___CSS_LOADER_URL_REPLACEMENT_2___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_2___);
var ___CSS_LOADER_URL_REPLACEMENT_3___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_3___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.toolbar-simulationIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
}

.toolbar-simulationSetupIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});
}

.simulation-colorscale {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});
  background-size: contain;
  -moz-transform: rotate(90deg);
  -webkit-transform: rotate(90deg);
}

.simulation-container {
  min-height: 35px !important;
  height: 510px !important;
  position: absolute !important;
  background-color: rgba(34, 34, 34, 0.9) !important;
}

.simulation-container-Collapse {
  height: 356px !important;
}

.position-left-corner {
  top: 150px;
  left: 220px;
}

.position-right-corner {
  right: 100px;
  top: 170px;
}

.simulation-resultGroup, .simulation-resultTypes, .simulation-resultSteps {
  position: relative !important;
  width: 100% !important;
  color: black !important;
  height: 22px !important;
  border: 1px !important;
  -webkit-box-sizing: border-box !important;
  -moz-box-sizing: border-box !important;
  box-sizing: border-box !important;
}

.sim-div-Results {
  position: absolute !important;
  top: 51px !important;
  left: 5px !important;
  right: 5px !important;
}

.simulation-resultTypes, .simulation-resultSteps {
  margin-top: 5px !important;
}

.toolbar-simulationIcon {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_3___});
}

.sim-div-options {
  top: 95px;
  margin-top: 5px;
  left: 5px;
  right: 5px;
  position: absolute;
}

.sim-div-options-NLSS {
  top: 125px !important;
}

.sim-undeformedOption {
  width: 14px;
  height: 14px;
}

.sim-undeformedOptionText {
  color: white !important;
  font-weight: 200 !important;
}

.sim-line1 {
  position: absolute;
  top: 110px;
  width: 100%;
  border-top: 1px solid black;
}

.sim-div-colorscale {
  left: 5px;
  right: 5px;
  height: 220px;
  margin-top: 5px;
  position: absolute;
}

.sim-div-colorscale-top1 {
  top: 120px;
}

.sim-div-colorscale-top1-NLSS {
  top: 140px !important;
}

.sim-div-colorscale-top2 {
  top: 100px;
}

.sim-div-colorscale-Collapse {
  cursor: pointer;
}

.simulation-colorscale {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});
  background-size: contain;
  -moz-transform: rotate(90deg);
  -webkit-transform: rotate(90deg);
  width: 220px;
  height: 20px;
  left: -70px;
  top: 110px;
  position: absolute;
  background-repeat: repeat;
}

.simulation-colorscale-NLSS {
  width: 190px !important;
}

.sim-colorScaleTopText, .sim-colorScaleBottomText {
  left: 52px;
  color: white !important;
  position: relative !important;
}

.sim-colorScaleTopText {
  top: 0px;
}

.sim-colorScaleTopText-NLSS {
  top: 13px !important;
}

.sim-colorScaleBottomText {
  top: 195px;
}

.sim-colorScaleBottomText-NLSS {
  top: 178px !important;
}

.sim-line2 {
  position: absolute;
  top: 360px;
  width: 100%;
  border-top: 1px solid black;
}

.sim-div-Table {
  position: absolute !important;
  top: 370px !important;
  left: 5px !important;
  right: 5px !important;
  margin-top: 5px;
  cursor: pointer;
}

.sim-div-Table-Collapse {
  height: 0px !important;
  transition: height 0s 10000s;
  visibility: hidden !important;
}

.sim-table {
  position: relative !important;
  color: white !important;
  width: 100% !important;
  margin: 0 0 0 0;
  -webkit-box-sizing: border-box !important;
  -moz-box-sizing: border-box !important;
  box-sizing: border-box !important;
}

.sim-hide {
  visibility: hidden !important;
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

/***/ "./extensions/FusionSim/FusionSim.css"
/*!********************************************!*\
  !*** ./extensions/FusionSim/FusionSim.css ***!
  \********************************************/
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_FusionSim_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./FusionSim.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/FusionSim/FusionSim.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_FusionSim_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_FusionSim_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_FusionSim_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_FusionSim_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAZCAYAAAArK+5dAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAINJREFUeNpiYKAxYIQxLl299p9ahuppazFiCFLLAnRzmGgdRDS3gIUWwTRwPsAW+5T6ioWayRGbY0i1oBGI60nxHbFxcAGIDYEubqA4iJBdhTVH0iiIDID4PNCARlITAKnJtH7IpyIGWgfRaEajQ0ajeRDhyL1kZzRSK5x6hhEHAAIMAPgbTyRsh4JhAAAAAElFTkSuQmCC"
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAZCAYAAAArK+5dAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAINJREFUeNpiYKAxYIQxLl299p9ahuppazFiCFLLAnRzmGgdRDS3gIUWwTRwPsAW+5T6ioWayRGbY0i1oBGI60nxHbFxcAGIDYEubqA4iJBdhTVH0iiIDID4PNCARlITAKnJtH7IpyIGWgfRaEajQ0ajeRDhyL1kZzRSK5x6hhEHAAIMAPgbTyRsh4JhAAAAAElFTkSuQmCC ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAZCAYAAAArK+5dAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAINJREFUeNpiYKAxYIQxLl299p9ahuppazFiCFLLAnRzmGgdRDS3gIUWwTRwPsAW+5T6ioWayRGbY0i1oBGI60nxHbFxcAGIDYEubqA4iJBdhTVH0iiIDID4PNCARlITAKnJtH7IpyIGWgfRaEajQ0ajeRDhyL1kZzRSK5x6hhEHAAIMAPgbTyRsh4JhAAAAAElFTkSuQmCC";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAOxJREFUeNpi/P//P8NAAiaGAQajDsDnAFISx38S1Y9GwchwwDuktJGGO/UACyIcGBtAV/MAi5oHSPpd8JgPxoRCgBENo4MCIsUYyA0BBiLwASTfH8ARgkq49FPDAQpIFimg6ScYBSxUSGwPgHgiEhsG3kMx/jjGUxv+xxHv2IAAlP5Aquup5YDRgmjUAQPuAFAuuADFAvQuCQWA+AJSYXQBKkaMXoodYADEH7BUSB+gchQ7AF9tiMtykhzBSGa/gFRNjNROhIJA/BGIFYlkUz0XBEBT/AMi2WTlAmKqYVLYVE0DoyXh8HEAQIABAH7a/BD95CkUAAAAAElFTkSuQmCC"
/*!******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAOxJREFUeNpi/P//P8NAAiaGAQajDsDnAFISx38S1Y9GwchwwDuktJGGO/UACyIcGBtAV/MAi5oHSPpd8JgPxoRCgBENo4MCIsUYyA0BBiLwASTfH8ARgkq49FPDAQpIFimg6ScYBSxUSGwPgHgiEhsG3kMx/jjGUxv+xxHv2IAAlP5Aquup5YDRgmjUAQPuAFAuuADFAvQuCQWA+AJSYXQBKkaMXoodYADEH7BUSB+gchQ7AF9tiMtykhzBSGa/gFRNjNROhIJA/BGIFYlkUz0XBEBT/AMi2WTlAmKqYVLYVE0DoyXh8HEAQIABAH7a/BD95CkUAAAAAElFTkSuQmCC ***!
  \******************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAOxJREFUeNpi/P//P8NAAiaGAQajDsDnAFISx38S1Y9GwchwwDuktJGGO/UACyIcGBtAV/MAi5oHSPpd8JgPxoRCgBENo4MCIsUYyA0BBiLwASTfH8ARgkq49FPDAQpIFimg6ScYBSxUSGwPgHgiEhsG3kMx/jjGUxv+xxHv2IAAlP5Aquup5YDRgmjUAQPuAFAuuADFAvQuCQWA+AJSYXQBKkaMXoodYADEH7BUSB+gchQ7AF9tiMtykhzBSGa/gFRNjNROhIJA/BGIFYlkUz0XBEBT/AMi2WTlAmKqYVLYVE0DoyXh8HEAQIABAH7a/BD95CkUAAAAAElFTkSuQmCC";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAVJJREFUeNrslzFOwzAUhh3ETo7AxJoeIQOXYMtAl06dGFAHD52YcgS69wgM5QSElSlHSE9gnqXf0lMi288GlErE0qfW7znPv1/+SElhjFFzjis181gE/ERAQ/SgyS1SZJqwI6pR7JNY/WUHbPETeCYOLHdAzOXlQmwHBLya6bCxGvjy0drXAW0lscX/I05VsXbbWB3Ja8xbYkjxgMbmN5ifUaTH/DYzry/uMfR1wJ7khbjD/I3Yj1q8I+6F+S/iCZ0RmdCNLmLCFQiZsGOxyV6xW1Cxe7om3sED4h9AIebya3baKucx1MTAVIdOFeqWu3ZAzclePgE9sSHakQDDBG6wzq3VnrUtWysWkHKqlG4lC3AXnYhH/CrjH7G1YgGLBxYPzO4BS/mLHih9++S8kKR6IIhUgMKbj9QDtbTu7C+lKR0Y0zAPNLl1iuXb8N8L+BZgAFKZnMHoWj7GAAAAAElFTkSuQmCC"
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAVJJREFUeNrslzFOwzAUhh3ETo7AxJoeIQOXYMtAl06dGFAHD52YcgS69wgM5QSElSlHSE9gnqXf0lMi288GlErE0qfW7znPv1/+SElhjFFzjis181gE/ERAQ/SgyS1SZJqwI6pR7JNY/WUHbPETeCYOLHdAzOXlQmwHBLya6bCxGvjy0drXAW0lscX/I05VsXbbWB3Ja8xbYkjxgMbmN5ifUaTH/DYzry/uMfR1wJ7khbjD/I3Yj1q8I+6F+S/iCZ0RmdCNLmLCFQiZsGOxyV6xW1Cxe7om3sED4h9AIebya3baKucx1MTAVIdOFeqWu3ZAzclePgE9sSHakQDDBG6wzq3VnrUtWysWkHKqlG4lC3AXnYhH/CrjH7G1YgGLBxYPzO4BS/mLHih9++S8kKR6IIhUgMKbj9QDtbTu7C+lKR0Y0zAPNLl1iuXb8N8L+BZgAFKZnMHoWj7GAAAAAElFTkSuQmCC ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAVJJREFUeNrslzFOwzAUhh3ETo7AxJoeIQOXYMtAl06dGFAHD52YcgS69wgM5QSElSlHSE9gnqXf0lMi288GlErE0qfW7znPv1/+SElhjFFzjis181gE/ERAQ/SgyS1SZJqwI6pR7JNY/WUHbPETeCYOLHdAzOXlQmwHBLya6bCxGvjy0drXAW0lscX/I05VsXbbWB3Ja8xbYkjxgMbmN5ifUaTH/DYzry/uMfR1wJ7khbjD/I3Yj1q8I+6F+S/iCZ0RmdCNLmLCFQiZsGOxyV6xW1Cxe7om3sED4h9AIebya3baKucx1MTAVIdOFeqWu3ZAzclePgE9sSHakQDDBG6wzq3VnrUtWysWkHKqlG4lC3AXnYhH/CrjH7G1YgGLBxYPzO4BS/mLHih9++S8kKR6IIhUgMKbj9QDtbTu7C+lKR0Y0zAPNLl1iuXb8N8L+BZgAFKZnMHoWj7GAAAAAElFTkSuQmCC";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAABCAYAAABADtw1AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAADdJREFUWIXt1LENACAMxEBn/6HDCFAg5QUurnflgm4AStJ/GtB9BDRIOwELkg4Q0PCc6f1ImgEs9yMAHrvm2CUAAAAASUVORK5CYII="
/*!**************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAABCAYAAABADtw1AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAADdJREFUWIXt1LENACAMxEBn/6HDCFAg5QUurnflgm4AStJ/GtB9BDRIOwELkg4Q0PCc6f1ImgEs9yMAHrvm2CUAAAAASUVORK5CYII= ***!
  \**************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAABCAYAAABADtw1AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAADdJREFUWIXt1LENACAMxEBn/6HDCFAg5QUurnflgm4AStJ/GtB9BDRIOwELkg4Q0PCc6f1ImgEs9yMAHrvm2CUAAAAASUVORK5CYII=";

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
/******/ 			"FusionSim": 0
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
/*!*******************************************!*\
  !*** ./extensions/FusionSim/FusionSim.js ***!
  \*******************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Simulation: () => (/* binding */ Simulation)
/* harmony export */ });
/* harmony import */ var _GalleryPanel_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./GalleryPanel.js */ "./extensions/FusionSim/GalleryPanel.js");
/* harmony import */ var _ModelStructurePanel_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ModelStructurePanel.js */ "./extensions/FusionSim/ModelStructurePanel.js");
/* harmony import */ var _FusionSim_css__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./FusionSim.css */ "./extensions/FusionSim/FusionSim.css");
/* harmony import */ var _src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../src/application/LoggingUtils.js */ "./src/application/LoggingUtils.js");


 // REQUIRED!!


'use strict';

var av = Autodesk.Viewing;

/**
 * @deprecated This extension is deprecated and will be removed in a future release.
 */
var Simulation = function () {

  var defaults = {
  };

  function Simulation(viewer, options) {
    var that = this;
    options = options || {};
    // Check options, else override with defaults.
    for (var i in defaults) {
      options[i] = options[i] || defaults[i];
    }
    av.Extension.call(that, viewer, options);
    this.name = 'fusionsim';

    const onGeometryLoadEnded = () => {
      that.load();
      viewer.removeEventListener(av.GEOMETRY_LOADED_EVENT, onGeometryLoadEnded);
    };
    viewer.addEventListener(av.GEOMETRY_LOADED_EVENT, onGeometryLoadEnded);
  }

  Simulation.prototype = Object.create(av.Extension.prototype);
  var prototype = Simulation.prototype;
  prototype.constructor = Simulation;


  prototype.load = function () {
    (0,_src_application_LoggingUtils_js__WEBPACK_IMPORTED_MODULE_3__.warnOnce)('[Autodesk.Fusion360.Simulation] This extension is deprecated and will be removed in a future release.');
    var that = this;
    var viewer = that.viewer;
    if (!viewer.model || that.loaded) {
      return true;
    }
    that.galleryPanel = new _GalleryPanel_js__WEBPACK_IMPORTED_MODULE_0__.GalleryPanel(that.viewer);
    that.viewer.addPanel(that.galleryPanel);
    that.simButton = new av.UI.Button('toolbar-simulation');
    that.simButton.setVisible(false);
    that.simButton.setToolTip('Simulation Results');
    that.simButton.onClick = function (e) {
      var visible = that.galleryPanel.isVisible();
      if (!visible) {
        that.activate(that.galleryPanel);
      } else {
        that.deactivate(that.galleryPanel);
      }
      that.simButton.setState(!visible ? av.UI.Button.State.ACTIVE : av.UI.Button.State.INACTIVE);
    };
    that.simButton.setIcon('toolbar-simulationIcon');
    viewer.settingsTools.addControl(that.simButton, {
      index: 1
    });

    // Change these viewer settings for SIM files.
    // keep defaults
    that.hideLines = viewer.prefs.get("lineRendering");
    that.ghosting = viewer.prefs.get("ghosting");
    that.ambientShadow = viewer.prefs.get("ambientShadows");
    that.antialiazing = viewer.prefs.get("antialiasing");
    that.lightPreset = viewer.prefs.get("lightPreset");
    viewer.model.getObjectTree(function (instanceTree) {
      setTimeout(function () {
        that.galleryPanel.initModel(instanceTree, that);
        that.initModelBrowser();
      }, 100);
    });
    that.loaded = true;
    return true;
  };
  prototype.unload = function () {
    var that = this;
    if (!that.viewer.model) return;
    that.showResultsDlg(false);
    that.simButton.removeFromParent();
    that.viewer.removePanel(this.galleryPanel);
    that.galleryPanel.uninitialize();
    // restore viewer settings back.
    that.viewer.hideLines(!that.hideLines);
    that.viewer.setGhosting(that.ghosting);
    that.viewer.setQualityLevel(that.ambientShadow, that.antialiazing);
    that.viewer.setLightPreset(that.lightPreset);
    that.loaded = false;
    return true;
  };

  prototype.initModelBrowser = function () {
    var that = this;
    setTimeout(function () {
      that.options = that.options || {};
      that.options.addFooter = true;
      that.modelStructurePanel = new _ModelStructurePanel_js__WEBPACK_IMPORTED_MODULE_1__.SimModelStructurePanel(that, 'Simulation Model Structure Loading', that.options);
      that.viewer.getExtension('Autodesk.ModelStructure').setModelStructurePanel(that.modelStructurePanel);
      that.modelStructurePanel.setGallery(that.galleryPanel);
    }, 100);
  };

  prototype.showResultsDlg = function (show) {
    var that = this;
    that.simButton.setState(show ? av.UI.Button.State.ACTIVE : av.UI.Button.State.INACTIVE);
    that.simButton.setVisible(show);
    that.galleryPanel.setVisible(show);
  };
  prototype.applySettings = function () {
    var viewer = this.viewer;
    viewer.hideLines(false);
    viewer.setGhosting(false);
    viewer.setQualityLevel(false, true);
    viewer.setLightPreset(4);
  };
  prototype.simData = function () {
    return this.galleryPanel.simDef;
  };

  prototype.activate = function (galleryPanel) {
    if (!this.activeStatus) {
      galleryPanel.setVisible(true);
      this.activeStatus = true;
    }
    return true;

  };

  prototype.deactivate = function (galleryPanel) {
    if (this.activeStatus) {
      galleryPanel.setVisible(false);
      this.activeStatus = false;
    }
    return true;
  };


  return Simulation;
}();

av.theExtensionManager.registerExtension('Autodesk.Fusion360.Simulation', Simulation);
})();

Autodesk.Extensions.FusionSim = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=FusionSim.js.map