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

/***/ "./extensions/Measure/CalibrationPanels.js"
/*!*************************************************!*\
  !*** ./extensions/Measure/CalibrationPanels.js ***!
  \*************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CalibrationPanel: () => (/* binding */ CalibrationPanel),
/* harmony export */   CalibrationRequiredDialog: () => (/* binding */ CalibrationRequiredDialog)
/* harmony export */ });




var av = Autodesk.Viewing,
  ave = Autodesk.Viewing.Extensions,
  avp = Autodesk.Viewing.Private,
  avu = Autodesk.Viewing.UI,
  MeasureCommon = Autodesk.Viewing.MeasureCommon;

// This strange code is there because we
// don't want DockingPanel, which is used as a base class later
// to be undefined during headless mode.
// Simply deriving from undefined will cause an exception (from babel env preset)
// even if the class is never instantiated
const DockingPanel = avu && avu.DockingPanel || class {};
// et ViewerPanelMixin to a no-op in headless mode
const ViewerPanelMixin = ave && ave.ViewerPanelMixin || function () {};

const _gWindow = av.getGlobal();
const _gDocument = _gWindow.document;

//
// /** @constructor */
//
//
class CalibrationPanel extends DockingPanel {
  constructor(calibrationTool, viewer, id, title, options) {
    options = options || {};
    options.addFooter = false;

    super(viewer.container, id, title, options);
    var self = this;

    this.viewer = viewer;
    this.calibrationTool = calibrationTool;
    this.parentContainer = viewer.container;
    this.container.style.left = '0px';
    this.container.style.top = '0px';
    this.container.style.resize = 'none';

    this.container.classList.add('calibration-panel');

    this.setGlobalManager && this.setGlobalManager(viewer.globalManager);

    this.addEventListener(this.closer, "click", function (e) {
      self.cancel();
    });

    if (!options.heightAdjustment)
    options.heightAdjustment = 40;
    if (!options.marginTop)
    options.marginTop = 0;
    options.left = false;

    this.createScrollContainer(options);

    const _document = this.getDocument && this.getDocument() || _gDocument;

    this.calibrationMenu = _document.createElement("div");

    this.scrollContainer.appendChild(this.calibrationMenu);

    // Table
    this.table = _document.createElement("table");
    this.table.className = "adsk-lmv-tftable calibration-table";
    this.tbody = _document.createElement("tbody");
    this.table.appendChild(this.tbody);
    this.calibrationMenu.appendChild(this.table);

    // Define Size Row
    this.row = this.tbody.insertRow(0);
    this.requestedSizeTextbox = _document.createElement('input');
    this.requestedSizeTextbox.className = 'docking-panel-textbox';
    this.requestedSizeTextbox.type = 'text';
    this.requestedSizeTextbox.autofocus = 'true';

    this.addEventListener(this.requestedSizeTextbox, "keyup", function (e) {
      var value = self.requestedSizeTextbox.value;
      if (value !== "" && value.split(".")[0] === "") {
        self.requestedSizeTextbox.value = "0" + value;
      }
      self.updateLabel();
    });


    this.addEventListener(this.requestedSizeTextbox, "keypress", function (e) {
      var key = e.key || String.fromCharCode(e.keyCode);
      // Handling backspace and arrows for firefox
      if (key == "Backspace" || key == "ArrowLeft" || key == "ArrowRight") {
        return;
      }

      // Escape (For IE11)
      if (e.keyCode == av.KeyCode.ESCAPE) {
        self.cancel();
        return;
      }

      if (e.keyCode == av.KeyCode.ENTER) {
        var index = self.unitList.selectedIndex;
        var requestedUnits = self.units[index].units;
        self.calibrationTool.calibrate(requestedUnits, self.requestedSizeTextbox.value);
      }

      var requestedSize = self.requestedSizeTextbox.value;
      var cursorIndex = self.requestedSizeTextbox.selectionStart;
      requestedSize = [requestedSize.slice(0, cursorIndex), key, requestedSize.slice(cursorIndex)].join('');

      if (requestedSize == ".") {
        return;
      }

      var isSimple = self.units[self.unitList.selectedIndex].simpleInput;

      if (!isPositiveNumber(requestedSize) || isSimple && (!isSimpleDecimal(requestedSize) || Autodesk.Viewing.Private.calculatePrecision(requestedSize) > self.calibrationTool.getMaxPrecision())) {
        e.preventDefault();
      }
    });

    var caption = "Define Size";
    var cell = this.row.insertCell(0);
    this.caption = _document.createElement("div");
    this.caption.setAttribute("data-i18n", caption);
    this.caption.textContent = av.i18n.translate(caption);
    cell.appendChild(this.caption);

    cell = this.row.insertCell(1);
    cell.appendChild(this.requestedSizeTextbox);

    // Unit Type Row
    this.units = [
    { name: 'Feet and fractional inches', units: 'ft-and-fractional-in', matches: ['ft-and-fractional-in', 'fractional-in'], simpleInput: false },
    { name: 'Feet and decimal inches', units: 'ft-and-decimal-in', matches: ['ft', 'sft', 'decimal-ft', 'in', 'decimal-in', 'ft-and-decimal-in'], simpleInput: false },
    { name: 'Meters', units: 'm', matches: ['m', 'm-and-cm'], simpleInput: true },
    { name: 'Centimeters', units: 'cm', matches: ['cm'], simpleInput: true },
    { name: 'Millimeters', units: 'mm', matches: ['mm'], simpleInput: true }];


    var unitNames = [];
    for (var i = 0; i < this.units.length; ++i) {
      unitNames.push(this.units[i].name);
    }
    this.unitList = new avp.OptionDropDown("Unit type", this.tbody, unitNames, 0, null, undefined, { paddingLeft: 0, paddingRight: 0 });
    this.unitList.setGlobalManager(this.globalManager);
    this.addEventListener(this.unitList, "change", function (e) {
      self.updateLabel();
    });

    var buttonsWrapper = _document.createElement('div');
    buttonsWrapper.classList.add('docking-panel-footer');
    this.calibrationMenu.appendChild(buttonsWrapper);

    // Cancel button
    var cancel = _document.createElement('div');
    cancel.classList.add('docking-panel-secondary-button');

    cancel.setAttribute("data-i18n", "Cancel");
    cancel.textContent = av.i18n.translate("Cancel");

    cancel.addEventListener('click', function () {
      self.cancel();
    }, false);

    buttonsWrapper.appendChild(cancel);

    // Set Calibration button
    var setCalibration = _document.createElement('div');
    setCalibration.classList.add('docking-panel-primary-button');

    setCalibration.setAttribute("data-i18n", "Calibrate");
    setCalibration.textContent = av.i18n.translate("Calibrate");

    setCalibration.addEventListener('click', function () {
      var index = self.unitList.selectedIndex;
      var requestedUnits = self.units[index].units;
      self.calibrationTool.calibrate(requestedUnits, self.requestedSizeTextbox.value);
    }, false);

    buttonsWrapper.appendChild(setCalibration);
  } // end constructor

  uninitialize() {
    this.viewer = null;
    super.uninitialize();
  }

  cancel() {
    this.setVisible(false);
    this.calibrationTool.clearSize();
    this.calibrationTool.showAddCalibrationLabel();
  }

  findUnits() {
    var i,
      j,
      selectedUnits = this.calibrationTool.getCurrentUnits();
    for (i = 0; i < this.units.length; ++i) {
      var matches = this.units[i].matches;
      if (matches) {
        for (j = 0; j < matches.length; ++j) {
          if (matches[j] === selectedUnits) {
            return i;
          }
        }
      }
    }
    return 0;
  }

  setPanelValue(size) {
    this.updateUnits();
    this.requestedSizeTextbox.value = size;
  }

  updateUnits() {
    this.unitList.setSelectedIndex(this.findUnits());
  }

  updateLabel() {
    var index = this.unitList.selectedIndex;
    var requestedUnits = this.units[index].units;
    var size = this.requestedSizeTextbox.value;
    var parsedNumber = Autodesk.Viewing.Private.UnitParser.parsePositiveNumber(size, requestedUnits);
    var text = Autodesk.Viewing.Private.formatValueWithUnits(parsedNumber, requestedUnits, 3, Autodesk.Viewing.Private.calculatePrecision(size));

    if (size === "") {
      this.calibrationTool.updateLabelValue(null);
    } else if (!isNaN(parsedNumber)) {
      this.calibrationTool.updateLabelValue(text);
    }
  }

  updatePanelPosition(labelPosition, p1, p2, labelOffset) {

    var width = parseInt(this.container.getBoundingClientRect().width);
    var height = parseInt(this.container.getBoundingClientRect().height);

    var cornerX;
    var cornerY;

    if (!labelPosition || !p1 || !p2) {
      cornerX = Math.floor((this.viewer.canvas.clientWidth - width) / 2);
      cornerY = Math.floor((this.viewer.canvas.clientHeight - height) / 2);
    } else
    {
      p1 = MeasureCommon.project(p1, this.viewer);
      p2 = MeasureCommon.project(p2, this.viewer);
      var rubberbandDirection = new THREE.Vector2().copy(p1).sub(p2).normalize();

      var normal;
      if (p1.x < p2.x) {
        normal = new THREE.Vector2(rubberbandDirection.y, -rubberbandDirection.x);
      } else {
        normal = new THREE.Vector2(-rubberbandDirection.y, rubberbandDirection.x);
      }

      var offset = labelOffset + Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2)) / 2;

      normal = normal.multiplyScalar(offset);
      var pos = labelPosition.sub(normal);

      cornerX = pos.x - Math.floor(width / 2);
      cornerY = pos.y - Math.floor(height / 2);

      // if panel exceeds screen bounds, just put the panel in the center of the screen.
      if (cornerX < 0 || cornerX + width > this.viewer.canvas.clientWidth || cornerY < 0 || cornerY + height > this.viewer.canvas.clientHeight) {
        cornerX = Math.floor((this.viewer.canvas.clientWidth - width) / 2);
        cornerY = Math.floor((this.viewer.canvas.clientHeight - height) / 2);
      }
    }

    this.container.style.left = cornerX + 'px';
    this.container.style.top = cornerY + 'px';
  }
}

var isPositiveNumber = function (n) {
  // The first character of the string has to be a digit.
  return n.match(/^(\d+)/);
};

var isSimpleDecimal = function (n) {
  // Add "0" to the end of the string, to check if there are trailing spaces.
  n += '0';
  return !isNaN(parseFloat(n)) && !isNaN(+n) && parseFloat(n) >= 0;
};

ViewerPanelMixin.call(CalibrationPanel.prototype);


//
// /** @constructor */
//
//
class CalibrationRequiredDialog extends DockingPanel {
  constructor(measureExt, viewer, id, title, options) {
    options = options || {};
    options.addFooter = false;

    super(viewer.container, id, title, options);
    var self = this;

    this.viewer = viewer;
    this.measureExt = measureExt;
    this.parentContainer = viewer.container;
    this.container.classList.add('calibration-panel');

    this.setGlobalManager && this.setGlobalManager(viewer.globalManager);

    if (!options.heightAdjustment)
    options.heightAdjustment = 70;
    if (!options.marginTop)
    options.marginTop = 0;
    options.left = false;

    const _document = this.getDocument && this.getDocument() || _gDocument;

    this.createScrollContainer(options);
    this.dialogBox = _document.createElement("div");
    this.scrollContainer.appendChild(this.dialogBox);

    // text
    var calibrateNow = _document.createElement('div');
    calibrateNow.className = 'calibration-text';
    var text = "Calibration Message";
    calibrateNow.setAttribute("data-i18n", text);
    calibrateNow.textContent = av.i18n.translate(text);
    this.dialogBox.appendChild(calibrateNow);

    var buttonsWrapper = _document.createElement('div');
    buttonsWrapper.className = 'calibration-buttons-wrapper';
    this.dialogBox.appendChild(buttonsWrapper);

    // Cancel button
    var cancel = _document.createElement('div');
    cancel.classList.add('docking-panel-secondary-button');
    cancel.classList.add('calibration-button-left');
    cancel.setAttribute("data-i18n", "Cancel");
    cancel.textContent = av.i18n.translate("Cancel");
    cancel.addEventListener('click', function () {
      self.setVisible(false);
    }, false);
    buttonsWrapper.appendChild(cancel);

    // Calibrate-Now button
    var calibrateNowButton = _document.createElement('div');
    calibrateNowButton.classList.add('docking-panel-primary-button');
    calibrateNowButton.classList.add('calibration-button-right');
    calibrateNowButton.setAttribute("data-i18n", "Calibrate Now");
    calibrateNowButton.textContent = av.i18n.translate("Calibrate Now");
    calibrateNowButton.addEventListener('click', function () {
      self.measureExt.enableCalibrationTool(true);
      self.setVisible(false);
    }, false);
    buttonsWrapper.appendChild(calibrateNowButton);


  } // end constructor

  uninitialize() {
    this.viewer = null;
    super.uninitialize();
  }
}

ViewerPanelMixin.call(CalibrationRequiredDialog.prototype);

/***/ },

/***/ "./extensions/Measure/CalibrationTool.js"
/*!***********************************************!*\
  !*** ./extensions/Measure/CalibrationTool.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CalibrationTool: () => (/* binding */ CalibrationTool)
/* harmony export */ });
/* harmony import */ var _CalibrationToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./CalibrationToolIndicator.js */ "./extensions/Measure/CalibrationToolIndicator.js");
/* harmony import */ var _CalibrationPanels_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CalibrationPanels.js */ "./extensions/Measure/CalibrationPanels.js");
/* harmony import */ var _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./EventTypes.js */ "./extensions/Measure/EventTypes.js");




const av = Autodesk.Viewing;

//
// /** @constructor */
//
//
var CalibrationTool = function (viewer, options, sharedMeasureConfig, snapper)
{
  var av = Autodesk.Viewing;
  var MeasureCommon = Autodesk.Viewing.MeasureCommon;

  var _names = ["calibration"];
  var _priority = 50;
  var _viewer = viewer;
  var _measurement = new MeasureCommon.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE);
  var _options = options || {};

  this.setGlobalManager(viewer.globalManager);

  // Shared State with MeasureTool and Indicator
  var _sharedMeasureConfig = sharedMeasureConfig;

  var _maxPrecision = options.maxPrecision || 5;
  var _isCalibrated = sharedMeasureConfig.calibrationFactor != null; // True when the user set the calibration, or used a Previous calibration factor.

  var _snapper = snapper;

  var _active = false;
  var _isDragging = false;
  var _isPressing = false;

  var _distance = null; // The length of the current measurement.
  var _calibrationTaken = false; // True when the user selected two valid points and set the calibration.
  var _selectedSize = null;
  var _selectedUnits = null;
  var _selectedP1 = null;
  var _selectedP2 = null;
  var _waitingForInput = false; // True when the user selected two valid points.
  var _picksBackup = [];
  var _cursorPosition = null;

  var _activePoint = 0;

  var _endpointMoved = false;

  var _consumeSingleClick = false;
  var _singleClickHandled = false;
  var _downX = null;
  var _downY = null;

  // GUI.
  var _calibrationPanel = null;
  var _cursor = "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAYCAYAAAD+vg1LAAAAAXNSR0IArs4c6QAAAwZJREFUSA2tVEtLW0EUvjGJefoqSY0x0WBSiY+oNWiUINkU6ioLaaAlG1eudNVFoT+grgopiCkEIbUK1o0lusmurRSEWmmKG6MNtNhNosWqyU2CZPpN8cr15nFD7YHDzHnON2fOGYZhmHkw4XEW+wD4xkT4lMvl6CE0+Y2ohh+dz+cZn89HVS/5+n/d/wVMkXq9Xor2v5SBgsmymQwZHx+vOqlKpXKDXWI3eU6Tg+kqSjSh3W4/s9lsvzUajaNcAK3xY7Dyci3nd6WXSCS60dHRvMfjSRcKBfWV4SYbrVarB8p0PB5nY7HYmdVq/aDX67WlckpKKcvpOjs7X09OTvoPDw8z2Wy2Bu+imJqa+npycnJXGHOt3YRGoSyVSvvMZrNkYWFBs7GxkaoBAXFJcDJhcCW5rq5ur62trQ/EOhyOBhDT2Nj4qVKMqA31ve1yub7Rfufo/PycDA4OxpuamhqECaouhVqtfuD3+1tqa2uZQCCQDoVCWTwknVQDDvIKE1clI1ja09Ozg0cjx8fHpL+/P+50OhMU8f7+Punt7f2I5NdqXRXi9fV1z9jYWCuIWV5eziSTyWAqlXq1urqaw6AwOMiCG4lOYtEturu732xubhK0FQHSvfr6+lsog4HWPIPvIBqNErRiqCiwkkKpVFowZd8xZSQYDLImk+kJ52+xWJ4tLS3hU8yTkZGRBD2Ms4mu6Nun4XA4f3p6SoaGhuJ0+rgg/Bsmt9udYFmWzM3NZdDT05ztWsE5JV0R1AqUCfTt0fb2tjESiRRmZmaOUOcI3w9DY5mdnb03PDzMoDQ/MZFRzM20lO/E38vl8vt46UdAq0WNJWixlEwmu8B1bXioOxwjpgXJ0hMTE1og1qysrDghf+HnKtoD7c7u7i5ZXFzMGY3GF7iFuRR3dHTMr62tXWxtbZH29vZ3RYmECozu54ODAzpdP2hphHZOVigUVjChvgMDA+85fdm1q6vrrU6n+4WR9Zd1ujQ0Nzc/NBgMScSExXwZ2j5oL5Wo46UD/ZvxUemo+AdW1zJzUYr16wAAAABJRU5ErkJggg==), auto";
  var _hasUI = Autodesk.Viewing.GuiViewer3D && viewer instanceof Autodesk.Viewing.GuiViewer3D;


  function getActivePick()
  {
    switch (_activePoint) {
      case 0:
        return null;
      case 1:
      case 2:
        return _measurement.getPick(_activePoint);
      case 3:
        return _measurement.getPick(_measurement.countPicks());
    }
  }

  function getPreviousPick()
  {
    switch (_activePoint) {
      case 0:
        return null;
      case 1:
        return _measurement.getPick(_measurement.countPicks());
      case 2:
      case 3:
        return _measurement.getPick(1);
    }
  }

  function hasPreviousPick()
  {
    switch (_activePoint) {
      case 0:
        return false;
      case 1:
        return _measurement.hasPick(_measurement.countPicks());
      case 2:
      case 3:
        return _measurement.hasPick(1);
    }
  }

  function noPicksSet() {
    _activePoint = 0;
  }

  function allPicksSet() {
    _activePoint = 3;
    _measurement.indicator.changeAllEndpointsEditableStyle(true);
  }

  function isNoPicksSet() {
    return _activePoint === 0;
  }

  function areAllPicksSet() {
    return _activePoint === 3;
  }

  this.register = function ()
  {
    if (_hasUI && !_calibrationPanel) {
      _calibrationPanel = new _CalibrationPanels_js__WEBPACK_IMPORTED_MODULE_1__.CalibrationPanel(this, _viewer, "calibration-panel", "Calibration", _options);
      _viewer.addPanel(_calibrationPanel);
    }

    this.onCameraChangeBinded = this.onCameraChange.bind(this);
    this.screenSizeChangedBinded = this.screenSizeChanged.bind(this);
  };

  this.deregister = function ()
  {
    this.deactivate();

    if (_calibrationPanel) {
      _viewer.removePanel(_calibrationPanel);
      _calibrationPanel.uninitialize();
      _calibrationPanel = null;
    }
  };

  this.isActive = function ()
  {
    return _active;
  };

  this.getNames = function ()
  {
    return _names;
  };

  this.getName = function ()
  {
    return _names[0];
  };

  this.getPriority = function ()
  {
    return _priority;
  };

  this.getCursor = function () {
    return _isDragging ? null : _cursor;
  };

  this.activate = function ()
  {
    _active = true;
    _isDragging = false;
    this.isEditingEndpoint = false;
    this.editByDrag = false;
    noPicksSet();

    _viewer.toolController.activateTool(_snapper.getName());
    _viewer.toolController.activateTool("magnifyingGlass");


    if (!_measurement.indicator) {
      _measurement.attachIndicator(_viewer, this, _CalibrationToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.CalibrationToolIndicator);
    }

    _measurement.indicator.clear();

    if (_calibrationTaken && _selectedP1 && _selectedP2) {
      _measurement.setPick(1, _selectedP1.clone());
      _measurement.setPick(2, _selectedP2.clone());

      allPicksSet();

      var parsedRequestedSize = Autodesk.Viewing.Private.UnitParser.parsePositiveNumber(_selectedSize, _selectedUnits);
      _measurement.indicator.updateLabelValue(Autodesk.Viewing.Private.formatValueWithUnits(parsedRequestedSize, _selectedUnits, 3, _sharedMeasureConfig.precision));
      _distance = _measurement.distanceXYZ;
      _measurement.indicator.changeLabelClickableMode(false);
      _waitingForInput = true;
      var valid = this.render();
      _measurement.indicator.changeAllEndpointsEditableStyle(true);

      if (valid) {
        if (_calibrationPanel) {
          _calibrationPanel.setPanelValue(_selectedSize);
        }

        this.showPanel();
      }
    } else if (_hasUI) {
      const message = {
        messageKey: "Select two points",
        messageDefaultValue: "Select two points to calibrate drawing",
        position: "top"
      };
      Autodesk.Viewing.Private.HudMessage.displayMessage(_viewer.container, message);
    }

    _viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
    _viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.screenSizeChangedBinded);
  };

  this.deactivate = function ()
  {
    if (!_active)
    return;

    _viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'end' });

    _active = false;

    Autodesk.Viewing.Private.HudMessage.dismiss();
    this.hidePanel();
    this.updateViewportId(true);
    _waitingForInput = false;
    _measurement.clearAllPicks();

    if (_snapper && _snapper.isActive()) {
      _viewer.toolController.deactivateTool(_snapper.getName());
    }

    _viewer.toolController.deactivateTool("magnifyingGlass");

    if (_measurement.indicator) {
      _measurement.indicator.clear();
      _measurement.indicator.destroy();
      _measurement.indicator = null;
    }

    _viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
    _viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.screenSizeChangedBinded);
  };

  this.getActivePointIndex = function () {
    return _activePoint;
  };

  this.setCalibrationFactor = function (calibrationFactor) {
    _sharedMeasureConfig.calibrationFactor = calibrationFactor;
  };

  this.getCalibrationFactor = function () {
    return _sharedMeasureConfig.calibrationFactor;
  };

  this.updateLabelValue = function (value) {
    _measurement.indicator.updateLabelValue(value);
  };

  this.isCalibrationValid = function (requestedUnits, requestedSize) {
    var parsedRequestedSize = Autodesk.Viewing.Private.UnitParser.parsePositiveNumber(requestedSize, requestedUnits);
    return !isNaN(parsedRequestedSize);
  };

  this.calibrate = function (requestedUnits, requestedSize)
  {

    var calibrationFactor = null;

    var parsedRequestedSize = Autodesk.Viewing.Private.UnitParser.parsePositiveNumber(requestedSize, requestedUnits);

    if (!isNaN(parsedRequestedSize)) {
      var currentSize = Autodesk.Viewing.Private.convertUnits(_viewer.model.getUnitString(), requestedUnits, 1, _distance);
      if (currentSize !== 0 && !isNaN(currentSize)) {
        calibrationFactor = parsedRequestedSize / currentSize;
        _sharedMeasureConfig.calibrationFactor = calibrationFactor;
        _sharedMeasureConfig.units = requestedUnits;
        var defualtPrecision = _viewer.model.is2d() ? 3 : 1;
        var requestedPrecision = Autodesk.Viewing.Private.calculatePrecision(requestedSize);
        _sharedMeasureConfig.precision = Math.max(_sharedMeasureConfig.precision ? _sharedMeasureConfig.precision : defualtPrecision, requestedPrecision);
        _selectedSize = requestedSize;
        _selectedUnits = requestedUnits;
        _isCalibrated = true;
        _calibrationTaken = true;
        _selectedP1 = _measurement.getPick(1).clone();
        _selectedP2 = _measurement.getPick(2).clone();
      }
    }

    if (calibrationFactor) {
      _viewer.getExtension('Autodesk.Measure').enableCalibrationTool(false);
      _viewer.dispatchEvent({ type: MeasureCommon.Events.FINISHED_CALIBRATION, units: requestedUnits, scaleFactor: calibrationFactor, size: requestedSize });
    }
  };

  this.calibrateByScale = function (requestedUnits, requestedScale) {
    _sharedMeasureConfig.calibrationFactor = requestedScale;

    if (_sharedMeasureConfig.units !== requestedUnits) {
      _sharedMeasureConfig.units = requestedUnits;
      _selectedUnits = requestedUnits;
    }

    _isCalibrated = true;
  };

  this.getCurrentUnits = function () {
    return _sharedMeasureConfig.units;
  };

  this.hidePanel = function () {
    if (_calibrationPanel) {
      _calibrationPanel.setVisible(false);
    } else
    {
      _viewer.dispatchEvent({ type: MeasureCommon.Events.CLOSE_CALIBRATION_PANEL_EVENT });
    }
  };

  this.showPanel = function () {

    Autodesk.Viewing.Private.HudMessage.dismiss();

    var self = this;
    const _window = this.getWindow();

    if (_calibrationPanel) {
      _window.setTimeout(function () {_calibrationPanel.requestedSizeTextbox.focus();}, 0);
      _calibrationPanel.setVisible(true);
      _calibrationPanel.updatePanelPosition(_measurement.indicator.labelPosition, _measurement.indicator.p1, _measurement.indicator.p2, _measurement.indicator.calibrationLabel.clientHeight);
      _calibrationPanel.updateUnits();
      self.addWindowEventListener("keyup", function onKeyUp(e) {
        var key = e.key || String.fromCharCode(e.keyCode);
        if (key == "Escape" && self.isActive()) {
          self.hidePanel();
          self.clearSize();
          self.showAddCalibrationLabel();

          self.removeWindowEventListener("keyup", onKeyUp);
        }
      });
    } else
    {
      _viewer.dispatchEvent({ type: MeasureCommon.Events.OPEN_CALIBRATION_PANEL_EVENT, data: { size: _selectedSize, units: _selectedUnits } });
    }
  };

  this.updateCalibrationPanel = function () {
    _calibrationPanel && _calibrationPanel.updateUnits();
  };

  this.showAddCalibrationLabel = function () {
    _measurement.indicator.showAddCalibrationLabel();
  };

  this.isCalibrated = function () {
    return _isCalibrated;
  };

  this.clearSize = function () {
    _measurement.indicator.updateLabelValue(null);

    if (_calibrationPanel) {
      _calibrationPanel.requestedSizeTextbox.value = "";
    } else
    {
      _viewer.dispatchEvent({ type: MeasureCommon.Events.CLEAR_CALIBRATION_SIZE_EVENT });
    }
  };

  this.getMaxPrecision = function () {
    return _maxPrecision;
  };

  this.clearMeasurement = function () {

    noPicksSet();

    this.clearPick(1);
    this.clearPick(2);

    _measurement.indicator.clear();

    this.updateViewportId(true);
    this.hidePanel();

    _waitingForInput = false;
  };

  this.clearPick = function (pickNumber) {
    if (_measurement.hasPick(pickNumber)) {
      _measurement.clearPick(pickNumber);
      _measurement.indicator.hideClick(pickNumber);
    }
  };

  this.repickEndpoint = function (pickNumber) {
    this.clearPick(pickNumber);
    this.editEndpoint(null, pickNumber);
  };

  this.getSnapper = function () {
    return _snapper;
  };

  this._handleMouseEvent = function (event) {

    var valid = false;

    if (_snapper.isSnapped()) {

      // User picked a new point after two points where already set (or none) - Start a new measurement.
      if (areAllPicksSet() || isNoPicksSet()) {
        this.clearMeasurement();
        _activePoint = 1;
      }

      _snapper.copyResults(getActivePick());

      valid = true;

    } else
    {
      // In order to draw rubber-band, set the cursor position, so the indicator will use it as active point.
      if (event && _viewer.model.is2d()) {
        var viewport = _viewer.container.getBoundingClientRect();
        var x = event.canvasX || event.clientX - viewport.left;
        var y = event.canvasY || event.clientY - viewport.top;

        if (x && y) {
          _cursorPosition = MeasureCommon.inverseProject({ x: x, y: y }, _viewer);
        }
      }

      // In case a measurement is set, and the user clicks on a blank spot - don't do nothing.
      if (_consumeSingleClick && _measurement && !this.isEditingEndpoint) {
        if (_activePoint === _measurement.getMaxNumberOfPicks() + 1) {
          return true;
        }
      }

      var lastPick = getActivePick();
      if (lastPick) {
        lastPick.clear();
      }
    }

    this.correctPickPosition();

    if (_consumeSingleClick) {
      this._doConsumeSingleClick(valid);
    }

    if (!isNoPicksSet()) {
      var renderSucceeded = this.render();

      // If it's the first pick, we don't expect the render of the rubberband to be succeeded.
      // So enter here only if it's not the first pick.
      if (_measurement.hasPick(2)) {
        valid &= renderSucceeded;
      }
    }

    if (_consumeSingleClick) {
      if (_measurement.isComplete() && valid) {
        _distance = _measurement.distanceXYZ;
        this.clearSize();
        this.showPanel();
        _waitingForInput = true;
        _viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'end' });
      } else
      {
        _viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'start' });
        this.hidePanel();
        _measurement.indicator.updateLabelValue(null);
        _waitingForInput = false;
      }
    }

    // If valid is false, the last pick is not revelant, and will clear it in case of a click.
    return valid;
  };

  this.updateViewportId = function (clear) {
    if (_viewer.model && _viewer.model.is2d()) {
      if (clear || isNoPicksSet()) {
        viewer.impl.updateViewportId(0);
        _snapper.setViewportId(null);
      } else
      if (!_isPressing) {
        var viewport = getPreviousPick().viewportIndex2d || getActivePick().viewportIndex2d;

        // Pass viewport Id to LineShader to make all other geometries with different viewport transparent
        viewer.impl.updateViewportId(viewport);
        if (_snapper)
        _snapper.setViewportId(viewport);

      }
    }
  };

  this._doConsumeSingleClick = function (valid) {

    this.updateViewportId(_measurement.isComplete());

    _measurement.indicator.clear();
  };


  this.handleButtonDown = function (event, button) {
    if (av.isMobileDevice())
    return false;

    _isDragging = true;
    if (button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      _consumeSingleClick = true;
      _downX = event.canvasX;
      _downY = event.canvasY;
    }
    return false;
  };

  this.handleMouseMove = function (event) {
    if (av.isMobileDevice())
    return false;

    if (event.canvasX !== _downX || event.canvasY !== _downY) {
      _consumeSingleClick = false;
    }

    _endpointMoved = this.isEditingEndpoint;

    if (!isNoPicksSet() && !areAllPicksSet()) {
      this.clearPick(_activePoint);
      this._handleMouseEvent(event);
    }

    _snapper.indicator.render();

    return false;
  };

  this.restoreMouseListeners = function () {

    // When a press event has happend, the default behavior of firefly.js is to disable other mouse events,
    // So they won't be triggered as well.
    // The solution is to enable them after the end of the pressing.

    _viewer.toolController.getTool("gestures").controller.enableMouseButtons(true);
  };

  this.handlePressHold = function (event) {
    _consumeSingleClick = false;

    if (av.isTouchDevice()) {
      switch (event.type) {

        case "press":
          _isPressing = true;
          if (areAllPicksSet()) {
            this.clearMeasurement();
          } else {
            this.clearPick(_activePoint);
          }
          this._handleMouseEvent(event);
          _snapper.indicator.render();

          return true;

        case "pressup":
          _consumeSingleClick = true;
          this.restoreMouseListeners();
          _singleClickHandled = !_singleClickHandled;
          this.handleSingleClick(event);
          _isPressing = false;
          return true;
      }
    }
    return false;

  };

  this.correctPickPosition = function () {

    var active = getActivePick();

    if (active && !active.getGeometry() && _cursorPosition) {
      active.geomType = MeasureCommon.SnapType.SNAP_VERTEX;
      active.geomVertex = _cursorPosition;
      active.intersectPoint = _cursorPosition;
    }

    if (hasPreviousPick()) {
      var passive = getPreviousPick();
      MeasureCommon.correctPerpendicularPicks(passive, active, viewer, _snapper);
    }
  };

  this.render = function () {

    var hasResult = _measurement.computeResult(_measurement.picks, _viewer, _snapper);
    _measurement.indicator.render(_measurement.picks, _consumeSingleClick || _waitingForInput);

    return hasResult;
  };

  this.editEndpoint = function (event, endpointNumber) {
    if (_activePoint === endpointNumber) {
      _measurement.indicator.changeEndpointOnEditStyle(endpointNumber, false);
      this.undoEditEndpoint();
      return;
    }

    _activePoint = endpointNumber;
    this.isEditingEndpoint = true;

    _measurement.indicator.changeEndpointOnEditStyle(endpointNumber, true);
    _measurement.indicator.changeAllEndpointsEditableStyle(false);

    for (var key in _measurement.picks) {
      if (Object.prototype.hasOwnProperty.call(_measurement.picks, key)) {
        _picksBackup[key] = _measurement.getPick(key).clone();
      }
    }

    this.updateViewportId();

    _viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'start' });
    this.hidePanel();
    _measurement.indicator.updateLabelValue(null);
    _waitingForInput = false;

    if (!av.isMobileDevice()) {
      this._handleMouseEvent(event);
    }
  };

  this.undoEditEndpoint = function () {
    _measurement.indicator.clear();

    for (var key in _measurement.picks) {
      if (Object.prototype.hasOwnProperty.call(_measurement.picks, key)) {
        _measurement.setPick(key, _picksBackup[key].clone());
      }
    }

    this.updateViewportId(true);
    this.isEditingEndpoint = false;
    _waitingForInput = true;

    allPicksSet();
    var valid = this.render();

    if (valid) {
      this.showPanel();
    }
  };

  this.handleGesture = function (event)
  {
    if (av.isTouchDevice()) {

      _consumeSingleClick = false;

      if (_isPressing) {

        this.clearPick(_activePoint);

        switch (event.type) {

          case "dragstart":
            this._handleMouseEvent(event);
            _snapper.indicator.render();

            return true;

          case "dragmove":
            this._handleMouseEvent(event);
            _snapper.indicator.render();

            return true;

          case "dragend":
            _isPressing = false;
            _consumeSingleClick = true;

            if (!this.editByDrag) {
              _singleClickHandled = !_singleClickHandled;
              this.handleSingleClick(event);
            }

            this.editByDrag = false;
            this.restoreMouseListeners();
            return true;

          case "pinchend":
            _consumeSingleClick = true;
            _singleClickHandled = !_singleClickHandled;
            this.handleSingleClick(event);
            this.restoreMouseListeners();
            return true;
        }
      }
    }

    return false;
  };

  this.handleButtonUp = function (event) {
    _isDragging = false;
    _downX = null;
    _downY = null;

    if (_endpointMoved) {
      _consumeSingleClick = true;
      _singleClickHandled = !_singleClickHandled;
      this.handleSingleClick(event);
      _endpointMoved = false;
    }

    return false;
  };

  this.handleSingleClick = function (event) {
    if (_consumeSingleClick) {

      _snapper.indicator.clearOverlays();

      _measurement.indicator.changeEndpointOnEditStyle(_activePoint, false);

      if (this._handleMouseEvent(event)) {
        _measurement.indicator.showEndpoints();
        _measurement.indicator.updateLabelsPosition();
        _activePoint++;
      } else
      {
        if (this.isEditingEndpoint) {
          this.undoEditEndpoint();
        } else
        {
          this.clearMeasurement();
        }
      }

      if (_measurement.isComplete()) {
        allPicksSet();
      }

      _consumeSingleClick = false;
      _singleClickHandled = !_singleClickHandled;
      this.isEditingEndpoint = false;

      _snapper.clearSnapped();
    }
    return true;
  };

  this.handleDoubleClick = function () {
    return true;
  };

  this.handleSingleTap = function (event) {
    if (!_singleClickHandled) {
      _consumeSingleClick = true;
      _snapper.onMouseDown({ x: event.canvasX, y: event.canvasY });
      this.handleSingleClick(event);
    }
    _singleClickHandled = !_singleClickHandled;

    return true;
  };

  this.handleDoubleTap = function () {
    return true;
  };

  this.handleResize = function () {
    if (_measurement.indicator) {
      _measurement.indicator.handleResize();
    }
  };

  this.onCameraChange = function () {
    if (_snapper.indicator) {
      _snapper.indicator.onCameraChange();
    }
  };

  this.screenSizeChanged = function (event) {
    this.onCameraChange();
  };
};

av.GlobalManagerMixin.call(CalibrationTool.prototype);

/***/ },

/***/ "./extensions/Measure/CalibrationToolIndicator.js"
/*!********************************************************!*\
  !*** ./extensions/Measure/CalibrationToolIndicator.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CalibrationToolIndicator: () => (/* binding */ CalibrationToolIndicator)
/* harmony export */ });
/* harmony import */ var _Indicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Indicator.js */ "./extensions/Measure/Indicator.js");


var av = Autodesk.Viewing;
var MeasureCommon = Autodesk.Viewing.MeasureCommon;

// /** @constructor */
function CalibrationToolIndicator(viewer, measurement, calibrationTool)
{
  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.call(this, viewer, measurement, calibrationTool);
  this.calibrationTool = calibrationTool;
  this.calibrationLabel = null;
  this.endpoints = null;
  this.tmpVector = new THREE.Vector3();
  this.p1 = null;
  this.p2 = null;

  this.rubberbandDefaultMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
    color: 0xe8b22c,
    opacity: 1,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  this.rubberbandSnappedMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
    color: 0x005BCE,
    opacity: 1,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  this.rubberbandTipMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
    color: 0x000000,
    opacity: 1,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

}

CalibrationToolIndicator.prototype = Object.create(_Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype);
CalibrationToolIndicator.prototype.constructor = CalibrationToolIndicator;
var proto = CalibrationToolIndicator.prototype;

var kEndpointOffset = 15;

var kCrossWidth = 1.5;
var kTipXWidth = 2;
var kLineWidth = 3;

var kTipXLength = 3;
var kCrossLength = 5;

var kDashSize = 2;
var kGapSize = 1;

proto.createEndpoint = function (name) {
  this.endpoints[name] = {};
  this.endpoints[name].position = null;

  const _document = this.getDocument();
  var label = this.endpoints[name].label = _document.createElement('div');
  label.className = 'calibration-endpoint';

  this.viewer.container.appendChild(label);

  var text = _document.createElement('div');
  text.className = 'calibration-endpoint-text';
  text.textContent = name.toString();
  label.appendChild(text);

  if (av.isTouchDevice()) {
    this.initLabelMobileGestures(label, name, this.calibrationTool);
  }
  // Disable hover for mobile devices
  if (!av.isMobileDevice()) {
    MeasureCommon.safeToggle(label, 'enable-hover', true);

    this.initMouseEvent(label, name);

    label.addEventListener('mousewheel', this.viewer.toolController.mousewheel);

  }
};

proto.init = function () {

  MeasureCommon.createCommonOverlay(this.viewer, this.overlayName);

  if (!this.calibrationLabel) {
    const _document = this.getDocument();
    this.calibrationLabel = _document.createElement('div');
    this.calibrationLabel.className = 'calibration-label';
    this.hideLabel(this.calibrationLabel);
    this.viewer.container.appendChild(this.calibrationLabel);
    this.calibrationLabel.addEventListener('mousewheel', this.viewer.toolController.mousewheel);

    var text = _document.createElement('div');
    text.className = 'calibration-label-text';
    this.calibrationLabel.appendChild(text);
  }

  this.endpoints = [];

  this.handleButtonUpBinded = this.calibrationTool.handleButtonUp.bind(this.calibrationTool);
  this.addWindowEventListener('mouseup', this.handleButtonUpBinded);

  this.onCameraChangeBinded = this.onCameraChange.bind(this);
  this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
};

proto.destroy = function () {
  this.clear();

  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype.destroy.call(this);

  if (this.calibrationLabel) {
    this.calibrationLabel.removeEventListener('mousewheel', this.viewer.toolController.mousewheel);
    this.viewer.container.removeChild(this.calibrationLabel);
    this.calibrationLabel = null;
  }


  this.viewer.impl.clearOverlay(this.overlayName, true);
  this.viewer.impl.removeOverlayScene(this.overlayName);

  this.removeWindowEventListener('mouseup', this.handleButtonUpBinded);
  this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
};

proto.clearRubberband = function () {
  this.viewer.impl.clearOverlay(this.overlayName, true);
};

proto.clear = function () {

  this.clearRubberband();

  this.hideLabel(this.calibrationLabel);

  for (var name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      this.hideClick(name);
      this.endpoints[name].position = null;
    }
  }
};

proto.updateLabelValue = function (text) {
  if (!text || text === "") {
    this.calibrationLabel.childNodes[0].textContent = null;
    this.hideLabel(this.calibrationLabel);
  } else
  {
    this.calibrationLabel.childNodes[0].setAttribute("data-i18n", text);
    this.calibrationLabel.childNodes[0].textContent = av.i18n.translate(text);
    this.showLabel(this.calibrationLabel);
    this.calibrationTool.render();
  }
};

proto.changeLabelClickableMode = function (clickable) {
  if (clickable) {
    this.calibrationLabel.childNodes[0].style.pointerEvents = 'all';
  } else
  {
    this.calibrationLabel.childNodes[0].style.pointerEvents = 'none';
  }
};

proto.showAddCalibrationLabel = function () {
  var self = this;
  this.updateLabelValue("Add Calibration");
  this.changeLabelClickableMode(true);
  this.calibrationTool.render();

  this.calibrationLabel.addEventListener("click", function onClick() {
    self.calibrationLabel.childNodes[0].style.pointerEvents = 'none';
    self.calibrationTool.render();
    self.updateLabelValue(null);
    self.calibrationTool.showPanel();
    self.calibrationLabel.removeEventListener("click", onClick);
  });
};

proto.updateLabelsPosition = function () {
  for (var i = 1; i <= Object.keys(this.endpoints).length; i++) {
    if (this.endpoints[i].position) {
      var label = this.endpoints[i].label;
      var pos = MeasureCommon.project(this.endpoints[i].position, this.viewer, kEndpointOffset);
      label.style.left = pos.x - parseInt(label.clientWidth) / 2 + 'px';
      label.style.top = pos.y - parseInt(label.clientHeight) / 2 + 'px';
      label.point = this.endpoints[i].position;

      // Detect and move in case of overlapping.
      this.labelsOverlapDetection(this.endpoints[i].label, this.endpoints);
    }
  }

  this.hideLabelsOutsideOfView();
};

function isLeftIntersect(current, other) {
  return current.right >= other.left && current.right <= other.right;
}

function isRightIntersect(current, other) {
  return current.left >= other.left && current.left <= other.right;
}

function isMiddleIntersect(current, other) {
  return current.left <= other.left && current.right >= other.right;
}

function isVerticalIntersect(current, other) {
  return current.top < other.bottom && current.bottom > other.top;
}

function moveLeft(currentLabel, currentRect, otherRect) {
  currentLabel.style.left = parseInt(currentLabel.style.left, 10) - (currentRect.right - otherRect.left) + 'px';
}

function moveRight(currentLabel, currentRect, otherRect) {
  currentLabel.style.left = parseInt(currentLabel.style.left, 10) + (otherRect.right - currentRect.left) + 'px';
}

function moveDown(currentLabel, currentRect, otherRect) {
  currentLabel.style.top = parseInt(currentLabel.style.top, 10) + (otherRect.bottom - currentRect.top) + 'px';
}


proto.labelsOverlapDetection = function (staticLabel, labelsList) {

  for (var i = 1; i <= Object.keys(labelsList).length; i++) {

    var dynamicLabel = labelsList[i].label;

    if (staticLabel !== dynamicLabel) {
      var staticRect = staticLabel.getBoundingClientRect();
      var dynamicRect = dynamicLabel.getBoundingClientRect();

      if (isVerticalIntersect(dynamicRect, staticRect)) {

        if (isLeftIntersect(dynamicRect, staticRect)) {
          moveLeft(dynamicLabel, dynamicRect, staticRect);
        } else
        if (isRightIntersect(dynamicRect, staticRect)) {
          moveRight(dynamicLabel, dynamicRect, staticRect);
        } else
        if (isMiddleIntersect(dynamicRect, staticRect)) {
          moveDown(dynamicLabel, dynamicRect, staticRect);
        }
      }
    }
  }
};

proto.renderCalibrationLabel = function () {

  if (this.showMeasureResult && this.calibrationLabel && this.p1 && this.p2) {

    var point = { x: (this.p1.x + this.p2.x) / 2, y: (this.p1.y + this.p2.y) / 2, z: (this.p1.z + this.p2.z) / 2 };
    var mid = MeasureCommon.project(point, this.viewer);

    this.labelPosition = new THREE.Vector2(mid.x, mid.y);

    if (this.calibrationLabel.childNodes[0].textContent) {
      this.showLabel(this.calibrationLabel);
    }

    this.calibrationLabel.style.top = this.labelPosition.y - Math.floor(this.calibrationLabel.clientHeight / 2) + 'px';
    this.calibrationLabel.style.left = this.labelPosition.x - Math.floor(this.calibrationLabel.clientWidth / 2) + 'px';
    this.calibrationLabel.point = point;

    if (this.viewer.model.is2d()) {
      this.alignLabelWithLine(this.calibrationLabel, this.p1, this.p2, this.calibrationLabel.clientHeight, this.viewer);
    }
  }
};

proto.drawMeasurementLineTip = function (point, direction, normal, flip) {

  const tmpPoints = [new THREE.Vector3(), new THREE.Vector3()];
  const geometry = new THREE.BufferGeometry();
  var p1Scale = this.setScale(point);

  flip = flip ? -1 : 1;

  var tipMaterial = this.snapper.isSnapped() && !this.showMeasureResult ? this.rubberbandSnappedMaterial : this.rubberbandTipMaterial;

  // black tip
  tmpPoints[0].addVectors(point, normal.clone().multiplyScalar(kCrossLength * p1Scale));
  tmpPoints[1].subVectors(point, normal.clone().multiplyScalar(kCrossLength * p1Scale));
  geometry.setFromPoints(tmpPoints);
  this.drawLineAsCylinder(geometry, tipMaterial, kCrossWidth, this.overlayName);

  tmpPoints[0].copy(point);
  tmpPoints[1].subVectors(point, direction.clone().multiplyScalar(kCrossLength * p1Scale * flip));
  geometry.setFromPoints(tmpPoints);
  this.drawLineAsCylinder(geometry, tipMaterial, kCrossWidth, this.overlayName);

  // yellow tip
  tmpPoints[0].addVectors(point, normal.clone().multiplyScalar(kTipXLength * p1Scale));
  tmpPoints[1].subVectors(point, normal.clone().multiplyScalar(kTipXLength * p1Scale));
  geometry.setFromPoints(tmpPoints);
  this.drawLineAsCylinder(geometry, this.rubberbandDefaultMaterial, kTipXWidth, this.overlayName);

  tmpPoints[0].addVectors(point, normal.clone().multiplyScalar(kTipXLength * p1Scale));
  tmpPoints[0].addVectors(tmpPoints[0], direction.clone().multiplyScalar(kTipXLength * p1Scale));
  tmpPoints[1].subVectors(point, normal.clone().multiplyScalar(kTipXLength * p1Scale));
  tmpPoints[1].subVectors(tmpPoints[1], direction.clone().multiplyScalar(kTipXLength * p1Scale));
  geometry.setFromPoints(tmpPoints);
  this.drawLineAsCylinder(geometry, this.rubberbandDefaultMaterial, kTipXWidth, this.overlayName);
};

proto.renderDistanceMeasurement = function (p1, p2) {

  this.viewer.impl.clearOverlay(this.overlayName, true);

  if (!p1 || !p2)
  return;

  var lineDirection = new THREE.Vector3().subVectors(p2, p1).normalize();
  var lineNormal = lineDirection.clone().cross(this.viewer.navigation.getEyeVector()).normalize();
  var p1Scale = this.setScale(p1);

  var dashSize = kDashSize * p1Scale;
  var gapSize = kGapSize * p1Scale;

  // Main line

  var lineMaterial = (Math.abs(p1.x - p2.x) <= 0.1 || Math.abs(p1.y - p2.y) <= 0.1 ||
  this.snapper.getSnapResult().isPerpendicular) && !this.showMeasureResult ?
  this.rubberbandSnappedMaterial : this.rubberbandDefaultMaterial;

  if (this.showMeasureResult) {
    // Single solid line.
    const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    this.drawLineAsCylinder(geometry, lineMaterial, kLineWidth, this.overlayName);
  } else
  {
    this.drawDashedLine(p1, p2, dashSize, gapSize, lineMaterial, kLineWidth, this.overlayName);
  }

  this.drawMeasurementLineTip(p1, lineDirection, lineNormal, false);

  if (this.showMeasureResult) {
    this.drawMeasurementLineTip(p2, lineDirection, lineNormal, true);
  }

  this.p1 = p1;
  this.p2 = p2;

  this.renderCalibrationLabel();
};

proto.onCameraChange = function () {
  if (this.measurement.isComplete()) {
    this.renderDistanceMeasurement(this.p1, this.p2);
  }
  this.updateLabelsPosition();
};

/***/ },

/***/ "./extensions/Measure/CustomTools/AABBTree.js"
/*!****************************************************!*\
  !*** ./extensions/Measure/CustomTools/AABBTree.js ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   buildAABBTree: () => (/* binding */ buildAABBTree),
/* harmony export */   shortestDistanceBetweenAABBTrees: () => (/* binding */ shortestDistanceBetweenAABBTrees),
/* harmony export */   shortestDistanceBetweenAABBTreesSquared: () => (/* binding */ shortestDistanceBetweenAABBTreesSquared)
/* harmony export */ });
/* harmony import */ var _src_wgs_scene_SceneMath_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../src/wgs/scene/SceneMath.js */ "./src/wgs/scene/SceneMath.js");


/**
 * The bounding volume hierarchy in this file is represented by an AABB tree that describes a mesh at the triangle level.
 * This can then be used, for example, to determine the shortest distance between two meshes.
 *
 * usage:
 * const treeA = buildAABBTree(trianglesOfMeshA);
 * const treeB = buildAABBTree(trianglesOfMeshB);
 * const { distance } = findShortestDistanceBetweenAABBTree(treeA, treeB);
 */

const tVector3A = new THREE.Vector3();

/**
 * A node in the AABBTree.
 */
class AABBNode {
  /**
   * Creates a new AABBNode.
   *
   * @param {number} depth - The depth of the node in the AABBTree.
   */
  constructor(depth = 0) {
    /** @type {THREE.Box3} */
    this.bounds = new THREE.Box3();

    /** @type {THREE.Triangle[]} */
    this.triangles = [];

    /** @type {AABBNode|null} */
    this.left = null;

    /** @type {AABBNode|null} */
    this.right = null;

    /** @type {number} */
    this.depth = depth;

    /** @type {boolean} */
    this.isLeaf = false;

    Object.seal(this);
  }
}

/**
 * Builds a AABBTree (BVH of AABBs) for a given array of triangles.
 *
 * @param {THREE.Triangle[]} triangles - The array of triangles to build the AABBTree from.
 * @param {number} [maxTrianglesPerLeaf=16] - The maximum number of triangles allowed per leaf node.
 * @param {number} [maxDepth=16] - The maximum depth of the AABBTree.
 * @returns {AABBNode} The root node of the constructed AABBTree.
 */
function buildAABBTree(triangles, maxTrianglesPerLeaf = 16, maxDepth = 16) {
  if (triangles.length === 0) {
    return new AABBNode();
  }

  // Determine the axis (x, y, or z) along which the bounding box is longest,
  // and sort the triangles by the centroid along that axis to prepare for splitting.
  // This helps to create a balanced AABBTree by spatially partitioning the triangles.
  const findBestSplit = (triangles, bounds) => {
    const size = bounds.getSize(tVector3A);

    let axis = 0; // x-axis
    if (size.y > size.x && size.y > size.z) {
      axis = 1; // y-axis
    } else if (size.z > size.x && size.z > size.y) {
      axis = 2; // z-axis
    }

    // Collect the centroids of each triangle
    const trianglesWithCentroid = [];
    for (const triangle of triangles) {
      const centroid = triangle.getMidpoint(new THREE.Vector3());
      trianglesWithCentroid.push({ triangle, centroid });
    }

    // Sort triangles by centroid along the split axis
    trianglesWithCentroid.sort((a, b) => {
      return a.centroid.getComponent(axis) - b.centroid.getComponent(axis);
    });

    // Split at median
    const medianIndex = Math.floor(trianglesWithCentroid.length / 2);
    const left = trianglesWithCentroid.slice(0, medianIndex).map((t) => t.triangle);
    const right = trianglesWithCentroid.slice(medianIndex).map((t) => t.triangle);

    return { left, right };
  };

  const build = (triangles, depth) => {
    const node = new AABBNode(depth);

    // Calculate the bounding box for the triangles
    for (const triangle of triangles) {
      node.bounds.expandByPoint(triangle.a);
      node.bounds.expandByPoint(triangle.b);
      node.bounds.expandByPoint(triangle.c);
    }

    // Create leaf node if we have few triangles or reached max depth
    if (triangles.length <= maxTrianglesPerLeaf || depth >= maxDepth) {
      node.triangles = triangles;
      node.isLeaf = true;
      return node;
    }

    // Split triangles and build children
    const { left, right } = findBestSplit(triangles, node.bounds);
    if (left.length + right.length === 0) {
      // Fallback to a leaf node if split failed
      node.triangles = triangles;
      node.isLeaf = true;
      return node;
    }

    // Build children recursively
    node.left = build(left, depth + 1);
    node.right = build(right, depth + 1);
    return node;
  };

  return build(triangles, 0);
}

/**
 * Finds the squaredshortest distance between the triangles in two AABBTree.
 *
 * @param {AABBNode} aabbTreeA - The first AABBTree.
 * @param {AABBNode} aabbTreeB - The second AABBTree.
 * @returns {Object} An object containing the closest points and the squared distance between the two AABBTree.
 */
function shortestDistanceBetweenAABBTreesSquared(aabbTreeA, aabbTreeB) {

  // The following variables are meant to be used to store the best points, triangles and distance found.
  let minSquaredDist = Infinity;

  let bestPointARef = new THREE.Vector3();
  let bestPointBRef = new THREE.Vector3();
  let bestTriangleA = null;
  let bestTriangleB = null;

  const squaredDistanceBetweenBounds = (boundsA, boundsB) => {
    // Per-axis separation, clamped to 0 (0 if the boxes overlap on that axis).
    const dx = Math.max(0, boundsA.min.x - boundsB.max.x, boundsB.min.x - boundsA.max.x);
    const dy = Math.max(0, boundsA.min.y - boundsB.max.y, boundsB.min.y - boundsA.max.y);
    const dz = Math.max(0, boundsA.min.z - boundsB.max.z, boundsB.min.z - boundsA.max.z);
    return dx * dx + dy * dy + dz * dz; // squared min distance
  };

  // The queue stores pairs of AABBTree nodes to examine
  const queue = [{
    nodeA: aabbTreeA,
    nodeB: aabbTreeB,
    lowerBound: squaredDistanceBetweenBounds(aabbTreeA.bounds, aabbTreeB.bounds)
  }];

  let iterations = 0;
  const maxIterations = 10_000; // prevent infinite loops

  while (queue.length > 0 && iterations < maxIterations) {
    // Sort queue by lower bound (closest bounding box first)
    queue.sort((a, b) => {
      return a.lowerBound - b.lowerBound;
    });

    const { nodeA, nodeB, lowerBound } = queue.shift();

    // Check if the current lower bound is already greater than the best distance found
    if (lowerBound >= minSquaredDist) {
      continue;
    }

    // If both nodes are leaves, check for triangle-triangle intersections
    if (nodeA.isLeaf && nodeB.isLeaf) {
      for (const triangleA of nodeA.triangles) {
        for (const triangleB of nodeB.triangles) {
          const result = _src_wgs_scene_SceneMath_js__WEBPACK_IMPORTED_MODULE_0__.SceneMath.shortestDistanceBetweenTriangles(triangleA, triangleB);
          const squaredDistance = result.distance * result.distance;
          if (squaredDistance < minSquaredDist) {
            minSquaredDist = squaredDistance;
            bestPointARef = result.pointA;
            bestPointBRef = result.pointB;
            bestTriangleA = triangleA;
            bestTriangleB = triangleB;
          }
        }
      }
    } else {
      const childrenA = nodeA.isLeaf ? [nodeA] : [nodeA.left, nodeA.right].filter(Boolean);
      const childrenB = nodeB.isLeaf ? [nodeB] : [nodeB.left, nodeB.right].filter(Boolean);

      for (const childA of childrenA) {
        for (const childB of childrenB) {
          const lowerBound = squaredDistanceBetweenBounds(childA.bounds, childB.bounds);
          if (lowerBound < minSquaredDist) {
            queue.push({ nodeA: childA, nodeB: childB, lowerBound });
          }
        }
      }
    }

    iterations++;
  }

  return {
    pointA: bestPointARef.clone(),
    pointB: bestPointBRef.clone(),
    triangleA: bestTriangleA.clone(),
    triangleB: bestTriangleB.clone(),
    squaredDistance: minSquaredDist
  };
}

/**
 * Finds the shortest distance between the triangles in two AABBTree.
 *
 * @param {AABBNode} aabbTreeA - The first AABBTree.
 * @param {AABBNode} aabbTreeB - The second AABBTree.
 * @returns {Object} An object containing the closest points and the distance between the two AABBTree.
 */
function shortestDistanceBetweenAABBTrees(aabbTreeA, aabbTreeB) {
  const result = shortestDistanceBetweenAABBTreesSquared(aabbTreeA, aabbTreeB);
  Object.assign(result, { distance: Math.sqrt(result.squaredDistance) });
  return result;
}

/***/ },

/***/ "./extensions/Measure/CustomTools/HighlightManager.js"
/*!************************************************************!*\
  !*** ./extensions/Measure/CustomTools/HighlightManager.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HighlightManager: () => (/* binding */ HighlightManager)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);


/**
 * Manages the highlights for a measurement tool
 */
class HighlightManager {
  constructor(viewer, overlayName, highlightMaterialOptions) {
    this.viewer = viewer;
    this.overlayName = overlayName;
    this.highlightMaterialOptions = highlightMaterialOptions;

    this.highlightMeshes = [];
    this.highlightMaterial = null;

    // Reusable matrix instances for performance optimization
    this.tempMatrix = new three__WEBPACK_IMPORTED_MODULE_0__.Matrix4();
  }

  /**
   * Gets the highlight material or creates it if it doesn't exist
   * @returns {THREE.MeshBasicMaterial} The highlight material
   */
  #createHighlightMaterial() {
    if (!this.highlightMaterial) {
      this.highlightMaterial = new Autodesk.Viewing.Scene.UnlitMaterial({
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        ...this.highlightMaterialOptions
      });
    }
    return this.highlightMaterial;
  }

  dispose() {
    this.clearHighlights();
    if (this.highlightMaterial) {
      this.highlightMaterial.dispose();
      this.highlightMaterial = null;
    }
  }

  /**
   * Creates a highlight mesh for the given model and highlight target
   * @param {Autodesk.Viewing.Model} model - The model to get the highlight mesh from
   * @param {Object} highlightTarget - The highlight target to get the highlight mesh from
   * @returns {THREE.Mesh|null} The highlight mesh or null for invalid data
   */
  #createHighlightMesh(model, highlightTarget) {
    if (!model || !highlightTarget || highlightTarget.fragId == null) {
      return null;
    }

    const fragmentList = model.getFragmentList();
    if (!fragmentList) {
      return null;
    }

    let geometry;

    if (highlightTarget.face) {
      geometry = highlightTarget.face;
    } else {
      const originalMesh = fragmentList.getVizmesh(highlightTarget.fragId);
      if (!originalMesh || !originalMesh.geometry) {
        return null;
      }
      geometry = originalMesh.geometry;
    }

    const highlightMesh = new THREE.Mesh(geometry, this.#createHighlightMaterial());

    if (!highlightTarget.face) {
      fragmentList.getWorldMatrix(highlightTarget.fragId, this.tempMatrix);
      highlightMesh.applyMatrix4(this.tempMatrix);
      // Tag with the source model so _computeObjectBounds uses fragList.getWorldBounds
      // instead of computing the bounds from the geometry.
      highlightMesh.model = model;
    }

    highlightMesh.matrixAutoUpdate = false;
    highlightMesh.frustumCulled = false;
    highlightMesh.fragId = highlightTarget.fragId;

    return highlightMesh;
  }

  /**
   * Clears all highlights
   */
  clearHighlights() {
    if (this.highlightMeshes.length > 0) {
      if (this.viewer.overlays.hasScene(this.overlayName)) {
        this.viewer.overlays.removeScene(this.overlayName);
      }
      this.highlightMeshes.forEach((mesh) => {
        mesh = null;
      });
      this.highlightMeshes = [];
    }
  }

  /**
   * Sets the highlight targets
   * @param {Object[]} targetsToHighlight - The targets to highlight
   */
  setHighlightTargets(targetsToHighlight) {
    this.clearHighlights();

    if (!targetsToHighlight || targetsToHighlight.length === 0) {
      return;
    }

    if (!this.viewer.overlays.hasScene(this.overlayName)) {
      this.viewer.overlays.addScene(this.overlayName);
      this.viewer.impl.overlayScenes[this.overlayName].scene.renderOrder = 100;
    }

    targetsToHighlight.forEach((target) => {
      if (target.fragId !== undefined && target.fragId !== null) {
        const targetModel = this.viewer.impl.findModel(target.modelId);
        if (!targetModel) {
          return;
        }
        const highlightMesh = this.#createHighlightMesh(targetModel, target);
        if (highlightMesh) {
          this.highlightMeshes.push(highlightMesh);
          this.viewer.overlays.addMesh(highlightMesh, this.overlayName);
        }
      }
    });
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/LaserMeasureComputation.js"
/*!*******************************************************************!*\
  !*** ./extensions/Measure/CustomTools/LaserMeasureComputation.js ***!
  \*******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   computeLaserResult: () => (/* binding */ computeLaserResult)
/* harmony export */ });
/* harmony import */ var _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../src/measurement/MeasureCommon.js */ "./src/measurement/MeasureCommon.js");


const av = Autodesk.Viewing;
const MeasureCommon = av.MeasureCommon;

const SNAP_PRECISION = 0.001;
const CURVED_SURFACE_SNAP_TOLERANCE = 0.1;
const POINT_PRECISION = 0.001;
const MAX_POLYGON_AXES = 2;

/**
 * Helper function to check if a point is in a line segment
 * @param {THREE.Vector3} point - The point to check
 * @param {THREE.Vector3}  vA - The first vertex of the line segment
 * @param {THREE.Vector3}  vB - The second vertex of the line segment
 * @param {Boolean} isFlat - Whether the line segment lies on a flat or curved surface edge
 * @returns {Boolean} true if the point is in the line segment. For now we assume that the line segment is flat.
 */
function isInLineSegment(point, vA, vB, isFlat = true) {
  const tolerance = isFlat ? SNAP_PRECISION : CURVED_SURFACE_SNAP_TOLERANCE;
  const ptOnEdge = getPerpPointToEdge(point, vA, vB);
  if (!ptOnEdge) {
    return false;
  }
  const distanceToSegment = ptOnEdge.distanceTo(point);
  return distanceToSegment <= tolerance;
}

/**
 * Computes the closest point on the line segment (vA, vB) to refPoint by orthogonal projection.
 * @param {THREE.Vector3} refPoint - The reference point from which to find the perpendicular
 * @param {THREE.Vector3} vA - The first vertex of the edge
 * @param {THREE.Vector3} vB - The second vertex of the edge
 * @returns {THREE.Vector3} The closest point on the line segment to refPoint
 */
function getPerpPointToEdge(refPoint, vA, vB) {
  const lineLength = vA.distanceTo(vB);
  const refVec = new THREE.Vector3().subVectors(refPoint, vA);
  const lineDirection = new THREE.Vector3().subVectors(vB, vA).normalize();

  const distance = refVec.dot(lineDirection);

  if (distance < 0 || distance > lineLength) {
    return null;
  }

  return new THREE.Vector3().addVectors(vA, lineDirection.multiplyScalar(distance));
}

/**
 * Calculates the dimension points for an edge based on intersection with a hit point
 * @param {Object} edgeData - Object containing edge geometry and intersection data
 * @param {Object} edgeData.geomLine - The edge geometry containing vertices
 * @param {Array<THREE.Vector3>} edgeData.geomLine.vertices - Array of vertex points defining the edge
 * @param {THREE.Vector3} edgeData.faceNormal - Normal vector of the face containing the edge
 * @param {THREE.Vector3} edgeData.intersectPoint - Point where ray intersects the surface
 * @returns {Array|null} Array of dimension points if valid edge data exists, null otherwise
 */
function getDimensionPoints(edgeData) {
  let dimensionPoints = null;
  const axes = [];
  const lineVertices = edgeData.geomLine?.vertices;
  const faceNormal = edgeData.faceNormal;
  const hitPoint = edgeData.intersectPoint;

  if (!lineVertices || lineVertices.length < 2 || !faceNormal || !hitPoint) {
    return dimensionPoints; // No edges to process
  }

  // For each edge:
  // 1. See if there is a perpendicular from hit point to the edge.
  // 2. If yes, add it as a dimension axis.
  for (let i = 0; i < lineVertices.length; i += 2) {
    let minDistanceToEdge1 = Number.MAX_VALUE;
    let minDistanceToEdge2 = Number.MAX_VALUE;
    const vA = lineVertices[i];
    const vB = lineVertices[i + 1];

    const edgeDir = new THREE.Vector3().subVectors(vB, vA).normalize();

    // define vector that is perpendicular to the edge and the surface normal
    // Use it to define a plane that the edge lies on, which is orthogonal to the hit surface
    const edgePerpendicular = new THREE.Vector3().crossVectors(faceNormal, edgeDir).normalize().negate();
    let skip = false;
    for (const axis of axes) {
      if (new THREE.Vector3().crossVectors(axis, edgePerpendicular).length() < _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_0__.EPSILON) {
        skip = true;
        break;
      }
    }
    if (skip) {
      // We've processed this direction already
      continue;
    }

    let distance;

    const ray = new THREE.Ray(hitPoint, edgePerpendicular);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(edgePerpendicular, vA);
    let found = ray.intersectPlane(plane, new THREE.Vector3());
    if (found) {
      distance = found.distanceTo(hitPoint);
      if (distance < minDistanceToEdge1) {
        const testPt = new THREE.Vector3().addVectors(hitPoint, edgePerpendicular.clone().multiplyScalar(distance));
        if (isInLineSegment(testPt, vA, vB)) {
          axes.push(edgePerpendicular);
        }
      } else {
        distance = -1.0;
        const oppositeRay = new THREE.Ray(hitPoint, edgePerpendicular.clone().negate());
        found = oppositeRay.intersectPlane(plane, new THREE.Vector3());
        if (found && distance < minDistanceToEdge2) {
          distance = found.distanceTo(hitPoint);
          const testPt = new THREE.Vector3().subVectors(hitPoint, edgePerpendicular.clone().multiplyScalar(distance));
          if (isInLineSegment(testPt, vA, vB)) {
            axes.push(edgePerpendicular.clone().negate());
          }
        }
      }
    }
  }

  // There is a special case where a circle is represented by a high-order polygon. If the user hits the center
  // of the circle, we get a bunch of radial axes that all show the same measurement. In that case, limit the axes
  // to two, picking the first, and one that is orthogonal to the first if any. If not, then pick the second.
  // Good test case is the top of the revolving door in Spec Office which is a 32-sided polygon.
  if (axes.length > 1 && lineVertices.length > MAX_POLYGON_AXES * 10) {
    let index1 = 0;
    for (let i = 1; i < axes.length; i++) {
      if (Math.abs(axes[0].dot(axes[i])) < _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_0__.EPSILON) {
        index1 = i;
        break;
      }
    }

    if (index1 !== 0) {
      axes[1] = axes[index1];
      axes.splice(2);
    } else if (axes.length > 0) {
      axes.splice(1);
    }
  }

  // Compute the dimensions. The axes that were collected processing individual edges
  // Now have to be processed to see if they produce a dimension by intersecting two edges.
  axes.forEach((axis) => {
    let minDistanceToEdge1 = Number.MAX_VALUE;
    let minDistanceToEdge2 = Number.MAX_VALUE;
    let points = {};

    for (let i = 0; i < lineVertices.length; i += 2) {
      const vA = lineVertices[i];
      const vB = lineVertices[i + 1];

      const edgeDir = new THREE.Vector3().subVectors(vB, vA).normalize();
      const edgePerpendicular = new THREE.Vector3().crossVectors(faceNormal, edgeDir).normalize();

      // The axis is not parallel to the edge, so skip it
      if (Math.abs(axis.dot(edgeDir)) > _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_0__.EPSILON) {
        continue;
      }

      let distance1 = -1.0;
      const ray1 = new THREE.Ray(hitPoint, axis);
      const plane1 = new THREE.Plane().setFromNormalAndCoplanarPoint(edgePerpendicular, vA);
      let found1 = ray1.intersectPlane(plane1, new THREE.Vector3());
      if (found1) {
        distance1 = found1.distanceTo(hitPoint);
        if (distance1 < minDistanceToEdge1) {
          const testPt = new THREE.Vector3().addVectors(hitPoint, axis.clone().multiplyScalar(distance1));
          if (isInLineSegment(testPt, vA, vB)) {
            points.p1 = found1;
            minDistanceToEdge1 = distance1;
          }
        }
      }

      let distance2 = -1.0;
      const oppositeAxisRay = new THREE.Ray(hitPoint, axis.clone().negate());
      let found2 = oppositeAxisRay.intersectPlane(plane1, new THREE.Vector3());
      if (found2) {
        distance2 = found2.distanceTo(hitPoint);
        if (distance2 < minDistanceToEdge2) {
          const testPt = new THREE.Vector3().subVectors(hitPoint, axis.clone().multiplyScalar(distance2));
          if (isInLineSegment(testPt, vA, vB)) {
            points.p2 = found2;
            minDistanceToEdge2 = distance2;
          }
        }
      }
    }

    if (minDistanceToEdge1 < Number.MAX_VALUE && minDistanceToEdge2 < Number.MAX_VALUE) {
      if (points.p1.distanceTo(points.p2) > POINT_PRECISION) {
        dimensionPoints = [
        ...(dimensionPoints || []),
        points];

      }
    }
  });

  return dimensionPoints;
}

/**
 * Gets the intersection point between a ray starting at the picked point and extending along the face normal
 * @param {Autodesk.Viewing.Viewer3D} viewer - The viewer instance
 * @param {Object} firstPick - The pick data containing intersection point and face information
 * @param {THREE.Vector3} normal - The face normal vector (NOTE: this vector may be modified/negated by this function)
 * @returns {Object|null} The intersection point data if found, null otherwise
 */
function getLaserIntersection(viewer, firstPick, normal) {
  const camera = viewer.getCamera();
  const isOrthographic = camera.isOrthographicCamera;
  const faceNormal = firstPick.faceNormal;

  // Get viewing direction: from camera to intersection point (perspective) or camera to target (orthographic)
  const viewingDirection = isOrthographic ?
  new THREE.Vector3().subVectors(camera.position, camera.target).normalize() :
  new THREE.Vector3().subVectors(camera.position, firstPick.intersectPoint).normalize();

  // Flip normal if facing away from camera (address VIZX-2919)
  if (viewingDirection.dot(faceNormal) < 0) {
    normal.negate();
  }

  const ray = new THREE.Ray(firstPick.intersectPoint || firstPick.intersection, normal);
  const fullResult = viewer.impl.rayIntersect(ray, false, undefined, undefined, undefined);

  if (!fullResult) return null;

  // Extract only essential data
  return {
    intersectPoint: fullResult.point || fullResult.intersectPoint,
    distance: fullResult.distance,
    fragId: fullResult.fragId,
    dbId: fullResult.dbId,
    modelId: fullResult.modelId
  };
}

/**
 * Computes the laser measurement result from picks
 * @param {Object} picks - The measurement picks
 * @param {Object} viewer - The viewer instance
 * @returns {Object|null} The laser measurement result
 */
function computeLaserResult(picks, viewer) {
  const firstPick = picks[1];
  const faceNormal = picks[1] && picks[1].faceNormal;
  if (!firstPick || !faceNormal)
  return null;

  // we measure dimensions for parallel edges only
  // either use the existing dimensions or calculate them, depends if the measurement was restored or not
  const dimensions = firstPick.dimensions ?? getDimensionPoints(firstPick);
  // Create a copy of the normal to avoid modifying the original pick data
  // need to reconstruct the normal because sometimes we get recontstucted data from `createMeasurementFromData` instead of direct computation
  const normal = new THREE.Vector3(faceNormal.x, faceNormal.y, faceNormal.z);
  const laserHitPoint = getLaserIntersection(viewer, firstPick, normal);

  if (!dimensions && !laserHitPoint) {
    return null;
  }

  // 4 possible outcomes for the measurement:
  // 1. Laser point, but no dimensions
  // 2. Dimensions but no laser point
  // 3. Both laser intersection point and dimensions
  // 4. None
  const measures = {
    intersectPoint: firstPick.intersectPoint,
    laserHitPoint,
    dimensions: dimensions,
    type: MeasureCommon.MeasurementTypes.MEASUREMENT_LASER
  };

  return measures;
}

/***/ },

/***/ "./extensions/Measure/CustomTools/LaserMeasureTool.js"
/*!************************************************************!*\
  !*** ./extensions/Measure/CustomTools/LaserMeasureTool.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LaserMeasureTool: () => (/* binding */ LaserMeasureTool)
/* harmony export */ });
/* harmony import */ var _LaserToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./LaserToolIndicator.js */ "./extensions/Measure/CustomTools/LaserToolIndicator.js");
/* harmony import */ var _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../src/measurement/Measurement.js */ "./src/measurement/Measurement.js");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _MeasureTool_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../MeasureTool.js */ "./extensions/Measure/MeasureTool.js");
/* harmony import */ var _HighlightManager_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./HighlightManager.js */ "./extensions/Measure/CustomTools/HighlightManager.js");






const av = Autodesk.Viewing;
const MeasureCommon = av.MeasureCommon;

const FRAGMENT_HIGHLIGHT_OVERLAY = "measure-fragment-highlight";
// high precision radius for laser measurements to eliminate other snapper types
const LASER_PRECISION_RADIUS = 1;

/**
 * Custom measurement tool for laser measurements.
 * Implements the CustomMeasureTool interface to provide laser-specific functionality.
 */
class LaserMeasureTool {
  constructor(viewer, snapper, sharedMeasureConfig) {
    this.viewer = viewer;
    this.snapper = snapper;
    this.sharedMeasureConfig = sharedMeasureConfig;

    // Laser-specific state
    this.highlightManager = new _HighlightManager_js__WEBPACK_IMPORTED_MODULE_4__.HighlightManager(viewer, FRAGMENT_HIGHLIGHT_OVERLAY, { color: 0xffffff, emissive: 0xffffff });
    this.measurementPreview = null;
    this.noMeasurementPossible = false;

    // Store original detectRadiusInPixels value for restoration
    this.originalDetectRadiusInPixels = null;
  }

  /**
   * Validates if a laser measurement is possible at the given snap result.
   * @param {Object} snapResult - The snap result to validate
   * @returns {boolean} True if measurement is possible
   */
  isLaserMeasurementPossible(snapResult) {
    if (!snapResult || snapResult.geomType !== MeasureCommon.SnapType.SNAP_FACE) {
      return false;
    }

    // Create a temporary measurement to test if valid results can be computed
    const tempMeasurement = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_LASER, 'temp');
    tempMeasurement.setPick(1, snapResult);
    const hasResult = tempMeasurement.computeResult(tempMeasurement.picks, this.viewer, this.snapper);

    if (!hasResult) {
      return false;
    }

    const laserResult = tempMeasurement.result;
    return laserResult && (laserResult.dimensions || laserResult.laserHitPoint);
  }

  // CustomMeasureTool interface implementation
  createMeasurement(measureData) {
    const measurement = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_LASER, measureData?.id);

    // Restore measurement from session data such as units and precision
    if (measureData) {
      measurement.options = measureData.options;
    }

    return measurement;
  }

  getIndicatorClass() {
    return _LaserToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.LaserToolIndicator;
  }

  saveSessionMeasurement(measurement, listEntry) {
    // Add laser-specific data to session storage if needed
    if (measurement.laserHitPoint) {
      listEntry.laserHitPoint = measurement.laserHitPoint;
    }
    if (measurement.dimensions) {
      listEntry.dimensions = measurement.dimensions;
    }
  }

  /**
   * Prepares laser-specific pick data for measurements.
   * This method adds laser hit point, face normal, and dimensions to the pick data.
   * @param {Object} measurement - The laser measurement
   * @param {Object} pickData - The pick data object to modify
   * @param {Object} pick - The original pick/snap result
   * @param {Object} globalOffset - The global offset to apply to spatial coordinates
   */
  preparePickData(measurement, pickData, pick, globalOffset) {
    if (measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_LASER) {
      // Apply globalOffset to laserHitPoint if it exists
      let laserHitPoint = measurement.laserHitPoint?.intersectPoint;
      if (laserHitPoint && globalOffset) {
        laserHitPoint = new THREE.Vector3(laserHitPoint.x, laserHitPoint.y, laserHitPoint.z).add(globalOffset);
        laserHitPoint = { x: laserHitPoint.x, y: laserHitPoint.y, z: laserHitPoint.z };
      }
      pickData.laserHitPoint = laserHitPoint;

      pickData.faceNormal = pick.faceNormal;

      // Apply globalOffset to dimensions if they exist
      let dimensions = measurement.dimensions;
      if (dimensions && globalOffset) {
        dimensions = dimensions.map((dim) => ({
          p1: new THREE.Vector3(dim.p1.x, dim.p1.y, dim.p1.z).add(globalOffset),
          p2: new THREE.Vector3(dim.p2.x, dim.p2.y, dim.p2.z).add(globalOffset)
        }));
      }
      pickData.dimensions = dimensions;
    }
  }

  updateMeasurementPreview(snapResult) {
    if (!snapResult) {
      // Clear preview
      if (this.measurementPreview?.indicator) {
        this.measurementPreview.indicator.clear();
      }
      this.noMeasurementPossible = false;
      return;
    }

    // Check if measurement is actually possible
    if (!this.isLaserMeasurementPossible(snapResult)) {
      // Clear preview and show red X
      if (this.measurementPreview?.indicator) {
        this.measurementPreview.indicator.clear();
      }

      this.snapper.indicator.clearOverlays();
      const noMeasurementSnapResult = snapResult.clone();
      noMeasurementSnapResult.geomType = MeasureCommon.SnapType.SNAP_NO_MEASUREMENT;
      this.snapper.indicator.renderIndicator(noMeasurementSnapResult);

      this.noMeasurementPossible = true;
      return;
    }

    // Valid measurement possible - show preview
    this.noMeasurementPossible = false;

    if (!this.measurementPreview) {
      this.measurementPreview = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_LASER, 'measurementPreview');
      this.measurementPreview.attachIndicator(this.viewer, this, _LaserToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.LaserToolIndicator);
    }

    // Render the preview
    this.measurementPreview.setPick(1, snapResult);
    this.measurementPreview.computeResult(this.measurementPreview.picks, this.viewer, this.snapper);
    this.measurementPreview.indicator.render(this.measurementPreview.picks, true, null);

    // Make sure the pointer label is always on top
    const indicator = this.measurementPreview.indicator;
    if (indicator.spotLabel && indicator.spotLabel.label) {
      indicator.spotLabel.label.id = 'measurement-preview-pointer-label';
      indicator.spotLabel.label.style.zIndex = 4;
    }
    if (indicator.endpoints[1] && indicator.endpoints[1].label) {
      indicator.endpoints[1].label.id = 'measure-pointer-label';
    }

    // Remove things we don't want to see on a preview
    indicator.clearSelectionAreas();
    indicator.hideEndpoints();
    indicator.clearSpotMesh();
  }

  getMeasurementName() {
    return 'Laser';
  }

  /**
   * Maps string representation to laser measurement type.
   * This method supports the measurement restoration process.
   * @param {string} measureTypeString - The string representation of the measurement type
   * @returns {string|null} The measurement type constant or null if not a laser measurement
   */
  getMeasurementTypeFromString(measureTypeString) {
    if (measureTypeString === 'Laser') {
      return MeasureCommon.MeasurementTypes.MEASUREMENT_LASER;
    }
    return null;
  }

  getSnapper() {
    return this.snapper;
  }

  handleButtonUp(event, button) {
    // Stub implementation for LaserMeasureTool
    // This is needed by MeasureToolIndicator but not used in laser measurement context
    return false;
  }

  getActivePointIndex() {
    // For laser measurements, always return 1 since they are single-click measurements
    return 1;
  }

  getDistanceAux(measurementDistance, viewportUnits) {
    return (0,_MeasureTool_js__WEBPACK_IMPORTED_MODULE_3__.getDistanceAux)(this.viewer, this.sharedMeasureConfig, measurementDistance, viewportUnits);
  }

  areAllPicksSet() {
    // For laser measurement previews, always return false since they are just previews
    // Real laser measurements are handled by the main MeasureTool
    return false;
  }

  activate() {
    // Set laser-specific snap filter when tool is activated
    this.snapper.setSnapFilter((snapResult) => {
      // If it's not a face, convert it to SNAP_NO_MEASUREMENT
      if (snapResult.geomType !== MeasureCommon.SnapType.SNAP_FACE) {
        snapResult.geomType = MeasureCommon.SnapType.SNAP_NO_MEASUREMENT;
      }
      return true; // Always return true to show the indicator
    });

    // Store the original detectRadiusInPixels value
    this.originalDetectRadiusInPixels = this.snapper.getDetectRadiusInPixels();

    // Set detectRadiusInPixels to 1 for laser tool precision
    this.snapper.setDetectRadiusInPixels(LASER_PRECISION_RADIUS);

    // Add camera change event listener to update scale
    this.onCameraChangeBinded = this.onCameraChange.bind(this);
    this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
  }

  deactivate() {
    // Restore original detectRadiusInPixels
    if (this.originalDetectRadiusInPixels !== null) {
      this.snapper.setDetectRadiusInPixels(this.originalDetectRadiusInPixels);
      this.originalDetectRadiusInPixels = null;
    }

    // Clean up when tool is deactivated
    this.snapper.setSnapFilter(null);
    this.highlightManager.dispose();

    // Remove camera change event listener
    if (this.onCameraChangeBinded) {
      this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
      this.onCameraChangeBinded = null;
    }

    if (this.measurementPreview) {
      this.measurementPreview.indicator.clear();
      this.measurementPreview = null;
    }

    this.noMeasurementPossible = false;
  }

  /**
   * Handles camera change events to update scale for measurement preview.
   * This ensures that laser measurements maintain proper scale relative to camera distance.
   */
  onCameraChange() {
    // Update scale for the measurement preview when camera changes
    if (!this.noMeasurementPossible) {
      this.measurementPreview?.indicator?.updateScale();
    }
  }

  // Additional methods that can be called by the main measure tool
  isNoMeasurementPossible() {
    return this.noMeasurementPossible;
  }

  /**
   * Highlights all targets associated with a laser measurement.
   * This includes targets from measurement end-to-end picks and the laser hit point.
   * We have 2 targets to highlight:
   * 1. The fragment that the laser hit point is on. The highlight applies to the whole fragment.
   * 2. The fragment that the measurement end-to-end picks are on. The highlight applies to the specific face.
   * @param {Object} measurement - The laser measurement object containing picks and laser hit data
   */
  setMeasurementHighlights(measurement) {
    const targetsToHighlight = [];
    const processedFragIds = [];

    const pick = measurement.picks[1];
    if (pick && pick.fragId !== undefined && pick.fragId !== null && processedFragIds.indexOf(pick.fragId) === -1) {
      // Get the model for this pick
      let modelId = pick.modelId;
      targetsToHighlight.push({
        fragId: pick.fragId,
        face: pick.geomFace,
        modelId
      });
      processedFragIds.push(pick.fragId);
    }

    const laserIntersectionData = measurement.laserHitPoint;
    if (laserIntersectionData) {
      const laserHitFragId = laserIntersectionData.fragId;

      // Early validation to avoid unnecessary computations
      if (Number.isInteger(laserHitFragId) && processedFragIds.indexOf(laserHitFragId) === -1) {
        // Get the model for the laser hit point
        let modelId = laserIntersectionData.modelId;

        // Highlight the whole fragment instead of just the specific face
        targetsToHighlight.push({
          fragId: laserHitFragId,
          modelId
        });
        processedFragIds.push(laserHitFragId);
      }
    }

    this.highlightManager.setHighlightTargets(targetsToHighlight);
  }

  clearPreview() {
    if (this.measurementPreview) {
      this.measurementPreview.indicator.clear();
    }
    this.noMeasurementPossible = false;
  }

  /**
   * Clears fragment highlights. Called by MeasureTool when needed.
   */
  clearFragmentHighlights() {
    this.highlightManager.clearHighlights();
  }

  /**
   * Handles endpoint editing for laser measurements.
   * This method is called when a laser measurement endpoint is dragged/edited.
   * It ensures that both the laser hit point and dimensions are recalculated
   * for the new pick position.
   * @param {Object} measurement - The laser measurement being edited
   * @param {Object} pick - The updated pick/snap result
   */
  handleEndpointEdit(measurement, pick) {
    // For laser measurements, we need to recalculate dimensions and laser hit point
    // when the pick position changes during editing
    // Clear existing dimensions and laser data from the pick
    // This ensures fresh calculation based on the new position
    delete pick.dimensions;
    delete pick.laserHitPoint;
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/LaserToolIndicator.js"
/*!**************************************************************!*\
  !*** ./extensions/Measure/CustomTools/LaserToolIndicator.js ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LaserToolIndicator: () => (/* binding */ LaserToolIndicator)
/* harmony export */ });
/* harmony import */ var _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../MeasureToolIndicator.js */ "./extensions/Measure/MeasureToolIndicator.js");


const av = Autodesk.Viewing;
const MeasureCommon = av.MeasureCommon;

/** Color values should match Measure.css **/
const LASER_COLOR = "ED8D16";
const DEFAULT_LINE_COLOR = '009bea';
/*******************************************/

const LINE_CLASS_NAME = 'adsk-icon-axis-delta';

const _tipHeight = 2;
const _tipWidth = 3;

class LaserToolIndicator extends _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.MeasureToolIndicator {
  constructor(viewer, measurement, measureTool) {
    super(viewer, measurement, measureTool);

    // Add laser-specific line to the existing lines object
    this.lines.laser = {
      axis: false,
      material: this._createLineMaterial(LASER_COLOR),
      className: LINE_CLASS_NAME + '-laser measure-label-axis-delta' + ' measure-label-laser',
      iconText: 'laser'
    };

    // Initialize laser-specific properties
    this.laserLabel = {};
  }

  // Override drawXYZLine to shorten laser line for proper arrow tip connection
  drawXYZLine(item) {
    // For laser lines, shorten the line to connect properly with arrow tip
    if (item === this.lines.laser) {
      const p1 = item.p1;
      const p2 = item.p2;

      if (!p1 || !p2) {
        return;
      }

      // Calculate direction and scale (similar to parent method)
      const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
      const point = MeasureCommon.nearestPointInPointToSegment(this.viewer.navigation.getPosition(), p1, p2);
      const scale = this.setScale(point);

      // Temporarily shorten line for arrow tip connection
      const originalP2 = item.p2;
      item.p2 = item.p2.clone().sub(direction.clone().multiplyScalar(_tipHeight * scale));
      super.drawXYZLine(item);
      item.p2 = originalP2;
    } else {
      // For non-laser lines, use parent method
      super.drawXYZLine(item);
    }
  }

  drawArrowTip(p, arrowOffset, geometry, item) {
    const tmpPoints = [new THREE.Vector3(), new THREE.Vector3()];
    tmpPoints[0].subVectors(p, arrowOffset);
    tmpPoints[1].addVectors(tmpPoints[0], arrowOffset.clone().multiplyScalar(2));
    geometry.setFromPoints(tmpPoints);

    const line = this.drawLineAsCylinder(geometry, item.material, _tipWidth * 3, this.overlayName, true);
    this.setCylinderScale(line, item.p1, item.p2);
    line.visible = true;
    item.tips.push(line);
  }

  // Override the tip drawing logic to handle different tip styles for laser vs dimension lines
  drawLineTips(item, p1, p2, direction, normal, scale, geometry) {
    if (item === this.lines.laser) {
      // Draw arrow tip for laser line (orange)
      const arrowOffset = direction.clone().multiplyScalar(_tipHeight * scale);
      this.drawArrowTip(p2, arrowOffset, geometry, item);
    } else {
      // // Draw perpendicular tips for dimension lines (blue) - inherit from distance tool
      super.drawTip(p1, normal, scale, geometry, item);
      super.drawTip(p2, normal, scale, geometry, item);
    }
  }

  renderLaserMeasurementFromPoints(pickPositions) {
    const start = pickPositions.intersection;
    const intersectPoint = pickPositions.laserHitPoint;
    const faceNormal = pickPositions.faceNormal;
    const dimensions = pickPositions.dimensions;
    if (!start) {
      return;
    }

    // Show laser label first to maintain consistent ordering with renderLaserMeasurement
    if (intersectPoint) {
      const item = this.lines.laser;
      item.p1 = start;
      item.p2 = intersectPoint;
      this.drawXYZLine(item);
      const distance = start.distanceTo(intersectPoint);
      this.measurement.laserHitPoint = {
        faceNormal,
        intersectPoint,
        distance
      };
      this.showLaserLabel(start, intersectPoint);
    }

    // Show dimension labels after laser label
    let convertedDimensions = [];
    if (dimensions.length > 0) {
      convertedDimensions = dimensions.map((dimension) => {
        if (!dimension.p1 || !dimension.p2) {
          return null;
        }
        return {
          p1: new THREE.Vector3(dimension.p1.x, dimension.p1.y, dimension.p1.z),
          p2: new THREE.Vector3(dimension.p2.x, dimension.p2.y, dimension.p2.z)
        };
      }
      );
      this.renderDimensions(convertedDimensions);
      this.measurement.dimensions = convertedDimensions;
      this.showDimensionLabels(start, dimensions);
    }

    this.updateLaserLength();
  }

  renderDimensions(dimensions) {
    // Iterate over dimensions and draw lines dynamically
    if (!dimensions || !Array.isArray(dimensions)) {
      return;
    }
    dimensions.forEach((dimension, index) => {
      const lineItem = this.lines[`dimension_${index}`] || {
        material: this._createLineMaterial(DEFAULT_LINE_COLOR)
      };

      lineItem.p1 = dimension.p1;
      lineItem.p2 = dimension.p2;
      lineItem.line = null;

      this.drawXYZLine(lineItem);
      this.lines[`dimension_${index}`] = lineItem; // Store the line item for future use
    });
  }

  renderLaserMeasurement(picks) {
    const userPick = picks[1];
    if (!userPick) {
      return;
    }

    const start = MeasureCommon.getSnapResultPosition(userPick, this.viewer);
    const normal = userPick.faceNormal;
    if (!start || !normal) {
      return;
    }

    const intersectPoint = this.measurement.laserHitPoint?.intersectPoint;
    if (intersectPoint) {
      const item = this.lines.laser;
      item.p1 = start;
      item.p2 = intersectPoint;
      this.drawXYZLine(item);
      this.showLaserLabel(start, intersectPoint);
    } else {
      // If no intersection point, remove the laser line
      // this is to avoid showing the laser line when the measurement is not valid (dragging the laser from valid to non-measureable area)
      this.lines.laser.p1 = null;
      this.lines.laser.p2 = null;
    }

    const dimensions = this.measurement.dimensions;
    if (!dimensions || !Array.isArray(dimensions)) {
      return;
    }
    this.renderDimensions(dimensions);

    this.showDimensionLabels(start, dimensions);
    this.updateLaserLength();
  }

  // Update laser measurement label
  updateLaserLength() {
    const laserDistance = this.measurement.laserHitPoint?.distance;
    if (laserDistance) {
      this.setValueMeasurementLabelText(this.laserLabel.label, "~ " + this.measureTool.getDistanceAux(laserDistance));
      // Invalidate cache when text content changes
      if (this.laserLabel.label) {
        this.laserLabel.label._cachedDimensions = null;
      }
    }

    const dimensions = this.measurement.dimensions;
    if (dimensions && Array.isArray(dimensions)) {
      // Ensure dimension labels exist
      if (!this.laserLabel.dimensionLabels) {
        this.laserLabel.dimensionLabels = [];
      }

      // Clear any extra labels if the number of dimensions has changed
      while (this.laserLabel.dimensionLabels.length > dimensions.length) {
        const label = this.laserLabel.dimensionLabels.pop();
        this.viewer.container.removeChild(label);
      }

      // Iterate over dimensions and update labels dynamically
      dimensions.forEach((dimension, index) => {
        let label = this.laserLabel.dimensionLabels[index];
        if (!label) {
          label = this.createMeasurementLabel();
          this.viewer.container.appendChild(label);
          this._addEventListener(label);
          this.laserLabel.dimensionLabels[index] = label;
        }

        const distance = dimension.p1.distanceTo(dimension.p2);
        this.setValueMeasurementLabelText(label, "~ " + this.measureTool.getDistanceAux(distance));
        // Invalidate cache when text content changes
        label._cachedDimensions = null;
      });
    }
  }

  showLaserLabel(p1, p2) {
    let label = this.laserLabel.label;
    if (!label) {
      label = this.laserLabel.label = this.createMeasurementLabel();
      this.viewer.container.appendChild(label);
      this._addEventListener(label);
      this.topLabel = label;
    }

    this.updateLaserLength();
    this.showLabel(label);

    this.laserLabel.label.p1 = p1.clone();
    this.laserLabel.label.p2 = p2.clone();
  }

  showDimensionLabels(start, dimensions) {
    if (!this.laserLabel.dimensionLabels) {
      this.laserLabel.dimensionLabels = [];
    }

    // Clear any existing labels if the number of dimensions has changed
    while (this.laserLabel.dimensionLabels.length > dimensions.length) {
      const label = this.laserLabel.dimensionLabels.pop();
      this.viewer.container.removeChild(label);
    }

    // Create or update labels for each dimension pair
    dimensions.forEach((dimension, index) => {
      let label = this.laserLabel.dimensionLabels[index];
      if (!label) {
        label = this.createMeasurementLabel();
        this.viewer.container.appendChild(label);
        this._addEventListener(label);
        this.laserLabel.dimensionLabels[index] = label;
        if (!this.topLabel) {
          this.topLabel = label;
        }
      }

      this.showLabel(label);
      // Set the label text position at the largest distance from the start point
      const midPoint = dimension.p1.distanceTo(start) > dimension.p2.distanceTo(start) ? dimension.p1 : dimension.p2;
      label.p1 = midPoint.clone();
      label.p2 = start.clone();
    });
  }

  clearLaserLine() {
    this.viewer.impl.removeOverlay(this.overlayName, this.lines.laser.line, true);

    this.lines.laser.tips?.forEach((tip) => {
      this.viewer.impl.removeOverlay(this.overlayName, tip, true);
    });
  }

  clearDimensions() {
    for (const key in this.lines) {
      if (key.startsWith('dimension_')) {
        const lineItem = this.lines[key];
        if (!lineItem) {
          continue;
        }
        this.viewer.impl.removeOverlay(this.overlayName, lineItem.line, true);
        lineItem.tips?.forEach((tip) => {
          this.viewer.impl.removeOverlay(this.overlayName, tip, true);
        });
        // Clean up the line item from this.lines
        delete this.lines[key];
      }
    }
  }

  applyLabelColors(label) {
    super.applyLabelColors(label);

    // Treat the laser label differently when selected
    const isCurrentlySelected = this.isCurrentlySelected();
    const isLaserLabel = label == this.laserLabel.label;
    if (isLaserLabel) {
      if (isCurrentlySelected) {
        label.style.color = '#FFFFFF';
        label.style.backgroundColor = `#${LASER_COLOR}`;
      } else {
        label.style.color = `#${LASER_COLOR}`;
      }
    }
  }

  // Override updateLabelsPosition to handle laser-specific positioning
  updateLabelsPosition() {
    // Call parent method for common positioning
    super.updateLabelsPosition();

    // Handle laser-specific positioning
    this.updateLaserLabelsPosition();
  }

  updateLaserLabelsPosition() {
    let point, xy, label;

    const placeLabel = (xOff, yOff) => {
      xy = MeasureCommon.project(point, this.viewer);

      label.style.top = xy.y - yOff + 'px';
      label.style.left = xy.x - xOff + 'px';
      label.point = point;
      this.applyLabelColors(label);
      this.labels.push(label);
    };

    if (this.laserLabel) {
      const laserLabels = [
      this.laserLabel.label,
      ...(this.laserLabel.dimensionLabels || [])];


      for (label of laserLabels) {
        if (!label) {
          continue;
        }
        if (label.p1 && label.p2 && this.isVisible(label)) {
          point = {
            x: (label.p1.x + label.p2.x) / 2,
            y: (label.p1.y + label.p2.y) / 2,
            z: (label.p1.z + label.p2.z) / 2
          };

          // Cache dimensions to avoid repeated DOM property access
          if (!label._cachedDimensions) {
            const rect = label.getBoundingClientRect();
            label._cachedDimensions = {
              width: rect.width,
              height: rect.height
            };
          }

          // Use bitwise operations for performance (equivalent to Math.floor for positive numbers)
          const halfWidth = label._cachedDimensions.width * 0.5 | 0;
          const halfHeight = label._cachedDimensions.height * 0.5 | 0;

          placeLabel(halfWidth, halfHeight);
        }
      }
    }
  }

  // Override updateScale to handle laser-specific scaling
  updateScale() {
    // Call parent method for common scaling
    super.updateScale();

    // Handle laser-specific scaling
    if (this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_LASER) {
      if (this.measurement.isComplete()) {
        this.clearLaserLine();
        this.clearXYZLine();
        this.drawXYZLine(this.lines.laser);
        this.updateDimensionsScale();
      }
    }

    if (this.lines.laser && this.lines.laser.line) {
      this.updateLaserLabelsPosition();
    }
  }

  updateDimensionsScale() {
    for (const key in this.lines) {
      if (key.startsWith('dimension_')) {
        const lineItem = this.lines[key];
        if (!lineItem || !lineItem.line) {
          continue;
        }
        this.setCylinderScale(lineItem.line, lineItem.p1, lineItem.p2);
        lineItem.tips?.forEach((tip) => {
          // handles width of a line
          this.setCylinderScale(tip, lineItem.p1, lineItem.p2);
          // handles length of a tip
          const tipScale = this.setScale(tip.position);
          tip.scale.y = tipScale * (2 * _tipHeight);
        });
      }
    }
  }

  updateResults() {
    // Call the laser-specific update method to refresh labels when units/precision change
    this.updateLaserLength();

    // Update label positions after updating the content
    setTimeout(() => {
      // This can get called after the viewer is unloaded
      if (this.viewer.impl) {
        this.updateLabelsPosition();
      }
    }, 0);
  }

  // Override clear to handle laser-specific clearing
  clear() {
    // Handle laser-specific clearing
    if (this.laserLabel) {
      if (this.laserLabel.label) {
        this.hideLabel(this.laserLabel.label);
      }
      if (this.laserLabel.dimensionLabels) {
        this.laserLabel.dimensionLabels.forEach((label) => {
          this.hideLabel(label);
        });
      }
    }

    // Call parent method for common clearing
    super.clear();
  }

  // Override destroy to handle laser-specific cleanup
  destroy() {
    // Handle laser-specific cleanup
    if (this.laserLabel) {
      if (this.laserLabel.label) {
        this.laserLabel.label.parentNode.removeChild(this.laserLabel.label);
        this._removeEventListener(this.laserLabel.label);
        this.laserLabel.label = null;
      }
      if (this.laserLabel.dimensionLabels) {
        this.laserLabel.dimensionLabels.forEach((label) => {
          if (label && label.parentNode) {
            label.parentNode.removeChild(label);
            this._removeEventListener(label);
          }
        });
        this.laserLabel.dimensionLabels = null;
      }
    }

    // Call parent method for common cleanup
    super.destroy();
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/LaserToolRegistration.js"
/*!*****************************************************************!*\
  !*** ./extensions/Measure/CustomTools/LaserToolRegistration.js ***!
  \*****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createLaserToolButton: () => (/* binding */ createLaserToolButton),
/* harmony export */   deregisterLaserTool: () => (/* binding */ deregisterLaserTool),
/* harmony export */   registerLaserTool: () => (/* binding */ registerLaserTool)
/* harmony export */ });
/* harmony import */ var _LaserMeasureTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./LaserMeasureTool.js */ "./extensions/Measure/CustomTools/LaserMeasureTool.js");


const av = Autodesk.Viewing;
const avu = av.UI;
const MeasureCommon = av.MeasureCommon;

/**
 * Registers the laser measurement tool as a custom tool with the measure tool.
 * This should be called after the measure tool is created.
 *
 * @param {MeasureTool} measureTool - The measure tool instance
 * @returns {boolean} True if registration was successful
 */
function registerLaserTool(measureTool) {
  try {
    // Get viewer, snapper, and shared config from the measure tool
    const viewer = measureTool.getViewer();
    const snapper = measureTool.getSnapper();
    const sharedMeasureConfig = measureTool.getSharedMeasureConfig();

    if (!viewer) {
      console.error('Could not get viewer from measure tool');
      return false;
    }

    if (!snapper) {
      console.error('Could not get snapper from measure tool');
      return false;
    }

    if (!sharedMeasureConfig) {
      console.error('Could not get shared measure config from measure tool');
      return false;
    }

    // Create the laser tool instance
    const laserTool = new _LaserMeasureTool_js__WEBPACK_IMPORTED_MODULE_0__.LaserMeasureTool(viewer, snapper, sharedMeasureConfig);

    // Register it with the measure tool
    measureTool.registerCustomTool(MeasureCommon.MeasurementTypes.MEASUREMENT_LASER, laserTool);
  } catch (error) {
    console.error('Error registering LaserMeasureTool:', error);
    return false;
  }
}

/**
 * Deregisters the laser measurement tool.
 *
 * @param {MeasureTool} measureTool - The measure tool instance
 */
function deregisterLaserTool(measureTool) {
  try {
    measureTool.deregisterCustomTool(
      MeasureCommon.MeasurementTypes.MEASUREMENT_LASER
    );
  } catch (error) {
    console.error('Error deregistering LaserMeasureTool:', error);
  }
}

/**
 * Creates and registers the laser measurement button in the toolbar.
 *
 * @param {MeasureToolbar} measureToolbar - The measure toolbar instance
 * @returns {Object} The created laser button
 */
function createLaserToolButton(measureToolbar) {
  const measureExtension = measureToolbar.measureExtension;

  const measureLaserBtn = new avu.Button("toolbar-measureTool-laser");
  measureLaserBtn.setGlobalManager(measureToolbar.globalManager);
  measureLaserBtn.setToolTip("Laser");
  measureLaserBtn.setIcon("adsk-icon-measure-laser");
  measureLaserBtn.onClick = function () {
    const enable = measureLaserBtn.getState() !== avu.Button.State.ACTIVE;
    if (enable) {
      measureExtension.activate('laser');
    } else {
      measureExtension.measureTool.deselectAllMeasurements();
    }
  };

  measureToolbar.measureToolbar.addControl(measureLaserBtn);
  measureToolbar.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_LASER] = measureLaserBtn;

  return measureLaserBtn;
}

/***/ },

/***/ "./extensions/Measure/CustomTools/MeasureConstants.js"
/*!************************************************************!*\
  !*** ./extensions/Measure/CustomTools/MeasureConstants.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ANGLE_PRECISION: () => (/* binding */ ANGLE_PRECISION),
/* harmony export */   CREASE_ANGLE_RADIANS: () => (/* binding */ CREASE_ANGLE_RADIANS),
/* harmony export */   EDGE_LENGTH_TOLERANCE: () => (/* binding */ EDGE_LENGTH_TOLERANCE),
/* harmony export */   EPSILON: () => (/* binding */ EPSILON),
/* harmony export */   MAX_CURVE_ANGLE: () => (/* binding */ MAX_CURVE_ANGLE),
/* harmony export */   MAX_SURFACE_DIMENSIONS: () => (/* binding */ MAX_SURFACE_DIMENSIONS),
/* harmony export */   MAX_SURFACE_INDEX_BUFFER: () => (/* binding */ MAX_SURFACE_INDEX_BUFFER),
/* harmony export */   MIN_ARC_EDGES: () => (/* binding */ MIN_ARC_EDGES),
/* harmony export */   MIN_CIRCLE_EDGES: () => (/* binding */ MIN_CIRCLE_EDGES),
/* harmony export */   MIN_CURVE_ANGLE: () => (/* binding */ MIN_CURVE_ANGLE),
/* harmony export */   MIN_SCALE_COMPONENT: () => (/* binding */ MIN_SCALE_COMPONENT),
/* harmony export */   SHAPE_TYPES: () => (/* binding */ SHAPE_TYPES),
/* harmony export */   VERTEX_PRECISION_PERCENT: () => (/* binding */ VERTEX_PRECISION_PERCENT),
/* harmony export */   WELDING_EPSILON: () => (/* binding */ WELDING_EPSILON)
/* harmony export */ });
/**
 * Shared constants for measurement and curve detection algorithms.
 * These constants are used across SurfaceMeasureComputation.js
 * to ensure consistent geometric analysis thresholds.
 *
 * Constants imported from EdgePrimitiveUtils.cpp
 * Reference: https://github.com/plangrid/elephant/blob/be527dc954b98f766e64585eb42de62e4ae6d36d/ElephantVertexGlm/3D/Measurement/EdgePrimitiveUtils.cpp#L20
 */

// ============================================================================
// Geometric Detection Thresholds
// ============================================================================

/** Minimum number of edges required to detect a circular arc */
const MIN_ARC_EDGES = 3;

/** Angular precision threshold (radians) - approximately 0.057 degrees. Used to detect curved surfaces. */
const ANGLE_PRECISION = 0.001;

/** Minimum number of edges required to detect a complete circle */
const MIN_CIRCLE_EDGES = 7;

/** General epsilon for floating-point comparisons */
const EPSILON = 0.001;

/** Tolerance as percentage of reference value for vertex-on-curve precision (1%) */
const VERTEX_PRECISION_PERCENT = 0.01;

/** Tolerance as fraction of edge length for edge length comparisons (20%) */
const EDGE_LENGTH_TOLERANCE = 0.2;

/** Minimum interior angle (radians) for curve continuity detection */
const MIN_CURVE_ANGLE = Math.PI * 0.75;

/** Maximum interior angle (radians) for curve continuity detection */
const MAX_CURVE_ANGLE = Math.PI;

/** Epsilon for welding vertices */
const WELDING_EPSILON = 1e-5;

/** Minimum scale component magnitude below which a matrix scale axis is treated as degenerate */
const MIN_SCALE_COMPONENT = 1e-6;

/** Crease angle threshold (radians) - 30 degrees. Used to detect curved surfaces. */
const CREASE_ANGLE_RADIANS = Math.PI / 6;

/** Maximum index buffer length before surface tool bails out entirely. Biggest index buffer tested and worked correctly in the viewer. */
const MAX_SURFACE_INDEX_BUFFER = 65536;

/** Maximum number of shape dimensions rendered for a surface */
const MAX_SURFACE_DIMENSIONS = 50;

// ============================================================================
// Shape Type Identifiers
// ============================================================================

/**
 * Enumeration of supported shape types for surface measurement.
 * Used to consistently identify detected geometric primitives.
 */
const SHAPE_TYPES = {
  CIRCLE: 'circle',
  ELLIPSE: 'ellipse',
  RECTANGLE: 'rectangle',
  SIMPLE_CURVE: 'simple_curve',
  CIRCULAR_ARC: 'circular_arc',
  POLYGON: 'polygon',
  HEIGHT: 'height',
  LINE: 'line'
};

/***/ },

/***/ "./extensions/Measure/CustomTools/ShortestDistanceMeasureTool.js"
/*!***********************************************************************!*\
  !*** ./extensions/Measure/CustomTools/ShortestDistanceMeasureTool.js ***!
  \***********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ShortestDistanceMeasureTool: () => (/* binding */ ShortestDistanceMeasureTool)
/* harmony export */ });
/* harmony import */ var _ShortestDistanceToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ShortestDistanceToolIndicator.js */ "./extensions/Measure/CustomTools/ShortestDistanceToolIndicator.js");
/* harmony import */ var _ShortestDistanceMeasurement_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ShortestDistanceMeasurement.js */ "./extensions/Measure/CustomTools/ShortestDistanceMeasurement.js");
/* harmony import */ var _HighlightManager_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./HighlightManager.js */ "./extensions/Measure/CustomTools/HighlightManager.js");
/* harmony import */ var _InfoPopup_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../InfoPopup.js */ "./extensions/Measure/InfoPopup.js");





const { MeasureCommon } = Autodesk.Viewing;

/**
 * Shortest distance measurement tool that implements the CustomMeasureTool interface.
 * @implements {CustomMeasureTool}
 */
class ShortestDistanceMeasureTool {

  static OverlayName = 'measure-fragment-highlight-shortest-distance';

  /** @type {HighlightManager} */
  highlightManager;

  /** @type {SnapResult} */
  #lastSnapResult = null;

  /** @type {boolean} */
  #isSnapperActive = false;

  /** @type {THREE.Vector3} */
  #lastMeasurementCenterPoint = new THREE.Vector3();

  /** @type {InfoPopup|null} */
  #infoPopup = null;

  constructor(viewer, measureTool, snapper) {
    this.viewer = viewer;
    this.measureTool = measureTool;
    this.snapper = snapper;
    this.onMeasurementCompleted = this.onMeasurementCompleted.bind(this);
    this.highlightManager = new _HighlightManager_js__WEBPACK_IMPORTED_MODULE_2__.HighlightManager(this.viewer, ShortestDistanceMeasureTool.OverlayName, { color: 0xffffff });
    this.onOutOfViewCameraChangeCheck = this.onOutOfViewCameraChangeCheck.bind(this);
  }

  activate() {
    this.#isSnapperActive = this.snapper.isActive();
    this.snapper.deactivate();

    this.viewer.impl.pauseHighlight(false);
    this.viewer.addEventListener(MeasureCommon.Events.MEASUREMENT_COMPLETED_EVENT, this.onMeasurementCompleted);
  }

  deactivate() {
    if (this.#isSnapperActive) {
      this.snapper.activate();
    }

    if (this.#infoPopup) {
      this.#infoPopup.destroy();
      this.#infoPopup = null;
    }

    this.currentModelId = null;
    this.currentFragId = null;
    this.#lastSnapResult = null;
    this.highlightManager.dispose();

    this.viewer.clearSelection();
    this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onOutOfViewCameraChangeCheck);
    this.viewer.removeEventListener(MeasureCommon.Events.MEASUREMENT_COMPLETED_EVENT, this.onMeasurementCompleted);

    this.viewer.impl.pauseHighlight(true);
  }

  clearFragmentHighlights() {
    this.highlightManager.clearHighlights();

    // There might still be a selection from an unfinished measurement.
    this.viewer.clearSelection();
  }

  correctPickPosition() {

    // do nothing
  }
  setMeasurementHighlights(measurement) {
    const targetsToHighlight = [];

    const addTargetsForPick = (pick) => {
      if (!pick || pick.fragId === undefined || pick.fragId === null) {
        return;
      }

      const model = this.viewer.impl.findModel(pick.modelId);
      const fragList = model.getFragmentList();
      const instanceTree = model.getObjectTree();

      let dbIds = fragList.getDbIds(pick.fragId);
      dbIds = Array.isArray(dbIds) ? dbIds : [dbIds];

      dbIds.forEach((dbId) => {
        instanceTree.enumNodeFragments(dbId, (fragId) => {
          targetsToHighlight.push({
            fragId: fragId,
            modelId: pick.modelId
          });
        });
      });
    };

    if (measurement.picks[1]) {
      addTargetsForPick(measurement.picks[1]);
    }
    if (measurement.picks[2]) {
      addTargetsForPick(measurement.picks[2]);
    }

    this.highlightManager.setHighlightTargets(targetsToHighlight);
  }

  createMeasurement(measureData) {
    const measurement = new _ShortestDistanceMeasurement_js__WEBPACK_IMPORTED_MODULE_1__.ShortestDistanceMeasurement(this.measureTool, measureData?.id, measureData?.options);

    if (this.#lastSnapResult) {
      const model = this.viewer.impl.findModel(this.#lastSnapResult.modelId);
      const fragList = model.getFragmentList();
      const dbIds = fragList.getDbIds(this.#lastSnapResult.fragId);
      let selection = Array.isArray(dbIds) ? dbIds : [dbIds];
      model.selector.setSelection(selection);
    }

    return measurement;
  }

  getIndicatorClass() {
    return _ShortestDistanceToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.ShortestDistanceToolIndicator;
  }

  saveSessionMeasurement(measurement, listEntry) {

    // do nothing
  }
  updateMeasurementPreview(snapResult) {
    if (!snapResult || snapResult.isEmpty()) {
      this.measurementPreview?.indicator.clear();
      return;
    }

    this.#lastSnapResult = snapResult;
  }

  getMeasurementName() {
    return 'Shortest Distance';
  }

  onMeasurementCompleted(event) {
    this.viewer.clearSelection();

    // Show popup if the measurement is outside the view
    const measurement = this.measureTool.getCurrentMeasurementRaw();
    const pointA = measurement.getPick(1)?.intersectPoint;
    const pointB = measurement.getPick(2)?.intersectPoint;
    if (!pointA || !pointB) {
      return;
    }

    this.#lastMeasurementCenterPoint.addVectors(pointA, pointB).divideScalar(2);
    if (!this.viewer.navigation.isPointVisible(this.#lastMeasurementCenterPoint)) {
      if (this.#infoPopup) {
        this.#infoPopup.destroy();
        this.#infoPopup = null;
      }
      this.#createInfoPopup();
    }
  }

  #createInfoPopup() {
    this.#infoPopup = new _InfoPopup_js__WEBPACK_IMPORTED_MODULE_3__.InfoPopup(this.viewer.container);
    this.#infoPopup.setText(Autodesk.Viewing.i18n.translate('OutsideView Message'));
    this.#infoPopup.addButton(Autodesk.Viewing.i18n.translate('Show'), () => {
      // popup will be destroyed by the camera change event - no need to clean it here
      this.#panToLastMeasurement();
    });
    this.#infoPopup.show();
    this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onOutOfViewCameraChangeCheck);
  }

  #panToLastMeasurement() {
    const nav = this.viewer.navigation;
    const cam = this.viewer.getCamera();
    // project canvas center to world space
    const centerPoint = nav.getWorldPoint(0.5, 0.5);
    const offset = this.#lastMeasurementCenterPoint.clone().sub(centerPoint);
    const position = nav.getPosition().add(offset);
    const target = position.clone().add(nav.getEyeVector());
    this.viewer.utilities.transitionView(position, target, cam.fov, cam.up);
  }

  onOutOfViewCameraChangeCheck(event) {
    if (this.viewer.navigation.isPointVisible(this.#lastMeasurementCenterPoint)) {
      this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onOutOfViewCameraChangeCheck);
      if (this.#infoPopup) {
        this.#infoPopup.destroy();
        this.#infoPopup = null;
      }
    }
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/ShortestDistanceMeasurement.js"
/*!***********************************************************************!*\
  !*** ./extensions/Measure/CustomTools/ShortestDistanceMeasurement.js ***!
  \***********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ShortestDistanceMeasurement: () => (/* binding */ ShortestDistanceMeasurement)
/* harmony export */ });
/* harmony import */ var _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../src/measurement/Measurement.js */ "./src/measurement/Measurement.js");
/* harmony import */ var _AABBTree_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./AABBTree.js */ "./extensions/Measure/CustomTools/AABBTree.js");



const { MeasureCommon } = Autodesk.Viewing;
const { enumObjectGeometries, enumMeshTriangles } = Autodesk.Viewing.Private.VertexEnumerator;

class ShortestDistanceMeasurement extends _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_0__.Measurement {
  /** @type {boolean} */
  #isFinalized = false;

  /** @type {AABBNode|null} */
  #aabbTreeCache = null;

  constructor(measureTool, id, options) {
    super(MeasureCommon.MeasurementTypes.MEASUREMENT_SHORTEST_DISTANCE, id, options);
    this.measureTool = measureTool;
  }

  getMaxNumberOfPicks() {
    return 2;
  }

  finalize() {
    if (!this.distanceXYZ) {
      this.#isFinalized = true;
    }
  }

  computeResult(picks, viewer, snapper) {
    const MaxTreeDepth = 16;
    const MaxTrianglesPerLeaf = 1024;

    // When the geometry is restored, we don't need to compute the shortest distance again by building
    // the AABBTree, but instead use the intersection points from the restored picks.
    if (this.isRestored) {
      this.distanceXYZ = this.picks[1].intersectPoint.distanceTo(this.picks[2].intersectPoint);
      this.distanceX = Math.abs(this.picks[2].intersectPoint.x - this.picks[1].intersectPoint.x);
      this.distanceY = Math.abs(this.picks[2].intersectPoint.y - this.picks[1].intersectPoint.y);
      this.distanceZ = Math.abs(this.picks[2].intersectPoint.z - this.picks[1].intersectPoint.z);
      return true;
    }

    const collectTriangles = (model, fragId) => {
      const fragList = model.getFragmentList();
      let dbIds = fragList.getDbIds(fragId);
      dbIds = Array.isArray(dbIds) ? dbIds : [dbIds];
      const triangles = [];
      for (const dbId of dbIds) {
        enumObjectGeometries(model, dbId, (geometry, matrix) => {
          enumMeshTriangles(geometry, (va, vb, vc) => {
            const a = new THREE.Vector3().copy(va).applyMatrix4(matrix);
            const b = new THREE.Vector3().copy(vb).applyMatrix4(matrix);
            const c = new THREE.Vector3().copy(vc).applyMatrix4(matrix);
            triangles.push(new THREE.Triangle(a, b, c));
          });
        });
      }
      return triangles;
    };

    if (this.hasPick(1) && !this.#aabbTreeCache) {
      // Already create the AABBTree for the first pick to save some time on computation
      const model = viewer.impl.findModel(picks[1].modelId);
      const triangles = collectTriangles(model, picks[1].fragId);
      this.#aabbTreeCache = (0,_AABBTree_js__WEBPACK_IMPORTED_MODULE_1__.buildAABBTree)(triangles, MaxTrianglesPerLeaf, MaxTreeDepth);
    }

    const allPicksAreValid = this.hasPick(1) && this.getPick(1).fragId !== undefined && this.hasPick(2) && this.getPick(2).fragId !== undefined;
    if (this.#isFinalized && allPicksAreValid) {
      const model = viewer.impl.findModel(picks[2].modelId);
      const triangles = collectTriangles(model, picks[2].fragId);
      const aabbTree = (0,_AABBTree_js__WEBPACK_IMPORTED_MODULE_1__.buildAABBTree)(triangles, MaxTrianglesPerLeaf, MaxTreeDepth);
      const shortestDistance = (0,_AABBTree_js__WEBPACK_IMPORTED_MODULE_1__.shortestDistanceBetweenAABBTrees)(this.#aabbTreeCache, aabbTree);

      this.picks[1].geomType = MeasureCommon.SnapType.SNAP_VERTEX;
      this.picks[1].intersection = shortestDistance.pointA;
      this.picks[1].intersectPoint = shortestDistance.pointA;
      this.picks[1].geomVertex = shortestDistance.pointA;

      this.picks[2].geomType = MeasureCommon.SnapType.SNAP_VERTEX;
      this.picks[2].intersection = shortestDistance.pointB;
      this.picks[2].intersectPoint = shortestDistance.pointB;
      this.picks[2].geomVertex = shortestDistance.pointB;

      this.distanceXYZ = shortestDistance.distance;
      this.distanceX = Math.abs(shortestDistance.pointB.x - shortestDistance.pointA.x);
      this.distanceY = Math.abs(shortestDistance.pointB.y - shortestDistance.pointA.y);
      this.distanceZ = Math.abs(shortestDistance.pointB.z - shortestDistance.pointA.z);

      this.#aabbTreeCache = null;
      this.#isFinalized = false;
      return true;
    }

    return false;
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/ShortestDistanceToolIndicator.js"
/*!*************************************************************************!*\
  !*** ./extensions/Measure/CustomTools/ShortestDistanceToolIndicator.js ***!
  \*************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ShortestDistanceToolIndicator: () => (/* binding */ ShortestDistanceToolIndicator)
/* harmony export */ });
/* harmony import */ var _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../MeasureToolIndicator.js */ "./extensions/Measure/MeasureToolIndicator.js");


class ShortestDistanceToolIndicator extends _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.MeasureToolIndicator {

  constructor(viewer, measurement, tool) {
    super(viewer, measurement, tool);
    this.allowShortDistances = true;
  }

  /**
   * Renders the measurement.
   * Overrides the base class method to not render the endpoints.
   * @param {SnapResult[]} picks - The picks to render the measurement from.
   * @param {boolean} showMeasureResult - Whether to show the measurement result.
   */
  render(picks, showMeasureResult) {
    this.showMeasureResult = showMeasureResult;
    this.clear();
    this.renderRubberband(picks);
    this.updateSelectionArea();
  }

  /**
   * Renders the measurement from points.
   * Overrides the base class method to not render the endpoints.
   * @param {Object[]} pointData - The points to render the measurement from.
   * @param {boolean} showMeasureResult - Whether to show the measurement result.
   */
  renderFromPoints(pointData, showMeasureResult) {
    // Override to not render the endpoints
    this.showMeasureResult = showMeasureResult;
    this.clear();
    this.renderRubberbandFromPoints(pointData);
    this.updateSelectionArea();
  }

  /**
   * Renders the rubberband (blue line between the two picks) for the shortest distance measurement.
   * @param {SnapResult[]} picks - The picks to render the rubberband from.
   */
  renderRubberband(picks) {
    const start = picks[1]?.intersectPoint;
    const end = picks[2]?.intersectPoint;
    if (start && end) {
      this.renderDistanceMeasurementFromPoints(start, end);
    }
  }

  /**
   * Renders the rubberband (blue line between the two picks) for the shortest distance measurement.
   * This function is called when the measurement is being restored, for example when the user enters
   * the measure tool and the measurement is restored from the session.
   * @param {Array<{intersection: THREE.Vector3}>} pointData - The points to render the rubberband from.
   */
  renderRubberbandFromPoints(pointData) {
    const start = pointData[1].intersection;
    const end = pointData[2].intersection;
    if (start && end) {
      this.renderDistanceMeasurementFromPoints(start, end);
    }
  }

  updateScale() {
    super.updateScale();
    if (this.measurement.isComplete()) {
      this.clearXYZLine();
      this.drawXYZLine(this.lines.xyz);
    }
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTool.js"
/*!*****************************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTool.js ***!
  \*****************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SlopeMeasureTool: () => (/* binding */ SlopeMeasureTool)
/* harmony export */ });
/* harmony import */ var _SlopeToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SlopeToolIndicator.js */ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeToolIndicator.js");
/* harmony import */ var _SlopeMeasurement_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SlopeMeasurement.js */ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasurement.js");
/* harmony import */ var _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SlopeMeasureTypes.js */ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTypes.js");





class SlopeMeasureTool {
  #debugHandleKeyDown;

  constructor(viewer, snapper, sharedMeasureConfig) {
    this.viewer = viewer;
    this.snapper = snapper;
    this.sharedMeasureConfig = sharedMeasureConfig;

    this.mode = _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__.SlopeMeasureMode.TWO_POINTS;

    // This is just to quickly toggle between single point and two point mode.
    // TODO: Remove this once the UI is implemented.
    this.#debugHandleKeyDown = (ev) => {
      if (ev.key === 'p') {
        this.mode = (this.mode + 1) % 2;
        const modeName = ['Single Point', 'Two Points'];
        console.log('Slope measure mode:', modeName[this.mode]);
      }
    };
  }

  activate() {
    document.addEventListener('keydown', this.#debugHandleKeyDown);
  }

  deactivate() {
    document.removeEventListener('keydown', this.#debugHandleKeyDown);
  }

  getMeasurementName() {
    return 'Slope';
  }

  createMeasurement(measureData) {
    const measurement = new _SlopeMeasurement_js__WEBPACK_IMPORTED_MODULE_1__.SlopeMeasurement(this, measureData?.id, measureData?.options);
    measurement.mode = this.mode;
    return measurement;
  }

  updateMeasurementPreview(snapResult) {
    if (!snapResult || snapResult.isEmpty()) {
      return;
    }
  }

  getIndicatorClass() {
    return _SlopeToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.SlopeToolIndicator;
  }

  saveSessionMeasurement(measurement, listEntry) {

  }

  /**
   * Returns the reference direction (normalized) in world space.
   *
   * Currently the reference direction is the world up vector of the model but in the
   * future this will be set in the measurement options, allowing the user to choose
   * what axis to use as the reference direction.
   * @returns {THREE.Vector3} The reference direction (normalized) in world space.
   */
  getReferenceDirection() {
    const model = this.viewer.model;
    const worldUpVector = new THREE.Vector3().fromArray(model.getUpVector());
    worldUpVector.normalize();
    return worldUpVector;
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTypes.js"
/*!******************************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTypes.js ***!
  \******************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SlopeMeasureMode: () => (/* binding */ SlopeMeasureMode)
/* harmony export */ });
/**
 * The slope measure mode is used to determine what type of slope measure is being performed.
 * - SINGLE_POINT: A single point on the surface determines the slope.
 * - TWO_POINTS: Two points on the surface determine the slope.
 */
const SlopeMeasureMode = Object.freeze({
  SINGLE_POINT: 0,
  TWO_POINTS: 1
});

/***/ },

/***/ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasurement.js"
/*!*****************************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasurement.js ***!
  \*****************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SlopeMeasurement: () => (/* binding */ SlopeMeasurement)
/* harmony export */ });
/* harmony import */ var _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../../src/measurement/Measurement.js */ "./src/measurement/Measurement.js");
/* harmony import */ var _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../../src/measurement/MeasureCommon.js */ "./src/measurement/MeasureCommon.js");
/* harmony import */ var _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SlopeMeasureTypes.js */ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTypes.js");
/* harmony import */ var _src_measurement_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../../../src/measurement/UnitFormatter.js */ "./src/measurement/UnitFormatter.js");
/* harmony import */ var _SlopeMeasurementCommon_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./SlopeMeasurementCommon.js */ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasurementCommon.js");







const { MeasureCommon } = Autodesk.Viewing;

class SlopeMeasurement extends _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_0__.Measurement {
  constructor(measureTool, id, options) {
    super(MeasureCommon.MeasurementTypes.MEASUREMENT_SLOPE, id, options);
    this.mode = _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__.SlopeMeasureMode.TWO_POINTS;
    this.measureTool = measureTool;
    this.slopeResult = null; // Stores the computed slope data
  }

  #tryConvertUnit(value) {
    const sharedMeasureConfig = this.measureTool.sharedMeasureConfig;
    const fromUnits = this.measureTool.viewer.model.getUnitString();
    const toUnits = sharedMeasureConfig.units;
    const calibrationFactor = sharedMeasureConfig.calibrationFactor;

    if (fromUnits != toUnits) {
      return (0,_src_measurement_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__.convertUnits)(fromUnits, toUnits, calibrationFactor, value);
    }

    return value;
  }

  getMaxNumberOfPicks() {
    switch (this.mode) {
      case _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__.SlopeMeasureMode.SINGLE_POINT:return 1;
      case _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__.SlopeMeasureMode.TWO_POINTS:return 2;
      default:return 0;
    }
  }

  /**
   * Computes slope from a surface pick.
   * Uses the face normal and reference direction to determine how tilted the surface is.
   *
   * @param {SnapResult} pick - The surface pick containing faceNormal.
   * @returns {Object|null} - Slope result or null if invalid.
   */
  computeSurfaceSlope(pick) {
    if (!pick || !pick.faceNormal) {
      console.warn('[SlopeMeasurement] Surface pick missing faceNormal');
      return null;
    }

    const faceNormal = pick.faceNormal.clone().normalize();
    const upDirection = this.measureTool.getReferenceDirection();

    const angleDegrees = (0,_SlopeMeasurementCommon_js__WEBPACK_IMPORTED_MODULE_4__.calculateSurfaceSlopeAngle)(faceNormal, upDirection);

    // Converting the units for a single point slope result is not needed.
    const result = (0,_SlopeMeasurementCommon_js__WEBPACK_IMPORTED_MODULE_4__.createSlopeResultFromAngle)(angleDegrees);
    return result;
  }

  /**
   * Computes slope between two picked points.
   * Calculates vertical rise and horizontal run relative to the up direction.
   *
   * @param {SnapResult} pick1 - The first point pick.
   * @param {SnapResult} pick2 - The second point pick.
   * @param {Object} viewer - The viewer instance.
   * @returns {Object|null} - Slope result or null if invalid.
   */
  computeTwoPointSlope(pick1, pick2, viewer) {
    const point1 = (0,_src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_1__.getSnapResultPosition)(pick1, viewer);
    const point2 = (0,_src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_1__.getSnapResultPosition)(pick2, viewer);

    if (!point1 || !point2) {
      console.warn('[SlopeMeasurement] Could not resolve pick positions');
      return null;
    }

    // Check for coincident points
    const distance = point1.distanceTo(point2);
    if (distance < MeasureCommon.EPSILON) {
      console.warn('[SlopeMeasurement] Points are coincident');
      return null;
    }

    const upDirection = this.measureTool.getReferenceDirection();
    let { rise, run, angleDegrees } = (0,_SlopeMeasurementCommon_js__WEBPACK_IMPORTED_MODULE_4__.calculateTwoPointSlope)(point1, point2, upDirection);

    rise = this.#tryConvertUnit(rise);
    run = this.#tryConvertUnit(run);

    return (0,_SlopeMeasurementCommon_js__WEBPACK_IMPORTED_MODULE_4__.createSlopeResult)(rise, run, angleDegrees);
  }

  /**
   * Main computation entry point, called by the measurement system.
   * Computes and logs slope results for validation.
   *
   * @param {Object} picks - The pick dictionary (1-indexed).
   * @param {Object} viewer - The viewer instance.
   * @returns {boolean} - True if computation succeeded.
   */
  computeResult(picks, viewer) {
    this.slopeResult = null;

    switch (this.mode) {
      case _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__.SlopeMeasureMode.SINGLE_POINT:{
          const pick = picks[1];
          this.slopeResult = this.computeSurfaceSlope(pick);

          if (this.slopeResult) {
            this.logSlopeResult('Surface-based slope', this.slopeResult);
            return true;
          }
          return false;
        }

      case _SlopeMeasureTypes_js__WEBPACK_IMPORTED_MODULE_2__.SlopeMeasureMode.TWO_POINTS:{
          const pick1 = picks[1];
          const pick2 = picks[2];
          this.slopeResult = this.computeTwoPointSlope(pick1, pick2, viewer);

          if (this.slopeResult) {
            this.logSlopeResult('Two-point slope', this.slopeResult);
            return true;
          }
          return false;
        }

      default:
        return false;
    }
  }

  /**
   * Logs slope result to console for validation.
   * Demonstrates all slope representation formats.
   *
   * @param {string} label - Description of the measurement type.
   * @param {Object} result - The slope result object.
   */
  logSlopeResult(label, result) {
    console.log(`\n=== ${label} ===`);
    console.log(`Rise.......: ${result.rise.toFixed(4)}`);
    console.log(`Run........: ${result.run.toFixed(4)}`);
    console.log(`Ratio......: ${result.formatted.ratio}`);
    console.log(`Percentage.: ${result.formatted.percentage}`);
    console.log(`Angle......: ${result.formatted.angle}`);
    console.log(`Tangent....: ${result.formatted.tangent}`);
  }

  /**
   * Returns the computed slope result for external consumption.
   * @returns {Object|null} - The slope result or null if not computed.
   */
  getSlopeResult() {
    return this.slopeResult;
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasurementCommon.js"
/*!***********************************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasurementCommon.js ***!
  \***********************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EPSILON: () => (/* binding */ EPSILON),
/* harmony export */   calculateSurfaceSlopeAngle: () => (/* binding */ calculateSurfaceSlopeAngle),
/* harmony export */   calculateTwoPointSlope: () => (/* binding */ calculateTwoPointSlope),
/* harmony export */   createSlopeResult: () => (/* binding */ createSlopeResult),
/* harmony export */   createSlopeResultFromAngle: () => (/* binding */ createSlopeResultFromAngle),
/* harmony export */   formatSignedSlopeAsPercentage: () => (/* binding */ formatSignedSlopeAsPercentage),
/* harmony export */   formatSlopeAsAngle: () => (/* binding */ formatSlopeAsAngle),
/* harmony export */   formatSlopeAsPercentage: () => (/* binding */ formatSlopeAsPercentage),
/* harmony export */   formatSlopeAsRatio: () => (/* binding */ formatSlopeAsRatio),
/* harmony export */   formatSlopeAsTangent: () => (/* binding */ formatSlopeAsTangent)
/* harmony export */ });
/**
 * Small epsilon value to handle numerical imprecision.
 */
const EPSILON = 1e-10;

/**
 * Calculates slope from a surface normal relative to a reference (up) direction.
 *
 * For a horizontal surface, the normal is parallel to up, yielding 0° slope.
 * For a vertical surface, the normal is perpendicular to up, yielding 90° slope.
 *
 * @param {THREE.Vector3} faceNormal - The surface normal (should be normalized).
 * @param {THREE.Vector3} upDirection - The reference up direction (should be normalized).
 * @returns {number} - The slope angle in degrees (0 = horizontal, 90 = vertical).
 */
function calculateSurfaceSlopeAngle(faceNormal, upDirection) {
  const angle = THREE.Math.radToDeg(faceNormal.angleTo(upDirection));
  if (angle > 90) {
    return 180 - angle;
  }
  return angle;
}

/**
 * Calculates slope metrics from two 3D points.
 *
 * Rise is the vertical displacement (along up direction).
 * Run is the horizontal displacement (perpendicular to up direction).
 *
 * @param {THREE.Vector3} point1 - The first point.
 * @param {THREE.Vector3} point2 - The second point.
 * @param {THREE.Vector3} upDirection - The reference up direction (should be normalized).
 * @returns {{rise: number, run: number, angleDegrees: number}} - Slope metrics.
 */
function calculateTwoPointSlope(point1, point2, upDirection) {
  const delta = new THREE.Vector3().subVectors(point2, point1);
  const rise = delta.dot(upDirection);
  const verticalComponent = upDirection.clone().multiplyScalar(rise);
  const horizontalComponent = delta.clone().sub(verticalComponent);
  const run = horizontalComponent.length();

  // Angle from horizontal
  const angleRadians = Math.atan2(Math.abs(rise), run);
  const angleDegrees = THREE.Math.radToDeg(angleRadians);

  return {
    rise: Math.abs(rise), // Absolute value: slope magnitude, not direction
    run,
    angleDegrees
  };
}

/**
 * Formats slope as a ratio (e.g., "1:100" or "2:1").
 *
 * Convention:
 * - For shallow slopes (rise < run): format as "1:N" where N = run/rise
 * - For steep slopes (rise >= run): format as "N:1" where N = rise/run
 * - For zero slope: returns "0:1" (flat)
 * - For vertical: returns "1:0" (infinite slope)
 *
 * @param {number} rise - The vertical displacement.
 * @param {number} run - The horizontal displacement.
 * @param {number} [precision=2] - Decimal places for the ratio value.
 * @returns {string} - The slope as a ratio string.
 */
function formatSlopeAsRatio(rise, run, precision = 2) {

  if (run < EPSILON && rise < EPSILON) {
    return '0:0'; // Degenerate case: no displacement
  }

  if (run < EPSILON) {
    return '1:0'; // Vertical (infinite slope)
  }

  if (rise < EPSILON) {
    return '0:1'; // Horizontal (zero slope)
  }

  // Express ratio with 1 on the smaller side
  if (rise < run) {
    const ratio = run / rise;
    return `1:${ratio.toFixed(precision)}`;
  } else {
    const ratio = rise / run;
    return `${ratio.toFixed(precision)}:1`;
  }
}

/**
 * Formats slope as a percentage (rise/run * 100).
 *
 * Example: 1% means 1 unit rise per 100 units run.
 *
 * @param {number} rise - The vertical displacement.
 * @param {number} run - The horizontal displacement.
 * @param {number} [precision=2] - Decimal places for the percentage value.
 * @returns {string} - The slope as a percentage string.
 */
function formatSlopeAsPercentage(rise, run, precision = 2) {

  if (run < EPSILON) {
    return rise < EPSILON ? '0%' : '∞%'; // Vertical or degenerate
  }

  const percentage = rise / run * 100;
  return `${percentage.toFixed(precision)}%`;
}

/**
 * Formats slope as a signed percentage (signedRise/run * 100).
 *
 * Like {@link formatSlopeAsPercentage} but preserves the direction of the rise:
 * a negative rise yields a negative percentage, and a purely vertical drop is
 * reported as "-∞%" rather than collapsing to 0%.
 *
 * @param {number} signedRise - The vertical displacement, signed (positive = upward).
 * @param {number} run - The horizontal displacement (always non-negative).
 * @param {number} [precision=2] - Decimal places for the percentage value.
 * @returns {string} - The signed slope as a percentage string, or '' when signedRise is NaN.
 */
function formatSignedSlopeAsPercentage(signedRise, run, precision = 2) {
  if (Number.isNaN(signedRise)) {
    return '';
  }
  if (!isFinite(signedRise)) {
    return signedRise > 0 ? '∞%' : '-∞%';
  }
  if (run < EPSILON) {
    if (Math.abs(signedRise) < EPSILON) {
      return `${0 .toFixed(precision)}%`;
    }
    return signedRise > 0 ? '∞%' : '-∞%';
  }

  const percentage = signedRise / run * 100;
  const str = percentage.toFixed(precision);
  return `${+str === 0 ? Math.abs(percentage).toFixed(precision) : str}%`;
}

/**
 * Formats slope as an angle in degrees.
 *
 * @param {number} angleDegrees - The slope angle in degrees.
 * @param {number} [precision=2] - Decimal places for the angle value.
 * @returns {string} - The angle as a formatted string.
 */
function formatSlopeAsAngle(angleDegrees, precision = 2) {
  return `${angleDegrees.toFixed(precision)}°`;
}

/**
 * Formats slope as a tangent value (tan(θ) = rise/run).
 *
 * @param {number} rise - The vertical displacement.
 * @param {number} run - The horizontal displacement.
 * @param {number} [precision=4] - Decimal places for the tangent value.
 * @returns {string} - The tangent as a formatted string.
 */
function formatSlopeAsTangent(rise, run, precision = 4) {

  if (run < EPSILON) {
    return rise < EPSILON ? 'tan(θ) = 0' : 'tan(θ) = ∞';
  }

  const tangent = rise / run;
  return `tan(θ) = ${tangent.toFixed(precision)}`;
}

/**
 * Creates a complete slope result object containing all representations.
 * This is the primary output structure for UI binding.
 *
 * @param {number} rise - The vertical displacement (or derived from angle for surface mode).
 * @param {number} run - The horizontal displacement (or derived from angle for surface mode).
 * @param {number} angleDegrees - The slope angle in degrees.
 * @returns {Object} - Complete slope result with all representations.
 */
function createSlopeResult(rise, run, angleDegrees) {
  return {
    // Raw values for programmatic use
    rise,
    run,
    angleDegrees,
    tangent: run > EPSILON ? rise / run : rise > EPSILON ? Infinity : 0,
    percentage: run > EPSILON ? rise / run * 100 : rise > EPSILON ? Infinity : 0,

    // Formatted strings for display
    formatted: {
      ratio: formatSlopeAsRatio(rise, run),
      percentage: formatSlopeAsPercentage(rise, run),
      angle: formatSlopeAsAngle(angleDegrees),
      tangent: formatSlopeAsTangent(rise, run)
    }
  };
}

/**
 * Creates a slope result from an angle (for surface-based measurement).
 * Derives rise/run from the angle using unit hypotenuse convention.
 *
 * @param {number} angleDegrees - The slope angle in degrees.
 * @returns {Object} - Complete slope result with all representations.
 */
function createSlopeResultFromAngle(angleDegrees) {
  // Derive rise/run from angle using trigonometry
  // For a unit-length slope line: rise = sin(θ), run = cos(θ)
  const angleRadians = THREE.Math.degToRad(angleDegrees);
  const rise = Math.sin(angleRadians);
  const run = Math.cos(angleRadians);

  return createSlopeResult(rise, run, angleDegrees);
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeToolIndicator.js"
/*!*******************************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SlopeMeasurement/SlopeToolIndicator.js ***!
  \*******************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SlopeToolIndicator: () => (/* binding */ SlopeToolIndicator)
/* harmony export */ });
/* harmony import */ var _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../MeasureToolIndicator.js */ "./extensions/Measure/MeasureToolIndicator.js");


class SlopeToolIndicator extends _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.MeasureToolIndicator {
  constructor(viewer, measurement, tool) {
    super(viewer, measurement, tool);
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SurfaceEdgeDetectionUtils.js"
/*!*********************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SurfaceEdgeDetectionUtils.js ***!
  \*********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   centralAngle: () => (/* binding */ centralAngle),
/* harmony export */   createLinesFromSpan: () => (/* binding */ createLinesFromSpan),
/* harmony export */   createSimpleCurve: () => (/* binding */ createSimpleCurve),
/* harmony export */   detectCircleFromLoop: () => (/* binding */ detectCircleFromLoop),
/* harmony export */   detectCurvesAndLines: () => (/* binding */ detectCurvesAndLines),
/* harmony export */   detectEllipseFromLoop: () => (/* binding */ detectEllipseFromLoop),
/* harmony export */   equidistantFromPoint: () => (/* binding */ equidistantFromPoint),
/* harmony export */   getCentroid: () => (/* binding */ getCentroid),
/* harmony export */   getCentroidForEqualEdges: () => (/* binding */ getCentroidForEqualEdges),
/* harmony export */   getCurveSpan: () => (/* binding */ getCurveSpan),
/* harmony export */   getFociPoints: () => (/* binding */ getFociPoints),
/* harmony export */   isSimpleSurface: () => (/* binding */ isSimpleSurface),
/* harmony export */   orientedAngle: () => (/* binding */ orientedAngle),
/* harmony export */   tryFitCircularArc: () => (/* binding */ tryFitCircularArc)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MeasureConstants.js */ "./extensions/Measure/CustomTools/MeasureConstants.js");


//
// Forge Viewer edge primitive helpers.
//
// Utilities to classify edge loops into simple primitives (circles, arcs, lines)
// using THREE.Vector3 operations that are available within Autodesk Forge Viewer
// extensions. The implementation ports the high-level logic from the C++
// EdgePrimitiveUtils helpers used in ElephantVertexGlm.

const TAU = Math.PI * 2;
const EDGE_LENGTH_TOLERANCE_FRACTION = 0.2; // 20%

/**
 * @typedef {Object} ArcPrimitive
 * @property {string} type "ARC"
 * @property {THREE.Vector3[]} points Sample points along the arc span
 * @property {THREE.Vector3} center Arc center
 * @property {number} radius Arc radius
 * @property {THREE.Vector3} normal Arc normal (unit vector)
 * @property {number} sweep Signed sweep angle in radians
 */

/**
 * @typedef {Object} LinePrimitive
 * @property {string} type "LINE"
 * @property {THREE.Vector3} start Start vertex
 * @property {THREE.Vector3} end End vertex
 * @property {number} length Segment length
 */

/**
 * @typedef {Object} CirclePrimitive
 * @property {string} type "CIRCLE"
 * @property {THREE.Vector3[]} points Loop vertices
 * @property {THREE.Vector3} center Circle center
 * @property {number} radius Circle radius
 * @property {number} circumference 2πr
 */

/**
 * Attempts to compute the centroid and ensure all consecutive edges share a
 * consistent length within tolerance (mirrors
 * getCentroidRSLForEqualAndValidEdges from the C++ implementation).
 *
 * @param {THREE.Vector3[]} vertices Ordered vertices (edges abut each other)
 * @param {number} minTolerance Absolute tolerance for length comparison
 * @returns {{centroid:THREE.Vector3|null, edgeLength:number}}
 */
function getCentroidForEqualAndValidEdges(vertices, minTolerance) {
  if (!Array.isArray(vertices) || vertices.length < 2) {
    return { centroid: null, edgeLength: 0 };
  }

  const firstEdgeLength = vertices[0].distanceTo(vertices[1]);
  if (firstEdgeLength <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return { centroid: null, edgeLength: 0 };
  }

  const tolerance = Math.max(firstEdgeLength * EDGE_LENGTH_TOLERANCE_FRACTION, minTolerance);
  const sum = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().copy(vertices[0]);
  let prev = vertices[1];

  for (let i = 2; i < vertices.length; i += 1) {
    const current = vertices[i];
    const length = prev.distanceTo(current);
    if (Math.abs(length - firstEdgeLength) > tolerance) {
      return { centroid: null, edgeLength: 0 };
    }
    sum.add(prev);
    prev = current;
  }
  sum.add(prev);

  const centroid = sum.divideScalar(vertices.length);
  return { centroid, edgeLength: firstEdgeLength };
}

/**
 * Checks that all vertices are roughly equidistant from a reference point.
 */
function equidistantFromPoint(vertices, center, radius, minTolerance) {
  const tolerance = Math.max(radius * _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.VERTEX_PRECISION_PERCENT, minTolerance);
  for (const vertex of vertices) {
    const distance = vertex.distanceTo(center);
    if (Math.abs(distance - radius) > tolerance) {
      return false;
    }
  }
  return true;
}

function orientedAngle(vA, vB, refVec) {
  const cross = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().crossVectors(vA, vB);
  const sin = cross.dot(refVec);
  const cos = vA.dot(vB);
  return Math.atan2(sin, cos);
}

function rotateVectorAroundAxis(vector, axis, angle) {
  const quaternion = new (three__WEBPACK_IMPORTED_MODULE_0___default().Quaternion)().setFromAxisAngle(axis, angle);
  return vector.clone().applyQuaternion(quaternion);
}

function cloneVertices(vertices) {
  return vertices.map((vertex) => vertex.clone());
}

/**
 * Attempts to classify span vertices as a circular arc. Port of
 * EdgeCircularArc::circularArcFromSpanRSLPoints.
 *
 * @param {THREE.Vector3[]} spanVertices Ordered vertices along the curve span
 * @param {Object} options
 * @param {number} options.minTolerance Absolute tolerance used for comparisons
 * @returns {ArcPrimitive|null}
 */
function circularArcFromSpanVertices(spanVertices, { minTolerance = _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON } = {}) {
  if (!Array.isArray(spanVertices) || spanVertices.length < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_ARC_EDGES) {
    return null;
  }

  const { centroid: refPoint, edgeLength } = getCentroidForEqualAndValidEdges(spanVertices, minTolerance);
  if (!refPoint) {
    return null;
  }

  const pt1 = spanVertices[0];
  const pt2 = spanVertices[1];
  const refVec = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().
  subVectors(pt1, refPoint).
  normalize().
  cross(new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(pt2, refPoint).normalize()).
  normalize();

  if (refVec.lengthSq() <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  const pt3 = spanVertices[2];
  const vA = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(pt2, pt1).normalize();
  const vB = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(pt3, pt2).normalize();
  const interiorAngle = orientedAngle(vB, vA, refVec);

  const denominator = Math.PI - interiorAngle;
  if (Math.abs(denominator) < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  const numSides = Math.round(TAU / denominator);
  if (numSides < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_CIRCLE_EDGES) {
    return null;
  }

  const circumRadius = edgeLength / 2 / Math.sin(Math.PI / numSides);
  if (!Number.isFinite(circumRadius) || circumRadius <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  const edgeVec = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(pt2, pt1).normalize();
  const angleBisector = rotateVectorAroundAxis(edgeVec, refVec, interiorAngle / 2);
  const center = pt1.clone().add(angleBisector.clone().multiplyScalar(circumRadius));

  if (!equidistantFromPoint(spanVertices, center, circumRadius, minTolerance)) {
    return null;
  }

  const normal = refVec.clone();
  const startVec = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(pt1, center);
  const endVec = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(spanVertices[spanVertices.length - 1], center);
  const sweep = orientedAngle(startVec.clone().normalize(), endVec.clone().normalize(), normal);

  return {
    type: 'ARC',
    points: cloneVertices(spanVertices),
    center,
    radius: circumRadius,
    normal,
    sweep
  };
}

/**
 * Breaks a loop into simple primitives (arcs and lines). This follows the
 * greedy approach used in `EdgeSimpleCurve::simpleCurvesAndLinesFromEdges` by
 * attempting the largest qualifying arc span starting from the current edge.
 */
function simpleCurvesAndLinesFromVertices(vertices, { minTolerance = _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON } = {}) {
  if (!Array.isArray(vertices) || vertices.length < 2) {
    return [];
  }

  const primitives = [];
  let startIndex = 0;

  while (startIndex < vertices.length - 1) {
    let arcPrimitive = null;
    let bestEndIndex = startIndex + 1;

    for (let end = vertices.length; end >= startIndex + _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_ARC_EDGES; end -= 1) {
      const span = vertices.slice(startIndex, end);
      const arc = circularArcFromSpanVertices(span, { minTolerance });
      if (arc) {
        arcPrimitive = arc;
        bestEndIndex = end - 1;
        break;
      }
    }

    if (arcPrimitive) {
      primitives.push(arcPrimitive);
      startIndex = bestEndIndex;
    } else {
      const start = vertices[startIndex];
      const end = vertices[startIndex + 1];
      primitives.push({
        type: 'LINE',
        start: start.clone(),
        end: end.clone(),
        length: start.distanceTo(end)
      });
      startIndex += 1;
    }
  }

  return primitives;
}

/**
 * Computes the central angle of an arc (always positive, handles reflex angles).
 * The central angle is measured from the arc's start point to its end point,
 * going counter-clockwise relative to the reference normal vector.
 *
 * @param {THREE.Vector3} start - Start point of arc
 * @param {THREE.Vector3} end - End point of arc
 * @param {THREE.Vector3} center - Center of arc
 * @param {THREE.Vector3} refVec - Normal vector defining CCW direction
 * @returns {number} Central angle in radians [0, 2π]
 */
function centralAngle(start, end, center, refVec) {
  const v1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(center, start).normalize();
  const v2 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(end, center).normalize();
  const angle = orientedAngle(v1, v2, refVec);
  return angle > 0 ? angle : 2 * Math.PI + angle;
}

/**
 * Checks if the angle and length of an edge are within curve tolerances.
 * Used to determine if consecutive edges belong to the same curve span.
 *
 * @param {THREE.Vector3} currVec - Current edge vector
 * @param {THREE.Vector3} angleVec - Previous edge vector for angle comparison
 * @param {THREE.Vector3} orientVec - Orientation vector for angle sign determination
 * @param {number|null} refLength - Reference edge length (optional)
 * @param {number|null} tolerance - Length tolerance (optional)
 * @returns {{angleOk: boolean, lengthOk: boolean}} Validation results
 */
function checkAngleLengthTolerances(currVec, angleVec, orientVec, refLength, tolerance) {
  let angleOk = true;
  let lengthOk = true;

  const currNorm = currVec.clone().normalize();
  const angleNorm = angleVec.clone().normalize();
  const angle = orientedAngle(currNorm, angleNorm, orientVec);

  // Check if angle is within acceptable curve range
  if (angle < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_CURVE_ANGLE || angle > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MAX_CURVE_ANGLE) {
    angleOk = false;
  }

  // Check if edge length is within tolerance of reference
  if (refLength !== null && tolerance !== null) {
    if (Math.abs(currVec.length() - refLength) > tolerance) {
      lengthOk = false;
    }
  }

  return { angleOk, lengthOk };
}

/**
 * Computes the centroid and validates equal edge lengths for a set of points.
 * Returns null if edges have inconsistent lengths (not suitable for arc fitting).
 *
 * @param {THREE.Vector3[]} points - Array of vertices
 * @param {number} minTolerance - Minimum tolerance
 * @returns {{centroid: THREE.Vector3|null, edgeLength: number}} Centroid and reference edge length
 */
function getCentroidForEqualEdges(points, minTolerance) {
  if (points.length < 2) {
    return { centroid: null, edgeLength: 0 };
  }

  const pt1 = points[0];
  const pt2 = points[1];
  const firstEdgeLength = pt1.distanceTo(pt2);

  if (firstEdgeLength <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return { centroid: null, edgeLength: 0 };
  }

  const tolerance = Math.max(firstEdgeLength * EDGE_LENGTH_TOLERANCE_FRACTION, minTolerance);
  const centroid = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

  // Validate all edges have similar length while accumulating centroid
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const edgeLength = p1.distanceTo(p2);

    if (Math.abs(edgeLength - firstEdgeLength) > tolerance) {
      return { centroid: null, edgeLength: 0 };
    }
    centroid.add(p1);
  }
  centroid.add(points[points.length - 1]);
  centroid.divideScalar(points.length);

  return { centroid, edgeLength: firstEdgeLength };
}

/**
 * Finds a span of consecutive edges that could form a curve.
 * Edges are grouped if they have similar lengths and interior angles
 * within the acceptable curve range [MIN_CURVE_ANGLE, MAX_CURVE_ANGLE].
 *
 * @param {THREE.Vector3[]} vertices - Array of vertices
 * @param {number} startIdx - Starting vertex index
 * @param {number} lastIdx - Last valid vertex index (numVertices - 1)
 * @param {number} minTolerance - Minimum tolerance for comparisons
 * @returns {{spanStart: number, spanEnd: number}} Start and end indices of the curve span
 */
function getCurveSpan(vertices, startIdx, lastIdx, minTolerance) {
  let endIdx = startIdx + 1;

  const pt1 = vertices[startIdx];
  const pt2 = vertices[startIdx + 1];
  const firstEdgeLength = pt1.distanceTo(pt2);
  const tolerance = Math.max(firstEdgeLength * EDGE_LENGTH_TOLERANCE_FRACTION, minTolerance);

  let prevPt = pt1.clone();
  let currPt = pt2.clone();

  // Need at least one more edge to check angles
  if (startIdx + 1 < lastIdx) {
    // Compute the arc-plane normal. Using only the first 3 vertices can produce a
    // near-zero cross product when they are nearly collinear (finely tessellated arcs).
    // Scan forward until we find a vertex far enough off the pt1→pt2 line to give a
    // stable normal; the threshold is scale-invariant (perpendicular distance > ε).
    const edge = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().subVectors(pt2, pt1);
    const edgeLenSq = edge.lengthSq();
    let refVec = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
    const scratch = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
    const cross = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
    for (let k = startIdx + 2; k <= lastIdx; k++) {
      scratch.subVectors(vertices[k], pt1);
      cross.crossVectors(edge, scratch);
      if (cross.lengthSq() > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON * _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON * edgeLenSq) {
        refVec.copy(cross).normalize();
        break;
      }
    }

    if (refVec.lengthSq() === 0) {
      // All remaining vertices are collinear — no arc possible from here.
      return { spanStart: startIdx, spanEnd: endIdx };
    }

    // Extend span forward while edges satisfy curve constraints
    for (let nextIdx = startIdx + 2; nextIdx <= lastIdx; nextIdx++) {
      const nextPt = vertices[nextIdx];
      const vec1 = prevPt.clone().sub(currPt);
      const vec2 = nextPt.clone().sub(currPt);

      const { angleOk, lengthOk } = checkAngleLengthTolerances(
        vec2, vec1, refVec, firstEdgeLength, tolerance
      );

      if (!angleOk || !lengthOk) {
        break;
      }

      endIdx++;
      prevPt.copy(currPt);
      currPt.copy(nextPt);
    }
  }

  return { spanStart: startIdx, spanEnd: endIdx };
}

/**
 * Attempts to fit a circular arc to a span of vertices.
 * Uses the inscribed polygon method to compute the circumradius and center.
 *
 * @param {THREE.Vector3[]} vertices - Full vertex array
 * @param {number} startIdx - Start index of span
 * @param {number} endIdx - End index of span (inclusive, refers to last edge's end point)
 * @param {number} minTolerance - Minimum tolerance
 * @returns {Object|null} Arc object with type, centroid, vertices, perimeter; or null if fitting fails
 */
function tryFitCircularArc(vertices, startIdx, endIdx, minTolerance) {
  // Extract span vertices (endIdx + 1 because endIdx is edge index, we need the endpoint)
  const spanVertices = vertices.slice(startIdx, endIdx + 2);
  const numEdges = spanVertices.length - 1;

  if (numEdges < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_ARC_EDGES) {
    return null;
  }

  // Validate equal edge lengths and get centroid
  const { centroid, edgeLength } = getCentroidForEqualEdges(spanVertices, minTolerance);
  if (!centroid || edgeLength === 0) {
    return null;
  }

  // Compute reference vector (normal to arc plane) from first two vertices
  const pt1 = spanVertices[0];
  const pt2 = spanVertices[1];
  const v1 = pt1.clone().sub(centroid).normalize();
  const v2 = pt2.clone().sub(centroid).normalize();
  const refVec = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)().crossVectors(v1, v2).normalize();

  if (refVec.lengthSq() <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  // Compute interior angle from first 3 points
  const pt3 = spanVertices[2];
  const vA = pt2.clone().sub(pt1).normalize();
  const vB = pt2.clone().sub(pt3).normalize();
  const interiorAngle = orientedAngle(vB, vA, refVec);

  // Calculate number of sides if this were a closed regular polygon
  const numSides = Math.round(2 * Math.PI / (Math.PI - interiorAngle));
  if (!Number.isFinite(numSides) || numSides < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_CIRCLE_EDGES) {
    return null;
  }

  // Calculate circumradius: r = (edgeLength / 2) / sin(π / numSides)
  const circumRadius = edgeLength / 2 / Math.sin(Math.PI / numSides);
  if (!Number.isFinite(circumRadius) || circumRadius <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  // Calculate center using angle bisector method
  const edgeVec = pt2.clone().sub(pt1).normalize();
  const quaternion = new (three__WEBPACK_IMPORTED_MODULE_0___default().Quaternion)().setFromAxisAngle(refVec, interiorAngle / 2);
  const angleBisector = edgeVec.clone().applyQuaternion(quaternion);
  const center = pt1.clone().add(angleBisector.multiplyScalar(circumRadius));

  // Validate all points are equidistant from center
  if (!equidistantFromPoint(spanVertices, center, circumRadius, minTolerance)) {
    return null;
  }

  // Calculate arc perimeter using central angle
  const arcPerimeter = circumRadius * centralAngle(
    spanVertices[0],
    spanVertices[spanVertices.length - 1],
    center,
    refVec
  );

  return {
    type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCULAR_ARC,
    centroid: spanVertices[Math.floor(spanVertices.length / 2)],
    vertices: spanVertices,
    perimeter: arcPerimeter
  };
}

/**
 * Creates line primitives from a span of vertices.
 * Each edge in the span becomes a separate line primitive.
 *
 * @param {THREE.Vector3[]} vertices - Full vertex array
 * @param {number} startIdx - Inclusive start vertex index
 * @param {number} endIdx - Inclusive end vertex index
 * @returns {Object[]} Array of LINE primitives
 */
function createLinesFromSpan(vertices, startIdx, endIdx) {
  const lines = [];

  for (let i = startIdx; i < endIdx; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    const length = p1.distanceTo(p2);

    if (length > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
      lines.push({
        type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.LINE,
        vertices: [p1.clone(), p2.clone()]
      });
    }
  }

  return lines;
}

/**
 * Creates a simple curve primitive covering vertices [startIdx, endIdx] inclusive.
 *
 * @param {THREE.Vector3[]} vertices - Full vertex array
 * @param {number} startIdx - Inclusive start vertex index
 * @param {number} endIdx - Inclusive end vertex index
 * @returns {Object|null}
 */
function createSimpleCurve(vertices, startIdx, endIdx) {
  if (endIdx <= startIdx) return null;
  const curveVertices = [];
  let perimeter = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    curveVertices.push(vertices[i].clone());
    if (i > startIdx) perimeter += vertices[i].distanceTo(vertices[i - 1]);
  }
  if (perimeter <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) return null;
  return {
    type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.SIMPLE_CURVE,
    centroid: curveVertices[Math.floor(curveVertices.length / 2)],
    vertices: curveVertices,
    perimeter: perimeter
  };
}

/**
 * Detects geometric primitives (lines and circular arcs) from an array of 3D vertices.
 *
 * Algorithm overview (Port of C++ algorithm of EdgeCircularArc::circularArcFromSpanRSLPoints):
 * 1. Iterate through vertices looking for spans of edges with consistent geometry
 * 2. For each span, check if edges have similar lengths and smooth angle transitions
 * 3. If span has enough edges, attempt to fit a circular arc (using the inscribed polygon method)
 * 4. If arc fitting fails or span is too short, output edges as individual lines
 *
 * @param {THREE.Vector3[]} vertices - Array of THREE.Vector3 points forming an open polyline (edges abut each other)
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.tolerance=0.001] - Minimum tolerance for geometric comparisons
 * @returns {Object[]} Array of detected primitives (lines and circular arcs)
 */
function detectCurvesAndLines(vertices, options = {}) {
  const minTolerance = options.tolerance ?? _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON;
  const primitives = [];

  if (!vertices || vertices.length < 2) {
    return primitives;
  }

  const numEdges = vertices.length - 1;

  // If too few edges for arc detection, output all as lines
  if (numEdges < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_ARC_EDGES) {
    return createLinesFromSpan(vertices, 0, numEdges);
  }

  let startEdgeIdx = 0;
  const lastEdgeIdx = numEdges - 1;

  while (startEdgeIdx <= lastEdgeIdx) {
    const { spanStart, spanEnd } = getCurveSpan(vertices, startEdgeIdx, lastEdgeIdx, minTolerance);
    const spanEdgeCount = spanEnd - spanStart;

    if (spanEdgeCount < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_ARC_EDGES) {
      // Not enough edges for an arc, output as lines
      primitives.push(...createLinesFromSpan(vertices, spanStart, spanEnd));
    } else {
      const arc = tryFitCircularArc(vertices, spanStart, spanEnd, minTolerance);
      if (arc) {
        primitives.push(arc);
      } else {
        const curve = createSimpleCurve(vertices, spanStart, spanEnd);
        if (curve) primitives.push(curve);
      }
    }

    startEdgeIdx = spanEnd;
  }

  return primitives;
}

/**
 * Checks if the surface is simpler than supported shapes.
 * @param {THREE.Vector3[]} vertices - The vertices of the shape
 * @returns {boolean} True if the surface is simpler than supported shapes, false otherwise
 */
function isSimpleSurface(vertices) {
  return vertices.length < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MIN_CIRCLE_EDGES;
}

/**
 * Detects a circle from a list of vertices. This function is used to detect a circle from a list of vertices.
 * @param {THREE.Vector3[]} vertices - The vertices of the shape
 * @returns {Object} The detected shape
 */
// TODO check if loop is coplanar
function detectCircleFromLoop(vertices) {
  // if the surface is simpler than a circle, return null.
  if (isSimpleSurface(vertices)) {
    return null;
  }
  const centroid = getCentroid(vertices);
  const referenceRadius = vertices[0].distanceTo(centroid);
  if (referenceRadius <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  // Use for...of with early return instead of forEach
  for (const vertex of vertices) {
    const radius = vertex.distanceTo(centroid);
    if (Math.abs(radius - referenceRadius) > referenceRadius * _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
      return null;
    }
  }

  return {
    type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCLE,
    centroid: centroid,
    vertices: vertices,
    perimeter: 2 * Math.PI * referenceRadius,
    radius: referenceRadius
  };
}

/**
 * Detects an ellipse from a list of vertices.
 * @param {THREE.Vector3[]} vertices - The vertices of the shape
 * @returns {Object} The detected shape
 */
function detectEllipseFromLoop(vertices) {
  // if the surface is simpler than an ellipse, return null.
  if (isSimpleSurface(vertices)) {
    return null;
  }
  if (vertices.length % 4 !== 0) {
    return null;
  }

  // we assume that the points are in the order of a closed loop.
  // now we have to find the major and minor axes of the ellipse.
  // we can do this by finding the two points that are farthest apart.
  // the major axis is the line segment between these two points.
  // the minor axis is the line segment perpendicular to the major axis but will be checked by the other two points.
  let minDistance = Number.MAX_VALUE;
  let maxDistance = 0;
  const halfVerticesLength = vertices.length / 2;
  let majorAxisIndex;
  let minorAxisIndex;

  for (let i = 0; i < halfVerticesLength; i++) {
    const oppositeIndex = i + halfVerticesLength;
    const distance = vertices[i].distanceTo(vertices[oppositeIndex]);

    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);
    if (distance === maxDistance) {
      majorAxisIndex = i;
    }
    if (distance === minDistance) {
      minorAxisIndex = i;
    }
  }

  const majorAxis = vertices[majorAxisIndex].clone().sub(vertices[(majorAxisIndex + halfVerticesLength) % vertices.length]);
  const minorAxis = vertices[minorAxisIndex].clone().sub(vertices[(minorAxisIndex + halfVerticesLength) % vertices.length]);

  minorAxis.normalize();
  majorAxis.normalize();
  // check if the minor axis is perpendicular to the major axis
  if (Math.abs(minorAxis.dot(majorAxis)) > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON) {
    return null;
  }

  // check if the distance between the two points is not zero
  if (maxDistance === 0) {
    return null; // All points are the same, not an ellipse.
  }

  // calculate the distance between the centroid and the major and minor axes
  const ellipseMajorAxisDistance = maxDistance / 2;
  const ellipseMinorAxisDistance = minDistance / 2;
  // calculate the centroid of the ellipse
  const ellipseCenter = getCentroid(vertices);

  // get foci points of the ellipse
  const ellipseFociPoints = getFociPoints(ellipseMajorAxisDistance, ellipseMinorAxisDistance, ellipseCenter, majorAxis);

  // verify that the shape is an ellipse by summing lengths of the lines between the foci points and the vertices.
  const locus = maxDistance;
  // Relative tolerance: UNORM16 quantization error scales with geometry extent.
  const locusTolerance = Math.max(locus * _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.VERTEX_PRECISION_PERCENT, _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.EPSILON);
  for (let i = 0; i < vertices.length; i++) {
    const currentVertex = vertices[i];
    const f1 = ellipseFociPoints.f1;
    const f2 = ellipseFociPoints.f2;
    const distanceToF1 = currentVertex.distanceTo(f1);
    const distanceToF2 = currentVertex.distanceTo(f2);
    if (Math.abs(distanceToF1 + distanceToF2 - locus) > locusTolerance) {
      return null;
    }
  }
  const a = ellipseMajorAxisDistance;
  const b = ellipseMinorAxisDistance;
  const ellipseCircumference = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

  if (!ellipseFociPoints || !ellipseCenter || !ellipseMajorAxisDistance || !ellipseMinorAxisDistance || !ellipseCircumference) {
    return null;
  }

  const ellipse = {
    type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.ELLIPSE,
    centroid: ellipseCenter,
    vertices: vertices,
    perimeter: ellipseCircumference,
    a: ellipseMajorAxisDistance, // distance between centroid and the major axis
    b: ellipseMinorAxisDistance, // distance between centroid and the minor axis
    majorAxis: majorAxis,
    minorAxis: minorAxis
  };

  return ellipse;
}

/**
 * Calculates the foci points of an ellipse
 * @param {number} semiMajorAxis - The length of the semi-major axis
 * @param {number} semiMinorAxis - The length of the semi-minor axis
 * @param {THREE.Vector3} centroid - The centroid of the ellipse
 * @param {THREE.Vector3} majorAxis - The normalized vector of the major axis
 * @returns {Object} The foci points
 */
const getFociPoints = (semiMajorAxis, semiMinorAxis, centroid, majorAxis) => {
  // based on Linear Eccentricity https://en.wikipedia.org/wiki/Ellipse#Linear_eccentricity
  const c = Math.sqrt(semiMajorAxis * semiMajorAxis - semiMinorAxis * semiMinorAxis);
  const f1 = centroid.clone().add(majorAxis.clone().multiplyScalar(c));
  const f2 = centroid.clone().sub(majorAxis.clone().multiplyScalar(c));
  return { f1, f2 };
};

/**
 * Calculates the centroid of a list of vertices
 * @param {THREE.Vector3[]} vertices - The vertices to calculate the centroid of
 * @returns {THREE.Vector3} The centroid of the vertices
 */
const getCentroid = (vertices) => {
  const centroid = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  vertices.forEach((vertex) => {
    centroid.add(vertex);
  });
  centroid.divideScalar(vertices.length);
  return centroid;
};



/***/ },

/***/ "./extensions/Measure/CustomTools/SurfaceMeasureComputation.js"
/*!*********************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SurfaceMeasureComputation.js ***!
  \*********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   computeSurfaceResult: () => (/* binding */ computeSurfaceResult)
/* harmony export */ });
/* harmony import */ var _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../src/measurement/MeasureCommon.js */ "./src/measurement/MeasureCommon.js");
/* harmony import */ var _SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SurfaceEdgeDetectionUtils.js */ "./extensions/Measure/CustomTools/SurfaceEdgeDetectionUtils.js");
/* harmony import */ var _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MeasureConstants.js */ "./extensions/Measure/CustomTools/MeasureConstants.js");




const av = Autodesk.Viewing;
const avp = av.Private;
const MeasureCommon = av.MeasureCommon;

// Per-geometry weld-map cache. Keyed by geometry object so the cache is GC'd with the
// geometry and we never mutate shared model data with extension-private fields.
const geometryWeldCache = new WeakMap();

function getCanonOf(geometry) {
  let canonOf = geometryWeldCache.get(geometry);
  if (!canonOf) {
    canonOf = buildWeldMap(geometry);
    geometryWeldCache.set(geometry, canonOf);
  }
  return canonOf;
}

/**
 * Computes the surface measurement result from picks
 * @param {Object} picks - The measurement picks
 * @param {Object} viewer - The viewer instance
 * @returns {Object|null} The surface measurement result
 */
function computeSurfaceResult(picks, viewer) {
  const firstPick = picks[1];
  const faceNormal = firstPick?.faceNormal;
  if (!firstPick || !faceNormal) {
    return null;
  }

  const surfaceData = extractSurfaceData(firstPick, viewer);
  const outerLoop = surfaceData?.vertices?.[0];
  if (!outerLoop) {
    return null;
  }

  return {
    intersectPoint: firstPick.intersectPoint,
    surfaceData,
    surfaceProperties: {
      area: surfaceData.area,
      centroid: (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__.getCentroid)(outerLoop),
      vertexCount: outerLoop.length
    },
    type: MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE
  };
}

/**
 * Creates a canonical edge key from two vertex indices using the weld map.
 * Ensures consistent edge identification regardless of vertex order.
 * @param {number[]} canonOf - The canonical vertex index map
 * @param {number} vA - First vertex index
 * @param {number} vB - Second vertex index
 * @returns {string} A unique key for the edge
 */
function makeEdgeKey(canonOf, vA, vB) {
  const canonA = canonOf[vA];
  const canonB = canonOf[vB];
  return canonA < canonB ? `${canonA}_${canonB}` : `${canonB}_${canonA}`;
}

// 3D shoelace: |sum_i (p_i x p_{i+1})| / 2 — translation-invariant unsigned area of the
// planar polygon defined by `points`. Result is meaningless for non-planar loops, so callers
// must gate this on isSurfaceCurved === false.
function calculateSurfaceArea(points) {
  if (!points || points.length < 3) {
    return 0;
  }

  const vectorArea = new THREE.Vector3(0, 0, 0);
  const cross = new THREE.Vector3();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    cross.crossVectors(points[i], points[(i + 1) % n]);
    vectorArea.add(cross);
  }
  return vectorArea.length() / 2;
}

function buildWeldMap(geometry, epsilon = _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.WELDING_EPSILON) {
  const readPosition = avp.VertexEnumerator.makeReadPositionFunc(geometry);
  const numVertices = avp.VertexEnumerator.getVertexCount(geometry);

  const keyToCanon = new Map(); // quantized position -> canonical vertex id
  const canonOf = new Array(numVertices); //canonOf[originalIndex] = canonicalIndex
  const _v = { x: 0, y: 0, z: 0 };

  let canonCount = 0;
  for (let i = 0; i < numVertices; i++) {
    readPosition(i, _v);

    const key = `${Math.round(_v.x / epsilon)},${Math.round(_v.y / epsilon)},${Math.round(_v.z / epsilon)}`;

    let canon = keyToCanon.get(key);
    if (canon === undefined) {
      canon = canonCount++;
      keyToCanon.set(key, canon);
    }
    canonOf[i] = canon;
  }
  return canonOf;
}

function getEdgeMapWelded(geometry, canonOf) {
  const ib = geometry.ib;
  if (!ib) return null;

  const edgeMap = new Map();

  for (let i = 0; i < ib.length; i += 3) {
    const v0 = ib[i];
    const v1 = ib[i + 1];
    const v2 = ib[i + 2];

    const edges = [[v0, v1], [v1, v2], [v2, v0]];
    for (const [vA, vB] of edges) {
      const key = makeEdgeKey(canonOf, vA, vB);
      let arr = edgeMap.get(key);
      if (!arr) {
        edgeMap.set(key, arr = []);
      }
      arr.push(i);
    }
  }

  return edgeMap;
}

/**
 * Extracts oriented boundary loops from a set of boundary edges.
 *
 * Edge-based walker (mirrors elephant's `extractEdgeLoops` in
 * `ElephantVertexGlm/3D/Measurement/EdgeLoopUtils.cpp`):
 *   - Each edge is consumed at most once (`processedEdges`).
 *   - When the walk revisits a vertex seen earlier in the current loop, the
 *     repeated section is clipped out as a closed sub-loop — naturally handles
 *     self-intersections at non-manifold vertices.
 *   - Starts are biased to chain endpoints (degree-1 vertices in the remaining
 *     edge graph) so open chains trace as one loop instead of fragmenting.
 *   - At junctions with multiple unprocessed edges, picks the one whose outgoing
 *     direction best continues the incoming direction (same pinch-point heuristic
 *     the vertex-based version used).
 */
function buildBoundaryLoops(geometry, boundaryEdges, canonOf) {
  if (!canonOf) return { loops: [], openFlags: [] };

  const readPosition = avp.VertexEnumerator.makeReadPositionFunc(geometry);
  if (!readPosition) {
    console.warn('buildBoundaryLoops: geometry has no readable positions');
    return { loops: [], openFlags: [] };
  }

  const canonToOrig = new Map();
  const edges = []; // { c0, c1 }
  const vertexEdges = new Map(); // canon -> edge indices
  const seenEdgeKeys = new Set();

  for (const [a, b] of boundaryEdges) {
    const ca = canonOf[a];
    const cb = canonOf[b];
    if (ca === cb) continue; // degenerate after welding

    const key = ca < cb ? `${ca}_${cb}` : `${cb}_${ca}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);

    const eIdx = edges.length;
    edges.push({ c0: ca, c1: cb });

    if (!vertexEdges.has(ca)) vertexEdges.set(ca, []);
    if (!vertexEdges.has(cb)) vertexEdges.set(cb, []);
    vertexEdges.get(ca).push(eIdx);
    vertexEdges.get(cb).push(eIdx);

    if (!canonToOrig.has(ca)) canonToOrig.set(ca, a);
    if (!canonToOrig.has(cb)) canonToOrig.set(cb, b);
  }

  // Read a canonical vertex position into `out` (a Vector3). Returns `out` on
  // success, null if the canonical id has no mapping. Shared scratches in
  // callers keep the walker allocation-free on the hot path.
  const getPos = (canon, out) => {
    const origIdx = canonToOrig.get(canon);
    if (origIdx === undefined) return null;
    readPosition(origIdx, out);
    return out;
  };

  const processedEdges = new Set();

  const countUnprocessedAt = (canon) => {
    const list = vertexEdges.get(canon) || [];
    let n = 0;
    for (const i of list) if (!processedEdges.has(i)) n++;
    return n;
  };

  const _posJunction = new THREE.Vector3();
  const _posOther = new THREE.Vector3();

  const pickNextEdge = (atCanon, incomingDir) => {
    const incident = vertexEdges.get(atCanon) || [];
    let firstUnprocessed = -1;
    let multipleUnprocessed = false;
    for (const i of incident) {
      if (processedEdges.has(i)) continue;
      if (firstUnprocessed < 0) {
        firstUnprocessed = i;
      } else {
        multipleUnprocessed = true;
        break;
      }
    }
    if (firstUnprocessed < 0) return -1;
    if (!multipleUnprocessed || !incomingDir) return firstUnprocessed;

    // Multiple candidates: prefer the edge whose outgoing direction best continues incoming.
    if (!getPos(atCanon, _posJunction)) return firstUnprocessed;

    let best = firstUnprocessed;
    let bestDot = -Infinity;
    for (const i of incident) {
      if (processedEdges.has(i)) continue;
      const e = edges[i];
      const otherCanon = e.c0 === atCanon ? e.c1 : e.c0;
      if (!getPos(otherCanon, _posOther)) continue;
      _posOther.sub(_posJunction);
      const len = _posOther.length();
      if (len === 0) continue;
      const dot = incomingDir.dot(_posOther.divideScalar(len));
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    return best;
  };

  // Choose a starting edge. Prefer edges incident to an endpoint vertex (one
  // unprocessed edge) — that way open chains trace as one loop from their natural
  // endpoint instead of fragmenting. For closed rings (all degree-2) any edge works.
  const pickStart = () => {
    let endpointStart = null;
    let anyStart = null;
    for (let i = 0; i < edges.length; i++) {
      if (processedEdges.has(i)) continue;
      const e = edges[i];
      if (!anyStart) anyStart = { edgeIdx: i, startCanon: e.c0 };
      if (countUnprocessedAt(e.c0) === 1) {
        endpointStart = { edgeIdx: i, startCanon: e.c0 };
        break;
      }
      if (countUnprocessedAt(e.c1) === 1) {
        endpointStart = { edgeIdx: i, startCanon: e.c1 };
        break;
      }
    }
    return endpointStart || anyStart;
  };

  const rawLoops = []; // { canonSeq: number[], closed: boolean }
  const _p0 = new THREE.Vector3();
  const _p1 = new THREE.Vector3();

  while (processedEdges.size < edges.length) {
    const start = pickStart();
    if (!start) break;

    const { edgeIdx: startEdgeIdx, startCanon } = start;
    const startEdge = edges[startEdgeIdx];
    processedEdges.add(startEdgeIdx);

    const loopCanon = [startCanon, startEdge.c0 === startCanon ? startEdge.c1 : startEdge.c0];
    const vertexToPos = new Map();
    vertexToPos.set(loopCanon[0], 0);
    vertexToPos.set(loopCanon[1], 1);

    let closed = false;

    // Inner walk consumes one edge per iteration (processedEdges.add runs before any
    // branch), so edges.length is a hard upper bound. Guard against infinite loops
    // from a future regression in the consumed-edge invariant.
    for (let steps = 0; steps <= edges.length; steps++) {
      const lastCanon = loopCanon[loopCanon.length - 1];
      const prevCanon = loopCanon.length >= 2 ? loopCanon[loopCanon.length - 2] : -1;

      let incoming = null;
      if (prevCanon !== -1 && getPos(prevCanon, _p0) && getPos(lastCanon, _p1)) {
        _p1.sub(_p0);
        const len = _p1.length();
        if (len > 0) incoming = _p1.divideScalar(len);
      }

      const nextEdgeIdx = pickNextEdge(lastCanon, incoming);
      if (nextEdgeIdx < 0) break; // open terminate

      processedEdges.add(nextEdgeIdx);
      const ne = edges[nextEdgeIdx];
      const nextCanon = ne.c0 === lastCanon ? ne.c1 : ne.c0;

      const existingPos = vertexToPos.get(nextCanon);
      if (existingPos !== undefined) {
        if (existingPos === 0) {
          closed = true;
          break;
        }
        // Clip sub-loop [existingPos .. end] as a closed inner ring; continue
        // the main walk from the shared vertex.
        const subCanon = loopCanon.slice(existingPos);
        rawLoops.push({ canonSeq: subCanon, closed: true });
        for (let k = existingPos; k < loopCanon.length; k++) {
          vertexToPos.delete(loopCanon[k]);
        }
        loopCanon.length = existingPos;
        loopCanon.push(nextCanon);
        vertexToPos.set(nextCanon, loopCanon.length - 1);
        continue;
      }

      loopCanon.push(nextCanon);
      vertexToPos.set(nextCanon, loopCanon.length - 1);
    }

    rawLoops.push({ canonSeq: loopCanon, closed });
  }

  const loops = [];
  const openFlags = [];
  for (const r of rawLoops) {
    if (r.canonSeq.length < 2) continue;
    loops.push(r.canonSeq.map((c) => canonToOrig.get(c)));
    openFlags.push(!r.closed);
  }

  return { loops, openFlags };
}

/**
 * Get face boundaries based on a starting triangle and crease angle threshold
 * @param {THREE.BufferGeometry} geometry - The geometry of the mesh
 * @param {number} startTriangleIndex - The index of the starting triangle (face index * 3)
 * @param {number} creaseAngleRadians - The crease angle threshold in radians
 * @param {THREE.Matrix4} [matrixWorld] - The world transformation matrix, used to correct normals for non-uniform scaling
 * @returns {Object} An object containing boundaryEdges and isSurfaceCurved flag
 */
function getFaceBoundaries(geometry, startTriangleIndex, creaseAngleRadians = _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.CREASE_ANGLE_RADIANS, matrixWorld) {
  if (!geometry || !geometry.ib) return { boundaryEdges: [], isSurfaceCurved: false };

  const canonOf = getCanonOf(geometry);
  if (!canonOf) return { boundaryEdges: [], isSurfaceCurved: false };

  const edgeMap = getEdgeMapWelded(geometry, canonOf);
  if (!edgeMap) return { boundaryEdges: [], isSurfaceCurved: false };

  const ib = geometry.ib;

  const readPosition = avp.VertexEnumerator.makeReadPositionFunc(geometry);

  const normals = geometry.attributes.normal?.array;
  const normalStride = 3;

  // Apply scale of the matrixWorld to prevent normal calculation inaccuracies
  // in case of degenerated unit-box transformations (see Snapper.js faceSnapping)
  const scale = matrixWorld ?
  new THREE.Vector3().setFromMatrixScale(matrixWorld) :
  new THREE.Vector3(1, 1, 1);
  // Guard against degenerate (near-zero) scale components that would produce NaN normals.
  if (scale.x < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MIN_SCALE_COMPONENT || scale.y < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MIN_SCALE_COMPONENT || scale.z < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MIN_SCALE_COMPONENT) {
    scale.set(1, 1, 1);
  }

  // Returns a fresh THREE.Vector3 per call. Callers (BFS comparisons against `startNormal`)
  // hold on to the returned value across many subsequent calls, so we cannot reuse a
  // shared scratch here without aliasing bugs.
  function getTriangleNormal(triangleIdx) {
    const i0 = ib[triangleIdx];
    const i1 = ib[triangleIdx + 1];
    const i2 = ib[triangleIdx + 2];

    if (normals) {
      const n0 = new THREE.Vector3(
        normals[i0 * normalStride],
        normals[i0 * normalStride + 1],
        normals[i0 * normalStride + 2]
      );
      const n1 = new THREE.Vector3(
        normals[i1 * normalStride],
        normals[i1 * normalStride + 1],
        normals[i1 * normalStride + 2]
      );
      const n2 = new THREE.Vector3(
        normals[i2 * normalStride],
        normals[i2 * normalStride + 1],
        normals[i2 * normalStride + 2]
      );
      return n0.add(n1).add(n2).normalize();
    }

    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    readPosition(i0, p0);
    readPosition(i1, p1);
    readPosition(i2, p2);
    return p1.sub(p0).cross(p2.sub(p0)).divide(scale).normalize();
  }

  const startNormal = getTriangleNormal(startTriangleIndex);

  // Find all triangles that are part of this face (similar normals).
  // BFS ensures triangles are discovered in approximate radial order.
  // This matters if a triangle count cap is reintroduced: nearby boundaries are visited first.
  const faceTriangles = new Set();
  const trianglesToCheck = [startTriangleIndex];
  let queueHead = 0;
  faceTriangles.add(startTriangleIndex);

  let isSurfaceCurved = false;

  while (queueHead < trianglesToCheck.length) {
    const currentTriIdx = trianglesToCheck[queueHead++];
    const currentNormal = getTriangleNormal(currentTriIdx);

    // Get the three edges of this triangle
    const v0 = ib[currentTriIdx];
    const v1 = ib[currentTriIdx + 1];
    const v2 = ib[currentTriIdx + 2];

    const edges = [
    [v0, v1],
    [v1, v2],
    [v2, v0]];


    // Check each edge for adjacent triangles
    for (const edge of edges) {
      const edgeKey = makeEdgeKey(canonOf, edge[0], edge[1]);
      const adjacentTriangles = edgeMap.get(edgeKey) || [];

      for (const adjTriIdx of adjacentTriangles) {
        if (adjTriIdx === currentTriIdx || faceTriangles.has(adjTriIdx)) {
          continue;
        }

        const adjNormal = getTriangleNormal(adjTriIdx);
        const angle = Math.acos(Math.max(-1, Math.min(1, currentNormal.dot(adjNormal))));

        // If angle is less than crease angle, include this triangle
        if (angle < creaseAngleRadians) {
          faceTriangles.add(adjTriIdx);
          trianglesToCheck.push(adjTriIdx);

          // Also check if this new triangle deviates from the original normal
          if (!isSurfaceCurved) {
            const angleToStart = Math.acos(Math.max(-1, Math.min(1, startNormal.dot(adjNormal))));
            if (angleToStart > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.ANGLE_PRECISION) {
              isSurfaceCurved = true;
            }
          }
        }
      }
    }
  }

  // Deduplicate by canonical key — non-manifold edges touch multiple face-set triangles
  // and would otherwise produce duplicate adj entries causing false pinch-points.
  const seenBoundaryKeys = new Set();
  const boundaryEdges = [];

  for (let qi = 0; qi < trianglesToCheck.length; qi++) {
    const triangleIdx = trianglesToCheck[qi];
    const v0 = ib[triangleIdx];
    const v1 = ib[triangleIdx + 1];
    const v2 = ib[triangleIdx + 2];

    const edges = [
    [v0, v1],
    [v1, v2],
    [v2, v0]];


    for (const edge of edges) {
      const edgeKey = makeEdgeKey(canonOf, edge[0], edge[1]);
      const adjacentTriangles = edgeMap.get(edgeKey) || [];

      // Boundary = mesh border or at least one neighbour outside the face set.
      const isBoundary = adjacentTriangles.length === 1 ||
      adjacentTriangles.some((t) => t !== triangleIdx && !faceTriangles.has(t));

      if (isBoundary && !seenBoundaryKeys.has(edgeKey)) {
        seenBoundaryKeys.add(edgeKey);
        boundaryEdges.push(edge);
      }
    }
  }

  return { boundaryEdges, isSurfaceCurved };
}

/**
 * Convert boundary edges to world coordinate vertices
 * @param {number[][]} orderedBoundaryEdges - Array of chains, each chain is an array of vertex indices
 * @param {THREE.BufferGeometry} geometry - The original geometry
 * @param {THREE.Matrix4} worldMatrix - The world transformation matrix
 * @returns {THREE.Vector3[][]} Array of chains, each chain is an array of world coordinate vertices
 */
function convertBoundaryEdgesToWorldVertices(orderedBoundaryEdges, geometry, worldMatrix) {
  const readPosition = avp.VertexEnumerator.makeReadPositionFunc(geometry);
  if (!readPosition) {
    console.warn('Invalid geometry data for vertex extraction');
    return [];
  }

  const worldVertexChains = [];

  // Process each chain of boundary edges
  for (const chain of orderedBoundaryEdges) {
    const worldVertices = [];

    // Convert each vertex index in the chain to world coordinates
    for (let i = 0; i < chain.length; i++) {
      const worldVertex = new THREE.Vector3();
      readPosition(chain[i], worldVertex);

      if (worldMatrix) {
        worldVertex.applyMatrix4(worldMatrix);
      }

      worldVertices.push(worldVertex);
    }

    worldVertexChains.push(worldVertices);
  }

  return worldVertexChains;
}

/**
 * Filter collinear points, remove points that are close to the line formed by the previous and next points.
 * @param {THREE.Vector3[]} points - The points to filter
 * @param {boolean} [isOpen=false] - Whether the point sequence is an open chain (endpoints always kept)
 * @returns {THREE.Vector3[]} The filtered points
 */
const filterCollinearPoints = (points, isOpen = false) => {
  if (!points || points.length === 0) {
    return points;
  }

  const filteredPoints = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    if (isOpen && (i === 0 || i === n - 1)) {// keep endpoints of open chains
      filteredPoints.push(points[i]);
      continue;
    }
    const previousPoint = points[(i - 1 + n) % n];
    const currentPoint = points[i];
    const nextPoint = points[(i + 1) % n];
    const previousVector = previousPoint.clone().sub(currentPoint);
    const nextVector = currentPoint.clone().sub(nextPoint);
    const crossProduct = new THREE.Vector3().crossVectors(previousVector, nextVector);
    if (crossProduct.length() > _src_measurement_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_0__.EPSILON) {
      filteredPoints.push(currentPoint);
    }
  }
  if (filteredPoints.length < 3) {
    return points;
  }

  return filteredPoints;
};

/**
 * Detects if a loop has crease angles indicating a compound shape.
 * Returns an array of vertex loops - one loop for simple shapes, multiple loops for compound shapes.
 * @param {THREE.Vector3[]} vertices - The vertices of the loop
 * @returns {THREE.Vector3[][]} Array of vertex loops (single element for simple shapes)
 */
function detectAndSplitCompoundLoop(vertices) {
  if (vertices.length < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MIN_CIRCLE_EDGES) {
    return [vertices]; // Too few vertices to be compound
  }
  // Check if this loop has significant crease angles (direction changes)
  const creaseIndices = [];

  for (let i = 0; i < vertices.length; i++) {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];

    // Calculate vectors
    const v1 = curr.clone().sub(prev).normalize();
    const v2 = next.clone().sub(curr).normalize();

    // Calculate angle between vectors
    const angle = v1.angleTo(v2);
    const interiorAngle = Math.PI - angle;

    // If the interior angle is outside curve continuity tolerance,
    // we treat it as a crease indicating a compound shape.
    if (interiorAngle < _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MIN_CURVE_ANGLE || interiorAngle > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_CURVE_ANGLE) {
      creaseIndices.push(i);
    }
  }

  // If no creases found, it's a simple shape
  if (creaseIndices.length === 0) {
    return [vertices];
  }

  // Split the loop at crease points into separate vertex segments
  const segments = [];
  for (let i = 0; i < creaseIndices.length; i++) {
    const startIdx = creaseIndices[i];
    const endIdx = creaseIndices[(i + 1) % creaseIndices.length];

    const segment = [];
    let idx = startIdx;
    while (idx !== endIdx) {
      segment.push(vertices[idx]);
      idx = (idx + 1) % vertices.length;
    }
    segment.push(vertices[endIdx]); // Include the end vertex

    if (segment.length >= 2) {
      segments.push(segment);
    }
  }

  return segments.length > 0 ? segments : [vertices];
}

/**
 * Extracts surface geometry data from a pick result
 * @param {Object} pick - The pick result containing surface information
 * @param {Object} viewer - The viewer instance
 * @returns {Object|null} Surface data with geometry and normal information
 */
function extractSurfaceData(pick, viewer) {
  if (typeof pick.fragId !== 'number' || !pick.originalFace || typeof pick.originalFace.faceIndex !== 'number') {
    return null;
  }

  const face = pick.geomFace;
  const faceNormal = pick.faceNormal;
  const intersectPoint = pick.intersectPoint;
  const fragId = pick.fragId;
  const modelId = pick.modelId;

  if (!face?.vertices || face.vertices.length < 3) {
    return null;
  }

  const fragmentList = viewer.model.getFragmentList();
  const fragmentGeometry = fragmentList.getGeometry(fragId);

  // Bail without a result on missing geometry or non-indexed meshes; the rest of the
  // pipeline assumes an index buffer.
  if (!fragmentGeometry || !fragmentGeometry.ib) {
    return null;
  }

  // Above the cap we silently skip — the surface tool is interactive and the BFS+weld
  // cost on huge meshes (e.g. monolithic Revit shells) makes hover unresponsive.
  // Known UX gap: the user gets no feedback that the click was ignored.
  if (fragmentGeometry.ib.length > _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.MAX_SURFACE_INDEX_BUFFER) {
    return null;
  }

  const dstMatrix = new THREE.Matrix4();
  fragmentList.getWorldMatrix(fragId, dstMatrix);

  let orderedBoundaryEdges = [];
  let openFlags = [];
  let filteredBoundaryVerticesWorld = [];
  let isSurfaceCurved = false;

  const startTriangleIndex = pick.originalFace.faceIndex * 3;
  const { boundaryEdges, isSurfaceCurved: curved } =
  getFaceBoundaries(fragmentGeometry, startTriangleIndex, _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.CREASE_ANGLE_RADIANS, dstMatrix);

  isSurfaceCurved = curved;
  const canonOf = getCanonOf(fragmentGeometry);
  const result = buildBoundaryLoops(fragmentGeometry, boundaryEdges, canonOf);
  orderedBoundaryEdges = result.loops;
  openFlags = result.openFlags;

  // Compact rolling hash of sorted boundary indices — avoids unbounded string length.
  const allVertexIndices = orderedBoundaryEdges.flat().sort((a, b) => a - b);
  let vertexHash = allVertexIndices.length;
  for (let i = 0; i < allVertexIndices.length; i++) {
    vertexHash = Math.imul(vertexHash, 31) + allVertexIndices[i] >>> 0;
  }
  const surfaceId = `${modelId}-${fragId}-${vertexHash.toString(36)}`;

  const boundaryVerticesWorld = convertBoundaryEdgesToWorldVertices(orderedBoundaryEdges, fragmentGeometry, dstMatrix);

  // Curved surfaces have no closed-form area from the boundary alone; we report null and
  // let callers (e.g. UI labels) decide how to communicate that.
  const closedLoopAreas = [];
  let largestArea = null;
  for (let i = 0; i < boundaryVerticesWorld.length; i++) {
    const isOpen = openFlags[i];
    const filteredLoopVertices = filterCollinearPoints(boundaryVerticesWorld[i], isOpen);
    filteredBoundaryVerticesWorld.push(filteredLoopVertices);
    if (!isSurfaceCurved && !isOpen) {// open loops have no well-defined area
      const area = calculateSurfaceArea(filteredLoopVertices);
      closedLoopAreas.push(area);
    }
  }
  // Outer-vs-inner loop heuristic: assume the largest closed loop is the outer boundary
  // and the rest are holes, then subtract holes from the outer area. Known limitations:
  //   - calculateSurfaceArea is unsigned (vector area magnitude), so we cannot tell hole
  //     orientation from CCW/CW. Faces with multiple disjoint outer loops in the same plane
  //     would over-subtract.
  //   - Holes that geometrically overlap each other would also over-subtract.
  // Acceptable for typical Revit/CAD faces (one outer loop + 0..N holes).
  if (!isSurfaceCurved) {
    closedLoopAreas.sort((a, b) => b - a);
    largestArea = closedLoopAreas[0];
    for (let i = 1; i < closedLoopAreas.length; i++) {
      largestArea -= closedLoopAreas[i];
    }
  }

  const detectedShapes = [];
  for (let i = 0; i < filteredBoundaryVerticesWorld.length; i++) {
    const vertices = filteredBoundaryVerticesWorld[i];
    const isOpen = openFlags[i];

    if (isOpen) {
      // Skip detectAndSplitCompoundLoop — its wrap-around indexing treats the virtual
      // closing edge as real, producing spurious lines on open chains.
      for (const shape of detectShape(vertices, false)) {
        detectedShapes.push(shape);
      }
    } else {
      const groupsOfVertexSegments = detectAndSplitCompoundLoop(vertices);
      const isClosedLoop = groupsOfVertexSegments.length === 1;
      for (const segment of groupsOfVertexSegments) {
        for (const shape of detectShape(segment, isClosedLoop)) {
          detectedShapes.push(shape);
        }
      }
    }
  }

  // Two concentric circles → cylinder/cone face: synthesize a HEIGHT shape so the UI
  // can label the axial distance between the caps.
  if (detectedShapes.length === 2 &&
  detectedShapes[0].type === _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.CIRCLE &&
  detectedShapes[1].type === _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.CIRCLE) {
    const centroid0 = detectedShapes[0].centroid;
    const centroid1 = detectedShapes[1].centroid;
    detectedShapes.push({
      type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.HEIGHT,
      centroid: (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__.getCentroid)([centroid0, centroid1]),
      vertices: [centroid0, centroid1],
      perimeter: centroid0.distanceTo(centroid1),
      start: centroid0,
      end: centroid1,
      isClosed: false
    });
  }

  return {
    surfaceId,
    vertices: filteredBoundaryVerticesWorld,
    openLoops: openFlags,
    normal: faceNormal,
    intersectPoint,
    area: isSurfaceCurved ? null : largestArea,
    boundaryEdges: orderedBoundaryEdges,
    boundaryVerticesWorld: filteredBoundaryVerticesWorld,
    detectedShapes,
    isSurfaceCurved
  };
}

/**
 * Detects a shape from a list of vertices. The supported shapes are: circle, ellipse, circular arc, simple curve, rectangle.
 * @param {THREE.Vector3[]} vertices - The vertices of the shape
 * @param {Object} [options] - Detection options
 * @param {boolean} [isClosedLoop] - Whether the vertices represent a closed loop
 * @returns {Object} The detected shape
 */
function detectShape(vertices, isClosedLoop) {
  if (vertices?.length < 2) {
    return [];
  }
  // if the shape has only 2 vertices, it is a line.
  if (vertices.length < 3) {
    return [{ type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.LINE, vertices, isClosed: false }];
  }

  if (isClosedLoop) {
    const circle = (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__.detectCircleFromLoop)(vertices);
    if (circle) {
      circle.isClosed = true;
      return [circle];
    }
    const ellipse = (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__.detectEllipseFromLoop)(vertices);
    if (ellipse) {
      ellipse.isClosed = true;
      return [ellipse];
    }
    // Not a circle/ellipse: decompose into arc/line primitives. `detectCurvesAndLines`
    // expects an open polyline, so close a loop by repeating the first vertex at the end.
    const chain = [...vertices, vertices[0]];
    const curvesAndLines = (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__.detectCurvesAndLines)(chain);
    if (curvesAndLines.length > 0) {
      // All-line closed chains fold back to a single POLYGON: a flat rectangular
      // face should render as one shape with a perimeter label, not N per-edge
      // length labels. Any arc/curve in the decomposition breaks the fold — those
      // genuinely have per-segment geometry worth surfacing individually.
      const allLines = curvesAndLines.every((s) => s.type === _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.LINE);
      if (allLines) {
        return [{ type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.POLYGON, vertices, isClosed: true }];
      }
      curvesAndLines.forEach((s) => {s.isClosed = false;});
      return curvesAndLines;
    }
  } else {
    const curvesAndLines = (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_1__.detectCurvesAndLines)(vertices);
    if (curvesAndLines.length > 0) {
      curvesAndLines.forEach((s) => {s.isClosed = false;});
      return curvesAndLines;
    }
  }

  // if no other shape is detected, consider it a polygon.
  return [{ type: _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_2__.SHAPE_TYPES.POLYGON, vertices, isClosed: isClosedLoop }];
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SurfaceMeasureTool.js"
/*!**************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SurfaceMeasureTool.js ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SurfaceMeasureTool: () => (/* binding */ SurfaceMeasureTool)
/* harmony export */ });
/* harmony import */ var _SurfaceToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SurfaceToolIndicator.js */ "./extensions/Measure/CustomTools/SurfaceToolIndicator.js");
/* harmony import */ var _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../src/measurement/Measurement.js */ "./src/measurement/Measurement.js");
/* harmony import */ var _MeasureTool_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../MeasureTool.js */ "./extensions/Measure/MeasureTool.js");
/* harmony import */ var _HighlightManager_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./HighlightManager.js */ "./extensions/Measure/CustomTools/HighlightManager.js");
/* harmony import */ var _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./MeasureConstants.js */ "./extensions/Measure/CustomTools/MeasureConstants.js");






const av = Autodesk.Viewing;
const MeasureCommon = av.MeasureCommon;

const FRAGMENT_HIGHLIGHT_OVERLAY = "measure-surface-highlight";
// very high precision radius for surface measurements to eliminate other snapper types
const SURFACE_PRECISION_RADIUS = 0.001;

/**
 * Custom measurement tool for surface measurements.
 * Implements the CustomMeasureTool interface to provide surface-specific functionality.
 */
class SurfaceMeasureTool {
  constructor(viewer, snapper, sharedMeasureConfig, measureTool) {
    this.viewer = viewer;
    this.snapper = snapper;
    this.sharedMeasureConfig = sharedMeasureConfig;
    this.measureTool = measureTool;

    // Surface-specific state
    this.highlightManager = new _HighlightManager_js__WEBPACK_IMPORTED_MODULE_3__.HighlightManager(viewer, FRAGMENT_HIGHLIGHT_OVERLAY, { color: 0xffffff, emissive: 0xffffff });
    // Tracks the committed surface measurement created/restored via this custom tool.
    // This lets callers interact with the committed indicator without reaching into MeasureTool internals.
    this.measurement = null;
    this.measurementPreview = null;
    this.noMeasurementPossible = false;

    // Store original detectRadiusInPixels value for restoration
    this.originalDetectRadiusInPixels = null;

    // Cache for optimization - avoid recompute/re-render when hovering over same surface
    this.lastCachedPreviewKey = null;
    this.lastCachedSurfaceId = null;
    this.lastShapeCount = 0;
    this.lastSurfaceCheckKey = null;
    this.lastSurfaceCheckResult = null;
  }

  /**
   *
   * @param {Object} snapResult - The snap result to get the surface check key for.
   * @returns {string|null} The surface check key.
   */
  #getSurfaceCheckKey(snapResult) {
    const faceIndex = snapResult.originalFace?.faceIndex;
    const fragId = snapResult.fragId;
    const modelId = snapResult.modelId;
    if (typeof fragId !== 'number' || typeof faceIndex !== 'number') {
      return null;
    }
    return `${modelId}-${fragId}-${faceIndex}`;
  }

  /**
   * Validates if a surface measurement is possible at the given snap result.
   * @param {Object} snapResult - The snap result to validate
   * @returns {{possible: boolean, surfaceId?: string}} An object indicating if measurement is possible and the surfaceId.
   */
  isSurfaceMeasurementPossible(snapResult) {
    if (!snapResult || snapResult.geomType !== MeasureCommon.SnapType.SNAP_FACE) {
      return { possible: false };
    }

    const checkKey = this.#getSurfaceCheckKey(snapResult);
    if (checkKey && checkKey === this.lastSurfaceCheckKey && this.lastSurfaceCheckResult) {
      return this.lastSurfaceCheckResult;
    }

    // Create a temporary measurement to test if valid results can be computed
    const tempMeasurement = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE, 'temp');
    tempMeasurement.setPick(1, snapResult);
    const hasResult = tempMeasurement.computeResult(tempMeasurement.picks, this.viewer, this.snapper);

    if (!hasResult) {
      const result = { possible: false };
      this.lastSurfaceCheckKey = checkKey;
      this.lastSurfaceCheckResult = result;
      return result;
    }

    const surfaceResult = tempMeasurement.result;

    // Check for duplicate measurements
    const surfaceId = surfaceResult?.surfaceData?.surfaceId;
    if (surfaceId) {
      const existingMeasurements = this.measureTool.getMeasurementList();
      for (let i = 0; i < existingMeasurements.length; i++) {
        const measurement = existingMeasurements[i];
        if (measurement.surfaceData && measurement.surfaceData.surfaceId === surfaceId) {
          return { possible: false }; // Found a duplicate
        }
      }
    }

    const possible = surfaceResult && surfaceResult.surfaceData && surfaceResult.surfaceProperties;

    const result = { possible, surfaceId };
    this.lastSurfaceCheckKey = checkKey;
    this.lastSurfaceCheckResult = result;
    return result;
  }

  // CustomMeasureTool interface implementation
  createMeasurement(measureData) {
    // If we are creating a new measurement (not restoring from session),
    // we need to delete any existing surface measurement (VIZX-3950).
    if (!measureData) {
      const measureTool = this.measureTool;
      const measurementsManager = measureTool?.getMeasurementsManager();
      const measurementsList = measurementsManager?.measurementsList;
      if (measurementsList) {
        Object.values(measurementsList).forEach((m) => {
          // Check if it's a Surface measurement
          if (m.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE) {
            // Measure tool allows deleting only current measurement, so this is what we do.
            measureTool.selectMeasurementById(m.id);
            measureTool.deleteCurrentMeasurement();
          }
        });
      }
    }
    const measurement = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE, measureData?.id);

    // Restore measurement from session data such as units and precision
    if (measureData) {
      measurement.options = measureData.options;
      measurement.surfaceData = measureData.surfaceData;
      measurement.surfaceProperties = measureData.surfaceProperties;
    }

    // Keep a reference to the committed measurement for label/indicator APIs.
    this.measurement = measurement;
    return measurement;
  }

  // Public API for callers that want to show/hide labels without accessing MeasureTool internals.
  showAreaLabel() {
    this.measurement?.indicator?.updateAreaLabel?.();
  }

  hideAreaLabel() {
    this.measurement?.indicator?.hideAreaLabel?.();
  }

  getIndicatorClass() {
    return _SurfaceToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.SurfaceToolIndicator;
  }

  saveSessionMeasurement(measurement, listEntry) {
    // Add surface-specific data to session storage if needed
    if (measurement.surfaceData) {
      listEntry.surfaceData = measurement.surfaceData;
    }
    if (measurement.surfaceProperties) {
      listEntry.surfaceProperties = measurement.surfaceProperties;
    }
  }

  applyOffsetToVector3(vector3, globalOffset) {
    if (vector3 && globalOffset) {
      return new THREE.Vector3(vector3.x, vector3.y, vector3.z).add(globalOffset);
    }
    return vector3;
  }

  /**
   * Prepares surface-specific pick data for measurements.
   * This method adds surface data and properties to the pick data.
   * @param {Object} measurement - The surface measurement
   * @param {Object} pickData - The pick data object to modify
   * @param {Object} pick - The original pick/snap result
   * @param {Object} globalOffset - The global offset to apply to spatial coordinates
   */
  preparePickData(measurement, pickData, pick, globalOffset) {
    if (measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE) {
      pickData.faceNormal = pick.faceNormal;

      // Apply globalOffset to surface data if it exists
      const surfaceData = measurement.surfaceData;
      if (surfaceData && globalOffset) {
        // Deep clone to avoid modifying the original measurement.
        const newSurfaceData = JSON.parse(JSON.stringify(surfaceData));
        if (newSurfaceData.vertices) {
          newSurfaceData.vertices = newSurfaceData.vertices.map((polygon) =>
          polygon.map((vertex) =>
          new THREE.Vector3(vertex.x, vertex.y, vertex.z).add(globalOffset)
          )
          );
        }

        if (newSurfaceData.detectedShapes) {
          newSurfaceData.detectedShapes.forEach((shape) => {
            if (shape.centroid) {
              shape.centroid = this.applyOffsetToVector3(shape.centroid, globalOffset);
            }
            if (shape.vertices) {
              shape.vertices = shape.vertices.map((v) =>
              this.applyOffsetToVector3(v, globalOffset)
              );
            }
            if (shape.start) {
              shape.start = this.applyOffsetToVector3(shape.start, globalOffset);
            }
            if (shape.end) {
              shape.end = this.applyOffsetToVector3(shape.end, globalOffset);
            }
          });
        }
        pickData.surfaceData = newSurfaceData;
      } else {
        pickData.surfaceData = surfaceData;
      }
      pickData.surfaceProperties = measurement.surfaceProperties;
    }
  }

  _clearPreviewCache() {
    this.lastCachedPreviewKey = null;
    this.lastCachedSurfaceId = null;
    this.lastShapeCount = 0;
  }

  updateMeasurementPreview(snapResult) {
    if (!snapResult) {
      if (this.measurementPreview?.indicator) {
        this.measurementPreview.indicator.clear();
      }
      this.noMeasurementPossible = false;
      this._clearPreviewCache();
      return;
    }

    const { possible, surfaceId } = this.isSurfaceMeasurementPossible(snapResult);
    if (!possible) {
      // Clear preview and show red X
      if (this.measurementPreview?.indicator) {
        this.measurementPreview.indicator.clear();
      }

      this.snapper.indicator.clearOverlays();
      const noMeasurementSnapResult = snapResult.clone();
      noMeasurementSnapResult.geomType = MeasureCommon.SnapType.SNAP_NO_MEASUREMENT;
      this.snapper.indicator.renderIndicator(noMeasurementSnapResult);

      this.noMeasurementPossible = true;
      this._clearPreviewCache();
      return;
    }

    this.noMeasurementPossible = false;

    const faceKey = this.#getSurfaceCheckKey(snapResult);

    // Reuse the cached preview when the surface is unchanged. For surfaces above
    // MAX_SURFACE_DIMENSIONS the visible subset depends on the hover anchor, so
    // the face/anchor key must also match before we can skip the redraw.
    if (surfaceId && surfaceId === this.lastCachedSurfaceId) {
      if (this.lastShapeCount <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_4__.MAX_SURFACE_DIMENSIONS) {
        return;
      }
      if (faceKey && faceKey === this.lastCachedPreviewKey) {
        return;
      }
    }

    if (!this.measurementPreview) {
      this.measurementPreview = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_1__.Measurement(MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE, 'measurementPreview');
      this.measurementPreview.attachIndicator(this.viewer, this.measureTool, _SurfaceToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.SurfaceToolIndicator);
    }

    // Render the preview
    this.measurementPreview.setPick(1, snapResult);
    this.measurementPreview.computeResult(this.measurementPreview.picks, this.viewer, this.snapper);
    this.measurementPreview.indicator.render(this.measurementPreview.picks, true);

    // Make sure the pointer label is always on top
    const indicator = this.measurementPreview.indicator;
    if (indicator.spotLabel && indicator.spotLabel.label) {
      indicator.spotLabel.label.id = 'measurement-preview-pointer-label';
      indicator.spotLabel.label.style.zIndex = 4;
    }
    if (indicator.endpoints[1] && indicator.endpoints[1].label) {
      indicator.endpoints[1].label.id = 'measure-pointer-label';
    }

    // Remove things we don't want to see on a preview
    indicator.clearSelectionAreas();
    indicator.hideEndpoints();
    indicator.clearSpotMesh();

    // Update cache
    this.lastCachedSurfaceId = surfaceId ?? null;
    this.lastShapeCount = this.measurementPreview.result?.surfaceData?.detectedShapes?.length ?? 0;
    this.lastCachedPreviewKey = faceKey ?? null;
  }

  getMeasurementName() {
    return 'Surface';
  }

  /**
   * Maps string representation to surface measurement type.
   * This method supports the measurement restoration process.
   * @param {string} measureTypeString - The string representation of the measurement type
   * @returns {string|null} The measurement type constant or null if not a surface measurement
   */
  getMeasurementTypeFromString(measureTypeString) {
    if (measureTypeString === 'Surface') {
      return MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE;
    }
    return null;
  }

  getSnapper() {
    return this.snapper;
  }

  handleButtonUp(event, button) {
    // Stub implementation for SurfaceMeasureTool
    // This is needed by MeasureToolIndicator but not used in surface measurement context
    return false;
  }

  handleSingleClick() {
    return true;
  }

  // TODO: remove this method if possible
  hoverMeasurementById() {
    this.clearPreview();
    this.snapper.indicator.clearOverlays();
  }

  getActivePointIndex() {
    // For surface measurements, always return 1 since they are single-click measurements
    return 1;
  }

  getDistanceAux(measurementDistance, viewportUnits) {
    return (0,_MeasureTool_js__WEBPACK_IMPORTED_MODULE_2__.getDistanceAux)(this.viewer, this.sharedMeasureConfig, measurementDistance, viewportUnits);
  }

  getArea(measurementArea) {
    return (0,_MeasureTool_js__WEBPACK_IMPORTED_MODULE_2__.getArea)(this.viewer, this.sharedMeasureConfig, measurementArea);
  }

  areAllPicksSet() {
    // For surface measurement previews, always return false since they are just previews
    // Real surface measurements are handled by the main MeasureTool
    return false;
  }

  activate() {
    // Set surface-specific snap filter when tool is activated
    this.snapper.setSnapFilter((snapResult) => {
      // If it's not a face, convert it to SNAP_NO_MEASUREMENT
      if (snapResult.geomType !== MeasureCommon.SnapType.SNAP_FACE) {
        snapResult.geomType = MeasureCommon.SnapType.SNAP_NO_MEASUREMENT;
      }
      return true; // Always return true to show the indicator
    });

    // Store the original detectRadiusInPixels value
    this.originalDetectRadiusInPixels = this.snapper.getDetectRadiusInPixels();

    // Set detectRadiusInPixels to 1 for surface tool precision
    this.snapper.setDetectRadiusInPixels(SURFACE_PRECISION_RADIUS);

    // Add camera change event listener to update scale
    this.onCameraChangeBinded = this.onCameraChange.bind(this);
    this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
  }

  deactivate() {
    // Restore original detectRadiusInPixels
    if (this.originalDetectRadiusInPixels !== null) {
      this.snapper.setDetectRadiusInPixels(this.originalDetectRadiusInPixels);
      this.originalDetectRadiusInPixels = null;
    }

    // clear area label if it exists from the view
    this.hideAreaLabel();

    // Clean up when tool is deactivated
    this.snapper.setSnapFilter(null);
    this.highlightManager.dispose();

    // Remove camera change event listener
    if (this.onCameraChangeBinded) {
      this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
      this.onCameraChangeBinded = null;
    }

    if (this.measurementPreview) {
      this.measurementPreview.indicator.clear();
      // hide area label
      this.measurementPreview.indicator.hideAreaLabel?.();
      this.measurementPreview = null;
    }

    this.noMeasurementPossible = false;
    this._clearPreviewCache();
  }

  /**
   * Handles camera change events to update scale for measurement preview.
   * This ensures that surface measurements maintain proper scale relative to camera distance.
   */
  onCameraChange() {
    // Update scale for the measurement preview when camera changes
    if (!this.noMeasurementPossible) {
      this.measurementPreview?.indicator?.updateScale();
    }
  }

  // Additional methods that can be called by the main measure tool
  isNoMeasurementPossible() {
    return this.noMeasurementPossible;
  }

  /**
   * Highlights all targets associated with a surface measurement.
   * This includes targets from measurement end-to-end picks.
   * @param {Object} measurement - The surface measurement object containing picks and surface data
   */
  setMeasurementHighlights(measurement) {
    const targetsToHighlight = [];
    const processedFragIds = [];

    const pick = measurement.picks[1];
    // if the surface is curved, we don't highlight the specific face but we highlight the whole fragment.
    const isSurfaceCurved = measurement.surfaceData?.isSurfaceCurved;
    if (pick && pick.fragId !== undefined && pick.fragId !== null && processedFragIds.indexOf(pick.fragId) === -1) {
      // Get the model for this pick
      let modelId = pick.modelId;
      targetsToHighlight.push({
        fragId: pick.fragId,
        face: isSurfaceCurved ? null : pick.geomFace,
        modelId
      });
      processedFragIds.push(pick.fragId);
    }
    this.highlightManager.setHighlightTargets(targetsToHighlight);
  }

  clearPreview() {
    if (this.measurementPreview) {
      this.measurementPreview.indicator.clear();
    }
    this.noMeasurementPossible = false;
  }

  /**
   * Clears fragment highlights. Called by MeasureTool on delete/deselect.
   */
  clearFragmentHighlights() {
    this.highlightManager.clearHighlights();
  }

  /**
   * Handles endpoint editing for surface measurements.
   * This method is called when a surface measurement endpoint is dragged/edited.
   * It ensures that surface data and properties are recalculated for the new pick position.
   * @param {Object} measurement - The surface measurement being edited
   * @param {Object} pick - The updated pick/snap result
   */
  handleEndpointEdit(measurement, pick) {
    // For surface measurements, we need to recalculate surface data and properties
    // when the pick position changes during editing
    // Clear existing surface data from the pick
    // This ensures fresh calculation based on the new position
    delete pick.surfaceData;
    delete pick.surfaceProperties;
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SurfaceToolIndicator.js"
/*!****************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SurfaceToolIndicator.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SurfaceToolIndicator: () => (/* binding */ SurfaceToolIndicator)
/* harmony export */ });
/* harmony import */ var _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../MeasureToolIndicator.js */ "./extensions/Measure/MeasureToolIndicator.js");
/* harmony import */ var _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MeasureConstants.js */ "./extensions/Measure/CustomTools/MeasureConstants.js");
/* harmony import */ var _SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SurfaceEdgeDetectionUtils.js */ "./extensions/Measure/CustomTools/SurfaceEdgeDetectionUtils.js");
/* harmony import */ var _InfoPopup_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../InfoPopup.js */ "./extensions/Measure/InfoPopup.js");





const av = Autodesk.Viewing;
const MeasureCommon = av.MeasureCommon;

/** Color values should match Measure.css **/
const DEFAULT_LINE_COLOR = '009bea';
/*******************************************/

const _tipHeight = 2;
const _tipWidth = 3;

// Label positioning constants
const LABEL_OVERLAP_MARGIN = 1.1; // Margin factor to prevent label overlap

// ============================================================================
// SurfaceToolIndicator Class
// ============================================================================

/**
 * Indicator for surface measurements, handles rendering and label management
 * for surface-based measurements including circles, ellipses, and polygons.
 *
 * Dimensions pipeline: `_buildDimensions` → `_selectVisibleDimensions` → `_renderDimension`.
 * Each Dimension owns its segments, tip points, parameter lines, and label so the
 * three are always rendered together or not at all.
 *
 * @extends MeasureToolIndicator
 */
class SurfaceToolIndicator extends _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_0__.MeasureToolIndicator {
  /**
   * @param {Autodesk.Viewing.Viewer3D} viewer - The viewer instance
   * @param {Object} measurement - The measurement object
   * @param {Object} measureTool - The measure tool instance
   */
  constructor(viewer, measurement, measureTool) {
    super(viewer, measurement, measureTool);

    // Reused across every dimension in a render pass — creating it per tip/param-line
    // allocates hundreds of materials per hover on dense surfaces.
    this._dimensionMaterial = this._createLineMaterial(DEFAULT_LINE_COLOR);

    this.segmentLabels = [];
    this.parameterLabels = [];
  }

  /**
   * Returns the centroid for a shape, falling back to averaging vertices.
   *
   * @private
   * @param {Object} shape
   * @returns {THREE.Vector3|null}
   */
  _getShapeCentroid(shape) {
    if (shape?.centroid) {
      return shape.centroid;
    }

    const vertices = shape?.vertices;
    if (!vertices?.length) {
      return null;
    }

    return (0,_SurfaceEdgeDetectionUtils_js__WEBPACK_IMPORTED_MODULE_2__.getCentroid)(vertices);
  }

  // ------------------------------------------------------------------------
  // Dimensions pipeline: build → select → render
  // ------------------------------------------------------------------------

  /**
   * Builds a flat list of Dimension descriptors from detected shapes.
   * Each Dimension owns everything needed to render a complete measurement
   * (boundary segments, end-cap tips, parameter lines, label spec), so the
   * render loop can emit them atomically.
   *
   * @private
   * @param {Object} surfaceData
   * @returns {Array<Object>} dimensions
   */
  _buildDimensions(surfaceData) {
    const shapes = surfaceData?.detectedShapes;
    if (!shapes?.length) {
      return [];
    }

    const dimensions = [];
    for (let i = 0; i < shapes.length; i++) {
      const dim = this._buildDimensionForShape(shapes[i], i);
      if (dim) {
        dimensions.push(dim);
      }
    }
    return dimensions;
  }

  /**
   * Produces a Dimension descriptor for one shape.
   *
   * @private
   * @param {Object} shape
   * @param {number} shapeIndex
   * @returns {Object|null}
   */
  _buildDimensionForShape(shape, shapeIndex) {
    if (!shape?.type) {
      return null;
    }

    const dimension = {
      shapeIndex,
      shape,
      type: shape.type,
      centroid: this._getShapeCentroid(shape),
      segments: [], // Array<[THREE.Vector3, THREE.Vector3]>
      tipPoints: [], // Array<{ point: Vector3, direction: Vector3 }>
      parameterLines: [] // Array<{ key, p1, p2 }>
    };

    // Boundary segments + perpendicular end-caps.
    // HEIGHT has no boundary of its own — its line is a parameter line.
    const vertices = shape.vertices;
    if (vertices && vertices.length >= 2 && shape.type !== _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.HEIGHT) {
      const isClosed = !!shape.isClosed;
      const segmentCount = isClosed ? vertices.length : vertices.length - 1;
      for (let i = 0; i < segmentCount; i++) {
        dimension.segments.push([vertices[i], vertices[(i + 1) % vertices.length]]);
      }

      if (this._shapeNeedsTips(shape.type)) {
        // Tip directions point inward (endpoint → next interior vertex) so they
        // visually terminate the open chain.
        const first = vertices[0];
        const last = vertices[vertices.length - 1];
        const startDir = new THREE.Vector3().subVectors(vertices[1], first).normalize();
        const endDir = new THREE.Vector3().subVectors(vertices[vertices.length - 2], last).normalize();
        dimension.tipPoints.push({ point: first, direction: startDir });
        dimension.tipPoints.push({ point: last, direction: endDir });
      }
    }

    dimension.parameterLines = this._buildParameterLines(shape, shapeIndex);
    return dimension;
  }

  /**
   * Builds parameter lines (diameter / axes / height) for typed shapes.
   * These are drawn via `drawXYZLine` and carry their own tips.
   *
   * @private
   * @param {Object} shape
   * @param {number} shapeIndex
   * @returns {Array<{key: string, p1: THREE.Vector3, p2: THREE.Vector3}>}
   */
  _buildParameterLines(shape, shapeIndex) {
    switch (shape.type) {
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCLE:{
          const { centroid, radius, vertices } = shape;
          if (!centroid || radius === undefined) {
            return [];
          }
          const direction = vertices?.length >= 2 ?
          new THREE.Vector3().subVectors(vertices[0], centroid).normalize() :
          new THREE.Vector3(1, 0, 0);
          const centroidVec = new THREE.Vector3(centroid.x, centroid.y, centroid.z);
          return [{
            key: `shape_${shapeIndex}_diameter`,
            p1: centroidVec.clone().sub(direction.clone().multiplyScalar(radius)),
            p2: centroidVec.clone().add(direction.clone().multiplyScalar(radius))
          }];
        }
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.ELLIPSE:{
          const { centroid, majorAxis, minorAxis, a, b } = shape;
          if (!centroid || !majorAxis || !minorAxis) {
            return [];
          }
          const centroidVec = new THREE.Vector3(centroid.x, centroid.y, centroid.z);
          return [
          {
            key: `shape_${shapeIndex}_major`,
            p1: centroidVec.clone(),
            p2: centroidVec.clone().add(
              new THREE.Vector3(majorAxis.x, majorAxis.y, majorAxis.z).multiplyScalar(a)
            )
          },
          {
            key: `shape_${shapeIndex}_minor`,
            p1: centroidVec.clone(),
            p2: centroidVec.clone().add(
              new THREE.Vector3(minorAxis.x, minorAxis.y, minorAxis.z).multiplyScalar(b)
            )
          }];

        }
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.HEIGHT:{
          const { start, end } = shape;
          if (!start || !end) {
            return [];
          }
          return [{ key: `shape_${shapeIndex}_height`, p1: start, p2: end }];
        }
      default:
        return [];
    }
  }

  /**
   * Selects dimensions to render: the nearest MAX_SURFACE_DIMENSIONS to the anchor.
   *
   * Mirrors elephant's `DimensionTool3D::keepNearest` — ranks by the *minimum* distance
   * from the anchor to any vertex of the dimension's rendered geometry, not by centroid.
   * This keeps long outline polylines in the cluster near the click instead of losing
   * them to short internal segments whose centroids happen to be closer.
   *
   * @private
   * @param {Array<Object>} dimensions
   * @param {THREE.Vector3|null} anchor - intersect point used for distance ranking
   * @returns {Array<Object>}
   */
  _selectVisibleDimensions(dimensions, anchor) {
    if (dimensions.length <= _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MAX_SURFACE_DIMENSIONS) {
      return dimensions;
    }
    if (!anchor) {
      return dimensions.slice(0, _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MAX_SURFACE_DIMENSIONS);
    }

    const ranked = dimensions.map((dim, index) => ({
      dim,
      index,
      distSq: this._minDistSqFromDimToAnchor(dim, anchor)
    }));

    ranked.sort((a, b) => {
      if (a.distSq === b.distSq) {
        return a.index - b.index;
      }
      return a.distSq - b.distSq;
    });

    return ranked.slice(0, _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.MAX_SURFACE_DIMENSIONS).map((entry) => entry.dim);
  }

  /**
   * Minimum squared distance from the anchor to any point of the dimension's renderable
   * geometry (segment endpoints + parameter line endpoints). Falls back to centroid
   * distance if no geometry points exist.
   *
   * @private
   */
  _minDistSqFromDimToAnchor(dim, anchor) {
    let min = Number.POSITIVE_INFINITY;
    const check = (p) => {
      if (!p || typeof p.distanceToSquared !== 'function') return;
      const d = p.distanceToSquared(anchor);
      if (d < min) min = d;
    };
    for (const [p1, p2] of dim.segments) {
      check(p1);
      check(p2);
    }
    for (const pl of dim.parameterLines) {
      check(pl.p1);
      check(pl.p2);
    }
    if (min === Number.POSITIVE_INFINITY) {
      check(dim.centroid);
    }
    return min;
  }

  /**
   * Renders a single dimension as an atomic unit: boundary segments, end-cap
   * tips, parameter lines, and label. Either all parts render or none do.
   *
   * @private
   * @param {Object} dim
   */
  _renderDimension(dim) {
    for (const [p1, p2] of dim.segments) {
      super.drawSegmentAndPush(p1, p2);
    }

    if (dim.tipPoints.length) {
      this.shapeTips = this.shapeTips || [];
      for (const { point, direction } of dim.tipPoints) {
        this.shapeTips.push(this._drawShapeTip(point, direction, this._dimensionMaterial));
      }
    }

    for (const paramLine of dim.parameterLines) {
      const lineItem = this.lines[paramLine.key] || { material: this._dimensionMaterial };
      lineItem.p1 = paramLine.p1;
      lineItem.p2 = paramLine.p2;
      lineItem.line = null;
      this.drawXYZLine(lineItem);
      this.lines[paramLine.key] = lineItem;
    }

    this._createDimensionLabel(dim);
  }

  /**
   * Orchestrates surface rendering: builds dimensions, selects visible ones,
   * and renders each atomically.
   *
   * Caller is responsible for ensuring the overlay is clean before calling
   * (preview indicators are fresh; committed/scale/results paths call `clear()`).
   *
   * @private
   * @param {Object} surfaceData
   */
  _renderSurface(surfaceData) {
    if (!surfaceData) {
      return;
    }

    this._cleanupLabels(this.segmentLabels);
    this._cleanupLabels(this.parameterLabels);
    this.segmentLabels = [];
    this.parameterLabels = [];

    const dimensions = this._buildDimensions(surfaceData);
    const visible = this._selectVisibleDimensions(dimensions, surfaceData.intersectPoint);

    for (const dim of visible) {
      this._renderDimension(dim);
    }

    this.segmentLabels.forEach((label) => this.showLabel(label));
    this.parameterLabels.forEach((label) => this.showLabel(label));
  }

  /**
   * Dispatches label creation based on dimension type.
   *
   * @private
   * @param {Object} dim
   */
  _createDimensionLabel(dim) {
    const { shape, type } = dim;
    const vertices = shape.vertices;

    switch (type) {
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCLE:
        this.createCircleLabel(vertices, shape);
        break;
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.ELLIPSE:
        this.createEllipseLabel(vertices, shape);
        break;
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.SIMPLE_CURVE:
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCULAR_ARC:
        this.createCircularArcLabel(vertices, shape);
        break;
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.LINE:
        this.createLineLabel(vertices[0], vertices[1]);
        break;
      case _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.HEIGHT:
        this.createHeightLabel(shape);
        break;
      default:
        this.createGenericLabel(vertices);
        break;
    }
  }

  // ------------------------------------------------------------------------
  // Render entry points
  // ------------------------------------------------------------------------

  /**
   * Renders surface measurement from picked positions (preview / hover path).
   *
   * @param {Object} pickPositions - Object containing intersection, surfaceData, surfaceProperties, faceNormal
   */
  renderSurfaceMeasurementFromPoints(pickPositions) {
    const { intersection, surfaceData, surfaceProperties } = pickPositions;

    if (!intersection || !surfaceData) {
      return;
    }

    this.measurement.surfaceData = surfaceData;
    this.measurement.surfaceProperties = surfaceProperties;

    // Draw any parent XYZ line carried on surfaceData (no-op unless p1/p2 present).
    this.drawXYZLine(surfaceData);

    this._renderSurface(surfaceData);
  }

  /**
   * Renders surface measurement from picks array (committed / rubber-band path).
   *
   * @param {Array} picks - Array of pick results
   */
  renderSurfaceMeasurement(picks) {
    const userPick = picks[1];
    if (!userPick) {
      return;
    }

    const start = MeasureCommon.getSnapResultPosition(userPick, this.viewer);
    const normal = userPick.faceNormal;
    if (!start || !normal) {
      return;
    }

    const { surfaceData } = this.measurement;
    if (!surfaceData) {
      return;
    }

    this._renderSurface(surfaceData);
  }

  // ------------------------------------------------------------------------
  // Tip rendering helpers
  // ------------------------------------------------------------------------

  /**
   * Checks if a shape type requires start/end tips on its boundary.
   * Closed shapes (circle, ellipse) don't need boundary tips.
   * HEIGHT has no boundary segments so no boundary tips either.
   *
   * @private
   * @param {string} shapeType - The shape type from SHAPE_TYPES
   * @returns {boolean} True if shape needs tips
   */
  _shapeNeedsTips(shapeType) {
    return shapeType !== _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCLE &&
    shapeType !== _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.ELLIPSE &&
    shapeType !== _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.HEIGHT;
  }

  /**
   * Draws a single perpendicular tip at a point.
   *
   * @private
   * @param {THREE.Vector3} point - The point to draw the tip at
   * @param {THREE.Vector3} direction - The direction along the edge (for calculating perpendicular)
   * @param {THREE.Material} material - The material to use for the tip
   * @returns {THREE.Mesh} The created tip mesh
   */
  _drawShapeTip(point, direction, material) {
    const scale = this.setScale(point);
    const normal = direction.clone().cross(this.viewer.navigation.getEyeVector()).normalize();

    const tmpPoints = [new THREE.Vector3(), new THREE.Vector3()];
    tmpPoints[0].addVectors(point, normal.clone().multiplyScalar(_tipHeight * scale));
    tmpPoints[1].subVectors(point, normal.clone().multiplyScalar(_tipHeight * scale));

    const geometry = new THREE.BufferGeometry().setFromPoints(tmpPoints);
    const tip = this.drawLineAsCylinder(geometry, material, _tipWidth, this.overlayName);
    tip.visible = true;

    return tip;
  }

  /**
   * Clears all shape tips from the overlay.
   *
   * @private
   */
  _clearShapeTips() {
    if (this.shapeTips) {
      this.shapeTips.forEach((tip) => {
        this.viewer.impl.removeOverlay(this.overlayName, tip, true);
      });
      this.shapeTips = [];
    }
  }

  // ------------------------------------------------------------------------
  // Label creation helpers
  // ------------------------------------------------------------------------

  /**
   * Updates surface measurement labels with current values.
   */
  updateAreaLabel() {
    const { surfaceProperties } = this.measurement;

    // Hide popup if deselected or surfaceProperties was cleared (e.g. during endpoint edit).
    if (!surfaceProperties || !this.isCurrentlySelected()) {
      this.hideAreaLabel();
      return;
    }

    if (!this._areaInfoPopup) {
      this._areaInfoPopup = new _InfoPopup_js__WEBPACK_IMPORTED_MODULE_3__.InfoPopup(this.viewer.container);
    }

    const areaMeasure = surfaceProperties.area;
    const isAreaValid = Number.isFinite(areaMeasure);
    const areaText = isAreaValid ?
    av.i18n.translate("Total area: ~ %(totalArea)", { totalArea: this.measureTool.getArea(surfaceProperties) }) :
    av.i18n.translate("Can't measure the total area");
    this._areaInfoPopup.setText(areaText);
    this._areaInfoPopup.show();
  }

  createHeightLabel(shapeData) {
    const { centroid, perimeter } = shapeData;
    if (!centroid || !perimeter) {
      return;
    }

    // Create height label
    const heightText = "~ " + this.measureTool.getDistanceAux(perimeter);
    this.createShapeAttributeLabel(centroid, centroid, heightText, 'h');
  }

  /**
   * Creates labels for circle shape (diameter and perimeter).
   *
   * @param {Array} shape - Array of vertices
   * @param {Object} shapeData - Shape data containing radius, perimeter, centroid
   */
  createCircleLabel(shape, shapeData) {
    const { radius, perimeter, centroid } = shapeData;

    // Create diameter label
    const diameter = 2 * radius;
    const diameterText = "~ " + this.measureTool.getDistanceAux(diameter);
    this.createShapeAttributeLabel(centroid, shape[0], diameterText, '⌀');

    // Create perimeter label
    const perimeterText = "~ " + this.measureTool.getDistanceAux(perimeter);
    this.createCircumferenceLabel(shape[0], perimeterText, 'c');
  }

  /**
   * Creates labels for ellipse shape (major axis, minor axis, and perimeter).
   *
   * @param {Array} shape - Array of vertices
   * @param {Object} shapeData - Shape data containing a, b, perimeter, centroid, axes
   */
  createEllipseLabel(shape, shapeData) {
    const { a, b, perimeter, centroid, majorAxis, minorAxis } = shapeData;

    // Create major axis label
    const majorAxisEndPoint = centroid.clone().add(majorAxis.clone().multiplyScalar(a));
    const majorAxisText = "~ " + this.measureTool.getDistanceAux(a);
    this.createShapeAttributeLabel(centroid, majorAxisEndPoint, majorAxisText, 'a');

    // Create minor axis label
    const minorAxisEndPoint = centroid.clone().add(minorAxis.clone().multiplyScalar(b));
    const minorAxisText = "~ " + this.measureTool.getDistanceAux(b);
    this.createShapeAttributeLabel(centroid, minorAxisEndPoint, minorAxisText, 'b');

    // Create perimeter label
    const perimeterText = "~ " + this.measureTool.getDistanceAux(perimeter);
    this.createCircumferenceLabel(shape[0], perimeterText, 'c');
  }

  /**
   * Creates a label for a line.
   *
   * @param {THREE.Vector3} current - Current vertex
   * @param {THREE.Vector3} next - Next vertex
   */
  createLineLabel(current, next) {
    const distance = next.distanceTo(current);
    const distanceText = "~ " + this.measureTool.getDistanceAux(distance);

    const label = this.createMeasurementLabel();
    this.viewer.container.appendChild(label);
    this._addEventListener(label);
    this.setValueMeasurementLabelText(label, distanceText);

    // Committed pills are clickable; preview pills must stay click-through.
    if (this.measurement?.id !== 'measurementPreview') {
      label.style.pointerEvents = 'auto';
    }

    label.p1 = current.clone();
    label.p2 = next.clone();

    this.segmentLabels.push(label);
  }

  /**
   * Creates labels for generic/unknown shapes (segment distances).
   *
   * @param {Array} shape - Array of vertices
   */
  createGenericLabel(shape) {
    for (let j = 0; j < shape.length; j++) {
      const current = shape[j];
      const next = shape[(j + 1) % shape.length];
      this.createLineLabel(current, next);
    }
  }

  /**
   * Creates a label for shape attributes (diameter, axes, etc).
   *
   * @param {THREE.Vector3} p1 - Start point
   * @param {THREE.Vector3} p2 - End point
   * @param {string} text - Label text
   * @param {string} iconText - Icon text to display
   */
  createShapeAttributeLabel(p1, p2, text, iconText) {
    const label = this.createMeasurementLabel();
    this.viewer.container.appendChild(label);
    this._addEventListener(label);
    this.setValueMeasurementLabelText(label, text);

    label.className = 'measure-label-axis-delta surface measure-label-surface';

    // Override background and color to match 'measure-length' style from Measure.css
    label.style.backgroundColor = '#009bea';
    label.style.color = '#f4f4f4';

    // Committed pills are clickable; preview pills must stay click-through.
    if (this.measurement?.id !== 'measurementPreview') {
      label.style.pointerEvents = 'auto';
    }

    // Add icon to label
    const _document = this.getDocument();
    const axisIcon = _document.createElement('div');
    axisIcon.className = 'measure-label-axis-icon shape';
    axisIcon.innerText = iconText;
    label.insertBefore(axisIcon, label.firstChild);

    if (!av.isMobileDevice()) {
      MeasureCommon.safeToggle(label, 'enableTransition', true);
    }

    label.p1 = p1;
    label.p2 = p2;

    this.parameterLabels.push(label);
  }

  /**
   * Creates a circumference label positioned above the shape centroid.
   *
   * @param {Object} shape - Shape data containing centroid
   * @param {string} text - Label text
   * @param {string} iconText - Icon text to display
   */
  createCircumferenceLabel(shape, text, iconText) {
    this.createShapeAttributeLabel(shape, shape, text, iconText);
  }

  createCircularArcLabel(shape, shapeData) {
    const { perimeter, centroid, type } = shapeData;
    const labelText = type === _MeasureConstants_js__WEBPACK_IMPORTED_MODULE_1__.SHAPE_TYPES.CIRCULAR_ARC ? 'c' : 's';
    const perimeterText = "~ " + this.measureTool.getDistanceAux(perimeter);
    this.createCircumferenceLabel(centroid, perimeterText, labelText);
  }

  // Intentional no-op: the parent class calls showAreaLabel() from renderAreaMeasurementFromPoints,
  // which runs during hover/preview. The InfoPopup must only appear on a committed measurement,
  // so it is shown explicitly via updateAreaLabel() instead.
  showAreaLabel() {}

  hideAreaLabel() {
    this._areaInfoPopup?.hide();
  }

  setSimple(simple) {
    super.setSimple(simple);
    if (simple) {
      this.hideAreaLabel();
    } else {
      this.updateAreaLabel();
    }
  }

  // ------------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------------

  /**
   * Clears shape parameter lines (diameter, axes, etc.) from the overlay.
   *
   * @private
   */
  _clearShapeParameterLines() {
    for (const key in this.lines) {
      if (key.startsWith('shape_')) {
        const lineItem = this.lines[key];
        if (!lineItem) {
          continue;
        }
        if (lineItem.line) {
          this.viewer.impl.removeOverlay(this.overlayName, lineItem.line, true);
        }
        lineItem.tips?.forEach((tip) => {
          this.viewer.impl.removeOverlay(this.overlayName, tip, true);
        });
        // Clean up the line item from this.lines
        delete this.lines[key];
      }
    }
  }

  /**
   * Cleans up labels by removing them from DOM and event listeners.
   *
   * @private
   * @param {Array<HTMLElement>} labels - Array of label elements to cleanup
   */
  _cleanupLabels(labels) {
    labels.forEach((label) => {
      if (label.parentNode) {
        this.viewer.container.removeChild(label);
      }
      this._removeEventListener(label);
    });
  }

  // ------------------------------------------------------------------------
  // Positioning
  // ------------------------------------------------------------------------

  /**
   * Updates the positions of all labels based on current viewport.
   */
  updateLabelsPosition() {
    this._updateSegmentLabelsPosition();
    this._updateParameterLabelsPosition();
  }

  /**
   * Updates positions of segment labels with overlap detection.
   *
   * @private
   */
  _updateSegmentLabelsPosition() {
    if (!this.segmentLabels) return;

    this.segmentLabels.forEach((segmentLabel) => {
      if (!this._isLabelValid(segmentLabel)) return;

      const p1_2d = MeasureCommon.project(segmentLabel.p1, this.viewer);
      const p2_2d = MeasureCommon.project(segmentLabel.p2, this.viewer);

      const dx = p1_2d.x - p2_2d.x;
      const dy = p1_2d.y - p2_2d.y;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);
      const labelWidth = segmentLabel.clientWidth;

      // Hide label if it doesn't fit within the segment
      // !important beats a host page's `.visible` utility (e.g. Bootstrap) that would else un-hide the label.
      if (LABEL_OVERLAP_MARGIN * labelWidth > segmentLength) {
        segmentLabel.style.setProperty('visibility', 'hidden', 'important');
      } else {
        segmentLabel.style.visibility = 'visible';
        this._positionLabelBetweenPoints(segmentLabel, segmentLabel.p1, segmentLabel.p2);
      }
    });
  }

  /**
   * Updates positions of parameter labels (axes, diameter, etc).
   *
   * @private
   */
  _updateParameterLabelsPosition() {
    if (!this.parameterLabels) return;

    this.parameterLabels.forEach((parameterLabel) => {
      if (!this._isLabelValid(parameterLabel)) return;
      this._positionLabelBetweenPoints(parameterLabel, parameterLabel.p1, parameterLabel.p2);
    });
  }

  /**
   * Checks if a label is valid for positioning.
   *
   * @private
   * @param {HTMLElement} label - The label to check
   * @returns {boolean} True if label is valid
   */
  _isLabelValid(label) {
    return label && label.p1 && label.p2 && this.isVisible(label);
  }

  /**
   * Positions a label at the midpoint between two points.
   *
   * @private
   * @param {HTMLElement} label - The label element
   * @param {THREE.Vector3} p1 - First point
   * @param {THREE.Vector3} p2 - Second point
   */
  _positionLabelBetweenPoints(label, p1, p2) {
    const midpoint = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
      z: (p1.z + p2.z) / 2
    };

    label.point = midpoint;

    if (!this.viewer.navigation.isPointVisible(midpoint)) {
      label.classList.toggle('visible', false);
      return;
    }

    const xy = MeasureCommon.project(midpoint, this.viewer);
    const xOffset = Math.floor(label.clientWidth / 2);
    const yOffset = Math.floor(label.clientHeight / 2);

    label.style.top = xy.y - yOffset + 'px';
    label.style.left = xy.x - xOffset + 'px';

    this.applyLabelColors(label);
    this.labels.push(label);
  }

  // ------------------------------------------------------------------------
  // Scale / results updates
  // ------------------------------------------------------------------------

  /**
   * Updates scale for surface measurements.
   * Overrides parent method to handle surface-specific scaling.
   */
  updateScale() {
    super.updateScale();

    // _updateSegmentsScaling() rebuilds via _renderSurface which re-creates labels at
    // current scale, so an explicit updateLabelsPosition() call here is unnecessary.
    if (this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE &&
    this.measurement.isComplete()) {
      this._updateSegmentsScaling();
    }
  }

  /**
   * Rebuilds surface rendering after a scale change.
   *
   * @private
   */
  _updateSegmentsScaling() {
    this.clear();

    const { surfaceData } = this.measurement;
    if (!surfaceData) {
      return;
    }

    this._renderSurface(surfaceData);

    // Re-show area popup if it was previously visible (clear() hides it).
    // Preview indicators never create _areaInfoPopup, so skip them.
    if (this._areaInfoPopup) {
      this.updateAreaLabel();
    }
  }

  /**
   * Updates measurement results when units or precision change.
   * Overrides parent method.
   */
  updateResults() {
    this.clear();

    const { surfaceData } = this.measurement;
    if (surfaceData) {
      this._renderSurface(surfaceData);
    }

    // clear() hides the area popup; re-show it with refreshed text.
    this.updateAreaLabel();

    // Deferred so the DOM reflow picks up new label text widths before we re-anchor them.
    setTimeout(() => {
      // Guard against viewer unload
      if (this.viewer?.impl) {
        this.updateLabelsPosition();
      }
    }, 0);
  }

  /**
   * Surface measurements can contain many segments, so creating a DOM selection
   * area for each segment is expensive and can flood the container on hover.
   * Keep selection areas disabled for this indicator.
   */
  updateSelectionArea() {
    this.clearSelectionAreas();
  }

  /**
   * Clears all surface measurement visuals and labels.
   * Overrides parent method.
   */
  clear() {
    this._areaInfoPopup?.hide();

    // Clear segment and parameter labels
    this._cleanupLabels(this.segmentLabels);
    this._cleanupLabels(this.parameterLabels);

    // Clear shape parameter lines
    this._clearShapeParameterLines();

    // Clear shape tips
    this._clearShapeTips();

    // Call parent method for common clearing
    super.clear();
  }

  /**
   * Surface tool does not use label stacking, so overlap detection is disabled.
   * Overrides parent method.
   *
   * @returns {boolean} Always returns false
   */
  labelsOverlapDetection() {
    return false;
  }

  /**
   * Skip parent's preview clear (would wipe the in-progress surface preview),
   * but still clear the snap overlay so it doesn't linger on the hovered pill.
   */
  onMeasurementHovered() {
    this.measureTool?._snapper?.indicator?.clearOverlays?.();
  }

  /**
   * Destroys the indicator and cleans up all resources.
   * Overrides parent method.
   */
  destroy() {
    this._areaInfoPopup?.destroy();
    this._areaInfoPopup = null;

    this._cleanupLabels(this.segmentLabels);
    this._cleanupLabels(this.parameterLabels);
    this.segmentLabels = [];
    this.parameterLabels = [];

    this._clearShapeTips();

    // Shared across all dimensions in a render pass — must be released, otherwise
    // the underlying GPU material leaks for the indicator's lifetime.
    this._dimensionMaterial?.dispose?.();
    this._dimensionMaterial = null;

    super.destroy();
  }
}

/***/ },

/***/ "./extensions/Measure/CustomTools/SurfaceToolRegistration.js"
/*!*******************************************************************!*\
  !*** ./extensions/Measure/CustomTools/SurfaceToolRegistration.js ***!
  \*******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createSurfaceToolButton: () => (/* binding */ createSurfaceToolButton),
/* harmony export */   deregisterSurfaceTool: () => (/* binding */ deregisterSurfaceTool),
/* harmony export */   registerSurfaceTool: () => (/* binding */ registerSurfaceTool)
/* harmony export */ });
/* harmony import */ var _SurfaceMeasureTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SurfaceMeasureTool.js */ "./extensions/Measure/CustomTools/SurfaceMeasureTool.js");


const av = Autodesk.Viewing;
const avu = av.UI;
const MeasureCommon = av.MeasureCommon;

/**
 * Registers the surface measurement tool as a custom tool with the measure tool.
 * This should be called after the measure tool is created.
 *
 * @param {MeasureTool} measureTool - The measure tool instance
 * @returns {boolean} True if registration was successful
 */
function registerSurfaceTool(measureTool) {

  if (!measureTool) {
    console.error('Measure tool is not defined');
    return false;
  }

  // Get viewer, snapper, and shared config from the measure tool
  const viewer = measureTool.getViewer();
  const snapper = measureTool.getSnapper();
  const sharedMeasureConfig = measureTool.getSharedMeasureConfig();

  if (!viewer) {
    console.error('Could not get viewer from measure tool');
    return false;
  }

  if (!snapper) {
    console.error('Could not get snapper from measure tool');
    return false;
  }

  if (!sharedMeasureConfig) {
    console.error('Could not get shared measure config from measure tool');
    return false;
  }

  // Create the surface tool instance
  const surfaceTool = new _SurfaceMeasureTool_js__WEBPACK_IMPORTED_MODULE_0__.SurfaceMeasureTool(viewer, snapper, sharedMeasureConfig, measureTool);

  // Register it with the measure tool
  measureTool.registerCustomTool(MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE, surfaceTool);

  return true;
}

/**
 * Deregisters the surface measurement tool.
 *
 * @param {MeasureTool} measureTool - The measure tool instance
 */
function deregisterSurfaceTool(measureTool) {
  try {
    measureTool.deregisterCustomTool(
      MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE
    );
  } catch (error) {
    console.error('Error deregistering SurfaceMeasureTool:', error);
  }
}

/**
 * Creates and registers the surface measurement button in the toolbar.
 *
 * @param {MeasureToolbar} measureToolbar - The measure toolbar instance
 * @returns {Object} The created surface button
 */
function createSurfaceToolButton(measureToolbar) {
  const measureExtension = measureToolbar.measureExtension;

  const measureSurfaceBtn = new avu.Button("toolbar-measureTool-surface");
  measureSurfaceBtn.setGlobalManager(measureToolbar.globalManager);
  measureSurfaceBtn.setToolTip("Surface");
  measureSurfaceBtn.setIcon("adsk-icon-measure-surface-new");
  measureSurfaceBtn.onClick = function () {
    const enable = measureSurfaceBtn.getState() !== avu.Button.State.ACTIVE;
    if (enable) {
      measureExtension.activate('surface');
    } else {
      measureExtension.measureTool.deselectAllMeasurements();
    }
  };

  measureToolbar.measureToolbar.addControl(measureSurfaceBtn);
  measureToolbar.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE] = measureSurfaceBtn;

  return measureSurfaceBtn;
}

/***/ },

/***/ "./extensions/Measure/EventTypes.js"
/*!******************************************!*\
  !*** ./extensions/Measure/EventTypes.js ***!
  \******************************************/
(module) {

/**
* Fired to start or stop mouse tracking
* the mouse tracker starts and stop a mousetracker used by an application
* this can be used to support autoscrolling in an application
* @event SET_MOUSE_TRACKING
* @property {string} [mode] - 'start' or 'stop'
*/
module.exports.SET_MOUSE_TRACKING = 'mouseTracking';

/***/ },

/***/ "./extensions/Measure/Indicator.js"
/*!*****************************************!*\
  !*** ./extensions/Measure/Indicator.js ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Indicator: () => (/* binding */ Indicator)
/* harmony export */ });

var av = Autodesk.Viewing;
var MeasureCommon = av.MeasureCommon;

/**
 * Base class for an indicator.
 */

var Indicator = function (viewer, measurement, tool)
{
  this.viewer = viewer;
  this.setGlobalManager(viewer.globalManager);
  this.measurement = measurement;
  this.tool = tool;
  this.snapper = tool.getSnapper();
  this.materialExtensionLine = null;
  this.materialExtensionFace = null;
  this.extensionLines = [];
  this.extensionFaces = [];
  this.grayOutPlane = [];
  this.materialPoint = null;
  this.materialLine = null;
  this.materialAngle = null;
  this.materialAngleOutline = null;
  this.materialGreyOutPlane = null;
  this.materialFace = null;
  this.angleArc = null;
  this.angleOutline = [];
  this.arcOutline = [];
  this.arcTip = [];
  this.showMeasureResult = false;
  this.visibleLabels = [];
  this.overlayName = 'measure-indicator-overlay-' + (measurement.id || '');
  this.xAxis = this.viewer.autocam.getWorldRightVector();
  this.yAxis = this.viewer.autocam.getWorldUpVector();
  this.zAxis = this.viewer.autocam.getWorldFrontVector();
};



var proto = Indicator.prototype;
av.GlobalManagerMixin.call(proto);

proto.init = function () {
  return false;
};

proto.updateDistance = function () {
  return false;
};

proto.updateAngle = function () {
  return false;
};

proto.clear = function () {
  return false;
};

proto.updateLabelsPosition = function () {
  return false;
};

proto.renderFromPoints = function (pointData, showMeasureResult) {
  this.showMeasureResult = showMeasureResult;

  this.clear();

  for (var i = 1; i <= Object.keys(pointData).length; i++) {
    const p = pointData[i].intersection;

    if (!this.endpoints[i]) {
      this.createEndpoint(i);
    }

    this.endpoints[i].position = new THREE.Vector3(p.x, p.y, p.z);
    this.showClick(i);
  }

  this.renderRubberbandFromPoints(pointData);

  this.updateLabelsPosition();
};

// Renders the measurement and the labels.
proto.render = function (picks, showMeasureResult) {

  this.showMeasureResult = showMeasureResult;

  this.clear();

  for (var i = 1; i <= Object.keys(picks).length; i++) {
    if (this.measurement.hasPick(i)) {
      this.renderPick(i);
    }
  }

  this.renderRubberband(picks);

  this.updateLabelsPosition();
};

proto.changeEndpointOnEditStyle = function (endpointNumber, isEditing) {
  return false;
};

proto.handleResize = function () {
  return false;
};

proto.setNoTopology = function () {
  return false;
};

proto.setFetchingTopology = function () {
  return false;
};

proto.setTopologyAvailable = function () {
  return false;
};

proto.clientToCanvasCoords = function (event) {
  var rect = this.viewer.impl.getCanvasBoundingClientRect();
  var res = {};
  if (Object.prototype.hasOwnProperty.call(event, "center"))
  {
    event.canvasX = res.x = event.center.x - rect.left;
    event.canvasY = res.y = event.center.y - rect.top;
  } else

  {
    event.canvasX = res.x = event.pointers[0].clientX - rect.left;
    event.canvasY = res.y = event.pointers[0].clientY - rect.top;
  }

  return res;
};

proto.initLabelMobileGestures = function (label, pointNumber) {
  var magnifyingGlass = this.viewer.toolController.getTool("magnifyingGlass");

  this.hammer = new av.Hammer.Manager(label, {
    recognizers: [
    av.GestureRecognizers.drag,
    av.GestureRecognizers.singletap],

    handlePointerEventMouse: false,
    inputClass: av.Hammer.TouchInput
  });

  this.onSingleTapBinded = function (event) {
    var pos = this.clientToCanvasCoords(event);
    this.snapper.onMouseDown(pos);
    this.tool.editEndpoint(event, pointNumber, this.measurement.id);
  }.bind(this);

  this.onDragStartBinded = function (event) {
    var pos = this.clientToCanvasCoords(event);
    this.snapper.onMouseDown(pos);
    this.tool.editEndpoint(event, pointNumber, this.measurement.id);
    this.tool.editByDrag = true;

    // Activate Magnifying Glass and tool by faking press event.
    event.type = "press";
    magnifyingGlass.handlePressHold(event);
    this.tool.handlePressHold(event);
    event.type = "dragstart";
    magnifyingGlass.handleGesture(event);
    this.tool.handleGesture(event);
  }.bind(this);

  this.onDragMoveBinded = function (event) {
    var pos = this.clientToCanvasCoords(event);
    this.snapper.onMouseDown(pos);

    magnifyingGlass.handleGesture(event);
    this.tool.handleGesture(event);
  }.bind(this);

  this.onDragEndBinded = function (event) {
    var pos = this.clientToCanvasCoords(event);
    this.snapper.onMouseDown(pos);

    // Deactivate Magnifying Glass and tool by faking pressup event.
    magnifyingGlass.handleGesture(event);
    this.tool.handleGesture(event);
    event.type = "pressup";
    magnifyingGlass.handlePressHold(event);
    this.tool.handlePressHold(event);

    this.tool.handleButtonUp(event);
  }.bind(this);

  this.hammer.on("singletap", this.onSingleTapBinded);
  this.hammer.on("dragstart", this.onDragStartBinded);
  this.hammer.on("dragmove", this.onDragMoveBinded);
  this.hammer.on("dragend", this.onDragEndBinded);
};

proto.clearLabelMobileGestures = function () {
  if (this.hammer) {
    this.hammer.off("singletap", this.onSingleTapBinded);
    this.hammer.off("dragstart", this.onDragStartBinded);
    this.hammer.off("dragmove", this.onDragMoveBinded);
    this.hammer.off("dragend", this.onDragEndBinded);
    this.hammer = null;
  }
};

proto.updateVisibleLabelsArray = function (label, isVisible) {
  if (isVisible) {
    if (!(this.visibleLabels.indexOf(label) > -1)) {
      this.visibleLabels.push(label);
    }
  } else {
    // remove from array
    var index = this.visibleLabels.indexOf(label);
    if (index > -1) {
      this.visibleLabels.splice(index, 1);
    }
  }
};

proto.hideEndpoints = function () {
  for (var name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      var endpoint = this.endpoints[name];
      if (endpoint.label) {
        this.hideLabel(endpoint.label);
      }
    }
  }
};

proto.showEndpoints = function () {
  for (var name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      var endpoint = this.endpoints[name];
      if (this.measurement.hasPick(name) && endpoint.label) {
        this.showLabel(endpoint.label);
      }
    }
  }
};

proto.hideLabel = function (label) {
  if (label) {
    MeasureCommon.safeToggle(label, 'visible', false);
    this.updateVisibleLabelsArray(label, false);
  }
};

proto.showLabel = function (label) {
  if (label) {
    MeasureCommon.safeToggle(label, 'visible', true);
    this.updateVisibleLabelsArray(label, true);
  }
};

proto.changeEndpointOnEditStyle = function (endpointNumber, isEditing) {
  if (this.endpoints[endpointNumber] && this.endpoints[endpointNumber].label) {
    MeasureCommon.safeToggle(this.endpoints[endpointNumber].label, 'on-edit', isEditing);
  }
};

proto.changeEndpointEditableStyle = function (endpointNumber, isEditable) {
  if (this.endpoints[endpointNumber] && this.endpoints[endpointNumber].label) {
    MeasureCommon.safeToggle(this.endpoints[endpointNumber].label, 'editable', isEditable);
  }
};

proto.changeAllEndpointsEditableStyle = function (isEditable) {
  for (var name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      this.changeEndpointEditableStyle(name, isEditable);
    }
  }
};

proto.changeAllEndpointsOnEditStyle = function (isEditing) {
  for (var name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      this.changeEndpointOnEditStyle(name, isEditing);
    }
  }
};

proto.hideLabelsOutsideOfView = function () {
  // For each label, check if it's inside the camera viewport.
  if (this.viewer.model && !this.viewer.model.is2d()) {
    this.visibleLabels.forEach(function (label) {

      // Ignore labels if position is not computed yet. This may temporarily happen, because label positions are not
      // always immediately assigned. (see MeasureToolIndicator.js)
      // Note that we must not set them to invisible here, because this may cause a hen-and-egg-problem:
      // Some code sections in MeasureToolIndicator.updatePositions() don't set the label position for invisible labels.
      if (!label.point) {
        return;
      }

      var show = this.viewer.navigation.isPointVisible(label.point);

      if (label.classList.contains('visible') && !show || !label.classList.contains('visible') && show) {
        label.classList.toggle('visible', show);
      }

    }.bind(this));
  }
};

proto.showClick = function (pickNumber) {
  if (this.tool.getActivePointIndex() !== pickNumber) {
    this.showLabel(this.endpoints[pickNumber].label);
  }
};

proto.hideClick = function (pickNumber) {

  if (this.endpoints[pickNumber]) {
    this.hideLabel(this.endpoints[pickNumber].label);
  }
};

proto.renderPick = function (pickNumber) {
  if (!this.endpoints[pickNumber]) {
    this.createEndpoint(pickNumber);
  }

  this.renderEndpointGeometry(pickNumber);
  this.showClick(pickNumber);
};

proto.renderEndpointGeometry = function (pickNumber) {
  var geometry = MeasureCommon.getSnapResultPosition(this.measurement.getPick(pickNumber), this.viewer);

  if (geometry !== null) {
    this.endpoints[pickNumber].position = geometry.clone();
  }
};

// This is a workaround to deal with the limitation on linewidth on Windows due to the ANGLE library
proto.drawEdgeAsCylinder = function (geom, material, linewidth, type, cylinderGeometry) {

  // The array for all cylinders
  var edge = [];
  var cylinder;

  const position = geom.getAttribute('position');
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();

  if (type == 1) {// LinePieces
    for (let i = 0; i < position.count; i += 2) {
      v0.fromBufferAttribute(position, i);
      v1.fromBufferAttribute(position, i + 1);
      cylinder = this.cylinderMesh(v0, v1, material, linewidth, cylinderGeometry);
      this.setCylinderScale(cylinder, v0, v1);
      edge.push(cylinder);
    }
  } else
  {// LineStrip
    for (let i = 0; i < position.count - 1; i++) {
      v0.fromBufferAttribute(position, i);
      v1.fromBufferAttribute(position, i + 1);
      cylinder = this.cylinderMesh(v0, v1, material, linewidth, cylinderGeometry);
      this.setCylinderScale(cylinder, v0, v1);
      edge.push(cylinder);
    }
  }


  return edge;
};

proto.drawDashedLine = function (p1, p2, dashSize, gapSize, material, width, overlayName) {

  const geometry = new THREE.BufferGeometry();
  var line = new THREE.Vector3().subVectors(p2, p1);
  var lineLength = line.length() - gapSize;
  var lineDirection = line.normalize();

  var pos = p1.clone();
  var currLength = 0;

  const points = [];
  while (currLength < lineLength) {
    var isPointVisible = this.viewer.navigation.isPointVisible(pos);

    if (isPointVisible) {
      points.push(pos.clone());
    }

    pos.addVectors(pos, lineDirection.clone().multiplyScalar(dashSize));

    if (isPointVisible) {
      points.push(pos.clone());
    }

    pos.addVectors(pos, lineDirection.clone().multiplyScalar(gapSize));

    currLength += dashSize + gapSize;
  }
  geometry.setFromPoints(points);

  line = this.drawEdgeAsCylinder(geometry, material, width, 1, this.getNewCylinderGeometry());
  this.viewer.impl.addMultipleOverlays(overlayName, line);

  return line;
};

// This is a workaround to deal with the limitation on linewidth on Windows due to the ANGLE library
proto.drawLineAsCylinder = function (geom, material, linewidth, overlayName, isTapered) {

  var line;

  const position = geom.getAttribute('position');
  if (position.count == 2) {
    const p0 = new THREE.Vector3().fromBufferAttribute(position, 0);
    const p1 = new THREE.Vector3().fromBufferAttribute(position, 1);
    line = this.cylinderMesh(p0, p1, material, linewidth, this.getNewCylinderGeometry(isTapered));
    this.setCylinderScale(line, p0, p1);
    this.viewer.impl.addOverlay(overlayName, line);
  }

  return line;
};

// isTapered is used to determine if the cylinder should be displayed as a cone
proto.getNewCylinderGeometry = function (isTapered = false) {
  return new THREE.CylinderGeometry(isTapered ? 0 : 0.1, 0.1, 1, 8, 1, true);
};


proto.cylinderMesh = function (pointX, pointY, material, linewidth, cylinderGeometry) {

  var direction = new THREE.Vector3().subVectors(pointY, pointX);
  var orientation = new THREE.Matrix4();
  orientation.lookAt(pointX, pointY, new THREE.Object3D().up);
  orientation.multiply(new THREE.Matrix4().set(linewidth, 0, 0, 0,
  0, 0, linewidth, 0,
  0, -direction.length(), 0, 0,
  0, 0, 0, 1));

  var edge = new THREE.Mesh(cylinderGeometry, material);
  edge.applyMatrix4(orientation);
  edge.lmv_line_width = linewidth;
  edge.position.x = (pointY.x + pointX.x) / 2;
  edge.position.y = (pointY.y + pointX.y) / 2;
  edge.position.z = (pointY.z + pointX.z) / 2;

  return edge;
};

// Set scale for cylinder
proto.setCylinderScale = function (cylinderMesh, p1, p2) {
  var scale;

  if (p1 && p2) {
    var point = MeasureCommon.nearestPointInPointToSegment(this.viewer.navigation.getPosition(), p1, p2);
    scale = this.setScale(point);
  } else {
    scale = this.setScale(cylinderMesh.position);
  }

  if (Object.prototype.hasOwnProperty.call(cylinderMesh, "lmv_line_width"))
  scale *= cylinderMesh.lmv_line_width;
  cylinderMesh.scale.x = scale;
  cylinderMesh.scale.z = scale;
};


// Set scale for vertex and extension dashed line
proto.setScale = function (point) {

  var pixelSize = 5;

  var navapi = this.viewer.navigation;
  var camera = navapi.getCamera();
  var position = navapi.getPosition();

  var p = point.clone();

  var distance = camera.isPerspective ? p.sub(position).length() :
  navapi.getEyeVector().length();

  var fov = navapi.getVerticalFov();
  var worldHeight = 2.0 * distance * Math.tan(THREE.Math.degToRad(fov * 0.5));

  var viewport = navapi.getScreenViewport();
  var scale = pixelSize * worldHeight / viewport.height;

  return scale;
};

proto.alignLabelWithLine = function (label, p1, p2, offset, viewer) {
  var camUpVector = viewer.navigation.getCameraUpVector();
  var worldUpVec = new THREE.Vector3(0, 1, 0);
  var cameraAngle = worldUpVec.angleTo(camUpVector) * 180 / Math.PI;

  cameraAngle = camUpVector.x >= 0 ? cameraAngle : -cameraAngle;

  var angle = null;

  var deltaX = p1.x - p2.x;
  var deltaY = p1.y - p2.y;

  if (p1.x < p2.x) {
    angle = Math.atan2(-deltaY, -deltaX) * 180 / Math.PI;
  } else
  {
    angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
  }

  angle = -(angle + cameraAngle);

  if (Math.abs(angle) > 90) {
    angle = angle + 180;
  }

  label.style.transform = 'rotate(' + angle + 'deg) translate(0px, ' + offset + 'px)';
};

proto.destroy = function () {
  this.materialPoint = null;
  this.materialFace = null;
  this.materialLine = null;
  this.materialAngle = null;

  if (av.isTouchDevice()) {
    this.clearLabelMobileGestures();
  }

  for (var name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      var endPoint = this.endpoints[name];

      if (endPoint.label) {
        endPoint.label.removeEventListener(av.isSafari() ? 'mousedown' : 'pointerdown', this.onMouseClickBinded);
        endPoint.label.removeEventListener('mousewheel', this.viewer.toolController.mousewheel);
        endPoint.label.parentNode.removeChild(endPoint.label);
        endPoint.label = null;
      }
    }
  }

  this.visibleLabels = [];
};

proto.renderRubberbandFromPoints = function (pointData) {
  const keys = Object.keys(pointData);
  const intersectionPoints = [];
  for (let i = 0; i < keys.length; i++) {
    intersectionPoints.push(pointData[keys[i]].intersection);
  }
  switch (this.measurement.measurementType) {
    case MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE:
      var start = pointData[1].intersection;
      var end = pointData[2].intersection;
      if (start && end) {
        this.renderDistanceMeasurementFromPoints(start, end);
      }
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE:
      this.renderAngleMeasurementFromPoints(intersectionPoints);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_AREA:
      this.renderAreaMeasurementFromPoints(intersectionPoints);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_ARC:{
        const p1 = pointData[1].intersection;
        const p2 = pointData[2].intersection;
        const center = pointData[1].circularArcCenter;
        const radius = pointData[1].circularArcRadius;
        // Render the arc measurement from the intersection points, center and radius.
        this.renderArcMeasurementFromPoints(p1, p2, center, radius);
        break;
      }

    case MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT:
      this.renderSpotMeasurementFromPoints(intersectionPoints);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_CALLOUT:
      this.renderCalloutMeasurementFromPoints(intersectionPoints);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_LASER:{
        let start = pointData[1];
        if (start) {
          this.renderLaserMeasurementFromPoints(start);
        }
        break;
      }

    case MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE:{
        let start = pointData[1];
        if (start) {
          this.renderSurfaceMeasurementFromPoints(start);
        }
        break;
      }
  }

};

proto.renderRubberband = function (picks) {

  switch (this.measurement.measurementType) {
    case MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE:
      var previewsPick = picks[1];
      var activePick = picks[2];
      var start = MeasureCommon.getSnapResultPosition(previewsPick, this.viewer);
      var end = MeasureCommon.getSnapResultPosition(activePick, this.viewer);

      if (start && end) {
        this.renderDistanceMeasurement(start, end);
      }
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE:
      this.renderAngleMeasurement(picks);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_AREA:
      this.renderAreaMeasurement(picks);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_ARC:{
        let previewsPick = picks[1];
        let activePick = picks[2];

        if (previewsPick && activePick) {
          this.renderArcMeasurement(previewsPick, activePick);
        }
        break;
      }

    case MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT:{
        const point = MeasureCommon.getSnapResultPosition(picks[1], this.viewer);
        if (point) {
          this.renderSpotMeasurement(point);
        }
        break;
      }

    case MeasureCommon.MeasurementTypes.MEASUREMENT_CALLOUT:
      this.renderCalloutMeasurement(picks);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_LASER:
      this.renderLaserMeasurement(picks);
      break;

    case MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE:
      this.renderSurfaceMeasurement(picks);
      break;
  }
};

proto.initMouseEvent = function (label, pointNumber) {

  var isSafari = av.isSafari();
  this.onMouseClickBinded = function (event) {
    if (isSafari || event.pointerType === 'mouse') {
      var rect = this.viewer.impl.getCanvasBoundingClientRect();
      event.canvasX = event.clientX - rect.left;
      event.canvasY = event.clientY - rect.top;
      this.tool.editEndpoint(event, pointNumber, this.measurement.id);
    }
  }.bind(this);
  label.addEventListener(isSafari ? 'mousedown' : 'pointerdown', this.onMouseClickBinded);
};

/***/ },

/***/ "./extensions/Measure/InfoPopup.js"
/*!*****************************************!*\
  !*** ./extensions/Measure/InfoPopup.js ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   InfoPopup: () => (/* binding */ InfoPopup)
/* harmony export */ });
const { MeasureCommon, isMobileDevice } = Autodesk.Viewing;

/**
 * InfoPopup manages a small informational popup element that can be shown
 * to add additional information to a measurement.
 */
class InfoPopup {

  /** @type {HTMLDivElement} */
  #labelElement;

  /** @type {HTMLDivElement} */
  #textElement;

  /** @type {HTMLButtonElement} */
  #buttonElement;

  /** @type {HTMLElement} */
  #container;

  /**
   * @param {HTMLElement} container - The container element to append the popup to (viewer.container).
   * @param {string} [text] - Optional initial text content.
   */
  constructor(container, text) {
    this.#labelElement = document.createElement('div');
    this.#labelElement.className = 'info-popup';

    this.#textElement = document.createElement('div');
    this.#textElement.className = 'info-popup-text';
    this.#textElement.textContent = '';

    this.#labelElement.appendChild(this.#textElement);
    this.#container = container;
    this.#container.appendChild(this.#labelElement);

    // Ensure the popup starts hidden after being appended to the container.
    this.hide();

    if (text !== undefined) {
      this.setText(text);
    }
  }

  /**
   * Makes the popup visible by toggling CSS classes.
   */
  show() {
    MeasureCommon.safeToggle(this.#labelElement, 'visible', true);
    if (!isMobileDevice()) {
      MeasureCommon.safeToggle(this.#labelElement, 'enable-hover', true);
    }
  }

  /**
   * Hides the popup by toggling CSS classes.
   */
  hide() {
    MeasureCommon.safeToggle(this.#labelElement, 'visible', false);
    if (!isMobileDevice()) {
      MeasureCommon.safeToggle(this.#labelElement, 'enable-hover', false);
    }
  }

  /**
   * Updates the text content of the popup.
   * @param {string} text
   */
  setText(text) {
    this.#textElement.textContent = text;
  }

  /**
   * Adds a button to the popup.
   * @param {string} text - Button text.
   * @param {function} callback - Button click handler.
   */
  addButton(text, callback) {
    this.#buttonElement = document.createElement('button');
    this.#buttonElement.className = 'info-popup-button';
    this.#buttonElement.textContent = text;
    this.#buttonElement.addEventListener('click', callback);
    this.#labelElement.appendChild(this.#buttonElement);
  }

  /**
   * Removes the popup from the DOM and cleans up references.
   */
  destroy() {
    this.hide();

    if (this.#labelElement.isConnected) {
      this.#container.removeChild(this.#labelElement);
    }

    this.#labelElement = null;
    this.#textElement = null;
    this.#buttonElement = null;
    this.#container = null;
  }
}

/***/ },

/***/ "./extensions/Measure/MagnifyingGlass.js"
/*!***********************************************!*\
  !*** ./extensions/Measure/MagnifyingGlass.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MagnifyingGlass: () => (/* binding */ MagnifyingGlass)
/* harmony export */ });

const av = Autodesk.Viewing;

var MagnifyingGlass = function (viewer) {

  var _viewer = viewer;
  var _active = false;
  var _names = ["magnifyingGlass"];
  var _priority = 70;
  var _isPressing = false;
  var _radius = 60;
  var _zoom = 2;
  var _offset = 15;
  var _magnifyingGlassCanvas = null;
  var _imageData = null;
  var _imageBuffer = null;
  var _clientX = null;
  var _clientY = null;
  var _needsClear = false;
  var av = Autodesk.Viewing;

  this.setGlobalManager(viewer.globalManager);

  this.register = function () {
    this.updateMagnifyingGlassBinded = this.updateMagnifyingGlass.bind(this);
  };

  this.isActive = function () {
    return _active;
  };

  this.activate = function () {
    _active = true;
  };

  this.updateMagnifyingGlass = function () {
    const _window = this.getWindow();
    const _document = this.getDocument();
    if (_needsClear) {
      _magnifyingGlassCanvas && _magnifyingGlassCanvas.classList.remove('visible');
      _needsClear = false;
    } else
    {
      var pixelRatio = _window.devicePixelRatio;
      var diameter = 2 * _radius;
      var normlizedDiameter = diameter * pixelRatio;
      var x = pixelRatio * (_clientX - _radius / _zoom);
      var y = pixelRatio * (_clientY - _radius / _zoom);

      if (!_magnifyingGlassCanvas) {
        _magnifyingGlassCanvas = _document.createElement("canvas");
        _magnifyingGlassCanvas.className = 'magnifying-glass';
        _magnifyingGlassCanvas.width = normlizedDiameter;
        _magnifyingGlassCanvas.height = normlizedDiameter;
        _magnifyingGlassCanvas.style.width = diameter + 'px';
        _magnifyingGlassCanvas.style.height = diameter + 'px';

        // Swap canvas
        _magnifyingGlassCanvas.getContext("2d").translate(0, normlizedDiameter);
        _magnifyingGlassCanvas.getContext("2d").scale(1, -1);

        _viewer.container.appendChild(_magnifyingGlassCanvas);
        _imageData = _magnifyingGlassCanvas.getContext("2d").createImageData(Math.ceil(normlizedDiameter / _zoom), Math.ceil(normlizedDiameter / _zoom));
        _imageBuffer = new Uint8Array(_imageData.data.buffer);
      }

      var ctx = _magnifyingGlassCanvas.getContext("2d");

      // Read the pixels from the frame buffer
      var gl = _viewer.impl.glrenderer().getContext();
      gl.readPixels(x, _viewer.canvas.height - y - _imageData.height, _imageData.width, _imageData.height, gl.RGBA, gl.UNSIGNED_BYTE, _imageBuffer);
      // Put the pixel into the magnifying context.
      ctx.putImageData(_imageData, 0, 0);
      // Scale the image
      ctx.drawImage(_magnifyingGlassCanvas, 0, 0, _imageData.width, _imageData.height, 0, 0, normlizedDiameter, normlizedDiameter);
      this.setGlassPosition(_magnifyingGlassCanvas, _clientX, _clientY, diameter, _offset);

      _magnifyingGlassCanvas.classList.toggle('visible', true);
    }
  };

  this.deactivate = function () {
    this.clearMagnifyingGlass();
    _active = false;
  };

  this.getNames = function () {

    return _names;
  };

  this.getName = function () {

    return _names[0];
  };

  this.getPriority = function () {
    return _priority;
  };

  this.setGlassPosition = function (canvas, x, y, diameter, offset) {

    // check the left border of canvas
    canvas.style.left = x - diameter / 2 + 'px';

    // check the top border of canvas
    if (y - diameter - offset > 0) {
      canvas.style.top = y - diameter - offset + 'px';
    } else
    {
      canvas.style.top = y + offset + 'px';
    }
  };

  this.requestUpdate = function () {
    if (!_viewer.hasEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, this.updateMagnifyingGlassBinded)) {
      _viewer.addEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, this.updateMagnifyingGlassBinded, { once: true });
    }
  };

  this.drawMagnifyingGlass = function (clientX, clientY) {
    _needsClear = false;
    _clientX = clientX;
    _clientY = clientY;
    _viewer.impl.invalidate(false, false, true);
    this.requestUpdate();
  };

  this.clearMagnifyingGlass = function () {
    _needsClear = true;
    this.requestUpdate();
  };

  this.handlePressHold = function (event) {

    if (av.isTouchDevice()) {
      switch (event.type) {

        case "press":
          _isPressing = true;
          this.drawMagnifyingGlass(event.canvasX, event.canvasY);
          break;

        case "pressup":
          this.clearMagnifyingGlass();
          _isPressing = false;
          break;
      }
    }
    return false;

  };

  this.handleGesture = function (event) {

    if (_isPressing && av.isTouchDevice()) {
      switch (event.type) {

        case "dragstart":
          this.drawMagnifyingGlass(event.canvasX, event.canvasY);
          break;

        case "dragmove":
          this.drawMagnifyingGlass(event.canvasX, event.canvasY);
          break;

        case "dragend":
          this.clearMagnifyingGlass();
          _isPressing = false;
          break;

        case "pinchstart":
          this.drawMagnifyingGlass(event.canvasX, event.canvasY);
          break;

        case "pinchmove":
          this.drawMagnifyingGlass(event.canvasX, event.canvasY);
          break;

        case "pinchend":
          this.clearMagnifyingGlass();
          break;
      }
    }

    return false;
  };

  this.handleMouseMove = function (event) {
    return false;
  };

  this.handleWheelInput = function (delta) {
    return false;
  };

  this.handleButtonUp = function (event, button) {
    return false;
  };

};

av.GlobalManagerMixin.call(MagnifyingGlass.prototype);

/***/ },

/***/ "./extensions/Measure/MeasureTool.js"
/*!*******************************************!*\
  !*** ./extensions/Measure/MeasureTool.js ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MeasureTool: () => (/* binding */ MeasureTool),
/* harmony export */   getArea: () => (/* binding */ getArea),
/* harmony export */   getDistanceAux: () => (/* binding */ getDistanceAux)
/* harmony export */ });
/* harmony import */ var _MeasurementsManager_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MeasurementsManager.js */ "./extensions/Measure/MeasurementsManager.js");
/* harmony import */ var _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MeasureToolIndicator.js */ "./extensions/Measure/MeasureToolIndicator.js");
/* harmony import */ var _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./EventTypes.js */ "./extensions/Measure/EventTypes.js");
/* harmony import */ var _src_application_EventTypes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../../src/application/EventTypes.js */ "./src/application/EventTypes.js");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../../src/measurement/Measurement.js */ "./src/measurement/Measurement.js");
/* harmony import */ var _src_application_GlobalManagerMixin_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../../src/application/GlobalManagerMixin.js */ "./src/application/GlobalManagerMixin.js");








const avp = Autodesk.Viewing.Private;


//
// /** @constructor */
//
//
class MeasureTool extends _src_application_GlobalManagerMixin_js__WEBPACK_IMPORTED_MODULE_6__.GlobalManagerProvider {
  _names = ["measure"];
  _priority = 50;

  _av = Autodesk.Viewing;
  _MeasureCommon = Autodesk.Viewing.MeasureCommon;

  // Not shared with Indicator.js
  _active = false;
  _isDragging = false;
  _endpointMoved = false;
  _activePoint = 0;
  _consumeSingleClick = false;
  _singleClickHandled = false;
  _downX = null;
  _downY = null;
  _isolateMeasure = false;

  _currentMeasurement = null;
  _onIndicatorCreatedCB = null;
  _fetchingMeasurements = [];
  _prevMeasurement = null;
  _useLastViewport = false;

  _cursor = "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAAKT2lDQ1BQaG90b3Nob3AgSUNDIHByb2ZpbGUAAHjanVNnVFPpFj333vRCS4iAlEtvUhUIIFJCi4AUkSYqIQkQSoghodkVUcERRUUEG8igiAOOjoCMFVEsDIoK2AfkIaKOg6OIisr74Xuja9a89+bN/rXXPues852zzwfACAyWSDNRNYAMqUIeEeCDx8TG4eQuQIEKJHAAEAizZCFz/SMBAPh+PDwrIsAHvgABeNMLCADATZvAMByH/w/qQplcAYCEAcB0kThLCIAUAEB6jkKmAEBGAYCdmCZTAKAEAGDLY2LjAFAtAGAnf+bTAICd+Jl7AQBblCEVAaCRACATZYhEAGg7AKzPVopFAFgwABRmS8Q5ANgtADBJV2ZIALC3AMDOEAuyAAgMADBRiIUpAAR7AGDIIyN4AISZABRG8lc88SuuEOcqAAB4mbI8uSQ5RYFbCC1xB1dXLh4ozkkXKxQ2YQJhmkAuwnmZGTKBNA/g88wAAKCRFRHgg/P9eM4Ors7ONo62Dl8t6r8G/yJiYuP+5c+rcEAAAOF0ftH+LC+zGoA7BoBt/qIl7gRoXgugdfeLZrIPQLUAoOnaV/Nw+H48PEWhkLnZ2eXk5NhKxEJbYcpXff5nwl/AV/1s+X48/Pf14L7iJIEyXYFHBPjgwsz0TKUcz5IJhGLc5o9H/LcL//wd0yLESWK5WCoU41EScY5EmozzMqUiiUKSKcUl0v9k4t8s+wM+3zUAsGo+AXuRLahdYwP2SycQWHTA4vcAAPK7b8HUKAgDgGiD4c93/+8//UegJQCAZkmScQAAXkQkLlTKsz/HCAAARKCBKrBBG/TBGCzABhzBBdzBC/xgNoRCJMTCQhBCCmSAHHJgKayCQiiGzbAdKmAv1EAdNMBRaIaTcA4uwlW4Dj1wD/phCJ7BKLyBCQRByAgTYSHaiAFiilgjjggXmYX4IcFIBBKLJCDJiBRRIkuRNUgxUopUIFVIHfI9cgI5h1xGupE7yAAygvyGvEcxlIGyUT3UDLVDuag3GoRGogvQZHQxmo8WoJvQcrQaPYw2oefQq2gP2o8+Q8cwwOgYBzPEbDAuxsNCsTgsCZNjy7EirAyrxhqwVqwDu4n1Y8+xdwQSgUXACTYEd0IgYR5BSFhMWE7YSKggHCQ0EdoJNwkDhFHCJyKTqEu0JroR+cQYYjIxh1hILCPWEo8TLxB7iEPENyQSiUMyJ7mQAkmxpFTSEtJG0m5SI+ksqZs0SBojk8naZGuyBzmULCAryIXkneTD5DPkG+Qh8lsKnWJAcaT4U+IoUspqShnlEOU05QZlmDJBVaOaUt2ooVQRNY9aQq2htlKvUYeoEzR1mjnNgxZJS6WtopXTGmgXaPdpr+h0uhHdlR5Ol9BX0svpR+iX6AP0dwwNhhWDx4hnKBmbGAcYZxl3GK+YTKYZ04sZx1QwNzHrmOeZD5lvVVgqtip8FZHKCpVKlSaVGyovVKmqpqreqgtV81XLVI+pXlN9rkZVM1PjqQnUlqtVqp1Q61MbU2epO6iHqmeob1Q/pH5Z/YkGWcNMw09DpFGgsV/jvMYgC2MZs3gsIWsNq4Z1gTXEJrHN2Xx2KruY/R27iz2qqaE5QzNKM1ezUvOUZj8H45hx+Jx0TgnnKKeX836K3hTvKeIpG6Y0TLkxZVxrqpaXllirSKtRq0frvTau7aedpr1Fu1n7gQ5Bx0onXCdHZ4/OBZ3nU9lT3acKpxZNPTr1ri6qa6UbobtEd79up+6Ynr5egJ5Mb6feeb3n+hx9L/1U/W36p/VHDFgGswwkBtsMzhg8xTVxbzwdL8fb8VFDXcNAQ6VhlWGX4YSRudE8o9VGjUYPjGnGXOMk423GbcajJgYmISZLTepN7ppSTbmmKaY7TDtMx83MzaLN1pk1mz0x1zLnm+eb15vft2BaeFostqi2uGVJsuRaplnutrxuhVo5WaVYVVpds0atna0l1rutu6cRp7lOk06rntZnw7Dxtsm2qbcZsOXYBtuutm22fWFnYhdnt8Wuw+6TvZN9un2N/T0HDYfZDqsdWh1+c7RyFDpWOt6azpzuP33F9JbpL2dYzxDP2DPjthPLKcRpnVOb00dnF2e5c4PziIuJS4LLLpc+Lpsbxt3IveRKdPVxXeF60vWdm7Obwu2o26/uNu5p7ofcn8w0nymeWTNz0MPIQ+BR5dE/C5+VMGvfrH5PQ0+BZ7XnIy9jL5FXrdewt6V3qvdh7xc+9j5yn+M+4zw33jLeWV/MN8C3yLfLT8Nvnl+F30N/I/9k/3r/0QCngCUBZwOJgUGBWwL7+Hp8Ib+OPzrbZfay2e1BjKC5QRVBj4KtguXBrSFoyOyQrSH355jOkc5pDoVQfujW0Adh5mGLw34MJ4WHhVeGP45wiFga0TGXNXfR3ENz30T6RJZE3ptnMU85ry1KNSo+qi5qPNo3ujS6P8YuZlnM1VidWElsSxw5LiquNm5svt/87fOH4p3iC+N7F5gvyF1weaHOwvSFpxapLhIsOpZATIhOOJTwQRAqqBaMJfITdyWOCnnCHcJnIi/RNtGI2ENcKh5O8kgqTXqS7JG8NXkkxTOlLOW5hCepkLxMDUzdmzqeFpp2IG0yPTq9MYOSkZBxQqohTZO2Z+pn5mZ2y6xlhbL+xW6Lty8elQfJa7OQrAVZLQq2QqboVFoo1yoHsmdlV2a/zYnKOZarnivN7cyzytuQN5zvn//tEsIS4ZK2pYZLVy0dWOa9rGo5sjxxedsK4xUFK4ZWBqw8uIq2Km3VT6vtV5eufr0mek1rgV7ByoLBtQFr6wtVCuWFfevc1+1dT1gvWd+1YfqGnRs+FYmKrhTbF5cVf9go3HjlG4dvyr+Z3JS0qavEuWTPZtJm6ebeLZ5bDpaql+aXDm4N2dq0Dd9WtO319kXbL5fNKNu7g7ZDuaO/PLi8ZafJzs07P1SkVPRU+lQ27tLdtWHX+G7R7ht7vPY07NXbW7z3/T7JvttVAVVN1WbVZftJ+7P3P66Jqun4lvttXa1ObXHtxwPSA/0HIw6217nU1R3SPVRSj9Yr60cOxx++/p3vdy0NNg1VjZzG4iNwRHnk6fcJ3/ceDTradox7rOEH0x92HWcdL2pCmvKaRptTmvtbYlu6T8w+0dbq3nr8R9sfD5w0PFl5SvNUyWna6YLTk2fyz4ydlZ19fi753GDborZ752PO32oPb++6EHTh0kX/i+c7vDvOXPK4dPKy2+UTV7hXmq86X23qdOo8/pPTT8e7nLuarrlca7nuer21e2b36RueN87d9L158Rb/1tWeOT3dvfN6b/fF9/XfFt1+cif9zsu72Xcn7q28T7xf9EDtQdlD3YfVP1v+3Njv3H9qwHeg89HcR/cGhYPP/pH1jw9DBY+Zj8uGDYbrnjg+OTniP3L96fynQ89kzyaeF/6i/suuFxYvfvjV69fO0ZjRoZfyl5O/bXyl/erA6xmv28bCxh6+yXgzMV70VvvtwXfcdx3vo98PT+R8IH8o/2j5sfVT0Kf7kxmTk/8EA5jz/GMzLdsAAAAgY0hSTQAAeiUAAICDAAD5/wAAgOkAAHUwAADqYAAAOpgAABdvkl/FRgAAAKZJREFUeNrclLEKwzAQQ9+FgH/Nk7d8ViFT+6cG36IsNXgIdMg5kAoOIw8WSDoDvAEN04BdEhFjgCTR4e6klFxSIgDLSNydbdsAPgRCktRaUylFkfZ0Z2qtVTlnAfugGibwAur3JFrAxoBnYGEy1pGYmQCLLNB6Uqmw182M9eRS0yzqGo+y6D9rytSQR8vM7DKfbtHy4x+/xG8J+d4W9WAi8fxFOwYA8W0ypu2ZfcsAAAAASUVORK5CYII=), auto";

  // Snapper

  _isPressing = false;

  _picksBackup = [];
  _cursorPosition = null;

  _closeAreaSnapRange = 25;
  _preMeasureState = null;

  _measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE;
  _firstMeasurementTypeChange = true;

  _sessionMeasurements = null;

  _exploded = false;

  _customTools = {};

  constructor(viewer, options, sharedMeasureConfig, snapper) {
    super();
    this._viewer = viewer;
    this._options = options;
    this._sharedMeasureConfig = sharedMeasureConfig;
    this._snapper = snapper;

    this.setGlobalManager(this._viewer.globalManager);

    // Create bound method references for event listeners
    this._boundOnMeasurementChanged = this.onMeasurementChanged.bind(this);
    this._boundOnExplodedChange = this.onExplodedChange.bind(this);
    this._boundOnCameraChange = this.onCameraChange.bind(this);
    this._boundOnShowAllEvent = this.onShowAllEvent.bind(this);

    this._measurementsManager = new _MeasurementsManager_js__WEBPACK_IMPORTED_MODULE_0__.MeasurementsManager(this._viewer);
  }

  registerCustomTool(id, customMeasureTool) {
    if (this._customTools[id]) {
      console.error('Custom tool with id ' + id + ' already exists.');
      return false;
    }
    this._customTools[id] = customMeasureTool;
    return true;
  }

  deregisterCustomTool(id) {
    delete this._customTools[id];
  }

  getActivePick()
  {
    if (!this._currentMeasurement)
    return null;

    var index;

    if (this._activePoint === 0) {
      return null;
    } else if (this._activePoint === this._currentMeasurement.getMaxNumberOfPicks() + 1) {
      index = this._currentMeasurement.countPicks();
    } else {
      index = this._activePoint;
    }

    return this._currentMeasurement.getPick(index);
  }

  getPreviousPick()
  {
    if (!this._currentMeasurement)
    return null;

    var index;

    if (this._activePoint === 0) {
      return null;
    } else if (this._activePoint === 1) {
      index = this._currentMeasurement.countPicks();
      if (index === this._activePoint) {
        return null;
      }
    } else if (this._activePoint === this._currentMeasurement.getMaxNumberOfPicks() + 1) {
      index = this._currentMeasurement.countPicks() - 1;
    } else {
      index = this._activePoint - 1;
    }

    return this._currentMeasurement.getPick(index);
  }

  hasPreviousPick()
  {
    if (!this._currentMeasurement)
    return false;

    var index;

    if (this._activePoint === 0) {
      return false;
    } else if (this._activePoint === 1) {
      index = this._currentMeasurement.countPicks();
      if (index === this._activePoint) {
        return false;
      }
    } else if (this._activePoint === this._currentMeasurement.getMaxNumberOfPicks() + 1) {
      index = this._currentMeasurement.countPicks() - 1;
    } else {
      index = this._activePoint - 1;
    }

    return this._currentMeasurement.hasPick(index);
  }

  noPicksSet() {
    this._activePoint = 0;
  }

  allPicksSet() {
    this._activePoint = this._currentMeasurement.countPicks() + 1;
    this._enableMeasurementsTouchEvents(true);
    this._currentMeasurement.indicator.enableSelectionAreas(true);

    // Keep track of the previous measurement
    this._prevMeasurement = this._currentMeasurement.clone();
    this._viewer.dispatchEvent({
      type: this._MeasureCommon.Events.MEASUREMENT_COMPLETED_EVENT,
      data: { type: this._currentMeasurement.measurementType, id: this._currentMeasurement.id }
    });
  }

  isNoPicksSet() {
    return this._activePoint === 0 || !this._currentMeasurement;
  }

  areAllPicksSet() {
    return this._currentMeasurement && this._activePoint === this._currentMeasurement.getMaxNumberOfPicks() + 1;
  }

  setSessionMeasurements(measurementList) {
    // Store the clone of the measurementList
    this._sessionMeasurements = JSON.parse(JSON.stringify(measurementList));
  }

  getSessionMeasurements() {
    return JSON.parse(JSON.stringify(this._sessionMeasurements));
  }

  register()
  {

  }

  deregister()
  {
    this.deactivate();
  }

  isActive()
  {
    return this._active;
  }

  getNames()
  {
    return this._names;
  }

  getName()
  {
    return this._names[0];
  }

  getPriority()
  {
    return this._priority;
  }

  getCursor() {
    if (this._isDragging) {
      return null;
    }
    const customTool = this._customTools[this._measurementType];
    return customTool?.getCursor?.() ?? this._cursor;
  }

  getCurrentMeasurementRaw() {
    return this._currentMeasurement;
  }

  getActivePointIndex() {
    return this._activePoint;
  }

  setActivePointIndex(index) {
    this._activePoint = index;
  }

  getMeasurementsManager() {
    return this._measurementsManager;
  }

  shouldConsumeSingleClick() {
    return this._consumeSingleClick;
  }

  setConsumeSingleClick(bo) {
    this._consumeSingleClick = bo;
  }

  isSingleClickHandled() {
    return this._singleClickHandled;
  }

  setSingleClickHandled(bo) {
    this._singleClickHandled = bo;
  }

  isPressing() {
    return this._isPressing;
  }

  setIsPressing(bo) {
    this._isPressing = bo;
  }

  startNewMeasurement() {
    const customTool = this._customTools[this._measurementType];
    if (customTool) {
      this._measurementsManager.addMeasurement(customTool.createMeasurement());
      this._currentMeasurement = this._measurementsManager.getCurrentMeasurement();
      this._currentMeasurement.attachIndicator(this._viewer, this, customTool.getIndicatorClass());
    } else {
      this._currentMeasurement = this._measurementsManager.createMeasurement(this._measurementType);
      this._currentMeasurement.attachIndicator(this._viewer, this, _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_1__.MeasureToolIndicator);
    }

    if (this._onIndicatorCreatedCB instanceof Function) {
      this._onIndicatorCreatedCB();
      this._onIndicatorCreatedCB = null;
    }

    this._enableMeasurementsTouchEvents(false);
  }

  changeMeasurementType(type) {
    // Since the initial _measurementType is set to MEASUREMENT_DISTANCE, and we still want to track analytics
    // when initially entering here with the distance tool, there is a need in this _firstMeasurementTypeChange flag.
    if (type === this._measurementType && !this._firstMeasurementTypeChange) {
      return;
    }

    const currentCustomTool = this._customTools[this._measurementType];
    if (currentCustomTool) {
      currentCustomTool.deactivate();
    }

    this.clearMeasurementPreview();

    this._measurementType = type;
    this._firstMeasurementTypeChange = false;

    const newCustomTool = this._customTools[type];
    if (newCustomTool) {
      newCustomTool.activate();
    }
    avp.analytics.track('viewer.measure', {
      action: 'Enabled',
      type: newCustomTool ? newCustomTool.getMeasurementName() : this._MeasureCommon.MeasurementTypesToAnalytics[this._measurementType]
    });
  }

  getCurrentMeasureType() {
    return this._measurementType;
  }

  activate()
  {
    this._active = true;
    this._firstMeasurementTypeChange = true;
    this._measurementsManager.reset();

    this.noPicksSet();
    this._isDragging = false;
    this.isEditingEndpoint = false;
    this.editByDrag = false;

    this._viewer.impl.pauseHighlight(true);

    this._viewer.clearSelection();
    this._preMeasureState = this._viewer.getState({ objectSet: true });

    this._viewer.toolController.activateTool("snapper");
    this._viewer.toolController.activateTool("magnifyingGlass");

    // Snap filter is now handled by custom tools in their activate/deactivate methods
    if (!this._customTools[this._measurementType]) {
      this._snapper.setSnapFilter(null);
    }

    this._viewer.addEventListener(_src_application_EventTypes_js__WEBPACK_IMPORTED_MODULE_3__.EXPLODE_CHANGE_EVENT, this._boundOnExplodedChange);
    this._viewer.addEventListener(this._MeasureCommon.Events.MEASUREMENT_CHANGED_EVENT, this._boundOnMeasurementChanged);
    this._viewer.addEventListener(this._av.CAMERA_CHANGE_EVENT, this._boundOnCameraChange);
    this._viewer.addEventListener(this._av.SHOW_ALL_EVENT, this._boundOnShowAllEvent);

    // Set the stored session measurements only if the preference is enabled
    const restoreSessionMeasurements = this._viewer.prefs.get(this._av.Private.Prefs.RESTORE_SESSION_MEASUREMENTS);
    if (restoreSessionMeasurements) {
      const sessionMeasurements = this.getSessionMeasurements();
      if (this._exploded && !this._viewer.model.is2d()) {
        const localToWorld = new three__WEBPACK_IMPORTED_MODULE_4__.Matrix4();
        let fragmentList = this._viewer.model.getFragmentList();
        for (let m of sessionMeasurements) {
          for (let p of m.picks) {
            if ((p.fragId || p.fragId === 0) && p.fragPos) {
              fragmentList?.getWorldMatrix(p.fragId, localToWorld);
              let fragPos = new three__WEBPACK_IMPORTED_MODULE_4__.Vector3(p.fragPos.x, p.fragPos.y, p.fragPos.z); // isnt a vector when retrieved from session
              let fragDiff = new three__WEBPACK_IMPORTED_MODULE_4__.Vector3().applyMatrix4(localToWorld).sub(fragPos);
              p.intersection = new three__WEBPACK_IMPORTED_MODULE_4__.Vector3(p.intersection.x, p.intersection.y, p.intersection.z).add(fragDiff);
              fragPos = new three__WEBPACK_IMPORTED_MODULE_4__.Vector3().applyMatrix4(localToWorld);
              p.fragPos = { x: fragPos.x, y: fragPos.y, z: fragPos.z };
            }
          }
        }
        this._exploded = false;
      }
      this.setMeasurements(sessionMeasurements);
      this.isolateMeasurement();
    }
  }

  deactivate()
  {
    if (!this._active)
    return;

    this._viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'end' });

    const customTool = this._customTools[this._measurementType];
    avp.analytics.track('viewer.measure', {
      action: 'Disabled',
      type: customTool ? customTool.getMeasurementName() : this._MeasureCommon.MeasurementTypesToAnalytics[this._measurementType]
    });

    // Store the session measurements only if the preference is enabled
    const restoreSessionMeasurements = this._viewer.prefs.get(this._av.Private.Prefs.RESTORE_SESSION_MEASUREMENTS);
    if (restoreSessionMeasurements) {
      this.clearIncompleteMeasurement();
      const measurementList = this.getMeasurementList();
      this.setSessionMeasurements(measurementList);
    }

    this._active = false;

    this.clearMeasurementPreview();

    this.clearIsolate(); // restore initial isolation
    this._preMeasureState = null;

    this._prevMeasurement = null;
    this._useLastViewport = false;

    while (Object.keys(this._measurementsManager.measurementsList).length > 0) {
      this._currentMeasurement = this._measurementsManager.measurementsList[Object.keys(this._measurementsManager.measurementsList)[0]];
      this._measurementsManager.currentMeasurement = this._currentMeasurement;
      this.clearCurrentMeasurement();
    }

    if (customTool) {
      customTool.deactivate();
    }

    if (this._snapper && this._snapper.isActive()) {
      this._viewer.toolController.deactivateTool("snapper");
    }

    this._viewer.toolController.deactivateTool("magnifyingGlass");

    this._viewer.impl.pauseHighlight(false);

    // Clear snap filter when deactivating
    this._snapper.setSnapFilter(null);

    this._measurementsManager.destroy();

    this._viewer.removeEventListener(this._av.CAMERA_CHANGE_EVENT, this._boundOnCameraChange);
    this._viewer.removeEventListener(this._MeasureCommon.Events.MEASUREMENT_CHANGED_EVENT, this._boundOnMeasurementChanged);
    this._viewer.removeEventListener(this._av.SHOW_ALL_EVENT, this._boundOnShowAllEvent);
  }

  clearIncompleteMeasurement() {
    if (!this.areAllPicksSet()) {
      if (this.isEditingEndpoint) {
        this.undoEditEndpoint();
      } else {
        this.clearCurrentMeasurement();
      }
    }
  }

  update()
  {
    return false;
  }

  getUnits() {
    return this._sharedMeasureConfig.units;
  }

  setUnits(units)
  {
    if (this._sharedMeasureConfig.units !== units) {
      this._sharedMeasureConfig.units = units;

      for (var key in this._measurementsManager.measurementsList) {
        if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
          // Update UI
          var measurement = this._measurementsManager.measurementsList[key];
          if (measurement.indicator) {
            measurement.indicator.updateResults();
          }
        }
      }
    }
  }

  getSecondaryUnits() {
    return this._sharedMeasureConfig.secondaryUnits;
  }

  setSecondaryUnits(units) {
    if (this._sharedMeasureConfig.secondaryUnits === units) {
      return;
    }

    this._sharedMeasureConfig.secondaryUnits = units;

    for (var key in this._measurementsManager.measurementsList) {
      if (!Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
        continue;
      }

      // Update UI for secondary units
      var measurement = this._measurementsManager.measurementsList[key];
      if (measurement.indicator) {
        measurement.indicator.updateResults();
      }
    }
  }

  getPrecision() {
    return this._sharedMeasureConfig.precision;
  }

  setPrecision(precision) {
    if (!Number.isInteger(precision) || precision < 0)
    return;

    if (this._sharedMeasureConfig.precision !== precision) {
      this._sharedMeasureConfig.precision = precision;

      for (var key in this._measurementsManager.measurementsList) {
        if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
          // Update UI
          var measurement = this._measurementsManager.measurementsList[key];
          if (measurement.indicator) {
            measurement.indicator.updateResults();
          }
        }
      }
    }
  }

  /**
   * Prepare the measurement snap result information into a serializable object.
   * @param {*} measurement
   */
  _getPickData(measurement) {
    measurement = measurement || this._currentMeasurement;
    const picks = measurement.clonePicks();
    const picksData = [];
    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i];

      let pickPoint = this._MeasureCommon.getSnapResultPosition(pick, this._viewer);

      // A measurement that is still being created has an unresolved trailing pick
      // (e.g. the hover point over empty space), for which getSnapResultPosition
      // returns null. Skip it so serialization (getState/getMeasurementList) of an
      // in-progress measurement does not throw.
      if (!pickPoint) {
        continue;
      }

      const model = Object.prototype.hasOwnProperty.call(pick, 'modelId') && pick.modelId ? this._viewer.impl.findModel(pick.modelId) : this._viewer.model;
      let globalOffset = null;
      if (model) {
        const modelData = model.getData();
        globalOffset = modelData && Object.prototype.hasOwnProperty.call(modelData, 'globalOffset') ? modelData.globalOffset : null;
        pickPoint = globalOffset ? pickPoint.clone().add(globalOffset) : pickPoint.clone();
      }

      const pickData = {
        intersection: JSON.parse(JSON.stringify(pickPoint)),
        modelId: pick.modelId,
        fragId: pick.fragId,
        fragPos: pick.fragPos,
        viewportIndex2d: pick.viewportIndex2d,
        snapNode: pick.snapNode
      };

      // Add the arc center and arc radius for the measurement
      if (measurement.arc) {
        pickData.circularArcCenter = pick.circularArcCenter;
        pickData.circularArcRadius = pick.circularArcRadius;
      }

      // Handle custom tool-specific pick data
      const customTool = this._customTools[measurement.measurementType];
      if (customTool && customTool.preparePickData) {
        customTool.preparePickData(measurement, pickData, pick, globalOffset);
      }

      picksData.push(pickData);
    }

    return picksData;
  }

  /**
   * Adds secondary units to a primary value if secondary units are enabled and different from primary.
   * @param {string} primaryValue - The formatted primary value with units
   * @param {number} rawValue - The raw measurement value to convert
   * @param {string} sourceUnits - The source units (model units)
   * @param {string} [unitModifier] - Optional modifier for units (e.g., 'square' for area, '^2' suffix)
   * @returns {string} Primary value with optional secondary value in format: "primaryValue (~secondaryValue)"
   * @private
   */
  _addSecondaryUnits(primaryValue, rawValue, sourceUnits, unitModifier = null) {
    return addSecondaryUnits(primaryValue, rawValue, sourceUnits, this._sharedMeasureConfig, unitModifier);
  }

  getDistanceXYZ(measurement) {
    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    return this.getDistanceAux(measurement.distanceXYZ, measurement.result?.units);
  }

  getDistanceX(measurement) {
    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    return this.getDistanceAux(measurement.distanceX, measurement.result?.units);
  }

  getDistanceY(measurement) {
    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    return this.getDistanceAux(measurement.distanceY, measurement.result?.units);
  }

  getDistanceZ(measurement) {
    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    return this.getDistanceAux(measurement.distanceZ, measurement.result?.units);
  }

  /**
   * Returns a formatted string for the given distance. The used unit is determined by the model, calibration or
   * optional viewport unit.
   * @param {number} measurementDistance
   * @param {string} [viewportUnits] - Unit string of the viewport that was measured in. Can differ from mode unit.
   * @returns {string} Distance converted and formatted to the desired unit.
   *
   * @private
   */
  getDistanceAux(measurementDistance, viewportUnits) {
    return getDistanceAux(this._viewer, this._sharedMeasureConfig, measurementDistance, viewportUnits);
  }

  getAngle(measurement) {

    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    var angle = measurement.angle;
    const primaryValue = Autodesk.Viewing.Private.formatValueWithUnits(angle, String.fromCharCode(0xb0), 3, this._sharedMeasureConfig.precision);
    // No secondary unit (radian) display for angles
    return primaryValue;
  }

  getArc(measurement) {

    if (this._viewer.model) {
      if (!measurement) {
        measurement = this._currentMeasurement;
      }
      let units = this._viewer.model.getUnitString();

      var arc = measurement.arc;
      const arcConverted = Autodesk.Viewing.Private.convertUnits(units, this._sharedMeasureConfig.units, this._sharedMeasureConfig.calibrationFactor, arc || 0);
      const primaryValue = Autodesk.Viewing.Private.formatValueWithUnits(arcConverted, this._sharedMeasureConfig.units, 3, this._sharedMeasureConfig.precision);

      return this._addSecondaryUnits(primaryValue, arc, units);
    }
  }

  getSpot(measurement) {

    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    let spot = measurement.modelSpot ? measurement.modelSpot.clone() : new THREE.Vector3();

    return 'X: ' + this.getDistanceAux(spot.x, measurement.units) +
    '\nY: ' + this.getDistanceAux(spot.y, measurement.units) + (
    this._viewer.model?.is2d() ? '' : '\nZ: ' + this.getDistanceAux(spot.z, measurement.units));
  }

  getCallout(measurement) {

    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    return measurement.text || "";
  }

  getArea(measurement) {
    if (!measurement) {
      measurement = this._currentMeasurement;
    }
    return getArea(this._viewer, this._sharedMeasureConfig, measurement);
  }

  snapToFirstPick(currentPick, forceSnap) {
    if (this._currentMeasurement.hasPick(1) && this._activePoint > 3 && !this._currentMeasurement.closedArea) {
      var firstPick = this._currentMeasurement.getPick(1);
      var firstPickPoint = this._MeasureCommon.getSnapResultPosition(firstPick, this._viewer);
      var firstPickPosition = this._MeasureCommon.project(firstPickPoint, this._viewer);
      var currentPickPoint = this._MeasureCommon.getSnapResultPosition(currentPick, this._viewer);
      var currentPickPosition = this._MeasureCommon.project(currentPickPoint, this._viewer);

      if (forceSnap || currentPickPosition.distanceTo(firstPickPosition) < this._closeAreaSnapRange) {
        this._snapper.onMouseMove(firstPickPosition);
        firstPick.copyTo(currentPick);
      }
    }
  }

  _checkSnapperIndicatorForArc() {
    if (!this._currentMeasurement) {
      this._snapper.setArc(true);
    }

    if (this._currentMeasurement?.measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_ARC && this._viewer.model.is2d()) {
      var firstPick = this._currentMeasurement && this._currentMeasurement.getPick(1);
      var secondPick = this._currentMeasurement && this._currentMeasurement.hasPick(2) && this._currentMeasurement.getPick(2);
      const isArc = !firstPick || this._currentMeasurement.countPicks().length > 2 || this._MeasureCommon.isEqualVectors(firstPick.circularArcCenter, secondPick.circularArcCenter, 0) && firstPick.circularArcRadius === secondPick.circularArcRadius;
      this._snapper.setArc(isArc);
    }
  }

  /**
   * Overrides each pick's viewportIndex2d in the current measurement with the passed in viewportIndex.
   * This function only overrides the viewport index if the current measurement's picks do not have the viewportIndex2d set.
   * (unless forceOverride is true)
   */
  _setMeasurePicksViewport(viewportIndex, forceOverride) {
    const picks = this._currentMeasurement.picks;
    for (var key in picks) {
      if (Object.prototype.hasOwnProperty.call(picks, key)) {
        // If the current measurement has a viewport index do not override the its picks viewport id with the previous measurement's.
        if (picks[key].viewportIndex2d && !forceOverride) {
          return;
        }
        picks[key].viewportIndex2d = viewportIndex;
      }
    }
  }

  render(showResult) {
    if (this.isCalibrationSetOnPage()) {
      this._setMeasurePicksViewport(0, true);
    } else if (this._useLastViewport && this._prevMeasurement && this._prevMeasurement.picks.length > 0) {
      // LMV-5498: Set the current measurement's picks viewport to the previous measurement's picks viewport.
      this._setMeasurePicksViewport(this._prevMeasurement.picks[0].viewportIndex2d);
    }

    var hasResult = this._currentMeasurement.computeResult(this._currentMeasurement.picks, this._viewer, this._snapper);
    this._currentMeasurement.indicator.render(this._currentMeasurement.picks, this._consumeSingleClick || !!showResult);

    // Update highlights during editing for custom tools (like laser measurements)
    if (this.isEditingEndpoint && this._currentMeasurement && this._currentMeasurement.isComplete()) {
      const customTool = this._customTools[this._currentMeasurement.measurementType];
      if (customTool && customTool.setMeasurementHighlights && this._active) {
        customTool.setMeasurementHighlights(this._currentMeasurement);
      }
    }

    return hasResult;
  }

  setUseLastViewport(value) {
    this._useLastViewport = value;
  }

  getUseLastViewport() {
    return this._useLastViewport;
  }

  /**
   * Sets existing measurements from the passed in measurement list. Reference getMeasurementList.
   *
   * @param {Object[]} measurementList - measurements to set.
   */
  setMeasurements(measurementList) {
    if (!measurementList) return; // Only set the a measurementList is passed in.
    measurementList = !Array.isArray(measurementList) ? [measurementList] : measurementList;

    if (measurementList.length === 0) return;

    const getMeasureType = (measureData) => {
      let measurementType;
      switch (measureData.type) {
        case 'Distance':
          measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE;
          break;
        case 'Angle':
          measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE;
          break;
        case 'Area':
          measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_AREA;
          break;
        case 'Arc':
          measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_ARC;
          break;
        case 'Spot':
          measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT;
          break;
        case 'Callout':
          measurementType = this._MeasureCommon.MeasurementTypes.MEASUREMENT_CALLOUT;
          break;
        default:
          // Check if any custom tool can handle this measurement type
          for (const customToolType in this._customTools) {
            const customTool = this._customTools[customToolType];
            if (customTool && customTool.getMeasurementTypeFromString) {
              const customType = customTool.getMeasurementTypeFromString(measureData.type);
              if (customType) {
                measurementType = customType;
                break;
              }
            }
          }

          // If no custom tool handled it, use the original type
          if (!measurementType) {
            measurementType = measureData.type;
          }
      }
      return measurementType;
    };

    // Restore the supplied measurementList.
    for (let i = 0; i < measurementList.length; i++) {
      const measureData = measurementList[i];
      const measurementType = getMeasureType(measureData);
      if (!measurementType) continue;
      const customTool = this._customTools[measurementType];
      let customMeasurement = null;
      let customIndicator = null;
      if (customTool) {
        customMeasurement = customTool.createMeasurement(measureData);
        customIndicator = customTool.getIndicatorClass();
      }

      const attachIndicatorCb = (measurement) => {
        this._currentMeasurement = measurement; // _currentMeasurement needs to be set for the onMeasurementChanged to work
        measurement.attachIndicator(this._viewer, this, customIndicator ? customIndicator : _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_1__.MeasureToolIndicator);

        if (this._onIndicatorCreatedCB instanceof Function) {
          this._onIndicatorCreatedCB();
          this._onIndicatorCreatedCB = null;
        }
      };

      const initPicksCb = () => {
        const restoredMeasurements = this._measurementsManager.getRestoredMeasurementData();
        const points = restoredMeasurements[this._currentMeasurement.id];
        this._activePoint = points.length;
      };

      this._measurementsManager.createMeasurementFromData(
        measureData,
        measurementType,
        attachIndicatorCb,
        initPicksCb,
        customMeasurement
      );
    }

    this.deselectAllMeasurements();
    this._enableMeasurementsTouchEvents(true);
  }

  _getMeasurementType(measurement) {
    measurement = measurement || this._currentMeasurement;
    const types = this._MeasureCommon.MeasurementTypes;
    const type = measurement.measurementType;

    switch (type) {
      case types.MEASUREMENT_DISTANCE:
        return 'Distance';
      case types.MEASUREMENT_ANGLE:
        return 'Angle';
      case types.MEASUREMENT_AREA:
        return 'Area';
      case types.CALIBRATION:
        return 'Calibration';
      case types.MEASUREMENT_ARC:
        return 'Arc';
      case types.MEASUREMENT_SPOT:
        return 'Spot';
      case types.MEASUREMENT_CALLOUT:
        return 'Callout';
      default:
        return type;
    }
  }

  /**
   * TODO: We need to flesh out the return value here.
   *
   * @param unitType
   * @param precision
   * @returns {Object}
   */
  getMeasurement(unitType, precision) {
    if (!this._currentMeasurement) {
      return null;
    }

    this._sharedMeasureConfig.units = unitType || this._sharedMeasureConfig.units;
    this._sharedMeasureConfig.precision = precision || this._sharedMeasureConfig.precision;

    var geomTypes = ['Vertex', 'Edge', 'Face', 'Circular Arc', 'Curved Edge', 'Curved Face'];
    var picks = this._getPickData();
    var type = this._getMeasurementType();
    var measurement = {
      from: geomTypes[this._currentMeasurement.getGeometry(1).type],
      to: picks.length > 1 ? geomTypes[this._currentMeasurement.getGeometry(2).type] : null,
      distance: this.getDistanceXYZ(),
      deltaX: this.getDistanceX(),
      deltaY: this.getDistanceY(),
      deltaZ: this.getDistanceZ(),
      angle: this.getAngle(),
      area: this.getArea(),
      arc: this.getArc(),
      location: this.getSpot(),
      text: this.getCallout(),
      unitType: this._sharedMeasureConfig.units,
      precision: this._sharedMeasureConfig.precision,
      picks,
      type
    };

    return measurement;
  }

  /**
   * @returns {SnapResult[]} list of points for the selected measurement.
   */
  getMeasurementPoints() {

    return this._currentMeasurement.clonePicks();
  }

  /**
   * @param unitType
   * @param precision
   * @returns {Array.<Object>}
   */
  getMeasurementList(unitType, precision) {
    var list = [];
    var measurement = null;
    // TODO: These need to match the measurement SnapTypes
    var geomTypes = ['Vertex', 'Edge', 'Face', 'Circular Arc', 'Curved Edge', 'Curved Face'];
    var measurementList = Object.keys(this._measurementsManager.measurementsList);

    for (let i = 0; i < measurementList.length; i++) {
      measurement = this._measurementsManager.measurementsList[measurementList[i]];
      var picks = this._getPickData(measurement);
      var type = this._getMeasurementType(measurement);
      var result = {
        from: geomTypes[measurement.getGeometry(1).type],
        to: picks.length > 1 ? geomTypes[measurement.getGeometry(2).type] : null,
        distance: this.getDistanceXYZ(measurement),
        deltaX: this.getDistanceX(measurement),
        deltaY: this.getDistanceY(measurement),
        deltaZ: this.getDistanceZ(measurement),
        angle: this.getAngle(measurement),
        area: this.getArea(measurement),
        arc: this.getArc(measurement),
        location: this.getSpot(measurement),
        text: this.getCallout(measurement),
        unitType: unitType || this._sharedMeasureConfig.units,
        precision: precision || this._sharedMeasureConfig.precision,
        picks,
        type
      };
      if (measurement.options) {
        const options = result.options = JSON.parse(JSON.stringify(measurement.options));
        if (!options.modelId && picks[0] && picks[0].modelId)
        options.modelId = picks[0].modelId;
        const model = options.modelId ? this._viewer.impl.findModel(options.modelId) : this._viewer.model;
        const globalOffset = model && model.getData().globalOffset;
        if (globalOffset && (globalOffset.x !== 0 || globalOffset.y !== 0 || globalOffset.z !== 0)) {
          const cvtPts = (points) => {
            if (points) {
              for (let i = 0; i < points.length; ++i) {
                // Tricky way to use Vector3 add on plain objects
                THREE.Vector3.prototype.add.call(points[i], globalOffset);
              }
            }
          };
          cvtPts(options.dimensionOffset);
          cvtPts(options.dashedLeader);
          cvtPts(options.arc);
        }
      }
      const customTool = this._customTools[type];
      if (customTool) {
        customTool.saveSessionMeasurement(measurement, result);
      }
      list.push(result);
    }
    return list;
  }

  getMeasurementCount() {
    return Object.keys(this._measurementsManager.measurementsList).length;
  }

  clearCurrentMeasurement() {

    if (this._currentMeasurement) {
      this.noPicksSet();

      for (var key in this._currentMeasurement.picks) {
        if (Object.prototype.hasOwnProperty.call(this._currentMeasurement.picks, key)) {
          this.clearPick(key);
        }
      }

      this.updateViewportId(true);

      if (this._isolateMeasure) {
        this.clearIsolate();
      }

      // Clear fragment highlights for the current measurement type
      // used mainly for measure deletion
      this._customTools[this._currentMeasurement.measurementType]?.clearFragmentHighlights?.();

      this._currentMeasurement.indicator?.clear();
      this._currentMeasurement.indicator?.destroy();
      this._measurementsManager.removeCurrentMeasurement();
      this._currentMeasurement = null;
    }

    this._enableMeasurementsTouchEvents(true);
  }

  clearPick(pickNumber) {
    if (this._currentMeasurement && this._currentMeasurement.hasPick(pickNumber)) {
      this._currentMeasurement.clearPick(pickNumber);
      this._currentMeasurement.indicator.hideClick(pickNumber);
    }
  }

  setIsolateMeasure(enable) {
    this._isolateMeasure = enable;
  }

  getIsolateMeasure() {
    return this._isolateMeasure;
  }

  isolateMeasurement() {

    if (!this._active || !this._isolateMeasure) {
      return;
    }

    var defaultModelId = this._viewer.model.id;
    var isolationGroups = {};

    for (var key in this._measurementsManager.measurementsList) {
      if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {

        var measurement = this._measurementsManager.measurementsList[key];
        for (let key in measurement.picks) {
          if (Object.prototype.hasOwnProperty.call(measurement.picks, key)) {
            var pick = measurement.getPick(key);

            var modelId = pick.modelId || defaultModelId;
            if (!Array.isArray(isolationGroups[modelId])) {
              isolationGroups[modelId] = [];
            }
            if (isolationGroups[modelId].indexOf(pick.snapNode) == -1) {
              isolationGroups[modelId].push(pick.snapNode);
            }
          }
        }

      }
    }


    // convert to expected format
    var isolationSet = [];
    for (let modelId in isolationGroups) {
      if (Object.prototype.hasOwnProperty.call(isolationGroups, modelId)) {

        var modelInstance = this._viewer.impl.findModel(parseInt(modelId));
        isolationSet.push({
          model: modelInstance,
          ids: isolationGroups[modelId]
        });
      }
    }

    if (isolationSet.length) {
      this._viewer.impl.visibilityManager.aggregateIsolate(isolationSet);
    }
  }

  // It actually restores the isolation state to the one just before
  // the measure tool was enabled...
  clearIsolate() {
    if (this._preMeasureState) {
      this._viewer.restoreState(this._preMeasureState, undefined, true);
    }
  }

  onShowAllEvent(event) {
    this._preMeasureState = null;
  }

  deselectAllMeasurements() {
    if (this._currentMeasurement && !this.areAllPicksSet()) {
      if (this.isEditingEndpoint) {
        this.undoEditEndpoint();
      } else
      {
        this.clearCurrentMeasurement();
      }
    }

    for (var key in this._measurementsManager.measurementsList) {
      if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
        var measurement = this._measurementsManager.measurementsList[key];
        if (measurement.indicator) {
          measurement.indicator.setSimple(true);
          measurement.indicator.hideEndpoints();
          measurement.indicator.unfocusLabels();
        }

        // Clear fragment highlights for the current measurement type
        // used mainly for laser measure deselection
        this._customTools[this._currentMeasurement?.measurementType]?.clearFragmentHighlights?.();
      }
    }

    this._currentMeasurement = null;
  }

  onExplodedChange() {
    this._exploded = true;
  }

  onMeasurementChanged() {

    this.deselectAllMeasurements();

    this._currentMeasurement = this._measurementsManager.getCurrentMeasurement();

    if (this._currentMeasurement?.isComplete()) {
      this._currentMeasurement.indicator.setSimple(false);
      this.allPicksSet();
      this.render(true);
      this.updateResults();

      // Let custom tools handle their own highlighting
      const customTool = this._customTools[this._currentMeasurement.measurementType];
      if (customTool && customTool.setMeasurementHighlights && this._active) {
        customTool.setMeasurementHighlights(this._currentMeasurement);
      }
    }
  }

  selectMeasurementById(measurementId) {
    if (!this._currentMeasurement) {
      this._currentMeasurement = this._measurementsManager.selectMeasurementById(measurementId);
    }

    if (this._currentMeasurement.id !== measurementId) {
      this.clearIncompleteMeasurement();

      this._currentMeasurement = this._measurementsManager.selectMeasurementById(measurementId);
    }

    this.controller.reportSelectionChange(this);
  }

  hoverMeasurementById(_measurementId) {
    this.updateMeasurementPreview(false);
    this._snapper.indicator.clearOverlays();
  }

  _enableMeasurementsTouchEvents(enable) {
    for (var key in this._measurementsManager.measurementsList) {
      if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
        var measurement = this._measurementsManager.measurementsList[key];
        measurement.indicator.changeAllEndpointsEditableStyle(enable);
        measurement.indicator.enableSelectionAreas(enable);
        measurement.indicator.enableLabelsTouchEvents(enable);
      }
    }
  }

  editEndpoint(event, endpointNumber, measurementId) {
    if (this._currentMeasurement.id === measurementId && this._activePoint === endpointNumber) {
      this._currentMeasurement.indicator.changeEndpointOnEditStyle(endpointNumber, false);
      this.undoEditEndpoint();
      return;
    }

    this.selectMeasurementById(measurementId);
    this._viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'start' });

    this._activePoint = endpointNumber;
    this.isEditingEndpoint = true;

    this._currentMeasurement.indicator.changeEndpointOnEditStyle(endpointNumber, true);

    this._enableMeasurementsTouchEvents(false);

    for (var key in this._currentMeasurement.picks) {
      if (Object.prototype.hasOwnProperty.call(this._currentMeasurement.picks, key)) {
        this._picksBackup[key] = this._currentMeasurement.getPick(key).clone();
      }
    }

    this.updateViewportId();

    if (this._isolateMeasure) {
      this.clearIsolate();
    }

    if (this._currentMeasurement.isRestored) {
      // populate the existing picks with the new snap result from the snapper
      this._snapper.onMouseMove({ x: event.canvasX, y: event.canvasY });
      const snapResult = this._snapper.getSnapResult().clone();
      const pick = this._currentMeasurement.getPick(this._activePoint);
      snapResult.copyTo(pick);

      // Handle custom tool-specific endpoint editing
      const customTool = this._customTools[this._currentMeasurement.measurementType];
      if (customTool && customTool.handleEndpointEdit) {
        customTool.handleEndpointEdit(this._currentMeasurement, pick);
      }

      // Keep track of the pick that was updated.
      pick.isValid = true;

      // Set isRestored flag back to false if all of the picks have been validated
      const checkAllPicksValid = () => {
        const picks = this._currentMeasurement.picks;
        for (var key in picks) {
          if (Object.prototype.hasOwnProperty.call(picks, key)) {
            const pick = picks[key];
            if (!pick.isValid) {
              return false;
            }
          }
        }
        return true;
      };
      this._currentMeasurement.isRestored = !checkAllPicksValid();
    }

    if (!this._av.isMobileDevice()) {
      this._handleMouseEvent(event);
    }
  }

  canCloseArea() {
    return this._currentMeasurement.countPicks() > 3;
  }

  undoEditEndpoint() {
    this._currentMeasurement.indicator.clear();

    for (var key in this._currentMeasurement.picks) {
      if (Object.prototype.hasOwnProperty.call(this._currentMeasurement.picks, key)) {
        this._currentMeasurement.setPick(key, this._picksBackup[key].clone());
      }
    }

    this._currentMeasurement.indicator.changeEndpointOnEditStyle(this._activePoint, false);

    this.isEditingEndpoint = false;
    this.updateViewportId(true);
    this.allPicksSet();
    this.render(true);
  }

  updateResults() {

    this._currentMeasurement.indicator.updateResults();
    this._currentMeasurement.indicator.showEndpoints();
    this._currentMeasurement.indicator.focusLabels();

    if (this._currentMeasurement.isComplete()) {
      this.isolateMeasurement();
      this._currentMeasurement.finalize?.();
    }
  }

  /**
   * Delete all measurements.
   */
  deleteMeasurements() {
    const measurements = this._measurementsManager.measurementsList;
    const keys = Object.keys(measurements);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      this._measurementsManager.currentMeasurement = measurements[key];
      this._currentMeasurement = this._measurementsManager.getCurrentMeasurement();
      this.deleteCurrentMeasurement();
    }
  }

  deleteCurrentMeasurement() {
    // Keeping a copy of current measurement so send info in event.
    let _deletedMeasurement = this._currentMeasurement ? this._currentMeasurement.clone() : null;
    this.clearCurrentMeasurement();
    this.isEditingEndpoint = false;
    this.editByDrag = false;
    this._isDragging = false;
    this.isolateMeasurement();
    if (_deletedMeasurement) {
      this._viewer.dispatchEvent({
        type: this._MeasureCommon.Events.DELETE_MEASUREMENT,
        data: { type: _deletedMeasurement.measurementType, id: _deletedMeasurement.id }
      });
    }
    _deletedMeasurement = null;
  }

  deleteCurrentPick() {

    var pick = this.getActivePick();
    var id = pick.id;

    while (this._currentMeasurement.hasPick(id + 1)) {
      this._currentMeasurement.setPick(id, this._currentMeasurement.getPick(id + 1));
      id++;
    }

    delete this._currentMeasurement.picks[id];



    var count = this._currentMeasurement.countPicks();

    this._activePoint--;

    if (this._activePoint <= 0) {
      this._activePoint = count;
    }

    if (this.isEditingEndpoint) {
      if (count == 2) {
        this.deleteCurrentMeasurement();
        return;
      }

      this._currentMeasurement.indicator.changeAllEndpointsOnEditStyle(false);
      this.isEditingEndpoint = false;
      this.updateViewportId(true);
      this.allPicksSet();
      this.render();
    } else {
      this._handleMouseEvent();
    }
  }

  updateViewportId(clear) {
    if (this._viewer.model && this._viewer.model.is2d()) {
      if (clear || this.isNoPicksSet() || this.isCalibrationSetOnPage()) {
        this._viewer.impl.updateViewportId(0);
        this._snapper.setViewportId(null);
      } else
      if (!this._isPressing) {
        var viewport = this.getPreviousPick()?.viewportIndex2d || this.getActivePick().viewportIndex2d;

        // Pass viewport Id to LineShader to make all other geometries with different viewport transparent
        this._viewer.impl.updateViewportId(viewport);
        if (this._snapper)
        this._snapper.setViewportId(viewport);

        // Use desired viewport precision if defined
        const viewports = this._viewer.model.getData()?.viewports;
        if (this._sharedMeasureConfig.useViewportInfo && viewports.length > 1) {
          this.setPrecision(viewports[viewport]?.precision);
        }
      }
    }
  }

  // Setting session measurements before activating measure needed
  // some special handling for the topology state. The problem was
  // that the indicators were set to 'fetching', and were cleared from
  // _currentMeasurement before the the topology fetch could finish.
  // I changed the logic to track all of the measurements that were
  // marked as fetching and clear them when the fetch is finished.
  // Clear fetching state in all measurements that were created
  // while we were fetching topology. The stateSetter is the name
  // of the method that sets the correct state.
  _changeFetchingState(stateSetter) {
    // call setter for all measurements in the list
    for (let i = 0; i < this._fetchingMeasurements.length; ++i) {
      var measurement = this._fetchingMeasurements[i];
      measurement.indicator[stateSetter]();
    }
    // Clear list
    this._fetchingMeasurements.length = 0;
  }

  setNoTopology() {
    // Change existing indicators
    this._changeFetchingState("setNoTopology");
    // Set state for future measurements
    this._onIndicatorCreatedCB = () => {this._currentMeasurement.indicator.setNoTopology();};
  }

  setFetchingTopology() {
    // Set state for future measurements
    this._onIndicatorCreatedCB = () => {
      this._fetchingMeasurements.push(this._currentMeasurement);
      this._currentMeasurement.indicator.setFetchingTopology();
    };
    // Change existing indicator
    if (this._currentMeasurement && this._currentMeasurement.indicator)
    this._onIndicatorCreatedCB();
  }

  setTopologyAvailable() {
    // Change existing indicators
    this._changeFetchingState("setTopologyAvailable");
    // Set state for future measurements
    this._onIndicatorCreatedCB = () => {this._currentMeasurement.indicator.setTopologyAvailable();};
  }

  getSnapper() {
    return this._snapper;
  }

  getViewer() {
    return this._viewer;
  }

  getSharedMeasureConfig() {
    return this._sharedMeasureConfig;
  }

  correctPickPosition() {
    // Custom tools can implement their own correctPickPosition method
    const customTool = this._customTools[this._measurementType];
    if (customTool && customTool.correctPickPosition) {
      customTool.correctPickPosition();
      return;
    }

    var active = this.getActivePick();

    if (active && !active.getGeometry() && this._cursorPosition) {
      active.geomType = this._MeasureCommon.SnapType.SNAP_VERTEX;
      active.geomVertex = this._cursorPosition;
      active.intersectPoint = this._cursorPosition;
    }

    if (this.hasPreviousPick()) {
      var passive = this.getPreviousPick();
      var corrected = this._MeasureCommon.correctPerpendicularPicks(passive, active, this._viewer, this._snapper);
      if (!corrected) {

        // get next pick in case of closed loop measurement.
        var id = (active.id + 1) % (this._currentMeasurement.countPicks() + 1);

        if (id === 0)
        id = 1;

        if (id !== active.id && this._currentMeasurement.hasPick(id)) {
          var nextPick = this._currentMeasurement.getPick(id);
          this._MeasureCommon.correctPerpendicularPicks(nextPick, active, this._viewer, this._snapper);
        }
      }

      if (this._currentMeasurement.measurementType == this._MeasureCommon.MeasurementTypes.MEASUREMENT_AREA) {
        this.snapToFirstPick(active);
      }
    }
  }

  clearMeasurementPreview() {
    this.updateMeasurementPreview(false);
    this.measurementPreview = null;
  }

  // Method to draw a preview of a measurement before it is even created. This may be implemented for single pick measurements.
  updateMeasurementPreview(show = true) {
    const snapResult = this._snapper.getSnapResult();

    const customTool = this._customTools[this._measurementType];
    if (customTool) {
      customTool.updateMeasurementPreview(show ? snapResult : null, this._currentMeasurement);
      return;
    }

    if (this._measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT) {
      if (show && snapResult && snapResult.intersectPoint) {
        if (!this.measurementPreview) {
          this.measurementPreview = new _src_measurement_Measurement_js__WEBPACK_IMPORTED_MODULE_5__.Measurement(this._measurementType, 'measurementPreview');
          this.measurementPreview.attachIndicator(this._viewer, this, _MeasureToolIndicator_js__WEBPACK_IMPORTED_MODULE_1__.MeasureToolIndicator);
        }

        // render the preview
        this.measurementPreview.setPick(1, snapResult);
        this.measurementPreview.computeResult(this.measurementPreview.picks, this._viewer, this._snapper);

        this.measurementPreview.indicator.render(this.measurementPreview.picks, true, true);

        // make sure the pointer label is always on top
        const indicator = this.measurementPreview.indicator;
        if (indicator.spotLabel.label) {
          indicator.spotLabel.label.id = 'measurement-preview-pointer-label';
          indicator.spotLabel.label.style.zIndex = 4;
        }
        if (indicator.endpoints[1] && this.measurementPreview.indicator.endpoints[1].label) {
          indicator.endpoints[1].label.id = 'measure-pointer-label';
        }

        // remove things we don't want to see on a preview
        indicator.clearSelectionAreas();
        indicator.hideEndpoints();
        indicator.clearSpotMesh();
      } else {
        this.measurementPreview?.indicator.clear();
      }
    }
  }

  _handleMouseEvent(event) {

    // Check if custom tool prevents measurement
    const customTool = this._customTools[this._measurementType];
    if (customTool && customTool.isNoMeasurementPossible && customTool.isNoMeasurementPossible()) {
      return false;
    }

    var valid = false;

    if (this._snapper.isSnapped()) {

      // User picked a new point after two points where already set (or none) - Start a new measurement.
      if (this.areAllPicksSet() || this.isNoPicksSet()) {
        this.startNewMeasurement();
        this._activePoint = 1;
      }

      this._snapper.copyResults(this.getActivePick());
      if (!this._viewer.model.is2d()) {
        let viewport = this._viewer.container.getBoundingClientRect();
        let x = event.canvasX || event.clientX - viewport.left;
        let y = event.canvasY || event.clientY - viewport.top; // x and y only used for hitTestViewport method
        // hitTestViewport doesn't work when measuring from center of a circle
        let newpick = this.getActivePick();
        let pick = this._viewer.impl.hitTestViewport(this._viewer.impl.clientToViewport(x, y));

        if (newpick) {
          const fragList = this._viewer.model.getFragmentList();
          const matrix = new three__WEBPACK_IMPORTED_MODULE_4__.Matrix4();
          if (newpick.geomFace?.fragId || newpick.geomFace?.fragId === 0) {
            this.getActivePick().fragId = newpick.geomFace.fragId;
          } else {
            this.getActivePick().fragId = pick?.fragId;
          }
          fragList.getWorldMatrix(this.getActivePick().fragId, matrix); // get fragment Local To World Matrix
          const fragPos = new three__WEBPACK_IMPORTED_MODULE_4__.Vector3().applyMatrix4(matrix); // get Fragment Position
          this.getActivePick().fragPos = { x: fragPos.x, y: fragPos.y, z: fragPos.z }; // save fragment position
        }
      }


      // When user is in the arc measurement mode and the user clicks on a different circle than the first point, then don't do anything
      if (this._consumeSingleClick && this._currentMeasurement?.measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_ARC) {
        if (!this._currentMeasurement.getPick(1).circularArcCenter ||
        this._currentMeasurement.hasPick(2) && !(this._MeasureCommon.isEqualVectors(this._currentMeasurement.getPick(1).circularArcCenter, this._currentMeasurement.getPick(2).circularArcCenter, 0) &&
        this._currentMeasurement.getPick(1).circularArcRadius === this._currentMeasurement.getPick(2).circularArcRadius)) {
          return false;
        }
      }

      valid = true;

    } else
    {
      // In order to draw rubber-band, set the cursor position, so the indicator will use it as active point.
      if (event && this._viewer.model) {
        var viewport = this._viewer.container.getBoundingClientRect();
        var x = event.canvasX || event.clientX - viewport.left;
        var y = event.canvasY || event.clientY - viewport.top;

        if (x && y) {
          let canDrawRubberBand;
          if (this._viewer.impl.is2d) {
            canDrawRubberBand = true;
          } else {
            const renderer = this._viewer.impl.renderer();
            const res = [];
            renderer.idAtPixel(x, y, res);
            const modelId = res[1];
            if (modelId > 0) {
              const model = this._viewer.impl.modelQueue().findModel(modelId);
              canDrawRubberBand = model?.is2d();
            }
          }

          this._cursorPosition = canDrawRubberBand ? this._MeasureCommon.inverseProject({ x: x, y: y }, this._viewer) : null;
        }
      }

      // In case a measurement is set, and the user clicks on a blank spot - clear any selection.
      if (this._consumeSingleClick && this._currentMeasurement && !this.isEditingEndpoint) {
        if (this._activePoint === this._currentMeasurement.getMaxNumberOfPicks() + 1) {
          return false;
        }
      }

      var lastPick = this.getActivePick();
      if (lastPick) {
        lastPick.clear();
      }
    }

    if (this._currentMeasurement) {
      this.correctPickPosition();

      if (this._consumeSingleClick) {
        this._doConsumeSingleClick();
      }

      if (!this.isNoPicksSet()) {
        var renderSucceeded = this.render();

        // If it's the first pick, we don't expect the render of the rubberband to be succeeded.
        // So enter here only if it's not the first pick.
        if (this._currentMeasurement.hasPick(2)) {
          valid &= renderSucceeded;
        }
      }
    }

    // If valid is false, the last pick is not revelant, and will clear it in case of a click.
    return valid;
  }

  _doConsumeSingleClick() {
    // In case the measurement is a closed loop, eliminate the last pick.
    if (this._currentMeasurement.measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_AREA && !this._currentMeasurement.closedArea) {
      var length = this._currentMeasurement.countPicks();
      var firstPick = this._currentMeasurement.getPick(1);
      var lastPick = this._currentMeasurement.getPick(length);

      if (length >= 3 && this._currentMeasurement.hasEqualPicks(firstPick, lastPick)) {
        lastPick.clear();
        delete this._currentMeasurement.picks[length];
        this._currentMeasurement.closedArea = true;
      }
    }

    this.updateResults();

    var measurementComplete = this._currentMeasurement.isComplete();
    this.updateViewportId(measurementComplete);
    this._viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: measurementComplete ? 'end' : 'start' });

    const customTool = this._customTools[this._currentMeasurement.measurementType];
    avp.analytics.track('viewer.measure', {
      action: 'Measurement',
      type: customTool ? customTool.getMeasurementName() : this._MeasureCommon.MeasurementTypesToAnalytics[this._currentMeasurement.measurementType],
      snapping: this.getActivePick()?.geomType !== this._MeasureCommon.SnapType.RASTER_PIXEL
    });
  }

  handleButtonDown(event, button) {
    if (this._av.isMobileDevice())
    return false;

    this._isDragging = true;
    this._viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'start' });
    if (button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      this._consumeSingleClick = true;
      this._downX = event.canvasX;
      this._downY = event.canvasY;
    }
    return false;
  }

  handleMouseMove(event) {

    if (this._av.isMobileDevice())
    return false;

    if (event.canvasX !== this._downX || event.canvasY !== this._downY) {
      this._consumeSingleClick = false;
    }

    this._endpointMoved = this.isEditingEndpoint;

    if (!this.isNoPicksSet() && !this.areAllPicksSet()) {
      this.clearPick(this._activePoint);
      this._handleMouseEvent(event);
    }

    this._checkSnapperIndicatorForArc();

    // Check if custom tool allows snapper indicator rendering
    let shouldRenderSnapperIndicator = true;
    const customTool = this._customTools[this._measurementType];
    if (customTool && customTool.shouldRenderSnapperIndicator) {
      shouldRenderSnapperIndicator = customTool.shouldRenderSnapperIndicator(this._measurementType, this._snapper);
    }

    // Only render normal snapper indicators if no measurement is impossible and it's allowed for the current tool
    if (shouldRenderSnapperIndicator) {
      this._snapper.indicator.render();
    }

    this._snapper.indicator.render();

    this.updateMeasurementPreview(!this.isEditingEndpoint);
    return false;
  }

  restoreMouseListeners() {

    // When a press event has happend, the default behavior of firefly.js is to disable other mouse events,
    // So they won't be triggered as well.
    // The solution is to enable them after the end of the pressing.

    this._viewer.toolController.getTool("gestures").controller.enableMouseButtons(true);
  }

  handlePressHold(event) {
    this._consumeSingleClick = false;

    if (this._av.isTouchDevice()) {
      switch (event.type) {

        case "press":
          this._isPressing = true;

          if (this.areAllPicksSet() || this.isNoPicksSet()) {
            this.startNewMeasurement();

            if (this._isolateMeasure) {
              this.clearIsolate();
            }

            this._activePoint = 1;
          }

          this._handleMouseEvent(event);
          this._snapper.indicator.render();

          return true;

        case "pressup":
          this._consumeSingleClick = true;
          this.restoreMouseListeners();
          this._singleClickHandled = !this._singleClickHandled;
          this.handleSingleClick(event);
          this._isPressing = false;
          return true;
      }
    }
    return false;

  }

  handleGesture(event)
  {
    if (this._av.isTouchDevice()) {

      this._consumeSingleClick = false;

      if (this._isPressing) {

        this.clearPick(this._activePoint);

        switch (event.type) {

          case "dragstart":
            this._handleMouseEvent(event);
            this._snapper.indicator.render();

            return true;

          case "dragmove":
            this._handleMouseEvent(event);
            this._snapper.indicator.render();

            return true;

          case "dragend":
            this._isPressing = false;
            this._consumeSingleClick = true;

            if (!this.editByDrag) {
              this._singleClickHandled = !this._singleClickHandled;
              this.handleSingleClick(event);
            }

            this.editByDrag = false;
            this.restoreMouseListeners();
            return true;

          case "pinchstart":
            this._handleMouseEvent(event);
            this._snapper.indicator.render();

            break;

          case "pinchmove":
            this._handleMouseEvent(event);
            this._snapper.indicator.render();

            break;

          case "pinchend":
            this._consumeSingleClick = true;
            this._singleClickHandled = !this._singleClickHandled;
            this.handleSingleClick(event);
            this.restoreMouseListeners();
            return true;
        }
      }

      if (event.type.indexOf('pinch') !== -1) {
        for (var key in this._measurementsManager.measurementsList) {
          if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
            var measurement = this._measurementsManager.measurementsList[key];
            measurement.indicator.updateScale();
          }
        }
      }
    }

    return false;
  }

  handleButtonUp(event, button) {
    this._isDragging = false;
    this._viewer.dispatchEvent({ type: _EventTypes_js__WEBPACK_IMPORTED_MODULE_2__.SET_MOUSE_TRACKING, mode: 'end' });
    this._downX = null;
    this._downY = null;

    if (this._endpointMoved) {
      this._consumeSingleClick = true;
      this._singleClickHandled = !this._singleClickHandled;
      this.handleSingleClick(event);
      this._endpointMoved = false;
    }

    return false;
  }

  handleSingleClick(event, button) {
    if (this._consumeSingleClick) {

      this._snapper.indicator.clearOverlays();

      if (this._currentMeasurement) {
        this._currentMeasurement.indicator.changeEndpointOnEditStyle(this._activePoint, false);
      }

      if (this._handleMouseEvent(event)) {
        this.updateResults();
        this._activePoint++;
      } else
      {
        if (this.isEditingEndpoint) {
          this.undoEditEndpoint();
        } else
        {
          if (this._currentMeasurement && this._currentMeasurement.measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_AREA && this.canCloseArea()) {
            this.snapToFirstPick(this.getActivePick(), true);
            this._handleMouseEvent();
          } else if (this._currentMeasurement && this.areAllPicksSet()) {
            // For complete measurements, deselect instead of clearing
            this.deselectAllMeasurements();
          } else {
            this.clearCurrentMeasurement();
          }
        }
      }

      if (this._currentMeasurement && this._currentMeasurement.isComplete()) {
        // Custom tools handle their own highlighting in onMeasurementChanged
        const customTool = this._customTools[this._currentMeasurement.measurementType];
        if (customTool && customTool.setMeasurementHighlights && this._active) {
          customTool.setMeasurementHighlights(this._currentMeasurement);
        }
        this.allPicksSet();
      }

      this._consumeSingleClick = false;
      this._singleClickHandled = !this._singleClickHandled;
      this.isEditingEndpoint = false;

      this._snapper.clearSnapped();
    }
    return true;
  }

  handleDoubleClick(event) {
    return true;
  }

  onCameraChange() {
    for (var key in this._measurementsManager.measurementsList) {
      if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
        var measurement = this._measurementsManager.measurementsList[key];
        measurement.indicator.updateScale();
      }
    }

    this._snapper.indicator.onCameraChange();
  }

  handleSingleTap(event) {
    if (!this._singleClickHandled) {
      this._consumeSingleClick = true;
      this._snapper.onMouseDown({ x: event.canvasX, y: event.canvasY });
      this.handleSingleClick(event);
    }
    this._singleClickHandled = !this._singleClickHandled;

    return true;
  }

  handleDoubleTap(event) {
    if (this._currentMeasurement && this._currentMeasurement.measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_AREA && this._currentMeasurement.countPicks() > 2) {
      // fake single click over the first handle, to close the area.
      var firstPick = this._currentMeasurement.getPick(1);
      var firstPickPoint = this._MeasureCommon.getSnapResultPosition(firstPick, this._viewer);
      var firstPickPosition = this._MeasureCommon.project(firstPickPoint, this._viewer);
      event.canvasX = firstPickPosition.x;
      event.canvasY = firstPickPosition.y;
      this._consumeSingleClick = true;
      this._snapper.onMouseDown(firstPickPosition);
      this.handleSingleClick(event);
      this._singleClickHandled = !this._singleClickHandled;
    }

    return true;
  }

  handleResize() {
    for (var key in this._measurementsManager.measurementsList) {
      if (Object.prototype.hasOwnProperty.call(this._measurementsManager.measurementsList, key)) {
        var measurement = this._measurementsManager.measurementsList[key];
        if (measurement.indicator) {
          measurement.indicator.handleResize();
        }
      }
    }
  }

  handleKeyDown(event, keyCode) {
    switch (keyCode) {
      case Autodesk.Viewing.KeyCode.ESCAPE:{
          if (this._currentMeasurement && !this.areAllPicksSet()) {
            // When there is an incomplete measurement, pressing ESCAPE should clear it.
            this.clearCurrentMeasurement();
            return true;
          } else if (this._currentMeasurement && this._currentMeasurement.isComplete()) {
            // When there is a measurement selected, pressing ESCAPE should deselect it.
            this.deselectAllMeasurements();
            return true;
          }
        }break;

      case Autodesk.Viewing.KeyCode.BACKSPACE:
      case Autodesk.Viewing.KeyCode.DELETE:{
          if (!this._currentMeasurement) {
            return false;
          }
          if (this._currentMeasurement.measurementType === this._MeasureCommon.MeasurementTypes.MEASUREMENT_AREA && !this.areAllPicksSet()) {
            if (this._currentMeasurement.countPicks() > 2) {
              this.deleteCurrentPick();
            } else {
              this.deleteCurrentMeasurement();
            }
          } else {
            this.deleteCurrentMeasurement();
          }

          return true;
        }
    }

    return false;
  }

  // When calibration is set on viewport 0, all measurements should be done on it, regardless of where they started
  isCalibrationSetOnPage() {
    return this._options.calibrateWithPage && this._sharedMeasureConfig.calibrationFactor != null;
  }

  handleSelectionChange() {
    this.deselectAllMeasurements();
  }

}

/**
 * Adds secondary units to a primary value if secondary units are enabled and different from primary.
 * Standalone helper function for use outside the MeasureTool class.
 * @param {string} primaryValue - The formatted primary value with units
 * @param {number} rawValue - The raw measurement value to convert
 * @param {string} sourceUnits - The source units (model units)
 * @param {Object} sharedMeasureConfig - The shared measurement configuration
 * @param {string} [unitModifier] - Optional modifier for units (e.g., 'square' for area)
 * @returns {string} Primary value with optional secondary value in format: "primaryValue (~secondaryValue)"
 */
function addSecondaryUnits(primaryValue, rawValue, sourceUnits, sharedMeasureConfig, unitModifier = null) {
  if (!sharedMeasureConfig.enableSecondaryUnits ||
  !sharedMeasureConfig.secondaryUnits ||
  sharedMeasureConfig.secondaryUnits === '' ||
  sharedMeasureConfig.secondaryUnits === 'please-select' ||
  sharedMeasureConfig.secondaryUnits === sharedMeasureConfig.units) {
    return primaryValue;
  }

  const convertType = unitModifier === 'square' ? 'square' : undefined;
  const secondaryConverted = Autodesk.Viewing.Private.convertUnits(
    sourceUnits,
    sharedMeasureConfig.secondaryUnits,
    sharedMeasureConfig.calibrationFactor,
    rawValue || 0,
    convertType
  );

  const secondaryUnitString = unitModifier === 'square' ?
  sharedMeasureConfig.secondaryUnits + '^2' :
  sharedMeasureConfig.secondaryUnits;

  const secondaryValue = Autodesk.Viewing.Private.formatValueWithUnits(
    secondaryConverted,
    secondaryUnitString,
    3,
    sharedMeasureConfig.precision
  );

  return `${primaryValue} (${secondaryValue})`;
}

/**
 * Shared getDistanceAux function that can be used by other measurement tools.
 * This function is extracted from MeasureTool to avoid code duplication.
 * @param {Object} viewer - The viewer instance
 * @param {Object} sharedMeasureConfig - The shared measurement configuration
 * @param {number} measurementDistance - The raw measurement distance
 * @param {string} viewportUnits - Optional viewport-specific units
 * @returns {string} Formatted distance string with units
 */
function getDistanceAux(viewer, sharedMeasureConfig, measurementDistance, viewportUnits) {
  if (viewer.model) {
    let units = viewer.model.getUnitString();

    // In case the viewport, we measured in, defines its own units, use those instead
    // Caveat: We can do this only for SmartPdfs coming from DS as otherwise the model unit string might not match the
    // transform stored in the viewport
    if (sharedMeasureConfig.useViewportInfo && viewportUnits && sharedMeasureConfig.calibrationFactor === null)
    units = viewportUnits;

    const d = Autodesk.Viewing.Private.convertUnits(units, sharedMeasureConfig.units, sharedMeasureConfig.calibrationFactor, measurementDistance || 0);
    const primaryValue = Autodesk.Viewing.Private.formatValueWithUnits(d, sharedMeasureConfig.units, 3, sharedMeasureConfig.precision);

    return addSecondaryUnits(primaryValue, measurementDistance, units, sharedMeasureConfig);
  }
}

/**
 * Shared getArea function that can be used by other measurement tools.
 * This function is extracted from MeasureTool to avoid code duplication.
 * @param {Object} viewer - The viewer instance
 * @param {Object} sharedMeasureConfig - The shared measurement configuration
 * @param {Object} measurementArea - The measurement area
 * @returns {string} Formatted area string with units
 */

function getArea(viewer, sharedMeasureConfig, measurementArea) {

  if (viewer.model) {

    let units = viewer.model.getUnitString();

    const viewportUnits = measurementArea?.result?.units;
    if (sharedMeasureConfig.useViewportInfo && viewportUnits && sharedMeasureConfig.calibrationFactor === null)
    units = viewportUnits;

    const area = Autodesk.Viewing.Private.convertUnits(units, sharedMeasureConfig.units, sharedMeasureConfig.calibrationFactor, measurementArea.area, 'square');

    let primaryValue;
    if (sharedMeasureConfig.units) {
      primaryValue = Autodesk.Viewing.Private.formatValueWithUnits(area, sharedMeasureConfig.units + '^2', 3, sharedMeasureConfig.precision);
    } else
    {
      primaryValue = Autodesk.Viewing.Private.formatValueWithUnits(area, null, 3, sharedMeasureConfig.precision);
    }

    return addSecondaryUnits(primaryValue, measurementArea.area, units, sharedMeasureConfig, 'square');
  }
}

/***/ },

/***/ "./extensions/Measure/MeasureToolIndicator.js"
/*!****************************************************!*\
  !*** ./extensions/Measure/MeasureToolIndicator.js ***!
  \****************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MeasureLabelClasses: () => (/* binding */ MeasureLabelClasses),
/* harmony export */   MeasureToolIndicator: () => (/* binding */ MeasureToolIndicator)
/* harmony export */ });
/* harmony import */ var _Indicator_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./Indicator.js */ "./extensions/Measure/Indicator.js");
/* harmony import */ var _PolygonCentroid_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./PolygonCentroid.js */ "./extensions/Measure/PolygonCentroid.js");



var av = Autodesk.Viewing;
var MeasureCommon = Autodesk.Viewing.MeasureCommon;

/** Color values should match Measure.css **/
const DEFAULT_LINE_COLOR = '009bea';
const X_AXIS_COLOR = "F12C2C";
const Y_AXIS_COLOR = "0BB80B";
const Z_AXIS_COLOR = "2C2CF1";
/*******************************************/

const LINE_CLASS_NAME = 'adsk-icon-axis-delta';

const MeasureLabelClasses = Object.freeze({
  pill: 'measure-label-pill',
  prefix: 'measure-label-prefix',
  value: 'measure-label-value'
});

const tmpColor = new THREE.Color();
function numToColor(num) {
  return tmpColor.set(num >>> 8).getHexString();
}

// /** @constructor */
function MeasureToolIndicator(viewer, measurement, measureTool)
{
  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.call(this, viewer, measurement, measureTool);
  this.measureTool = measureTool;
  this.endpoints = [];
  this.lines = {
    xyz: { axis: false, material: this._createLineMaterial(DEFAULT_LINE_COLOR), className: LINE_CLASS_NAME + '-xyz measure-label-axis-delta' + ' measure-label-axis-xyz' },
    x: { axis: true, material: this._createLineMaterial(X_AXIS_COLOR), className: LINE_CLASS_NAME + '-x measure-label-axis-delta' + ' measure-label-axis-x', iconText: 'X' },
    y: { axis: true, material: this._createLineMaterial(Y_AXIS_COLOR), className: LINE_CLASS_NAME + '-y measure-label-axis-delta' + ' measure-label-axis-y', iconText: 'Y' },
    z: { axis: true, material: this._createLineMaterial(Z_AXIS_COLOR), className: LINE_CLASS_NAME + '-z measure-label-axis-delta' + ' measure-label-axis-z', iconText: 'Z' }
  };
  this.applyLineColor(this.lines.xyz.material);
  this.segments = [];
  this.dashedLines = [];
  this.simple = false;
  this.angleLabel = {};
  this.areaLabel = {};
  this.arcLabel = {};
  this.spotLabel = {};
  this.calloutLabel = {};
  this.labels = [];
  this.isLeaflet = false;
  this.topologyStatus = TOPOLOGY_NOT_AVAILABLE;
  this.tmpVector = new THREE.Vector3();
  this.surfaceColor = new Autodesk.Viewing.Scene.UnlitMaterial({
    color: parseInt(DEFAULT_LINE_COLOR, 16),
    opacity: 0.15,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  this.applyLineColor(this.surfaceColor);
  this.topLabel = null;
  this.allowShortDistances = false;
  this.segmentWidth = 4;
}

MeasureToolIndicator.prototype = Object.create(_Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype);
MeasureToolIndicator.prototype.constructor = MeasureToolIndicator;
var proto = MeasureToolIndicator.prototype;

var _labelsSpace = 4;
var _angleLabelOffset = 5;
var TOPOLOGY_NOT_AVAILABLE = 0;
var TOPOLOGY_FETCHING = 1;
var TOPOLOGY_AVAILABLE = 2;
var _selectorAreaSize = 15;

var _tipHeight = 2;
var _tipWidth = 3;

var _dashedSegmentWidth = 3;
var _axisLineWidth = 2;
var _dashSize = 2;
var _gapSize = 1;

var _angleArcWidth = 2;

proto.init = function () {
  this.isLeaflet = this.viewer.model?.isLeaflet();
  // Create HTML Labels
  var currLabel;

  this.onSelectionAreaClickedBinded = this.onSelectionAreaClicked.bind(this);
  this.onSelectionAreaDblClickedBinded = this.onSelectionAreaDblClicked.bind(this);
  this.onMeasurementHoveredBinded = this.onMeasurementHovered.bind(this);

  // Line
  if (!this.lines.xyz.label) {
    currLabel = this.lines.xyz.label = this.createMeasurementLabel(); // Measurement result
    this._addEventListener(currLabel);
    this.viewer.container.appendChild(currLabel);
  }
  switch (this.topologyStatus) {
    case TOPOLOGY_FETCHING:
      this.setFetchingTopology();
      break;
    case TOPOLOGY_AVAILABLE:
      this.setTopologyAvailable();
      break;
    case TOPOLOGY_NOT_AVAILABLE:
      this.setNoTopology();
      break;
  }

  this.showMeasureResult = false;

  this.onCameraChangeBinded = this.onCameraChange.bind(this);
  this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);

  this.handleButtonUpBinded = this.measureTool.handleButtonUp.bind(this.measureTool);
  this.addWindowEventListener('mouseup', this.handleButtonUpBinded);
};

proto._addEventListener = function (element) {
  if (!element) {
    return;
  }

  element.addEventListener('mousewheel', this.viewer.toolController.mousewheel);
  element.addEventListener('click', this.onSelectionAreaClickedBinded);
  element.addEventListener('dblclick', this.onSelectionAreaDblClickedBinded);
  element.addEventListener('mouseover', this.onMeasurementHoveredBinded);
};

proto._removeEventListener = function (element) {
  if (!element) {
    return;
  }

  element.removeEventListener('mousewheel', this.viewer.toolController.mousewheel);
  element.removeEventListener('click', this.onSelectionAreaClickedBinded);
  element.removeEventListener('dblclick', this.onSelectionAreaDblClickedBinded);
  element.removeEventListener('mouseover', this.onMeasurementHoveredBinded);
};

proto._hexToCorrectedColor = function (color) {
  tmpColor.set(parseInt(color, 16));

  // In case of a 3D viewer, manually apply gamma correction to the materials.
  // It is needed because we are using THREE.js materials that don't get LMV's shaders.
  // So GAMMA_INPUT & GAMMA_OUTPUT are missing in their shaders.
  if (!this.viewer.impl.is2d) {
    tmpColor.multiply(tmpColor);
  }

  return tmpColor;
};

proto._createLineMaterial = function (color) {
  const correctedColor = this._hexToCorrectedColor(color);

  const material = new Autodesk.Viewing.Scene.UnlitMaterial({
    color: correctedColor.getHex(),
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  return material;
};

proto.createEndpoint = function (index) {
  this.endpoints[index] = {};

  // Don't render endpoints that are under the labels.
  if (index === 2 && (
  this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT ||
  this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_CALLOUT)) {
    return;
  }

  var currLabel = this.endpoints[index].label = this.createSnapResultLabel(index);
  this.viewer.container.appendChild(currLabel);
};

proto.applyLineColor = function (material) {
  if (!material)
  return;

  const hasColor = this.measurement.options && this.measurement.options.format &&
  this.measurement.options.format.TEXTCOLOR && this.measurement.options.format.TEXTCOLOR.Enabled === 'true' &&
  this.measurement.options.format.FILLCOLOR && this.measurement.options.format.FILLCOLOR.Enabled === 'true' &&
  this.measurement.options.format.LINECOLOR && this.measurement.options.format.LINECOLOR.Enabled === 'true';
  const lineColor = hasColor ? numToColor(this.measurement.options.format.LINECOLOR.UIntValue) : DEFAULT_LINE_COLOR;
  const correctedColor = this._hexToCorrectedColor(lineColor);

  material.color.set(correctedColor);
};

proto.applyLabelColors = function (label) {
  if (!label)
  return;

  let textColor = `#${DEFAULT_LINE_COLOR}`;
  let backgroundColor = '#f4f4f4';

  if (this.isCurrentlySelected()) {
    if (label.classList.contains('measure-length')) {
      textColor = '#f4f4f4';
      backgroundColor = `#${DEFAULT_LINE_COLOR}`;
    }
  }

  const hasColor = this.measurement.options && this.measurement.options.format &&
  this.measurement.options.format.TEXTCOLOR && this.measurement.options.format.TEXTCOLOR.Enabled === 'true' &&
  this.measurement.options.format.FILLCOLOR && this.measurement.options.format.FILLCOLOR.Enabled === 'true' &&
  this.measurement.options.format.LINECOLOR && this.measurement.options.format.LINECOLOR.Enabled === 'true';
  const color = hasColor ? `#${numToColor(this.measurement.options.format.TEXTCOLOR.UIntValue)}` : textColor;
  const bg = hasColor ? `#${numToColor(this.measurement.options.format.FILLCOLOR.UIntValue)}` : backgroundColor;
  label.style.color = color;
  label.style.backgroundColor = bg;
};

proto.updateLabelsPosition = function () {

  var point,
    xy,
    label,
    key;

  const placeLabel = (xOff, yOff) => {
    xy = MeasureCommon.project(point, this.viewer);

    label.style.top = xy.y - yOff + 'px';
    label.style.left = xy.x - xOff + 'px';
    label.point = point;
    this.applyLabelColors(label);
    this.labels.push(label);
  };

  for (key in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, key)) {
      label = this.endpoints[key].label;
      point = this.endpoints[key].position;

      if (label && point && this.isVisible(label)) {
        xy = MeasureCommon.project(point, this.viewer);

        placeLabel(label.getBoundingClientRect().width / 2,
        label.getBoundingClientRect().height / 2);
      }
    }
  }

  for (var name in this.lines) {
    if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
      var item = this.lines[name];
      label = item.label;

      if (label && item.p1 && item.p2 && this.isVisible(label)) {

        item.line.visible = item.visible;

        point = { x: (item.p1.x + item.p2.x) / 2, y: (item.p1.y + item.p2.y) / 2, z: (item.p1.z + item.p2.z) / 2 };

        xy = MeasureCommon.project(point, this.viewer);
        label.style.top = xy.y - Math.floor(label.clientHeight / 2) + 'px';
        label.style.left = xy.x - Math.floor(label.clientWidth / 2) + 'px';

        if (this.viewer.model && this.viewer.model.is2d()) {
          var offset = item === this.lines.xyz ? 0 : label.clientHeight;

          var p1Projected = MeasureCommon.project(item.p1, this.viewer);
          var p2Projected = MeasureCommon.project(item.p2, this.viewer);

          if (label.clientWidth >= p1Projected.distanceTo(p2Projected) - this.endpoints[1].label.clientWidth) {
            if (item === this.lines.xyz) {
              offset = label.clientHeight;
            } else {
              // Hide all axis labels and quit the loop

              this.lines.x.line.visible = false;
              this.lines.y.line.visible = false;

              this.viewer.impl.invalidate(false, false, /*overlayDirty=*/true);

              for (name in this.lines) {
                if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
                  if (this.lines[name] !== this.lines.xyz) {
                    var currLabel = this.lines[name].label;
                    if (currLabel) {
                      currLabel.style.opacity = 0;
                    }
                  }
                }
              }

              break;

            }
          }

          if (item !== this.lines.xyz) {
            var xyzDirection = new THREE.Vector3();
            var itemDirection = new THREE.Vector3();
            xyzDirection.subVectors(this.lines.xyz.p1, this.lines.xyz.p2).normalize();
            itemDirection.subVectors(item.p1, item.p2).normalize();
            var normal = xyzDirection.cross(this.viewer.navigation.getEyeVector()).normalize();
            var angle = normal.dot(itemDirection);

            if (angle < 0) {
              offset = -offset;
            }
          }

          this.alignLabelWithLine(label, item.p1, item.p2, offset, this.viewer);
        }

        label.style.opacity = 1;
        label.point = point;
        this.applyLabelColors(label);
        this.labels.push(label);
      }
    }
  }

  if (this.angleLabel) {

    label = this.angleLabel.label;

    if (label && this.angleLabel.p1 && this.angleLabel.p2 && this.isVisible(label)) {
      point = { x: (this.angleLabel.p1.x + this.angleLabel.p2.x) / 2, y: (this.angleLabel.p1.y + this.angleLabel.p2.y) / 2, z: (this.angleLabel.p1.z + this.angleLabel.p2.z) / 2 };
      xy = MeasureCommon.project(point, this.viewer, _angleLabelOffset);
      placeLabel(Math.floor(label.clientWidth / 2), Math.floor(label.clientHeight / 2));
    }
  }

  if (this.arcLabel) {
    label = this.arcLabel.label;
    offset = 0;

    if (label && this.arcLabel.p1 && this.arcLabel.p2 && this.isVisible(label)) {
      point = { x: (this.arcLabel.p1.x + this.arcLabel.p2.x) / 2, y: (this.arcLabel.p1.y + this.arcLabel.p2.y) / 2, z: (this.arcLabel.p1.z + this.arcLabel.p2.z) / 2 };
      xy = MeasureCommon.project(point, this.viewer, label.clientHeight);
      placeLabel(Math.floor(label.clientWidth / 2), Math.floor(label.clientHeight / 2));

      // Rotate the label
      let p1Projected = MeasureCommon.project(this.arcLabel.point1Relative, this.viewer);
      let p2Projected = MeasureCommon.project(this.arcLabel.point2Relative, this.viewer);

      if (label.clientWidth >= p1Projected.distanceTo(p2Projected) - this.endpoints[1].label.clientWidth) {

        // you need to project midpoint and the circle center here because the offset direction logic occurs in screen coordinates
        var midPointProjected = MeasureCommon.project(this.arcLabel.midPointRelative, this.viewer);
        var centerProjected = MeasureCommon.project(new THREE.Vector3(), this.viewer);

        // Check if the midpoint position is above or below the center of the circle
        // Based on this, offset the label up or down to ensure it is always outside the arc
        if (midPointProjected.y > centerProjected.y) {
          offset = label.clientHeight; // offset down
        } else {
          offset = -label.clientHeight; // offset up
        }

      }
      this.alignLabelWithLine(label, this.arcLabel.point1Relative, this.arcLabel.point2Relative, offset, this.viewer);
    }
  }

  if (this.spotLabel) {

    label = this.spotLabel.label;

    if (label && this.spotLabel.p && this.isVisible(label)) {
      xy = MeasureCommon.project(this.spotLabel.p, this.viewer);
      // spotMesh radius of 1 is getting scaled to pixelSize 5
      placeLabel(5, Math.floor(label.clientHeight) + 10);
    }
  }

  if (this.calloutLabel) {

    label = this.calloutLabel.label;

    if (label && this.calloutLabel.p && this.isVisible(label)) {
      xy = MeasureCommon.project(this.calloutLabel.p, this.viewer);
      placeLabel(Math.floor(label.clientWidth / 2), Math.floor(label.clientHeight / 2));
    }
  }

  if (this.areaLabel) {

    label = this.areaLabel.label;

    if (label && this.areaLabel.p1 && this.areaLabel.p2 && this.isVisible(label)) {
      point = { x: (this.areaLabel.p1.x + this.areaLabel.p2.x) / 2, y: (this.areaLabel.p1.y + this.areaLabel.p2.y) / 2, z: (this.areaLabel.p1.z + this.areaLabel.p2.z) / 2 };
      xy = MeasureCommon.project(point, this.viewer);
      placeLabel(Math.floor(label.clientWidth / 2), Math.floor(label.clientHeight / 2));
    }
  }

  if (this.viewer.model && !this.viewer.model.is2d()) {

    var needToStackLabels = false;
    this.labelsStacked = false;
    var currentLabel, i;

    // reset min-width
    this.labels.forEach((label) => label.style.minWidth = null);

    // Backup lable's positions in case of the need of stacking them later
    var backupPositions = [];
    for (i = 0; i < this.labels.length; i++) {
      backupPositions.push({ left: this.labels[i].style.left, top: this.labels[i].style.top });
    }

    // Detect and move in case of overlapping.
    for (i = 0; i < this.labels.length && !needToStackLabels; i++) {
      currentLabel = this.labels[i];
      needToStackLabels = this.labelsOverlapDetection(currentLabel, this.labels);
    }

    // If we found out that the labels need to be stacked, restore their positions from the backup first, and then start again.
    if (needToStackLabels) {

      for (i = 0; i < this.labels.length; i++) {
        this.labels[i].style.left = backupPositions[i].left;
        this.labels[i].style.top = backupPositions[i].top;
      }

      this.stackLabels(this.labels);

      for (i = 0; i < this.labels.length; i++) {
        currentLabel = this.labels[i];
        this.labelsOverlapDetection(currentLabel, this.labels);
      }
    }
  }

  this.labels = [];

};

function isLeftIntersect(current, other) {
  return current.right >= other.left && current.right <= other.right;
}

function isRightIntersect(current, other) {
  return current.left >= other.left && current.left <= other.right;
}

function isMiddleIntersect(current, other) {
  return current.left <= other.left && current.right >= other.right;
}

function isVerticalIntersect(current, other) {
  return current.top < other.bottom && current.bottom > other.top;
}

function moveLeft(currentLabel, currentRect, otherRect) {
  currentLabel.style.left = parseInt(currentLabel.style.left, 10) - (currentRect.right - otherRect.left) + 'px';
}

function moveRight(currentLabel, currentRect, otherRect) {
  currentLabel.style.left = parseInt(currentLabel.style.left, 10) + (otherRect.right - currentRect.left) + 'px';
}

function moveDown(currentLabel, currentRect, otherRect) {
  currentLabel.style.top = parseInt(currentLabel.style.top, 10) + (otherRect.bottom - currentRect.top) + 'px';
}


proto.labelsOverlapDetection = function (staticLabel, labelsList) {

  var needToStackLabels = false;

  for (var i = 0; i < labelsList.length; i++) {

    var dynamicLabel = labelsList[i];
    var moved = false;

    if (staticLabel !== dynamicLabel) {
      var staticRect = staticLabel.getBoundingClientRect();
      var dynamicRect = dynamicLabel.getBoundingClientRect();

      if (isVerticalIntersect(dynamicRect, staticRect)) {

        if (isLeftIntersect(dynamicRect, staticRect)) {
          moveLeft(dynamicLabel, dynamicRect, staticRect);
          moved = true;
        } else
        if (isRightIntersect(dynamicRect, staticRect)) {
          moveRight(dynamicLabel, dynamicRect, staticRect);
          moved = true;
        } else
        if (isMiddleIntersect(dynamicRect, staticRect)) {
          moveDown(dynamicLabel, dynamicRect, staticRect);
          moved = true;
        }

        if (moved) {
          var newList = labelsList.slice(0);
          newList.splice(newList.indexOf(staticLabel), 1);
          this.labelsOverlapDetection(dynamicLabel, newList);

          if (dynamicLabel.causeStacking && staticLabel.causeStacking) {
            needToStackLabels = true;
          }

          // We don't want that after the labels have been stacked, only one of them will move alone.
          if (dynamicLabel.causeStacking && this.labelsStacked) {
            this.stackLabels(this.labels);
          }
        }
      }
    }
  }

  return needToStackLabels;
};

proto.stackLabels = function (labels) {
  var topLabel = this.topLabel ?? this.lines.xyz.label;

  for (var i = 1; i < labels.length; i++) {
    if (labels[i].causeStacking) {
      labels[i].style.left = topLabel.style.left;

      var rect = labels[i - 1].getBoundingClientRect();
      var space = labels[i - 1] == topLabel ? _labelsSpace : 0;
      var top = labels[i] === topLabel ? topLabel.style.top : labels[i - 1].style.top;
      labels[i].style.top = parseInt(top, 10) + rect.height + space + 'px';
    }
    labels[i].style.transform = '';
  }

  // align stacked label sizes
  const stackedLabels = labels.filter((l) => l.causeStacking);
  const widths = stackedLabels.map((e) => e.clientWidth); // hint: clientWidth is 0 for hidden labels (display: none)
  const maxWidth = Math.max(...widths);
  stackedLabels.forEach((label) => label.style.minWidth = `${maxWidth}px`);

  this.labelsStacked = true;
};

proto.drawTip = function (p, normal, scale, geometry, item) {
  const tmpPoints = [new THREE.Vector3(), new THREE.Vector3()];
  tmpPoints[0].addVectors(p, normal.clone().multiplyScalar(_tipHeight * scale));
  tmpPoints[1].subVectors(p, normal.clone().multiplyScalar(_tipHeight * scale));
  geometry.setFromPoints(tmpPoints);

  const line = this.drawLineAsCylinder(geometry, item.material, _tipWidth, this.overlayName);
  this.setCylinderScale(line, item.p1, item.p2);
  line.visible = true;
  item.tips.push(line);
};

proto.drawLineTips = function (item, p1, p2, direction, normal, scale, geometry) {
  // Draw perpendicular tips for standard distance measurements
  this.drawTip(p1, normal, scale, geometry, item);
  this.drawTip(p2, normal, scale, geometry, item);
};

proto.drawXYZLine = function (item) {
  var self = this;

  let p1 = item.p1;
  let p2 = item.p2;

  if (!p1 || !p2)
  return;

  item.line = this.drawLineSegment(p1, p2, this.segmentWidth, item.material);

  const geometry = item.geometry = new THREE.BufferGeometry();
  const point = MeasureCommon.nearestPointInPointToSegment(self.viewer.navigation.getPosition(), p1, p2);
  const scale = self.setScale(point);

  let direction;
  const dimensionOffset = this.measurement.options && this.measurement.options.dimensionOffset;
  if (dimensionOffset) {
    const d1 = new THREE.Vector3(dimensionOffset[0].x, dimensionOffset[0].y, dimensionOffset[0].z);
    const d2 = new THREE.Vector3(dimensionOffset[1].x, dimensionOffset[1].y, dimensionOffset[1].z);
    direction = new THREE.Vector3().subVectors(p1, d1).normalize();
    this.segments.push({ line: this.drawLineSegment(d1, p1, this.segmentWidth, item.material), p1: d1, p2: p1 });
    this.segments.push({ line: this.drawLineSegment(p2, d2, this.segmentWidth, item.material), p1: p2, p2: d2 });
    p1 = d1;
    p2 = d2;
  } else {
    direction = new THREE.Vector3().subVectors(p2, p1).normalize();
  }
  const normal = direction.clone().cross(self.viewer.navigation.getEyeVector()).normalize();
  item.visible = true;

  this.segments.push(item);

  const dashedLeader = this.measurement.options && this.measurement.options.dashedLeader;
  if (dashedLeader) {
    const l1 = new THREE.Vector3(dashedLeader[0].x, dashedLeader[0].y, dashedLeader[0].z);
    const l2 = new THREE.Vector3(dashedLeader[1].x, dashedLeader[1].y, dashedLeader[1].z);
    this.drawLineSegment(l1, l2, this.segmentWidth, item.material, true);
  }

  if (self.showMeasureResult) {
    item.tips = [];
    // Draw tips using overridable method for customization
    this.drawLineTips(item, p1, p2, direction, normal, scale, geometry);
  }
};

proto.redrawDashedLine = function (dashedLine) {
  if (!dashedLine.p1 || !dashedLine.p2)
  return;

  this.viewer.impl.removeMultipleOverlays(this.overlayName, dashedLine.line, true);

  var p1Scale = this.setScale(dashedLine.p2);
  var dashSize = _dashSize * p1Scale;
  var gapSize = _gapSize * p1Scale;
  dashedLine.line = this.drawDashedLine(dashedLine.p2, dashedLine.p1, dashSize, gapSize, this.lines.xyz.material, _dashedSegmentWidth, this.overlayName);

  return dashedLine.line;
};

proto.redrawDashedLines = function () {
  this.dashedLines.forEach(this.redrawDashedLine.bind(this));
};

proto.drawLineSegment = function (p1, p2, width, material, isDashedLine) {
  var line;

  if (isDashedLine) {
    const dashedLine = {};
    dashedLine.p1 = p1;
    dashedLine.p2 = p2;
    this.dashedLines.push(dashedLine);
    line = this.redrawDashedLine(dashedLine);
  } else {
    const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    line = this.drawLineAsCylinder(geometry, material, width, this.overlayName);
    this.setCylinderScale(line, p1, p2);
  }

  line.visible = true;

  return line;
};

proto.drawSurface = function (points) {

  const cg = Autodesk.Viewing.Extensions.CompGeom;

  let cset = new cg.ContourSet();

  cset.addContour(points);

  cset.triangulate();

  if (cset.triangulationFailed)
  return false;

  let bufferGeometry = cset.toPolygonMesh();

  var face = new THREE.Mesh(bufferGeometry, this.surfaceColor);
  this.applyLineColor(this.surfaceColor);

  this.viewer.impl.addOverlay(this.overlayName, face);

  return true;
};

proto.drawSegmentAndPush = function (p1, p2, isDashedLine) {
  if (!p1 || !p2) {
    return;
  }

  var line = this.drawLineSegment(p1, p2, this.segmentWidth, this.lines.xyz.material, isDashedLine);

  if (!isDashedLine) {
    var item = { line: line, p1: p1, p2: p2 };
    this.segments.push(item);
  }
};


proto.renderAreaMeasurementFromPoints = function (vertices) {
  let p1, p2;
  let firstPoint;

  const points = [];
  this.applyLineColor(this.lines.xyz.material);
  this.applyLineColor(this.surfaceColor);

  const keys = Object.keys(vertices);

  for (var i = 0; i < keys.length - 1; i++) {
    const key = parseFloat(keys[i]);
    const position1 = vertices[key];
    const position2 = vertices[key + 1];

    if (i === 0) {
      firstPoint = new THREE.Vector3(position1.x, position1.y, position1.z);
    }

    p1 = new THREE.Vector3(position1.x, position1.y, position1.z);
    p2 = new THREE.Vector3(position2.x, position2.y, position2.z);

    this.drawSegmentAndPush(p1, p2);
    points.push(p1);
  }

  if (keys.length > 2) {
    // Draw last line
    this.drawSegmentAndPush(firstPoint, p2, !this.measurement.closedArea);

    if (!MeasureCommon.isEqualVectors(firstPoint, p2, MeasureCommon.EPSILON)) {
      points.push(p2);
    }

    if (this.measurement.area !== 0) {
      //Draw surface will return false if it failed to triangulate the polygon (e.g. it has self-intersections)
      if (this.drawSurface(points)) {
        this.showAreaLabel((0,_PolygonCentroid_js__WEBPACK_IMPORTED_MODULE_1__.getPolygonVisualCenter)(points));
        this.updateArea();
      }
    }
  }
};

proto.renderAreaMeasurement = function (picks) {

  var count = this.measurement.countPicks();
  var p1, p2;

  var points = [];

  for (var i = 1; i < count; i++) {
    p1 = MeasureCommon.getSnapResultPosition(picks[i], this.viewer);
    p2 = MeasureCommon.getSnapResultPosition(picks[i + 1], this.viewer);

    this.drawSegmentAndPush(p1, p2);
    points.push(p1);
  }

  if (count > 2) {
    // Draw last line
    p1 = MeasureCommon.getSnapResultPosition(picks[1], this.viewer);
    this.drawSegmentAndPush(p1, p2, !this.measurement.closedArea);

    if (!MeasureCommon.isEqualVectors(p1, p2, MeasureCommon.EPSILON)) {
      points.push(p2);
    }

    if (this.measurement.area !== 0) {
      //Draw surface will return false if it failed to triangulate the polygon (e.g. it has self-intersections)
      if (this.drawSurface(points)) {
        this.showAreaLabel((0,_PolygonCentroid_js__WEBPACK_IMPORTED_MODULE_1__.getPolygonVisualCenter)(points));
        this.updateArea();
      }
    }
  }
};

proto.clearAngleMeshes = function () {
  if (this.angleArc) {
    this.viewer.impl.removeOverlay(this.overlayName, this.angleArc, true);
    this.angleArc = null;
  }
  if (this.angleOutline.length > 0) {
    this.viewer.impl.removeMultipleOverlays(this.overlayName, this.angleOutline, true);
    this.angleOutline.length = 0;
  }
};

proto.drawAngle = function (p, ep1, ep2, n, angle, midPoint, _radius) {

  var smallNum = 0.001;

  if (!this.materialAngle) {

    this.materialAngle = new Autodesk.Viewing.Scene.StandardMaterial({
      color: 0x999999,
      opacity: 0.5,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    }
    );

    this.materialAngleOutline = new Autodesk.Viewing.Scene.UnlitMaterial({
      color: 0xFF9900,
      depthTest: false,
      depthWrite: false
    });

  }

  this.applyLineColor(this.lines.xyz.material);
  this.applyLineColor(this.surfaceColor);

  MeasureCommon.createCommonOverlay(this.viewer, this.overlayName);
  this.clearAngleMeshes();

  // draw arc of angle
  var radius = _radius || Math.min(p.distanceTo(ep1), p.distanceTo(ep2)) / 4;
  var segments = 100;
  //angle = angle * Math.PI / 180;

  var circleGeometry = new THREE.CircleBufferGeometry(radius, segments, 0, angle * Math.PI / 180);
  var arc = new THREE.Mesh(circleGeometry, this.surfaceColor);
  this.applyLineColor(this.surfaceColor);

  const arcGeomPosition = arc.geometry.getAttribute('position');
  {
    const untypedPositions = Array.from(arcGeomPosition.array); // convert from Float32Array to Array to use concat
    const untypedCenter = untypedPositions.slice(0, arcGeomPosition.itemSize); // get the x,y,z of the center
    arcGeomPosition.array = Float32Array.from(untypedPositions.concat(untypedCenter)); // concat the center x,y,z and convert back to Float32Array
    arcGeomPosition.count++;
    arcGeomPosition.needsUpdate = true;
  }

  // Translate and rotate the arc to the plane where it should lie in
  arc.position.set(p.x, p.y, p.z);
  var V = arc.position.clone();
  V.add(n);
  arc.lookAt(V);
  arc.updateMatrixWorld();


  // Rotate the arc in the plane to the right place
  let vA = new THREE.Vector3().fromBufferAttribute(arcGeomPosition, 1);
  let vB = new THREE.Vector3().fromBufferAttribute(arcGeomPosition, arcGeomPosition.count - 2);
  vA.applyMatrix4(arc.matrixWorld);
  vB.applyMatrix4(arc.matrixWorld);

  var v1 = new THREE.Vector3();
  var v2 = new THREE.Vector3();
  var v3 = new THREE.Vector3();
  var v4 = new THREE.Vector3();
  v1.subVectors(vA, p);
  v2.subVectors(vB, p);
  v3.subVectors(ep1, p);
  v4.subVectors(ep2, p);

  var a13 = v1.angleTo(v3);
  var a14 = v1.angleTo(v4);
  var a23 = v2.angleTo(v3);
  var a24 = v2.angleTo(v4);

  //console.log(a13 * 180 / Math.PI + " " + a14 * 180 / Math.PI + " " + a23 * 180 / Math.PI + " " + a24 * 180 / Math.PI);

  var ra;
  // The arc is in the right place
  if ((a13 <= smallNum && a13 >= -smallNum || a14 <= smallNum && a14 >= -smallNum) && (
  a23 <= smallNum && a23 >= -smallNum || a24 <= smallNum && a24 >= -smallNum)) {

    ra = 0;
  }
  // The arc needs to be rotated 180 degree to the right place
  else if ((a13 <= Math.PI + smallNum && a13 >= Math.PI - smallNum || a14 <= Math.PI + smallNum && a14 >= Math.PI - smallNum) && (
  a23 <= Math.PI + smallNum && a23 >= Math.PI - smallNum || a24 <= Math.PI + smallNum && a24 >= Math.PI - smallNum)) {

    ra = Math.PI;
  }
  // The arc needs to be rotated a13 radian
  else if (a13 <= a23 + smallNum && a13 >= a23 - smallNum || a13 <= a24 + smallNum && a13 >= a24 - smallNum) {

    ra = a13;
  }
  // The arc needs to be rotated a14 radian
  else {

    ra = a14;
  }

  var rotWorldMatrix = new THREE.Matrix4();
  rotWorldMatrix.makeRotationAxis(n, ra);
  //arc.matrix.multiply(rotWorldMatrix);
  rotWorldMatrix.multiply(arc.matrix);
  arc.matrix = rotWorldMatrix;
  arc.rotation.setFromRotationMatrix(arc.matrix);

  // Check if rotate to the wrong direction, if so, rotate back twice of the degree
  arc.updateMatrixWorld();
  vA = new THREE.Vector3().fromBufferAttribute(arcGeomPosition, 1);
  vB = new THREE.Vector3().fromBufferAttribute(arcGeomPosition, arcGeomPosition.count - 2);
  vA.applyMatrix4(arc.matrixWorld);
  vB.applyMatrix4(arc.matrixWorld);

  v1.subVectors(vA, p);
  v2.subVectors(vB, p);

  a13 = v1.angleTo(v3);
  a14 = v1.angleTo(v4);
  a23 = v2.angleTo(v3);
  a24 = v2.angleTo(v4);

  //console.log(a13 * 180 / Math.PI + " " + a14 * 180 / Math.PI + " " + a23 * 180 / Math.PI + " " + a24 * 180 / Math.PI);

  if (a13 >= smallNum && a14 >= smallNum) {

    rotWorldMatrix = new THREE.Matrix4();
    rotWorldMatrix.makeRotationAxis(n, -ra * 2);
    //arc.matrix.multiply(rotWorldMatrix);
    rotWorldMatrix.multiply(arc.matrix);
    arc.matrix = rotWorldMatrix;
    arc.rotation.setFromRotationMatrix(arc.matrix);
  }

  // draw outline of the arc
  const outlineGeometry = new THREE.CircleBufferGeometry(radius, segments, 0, angle * Math.PI / 180);
  {
    const outlineGeomPosition = outlineGeometry.getAttribute('position');
    outlineGeomPosition.array = outlineGeomPosition.array.slice(outlineGeomPosition.itemSize); // skip the first position's x,y,z
    outlineGeomPosition.count--;
    outlineGeomPosition.needsUpdate = true;
  }
  arc.updateMatrixWorld();
  outlineGeometry.applyMatrix4(arc.matrixWorld);
  this.angleOutline = this.drawEdgeAsCylinder(outlineGeometry, this.lines.xyz.material, _angleArcWidth, 0, this.getNewCylinderGeometry());

  this.angleArc = arc;
  this.viewer.impl.addOverlay(this.overlayName, this.angleArc);
  this.viewer.impl.addMultipleOverlays(this.overlayName, this.angleOutline);

  // This is used for angle label's position
  midPoint.fromBufferAttribute(arcGeomPosition, Math.round(arcGeomPosition.count / 2) - 1);
  midPoint.applyMatrix4(arc.matrixWorld);
  if (!_radius) {
    var dir = new THREE.Vector3();
    dir.subVectors(midPoint, p).normalize();
    dir.multiplyScalar(radius / 2);
    midPoint.add(dir);
  }
};

proto.createArcLabel = function () {
  var label = this.createMeasurementLabel();
  this.viewer.container.appendChild(label);
  this._addEventListener(label);
  return label;
};

proto.clearArcMeshes = function () {
  if (this.arcOutline && this.arcOutline.length > 0) {
    this.viewer.impl.removeMultipleOverlays(this.overlayName, this.arcOutline, true);
    this.arcOutline.length = 0;
  }
};

proto.drawCircularArc = function (point1, point2, center, radius, drawTips = true) {
  var segments = 100;
  var edgeGeometry = new THREE.BufferGeometry();
  const tmpPoints = [new THREE.Vector3(), new THREE.Vector3()];
  var nearPoint = MeasureCommon.nearestPointInPointToSegment(this.viewer.navigation.getPosition(), point1, point2);
  var scale = this.setScale(nearPoint);

  var point1Relative = new THREE.Vector3();
  point1Relative.subVectors(point1, center);
  var startAngle = Math.atan2(point1Relative.y, point1Relative.x);

  var point2Relative = new THREE.Vector3();
  point2Relative.subVectors(point2, center);
  var endAngle = Math.atan2(point2Relative.y, point2Relative.x);

  // Set this.lines with the points to rotabte the label
  this.arcLabel.point1Relative = point1Relative.clone();
  this.arcLabel.point2Relative = point2Relative.clone().normalize().multiplyScalar(radius);

  var arcAngle = endAngle - startAngle;
  if (arcAngle > Math.PI) {
    arcAngle -= 2 * Math.PI;
  } else if (arcAngle < -Math.PI) {
    arcAngle += 2 * Math.PI;
  }

  var circleGeometry = new THREE.CircleBufferGeometry(radius, segments, startAngle, arcAngle);
  var arc = new THREE.Mesh(circleGeometry, this.lines.xyz.material);

  // Translate and rotate the arc to the plane where it should lie in
  arc.position.set(center.x, center.y, center.z);
  {
    const circleGeomPosition = circleGeometry.getAttribute('position');
    circleGeomPosition.array = circleGeomPosition.array.slice(circleGeomPosition.itemSize); // skip the first position's x,y,z
    circleGeomPosition.count--;
    circleGeomPosition.needsUpdate = true;
  }

  arc.updateMatrixWorld();
  circleGeometry.applyMatrix4(arc.matrixWorld);

  MeasureCommon.createCommonOverlay(this.viewer, this.overlayName);
  this.clearArcMeshes();
  this.arcOutline = this.drawEdgeAsCylinder(circleGeometry, this.lines.xyz.material, this.segmentWidth, 0, this.getNewCylinderGeometry());

  this.viewer.impl.addMultipleOverlays(this.overlayName, this.arcOutline);

  function drawArcTip(p, normal) {
    tmpPoints[0].addVectors(p, normal.clone().multiplyScalar(_tipHeight * scale));
    tmpPoints[1].subVectors(p, normal.clone().multiplyScalar(_tipHeight * scale));

    edgeGeometry.setFromPoints(tmpPoints);

    var line = this.drawLineAsCylinder(edgeGeometry, this.lines.xyz.material, _tipWidth, this.overlayName);
    this.arcTip.push(line);
  }

  // Draw arc's tip lines
  if (drawTips) {
    drawArcTip.call(this, point1, point1Relative.normalize());
    drawArcTip.call(this, point2, point2Relative.normalize());
  }

  var midPoint = new THREE.Vector3();

  // Calculate midpoint position
  var midAngle = startAngle + arcAngle * 0.5;
  midPoint.x = Math.cos(midAngle) * radius;
  midPoint.y = Math.sin(midAngle) * radius;
  this.arcLabel.midPointRelative = midPoint.clone();
  midPoint.applyMatrix4(arc.matrixWorld);

  this.showArcLabel(midPoint);
};

proto.renderAngleMeasurementFromPoints = function (pickPositions) {
  var points = [];

  const keys = Object.keys(pickPositions);
  for (var i = 0; i < keys.length; i++) {
    const key = parseFloat(keys[i]);
    const position = pickPositions[key];

    points.push(new THREE.Vector3(position.x, position.y, position.z));
  }

  if (points.length === 3) {
    let arcRadius;
    const options = this.measurement.options;
    if (options && options.offset) {
      const o0 = new THREE.Vector3(options.offset.x, options.offset.y, options.offset.z);
      const o1 = o0.clone().add(points[1]);
      o0.add(points[0]);
      this.drawSegmentAndPush(o0, o1);
      this.drawSegmentAndPush(points[1], points[2]);
      this.drawSegmentAndPush(points[0], o0, true);
      this.drawSegmentAndPush(points[1], o1, true);
      arcRadius = o1.clone().sub(o0).length();
    } else {
      this.drawSegmentAndPush(points[0], points[1]);
      this.drawSegmentAndPush(points[1], points[2]);
    }

    if (this.measurement.angle) {
      var n = new THREE.Vector3();
      var v1 = new THREE.Vector3();
      var v2 = new THREE.Vector3();
      v1.subVectors(points[0], points[1]);
      v2.subVectors(points[1], points[2]);
      n.crossVectors(v1, v2);
      n.normalize();

      var midPoint = new THREE.Vector3();
      this.drawAngle(points[1], points[0], points[2], n, this.measurement.angle, midPoint, arcRadius);
      this.showAngleLabel(midPoint);
      this.updateAngle();
    }
  }
};

proto.renderAngleMeasurement = function (picks) {

  var count = this.measurement.countPicks();
  var p1, p2;

  var points = [];
  this.applyLineColor(this.lines.xyz.material);
  this.applyLineColor(this.surfaceColor);

  for (var i = 1; i < count; i++) {
    p1 = MeasureCommon.getSnapResultPosition(picks[i], this.viewer);
    p2 = MeasureCommon.getSnapResultPosition(picks[i + 1], this.viewer);

    this.drawSegmentAndPush(p1, p2);

    if (p1) {
      points.push(p1);
    }
  }

  if (p2) {
    points.push(p2);
  }

  if (points.length === 3 && this.measurement.angle) {
    var n = new THREE.Vector3();
    var v1 = new THREE.Vector3();
    var v2 = new THREE.Vector3();
    v1.subVectors(points[0], points[1]);
    v2.subVectors(points[1], points[2]);
    n.crossVectors(v1, v2);
    n.normalize();

    var midPoint = new THREE.Vector3();
    this.drawAngle(points[1], points[0], points[2], n, this.measurement.angle, midPoint);
    this.showAngleLabel(midPoint);
    this.updateAngle();
  }
};

proto.renderArcMeasurementFromPoints = function (p1, p2, center, radius) {
  if (!p1 || !p2 || !center || !radius) {
    return;
  }
  this.drawCircularArc(p1, p2, center, radius);
  this.updateArcLength();
};

proto.renderArcMeasurement = function (p1, p2) {

  if (!p1 || !p2 || !p1.circularArcCenter || !p1.circularArcRadius) {
    return;
  }

  var radius = p1.circularArcRadius;
  var center = p1.circularArcCenter;

  var point1 = MeasureCommon.getSnapResultPosition(p1);
  var point2 = MeasureCommon.getSnapResultPosition(p2);

  const drawTips =
  this.showMeasureResult &&
  MeasureCommon.isEqualVectors(p1.circularArcCenter, p2.circularArcCenter, 0) &&
  p1.circularArcRadius === p2.circularArcRadius;

  this.drawCircularArc(point1, point2, center, radius, drawTips);
  this.updateArcLength();

};

proto.renderSpot = function (point) {
  if (!point)
  return;

  // add the point marker to the overlay
  if (!this.spotMesh) {
    const geometry = new THREE.SphereGeometry(1, 10, 10);
    const material = this._createLineMaterial(DEFAULT_LINE_COLOR);
    this.applyLineColor(material, DEFAULT_LINE_COLOR);
    this.spotMesh = new THREE.Mesh(geometry, material);
  }
  const scale = this.setScale(point);
  this.spotMesh.scale.set(scale, scale, scale);
  this.spotMesh.position.set(point.x, point.y, point.z);
  this.viewer.impl.addOverlay(this.overlayName, this.spotMesh);
  this.segments.push({ p1: point, p2: point });

  this.showSpotLabel(point);
  this.updateSpot();
};

proto.renderSpotMeasurementFromPoints = function (pickPositions) {
  this.renderSpot(pickPositions[0]);
};

proto.renderSpotMeasurement = function (point) {
  this.renderSpot(point);
};

proto.renderCalloutMeasurementFromPoints = function (pickPositions) {
  var p1 = pickPositions[1];
  var p2 = pickPositions[2];
  if (!p1 || !p2)
  return;

  this.applyLineColor(this.lines.xyz.material);
  this.drawSegmentAndPush(p1, p2);

  this.showCalloutLabel(p2);
  this.updateCallout();
};

proto.renderCalloutMeasurement = function (picks) {
  var p1 = picks[1] && picks[1].intersection;
  var p2 = picks[2] && picks[2].intersection;
  if (!p1 || !p2)
  return;

  this.applyLineColor(this.lines.xyz.material);
  this.drawSegmentAndPush(p1, p2);

  this.showCalloutLabel(p2);
  this.updateCallout();
};

proto.createDistanceLabel = function (item) {
  var label = item.label = this.createMeasurementLabel();

  setVisibilityMeasurementLabelText(label, item === this.lines.xyz);

  const _document = this.getDocument();
  // Override main label when displaying only an axis label (X, Y or Z)
  if (item.axis) {
    label.className = item.className;
    label.classList.add(MeasureLabelClasses.pill);
    var axisIcon = _document.createElement('div');
    axisIcon.className = MeasureLabelClasses.prefix + ' measure-label-axis-icon ' + item.iconText;
    axisIcon.innerText = item.iconText;
    label.insertBefore(axisIcon, label.firstChild);

    if (!av.isMobileDevice()) {
      MeasureCommon.safeToggle(label, 'enableTransition', true);
    }
  }

  this.viewer.container.appendChild(label);

  return label;
};

proto.updateLine = function (item, x1, y1, z1, x2, y2, z2, showAxis, axisLineWidth = _axisLineWidth) {
  this.applyLineColor(this.lines.xyz.material);

  var line = item.line,
    label = item.label,
    p1 = new THREE.Vector3(x1, y1, z1),
    p2 = new THREE.Vector3(x2, y2, z2);

  // Swap points if needed to have consistent axis directions.
  var tmpVec;
  if (item === this.lines.x && p2.x > p1.x) {
    tmpVec = p1.clone();
    p1 = p2.clone();
    p2 = tmpVec.clone();
  } else
  if (item === this.lines.y && p2.y > p1.y) {
    tmpVec = p1.clone();
    p1 = p2.clone();
    p2 = tmpVec.clone();
  } else
  if (item === this.lines.z && p2.z > p1.z) {
    tmpVec = p1.clone();
    p1 = p2.clone();
    p2 = tmpVec.clone();
  }

  item.line = null;

  if (!label) {
    label = this.createDistanceLabel(item);
  } else
  {
    this.hideLabel(label);
  }

  if ((this.isLeaflet && item !== this.lines.z || this.allowShortDistances === true || p1.distanceTo(p2) >= MeasureCommon.EPSILON) && showAxis) {

    item.p1 = p1;
    item.p2 = p2;

    if (item === this.lines.xyz) {
      this.drawXYZLine(item);
      this.showLabel(label);
      this.updateDistance();
    } else
    {
      line = item.line = this.drawLineSegment(p1, p2, axisLineWidth, item.material);
      var show = !this.simple && this.showMeasureResult;

      line.visible = show;
      item.visible = show;

      if (show) {
        this.showLabel(label);
      } else
      {
        this.hideLabel(label);
      }
    }
  }
};

// Draw distance measurement
proto.renderDistanceMeasurementFromPoints = function (p1, p2) {

  this.updateLine(this.lines.xyz, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, true);

  var up = this.viewer.navigation.getAlignedUpVector(),
    x = Math.abs(up.x),
    y = Math.abs(up.y),
    z = Math.abs(up.z);

  var showAxis = false;

  if (z > x && z > y) {// z up
    this.updateLine(this.lines.x, p1.x, p1.y, p1.z, p2.x, p1.y, p1.z, showAxis);
    this.updateLine(this.lines.y, p2.x, p1.y, p1.z, p2.x, p2.y, p1.z, showAxis);
    this.updateLine(this.lines.z, p2.x, p2.y, p1.z, p2.x, p2.y, p2.z, showAxis);

  } else if (y > x && y > z) {// y up
    this.updateLine(this.lines.x, p1.x, p1.y, p1.z, p2.x, p1.y, p1.z, showAxis);
    this.updateLine(this.lines.z, p2.x, p1.y, p1.z, p2.x, p1.y, p2.z, showAxis);
    this.updateLine(this.lines.y, p2.x, p1.y, p2.z, p2.x, p2.y, p2.z, showAxis);

  } else {// x up - do we ever see this?
    this.updateLine(this.lines.y, p1.x, p1.y, p1.z, p1.x, p2.y, p1.z, showAxis);
    this.updateLine(this.lines.z, p1.x, p2.y, p1.z, p1.x, p2.y, p2.z, showAxis);
    this.updateLine(this.lines.x, p1.x, p2.y, p2.z, p2.x, p2.y, p2.z, showAxis);
  }

};

// Draw distance measurement
proto.renderDistanceMeasurement = function (p1, p2)
{
  var self = this;

  // If the line aligns with one of axis, then don't show axis
  function displayAxis(p1, p2) {
    self.tmpVector.subVectors(p1, p2);
    self.tmpVector.normalize();

    return !MeasureCommon.isParallel(self.tmpVector, self.xAxis) && !MeasureCommon.isParallel(self.tmpVector, self.yAxis) && !MeasureCommon.isParallel(self.tmpVector, self.zAxis);
  }

  this.updateLine(this.lines.xyz, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, true);

  var up = this.viewer.navigation.getAlignedUpVector(),
    x = Math.abs(up.x),
    y = Math.abs(up.y),
    z = Math.abs(up.z);

  var showAxis = displayAxis(p1, p2);

  if (z > x && z > y) {// z up
    this.updateLine(this.lines.x, p1.x, p1.y, p1.z, p2.x, p1.y, p1.z, showAxis);
    this.updateLine(this.lines.y, p2.x, p1.y, p1.z, p2.x, p2.y, p1.z, showAxis);
    this.updateLine(this.lines.z, p2.x, p2.y, p1.z, p2.x, p2.y, p2.z, showAxis);

  } else if (y > x && y > z) {// y up
    this.updateLine(this.lines.x, p1.x, p1.y, p1.z, p2.x, p1.y, p1.z, showAxis);
    this.updateLine(this.lines.z, p2.x, p1.y, p1.z, p2.x, p1.y, p2.z, showAxis);
    this.updateLine(this.lines.y, p2.x, p1.y, p2.z, p2.x, p2.y, p2.z, showAxis);

  } else {// x up - do we ever see this?
    this.updateLine(this.lines.y, p1.x, p1.y, p1.z, p1.x, p2.y, p1.z, showAxis);
    this.updateLine(this.lines.z, p1.x, p2.y, p1.z, p1.x, p2.y, p2.z, showAxis);
    this.updateLine(this.lines.x, p1.x, p2.y, p2.z, p2.x, p2.y, p2.z, showAxis);
  }

};

proto.updateResults = function () {
  this.updateDistance();
  this.updateAngle();
  this.updateArea();
  this.updateArcLength();
  this.updateSpot();

  setTimeout(function () {
    // This can get called after the viewer is unloaded
    if (this.viewer.impl)
    this.updateLabelsPosition();
  }.bind(this), 0);
};

// Update distance measurement label
proto.updateDistance = function () {
  setDeltaMeasurementLabelText(this.lines.x.label, "~ " + this.measureTool.getDistanceX(this.measurement));
  setDeltaMeasurementLabelText(this.lines.y.label, "~ " + this.measureTool.getDistanceY(this.measurement));
  setDeltaMeasurementLabelText(this.lines.z.label, "~ " + this.measureTool.getDistanceZ(this.measurement));
  this.setValueMeasurementLabelText(this.lines.xyz.label, "~ " + this.measureTool.getDistanceXYZ(this.measurement));
};

// Update angle measurement label
proto.updateAngle = function () {
  this.setValueMeasurementLabelText(this.angleLabel.label, "~ " + this.measureTool.getAngle(this.measurement));
};

// Update spot measurement label
proto.updateSpot = function () {
  this.setValueMeasurementLabelText(this.spotLabel.label,
  // Replace space with non-breaking space to prevent wrapping
  ("~ " + this.measureTool.getSpot(this.measurement)).split('\n').join('\n~ ').replaceAll(' ', '\xA0'));
};

// Update callout measurement label
proto.updateCallout = function () {
  setValueMeasurementLabelCallout(this, this.calloutLabel.label, this.measureTool.getCallout(this.measurement));
};

// Update area measurement label
proto.updateArea = function () {
  this.setValueMeasurementLabelText(this.areaLabel.label, "~ " + this.measureTool.getArea(this.measurement));
};

// Update arc measurement label
proto.updateArcLength = function () {
  this.setValueMeasurementLabelText(this.arcLabel.label, "~ " + this.measureTool.getArc(this.measurement));
};

proto.isCurrentlySelected = function () {
  return !this.simple && this.measureTool?.getCurrentMeasurementRaw?.() === this.measurement;
};

// Set if collapse or expand the xyz delta distance
proto.setSimple = function (simple) {
  if (this.simple != simple) {
    this.simple = simple;

    var isVisible = !simple;
    this.setLineVisible(this.lines.x, isVisible);
    this.setLineVisible(this.lines.y, isVisible);
    this.setLineVisible(this.lines.z, isVisible);

    this.updateLabelsPosition();

    this.viewer.impl.invalidate(false, false, /*overlayDirty=*/true);
  }
};

proto.setLineVisible = function (item, isVisible) {
  if (item.line) {
    item.line.visible = isVisible;
    item.visible = isVisible;

    if (item.label) {
      if (isVisible) {
        this.showLabel(item.label);
      } else
      {
        this.hideLabel(item.label);
        item.label.style.opacity = 0;
      }
    }
  }
};

proto.enableLabelsTouchEvents = function (enable) {
  var value = enable ? 'all' : 'none';

  if (this.lines.xyz.label) {
    this.lines.xyz.label.style.pointerEvents = value;
  }

  if (this.angleLabel.label) {
    this.angleLabel.label.style.pointerEvents = value;
  }

  if (this.areaLabel.label) {
    this.areaLabel.label.style.pointerEvents = value;
  }

  if (this.arcLabel.label) {
    this.arcLabel.label.style.pointerEvents = value;
  }

  if (this.spotLabel.label) {
    this.spotLabel.label.style.pointerEvents = value;
  }
};

proto.setLabelsZIndex = function (zIndex) {
  for (var name in this.lines) {
    if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
      var item = this.lines[name];
      if (item.label) {
        item.label.style.zIndex = zIndex;
      }
    }
  }

  if (this.angleLabel && this.angleLabel.label) {
    this.angleLabel.label.style.zIndex = zIndex;
  }

  if (this.spotLabel && this.spotLabel.label) {
    this.spotLabel.label.style.zIndex = zIndex;
  }

  if (this.calloutLabel && this.calloutLabel.label) {
    this.calloutLabel.label.style.zIndex = zIndex;
  }

  if (this.areaLabel && this.areaLabel.label) {
    this.areaLabel.label.style.zIndex = zIndex;
  }

  if (this.arcLabel && this.arcLabel.label) {
    this.arcLabel.label.style.zIndex = zIndex;
  }

  for (name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      var endpoint = this.endpoints[name];
      if (endpoint.label) {
        endpoint.label.style.zIndex = zIndex - 1;
      }
    }
  }
};

proto.focusLabels = function () {
  this.setLabelsZIndex(3);
};

proto.unfocusLabels = function () {
  this.setLabelsZIndex(2);
};

proto.clear = function () {
  var name;

  for (name in this.endpoints) {
    if (Object.prototype.hasOwnProperty.call(this.endpoints, name)) {
      var endpoint = this.endpoints[name];
      if (endpoint.label) {
        this.hideLabel(endpoint.label);
      }
    }
  }

  for (name in this.lines) {
    if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
      var item = this.lines[name];
      if (item.line) {
        item.line.visible = false;
        item.visible = false;

        item.tips && item.tips.forEach(function (tip) {
          tip.visible = false;
        });
      }
      if (item.label) {
        this.hideLabel(item.label);
        item.label.style.opacity = 0;
        item.label.style.zIndex = 2;
      }
    }
  }

  if (this.angleLabel && this.angleLabel.label) {
    this.hideLabel(this.angleLabel.label);
  }

  if (this.spotLabel && this.spotLabel.label) {
    this.hideLabel(this.spotLabel.label);
  }

  if (this.calloutLabel && this.calloutLabel.label) {
    this.hideLabel(this.calloutLabel.label);
  }

  if (this.areaLabel && this.areaLabel.label) {
    this.hideLabel(this.areaLabel.label);
  }

  if (this.arcLabel && this.arcLabel.label) {
    this.hideLabel(this.arcLabel.label);
  }



  this.clearSelectionAreas();

  this.segments = [];
  this.dashedLines = [];

  this.viewer.impl.clearOverlay(this.overlayName, true);
  MeasureCommon.createCommonOverlay(this.viewer, this.overlayName);
};

proto.hideClick = function (pickNumber) {

  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype.hideClick.call(this, pickNumber);

  for (var name in this.lines) {
    if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
      var item = this.lines[name];
      if (item.line) {
        item.line.visible = false;
        item.visible = false;

        item.tips && item.tips.forEach(function (tip) {
          tip.visible = false;
        });
      }
      if (item.label) {
        this.hideLabel(item.label);
        item.label.style.opacity = 0;
      }
    }
  }

  if (this.angleLabel && this.angleLabel.label) {
    this.hideLabel(this.angleLabel.label);
  }

  if (this.areaLabel && this.areaLabel.label) {
    this.hideLabel(this.areaLabel.label);
  }

  if (this.arcLabel && this.arcLabel.label) {
    this.hideLabel(this.arcLabel.label);
  }

  this.enableSelectionAreas(item.selectionArea, false);
};

proto.destroy = function () {
  var name;

  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype.destroy.call(this);

  for (name in this.lines) {
    if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
      var item = this.lines[name];
      if (item.line) {
        this.viewer.impl.clearOverlay(self.overlayName, true);
        item.material = item.line = item.geometry = null;
      }

      if (item.label) {
        if (name === 'xyz') {
          this._removeEventListener(item.label);
        }

        item.label.parentNode.removeChild(item.label);
        item.label = null;
      }
      item.material = item.line = item.geometry = item.label = item.p1 = item.p2 = null;
    }
  }

  this.clearAngleMeshes();

  if (this.angleLabel && this.angleLabel.label) {
    this.angleLabel.label.parentNode.removeChild(this.angleLabel.label);
    this._removeEventListener(this.angleLabel.label);
    this.angleLabel.label = this.angleLabel.p1 = this.angleLabel.p2 = null;
  }


  this.clearArcMeshes();

  if (this.arcLabel && this.arcLabel.label) {
    this.arcLabel.label.parentNode.removeChild(this.arcLabel.label);
    this._removeEventListener(this.arcLabel.label);
    this.arcLabel.label = this.arcLabel.midPoint = null;
  }

  this.clearSpotMesh();

  if (this.spotLabel && this.spotLabel.label) {
    this.spotLabel.label.parentNode.removeChild(this.spotLabel.label);
    this._removeEventListener(this.spotLabel.label);
    this.spotLabel.label = this.spotLabel.p = null;
  }


  if (this.calloutLabel && this.calloutLabel.label) {
    this.calloutLabel.label.parentNode.removeChild(this.calloutLabel.label);
    this.calloutLabel.label.removeEventListener('mousewheel', this.viewer.toolController.mousewheel);
    this.calloutLabel.label.removeEventListener('mouseover', this.onMeasurementHoveredBinded);
    //this.calloutLabel.label.removeEventListener('click', this.onSelectionAreaClickedBinded);
    this.calloutLabel.label = this.calloutLabel.p = null;
  }


  if (this.areaLabel && this.areaLabel.label) {
    this.areaLabel.label.parentNode.removeChild(this.areaLabel.label);
    this._removeEventListener(this.areaLabel.label);
    this.areaLabel.label = this.areaLabel.p1 = this.areaLabel.p2 = null;
  }



  if (this.viewer.impl.overlayScenes[this.overlayName]) {
    this.viewer.impl.removeOverlayScene(this.overlayName);
  }

  this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
  this.removeWindowEventListener('mouseup', this.handleButtonUpBinded);
};

proto.clearXYZLine = function () {
  this.viewer.impl.removeOverlay(this.overlayName, this.lines.xyz.line, true);

  this.lines.xyz.tips && this.lines.xyz.tips.forEach(function (tip) {
    this.viewer.impl.removeOverlay(this.overlayName, tip, true);
  }.bind(this));
};



proto.clearSpotMesh = function () {
  if (this.spotMesh) {
    this.viewer.impl.removeOverlay(this.overlayName, this.spotMesh, true);
  }
};

// Update scale for vertex, edge, line and extension dash line
proto.updateScale = function () {
  var name;

  this.angleOutline.forEach((cylinderMesh) => this.setCylinderScale(cylinderMesh));

  this.arcOutline.forEach((cylinderMesh) => this.setCylinderScale(cylinderMesh));

  for (name in this.lines) {
    if (Object.prototype.hasOwnProperty.call(this.lines, name)) {
      var item = this.lines[name];
      if (item.line && item !== this.lines.xyz) {
        this.setCylinderScale(item.line, item.p1, item.p2);
      }
    }
  }

  for (name in this.segments) {
    if (Object.prototype.hasOwnProperty.call(this.segments, name)) {
      var segment = this.segments[name];
      if (segment.line) {
        this.setCylinderScale(segment.line, segment.p1, segment.p2);
      }
    }
  }

  if (this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE) {
    if (this.measurement.isComplete()) {
      this.clearXYZLine();
      this.drawXYZLine(this.lines.xyz);
    }
  }

  if (this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_ARC) {
    this.arcTip.forEach((cylinderMesh) =>
    {
      var scale = this.setScale(cylinderMesh.position);
      if (Object.prototype.hasOwnProperty.call(cylinderMesh, "lmv_line_width")) {
        var scaleXZ = scale * cylinderMesh.lmv_line_width;
        cylinderMesh.scale.x = scaleXZ;
        cylinderMesh.scale.z = scaleXZ;
      }
      var scaleY = scale * (2 * _tipHeight);
      cylinderMesh.scale.y = scaleY;
    });
  }

  if (this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT) {
    if (this.spotMesh) {
      const scale = this.setScale(this.spotMesh.position);
      this.spotMesh.scale.set(scale, scale, scale);
    }
  }


};

proto.setNoTopology = function () {
  this.topologyStatus = TOPOLOGY_NOT_AVAILABLE;
  if (this.lines.xyz.label) {
    setVisibilityMeasurementLabelSpinner(this.lines.xyz.label, false, this.topologyStatus);
    this.lines.xyz.label.classList.remove('fetching-topology');
  }
};
proto.setFetchingTopology = function () {
  this.topologyStatus = TOPOLOGY_FETCHING;
  if (this.lines.xyz.label) {
    setVisibilityMeasurementLabelSpinner(this.lines.xyz.label, true, this.topologyStatus);
    this.lines.xyz.label.classList.add('fetching-topology');
  }
};
proto.setTopologyAvailable = function () {
  this.topologyStatus = TOPOLOGY_AVAILABLE;
  if (this.lines.xyz.label) {
    setVisibilityMeasurementLabelSpinner(this.lines.xyz.label, false, this.topologyStatus);
    this.lines.xyz.label.classList.remove('fetching-topology');
  }
};

proto.createMeasurementLabel = function () {

  const _document = this.getDocument();

  var label = _document.createElement('div');
  label.className = 'measure-length';

  var spinner = _document.createElement('div');
  spinner.className = 'measure-fetching-topology';
  spinner.style.display = 'none';
  label.appendChild(spinner);

  var text = _document.createElement('div');
  text.className = 'measure-length-text';
  label.appendChild(text);

  var delta = _document.createElement('div');
  delta.className = MeasureLabelClasses.value + ' measure-delta-text';
  label.appendChild(delta);

  label.causeStacking = true;

  if (!av.isMobileDevice()) {
    MeasureCommon.safeToggle(label, 'enable-hover', true);
  }

  return label;
};

// Receives an object created with createMeasurementLabel()
function setVisibilityMeasurementLabelText(label, isVisible) {
  var div = label.querySelector('.measure-length-text');
  div && (div.style.display = isVisible ? '' : 'none');
}

// Add as prototype method for inheritance
proto.setValueMeasurementLabelText = function (label, strValue) {
  if (!label) return;
  var div = label.querySelector('.measure-length-text');
  div && (div.textContent = strValue);
};

proto.isVisible = function (label) {
  return label.classList.contains('visible');
};

// Create a space with formatting from format
function createSpan(format) {
  // If format is a string, no formatting - just return the escaped string
  if (typeof format === 'string') {
    return document.createTextNode(format);
  }

  // Build a span with font-size and font-weight
  const span = document.createElement('span');
  let hasFormatting = false;
  if (format.fontSize !== undefined && format.fontSize !== 10) {
    // Base the fontSize on 10 === 100% which is ADRs default
    // LMV uses 12 as the default.
    span.style.fontSize = `${Math.floor(format.fontSize * 10)}%`;
    hasFormatting = true;
  }
  if (format.bold !== undefined) {
    span.style.fontWeight = format.bold ? 'bold' : 'normal';
    hasFormatting = true;
  }
  span.textContent = format.text;

  // return escaped string if no formatting
  return hasFormatting ? span : document.createTextNode(format.text);
}

function setValueMeasurementLabelCallout(context, label, calloutValue) {
  // If the calloutValue is just a string, then set it as text.
  if (typeof calloutValue === 'string') {
    context.setValueMeasurementLabelText(label, calloutValue);
    return;
  }

  var div = label.querySelector('.measure-length-text');
  if (div) {
    const values = Array.isArray(calloutValue) ? calloutValue : [calloutValue];
    div.replaceChildren(...values.map(createSpan));
  }
}

// Receives an object created with createMeasurementLabel()
function setDeltaMeasurementLabelText(label, strValue) {
  if (!label) return;
  var div = label.querySelector('.measure-delta-text');
  div && (div.textContent = strValue);
}

// Receives an object created with createMeasurementLabel()
function setVisibilityMeasurementLabelSpinner(label, isVisible, topologyStatus) {
  if (!label) return;
  var div = label.querySelector('.measure-fetching-topology');
  div && (div.style.display =
  isVisible && topologyStatus === TOPOLOGY_FETCHING ? 'inline-block' : 'none');
}

/**
 * Helper function that creates the label used for (1) and (2),
 * which are the 2 mouse clicks for the measurement.
 */
proto.createSnapResultLabel = function (pointNumber) {
  const _document = this.getDocument();

  var label = _document.createElement('div');
  label.className = 'measure-label';
  label.id = 'measure-label';

  var label_icon = _document.createElement('div');
  label_icon.className = 'measure-label-icon';
  label.appendChild(label_icon);

  if (av.isTouchDevice()) {
    this.initLabelMobileGestures(label, pointNumber, this.measureTool);
    var hitArea = _document.createElement('div');
    hitArea.className = 'measure-label-hit-area';
    label.appendChild(hitArea);
  }

  if (!av.isMobileDevice()) {
    this.initMouseEvent(label, pointNumber);

    label.addEventListener('mousewheel', this.viewer.toolController.mousewheel);
    MeasureCommon.safeToggle(label, 'enable-hover', true);
  }


  label.causeStacking = false;

  return label;
};

proto.showAngleLabel = function (midPoint) {

  var label = this.angleLabel.label;

  if (!label) {
    label = this.angleLabel.label = this.createMeasurementLabel();
    this.viewer.container.appendChild(label);
    this._addEventListener(label);
  }

  this.updateAngle();
  this.showLabel(label);

  this.angleLabel.p1 = midPoint.clone();
  this.angleLabel.p2 = midPoint.clone();

};

proto.showArcLabel = function (midPoint) {

  var label = this.arcLabel.label;

  if (!label) {
    this.arcLabel.label = label = this.createArcLabel();
  } else
  {
    this.hideLabel(label);
  }
  this.updateArcLength();
  this.showLabel(label);

  this.arcLabel.p1 = midPoint.clone();
  this.arcLabel.p2 = midPoint.clone();

};

proto.showSpotLabel = function (p) {

  var label = this.spotLabel.label;

  if (!label) {
    label = this.spotLabel.label = this.createMeasurementLabel();
    label.id = 'measurement-spot-label';
    label.style.whiteSpace = 'pre-line';
    label.style.height = 'auto';
    label.style.textAlign = 'start';
    label.querySelector('.measure-delta-text').style.display = 'none';
    this.viewer.container.appendChild(label);
    this._addEventListener(label);
  }

  this.updateSpot();
  this.showLabel(label);

  this.spotLabel.p = p.clone();
};

proto.showCalloutLabel = function (p) {

  var label = this.calloutLabel.label;

  if (!label) {
    label = this.calloutLabel.label = this.createMeasurementLabel();
    label.style.whiteSpace = 'pre-line';
    label.style.height = 'auto';
    label.style.textAlign = 'start';
    if (this.measurement.options && this.measurement.options.width)
    label.style.width = this.measurement.options.width + 'px';
    label.querySelector('.measure-delta-text').style.display = 'none';
    this.viewer.container.appendChild(label);
    label.addEventListener('mousewheel', this.viewer.toolController.mousewheel);
    label.addEventListener('mouseover', this.onMeasurementHoveredBinded);
    //label.addEventListener('click', this.onSelectionAreaClickedBinded);
  }

  this.updateCallout();
  this.showLabel(label);

  this.calloutLabel.p = p.clone();

};

proto.showAreaLabel = function (midPoint) {

  var label = this.areaLabel.label;

  if (!label) {
    label = this.areaLabel.label = this.createMeasurementLabel();
    this.viewer.container.appendChild(label);
    this._addEventListener(label);
  }

  this.updateArea();
  this.showLabel(label);

  this.areaLabel.p1 = midPoint;
  this.areaLabel.p2 = midPoint;

};



proto.onMeasurementHovered = function () {
  this.measureTool.hoverMeasurementById(this.measurement.id);
};

proto.onSelectionAreaClicked = function () {
  this.viewer.dispatchEvent({ type: MeasureCommon.Events.SELECT_MEASUREMENT, data: { id: this.measurement.id } });
  this.measureTool.selectMeasurementById(this.measurement.id);
};

proto.onSelectionAreaDblClicked = async function (e) {
  const label = e.target;

  // clicked element should be a label
  if (!label || !label.classList.contains('measure-length'))
  return;

  const value = label.querySelector('.measure-length-text')?.textContent;
  const multipleValues = value.includes('\n');

  console.assert(value, 'empty measurement value');

  // copy value to clipboard
  if (navigator && 'clipboard' in navigator) {
    await navigator.clipboard.writeText(value);

    // show in-place notification
    const hint = this.getDocument().createElement('div');
    hint.className = 'measure-copy-hint';
    const term = multipleValues ? 'Values copied' : 'Value copied';
    hint.textContent = Autodesk.Viewing.i18n.translate(term);
    label.appendChild(hint);

    // remove the DOM element after the animation is finished
    // see animation-duration of .measure-copy-hint in Measure.css
    setTimeout(() => {
      label.removeChild(hint);
    }, 1750);
  }
};

proto.createSelectionArea = function () {
  const _document = this.getDocument();
  var selectionArea = _document.createElement('div');
  selectionArea.id = 'measurement-selection-area-' + this.measurement.id;
  this.viewer.container.appendChild(selectionArea);
  selectionArea.className = 'measure-selection-area';
  selectionArea.style.display = 'none';
  this._addEventListener(selectionArea);
  return selectionArea;
};

proto.updateSelectionArea = function () {

  this.segments.forEach(function (item)
  {
    if (item.p1 && item.p2) {
      var p1 = MeasureCommon.project(item.p1, this.viewer);
      var p2 = MeasureCommon.project(item.p2, this.viewer);

      if (!item.selectionArea) {
        item.selectionArea = this.createSelectionArea();
      }

      var selectionArea = item.selectionArea;

      var v = new THREE.Vector2();

      selectionArea.style.top = p1.y - _selectorAreaSize / 2 + 'px';
      selectionArea.style.left = p1.x + 'px';
      selectionArea.style.width = v.subVectors(p1, p2).length() + 'px';
      selectionArea.style.height = _selectorAreaSize + 'px';

      if (this.measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT) {
        selectionArea.style.left = p1.x + _selectorAreaSize / 2 + 'px';
        selectionArea.style.width = _selectorAreaSize + 'px';
      }

      var angle = null;
      var deltaX = p1.x - p2.x;
      var deltaY = p1.y - p2.y;

      angle = Math.atan2(-deltaY, -deltaX) * 180 / Math.PI;

      selectionArea.style.transform = 'rotate(' + angle + 'deg)';
      selectionArea.style.transformOrigin = '0px ' + _selectorAreaSize / 2 + 'px';
    }
  }.bind(this));

  if (this.measureTool.areAllPicksSet()) {
    this.enableSelectionAreas(true);
  }
};

proto.clearSelectionAreas = function () {
  const _document = this.getDocument();
  this.segments.forEach(function (item)
  {
    if (item.selectionArea) {
      this._removeEventListener(item.selectionArea);
      var element = _document.getElementById('measurement-selection-area-' + this.measurement.id);
      if (element) {
        element.parentNode.removeChild(element);
      }
      item.selectionArea = null;
    }
  }.bind(this));
};

proto.enableSelectionAreas = function (enable) {
  this.segments.forEach(function (item)
  {
    if (item.selectionArea) {
      if (enable) {
        item.selectionArea.style.display = 'block';
      } else
      {
        item.selectionArea.style.display = 'none';
      }
    }
  }.bind(this));
};

proto.render = function (picks, showMeasureResult) {
  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype.render.call(this, picks, showMeasureResult);

  this.updateSelectionArea();
};

proto.renderFromPoints = function (pointData, showMeasureResult) {
  _Indicator_js__WEBPACK_IMPORTED_MODULE_0__.Indicator.prototype.renderFromPoints.call(this, pointData, showMeasureResult);

  this.updateSelectionArea();
};

proto.onCameraChange = function () {
  this.redrawDashedLines();
  this.updateSelectionArea();
  this.hideLabelsOutsideOfView();
  this.updateLabelsPosition();
};

proto.handleResize = function () {
  this.redrawDashedLines();
  this.updateSelectionArea();
  this.updateLabelsPosition();
};

/***/ },

/***/ "./extensions/Measure/MeasureToolbar.js"
/*!**********************************************!*\
  !*** ./extensions/Measure/MeasureToolbar.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MeasureToolbar: () => (/* binding */ MeasureToolbar)
/* harmony export */ });
/* harmony import */ var _CustomTools_LaserToolRegistration_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./CustomTools/LaserToolRegistration.js */ "./extensions/Measure/CustomTools/LaserToolRegistration.js");
/* harmony import */ var _CustomTools_SurfaceToolRegistration_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CustomTools/SurfaceToolRegistration.js */ "./extensions/Measure/CustomTools/SurfaceToolRegistration.js");

var av = Autodesk.Viewing;
var avu = Autodesk.Viewing.UI;
var avp = Autodesk.Viewing.Private;
var MeasureCommon = Autodesk.Viewing.MeasureCommon;




// /** @constructor */
function MeasureToolbar(measureExtension)
{
  this.measureExtension = measureExtension;
  this.measureTool = this.measureExtension.measureTool;
  this.viewer = this.measureExtension.viewer;
  this.setGlobalManager(this.viewer.globalManager);
  this.visible = false;
  this.buttonsList = [];
}

var proto = MeasureToolbar.prototype;
av.GlobalManagerMixin.call(MeasureToolbar.prototype);

proto.onUnitChange = function (toUnits, selfTriggered) {
  if (selfTriggered)
  this.measureTool.setUnits(toUnits);else
  {
    this.updateSettingsPanel();
    avp.logger.track({ category: 'pref_changed', name: 'measure/units', value: toUnits });
  }
};

proto.onSecondaryUnitChange = function (toUnits, selfTriggered) {
  if (selfTriggered) {
    this.measureTool.setSecondaryUnits(toUnits);
  } else {
    this.updateSettingsPanel();
    avp.logger.track({ category: 'pref_changed', name: 'measure/secondary-units', value: toUnits });
  }
};

proto.onPrecisionChange = function (precision, selfTriggered) {
  if (selfTriggered)
  this.measureTool.setPrecision(precision);else
  {
    this.updateSettingsPanel();
    avp.logger.track({ category: 'pref_changed', name: 'measure/precision', value: precision });
  }
};

// update button states
proto.onMeasurementChange = function () {
  const numMeasurements = this.measureTool.getMeasurementCount();
  this.deleteBtn.setState(numMeasurements > 0 ? avu.Button.State.INACTIVE : avu.Button.State.DISABLED);
};

proto.init = function () {
  var self = this;

  const _document = this.getDocument();

  this.onUnitChangeBound = this.onUnitChange.bind(this);
  this.viewer.addEventListener(MeasureCommon.Events.DISPLAY_UNITS_CHANGED, this.onUnitChangeBound);

  if (this.measureTool._sharedMeasureConfig.enableSecondaryUnits) {
    this.onSecondaryUnitChangeBound = this.onSecondaryUnitChange.bind(this);
    this.viewer.addEventListener(MeasureCommon.Events.SECONDARY_DISPLAY_UNITS_CHANGED, this.onSecondaryUnitChangeBound);
  }

  this.onPrecisionChangeBound = this.onPrecisionChange.bind(this);
  this.viewer.addEventListener(MeasureCommon.Events.PRECISION_CHANGED, this.onPrecisionChangeBound);

  // update button state when measurements change
  this.onMeasurementChangeBound = this.onMeasurementChange.bind(this);
  this.viewer.addEventListener(MeasureCommon.Events.MEASUREMENT_COMPLETED_EVENT, this.onMeasurementChangeBound);
  this.viewer.addEventListener(MeasureCommon.Events.DELETE_MEASUREMENT, this.onMeasurementChangeBound);

  // Add Measure tool toolbar to main toolbar
  var toolbar = this.viewer.getToolbar();
  var navigationBar = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);
  var toolbarOptions = {};
  toolbarOptions.index = toolbar.indexOf(navigationBar) + 1;
  this.measureToolbar = new avu.ControlGroup(Autodesk.Viewing.TOOLBAR.MEASURETOOLSID);
  this.measureToolbar.setGlobalManager(this.globalManager);
  toolbar.addControl(this.measureToolbar, toolbarOptions);


  // Create a button for the measure simple distance.
  this.measureSimpleDistanceBtn = new avu.Button("toolbar-measureTool-simple-distance");
  this.measureSimpleDistanceBtn.setGlobalManager(this.globalManager);
  this.measureSimpleDistanceBtn.setToolTip("Distance");
  this.measureSimpleDistanceBtn.setIcon("adsk-icon-measure-distance-new");
  this.measureSimpleDistanceBtn.onClick = function () {
    var enable = self.measureSimpleDistanceBtn.getState() !== avu.Button.State.ACTIVE;
    if (enable) {
      self.measureExtension.activate('distance');
    } else {
      self.measureTool.deselectAllMeasurements();
    }
  };

  this.measureToolbar.addControl(this.measureSimpleDistanceBtn);
  this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE] = this.measureSimpleDistanceBtn;


  // Create a button for the measure Angle.
  this.measureAngleBtn = new avu.Button("toolbar-measureTool-angle");
  this.measureAngleBtn.setGlobalManager(this.globalManager);
  this.measureAngleBtn.setToolTip("Angle");
  this.measureAngleBtn.setIcon("adsk-icon-measure-angle-new");
  this.measureAngleBtn.onClick = function () {
    var enable = self.measureAngleBtn.getState() !== avu.Button.State.ACTIVE;
    if (enable) {
      self.measureExtension.activate('angle');
    } else {
      self.measureTool.deselectAllMeasurements();
    }
  };
  this.measureToolbar.addControl(this.measureAngleBtn);
  this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE] = this.measureAngleBtn;

  if (this.viewer.model && this.viewer.model.is2d()) {
    // Create a button for the measure distance.
    this.measureAreaBtn = new avu.Button("toolbar-measureTool-area");
    this.measureAreaBtn.setGlobalManager(this.globalManager);
    this.measureAreaBtn.setToolTip("Area");
    this.measureAreaBtn.setIcon("adsk-icon-measure-area-new");
    this.measureAreaBtn.onClick = function () {
      var enable = self.measureAreaBtn.getState() !== avu.Button.State.ACTIVE;
      if (enable) {
        self.measureExtension.activate('area');
      } else {
        self.measureTool.deselectAllMeasurements();
      }
    };

    this.measureToolbar.addControl(this.measureAreaBtn);
    this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_AREA] = this.measureAreaBtn;
  }

  if (this.viewer.model && this.viewer.model.is2d()) {
    // Create a button for the arc measurement.
    this.measureArcBtn = new avu.Button("toolbar-measureTool-arc");
    this.measureArcBtn.setGlobalManager(this.globalManager);
    this.measureArcBtn.setToolTip("Arc");
    this.measureArcBtn.setIcon("adsk-icon-measure-arc-new");
    this.measureArcBtn.onClick = function () {
      var enable = self.measureArcBtn.getState() !== avu.Button.State.ACTIVE;
      if (enable) {
        self.measureExtension.activate('arc');
      } else {
        self.measureTool.deselectAllMeasurements();
      }
    };

    this.measureToolbar.addControl(this.measureArcBtn);
    this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_ARC] = this.measureArcBtn;
  }

  // Create a button for the spot measurement tool only in 3d
  if (this.viewer.model && !this.viewer.model.is2d()) {
    this.measureSpotBtn = new avu.Button("toolbar-measureTool-simple-spot");
    this.measureSpotBtn.setGlobalManager(this.globalManager);
    this.measureSpotBtn.setToolTip("Spot Coordinate");
    this.measureSpotBtn.setIcon("adsk-icon-measure-location");
    this.measureSpotBtn.onClick = function () {
      var enable = self.measureSpotBtn.getState() !== avu.Button.State.ACTIVE;
      if (enable) {
        self.measureExtension.activate('spot');
      } else {
        self.measureTool.deselectAllMeasurements();
      }
    };

    this.measureToolbar.addControl(this.measureSpotBtn);
    this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT] = this.measureSpotBtn;
  }

  if (this.viewer.model && !this.viewer.model.is2d()) {
    // Create a button for Laser tool (Laser pointer and basic dimensioning).
    if (av.FeatureFlags.isEnabled(avp.InternalFeatureFlags.EnableLaserMeasurement)) {
      this.measureLaserBtn = (0,_CustomTools_LaserToolRegistration_js__WEBPACK_IMPORTED_MODULE_0__.createLaserToolButton)(this);
    }
    this.measureSurfaceBtn = (0,_CustomTools_SurfaceToolRegistration_js__WEBPACK_IMPORTED_MODULE_1__.createSurfaceToolButton)(this);
    this.measureShortestDistanceBtn = new avu.Button("toolbar-measureTool-shortest-distance");
    this.measureShortestDistanceBtn.setGlobalManager(this.globalManager);
    this.measureShortestDistanceBtn.setToolTip("Shortest Distance");
    this.measureShortestDistanceBtn.setIcon("adsk-icon-measure-shortest-distance");
    this.measureShortestDistanceBtn.onClick = function () {
      var enable = self.measureShortestDistanceBtn.getState() !== avu.Button.State.ACTIVE;
      if (enable) {
        self.measureExtension.activate('shortest-distance');
      } else {
        self.measureTool.deselectAllMeasurements();
      }
    };
    this.measureToolbar.addControl(this.measureShortestDistanceBtn);
    this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_SHORTEST_DISTANCE] = this.measureShortestDistanceBtn;
  }

  // Slope Measurement
  if (av.FeatureFlags.isEnabled(avp.InternalFeatureFlags.EnableSlopeMeasurement)) {
    if (this.viewer.model && !this.viewer.model.is2d()) {
      this.slopeMeasureBtn = new avu.Button("toolbar-measureTool-slope");
      this.slopeMeasureBtn.setGlobalManager(this.globalManager);
      this.slopeMeasureBtn.setToolTip("Slope");
      this.slopeMeasureBtn.setIcon("adsk-icon-measure-distance-new");
      this.slopeMeasureBtn.onClick = function () {
        var enable = self.slopeMeasureBtn.getState() !== avu.Button.State.ACTIVE;
        if (enable) {
          self.measureExtension.activate('slope');
        } else {
          self.measureTool.deselectAllMeasurements();
        }
      };
      this.measureToolbar.addControl(this.slopeMeasureBtn);
      this.buttonsList[MeasureCommon.MeasurementTypes.MEASUREMENT_SLOPE] = this.slopeMeasureBtn;
    }
  }

  // Create a button for the Calibration tool.
  this.calibrationToolBtn = new avu.Button("toolbar-calibrationTool");
  this.calibrationToolBtn.setGlobalManager(this.globalManager);
  this.calibrationToolBtn.setToolTip("Calibrate");
  this.calibrationToolBtn.setIcon("adsk-icon-measure-calibration");
  this.calibrationToolBtn.onClick = function (e) {
    var enable = self.calibrationToolBtn.getState() !== avu.Button.State.ACTIVE;
    if (enable) {
      self.measureExtension.activate('calibrate');
    } else {
      self.measureExtension.enableCalibrationTool(false);
    }
  };

  this.measureToolbar.addControl(this.calibrationToolBtn);
  this.buttonsList[MeasureCommon.MeasurementTypes.CALIBRATION] = this.calibrationToolBtn;

  var separator = _document.createElement('div');
  separator.className = 'measure-toolbar-seperator';

  this.measureToolbar.container.appendChild(separator);


  // Create a button for the Trash.
  this.deleteBtn = new avu.Button("toolbar-delete");
  this.deleteBtn.setGlobalManager(this.globalManager);
  this.deleteBtn.setToolTip("Delete measurement");
  this.deleteBtn.setIcon("adsk-icon-measure-trash");

  this.deleteBtn.onClick = function () {
    const activeMeasurement = self.measureTool.getMeasurement();
    const numMeasurements = self.measureTool.getMeasurementCount();

    if (activeMeasurement || !av.FeatureFlags.isEnabled(avp.InternalFeatureFlags.EnableDeleteAllMeasurements)) {
      self.measureExtension.deleteCurrentMeasurement();
    } else
    if (numMeasurements == 1) {// skip confirmation when removing a single measurement
      self.measureTool.deleteMeasurements();
    } else
    if (numMeasurements > 1) {// show confirmation
      const result = confirm(Autodesk.Viewing.i18n.translate('Confirm delete all'));

      if (result)
      self.measureTool.deleteMeasurements();
    }
  };

  this.measureToolbar.addControl(this.deleteBtn);

  // Create a button for the Settings panel.
  this.settingsBtn = new avu.Button("toolbar-settings");
  this.settingsBtn.setGlobalManager(this.globalManager);
  this.settingsBtn.setToolTip("Measure settings");
  this.settingsBtn.setIcon("adsk-icon-measure-settings");

  this.settingsControlPanel = _document.createElement('div');
  this.settingsControlPanel.classList.add('docking-panel');
  this.settingsControlPanel.classList.add('docking-panel-container-solid-color-b');
  this.settingsControlPanel.classList.add('measure-settings-popup');
  this.settingsControlPanel.classList.add('hide');

  this.settingsBtn.onClick = function (event) {
    if (this.settingsControlPanel.classList.contains('hide')) {
      this.settingsControlPanel.classList.remove('hide');
      this.setButtonActive(this.settingsBtn);
    } else
    {
      this.settingsControlPanel.classList.add('hide');
      this.setButtonInactive(this.settingsBtn);
    }
  }.bind(this);

  this.measureToolbar.container.appendChild(this.settingsControlPanel);
  this.settingsControlPanel.root = this.settingsBtn;
  this.measureToolbar.addControl(this.settingsBtn);


  // Settings Panel
  this.table = _document.createElement("table");
  this.table.classList.add("adsk-lmv-tftable");
  this.table.classList.add("calibration-table");

  this.tbody = _document.createElement("tbody");
  this.table.appendChild(this.tbody);
  this.settingsControlPanel.appendChild(this.table);

  this.units = [
  { name: 'Unknown', units: '', matches: [''] }, // localized in OptionDropDown() call below
  { name: '', units: 'please-select', matches: ['please-select'] }, // localized in OptionDropDown() call below
  { name: 'Decimal feet', units: 'decimal-ft', matches: ['ft', 'decimal-ft'] }, // localized in OptionDropDown() call below
  { name: 'Feet and fractional inches', units: 'ft-and-fractional-in', matches: ['ft-and-fractional-in'] }, // localized in OptionDropDown() call below
  { name: 'Feet and decimal inches', units: 'ft-and-decimal-in', matches: ['ft-and-decimal-in'] }, // localized in OptionDropDown() call below
  { name: 'Decimal inches', units: 'decimal-in', matches: ['in', 'decimal-in'] }, // localized in OptionDropDown() call below
  { name: 'Fractional inches', units: 'fractional-in', matches: ['fractional-in'] }, // localized in OptionDropDown() call below
  { name: 'US Survey Feet', units: 'sft', matches: ['sft'] }, // localized in OptionDropDown() call below
  { name: 'Meters', units: 'm', matches: ['m'] }, // localized in OptionDropDown() call below
  { name: 'Centimeters', units: 'cm', matches: ['cm'] }, // localized in OptionDropDown() call below
  { name: 'Millimeters', units: 'mm', matches: ['mm'] }, // localized in OptionDropDown() call below
  { name: 'Meters and centimeters', units: 'm-and-cm', matches: ['m-and-cm'] }, // localized in OptionDropDown() call below
  { name: 'Points', units: 'pt', matches: ['pt'] } // localized in OptionDropDown() call below
  ];

  var initialIndex = this.findUnits(),
    unitNames = [];

  // It is not possible to hide elements in Safari.
  if (av.isSafari() && this.viewer.model && this.viewer.model.getDisplayUnit()) {
    // We will remove the 'Unknown' unit from the units array.
    this.units.shift();
  }

  // Create unit names for PRIMARY dropdown (exclude blank)
  for (var i = 0; i < this.units.length; ++i) {
    if (this.units[i].units !== 'please-select') {
      unitNames.push(this.units[i].name);
    }
  }

  this.unitList = new avp.OptionDropDown("Unit type", this.tbody, unitNames, initialIndex, null, { paddingLeft: 0, paddingRight: 15 });
  this.unitList.setGlobalManager(this.globalManager);
  this.unitList.addEventListener("change", function (e) {
    var index = self.unitList.selectedIndex;
    // Find the actual unit index in the units array (accounting for skipped blank)
    var actualIndex = 0;
    var dropdownIndex = 0;
    for (var j = 0; j < self.units.length; j++) {
      if (self.units[j].units !== 'please-select') {
        if (dropdownIndex === index) {
          actualIndex = j;
          break;
        }
        dropdownIndex++;
      }
    }
    self.onUnitChange(self.units[actualIndex].units, true);
  });

  // Only create secondary units dropdown if feature is enabled
  if (this.measureTool._sharedMeasureConfig.enableSecondaryUnits) {
    // Find secondary units initial index
    const secondaryInitialIndex = this.findSecondaryUnits();

    // Create unit names for SECONDARY dropdown (include all units with blank)
    let secondaryUnitNames = [];
    for (let i = 0; i < this.units.length; ++i) {
      secondaryUnitNames.push(this.units[i].name);
    }

    this.secondaryUnitList = new avp.OptionDropDown("Secondary unit", this.tbody, secondaryUnitNames, secondaryInitialIndex, null, { paddingLeft: 0, paddingRight: 15 });
    this.secondaryUnitList.setGlobalManager(this.globalManager);
    this.secondaryUnitList.addEventListener("change", function (e) {
      let index = self.secondaryUnitList.selectedIndex;
      self.onSecondaryUnitChange(self.units[index].units, true);
    });
  }

  this.precisionList = new avp.OptionDropDown("Precision", this.tbody, [], -1, null, { paddingLeft: 0, paddingRight: 15 });
  this.precisionList.setGlobalManager(this.globalManager);
  this.precisionList.addEventListener("change", function (e) {
    var index = self.precisionList.selectedIndex;
    self.onPrecisionChange(index, true);
  });

  this.isolate = new avp.OptionCheckbox("Isolate measurement", this.tbody, false);
  this.isolate.setGlobalManager(this.globalManager);
  this.isolate.addEventListener("change", function (e) {
    var enable = self.isolate.checked;
    self.measureTool.setIsolateMeasure(enable);
    if (enable) {
      self.measureTool.isolateMeasurement();
    } else
    {
      self.measureTool.clearIsolate();
    }
    avp.logger.track({ category: 'pref_changed', name: 'measure/isolate', value: enable });
  });

  this.freeMeasure = new avp.OptionCheckbox("Enable free measure", this.tbody, this.measureExtension.isFreeMeasureMode());
  this.freeMeasure.setGlobalManager(this.globalManager);
  this.freeMeasure.addEventListener("change", function (e) {
    var enable = self.freeMeasure.checked;
    self.measureExtension.setFreeMeasureMode(enable);
    avp.logger.track({ category: 'pref_changed', name: 'measure/freeMeasure', value: enable });
  });

  this.setupPrecision();

  this.updateSettingsPanel();

  if (this.viewer.model && this.viewer.model.is2d()) {
    this.isolate.setVisibility(false);
  }

  // BLMV-6350 - disable only if units are undefined, do not disable if null, since we are going to assign units in Measure.js, `_onModelLoaded`.
  if (this.measureExtension.sharedMeasureConfig.units === undefined) {
    this.disableUnitOption();
    this.disableSecondaryUnitOption();
  }
  // Only disable option if the browser is not Safari
  else if (!Autodesk.Viewing.isSafari()) {
    this.disableUnitOption(0); // disable "Unknown" option when the model has units
    this.disableSecondaryUnitOption(0); // disable "Unknown" option for secondary units too
  }


  // Create a button for 'Done'.
  this.measureDoneBtn = new avu.Button("toolbar-measureTool-done");
  this.measureDoneBtn.setGlobalManager(this.globalManager);
  var doneText = Autodesk.Viewing.i18n.translate('Done');
  this.measureDoneBtn.setToolTip(doneText);
  var cancelLabel = _document.createElement('label');
  cancelLabel.textContent = doneText;
  var btnContainer = this.measureDoneBtn.container;
  btnContainer.appendChild(cancelLabel);
  btnContainer.classList.add('adsk-label-button');
  var iconEle = btnContainer.getElementsByClassName('adsk-button-icon');
  iconEle && iconEle[0] && (iconEle[0].style.display = 'none');

  this.measureDoneBtn.onClick = function () {
    this.measureExtension.exitMeasurementMode();
  }.bind(this);
  this.measureToolbar.addControl(this.measureDoneBtn);

  this.onMeasurementChange(); // init button states

  // this.settingsControlPanel.style.width = this.measureToolbar.container.getBoundingClientRect().width + 'px';
  this.measureToolbar.setVisible(false);

};

proto.addCustomToolButton = function (type, button, index) {
  this.measureToolbar.addControl(button, { index: index });
  this.buttonsList[type] = button;
};

proto.removeCustomToolButton = function (type) {
  var button = this.buttonsList[type];
  if (button) {
    this.measureToolbar.removeControl(button);
    delete this.buttonsList[type];
  }
};

proto.destroy = function () {

  // If toolbar was open, close it first. Otherwise, we leave ModelTools toolbar in a broken state.
  if (this.visible) {
    this.closeToolbar();
  }

  this.viewer.removeEventListener(MeasureCommon.Events.DISPLAY_UNITS_CHANGED, this.onUnitChangeBound);
  this.onUnitChangeBound = null;
  if (this.measureTool._sharedMeasureConfig.enableSecondaryUnits && this.onSecondaryUnitChangeBound) {
    this.viewer.removeEventListener(MeasureCommon.Events.SECONDARY_DISPLAY_UNITS_CHANGED, this.onSecondaryUnitChangeBound);
    this.onSecondaryUnitChangeBound = null;
  }
  this.viewer.removeEventListener(MeasureCommon.Events.PRECISION_CHANGED, this.onPrecisionChangeBound);
  this.onPrecisionChangeBound = null;

  this.viewer.removeEventListener(MeasureCommon.Events.MEASUREMENT_COMPLETED_EVENT, this.onMeasurementChangeBound);
  this.viewer.removeEventListener(MeasureCommon.Events.DELETE_MEASUREMENT, this.onMeasurementChangeBound);
  this.onMeasurementChangeBound = null;

  if (this.measureToolbar) {
    this.measureToolbar.removeFromParent();
    this.measureToolbar = null;
  }
};

proto.closeToolbar = function () {

  this.measureExtension.enableMeasureTool(false);
  this.measureExtension.enableCalibrationTool(false);
  this.toggleVisible();

  var toolbar = this.viewer.getToolbar();
  var viewerToolbarContainer = toolbar.container;
  var viewerContainerChildrenCount = viewerToolbarContainer.children.length;

  for (var i = 0; i < viewerContainerChildrenCount; ++i) {
    viewerToolbarContainer.children[i].style.display = "";
  }

  var modelTools = toolbar.getControl(av.TOOLBAR.MODELTOOLSID);
  modelTools.addControl(this.measureExtension.measurementToolbarButton, { index: this.measureExtension.measurementToolbarButton.index });
};

proto.toggleVisible = function () {
  this.visible = !this.visible;
  this.measureToolbar.setVisible(this.visible);
  if (!this.visible) {
    this.settingsControlPanel.classList.add('hide');
    this.setButtonInactive(this.settingsBtn);
  }
};

proto.setButtonActive = function (button) {
  button.setState(avu.Button.State.ACTIVE);
};

proto.setButtonInactive = function (button) {
  if (button.getState() === avu.Button.State.ACTIVE) {
    button.setState(avu.Button.State.INACTIVE);
  }
};

proto.deactivateAllButtons = function () {
  for (var key in this.buttonsList) {
    if (Object.prototype.hasOwnProperty.call(this.buttonsList, key)) {
      var button = this.buttonsList[key];
      this.setButtonInactive(button);
    }
  }
};

proto.activateButtonByType = function (measurementType) {
  // Check that toolbar button exists - some measurement types don't have UI
  this.buttonsList[measurementType] && this.setButtonActive(this.buttonsList[measurementType]);
};

proto.setupPrecision = function () {
  const _document = this.getDocument();
  while (this.precisionList.dropdownElement.lastChild) {
    this.precisionList.dropdownElement.removeChild(this.precisionList.dropdownElement.lastChild);
  }

  var selectedUnits = this.measureTool.getUnits(),
    precisions;

  if (selectedUnits === 'ft-and-fractional-in' || selectedUnits === 'fractional-in') {
    precisions = ['1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'];
  } else {
    precisions = ['0', '0.1', '0.01', '0.001', '0.0001', '0.00001'];
  }

  for (var i = 0; i < precisions.length; ++i) {
    var elem = _document.createElement('option');
    elem.value = i;
    elem.textContent = precisions[i];
    this.precisionList.dropdownElement.appendChild(elem);
  }

  var selectedIndex = this.measureTool.getPrecision();
  if (precisions.length <= selectedIndex) {
    selectedIndex = precisions.length - 1;
    this.measureTool.setPrecision(selectedIndex);
  }
  this.precisionList.dropdownElement.selectedIndex = selectedIndex;
};

proto.findUnits = function () {
  var i,
    j,
    selectedUnits = this.measureTool.getUnits();

  // Find the matching unit in the full units array
  var actualIndex = -1;
  for (i = 0; i < this.units.length; ++i) {
    var matches = this.units[i].matches;
    if (matches) {
      for (j = 0; j < matches.length; ++j) {
        if (matches[j] === selectedUnits) {
          actualIndex = i;
          break;
        }
      }
    }
    if (actualIndex !== -1) break;
  }

  if (actualIndex === -1) {
    return 0;
  }

  // Convert to dropdown index (excluding blank option)
  var dropdownIndex = 0;
  for (i = 0; i < actualIndex; i++) {
    if (this.units[i].units !== 'please-select') {
      dropdownIndex++;
    }
  }

  return dropdownIndex;
};

proto.findSecondaryUnits = function () {
  var i,
    j,
    selectedSecondaryUnits = this.measureTool.getSecondaryUnits();
  for (i = 0; i < this.units.length; ++i) {
    var matches = this.units[i].matches;
    if (matches) {
      for (j = 0; j < matches.length; ++j) {
        if (matches[j] === selectedSecondaryUnits) {
          return i;
        }
      }
    }
  }
  // Default to a different unit than primary if secondary units not found
  var primaryIndex = this.findUnits();
  // If primary is first unit (index 0), use second unit (index 1), otherwise use first unit (index 0)
  // This ensures secondary units are always different from primary units for better UX
  return primaryIndex === 0 ? 1 : 0;
};

proto.disableUnitOption = function (index) {
  if (index != null) {
    this.unitList.dropdownElement.children[index].style.display = "none";
  } else {// disable all options
    this.unitList.dropdownElement.disabled = true;
  }
};

proto.disableSecondaryUnitOption = function (index) {
  if (!this.secondaryUnitList) return; // Skip if secondary units are disabled
  if (index != null) {
    // Never hide the "please-select" option - users should always be able to deselect secondary units
    if (this.units[index] && this.units[index].units === 'please-select') {
      return;
    }
    this.secondaryUnitList.dropdownElement.children[index].style.display = "none";
  } else {// disable all options
    this.secondaryUnitList.dropdownElement.disabled = true;
  }
};

proto.updateSettingsPanel = function () {
  this.unitList.dropdownElement.selectedIndex = this.findUnits();
  if (this.measureTool._sharedMeasureConfig.enableSecondaryUnits && this.measureTool.getSecondaryUnits && this.secondaryUnitList) {
    this.secondaryUnitList.dropdownElement.selectedIndex = this.findSecondaryUnits();
  }
  this.precisionList.dropdownElement.selectedIndex = this.measureTool.getPrecision();
  this.setupPrecision();
};

/***/ },

/***/ "./extensions/Measure/MeasurementsManager.js"
/*!***************************************************!*\
  !*** ./extensions/Measure/MeasurementsManager.js ***!
  \***************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MeasurementsManager: () => (/* binding */ MeasurementsManager)
/* harmony export */ });

var MeasureCommon = Autodesk.Viewing.MeasureCommon; //These come from main lmv bundle.

class MeasurementsManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.currentMeasurement = null;
    this.measurementsList = {};
    this.measurementsCounter = 0;
    this.restoredMeasurementData = [];
  }

  getCurrentMeasurement() {
    return this.currentMeasurement;
  }

  getRestoredMeasurementData() {
    return this.restoredMeasurementData.slice();
  }

  selectMeasurementById(id) {
    var measurement = this.measurementsList[id];

    if (measurement) {
      this.changeCurrentMeasurement(measurement);
      return this.currentMeasurement;
    }

    return false;
  }

  createMeasurement(measurementType, options) {
    var measurement = new MeasureCommon.Measurement(measurementType, this.measurementsCounter++, options);
    this.addMeasurement(measurement);
    return measurement;
  }

  addMeasurement(measurement) {
    // Measurements created by custom tools might not have an id yet, so we have to assign one first
    if (this.measurementsList[measurement.id] || measurement.id === undefined) {
      measurement.id = this.measurementsCounter++;
    }
    this.measurementsList[measurement.id] = measurement;
    this.changeCurrentMeasurement(measurement);
  }

  // Renders measurements from data.
  createMeasurementFromData(measurementData, measurementType, createIndicatorCb, preparePicksCb, measurement = null) {
    // Convert optional values from DWF to local coordinate
    let options = measurementData.options;
    if (options) {
      // Deep clone options
      options = JSON.parse(JSON.stringify(options));

      // Convert global world coordinates to LMV coordinates
      const model =
      Object.prototype.hasOwnProperty.call(options, 'modelId') && options.modelId ?
      this.viewer.impl.findModel(options.modelId) :
      this.viewer.model;
      const globalOffset = model && model.getData().globalOffset;
      if (globalOffset && (globalOffset.x !== 0 || globalOffset.y !== 0 || globalOffset.z !== 0)) {
        const cvtPts = (points) => {
          if (points) {
            for (let i = 0; i < points.length; ++i) {
              // Tricky way to use Vector3 sub on plain objects
              THREE.Vector3.prototype.sub.call(points[i], globalOffset);
            }
          }
        };
        cvtPts(options.dimensionOffset);
        cvtPts(options.dashedLeader);
        cvtPts(options.arc);
      }
    }

    if (measurement) {
      this.addMeasurement(measurement);
    } else {
      measurement = this.createMeasurement(measurementType, options);
    }
    if (createIndicatorCb instanceof Function) {
      createIndicatorCb(measurement);
    }

    this.initPicks(measurementData.picks, measurement);

    if (preparePicksCb instanceof Function) {
      preparePicksCb();
    }

    if (measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_AREA) {
      measurement.closedArea = true;
    } else if (measurement.measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_CALLOUT) {
      measurement.text = measurementData.text;
    }

    const preparePointData = (points) => {
      const keys = Object.keys(points);
      const data = [];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const pointData = points[key];
        data[key] = {
          intersection: pointData.intersection,
          circularArcRadius: pointData.circularArcRadius,
          circularArcCenter: pointData.circularArcCenter,
          faceNormal: pointData.faceNormal,
          dimensions: pointData.dimensions,
          laserHitPoint: pointData.laserHitPoint,
          surfaceData: pointData.surfaceData,
          surfaceProperties: pointData.surfaceProperties
        };
      }
      return data;
    };

    const indicator = measurement.indicator;

    indicator.changeAllEndpointsEditableStyle(true);
    indicator.enableSelectionAreas(true);
    indicator.enableLabelsTouchEvents(true);

    this.activatePicks(measurement);

    // Set isRestored flag before computing the result to make sure
    // the measurement knows it's restored
    measurement.isRestored = true;
    measurement.computeResult(measurement.picks, this.viewer);

    // This will render the measurements
    const points = this.restoredMeasurementData[measurement.id];
    indicator.renderFromPoints(preparePointData(points), true);

    indicator.changeAllEndpointsEditableStyle(true);
    indicator.enableSelectionAreas(true);
    indicator.enableLabelsTouchEvents(true);
  }

  // Initializes picks from pick data
  initPicks(pickData, measurement) {
    if (!pickData) return;
    const points = [];

    function handleGlobalOffset(pick, modelData) {
      const modifiedPick =
      modelData && Object.prototype.hasOwnProperty.call(modelData, 'globalOffset') ?
      pick.sub(modelData.globalOffset).clone() :
      pick.clone();
      return modifiedPick;
    }

    function convertObjectToVector3(pick) {
      return new THREE.Vector3(pick.x, pick.y, pick.z);
    }

    for (let i = 0; i < pickData.length; i++) {
      const pick = pickData[i];
      if (!pick) continue;
      const key = i + 1;

      let pickPoint = convertObjectToVector3(pick.intersection);
      let modifiedDimensions = [];

      let modifiedLaserDest = null;
      if (pick.laserHitPoint) {
        modifiedLaserDest = convertObjectToVector3(pick.laserHitPoint);
      }
      if (pick.dimensions) {
        for (let j = 0; j < pick.dimensions.length; j++) {
          const p1 = convertObjectToVector3(pick.dimensions[j].p1);
          const p2 = convertObjectToVector3(pick.dimensions[j].p2);
          if (p1 && p2) {
            modifiedDimensions.push({ p1, p2 });
          }
        }
      }

      const model =
      Object.prototype.hasOwnProperty.call(pick, 'modelId') && pick.modelId ?
      this.viewer.impl.findModel(pick.modelId) :
      this.viewer.model;

      if (model) {
        const modelData = model.getData();
        pickPoint = handleGlobalOffset(pickPoint, modelData);
        if (modifiedLaserDest) {
          modifiedLaserDest = handleGlobalOffset(modifiedLaserDest, modelData);
        }
        if (modifiedDimensions) {
          for (let j = 0; j < modifiedDimensions.length; j++) {
            modifiedDimensions[j].p1 = handleGlobalOffset(modifiedDimensions[j].p1, modelData);
            modifiedDimensions[j].p2 = handleGlobalOffset(modifiedDimensions[j].p2, modelData);
          }
        }
        if (pick.surfaceData) {
          const processVertex = (vertex) => {
            const vec = convertObjectToVector3(vertex);
            return handleGlobalOffset(vec, modelData);
          };
          const processShape = (shape) => {
            if (shape.centroid) {
              shape.centroid = processVertex(shape.centroid);
            }
            if (shape.majorAxis) {
              shape.majorAxis = convertObjectToVector3(shape.majorAxis);
            }
            if (shape.minorAxis) {
              shape.minorAxis = convertObjectToVector3(shape.minorAxis);
            }
            if (shape.vertices) {
              shape.vertices = shape.vertices.map(processVertex);
            }
            if (shape.start) {
              shape.start = processVertex(shape.start);
            }
            if (shape.end) {
              shape.end = processVertex(shape.end);
            }
            return shape;
          };
          if (pick.surfaceData.detectedShapes) {
            pick.surfaceData.detectedShapes.forEach(processShape);
          }
          if (pick.surfaceData.vertices) {
            const vertices = pick.surfaceData.vertices;
            if (Array.isArray(vertices) && vertices.length > 0) {
              if (Array.isArray(vertices[0])) {
                // Nested array: polygon[]
                pick.surfaceData.vertices = vertices.map((polygon) => polygon.map(processVertex));
              } else {
                // Flat array, needs to be nested for indicator
                pick.surfaceData.vertices = [vertices.map(processVertex)];
              }
            }
          }
        }
      }

      points[key] = {
        intersection: pickPoint,
        viewportId: pick.viewportIndex2d,
        hasTopology: pick.hasTopology,
        modelId: pick.modelId,
        fragId: pick.fragId,
        fragPos: pick.fragPos,
        snapNode: pick.snapNode,
        circularArcRadius: pick.circularArcRadius,
        circularArcCenter: pick.circularArcCenter,
        faceNormal: pick.faceNormal,
        dimensions: modifiedDimensions,
        laserHitPoint: modifiedLaserDest,
        surfaceData: pick.surfaceData,
        surfaceProperties: pick.surfaceProperties
      };
      measurement.getPick(key);
    }

    this.restoredMeasurementData[measurement.id] = points;
  }

  // Stores information from the restored measurement pick data in the current measurement picks
  activatePicks(measurement) {
    if (!measurement.picks) return;
    const keys = Object.keys(measurement.picks);

    const id = measurement.id;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      const pick = measurement.picks[key];
      const restoredMeasurements = this.getRestoredMeasurementData();
      const pointInfo = restoredMeasurements[id][key];
      let p = pointInfo.intersection.clone();

      if (!pick.getGeometry() && pointInfo.intersection) {
        pick.geomType = MeasureCommon.SnapType.SNAP_VERTEX;
        pick.geomVertex = p;
        pick.intersectPoint = p;
        pick.modelId = pointInfo.modelId;
        pick.fragId = pointInfo.fragId;
        pick.fragPos = pointInfo.fragPos;
        pick.snapNode = pointInfo.snapNode; // the dbid of the pick. This is used for isolation.
        pick.circularArcCenter = pointInfo.circularArcCenter;
        pick.circularArcRadius = pointInfo.circularArcRadius;
        pick.faceNormal = pointInfo.faceNormal;
        pick.dimensions = pointInfo.dimensions;
        pick.laserHitPoint = pointInfo.laserHitPoint;
        pick.surfaceData = pointInfo.surfaceData;
        pick.surfaceProperties = pointInfo.surfaceProperties;

        // Set the isRestored flag if all of the picks are valid.
        pick.viewportIndex2d = pointInfo.viewportId;
      }
    }
  }

  changeCurrentMeasurement(measurement) {
    this.currentMeasurement = measurement;
    this.viewer.dispatchEvent({ type: MeasureCommon.Events.MEASUREMENT_CHANGED_EVENT, data: { type: measurement.measurementType, id: measurement.id } });
  }

  removeCurrentMeasurement() {
    // Remove current measurement from the list
    if (Object.keys(this.measurementsList).length > 0) {
      delete this.measurementsList[this.currentMeasurement.id];
    }
    this.currentMeasurement = null;
  }

  destroy() {
    this.reset();
  }

  reset() {
    this.currentMeasurement = null;
    this.measurementsList = {};
    this.measurementsCounter = 0;
  }
}

/***/ },

/***/ "./extensions/Measure/PolygonCentroid.js"
/*!***********************************************!*\
  !*** ./extensions/Measure/PolygonCentroid.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   getCentroidOfPolygon: () => (/* binding */ getCentroidOfPolygon),
/* harmony export */   getPolygonVisualCenter: () => (/* binding */ getPolygonVisualCenter)
/* harmony export */ });
// Centroid of a polygon is the average of its points.
function getCentroidOfPolygon(points) {
  var centroid = new THREE.Vector3();
  var n = points.length;

  for (var i = 0; i < n; i++) {
    centroid.add(points[i]);
  }

  centroid.multiplyScalar(1 / n);
  return centroid;
}

// Algorithm based on https://github.com/mapbox/polylabel
function getPolygonVisualCenter(polygon) {
  function compareMax(a, b) {
    return b.max - a.max;
  }

  function Cell(x, y, h, polygon) {
    this.x = x; // cell center x
    this.y = y; // cell center y
    this.h = h; // half the cell size
    this.d = pointToPolygonDist(x, y, polygon); // distance from cell center to polygon
    this.max = this.d + this.h * Math.SQRT2; // max distance to polygon within a cell
  }

  // signed distance from point to polygon outline (negative if point is outside)
  function pointToPolygonDist(x, y, polygon) {
    var inside = false;
    var minDistSq = Infinity;

    for (var k = 0; k < polygon.length; k++) {
      var ring = polygon[k];

      for (var i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
        var a = ring[i];
        var b = ring[j];

        if (a.y > y !== b.y > y &&
        x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;

        minDistSq = Math.min(minDistSq, getSegDistSq(x, y, a, b));
      }
    }

    return (inside ? 1 : -1) * Math.sqrt(minDistSq);
  }

  // get polygon centroid
  function getCentroidCell(polygon) {
    var area = 0;
    var x = 0;
    var y = 0;
    var points = polygon[0];

    for (var i = 0, len = points.length, j = len - 1; i < len; j = i++) {
      var a = points[i];
      var b = points[j];
      var f = a.x * b.y - b.x * a.y;
      x += (a.x + b.x) * f;
      y += (a.y + b.y) * f;
      area += f * 3;
    }
    if (area === 0) return new Cell(points[0].x, points[0].y, 0, polygon);
    return new Cell(x / area, y / area, 0, polygon);
  }

  // get squared distance from a point to a segment
  function getSegDistSq(px, py, a, b) {

    var x = a.x;
    var y = a.y;
    var dx = b.x - x;
    var dy = b.y - y;

    if (dx !== 0 || dy !== 0) {

      var t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);

      if (t > 1) {
        x = b.x;
        y = b.y;

      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = px - x;
    dy = py - y;

    return dx * dx + dy * dy;
  }

  function TinyQueue(data, compare) {

    function defaultCompare(a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    }

    if (!(this instanceof TinyQueue)) return new TinyQueue(data, compare);

    this.data = data || [];
    this.length = this.data.length;
    this.compare = compare || defaultCompare;

    if (this.length > 0) {
      for (var i = this.length >> 1; i >= 0; i--) this._down(i);
    }
  }

  TinyQueue.prototype = {

    push: function (item) {
      this.data.push(item);
      this.length++;
      this._up(this.length - 1);
    },

    pop: function () {
      if (this.length === 0) return undefined;

      var top = this.data[0];
      this.length--;

      if (this.length > 0) {
        this.data[0] = this.data[this.length];
        this._down(0);
      }
      this.data.pop();

      return top;
    },

    peek: function () {
      return this.data[0];
    },

    _up: function (pos) {
      var data = this.data;
      var compare = this.compare;
      var item = data[pos];

      while (pos > 0) {
        var parent = pos - 1 >> 1;
        var current = data[parent];
        if (compare(item, current) >= 0) break;
        data[pos] = current;
        pos = parent;
      }

      data[pos] = item;
    },

    _down: function (pos) {
      var data = this.data;
      var compare = this.compare;
      var halfLength = this.length >> 1;
      var item = data[pos];

      while (pos < halfLength) {
        var left = (pos << 1) + 1;
        var right = left + 1;
        var best = data[left];

        if (right < this.length && compare(data[right], best) < 0) {
          left = right;
          best = data[right];
        }
        if (compare(best, item) >= 0) break;

        data[pos] = best;
        pos = left;
      }

      data[pos] = item;
    }
  };

  if (polygon.length === 3) {
    return getCentroidOfPolygon(polygon);
  }

  var precision = 0.01;
  polygon = [polygon];

  // find the bounding box of the outer ring
  var minX, minY, maxX, maxY;
  for (var i = 0; i < polygon[0].length; i++) {
    var p = polygon[0][i];
    if (!i || p.x < minX) minX = p.x;
    if (!i || p.y < minY) minY = p.y;
    if (!i || p.x > maxX) maxX = p.x;
    if (!i || p.y > maxY) maxY = p.y;
  }

  var width = maxX - minX;
  var height = maxY - minY;
  var cellSize = Math.min(width, height);
  var h = cellSize / 2;

  // a priority queue of cells in order of their "potential" (max distance to polygon)
  var cellQueue = new TinyQueue(null, compareMax);

  if (cellSize === 0) return [minX, minY];

  // cover polygon with initial cells
  for (var x = minX; x < maxX; x += cellSize) {
    for (var y = minY; y < maxY; y += cellSize) {
      cellQueue.push(new Cell(x + h, y + h, h, polygon));
    }
  }

  // take centroid as the first best guess
  var bestCell = getCentroidCell(polygon);

  // special case for rectangular polygons
  var bboxCell = new Cell(minX + width / 2, minY + height / 2, 0, polygon);
  if (bboxCell.d > bestCell.d) bestCell = bboxCell;

  while (cellQueue.length) {
    // pick the most promising cell from the queue
    var cell = cellQueue.pop();

    // update the best cell if we found a better one
    if (cell.d > bestCell.d) {
      bestCell = cell;
    }

    // do not drill down further if there's no chance of a better solution
    if (cell.max - bestCell.d <= precision) continue;

    // split the cell into four cells
    h = cell.h / 2;
    cellQueue.push(new Cell(cell.x - h, cell.y - h, h, polygon));
    cellQueue.push(new Cell(cell.x + h, cell.y - h, h, polygon));
    cellQueue.push(new Cell(cell.x - h, cell.y + h, h, polygon));
    cellQueue.push(new Cell(cell.x + h, cell.y + h, h, polygon));
  }

  return { x: bestCell.x, y: bestCell.y };
}

/***/ },

/***/ "./src/application/EventTypes.js"
/*!***************************************!*\
  !*** ./src/application/EventTypes.js ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AGGREGATE_FIT_TO_VIEW_EVENT: () => (/* binding */ AGGREGATE_FIT_TO_VIEW_EVENT),
/* harmony export */   AGGREGATE_HIDDEN_CHANGED_EVENT: () => (/* binding */ AGGREGATE_HIDDEN_CHANGED_EVENT),
/* harmony export */   AGGREGATE_ISOLATION_CHANGED_EVENT: () => (/* binding */ AGGREGATE_ISOLATION_CHANGED_EVENT),
/* harmony export */   AGGREGATE_SELECTION_CHANGED_EVENT: () => (/* binding */ AGGREGATE_SELECTION_CHANGED_EVENT),
/* harmony export */   ANIMATION_READY_EVENT: () => (/* binding */ ANIMATION_READY_EVENT),
/* harmony export */   ANIM_ENDED: () => (/* binding */ ANIM_ENDED),
/* harmony export */   BEFORE_MODEL_UNLOAD_EVENT: () => (/* binding */ BEFORE_MODEL_UNLOAD_EVENT),
/* harmony export */   BUBBLE_NODES_CHANGED_EVENT: () => (/* binding */ BUBBLE_NODES_CHANGED_EVENT),
/* harmony export */   CAMERA_CHANGE_EVENT: () => (/* binding */ CAMERA_CHANGE_EVENT),
/* harmony export */   CAMERA_TRANSITION_COMPLETED: () => (/* binding */ CAMERA_TRANSITION_COMPLETED),
/* harmony export */   CANCEL_LEAFLET_SCREENSHOT: () => (/* binding */ CANCEL_LEAFLET_SCREENSHOT),
/* harmony export */   CUSTOM_PROPERTIES_PROGRESS: () => (/* binding */ CUSTOM_PROPERTIES_PROGRESS),
/* harmony export */   CUTPLANES_CHANGE_EVENT: () => (/* binding */ CUTPLANES_CHANGE_EVENT),
/* harmony export */   ESCAPE_EVENT: () => (/* binding */ ESCAPE_EVENT),
/* harmony export */   EXPLODE_CHANGE_EVENT: () => (/* binding */ EXPLODE_CHANGE_EVENT),
/* harmony export */   EXTENSION_ACTIVATED_EVENT: () => (/* binding */ EXTENSION_ACTIVATED_EVENT),
/* harmony export */   EXTENSION_DEACTIVATED_EVENT: () => (/* binding */ EXTENSION_DEACTIVATED_EVENT),
/* harmony export */   EXTENSION_LOADED_EVENT: () => (/* binding */ EXTENSION_LOADED_EVENT),
/* harmony export */   EXTENSION_PRE_ACTIVATED_EVENT: () => (/* binding */ EXTENSION_PRE_ACTIVATED_EVENT),
/* harmony export */   EXTENSION_PRE_DEACTIVATED_EVENT: () => (/* binding */ EXTENSION_PRE_DEACTIVATED_EVENT),
/* harmony export */   EXTENSION_PRE_LOADED_EVENT: () => (/* binding */ EXTENSION_PRE_LOADED_EVENT),
/* harmony export */   EXTENSION_PRE_UNLOADED_EVENT: () => (/* binding */ EXTENSION_PRE_UNLOADED_EVENT),
/* harmony export */   EXTENSION_UNLOADED_EVENT: () => (/* binding */ EXTENSION_UNLOADED_EVENT),
/* harmony export */   FINAL_FRAME_RENDERED_CHANGED_EVENT: () => (/* binding */ FINAL_FRAME_RENDERED_CHANGED_EVENT),
/* harmony export */   FIT_TO_VIEW_EVENT: () => (/* binding */ FIT_TO_VIEW_EVENT),
/* harmony export */   FRAGMENTS_LOADED_EVENT: () => (/* binding */ FRAGMENTS_LOADED_EVENT),
/* harmony export */   FRAGMENTS_UNLOADED_EVENT: () => (/* binding */ FRAGMENTS_UNLOADED_EVENT),
/* harmony export */   FULLSCREEN_MODE_EVENT: () => (/* binding */ FULLSCREEN_MODE_EVENT),
/* harmony export */   GEOMETRY_LOADED_EVENT: () => (/* binding */ GEOMETRY_LOADED_EVENT),
/* harmony export */   GPU_CONTEXT_LOST_EVENT: () => (/* binding */ GPU_CONTEXT_LOST_EVENT),
/* harmony export */   HIDE_ALL_EVENT: () => (/* binding */ HIDE_ALL_EVENT),
/* harmony export */   HIDE_EVENT: () => (/* binding */ HIDE_EVENT),
/* harmony export */   HYPERLINK_EVENT: () => (/* binding */ HYPERLINK_EVENT),
/* harmony export */   HYPERLINK_NAVIGATE: () => (/* binding */ HYPERLINK_NAVIGATE),
/* harmony export */   ISOLATE_EVENT: () => (/* binding */ ISOLATE_EVENT),
/* harmony export */   LANGUAGE_CHANGED_EVENT: () => (/* binding */ LANGUAGE_CHANGED_EVENT),
/* harmony export */   LAYER_VISIBILITY_CHANGED_EVENT: () => (/* binding */ LAYER_VISIBILITY_CHANGED_EVENT),
/* harmony export */   LOADER_LOAD_ERROR_EVENT: () => (/* binding */ LOADER_LOAD_ERROR_EVENT),
/* harmony export */   LOADER_LOAD_FILE_EVENT: () => (/* binding */ LOADER_LOAD_FILE_EVENT),
/* harmony export */   LOADER_REPAINT_REQUEST_EVENT: () => (/* binding */ LOADER_REPAINT_REQUEST_EVENT),
/* harmony export */   LOAD_GEOMETRY_EVENT: () => (/* binding */ LOAD_GEOMETRY_EVENT),
/* harmony export */   LOAD_MISSING_GEOMETRY: () => (/* binding */ LOAD_MISSING_GEOMETRY),
/* harmony export */   MODEL_ADDED_EVENT: () => (/* binding */ MODEL_ADDED_EVENT),
/* harmony export */   MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT: () => (/* binding */ MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT),
/* harmony export */   MODEL_LAYERS_LOADED_EVENT: () => (/* binding */ MODEL_LAYERS_LOADED_EVENT),
/* harmony export */   MODEL_PLACEMENT_CHANGED_EVENT: () => (/* binding */ MODEL_PLACEMENT_CHANGED_EVENT),
/* harmony export */   MODEL_REMOVED_EVENT: () => (/* binding */ MODEL_REMOVED_EVENT),
/* harmony export */   MODEL_ROOT_LOADED_EVENT: () => (/* binding */ MODEL_ROOT_LOADED_EVENT),
/* harmony export */   MODEL_TRANSFORM_CHANGED_EVENT: () => (/* binding */ MODEL_TRANSFORM_CHANGED_EVENT),
/* harmony export */   MODEL_TRAVERSAL_CONTROLLER_ADDED: () => (/* binding */ MODEL_TRAVERSAL_CONTROLLER_ADDED),
/* harmony export */   MODEL_UNLOADED_EVENT: () => (/* binding */ MODEL_UNLOADED_EVENT),
/* harmony export */   MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT: () => (/* binding */ MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT),
/* harmony export */   NAVIGATION_MODE_CHANGED_EVENT: () => (/* binding */ NAVIGATION_MODE_CHANGED_EVENT),
/* harmony export */   NEW_GEOMETRY_ADDED: () => (/* binding */ NEW_GEOMETRY_ADDED),
/* harmony export */   NEW_MATERIAL_ADDED: () => (/* binding */ NEW_MATERIAL_ADDED),
/* harmony export */   OBJECT_TREE_CREATED_EVENT: () => (/* binding */ OBJECT_TREE_CREATED_EVENT),
/* harmony export */   OBJECT_TREE_LOAD_PROGRESS_EVENT: () => (/* binding */ OBJECT_TREE_LOAD_PROGRESS_EVENT),
/* harmony export */   OBJECT_TREE_UNAVAILABLE_EVENT: () => (/* binding */ OBJECT_TREE_UNAVAILABLE_EVENT),
/* harmony export */   OBJECT_UNDER_MOUSE_CHANGED: () => (/* binding */ OBJECT_UNDER_MOUSE_CHANGED),
/* harmony export */   PDF_STRINGS_EXTRACTED: () => (/* binding */ PDF_STRINGS_EXTRACTED),
/* harmony export */   PREF_CHANGED_EVENT: () => (/* binding */ PREF_CHANGED_EVENT),
/* harmony export */   PREF_RESET_EVENT: () => (/* binding */ PREF_RESET_EVENT),
/* harmony export */   PROFILE_CHANGE_EVENT: () => (/* binding */ PROFILE_CHANGE_EVENT),
/* harmony export */   PROGRESS_UPDATE_EVENT: () => (/* binding */ PROGRESS_UPDATE_EVENT),
/* harmony export */   REFRESH_CUSTOM_PROPERTIES: () => (/* binding */ REFRESH_CUSTOM_PROPERTIES),
/* harmony export */   REFRESH_CUSTOM_PROPERTIES_VALUES: () => (/* binding */ REFRESH_CUSTOM_PROPERTIES_VALUES),
/* harmony export */   RENDERING_TICKED_EVENT: () => (/* binding */ RENDERING_TICKED_EVENT),
/* harmony export */   RENDER_FIRST_PIXEL: () => (/* binding */ RENDER_FIRST_PIXEL),
/* harmony export */   RENDER_OPTION_CHANGED_EVENT: () => (/* binding */ RENDER_OPTION_CHANGED_EVENT),
/* harmony export */   RENDER_PRESENTED_EVENT: () => (/* binding */ RENDER_PRESENTED_EVENT),
/* harmony export */   RENDER_SCENE_PART: () => (/* binding */ RENDER_SCENE_PART),
/* harmony export */   RESTORE_DEFAULT_SETTINGS_EVENT: () => (/* binding */ RESTORE_DEFAULT_SETTINGS_EVENT),
/* harmony export */   SCENE_UPDATED_EVENT: () => (/* binding */ SCENE_UPDATED_EVENT),
/* harmony export */   SELECTION_CHANGED_EVENT: () => (/* binding */ SELECTION_CHANGED_EVENT),
/* harmony export */   SET_VIEW_EVENT: () => (/* binding */ SET_VIEW_EVENT),
/* harmony export */   SHOW_ALL_EVENT: () => (/* binding */ SHOW_ALL_EVENT),
/* harmony export */   SHOW_EVENT: () => (/* binding */ SHOW_EVENT),
/* harmony export */   SHOW_PROPERTIES_EVENT: () => (/* binding */ SHOW_PROPERTIES_EVENT),
/* harmony export */   SLOW_GPU_WARNING_EVENT: () => (/* binding */ SLOW_GPU_WARNING_EVENT),
/* harmony export */   TEXTURES_LOADED_EVENT: () => (/* binding */ TEXTURES_LOADED_EVENT),
/* harmony export */   TOOL_CHANGE_EVENT: () => (/* binding */ TOOL_CHANGE_EVENT),
/* harmony export */   TRANSITION_ENDED: () => (/* binding */ TRANSITION_ENDED),
/* harmony export */   TRANSITION_STARTED: () => (/* binding */ TRANSITION_STARTED),
/* harmony export */   VIEWER_INITIALIZED: () => (/* binding */ VIEWER_INITIALIZED),
/* harmony export */   VIEWER_RENDER_TICK: () => (/* binding */ VIEWER_RENDER_TICK),
/* harmony export */   VIEWER_RESIZE_EVENT: () => (/* binding */ VIEWER_RESIZE_EVENT),
/* harmony export */   VIEWER_STATE_RESTORED_EVENT: () => (/* binding */ VIEWER_STATE_RESTORED_EVENT),
/* harmony export */   VIEWER_UNINITIALIZED: () => (/* binding */ VIEWER_UNINITIALIZED),
/* harmony export */   VIEWER_VISIBILITY_CHANGED: () => (/* binding */ VIEWER_VISIBILITY_CHANGED),
/* harmony export */   VIEWPOINT_TREE_UPDATED_EVENT: () => (/* binding */ VIEWPOINT_TREE_UPDATED_EVENT),
/* harmony export */   WEBGL_CONTEXT_LOST_EVENT: () => (/* binding */ WEBGL_CONTEXT_LOST_EVENT),
/* harmony export */   WEBGL_CONTEXT_RESTORED_EVENT: () => (/* binding */ WEBGL_CONTEXT_RESTORED_EVENT)
/* harmony export */ });

/** @import { ScreenMode } from "./ScreenModeDelegate" */
/** @import { Viewer3D } from "./Viewer3D" */
/** @import { BubbleNode } from "./bubble" */
/** @import { Model } from './Model.js' */

/**
 * Fired when the ESC key is pressed.
 * @event Autodesk.Viewing#ESCAPE_EVENT
 * @public
 */
const ESCAPE_EVENT = 'escape';
/**
 * Fired repeatedly throughout the process of opening a model/drawing.
 * @event Autodesk.Viewing#PROGRESS_UPDATE_EVENT
 * @property {number} percent - Estimated progress.
 * @property {number} state - Value from Autodesk.Viewing.ProgressState, providing details on the progress state.
 * @property {object} model - Model being loaded.
 * @property {number} [loaded] - Bytes downloaded so far (only set during ProgressState.DOWNLOADING).
 * @property {number} [total] - Total bytes to download, when known (only set during ProgressState.DOWNLOADING).
 * @public
 */
const PROGRESS_UPDATE_EVENT = 'progress';
/**
 * Fired when the screen mode changes.
 * @event Autodesk.Viewing#FULLSCREEN_MODE_EVENT
 * @property {ScreenMode} mode - New screen mode.
 * @public
 */
const FULLSCREEN_MODE_EVENT = 'fullScreenMode';
/**
 * Fired then the navigation tool changes.
 * @event Autodesk.Viewing#NAVIGATION_MODE_CHANGED_EVENT
 * @property {string} id - Tool identifier.
 * @public
 */
const NAVIGATION_MODE_CHANGED_EVENT = 'navmode';
/**
 * Fired when the viewer state is restored.
 * @event Autodesk.Viewing#VIEWER_STATE_RESTORED_EVENT
 * @property {boolean} value - Success of the state restoration.
 * @public
 */
const VIEWER_STATE_RESTORED_EVENT = 'viewerStateRestored';
/**
 * Fired when the viewer size changes.
 * @event Autodesk.Viewing#VIEWER_RESIZE_EVENT
 * @property {number} width - New width of the viewer.
 * @property {number} height - New height of the viewer.
 * @public
 */
const VIEWER_RESIZE_EVENT = 'viewerResize';
/**
 * Fired when the viewer is fully initialized.
 * @event Autodesk.Viewing#VIEWER_INITIALIZED
 * @public
 */
const VIEWER_INITIALIZED = 'viewerInitialized';
/**
 * Fired when the viewer is fully uninitialized.
 * @event Autodesk.Viewing#VIEWER_UNINITIALIZED
 * @public
 */
const VIEWER_UNINITIALIZED = 'viewerUninitialized';

/**
 * Fired when the viewer's language/locale is changed.
 * @event Autodesk.Viewing#LANGUAGE_CHANGED_EVENT
 * @property {string} language - The new language code (e.g., 'en', 'de', 'ja').
 * @public
 */
const LANGUAGE_CHANGED_EVENT = 'languageChanged';

/**
 * Fired when the viewer begins loading a model, before the
 * Model instance gets created.
 *
 * @event Autodesk.Viewing#LOADER_LOAD_FILE_EVENT
 * @property {object} loader - Instance of the Loader class
 * @public
 */
const LOADER_LOAD_FILE_EVENT = 'loaderLoadFile';

/**
 * Fired when an error is detected during a load.
 *
 * @event Autodesk.Viewing#LOADER_LOAD_ERROR_EVENT
 * @property {object} loader - Instance of the Loader class
 * @property {object} error - The error reported by the loader.
 * @public
 */
const LOADER_LOAD_ERROR_EVENT = 'loaderLoadError';

/**
 * Fired when a loader thinks its time to repaint the model while loading
 *
 * @event Autodesk.Viewing#LOADER_REPAINT_REQUEST_EVENT
 * @property {Object} loader - Instance of the Loader class
 * @property {Model} model - Loaded model
 * @public
 */
const LOADER_REPAINT_REQUEST_EVENT = 'loaderRepaint';

/**
 * Fired when PDF text strings have been extracted and stored on the model data.
 * @event Autodesk.Viewing#PDF_STRINGS_EXTRACTED
 * @property {object} model - Model data.
 * @private
 * @internal
 */
const PDF_STRINGS_EXTRACTED = 'pdfStringsExtracted';

/**
 * Fired when the viewer receives and parses the initial model manifest.
 * @event Autodesk.Viewing#MODEL_ROOT_LOADED_EVENT
 * @property {object} svf - Parsed SVF/F2D JSON.
 * @property {object} model - Model data.
 * @public
 */
const MODEL_ROOT_LOADED_EVENT = 'svfLoaded';

/**
 * Fired when the model/drawing finishes loading.
 * @event Autodesk.Viewing#GEOMETRY_LOADED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const GEOMETRY_LOADED_EVENT = 'geometryLoaded';

/**
* Fired when the model/drawing textures finish loading.
* @event Autodesk.Viewing#TEXTURES_LOADED_EVENT
* @property {object} model - Model data.
* @public
*/
const TEXTURES_LOADED_EVENT = 'texturesLoaded';
/**
 * Fired when the object tree is successfully created.
 * @event Autodesk.Viewing#OBJECT_TREE_CREATED_EVENT
 * @property {object} svf - Parsed SVF/F2D JSON.
 * @property {object} model - Model data.
 * @public
 */
const OBJECT_TREE_CREATED_EVENT = 'propertyDbLoaded';
/**
 * Fired when the viewpoint tree is updated. Mainly used for loading a ViewpointTreeRoot from a Packfile (Navisworks).
 * @event Autodesk.Viewing#VIEWPOINT_TREE_UPDATED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const VIEWPOINT_TREE_UPDATED_EVENT = 'viewpointTreeUpdated';
/**
 * Fired when there's an error while parsing the object tree.
 * @event Autodesk.Viewing#OBJECT_TREE_UNAVAILABLE_EVENT
 * @property {object} svf - Parsed SVF/F2D JSON.
 * @property {object} model - Model data.
 * @public
 */
const OBJECT_TREE_UNAVAILABLE_EVENT = 'propertyDbUnavailable';
/**
 * Fired when there's a progress event during propertyDB loading.
 * @event Autodesk.Viewing#OBJECT_TREE_LOAD_PROGRESS_EVENT
 * @property {object} svf - Parsed SVF/F2D JSON.
 * @property {object} model - Model data.
 * @public
 */
const OBJECT_TREE_LOAD_PROGRESS_EVENT = 'propertyDbLoadProgress';

/**
 * Fired when a model is removed from the viewer.
 * Note that this event fires _after_ destructor. If
 * you need to access the model, e.g. via model.getData(), use
 * BEFORE_MODEL_UNLOADED instead.
 * @event Autodesk.Viewing#MODEL_UNLOADED_EVENT
 * @property {object} model - Model data (after disposing data)
 * @public
 */
const MODEL_UNLOADED_EVENT = 'modelUnloaded';

/**
 * Fired if a model unload is about to happen, but the model is still fully available.
 * @event Autodesk.Viewing#BEFORE_MODEL_UNLOAD_EVENT
 * @property {object} model - Model data.
 * @public
 */
const BEFORE_MODEL_UNLOAD_EVENT = 'beforeModelUnload';

/**
 * Fired when a model is added to model queue so as to be visible.
 * @event Autodesk.Viewing#MODEL_ADDED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const MODEL_ADDED_EVENT = 'modelAdded';

/**
 * Fired when a model is removed from model queue, i.e. changed to invisible.
 * @event Autodesk.Viewing#MODEL_REMOVED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const MODEL_REMOVED_EVENT = 'modelRemoved';

/**
 * Fired on the viewer when {@link Autodesk.Viewing.AggregatedView#setNodes|AggregatedView#setNodes()}
 * changes the set of visible bubble nodes (models added or removed from the aggregated view).
 * Also fired by {@link Autodesk.Viewing.AggregatedView#hideAll|AggregatedView#hideAll()} with the hidden nodes as ``removed``;
 * a {@link Autodesk.Viewing.AggregatedView#switchView|switchView()} therefore emits two events (removals first, then additions).
 * Only emitted by Aggregated View, not by {@link Autodesk.Viewing.Viewer3D#loadDocumentNode|loadDocumentNode} alone.
 *
 * For newly added nodes, this may fire before a {@link Autodesk.Viewing.Model} instance exists.
 *
 * @event Autodesk.Viewing#BUBBLE_NODES_CHANGED_EVENT
 * @property {Autodesk.Viewing.BubbleNode[]} added - Bubble nodes newly shown.
 * @property {Autodesk.Viewing.BubbleNode[]} removed - Bubble nodes newly hidden.
 */
const BUBBLE_NODES_CHANGED_EVENT = 'bubbleNodesChanged';

/**
 * Fired when the layers of the model are successfully loaded.
 * @event Autodesk.Viewing#MODEL_LAYERS_LOADED_EVENT
 * @property {object} root - Model layers root.
 * @property {object} model - Model data.
 * @public
 */
const MODEL_LAYERS_LOADED_EVENT = 'modelLayersLoaded';

/**
 * Fired a when model transform matrix has been changed. This usually happens if either placement or globalOffset
 * has changed for a model.
 * @event Autodesk.Viewing#MODEL_TRANSFORM_CHANGED_EVENT
 * @property {object} model - Model data.
 * @property {object} matrix - Transform matrix.
 * @public
 */
const MODEL_TRANSFORM_CHANGED_EVENT = 'modelTransformChanged';

/**
 * Fired if placementTransform was changed.
 * @internal
 */
const MODEL_PLACEMENT_CHANGED_EVENT = 'placementTransformChanged';

/**
 * Fired if viewportBounds was changed.
 * @internal
 */
const MODEL_VIEWPORT_BOUNDS_CHANGED_EVENT = 'viewportBoundsChanged';

/**
 * Fired if fragment bounding boxes are explicitly set on the model.
 * @internal
 */
const MODEL_FRAGMENT_BOUNDING_BOXES_SET_EVENT = 'fragmentBoundingBoxesSet';

/**
 * Fired if a new traversal controller is added to the model.
 * @internal
 */
const MODEL_TRAVERSAL_CONTROLLER_ADDED = 'traversalControllerAdded';

/**
 * Fired before a viewer extension is loaded.
 * @event Autodesk.Viewing#EXTENSION_PRE_LOADED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @public
 */
const EXTENSION_PRE_LOADED_EVENT = 'extensionPreLoaded';
/**
 * Fired when a viewer extension is successfully loaded.
 * @event Autodesk.Viewing#EXTENSION_LOADED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @public
 */
const EXTENSION_LOADED_EVENT = 'extensionLoaded';
/**
 * Fired before a viewer extension is unloaded.
 * @event Autodesk.Viewing#EXTENSION_PRE_UNLOADED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @public
 */
const EXTENSION_PRE_UNLOADED_EVENT = 'extensionPreUnloaded';
/**
 * Fired when a viewer extension is successfully unloaded.
 * @event Autodesk.Viewing#EXTENSION_UNLOADED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @public
 */
const EXTENSION_UNLOADED_EVENT = 'extensionUnloaded';
/**
 * Fired before a viewer extension is activated.
 * @event Autodesk.Viewing#EXTENSION_PRE_ACTIVATED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @property {string} mode - Activated mode.
 * @public
 */
const EXTENSION_PRE_ACTIVATED_EVENT = 'extensionPreActivated';
/**
 * Fired after a viewer extension is activated.
 * @event Autodesk.Viewing#EXTENSION_ACTIVATED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @property {string} mode - Activated mode.
 * @public
 */
const EXTENSION_ACTIVATED_EVENT = 'extensionActivated';
/**
 * Fired before a viewer extension is deactivated.
 * @event Autodesk.Viewing#EXTENSION_PRE_DEACTIVATED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @public
 */
const EXTENSION_PRE_DEACTIVATED_EVENT = 'extensionPreDeactivated';
/**
 * Fired after a viewer extension is deactivated.
 * @event Autodesk.Viewing#EXTENSION_DEACTIVATED_EVENT
 * @property {string} extensionId - Extension identifier.
 * @public
 */
const EXTENSION_DEACTIVATED_EVENT = 'extensionDeactivated';
/**
 * Fired when the list of selected objects changes.
 * @event Autodesk.Viewing#SELECTION_CHANGED_EVENT
 * @property {number[]} fragIdsArray - Fragment IDs of selected objects.
 * @property {number[]} dbIdArray - dbIDs of selected objects.
 * @property {number[]} nodeArray - Same as dbIdArray.
 * @property {object} model - Model data.
 * @public
 */
const SELECTION_CHANGED_EVENT = 'selection';
/**
 * Fired when the list of selected objects changes in a multi-model context.
 * @event Autodesk.Viewing#AGGREGATE_SELECTION_CHANGED_EVENT
 * @property {object[]} selections - List of objects containing the typical selection properties
 *   of {@link Autodesk.Viewing#SELECTION_CHANGED_EVENT} for each model.
 * @public
 */
const AGGREGATE_SELECTION_CHANGED_EVENT = 'aggregateSelection';
/**
 * Fired when the viewer isolates a set of objects (i.e., makes everything else invisible or ghosted).
 * @event Autodesk.Viewing#ISOLATE_EVENT
 * @property {number[]} nodeIdArray - List of isolated node IDs.
 * @property {object} model - Model data.
 * @public
 */
const ISOLATE_EVENT = 'isolate';
/**
 * Fired when the list of isolated objects changes in a multi-model context.
 * @event Autodesk.Viewing#AGGREGATE_ISOLATION_CHANGED_EVENT
 * @property {object[]} isolation - List of objects containing the typical selection properties
 *   of {@link Autodesk.Viewing#ISOLATE_EVENT} for each model.
 * @public
 */
const AGGREGATE_ISOLATION_CHANGED_EVENT = 'aggregateIsolation';
/**
 * Fired when the viewer hides a set of objects.
 * @event Autodesk.Viewing#HIDE_EVENT
 * @property {number[]} nodeIdArray - List of hidden node IDs.
 * @property {object} model - Model data.
 * @public
 */
const HIDE_EVENT = 'hide';
/**
 * Fired when the list of hidden objects changes in a multi-model context.
 * @event Autodesk.Viewing#AGGREGATE_HIDDEN_CHANGED_EVENT
 * @property {object[]} hidden - List of objects containing the typical selection properties
 *   of {@link Autodesk.Viewing#HIDE_EVENT} for each model.
 * @public
 */
const AGGREGATE_HIDDEN_CHANGED_EVENT = 'aggregateHidden';

/**
 * Fired when the viewer shows a set of objects.
 * @event Autodesk.Viewing#SHOW_EVENT
 * @property {number[]} nodeIdArray - List of shown node IDs.
 * @property {object} model - Model data.
 * @public
 */
const SHOW_EVENT = 'show';

/**
 * Fired to show the properties of the object.
 * @event Autodesk.Viewing#SHOW_PROPERTIES_EVENT
 * @property {number} dbId - dbId of the object.
 * @property {object} model - Model data.
 * @public
 */
const SHOW_PROPERTIES_EVENT = 'showProperties';

/**
 * Fired whenever `viewer.showAll()` is used.
 *
 * @event Autodesk.Viewing#SHOW_ALL_EVENT
 * @public
 */
const SHOW_ALL_EVENT = 'showAll';

/**
* Fired whenever `viewer.hideAll()` is used.
*
* @event Autodesk.Viewing#HIDE_ALL_EVENT
* @public
*/
const HIDE_ALL_EVENT = 'hideAll';

/**
 * Fired when a camera changes.
 * @event Autodesk.Viewing#CAMERA_CHANGE_EVENT
 * @property {object} camera - Affected camera.
 * @public
 */
const CAMERA_CHANGE_EVENT = 'cameraChanged';
/**
 * Fired whenever the Explode tool is used.
 * @event Autodesk.Viewing#EXPLODE_CHANGE_EVENT
 * @property {number} scale - Scale of the current exploded state.
 * @property {object} options - Optional values of the current exploded state.
 * @public
 */
const EXPLODE_CHANGE_EVENT = 'explodeChanged';
/**
 * Fired when a ``fitToView`` operation is applied.
 * @event Autodesk.Viewing#FIT_TO_VIEW_EVENT
 * @property {boolean} immediate - True if the change was immediate.
 * @property {number[]} nodeIdArray - List of node IDs fitted. Array is empty when fitting to the whole model.
 * @property {object} model - Model data.
 * @public
 */
const FIT_TO_VIEW_EVENT = 'fitToView';
/**
 * Fired when ``fitToView`` operation is applied, supports multi-model contexts.
 * @event Autodesk.Viewing#AGGREGATE_FIT_TO_VIEW_EVENT
 * @property {object[]} selection - List of objects each containing a ``model`` instance and a ``selection`` array of ids.
 * @public
 */
const AGGREGATE_FIT_TO_VIEW_EVENT = 'aggregateFitToView';
/**
 * Fired when the cutting planes change.
 * @event Autodesk.Viewing#CUTPLANES_CHANGE_EVENT
 * @property {object[]} planes - List of cutplanes.
 * @public
 */
const CUTPLANES_CHANGE_EVENT = 'cutplanesChanged';
/**
 * Fired when a tool is activated or deactivated.
 * @event Autodesk.Viewing#TOOL_CHANGE_EVENT
 * @property {string} toolName - Name of a specific mode of a tool.
 * @property {object} tool - Tool object.
 * @property {boolean} active - Current status of the tool.
 * @public
 */
const TOOL_CHANGE_EVENT = 'toolChanged';
/**
 * Fired when rendering options change.
 * @event Autodesk.Viewing#RENDER_OPTION_CHANGED_EVENT
 * @public
 */
const RENDER_OPTION_CHANGED_EVENT = 'renderOptionChanged';
/**
 * Fired when the render frame shown by the Viewer is final or complete (it has
 * no more pending geometry or post processing effects which delay incoming frames),
 * or when the Viewer stops showing final frames. The name refers to when the
 * state changes from busy to idle for the renderer, or vice versa. To know
 * when all geometry is fully displayed, also check for GEOMETRY_LOADED_EVENT.
 *
 * @event Autodesk.Viewing#FINAL_FRAME_RENDERED_CHANGED_EVENT
 * @property {boolean} finalFrame - final frame is displayed this tick.
 * @public
 */
const FINAL_FRAME_RENDERED_CHANGED_EVENT = 'finalFrameRenderedChanged';

/**
 * This event is triggered for each tick that performs some form of rendering work, providing information about the
 * frame sequence and rendering completion status.
 *
 * Note: A series of intermediate frames is not guaranteed to end with isMainSceneDone = true
 *
 * @event Autodesk.Viewing#RENDERING_TICKED_EVENT
 * @property {object} value - Event data object containing frame rendering information.
 * @property {number} value.renderTicksSinceClear - Number of ticks that render something since the last clear.
 * @property {boolean} value.isMainSceneDone - True when rendering of the main scene is done. Note that updating
 *     overlays emit events without clearing the main scene, increasing the tick counter.
 *
 * @example
 * // Progressive rendering sequence (3 intermediate frames + 1 additional overlay composite):
 * // { renderTicksSinceClear: 0, isMainSceneDone: false } // tick where the main scene was cleared
 * // { renderTicksSinceClear: 1, isMainSceneDone: false } // tick rendering an intermediate frame, still converging
 * // { renderTicksSinceClear: 2, isMainSceneDone: true  } // tick wrapping up the main scene rendering
 * // { renderTicksSinceClear: 3, isMainSceneDone: true  } // tick updating just the overlays
 * @public
 */
const RENDERING_TICKED_EVENT = 'renderingTicked';

/**
 * Fired when the render has presented to the screen.
 * @event Autodesk.Viewing#RENDER_PRESENTED_EVENT
 * @public
 */
const RENDER_PRESENTED_EVENT = 'renderPresented';
/**
 * Fired when visibility of a 2D layer changes.
 * @event Autodesk.Viewing#LAYER_VISIBILITY_CHANGED_EVENT
 * @public
 */
const LAYER_VISIBILITY_CHANGED_EVENT = 'layerVisibility';

/**
 * Fired when a user preference property changes.
 * @event Autodesk.Viewing#PREF_CHANGED_EVENT
 * @property {string} name - Property name.
 * @property {object} value - New property value.
 * @public
 */
const PREF_CHANGED_EVENT = 'PrefChanged';
/**
 * Fired when a user preference property is reset.
 * @event Autodesk.Viewing#PREF_RESET_EVENT
 * @property {string} name - Property name.
 * @property {object} value - New property value.
 * @public
 */
const PREF_RESET_EVENT = 'PrefReset';

/**
 * Fired as a result of invoking `viewer.restoreDefaultSettings()` to restore default settings.
 * Will get fired after all other Autodesk.Viewing.PREF_CHANGED_EVENT get fired.
 * @event Autodesk.Viewing#RESTORE_DEFAULT_SETTINGS_EVENT
 * @public
 */
const RESTORE_DEFAULT_SETTINGS_EVENT = 'restoreDefaultSettings';

/**
 * Fired when animations are successfully initialized.
 * @event Autodesk.Viewing#ANIMATION_READY_EVENT
 * @public
 */
const ANIMATION_READY_EVENT = 'animationReady';

/**
 * Fired whenever a camera transition is finished, such as Focus, Go to Home View,
 * Restore State, restore Named Views, and others.
 * @event Autodesk.Viewing#CAMERA_TRANSITION_COMPLETED
 * @public
 */
const CAMERA_TRANSITION_COMPLETED = 'cameraTransitionCompleted';

/**
 * Fired when user clicks on a hyperlink embedded in the model.
 * @event Autodesk.Viewing#HYPERLINK_EVENT
 * @property {object} data - Hyperlink data.
 * @public
 */
const HYPERLINK_EVENT = 'hyperlink';

/**
 * @internal
 */
const HYPERLINK_NAVIGATE = 'hyperlink_navigate';

/**
 * @internal
 */
const LOAD_GEOMETRY_EVENT = 'load_geometry';

/**
* Fired when something in the view changes that may expose missing geometry.
* @event Autodesk.Viewing#LOAD_MISSING_GEOMETRY
* @property {boolean} [delay] - A flag used to aggregate multiple events during user interactions.
*                               Defaults to true.
* @public
*/
const LOAD_MISSING_GEOMETRY = 'loadMissingGeometry';

/**
 * Fired when the WebGL context or WebGPU device is lost.
 * @event Autodesk.Viewing#GPU_CONTEXT_LOST_EVENT
 * @public
 */
const GPU_CONTEXT_LOST_EVENT = 'gpuContextLost';

/**
 * Deprecated. Use GPU_CONTEXT_LOST_EVENT instead.
 * @event Autodesk.Viewing#WEBGL_CONTEXT_LOST_EVENT
 * @public
 */
const WEBGL_CONTEXT_LOST_EVENT = 'gpuContextLost';

/**
 * Fired when the WebGLRenderingContext was restored
 *
 * @event Autodesk.Viewing#WEBGL_CONTEXT_RESTORED_EVENT
 * @public
 */
const WEBGL_CONTEXT_RESTORED_EVENT = 'webglcontextrestored';

/**
 * Fired when a leaflet screenshot needs to be canceled before downloading all required / pending tiles.
 *
 * @event Autodesk.Viewing#CANCEL_LEAFLET_SCREENSHOT
 * @public
 */
const CANCEL_LEAFLET_SCREENSHOT = 'cancelLeafletScreenshot';


/**
 * Fired after a successful call into {Viewer3D#setView}.
 *
 * @event Autodesk.Viewing#SET_VIEW_EVENT
 * @property {BubbleNode} view - The view object that was applied.
 * @public
 */
const SET_VIEW_EVENT = 'setView';


/**
 * Fired when the first pixel of the model is ready to be rendered.
 *
 * @event Autodesk.Viewing#RENDER_FIRST_PIXEL
 * @public
 */
const RENDER_FIRST_PIXEL = 'renderFirstPixel';

/**
 * Fired when new geometry has been added to the scene
 *
 * @event Autodesk.Viewing#NEW_GEOMETRY_ADDED
 * @public
 */
const NEW_GEOMETRY_ADDED = 'newGeometryAdded';

/**
 * Fired when a new material has been added to the scene
 *
 * @event Autodesk.Viewing#NEW_MATERIAL_ADDED
 * @public
 */
const NEW_MATERIAL_ADDED = 'newMaterialAdded';
/**
 * Fired when a profile is added to the viewer.profileManager
 * @event Autodesk.Viewing#PROFILE_CHANGE_EVENT
 * @public
 */
const PROFILE_CHANGE_EVENT = 'profileChanged';

/**
 * Fired when a scene part is about to be rendered
 * @event Autodesk.Viewing#PROFILE_CHANGE_EVENT
 * @public
 */
const RENDER_SCENE_PART = 'renderScenePart';

/**
 * Fired when object under mouse changed.
 * @event Autodesk.Viewing#OBJECT_UNDER_MOUSE_CHANGED
 * @public
 */
const OBJECT_UNDER_MOUSE_CHANGED = 'hoverObjectChanged';

/**
 * Fired when AnimController calls Autodesk.Viewing.Private.fadeValue
 * @event Autodesk.Viewing#ANIM_ENDED
 * @public
 */
const ANIM_ENDED = 'animEnded';

/** Fired when transition started
 * @event Autodesk.Viewing#TRANSITION_STARTED
 * @property {object} sceneAnimState // scene state of transition
 * @public
 */
const TRANSITION_STARTED = 'transitionStarted';

/** Fired when transition ended
 * @event Autodesk.Viewing#TRANSITION_ENDED
 * @property {object} sceneAnimState // scene state of transition, this will be null for models that do not have any clusters or animations
 * @public
 */
const TRANSITION_ENDED = 'transitionEnded';

/**
 * Fired when fragments are loaded after the initial model load.
 * @event Autodesk.Viewing#FRAGMENTS_LOADED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const FRAGMENTS_LOADED_EVENT = 'fragmentsLoaded';

/**
 * Fired when fragments are unloaded.
 * @event Autodesk.Viewing#FRAGMENTS_UNLOADED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const FRAGMENTS_UNLOADED_EVENT = 'fragmentsUnloaded';

/**
 * Fired when scene is updated
 * @event Autodesk.Viewing#SCENE_UPDATED_EVENT
 * @property {object} model - Model data.
 * @public
 */
const SCENE_UPDATED_EVENT = 'sceneUpdated';

/**
 * Fired when the viewer triggers a refresh of the custom properties/attributes from PropertyDb.
 * @event Autodesk.Viewing#REFRESH_CUSTOM_PROPERTIES
 * @property {object} model - Model data.
 * @property {boolean} [defsChanged] - True when attribute definitions changed compared to the previous refresh.
 * @property {string[]} [changedKeys] - Property-hash keys of added, modified, or removed definitions.
 *   Only present on subsequent refreshes (not on the initial load).
 * @private
 * @internal
 */
const REFRESH_CUSTOM_PROPERTIES = 'refreshCustomProperties';


/**
 * Event for new custom properties/attributes value from PropertyDb.
 * @event Autodesk.Viewing#REFRESH_CUSTOM_PROPERTIES_VALUES
 * @property {object} model - Model data.
 * @property {boolean} [defsChanged] - True when attribute definitions were re-fetched and changed.
 * @property {string[]} [changedKeys] - Property-hash keys of added, modified, or removed definitions.
 *   Only present when definitions were re-fetched on a subsequent refresh.
 * @property {boolean} [valsChanged] - True when any attribute values changed compared to the previous refresh.
 * @property {string[]} [changedValKeys] - Property-hash keys of attributes whose values changed.
 *   Only present on subsequent refreshes (not on the initial load). Change detection uses an
 *   additive commutative hash; false-negative probability is ~1/2^32 per attribute per refresh.
 * @private
 * @internal
 */
const REFRESH_CUSTOM_PROPERTIES_VALUES = 'refreshCustomPropertiesValues';

/**
 * Fired during custom properties workflows to report loading progress.
 * Emitted at the start, on intermediate steps, and at the end of each workflow. When the workflow
 * function rejects, `'error'` is emitted first, then `'end'` with `workflowFailed: true`.
 *
 * @event Autodesk.Viewing#CUSTOM_PROPERTIES_PROGRESS
 * @property {string} name - Workflow name. E.g. `'loadModels'`, `'applyBindings'`, ...
 * @property {string} workflowId - Unique identifier for this workflow run (e.g. `'loadModels:1'`).
 * @property {string} phase - Lifecycle phase of the workflow. Automatically emitted phases are
 *   `'start'`, `'end'`, and `'error'`. On rejection, both `'error'` and `'end'` fire (the latter
 *   includes `workflowFailed: true`). Intermediate phases reported during execution include
 *   `'progress'` (per-model step completed), `'bindings'` (all definition fetches done during
 *   initial load), and `'values'`. `'values'` is reported once per model when a model's values were fetched
 *   (refresh and apply workflows). The initial `loadModels` workflow reports it once, after the values of all its
 *   models were fetched, and not at all when no model has bindings.
 * @property {string} [requestId] - Caller-supplied request ID, present when the originating call
 *   provided one.
 * @property {number} eligibleModels - Total number of eligible (OTG/SVF2) models in the workflow.
 * @property {string[]} uniqueModelUrns - Deduplicated seed file URNs being tracked.
 * @property {number} bindingsCompleted - Number of unique URNs whose bindings have finished loading.
 * @property {number} valuesCompleted - Number of unique URNs whose values have finished loading.
 * @property {number} bindingsErrors - Number of unique URNs whose bindings loading ended in error.
 * @property {number} valuesErrors - Number of unique URNs whose values loading ended in error.
 * @property {object} [error] - The error object, present only when `phase` is `'error'`.
 * @property {boolean} [workflowFailed] - True when `phase` is `'end'` after a rejected workflow.
 * @private
 * @internal
 */
const CUSTOM_PROPERTIES_PROGRESS = 'customPropertiesProgress';


/**
 * Fired when the viewers visibility has changed (i.e. a viewer window
 * got shown or hidden).
 *
 * NOTE: This event relies on the checkVisibility method being available on DOM elements in the browser.
 *       If this feature is missing, the event will not be fired.
 *       This should be the case in all up-to-date browsers. Most browsers have added it in 2022,
 *       but Safari only at the beginning of 2024.
 *
 * @event Autodesk.Viewing#VIEWER_VISIBILITY_CHANGED
 * @property {boolean} visible - True if the viewer is visible, false otherwise.
 * @public
 */
const VIEWER_VISIBILITY_CHANGED = 'viewerVisibilityChanged';

/**
 * Fired each rendering tick regardless of whether the viewer actually needs to render.
 * This event is intended for updates that need to be in sync with the render loop.
 *
 * Example usage:
 * ```javascript
 * this.viewer.addEventListener(VIEWER_RENDER_TICK, event) => {
 *      // do some update that needs to be in sync with the render loop
 * });
 * ```
 * @event Autodesk.Viewing#VIEWER_RENDER_TICK
 * @public
 */
const VIEWER_RENDER_TICK = "renderTick";

/**
 * Fired when the viewer detects that the GPU may be underperforming (e.g. integrated GPU, software renderer).
 * @event Autodesk.Viewing#SLOW_GPU_WARNING_EVENT
 * @property {'integrated-gpu'|'software-renderer'} reason - Detected reason for the warning.
 * @property {{ vendor: string, renderer: string }} rendererInfo - Raw WebGL vendor/renderer strings.
 * @property {function} suppressDefault - Call to prevent the default HudMessage from being shown.
 * @public
 */
const SLOW_GPU_WARNING_EVENT = 'slowGpuWarning';

/***/ },

/***/ "./src/application/GlobalManager.js"
/*!******************************************!*\
  !*** ./src/application/GlobalManager.js ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GlobalManager: () => (/* binding */ GlobalManager)
/* harmony export */ });
/* harmony import */ var _global_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../global.js */ "./src/global.js");


/**
 * Class that provides the window and document for each viewer instance.
 *
 * @private
 */
class GlobalManager {

  constructor() {
    this._window = { inner: null, registeredEventListeners: new Map() };
    this._document = { inner: null, registeredEventListeners: new Map() };

    // initialize
    this._window.inner = (0,_global_js__WEBPACK_IMPORTED_MODULE_0__.getGlobal)(); // start of with global window
    this._document.inner = this._window.inner.document;

    // Event listener wrappers
    this.addWindowEventListener = addEventListener.bind(this._window);
    this.removeWindowEventListener = removeEventListener.bind(this._window);
    this.addDocumentEventListener = addEventListener.bind(this._document);
    this.removeDocumentEventListener = removeEventListener.bind(this._document);
  }

  /**
   * Get the current window
   */
  getWindow() {
    return this._window.inner;
  }

  /**
   * Get the current document
   */
  getDocument() {
    return this._document.inner;
  }

  /**
   * Set the new window
   *
   * @param {object} - new window
   */
  setWindow(obj) {
    if (!obj || obj === this._window.inner) {
      return;
    }

    // Re-register event listeners in the new global context
    for (let [type, listeners] of this._window.registeredEventListeners.entries()) {
      for (let [listener, options] of listeners.entries()) {
        obj.addEventListener(type, listener, ...options);
        this._window.inner.removeEventListener(type, listener, ...options);
      }
    }
    for (let [type, listeners] of this._document.registeredEventListeners.entries()) {
      for (let [listener, options] of listeners.entries()) {
        obj.document.addEventListener(type, listener, ...options);
        this._document.inner.removeEventListener(type, listener, ...options);
      }
    }

    this._window.inner = obj;
    this._document.inner = obj.document;
  }

}

/**
 * Returns if a window was created using window.open()
 * @param {*} cWindow
 * @private
 */
function isChild(cWindow) {
  return !!cWindow.opener;
}

/**
 * Helper method that saves the registered event handlers
 * and calls the same method on the inner object
 * @private
 */
function addEventListener(type, listener, ...options) {
  if (!isChild(this.inner)) {
    if (this.registeredEventListeners.has(type)) {
      this.registeredEventListeners.get(type).set(listener, options);
    } else {
      this.registeredEventListeners.set(type, new Map([[listener, options]]));
    }
  }
  this.inner.addEventListener(type, listener, ...options);
}

/**
 * Helper method that removes the registered event handlers
 * and calls the same method on the inner object
 * @private
 */
function removeEventListener(type, listener, ...options) {
  if (!isChild(this.inner)) {
    if (this.registeredEventListeners.has(type)) {
      if (this.registeredEventListeners.get(type).has(listener)) {
        this.registeredEventListeners.get(type).delete(listener);
      }
    }
  }
  this.inner.removeEventListener(type, listener, ...options);
}



/***/ },

/***/ "./src/application/GlobalManagerMixin.js"
/*!***********************************************!*\
  !*** ./src/application/GlobalManagerMixin.js ***!
  \***********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GlobalManagerMixin: () => (/* binding */ GlobalManagerMixin),
/* harmony export */   GlobalManagerProvider: () => (/* binding */ GlobalManagerProvider)
/* harmony export */ });
/* harmony import */ var _GlobalManager_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./GlobalManager.js */ "./src/application/GlobalManager.js");

const globalManager = new _GlobalManager_js__WEBPACK_IMPORTED_MODULE_0__.GlobalManager();

/**
 * Helper class that can be inherited from to store a reference to the GlobalManager and
 * provide convenience methods to the global objects managed by the GlobalManager.
 * @public
 */
class GlobalManagerProvider {
  setGlobalManager(globalManager) {
    this.globalManager = globalManager;
    this.onSetGlobalManager(this.globalManager);
  }

  /**
   * Classes can override this method to pass the instance to other objects
   * See DockingPanel.js for an example
   * @param {GlobalManager} globalManager GlobalManager instance
   */
  // eslint-disable-next-line no-unused-vars
  onSetGlobalManager(globalManager) {

    // To be overridden
  }
  getWindow() {
    return this.globalManager.getWindow();
  }

  getDocument() {
    return this.globalManager.getDocument();
  }

  setWindow(newWindow) {
    return this.globalManager.setWindow(newWindow);
  }

  addWindowEventListener(type, listener, ...options) {
    this.globalManager.addWindowEventListener(type, listener, ...options);
  }

  removeWindowEventListener(type, listener, ...options) {
    this.globalManager.removeWindowEventListener(type, listener, ...options);
  }

  addDocumentEventListener(type, listener, ...options) {
    this.globalManager.addDocumentEventListener(type, listener, ...options);
  }

  removeDocumentEventListener(type, listener, ...options) {
    this.globalManager.removeDocumentEventListener(type, listener, ...options);
  }
}

GlobalManagerProvider.prototype.globalManager = globalManager;


/**
 * Adds the GlobalManagerProvider methods to the prototype of another class.
 *
 * This function can be used to add the GlobalManagerProvider functionality to a
 * class without directly inheriting from the GlobalManagerProvider class. The downside will
 * be that there will not be correct type information for the globalManager property.
 *
 * It is mainly provided for backwards compatibility because this pattern is used in all
 * existing extensions. Where possible, prefer to inherit from the GlobalManagerProvider class.
 */
function GlobalManagerMixin() {
  this.globalManager = GlobalManagerProvider.prototype.globalManager;
  this.setGlobalManager = GlobalManagerProvider.prototype.setGlobalManager;
  this.onSetGlobalManager = GlobalManagerProvider.prototype.onSetGlobalManager;
  this.getWindow = GlobalManagerProvider.prototype.getWindow;
  this.getDocument = GlobalManagerProvider.prototype.getDocument;
  this.setWindow = GlobalManagerProvider.prototype.setWindow;
  this.addWindowEventListener = GlobalManagerProvider.prototype.addWindowEventListener;
  this.removeWindowEventListener = GlobalManagerProvider.prototype.removeWindowEventListener;
  this.addDocumentEventListener = GlobalManagerProvider.prototype.addDocumentEventListener;
  this.removeDocumentEventListener = GlobalManagerProvider.prototype.removeDocumentEventListener;
}

// This is a workaround to solve the problem, that the GlobalManagerMixing/GlobalManagerProvider is already imported via the
// namespace in some extenstions that are also imported via import statements into the bundle. The problem
// is that the namespaces are only filled once the whole bundle has been parsed and thus while code within
// the bundle is executed it is not yet possible to get the symbols from the global namespace.
// We use the IIFE here to hide this assignment from the TypeScript compiler. The types will be correctly
// assigned because we are exporting the GlobalManagerMixin function.
(function () {
  globalThis.Autodesk.Viewing.GlobalManagerMixin = GlobalManagerMixin;
  globalThis.Autodesk.Viewing.GlobalManagerProvider = GlobalManagerProvider;
})();

/***/ },

/***/ "./src/global.js"
/*!***********************!*\
  !*** ./src/global.js ***!
  \***********************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   getGlobal: () => (/* binding */ getGlobal)
/* harmony export */ });
/**
 * Functions on the global scope need to be called with the global scope as their 'this' context.
 * Therefore, we can't simply return function properties from the global scope proxy like other properties.
 * We create another (temporary) proxy instead, which implements the 'apply' hook.
 * Invoking a function through this hook will ensure the correct 'this' context inside of the function.
 *
 * @param {Object} globalScope The global scope that the function is a property of (e.g. window).
 * @param {Function} func The function property that is accessed through the global scope proxy.
 * @returns {Proxy} A new proxy that forwards function invocations so that the 'this' context of the invoked function
 *   is set up properly.
 */
function createFunctionProxy(globalScope, func) {
  return new Proxy(func, {
    get(obj, prop) {
      return obj[prop];
    },
    apply(target, thisArg, argumentsList) {
      return target.call(globalScope || thisArg, ...argumentsList);
    }
  });
}

// A helper method to get an app-specific namespace under the global scope, or create it if it's not present yet.
function getAppNamespace(globalScope) {
  return globalScope[globalScope.LMV_APP_NAMESPACE] = globalScope[globalScope.LMV_APP_NAMESPACE] || {};
}

/**
 * Returns the global object of the current environment (e.g. window in a browser).
 * If `USE_LMV_APP_NAMESPACES` is set to `true` on the global scope, the returned value will be a proxy that intercepts
 * set operations on non-existing properties and writes the value to an app-specific namespace instead. The actual
 * property on the window object is a placeholder that forwards read and write operations to the app-specific version.
 *
 * Example:
 * Given that window.LMV_APP_NAMESPACE is 'myApp' and window.Autodesk does not exist yet
 *
 * getGlobal().Autodesk = {}
 *
 * will be rewritten as
 *
 * window.myApp.Autodesk = {};
 * window.Autodesk = Placeholder that forwards to window[window.LMV_APP_NAMESPACE].Autodesk
 *
 * Changing window.LMV_APP_NAMESPACE to 'myOtherApp' will then rewrite
 *
 * window.Autodesk to window.myOtherApp.Autodesk
 *
 * @returns {Object} The global scope of the environment.
 */
function getGlobal() {
  // Determine the global scope of the environment
  const globalScope = typeof window !== "undefined" && window !== null ?
  window :
  typeof self !== "undefined" && self !== null ?
  self :
  __webpack_require__.g;

  // If app namespaces are used, create and return a proxy instead of the actual global scope object.
  if (globalScope.USE_LMV_APP_NAMESPACES) {
    if (!globalScope.globalProxy) {
      // The proxy is a singleton that will only be created once, even across multiple viewer bundles.
      globalScope.globalProxy = new Proxy({}, {
        // Get requests are simply forwarded to the global scope.
        // Functions get some special treatment, because they need to invoked with the global scope as their
        // 'this' context.
        get(obj, prop) {
          let value = globalScope[prop];
          if (typeof value === 'function') {
            return createFunctionProxy(globalScope, value);
          }
          return value;
        },
        // Set requests are intercepted to create properties in app-specific namespaces.
        set(obj, prop, value) {
          if (Object.prototype.hasOwnProperty.call(globalScope, prop)) {
            // Don't proxy existing properties
            if (globalScope[prop] !== value)
            globalScope[prop] = value;
          } else {
            // Create the property under the app's namespace and inject a proxy object in the global
            // scope that forwards to the namespaced property.
            getAppNamespace(globalScope)[prop] = value;
            Object.defineProperty(globalScope, prop, {
              get: () => {return getAppNamespace(globalScope)[prop];},
              set: (value) => {getAppNamespace(globalScope)[prop] = value;}
            });
          }
          return true; // Proxy setters must return true
        }
      });
    }

    return globalScope.globalProxy;
  } else {
    return globalScope;
  }
}

/***/ },

/***/ "./src/measurement/DisplayUnits.js"
/*!*****************************************!*\
  !*** ./src/measurement/DisplayUnits.js ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   displayUnits: () => (/* binding */ displayUnits),
/* harmony export */   displayUnitsEnum: () => (/* binding */ displayUnitsEnum),
/* harmony export */   displayUnitsPrecision: () => (/* binding */ displayUnitsPrecision),
/* harmony export */   displayUnitsPrecisionEnum: () => (/* binding */ displayUnitsPrecisionEnum),
/* harmony export */   getUnitEnum: () => (/* binding */ getUnitEnum)
/* harmony export */ });
/* harmony import */ var i18next__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! i18next */ "./node_modules/i18next/dist/esm/i18next.js");


// Display units for the user to choose from
const DisplayUnits = [
{ name: 'File units', type: '' },
{ name: 'Millimeters', type: 'mm', matches: ['millimeter', 'millimeters'] },
{ name: 'Centimeters', type: 'cm', matches: ['centimeter', 'centimeters'] },
{ name: 'Meters', type: 'm' },
{ name: 'Inches', type: 'in', matches: ['inch', 'inches'] },
{ name: 'Feet', type: 'ft', matches: ['feet', 'foot'] },
{ name: 'US Survey Feet', type: 'sft', matches: ['ft-us', 'survey ft', 'us survey foot', 'us survey feet'] },
{ name: 'Feet and fractional inches', type: 'ft-and-fractional-in' },
{ name: 'Feet and decimal inches', type: 'ft-and-decimal-in' },
{ name: 'Decimal inches', type: 'decimal-in' },
{ name: 'Decimal feet', type: 'decimal-ft' },
{ name: 'Fractional inches', type: 'fractional-in' },
{ name: 'Meters and centimeters', type: 'm-and-cm' },
{ name: 'Points', type: 'pt', matches: ['point', 'points'] }];


const Precision = [
{ name: 'File precision', value: '' },
{ name: '0 (1)', value: 0 },
{ name: '0.1 (1/2)', value: 1 },
{ name: '0.01 (1/4)', value: 2 },
{ name: '0.001 (1/8)', value: 3 },
{ name: '0.0001 (1/16)', value: 4 },
{ name: '0.00001 (1/32)', value: 5 },
{ name: '0.000001 (1/64)', value: 6 }];


const displayUnits = DisplayUnits.map((x) => x.name);
const displayUnitsEnum = DisplayUnits.map((x) => x.type);

const displayUnitsPrecision = Precision.map((x) => x.name);
const displayUnitsPrecisionEnum = Precision.map((x) => x.value);


// Include translated names in the match
// This is to support variations such as mm, millimeters or millimeter, or their translated counterparts
DisplayUnits.forEach((unitDef) => {
  if (unitDef.matches) {
    const traslated = unitDef.matches.map((x) => i18next__WEBPACK_IMPORTED_MODULE_0__["default"].t(x));
    unitDef.matches = unitDef.matches.concat(traslated);
  }
});

const displayUnitsSet = new Set(displayUnitsEnum);

function getUnitEnum(unit) {
  unit = unit && unit.toLocaleLowerCase();
  if (displayUnitsSet.has(unit)) {
    return unit;
  }

  // find a good enum match for the unit
  for (let i in DisplayUnits) {
    const unitDef = DisplayUnits[i];
    const matches = unitDef.matches;
    if (matches && matches.indexOf(unit) > -1) {
      return unitDef.type;
    }
  }

  return null;
}

/***/ },

/***/ "./src/measurement/MeasureCommon.js"
/*!******************************************!*\
  !*** ./src/measurement/MeasureCommon.js ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   EPSILON: () => (/* binding */ EPSILON),
/* harmony export */   angleVectorToVector: () => (/* binding */ angleVectorToVector),
/* harmony export */   calculateDistance: () => (/* binding */ calculateDistance),
/* harmony export */   computeResult: () => (/* binding */ computeResult),
/* harmony export */   correctPerpendicularPicks: () => (/* binding */ correctPerpendicularPicks),
/* harmony export */   createCommonOverlay: () => (/* binding */ createCommonOverlay),
/* harmony export */   getCircularArcRadius: () => (/* binding */ getCircularArcRadius),
/* harmony export */   getDpiPrecision: () => (/* binding */ getDpiPrecision),
/* harmony export */   getEndPointsInEdge: () => (/* binding */ getEndPointsInEdge),
/* harmony export */   getFaceArea: () => (/* binding */ getFaceArea),
/* harmony export */   getSnapResultPosition: () => (/* binding */ getSnapResultPosition),
/* harmony export */   inverseProject: () => (/* binding */ inverseProject),
/* harmony export */   isEqualVectors: () => (/* binding */ isEqualVectors),
/* harmony export */   isParallel: () => (/* binding */ isParallel),
/* harmony export */   isPerpendicular: () => (/* binding */ isPerpendicular),
/* harmony export */   nearestPointInPointToLine: () => (/* binding */ nearestPointInPointToLine),
/* harmony export */   nearestPointInPointToSegment: () => (/* binding */ nearestPointInPointToSegment),
/* harmony export */   nearestVertexInVertexToEdge: () => (/* binding */ nearestVertexInVertexToEdge),
/* harmony export */   project: () => (/* binding */ project),
/* harmony export */   safeToggle: () => (/* binding */ safeToggle)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SnapTypes.js */ "./src/measurement/SnapTypes.js");
/* harmony import */ var _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MeasurementTypes.js */ "./src/measurement/MeasurementTypes.js");
/* harmony import */ var _UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./UnitFormatter.js */ "./src/measurement/UnitFormatter.js");
/* harmony import */ var _extensions_Measure_CustomTools_LaserMeasureComputation_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../../extensions/Measure/CustomTools/LaserMeasureComputation.js */ "./extensions/Measure/CustomTools/LaserMeasureComputation.js");
/* harmony import */ var _extensions_Measure_CustomTools_SurfaceMeasureComputation_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../../extensions/Measure/CustomTools/SurfaceMeasureComputation.js */ "./extensions/Measure/CustomTools/SurfaceMeasureComputation.js");







const EPSILON = 0.0001;
function getSnapResultPosition(pick, viewer) {
  if (!pick) {
    return null;
  }

  if (pick.isPerpendicular) {
    return pick.intersectPoint;
  }

  switch (pick.geomType) {
    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_VERTEX:
    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.RASTER_PIXEL:
    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_MIDPOINT:
    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_CIRCLE_CENTER:
      return pick.getGeometry();

    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_EDGE:
      var eps = getEndPointsInEdge(pick.getGeometry());
      var p1 = eps[0].clone();
      var p2 = eps[1].clone();
      return nearestPointInPointToLine(pick.intersectPoint, p1, p2);

    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_FACE:
      return nearestPointInPointToPlane(pick.intersectPoint, pick.getGeometry().vertices[0], pick.faceNormal);

    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_CIRCULARARC:
      if (viewer && viewer.model && viewer.model.is2d()) {
        var point = pick.snapPoint;
        pick.geomType = _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_VERTEX;
        pick.geomVertex = point;
        return point;

      } else {
        // For 3D models, currently we don't have the center geometry of the circle.
        // So the only way to select the center is by selecting the perimeter.
        return pick.circularArcCenter;
      }

    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_CURVEDEDGE:
      return nearestVertexInVertexToEdge(pick.intersectPoint, pick.getGeometry());

    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_CURVEDFACE:
      return pick.intersectPoint;

    // For snapping intersections, the snapped position is already computed.
    case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_INTERSECTION:
      return pick.snapPoint;

    default:
      return null;
  }
};

function correctPerpendicularPicks(firstPick, secondPick, viewer, snapper) {

  if (!firstPick || !secondPick || !firstPick.getGeometry() || !secondPick.getGeometry()) {
    return false;
  }

  var start = getSnapResultPosition(firstPick, viewer);

  if (snapper && viewer) {

    // Simple _ to Edge - Snap the second pick when it's 90 degrees.
    if (secondPick.geomType === _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_EDGE) {
      var v2 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
      var v3 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

      var secondEdge = secondPick.getGeometry();
      v2.subVectors(secondPick.intersectPoint, start).normalize(); // rubberband vector
      v3.subVectors(secondEdge.vertices[0], secondEdge.vertices[1]).normalize();

      if (isPerpendicular(v2, v3, 0.05)) {
        var newPoint = nearestPointInPointToSegment(start, secondEdge.vertices[0], secondEdge.vertices[1], true);

        if (newPoint) {
          if (snapper.onMouseMove(project(newPoint, viewer))) {
            snapper.setPerpendicular(true);
          }

          secondPick.geomVertex = newPoint;
          secondPick.intersectPoint = newPoint;
          return true;
        }
      }
    }

    // Simple _ to Face - Snap the second pick when it's 90 degrees.
    else if (secondPick.geomType === _SnapTypes_js__WEBPACK_IMPORTED_MODULE_1__.SnapType.SNAP_FACE) {

      var v = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

      var secondFace = secondPick.getGeometry();

      v.subVectors(secondPick.intersectPoint, start).normalize(); // rubberband vector

      if (isParallel(secondPick.faceNormal, v, 0.05)) {

        var newPoint = nearestPointInPointToPlane(start, secondFace.vertices[0], secondPick.faceNormal);
        if (snapper.onMouseMove(project(newPoint, viewer))) {
          snapper.setPerpendicular(true);
        }

        secondPick.geomVertex = newPoint;
        secondPick.intersectPoint = newPoint;
        return true;
      }
    }
  }
};

function convertCoordinates(point1, point2, viewer, firstPick) {
  // Convert coords when in 2D
  if (viewer.model.is2d()) {
    // Issue is that unsnapped/free measures do not have a viewportIndex, so set to Id if null
    firstPick.viewportIndex2d = viewer.model.isPdf ? firstPick.viewportIndex2d : firstPick.viewportIndex2d || firstPick.id;
    viewer.model.pageToModel(point1, point2, firstPick.viewportIndex2d);
  }
}

function getUnits(firstPick, viewer) {
  // The viewport, that was measured in, might use a different unit than the model. So pass it along.
  let units;
  const vpId = firstPick.viewportIndex2d;
  const viewports = viewer?.model?.getData()?.viewports;

  if (viewports && vpId !== undefined) {
    units = viewports[vpId]?.units;
  }
  return units;
};

function calculateDistance(firstPick, secondPick, dPrecision, viewer) {

  if (!firstPick || !secondPick || !firstPick.getGeometry() || !secondPick.getGeometry()) {
    return null;
  }

  var p1 = getSnapResultPosition(firstPick, viewer);
  var p2 = getSnapResultPosition(secondPick, viewer);

  if (!p1 || !p2) {
    return null;
  }

  var ep1 = p1.clone();
  var ep2 = p2.clone();

  if (isEqualVectors(ep1, ep2, EPSILON)) {
    return null;
  }

  var distanceXYZ, distanceX, distanceY, distanceZ;

  convertCoordinates(ep1, ep2, viewer, firstPick);

  const units = getUnits(firstPick, viewer);

  // Include resolution limits for high precision 2D-measurements, where available
  if (dPrecision) {

    dPrecision = processDPrecision(dPrecision);

    // Adjust the distances aligned by the precision
    var measurementDistance = ep1.distanceTo(ep2);
    distanceXYZ = applyDPrecision(measurementDistance, dPrecision);

    measurementDistance = Math.abs(ep1.x - ep2.x);
    distanceX = applyDPrecision(measurementDistance, dPrecision);

    measurementDistance = Math.abs(ep1.y - ep2.y);
    distanceY = applyDPrecision(measurementDistance, dPrecision);

    return {
      distanceXYZ: distanceXYZ,
      distanceX: distanceX,
      distanceY: distanceY,
      distanceZ: 0,
      type: _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_DISTANCE,
      units
    };
  }

  // Calculation for 3D models and 2D models without resolution limits
  distanceXYZ = ep1.distanceTo(ep2);
  distanceX = Math.abs(ep1.x - ep2.x);
  distanceY = Math.abs(ep1.y - ep2.y);
  distanceZ = Math.abs(ep1.z - ep2.z);
  return {
    distanceXYZ: distanceXYZ,
    distanceX: distanceX,
    distanceY: distanceY,
    distanceZ: distanceZ,
    type: _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_DISTANCE,
    units
  };
};

function getDpiPrecision(model, viewportIndex) {

  // Only do this for 2D models.
  if (model.is3d()) {
    return 0;
  }

  // TODO: The measurement values were returning incorrect results because the logical_width and logical_height is not being exported for PDFs.
  // This issue was introduced with the PDF viewport changes: PR-3523
  if (model.isPdf()) {
    return 0;
  }

  // Include resolution limits for high precision 2D-measurements, where available (TREX-575)
  var page_width = model.getMetadata('page_dimensions', 'page_width', null);
  var logical_width = model.getMetadata('page_dimensions', 'logical_width', null);
  var page_height = model.getMetadata('page_dimensions', 'page_height', null);
  var logical_height = model.getMetadata('page_dimensions', 'logical_height', null);
  if (!page_width || !logical_width || !page_height || !logical_height) {
    return 0;
  }

  // Retrieve the inverse DPI
  var invdpix = page_width / logical_width;
  var invdpiy = page_height / logical_height;

  // Calculate the graininess in model units
  var p1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0.0, 0.0, 0.0);
  var p2 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(invdpix, invdpiy, 0.0);
  model.pageToModel(p1, p2, viewportIndex);
  var dPrecision = p1.distanceTo(p2);

  return dPrecision;
};

function isContainsEqualVectors(points) {
  for (var i = 0; i < points.length; i++) {
    for (var j = 0; j < points.length; j++) {
      if (i !== j && isEqualVectors(points[i], points[j], EPSILON)) {
        return true;
      }
    }
  }

  return false;
};

function calculateAngle(picks, viewer) {
  var points = [];

  for (var key in picks) {
    if (picks.hasOwnProperty(key)) {
      var point = getSnapResultPosition(picks[key], viewer);
      if (point) {
        points.push(point);
      }
    }
  }

  if (points.length !== 3 || isContainsEqualVectors(points)) {
    return null;
  }


  var v1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var v2 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

  v1.subVectors(points[0], points[1]);
  v2.subVectors(points[2], points[1]);

  return angleVectorToVector(v1, v2);
};

function calculateArea(picks, viewer) {
  var points = [];

  for (var key in picks) {
    if (picks.hasOwnProperty(key)) {
      var point = getSnapResultPosition(picks[key], viewer);
      if (point) {
        points.push(point.clone());
      }
    }
  }

  var firstPoint = getSnapResultPosition(picks[1], viewer);
  if (firstPoint) {
    points.push(firstPoint.clone());
  }

  for (var i = 0; i < points.length; i += 2) {
    viewer.model.pageToModel(points[i], points[i + 1], picks[1].viewportIndex2d);
  }

  var sum1 = 0;
  var sum2 = 0;

  for (var i = 0; i < points.length - 1; i++) {
    sum1 += points[i].x * points[i + 1].y;
    sum2 += points[i].y * points[i + 1].x;
  }

  var area = Math.abs((sum1 - sum2) / 2);

  let units;
  const vpId = picks[1].viewportIndex2d;
  const viewports = viewer?.model?.getData()?.viewports;
  if (viewports && Number.isInteger(vpId)) {
    units = viewports[vpId]?.units;
  }

  return {
    area,
    type: _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_AREA,
    units: units
  };
};
function calculateArcLength(firstPick, secondPick, dPrecision, viewer) {

  if (!firstPick || !secondPick || !firstPick.getGeometry() || !secondPick.getGeometry()) {
    return null;
  }

  if (!firstPick.circularArcRadius) {
    return null;
  }

  var rawP1 = getSnapResultPosition(firstPick, viewer);
  var rawP2 = getSnapResultPosition(secondPick, viewer);

  if (!rawP1 || !rawP2) {
    return null;
  }

  var p1 = rawP1.clone();
  var p2 = rawP2.clone();

  const arcCenter = firstPick.circularArcCenter;

  // Get the center point
  var centerPoint =
  arcCenter instanceof (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3) ?
  arcCenter.clone() :
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(arcCenter.x, arcCenter.y, arcCenter.z);

  if (isEqualVectors(p1, p2, EPSILON)) {
    return 0;
  }

  // Convert coords when in 2D
  if (viewer.model.is2d()) {
    viewer.model.pageToModel(p1, p2, firstPick.viewportIndex2d);
    viewer.model.pageToModel(centerPoint, null, firstPick.viewportIndex2d);
  }

  // calculate the arc length
  function getArcLength() {
    var v1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
    var v2 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
    v1.subVectors(p1, centerPoint);
    v2.subVectors(p2, centerPoint);

    // To average decimal values from both the points
    var lengthProduct = v1.length() * v2.length();

    var dot = v1.dot(v2);
    var arcAngle = Math.acos(dot / lengthProduct);

    var radius = v1.length();

    return arcAngle * radius;
  }

  var arcLength = getArcLength();

  // Include resolution limits for high precision 2D-measurements, where available
  if (dPrecision) {
    dPrecision = processDPrecision(dPrecision);
    return applyDPrecision(arcLength, dPrecision);
  } else {
    return arcLength;
  }
};

/**
 * Calculates the smallest power of 10 such that it is > than the provided precision. For example, 5 will return 10
 * but 11 will return 100
 * @param {number} dPrecision Original precision
 * @returns {number} Closest precision expressed in power of 10
 */
function processDPrecision(dPrecision) {
  var n = Math.log(dPrecision) / Math.log(10.0);
  var nd = Math.floor(n);

  // Increase one decimal if the original precision < 10^nd
  if (1.0 < dPrecision / Math.pow(10.0, nd))
  nd++;

  return Math.pow(10.0, nd);
};

// Apply DPI precision to a measurement to round it to the correct number of digits
function applyDPrecision(measurement, dPrecision) {
  return Math.floor(measurement / dPrecision + 0.5) * dPrecision;
};

/**
 * The main function for this file, which calculates a measurement result (either distance
 * or angle) from a given measurement.
 */
function computeResult(picks, measurementType, viewer, options) {

  switch (measurementType) {
    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_DISTANCE:
      var firstPick = picks[1];
      var secondPick = picks[2];
      var dPrecision = getDpiPrecision(viewer.model, firstPick.viewportIndex2d);

      return calculateDistance(firstPick, secondPick, dPrecision, viewer);

    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_ANGLE:
      var angle = calculateAngle(picks, viewer);
      return angle ? {
        angle: !options || !options.angleOuter ? angle : 360 - angle,
        type: measurementType
      } : null;

    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_AREA:
      return calculateArea(picks, viewer);

    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_ARC:
      var firstPick = picks[1];
      var secondPick = picks[2];
      var dPrecision = getDpiPrecision(viewer.model, firstPick.viewportIndex2d);
      return {
        arc: calculateArcLength(firstPick, secondPick, dPrecision, viewer),
        type: measurementType
      };

    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_SPOT:{
        const spot = getSnapResultPosition(picks[1], viewer);
        let modelSpot = spot ? spot.clone() : null;
        const globalOffset = viewer.model.getData().globalOffset;
        if (modelSpot && globalOffset) {
          modelSpot.add(globalOffset);
        }
        convertCoordinates(modelSpot, new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(), viewer, picks[1]);
        let units = getUnits(picks[1], viewer);
        return {
          spot,
          modelSpot,
          type: measurementType,
          units
        };
      }

    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_LASER:{
        // Delegate to the laser computation module
        return (0,_extensions_Measure_CustomTools_LaserMeasureComputation_js__WEBPACK_IMPORTED_MODULE_4__.computeLaserResult)(picks, viewer);
      }

    case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_2__.MeasurementTypes.MEASUREMENT_SURFACE:{
        // Delegate to the surface computation module
        return (0,_extensions_Measure_CustomTools_SurfaceMeasureComputation_js__WEBPACK_IMPORTED_MODULE_5__.computeSurfaceResult)(picks, viewer);
      }

    default:
      return null;

  }
};

function getFaceArea(viewer, measurement, face, units, precision, calibrationFactor) {

  var area = 0;
  var V1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var V2 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  const verticesLength = face.vertices.length;

  for (var i = 0; i < verticesLength; i += 3) {
    const p0 = face.vertices[i];
    const p1 = face.vertices[i + 1];
    const p2 = face.vertices[i + 2];

    V1.subVectors(p1, p0);
    V2.subVectors(p2, p0);

    area += V1.length() * V2.length() * Math.sin(V1.angleTo(V2)) / 2;
  }

  area = (0,_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__.convertUnits)(viewer.model.getUnitString(), units, calibrationFactor, area, 'square');

  if (units) {

    return (0,_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__.formatValueWithUnits)(area, units + '^2', 3, precision);
  } else
  {

    return (0,_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__.formatValueWithUnits)(area, null, 3, precision);
  }

};

function getCircularArcRadius(viewer, measurement, edge, units, precision, calibrationFactor) {

  var radius = edge.radius;

  if (radius) {
    if (viewer.model.is2d()) {
      var pt1 = edge.center.clone();
      const pt2 = edge.vertices[0].clone();
      viewer.model.pageToModel(pt1, pt2, measurement.getPick(1).viewportIndex2d);
      radius = pt1.distanceTo(pt2);
    }

    radius = (0,_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__.convertUnits)(viewer.model.getUnitString(), units, calibrationFactor, radius);
    return (0,_UnitFormatter_js__WEBPACK_IMPORTED_MODULE_3__.formatValueWithUnits)(radius, units, 3, precision);
  }
};

function project(point, viewer, offset) {
  var camera = viewer.navigation.getCamera(),
    containerBounds = viewer.navigation.getScreenViewport(),
    p = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(point.x, point.y, point.z);

  p = p.project(camera);

  offset = offset || 0;

  return new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector2)(Math.round((p.x + 1) / 2 * containerBounds.width) + offset,
  Math.round((-p.y + 1) / 2 * containerBounds.height) + offset);
};

function inverseProject(point, viewer) {

  var camera = viewer.navigation.getCamera(),
    containerBounds = viewer.navigation.getScreenViewport(),
    p = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

  p.x = point.x / containerBounds.width * 2 - 1;
  p.y = -(point.y / containerBounds.height * 2 - 1);
  p.z = 0;

  p = p.unproject(camera);

  return p;
};

//***** Helper functions for calculations without state: ***** //
//TODO_TS: Are these used outside the Markup extension? If not, they should move there.


// Get the nearest point on the line from point to line
// inLine - whether to force the result to be inside the given line or not.
function nearestPointInPointToLine(point, lineStart, lineEnd) {

  var X0 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var X1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var nearestPoint;
  var param;

  X0.subVectors(lineStart, point);
  X1.subVectors(lineEnd, lineStart);
  param = X0.dot(X1);
  X0.subVectors(lineEnd, lineStart);
  param = -param / X0.dot(X0);

  X0.subVectors(lineEnd, lineStart);
  X0.multiplyScalar(param);
  nearestPoint = X0.add(lineStart);

  return nearestPoint;
};

// Get the nearest point on the line segment from point to line segment
function nearestPointInPointToSegment(point, lineStart, lineEnd, forcePerpendicular) {

  var X0 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var X1 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var nearestPoint;
  var param;

  X0.subVectors(lineStart, point);
  X1.subVectors(lineEnd, lineStart);
  param = X0.dot(X1);
  X0.subVectors(lineEnd, lineStart);
  param = -param / X0.dot(X0);

  if (param < 0) {
    if (forcePerpendicular) {
      nearestPoint = null;
    } else {
      nearestPoint = lineStart;
    }
  } else
  if (param > 1) {
    if (forcePerpendicular) {
      nearestPoint = null;
    } else {
      nearestPoint = lineEnd;
    }
  } else
  {
    X0.subVectors(lineEnd, lineStart);
    X0.multiplyScalar(param);
    nearestPoint = X0.add(lineStart);
  }

  return nearestPoint;
};



function isEqualVectors(v1, v2, precision) {
  if (!v1 || !v2) {
    return false;
  }

  if (Math.abs(v1.x - v2.x) <= precision && Math.abs(v1.y - v2.y) <= precision && Math.abs(v1.z - v2.z) <= precision) {
    return true;
  }
  return false;
};

function getEndPointsInEdge(edge) {

  var endPoints = [];
  const vertices = edge.vertices;
  const verticesLength = vertices.length;

  for (var i = 0; i < verticesLength; ++i) {

    var duplicate = false;
    const pt1 = vertices[i];
    for (var j = 0; j < verticesLength; ++j) {
      const pt2 = vertices[j];
      if (j !== i && pt2.equals(pt1)) {

        duplicate = true;
        break;
      }
    }

    if (!duplicate) {
      endPoints.push(pt1);
    }
  }

  // If the edge is degenerated, endPoints may be empty here. In this case, just add the first
  // two vertices of the input edge (different pointers, but equal point values in this case).
  if (endPoints.length < 2) {
    endPoints[0] = vertices[0];
    endPoints[1] = vertices[1];
  }

  return endPoints;
};

function angleVectorToVector(v1, v2) {
  return v1.angleTo(v2) * 180 / Math.PI;
};


// Find the nearest point from point to plane
function nearestPointInPointToPlane(p1, p2, n) {

  var nearestPoint = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  var norm = n.clone();
  var X0 = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  X0.subVectors(p1, p2);

  var sn = -norm.dot(X0);
  var sd = norm.dot(norm);
  var sb = sn / sd;

  nearestPoint.addVectors(p1, norm.multiplyScalar(sb));
  return nearestPoint;
};



// Returns true if v1 an v2 are parallel
function isParallel(v1, v2, precision) {
  precision = precision ? precision : EPSILON;
  return 1 - Math.abs(v1.dot(v2)) < precision;
};

function isPerpendicular(v1, v2, precision) {
  precision = precision ? precision : EPSILON;
  return Math.abs(v1.dot(v2)) < precision;
};


// Find the vertex need to draw For circular arc's radius
function nearestVertexInVertexToEdge(vertex, edge) {

  var nearestPoint;
  var minDist = Number.MAX_VALUE;

  for (var i = 0; i < edge.vertices.length; i++) {
    const pt = edge.vertices[i];
    var dist = vertex.distanceTo(pt);
    if (minDist > dist) {
      nearestPoint = pt;
      minDist = dist;
    }
  }

  return nearestPoint;
};

function createCommonOverlay(viewer, name) {
  if (!viewer.impl.overlayScenes[name])
  viewer.impl.createOverlayScene(name);
}

function safeToggle(element, property, show) {
  // toggle only if it needs to. Necessary for IE11.

  if (element.classList.contains(property) && !show || !element.classList.contains(property) && show) {
    element.classList.toggle(property, show);
  }
}

/***/ },

/***/ "./src/measurement/Measurement.js"
/*!****************************************!*\
  !*** ./src/measurement/Measurement.js ***!
  \****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Measurement: () => (/* binding */ Measurement)
/* harmony export */ });
/* harmony import */ var _SnapResult_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SnapResult.js */ "./src/measurement/SnapResult.js");
/* harmony import */ var _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./MeasurementTypes.js */ "./src/measurement/MeasurementTypes.js");
/* harmony import */ var _MeasureCommon_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MeasureCommon.js */ "./src/measurement/MeasureCommon.js");





/**
 * This is a DATA container class.
 * No rendering should be attached to it.
 * @private
 */
class Measurement {
  constructor(measurementType, id, options) {

    this.measurementType = measurementType;
    this.id = id;
    this.picks = [];
    this.closedArea = false;
    this.isRestored = false;
    this.options = options;

    this.resetMeasureValues();
  }

  /**
   * Returns a clone of itself.
   */
  clone() {
    const measurement = new Measurement(this.measurementType, this.id, this.options);
    measurement.closedArea = this.closedArea;
    measurement.isRestored = this.isRestored;
    measurement.picks = this.clonePicks();
    measurement.angle = this.angle;
    measurement.distanceX = this.distanceX;
    measurement.distanceY = this.distanceY;
    measurement.distanceZ = this.distanceZ;
    measurement.distanceXYZ = this.distanceXYZ;
    measurement.laserHitPoint = this.laserHitPoint;
    measurement.dimensions = this.dimensions;
    measurement.surfaceData = this.surfaceData;
    measurement.surfaceProperties = this.surfaceProperties;
    measurement.arc = this.arc;
    measurement.spot = this.spot?.clone();
    measurement.result = Object.assign({}, this.result);
    return measurement;
  }

  resetMeasureValues() {

    this.angle = 0;
    this.distanceX = 0;
    this.distanceY = 0;
    this.distanceZ = 0;
    this.distanceXYZ = 0;
    this.laserHitPoint = null;
    this.dimensions = null;
    this.surfaceData = null;
    this.surfaceProperties = null;
    this.arc = 0;
    this.spot = null;
    this.result = null;
  }

  setPick(index, value) {

    var pick = this.picks[index] = value;
    pick.id = parseInt(index);
    return pick;
  }

  getPick(index) {

    var pick = this.picks[index];

    if (!pick) {
      pick = this.setPick(index, new _SnapResult_js__WEBPACK_IMPORTED_MODULE_0__.SnapResult());
    }

    return pick;
  }

  clonePicks(index) {

    var picks = [];
    for (var key in this.picks) {
      if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
        var pick = this.picks[key];
        picks.push(pick.clone());
      }
    }
    return picks;
  }

  countPicks() {

    return Object.keys(this.picks).length;
  }

  getMaxNumberOfPicks() {

    switch (this.measurementType) {
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_SPOT:
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_LASER:
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_SURFACE:
        return 1;
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_DISTANCE:
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_CALLOUT:
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_ARC:
        return 2;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_ANGLE:
        return 3;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_AREA:
        return this.closedArea ? this.countPicks() : Number.MAX_VALUE - 1;
    }
  }

  hasPick(pickNumber) {

    return this.picks[pickNumber] && !this.picks[pickNumber].isEmpty() || this.isRestored;
  }

  isComplete() {
    var complete = this.countPicks() === this.getMaxNumberOfPicks();

    for (var key in this.picks) {
      if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
        complete = complete && this.hasPick(key);

        if (!complete)
        break;
      }
    }

    return complete;
  }

  isEmpty() {
    var empty = true;

    for (var key in this.picks) {
      if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
        empty = empty && !this.hasPick(key);

        if (!empty)
        break;
      }
    }

    return empty;
  }

  clearPick(pickNumber) {

    if (this.picks[pickNumber]) {
      this.picks[pickNumber].clear();
    }

    this.resetMeasureValues();
  }

  clearAllPicks() {

    for (var key in this.picks) {
      if (Object.prototype.hasOwnProperty.call(this.picks, key)) {
        this.clearPick(key);
      }
    }
  }

  hasEqualPicks(firstPick, secondPick) {
    if (!firstPick || !secondPick)
    return false;

    if (firstPick.geomType === secondPick.geomType) {
      var first = (0,_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_2__.getSnapResultPosition)(firstPick);
      var second = (0,_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_2__.getSnapResultPosition)(secondPick);
      return (0,_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_2__.isEqualVectors)(first, second, _MeasureCommon_js__WEBPACK_IMPORTED_MODULE_2__.EPSILON);
    }

    return false;
  }

  /**
   * Calculates distance/angle based on the values of the picks
   * and stores it in .result
   */
  computeResult(picks, viewer) {

    this.resetMeasureValues();

    if (!viewer.model) {
      this.result = null;
      return false;
    }

    // Compute and check if there's a result
    var result = this.result = (0,_MeasureCommon_js__WEBPACK_IMPORTED_MODULE_2__.computeResult)(picks, this.measurementType, viewer, this.options);

    if (result === null) {
      return !this.isComplete();
    }

    switch (result.type) {
      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_DISTANCE:
        this.distanceXYZ = result.distanceXYZ;
        this.distanceX = result.distanceX;
        this.distanceY = result.distanceY;
        this.distanceZ = result.distanceZ;
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_ANGLE:
        this.angle = isNaN(result.angle) ? 0 : result.angle;
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_AREA:
        this.area = result.area;
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_ARC:
        this.arc = result.arc;
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_SPOT:
        this.spot = result.spot;
        this.modelSpot = result.modelSpot;
        this.units = result.units;
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_CALLOUT:
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_LASER:
        this.laserHitPoint = result.laserHitPoint;
        this.dimensions = result.dimensions;
        return true;

      case _MeasurementTypes_js__WEBPACK_IMPORTED_MODULE_1__.MeasurementTypes.MEASUREMENT_SURFACE:
        this.surfaceData = result.surfaceData;
        this.surfaceProperties = result.surfaceProperties;
        return true;

      default:
        return false;
    }
  }

  getGeometry(pickNumber) {
    return { "type": this.picks[pickNumber].geomType, "geometry": this.picks[pickNumber].getGeometry() };
  }

  // TODO: Move this method elsewhere. This is a data-only class.
  attachIndicator(viewer, tool, indicatorClass) {
    this.indicator = new indicatorClass(viewer, this, tool);
    this.indicator.init();
  }
}

/***/ },

/***/ "./src/measurement/MeasurementTypes.js"
/*!*********************************************!*\
  !*** ./src/measurement/MeasurementTypes.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MeasurementTypes: () => (/* binding */ MeasurementTypes),
/* harmony export */   MeasurementTypesToAnalytics: () => (/* binding */ MeasurementTypesToAnalytics)
/* harmony export */ });

//TODO_TS: Rename this to singular
var MeasurementTypes = {
  MEASUREMENT_DISTANCE: 1, // Measurement from point to point, not matter what geometry it is.
  MEASUREMENT_ANGLE: 2,
  MEASUREMENT_AREA: 3,
  CALIBRATION: 4,
  MEASUREMENT_CALLOUT: 5,
  MEASUREMENT_SPOT: 6,
  MEASUREMENT_ARC: 7,
  MEASUREMENT_LASER: 8, // Measurement from point to point, but using a laser pointer.
  MEASUREMENT_SHORTEST_DISTANCE: 9, // Measurement from point to point, but using a shortest distance algorithm.
  MEASUREMENT_SURFACE: 10, // Measurement of surface area and properties.
  MEASUREMENT_SLOPE: 11 // Measurement of the slope of a surface.
};

var MeasurementTypesToAnalytics = {
  [MeasurementTypes.MEASUREMENT_DISTANCE]: 'Distance',
  [MeasurementTypes.MEASUREMENT_ANGLE]: 'Angle',
  [MeasurementTypes.MEASUREMENT_AREA]: 'Area',
  [MeasurementTypes.CALIBRATION]: 'Calibration',
  [MeasurementTypes.MEASUREMENT_CALLOUT]: 'Callout',
  [MeasurementTypes.MEASUREMENT_SPOT]: 'Spot',
  [MeasurementTypes.MEASUREMENT_ARC]: 'Arc',
  [MeasurementTypes.MEASUREMENT_LASER]: 'Laser',
  [MeasurementTypes.MEASUREMENT_SHORTEST_DISTANCE]: 'Shortest Distance',
  [MeasurementTypes.MEASUREMENT_SURFACE]: 'Surface',
  [MeasurementTypes.MEASUREMENT_SLOPE]: 'Slope'
};

/***/ },

/***/ "./src/measurement/SnapResult.js"
/*!***************************************!*\
  !*** ./src/measurement/SnapResult.js ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SnapResult: () => (/* binding */ SnapResult)
/* harmony export */ });
/* harmony import */ var _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./SnapTypes.js */ "./src/measurement/SnapTypes.js");



/**
 * @public
 */
class SnapResult {
  /**
   * Encapsulates the result of a Snap operation performed by the {@link Snapper}.
   *
   * @memberof Autodesk.Viewing.MeasureCommon
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult
   *
   * @class
   * @class
   */
  constructor() {
    this.clear();
  }

  /**
   * Resets the object to its non-snapping state.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#clear
   * @public
   */
  clear() {

    this.geomType = null; // int, such as { "NONE: -1", "VERTEX": 0, "EDGE": 1, "FACE": 2, ... }
    this.modelId = null; // string, model's internal id. null when snapping to overlay geometry.
    this.fragId = null; // Id of the fragment
    this.fragPos = null;
    this.snapNode = null; // int, the dbId
    this.geomVertex = null; // THREE.Vector3
    this.geomEdge = null; // THREE.Geometry
    this.geomFace = null; // THREE.Geometry
    this.geomLine = null; // THREE.Geometry
    this.radius = null; // Number
    this.intersectPoint = null; // THREE.Vector3
    this.faceNormal = null; // THREE.Vector3
    this.viewportIndex2d = null; // int
    this.circularArcCenter = null;
    this.circularArcRadius = null;
    this.fromTopology = false;
    this.isPerpendicular = false;
    this.snapPoint = null;
    this.originalFace = null;
  }

  /**
   * Copies the current state of the object into another.
   *
   * @param {SnapResult} destiny - target for the copy operation.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#copyTo
   * @public
   */
  copyTo(destiny) {
    // Shallow copies of THREE objects should be fine.
    destiny.modelId = this.modelId;
    destiny.fragId = this.fragId;
    destiny.fragPos = this.fragPos;
    destiny.snapNode = this.snapNode;
    destiny.geomVertex = this.geomVertex;
    destiny.geomFace = this.geomFace;
    destiny.geomEdge = this.geomEdge;
    destiny.geomLine = this.geomLine;
    destiny.radius = this.radius;
    destiny.geomType = this.geomType;
    destiny.intersectPoint = this.intersectPoint;
    destiny.faceNormal = this.faceNormal;
    destiny.viewportIndex2d = this.viewportIndex2d;
    destiny.circularArcCenter = this.circularArcCenter;
    destiny.circularArcRadius = this.circularArcRadius;
    destiny.fromTopology = this.fromTopology;
    destiny.isPerpendicular = this.isPerpendicular;
    destiny.snapPoint = this.snapPoint;
    destiny.originalFace = this.originalFace;
  }

  /**
   * Creates a new instance and copies the current state into it.
   *
   * @returns {SnapResult}
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#clone
   * @public
   */
  clone() {
    var theClone = new SnapResult();
    this.copyTo(theClone);
    return theClone;
  }

  /**
   * @returns {boolean} true only when snapping information is available.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#isEmpty
   * @public
   */
  isEmpty() {
    return !this.getGeometry();
  }

  // Transform SnapResult to another coordinate system.
  //
  // Note that we assume matrix to preserve spheres, which works for a composition of translation, uniform scaling, and rotation.
  applyMatrix4(matrix) {

    // transform THREE.Geometry
    this.geomEdge && this.geomEdge.applyMatrix4(matrix);
    this.geomFace && this.geomFace.applyMatrix4(matrix);
    this.geomLine && this.geomLine.applyMatrix4(matrix);

    // transform points (Vector3)
    this.geomVertex && this.geomVertex.applyMatrix4(matrix);
    this.intersectPoint && this.intersectPoint.applyMatrix4(matrix);
    this.circularArcCenter && this.circularArcCenter.applyMatrix4(matrix);
    this.snapPoint && this.snapPoint.applyMatrix4(matrix);

    // transform normal
    if (this.faceNormal) {
      tmpMatrix = tmpMatrix || new THREE.Matrix4();
      const normalMatrix = tmpMatrix.getNormalMatrix(matrix);
      this.faceNormal.applyMatrix4(normalMatrix);
    }

    // Transform radii
    this.radius = transformRadius(this.radius, matrix);
    this.circularArcRadius = transformRadius(this.circularArcRadius, matrix);
  }

  /**
   * Gets the snapped face, when available.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getFace
   * @public
   */
  getFace() {
    return this.geomFace;
  }

  /**
   * Gets the snapped edge, when available.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getEdge
   * @public
   */
  getEdge() {
    return this.geomEdge;
  }

  /**
   * Gets the snapped vertex, when available.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getVertex
   * @public
   */
  getVertex() {
    return this.geomVertex;
  }

  /**
   * Gets the snapped element, which differs depending on what kind of
   * element it was snapped to, see {@link Autodesk.Viewing.MeasureCommon.SnapType}.
   *
   * @alias Autodesk.Viewing.MeasureCommon.SnapResult#getGeometry
   * @public
   */
  getGeometry() {

    switch (this.geomType) {
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_VERTEX:return this.geomVertex;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_MIDPOINT:return this.geomVertex;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_INTERSECTION:return this.geomVertex;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CIRCLE_CENTER:return this.geomVertex;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.RASTER_PIXEL:return this.geomVertex;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_EDGE:return this.geomEdge;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_FACE:return this.geomFace;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CIRCULARARC:return this.geomEdge;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CURVEDEDGE:return this.geomEdge;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CURVEDFACE:return this.geomFace;
      default:break;
    }
    return null;
  }

  /**
   * @param {SnapType} type
   * @param {THREE.Geometry|THREE.BufferGeometry} geometry
   * @private
   */
  setGeometry(type, geometry) {

    switch (type) {
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_VERTEX:this.geomVertex = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_MIDPOINT:this.geomVertex = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_INTERSECTION:this.geomVertex = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CIRCLE_CENTER:this.geomVertex = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.RASTER_PIXEL:this.geomVertex = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_EDGE:this.geomEdge = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_FACE:this.geomFace = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CIRCULARARC:this.geomEdge = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CURVEDEDGE:this.geomEdge = geometry;break;
      case _SnapTypes_js__WEBPACK_IMPORTED_MODULE_0__.SnapType.SNAP_CURVEDFACE:this.geomFace = geometry;break;
      default:return;
    }
    this.geomType = type;
  }
}

let tmpMatrix = null;
let tmpVec1 = null;
let tmpVec2 = null;

// Note that we assume here that matrix preserves spheres. Otherwise, transforming lengths is not possible
const transformRadius = (radius, matrix) => {
  tmpVec1 = tmpVec1 || new THREE.Vector3();
  tmpVec2 = tmpVec2 || new THREE.Vector3();

  tmpVec1.set(0, 0, 0);
  tmpVec2.set(radius, 0, 0);

  // transform both vectors
  tmpVec1.applyMatrix4(matrix);
  tmpVec2.applyMatrix4(matrix);

  return tmpVec1.distanceTo(tmpVec2);
};

/***/ },

/***/ "./src/measurement/SnapTypes.js"
/*!**************************************!*\
  !*** ./src/measurement/SnapTypes.js ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SnapType: () => (/* binding */ SnapType)
/* harmony export */ });

/**
 * An enumeration of supported snapping types.
 *
 * @enum {number}
 * @memberof Autodesk.Viewing.MeasureCommon
 * @alias Autodesk.Viewing.MeasureCommon.SnapType
 *
 * @public
 */
var SnapType = {
  SNAP_VERTEX: 0,
  SNAP_MIDPOINT: 1,
  SNAP_CIRCLE_CENTER: 2,
  SNAP_EDGE: 3,
  SNAP_FACE: 4,
  SNAP_CIRCULARARC: 5,
  SNAP_CURVEDEDGE: 6,
  SNAP_CURVEDFACE: 7,
  RASTER_PIXEL: 8,
  SNAP_INTERSECTION: 9,
  SNAP_NO_MEASUREMENT: 10
};

/***/ },

/***/ "./src/measurement/UnitFormatter.js"
/*!******************************************!*\
  !*** ./src/measurement/UnitFormatter.js ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ModelUnits: () => (/* binding */ ModelUnits),
/* harmony export */   calculatePrecision: () => (/* binding */ calculatePrecision),
/* harmony export */   convertToDisplayUnits: () => (/* binding */ convertToDisplayUnits),
/* harmony export */   convertUnits: () => (/* binding */ convertUnits),
/* harmony export */   fixUnitString: () => (/* binding */ fixUnitString),
/* harmony export */   forgeUnitToSymbol: () => (/* binding */ forgeUnitToSymbol),
/* harmony export */   formatValueWithUnits: () => (/* binding */ formatValueWithUnits),
/* harmony export */   getMainUnit: () => (/* binding */ getMainUnit),
/* harmony export */   getUnitData: () => (/* binding */ getUnitData)
/* harmony export */ });
/* harmony import */ var i18next__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! i18next */ "./node_modules/i18next/dist/esm/i18next.js");
/* harmony import */ var _units_compact_json__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./units-compact.json */ "./src/measurement/units-compact.json");
/* harmony import */ var _DisplayUnits_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./DisplayUnits.js */ "./src/measurement/DisplayUnits.js");





/**
 * Model units enum
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#ModelUnits
 */
var ModelUnits = {
  METER: 'm',
  CENTIMETER: 'cm',
  MILLIMETER: 'mm',
  FOOT: 'ft',
  US_SURVEY_FOOT: 'sft',
  INCH: 'in',
  POINT: 'pt'
};

const UnitScales = {
  [ModelUnits.METER]: 1.0,
  [ModelUnits.CENTIMETER]: 0.01,
  [ModelUnits.MILLIMETER]: 0.001,
  [ModelUnits.FOOT]: 0.3048,
  [ModelUnits.US_SURVEY_FOOT]: 1200 / 3937, // US Survey Foot: https://en.wikipedia.org/wiki/Foot_(unit)#Survey_foot
  [ModelUnits.INCH]: 0.0254,
  [ModelUnits.POINT]: 0.0254 / 72 //A typographical point is 1/72 of an international inch
};

function getExponentSymbol(exponent) {
  let exponentSymbol = '';
  if (exponent === 2) {
    exponentSymbol = String.fromCharCode(0xb2);
  } else if (exponent === 3) {
    exponentSymbol = String.fromCharCode(0xb3);
  }
  return exponentSymbol;
}

function modf(x) {
  var intPart = 0 <= x ? Math.floor(x) : Math.ceil(x),
    fracPart = x - intPart;
  return { intPart: intPart, fracPart: fracPart };
}

function formatNumber(x, precision, needMinusSign) {
  var result = '';

  if (needMinusSign && x === 0) {
    result += '-';
  }

  //According to Shawn's request, do not truncate trailing .0's
  //if (modf(x).fracPart === 0) {
  //
  //    // No fractional part.
  //    //
  //    result += x;
  //
  //} else if (0 < precision) {
  if (0 < precision) {

    // Truncate any trailing .0's.
    //
    //var s = x.toFixed(precision);
    //var re = /^\-?([0-9]+)\.0+$/;
    //var m = re.exec(s);
    //if (m !== null) {
    //    result += m[1];
    //} else {
    //    result += s;
    //}

    result += x.toFixed(precision);

  } else {
    result += x.toFixed(0);
  }

  return result;
}

function formatFeet(value, precision, inchesOnly, symbols) {

  // Borrowed from AdCoreUnits PrimeDoublePrimeSymbol2::Format

  var result = '',
    radix = 12.0,
    denominator = 1.0,
    isNegative = value < 0;

  for (var i = 0; i < precision; ++i) {
    denominator *= 2.0;
  }

  // round to the nearest 1/denominator
  if (value > 0) {
    value += 0.5 / denominator;
  } else {
    value -= 0.5 / denominator;
  }

  var primeValue, doublePrimeValue;

  if (!inchesOnly) {
    primeValue = modf(value / radix).intPart;
    result += formatNumber(primeValue, 0, isNegative) + symbols.feet + ' ';
    doublePrimeValue = value - primeValue * radix;
    if (doublePrimeValue < 0) {
      doublePrimeValue = -doublePrimeValue;
    }

  } else {
    doublePrimeValue = value;
  }

  var intPart = modf(doublePrimeValue).intPart;
  var numerator = modf((doublePrimeValue - intPart) * denominator).intPart;

  if (numerator === 0 || intPart !== 0) {
    result += formatNumber(intPart, 0);
  }

  if (numerator !== 0) {
    if (intPart < 0 && numerator < 0) {
      numerator = -numerator;
    }
    while (numerator % 2 === 0) {
      numerator /= 2;
      denominator /= 2;
    }
    if (intPart !== 0) {
      result += '-';
    }
    result += formatNumber(numerator, 0) + '/' + formatNumber(denominator, 0);
  }

  result += symbols.inches;
  return result;
}

function formatMeterAndCentimeter(value, precision, exponent = 1) {
  var sign = '';
  if (value < 0) {
    sign = '-';
    value = Math.abs(value);
  }
  var modfValue = modf(value),
    mValue = modfValue.intPart,
    cmValue = modfValue.fracPart * Math.pow(100.0, exponent);

  const exponentSymbol = getExponentSymbol(exponent);

  let formattedMValue = formatNumber(mValue, 0);
  let formattedCmValue = formatNumber(cmValue, precision);

  if (formattedCmValue.startsWith(Math.pow(100.0, exponent).toString())) {
    formattedMValue = formatNumber(mValue + 1, 0);
    formattedCmValue = formatNumber(0, precision);
  }

  return sign + formattedMValue + ` m${exponentSymbol} ` + formattedCmValue + ` cm${exponentSymbol}`;
}

function formatFeetAndDecimalInches(value, precision, symbols, exponent = 1) {
  var sign = '';
  if (value < 0) {
    sign = '-';
    value = Math.abs(value);
  }
  var modfValue = modf(value),
    ftValue = modfValue.intPart,
    inValue = modfValue.fracPart * Math.pow(12.0, exponent);

  const exponentSymbol = getExponentSymbol(exponent);

  let formattedFtValue = formatNumber(ftValue, 0);
  let formattedInValue = formatNumber(inValue, precision);

  if (formattedInValue.startsWith(Math.pow(12.0, exponent).toString())) {
    formattedFtValue = formatNumber(ftValue + 1, 0);
    formattedInValue = formatNumber(0, precision);
  }

  return sign +
  formattedFtValue + symbols.feet + exponentSymbol + ' ' +
  formattedInValue + symbols.inches + exponentSymbol;
}


//Hardcoded Forge units that imply specific symbol formatting
//TODO: Not all of these are supported by the formatting code in LMV,
//so some are commented out.
const customFormattingMap = {
  feetFractionalInches: "ft-and-fractional-in",
  fractionalInches: "fractional-in",
  feet: "feet",
  inches: "inches",
  /*
  metersCentimeters: "meters",
  degreesMinutes: "degrees",
  slopeDegrees: "degrees",
  */
  stationingFeet: "feet",
  stationingSurveyFeet: "sft",
  usSurveyFeet: "sft"
  /*
  stationingMeters: "meters",
   */
};

/**
 * look up forge units and return the matching symbol, default unit string or the given unit.
 * @param {string} units
 * @returns symbol
 */
function forgeUnitToSymbol(units) {

  /**
   * The Forge unit mapping file (units.json and units-compact.json) is generated from the Forge schema files.
   * The script that does that is located here: https://git.autodesk.com/constructwin/dt-schemas
   */

  if (!units || !units.startsWith("autodesk.unit.unit:"))
  return units;

  let schemaName = units.split(":")[1];
  let unitId = schemaName.split("-")[0];
  let unitDef = _units_compact_json__WEBPACK_IMPORTED_MODULE_1__.unit[unitId];
  if (unitDef) {
    let customFormattingStyle = customFormattingMap[unitId];
    if (customFormattingStyle) {
      return customFormattingStyle;
    }
    //If there is no custom formatting for this unit, use its schema symbol
    if (!unitDef.symbols) {
      return "";
    }
    //If there is a default symbol for this unit, use it
    if (unitDef.defaultSymbol && unitDef.symbols[unitDef.defaultSymbol]) {
      return unitDef.symbols[unitDef.defaultSymbol];
    }
    //There can be multiple symbols, we pick the first one.
    for (let s in unitDef.symbols) {
      return unitDef.symbols[s];
    }
  }
  console.warn("Failed to find Forge unit schema for", units);
  return units;
}

function formatWithSymbol(value, symbol) {
  const spacing = symbol.space ? ' ' : '';
  if (symbol.placement === 'Prefix') {
    return symbol.text + spacing + value;
  } else {// Assuming 'Suffix' placement by default
    return value + spacing + symbol.text;
  }
}


/**
 * Formats a value with units
 * @param {number} value
 * @param {string} units - GNU units format or Forge Unit ID (see https://git.autodesk.com/forge/HFDMSchemas/tree/master/schemas/autodesk/unit)
 * @param {number} type - For example: 1=boolean, 2=integer, 3=double, 20=string, 24=Position
 * @param {number} precision - required precision.
 * @param {Object} [options] - An optional dictionary of options.
 * @param {boolean} [options.noMixedArea] - For mixed area units such as 'm-and-cm', fallback to the larger unit.
 * @param {boolean} [options.noMixedVolume] - For mixed volume units such as 'm-and-cm', fallback to the larger unit.
 * @param {boolean} [options.preferLetters] - For inches and feet, use 'in' and 'ft' over ' and " respectively.
 * see https://git.autodesk.com/A360/platform-translation-propertydb/blob/master/propertydb/PropertyDatabase.h
 * @returns {string} formatted value
 */
function formatValueWithUnits(value, units, type, precision, options) {

  var result;

  if (precision === null || precision === undefined) {
    precision = 3;
  }

  options = options || {};
  const feetAndInchesSymbols = options.preferLetters ? { feet: ' ft', inches: ' in' } : { feet: '\'', inches: '"' };

  //Is it a Forge unit?
  units = forgeUnitToSymbol(units);

  // TODO(go) - 20150504: Ideally this would be handled better: according to the git file at the top property types can be 0,1,2,3,10,11,20,21,22,23,24
  // TODO(go) - 20150504: The code below only handle Boolean (1) Integer (2) and double (3). Not sure how well the property types are assigned so using
  // TODO(go) - 20150504: try catch for now.
  try {

    if (type === 1) {// Boolean
      result = i18next__WEBPACK_IMPORTED_MODULE_0__["default"].t(value ? 'Yes' : 'No');

    } else if (type === 24) {// Position
      var position = value.split(' ');
      result = [];

      for (var i = 0; i < position.length; ++i) {
        result.push(formatValueWithUnits(parseFloat(position[i]), units, 3, precision));
      }

      result = result.join(', ');

    } else if ((type === 2 || type === 3) && isNaN(value)) {
      result = 'NaN';

    } else if (units === 'ft-and-fractional-in') {
      result = formatFeet(value * 12.0, precision, false, feetAndInchesSymbols);

    } else if (units === 'ft-and-fractional-in^2') {
      result = options.noMixedArea ?
      formatNumber(value, precision) + ' ft' + getExponentSymbol(2) :
      formatFeet(value * 12.0, precision, false, feetAndInchesSymbols) + ' ' + getExponentSymbol(2);

    } else if (units === 'ft-and-fractional-in^3') {
      result = options.noMixedVolume ?
      formatNumber(value, precision) + ' ft' + getExponentSymbol(3) :
      formatFeet(value * 12.0, precision, false, feetAndInchesSymbols) + ' ' + getExponentSymbol(3);

    } else if (units === 'ft-and-decimal-in') {
      result = formatFeetAndDecimalInches(value, precision, feetAndInchesSymbols);

    } else if (units === 'ft-and-decimal-in^2') {
      result = options.noMixedArea ?
      formatNumber(value, precision) + ' ft' + getExponentSymbol(2) :
      formatFeetAndDecimalInches(value, precision, feetAndInchesSymbols, 2);

    } else if (units === 'ft-and-decimal-in^3') {
      result = options.noMixedVolume ?
      formatNumber(value, precision) + ' ft' + getExponentSymbol(3) :
      formatFeetAndDecimalInches(value, precision, feetAndInchesSymbols, 3);

    } else if (units === 'decimal-in' || units === 'in' || units === 'inch' || units === 'inches') {
      result = formatNumber(value, precision) + feetAndInchesSymbols.inches;

    } else if (units === 'decimal-in^2' || units === 'in^2' || units === 'inch^2') {
      result = formatNumber(value, precision) + ' in' + getExponentSymbol(2);

    } else if (units === 'decimal-in^3' || units === 'in^3' || units === 'inch^3') {
      result = formatNumber(value, precision) + ' in' + getExponentSymbol(3);

    } else if (units === 'decimal-in-sq' || units === 'fractional-in-sq') {
      result = formatNumber(value, precision) + ' sq. in';

    } else if (units === 'decimal-ft' || units === 'ft' || units === 'feet' || units === 'foot') {
      result = formatNumber(value, precision) + feetAndInchesSymbols.feet;

    } else if (units === 'sft' || units === 'ft-us' || units === 'survey ft' || units === 'us survey foot' || units === 'us survey feet') {
      result = formatNumber(value, precision) + ' sft';

    } else if (units === 'decimal-ft^2' || units === 'ft^2' || units === 'feet^2' || units === 'foot^2') {
      result = formatNumber(value, precision) + ' ft' + getExponentSymbol(2);

    } else if (units === 'sft^2' || units === 'survey ft^2') {
      result = formatNumber(value, precision) + ' sft' + getExponentSymbol(2);

    } else if (units === 'decimal-ft^3' || units === 'ft^3' || units === 'feet^3' || units === 'foot^3') {
      result = formatNumber(value, precision) + ' ft' + getExponentSymbol(3);

    } else if (units === 'sft^3' || units === 'survey ft^3') {
      result = formatNumber(value, precision) + ' sft' + getExponentSymbol(3);

    } else if (units === 'decimal-ft-sq' || units === 'ft-and-fractional-in-sq' || units === 'ft-and-decimal-in-sq') {
      // Not mixing feet and inches in area measurements for this unit set, instead just show square feet.
      result = formatNumber(value, precision) + ' sq. ft';

    } else if (units === 'fractional-in') {
      result = formatFeet(value, precision, true, feetAndInchesSymbols);

    } else if (units === 'fractional-in^2') {
      result = formatFeet(value, precision, true, feetAndInchesSymbols) + getExponentSymbol(2);

    } else if (units === 'fractional-in^3') {
      result = formatFeet(value, precision, true, feetAndInchesSymbols) + getExponentSymbol(3);

    } else if (units === 'm-and-cm') {
      result = formatMeterAndCentimeter(value, precision);

    } else if (units === 'm-and-cm^2') {
      result = options.noMixedArea ?
      formatNumber(value, precision) + ' m' + getExponentSymbol(2) :
      formatMeterAndCentimeter(value, precision, 2);

    } else if (units === 'm-and-cm^3') {
      result = options.noMixedVolume ?
      formatNumber(value, precision) + ' m' + getExponentSymbol(3) :
      formatMeterAndCentimeter(value, precision, 3);

    } else if (units && units.text) {
      const formattedValue = type === 3 ? formatNumber(value, precision) : value;
      result = formatWithSymbol(formattedValue, units);

    } else if (type === 3 && units) {// Double, with units
      units = units.replace("^2", getExponentSymbol(2));
      units = units.replace("^3", getExponentSymbol(3));
      result = formatNumber(value, precision) + ' ' + units;

    } else if (units) {
      result = value + ' ' + units;

    } else if (type === 3) {// Double, no units
      result = formatNumber(value, precision);

    } else {
      result = value;
    }

  } catch (e) {

    if (units) {
      result = value + ' ' + units;
    } else {
      result = value;
    }
  }

  return result;
}

/**
 * @private
 * Converts a unit string from model metadata to standard format. The unit string can vary based on source product
 * and this function normalizes it.
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#fixUnitString
 */
function fixUnitString(unit) {
  unit = unit?.toLowerCase();
  //Why are translators not using standard strings for those?!?!?!?
  switch (unit) {
    case 'meter':
    case 'meters':
    case 'm':
      return ModelUnits.METER;
    case 'foot':
    case 'feet':
    case 'ft':
    case 'international foot':
    case 'international feet':
      return ModelUnits.FOOT;
    case 'sft':
    case 'ft-us':
    case 'survey ft':
    case 'us survey foot':
    case 'us survey feet':
      return ModelUnits.US_SURVEY_FOOT;
    case 'feet and inches':
    case 'inch':
    case 'inches':
    case 'in':
      return ModelUnits.INCH;
    case 'centimeter':
    case 'centimeters':
    case 'cm':
      return ModelUnits.CENTIMETER;
    case 'millimeter':
    case 'millimeters':
    case 'mm':
      return ModelUnits.MILLIMETER;
    case 'point':
    case 'points':
    case 'pt':
      return ModelUnits.POINT;
    default:
      return unit;
  }
}

/**
 * Returns an object that contains the standard unit string (unitString) and the scale value (unitScale).
 * @param {string} unit - Unit name from the metadata
 * @returns {object} this object contains the standardized unit string (unitString) and a unit scaling value (unitScale)
 *
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#getUnitData
 */
function getUnitData(unit)
{
  let unitString = fixUnitString(unit);
  return {
    unitString: unitString,
    unitScale: UnitScales[unitString] || 1.0
  };
}

/**
 * Convert distance from unit to unit.
 * @param {string} fromUnits - GNU units format - units to convert from
 * @param {string} toUnits - GNU units format - units to convert to
 * @param {number} calibrationFactor - Calibration Factor of the model
 * @param {number} d - distance to convert
 * @param {string} type - default for distance, "square" for area
 * @param {string} dpi - Used to convert points units. default is 72 DPI.
 * @memberof Autodesk.Viewing.Private
 * @alias Autodesk.Viewing.Private#convertUnits*
 * @returns {number} - distance after conversion.
 */
function convertUnits(fromUnits, toUnits, calibrationFactor, d, type, dpi) {

  fromUnits = fixUnitString(fromUnits);
  toUnits = fixUnitString(toUnits);

  calibrationFactor = calibrationFactor ? calibrationFactor : 1;
  dpi = dpi || 72;

  if (fromUnits === toUnits && calibrationFactor === 1)
  return d;

  const M = ModelUnits;
  const U = UnitScales;

  var toFactor = 1;
  switch (toUnits) {
    case M.MILLIMETER:toFactor = 1 / U[M.MILLIMETER];break;
    case M.CENTIMETER:toFactor = 1 / U[M.CENTIMETER];break;
    case M.METER:toFactor = 1;break;
    case M.INCH:toFactor = 1 / U[M.INCH];break;
    case M.FOOT:toFactor = 1 / U[M.FOOT];break;
    case M.US_SURVEY_FOOT:toFactor = 1 / U[M.US_SURVEY_FOOT];break;
    case "ft-and-fractional-in":toFactor = 1 / U[M.FOOT];break;
    case "ft-and-decimal-in":toFactor = 1 / U[M.FOOT];break;
    case "decimal-in":toFactor = 1 / U[M.INCH];break;
    case "decimal-ft":toFactor = 1 / U[M.FOOT];break;
    case "fractional-in":toFactor = 1 / U[M.INCH];break;
    case "m-and-cm":toFactor = 1;break;
    case M.POINT:toFactor = 1 / U[M.INCH] * dpi;break;
  }

  var fromFactor = 1;
  switch (fromUnits) {
    case M.MILLIMETER:fromFactor = U[M.MILLIMETER];break;
    case M.CENTIMETER:fromFactor = U[M.CENTIMETER];break;
    case M.METER:fromFactor = U[M.METER];break;
    case M.INCH:fromFactor = U[M.INCH];break;
    case M.FOOT:fromFactor = U[M.FOOT];break;
    case M.US_SURVEY_FOOT:fromFactor = U[M.US_SURVEY_FOOT];break;
    case "ft-and-fractional-in":fromFactor = U[M.FOOT];break;
    case "ft-and-decimal-in":fromFactor = U[M.FOOT];break;
    case "decimal-in":fromFactor = U[M.INCH];break;
    case "decimal-ft":fromFactor = U[M.FOOT];break;
    case "fractional-in":fromFactor = U[M.INCH];break;
    case "m-and-cm":fromFactor = 1;break;
    case M.POINT:fromFactor = U[M.INCH] / dpi;break;
  }

  if (type === "square") {
    return d ? d * Math.pow(toFactor * fromFactor * calibrationFactor, 2) : 0;
  } else if (type === "cube") {
    return d ? d * Math.pow(toFactor * fromFactor * calibrationFactor, 3) : 0;
  }
  return d ? d * toFactor * fromFactor * calibrationFactor : 0;
}

/**
 * Count the number of digits after the floating point of a given number.
 * If the numer is a fraction, count the power of 2 of the denominator.
 * @param {string | number} number.
 * @returns {number} - number of digits after the floating point of the given number.
 */

function calculatePrecision(number) {

  if (!number)
  return 0;

  var digits = number.toString().split(".")[1];

  // Try fractional number
  if (!digits) {
    var denominatorStrRaw = number.toString().split("/")[1];
    var denominatorNumberStr = denominatorStrRaw && denominatorStrRaw.match(/\d+/);
    if (denominatorNumberStr) {
      var denominator = parseFloat(denominatorNumberStr);
      if (denominator && !isNaN(denominator)) {
        return Math.floor(Math.log2(denominator));
      }
    }

    return 0;
  }
  digits = digits.match(/\d+/);
  return digits && digits[0] && digits[0].length || 0;
}


/**
 * Convert from source to target units
 * Only source units of type distance, area and volume will be converted.
 * For any other type, the source value is returned without conversion
 * @param {number} value
 * @param {number} valueType - For example: 1=boolean, 2=integer, 3=double, 20=string, 24=Position
 * @param {string} sourceUnits
 * @param {string} targetUnits
 */
function convertToDisplayUnits(value, valueType, sourceUnits, targetUnits) {
  if (!sourceUnits || !targetUnits) {
    return { displayValue: value, displayUnits: sourceUnits };
  }

  let baseUnits = sourceUnits;
  let displayUnits = targetUnits;

  // transform forge units
  const forgeUnits = forgeUnitToSymbol(baseUnits);
  if (typeof forgeUnits === 'object' && 'text' in forgeUnits) {
    baseUnits = forgeUnits.text;
  } else {
    baseUnits = forgeUnits;
  }

  if (baseUnits) {
    // take care of area and volume
    baseUnits = baseUnits.replace(/²$/, '^2').replace(/³$/, '^3');
  }

  // Area or volume?
  let distanceType;
  if (/\^2$/.test(baseUnits)) {
    baseUnits = baseUnits.replace('^2', '');
    displayUnits += '^2';
    distanceType = "square";
  } else if (/\^3$/.test(baseUnits)) {
    baseUnits = baseUnits.replace('^3', '');
    displayUnits += '^3';
    distanceType = "cube";
  }

  // Skip conversion if source unit is not a supported display unit
  // for e.g., mass and density
  baseUnits = (0,_DisplayUnits_js__WEBPACK_IMPORTED_MODULE_2__.getUnitEnum)(baseUnits);
  if (baseUnits === null) {
    return { displayValue: value, displayUnits: sourceUnits };
  }

  // Only convert numerical values
  if (valueType === 2 /*integer*/ || valueType === 3 /*double*/) {
    const displayValue = convertUnits(baseUnits, targetUnits, 1, value, distanceType, null);
    return { displayValue: displayValue, displayUnits: displayUnits };
  } else if (valueType === 24 /*position*/) {
    const position = value.
    split(' ').
    map((v) => convertUnits(baseUnits, targetUnits, 1, v, distanceType, null)).
    join(' ');

    return { displayValue: position, displayUnits: displayUnits };
  }


  return { displayValue: value, displayUnits: sourceUnits };
}

// Simplifies combined unit strings to just the main unit alone.
// Example: "ft-and-fractional-in" => "ft"
function getMainUnit(unit) {
  switch (unit) {
    case 'decimal-ft':
    case 'ft-and-fractional-in':
    case 'ft-and-decimal-in':
      return 'ft';

    case 'decimal-in':
    case 'fractional-in':
      return 'in';

    case 'm-and-cm':
      return 'm';
  }
  return unit;
}

/***/ },

/***/ "./src/wgs/scene/SceneMath.js"
/*!************************************!*\
  !*** ./src/wgs/scene/SceneMath.js ***!
  \************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SceneMath: () => (/* binding */ SceneMath)
/* harmony export */ });
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! three */ "three");
/* harmony import */ var three__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(three__WEBPACK_IMPORTED_MODULE_0__);




const normals = [
new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(1, 0, 0),
new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0, 1, 0),
new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0, 0, 1),
new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(-1, 0, 0),
new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0, -1, 0),
new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0, 0, -1)];


let plane = new (three__WEBPACK_IMPORTED_MODULE_0___default().Plane)();
const tmpTarget = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

// Returns an array of vector4 values that describe the cutplanes needed to apply a given sectionBox
function box2CutPlanes(box, transform) {

  let planeVecs = [];

  for (let i = 0; i < normals.length; i++) {

    plane.normal.copy(normals[i]);
    const onPlane = i < 3 ? box.max : box.min;
    plane.constant = -plane.normal.dot(onPlane);

    if (transform) {
      plane.applyMatrix4(transform);
    }

    planeVecs.push(new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector4)(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant));
  }

  return planeVecs;
}

// Compute pixels per unit parameter for 2D materials.
//  @param {Camera}  camera
//  @param {boolean} is2d
//  @param {Box3}    worldBox      - worldBox of all visible geometry
//  @param {number}  deviceHeight  - canvas height * pixelRatio
//  @param {Vector4} [cutPlane]    - Optional: A cutplane in 3D containing 2D geometry. If specified, its camera distance is
//                                   considered to determine pixelsPerUnit.
//  @param {Vector3} [modelBox]    - Only for 2D: The min-plane of this box is assumed as ground plane
function getPixelsPerUnit(camera, is2d, worldBox, deviceHeight, cutPlane, modelBox) {
  if (!camera.isPerspective) {
    // Since tan(fov/2) = 0.5 for orthographic camera, the equation can be simplified here
    return deviceHeight / camera.orthoScale;
  }

  let pt = worldBox.getCenter(new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)());
  let distance;
  if (is2d) {
    if (modelBox) {
      // If the modelBox was passed it makes more sense to base the scale on the
      // distance of the camera to the nearest part of the world bounding box
      distance = Math.sqrt(pointToBoxDistance2(camera.position, modelBox));
    } else {
      //Here we base pixel scale on the point at the center of the view.
      const worldUp = 'z'; // in 2d, world-up is always Z
      const ray = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0, 0, 1);
      const groundPt = intersectGroundViewport(ray, camera, worldUp);

      // Can be null in the degenerate case (camera direction parallel to the ground plane)
      if (groundPt) {
        pt = groundPt;
      }
      distance = camera.position.distanceTo(pt);
    }
  } else {
    if (cutPlane) {
      const p = cutPlane;

      const dir = camera.target.clone().sub(camera.position).normalize();
      const denominator = dir.dot(p);

      if (denominator !== 0) {
        const t = -(camera.position.clone().dot(p) + p.w) / denominator;
        pt = worldBox.clampPoint(dir.multiplyScalar(t).add(camera.position), pt);
      }
    }

    distance = camera.position.distanceTo(pt);
  }

  return deviceHeight / (2 * distance * Math.tan(three__WEBPACK_IMPORTED_MODULE_0___default().Math.degToRad(camera.fov * 0.5)));
}

// Note: The camera world matrix must be up-to-date
//  @param {Vec3d}  vpVec         - ray direction in viewport coords
//  @param {Camera} camera
//  @param {string} worldUp       - main axis of up-vector, i.e., "x", "y", or "z".
//  @param {Box3}   modelBox      - Used to derive min-elevation (where ground is assumed)
function intersectGroundViewport(vpVec, camera, worldUpName, modelBox) {

  var vector = vpVec;

  // set two vectors with opposing z values
  vector.z = -1.0;
  var end = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(vector.x, vector.y, 1.0);
  vector = vector.unproject(camera);
  end = end.unproject(camera);

  // find direction from vector to end
  end.sub(vector).normalize();

  var dir = end;

  //Is the direction parallel to the ground plane?
  //Then we fail.
  if (Math.abs(dir[worldUpName]) < 1e-6)
  return null;

  var rayOrigin;
  if (camera.isPerspective) {
    rayOrigin = camera.position;
  } else {
    rayOrigin = vector;
  }

  var baseElev = modelBox ? modelBox.min[worldUpName] : 0;
  var distance = (baseElev - rayOrigin[worldUpName]) / dir[worldUpName];

  //2D drawing, intersect the plane
  dir.multiplyScalar(distance);
  dir.add(rayOrigin);

  return dir;
}


/**
 * Returns a new matrix that transforms points from the loaded 2D model
 * into a normalized coordinate space [0..1].
 *
 * @param {THREE.Box3} bbox - Optional - Compute the normalizing matrix according to the given bounding box.
 *
 * @returns {THREE.Matrix4}
 * @private
 */
function getNormalizingMatrix(model, bbox) {

  bbox = bbox || model.getData().bbox;

  var trans = new (three__WEBPACK_IMPORTED_MODULE_0___default().Matrix4)();
  trans.makeTranslation(-bbox.min.x, -bbox.min.y, -bbox.min.z);

  var delta = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)(0, 0, 0).subVectors(bbox.max, bbox.min);
  var scale = new (three__WEBPACK_IMPORTED_MODULE_0___default().Matrix4)();
  scale.makeScale(1 / delta.x, 1 / delta.y, 1);

  var res = new (three__WEBPACK_IMPORTED_MODULE_0___default().Matrix4)();
  res.multiplyMatrices(scale, trans);
  return res;
}


// @param {THREE.Vector3} p
// @param {THREE.Vector3} bboxMin
// @param {THREE.Vector3} bboxMax
// @returns {Number} Squared distance of the bbox to p
function pointToMinMaxBoxDistance2(p, boxMin, boxMax) {

  // compute the point within bbox that is nearest to p by clamping against box
  var nearest = p.clone();
  nearest.max(boxMin);
  nearest.min(boxMax);

  // return squared length of the difference vector
  return nearest.distanceToSquared(p);
}

// @param {THREE.Vector3} p
// @param {THREE.Box3} bboxMin
// @returns {Number} Squared distance of the bbox to p
function pointToBoxDistance2(p, box) {
  return pointToMinMaxBoxDistance2(p, box.min, box.max);
}

/**
 * Reference: https://git.autodesk.com/BIM360/visualization-schemas/blob/60e6c19b6da27bd4541cc721518f004699eae59e/autodesk.viewer_state-3.0.0.yaml#L30
 * @param {THREE.Vector3} camPosition - camera position
 * @param {THREE.Vector3} camTarget - camera target point
 * @param {THREE.Vector3} camUp - camera up direction
 * @returns {THREE.Quaternion} - The rotation applied to the default camera to get correct view direction.
 */
function getCameraRotationAsQuat(camPosition, camTarget, camUp) {
  const targetCS = new (three__WEBPACK_IMPORTED_MODULE_0___default().Matrix4)().lookAt(camPosition, camTarget, camUp.clone().normalize());
  const cameraRotation = new (three__WEBPACK_IMPORTED_MODULE_0___default().Quaternion)().setFromRotationMatrix(targetCS);
  return cameraRotation;
}

/**
 * @param {THREE.Vector3} position - camera position
 * @param {THREE.Vector3} target - camera target point
 * @returns {number} - The distance from the camera eye to target.
 */
function getCameraTargetDistance(position, target) {
  const at = target.clone().sub(position);
  return at.length();
}

/**
 * Computes the shortest distance between two triangles.
 *
 * @param {THREE.Triangle} triangleA - The first triangle.
 * @param {THREE.Triangle} triangleB - The second triangle.
 * @returns {Object} An object containing the closest points and the distance between the two triangles.
 */
function shortestDistanceBetweenTriangles(triangleA, triangleB) {
  let minSquaredDistance = Infinity;
  let closestPointA = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  let closestPointB = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  const tVector3A = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();
  const tVector3B = new (three__WEBPACK_IMPORTED_MODULE_0___default().Vector3)();

  // Test 1: Vertices of triangle A against triangle B
  const verticesA = [triangleA.a, triangleA.b, triangleA.c];
  for (const vertex of verticesA) {
    triangleB.closestPointToPoint(vertex, tVector3A);
    const squaredDistance = vertex.distanceToSquared(tVector3A);
    if (squaredDistance < minSquaredDistance) {
      minSquaredDistance = squaredDistance;
      closestPointA.copy(vertex);
      closestPointB.copy(tVector3A);
    }
  }

  // Test 2: Vertices of triangle B against triangle A
  const verticesB = [triangleB.a, triangleB.b, triangleB.c];
  for (const vertex of verticesB) {
    triangleA.closestPointToPoint(vertex, tVector3B);
    const squaredDistance = vertex.distanceToSquared(tVector3B);
    if (squaredDistance < minSquaredDistance) {
      minSquaredDistance = squaredDistance;
      closestPointA.copy(tVector3B);
      closestPointB.copy(vertex);
    }
  }

  // Test 3: Edge-to-Edge
  const edgesA = [
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Line3)(triangleA.a, triangleA.b),
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Line3)(triangleA.b, triangleA.c),
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Line3)(triangleA.c, triangleA.a)];


  const edgesB = [
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Line3)(triangleB.a, triangleB.b),
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Line3)(triangleB.b, triangleB.c),
  new (three__WEBPACK_IMPORTED_MODULE_0___default().Line3)(triangleB.c, triangleB.a)];


  for (const edgeA of edgesA) {
    for (const edgeB of edgesB) {
      const squaredDistance = edgeA.distanceSqToLine3(edgeB, tVector3A, tVector3B);
      if (squaredDistance < minSquaredDistance) {
        minSquaredDistance = squaredDistance;
        closestPointA.copy(tVector3A);
        closestPointB.copy(tVector3B);
      }
    }
  }
  return {
    pointA: closestPointA,
    pointB: closestPointB,
    distance: Math.sqrt(minSquaredDistance)
  };
}

let SceneMath = {
  box2CutPlanes,
  getPixelsPerUnit,
  intersectGroundViewport,
  getNormalizingMatrix,
  pointToMinMaxBoxDistance2,
  pointToBoxDistance2,
  getCameraRotationAsQuat,
  getCameraTargetDistance,
  shortestDistanceBetweenTriangles
};

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Measure/Calibration.css"
/*!********************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Measure/Calibration.css ***!
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



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:application/octet-stream;base64,d09GRgABAAAAAAtYAA8AAAAAE7QAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABWAAAADsAAABUIIwleU9TLzIAAAGUAAAAQgAAAFZWgGFpY21hcAAAAdgAAABOAAABcAGIBM1jdnQgAAACKAAAABMAAAAgBtX/BGZwZ20AAAI8AAAFkAAAC3CKkZBZZ2FzcAAAB8wAAAAIAAAACAAAABBnbHlmAAAH1AAAAOQAAADkZyzZ8WhlYWQAAAi4AAAAMQAAADYL0YfIaGhlYQAACOwAAAAcAAAAJAc7A1VobXR4AAAJCAAAAAgAAAAIBvL//2xvY2EAAAkQAAAABgAAAAYAcgAAbWF4cAAACRgAAAAgAAAAIADpC8puYW1lAAAJOAAAAXcAAALNzJ0cHnBvc3QAAAqwAAAAKgAAADsMvKbDcHJlcAAACtwAAAB6AAAAhuVBK7x4nGNgZGBg4GIwYLBjYMpJLMlj4HNx8wlhkGJgYYAAkDwymzEnMz2RgQPGA8qxgGkOIGaDiAIAKVkFSAB4nGNgZK5knMDAysDAVMW0h4GBoQdCMz5gMGRkAooysDIzYAUBaa4pDA4MiQyJzEH/sxiimIMYpgGFGUFyAM95CpgAAHicY2BgYGVgYGAGYh0gZmFgYAxhYGQAAT+gKCNYnJmBCyzOwqAEVsMCFk/8/x9OMoJ0gkQZ2RhoDxjpYAclgAdMykB54LCCYkYA4LUHVgAAeJxjYEADEhDIHPQ/C4QBEmwD3QB4nK1WaXfTRhQdeUmchCwlCy1qYcTEabBGJmzBgAlBsmMgXZytlaCLFDvpvvGJ3+Bf82Tac+g3flrvGy8kkLTncJqTo3fnzdXM22USWpLYC+uRlJsvxdTWJo3sPAnphk3LUXwoO3shZYrJ3wVREK2W2rcdh0REIlC1rrBEEPseWZpkfOhRRsu2pFdNyi096S5b40G9Vd9+GjrKsTuhpGYzdGg9siVVGFWiSKY9UtKmZaj6K0krvL/CzFfNUMKITiJpvBnG0EjeG2e0ymg1tuMoimyy3ChSJJrhQRR5lNUS5+SKCQzKB82Q8sqnEeXD/Iis2KOcVrBLttP8vi95p3c5P7Ffb1G25EAfyI7s4Ox0JV+EW1th3LST7ShUEXbXd0Js2exU/2aP8ppGA7crMr3QjGCpfIUQKz+hzP4hWS2cT/mSR6NaspETQetlTuxLPoHW44gpcc0YWdDd0QkR1P2SMwz2mD4e/PHeKZYLEwJ4HMt6RyWcCBMpYXM0SdowcmAlZYsqqfWumDjldVrEW8J+7drRl85o41B3YjxbDx1bOVHJ8WhSp5lMndpJzaMpDaKUdCZ4zK8DKD+iSV5tYzWJlUfTOGbGhEQiAi3cS1NBLDuxpCkEzaMZvbkbprl2LVqkyQP13KP39OZWuLnTU9oO9LNGf1anYjrYC9PpaeQv8Wna5SJF6frpGX5M4kHWAjKRLTbDlIMHb/0O0svXlhyF1wbY7u3zK6h91kTwpAH7G9AeT9UpCUyFmFWIVkBirWtZlsnVrBapyNR3Q5pWvqzTBIpyHBfHvoxx/V8zM5aYEr7fidOzIy49c+1LCNMcfJt1PZrXqcVyAXFmeU6nWZbv6zTH8gOd5lme1+kIS1unoyw/1GmB5Uc6HWN5QQuadN/BkIsw5AIOkDCEpQNDWF6CISwVDGG5CENYFmEIyyUYwvJjGMJyGYawvKxl1dRTSePamVgGbEJgYo4eucxF5WoquVRCu2hUakOeEm6VVBTPqn9loF488oY5sBZIl8iaXzHOlY9G5fjWFS1vGjtXwLHqbx+O9jnxUtaLhT8F/9XWVCW9Ys3Dk6vwG4aebCeqNql4dE2Xz1U9uv5fVFRYC/QbSIVYKMqybHBnIoSPOp2GaqCVQ8xszDy063XLmp/D/TcxQhZQ/fg3FBoL3INOWUlZ7eCs1dfbstw7g3I4EyxJMTfz+lb4IiOz0n6RWcqej3wecAWMSmXYagOtFbzZJzEPmd4kzwRxW1E2SNrYzgSJDRzzgHnznQQmYeqqDeRO4YYN+AVhbsF5J1yieqMsh+5F7PMopPxbp+JE9qhojMCz2Rthr+9Cym9xDCQ0+aV+DFQVoakYNRXQNFJuqAZfxtm6bULGDvQjKnbDsqziw8cW95WSbRmEfKSI1aOjn9Zeok6q3H5mFJfvnb4FwSA1MX9733RxkMq7WskyR20DU7calVPXmkPjVYfq5lH1vePsEzlrmm66Jx56X9Oq28HFXCyw9m0O0lImF9T1YYUNosvFpVDqZTRJ77gHGBYY0O9Qio3/q/rYfJ4rVYXRcSTfTtS30edgDPwP2H9H9QPQ92Pocg0uz/eaE59u9OFsma6iF+un6Dcwa625WboG3NB0A+IhR62OuMoNfKcGcXqkuRzpIeBj3RXiAcAmgMXgE921jOZTAKP5jDk+wOfMYdBkDoMt5jDYZs4awA5zGOwyh8Eecxh8wZx1gC+ZwyBkDoOIOQyeMCcAeMocBl8xh8HXzGHwDXPuA3zLHAYxcxgkzGGwr+nWMMwtXtBdoLZBVaADU09Y3MPiUFNlyP6OF4b9vUHM/sEgpv6o6faQ+hMvDPVng5j6i0FM/VXTnSH1N14Y6u8GMfUPg5j6TL8Yy2UGv4x8lwoHlF1sPufvifcP28VAuQABAAH//wAPAAP///+TAwoDUgAlAC4AMQBJQEYkAQIGBQFHFhUQDwQBRAAHBgAGBwBtCAQCAAMCAgEAAVwKAQYGBVYJAQUFDAZJJyYAADEwKyomLicuACUAJSMkFCQXCwUZKwEVDgEVFBcDIw4BHgE7AQcXPwEhHwE3JzMyNjQmKwEDNjU0Jic1BzIWFAYiJjQ2FxMhAVgoNA7ANAoNAg0KHh4LXEABjUBbDB4eCQ4OCTLADTMoLhMbGyYaGhOw/qEDUm8ORyweHP5EAQ0UDERnLn19LmdEDRQNAbwaICxHDm/CGyYaGiYbzv6qeJxjYGRgYABiNfd3DvH8Nl8ZuJlfAEUYrqQu/A+jgWAy8wvmICCXg4EJJAoAgCEOvwAAAHicY2BkYGAO+p8FJF/8/w8iGYAiKIAJAIvHBZcD6AAAAwr//wAAAAAAcgAAAAEAAAACADIAAwAAAAAAAgAWACYAcwAAAFoLcAAAAAB4nHWQy07CQBSG/5GLCokaTdw6KwMxlksiCxISEgxsdEMMW1NKaUtKh0wHEl7Dd/BhfAmfxZ92MAZim+l855szZ04HwDW+IZA/Txw5C5wxyvkEp+hZLtA/Wy6SXyyXUMWb5TL9u+UKHhBYruIGH6wgiueMFvi0LHAlLi2f4ELcWS7QP1ouknuWS7gVr5bL9J7lCiYitVzFvfgaqNVWR0FoZG1Ql+1mqyOnW6moosSNpbs2odKp7Mu5Sowfx8rx1HLPYz9Yx67eh/t54us0UolsOc29GvmJr13jz3bV003QNmYu51ot5dBmyJVWC98zTmjMqtto/D0PAyissIVGxKsKYSBRo61zbqOJFjqkKTMkM/OsCAlcxDQu1twRZisp4z7HnFFC6zMjJjvw+F0e+TEp4P6YVfTR6mE8Ie3OiDIv2ZfD7g6zRqQky3QzO/vtPcWGp7VpDXftutRZVxLDgxqS97FbW9B49E52K4a2iwbff/7vB+NphE8AeJxjYGKAAC4G7ICJkYmRmUEwOTEnM6kosSQzPy++PCOzJJWBAQBRdwcvAAB4nGPw3sFwIihiIyNjX+QGxp0cDBwMyQUbGVidNjEwMmiBGJu5mBg5ICw+BjCLzWkX0wGgNCeQze60i8EBwmZmcNmowtgRGLHBoSNiI3OKy0Y1EG8XRwMDI4tDR3JIBEhJJBBs5mFi5NHawfi/dQNL70YmBhcADHYj9AAA */ "data:application/octet-stream;base64,d09GRgABAAAAAAtYAA8AAAAAE7QAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABWAAAADsAAABUIIwleU9TLzIAAAGUAAAAQgAAAFZWgGFpY21hcAAAAdgAAABOAAABcAGIBM1jdnQgAAACKAAAABMAAAAgBtX/BGZwZ20AAAI8AAAFkAAAC3CKkZBZZ2FzcAAAB8wAAAAIAAAACAAAABBnbHlmAAAH1AAAAOQAAADkZyzZ8WhlYWQAAAi4AAAAMQAAADYL0YfIaGhlYQAACOwAAAAcAAAAJAc7A1VobXR4AAAJCAAAAAgAAAAIBvL//2xvY2EAAAkQAAAABgAAAAYAcgAAbWF4cAAACRgAAAAgAAAAIADpC8puYW1lAAAJOAAAAXcAAALNzJ0cHnBvc3QAAAqwAAAAKgAAADsMvKbDcHJlcAAACtwAAAB6AAAAhuVBK7x4nGNgZGBg4GIwYLBjYMpJLMlj4HNx8wlhkGJgYYAAkDwymzEnMz2RgQPGA8qxgGkOIGaDiAIAKVkFSAB4nGNgZK5knMDAysDAVMW0h4GBoQdCMz5gMGRkAooysDIzYAUBaa4pDA4MiQyJzEH/sxiimIMYpgGFGUFyAM95CpgAAHicY2BgYGVgYGAGYh0gZmFgYAxhYGQAAT+gKCNYnJmBCyzOwqAEVsMCFk/8/x9OMoJ0gkQZ2RhoDxjpYAclgAdMykB54LCCYkYA4LUHVgAAeJxjYEADEhDIHPQ/C4QBEmwD3QB4nK1WaXfTRhQdeUmchCwlCy1qYcTEabBGJmzBgAlBsmMgXZytlaCLFDvpvvGJ3+Bf82Tac+g3flrvGy8kkLTncJqTo3fnzdXM22USWpLYC+uRlJsvxdTWJo3sPAnphk3LUXwoO3shZYrJ3wVREK2W2rcdh0REIlC1rrBEEPseWZpkfOhRRsu2pFdNyi096S5b40G9Vd9+GjrKsTuhpGYzdGg9siVVGFWiSKY9UtKmZaj6K0krvL/CzFfNUMKITiJpvBnG0EjeG2e0ymg1tuMoimyy3ChSJJrhQRR5lNUS5+SKCQzKB82Q8sqnEeXD/Iis2KOcVrBLttP8vi95p3c5P7Ffb1G25EAfyI7s4Ox0JV+EW1th3LST7ShUEXbXd0Js2exU/2aP8ppGA7crMr3QjGCpfIUQKz+hzP4hWS2cT/mSR6NaspETQetlTuxLPoHW44gpcc0YWdDd0QkR1P2SMwz2mD4e/PHeKZYLEwJ4HMt6RyWcCBMpYXM0SdowcmAlZYsqqfWumDjldVrEW8J+7drRl85o41B3YjxbDx1bOVHJ8WhSp5lMndpJzaMpDaKUdCZ4zK8DKD+iSV5tYzWJlUfTOGbGhEQiAi3cS1NBLDuxpCkEzaMZvbkbprl2LVqkyQP13KP39OZWuLnTU9oO9LNGf1anYjrYC9PpaeQv8Wna5SJF6frpGX5M4kHWAjKRLTbDlIMHb/0O0svXlhyF1wbY7u3zK6h91kTwpAH7G9AeT9UpCUyFmFWIVkBirWtZlsnVrBapyNR3Q5pWvqzTBIpyHBfHvoxx/V8zM5aYEr7fidOzIy49c+1LCNMcfJt1PZrXqcVyAXFmeU6nWZbv6zTH8gOd5lme1+kIS1unoyw/1GmB5Uc6HWN5QQuadN/BkIsw5AIOkDCEpQNDWF6CISwVDGG5CENYFmEIyyUYwvJjGMJyGYawvKxl1dRTSePamVgGbEJgYo4eucxF5WoquVRCu2hUakOeEm6VVBTPqn9loF488oY5sBZIl8iaXzHOlY9G5fjWFS1vGjtXwLHqbx+O9jnxUtaLhT8F/9XWVCW9Ys3Dk6vwG4aebCeqNql4dE2Xz1U9uv5fVFRYC/QbSIVYKMqybHBnIoSPOp2GaqCVQ8xszDy063XLmp/D/TcxQhZQ/fg3FBoL3INOWUlZ7eCs1dfbstw7g3I4EyxJMTfz+lb4IiOz0n6RWcqej3wecAWMSmXYagOtFbzZJzEPmd4kzwRxW1E2SNrYzgSJDRzzgHnznQQmYeqqDeRO4YYN+AVhbsF5J1yieqMsh+5F7PMopPxbp+JE9qhojMCz2Rthr+9Cym9xDCQ0+aV+DFQVoakYNRXQNFJuqAZfxtm6bULGDvQjKnbDsqziw8cW95WSbRmEfKSI1aOjn9Zeok6q3H5mFJfvnb4FwSA1MX9733RxkMq7WskyR20DU7calVPXmkPjVYfq5lH1vePsEzlrmm66Jx56X9Oq28HFXCyw9m0O0lImF9T1YYUNosvFpVDqZTRJ77gHGBYY0O9Qio3/q/rYfJ4rVYXRcSTfTtS30edgDPwP2H9H9QPQ92Pocg0uz/eaE59u9OFsma6iF+un6Dcwa625WboG3NB0A+IhR62OuMoNfKcGcXqkuRzpIeBj3RXiAcAmgMXgE921jOZTAKP5jDk+wOfMYdBkDoMt5jDYZs4awA5zGOwyh8Eecxh8wZx1gC+ZwyBkDoOIOQyeMCcAeMocBl8xh8HXzGHwDXPuA3zLHAYxcxgkzGGwr+nWMMwtXtBdoLZBVaADU09Y3MPiUFNlyP6OF4b9vUHM/sEgpv6o6faQ+hMvDPVng5j6i0FM/VXTnSH1N14Y6u8GMfUPg5j6TL8Yy2UGv4x8lwoHlF1sPufvifcP28VAuQABAAH//wAPAAP///+TAwoDUgAlAC4AMQBJQEYkAQIGBQFHFhUQDwQBRAAHBgAGBwBtCAQCAAMCAgEAAVwKAQYGBVYJAQUFDAZJJyYAADEwKyomLicuACUAJSMkFCQXCwUZKwEVDgEVFBcDIw4BHgE7AQcXPwEhHwE3JzMyNjQmKwEDNjU0Jic1BzIWFAYiJjQ2FxMhAVgoNA7ANAoNAg0KHh4LXEABjUBbDB4eCQ4OCTLADTMoLhMbGyYaGhOw/qEDUm8ORyweHP5EAQ0UDERnLn19LmdEDRQNAbwaICxHDm/CGyYaGiYbzv6qeJxjYGRgYABiNfd3DvH8Nl8ZuJlfAEUYrqQu/A+jgWAy8wvmICCXg4EJJAoAgCEOvwAAAHicY2BkYGAO+p8FJF/8/w8iGYAiKIAJAIvHBZcD6AAAAwr//wAAAAAAcgAAAAEAAAACADIAAwAAAAAAAgAWACYAcwAAAFoLcAAAAAB4nHWQy07CQBSG/5GLCokaTdw6KwMxlksiCxISEgxsdEMMW1NKaUtKh0wHEl7Dd/BhfAmfxZ92MAZim+l855szZ04HwDW+IZA/Txw5C5wxyvkEp+hZLtA/Wy6SXyyXUMWb5TL9u+UKHhBYruIGH6wgiueMFvi0LHAlLi2f4ELcWS7QP1ouknuWS7gVr5bL9J7lCiYitVzFvfgaqNVWR0FoZG1Ql+1mqyOnW6moosSNpbs2odKp7Mu5Sowfx8rx1HLPYz9Yx67eh/t54us0UolsOc29GvmJr13jz3bV003QNmYu51ot5dBmyJVWC98zTmjMqtto/D0PAyissIVGxKsKYSBRo61zbqOJFjqkKTMkM/OsCAlcxDQu1twRZisp4z7HnFFC6zMjJjvw+F0e+TEp4P6YVfTR6mE8Ie3OiDIv2ZfD7g6zRqQky3QzO/vtPcWGp7VpDXftutRZVxLDgxqS97FbW9B49E52K4a2iwbff/7vB+NphE8AeJxjYGKAAC4G7ICJkYmRmUEwOTEnM6kosSQzPy++PCOzJJWBAQBRdwcvAAB4nGPw3sFwIihiIyNjX+QGxp0cDBwMyQUbGVidNjEwMmiBGJu5mBg5ICw+BjCLzWkX0wGgNCeQze60i8EBwmZmcNmowtgRGLHBoSNiI3OKy0Y1EG8XRwMDI4tDR3JIBEhJJBBs5mFi5NHawfi/dQNL70YmBhcADHYj9AAA"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `@font-face {
  font-family: "calibration-icon";
  src: url(${___CSS_LOADER_URL_REPLACEMENT_0___}) format("woff");
  font-weight: normal;
  font-style: normal;
}
[class^=calibration-icon], [class*=" calibration-icon"] {
  font-family: "calibration-icon";
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  line-height: 1;
  padding-top: 2px;
  speak: none;
  text-transform: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.adsk-viewing-viewer .calibration-icon:before {
  content: "a";
}

.adsk-viewing-viewer .calibration-panel {
  left: calc(50% - 190px);
  top: calc(50% - 145px);
  width: 380px;
  height: auto;
  z-index: 4;
}

.adsk-viewing-viewer .calibration-panel .calibration-table {
  padding-left: 24px;
  padding-right: 24px;
  margin-top: 12px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

.adsk-viewing-viewer .measure-settings-popup .option-drop-down,
.adsk-viewing-viewer .calibration-panel .option-drop-down {
  width: 100%;
  padding-right: 0px;
  box-sizing: border-box;
}

.adsk-viewing-viewer .measure-settings-popup .adsk-lmv-tftable tr td,
.adsk-viewing-viewer .calibration-panel .adsk-lmv-tftable tr td {
  width: auto;
  padding: 2px 0px 2px 0px;
  height: 56px;
  font-size: 14px;
}

.adsk-viewing-viewer .calibration-panel .adsk-lmv-tftable tr td div {
  padding: 0px;
}

.adsk-viewing-viewer .calibration-panel .adsk-lmv-tftable tr td input {
  margin: 0px;
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  font-size: 14px;
}

.adsk-viewing-viewer .calibration-panel .adsk-lmv-tftable tr td select {
  height: 36px;
  font-size: 14px;
}

.adsk-viewing-viewer .measure-settings-popup .switch {
  margin-left: 25px;
}

.adsk-viewing-viewer .measure-settings-popup .switch .slider {
  width: 26px;
}

.adsk-viewing-viewer .calibration-textbox::-webkit-inner-spin-button,
.adsk-viewing-viewer .calibration-textbox::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.adsk-viewing-viewer .calibration-text {
  text-align: left;
  padding: 6px 10px 6px 10px;
  margin: 20px 20px 14px 20px;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}

.adsk-viewing-viewer .calibration-button {
  margin-top: 15px;
}

.adsk-viewing-viewer .calibration-button-left {
  width: calc(50% - 15px);
  margin-right: 5px !important;
  display: inline-block;
}

.adsk-viewing-viewer .calibration-button-right {
  width: calc(50% - 15px);
  margin-left: 5px !important;
  display: inline-block;
}

.adsk-viewing-viewer .calibration-line {
  position: absolute;
  display: block;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
}

.adsk-viewing-viewer .calibration-label {
  display: none;
  position: absolute;
  pointer-events: none;
  text-align: "center";
  vertical-align: middle;
  cursor: default;
  padding: 2px;
  color: #000000;
  background: #FFFFFF;
  border-radius: 10px;
  -webkit-transform-origin: 50% 53%;
}

.adsk-viewing-viewer .calibration-label-text {
  display: inline-block;
  pointer-events: none;
  text-align: "center";
  vertical-align: middle;
  font-size: 12px;
  cursor: default;
  padding: 2px;
  color: #000000;
  background: #FFFFFF;
  border-bottom: 1px dashed #000000;
  text-decoration: none;
  text-transform: uppercase;
  -webkit-font-smoothing: antialiased;
}

.adsk-viewing-viewer .calibration-label-text:hover {
  color: #039be5;
  border-bottom: 1px dashed #039be5;
}

.adsk-viewing-viewer .calibration-label.visible {
  display: block;
}

.adsk-viewing-viewer .calibration-endpoint:hover.calibration-endpoint.enable-hover,
.adsk-viewing-viewer .calibration-endpoint.edit {
  background-color: #039be5;
}

.adsk-viewing-viewer .calibration-endpoint:hover.calibration-endpoint.enable-hover > *,
.adsk-viewing-viewer .calibration-endpoint.edit > * {
  color: #ffffff;
}

.adsk-viewing-viewer .calibration-endpoint.editable {
  pointer-events: all;
}

.adsk-viewing-viewer .calibration-endpoint {
  display: none;
  position: absolute;
  cursor: move;
  pointer-events: none;
  width: 30px;
  height: 30px;
  background-color: #ffffff;
  box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.24), 0 0 8px 0 rgba(0, 0, 0, 0.12);
  -moz-border-radius: 50px;
  -webkit-border-radius: 50px;
  border-radius: 50px;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.adsk-viewing-viewer .calibration-endpoint.visible {
  display: block;
}

.adsk-viewing-viewer .calibration-endpoint-text {
  display: inline-block;
  font-size: 14px;
  vertical-align: middle;
  cursor: default;
  margin: 5px 5px 5px 5px;
  vertical-align: middle;
  text-align: center;
  color: #039be5;
  text-decoration: none;
  text-transform: uppercase;
  pointer-events: none;
}

.adsk-viewing-viewer .calibration-panel .docking-panel-footer {
  padding: 16px 24px;
  display: flex;
  justify-content: flex-end;
  text-align: center;
  position: relative;
  height: auto;
}

.adsk-viewing-viewer .calibration-panel .docking-panel-footer .docking-panel-secondary-button,
.adsk-viewing-viewer .calibration-panel .docking-panel-footer .docking-panel-primary-button {
  padding: 0px 16px;
  margin: 0px 0px 0px 8px;
  font-size: 14px;
}

.adsk-viewing-viewer .calibration-panel .docking-panel-title {
  padding-top: 19px;
  padding-bottom: 19px;
}

.adsk-viewing-viewer .calibration-panel .docking-panel-close {
  margin-top: 7.5px;
}`, ""]);
// Exports
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);


/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Measure/Measure.css"
/*!****************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Measure/Measure.css ***!
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
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/getUrl.js */ "./node_modules/css-loader/dist/runtime/getUrl.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);
// Imports



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkEwMDhBMzY4QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkEwMDhBMzY5QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTAwOEEzNjZBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTAwOEEzNjdBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6WHWu4AAAAcElEQVR42mL8//8/AzmAiYFMgEtjGSFDcUmGAfEEIOYix6lWQLwUiGXJ8SNI00IgNiIncPiAeCoQ+5ITqsxQA+CAhQhN34C4AoiPkaLxGRAXAfEdUvx4DohjsGkCA1CSw4LrgZgVhxwYM9I9rQIEGACZNDs01yUXlAAAAABJRU5ErkJggg== */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkEwMDhBMzY4QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkEwMDhBMzY5QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTAwOEEzNjZBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTAwOEEzNjdBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6WHWu4AAAAcElEQVR42mL8//8/AzmAiYFMgEtjGSFDcUmGAfEEIOYix6lWQLwUiGXJ8SNI00IgNiIncPiAeCoQ+5ITqsxQA+CAhQhN34C4AoiPkaLxGRAXAfEdUvx4DohjsGkCA1CSw4LrgZgVhxwYM9I9rQIEGACZNDs01yUXlAAAAABJRU5ErkJggg=="), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkE3QzFFQUQ1QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkE3QzFFQUQ2QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTdDMUVBRDNBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTdDMUVBRDRBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6XuY60AAAARklEQVR42mL8//8/AzmAiYFMQBeNqSg8kB+JwKlAfAZZjIlIm9JJdSpWTYQ04tSETyNeTbg0EtSETSNRmkCAcegkOYAAAwDGjDZHvY373AAAAABJRU5ErkJggg== */ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkE3QzFFQUQ1QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkE3QzFFQUQ2QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTdDMUVBRDNBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTdDMUVBRDRBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6XuY60AAAARklEQVR42mL8//8/AzmAiYFMQBeNqSg8kB+JwKlAfAZZjIlIm9JJdSpWTYQ04tSETyNeTbg0EtSETSNRmkCAcegkOYAAAwDGjDZHvY373AAAAABJRU5ErkJggg=="), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_2___ = new URL(/* asset import */ __webpack_require__(/*! res/icon-spinner-sm.svg */ "./extensions/Measure/res/icon-spinner-sm.svg"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);
var ___CSS_LOADER_URL_REPLACEMENT_2___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_2___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `/* hover shouldn't work on mobile devices */
.adsk-viewing-viewer .measure-length:hover.measure-length.enable-hover {
  box-shadow: 0 0 16px 3px rgba(0, 117, 210, 0.7);
  -webkit-box-shadow: 0 0 16px 3px rgba(0, 117, 210, 0.7);
  -moz-box-shadow: 0 0 16px 3px rgba(0, 117, 210, 0.7);
}

.adsk-viewing-viewer .measure-length {
  display: none;
  position: absolute;
  height: 19px;
  left: 0px;
  top: 0px;
  padding: 2px 0 2px 0;
  background-color: #009bea;
  box-shadow: 0px 1px 3px 1px rgba(0, 0, 0, 0.25);
  color: #f4f4f4;
  font-size: 12px;
  text-align: center;
  line-height: 1.2;
  white-space: nowrap;
  border-radius: 8px;
  pointer-events: none;
  cursor: pointer;
  z-index: 2;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}

.adsk-viewing-viewer .measure-length.visible {
  display: block;
}

.adsk-viewing-viewer .measure-length.fetching-topology {
  background-color: rgba(34, 34, 34, 0.8);
  box-shadow: 0 0.5px 1.5px 0 rgba(0, 0, 0, 0.3);
}

.adsk-viewing-viewer .measure-length-text {
  display: inline-block;
  margin: 0 5px 0 5px;
  vertical-align: middle;
  font-size: 16px;
  pointer-events: none;
}

/* Area measurement text */
.adsk-viewing-viewer .info-popup-text {
  display: inline-block;
  margin: 0 5px 0 5px;
  vertical-align: middle;
  font-size: 15px;
  pointer-events: none;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  text-align: center;
  width: 100%;
}

/* Area measurement container */
.adsk-viewing-viewer .measure-area,
.adsk-viewing-viewer .info-popup {
  display: none;
  align-items: center;
  padding: 8px;
  gap: 8px;
  position: absolute;
  max-width: 350px;
  min-width: 170px;
  height: 36px;
  left: 50%;
  top: 100px;
  transform: translate(-50%);
  /* Charcoal/charcoal-900 */
  color: #FFFFFF;
  background: #3C3C3C;
  border-radius: 5px;
}

.adsk-viewing-viewer .info-popup-button {
  margin-right: 8px;
  border: 1px solid #FFFFFF;
  border-radius: 2px;
  padding: 8px 16px;
  /* Charcoal/charcoal-900 */
  color: #FFFFFF;
  background: #3C3C3C;
}

.adsk-viewing-viewer .measure-area.visible,
.adsk-viewing-viewer .info-popup.visible {
  display: flex;
}

.adsk-viewing-viewer .measure-label-value,
.adsk-viewing-viewer .measure-delta-text {
  margin: 0 5px 0 5px;
  align-self: center;
  font-size: 14px;
  overflow: hidden;
  white-space: nowrap;
  height: 16px;
  line-height: 16px;
  vertical-align: middle;
  pointer-events: none;
}

.adsk-viewing-viewer .measure-length-button {
  display: inline-block;
  width: 16px;
  height: 16px;
  font-size: 16px;
  float: right;
  color: #FFFFFF;
  opacity: 0.7;
}

.adsk-viewing-viewer .measure-length-button:hover {
  background-color: rgba(166, 194, 255, 0.7);
  -webkit-transition: all 0.2s ease;
  -moz-transition: all 0.2s ease;
  -ms-transition: all 0.2s ease;
  -o-transition: all 0.2s ease;
  transition: all 0.2s ease;
}

/* hover shouldn't work on mobile devices */
.adsk-viewing-viewer .measure-label:hover.measure-label.enable-hover,
.adsk-viewing-viewer .measure-label.on-edit {
  box-shadow: 0 0 4px 4px #0d69ca;
  -webkit-box-shadow: 0 0 4px 4px #0d69ca;
  -moz-box-shadow: 0 0 4px 4px #0d69ca;
}

.adsk-viewing-viewer .measure-label.editable {
  pointer-events: all;
}

.adsk-viewing-viewer .measure-label {
  display: none;
  position: absolute;
  width: 7px;
  height: 7px;
  cursor: move;
  pointer-events: none;
  border-radius: 100px;
}

.adsk-viewing-viewer .measure-label-hit-area {
  display: inline-block;
  position: absolute;
  width: 44px;
  height: 44px;
  left: -22px;
  top: -22px;
  border-radius: 100px;
  z-index: 2;
}

.adsk-viewing-viewer .measure-label-icon {
  display: inline-block;
  position: absolute;
  width: 7px;
  height: 7px;
  left: -2px;
  top: -2px;
  background-color: #009bea;
  border-style: solid;
  border-width: 2px;
  border-color: #FFFFFF;
  border-radius: 100px;
  box-shadow: 0 2px 5px 0 #182A3D;
  z-index: 2;
}

.adsk-viewing-viewer .measure-label.visible {
  display: block;
}

.adsk-viewing-viewer .measure-label-text {
  display: inline-block;
  margin: 0px 5px 0px 5px;
  vertical-align: middle;
}

.adsk-viewing-viewer .measure-horizontal-divider {
  height: 1px;
  border-top: 1px solid rgba(200, 200, 200, 0.8);
}

.adsk-viewing-viewer .measure-submenu-select {
  display: block;
  position: relative;
  width: calc(100% - 40px);
  padding: 10px 20px 0px 20px;
  opacity: 0.3;
}

.adsk-viewing-viewer .option-drop-down:disabled {
  opacity: 0.3;
}

.adsk-viewing-viewer .measure-submenu-selectlabel {
  position: relative;
  display: inline-block;
  padding-right: 20px;
  padding-bottom: 4px;
}

/*.measure-result {*/
/*display: inline-block;*/
/*padding: 10px 0px  10px 20px;*/
/*}*/
.adsk-viewing-viewer .measure-results {
  position: relative;
  display: block;
  padding: 5px 0px 10px 30px;
}

.adsk-viewing-viewer .measure-result-label {
  display: inline-block;
  padding-right: 10px;
}

.adsk-viewing-viewer .measure-result-number {
  display: inline-block;
}

.adsk-viewing-viewer .measure-delta-collapse {
  position: absolute;
  right: 20px;
  display: inline-block;
  background-color: rgba(255, 255, 255, 0.12);
  margin: 0px 4px 0px 4px;
  padding: 0px 4px 0px 4px;
  cursor: pointer;
  text-align: center;
}

.adsk-viewing-viewer .measure-delta-collapse:hover {
  background-color: rgba(166, 194, 255, 0.7);
  -webkit-transition: all 0.2s ease;
  -moz-transition: all 0.2s ease;
  -ms-transition: all 0.2s ease;
  -o-transition: all 0.2s ease;
  transition: all 0.2s ease;
}

.adsk-viewing-viewer .measure-selection-repick {
  position: absolute;
  right: 20px;
  display: inline-block;
  background-color: rgba(255, 255, 255, 0.12);
  margin: 4px 4px 4px 4px;
  padding: 4px 4px 4px 4px;
  cursor: pointer;
  text-align: center;
}

.adsk-viewing-viewer .measure-selection-repick:hover {
  background-color: rgba(166, 194, 255, 0.7);
  -webkit-transition: all 0.2s ease;
  -moz-transition: all 0.2s ease;
  -ms-transition: all 0.2s ease;
  -o-transition: all 0.2s ease;
  transition: all 0.2s ease;
}

.adsk-viewing-viewer .measure-restart {
  margin: 10px 20px 15px 20px;
  padding: 6px 10px 6px 10px;
  width: calc(100% - 55px);
  cursor: pointer;
  text-align: center;
  border-style: solid;
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.adsk-viewing-viewer .docking-panel:hover .measure-restart {
  background-color: rgba(255, 255, 255, 0.12);
}

.adsk-viewing-viewer .docking-panel .measure-restart:hover {
  background-color: rgba(166, 194, 255, 0.7);
  -webkit-transition: all 0.2s ease;
  -moz-transition: all 0.2s ease;
  -ms-transition: all 0.2s ease;
  -o-transition: all 0.2s ease;
  transition: all 0.2s ease;
}

.adsk-viewing-viewer .measure-panel-title {
  padding-top: 0px;
  padding-left: 20px;
  margin-top: 10px;
}

.adsk-viewing-viewer .measure-panel-title:hover {
  cursor: pointer;
}

.adsk-viewing-viewer .measure-panel-title.collapsed {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
  background-repeat: no-repeat;
}

.adsk-viewing-viewer .measure-panel-title.expanded {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});
  background-repeat: no-repeat;
}

.adsk-viewing-viewer .adsk-viewing-viewer .measure-table td {
  padding: 10px 0px 10px 20px;
}

.adsk-viewing-viewer .measure-selection-one-label {
  display: inline-block;
  margin: 18px 18px 18px 18px;
  width: 16px;
  height: 16px;
  font-size: 16px;
  float: left;
  padding: 2px;
  background-color: #0033FF;
  border-radius: 10px;
  opacity: 0.6;
}

.adsk-viewing-viewer .measure-selection-two-label {
  display: inline-block;
  margin: 18px 18px 18px 18px;
  width: 16px;
  height: 16px;
  font-size: 16px;
  float: left;
  padding: 2px;
  background-color: #0033FF;
  border-radius: 10px;
  opacity: 0.6;
}

.adsk-viewing-viewer .measure-repick {
  display: inline-block;
  cursor: default;
  margin: 20px 20px 20px 20px;
  width: 16px;
  height: 16px;
  font-size: 16px;
  float: right;
  opacity: 0.5;
}

.adsk-viewing-viewer .measure-repick:hover {
  opacity: 1;
}

.adsk-viewing-viewer .measure-selection-result {
  display: inline-block;
  margin: 21px 0px 21px 0px;
}

.adsk-viewing-viewer .measure-distance-icon {
  display: inline-block;
  margin: 20px 2px 20px 2px;
  font-size: 52px;
  color: #FF9900;
  float: left;
}

.adsk-viewing-viewer .measure-angle-icon {
  display: inline-block;
  margin: 20px 2px 20px 2px;
  font-size: 52px;
  color: #FF9900;
  float: left;
}

.adsk-viewing-viewer .adsk-viewing-viewer .measure-result {
  font-size: 20px;
  color: #FF9900;
  display: inline-block;
  margin: 38px 0px 38px 0px;
}

.adsk-viewing-viewer .measure-initial {
  font-size: 20px;
  display: inline-block;
  margin: 38px 0px 38px 56px;
}

.adsk-viewing-viewer .measure-settings-button {
  cursor: default;
  position: relative;
  top: 20px;
  right: 20px;
  width: 16px;
  height: 16px;
  font-size: 18px;
  float: right;
  opacity: 0.5;
}

.adsk-viewing-viewer .measure-settings-button:hover {
  opacity: 1;
}

.adsk-viewing-viewer .measure-delta-button {
  position: relative;
  top: 56px;
  right: 4px;
  width: 16px;
  height: 16px;
  font-size: 16px;
  float: right;
  opacity: 0.5;
  -webkit-transform: rotate(-90deg);
  -moz-transform: rotate(-90deg);
  -ms-transform: rotate(-90deg);
  -o-transform: rotate(-90deg);
  transform: rotate(-90deg);
}

.adsk-viewing-viewer .measure-delta-button.rotated {
  -webkit-transform: rotate(90deg);
  -moz-transform: rotate(90deg);
  -ms-transform: rotate(90deg);
  -o-transform: rotate(90deg);
  transform: rotate(90deg);
}

.adsk-viewing-viewer .measure-delta-button:hover {
  opacity: 1;
}

.adsk-viewing-viewer .measure-delta-result {
  display: inline-block;
  margin: 0px 0px 20px 0px;
  padding: 0px 0px 0px 56px;
}

.adsk-viewing-viewer .measure-label-axis {
  display: none;
  position: absolute;
  width: 16px;
  height: 16px;
  left: 0px;
  top: 0px;
  background-color: #f4f4f4;
  border-radius: 8px;
  pointer-events: none;
}

.adsk-viewing-viewer .measure-label-prefix.X,
.adsk-viewing-viewer .measure-label-axis-icon.X {
  background-color: #F12C2C;
}

.adsk-viewing-viewer .measure-label-prefix.Y,
.adsk-viewing-viewer .measure-label-axis-icon.Y {
  background-color: #0BB80B;
}

.adsk-viewing-viewer .measure-label-prefix.Z,
.adsk-viewing-viewer .measure-label-axis-icon.Z {
  background-color: #2C2CF1;
}

.adsk-viewing-viewer .measure-label-prefix.shape,
.adsk-viewing-viewer .measure-label-axis-icon.shape {
  background-color: #009BEA;
}

.adsk-viewing-viewer .measure-label-prefix,
.adsk-viewing-viewer .measure-label-axis-icon {
  width: 20px;
  height: 18px;
  color: #f4f4f4;
  border-radius: 8px 0 0 8px;
  font-size: 12px;
  padding-top: 4px;
  line-height: 15px;
  text-align: center;
  margin-left: -2px;
}

/* hover shouldn't work on mobile devices */
.adsk-viewing-viewer .measure-label-pill.enableTransition,
.adsk-viewing-viewer .measure-label-axis-delta.enableTransition {
  transition: opacity 0.1s linear;
}

.adsk-viewing-viewer .measure-label-pill,
.adsk-viewing-viewer .measure-label-axis-delta {
  display: none;
  position: absolute;
  font-size: 18px;
  left: 0px;
  top: 0px;
  background-color: #ffffff;
  pointer-events: none;
  opacity: 0;
  border-radius: 8px;
  box-shadow: 0px 1px 3px 1px rgba(0, 0, 0, 0.25);
}

.adsk-viewing-viewer .measure-label-axis.visible {
  display: block;
}

/* Surface measurement property text */
.adsk-viewing-viewer .measure-label-pill.surface,
.adsk-viewing-viewer .measure-label-axis-delta.surface {
  opacity: 1;
  white-space: nowrap;
}

.adsk-viewing-viewer .measure-label-pill.surface .measure-label-prefix,
.adsk-viewing-viewer .measure-label-axis-delta.surface .measure-label-axis-icon {
  padding-bottom: 1px;
  font-size: 14px;
  height: auto;
}

.adsk-viewing-viewer .measure-label-pill.visible,
.adsk-viewing-viewer .measure-label-axis-delta.visible {
  display: flex;
}

.adsk-viewing-viewer .measure-label-axis-x {
  color: #F12C2C;
}

.adsk-viewing-viewer .measure-label-axis-y {
  color: #0BB80B;
}

.adsk-viewing-viewer .measure-label-axis-z {
  color: #2C2CF1;
}

.adsk-viewing-viewer .magnifying-glass.visible {
  display: block;
}

.adsk-viewing-viewer .magnifying-glass {
  position: absolute;
  display: none;
  -moz-border-radius: 100%;
  -webkit-border-radius: 100%;
  border-radius: 100%;
  background: transparent;
  box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5), inset 2px 2px 4px rgba(0, 0, 0, 0.5);
  -webkit-box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5), inset 2px 2px 4px rgba(0, 0, 0, 0.5);
  -moz-box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5), inset 2px 2px 4px rgba(0, 0, 0, 0.5);
  z-index: 4;
}

.adsk-viewing-viewer .measure-fetching-topology {
  display: inline-block;
  width: 10px;
  height: 10px;
  background: url(${___CSS_LOADER_URL_REPLACEMENT_2___});
  margin: 3px 0px -2px 3px;
  animation: measure-topology-fetching-anim 1.4s infinite linear;
  -webkit-animation: measure-topology-fetching-anim 1.4s infinite linear;
}

@keyframes measure-topology-fetching-anim {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
    transform: rotate(360deg);
  }
}
@-webkit-keyframes measure-topology-fetching-anim {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
    transform: rotate(360deg);
  }
}
.adsk-viewing-viewer .docking-panel.measure-settings-popup {
  display: flex;
  justify-content: center;
  flex-direction: column;
  bottom: 120%;
  box-sizing: border-box;
  text-align: left;
  position: absolute;
  padding-top: 15px;
  padding-bottom: 15px;
}

.adsk-viewing-viewer .adsk-toolbar-vertical .docking-panel.measure-settings-popup {
  right: 120%;
  bottom: unset;
  height: max-content;
  width: max-content;
}

.adsk-viewing-viewer .docking-panel.measure-settings-popup .adsk-lmv-tftable tr.switch-slider-row td {
  width: auto;
  padding-bottom: 0px;
  padding-top: 0px;
  vertical-align: inherit;
}

.adsk-viewing-viewer .docking-panel.measure-settings-popup.hide {
  display: none;
}

.adsk-viewing-viewer .measure-settings-popup tbody {
  top: 15px;
}

.adsk-toolbar .measure-toolbar-seperator {
  height: 18px;
  width: 1px;
  background-color: #999;
  float: left;
  margin: 16px 5px;
}

.adsk-toolbar.adsk-toolbar-vertical .measure-toolbar-seperator {
  height: 1px;
  width: 18px;
  margin: 5px 16px;
}

.adsk-viewing-viewer .measure-selection-area {
  display: block;
  position: absolute;
  cursor: pointer;
  z-index: 1;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}

.adsk-viewing-viewer .adsk-toolbar.adsk-toolbar-vertical .adsk-label-button {
  padding: 0px;
  width: 40px;
}

.adsk-viewing-viewer .adsk-toolbar.adsk-toolbar-vertical .adsk-label-button > label {
  padding: 10px 0px;
}

/* Add styles for fragment highlighting overlay */
.measure-fragment-highlight {
  pointer-events: none;
  z-index: 100;
}

/* Ensure highlight meshes render properly */
.measure-fragment-highlight canvas {
  position: absolute;
  top: 0;
  left: 0;
}

.adsk-viewing-viewer .measure-copy-hint {
  position: absolute;
  width: auto;
  left: 50%;
  top: 0;
  white-space: nowrap;
  padding: 4px 8px;
  display: inline-block;
  opacity: 0;
  animation: fade-in-out 1.75s ease-out;
  color: #f4f4f4;
  background-color: rgba(34, 34, 34, 0.94);
  border-radius: 8px;
  transform: translateX(-50%) translateY(-28px);
}

@keyframes fade-in-out {
  0% {
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
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

/***/ "./extensions/Measure/Calibration.css"
/*!********************************************!*\
  !*** ./extensions/Measure/Calibration.css ***!
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Calibration_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./Calibration.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Measure/Calibration.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Calibration_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Calibration_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Calibration_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Calibration_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


/***/ },

/***/ "./extensions/Measure/Measure.css"
/*!****************************************!*\
  !*** ./extensions/Measure/Measure.css ***!
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
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Measure_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./Measure.css */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/Measure/Measure.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Measure_css__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Measure_css__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Measure_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_Measure_css__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


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

/***/ "./extensions/Measure/res/icon-spinner-sm.svg"
/*!****************************************************!*\
  !*** ./extensions/Measure/res/icon-spinner-sm.svg ***!
  \****************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCAxMCAxMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmVhci1ncmFkaWVudCIgeTE9IjUiIHgyPSIxMCIgeTI9IjUiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmIiBzdG9wLW9wYWNpdHk9IjAiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZmZmIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8dGl0bGU+QXNzZXQgNjwvdGl0bGU+CiAgPGcgaWQ9IkxheWVyXzIiIGRhdGEtbmFtZT0iTGF5ZXIgMiI+CiAgICA8ZyBpZD0iZmluYWxzXzI0cHgiPgogICAgICA8cGF0aCBkPSJNNSwxMEE1LDUsMCwwLDEsMCw1LDEuMiwxLjIsMCwwLDEsMi4zLDUsMi43LDIuNywwLDEsMCw1LDIuMywxLjIsMS4yLDAsMCwxLDUsMCw1LDUsMCwwLDEsNSwxMFoiIGZpbGw9InVybCgjbGluZWFyLWdyYWRpZW50KSIvPgogICAgPC9nPgogIDwvZz4KPC9zdmc+";

/***/ },

/***/ "data:application/octet-stream;base64,d09GRgABAAAAAAtYAA8AAAAAE7QAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABWAAAADsAAABUIIwleU9TLzIAAAGUAAAAQgAAAFZWgGFpY21hcAAAAdgAAABOAAABcAGIBM1jdnQgAAACKAAAABMAAAAgBtX/BGZwZ20AAAI8AAAFkAAAC3CKkZBZZ2FzcAAAB8wAAAAIAAAACAAAABBnbHlmAAAH1AAAAOQAAADkZyzZ8WhlYWQAAAi4AAAAMQAAADYL0YfIaGhlYQAACOwAAAAcAAAAJAc7A1VobXR4AAAJCAAAAAgAAAAIBvL//2xvY2EAAAkQAAAABgAAAAYAcgAAbWF4cAAACRgAAAAgAAAAIADpC8puYW1lAAAJOAAAAXcAAALNzJ0cHnBvc3QAAAqwAAAAKgAAADsMvKbDcHJlcAAACtwAAAB6AAAAhuVBK7x4nGNgZGBg4GIwYLBjYMpJLMlj4HNx8wlhkGJgYYAAkDwymzEnMz2RgQPGA8qxgGkOIGaDiAIAKVkFSAB4nGNgZK5knMDAysDAVMW0h4GBoQdCMz5gMGRkAooysDIzYAUBaa4pDA4MiQyJzEH/sxiimIMYpgGFGUFyAM95CpgAAHicY2BgYGVgYGAGYh0gZmFgYAxhYGQAAT+gKCNYnJmBCyzOwqAEVsMCFk/8/x9OMoJ0gkQZ2RhoDxjpYAclgAdMykB54LCCYkYA4LUHVgAAeJxjYEADEhDIHPQ/C4QBEmwD3QB4nK1WaXfTRhQdeUmchCwlCy1qYcTEabBGJmzBgAlBsmMgXZytlaCLFDvpvvGJ3+Bf82Tac+g3flrvGy8kkLTncJqTo3fnzdXM22USWpLYC+uRlJsvxdTWJo3sPAnphk3LUXwoO3shZYrJ3wVREK2W2rcdh0REIlC1rrBEEPseWZpkfOhRRsu2pFdNyi096S5b40G9Vd9+GjrKsTuhpGYzdGg9siVVGFWiSKY9UtKmZaj6K0krvL/CzFfNUMKITiJpvBnG0EjeG2e0ymg1tuMoimyy3ChSJJrhQRR5lNUS5+SKCQzKB82Q8sqnEeXD/Iis2KOcVrBLttP8vi95p3c5P7Ffb1G25EAfyI7s4Ox0JV+EW1th3LST7ShUEXbXd0Js2exU/2aP8ppGA7crMr3QjGCpfIUQKz+hzP4hWS2cT/mSR6NaspETQetlTuxLPoHW44gpcc0YWdDd0QkR1P2SMwz2mD4e/PHeKZYLEwJ4HMt6RyWcCBMpYXM0SdowcmAlZYsqqfWumDjldVrEW8J+7drRl85o41B3YjxbDx1bOVHJ8WhSp5lMndpJzaMpDaKUdCZ4zK8DKD+iSV5tYzWJlUfTOGbGhEQiAi3cS1NBLDuxpCkEzaMZvbkbprl2LVqkyQP13KP39OZWuLnTU9oO9LNGf1anYjrYC9PpaeQv8Wna5SJF6frpGX5M4kHWAjKRLTbDlIMHb/0O0svXlhyF1wbY7u3zK6h91kTwpAH7G9AeT9UpCUyFmFWIVkBirWtZlsnVrBapyNR3Q5pWvqzTBIpyHBfHvoxx/V8zM5aYEr7fidOzIy49c+1LCNMcfJt1PZrXqcVyAXFmeU6nWZbv6zTH8gOd5lme1+kIS1unoyw/1GmB5Uc6HWN5QQuadN/BkIsw5AIOkDCEpQNDWF6CISwVDGG5CENYFmEIyyUYwvJjGMJyGYawvKxl1dRTSePamVgGbEJgYo4eucxF5WoquVRCu2hUakOeEm6VVBTPqn9loF488oY5sBZIl8iaXzHOlY9G5fjWFS1vGjtXwLHqbx+O9jnxUtaLhT8F/9XWVCW9Ys3Dk6vwG4aebCeqNql4dE2Xz1U9uv5fVFRYC/QbSIVYKMqybHBnIoSPOp2GaqCVQ8xszDy063XLmp/D/TcxQhZQ/fg3FBoL3INOWUlZ7eCs1dfbstw7g3I4EyxJMTfz+lb4IiOz0n6RWcqej3wecAWMSmXYagOtFbzZJzEPmd4kzwRxW1E2SNrYzgSJDRzzgHnznQQmYeqqDeRO4YYN+AVhbsF5J1yieqMsh+5F7PMopPxbp+JE9qhojMCz2Rthr+9Cym9xDCQ0+aV+DFQVoakYNRXQNFJuqAZfxtm6bULGDvQjKnbDsqziw8cW95WSbRmEfKSI1aOjn9Zeok6q3H5mFJfvnb4FwSA1MX9733RxkMq7WskyR20DU7calVPXmkPjVYfq5lH1vePsEzlrmm66Jx56X9Oq28HFXCyw9m0O0lImF9T1YYUNosvFpVDqZTRJ77gHGBYY0O9Qio3/q/rYfJ4rVYXRcSTfTtS30edgDPwP2H9H9QPQ92Pocg0uz/eaE59u9OFsma6iF+un6Dcwa625WboG3NB0A+IhR62OuMoNfKcGcXqkuRzpIeBj3RXiAcAmgMXgE921jOZTAKP5jDk+wOfMYdBkDoMt5jDYZs4awA5zGOwyh8Eecxh8wZx1gC+ZwyBkDoOIOQyeMCcAeMocBl8xh8HXzGHwDXPuA3zLHAYxcxgkzGGwr+nWMMwtXtBdoLZBVaADU09Y3MPiUFNlyP6OF4b9vUHM/sEgpv6o6faQ+hMvDPVng5j6i0FM/VXTnSH1N14Y6u8GMfUPg5j6TL8Yy2UGv4x8lwoHlF1sPufvifcP28VAuQABAAH//wAPAAP///+TAwoDUgAlAC4AMQBJQEYkAQIGBQFHFhUQDwQBRAAHBgAGBwBtCAQCAAMCAgEAAVwKAQYGBVYJAQUFDAZJJyYAADEwKyomLicuACUAJSMkFCQXCwUZKwEVDgEVFBcDIw4BHgE7AQcXPwEhHwE3JzMyNjQmKwEDNjU0Jic1BzIWFAYiJjQ2FxMhAVgoNA7ANAoNAg0KHh4LXEABjUBbDB4eCQ4OCTLADTMoLhMbGyYaGhOw/qEDUm8ORyweHP5EAQ0UDERnLn19LmdEDRQNAbwaICxHDm/CGyYaGiYbzv6qeJxjYGRgYABiNfd3DvH8Nl8ZuJlfAEUYrqQu/A+jgWAy8wvmICCXg4EJJAoAgCEOvwAAAHicY2BkYGAO+p8FJF/8/w8iGYAiKIAJAIvHBZcD6AAAAwr//wAAAAAAcgAAAAEAAAACADIAAwAAAAAAAgAWACYAcwAAAFoLcAAAAAB4nHWQy07CQBSG/5GLCokaTdw6KwMxlksiCxISEgxsdEMMW1NKaUtKh0wHEl7Dd/BhfAmfxZ92MAZim+l855szZ04HwDW+IZA/Txw5C5wxyvkEp+hZLtA/Wy6SXyyXUMWb5TL9u+UKHhBYruIGH6wgiueMFvi0LHAlLi2f4ELcWS7QP1ouknuWS7gVr5bL9J7lCiYitVzFvfgaqNVWR0FoZG1Ql+1mqyOnW6moosSNpbs2odKp7Mu5Sowfx8rx1HLPYz9Yx67eh/t54us0UolsOc29GvmJr13jz3bV003QNmYu51ot5dBmyJVWC98zTmjMqtto/D0PAyissIVGxKsKYSBRo61zbqOJFjqkKTMkM/OsCAlcxDQu1twRZisp4z7HnFFC6zMjJjvw+F0e+TEp4P6YVfTR6mE8Ie3OiDIv2ZfD7g6zRqQky3QzO/vtPcWGp7VpDXftutRZVxLDgxqS97FbW9B49E52K4a2iwbff/7vB+NphE8AeJxjYGKAAC4G7ICJkYmRmUEwOTEnM6kosSQzPy++PCOzJJWBAQBRdwcvAAB4nGPw3sFwIihiIyNjX+QGxp0cDBwMyQUbGVidNjEwMmiBGJu5mBg5ICw+BjCLzWkX0wGgNCeQze60i8EBwmZmcNmowtgRGLHBoSNiI3OKy0Y1EG8XRwMDI4tDR3JIBEhJJBBs5mFi5NHawfi/dQNL70YmBhcADHYj9AAA"
/*!*****************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:application/octet-stream;base64,d09GRgABAAAAAAtYAA8AAAAAE7QAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABWAAAADsAAABUIIwleU9TLzIAAAGUAAAAQgAAAFZWgGFpY21hcAAAAdgAAABOAAABcAGIBM1jdnQgAAACKAAAABMAAAAgBtX/BGZwZ20AAAI8AAAFkAAAC3CKkZBZZ2FzcAAAB8wAAAAIAAAACAAAABBnbHlmAAAH1AAAAOQAAADkZyzZ8WhlYWQAAAi4AAAAMQAAADYL0YfIaGhlYQAACOwAAAAcAAAAJAc7A1VobXR4AAAJCAAAAAgAAAAIBvL//2xvY2EAAAkQAAAABgAAAAYAcgAAbWF4cAAACRgAAAAgAAAAIADpC8puYW1lAAAJOAAAAXcAAALNzJ0cHnBvc3QAAAqwAAAAKgAAADsMvKbDcHJlcAAACtwAAAB6AAAAhuVBK7x4nGNgZGBg4GIwYLBjYMpJLMlj4HNx8wlhkGJgYYAAkDwymzEnMz2RgQPGA8qxgGkOIGaDiAIAKVkFSAB4nGNgZK5knMDAysDAVMW0h4GBoQdCMz5gMGRkAooysDIzYAUBaa4pDA4MiQyJzEH/sxiimIMYpgGFGUFyAM95CpgAAHicY2BgYGVgYGAGYh0gZmFgYAxhYGQAAT+gKCNYnJmBCyzOwqAEVsMCFk/8/x9OMoJ0gkQZ2RhoDxjpYAclgAdMykB54LCCYkYA4LUHVgAAeJxjYEADEhDIHPQ/C4QBEmwD3QB4nK1WaXfTRhQdeUmchCwlCy1qYcTEabBGJmzBgAlBsmMgXZytlaCLFDvpvvGJ3+Bf82Tac+g3flrvGy8kkLTncJqTo3fnzdXM22USWpLYC+uRlJsvxdTWJo3sPAnphk3LUXwoO3shZYrJ3wVREK2W2rcdh0REIlC1rrBEEPseWZpkfOhRRsu2pFdNyi096S5b40G9Vd9+GjrKsTuhpGYzdGg9siVVGFWiSKY9UtKmZaj6K0krvL/CzFfNUMKITiJpvBnG0EjeG2e0ymg1tuMoimyy3ChSJJrhQRR5lNUS5+SKCQzKB82Q8sqnEeXD/Iis2KOcVrBLttP8vi95p3c5P7Ffb1G25EAfyI7s4Ox0JV+EW1th3LST7ShUEXbXd0Js2exU/2aP8ppGA7crMr3QjGCpfIUQKz+hzP4hWS2cT/mSR6NaspETQetlTuxLPoHW44gpcc0YWdDd0QkR1P2SMwz2mD4e/PHeKZYLEwJ4HMt6RyWcCBMpYXM0SdowcmAlZYsqqfWumDjldVrEW8J+7drRl85o41B3YjxbDx1bOVHJ8WhSp5lMndpJzaMpDaKUdCZ4zK8DKD+iSV5tYzWJlUfTOGbGhEQiAi3cS1NBLDuxpCkEzaMZvbkbprl2LVqkyQP13KP39OZWuLnTU9oO9LNGf1anYjrYC9PpaeQv8Wna5SJF6frpGX5M4kHWAjKRLTbDlIMHb/0O0svXlhyF1wbY7u3zK6h91kTwpAH7G9AeT9UpCUyFmFWIVkBirWtZlsnVrBapyNR3Q5pWvqzTBIpyHBfHvoxx/V8zM5aYEr7fidOzIy49c+1LCNMcfJt1PZrXqcVyAXFmeU6nWZbv6zTH8gOd5lme1+kIS1unoyw/1GmB5Uc6HWN5QQuadN/BkIsw5AIOkDCEpQNDWF6CISwVDGG5CENYFmEIyyUYwvJjGMJyGYawvKxl1dRTSePamVgGbEJgYo4eucxF5WoquVRCu2hUakOeEm6VVBTPqn9loF488oY5sBZIl8iaXzHOlY9G5fjWFS1vGjtXwLHqbx+O9jnxUtaLhT8F/9XWVCW9Ys3Dk6vwG4aebCeqNql4dE2Xz1U9uv5fVFRYC/QbSIVYKMqybHBnIoSPOp2GaqCVQ8xszDy063XLmp/D/TcxQhZQ/fg3FBoL3INOWUlZ7eCs1dfbstw7g3I4EyxJMTfz+lb4IiOz0n6RWcqej3wecAWMSmXYagOtFbzZJzEPmd4kzwRxW1E2SNrYzgSJDRzzgHnznQQmYeqqDeRO4YYN+AVhbsF5J1yieqMsh+5F7PMopPxbp+JE9qhojMCz2Rthr+9Cym9xDCQ0+aV+DFQVoakYNRXQNFJuqAZfxtm6bULGDvQjKnbDsqziw8cW95WSbRmEfKSI1aOjn9Zeok6q3H5mFJfvnb4FwSA1MX9733RxkMq7WskyR20DU7calVPXmkPjVYfq5lH1vePsEzlrmm66Jx56X9Oq28HFXCyw9m0O0lImF9T1YYUNosvFpVDqZTRJ77gHGBYY0O9Qio3/q/rYfJ4rVYXRcSTfTtS30edgDPwP2H9H9QPQ92Pocg0uz/eaE59u9OFsma6iF+un6Dcwa625WboG3NB0A+IhR62OuMoNfKcGcXqkuRzpIeBj3RXiAcAmgMXgE921jOZTAKP5jDk+wOfMYdBkDoMt5jDYZs4awA5zGOwyh8Eecxh8wZx1gC+ZwyBkDoOIOQyeMCcAeMocBl8xh8HXzGHwDXPuA3zLHAYxcxgkzGGwr+nWMMwtXtBdoLZBVaADU09Y3MPiUFNlyP6OF4b9vUHM/sEgpv6o6faQ+hMvDPVng5j6i0FM/VXTnSH1N14Y6u8GMfUPg5j6TL8Yy2UGv4x8lwoHlF1sPufvifcP28VAuQABAAH//wAPAAP///+TAwoDUgAlAC4AMQBJQEYkAQIGBQFHFhUQDwQBRAAHBgAGBwBtCAQCAAMCAgEAAVwKAQYGBVYJAQUFDAZJJyYAADEwKyomLicuACUAJSMkFCQXCwUZKwEVDgEVFBcDIw4BHgE7AQcXPwEhHwE3JzMyNjQmKwEDNjU0Jic1BzIWFAYiJjQ2FxMhAVgoNA7ANAoNAg0KHh4LXEABjUBbDB4eCQ4OCTLADTMoLhMbGyYaGhOw/qEDUm8ORyweHP5EAQ0UDERnLn19LmdEDRQNAbwaICxHDm/CGyYaGiYbzv6qeJxjYGRgYABiNfd3DvH8Nl8ZuJlfAEUYrqQu/A+jgWAy8wvmICCXg4EJJAoAgCEOvwAAAHicY2BkYGAO+p8FJF/8/w8iGYAiKIAJAIvHBZcD6AAAAwr//wAAAAAAcgAAAAEAAAACADIAAwAAAAAAAgAWACYAcwAAAFoLcAAAAAB4nHWQy07CQBSG/5GLCokaTdw6KwMxlksiCxISEgxsdEMMW1NKaUtKh0wHEl7Dd/BhfAmfxZ92MAZim+l855szZ04HwDW+IZA/Txw5C5wxyvkEp+hZLtA/Wy6SXyyXUMWb5TL9u+UKHhBYruIGH6wgiueMFvi0LHAlLi2f4ELcWS7QP1ouknuWS7gVr5bL9J7lCiYitVzFvfgaqNVWR0FoZG1Ql+1mqyOnW6moosSNpbs2odKp7Mu5Sowfx8rx1HLPYz9Yx67eh/t54us0UolsOc29GvmJr13jz3bV003QNmYu51ot5dBmyJVWC98zTmjMqtto/D0PAyissIVGxKsKYSBRo61zbqOJFjqkKTMkM/OsCAlcxDQu1twRZisp4z7HnFFC6zMjJjvw+F0e+TEp4P6YVfTR6mE8Ie3OiDIv2ZfD7g6zRqQky3QzO/vtPcWGp7VpDXftutRZVxLDgxqS97FbW9B49E52K4a2iwbff/7vB+NphE8AeJxjYGKAAC4G7ICJkYmRmUEwOTEnM6kosSQzPy++PCOzJJWBAQBRdwcvAAB4nGPw3sFwIihiIyNjX+QGxp0cDBwMyQUbGVidNjEwMmiBGJu5mBg5ICw+BjCLzWkX0wGgNCeQze60i8EBwmZmcNmowtgRGLHBoSNiI3OKy0Y1EG8XRwMDI4tDR3JIBEhJJBBs5mFi5NHawfi/dQNL70YmBhcADHYj9AAA ***!
  \*****************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:application/octet-stream;base64,d09GRgABAAAAAAtYAA8AAAAAE7QAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABWAAAADsAAABUIIwleU9TLzIAAAGUAAAAQgAAAFZWgGFpY21hcAAAAdgAAABOAAABcAGIBM1jdnQgAAACKAAAABMAAAAgBtX/BGZwZ20AAAI8AAAFkAAAC3CKkZBZZ2FzcAAAB8wAAAAIAAAACAAAABBnbHlmAAAH1AAAAOQAAADkZyzZ8WhlYWQAAAi4AAAAMQAAADYL0YfIaGhlYQAACOwAAAAcAAAAJAc7A1VobXR4AAAJCAAAAAgAAAAIBvL//2xvY2EAAAkQAAAABgAAAAYAcgAAbWF4cAAACRgAAAAgAAAAIADpC8puYW1lAAAJOAAAAXcAAALNzJ0cHnBvc3QAAAqwAAAAKgAAADsMvKbDcHJlcAAACtwAAAB6AAAAhuVBK7x4nGNgZGBg4GIwYLBjYMpJLMlj4HNx8wlhkGJgYYAAkDwymzEnMz2RgQPGA8qxgGkOIGaDiAIAKVkFSAB4nGNgZK5knMDAysDAVMW0h4GBoQdCMz5gMGRkAooysDIzYAUBaa4pDA4MiQyJzEH/sxiimIMYpgGFGUFyAM95CpgAAHicY2BgYGVgYGAGYh0gZmFgYAxhYGQAAT+gKCNYnJmBCyzOwqAEVsMCFk/8/x9OMoJ0gkQZ2RhoDxjpYAclgAdMykB54LCCYkYA4LUHVgAAeJxjYEADEhDIHPQ/C4QBEmwD3QB4nK1WaXfTRhQdeUmchCwlCy1qYcTEabBGJmzBgAlBsmMgXZytlaCLFDvpvvGJ3+Bf82Tac+g3flrvGy8kkLTncJqTo3fnzdXM22USWpLYC+uRlJsvxdTWJo3sPAnphk3LUXwoO3shZYrJ3wVREK2W2rcdh0REIlC1rrBEEPseWZpkfOhRRsu2pFdNyi096S5b40G9Vd9+GjrKsTuhpGYzdGg9siVVGFWiSKY9UtKmZaj6K0krvL/CzFfNUMKITiJpvBnG0EjeG2e0ymg1tuMoimyy3ChSJJrhQRR5lNUS5+SKCQzKB82Q8sqnEeXD/Iis2KOcVrBLttP8vi95p3c5P7Ffb1G25EAfyI7s4Ox0JV+EW1th3LST7ShUEXbXd0Js2exU/2aP8ppGA7crMr3QjGCpfIUQKz+hzP4hWS2cT/mSR6NaspETQetlTuxLPoHW44gpcc0YWdDd0QkR1P2SMwz2mD4e/PHeKZYLEwJ4HMt6RyWcCBMpYXM0SdowcmAlZYsqqfWumDjldVrEW8J+7drRl85o41B3YjxbDx1bOVHJ8WhSp5lMndpJzaMpDaKUdCZ4zK8DKD+iSV5tYzWJlUfTOGbGhEQiAi3cS1NBLDuxpCkEzaMZvbkbprl2LVqkyQP13KP39OZWuLnTU9oO9LNGf1anYjrYC9PpaeQv8Wna5SJF6frpGX5M4kHWAjKRLTbDlIMHb/0O0svXlhyF1wbY7u3zK6h91kTwpAH7G9AeT9UpCUyFmFWIVkBirWtZlsnVrBapyNR3Q5pWvqzTBIpyHBfHvoxx/V8zM5aYEr7fidOzIy49c+1LCNMcfJt1PZrXqcVyAXFmeU6nWZbv6zTH8gOd5lme1+kIS1unoyw/1GmB5Uc6HWN5QQuadN/BkIsw5AIOkDCEpQNDWF6CISwVDGG5CENYFmEIyyUYwvJjGMJyGYawvKxl1dRTSePamVgGbEJgYo4eucxF5WoquVRCu2hUakOeEm6VVBTPqn9loF488oY5sBZIl8iaXzHOlY9G5fjWFS1vGjtXwLHqbx+O9jnxUtaLhT8F/9XWVCW9Ys3Dk6vwG4aebCeqNql4dE2Xz1U9uv5fVFRYC/QbSIVYKMqybHBnIoSPOp2GaqCVQ8xszDy063XLmp/D/TcxQhZQ/fg3FBoL3INOWUlZ7eCs1dfbstw7g3I4EyxJMTfz+lb4IiOz0n6RWcqej3wecAWMSmXYagOtFbzZJzEPmd4kzwRxW1E2SNrYzgSJDRzzgHnznQQmYeqqDeRO4YYN+AVhbsF5J1yieqMsh+5F7PMopPxbp+JE9qhojMCz2Rthr+9Cym9xDCQ0+aV+DFQVoakYNRXQNFJuqAZfxtm6bULGDvQjKnbDsqziw8cW95WSbRmEfKSI1aOjn9Zeok6q3H5mFJfvnb4FwSA1MX9733RxkMq7WskyR20DU7calVPXmkPjVYfq5lH1vePsEzlrmm66Jx56X9Oq28HFXCyw9m0O0lImF9T1YYUNosvFpVDqZTRJ77gHGBYY0O9Qio3/q/rYfJ4rVYXRcSTfTtS30edgDPwP2H9H9QPQ92Pocg0uz/eaE59u9OFsma6iF+un6Dcwa625WboG3NB0A+IhR62OuMoNfKcGcXqkuRzpIeBj3RXiAcAmgMXgE921jOZTAKP5jDk+wOfMYdBkDoMt5jDYZs4awA5zGOwyh8Eecxh8wZx1gC+ZwyBkDoOIOQyeMCcAeMocBl8xh8HXzGHwDXPuA3zLHAYxcxgkzGGwr+nWMMwtXtBdoLZBVaADU09Y3MPiUFNlyP6OF4b9vUHM/sEgpv6o6faQ+hMvDPVng5j6i0FM/VXTnSH1N14Y6u8GMfUPg5j6TL8Yy2UGv4x8lwoHlF1sPufvifcP28VAuQABAAH//wAPAAP///+TAwoDUgAlAC4AMQBJQEYkAQIGBQFHFhUQDwQBRAAHBgAGBwBtCAQCAAMCAgEAAVwKAQYGBVYJAQUFDAZJJyYAADEwKyomLicuACUAJSMkFCQXCwUZKwEVDgEVFBcDIw4BHgE7AQcXPwEhHwE3JzMyNjQmKwEDNjU0Jic1BzIWFAYiJjQ2FxMhAVgoNA7ANAoNAg0KHh4LXEABjUBbDB4eCQ4OCTLADTMoLhMbGyYaGhOw/qEDUm8ORyweHP5EAQ0UDERnLn19LmdEDRQNAbwaICxHDm/CGyYaGiYbzv6qeJxjYGRgYABiNfd3DvH8Nl8ZuJlfAEUYrqQu/A+jgWAy8wvmICCXg4EJJAoAgCEOvwAAAHicY2BkYGAO+p8FJF/8/w8iGYAiKIAJAIvHBZcD6AAAAwr//wAAAAAAcgAAAAEAAAACADIAAwAAAAAAAgAWACYAcwAAAFoLcAAAAAB4nHWQy07CQBSG/5GLCokaTdw6KwMxlksiCxISEgxsdEMMW1NKaUtKh0wHEl7Dd/BhfAmfxZ92MAZim+l855szZ04HwDW+IZA/Txw5C5wxyvkEp+hZLtA/Wy6SXyyXUMWb5TL9u+UKHhBYruIGH6wgiueMFvi0LHAlLi2f4ELcWS7QP1ouknuWS7gVr5bL9J7lCiYitVzFvfgaqNVWR0FoZG1Ql+1mqyOnW6moosSNpbs2odKp7Mu5Sowfx8rx1HLPYz9Yx67eh/t54us0UolsOc29GvmJr13jz3bV003QNmYu51ot5dBmyJVWC98zTmjMqtto/D0PAyissIVGxKsKYSBRo61zbqOJFjqkKTMkM/OsCAlcxDQu1twRZisp4z7HnFFC6zMjJjvw+F0e+TEp4P6YVfTR6mE8Ie3OiDIv2ZfD7g6zRqQky3QzO/vtPcWGp7VpDXftutRZVxLDgxqS97FbW9B49E52K4a2iwbff/7vB+NphE8AeJxjYGKAAC4G7ICJkYmRmUEwOTEnM6kosSQzPy++PCOzJJWBAQBRdwcvAAB4nGPw3sFwIihiIyNjX+QGxp0cDBwMyQUbGVidNjEwMmiBGJu5mBg5ICw+BjCLzWkX0wGgNCeQze60i8EBwmZmcNmowtgRGLHBoSNiI3OKy0Y1EG8XRwMDI4tDR3JIBEhJJBBs5mFi5NHawfi/dQNL70YmBhcADHYj9AAA";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkE3QzFFQUQ1QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkE3QzFFQUQ2QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTdDMUVBRDNBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTdDMUVBRDRBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6XuY60AAAARklEQVR42mL8//8/AzmAiYFMQBeNqSg8kB+JwKlAfAZZjIlIm9JJdSpWTYQ04tSETyNeTbg0EtSETSNRmkCAcegkOYAAAwDGjDZHvY373AAAAABJRU5ErkJggg=="
/*!**************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkE3QzFFQUQ1QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkE3QzFFQUQ2QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTdDMUVBRDNBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTdDMUVBRDRBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6XuY60AAAARklEQVR42mL8//8/AzmAiYFMQBeNqSg8kB+JwKlAfAZZjIlIm9JJdSpWTYQ04tSETyNeTbg0EtSETSNRmkCAcegkOYAAAwDGjDZHvY373AAAAABJRU5ErkJggg== ***!
  \**************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkE3QzFFQUQ1QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkE3QzFFQUQ2QTYyODExRTM5NzE2RjcyN0QxQjg0QTREIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTdDMUVBRDNBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTdDMUVBRDRBNjI4MTFFMzk3MTZGNzI3RDFCODRBNEQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6XuY60AAAARklEQVR42mL8//8/AzmAiYFMQBeNqSg8kB+JwKlAfAZZjIlIm9JJdSpWTYQ04tSETyNeTbg0EtSETSNRmkCAcegkOYAAAwDGjDZHvY373AAAAABJRU5ErkJggg==";

/***/ },

/***/ "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkEwMDhBMzY4QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkEwMDhBMzY5QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTAwOEEzNjZBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTAwOEEzNjdBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6WHWu4AAAAcElEQVR42mL8//8/AzmAiYFMgEtjGSFDcUmGAfEEIOYix6lWQLwUiGXJ8SNI00IgNiIncPiAeCoQ+5ITqsxQA+CAhQhN34C4AoiPkaLxGRAXAfEdUvx4DohjsGkCA1CSw4LrgZgVhxwYM9I9rQIEGACZNDs01yUXlAAAAABJRU5ErkJggg=="
/*!**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkEwMDhBMzY4QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkEwMDhBMzY5QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTAwOEEzNjZBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTAwOEEzNjdBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6WHWu4AAAAcElEQVR42mL8//8/AzmAiYFMgEtjGSFDcUmGAfEEIOYix6lWQLwUiGXJ8SNI00IgNiIncPiAeCoQ+5ITqsxQA+CAhQhN34C4AoiPkaLxGRAXAfEdUvx4DohjsGkCA1CSw4LrgZgVhxwYM9I9rQIEGACZNDs01yUXlAAAAABJRU5ErkJggg== ***!
  \**********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkEwMDhBMzY4QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkEwMDhBMzY5QTYyODExRTM5REY0Q0MwMTM3MTVFOTMzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QTAwOEEzNjZBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QTAwOEEzNjdBNjI4MTFFMzlERjRDQzAxMzcxNUU5MzMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz6WHWu4AAAAcElEQVR42mL8//8/AzmAiYFMgEtjGSFDcUmGAfEEIOYix6lWQLwUiGXJ8SNI00IgNiIncPiAeCoQ+5ITqsxQA+CAhQhN34C4AoiPkaLxGRAXAfEdUvx4DohjsGkCA1CSw4LrgZgVhxwYM9I9rQIEGACZNDs01yUXlAAAAABJRU5ErkJggg==";

/***/ },

/***/ "three"
/*!************************!*\
  !*** external "THREE" ***!
  \************************/
(module) {

"use strict";
module.exports = THREE;

/***/ },

/***/ "./node_modules/i18next/dist/esm/i18next.js"
/*!**************************************************!*\
  !*** ./node_modules/i18next/dist/esm/i18next.js ***!
  \**************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   changeLanguage: () => (/* binding */ changeLanguage),
/* harmony export */   createInstance: () => (/* binding */ createInstance),
/* harmony export */   "default": () => (/* binding */ instance),
/* harmony export */   dir: () => (/* binding */ dir),
/* harmony export */   exists: () => (/* binding */ exists),
/* harmony export */   getFixedT: () => (/* binding */ getFixedT),
/* harmony export */   hasLoadedNamespace: () => (/* binding */ hasLoadedNamespace),
/* harmony export */   init: () => (/* binding */ init),
/* harmony export */   loadLanguages: () => (/* binding */ loadLanguages),
/* harmony export */   loadNamespaces: () => (/* binding */ loadNamespaces),
/* harmony export */   loadResources: () => (/* binding */ loadResources),
/* harmony export */   reloadResources: () => (/* binding */ reloadResources),
/* harmony export */   setDefaultNamespace: () => (/* binding */ setDefaultNamespace),
/* harmony export */   t: () => (/* binding */ t),
/* harmony export */   use: () => (/* binding */ use)
/* harmony export */ });
const isString = obj => typeof obj === 'string';
const defer = () => {
  let res;
  let rej;
  const promise = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  promise.resolve = res;
  promise.reject = rej;
  return promise;
};
const makeString = object => {
  if (object == null) return '';
  return '' + object;
};
const copy = (a, s, t) => {
  a.forEach(m => {
    if (s[m]) t[m] = s[m];
  });
};
const lastOfPathSeparatorRegExp = /###/g;
const cleanKey = key => key && key.indexOf('###') > -1 ? key.replace(lastOfPathSeparatorRegExp, '.') : key;
const canNotTraverseDeeper = object => !object || isString(object);
const getLastOfPath = (object, path, Empty) => {
  const stack = !isString(path) ? path : path.split('.');
  let stackIndex = 0;
  while (stackIndex < stack.length - 1) {
    if (canNotTraverseDeeper(object)) return {};
    const key = cleanKey(stack[stackIndex]);
    if (!object[key] && Empty) object[key] = new Empty();
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      object = object[key];
    } else {
      object = {};
    }
    ++stackIndex;
  }
  if (canNotTraverseDeeper(object)) return {};
  return {
    obj: object,
    k: cleanKey(stack[stackIndex])
  };
};
const setPath = (object, path, newValue) => {
  const {
    obj,
    k
  } = getLastOfPath(object, path, Object);
  if (obj !== undefined || path.length === 1) {
    obj[k] = newValue;
    return;
  }
  let e = path[path.length - 1];
  let p = path.slice(0, path.length - 1);
  let last = getLastOfPath(object, p, Object);
  while (last.obj === undefined && p.length) {
    e = `${p[p.length - 1]}.${e}`;
    p = p.slice(0, p.length - 1);
    last = getLastOfPath(object, p, Object);
    if (last?.obj && typeof last.obj[`${last.k}.${e}`] !== 'undefined') {
      last.obj = undefined;
    }
  }
  last.obj[`${last.k}.${e}`] = newValue;
};
const pushPath = (object, path, newValue, concat) => {
  const {
    obj,
    k
  } = getLastOfPath(object, path, Object);
  obj[k] = obj[k] || [];
  obj[k].push(newValue);
};
const getPath = (object, path) => {
  const {
    obj,
    k
  } = getLastOfPath(object, path);
  if (!obj) return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, k)) return undefined;
  return obj[k];
};
const getPathWithDefaults = (data, defaultData, key) => {
  const value = getPath(data, key);
  if (value !== undefined) {
    return value;
  }
  return getPath(defaultData, key);
};
const deepExtend = (target, source, overwrite) => {
  for (const prop in source) {
    if (prop !== '__proto__' && prop !== 'constructor') {
      if (prop in target) {
        if (isString(target[prop]) || target[prop] instanceof String || isString(source[prop]) || source[prop] instanceof String) {
          if (overwrite) target[prop] = source[prop];
        } else {
          deepExtend(target[prop], source[prop], overwrite);
        }
      } else {
        target[prop] = source[prop];
      }
    }
  }
  return target;
};
const regexEscape = str => str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
var _entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;'
};
const escape = data => {
  if (isString(data)) {
    return data.replace(/[&<>"'\/]/g, s => _entityMap[s]);
  }
  return data;
};
class RegExpCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.regExpMap = new Map();
    this.regExpQueue = [];
  }
  getRegExp(pattern) {
    const regExpFromCache = this.regExpMap.get(pattern);
    if (regExpFromCache !== undefined) {
      return regExpFromCache;
    }
    const regExpNew = new RegExp(pattern);
    if (this.regExpQueue.length === this.capacity) {
      this.regExpMap.delete(this.regExpQueue.shift());
    }
    this.regExpMap.set(pattern, regExpNew);
    this.regExpQueue.push(pattern);
    return regExpNew;
  }
}
const chars = [' ', ',', '?', '!', ';'];
const looksLikeObjectPathRegExpCache = new RegExpCache(20);
const looksLikeObjectPath = (key, nsSeparator, keySeparator) => {
  nsSeparator = nsSeparator || '';
  keySeparator = keySeparator || '';
  const possibleChars = chars.filter(c => nsSeparator.indexOf(c) < 0 && keySeparator.indexOf(c) < 0);
  if (possibleChars.length === 0) return true;
  const r = looksLikeObjectPathRegExpCache.getRegExp(`(${possibleChars.map(c => c === '?' ? '\\?' : c).join('|')})`);
  let matched = !r.test(key);
  if (!matched) {
    const ki = key.indexOf(keySeparator);
    if (ki > 0 && !r.test(key.substring(0, ki))) {
      matched = true;
    }
  }
  return matched;
};
const deepFind = (obj, path, keySeparator = '.') => {
  if (!obj) return undefined;
  if (obj[path]) {
    if (!Object.prototype.hasOwnProperty.call(obj, path)) return undefined;
    return obj[path];
  }
  const tokens = path.split(keySeparator);
  let current = obj;
  for (let i = 0; i < tokens.length;) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    let next;
    let nextPath = '';
    for (let j = i; j < tokens.length; ++j) {
      if (j !== i) {
        nextPath += keySeparator;
      }
      nextPath += tokens[j];
      next = current[nextPath];
      if (next !== undefined) {
        if (['string', 'number', 'boolean'].indexOf(typeof next) > -1 && j < tokens.length - 1) {
          continue;
        }
        i += j - i + 1;
        break;
      }
    }
    current = next;
  }
  return current;
};
const getCleanedCode = code => code?.replace('_', '-');

const consoleLogger = {
  type: 'logger',
  log(args) {
    this.output('log', args);
  },
  warn(args) {
    this.output('warn', args);
  },
  error(args) {
    this.output('error', args);
  },
  output(type, args) {
    console?.[type]?.apply?.(console, args);
  }
};
class Logger {
  constructor(concreteLogger, options = {}) {
    this.init(concreteLogger, options);
  }
  init(concreteLogger, options = {}) {
    this.prefix = options.prefix || 'i18next:';
    this.logger = concreteLogger || consoleLogger;
    this.options = options;
    this.debug = options.debug;
  }
  log(...args) {
    return this.forward(args, 'log', '', true);
  }
  warn(...args) {
    return this.forward(args, 'warn', '', true);
  }
  error(...args) {
    return this.forward(args, 'error', '');
  }
  deprecate(...args) {
    return this.forward(args, 'warn', 'WARNING DEPRECATED: ', true);
  }
  forward(args, lvl, prefix, debugOnly) {
    if (debugOnly && !this.debug) return null;
    if (isString(args[0])) args[0] = `${prefix}${this.prefix} ${args[0]}`;
    return this.logger[lvl](args);
  }
  create(moduleName) {
    return new Logger(this.logger, {
      ...{
        prefix: `${this.prefix}:${moduleName}:`
      },
      ...this.options
    });
  }
  clone(options) {
    options = options || this.options;
    options.prefix = options.prefix || this.prefix;
    return new Logger(this.logger, options);
  }
}
var baseLogger = new Logger();

class EventEmitter {
  constructor() {
    this.observers = {};
  }
  on(events, listener) {
    events.split(' ').forEach(event => {
      if (!this.observers[event]) this.observers[event] = new Map();
      const numListeners = this.observers[event].get(listener) || 0;
      this.observers[event].set(listener, numListeners + 1);
    });
    return this;
  }
  off(event, listener) {
    if (!this.observers[event]) return;
    if (!listener) {
      delete this.observers[event];
      return;
    }
    this.observers[event].delete(listener);
  }
  emit(event, ...args) {
    if (this.observers[event]) {
      const cloned = Array.from(this.observers[event].entries());
      cloned.forEach(([observer, numTimesAdded]) => {
        for (let i = 0; i < numTimesAdded; i++) {
          observer(...args);
        }
      });
    }
    if (this.observers['*']) {
      const cloned = Array.from(this.observers['*'].entries());
      cloned.forEach(([observer, numTimesAdded]) => {
        for (let i = 0; i < numTimesAdded; i++) {
          observer.apply(observer, [event, ...args]);
        }
      });
    }
  }
}

class ResourceStore extends EventEmitter {
  constructor(data, options = {
    ns: ['translation'],
    defaultNS: 'translation'
  }) {
    super();
    this.data = data || {};
    this.options = options;
    if (this.options.keySeparator === undefined) {
      this.options.keySeparator = '.';
    }
    if (this.options.ignoreJSONStructure === undefined) {
      this.options.ignoreJSONStructure = true;
    }
  }
  addNamespaces(ns) {
    if (this.options.ns.indexOf(ns) < 0) {
      this.options.ns.push(ns);
    }
  }
  removeNamespaces(ns) {
    const index = this.options.ns.indexOf(ns);
    if (index > -1) {
      this.options.ns.splice(index, 1);
    }
  }
  getResource(lng, ns, key, options = {}) {
    const keySeparator = options.keySeparator !== undefined ? options.keySeparator : this.options.keySeparator;
    const ignoreJSONStructure = options.ignoreJSONStructure !== undefined ? options.ignoreJSONStructure : this.options.ignoreJSONStructure;
    let path;
    if (lng.indexOf('.') > -1) {
      path = lng.split('.');
    } else {
      path = [lng, ns];
      if (key) {
        if (Array.isArray(key)) {
          path.push(...key);
        } else if (isString(key) && keySeparator) {
          path.push(...key.split(keySeparator));
        } else {
          path.push(key);
        }
      }
    }
    const result = getPath(this.data, path);
    if (!result && !ns && !key && lng.indexOf('.') > -1) {
      lng = path[0];
      ns = path[1];
      key = path.slice(2).join('.');
    }
    if (result || !ignoreJSONStructure || !isString(key)) return result;
    return deepFind(this.data?.[lng]?.[ns], key, keySeparator);
  }
  addResource(lng, ns, key, value, options = {
    silent: false
  }) {
    const keySeparator = options.keySeparator !== undefined ? options.keySeparator : this.options.keySeparator;
    let path = [lng, ns];
    if (key) path = path.concat(keySeparator ? key.split(keySeparator) : key);
    if (lng.indexOf('.') > -1) {
      path = lng.split('.');
      value = ns;
      ns = path[1];
    }
    this.addNamespaces(ns);
    setPath(this.data, path, value);
    if (!options.silent) this.emit('added', lng, ns, key, value);
  }
  addResources(lng, ns, resources, options = {
    silent: false
  }) {
    for (const m in resources) {
      if (isString(resources[m]) || Array.isArray(resources[m])) this.addResource(lng, ns, m, resources[m], {
        silent: true
      });
    }
    if (!options.silent) this.emit('added', lng, ns, resources);
  }
  addResourceBundle(lng, ns, resources, deep, overwrite, options = {
    silent: false,
    skipCopy: false
  }) {
    let path = [lng, ns];
    if (lng.indexOf('.') > -1) {
      path = lng.split('.');
      deep = resources;
      resources = ns;
      ns = path[1];
    }
    this.addNamespaces(ns);
    let pack = getPath(this.data, path) || {};
    if (!options.skipCopy) resources = JSON.parse(JSON.stringify(resources));
    if (deep) {
      deepExtend(pack, resources, overwrite);
    } else {
      pack = {
        ...pack,
        ...resources
      };
    }
    setPath(this.data, path, pack);
    if (!options.silent) this.emit('added', lng, ns, resources);
  }
  removeResourceBundle(lng, ns) {
    if (this.hasResourceBundle(lng, ns)) {
      delete this.data[lng][ns];
    }
    this.removeNamespaces(ns);
    this.emit('removed', lng, ns);
  }
  hasResourceBundle(lng, ns) {
    return this.getResource(lng, ns) !== undefined;
  }
  getResourceBundle(lng, ns) {
    if (!ns) ns = this.options.defaultNS;
    return this.getResource(lng, ns);
  }
  getDataByLanguage(lng) {
    return this.data[lng];
  }
  hasLanguageSomeTranslations(lng) {
    const data = this.getDataByLanguage(lng);
    const n = data && Object.keys(data) || [];
    return !!n.find(v => data[v] && Object.keys(data[v]).length > 0);
  }
  toJSON() {
    return this.data;
  }
}

var postProcessor = {
  processors: {},
  addPostProcessor(module) {
    this.processors[module.name] = module;
  },
  handle(processors, value, key, options, translator) {
    processors.forEach(processor => {
      value = this.processors[processor]?.process(value, key, options, translator) ?? value;
    });
    return value;
  }
};

const checkedLoadedFor = {};
const shouldHandleAsObject = res => !isString(res) && typeof res !== 'boolean' && typeof res !== 'number';
class Translator extends EventEmitter {
  constructor(services, options = {}) {
    super();
    copy(['resourceStore', 'languageUtils', 'pluralResolver', 'interpolator', 'backendConnector', 'i18nFormat', 'utils'], services, this);
    this.options = options;
    if (this.options.keySeparator === undefined) {
      this.options.keySeparator = '.';
    }
    this.logger = baseLogger.create('translator');
  }
  changeLanguage(lng) {
    if (lng) this.language = lng;
  }
  exists(key, o = {
    interpolation: {}
  }) {
    const opt = {
      ...o
    };
    if (key == null) return false;
    const resolved = this.resolve(key, opt);
    return resolved?.res !== undefined;
  }
  extractFromKey(key, opt) {
    let nsSeparator = opt.nsSeparator !== undefined ? opt.nsSeparator : this.options.nsSeparator;
    if (nsSeparator === undefined) nsSeparator = ':';
    const keySeparator = opt.keySeparator !== undefined ? opt.keySeparator : this.options.keySeparator;
    let namespaces = opt.ns || this.options.defaultNS || [];
    const wouldCheckForNsInKey = nsSeparator && key.indexOf(nsSeparator) > -1;
    const seemsNaturalLanguage = !this.options.userDefinedKeySeparator && !opt.keySeparator && !this.options.userDefinedNsSeparator && !opt.nsSeparator && !looksLikeObjectPath(key, nsSeparator, keySeparator);
    if (wouldCheckForNsInKey && !seemsNaturalLanguage) {
      const m = key.match(this.interpolator.nestingRegexp);
      if (m && m.length > 0) {
        return {
          key,
          namespaces: isString(namespaces) ? [namespaces] : namespaces
        };
      }
      const parts = key.split(nsSeparator);
      if (nsSeparator !== keySeparator || nsSeparator === keySeparator && this.options.ns.indexOf(parts[0]) > -1) namespaces = parts.shift();
      key = parts.join(keySeparator);
    }
    return {
      key,
      namespaces: isString(namespaces) ? [namespaces] : namespaces
    };
  }
  translate(keys, o, lastKey) {
    let opt = typeof o === 'object' ? {
      ...o
    } : o;
    if (typeof opt !== 'object' && this.options.overloadTranslationOptionHandler) {
      opt = this.options.overloadTranslationOptionHandler(arguments);
    }
    if (typeof options === 'object') opt = {
      ...opt
    };
    if (!opt) opt = {};
    if (keys == null) return '';
    if (!Array.isArray(keys)) keys = [String(keys)];
    const returnDetails = opt.returnDetails !== undefined ? opt.returnDetails : this.options.returnDetails;
    const keySeparator = opt.keySeparator !== undefined ? opt.keySeparator : this.options.keySeparator;
    const {
      key,
      namespaces
    } = this.extractFromKey(keys[keys.length - 1], opt);
    const namespace = namespaces[namespaces.length - 1];
    let nsSeparator = opt.nsSeparator !== undefined ? opt.nsSeparator : this.options.nsSeparator;
    if (nsSeparator === undefined) nsSeparator = ':';
    const lng = opt.lng || this.language;
    const appendNamespaceToCIMode = opt.appendNamespaceToCIMode || this.options.appendNamespaceToCIMode;
    if (lng?.toLowerCase() === 'cimode') {
      if (appendNamespaceToCIMode) {
        if (returnDetails) {
          return {
            res: `${namespace}${nsSeparator}${key}`,
            usedKey: key,
            exactUsedKey: key,
            usedLng: lng,
            usedNS: namespace,
            usedParams: this.getUsedParamsDetails(opt)
          };
        }
        return `${namespace}${nsSeparator}${key}`;
      }
      if (returnDetails) {
        return {
          res: key,
          usedKey: key,
          exactUsedKey: key,
          usedLng: lng,
          usedNS: namespace,
          usedParams: this.getUsedParamsDetails(opt)
        };
      }
      return key;
    }
    const resolved = this.resolve(keys, opt);
    let res = resolved?.res;
    const resUsedKey = resolved?.usedKey || key;
    const resExactUsedKey = resolved?.exactUsedKey || key;
    const noObject = ['[object Number]', '[object Function]', '[object RegExp]'];
    const joinArrays = opt.joinArrays !== undefined ? opt.joinArrays : this.options.joinArrays;
    const handleAsObjectInI18nFormat = !this.i18nFormat || this.i18nFormat.handleAsObject;
    const needsPluralHandling = opt.count !== undefined && !isString(opt.count);
    const hasDefaultValue = Translator.hasDefaultValue(opt);
    const defaultValueSuffix = needsPluralHandling ? this.pluralResolver.getSuffix(lng, opt.count, opt) : '';
    const defaultValueSuffixOrdinalFallback = opt.ordinal && needsPluralHandling ? this.pluralResolver.getSuffix(lng, opt.count, {
      ordinal: false
    }) : '';
    const needsZeroSuffixLookup = needsPluralHandling && !opt.ordinal && opt.count === 0;
    const defaultValue = needsZeroSuffixLookup && opt[`defaultValue${this.options.pluralSeparator}zero`] || opt[`defaultValue${defaultValueSuffix}`] || opt[`defaultValue${defaultValueSuffixOrdinalFallback}`] || opt.defaultValue;
    let resForObjHndl = res;
    if (handleAsObjectInI18nFormat && !res && hasDefaultValue) {
      resForObjHndl = defaultValue;
    }
    const handleAsObject = shouldHandleAsObject(resForObjHndl);
    const resType = Object.prototype.toString.apply(resForObjHndl);
    if (handleAsObjectInI18nFormat && resForObjHndl && handleAsObject && noObject.indexOf(resType) < 0 && !(isString(joinArrays) && Array.isArray(resForObjHndl))) {
      if (!opt.returnObjects && !this.options.returnObjects) {
        if (!this.options.returnedObjectHandler) {
          this.logger.warn('accessing an object - but returnObjects options is not enabled!');
        }
        const r = this.options.returnedObjectHandler ? this.options.returnedObjectHandler(resUsedKey, resForObjHndl, {
          ...opt,
          ns: namespaces
        }) : `key '${key} (${this.language})' returned an object instead of string.`;
        if (returnDetails) {
          resolved.res = r;
          resolved.usedParams = this.getUsedParamsDetails(opt);
          return resolved;
        }
        return r;
      }
      if (keySeparator) {
        const resTypeIsArray = Array.isArray(resForObjHndl);
        const copy = resTypeIsArray ? [] : {};
        const newKeyToUse = resTypeIsArray ? resExactUsedKey : resUsedKey;
        for (const m in resForObjHndl) {
          if (Object.prototype.hasOwnProperty.call(resForObjHndl, m)) {
            const deepKey = `${newKeyToUse}${keySeparator}${m}`;
            if (hasDefaultValue && !res) {
              copy[m] = this.translate(deepKey, {
                ...opt,
                defaultValue: shouldHandleAsObject(defaultValue) ? defaultValue[m] : undefined,
                ...{
                  joinArrays: false,
                  ns: namespaces
                }
              });
            } else {
              copy[m] = this.translate(deepKey, {
                ...opt,
                ...{
                  joinArrays: false,
                  ns: namespaces
                }
              });
            }
            if (copy[m] === deepKey) copy[m] = resForObjHndl[m];
          }
        }
        res = copy;
      }
    } else if (handleAsObjectInI18nFormat && isString(joinArrays) && Array.isArray(res)) {
      res = res.join(joinArrays);
      if (res) res = this.extendTranslation(res, keys, opt, lastKey);
    } else {
      let usedDefault = false;
      let usedKey = false;
      if (!this.isValidLookup(res) && hasDefaultValue) {
        usedDefault = true;
        res = defaultValue;
      }
      if (!this.isValidLookup(res)) {
        usedKey = true;
        res = key;
      }
      const missingKeyNoValueFallbackToKey = opt.missingKeyNoValueFallbackToKey || this.options.missingKeyNoValueFallbackToKey;
      const resForMissing = missingKeyNoValueFallbackToKey && usedKey ? undefined : res;
      const updateMissing = hasDefaultValue && defaultValue !== res && this.options.updateMissing;
      if (usedKey || usedDefault || updateMissing) {
        this.logger.log(updateMissing ? 'updateKey' : 'missingKey', lng, namespace, key, updateMissing ? defaultValue : res);
        if (keySeparator) {
          const fk = this.resolve(key, {
            ...opt,
            keySeparator: false
          });
          if (fk && fk.res) this.logger.warn('Seems the loaded translations were in flat JSON format instead of nested. Either set keySeparator: false on init or make sure your translations are published in nested format.');
        }
        let lngs = [];
        const fallbackLngs = this.languageUtils.getFallbackCodes(this.options.fallbackLng, opt.lng || this.language);
        if (this.options.saveMissingTo === 'fallback' && fallbackLngs && fallbackLngs[0]) {
          for (let i = 0; i < fallbackLngs.length; i++) {
            lngs.push(fallbackLngs[i]);
          }
        } else if (this.options.saveMissingTo === 'all') {
          lngs = this.languageUtils.toResolveHierarchy(opt.lng || this.language);
        } else {
          lngs.push(opt.lng || this.language);
        }
        const send = (l, k, specificDefaultValue) => {
          const defaultForMissing = hasDefaultValue && specificDefaultValue !== res ? specificDefaultValue : resForMissing;
          if (this.options.missingKeyHandler) {
            this.options.missingKeyHandler(l, namespace, k, defaultForMissing, updateMissing, opt);
          } else if (this.backendConnector?.saveMissing) {
            this.backendConnector.saveMissing(l, namespace, k, defaultForMissing, updateMissing, opt);
          }
          this.emit('missingKey', l, namespace, k, res);
        };
        if (this.options.saveMissing) {
          if (this.options.saveMissingPlurals && needsPluralHandling) {
            lngs.forEach(language => {
              const suffixes = this.pluralResolver.getSuffixes(language, opt);
              if (needsZeroSuffixLookup && opt[`defaultValue${this.options.pluralSeparator}zero`] && suffixes.indexOf(`${this.options.pluralSeparator}zero`) < 0) {
                suffixes.push(`${this.options.pluralSeparator}zero`);
              }
              suffixes.forEach(suffix => {
                send([language], key + suffix, opt[`defaultValue${suffix}`] || defaultValue);
              });
            });
          } else {
            send(lngs, key, defaultValue);
          }
        }
      }
      res = this.extendTranslation(res, keys, opt, resolved, lastKey);
      if (usedKey && res === key && this.options.appendNamespaceToMissingKey) {
        res = `${namespace}${nsSeparator}${key}`;
      }
      if ((usedKey || usedDefault) && this.options.parseMissingKeyHandler) {
        res = this.options.parseMissingKeyHandler(this.options.appendNamespaceToMissingKey ? `${namespace}${nsSeparator}${key}` : key, usedDefault ? res : undefined, opt);
      }
    }
    if (returnDetails) {
      resolved.res = res;
      resolved.usedParams = this.getUsedParamsDetails(opt);
      return resolved;
    }
    return res;
  }
  extendTranslation(res, key, opt, resolved, lastKey) {
    if (this.i18nFormat?.parse) {
      res = this.i18nFormat.parse(res, {
        ...this.options.interpolation.defaultVariables,
        ...opt
      }, opt.lng || this.language || resolved.usedLng, resolved.usedNS, resolved.usedKey, {
        resolved
      });
    } else if (!opt.skipInterpolation) {
      if (opt.interpolation) this.interpolator.init({
        ...opt,
        ...{
          interpolation: {
            ...this.options.interpolation,
            ...opt.interpolation
          }
        }
      });
      const skipOnVariables = isString(res) && (opt?.interpolation?.skipOnVariables !== undefined ? opt.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables);
      let nestBef;
      if (skipOnVariables) {
        const nb = res.match(this.interpolator.nestingRegexp);
        nestBef = nb && nb.length;
      }
      let data = opt.replace && !isString(opt.replace) ? opt.replace : opt;
      if (this.options.interpolation.defaultVariables) data = {
        ...this.options.interpolation.defaultVariables,
        ...data
      };
      res = this.interpolator.interpolate(res, data, opt.lng || this.language || resolved.usedLng, opt);
      if (skipOnVariables) {
        const na = res.match(this.interpolator.nestingRegexp);
        const nestAft = na && na.length;
        if (nestBef < nestAft) opt.nest = false;
      }
      if (!opt.lng && resolved && resolved.res) opt.lng = this.language || resolved.usedLng;
      if (opt.nest !== false) res = this.interpolator.nest(res, (...args) => {
        if (lastKey?.[0] === args[0] && !opt.context) {
          this.logger.warn(`It seems you are nesting recursively key: ${args[0]} in key: ${key[0]}`);
          return null;
        }
        return this.translate(...args, key);
      }, opt);
      if (opt.interpolation) this.interpolator.reset();
    }
    const postProcess = opt.postProcess || this.options.postProcess;
    const postProcessorNames = isString(postProcess) ? [postProcess] : postProcess;
    if (res != null && postProcessorNames?.length && opt.applyPostProcessor !== false) {
      res = postProcessor.handle(postProcessorNames, res, key, this.options && this.options.postProcessPassResolved ? {
        i18nResolved: {
          ...resolved,
          usedParams: this.getUsedParamsDetails(opt)
        },
        ...opt
      } : opt, this);
    }
    return res;
  }
  resolve(keys, opt = {}) {
    let found;
    let usedKey;
    let exactUsedKey;
    let usedLng;
    let usedNS;
    if (isString(keys)) keys = [keys];
    keys.forEach(k => {
      if (this.isValidLookup(found)) return;
      const extracted = this.extractFromKey(k, opt);
      const key = extracted.key;
      usedKey = key;
      let namespaces = extracted.namespaces;
      if (this.options.fallbackNS) namespaces = namespaces.concat(this.options.fallbackNS);
      const needsPluralHandling = opt.count !== undefined && !isString(opt.count);
      const needsZeroSuffixLookup = needsPluralHandling && !opt.ordinal && opt.count === 0;
      const needsContextHandling = opt.context !== undefined && (isString(opt.context) || typeof opt.context === 'number') && opt.context !== '';
      const codes = opt.lngs ? opt.lngs : this.languageUtils.toResolveHierarchy(opt.lng || this.language, opt.fallbackLng);
      namespaces.forEach(ns => {
        if (this.isValidLookup(found)) return;
        usedNS = ns;
        if (!checkedLoadedFor[`${codes[0]}-${ns}`] && this.utils?.hasLoadedNamespace && !this.utils?.hasLoadedNamespace(usedNS)) {
          checkedLoadedFor[`${codes[0]}-${ns}`] = true;
          this.logger.warn(`key "${usedKey}" for languages "${codes.join(', ')}" won't get resolved as namespace "${usedNS}" was not yet loaded`, 'This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!');
        }
        codes.forEach(code => {
          if (this.isValidLookup(found)) return;
          usedLng = code;
          const finalKeys = [key];
          if (this.i18nFormat?.addLookupKeys) {
            this.i18nFormat.addLookupKeys(finalKeys, key, code, ns, opt);
          } else {
            let pluralSuffix;
            if (needsPluralHandling) pluralSuffix = this.pluralResolver.getSuffix(code, opt.count, opt);
            const zeroSuffix = `${this.options.pluralSeparator}zero`;
            const ordinalPrefix = `${this.options.pluralSeparator}ordinal${this.options.pluralSeparator}`;
            if (needsPluralHandling) {
              finalKeys.push(key + pluralSuffix);
              if (opt.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                finalKeys.push(key + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
              }
              if (needsZeroSuffixLookup) {
                finalKeys.push(key + zeroSuffix);
              }
            }
            if (needsContextHandling) {
              const contextKey = `${key}${this.options.contextSeparator}${opt.context}`;
              finalKeys.push(contextKey);
              if (needsPluralHandling) {
                finalKeys.push(contextKey + pluralSuffix);
                if (opt.ordinal && pluralSuffix.indexOf(ordinalPrefix) === 0) {
                  finalKeys.push(contextKey + pluralSuffix.replace(ordinalPrefix, this.options.pluralSeparator));
                }
                if (needsZeroSuffixLookup) {
                  finalKeys.push(contextKey + zeroSuffix);
                }
              }
            }
          }
          let possibleKey;
          while (possibleKey = finalKeys.pop()) {
            if (!this.isValidLookup(found)) {
              exactUsedKey = possibleKey;
              found = this.getResource(code, ns, possibleKey, opt);
            }
          }
        });
      });
    });
    return {
      res: found,
      usedKey,
      exactUsedKey,
      usedLng,
      usedNS
    };
  }
  isValidLookup(res) {
    return res !== undefined && !(!this.options.returnNull && res === null) && !(!this.options.returnEmptyString && res === '');
  }
  getResource(code, ns, key, options = {}) {
    if (this.i18nFormat?.getResource) return this.i18nFormat.getResource(code, ns, key, options);
    return this.resourceStore.getResource(code, ns, key, options);
  }
  getUsedParamsDetails(options = {}) {
    const optionsKeys = ['defaultValue', 'ordinal', 'context', 'replace', 'lng', 'lngs', 'fallbackLng', 'ns', 'keySeparator', 'nsSeparator', 'returnObjects', 'returnDetails', 'joinArrays', 'postProcess', 'interpolation'];
    const useOptionsReplaceForData = options.replace && !isString(options.replace);
    let data = useOptionsReplaceForData ? options.replace : options;
    if (useOptionsReplaceForData && typeof options.count !== 'undefined') {
      data.count = options.count;
    }
    if (this.options.interpolation.defaultVariables) {
      data = {
        ...this.options.interpolation.defaultVariables,
        ...data
      };
    }
    if (!useOptionsReplaceForData) {
      data = {
        ...data
      };
      for (const key of optionsKeys) {
        delete data[key];
      }
    }
    return data;
  }
  static hasDefaultValue(options) {
    const prefix = 'defaultValue';
    for (const option in options) {
      if (Object.prototype.hasOwnProperty.call(options, option) && prefix === option.substring(0, prefix.length) && undefined !== options[option]) {
        return true;
      }
    }
    return false;
  }
}

class LanguageUtil {
  constructor(options) {
    this.options = options;
    this.supportedLngs = this.options.supportedLngs || false;
    this.logger = baseLogger.create('languageUtils');
  }
  getScriptPartFromCode(code) {
    code = getCleanedCode(code);
    if (!code || code.indexOf('-') < 0) return null;
    const p = code.split('-');
    if (p.length === 2) return null;
    p.pop();
    if (p[p.length - 1].toLowerCase() === 'x') return null;
    return this.formatLanguageCode(p.join('-'));
  }
  getLanguagePartFromCode(code) {
    code = getCleanedCode(code);
    if (!code || code.indexOf('-') < 0) return code;
    const p = code.split('-');
    return this.formatLanguageCode(p[0]);
  }
  formatLanguageCode(code) {
    if (isString(code) && code.indexOf('-') > -1) {
      let formattedCode;
      try {
        formattedCode = Intl.getCanonicalLocales(code)[0];
      } catch (e) {}
      if (formattedCode && this.options.lowerCaseLng) {
        formattedCode = formattedCode.toLowerCase();
      }
      if (formattedCode) return formattedCode;
      if (this.options.lowerCaseLng) {
        return code.toLowerCase();
      }
      return code;
    }
    return this.options.cleanCode || this.options.lowerCaseLng ? code.toLowerCase() : code;
  }
  isSupportedCode(code) {
    if (this.options.load === 'languageOnly' || this.options.nonExplicitSupportedLngs) {
      code = this.getLanguagePartFromCode(code);
    }
    return !this.supportedLngs || !this.supportedLngs.length || this.supportedLngs.indexOf(code) > -1;
  }
  getBestMatchFromCodes(codes) {
    if (!codes) return null;
    let found;
    codes.forEach(code => {
      if (found) return;
      const cleanedLng = this.formatLanguageCode(code);
      if (!this.options.supportedLngs || this.isSupportedCode(cleanedLng)) found = cleanedLng;
    });
    if (!found && this.options.supportedLngs) {
      codes.forEach(code => {
        if (found) return;
        const lngScOnly = this.getScriptPartFromCode(code);
        if (this.isSupportedCode(lngScOnly)) return found = lngScOnly;
        const lngOnly = this.getLanguagePartFromCode(code);
        if (this.isSupportedCode(lngOnly)) return found = lngOnly;
        found = this.options.supportedLngs.find(supportedLng => {
          if (supportedLng === lngOnly) return supportedLng;
          if (supportedLng.indexOf('-') < 0 && lngOnly.indexOf('-') < 0) return;
          if (supportedLng.indexOf('-') > 0 && lngOnly.indexOf('-') < 0 && supportedLng.substring(0, supportedLng.indexOf('-')) === lngOnly) return supportedLng;
          if (supportedLng.indexOf(lngOnly) === 0 && lngOnly.length > 1) return supportedLng;
        });
      });
    }
    if (!found) found = this.getFallbackCodes(this.options.fallbackLng)[0];
    return found;
  }
  getFallbackCodes(fallbacks, code) {
    if (!fallbacks) return [];
    if (typeof fallbacks === 'function') fallbacks = fallbacks(code);
    if (isString(fallbacks)) fallbacks = [fallbacks];
    if (Array.isArray(fallbacks)) return fallbacks;
    if (!code) return fallbacks.default || [];
    let found = fallbacks[code];
    if (!found) found = fallbacks[this.getScriptPartFromCode(code)];
    if (!found) found = fallbacks[this.formatLanguageCode(code)];
    if (!found) found = fallbacks[this.getLanguagePartFromCode(code)];
    if (!found) found = fallbacks.default;
    return found || [];
  }
  toResolveHierarchy(code, fallbackCode) {
    const fallbackCodes = this.getFallbackCodes((fallbackCode === false ? [] : fallbackCode) || this.options.fallbackLng || [], code);
    const codes = [];
    const addCode = c => {
      if (!c) return;
      if (this.isSupportedCode(c)) {
        codes.push(c);
      } else {
        this.logger.warn(`rejecting language code not found in supportedLngs: ${c}`);
      }
    };
    if (isString(code) && (code.indexOf('-') > -1 || code.indexOf('_') > -1)) {
      if (this.options.load !== 'languageOnly') addCode(this.formatLanguageCode(code));
      if (this.options.load !== 'languageOnly' && this.options.load !== 'currentOnly') addCode(this.getScriptPartFromCode(code));
      if (this.options.load !== 'currentOnly') addCode(this.getLanguagePartFromCode(code));
    } else if (isString(code)) {
      addCode(this.formatLanguageCode(code));
    }
    fallbackCodes.forEach(fc => {
      if (codes.indexOf(fc) < 0) addCode(this.formatLanguageCode(fc));
    });
    return codes;
  }
}

const suffixesOrder = {
  zero: 0,
  one: 1,
  two: 2,
  few: 3,
  many: 4,
  other: 5
};
const dummyRule = {
  select: count => count === 1 ? 'one' : 'other',
  resolvedOptions: () => ({
    pluralCategories: ['one', 'other']
  })
};
class PluralResolver {
  constructor(languageUtils, options = {}) {
    this.languageUtils = languageUtils;
    this.options = options;
    this.logger = baseLogger.create('pluralResolver');
    this.pluralRulesCache = {};
  }
  addRule(lng, obj) {
    this.rules[lng] = obj;
  }
  clearCache() {
    this.pluralRulesCache = {};
  }
  getRule(code, options = {}) {
    const cleanedCode = getCleanedCode(code === 'dev' ? 'en' : code);
    const type = options.ordinal ? 'ordinal' : 'cardinal';
    const cacheKey = JSON.stringify({
      cleanedCode,
      type
    });
    if (cacheKey in this.pluralRulesCache) {
      return this.pluralRulesCache[cacheKey];
    }
    let rule;
    try {
      rule = new Intl.PluralRules(cleanedCode, {
        type
      });
    } catch (err) {
      if (!Intl) {
        this.logger.error('No Intl support, please use an Intl polyfill!');
        return dummyRule;
      }
      if (!code.match(/-|_/)) return dummyRule;
      const lngPart = this.languageUtils.getLanguagePartFromCode(code);
      rule = this.getRule(lngPart, options);
    }
    this.pluralRulesCache[cacheKey] = rule;
    return rule;
  }
  needsPlural(code, options = {}) {
    let rule = this.getRule(code, options);
    if (!rule) rule = this.getRule('dev', options);
    return rule?.resolvedOptions().pluralCategories.length > 1;
  }
  getPluralFormsOfKey(code, key, options = {}) {
    return this.getSuffixes(code, options).map(suffix => `${key}${suffix}`);
  }
  getSuffixes(code, options = {}) {
    let rule = this.getRule(code, options);
    if (!rule) rule = this.getRule('dev', options);
    if (!rule) return [];
    return rule.resolvedOptions().pluralCategories.sort((pluralCategory1, pluralCategory2) => suffixesOrder[pluralCategory1] - suffixesOrder[pluralCategory2]).map(pluralCategory => `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ''}${pluralCategory}`);
  }
  getSuffix(code, count, options = {}) {
    const rule = this.getRule(code, options);
    if (rule) {
      return `${this.options.prepend}${options.ordinal ? `ordinal${this.options.prepend}` : ''}${rule.select(count)}`;
    }
    this.logger.warn(`no plural rule found for: ${code}`);
    return this.getSuffix('dev', count, options);
  }
}

const deepFindWithDefaults = (data, defaultData, key, keySeparator = '.', ignoreJSONStructure = true) => {
  let path = getPathWithDefaults(data, defaultData, key);
  if (!path && ignoreJSONStructure && isString(key)) {
    path = deepFind(data, key, keySeparator);
    if (path === undefined) path = deepFind(defaultData, key, keySeparator);
  }
  return path;
};
const regexSafe = val => val.replace(/\$/g, '$$$$');
class Interpolator {
  constructor(options = {}) {
    this.logger = baseLogger.create('interpolator');
    this.options = options;
    this.format = options?.interpolation?.format || (value => value);
    this.init(options);
  }
  init(options = {}) {
    if (!options.interpolation) options.interpolation = {
      escapeValue: true
    };
    const {
      escape: escape$1,
      escapeValue,
      useRawValueToEscape,
      prefix,
      prefixEscaped,
      suffix,
      suffixEscaped,
      formatSeparator,
      unescapeSuffix,
      unescapePrefix,
      nestingPrefix,
      nestingPrefixEscaped,
      nestingSuffix,
      nestingSuffixEscaped,
      nestingOptionsSeparator,
      maxReplaces,
      alwaysFormat
    } = options.interpolation;
    this.escape = escape$1 !== undefined ? escape$1 : escape;
    this.escapeValue = escapeValue !== undefined ? escapeValue : true;
    this.useRawValueToEscape = useRawValueToEscape !== undefined ? useRawValueToEscape : false;
    this.prefix = prefix ? regexEscape(prefix) : prefixEscaped || '{{';
    this.suffix = suffix ? regexEscape(suffix) : suffixEscaped || '}}';
    this.formatSeparator = formatSeparator || ',';
    this.unescapePrefix = unescapeSuffix ? '' : unescapePrefix || '-';
    this.unescapeSuffix = this.unescapePrefix ? '' : unescapeSuffix || '';
    this.nestingPrefix = nestingPrefix ? regexEscape(nestingPrefix) : nestingPrefixEscaped || regexEscape('$t(');
    this.nestingSuffix = nestingSuffix ? regexEscape(nestingSuffix) : nestingSuffixEscaped || regexEscape(')');
    this.nestingOptionsSeparator = nestingOptionsSeparator || ',';
    this.maxReplaces = maxReplaces || 1000;
    this.alwaysFormat = alwaysFormat !== undefined ? alwaysFormat : false;
    this.resetRegExp();
  }
  reset() {
    if (this.options) this.init(this.options);
  }
  resetRegExp() {
    const getOrResetRegExp = (existingRegExp, pattern) => {
      if (existingRegExp?.source === pattern) {
        existingRegExp.lastIndex = 0;
        return existingRegExp;
      }
      return new RegExp(pattern, 'g');
    };
    this.regexp = getOrResetRegExp(this.regexp, `${this.prefix}(.+?)${this.suffix}`);
    this.regexpUnescape = getOrResetRegExp(this.regexpUnescape, `${this.prefix}${this.unescapePrefix}(.+?)${this.unescapeSuffix}${this.suffix}`);
    this.nestingRegexp = getOrResetRegExp(this.nestingRegexp, `${this.nestingPrefix}(.+?)${this.nestingSuffix}`);
  }
  interpolate(str, data, lng, options) {
    let match;
    let value;
    let replaces;
    const defaultData = this.options && this.options.interpolation && this.options.interpolation.defaultVariables || {};
    const handleFormat = key => {
      if (key.indexOf(this.formatSeparator) < 0) {
        const path = deepFindWithDefaults(data, defaultData, key, this.options.keySeparator, this.options.ignoreJSONStructure);
        return this.alwaysFormat ? this.format(path, undefined, lng, {
          ...options,
          ...data,
          interpolationkey: key
        }) : path;
      }
      const p = key.split(this.formatSeparator);
      const k = p.shift().trim();
      const f = p.join(this.formatSeparator).trim();
      return this.format(deepFindWithDefaults(data, defaultData, k, this.options.keySeparator, this.options.ignoreJSONStructure), f, lng, {
        ...options,
        ...data,
        interpolationkey: k
      });
    };
    this.resetRegExp();
    const missingInterpolationHandler = options?.missingInterpolationHandler || this.options.missingInterpolationHandler;
    const skipOnVariables = options?.interpolation?.skipOnVariables !== undefined ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables;
    const todos = [{
      regex: this.regexpUnescape,
      safeValue: val => regexSafe(val)
    }, {
      regex: this.regexp,
      safeValue: val => this.escapeValue ? regexSafe(this.escape(val)) : regexSafe(val)
    }];
    todos.forEach(todo => {
      replaces = 0;
      while (match = todo.regex.exec(str)) {
        const matchedVar = match[1].trim();
        value = handleFormat(matchedVar);
        if (value === undefined) {
          if (typeof missingInterpolationHandler === 'function') {
            const temp = missingInterpolationHandler(str, match, options);
            value = isString(temp) ? temp : '';
          } else if (options && Object.prototype.hasOwnProperty.call(options, matchedVar)) {
            value = '';
          } else if (skipOnVariables) {
            value = match[0];
            continue;
          } else {
            this.logger.warn(`missed to pass in variable ${matchedVar} for interpolating ${str}`);
            value = '';
          }
        } else if (!isString(value) && !this.useRawValueToEscape) {
          value = makeString(value);
        }
        const safeValue = todo.safeValue(value);
        str = str.replace(match[0], safeValue);
        if (skipOnVariables) {
          todo.regex.lastIndex += value.length;
          todo.regex.lastIndex -= match[0].length;
        } else {
          todo.regex.lastIndex = 0;
        }
        replaces++;
        if (replaces >= this.maxReplaces) {
          break;
        }
      }
    });
    return str;
  }
  nest(str, fc, options = {}) {
    let match;
    let value;
    let clonedOptions;
    const handleHasOptions = (key, inheritedOptions) => {
      const sep = this.nestingOptionsSeparator;
      if (key.indexOf(sep) < 0) return key;
      const c = key.split(new RegExp(`${sep}[ ]*{`));
      let optionsString = `{${c[1]}`;
      key = c[0];
      optionsString = this.interpolate(optionsString, clonedOptions);
      const matchedSingleQuotes = optionsString.match(/'/g);
      const matchedDoubleQuotes = optionsString.match(/"/g);
      if ((matchedSingleQuotes?.length ?? 0) % 2 === 0 && !matchedDoubleQuotes || matchedDoubleQuotes.length % 2 !== 0) {
        optionsString = optionsString.replace(/'/g, '"');
      }
      try {
        clonedOptions = JSON.parse(optionsString);
        if (inheritedOptions) clonedOptions = {
          ...inheritedOptions,
          ...clonedOptions
        };
      } catch (e) {
        this.logger.warn(`failed parsing options string in nesting for key ${key}`, e);
        return `${key}${sep}${optionsString}`;
      }
      if (clonedOptions.defaultValue && clonedOptions.defaultValue.indexOf(this.prefix) > -1) delete clonedOptions.defaultValue;
      return key;
    };
    while (match = this.nestingRegexp.exec(str)) {
      let formatters = [];
      clonedOptions = {
        ...options
      };
      clonedOptions = clonedOptions.replace && !isString(clonedOptions.replace) ? clonedOptions.replace : clonedOptions;
      clonedOptions.applyPostProcessor = false;
      delete clonedOptions.defaultValue;
      let doReduce = false;
      if (match[0].indexOf(this.formatSeparator) !== -1 && !/{.*}/.test(match[1])) {
        const r = match[1].split(this.formatSeparator).map(elem => elem.trim());
        match[1] = r.shift();
        formatters = r;
        doReduce = true;
      }
      value = fc(handleHasOptions.call(this, match[1].trim(), clonedOptions), clonedOptions);
      if (value && match[0] === str && !isString(value)) return value;
      if (!isString(value)) value = makeString(value);
      if (!value) {
        this.logger.warn(`missed to resolve ${match[1]} for nesting ${str}`);
        value = '';
      }
      if (doReduce) {
        value = formatters.reduce((v, f) => this.format(v, f, options.lng, {
          ...options,
          interpolationkey: match[1].trim()
        }), value.trim());
      }
      str = str.replace(match[0], value);
      this.regexp.lastIndex = 0;
    }
    return str;
  }
}

const parseFormatStr = formatStr => {
  let formatName = formatStr.toLowerCase().trim();
  const formatOptions = {};
  if (formatStr.indexOf('(') > -1) {
    const p = formatStr.split('(');
    formatName = p[0].toLowerCase().trim();
    const optStr = p[1].substring(0, p[1].length - 1);
    if (formatName === 'currency' && optStr.indexOf(':') < 0) {
      if (!formatOptions.currency) formatOptions.currency = optStr.trim();
    } else if (formatName === 'relativetime' && optStr.indexOf(':') < 0) {
      if (!formatOptions.range) formatOptions.range = optStr.trim();
    } else {
      const opts = optStr.split(';');
      opts.forEach(opt => {
        if (opt) {
          const [key, ...rest] = opt.split(':');
          const val = rest.join(':').trim().replace(/^'+|'+$/g, '');
          const trimmedKey = key.trim();
          if (!formatOptions[trimmedKey]) formatOptions[trimmedKey] = val;
          if (val === 'false') formatOptions[trimmedKey] = false;
          if (val === 'true') formatOptions[trimmedKey] = true;
          if (!isNaN(val)) formatOptions[trimmedKey] = parseInt(val, 10);
        }
      });
    }
  }
  return {
    formatName,
    formatOptions
  };
};
const createCachedFormatter = fn => {
  const cache = {};
  return (v, l, o) => {
    let optForCache = o;
    if (o && o.interpolationkey && o.formatParams && o.formatParams[o.interpolationkey] && o[o.interpolationkey]) {
      optForCache = {
        ...optForCache,
        [o.interpolationkey]: undefined
      };
    }
    const key = l + JSON.stringify(optForCache);
    let frm = cache[key];
    if (!frm) {
      frm = fn(getCleanedCode(l), o);
      cache[key] = frm;
    }
    return frm(v);
  };
};
const createNonCachedFormatter = fn => (v, l, o) => fn(getCleanedCode(l), o)(v);
class Formatter {
  constructor(options = {}) {
    this.logger = baseLogger.create('formatter');
    this.options = options;
    this.init(options);
  }
  init(services, options = {
    interpolation: {}
  }) {
    this.formatSeparator = options.interpolation.formatSeparator || ',';
    const cf = options.cacheInBuiltFormats ? createCachedFormatter : createNonCachedFormatter;
    this.formats = {
      number: cf((lng, opt) => {
        const formatter = new Intl.NumberFormat(lng, {
          ...opt
        });
        return val => formatter.format(val);
      }),
      currency: cf((lng, opt) => {
        const formatter = new Intl.NumberFormat(lng, {
          ...opt,
          style: 'currency'
        });
        return val => formatter.format(val);
      }),
      datetime: cf((lng, opt) => {
        const formatter = new Intl.DateTimeFormat(lng, {
          ...opt
        });
        return val => formatter.format(val);
      }),
      relativetime: cf((lng, opt) => {
        const formatter = new Intl.RelativeTimeFormat(lng, {
          ...opt
        });
        return val => formatter.format(val, opt.range || 'day');
      }),
      list: cf((lng, opt) => {
        const formatter = new Intl.ListFormat(lng, {
          ...opt
        });
        return val => formatter.format(val);
      })
    };
  }
  add(name, fc) {
    this.formats[name.toLowerCase().trim()] = fc;
  }
  addCached(name, fc) {
    this.formats[name.toLowerCase().trim()] = createCachedFormatter(fc);
  }
  format(value, format, lng, options = {}) {
    const formats = format.split(this.formatSeparator);
    if (formats.length > 1 && formats[0].indexOf('(') > 1 && formats[0].indexOf(')') < 0 && formats.find(f => f.indexOf(')') > -1)) {
      const lastIndex = formats.findIndex(f => f.indexOf(')') > -1);
      formats[0] = [formats[0], ...formats.splice(1, lastIndex)].join(this.formatSeparator);
    }
    const result = formats.reduce((mem, f) => {
      const {
        formatName,
        formatOptions
      } = parseFormatStr(f);
      if (this.formats[formatName]) {
        let formatted = mem;
        try {
          const valOptions = options?.formatParams?.[options.interpolationkey] || {};
          const l = valOptions.locale || valOptions.lng || options.locale || options.lng || lng;
          formatted = this.formats[formatName](mem, l, {
            ...formatOptions,
            ...options,
            ...valOptions
          });
        } catch (error) {
          this.logger.warn(error);
        }
        return formatted;
      } else {
        this.logger.warn(`there was no format function for ${formatName}`);
      }
      return mem;
    }, value);
    return result;
  }
}

const removePending = (q, name) => {
  if (q.pending[name] !== undefined) {
    delete q.pending[name];
    q.pendingCount--;
  }
};
class Connector extends EventEmitter {
  constructor(backend, store, services, options = {}) {
    super();
    this.backend = backend;
    this.store = store;
    this.services = services;
    this.languageUtils = services.languageUtils;
    this.options = options;
    this.logger = baseLogger.create('backendConnector');
    this.waitingReads = [];
    this.maxParallelReads = options.maxParallelReads || 10;
    this.readingCalls = 0;
    this.maxRetries = options.maxRetries >= 0 ? options.maxRetries : 5;
    this.retryTimeout = options.retryTimeout >= 1 ? options.retryTimeout : 350;
    this.state = {};
    this.queue = [];
    this.backend?.init?.(services, options.backend, options);
  }
  queueLoad(languages, namespaces, options, callback) {
    const toLoad = {};
    const pending = {};
    const toLoadLanguages = {};
    const toLoadNamespaces = {};
    languages.forEach(lng => {
      let hasAllNamespaces = true;
      namespaces.forEach(ns => {
        const name = `${lng}|${ns}`;
        if (!options.reload && this.store.hasResourceBundle(lng, ns)) {
          this.state[name] = 2;
        } else if (this.state[name] < 0) ; else if (this.state[name] === 1) {
          if (pending[name] === undefined) pending[name] = true;
        } else {
          this.state[name] = 1;
          hasAllNamespaces = false;
          if (pending[name] === undefined) pending[name] = true;
          if (toLoad[name] === undefined) toLoad[name] = true;
          if (toLoadNamespaces[ns] === undefined) toLoadNamespaces[ns] = true;
        }
      });
      if (!hasAllNamespaces) toLoadLanguages[lng] = true;
    });
    if (Object.keys(toLoad).length || Object.keys(pending).length) {
      this.queue.push({
        pending,
        pendingCount: Object.keys(pending).length,
        loaded: {},
        errors: [],
        callback
      });
    }
    return {
      toLoad: Object.keys(toLoad),
      pending: Object.keys(pending),
      toLoadLanguages: Object.keys(toLoadLanguages),
      toLoadNamespaces: Object.keys(toLoadNamespaces)
    };
  }
  loaded(name, err, data) {
    const s = name.split('|');
    const lng = s[0];
    const ns = s[1];
    if (err) this.emit('failedLoading', lng, ns, err);
    if (!err && data) {
      this.store.addResourceBundle(lng, ns, data, undefined, undefined, {
        skipCopy: true
      });
    }
    this.state[name] = err ? -1 : 2;
    if (err && data) this.state[name] = 0;
    const loaded = {};
    this.queue.forEach(q => {
      pushPath(q.loaded, [lng], ns);
      removePending(q, name);
      if (err) q.errors.push(err);
      if (q.pendingCount === 0 && !q.done) {
        Object.keys(q.loaded).forEach(l => {
          if (!loaded[l]) loaded[l] = {};
          const loadedKeys = q.loaded[l];
          if (loadedKeys.length) {
            loadedKeys.forEach(n => {
              if (loaded[l][n] === undefined) loaded[l][n] = true;
            });
          }
        });
        q.done = true;
        if (q.errors.length) {
          q.callback(q.errors);
        } else {
          q.callback();
        }
      }
    });
    this.emit('loaded', loaded);
    this.queue = this.queue.filter(q => !q.done);
  }
  read(lng, ns, fcName, tried = 0, wait = this.retryTimeout, callback) {
    if (!lng.length) return callback(null, {});
    if (this.readingCalls >= this.maxParallelReads) {
      this.waitingReads.push({
        lng,
        ns,
        fcName,
        tried,
        wait,
        callback
      });
      return;
    }
    this.readingCalls++;
    const resolver = (err, data) => {
      this.readingCalls--;
      if (this.waitingReads.length > 0) {
        const next = this.waitingReads.shift();
        this.read(next.lng, next.ns, next.fcName, next.tried, next.wait, next.callback);
      }
      if (err && data && tried < this.maxRetries) {
        setTimeout(() => {
          this.read.call(this, lng, ns, fcName, tried + 1, wait * 2, callback);
        }, wait);
        return;
      }
      callback(err, data);
    };
    const fc = this.backend[fcName].bind(this.backend);
    if (fc.length === 2) {
      try {
        const r = fc(lng, ns);
        if (r && typeof r.then === 'function') {
          r.then(data => resolver(null, data)).catch(resolver);
        } else {
          resolver(null, r);
        }
      } catch (err) {
        resolver(err);
      }
      return;
    }
    return fc(lng, ns, resolver);
  }
  prepareLoading(languages, namespaces, options = {}, callback) {
    if (!this.backend) {
      this.logger.warn('No backend was added via i18next.use. Will not load resources.');
      return callback && callback();
    }
    if (isString(languages)) languages = this.languageUtils.toResolveHierarchy(languages);
    if (isString(namespaces)) namespaces = [namespaces];
    const toLoad = this.queueLoad(languages, namespaces, options, callback);
    if (!toLoad.toLoad.length) {
      if (!toLoad.pending.length) callback();
      return null;
    }
    toLoad.toLoad.forEach(name => {
      this.loadOne(name);
    });
  }
  load(languages, namespaces, callback) {
    this.prepareLoading(languages, namespaces, {}, callback);
  }
  reload(languages, namespaces, callback) {
    this.prepareLoading(languages, namespaces, {
      reload: true
    }, callback);
  }
  loadOne(name, prefix = '') {
    const s = name.split('|');
    const lng = s[0];
    const ns = s[1];
    this.read(lng, ns, 'read', undefined, undefined, (err, data) => {
      if (err) this.logger.warn(`${prefix}loading namespace ${ns} for language ${lng} failed`, err);
      if (!err && data) this.logger.log(`${prefix}loaded namespace ${ns} for language ${lng}`, data);
      this.loaded(name, err, data);
    });
  }
  saveMissing(languages, namespace, key, fallbackValue, isUpdate, options = {}, clb = () => {}) {
    if (this.services?.utils?.hasLoadedNamespace && !this.services?.utils?.hasLoadedNamespace(namespace)) {
      this.logger.warn(`did not save key "${key}" as the namespace "${namespace}" was not yet loaded`, 'This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!');
      return;
    }
    if (key === undefined || key === null || key === '') return;
    if (this.backend?.create) {
      const opts = {
        ...options,
        isUpdate
      };
      const fc = this.backend.create.bind(this.backend);
      if (fc.length < 6) {
        try {
          let r;
          if (fc.length === 5) {
            r = fc(languages, namespace, key, fallbackValue, opts);
          } else {
            r = fc(languages, namespace, key, fallbackValue);
          }
          if (r && typeof r.then === 'function') {
            r.then(data => clb(null, data)).catch(clb);
          } else {
            clb(null, r);
          }
        } catch (err) {
          clb(err);
        }
      } else {
        fc(languages, namespace, key, fallbackValue, clb, opts);
      }
    }
    if (!languages || !languages[0]) return;
    this.store.addResource(languages[0], namespace, key, fallbackValue);
  }
}

const get = () => ({
  debug: false,
  initAsync: true,
  ns: ['translation'],
  defaultNS: ['translation'],
  fallbackLng: ['dev'],
  fallbackNS: false,
  supportedLngs: false,
  nonExplicitSupportedLngs: false,
  load: 'all',
  preload: false,
  simplifyPluralSuffix: true,
  keySeparator: '.',
  nsSeparator: ':',
  pluralSeparator: '_',
  contextSeparator: '_',
  partialBundledLanguages: false,
  saveMissing: false,
  updateMissing: false,
  saveMissingTo: 'fallback',
  saveMissingPlurals: true,
  missingKeyHandler: false,
  missingInterpolationHandler: false,
  postProcess: false,
  postProcessPassResolved: false,
  returnNull: false,
  returnEmptyString: true,
  returnObjects: false,
  joinArrays: false,
  returnedObjectHandler: false,
  parseMissingKeyHandler: false,
  appendNamespaceToMissingKey: false,
  appendNamespaceToCIMode: false,
  overloadTranslationOptionHandler: args => {
    let ret = {};
    if (typeof args[1] === 'object') ret = args[1];
    if (isString(args[1])) ret.defaultValue = args[1];
    if (isString(args[2])) ret.tDescription = args[2];
    if (typeof args[2] === 'object' || typeof args[3] === 'object') {
      const options = args[3] || args[2];
      Object.keys(options).forEach(key => {
        ret[key] = options[key];
      });
    }
    return ret;
  },
  interpolation: {
    escapeValue: true,
    format: value => value,
    prefix: '{{',
    suffix: '}}',
    formatSeparator: ',',
    unescapePrefix: '-',
    nestingPrefix: '$t(',
    nestingSuffix: ')',
    nestingOptionsSeparator: ',',
    maxReplaces: 1000,
    skipOnVariables: true
  },
  cacheInBuiltFormats: true
});
const transformOptions = options => {
  if (isString(options.ns)) options.ns = [options.ns];
  if (isString(options.fallbackLng)) options.fallbackLng = [options.fallbackLng];
  if (isString(options.fallbackNS)) options.fallbackNS = [options.fallbackNS];
  if (options.supportedLngs?.indexOf?.('cimode') < 0) {
    options.supportedLngs = options.supportedLngs.concat(['cimode']);
  }
  if (typeof options.initImmediate === 'boolean') options.initAsync = options.initImmediate;
  return options;
};

const noop = () => {};
const bindMemberFunctions = inst => {
  const mems = Object.getOwnPropertyNames(Object.getPrototypeOf(inst));
  mems.forEach(mem => {
    if (typeof inst[mem] === 'function') {
      inst[mem] = inst[mem].bind(inst);
    }
  });
};
class I18n extends EventEmitter {
  constructor(options = {}, callback) {
    super();
    this.options = transformOptions(options);
    this.services = {};
    this.logger = baseLogger;
    this.modules = {
      external: []
    };
    bindMemberFunctions(this);
    if (callback && !this.isInitialized && !options.isClone) {
      if (!this.options.initAsync) {
        this.init(options, callback);
        return this;
      }
      setTimeout(() => {
        this.init(options, callback);
      }, 0);
    }
  }
  init(options = {}, callback) {
    this.isInitializing = true;
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options.defaultNS == null && options.ns) {
      if (isString(options.ns)) {
        options.defaultNS = options.ns;
      } else if (options.ns.indexOf('translation') < 0) {
        options.defaultNS = options.ns[0];
      }
    }
    const defOpts = get();
    this.options = {
      ...defOpts,
      ...this.options,
      ...transformOptions(options)
    };
    this.options.interpolation = {
      ...defOpts.interpolation,
      ...this.options.interpolation
    };
    if (options.keySeparator !== undefined) {
      this.options.userDefinedKeySeparator = options.keySeparator;
    }
    if (options.nsSeparator !== undefined) {
      this.options.userDefinedNsSeparator = options.nsSeparator;
    }
    const createClassOnDemand = ClassOrObject => {
      if (!ClassOrObject) return null;
      if (typeof ClassOrObject === 'function') return new ClassOrObject();
      return ClassOrObject;
    };
    if (!this.options.isClone) {
      if (this.modules.logger) {
        baseLogger.init(createClassOnDemand(this.modules.logger), this.options);
      } else {
        baseLogger.init(null, this.options);
      }
      let formatter;
      if (this.modules.formatter) {
        formatter = this.modules.formatter;
      } else {
        formatter = Formatter;
      }
      const lu = new LanguageUtil(this.options);
      this.store = new ResourceStore(this.options.resources, this.options);
      const s = this.services;
      s.logger = baseLogger;
      s.resourceStore = this.store;
      s.languageUtils = lu;
      s.pluralResolver = new PluralResolver(lu, {
        prepend: this.options.pluralSeparator,
        simplifyPluralSuffix: this.options.simplifyPluralSuffix
      });
      if (formatter && (!this.options.interpolation.format || this.options.interpolation.format === defOpts.interpolation.format)) {
        s.formatter = createClassOnDemand(formatter);
        s.formatter.init(s, this.options);
        this.options.interpolation.format = s.formatter.format.bind(s.formatter);
      }
      s.interpolator = new Interpolator(this.options);
      s.utils = {
        hasLoadedNamespace: this.hasLoadedNamespace.bind(this)
      };
      s.backendConnector = new Connector(createClassOnDemand(this.modules.backend), s.resourceStore, s, this.options);
      s.backendConnector.on('*', (event, ...args) => {
        this.emit(event, ...args);
      });
      if (this.modules.languageDetector) {
        s.languageDetector = createClassOnDemand(this.modules.languageDetector);
        if (s.languageDetector.init) s.languageDetector.init(s, this.options.detection, this.options);
      }
      if (this.modules.i18nFormat) {
        s.i18nFormat = createClassOnDemand(this.modules.i18nFormat);
        if (s.i18nFormat.init) s.i18nFormat.init(this);
      }
      this.translator = new Translator(this.services, this.options);
      this.translator.on('*', (event, ...args) => {
        this.emit(event, ...args);
      });
      this.modules.external.forEach(m => {
        if (m.init) m.init(this);
      });
    }
    this.format = this.options.interpolation.format;
    if (!callback) callback = noop;
    if (this.options.fallbackLng && !this.services.languageDetector && !this.options.lng) {
      const codes = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
      if (codes.length > 0 && codes[0] !== 'dev') this.options.lng = codes[0];
    }
    if (!this.services.languageDetector && !this.options.lng) {
      this.logger.warn('init: no languageDetector is used and no lng is defined');
    }
    const storeApi = ['getResource', 'hasResourceBundle', 'getResourceBundle', 'getDataByLanguage'];
    storeApi.forEach(fcName => {
      this[fcName] = (...args) => this.store[fcName](...args);
    });
    const storeApiChained = ['addResource', 'addResources', 'addResourceBundle', 'removeResourceBundle'];
    storeApiChained.forEach(fcName => {
      this[fcName] = (...args) => {
        this.store[fcName](...args);
        return this;
      };
    });
    const deferred = defer();
    const load = () => {
      const finish = (err, t) => {
        this.isInitializing = false;
        if (this.isInitialized && !this.initializedStoreOnce) this.logger.warn('init: i18next is already initialized. You should call init just once!');
        this.isInitialized = true;
        if (!this.options.isClone) this.logger.log('initialized', this.options);
        this.emit('initialized', this.options);
        deferred.resolve(t);
        callback(err, t);
      };
      if (this.languages && !this.isInitialized) return finish(null, this.t.bind(this));
      this.changeLanguage(this.options.lng, finish);
    };
    if (this.options.resources || !this.options.initAsync) {
      load();
    } else {
      setTimeout(load, 0);
    }
    return deferred;
  }
  loadResources(language, callback = noop) {
    let usedCallback = callback;
    const usedLng = isString(language) ? language : this.language;
    if (typeof language === 'function') usedCallback = language;
    if (!this.options.resources || this.options.partialBundledLanguages) {
      if (usedLng?.toLowerCase() === 'cimode' && (!this.options.preload || this.options.preload.length === 0)) return usedCallback();
      const toLoad = [];
      const append = lng => {
        if (!lng) return;
        if (lng === 'cimode') return;
        const lngs = this.services.languageUtils.toResolveHierarchy(lng);
        lngs.forEach(l => {
          if (l === 'cimode') return;
          if (toLoad.indexOf(l) < 0) toLoad.push(l);
        });
      };
      if (!usedLng) {
        const fallbacks = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
        fallbacks.forEach(l => append(l));
      } else {
        append(usedLng);
      }
      this.options.preload?.forEach?.(l => append(l));
      this.services.backendConnector.load(toLoad, this.options.ns, e => {
        if (!e && !this.resolvedLanguage && this.language) this.setResolvedLanguage(this.language);
        usedCallback(e);
      });
    } else {
      usedCallback(null);
    }
  }
  reloadResources(lngs, ns, callback) {
    const deferred = defer();
    if (typeof lngs === 'function') {
      callback = lngs;
      lngs = undefined;
    }
    if (typeof ns === 'function') {
      callback = ns;
      ns = undefined;
    }
    if (!lngs) lngs = this.languages;
    if (!ns) ns = this.options.ns;
    if (!callback) callback = noop;
    this.services.backendConnector.reload(lngs, ns, err => {
      deferred.resolve();
      callback(err);
    });
    return deferred;
  }
  use(module) {
    if (!module) throw new Error('You are passing an undefined module! Please check the object you are passing to i18next.use()');
    if (!module.type) throw new Error('You are passing a wrong module! Please check the object you are passing to i18next.use()');
    if (module.type === 'backend') {
      this.modules.backend = module;
    }
    if (module.type === 'logger' || module.log && module.warn && module.error) {
      this.modules.logger = module;
    }
    if (module.type === 'languageDetector') {
      this.modules.languageDetector = module;
    }
    if (module.type === 'i18nFormat') {
      this.modules.i18nFormat = module;
    }
    if (module.type === 'postProcessor') {
      postProcessor.addPostProcessor(module);
    }
    if (module.type === 'formatter') {
      this.modules.formatter = module;
    }
    if (module.type === '3rdParty') {
      this.modules.external.push(module);
    }
    return this;
  }
  setResolvedLanguage(l) {
    if (!l || !this.languages) return;
    if (['cimode', 'dev'].indexOf(l) > -1) return;
    for (let li = 0; li < this.languages.length; li++) {
      const lngInLngs = this.languages[li];
      if (['cimode', 'dev'].indexOf(lngInLngs) > -1) continue;
      if (this.store.hasLanguageSomeTranslations(lngInLngs)) {
        this.resolvedLanguage = lngInLngs;
        break;
      }
    }
    if (!this.resolvedLanguage && this.languages.indexOf(l) < 0 && this.store.hasLanguageSomeTranslations(l)) {
      this.resolvedLanguage = l;
      this.languages.unshift(l);
    }
  }
  changeLanguage(lng, callback) {
    this.isLanguageChangingTo = lng;
    const deferred = defer();
    this.emit('languageChanging', lng);
    const setLngProps = l => {
      this.language = l;
      this.languages = this.services.languageUtils.toResolveHierarchy(l);
      this.resolvedLanguage = undefined;
      this.setResolvedLanguage(l);
    };
    const done = (err, l) => {
      if (l) {
        if (this.isLanguageChangingTo === lng) {
          setLngProps(l);
          this.translator.changeLanguage(l);
          this.isLanguageChangingTo = undefined;
          this.emit('languageChanged', l);
          this.logger.log('languageChanged', l);
        }
      } else {
        this.isLanguageChangingTo = undefined;
      }
      deferred.resolve((...args) => this.t(...args));
      if (callback) callback(err, (...args) => this.t(...args));
    };
    const setLng = lngs => {
      if (!lng && !lngs && this.services.languageDetector) lngs = [];
      const fl = isString(lngs) ? lngs : lngs && lngs[0];
      const l = this.store.hasLanguageSomeTranslations(fl) ? fl : this.services.languageUtils.getBestMatchFromCodes(isString(lngs) ? [lngs] : lngs);
      if (l) {
        if (!this.language) {
          setLngProps(l);
        }
        if (!this.translator.language) this.translator.changeLanguage(l);
        this.services.languageDetector?.cacheUserLanguage?.(l);
      }
      this.loadResources(l, err => {
        done(err, l);
      });
    };
    if (!lng && this.services.languageDetector && !this.services.languageDetector.async) {
      setLng(this.services.languageDetector.detect());
    } else if (!lng && this.services.languageDetector && this.services.languageDetector.async) {
      if (this.services.languageDetector.detect.length === 0) {
        this.services.languageDetector.detect().then(setLng);
      } else {
        this.services.languageDetector.detect(setLng);
      }
    } else {
      setLng(lng);
    }
    return deferred;
  }
  getFixedT(lng, ns, keyPrefix) {
    const fixedT = (key, opts, ...rest) => {
      let o;
      if (typeof opts !== 'object') {
        o = this.options.overloadTranslationOptionHandler([key, opts].concat(rest));
      } else {
        o = {
          ...opts
        };
      }
      o.lng = o.lng || fixedT.lng;
      o.lngs = o.lngs || fixedT.lngs;
      o.ns = o.ns || fixedT.ns;
      if (o.keyPrefix !== '') o.keyPrefix = o.keyPrefix || keyPrefix || fixedT.keyPrefix;
      const keySeparator = this.options.keySeparator || '.';
      let resultKey;
      if (o.keyPrefix && Array.isArray(key)) {
        resultKey = key.map(k => `${o.keyPrefix}${keySeparator}${k}`);
      } else {
        resultKey = o.keyPrefix ? `${o.keyPrefix}${keySeparator}${key}` : key;
      }
      return this.t(resultKey, o);
    };
    if (isString(lng)) {
      fixedT.lng = lng;
    } else {
      fixedT.lngs = lng;
    }
    fixedT.ns = ns;
    fixedT.keyPrefix = keyPrefix;
    return fixedT;
  }
  t(...args) {
    return this.translator?.translate(...args);
  }
  exists(...args) {
    return this.translator?.exists(...args);
  }
  setDefaultNamespace(ns) {
    this.options.defaultNS = ns;
  }
  hasLoadedNamespace(ns, options = {}) {
    if (!this.isInitialized) {
      this.logger.warn('hasLoadedNamespace: i18next was not initialized', this.languages);
      return false;
    }
    if (!this.languages || !this.languages.length) {
      this.logger.warn('hasLoadedNamespace: i18n.languages were undefined or empty', this.languages);
      return false;
    }
    const lng = options.lng || this.resolvedLanguage || this.languages[0];
    const fallbackLng = this.options ? this.options.fallbackLng : false;
    const lastLng = this.languages[this.languages.length - 1];
    if (lng.toLowerCase() === 'cimode') return true;
    const loadNotPending = (l, n) => {
      const loadState = this.services.backendConnector.state[`${l}|${n}`];
      return loadState === -1 || loadState === 0 || loadState === 2;
    };
    if (options.precheck) {
      const preResult = options.precheck(this, loadNotPending);
      if (preResult !== undefined) return preResult;
    }
    if (this.hasResourceBundle(lng, ns)) return true;
    if (!this.services.backendConnector.backend || this.options.resources && !this.options.partialBundledLanguages) return true;
    if (loadNotPending(lng, ns) && (!fallbackLng || loadNotPending(lastLng, ns))) return true;
    return false;
  }
  loadNamespaces(ns, callback) {
    const deferred = defer();
    if (!this.options.ns) {
      if (callback) callback();
      return Promise.resolve();
    }
    if (isString(ns)) ns = [ns];
    ns.forEach(n => {
      if (this.options.ns.indexOf(n) < 0) this.options.ns.push(n);
    });
    this.loadResources(err => {
      deferred.resolve();
      if (callback) callback(err);
    });
    return deferred;
  }
  loadLanguages(lngs, callback) {
    const deferred = defer();
    if (isString(lngs)) lngs = [lngs];
    const preloaded = this.options.preload || [];
    const newLngs = lngs.filter(lng => preloaded.indexOf(lng) < 0 && this.services.languageUtils.isSupportedCode(lng));
    if (!newLngs.length) {
      if (callback) callback();
      return Promise.resolve();
    }
    this.options.preload = preloaded.concat(newLngs);
    this.loadResources(err => {
      deferred.resolve();
      if (callback) callback(err);
    });
    return deferred;
  }
  dir(lng) {
    if (!lng) lng = this.resolvedLanguage || (this.languages?.length > 0 ? this.languages[0] : this.language);
    if (!lng) return 'rtl';
    const rtlLngs = ['ar', 'shu', 'sqr', 'ssh', 'xaa', 'yhd', 'yud', 'aao', 'abh', 'abv', 'acm', 'acq', 'acw', 'acx', 'acy', 'adf', 'ads', 'aeb', 'aec', 'afb', 'ajp', 'apc', 'apd', 'arb', 'arq', 'ars', 'ary', 'arz', 'auz', 'avl', 'ayh', 'ayl', 'ayn', 'ayp', 'bbz', 'pga', 'he', 'iw', 'ps', 'pbt', 'pbu', 'pst', 'prp', 'prd', 'ug', 'ur', 'ydd', 'yds', 'yih', 'ji', 'yi', 'hbo', 'men', 'xmn', 'fa', 'jpr', 'peo', 'pes', 'prs', 'dv', 'sam', 'ckb'];
    const languageUtils = this.services?.languageUtils || new LanguageUtil(get());
    return rtlLngs.indexOf(languageUtils.getLanguagePartFromCode(lng)) > -1 || lng.toLowerCase().indexOf('-arab') > 1 ? 'rtl' : 'ltr';
  }
  static createInstance(options = {}, callback) {
    return new I18n(options, callback);
  }
  cloneInstance(options = {}, callback = noop) {
    const forkResourceStore = options.forkResourceStore;
    if (forkResourceStore) delete options.forkResourceStore;
    const mergedOptions = {
      ...this.options,
      ...options,
      ...{
        isClone: true
      }
    };
    const clone = new I18n(mergedOptions);
    if (options.debug !== undefined || options.prefix !== undefined) {
      clone.logger = clone.logger.clone(options);
    }
    const membersToCopy = ['store', 'services', 'language'];
    membersToCopy.forEach(m => {
      clone[m] = this[m];
    });
    clone.services = {
      ...this.services
    };
    clone.services.utils = {
      hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
    };
    if (forkResourceStore) {
      const clonedData = Object.keys(this.store.data).reduce((prev, l) => {
        prev[l] = {
          ...this.store.data[l]
        };
        prev[l] = Object.keys(prev[l]).reduce((acc, n) => {
          acc[n] = {
            ...prev[l][n]
          };
          return acc;
        }, prev[l]);
        return prev;
      }, {});
      clone.store = new ResourceStore(clonedData, mergedOptions);
      clone.services.resourceStore = clone.store;
    }
    clone.translator = new Translator(clone.services, mergedOptions);
    clone.translator.on('*', (event, ...args) => {
      clone.emit(event, ...args);
    });
    clone.init(mergedOptions, callback);
    clone.translator.options = mergedOptions;
    clone.translator.backendConnector.services.utils = {
      hasLoadedNamespace: clone.hasLoadedNamespace.bind(clone)
    };
    return clone;
  }
  toJSON() {
    return {
      options: this.options,
      store: this.store,
      language: this.language,
      languages: this.languages,
      resolvedLanguage: this.resolvedLanguage
    };
  }
}
const instance = I18n.createInstance();
instance.createInstance = I18n.createInstance;

const createInstance = instance.createInstance;
const dir = instance.dir;
const init = instance.init;
const loadResources = instance.loadResources;
const reloadResources = instance.reloadResources;
const use = instance.use;
const changeLanguage = instance.changeLanguage;
const getFixedT = instance.getFixedT;
const t = instance.t;
const exists = instance.exists;
const setDefaultNamespace = instance.setDefaultNamespace;
const hasLoadedNamespace = instance.hasLoadedNamespace;
const loadNamespaces = instance.loadNamespaces;
const loadLanguages = instance.loadLanguages;




/***/ },

/***/ "./src/measurement/units-compact.json"
/*!********************************************!*\
  !*** ./src/measurement/units-compact.json ***!
  \********************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"globals":{"dimension":{},"factor":{"factor":1},"factor.derived":{"parentFactors":{}},"quantity":{"units":[]},"symbol":{"doc":"http://docs.adskunits.apiary.io/#introduction/definitions/unit-symbols","unit":{"typeid":"unit","description":"Measurement unit this symbol applies to."}},"symbol.placement":{"Prefix":{"value":0},"Suffix":1},"symbol.prefixOrSuffix":{"text":{"typeid":"String","description":"Text to annotate the value."},"placement":{"typeid":"symbol.placement","description":"Placement of the annotation text."},"space":{"typeid":"Bool","description":"Specifies whether the annotation should be separated from the value by a space."}},"system":{"Metric":{"value":0,"description":"Metric system of measurement units."},"Imperial":1},"unit":{"doc":"http://docs.adskunits.apiary.io/#introduction/definitions/measurement-units","unitSystem":{"typeid":"system"}},"unit.absolute":{"parentUnit":{"typeid":"unit.relative","description":"Relative unit from which this absolute unit is derived."},"offset":{"typeid":"Float64","value":0,"description":"An offset used to position an absolute scale of measurement on the number line."}},"unit.derived":{"parentFactors":{},"parentUnits":{}},"unit.primitive":{},"unit.primitive.dimensional":{"dimension":{"typeid":"dimension"}},"unit.relative":{}},"factor":{"nineFifths":{"factor":1.8},"pi":{"factor":3.14159265358979},"atto":{"parentFactors":{"ten":-18}},"centi":{"parentFactors":{"ten":-2}},"deci":{"parentFactors":{"ten":-1}},"deka":{"parentFactors":{"ten":1}},"exa":{"parentFactors":{"ten":18}},"femto":{"parentFactors":{"ten":-15}},"giga":{"parentFactors":{"ten":9}},"hecto":{"parentFactors":{"ten":2}},"kilo":{"parentFactors":{"ten":3}},"mega":{"parentFactors":{"ten":6}},"micro":{"parentFactors":{"ten":-6}},"milli":{"parentFactors":{"ten":-3}},"nano":{"parentFactors":{"ten":-9}},"peta":{"parentFactors":{"ten":15}},"pico":{"parentFactors":{"ten":-12}},"tera":{"parentFactors":{"ten":12}},"yocto":{"parentFactors":{"ten":-24}},"yotta":{"parentFactors":{"ten":24}},"zepto":{"parentFactors":{"ten":-21}},"zetta":{"parentFactors":{"ten":21}},"sixty":{"factor":60},"ten":{"factor":10},"threeHundredSixty":{"factor":360},"threeThousandNineHundredThirtySeven":{"factor":3937},"twelve":{"factor":12}},"dimension":{"currency":{},"electricCurrent":{},"length":{},"luminousIntensity":{},"mass":{},"temperature":{},"time":{}},"unit":{"1ToRatio":{"unitSystem":"Metric","parentUnits":{"ratioTo1":-1},"symbols":{"1Colon":{"text":"1:","placement":"Prefix","space":false}}},"acres":{"unitSystem":"Imperial","factor":4840,"parentUnits":{"squareYards":1},"symbols":{"acres":{"text":"acres","placement":"Suffix","space":true}}},"ampereHours":{"unitSystem":"Metric","parentUnits":{"amperes":1,"hours":1},"symbols":{"aDashH":{"text":"A-h","placement":"Suffix","space":true}}},"ampereSeconds":{"unitSystem":"Metric","parentUnits":{"amperes":1,"seconds":1},"symbols":{"aDashS":{"text":"A-s","placement":"Suffix","space":true}}},"amperes":{"unitSystem":"Metric","dimension":"electricCurrent","symbols":{"ampere":{"text":"A","placement":"Suffix","space":true}}},"arcminutes":{"unitSystem":"Metric","parentFactors":{"sixty":-1},"parentUnits":{"degrees":1},"symbols":{"arcminute":{"text":"\'","placement":"Suffix","space":false}}},"arcseconds":{"unitSystem":"Metric","parentFactors":{"sixty":-1},"parentUnits":{"arcminutes":1},"symbols":{"arcsecond":{"text":"\\"","placement":"Suffix","space":false}}},"atmospheres":{"unitSystem":"Imperial","factor":101325,"parentUnits":{"pascals":1},"symbols":{"atm":{"text":"atm","placement":"Suffix","space":true}}},"bars":{"unitSystem":"Metric","factor":100,"parentUnits":{"kilopascals":1},"symbols":{"bar":{"text":"bar","placement":"Suffix","space":true}}},"britishThermalUnits":{"unitSystem":"Imperial","factor":1055.05585262,"parentUnits":{"joules":1},"symbols":{"btu":{"text":"Btu","placement":"Suffix","space":true}}},"britishThermalUnitsPerDegreeFahrenheit":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnits":1,"fahrenheitInterval":-1},"symbols":{"btuPerDegreeF":{"text":"BTU/°F","placement":"Suffix","space":true}}},"britishThermalUnitsPerHour":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnits":1,"hours":-1},"symbols":{"btuPerH":{"text":"Btu/h","placement":"Suffix","space":true}}},"britishThermalUnitsPerHourCubicFoot":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnitsPerHour":1,"cubicFeet":-1},"symbols":{"btuPerHFtSup3":{"text":"Btu/(h·ft³)","placement":"Suffix","space":true}}},"britishThermalUnitsPerHourFootDegreeFahrenheit":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnitsPerHour":1,"feet":-1,"fahrenheitInterval":-1},"symbols":{"btuPerHFtDegreeF":{"text":"BTU/(h·ft·°F)","placement":"Suffix","space":true}}},"britishThermalUnitsPerHourSquareFoot":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnitsPerHour":1,"squareFeet":-1},"symbols":{"btuPerHFtSup2":{"text":"Btu/(h·ft²)","placement":"Suffix","space":true}}},"britishThermalUnitsPerHourSquareFootDegreeFahrenheit":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnitsPerHourSquareFoot":1,"fahrenheitInterval":-1},"symbols":{"btuPerHFtSup2DegreeF":{"text":"BTU/(h·ft²·°F)","placement":"Suffix","space":true}}},"britishThermalUnitsPerPound":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnits":1,"poundsMass":-1},"symbols":{"btuPerLb":{"text":"BTU/lb","placement":"Suffix","space":true}}},"britishThermalUnitsPerPoundDegreeFahrenheit":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnitsPerPound":1,"fahrenheitInterval":-1},"symbols":{"btuPerLbDegreeF":{"text":"BTU/(lb·°F)","placement":"Suffix","space":true}}},"britishThermalUnitsPerSecond":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnits":1,"seconds":-1},"symbols":{"btuPerS":{"text":"Btu/s","placement":"Suffix","space":true}}},"britishThermalUnitsPerSquareFootDegreeFahrenheit":{"unitSystem":"Imperial","parentUnits":{"britishThermalUnits":1,"squareFeet":-1,"fahrenheitInterval":-1},"symbols":{"btuPerFtSup2DegreeF":{"text":"BTU/(ft²·°F)","placement":"Suffix","space":true}}},"calories":{"unitSystem":"Metric","factor":4.1868,"parentUnits":{"joules":1},"symbols":{"cal":{"text":"cal","placement":"Suffix","space":true}}},"caloriesPerSecond":{"unitSystem":"Metric","parentUnits":{"calories":1,"seconds":-1},"symbols":{"calPerS":{"text":"cal/s","placement":"Suffix","space":true}}},"candelas":{"unitSystem":"Metric","dimension":"luminousIntensity","symbols":{"cd":{"text":"cd","placement":"Suffix","space":true}}},"candelasPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"candelas":1,"squareFeet":-1},"symbols":{"cdPerFtSup2":{"text":"cd/ft²","placement":"Suffix","space":true}}},"candelasPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"candelas":1,"squareMeters":-1},"symbols":{"cdPerMSup2":{"text":"cd/m²","placement":"Suffix","space":true}}},"celsius":{"unitSystem":"Metric","parentUnit":"celsiusInterval","offset":273.15,"symbols":{"degreeC":{"text":"°C","placement":"Suffix","space":true}}},"celsiusInterval":{"unitSystem":"Metric","parentUnits":{"kelvinInterval":1},"symbols":{"degreeCInterval":{"text":"°C","placement":"Suffix","space":true},"deltaDegreeC":{"text":"delta°C","placement":"Suffix","space":true}}},"centimeters":{"unitSystem":"Metric","parentFactors":{"centi":1},"parentUnits":{"meters":1},"symbols":{"cm":{"text":"cm","placement":"Suffix","space":true}}},"centimetersPerMinute":{"unitSystem":"Metric","parentUnits":{"centimeters":1,"minutes":-1},"symbols":{"cmPerMin":{"text":"cm/min","placement":"Suffix","space":true}}},"centimetersToTheFourthPower":{"unitSystem":"Metric","parentUnits":{"centimeters":4},"symbols":{"cmSup4":{"text":"cm⁴","placement":"Suffix","space":true}}},"centimetersToTheSixthPower":{"unitSystem":"Metric","parentUnits":{"centimeters":6},"symbols":{"cmSup6":{"text":"cm⁶","placement":"Suffix","space":true}}},"centipoises":{"unitSystem":"Metric","parentFactors":{"centi":1},"parentUnits":{"poises":1},"symbols":{"cP":{"text":"cP","placement":"Suffix","space":true}}},"circularMils":{"unitSystem":"Imperial","factor":0.25,"parentFactors":{"pi":1},"parentUnits":{"squareMils":1},"symbols":{"cMil":{"text":"cmil","placement":"Suffix","space":true}}},"coulombs":{"unitSystem":"Metric","parentUnits":{"ampereSeconds":1},"symbols":{"coulomb":{"text":"C","placement":"Suffix","space":true}}},"cubicCentimeters":{"defaultSymbol":"cmSup3","unitSystem":"Metric","parentUnits":{"centimeters":3},"symbols":{"cmCaret3":{"text":"cm^3","placement":"Suffix","space":true},"cmSup3":{"text":"cm³","placement":"Suffix","space":true}}},"cubicFeet":{"defaultSymbol":"ftSup3","unitSystem":"Imperial","parentUnits":{"feet":3},"symbols":{"cf":{"text":"CF","placement":"Suffix","space":true},"ftCaret3":{"text":"ft^3","placement":"Suffix","space":true},"ftSup3":{"text":"ft³","placement":"Suffix","space":true}}},"cubicFeetPerHour":{"defaultSymbol":"ftSup3PerHour","unitSystem":"Imperial","parentUnits":{"cubicFeet":1,"hours":-1},"symbols":{"cfh":{"text":"CFH","placement":"Suffix","space":true},"ftSup3PerH":{"text":"ft³/h","placement":"Suffix","space":true}}},"cubicFeetPerKip":{"unitSystem":"Imperial","parentUnits":{"cubicFeet":1,"kips":-1},"symbols":{"ftSup3PerKip":{"text":"ft³/kip","placement":"Suffix","space":true}}},"cubicFeetPerMinute":{"defaultSymbol":"ftSup3PerMin","unitSystem":"Imperial","parentUnits":{"cubicFeet":1,"minutes":-1},"symbols":{"cfm":{"text":"CFM","placement":"Suffix","space":true},"ftSup3PerMin":{"text":"ft³/min","placement":"Suffix","space":true}}},"cubicFeetPerMinuteCubicFoot":{"defaultSymbol":"cfmPerFtSup3","unitSystem":"Imperial","parentUnits":{"cubicFeetPerMinute":1,"cubicFeet":-1},"symbols":{"cfmPerCf":{"text":"CFM/CF","placement":"Suffix","space":true},"cfmPerFtSup3":{"text":"CFM/ft³","placement":"Suffix","space":true}}},"cubicFeetPerMinutePerBritishThermalUnitPerHour":{"unitSystem":"Imperial","parentUnits":{"cubicFeetPerMinute":1,"britishThermalUnitsPerHour":-1},"symbols":{"ftSup3HPerMinBtu":{"text":"ft³·h/(min·Btu)","placement":"Suffix","space":true}}},"cubicFeetPerMinuteSquareFoot":{"defaultSymbol":"cfmPerFtSup2","unitSystem":"Imperial","parentUnits":{"cubicFeetPerMinute":1,"squareFeet":-1},"symbols":{"cfmPerFtSup2":{"text":"CFM/ft²","placement":"Suffix","space":true},"cfmPerSf":{"text":"CFM/SF","placement":"Suffix","space":true}}},"cubicFeetPerMinuteSquareMeter":{"unitSystem":"Metric","parentUnits":{"cubicFeetPerMinute":1,"squareMeters":-1}},"cubicFeetPerMinuteTonOfRefrigeration":{"unitSystem":"Imperial","parentUnits":{"cubicFeetPerMinute":1,"tonsOfRefrigeration":-1},"symbols":{"cfmPerTon":{"text":"CFM/ton","placement":"Suffix","space":true}}},"cubicFeetPerPoundMass":{"unitSystem":"Imperial","parentUnits":{"cubicFeet":1,"poundsMass":-1},"symbols":{"ftSup3PerLbMass":{"text":"ft³/lb","placement":"Suffix","space":true}}},"cubicInches":{"defaultSymbol":"inSup3","unitSystem":"Imperial","parentUnits":{"inches":3},"symbols":{"inCaret3":{"text":"in^3","placement":"Suffix","space":true},"inSup3":{"text":"in³","placement":"Suffix","space":true}}},"cubicMeters":{"defaultSymbol":"mSup3","unitSystem":"Metric","parentUnits":{"meters":3},"symbols":{"mCaret3":{"text":"m^3","placement":"Suffix","space":true},"mSup3":{"text":"m³","placement":"Suffix","space":true}}},"cubicMetersPerHour":{"defaultSymbol":"mSup3PerH","unitSystem":"Metric","parentUnits":{"cubicMeters":1,"hours":-1},"symbols":{"cmh":{"text":"CMH","placement":"Suffix","space":true},"mSup3PerH":{"text":"m³/h","placement":"Suffix","space":true}}},"cubicMetersPerHourCubicMeter":{"unitSystem":"Metric","parentUnits":{"cubicMetersPerHour":1,"cubicMeters":-1},"symbols":{"mSup3PerHMSup3":{"text":"m³/(h·m³)","placement":"Suffix","space":true}}},"cubicMetersPerHourSquareMeter":{"unitSystem":"Metric","parentUnits":{"cubicMetersPerHour":1,"squareMeters":-1},"symbols":{"mSup3PerHMSup2":{"text":"m³/(h·m²)","placement":"Suffix","space":true}}},"cubicMetersPerKilogram":{"unitSystem":"Metric","parentUnits":{"cubicMeters":1,"kilograms":-1},"symbols":{"mSup3PerKg":{"text":"m³/kg","placement":"Suffix","space":true}}},"cubicMetersPerKilonewton":{"unitSystem":"Metric","parentUnits":{"cubicMeters":1,"kilonewtons":-1},"symbols":{"mSup3PerKN":{"text":"m³/kN","placement":"Suffix","space":true}}},"cubicMetersPerSecond":{"defaultSymbol":"mSup3PerS","unitSystem":"Metric","parentUnits":{"cubicMeters":1,"seconds":-1},"symbols":{"cms":{"text":"CMS","placement":"Suffix","space":true},"mSup3PerS":{"text":"m³/s","placement":"Suffix","space":true}}},"cubicMetersPerWattSecond":{"unitSystem":"Metric","parentUnits":{"cubicMeters":1,"watts":-1,"seconds":-1},"symbols":{"mSup3PerWS":{"text":"m³/(W·s)","placement":"Suffix","space":true}}},"cubicMillimeters":{"defaultSymbol":"mmSup3","unitSystem":"Metric","parentUnits":{"millimeters":3},"symbols":{"mmCaret3":{"text":"mm^3","placement":"Suffix","space":true},"mmSup3":{"text":"mm³","placement":"Suffix","space":true}}},"cubicYards":{"unitSystem":"Imperial","parentUnits":{"yards":3},"symbols":{"cy":{"text":"CY","placement":"Suffix","space":true},"ydCaret3":{"text":"yd^3","placement":"Suffix","space":true},"ydSup3":{"text":"yd³","placement":"Suffix","space":true}}},"currency":{"defaultSymbol":"usDollar","unitSystem":"Imperial","dimension":"currency","symbols":{"baht":{"description":"Baht is the official currency of Thailand.","text":"฿","placement":"Prefix","space":false},"chineseHongKongDollar":{"description":"Hong Kong Dollar is the official currency of Hong Kong..","text":"HK$","placement":"Prefix","space":false},"dong":{"description":"Dong is the official currency of Vietnam.","text":"₫","placement":"Suffix","space":false},"euroPrefix":{"text":"€","placement":"Prefix","space":false},"euroSuffix":{"text":"€","placement":"Suffix","space":false},"krone":{"description":"Krone is the official currency of Denmark, Greenland, and the Faroe Islands.","text":"kr","placement":"Suffix","space":true},"shekel":{"description":"Shekel is the official currency of Israel.","text":"₪","placement":"Prefix","space":false},"ukPound":{"text":"£","placement":"Prefix","space":false},"usDollar":{"text":"$","placement":"Prefix","space":false},"won":{"description":"Won is the official currency of South Korea.","text":"₩","placement":"Prefix","space":false},"yen":{"text":"¥","placement":"Prefix","space":false}}},"currencyPerBritishThermalUnit":{"unitSystem":"Imperial","parentUnits":{"currency":1,"britishThermalUnits":-1},"symbols":{"dollarPerBtu":{"text":"$/Btu","placement":"Suffix","space":true}}},"currencyPerBritishThermalUnitPerHour":{"unitSystem":"Imperial","parentUnits":{"currency":1,"britishThermalUnitsPerHour":-1},"symbols":{"dollarHPerBtu":{"text":"$·h/Btu","placement":"Suffix","space":true}}},"currencyPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"currency":1,"squareFeet":-1},"symbols":{"dollarPerFtSup2":{"text":"$/ft²","placement":"Suffix","space":true}}},"currencyPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"currency":1,"squareMeters":-1},"symbols":{"dollarPerMSup2":{"text":"$/m²","placement":"Suffix","space":true}}},"currencyPerWatt":{"unitSystem":"Metric","parentUnits":{"currency":1,"watts":-1},"symbols":{"dollarPerW":{"text":"$/W","placement":"Suffix","space":true}}},"currencyPerWattHour":{"unitSystem":"Metric","parentUnits":{"currency":1,"watts":-1,"hours":-1},"symbols":{"dollarPerWH":{"text":"$/(W·h)","placement":"Suffix","space":true}}},"cyclesPerSecond":{"unitSystem":"Metric","parentUnits":{"seconds":-1},"symbols":{"cps":{"text":"cps","placement":"Suffix","space":true}}},"decibelMilliwatts":{"unitSystem":"Metric","parentUnits":{"decibels":1,"milliwatts":1},"symbols":{"dBm":{"text":"dBm","placement":"Suffix","space":true}}},"decibels":{"unitSystem":"Metric","symbols":{"dB":{"text":"dB","placement":"Suffix","space":false},"dBPsSPL":{"text":"dB(SPL)","placement":"Suffix","space":false},"dBSPL":{"text":"dBSPL","placement":"Suffix","space":false},"dBSpSPL":{"text":"dB SPL","placement":"Suffix","space":false},"dBSubSPL":{"text":"dBₛₚₗ","placement":"Suffix","space":false}}},"decimeters":{"unitSystem":"Metric","parentFactors":{"deci":1},"parentUnits":{"meters":1},"symbols":{"dm":{"text":"dm","placement":"Suffix","space":true}}},"degrees":{"defaultSymbol":"degree","unitSystem":"Metric","parentFactors":{"threeHundredSixty":-1},"parentUnits":{"turns":1},"symbols":{"degree":{"text":"°","placement":"Suffix","space":false},"degreesMinutesSeconds":{"inherits":"symbol"}}},"dekanewtonMeters":{"unitSystem":"Metric","parentUnits":{"dekanewtons":1,"meters":1},"symbols":{"daNDashM":{"text":"daN-m","placement":"Suffix","space":true}}},"dekanewtonMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"dekanewtonMeters":1,"meters":-1},"symbols":{"daNDashMPerM":{"text":"daN-m/m","placement":"Suffix","space":true}}},"dekanewtons":{"unitSystem":"Metric","parentFactors":{"deka":1},"parentUnits":{"newtons":1},"symbols":{"daN":{"text":"daN","placement":"Suffix","space":true}}},"dekanewtonsPerMeter":{"unitSystem":"Metric","parentUnits":{"dekanewtons":1,"meters":-1},"symbols":{"daNPerM":{"text":"daN/m","placement":"Suffix","space":true}}},"dekanewtonsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"dekanewtons":1,"squareMeters":-1},"symbols":{"daNPerMSup2":{"text":"daN/m²","placement":"Suffix","space":true}}},"dynes":{"unitSystem":"Metric","factor":10,"parentFactors":{"micro":1},"parentUnits":{"newtons":1},"symbols":{"dyn":{"text":"dyn","placement":"Suffix","space":true}}},"ergs":{"unitSystem":"Metric","parentFactors":{"ten":-7},"parentUnits":{"joules":1},"symbols":{"erg":{"text":"erg","placement":"Suffix","space":true}}},"fahrenheit":{"unitSystem":"Imperial","parentUnit":"fahrenheitInterval","offset":459.67,"symbols":{"degreeF":{"text":"°F","placement":"Suffix","space":true}}},"fahrenheitInterval":{"defaultSymbol":"degreeFInterval","unitSystem":"Imperial","parentUnits":{"rankineInterval":1},"symbols":{"degreeFInterval":{"text":"°F","placement":"Suffix","space":true},"deltaDegreeF":{"text":"delta°F","placement":"Suffix","space":true}}},"farads":{"unitSystem":"Metric","parentUnits":{"coulombs":1,"volts":-1},"symbols":{"farad":{"text":"F","placement":"Suffix","space":true}}},"feet":{"defaultSymbol":"feetAndInches","unitSystem":"Imperial","factor":12,"parentUnits":{"inches":1},"symbols":{"feetAndInches":{"inherits":"symbol"},"footSingleQuote":{"text":"\'","placement":"Suffix","space":false},"ft":{"text":"ft","placement":"Suffix","space":true},"lf":{"text":"LF","placement":"Suffix","space":true}}},"feetOfWater39.2DegreesFahrenheit":{"defaultSymbol":"feetOfWater","unitSystem":"Imperial","factor":2988.98,"parentUnits":{"pascals":1},"symbols":{"feetOfWater":{"text":"Feet","placement":"Suffix","space":true},"ftH2O":{"text":"ftH2O","placement":"Suffix","space":true},"ftOfWater":{"text":"FT","placement":"Suffix","space":true}}},"feetOfWater39.2DegreesFahrenheitPer100Feet":{"defaultSymbol":"feetOfWaterPer100ft","unitSystem":"Imperial","factor":0.01,"parentUnits":{"feetOfWater39.2DegreesFahrenheit":1,"feet":-1},"symbols":{"feetOfWaterPer100ft":{"text":"Feet/100ft","placement":"Suffix","space":true},"ftH2OPer100ft":{"text":"ftH2O/100ft","placement":"Suffix","space":true},"ftOfWaterPer100ft":{"text":"FT/100ft","placement":"Suffix","space":true}}},"feetPerKip":{"unitSystem":"Imperial","parentUnits":{"feet":1,"kips":-1},"symbols":{"ftPerKip":{"text":"ft/kip","placement":"Suffix","space":true}}},"feetPerKipFoot":{"unitSystem":"Imperial","parentUnits":{"feet":1,"kipFeet":-1},"symbols":{"ftPerKipDashFt":{"text":"ft/kip-ft","placement":"Suffix","space":true}}},"feetPerMinute":{"defaultSymbol":"fpm","unitSystem":"Imperial","parentUnits":{"feet":1,"minutes":-1},"symbols":{"fpm":{"text":"FPM","placement":"Suffix","space":true},"ftPerMin":{"text":"ft/min","placement":"Suffix","space":true}}},"feetPerSecond":{"defaultSymbol":"fps","unitSystem":"Imperial","parentUnits":{"feet":1,"seconds":-1},"symbols":{"fps":{"text":"FPS","placement":"Suffix","space":true},"ftPerS":{"text":"ft/s","placement":"Suffix","space":true}}},"feetPerSecondSquared":{"unitSystem":"Imperial","parentUnits":{"feetPerSecond":1,"seconds":-1},"symbols":{"ftPerSSup2":{"text":"ft/s²","placement":"Suffix","space":true}}},"feetToTheFourthPower":{"unitSystem":"Imperial","parentUnits":{"feet":4},"symbols":{"ftSup4":{"text":"ft⁴","placement":"Suffix","space":true}}},"feetToTheSixthPower":{"unitSystem":"Imperial","parentUnits":{"feet":6},"symbols":{"ftSup6":{"text":"ft⁶","placement":"Suffix","space":true}}},"fixed":{"unitSystem":"Metric","parentUnits":{"ratioTo1":1}},"footcandles":{"defaultSymbol":"fc","unitSystem":"Imperial","parentUnits":{"lumens":1,"squareFeet":-1},"symbols":{"fc":{"text":"fc","placement":"Suffix","space":true},"ftc":{"text":"Ftc","placement":"Suffix","space":true}}},"footlamberts":{"defaultSymbol":"fL","unitSystem":"Imperial","parentFactors":{"pi":-1},"parentUnits":{"candelas":1,"squareFeet":-1},"symbols":{"fL":{"text":"fL","placement":"Suffix","space":true},"flLowercase":{"text":"fl","placement":"Suffix","space":true},"ftL":{"text":"ftL","placement":"Suffix","space":true}}},"gammas":{"unitSystem":"Metric","parentFactors":{"nano":1},"parentUnits":{"teslas":1},"symbols":{"gamma":{"text":"gamma","placement":"Suffix","space":true}}},"gauss":{"unitSystem":"Metric","parentFactors":{"ten":-4},"parentUnits":{"teslas":1},"symbols":{"gs":{"text":"Gs","placement":"Suffix","space":true}}},"general":{"unitSystem":"Metric","parentUnits":{"ratioTo1":1}},"gigajoules":{"unitSystem":"Metric","parentFactors":{"giga":1},"parentUnits":{"joules":1},"symbols":{"GJ":{"text":"GJ","placement":"Suffix","space":true}}},"gradians":{"unitSystem":"Metric","factor":0.9,"parentUnits":{"degrees":1},"symbols":{"grad":{"text":"grad","placement":"Suffix","space":true}}},"grains":{"unitSystem":"Imperial","factor":64.79891,"parentUnits":{"milligrams":1},"symbols":{"gr":{"text":"gr","placement":"Suffix","space":true}}},"grainsPerHourSquareFootInchMercury":{"unitSystem":"Imperial","parentUnits":{"grains":1,"hours":-1,"squareFeet":-1,"inchesOfMercury32DegreesFahrenheit":-1},"symbols":{"grPerHFtSup2InHg":{"text":"gr/(h·ft²·inHg)","placement":"Suffix","space":true}}},"gramSquareMillimeters":{"unitSystem":"Metric","parentUnits":{"grams":1,"squareMillimeters":1}},"grams":{"unitSystem":"Metric","factor":0.001,"parentUnits":{"kilograms":1},"symbols":{"gram":{"text":"g","placement":"Suffix","space":true}}},"hectares":{"unitSystem":"Metric","parentUnits":{"squareHectometers":1},"symbols":{"hectare":{"text":"hectare","placement":"Suffix","space":true}}},"hectometers":{"unitSystem":"Metric","parentFactors":{"hecto":1},"parentUnits":{"meters":1},"symbols":{"hm":{"text":"hm","placement":"Suffix","space":true}}},"henries":{"unitSystem":"Metric","parentUnits":{"ohms":1,"seconds":1},"symbols":{"henry":{"text":"H","placement":"Suffix","space":true}}},"hertz":{"unitSystem":"Metric","parentUnits":{"cyclesPerSecond":1},"symbols":{"hz":{"text":"Hz","placement":"Suffix","space":true}}},"horsepower":{"unitSystem":"Imperial","factor":33000,"parentUnits":{"poundForceFeet":1,"minutes":-1},"symbols":{"hp":{"text":"hp","placement":"Suffix","space":true}}},"hourSquareFootDegreesFahrenheitPerBritishThermalUnit":{"unitSystem":"Imperial","parentUnits":{"hours":1,"squareFeet":1,"fahrenheitInterval":1,"britishThermalUnits":-1},"symbols":{"hFtSup2DegreeFPerBtu":{"text":"(h·ft²·°F)/BTU","placement":"Suffix","space":true}}},"hours":{"unitSystem":"Metric","factor":60,"parentUnits":{"minutes":1},"symbols":{"hour":{"text":"h","placement":"Suffix","space":true}}},"inches":{"defaultSymbol":"in","unitSystem":"Imperial","factor":2.54,"parentUnits":{"centimeters":1},"symbols":{"in":{"text":"in","placement":"Suffix","space":true},"inchDoubleQuote":{"text":"\\"","placement":"Suffix","space":false}}},"inchesOfMercury32DegreesFahrenheit":{"unitSystem":"Imperial","factor":3386.389,"parentUnits":{"pascals":1},"symbols":{"inHg":{"text":"inHg","placement":"Suffix","space":true}}},"inchesOfWater60DegreesFahrenheit":{"unitSystem":"Imperial","factor":248.84,"parentUnits":{"pascals":1},"symbols":{"inDashWg":{"text":"in-wg","placement":"Suffix","space":true}}},"inchesOfWater60DegreesFahrenheitPer100Feet":{"unitSystem":"Imperial","factor":0.01,"parentUnits":{"inchesOfWater60DegreesFahrenheit":1,"feet":-1},"symbols":{"inDashWgPer100ft":{"text":"in-wg/100ft","placement":"Suffix","space":true}}},"inchesPerSecond":{"unitSystem":"Imperial","parentUnits":{"inches":1,"seconds":-1},"symbols":{"inPerS":{"text":"in/s","placement":"Suffix","space":true}}},"inchesPerSecondSquared":{"unitSystem":"Imperial","parentUnits":{"inchesPerSecond":1,"seconds":-1},"symbols":{"inPerSSup2":{"text":"in/s²","placement":"Suffix","space":true}}},"inchesToTheFourthPower":{"unitSystem":"Imperial","parentUnits":{"inches":4},"symbols":{"inSup4":{"text":"in⁴","placement":"Suffix","space":true}}},"inchesToTheSixthPower":{"unitSystem":"Imperial","parentUnits":{"inches":6},"symbols":{"inSup6":{"text":"in⁶","placement":"Suffix","space":true}}},"inverseDegreesCelsius":{"unitSystem":"Metric","parentUnits":{"celsiusInterval":-1},"symbols":{"invDegreeC":{"text":"1/°C","placement":"Suffix","space":true}}},"inverseDegreesFahrenheit":{"unitSystem":"Imperial","parentUnits":{"fahrenheitInterval":-1},"symbols":{"invDegreeF":{"text":"1/°F","placement":"Suffix","space":true}}},"inverseKilonewtons":{"unitSystem":"Metric","parentUnits":{"kilonewtons":-1},"symbols":{"invKN":{"text":"1/kN","placement":"Suffix","space":true}}},"inverseKips":{"unitSystem":"Imperial","parentUnits":{"kips":-1},"symbols":{"invKip":{"text":"1/kip","placement":"Suffix","space":true}}},"joules":{"unitSystem":"Metric","parentUnits":{"newtonMeters":1},"symbols":{"joule":{"text":"J","placement":"Suffix","space":true}}},"joulesPerGram":{"unitSystem":"Metric","parentUnits":{"joules":1,"grams":-1},"symbols":{"jPerG":{"text":"J/g","placement":"Suffix","space":true}}},"joulesPerGramDegreeCelsius":{"unitSystem":"Metric","parentUnits":{"joulesPerGram":1,"celsiusInterval":-1},"symbols":{"jPerGDegreeC":{"text":"J/(g·°C)","placement":"Suffix","space":true}}},"joulesPerKelvin":{"unitSystem":"Metric","parentUnits":{"joules":1,"kelvinInterval":-1},"symbols":{"jPerK":{"text":"J/K","placement":"Suffix","space":true}}},"joulesPerKilogram":{"unitSystem":"Metric","parentUnits":{"joules":1,"kilograms":-1},"symbols":{"jPerKg":{"text":"J/kg","placement":"Suffix","space":true}}},"joulesPerKilogramDegreeCelsius":{"unitSystem":"Metric","parentUnits":{"joulesPerKilogram":1,"celsiusInterval":-1},"symbols":{"jPerKgDegreeC":{"text":"J/(kg·°C)","placement":"Suffix","space":true}}},"joulesPerSquareMeterKelvin":{"unitSystem":"Metric","parentUnits":{"joules":1,"squareMeters":-1,"kelvinInterval":-1},"symbols":{"jPerMSup2K":{"text":"J/(m²·K)","placement":"Suffix","space":true}}},"kelvin":{"unitSystem":"Metric","parentUnit":"kelvinInterval","symbols":{"kelvin":{"text":"K","placement":"Suffix","space":true}}},"kelvinInterval":{"defaultSymbol":"deltaK","unitSystem":"Metric","dimension":"temperature","symbols":{"deltaK":{"text":"deltaK","placement":"Suffix","space":true},"kelvinInterval":{"text":"K","placement":"Suffix","space":true}}},"kiloamperes":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"amperes":1},"symbols":{"kA":{"text":"kA","placement":"Suffix","space":true}}},"kilocalories":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"calories":1},"symbols":{"kcal":{"text":"kcal","placement":"Suffix","space":true}}},"kilocaloriesPerSecond":{"unitSystem":"Metric","parentUnits":{"kilocalories":1,"seconds":-1},"symbols":{"kcalPerS":{"text":"kcal/s","placement":"Suffix","space":true}}},"kilogramForceMeters":{"unitSystem":"Metric","parentUnits":{"kilogramsForce":1,"meters":1},"symbols":{"kgfDashM":{"text":"kgf-m","placement":"Suffix","space":true}}},"kilogramForceMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"kilogramForceMeters":1,"meters":-1},"symbols":{"kgfDashMPerM":{"text":"kgf-m/m","placement":"Suffix","space":true}}},"kilogramKelvins":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"kelvinInterval":1},"symbols":{"kgK":{"text":"kg·K","placement":"Suffix","space":true}}},"kilograms":{"unitSystem":"Metric","dimension":"mass","symbols":{"kg":{"text":"kg","placement":"Suffix","space":true}}},"kilogramsForce":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"standardGravity":1},"symbols":{"kgf":{"text":"kgf","placement":"Suffix","space":true}}},"kilogramsForcePerMeter":{"unitSystem":"Metric","parentUnits":{"kilogramsForce":1,"meters":-1},"symbols":{"kgfPerM":{"text":"kgf/m","placement":"Suffix","space":true}}},"kilogramsForcePerSquareMeter":{"unitSystem":"Metric","parentUnits":{"kilogramsForce":1,"squareMeters":-1},"symbols":{"kgfPerMSup2":{"text":"kgf/m²","placement":"Suffix","space":true}}},"kilogramsPerCubicCentimeter":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"cubicCentimeters":-1}},"kilogramsPerCubicMeter":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"cubicMeters":-1},"symbols":{"kgPerMSup3":{"text":"kg/m³","placement":"Suffix","space":true}}},"kilogramsPerHour":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"hours":-1},"symbols":{"kgPerH":{"text":"kg/h","placement":"Suffix","space":true}}},"kilogramsPerKilogramKelvin":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"kilogramKelvins":-1},"symbols":{"kgPerKgK":{"text":"kg/(kg·K)","placement":"Suffix","space":true}}},"kilogramsPerMeter":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"meters":-1},"symbols":{"kgPerM":{"text":"kg/m","placement":"Suffix","space":true}}},"kilogramsPerMeterHour":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"meters":-1,"hours":-1},"symbols":{"kgPerMH":{"text":"kg/(m·h)","placement":"Suffix","space":true}}},"kilogramsPerMeterSecond":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"meters":-1,"seconds":-1},"symbols":{"kgPerMS":{"text":"kg/(m·s)","placement":"Suffix","space":true}}},"kilogramsPerMinute":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"minutes":-1},"symbols":{"kgPerMin":{"text":"kg/min","placement":"Suffix","space":true}}},"kilogramsPerSecond":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"seconds":-1},"symbols":{"kgPerS":{"text":"kg/s","placement":"Suffix","space":true}}},"kilogramsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"squareMeters":-1},"symbols":{"kgPerMSup2":{"text":"kg/m²","placement":"Suffix","space":true}}},"kilojoules":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"joules":1},"symbols":{"kJ":{"text":"kJ","placement":"Suffix","space":true}}},"kilojoulesPerKelvin":{"unitSystem":"Metric","parentUnits":{"kilojoules":1,"kelvinInterval":-1},"symbols":{"kJPerK":{"text":"kJ/K","placement":"Suffix","space":true}}},"kilojoulesPerSquareMeterKelvin":{"unitSystem":"Metric","parentUnits":{"kilojoules":1,"squareMeters":-1,"kelvinInterval":-1},"symbols":{"kJPerMSup2K":{"text":"kJ/(m²·K)","placement":"Suffix","space":true}}},"kilometers":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"meters":1},"symbols":{"km":{"text":"km","placement":"Suffix","space":true}}},"kilometersPerHour":{"unitSystem":"Metric","parentUnits":{"kilometers":1,"hours":-1},"symbols":{"kmPerH":{"text":"km/h","placement":"Suffix","space":true}}},"kilometersPerSecond":{"unitSystem":"Metric","parentUnits":{"kilometers":1,"seconds":-1},"symbols":{"kmPerS":{"text":"km/s","placement":"Suffix","space":true}}},"kilometersPerSecondSquared":{"unitSystem":"Metric","parentUnits":{"kilometersPerSecond":1,"seconds":-1},"symbols":{"kmPerSSup2":{"text":"km/s²","placement":"Suffix","space":true}}},"kilonewtonMeters":{"unitSystem":"Metric","parentUnits":{"kilonewtons":1,"meters":1},"symbols":{"kNDashM":{"text":"kN-m","placement":"Suffix","space":true}}},"kilonewtonMetersPerDegree":{"unitSystem":"Metric","parentUnits":{"kilonewtonMeters":1,"degrees":-1},"symbols":{"kNDashMPerDegree":{"text":"kN-m/°","placement":"Suffix","space":true}}},"kilonewtonMetersPerDegreePerMeter":{"unitSystem":"Metric","parentUnits":{"kilonewtonMetersPerDegree":1,"meters":-1},"symbols":{"kNDashMPerDegreePerM":{"text":"kN-m/°/m","placement":"Suffix","space":true}}},"kilonewtonMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"kilonewtonMeters":1,"meters":-1},"symbols":{"kNDashMPerM":{"text":"kN-m/m","placement":"Suffix","space":true}}},"kilonewtons":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"newtons":1},"symbols":{"kN":{"text":"kN","placement":"Suffix","space":true}}},"kilonewtonsPerCubicMeter":{"unitSystem":"Metric","parentUnits":{"kilonewtons":1,"cubicMeters":-1},"symbols":{"kNPerMSup3":{"text":"kN/m³","placement":"Suffix","space":true}}},"kilonewtonsPerMeter":{"unitSystem":"Metric","parentUnits":{"kilonewtons":1,"meters":-1},"symbols":{"kNPerM":{"text":"kN/m","placement":"Suffix","space":true}}},"kilonewtonsPerSquareCentimeter":{"unitSystem":"Metric","parentUnits":{"kilonewtons":1,"squareCentimeters":-1},"symbols":{"kNPerCmSup2":{"text":"kN/cm²","placement":"Suffix","space":true}}},"kilonewtonsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"kilonewtons":1,"squareMeters":-1},"symbols":{"kNPerMSup2":{"text":"kN/m²","placement":"Suffix","space":true}}},"kilonewtonsPerSquareMillimeter":{"unitSystem":"Metric","parentUnits":{"kilonewtons":1,"squareMillimeters":-1},"symbols":{"kNPerMmSup2":{"text":"kN/mm²","placement":"Suffix","space":true}}},"kilopascals":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"pascals":1},"symbols":{"kPa":{"text":"kPa","placement":"Suffix","space":true}}},"kilovoltAmperes":{"unitSystem":"Metric","parentUnits":{"kilovolts":1,"amperes":1},"symbols":{"kVA":{"text":"kVA","placement":"Suffix","space":true}}},"kilovolts":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"volts":1},"symbols":{"kV":{"text":"kV","placement":"Suffix","space":true}}},"kilowattHours":{"unitSystem":"Metric","parentUnits":{"kilowatts":1,"hours":1},"symbols":{"kWh":{"text":"kWh","placement":"Suffix","space":true}}},"kilowattHoursPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"kilowattHours":1,"squareMeters":-1},"symbols":{"kWhPerMSup2":{"text":"kWh/m²","placement":"Suffix","space":true}}},"kilowatts":{"unitSystem":"Metric","parentFactors":{"kilo":1},"parentUnits":{"watts":1},"symbols":{"kW":{"text":"kW","placement":"Suffix","space":true}}},"kipFeet":{"unitSystem":"Imperial","parentUnits":{"kips":1,"feet":1},"symbols":{"kipDashFt":{"text":"kip-ft","placement":"Suffix","space":true}}},"kipFeetPerDegree":{"unitSystem":"Imperial","parentUnits":{"kipFeet":1,"degrees":-1},"symbols":{"kipDashFtPerDegree":{"text":"kip-ft/°","placement":"Suffix","space":true}}},"kipFeetPerDegreePerFoot":{"unitSystem":"Imperial","parentUnits":{"kipFeetPerDegree":1,"feet":-1},"symbols":{"kipDashFtPerDegreePerFt":{"text":"kip-ft/°/ft","placement":"Suffix","space":true}}},"kipFeetPerFoot":{"unitSystem":"Imperial","parentUnits":{"kipFeet":1,"feet":-1},"symbols":{"kipDashFtPerFt":{"text":"kip-ft/ft","placement":"Suffix","space":true}}},"kips":{"unitSystem":"Imperial","parentFactors":{"kilo":1},"parentUnits":{"poundsForce":1},"symbols":{"kip":{"text":"kip","placement":"Suffix","space":true}}},"kipsPerCubicFoot":{"unitSystem":"Imperial","parentUnits":{"kips":1,"cubicFeet":-1},"symbols":{"kipPerFtSup3":{"text":"kip/ft³","placement":"Suffix","space":true}}},"kipsPerCubicInch":{"unitSystem":"Imperial","parentUnits":{"kips":1,"cubicInches":-1},"symbols":{"kipPerInSup3":{"text":"kip/in³","placement":"Suffix","space":true}}},"kipsPerFoot":{"unitSystem":"Imperial","parentUnits":{"kips":1,"feet":-1},"symbols":{"kipPerFt":{"text":"kip/ft","placement":"Suffix","space":true}}},"kipsPerInch":{"unitSystem":"Imperial","parentUnits":{"kips":1,"inches":-1},"symbols":{"kipPerIn":{"text":"kip/in","placement":"Suffix","space":true}}},"kipsPerSquareFoot":{"defaultSymbol":"kipPerFtSup2","unitSystem":"Imperial","parentUnits":{"kips":1,"squareFeet":-1},"symbols":{"kipPerFtSup2":{"text":"kip/ft²","placement":"Suffix","space":true},"ksf":{"text":"ksf","placement":"Suffix","space":true}}},"kipsPerSquareInch":{"defaultSymbol":"kipPerInSup2","unitSystem":"Imperial","parentUnits":{"kips":1,"squareInches":-1},"symbols":{"kipPerInSup2":{"text":"kip/in²","placement":"Suffix","space":true},"ksi":{"text":"ksi","placement":"Suffix","space":true}}},"liters":{"unitSystem":"Metric","parentUnits":{"decimeters":3},"symbols":{"liter":{"text":"L","placement":"Suffix","space":true}}},"litersPerHour":{"unitSystem":"Metric","parentUnits":{"liters":1,"hours":-1},"symbols":{"lPerH":{"text":"L/h","placement":"Suffix","space":true}}},"litersPerMinute":{"defaultSymbol":"lPerMin","unitSystem":"Metric","parentUnits":{"liters":1,"minutes":-1},"symbols":{"lPerMin":{"text":"L/min","placement":"Suffix","space":true},"lpm":{"text":"LPM","placement":"Suffix","space":true}}},"litersPerSecond":{"defaultSymbol":"lPerS","unitSystem":"Metric","parentUnits":{"liters":1,"seconds":-1},"symbols":{"lPerS":{"text":"L/s","placement":"Suffix","space":true},"lps":{"text":"LPS","placement":"Suffix","space":true}}},"litersPerSecondCubicMeter":{"unitSystem":"Metric","parentUnits":{"litersPerSecond":1,"cubicMeters":-1},"symbols":{"lPerSMSup3":{"text":"L/(s·m³)","placement":"Suffix","space":true}}},"litersPerSecondKilowatt":{"unitSystem":"Metric","parentUnits":{"litersPerSecond":1,"kilowatts":-1},"symbols":{"lPerSKw":{"text":"L/(s·kW)","placement":"Suffix","space":true}}},"litersPerSecondSquareMeter":{"defaultSymbol":"lPerSMSup2","unitSystem":"Metric","parentUnits":{"litersPerSecond":1,"squareMeters":-1},"symbols":{"lPerSMSup2":{"text":"L/(s·m²)","placement":"Suffix","space":true},"lpsPerMSup2":{"text":"LPS/m²","placement":"Suffix","space":true}}},"lumens":{"unitSystem":"Metric","parentUnits":{"candelas":1,"steradians":1},"symbols":{"lm":{"text":"lm","placement":"Suffix","space":true}}},"lumensPerWatt":{"unitSystem":"Metric","parentUnits":{"lumens":1,"watts":-1},"symbols":{"lmPerW":{"text":"lm/W","placement":"Suffix","space":true}}},"lux":{"unitSystem":"Metric","parentUnits":{"lumens":1,"squareMeters":-1},"symbols":{"lx":{"text":"lx","placement":"Suffix","space":true}}},"maxwells":{"unitSystem":"Metric","parentFactors":{"ten":-8},"parentUnits":{"webers":1},"symbols":{"mx":{"text":"Mx","placement":"Suffix","space":true}}},"megajoules":{"unitSystem":"Metric","parentFactors":{"mega":1},"parentUnits":{"joules":1},"symbols":{"MJ":{"text":"MJ","placement":"Suffix","space":true}}},"megajoulesPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"megajoules":1,"squareMeters":-1}},"meganewtonMeters":{"unitSystem":"Metric","parentUnits":{"meganewtons":1,"meters":1},"symbols":{"mNDashM":{"text":"MN-m","placement":"Suffix","space":true}}},"meganewtonMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"meganewtonMeters":1,"meters":-1},"symbols":{"mNDashMPerM":{"text":"MN-m/m","placement":"Suffix","space":true}}},"meganewtons":{"unitSystem":"Metric","parentFactors":{"mega":1},"parentUnits":{"newtons":1},"symbols":{"mN":{"text":"MN","placement":"Suffix","space":true}}},"meganewtonsPerMeter":{"unitSystem":"Metric","parentUnits":{"meganewtons":1,"meters":-1},"symbols":{"mNPerM":{"text":"MN/m","placement":"Suffix","space":true}}},"meganewtonsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"meganewtons":1,"squareMeters":-1},"symbols":{"mNPerMSup2":{"text":"MN/m²","placement":"Suffix","space":true}}},"megapascals":{"unitSystem":"Metric","parentFactors":{"mega":1},"parentUnits":{"pascals":1},"symbols":{"mPa":{"text":"MPa","placement":"Suffix","space":true}}},"megawattHours":{"unitSystem":"Metric","parentUnits":{"megawatts":1,"hours":1},"symbols":{"mWh":{"text":"mWh","placement":"Suffix","space":true}}},"megawatts":{"unitSystem":"Metric","parentFactors":{"mega":1},"parentUnits":{"watts":1},"symbols":{"MW":{"text":"MW","placement":"Suffix","space":true}}},"meters":{"defaultSymbol":"meter","unitSystem":"Metric","dimension":"length","symbols":{"meter":{"text":"m","placement":"Suffix","space":true},"metersAndCentimeters":{"inherits":"symbol"}}},"metersOfWaterColumn":{"unitSystem":"Metric","parentUnits":{"meters":1,"standardGravity":1,"waterDensity4DegreesCelsius":1},"symbols":{"mH2O":{"text":"mH2O","placement":"Suffix","space":true}}},"metersOfWaterColumnPerMeter":{"unitSystem":"Metric","parentUnits":{"metersOfWaterColumn":1,"meters":-1},"symbols":{"mH2OPerM":{"text":"mH2O/m","placement":"Suffix","space":true}}},"metersPerKilonewton":{"unitSystem":"Metric","parentUnits":{"meters":1,"kilonewtons":-1},"symbols":{"mPerKN":{"text":"m/kN","placement":"Suffix","space":true}}},"metersPerKilonewtonMeter":{"unitSystem":"Metric","parentUnits":{"meters":1,"kilonewtonMeters":-1},"symbols":{"mPerKNDashM":{"text":"m/kN-m","placement":"Suffix","space":true}}},"metersPerSecond":{"unitSystem":"Metric","parentUnits":{"meters":1,"seconds":-1},"symbols":{"mPerS":{"text":"m/s","placement":"Suffix","space":true}}},"metersPerSecondSquared":{"unitSystem":"Metric","parentUnits":{"metersPerSecond":1,"seconds":-1},"symbols":{"mPerSSup2":{"text":"m/s²","placement":"Suffix","space":true}}},"metersToTheFourthPower":{"unitSystem":"Metric","parentUnits":{"meters":4},"symbols":{"mSup4":{"text":"m⁴","placement":"Suffix","space":true}}},"metersToTheSixthPower":{"unitSystem":"Metric","parentUnits":{"meters":6},"symbols":{"mSup6":{"text":"m⁶","placement":"Suffix","space":true}}},"mhos":{"unitSystem":"Metric","parentUnits":{"ohms":-1},"symbols":{"mho":{"text":"mho","placement":"Suffix","space":true}}},"microarcseconds":{"unitSystem":"Metric","parentFactors":{"micro":1},"parentUnits":{"arcseconds":1}},"micrograms":{"unitSystem":"Metric","parentFactors":{"micro":1},"parentUnits":{"grams":1}},"microgramsPerCubicMeter":{"unitSystem":"Metric","parentUnits":{"micrograms":1,"cubicMeters":-1},"symbols":{"ugPerMSup3":{"text":"µg/m³","placement":"Suffix","space":true}}},"microinches":{"unitSystem":"Imperial","parentFactors":{"micro":1},"parentUnits":{"inches":1},"symbols":{"uin":{"text":"µin","placement":"Suffix","space":true}}},"microinchesPerInchDegreeFahrenheit":{"unitSystem":"Imperial","parentFactors":{"micro":1},"parentUnits":{"inverseDegreesFahrenheit":1},"symbols":{"uinPerInDegreeF":{"text":"µin/(in·°F)","placement":"Suffix","space":true}}},"micrometersPerMeterDegreeCelsius":{"unitSystem":"Metric","parentFactors":{"micro":1},"parentUnits":{"inverseDegreesCelsius":1},"symbols":{"umPerMDegreeC":{"text":"µm/(m·°C)","placement":"Suffix","space":true}}},"microns":{"unitSystem":"Metric","parentFactors":{"micro":1},"parentUnits":{"meters":1},"symbols":{"micron":{"text":"micron","placement":"Suffix","space":true}}},"microseconds":{"unitSystem":"Metric","parentFactors":{"micro":1},"parentUnits":{"seconds":1}},"miles":{"unitSystem":"Imperial","factor":1760,"parentUnits":{"yards":1},"symbols":{"mi":{"text":"mi","placement":"Suffix","space":true}}},"milesPerHour":{"unitSystem":"Imperial","parentUnits":{"miles":1,"hours":-1},"symbols":{"mph":{"text":"mph","placement":"Suffix","space":true}}},"milesPerSecond":{"unitSystem":"Imperial","parentUnits":{"miles":1,"seconds":-1},"symbols":{"miPerS":{"text":"mi/s","placement":"Suffix","space":true}}},"milesPerSecondSquared":{"unitSystem":"Imperial","parentUnits":{"milesPerSecond":1,"seconds":-1},"symbols":{"miPerSSup2":{"text":"mi/s²","placement":"Suffix","space":true}}},"milliamperes":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"amperes":1},"symbols":{"mA":{"text":"mA","placement":"Suffix","space":true}}},"milligrams":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"grams":1},"symbols":{"mg":{"text":"mg","placement":"Suffix","space":true}}},"millimeters":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"meters":1},"symbols":{"mm":{"text":"mm","placement":"Suffix","space":true}}},"millimetersOfMercury":{"unitSystem":"Metric","factor":133.3224,"parentUnits":{"pascals":1},"symbols":{"mmHg":{"text":"mmHg","placement":"Suffix","space":true}}},"millimetersOfWaterColumn":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"metersOfWaterColumn":1},"symbols":{"mmH2O":{"text":"mmH2O","placement":"Suffix","space":true}}},"millimetersOfWaterColumnPerMeter":{"unitSystem":"Metric","parentUnits":{"millimetersOfWaterColumn":1,"meters":-1},"symbols":{"mmH2OPerM":{"text":"mmH2O/m","placement":"Suffix","space":true}}},"millimetersToTheFourthPower":{"unitSystem":"Metric","parentUnits":{"millimeters":4},"symbols":{"mmSup4":{"text":"mm⁴","placement":"Suffix","space":true}}},"millimetersToTheSixthPower":{"unitSystem":"Metric","parentUnits":{"millimeters":6},"symbols":{"mmSup6":{"text":"mm⁶","placement":"Suffix","space":true}}},"milliseconds":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"seconds":1},"symbols":{"ms":{"text":"ms","placement":"Suffix","space":true}}},"millivolts":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"volts":1},"symbols":{"mV":{"text":"mV","placement":"Suffix","space":true}}},"milliwatts":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"watts":1}},"mils":{"unitSystem":"Imperial","parentFactors":{"milli":1},"parentUnits":{"inches":1},"symbols":{"mil":{"text":"mil","placement":"Suffix","space":true}}},"minutes":{"unitSystem":"Metric","factor":60,"parentUnits":{"seconds":1},"symbols":{"min":{"text":"min","placement":"Suffix","space":true}}},"nanograms":{"unitSystem":"Metric","parentFactors":{"nano":1},"parentUnits":{"grams":1},"symbols":{"ng":{"text":"ng","placement":"Suffix","space":true}}},"nanogramsPerPascalSecondSquareMeter":{"unitSystem":"Metric","parentUnits":{"nanograms":1,"seconds":-1,"squareMeters":-1,"pascals":-1},"symbols":{"ngPerPaSMSup2":{"text":"ng/(Pa·s·m²)","placement":"Suffix","space":true}}},"nanometers":{"unitSystem":"Metric","parentFactors":{"nano":1},"parentUnits":{"meters":1},"symbols":{"nm":{"text":"nm","placement":"Suffix","space":true}}},"nanoseconds":{"unitSystem":"Metric","parentFactors":{"nano":1},"parentUnits":{"seconds":1}},"nauticalMiles":{"unitSystem":"Imperial","factor":1852,"parentUnits":{"meters":1},"symbols":{"nauticalMile":{"text":"M","placement":"Suffix","space":true}}},"newtonMeters":{"unitSystem":"Metric","parentUnits":{"newtons":1,"meters":1},"symbols":{"nDashM":{"text":"N-m","placement":"Suffix","space":true}}},"newtonMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"newtonMeters":1,"meters":-1},"symbols":{"nDashMPerM":{"text":"N-m/m","placement":"Suffix","space":true}}},"newtonSecondsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"newtons":1,"seconds":1,"squareMeters":-1},"symbols":{"nSPerMSup2":{"text":"N·s/m²","placement":"Suffix","space":true}}},"newtons":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"metersPerSecondSquared":1},"symbols":{"newton":{"text":"N","placement":"Suffix","space":true}}},"newtonsPerMeter":{"unitSystem":"Metric","parentUnits":{"newtons":1,"meters":-1},"symbols":{"nPerM":{"text":"N/m","placement":"Suffix","space":true}}},"newtonsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"newtons":1,"squareMeters":-1},"symbols":{"nPerMSup2":{"text":"N/m²","placement":"Suffix","space":true}}},"newtonsPerSquareMillimeter":{"unitSystem":"Metric","parentUnits":{"newtons":1,"squareMillimeters":-1},"symbols":{"nPerMmSup2":{"text":"N/mm²","placement":"Suffix","space":true}}},"oersteds":{"unitSystem":"Metric","factor":250,"parentFactors":{"pi":-1},"parentUnits":{"amperes":1,"meters":-1},"symbols":{"oe":{"text":"Oe","placement":"Suffix","space":true}}},"ohmMeters":{"unitSystem":"Metric","parentUnits":{"ohms":1,"meters":1},"symbols":{"ohmM":{"text":"ohm·m","placement":"Suffix","space":true}}},"ohms":{"defaultSymbol":"omega","unitSystem":"Metric","parentUnits":{"volts":1,"amperes":-1},"symbols":{"ohm":{"text":"ohm","placement":"Suffix","space":true},"omega":{"text":"Ω","placement":"Suffix","space":true}}},"ouncesForce":{"unitSystem":"Imperial","factor":0.0625,"parentUnits":{"poundsForce":1},"symbols":{"ozf":{"text":"ozf","placement":"Suffix","space":true}}},"ouncesMass":{"unitSystem":"Imperial","factor":0.0625,"parentUnits":{"poundsMass":1},"symbols":{"oz":{"text":"oz","placement":"Suffix","space":true}}},"partsPerBillion":{"unitSystem":"Metric","parentFactors":{"nano":1},"parentUnits":{"ratioTo1":1},"symbols":{"ppb":{"text":"ppb","placement":"Suffix","space":true}}},"partsPerMillion":{"unitSystem":"Metric","parentFactors":{"micro":1},"parentUnits":{"ratioTo1":1},"symbols":{"ppm":{"text":"ppm","placement":"Suffix","space":true}}},"pascalSeconds":{"unitSystem":"Metric","parentUnits":{"pascals":1,"seconds":1},"symbols":{"paDashS":{"text":"Pa-s","placement":"Suffix","space":true}}},"pascals":{"unitSystem":"Metric","parentUnits":{"newtonsPerSquareMeter":1},"symbols":{"pa":{"text":"Pa","placement":"Suffix","space":true}}},"pascalsPerMeter":{"unitSystem":"Metric","parentUnits":{"pascals":1,"meters":-1},"symbols":{"paPerM":{"text":"Pa/m","placement":"Suffix","space":true}}},"perMille":{"unitSystem":"Metric","parentFactors":{"milli":1},"parentUnits":{"ratioTo1":1},"symbols":{"perMille":{"text":"‰","placement":"Suffix","space":false}}},"percentage":{"unitSystem":"Metric","parentFactors":{"centi":1},"parentUnits":{"ratioTo1":1},"symbols":{"percent":{"text":"%","placement":"Suffix","space":false},"percentRH":{"text":"%RH","placement":"Suffix","space":false},"percentSpRH":{"text":"percent RH","placement":"Suffix","space":false},"rh":{"text":"RH","placement":"Suffix","space":false}}},"pi":{"unitSystem":"Imperial","parentFactors":{"pi":1},"parentUnits":{"radians":1},"symbols":{"pi":{"text":"π","placement":"Suffix","space":true}}},"poises":{"unitSystem":"Metric","parentUnits":{"grams":1,"centimeters":-1,"seconds":-1},"symbols":{"poise":{"text":"P","placement":"Suffix","space":true}}},"poundForceFeet":{"defaultSymbol":"lbForceDashFt","unitSystem":"Imperial","parentUnits":{"poundsForce":1,"feet":1},"symbols":{"lbForceDashFt":{"text":"lb-ft","placement":"Suffix","space":true},"lbfDashFt":{"text":"lbf-ft","placement":"Suffix","space":true}}},"poundForceFeetPerFoot":{"defaultSymbol":"lbForceDashFtPerFt","unitSystem":"Imperial","parentUnits":{"poundForceFeet":1,"feet":-1},"symbols":{"lbForceDashFtPerFt":{"text":"lb-ft/ft","placement":"Suffix","space":true},"lbfDashFtPerFt":{"text":"lbf-ft/ft","placement":"Suffix","space":true}}},"poundForceSecondsPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"poundsForce":1,"seconds":1,"squareFeet":-1},"symbols":{"lbForceSPerFtSup2":{"text":"lb·s/ft²","placement":"Suffix","space":true}}},"poundMassDegreesFahrenheit":{"unitSystem":"Imperial","parentUnits":{"poundsMass":1,"fahrenheitInterval":1},"symbols":{"lbMassDegreeF":{"text":"lb·°F","placement":"Suffix","space":true}}},"poundsForce":{"defaultSymbol":"lbForce","unitSystem":"Imperial","parentUnits":{"poundsMass":1,"standardGravity":1},"symbols":{"lbForce":{"text":"lb","placement":"Suffix","space":true},"lbf":{"text":"lbf","placement":"Suffix","space":true}}},"poundsForcePerCubicFoot":{"defaultSymbol":"lbForcePerFtSup3","unitSystem":"Imperial","parentUnits":{"poundsForce":1,"cubicFeet":-1},"symbols":{"lbForcePerFtSup3":{"text":"lb/ft³","placement":"Suffix","space":true},"lbfPerFtSup3":{"text":"lbf/ft³","placement":"Suffix","space":true}}},"poundsForcePerFoot":{"defaultSymbol":"lbForcePerFt","unitSystem":"Imperial","parentUnits":{"poundsForce":1,"feet":-1},"symbols":{"lbForcePerFt":{"text":"lb/ft","placement":"Suffix","space":true},"lbfPerFt":{"text":"lbf/ft","placement":"Suffix","space":true}}},"poundsForcePerSquareFoot":{"defaultSymbol":"lbForcePerFtSup2","unitSystem":"Imperial","parentUnits":{"poundsForce":1,"squareFeet":-1},"symbols":{"lbForcePerFtSup2":{"text":"lb/ft²","placement":"Suffix","space":true},"lbfPerFtSup2":{"text":"lbf/ft²","placement":"Suffix","space":true},"psf":{"text":"psf","placement":"Suffix","space":true}}},"poundsForcePerSquareInch":{"defaultSymbol":"lbForcePerInSup2","unitSystem":"Imperial","parentUnits":{"poundsForce":1,"squareInches":-1},"symbols":{"lbForcePerInSup2":{"text":"lb/in²","placement":"Suffix","space":true},"lbfPerInSup2":{"text":"lbf/in²","placement":"Suffix","space":true},"psi":{"text":"psi","placement":"Suffix","space":true},"psia":{"text":"psia","placement":"Suffix","space":true},"psig":{"text":"psig","placement":"Suffix","space":true}}},"poundsMass":{"defaultSymbol":"lbMass","unitSystem":"Imperial","factor":0.45359237,"parentUnits":{"kilograms":1},"symbols":{"lbMass":{"text":"lb","placement":"Suffix","space":true},"lbm":{"text":"lbm","placement":"Suffix","space":true}}},"poundsMassPerCubicFoot":{"defaultSymbol":"lbMassPerFtSup3","unitSystem":"Imperial","parentUnits":{"poundsMass":1,"cubicFeet":-1},"symbols":{"lbMassPerFtSup3":{"text":"lb/ft³","placement":"Suffix","space":true},"lbmPerFtSup3":{"text":"lbm/ft³","placement":"Suffix","space":true}}},"poundsMassPerCubicInch":{"defaultSymbol":"lbMassPerInSup3","unitSystem":"Imperial","parentUnits":{"poundsMass":1,"cubicInches":-1},"symbols":{"lbMassPerInSup3":{"text":"lb/in³","placement":"Suffix","space":true},"lbmPerInSup3":{"text":"lbm/in³","placement":"Suffix","space":true}}},"poundsMassPerFoot":{"defaultSymbol":"lbMassPerFt","unitSystem":"Imperial","parentUnits":{"poundsMass":1,"feet":-1},"symbols":{"lbMassPerFt":{"text":"lb/ft","placement":"Suffix","space":true},"lbmPerFt":{"text":"lbm/ft","placement":"Suffix","space":true}}},"poundsMassPerFootHour":{"defaultSymbol":"lbMassPerFtDashH","unitSystem":"Imperial","parentUnits":{"poundsMassPerFoot":1,"hours":-1},"symbols":{"lbMassPerFtDashH":{"text":"lb/ft-h","placement":"Suffix","space":true},"lbmPerFtDashH":{"text":"lbm/ft-h","placement":"Suffix","space":true}}},"poundsMassPerFootSecond":{"defaultSymbol":"lbMassPerFtDashS","unitSystem":"Imperial","parentUnits":{"poundsMassPerFoot":1,"seconds":-1},"symbols":{"lbMassPerFtDashS":{"text":"lb/ft-s","placement":"Suffix","space":true},"lbmPerFtDashS":{"text":"lbm/ft-s","placement":"Suffix","space":true}}},"poundsMassPerHour":{"unitSystem":"Imperial","parentUnits":{"poundsMass":1,"hours":-1},"symbols":{"lbMassPerH":{"text":"lb/h","placement":"Suffix","space":true}}},"poundsMassPerMinute":{"unitSystem":"Imperial","parentUnits":{"poundsMass":1,"minutes":-1},"symbols":{"lbMassPerMin":{"text":"lb/min","placement":"Suffix","space":true}}},"poundsMassPerPoundDegreeFahrenheit":{"unitSystem":"Imperial","parentUnits":{"poundsMass":1,"poundMassDegreesFahrenheit":-1},"symbols":{"lbMassPerLbDegreeF":{"text":"lb/(lb·°F)","placement":"Suffix","space":true}}},"poundsMassPerSecond":{"unitSystem":"Imperial","parentUnits":{"poundsMass":1,"seconds":-1},"symbols":{"lbMassPerS":{"text":"lb/s","placement":"Suffix","space":true}}},"poundsMassPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"poundsMass":1,"squareFeet":-1},"symbols":{"lbMassPerFtSup2":{"text":"lb/ft²","placement":"Suffix","space":true}}},"radians":{"unitSystem":"Metric","symbols":{"rad":{"text":"rad","placement":"Suffix","space":true}}},"radiansPerSecond":{"unitSystem":"Metric","parentUnits":{"radians":1,"seconds":-1},"symbols":{"radPerS":{"text":"rad/s","placement":"Suffix","space":true}}},"rankine":{"unitSystem":"Imperial","parentUnit":"rankineInterval","symbols":{"degreeR":{"text":"°R","placement":"Suffix","space":true}}},"rankineInterval":{"defaultSymbol":"degreeRInterval","unitSystem":"Imperial","parentFactors":{"nineFifths":-1},"parentUnits":{"kelvinInterval":1},"symbols":{"degreeRInterval":{"text":"°R","placement":"Suffix","space":true},"deltaDegreeR":{"text":"delta°R","placement":"Suffix","space":true}}},"ratioTo1":{"unitSystem":"Metric","symbols":{"colon1":{"text":":1","placement":"Suffix","space":false}}},"ratioTo10":{"unitSystem":"Metric","parentFactors":{"ten":-1},"parentUnits":{"ratioTo1":1},"symbols":{"colon10":{"text":":10","placement":"Suffix","space":false}}},"ratioTo12":{"unitSystem":"Imperial","parentFactors":{"twelve":-1},"parentUnits":{"ratioTo1":1},"symbols":{"colon12":{"text":":12","placement":"Suffix","space":false}}},"revolutionsPerMinute":{"unitSystem":"Imperial","parentUnits":{"turns":1,"minutes":-1},"symbols":{"rpm":{"text":"RPM","placement":"Suffix","space":true}}},"revolutionsPerSecond":{"unitSystem":"Metric","parentUnits":{"turns":1,"seconds":-1},"symbols":{"rps":{"text":"RPS","placement":"Suffix","space":true}}},"riseDividedBy1000Millimeters":{"unitSystem":"Metric","parentUnits":{"perMille":1}},"riseDividedBy10Feet":{"unitSystem":"Imperial","parentUnits":{"ratioTo10":1}},"riseDividedBy120Inches":{"unitSystem":"Imperial","parentFactors":{"ten":-1},"parentUnits":{"riseDividedBy12Inches":1}},"riseDividedBy12Inches":{"unitSystem":"Imperial","parentUnits":{"ratioTo12":1}},"riseDividedBy1Foot":{"unitSystem":"Imperial","parentUnits":{"ratioTo1":1}},"seconds":{"unitSystem":"Metric","dimension":"time","symbols":{"second":{"text":"s","placement":"Suffix","space":true}}},"siemens":{"unitSystem":"Metric","parentUnits":{"mhos":1},"symbols":{"siemens":{"text":"S","placement":"Suffix","space":true}}},"slugs":{"unitSystem":"Imperial","parentUnits":{"poundsForce":1,"seconds":2,"feet":-1},"symbols":{"slug":{"text":"slug","placement":"Suffix","space":true}}},"squareCentimeters":{"defaultSymbol":"cmSup2","unitSystem":"Metric","parentUnits":{"centimeters":2},"symbols":{"cmCaret2":{"text":"cm^2","placement":"Suffix","space":true},"cmSup2":{"text":"cm²","placement":"Suffix","space":true}}},"squareCentimetersPerMeter":{"unitSystem":"Metric","parentUnits":{"squareCentimeters":1,"meters":-1},"symbols":{"cmSup2PerM":{"text":"cm²/m","placement":"Suffix","space":true}}},"squareFeet":{"defaultSymbol":"ftSup2","unitSystem":"Imperial","parentUnits":{"feet":2},"symbols":{"ftCaret2":{"text":"ft^2","placement":"Suffix","space":true},"ftSup2":{"text":"ft²","placement":"Suffix","space":true},"sf":{"text":"SF","placement":"Suffix","space":true}}},"squareFeetPer1000BritishThermalUnitsPerHour":{"defaultSymbol":"ftSup2HPerKbtu","unitSystem":"Imperial","factor":0.001,"parentUnits":{"squareFeet":1,"britishThermalUnitsPerHour":-1},"symbols":{"ftSup2HPerKbtu":{"text":"ft²·h/kBtu","placement":"Suffix","space":true},"ftSup2PerMbh":{"text":"ft²/MBh","placement":"Suffix","space":true},"sfHPerKbtu":{"text":"SF·h/kBtu","placement":"Suffix","space":true},"sfPerMbh":{"text":"SF/MBh","placement":"Suffix","space":true}}},"squareFeetPerFoot":{"unitSystem":"Imperial","parentUnits":{"squareFeet":1,"feet":-1},"symbols":{"ftSup2PerFt":{"text":"ft²/ft","placement":"Suffix","space":true}}},"squareFeetPerKip":{"unitSystem":"Imperial","parentUnits":{"squareFeet":1,"kips":-1},"symbols":{"ftSup2PerKip":{"text":"ft²/kip","placement":"Suffix","space":true}}},"squareFeetPerKipFoot":{"unitSystem":"Imperial","parentUnits":{"squareFeet":1,"kipFeet":-1},"symbols":{"ftSup2PerKipDashFt":{"text":"ft²/kip-ft","placement":"Suffix","space":true}}},"squareFeetPerSecond":{"unitSystem":"Imperial","parentUnits":{"squareFeet":1,"seconds":-1},"symbols":{"ftSup2PerS":{"text":"ft²/s","placement":"Suffix","space":true}}},"squareFeetPerTonOfRefrigeration":{"defaultSymbol":"ftSup2PerTon","unitSystem":"Imperial","parentUnits":{"squareFeet":1,"tonsOfRefrigeration":-1},"symbols":{"ftSup2PerTon":{"text":"ft²/ton","placement":"Suffix","space":true},"sfPerTon":{"text":"SF/ton","placement":"Suffix","space":true}}},"squareHectometers":{"unitSystem":"Metric","parentUnits":{"hectometers":2},"symbols":{"hmSup2":{"text":"hm²","placement":"Suffix","space":true}}},"squareInches":{"defaultSymbol":"inSup2","unitSystem":"Imperial","parentUnits":{"inches":2},"symbols":{"inCaret2":{"text":"in^2","placement":"Suffix","space":true},"inSup2":{"text":"in²","placement":"Suffix","space":true}}},"squareInchesPerFoot":{"unitSystem":"Imperial","parentUnits":{"squareInches":1,"feet":-1},"symbols":{"inSup2PerFt":{"text":"in²/ft","placement":"Suffix","space":true}}},"squareMeterKelvinsPerWatt":{"unitSystem":"Metric","parentUnits":{"squareMeters":1,"kelvinInterval":1,"watts":-1},"symbols":{"mSup2KPerW":{"text":"(m²·K)/W","placement":"Suffix","space":true}}},"squareMeters":{"defaultSymbol":"mSup2","unitSystem":"Metric","parentUnits":{"meters":2},"symbols":{"mCaret2":{"text":"m^2","placement":"Suffix","space":true},"mSup2":{"text":"m²","placement":"Suffix","space":true}}},"squareMetersPerKilonewton":{"unitSystem":"Metric","parentUnits":{"squareMeters":1,"kilonewtons":-1},"symbols":{"mSup2PerKN":{"text":"m²/kN","placement":"Suffix","space":true}}},"squareMetersPerKilonewtonMeter":{"unitSystem":"Metric","parentUnits":{"squareMeters":1,"kilonewtonMeters":-1},"symbols":{"mSup2PerKNDashM":{"text":"m²/kN-m","placement":"Suffix","space":true}}},"squareMetersPerKilowatt":{"unitSystem":"Metric","parentUnits":{"squareMeters":1,"kilowatts":-1},"symbols":{"mSup2PerKw":{"text":"m²/kW","placement":"Suffix","space":true}}},"squareMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"squareMeters":1,"meters":-1},"symbols":{"mSup2PerM":{"text":"m²/m","placement":"Suffix","space":true}}},"squareMetersPerSecond":{"unitSystem":"Metric","parentUnits":{"squareMeters":1,"seconds":-1},"symbols":{"mSup2PerS":{"text":"m²/s","placement":"Suffix","space":true}}},"squareMillimeters":{"defaultSymbol":"mmSup2","unitSystem":"Metric","parentUnits":{"millimeters":2},"symbols":{"mmCaret2":{"text":"mm^2","placement":"Suffix","space":true},"mmSup2":{"text":"mm²","placement":"Suffix","space":true}}},"squareMillimetersPerMeter":{"unitSystem":"Metric","parentUnits":{"squareMillimeters":1,"meters":-1},"symbols":{"mmSup2PerM":{"text":"mm²/m","placement":"Suffix","space":true}}},"squareMils":{"defaultSymbol":"milSup2","unitSystem":"Imperial","parentUnits":{"mils":2},"symbols":{"milCaret2":{"text":"mil^2","placement":"Suffix","space":true},"milSup2":{"text":"mil²","placement":"Suffix","space":true}}},"squareYards":{"unitSystem":"Imperial","parentUnits":{"yards":2},"symbols":{"ydSup2":{"text":"yd²","placement":"Suffix","space":true}}},"standardGravity":{"unitSystem":"Metric","factor":9.80665,"parentUnits":{"metersPerSecondSquared":1},"symbols":{"gravity":{"text":"𝘨","placement":"Suffix","space":true}}},"steradians":{"unitSystem":"Metric","symbols":{"sr":{"text":"sr","placement":"Suffix","space":true}}},"teslas":{"unitSystem":"Metric","parentUnits":{"webers":1,"meters":-2},"symbols":{"tesla":{"text":"T","placement":"Suffix","space":true}}},"therms":{"unitSystem":"Imperial","factor":100000,"parentUnits":{"britishThermalUnits":1},"symbols":{"therm":{"text":"therm","placement":"Suffix","space":true}}},"thousandBritishThermalUnits":{"unitSystem":"Imperial","parentFactors":{"kilo":1},"parentUnits":{"britishThermalUnits":1},"symbols":{"kBtu":{"text":"kBtu","placement":"Suffix","space":true}}},"thousandBritishThermalUnitsPerHour":{"unitSystem":"Imperial","factor":1000,"parentUnits":{"britishThermalUnitsPerHour":1},"symbols":{"mbh":{"text":"MBH","placement":"Suffix","space":true}}},"thousandBritishThermalUnitsPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"thousandBritishThermalUnits":1,"squareFeet":-1},"symbols":{"kBtuPerFtSup2":{"text":"kBtu/ft²","placement":"Suffix","space":true}}},"tonneForceMeters":{"unitSystem":"Metric","parentUnits":{"tonnesForce":1,"meters":1},"symbols":{"tfDashM":{"text":"Tf-m","placement":"Suffix","space":true}}},"tonneForceMetersPerMeter":{"unitSystem":"Metric","parentUnits":{"tonneForceMeters":1,"meters":-1},"symbols":{"tfDashMPerM":{"text":"Tf-m/m","placement":"Suffix","space":true}}},"tonnes":{"unitSystem":"Metric","factor":1000,"parentUnits":{"kilograms":1},"symbols":{"tonne":{"text":"t","placement":"Suffix","space":true}}},"tonnesForce":{"unitSystem":"Metric","parentUnits":{"tonnes":1,"standardGravity":1},"symbols":{"tf":{"text":"Tf","placement":"Suffix","space":true}}},"tonnesForcePerMeter":{"unitSystem":"Metric","parentUnits":{"tonnesForce":1,"meters":-1},"symbols":{"tfPerM":{"text":"Tf/m","placement":"Suffix","space":true}}},"tonnesForcePerSquareMeter":{"unitSystem":"Metric","parentUnits":{"tonnesForce":1,"squareMeters":-1},"symbols":{"tfPerMSup2":{"text":"Tf/m²","placement":"Suffix","space":true}}},"tonsOfRefrigeration":{"defaultSymbol":"ton","unitSystem":"Imperial","factor":12000,"parentUnits":{"britishThermalUnitsPerHour":1},"symbols":{"ton":{"text":"ton","placement":"Suffix","space":true},"tonOfRefrigeration":{"text":"ton of refrigeration","placement":"Suffix","space":true}}},"turns":{"unitSystem":"Metric","factor":2,"parentFactors":{"pi":1},"parentUnits":{"radians":1},"symbols":{"tr":{"text":"tr","placement":"Suffix","space":true}}},"usGallons":{"unitSystem":"Imperial","factor":231,"parentUnits":{"cubicInches":1},"symbols":{"gal":{"text":"gal","placement":"Suffix","space":true}}},"usGallonsPerHour":{"defaultSymbol":"galPerH","unitSystem":"Imperial","parentUnits":{"usGallons":1,"hours":-1},"symbols":{"galPerH":{"text":"gal/h","placement":"Suffix","space":true},"gph":{"text":"GPH","placement":"Suffix","space":true},"usgph":{"text":"usgph","placement":"Suffix","space":true}}},"usGallonsPerMinute":{"defaultSymbol":"galPerMin","unitSystem":"Imperial","parentUnits":{"usGallons":1,"minutes":-1},"symbols":{"galPerMin":{"text":"gal/min","placement":"Suffix","space":true},"gpm":{"text":"GPM","placement":"Suffix","space":true},"usgpm":{"text":"usgpm","placement":"Suffix","space":true}}},"usSurveyFeet":{"unitSystem":"Imperial","factor":1200,"parentFactors":{"threeThousandNineHundredThirtySeven":-1},"parentUnits":{"meters":1},"symbols":{"usft":{"text":"USft","placement":"Suffix","space":true}}},"usTonnesForce":{"defaultSymbol":"stf","unitSystem":"Imperial","parentUnits":{"usTonnesMass":1,"standardGravity":1},"symbols":{"stf":{"text":"STf","placement":"Suffix","space":true},"tonsf":{"text":"Tonsf","placement":"Suffix","space":true},"usTonnesForceSt":{"text":"ST","placement":"Suffix","space":true},"usTonnesForceT":{"text":"T","placement":"Suffix","space":true},"usTonnesForceTons":{"text":"Tons","placement":"Suffix","space":true}}},"usTonnesMass":{"defaultSymbol":"usTonnesMassSt","unitSystem":"Imperial","factor":2000,"parentUnits":{"poundsMass":1},"symbols":{"usTonnesMassSt":{"text":"ST","placement":"Suffix","space":true},"usTonnesMassT":{"text":"T","placement":"Suffix","space":true},"usTonnesMassTons":{"text":"Tons","placement":"Suffix","space":true}}},"voltAmperes":{"unitSystem":"Metric","parentUnits":{"volts":1,"amperes":1},"symbols":{"vA":{"text":"VA","placement":"Suffix","space":true}}},"voltAmperesPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"voltAmperes":1,"squareFeet":-1},"symbols":{"vAPerFtSup2":{"text":"VA/ft²","placement":"Suffix","space":true}}},"voltAmperesPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"voltAmperes":1,"squareMeters":-1},"symbols":{"vAPerMSup2":{"text":"VA/m²","placement":"Suffix","space":true}}},"volts":{"unitSystem":"Metric","parentUnits":{"watts":1,"amperes":-1},"symbols":{"volt":{"text":"V","placement":"Suffix","space":true}}},"waterDensity4DegreesCelsius":{"unitSystem":"Metric","parentUnits":{"kilograms":1,"liters":-1}},"watts":{"unitSystem":"Metric","parentUnits":{"joules":1,"seconds":-1},"symbols":{"watt":{"text":"W","placement":"Suffix","space":true}}},"wattsPerCubicFoot":{"unitSystem":"Imperial","parentUnits":{"watts":1,"cubicFeet":-1},"symbols":{"wPerFtSup3":{"text":"W/ft³","placement":"Suffix","space":true}}},"wattsPerCubicFootPerMinute":{"unitSystem":"Imperial","parentUnits":{"watts":1,"cubicFeetPerMinute":-1},"symbols":{"wMinPerFtSup3":{"text":"W·min/ft³","placement":"Suffix","space":true}}},"wattsPerCubicMeter":{"unitSystem":"Metric","parentUnits":{"watts":1,"cubicMeters":-1},"symbols":{"wPerMSup3":{"text":"W/m³","placement":"Suffix","space":true}}},"wattsPerCubicMeterPerSecond":{"unitSystem":"Metric","parentUnits":{"watts":1,"cubicMetersPerSecond":-1},"symbols":{"wSPerMSup3":{"text":"W·s/m³","placement":"Suffix","space":true}}},"wattsPerFoot":{"unitSystem":"Imperial","parentUnits":{"watts":1,"feet":-1},"symbols":{"wPerFt":{"text":"W/ft","placement":"Suffix","space":true}}},"wattsPerMeter":{"unitSystem":"Metric","parentUnits":{"watts":1,"meters":-1},"symbols":{"wPerM":{"text":"W/m","placement":"Suffix","space":true}}},"wattsPerMeterKelvin":{"unitSystem":"Metric","parentUnits":{"watts":1,"meters":-1,"kelvinInterval":-1},"symbols":{"wPerMK":{"text":"W/(m·K)","placement":"Suffix","space":true}}},"wattsPerSquareFoot":{"unitSystem":"Imperial","parentUnits":{"watts":1,"squareFeet":-1},"symbols":{"wPerFtSup2":{"text":"W/ft²","placement":"Suffix","space":true}}},"wattsPerSquareMeter":{"unitSystem":"Metric","parentUnits":{"watts":1,"squareMeters":-1},"symbols":{"wPerMSup2":{"text":"W/m²","placement":"Suffix","space":true}}},"wattsPerSquareMeterKelvin":{"unitSystem":"Metric","parentUnits":{"wattsPerSquareMeter":1,"kelvinInterval":-1},"symbols":{"wPerMSup2K":{"text":"W/(m²·K)","placement":"Suffix","space":true}}},"webers":{"unitSystem":"Metric","parentUnits":{"volts":1,"seconds":1},"symbols":{"wb":{"text":"Wb","placement":"Suffix","space":true}}},"yards":{"unitSystem":"Imperial","factor":3,"parentUnits":{"feet":1},"symbols":{"yd":{"text":"yd","placement":"Suffix","space":true}}},"feetFractionalInches":{"defaultSymbol":"feetAndInches","unitSystem":"Imperial","factor":12,"parentUnits":{"inches":1},"symbols":{"feetAndInches":{"inherits":"symbol"},"footSingleQuote":{"text":"\'","placement":"Suffix","space":false},"ft":{"text":"ft","placement":"Suffix","space":true},"lf":{"text":"LF","placement":"Suffix","space":true}}},"fractionalInches":{"defaultSymbol":"in","unitSystem":"Imperial","factor":2.54,"parentUnits":{"centimeters":1},"symbols":{"in":{"text":"in","placement":"Suffix","space":true},"inchDoubleQuote":{"text":"\\"","placement":"Suffix","space":false}}},"metersCentimeters":{"defaultSymbol":"meter","unitSystem":"Metric","dimension":"length","symbols":{"meter":{"text":"m","placement":"Suffix","space":true},"metersAndCentimeters":{"inherits":"symbol"}}},"degreesMinutes":{"defaultSymbol":"degree","unitSystem":"Metric","parentFactors":{"threeHundredSixty":-1},"parentUnits":{"turns":1},"symbols":{"degree":{"text":"°","placement":"Suffix","space":false},"degreesMinutesSeconds":{"inherits":"symbol"}}},"slopeDegrees":{"defaultSymbol":"slopeDegree","unitSystem":"Metric","parentFactors":{"threeHundredSixty":-1},"parentUnits":{"turns":1},"symbols":{"slopeDegree":{"text":"°","placement":"Suffix","space":false}}},"stationingFeet":{"defaultSymbol":"feetAndInches","unitSystem":"Imperial","factor":12,"parentUnits":{"inches":1},"symbols":{"feetAndInches":{"inherits":"symbol"},"footSingleQuote":{"text":"\'","placement":"Suffix","space":false},"ft":{"text":"ft","placement":"Suffix","space":true},"lf":{"text":"LF","placement":"Suffix","space":true}}},"stationingMeters":{"defaultSymbol":"meter","unitSystem":"Metric","dimension":"length","symbols":{"meter":{"text":"m","placement":"Suffix","space":true},"metersAndCentimeters":{"inherits":"symbol"}}},"stationingSurveyFeet":{"unitSystem":"Imperial","factor":1200,"parentFactors":{"threeThousandNineHundredThirtySeven":-1},"parentUnits":{"meters":1},"symbols":{"usft":{"text":"USft","placement":"Suffix","space":true}}},"dateTime":{"defaultSymbol":"isoDate","symbols":{"date":{"text":"Date"},"dateAndTime":{"text":"Date, Time"},"isoDate":{"text":"ISO Date"}}}},"quantity":{"acceleration":{"units":["metersPerSecondSquared","kilometersPerSecondSquared","inchesPerSecondSquared","feetPerSecondSquared","milesPerSecondSquared","standardGravity"]},"angle":{"units":["degrees","gradians","pi","radians","turns"]},"angularLineSpringCoefficient":{"units":["kipFeetPerDegreePerFoot","kilonewtonMetersPerDegreePerMeter"]},"angularPointSpringCoefficient":{"units":["kipFeetPerDegree","kilonewtonMetersPerDegree"]},"angularSpeed":{"units":["radiansPerSecond","revolutionsPerMinute","revolutionsPerSecond"]},"area":{"units":["squareFeet","squareInches","squareMeters","squareCentimeters","squareHectometers","squareMillimeters","acres","hectares","squareYards","circularMils","squareMils"]},"areaPerLength":{"units":["squareFeetPerFoot","squareCentimetersPerMeter","squareMillimetersPerMeter","squareInchesPerFoot","squareMetersPerMeter"]},"areaPerPower":{"units":["squareFeetPerTonOfRefrigeration","squareMetersPerKilowatt","squareFeetPer1000BritishThermalUnitsPerHour"]},"areaPerTorque":{"units":["squareFeetPerKipFoot","squareMetersPerKilonewtonMeter"]},"colorTemperature":{"units":["kelvin"]},"costPerArea":{"units":["currencyPerSquareFoot","currencyPerSquareMeter"]},"costPerEnergy":{"units":["currencyPerBritishThermalUnit","currencyPerWattHour"]},"costPerPower":{"units":["currencyPerBritishThermalUnitPerHour","currencyPerWatt"]},"currency":{"units":["currency"]},"density":{"units":["kilogramsPerCubicCentimeter","kilogramsPerCubicMeter","poundsMassPerCubicInch","poundsMassPerCubicFoot","waterDensity4DegreesCelsius"]},"diffusivity":{"units":["squareFeetPerSecond","squareMetersPerSecond"]},"dynamicViscosity":{"units":["centipoises","kilogramsPerMeterHour","kilogramsPerMeterSecond","newtonSecondsPerSquareMeter","pascalSeconds","poises","poundForceSecondsPerSquareFoot","poundsMassPerFootHour","poundsMassPerFootSecond"]},"electricCapacitance":{"units":["farads"]},"electricCharge":{"units":["coulombs","ampereHours","ampereSeconds"]},"electricConductance":{"units":["mhos","siemens"]},"electricCurrent":{"units":["amperes","kiloamperes","milliamperes"]},"electricInductance":{"units":["henries"]},"electricPotential":{"units":["volts","kilovolts","millivolts"]},"electricResistance":{"units":["ohms"]},"electricResistivity":{"units":["ohmMeters"]},"energy":{"units":["britishThermalUnits","calories","ergs","gigajoules","joules","kilocalories","kilogramForceMeters","kilojoules","kilowattHours","megajoules","megawattHours","newtonMeters","poundForceFeet","therms","thousandBritishThermalUnits"]},"energyPerArea":{"units":["kilowattHoursPerSquareMeter","megajoulesPerSquareMeter","thousandBritishThermalUnitsPerSquareFoot"]},"flow":{"units":["cubicFeetPerMinute","cubicFeetPerHour","cubicMetersPerSecond","cubicMetersPerHour","litersPerHour","litersPerMinute","litersPerSecond","usGallonsPerMinute","usGallonsPerHour"]},"flowPerArea":{"units":["cubicFeetPerMinuteSquareFoot","cubicFeetPerMinuteSquareMeter","cubicMetersPerHourSquareMeter","litersPerSecondSquareMeter"]},"flowPerPower":{"units":["cubicFeetPerMinutePerBritishThermalUnitPerHour","cubicFeetPerMinuteTonOfRefrigeration","cubicMetersPerWattSecond","litersPerSecondKilowatt","squareFeetPerKip","squareMetersPerKilonewton"]},"flowPerVolume":{"units":["cubicFeetPerMinuteCubicFoot","cubicMetersPerHourCubicMeter","litersPerSecondCubicMeter"]},"force":{"units":["newtons","dekanewtons","kilonewtons","meganewtons","kips","kilogramsForce","tonnesForce","usTonnesForce","poundsForce","dynes","ouncesForce"]},"forceDensity":{"units":["kilonewtonsPerCubicMeter","poundsForcePerCubicFoot","kipsPerCubicInch","kipsPerCubicFoot"]},"forcePerLength":{"units":["newtonsPerMeter","dekanewtonsPerMeter","kilonewtonsPerMeter","meganewtonsPerMeter","kipsPerFoot","kilogramsForcePerMeter","tonnesForcePerMeter","poundsForcePerFoot","kipsPerInch"]},"frequency":{"units":["hertz","cyclesPerSecond"]},"friction":{"units":["feetOfWater39.2DegreesFahrenheitPer100Feet","inchesOfWater60DegreesFahrenheitPer100Feet","metersOfWaterColumnPerMeter","millimetersOfWaterColumnPerMeter","pascalsPerMeter"]},"heatCapacity":{"units":["britishThermalUnitsPerDegreeFahrenheit","joulesPerKelvin","kilojoulesPerKelvin"]},"heatCapacityPerArea":{"units":["britishThermalUnitsPerSquareFootDegreeFahrenheit","joulesPerSquareMeterKelvin","kilojoulesPerSquareMeterKelvin"]},"heatTransferCoefficient":{"units":["wattsPerSquareMeterKelvin","britishThermalUnitsPerHourSquareFootDegreeFahrenheit"]},"illuminance":{"units":["lux","footcandles"]},"inverseForce":{"units":["inverseKips","inverseKilonewtons"]},"length":{"units":["centimeters","decimeters","feet","hectometers","inches","kilometers","meters","microinches","microns","miles","millimeters","mils","nanometers","nauticalMiles","usSurveyFeet","yards"]},"lengthPerForce":{"units":["feetPerKip","metersPerKilonewton"]},"lengthPerTorque":{"units":["metersPerKilonewtonMeter","feetPerKipFoot"]},"lightingEfficacy":{"units":["lumensPerWatt"]},"luminance":{"units":["footlamberts","candelasPerSquareFoot","candelasPerSquareMeter"]},"luminousFlux":{"units":["lumens"]},"luminousIntensity":{"units":["candelas"]},"magneticFieldStrength":{"units":["oersteds"]},"magneticFlux":{"units":["webers","maxwells"]},"magneticFluxDensity":{"units":["teslas","gauss","gammas"]},"mass":{"units":["kilograms","tonnes","poundsMass","grams","milligrams","nanograms","grains","usTonnesMass","slugs","ouncesMass","micrograms"]},"massByTemperatureInterval":{"units":["kilogramKelvins","poundMassDegreesFahrenheit"]},"massPerArea":{"units":["kilogramsPerSquareMeter","poundsMassPerSquareFoot"]},"massPerLength":{"units":["kilogramsPerMeter","poundsMassPerFoot"]},"massPerTime":{"units":["poundsMassPerHour","poundsMassPerMinute","poundsMassPerSecond","kilogramsPerHour","kilogramsPerMinute","kilogramsPerSecond"]},"number":{"units":["general","fixed","percentage"]},"permeability":{"units":["nanogramsPerPascalSecondSquareMeter","grainsPerHourSquareFootInchMercury"]},"power":{"units":["britishThermalUnitsPerHour","britishThermalUnitsPerSecond","caloriesPerSecond","horsepower","kilocaloriesPerSecond","kilovoltAmperes","kilowatts","megawatts","thousandBritishThermalUnitsPerHour","tonsOfRefrigeration","voltAmperes","watts"]},"powerDensity":{"units":["wattsPerCubicFoot","wattsPerCubicMeter","britishThermalUnitsPerHourCubicFoot"]},"powerPerArea":{"units":["britishThermalUnitsPerHourSquareFoot","voltAmperesPerSquareFoot","voltAmperesPerSquareMeter","wattsPerSquareFoot","wattsPerSquareMeter"]},"powerPerFlow":{"units":["wattsPerCubicFootPerMinute","wattsPerCubicMeterPerSecond"]},"powerPerLength":{"units":["wattsPerFoot","wattsPerMeter"]},"pressure":{"units":["atmospheres","bars","feetOfWater39.2DegreesFahrenheit","inchesOfMercury32DegreesFahrenheit","inchesOfWater60DegreesFahrenheit","kilopascals","megapascals","metersOfWaterColumn","millimetersOfMercury","millimetersOfWaterColumn","pascals","poundsForcePerSquareInch"]},"ratio":{"units":["fixed","percentage","perMille","ratioTo1","ratioTo10","ratioTo12","1ToRatio"]},"secondMomentOfArea":{"units":["feetToTheFourthPower","inchesToTheFourthPower","millimetersToTheFourthPower","centimetersToTheFourthPower","metersToTheFourthPower"]},"slope":{"units":["percentage","ratioTo1","ratioTo10","ratioTo12","riseDividedBy12Inches","riseDividedBy1Foot","riseDividedBy1000Millimeters","riseDividedBy120Inches","1ToRatio","riseDividedBy10Feet","perMille"]},"solidAngle":{"units":["steradians"]},"specificEnergy":{"units":["joulesPerGram","joulesPerKilogram","britishThermalUnitsPerPound"]},"specificHeatCapacity":{"units":["joulesPerGramDegreeCelsius","britishThermalUnitsPerPoundDegreeFahrenheit","joulesPerKilogramDegreeCelsius"]},"stress":{"units":["pascals","kilopascals","megapascals","poundsForcePerSquareInch","bars","newtonsPerSquareMeter","dekanewtonsPerSquareMeter","kilonewtonsPerSquareMeter","meganewtonsPerSquareMeter","kipsPerSquareFoot","kilogramsForcePerSquareMeter","tonnesForcePerSquareMeter","poundsForcePerSquareFoot","kipsPerSquareInch","kilonewtonsPerSquareCentimeter","newtonsPerSquareMillimeter","kilonewtonsPerSquareMillimeter"]},"temperature":{"units":["fahrenheit","celsius","kelvin","rankine"]},"temperatureInterval":{"units":["fahrenheitInterval","celsiusInterval","kelvinInterval","rankineInterval"]},"thermalConductivity":{"units":["wattsPerMeterKelvin","britishThermalUnitsPerHourFootDegreeFahrenheit"]},"thermalExpansionCoefficient":{"units":["inverseDegreesFahrenheit","inverseDegreesCelsius","micrometersPerMeterDegreeCelsius","microinchesPerInchDegreeFahrenheit"]},"thermalGradientCoefficientForMoistureCapacity":{"units":["kilogramsPerKilogramKelvin","poundsMassPerPoundDegreeFahrenheit"]},"thermalInsulance":{"units":["hourSquareFootDegreesFahrenheitPerBritishThermalUnit","squareMeterKelvinsPerWatt"]},"time":{"units":["milliseconds","seconds","minutes","hours"]},"torque":{"units":["newtonMeters","dekanewtonMeters","kilonewtonMeters","meganewtonMeters","kipFeet","kilogramForceMeters","tonneForceMeters","poundForceFeet"]},"torquePerLength":{"units":["newtonMetersPerMeter","dekanewtonMetersPerMeter","kilonewtonMetersPerMeter","meganewtonMetersPerMeter","kipFeetPerFoot","kilogramForceMetersPerMeter","tonneForceMetersPerMeter","poundForceFeetPerFoot"]},"velocity":{"units":["feetPerMinute","centimetersPerMinute","inchesPerSecond","metersPerSecond","feetPerSecond","kilometersPerSecond","milesPerSecond","kilometersPerHour","milesPerHour"]},"volume":{"units":["cubicYards","cubicFeet","cubicInches","cubicMeters","cubicCentimeters","cubicMillimeters","liters","usGallons"]},"volumePerForce":{"units":["cubicFeetPerKip","cubicMetersPerKilonewton"]},"volumePerMass":{"units":["cubicFeetPerPoundMass","cubicMetersPerKilogram"]},"warpingCoefficient":{"units":["feetToTheSixthPower","inchesToTheSixthPower","millimetersToTheSixthPower","centimetersToTheSixthPower","metersToTheSixthPower"]}}}');

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
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = (typeof document !== 'undefined' && document.baseURI) || self.location.href;
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"Measure": 0
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
  !*** ./extensions/Measure/Measure.js ***!
  \***************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MeasureExtension: () => (/* binding */ MeasureExtension)
/* harmony export */ });
/* harmony import */ var _MeasureTool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./MeasureTool.js */ "./extensions/Measure/MeasureTool.js");
/* harmony import */ var _CalibrationTool_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./CalibrationTool.js */ "./extensions/Measure/CalibrationTool.js");
/* harmony import */ var _MagnifyingGlass_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./MagnifyingGlass.js */ "./extensions/Measure/MagnifyingGlass.js");
/* harmony import */ var _CalibrationPanels_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./CalibrationPanels.js */ "./extensions/Measure/CalibrationPanels.js");
/* harmony import */ var _MeasureToolbar_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./MeasureToolbar.js */ "./extensions/Measure/MeasureToolbar.js");
/* harmony import */ var _CustomTools_LaserToolRegistration_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./CustomTools/LaserToolRegistration.js */ "./extensions/Measure/CustomTools/LaserToolRegistration.js");
/* harmony import */ var _CustomTools_SurfaceToolRegistration_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./CustomTools/SurfaceToolRegistration.js */ "./extensions/Measure/CustomTools/SurfaceToolRegistration.js");
/* harmony import */ var _CustomTools_ShortestDistanceMeasureTool_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./CustomTools/ShortestDistanceMeasureTool.js */ "./extensions/Measure/CustomTools/ShortestDistanceMeasureTool.js");
/* harmony import */ var _CustomTools_SlopeMeasurement_SlopeMeasureTool_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./CustomTools/SlopeMeasurement/SlopeMeasureTool.js */ "./extensions/Measure/CustomTools/SlopeMeasurement/SlopeMeasureTool.js");
/* harmony import */ var _Measure_css__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./Measure.css */ "./extensions/Measure/Measure.css");
/* harmony import */ var _Calibration_css__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./Calibration.css */ "./extensions/Measure/Calibration.css");










 // IMPORTANT!!
 // IMPORTANT!!

'use strict';

var avem = AutodeskNamespace('Autodesk.Viewing.Extensions.Measure'),
  av = Autodesk.Viewing,
  avp = Autodesk.Viewing.Private,
  avu = av.UI;
var MeasureCommon = Autodesk.Viewing.MeasureCommon; // Comes form main viewer bundle.

var NONE = 0;
var MEASURE_TOOL = 1;
var CALIBRATION_TOOL = 2;

var DEFAULT_MEASUREMENT_TYPE = MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE;

const primaryUnitsArrImperialPrimary = ['ft', 'sft', 'decimal-ft', 'in', 'decimal-in', 'ft-and-fractional-in', 'ft-and-decimal-in', 'fractional-in'];
const primaryUnitsArrMetricPrimary = ['m', 'cm', 'mm', 'm-and-cm'];
/**
 * Provides UI controls to perform distance and angle measurements for 2D and 3D models.
 *
 * The extension id is: `Autodesk.Measure`
 *
 * @param {Viewer3D} viewer - Viewer instance
 * @param {object} options - Configurations for the extension
 * @example
 * viewer.loadExtension('Autodesk.Measure')
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.MeasureExtension
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 * @hideConstructor
 * @public
 */
var MeasureExtension = function (viewer, options) {
  Autodesk.Viewing.Extension.call(this, viewer, options);
  this.modes = ['distance', 'angle', 'area', 'arc', 'calibrate', 'spot'];
  this.name = 'measure';
  this._onModelLoaded = this._onModelLoaded.bind(this);
  this._onDisplayUnitsPrefChanged = this._onDisplayUnitsPrefChanged.bind(this);
  this._onPrecisionPrefChanged = this._onPrecisionPrefChanged.bind(this);
  this.autosave = true;
  this.customToolButtons = [];
};

MeasureExtension.prototype = Object.create(Autodesk.Viewing.Extension.prototype);
MeasureExtension.prototype.constructor = MeasureExtension;


/**
 * Load the measure extension.
 *
 * @returns {boolean} True if measure extension is loaded successfully.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#load
 * @public
 */
MeasureExtension.prototype.load = async function () {

  await this.viewer.loadExtension('Autodesk.Snapping');

  var self = this;
  var viewer = this.viewer;
  this.hasUI = Autodesk.Viewing.GuiViewer3D && viewer instanceof Autodesk.Viewing.GuiViewer3D;

  this.escapeHotkeyId = 'Autodesk.Measure.Hotkeys.Escape';

  // Register the Measure tool
  if (!viewer.toolController) {
    return false;
  }
  const av = Autodesk.Viewing;
  this.options = this.options || {};
  var measureToolOptions = {};

  measureToolOptions.onCloseCallback = function () {
    self.enableMeasureTool(false);
  };

  // Shared State with measureTool & calibrationTool.
  // Gets populated when a model is received.
  // This is wrapped into a proxy to allow change event handling in a central place
  this.sharedMeasureConfig = new Proxy({
    units: null,
    secondaryUnits: null,
    precision: null,
    calibrationFactor: null,
    useViewportInfo: false,
    enableSecondaryUnits: true
  }, {
    set(target, prop, value, receiver) {
      target[prop] = value;
      switch (prop) {
        case 'units':
          viewer.dispatchEvent({ type: MeasureCommon.Events.DISPLAY_UNITS_CHANGED, units: value });
          break;
        case 'secondaryUnits':
          viewer.dispatchEvent({ type: MeasureCommon.Events.SECONDARY_DISPLAY_UNITS_CHANGED, units: value });
          break;
        case 'precision':
          viewer.dispatchEvent({ type: MeasureCommon.Events.PRECISION_CHANGED, precision: value });
          break;
        case 'calibrationFactor':
        case 'useViewportInfo':
          break;
        default:
          console.log('Unknown property', prop, ' added to sharedMeasureConfig');
      }
      return true;
    }
  });

  measureToolOptions.snapperOptions = this.options.snapperOptions;
  measureToolOptions.calibrateWithPage = this.options.calibrateWithPage; // True if calibration is done on page and not on viewports (i.e. viewport 0)
  this.forceCalibrate = this.options.forceCalibrate;

  this.snapper = new Autodesk.Viewing.Extensions.Snapping.Snapper(viewer, {
    renderSnappedTopology: true
  });
  viewer.toolController.registerTool(this.snapper);

  const onToolChangedCb = (enable) => {
    this.setActive(enable);
    if (!enable) {
      this.deactivate();
    }
  };

  this.measureTool = new _MeasureTool_js__WEBPACK_IMPORTED_MODULE_0__.MeasureTool(viewer, measureToolOptions, this.sharedMeasureConfig, this.snapper);
  viewer.toolController.registerTool(this.measureTool, onToolChangedCb);

  // Register laser tool as custom measurement tool - delay to ensure MeasureTool is fully constructed
  (0,_CustomTools_LaserToolRegistration_js__WEBPACK_IMPORTED_MODULE_5__.registerLaserTool)(this.measureTool);

  this.shortestDistanceMeasureTool = new _CustomTools_ShortestDistanceMeasureTool_js__WEBPACK_IMPORTED_MODULE_7__.ShortestDistanceMeasureTool(viewer, this.measureTool, this.snapper);
  this.measureTool.registerCustomTool(MeasureCommon.MeasurementTypes.MEASUREMENT_SHORTEST_DISTANCE, this.shortestDistanceMeasureTool);

  if (av.FeatureFlags.isEnabled(avp.InternalFeatureFlags.EnableSlopeMeasurement)) {
    this.slopeMeasureTool = new _CustomTools_SlopeMeasurement_SlopeMeasureTool_js__WEBPACK_IMPORTED_MODULE_8__.SlopeMeasureTool(viewer, this.snapper, this.sharedMeasureConfig);
    this.measureTool.registerCustomTool(MeasureCommon.MeasurementTypes.MEASUREMENT_SLOPE, this.slopeMeasureTool);
  }

  // Register surface tool as custom measurement tool
  (0,_CustomTools_SurfaceToolRegistration_js__WEBPACK_IMPORTED_MODULE_6__.registerSurfaceTool)(this.measureTool);

  this.calibrationTool = new _CalibrationTool_js__WEBPACK_IMPORTED_MODULE_1__.CalibrationTool(viewer, this.options, this.sharedMeasureConfig, this.snapper);
  viewer.toolController.registerTool(this.calibrationTool, onToolChangedCb);

  this.magnifyingGlass = new _MagnifyingGlass_js__WEBPACK_IMPORTED_MODULE_2__.MagnifyingGlass(viewer);
  viewer.toolController.registerTool(this.magnifyingGlass);

  this.calibration = {};
  this.onFinishedCalibration = function (event) {
    if (self.measureToolbar) {
      self.measureToolbar.updateSettingsPanel();
    }

    self.activateInitiator && self.activateInitiator();

    // Set the calibration values
    self.calibration.units = event.units;
    self.calibration.scaleFactor = event.scaleFactor;
    self.calibration.size = event.size;
    self.calibration.precision = self.sharedMeasureConfig.precision;
  };

  viewer.addEventListener('finished-calibration', this.onFinishedCalibration);

  this.onMeasurementChanged = function (event) {
    var type = event.data.type;
    self.changeMeasurementType(type);
  };

  viewer.addEventListener(MeasureCommon.Events.MEASUREMENT_CHANGED_EVENT, this.onMeasurementChanged);

  if (viewer.model) {
    this._onModelLoaded({ model: viewer.model });
  } else {
    viewer.addEventListener(av.MODEL_ROOT_LOADED_EVENT, this._onModelLoaded, { once: true });
  }

  // If there is no model anymore, interrupt any ongoing interaction.
  // We need at least one model to derive things like is2d() and model units.
  this.onModelRemoved = function () {
    // If UI was not created yet or destroyed, we don't have to disable anything
    if (!self.measurementToolbarButton) {
      return;
    }

    if (!self.viewer.model) {
      self.measurementToolbarButton.setState(Autodesk.Viewing.UI.Button.State.DISABLED);
      self.exitMeasurementMode();
    }
  };
  this.onModelAdded = function () {

    // If UI was not created yet or destroyed, the button will be enabled in next createUI() call
    if (!self.measurementToolbarButton) {
      return;
    }

    // On first model-add, re-enable measure toolbar again
    var modelCount = self.viewer.getVisibleModels().length;
    if (modelCount === 1 && self.measurementToolbarButton) {
      self.measurementToolbarButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
    }
  };
  viewer.addEventListener(av.MODEL_ADDED_EVENT, this.onModelAdded);
  viewer.addEventListener(av.MODEL_REMOVED_EVENT, this.onModelRemoved);

  this.viewer.prefs.addListeners(avp.Prefs.DISPLAY_UNITS, this._onDisplayUnitsPrefChanged, this._onDisplayUnitsPrefChanged);
  this.viewer.prefs.addListeners(avp.Prefs.DISPLAY_UNITS_PRECISION, this._onPrecisionPrefChanged, this._onPrecisionPrefChanged);

  this.hasNotEntered = true;

  return true;
};

/**
 * @param {string} value - unit
 * @private
 */
MeasureExtension.prototype._onDisplayUnitsPrefChanged = function (value) {
  if (value !== '') {
    this.setUnits(value);
    this.measureToolbar?.updateSettingsPanel();
    // Also update the units in calibration panel
    this.calibrationTool.updateCalibrationPanel();
  }
};

/**
 * @param {string} value precision
 * @private
 */
MeasureExtension.prototype._onPrecisionPrefChanged = function (value) {
  if (typeof value === 'number') {
    this.setPrecision(value);
    this.measureToolbar?.updateSettingsPanel();
  }
};

/**
 * Initialize secondary units based on primary units.
 * Secondary units default to blank - users must explicitly select them from the dropdown.
 * Only initializes if secondary units feature is enabled and no secondary units are already set.
 *
 * @private
 */
MeasureExtension.prototype.initializeSecondaryUnits = function () {
  // Early exit: feature disabled or secondary units already set
  if (!this.sharedMeasureConfig.enableSecondaryUnits || this.sharedMeasureConfig.secondaryUnits) {
    return;
  }

  // Set secondary units to "please-select" which is blank by default
  // User must explicitly select a real unit from the dropdown in the settings panel
  this.sharedMeasureConfig.secondaryUnits = 'please-select';
};

MeasureExtension.prototype._onModelLoaded = function (event) {
  var model = event.model;

  const setPdfUnits = !!model.isPdf(true) && !this.viewer.prefs.get(avp.Prefs2D.FORCE_PDF_CALIBRATION);
  const setLeafletUnits = !!model.isLeaflet() && !this.viewer.prefs.get(avp.Prefs2D.FORCE_LEAFLET_CALIBRATION);

  // In case of a PDF, look for units and display precision in viewports. PDFs can have multiple viewports, each with a different
  // unit and precision.
  // We skip the first one, as it is not defined in the PDF, but added by LmvCanvasContext
  let viewportUnits;
  let viewportPrecision = 3; // default precision
  if ((model.isSmartPdf() || this.viewer.prefs.get(avp.Prefs2D.USE_PDF_VIEWPORT_INFO)) && model.getData().viewports && model.getData().viewports.length > 1) {
    // skip the first auto-generated viewport (see PDFLoader)
    const viewport = model.getData().viewports[1];

    // Use the unit of the first viewport as the initial measurement unit.
    viewportUnits = avp.fixUnitString(viewport.units);

    if (Number.isInteger(viewport.precision) && viewport.precision >= 0)
    viewportPrecision = viewport.precision;

    this.sharedMeasureConfig.useViewportInfo = true;
  }

  this.sharedMeasureConfig.units = this.options.calibrationUnits || this.viewer.prefs.get(avp.Prefs.DISPLAY_UNITS) || viewportUnits || model.getDisplayUnit();

  // Initialize secondary units based on primary units
  this.initializeSecondaryUnits();

  // BLMV-6350 - sometimes, due to race condition, we disable Units Drop down before Measure units has been defined.
  if (!this.sharedMeasureConfig.units) {
    this.measureToolbar?.disableUnitOption();
  }
  if (!this.sharedMeasureConfig.units && this.sharedMeasureConfig.enableSecondaryUnits) {
    this.measureToolbar?.disableSecondaryUnitOption();
  }

  // Set the units to points only for pdf and leaflet models that do not contain model units in the metadata.
  if ((setPdfUnits || setLeafletUnits) && !model.getMetadata('page_dimensions', 'model_units', null) && !viewportUnits) {
    this.sharedMeasureConfig.units = 'pt';
  }

  const precisionPreference = this.viewer.prefs.get(avp.Prefs.DISPLAY_UNITS_PRECISION);
  if (typeof precisionPreference === 'number') {
    this.sharedMeasureConfig.precision = precisionPreference;
  } else {
    this.sharedMeasureConfig.precision = model.is2d() ? viewportPrecision : 1;
  }
  if (this.options.calibrationUnits && !isNaN(this.options.calibrationFactor)) {
    this.calibrationTool.calibrateByScale(this.options.calibrationUnits, this.options.calibrationFactor);
  }
};

/**
 * Unload the measure extension.
 *
 * @returns {boolean} True if measure extension is unloaded successfully.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#unload
 * @public
 */
MeasureExtension.prototype.unload = function () {
  var viewer = this.viewer;

  // Remove the ui from the viewer.
  this.destroyUI();
  viewer.removeEventListener(_MeasureTool_js__WEBPACK_IMPORTED_MODULE_0__.MeasureTool.EXPLODE_CHANGE_EVENT, _MeasureTool_js__WEBPACK_IMPORTED_MODULE_0__.MeasureTool.onExplodedChange);
  viewer.removeEventListener('finished-calibration', this.onFinishedCalibration);
  viewer.removeEventListener(MeasureCommon.Events.MEASUREMENT_CHANGED_EVENT, this.onMeasurementChanged);
  viewer.removeEventListener(av.MODEL_ADDED_EVENT, this.onModelAdded);
  viewer.removeEventListener(av.MODEL_REMOVED_EVENT, this.onModelRemoved);
  viewer.removeEventListener(av.MODEL_ROOT_LOADED_EVENT, this._onModelLoaded);

  viewer.toolController.deregisterTool(this.snapper);
  this.snapper = null;

  // Deregister laser and surface tools
  if (this.measureTool) {
    (0,_CustomTools_LaserToolRegistration_js__WEBPACK_IMPORTED_MODULE_5__.deregisterLaserTool)(this.measureTool);
    (0,_CustomTools_SurfaceToolRegistration_js__WEBPACK_IMPORTED_MODULE_6__.deregisterSurfaceTool)(this.measureTool);
  }

  this.measureTool.deregisterCustomTool(MeasureCommon.MeasurementTypes.MEASUREMENT_SLOPE);
  this.slopeMeasureTool = null;

  viewer.toolController.deregisterTool(this.measureTool);
  this.measureTool = null;

  viewer.toolController.deregisterTool(this.calibrationTool);
  this.calibrationTool = null;

  viewer.toolController.deregisterTool(this.magnifyingGlass);
  this.magnifyingGlass = null;

  this.unloaded = true;

  viewer.prefs.removeListeners(avp.Prefs.DISPLAY_UNITS, this._onDisplayUnitsPrefChanged, this._onDisplayUnitsPrefChanged);
  viewer.prefs.removeListeners(avp.Prefs.DISPLAY_UNITS_PRECISION, this._onPrecisionPrefChanged, this._onPrecisionPrefChanged);

  return true;
};

/**
 * Enable/disable the measure tool.
 * It does not update the toolbar UI.
 *
 * @param {boolean} active - True to activate, false to deactivate.
 * @returns {boolean} True if a change in activeness occurred.
 */
MeasureExtension.prototype.setActive = function (active) {
  return this.enableMeasureTool(active);
};

/**
 * Toggles activeness of the measure tool.
 * It does not update the toolbar UI.
 *
 * @returns {boolean} Whether the tool is active.
 */
MeasureExtension.prototype.toggle = function () {
  if (this.isActive()) {
    this.enableMeasureTool(false);
  } else {
    this.enableMeasureTool(true);
  }
  return this.isActive();
};

/**
 * Get the current measurement in the measure tool.
 *
 * @param {string} [unitType] - Either: "decimal-ft", "ft", "sft", "ft-and-decimal-in", "decimal-in", "fractional-in", "m", "cm", "mm" or "m-and-cm".
 * @param {number} [precision] - precision index (0: 0, 1: 0.1, 2: 0.01, 3: 0.001, 4: 0.0001, 5: 0.00001).
 * When units type is "ft", "in" or "fractional-in", then the precisions are 0: 1, 1: 1/2, 2: 1/4, 3: 1/8, 4: 1/16, 5: 1/32, 6: 1/64.
 * @returns {object|null} Object with properties of the current measurement, or null.
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#getMeasurement
 * @public
 */
MeasureExtension.prototype.getMeasurement = function (unitType, precision) {
  var measurement = null;
  if (this.measureTool.isActive()) {
    measurement = this.measureTool.getMeasurement(unitType, precision);
  }
  return measurement;
};

/**
 * Get a list of all the measurements that are currently on the screen.
 *
 * @param {string} [unitType] - Either: "decimal-ft", "ft", "sft", "ft-and-decimal-in", "decimal-in", "fractional-in", "m", "cm", "mm" or "m-and-cm".
 * @param {number} [precision] - precision index (0: 0, 1: 0.1, 2: 0.01, 3: 0.001, 4: 0.0001, 5: 0.00001).
 * When units type is "ft", "in" or "fractional-in", then the precisions are 0: 1, 1: 1/2, 2: 1/4, 3: 1/8, 4: 1/16, 5: 1/32, 6: 1/64.
 * @returns {Array.<object>} An array of measurement objects with properties of the measurement.
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#getMeasurementList
 * @public
 */

MeasureExtension.prototype.getMeasurementList = function (unitType, precision) {
  var measurementList = [];
  if (this.measureTool.isActive()) {
    measurementList = this.measureTool.getMeasurementList(unitType, precision);
  }
  return measurementList;
};

/**
 * Restores existing measurements. The `measurements` object should be generated by either the {@link Autodesk.Viewing.Extensions.MeasureExtension#getMeasurementList|getMeasurementList} or the {@link Autodesk.Viewing.Extensions.MeasureExtension#getMeasurement|getMeasurement} methods.
 *
 * @param {object[] | object} measurements - An array of measurement objects
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#setMeasurements
 * @public
 */
MeasureExtension.prototype.setMeasurements = function (measurements) {
  if (this.measureTool.isActive()) {
    this.measureTool.setMeasurements(measurements);
  }
};


/**
 * Get all available units in measure tool.
 *
 * @returns {object[]} Array of all available units.
 */
MeasureExtension.prototype.getUnitOptions = function () {
  var units = [
  { name: 'Unknown', type: '' },
  { name: '', type: 'please-select' },
  { name: 'Decimal feet', type: 'decimal-ft' },
  { name: 'Feet and fractional inches', type: 'ft' },
  { name: 'Feet and decimal inches', type: 'ft-and-decimal-in' },
  { name: 'US Survey Feet', type: 'sft' },
  { name: 'Decimal inches', type: 'decimal-in' },
  { name: 'Fractional inches', type: 'fractional-in' },
  { name: 'Meters', type: 'm' },
  { name: 'Centimeters', type: 'cm' },
  { name: 'Millimeters', type: 'mm' },
  { name: 'Meters and centimeters', type: 'm-and-cm' },
  { name: 'Points', type: 'pt' }];


  return units;
};

/**
 * Get all available precisions in measure tool.
 *
 * @param {boolean} isFractional - Set true to get fractional precisions.
 * @returns {string[]} List of all available precisions.
 */
MeasureExtension.prototype.getPrecisionOptions = function (isFractional) {

  var precisions;

  if (isFractional)
  precisions = ['1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'];else

  precisions = ['0', '0.1', '0.01', '0.001', '0.0001', '0.00001'];

  return precisions;
};

/**
 * Get the default measure unit in measure tool.
 *
 * @returns {string} The default measure unit.
 */
MeasureExtension.prototype.getDefaultUnit = function () {
  var unit = this.viewer.model.getDisplayUnit();

  return unit;
};

MeasureExtension.prototype.openCalibrationRequiredDialog = function (initiator) {
  if (this.hasUI) {
    if (!this.CalibrationRequiredDialog) {
      this.CalibrationRequiredDialog = new _CalibrationPanels_js__WEBPACK_IMPORTED_MODULE_3__.CalibrationRequiredDialog(this, this.viewer, "calibration-required", "Calibration Required", this.options);
    }

    this.CalibrationRequiredDialog.setVisible(true);
  } else
  {
    this.viewer.dispatchEvent({ type: MeasureCommon.Events.CALIBRATION_REQUIRED_EVENT });
  }

  if (initiator === 'measure') {
    this.activateInitiator = function () {
      this.enableMeasureTool(true, DEFAULT_MEASUREMENT_TYPE);
      this.activateInitiator = null;
    };
  } else if (initiator === 'dimension') {
    this.activateInitiator = function () {
      this.viewer.dispatchEvent({ type: MeasureCommon.Events.FINISHED_CALIBRATION_FOR_DIMENSION_EVENT });
      this.activateInitiator = null;
    };
  }
};

/**
 * Get the calibration size, unit type and the calibration Factor of the model
 *
 * @returns {object}
 */
MeasureExtension.prototype.getCalibration = function () {
  return this.calibration;
};


/**
 * @param mode Measurement Mode
 * @returns {boolean}
 */

/**
 * Activates the tool and UI to start measuring.
 *
 * @param {string} [mode] - Either 'distance', 'angle', 'area' (2D only), 'arc' (2D only), 'calibrate' or 'custom'. Default is 'distance'.
 * @param {string} [type] - Custom measurement type. Required when mode is 'custom'.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#activate
 * @public
 */
MeasureExtension.prototype.activate = function (mode, type = null) {
  if (this.activeStatus && this.mode === mode) {
    return true;
  }

  this.enterMeasurementMode();

  var success;

  switch (mode) {
    default:
      mode = 'distance';
    // falls through
    case 'distance':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE);
      break;
    case 'angle':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE);
      break;
    case 'area':
      if (!this.viewer.model.is2d()) {
        console.warn('Area mode is applicable on 2D models only');
      } else {
        success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_AREA);
      }
      break;
    case 'arc':
      if (!this.viewer.model.is2d() || this.viewer.model.isPdf()) {
        console.warn('Arc mode is applicable on 2D models only');
      } else {
        success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_ARC);
      }
      break;
    case 'calibrate':
      success = this.enableCalibrationTool(true);
      break;
    case 'custom':
      success = this.enableMeasureTool(true, type);
      break;
    case 'spot':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT);
      break;
    case 'laser':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_LASER);
      break;
    case 'shortest-distance':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_SHORTEST_DISTANCE);
      break;
    case 'surface':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_SURFACE);
      break;
    case 'slope':
      success = this.enableMeasureTool(true, MeasureCommon.MeasurementTypes.MEASUREMENT_SLOPE);
      break;
  }

  this.mode = success ? mode : '';
  this.activeStatus = true;
  return true;
};

/**
 * Deactivates measuring tool and UI.
 *
 * @returns {boolean}
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#deactivate
 * @public
 */
MeasureExtension.prototype.deactivate = function () {
  if (this.activeStatus) {
    this.exitMeasurementMode();
    this.enableMeasureTool(false);
    this.activeStatus = false;
  }
  return true;
};

/**
 * Force the calibration panel for pdf models
 *
 * @param {boolean} enable - true to force the calibration panel
 */
MeasureExtension.prototype.setForcePDFCalibrate = function (enable) {
  this.viewer.prefs.set(avp.Prefs2D.FORCE_PDF_CALIBRATION, enable);
};

/**
 * Force the calibration panel for leaflet models
 *
 * @param {boolean} enable - true to force the calibration panel
 */
MeasureExtension.prototype.setForceLeafletCalibrate = function (enable) {
  this.viewer.prefs.set(avp.Prefs2D.FORCE_LEAFLET_CALIBRATION, enable);
};

/**
 * Restore session measurements when enabling the measure tool.
 *
 * @param {boolean} enable - true to restore session measurements.
 */
MeasureExtension.prototype.setRestoreSessionMeasurements = function (enable) {
  this.viewer.prefs.set(avp.Prefs.RESTORE_SESSION_MEASUREMENTS, enable);
};

/**
 * Enable/disable the measure tool.
 *
 * @param {boolean} enable - True to enable, false to disable.
 * @param measurementType
 * @returns {boolean} True if the tool state was changed.
 * @private
 */
MeasureExtension.prototype.enableMeasureTool = function (enable, measurementType) {
  if (measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_AREA && this.viewer.model && !this.viewer.model.is2d()) {
    return false;
  }

  // arc measurement is not supported for 3D models
  if (measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_ARC && this.viewer.model && !this.viewer.model.is2d()) {
    return false;
  }

  const snapToArc = measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_ARC && this.viewer.model?.is2d();
  this.snapper.setSnapToArc(snapToArc);

  var toolController = this.viewer.toolController,
    isActive = this.selectedTool === MEASURE_TOOL;

  if (!this.viewer.model || !enable && isActive) {
    if (this.measureTool.isActive()) {
      toolController.deactivateTool("measure");

      if (this.measureToolbar) {
        this.measureToolbar.deactivateAllButtons();
      }

      // No tool is active anymore. Only do this if measureTool was really the active one before.
      // If not, changing selectedTool would produce an inconsistent state, e.g., CalibrationTool
      // may still be active, but enableCalibrationTool(false) would not properly close it.
      this.selectedTool = NONE;
    }

    return true;
  }

  const is2d = this.viewer.impl.is2d;
  const forcePDFCalibration = is2d && this.viewer.model.isPdf(true) && this.viewer.prefs.get(avp.Prefs2D.FORCE_PDF_CALIBRATION);
  const forceLeafletCalibration = is2d && this.viewer.model.isLeaflet() && this.viewer.prefs.get(avp.Prefs2D.FORCE_LEAFLET_CALIBRATION);

  this.forceCalibrate |= forceLeafletCalibration || forcePDFCalibration;

  if (!measurementType) {
    measurementType = this.measureTool.getCurrentMeasureType();
  }

  if (enable && !isActive) {
    // Fetch topology when opening Measure tool for the first time.
    this.checkAndFetchTopology(toolController.getTool('measure'));

    if (!this.forceCalibrate || this.forceCalibrate && this.calibrationTool.isCalibrated() || measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE) {
      if (this.calibrationTool.isActive()) {
        toolController.deactivateTool("calibration");
      }

      if (this.measureToolbar) {
        this.measureToolbar.updateSettingsPanel();
      }

      toolController.activateTool("measure");

      this.selectedTool = MEASURE_TOOL;

      this.changeMeasurementType(measurementType);
      return true;
    } else
    {
      this.viewer.addEventListener(avem.OPEN_TOOL_AFTER_CALIBRAION, function () {
        this.enableMeasureTool(true);
      }.bind(this), { once: true });

      this.openCalibrationRequiredDialog('measure');
      return false;
    }

  } else if (enable && isActive) {
    // if a measurement of a different type was started beforehand, we need to clear it first
    if (this.mode !== measurementType && this.measureTool.isActive() && !this.measureTool.isNoPicksSet()) {
      // for measurements that are being edited instead of created the behavior depends on where the mouse pointer is
      // if the mouse pointer is over a valid new pick for the measurement this new spot will be picked
      // if the mouse pointer is not over a valid new pick for the measurement the measurement will be reset to its previous state
      this.measureTool.clearIncompleteMeasurement();
    }
    if (!this.forceCalibrate || this.forceCalibrate && this.calibrationTool.isCalibrated() || measurementType === MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE) {
      this.changeMeasurementType(measurementType);
      return true;
    } else
    {
      this.openCalibrationRequiredDialog('measure');
      return false;
    }
  }

  return false;
};

MeasureExtension.prototype.changeMeasurementType = function (measurementType) {
  this.measureTool.changeMeasurementType(measurementType);
  if (this.measureToolbar) {
    this.measureToolbar.deactivateAllButtons();
    this.measureToolbar.activateButtonByType(measurementType);
  }

  switch (measurementType) {
    case MeasureCommon.MeasurementTypes.MEASUREMENT_DISTANCE:
      this.mode = 'distance';
      break;
    case MeasureCommon.MeasurementTypes.MEASUREMENT_ANGLE:
      this.mode = 'angle';
      break;
    case MeasureCommon.MeasurementTypes.MEASUREMENT_AREA:
      this.mode = 'area';
      break;
    case MeasureCommon.MeasurementTypes.MEASUREMENT_ARC:
      this.mode = 'arc';
      break;
    case MeasureCommon.MeasurementTypes.MEASUREMENT_SPOT:
      this.mode = 'spot';
      break;
    case MeasureCommon.MeasurementTypes.MEASUREMENT_LASER:
      this.mode = 'laser';
      break;
    case MeasureCommon.MeasurementTypes.MEASUREMENT_SHORTEST_DISTANCE:
      this.mode = 'shortest-distance';
      break;
    default:
      this.mode = '';
  }
};

/**
 * When enabled, the Viewer will only render model parts that are included in
 * measurements.
 *
 * @param {boolean} enable - true to render only nodes being measured.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#setIsolateMeasure
 * @public
 */
MeasureExtension.prototype.setIsolateMeasure = function (enable) {
  this.measureTool.setIsolateMeasure(enable);
  if (enable) {
    this.measureTool.isolateMeasurement();
  } else {
    this.measureTool.clearIsolate();
  }
};

/**
 * Enable/disable the measure tool.
 *
 * @param {boolean} enable - True to enable, false to disable.
 * @returns {boolean} True if the tool state was changed.
 * @private
 */
MeasureExtension.prototype.enableCalibrationTool = function (enable) {
  var toolController = this.viewer.toolController,
    isActive = this.selectedTool == CALIBRATION_TOOL;

  if (enable && !isActive) {
    if (this.measureTool.isActive()) {
      toolController.deactivateTool("measure");
    }

    toolController.activateTool("calibration");
    this.viewer.dispatchEvent({ type: MeasureCommon.Events.UNITS_CALIBRATION_STARTS_EVENT });

    if (this.measureToolbar) {
      this.measureToolbar.deactivateAllButtons();
      this.measureToolbar.activateButtonByType(MeasureCommon.MeasurementTypes.CALIBRATION);
    }

    this.selectedTool = CALIBRATION_TOOL;
    return true;

  } else if (!enable && isActive) {
    if (this.calibrationTool.isActive()) {
      this.mode = '';
      toolController.deactivateTool("calibration");
      if (this.measureToolbar) {
        this.measureToolbar.deactivateAllButtons();
      }
    }

    this.selectedTool = NONE;
    return true;
  }
  return false;
};

/**
 * @private
 */
MeasureExtension.prototype.enterMeasurementMode = function () {

  if (this._measurementMode) return;
  this._measurementMode = true;

  this.viewer.dispatchEvent({ type: MeasureCommon.Events.MEASUREMENT_MODE_ENTER });

  if (!this.viewer.getToolbar) {
    return; // Adds support for Viewer3D instance
  }

  var toolbar = this.viewer.getToolbar();
  var viewerToolbarContainer = toolbar.container;
  var viewerContainerChildrenCount = viewerToolbarContainer.children.length;
  for (var i = 0; i < viewerContainerChildrenCount; ++i) {
    viewerToolbarContainer.children[i].style.display = "none";
  }

  this.navigationControls = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);
  this.navigationControls.setVisible(true);
  this.navigationControls.container.style.display = '';

  this.measureControls = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MEASURETOOLSID);
  this.measureControls.setVisible(true);
  this.measureControls.container.style.display = '';

  var measureButtonId = this.measurementToolbarButton.getId();
  this.measurementToolbarButton.index = this.measurementToolbarButton.parent.indexOf(measureButtonId);
  this.measurementToolbarButton.parent.removeControl(measureButtonId);

  this.measureToolbar.toggleVisible();

  if (this.viewer.centerToolBar) {
    this.viewer.centerToolBar();
  }

  this.enableMeasureTool(true);
  if (this.hasNotEntered) {
    this.viewer.dispatchEvent({ type: MeasureCommon.Events.MEASURE_TOOL_ACTIVE });
    this.hasNotEntered = false;
  }
};

/**
 * @private
 */
MeasureExtension.prototype.exitMeasurementMode = function () {
  if (!this._measurementMode) return;

  this.viewer.dispatchEvent({ type: MeasureCommon.Events.MEASUREMENT_MODE_LEAVE });

  this.measureToolbar && this.measureToolbar.closeToolbar();
  if (this.CalibrationRequiredDialog && this.CalibrationRequiredDialog.isVisible()) {
    this.CalibrationRequiredDialog.setVisible(false);
  }
  this._measurementMode = false;
  this.activeStatus = false;
};

/**
 * Create measure button in toolbar.
 *
 * @param toolbar
 * @private
 */
MeasureExtension.prototype.onToolbarCreated = function (toolbar)
{
  if (this.measureToolbar) {
    return;
  }

  var self = this;
  var viewer = this.viewer;

  // Add Measure button to toolbar
  var modelTools = toolbar.getControl(av.TOOLBAR.MODELTOOLSID);
  this.measurementToolbarButton = new avu.Button('toolbar-measurementSubmenuTool');
  this.measurementToolbarButton.setToolTip('Measure');
  this.measurementToolbarButton.setIcon("adsk-icon-measure");
  modelTools.measurementToolbarButton = this.measurementToolbarButton;
  modelTools.addControl(this.measurementToolbarButton, { index: 1 });

  // Set button enabled if and only if there is >=1 visible model. Otherwise, it will remain disabled until next model-add event.
  var state = this.viewer.model ? Autodesk.Viewing.UI.Button.State.INACTIVE : Autodesk.Viewing.UI.Button.State.DISABLED;
  this.measurementToolbarButton.setState(state);

  this.measureToolbar = new _MeasureToolbar_js__WEBPACK_IMPORTED_MODULE_4__.MeasureToolbar(this);
  this.measureToolbar.init();

  this.customToolButtons.forEach((button) => {
    this.measureToolbar.addCustomToolButton(button.measurementType, button.button, button.buttonIndex);
  });
  this.customToolButtons = [];

  this.measurementToolbarButton.onClick = () => {
    // restore recently used mode
    self.activate(this.mode);
  };

  // Escape hotkey to exit tool.
  //
  var hotkeys = [{
    keycodes: [
    Autodesk.Viewing.KeyCode.ESCAPE],

    onRelease: function () {
      if (self._measurementMode) {
        self.exitMeasurementMode();
        return true;
      }
    }
  }];
  viewer.getHotkeyManager().pushHotkeys(this.escapeHotkeyId, hotkeys);
};


/**
 * @param tool
 * @private
 */
MeasureExtension.prototype.checkAndFetchTopology = function (tool) {

  if (this._checkedTopology) {
    return;
  }

  this._checkedTopology = true;
  if (!this.viewer.model.is3d()) {
    tool && tool.setNoTopology();
    return;
  }

  if (this.viewer.modelHasTopology()) {
    tool && tool.setTopologyAvailable();
    return;
  }

  // Fetch topology from backend.
  tool && tool.setFetchingTopology();
  this.viewer.model.fetchTopology().
  then(function () {
    tool && tool.setTopologyAvailable();
  }).
  catch(function (err) {
    avp.logger.log(err); // No topology
    tool && tool.setNoTopology();
  });
};

/**
 * Destroy measure button in toolbar.
 *
 * @private
 */
MeasureExtension.prototype.destroyUI = function ()
{
  var viewer = this.viewer;

  if (this.measureToolbar) {
    this.measureToolbar.destroy();
    this.measureToolbar = null;
  }

  if (this.measurementToolbarButton) {
    this.measurementToolbarButton.removeFromParent();
    this.measurementToolbarButton = null;
  }

  viewer.getHotkeyManager().popHotkeys(this.escapeHotkeyId);
};

MeasureExtension.prototype.setUnits = function (units) {
  this.measureTool.setUnits(units);
};

MeasureExtension.prototype.getUnits = function () {
  return this.measureTool.getUnits();
};

MeasureExtension.prototype.setPrecision = function (precision) {
  this.measureTool.setPrecision(precision);
};

MeasureExtension.prototype.getPrecision = function () {
  return this.measureTool.getPrecision();
};

MeasureExtension.prototype.calibrate = function (requestedUnits, requestedSize) {
  this.calibrationTool.calibrate(requestedUnits, requestedSize);
};

MeasureExtension.prototype.calibrateByScale = function (requestedUnits, requestedScale) {
  this.calibrationTool.calibrateByScale(requestedUnits, requestedScale);
};

MeasureExtension.prototype.isCalibrationValid = function (requestedUnits, requestedSize) {
  return this.calibrationTool.isCalibrationValid(requestedUnits, requestedSize);
};

MeasureExtension.prototype.getCalibrationFactor = function () {
  return this.calibrationTool.getCalibrationFactor();
};

MeasureExtension.prototype.showAddCalibrationLabel = function () {
  this.calibrationTool.showAddCalibrationLabel();
};

/**
 * Delete all measurements.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#deleteAllMeasurements
 * @public
 */
MeasureExtension.prototype.deleteMeasurements = function () {
  this.measureTool.deleteMeasurements();
};

/**
 * Deletes the selected measurement.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#deleteCurrentMeasurement
 * @public
 */
MeasureExtension.prototype.deleteCurrentMeasurement = function () {
  this.measureTool.deleteCurrentMeasurement();
};

MeasureExtension.prototype.selectMeasurementById = function (id) {
  this.measureTool.selectMeasurementById(id);
};

/**
 * Enable measuring on non snapped locations.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#setFreeMeasureMode
 * @param {boolean} allow - true to allow measuring on non snapped locations, otherwise false;
 * @param {boolean} useLastViewport - override the free measurement's viewport with a previously created measurement's viewport.
 * @public
 */
MeasureExtension.prototype.setFreeMeasureMode = function (allow, useLastViewport) {
  this.snapper.setSnapToPixel(allow);
  this.measureTool.setUseLastViewport(!!useLastViewport);
};

/**
 * Checks whether measuring can be performed from non snapped locations.
 *
 * @alias Autodesk.Viewing.Extensions.MeasureExtension#isFreeMeasureMode
 *
 * @returns {boolean} true is users can measure from any location.
 * @public
 */
MeasureExtension.prototype.isFreeMeasureMode = function () {
  return this.snapper.getSnapToPixel();
};

MeasureExtension.prototype.getState = function (viewerState) {
  if (this.measureTool.isActive()) {
    viewerState['measurements'] = this.getMeasurementList();
  }
};

MeasureExtension.prototype.restoreState = function (viewerState) {
  if (!this.measureTool.isActive() && viewerState['measurements']) {
    this.measureTool.setSessionMeasurements(viewerState['measurements']);
  }
};

/**
 * Register a custom measurement tool.
 * Be aware that the measure tool is unloaded and reloaded when the viewer UI is created, so you need to make sure
 * to re-register the custom tool afterwords again. The Autodesk.Viewing.EXTENSION_LOADED_EVENT can be used to detect when the measure
 * extension is reloaded.
 * @param {number} measurementType - the type of the measurement (should not conflict with the built-in types)
 * @param {CustomMeasureTool} customMeasureTool - An object implementing the CustomMeasureTool interface
 * @param {Autodesk.Viewing.UI.Button} button - A button that will be added to the measurement toolbar to activate the custom tool
 * @param {number} buttonIndex - The index at which the button should be added in the toolbar
 * @returns {boolean} true if the custom tool was successfully registered, false otherwise
 * @private
 */
MeasureExtension.prototype.registerCustomTool = function (measurementType, customMeasureTool, button, buttonIndex) {
  if (this.measureTool.registerCustomTool(measurementType, customMeasureTool)) {
    if (this.measureToolbar) {
      this.measureToolbar.addCustomToolButton(measurementType, button, buttonIndex);
    } else {
      this.customToolButtons.push({ measurementType, button, buttonIndex });
    }
    return true;
  }
  return false;
};

/**
 * Deregister a custom measurement tool.
 * @param {number} measurementType - The type of the custom measurement tool to deregister
 * @private
 */
MeasureExtension.prototype.deregisterCustomTool = function (measurementType) {
  if (this.measureTool.getCurrentMeasureType() === measurementType) {
    this.changeMeasurementType(DEFAULT_MEASUREMENT_TYPE);
  }
  this.measureTool.deregisterCustomTool(measurementType);
  if (this.measureToolbar) {
    this.measureToolbar.removeCustomToolButton(measurementType);
  } else {
    this.customToolButtons.filter((button) => button.measurementType !== measurementType);
  }
};

av.theExtensionManager.registerExtension('Autodesk.Measure', MeasureExtension);
})();

Autodesk.Extensions.Measure = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=Measure.js.map