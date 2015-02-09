// server

'use strict';

var domain = require('domain'),
    events = require('events'),
    fs = require('fs'),
    http = require('http'),
    querystring = require('querystring'),
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

function start() {
  server.emit('applicationStart');
}

function createServer() {
  var serverDomain = domain.create();

  serverDomain.on('error', function (err) {
    var appUrl = CTZN.config.citizen.httpPort === 80 ? 'http://' + CTZN.config.citizen.hostname + CTZN.config.citizen.urlPaths.app : 'http://' + CTZN.config.citizen.hostname + ':' + CTZN.config.citizen.httpPort + CTZN.config.citizen.urlPaths.app;

    switch ( err.code ) {
      case 'EACCES':
        helpers.log({
          content: '\nServer startup failed because port ' + CTZN.config.citizen.httpPort + ' isn\'t open. Please open this port or set an alternate port for HTTP traffic in your config file using the "httpPort" setting.\n\nMake sure to append this alternate port to your app\'s URL (http://localhost:8080, for example).\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      case 'EADDRINUSE':
        helpers.log({
          content: '\nServer startup failed because port ' + CTZN.config.citizen.httpPort + ' is already in use. Please set an alternate port for HTTP traffic in your config file using the "httpPort" setting.\n\nMake sure to append this alternate port to your app\'s URL (http://localhost:8080, for example).\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      case 'ENOTFOUND':
        helpers.log({
          content: '\nServer startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.hostname + '") isn\'t available.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
      default:
        helpers.log({
          content: '\nThere was a problem starting the server. The port and hostname you specified in your config file appear to be available, so please review your other settings and make sure everything is correct.\n',
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
        break;
    }
  });

  serverDomain.run( function () {
    http.createServer( function (request, response) {
      var context = {},
          params = {
            request: request,
            response: response,
            route: router.getRoute('http://' + request.headers.host + request.url),
            url: router.getUrlParams(request.url),
            form: {},
            payload: {},
            cookie: parseCookie(request.headers.cookie),
            session: {},
            config: CTZN.config
          },
          requestDomain = domain.create();

      // Overwrite the default route parameters with URL parameters if they exist
      params.route.action = params.url.action || params.route.action;
      params.route.type = params.url.type || params.route.type;
      params.route.format = params.url.format || params.route.format;
      params.route.show = params.url.show || params.route.show;

      requestDomain.add(params);
      requestDomain.add(request);
      requestDomain.add(response);
      requestDomain.add(context);

      requestDomain.on('error', function (err) {
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
              server.emit('error', err, request, response);
            });
          } else {
            server.emit('error', err, request, response);
          }
        });
      });

      requestDomain.run( function () {
        // If it's a dynamic page request, fire requestStart(). Otherwise, serve the static asset.
        if ( !params.route.isStatic ) {
          if ( CTZN.config.citizen.sessions ) {
            server.emit('sessionStart', params, context);
          } else {
            server.emit('requestStart', params, context);
          }
        } else {
          fs.readFile(CTZN.config.citizen.directories.web + params.route.filePath, function (err, data) {
            if ( err ) {
              throw {
                thrownBy: 'server.createServer()',
                statusCode: 404,
                staticAsset: true,
                file: params.route.filePath
              };
            } else {
              response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension]);
              response.write(data);
              response.end();
              helpers.log({
                label: '200 OK',
                content: params.route.filePath,
                file: 'citizen.txt'
              });
            }
          });
        }
      });
    }).listen(CTZN.config.citizen.httpPort, CTZN.config.citizen.hostname, CTZN.config.citizen.connectionQueue, function () {
      var appUrl = CTZN.config.citizen.httpPort === 80 ? 'http://' + CTZN.config.citizen.hostname + CTZN.config.citizen.urlPaths.app : 'http://' + CTZN.config.citizen.hostname + ':' + CTZN.config.citizen.httpPort + CTZN.config.citizen.urlPaths.app,
          startupMessage = '\nYour app is running in ' + CTZN.config.citizen.mode + ' mode and ready to accept requests on port ' + CTZN.config.citizen.httpPort + '. You can access it locally at:\n\n  ' + appUrl;

      if ( CTZN.config.citizen.mode === 'debug' && CTZN.config.citizen.debug.disableCache ) {
        startupMessage += '\n\nBy default, caching is disabled in debug mode, so you won\'t see any logs related to caching. To enable caching in debug mode, set "disableCache" to false under the "debug" node in your config file.';
      }

      helpers.log({
        label: 'Configuration',
        content: CTZN.config.citizen,
        file: 'citizen.txt',
        timestamp: false
      });
      helpers.log({
        content: startupMessage,
        toConsole: true,
        file: 'citizen.txt',
        timestamp: false
      });
    });
  });
}

function setSession(params, context) {
  if ( CTZN.config.citizen.sessions && context.session && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && helpers.size(context.session) ) {
    if ( context.session.expires && context.session.expires === 'now' ) {
      session.end(params.session.id);
      context.cookie = helpers.extend(context.cookie, { ctznSessionID: { expires: 'now' }});
      server.emit('sessionEnd', params, context);
      params.session = {};
    } else {
      CTZN.sessions[params.session.id] = helpers.extend(CTZN.sessions[params.session.id], context.session);
      params.session = helpers.copy(CTZN.sessions[params.session.id]);
    }
  }
}

function setCookie(params, context) {
  var cookie = buildCookie(context.cookie);
  if ( cookie.length ) {
    params.response.setHeader('Set-Cookie', cookie);
  }
}

server.on('applicationStart', function () {
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
        createServer();
      });
    } else {
      createServer();
    }
  });
});

server.on('error', function (err, request, response) {
  var statusCode = err.statusCode || 500;

  switch ( CTZN.config.citizen.mode ) {
    case 'production':
      if ( !err.staticAsset ) {
        if ( err.thrownBy && err.message ) {
          helpers.log({
            label: 'Error thrown by ' + err.thrownBy,
            content: err.message,
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
          label: '404 Not Found',
          content: err.file,
          file: 'citizen.txt'
        });
      }

      if ( !response.headersSent ) {
        response.statusCode = statusCode;
        if ( err.stack ) {
          response.write(err.stack);
        } else {
          response.write(util.inspect(err));
        }
        response.end();
      }
      break;
    case 'development':
    case 'debug':
      if ( !err.staticAsset ) {
        if ( err.thrownBy && err.message ) {
          helpers.log({
            label: 'Error thrown by ' + err.thrownBy,
            content: err.message,
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
          label: '404 Not Found',
          content: err.file,
          file: 'citizen.txt'
        });
      }

      if ( !response.headersSent ) {
        response.statusCode = statusCode;
        if ( err.stack ) {
          response.write(err.stack);
        } else {
          response.write(util.inspect(err));
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



function processRequest(params, context) {
  var controller = CTZN.patterns.controllers[params.route.controller],
      corsOriginTest,
      body = '',
      respond = true;

  // If a previous event in the request context requested a redirect, do it immediately rather than firing the controller.
  if ( context.redirect && helpers.size(context.redirect) ) {
    redirect(params, context);
  } else if ( controller && controller[params.route.action] ) {
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
                server.emit('responseStart', controller, params, requestEnd);
              });
            } else {
              server.emit('responseStart', controller, params, requestEnd);
            }
          });
          break;
        case 'POST':
          params.request.on('data', function (chunk) {
            body += chunk.toString();
          });
          params.request.on('end', function () {
            params.form = querystring.parse(body);
            server.emit('responseStart', controller, params, context);
          });
          break;
        case 'PUT':
          params.request.on('data', function (chunk) {
            body += chunk.toString();
          });
          params.request.on('end', function () {
            params.payload = JSON.parse(body);
            server.emit('responseStart', controller, params, context);
          });
          break;
        case 'DELETE':
          server.emit('responseStart', controller, params, context);
          break;
        // Just send the response headers for HEAD and OPTIONS
        case 'HEAD':
        case 'OPTIONS':
          params.response.end();
          break;
      }
    }
  } else {
    throw {
      thrownBy: 'server.processRequest()',
      statusCode: 404,
      message: 'The requested path doesn\'t exist.'
    };
  }
}

server.on('responseStart', function (controller, params, context) {
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
          fireController(controller, params, responseStart);
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
        fireController(controller, params, responseStart);
      }
    }
  });
});



function fireController(controller, params, context) {
  var responseDomain = domain.create();

  responseDomain.on('error', function (err) {
    server.emit('error', err, params.request, params.response);
  });

  responseDomain.add(controller);
  responseDomain.add(params);
  responseDomain.add(context);

  responseDomain.run( function () {
    var controllerName = context.handoffControllerName || params.route.controller,
        view = context.view || params.route.view,
        action = context.handoffAction || params.route.action;

    helpers.listen({
      pattern: function (emitter) {
        var cachedController = helpers.retrieveController({ controller: controllerName, action: action, view: view, route: params.route.pathname }) || helpers.retrieveController({ controller: controllerName, action: action, view: view, route: 'global' });
        if ( cachedController ) {
          emitter.emit('ready', cachedController.context);
        } else {
          controller[action](params, context, emitter);
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
      requestContext.handoffControllerName = undefined;
      requestContext.handOffAction = undefined;
      requestContext.includesToRender = helpers.extend(requestContext.includesToRender, include);

      if ( output.listen.success ) {

        setSession(params, requestContext);

        if ( requestContext.redirect && helpers.size(requestContext.redirect) && typeof requestContext.redirect.refresh === 'undefined' ) {
          setCookie(params, requestContext);
          redirect(params, requestContext);

          cacheController({
            controller: controllerName,
            route: params.route.pathname,
            context: requestContext,
            format: params.route.format,
            viewName: params.route.renderedView,
            action: action,
            params: params
          });
        } else {
          if ( requestContext.redirect && helpers.size(requestContext.redirect) ) {
            redirect(params, requestContext);
          }
          includeProperties = Object.getOwnPropertyNames(include);
          if ( includeProperties.length > 0 && params.url.type !== 'ajax' ) {
            includeProperties.forEach( function (item, index, array) {
              var controllerName = include[item].controller,
                  view = include[item].view || include[item].controller,
                  action = include[item].action || 'handler',
                  cachedController = helpers.retrieveController({ controller: controllerName, action: action, view: view, route: params.route.pathname }) || helpers.retrieveController({ controller: controllerName, action: action, view: view, route: 'global' });

              requestContext.includesToRender[item].action = action;

              includeGroup[item] = function (emitter) {
                if ( cachedController ) {
                  emitter.emit('ready', cachedController.context);
                } else {
                  CTZN.patterns.controllers[include[item].controller][action](params, requestContext, emitter);
                }
              };
            });
            requestContext.include = undefined;
            if ( helpers.size(includeGroup) ) {
              helpers.listen(includeGroup, function (output) {
                includeProperties.forEach( function (item, index, array) {
                  requestContext.includesToRender[item].context = output[item];
                  requestContext.includesToRender[item].view = requestContext.includesToRender[item].view || output[item].view;

                  cacheController({
                    controller: requestContext.includesToRender[item].controller,
                    action: requestContext.includesToRender[item].action,
                    view: requestContext.includesToRender[item].view || requestContext.includesToRender[item].controller,
                    route: params.route.pathname,
                    context: output[item],
                    format: params.route.format,
                    params: params
                  });
                });
                cacheController({
                  controller: controllerName,
                  action: action,
                  view: params.route.renderedView,
                  route: params.route.pathname,
                  context: requestContext,
                  format: params.route.format,
                  params: params
                });
                if ( requestContext.handoff && params.url.type !== 'ajax' ) {
                  handoff(params, requestContext);
                } else {
                  setCookie(params, requestContext);
                  respond(params, requestContext);
                }
              });
            } else {
              cacheController({
                controller: controllerName,
                action: action,
                view: params.route.renderedView,
                route: params.route.pathname,
                context: requestContext,
                format: params.route.format,
                params: params
              });
              if ( requestContext.handoff && params.url.type !== 'ajax' ) {
                handoff(params, requestContext);
              } else {
                setCookie(params, requestContext);
                respond(params, requestContext);
              }
            }
          } else {
            cacheController({
              controller: controllerName,
              action: action,
              view: params.route.renderedView,
              route: params.route.pathname,
              context: requestContext,
              format: params.route.format,
              params: params
            });
            if ( requestContext.handoff && params.url.type !== 'ajax' ) {
              handoff(params, requestContext);
            } else {
              setCookie(params, requestContext);
              respond(params, requestContext);
            }
          }
        }
      } else {
        throw {
          thrownBy: 'server.fireController()',
          message: 'The [' + params.route.renderer + '] controller failed to return a valid response.'
        };
      }

    });
  });
}



function redirect(params, context) {
  var statusCode = context.redirect.statusCode || 302;

  if ( typeof context.redirect.refresh === 'number' ) {
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
      setSession(params, context);
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

  if ( options.context.cache && !options.context.cache.route ) {

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
          if ( options.context.cache.urlParams.indexOf(item) < 0 ) {
            throw {
              thrownBy: 'server.cacheController()',
              message: 'Invalid cache URL. The URL parameter [' + item + '] isn\'t permitted in a cached URL.'
            };
          }
        });
      }

      // Cache only those directives specified by the cache.directives array
      if ( options.context.cache.directives ) {
        options.context.cache.directives.forEach( function (item, index, array) {
          if ( options.context[item]) {
            cacheContext[item] = options.context[item];
          }
        });
      }

      if ( options.context.content ) {
        cacheContext.content = options.context.content;
      }

      switch ( options.format ) {
        case 'json':
        case 'JSON':
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
      handoffController = CTZN.patterns.controllers[thisHandoff.controller],
      handoffParams = {},
      renderer = thisHandoff.controller || params.route.renderer,
      renderedView = thisHandoff.view || thisHandoff.controller,
      action = thisHandoff.action || 'handler';

  if ( !handoffController ) {
    throw {
      thrownBy: 'server.handoff()',
      message: 'The [' + thisHandoff.controller + '] controller doesn\'t exist.'
    };
  }

  if ( thisHandoff.includeThisView ) {
    requestContext.includesToRender[lastLink.controller] = {
      controller: lastLink.controller,
      action: lastLink.action,
      view: lastLink.view,
      context: helpers.copy(requestContext),
      cache: thisHandoff.cache || false
    };
  }

  handoffParams = helpers.extend(params, { route: { chain: params.route.chain.concat([{ controller: thisHandoff.controller, action: action, view: renderedView }]), renderer: renderer, renderedView: renderedView }});
  requestContext.handoff = undefined;
  requestContext.view = undefined;
  requestContext.session = {};
  if ( requestContext.cache && !requestContext.cache.route ) {
    requestContext.cache = {};
  }
  requestContext.handoffControllerName = thisHandoff.controller;
  requestContext.handoffAction = action;
  fireController(handoffController, handoffParams, requestContext);
}



function respond(params, requestContext) {
  var contentType,
      viewContext,
      view;

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html';
      viewContext = helpers.extend(requestContext.content, params);
      viewContext.include = {};
      Object.getOwnPropertyNames(requestContext.includesToRender).forEach( function (item, index, array) {
        var includeController = requestContext.includesToRender[item].controller,
            includeView = requestContext.includesToRender[item].view || requestContext.includesToRender[item].controller,
            includeAction = requestContext.includesToRender[item].action,
            includeViewContext,
            cachedController = helpers.retrieveController({ controller: includeController, action: includeAction, view: includeView, route: params.route.pathname }) || helpers.retrieveController({ controller: includeController, action: includeAction, view: includeView, route: 'global' });

        if ( cachedController ) {
          viewContext.include[item] = cachedController.render;
          helpers.log({
            label: 'using cached controller view',
            content: item,
            file: 'citizen.txt'
          });
        } else {
          includeViewContext = helpers.extend(requestContext.includesToRender[item].context.content, params);
          viewContext.include[item] = renderView(includeController, includeView, params.route.format, includeViewContext);
          helpers.log({
            label: 'rendering controller view',
            content: item,
            file: 'citizen.txt'
          });

          cacheController({
            controller: includeController,
            action: includeAction,
            view: includeView,
            route: params.route.pathname,
            context: requestContext.includesToRender[item].context,
            render: viewContext.include[item],
            format: params.route.format,
            params: params
          });
        }
      });
      // If debugging is enabled, append the debug output to viewContext
      if ( CTZN.config.citizen.mode === 'debug' || ( CTZN.config.citizen.mode === 'development' && params.url.ctzn_debug ) ) {
        viewContext.debugOutput = debug(requestContext, params);
      }
      break;
    case 'json':
    case 'JSON':
      contentType = 'application/json';
      // If the output is JSON, pass the raw content to the view renderer
      viewContext = requestContext.content;
      break;
    case 'jsonp':
    case 'JSONP':
      contentType = 'text/javascript';
      // If the output is JSONP, pass the request params and raw content to the view renderer
      viewContext = helpers.extend(viewContext, params);
      viewContext.content = requestContext.content;
      break;
  }

  view = renderView(params.route.renderer, params.route.renderedView, params.route.format, viewContext);

  params.response.setHeader('Content-Type', contentType);
  params.response.write(view);
  params.response.end();
  server.emit('responseEnd', params, requestContext);

  if ( requestContext.cache && requestContext.cache.route ) {
    if ( helpers.size(params.url) && requestContext.cache.urlParams ) {
      Object.getOwnPropertyNames(params.url).forEach( function ( item, index, array) {
        if ( requestContext.cache.urlParams.indexOf(item) < 0 ) {
          throw {
            thrownBy: 'server.respond()',
            message: 'Invalid cache URL. The URL parameter [' + item + '] isn\'t permitted in a cached URL.'
          };
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
}



function renderView(pattern, view, format, context) {
  var viewOutput = '',
      callbackRegex;

  if ( CTZN.patterns.views[pattern][view] ) {
    switch ( format ) {
      case 'html':
      case 'HTML':
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
          viewOutput = viewOutput.replace('</body>', '<div id="citizen-debug"><pre>' + context.debugOutput + '</pre></div></body>');
        }
        break;
      case 'json':
      case 'JSON':
        viewOutput = JSON.stringify(context);
        break;
      case 'jsonp':
      case 'JSONP':
        callbackRegex = new RegExp(/^[A-Za-z0-9_]*$/);
        if ( callbackRegex.test(context.url.callback) ) {
          viewOutput = context.url.callback + '(' + JSON.stringify(context.content) + ');';
        } else {
          throw {
            thrownBy: 'server.renderView()',
            message: 'JSONP callback names should consist of letters, numbers, and underscores only.'
          };
        }
        break;
    }

    return viewOutput;
  } else {
    throw {
      thrownBy: 'server.renderView()',
      message: 'The [' + pattern + ']' + '[' + view + '] view doesn\'t exist.'
    };
  }
}



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



function debug(pattern, params) {
  var toDebug = params.url.ctzn_debug || 'pattern',
      showHidden = params.url.ctzn_debugShowHidden || false,
      depth = params.url.ctzn_debugDepth || CTZN.config.citizen.debug.depth,
      colors = params.url.ctzn_debugColors || false,
      dump = params.url.ctzn_dump || CTZN.config.citizen.debug.output;

  switch ( dump ) {
    case 'console':
      console.log(toDebug + ':\n' + util.inspect(eval(toDebug), { showHidden: showHidden, depth: depth, colors: colors }));
      return false;
    case 'view':
      return toDebug + ':\n' + util.inspect(eval(toDebug), { showHidden: showHidden, depth: depth, colors: colors });
  }
}



function buildCookie(cookies) {
  var defaults = {},
      cookie = {},
      cookieArray = [],
      path = '',
      expires = '',
      httpOnly = 'HttpOnly;',
      secure = '',
      cookieExpires,
      now = Date.now();

  for ( var property in cookies ) {
    if ( cookies.hasOwnProperty(property) ) {
      if ( cookies[property].constructor.toString().indexOf('Object') < 0 ) {
        cookieArray.push(property + '=' + cookies[property] + ';path=/;HttpOnly;');
      } else {
        defaults = {
          value: '',
          path: '/',
          expires: 'session',
          httpOnly: true,
          secure: false
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
        if ( cookie.secure ) {
          secure = 'secure;';
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
    pairs.forEach( function (cookie, index, array) {
      pair = pairs[index].trim();
      pair = pair.split('=');
      cookies[pair[0]] = pair[1];
    });
  }

  return cookies;
}
