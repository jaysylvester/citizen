// core framework functions that might also be of use in the app

'use strict';

var events = require('events'),
    fs = require('fs');

module.exports = {
  cache: cache,
  exists: exists,
  retrieve: retrieve,
  clear: clear,
  copy: copy,
  extend: extend,
  isNumeric: isNumeric,
  listen: listen,
  dashes: dashes
};

function cache(options) {
  var timer,
      key = options.key || options.file || options.controller || options.route || '',
      value;

  options.overwrite = options.overwrite || false;
  options.lifespan = options.lifespan || 'application';
  options.encoding = options.encoding || 'utf-8';
  options.synchronous = options.synchronous || false;
  options.directives = options.directives || {};

  if ( key.length === 0 ) {
    throw {
      thrownBy: 'helpers.cache()',
      message: 'You need to specify an absolute file path, a route name, or custom key name when saving objects to the cache.'
    };
  }

  if ( ( options.key && !options.file && !options.value ) || ( options.value && !options.key ) ) {
    throw {
      thrownBy: 'helpers.cache()',
      message: 'When using a custom key, you have to specify both a key name and value.'
    };
  }

  if ( options.controller && ( !options.context || !options.viewName || !options.view ) ) {
    throw {
      thrownBy: 'helpers.cache()',
      message: 'When caching a controller, you must specify the context, view name, and rendered view contents.'
    };
  }

  if ( options.lifespan !== 'application' && !isNumeric(options.lifespan) ) {
    throw {
      thrownBy: 'helpers.cache()',
      message: 'Cache lifespan needs to be specified in milliseconds.'
    };
  }

  if ( options.value ) {
    if ( !CTZN.cache.app[key] || ( CTZN.cache.app[key] && options.overwrite ) ) {
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          clear(key);
        }, options.lifespan);
      }
      CTZN.cache.app[key] = {
        key: key,
        // Create a copy of the content object so the cache isn't a pointer to the original
        value: copy(options.value),
        timer: timer
      };
    } else {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'An cache using the specified key [\'' + options.key + '\'] already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.'
      };
    }
  } else if ( options.file ) {
    if ( !CTZN.cache.app[key] || ( CTZN.cache.app[key] && options.overwrite ) ) {
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          clear(key);
        }, options.lifespan);
      }

      if ( options.synchronous ) {
        value = fs.readFileSync(options.file, { encoding: options.encoding });
        if ( options.parseJSON ) {
          value = JSON.parse(value);
        }
        CTZN.cache.app[key] = {
          file: options.file,
          value: value,
          timer: timer
        };
      } else {
        fs.readFile(options.file, { encoding: options.encoding }, function (err, data) {
          if ( err ) {
            throw {
              thrownBy: 'helpers.cache()',
              message: 'There was an error when attempting to read the specified file (' + key + ').'
            };
          } else {
            if ( options.parseJSON ) {
              value = JSON.parse(data);
            } else {
              value = data;
            }
            CTZN.cache.app[key] = {
              file: options.file,
              value: value,
              timer: timer
            };
          }
        });
      }
    } else {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'A cache containing the specified file [\'' + options.file + '\'] already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.'
      };
    }
  } else if ( options.controller ) {
    if ( options.route ) {
      key = options.controller + '-' + options.viewName + '-' + options.route;
    } else {
      key = options.controller + '-' + options.viewName;
    }

    if ( !CTZN.cache.controller[key] || ( CTZN.cache.controller[key] && options.overwrite ) ) {
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          clear(key, 'controller');
        }, options.lifespan);
      }

      CTZN.cache.controller[key] = {
        controller: options.controller,
        route: options.route || '',
        context: options.context,
        viewName: options.viewName,
        view: options.view,
        timer: timer,
        lifespan: options.lifespan,
        resetOnAccess: options.resetOnAccess
      };
    } else {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'A cache containing the specified route/controller/view combination already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.\n route: ' + options.route + '\n controller: ' + options.controller + '\n view: ' + options.viewName
      };
    }
  } else if ( options.route ) {
    if ( !CTZN.cache.route[key] || ( CTZN.cache.route[key] && options.overwrite ) ) {
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          clear(key, 'route');
        }, options.lifespan);
      }

      CTZN.cache.route[key] = {
        route: key,
        contentType: options.contentType,
        view: options.view,
        timer: timer
      };
    } else {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'A cache containing the specified route [\'' + options.route + '\'] already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.'
      };
    }
  }

}

function exists(key, namespace) {
  namespace = namespace || 'app';

  switch ( namespace ) {
    case 'app':
      if ( CTZN.cache.app[key] ) {
        return true;
      }
      break;
    case 'controller':
      if ( CTZN.cache.controller[key] ) {
        return true;
      }
      break;
    case 'route':
      if ( CTZN.cache.route[key] ) {
        return true;
      }
      break;
    default:
      return false;
  }

}

function retrieve(key, namespace) {
  namespace = namespace || 'app';

  switch ( namespace ) {
    case 'app':
      if ( CTZN.cache.app[key] ) {
        if ( CTZN.cache.app[key].timer && CTZN.cache.app[key].resetOnAccess ) {
          clearTimeout(CTZN.cache.app[key].timer);
          CTZN.cache.app[key].timer = setTimeout( function () {
            clear(key, 'controller');
            console.log('cache timed out: ' + key);
          }, CTZN.cache.app[key].lifespan);
        }
        return CTZN.cache.app[key].value;
      } else {
        return false;
      }
      break;
    case 'controller':
      if ( CTZN.cache.controller[key] ) {
        if ( CTZN.cache.controller[key].timer && CTZN.cache.controller[key].resetOnAccess ) {
          clearTimeout(CTZN.cache.controller[key].timer);
          CTZN.cache.controller[key].timer = setTimeout( function () {
            clear(key, 'controller');
          }, CTZN.cache.controller[key].lifespan);
        }
        return CTZN.cache.controller[key];
      } else {
        return false;
      }
      break;
    case 'route':
      if ( CTZN.cache.route[key] ) {
        if ( CTZN.cache.route[key].timer && CTZN.cache.route[key].resetOnAccess ) {
          clearTimeout(CTZN.cache.route[key].timer);
          CTZN.cache.route[key].timer = setTimeout( function () {
            clear(key, 'controller');
          }, CTZN.cache.route[key].lifespan);
        }
        return CTZN.cache.route[key];
      } else {
        return false;
      }
      break;
  }

}

function clear(key, namespace) {
  namespace = namespace || 'app';

  switch ( namespace ) {
    case 'app':
      if ( CTZN.cache.app[key] ) {
        if ( CTZN.cache.app[key].timer ) {
          clearTimeout(CTZN.cache.app[key].timer);
        }
        CTZN.cache.app[key] = undefined;
      }
      break;
    case 'controller':
      if ( CTZN.cache.controller[key] ) {
        if ( CTZN.cache.controller[key].timer ) {
          clearTimeout(CTZN.cache.controller[key].timer);
        }
        CTZN.cache.controller[key] = undefined;
      }
      break;
    case 'route':
      if ( CTZN.cache.route[key] ) {
        if ( CTZN.cache.route[key].timer ) {
          clearTimeout(CTZN.cache.route[key].timer);
        }
        CTZN.cache.route[key] = undefined;
      }
      break;
  }
}

// The copy() and getValue() functions were inspired by (meaning mostly stolen from)
// Andrée Hanson:
// http://andreehansson.se/

function copy(object) {
  var objectCopy = {};

  if ( typeof object !== 'undefined' && object.constructor.toString().indexOf('Array') >= 0 ) {
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

  if ( typeof object !== 'undefined' && object !== null ) {
    isArray = object.constructor.toString().indexOf('Array') >= 0;
    isObject = object.constructor.toString().indexOf('Object') >= 0;
  } else if ( object === null ) {
    object = null;
  } else {
    object = undefined;
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

        if ( allReady ) {
          output.listen.success = true;

          if ( typeof callback === 'function' ) {
            callback(output);
          } else {
            return output;
          }
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
        emitter = undefined;
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
