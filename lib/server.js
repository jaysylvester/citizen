// server

'use strict';

var // Native Node.js modules
    domain      = require('domain'),
    events      = require('events'),
    fs          = require('fs'),
    http        = require('http'),
    https       = require('https'),
    path        = require('path'),
    querystring = require('querystring'),
    util        = require('util'),
    zlib        = require('zlib'),

    // Third party modules
    consolidate = require('consolidate'),
    formidable  = require('formidable'),

    // citizen modules
    cache       = require('./cache'),
    helpers     = require('./helpers'),
    router      = require('./router'),
    session     = require('./session'),
    server      = new events.EventEmitter();

    cache       = helpers.extend(cache.public, cache.citizen);
    session     = helpers.extend(session.public, session.citizen);

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
  var remoteHost = params ? params.request.headers['x-forwarded-for'] || params.request.connection.remoteAddress || params.request.socket.remoteAddress || ( params.request.connection.socket ? params.request.connection.socket.remoteAddress : 'undefined' ) : 'undefined',
    statusCode = err.statusCode ? err.statusCode : 500,
    requested = '',
    errorView = 'error';

  remoteHost = remoteHost.replace('::ffff:', '');

  if ( params ) {
    requested = 'Error URL: ' + params.route.url + '\n\nController: ' + params.route.controller + '\nAction: ' + params.route.action + '()\n\n' + 'Remote host: ' + remoteHost + '\n\n' + 'Referrer: ' + params.request.headers.referer + '\n\n';
  }

  context.content = context.content || {};

  helpers.log({
    type: 'error',
    label: err.stack ? '' : err.message ? err.message + '\n\n' : '',
    content: err.stack ? requested + err.stack : requested + err,
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

              helpers.listen({
                renderView: function (emitter) {
                  renderView({ pattern: 'error', view: errorView, format: 'html', context: helpers.extend(context.content, params) }, emitter);
                }
              }, function (output) {
                params.response.write(output.renderView);
                params.response.end();
              });
            } else {
              if ( err.stack ) {
                params.response.write('<pre><code>' + err.stack + '</code></pre>');
              } else {
                params.response.write('<pre><code>' + util.inspect(err) + '</code></pre>');
              }
              params.response.end();
            }
            break;
          case 'development':
          case 'debug':
            if ( err.stack ) {
              params.response.write('<pre><code>' + err.stack + '</code></pre>');
            } else {
              params.response.write('<pre><code>' + util.inspect(err) + '</code></pre>');
            }
            params.response.end();
            break;
        }
        break;
      case 'json':
      case 'jsonp':
        // Strip the domain additions, which contain circular references and irrelevant data
        delete err.domain;
        delete err.domainEmitter;
        delete err.domainBound;
        delete err.domainThrown;
        context.content = { error: { description: err.toString(), details: err.stack ? requested + err.stack : requested + err } };

        if ( !params.url.output ) {
          context = context.content;
        } else {
          context = err;
        }
        
        params.response.setHeader('Content-Type', params.route.format === 'json' ? 'application/json' : 'text/javascript');
        helpers.listen({
          renderView: function (emitter) {
            renderView({ format: params.route.format, context: context, jsonpCallback: params.url.callback }, emitter);
          }
        }, function (output) {
          params.response.write(output.renderView);
          params.response.end();
        });
        break;
    }
  }

});



server.on('requestStart', function (params, context) {
  var requestStartDomain = domain.create();

  requestStartDomain.on('error', function (err) {
    server.emit('error', err, params, context);
  });

  requestStartDomain.run( function () {

    helpers.listen({
      requestStart: function (emitter) {
        CTZN.on.request.start(params, context, emitter);
      }
    }, function (output) {
      if ( output.listen.success ) {
        context = helpers.extend(context, output.requestStart);

        if ( CTZN.appOn.request && CTZN.appOn.request.start ) {
          helpers.listen({
            requestStart: function (emitter) {
              CTZN.appOn.request.start(params, context, emitter);
            }
          }, function (output) {
            if ( output.listen.success ) {
              context = helpers.extend(context, output.requestStart);

              server.emit('request', params, context);
            } else {
              server.emit('error', output.listen, params, context);
            }
          });
        } else {
          server.emit('request', params, context);
        }
      } else {
        server.emit('error', output.listen, params, context);
      }
    });
  });
});



server.on('request', function (params, context) {
  // If a previous event in the request context requested a redirect, do it immediately.
  if ( context.redirect && ( typeof context.redirect === 'string' || helpers.size(context.redirect) ) && params.route.type !== 'direct' ) {
    redirect(params, context, false);
  } else {
    // If the controller exists or a fallback controller is defined,
    // start the session if sessions are enabled or begin the response
    if ( CTZN.patterns.controllers[CTZN.config.citizen.fallbackController || params.route.controller] && CTZN.patterns.controllers[CTZN.config.citizen.fallbackController || params.route.controller][params.route.action] ) {
      if ( CTZN.config.citizen.sessions ) {
        server.emit('sessionStart', params, context);
      } else {
        processRequest(params, context);
      }
    // If the controller doesn't exist, throw a 404
    } else {
      var error = {
            statusCode: 404,
            stack: new Error('404 - The requested route doesn\'t exist.').stack
          };

      server.emit('error', error, params, context);
    }
  }
});



server.on('sessionStart', function (params, context) {
  var sessionDomain = domain.create(),
      sessionID = 0;

  sessionDomain.on('error', function (err) {
    server.emit('error', err, params, context);
  });

  sessionDomain.add(params);
  sessionDomain.add(context);

  sessionDomain.run( function () {
    if ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) {
      if ( params.cookie.ctzn_sessionID && CTZN.sessions[params.cookie.ctzn_sessionID] && CTZN.sessions[params.cookie.ctzn_sessionID].expires > Date.now() ) {
        session.extend(params.cookie.ctzn_sessionID);
        params.session = helpers.copy(CTZN.sessions[params.cookie.ctzn_sessionID]);
        setSession(params, context);
        processRequest(params, context);
      } else {
        sessionID = session.create();
        context.cookie = context.cookie || {};
        context.cookie.ctzn_sessionID = {
          value: sessionID
        };
        params.session = helpers.copy(CTZN.sessions[sessionID]);
        setSession(params, context);

        helpers.listen({
          sessionStart: function (emitter) {
            CTZN.on.session.start(params, context, emitter);
          }
        }, function (output) {
          if ( output.listen.success ) {
            context = helpers.extend(context, output.sessionStart);
            setSession(params, context);

            if ( CTZN.appOn.session && CTZN.appOn.session.start ) {
              helpers.listen({
                sessionStart: function (emitter) {
                  CTZN.appOn.session.start(params, context, emitter);
                }
              }, function (output) {
                if ( output.listen.success ) {
                  context = helpers.extend(context, output.sessionStart);
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
      }
    } else {
      server.emit('requestStart', params, context);
    }
  });
});



server.on('sessionEnd', function (params, context) {
  var sessionEndDomain = domain.create();

  sessionEndDomain.on('error', function (err) {
    server.emit('error', err, params, context);
  });

  sessionEndDomain.run( function () {
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

});



server.on('responseStart', function (params, context) {
  var responseStartDomain = domain.create();

  responseStartDomain.on('error', function (err) {
    server.emit('error', err, params, context);
  });

  responseStartDomain.run( function () {
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

                // Set response headers based on cached context
                if ( routeCache.context.headers ) {
                  for ( var property in routeCache.context.headers ) {
                    if ( routeCache.context.headers.hasOwnProperty(property) ) {
                      params.response.setHeader(property, routeCache.context.headers[property]);
                    }
                  }
                }
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

            // Set response headers based on cached context
            if ( routeCache.context.headers ) {
              for ( var property in routeCache.context.headers ) {
                if ( routeCache.context.headers.hasOwnProperty(property) ) {
                  params.response.setHeader(property, routeCache.context.headers[property]);
                }
              }
            }
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
});



server.on('responseEnd', function (params, context) {
  var responseEndDomain = domain.create();

  responseEndDomain.on('error', function (err) {
    server.emit('error', err, params, context);
  });

  responseEndDomain.run( function () {
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
});



// Server functions

function start(options) {
  server.emit('applicationStart', options);
}



function createServer(options) {
  var httpDomain, httpsDomain;

  CTZN.config = helpers.extend(CTZN.config, options);

  if ( CTZN.config.citizen.http.enable ) {
    httpDomain = domain.create();

    httpDomain.on('error', function (err) {
      var appUrl = CTZN.config.citizen.http.port === 80 ? 'http://' + CTZN.config.citizen.http.hostname + CTZN.config.citizen.urlPaths.app : 'http://' + CTZN.config.citizen.http.hostname + ':' + CTZN.config.citizen.http.port + CTZN.config.citizen.urlPaths.app;

      switch ( err.code ) {
        case 'EACCES':
          helpers.log({
            content: '\nHTTP server startup failed because port ' + CTZN.config.citizen.http.port + ' isn\'t open. Please open this port or set an alternate port for HTTP traffic in your config file using the "citizen.http.port" setting.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'EADDRINUSE':
          helpers.log({
            content: '\nHTTP server startup failed because port ' + CTZN.config.citizen.http.port + ' is already in use. Please set an alternate port for HTTP traffic in your config file using the "citizen.http.port" setting.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'ENOTFOUND':
          helpers.log({
            content: '\nHTTP server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.http.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'EADDRNOTAVAIL':
          helpers.log({
            content: '\nHTTP server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.http.hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        default:
          helpers.log({
            content: '\nThere was a problem starting the server. The port and hostname you specified in your config file appear to be available, so please review your other settings and make sure everything is correct.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code along with the contents of your config file to:\n\nhttps://github.com/jaysylvester/citizen/issues\n\nThe full error is below:\n\n' + err,
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
      }
    });

    httpDomain.run( function () {
      http.createServer( function (request, response) {
        serve(request, response, 'http');
      }).listen(CTZN.config.citizen.http.port, CTZN.config.citizen.http.hostname, CTZN.config.citizen.connectionQueue, function () {
        var httpHostname = CTZN.config.citizen.http.hostname.length ? CTZN.config.citizen.http.hostname : '127.0.0.1',
            appUrl = CTZN.config.citizen.http.port === 80 ? 'http://' + httpHostname + CTZN.config.citizen.urlPaths.app : 'http://' + httpHostname + ':' + CTZN.config.citizen.http.port + CTZN.config.citizen.urlPaths.app,
            startupMessage = '\nHTTP server status: RUNNING\n' +
                             '\nApplication mode:   ' + CTZN.config.citizen.mode +
                             '\nPort:               ' + CTZN.config.citizen.http.port +
                             '\nLocal URL:          ' + appUrl;

        if ( !CTZN.config.citizen.http.hostname.length ) {
          startupMessage += '\n\nNote: You\'ve specified an empty hostname, so the server will respond to requests at any host.';
        }

        if ( CTZN.config.citizen.mode === 'debug' && CTZN.config.citizen.debug.disableCache ) {
          startupMessage += '\n\nNote: By default, caching is disabled in debug mode, so you won\'t see any logs related to caching. To enable caching in debug mode, set "disableCache" to false under the "debug" node in your config file.';
        }

        helpers.log({
          content: startupMessage,
          toConsole: true,
          file: 'citizen.txt',
          timestamp: false
        });
      });
    });
  }

  if ( CTZN.config.citizen.https.enable ) {
    httpsDomain = domain.create();

    httpsDomain.on('error', function (err) {
      var appUrl = CTZN.config.citizen.https.port === 443 ? 'http://' + CTZN.config.citizen.https.hostname + CTZN.config.citizen.urlPaths.app : 'http://' + CTZN.config.citizen.https.hostname + ':' + CTZN.config.citizen.https.port + CTZN.config.citizen.urlPaths.app;

      switch ( err.code ) {
        case 'EACCES':
          helpers.log({
            content: '\nHTTPS server startup failed because port ' + CTZN.config.citizen.https.port + ' isn\'t open. Please open this port or set an alternate port for HTTPS traffic in your config file using the "citizn.https.port" setting.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'EADDRINUSE':
          helpers.log({
            content: '\nHTTPS server startup failed because port ' + CTZN.config.citizen.https.port + ' is already in use. Please set an alternate port for HTTPs traffic in your config file using the "citizen.https.port" setting.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'ENOTFOUND':
          helpers.log({
            content: '\nHTTPS server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.https.hostname + '") wasn\'t found.\n\nTry running citizen without specifying a hostname (accessible via ' + appUrl + ' locally or your server\'s IP address remotely). If that works, then the issue is probably in your server\'s DNS settings.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'EADDRNOTAVAIL':
          helpers.log({
            content: '\nHTTPS server startup failed because the hostname you specified in your config file ("' + CTZN.config.citizen.https.hostname + '") is unavailable. Have you configured your environment for this hostname? Is there another web server running on this machine?\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'ENOENT':
          helpers.log({
            content: '\nHTTPS server startup failed because citizen couldn\'t find the PFX or key/cert files you specified.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        case 'NOPFXORKEYCERT':
          helpers.log({
            content: '\nHTTPS server startup failed because you didn\'t provide the necessary key files. You need to specify either a PFX file or key/cert pair.\n',
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
        default:
          helpers.log({
            content: '\nThere was a problem starting the server. The port and hostname you specified in your config file appear to be available, so please review your other settings and make sure everything is correct.\n\nError code: ' + err.code + '\n\ncitizen doesn\'t recognize this error code, so please submit a bug report containing this error code along with the contents of your config file to:\n\nhttps://github.com/jaysylvester/citizen/issues\n\nThe full error is below:\n\n' + err,
            toConsole: true,
            file: 'citizen.txt',
            timestamp: false
          });
          break;
      }
    });

    httpsDomain.run( function () {
      var startHttps = true,
          httpsOptions = helpers.copy(CTZN.config.citizen.https);

      if ( CTZN.config.citizen.https.pfx ) {
        try {
          httpsOptions.pfx = fs.readFileSync(CTZN.config.citizen.https.pfx);
        } catch ( err ) {
          startHttps = false;
          httpsDomain.emit('error', err);
        }
      } else if ( CTZN.config.citizen.https.key && CTZN.config.citizen.https.cert ) {
        try {
          httpsOptions.key = fs.readFileSync(CTZN.config.citizen.https.key);
          httpsOptions.cert = fs.readFileSync(CTZN.config.citizen.https.cert);
        } catch ( err ) {
          startHttps = false;
          httpsDomain.emit('error', err);
        }
      } else {
        startHttps = false;
        httpsDomain.emit('error', { code: 'NOPFXORKEYCERT'});
      }

      if ( startHttps ) {
        https.createServer(httpsOptions, function (request, response) {
          serve(request, response, 'https');
        }).listen(CTZN.config.citizen.https.port, CTZN.config.citizen.https.hostname, CTZN.config.citizen.connectionQueue, function () {
          var httpsHostname = CTZN.config.citizen.https.hostname.length ? CTZN.config.citizen.https.hostname : '127.0.0.1',
              appUrl = CTZN.config.citizen.https.port === 443 ? 'https://' + httpsHostname + CTZN.config.citizen.urlPaths.app : 'https://' + httpsHostname + ':' + CTZN.config.citizen.https.port + CTZN.config.citizen.urlPaths.app,
              startupMessage = '\nHTTPS server status: RUNNING\n' +
                               '\nApplication mode:    ' + CTZN.config.citizen.mode +
                               '\nPort:                ' + CTZN.config.citizen.https.port +
                               '\nLocal URL:           ' + appUrl;

          if ( !CTZN.config.citizen.https.hostname.length ) {
            startupMessage += '\n\nNote: You\'ve specified an empty hostname, so the server will respond to requests at any host.';
          }

          if ( CTZN.config.citizen.mode === 'debug' && CTZN.config.citizen.debug.disableCache ) {
            startupMessage += '\n\nNote: By default, caching is disabled in debug mode, so you won\'t see any logs related to caching. To enable caching in debug mode, set "disableCache" to false under the "debug" node in your config file.';
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
          encoding: CTZN.config.citizen.compression.force || 'identity'
        },
        config: CTZN.config
      },
      requestDomain = domain.create();

  if ( !params.route.isStatic && CTZN.config.citizen.sessions && params.cookie.ctzn_sessionID ) {
    params.session = helpers.copy(CTZN.sessions[params.cookie.ctzn_sessionID]) || params.session;
  }

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
    var acceptEncoding = params.request.headers['accept-encoding'] ? params.request.headers['accept-encoding'].split(',') : [],
        encoding = [],
        weight = 0,
        staticPath,
        staticCacheEnabled,
        cachedFile,
        compressable = CTZN.config.citizen.compression.enable && !CTZN.config.citizen.compression.force && ( !params.route.isStatic || CTZN.config.citizen.compression.mimeTypes.indexOf(CTZN.config.citizen.mimetypes[params.route.extension]) >= 0 ),
        lastModified;

    // Determine client encoding support for compressable assets. Can be forced via config.citizen.compression.force
    if ( compressable ) {
      for ( var i = 0; i < acceptEncoding.length; i++ ) {
        acceptEncoding[i] = acceptEncoding[i].trim().split(';');
        acceptEncoding[i][1] = acceptEncoding[i][1] ? +querystring.parse(acceptEncoding[i][1]).q : '1';
      }

      for ( i = 0; i < acceptEncoding.length; i++ ) {
        if ( acceptEncoding[i][1] > weight ) {
          encoding.unshift([acceptEncoding[i][0], acceptEncoding[i][1]]);
          weight = acceptEncoding[i][1];
        } else {
          encoding.push([acceptEncoding[i][0], acceptEncoding[i][1]]);
        }
      }

      for ( i = 0; i < encoding.length; i++ ) {
        // Use the appropriate encoding if it's supported
        if ( encoding[i][1] && ( encoding[i][0] === 'gzip' || encoding[i][0] === 'deflate' || encoding[i][0] === 'identity' ) ) {
          params.client.encoding = encoding[i][0];
          break;
        }
      }
    }

    response.setHeader('X-Powered-By', 'citizen');

    // If it's a dynamic page request, emit the requestStart event.
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

      server.emit('requestStart', params, context);
    } else {
      staticPath = CTZN.config.citizen.directories.web + params.route.filePath;
      staticCacheEnabled = ( CTZN.config.citizen.mode !== 'debug' && CTZN.config.citizen.cache.static.enable ) || ( CTZN.config.citizen.mode === 'debug' && !CTZN.config.citizen.debug.disableCache && CTZN.config.citizen.cache.static.enable );

      response.setHeader('Content-Type', CTZN.config.citizen.mimetypes[params.route.extension]);
      response.setHeader('Cache-Control', 'max-age=0' );

      if ( CTZN.config.citizen.cache.control[params.route.pathname] ) {
        response.setHeader('Cache-Control', CTZN.config.citizen.cache.control[params.route.pathname] );
      } else {
        for ( var controlHeader in CTZN.config.citizen.cache.control ) {
          if ( new RegExp(controlHeader).test(params.route.pathname) ) {
            response.setHeader('Cache-Control', CTZN.config.citizen.cache.control[controlHeader] );
          }
        }
      }

      if ( staticCacheEnabled ) {
        cachedFile = cache.get({ file: staticPath, output: 'all' });
      }

      if ( cachedFile ) {
        lastModified = cachedFile.stats.mtime.toISOString();

        response.setHeader('ETag', lastModified);

        if ( request.headers['if-none-match'] === lastModified ) {
          response.setHeader('Date', lastModified);
          response.statusCode = 304;
        } else {
          if ( compressable ) {
            response.setHeader('Content-Encoding', params.client.encoding);
          }
          response.write(cachedFile.value[params.client.encoding]);
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
                if ( CTZN.config.citizen.compression.enable && compressable ) {
                  helpers.listen({
                    gzip: function (emitter) {
                      if ( staticCacheEnabled || params.client.encoding === 'gzip' ) {
                        zlib.gzip(data, function (err, zippedFile) {
                          response.setHeader('Content-Encoding', 'gzip');
                          emitter.emit('ready', zippedFile);
                        });
                      } else {
                        emitter.emit('ready');
                      }
                    },
                    deflate: function (emitter) {
                      if ( staticCacheEnabled || params.client.encoding === 'deflate' ) {
                        zlib.deflate(data, function (err, deflatedFile) {
                          response.setHeader('Content-Encoding', 'deflate');
                          emitter.emit('ready', deflatedFile);
                        });
                      } else {
                        emitter.emit('ready');
                      }
                    }
                  }, function (output) {
                    response.write(output[params.client.encoding]);
                    response.end();

                    if ( staticCacheEnabled ) {
                      cache.set({
                        file: staticPath,
                        value: {
                          identity: data,
                          gzip: output.gzip,
                          deflate: output.deflate
                        },
                        stats: stats,
                        lifespan: CTZN.config.citizen.cache.static.lifespan,
                        resetOnAccess: CTZN.config.citizen.cache.static.resetOnAccess
                      });
                    }
                  });
                } else {
                  response.write(data);
                  response.end();

                  if ( staticCacheEnabled ) {
                    cache.set({
                      file: staticPath,
                      value: {
                        identity: data
                      },
                      stats: stats,
                      lifespan: CTZN.config.citizen.cache.static.lifespan,
                      resetOnAccess: CTZN.config.citizen.cache.static.resetOnAccess
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
          CTZN.sessions[params.session.id][property] = helpers.copy(context.session[property]);
        } else {
          throw new Error('"' + property + '" is a reserved session variable name used internally by citizen. Please choose a different variable name.');
        }
      }
      params.session = helpers.copy(CTZN.sessions[params.session.id]);
    }
    delete context.session;
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
      formOptions = helpers.copy(CTZN.config.citizen.forms.global),
      controllerFormOptions = {},
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
        if ( controller.cors && controller.cors[params.route.action] && controller.cors[params.route.action]['access-control-allow-origin'] ) {
          if ( controller.cors[params.route.action]['access-control-allow-origin'].search(params.request.headers.origin) >= 0 || controller.cors[params.route.action]['access-control-allow-origin'] === '*' ) {
            if ( params.request.method === 'OPTIONS' && !params.request.headers['access-control-request-method'] ) {
              respond = false;
              params.response.end(server.emit('responseEnd', params, context));
            } else {
              for ( var property in controller.cors[params.route.action] ) {
                if ( controller.cors[params.route.action].hasOwnProperty(property) ) {
                  params.response.setHeader(property, controller.cors[params.route.action][property]);
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
          if ( formOptions.maxFieldsSize ) {
            formOptions.maxFieldsSize = formOptions.maxFieldsSize * 1024 * 1024;
          }

          if ( CTZN.config.citizen.forms.controller[params.route.controller] && CTZN.config.citizen.forms.controller[params.route.controller][params.route.action] ) {
            controllerFormOptions = helpers.copy(CTZN.config.citizen.forms.controller[params.route.controller][params.route.action]);
            if ( controllerFormOptions.maxFieldsSize ) {
              controllerFormOptions.maxFieldsSize = controllerFormOptions.maxFieldsSize * 1024 * 1024;
            }
            formOptions = helpers.extend(formOptions, controllerFormOptions);
          }

          formParser = new formidable.IncomingForm(formOptions);

          formParser.on('progress', function (bytesReceived, bytesExpected) {
            if ( bytesExpected > formParser.maxFieldsSize || bytesReceived > formParser.maxFieldsSize ) {
              params.response.setHeader('Connection', 'close');
              server.emit('error', {
                statusCode: 413,
                message: http.STATUS_CODES[413],
                stack: new Error('The maximum upload size for this form has been exceeded (max: ' + formParser.maxFieldsSize + ', received: ' + bytesReceived + ', expected: ' + bytesExpected + ').').stack
              }, params, context);
            }
          });

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
              server.emit('error', err, params, context);
              helpers.log({
                label: 'Error processing form',
                content: err
              });
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
              if ( formOptions.maxFieldsSize ) {
                formOptions.maxFieldsSize = formOptions.maxFieldsSize * 1024 * 1024;
              }
    
              if ( CTZN.config.citizen.forms.controller[params.route.controller] && CTZN.config.citizen.forms.controller[params.route.controller][params.route.action] ) {
                controllerFormOptions = helpers.copy(CTZN.config.citizen.forms.controller[params.route.controller][params.route.action]);
                if ( controllerFormOptions.maxFieldsSize ) {
                  controllerFormOptions.maxFieldsSize = controllerFormOptions.maxFieldsSize * 1024 * 1024;
                }
                formOptions = helpers.extend(formOptions, controllerFormOptions);
              }
    
              formParser = new formidable.IncomingForm(formOptions);

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

      // Set headers based on controller action headers
      if ( context.headers ) {
        context.headersLowercase = {};
        for ( var property in context.headers ) {
          if ( context.headers.hasOwnProperty(property) ) {
            params.response.setHeader(property, context.headers[property]);
            // Create lowercase version of header name for easier comparison later
            context.headersLowercase[property.toLowerCase()] = context.headers[property];
          }
        }
      }

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

      context.formats = helpers.extend(CTZN.config.citizen.formats, context.formats);

      if ( output.listen.success && !params.response.headersSent ) {

        for ( var property in context.content ) {
          if ( context.content.hasOwnProperty(property) && CTZN.reserved.content.indexOf(property) >= 0 ) {
            throw new Error('"' + property + '" is a reserved content variable name used internally by citizen. Please choose a different variable name.');
          }
        }

        if ( !context.formats[params.route.format] || !context.formats[params.route.format].enable ) {
          var format = params.route.format;

          switch ( params.route.format ) {
            case 'html':
              params.route.format = 'json';
              server.emit('error', { statusCode: 404, stack: new Error('HTML output is disabled for this controller.').stack }, params, context);
              break;
            case 'json':
              params.route.format = 'html';
              server.emit('error', { statusCode: 404, stack: new Error('JSON output is disabled for this controller.').stack }, params, context);
              break;
            case 'jsonp':
              params.route.format = 'html';
              server.emit('error', { statusCode: 404, stack: new Error('JSONP output is disabled for this controller.').stack }, params, context);
              break;
            default:
              params.route.format = 'html';
              server.emit('error', { statusCode: 404, stack: new Error(format + ' is not a valid output format.').stack }, params, context);
              break;
          }

          throw new Error('An invalid output format was requested for this route: ' + format);
        }

        setSession(params, context);

        if ( context.redirect && ( typeof context.redirect === 'string' || ( helpers.size(context.redirect) && typeof context.redirect.refresh === 'undefined' ) ) && params.route.type !== 'direct' ) {
          setCookie(params, context);
          redirect(params, context);

          helpers.listen({
            renderView: function (emitter) {
              renderView({ pattern: controller,
                view: params.route.renderedView,
                format: params.route.format,
                context: context,
                jsonpCallback: params.url.callback }, emitter);
            }
          }, function (output) {
            if ( output.listen.success ) {
              cacheController({
                controller: controller,
                action: action,
                view: params.route.renderedView,
                route: params.route.pathname,
                context: context,
                render: output.renderView,
                format: params.route.format,
                params: params
              });
            } else {
              server.emit('error', output.listen, params, context);
            }
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
                  context.content.include[item] = include[item].cache.render;
                  emitter.emit('ready');
                } else {
                  helpers.listen({
                    includeController: function (emitter) {
                      helpers.log({
                        label: 'Firing include controller',
                        content: {
                          controller: include[item].controller,
                          action: include[item].action,
                          view: include[item].view
                        },
                        file: 'citizen.txt'
                      });
                      CTZN.patterns.controllers[include[item].controller][include[item].action](include[item].params, context, emitter);
                    }
                  }, function (output) {

                    if ( output.listen.success ) {
                      include[item].context = output.includeController || {};

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

                      helpers.log({
                        label: 'Rendering include ' + item,
                        content: {
                          controller: include[item].controller,
                          action: include[item].action,
                          view: include[item].view
                        },
                        file: 'citizen.txt'
                      });

                      helpers.listen({
                        renderView: function (emitter) {
                          renderView({ pattern: include[item].controller,
                            view: include[item].view,
                            format: include[item].params.route.format,
                            context: include[item].viewContext,
                            jsonpCallback: include[item].params.url.callback }, emitter);
                        }
                      }, function (output) {
                        if ( output.listen.success ) {
                          context.content.include[item] = output.renderView;
    
                          cacheController({
                            controller: include[item].controller,
                            action: include[item].action,
                            view: include[item].view,
                            route: include[item].params.route.pathname,
                            context: include[item].context,
                            render: output.renderView,
                            format: include[item].params.route.format,
                            params: include[item].params
                          });
  
                          emitter.emit('ready');
                        } else {
                          server.emit('error', output.listen, params, context);
                        }
                      });
                    } else {
                      emitter.emit('error', output.listen, params, context);
                    }
                  })
                }
              };
            });

            if ( helpers.size(includeGroup) ) {
              context.content.include = context.content.include || {};

              helpers.listen(includeGroup, function (output) {
                if ( output.listen.success ) {
                  delete context.include;
                  handoffOrRespond(params, context)
                } else {
                  server.emit('error', output.listen, params, context);
                }
              });
            } else {
              handoffOrRespond(params, context)
            }

            delete context.include;

          } else {
            handoffOrRespond(params, context)
          }
        }
      } else if ( output.listen.status.pattern === 'timeout' ) {
        if ( !params.response.headersSent ) {
          output.listen.stack = output.listen.stack || new Error(output.listen.message || http.STATUS_CODES[output.listen.statusCode || 500]).stack;

          server.emit('error', output.listen, params, context);
        }
      }
    });
  });
}



function handoffOrRespond(params, context) {
  if ( context.handoff && params.route.type !== 'direct' ) {
    preHandoff(params, context);
  } else {
    setCookie(params, context);
    respond(params, context);
  }
}



function redirect(params, context, setReferrer) {
  var url = typeof context.redirect === 'string' ? context.redirect : context.redirect.url,
      statusCode = context.redirect.statusCode || 302,
      refresh = typeof context.redirect.refresh === 'number';

  setReferrer = setReferrer !== false ? true : false;

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
    if ( setReferrer ) {
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
    cacheExists = cache.exists({
      controller: options.controller,
      action: options.action,
      view: options.view,
      route: options.context.cache.controller.scope === 'route' ? options.route : 'global'
    });

    if ( !cacheExists ) {
      cacheLifespan = options.context.cache.controller.lifespan || CTZN.config.citizen.cache.application.lifespan;
      cacheReset = options.context.cache.controller.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess;

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

      cache.setController({
        controller: options.controller,
        action: options.action,
        view: options.view,
        route: options.context.cache.controller.scope === 'route' ? options.route : 'global',
        context: cacheContext,
        render: options.render,
        lifespan: cacheLifespan,
        resetOnAccess: cacheReset
      });
    }
  }
}



function preHandoff(params, context) {
  var thisHandoff = helpers.copy(context.handoff),
      lastLink = params.route.chain[params.route.chain.length-1],
      handoffParams = {},
      renderer = thisHandoff.controller || params.route.renderer,
      renderedView = thisHandoff.view || thisHandoff.controller,
      action = thisHandoff.action || 'handler',
      cachedController,
      viewContext;

  if ( !CTZN.patterns.controllers[thisHandoff.controller] ) {
    throw new Error('server.preHandoff(): The ' + thisHandoff.controller + ' controller doesn\'t exist.');
  }

  if ( context.view !== false ) {
    if ( CTZN.patterns.views[lastLink.controller][lastLink.view] ) {
      cachedController = cache.getController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: params.route.pathname }) || cache.getController({ controller: lastLink.controller, action: lastLink.action, view: lastLink.view, route: 'global' });

      if ( cachedController ) {
        lastLink.viewContent = cachedController.render;
        helpers.log({
          label: 'Using cached controller view',
          content: lastLink.controller,
          file: 'citizen.txt'
        });
        handoff(params, context, thisHandoff, action, renderedView, renderer);
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

        helpers.listen({
          renderView: function (emitter) {
            renderView({ pattern: lastLink.controller, view: lastLink.view, format: params.route.format, context: viewContext, jsonpCallback: params.url.callback}, emitter);
          }
        }, function (output) {
          if ( output.listen.success ) {
            lastLink.viewContent = output.renderView;
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
  
            handoff(params, context, thisHandoff, action, renderedView, renderer);
          } else {
            server.emit('error', output.listen, params, context);
          }
        });
      }
    } else {
      server.emit('error', {
        stack: new Error('The handoff view you specified (' + lastLink.view + ') doesn\'t exist.').stack
      }, params, context);
    }
  } else {
    handoff(params, context, thisHandoff, action, renderedView, renderer);
  }
}



function handoff(params, context, thisHandoff, action, renderedView, renderer) {
  var handoffParams = helpers.extend(params, { route: { chain: params.route.chain.concat([{ controller: thisHandoff.controller, action: action, view: renderedView }]), renderer: renderer, renderedView: renderedView }});
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
      lastModified = context.cache && context.cache.route && context.cache.route.lastModified ? context.cache.route.lastModified : new Date().toISOString();

  switch ( params.route.format ) {
    case 'html':
      contentType = 'text/html';
      viewContext = helpers.extend(context.content, params);
      if ( CTZN.config.citizen.mode === 'debug' || ( CTZN.config.citizen.mode === 'development' && params.url.ctzn_debug ) ) {
        viewContext.debugOutput = debug(params, context);
      }
      break;
    case 'json':
      contentType = 'application/json';

      if ( !params.url.output ) {
        viewContext = context.content;
      } else {
        viewContext = createJSON(params, context);
      }
      break;
    case 'jsonp':
      contentType = 'text/javascript';

      if ( !params.url.output ) {
        viewContext = context.content;
      } else {
        viewContext = createJSON(params, context);
      }
      break;
  }

  params.response.setHeader('Cache-Control', context.headersLowercase && context.headersLowercase['cache-control'] ? context.headersLowercase['cache-control'] : 'max-age=0');
  params.response.setHeader('ETag', context.headersLowercase && context.headersLowercase['etag'] ? context.headersLowercase['etag'] : lastModified);

  helpers.listen({
    renderView: function (emitter) {
      renderView({ pattern: params.route.renderer, view: params.route.renderedView, format: params.route.format, context: viewContext, jsonpCallback: params.url.callback }, emitter);
    }
  }, function (output) {
    if ( output.listen.success ) {
      if ( CTZN.config.citizen.compression.enable && ( context.cache || ( params.client.encoding === 'gzip' || params.client.encoding === 'deflate' ) ) ) {
        helpers.listen({
          gzip: function (emitter) {
            if ( context.cache || params.client.encoding === 'gzip' ) {
              zlib.gzip(output.renderView, function (err, zippedFile) {
                if ( !err ) {
                  emitter.emit('ready', zippedFile);
                } else {
                  emitter.emit('error', err);
                }
              });
            } else {
              emitter.emit('ready');
            }
          },
          deflate: function (emitter) {
            if ( context.cache || params.client.encoding === 'deflate' ) {
              zlib.deflate(output.renderView, function (err, deflatedFile) {
                if ( !err ) {
                  emitter.emit('ready', deflatedFile);
                } else {
                  emitter.emit('error', err);
                }
              });
            } else {
              emitter.emit('ready');
            }
          }
        }, function (output) {
          if ( output.listen.success ) {
            params.response.setHeader('Content-Type', contentType);
            params.response.setHeader('Content-Encoding', params.client.encoding);
            params.response.write(output[params.client.encoding] || output.renderView);
            params.response.end();
            server.emit('responseEnd', params, context);
            cacheResponse(params, context, output.renderView, output.gzip, output.deflate, contentType, lastModified);
          } else {
            // Send the unzipped response to the client in the event of an error, but
            // still throw the error on the server side. Don't cache the response.
            params.response.setHeader('Content-Type', contentType);
            params.response.setHeader('Content-Encoding', 'identity');
            params.response.write(output.renderView);
            params.response.end();
            server.emit('responseEnd', params, context);
            throw new Error('gzip of ' + params.route.url + ' failed.');
          }
        });
      } else {
        params.response.setHeader('Content-Type', contentType);
        params.response.setHeader('Content-Encoding', 'identity');
        params.response.write(output.renderView);
        params.response.end();
        server.emit('responseEnd', params, context);
        cacheResponse(params, context, output.renderView, '', '', contentType, lastModified);
      }
    } else {
      server.emit('error', output.listen, params, context);
    }
  });
}



function cacheResponse(params, context, view, zippedView, deflatedView, contentType, lastModified) {
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

      cache.setRoute({
        route: params.route.pathname,
        contentType: contentType,
        view: {
          identity: view,
          gzip: zippedView,
          deflate: deflatedView
        },
        context: context,
        lastModified: lastModified,
        lifespan: context.cache.route.lifespan || CTZN.config.citizen.cache.application.lifespan,
        resetOnAccess: context.cache.route.resetOnAccess || CTZN.config.citizen.cache.application.resetOnAccess
      });
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

  try {
    outputArray = params.url.output.split(CTZN.config.citizen.formats[params.route.format].urlDelimiter);
  } catch ( err ) {
    throwError();
  }

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
          stack: new Error('The requested JSON notation (' + params.url.output + ') doesn\'t exist. Are you using the correct URL delimiter for nested output? It\'s "' + CTZN.config.citizen.formats[params.route.format].urlDelimiter + '".').stack
        };

    server.emit('error', error, params, context);
  }
}



function renderView(options, emitter) {
  var viewContext,
      json = '',
      callbackRegex;

  switch ( options.format ) {
    case 'html':
      if ( CTZN.patterns.views[options.pattern][options.view] ) {
        if ( CTZN.config.citizen.mode === 'production' ) {
          viewContext = helpers.extend(options.context, { cache: true });
        } else {
          viewContext = options.context;
        }

        consolidate[CTZN.config.citizen.templateEngine](CTZN.patterns.views[options.pattern][options.view].path, viewContext, function (err, html) {
          if ( !err ) {
            if ( options.context.debugOutput ) {
              html = html.replace('</body>', '\n<div id="citizen-debug">\n' + options.context.debugOutput + '\n</div>\n</body>');
            }
            emitter.emit('ready', html);
          } else {
            emitter.emit('error', err);
          }
        });
      } else {
        throw new Error('server.renderView(): The requested view (' + options.view + ') doesn\'t exist.');
      }
      break;
    case 'json':
      json = JSON.stringify(options.context, null, CTZN.config.citizen.mode === 'production' ? null : 2);
      if ( json.charAt(0) === '"' && json.charAt(json.length - 1) === '"' ) {
        json = json.slice(1, -1);
      }
      emitter.emit('ready', json);
      break;
    case 'jsonp':
      callbackRegex = new RegExp(/^[A-Za-z0-9_]*$/);
      if ( callbackRegex.test(options.jsonpCallback) ) {
        json = options.jsonpCallback + '(' + JSON.stringify(options.context, null, CTZN.config.citizen.mode === 'production' ? null : 2) + ');';
      } else {
        throw new Error('server.renderView(): JSONP callback names should consist of letters, numbers, and underscores only.');
      }
      emitter.emit('ready', json);
      break;
  }
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
            cookieExpires.setTime(now + ( cookie.expires * 60000 ));
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
