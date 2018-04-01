// cache functions

'use strict';

var fs = require('fs'),
    helpers = require('./helpers');

module.exports = {
  public: {
    clear: clear,
    exists: exists,
    get: get,
    set: set
  },
  citizen: {
    getController: getController,
    setController: setController,
    setRoute: setRoute
  }
};



function newTimer(args) {
  var extendBy = CTZN.cache[args.scope][args.key].lastAccessed + CTZN.cache[args.scope][args.key].lifespan - Date.now(),
      log = '';

  if ( extendBy > 0 ) {
    CTZN.cache[args.scope][args.key].timer = setTimeout( function () {
      newTimer({
        scope: args.scope,
        key: args.key
      });
    }, extendBy);
    log = args.scope + ' cache item extended by ' + ( extendBy / 60000 ) + ' minutes';
  } else {
    log = args.scope + ' cache item expired';
    clear({
      scope: args.scope,
      key: args.key
    });
  }

  helpers.log({
    label: log,
    content: {
      scope: args.scope,
      key: args.key
    },
    file: 'citizen.txt'
  });
}



function newControllerTimer(args) {
  var extendBy = CTZN.cache.controllers[args.controller][args.action][args.view][args.route].lastAccessed + CTZN.cache.controllers[args.controller][args.action][args.view][args.route].lifespan - Date.now(),
      log = '';

  if ( extendBy > 0 ) {
    CTZN.cache.controllers[args.controller][args.action][args.view][args.route].timer = setTimeout( function () {
      newControllerTimer({
        controller: args.controller,
        action: args.action,
        view: args.view,
        route: args.route
      });
    }, extendBy);
    log = 'controller cache item extended ' + ( extendBy / 60000 ) + ' minutes';
  } else {
    log = 'controller cache item expired';
    clear({
      controller: args.controller,
      action: args.action,
      view: args.view,
      route: args.route
    });
  }

  helpers.log({
    label: log,
    content: {
      controller: args.controller,
      action: args.action,
      view: args.view,
      route: args.route
    },
    file: 'citizen.txt'
  });
}



function newRouteTimer(args) {
  var extendBy = CTZN.cache.routes[args.route].lastAccessed + CTZN.cache.routes[args.route].lifespan - Date.now(),
      log = '';

  if ( extendBy > 0 ) {
    CTZN.cache.routes[args.route].timer = setTimeout( function () {
      newRouteTimer({
        route: args.route
      });
    }, extendBy);
    log = 'route cache item extended ' + ( extendBy / 60000 ) + ' minutes';
  } else {
    log = 'route cache item expired';
    clear({
      route: args.route
    });
  }

  helpers.log({
    label: log,
    content: {
      route: args.route
    },
    file: 'citizen.txt'
  });
}



function set(options) {
  var timer,
      scope = options.scope || 'app',
      key = options.key || options.file,
      value,
      stats,
      lifespan = options.lifespan || CTZN.config.citizen.cache.application.lifespan,
      enableCache = ( CTZN.config.citizen.mode !== 'debug' && CTZN.config.citizen.cache.application.enable ) || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache && CTZN.config.citizen.cache.application.enable ) ? true : false;

  if ( enableCache ) {

    if ( lifespan !== 'application' ) {
      if ( helpers.isNumeric(lifespan) ) {
        // Convert minutes to milliseconds
        lifespan = lifespan * 60000;
      } else {
        throw new Error('cache.set(): Cache lifespan needs to be specified in minutes.');
      }
    }

    options.overwrite = options.overwrite || CTZN.config.citizen.cache.application.overwrite;
    options.resetOnAccess = options.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess;
    options.encoding = options.encoding || CTZN.config.citizen.cache.application.encoding;
    options.synchronous = options.synchronous || CTZN.config.citizen.cache.application.synchronous;

    if ( scope !== 'controllers' && scope !== 'routes' && scope !== 'files' ) {
      CTZN.cache[scope] = CTZN.cache[scope] || {};
    } else {
      throw new Error('cache.set(): The terms "controllers", "routes", and "files" are reserved cache scope names. Please choose a different name for your custom cache scope.');
    }

    if ( !key ) {
      throw new Error('cache.set(): You need to specify a key name or an absolute file path when saving objects to the cache.');
    }

    // If a value is provided, it's a straight dump into the cache
    if ( options.value && !options.file ) {
      if ( !CTZN.cache[scope][key] || ( CTZN.cache[scope][key] && options.overwrite ) ) {
        if ( lifespan !== 'application' ) {
          timer = setTimeout( function () {
            newTimer({
              scope: scope,
              key: key,
              lifespan: lifespan
            });
          }, lifespan);
        }
        CTZN.cache[scope][key] = {
          key: key,
          scope: scope,
          // Create a copy of the content object so the cache isn't a pointer to the original
          value: helpers.copy(options.value),
          timer: timer,
          lastAccessed: Date.now(),
          lifespan: lifespan,
          resetOnAccess: options.resetOnAccess
        };
        helpers.log({
          label: 'Cached',
          content: {
            key: key,
            scope: scope,
            lifespan: lifespan,
            resetOnAccess: options.resetOnAccess
          },
          file: 'citizen.txt'
        });
      } else {
        throw new Error('cache.set(): An cache item using the specified key (\'' + options.key + '\') already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.');
      }
    // If a file path is provided, we need to read the file and perhaps parse it
    } else if ( options.file ) {
      CTZN.cache.files = CTZN.cache.files || {};

      if ( !CTZN.cache.files[key] || ( CTZN.cache.files[key] && options.overwrite ) ) {
        if ( lifespan !== 'application' ) {
          timer = setTimeout( function () {
            newTimer({
              scope: 'files',
              key: key,
              lifespan: lifespan
            });
          }, lifespan);
        }

        // If the file contents are provided, use them. Otherwise, read the file.
        if ( options.value ) {
          CTZN.cache.files[key] = {
            file: options.file,
            key: key,
            scope: 'files',
            value: options.value,
            stats: options.stats,
            timer: timer,
            lastAccessed: Date.now(),
            lifespan: lifespan,
            resetOnAccess: options.resetOnAccess
          };
          helpers.log({
            label: 'File cached',
            content: {
              file: options.file,
              key: key,
              scope: 'files',
              lifespan: options.lifespan,
              resetOnAccess: options.resetOnAccess
            },
            file: 'citizen.txt'
          });
        } else {
          if ( options.synchronous ) {
            value = fs.readFileSync(options.file, { encoding: options.encoding });
            stats = fs.statSync(options.file);
            if ( options.parseJSON ) {
              value = JSON.parse(value);
            }
            CTZN.cache.files[key] = {
              file: options.file,
              key: key,
              scope: 'files',
              value: value,
              stats: stats,
              timer: timer,
              lastAccessed: Date.now(),
              lifespan: lifespan,
              resetOnAccess: options.resetOnAccess
            };
            helpers.log({
              label: 'File cached',
              content: {
                file: options.file,
                key: key,
                scope: 'files',
                lifespan: options.lifespan,
                resetOnAccess: options.resetOnAccess
              },
              file: 'citizen.txt'
            });
          } else {
            fs.readFile(options.file, { encoding: options.encoding }, function (err, data) {
              if ( !err ) {
                fs.stat(options.file, function (err, stats) {
                  if ( !err ) {
                    if ( options.parseJSON ) {
                      value = JSON.parse(data);
                    } else {
                      value = data;
                    }
                    CTZN.cache.files[key] = {
                      file: options.file,
                      key: key,
                      scope: scope,
                      value: value,
                      stats: stats,
                      timer: timer,
                      lastAccessed: Date.now(),
                      lifespan: lifespan,
                      resetOnAccess: options.resetOnAccess
                    };
                    helpers.log({
                      label: 'File cached',
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
                  } else {
                    throw new Error('cache.set(): There was an error when attempting to read the specified file (' + key + ').');
                  }
                });
              } else {
                throw new Error('cache.set(): There was an error when attempting to read the specified file (' + key + ').');
              }
            });
          }
        }
      } else {
        throw new Error('cache.set(): A cache item containing the specified file (\'' + options.file + '\') already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite option explicitly.');
      }
    }
  }
}



function setController(options) {
  var timer,
      enableCache = ( CTZN.config.citizen.mode !== 'debug' && CTZN.config.citizen.cache.application.enable ) || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache && CTZN.config.citizen.cache.application.enable ) ? true : false;

  if ( enableCache ) {
    CTZN.cache.controllers = CTZN.cache.controllers || {};
    CTZN.cache.controllers[options.controller] = CTZN.cache.controllers[options.controller] || {};
    CTZN.cache.controllers[options.controller][options.action] = CTZN.cache.controllers[options.controller][options.action] || {};
    CTZN.cache.controllers[options.controller][options.action][options.view] = CTZN.cache.controllers[options.controller][options.action][options.view] || {};

    if ( !CTZN.cache.controllers[options.controller][options.action][options.view][options.route] || options.overwrite ) {
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          newControllerTimer({
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: options.route,
            lifespan: options.lifespan * 60000
          });
        }, options.lifespan * 60000);
      }

      CTZN.cache.controllers[options.controller][options.action][options.view][options.route] = {
        controller: options.controller,
        action: options.action,
        view: options.view,
        route: options.route,
        context: options.context,
        render: options.render,
        timer: timer,
        lifespan: options.lifespan * 60000 || 'application',
        resetOnAccess: options.resetOnAccess
      };

      helpers.log({
        label: 'Controller cached',
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
      throw new Error('cache.set(): A cache item containing the specified controller/action/view/route combination already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite option explicitly.\n controller: ' + options.controller + '\n action: ' + options.action + '\n view: ' + options.view + '\n route: ' + options.route);
    }
  }
}



function setRoute(options) {
  var timer,
      enableCache = ( CTZN.config.citizen.mode !== 'debug' && CTZN.config.citizen.cache.application.enable ) || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache && CTZN.config.citizen.cache.application.enable ) ? true : false;

  if ( enableCache ) {
    CTZN.cache.routes = CTZN.cache.routes || {};

    if ( !CTZN.cache.routes[options.route] || ( CTZN.cache.routes[options.route] && options.overwrite ) ) {
      if ( options.lifespan && options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          newRouteTimer({
            route: options.route,
            lifespan: options.lifespan * 60000
          });
        }, options.lifespan * 60000);
      }

      CTZN.cache.routes[options.route] = {
        route: options.route,
        contentType: options.contentType,
        view: {
          identity: options.view.identity,
          gzip: options.view.gzip,
          deflate: options.view.deflate
        },
        timer: timer,
        context: options.context,
        lastModified: options.lastModified,
        lifespan: options.lifespan * 60000 || 'application',
        resetOnAccess: options.resetOnAccess
      };

      helpers.log({
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
      throw new Error('cache.set(): A cache containing the specified route (\'' + options.route + '\') already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite option explicitly.');
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
  // If a file path is provided, check the files scope using the path as the key
  } else if ( options.file ) {
    if ( CTZN.cache.files[options.key || options.file] ) {
      return true;
    }
  // If only a scope is provided, check if the specified scope has members
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] && helpers.size(CTZN.cache[options.scope]) ) {
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
    if ( CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && helpers.size(CTZN.cache.controllers[options.controller][options.action]) ) {
      return true;
    }
  // If only a controller is provided, check if the controllers scope has it
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers[options.controller] && helpers.size(CTZN.cache.controllers[options.controller]) ) {
      return true;
    }
  // If only a route is provided, check if the controllers scope has it
  } else if ( options.route ) {
    if ( CTZN.cache.routes[options.route] && helpers.size(CTZN.cache.routes[options.route]) ) {
      return true;
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.exists(): Missing arguments. You must provide a cache key, cache scope, or both options.');
  }

  return false;
}



function get(options) {
  var scope = options.scope || 'app',
      resetOnAccess,
      matchingKeys = {},
      output = options.output || 'value';

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
        CTZN.cache[scope][options.key].lastAccessed = Date.now();

        helpers.log({
          label: 'cache accessed',
          content: options,
          file: 'citizen.txt'
        });
      }

      helpers.log({
        label: 'Retrieving from cache',
        content: options,
        file: 'citizen.txt'
      });

      if ( scope === 'routes' ) {
        return helpers.copy(CTZN.cache[scope][options.key]);
      } else {
        return helpers.copy(CTZN.cache[scope][options.key].value);
      }
    }
  // If a file path is provided, check the files scope
  } else if ( options.file ) {

    if ( CTZN.cache.files && CTZN.cache.files[options.file] ) {

      // Reset the timer (or don't) based on the provided option. If the option isn't
      // provided, use the stored resetOnAccess value.
      resetOnAccess = options.resetOnAccess || CTZN.cache.files[options.file].resetOnAccess;

      if ( CTZN.cache.files[options.file].timer && resetOnAccess ) {
        CTZN.cache.files[options.file].lastAccessed = Date.now();

        helpers.log({
          label: 'File cache accessed',
          content: options,
          file: 'citizen.txt'
        });
      }

      helpers.log({
        label: 'Retrieving file from cache',
        content: options,
        file: 'citizen.txt'
      });

      if ( output !== 'all' ) {
        return helpers.copy(CTZN.cache.files[options.file][output]);
      } else {
        return helpers.copy(CTZN.cache.files[options.file]);
      }
    }
  // If only a scope is provided, return the entire scope if it exists and it has
  // members, resetting the cache timer on each key if required
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] && helpers.size(CTZN.cache[options.scope]) ) {
      matchingKeys[options.scope] = {};

      for ( var key in CTZN.cache[options.scope] ) {
        if ( CTZN.cache[options.scope].hasOwnProperty(key) ) {
          // Reset the timer (or don't) based on the provided option. If the option isn't
          // provided, use the stored resetOnAccess value.
          resetOnAccess = options.resetOnAccess || CTZN.cache[scope][key].resetOnAccess;

          matchingKeys[options.scope][key] = get({ scope: options.scope, key: key, resetOnAccess: resetOnAccess });
        }
      }
    }

    if ( helpers.size(matchingKeys) ) {
      helpers.log({
        label: 'Retrieving from cache',
        content: options,
        file: 'citizen.txt'
      });
      return helpers.copy(matchingKeys[options.scope]);
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.get() is missing arguments. You must provide a cache key, cache scope, or both options.');
  }

  return false;
}



function getController(options) {
  var lifespan,
      resetOnAccess;

  if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
    lifespan = options.lifespan || CTZN.cache.controllers[options.controller][options.action][options.view][options.route].lifespan;
    resetOnAccess = options.resetOnAccess || CTZN.cache.controllers[options.controller][options.action][options.view][options.route].resetOnAccess;

    if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer && resetOnAccess ) {
      CTZN.cache.controllers[options.controller][options.action][options.view][options.route].lastAccessed = Date.now();

      helpers.log({
        label: 'cache timer accessed',
        content: {
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route,
          lifespan: lifespan,
          resetOnAccess: resetOnAccess
        },
        file: 'citizen.txt'
      });
    }

    helpers.log({
      label: 'Retrieving controller from cache',
      content: {
        controller: options.controller,
        action: options.action,
        view: options.view,
        route: options.route,
        lifespan: lifespan,
        resetOnAccess: resetOnAccess
      },
      file: 'citizen.txt'
    });
    return CTZN.cache.controllers[options.controller][options.action][options.view][options.route];
  }
}



function clear(options) {
  var scope = options.scope || 'app';

  // If only a key is provided, remove that key from the app scope.
  // If a scope is also provided, remove the key from that scope.
  if ( options.key && ( options.scope || scope === 'app' ) ) {
    if ( CTZN.cache[scope] && CTZN.cache[scope][options.key] ) {
      if ( CTZN.cache[scope][options.key].timer ) {
        clearTimeout(CTZN.cache[scope][options.key].timer);
      }
      delete CTZN.cache[scope][options.key];
      helpers.log({
        label: scope + ' cache item cleared',
        content: options,
        file: 'citizen.txt'
      });
    }
  // If a file attribute is provided, clear it from the files scope
  } else if ( options.file ) {
    if ( CTZN.cache.files && CTZN.cache.files[options.file] ) {
      if ( CTZN.cache.files[options.file].timer ) {
        clearTimeout(CTZN.cache.files[options.file].timer);
      }
      delete CTZN.cache.files[options.file];
      helpers.log({
        label: 'Cached file cleared',
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
          delete CTZN.cache.controllers[options.controller][options.action][options.view][options.route];
          helpers.log({
            label: 'controller/action/view/route cache cleared',
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
          delete CTZN.cache.controllers[options.controller][options.action][options.view];
          helpers.log({
            label: 'controller/action/view cache cleared',
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
          delete CTZN.cache.controllers[options.controller][options.action];
          helpers.log({
            label: 'controller/action cache cleared',
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
        helpers.log({
          label: 'controller cache cleared',
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
      delete CTZN.cache[options.scope];
      helpers.log({
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
      delete CTZN.cache.routes[options.route];
      helpers.log({
        label: 'route cache item cleared',
        content: options,
        file: 'citizen.txt'
      });
    }
  // If no options are provided, clear the entire cache
  // } else if ( !options ) {
  //   TODO
  // }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.clear(): Missing arguments. Please see citizen\'s readme for details on what options are required.');
  }
}
