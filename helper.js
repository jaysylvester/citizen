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
                        patternName = '',
                        patternFileName = '',
                        viewContents = '',
                        regex = new RegExp(/^([A-Za-z0-9-_])*$/);

                    patternFiles.forEach( function (patternFileName, index, array) {
                        if ( regex.test(patternFileName) ) {
                            patternName = patternFileName.replace('-', '_');
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
                    });

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

                isNumeric: function (n) {
                  return !isNaN(parseFloat(n)) && isFinite(n);
                },

                // TODO: create an optional timer to handle emitters that haven't been called due to error
                listener: function (functions, callback) {
                    var emitter = {},
                        output = {},
                        ready = {},
                        groupTracker = function () {
                            var allReady = true;

                            for ( var property in ready ) {
                                if ( ready[property] === false ) {
                                    allReady = false;
                                    break;
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
                        if ( functions[property]['args'] ) {
                            functions[property]['method'](functions[property]['args'], emitter);
                        } else {
                            functions[property]['method'](emitter);
                        }
                    };
                },

                on: function (event, methods) {
                    methods.extend(events[event], methods);
                },

                renderView: function (view, format, context) {
                    var viewName = view.replace(/-/, ''),
                        viewOutput = '';

                    switch ( format ) {
                        case 'html':
                            switch ( config.mode ) {
                                case 'production':
                                    viewOutput = app.patterns[viewName].view.compiled(context);
                                    break;
                                case 'debug':
                                case 'development':
                                    viewOutput = fs.readFileSync(config.patternPath + '/' + view + '/' + view + '.html', { 'encoding': 'utf8' });
                                    viewOutput = handlebars.compile(viewOutput);
                                    viewOutput = viewOutput(context);
                                    if ( context.debugOutput ) {
                                        viewOutput = viewOutput.replace('</body>', '<div id="citizen-debug"><pre>' + context.debugOutput + '</pre></div></body>');
                                    }
                                    break;
                            }
                            break;
                        case 'json':
                            viewOutput = JSON.stringify(context.content);
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