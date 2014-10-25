// core framework functions that might also be of use in the app

'use strict';

var events = require('events');

module.exports = {
  copy: copy,
  extend: extend,
  isNumeric: isNumeric,
  listen: listen,
  dashes: dashes
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

function extend(original, extension) {
  var mergedObject = copy(original);

  extension = extension || {};

  for ( var property in extension ) {
    if ( extension[property] && extension[property].constructor === Object && extension.hasOwnProperty(property) ) {
      mergedObject[property] = extend(mergedObject[property], getValue(extension[property]));
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
        listen: {
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
          output.listen.success = true;
          callback(output);
        }
      };

  if ( Object.getOwnPropertyNames(functions).length > 0 ) {
    for ( var property in functions ) {
      ready[property] = false;
    }
    for ( property in functions ) {
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
          output.listen.message = this.name + ' has timed out.';
          output.listen.completed = ready;
          callback(output);
        }
        throw {
          thrownBy: 'helpers.listen()',
          message: 'Error in citizen helpers.js: ' + this.name + ' has timed out.'
        };
      });
      functions[property](emitter);
    }
  } else {
    throw {
      thrownBy: 'helpers.listen()',
      message: 'The listen() function received no function argument. It requires at least one function passed as an argument.'
    };
  }
}

function dashes(text) {
  var parsedText = text.trim();

  parsedText = parsedText.replace(/&quot;/g, '-');
  parsedText = parsedText.replace(/\./g, '');
  parsedText = parsedText.replace(/'/g, '');
  parsedText = parsedText.replace(/[^0-9A-Za-z]/g, '-');

  if ( parsedText.replace(/-/g, '').length > 0 ) {
    while ( parsedText.search(/--/) >= 0 ) {
      parsedText = parsedText.replace(/--/g, '-');
    }
  } else {
    parsedText = 'Untitled';
  }

  return parsedText;
}
