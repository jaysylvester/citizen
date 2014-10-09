// Initializes the framework

'use strict';
/* jshint node: true */
/* global CTZN: false */

var fs = require('fs'),
    handlebars = require('handlebars'),
    jade = require('jade'),
    helpers = require('./helpers'),
    os = require('os'),
    path = require('path'),
    util = require('util'),
    appPath = path.dirname(module.parent.parent.filename),
    defaultConfig = {
      mode: 'production',
      directories:  {
        app: appPath,
        // logs: appPath + '/logs',
        logs: path.join(appPath, '/logs'),
        // on: appPath + '/on',
        on: path.join(appPath, '/on'),
        // controllers: appPath + '/patterns/controllers',
        controllers: path.join(appPath, '/patterns/controllers'),
        // models: appPath + '/patterns/models',
        models: path.join(appPath, '/patterns/models'),
        // views: appPath + '/patterns/views',
        views: path.join(appPath, '/patterns/views'),
        public: path.resolve(appPath, '../public')
      },
      urlPaths:  {
        app:   '/',
        fileNotFound: '/404.html'
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
    finalConfig = helpers.extend(defaultConfig, config.citizen),
    on = {
      application: {
        start: function (emitter) {
          // TODO: Log handler
          // helpers.log({
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
  helpers: helpers,
  listen: helpers.listen,
  handlebars: handlebars,
  jade: jade,
  controllers: patterns.controllers,
  models: patterns.models,
  views: patterns.views,
  start: server.start,
  session: session
};

function getConfig() {
  var configDirectory = path.join(appPath, '/config'),
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
      citizenConfig = JSON.parse(fs.readFileSync(path.join(configDirectory, '/', file)));
      if ( citizenConfig.hostname && citizenConfig.hostname === os.hostname() ) {
        config.citizen = citizenConfig;
      }
    } else if ( appRegex.test(file) ) {
      fileSafeName = file.replace('/-/g', '_');
      fileSafeName = fileSafeName.replace('.json', '');
      config[fileSafeName] = JSON.parse(fs.readFileSync(path.join(configDirectory, '/', file)));
    }
  });

  if ( !config.citizen ) {
    try {
      config.citizen = JSON.parse(fs.readFileSync(path.join(configDirectory, '/citizen.json')));
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
      on[fileSafeName] = require(path.join(finalConfig.directories.on, '/', file));
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
  } catch ( err ) {
    throw {
      thrownBy: 'citizen.getPatterns()',
      message: 'There was an error while attempting to traverse the pattern directories. Check your file structure and make sure you have all the required directories (controllers, models, and views).'
    };
  }

  controllers.forEach( function (file, index, array) {
    if ( jsRegex.test(file) ) {
      patterns.controllers[path.basename(file, '.js')] = require(path.join(finalConfig.directories.controllers, '/', file));
    }
  });

  models.forEach( function (file, index, array) {
    if ( jsRegex.test(file) ) {
      patterns.models[path.basename(file, '.js')] = require(path.join(finalConfig.directories.models, '/', file));
    }
  });

  views.forEach( function (directory, index, array) {
    var viewFiles;
    if ( fs.statSync(path.join(finalConfig.directories.views, '/', directory)).isDirectory() ) {
      viewFiles = fs.readdirSync(path.join(finalConfig.directories.views, '/', directory));
      patterns.views[directory] = {};
      viewFiles.forEach( function (file, index, array) {
        var fileExtension,
            viewName,
            viewContents;
        if ( viewRegex.test(file) ) {
          fileExtension = path.extname(file);
          viewName = path.basename(file, fileExtension);
          viewContents = fs.readFileSync(path.join(finalConfig.directories.views, '/', directory, '/', file), { 'encoding': 'utf8' });
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
