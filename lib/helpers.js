// core framework functions that might also be of use in the app

'use strict';

var events = require('events'),
    fs = require('fs'),
    http = require('http'),
    util = require('util');

module.exports = {
  copy: copy,
  extend: extend,
  isNumeric: isNumeric,
  listen: listen,
  log: log,
  size: size
};



// The copy() and getValue() functions were inspired by (meaning mostly stolen from)
// Andrée Hanson:
// http://andreehansson.se/

function copy(object) {
  var objectCopy = {};

  if ( typeof object !== 'undefined' && object !== null && object.constructor !== Object ) {
    objectCopy = getValue(object);
  } else {
    for ( var property in object ) {
      if ( object.hasOwnProperty(property) ) {
        objectCopy[property] = getValue(object[property]);
      }
    }
  }

  return objectCopy;
}



function extend(original, extension) {
  var mergedObject = copy(original);

  extension = extension || {};

  for ( var property in extension ) {
    if ( extension.hasOwnProperty(property) ) {
      if ( typeof extension[property] === 'undefined' || extension[property] === null || extension[property].constructor !== Object ) {
        mergedObject[property] = getValue(extension[property]);
      } else {
        mergedObject[property] = extend(mergedObject[property], getValue(extension[property]));
      }
    }
  }

  return mergedObject;
}



function getValue(object) {
  var val,
      i = 0,
      l;

  if ( typeof object === 'undefined' || object === null ) {
    val = object;
  } else if ( object.constructor === Array ) {
    val = Array.prototype.slice.apply(object);
    l = val.length;

    do {
      val[i] = getValue(val[i]);
    } while (++i < l);
  } else if ( object.constructor === Object ) {
    val = copy(object);
  } else {
    val = object;
  }

  return val;
}



function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}



function listen(flow, functions, callback) {
  var createEmitter,
      groupTracker,
      methods,
      status = {},
      output = {
        listen: {
          success: false
        }
      },
      i;

  if ( arguments.length < 3 ) {
    if ( arguments.length === 1 ) {
      flow = 'parallel';
      functions = arguments[0];
    } else if ( arguments.length === 2 && typeof arguments[0] !== 'string' ) {
      flow = 'parallel';
      functions = arguments[0];
      callback = arguments[1];
    }
  }

  createEmitter = function (method, index) {
    var emitter = new events.EventEmitter(),
        argsLength = arguments.length,
        nextIndex = index + 1;

    if ( method === 'listen' ) {
      throw new Error('The property name "listen" is reserved because it contains the status of the listen() method in the output (output.listen). Please choose a different property name.');
    }

    status[method] = 'waiting';

    emitter.name = method;
    emitter.timer = setTimeout( function () {
      emitter.emit('timeout');
    }, CTZN.config.citizen.requestTimeout);


    emitter.on('ready', function (result) {

      clearTimeout(this.timer);

      status[this.name] = 'ready';
      output[this.name] = result;
      output.listen.status = status;

      groupTracker(status);

      if ( argsLength === 2 && methods[nextIndex] ) {

        status[methods[nextIndex].name] = 'called';

        switch ( flow ) {
          case 'series':
            methods[nextIndex].method(createEmitter(methods[nextIndex].name, nextIndex));
            break;
          case 'waterfall':
            methods[nextIndex].method(output, createEmitter(methods[nextIndex].name, nextIndex));
            break;
        }

      }

    });


    // skip and end are for series and waterfall flows only
    if ( flow === 'series' || flow === 'waterfall' ) {

      // Skips the next method in the chain (series/waterfall only)
      emitter.on('skip', function (result) {
        var skipTo = nextIndex + 1;

        clearTimeout(this.timer);

        status[this.name] = 'ready';
        output[this.name] = result;
        output.listen.status = status;

        groupTracker(status);

        if ( argsLength === 2 && methods[nextIndex] ) {

          status[methods[nextIndex].name] = 'skipped';
          output.listen.status = status;

          groupTracker(status);

          if ( methods[skipTo] ) {

            switch ( flow ) {
              case 'series':
                methods[skipTo].method(createEmitter(methods[skipTo].name, skipTo));
                break;
              case 'waterfall':
                methods[skipTo].method(output, createEmitter(methods[skipTo].name, skipTo));
                break;
            }

          }

        }

      });

      // Skips all remaining methods and fires the callback (series/waterfall only)
      emitter.on('end', function (result) {

        clearTimeout(this.timer);

        status[this.name] = 'ready';
        output[this.name] = result;

        for ( var prop in status ) {
          if ( status[prop] === 'waiting' ) {
            status[prop] = 'skipped';
          }
        }

        output.listen.status = status;

        groupTracker(status);

      });

    } else {
      emitter.on('skip', function () {
        throw new Error('When using listen(), the "skip" event can only be emitted when using series or waterfall flow control.');
      });
      emitter.on('end', function () {
        throw new Error('When using listen(), the "end" event can only be emitted when using series or waterfall flow control.');
      });
    }


    // Emitted automatically if the timer expires on a method
    emitter.on('timeout', function () {

      status[this.name] = 'timeout';
      output.listen.status = status;
      output.listen.code = 'CTZN_LISTEN_TIMEOUT';
      output.listen.errno = '';
      output.listen.statusCode = 500;
      output.listen.message = 'The ' + this.name + '() method in your listen() function has timed out.';
      output.listen.status = status;

      groupTracker(status);

    });


    // Throws an error (non-fatal because it's intercepted by the framework)
    emitter.on('error', function (error) {

      clearTimeout(this.timer);

      error = error || {};
      status[this.name] = 'error';
      output[this.name] = error;
      output.listen.code = error.code;
      output.listen.errno = error.errno;
      output.listen.statusCode = error.statusCode || 500;
      output.listen.message = error.message || http.STATUS_CODES[output.listen.statusCode];
      output.listen.stack = error.stack;
      output.listen.status = status;

      groupTracker(status);

      throw new Error(output.listen.message);

    });

    return emitter;
  };


  groupTracker = function (status) {
    var allReady = true,
        success = true;

    switch ( flow ) {
      case 'parallel':
        for ( var prop in status ) {
          if ( status[prop] === 'error' || status[prop] === 'timeout' ) {
            success = false;
            break;
          }
        }
        for ( var propp in status ) {
          if ( status[propp] === 'waiting' || status[propp] === 'called' ) {
            allReady = false;
            break;
          }
        }
        break;
      case 'series':
      case 'waterfall':
        for ( var proppp in status ) {
          if ( status[proppp] === 'error' || status[proppp] === 'timeout' ) {
            success = false;
            for ( var propppp in status ) {
              if ( status[propppp] === 'waiting' || status[propppp] === 'called' ) {
                status[propppp] = 'skipped';
              }
            }
            break;
          } else if ( status[proppp] === 'waiting' || status[proppp] === 'called' ) {
            allReady = false;
            break;
          }
        }
        break;
    }


    if ( allReady ) {

      output.listen.success = success;

      if ( typeof callback === 'function' ) {
        callback(output);
      } else {
        return output;
      }
    }
  };


  if ( size(functions) ) {
    for ( var property in functions ) {
      if ( functions.hasOwnProperty(property) ) {
        status[property] = 'waiting';
      }
    }

    switch ( flow ) {
      case 'parallel':
        for ( property in functions ) {
          if ( functions.hasOwnProperty(property) ) {
            functions[property](createEmitter(property));
          }
        }
        break;
      case 'series':
      case 'waterfall':
        methods = [];
        i = 0;

        for ( property in functions ) {
          if ( functions.hasOwnProperty(property) ) {
            methods[i] = {
              name: property,
              method: functions[property]
            };
            i += 1;
          }
        }

        methods[0].method(createEmitter(methods[0].name, 0));
        break;
    }

  } else {
    throw new Error('app.listen(): The listen() function received no function argument(s). It requires at least one function passed as an argument.');
  }
}



function log(options) {
  var label = options.label || '',
      content = options.content,
      toConsole = options.toConsole || CTZN.config.citizen.log.toConsole || CTZN.config.citizen.mode === 'debug',
      toFile = options.toFile || CTZN.config.citizen.log.toFile,
      file = options.file || CTZN.config.citizen.log.defaultFile,
      time,
      logItem;

  if ( toConsole || toFile ) {
    if ( options.timestamp === false ) {
      logItem = label;
    } else {
      time = new Date();
      logItem = '[' + time.toISOString() + '] ' + label;
    }

    if ( label.length ) {
      logItem += ': ';
    }

    switch ( typeof content ) {
      case 'string':
        if ( content.length ) {
          logItem += content + '\n';
        } else {
          logItem += '(empty string)\n';
        }
        break;
      case 'number':
        logItem += content + '\n';
        break;
      default:
        logItem += '\n' + util.inspect(content, { depth: CTZN.config.citizen.debug.depth }) + '\n';
        break;
    }

    if ( toConsole ) {
      console.log(logItem);
    }

    if ( toFile ) {
      fs.appendFile(CTZN.config.citizen.log.path + '/' + file, logItem + '\n', function (err) {
        if ( err ) {
          switch ( err.code ) {
            case 'ENOENT':
              console.log('Error in app.log(): Unable to write to the log file because the specified log file path (' + CTZN.config.citizen.log.path + ') doesn\'t exist.');
              break;
            default:
              console.log('Error in app.log(): There was a problem writing to the log file (' + CTZN.config.citizen.log.path + '/' + file + ')');
              console.log(err);
              break;
          }
        }
      });
    }
  }
}



function size(object) {
  var count = 0;

  if ( object && typeof object === 'object' ) {
    for ( var property in object ) {
      if ( object.hasOwnProperty(property) ) {
        count += 1;
      }
    }
    return count;
  } else {
    throw new Error('app.size(): The supplied argument is not an object literal. size() only accepts object literals as arguments.');
  }
}
