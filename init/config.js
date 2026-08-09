// config
//
// Loads the project environment and resolves Citizen's framework configuration.

// node
import fs                from 'node:fs'
import path              from 'node:path'
import { loadEnvFile }   from 'node:process'
import { pathToFileURL } from 'node:url'
// citizen
import helpers           from '../lib/helpers.js'


function getDefaults(options = {}) {
  let app  = path.resolve(options.appPath || 'app'),
      mode = options.nodeEnv || 'production',
      root = path.dirname(app)

  return {
    mode: mode,
    global: 'app',
    http: {
      enabled: true,
      hostname: '127.0.0.1',
      port: 80
    },
    https: {
      cert: '',
      enabled: false,
      hostname: '127.0.0.1',
      key: '',
      pfx: '',
      port: 443,
      secureCookies: true
    },
    connectionQueue: null,
    templateEngine: 'templateLiterals',
    compression: {
      enabled: false,
      force: false,
      // Mimetypes that should be sent in compressed format
      mimeTypes: [
        'application/javascript',
        'application/x-javascript',
        'application/xml',
        'application/xml+rss',
        'image/svg+xml',
        'text/css',
        'text/html',
        'text/javascript',
        'text/plain',
        'text/xml'
      ]
    },
    sessions: {
      enabled: false,
      lifespan: 20 // minutes
    },
    layout: {
      controller: '',
      view: ''
    },
    // Allowable response content types
    contentTypes: [
      'text/html',
      'text/plain',
      'application/json',
      'application/javascript'
    ],
    forms: {
      enabled: true,
      maxPayloadSize: 524288 // 0.5MB
    },
    cache: {
      application: {
        enabled: true,
        lifespan: 15, // minutes
        resetOnAccess: true,
        encoding: 'utf-8',
        synchronous: false
      },
      static: {
        enabled: false,
        lifespan: 15, // minutes
        resetOnAccess: true
      },
      invalidUrlParams: 'warn',
      control: {}
    },
    errors: 'capture',
    logs: {
      access: false, // performance-intensive, opt-in only
      error: {
        client: true, // 400 errors
        server: true // 500 errors
      },
      debug: false,
      maxFileSize: 10000,
      watcher: {
        interval: 60000
      }
    },
    development: {
      debug: {
        scope: {
          config: true,
          context: true,
          cookie: true,
          form: true,
          payload: true,
          route: true,
          session: true,
          url: true
        },
        depth: 4,
        showHidden: false,
        view: false
      },
      watcher: {
        custom: [],
        ignored: /(^|[/\\])\../, // Ignore dotfiles
        interval: 100,
        killSession: false
      }
    },
    urlPath: '/',
    directories: {
      app: app,
      controllers: path.join(app, 'controllers'),
      helpers: path.join(app, 'helpers'),
      models: path.join(app, 'models'),
      views: path.join(app, 'views'),
      logs: path.join(root, 'logs'),
      web: path.join(root, 'web')
    }
  }
}


function checkApp(app) {
  try {
    if ( fs.statSync(app).isDirectory() ) return
  } catch ( err ) {
    if ( err.code !== 'ENOENT' && err.code !== 'ENOTDIR' ) throw err
  }

  throw new Error('Application directory not found: ' + app + '. Run citizen from the project root or set CITIZEN_APP_PATH to an absolute path in the process environment.')
}


function checkLegacy(app) {
  let configDirectory = path.join(app, 'config'),
      files

  try {
    files = fs.readdirSync(configDirectory).filter( file => /^[A-Za-z0-9_-]*\.json$/.test(file) )
  } catch ( err ) {
    if ( err.code === 'ENOENT' || err.code === 'ENOTDIR' ) return
    throw err
  }

  if ( files.length ) {
    throw new Error('JSON configuration files are no longer supported. Move framework settings from ' + configDirectory + ' to ' + path.resolve(app, '../citizen.config.js') + ' and application values to ' + path.resolve(app, '../.env') + '. See MIGRATION.md.')
  }
}


function loadEnv(root) {
  let file = path.join(root, '.env')

  if ( !fs.existsSync(file) ) return null

  loadEnvFile(file)
  return file
}


async function loadProjectConfig(root) {
  let file = path.join(root, 'citizen.config.js'),
      module

  if ( !fs.existsSync(file) ) return { config: {}, file: null }

  module = await import(pathToFileURL(file).href)
  if ( !Object.hasOwn(module, 'default') || !module.default || module.default.constructor !== Object ) {
    throw new TypeError(file + ' must default-export a plain object.')
  }

  return { config: module.default, file: file }
}


function resolve(projectConfig = {}, options = {}) {
  let app = path.resolve(options.appPath || 'app'),
      config = helpers.extend(getDefaults({ appPath: app, nodeEnv: options.nodeEnv }), projectConfig),
      root = path.dirname(app)

  config.directories.app = app
  Object.keys(config.directories).forEach( directory => {
    if ( directory !== 'app' ) config.directories[directory] = path.resolve(root, config.directories[directory])
  })

  return config
}


async function configure(options = {}) {
  let appVariable = Object.hasOwn(process.env, 'CITIZEN_APP_PATH'),
      selectedApp = options.appPath || process.env.CITIZEN_APP_PATH || 'app',
      app,
      root,
      envFile,
      project

  if ( !options.appPath && appVariable && !path.isAbsolute(selectedApp) ) {
    throw new TypeError('CITIZEN_APP_PATH must be an absolute path.')
  }
  app = path.resolve(selectedApp)
  root = path.dirname(app)

  console.log('\n\n\x1b[1m[' + new Date().toISOString() + ']\x1b[0m Starting citizen...')
  console.log('\n\nLoading configuration:\n')

  checkApp(app)
  checkLegacy(app)
  envFile = loadEnv(root)
  if ( !appVariable && envFile && Object.hasOwn(process.env, 'CITIZEN_APP_PATH') ) {
    delete process.env.CITIZEN_APP_PATH
    console.warn('  Ignored CITIZEN_APP_PATH from .env; set it in the process environment before importing citizen to select another app directory.')
  }
  project = await loadProjectConfig(root)

  if ( envFile ) {
    console.log('  Loaded project environment: ' + envFile)
  } else {
    console.log('  No project .env loaded (optional); using the process environment.')
  }
  if ( project.file ) {
    console.log('  Loaded Citizen configuration: ' + project.file + '\n')
  } else {
    console.log('  No citizen.config.js found (optional); using Citizen defaults.\n')
  }

  return resolve(project.config, { appPath: app, nodeEnv: process.env.NODE_ENV })
}


export { checkApp, checkLegacy, getDefaults, loadEnv, loadProjectConfig, resolve }
export default configure
