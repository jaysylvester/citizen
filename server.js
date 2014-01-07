// server

module.exports = function (config) {
	var events = require('events'),
		fs = require('fs'),
		http = require('http'),
		querystring = require('querystring'),
		util = require('util'),
		helper = require('./helper')(config),
		router = require('./router')(config),
		methods = {

			public: {

				start: function () {
					http.createServer( function (request, response) {
						var route = router.getRoute(request.url), // Get the route name from the URL
							controller = {},
							emitters = {},
							staticPath = '',
							params = {},
							body = '',
							urlParams = router.getUrlParams(request.url),
							cookie = helper.parseCookie(request.headers.cookie);

						// If it's a dynamic page request, fire the controller and serve the response when it's ready
						if ( !route.isStatic ) {

							params = {
								request: request,
								response: response,
								route: route,
								urlParams: urlParams,
								cookie: cookie,
								form: {}
							};

							try {
								controller = require(config.appPath + '/patterns/' + route.name + '/' + route.name + '-controller');
							
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

								switch ( request.method ) {
									case 'GET':
										respond();
										break;
									case 'POST':
										params.route.action = 'form';
										request.on('data', function (chunk) {
											body += chunk.toString();
										});
										request.on('end', function () {
											params.form = querystring.parse(body);
											respond();
										});
										break;
								};

								function respond() {
									helper.listener({
										pattern: {
											method: controller.handler,
											args: params
										}
									}, function (output) {
										var cookie = [];
										if ( output.pattern.setCookie ) {
											for ( var property in output.pattern.setCookie ) {
												cookie.push(methods.private.buildCookie({
													name: property,
													value: output.pattern.setCookie[property]['value'],
													expires: output.pattern.setCookie[property]['expires']
												}));
											}
											response.setHeader('Set-Cookie', cookie);
										}
										response.write(helper.renderView(output.pattern));
										response.end();
									});
								}
							} catch ( e ) {
								methods.private.error(params, e);
							}
						} else {
							staticPath = config.webRoot + route.name;
							fs.exists(staticPath, function (exists) {
								if ( exists ) {
									fs.readFile(staticPath, function (err, data) {
										if ( err ) {
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
						};
					}).listen(config.httpPort);
				}

			},

			private: {

				error: function (params, e) {
					switch ( config.mode ) {
						case 'production':
							console.log(util.inspect(e, { depth: null }));
							// TODO: redirect to the error pattern
							params.response.end();
							break;
						case 'development':
						case 'debug':
							params.response.end(e.stack);
							break;
					};
				},

				buildCookie: function (args) {
					var defaults = {
							ssl: false,
							path: '/',
							expires: 0
						},
						cookie = helper.extend(defaults, args),
						cookieExpires = '';

					if ( cookie.expires > 0 ) {
						cookieExpires = new Date();
						cookieExpires.setTime(cookieExpires.getTime() + cookie.expires);
						cookieExpires = cookieExpires.toUTCString();
					}

					return cookie.name + '=' + cookie.value + ';path=' + cookie.path + ';expires=' + cookieExpires + ';';
				}

			}
		};

	return methods.public;
};