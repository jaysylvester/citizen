// core framework functions that might also be of use in the app

'use strict';
/* jshint node: true */
/* global CTZN: false */

var events = require('events'),
    fs = require('fs'),
    util = require('util');

module.exports = {
  copy: copy,
  extend: extend,
  isNumeric: isNumeric,
  listen: listen,
  // log: log
};

// The copy() and getValue() functions were inspired by (meaning mostly stolen from)
// Andrée Hanson:
// http://andreehansson.se/

function copy(object) {
  var objectCopy = {};

  for ( var property in object ) {
    if ( object.hasOwnProperty(property) ) {
      objectCopy[property] = getValue(object[property]);
    }
  }

  return objectCopy;
}

function extend(original, extension, copyObject) {
  var mergedObject,
      combinedArray = [],
      combinedArrayLength;

  copyObject = typeof copyObject !== 'undefined' ? copyObject : true;

  if ( copyObject ) {
    mergedObject = copy(original);
  } else {
    mergedObject = original;
  }

  if ( !extension ) {
    return mergedObject;
  }

  // for ( var property in extension ) {
  //   if ( extension[property].constructor === Object && extension.hasOwnProperty(property) ) {
  //     mergedObject[property] = extend(mergedObject[property], getValue(extension[property]), copyObject);
  //   } else if ( extension[property].constructor === Array && mergedObject[property] && mergedObject[property].constructor === Array ) {
  //     mergedObject[property].forEach( function (item, index, array) {
  //       combinedArray[index] = getValue(item);
  //     });
  //     combinedArrayLength = combinedArray.length;
  //     extension[property].forEach( function (item, index, array) {
  //       combinedArray[combinedArrayLength + index] = getValue(item);
  //     });
  //     mergedObject = combinedArray;
  //   } else {
  //     mergedObject[property] = getValue(extension[property]);
  //   }
  // }

  for ( var property in extension ) {
    if ( extension[property].constructor === Object && extension.hasOwnProperty(property) ) {
      if ( extension.hasOwnProperty(property) ) {
        mergedObject[property] = extend(mergedObject[property], getValue(extension[property]), copyObject);
      }
    } else {
      mergedObject[property] = getValue(extension[property]);
    }
  }

  return mergedObject;
}

function getValue(object) {
  var isArray,
      isObject,
      val,
      i = 0,
      l;

  if ( typeof object !== 'undefined' ) {
    isArray = object.constructor.toString().indexOf('Array') >= 0;
    isObject = object.constructor.toString().indexOf('Object') >= 0;
  } else {
    object = 'undefined';
  }

  if ( isArray ) {
    val = Array.prototype.slice.apply(object);
    l = val.length;

    do {
      val[i] = getValue(val[i]);
    } while (++i < l);
  } else if ( isObject ) {
    val = copy(object);
  } else {
    val = object;
  }

  return val;
}

function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

function listen(functions, callback) {
  var emitter = {},
    output = {
      listener: {
        success: false
      }
    },
    ready = {},
    groupTracker = function () {
      var allReady = true;

      for ( var property in ready ) {
        if ( ready[property] === false ) {
          allReady = false;
          break;
        }
      }

      if ( allReady && typeof callback === 'function' ) {
        output.listener.success = true;
        callback(output);
      }
    };

  if ( Object.getOwnPropertyNames(functions).length > 0 ) {
    for ( var property in functions ) {
      ready[property] = false;
    }
    for ( var property in functions ) {
      emitter = new events.EventEmitter();
      emitter.name = property;
      emitter.timer = setTimeout( function () {
        emitter.emit('timeout');
      }, CTZN.config.citizen.requestTimeout);
      emitter.on('ready', function (result) {
        clearTimeout(this.timer);
        ready[this.name] = true;
        output[this.name] = result || '';
        groupTracker();
      });
      emitter.on('timeout', function () {
        if ( typeof callback === 'function' ) {
          output.listener.message = this.name + ' has timed out.';
          output.listener.completed = ready;
          callback(output);
        }
        throw 'Error in citizen helper.js: ' + this.name + ' has timed out.';
      });
      functions[property](emitter);
    }
  } else {
    throw 'Error in citizen helper.js: listener() requires at least one function';
  }
}

// function log(content) {
//
// };
