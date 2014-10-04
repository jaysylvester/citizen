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
    helper = require('./helper'),
    listen = helper.listen,
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
    applicationStart = helper.extend(applicationStart, output.applicationStart);
    if ( CTZN.appOn.application && CTZN.appOn.application.start ) {
      listen({
        applicationStart: function (emitter) {
          CTZN.appOn.application.start(helper.copy(applicationStart), emitter);
        }
      }, function (output) {
        applicationStart = helper.extend(applicationStart, output.applicationStart);
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
    if ( params.url.type ) {
      params.route.type = params.url.type;
    }
    if ( params.url.format ) {
      params.route.format = params.url.format;
    }
    if ( params.url.do ) {
      params.route.do = params.url.do;
    }
    if ( params.url.show ) {
      params.route.show = params.url.show;
    }
    if ( params.url.view ) {
      params.route.view = params.url.view;
      params.route.renderedView = params.url.view;
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
        var applicationError = helper.extend(context, output.applicationError);
        if ( CTZN.appOn.application && CTZN.appOn.application.error ) {
          listen({
            applicationError: function (emitter) {
              CTZN.appOn.application.error(e, params, applicationError, emitter);
            }
          }, function (output) {
            applicationError = helper.extend(applicationError, output.applicationError);
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
          sessionStart(helper.copy(params), helper.copy(context));
        } else {
          requestStart(helper.copy(params), helper.copy(context));
        }
      } else {
        staticPath = CTZN.config.citizen.directories.public + params.route.name;
        fs.readFile(staticPath, function (err, data) {
          if ( err ) {
            response.statusCode = 404;
            response.end();
            if ( CTZN.config.citizen.mode !== 'production' ) {
              console.log('404 Not Found: ' + params.route.name);
            }
          } else {
            response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension]);
            response.write(data);
            response.end();
            if ( CTZN.config.citizen.mode !== 'production' ) {
              console.log('200 OK: ' + params.route.name);
            }
          }
        });
      }
    });
  }).listen(CTZN.config.citizen.httpPort);
}

function sessionStart(params, context) {
  var sessionID = 0;

  if ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) {
    if ( params.cookie.ctzn_session_id && CTZN.sessions[params.cookie.ctzn_session_id] && CTZN.sessions[params.cookie.ctzn_session_id].expires > Date.now() ) {
      session.reset(params.cookie.ctzn_session_id);
      params.session = CTZN.sessions[params.cookie.ctzn_session_id];
      requestStart(helper.copy(params), helper.copy(context));
    } else {
      sessionID = session.create();
      context.cookie.ctzn_session_id = {
        value: sessionID
      };
      params.cookie.ctzn_session_id = sessionID;
      params.session = CTZN.sessions[sessionID];
      listen({
        sessionStart: function (emitter) {
          CTZN.on.session.start(helper.copy(params), helper.copy(context), emitter);
        }
      }, function (output) {
        var sessionStart = helper.extend(context, output.sessionStart);
        if ( CTZN.appOn.session && CTZN.appOn.session.start ) {
          listen({
            sessionStart: function (emitter) {
              CTZN.appOn.session.start(helper.copy(params), helper.copy(sessionStart), emitter);
            }
          }, function (output) {
            sessionStart = helper.extend(sessionStart, output.sessionStart);
            requestStart(helper.copy(params), helper.copy(sessionStart));
          });
        } else {
          requestStart(helper.copy(params), helper.copy(sessionStart));
        }
      });
    }
  } else {
    requestStart(params, context);
  }
}

function requestStart(params, context) {
  listen({
    requestStart: function (emitter) {
      CTZN.on.request.start(helper.copy(params), helper.copy(context), emitter);
    }
  }, function (output) {
    var requestStart = helper.extend(context, output.requestStart);
    if ( CTZN.appOn.request && CTZN.appOn.request.start ) {
      listen({
        requestStart: function (emitter) {
          CTZN.appOn.request.start(helper.copy(params), helper.copy(requestStart), emitter);
        }
      }, function (output) {
        requestStart = helper.extend(requestStart, output.requestStart);
        processRequest(helper.copy(params), helper.copy(requestStart));
      });
    } else {
      processRequest(helper.copy(params), helper.copy(requestStart));
    }
  });
}

function processRequest(params, context) {
  var controller = CTZN.patterns.controllers[params.route.name],
      body = '',
      respond = true;

  // If a redirect is specified, do it immediately rather than firing the controller.
  if ( context.redirect.url ) {
    params.response.writeHead(context.redirect.statusCode || 302, {
      'Location': context.redirect.url
    });
    params.response.end(responseEnd(helper.copy(params), helper.copy(context)));
  } else if ( controller ) {
    // If the Origin header exists and it's not the host, check if it's allowed. If so,
    // set the response header to match the request header (per W3C recs). If not, end the response.
    if ( params.request.headers.origin && !params.request.headers.origin.search(params.request.headers.host) ) {
      if ( controller.access && controller.access['Access-Control-Allow-Origin'] ) {
        if ( controller.access['Access-Control-Allow-Origin'].search(params.request.headers.origin) >= 0 || controller.access['Access-Control-Allow-Origin'] === '*' ) {
          if ( params.request.method === 'OPTIONS' && !params.request.headers['access-control-request-method'] ) {
            respond = false;
            params.response.end(responseEnd(helper.copy(params), helper.copy(context)));
          } else {
            for ( var property in controller.access ) {
              params.response.setHeader(property, controller.access[property]);
            }
            params.response.setHeader('Access-Control-Allow-Origin', params.request.headers.origin);
          }
        } else {
          respond = false;
          params.response.end(responseEnd(helper.copy(params), helper.copy(context)));
        }
      } else {
        respond = false;
        params.response.end(responseEnd(helper.copy(params), helper.copy(context)));
      }
    }

    if ( respond ) {
      switch ( params.request.method ) {
        case 'GET':
          listen({
            requestEnd: function (emitter) {
              CTZN.on.request.end(helper.copy(params), helper.copy(context), emitter);
            }
          }, function (output) {
            var requestEnd = helper.extend(context, output.requestEnd);
            if ( CTZN.appOn.request && CTZN.appOn.request.end ) {
              listen({
                requestEnd: function (emitter) {
                  CTZN.appOn.request.end(helper.copy(params), helper.copy(requestEnd), emitter);
                }
              }, function (output) {
                requestEnd = helper.extend(requestEnd, output.requestEnd);
                responseStart(controller, params, requestEnd);
              });
            } else {
              responseStart(controller, params, requestEnd);
            }
          });
          break;
        case 'PUT':
          // params.route.action = 'form';
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
        case 'POST':
          params.route.action = 'form';
          params.request.on('data', function (chunk) {
            body += chunk.toString();
          });
          params.request.on('end', function () {
            params.form = querystring.parse(body);
            // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
            responseStart(controller, params, context);
          });
          break;
        case 'HEAD':
        case 'OPTIONS':
          params.response.end();
          break;
      }
    }
  } else {
    params.response.writeHead(404, {
      'Location': 'http://' + params.request.headers.host + CTZN.config.citizen.urlPaths.fileNotFound
    });
    params.response.write();
    params.response.end(responseEnd(helper.copy(params), helper.copy(context)));
  }
}

function responseStart(controller, params, context) {
  listen({
    responseStart: function (emitter) {
      CTZN.on.response.start(helper.copy(params), helper.copy(context), emitter);
    }
  }, function (output) {
    var responseStart = helper.extend(context, output.responseStart);
    if ( CTZN.appOn.response && CTZN.appOn.response.start ) {
      listen({
        responseStart: function (emitter) {
          CTZN.appOn.response.start(helper.copy(params), helper.copy(responseStart), emitter);
        }
      }, function (output) {
        responseStart = helper.extend(responseStart, output.responseStart);
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
        controller.handler(helper.copy(params), helper.copy(context), emitter);
      }
    }, function (output) {
      var requestContext = helper.extend(context, output.pattern),
          handoff = helper.copy(requestContext.handoff),
          handoffController = {},
          handoffParams = {},
          viewContext = helper.extend(requestContext.content, params),
          include = requestContext.include || {},
          includeGroup = {},
          cookie = [],
          renderer = handoff.controller || params.route.renderer,
          renderedView = handoff.view || renderer,
          contentType;

      delete requestContext.handoff;

      // If sessions are enabled, the request is from the local host, and set.session has
      // properties, merge those properties with the existing session
      if ( CTZN.config.citizen.sessions && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && Object.getOwnPropertyNames(requestContext.session).length > 0 ) {
        if ( requestContext.session.expires && requestContext.session.expires === 'now' ) {
          session.end(params.session.id);
          requestContext.cookie = helper.extend(requestContext.cookie, { ctzn_session_id: { expires: 'now' }});
          sessionEnd(helper.copy(params), helper.copy(requestContext));
        } else {
          CTZN.sessions[params.session.id] = helper.extend(CTZN.sessions[params.session.id], requestContext.session);
        }
      }

      cookie = buildCookie(requestContext.cookie);
      if ( cookie.length ) {
        params.response.setHeader('Set-Cookie', cookie);
      }

      if ( requestContext.redirect.url ) {
        params.response.writeHead(requestContext.redirect.statusCode || 302, {
          'Location': requestContext.redirect.url
        });
      }

      if ( handoff.controller ) {
        handoffController = CTZN.patterns.controllers[handoff.controller.replace('/-/g', '_')];
        handoffParams = helper.extend(params, { route: { renderer: renderer, renderedView: renderedView }});
        fireController(handoffController, handoffParams, helper.copy(requestContext));
      } else {
        if ( Object.getOwnPropertyNames(include).length > 0 && params.url.type !== 'ajax' ) {
          for ( var property in include ) {
            if ( include.hasOwnProperty(property) ) {
              includeGroup[property] = function (emitter) {
                CTZN.patterns.controllers[property].handler(helper.copy(params), helper.copy(requestContext), emitter);
              };
            }
          }
          listen(includeGroup, function (output) {
            viewContext.include = {};
            for ( var property in include ) {
              if ( include.hasOwnProperty(property) ) {
                viewContext.include[property] = renderView(property, include[property], params.route.format, helper.extend(viewContext, output[property]));
              }
            }
            if ( params.route.name !== params.route.renderer ) {
              viewContext.include._main = renderView(params.route.name, params.route.view, params.route.format, viewContext);
            }
            respond(params, requestContext, viewContext, renderer, renderedView);
          });
        } else {
          respond(params, requestContext, viewContext, renderer, renderedView);
        }
      }
    });
  });
}

function respond(params, requestContext, viewContext, renderer, renderedView) {
  var contentType;

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html';
      break;
    case 'json':
    case 'JSON':
      contentType = 'application/json';
      // If the output is JSON, pass the raw content to the view renderer
      viewContext = requestContext;
      break;
    case 'jsonp':
    case 'JSONP':
      contentType = 'text/javascript';
      // If the output is JSONP, pass the raw content to the view renderer
      viewContext.content = requestContext.content;
      break;
  }
  if ( !requestContext.redirect.url ) {
    params.response.setHeader('Content-Type', contentType);
  }
  // If debugging is enabled, append the debug output to viewContext
  if ( CTZN.config.citizen.mode === 'debug' || ( CTZN.config.citizen.mode === 'development' && params.url.debug ) ) {
    viewContext.debugOutput = debug(requestContext, params);
  }
  params.response.write(renderView(renderer, renderedView, params.route.format, viewContext));
  params.response.end(responseEnd(helper.copy(params), helper.copy(requestContext)));
}

function responseEnd(params, context) {
  listen({
    responseEnd: function (emitter) {
      CTZN.on.response.end(helper.copy(params), helper.copy(context), emitter);
    }
  }, function (output) {
    var responseEnd = helper.extend(context, output.responseEnd);
    if ( CTZN.appOn.response && CTZN.appOn.response.end ) {
      listen({
        responseEnd: function (emitter) {
          CTZN.appOn.response.end(helper.copy(params), helper.copy(responseEnd), emitter);
        }
      }, function (output) {
        responseEnd = helper.extend(responseEnd, output.responseEnd);
      });
    }
  });
}

function sessionEnd(params, context) {
  listen({
    sessionEnd: function (emitter) {
      CTZN.on.session.end(helper.copy(params), helper.copy(context), emitter);
    }
  }, function (output) {
    var sessionEnd = helper.extend(context, output.sessionEnd);
    if ( CTZN.appOn.session && CTZN.appOn.session.end ) {
      listen({
        sessionEnd: function (emitter) {
          CTZN.appOn.session.end(helper.copy(params), helper.copy(sessionEnd), emitter);
        }
      }, function (output) {
        sessionEnd = helper.extend(sessionEnd, output.sessionEnd);
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
  switch ( CTZN.config.citizen.mode ) {
    case 'production':
      switch ( e.code ) {
        case 'MODULE_NOT_FOUND':
          response.writeHead(404, {
            'Location': request.headers.host + CTZN.config.citizen.paths.fileNotFound
          });
          break;
        default:
          // TODO: friendly error page
          // response.writeHead(302, {
          //   'Location': request.headers.host + '/error/code/' + e.code
          // });
          response.statusCode = 500;
          if ( e.stack ) {
            response.write(e.stack);
          } else {
            response.write(e);
          }
      }
      response.end();
      break;
    case 'development':
    case 'debug':
      console.log(util.inspect(e));
      response.statusCode = 500;
      if ( e.stack ) {
        response.write(e.stack);
      } else {
        response.write(e);
      }
      response.end();
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
    cookie = helper.extend(defaults, cookies[property]);
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

function renderView(pattern, view, format, context) {
  var viewOutput = '',
      callbackRegex;

  switch ( format ) {
    case 'html':
    case 'HTML':
      switch ( CTZN.config.citizen.mode ) {
        case 'production':
          switch ( CTZN.patterns.views[pattern][view].engine ) {
            case 'handlebars':
              viewOutput = CTZN.patterns.views[pattern][view].compiled(context, {});
              break;
            case 'jade':
              viewOutput = CTZN.patterns.views[pattern][view].compiled(context, { compileDebug: false });
              break;
            case 'html':
              viewOutput = CTZN.patterns.views[pattern][view].raw;
              break;
          }
          break;
        case 'debug':
        case 'development':
          switch ( CTZN.patterns.views[pattern][view].engine ) {
            case 'handlebars':
              viewOutput = fs.readFileSync(CTZN.config.citizen.directories.views + '/' + pattern + '/' + view + '.hbs', { 'encoding': 'utf8' });
              viewOutput = CTZN.handlebars.compile(viewOutput);
              viewOutput = viewOutput(context, {});
              break;
            case 'jade':
              viewOutput = fs.readFileSync(CTZN.config.citizen.directories.views + '/' + pattern + '/' + view + '.jade', { 'encoding': 'utf8' });
              viewOutput = CTZN.jade.compile(viewOutput);
              viewOutput = viewOutput(context, {});
              break;
            case 'html':
              viewOutput = fs.readFileSync(CTZN.config.citizen.directories.views + '/' + pattern + '/' + view + '.html', { 'encoding': 'utf8' });
              break;
          }
          if ( context.debugOutput ) {
            viewOutput = viewOutput.replace('</body>', '<div id="citizen-debug"><pre>' + context.debugOutput + '</pre></div></body>');
          }
          break;
      }
      break;
    case 'json':
    case 'JSON':
      viewOutput = JSON.stringify(context.content);
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
}
