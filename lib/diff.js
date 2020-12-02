module.exports = {diff: diff, isEmptyObject: isEmptyObject};

function diff(obj1, obj2) {
    var result = {};
    var change;
    for (var key in obj1) {
        if (typeof obj2[key] === 'object' && typeof obj1[key] === 'object') {
            change = diff(obj1[key], obj2[key]);
            if (isEmptyObject(change) === false) {
                result[key] = change;
            }
        } else if (obj2[key] !== obj1[key]) {
            result[key] = obj2[key];
        }
    }
    return result;
}

function isEmptyObject(obj) {
    var name;
    for (name in obj) {
        return false;
    }
    return true;
}

