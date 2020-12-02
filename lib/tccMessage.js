// var debug = require('debug')('tcc-libMessage');

const Temperature = require('./temperature.js');

module.exports = {
  soapMessage: soapMessage,
  AuthenticateUserLoginMessage: AuthenticateUserLoginMessage,
  GetLocationsMessage: GetLocationsMessage,
  ChangeThermostatMessage: ChangeThermostatMessage,
  GetCommTaskStateMessage: GetCommTaskStateMessage,
  GetThermostatMessage: GetThermostatMessage,
  normalizeToHb: normalizeToHb,
  toHb: toHb
};

function soapMessage(body) {
  return ({
    "soap:Envelope": {
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
      "xmlns:soap": "http://schemas.xmlsoap.org/soap/envelope/",
      "xmlns": "http://services.alarmnet.com/Services/MobileV2/",
      "soap:Body": body
    }
  });
}

function AuthenticateUserLoginMessage(username, password) {
  return ({
    AuthenticateUserLogin: {
      username: {
        $t: username
      },
      password: {
        $t: password
      },
      applicationID: {
        $t: "357568d9-38ff-4fda-bfe2-46b0fa1dd864"
      },
      applicationVersion: {
        $t: "2"
      },
      uiLanguage: {
        $t: "Default"
      }
    }
  });
}

function GetLocationsMessage(sessionID) {
  return ({
    GetLocations: {
      sessionID: {
        $t: sessionID
      }
    }
  });
}

// Status Heat / Cool
//  0 - Follow schedule
//  1 - Temporary override
//  2 - Permanent override

function ChangeThermostatMessage(sessionID, desiredState, thermostat) {
  // debug("ChangeThermostatMessage", desiredState);
  const message = {
    sessionID: {
      $t: sessionID
    },
    thermostatID: {
      $t: desiredState.ThermostatID
    },
  };
  changeSystemSwitch(message, desiredState, thermostat);
  changeSetpoint(message, 'Heat', desiredState, thermostat);
  changeSetpoint(message, 'Cool', desiredState, thermostat);
  changeNextPeriod(message, 'Heat', desiredState, thermostat);
  changeNextPeriod(message, 'Cool', desiredState, thermostat);
  changeStatus(message, 'Heat', desiredState, thermostat);
  changeStatus(message, 'Cool', desiredState, thermostat);
  return ({ChangeThermostatUI: message});
}

function GetCommTaskStateMessage(sessionID, commTaskID) {
  return ({
    GetCommTaskState: {
      sessionID: {
        $t: sessionID
      },
      commTaskID: {
        $t: commTaskID
      }
    }
  });
}

function GetThermostatMessage(sessionID, ThermostatID) {
  return ({
    GetThermostat: {
      sessionID: {
        $t: sessionID
      },
      thermostatID: {
        $t: ThermostatID
      }
    }
  });
}

function normalizeToHb(devices) {
  devices.hb = [];
  // Flatten structure
  if (Array.isArray(devices.LocationInfo)) {
    devices.LocationInfo.forEach((LocationInfo, i) => {
      if (Array.isArray(LocationInfo.Thermostats.ThermostatInfo)) {
        LocationInfo.Thermostats.ThermostatInfo.forEach((item, i) => {
          // debug("normalizeToHb", item.ThermostatID);
          devices.hb[item.ThermostatID.toString()] = toHb(item);
        });
      } else {
        // console.log("normalizeToHb", LocationInfo.Thermostats);
        devices.hb[LocationInfo.Thermostats.ThermostatInfo.ThermostatID.toString()] = toHb(LocationInfo.Thermostats.ThermostatInfo);
      }
    });
  } else {
    if (Array.isArray(devices.LocationInfo.Thermostats.ThermostatInfo)) {
      devices.LocationInfo.Thermostats.ThermostatInfo.forEach((item, i) => {
        // debug("normalizeToHb", item.ThermostatID);
        devices.hb[item.ThermostatID.toString()] = toHb(item);
      });
    } else {
      devices.hb[devices.LocationInfo.Thermostats.ThermostatInfo.ThermostatID.toString()] = toHb(devices.LocationInfo.Thermostats.ThermostatInfo);
    }
  }
  // debug("normalizeToHb", devices.hb);
  return devices;
}

function toHb(thermostat) {
  const response = {};

  response.ThermostatID = thermostat.ThermostatID;
  response.Name = thermostat.UserDefinedDeviceName;
  response.Model = thermostat.ModelTypeName;
  response.CurrentTemperature = toTemperature(thermostat.UI.DispTemperature, thermostat);
  response.TargetTemperature = toTemperature(targetTemperature(thermostat), thermostat);
  response.HeatingThresholdTemperature = toTemperature(thermostat.UI.HeatSetpoint, thermostat);
  response.CoolingThresholdTemperature = toTemperature(thermostat.UI.CoolSetpoint, thermostat);
  response.CurrentHeatingCoolingState = currentState(thermostat);
  response.TargetHeatingCoolingState = targetState(thermostat);
  response.TargetHeatingCoolingStateValidValues = stateValidValues(thermostat);
  response.TargetTemperatureHeatMinValue = toTemperature(thermostat.UI.HeatLowerSetptLimit, thermostat);
  response.TargetTemperatureHeatMaxValue = toTemperature(thermostat.UI.HeatUpperSetptLimit, thermostat);
  response.TargetTemperatureCoolMinValue = toTemperature(thermostat.UI.CoolLowerSetptLimit, thermostat);
  response.TargetTemperatureCoolMaxValue = toTemperature(thermostat.UI.CoolUpperSetptLimit, thermostat);
  response.device = thermostat;
  return response;
}

function toTemperature(value, thermostat) {
  if (value) {
    const unit = thermostat.UI.DisplayedUnits || "F";
    return new Temperature(parseFloat(value), unit);
  } else {
    return null;
  }
}

function fromTemperature(value, thermostat) {
  return (thermostat.device.UI.DisplayedUnits === "C" ? value.C.toFixed(1) : value.F.toFixed(0));
}

function currentState(thermostat) {
  let state = 0;
  switch (thermostat.EquipmentStatus) {
    case "Off": // Off
      state = 0;
      break;
    case "Heating": // Off
      state = 1;
      break;
    case "Cooling": // Off
      state = 2;
      break;
  }
  return parseFloat(state);
}

function stateValidValues(thermostat) {
  const response = [];
  if (thermostat.UI.CanSetSwitchOff) {
    response.push(0);
  }
  if (thermostat.UI.CanSetSwitchHeat) {
    response.push(1);
  }
  if (thermostat.UI.CanSetSwitchCool) {
    response.push(2);
  }
  if (thermostat.UI.CanSetSwitchAuto) {
    response.push(3);
  }
  return response;
}

function targetState(thermostat) {
  // TCC to HomeKit
  let state;
  switch (thermostat.UI.SystemSwitchPosition) {
    case 2: // Off
    case 5: // Off on Auto thermostats
      state = 0;
      break;
    case 1: // Heat
      state = 1;
      break;
    case 3: // Cool
      state = 2;
      break;
    case 4: // Auto
      state = 3;
      break;
    default:
      state = 0;
  }

  return parseFloat(state);
}

function targetTemperature(thermostat) {
  let targetTemperature;
  switch (thermostat.UI.SystemSwitchPosition) {
    case 2: // Off
      // Not sure what to do here, so will use heat set point
      targetTemperature = thermostat.UI.HeatSetpoint;
      break;
    case 1: // Heat
      targetTemperature = thermostat.UI.HeatSetpoint;
      break;
    case 3: // Cool
      targetTemperature = thermostat.UI.CoolSetpoint;
      break;
    case 4: // Auto
      // Not sure what to do here, so will use heat set point
      targetTemperature = thermostat.UI.HeatSetpoint;
      break;
    default:
      // Not sure what to do here, so will display current temperature
      targetTemperature = thermostat.UI.DispTemperature;
  }

  return (targetTemperature);
}

function changeSystemSwitch(message, desiredState, thermostat) {
  // debug("systemSwitch desiredState.TargetHeatingCooling", desiredState);
  if (desiredState.TargetHeatingCooling !== undefined) {
    let state;
    switch (desiredState.TargetHeatingCooling) {
      case 0: // Off
        state = 2;
        break;
      case 1: // Heat
        state = 1;
        break;
      case 2: // Cool
        state = 3;
        break;
      case 3: // Auto
        state = 4;
        break;
      case undefined:
        // debug("systemSwitch undefined", thermostat.device.UI.SystemSwitchPosition);
        state = thermostat.device.UI.SystemSwitchPosition;
        break;
      default:
        // debug("systemSwitch default");
        state = thermostat.device.UI.SystemSwitchPosition;
    }
    message['changeSystemSwitch'] = {
      $t: 1
    };
    message['systemSwitch'] = {
      $t: state
    };
    thermostat.device.UI.SystemSwitchPosition = state; // update for downstream usage
  }
}


function changeNextPeriod(message, which, desiredState, thermostat) {
  const nextPeriodWhich = `${which}NextPeriod`;
  const statusWhich = `Status${which}`;
  if (desiredState[nextPeriodWhich] !== undefined || desiredState[statusWhich] !== undefined) {
    let response = desiredState[nextPeriodWhich];
    if (desiredState[statusWhich] === 0 || desiredState[statusWhich] === 2) { // Switch to schedule or permanent hold
      response = 0;
    } else if(response === undefined &&   desiredState[statusWhich] === 1){
      response = thermostat.device.UI[nextPeriodWhich];
    }
    message[`change${which}NextPeriod`] = {
      $t: 1
    };
    message[`${which.toLowerCase()}NextPeriod`] = {
      $t: response
    };
  }
}

function changeStatus(message, which, desiredState, thermostat) {
  const statusWhich = `Status${which}`;
  let response = null;
  if (desiredState.TargetTemperature || desiredState.HeatingThresholdTemperature || desiredState.CoolingThresholdTemperature) {
    if (thermostat.device.UI[statusWhich] === 0) { // using schedule
      response = 1; // temporary hold
    }
  }
  if (statusWhich in desiredState) { // If set, override above.
    response = desiredState[statusWhich];
  }
  if(response !== null){
    message[`changeStatus${which}`] = {
      $t: 1
    };
    message[`status${which}`] = {
      $t: response
    };
  }
}

function changeSetpoint(message, which, desiredState, thermostat) {
  const whichSetpoint = `${which}Setpoint`;
  const whichThresholdTemperature = `${which}ingThresholdTemperature`;
  const whichStatus = `Status${which}`;
  let response;
  if (desiredState[whichStatus]) {
    response = thermostat.device.UI[whichSetpoint];
  }
  if (desiredState.TargetTemperature || desiredState[whichThresholdTemperature]) {
    const whichTemperature = fromTemperature(
      desiredState.TargetTemperature ? desiredState.TargetTemperature : desiredState[whichThresholdTemperature],
      thermostat);
    switch (thermostat.device.UI.SystemSwitchPosition) {
      case 1: // TCC Heat
        if (which === 'Heat') {
          response = whichTemperature;
        }
        break;
      case 2: // TCC Off
        break;
      case 3: // TCC Cool
        if (which === 'Cool') {
          response = whichTemperature;
        }
        break;
      case 4: // TCC Auto
        response = fromTemperature(desiredState[whichTemperature], thermostat);
        break;
    }
  }
  if (response) {
    message[`change${which}Setpoint`] = {
      $t: 1
    };
    message[`${which.toLowerCase()}Setpoint`] = {
      $t: response
    };
  }
}
