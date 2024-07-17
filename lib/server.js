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
import cache             from './cache.js'
import helpers           from './helpers.js'
import router            from './router.js'
import session           from './session.js'
// event hooks
import applicationHooks  from './hooks/application.js'
import requestHooks      from './hooks/request.js'
import responseHooks     from './hooks/response.js'
import sessionHooks      from './hooks/session.js'

const
  // Promisify zlib methods
  compress = {
    deflate : util.promisify(zlib.deflate),
    gzip    : util.promisify(zlib.gzip)
  },
  // server events
  server = new events.EventEmitter({ captureRejections: true })


// Global promise unhandledRejection handler
process.on('unhandledRejection', (reason) => {
  helpers.log({
    type    : 'error:server',
    label   : 'Unhandled promise rejection',
    content : reason
  })
})


// Server event handlers

server.on('applicationStart', async (options) => {
  CTZN.config = helpers.extend(CTZN.config, options)
  global[CTZN.config.citizen.global].config = helpers.copy(CTZN.config)
  await applicationHooks.start()
  createServer()
})


server.on('requestStart', async (params, request, response) => {
  let context = {}

  // Set the session parameters if sessions are enabled and a session exists
  if ( CTZN.config.citizen.sessions.enabled && params.cookie.ctzn_session_id ) {
    params.session = CTZN.sessions[params.cookie.ctzn_session_id]?.app || params.session
  }

  try {
    context = helpers.extend(context, await requestHooks.start(params, request, response, context))

    // Set headers based on controller action headers
    if ( context.header ) {
      context.headerLowercase = {}
      Object.keys(context.header).forEach( item => {
        response.setHeader(item, context.header[item])
        // Create lowercase version of header name for easier comparison later
        context.headerLowercase[item.toLowerCase()] = context.header[item]
      })
      delete context.header
    }

    server.emit('request', params, request, response, context)
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('request', function (params, request, response, context) {
  // If a previous event in the request context requested a redirect, do it immediately.
  if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && !params.route.direct ) {
    redirect(params, request, response, context, false)
  } else {
    // If the route controller action exists, extend the global config with the controller config
    if ( CTZN.controllers.routes[params.route.controller]?.[params.route.action] ) {
      extendConfig(params, params.route.controller, params.route.action)

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
                server.emit('error', err, params, request, response, context)
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
      err.message = 'The requested route controller/action pair (controller: ' + params.route.controller + ', action: ' + params.route.action + ') doesn\'t exist.'
      server.emit('error', err, params, request, response, {})
    }
  }
})


server.on('sessionStart', async (params, request, response, context) => {
  if ( params.cookie.ctzn_session_id && CTZN.sessions[params.cookie.ctzn_session_id] && CTZN.sessions[params.cookie.ctzn_session_id].properties.expires > Date.now() ) {
    session.extend(params.cookie.ctzn_session_id)
    params.session = CTZN.sessions[params.cookie.ctzn_session_id].app
    try {
      setSession(params, request, response, context)
      processRequest(params, request, response, context)
    } catch (err) {
      server.emit('error', err, params, request, response, context)
    }
  } else {
    let sessionID = session.create(request)

    context.cookie = context.cookie || {}
    context.cookie.ctzn_session_id = sessionID
    params.session = CTZN.sessions[sessionID].app
    
    try {
      context = helpers.extend(context, await sessionHooks.start(params, request, response, context))

      setSession(params, request, response, context)
      processRequest(params, request, response, context)
    } catch (err) {
      server.emit('error', err, params, request, response, context)
    }
  }
})


server.on('requestEnd', async (params, request, response, context) => {
  try {
    context = helpers.extend(context, await requestHooks.end(params, request, response, context))

    setSession(params, request, response, context)
    server.emit('responseStart', params, request, response, context)
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('responseStart', async (params, request, response, context) => {
  try {
    context = helpers.extend(context, await responseHooks.start(params, request, response, context))

      serverResponse(params, request, response, context)
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('responseEnd', async (params, request, response, context) => {
  try {
    context = helpers.extend(context, await responseHooks.end(params, request, response, context))
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('error', async (err, params, request, response, context, respond = true) => {
  let statusCode = err.statusCode || 500,
      label      = err.label      || statusCode + ' ' + http.STATUS_CODES[statusCode],
      logContent = err.message    || false,
      result     = err.result     || params.config.citizen.errors,
      type       = statusCode >= 500 ? 'error:server' : 'error:client'

  if ( statusCode >= 500 ) {
    logContent = err.stack ? err.stack : util.inspect(err)
  } else if ( statusCode === 404 && request.headers.referer ) {
    logContent = '(Referrer: ' + request.headers.referer + ')'
  }

  helpers.log({
    type    : type,
    label   : helpers.serverLogLabel(statusCode, params, request),
    content : logContent
  })

  // Run the application error event hook for 500-level errors
  if ( statusCode >= 500 ) {
    try {
      await applicationHooks.error(err, params, request, response, context)
    } catch ( err ) {
      helpers.log({
        type    : 'error:server',
        label   : 'Application error handler failed',
        content : err.stack ? err.stack : util.inspect(err)
      })
    }
  }

  if ( params && !response.writableEnded ) {
    response.statusCode = statusCode

    // Default behavior on error is "capture". If set to "exit", allow the error to exit the process.
    if ( result === 'exit' ) {
      response.end()
      process.exit(1)
    }

    if ( respond ) {
      // Display the error view if it's a 404, or as long as the error didn't come from the error view itself.
      if ( statusCode === 404 || !Object.keys(params.route.chain).length || params.route.chain[Object.keys(params.route.chain)[0]].controller !== 'error' ) {
        // Wipe the context and controller chain
        context = {
          local: {
            error: {
              errorCode  : err.code,
              statusCode : statusCode,
              label      : label,
              message    : err.message,
              raw        : err,
              stack      : err.stack
            }
          }
        }

        params.route.controller = 'error'
        params.route.action = ''
        
        params.route.chain = {
          error: {
            controller: 'error',
            action: '',
            view: '',
            params: helpers.copy(params),
            context: helpers.copy(context)
          }
        }

        if ( response.contentType === 'text/html' || response.contentType === 'text/plain' ) {
          // Render an error view if it exists
          if ( CTZN.views.error ) {
            if ( CTZN.views.error[err.code] ) {
              params.route.chain.error.view = err.code
            } else if ( CTZN.views.error[statusCode] ) {
              params.route.chain.error.view = statusCode
            } else {
              params.route.chain.error.view = 'error'
            }

            helpers.log({
              label: 'Rendering error view',
              content: {
                view : params.route.chain.error.view
              }
            })
  
            params.route.chain.error.output = await renderView(params, request, response, context, {
                controller    : params.route.chain.error.controller,
                view          : params.route.chain.error.view,
                params        : params.route.chain.error.params,
                context       : setPublicContext(params, request, response, context, params.route.chain.error.context, params.route.chain.error.params),
                jsonNamespace : true
            })
            .then(async output => {
              return output
            })
            .catch(err => {
              // If the error view throws an error, return that error along with the original error.
              return '<section><p><strong>Your app threw an error while trying to render the error view (+2 Irony bonus):</strong></p>' +
                      '<pre>' + err.stack + '</pre></section><br><br><br><br>' +
                      '<section><p><strong>The following error is what caused the application error handler to fire in the first place:</strong></p>' +
                      '<pre>' + params.route.chain.error.context.local.error.stack + '</pre></section>'
            })

            // Hand off the error to the layout controller if there is one, as long as the error didn't originate in the layout controller itself.
            if ( params.config.citizen.layout.controller.length && CTZN.controllers.routes[params.config.citizen.layout.controller] && params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].controller !== params.config.citizen.layout.controller ) {
              context.next = params.config.citizen.layout
            }
          // Render only the error
          } else {
            params.route.chain.error.output = '<pre>' + context.local.error.stack + '</pre>'
          }
        }
        
        next(params, request, response, context)

      // If the error view throws an error, return that error along with the original error.
      } else {
        let output = '<section><p><strong>Your app threw an error while trying to render the error view (+2 Irony bonus):</strong></p>' +
                      '<pre>' + err.stack + '</pre></section><br><br><br><br>' +
                      '<section><p><strong>The following error is what caused the application error handler to fire in the first place:</strong></p>' +
                      '<pre>' + params.route.chain.error.context.local.error.stack + '</pre></section>'
        
        response.write(output)
        response.end()
      }
    }
  } else {
    // Default behavior on error is "capture". If set to "exit", allow the error to exit the process.
    if ( result === 'exit' ) {
      response.end()
      process.exit(1)
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
    const httpServer = http.createServer(CTZN.config.citizen.http, (request, response) => {
            serve(request, response, 'http')
          })
    
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
    let acceptFormat = request.headers['accept']?.length ? request.headers['accept'].split(',') : helpers.copy(CTZN.config.citizen.contentTypes),
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
                  ]).catch(err => { server.emit('error', err, params, request, response, {}) })
  
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
                      server.emit('error', err, params, request, response, {})
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
                      server.emit('error', err, params, request, response, {})
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
            type: 'error:client',
            label: helpers.serverLogLabel(response.statusCode, params, request)
          })
        }
      })
    }
  }
}


function serverResponse(params, request, response, context) {
  let routeCache = cache.getRoute({
                     route: params.route.base + params.route.pathname,
                     contentType: response.contentType
                   })

  setSession(params, request, response, context)

  if ( routeCache ) {
    setCookies(params, request, response, context)

    // Set response headers based on cached context
    if ( routeCache.context.header ) {
      Object.keys(routeCache.context.header).forEach( item => {
        response.setHeader(item, routeCache.context.header[item])
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
      response.end(request.headers.method !== 'HEAD' ? routeCache.encodings[response.encoding] : null)
    }
    server.emit('responseEnd', params, request, response, context)
  } else {
    fireController(params, request, response, context)
  }
}


function setSession(params, request, response, context) {
  if ( CTZN.config.citizen.sessions.enabled && context.session && ( !request.headers.origin || ( request.headers.origin && request.headers.origin.search(request.headers.host) ) ) && Object.keys(context.session).length ) {
    if ( context.session?.expires === 'now' ) {
      session.end(params.session.ctzn_session_id)
      context.cookie = helpers.extend(context.cookie, { ctzn_session_id: { expires: 'now' }})
      params.session = {}
    } else {
      for ( let item in context.session ) {
        CTZN.sessions[params.session.ctzn_session_id].app[item] = context.session[item]
      }

      params.session = CTZN.sessions[params.session.ctzn_session_id].app
    }

    delete context.session
  }
}


function setCookies(params, request, response, context) {
  if ( context.cookie ) {
    let cookie = buildCookie(params, request, context.cookie)
  
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
          server.emit('error', err, params, request, response, context, clientError)
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
                server.emit('error', err, params, request, response, context)
              }
            }
  
            helpers.log({
              label   : 'Payload received and parsed (' + request.headers['content-type'] + ')',
              content : params.payload
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
  let controller = context.next?.controller || params.route.controller,
      action = context.next?.action || params.route.action,
      view = context.next?.view || context.view || params.route.controller,
      controllerParams = helpers.copy(params)

  if ( context.next?.params ) {
    controllerParams.route = context.next.params.route
    controllerParams.url = context.next.params.url
  }

  // Clear the previous controller's next directive
  delete context.next

  // Check the controller cache unless it's the layout controller, which can't be cached
  params.route.chain[controller] = controller === CTZN.config.citizen.layout.controller ? false : cache.getRoute({
                                                                                                    route       : controllerParams.route.pathname,
                                                                                                    contentType : response.contentType
                                                                                                  })

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
        context    : await CTZN.controllers.routes[controller][action](controllerParams, request, response, context) || {}
      }
    } catch (err) {
      server.emit('error', err, params, request, response, context)
      return err
    }

    // Extend the chain's context with the controller's returned context
    context = helpers.extend(context, params.route.chain[controller].context)
    // Preserve request cache directives from application/request/response hooks if it's the first controller in the chain
    if ( Object.keys(params.route.chain).length === 1 && context.cache?.request ) {
      params.route.chain[controller].context.cache = params.route.chain[controller].context.cache || {}
      params.route.chain[controller].context.cache.request = context.cache.request
    }
    // Delete the cache directive for future controllers in the chain
    delete context.cache
    // Append the parameters passed to the controller to the controller object so they can be referenced later.
    params.route.chain[controller].params = controllerParams
    // Set default local context to avoid server errors during rendering and provide an empty namespaced object in JSON responses
    params.route.chain[controller].context.local = params.route.chain[controller].context.local || {}
    // Set the controller's view to that specified in the controller's context if it exists.
    params.route.chain[controller].view = params.route.chain[controller].context.view || view

    
    if ( !response.writableEnded ) {
      // Set headers based on controller action headers
      if ( context.header ) {
        context.headerLowercase = context.headerLowercase || {}
        Object.keys(context.header).forEach( item => {
          response.setHeader(item, context.header[item])
          // Create lowercase version of header name for easier comparison later
          context.headerLowercase[item.toLowerCase()] = context.header[item]
        })
      }
  
      let lastModified = context.cache?.lastModified ? context.cache.lastModified : new Date().toISOString()
      response.setHeader('Cache-Control', context.headerLowercase?.['cache-control'] ? context.headerLowercase['cache-control'] : 'max-age=0')
      response.setHeader('ETag', context.headerLowercase?.['etag'] ? context.headerLowercase['etag'] : lastModified)
  
      delete context.header
      delete context.headerLowercase
      
      if ( params.config.citizen.contentTypes.indexOf(response.contentType) >= 0 ) {
        setSession(params, request, response, context)

        // Server-side redirect
        if ( context.redirect && ( typeof context.redirect === 'string' || ( Object.keys(context.redirect).length && typeof context.redirect.refresh === 'undefined' ) ) && !params.route.direct ) {
          redirect(params, request, response, context)
        } else {
          // Client-side redirect (the response will be sent to the client as normal)
          if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && !params.route.direct ) {
            redirect(params, request, response, context)
          }

          let include = params.route.chain[controller].context.include || {},
              includeProperties = Object.getOwnPropertyNames(include),
              includes = []
              
          if ( includeProperties.length ) {
            params.route.chain[controller].include = {}
            includeProperties.forEach( function (item, index) {
              // Create the functions to be fired in parallel
              includes[index] = ( async () => {
                // If the include directive is a string, assume it's a route and try to parse it
                if ( typeof include[item] === 'string' ) {
                  let pathname = include[item]

                  try {
                    include[item] = {
                      params: helpers.copy(params)
                    }
                    include[item].params.route = router.parseRoute(request, include[item].params.route.protocol, pathname)
                    include[item].params.url   = helpers.extend(params.route.urlParams, include[item].params.route.urlParams)
                    include[item].controller   = include[item].params.route.controller
                    include[item].action       = include[item].params.route.action
                    include[item].view         = include[item].params.route.controller
                  } catch (err) {
                    err.message = 'The requested include route (' + pathname + ') is invalid. When using the route syntax to specify an include controller, the route must be a valid pathname starting with a forward slash (/).'
                    return Promise.reject(err)
                  }
                } else {
                  include[item].params       = helpers.copy(params)
                  include[item].action       = include[item].action || 'handler'
                  include[item].view         = include[item].view || include[item].controller
                  include[item].params.route = router.parseRoute(request, include[item].params.route.protocol, '/' + include[item].controller + ( include[item].action !== 'handler' ? '/action/' + include[item].action : '' ))
                  include[item].params.url   = helpers.extend(params.route.urlParams, include[item].params.route.urlParams)
                }

                // Throw an error if the requested include controller doesn't exist.
                if ( !CTZN.controllers.routes[include[item].controller] ) {
                  let err = new Error()
                  err.message = 'The requested include controller (' + include[item].controller + ', referenced within controller: ' + controller + ') doesn\'t exist.'
                  return Promise.reject(err)
                }
                
                // Reset the config in case it's been extended by the calling controller config
                include[item].params.config.citizen = helpers.copy(CTZN.config.citizen)
                // Extend the global config with the include controller config
                extendConfig(include[item].params, include[item].controller, include[item].action)
                
                params.route.chain[controller].include[item] = cache.getRoute({
                                                                route       : include[item].params.route.pathname,
                                                                contentType : response.contentType
                                                              })

                if ( params.route.chain[controller].include[item] ) {
                  helpers.log({
                    label: 'Using cached include controller action: ' + item,
                    content: {
                      route       : params.route.chain[controller].include[item].route,
                      contentType : params.route.chain[controller].include[item].contentType
                    }
                  })
                } else {
                  // If the try{} below fails, citizen still needs the controller/action/view determined above to render the error correctly
                  params.route.chain[controller].include[item] = include[item]
                  
                  helpers.log({
                    label: 'Firing include controller: ' + include[item].controller,
                    content: {
                      controller: include[item].controller,
                      action: include[item].action,
                      view: include[item].view
                    }
                  })

                  try {
                    include[item].context = await CTZN.controllers.routes[include[item].controller][include[item].action](include[item].params, request, response, context) || {}
                  } catch (err) {
                    if ( !include[item].controller ) {
                      err.message = 'You must specify a valid controller or route within a citizen include (calling controller: ' + params.route.controller + ').'
                    } else if ( !CTZN.controllers.routes[include[item].controller] ) {
                      err.message = 'The controller you requested to be included (' + include[item].controller + ') doesn\'t exist.'
                    } else if ( !CTZN.controllers.routes[include[item].controller][include[item].action] ) {
                      err.message = 'The controller action you requested to be included (' + include[item].controller + '.' + include[item].action + ') doesn\'t exist.'
                    }

                    return Promise.reject(err)
                  }

                  include[item].context.local = include[item].context.local || {}
                  include[item].view = include[item].context.view || include[item].view
                  params.route.chain[controller].include[item] = include[item]

                  // Append the include's local context to the calling controller's local context for JSON output
                  params.route.chain[controller].context.local.include       = params.route.chain[controller].context.local.include || {}
                  params.route.chain[controller].context.local.include[item] = params.route.chain[controller].include[item].context.local

                  try {
                    await renderOutput(params, request, response, context, controller, params.route.chain[controller].include[item], CTZN.config.citizen.cache.application.enabled && params.route.chain[controller].include[item].context.cache?.action)
                  } catch (err) {
                    return Promise.reject(err)
                  }
                }

                // If the output isn't JSON/JSONP, overwrite the public context with the rendered includes.
                if ( response.contentType !== 'application/json' && response.contentType !== 'application/javascript' ) {
                  params.route.chain[controller].context.include[item] = params.route.chain[controller].include[item].output
                }
              })()
            })

            Promise.all(includes).then( async () => {
              delete context.include

              await renderOutput(params, request, response, context, controller, params.route.chain[controller], CTZN.config.citizen.cache.application.enabled && params.route.chain[controller].context.cache?.action && params.route.chain[controller].controller !== CTZN.config.citizen.layout.controller)
              next(params, request, response, context)
            }).catch(err => {
              server.emit('error', err, params, request, response, context)
            })
          } else {
            try {
              await renderOutput(params, request, response, context, controller, params.route.chain[controller], CTZN.config.citizen.cache.application.enabled && params.route.chain[controller].context.cache?.action && params.route.chain[controller].controller !== CTZN.config.citizen.layout.controller)
              next(params, request, response, context)
            } catch (err) {
              server.emit('error', err, params, request, response, context)
            }
          }
        }
      } else {
        let err = new Error(response.contentType + ' output is not available for this resource. Use the global or controller contentType configuration setting to enable ' + response.contentType + ' output.')
        err.statusCode = 406
        server.emit('error', err, params, request, response, context)
      }
    }
  } else {
    next(params, request, response, context)
  }
}


function next(params, request, response, context) {
  if ( !response.writableEnded ) {
    // If the next directive isn't specified, it's the last controller in the chain.
    if ( !context.next ) {
      // Check for a layout controller and if it exists, call next() after this controller.
      if ( params.config.citizen.layout.controller.length && params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].controller !== params.config.citizen.layout.controller ) {
        context.next = params.config.citizen.layout
      }
    }

    // Process the next controller in the chain unless it's a direct request, in which case respond immediately.
    if ( context.next && !params.route.direct ) {
      // If context.next is a string, assume it's a route and try to parse it
      if ( typeof context.next === 'string' ) {
        try {
          let pathname = context.next

          context.next = {
            params: {
              route: router.parseRoute(request, params.route.protocol, pathname)
            }
          }
          context.next.params.url = helpers.extend(params.route.urlParams, context.next.params.route.urlParams)
        } catch (err) {
          err.message = 'The requested next route (' + context.next + ') is invalid. When using the route syntax to specify the next controller in the chain, the route must be a valid pathname starting with a forward slash (/).'
          server.emit('error', err, params, request, response, context)
        }
      }
      
      context.next.controller = context.next.params?.route.controller || context.next.controller
      context.next.action     = context.next.params?.route.action || context.next.action || 'handler'
      context.next.view       = context.next.view || context.next.params?.route.view || context.next.controller

      // Delete directives that shouldn't persist into the next controller
      delete context.local
      delete context.view

      helpers.log({
        label: 'Next controller: ' + context.next.controller
      })

      if ( CTZN.controllers.routes[context.next.controller]?.[context.next.action] ) {
        // Extend the global config with the controller config. We don't reset
        // the config to the original here because we want the config to be
        // inherited from previous controllers in the chain.
        extendConfig(params, context.next.controller, context.next.action)
        fireController(params, request, response, context)
      } else {
        let err = new Error('The requested next controller action (controller: ' + context.next.controller + ', action: ' + context.next.action + ') doesn\'t exist.')
        server.emit('error', err, params, request, response, context)
      }
    } else {
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

  // If a refresh timeer is provided, set the header for a client-side refresh and allow the request to continue as normal.
  if ( refresh ) {
    response.setHeader('Refresh', context.redirect.refresh + ';url=' + url)

  // Otherwise, perform an immediate server-side redirect.
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
      } else {
        if ( context.cookie ) {
          context.cookie.ctzn_referer = params.route.parsed.href
        } else {
          context.cookie = {
            ctzn_referer: params.route.parsed.href
          }
        }
      }
    }
    
    setSession(params, request, response, context, true)
    setCookies(params, request, response, context)
    response.writeHead(statusCode, {
      'Location': url
    })
    response.end()
    server.emit('responseEnd', params, request, response, context)
  }
}


async function renderOutput(params, request, response, context, controller, parent, cache) {
  // Don't render the view if the controller explicitly disallows it
  if ( parent.context.view !== false ) {
    helpers.log({
      label: 'Rendering controller view: ' + parent.controller,
      content: {
        controller : parent.controller,
        action     : parent.action,
        view       : parent.view
      }
    })

    await renderView(params, request, response, context, {
      controller    : parent.controller,
      view          : parent.view,
      params        : parent.params,
      context       : setPublicContext(params, request, response, context, parent.context, parent.params),
      jsonNamespace : true
    })
    .then(async output => {
      parent.output = output

      if ( cache ) {
        cacheRoute(params, request, response, context, {
          params    : parent.params,
          context   : parent.context,
          output    : parent.output,
          encodings : await encodeOutput(params, request, response, parent.context, parent.output)
        })
      }
    })
    .catch(err => {
      // Bypass caching if renderView() throws an error
      delete params.route.chain[controller].context.cache
      
      return Promise.reject(err)
    })
  } else {
    helpers.log({
      label: 'Rendering skipped for controller: ' + parent.controller,
      content: {
        controller : parent.controller,
        action     : parent.action,
        view       : parent.view
      }
    })
  }
}


async function respond(params, request, response, context) {
  try {
    let links = Object.keys(params.route.chain),
        encodings

    // If it's JSON and multiple controllers are chained together, roll up all local contexts from each controller into the final output.
    if ( ( response.contentType === 'application/javascript' || response.contentType === 'application/json' ) && links.length > 1 ) {
      let routeContext = {}

      links.map( controller => {
        routeContext[controller] = params.route.chain[controller].context.local
      })
      
      encodings = await renderView(params, request, response, context, {
                          controller    : params.route.chain[links[0]].controller,
                          view          : params.route.chain[links[0]].view,
                          params        : params.route.chain[links[0]].params,
                          context       : routeContext
                        })
                        .then( async output => {
                          return await encodeOutput(params, request, response, context, output)
                        })
                        .catch(err => {
                          return Promise.reject(err)
                        })
                        
    // If it's any other format, or it's JSON from only one controller, encode the final controller's output.
    } else {
      encodings = await encodeOutput(params, request, response, context, params.route.chain[links[links.length-1]].output)
    }
    
    
    if ( !response.writableEnded ) {
      setCookies(params, request, response, context)
      response.setHeader('Content-Encoding', response.encoding)
      response.end(request.method !== 'HEAD' ? encodings[response.encoding] : null)
      server.emit('responseEnd', params, request, response, context)
    }

    // Only cache the request if the cache request directive comes from the first controller in the chain. Append that cache directive to the primary context.
    if ( CTZN.config.citizen.cache.application.enabled && params.route.chain[links[0]].context.cache?.request ) {
      context.cache = context.cache || {}
      context.cache.request = params.route.chain[links[0]].context.cache.request

      cacheRoute(params, request, response, context, {
        params    : params,
        context   : context,
        output    : params.route.chain[links[links.length-1]].output,
        encodings : encodings
      })
    }
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
}


async function encodeOutput(params, request, response, context, output) {
  let encodings = {
        identity : output
      }

  if ( CTZN.config.citizen.compression.enabled ) {
    let [
      deflated,
      zipped
    ] = await Promise.all([
      compress.deflate(output),
      compress.gzip(output)
    ]).catch(err => { server.emit('error', err, params, request, response, context) })

    encodings.deflate = deflated
    encodings.gzip    = zipped

    return encodings
  } else {
    return encodings
  }
}


function setPublicContext(params, request, response, context, controllerContext, controllerParams) {
  let publicContext = {}

  switch ( response.contentType ) {
    case 'text/html':
      publicContext = helpers.extend(controllerContext, controllerParams)
      if ( CTZN.config.citizen.mode === 'development' && ( CTZN.config.citizen.development.debug.view || params.url.ctzn_debug ) ) {
        publicContext.ctzn_debugOutput = debug(params, request, response, context)
      }
      break
    case 'application/javascript':
    case 'application/json':
      publicContext = controllerContext.local || {}
      break
    // text/plain or anything else
    default:
      publicContext = helpers.extend(controllerContext, controllerParams)
  }

  return publicContext
}


function cacheRoute(params, request, response, context, options) {
  let route, lastModified, lifespan, resetOnAccess,
      proceed = true,
      // Don't cache the route if any URL parameter isn't on the optional allowlist
      urlParamCheck = function (urlParams) {
        if ( urlParams && Object.keys(options.params.url).length ) {
          Object.keys(options.params.url).forEach( function (item) {
            if ( item !== params.route.controller && urlParams.indexOf(item) < 0 ) {
              proceed = false
              let err = new Error('Cache attempt on ' + route + ' failed due to an invalid URL parameter (' + item + ').')
              server.emit('error', err, params, request, response, context)
            }
          })
        }
      }

  // Cache the controller
  if ( options.context.cache?.action ) {
    route         = options.params.route.pathname
    lastModified  = options.context.cache.action.lastModified
    lifespan      = options.context.cache.action.lifespan
    resetOnAccess = options.context.cache.action.resetOnAccess

    urlParamCheck(options.context.cache.action.urlParams)
  // Cache the request
  } else if ( options.context.cache?.request ) {
    route         = options.params.route.parsed.href
    lastModified  = options.context.cache.request.lastModified
    lifespan      = options.context.cache.request.lifespan
    resetOnAccess = options.context.cache.request.resetOnAccess

    urlParamCheck(options.context.cache.request.urlParams)
  } else {
    proceed = false
  }

  if ( proceed ) {
    try {
      cache.setRoute({
        route         : route,
        contentType   : response.contentType,
        output        : options.output,
        encodings     : options.encodings,
        context       : options.context,
        lastModified  : lastModified || new Date().toISOString(),
        lifespan      : lifespan || CTZN.config.citizen.cache.application.lifespan,
        resetOnAccess : resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess
      })
    } catch ( err ) {
      server.emit('error', err, params, request, response, context)
    }
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
      if ( CTZN.views[options.view] || CTZN.views[options.controller][options.view] ) {
        if ( CTZN.config.citizen.mode === 'production' ) {
          viewContext.cache = CTZN.config.citizen.cache.application.enabled
        } else {
          viewContext.cache = false
        }

        try {
          if ( CTZN.config.citizen.templateEngine === 'templateLiterals' ) {
            let { config, cookie, form, local, payload, route, session, url, include } = viewContext,
                fileContents = await fsPromises.readFile(CTZN.views[options.view]?.path || CTZN.views[options.controller][options.view].path, { encoding: 'utf-8' })

            let html = new Function('config, cookie, form, local, payload, route, session, url, include', 'return `' + fileContents + '`')(config, cookie, form, local, payload, route, session, url, include || {})
            if ( options.context.ctzn_debugOutput ) {
              html = html.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
            }

            return html
          } else {
            let consolidate = await import('@ladjs/consolidate'),
                html = await consolidate[CTZN.config.citizen.templateEngine](CTZN.views[options.view]?.path || CTZN.views[options.controller][options.view].path, viewContext)
                        .then(output => {
                          if ( options.context.ctzn_debugOutput ) {
                            output = output.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
                          }

                          return output
                        })
                        .catch(err => {
                          return Promise.reject(err)
                        })

            return html
          }
        } catch (err) {
          return Promise.reject(err)
        }
      } else {
        let err = new Error('The view ("' + options.view + '") specified within this controller ("' + options.controller + '") doesn\'t exist.')
        return Promise.reject(err)
      }
    case 'application/json':
      if ( options.jsonNamespace ) {
        json = '{"' + options.controller + '":' + JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2) + '}'
      } else {
        json = JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2)
      }
      
      return json
    case 'application/javascript':
      if ( options.jsonNamespace ) {
        json = options.params.url.callback + '({"' + options.controller + '":' + JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2) + '});'
      } else {
        json = options.params.url.callback + '(' + JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2) + ');'
      }
      
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
  if ( CTZN.controllers.routes[controller].config ) {
    // Controller config
    if ( CTZN.controllers.routes[controller].config.controller ) {
      params.config.citizen = helpers.extend(params.config.citizen, CTZN.controllers.routes[controller].config.controller)
    }
    // Controller action config
    if ( CTZN.controllers.routes[controller].config[action] ) {
      params.config.citizen = helpers.extend(params.config.citizen, CTZN.controllers.routes[controller].config[action])
    }
  }
}
