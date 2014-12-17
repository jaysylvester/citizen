// Initializes the framework

'use strict';

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
        logs: path.join(appPath, '/logs'),
        on: path.join(appPath, '/on'),
        controllers: path.join(appPath, '/patterns/controllers'),
        models: path.join(appPath, '/patterns/models'),
        views: path.join(appPath, '/patterns/views'),
        web: path.resolve(appPath, '../web')
      },
      urlPaths:  {
        app:   '',
        fileNotFound: '/404.html'
      },
      httpPort: 80,
      connectionQueue: undefined,
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
        depth: 2,
        enableCache: false,
        jade: false
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
            if ( !e.staticAsset ) {
              console.log(e);
              console.trace();
            }
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
  cache: {
    app: {},
    route: {},
    controller: {}
  },
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
  models: patterns.models,
  start: server.start,
  session: session,

  // helpers
  // TODO: Loop over helper exports so this list doesn't have to be maintained manually
  cache: helpers.cache,
  retrieve: helpers.retrieve,
  kill: helpers.kill,
  copy: helpers.copy,
  extend: helpers.extend,
  isNumeric: helpers.isNumeric,
  listen: helpers.listen,
  dashes: helpers.dashes,

  // template engines
  handlebars: handlebars,
  jade: jade
};

console.log('Configuration(s): \n' + util.inspect(config));
console.log('citizen is ready to accept requests on port ' + config.citizen.httpPort);

function getConfig() {
  var configDirectory = path.join(appPath, '/config'),
      files = [],
      config = {};

  console.log('Loading configuration...');
  // If there isn't a config directory, return an empty config.
  // citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory);
  } catch ( err ) {
    console.log('No valid configuration files found. Loading default config.');
    return config;
  }

  files.forEach( function (file, index, array) {
    var parsedConfig,
        configRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/);

    if ( configRegex.test(file) ) {
      parsedConfig = JSON.parse(fs.readFileSync(path.join(configDirectory, '/', file)));
      if ( parsedConfig.hostname && parsedConfig.hostname === os.hostname() ) {
        config = parsedConfig;
        console.log('app configuration loaded based on hostname [' + parsedConfig.hostname + ']: ' + configDirectory + '/' + file);
      }
    }
  });

  if ( !config.hostname ) {
    try {
      config = JSON.parse(fs.readFileSync(path.join(configDirectory, '/citizen.json')));
      console.log('citizen configuration loaded from file: ' + configDirectory + '/citizen.json');
    } catch ( err ) {
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
    console.log('No valid app event handlers found.');
    return on;
  }

  files.forEach( function (file, index, array) {
    if ( jsRegex.test(file) ) {
      console.log('Initializing app event handler: ' + finalConfig.directories.on + '/' + file);
      on[path.basename(file, '.js')] = require(path.join(finalConfig.directories.on, '/', file));
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
      console.log('Initializing controller: ' + finalConfig.directories.controllers + '/' + file);
      patterns.controllers[path.basename(file, '.js')] = require(path.join(finalConfig.directories.controllers, '/', file));
    }
  });

  models.forEach( function (file, index, array) {
    if ( jsRegex.test(file) ) {
      console.log('Initializing model: ' + finalConfig.directories.models + '/' + file);
      patterns.models[path.basename(file, '.js')] = require(path.join(finalConfig.directories.models, '/', file));
    }
  });

  views.forEach( function (directory, index, array) {
    var viewFiles;
    if ( fs.statSync(path.join(finalConfig.directories.views, '/', directory)).isDirectory() ) {
      viewFiles = fs.readdirSync(path.join(finalConfig.directories.views, '/', directory));
      patterns.views[directory] = {};
      viewFiles.forEach( function (file, index, array) {
        var filePath,
            fileExtension,
            viewName,
            viewContents;
        if ( viewRegex.test(file) ) {
          console.log('Compiling view: ' + finalConfig.directories.views + '/' + directory + '/' + file);
          filePath = path.join(finalConfig.directories.views, '/', directory, '/', file);
          fileExtension = path.extname(file);
          viewName = path.basename(file, fileExtension);
          viewContents = fs.readFileSync(filePath, { 'encoding': 'utf8' });
          switch ( fileExtension ) {
            case '.hbs':
              patterns.views[directory][viewName] = {
                engine: 'handlebars',
                path: filePath,
                raw: viewContents,
                compiled: handlebars.compile(viewContents)
              };
              break;
            case '.jade':
              patterns.views[directory][viewName] = {
                engine: 'jade',
                path: filePath,
                raw: viewContents
              };
              switch ( finalConfig.mode ) {
                case 'production':
                  patterns.views[directory][viewName].compiled = jade.compile(viewContents, {
                    filename: filePath,
                    compileDebug: false
                  });
                  break;
                case 'development':
                case 'debug':
                  patterns.views[directory][viewName].compiled = jade.compile(viewContents, {
                    filename: filePath,
                    pretty: true,
                    compileDebug: true
                  });
                  break;
              }
              break;
            case '.html':
              patterns.views[directory][viewName] = {
                engine: 'html',
                path: filePath,
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
