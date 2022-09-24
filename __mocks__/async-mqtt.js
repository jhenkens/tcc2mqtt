'use strict';

const mqtt = jest.createMockFromModule('async-mqtt');

function connect(url, config){
    let result = Object.create(null);
    result.on = jest.fn();
    return result;
}

mqtt.connect = connect;

module.exports = mqtt;