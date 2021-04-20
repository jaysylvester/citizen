// Initializes the framework

// node
import fs from 'fs'
import os from 'os'
import path from 'path'
import url from 'url'
// citizen
import * as cache from './cache.js'
import * as helpers from './helpers.js'

console.log('\nInitializing citizen...\n')

const
  // citizen
  appPath       = path.resolve(url.fileURLToPath(import.meta.url), '../../../../app'),
  defaultConfig = {
    host                  : '',
    citizen: {
      mode                : 'production',
      http: {
        enable            : true,
        hostname          : '127.0.0.1',
        port              : 80
      },
      https: {
        enable            : false,
        hostname          : '127.0.0.1',
        port              : 443,
        secureCookies     : true
      },
      module              : 'esm',
      connectionQueue     : null,
      fallbackController  : '',
      templateEngine      : 'handlebars',
      compression: {
        enable            : false,
        force             : false,
        mimeTypes         : 'text/plain text/html text/css application/x-javascript application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml'
      },
      sessions            : false,
      sessionTimeout      : 20, // 20 minutes
      layout: {
        controller        : '',
        view              : ''
      },
      legalFormat: {
        html              : true,
        json              : false,
        jsonp             : false
      },
      form: {},
      cache: {
        application: {
          enable          : true,
          lifespan        : 15,
          resetOnAccess   : true,
          overwrite       : false,
          encoding        : 'utf-8',
          synchronous     : false
        },
        static: {
          enable          : false,
          lifespan        : 15,
          resetOnAccess   : true
        },
        invalidUrlParams  : 'warn',
        control           : {}
      },
      log: {
        console: {
          error           : false,
          request         : false,
          status          : false
        },
        file: {
          error           : false,
          request         : false,
          status          : false,
          maxFileSize     : 10000,
          watcher: {
            interval      : 60000
          }
        }
      },
      development: {
        debug: {
          scope: {
            config        : true,
            context       : true,
            cookie        : true,
            form          : true,
            payload       : true,
            request       : false,
            response      : false,
            route         : true,
            session       : true,
            url           : true,
          },
          depth           : 3,
          showHidden      : false,
          view            : false
        },
        enableCache       : false,
        watcher: {
          custom          : [],
          interval        : 500,
          killSession     : false
        }
      },
      urlPaths:  {
        app               : '/'
      },
      directories:  {
        app               : appPath,
        hooks             : path.join(appPath, '/hooks'),
        logs              : path.join(appPath, '/logs'),
        controllers       : path.join(appPath, '/patterns/controllers'),
        models            : path.join(appPath, '/patterns/models'),
        views             : path.join(appPath, '/patterns/views'),
        web               : path.resolve(appPath, '../web')
      },
      mimetypes           : JSON.parse(fs.readFileSync(path.resolve(url.fileURLToPath(import.meta.url), '../../config/mimetypes.json')))
    }
  },
  workingConfig = getConfig(),
  finalConfig = helpers.extend(defaultConfig, workingConfig),
  on = {
    request: {
      start : (params) => { 
        // Log the request parameters for debugging
        let remoteHost = ( params ? params.request.headers['x-forwarded-for'] || params.request.connection.remoteAddress || params.request.socket.remoteAddress || ( params.request.connection.socket ? params.request.connection.socket.remoteAddress : 'undefined' ) : 'undefined' ).replace('::ffff:', '')
        helpers.log({
          type      : 'request',
          label     : 'Remote host ' + remoteHost + ' requested ' + params.route.url,
          divider   : { top: CTZN.config.citizen.mode === 'development' ? true : false }
        })
        let logContent = {}
        CTZN.config.citizen.development.debug.scope.request ? logContent.request = params.request : false
        CTZN.config.citizen.development.debug.scope.response ? logContent.response = params.response : false
        CTZN.config.citizen.development.debug.scope.route ? logContent.route = params.route : false
        CTZN.config.citizen.development.debug.scope.url ? logContent.url = params.url : false
        CTZN.config.citizen.development.debug.scope.cookie ? logContent.cookie = params.cookie : false
        CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
        helpers.log({
          label     : 'Request parameters',
          content   : logContent,
          timestamp : false
        })
      },
      end   : () => {}
    },
    response: {
      start : () => {},
      end   : (params, context) => { 
        // Log the response parameters for debugging
        let logContent = {}
        CTZN.config.citizen.development.debug.scope.request ? logContent.request = params.request : false
        CTZN.config.citizen.development.debug.scope.response ? logContent.response = params.response : false
        CTZN.config.citizen.development.debug.scope.route ? logContent.route = params.route : false
        CTZN.config.citizen.development.debug.scope.url ? logContent.url = params.url : false
        CTZN.config.citizen.development.debug.scope.cookie ? logContent.cookie = params.cookie : false
        CTZN.config.citizen.development.debug.scope.session ? logContent.session = params.session : false
        CTZN.config.citizen.development.debug.scope.form ? logContent.form = params.form : false
        CTZN.config.citizen.development.debug.scope.payload ? logContent.payload = params.payload : false
        CTZN.config.citizen.development.debug.scope.context ? logContent.context = context : false
        helpers.log({
          label     : 'Post-response parameters and context',
          content   : logContent,
          divider   : { bottom: true },
          timestamp : false
        })
      }
    },
    session: {
      start : () => {},
      end   : () => {}
    }
  },
  appOn    = getAppOn(),
  patterns = getPatterns()

global.CTZN = {
  cache     : {},
  config    : finalConfig,
  on        : on,
  appOn     : appOn,
  patterns  : patterns,
  sessions  : {},
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
      'cors',
      'ctzn_referer',
      'expires',
      'id',
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
}

CTZN.config.citizen.compression.mimeTypes  = CTZN.config.citizen.compression.mimeTypes.split(' ')
CTZN.config.citizen.sessionTimeout         = CTZN.config.citizen.sessionTimeout * 60000

function getConfig() {
  var configDirectory = path.join(appPath, '/config'),
      files           = [],
      config          = {}

  console.log('Loading configuration:\n')
  // If there isn't a config directory, return an empty config.
  // citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory)
  } catch ( err ) {
    console.log('  No valid configuration files found. Loading default config.\n')
    return config
  }

  files.forEach( function (file) {
    var parsedConfig,
        configRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/)

    if ( configRegex.test(file) ) {
      parsedConfig = JSON.parse(fs.readFileSync(path.join(configDirectory, '/', file)))
      if ( parsedConfig.host === os.hostname() ) {
        config = parsedConfig
        console.log('  [host: ' + parsedConfig.host + '] ' + configDirectory + '/' + file + '\n')
      }
    }
  })

  if ( !config.host ) {
    try {
      config = JSON.parse(fs.readFileSync(path.join(configDirectory, '/citizen.json')))
      console.log('  ' + configDirectory + '/citizen.json\n')
    } catch ( err ) {
      // No big deal, citizen will start under the default configuration
    }
  }

  return config
}


function getAppOn() {
  var on       = {},
      files    = [],
      jsRegex  = new RegExp(/.*\.(js)|(cjs)|(mjs)$/)

  // If there isn't a hooks directory, return an empty object
  try {
    files = fs.readdirSync(finalConfig.citizen.directories.hooks)
  } catch ( e ) {
    console.log(e)
    console.log('\nNo valid app event handlers found. Skipping...\n')
    return on
  }

  console.log('\nInitializing app event handlers:\n')

  files.forEach( function (file) {
    if ( jsRegex.test(file) ) {
      console.log('  ' + finalConfig.citizen.directories.hooks + '/' + file)
      on[path.basename(file, path.extname(file))] = import(path.join(finalConfig.citizen.directories.hooks, '/', file))
    }
  })

  console.log('\n')

  return on
}


function getPatterns() {
  var patterns = {
        controllers : {},
        models      : {},
        views       : {}
      },
      controllers = [],
      models      = [],
      views       = [],
      jsRegex     = new RegExp(/.*\.(js)|(cjs)|(mjs)$/),
      viewRegex   = new RegExp(/.+\.(.+)/)

  try {
    controllers = fs.readdirSync(finalConfig.citizen.directories.controllers)
    models      = fs.readdirSync(finalConfig.citizen.directories.models)
    views       = fs.readdirSync(finalConfig.citizen.directories.views)
  } catch ( err ) {
    console.log('There was an error while attempting to traverse the pattern directories. Check your file structure and make sure you have all the required directories (controllers, models, and views).\n')
  }

  console.log('Initializing controllers:\n')

  controllers.forEach( function (file) {
    if ( jsRegex.test(file) ) {
      console.log('  ' + finalConfig.citizen.directories.controllers + '/' + file)
      patterns.controllers[path.basename(file, path.extname(file))] = import(path.join(finalConfig.citizen.directories.controllers, '/', file))
    }
  })

  if ( models.length > 0 ) {
    console.log('\n\nInitializing models:\n')

    models.forEach( function (file) {
      if ( jsRegex.test(file) ) {
        console.log('  ' + finalConfig.citizen.directories.models + '/' + file)
        patterns.models[path.basename(file, path.extname(file))] = import(path.join(finalConfig.citizen.directories.models, '/', file))
      }
    })
  } else {
    console.log('\nNo models found. Skipping...\n')
  }

  console.log('\n\nValidating views:\n')

  views.forEach( function (directory) {
    var viewFiles
    if ( fs.statSync(path.join(finalConfig.citizen.directories.views, '/', directory)).isDirectory() ) {
      viewFiles = fs.readdirSync(path.join(finalConfig.citizen.directories.views, '/', directory))
      patterns.views[directory] = {}
      viewFiles.forEach( function (file) {
        var filePath,
            fileExtension,
            viewName
        
        if ( viewRegex.test(file) ) {
          console.log('  ' + finalConfig.citizen.directories.views + '/' + directory + '/' + file)
          filePath = path.join(finalConfig.citizen.directories.views, '/', directory, '/', file)
          fileExtension = path.extname(file)
          viewName = path.basename(file, fileExtension)
          patterns.views[directory][viewName] = {
            path: filePath
          }
        }
      })
    }
  })

  console.log('')

  return patterns
}

import * as server from './server.js'
import * as sessionExp from './session.js'

export const config = finalConfig
export const controllers = patterns.controllers
export const models = patterns.models
export const views = patterns.views
export const session = sessionExp
export const start = server.start
export { cache }
export const log = helpers.log
