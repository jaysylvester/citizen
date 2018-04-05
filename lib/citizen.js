// Initializes the framework

'use strict';

console.log('\nInitializing citizen...\n');

var fs            = require('fs'),
    helpers       = require('./helpers'),
    os            = require('os'),
    path          = require('path'),
    appPath       = path.dirname(module.parent.filename),
    defaultConfig = {
      host: '',
      citizen: {
        mode: 'production',
        http: {
          enable: true,
          hostname: '127.0.0.1',
          port: 80
        },
        https: {
          enable: false,
          hostname: '127.0.0.1',
          port: 443,
          secureCookies: true
        },
        connectionQueue: null,
        fallbackController: '',
        templateEngine: 'handlebars',
        compression: {
          enable: false,
          force: false,
          mimeTypes: 'text/plain text/html text/css application/x-javascript application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml'
        },
        sessions: false,
        sessionTimeout: 20, // 20 minutes
        requestTimeout: 0.5, // 30 seconds
        layout: {
          controller: '',
          view: ''
        },
        formats: {
          html: {
            enable: true
          },
          json: {
            enable: false,
            urlDelimiter: '-'
          },
          jsonp: {
            enable: false,
            urlDelimiter: '-'
          }
        },
        forms: {
          global: {},
          controller: {}
        },
        cache: {
          application: {
            enable: true,
            lifespan: 15,
            resetOnAccess: true,
            overwrite: false,
            encoding: 'utf-8',
            synchronous: false
          },
          static: {
            enable: false,
            lifespan: 15,
            resetOnAccess: true
          },
          invalidUrlParams: 'warn',
          control: {}
        },
        log: {
          toConsole: false,
          toFile: false,
          path: path.join(appPath, '/logs'),
          defaultFile: 'citizen.txt',
          application: {
            status: true,
            errors: true
          },
          static: {
            status: true,
            errors: true
          }
        },
        debug: {
          output: 'console',
          depth: 2,
          disableCache: true
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
    finalConfig = helpers.extend(defaultConfig, config),
    on = {
      application: {
        start: function (emitter) {
          emitter.emit('ready');
        },
        end: function (params, emitter) {
          emitter.emit('ready');
        },
        error: function (err, params, context, emitter) {
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
    cache = require('./cache'),
    server = require('./server'),
    session = require('./session');


global.CTZN = {
  cache: {},
  config: finalConfig,
  on: on,
  appOn: appOn,
  patterns: patterns,
  reserved: {
    content: [
      'config',
      'cookie',
      'form',
      'payload',
      'request',
      'response',
      'route',
      'session',
      'url'
      // The include scope isn't susceptible to content overwrites, so leave it off
      // the list for now. Includes break if this is enabled, so that will have to be
      // fixed if this changes.
      // 'include'
    ],
    cookie: [
      'ctzn_referer',
      'ctzn_sessionID'
    ],
    session: [
      'ctzn_referer',
      'id',
      'expires',
      'started',
      'timer'
    ],
    url: [
      'action',
      'callback',
      'format',
      'output',
      'show',
      'task',
      'type',
      'ctzn_debug',
      'ctzn_debugColors',
      'ctzn_debugDepth',
      'ctzn_debugShowHidden',
      'ctzn_dump'
    ]
  }
};

CTZN.config.citizen.compression.mimeTypes = CTZN.config.citizen.compression.mimeTypes.split(' ');
CTZN.config.citizen.requestTimeout = CTZN.config.citizen.requestTimeout * 60000;
CTZN.config.citizen.sessionTimeout = CTZN.config.citizen.sessionTimeout * 60000;

if ( CTZN.config.citizen.sessions ) {
  CTZN.sessions = {};
}

module.exports = {
  config: finalConfig,
  controllers: patterns.controllers,
  models: patterns.models,
  views: patterns.views,
  start: server.start,
  cache: cache.public,
  session: session.public,
};

// export public helper methods
for ( var property in helpers ) {
  if ( helpers.hasOwnProperty(property) ) {
    module.exports[property] = helpers[property];
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
      if ( parsedConfig.host === os.hostname() ) {
        config = parsedConfig;
        console.log('  [host: ' + parsedConfig.host + '] ' + configDirectory + '/' + file + '\n');
      }
    }
  });

  if ( !config.host ) {
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
      jsRegex = new RegExp(/.+\.js$/);

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

  console.log('\n\nLogging views:\n');

  views.forEach( function (directory, index, array) {
    var viewFiles;
    if ( fs.statSync(path.join(finalConfig.citizen.directories.views, '/', directory)).isDirectory() ) {
      viewFiles = fs.readdirSync(path.join(finalConfig.citizen.directories.views, '/', directory));
      patterns.views[directory] = {};
      viewFiles.forEach( function (file) {
        var filePath,
            fileExtension,
            viewName;
            
        console.log('  ' + finalConfig.citizen.directories.views + '/' + directory + '/' + file);
        filePath = path.join(finalConfig.citizen.directories.views, '/', directory, '/', file);
        fileExtension = path.extname(file);
        viewName = path.basename(file, fileExtension);
        patterns.views[directory][viewName] = {
          path: filePath
        };
      });
    }
  });

  console.log('');

  return patterns;
}
