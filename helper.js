// core framework functions

module.exports = function (config) {
	var events = require('events'),
		fs = require('fs'),
		handlebars = require('handlebars'),
		util = require('util'),
		methods = {

			public: {

				cachePatterns: function () {
					var patterns = {},
						patternFiles = fs.readdirSync(config.patternPath),
						patternCount = patternFiles.length,
						patternName = '',
						patternFileName = '',
						viewContents = '',
						regex = new RegExp(/^([A-Za-z0-9-_])*$/);
					for ( var i = 0; i < patternCount; i += 1 ) {
						patternFileName = patternFiles[i];
						if ( regex.test(patternFileName) ) {
							patternName = patternFileName.replace('-', '');
							try {
								viewContents = fs.readFileSync(config.patternPath + '/' + patternFileName + '/' + patternFileName + '.html', { 'encoding': 'utf8' });
								viewContents = viewContents.replace(/[\n|\t|\r]/g, '');
								viewContents = viewContents.replace(/'/g, "\\'");
								patterns[patternName] = {
									model: require(config.patternPath + "/" + patternFileName + "/" + patternFileName + "-model"),
									controller: require(config.patternPath + "/" + patternFileName + "/" + patternFileName + "-controller"),
									view: {
										raw: viewContents,
										compiled: handlebars.compile(viewContents)
									}
								};
							} catch (e) {
								console.log(util.inspect(e));
							}
						}
					};
					return patterns;
				},

				// The following copy(), extend(), and getValue() functions were inspired by (meaning mostly stolen from)
				// Andrée Hanson:
				// http://andreehansson.se/

				copy: function (object) {
					var objectCopy = {};

					for ( var property in object ) {
						objectCopy[property] = methods.private.getValue(object[property]);
					}

					return objectCopy;
				},

				extend: function (original, extension) {
					var mergedObject = methods.public.copy(original);

					for ( var property in extension ) {
						mergedObject[property] = methods.private.getValue(extension[property]);
					}

					return mergedObject;
				},

				listener: function (functions, callback) {
					var emitter = {},
						output = {},
						ready = {},
						groupTracker = function () {
							var allReady = true;

							for ( var property in ready ) {
								if ( ready[property] === false ) {
									allReady = false;
								}
							}

							if ( allReady && typeof callback !== 'undefined' ) {
								callback(output);
							}
						};

					for ( var property in functions ) {
						ready[property] = false;
					};

					for ( var property in functions ) {
						emitter = new events.EventEmitter();
						emitter['name'] = property;
						emitter.on('ready', function (result) {
							ready[this.name] = true;
							output[this.name] = result;
							groupTracker();
						});
						functions[property]['method'](methods.public.copy(functions[property]['args']), emitter);
					};
				},

				isNumeric: function (n) {
				  return !isNaN(parseFloat(n)) && isFinite(n);
				},

				renderView: function (params) {
					var view = params.route.name.replace(/-/, ''),
						viewOutput = '';

					switch ( params.route.format ) {
						case 'html':
							switch ( config.mode ) {
								case 'production':
									viewOutput = app.patterns[view].view.compiled(params);
									break;
								case 'debug':
								case 'development':
									viewOutput = fs.readFileSync(config.patternPath + '/' + params.route.name + '/' + params.route.name + '.html', { 'encoding': 'utf8' });		
									viewOutput = viewOutput.replace(/[\n|\t|\r]/g, '');
									viewOutput = viewOutput.replace(/'/g, "\\'");
									viewOutput = handlebars.compile(viewOutput);
									viewOutput = viewOutput(params);
									break;
							}
							break;
						case 'json':
							viewOutput = JSON.stringify(params.content);
							break;
					}

					return viewOutput;
				},

				parseCookie: function (cookie) {
					var pairs = [],
						pair = [],
						cookies = {};

					if ( cookie ) {
						pairs = cookie.split(';');
						for ( var i = 0; i < pairs.length; i += 1 ) {
							pair = pairs[i].trim();
							pair = pair.split('=');
							cookies[pair[0]] = pair[1];
						}
					}

					return cookies;
				}
			},

			private: {

				getValue: function (obj) {
					var isArray = obj.constructor.toString().indexOf('Array') >= 0,
						isObject = obj.constructor.toString().indexOf('Object') >= 0,
						val,
						i = 0,
						l;

					if ( isArray ) {
						val = Array.prototype.slice.apply(obj);
						l = val.length;

						do {
							val[i] = methods.private.getValue(val[i]);
						} while (++i < l);
					} else if ( isObject ) {
						val = methods.public.copy(obj);
					} else {
						val = obj;
					}

					return val;
				}

			}
		};

	return methods.public;
};