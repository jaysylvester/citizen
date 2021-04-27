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


server.on('sessionStart', async (params, context) => {
  var sessionID = 0

  if ( params.cookie.ctzn_sessionID && CTZN.sessions[params.cookie.ctzn_sessionID] && CTZN.sessions[params.cookie.ctzn_sessionID].expires > Date.now() ) {
    session.extend(params.cookie.ctzn_sessionID)
    params.session = CTZN.sessions[params.cookie.ctzn_sessionID]
    try {
      setSession(params, context)
      processRequest(params, context)
    } catch (err) {
      server.emit('error', err, params, context)
    }
  } else {
    sessionID = session.create(params)
    context.cookie = context.cookie || {}
    context.cookie.ctzn_sessionID = {
      value: sessionID,
      sameSite: params.request.cors ? 'None' : 'Lax'
    }
    params.session = CTZN.sessions[sessionID]
    
    try {
      let sessionStart = await CTZN.hooks.citizen.session.start(params)
      context = helpers.extend(context, sessionStart)
      if ( CTZN.hooks.app.session && CTZN.hooks.app.session.start ) {
        sessionStart = await CTZN.hooks.app.session.start(params)
        context = helpers.extend(context, sessionStart)
      }
      setSession(params, context)
      processRequest(params, context)
    } catch (err) {
      server.emit('error', err, params, context)
    }
  }
})


server.on('requestStart', async (params, context) => {
  try {
    let requestStart = await CTZN.hooks.citizen.request.start(params, context)
    context = helpers.extend(context, requestStart)
    
    if ( CTZN.hooks.app.request && CTZN.hooks.app.request.start ) {
      requestStart = await CTZN.hooks.app.request.start(params, context)
      context = helpers.extend(context, requestStart)

      // Set headers based on controller action headers
      if ( context.header ) {
        context.headerLowercase = {}
        Object.keys(context.header).forEach( item => {
          params.response.setHeader(item, context.header[item])
          // Create lowercase version of header name for easier comparison later
          context.headerLowercase[item.toLowerCase()] = context.header[item]
        })
        delete context.header
      }
    }
    server.emit('request', params, context)
  } catch (err) {
    server.emit('error', err, params, context)
  }
})


server.on('request', function (params, context) {
  // If a previous event in the request context requested a redirect, do it immediately.
  if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && params.route.type !== 'direct' ) {
    redirect(params, context, false)
  } else {
    // If the controller exists or a fallback controller is defined,
    // start the session if sessions are enabled or begin the response
    if ( CTZN.patterns.controllers[CTZN.config.citizen.fallbackController || params.route.controller] && CTZN.patterns.controllers[CTZN.config.citizen.fallbackController || params.route.controller][params.route.action] ) {
      let corsOriginTest = new RegExp('^' + params.route.parsed.protocol + '//' + params.request.headers.host + '$'),
          corsSession = false,
          respond = true

      // If the Origin header exists and it's not the host, check if it's allowed. If so,
      // set the response header to match the request header (per W3C recs). If not, end the response.
      if ( params.request.headers.origin && !corsOriginTest.test(params.request.headers.origin) ) {
        let controller = CTZN.patterns.controllers[params.route.controller]
        params.request.cors = true

        if ( controller.config && controller.config.cors && controller.config.cors[params.route.action] ) {
          controller.config.corsLowerCase = {}
          controller.config.corsLowerCase[params.route.action] = {}
          Object.keys(controller.config.cors[params.route.action]).forEach( item => {
            // Create lowercase version of header name for easier comparison, while maintaining case for sent header
            controller.config.corsLowerCase[params.route.action][item.toLowerCase()] = controller.config.cors[params.route.action][item]
          })
          if ( controller.config.corsLowerCase[params.route.action]['access-control-allow-origin'] && ( controller.config.corsLowerCase[params.route.action]['access-control-allow-origin'].search(params.request.headers.origin) >= 0 || controller.config.corsLowerCase[params.route.action]['access-control-allow-origin'] === '*' ) ) {
            if ( params.request.method === 'OPTIONS' && !params.request.headers['access-control-request-method'] ) {
              respond = false
              params.response.end(server.emit('responseEnd', params, context))
            } else {
              Object.keys(controller.config.cors[params.route.action]).forEach( item => {
                params.response.setHeader(item, controller.config.cors[params.route.action][item])
              })
              if ( controller.config.cors[params.route.action]['Access-Control-Allow-Origin'] ) {
                params.response.setHeader('Access-Control-Allow-Origin', params.request.headers.origin)
              } else {
                params.response.setHeader('access-control-allow-origin', params.request.headers.origin)
              }
              if ( controller.config.corsLowerCase[params.route.action]['access-control-allow-credentials'] ) {
                corsSession = true
              }
            }
          } else {
            respond = false
            params.response.end()
            server.emit('responseEnd', params, context)
          }
        } else {
          respond = false
          params.response.end()
          server.emit('responseEnd', params, context)
        }
      }

      if ( respond ) {
        if ( CTZN.config.citizen.sessions && ( !params.request.cors || ( params.request.cors && corsSession ) ) ) {
          server.emit('sessionStart', params, context)
        } else {
          processRequest(params, context)
        }
      }
    // If the controller doesn't exist, throw a 404
    } else {
      let err = new Error()
      err.statusCode = 404
      server.emit('error', err, params, context)
    }
  }
})


server.on('responseStart', async (params, context) => {
  try {
    let responseStart = await CTZN.hooks.citizen.response.start(params, context)

    context = helpers.extend(context, responseStart)
    
    if ( CTZN.hooks.app.response && CTZN.hooks.app.response.start ) {
      responseStart = await CTZN.hooks.app.response.start(params, context)
      context = helpers.extend(context, responseStart)
      response(params, context)
    } else {
      response(params, context)
    }
  } catch (err) {
    server.emit('error', err, params, context)
  }
})


function response(params, context) {
  let routeCache = cache.get({ scope: 'routes', key: params.route.pathname })

  setSession(params, context)

  if ( routeCache ) {
    setCookie(params, context)

    // Set response headers based on cached context
    if ( routeCache.context.header ) {
      Object.keys(routeCache.context.header).forEach( item => {
        params.response.setHeader(item, routeCache.context.header[item])
      })
    }
    params.response.setHeader('ETag', routeCache.lastModified)

    if ( params.request.headers['if-none-match'] == routeCache.lastModified ) {
      params.response.setHeader('Date', routeCache.lastModified)
      params.response.statusCode = 304
      params.response.end()
    } else {
      params.response.setHeader('Content-Type', routeCache.contentType)
      params.response.setHeader('Content-Encoding', params.request.client.encoding)
      params.response.end(routeCache.render[params.request.client.encoding])
    }
    server.emit('responseEnd', params, context)
  } else {
    fireController(params, context)
  }
}


server.on('responseEnd', async (params, context) => {
  try {
    let responseEnd = await CTZN.hooks.citizen.response.end(params, context)

    context = helpers.extend(context, responseEnd)
    
    if ( CTZN.hooks.app.response && CTZN.hooks.app.response.end ) {
      responseEnd = await CTZN.hooks.app.response.end(params, context)
      context = helpers.extend(context, responseEnd)
      if ( CTZN.config.citizen.mode === 'development' ) {
        debugger
      }
    } else {
      if ( CTZN.config.citizen.mode === 'development' ) {
        debugger
      }
    }
  } catch (err) {
    server.emit('error', err, params, context)
  }
})


server.on('error', async (err, params, context) => {
  var remoteHost = ( params ? params.request.headers['x-forwarded-for'] || params.request.connection.remoteAddress || params.request.socket.remoteAddress || ( params.request.connection.socket ? params.request.connection.socket.remoteAddress : 'undefined' ) : 'undefined' ).replace('::ffff:', ''),
    statusCode = err.statusCode ? err.statusCode : 500,
    label = statusCode + ' ' + http.STATUS_CODES[statusCode] + ( err.message ? ': ' + err.message : '' ),
    logContent = '',
    render,
    requested = '',
    errorView = 'error'

  err.message = err.message || label

  if ( params ) {
    requested = 'Error URL: ' + params.route.url + '\nRemote host: ' + remoteHost + '\nController: ' + params.route.controller + '\nAction: ' + params.route.action + '()\n' + 'Referrer: ' + params.request.headers.referer + '\n'
  }

  context.content = context.content || {}

  if ( CTZN.config.citizen.mode === 'production' || !debug(params, context) ) {
    logContent = err.stack ? requested + err.stack : requested + util.inspect(err)
  } else {
    logContent = err.stack ? debug(params, context) + ' ' + requested + err.stack : debug(params, context) + ' ' + requested + util.inspect(err)
  }

  helpers.log({
    type    : 'error',
    label   : label + ( statusCode === 404 ? ': ' + params.route.url + ( params.request.headers.referer ? '\n  Referrer: ' + params.request.headers.referer : '') : '\n'),
    content : statusCode !== 404 ? logContent : false,
    divider : { top: statusCode !== 404 ? true : false, bottom: statusCode !== 404 ? true : false }
  })

  // Run the application error event hook if it's not a 404
  if ( statusCode !== 404 ) {
    try {
      await CTZN.hooks.citizen.application.error(err, params, context)
      if ( CTZN.hooks.app.application && CTZN.hooks.app.application.error ) {
        await CTZN.hooks.app.application.error(err, params, context)
      }
    } catch ( err ) {
      if ( CTZN.config.citizen.mode === 'production' || !debug(params, context) ) {
        logContent = err.stack ? requested + err.stack : requested + util.inspect(err)
      } else {
        logContent = err.stack ? debug(params, context) + ' ' + requested + err.stack : debug(params, context) + ' ' + requested + util.inspect(err)
      }
      helpers.log({
        type    : 'error',
        label   : 'Application error handler failed',
        content : logContent
      })
    }
  }

  if ( params && !params.response.writableEnded ) {
    params.response.statusCode = statusCode

    switch ( params.route.format ) {
      case 'html':
        params.response.setHeader('Content-Type', 'text/html')
        switch ( CTZN.config.citizen.mode ) {
          case 'production':
            if ( CTZN.patterns.views.error ) {
              if ( CTZN.patterns.views.error[err.code] ) {
                errorView = err.code
              } else if ( CTZN.patterns.views.error[statusCode] ) {
                errorView = statusCode
              }

              context.content.error = {
                raw: err,
                inspect: util.inspect(err)
              }

              render = await renderView({ pattern: 'error', view: errorView, format: 'html', params: params, context: Object.assign({}, context.content, params) })
              params.response.end(render)
            } else {
              if ( err.stack ) {
                params.response.end('<pre><code>' + err.stack + '</code></pre>')
              } else {
                params.response.end('<pre><code>' + util.inspect(err) + '</code></pre>')
              }
            }
            break
          case 'development':
            if ( err.stack ) {
              params.response.end('<pre><code>' + err.stack + '</code></pre>')
            } else {
              params.response.end('<pre><code>' + util.inspect(err) + '</code></pre>')
            }
            break
        }
        break
      case 'json':
      case 'jsonp':
        context.content = { error: { description: err.toString(), details: err.stack ? requested + err.stack : requested + err } }

        if ( !params.url.output ) {
          context = context.content
        } else {
          context = err
        }
        
        params.response.setHeader('Content-Type', params.route.format === 'json' ? 'application/json' : 'text/javascript')

        render = await renderView({ format: params.route.format, params: params, context: context, jsonpCallback: params.url.callback })
        params.response.end(render)
        break
    }
  }
})



// Server functions

export const start = (options) => {
  server.emit('applicationStart', options)
}


function createServer() {
  if ( CTZN.config.citizen.http.enable ) {
    const httpServer = http.createServer((request, response) => {
      serve(request, response, 'http')
    })
    
    httpServer.listen(CTZN.config.citizen.http.port, CTZN.config.citizen.http.hostname, CTZN.config.citizen.connectionQueue, function () {
      var httpHostname = CTZN.config.citizen.http.hostname.length ? CTZN.config.citizen.http.hostname : '127.0.0.1',
          appUrl = CTZN.config.citizen.http.port === 80 ? 'http://' + httpHostname + CTZN.config.citizen.urlPaths.app : 'http://' + httpHostname + ':' + CTZN.config.citizen.http.port + CTZN.config.citizen.urlPaths.app,
          startupMessage = '\nHTTP server started\n' +
                            '\n  Application mode:  ' + CTZN.config.citizen.mode +
                            '\n  Port:              ' + CTZN.config.citizen.http.port +
                            '\n  Local URL:         ' + appUrl

      if ( !CTZN.config.citizen.http.hostname.length ) {
        startupMessage += '\n\n  Note: You\'ve specified an empty hostname, so the server will respond to requests at any host.'
      }

      if ( CTZN.config.citizen.mode === 'development' && !CTZN.config.citizen.development.enableCache ) {
        startupMessage += '\n\n  Note: By default, caching is disabled in development mode, so you won\'t see any logs related to caching. To enable caching in development mode, set "enableCache" to true under the development node in your config file.'
      }

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
      
      httpsServer.listen(CTZN.config.citizen.https.port, CTZN.config.citizen.https.hostname, CTZN.config.citizen.connectionQueue, function () {
        var httpsHostname = CTZN.config.citizen.https.hostname.length ? CTZN.config.citizen.https.hostname : '127.0.0.1',
            appUrl = CTZN.config.citizen.https.port === 443 ? 'https://' + httpsHostname + CTZN.config.citizen.urlPaths.app : 'https://' + httpsHostname + ':' + CTZN.config.citizen.https.port + CTZN.config.citizen.urlPaths.app,
            startupMessage = '\nHTTPS server started\n' +
                              '\n  Application mode:  ' + CTZN.config.citizen.mode +
                              '\n  Port:              ' + CTZN.config.citizen.https.port +
                              '\n  Local URL:         ' + appUrl

        if ( !CTZN.config.citizen.https.hostname.length ) {
          startupMessage += '\n\n  Note: You\'ve specified an empty hostname, so the server will respond to requests at any host.'
        }

        if ( CTZN.config.citizen.mode === 'development' && !CTZN.config.citizen.development.enableCache ) {
          startupMessage += '\n\n  Note: By default, caching is disabled in development mode, so you won\'t see any logs related to caching. To enable caching in development mode, set "enableCache" to true under the development node in your config file.'
        }

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
  var context = {},
      params = {
        request   : request,
        response  : response,
        route     : router.getRoute(protocol + '://' + request.headers.host + request.url),
        url       : {},
        form      : {},
        payload   : {},
        cookie    : parseCookie(request.headers.cookie),
        session   : {},
        config    : helpers.copy(CTZN.config)
      }
  
  // Prevents further response execution when the client arbitrarily closes the connection, which
  // helps conserve resources.
  params.response.on('close', function () {
    if ( !params.response.writableEnded ) {
      params.response.end()
      helpers.log({
        label: 'Connection closed, probably by the client.',
        content: ' (Route: ' + params.route.url + ')'
      })
    }
  })
  
  params.request.client = {
    encoding: CTZN.config.citizen.compression.force || 'identity'
  }

  if ( !params.route.isStatic && CTZN.config.citizen.sessions && params.cookie.ctzn_sessionID ) {
    params.session = CTZN.sessions[params.cookie.ctzn_sessionID] || params.session
  }

  let staticPath,
      staticCacheEnabled,
      cachedFile,
      compressable = CTZN.config.citizen.compression.enable && !CTZN.config.citizen.compression.force && ( !params.route.isStatic || CTZN.config.citizen.compression.mimeTypes.indexOf(CTZN.config.citizen.mimetypes[params.route.extension]) >= 0 ),
      lastModified

  // Determine client encoding support for compressable assets. Can be forced via config.citizen.compression.force
  if ( compressable ) {
    let acceptEncoding = params.request.headers['accept-encoding'] ? params.request.headers['accept-encoding'].split(',') : [],
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
        params.request.client.encoding = encoding[i][0]
        break
      }
    }
  }

  response.setHeader('X-Powered-By', 'citizen')

  // If it's a dynamic page request, emit the requestStart event.
  // Otherwise, serve the static asset.
  if ( !params.route.isStatic ) {
    params.url = router.getUrlParams(request.url)

    // Overwrite the default route parameters with URL parameters if they exist
    params.route.action = params.url.action || params.route.action
    params.route.ajax = params.url.ajax === 'true' || params.request.headers['x-requested-with'] === 'XMLHttpRequest' ? true : params.route.ajax
    params.route.type = params.url.type || params.route.type
    params.route.show = params.url.show || params.route.show

    // Determine preferred format requested by client
    let acceptFormat = params.request.headers['accept'] ? params.request.headers['accept'].split(',') : [],
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
      // Use the appropriate format if it's supported
      if ( format[i][1] && ( format[i][0] === 'text/html' || format[i][0] === 'application/json' || format[i][0] === 'application/javascript' ) ) {
        switch ( format[i][0] ) {
          case 'text/html':
            params.route.format = 'html'
            break
          case 'application/json':
            params.route.format = 'json'
            break
          case 'application/javascript':
            params.route.format = 'jsonp'
            break
        }
        break
      }
    }
    // The format URL parameter takes precedence over the Accept header
    params.route.format = params.url.format || params.route.format
    params.route.format = params.route.format.toLowerCase()

    server.emit('requestStart', params, context)
  } else {
    staticPath = CTZN.config.citizen.directories.web + params.route.filePath
    staticCacheEnabled = ( CTZN.config.citizen.mode !== 'development' && CTZN.config.citizen.cache.static.enable ) || ( CTZN.config.citizen.mode === 'development' && CTZN.config.citizen.development.enableCache && CTZN.config.citizen.cache.static.enable )

    response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension])
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

    if ( staticCacheEnabled ) {
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
        if ( compressable ) {
          response.setHeader('Content-Encoding', params.request.client.encoding)
        }
        response.end(cachedFile.value[params.request.client.encoding])
      }

      helpers.log({
        label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode] + ' ',
        content: params.route.filePath
      })
    } else {
      let remoteHost = ( params ? request.headers['x-forwarded-for'] || params.request.connection.remoteAddress || params.request.socket.remoteAddress || ( params.request.connection.socket ? params.request.connection.socket.remoteAddress : 'undefined' ) : 'undefined' ).replace('::ffff:', '')

      helpers.log({
        label : 'Remote host ' + remoteHost + ' requested ' + params.route.filePath
      })

      fs.readFile(staticPath, function (err, data) {
        if ( !err ) {
          fs.stat(staticPath, async (err, stats) => {
            lastModified = stats.mtime.toISOString()

            if ( !params.response.headersSent ) {
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
                    staticCacheEnabled || params.request.client.encoding === 'gzip' ? compress.gzip(data) : false,
                    staticCacheEnabled || params.request.client.encoding === 'deflate' ? compress.deflate(data) : false
                  ]).catch(err => { server.emit('error', err, params, context) })
  
                  let compressed = {
                    gzip    : gzip,
                    deflate : deflate
                  }
  
                  if ( !params.response.headersSent ) {
                    response.setHeader('Content-Encoding', params.request.client.encoding)
                    response.end(compressed[params.request.client.encoding])
                  }

                  if ( staticCacheEnabled ) {
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
                  }
                } else {
                  response.end(data)
  
                  if ( staticCacheEnabled ) {
                    cache.set({
                      file: staticPath,
                      value: {
                        identity: data
                      },
                      stats: stats,
                      lifespan: CTZN.config.citizen.cache.static.lifespan,
                      resetOnAccess: CTZN.config.citizen.cache.static.resetOnAccess
                    })
                  }
                }
              }
  
              helpers.log({
                label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode] + ' ',
                content: params.route.filePath
              })
            }
          })
        } else {
          response.statusCode = 404
          response.end()

          helpers.log({
            type    : 'error',
            label   : response.statusCode + ' ' + http.STATUS_CODES[response.statusCode] + ' ',
            content : params.route.filePath
          })
        }
      })
    }
  }
}


function setSession(params, context, system) {
  if ( CTZN.config.citizen.sessions && context.session && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && Object.keys(context.session).length ) {
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


function setCookie(params, context) {
  if ( context.cookie ) {
    var cookie = buildCookie(context.cookie, params)
  
    if ( cookie.length ) {
      params.response.setHeader('Set-Cookie', cookie)
    }
  }
}


async function processRequest(params, context) {
  var controller = CTZN.patterns.controllers[params.route.controller],
      formParser,
      formOptions = helpers.copy(CTZN.config.citizen.form),
      body = ''

  switch ( params.request.method ) {
    case 'GET':
      try {
        let requestEnd = await CTZN.hooks.citizen.request.end(params)
        context = helpers.extend(context, requestEnd)
        if ( CTZN.hooks.app.request && CTZN.hooks.app.request.end ) {
          requestEnd = await CTZN.hooks.app.request.end(params)
          context = helpers.extend(context, requestEnd)
        }
        setSession(params, context)
        server.emit('responseStart', params, context)
      } catch (err) {
        server.emit('error', err, params, context)
      }
      break
    case 'POST':
      if ( controller.config && controller.config.form && controller.config.form[params.route.action] ) {
        formOptions = helpers.extend(formOptions, controller.config.form[params.route.action])
      }

      if ( formOptions.maxFieldsSize ) {
        formOptions.maxFieldsSize = formOptions.maxFieldsSize * 1024
      }

      formParser = new formidable.IncomingForm(formOptions)

      formParser.on('progress', function (bytesReceived, bytesExpected) {
        if ( bytesExpected > formParser.maxFieldsSize || bytesReceived > formParser.maxFieldsSize ) {
          let err = new Error('The maximum upload size for this form has been exceeded (max: ' + formParser.maxFieldsSize + 'k, received: ' + bytesReceived + 'k, expected: ' + bytesExpected + 'k).')
          err.statusCode = 413
          server.emit('error', err, params, context)
        }
      })

      formParser.parse(params.request, function (err, fields, files) {
        if ( !err ) {
          params.form = helpers.extend(fields, files)
          helpers.log({
            label: 'Form input processed',
            content: {
              fields: fields,
              files: files
            }
          })
          server.emit('responseStart', params, context)
        } else {
          server.emit('error', err, params, context)
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
      switch ( params.request.headers['content-type'] ) {
        default:
          params.request.on('data', function (chunk) {
            body += chunk.toString()
          })
          params.request.on('end', function () {
            try {
              params.payload = JSON.parse(body)
            } catch ( err ) {
              err.message = 'You didn\'t specify a valid Content-Type for your payload, so we tried to parse it as JSON, but failed. If it is JSON, it\'s probably not formatted correctly. If it\'s another format, please specify a Content-Type header in your request. Valid Content-Type headers are "application/json", "application/x-www-form-urlencoded", or "multipart/form-data".'
              server.emit('error', err, params, context)
            }
            helpers.log({
              label: 'Payload processed',
              content: params.payload
            })
            server.emit('responseStart', params, context)
          })
          break
        case 'application/json':
          params.request.on('data', function (chunk) {
            body += chunk.toString()
          })
          params.request.on('end', function () {
            try {
              params.payload = JSON.parse(body)
            } catch ( err ) {
              err.message = 'Failed to parse the JSON payload. The payload probably isn\'t formatted correctly.'
              server.emit('error', err, params, context)
            }
            helpers.log({
              label: 'Payload received and parsed',
              content: params.payload
            })
            server.emit('responseStart', params, context)
          })
          break
        case 'application/x-www-form-urlencoded':
        case 'multipart/form-data':
          if ( controller.config && controller.config.form && controller.config.form[params.route.action] ) {
            formOptions = helpers.extend(formOptions, controller.config.form[params.route.action])
          }

          if ( formOptions.maxFieldsSize ) {
            formOptions.maxFieldsSize = formOptions.maxFieldsSize * 1024
          }

          formParser = new formidable.IncomingForm(formOptions)

          formParser.parse(params.request, function (err, fields, files) {
            if ( !err ) {
              params.payload = helpers.extend(fields, files)
              helpers.log({
                label: 'Payload received and parsed',
                content: {
                  fields: fields,
                  files: files
                }
              })
              server.emit('responseStart', params, context)
            } else {
              err.message = 'Failed to parse the JSON payload. It\'s probable the payload isn\'t properly formatted.'
              server.emit('error', err, params, context)
            }
          })
          break
      }
      break
    // Just send the response headers for HEAD and OPTIONS
    case 'HEAD':
    case 'OPTIONS':
      params.response.end()
      break
  }
}


async function fireController(params, context) {
  let controller = context.handoffController || params.route.controller,
      action = context.handoffAction || params.route.action,
      view = context.handoffView || context.view || params.route.view,
      cachedController = cache.getController({ controller: controller, action: action, view: view, route: params.route.pathname }) || cache.getController({ controller: controller, action: action, view: view, route: 'global' }),
      include = {},
      includeProperties,
      includes = [],
      pattern = {},
      proceed = true

  // If the controller is previously cached, pull from the cache.
  if ( cachedController ) {
    pattern = cachedController.context || {}
  // Otherwise, try calling the controller.
  } else {
    helpers.log({
      label: 'Firing controller: ' + controller,
      content: {
        controller: controller,
        action: action
      }
    })
    try {
      pattern = await CTZN.patterns.controllers[controller][action](params) || {}
    } catch ( err ) {
      proceed = false
      server.emit('error', err, params, context)
    }
  }

  if ( proceed ) {
    // If inherit is specified in a handoff, the existing context takes precedence over the pattern's output
    if ( !context.handoff || context.handoff && !context.handoff.inherit ) {
      context = helpers.extend(context, pattern)
    } else {
      context = helpers.extend(pattern, context)
    }

    // Set headers based on controller action headers
    if ( context.header ) {
      context.headerLowercase = context.headerLowercase || {}
      Object.keys(context.header).forEach( item => {
        params.response.setHeader(item, context.header[item])
        // Create lowercase version of header name for easier comparison later
        context.headerLowercase[item.toLowerCase()] = context.header[item]
      })
    }

    include = context.include || include

    params.route.view = context.view || params.route.view
    params.route.renderedView = context.view || params.route.renderedView
    if ( context.view ) {
      params.route.chain[params.route.chain.length-1].view = params.route.view
      params.route.chain[params.route.chain.length-1].action = context.handoffAction || params.route.action
    }
    // If it exists, the calling controller's handoff view takes precedence over the receiving controller's view
    if ( context.handoffView ) {
      context.view = context.handoffView
    }
    context.content = context.content || {}
    if ( !context.handoff && CTZN.config.citizen.layout.controller.length && controller !== CTZN.config.citizen.layout.controller ) {
      context.handoff  = CTZN.config.citizen.layout
    }
    delete context.handoffController
    delete context.handoffView
    delete context.handOffAction

    context.legalFormat = helpers.extend(CTZN.config.citizen.legalFormat, context.legalFormat)

    if ( !params.response.writableEnded ) {
      Object.keys(context.content).every( item => {
        if ( CTZN.reserved.content.indexOf(item) >= 0 ) {
          proceed = false
          let err = new Error('"' + item + '" is a reserved content variable name used internally by citizen. Please choose a different variable name.')
          server.emit('error', err, params, context)
          return false
        } else {
          return true
        }
      })

      if ( proceed ) {
        if ( !context.legalFormat[params.route.format] ) {
          let err, format = params.route.format
  
          switch ( params.route.format ) {
            case 'html':
              err = new Error('HTML output is disabled for this controller.')
              params.route.format = 'json'
              break
            case 'json':
              err = new Error('JSON output is disabled for this controller.')
              params.route.format = 'html'
              break
            case 'jsonp':
              err = new Error('JSONP output is disabled for this controller.')
              params.route.format = 'html'
              break
            default:
              err = new Error(format + ' is not a valid output format.')
              params.route.format = 'html'
              break
          }
  
          server.emit('error', err, params, context)
        } else {
          try {
            setSession(params, context)
          } catch (err) {
            proceed = false
            server.emit('error', err, params, context)
          }
    
          if ( proceed ) {
            if ( context.redirect && ( typeof context.redirect === 'string' || ( Object.keys(context.redirect).length && typeof context.redirect.refresh === 'undefined' ) ) && params.route.type !== 'direct' ) {
              setCookie(params, context)
              redirect(params, context)
      
              cacheController({
                controller: controller,
                action: action,
                view: params.route.renderedView,
                route: params.route.pathname,
                context: context,
                params: params
              })
            } else {
              if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && params.route.type !== 'direct' ) {
                redirect(params, context)
              }
              includeProperties = Object.getOwnPropertyNames(include)
              if ( includeProperties.length && params.route.format === 'html' ) {
                includeProperties.forEach( function (item, index) {
      
                  include[item].params = Object.assign({}, params)
      
                  if ( !include[item].route ) {
                    include[item].action = include[item].action || 'handler'
                    include[item].view = include[item].view || include[item].controller
                    include[item].pathname = params.route.pathname
                  } else {
                    include[item].params.route = router.getRoute(include[item].params.route.parsed.protocol + '//' + params.request.headers.host + include[item].route)
                    include[item].params.url = router.getUrlParams(include[item].route)
      
                    // Overwrite the default route parameters with URL parameters if they exist
                    include[item].params.route.action = include[item].params.url.action || include[item].params.route.action
                    include[item].params.route.type = include[item].params.url.type || include[item].params.route.type
                    include[item].params.route.format = include[item].params.url.format || include[item].params.route.format
                    include[item].params.route.format = include[item].params.route.format.toLowerCase()
                    include[item].params.route.show = include[item].params.url.show || include[item].params.route.show
      
                    include[item].controller = include[item].params.route.controller
                    include[item].action = include[item].params.route.action
                    include[item].view = include[item].view || include[item].controller
                    include[item].pathname = include[item].params.route.pathname
                  }
      
                  include[item].cache = cache.getController({ controller: include[item].controller, action: include[item].action, view: include[item].view, route: include[item].pathname }) || cache.getController({ controller: include[item].controller, action: include[item].action, view: include[item].view, route: 'global' })
    
                  context.content.include = context.content.include || {}
      
                  includes[index] = ( async () => {
                    if ( include[item].cache ) {
                      context.content.include[item] = include[item].cache.render
                    } else {
                      helpers.log({
                        label: 'Firing include controller: ' + include[item].controller,
                        content: {
                          controller: include[item].controller,
                          action: include[item].action
                        }
                      })
    
                      try {
                        include[item].context = await CTZN.patterns.controllers[include[item].controller][include[item].action](include[item].params, context) || {}
                      } catch (err) {
                        proceed = false
                        if ( !include[item].controller ) {
                          err.message = 'You must specify a valid controller or route within a citizen include (calling controller: ' + params.route.controller + ').'
                        } else if ( !CTZN.patterns.controllers[include[item].controller] ) {
                          err.message = 'The controller you requested to be included (' + include[item].controller + ') doesn\'t exist.'
                        } else if ( !CTZN.patterns.controllers[include[item].controller][include[item].action] ) {
                          err.message = 'The controller action you requested to be included (' + include[item].controller + '.' + include[item].action + ') doesn\'t exist.'
                        }
                        return Promise.reject(err)
                      }
    
                      if ( proceed ) {
                        switch ( include[item].params.route.format ) {
                          case 'html':
                            include[item].viewContext = Object.assign({}, include[item].context.content, params)
                            break
                          // If the output is JSON, pass the raw content to the view renderer
                          case 'json':
                          case 'jsonp':
                            if ( !include[item].params.url.output ) {
                              include[item].viewContext = include[item].context.content
                            } else {
                              include[item].viewContext = createJSON(include[item].params, include[item].context)
                            }
                            break
                        }

                        // If the include controller specifies a view, use it. Otherwise, use the view
                        // specified by the calling controller (or the default view). Note that using
                        // the view directive in an include controller breaks caching for that controller:
                        // https://github.com/jaysylvester/citizen/issues/67
                        let includeView = include[item].context.view || include[item].view
        
                        helpers.log({
                          label: 'Rendering include: ' + item,
                          content: {
                            controller: include[item].controller,
                            action: include[item].action,
                            view: includeView
                          }
                        })
        
                        let render
                        try {
                          render = await renderView({
                            pattern: include[item].controller,
                            view: includeView,
                            format: include[item].params.route.format,
                            params: include[item].params,
                            context: include[item].viewContext,
                            jsonpCallback: include[item].params.url.callback })
                        } catch (err) {
                          proceed = false
                          return Promise.reject(include[item].context.error)
                        }
        
                        if ( proceed ) {
                          context.content.include[item] = render
        
                          cacheController({
                            controller: include[item].controller,
                            action: include[item].action,
                            view: includeView,
                            route: include[item].params.route.pathname,
                            context: include[item].context,
                            render: params.route.format === 'html' ? render : false,
                            params: include[item].params
                          })
                        }
                      }
                    }
                  })()
                })
    
                if ( includes.length ) {
                  Promise.all(includes).then(() => {
                    delete context.include
                    handoffOrRespond(params, context)
                  }).catch(err => { server.emit('error', err, params, context) })
                } else {
                  delete context.include
                  handoffOrRespond(params, context)
                }
              } else {
                handoffOrRespond(params, context)
              }
            }
          }
        }
      }
    }
  }
}


function handoffOrRespond(params, context) {
  if ( !params.response.writableEnded ) {
    if ( context.handoff && params.route.type !== 'direct' ) {
      preHandoff(params, context)
    } else {
      setCookie(params, context)
      respond(params, context)
    }
  }
}


function redirect(params, context, setReferrer) {
  var url = typeof context.redirect === 'string' ? context.redirect : context.redirect.url,
      statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number',
      ctzn_referer = params.request.headers['x-citizen-uri'] || params.route.url

  setReferrer = setReferrer !== false ? true : false

  helpers.log({
    label: 'Redirecting',
    content: {
      url: url,
      statusCode: statusCode,
      header: refresh ? 'Refresh' : 'Location'
    }
  })

  if ( refresh ) {
    params.response.statusCode = statusCode
    params.response.setHeader('Refresh', context.redirect.refresh + ';url=' + url)
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
        setSession(params, context, true)
      } else {
        if ( context.cookie ) {
          context.cookie.ctzn_referer = ctzn_referer
        } else {
          context.cookie = {
            ctzn_referer: ctzn_referer
          }
        }
        setCookie(params, context)
      }
    }
    params.response.writeHead(statusCode, {
      'Location': url
    })
    params.response.end()
  }
}


async function cacheController(options) {
  var cacheExists,
      cacheContext = {},
      cacheLifespan,
      cacheReset,
      proceed = true

  if ( options.context.cache && options.context.cache.controller ) {
    cacheExists = cache.exists({
      controller: options.controller,
      action: options.action,
      view: options.view,
      route: options.context.cache.controller.scope === 'route' ? options.route : 'global'
    })

    if ( !cacheExists ) {
      cacheLifespan = options.context.cache.controller.lifespan || CTZN.config.citizen.cache.application.lifespan
      cacheReset = options.context.cache.controller.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess

      if ( Object.keys(options.params.url).length && options.context.cache.controller.urlParams ) {
        Object.getOwnPropertyNames(options.params.url).forEach( function (item) {
          if ( options.context.cache.controller.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            proceed = false
            let err = new Error('Cache attempt on ' + options.controller + ' controller failed due to an invalid URL parameter (' + item + '). Request denied.')
            server.emit('error', err, options.params, options.context)
          }
        })
      }

      if ( proceed ) {
        // Cache only those directives specified by the cache.directives array
        if ( options.context.cache.controller.directives ) {
          options.context.cache.controller.directives.forEach( function (item) {
            // Skip the include directive because include views are cached with the controller view
            if ( options.context[item] && options.context[item] !== 'include' ) {
              cacheContext[item] = options.context[item]
            }
          })
        }
        // The format directive is an exception (can't think of a reason why you'd only want a specific format on the first request)
        cacheContext.legalFormat = options.context.legalFormat
  
        if ( options.context.content ) {
          cacheContext.content = options.context.content
        }
  
        try {
          if ( !options.render ) {
            options.render = await renderView({
              pattern: options.controller,
              view: options.params.route.renderedView,
              format: 'html',
              params: options.params,
              context: cacheContext.content,
              jsonpCallback: options.params.url.callback })
          }
  
          cache.setController({
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: options.context.cache.controller.scope === 'route' ? options.route : 'global',
            context: cacheContext,
            render: options.render,
            lifespan: cacheLifespan,
            resetOnAccess: cacheReset
          })
        } catch (err) {
          server.emit('error', err, options.params, options.context)
        }
      }
    }
  }
}


async function preHandoff(params, context) {
  var thisHandoff = helpers.copy(context.handoff),
      lastLink = params.route.chain[params.route.chain.length-1],
      renderer = thisHandoff.controller || params.route.renderer,
      renderedView = thisHandoff.view || thisHandoff.controller,
      action = thisHandoff.action || 'handler',
      cachedController,
      viewContext

  if ( !CTZN.patterns.controllers[thisHandoff.controller] ) {
    let err = new Error('server.preHandoff(): The ' + thisHandoff.controller + ' controller doesn\'t exist.')
    server.emit('error', err, params, context)
  } else if ( context.view !== false ) {
    if ( CTZN.patterns.views[lastLink.controller][lastLink.view] ) {
      cachedController = cache.getController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: params.route.pathname }) || cache.getController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: 'global' })

      if ( cachedController ) {
        lastLink.viewContent = cachedController.render
        helpers.log({
          label: 'Using cached controller: ',
          content: lastLink.controller
        })
        handoff(params, context, thisHandoff, action, renderedView, renderer)
      } else {
        switch ( params.route.format ) {
          case 'html':
            viewContext = Object.assign({}, context.content, params)
            break
          // If the output is JSON, pass the raw content to the view renderer
          case 'json':
          case 'jsonp':
            // Don't call createJSON() from here because it checks for the url.output
            // parameter, which will throw an error if it specifies a parameter not yet
            // added via the controller chain. Only direct controller calls (/type/direct)
            // and chained controller calls should use createJSON(), not handoff.
            viewContext = context.content
            break
        }

        let proceed = true, render
        try {
          helpers.log({
            label: 'Rendering controller: ' + lastLink.controller,
            content: {
              controller: lastLink.controller,
              action: lastLink.action,
              view: lastLink.view
            }
          })
          render = await renderView({ pattern: lastLink.controller, view: lastLink.view, format: params.route.format, params: params, context: viewContext, jsonpCallback: params.url.callback})
        } catch (err) {
          proceed = false
          server.emit('error', err, params, context)
        }

        if ( proceed ) {
          lastLink.viewContent = render

          await cacheController({
            controller: lastLink.controller,
            action: lastLink.action,
            view: lastLink.view,
            route: params.route.pathname,
            context: context,
            render: params.route.format === 'html' ? lastLink.viewContent : false,
            params: params
          })

          handoff(params, context, thisHandoff, action, renderedView, renderer)
        }
      }
    } else {
      server.emit('error', {
        stack: new Error('The handoff view you specified (' + lastLink.view + ') doesn\'t exist.').stack
      }, params, context)
    }
  } else {
    handoff(params, context, thisHandoff, action, renderedView, renderer)
  }
}


function handoff(params, context, thisHandoff, action, renderedView, renderer) {
  params.route.chain = params.route.chain.concat([{ controller: thisHandoff.controller, action: action, view: renderedView }])
  params.route.renderer = renderer
  params.route.renderedView = renderedView
  delete context.handoff
  delete context.view
  context.session = {}
  if ( context.cache ) {
    delete context.cache.controller
  }
  context.handoffController = thisHandoff.controller
  context.handoffView = thisHandoff.view || thisHandoff.controller
  context.handoffAction = action
  helpers.log({
    label: 'Handing off to controller: ' + thisHandoff.controller
  })
  fireController(params, context)
}


async function respond(params, context) {
  var contentType,
      viewContext,
      lastModified = context.cache && context.cache.route && context.cache.route.lastModified ? context.cache.route.lastModified : new Date().toISOString()

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html'
      viewContext = Object.assign({}, context.content, params)
      if ( CTZN.config.citizen.mode === 'development' && ( CTZN.config.citizen.development.debug.view || params.url.ctzn_debug ) ) {
        viewContext.ctzn_debugOutput = debug(params, context)
      }
      break
    case 'json':
      contentType = 'application/json'

      if ( !params.url.output ) {
        viewContext = context.content
      } else {
        viewContext = createJSON(params, context)
      }
      break
    case 'jsonp':
      contentType = 'text/javascript'

      if ( !params.url.output ) {
        viewContext = context.content
      } else {
        viewContext = createJSON(params, context)
      }
      break
  }

  params.response.setHeader('Cache-Control', context.headerLowercase && context.headerLowercase['cache-control'] ? context.headerLowercase['cache-control'] : 'max-age=0')
  params.response.setHeader('ETag', context.headerLowercase && context.headerLowercase['etag'] ? context.headerLowercase['etag'] : lastModified)
  
  try {
    let render = await renderView({ pattern: params.route.renderer, view: params.route.renderedView, format: params.route.format, params: params, context: viewContext, jsonpCallback: params.url.callback })

    if ( CTZN.config.citizen.compression.enable && ( context.cache || ( params.request.client.encoding === 'gzip' || params.request.client.encoding === 'deflate' ) ) ) {
      let [
        gzip,
        deflate
      ] = await Promise.all([
        context.cache || params.request.client.encoding === 'gzip' ? compress.gzip(render) : false,
        context.cache || params.request.client.encoding === 'deflate' ? compress.deflate(render) : false
      ]).catch(err => { server.emit('error', err, params, context) })

      let compressed = {
        gzip    : gzip,
        deflate : deflate
      }

      if ( !params.response.writableEnded ) {
        params.response.setHeader('Content-Type', contentType)
        params.response.setHeader('Content-Encoding', params.request.client.encoding)
        params.response.end(compressed[params.request.client.encoding] || render)
        server.emit('responseEnd', params, context)
      }
      cacheResponse(params, context, render, gzip, deflate, contentType, lastModified)
    } else {
      if ( !params.response.writableEnded ) {
        params.response.setHeader('Content-Type', contentType)
        params.response.setHeader('Content-Encoding', 'identity')
        params.response.end(render)
        server.emit('responseEnd', params, context)
      }
      cacheResponse(params, context, render, '', '', contentType, lastModified)
    }
  } catch (err) {
    server.emit('error', err, params, context)
  }
}


function cacheResponse(params, context, render, zipped, deflated, contentType, lastModified) {
  let proceed = true

  if ( context.cache ) {
    if ( context.cache.route && ( context.cache.route === true || Object.keys(context.cache.route).length ) ) {
      if ( Object.keys(params.url).length && context.cache.route.urlParams ) {
        Object.getOwnPropertyNames(params.url).forEach( function (item) {
          if ( context.cache.route.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            proceed = false
            let err = new Error('Cache attempt on ' + params.route.controller + ' route failed due to an invalid URL parameter (' + item + '). Request denied.')
            server.emit('error', err, params, context)
          }
        })
      }

      if ( proceed ) {
        cache.setRoute({
          route: params.route.pathname,
          contentType: contentType,
          render: {
            identity: render,
            gzip: zipped,
            deflate: deflated
          },
          context: context,
          lastModified: lastModified,
          lifespan: context.cache.route.lifespan || CTZN.config.citizen.cache.application.lifespan,
          resetOnAccess: context.cache.route.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess
        })
      }
    }

    if ( context.cache.controller && ( context.cache.controller === true || Object.keys(context.cache.controller).length ) ) {
      cacheController({
        controller: params.route.chain[params.route.chain.length-1].controller,
        action: params.route.chain[params.route.chain.length-1].action,
        view: params.route.chain[params.route.chain.length-1].view,
        route: params.route.pathname,
        context: context,
        render: params.route.format === 'html' ? render : false,
        params: params
      })
    }
  }
}


function createJSON(params, context) {
  var outputArray,
      outputNode,
      output = {}

  try {
    outputArray = params.url.output.split(',')
  } catch (err) {
    throwError(err)
  }

  if ( context.content[decodeURIComponent(outputArray[0])] ) {
    output = context.content[decodeURIComponent(outputArray[0])]

    for ( var i = 1; i < outputArray.length; i++ ) {
      outputNode = decodeURIComponent(outputArray[i])

      if ( output[outputNode] ) {
        output = output[outputNode]
      } else {
        throwError()
      }
    }

    return output
  } else {
    throwError()
  }

  function throwError(err) {
    var error = err || {
          statusCode: 404,
          stack: new Error('The requested JSON notation (' + params.url.output + ') doesn\'t exist. Make sure you\'re using a comma (,) as a delimiter for nested output.').stack
        }

    server.emit('error', error, params, context)
  }
}


async function renderView(options) {
  var viewContext = options.context,
      json = '',
      callbackRegex

  switch ( options.format ) {
    case 'html':
      if ( CTZN.patterns.views[options.pattern][options.view] ) {
        if ( CTZN.config.citizen.mode === 'production' ) {
          viewContext.cache = true
        }

        try {
          let html = await consolidate[CTZN.config.citizen.templateEngine](CTZN.patterns.views[options.pattern][options.view].path, viewContext)
          if ( options.context.ctzn_debugOutput ) {
            html = html.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
          }
          return html
        } catch (err) {
          server.emit('error', err, options.params, options.context)
        }
      } else {
        throw new Error('server.renderView(): The requested view (' + options.view + ') doesn\'t exist.')
      }
      break
    case 'json':
      // Strip includes from the context because they mess up JSON requests
      if ( options.context.include ) {
        delete options.context.include
      }
      json = JSON.stringify(options.context, null, CTZN.config.citizen.mode === 'production' ? null : 2)
      if ( json.charAt(0) === '"' && json.charAt(json.length - 1) === '"' ) {
        json = json.slice(1, -1)
      }
      return json
    case 'jsonp':
      callbackRegex = new RegExp(/^[A-Za-z0-9_]*$/)
      if ( callbackRegex.test(options.jsonpCallback) ) {
        // Strip includes from the context because they mess up JSON requests
        if ( options.context.include ) {
          delete options.context.include
        }
        json = options.jsonpCallback + '(' + JSON.stringify(options.context, null, CTZN.config.citizen.mode === 'production' ? null : 2) + ');'
      } else {
        throw new Error('server.renderView(): JSONP callback names should consist of letters, numbers, and underscores only.')
      }
      return json
  }
}


function debug(params, context) {
  var toDebug     = params.url.ctzn_debug || 'context',
      showHidden  = params.url.ctzn_debugShowHidden || CTZN.config.citizen.development.debug.showHidden,
      depth       = params.url.ctzn_debugDepth || CTZN.config.citizen.development.debug.depth,
      dump        = '',
      viewDump    = '',
      label       = ''
  
  try {
    if ( toDebug === 'context' ) {
      let logContent = {}
      CTZN.config.citizen.development.debug.scope.request ? logContent.request = params.request : false
      CTZN.config.citizen.development.debug.scope.response ? logContent.response = params.response : false
      CTZN.config.citizen.development.debug.scope.route ? logContent.route = params.route : false
      CTZN.config.citizen.development.debug.scope.url ? logContent.url = params.url : false
      CTZN.config.citizen.development.debug.scope.cookie ? logContent.cookie = params.cookie : false
      CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
      CTZN.config.citizen.development.debug.scope.form ? logContent.form = params.form : false
      CTZN.config.citizen.development.debug.scope.payload ? logContent.payload = params.payload : false
      CTZN.config.citizen.development.debug.scope.context ? logContent.context = context : false
      label = 'Debug parameters and context'
      dump = logContent
    } else {
      label = toDebug + ' dump:\n'
      dump = util.inspect(eval(toDebug), { depth: depth })
    }
    helpers.log({
      label       : label,
      content     : dump,
      timestamp   : false,
      showHidden  : showHidden,
      depth       : depth
    })
    if ( CTZN.config.citizen.development.debug.view || params.url.ctzn_dump === 'view' ) {
      viewDump = util.inspect(dump, { depth: depth })
      viewDump = viewDump.replace(/</g, '&lt;')
      viewDump = viewDump.replace(/>/g, '&gt;')
      viewDump = '<pre>' + viewDump + '</pre>'
      return viewDump
    }
  } catch (err) {
    // Errors utilize the debug function, so a debug error results in a loop/crash.
    // Debug output is only expected in development mode, so just dump any errors to
    // the console and return the error so it's also appended to the view.
    console.log(err)
    return '<pre>' + err + '</pre>'
  }
}


function buildCookie(cookies, params) {
  var defaults = {},
      cookie = {},
      cookieArray = [],
      path = '',
      expires = '',
      httpOnly = '',
      sameSite = '',
      secure = '',
      secureEnabled = ( ( params.request.headers['x-citizen-uri'] && params.request.headers['x-citizen-uri'].indexOf('https:') >= 0 ) || params.route.parsed.protocol === 'https:' ) && CTZN.config.citizen.https.secureCookies,
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
        sameSite: params.request.cors ? 'None' : 'Lax',
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
