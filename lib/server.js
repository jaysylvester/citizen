// server

'use strict';
/* jshint node: true */
/* global CTZN: false */

var domain = require('domain'),
    events = require('events'),
    fs = require('fs'),
    http = require('http'),
    querystring = require('querystring'),
    util = require('util'),
    path = require('path'),
    helpers = require('./helpers'),
    listen = helpers.listen,
    router = require('./router'),
    session = require('./session');

module.exports = {
  start: start
};



function start() {
  var applicationStart = {
        cookie: {},
        session: {},
        redirect: {}
      };

  listen({
    applicationStart: function (emitter) {
      CTZN.on.application.start(emitter);
    }
  }, function (output) {
    applicationStart = helpers.extend(applicationStart, output.applicationStart);
    if ( CTZN.appOn.application && CTZN.appOn.application.start ) {
      listen({
        applicationStart: function (emitter) {
          CTZN.appOn.application.start(helpers.copy(applicationStart), emitter);
        }
      }, function (output) {
        applicationStart = helpers.extend(applicationStart, output.applicationStart);
        createServer(applicationStart);
      });
    } else {
      createServer(applicationStart);
    }
  });
}



function createServer(context) {
  http.createServer( function (request, response) {
    var params = {
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

    // TODO: extend querystring with urlParams (url parameters should take precedence over query strings)
    // AJAX requests may also contain payloads in JSON format that need to be parsed as well.

    // Overwrite the default route parameters with URL parameters if they exist
    if ( params.url.action ) {
      params.route.action = params.url.action;
    }
    if ( params.url.type ) {
      params.route.type = params.url.type;
    }
    if ( params.url.format ) {
      params.route.format = params.url.format;
    }
    if ( params.url.show ) {
      params.route.show = params.url.show;
    }

    requestDomain.add(params);
    requestDomain.add(request);
    requestDomain.add(response);
    requestDomain.add(context);

    requestDomain.on('error', function (e) {
      listen({
        applicationError: function (emitter) {
          CTZN.on.application.error(e, params, context, emitter);
        }
      }, function (output) {
        var applicationError = helpers.extend(context, output.applicationError);
        if ( CTZN.appOn.application && CTZN.appOn.application.error ) {
          listen({
            applicationError: function (emitter) {
              CTZN.appOn.application.error(e, params, applicationError, emitter);
            }
          }, function (output) {
            applicationError = helpers.extend(applicationError, output.applicationError);
            error(e, request, response, params, applicationError);
          });
        } else {
          error(e, request, response, params, applicationError);
        }
      });
    });

    requestDomain.run( function () {
      var staticPath;

      // If it's a dynamic page request, fire requestStart(). Otherwise, serve the static asset.
      if ( !params.route.isStatic ) {
        if ( CTZN.config.citizen.sessions ) {
          sessionStart(helpers.copy(params), helpers.copy(context));
        } else {
          requestStart(helpers.copy(params), helpers.copy(context));
        }
      } else {
        staticPath = CTZN.config.citizen.directories.public + params.route.filePath;
        fs.readFile(staticPath, function (err, data) {
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



function sessionStart(params, context) {
  var sessionID = 0;

  if ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) {
    if ( params.cookie.ctzn_session_id && CTZN.sessions[params.cookie.ctzn_session_id] && CTZN.sessions[params.cookie.ctzn_session_id].expires > Date.now() ) {
      session.reset(params.cookie.ctzn_session_id);
      params.session = CTZN.sessions[params.cookie.ctzn_session_id];
      requestStart(helpers.copy(params), helpers.copy(context));
    } else {
      sessionID = session.create();
      context.cookie.ctzn_session_id = {
        value: sessionID
      };
      params.cookie.ctzn_session_id = sessionID;
      params.session = CTZN.sessions[sessionID];
      listen({
        sessionStart: function (emitter) {
          CTZN.on.session.start(helpers.copy(params), helpers.copy(context), emitter);
        }
      }, function (output) {
        var sessionStart = helpers.extend(context, output.sessionStart);
        if ( CTZN.appOn.session && CTZN.appOn.session.start ) {
          listen({
            sessionStart: function (emitter) {
              CTZN.appOn.session.start(helpers.copy(params), helpers.copy(sessionStart), emitter);
            }
          }, function (output) {
            sessionStart = helpers.extend(sessionStart, output.sessionStart);
            requestStart(helpers.copy(params), helpers.copy(sessionStart));
          });
        } else {
          requestStart(helpers.copy(params), helpers.copy(sessionStart));
        }
      });
    }
  } else {
    requestStart(params, context);
  }
}



// setSession() is meant to act inline within the calling function, so don't pass it
// copies of params and context. The arguments are meant to be pointers to the originals.
function setSession(params, context) {
  if ( CTZN.config.citizen.sessions && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && Object.getOwnPropertyNames(context.session).length > 0 ) {
    if ( context.session.expires && context.session.expires === 'now' ) {
      session.end(params.session.id);
      context.cookie = helpers.extend(context.cookie, { ctzn_session_id: { expires: 'now' }});
      sessionEnd(helpers.copy(params), helpers.copy(context));
    } else {
      CTZN.sessions[params.session.id] = helpers.extend(CTZN.sessions[params.session.id], context.session);
      params.session = CTZN.sessions[params.session.id];
    }
  }
}



function requestStart(params, context) {
  listen({
    requestStart: function (emitter) {
      CTZN.on.request.start(helpers.copy(params), helpers.copy(context), emitter);
    }
  }, function (output) {
    var requestStart = helpers.extend(context, output.requestStart);
    setSession(params, requestStart);
    if ( CTZN.appOn.request && CTZN.appOn.request.start ) {
      listen({
        requestStart: function (emitter) {
          CTZN.appOn.request.start(helpers.copy(params), helpers.copy(requestStart), emitter);
        }
      }, function (output) {
        requestStart = helpers.extend(requestStart, output.requestStart);
        setSession(params, requestStart);
        processRequest(helpers.copy(params), helpers.copy(requestStart));
      });
    } else {
      processRequest(helpers.copy(params), helpers.copy(requestStart));
    }
  });
}



function processRequest(params, context) {
  var controller = CTZN.patterns.controllers[params.route.controller],
      corsOriginTest,
      body = '',
      respond = true;

  // If a previous event in the request context requested a redirect, do it immediately rather than firing the controller.
  if ( context.redirect.url ) {
    params.response.writeHead(context.redirect.statusCode || 302, {
      'Location': context.redirect.url
    });
    params.response.end(responseEnd(helpers.copy(params), helpers.copy(context)));
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
              params.response.end(responseEnd(helpers.copy(params), helpers.copy(context)));
            } else {
              for ( var property in controller.access ) {
                params.response.setHeader(property, controller.access[property]);
              }
              params.response.setHeader('access-control-allow-origin', params.request.headers.origin);
            }
          } else {
            respond = false;
            params.response.end(responseEnd(helpers.copy(params), helpers.copy(context)));
          }
        } else {
          respond = false;
          params.response.end(responseEnd(helpers.copy(params), helpers.copy(context)));
        }
      }
    }

    if ( respond ) {
      switch ( params.request.method ) {
        case 'GET':
          listen({
            requestEnd: function (emitter) {
              CTZN.on.request.end(helpers.copy(params), helpers.copy(context), emitter);
            }
          }, function (output) {
            var requestEnd = helpers.extend(context, output.requestEnd);
            setSession(params, requestEnd);
            if ( CTZN.appOn.request && CTZN.appOn.request.end ) {
              listen({
                requestEnd: function (emitter) {
                  CTZN.appOn.request.end(helpers.copy(params), helpers.copy(requestEnd), emitter);
                }
              }, function (output) {
                requestEnd = helpers.extend(requestEnd, output.requestEnd);
                setSession(params, requestEnd);
                responseStart(controller, params, requestEnd);
              });
            } else {
              responseStart(controller, params, requestEnd);
            }
          });
          break;
        case 'POST':
          params.request.on('data', function (chunk) {
            body += chunk.toString();
          });
          params.request.on('end', function () {
            params.form = querystring.parse(body);
            // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
            responseStart(controller, params, context);
          });
          break;
        case 'PUT':
          params.request.on('data', function (chunk) {
            body += chunk.toString();
          });
          params.request.on('end', function () {
            params.payload = JSON.parse(body);
            // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
            responseStart(controller, params, context);
          });
          break;
        case 'DELETE':
          // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
          responseStart(controller, params, context);
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



function responseStart(controller, params, context) {
  listen({
    responseStart: function (emitter) {
      CTZN.on.response.start(helpers.copy(params), helpers.copy(context), emitter);
    }
  }, function (output) {
    var responseStart = helpers.extend(context, output.responseStart);
    setSession(params, responseStart);
    if ( CTZN.appOn.response && CTZN.appOn.response.start ) {
      listen({
        responseStart: function (emitter) {
          CTZN.appOn.response.start(helpers.copy(params), helpers.copy(responseStart), emitter);
        }
      }, function (output) {
        responseStart = helpers.extend(responseStart, output.responseStart);
        setSession(params, responseStart);
        fireController(controller, params, responseStart);
      });
    } else {
      fireController(controller, params, responseStart);
    }
  });
}



function fireController(controller, params, context) {
  var responseDomain = domain.create();

  responseDomain.on('error', function (e) {
    error(e, params.request, params.response, params, context);
  });

  responseDomain.add(controller);
  responseDomain.add(params);
  responseDomain.add(context);

  responseDomain.run( function () {
    listen({
      pattern: function (emitter) {
        controller.handler(helpers.copy(params), helpers.copy(context), emitter);
      }
    }, function (output) {
      var requestContext = helpers.extend(context, output.pattern),
          include = requestContext.include || {},
          includeProperties,
          includeGroup = {},
          cookie = [],
          contentType;

      params.route.view = requestContext.view || params.route.view;
      params.route.renderedView = requestContext.view || params.route.renderedView;
      requestContext.includesToRender = helpers.extend(requestContext.includesToRender, include);

      if ( output.listen.success ) {

        setSession(params, requestContext);

        cookie = buildCookie(requestContext.cookie);
        if ( cookie.length ) {
          params.response.setHeader('Set-Cookie', cookie);
        }

        if ( requestContext.redirect.url ) {
          params.response.writeHead(requestContext.redirect.statusCode || 302, {
            'Location': requestContext.redirect.url
          });
          params.response.end(responseEnd(helpers.copy(params), helpers.copy(requestContext)));
        } else {
          includeProperties = Object.getOwnPropertyNames(include);
          if ( includeProperties.length > 0 && params.url.type !== 'ajax' ) {
            includeProperties.forEach( function (item, index, array) {
              includeGroup[item] = function (emitter) {
                CTZN.patterns.controllers[include[item].controller].handler(helpers.copy(params), helpers.copy(requestContext), emitter);
              };
            });
            delete requestContext.include;
            listen(includeGroup, function (output) {
              includeProperties.forEach( function (item, index, array) {
                // Includes can use all directives except handoff, so we delete that before extending the request context with the include's context
                delete output[item].handoff;
                requestContext = helpers.extend(requestContext, output[item]);
                requestContext.includesToRender[item].context = helpers.copy(requestContext);
              });
              if ( requestContext.handoff ) {
                handoff(params, requestContext);
              } else {
                respond(params, requestContext);
              }
            });
          } else {
            if ( requestContext.handoff ) {
              handoff(params, requestContext);
            } else {
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



function handoff(params, requestContext) {
  var thisHandoff = helpers.copy(requestContext.handoff),
      lastLink = params.route.chain[params.route.chain.length-1],
      handoffController = CTZN.patterns.controllers[thisHandoff.controller],
      handoffParams = {},
      renderer = thisHandoff.controller || params.route.renderer,
      renderedView = thisHandoff.view || thisHandoff.controller || requestContext.view || params.route.renderedView;

  if ( !handoffController ) {
    throw {
      thrownBy: 'server.handoff()',
      message: 'The [' + thisHandoff.controller + '] controller doesn\'t exist.'
    };
  }

  if ( thisHandoff.includeView ) {
    requestContext.includesToRender[lastLink] = {
      controller: lastLink,
      view: thisHandoff.includeView,
      context: helpers.copy(requestContext)
    };
  }

  handoffParams = helpers.extend(params, { route: { chain: params.route.chain.concat([thisHandoff.controller]), renderer: renderer, renderedView: renderedView }});
  delete requestContext.handoff;
  delete requestContext.view;
  fireController(handoffController, handoffParams, helpers.copy(requestContext));
}



function respond(params, requestContext) {
  var contentType,
      viewContext;

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html';
      viewContext = helpers.extend(requestContext.content, params);
      viewContext.include = {};
      Object.getOwnPropertyNames(requestContext.includesToRender).forEach( function (item, index, array) {
        var includeView = requestContext.includesToRender[item].view || requestContext.includesToRender[item].controller,
            includeViewContext = helpers.extend(requestContext.includesToRender[item].context.content, params);

        includeViewContext.include = helpers.extend(includeViewContext.include, viewContext.include);
        viewContext.include[item] = renderView(requestContext.includesToRender[item].controller, includeView, 'html', includeViewContext);
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

  params.response.setHeader('Content-Type', contentType);
  params.response.write(renderView(params.route.renderer, params.route.renderedView, params.route.format, viewContext));
  params.response.end(responseEnd(helpers.copy(params), helpers.copy(requestContext)));
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
                  filename: CTZN.patterns.views[pattern][view].path
                });
                viewOutput = viewOutput(context);
                break;
              case 'debug':
                viewOutput = fs.readFileSync(path.join(CTZN.config.citizen.directories.views, '/', pattern, '/', view + '.jade'), { 'encoding': 'utf8' });
                viewOutput = CTZN.jade.compile(viewOutput, {
                  filename: CTZN.patterns.views[pattern][view].path,
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



function responseEnd(params, context) {
  listen({
    responseEnd: function (emitter) {
      CTZN.on.response.end(helpers.copy(params), helpers.copy(context), emitter);
    }
  }, function (output) {
    var responseEnd = helpers.extend(context, output.responseEnd);
    if ( CTZN.appOn.response && CTZN.appOn.response.end ) {
      listen({
        responseEnd: function (emitter) {
          CTZN.appOn.response.end(helpers.copy(params), helpers.copy(responseEnd), emitter);
        }
      }, function (output) {
        responseEnd = helpers.extend(responseEnd, output.responseEnd);
      });
    }
  });
}



function sessionEnd(params, context) {
  listen({
    sessionEnd: function (emitter) {
      CTZN.on.session.end(helpers.copy(params), helpers.copy(context), emitter);
    }
  }, function (output) {
    var sessionEnd = helpers.extend(context, output.sessionEnd);
    if ( CTZN.appOn.session && CTZN.appOn.session.end ) {
      listen({
        sessionEnd: function (emitter) {
          CTZN.appOn.session.end(helpers.copy(params), helpers.copy(sessionEnd), emitter);
        }
      }, function (output) {
        sessionEnd = helpers.extend(sessionEnd, output.sessionEnd);
      });
    }
  });
}



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
      return toDebug + ': ' + JSON.stringify(util.inspect(eval(toDebug), { showHidden: showHidden, depth: depth, colors: colors }));
  }
}



function error(e, request, response, params, context) {
  var statusCode = e.statusCode || 500;

  switch ( CTZN.config.citizen.mode ) {
    case 'production':
      // TODO: Need friendly client error messaging for production mode.
      if ( e.thrownBy ) {
        console.log('Error thrown by ' + e.thrownBy + ': ' + e.message);
        if ( !e.staticAsset ) {
          console.log(util.inspect(e.domain));
        }
      } else {
        console.log(util.inspect(e));
      }
      if ( !response.headersSent ) {
        response.statusCode = statusCode;
        if ( e.stack ) {
          response.write(e.stack);
        } else {
          response.write(util.inspect(e));
        }
        response.end();
      }
      break;
    case 'development':
    case 'debug':
      if ( e.thrownBy ) {
        console.log('Error thrown by ' + e.thrownBy + ': ' + e.message);
        if ( !e.staticAsset ) {
          console.log(util.inspect(e.domain));
        }
      } else {
        console.log(util.inspect(e));
      }
      if ( !response.headersSent ) {
        response.statusCode = statusCode;
        if ( e.stack ) {
          response.write(e.stack);
        } else {
          response.write(util.inspect(e));
        }
        response.end();
      }
      break;
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
