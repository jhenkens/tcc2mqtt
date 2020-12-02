module.exports = Temperature;

function Temperature(value,unit) {
    if(isNaN(value) || value === null || value === undefined){
        throw new Error("Value must be provided");
    }
    value = parseFloat(value);
    if(unit === 'F'){
        this.F = value;
        this.C = (value - 32) * 5 / 9;
    }else if(unit === 'C'){
        this.C = value;
        this.F = (value * 9 / 5) + 32;
    }else{
        throw new Error("Unrecognized unit for Temperature: " + unit);
    }
}
