/*jslint node: true */
"use strict";
const mqtt = require("async-mqtt");
const diff = require("./diff.js");
const Temperature = require("./temperature.js");
const os = require("os");
const hostname = os.hostname();
const minimizeDiscoveryPayload =
    require("./haDiscovery").minimizeDiscoveryPayload;

module.exports = { thermostat: MqttThermostat };

function isTrue(val) {
    return val === true || val === "true";
}
function tryParseFloat(r) {
    if (Number.isNaN(Number.parseFloat(r))) {
        return null;
    }
    return parseFloat(r);
}
function getMinMaxTemp(config, math_func, heat, cool, modes) {
    const parsed = tryParseFloat(config);
    if (parsed !== null) {
        return parsed;
    }
    if (modes.includes(1) && modes.includes(2)) {
        return math_func(heat, cool);
    } else if (modes.includes(1)) {
        return heat;
    }
    return cool;
}

function MqttThermostat(wrapper, config, device) {
    this.wrapper = wrapper;
    this.log = wrapper.log;
    this.name = device.Name;
    this.mqttName = device.Name.replace(" ", "_")
        .replace("'", "")
        .replace("/", "_")
        .toLowerCase();
    this.prefix = "tcc2mqtt/" + this.mqttName;
    this.statusPrefix = "tcc2mqtt/" + this.mqttName + "_status";
    this.ThermostatID = device.ThermostatID;
    this.MacID = device.device.MacID;
    this.model = device.device.ModelTypeName + "-" + device.device.ModelTypeID;
    this.state = null;
    this.homeassistant_discovery = isTrue(config["homeassistant_discovery"]);
    this.use_auto_for_schedule_in_homekit = isTrue(
        config["use_auto_for_schedule_in_homekit"]
    );
    this.unit = config["temperature_unit"];

    this.available = false;
    this.availability_topic = this.prefix + "/availability";

    this.status_topic = this.statusPrefix + "/state";
    this.status_availability_topic = this.statusPrefix + "/availability";
    this.status_json_attributes_topic = this.statusPrefix + "/attributes";
    this.status_data = {};

    this.state_modes = ["off", "heat", "cool", "auto"];
    this.action_modes = ["idle", "heating", "cooling"];
    this.valid_state_modes = device.TargetHeatingCoolingStateValidValues.map(
        (x) => this.state_modes[x]
    );

    // Uses "Auto" in Home Assistant heat modes as a proxy for "schedule". This allows HomeKit to manipulate schedule / hold.
    if (this.use_auto_for_schedule_in_homekit) {
        if (this.valid_state_modes.includes("auto")) {
            throw new Error(
                "Cannot use auto for schedules if auto is enabled on thermostat"
            );
        }
        if (
            this.valid_state_modes.includes("heat") &&
            !this.valid_state_modes.includes("cool")
        ) {
            this.auto_for_schedule_mode = "heat";
        } else if (this.valid_state_modes.includes("cool")) {
            this.auto_for_schedule_mode = "cool";
        } else {
            throw new Error(
                "Unsupported modes for HomeKit auto-schedule mode."
            );
        }
        this.valid_state_modes.push("auto");
    }

    this.min_temp = getMinMaxTemp(
        config["min_temp"],
        Math.min,
        this.temperatureToMqtt(device.TargetTemperatureHeatMinValue),
        this.temperatureToMqtt(device.TargetTemperatureCoolMinValue),
        this.valid_state_modes
    );
    this.max_temp = getMinMaxTemp(
        config["max_temp"],
        Math.min,
        this.temperatureToMqtt(device.TargetTemperatureHeatMaxValue),
        this.temperatureToMqtt(device.TargetTemperatureCoolMaxValue),
        this.valid_state_modes
    );

    this.mode_state_topic = this.prefix + "/mode";
    this.mode_command_topic = this.mode_state_topic + "/set";

    this.action_topic = this.prefix + "/action";

    this.target_temp_state_topic = this.prefix + "/temperature";
    this.target_temp_command_topic = this.target_temp_state_topic + "/set";

    this.current_temp_topic = this.prefix + "/current";

    this.hold_state_topic = this.prefix + "/hold";
    this.hold_command_topic = this.hold_state_topic + "/set";
    this.hold_modes = ["Follow Schedule", "Temporary Hold", "Permanent Hold"];

    this.use_away_mode = isTrue(config["use_away_mode"]);
    this.away_temperature =
        config["away_temperature"] !== undefined
            ? new Temperature(config["away_temperature"], this.unit)
            : undefined;
    this.away_mode = config["away_heat_cool_mode"];
    this.away_last_set = 0;
    if (this.use_away_mode) {
        this.hold_modes.push("Away");
    }

    this.json_attributes_topic = this.prefix + "/attributes";

    const mqttConfig = config["mqtt"] || {};
    const clientConfig = {
        clientId: "tcc2mqtt_" + this.ThermostatID,
        will: {
            topic: this.status_availability_topic,
            payload: "offline",
            retain: true,
            qos: 1,
        },
    };
    ["username", "password"].forEach(function (allowedKey) {
        if (allowedKey in mqttConfig) {
            clientConfig[allowedKey] = mqttConfig[allowedKey];
        }
    });
    this.mqtt = mqtt.connect(mqttConfig["url"], clientConfig);

    this.mqtt.on("connect", this.onConnect.bind(this, device));
    this.mqtt.on("message", this.handleMqttMessage.bind(this));
}

MqttThermostat.prototype.generateDiscoveryPayloads = function (
    minimized = true
) {
    const device_payload = {
        connections: [["mac", this.MacID]],
        identifiers: ["tcc2mqtt_" + this.ThermostatID],
        name: this.name,
        model: this.model,
        manufacturer: "Honeywell",
        via_device: "tcc2_mqtt@" + hostname,
    };
    const payload = {
        "~": this.prefix,
        name: this.name,
        unique_id: this.ThermostatID,
        device: device_payload,
        temperature_unit: this.unit,
        precision: this.unit === "F" ? 1.0 : 0.5,
        initial: this.temperatureToMqtt(new Temperature(68, "F")),
        min_temp: this.min_temp,
        max_temp: this.max_temp,

        modes: this.valid_state_modes,
        mode_state_topic: this.mode_state_topic,
        mode_command_topic: this.mode_command_topic,
        availability: [
            { topic: this.availability_topic },
            { topic: this.status_availability_topic },
        ],
        availability_mode: "all",

        action_topic: this.action_topic,

        preset_modes: this.hold_modes,
        preset_mode_state_topic: this.hold_state_topic,
        preset_mode_command_topic: this.hold_command_topic,

        current_temperature_topic: this.current_temp_topic,

        temperature_state_topic: this.target_temp_state_topic,
        temperature_command_topic: this.target_temp_command_topic,

        json_attributes_topic: this.json_attributes_topic,
    };

    const statusPayload = {
        "~": this.statusPrefix,
        name: "Status",
        unique_id: this.ThermostatID + "_status",
        device: device_payload,

        availability_topic: this.status_availability_topic,
        state_topic: this.status_topic,
        json_attributes_topic: this.status_json_attributes_topic,
    };

    if (minimized) {
        return [
            minimizeDiscoveryPayload(payload),
            minimizeDiscoveryPayload(statusPayload),
        ];
    }
    return [payload, statusPayload];
};

MqttThermostat.prototype.onConnect = async function (device) {
    this.log.debug("Connected to mqtt");

    await this.mqtt.subscribe(this.prefix + "/+/set");

    if (this.homeassistant_discovery) {
        const [payload, statusPayload] = this.generateDiscoveryPayloads();
        let payloadString = JSON.stringify(payload);

        await this.mqtt.publish(
            "homeassistant/climate/tcc2mqtt/" + this.ThermostatID + "/config",
            payloadString,
            { retain: true }
        );

        payloadString = JSON.stringify(statusPayload);

        await this.mqtt.publish(
            "homeassistant/sensor/tcc2mqtt/" + this.ThermostatID + "/config",
            payloadString,
            { retain: true }
        );

        await new Promise((r) => setTimeout(r, 1000)); // Add sleeps some home assistant can process
    }

    await this.mqtt.publish(this.status_availability_topic, "online", {
        retain: true,
    });

    await new Promise((r) => setTimeout(r, 1000));

    await this.updateStatusAsync(device, true);
};

MqttThermostat.prototype.setAvailability = async function (online, force) {
    if (this.available !== online || force) {
        const state = online ? "online" : "offline";
        this.log.debug("Setting availability to %s", state);
        await this.mqtt.publish(this.availability_topic, state, {
            retain: true,
        });
    }
    this.available = online;
};

MqttThermostat.prototype.handleMqttMessage = function (topic, message) {
    message = message.toString();
    switch (topic) {
        case this.target_temp_command_topic:
            this.setTemp(message);
            break;
        case this.mode_command_topic:
            if (this.use_auto_for_schedule_in_homekit) {
                if (message === "auto") {
                    this.setHold(this.hold_modes[0]);
                    break;
                } else if (message === "heat") {
                    this.setMode("heat");
                    this.setHold(this.hold_modes[1]);
                    break;
                }
            }
            this.setMode(message);
            break;
        case this.hold_command_topic:
            let now = Date.now();
            let secondsSinceLastSet = (now - this.away_last_set) / 1000.0;
            const minTimeBetweenSet = 0.1;
            // Home assistant is setting a hold-clear when away is being set, which is screwing it up
            if (secondsSinceLastSet > minTimeBetweenSet) {
                this.setHold(message);
            }
            break;
        default:
            this.log.info(
                "Unhandled message: " + topic + ": " + message.toString()
            );
    }
};

MqttThermostat.prototype.setTemp = function (target, permanent = undefined) {
    this.wrapper.setTargetTemperature(
        new Temperature(tryParseFloat(target), this.unit),
        (err, val) => {
            if (err) {
                this.log.err(err);
            }
        }
    );
};

MqttThermostat.prototype.setHold = function (target, lowPriority = false) {
    let index;
    if (target === "None" || target === "off") {
        index = 0;
    } else if (this.use_away_mode && target == "Away") {
        this.away_last_set = Date.now();
        this.setTemp(this.temperatureToMqtt(this.away_temperature));
        index = 2;
    } else {
        index = this.hold_modes.indexOf(target);
    }
    this.wrapper.setHoldMode(index, lowPriority, (err, val) => {
        if (err) {
            this.log.err(err);
        }
    });
};

MqttThermostat.prototype.setMode = function (target, permanent = undefined) {
    this.wrapper.setTargetHeatingCooling(
        this.state_modes.indexOf(target),
        (err, val) => {
            if (err) {
                this.log.err(err);
            }
        }
    );
};

MqttThermostat.prototype.setUnavailable = async function (message) {
    this.status_data["unavailable_details"] = message;
    const newState = { ...this.state };
    await this.setAvailability(false);
    newState[this.status_topic] = "unavailable";
    newState[this.status_json_attributes_topic] = this.status_data;
    await this.publishStateAsync(newState, true);
};

MqttThermostat.prototype.temperatureToMqtt = function (temp) {
    if (this.unit === "F") {
        return temp.F.toFixed(0);
    }
    return temp.C.toFixed(1);
};

MqttThermostat.prototype.state_mode = function (device) {
    const mappedMode = this.state_modes[device.TargetHeatingCoolingState]; // this must come first
    if (
        this.use_auto_for_schedule_in_homekit &&
        mappedMode === this.auto_for_schedule_mode
    ) {
        if (this.hold_mode(device) === this.hold_modes[2]) {
            // Permanent = heat/cool
            return this.auto_for_schedule_mode;
        }
        return "auto";
    }
    return mappedMode;
};
MqttThermostat.prototype.hold_mode = function (device) {
    switch (device.TargetHeatingCoolingState) {
        case 1: // heat
            return this.hold_modes[device.device.UI.StatusHeat];
        case 2: // cool
            return this.hold_modes[device.device.UI.StatusCool];
    }
    return this.hold_modes[0]; // schedule
};

MqttThermostat.prototype.updateStatus = function (device) {
    this.updateStatusAsync(device);
};
MqttThermostat.prototype.updateStatusAsync = async function (
    device,
    force = false
) {
    const alerts = device.device.ThermostatsAlerts;
    this.log.debug(
        "Alerts(%s): %s",
        alerts === undefined ? "u" : "",
        JSON.stringify(alerts)
    );

    const newState = {};

    let available = true;
    let status = "Okay";
    let status_json = "";
    if (alerts && Object.keys(alerts).length > 0) {
        available = false;
        if (Object.keys(alerts).length == 1) {
            if (alerts.ThermostatsAlert && alerts.ThermostatsAlert.LongText) {
                const longText = alerts.ThermostatsAlert.LongText;
                status = "Error";
                if (longText.includes("lower than the alert setting of")) {
                    status = "Low Temp";
                    available = true;
                }
                if (longText.includes("higher than the alert setting of")) {
                    status = "High Temp";
                    available = true;
                }
                if (
                    longText.startsWith(
                        "The thermostat did not acknowledge the changes submitted"
                    )
                ) {
                    status = "Change not received";
                    available = true;
                }
                if (
                    longText.startsWith(
                        "The internet connection to this thermostat was lost"
                    )
                ) {
                    status = "Internet Connection Error";
                }
                status_json = longText;
            } else {
                status = "Multiple / Unknown Erorrs";
                status_json = JSON.stringify(alerts);
            }
        }
    }

    this.status_data["error_details"] = status_json;
    this.status_data["unavailable_details"] = "";

    newState[this.status_topic] = status;
    newState[this.status_json_attributes_topic] = { ...this.status_data };

    await this.setAvailability(available);

    if (this.available) {
        newState[this.mode_state_topic] = this.state_mode(device);
        newState[this.action_topic] =
            this.action_modes[device.CurrentHeatingCoolingState];
        newState[this.target_temp_state_topic] = this.temperatureToMqtt(
            device.TargetTemperature
        );
        newState[this.current_temp_topic] = this.temperatureToMqtt(
            device.CurrentTemperature
        );
        newState[this.json_attributes_topic] = {
            hold_heat: this.hold_modes[device.device.UI.StatusHeat],
            hold_cool: this.hold_modes[device.device.UI.StatusCool],
            cooling_threshold: this.temperatureToMqtt(
                device.CoolingThresholdTemperature
            ),
            heating_threshold: this.temperatureToMqtt(
                device.HeatingThresholdTemperature
            ),
        };
        newState[this.hold_state_topic] = this.hold_mode(device);
        if (this.use_away_mode) {
            if (
                newState[this.mode_state_topic] === this.away_mode &&
                newState[this.target_temp_state_topic] ===
                    this.temperatureToMqtt(this.away_temperature) &&
                this.hold_mode(device) === this.hold_modes[2]
            ) {
                newState[this.hold_state_topic] = "Away"; // Set's hold to "None" in HA, so Away can take over
            }
        }
    }
    await this.publishStateAsync(newState, force);
};

MqttThermostat.prototype.publishStateAsync = async function (
    newState,
    force = false
) {
    const diffed = diff.diff(this.state, newState);
    if (force || !diff.isEmptyObject(diffed)) {
        for (const key in newState) {
            let value = newState[key];
            if ((force || key in diffed) && key.startsWith(this.prefix)) {
                if (typeof value === "object") {
                    value = JSON.stringify(value);
                }
                this.log.debug("Publishing %s -> %s", key, value);
                await this.mqtt.publish(key, value, { retain: true });
            }
        }

        this.state = newState;
    }
};
