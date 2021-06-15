// server

// node
import events      from 'events'
import fs          from 'fs'
import http        from 'http'
import https       from 'https'
import querystring from 'querystring'
import util        from 'util'
import zlib        from 'zlib'
// citizen
import helpers     from './helpers.js'
import cache       from './cache.js'
import router      from './router.js'
import session     from './session.js'
// third-party
import consolidate from 'consolidate'
import formidable  from 'formidable'

const
  // Promisify zlib methods
  compress = {
    deflate : util.promisify(zlib.deflate),
    gzip    : util.promisify(zlib.gzip)
  },
  // server events
  server = new events.EventEmitter()


// Server event handlers

server.on('applicationStart', async (options) => {
  CTZN.config = helpers.extend(CTZN.config, options)
  await CTZN.hooks.citizen.application.start()
  if ( CTZN.hooks.app.application && CTZN.hooks.app.application.start ) {
    await CTZN.hooks.app.application.start(CTZN.config)
  }
  createServer()
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
    context.cookie = context.cookie || {}
    context.cookie.ctzn_sessionID = {
      value: sessionID,
      sameSite: request.cors ? 'None' : 'Lax'
    }
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


server.on('requestStart', async (params, request, response) => {
  let context = {}
  try {
    let requestStart = await CTZN.hooks.citizen.request.start(params, request, response, context)
    context = helpers.extend(context, requestStart)
    
    if ( CTZN.hooks.app.request && CTZN.hooks.app.request.start ) {
      requestStart = await CTZN.hooks.app.request.start(params, request, response, context)
      context = helpers.extend(context, requestStart)

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
    // If the controller exists or a fallback controller is defined,
    // start the session if sessions are enabled or begin the response
    let controllerName = params.route.controller || CTZN.config.citizen.fallbackController

    if ( CTZN.patterns.controllers[controllerName] && CTZN.patterns.controllers[controllerName][params.route.action] ) {
      let controller = CTZN.patterns.controllers[controllerName],
          corsOriginTest = new RegExp('^' + ( request.headers['x-forwarded-proto'] || params.route.protocol ) + '://' + ( request.headers['x-forwarded-host'] || request.headers.host ) + '$'),
          corsSession = false,
          respond = true

      // Extend the config with the controller config
      extendConfig(params, controller)

      // If the Origin header exists and it's not the host, check if it's allowed. If so,
      // set the response header to match the request header (per W3C recs). If not, end the response.
      if ( request.headers.origin && !corsOriginTest.test(request.headers.origin) ) {
        request.cors = true

        if ( params.config.citizen.cors ) {
          params.config.citizen.corsLowerCase = {}
          Object.keys(params.config.citizen.cors).forEach( item => {
            // Create lowercase version of header name for easier comparison, while maintaining case for sent header
            params.config.citizen.corsLowerCase[item.toLowerCase()] = params.config.citizen.cors[item]
          })
          if ( params.config.citizen.corsLowerCase['access-control-allow-origin'] && ( params.config.citizen.corsLowerCase['access-control-allow-origin'].search(request.headers.origin) >= 0 || params.config.citizen.corsLowerCase['access-control-allow-origin'] === '*' ) ) {
            if ( request.method === 'OPTIONS' && !request.headers['access-control-request-method'] ) {
              respond = false
              response.end(server.emit('responseEnd', params, request, response, context))
            } else {
              Object.keys(params.config.citizen.cors).forEach( item => {
                response.setHeader(item, params.config.citizen.cors[item])
              })
              if ( params.config.citizen.cors['Access-Control-Allow-Origin'] ) {
                response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
              } else {
                response.setHeader('access-control-allow-origin', request.headers.origin)
              }
              if ( params.config.citizen.corsLowerCase['access-control-allow-credentials'] ) {
                corsSession = true
              }
            }
          } else {
            respond = false
            response.end()
            server.emit('responseEnd', params, request, response, context)
            helpers.log({
              type: 'error',
              label: 'Failed CORS request',
              content: 'A foreign host made a request, but it failed because the controller isn\'t configured for external requests from that host.'
            })
          }
        } else {
          respond = false
          response.end()
          server.emit('responseEnd', params, request, response, context)
          helpers.log({
            type: 'error',
            label: 'Failed CORS request',
            content: 'A foreign host made a request, but it failed because the controller isn\'t configured for external requests from that host.'
          })
        }
      }

      if ( respond ) {
        if ( CTZN.config.citizen.sessions && ( !request.cors || ( request.cors && corsSession ) ) ) {
          server.emit('sessionStart', params, request, response, context)
        } else {
          processRequest(params, request, response, context)
        }
      }
    // If the controller doesn't exist, throw a 404
    } else {
      let err = new Error()
      err.statusCode = 404
      server.emit('error', params, request, response, context, err)
    }
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
      logContent = err.message || false,
      errorView = 'error'
  
  let label = statusCode + ' ' + http.STATUS_CODES[statusCode]

  context.public = context.public || {}

  if ( statusCode >= 500 ) {
    logContent = err.stack ? err.stack : util.inspect(err)
  } else if ( statusCode === 404 && request.headers.referer ) {
    logContent = '(Referrer: ' + request.headers.referer + ')'
  }

  helpers.log({
    type    : 'error',
    label   : statusCode + ' ' + http.STATUS_CODES[statusCode] + ' ' + params.route.url +  ' ' + request.remoteAddress + ' "' + request.headers['user-agent'] + '"',
    content : logContent
  })

  // Run the application error event hook for 500-level errors
  if ( statusCode >= 500 ) {
    try {
      await CTZN.hooks.citizen.application.error(err, params, context)
      if ( CTZN.hooks.app.application && CTZN.hooks.app.application.error ) {
        await CTZN.hooks.app.application.error(err, params, context)
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

    if ( respond ) {
      let controller = params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].controller,
          error = {
            errorCode  : err.code,
            statusCode : statusCode,
            label      : label,
            message    : err.message,
            stack      : err.stack
          }
      
      // Wipe the context and controller chain
      context = {
        public: {
          error: error
        }
      }
      params.route.chain = {}
  
      switch ( response.contentType ) {
        case 'text/html':
        case 'text/plain':
          // Render an error view with full layout if they exist
          if ( CTZN.patterns.views.error ) {
            if ( CTZN.patterns.views.error[err.code] ) {
              errorView = err.code
            } else if ( CTZN.patterns.views.error[statusCode] ) {
              errorView = statusCode
            }
      
            // Hand off the error to the layout controller if there is one, as long as the error
            // didn't originate in the layout controller itself.
            if ( CTZN.config.citizen.layout.controller.length && controller !== CTZN.config.citizen.layout.controller ) {
              context.handoff = CTZN.config.citizen.layout
            }
            params.route.chain.error = {
              controller: 'error',
              action: '',
              view: errorView,
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
              output: '<pre>' + context.public.error.message + '</pre>'
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

      handoffOrRespond(params, request, response, context)
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
                        '\n  citizen is in development mode, which enables verbose console logging and' +
                        '\n  disables view template caching, degrading performance. To enable production' +
                        '\n  mode, set your local NODE_ENV variable to "production" or manually change' +
                        '\n  the citizen config mode to "production".' +
                        '\n' +
                        '\n  Consult the README for details.'
      break
    case 'production':
      modeMessage += '\n' +
                        '\n  citizen is in production mode, which disables logging by default. To enable' +
                        '\n  file or console logging, update the log configuration settings.' +
                        '\n' +                        
                        '\n  To enable development mode, set your local NODE_ENV variable to "development"' +
                        '\n  or manually change the citizen mode setting to "development".' +
                        '\n' +
                        '\n  Consult the README for details.'
      break
  }

  if ( CTZN.config.citizen.http.enable ) {
    const httpServer = http.createServer((request, response) => {
      serve(request, response, 'http')
    })

    httpServer.keepAliveTimeout = CTZN.config.citizen.http.keepAliveTimeout || httpServer.keepAliveTimeout
    httpServer.maxHeadersCount = CTZN.config.citizen.http.maxHeadersCount || httpServer.maxHeadersCount
    httpServer.requestTimeout = CTZN.config.citizen.http.requestTimeout || httpServer.requestTimeout
    httpServer.timeout = CTZN.config.citizen.http.timeout || httpServer.timeout

    httpServer.listen(CTZN.config.citizen.http.port, CTZN.config.citizen.http.hostname, CTZN.config.citizen.connectionQueue, function () {
      var httpHostname = CTZN.config.citizen.http.hostname.length ? CTZN.config.citizen.http.hostname : '127.0.0.1',
          appUrl = CTZN.config.citizen.http.port === 80 ? 'http://' + httpHostname + CTZN.config.citizen.urlPaths.app : 'http://' + httpHostname + ':' + CTZN.config.citizen.http.port + CTZN.config.citizen.urlPaths.app,
          startupMessage = '\nHTTP server started\n' +
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
      var appUrl = CTZN.config.citizen.http.port === 80 ? 'http://' + CTZN.config.citizen.http.hostname + CTZN.config.citizen.urlPaths.app : 'http://' + CTZN.config.citizen.http.hostname + ':' + CTZN.config.citizen.http.port + CTZN.config.citizen.urlPaths.app

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
            content: '\nHTTP server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.http.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
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

  if ( CTZN.config.citizen.https.enable ) {
    var startHttps = true,
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
      httpsServer.maxHeadersCount = CTZN.config.citizen.http.maxHeadersCount || httpsServer.maxHeadersCount
      httpsServer.requestTimeout = CTZN.config.citizen.http.requestTimeout || httpsServer.requestTimeout
      httpsServer.timeout = CTZN.config.citizen.http.timeout || httpsServer.timeout
      
      httpsServer.listen(CTZN.config.citizen.https.port, CTZN.config.citizen.https.hostname, CTZN.config.citizen.connectionQueue, function () {
        var httpsHostname = CTZN.config.citizen.https.hostname.length ? CTZN.config.citizen.https.hostname : '127.0.0.1',
            appUrl = CTZN.config.citizen.https.port === 443 ? 'https://' + httpsHostname + CTZN.config.citizen.urlPaths.app : 'https://' + httpsHostname + ':' + CTZN.config.citizen.https.port + CTZN.config.citizen.urlPaths.app,
            startupMessage = '\nHTTPS server started\n' +
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
        var appUrl = CTZN.config.citizen.https.port === 443 ? 'http://' + CTZN.config.citizen.https.hostname + CTZN.config.citizen.urlPaths.app : 'http://' + CTZN.config.citizen.https.hostname + ':' + CTZN.config.citizen.https.port + CTZN.config.citizen.urlPaths.app

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
  let params = {
        route     : router.getRoute(protocol + '://' + request.headers.host + request.url),
        url       : {},
        form      : {},
        payload   : {},
        cookie    : parseCookie(request.headers.cookie),
        session   : {},
        config    : helpers.copy(CTZN.config)
      }

  response.setHeader('X-Powered-By', 'citizen')
  
  params.url = params.route.urlParams
  
  // Prevents further response execution when the client arbitrarily closes the connection, which
  // helps conserve resources.
  response.on('close', function () {
    if ( !response.writableEnded ) {
      response.end()
      helpers.log({
        label: 'Connection closed by the client.',
        content: ' (Route: ' + params.route.url + ')'
      })
    }
  })
  
  request.remoteAddress = ( params ? request.headers['x-forwarded-for'] || request.connection.remoteAddress || request.socket.remoteAddress || ( request.connection.socket ? request.connection.socket.remoteAddress : 'undefined' ) : 'undefined' ).replace('::ffff:', '')
  response.encoding = CTZN.config.citizen.compression.force || 'identity'

  let staticPath,
      cachedFile,
      compressable = CTZN.config.citizen.compression.enable && !CTZN.config.citizen.compression.force && ( !params.route.isStatic || CTZN.config.citizen.compression.mimeTypes.indexOf(router.staticMimeTypes[params.route.extension]) >= 0 ),
      lastModified

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

  // If it's a dynamic page request, emit the requestStart event.
  // Otherwise, serve the static asset.
  if ( !params.route.isStatic ) {
    if ( CTZN.config.citizen.sessions && params.cookie.ctzn_sessionID ) {
      params.session = CTZN.sessions[params.cookie.ctzn_sessionID] || params.session
    }

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

    server.emit('requestStart', params, request, response)
  } else {
    staticPath = CTZN.config.citizen.directories.web + params.route.filePath

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

    if ( CTZN.config.citizen.cache.static.enable ) {
      cachedFile = cache.get({ file: staticPath, output: 'all' })
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
        response.end(cachedFile.value[response.encoding])
      }

      helpers.log({
        type: 'access',
        label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode] + ' ' + params.route.url +  ' ' + request.remoteAddress + ' "' + request.headers['user-agent'] + '"'
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
                if ( CTZN.config.citizen.compression.enable && compressable ) {
                  let [
                    gzip,
                    deflate
                  ] = await Promise.all([
                    CTZN.config.citizen.cache.static.enable || response.encoding === 'gzip' ? compress.gzip(data) : false,
                    CTZN.config.citizen.cache.static.enable || response.encoding === 'deflate' ? compress.deflate(data) : false
                  ]).catch(err => { server.emit('error', params, request, response, {}, err) })
  
                  let compressed = {
                    gzip    : gzip,
                    deflate : deflate
                  }
  
                  if ( !response.headersSent ) {
                    response.setHeader('Content-Encoding', response.encoding)
                    response.end(compressed[response.encoding])
                  }

                  if ( CTZN.config.citizen.cache.static.enable ) {
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
                  response.end(data)
  
                  if ( CTZN.config.citizen.cache.static.enable ) {
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
                label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode] + ' ' + params.route.url +  ' ' + request.remoteAddress + ' "' + request.headers['user-agent'] + '"'
              })
            }
          })
        } else {
          response.statusCode = 404
          response.end()

          helpers.log({
            type: 'error',
            label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode] + ' ' + params.route.url +  ' ' + request.remoteAddress + ' "' + request.headers['user-agent'] + '"'
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
    setCookie(params, request, response, context)

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
      response.end(routeCache.output[response.encoding])
    }
    server.emit('responseEnd', params, request, response, context)
  } else {
    fireController(params, request, response, context)
  }
}


function setSession(params, request, response, context, system) {
  if ( CTZN.config.citizen.sessions && context.session && ( !request.headers.origin || ( request.headers.origin && request.headers.origin.search(request.headers.host) ) ) && Object.keys(context.session).length ) {
    if ( context.session.expires && context.session.expires === 'now' ) {
      session.end(params.session.id)
      context.cookie = helpers.extend(context.cookie, { ctzn_sessionID: { expires: 'now' }})
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


function setCookie(params, request, response, context) {
  if ( context.cookie ) {
    var cookie = buildCookie(params, request, context.cookie)
  
    if ( cookie.length ) {
      response.setHeader('Set-Cookie', cookie)
    }
  }
}


async function processRequest(params, request, response, context) {
  var controller = CTZN.patterns.controllers[params.route.controller],
      formParser,
      body = ''

  switch ( request.method ) {
    case 'GET':
      try {
        let requestEnd = await CTZN.hooks.citizen.request.end(params)
        context = helpers.extend(context, requestEnd)
        if ( CTZN.hooks.app.request && CTZN.hooks.app.request.end ) {
          requestEnd = await CTZN.hooks.app.request.end(params)
          context = helpers.extend(context, requestEnd)
        }
        setSession(params, request, response, context)
        server.emit('responseStart', params, request, response, context)
      } catch (err) {
        server.emit('error', params, request, response, context, err)
      }
      break
    case 'POST':
      // Extend the config with the controller config
      extendConfig(params, controller)

      if ( params.config.citizen.form.maxFieldsSize ) {
        params.config.citizen.form.maxFieldsSize = params.config.citizen.form.maxFieldsSize * 1024
      }

      formParser = new formidable.IncomingForm(params.config.citizen.form)

      formParser.on('progress', function (bytesReceived, bytesExpected) {
        if ( bytesExpected > formParser.maxFieldsSize || bytesReceived > formParser.maxFieldsSize ) {
          let err = new Error('The maximum upload size for this form has been exceeded (max: ' + formParser.maxFieldsSize + 'k, received: ' + bytesReceived + 'k, expected: ' + bytesExpected + 'k).')
          err.statusCode = 413
          server.emit('error', params, request, response, context, err)
        }
      })

      formParser.parse(request, async (err, fields, files) => {
        if ( !err ) {
          params.form = helpers.extend(fields, files)
          helpers.log({
            label: 'Form input processed',
            content: {
              fields: fields,
              files: files
            }
          })
          try {
            let requestEnd = await CTZN.hooks.citizen.request.end(params)
            context = helpers.extend(context, requestEnd)
            if ( CTZN.hooks.app.request && CTZN.hooks.app.request.end ) {
              requestEnd = await CTZN.hooks.app.request.end(params)
              context = helpers.extend(context, requestEnd)
            }
            server.emit('responseStart', params, request, response, context)
          } catch (err) {
            server.emit('error', params, request, response, context, err)
          }
        } else {
          server.emit('error', params, request, response, context, err)
          helpers.log({
            label: 'Error processing form input',
            content: err
          })
        }
      })
      break
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      switch ( request.headers['content-type'] ) {
        default:
          request.on('data', function (chunk) {
            body += chunk.toString()
          })
          request.on('end', function () {
            try {
              params.payload = JSON.parse(body)
            } catch ( err ) {
              err.message = 'You didn\'t specify a valid Content-Type for your payload, so we tried to parse it as JSON, but failed. If it is JSON, it\'s probably not formatted correctly. If it\'s another format, please specify a Content-Type header in your request. Valid Content-Type headers are "application/json", "application/x-www-form-urlencoded", or "multipart/form-data".'
              server.emit('error', params, request, response, context, err)
            }
            helpers.log({
              label: 'Payload processed',
              content: params.payload
            })
            server.emit('responseStart', params, request, response, context)
          })
          break
        case 'application/json':
          request.on('data', function (chunk) {
            body += chunk.toString()
          })
          request.on('end', function () {
            try {
              params.payload = JSON.parse(body)
            } catch ( err ) {
              err.message = 'Failed to parse the JSON payload. The payload probably isn\'t formatted correctly.'
              server.emit('error', params, request, response, context, err)
            }
            helpers.log({
              label: 'Payload received and parsed',
              content: params.payload
            })
            server.emit('responseStart', params, request, response, context)
          })
          break
        case 'application/x-www-form-urlencoded':
        case 'multipart/form-data':
          // Extend the config with the controller config
          extendConfig(params, controller)

          if ( params.config.citizen.form.maxFieldsSize ) {
            params.config.citizen.form.maxFieldsSize = params.config.citizen.form.maxFieldsSize * 1024
          }

          formParser = new formidable.IncomingForm(params.config.citizen.form)

          formParser.parse(request, function (err, fields, files) {
            if ( !err ) {
              params.payload = helpers.extend(fields, files)
              helpers.log({
                label: 'Payload received and parsed',
                content: {
                  fields: fields,
                  files: files
                }
              })
              server.emit('responseStart', params, request, response, context)
            } else {
              err.message = 'Failed to parse the JSON payload. It\'s probable the payload isn\'t properly formatted.'
              server.emit('error', params, request, response, context, err)
            }
          })
          break
      }
      break
    // Just send the response headers for HEAD and OPTIONS
    case 'HEAD':
    case 'OPTIONS':
      response.end()
      break
  }
}


async function fireController(params, request, response, context) {
  let controller = context.handoff ? context.handoff.controller : params.route.controller,
      action = context.handoff ? context.handoff.action : params.route.action,
      view = context.handoff ? context.handoff.view : context.view || params.route.controller,
      controllerParams = helpers.copy(params),
      proceed = true

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
    // Set the controller's view to that specified in the controller's context
    // if it exists.
    params.route.chain[controller].view = params.route.chain[controller].context.view || view

    // Set headers based on controller action headers
    if ( context.header ) {
      context.headerLowercase = context.headerLowercase || {}
      Object.keys(context.header).forEach( item => {
        response.setHeader(item, context.header[item])
        // Create lowercase version of header name for easier comparison later
        context.headerLowercase[item.toLowerCase()] = context.header[item]
      })
    }

    // If the handoff directive isn't specified, it's the last controller in the chain.
    if ( !context.handoff ) {
      // Check for a layout controller and if it exists, hand off after this controller.
      if ( CTZN.config.citizen.layout.controller.length && controller !== CTZN.config.citizen.layout.controller ) {
        context.handoff = CTZN.config.citizen.layout
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
      if ( context.public ) {
        Object.keys(context.public).every( item => {
          if ( CTZN.reserved.public.indexOf(item) >= 0 ) {
            proceed = false
            let err = new Error('"' + item + '" is a reserved public variable name used internally by citizen. Please choose a different variable name.')
            server.emit('error', params, request, response, context, err)
            return false
          } else {
            return true
          }
        })
      }

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
              setCookie(params, request, response, context)
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
                      include[item].params.route = router.getRoute(include[item].params.route.protocol + '://' + request.headers.host + include[item].route)
                      include[item].params.url = include[item].params.route.urlParams
                      include[item].controller = include[item].params.route.controller
                      include[item].action     = include[item].params.route.action
                      include[item].view       = include[item].view || include[item].controller
                      include[item].pathname   = include[item].params.route.pathname
                    }
                    
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
                    handoffOrRespond(params, request, response, context)
                  }).catch(err => { server.emit('error', params, request, response, context, err) })
                } else {
                  delete context.include
                  handoffOrRespond(params, request, response, context)
                }
              } else {
                handoffOrRespond(params, request, response, context)
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


function handoffOrRespond(params, request, response, context) {
  if ( !response.writableEnded ) {
    if ( context.handoff && !params.route.direct ) {
      handoff(params, request, response, context)
    } else {
      setCookie(params, request, response, context)
      respond(params, request, response, context)
    }
  }
}


function handoff(params, request, response, context) {
  context.handoff.action = context.handoff.action || 'handler'
  context.handoff.view = context.handoff.view || context.handoff.controller
  params.route.chain[context.handoff.controller] = {
    controller: context.handoff.controller,
    action: context.handoff.action,
    view: context.handoff.view
  }
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
  fireController(params, request, response, context)
}


function redirect(params, request, response, context, setReferrer) {
  var url = typeof context.redirect === 'string' ? context.redirect : context.redirect.url,
      statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number',
      // Construct URL to account for possible proxies
      ctzn_referer = ( ( request.headers['x-forwarded-proto'] || params.route.protocol ) + '://' ) + ( request.headers['x-forwarded-host'] || request.headers.host ) + params.route.pathname

  response.statusCode = statusCode
  setReferrer = setReferrer !== false ? true : false

  if ( refresh ) {
    response.setHeader('Refresh', context.redirect.refresh + ';url=' + url)
  } else {
    if ( setReferrer ) {
      if ( CTZN.config.citizen.sessions ) {
        if ( context.session ) {
          context.session.ctzn_referer = ctzn_referer
        } else {
          context.session = {
            ctzn_referer: ctzn_referer
          }
        }
        setSession(params, request, response, context, true)
      } else {
        if ( context.cookie ) {
          context.cookie.ctzn_referer = ctzn_referer
        } else {
          context.cookie = {
            ctzn_referer: ctzn_referer
          }
        }
        setCookie(params, request, response, context)
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
                publicContext = setPublicContext(params, request, response, context, params.route.chain[link].include[include].context.public || {}, params.route.chain[link].include[include].params)
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

                if ( CTZN.config.citizen.cache.application.enable ) {
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
            publicContext = setPublicContext(params, request, response, context, params.route.chain[link].context.public || {}, params.route.chain[link].params)
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

            if ( CTZN.config.citizen.cache.application.enable ) {
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

  response.setHeader('Cache-Control', context.headerLowercase && context.headerLowercase['cache-control'] ? context.headerLowercase['cache-control'] : 'max-age=0')
  response.setHeader('ETag', context.headerLowercase && context.headerLowercase['etag'] ? context.headerLowercase['etag'] : lastModified)
  
  try {
    // The last controller in the chain provides the final output
    let output    = params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].output,
        encodings = {
          identity : output
        }

    if ( CTZN.config.citizen.compression.enable && ( ( context.cache && context.cache.route ) || ( response.encoding === 'gzip' || response.encoding === 'deflate' ) ) ) {
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
      response.end(encodings[response.encoding])
      server.emit('responseEnd', params, request, response, context)
    }

    if ( CTZN.config.citizen.cache.application.enable ) {
      cacheResponse(params, request, response, context, encodings, lastModified)
    }
  } catch (err) {
    server.emit('error', params, request, response, context, err)
  }
}


function setPublicContext(params, request, response, context, controllerPublicContext, controllerParams) {
  let publicContext = {}

  switch ( response.contentType ) {
    case 'text/html':
    case 'text/plain':
      publicContext = helpers.extend(controllerPublicContext, controllerParams)
      if ( CTZN.config.citizen.mode === 'development' && ( CTZN.config.citizen.development.debug.view || params.url.ctzn_debug ) ) {
        publicContext.ctzn_debugOutput = debug(params, request, response, context)
      }
      break
    case 'application/json':
      if ( !controllerParams.route.output ) {
        publicContext = controllerPublicContext
      } else {
        publicContext = createJSON(controllerParams.route.output, controllerPublicContext)
      }
      break
    case 'application/javascript':
      if ( !controllerParams.route.output ) {
        publicContext = controllerPublicContext
      } else {
        publicContext = createJSON(controllerParams.route.output, controllerPublicContext)
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

  switch ( response.contentType ) {
    case 'text/html':
    case 'text/plain':
      if ( CTZN.patterns.views[options.pattern][options.view] ) {
        if ( CTZN.config.citizen.mode === 'production' ) {
          viewContext.cache = CTZN.config.citizen.cache.application.enable
        }

        try {
          let html = await consolidate[CTZN.config.citizen.templateEngine](CTZN.patterns.views[options.pattern][options.view].path, viewContext)
          if ( options.context.ctzn_debugOutput ) {
            html = html.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
          }
          return html
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
      json = JSON.stringify(options.context, null, CTZN.config.citizen.mode === 'production' ? null : 2)
      if ( json && json.charAt(0) === '"' && json.charAt(json.length - 1) === '"' ) {
        json = json.slice(1, -1)
      }
      return json
    case 'application/javascript':
      json = options.params.url.callback + '(' + JSON.stringify(options.context, null, CTZN.config.citizen.mode === 'production' ? null : 2) + ');'
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
  var defaults = {},
      cookie = {},
      cookieArray = [],
      path = '',
      expires = '',
      httpOnly = '',
      sameSite = '',
      secure = '',
      secureEnabled = ( request.headers['x-forwarded-proto'] === 'https' || params.route.protocol === 'https' ) && CTZN.config.citizen.https.secureCookies,
      cookieExpires,
      now = Date.now()

  Object.keys(cookies).forEach( item => {
    // If it's just a string, use the defaults (app path, HTTP only, SameSite Lax, secure if available)
    if ( typeof cookies[item] === 'string' ) {
      secure = secureEnabled ? 'secure;' : ''
      cookieArray.push(item + '=' + cookies[item] + ';path=' + CTZN.config.citizen.urlPaths.app + ';HttpOnly;SameSite=Lax;' + secure)
    } else {
      defaults = {
        value: '',
        path: CTZN.config.citizen.urlPaths.app,
        expires: 'session',
        httpOnly: true,
        sameSite: request.cors ? 'None' : 'Lax',
        secure: secure
      }
      cookie = helpers.extend(defaults, cookies[item])

      cookieExpires = new Date()

      path = 'path=' + cookie.path + ';'

      switch ( cookie.expires ) {
        case 'session':
          expires = ''
          break
        case 'now':
          cookieExpires.setTime(now)
          cookieExpires = cookieExpires.toUTCString()
          expires = 'expires=' + cookieExpires + ';'
          break
        case 'never':
          cookieExpires.setTime(now + 946080000000)
          cookieExpires = cookieExpires.toUTCString()
          expires = 'expires=' + cookieExpires + ';'
          break
        default:
          cookieExpires.setTime(now + ( cookie.expires * 60000 ))
          cookieExpires = cookieExpires.toUTCString()
          expires = 'expires=' + cookieExpires + ';'
      }

      httpOnly = cookie.httpOnly !== false ? 'HttpOnly;' : ''

      // If it's a secure connection and the secureCookies setting is true (default),
      // make all cookies secure, unless the cookie directive explicitly requests an
      // insecure cookie. If SameSite is "None", cookies must be secure.
      secure = ( secureEnabled && cookie.secure !== false ) || cookie.sameSite === 'None' ? 'secure;' : ''

      sameSite = 'SameSite=' + cookie.sameSite + ';'

      cookieArray.push(item + '=' + cookie.value + ';' + path + expires + httpOnly + sameSite + secure)
    }
  })

  return cookieArray
}


// Extend the app config with the controller config
function extendConfig(params, controller) {
  if ( controller.config ) {
    // Controller config
    if ( controller.config.controller ) {
      params.config.citizen = helpers.extend(params.config.citizen, controller.config.controller)
    }
    // Controller action config
    if ( controller.config[params.route.action] ) {
      params.config.citizen = helpers.extend(params.config.citizen, controller.config[params.route.action])
    }
  }
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
