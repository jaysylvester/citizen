// cache functions

// node
import fs      from 'fs'
// citizen
import helpers from './helpers.js'


const newTimer = (args) => {
  let extendBy = CTZN.cache[args.scope] && CTZN.cache[args.scope][args.key] ? CTZN.cache[args.scope][args.key].lastAccessed + CTZN.cache[args.scope][args.key].lifespan - Date.now() : false

  if ( extendBy !== false ) {
    if ( extendBy > 0 ) {
      CTZN.cache[args.scope][args.key].timer = setTimeout( function () {
        newTimer({
          scope: args.scope,
          key: args.key
        })
      }, extendBy)
      helpers.log({
        label: args.scope + ' cache item extended by ' + ( extendBy / 60000 ) + ' minutes',
        content: {
          scope: args.scope,
          key: args.key
        }
      })
    } else {
      helpers.log({
        label: args.scope + ' cache item expired',
        content: {
          scope: args.scope,
          key: args.key
        }
      })
      clear({
        scope: args.scope,
        key: args.key
      })
    }
  }
}


const newControllerTimer = (args) => {
  let extendBy = CTZN.cache.controllers[args.controller][args.action][args.view][args.route].lastAccessed + CTZN.cache.controllers[args.controller][args.action][args.view][args.route].lifespan - Date.now()

  if ( extendBy > 0 ) {
    CTZN.cache.controllers[args.controller][args.action][args.view][args.route].timer = setTimeout( function () {
      newControllerTimer({
        controller: args.controller,
        action: args.action,
        view: args.view,
        route: args.route
      })
    }, extendBy)
    helpers.log({
      label: 'controller cache item extended ' + ( extendBy / 60000 ) + ' minutes',
      content: {
        controller: args.controller,
        action: args.action,
        view: args.view,
        route: args.route
      }
    })
  } else {
    helpers.log({
      label: 'controller cache item expired',
      content: {
        controller: args.controller,
        action: args.action,
        view: args.view,
        route: args.route
      }
    })
    clear({
      controller: args.controller,
      action: args.action,
      view: args.view,
      route: args.route
    })
  }
}


const newRouteTimer = (args) => {
  let extendBy = CTZN.cache.routes[args.route].lastAccessed + CTZN.cache.routes[args.route].lifespan - Date.now()

  if ( extendBy > 0 ) {
    CTZN.cache.routes[args.route].timer = setTimeout( function () {
      newRouteTimer({
        route: args.route
      })
    }, extendBy)
    helpers.log({
      label: 'route cache item extended ' + ( extendBy / 60000 ) + ' minutes',
      content: {
        route: args.route
      }
    })
  } else {
    helpers.log({
      label: 'route cache item expired',
      content: {
        route: args.route
      }
    })
    clear({
      route: args.route
    })
  }
}


const set = (options) => {
  let timer,
      scope = options.scope || 'app',
      key = options.key || options.file,
      value,
      stats,
      lifespan = options.lifespan || CTZN.config.citizen.cache.application.lifespan

  if ( CTZN.config.citizen.cache.application.enable ) {

    if ( !isNaN(lifespan) ) {
      // Convert minutes to milliseconds
      lifespan = lifespan * 60000
    }

    options.overwrite = options.overwrite || CTZN.config.citizen.cache.application.overwrite
    options.resetOnAccess = options.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess
    options.encoding = options.encoding || CTZN.config.citizen.cache.application.encoding
    options.synchronous = options.synchronous || CTZN.config.citizen.cache.application.synchronous

    if ( scope !== 'controllers' && scope !== 'routes' && scope !== 'files' ) {
      CTZN.cache[scope] = CTZN.cache[scope] || {}
    } else {
      throw new Error('cache.set(): The terms "controllers", "routes", and "files" are reserved cache scope names. Please choose a different name for your custom cache scope.')
    }

    if ( !key ) {
      throw new Error('cache.set(): You need to specify a key name or an absolute file path when saving objects to the cache.')
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
            })
          }, lifespan)
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
        }
        helpers.log({
          label: key + ' cached',
          content: {
            key: key,
            scope: scope,
            lifespan: lifespan,
            resetOnAccess: options.resetOnAccess
          }
        })
      } else {
        throw new Error('cache.set(): An cache item using the specified key (\'' + options.key + '\') already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite flag explicitly.')
      }
    // If a file path is provided, we need to read the file and perhaps parse it
    } else if ( options.file ) {
      if ( !CTZN.cache.files[key] || ( CTZN.cache.files[key] && options.overwrite ) ) {
        if ( lifespan !== 'application' ) {
          timer = setTimeout( function () {
            newTimer({
              scope: 'files',
              key: key,
              lifespan: lifespan
            })
          }, lifespan)
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
          }
          helpers.log({
            label: 'File cached',
            content: {
              file: options.file,
              key: key,
              scope: 'files',
              lifespan: options.lifespan,
              resetOnAccess: options.resetOnAccess
            }
          })
        } else {
          if ( options.synchronous ) {
            value = fs.readFileSync(options.file, { encoding: options.encoding })
            stats = fs.statSync(options.file)
            if ( options.parseJSON ) {
              value = JSON.parse(value)
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
            }
            helpers.log({
              label: 'File cached',
              content: {
                file: options.file,
                key: key,
                scope: 'files',
                lifespan: options.lifespan,
                resetOnAccess: options.resetOnAccess
              }
            })
          } else {
            fs.readFile(options.file, { encoding: options.encoding }, function (err, data) {
              if ( !err ) {
                fs.stat(options.file, function (err, stats) {
                  if ( !err ) {
                    if ( options.parseJSON ) {
                      value = JSON.parse(data)
                    } else {
                      value = data
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
                    }
                    helpers.log({
                      label: 'File cached',
                      content: {
                        file: options.file,
                        key: key,
                        scope: scope,
                        value: options.value,
                        lifespan: options.lifespan,
                        resetOnAccess: options.resetOnAccess
                      }
                    })
                  } else {
                    throw new Error('cache.set(): There was an error when attempting to read the specified file (' + key + ').')
                  }
                })
              } else {
                throw new Error('cache.set(): There was an error when attempting to read the specified file (' + key + ').')
              }
            })
          }
        }
      } else {
        throw new Error('cache.set(): A cache item containing the specified file (\'' + options.file + '\') already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite option explicitly.')
      }
    }
  }
}


const setController = (options) => {
  if ( CTZN.config.citizen.cache.application.enable ) {
    CTZN.cache.controllers[options.controller] = CTZN.cache.controllers[options.controller] || {}
    CTZN.cache.controllers[options.controller][options.action] = CTZN.cache.controllers[options.controller][options.action] || {}
    CTZN.cache.controllers[options.controller][options.action][options.view] = CTZN.cache.controllers[options.controller][options.action][options.view] || {}

    if ( !CTZN.cache.controllers[options.controller][options.action][options.view][options.route] || options.overwrite ) {
      let timer
      if ( options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          newControllerTimer({
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: options.route,
            lifespan: options.lifespan * 60000
          })
        }, options.lifespan * 60000)
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
      }

      helpers.log({
        label: 'Controller cached',
        content: {
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route,
          lifespan: options.lifespan,
          resetOnAccess: options.resetOnAccess
        }
      })
    } else {
      throw new Error('cache.set(): A cache item containing the specified controller/action/view/route combination already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite option explicitly.\n controller: ' + options.controller + '\n action: ' + options.action + '\n view: ' + options.view + '\n route: ' + options.route)
    }
  }
}


const setRoute = (options) => {
  if ( CTZN.config.citizen.cache.application.enable ) {
    if ( !CTZN.cache.routes[options.route] || ( CTZN.cache.routes[options.route] && options.overwrite ) ) {
      let timer
      if ( options.lifespan && options.lifespan !== 'application' ) {
        timer = setTimeout( function () {
          newRouteTimer({
            route: options.route,
            lifespan: options.lifespan * 60000
          })
        }, options.lifespan * 60000)
      }

      CTZN.cache.routes[options.route] = {
        route: options.route,
        contentType: options.contentType,
        render: {
          identity: options.render.identity,
          gzip: options.render.gzip,
          deflate: options.render.deflate
        },
        timer: timer,
        context: options.context,
        lastModified: options.lastModified,
        lifespan: options.lifespan * 60000 || 'application',
        resetOnAccess: options.resetOnAccess
      }

      helpers.log({
        label: 'Route cached',
        content: {
          route: options.route,
          contentType: options.contentType,
          lifespan: options.lifespan,
          resetOnAccess: options.resetOnAccess
        }
      })
    } else {
      throw new Error('cache.set(): A cache containing the specified route (\'' + options.route + '\') already exists. If your intention is to overwrite the existing cache, you have to pass the overwrite option explicitly.')
    }
  }
}


const exists = (options) => {
  // If both a scope and key are provided, check the scope for the specified key
  if ( options.key && options.scope ) {
    if ( CTZN.cache[options.scope] && CTZN.cache[options.scope][options.key] ) {
      return true
    }
  // If only a key is provided, check the app scope (default) for the specified key
  } else if ( options.key ) {
    if ( CTZN.cache.app[options.key] ) {
      return true
    }
  // If a file path is provided, check the files scope using the path as the key
  } else if ( options.file ) {
    if ( CTZN.cache.files[options.key || options.file] ) {
      return true
    }
  // If only a scope is provided, check if the specified scope has members
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] && Object.keys(CTZN.cache[options.scope]).length ) {
      return true
    }
  // If a controller, action, and view are provided, check if the controllers scope
  // has that view
  } else if ( options.controller && options.action && options.view && options.route ) {
    if ( CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
      return true
    }
  // If a controller and action are provided, check if the controllers scope has them
  } else if ( options.controller && options.action ) {
    if ( CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && Object.keys(CTZN.cache.controllers[options.controller][options.action]).length ) {
      return true
    }
  // If only a controller is provided, check if the controllers scope has it
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers[options.controller] && Object.keys(CTZN.cache.controllers[options.controller]).length ) {
      return true
    }
  // If only a route is provided, check if the controllers scope has it
  } else if ( options.route ) {
    if ( CTZN.cache.routes[options.route] && Object.keys(CTZN.cache.routes[options.route]).length ) {
      return true
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.exists(): Missing arguments. You must provide a cache key, cache scope, or both options.')
  }

  return false
}


const get = (options) => {
  let scope = options.scope || 'app',
      resetOnAccess,
      matchingKeys = {},
      output = options.output || 'value'

  // Return the provided key from the specified scope. This first condition matches
  // the following:
  // 1. Only a key has been provided
  // 2. A key and a custom scope have been provided
  if ( options.key ) {
    if ( CTZN.cache[scope] && CTZN.cache[scope][options.key] ) {

      // Reset the timer (or don't) based on the provided option. If the option isn't
      // provided, use the stored resetOnAccess value.
      resetOnAccess = options.resetOnAccess || CTZN.cache[scope][options.key].resetOnAccess

      if ( CTZN.cache[scope][options.key].timer && resetOnAccess ) {
        CTZN.cache[scope][options.key].lastAccessed = Date.now()
      }

      helpers.log({
        label: 'Retrieving from cache',
        content: options
      })

      if ( scope === 'routes' ) {
        return CTZN.cache[scope][options.key]
      } else {
        return helpers.copy(CTZN.cache[scope][options.key].value)
      }
    }
  // If a file path is provided, check the files scope
  } else if ( options.file ) {

    if ( CTZN.cache.files[options.file] ) {

      // Reset the timer (or don't) based on the provided option. If the option isn't
      // provided, use the stored resetOnAccess value.
      resetOnAccess = options.resetOnAccess || CTZN.cache.files[options.file].resetOnAccess

      if ( CTZN.cache.files[options.file].timer && resetOnAccess ) {
        CTZN.cache.files[options.file].lastAccessed = Date.now()
      }

      helpers.log({
        label: 'Retrieving file from cache',
        content: options
      })

      if ( output !== 'all' ) {
        return CTZN.cache.files[options.file][output]
      } else {
        return CTZN.cache.files[options.file]
      }
    }
  // If only a scope is provided, return the entire scope if it exists and it has
  // members, resetting the cache timer on each key if required
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] && Object.keys(CTZN.cache[options.scope]).length ) {
      matchingKeys[options.scope] = {}

      Object.keys(CTZN.cache[options.scope]).forEach( item => {
        // Reset the timer (or don't) based on the provided option. If the option isn't
        // provided, use the stored resetOnAccess value.
        resetOnAccess = options.resetOnAccess || CTZN.cache[scope][item].resetOnAccess

        matchingKeys[options.scope][item] = get({ scope: options.scope, key: item, resetOnAccess: resetOnAccess })
      })
    }

    if ( Object.keys(matchingKeys).length ) {
      helpers.log({
        label: 'Retrieving from cache',
        content: options
      })
      return helpers.copy(matchingKeys[options.scope])
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.get() is missing arguments. You must provide a cache key, cache scope, or both options.')
  }

  return false
}


const getController = (options) => {
  if ( CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
    let lifespan = options.lifespan || CTZN.cache.controllers[options.controller][options.action][options.view][options.route].lifespan
    let resetOnAccess = options.resetOnAccess || CTZN.cache.controllers[options.controller][options.action][options.view][options.route].resetOnAccess

    if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer && resetOnAccess ) {
      CTZN.cache.controllers[options.controller][options.action][options.view][options.route].lastAccessed = Date.now()

      helpers.log({
        label: 'Cache timer accessed',
        content: {
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route,
          lifespan: lifespan,
          resetOnAccess: resetOnAccess
        }
      })
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
      }
    })
    return CTZN.cache.controllers[options.controller][options.action][options.view][options.route]
  }
}


const clear = (options) => {
  let scope = options ? options.scope : 'app'

  // If no options are provided, nuke it from orbit. It's the only way to be sure.
  if ( !options ) {
    CTZN.cache = {}
    helpers.log({
      content: 'App cache cleared'
    })
  // If only a key is provided, remove that key from the app scope.
  // If a scope is also provided, remove the key from that scope.
  } else if ( options.key && ( options.scope || scope === 'app' ) ) {
    if ( CTZN.cache[scope] && CTZN.cache[scope][options.key] ) {
      if ( CTZN.cache[scope][options.key].timer ) {
        clearTimeout(CTZN.cache[scope][options.key].timer)
      }
      delete CTZN.cache[scope][options.key]
      // Delete the scope if it's empty
      if ( !Object.keys(CTZN.cache[scope]).length ) {
        delete CTZN.cache[scope]
      }
      helpers.log({
        label: scope + ' cache item cleared',
        content: options
      })
    }
  // If a file attribute is provided, clear it from the files scope
  } else if ( options.file ) {
    if ( CTZN.cache.files[options.file] ) {
      if ( CTZN.cache.files[options.file].timer ) {
        clearTimeout(CTZN.cache.files[options.file].timer)
      }
      delete CTZN.cache.files[options.file]
      helpers.log({
        label: 'Cached file cleared',
        content: options
      })
    }
  // If a controller name is provided, clear the controller scope based on the
  // optionally provided action and view
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers[options.controller] ) {
      if ( options.action && options.view && options.route ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
          if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer ) {
            clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][options.route].timer)
          }
          delete CTZN.cache.controllers[options.controller][options.action][options.view][options.route]
          helpers.log({
            label: 'Controller/action/view/route cache cleared',
            content: options
          })
        }
      } else if ( options.action && options.view ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] ) {
          Object.keys(CTZN.cache.controllers[options.controller][options.action][options.view]).forEach( item => {
            if ( CTZN.cache.controllers[options.controller][options.action][options.view][item].timer ) {
              clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][item].timer)
            }
          })
          delete CTZN.cache.controllers[options.controller][options.action][options.view]
          helpers.log({
            label: 'Controller/action/view cache cleared',
            content: options
          })
        }
      } else if ( options.action ) {
        if ( CTZN.cache.controllers[options.controller][options.action] ) {
          Object.keys(CTZN.cache.controllers[options.controller][options.action]).forEach( view => {
            Object.keys(CTZN.cache.controllers[options.controller][options.action][view]).forEach( viewRoute => {
              if ( CTZN.cache.controllers[options.controller][options.action][view][viewRoute].timer ) {
                clearTimeout(CTZN.cache.controllers[options.controller][options.action][view][viewRoute].timer)
              }
            })
          })
          delete CTZN.cache.controllers[options.controller][options.action]
          helpers.log({
            label: 'Controller/action cache cleared',
            content: options
          })
        }
      } else {
        Object.keys(CTZN.cache.controllers[options.controller]).forEach( action => {
          Object.keys(CTZN.cache.controllers[options.controller][action]).forEach( actionView => {
            Object.keys(CTZN.cache.controllers[options.controller][action][actionView]).forEach( viewRoute => {
              if ( CTZN.cache.controllers[options.controller][action][actionView][viewRoute].timer ) {
                clearTimeout(CTZN.cache.controllers[options.controller][action][actionView][viewRoute].timer)
              }
            })
          })
        })
        delete CTZN.cache.controllers[options.controller]
        helpers.log({
          label: 'Controller cache item cleared',
          content: options
        })
      }
    }
  // If only a scope is provided, clear the entire scope
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] ) {
      if ( options.scope !== 'controllers' ) {
        Object.keys(CTZN.cache[options.scope]).forEach( item => {
          if ( CTZN.cache[options.scope][item].timer ) {
            clearTimeout(CTZN.cache[options.scope][item].timer)
          }
        })
      } else {
        Object.keys(CTZN.cache.controllers).forEach( item => {
          clear({ controller: item })
        })
      }
      delete CTZN.cache[options.scope]
      helpers.log({
        label: options.scope + ' scope cache cleared',
        content: options
      })
    }
  // If only a route is provided, clear that route from the route cache
  } else if ( options.route ) {
    if ( CTZN.cache.routes[options.route] ) {
      if ( CTZN.cache.routes[options.route].timer ) {
        clearTimeout(CTZN.cache.routes[options.route].timer)
      }
      delete CTZN.cache.routes[options.route]
      helpers.log({
        label: 'Route cache item cleared',
        content: options
      })
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.clear(): Missing arguments. Please see citizen\'s readme for details on what options are required.')
  }
}


export default { clear, exists, get, getController, set, setRoute, setController }
export { clear, exists, get, set }
