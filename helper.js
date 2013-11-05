// core framework functions

var events = require('events'),
	fs = require('fs'),
	handlebars = require('handlebars'),
	util = require('util');

module.exports = {
	'cachePatterns': cachePatterns,
	'copy': copy,
	'group': group,
	'isNumeric': isNumeric,
	'mvcEmitterSet': mvcEmitterSet,
	'renderView': renderView
};

function cachePatterns(path) {
	var patterns = fs.readdirSync(path),
		patternCount = patterns.length,
		patternName = '',
		viewContents = '',
		regex = new RegExp(/^([A-Za-z0-9-_])*$/);
	for ( var i = 0; i < patternCount; i += 1 ) {
		patternName = patterns[i];
		if ( regex.test(patternName) ) {
			try {
				viewContents = fs.readFileSync(path + '/' + patternName + '/' + patternName + '.html', { 'encoding': 'utf8' });
				viewContents = viewContents.replace(/[\n|\t|\r]/g, '');
				viewContents = viewContents.replace(/'/g, "\\'");
				eval("app.patterns." + patternName + " = {}");
				eval("app.patterns." + patternName + ".controller = require('" + path + "/" + patternName + "/" + patternName + "-controller')");
				eval("app.patterns." + patternName + ".model = require('" + path + "/" + patternName + "/" + patternName + "-model')");
				eval("app.patterns." + patternName + ".view = {}");
				eval("app.patterns." + patternName + ".view.raw = '" + viewContents + "'");
				eval("app.patterns." + patternName + ".view.compiled = handlebars.compile(viewContents)");
			} catch (e) {
				console.log(util.inspect(e));
			}
		}
	};
};

function chain(params, emitter, functions) {
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

};

// The following copy() function was inspired by (meaning mostly stolen from)
// Andrée Hanson.
// http://andreehansson.se/

function copy(object) {
	var objectCopy = {};

	for ( var property in object ) {
		objectCopy[property] = getValue(object[property]);
	}

	return objectCopy;

	function getValue(obj) {
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
			val = copy(obj);
		} else {
			val = obj;
		}

		return val;
	};
};

function group(params, functions, callback) {
	var emitters = {},
		output = {},
		ready = {};

	function groupTracker() {
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
		emitters = mvcEmitterSet(property);
		emitters[property].controller.on('ready', function (result) {
			eval("ready." + property + " = true");
			eval("output." + property + " = result");
			groupTracker();
		});
		// Copies of params and emitters are passed so these functions can't pollute
		// the original objects upstream or interfere with each other
		functions[property](chode.helper.copy(params), chode.helper.copy(emitters));
	};
};

function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
};

function mvcEmitterSet(name) {
	var emitters = {};

	emitters[name] = {};
	emitters[name].model = new events.EventEmitter();
	emitters[name].view = new events.EventEmitter();
	emitters[name].controller = new events.EventEmitter();

	return emitters;
};

function renderView(view, params) {
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
};