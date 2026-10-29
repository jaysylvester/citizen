// server

// node
import events            from 'node:events'
import fs                from 'node:fs'
import fsPromises        from 'node:fs/promises'
import http              from 'node:http'
import https             from 'node:https'
import querystring       from 'node:querystring'
import util              from 'node:util'
import zlib              from 'node:zlib'
// citizen
import cache             from './cache.js'
import { debugScopes,
         debugValue }    from './debug.js'
import helpers           from './helpers.js'
import router            from './router.js'
import session           from './session.js'
import { lastEventId }   from './sse.js'
import { declaration,
         validateDeclaration,
         splitReturn,
         prepareStream,
         writeStream }   from './stream.js'
import { escapeHtml,
         getTemplate }   from './template.js'
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
  server = new events.EventEmitter({ captureRejections: true }),
  managed = new WeakMap(),
  // Content negotiation
  mediaToken = '[!#$%&\'*+.^_`|~0-9A-Za-z-]+',
  mediaType = new RegExp('^' + mediaToken + '/' + mediaToken + '$'),
  qualityWeight = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?|\.\d{1,3})$/,
  renderers = new Set(['text/html', 'text/plain', 'application/json', 'application/javascript'])


// Global promise unhandledRejection handler
process.on('unhandledRejection', (reason) => {
  helpers.log({
    type    : 'error:server',
    label   : 'Unhandled promise rejection',
    content : reason
  })
})


// Server event handlers

server.on('applicationStart', async () => {
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
    if ( !continueResponse(params, request, response, context) ) {
      return
    }

    // Set headers based on controller action headers
    if ( context.header ) {
      context.headerLowercase = setHeaders(response, context.header)
      delete context.header
    }

    server.emit('request', params, request, response, context)
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('request', function (params, request, response, context) {
  if ( !continueResponse(params, request, response, context) ) {
    return
  }
  try {
    validateDeclaration(CTZN.controllers.routes[params.route.controller], params.route.action, CTZN.config.citizen.streaming)
  } catch (err) {
    server.emit('error', err, params, request, response, context)
    return
  }
  // If a previous event in the request context requested a redirect, do it immediately.
  if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && !params.route.direct ) {
    redirect(params, request, response, context)
  } else {
    // If the route controller action exists, extend the global config with the controller config
    if ( CTZN.controllers.routes[params.route.controller]?.[params.route.action] ) {
      extendConfig(params, params.route.controller, params.route.action)

      let corsSession = false,
          respond     = true

      // If the Origin header exists and it's not the host, check if it's allowed. If not,
      // throw an appropriate error.
      if ( request.headers.origin && request.headers.origin !== params.route.base ) {
        const failed = (statusCode) => {
                respond = false
                let err = new Error()
                err.statusCode = statusCode
                server.emit('error', err, params, request, response, context)
              }

        request.cors = true

        if ( params.config.citizen.cors ) {
          // Create lowercase version of headers for easier comparison, while maintaining case for sent header
          let corsLowerCase = {}

          Object.keys(params.config.citizen.cors).forEach( item => {
            corsLowerCase[item.toLowerCase()] = params.config.citizen.cors[item]
          })

          let allowMethods = String(corsLowerCase['access-control-allow-methods'] || '').split(',').map( method => method.trim() ),
              allowOrigin  = corsLowerCase['access-control-allow-origin']

          // If the request origin matches the CORS allowed origin, proceed.
          if ( allowOrigin === '*' || allowOrigin === request.headers.origin ) {
            // If the request method isn't allowed, respond with a 405
            if ( allowMethods.includes(request.method) ) {
              // Respond with the headers from the controller. The processRequest() function
              // will determine whether to end the request in the case of an OPTIONS method
              // (preflight request) or fire the controller.
              Object.keys(params.config.citizen.cors).forEach( item => {
                response.setHeader(item, params.config.citizen.cors[item])
              })

              // Only create a session if Access-Control-Allow-Credentials is set and it's
              // not a preflight request.
              if ( request.method !== 'OPTIONS' && corsLowerCase['access-control-allow-credentials'] ) {
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
    // If the controller/action pairing doesn't exist, throw a 404
    } else {
      let err = new Error()
      err.statusCode = 404
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

      if ( !continueResponse(params, request, response, context) ) {
        return
      }

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

    if ( !continueResponse(params, request, response, context) ) {
      return
    }

    setSession(params, request, response, context)
    server.emit('responseStart', params, request, response, context)
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('responseStart', async (params, request, response, context) => {
  try {
    context = helpers.extend(context, await responseHooks.start(params, request, response, context))
    if ( continueResponse(params, request, response, context) ) {
      await serverResponse(params, request, response, context)
    }
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


server.on('responseEnd', async (params, request, response, context) => {
  let state = managed.get(response)
  if ( state ) {
    if ( state.completed ) {
      return
    }
    state.completed = true
    state.outcome = state.cancelled ? 'cancelled' : state.failure ? 'failed' : 'finished'
    state.release()
  }
  try {
    context = helpers.extend(context, await responseHooks.end(params, request, response, context))
  } catch (err) {
    server.emit('error', err, params, request, response, context)
  }
})


// Keep request context when the error handler itself fails; only report and clean up.
server.on('error', async (err, params, request, response, context, respond = true) => {
  try {
    if ( !(err instanceof Error) ) {
      let thrown = err
      err = new Error(thrown && typeof thrown === 'object' ? thrown.message || 'Application threw a non-Error value.' : String(thrown))
      if ( thrown && typeof thrown === 'object' ) {
        // Keep status/policy and diagnostic properties on thrown error-like objects.
        Object.defineProperties(err, Object.getOwnPropertyDescriptors(thrown))
      }
    }

    let state = managed.get(response)

    if ( state?.cancelled && (err === state.abort.signal.reason || err.name === 'AbortError' || ['ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED', 'ECONNRESET', 'EPIPE'].includes(err.code)) ) {
      return
    }

    if ( state?.failure && (err === state.failure || err.name === 'AbortError' && state.abort.signal.aborted) ) {
      return
    }

    let statusCode = err.statusCode || 500,
        label      = err.label      || statusCode + ' ' + http.STATUS_CODES[statusCode],
        logContent = err.message    || false,
        result     = err.result     || params?.config?.citizen?.errors || global.CTZN?.config?.citizen?.errors,
        applicationError = statusCode >= 500 && statusCode < 600,
        shouldExit = result === 'exit' && applicationError,
        type       = applicationError ? 'error:server' : 'error:client',
        stackText  = stack => rendererType(response?.contentType) === 'text/html' ? escapeHtml(stack) : stack

    if ( state && (respond || shouldExit) ) {
      state.failure = err
      state.abort.abort(err)
      state.stream?.dispose()
      // Abandoned controllers/includes must not resume the error response's pipeline.
      params = helpers.copy(params)
      state.errorParams = params
      state.params = params
    }
    if ( response?.headersSent && !response.writableEnded && (respond || shouldExit) ) {
      response.destroy()
    }

    if ( applicationError ) {
      logContent = err.stack ? err.stack : util.inspect(err)
    } else if ( statusCode === 404 && request?.headers?.referer ) {
      logContent = '(Referrer: ' + request.headers.referer + ')'
    }

    helpers.log({
      type    : type,
      label   : params?.route && request ? helpers.serverLogLabel(statusCode, params, request) : label,
      content : logContent
    })

    // Run the application error event hook for 500-level errors
    if ( applicationError ) {
      try {
        await applicationHooks.error(params, request, response, context, err)
      } catch ( err ) {
        helpers.log({
          type    : 'error:server',
          label   : 'Application error handler failed',
          content : err.stack ? err.stack : util.inspect(err)
        })
      }
    }

    if ( params && response && !response.headersSent && !response.writableEnded && !response.destroyed ) {
      // Reporting alone must not alter a response that is still rendering.
      if ( respond || shouldExit ) {
        response.statusCode = statusCode
      }

      // Default behavior on error is "capture". If set to "exit", allow the error to exit the process.
      if ( shouldExit ) {
        response.end()
        completeManaged(response)
        process.exit(1)
        return
      }

      if ( respond ) {
        let fallback = !rendererType(response.contentType)
        if ( fallback ) {
          response.contentType = 'application/json'
          // A stream-only endpoint must not require a view or application layout for errors.
          params.config = helpers.copy(params.config)
          params.config.citizen.layout = { controller: '', view: '' }
        }
        for ( let header of ['Content-Length', 'Content-Encoding', 'Transfer-Encoding'] ) {
          response.removeHeader(header)
        }
        if ( state?.bufferingHint ) {
          response.removeHeader('X-Accel-Buffering')
        }
        setResponseContentType(response)
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

          if ( ['application/json', 'application/javascript'].includes(rendererType(response.contentType)) ) {
            try {
              JSON.stringify(context.local)
            } catch (failure) {
              // Omit unserializable raw metadata before rendering or copying it into the chain.
              delete context.local.error.raw
              context.local.error.handlingError = { message: failure.message, stack: failure.stack }
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

          if ( ['text/html', 'text/plain'].includes(rendererType(response.contentType)) ) {
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
                return renderErrorFallback(err.stack, params.route.chain.error.context.local.error.stack, stackText)
              })

              // Hand off the error to the layout controller if there is one, as long as the error didn't originate in the layout controller itself.
              if ( params.config.citizen.layout.controller.length && CTZN.controllers.routes[params.config.citizen.layout.controller] && params.route.chain[Object.keys(params.route.chain)[Object.keys(params.route.chain).length-1]].controller !== params.config.citizen.layout.controller ) {
                context.next = params.config.citizen.layout
              }
            // Render only the error
            } else {
              params.route.chain.error.output = '<pre>' + stackText(context.local.error.stack) + '</pre>'
            }
          } else {
            params.route.chain.error.output = await renderView(params, request, response, context, {
              controller: 'error', params, context: context.local, jsonNamespace: true
            })
          }

          await next(params, request, response, context)

        // If the error view throws an error, return that error along with the original error.
        } else {
          let output
          if ( ['application/json', 'application/javascript'].includes(rendererType(response.contentType)) ) {
            output = await renderView(params, request, response, context, {
              controller: 'error', params, jsonNamespace: true,
              context: { error: { ...params.route.chain.error.context.local.error, handlingError: { message: err.message, stack: err.stack } } }
            })
          } else {
            output = renderErrorFallback(err.stack, params.route.chain.error.context.local.error.stack, stackText)
          }

          setResponseContentType(response)
          response.end(request.method === 'HEAD' ? null : output)
          completeManaged(response)
        }
      }
    } else {
      // Default behavior on error is "capture". If set to "exit", allow the error to exit the process.
      completeManaged(response)
      if ( shouldExit ) {
        process.exit(1)
      }
    }
  } catch (failure) {
    try {
      helpers.log({ type: 'error:server', label: 'Error handling failed', content: failure.stack || String(failure) })
    } catch {
      console.error(failure)
    } finally {
      let state = managed.get(response)
      if ( state ) {
        state.failure ||= failure
        state.abort.abort(failure)
        state.stream?.dispose()
      }
      if ( response && !response.writableEnded ) {
        response.destroy()
      }
      completeManaged(response)
      // A failure of the handler itself is a server error, regardless of the original status.
      if ( (err?.result || params?.config?.citizen?.errors || global.CTZN?.config?.citizen?.errors) === 'exit' ) {
        process.exit(1)
      }
    }
  }
})


// Server functions

function renderErrorFallback(stack, originalStack, stackText) {
  return '<section><p><strong>Your app threw an error while trying to render the error view (+2 Irony bonus):</strong></p>' +
          '<pre>' + stackText(stack) + '</pre></section><br><br><br><br>' +
          '<section><p><strong>The following error is what caused the application error handler to fire in the first place:</strong></p>' +
          '<pre>' + stackText(originalStack) + '</pre></section>'
}


export function extendAppConfig(config, options = {}) {
  if ( !options || options.constructor !== Object ) {
    throw new TypeError('app.start() options must be a plain object.')
  }
  if ( Object.hasOwn(options, 'citizen') ) {
    throw new TypeError('app.start() accepts application configuration only. Move citizen settings to the citizen property in citizen.config.js.')
  }

  return helpers.extend(config, options)
}


export const start = (options = {}) => {
  Object.assign(CTZN.config, extendAppConfig(CTZN.config, options))
  server.emit('applicationStart')
}


function createServer() {
  let modeMessage = ''

  switch ( CTZN.config.citizen.mode ) {
    case 'development':
      modeMessage += '\n' +
                     '\n  citizen is in development mode, which enables verbose console logs and' +
                     '\n  disables view template caching, degrading performance.' +
                     '\n' +
                     '\n  To enable production mode, set citizen.mode in citizen.config.js or set' +
                     '\n  NODE_ENV to "production".' +
                     '\n' +
                     '\n  Consult the README for details.'
      break
    case 'production':
      modeMessage += '\n' +
                     '\n  citizen is in production mode, which enables view caching and disables' +
                     '\n  automatic development console output. Configure citizen.logs in' +
                     '\n  citizen.config.js to select log categories and their destination.' +
                     '\n' +
                     '\n  To enable development mode, set citizen.mode in citizen.config.js or set' +
                     '\n  NODE_ENV to "development".' +
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
            type: 'error',
            content: '\nHTTP server startup failed because port ' + CTZN.config.citizen.http.port + ' isn\'t open. Please open this port or set citizen.http.port to an alternate port in citizen.config.js.\n',
            console: true,
            timestamp: false
          })
          break
        case 'EADDRINUSE':
          helpers.log({
            type: 'error',
            content: '\nHTTP server startup failed because port ' + CTZN.config.citizen.http.port + ' is already in use. Set citizen.http.port to an alternate port in citizen.config.js.\n',
            console: true,
            timestamp: false
          })
          break
        case 'ENOTFOUND':
          helpers.log({
            type: 'error',
            content: '\nHTTP server startup failed because the configured hostname ("' + CTZN.config.citizen.http.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
            console: true,
            timestamp: false
          })
          break
        case 'EADDRNOTAVAIL':
          helpers.log({
            type: 'error',
            content: '\nHTTP server startup failed because the configured hostname ("' + CTZN.config.citizen.http.hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
            console: true,
            timestamp: false
          })
          break
        default:
          helpers.log({
            type: 'error',
            content: '\nThere was a problem starting the server. The configured port and hostname appear to be available, so please review your settings in citizen.config.js.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code and the relevant settings to:\n\nhttps://github.com/jaysylvester/citizen/issues\n\nThe full error is below:\n\n' + err,
            console: true,
            timestamp: false
          })
          break
      }

      process.exit(1)
    })
  }

  if ( CTZN.config.citizen.https.enabled ) {
    let cert         = CTZN.config.citizen.https.cert,
        httpsOptions = helpers.copy(CTZN.config.citizen.https),
        key          = CTZN.config.citizen.https.key,
        pfx          = CTZN.config.citizen.https.pfx,
        startHttps   = true

    delete httpsOptions.cert
    delete httpsOptions.key
    delete httpsOptions.pfx

    try {
      if ( pfx ) {
        httpsOptions.pfx = fs.readFileSync(pfx)
      } else if ( key && cert ) {
        httpsOptions.key = fs.readFileSync(key)
        httpsOptions.cert = fs.readFileSync(cert)
      } else {
        throw new Error('HTTPS requires either citizen.https.pfx or both citizen.https.key and citizen.https.cert in citizen.config.js.')
      }
    } catch (err) {
      startHttps = false
      helpers.log({
        type: 'error',
        label: 'HTTPS server startup failed because there was a problem trying to read your key/cert file(s).',
        content: err,
        console: true
      })
      process.exit(1)
    }
    
    if ( startHttps ) {
      const httpsServer = https.createServer(httpsOptions, (request, response) => {
              serve(request, response, 'https')
            })

      let appUrl = 'https://' + ( CTZN.config.citizen.https.hostname.length ? CTZN.config.citizen.https.hostname : '127.0.0.1' ) + ( CTZN.config.citizen.https.port === 443 ? '' : ':' + CTZN.config.citizen.https.port )
      
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
              type: 'error',
              content: '\nHTTPS server startup failed because port ' + CTZN.config.citizen.https.port + ' isn\'t open. Please open this port or set citizen.https.port to an alternate port in citizen.config.js.\n',
              console: true,
              timestamp: false
            })
            break
          case 'EADDRINUSE':
            helpers.log({
              type: 'error',
              content: '\nHTTPS server startup failed because port ' + CTZN.config.citizen.https.port + ' is already in use. Set citizen.https.port to an alternate port in citizen.config.js.\n',
              console: true,
              timestamp: false
            })
            break
          case 'ENOTFOUND':
            helpers.log({
              type: 'error',
              content: '\nHTTPS server startup failed because the configured hostname ("' + CTZN.config.citizen.https.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
              console: true,
              timestamp: false
            })
            break
          case 'EADDRNOTAVAIL':
            helpers.log({
              type: 'error',
              content: '\nHTTPS server startup failed because the configured hostname ("' + CTZN.config.citizen.https.hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
              console: true,
              timestamp: false
            })
            break
          case 'ENOENT':
            helpers.log({
              type: 'error',
              content: '\nHTTPS server startup failed because citizen couldn\'t find the PFX or key/cert files you specified.\n',
              console: true,
              timestamp: false
            })
            break
          case 'NOPFXORKEYCERT':
            helpers.log({
              type: 'error',
              content: '\nHTTPS server startup failed because you didn\'t provide the necessary key files. You need to specify either a PFX file or key/cert pair.\n',
              console: true,
              timestamp: false
            })
            break
          default:
            helpers.log({
              type: 'error',
              content: '\nThere was a problem starting the server. The configured port and hostname appear to be available, so please review your settings in citizen.config.js.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code and the relevant settings to:\n\nhttps://github.com/jaysylvester/citizen/issues\n\nThe full error is below:\n\n' + err,
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


function installManaged(params, request, response) {
  let abort = new AbortController(),
      state = { abort, params, request, response, context: {}, completed: false, outcome: null },
      cancelled = () => {
        if ( response.writableFinished || state.completed ) {
          return
        }
        if ( !state.failure ) {
          state.cancelled = true
          abort.abort(Object.assign(new Error('Client disconnected.'), { name: 'AbortError' }))
        }
        state.stream?.dispose()
        completeManaged(response)
      },
      finished = () => {
        if ( state.owned ) {
          completeManaged(response)
        }
      },
      failed = error => server.emit('error', error, state.params, request, response, state.context)
  state.release = () => {
    request.off('aborted', cancelled)
    response.off('close', cancelled)
    response.off('finish', finished)
    response.off('error', failed)
  }
  managed.set(response, state)
  Object.defineProperty(request, 'signal', { value: abort.signal })
  Object.defineProperty(response, 'completion', { get: () => state.outcome })
  request.once('aborted', cancelled)
  response.once('close', cancelled)
  response.once('finish', finished)
  response.on('error', failed)
}


function completeManaged(response) {
  let state = managed.get(response)
  if ( state && !state.completed ) {
    server.emit('responseEnd', state.params, state.request, response, state.context)
  }
}


function continueResponse(params, request, response, context) {
  let state = managed.get(response)
  if ( response.writableEnded || response.destroyed || state?.completed || state?.cancelled || state?.failure && state.errorParams !== params ) {
    return false
  }
  if ( state ) {
    state.params = params
    state.context = context
  }
  return true
}


async function managedResponse(params, request, response, context, returned, stream, entry) {
  let state = managed.get(response)
  if ( stream ) {
    if ( !state || !entry ) {
      stream.dispose()
      throw new Error('Streams require a declared entry action.')
    }
    state.stream = stream
    if ( response.headersSent || response.writableEnded ) {
      stream.dispose()
      throw new Error('A managed action must not write or end the response itself.')
    }
    if ( Object.hasOwn(returned, 'next') || Object.hasOwn(returned, 'include') || Object.hasOwn(returned, 'cache') || Object.hasOwn(returned, 'view') && returned.view !== false || typeof context.redirect?.refresh === 'number' ) {
      throw new Error('A stream cannot be combined with rendering, cache, chain, include, or refresh directives.')
    }
    if ( stream.error ) {
      throw stream.error
    }
    if ( stream.format === 'sse' && ![200, 204].includes(response.statusCode) ) {
      throw new Error('An SSE response must have status 200 or 204.')
    }
  }
  if ( !continueResponse(params, request, response, context) ) {
    stream?.dispose()
    return
  }
  setHeaders(response, context.header)
  // The action wins even when earlier hook keys differ only by case.
  setHeaders(response, returned.header)
  setResponseContentType(response)
  setSession(params, request, response, context)
  setCookies(params, request, response, context)
  if ( context.redirect && (typeof context.redirect === 'string' || context.redirect.url) ) {
    stream?.dispose()
    redirect(params, request, response, context, true)
    return
  }
  let length = response.getHeader('Content-Length')
  if ( stream ) {
    if ( response.hasHeader('Transfer-Encoding') || response.hasHeader('Content-Encoding') && String(response.getHeader('Content-Encoding')).toLowerCase() !== 'identity' ) {
      throw new Error('Managed streams require identity encoding and Node-owned transfer framing.')
    }
    if ( stream.format === 'sse' && length !== undefined ) {
      throw new Error('SSE cannot declare Content-Length.')
    }
    if ( length !== undefined ) {
      if ( !/^\d+$/.test(String(length)) || !Number.isSafeInteger(Number(length)) ) {
        throw new Error('Raw Content-Length must be a nonnegative safe integer.')
      }
      length = Number(length)
    }
  }
  state.owned = true
  if ( [204, 205, 304].includes(response.statusCode) ) {
    stream?.dispose()
    response.removeHeader('Content-Length')
    response.removeHeader('Transfer-Encoding')
    response.end()
    return
  }
  if ( !params.config.citizen.contentTypes.includes(response.contentType) ) {
    throw Object.assign(new Error('No acceptable response format is available.'), { statusCode: 406 })
  }
  if ( stream.format === 'sse' ) {
    if ( response.contentType.toLowerCase() !== 'text/event-stream' || !/^text\/event-stream(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(String(response.getHeader('Content-Type')).trim()) ) {
      throw new Error('SSE requires text/event-stream with UTF-8 encoding.')
    }
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  }
  response.encoding = 'identity'
  if ( !response.hasHeader('Cache-Control') ) {
    response.setHeader('Cache-Control', 'no-store')
  }
  if ( !response.hasHeader('X-Accel-Buffering') ) {
    response.setHeader('X-Accel-Buffering', 'no')
    state.bufferingHint = true
  }
  if ( request.method === 'HEAD' ) {
    stream.dispose()
    response.end()
    return
  }
  response.flushHeaders()
  await writeStream(response, stream, state.abort.signal, length)
  if ( continueResponse(params, request, response, context) ) {
    response.end()
  }
}


function splitHeader(value, delimiter) {
  let parts = [], start = 0, quoted = false, escaped = false

  for ( let i = 0; i < value.length; i++ ) {
    if ( escaped ) {
      escaped = false
    } else if ( quoted && value[i] === '\\' ) {
      escaped = true
    } else if ( value[i] === '"' ) {
      quoted = !quoted
    } else if ( !quoted && value[i] === delimiter ) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  parts.push(value.slice(start))
  return parts
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
        query   : route.queryParams,
        route   : route,
        session : {},
        url     : route.urlParams
      }
  
  // Prevents further response execution when the client arbitrarily closes the connection, which
  // helps conserve resources.
  if ( !params.route.isStatic && declaration(CTZN.controllers.routes[route.controller], route.action, CTZN.config.citizen.streaming).enabled ) {
    installManaged(params, request, response)
  } else {
    Object.defineProperty(request, 'lastEventId', { value: null })
    response.on('close', function () {
      if ( !response.writableEnded ) {
        response.end()
        helpers.log({
          label: 'Connection closed',
          content: ' (Route: ' + params.route.url + ')'
        })
      }
    })
  }

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
    try {
      let module = CTZN.controllers.routes[route.controller],
          offered = module?.config?.[route.action]?.contentTypes ?? module?.config?.controller?.contentTypes ?? params.config.citizen.contentTypes,
          accept = request.headers.accept
      if ( !Array.isArray(offered) || !offered.length || offered.some(type => typeof type !== 'string' || !mediaType.test(type) || type.includes('*')) ) {
        throw new TypeError('contentTypes must be a nonempty array of bare type/subtype strings.')
      }
      if ( accept === undefined || !String(accept).trim() ) {
        response.contentType = offered[0]
      } else {
        let ranges = splitHeader(String(accept), ',').flatMap((entry, index) => {
          let [type, ...parameters] = splitHeader(entry, ';').map(part => part.trim()),
              q = 1,
              hasWeight = false

          type = type.toLowerCase()
          if ( !mediaType.test(type) || (type.includes('*') && type !== '*/*' && !new RegExp('^' + mediaToken.replace('*', '') + '/\\*$').test(type)) ) {
            return []
          }
          for ( let parameter of parameters ) {
            let equals = parameter.indexOf('=')
            if ( parameter.slice(0, equals < 0 ? undefined : equals).trim().toLowerCase() === 'q' ) {
              let value = equals < 0 ? '' : parameter.slice(equals + 1).trim()
              if ( hasWeight || !qualityWeight.test(value) ) {
                return []
              }
              hasWeight = true
              q = Number(value)
            }
          }
          return [{ type, q, index, specificity: type === '*/*' ? 0 : type.endsWith('/*') ? 1 : 2 }]
        }), best

        for ( let type of offered ) {
          let normalized = type.toLowerCase(), match
          for ( let range of ranges ) {
            if ( range.type === normalized || range.type === '*/*' || range.type === normalized.split('/')[0] + '/*' ) {
              if ( !match || range.specificity > match.specificity ) {
                match = range
              }
            }
          }
          if ( match?.q > 0 && (!best || match.q > best.q ||
               (match.q === best.q && (match.specificity > best.specificity ||
                (match.specificity === best.specificity && match.index < best.index)))) ) {
            best = { ...match, selected: type }
          }
        }
        response.contentType = best?.selected
      }
      setResponseContentType(response)
      if ( managed.has(response) ) {
        Object.defineProperty(request, 'lastEventId', { value: lastEventId(request.headers['last-event-id']) })
      }
    } catch (err) {
      server.emit('error', err, params, request, response, {})
      return
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


async function serverResponse(params, request, response, context) {
  let routeCache = managed.has(response) || !response.contentType ? false : cache.getRoute({
                     route: params.route.base + params.route.pathname,
                     contentType: response.contentType
                   })

  setSession(params, request, response, context)

  if ( routeCache ) {
    // Apply live hook headers before the cached controller headers.
    setHeaders(response, context.header)
    setCookies(params, request, response, context)
    setHeaders(response, routeCache.context.header)
    setResponseContentType(response)
    delete context.header
    delete context.headerLowercase

    response.setHeader('ETag', routeCache.lastModified)

    let redirected = setRedirect(params, request, response, context)

    if ( response.writableEnded ) {
      return
    }

    if ( !redirected && request.headers['if-none-match'] == routeCache.lastModified ) {
      response.setHeader('Date', routeCache.lastModified)
      response.statusCode = 304
      response.end()
    } else {
      response.setHeader('Content-Encoding', response.encoding)
      response.end(request.headers.method !== 'HEAD' ? routeCache.encodings[response.encoding] : null)
    }
    server.emit('responseEnd', params, request, response, context)
  } else {
    await fireController(params, request, response, context)
  }
}


function rendererType(type) {
  let normalized = typeof type === 'string' ? type.toLowerCase() : undefined
  return renderers.has(normalized) ? normalized : undefined
}


function setResponseContentType(response) {
  // Keep explicit headers for the final format; replace headers from an earlier format.
  if ( !response.headersSent && response.contentType && response.contentType !== response.headerFormat ) {
    response.setHeader('Content-Type', response.contentType)
    response.headerFormat = response.contentType
  }
}


function setHeaders(response, headers) {
  let lowercase = {}

  Object.keys(headers || {}).forEach( item => {
    response.setHeader(item, headers[item])
    lowercase[item.toLowerCase()] = headers[item]
  })

  if ( Object.hasOwn(lowercase, 'content-type') ) {
    response.headerFormat = response.contentType
  }

  return lowercase
}


function setSession(params, request, response, context) {
  if ( CTZN.config.citizen.sessions.enabled && CTZN.sessions[params.session.ctzn_session_id] && context.session && Object.keys(context.session).length ) {
    if ( context.session.expires === 'now' ) {
      session.end(params.session.ctzn_session_id)
      context.cookie = helpers.extend(context.cookie, { ctzn_session_id: { expires: 'now' }})
      params.session = {}
    } else {
      for ( let item in context.session ) {
        CTZN.sessions[params.session.ctzn_session_id].app[item] = context.session[item]
      }

      params.session = CTZN.sessions[params.session.ctzn_session_id].app
    }
  }
  
  delete context.session
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
  if ( !continueResponse(params, request, response, context) ) {
    return
  }
  if ( request.method === 'OPTIONS' ) {
    response.end()
    server.emit('responseEnd', params, request, response, context)
    return
  }
  // Preserve the existing dispatch boundary while replacing the body reader.
  if ( !['GET', 'HEAD', 'DELETE', 'PATCH', 'POST', 'PUT'].includes(request.method) ) {
    return
  }
  if ( ['DELETE', 'PATCH', 'POST', 'PUT'].includes(request.method) && params.config.citizen.forms.enabled ) {
    try {
      let limit = params.config.citizen.forms.maxPayloadSize
      if ( !Number.isSafeInteger(limit) || limit <= 0 ) {
        throw new TypeError('forms.maxPayloadSize must be a positive safe integer.')
      }
      let bytes = await new Promise((resolve, reject) => {
        let chunks = [], size = 0,
            cleanup = () => {
              request.off('data', data)
              request.off('end', end)
              request.off('error', failed)
              request.off('aborted', aborted)
            },
            failed = error => {
              cleanup()
              chunks = []
              reject(error)
            },
            overflow = () => {
              request.pause()
              failed(Object.assign(new Error('The request payload exceeds forms.maxPayloadSize.'), { statusCode: 413 }))
            },
            data = chunk => {
              size += chunk.length
              if ( size > limit ) {
                overflow()
              } else {
                chunks.push(chunk)
              }
            },
            end = () => {
              cleanup()
              resolve(Buffer.concat(chunks, size))
            },
            aborted = () => failed(Object.assign(new Error('Request upload aborted.'), { statusCode: 400, name: 'AbortError' }))
        if ( Number(request.headers['content-length']) > limit ) {
          overflow()
          return
        }
        request.on('data', data)
        request.once('end', end)
        request.once('error', failed)
        request.once('aborted', aborted)
      })
      let parts = (request.headers['content-type'] || '').split(';').map(part => part.trim()),
          type = parts.shift().toLowerCase(),
          raw = bytes.toString('latin1'),
          payload = {}, form = {}
      if ( type === 'application/json' ) {
        for ( let parameter of parts ) {
          let [name, ...value] = parameter.split('=')
          if ( name.trim().toLowerCase() === 'charset' && !/^"?utf-8"?$/i.test(value.join('=').trim()) ) {
            throw Object.assign(new Error('JSON request bodies must use UTF-8.'), { statusCode: 415 })
          }
        }
        try {
          raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
          if ( raw.length ) {
            payload = JSON.parse(raw)
          }
        } catch {
          throw Object.assign(new Error('Invalid UTF-8 JSON request body.'), { statusCode: 400 })
        }
      } else if ( raw.length && type === 'application/x-www-form-urlencoded' ) {
        payload = Object.assign({}, querystring.parse(raw))
        form = { ...payload }
      } else if ( raw.length && type === 'multipart/form-data' ) {
        let boundary = parts.find(part => /^boundary=/i.test(part)),
            fields = raw.split('--' + boundary?.slice(boundary.indexOf('=') + 1).replace(/^"|"$/g, ''))
        for ( let field = 1; field < fields.length - 1; field++ ) {
          fields[field].replace(/Content-Disposition: form-data; (.+)\r\n(Content-Type: (.+)\r\n)?\r\n([^]+)\r\n/, (match, directives, hasType, fileType, value) => {
            let options = querystring.parse(directives.replace(/; /g, '&')),
                name = options.name.replace(/"/g, '')
            if ( hasType ) {
              let filename = options.filename.replace(/"/g, '')
              form[name] ||= {}
              form[name][filename] = { filename, contentType: fileType, binary: value }
            } else {
              form[name] = value
            }
          })
        }
      }
      if ( !continueResponse(params, request, response, context) ) {
        return
      }
      request.payload = raw
      params.payload = payload
      params.form = form
      helpers.log({ label: 'Payload received and parsed (' + request.headers['content-type'] + ')', content: params.payload })
    } catch (err) {
      if ( err.statusCode === 413 && !response.headersSent && !response.destroyed ) {
        // Stop reading now; let the rejection flush, then close only this connection.
        let socket = request.socket,
            timer = setTimeout(() => socket.destroy(), 1000)
        timer.unref()
        response.shouldKeepAlive = false
        response.setHeader('Connection', 'close')
        socket.once('close', () => clearTimeout(timer))
        response.once('finish', () => socket.destroy())
      }
      server.emit('error', err, params, request, response, context)
      return
    }
  }
  server.emit('requestEnd', params, request, response, context)
}


async function fireController(params, request, response, context) {
  let controller = context.next?.controller || params.route.controller,
      action = context.next?.action || params.route.action,
      view = context.next?.view || context.view || params.route.controller,
      controllerParams = helpers.copy(params),
      streaming = validateDeclaration(CTZN.controllers.routes[controller], action, CTZN.config.citizen.streaming),
      declared = streaming.enabled,
      entry = !Object.keys(params.route.chain).length,
      stream

  if ( !continueResponse(params, request, response, context) ) {
    return
  }

  if ( context.next?.params?.route ) {
    controllerParams.route = { ...context.next.params.route, chain: controllerParams.route.chain }
    controllerParams.url   = context.next.params.url
    if ( context.next.params.query ) {
      controllerParams.query = context.next.params.query
    }
  }

  let cacheKey = controllerParams.route.pathname,
      actionCachePathParams = controllerParams.url

  // A route-less next keeps the parent's route, but caches the selected action separately.
  if ( context.next && !context.next.params?.route ) {
    cacheKey = '/' + controller + ( action !== 'handler' ? '/action/' + action : '' )
    actionCachePathParams = {}
  }
  controllerParams.route.cacheKey = cacheKey

  // Clear the previous controller's next directive
  delete context.next

  // Check the controller cache unless it's the layout controller, which can't be cached
  let cachedAction = declared || managed.has(response) || !response.contentType || controller === CTZN.config.citizen.layout.controller ? false : cache.getRoute({
                                                                                                route       : cacheKey,
                                                                                                contentType : response.contentType
                                                                                              })

  // Cached context belongs to the entry; directive handling needs a request-local copy.
  params.route.chain[controller] = cachedAction ? { ...cachedAction, context: helpers.copy(cachedAction.context) } : false

  // Fire the controller if it isn't cached
  if ( !cachedAction ) {
    helpers.log({
      label: 'Firing controller: ' + controller,
      content: {
        controller: controller,
        action: action
      }
    })

    try {
      let returned = splitReturn(await CTZN.controllers.routes[controller][action](controllerParams, request, response, context))
      if ( returned.present ) {
        stream = prepareStream(returned.value, error => {
          server.emit('error', error, params, request, response, context, false)
        }, streaming.sse)
      }
      if ( declared && Object.hasOwn(returned.context, 'cache') ) {
        stream?.dispose()
        throw new Error('Declared streaming actions cannot return cache directives.')
      }
      params.route.chain[controller] = {
        controller : controller,
        action     : action,
        context    : returned.context
      }
    } catch (err) {
      server.emit('error', err, params, request, response, context)
      return err
    }
  }

  // Expand action shorthand and retain the lookup key and path inputs for insertion.
  let controllerContext = params.route.chain[controller].context

  if ( stream || managed.has(response) && [204, 205, 304].includes(response.statusCode) ) {
    try {
      await managedResponse(params, request, response, helpers.extend(context, controllerContext), controllerContext, stream, entry && declared)
    } catch (err) {
      stream?.dispose()
      server.emit('error', err, params, request, response, context)
    }
    return
  }
  if ( !continueResponse(params, request, response, context) ) {
    return
  }

  if ( controllerContext.cache?.action ) {
    params.route.chain[controller].context = {
      ...controllerContext,
      cache: {
        ...controllerContext.cache,
        action: { ...controllerContext.cache.action, route: cacheKey, pathParams: actionCachePathParams }
      }
    }
  }

  // Extend the chain's context with the controller's returned context
  context = helpers.extend(context, params.route.chain[controller].context)
  // Preserve request cache directives from application/request/response hooks if it's the first controller in the chain
  if ( !managed.has(response) && Object.keys(params.route.chain).length === 1 && context.cache?.request ) {
    params.route.chain[controller].context.cache = params.route.chain[controller].context.cache || {}
    params.route.chain[controller].context.cache.request = context.cache.request
  }
  // Delete the cache directive for future controllers in the chain
  delete context.cache
  params.route.chain[controller].controller = controller
  params.route.chain[controller].action = action
  // Append the parameters passed to the controller to the controller object so they can be referenced later.
  params.route.chain[controller].params = controllerParams
  // Set default local context to avoid server errors during rendering and provide an empty namespaced object in JSON responses
  params.route.chain[controller].context.local = params.route.chain[controller].context.local || {}
  // Set the controller's view to that specified in the controller's context if it exists.
  params.route.chain[controller].view = params.route.chain[controller].context.view || view


  if ( continueResponse(params, request, response, context) ) {
    // Set headers based on controller action headers
    if ( context.header ) {
      context.headerLowercase = helpers.extend(context.headerLowercase, setHeaders(response, context.header))
    }

    let requestCache = params.route.chain[Object.keys(params.route.chain)[0]].context.cache?.request,
        lastModified = requestCache?.lastModified || new Date().toISOString()
    response.setHeader('Cache-Control', context.headerLowercase?.['cache-control'] ? context.headerLowercase['cache-control'] : 'max-age=0')
    response.setHeader('ETag', context.headerLowercase?.['etag'] ? context.headerLowercase['etag'] : lastModified)

    delete context.header
    delete context.headerLowercase

    setSession(params, request, response, context)
    if ( setRedirect(params, request, response, context) && response.writableEnded ) {
      return
    }
    if ( params.config.citizen.contentTypes.indexOf(response.contentType) >= 0 ) {
      if ( continueResponse(params, request, response, context) ) {
        if ( !rendererType(response.contentType) ) {
          server.emit('error', new Error('The selected content type requires a stream or an explicit buffered format.'), params, request, response, context)
          return
        }
        if ( cachedAction ) {
          // The cached output already contains this action's rendered includes.
          delete context.include
          await next(params, request, response, context)
          return
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
                  include[item].params.query = helpers.extend(params.query, include[item].params.route.queryParams)
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
              let includeStreaming = validateDeclaration(CTZN.controllers.routes[include[item].controller], include[item].action, CTZN.config.citizen.streaming),
                  includeDeclared = includeStreaming.enabled

              params.route.chain[controller].include[item] = managed.has(response) || includeDeclared ? false : cache.getRoute({
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
                  let returned = splitReturn(await CTZN.controllers.routes[include[item].controller][include[item].action](include[item].params, request, response, context))
                  if ( returned.present ) {
                    prepareStream(returned.value, error => server.emit('error', error, params, request, response, context, false), includeStreaming.sse).dispose()
                    throw new Error('Includes cannot return streams.')
                  }
                  if ( includeDeclared && Object.hasOwn(returned.context, 'cache') ) {
                    throw new Error('Declared streaming actions cannot return cache directives.')
                  }
                  include[item].context = returned.context
                  if ( !continueResponse(params, request, response, context) ) {
                    return
                  }
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

                try {
                  await renderOutput(params, request, response, context, controller, params.route.chain[controller].include[item], CTZN.config.citizen.cache.application.enabled && params.route.chain[controller].include[item].context.cache?.action)
                } catch (err) {
                  return Promise.reject(err)
                }
              }

              // Include local data participates in JSON output on both misses and hits.
              params.route.chain[controller].context.local.include       = params.route.chain[controller].context.local.include || {}
              params.route.chain[controller].context.local.include[item] = helpers.copy(params.route.chain[controller].include[item].context.local)

              // If the output isn't JSON/JSONP, overwrite the public context with the rendered includes.
              if ( !['application/json', 'application/javascript'].includes(rendererType(response.contentType)) ) {
                params.route.chain[controller].context.include[item] = params.route.chain[controller].include[item].output
              }
            })()
          })

          await Promise.all(includes).then( async () => {
            if ( !continueResponse(params, request, response, context) ) {
              return
            }
            delete context.include

            await renderOutput(params, request, response, context, controller, params.route.chain[controller], CTZN.config.citizen.cache.application.enabled && params.route.chain[controller].context.cache?.action && params.route.chain[controller].controller !== CTZN.config.citizen.layout.controller)
            await next(params, request, response, context)
          }).catch(err => {
            server.emit('error', err, params, request, response, context)
          })
        } else {
          try {
            await renderOutput(params, request, response, context, controller, params.route.chain[controller], CTZN.config.citizen.cache.application.enabled && params.route.chain[controller].context.cache?.action && params.route.chain[controller].controller !== CTZN.config.citizen.layout.controller)
            await next(params, request, response, context)
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
}


async function next(params, request, response, context) {
  if ( continueResponse(params, request, response, context) ) {
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
          context.next.params.url   = helpers.extend(params.route.urlParams, context.next.params.route.urlParams)
          context.next.params.query = helpers.extend(params.query, context.next.params.route.queryParams)
        } catch (err) {
          err.message = 'The requested next route (' + context.next + ') is invalid. When using the route syntax to specify the next controller in the chain, the route must be a valid pathname starting with a forward slash (/).'
          server.emit('error', err, params, request, response, context)
        }
      }
      
      context.next.controller = context.next.params?.route?.controller || context.next.controller
      context.next.action     = context.next.params?.route?.action || context.next.action || 'handler'
      context.next.view       = context.next.view || context.next.params?.route?.view || context.next.controller

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
        await fireController(params, request, response, context)
      } else {
        let err = new Error('The requested next controller action (controller: ' + context.next.controller + ', action: ' + context.next.action + ') doesn\'t exist.')
        server.emit('error', err, params, request, response, context)
      }
    } else {
      await respond(params, request, response, context)
    }
  }
}


function setRedirect(params, request, response, context) {
  if ( context.redirect && ( typeof context.redirect === 'string' || Object.keys(context.redirect).length ) && !params.route.direct ) {
    redirect(params, request, response, context, true)
    return true
  }

  return false
}


function redirect(params, request, response, context, setReferrer) {
  var url = typeof context.redirect === 'string' ? context.redirect : context.redirect.url,
      statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number'

  response.statusCode = statusCode

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
    
    setSession(params, request, response, context)
    setCookies(params, request, response, context)
    response.writeHead(statusCode, {
      'Location': url
    })
    response.end()
    server.emit('responseEnd', params, request, response, context)
  }
}


async function renderOutput(params, request, response, context, controller, parent, cache) {
  if ( !continueResponse(params, request, response, context) ) {
    return
  }
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
    if ( ( rendererType(response.contentType) === 'application/javascript' || rendererType(response.contentType) === 'application/json' ) && links.length > 1 ) {
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
    
    
    if ( continueResponse(params, request, response, context) ) {
      setResponseContentType(response)
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

  switch ( rendererType(response.contentType) ) {
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
  if ( managed.has(response) ) {
    return
  }
  let route, lastModified, lifespan, resetOnAccess,
      cacheContext = options.context,
      cacheUrlParams = options.context.cache?.action?.pathParams || options.params.url,
      proceed = true,
      // Don't cache the route if any URL parameter isn't on the optional allowlist
      urlParamCheck = function (urlParams) {
        if ( urlParams && Object.keys(cacheUrlParams).length ) {
          Object.keys(cacheUrlParams).forEach( function (item) {
            if ( item !== params.route.controller && urlParams.indexOf(item) < 0 ) {
              proceed = false
              let err = new Error('Cache attempt on ' + route + ' failed due to an invalid URL parameter (' + item + ').')
              server.emit('error', err, params, request, response, context, false)
            }
          })
        }
      }

  // Cache the controller
  if ( options.context.cache?.action ) {
    route         = options.context.cache.action.route || options.params.route.pathname
    lastModified  = options.context.cache.action.lastModified
    lifespan      = options.context.cache.action.lifespan
    resetOnAccess = options.context.cache.action.resetOnAccess

    urlParamCheck(options.context.cache.action.urlParams)

    // Includes are already rendered; retain their local data without their working objects.
    cacheContext = { ...options.context }
    delete cacheContext.include

    // Don't replay a Content-Type directive superseded by an include's format change.
    if ( response.headerFormat !== response.contentType && cacheContext.header ) {
      cacheContext.header = { ...cacheContext.header }
      Object.keys(cacheContext.header).forEach( name => {
        if ( name.toLowerCase() === 'content-type' ) {
          delete cacheContext.header[name]
        }
      })
    }
  // Cache the request
  } else if ( options.context.cache?.request ) {
    route         = options.params.route.base + options.params.route.pathname
    lastModified  = options.context.cache.request.lastModified
    lifespan      = options.context.cache.request.lifespan
    resetOnAccess = options.context.cache.request.resetOnAccess

    urlParamCheck(options.context.cache.request.urlParams)

    // Header directives remain on the chain links after removal from the primary context.
    // Store their final response values so later controllers and case variants win.
    let headers = {}

    Object.values(params.route.chain).forEach( link => {
      Object.keys(link.context.header || {}).forEach( name => {
        let value = response.getHeader(name)

        if ( value !== undefined ) {
          headers[name.toLowerCase()] = helpers.copy(value)
        }
      })
    })
    cacheContext = { ...options.context, header: headers }
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
        context       : cacheContext,
        lastModified  : lastModified || new Date().toISOString(),
        lifespan      : lifespan || CTZN.config.citizen.cache.application.lifespan,
        resetOnAccess : resetOnAccess ?? CTZN.config.citizen.cache.application.resetOnAccess
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

  switch ( rendererType(response.contentType) ) {
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
            let viewPath = CTZN.views[options.view]?.path || CTZN.views[options.controller][options.view].path,
                fileContents = await fsPromises.readFile(viewPath, { encoding: 'utf-8' }),
                html = getTemplate(viewPath, fileContents, rendererType(response.contentType))(viewContext)
            if ( options.context.ctzn_debugOutput ) {
              html = html.replace('</body>', () => '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
            }

            return html
          } else {
            let consolidate = await import('@ladjs/consolidate'),
                html = await consolidate[CTZN.config.citizen.templateEngine](CTZN.views[options.view]?.path || CTZN.views[options.controller][options.view].path, viewContext)
                        .then(output => {
                          if ( options.context.ctzn_debugOutput ) {
                            output = output.replace('</body>', () => '\n<div id="citizen-debug">\n' + options.context.ctzn_debugOutput + '\n</div>\n</body>')
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
    case 'application/javascript':
      json = JSON.stringify(viewContext, null, CTZN.config.citizen.mode === 'production' ? null : 2)

      if ( options.jsonNamespace ) {
        json = '{"' + options.controller + '":' + json + '}'
      }
      
      if ( rendererType(response.contentType) === 'application/javascript' ) {
        json = options.params.url.callback + '(' + json + ');'
      }
      
      return json
  }
}


function debug(params, request, response, context) {
  let inspect = ''
  
  if ( params.url.ctzn_inspect ) {
    inspect = util.inspect(debugValue(params.url.ctzn_inspect, { params, request, response, context }), { depth: params.url.ctzn_debugDepth || CTZN.config.citizen.development.debug.depth, showHidden: params.url.ctzn_debugShowHidden || CTZN.config.citizen.development.debug.showHidden })
  } else {
    let logContent = debugScopes(params, CTZN.config.citizen.development.debug.scope, context)

    inspect = util.inspect(logContent, { depth: params.url.ctzn_debugDepth || CTZN.config.citizen.development.debug.depth, showHidden: params.url.ctzn_debugShowHidden || CTZN.config.citizen.development.debug.showHidden })
  }

  inspect = '<pre>' + escapeHtml(inspect) + '</pre>'
  
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


export function extendConfig(params, controller, action) {
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
