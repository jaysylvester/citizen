// server

// node
import events            from 'node:events'
import fs                from 'node:fs'
import fsPromises        from 'node:fs/promises'
import http              from 'node:http'
import https             from 'node:https'
import querystring       from 'node:querystring'
import { StringDecoder } from 'node:string_decoder'
import util              from 'node:util'
import zlib              from 'node:zlib'
// citizen
import helpers           from './helpers.js'
import cache             from './cache.js'
import router            from './router.js'
import session           from './session.js'

const
  // Promisify zlib methods
  compress = {
    deflate : util.promisify(zlib.deflate),
    gzip    : util.promisify(zlib.gzip)
  },
  // server events
  server = new events.EventEmitter()


// Global promise unhandledRejection handler
process.on('unhandledRejection', (reason, promise) => {
  helpers.log({
    type    : 'error',
    label   : 'Unhandled promise rejection',
    content : 'Promise:\n' + util.inspect(promise) + '\n\nReason:\n' + reason.stack
  })
})


// Server event handlers

server.on('applicationStart', async (options) => {
  CTZN.config = helpers.extend(CTZN.config, options)
  global.app.config = CTZN.config
  await CTZN.hooks.citizen.application.start()
  if ( CTZN.hooks.app.application && CTZN.hooks.app.application.start ) {
    await CTZN.hooks.app.application.start(CTZN.config)
  }
  createServer()
})


server.on('requestStart', async (params, request, response) => {
  let context = {}

  // Set the session parameters if sessions are enabled and a session exists
  if ( CTZN.config.citizen.sessions.enabled && params.cookie.ctzn_sessionID ) {
    params.session = CTZN.sessions[params.cookie.ctzn_sessionID] || params.session
  }

  try {
    let requestStart = await CTZN.hooks.citizen.request.start(params, request, response, context)
    context = helpers.extend(context, requestStart)
    
    if ( CTZN.hooks.app.request && CTZN.hooks.app.request.start ) {
      requestStart = await CTZN.hooks.app.request.start(params, request, response, context)
      context = helpers.extend(context, requestStart)

      // Set headers based on controller action headers
      if ( context.headers ) {
        context.headersLowercase = {}
        Object.keys(context.headers).forEach( item => {
          response.setHeader(item, context.headers[item])
          // Create lowercase version of header name for easier comparison later
          context.headersLowercase[item.toLowerCase()] = context.headers[item]
        })
        delete context.headers
      }
    }
    server.emit('request', params, request, response, context)
  } catch (err) {
    server.emit('error', params, request, response, context, err)
  }
})


server.on('request', function (params, request, response, context) {
  // If a previous event in the request context requested a redirect, do it immediately.
  if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && !params.route.direct ) {
    redirect(params, request, response, context, false)
  } else {
    let controllerName = params.route.controller || CTZN.config.citizen.fallbackController

    // If the controller exists, extend the global config with the controller config
    if ( CTZN.patterns.controllers[controllerName] && CTZN.patterns.controllers[controllerName][params.route.action] ) {
      extendConfig(params, controllerName, params.route.action)

      let corsSession = false,
          respond     = true,
          originRegex = new RegExp('^' + params.route.base + '$')

      // If the Origin header exists and it's not the host, check if it's allowed. If not,
      // throw an appropriate error.
      if ( request.headers.origin && !originRegex.test(request.headers.origin) ) {
        const failed = (statusCode) => {
                respond = false
                let err = new Error()
                err.statusCode = statusCode
                server.emit('error', params, request, response, context, err)
              }

        request.cors = true

        if ( params.config.citizen.cors ) {
          // Create lowercase version of headers for easier comparison, while maintaining case for sent header
          params.config.citizen.corsLowerCase = {}
          Object.keys(params.config.citizen.cors).forEach( item => {
            params.config.citizen.corsLowerCase[item.toLowerCase()] = params.config.citizen.cors[item]
          })

          let allowOriginRegex  = new RegExp('^' + request.headers.origin + '$'),
              allowMethodsRegex = new RegExp(request.method)

          // If the request origin matches the CORS allowed origin, proceed.
          if ( params.config.citizen.corsLowerCase['access-control-allow-origin'] && ( params.config.citizen.corsLowerCase['access-control-allow-origin'] === '*' ) || allowOriginRegex.test(params.config.citizen.corsLowerCase['access-control-allow-origin']) ) {
            // If the request method isn't allowed, respond with a 405
            if ( allowMethodsRegex.test(params.config.citizen.corsLowerCase['access-control-allow-methods']) ) {
              // Respond with the headers from the controller. The processRequest() function
              // will determine whether to end the request in the case of an OPTIONS method
              // (preflight request) or fire the controller.
              Object.keys(params.config.citizen.cors).forEach( item => {
                response.setHeader(item, params.config.citizen.cors[item])
              })

              // Only create a session if Access-Control-Allow-Credentials is set and it's
              // not a preflight request.
              if ( request.method !== 'OPTIONS' && params.config.citizen.corsLowerCase['access-control-allow-credentials'] ) {
                corsSession = true
              }
            } else {
              failed(405)
            }
          } else {
            failed(403)
          }
        } else {
          failed(403)
        }
      }

      if ( respond ) {
        if ( params.config.citizen.sessions.enabled && ( !request.cors || ( request.cors && corsSession ) ) ) {
          server.emit('sessionStart', params, request, response, context)
        } else {
          processRequest(params, request, response, context)
        }
      }
    // If the controller doesn't exist, throw a 404
    } else {
      let err = new Error()
      err.statusCode = 404
      server.emit('error', params, request, response, {}, err)
    }
  }
})


server.on('sessionStart', async (params, request, response, context) => {
  var sessionID = 0

  if ( params.cookie.ctzn_sessionID && CTZN.sessions[params.cookie.ctzn_sessionID] && CTZN.sessions[params.cookie.ctzn_sessionID].expires > Date.now() ) {
    session.extend(params.cookie.ctzn_sessionID)
    params.session = CTZN.sessions[params.cookie.ctzn_sessionID]
    try {
      setSession(params, request, response, context)
      processRequest(params, request, response, context)
    } catch (err) {
      server.emit('error', params, request, response, context, err)
    }
  } else {
    sessionID = session.create(request)
    context.cookies = context.cookies || {}
    context.cookies.ctzn_sessionID = sessionID
    params.session = CTZN.sessions[sessionID]
    
    try {
      let sessionStart = await CTZN.hooks.citizen.session.start(params, request, response, context)
      context = helpers.extend(context, sessionStart)
      if ( CTZN.hooks.app.session && CTZN.hooks.app.session.start ) {
        sessionStart = await CTZN.hooks.app.session.start(params, request, response, context)
        context = helpers.extend(context, sessionStart)
      }
      setSession(params, request, response, context)
      processRequest(params, request, response, context)
    } catch (err) {
      server.emit('error', params, request, response, context, err)
    }
  }
})


server.on('requestEnd', async (params, request, response, context) => {
  try {
    let requestEnd = await CTZN.hooks.citizen.request.end(params, request, response, context)
    context = helpers.extend(context, requestEnd)
    if ( CTZN.hooks.app.request && CTZN.hooks.app.request.end ) {
      requestEnd = await CTZN.hooks.app.request.end(params, request, response, context)
      context = helpers.extend(context, requestEnd)
    }
    setSession(params, request, response, context)
    server.emit('responseStart', params, request, response, context)
  } catch (err) {
    server.emit('error', params, request, response, context, err)
  }
})


server.on('responseStart', async (params, request, response, context) => {
  try {
    let responseStart = await CTZN.hooks.citizen.response.start(params, request, response, context)

    context = helpers.extend(context, responseStart)
    
    if ( CTZN.hooks.app.response && CTZN.hooks.app.response.start ) {
      responseStart = await CTZN.hooks.app.response.start(params, request, response, context)
      context = helpers.extend(context, responseStart)
      serverResponse(params, request, response, context)
    } else {
      serverResponse(params, request, response, context)
    }
  } catch (err) {
    server.emit('error', params, request, response, context, err)
  }
})


server.on('responseEnd', async (params, request, response, context) => {
  try {
    let responseEnd = await CTZN.hooks.citizen.response.end(params, request, response, context)

    context = helpers.extend(context, responseEnd)
    
    if ( CTZN.hooks.app.response && CTZN.hooks.app.response.end ) {
      responseEnd = await CTZN.hooks.app.response.end(params, request, response, context)
      context = helpers.extend(context, responseEnd)
    }
  } catch (err) {
    server.emit('error', params, request, response, context, err)
  }
})


server.on('error', async (params, request, response, context, err, respond = true) => {
  let statusCode = err.statusCode || 500,
      label      = err.label      || statusCode + ' ' + http.STATUS_CODES[statusCode],
      logContent = err.message    || false,
      result     = err.result     || params.config.citizen.errors,
      view       = 'error'

  if ( statusCode >= 500 ) {
    logContent = err.stack ? err.stack : util.inspect(err)
  } else if ( statusCode === 404 && request.headers.referer ) {
    logContent = '(Referrer: ' + request.headers.referer + ')'
  }

  helpers.log({
    type    : 'error',
    label   : helpers.serverLogLabel(statusCode, params, request),
    content : logContent
  })

  // Run the application error event hook for 500-level errors
  if ( statusCode >= 500 ) {
    try {
      await CTZN.hooks.citizen.application.error(params, request, response, context, err)
      if ( CTZN.hooks.app.application && CTZN.hooks.app.application.error ) {
        await CTZN.hooks.app.application.error(params, request, response, context, err)
      }
    } catch ( err ) {
      helpers.log({
        type    : 'error',
        label   : 'Application error handler failed',
        content : err.stack ? err.stack : util.inspect(err)
      })
    }
  }

  if ( params && !response.writableEnded ) {
    response.statusCode = statusCode

    // Default behavior on error is "capture". If set to "exit", allow the error
    // to exit the process.
    if ( result === 'exit' ) {
      response.end()
      throw err
    }

    if ( respond ) {
      let controller = params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].controller,
          error = {
            errorCode  : err.code,
            statusCode : statusCode,
            label      : label,
            message    : err.message,
            raw        : err,
            stack      : err.stack
          }
      
      // Wipe the context and controller chain
      context = {
        local: {
          error: error
        }
      }
      params.route.chain = {}
      
      params.local = {
        error: error
      }
  
      switch ( response.contentType ) {
        case 'text/html':
        case 'text/plain':
          // Render an error view with full layout if they exist
          if ( CTZN.patterns.views.error ) {
            if ( CTZN.patterns.views.error[err.code] ) {
              view = err.code
            } else if ( CTZN.patterns.views.error[statusCode] ) {
              view = statusCode
            }
      
            // Hand off the error to the layout controller if there is one, as long as the error
            // didn't originate in the layout controller itself.
            if ( params.config.citizen.layout.controller.length && controller !== params.config.citizen.layout.controller ) {
              context.handoff = params.config.citizen.layout
            }
            params.route.chain.error = {
              controller: 'error',
              action: '',
              view: view,
              params: helpers.copy(params),
              context: context
            }
          // Render only the error
          } else {
            params.route.chain.error = {
              controller: 'error',
              action: '',
              view: '',
              params: helpers.copy(params),
              context: context,
              output: '<pre>' + context.local.error.message + '</pre>'
            }
          }
          break
        // Render only the error in whatever format was requested
        default:
          params.route.chain.error = {
            controller: 'error',
            action: '',
            view: '',
            params: helpers.copy(params),
            context: context
          }
      }

      handoff(params, request, response, context)
    }
  } else {
    // Default behavior on error is "capture". If set to "exit", allow the error
    // to exit the process.
    if ( result === 'exit' ) {
      throw err
    }
  }
})


// Server functions

export const start = (options) => {
  server.emit('applicationStart', options)
}


function createServer() {
  let modeMessage = ''

  switch ( CTZN.config.citizen.mode ) {
    case 'development':
      modeMessage += '\n' +
                     '\n  citizen is in development mode, which enables verbose console logs and' +
                     '\n  disables view template caching, degrading performance.' +
                     '\n' +
                     '\n  To enable production mode, set your NODE_ENV variable to "production" or' +
                     '\n  manually change the citizen config mode to "production".' +
                     '\n' +
                     '\n  Consult the README for details.'
      break
    case 'production':
      modeMessage += '\n' +
                     '\n  citizen is in production mode, which disables console logs and enables view' +
                     '\n  caching. Debug content can be logged to a file by setting logs.debug to true' +
                     '\n  in your citizen config, but your log file size will explode.'
                     '\n' +                        
                     '\n  To enable development mode, set your NODE_ENV variable to "development" or' +
                     '\n  manually change the citizen mode setting to "development".' +
                     '\n' +
                     '\n  Consult the README for details.'
      break
  }

  if ( CTZN.config.citizen.http.enabled ) {
    const httpServer = http.createServer((request, response) => {
            serve(request, response, 'http')
          })

    httpServer.keepAliveTimeout = CTZN.config.citizen.http.keepAliveTimeout || httpServer.keepAliveTimeout
    httpServer.maxHeadersCount  = CTZN.config.citizen.http.maxHeadersCount  || httpServer.maxHeadersCount
    httpServer.requestTimeout   = CTZN.config.citizen.http.requestTimeout   || httpServer.requestTimeout
    httpServer.timeout          = CTZN.config.citizen.http.timeout          || httpServer.timeout
    
    let appUrl = 'http://' + ( CTZN.config.citizen.http.hostname.length ? CTZN.config.citizen.http.hostname : '127.0.0.1' ) + ( CTZN.config.citizen.http.port === 80 ? '' : ':' + CTZN.config.citizen.http.port )

    httpServer.listen(CTZN.config.citizen.http.port, CTZN.config.citizen.http.hostname, CTZN.config.citizen.connectionQueue, function () {
      let startupMessage = '\nHTTP server started\n' +
                            '\n  Application mode:  ' + CTZN.config.citizen.mode +
                            '\n  Port:              ' + CTZN.config.citizen.http.port +
                            '\n  Local URL:         ' + appUrl

      if ( !CTZN.config.citizen.http.hostname.length ) {
        startupMessage += '\n\n  You\'ve specified an empty hostname, so the server will respond to requests at any host.'
      }

      startupMessage += modeMessage

      helpers.log({
        content: startupMessage,
        console: true,
        timestamp: false
      })
    })

    httpServer.on('error', (err) => {
      switch ( err.code ) {
        case 'EACCES':
          helpers.log({
            content: '\nHTTP server startup failed because port ' + CTZN.config.citizen.http.port + ' isn\'t open. Please open this port or set an alternate port for HTTP traffic in your config file using the "citizen.http.port" setting.\n',
            console: true,
            timestamp: false
          })
          break
        case 'EADDRINUSE':
          helpers.log({
            content: '\nHTTP server startup failed because port ' + CTZN.config.citizen.http.port + ' is already in use. Please set an alternate port for HTTP traffic in your config file using the "citizen.http.port" setting.\n',
            console: true,
            timestamp: false
          })
          break
        case 'ENOTFOUND':
          helpers.log({
            content: '\nHTTP server startup failed because the hostname you specified in your config ("' + CTZN.config.citizen.http.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
            console: true,
            timestamp: false
          })
          break
        case 'EADDRNOTAVAIL':
          helpers.log({
            content: '\nHTTP server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.http.hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
            console: true,
            timestamp: false
          })
          break
        default:
          helpers.log({
            content: '\nThere was a problem starting the server. The port and hostname you specified in your config file appear to be available, so please review your other settings and make sure everything is correct.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code along with the contents of your config file to:\n\nhttps://github.com/jaysylvester/citizen/issues\n\nThe full error is below:\n\n' + err,
            console: true,
            timestamp: false
          })
          break
      }

      process.exit(1)
    })
  }

  if ( CTZN.config.citizen.https.enabled ) {
    let startHttps = true,
        httpsOptions = helpers.copy(CTZN.config.citizen.https)

    try {
      if ( CTZN.config.citizen.https.pfx ) {
        httpsOptions.pfx = fs.readFileSync(CTZN.config.citizen.https.pfx)
      } else if ( CTZN.config.citizen.https.key && CTZN.config.citizen.https.cert ) {
        httpsOptions.key = fs.readFileSync(CTZN.config.citizen.https.key)
        httpsOptions.cert = fs.readFileSync(CTZN.config.citizen.https.cert)
      } else {
        throw new Error('HTTPS requires either a key/cert file pair or PFX file, and your config file has specified neither.')
      }
    } catch (err) {
      startHttps = false
      helpers.log({
        label: 'HTTPS server startup failed because there was a problem trying to read your key/cert file(s).',
        content: err
      })
      process.exit(1)
    }
    
    if ( startHttps ) {
      const httpsServer = https.createServer(httpsOptions, (request, response) => {
              serve(request, response, 'https')
            })

      httpsServer.keepAliveTimeout = CTZN.config.citizen.http.keepAliveTimeout || httpsServer.keepAliveTimeout
      httpsServer.maxHeadersCount  = CTZN.config.citizen.http.maxHeadersCount  || httpsServer.maxHeadersCount
      httpsServer.requestTimeout   = CTZN.config.citizen.http.requestTimeout   || httpsServer.requestTimeout
      httpsServer.timeout          = CTZN.config.citizen.http.timeout          || httpsServer.timeout

      let appUrl = 'https://' + ( CTZN.config.citizen.https.hostname.length ? CTZN.config.citizen.https.hostname : '127.0.0.1' ) + ( CTZN.config.citizen.http.port === 443 ? '' : ':' + CTZN.config.citizen.http.port )
      
      httpsServer.listen(CTZN.config.citizen.https.port, CTZN.config.citizen.https.hostname, CTZN.config.citizen.connectionQueue, function () {
        let startupMessage = '\nHTTPS server started\n' +
                              '\n  Application mode:  ' + CTZN.config.citizen.mode +
                              '\n  Port:              ' + CTZN.config.citizen.https.port +
                              '\n  Local URL:         ' + appUrl

        if ( !CTZN.config.citizen.https.hostname.length ) {
          startupMessage += '\n\n  You\'ve specified an empty hostname, so the server will respond to requests at any host.'
        }

        startupMessage += modeMessage

        helpers.log({
          content: startupMessage,
          console: true,
          timestamp: false
        })
      })

      httpsServer.on('error', (err) => {
        switch ( err.code ) {
          case 'EACCES':
            helpers.log({
              content: '\nHTTPS server startup failed because port ' + CTZN.config.citizen.https.port + ' isn\'t open. Please open this port or set an alternate port for HTTPS traffic in your config file using the "citizn.https.port" setting.\n',
              console: true,
              timestamp: false
            })
            break
          case 'EADDRINUSE':
            helpers.log({
              content: '\nHTTPS server startup failed because port ' + CTZN.config.citizen.https.port + ' is already in use. Please set an alternate port for HTTPs traffic in your config file using the "citizen.https.port" setting.\n',
              console: true,
              timestamp: false
            })
            break
          case 'ENOTFOUND':
            helpers.log({
              content: '\nHTTPS server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.https.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
              console: true,
              timestamp: false
            })
            break
          case 'EADDRNOTAVAIL':
            helpers.log({
              content: '\nHTTPS server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.https.hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
              console: true,
              timestamp: false
            })
            break
          case 'ENOENT':
            helpers.log({
              content: '\nHTTPS server startup failed because citizen couldn\'t find the PFX or key/cert files you specified.\n',
              console: true,
              timestamp: false
            })
            break
          case 'NOPFXORKEYCERT':
            helpers.log({
              content: '\nHTTPS server startup failed because you didn\'t provide the necessary key files. You need to specify either a PFX file or key/cert pair.\n',
              console: true,
              timestamp: false
            })
            break
          default:
            helpers.log({
              content: '\nThere was a problem starting the server. The port and hostname you specified in your config file appear to be available, so please review your other settings and make sure everything is correct.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code along with the contents of your config file to:\n\nhttps://github.com/jaysylvester/citizen/issues\n\nThe full error is below:\n\n' + err,
              console: true,
              timestamp: false
            })
            break
        }

        process.exit(1)
      })
    }
  }
}


async function serve(request, response, protocol) {
  let forwardedHeader = request.headers.forwarded ? request.headers.forwarded.trim().split(';').filter(item => item) : false,
      forwardedHeaderProperties = {}
      
  if ( forwardedHeader ) {
    for ( let i = 0; i < forwardedHeader.length; i++ ) {
      forwardedHeader[i] = forwardedHeader[i].split('=')
      forwardedHeaderProperties[forwardedHeader[i][0]] = forwardedHeader[i][1]
    }
    request.headers.forwardedParsed = forwardedHeaderProperties
  }

  let route = router.parseRoute(request, protocol),
      params = {
        config  : helpers.copy(CTZN.config),
        cookie  : parseCookie(request.headers.cookie),
        form    : {},
        payload : {},
        route   : route,
        session : {},
        url     : route.urlParams
      }
  
  // Prevents further response execution when the client arbitrarily closes the connection, which
  // helps conserve resources.
  response.on('close', function () {
    if ( !response.writableEnded ) {
      response.end()
      helpers.log({
        label: 'Connection closed',
        content: ' (Route: ' + params.route.url + ')'
      })
    }
  })

  request.remoteAddress = request.headers.forwardedParsed?.for || request.headers['x-forwarded-for'] || request.socket.remoteAddress
  response.encoding = CTZN.config.citizen.compression.force || 'identity'

  let compressable = CTZN.config.citizen.compression.enabled && !CTZN.config.citizen.compression.force && ( !params.route.isStatic || CTZN.config.citizen.compression.mimeTypes.indexOf(router.staticMimeTypes[params.route.extension]) >= 0 )

  // Determine client encoding support for compressable assets. Can be forced via config.citizen.compression.force
  if ( compressable ) {
    let acceptEncoding = request.headers['accept-encoding'] ? request.headers['accept-encoding'].split(',') : [],
        encoding = [],
        weight = 0

    for ( let i = 0; i < acceptEncoding.length; i++ ) {
      acceptEncoding[i] = acceptEncoding[i].trim().split(';')
      acceptEncoding[i][1] = acceptEncoding[i][1] ? +querystring.parse(acceptEncoding[i][1]).q : '1'
    }

    for ( let i = 0; i < acceptEncoding.length; i++ ) {
      if ( acceptEncoding[i][1] > weight ) {
        encoding.unshift([acceptEncoding[i][0], acceptEncoding[i][1]])
        weight = acceptEncoding[i][1]
      } else {
        encoding.push([acceptEncoding[i][0], acceptEncoding[i][1]])
      }
    }

    for ( let i = 0; i < encoding.length; i++ ) {
      // Use the appropriate encoding if it's supported
      if ( encoding[i][1] && ( encoding[i][0] === 'gzip' || encoding[i][0] === 'deflate' || encoding[i][0] === 'identity' ) ) {
        response.encoding = encoding[i][0]
        break
      }
    }
  }

  // If it's a dynamic page request, set the content type and check for the controller.
  // Otherwise, serve the static asset.
  if ( !params.route.isStatic ) {
    // Determine preferred format requested by client
    let acceptFormat = request.headers['accept'] && request.headers['accept'].length ? request.headers['accept'].split(',') : helpers.copy(CTZN.config.citizen.contentTypes),
        format = [],
        weight = 0
    
    for ( let i = 0; i < acceptFormat.length; i++ ) {
      acceptFormat[i] = acceptFormat[i].trim().split(';')
      acceptFormat[i][1] = acceptFormat[i][1] ? +querystring.parse(acceptFormat[i][1]).q : '1'
    }

    for ( let i = 0; i < acceptFormat.length; i++ ) {
      if ( acceptFormat[i][1] > weight ) {
        format.unshift([acceptFormat[i][0], acceptFormat[i][1]])
        weight = acceptFormat[i][1]
      } else {
        format.push([acceptFormat[i][0], acceptFormat[i][1]])
      }
    }

    for ( let i = 0; i < format.length; i++ ) {
      // Choose the MIME type with the highest weight, or default to text/plain
      if ( format[i][1] ) {
        switch ( format[i][0] ) {
          case 'text/html':
            response.contentType = 'text/html'
            response.setHeader('Content-Type', 'text/html')
            break
          case 'application/json':
            response.contentType = 'application/json'
            response.setHeader('Content-Type', 'application/json')
            break
          case 'application/javascript':
            response.contentType = 'application/javascript'
            response.setHeader('Content-Type', 'application/javascript')
            break
          default:
            response.contentType = 'text/plain'
            response.setHeader('Content-Type', 'text/plain')
            break
        }
        break
      }
    }

    // Emit the requestStart event
    server.emit('requestStart', params, request, response)
  } else {
    let staticPath = CTZN.config.citizen.directories.web + params.route.filePath,
        cachedFile = CTZN.config.citizen.cache.static.enabled ? cache.get({ file: staticPath, output: 'all' }) : false,
        lastModified

    response.setHeader('Content-Type', router.staticMimeTypes[params.route.extension])
    response.setHeader('Cache-Control', 'max-age=0' )

    if ( CTZN.config.citizen.cache.control[params.route.pathname] ) {
      response.setHeader('Cache-Control', CTZN.config.citizen.cache.control[params.route.pathname] )
    } else {
      for ( var controlHeader in CTZN.config.citizen.cache.control ) {
        if ( new RegExp(controlHeader).test(params.route.pathname) ) {
          response.setHeader('Cache-Control', CTZN.config.citizen.cache.control[controlHeader] )
        }
      }
    }

    if ( cachedFile ) {
      lastModified = cachedFile.stats.mtime.toISOString()

      response.setHeader('ETag', lastModified)

      if ( request.headers['if-none-match'] == lastModified ) {
        response.setHeader('Date', lastModified)
        response.statusCode = 304
        response.end()
      } else {
        response.setHeader('Content-Encoding', response.encoding)
        response.end(request.headers.method !== 'HEAD' ? cachedFile.value[response.encoding] : null)
      }

      helpers.log({
        type: 'access',
        label: helpers.serverLogLabel(response.statusCode, params, request)
      })
    } else {
      fs.readFile(staticPath, function (err, data) {
        if ( !err ) {
          fs.stat(staticPath, async (err, stats) => {
            lastModified = stats.mtime.toISOString()

            if ( !response.headersSent ) {
              response.setHeader('ETag', lastModified)
  
              if ( request.headers['if-none-match'] == lastModified ) {
                response.setHeader('Date', lastModified)
                response.statusCode = 304
                response.end()
              } else {
                if ( CTZN.config.citizen.compression.enabled && compressable ) {
                  let [
                    gzip,
                    deflate
                  ] = await Promise.all([
                    CTZN.config.citizen.cache.static.enabled || response.encoding === 'gzip' ? compress.gzip(data) : false,
                    CTZN.config.citizen.cache.static.enabled || response.encoding === 'deflate' ? compress.deflate(data) : false
                  ]).catch(err => { server.emit('error', params, request, response, {}, err) })
  
                  let compressed = {
                    gzip    : gzip,
                    deflate : deflate
                  }
  
                  if ( !response.headersSent ) {
                    response.setHeader('Content-Encoding', response.encoding)
                    response.end(request.headers.method !== 'HEAD' ? compressed[response.encoding] : null)
                  }

                  if ( CTZN.config.citizen.cache.static.enabled ) {
                    try {
                      cache.set({
                        file: staticPath,
                        value: {
                          identity: data,
                          gzip: gzip,
                          deflate: deflate
                        },
                        stats: stats,
                        lifespan: CTZN.config.citizen.cache.static.lifespan,
                        resetOnAccess: CTZN.config.citizen.cache.static.resetOnAccess
                      })
                    } catch ( err ) {
                      server.emit('error', params, request, response, {}, err)
                    }
                  }
                } else {
                  response.setHeader('Content-Encoding', response.encoding)
                  response.end(request.headers.method !== 'HEAD' ? data : null)
  
                  if ( CTZN.config.citizen.cache.static.enabled ) {
                    try {
                      cache.set({
                        file: staticPath,
                        value: {
                          identity: data
                        },
                        stats: stats,
                        lifespan: CTZN.config.citizen.cache.static.lifespan,
                        resetOnAccess: CTZN.config.citizen.cache.static.resetOnAccess
                      })
                    } catch ( err ) {
                      server.emit('error', params, request, response, {}, err)
                    }
                  }
                }
              }
  
              helpers.log({
                type: 'access',
                label: helpers.serverLogLabel(response.statusCode, params, request)
              })
            }
          })
        } else {
          response.statusCode = 404
          response.end()

          helpers.log({
            type: 'error',
            label: helpers.serverLogLabel(response.statusCode, params, request)
          })
        }
      })
    }
  }
}


function serverResponse(params, request, response, context) {
  let routeCache = cache.getRoute({
        route: params.route.pathname,
        contentType: response.contentType
      })

  setSession(params, request, response, context)

  if ( routeCache ) {
    setCookies(params, request, response, context)

    // Set response headers based on cached context
    if ( routeCache.context.headers ) {
      Object.keys(routeCache.context.headers).forEach( item => {
        response.setHeader(item, routeCache.context.headers[item])
      })
    }
    response.setHeader('ETag', routeCache.lastModified)

    if ( request.headers['if-none-match'] == routeCache.lastModified ) {
      response.setHeader('Date', routeCache.lastModified)
      response.statusCode = 304
      response.end()
    } else {
      response.setHeader('Content-Type', response.contentType)
      response.setHeader('Content-Encoding', response.encoding)
      response.end(request.headers.method !== 'HEAD' ? routeCache.output[response.encoding] : null)
    }
    server.emit('responseEnd', params, request, response, context)
  } else {
    fireController(params, request, response, context)
  }
}


function setSession(params, request, response, context, system) {
  if ( CTZN.config.citizen.sessions.enabled && context.session && ( !request.headers.origin || ( request.headers.origin && request.headers.origin.search(request.headers.host) ) ) && Object.keys(context.session).length ) {
    if ( context.session.expires && context.session.expires === 'now' ) {
      session.end(params.session.id)
      context.cookies = helpers.extend(context.cookies, { ctzn_sessionID: { expires: 'now' }})
      params.session = {}
    } else {
      Object.keys(context.session).forEach( item => {
        if ( CTZN.reserved.session.indexOf(item) < 0 || system ) {
          CTZN.sessions[params.session.id][item] = context.session[item]
        } else {
          throw new Error('"' + item + '" is a reserved session variable name used internally by citizen. Please choose a different variable name.')
        }
      })
      params.session = CTZN.sessions[params.session.id]
    }
    delete context.session
  }
}


function setCookies(params, request, response, context) {
  if ( context.cookies ) {
    var cookie = buildCookie(params, request, context.cookies)
  
    if ( cookie.length ) {
      response.setHeader('Set-Cookie', cookie)
    }
  }
}


async function processRequest(params, request, response, context) {
  let payload = '',
      requestContentType = request.headers['content-type'] || ''
  
  const maxPayloadExceeded = (clientError = true) => {
          let err = new Error('The payload size for this request exceeded the maximum limit specified in the server configuration.')
          err.statusCode = 413
          server.emit('error', params, request, response, context, err, clientError)
        }

  switch ( request.method ) {
    case 'OPTIONS':
      response.end()
      server.emit('responseEnd', params, request, response, context)
      break
    case 'GET':
    case 'HEAD': // nice
      server.emit('requestEnd', params, request, response, context)
      break
    // Requests that can have payloads
    case 'DELETE':
    case 'PATCH':
    case 'POST':
    case 'PUT':
      if ( requestContentType.startsWith('multipart/form-data') ) {
        requestContentType = 'multipart/form-data'
      }

      if ( params.config.citizen.forms.enabled ) {
        if ( request.headers['content-length'] < params.config.citizen.forms.maxPayloadSize ) {
          // Concatenate chunks to build the full payload. Decode as binary to preserve
          // images in multipart form data.
          let stringDecoder = new StringDecoder('binary')
  
          request.on('data', (chunk) => {
            let decodedChunk = stringDecoder.write(chunk)
            if ( payload.length + decodedChunk.length < params.config.citizen.forms.maxPayloadSize ) {
              payload += decodedChunk
            } else {
              // This will close the connection without sending an error to the client,
              // but if the Content-Length header was wrong and the payload is larger
              // than promised, it's the client's fault. Assume malicious intent.
              request.destroy()
              maxPayloadExceeded(false)
            }
          })
  
          request.on('end', async () => {
            if ( payload.length ) {
              let boundary = '',
                  fieldContent = [],
                  fields = {}
              
              // Store the raw payload for dev access if desired
              request.payload = payload
              
              try {
                switch ( requestContentType ) {
                  case 'application/json':
                    params.payload = JSON.parse(payload)
                    break
                  case 'application/x-www-form-urlencoded':
                    params.payload = Object.assign({}, querystring.parse(payload))
                    params.form    = helpers.copy(params.payload)
                    break
                  case 'multipart/form-data':
                    boundary     = '--' + request.headers['content-type'].slice(30)
                    fieldContent = payload.split(boundary)
  
                    // The payload boundary results in garbage strings in the first and last indexes,
                    // so start with the second index and end with the next-to-last index.
                    for ( let field = 1; field < fieldContent.length - 1; field++ ) {
                      fieldContent[field].replace(/Content-Disposition: form-data; (.+)\r\n(Content-Type: (.+)\r\n)?\r\n([^]+)\r\n/, (match, $directives, $contentTypeExists, $contentType, $value) => {
                        let directives = querystring.parse($directives.replace(/; /g, '&')),
                            fieldName  = directives.name.replace(/"/g, '')
  
                        // If Content-Type exists, it's a file.
                        if ( $contentTypeExists ) {
                          // ------boundary
                          // Content-Disposition: form-data; name="field_name"; filename="file.name"
                          // Content-Type: file/type
                          // 
                          // <file contents>
                          // ------boundary
                          let fileName = directives.filename.replace(/"/g, '')
  
                          fields[fieldName] = fields[fieldName] || {}
                          fields[fieldName][fileName] = {
                            filename    : fileName,
                            contentType : $contentType,
                            binary      : $value
                          }
                        } else {
                          // ------boundary
                          // Content-Disposition: form-data; name="field_name"
                          // 
                          // field contents
                          // ------boundary
                          fields[fieldName] = $value
                        }
                      })
                    }
  
                    params.form = fields
                    break
                }
              } catch ( err ) {
                server.emit('error', params, request, response, context, err)
              }
            }
  
            helpers.log({
              label: 'Payload received and parsed (' + request.headers['content-type'] + ')'
            })
  
            server.emit('requestEnd', params, request, response, context)
          })
        } else {
          maxPayloadExceeded()
        }
      } else {
        server.emit('requestEnd', params, request, response, context)
      }
      break
  }
}


async function fireController(params, request, response, context) {
  let controller = context.handoff?.controller || params.route.controller,
      action = context.handoff?.action || params.route.action,
      view = context.handoff?.view || context.view || params.route.controller,
      controllerParams = helpers.copy(params),
      proceed = true

  if ( context.handoff?.params ) {
    controllerParams.route = context.handoff.params.route
    controllerParams.url = context.handoff.params.url
  }

  // Clear the previous controller's handoff directive
  delete context.handoff

  // Check the controller cache
  params.route.chain[controller] = cache.getController({
                                     controller  : controller,
                                     action      : action,
                                     view        : view,
                                     route       : 'global',
                                     contentType : response.contentType })
                                   ||
                                   cache.getController({
                                     controller  : controller,
                                     action      : action,
                                     view        : view,
                                     route       : params.route.pathname,
                                     contentType : response.contentType })

  // Fire the controller if it isn't cached
  if ( !params.route.chain[controller] ) {
    helpers.log({
      label: 'Firing controller: ' + controller,
      content: {
        controller: controller,
        action: action
      }
    })
    try {
      params.route.chain[controller] = {
        controller : controller,
        action     : action,
        context    : await CTZN.patterns.controllers[controller][action](controllerParams, request, response, context) || {}
      }
    } catch ( err ) {
      proceed = false
      server.emit('error', params, request, response, context, err)
    }
  }

  if ( proceed ) {
    // Extend the chain's context with the controller's returned context
    context = helpers.extend(context, params.route.chain[controller].context)
    // Replace the controller's context with the chain's context
    params.route.chain[controller].context = helpers.copy(context)
    // Append the parameters passed to the controller to the controller object
    // so they can be referenced later.
    params.route.chain[controller].params = controllerParams
    // Append local variables to the controller's context, then clear them from
    // the context so the next controller in the chain won't inherit them.
    params.route.chain[controller].params.local = context.local || {}
    delete context.local
    // Set the controller's view to that specified in the controller's context
    // if it exists.
    params.route.chain[controller].view = params.route.chain[controller].context.view || view

    // Set headers based on controller action headers
    if ( context.headers ) {
      context.headersLowercase = context.headersLowercase || {}
      Object.keys(context.headers).forEach( item => {
        response.setHeader(item, context.headers[item])
        // Create lowercase version of header name for easier comparison later
        context.headersLowercase[item.toLowerCase()] = context.headers[item]
      })
    }

    // If the handoff directive isn't specified, it's the last controller in the chain.
    if ( !context.handoff ) {
      // Check for a layout controller and if it exists, hand off after this controller.
      if ( params.config.citizen.layout.controller.length && controller !== params.config.citizen.layout.controller ) {
        context.handoff = params.config.citizen.layout
      // Enable the JSON output node (controllers earlier in the chain will throw a 404
      // if this parameter is enabled before the requested node is present in the context).
      } else {
        params.route.chain[controller].params.route.output = params.url.output
      }
    }

    // If it's a direct controller request, there are no other controllers in the chain.
    if ( params.url.direct ) {
      params.route.chain[controller].params.route.output = params.url.output
    }

    if ( !response.writableEnded ) {
      if ( proceed ) {
        if ( params.config.citizen.contentTypes.indexOf(response.contentType) >= 0 ) {
          try {
            setSession(params, request, response, context)
          } catch (err) {
            proceed = false
            server.emit('error', params, request, response, context, err)
          }
    
          if ( proceed ) {
            if ( context.redirect && ( typeof context.redirect === 'string' || ( Object.keys(context.redirect).length && typeof context.redirect.refresh === 'undefined' ) ) && !params.route.direct ) {
              setCookies(params, request, response, context)
              redirect(params, request, response, context)
            } else {
              if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && !params.route.direct ) {
                redirect(params, request, response, context)
              }
              let include = context.include || {},
                  includeProperties = Object.getOwnPropertyNames(include),
                  includes = []
                  
              if ( includeProperties.length ) {
                params.route.chain[controller].context.public = params.route.chain[controller].context.public || {}
                let lastLink = params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-2]]
                // If there are previous includes in the chain, copy them into the calling controller's public context
                if ( lastLink && lastLink.context.public && lastLink.context.public.include ) {
                  params.route.chain[controller].context.public.include = helpers.copy(lastLink.context.public.include) || {}
                } else {
                  params.route.chain[controller].context.public.include = {}
                }
                params.route.chain[controller].include = {}
                includeProperties.forEach( function (item, index) {
                  include[item].params = helpers.copy(params)

                  // Create the functions to be fired in parallel
                  includes[index] = ( async () => {
                    if ( !include[item].route ) {
                      include[item].action   = include[item].action || 'handler'
                      include[item].view     = include[item].view || include[item].controller
                      include[item].pathname = params.route.pathname
                    } else {
                      include[item].params.route = router.parseRoute(request, include[item].params.route.protocol, include[item].route)
                      include[item].params.url = include[item].params.route.urlParams
                      include[item].controller = include[item].params.route.controller
                      include[item].action     = include[item].params.route.action
                      include[item].view       = include[item].view || include[item].controller
                      include[item].pathname   = include[item].params.route.pathname
                    }

                    // Reset the config in case it's been extended by the calling controller config
                    include[item].params.config.citizen = helpers.copy(CTZN.config.citizen)
                    // Extend the global config with the include controller config
                    extendConfig(include[item].params, include[item].controller, include[item].action)
                    
                    include[item].cache = cache.getController({
                                            controller  : include[item].controller,
                                            action      : include[item].action,
                                            view        : include[item].view,
                                            route       : 'global',
                                            contentType : response.contentType
                                          })
                                          ||
                                          cache.getController({
                                            controller  : include[item].controller,
                                            action      : include[item].action,
                                            view        : include[item].view,
                                            route       : include[item].pathname,
                                            contentType : response.contentType
                                          })

                    if ( include[item].cache ) {
                      params.route.chain[controller].include[item] = include[item].cache
                      // Append the include's public context to the calling controller's public context
                      params.route.chain[controller].context.public.include[item] = include[item].cache.context.public
                    } else {
                      helpers.log({
                        label: 'Firing include controller: ' + include[item].controller,
                        content: {
                          controller: include[item].controller,
                          action: include[item].action
                        }
                      })
    
                      try {
                        include[item].context = await CTZN.patterns.controllers[include[item].controller][include[item].action](include[item].params, request, response, context) || {}
                        // Append the include's local variables to its parameters
                        include[item].params.local = include[item].context.local || {}

                        // Append the include's public context to the calling controller's public context
                        params.route.chain[controller].context.public.include[item] = include[item].context.public

                        params.route.chain[controller].include[item] = {
                          controller : include[item].controller,
                          action     : include[item].action,
                          // If the include controller specifies a view, use it. Otherwise, use the view
                          // specified by the calling controller (or the default view). Note that using
                          // the view directive in an include controller breaks caching for that controller:
                          // https://github.com/jaysylvester/citizen/issues/67
                          view       : include[item].context.view || include[item].view,
                          params     : include[item].params,
                          context    : include[item].context
                        }
                      } catch (err) {
                        if ( !include[item].controller ) {
                          err.message = 'You must specify a valid controller or route within a citizen include (calling controller: ' + params.route.controller + ').'
                        } else if ( !CTZN.patterns.controllers[include[item].controller] ) {
                          err.message = 'The controller you requested to be included (' + include[item].controller + ') doesn\'t exist.'
                        } else if ( !CTZN.patterns.controllers[include[item].controller][include[item].action] ) {
                          err.message = 'The controller action you requested to be included (' + include[item].controller + '.' + include[item].action + ') doesn\'t exist.'
                        }
                        return Promise.reject(err)
                      }
                    }
                  })()
                })
    
                // If there are any includes, run them.
                if ( includes.length ) {
                  Promise.all(includes).then( () => {
                    delete context.include
                    handoff(params, request, response, context)
                  }).catch(err => { server.emit('error', params, request, response, context, err) })
                } else {
                  delete context.include
                  handoff(params, request, response, context)
                }
              } else {
                handoff(params, request, response, context)
              }
            }
          }
        } else {
          let err = new Error(response.contentType + ' output is not available for this resource. Use the global or controller contentType configuration setting to enable ' + response.contentType + ' output.')
          err.statusCode = 406
          server.emit('error', params, request, response, context, err)
        }
      }
    }
  }
}


function handoff(params, request, response, context) {
  if ( !response.writableEnded ) {
    if ( context.handoff && !params.route.direct ) {
      if ( context.handoff.route ) {
        context.handoff.params = {}
        context.handoff.params.route = router.parseRoute(request, 'http', context.handoff.route)
        context.handoff.params.url = context.handoff.params.route.urlParams
      }
      
      context.handoff.controller = context.handoff.params?.route.controller || context.handoff.controller
      context.handoff.action = context.handoff.params?.route.action || context.handoff.action || 'handler'
      context.handoff.view = context.handoff.params?.route.view || context.handoff.view || context.handoff.controller

      if ( context.cache ) {
        if ( context.cache.route ) {
          delete context.cache.controller
        } else {
          delete context.cache
        }
      }

      delete context.session
      delete context.view

      helpers.log({
        label: 'Handing off to controller: ' + context.handoff.controller
      })

      if ( CTZN.patterns.controllers[context.handoff.controller] ) {
        // Extend the global config with the controller config. We don't reset
        // the config to the original here because we want the config to be
        // inherited from previous controllers in the chain.
        extendConfig(params, context.handoff.controller, context.handoff.action)
        fireController(params, request, response, context)
      } else {
        let err = new Error('The specified handoff controller (' + context.handoff.controller + ') doesn\'t exist.')
        server.emit('error', params, request, response, context, err)
      }
    } else {
      setCookies(params, request, response, context)
      respond(params, request, response, context)
    }
  }
}


function redirect(params, request, response, context, setReferrer) {
  var url = typeof context.redirect === 'string' ? context.redirect : context.redirect.url,
      statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number'

  response.statusCode = statusCode
  setReferrer = setReferrer !== false ? true : false

  if ( refresh ) {
    response.setHeader('Refresh', context.redirect.refresh + ';url=' + url)
  } else {
    if ( setReferrer ) {
      if ( CTZN.config.citizen.sessions.enabled ) {
        if ( context.session ) {
          context.session.ctzn_referer = params.route.parsed.href
        } else {
          context.session = {
            ctzn_referer: params.route.parsed.href
          }
        }
        setSession(params, request, response, context, true)
      } else {
        if ( context.cookies ) {
          context.cookies.ctzn_referer = params.route.parsed.href
        } else {
          context.cookies = {
            ctzn_referer: params.route.parsed.href
          }
        }
        setCookies(params, request, response, context)
      }
    }
    response.writeHead(statusCode, {
      'Location': url
    })
    response.end()
    server.emit('responseEnd', params, request, response, context)
  }
}


async function respond(params, request, response, context) {
  // Render all controllers in the chain
  for ( const link of Object.keys(params.route.chain) ) {
    // Update each controller's params with the final chain so they can access previous rendered views
    params.route.chain[link].params.route.chain = helpers.copy(params.route.chain)

    // Don't render the view if the controller explicitly disallows it
    if ( params.route.chain[link].context.view !== false ) {
      let includeInstance = 0,
          includes = [],
          includeNames = []

      if ( params.route.chain[link].include ) {
        for ( const include of Object.keys(params.route.chain[link].include) ) {
          includeNames[includeInstance] = include
          includes[includeInstance] = ( async () => {
            // If the include was retrieved from the cache by fireController(), use the cached rendering.
            if ( params.route.chain[link].include[include].output ) {
              helpers.log({
                label: 'Using cached include controller rendering: ' + include,
                content: {
                  controller  : params.route.chain[link].include[include].controller,
                  action      : params.route.chain[link].include[include].action,
                  view        : params.route.chain[link].include[include].view
                }
              })
              return params.route.chain[link].include[include].output
            } else {
              let publicContext
              try {
                publicContext = setPublicContext(params, request, response, context, params.route.chain[link].include[include].context, params.route.chain[link].include[include].params)
              } catch ( err ) {
                return Promise.reject(err)
              }

              helpers.log({
                label: 'Rendering include controller: ' + include,
                content: {
                  controller  : params.route.chain[link].include[include].controller,
                  action      : params.route.chain[link].include[include].action,
                  view        : params.route.chain[link].include[include].view
                }
              })
              
              try {
                let output = await renderView(params, request, response, context, {
                  pattern       : params.route.chain[link].include[include].controller,
                  view          : params.route.chain[link].include[include].view,
                  params        : params.route.chain[link].include[include].params,
                  context       : publicContext
                })

                if ( CTZN.config.citizen.cache.application.enabled ) {
                  cacheController({
                    controller    : params.route.chain[link].include[include].controller,
                    action        : params.route.chain[link].include[include].action,
                    view          : params.route.chain[link].include[include].view,
                    route         : params.route.chain[link].include[include].params.route.pathname,
                    contentType   : response.contentType,
                    params        : params.route.chain[link].include[include].params,
                    context       : params.route.chain[link].include[include].context,
                    output        : output
                  })
                }

                return output
              } catch ( err ) {
                return Promise.reject(err)
              }
            }
          })()
  
          includeInstance++
        }
      }
  
      await Promise.all(includes).then( async (results) => {
        // If the output isn't JSON/JSONP, overwrite the public context
        // with the rendered includes.
        if ( results.length && response.contentType !== 'application/json' && response.contentType !== 'application/javascript' ) {
          results.forEach( (item, index) => {
            params.route.chain[link].context.public.include[includeNames[index]] = item
          })
        }
        if ( params.route.chain[link].output ) {
          helpers.log({
            label: 'Using cached controller rendering: ' + link,
            content: {
              controller  : params.route.chain[link].controller,
              action      : params.route.chain[link].action,
              view        : params.route.chain[link].view
            }
          })
        } else {
          let publicContext
          try {
            publicContext = setPublicContext(params, request, response, context, params.route.chain[link].context, params.route.chain[link].params)
          } catch ( err ) {
            server.emit('error', params, request, response, context, err)
          }

          helpers.log({
            label: 'Rendering controller: ' + params.route.chain[link].controller,
            content: {
              controller : params.route.chain[link].controller,
              action     : params.route.chain[link].action,
              view       : params.route.chain[link].view
            }
          })
    
          try {
            params.route.chain[link].output = await renderView(params, request, response, context, {
              pattern       : params.route.chain[link].controller,
              view          : params.route.chain[link].view,
              params        : params.route.chain[link].params,
              context       : publicContext
            })

            if ( CTZN.config.citizen.cache.application.enabled ) {
              cacheController({
                controller    : params.route.chain[link].controller,
                action        : params.route.chain[link].action,
                view          : params.route.chain[link].view,
                route         : params.route.chain[link].params.route.pathname,
                contentType   : response.contentType,
                params        : params.route.chain[link].params,
                context       : params.route.chain[link].context,
                output        : params.route.chain[link].output
              })
            }
          } catch ( err ) {
            server.emit('error', params, request, response, context, err)
          }
        }
      }).catch(err => { server.emit('error', params, request, response, context, err) })
    }
  }

  let lastModified = context.cache && context.cache.route && context.cache.route.lastModified ? context.cache.route.lastModified : new Date().toISOString()

  if ( !response.writableEnded ) {
    response.setHeader('Cache-Control', context.headersLowercase && context.headersLowercase['cache-control'] ? context.headersLowercase['cache-control'] : 'max-age=0')
    response.setHeader('ETag', context.headersLowercase && context.headersLowercase['etag'] ? context.headersLowercase['etag'] : lastModified)
  }

  try {
    // The last controller in the chain provides the final output
    let output    = params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].output,
        encodings = {
          identity : output
        }

    if ( CTZN.config.citizen.compression.enabled && ( ( context.cache && context.cache.route ) || ( response.encoding === 'gzip' || response.encoding === 'deflate' ) ) ) {
      let [
        deflated,
        zipped
      ] = await Promise.all([
        context.cache || response.encoding === 'deflate' ? compress.deflate(output) : '',
        context.cache || response.encoding === 'gzip'    ? compress.gzip(output)    : ''
      ]).catch(err => { server.emit('error', params, request, response, context, err) })

      encodings.deflate = deflated
      encodings.gzip    = zipped
    }
    
    if ( !response.writableEnded ) {
      response.setHeader('Content-Encoding', response.encoding)
      response.end(request.method !== 'HEAD' ? encodings[response.encoding] : null)
      server.emit('responseEnd', params, request, response, context)
    }

    if ( CTZN.config.citizen.cache.application.enabled ) {
      cacheResponse(params, request, response, context, encodings, lastModified)
    }
  } catch (err) {
    server.emit('error', params, request, response, context, err)
  }
}


function setPublicContext(params, request, response, context, controllerContext, controllerParams) {
  let publicContext = {}

  switch ( response.contentType ) {
    case 'text/html':
    case 'text/plain':
      publicContext = helpers.extend(controllerContext.public, controllerParams)
      if ( CTZN.config.citizen.mode === 'development' && ( CTZN.config.citizen.development.debug.view || params.url.ctzn_debug ) ) {
        publicContext.ctzn_debugOutput = debug(params, request, response, context)
      }
      break
    case 'application/json':
      if ( !controllerParams.route.output ) {
        publicContext = controllerContext.local
      } else {
        publicContext = createJSON(controllerParams.route.output, controllerContext.local)
      }
      break
    case 'application/javascript':
      if ( !controllerParams.route.output ) {
        publicContext = controllerContext.local
      } else {
        publicContext = createJSON(controllerParams.route.output, controllerContext.local)
      }
      break
  }

  return publicContext
}


function cacheController(options) {
  if ( options.context.cache && options.context.cache.controller ) {
    let cacheExists = cache.exists({
      controller: options.controller,
      action: options.action,
      view: options.view,
      route: options.context.cache.controller.scope === 'route' ? options.route : 'global',
      contentType: options.contentType
    })

    if ( !cacheExists ) {
      let cacheContext = {},
          cacheLifespan = options.context.cache.controller.lifespan || CTZN.config.citizen.cache.application.lifespan,
          cacheReset = options.context.cache.controller.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess

      if ( Object.keys(options.params.url).length && options.context.cache.controller.urlParams ) {
        Object.getOwnPropertyNames(options.params.url).forEach( function (item) {
          if ( options.context.cache.controller.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            throw new Error('Cache attempt on ' + options.controller + ' controller failed due to an invalid URL parameter ("' + item + '").')
          }
        })
      }

      // Cache only those directives specified by the cache.directives array
      if ( options.context.cache.controller.directives ) {
        options.context.cache.controller.directives.forEach( function (item) {
          // Skip the include directive because include views are cached with the controller view
          if ( options.context[item] && options.context[item] !== 'include' ) {
            cacheContext[item] = options.context[item]
          }
        })
      }

      if ( options.context.public ) {
        cacheContext.public = options.context.public
      }

      cache.setController({
        controller: options.controller,
        action: options.action,
        view: options.view,
        route: options.context.cache.controller.scope === 'route' ? options.route : 'global',
        contentType: options.contentType,
        context: cacheContext,
        output: options.output,
        lifespan: cacheLifespan,
        resetOnAccess: cacheReset
      })
    }
  }
}


function cacheResponse(params, request, response, context, encodings, lastModified) {
  let cacheExists = cache.exists({
        route: params.route.pathname,
        contentType: response.contentType
      }),
      proceed = true

  if ( context.cache && context.cache.route && !cacheExists ) {
    if ( context.cache.route && ( context.cache.route === true || Object.keys(context.cache.route).length ) ) {
      if ( Object.keys(params.url).length && context.cache.route.urlParams ) {
        Object.keys(params.url).forEach( function (item) {
          if ( context.cache.route.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            proceed = false
            let err = new Error('Cache attempt on ' + params.route.controller + ' route failed due to an invalid URL parameter (' + item + '). Request denied.')
            server.emit('error', params, request, response, context, err)
          }
        })
      }

      if ( proceed ) {
        try {
          cache.setRoute({
            route: params.route.pathname,
            contentType: response.contentType,
            output: encodings,
            context: context,
            lastModified: lastModified,
            lifespan: context.cache.route.lifespan || CTZN.config.citizen.cache.application.lifespan,
            resetOnAccess: context.cache.route.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess
          })
        } catch ( err ) {
          server.emit('error', params, request, response, context, err)
        }
      }
    }
  }
}


function createJSON(node, context) {
  let outputArray = node.split('~'),
      outputNode,
      output = {},
      failed = () => {
        let err = new Error()
        err.statusCode = 404
        throw err
      }

  if ( context[decodeURIComponent(outputArray[0])] ) {
    output = context[decodeURIComponent(outputArray[0])]

    for ( var i = 1; i < outputArray.length; i++ ) {
      outputNode = decodeURIComponent(outputArray[i])

      if ( output[outputNode] ) {
        output = output[outputNode]
      } else {
        failed()
      }
    }

    return output
  } else {
    failed()
  }
}


async function renderView(params, request, response, context, options) {
  let viewContext = Object.assign({}, options.context), // consolidate modifies the original, so copy it
      json = ''
  
  // Remove the include context if its properties are undefined
  if ( viewContext.include ) {
    for ( let key in viewContext.include ) {
      if ( !viewContext.include[key] ) {
        delete viewContext.include[key]
      }
    }

    if ( !Object.keys(viewContext.include).length ) {
      delete viewContext.include
    }
  }

  switch ( response.contentType ) {
    case 'text/html':
    case 'text/plain':
      if ( CTZN.patterns.views[options.view] || CTZN.patterns.views[options.pattern][options.view] ) {
        if ( CTZN.config.citizen.mode === 'production' ) {
          viewContext.cache = CTZN.config.citizen.cache.application.enabled
        }

        try {
          let html = ''
          if ( CTZN.config.citizen.templateEngine === 'templateLiterals' ) {
            let { config, cookie, form, local, payload, route, session, url, include } = viewContext,
                fileContents = await fsPromises.readFile(CTZN.patterns.views[options.view]?.path || CTZN.patterns.views[options.pattern][options.view].path, { encoding: 'utf-8' })

            html = new Function('config, cookie, form, local, payload, route, session, url, include', 'return `' + fileContents + '`')(config, cookie, form, local, payload, route, session, url, include)
            if ( options.context.ctzn_debugOutput ) {
              html = html.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
            }
            return html
          } else {
            return await import('consolidate').then((consolidate) => {
              html = consolidate[CTZN.config.citizen.templateEngine](CTZN.patterns.views[options.view]?.path || CTZN.patterns.views[options.pattern][options.view].path, viewContext)
              if ( options.context.ctzn_debugOutput ) {
                html = html.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
              }
              return html
            })
          }
        } catch (err) {
          // If rendering fails, emit a 500, but return the error as the rendered view.
          server.emit('error', params, request, response, context, err, false)
          return err.toString()
        }
      } else {
        // If rendering fails, emit a 500, but return the error as the rendered view.
        let err = new Error('The view ("' + options.view + '") specified within this controller ("' + options.pattern + '") doesn\'t exist.')
        server.emit('error', params, request, response, context, err, false)
        return err.toString()
      }
    case 'application/json':
      json = JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2)
      if ( json && json.charAt(0) === '"' && json.charAt(json.length - 1) === '"' ) {
        json = json.slice(1, -1)
      }
      return json
    case 'application/javascript':
      json = options.params.url.callback + '(' + JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2) + ');'
      return json
  }
}


function debug(params, request, response, context) {
  let inspect = ''
  
  if ( params.url.ctzn_inspect ) {
    inspect = util.inspect(eval(params.url.ctzn_inspect), { depth: params.url.ctzn_debugDepth || CTZN.config.citizen.development.debug.depth, showHidden: params.url.ctzn_debugShowHidden || CTZN.config.citizen.development.debug.showHidden })
  } else {
    let logContent = {}

    CTZN.config.citizen.development.debug.scope.config  ? logContent.config  = params.config  : false
    CTZN.config.citizen.development.debug.scope.context ? logContent.context = context        : false
    CTZN.config.citizen.development.debug.scope.cookie  ? logContent.cookie  = params.cookie  : false
    CTZN.config.citizen.development.debug.scope.form    ? logContent.form    = params.form    : false
    CTZN.config.citizen.development.debug.scope.payload ? logContent.payload = params.payload : false
    CTZN.config.citizen.development.debug.scope.route   ? logContent.route   = params.route   : false
    CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
    CTZN.config.citizen.development.debug.scope.url     ? logContent.url     = params.url     : false

    inspect = util.inspect(logContent, { depth: params.url.ctzn_debugDepth || CTZN.config.citizen.development.debug.depth, showHidden: params.url.ctzn_debugShowHidden || CTZN.config.citizen.development.debug.showHidden })
  }

  inspect = inspect.replace(/</g, '&lt;')
  inspect = inspect.replace(/>/g, '&gt;')
  inspect = '<pre>' + inspect + '</pre>'
  
  return inspect
}


function buildCookie(params, request, cookies) {
  let cookieArray   = [],
      secureEnabled = params.route.protocol === 'https' && CTZN.config.citizen.https.secureCookies,
      now           = Date.now()

  Object.keys(cookies).forEach( item => {
    // Default cookie properties
    let cookie = {
          domain   : request.cors ? params.route.parsed.hostname : '',
          path     : '/',
          expires  : 'session',
          httpOnly : true,
          sameSite : request.cors ? 'None' : 'Lax',
          secure   : secureEnabled
        }

    // If an object is provided, extend the defaults with the object
    if ( typeof cookies[item] === 'object' && cookies[item].constructor === Object ) {
      cookie = helpers.extend(cookie, cookies[item])
    // Otherwise, use the defaults and set the value to the provided value
    } else {
      cookie.value = cookies[item]
    }

    // Create the property strings to concatenate and create the cookie header
    let value      = item + '=' + cookie.value + ';',
        domain     = cookie.domain.length ? 'Domain=' + cookie.domain + ';' : '',
        path       = 'Path=' + cookie.path + ';',
        expires    = '',
        httpOnly   = cookie.httpOnly !== false ? 'HttpOnly;' : '',
        sameSite   = 'SameSite=' + cookie.sameSite + ';',
        // If it's a secure connection and the secureCookies setting is true (default),
        // make all cookies secure, unless the cookie directive explicitly requests an
        // insecure cookie. If SameSite is "None", cookies must be secure.
        secure     = ( secureEnabled && cookie.secure !== false ) || cookie.sameSite === 'None' ? 'Secure;' : '',
        expiration = new Date()

    switch ( cookie.expires ) {
      case 'session':
        expires = ''
        break
      case 'now':
        expiration.setTime(now)
        expiration = expiration.toUTCString()
        expires    = 'Expires=' + expiration + ';'
        break
      case 'never':
        expiration.setTime(now + 946080000000)
        expiration = expiration.toUTCString()
        expires    = 'Expires=' + expiration + ';'
        break
      default:
        expiration.setTime(now + ( cookie.expires * 60000 ))
        expiration = expiration.toUTCString()
        expires    = 'Expires=' + expiration + ';'
    }

    cookieArray.push(value + domain + path + expires + httpOnly + sameSite + secure)
  })

  return cookieArray
}


function parseCookie(cookie) {
  var pairs = [],
      pair = [],
      cookies = {}

  if ( cookie ) {
    pairs = cookie.split(';')

    for ( var i = 0; i < pairs.length; i++ ) {
      pair = pairs[i].trim()
      pair = pair.split('=')
      cookies[pair[0]] = pair[1]
    }
  }

  return cookies
}


function extendConfig(params, controller, action) {
  if ( CTZN.patterns.controllers[controller].config ) {
    // Controller config
    if ( CTZN.patterns.controllers[controller].config.controller ) {
      params.config.citizen = helpers.extend(params.config.citizen, CTZN.patterns.controllers[controller].config.controller)
    }
    // Controller action config
    if ( CTZN.patterns.controllers[controller].config[action] ) {
      params.config.citizen = helpers.extend(params.config.citizen, CTZN.patterns.controllers[controller].config[action])
    }
  }
}
