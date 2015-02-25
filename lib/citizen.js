// Initializes the framework

'use strict';

console.log('\nInitializing citizen...\n');

var fs = require('fs'),
    handlebars = require('handlebars'),
    jade = require('jade'),
    helpers = require('./helpers'),
    os = require('os'),
    path = require('path'),
    appPath = path.dirname(module.parent.filename),
    defaultConfig = {
      hostname: '',
      citizen: {
        mode: 'production',
        http: {
          hostname: '127.0.0.1',
          port: 80
        },
        https: {
          hostname: '127.0.0.1',
          port: 443,
          secureCookies: true
        },
        connectionQueue: null,
        sessions: false,
        sessionTimeout: 1200000, // 20 minutes
        requestTimeout: 30000, // 30 seconds
        prettyHTML: true,
        log: {
          toConsole: false,
          toFile: false,
          path: path.join(appPath, '/logs'),
          defaultFile: 'citizen.txt',
          contents: {
            applicationErrors: true,
            applicationStatus: false,
            staticErrors: true,
            staticStatus: false
          }
        },
        debug: {
          output: 'console',
          depth: 2,
          disableCache: true,
          jade: false
        },
        urlPaths:  {
          app:   '/'
        },
        directories:  {
          app: appPath,
          logs: path.join(appPath, '/logs'),
          on: path.join(appPath, '/on'),
          controllers: path.join(appPath, '/patterns/controllers'),
          models: path.join(appPath, '/patterns/models'),
          views: path.join(appPath, '/patterns/views'),
          web: path.resolve(appPath, '../web')
        },
        mimetypes: JSON.parse(fs.readFileSync(path.join(__dirname, '../config/mimetypes.json')))
      }
    },
    config = getConfig(),
    finalConfig = helpers.public.extend(defaultConfig, config),
    on = {
      application: {
        start: function (emitter) {
          emitter.emit('ready');
        },
        end: function (params, emitter) {
          emitter.emit('ready');
        },
        error: function (err, params, context, emitter) {
          helpers.public.log({
            label: 'application error',
            content: err
          });
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

global.CTZN = {
  cache: {},
  config: finalConfig,
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
  config: finalConfig,
  controllers: patterns.controllers,
  models: patterns.models,
  views: patterns.views,
  start: server.start,
  session: session,

  // template engines
  handlebars: handlebars,
  jade: jade
};

// export helpers
for ( var property in helpers.public ) {
  if ( helpers.public.hasOwnProperty(property) ) {
    module.exports[property] = helpers.public[property];
  }
}

function getConfig() {
  var configDirectory = path.join(appPath, '/config'),
      files = [],
      config = {};

  console.log('Loading configuration...\n');
  // If there isn't a config directory, return an empty config.
  // citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory);
  } catch ( err ) {
    console.log('No valid configuration files found. Loading default config...\n');
    return config;
  }

  files.forEach( function (file, index, array) {
    var parsedConfig,
        configRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/);

    if ( configRegex.test(file) ) {
      parsedConfig = JSON.parse(fs.readFileSync(path.join(configDirectory, '/', file)));
      if ( parsedConfig.hostname === os.hostname() ) {
        config = parsedConfig;
        console.log('  [hostname: ' + parsedConfig.hostname + '] ' + configDirectory + '/' + file + '\n');
      }
    }
  });

  if ( !config.hostname ) {
    try {
      config = JSON.parse(fs.readFileSync(path.join(configDirectory, '/citizen.json')));
      console.log('  ' + configDirectory + '/citizen.json\n');
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
    files = fs.readdirSync(finalConfig.citizen.directories.on);
  } catch ( e ) {
    console.log('\nNo valid app event handlers found. Skipping...\n');
    return on;
  }

  console.log('\nInitializing app event handlers:\n');

  files.forEach( function (file, index, array) {
    if ( jsRegex.test(file) ) {
      console.log('  ' + finalConfig.citizen.directories.on + '/' + file);
      on[path.basename(file, '.js')] = require(path.join(finalConfig.citizen.directories.on, '/', file));
    }
  });

  console.log('\n');

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
    controllers = fs.readdirSync(finalConfig.citizen.directories.controllers);
    models = fs.readdirSync(finalConfig.citizen.directories.models);
    views = fs.readdirSync(finalConfig.citizen.directories.views);
  } catch ( err ) {
    console.log('There was an error while attempting to traverse the pattern directories. Check your file structure and make sure you have all the required directories (controllers, models, and views).\n');
  }

  console.log('Initializing controllers:\n');

  controllers.forEach( function (file, index, array) {
    if ( jsRegex.test(file) ) {
      console.log('  ' + finalConfig.citizen.directories.controllers + '/' + file);
      patterns.controllers[path.basename(file, '.js')] = require(path.join(finalConfig.citizen.directories.controllers, '/', file));
    }
  });

  if ( models.length > 0 ) {
    console.log('\n\nInitializing models:\n');

    models.forEach( function (file, index, array) {
      if ( jsRegex.test(file) ) {
        console.log('  ' + finalConfig.citizen.directories.models + '/' + file);
        patterns.models[path.basename(file, '.js')] = require(path.join(finalConfig.citizen.directories.models, '/', file));
      }
    });
  } else {
    console.log('\nNo models found. Skipping...\n');
  }

  console.log('\n\nCompiling views:\n');

  views.forEach( function (directory, index, array) {
    var viewFiles;
    if ( fs.statSync(path.join(finalConfig.citizen.directories.views, '/', directory)).isDirectory() ) {
      viewFiles = fs.readdirSync(path.join(finalConfig.citizen.directories.views, '/', directory));
      patterns.views[directory] = {};
      viewFiles.forEach( function (file, index, array) {
        var filePath,
            fileExtension,
            viewName,
            viewContents;
        if ( viewRegex.test(file) ) {
          console.log('  ' + finalConfig.citizen.directories.views + '/' + directory + '/' + file);
          filePath = path.join(finalConfig.citizen.directories.views, '/', directory, '/', file);
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
              switch ( finalConfig.citizen.mode ) {
                case 'production':
                  patterns.views[directory][viewName].compiled = jade.compile(viewContents, {
                    filename: filePath,
                    compileDebug: false,
                    pretty: finalConfig.citizen.prettyHTML
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

  console.log('');

  return patterns;
}
