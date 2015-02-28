// server

'use strict';

var domain = require('domain'),
    events = require('events'),
    formidable = require('formidable'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    util = require('util'),
    path = require('path'),
    helpers = require('./helpers'),
    router = require('./router'),
    session = require('./session'),
    server = new events.EventEmitter();

    helpers = helpers.public.extend(helpers.public, helpers.citizen);

module.exports = {
  start: start
};



// Server event handlers

server.on('applicationStart', function (options) {
  helpers.listen({
    applicationStart: function (emitter) {
      CTZN.on.application.start(emitter);
    }
  }, function (output) {
    if ( CTZN.appOn.application && CTZN.appOn.application.start ) {
      helpers.listen({
        applicationStart: function (emitter) {
          CTZN.appOn.application.start(output.applicationStart, emitter);
        }
      }, function (output) {
        createServer(options);
      });
    } else {
      createServer(options);
    }
  });
});



server.on('error', function (err, request, response, params, context) {
  var statusCode = context && context.error && context.error.statusCode ? context.error.statusCode : 500,
      errorView = 'error';

  context = context || {};
  context.content = context.content || {};

  switch ( CTZN.config.citizen.mode ) {
    case 'production':
      if ( context && context.error ) {
        if ( context.error.thrownBy && context.error.message ) {
          helpers.log({
            label: 'Error thrown by ' + context.error.thrownBy,
            content: context.error.message,
            file: 'citizen.txt'
          });
        } else {
          helpers.log({
            label: 'Server error',
            content: context.error,
            file: 'citizen.txt'
          });
        }
        if ( CTZN.config.citizen.log.toConsole ) {
          console.trace();
        }
      } else {
        helpers.log({
          label: 'Server error',
          content: err,
          file: 'citizen.txt'
        });
      }

      if ( !response.headersSent ) {
        response.statusCode = statusCode;

        if ( CTZN.patterns.views.error ) {
          if ( CTZN.patterns.views.error[err.code] ) {
            errorView = err.code;
          } else if ( CTZN.patterns.views.error[statusCode] ) {
            errorView = statusCode;
          }

          context.content.error = {
            raw: context.error || err,
            inspect: util.inspect(context.error || err)
          };
          response.write(renderView('error', errorView, 'html', helpers.extend(context.content, params)));
        } else {
          if ( err.stack ) {
            response.write('<pre><code>' + err.stack + '</code></pre>');
          } else {
            response.write('<pre><code>' + util.inspect(err) + '</code></pre>');
          }
        }

        response.end();
      }
      break;
    case 'development':
    case 'debug':
      if ( context && context.error ) {
        if ( context.error.thrownBy && context.error.message ) {
          helpers.log({
            label: 'Error thrown by ' + context.error.thrownBy,
            content: context.error.message,
            file: 'citizen.txt'
          });
        } else {
          helpers.log({
            label: 'Server error',
            content: err,
            file: 'citizen.txt'
          });
        }
        console.trace();
      } else {
        helpers.log({
          label: 'Server error',
          content: err,
          file: 'citizen.txt'
        });
      }

      if ( !response.headersSent ) {
        response.statusCode = statusCode;

        if ( err.stack ) {
          response.write('<pre><code>' + err.stack + '</code></pre>');
        } else {
          response.write('<pre><code>' + util.inspect(err) + '</code></pre>');
        }

        response.end();
      }
      break;
  }
});



server.on('sessionStart', function (params, context) {
  var sessionID = 0;

  if ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) {
    if ( params.cookie.ctznSessionID && CTZN.sessions[params.cookie.ctznSessionID] && CTZN.sessions[params.cookie.ctznSessionID].expires > Date.now() ) {
      session.reset(params.cookie.ctznSessionID);
      params.session = helpers.copy(CTZN.sessions[params.cookie.ctznSessionID]);
      server.emit('requestStart', params, context);
    } else {
      sessionID = session.create();
      if ( !context.cookie ) {
        context.cookie = {};
      }
      context.cookie.ctznSessionID = {
        value: sessionID
      };
      params.cookie.ctznSessionID = sessionID;
      params.session = helpers.copy(CTZN.sessions[sessionID]);
      helpers.listen({
        sessionStart: function (emitter) {
          CTZN.on.session.start(params, context, emitter);
        }
      }, function (output) {
        var sessionStart = helpers.extend(context, output.sessionStart);
        if ( CTZN.appOn.session && CTZN.appOn.session.start ) {
          helpers.listen({
            sessionStart: function (emitter) {
              CTZN.appOn.session.start(params, sessionStart, emitter);
            }
          }, function (output) {
            sessionStart = helpers.extend(sessionStart, output.sessionStart);
            server.emit('requestStart', params, sessionStart);
          });
        } else {
          server.emit('requestStart', params, sessionStart);
        }
      });
    }
  } else {
    server.emit('requestStart', params, context);
  }
});



server.on('requestStart', function (params, context) {
  helpers.listen({
    requestStart: function (emitter) {
      CTZN.on.request.start(params, context, emitter);
    }
  }, function (output) {
    var requestStart = helpers.extend(context, output.requestStart);
    setSession(params, requestStart);
    if ( CTZN.appOn.request && CTZN.appOn.request.start ) {
      helpers.listen({
        requestStart: function (emitter) {
          CTZN.appOn.request.start(params, requestStart, emitter);
        }
      }, function (output) {
        requestStart = helpers.extend(requestStart, output.requestStart);
        setSession(params, requestStart);
        processRequest(params, requestStart);
      });
    } else {
      processRequest(params, requestStart);
    }
  });
});



server.on('responseEnd', function (params, context) {
  helpers.listen({
    responseEnd: function (emitter) {
      CTZN.on.response.end(params, context, emitter);
    }
  }, function (output) {
    var responseEnd = helpers.extend(context, output.responseEnd);
    if ( CTZN.appOn.response && CTZN.appOn.response.end ) {
      helpers.listen({
        responseEnd: function (emitter) {
          CTZN.appOn.response.end(params, responseEnd, emitter);
        }
      }, function (output) {
        responseEnd = helpers.extend(responseEnd, output.responseEnd);
        if ( CTZN.config.citizen.mode === 'debug' ) {
          debugger;
        }
      });
    }
    if ( CTZN.config.citizen.mode === 'debug' ) {
      debugger;
    }
  });
});



server.on('sessionEnd', function (params, context) {
  helpers.listen({
    sessionEnd: function (emitter) {
      CTZN.on.session.end(params, context, emitter);
    }
  }, function (output) {
    var sessionEnd = helpers.extend(context, output.sessionEnd);
    if ( CTZN.appOn.session && CTZN.appOn.session.end ) {
      helpers.listen({
        sessionEnd: function (emitter) {
          CTZN.appOn.session.end(params, sessionEnd, emitter);
        }
      }, function (output) {
        sessionEnd = helpers.extend(sessionEnd, output.sessionEnd);
      });
    }
  });
});



// Server functions

function start(options) {
  server.emit('applicationStart', options);
}



function createServer(options) {
  var serverDomain = domain.create();

  options = options || {};

  serverDomain.add(options);

  serverDomain.on('error', function (err) {
    var protocol,
        hostname,
        port,
        appUrl;

    if ( options.pfx || ( options.key && options.cert ) ) {
      protocol = 'HTTPS';
      hostname = options.hostname || CTZN.config.citizen.https.hostname;
      port = options.port || CTZN.config.citizen.https.port;
      appUrl = port === 443 ? 'http://' + hostname + CTZN.config.citizen.urlPaths.app : 'http://' + hostname + ':' + port + CTZN.config.citizen.urlPaths.app;
    } else {
      protocol = 'HTTP';
      hostname = options.hostname || CTZN.config.citizen.http.hostname;
      port = options.port || CTZN.config.citizen.http.port;
      appUrl = port === 80 ? 'http://' + hostname + CTZN.config.citizen.urlPaths.app : 'http://' + hostname + ':' + port + CTZN.config.citizen.urlPaths.app;
    }

    switch ( err.code ) {
      case 'EACCES':
        helpers.log({
          content: '\n' + protocol + ' server startup failed because port ' + port + ' isn\'t open. Please open this port or set an alternate port for HTTP traffic in your config file using the "' + protocol.toLowerCase() + '.port" setting.\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      case 'EADDRINUSE':
        helpers.log({
          content: '\n' + protocol + ' server startup failed because port ' + port + ' is already in use. Please set an alternate port for HTTP traffic in your config file using the "' + protocol.toLowerCase() + '.port" setting.\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      case 'ENOTFOUND':
        helpers.log({
          content: '\n' + protocol + ' server startup failed because the hostname you specified in your config file ("' + hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      case 'EADDRNOTAVAIL':
        helpers.log({
          content: '\n' + protocol + ' server startup failed because the hostname you specified in your config file ("' + hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      default:
        helpers.log({
          content: '\nThere was a problem starting the server. The port and hostname you specified in your config file appear to be available, so please review your other settings and make sure everything is correct.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code along with the contents of your config file to:\n\nhttps://github.com/jaysylvester/citizen/issues',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
    }

    helpers.log({
      label: 'Server error',
      content: err
    });
  });

  serverDomain.run( function () {
    var protocol,
        hostname,
        port;

    if ( options.pfx || ( options.key && options.cert ) ) {
      protocol = 'https';
      hostname = options.hostname || CTZN.config.citizen.https.hostname;
      port = options.port || CTZN.config.citizen.https.port;

      https.createServer(options, function (request, response) {
        serve(request, response, protocol);
      }).listen(port, hostname, CTZN.config.citizen.connectionQueue, function () {
        var httpsHostname = hostname.length ? hostname : '127.0.0.1',
            appUrl = port === 443 ? 'https://' + httpsHostname + CTZN.config.citizen.urlPaths.app : 'https://' + httpsHostname + ':' + port + CTZN.config.citizen.urlPaths.app,
            startupMessage = '\nYour secure app is running in ' + CTZN.config.citizen.mode + ' mode and ready to accept requests on port ' + port + '. You can access it locally at:\n\n  ' + appUrl;

        if ( !hostname.length ) {
          startupMessage += '\n\nYou\'ve specified an empty hostname, so the server will respond to requests at any host.';
        }

        if ( CTZN.config.citizen.mode === 'debug' && CTZN.config.citizen.debug.disableCache ) {
          startupMessage += '\n\nBy default, caching is disabled in debug mode, so you won\'t see any logs related to caching. To enable caching in debug mode, set "disableCache" to false under the "debug" node in your config file.';
        }

        helpers.log({
          content: startupMessage,
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
      });
    } else {
      protocol = 'http';
      hostname = options.hostname || CTZN.config.citizen.http.hostname;
      port = options.port || CTZN.config.citizen.http.port;

      http.createServer( function (request, response) {
        serve(request, response, protocol);
      }).listen(port, hostname, CTZN.config.citizen.connectionQueue, function () {
        var httpHostname = hostname.length ? hostname : '127.0.0.1',
            appUrl = port === 80 ? 'http://' + httpHostname + CTZN.config.citizen.urlPaths.app : 'http://' + httpHostname + ':' + port + CTZN.config.citizen.urlPaths.app,
            startupMessage = '\nYour app is running in ' + CTZN.config.citizen.mode + ' mode and ready to accept requests on port ' + port + '. You can access it locally at:\n\n  ' + appUrl;

        if ( !hostname.length ) {
          startupMessage += '\n\nYou\'ve specified an empty hostname, so the server will respond to requests at any host.';
        }

        if ( CTZN.config.citizen.mode === 'debug' && CTZN.config.citizen.debug.disableCache ) {
          startupMessage += '\n\nBy default, caching is disabled in debug mode, so you won\'t see any logs related to caching. To enable caching in debug mode, set "disableCache" to false under the "debug" node in your config file.';
        }

        helpers.log({
          content: startupMessage,
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
      });
    }
  });
}



function serve(request, response, protocol) {
  var context = {},
      params = {
        request: request,
        response: response,
        route: router.getRoute(protocol + '://' + request.headers.host + request.url),
        url: {},
        form: {},
        payload: {},
        cookie: parseCookie(request.headers.cookie),
        session: {},
        config: CTZN.config
      },
      requestDomain = domain.create();

  requestDomain.add(params);
  requestDomain.add(request);
  requestDomain.add(response);
  requestDomain.add(context);

  requestDomain.on('error', function (err) {
    if ( !context.error || ( context.error && !context.error.staticAsset ) ) {
      helpers.listen({
        applicationError: function (emitter) {
          CTZN.on.application.error(err, params, context, emitter);
        }
      }, function (output) {
        var applicationError = helpers.extend(context, output.applicationError);
        if ( CTZN.appOn.application && CTZN.appOn.application.error ) {
          helpers.listen({
            applicationError: function (emitter) {
              CTZN.appOn.application.error(err, params, applicationError, emitter);
            }
          }, function (output) {
            applicationError = helpers.extend(applicationError, output.applicationError);
            server.emit('error', err, request, response, params, applicationError);
          });
        } else {
          server.emit('error', err, request, response, params, applicationError);
        }
      });
    } else {
      response.statusCode = context.error.statusCode || 500;
      response.end();
      helpers.log({
        label: context.error.statusCode + ' ' + http.STATUS_CODES[context.error.statusCode],
        content: context.error.file || context.error.message || err,
        file: 'citizen.txt'
      });
    }
  });

  requestDomain.run( function () {
    response.setHeader('X-Powered-By', 'citizen');

    // If it's a dynamic page request, emit the sessionStart or requestStart event.
    // Otherwise, serve the static asset.
    if ( !params.route.isStatic ) {
      if ( CTZN.patterns.controllers[params.route.controller] && CTZN.patterns.controllers[params.route.controller][params.route.action] ) {
        params.url = router.getUrlParams(request.url);

        // Overwrite the default route parameters with URL parameters if they exist
        params.route.action = params.url.action || params.route.action;
        params.route.type = params.url.type || params.route.type;
        params.route.format = params.url.format || params.route.format;
        params.route.format = params.route.format.toLowerCase();
        params.route.show = params.url.show || params.route.show;

        if ( CTZN.config.citizen.sessions ) {
          server.emit('sessionStart', params, context);
        } else {
          server.emit('requestStart', params, context);
        }
      } else {
        context.error = {
          thrownBy: 'server.serve()',
          statusCode: 404,
          message: 'The requested controller (' + params.route.controller + ') doesn\'t exist.'
        };
        throw new Error(404);
      }
    } else {
      fs.readFile(CTZN.config.citizen.directories.web + params.route.filePath, function (err, data) {
        if ( !err ) {
          response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension]);
          response.write(data);
          response.end();
          helpers.log({
            label: '200 ' + http.STATUS_CODES[200],
            content: params.route.filePath,
            file: 'citizen.txt'
          });
        } else {
          context.error = {
            thrownBy: 'server.serve()',
            statusCode: 404,
            staticAsset: true,
            file: params.route.filePath
          };
          throw new Error(404);
        }
      });
    }
  });
}



function setSession(params, context, system) {
  if ( CTZN.config.citizen.sessions && context.session && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && helpers.size(context.session) ) {
    if ( context.session.expires && context.session.expires === 'now' ) {
      session.end(params.session.id);
      context.cookie = helpers.extend(context.cookie, { ctznSessionID: { expires: 'now' }});
      server.emit('sessionEnd', params, context);
      params.session = {};
    } else {
      for ( var property in context.session ) {
        if ( context.session.hasOwnProperty(property) && ( CTZN.reserved.session.indexOf(property) < 0 || system ) ) {
          CTZN.sessions[params.session.id] = helpers.extend(CTZN.sessions[params.session.id], context.session);
          params.session = helpers.copy(CTZN.sessions[params.session.id]);
        } else {
          throw new Error('"' + property + '" is a reserved session variable name used internally by citizen. Please choose a different variable name.');
        }
      }
    }
  }
}



function setCookie(params, context) {
  var cookie = buildCookie(context.cookie, params);

  if ( cookie.length ) {
    params.response.setHeader('Set-Cookie', cookie);
  }
}



function processRequest(params, context) {
  var controller = CTZN.patterns.controllers[params.route.controller],
      corsOriginTest,
      body = '',
      form,
      respond = true;

  // If a previous event in the request context requested a redirect, do it immediately rather than firing the controller.
  if ( context.redirect && helpers.size(context.redirect) ) {
    redirect(params, context);
  } else {
    // If the Origin header exists and it's not the host, check if it's allowed. If so,
    // set the response header to match the request header (per W3C recs). If not, end the response.
    if ( params.request.headers.origin ) {
      corsOriginTest = new RegExp('^(http|https)://' + params.request.headers.host + '$');
      if ( !corsOriginTest.test(params.request.headers.origin) ) {
        if ( controller.access && controller.access['access-control-allow-origin'] ) {
          if ( controller.access['access-control-allow-origin'].search(params.request.headers.origin) >= 0 || controller.access['access-control-allow-origin'] === '*' ) {
            if ( params.request.method === 'OPTIONS' && !params.request.headers['access-control-request-method'] ) {
              respond = false;
              params.response.end(server.emit('responseEnd', params, context));
            } else {
              for ( var property in controller.access ) {
                if ( controller.access.hasOwnProperty(property) ) {
                  params.response.setHeader(property, controller.access[property]);
                }
              }
              params.response.setHeader('access-control-allow-origin', params.request.headers.origin);
            }
          } else {
            respond = false;
            params.response.end(server.emit('responseEnd', params, context));
          }
        } else {
          respond = false;
          params.response.end(server.emit('responseEnd', params, context));
        }
      }
    }

    if ( respond ) {
      switch ( params.request.method ) {
        case 'GET':
          helpers.listen({
            requestEnd: function (emitter) {
              CTZN.on.request.end(params, context, emitter);
            }
          }, function (output) {
            var requestEnd = helpers.extend(context, output.requestEnd);
            setSession(params, requestEnd);
            if ( CTZN.appOn.request && CTZN.appOn.request.end ) {
              helpers.listen({
                requestEnd: function (emitter) {
                  CTZN.appOn.request.end(params, requestEnd, emitter);
                }
              }, function (output) {
                requestEnd = helpers.extend(requestEnd, output.requestEnd);
                setSession(params, requestEnd);
                server.emit('responseStart', params, requestEnd);
              });
            } else {
              server.emit('responseStart', params, requestEnd);
            }
          });
          break;
        case 'POST':
          form = new formidable.IncomingForm();

          form = helpers.extend(form, CTZN.config.citizen.forms);

          form.parse(params.request, function (err, fields, files) {
            if ( !err ) {
              params.form = helpers.extend(fields, files);
              helpers.log({
                label: 'Form input received',
                content: {
                  fields: fields,
                  files: files
                }
              });
              server.emit('responseStart', params, context);
            } else {
              helpers.log({
                label: 'Error processing form',
                content: err
              });
              throw new Error('form error');
            }
          });
          break;
        case 'PUT':
          params.request.on('data', function (chunk) {
            body += chunk.toString();
          });
          params.request.on('end', function () {
            params.payload = JSON.parse(body);
            server.emit('responseStart', params, context);
          });
          break;
        case 'DELETE':
          server.emit('responseStart', params, context);
          break;
        // Just send the response headers for HEAD and OPTIONS
        case 'HEAD':
        case 'OPTIONS':
          params.response.end();
          break;
      }
    }
  }
}



server.on('responseStart', function (params, context) {

  // Log the request parameters for debugging
  helpers.log({
    label: 'Request parameters',
    content: {
      route: params.route,
      url: params.url,
      form: params.form,
      payload: params.payload,
      cookie: params.cookie,
      session: params.session
    }
  });

  helpers.listen({
    responseStart: function (emitter) {
      CTZN.on.response.start(params, context, emitter);
    }
  }, function (output) {
    var responseStart = helpers.extend(context, output.responseStart),
        routeCache = helpers.retrieve({ scope: 'routes', key: params.route.pathname });

    if ( CTZN.appOn.response && CTZN.appOn.response.start ) {
      helpers.listen({
        responseStart: function (emitter) {
          CTZN.appOn.response.start(params, responseStart, emitter);
        }
      }, function (output) {
        responseStart = helpers.extend(responseStart, output.responseStart);

        setSession(params, responseStart);
        if ( routeCache ) {
          setCookie(params, responseStart);
          params.response.setHeader('Content-Type', routeCache.contentType);
          params.response.write(routeCache.view);
          params.response.end();
          server.emit('responseEnd', params, context);
        } else {
          fireController(params, responseStart);
        }
      });
    } else {
      setSession(params, responseStart);
      if ( routeCache ) {
        setCookie(params, responseStart);
        params.response.setHeader('Content-Type', routeCache.contentType);
        params.response.write(routeCache.view);
        params.response.end();
        server.emit('responseEnd', params, context);
      } else {
        fireController(params, responseStart);
      }
    }
  });
});



function fireController(params, context) {
  var responseDomain = domain.create();

  responseDomain.on('error', function (err) {
    server.emit('error', err, params.request, params.response, params, context);
  });

  responseDomain.add(params);
  responseDomain.add(context);

  responseDomain.run( function () {
    var controller = context.handoffController || params.route.controller,
        action = context.handoffAction || params.route.action,
        view = context.handoffView || context.view || params.route.view;

    helpers.log({
      label: 'Firing controller',
      content: {
        controller: controller,
        action: action,
        view: view
      }
    });

    helpers.listen({
      pattern: function (emitter) {
        var cachedController = helpers.retrieveController({ controller: controller, action: action, view: view, route: params.route.pathname }) || helpers.retrieveController({ controller: controller, action: action, view: view, route: 'global' });

        if ( cachedController ) {
          emitter.emit('ready', cachedController.context);
        } else {
          CTZN.patterns.controllers[controller][action](params, context, emitter);
        }
      }
    }, function (output) {
      var requestContext = helpers.extend(context, output.pattern),
          include = requestContext.include || {},
          includeProperties,
          includeGroup = {};

      params.route.view = requestContext.view || params.route.view;
      params.route.renderedView = requestContext.view || params.route.renderedView;
      if ( requestContext.view ) {
        params.route.chain[params.route.chain.length-1].view = params.route.view;
        params.route.chain[params.route.chain.length-1].action = requestContext.handoffAction || params.route.action;
      }
      requestContext.content = requestContext.content || {};
      delete requestContext.handoffController;
      delete requestContext.handoffView;
      delete requestContext.handOffAction;

      if ( output.listen.success ) {

        for ( var property in requestContext.content ) {
          if ( requestContext.content.hasOwnProperty(property) && CTZN.reserved.content.indexOf(property) >= 0 ) {
            throw new Error('"' + property + '" is a reserved content variable name used internally by citizen. Please choose a different variable name.');
          }
        }

        setSession(params, requestContext);

        if ( requestContext.redirect && helpers.size(requestContext.redirect) && typeof requestContext.redirect.refresh === 'undefined' ) {
          setCookie(params, requestContext);
          redirect(params, requestContext);

          cacheController({
            controller: controller,
            action: action,
            view: params.route.renderedView,
            route: params.route.pathname,
            context: requestContext,
            format: params.route.format,
            params: params
          });
        } else {
          if ( requestContext.redirect && helpers.size(requestContext.redirect) ) {
            redirect(params, requestContext);
          }
          includeProperties = Object.getOwnPropertyNames(include);
          if ( includeProperties.length && params.route.format === 'html' ) {
            includeProperties.forEach( function (item, index, array) {
              var includeView = include[item].view || include[item].controller,
                  includeAction = include[item].action || 'handler',
                  cachedIncludeController = helpers.retrieveController({ controller: include[item].controller, action: includeAction, view: includeView, route: params.route.pathname }) || helpers.retrieveController({ controller: include[item].controller, action: includeAction, view: includeView, route: 'global' });

              includeGroup[item] = function (emitter) {
                if ( cachedIncludeController ) {
                  emitter.emit('ready', cachedIncludeController.context);
                } else {
                  CTZN.patterns.controllers[include[item].controller][includeAction](params, requestContext, emitter);
                }
              };
            });

            if ( helpers.size(includeGroup) ) {
              requestContext.content.include = requestContext.content.include || {};

              helpers.listen(includeGroup, function (output) {
                includeProperties.forEach( function (item, index, array) {
                  var includeView = output[item].view || include[item].view || include[item].controller,
                      includeAction = include[item].action || 'handler',
                      includeContext,
                      includeViewContext,
                      includeRender,
                      cachedIncludeController = helpers.retrieveController({ controller: include[item].controller, action: includeAction, view: includeView, route: params.route.pathname }) || helpers.retrieveController({ controller: include[item].controller, action: includeAction, view: includeView, route: 'global' });

                  if ( cachedIncludeController ) {
                    requestContext.content.include[item] = cachedIncludeController.render;
                    helpers.log({
                      label: 'Using cached include ' + item,
                      content: {
                        controller: include[item].controller,
                        action: includeAction,
                        view: includeView
                      },
                      file: 'citizen.txt'
                    });
                  } else {
                    includeContext = output[item];
                    includeViewContext = helpers.extend(includeContext.content, params);
                    includeRender = renderView(include[item].controller, includeView, params.route.format, includeViewContext);
                    requestContext.content.include[item] = includeRender;
                    helpers.log({
                      label: 'Rendering include ' + item,
                      content: {
                        controller: include[item].controller,
                        action: includeAction,
                        view: includeView
                      },
                      file: 'citizen.txt'
                    });

                    cacheController({
                      controller: include[item].controller,
                      action: includeAction,
                      view: includeView,
                      route: params.route.pathname,
                      context: includeContext,
                      render: includeRender,
                      format: params.route.format,
                      params: params
                    });
                  }
                });

                delete requestContext.include;

                if ( requestContext.handoff && params.url.type !== 'direct' ) {
                  handoff(params, requestContext);
                } else {
                  setCookie(params, requestContext);
                  respond(params, requestContext);
                }
              });
            } else {
              if ( requestContext.handoff && params.url.type !== 'direct' ) {
                handoff(params, requestContext);
              } else {
                setCookie(params, requestContext);
                respond(params, requestContext);
              }
            }

            delete requestContext.include;

          } else {
            if ( requestContext.handoff && params.url.type !== 'direct' ) {
              handoff(params, requestContext);
            } else {
              setCookie(params, requestContext);
              respond(params, requestContext);
            }
          }
        }
      } else {
        throw new Error('server.fireController(): The ' + params.route.renderer + ' controller failed to emit a valid response.');
      }
    });
  });
}



function redirect(params, context) {
  var statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number';

  helpers.log({
    label: 'Redirecting',
    content: {
      url: context.redirect.url,
      statusCode: statusCode,
      header: refresh ? 'Refresh' : 'Location'
    }
  });

  if ( refresh ) {
    params.response.statusCode = statusCode;
    params.response.setHeader('Refresh', context.redirect.refresh + ';url=' + context.redirect.url);
  } else {
    if ( CTZN.config.citizen.sessions ) {
      if ( context.session ) {
        context.session.ctznReferer = params.route.url;
      } else {
        context.session = {
          ctznReferer: params.route.url
        };
      }
      setSession(params, context, true);
    } else {
      if ( context.cookie ) {
        context.cookie.ctznReferer = params.route.url;
      } else {
        context.cookie = {
          ctznReferer: params.route.url
        };
      }
      setCookie(params, context);
    }
    params.response.writeHead(statusCode, {
      'Location': context.redirect.url
    });
    params.response.end();
  }
}



function cacheController(options) {
  var cacheExists,
      cacheContext = {},
      cacheLifespan,
      cacheReset,
      viewContext;

  if ( options.context.cache && options.context.cache.controller ) {
    switch ( options.context.cache.scope ) {
      case 'route':
        cacheExists = helpers.exists({
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route
        });
        break;
      case 'global':
      case undefined:
        cacheExists = helpers.exists({
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: 'global'
        });
        break;
    }

    if ( !cacheExists ) {
      cacheLifespan = options.context.cache.lifespan || 'application';
      cacheReset = options.context.cache.resetOnAccess || false;

      if ( helpers.size(options.params.url) && options.context.cache.urlParams ) {
        Object.getOwnPropertyNames(options.params.url).forEach( function ( item, index, array) {
          if ( options.context.cache.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            switch ( CTZN.config.citizen.cache.invalidUrlParams ) {
              case 'throw':
                throw new Error('Cache attempt on ' + options.controller + ' controller failed due to an invalid URL parameter (' + item + '). Request denied.');
              default:
                helpers.log({
                  label: 'WARNING - Controller cache attempt failed due to an invalid URL parameter (' + item + ')',
                  content: {
                    controller: options.controller,
                    action: options.action,
                    view: options.view,
                    route: options.route
                  },
                  file: 'citizen.txt'
                });
                break;
            }
          }
        });
      }

      // Cache only those directives specified by the cache.directives array
      if ( options.context.cache.directives ) {
        options.context.cache.directives.forEach( function (item, index, array) {
          // Skip the include directive because include views are cached with the controller view
          if ( options.context[item] && options.context[item] !== 'include' ) {
            cacheContext[item] = options.context[item];
          }
        });
      }

      if ( options.context.content ) {
        cacheContext.content = options.context.content;
      }

      switch ( options.format ) {
        case 'json':
          viewContext = cacheContext.content;
          break;
        default:
          viewContext = helpers.extend(cacheContext.content, options.params);
      }

      switch ( options.context.cache.scope ) {
        case 'route':
          helpers.cacheController({
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: options.route,
            context: cacheContext,
            render: options.render || renderView(options.controller, options.view, options.format, viewContext),
            lifespan: cacheLifespan,
            resetOnAccess: cacheReset
          });
          break;
        case 'global':
        case undefined:
          helpers.cacheController({
            controller: options.controller,
            action: options.action,
            view: options.view,
            route: 'global',
            context: cacheContext,
            render: options.render || renderView(options.controller, options.view, options.format, viewContext),
            lifespan: cacheLifespan,
            resetOnAccess: cacheReset
          });
          break;
      }
    }
  }
}



function handoff(params, requestContext) {
  var thisHandoff = helpers.copy(requestContext.handoff),
      lastLink = params.route.chain[params.route.chain.length-1],
      handoffParams = {},
      renderer = thisHandoff.controller || params.route.renderer,
      renderedView = thisHandoff.view || thisHandoff.controller,
      action = thisHandoff.action || 'handler',
      cachedController,
      viewContext;

  if ( !CTZN.patterns.controllers[thisHandoff.controller] ) {
    throw new Error('server.handoff(): The ' + thisHandoff.controller + ' controller doesn\'t exist.');
  }

  if ( CTZN.patterns.views[lastLink.controller][lastLink.view] ) {
    cachedController = helpers.retrieveController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: params.route.pathname }) || helpers.retrieveController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: 'global' });

    if ( cachedController ) {
      lastLink.viewContent = cachedController.render;
      helpers.log({
        label: 'Using cached controller view',
        content: lastLink.controller,
        file: 'citizen.txt'
      });
    } else {
      switch ( params.route.format ) {
        case 'html':
          viewContext = helpers.extend(requestContext.content, params);
          break;
        // If the output is JSON, pass the raw content to the view renderer
        case 'json':
        case 'jsonp':
          if ( !params.url.output ) {
            viewContext = requestContext.content;
          } else {
            viewContext = createJSON(params, requestContext);
          }
          break;
      }

      lastLink.viewContent = renderView(lastLink.controller, lastLink.view, params.route.format, viewContext, params.url.callback);

      helpers.log({
        label: 'Rendering controller prior to ' + thisHandoff.controller + ' handoff',
        content: {
          controller: lastLink.controller,
          action: lastLink.action,
          view: lastLink.view
        },
        file: 'citizen.txt'
      });

      cacheController({
        controller: lastLink.controller,
        action: lastLink.action,
        view: lastLink.view,
        route: params.route.pathname,
        context: helpers.copy(requestContext),
        render: lastLink.viewContent,
        format: params.route.format,
        params: params
      });
    }
  }

  handoffParams = helpers.extend(params, { route: { chain: params.route.chain.concat([{ controller: thisHandoff.controller, action: action, view: renderedView }]), renderer: renderer, renderedView: renderedView }});
  delete requestContext.handoff;
  delete requestContext.view;
  requestContext.session = {};
  if ( requestContext.cache ) {
    if ( requestContext.cache.route ) {
      requestContext.cache = {
        route: true
      };
    } else {
      requestContext.cache = {};
    }
  }
  requestContext.handoffController = thisHandoff.controller;
  requestContext.handoffView = thisHandoff.view || thisHandoff.controller;
  requestContext.handoffAction = action;
  helpers.log({
    content: 'Handing off to the ' + thisHandoff.controller + ' controller',
    file: 'citizen.txt'
  });
  fireController(handoffParams, requestContext);
}



function respond(params, requestContext) {
  var contentType,
      viewContext,
      view;

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html';
      viewContext = helpers.extend(requestContext.content, params);
      if ( CTZN.config.citizen.mode === 'debug' || ( CTZN.config.citizen.mode === 'development' && params.url.ctzn_debug ) ) {
        viewContext.debugOutput = debug(requestContext, params);
      }
      break;
    // If the output is JSON, pass the raw content to the view renderer
    case 'json':
    case 'jsonp':
      contentType = params.route.format === 'json' ? 'application/json' : 'text/javascript';

      if ( !params.url.output ) {
        viewContext = requestContext.content;
      } else {
        viewContext = createJSON(params, requestContext);
      }
      break;
  }

  view = renderView(params.route.renderer, params.route.renderedView, params.route.format, viewContext, params.url.callback);

  params.response.setHeader('Content-Type', contentType);
  params.response.write(view);
  params.response.end();
  server.emit('responseEnd', params, requestContext);

  if ( requestContext.cache ) {
    if ( requestContext.cache.route ) {
      if ( helpers.size(params.url) && requestContext.cache.urlParams ) {
        Object.getOwnPropertyNames(params.url).forEach( function ( item, index, array) {
          if ( requestContext.cache.urlParams.indexOf(item) < 0 ) {
            throw new Error('server.respond(): Invalid cache URL. The URL parameter [' + item + '] isn\'t permitted in a cached URL.');
          }
        });
      }

      helpers.cacheRoute({
        route: params.route.pathname,
        contentType: contentType,
        view: view,
        lifespan: requestContext.cache.lifespan,
        resetOnAccess: requestContext.cache.resetOnAccess
      });
    }

    if ( requestContext.cache.controller ) {
      cacheController({
        controller: params.route.chain[params.route.chain.length-1].controller,
        action: params.route.chain[params.route.chain.length-1].action,
        view: params.route.chain[params.route.chain.length-1].view,
        route: params.route.pathname,
        context: requestContext,
        render: view,
        format: params.route.format,
        params: params
      });
    }
  }
}



function createJSON(params, context) {
  var jsonOutput,
      jsonContext = {};

  if ( context.content[params.url.output] ) {
    jsonOutput = [
      params.url.output,
      context.content[params.url.output]
    ];
    jsonContext[jsonOutput[0]] = jsonOutput[1];
    return jsonContext;
  } else {
    server.emit('error', new Error('The requested JSON notation (' + params.url.output + ') doesn\'t exist'), params.request, params.response, params, {
      error: {
        thrownBy: 'server.respond()',
        statusCode: 404,
        message: 'The requested JSON notation (' + params.url.output + ') doesn\'t exist'
      }
    });
    throw '';
  }
}



function renderView(pattern, view, format, context, callback) {
  var viewOutput = '',
      callbackRegex;

  if ( CTZN.patterns.views[pattern][view] ) {
    switch ( format ) {
      case 'html':
        switch ( CTZN.patterns.views[pattern][view].engine ) {
          case 'handlebars':
            switch ( CTZN.config.citizen.mode ) {
              default:
                viewOutput = CTZN.patterns.views[pattern][view].compiled(context);
                break;
              case 'development':
              case 'debug':
                viewOutput = fs.readFileSync(path.join(CTZN.config.citizen.directories.views, '/', pattern, '/', view + '.hbs'), { 'encoding': 'utf8' });
                viewOutput = CTZN.handlebars.compile(viewOutput);
                viewOutput = viewOutput(context);
                break;
            }
            break;
          case 'jade':
            switch ( CTZN.config.citizen.mode ) {
              default:
                viewOutput = CTZN.patterns.views[pattern][view].compiled(context);
                break;
              case 'development':
                viewOutput = fs.readFileSync(path.join(CTZN.config.citizen.directories.views, '/', pattern, '/', view + '.jade'), { 'encoding': 'utf8' });
                viewOutput = CTZN.jade.compile(viewOutput, {
                  filename: CTZN.patterns.views[pattern][view].path,
                  pretty: true
                });
                viewOutput = viewOutput(context);
                break;
              case 'debug':
                viewOutput = fs.readFileSync(path.join(CTZN.config.citizen.directories.views, '/', pattern, '/', view + '.jade'), { 'encoding': 'utf8' });
                viewOutput = CTZN.jade.compile(viewOutput, {
                  filename: CTZN.patterns.views[pattern][view].path,
                  pretty: true,
                  debug: CTZN.config.citizen.debug.jade
                });
                viewOutput = viewOutput(context);
                break;
            }
            break;
          case 'html':
            switch ( CTZN.config.citizen.mode ) {
              default:
                viewOutput = CTZN.patterns.views[pattern][view].raw;
                break;
              case 'development':
              case 'debug':
                viewOutput = fs.readFileSync(path.join(CTZN.config.citizen.directories.views, '/', pattern, '/', view + '.html'), { 'encoding': 'utf8' });
                break;
            }
            break;
        }

        if ( context.debugOutput ) {
          viewOutput = viewOutput.replace('</body>', '\n<div id="citizen-debug">\n' + context.debugOutput + '\n</div>\n</body>');
        }
        break;
      case 'json':
        viewOutput = JSON.stringify(context);
        break;
      case 'jsonp':
        callbackRegex = new RegExp(/^[A-Za-z0-9_]*$/);
        if ( callbackRegex.test(callback) ) {
          viewOutput = callback + '(' + JSON.stringify(context) + ');';
        } else {
          throw new Error('server.renderView(): JSONP callback names should consist of letters, numbers, and underscores only.');
        }
        break;
    }

    return viewOutput;
  } else {
    throw new Error('server.renderView(): The [' + pattern + ']' + '[' + view + '] view doesn\'t exist.');
  }
}



function debug(pattern, params) {
  var toDebug = params.url.ctzn_debug || 'pattern',
      showHidden = params.url.ctzn_debugShowHidden || false,
      depth = params.url.ctzn_debugDepth || CTZN.config.citizen.debug.depth,
      colors = params.url.ctzn_debugColors || false,
      dump = params.url.ctzn_dump || CTZN.config.citizen.debug.output,
      toDump = '\n\n' + toDebug + ' dump:\n\n' + util.inspect(eval(toDebug), { showHidden: showHidden, depth: depth, colors: colors }) + '\n\n',
      viewDump;

  if ( toDebug === 'pattern' ) {
    toDump += '\n\nDerived request parameters:\n\n' + util.inspect(params, { showHidden: showHidden, depth: depth, colors: colors }) + '\n\n';
  }

  switch ( dump ) {
    case 'console':
      console.log(toDump);
      break;
    case 'view':
      viewDump = toDump.replace(/</g, '&lt;');
      viewDump = viewDump.replace(/>/g, '&gt;');
      while ( viewDump.search(/[\s\S]*{([\s\S]*)}/) !== -1 ) {
        viewDump = viewDump.replace(/([\s\S]*){([\s\S]*)}/, '$1<ul><li>$2</li></ul>');
      }
      viewDump = viewDump.replace(/\,\n/g, '\n</li>\n<li>\n');
      return viewDump;
  }
}



function buildCookie(cookies, params) {
  var defaults = {},
      cookie = {},
      cookieArray = [],
      path = CTZN.config.citizen.urlPaths.app,
      expires = '',
      httpOnly = 'HttpOnly;',
      // If it's a secure connection and the secureCookies setting is true (default),
      // make all cookies secure
      secure = params.route.parsed.protocol === 'https:' && CTZN.config.citizen.https.secureCookies ? 'secure;' : '',
      cookieExpires,
      now = Date.now();

  for ( var property in cookies ) {
    if ( cookies.hasOwnProperty(property) ) {
      if ( cookies[property].constructor !== Object ) {
        cookieArray.push(property + '=' + cookies[property] + ';path=/;HttpOnly;' + secure);
      } else {
        defaults = {
          value: '',
          path: CTZN.config.citizen.urlPaths.app,
          expires: 'session',
          httpOnly: true,
          secure: secure
        };
        cookie = helpers.extend(defaults, cookies[property]);
        cookieExpires = new Date();
        path = 'path=' + cookie.path + ';';
        switch ( cookie.expires ) {
          case 'session':
            expires = '';
            break;
          case 'now':
            cookieExpires.setTime(now);
            cookieExpires = cookieExpires.toUTCString();
            expires = 'expires=' + cookieExpires + ';';
            break;
          case 'never':
            cookieExpires.setTime(now + 946080000000);
            cookieExpires = cookieExpires.toUTCString();
            expires = 'expires=' + cookieExpires + ';';
            break;
          default:
            cookieExpires.setTime(now + cookie.expires);
            cookieExpires = cookieExpires.toUTCString();
            expires = 'expires=' + cookieExpires + ';';
        }
        if ( !cookie.httpOnly ) {
          httpOnly = '';
        }
        // Make the cookie insecure if the cookie directive explicitly calls for an
        // insecure cookie
        if ( cookie.secure === false ) {
          secure = '';
        }
        cookieArray.push(property + '=' + cookie.value + ';' + path + expires + httpOnly + secure);
      }
    }
  }

  return cookieArray;
}



function parseCookie(cookie) {
  var pairs = [],
      pair = [],
      cookies = {};

  if ( cookie ) {
    pairs = cookie.split(';');

    for ( var i = 0; i < pairs.length; i++ ) {
      pair = pairs[i].trim();
      pair = pair.split('=');
      cookies[pair[0]] = pair[1];
    }
  }

  return cookies;
}
