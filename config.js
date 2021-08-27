/*jslint node: true */
'use strict';

const conf = require('rc')('tcc2mqtt', {
  mqtt: {
    url: 'mqtt://mqtt.lan',
    username: undefined,
    password: undefined,
  },
  username: undefined,
  password: undefined,
  min_temp: undefined,
  max_temp: undefined,
  temperature_unit: 'F',
  homeassistant_discovery: false,
  use_away_mode: false,
  away_temperature: 50,
  away_heat_cool_mode: 'heat',
  use_auto_for_schedule_in_homekit: false,
  devices: undefined,
  refresh: 300,
  logLevel: 'info',
  debug: false
});


module.exports = conf;
