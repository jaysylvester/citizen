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
        newTimer(args)
      }, extendBy)
      helpers.log({
        label: 'Cache extended',
        content: {
          scope: args.scope,
          key: args.key,
          extension: ( extendBy / 60000 ) + ' minutes'
        }
      })
    } else {
      helpers.log({
        label: 'Cache expired',
        content: args
      })
      args.log = false
      clear(args)
    }
  }
}


const newControllerTimer = (args) => {
  let extendBy = CTZN.cache.controllers[args.controller][args.action][args.view][args.route][args.contentType].lastAccessed + CTZN.cache.controllers[args.controller][args.action][args.view][args.route][args.contentType].lifespan - Date.now()

  if ( extendBy > 0 ) {
    CTZN.cache.controllers[args.controller][args.action][args.view][args.route][args.contentType].timer = setTimeout( function () {
      newControllerTimer(args)
    }, extendBy)
    helpers.log({
      label: 'Controller cache extended',
      content: {
        controller: args.controller,
        action: args.action,
        view: args.view,
        route: args.route,
        contentType: args.contentType,
        extension: ( extendBy / 60000 ) + ' minutes'
      }
    })
  } else {
    helpers.log({
      label: 'Controller cache expired',
      content: args
    })
    args.log = false
    clear(args)
  }
}


const newRouteTimer = (args) => {
  let extendBy = CTZN.cache.routes[args.route][args.contentType].lastAccessed + CTZN.cache.routes[args.route][args.contentType].lifespan - Date.now()

  if ( extendBy > 0 ) {
    CTZN.cache.routes[args.route][args.contentType].timer = setTimeout( function () {
      newRouteTimer(args)
    }, extendBy)
    helpers.log({
      label: 'Route cache extended',
      content: {
        route: args.route,
        contentType: args.contentType,
        extension: ( extendBy / 60000 ) + ' minutes'
      }
    })
  } else {
    helpers.log({
      label: 'Route cache expired',
      content: args
    })
    args.log = false
    clear(args)
  }
}


const set = (options) => {
  // If caching is enabled, proceed.
  if ( options.file ? CTZN.config.citizen.cache.static.enable : CTZN.config.citizen.cache.application.enable ) {
    let timer = false,
        scope = options.scope || 'app',
        key = options.key || options.file,
        value,
        stats,
        lifespan = options.lifespan || options.file ? CTZN.config.citizen.cache.static.lifespan : CTZN.config.citizen.cache.application.lifespan

    if ( !isNaN(lifespan) ) {
      // Convert minutes to milliseconds
      lifespan = lifespan * 60000
    }

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
      if ( !CTZN.cache[scope][key] ) {
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
        options.log = false
        clear(options)
        set(options)
      }
    // If a file path is provided, we need to read the file and perhaps parse it
    } else if ( options.file ) {
      CTZN.cache.files = CTZN.cache.files || {}

      if ( !CTZN.cache.files[key] ) {
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
        options.log = false
        clear(options)
        set(options)
      }
    }
  }
}


const setController = (options) => {
  CTZN.cache.controllers = CTZN.cache.controllers || {}
  CTZN.cache.controllers[options.controller] = CTZN.cache.controllers[options.controller] || {}
  CTZN.cache.controllers[options.controller][options.action] = CTZN.cache.controllers[options.controller][options.action] || {}
  CTZN.cache.controllers[options.controller][options.action][options.view] = CTZN.cache.controllers[options.controller][options.action][options.view] || {}
  CTZN.cache.controllers[options.controller][options.action][options.view][options.route] = CTZN.cache.controllers[options.controller][options.action][options.view][options.route] || {}
  
  // If the controller isn't already cached, cache it.
  if ( !CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType] ) {
    options.timer = false
    if ( options.lifespan !== 'application' ) {
      options.lifespan = options.lifespan * 60000
      options.timer = setTimeout( function () {
        newControllerTimer({
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route,
          contentType: options.contentType
        })
      }, options.lifespan)
    }

    CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType] = options

    helpers.log({
      label: 'Controller cached',
      content: options
    })
  // If the controller is already cached, clear and set the new cache.
  } else {
    clear(options)
    setController(options)
  }
}


const setRoute = (options) => {
  CTZN.cache.routes = CTZN.cache.routes || {}
  
  // If the route isn't already cached, cache it.
  if ( !CTZN.cache.routes[options.route] || !CTZN.cache.routes[options.route][options.contentType] ) {
    options.timer = false
    if ( options.lifespan !== 'application' ) {
      options.lifespan = options.lifespan * 60000
      options.timer = setTimeout( function () {
        newRouteTimer({
          route: options.route,
          contentType: options.contentType
        })
      }, options.lifespan)
    }

    // Preserve only HTTP response headers in the cache context
    if ( !options.context.header ) {
      options.context = {}
    } else {
      let header = options.context.header
      options.context = {
        header: header
      }
    }
    CTZN.cache.routes[options.route] = CTZN.cache.routes[options.route] || {}
    CTZN.cache.routes[options.route][options.contentType] = options

    helpers.log({
      label: 'Route cached',
      content: options
    })
  // If the route is already cached, clear and set the new cache.
  } else {
    clear(options)
    setRoute(options)
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
  } else if ( options.controller && options.action && options.view && options.route && options.contentType ) {
    if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType] ) {
      return true
    }
  // If a controller and action are provided, check if the controllers scope has them
  } else if ( options.controller && options.action ) {
    if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && Object.keys(CTZN.cache.controllers[options.controller][options.action]).length ) {
      return true
    }
  // If only a controller is provided, check if the controllers scope has it
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && Object.keys(CTZN.cache.controllers[options.controller]).length ) {
      return true
    }
  // If only a route is provided, check if the route scope has it
  } else if ( options.route ) {
    if ( CTZN.cache.routes && CTZN.cache.routes[options.route] && CTZN.cache.routes[options.route][options.contentType] ) {
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
      matchingKeys = {}

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

      return helpers.copy(CTZN.cache[scope][options.key].value)
    }
  // If a file path is provided, check the files scope
  } else if ( options.file ) {
    if ( CTZN.cache.files && CTZN.cache.files[options.file] ) {
      options.output = options.output || 'value'

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

      if ( options.output !== 'all' ) {
        return CTZN.cache.files[options.file][options.output]
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
  if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] && CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType] ) {
    options.lifespan = options.lifespan || CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType].lifespan
    options.resetOnAccess = options.resetOnAccess || CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType].resetOnAccess

    if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType].timer && options.resetOnAccess ) {
      CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType].lastAccessed = Date.now()
    }

    helpers.log({
      label: 'Retrieving controller from cache',
      content: options
    })
    return CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType]
  }
}


const getRoute = (options) => {
  if ( CTZN.cache.routes && CTZN.cache.routes[options.route] && CTZN.cache.routes[options.route][options.contentType] ) {
    if ( CTZN.cache.routes[options.route][options.contentType].timer && CTZN.cache.routes[options.route][options.contentType].resetOnAccess ) {
      CTZN.cache.routes[options.route][options.contentType].lastAccessed = Date.now()
    }

    helpers.log({
      label: 'Retrieving route from cache',
      content: options
    })

    return CTZN.cache.routes[options.route][options.contentType]
  }

  return false
}


const clear = (options) => {
  let scope = options ? options.scope : 'app',
      log = options ? options.log : true

  // If no options are provided, nuke it from orbit. It's the only way to be sure.
  if ( !options ) {
    Object.keys(CTZN.cache).forEach( item => {
      clear({ scope: item, log: false })
    })
    helpers.log({
      label: 'Cache cleared'
    })
  // If a file attribute is provided, clear it from the files scope
  } else if ( options.file ) {
    if ( CTZN.cache.files && CTZN.cache.files[options.file] ) {
      if ( CTZN.cache.files[options.file].timer ) {
        clearTimeout(CTZN.cache.files[options.file].timer)
      }
      delete CTZN.cache.files[options.file]
      if ( log ) {
        helpers.log({
          label: 'Cached file cleared',
          content: options
        })
      }
    }
  // If a controller name is provided, clear the controller scope based on the
  // optionally provided action and view
  } else if ( options.controller ) {
    if ( CTZN.cache.controllers && CTZN.cache.controllers[options.controller] ) {
      if ( options.action && options.view && options.route && options.contentType ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType] ) {
          if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType].timer ) {
            clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType].timer)
          }
          delete CTZN.cache.controllers[options.controller][options.action][options.view][options.route][options.contentType]
          if ( log ) {
            helpers.log({
              label: 'Controller cache cleared',
              content: options
            })
          }
        }
      } else if ( options.action && options.view && options.route ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] && CTZN.cache.controllers[options.controller][options.action][options.view][options.route] ) {
          Object.keys(CTZN.cache.controllers[options.controller][options.action][options.view][options.route]).forEach( contentType => {
            if ( CTZN.cache.controllers[options.controller][options.action][options.view][options.route][contentType].timer ) {
              clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][options.route][contentType].timer)
            }
          })
          delete CTZN.cache.controllers[options.controller][options.action][options.view][options.route]
          if ( log ) {
            helpers.log({
              label: 'Controller cache cleared',
              content: options
            })
          }
        }
      } else if ( options.action && options.view ) {
        if ( CTZN.cache.controllers[options.controller][options.action] && CTZN.cache.controllers[options.controller][options.action][options.view] ) {
          Object.keys(CTZN.cache.controllers[options.controller][options.action][options.view]).forEach( route => {
            Object.keys(CTZN.cache.controllers[options.controller][options.action][options.view][route]).forEach( contentType => {
              if ( CTZN.cache.controllers[options.controller][options.action][options.view][route][contentType].timer ) {
                clearTimeout(CTZN.cache.controllers[options.controller][options.action][options.view][route][contentType].timer)
              }
            })
          })
          delete CTZN.cache.controllers[options.controller][options.action][options.view]
          if ( log ) {
            helpers.log({
              label: 'Controller cache cleared',
              content: options
            })
          }
        }
      } else if ( options.action ) {
        if ( CTZN.cache.controllers[options.controller][options.action] ) {
          Object.keys(CTZN.cache.controllers[options.controller][options.action]).forEach( view => {
            Object.keys(CTZN.cache.controllers[options.controller][options.action][view]).forEach( route => {
              Object.keys(CTZN.cache.controllers[options.controller][options.action][view][route]).forEach( contentType => {
                if ( CTZN.cache.controllers[options.controller][options.action][view][route][contentType].timer ) {
                  clearTimeout(CTZN.cache.controllers[options.controller][options.action][view][route][contentType].timer)
                }
              })
            })
          })
          delete CTZN.cache.controllers[options.controller][options.action]
          if ( log ) {
            helpers.log({
              label: 'Controller cache cleared',
              content: options
            })
          }
        }
      } else {
        Object.keys(CTZN.cache.controllers[options.controller]).forEach( action => {
          Object.keys(CTZN.cache.controllers[options.controller][action]).forEach( view => {
            Object.keys(CTZN.cache.controllers[options.controller][action][view]).forEach( route => {
              Object.keys(CTZN.cache.controllers[options.controller][action][view][route]).forEach( contentType => {
                if ( CTZN.cache.controllers[options.controller][action][view][route][contentType].timer ) {
                  clearTimeout(CTZN.cache.controllers[options.controller][action][view][route][contentType].timer)
                }
              })
            })
          })
        })
        delete CTZN.cache.controllers[options.controller]
        if ( log ) {
          helpers.log({
            label: 'Controller cache cleared',
            content: options
          })
        }
      }
    }
  // If only a route is provided, clear that route from the route cache
  } else if ( options.route ) {
    if ( CTZN.cache.routes && CTZN.cache.routes[options.route] && CTZN.cache.routes[options.route][options.contentType] ) {
      if ( CTZN.cache.routes[options.route][options.contentType].timer ) {
        clearTimeout(CTZN.cache.routes[options.route][options.contentType].timer)
      }
      delete CTZN.cache.routes[options.route][options.contentType]
      if ( !Object.keys(CTZN.cache.routes[options.route]).length ) {
        delete CTZN.cache.routes[options.route]
      }
      if ( options.log ) {
        helpers.log({
          label: 'Route cache cleared',
          content: {
            route: options.route,
            contentType: options.contentType
          }
        })
      }
    }
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
      if ( log ) {
        helpers.log({
          label: 'Cache cleared',
          content: options
        })
      }
    }
  // If only a scope is provided, clear the entire scope
  } else if ( options.scope ) {
    if ( CTZN.cache[options.scope] ) {
      switch ( options.scope ) {
        case 'controllers':
          Object.keys(CTZN.cache.controllers).forEach( item => {
            clear({ controller: item, log: false })
          })
          break
        case 'routes':
          Object.keys(CTZN.cache.routes).forEach( route => {
            Object.keys(CTZN.cache.routes[route]).forEach( contentType => {
              clear({ route: route, contentType: contentType, log: false })
            })
          })
          break
        default:
          Object.keys(CTZN.cache[options.scope]).forEach( item => {
            if ( CTZN.cache[options.scope][item].timer ) {
              clearTimeout(CTZN.cache[options.scope][item].timer)
            }
          })
      }
      delete CTZN.cache[options.scope]
      if ( log ) {
        helpers.log({
          label: 'Scope cache cleared',
          content: options
        })
      }
    }
  // Throw an error if the required arguments aren't provided
  } else {
    throw new Error('cache.clear(): Missing arguments. Please see citizen\'s readme for details on what options are required.')
  }
}


export default { clear, exists, get, getController, getRoute, set, setRoute, setController }
export { clear, exists, get, set }
