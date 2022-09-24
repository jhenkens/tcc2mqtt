master_room = `
{
    "ThermostatID": 1234555,
    "Name": "MASTER ROOM",
    "Model": "Saratoga",
    "CurrentTemperature": {
      "F": 60,
      "C": 15.555555555555555
    },
    "TargetTemperature": {
      "F": 50,
      "C": 10
    },
    "HeatingThresholdTemperature": {
      "F": 50,
      "C": 10
    },
    "CoolingThresholdTemperature": {
      "F": 50,
      "C": 10
    },
    "CurrentHeatingCoolingState": 0,
    "TargetHeatingCoolingState": 1,
    "TargetHeatingCoolingStateValidValues": [
      0,
      1
    ],
    "TargetTemperatureHeatMinValue": {
      "F": 40,
      "C": 4.444444444444445
    },
    "TargetTemperatureHeatMaxValue": {
      "F": 90,
      "C": 32.22222222222222
    },
    "TargetTemperatureCoolMinValue": {
      "F": 50,
      "C": 10
    },
    "TargetTemperatureCoolMaxValue": {
      "F": 99,
      "C": 37.22222222222222
    },
    "device": {
      "ThermostatID": 2890555,
      "MacID": "00D02DD4825E",
      "DomainID": 44449,
      "Instance": 0,
      "DeviceName": "MASTER ROOM",
      "UserDefinedDeviceName": "MASTER ROOM",
      "Upgrading": false,
      "ThermostatsAlerts": {},
      "UI": {
        "Created": "2022-09-24T12:29:39",
        "ThermostatLocked": false,
        "OutdoorTemp": 58,
        "DispTemperature": 60,
        "HeatSetpoint": 50,
        "CoolSetpoint": 50,
        "DisplayedUnits": "F",
        "StatusHeat": 2,
        "StatusCool": 2,
        "HoldUntilCapable": true,
        "ScheduleCapable": true,
        "VacationHold": 0,
        "DualSetpointStatus": false,
        "HeatNextPeriod": 30,
        "CoolNextPeriod": 30,
        "HeatLowerSetptLimit": 40,
        "HeatUpperSetptLimit": 90,
        "CoolLowerSetptLimit": 50,
        "CoolUpperSetptLimit": 99,
        "SchedHeatSp": 55,
        "SchedCoolSp": 82,
        "SystemSwitchPosition": 1,
        "CanSetSwitchAuto": false,
        "CanSetSwitchCool": false,
        "CanSetSwitchOff": true,
        "CanSetSwitchHeat": true,
        "CanSetSwitchEmergencyHeat": false,
        "CanSetSwitchSouthernAway": false,
        "Deadband": 0,
        "OutdoorHumidity": 48,
        "IndoorHumidity": 31,
        "Commercial": false,
        "SystemSwitchChangeSource": {
          "PartnerName": "TCC"
        },
        "HeatSetpointChangeSource": {
          "PartnerName": "TCC"
        },
        "CoolSetpointChangeSource": {
          "PartnerName": "TCC"
        }
      },
      "Fan": {
        "CanControl": false,
        "Position": "Auto",
        "CanSetAuto": false,
        "CanSetCirculate": false,
        "CanFollowSchedule": false,
        "CanSetOn": false,
        "IsFanRunning": {
          "xsi:nil": true
        }
      },
      "Humidification": {
        "CanControlHumidification": false,
        "CanControlDehumidification": false,
        "HumidificationSetPoint": 35,
        "HumidificationUpperLimit": 60,
        "HumidificationLowerLimit": 10,
        "HumidificationMode": "Off",
        "DehumidificationSetPoint": 50,
        "DehumidificationUpperLimit": 80,
        "DehumidificationLowerLimit": 40,
        "DehumidificationMode": "Off",
        "Deadband": 255
      },
      "EquipmentStatus": "Off",
      "CanControlSchedule": true,
      "WillSupportSchedule": false,
      "ModelTypeID": 21,
      "ModelTypeName": "Saratoga"
    }
  }
  `

config = `
{
    "mqtt": {
      "url": "mqtt://mosquitto",
      "username": "ha",
      "password": "testpass"
    },
    "username": "test@email.com",
    "password": "pass1234",
    "min_temp": 50,
    "max_temp": 80,
    "temperature_unit": "F",
    "homeassistant_discovery": true,
    "use_away_mode": true,
    "away_temperature": 50,
    "away_heat_cool_mode": "heat",
    "use_auto_for_schedule_in_homekit": true,
    "refresh": 450,
    "logLevel": "info",
    "debug": false
  }
`

module.exports = {
    sample_thermostat: JSON.parse(master_room), 
    sample_config: JSON.parse(config),
}