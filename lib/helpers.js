// core framework functions that might also be of use in the app

// node
import fs   from 'node:fs'
import http from 'node:http'
import util from 'node:util'


const copy = (object) => {
  var objectCopy

  if ( !object || typeof object === 'number' || typeof object === 'string' || typeof object === 'boolean' || typeof object === 'symbol' || typeof object === 'function' || object.constructor === Date || object.constructor === RegExp || typeof object._onTimeout === 'function' ) { // Preserve timers; URL parameters named _onTimeout are strings.
    objectCopy = object
  } else if ( Array.isArray(object) ) {
    objectCopy = []
  
    object.forEach( function (item, index) {
      objectCopy[index] = copy(item)
    })
  } else if ( object.constructor === Object || Object(object) === object ) {
    objectCopy = { ...object }

    for ( var property of Object.keys(objectCopy) ) {
      objectCopy[property] = copy(object[property])
    }
  } else {
    objectCopy = object
  }
  
  return objectCopy
}


const extend = (original, extension) => {
  var mergedObject = { ...original }

  extension = { ...extension }

  Object.keys(extension).forEach( item => {
    let value = extension[item] && extension[item].constructor === Object
                  ? extend(Object.hasOwn(mergedObject, item) ? mergedObject[item] : undefined, extension[item])
                  : copy(extension[item])

    if ( item === '__proto__' ) {
      Object.defineProperty(mergedObject, item, { value, enumerable: true, writable: true, configurable: true })
    } else {
      mergedObject[item] = value
    }
  })

  return mergedObject
}


const log = (options) => {
  let type       = options.type || 'debug',
      toConsole  = options.console || CTZN.config.citizen.mode === 'development',
      toFile     = options.file || ( type === 'access' && CTZN.config.citizen.logs.access ) || ( type === 'error:client' && CTZN.config.citizen.logs.error?.client ) || ( type === 'error:server' && CTZN.config.citizen.logs.error?.server ) || ( type === 'debug' && CTZN.config.citizen.logs.debug ),
      depth      = options.depth || CTZN.config.citizen.development.debug.depth,
      showHidden = options.showHidden || CTZN.config.citizen.development.debug.showHidden

  if ( toConsole ) {
    let dividerTop = ''
    if ( options.divider && options.divider.top ) {
      // Default divider
      if ( options.divider.top === true ) {
        dividerTop = '\n----------------------------------------------------------------------\n\n'
      // Custom divider
      } else {
        dividerTop = options.divider.top
      }
    }

    let label = '', time = new Date().toISOString()
    if ( options.label ) {
      if ( options.timestamp === false ) {
        label  = '\x1b[1m' + options.label + '\x1b[0m'
      } else {
        if ( type === 'error' ) {
          label  = '[' + time + '] ' + options.label
        } else {
          label  = '[' + time + '] ' + '\x1b[1m' + options.label + '\x1b[0m'
        }
      }
    } else if ( options.timestamp !== false ) {
      label  = '[' + time + '] '
    }

    let content = '\n'
    if ( options.content ) {
      switch ( typeof options.content ) {
        case 'string':
          if ( options.content.length ) {
            content = '\n' + options.content + '\n'
          } else {
            content = '\n(empty string)\n'
          }
          break
        case 'number':
          content = '\n' + options.content + '\n'
          break
        default:
          content = '\n' + util.inspect(options.content, { depth: depth, colors: true, showHidden: showHidden }) + '\n'
          break
      }
    }

    let dividerBottom = ''
    if ( options.divider && options.divider.bottom ) {
      // Default divider
      if ( options.divider.bottom === true ) {
        dividerBottom = '\n----------------------------------------------------------------------\n\n'
      // Custom divider
      } else {
        dividerBottom = options.divider.bottom
      }
    }

    let log = dividerTop + label + content
    if ( type === 'error' ) {
      log = '\x1b[31m' + log + dividerBottom + '\x1b[0m'
    } else {
      log += dividerBottom
    }
    console.log(log)
  }

  if ( toFile ) {
    let dividerTop = ''
    if ( options.divider && options.divider.top ) {
      // Default divider
      if ( options.divider.top === true ) {
        dividerTop = '\n----------------------------------------------------------------------\n\n'
      // Custom divider
      } else {
        dividerTop = options.divider.top
      }
    }

    let label = '', time = new Date().toISOString()
    if ( options.label ) {
      if ( options.timestamp === false ) {
        label = options.label
      } else {
        label = '[' + time + '] ' + options.label
      }
    } else if ( options.timestamp !== false ) {
      label = '[' + time + '] '
    }

    let content = '\n'
    if ( options.content ) {
      switch ( typeof options.content ) {
        case 'string':
          if ( options.content.length ) {
            content = '\n    ' + options.content + '\n'
          } else {
            content = '\n(empty string)\n'
          }
          break
        case 'number':
          content = '\n    ' + options.content + '\n'
          break
        default:
          content = '\n    ' + util.inspect(options.content, { depth: depth, colors: false, showHidden: showHidden }) + '\n'
          break
      }
    }

    let dividerBottom = ''
    if ( options.divider && options.divider.bottom ) {
      // Default divider
      if ( options.divider.bottom === true ) {
        dividerBottom = '\n----------------------------------------------------------------------\n\n'
      // Custom divider
      } else {
        dividerBottom = options.divider.bottom
      }
    }

    let file = options.file || ( type === 'access' ? 'access.log' : 'error.log' ),
        log  = dividerTop + label + content + dividerBottom
    fs.appendFile(CTZN.config.citizen.directories.logs + '/' + file, log, function (err) {
      if ( err ) {
        switch ( err.code ) {
          case 'ENOENT':
            console.log('Error in app.log(): Unable to write to the log file because the specified log file path doesn\'t exist:\n\n')
            console.log('  ' + CTZN.config.citizen.directories.logs + '\n\n')
            console.log('Please set a valid file path in your citizen configuration.')
            break
          default:
            console.log('Error in app.log(): There was a problem writing to the log file:\n\n')
            console.log('  ' + CTZN.config.citizen.directories.logs + '/' + file + '\n\n')
            console.log(err)
            break
        }
      }
    })
  }
}


const serverLogLabel = (statusCode, params, request) => {
  return statusCode + ' ' + http.STATUS_CODES[statusCode] + ' ' + request.method + ' ' + params.route.url +  ' ' + request.remoteAddress + ' "' + request.headers['user-agent'] + '"'
}


export default { copy, extend, log, serverLogLabel }
export { log }
