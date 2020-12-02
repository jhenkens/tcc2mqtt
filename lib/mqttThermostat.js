/*jslint node: true */
'use strict';
const mqtt = require('async-mqtt');
const diff = require('./diff.js');
const Temperature = require('./temperature.js');
const os = require("os");
const hostname = os.hostname();

module.exports = {thermostat: MqttThermostat};

function isTrue(val){
  return val === true || val === 'true';
}
function tryParseFloat(r) {
  if (Number.isNaN(Number.parseFloat(r))) {
    return null;
  }
  return parseFloat(r);
}
function getMinMaxTemp(config, math_func, heat, cool, modes){
  const parsed = tryParseFloat(config);
  if(parsed !== null){
    return  parsed;
  }
  if(modes.includes(1) && modes.includes(2)){
    return math_func(heat,cool);
  } else if(modes.includes(1)){
    return heat;
  }
  return cool;
}

function MqttThermostat(wrapper, that, device) {
  this.wrapper = wrapper;
  this.log = that.log;
  this.name = device.Name;
  this.mqttName = device.Name
      .replace(" ", "_")
      .replace("'","")
      .replace("/","_")
      .toLowerCase();
  this.prefix = 'tcc2mqtt/' + this.mqttName;
  this.ThermostatID = device.ThermostatID;
  this.MacID = device.device.MacID;
  this.model = device.device.ModelTypeName + "-" + device.device.ModelTypeID,
  this.state = null;
  this.homeassistant_discovery = isTrue(that.config['homeassistant_discovery']);
  this.use_auto_for_schedule_in_homekit = isTrue(that.config['use_auto_for_schedule_in_homekit'])
  this.unit = that.config['temperatureUnit'] || 'F';

  this.available = false;
  this.availability_topic = this.prefix + '/availability'

  this.state_modes = ['off','heat','cool','auto'];
  this.action_modes = ['idle', 'heating', 'cooling'];
  this.valid_state_modes = device.TargetHeatingCoolingStateValidValues.map(x => this.state_modes[x]);

  // Uses "Auto" in Home Assistant heat modes as a proxy for "schedule". This allows HomeKit to manipulate schedule / hold.
  if(this.use_auto_for_schedule_in_homekit){
    if(this.valid_state_modes.includes('auto')) {
      throw new Error('Cannot use auto for schedules if auto is enabled on thermostat');
    }
    if(this.valid_state_modes.includes('heat') && !this.valid_state_modes.includes('cool')){
      this.auto_for_schedule_mode = 'heat';
    }else if (this.valid_state_modes.includes('cool')){
      this.auto_for_schedule_mode = 'cool';
    } else{
      throw new Error('Unsupported modes for HomeKit auto-schedule mode.')
    }
    this.valid_state_modes.push('auto');
  }

  this.min_temp = getMinMaxTemp(that.config['min_temp'], Math.min, this.temperatureToMqtt(device.TargetTemperatureHeatMinValue), this.temperatureToMqtt(device.TargetTemperatureCoolMinValue), this.valid_state_modes);
  this.max_temp = getMinMaxTemp(that.config['max_temp'], Math.min, this.temperatureToMqtt(device.TargetTemperatureHeatMaxValue), this.temperatureToMqtt(device.TargetTemperatureCoolMaxValue), this.valid_state_modes);

  this.mode_state_topic = this.prefix + '/mode'
  this.mode_command_topic = this.mode_state_topic + '/set'

  this.action_topic = this.prefix + '/action';

  this.target_temp_state_topic = this.prefix + '/temperature'
  this.target_temp_command_topic = this.target_temp_state_topic + '/set'

  this.current_temp_topic = this.prefix + '/current'

  this.hold_state_topic = this.prefix + '/hold'
  this.hold_command_topic = this.hold_state_topic + '/set'
  this.hold_modes = ["Follow Schedule", "Temporary Hold" , "Permanent Hold"];

  this.use_away_mode = isTrue(that.config['use_away_mode']);
  this.away_temperature = that.config['awayTemperature'] !== undefined
    ? new Temperature(that.config['awayTemperature'], this.unit)
    : new Temperature(50,'F');
  this.away_mode = that.config['awayHeatCoolMode'] || 'heat';
  this.away_mode_state_topic = this.prefix + '/away'
  this.away_mode_command_topic = this.away_mode_state_topic + '/set'

  this.json_attributes_topic = this.prefix + '/attributes';

  const mqttConfig = that.config['mqtt'] || {};
  const clientConfig = {
    clientId: 'tcc2mqtt_' + this.ThermostatID,
    will: {
      topic: this.availability_topic,
      payload: "offline",
      retain: true,
      qos: 1
    }
  };
  ['username','password'].forEach(function(allowedKey){
    if (allowedKey in mqttConfig){
      clientConfig[allowedKey] = mqttConfig[allowedKey];
    }
  });
  this.mqtt = mqtt.connect(mqttConfig['url'] || 'http://mqtt.lan', clientConfig);

  this.mqtt.on('connect', this.onConnect.bind(this, device));
  this.mqtt.on('message', this.handleMqttMessage.bind(this));
}

MqttThermostat.prototype.onConnect = async function(device) {
  this.log("Connected to mqtt for " + this.name);

  await this.mqtt.subscribe(this.prefix + "/+/set");

  if (this.homeassistant_discovery) {
    const payload = {
      "~": this.prefix,
      name: this.name,
      unique_id: this.ThermostatID,
      device: {
        connections: [["mac", this.MacID]],
        identifiers: ["tcc2mqtt_" + this.ThermostatID],
        name: this.name,
        model: this.model,
        manufacturer: "Honeywell",
        via_device: "tcc2_mqtt@" + hostname,
      },
      temperature_unit: this.unit,
      precision: this.unit === 'F' ? 1.0 : 0.5,
      initial: this.temperatureToMqtt(new Temperature(68, 'F')),
      min_temp: this.min_temp,
      max_temp: this.max_temp,

      modes: this.valid_state_modes,
      mode_state_topic: this.mode_state_topic,
      mode_command_topic: this.mode_command_topic,

      availability_topic: this.availability_topic,

      action_topic: this.action_topic,

      hold_modes: this.hold_modes,
      hold_state_topic: this.hold_state_topic,
      hold_command_topic: this.hold_command_topic,

      current_temperature_topic: this.current_temp_topic,

      temperature_state_topic: this.target_temp_state_topic,
      temperature_command_topic: this.target_temp_command_topic,

      json_attributes_topic: this.json_attributes_topic,
    };

    if (this.use_away_mode) {
      payload['away_mode_state_topic'] = this.away_mode_state_topic;
      payload['away_mode_command_topic'] = this.away_mode_command_topic;
    }
    const payloadString = JSON.stringify(payload);

    await this.mqtt.publish("homeassistant/climate/tcc2mqtt/" + this.ThermostatID + "/config", payloadString, {retain: true});

    await new Promise(r => setTimeout(r, 1000)); // Add sleeps some home assistant can process
  }

  await this.setAvailability(true, true);

  await new Promise(r => setTimeout(r, 1000));

  await this.updateStatusAsync(device, true);
}

MqttThermostat.prototype.setAvailability = async function(online, force){
  if(this.available != online || force) {
    await this.mqtt.publish(this.availability_topic, online ? "online" : "offline", {retain: true});
  }
  this.available = online;
}

MqttThermostat.prototype.handleMqttMessage = function(topic, message){
  message = message.toString();
  switch(topic){
    case this.target_temp_command_topic:
      this.setTemp(message);
      break;
    case this.mode_command_topic:
      if(this.use_auto_for_schedule_in_homekit){
        if(message === 'auto'){
          this.setHold(this.hold_modes[0]);
          break;
        } else if(message === 'heat'){
          this.setHold(this.hold_modes[1]);
          break;
        }
      }
      this.setMode(message);
      break;
    case this.hold_command_topic:
      this.setHold(message);
      break;
    case this.away_mode_command_topic:
      if(message === "ON") {
        this.setTemp(this.temperatureToMqtt(this.away_temperature));
        this.setHold(this.hold_modes[2]);
      } else{
        this.setHold(this.hold_modes[0], true);
      }
      break;
    default:
      this.log("Unhandled message: " + topic + ": " + message.toString())
  }
}

MqttThermostat.prototype.setTemp = function(target, permanent = undefined){
  this.wrapper.setTargetTemperature(
      new Temperature(tryParseFloat(target), this.unit),
      (err, val) => {}
  );
}

MqttThermostat.prototype.setHold = function(target, lowPriority = false){
  let index;
  if(target === "None" || target === "off"){
    index = 0 ;
  }else{
    index = this.hold_modes.indexOf(target);
  }
  this.wrapper.setHoldMode(
      index,
      lowPriority,
      (err, val) => {}
  );
}

MqttThermostat.prototype.setMode = function(target, permanent = undefined){
  this.wrapper.setTargetHeatingCooling(
      this.state_modes.indexOf(target),
      (err, val) => {}
  );
}

MqttThermostat.prototype.setUnavailable = function(message){
  this.setAvailability(false);
}

MqttThermostat.prototype.temperatureToMqtt = function(temp){
  if(this.unit === 'F'){
    return temp.F.toFixed(0);
  }
  return temp.C.toFixed(1);
}

MqttThermostat.prototype.state_mode = function(device){
  const mappedMode = this.state_modes[device.TargetHeatingCoolingState]; // this must come first
  if(this.use_auto_for_schedule_in_homekit && mappedMode === this.auto_for_schedule_mode){
    if (this.hold_mode(device) === this.hold_modes[2]) { // Permanent = heat/cool
      return this.auto_for_schedule_mode;
    }
    return 'auto';
  }
  return mappedMode;
}
MqttThermostat.prototype.hold_mode = function(device){
  switch (device.TargetHeatingCoolingState) {
    case 1: // heat
      return this.hold_modes[device.device.UI.StatusHeat];
    case 2: // cool
      return this.hold_modes[device.device.UI.StatusCool];
  }
  return this.hold_modes[0]; // schedule
}

MqttThermostat.prototype.updateStatus = function(device){
  this.updateStatusAsync(device);
}
MqttThermostat.prototype.updateStatusAsync = async function(device, force = false){
  const newState = {};
  newState[this.mode_state_topic] = this.state_mode(device);
  newState[this.action_topic] = this.action_modes[device.CurrentHeatingCoolingState];
  newState[this.target_temp_state_topic] = this.temperatureToMqtt(device.TargetTemperature);
  newState[this.current_temp_topic] = this.temperatureToMqtt(device.CurrentTemperature);
  newState[this.json_attributes_topic] = {
    hold_heat: this.hold_modes[device.device.UI.StatusHeat],
    hold_cool: this.hold_modes[device.device.UI.StatusCool],
    cooling_threshold: this.temperatureToMqtt(device.CoolingThresholdTemperature),
    heating_threshold: this.temperatureToMqtt(device.HeatingThresholdTemperature),
  }
  newState[this.hold_state_topic] = this.hold_mode(device);
  if(this.use_away_mode){
    let away = false;
    if( newState[this.mode_state_topic] === this.away_mode &&
        newState[this.target_temp_state_topic] ===  this.temperatureToMqtt(this.away_temperature) &&
        this.hold_mode(device) === this.hold_modes[2]
    ){
      newState[this.hold_state_topic] = "off"; // Set's hold to "None" in HA, so Away can take over
      away = true;
    }
    newState[this.away_mode_state_topic] = away ? "ON" : "OFF";
  }

  const diffed = diff.diff(this.state, newState);
  if(force || !diff.isEmptyObject(diffed)){
    await this.setAvailability(true);

    for( const key in newState ){
      let value = newState[key];
      if((force || key in diffed) && key.startsWith(this.prefix)){
        if(typeof value === "object"){
          value = JSON.stringify(value);
        }
        await this.mqtt.publish(key, value, {retain: true});
      }
    }

    this.state = newState;
  }
}

