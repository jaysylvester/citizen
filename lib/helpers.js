// core framework functions that might also be of use in the app

'use strict';

var events = require('events'),
    fs = require('fs'),
    util = require('util');

module.exports = {
  public: {
    cache: cache,
    exists: exists,
    retrieve: retrieve,
    clear: clear,
    copy: copy,
    extend: extend,
    isNumeric: isNumeric,
    listen: listen,
    dashes: dashes,
    size: size,
    log: log
  },
  citizen: {
    cacheController: cacheController,
    cacheRoute: cacheRoute,
    retrieveController: retrieveController
  }
};



function cache(options) {
  var timer,
      scope = options.scope || 'app',
      key = options.key || options.file,
      value,
      enableCache = CTZN.config.citizen.mode !== 'debug' || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache ) ? true : false;

  if ( enableCache ) {
    options.overwrite = options.overwrite || false;
    options.lifespan = options.lifespan || 'application';
    options.resetOnAccess = options.resetOnAccess || false;
    options.encoding = options.encoding || 'utf-8';
    options.synchronous = options.synchronous || false;

    if ( scope !== 'controllers' && scope !== 'routes' ) {
      CTZN.cache[scope] = CTZN.cache[scope] || {};
    } else {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'The terms "controllers" and "routes" are reserved cache scope names. Please choose a different name for your custom cache scope.'
      };
    }

    if ( !key ) {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'You need to specify a key name or an absolute file path when saving objects to the cache.'
      };
    }

    if ( ( options.key && !options.file && !options.value ) || ( options.value && !options.key ) ) {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'When using a custom key, you have to specify both a key name and value.'
      };
    }

    if ( options.lifespan !== 'application' && !isNumeric(options.lifespan) ) {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'Cache lifespan needs to be specified in milliseconds.'
      };
    }

    if ( options.resetOnAccess && options.lifespan === 'application' ) {
      throw {
        thrownBy: 'helpers.cache()',
        message: 'For the resetOnAccess option to work correctly, you must specify the lifespan option in milliseconds.'
      };
    }

    // If a value is provided, it's a straight dump into the cache
    if ( options.value ) {
      if ( !CTZN.cache[scope][key] || ( CTZN.cache[scope][key] && options.overwrite ) ) {
        if ( options.lifespan !== 'application' ) {
          timer = setTimeout( function () {
            clear({ scope: scope, key: key });
            log({
              label: scope + ' cache item timeout',
              content: key,
              file: 'citizen.txt'
            });
          }, options.lifespan);
        }
        CTZN.cache[scope][key] = {
          key: key,
          scope: scope,
          // Create a copy of the content object so the cache isn't a pointer to the original
          value: copy(options.value),
          timer: timer,
          lifespan: options.lifespan,
          resetOnAccess: options.resetOnAccess
        };
        log({
          label: 'cached',
          content: {
            key: key,
            scope: scope,
            lifespan: options.lifespan,
            resetOnAccess: options.resetOnAccess
          },
          file: 'citizen.txt'
        });
      } else {
        throw {
          thrownBy: 'helpers.cache()',
          message: 'An cache item using the specified key [\'' + options.key + '\'] already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.'
        };
      }
    // If a file path is provided, we need to read the file and perhaps parse it
    } else if ( options.file ) {
      if ( !CTZN.cache[scope][key] || ( CTZN.cache[scope][key] && options.overwrite ) ) {
        if ( options.lifespan !== 'application' ) {
          timer = setTimeout( function () {
            clear({ scope: scope, key: key });
            log({
              label: 'file cache timeout',
              content: key,
              file: 'citizen.txt'
            });
          }, options.lifespan);
        }

        if ( options.synchronous ) {
          value = fs.readFileSync(options.file, { encoding: options.encoding });
          if ( options.parseJSON ) {
            value = JSON.parse(value);
          }
          CTZN.cache[scope][key] = {
            file: options.file,
            key: key,
            scope: scope,
            value: value,
            timer: timer,
            lifespan: options.lifespan,
            resetOnAccess: options.resetOnAccess
          };
          log({
            label: 'file cached',
            content: {
              file: options.file,
              key: key,
              scope: scope,
              lifespan: options.lifespan,
              resetOnAccess: options.resetOnAccess
            },
            file: 'citizen.txt'
          });
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
              CTZN.cache[scope][key] = {
                file: options.file,
                key: key,
                scope: scope,
                value: value,
                timer: timer,
                lifespan: options.lifespan,
                resetOnAccess: options.resetOnAccess
              };
              log({
                label: 'file cached',
                content: {
                  file: options.file,
                  key: key,
                  scope: scope,
                  value: options.value,
                  lifespan: options.lifespan,
                  resetOnAccess: options.resetOnAccess
                },
                file: 'citizen.txt'
              });
            }
          });
        }
      } else {
        throw {
          thrownBy: 'helpers.cache()',
          message: 'A cache item containing the specified file [\'' + options.file + '\'] already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.'
        };
      }
    }
  }
}



function cacheController(options) {
  var timer,
      enableCache = CTZN.config.citizen.mode !== 'debug' || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache ) ? true : false;

  if ( enableCache ) {
    CTZN.cache.controllers = CTZN.cache.controllers || {};
    CTZN.cache.controllers[options.controller] = CTZN.cache.controllers[options.controller] || {};
    CTZN.cache.controllers[options.controller][options.action] = CTZN.cache.controllers[options.controller][options.action] || {};
    CTZN.cache.controllers[options.controller][options.action][options.view] = CTZN.cache.controllers[options.controller][options.action][options.view] || {};

    if ( !CTZN.cache.controllers[options.controller][options.action][options.view][options.route] || options.overwrite ) {
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          clear({
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: options.route
          });
          log({
            label: 'controller cache timeout',
            content: {
              controller: options.controller,
              action: options.action,
              view: options.view,
              route: options.route
            },
            file: 'citizen.txt'
          });
        }, options.lifespan);
      }

      CTZN.cache.controllers[options.controller][options.action][options.view][options.route] = {
        controller: options.controller,
        action: options.action,
        view: options.view,
        route: options.route,
        context: options.context,
        render: options.render,
        timer: timer,
        lifespan: options.lifespan,
        resetOnAccess: options.resetOnAccess
      };

      log({
        label: 'controller cached',
        content: {
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route,
          lifespan: options.lifespan,
          resetOnAccess: options.resetOnAccess
        },
        file: 'citizen.txt'
      });
    } else {
      throw {
        thrownBy: 'helpers.cacheController()',
        message: 'A cache item containing the specified controller/action/view/route combination already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.\n controller: ' + options.controller + '\n action: ' + options.action + '\n view: ' + options.view + '\n route: ' + options.route
      };
    }
  }
}



function cacheRoute(options) {
  var timer,
      enableCache = CTZN.config.citizen.mode !== 'debug' || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache ) ? true : false;

  if ( enableCache ) {
    CTZN.cache.routes = CTZN.cache.routes || {};

    if ( !CTZN.cache.routes[options.route] || ( CTZN.cache.routes[options.route] && options.overwrite ) ) {
      if ( options.lifespan && options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          clear({ route: options.route });
          log({
            label: 'route cache timeout',
            content: options.route,
            file: 'citizen.txt'
          });
        }, options.lifespan);
      }

      CTZN.cache.routes[options.route] = {
        route: options.route,
        contentType: options.contentType,
        view: options.view,
        timer: timer,
        lifespan: options.lifespan,
        resetOnAccess: options.resetOnAccess
      };

      log({
        label: 'route cached',
        content: {
          route: options.route,
          contentType: options.contentType,
          lifespan: options.lifespan,
          resetOnAccess: options.resetOnAccess
        },
        file: 'citizen.txt'
      });
    } else {
      throw {
        thrownBy: 'helpers.cacheRoute()',
        message: 'A cache containing the specified route [\'' + options.route + '\'] already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.'
      };
    }
  }
}



function exists(options) {
  // If both a scope and key are provided, check the scope for the specified key
  if ( options.key && options.scope ) {
    if ( CTZN.cache[options.scope] && CTZN.cache[options.scope][options.key] ) {
      return true;
    }
  // If only a key is provided, check the app scope (default) for the specified key
  } else if ( options.key ) {
    if ( CTZN.cache.app[options.key] ) {
      return true;
    }
  // If only a scope is provided, check if the specified scope has members
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] && size(CTZN.cache[options.scope]) ) {
      return true;
    }
  // If a controller, action, and view are provided, check if the controllers scope
  // has that view
  } else if ( options.controller && options.action && options.view && options.route ) {
    if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
      return true;
    }
  // If a controller and action are provided, check if the controllers scope has them
  } else if ( options.controller && options.action ) {
    if ( CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && size(CTZN.cache.controllers[options.controller][options.action]) ) {
      return true;
    }
  // If only a controller is provided, check if the controllers scope has it
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers[options.controller] && size(CTZN.cache.controllers[options.controller]) ) {
      return true;
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw {
      thrownBy: 'helpers.exists()',
      message: 'Missing arguments. You must provide a cache key, cache scope, or both options.'
    };
  }

  return false;
}



function retrieve(options) {
  var scope = options.scope || 'app',
      resetOnAccess,
      matchingKeys = {};

  // Return the provided key from the specified scope. This first condition matches
  // the following:
  // 1. Only a key has been provided
  // 2. A key and a custom scope have been provided
  if ( options.key ) {
    if ( CTZN.cache[scope] && CTZN.cache[scope][options.key] ) {

      // Reset the timer (or don't) based on the provided option. If the option isn't
      // provided, use the stored resetOnAccess value.
      resetOnAccess = options.resetOnAccess || CTZN.cache[scope][options.key].resetOnAccess;

      if ( CTZN.cache[scope][options.key].timer && resetOnAccess ) {
        clearTimeout(CTZN.cache[scope][options.key].timer);

        CTZN.cache[scope][options.key].timer = setTimeout( function () {
          clear({ scope: scope, key: options.key });
          log({
            label: 'cache timeout',
            content: options,
            file: 'citizen.txt'
          });
        }, CTZN.cache[scope][options.key].lifespan);

        log({
          label: 'cache timer reset',
          content: options,
          file: 'citizen.txt'
        });
      }

      log({
        label: 'cache retrieval',
        content: options,
        file: 'citizen.txt'
      });

      if ( scope === 'routes' ) {
        return CTZN.cache[scope][options.key];
      } else {
        return CTZN.cache[scope][options.key].value;
      }
    }
  // If only a scope is provided, return the entire scope if it exists and it has
  // members, resetting the cache timer on each key if required
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] && size(CTZN.cache[options.scope]) ) {
      matchingKeys[options.scope] = {};

      for ( var key in CTZN.cache[options.scope] ) {
        if ( CTZN.cache[options.scope].hasOwnProperty(key) ) {
          // Reset the timer (or don't) based on the provided option. If the option isn't
          // provided, use the stored resetOnAccess value.
          resetOnAccess = options.resetOnAccess || CTZN.cache[scope][key].resetOnAccess;

          matchingKeys[options.scope][key] = retrieve({ scope: options.scope, key: key, resetOnAccess: resetOnAccess });
        }
      }
    }

    if ( size(matchingKeys) ) {
      log({
        label: 'cache retrieval',
        content: options,
        file: 'citizen.txt'
      });
      return matchingKeys;
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw {
      thrownBy: 'helpers.retrieve()',
      message: 'Missing arguments. You must provide a cache key, cache scope, or both options.'
    };
  }

  return false;
}



function retrieveController(options) {
  var resetOnAccess;

  if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
    resetOnAccess = options.resetOnAccess || CTZN.cache.controllers[options.controller][options.action][options.view][options.route].resetOnAccess;

    if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer && resetOnAccess ) {
      clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer);

      CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer = setTimeout( function () {
        clear({
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route
        });
        log({
          label: 'cache timeout',
          content: {
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: options.route,
            lifespan: options.lifespan,
            resetOnAccess: resetOnAccess
          },
          file: 'citizen.txt'
        });
      }, CTZN.cache.controllers[options.controller][options.action][options.view][options.route].lifespan);

      log({
        label: 'cache timer reset',
        content: {
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route,
          lifespan: options.lifespan,
          resetOnAccess: resetOnAccess
        },
        file: 'citizen.txt'
      });
    }

    log({
      label: 'cache retrieval',
      content: {
        controller: options.controller,
        action: options.action,
        view: options.view,
        route: options.route,
        lifespan: options.lifespan,
        resetOnAccess: options.resetOnAccess
      },
      file: 'citizen.txt'
    });
    return CTZN.cache.controllers[options.controller][options.action][options.view][options.route];
  }
}



function clear(options) {
  var scope = options.scope || 'app';

  // If only a key is provided, remove that key from the app scope
  if ( options.key && scope === 'app' ) {
    if ( CTZN.cache[scope] && CTZN.cache[scope][options.key] ) {
      if ( CTZN.cache[scope][options.key].timer ) {
        clearTimeout(CTZN.cache[scope][options.key].timer);
      }
      CTZN.cache[scope][options.key] = null;
      log({
        label: scope + ' cache item cleared',
        content: options,
        file: 'citizen.txt'
      });
    }
  // If a controller name is provided, clear the controller scope based on the
  // optionally provided action and view
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] ) {
      if ( options.action && options.view && options.route ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
          if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer ) {
            clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer);
          }
          CTZN.cache.controllers[options.controller][options.action][options.view][options.route] = null;
          log({
            label: options.controller + '/' + options.action + '/' + options.view + '/' + options.route + ' controller/action/view/route cache cleared',
            content: options,
            file: 'citizen.txt'
          });
        }
      } else if ( options.action && options.view ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] ) {
          for ( var route in CTZN.cache.controllers[options.controller][options.action][options.view] ) {
            if ( CTZN.cache.controllers[options.controller][options.action][options.view].hasOwnProperty(route) ) {
              if ( CTZN.cache.controllers[options.controller][options.action][options.view][route].timer ) {
                clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][route].timer);
              }
            }
          }
          CTZN.cache.controllers[options.controller][options.action][options.view] = null;
          log({
            label: options.controller + '/' + options.action + '/' + options.view + ' controller/action/view cache cleared',
            content: options,
            file: 'citizen.txt'
          });
        }
      } else if ( options.action ) {
        if ( CTZN.cache.controllers[options.controller][options.action] ) {
          for ( var view in CTZN.cache.controllers[options.controller][options.action] ) {
            if ( CTZN.cache.controllers[options.controller][options.action].hasOwnProperty(view) ) {
              for ( var viewRoute in CTZN.cache.controllers[options.controller][options.action][view] ) {
                if ( CTZN.cache.controllers[options.controller][options.action][view].hasOwnProperty(viewRoute) ) {
                  if ( CTZN.cache.controllers[options.controller][options.action][view][viewRoute].timer ) {
                    clearTimeout(CTZN.cache.controllers[options.controller][options.action][view][viewRoute].timer);
                  }
                }
              }
            }
          }
          CTZN.cache.controllers[options.controller][options.action] = null;
          log({
            label: options.controller + ' controller and ' + options.action + ' action cache cleared',
            content: options,
            file: 'citizen.txt'
          });
        }
      } else {
        for ( var action in CTZN.cache.controllers[options.controller] ) {
          if ( CTZN.cache.controllers[options.controller].hasOwnProperty(action) ) {
            for ( var actionView in CTZN.cache.controllers[options.controller][action] ) {
              if ( CTZN.cache.controllers[options.controller][action].hasOwnProperty(actionView) ) {
                for ( var viewRouteB in CTZN.cache.controllers[options.controller][action][actionView] ) {
                  if ( CTZN.cache.controllers[options.controller][action][actionView].hasOwnProperty(viewRouteB) ) {
                    if ( CTZN.cache.controllers[options.controller][action][actionView][viewRouteB].timer ) {
                      clearTimeout(CTZN.cache.controllers[options.controller][action][actionView][viewRouteB].timer);
                    }
                  }
                }
              }
            }
          }
        }
        log({
          label: options.controller + ' controller cache cleared',
          content: options,
          file: 'citizen.txt'
        });
      }
    }
  // If only a scope is provided, clear the entire scope
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] ) {
      if ( options.scope !== 'controllers' ) {
        for ( var property in CTZN.cache[options.scope] ) {
          if ( CTZN.cache[options.scope].hasOwnProperty(property) ) {
            if ( CTZN.cache[options.scope][property].timer ) {
              clearTimeout(CTZN.cache[options.scope][property].timer);
            }
          }
        }
      } else {
        for ( var controller in CTZN.cache.controllers ) {
          if ( CTZN.cache.controllers.hasOwnProperty(controller) ) {
            clear({ controller: controller });
          }
        }
      }
      CTZN.cache[options.scope] = null;
      log({
        label: options.scope + ' scope cache cleared',
        content: options,
        file: 'citizen.txt'
      });
    }
  // If only a route is provided, clear that route from the route cache
  } else if ( options.route ) {
    if ( CTZN.cache.routes && CTZN.cache.routes[options.route] ) {
      if ( CTZN.cache.routes[options.route].timer ) {
        clearTimeout(CTZN.cache.routes[options.route].timer);
      }
      CTZN.cache.routes[options.route] = null;
      log({
        label: 'route cache item cleared',
        content: options,
        file: 'citizen.txt'
      });
    }
  // If no options are provided, clear the entire cache
  // } else if ( scope === 'app' ) {
  //   TODO
  // }
  // Throw an error if the required arguments aren't provided
  } else {
    throw {
      thrownBy: 'helpers.clear()',
      message: 'Missing arguments. You must provide a cache key, cache scope, and possibly other options. Please see citizen\'s readme for instructions.'
    };
  }
}



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

  if ( size(functions) > 0 ) {
    for ( var property in functions ) {
      if ( functions.hasOwnProperty(property) ) {
        ready[property] = false;
      }
    }
    for ( property in functions ) {
      if ( functions.hasOwnProperty(property) ) {
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
          emitter = null;
          throw {
            thrownBy: 'helpers.listen()',
            message: 'Error in citizen helpers.js: ' + this.name + ' has timed out.'
          };
        });
        functions[property](emitter);
      }
    }
  } else {
    throw {
      thrownBy: 'helpers.listen()',
      message: 'The listen() function received no function argument(s). It requires at least one function passed as an argument.'
    };
  }
}



function dashes(text, fallback) {
  var parsedText = text.trim();

  fallback = fallback || '';

  parsedText = parsedText.replace(/'/g, '');
  parsedText = parsedText.replace(/[^0-9A-Za-z]/g, '-');

  // Whittle down groups of dashes to a single dash
  while ( parsedText.search(/--/) >= 0 ) {
    parsedText = parsedText.replace(/--/g, '-');
  }

  // Remove leading dashes
  while ( parsedText.charAt(0) === '-' ) {
    parsedText = parsedText.slice(1);
  }

  // Remove trailing dashes
  while ( parsedText.charAt(parsedText.length - 1) === '-' ) {
    parsedText = parsedText.slice(0, parsedText.length - 1);
  }

  // Return the parsed string, or return the fallback if the string is empty
  if ( parsedText.length ) {
    return parsedText;
  } else {
    return fallback;
  }
}



function size(object) {
  var count = 0;

  if ( object && object.constructor.toString().indexOf('Object') >= 0 ) {
    for ( var property in object ) {
      if ( object.hasOwnProperty(property) ) {
        count += 1;
      }
    }
    return count;
  } else {
    throw {
      thrownBy: 'helpers.size()',
      message: 'The supplied argument is not an object literal. size() only accepts object literals as arguments.'
    };
  }
}



function log(options) {
  var label = options.label || '',
      content = options.content,
      toConsole = options.toConsole || CTZN.config.citizen.log.toConsole || CTZN.config.citizen.mode === 'debug',
      toFile = options.toFile || CTZN.config.citizen.log.toFile || CTZN.config.citizen.mode === 'debug',
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
      fs.appendFile(CTZN.config.citizen.directories.logs + '/' + file, logItem + '\n', function (err) {
        if ( err ) {
          throw {
            thrownBy: 'helpers.log()',
            message: err
          };
        }
      });
    }
  }
}
