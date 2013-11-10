// core framework functions

module.exports = function (config) {
	var events = require('events'),
		fs = require('fs'),
		handlebars = require('handlebars'),
		util = require('util'),
		methods = {
			public: {

				cachePatterns: function (path) {
					var patterns = {},
						patternFiles = fs.readdirSync(path),
						patternCount = patternFiles.length,
						patternName = '',
						viewContents = '',
						regex = new RegExp(/^([A-Za-z0-9-_])*$/);
					for ( var i = 0; i < patternCount; i += 1 ) {
						patternName = patternFiles[i];
						if ( regex.test(patternName) ) {
							try {
								viewContents = fs.readFileSync(path + '/' + patternName + '/' + patternName + '.html', { 'encoding': 'utf8' });
								viewContents = viewContents.replace(/[\n|\t|\r]/g, '');
								viewContents = viewContents.replace(/'/g, "\\'");
								eval("patterns." + patternName + " = {}");
								eval("patterns." + patternName + ".controller = require('" + path + "/" + patternName + "/" + patternName + "-controller')");
								eval("patterns." + patternName + ".model = require('" + path + "/" + patternName + "/" + patternName + "-model')");
								eval("patterns." + patternName + ".view = {}");
								eval("patterns." + patternName + ".view.raw = '" + viewContents + "'");
								eval("patterns." + patternName + ".view.compiled = handlebars.compile(viewContents)");
							} catch (e) {
								console.log(util.inspect(e));
							}
						}
					};
					return patterns;
				},

				chain: function (params, emitter, functions) {
					var emitters = {},
						firstProperty = {},
						firstPropertySet = false,
						previousProperty = {},
						output = {},
						ready = {};

					function chainTracker() {
						var allReady = true;

						for ( var property in ready ) {
							if ( ready[property] === false ) {
								allReady = false;
							}
						}

						if ( allReady ) {
							emitter.emit('ready', output);
						}
					};

					for ( var property in functions ) {
						eval("ready." + property + " = false");
					};


					// Create an array containing the incoming functions and their 'ready' emitters in reverse order,
					// then loop over the array, firing each function and passing the next function (next index)
					// into the current function as a callback. At the end of the array, fire the final function
					// and pass the chain group 'ready' emitter as the final callback.

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

				group: function (params, functions, callback) {
					var emitters = {},
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
						eval("ready." + property + " = false");
					};

					for ( var property in functions ) {
						emitters = methods.public.mvcEmitterSet(property);
						emitters[property].controller.on('ready', function (result) {
							eval("ready." + property + " = true");
							eval("output." + property + " = result");
							groupTracker();
						});
						// Copies of params and emitters are passed so these functions can't pollute
						// the original objects upstream or interfere with each other
						functions[property](methods.public.copy(params), methods.public.copy(emitters));
					};
				},

				isNumeric: function (n) {
				  return !isNaN(parseFloat(n)) && isFinite(n);
				},

				mvcEmitterSet: function (name) {
					var emitters = {};

					emitters[name] = {};
					emitters[name].model = new events.EventEmitter();
					emitters[name].view = new events.EventEmitter();
					emitters[name].controller = new events.EventEmitter();

					return emitters;
				},

				renderView: function (view, params) {
					var template = eval('app.patterns.' + view + '.view.compiled'),
						viewOutput = '';

					switch ( params.route.format ) {
						case 'html':
							viewOutput = template(params);
							break;
						case 'json':
							viewOutput = JSON.stringify(params.content);
							break;
					}

					return viewOutput;
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
							val[i] = getValue(val[i]);
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