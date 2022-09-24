const MqttThermostat = require('../lib/mqttThermostat').thermostat;
const samples = require('./samples');
const pino = require('pino');
const tccPlatform = require('mqtt')

test('sample name to be Master Room', () => {
    expect(samples.sample_thermostat.Name).toBe("MASTER ROOM");
});

test('away_mode', () => {
    class thermostatWrapper {
        constructor(){
            this.log = pino;
        }
    }
    let mqttThermostat = new MqttThermostat(new thermostatWrapper(),samples.sample_config,samples.sample_thermostat);
    expect(mqttThermostat.name).toBe("MASTER ROOM");
});