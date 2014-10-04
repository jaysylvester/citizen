// Initializes the framework

'use strict';
/* jshint node: true */
/* global CTZN: false */

var fs = require('fs'),
    handlebars = require('handlebars'),
    jade = require('jade'),
    helper = require('./helper'),
    os = require('os'),
    path = require('path'),
    util = require('util'),
    defaultConfig = {
      mode: 'production',
      directories:  {
        app: process.cwd(),
        logs: process.cwd() + '/logs',
        on: process.cwd() + '/on',
        controllers: process.cwd() + '/patterns/controllers',
        models: process.cwd() + '/patterns/models',
        views: process.cwd() + '/patterns/views',
        public: path.resolve(process.cwd(), '../public')
      },
      urlPaths:  {
        app:   '/',
        fileNotFound: '/index.html'
      },
      httpPort: 80,
      logs: {
        console: true,
        file: false
      },
      sessions: false,
      sessionTimeout: 1200000, // 20 minutes
      requestTimeout: 30000, // 30 seconds
      mimetypes: JSON.parse(fs.readFileSync(path.join(__dirname, '../config/mimetypes.json'))),
      debug: {
        output: 'console',
        depth: 2
      }
    },
    config = getConfig(),
    finalConfig = helper.extend(defaultConfig, config.citizen),
    on = {
      application: {
        start: function (emitter) {
          // TODO: Log handler
          // helper.log({
          //   modes: 'debug',
          //   log: 'citizen application start fired'
          // });
          emitter.emit('ready');
        },
        end: function (params, emitter) {
          emitter.emit('ready');
        },
        error: function (e, params, context, emitter) {
          if ( finalConfig.mode !== 'production' ) {
            console.log(e);
            console.trace();
          }
          emitter.emit('ready');
        }
      },
      request: {
        start: function (params, context, emitter) {
          emitter.emit('ready');
        },
        end: function (params, context, emitter) {
          emitter.emit('ready');
        }
      },
      response: {
        start: function (params, context, emitter) {
          emitter.emit('ready');
        },
        end: function (params, context, emitter) {
          emitter.emit('ready');
        }
      },
      session: {
        start: function (params, context, emitter) {
          emitter.emit('ready');
        },
        end: function (params, context, emitter) {
          emitter.emit('ready');
        }
      }
    },
    appOn = getAppOn(),
    patterns = getPatterns(),
    server = require('./server'),
    session = require('./session');

config.citizen = finalConfig;

global.CTZN = {
  config: config,
  on: on,
  appOn: appOn,
  patterns: patterns,
  handlebars: handlebars,
  jade: jade
};

if ( CTZN.config.citizen.sessions ) {
  CTZN.sessions = {};
}

module.exports = {
  config: config,
  helper: helper,
  listen: helper.listen,
  handlebars: handlebars,
  jade: jade,
  on: on,
  patterns: patterns,
  start: server.start,
  session: session
};

function getConfig() {
  var configDirectory = process.cwd() + '/config',
      files = [],
      config = {};

  // If there isn't a config directory, return an empty config.
  // citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory);
  } catch ( e ) {
    return config;
  }

  files.forEach( function (file, index, array) {
    var citizenConfig,
        citizenRegex = new RegExp(/^citizen[A-Za-z0-9_-]*\.json$/),
        appRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/),
        fileSafeName;

    if ( citizenRegex.test(file) ) {
      citizenConfig = JSON.parse(fs.readFileSync(configDirectory + '/' + file));
      if ( citizenConfig.hostname && citizenConfig.hostname === os.hostname() ) {
        config.citizen = citizenConfig;
      }
    } else if ( appRegex.test(file) ) {
      fileSafeName = file.replace('/-/g', '_');
      fileSafeName = fileSafeName.replace('.json', '');
      config[fileSafeName] = JSON.parse(fs.readFileSync(configDirectory + '/' + file));
    }
  });

  if ( !config.citizen ) {
    try {
      config.citizen = JSON.parse(fs.readFileSync(configDirectory + '/citizen.json'));
    } catch ( e ) {
      // No big deal, citizen will start under the default configuration
    }
  }

  return config;
}

function getAppOn() {
  var on = {},
      files = [],
      jsRegex = new RegExp(/.*\.js$/);

  // If there isn't an "on" directory, return an empty object
  try {
    files = fs.readdirSync(finalConfig.directories.on);
  } catch ( e ) {
    return on;
  }

  files.forEach( function (file, index, array) {
    var fileSafeName;
    if ( jsRegex.test(file) ) {
      fileSafeName = file.replace('.js', '');
      on[fileSafeName] = require(finalConfig.directories.on + '/' + file);
    }
  });

  return on;
}

function getPatterns() {
  var patterns = {
        controllers: {},
        models: {},
        views: {}
      },
      controllers = [],
      models = [],
      views = [],
      jsRegex = new RegExp(/.+\.js$/),
      viewRegex = new RegExp(/.+\.(hbs|jade|html)$/);

  try {
    controllers = fs.readdirSync(finalConfig.directories.controllers);
    models = fs.readdirSync(finalConfig.directories.models);
    views = fs.readdirSync(finalConfig.directories.views);
  } catch ( e ) {
    getGroupedPatterns();
    return;
  }

  controllers.forEach( function (file, index, array) {
    var fileSafeName;
    if ( jsRegex.test(file) ) {
      fileSafeName = file.replace('.js', '');
      patterns.controllers[fileSafeName] = require(finalConfig.directories.controllers + '/' + file);
    }
  });

  models.forEach( function (file, index, array) {
    var fileSafeName;
    if ( jsRegex.test(file) ) {
      fileSafeName = file.replace('.js', '');
      patterns.models[fileSafeName] = require(finalConfig.directories.models + '/' + file);
    }
  });

  views.forEach( function (directory, index, array) {
    var viewFiles;
    if ( fs.statSync(finalConfig.directories.views + '/' + directory).isDirectory() ) {
      viewFiles = fs.readdirSync(finalConfig.directories.views + '/' + directory);
      patterns.views[directory] = {};
      viewFiles.forEach( function (file, index, array) {
        var fileExtension,
            viewName,
            viewContents;
        if ( viewRegex.test(file) ) {
          fileExtension = path.extname(file);
          viewName = path.basename(file, fileExtension);
          viewContents = fs.readFileSync(finalConfig.directories.views + '/' + directory + '/' + file, { 'encoding': 'utf8' });
          switch ( fileExtension ) {
            case '.hbs':
              patterns.views[directory][viewName] = {
                engine: 'handlebars',
                raw: viewContents,
                compiled: handlebars.compile(viewContents)
              };
              break;
            case '.jade':
              patterns.views[directory][viewName] = {
                engine: 'jade',
                raw: viewContents,
                compiled: jade.compile(viewContents)
              };
              break;
            case '.html':
              patterns.views[directory][viewName] = {
                engine: 'html',
                raw: viewContents
              };
              break;
          }
        }
      });
    }
  });

  return patterns;
}

function getGroupedPatterns() {
  var patterns = {},
      patternFiles = fs.readdirSync(config.directories.patterns),
      patternName = '',
      patternFileName = '',
      viewContents = '',
      regex = new RegExp(/^([A-Za-z0-9-_])*$/);

  patternFiles.forEach( function (patternFileName, index, array) {
    if ( regex.test(patternFileName) ) {
      patternName = patternFileName.replace('/-/g', '_');
      try {
        viewContents = fs.readFileSync(config.directories.patterns + '/' + patternFileName + '/' + patternFileName + '.html', { 'encoding': 'utf8' });
        viewContents = viewContents.replace(/[\n|\t|\r]/g, '');
        viewContents = viewContents.replace(/'/g, "\\'");
        patterns[patternName] = {
          model: require(config.directories.patterns + '/' + patternFileName + '/' + patternFileName + '-model'),
          controller: require(config.directories.patterns + '/' + patternFileName + '/' + patternFileName + '-controller'),
          view: {
            raw: viewContents,
            compiled: handlebars.compile(viewContents)
          }
        };
      } catch (e) {
        console.log(util.inspect(e));
        throw e;
      }
    }
  });

  return patterns;
}
