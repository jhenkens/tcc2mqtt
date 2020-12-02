/*jslint node: true */
'use strict';

const config = require('./secrets.js').config;
const debug = require('debug')('tcc');
const Tcc = require('./lib/tcc.js').tcc;

const ThermostatImplementation = require('./lib/mqttThermostat.js').thermostat;

function tccPlatform(log, config) {
  this.thermostats = {};
  this.username = config['username'];
  this.password = config['password'];
  this.refresh = config['refresh'] || 300; // Update every 5 minutes
  this.log = log;
  this.devices = config['devices'];
  this.tcc = null;
  this.config = config;

  // Enable config based DEBUG logging enable
  this.debug = config['debug'] || false;
  if (this.debug) {
    debug.enabled = true;
  }
}

tccPlatform.prototype.getThermostatByID = function(id) {
  if(id in this.thermostats){
    return this.thermostats[id];
  }
  return null;
}

tccPlatform.prototype.createThermostat = function(device){
  let existing = this.getThermostatByID(device.ThermostatID);
  if (existing) {
    this.log("Existing TCC thermostat", existing.thermostat.name);
    return existing;
  }

  this.log("Adding TCC thermostat", device.Name);

  existing = new Thermostat(this, device);
  this.thermostats[existing.thermostat.ThermostatID] = existing;
  return existing;
}

tccPlatform.prototype.start = function() {
  this.tcc = new Tcc(this);
  this.tcc.pollThermostat().then((devices) => {
    for (let zone in devices.hb) {
      const device = devices.hb[zone];
      debug("Creating device for", device.Name);
      if(this.devices != null && !(this.devices.includes(device.ThermostatID))){
        this.log("Ignoring device - not in devices list", device.Name, device.ThermostatID);
        continue;
      }
      this.createThermostat(device);
    }
  }).catch((err) => {
    this.log("Critical Error - No devices created, please restart.");
    this.log(err.message);
    this.log(err.stack);
    process.exit(1);
  });
  setInterval(this.pollDevices.bind(this), this.refresh * 1000); // Poll every minute
};

tccPlatform.prototype.pollDevices = function(){
  this.tcc.pollThermostat().then((devices) => {
    Object.entries(this.thermostats).forEach(function([key,value]) {
      const thermostat = value.thermostat;
      debug("pollDevices - updateStatus", thermostat.name);
      var device = devices.hb[thermostat.ThermostatID];
      if(device) {
        thermostat.updateStatus(device);
      } else {
        this.log("ERROR: no data for", thermostat.name);
        thermostat.setUnavailable("Status missing");
      }
    }.bind(this));
  }).catch((err) => {
    if (err.message === 'Error: GetLocations InvalidSessionID') {
      // [Thermostat] ERROR: pollDevices Error: GetLocations InvalidSessionID
      // this.log("ERROR: pollDevices", err.message);
    } else if (err.message) {
      // [Thermostat] ERROR: pollDevices Error: GetLocations InvalidSessionID
      this.log("pollDevices", err.message);
      this.log(err.stack);
    } else {
      this.log("ERROR: pollDevices", err);
    }
    Object.entries(this.thermostats).forEach(function([key,value]) {
      value.thermostat.setUnavailable("Status missing");
    });
  });
}

function Thermostat(that, device){
  this.log = that.log;
  this.thermostat = new ThermostatImplementation(this, that, device);
  this.changeBuffer = new ChangeBuffer(that, this.thermostat);
}

Thermostat.prototype.setTargetTemperature = function(value, callback) {
  this.log("Setting TargetTemperature for", this.thermostat.name, "to", value);
  this.changeBuffer.put({
    TargetTemperature: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setTargetHeatingCooling = function(value, callback) {
  this.log("Setting switch for", this.thermostat.name, "to", value);
  this.changeBuffer.put({
    TargetHeatingCooling: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setHoldMode = function(value, lowPriority, callback) {
  this.log("Setting hold mode for", this.thermostat.name, "to", value);
  this.changeBuffer.put({
    StatusHeat: value,
    StatusCool: value,
  }, lowPriority).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setHeatingThresholdTemperature = function(value, callback) {
  this.log("Setting HeatingThresholdTemperature for", this.thermostat.name, "to", value);
  this.changeBuffer.put({
    HeatingThresholdTemperature: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setCoolingThresholdTemperature = function(value, callback) {
  this.log("Setting CoolingThresholdTemperature for", this.thermostat.name, "to", value);
  this.context.ChangeThermostat.put({
    CoolingThresholdTemperature: value
  }).then((device) => {
    this.thermostat.updateStatus(device);
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

// Consolidate change requests received over 100ms into a single request
function ChangeBuffer(platform, thermostat) {
  // debug("ChangeThermostat", accessory);
  this.tcc = platform.tcc;
  this.desiredState = {};
  this.deferrals = [];
  this.ThermostatID = thermostat.ThermostatID;
  this.thermostat = thermostat;
  this.waitTimeUpdate = 500; // wait 500ms before processing change
}

ChangeBuffer.prototype.put = function(state, lowPriority = false) {
  debug("put %s ->", this.ThermostatID, state);
  return new Promise((resolve, reject) => {
    this.desiredState.ThermostatID = this.ThermostatID;
    for (const key in state) {
      // console.log("ChangeThermostat", accessory);
      if(lowPriority && key in this.desiredState){
        continue;
      }
      this.desiredState[key] = state[key];
    }
    const d = {
      resolve: resolve,
      reject: reject
    };
    this.deferrals.push(d);
    if (!this.timeout) {
      this.timeout = setTimeout(() => {
        this.tcc.ChangeThermostat(this.desiredState).then((thermostat) => {
          for (const d of this.deferrals) {
            d.resolve(thermostat);
          }
          this.thermostat.updateStatus(thermostat);
          this.desiredState = {};
          this.deferrals = [];
          this.timeout = null;
        }).catch((error) => {
          for (const d of this.deferrals) {
            d.reject(error);
          }
          this.desiredState = {};
          this.deferrals = [];
          this.timeout = null;
        });
      }, this.waitTimeUpdate);
    }
  });
};
// var mqttThermostat = new ThermostatImplementation(that,{'Name':'hi','ThermostatID':1234})
const tcc = new tccPlatform(console.log, config);
tcc.start()
// console.log(tcc);

