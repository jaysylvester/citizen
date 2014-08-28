// server

module.exports = function (config, patterns) {
    var domain = require('domain'),
        events = require('events'),
        fs = require('fs'),
        http = require('http'),
        querystring = require('querystring'),
        util = require('util'),
        helper = require('./helper')(config),
        router = require('./router')(config),
        session = require('./session')(config),
        methods = {

            public: {

                start: function () {
                    http.createServer( function (request, response) {
                        var date = new Date(),
                            route = router.getRoute(request.url),
                            controller = {},
                            staticPath = '',
                            params = {},
                            body = '',
                            urlParams = router.getUrlParams(request.url),
                            sessionID = 0,
                            requestDomain = domain.create(),
                            respond = true;

                        requestDomain.add(request);
                        requestDomain.add(response);

                        requestDomain.on('error', function (e) {
                            methods.private.error(e, request, response);
                        });

                        requestDomain.run( function () {
                            // If it's a dynamic page request, fire the controller and serve the response when it's ready
                            if ( !route.isStatic ) {

                                // Overwrite the default route parameters with URL parameters if they exist
                                if ( typeof urlParams.type !== 'undefined' ) {
                                    route.type = urlParams.type;
                                }
                                if ( typeof urlParams.format !== 'undefined' ) {
                                    route.format = urlParams.format;
                                }
                                if ( typeof urlParams.do !== 'undefined' ) {
                                    route.do = urlParams.do;
                                }
                                if ( typeof urlParams.show !== 'undefined' ) {
                                    route.show = urlParams.show;
                                }

                                // TODO: extend querystring with urlParams (url parameters should take precedence over query strings)
                                // AJAX requests may also contain payloads in JSON format that need to be parsed as well.

                                params = {
                                    config: config,
                                    request: request,
                                    response: response,
                                    route: route,
                                    url: urlParams,
                                    form: {},
                                    payload: {},
                                    content: {},
                                    cookie: helper.parseCookie(request.headers.cookie),
                                    session: {},
                                    set: {
                                        cookie: {},
                                        session: {},
                                        redirect: {}
                                    }
                                };

                                controller = patterns[route.safeName].controller;

                                if ( config.sessions && ( !request.headers.origin || ( request.headers.origin && request.headers.origin.search(request.headers.host) ) ) ) {
                                    if ( params.cookie.ctzn_session_id && CTZN.sessions[params.cookie.ctzn_session_id] && CTZN.sessions[params.cookie.ctzn_session_id].expires > date.getTime() ) {
                                        CTZN.sessions[params.cookie.ctzn_session_id].expires = date.getTime() + config.sessionLength;
                                        params.session = CTZN.sessions[params.cookie.ctzn_session_id];
                                    } else {
                                        sessionID = session.new();
                                        params.set.cookie.ctzn_session_id = {
                                            value: sessionID
                                        };
                                        params.cookie.ctzn_session_id = {
                                            value: sessionID
                                        };
                                        params.session = CTZN.sessions[sessionID];
                                    }
                                }

                                // If the Origin header exists and it's not the host, check if it's allowed. If so,
                                // set the response header to match the request header (per W3C recs). If not, end the response.
                                if ( request.headers.origin && !request.headers.origin.search(request.headers.host) ) {
                                    if ( controller.access && controller.access['Access-Control-Allow-Origin'] ) {
                                        if ( controller.access['Access-Control-Allow-Origin'].search(request.headers.origin) >= 0 || access['Access-Control-Allow-Origin'] === '*' ) {
                                            if ( request.method === 'OPTIONS' && !request.headers['access-control-request-method'] ) {
                                                respond = false;
                                                response.end();
                                            } else {
                                                for ( var property in controller.access ) {
                                                    response.setHeader(property, controller.access[property]);
                                                }
                                                response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
                                            }
                                        } else {
                                            respond = false;
                                            response.end();
                                        }
                                    } else {
                                        respond = false;
                                        response.end();
                                    }
                                }

                                if ( respond ) {
                                    switch ( request.method ) {
                                        case 'GET':
                                            // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
                                            methods.private.respond(controller, params);
                                            break;
                                        case 'PUT':
                                            // params.route.action = 'form';
                                            request.on('data', function (chunk) {
                                                body += chunk.toString();
                                            });
                                            request.on('end', function () {
                                                params.payload = JSON.parse(body);
                                                // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
                                                methods.private.respond(controller, params);
                                            });
                                            break;
                                        case 'DELETE':
                                            // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
                                            methods.private.respond(controller, params);
                                            break;
                                        case 'POST':
                                            params.route.action = 'form';
                                            request.on('data', function (chunk) {
                                                body += chunk.toString();
                                            });
                                            request.on('end', function () {
                                                params.form = querystring.parse(body);
                                                // TODO: call onRequestEnd() method here, use listener, and on completion, call respond()
                                                methods.private.respond(controller, params);
                                            });
                                            break;
                                        case 'HEAD':
                                        case 'OPTIONS':
                                            response.end();
                                            break;
                                    }
                                }
                            } else {
                                staticPath = config.directories.public + route.name;
                                fs.exists(staticPath, function (exists) {
                                    if ( exists ) {
                                        fs.readFile(staticPath, function (err, data) {
                                            if ( err ) {
                                                response.statusCode = 500;
                                                response.end();
                                                if ( config.mode !== 'production' ) {
                                                    console.log(err);
                                                }
                                            } else {
                                                response.write(data);
                                                response.end();
                                                if ( config.mode !== 'production' ) {
                                                    console.log(data);
                                                }
                                            }
                                        });
                                    } else {
                                        response.statusCode = 404;
                                        response.end();
                                        if ( config.mode !== 'production' ) {
                                            console.log('Missing file requested: ' + staticPath);
                                        }
                                    }
                                });
                            }
                        });
                    }).listen(config.httpPort);
                }

            },

            private: {

                debug: function (pattern, params) {
                    var debug = params.url.ctzn_debug || 'pattern',
                        showHidden = params.url.ctzn_debugShowHidden || false,
                        depth = params.url.ctzn_debugDepth || 2,
                        colors = params.url.ctzn_debugColors || false,
                        dump = params.url.ctzn_dump || 'console';

                    switch ( dump ) {
                        case 'console':
                            console.log(debug + ':\n' + util.inspect(eval(debug), { showHidden: showHidden, depth: depth, colors: colors }));
                            return false;
                        case 'view':
                            return debug + ': ' + JSON.stringify(util.inspect(eval(debug), { showHidden: showHidden, depth: depth, colors: colors }));
                    }
                },

                error: function (e, request, response) {
                    switch ( config.mode ) {
                        case 'production':
                            console.log(util.inspect(e, { depth: null }));
                            switch ( e.code ) {
                                case 'MODULE_NOT_FOUND':
                                    params.response.writeHead(404, {
                                        'Location': request.headers.host + config.paths.fileNotFound
                                    });
                                    break;
                                default:
                                    response.writeHead(302, {
                                        'Location': request.headers.host + '/error/code/' + e.code
                                    });
                            }
                            params.response.end();
                            break;
                        case 'development':
                        case 'debug':
                            console.log(util.inspect(e));
                            // console.error('Error: ' + e.code, util.inspect(e, { depth: null }));
                            response.statusCode = 500;
                            response.write(e.stack);
                            response.end();
                            break;
                    }
                },

                buildCookie: function (cookies) {
                    var defaults = {},
                        cookie = {},
                        cookieArray = [],
                        pathString = '',
                        expiresString = '',
                        httpOnlyString = 'HttpOnly;',
                        secureString = '',
                        date = new Date(),
                        now = date.getTime();

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
                        pathString = 'path=' + cookie.path + ';';
                        switch ( cookie.expires ) {
                            case 'session':
                                expiresString = '';
                                break;
                            case 'now':
                                cookieExpires.setTime(now);
                                cookieExpires = cookieExpires.toUTCString();
                                expiresString = 'expires=' + cookieExpires + ';';
                                break;
                            case 'never':
                                cookieExpires.setTime(now + 946080000000);
                                cookieExpires = cookieExpires.toUTCString();
                                expiresString = 'expires=' + cookieExpires + ';';
                                break;
                            default:
                                cookieExpires.setTime(now + cookie.expires);
                                cookieExpires = cookieExpires.toUTCString();
                                expiresString = 'expires=' + cookieExpires + ';';
                        }
                        if ( !cookie.httpOnly ) {
                            httpOnlyString = '';
                        }
                        if ( cookie.secure ) {
                            secureString = 'secure;';
                        }
                        cookieArray.push(property + '=' + cookie.value + ';' + pathString + expiresString + httpOnlyString + secureString);
                    }

                    return cookieArray;
                },

                respond: function (controller, params) {
                    var responseDomain = domain.create();

                    responseDomain.on('error', function (e) {
                        methods.private.error(e, params.request, params.response);
                    });

                    responseDomain.add(controller);
                    responseDomain.add(params);

                    responseDomain.run( function () {
                        helper.listener({
                            pattern: {
                                method: controller.handler,
                                args: helper.copy(params)
                            }
                        }, function (output) {
                            var cookie = [];

                            // If sessions are enabled, the request is from the local host, and set.session has
                            // properties, merge those properties with the existing session
                            if ( config.sessions && ( !params.request.headers.origin || ( params.request.headers.origin && params.request.headers.origin.search(params.request.headers.host) ) ) && output.pattern.set.session ) {
                                if ( output.pattern.set.session.expires && output.pattern.set.session.expires === 'now' ) {
                                    delete CTZN.sessions[params.session.id];
                                    params.set.cookie = helper.extend(params.set.cookie, { ctzn_session_id: { expires: 'now' }});
                                } else {
                                    CTZN.sessions[params.session.id] = helper.extend(CTZN.sessions[params.session.id], output.pattern.set.session);
                                }
                            }

                            if ( output.pattern.set.cookie ) {
                                params.set.cookie = helper.extend(params.set.cookie, output.pattern.set.cookie);
                            }
                            cookie = methods.private.buildCookie(params.set.cookie);
                            if ( cookie.length ) {
                                params.response.setHeader('Set-Cookie', cookie);
                            }

                            // Debug handling
                            if ( config.mode === 'debug' || ( config.mode === 'development' && params.url.debug ) ) {
                                output.pattern.debugOutput = methods.private.debug(output.pattern.content, params);
                            }

                            // If set.redirect has properties, send the redirect
                            if ( output.pattern.set.redirect.statusCode ) {
                                params.response.writeHead(output.pattern.set.redirect.statusCode, {
                                    'Location': output.pattern.set.redirect.url
                                });
                            }

                            params.response.write(helper.renderView(params.route.name, params.route.format, output.pattern));

                            // TODO: call onResponseEnd method inside here
                            params.response.end();
                        });
                    });
                }

            }
        };

    return methods.public;
};
