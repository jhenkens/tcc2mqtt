/*jslint node: true */
'use strict';

const config = require('./config.js');
const debug = require('debug')('tcc');
const Tcc = require('./lib/tcc.js').tcc;
const logger = require('pino')({
  prettyPrint: {
    colorize: true,
    translateTime: 'yyyy-mm-dd HH:MM:ss',
    ignore: 'pid,hostname,scope',
    messageFormat: "{scope}: {msg}"
}})

const ThermostatImplementation = require('./lib/mqttThermostat.js').thermostat;

function tccPlatform(log, config) {
  this.thermostats = {};
  this.username = config['username'];
  this.password = config['password'];
  this.refresh = config['refresh']; // Update every 5 minutes
  this.log = log;
  this.devices = config['devices'];
  if(this.devices !== null && this.devices.length > 0){
    this.devices = this.devices.map(x => x.toString());
  } else{
    this.devices = null;
  }
  this.tcc = null;
  this.config = config;
  log.level = config['logLevel'] || 'info';

  // Enable config based DEBUG logging enable
  this.debug = config['debug'] || false;
  if (this.debug) {
    debug.enabled = true;
    log.level = 'debug';
  }
}

tccPlatform.prototype.getThermostatByID = function (id) {
  if (id in this.thermostats) {
    return this.thermostats[id];
  }
  return null;
}

tccPlatform.prototype.createThermostat = function (device) {
  let existing = this.getThermostatByID(device.ThermostatID);
  if (existing) {
    this.log.info("Existing TCC thermostat %s", existing.thermostat.name);
    return existing;
  }

  this.log.info("Adding TCC thermostat %s", device.Name);

  existing = new Thermostat(this, device);
  this.thermostats[existing.thermostat.ThermostatID] = existing;
  return existing;
}

tccPlatform.prototype.start = function () {
  this.tcc = new Tcc(this);
  this.tcc.pollThermostat().then((devices) => {
    for (let zone in devices.hb) {
      const device = devices.hb[zone];
      this.log.debug("Creating device for %s", device.Name);
      if (this.devices != null && !(this.devices.includes(device.ThermostatID.toString()))) {
        this.log.info("Ignoring device %s - not in devices list %s", device.Name, device.ThermostatID);
        continue;
      }
      this.createThermostat(device);
    }
  }).catch((err) => {
    this.log.warn("Critical Error - No devices created, please restart.");
    this.log.warn(err.message);
    this.log.warn(err.stack);
    process.exit(1);
  });
  setInterval(this.pollDevices.bind(this), this.refresh * 1000);
};

tccPlatform.prototype.pollDevices = function () {
  this.tcc.pollThermostat().then((devices) => {
    Object.entries(this.thermostats).forEach(function ([key, value]) {
      const thermostat = value.thermostat;
      this.log.debug("pollDevices - updateStatus %s", thermostat.name);
      var device = devices.hb[thermostat.ThermostatID];
      if (device) {
        this.log.debug("Found device: %s", JSON.stringify(device));
        thermostat.updateStatus(device);
      } else {
        this.log.error("ERROR: no data for %s", thermostat.name);
        thermostat.setUnavailable("Status missing");
      }
    }.bind(this));
  }).catch((err) => {
    if (err.message === 'Error: GetLocations InvalidSessionID') {
      return;
    } else if (err.message) {
      this.log.error("pollDevices %s", err.message);
      this.log.error(err.stack);
    } else {
      this.log.error("ERROR: pollDevices %s", err);
    }
    Object.entries(this.thermostats).forEach(function ([key, value]) {
      value.thermostat.setUnavailable("Unexpected error");
    });
  });
}

function Thermostat(that, device) {
  this.log = that.log.child({scope: device.Name});;
  this.thermostat = new ThermostatImplementation(this, that.config, device);
  this.changeBuffer = new ChangeBuffer(this, that, this.thermostat);
}

Thermostat.prototype.setTargetTemperature = function (value, callback) {
  this.log.debug("Setting TargetTemperature to %s F", value.F);
  this.changeBuffer.put({
    TargetTemperature: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setTargetHeatingCooling = function (value, callback) {
  this.log.debug("Setting switch to %s", value);
  this.changeBuffer.put({
    TargetHeatingCooling: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setHoldMode = function (value, lowPriority, callback) {
  this.log.debug("Setting hold mode to %s", value);
  this.changeBuffer.put({
    StatusHeat: value,
    StatusCool: value,
  }, lowPriority).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setHeatingThresholdTemperature = function (value, callback) {
  this.log.debug("Setting HeatingThresholdTemperature to %s", value);
  this.changeBuffer.put({
    HeatingThresholdTemperature: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

Thermostat.prototype.setCoolingThresholdTemperature = function (value, callback) {
  this.log.debug("Setting CoolingThresholdTemperature for %s to %s", this.thermostat.name, value);
  this.context.ChangeThermostat.put({
    CoolingThresholdTemperature: value
  }).then((device) => {
    callback(null, value);
  }).catch((error) => {
    callback(error);
  });
}

// Consolidate change requests received over 100ms into a single request
function ChangeBuffer(wrapper, platform, thermostat) {
  this.log = wrapper.log;
  this.tcc = platform.tcc;
  this.desiredState = {};
  this.deferrals = [];
  this.ThermostatID = thermostat.ThermostatID;
  this.thermostat = thermostat;
  this.waitTimeUpdate = 500; // wait 500ms before processing change
}

ChangeBuffer.prototype.put = function (state, lowPriority = false) {
  debug("put %s ->", this.ThermostatID, state);
  return new Promise((resolve, reject) => {
    this.desiredState.ThermostatID = this.ThermostatID;
    for (const key in state) {
      // console.log("ChangeThermostat", accessory);
      if (lowPriority && key in this.desiredState) {
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

// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
  'SIGHUP': 1,
  'SIGINT': 2,
  'SIGTERM': 15
};
// Do any necessary shutdown logic for our application here
const shutdown = function() {
  logger.debug("shutdown!");
  process.exit(0);
}
// Create a listener for each of the signals that we want to handle
Object.keys(signals).forEach((signal) => {
  process.on(signal, () => {
    logger.debug(`process received a ${signal} signal`);
    shutdown();
  });
});

logger.info("Loading config from %s", config.configs)
const tcc = new tccPlatform(logger, config);
tcc.start()
