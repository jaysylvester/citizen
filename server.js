// server

var events = require('events'),
	fs = require('fs'),
	http = require('http'),
	querystring = require('querystring'),
	util = require('util');

module.exports = {
	'start': start
};

function error(params, e) {
	switch ( chode.config.mode ) {
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
};

function start() {
	http.createServer( function (request, response) {
		var route = chode.router.getRoute(request.url), // Get the route name from the URL
			controller = {},
			emitters = {},
			staticPath = '',
			params = {},
			body = '',
			urlParams = chode.router.getUrlParams(request.url);

		// If it's a dynamic page request, fire the controller and serve the response when it's ready
		if ( !route.isStatic ) {

			params = {
				'chode': chode,
				'request': request,
				'response': response,
				'route': route,
				'urlParams': urlParams,
				'form': {}
			};

			try {
				emitters = chode.helper.mvcEmitterSet(route.name);
				controller[route.name] = eval("app.patterns." + route.name + ".controller");
			
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
						emitters[route.name].controller.on('ready', function (params) {
							response.write(chode.helper.renderView(route.name, params));
							response.end();
						});
						controller[route.name].handler(chode.helper.copy(params), chode.helper.copy(emitters));
						break;
					case 'POST':
						params.route.action = 'form';
						request.on('data', function (chunk) {
							body += chunk.toString();
						});
						request.on('end', function () {
							emitters[route.name].controller.on('ready', function (params) {
								response.write(chode.helper.renderView(route.name, params));
								response.end();
							});
							params.form = querystring.parse(body);
							controller[route.name].handler(chode.helper.copy(params), chode.helper.copy(emitters));
						});
						break;
				};
			} catch ( e ) {
				error(params, e);
			}
		} else {
			staticPath = chode.config.webRoot + route.name;
			fs.exists(staticPath, function (exists) {
				if ( exists ) {
					fs.readFile(staticPath, function (err, data) {
						if ( err ) {
							console.log(err);
							response.end();
						} else {
							console.log(data);
							response.write(data);
							response.end();
						}
					});
				} else {
					console.log('Missing file requested: ' + staticPath);
					response.statusCode = 404;
					response.end();
				}
			});
		};
	}).listen(chode.config.port);
};