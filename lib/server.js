// server

'use strict';

var // Native Node.js modules
    domain = require('domain'),
    events = require('events'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    path = require('path'),
    querystring = require('querystring'),
    util = require('util'),
    zlib = require('zlib'),
    
    // Third party modules
    formidable = require('formidable'),
    
    // citizen modules
    cache = require('./cache'),
    helpers = require('./helpers'),
    router = require('./router'),
    session = require('./session'),
    server = new events.EventEmitter();

    cache = helpers.extend(cache.public, cache.citizen);
    session = helpers.extend(session.public, session.citizen);

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



server.on('error', function (err, params, context) {
  var statusCode = err.statusCode ? err.statusCode : 500,
      errorView = 'error';

  context.content = context.content || {};

  helpers.log({
    type: 'error',
    label: err.stack ? '' : err.message ? err.message : '',
    content: err.stack ? err.stack : err,
    toConsole: CTZN.config.citizen.log.toConsole && CTZN.config.citizen.log.application.errors,
    toFile: CTZN.config.citizen.log.toFile && CTZN.config.citizen.log.application.errors,
    file: 'citizen.txt'
  });

  if ( params && !params.response.headersSent ) {
    params.response.statusCode = statusCode;

    switch ( params.route.format ) {
      case 'html':
        params.response.setHeader('Content-Type', 'text/html');
        switch ( CTZN.config.citizen.mode ) {
          case 'production':
            if ( CTZN.patterns.views.error ) {
              if ( CTZN.patterns.views.error[err.code] ) {
                errorView = err.code;
              } else if ( CTZN.patterns.views.error[statusCode] ) {
                errorView = statusCode;
              }

              context.content.error = {
                raw: err,
                inspect: util.inspect(err)
              };

              params.response.write(renderView('error', errorView, 'html', helpers.extend(context.content, params)));
            } else {
              if ( err.stack ) {
                params.response.write('<pre><code>' + err.stack + '</code></pre>');
              } else {
                params.response.write('<pre><code>' + util.inspect(err) + '</code></pre>');
              }
            }
            break;
          case 'development':
          case 'debug':
            if ( err.stack ) {
              params.response.write('<pre><code>' + err.stack + '</code></pre>');
            } else {
              params.response.write('<pre><code>' + util.inspect(err) + '</code></pre>');
            }
            break;
        }
        break;
      case 'json':
      case 'jsonp':
        context.content = context.error || err;
        if ( !params.url.output ) {
          context = context.content;
        } else {
          context = createJSON(params, context);
        }
        params.response.setHeader('Content-Type', params.route.format === 'json' ? 'application/json' : 'text/javascript');
        params.response.write(renderView('', '', params.route.format, context, params.url.callback));
        break;
    }

    params.response.end();
  }

});



server.on('sessionStart', function (params, context) {
  var sessionID = 0;

  if ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) {
    if ( params.cookie.ctzn_sessionID && CTZN.sessions[params.cookie.ctzn_sessionID] && CTZN.sessions[params.cookie.ctzn_sessionID].expires > Date.now() ) {
      session.reset(params.cookie.ctzn_sessionID);
      params.session = helpers.copy(CTZN.sessions[params.cookie.ctzn_sessionID]);
      server.emit('requestStart', params, context);
    } else {
      sessionID = session.create();
      if ( !context.cookie ) {
        context.cookie = {};
      }
      context.cookie.ctzn_sessionID = {
        value: sessionID
      };
      params.cookie.ctzn_sessionID = sessionID;
      params.session = helpers.copy(CTZN.sessions[sessionID]);

      helpers.listen({
        sessionStart: function (emitter) {
          CTZN.on.session.start(params, context, emitter);
        }
      }, function (output) {

        if ( output.listen.success ) {

          context = helpers.extend(context, output.sessionStart);

          if ( CTZN.appOn.session && CTZN.appOn.session.start ) {

            helpers.listen({
              sessionStart: function (emitter) {
                CTZN.appOn.session.start(params, context, emitter);
              }
            }, function (output) {

              if ( output.listen.success ) {
                context = helpers.extend(context, output.sessionStart);
                server.emit('requestStart', params, context);
              } else {
                server.emit('error', output.listen, params, context);
              }

            });

          } else {
            server.emit('requestStart', params, context);
          }

        } else {
          server.emit('error', output.listen, params, context);
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

    if ( output.listen.success ) {

      context = helpers.extend(context, output.requestStart);
      setSession(params, context);

      if ( CTZN.appOn.request && CTZN.appOn.request.start ) {

        helpers.listen({
          requestStart: function (emitter) {
            CTZN.appOn.request.start(params, context, emitter);
          }
        }, function (output) {

          if ( output.listen.success ) {

            context = helpers.extend(context, output.requestStart);
            setSession(params, context);
            processRequest(params, context);

          } else {
            server.emit('error', output.listen, params, context);
          }

        });

      } else {
        processRequest(params, context);
      }

    } else {
      server.emit('error', output.listen, params, context);
    }

  });

});



server.on('responseEnd', function (params, context) {

  helpers.listen({
    responseEnd: function (emitter) {
      CTZN.on.response.end(params, context, emitter);
    }
  }, function (output) {

    if ( output.listen.success ) {

      context = helpers.extend(context, output.responseEnd);

      if ( CTZN.appOn.response && CTZN.appOn.response.end ) {

        helpers.listen({
          responseEnd: function (emitter) {
            CTZN.appOn.response.end(params, context, emitter);
          }
        }, function (output) {

          if ( output.listen.success ) {

            context = helpers.extend(context, output.responseEnd);

            if ( CTZN.config.citizen.mode === 'debug' ) {
              debugger;
            }

          } else {
            server.emit('error', output.listen, params, context);
          }

        });

      }

      if ( CTZN.config.citizen.mode === 'debug' ) {
        debugger;
      }

    } else {
      server.emit('error', output.listen, params, context);
    }

  });

});



server.on('sessionEnd', function (params, context) {

  helpers.listen({
    sessionEnd: function (emitter) {
      CTZN.on.session.end(params, context, emitter);
    }
  }, function (output) {

    if ( output.listen.success ) {

      context = helpers.extend(context, output.sessionEnd);

      if ( CTZN.appOn.session && CTZN.appOn.session.end ) {

        helpers.listen({
          sessionEnd: function (emitter) {
            CTZN.appOn.session.end(params, context, emitter);
          }
        }, function (output) {

          if ( output.listen.success ) {

            context = helpers.extend(context, output.sessionEnd);

          } else {
            server.emit('error', output.listen, params, context);
          }

        });

      }

    } else {
      server.emit('error', output.listen, params, context);
    }

  });

});



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

    if ( output.listen.success ) {

      var routeCache = cache.get({ scope: 'routes', key: params.route.pathname });

      context = helpers.extend(context, output.responseStart);

      if ( CTZN.appOn.response && CTZN.appOn.response.start ) {
        helpers.listen({
          responseStart: function (emitter) {
            CTZN.appOn.response.start(params, context, emitter);
          }
        }, function (output) {

          if ( output.listen.success ) {

            context = helpers.extend(context, output.responseStart);

            setSession(params, context);

            if ( routeCache ) {
              setCookie(params, context);

              params.response.setHeader('Cache-Control', routeCache.cacheControl);
              params.response.setHeader('ETag', routeCache.lastModified);

              if ( params.request.headers['if-none-match'] === routeCache.lastModified ) {
                params.response.setHeader('Date', routeCache.lastModified);
                params.response.statusCode = 304;
              } else {
                params.response.setHeader('Content-Type', routeCache.contentType);
                params.response.setHeader('Content-Encoding', params.client.encoding);
                params.response.write(routeCache.view[params.client.encoding]);
              }
              params.response.end();
              server.emit('responseEnd', params, context);
            } else {
              fireController(params, context);
            }

          } else {
            server.emit('error', output.listen, params, context);
          }

        });
      } else {
        setSession(params, context);

        if ( routeCache ) {
          setCookie(params, context);

          params.response.setHeader('Cache-Control', routeCache.cacheControl);
          params.response.setHeader('ETag', routeCache.lastModified);

          if ( params.request.headers['if-none-match'] === routeCache.lastModified ) {
            params.response.setHeader('Date', routeCache.lastModified);
            params.response.statusCode = 304;
          } else {
            params.response.setHeader('Content-Type', routeCache.contentType);
            params.response.setHeader('Content-Encoding', params.client.encoding);
            params.response.write(routeCache.view[params.client.encoding]);
          }
          params.response.end();
          server.emit('responseEnd', params, context);
        } else {
          fireController(params, context);
        }
      }

    } else {
      server.emit('error', output.listen, params, context);
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
        client: {
          encoding: CTZN.config.citizen.gzip.force ? 'gzip' : 'identity'
        },
        config: CTZN.config
      },
      requestDomain = domain.create();

  requestDomain.add(params);
  requestDomain.add(request);
  requestDomain.add(response);
  requestDomain.add(context);

  requestDomain.on('error', function (err, params, context) {
    if ( !err.staticAsset ) {
      helpers.listen({
        applicationError: function (emitter) {
          CTZN.on.application.error(err, params, context, emitter);
        }
      }, function (output) {

        if ( output.listen.success ) {

          context = helpers.extend(context, output.applicationError);

          if ( CTZN.appOn.application && CTZN.appOn.application.error ) {

            helpers.listen({
              applicationError: function (emitter) {
                CTZN.appOn.application.error(err, params, context, emitter);
              }
            }, function (output) {

              if ( output.listen.success ) {

                context = helpers.extend(context, output.applicationError);
                server.emit('error', err, params, context);

              } else {
                server.emit('error', output.listen, params, context);
              }

            });

          } else {
            server.emit('error', err, params, context);
          }

        } else {
          server.emit('error', output.listen, params, context);
        }

      });
    } else {
      params.response.statusCode = err.statusCode || 500;
      params.response.end();

      if ( CTZN.config.citizen.log.static.errors || CTZN.config.citizen.mode === 'debug' ) {
        helpers.log({
          type: 'error',
          label: err.statusCode + ' ' + http.STATUS_CODES[err.statusCode],
          content: err.file || err.message || err,
          toConsole: CTZN.config.citizen.log.toConsole,
          toFile: CTZN.config.citizen.log.toFile,
          file: 'citizen.txt'
        });
      }
    }
  });

  requestDomain.run( function () {
    var acceptEncoding,
        encoding,
        staticPath,
        cachedFile = false,
        lastModified;

    // Determine client gzip support. Can be forced via config.citizen.gzip.force
    if ( !params.client.gzip && params.request.headers['accept-encoding'] ) {
      acceptEncoding = params.request.headers['accept-encoding'].split(', ');

      for ( var i = 0; i < acceptEncoding.length; i++ ) {
        encoding = acceptEncoding[i].split(';');

        if ( encoding[0] === 'gzip' ) {
          if ( !encoding[1] || +querystring.parse(encoding[1]).q > 0 ) {
            params.client.encoding = 'gzip';
          }
          break;
        }
      }
    }

    response.setHeader('X-Powered-By', 'citizen');

    // If it's a dynamic page request, emit the sessionStart or requestStart event.
    // Otherwise, serve the static asset.
    if ( !params.route.isStatic ) {
      params.url = router.getUrlParams(request.url);

      // Overwrite the default route parameters with URL parameters if they exist
      params.route.action = params.url.action || params.route.action;
      params.route.ajax = params.url.ajax === 'true' || params.request.headers['x-requested-with'] === 'XMLHttpRequest' ? true : params.route.ajax;
      params.route.type = params.url.type || params.route.type;
      params.route.format = params.url.format || params.route.format;
      params.route.format = params.route.format.toLowerCase();
      params.route.show = params.url.show || params.route.show;

      if ( CTZN.patterns.controllers[CTZN.config.citizen.fallbackController || params.route.controller] && CTZN.patterns.controllers[CTZN.config.citizen.fallbackController || params.route.controller][params.route.action] ) {
        if ( CTZN.config.citizen.sessions ) {
          server.emit('sessionStart', params, context);
        } else {
          server.emit('requestStart', params, context);
        }
      } else {
        var error = {
              statusCode: 404,
              stack: new Error('404 - The requested route doesn\'t exist.\n\nURL: ' + params.route.url + '\n\nController: ' + params.route.controller + '\nAction: ' + params.route.action + '()\n\n\n').stack
            };

        requestDomain.emit('error', error, params, context);
      }
    } else {
      staticPath = CTZN.config.citizen.directories.web + params.route.filePath;

      response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension]);
      response.setHeader('Cache-Control', CTZN.config.citizen.cache.control[params.route.pathname] || 'max-age=0' );

      if ( CTZN.config.citizen.cache.static ) {
        cachedFile = cache.get({ file: staticPath, output: 'all' });
      }

      if ( cachedFile ) {
        lastModified = cachedFile.stats.mtime.toISOString();

        response.setHeader('ETag', lastModified);

        if ( request.headers['if-none-match'] === lastModified ) {
          response.setHeader('Date', lastModified);
          response.statusCode = 304;
        } else {
          if ( CTZN.config.citizen.gzip.enable && params.client.encoding === 'gzip' && cachedFile.value.gzip ) {
            response.setHeader('Content-Encoding', 'gzip');
            response.write(cachedFile.value.gzip);
          } else {
            response.write(cachedFile.value.identity);
          }
        }

        response.end();

        helpers.log({
          label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode],
          content: params.route.filePath,
          file: 'citizen.txt'
        });

      } else {
        fs.readFile(staticPath, function (err, data) {
          if ( !err ) {
            fs.stat(staticPath, function (err, stats) {
              lastModified = stats.mtime.toISOString();

              response.setHeader('ETag', lastModified);

              if ( request.headers['if-none-match'] === lastModified ) {
                response.setHeader('Date', lastModified);
                response.statusCode = 304;
                response.end();
              } else {
                if ( CTZN.config.citizen.gzip.enable && CTZN.config.citizen.gzip.mimeTypes.indexOf(CTZN.config.citizen.mimetypes[params.route.extension]) >= 0 ) {
                  zlib.gzip(data, function (err, zippedFile) {
                    if ( params.client.encoding === 'gzip' ) {
                      response.setHeader('Content-Encoding', 'gzip');
                      response.write(zippedFile);
                    } else {
                      response.write(data);
                    }
                    response.end();

                    if ( CTZN.config.citizen.cache.static ) {
                      cache.set({
                        file: staticPath,
                        value: {
                          identity: data,
                          gzip: zippedFile
                        },
                        stats: stats
                      });
                    }
                  });
                } else {
                  response.write(data);
                  response.end();

                  if ( CTZN.config.citizen.cache.static ) {
                    cache.set({
                      file: staticPath,
                      value: {
                        identity: data
                      },
                      stats: stats
                    });
                  }
                }
              }

              helpers.log({
                label: response.statusCode + ' ' + http.STATUS_CODES[response.statusCode],
                content: params.route.filePath,
                file: 'citizen.txt'
              });
            });
          } else {
            var error = {
                  statusCode: 404,
                  staticAsset: true,
                  file: params.route.filePath,
                  stack: new Error('404 Not Found: '+ params.route.filePath).stack
                };

            requestDomain.emit('error', error, params, context);
          }
        });
      }

    }
  });
}



function setSession(params, context, system) {
  if ( CTZN.config.citizen.sessions && context.session && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && helpers.size(context.session) ) {
    if ( context.session.expires && context.session.expires === 'now' ) {
      session.end(params.session.id);
      context.cookie = helpers.extend(context.cookie, { ctzn_sessionID: { expires: 'now' }});
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
      formParser,
      body = '',
      respond = true;

  // If a previous event in the request context requested a redirect, do it immediately rather than firing the controller.
  if ( context.redirect && ( typeof context.redirect === 'string' || helpers.size(context.redirect) ) && params.route.type !== 'direct' ) {
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

            if ( output.listen.success ) {

              context = helpers.extend(context, output.requestEnd);
              setSession(params, context);

              if ( CTZN.appOn.request && CTZN.appOn.request.end ) {

                helpers.listen({
                  requestEnd: function (emitter) {
                    CTZN.appOn.request.end(params, context, emitter);
                  }
                }, function (output) {

                  if ( output.listen.success ) {

                    context = helpers.extend(context, output.requestEnd);
                    setSession(params, context);
                    server.emit('responseStart', params, context);

                  } else {
                    server.emit('error', output.listen, params, context);
                  }

                });

              } else {
                server.emit('responseStart', params, context);
              }

            } else {
              server.emit('error', output.listen, params, context);
            }

          });
          break;
        case 'POST':
          formParser = new formidable.IncomingForm();

          formParser = helpers.extend(formParser, CTZN.config.citizen.forms);

          formParser.parse(params.request, function (err, fields, files) {
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
        case 'PATCH':
        case 'DELETE':
          switch ( params.request.headers['content-type'] ) {
            default:
              params.request.on('data', function (chunk) {
                body += chunk.toString();
              });
              params.request.on('end', function () {
                try {
                  params.payload = JSON.parse(body);
                } catch ( err ) {
                  throw new Error('You didn\'t specify a valid Content-Type for your payload, so we tried to parse it as JSON, but failed. If it is JSON, it\'s probably not formatted correctly. If it\'s another format, please specify a Content-Type header in your request. Valid Content-Type headers are "application/json", "application/x-www-form-urlencoded", or "multipart/form-data".');
                }
                helpers.log({
                  label: 'Payload received and parsed',
                  content: params.payload
                });
                server.emit('responseStart', params, context);
              });
              break;
            case 'application/json':
              params.request.on('data', function (chunk) {
                body += chunk.toString();
              });
              params.request.on('end', function () {
                try {
                  params.payload = JSON.parse(body);
                } catch ( err ) {
                  throw new Error('Failed to parse the JSON payload. The payload probably isn\'t formatted correctly.');
                }
                helpers.log({
                  label: 'Payload received and parsed',
                  content: params.payload
                });
                server.emit('responseStart', params, context);
              });
              break;
            case 'application/x-www-form-urlencoded':
            case 'multipart/form-data':
              formParser = new formidable.IncomingForm();

              formParser = helpers.extend(formParser, CTZN.config.citizen.forms);

              formParser.parse(params.request, function (err, fields, files) {
                if ( !err ) {
                  params.payload = helpers.extend(fields, files);
                  helpers.log({
                    label: 'Payload received and parsed',
                    content: {
                      fields: fields,
                      files: files
                    }
                  });
                  server.emit('responseStart', params, context);
                } else {
                  throw new Error('Failed to parse the JSON payload. It\'s probable the payload isn\'t properly formatted.');
                }
              });
              break;
          }
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



function fireController(params, context) {
  var responseDomain = domain.create();

  responseDomain.on('error', function (err) {
    server.emit('error', err, params, context);
  });

  responseDomain.add(params);
  responseDomain.add(context);

  responseDomain.run( function () {
    var controller = context.handoffController || params.route.controller,
        action = context.handoffAction || params.route.action,
        view = context.handoffView || context.view || params.route.view;

    helpers.listen({
      pattern: function (emitter) {
        var cachedController = cache.getController({ controller: controller, action: action, view: view, route: params.route.pathname }) || cache.getController({ controller: controller, action: action, view: view, route: 'global' });

        helpers.log({
          label: 'Firing controller',
          content: {
            controller: controller,
            action: action,
            view: view
          }
        });

        if ( cachedController ) {
          emitter.emit('ready', cachedController.context);
        } else {
          CTZN.patterns.controllers[controller][action](params, context, emitter);
        }
      }
    }, function (output) {
      var include = {},
          includeProperties,
          includeGroup = {};

      // If inherit is specified in a handoff, the existing context takes precedence over the pattern's output
      if ( !context.handoff || context.handoff && !context.handoff.inherit ) {
        context = helpers.extend(context, output.pattern);
      } else {
        context = helpers.extend(output.pattern, context);
      }
      // context = helpers.extend(context, output.pattern);
      
      include = context.include || include;

      params.route.view = context.view || params.route.view;
      params.route.renderedView = context.view || params.route.renderedView;
      if ( context.view ) {
        params.route.chain[params.route.chain.length-1].view = params.route.view;
        params.route.chain[params.route.chain.length-1].action = context.handoffAction || params.route.action;
      }
      // If it exists, the calling controller's handoff view takes precedence over the receiving controller's view
      if ( context.handoffView ) {
        context.view = context.handoffView;
      }
      context.content = context.content || {};
      if ( !context.handoff && CTZN.config.citizen.layout.controller.length && controller !== CTZN.config.citizen.layout.controller ) {
        context.handoff  = CTZN.config.citizen.layout;
      }
      delete context.handoffController;
      delete context.handoffView;
      delete context.handOffAction;

      if ( output.listen.success && !params.response.headersSent ) {

        for ( var property in context.content ) {
          if ( context.content.hasOwnProperty(property) && CTZN.reserved.content.indexOf(property) >= 0 ) {
            throw new Error('"' + property + '" is a reserved content variable name used internally by citizen. Please choose a different variable name.');
          }
        }

        setSession(params, context);

        if ( context.redirect && ( typeof context.redirect === 'string' || ( helpers.size(context.redirect) && typeof context.redirect.refresh === 'undefined' ) ) && params.route.type !== 'direct' ) {
          setCookie(params, context);
          redirect(params, context);

          cacheController({
            controller: controller,
            action: action,
            view: params.route.renderedView,
            route: params.route.pathname,
            context: context,
            format: params.route.format,
            params: params
          });
        } else {
          if ( context.redirect && ( typeof context.redirect === 'string' || helpers.size(context.redirect) ) && params.route.type !== 'direct' ) {
            redirect(params, context);
          }
          includeProperties = Object.getOwnPropertyNames(include);
          if ( includeProperties.length && params.route.format === 'html' ) {
            includeProperties.forEach( function (item, index, array) {

              include[item].params = helpers.copy(params);

              if ( !include[item].route ) {
                include[item].action = include[item].action || 'handler';
                include[item].view = include[item].view || include[item].controller;
                include[item].pathname = params.route.pathname;
              } else {
                include[item].params.route = router.getRoute(include[item].params.route.parsed.protocol + '//' + include[item].params.request.headers.host + include[item].route);
                include[item].params.url = router.getUrlParams(include[item].route);

                // Overwrite the default route parameters with URL parameters if they exist
                include[item].params.route.action = include[item].params.url.action || include[item].params.route.action;
                include[item].params.route.type = include[item].params.url.type || include[item].params.route.type;
                include[item].params.route.format = include[item].params.url.format || include[item].params.route.format;
                include[item].params.route.format = include[item].params.route.format.toLowerCase();
                include[item].params.route.show = include[item].params.url.show || include[item].params.route.show;

                include[item].controller = include[item].params.route.controller;
                include[item].action = include[item].params.route.action;
                include[item].view = include[item].view || include[item].controller;
                include[item].pathname = include[item].params.route.pathname;
              }

              include[item].cache = cache.getController({ controller: include[item].controller, action: include[item].action, view: include[item].view, route: include[item].pathname }) || cache.getController({ controller: include[item].controller, action: include[item].action, view: include[item].view, route: 'global' });

              includeGroup[item] = function (emitter) {
                if ( include[item].cache ) {
                  emitter.emit('ready', include[item].cache.context);
                } else {
                  CTZN.patterns.controllers[include[item].controller][include[item].action](include[item].params, context, emitter);
                }
              };
            });

            if ( helpers.size(includeGroup) ) {
              context.content.include = context.content.include || {};

              helpers.listen(includeGroup, function (output) {

                if ( output.listen.success ) {

                  includeProperties.forEach( function (item, index, array) {

                    if ( include[item].cache ) {
                      context.content.include[item] = include[item].cache.render;
                      helpers.log({
                        label: 'Using cached include ' + item,
                        content: {
                          controller: include[item].controller,
                          action: include[item].action,
                          view: include[item].view
                        },
                        file: 'citizen.txt'
                      });
                    } else {
                      include[item].context = output[item] || {};

                      switch ( include[item].params.route.format ) {
                        case 'html':
                          include[item].viewContext = helpers.extend(include[item].context.content, include[item].params);
                          break;
                        // If the output is JSON, pass the raw content to the view renderer
                        case 'json':
                        case 'jsonp':
                          if ( !include[item].params.url.output ) {
                            include[item].viewContext = include[item].context.content;
                          } else {
                            include[item].viewContext = createJSON(include[item].params, include[item].context);
                          }
                          break;
                      }

                      include[item].render = renderView(include[item].controller, include[item].view, include[item].params.route.format, include[item].viewContext, include[item].params.url.callback);
                      context.content.include[item] = include[item].render;
                      helpers.log({
                        label: 'Rendering include ' + item,
                        content: {
                          controller: include[item].controller,
                          action: include[item].action,
                          view: include[item].view
                        },
                        file: 'citizen.txt'
                      });

                      cacheController({
                        controller: include[item].controller,
                        action: include[item].action,
                        view: include[item].view,
                        route: include[item].params.route.pathname,
                        context: include[item].context,
                        render: include[item].render,
                        format: include[item].params.route.format,
                        params: include[item].params
                      });
                    }
                  });

                  delete context.include;

                  if ( context.handoff && params.route.type !== 'direct' ) {
                    handoff(params, context);
                  } else {
                    setCookie(params, context);
                    respond(params, context);
                  }

                } else {
                  server.emit('error', output.listen, params, context);
                }

              });
            } else {
              if ( context.handoff && params.route.type !== 'direct' ) {
                handoff(params, context);
              } else {
                setCookie(params, context);
                respond(params, context);
              }
            }

            delete context.include;

          } else {
            if ( context.handoff && params.route.type !== 'direct' ) {
              handoff(params, context);
            } else {
              setCookie(params, context);
              respond(params, context);
            }
          }
        }
      // } else {
      //   if ( !params.response.headersSent ) {
      //     output.listen.stack = output.listen.stack || new Error(output.listen.message || http.STATUS_CODES[output.listen.statusCode || 500]).stack;
      //
      //     server.emit('error', output.listen, params, context);
      //   }
      }
    });
  });
}



function redirect(params, context) {
  var url = typeof context.redirect === 'string' ? context.redirect : context.redirect.url,
      statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number';

  helpers.log({
    label: 'Redirecting',
    content: {
      url: url,
      statusCode: statusCode,
      header: refresh ? 'Refresh' : 'Location'
    }
  });

  if ( refresh ) {
    params.response.statusCode = statusCode;
    params.response.setHeader('Refresh', context.redirect.refresh + ';url=' + url);
  } else {
    if ( CTZN.config.citizen.sessions ) {
      if ( context.session ) {
        context.session.ctzn_referer = params.route.url;
      } else {
        context.session = {
          ctzn_referer: params.route.url
        };
      }
      setSession(params, context, true);
    } else {
      if ( context.cookie ) {
        context.cookie.ctzn_referer = params.route.url;
      } else {
        context.cookie = {
          ctzn_referer: params.route.url
        };
      }
      setCookie(params, context);
    }
    params.response.writeHead(statusCode, {
      'Location': url
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
    switch ( options.context.cache.controller.scope ) {
      case 'route':
        cacheExists = cache.exists({
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: options.route
        });
        break;
      case 'global':
      case undefined:
        cacheExists = cache.exists({
          controller: options.controller,
          action: options.action,
          view: options.view,
          route: 'global'
        });
        break;
    }

    if ( !cacheExists ) {
      cacheLifespan = options.context.cache.controller.lifespan || 'application';
      cacheReset = options.context.cache.controller.resetOnAccess || false;

      if ( helpers.size(options.params.url) && options.context.cache.controller.urlParams ) {
        Object.getOwnPropertyNames(options.params.url).forEach( function ( item, index, array) {
          if ( options.context.cache.controller.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            switch ( CTZN.config.citizen.cache.controller.invalidUrlParams ) {
              case 'throw':
                throw new Error('Cache attempt on ' + options.controller + ' controller failed due to an invalid URL parameter (' + item + '). Request denied.');
              default:
                helpers.log({
                  label: '*** WARNING *** - Controller cache attempt failed due to an invalid URL parameter (' + item + ')',
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
      if ( options.context.cache.controller.directives ) {
        options.context.cache.controller.directives.forEach( function (item, index, array) {
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

      switch ( options.context.cache.controller.scope ) {
        case 'route':
          cache.setController({
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
          cache.setController({
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



function handoff(params, context) {
  var thisHandoff = helpers.copy(context.handoff),
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

  if ( context.view !== false && CTZN.patterns.views[lastLink.controller][lastLink.view] ) {
    cachedController = cache.getController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: params.route.pathname }) || cache.getController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: 'global' });

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
          viewContext = helpers.extend(context.content, params);
          break;
        // If the output is JSON, pass the raw content to the view renderer
        case 'json':
        case 'jsonp':
          // Don't call createJSON() from here because it checks for the url.output
          // parameter, which will throw an error if it specifies a parameter not yet
          // added via the controller chain. Only direct controller calls (/type/direct)
          // and chained controller calls should use createJSON(), not handoff.
          viewContext = context.content;
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
        context: helpers.copy(context),
        render: lastLink.viewContent,
        format: params.route.format,
        params: params
      });
    }
  }

  handoffParams = helpers.extend(params, { route: { chain: params.route.chain.concat([{ controller: thisHandoff.controller, action: action, view: renderedView }]), renderer: renderer, renderedView: renderedView }});
  delete context.handoff;
  delete context.view;
  context.session = {};
  if ( context.cache ) {
    delete context.cache.controller;
  }
  context.handoffController = thisHandoff.controller;
  context.handoffView = thisHandoff.view || thisHandoff.controller;
  context.handoffAction = action;
  helpers.log({
    content: 'Handing off to the ' + thisHandoff.controller + ' controller',
    file: 'citizen.txt'
  });
  fireController(handoffParams, context);
}



function respond(params, context) {
  var contentType,
      viewContext,
      view,
      cacheControl = context.cache && context.cache.route && context.cache.route.control ? context.cache.route.control : CTZN.config.citizen.cache.control[params.route.pathname] || 'max-age=0',
      lastModified = context.cache && context.cache.route && context.cache.route.lastModified ? context.cache.route.lastModified : new Date().toISOString();

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html';
      viewContext = helpers.extend(context.content, params);
      if ( CTZN.config.citizen.mode === 'debug' || ( CTZN.config.citizen.mode === 'development' && params.url.ctzn_debug ) ) {
        viewContext.debugOutput = debug(params, context);
      }
      break;
    // If the output is JSON, pass the raw content to the view renderer
    case 'json':
    case 'jsonp':
      contentType = params.route.format === 'json' ? 'application/json' : 'text/javascript';

      if ( !params.url.output ) {
        viewContext = context.content;
      } else {
        viewContext = createJSON(params, context);
      }
      break;
  }

  view = renderView(params.route.renderer, params.route.renderedView, params.route.format, viewContext, params.url.callback);

  params.response.setHeader('Cache-Control', cacheControl);
  params.response.setHeader('ETag', lastModified);

  if ( CTZN.config.citizen.gzip.enable && params.client.encoding === 'gzip' ) {
    zlib.gzip(view, function (err, zippedView) {
      if ( !err ) {
        params.response.setHeader('Content-Type', contentType);
        params.response.setHeader('Content-Encoding', 'gzip');
        params.response.write(zippedView);
        params.response.end();
        server.emit('responseEnd', params, context);
        cacheResponse(params, context, view, zippedView, contentType, lastModified, cacheControl);
      } else {
        // Send the unzipped response to the client in the event of an error, but
        // still throw the error on the server side.
        params.response.setHeader('Content-Type', contentType);
        params.response.setHeader('Content-Encoding', 'identity');
        params.response.write(view);
        params.response.end();
        server.emit('responseEnd', params, context);
        cacheResponse(params, context, view, '', contentType, lastModified, cacheControl);
        throw new Error('gzip of ' + params.route.url + ' failed.');
      }
    });
  } else {
    params.response.setHeader('Content-Type', contentType);
    params.response.setHeader('Content-Encoding', 'identity');
    params.response.write(view);
    params.response.end();
    server.emit('responseEnd', params, context);
    cacheResponse(params, context, view, '', contentType, lastModified, cacheControl);
  }
}



function cacheResponse(params, context, view, zippedView, contentType, lastModified, cacheControl) {
  if ( context.cache ) {
    if ( context.cache.route && ( context.cache.route === true || helpers.size(context.cache.route) ) ) {
      if ( helpers.size(params.url) && context.cache.route.urlParams ) {
        Object.getOwnPropertyNames(params.url).forEach( function ( item, index, array) {
          if ( context.cache.route.urlParams.indexOf(item) < 0 && CTZN.reserved.url.indexOf(item) < 0 ) {
            switch ( CTZN.config.citizen.cache.invalidUrlParams ) {
              case 'throw':
                throw new Error('Route cache attempt failed due to an invalid URL parameter (' + item + '). Request denied.\n\nRoute: ' + params.route.pathname);
              default:
                helpers.log({
                  label: '*** WARNING *** - Route cache attempt failed due to an invalid URL parameter (' + item + ')',
                  content: {
                    route: params.route.pathname
                  },
                  file: 'citizen.txt'
                });
                break;
            }
          }
        });
      }

      if ( CTZN.config.citizen.gzip.enable && !zippedView.length ) {
        zlib.gzip(view, function (err, zippedView) {
          if ( !err ) {
            cache.setRoute({
              route: params.route.pathname,
              contentType: contentType,
              view: {
                raw: view,
                compressed: zippedView
              },
              lastModified: lastModified,
              cacheControl: cacheControl,
              lifespan: context.cache.route.lifespan || 'application',
              resetOnAccess: context.cache.route.resetOnAccess || false
            });
          } else {
            throw new Error('gzip of ' + params.route.url + ' failed.');
          }
        });
      } else {
        cache.setRoute({
          route: params.route.pathname,
          contentType: contentType,
          view: {
            raw: view,
            compressed: zippedView
          },
          lastModified: lastModified,
          cacheControl: cacheControl,
          lifespan: context.cache.route.lifespan || 'application',
          resetOnAccess: context.cache.route.resetOnAccess || false
        });
      }

    }

    if ( context.cache.controller && ( context.cache.controller === true || helpers.size(context.cache.controller) ) ) {
      cacheController({
        controller: params.route.chain[params.route.chain.length-1].controller,
        action: params.route.chain[params.route.chain.length-1].action,
        view: params.route.chain[params.route.chain.length-1].view,
        route: params.route.pathname,
        context: context,
        render: view,
        format: params.route.format,
        params: params
      });
    }
  }
}



function createJSON(params, context) {
  var outputArray,
      outputNode,
      output = {};

  outputArray = params.url.output.split(CTZN.config.citizen.format[params.route.format].urlDelimiter);

  if ( context.content[decodeURIComponent(outputArray[0])] ) {
    output = context.content[decodeURIComponent(outputArray[0])];

    for ( var i = 1; i < outputArray.length; i++ ) {
      outputNode = decodeURIComponent(outputArray[i]);

      if ( output[outputNode] ) {
        output = output[outputNode];
      } else {
        throwError();
      }
    }

    return output;

  } else {
    throwError();
  }

  function throwError() {
    var error = {
          statusCode: 404,
          staticAsset: true,
          file: params.route.filePath,
          stack: new Error('The requested JSON notation (' + params.url.output + ') doesn\'t exist').stack
        };

    server.emit('error', error, params, context);
  }
}



function renderView(pattern, view, format, context, callback) {
  var viewOutput = '',
      callbackRegex;

    switch ( format ) {
      case 'html':
        if ( CTZN.patterns.views[pattern][view] ) {
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
        } else {
          throw new Error('server.renderView(): The [' + pattern + ']' + '[' + view + '] view doesn\'t exist.');
        }
        break;
      case 'json':
        viewOutput = JSON.stringify(context, null, CTZN.config.citizen.format.json.pretty);
        if ( viewOutput.charAt(0) === '"' && viewOutput.charAt(viewOutput.length - 1) === '"' ) {
          viewOutput = viewOutput.slice(1, -1);
        }
        break;
      case 'jsonp':
        callbackRegex = new RegExp(/^[A-Za-z0-9_]*$/);
        if ( callbackRegex.test(callback) ) {
          viewOutput = callback + '(' + JSON.stringify(context, null, CTZN.config.citizen.format.jsonp.pretty) + ');';
        } else {
          throw new Error('server.renderView(): JSONP callback names should consist of letters, numbers, and underscores only.');
        }
        break;
    }

    return viewOutput;

}



function debug(params, context) {
  var toDebug = params.url.ctzn_debug || 'context',
      showHidden = params.url.ctzn_debugShowHidden || false,
      depth = params.url.ctzn_debugDepth || CTZN.config.citizen.debug.depth,
      colors = params.url.ctzn_debugColors || false,
      dump = params.url.ctzn_dump || CTZN.config.citizen.debug.output,
      toDump = '\n\n' + toDebug + ' dump:\n\n' + util.inspect(eval(toDebug), { showHidden: showHidden, depth: depth, colors: colors }) + '\n\n',
      viewDump;

  if ( toDebug === 'context' ) {
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
      path = '',
      expires = '',
      httpOnly = '',
      secure = '',
      secureEnabled = params.route.parsed.protocol === 'https:' && CTZN.config.citizen.https.secureCookies,
      cookieExpires,
      now = Date.now();

  for ( var property in cookies ) {
    if ( cookies.hasOwnProperty(property) ) {
      // If it's just a string, use the defaults (app path, HTTP only, secure if available)
      if ( cookies[property].constructor !== Object ) {
        secure = secureEnabled ? 'secure;' : '';
        cookieArray.push(property + '=' + cookies[property] + ';path=' + CTZN.config.citizen.urlPaths.app + ';HttpOnly;' + secure);
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
        
        httpOnly = cookie.httpOnly !== false ? 'HttpOnly;' : '';
        
        // If it's a secure connection and the secureCookies setting is true (default),
        // make all cookies secure, unless the cookie directive explicitly requests an
        // insecure cookie.
        secure = secureEnabled && cookie.secure !== false ? 'secure;' : '';
        
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
