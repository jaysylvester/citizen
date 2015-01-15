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

module.exports = {
  start: start
};

function start() {
  server.emit('applicationStart');
}

function createServer() {
  http.createServer( function (request, response) {
    var context = {},
        params = {
          request: request,
          response: response,
          route: router.getRoute(request.url),
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
              message: '404 Not Found: ' + params.route.filePath
            };
          } else {
            response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension]);
            response.write(data);
            response.end();
            if ( CTZN.config.citizen.mode === 'debug' ) {
              console.log('200 OK: ' + params.route.filePath);
            }
          }
        });
      }
    });
  }).listen(CTZN.config.citizen.httpPort, CTZN.config.citizen.hostname, CTZN.config.citizen.connectionQueue);
}

function setSession(params, context) {
  if ( CTZN.config.citizen.sessions && context.session && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && Object.getOwnPropertyNames(context.session).length > 0 ) {
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
      if ( err.thrownBy ) {
        console.log('Error thrown by ' + err.thrownBy + ': ' + err.message);
        if ( !err.staticAsset ) {
          console.log(util.inspect(err.domain));
        }
      } else {
        console.log(util.inspect(err));
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
      if ( err.thrownBy ) {
        console.log('Error thrown by ' + err.thrownBy + ': ' + err.message);
        if ( !err.staticAsset ) {
          console.log(util.inspect(err.domain));
        }
      } else {
        console.log(util.inspect(err));
        console.trace();
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
  if ( context.redirect && context.redirect.url ) {
    params.response.writeHead(context.redirect.statusCode || 302, {
      'Location': context.redirect.url
    });
    params.response.end(server.emit('responseEnd', params, context));
  } else if ( controller ) {
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
    var responseStart = helpers.extend(context, output.responseStart);
    if ( CTZN.appOn.response && CTZN.appOn.response.start ) {
      helpers.listen({
        responseStart: function (emitter) {
          CTZN.appOn.response.start(params, responseStart, emitter);
        }
      }, function (output) {
        responseStart = helpers.extend(responseStart, output.responseStart);
        setSession(params, responseStart);
        if ( helpers.exists(params.route.pathName, 'route') ) {
          setCookie(params, responseStart);
          params.response.setHeader('Content-Type', CTZN.cache.route[params.route.pathName].contentType);
          params.response.write(CTZN.cache.route[params.route.pathName].view);
          params.response.end();
          server.emit('responseEnd', params, context);
        } else {
          fireController(controller, params, responseStart);
        }
      });
    } else {
      setSession(params, responseStart);
      if ( helpers.exists(params.route.pathName, 'route') ) {
        setCookie(params, responseStart);
        params.response.setHeader('Content-Type', CTZN.cache.route[params.route.pathName].contentType);
        params.response.write(CTZN.cache.route[params.route.pathName].view);
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
    var cachedController,
        controllerName = context.handoffControllerName || params.route.controller,
        view = context.view || params.route.view,
        action = context.handoffAction || params.route.action,
        cacheKeyController = controllerName + '-' + view + '-' + params.route.pathName,
        cacheKeyGlobal = controllerName + '-' + view;

    helpers.listen({
      pattern: function (emitter) {
        if ( helpers.exists(cacheKeyController, 'controller') || helpers.exists(cacheKeyGlobal, 'controller') ) {
          cachedController = helpers.retrieve(cacheKeyController, 'controller') || helpers.retrieve(cacheKeyGlobal, 'controller');
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

      if ( requestContext.view ) {
        params.route.chain[params.route.chain.length-1].view = params.route.view;
        params.route.chain[params.route.chain.length-1].action = requestContext.handoffAction || params.route.action;
      }
      requestContext.handoffControllerName = undefined;
      requestContext.handOffAction = undefined;
      params.route.view = requestContext.view || params.route.view;
      params.route.renderedView = requestContext.view || params.route.renderedView;
      requestContext.includesToRender = helpers.extend(requestContext.includesToRender, include);

      if ( output.listen.success ) {

        setSession(params, requestContext);

        if ( requestContext.redirect && requestContext.redirect.url ) {
          setCookie(params, requestContext);
          params.response.writeHead(requestContext.redirect.statusCode || 302, {
            'Location': requestContext.redirect.url
          });
          params.response.end();
          server.emit('responseEnd', params, requestContext);
          cacheController({
            controller: controllerName,
            route: params.route.pathName,
            context: requestContext,
            format: params.route.format,
            viewName: params.route.renderedView,
            params: params
          });
        } else {
          includeProperties = Object.getOwnPropertyNames(include);
          if ( includeProperties.length > 0 && params.url.type !== 'ajax' ) {
            includeProperties.forEach( function (item, index, array) {
              var controllerName = include[item].controller,
                  view = include[item].view || include[item].controller,
                  action = include[item].action || 'handler',
                  cacheKeyController = controllerName + '-' + view + '-' + params.route.pathName,
                  cacheKeyGlobal = controllerName + '-' + view;

              if ( !CTZN.cache.controller[cacheKeyController] && !CTZN.cache.controller[cacheKeyGlobal] ) {
                includeGroup[item] = function (emitter) {
                  CTZN.patterns.controllers[include[item].controller][action](params, requestContext, emitter);
                };
              }
            });
            requestContext.include = undefined;
            if ( Object.getOwnPropertyNames(includeGroup).length > 0 ) {
              helpers.listen(includeGroup, function (output) {
                includeProperties.forEach( function (item, index, array) {
                  var requestContextCache = requestContext.cache || false;

                  // Includes can use all directives except handoff, so we delete that before extending the request context with the include's context
                  if ( output[item] ) {
                    output[item].handoff = undefined;
                    requestContext = helpers.extend(requestContext, output[item]);
                  }
                  requestContext.includesToRender[item].context = helpers.copy(requestContext);
                  requestContext.cache = requestContextCache;
                  setSession(params, requestContext);
                });
                cacheController({
                  controller: controllerName,
                  route: params.route.pathName,
                  context: requestContext,
                  format: params.route.format,
                  viewName: params.route.renderedView,
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
                route: params.route.pathName,
                context: requestContext,
                format: params.route.format,
                viewName: params.route.renderedView,
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
              route: params.route.pathName,
              context: requestContext,
              format: params.route.format,
              viewName: params.route.renderedView,
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



function cacheController(options) {
  var cacheContext,
      cacheScope,
      cacheLifespan,
      cacheReset;

  if ( options.context.cache ) {
    if ( ( options.context.cache.scope === 'controller' && !CTZN.cache.controller[options.controller + '-' + options.viewName + '-' + options.route] ) || ( options.context.cache.scope === 'global' && !CTZN.cache.controller[options.controller + '-' + options.viewName] ) ) {
      cacheContext = helpers.copy(options.context);
      cacheScope = cacheContext.cache.scope;
      cacheLifespan = cacheContext.cache.lifespan || 'application';
      cacheReset = cacheContext.cache.resetOnAccess || false;

      if ( Object.getOwnPropertyNames(options.params.url).length > 0 && cacheContext.cache.urlParams ) {
        Object.getOwnPropertyNames(options.params.url).forEach( function ( item, index, array) {
          if ( cacheContext.cache.urlParams.indexOf(item) < 0 ) {
            throw {
              thrownBy: 'server.cacheController()',
              message: 'Invalid cache URL. The URL parameter [' + item + '] isn\'t permitted in a cached URL.'
            };
          }
        });
      }

      // Cache only those directives specified by the cache.directives array
      if ( cacheContext.cache.directives ) {
        if ( cacheContext.cache.directives.indexOf('cookie') < 0 ) {
          cacheContext.cookie = undefined;
        }
        if ( cacheContext.cache.directives.indexOf('session') < 0 ) {
          cacheContext.session = undefined;
        }
        if ( cacheContext.cache.directives.indexOf('redirect') < 0 ) {
          cacheContext.redirect = undefined;
        }
        if ( cacheContext.cache.directives.indexOf('view') < 0 ) {
          cacheContext.view = undefined;
        }
        if ( cacheContext.cache.directives.indexOf('handoff') < 0 ) {
          cacheContext.handoff = undefined;
        }
        if ( cacheContext.cache.directives.indexOf('include') < 0 ) {
          cacheContext.include = undefined;
        }
      } else {
        cacheContext.include = undefined;
        cacheContext.view = undefined;
        cacheContext.handoff = undefined;
        cacheContext.redirect = undefined;
        cacheContext.session = undefined;
        cacheContext.cookie = undefined;
      }

      cacheContext.cache = undefined;
      cacheContext.includesToRender = undefined;
      cacheContext.domain = undefined;

      switch ( cacheScope ) {
        case 'controller':
          helpers.cache({
            controller: options.controller,
            route: options.route,
            context: cacheContext,
            viewName: options.viewName,
            view: options.view || renderView(options.controller, options.viewName, options.format, helpers.extend(cacheContext.content, options.params)),
            lifespan: cacheLifespan,
            resetOnAccess: cacheReset
          });
          break;
        case 'global':
          helpers.cache({
            controller: options.controller,
            context: cacheContext,
            viewName: options.viewName,
            view: options.view || renderView(options.controller, options.viewName, options.format, helpers.extend(cacheContext.content, options.params)),
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
      view: params.route.view,
      context: helpers.copy(requestContext),
      cache: thisHandoff.cache || false
    };
  }

  handoffParams = helpers.extend(params, { route: { chain: params.route.chain.concat([{ controller: thisHandoff.controller, view: renderedView, action: action }]), renderer: renderer, renderedView: renderedView }});
  requestContext.handoff = undefined;
  requestContext.view = undefined;
  requestContext.session = {};
  if ( requestContext.cache && ( requestContext.cache.scope === 'controller' || requestContext.cache.scope === 'global' ) ) {
    requestContext.cache = undefined;
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
            includeViewContext,
            cachedController,
            cacheKeyController = includeController + '-' + includeView + '-' + params.route.pathName,
            cacheKeyGlobal = includeController + '-' + includeView;

        if ( helpers.exists(cacheKeyController, 'controller') || helpers.exists(cacheKeyGlobal, 'controller') ) {
          cachedController = helpers.retrieve(cacheKeyController, 'controller') || helpers.retrieve(cacheKeyGlobal, 'controller');
          viewContext.include[item] = cachedController.view;
        } else {
          includeViewContext = helpers.extend(requestContext.includesToRender[item].context.content, params);
          includeViewContext.include = helpers.extend(includeViewContext.include, viewContext.include);
          viewContext.include[item] = renderView(requestContext.includesToRender[item].controller, includeView, 'html', includeViewContext);

          cacheController({
            controller: includeController,
            route: params.route.pathName,
            context: requestContext.includesToRender[item].context,
            format: params.route.format,
            viewName: includeView,
            view: viewContext.include[item],
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

  if ( requestContext.cache && requestContext.cache.scope === 'route' ) {
    helpers.cache({
      route: params.route.pathName,
      contentType: contentType,
      view: view
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
          throw 'Error: JSONP callback names should consist of letters, numbers, and underscores only.';
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
      });
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
