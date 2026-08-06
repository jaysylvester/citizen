// config
//
// Resolves framework defaults and CITIZEN_* environment variables.

// node
import fs                from 'node:fs'
import path              from 'node:path'
import { loadEnvFile }   from 'node:process'
// citizen
import helpers           from '../lib/helpers.js'


const
  jsonEnv = new Map([
    ['CITIZEN_CORS',  ['cors']],
    ['CITIZEN_HTTP',  ['http']],
    ['CITIZEN_HTTPS', ['https']]
  ]),
  // Optional settings need a type for env coercion but must remain absent
  // from runtime defaults so the dependency can select platform behavior.
  optionalEnv = new Map([
    ['CITIZEN_DEVELOPMENT__WATCHER__USE_POLLING', {
      path: ['development', 'watcher', 'usePolling'],
      value: false
    }]
  ])


// Defaults

function getDefaults(options = {}) {
  let app = options.appPath || path.resolve('app'),
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
      lifespan: 20
    },
    layout: {
      controller: '',
      view: ''
    },
    contentTypes: [
      'text/html',
      'text/plain',
      'application/json',
      'application/javascript'
    ],
    forms: {
      enabled: true,
      maxPayloadSize: 524288
    },
    cache: {
      application: {
        enabled: true,
        lifespan: 15,
        resetOnAccess: true,
        encoding: 'utf-8',
        synchronous: false
      },
      static: {
        enabled: false,
        lifespan: 15,
        resetOnAccess: true
      },
      invalidUrlParams: 'warn',
      control: {}
    },
    errors: 'capture',
    logs: {
      access: false,
      error: {
        client: true,
        server: true
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
        ignored: /(^|[/\\])\../,
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


// Environment mapping

function getEnvMap(defaults) {
  let map = new Map()

  getLeaves(defaults).forEach( item => {
    let key = toEnv(item.path)

    if ( map.has(key) ) {
      throw new Error('Configuration paths ' + map.get(key).path.join('.') + ' and ' + item.path.join('.') + ' both map to ' + key)
    }
    map.set(key, item)
  })

  optionalEnv.forEach( (setting, key) => {
    if ( map.has(key) ) throw new Error('Optional environment variable ' + key + ' duplicates a default configuration path')
    map.set(key, setting)
  })

  return map
}


function getLeaves(object, configPath = [], leaves = []) {
  Object.entries(object).forEach( item => {
    let itemPath = [...configPath, item[0]],
        value = item[1]

    if ( value === null || Array.isArray(value) || value instanceof RegExp || typeof value !== 'object' || !Object.keys(value).length ) {
      leaves.push({ path: itemPath, value: value })
    } else {
      getLeaves(value, itemPath, leaves)
    }
  })

  return leaves
}


function getEnvConfig(env, defaults) {
  let applied = [],
      config = {},
      entries = Object.entries(env).filter( item => item[0].startsWith('CITIZEN_') && item[1] !== undefined ),
      map = getEnvMap(defaults),
      passthrough = [],
      unknown = []

  // Whole-object JSON is applied first so specific variables remain authoritative.
  entries.filter( item => jsonEnv.has(item[0]) ).forEach( item => {
    let parsed = parse(item[0], String(item[1]))

    if ( !parsed || Array.isArray(parsed) || typeof parsed !== 'object' ) {
      throw new TypeError(item[0] + ' must be a JSON object')
    }
    set(config, jsonEnv.get(item[0]), parsed)
    applied.push(item[0])
  })

  entries.filter( item => !jsonEnv.has(item[0]) ).forEach( item => {
    let key = item[0],
        server = key.match(/^CITIZEN_(HTTP|HTTPS)__(.+)$/),
        value = String(item[1])

    if ( map.has(key) ) {
      let setting = map.get(key)

      set(config, setting.path, coerce(key, value, setting.value))
      applied.push(key)
    } else if ( server && !server[2].includes('__') ) {
      set(config, [server[1].toLowerCase(), toCamel(server[2])], coerceOption(key, value))
      applied.push(key)
      passthrough.push(key)
    } else {
      unknown.push(key)
    }
  })

  return {
    config: config,
    applied: [...new Set(applied)].sort(),
    passthrough: [...new Set(passthrough)].sort(),
    unknown: [...new Set(unknown)].sort()
  }
}


function set(object, configPath, value) {
  let target = object

  configPath.slice(0, -1).forEach( part => {
    target[part] = target[part] || {}
    target = target[part]
  })
  target[configPath.at(-1)] = value
}


function coerce(key, value, defaultValue) {
  let parsed,
      trimmed = value.trim()

  if ( trimmed.startsWith('{') || trimmed.startsWith('[') ) {
    parsed = parse(key, value)
    if ( Array.isArray(defaultValue) && !Array.isArray(parsed) ) {
      throw new TypeError(key + ' must be a JSON array or a comma-separated list')
    } else if ( defaultValue?.constructor === Object && ( !parsed || Array.isArray(parsed) || typeof parsed !== 'object' ) ) {
      throw new TypeError(key + ' must be a JSON object')
    }
    return parsed
  } else if ( defaultValue instanceof RegExp ) {
    try {
      return new RegExp(value)
    } catch ( err ) {
      throw new TypeError(key + ' contains an invalid regular expression: ' + err.message)
    }
  } else if ( Array.isArray(defaultValue) ) {
    return value.split(',').map( item => item.trim() )
  } else if ( defaultValue?.constructor === Object ) {
    throw new TypeError(key + ' must be a JSON object')
  } else if ( defaultValue === null ) {
    if ( trimmed === 'null' || !trimmed ) return null

    parsed = Number(value)
    if ( Number.isNaN(parsed) ) throw new TypeError(key + ' must be a number or null')
    return parsed
  }

  switch ( typeof defaultValue ) {
    case 'boolean':
      if ( value === 'true' || value === '1' ) return true
      if ( value === 'false' || value === '0' ) return false
      if ( key === 'CITIZEN_COMPRESSION__FORCE' ) {
        if ( value === 'gzip' || value === 'deflate' ) return value
        throw new TypeError(key + ' must be true, false, 1, 0, gzip, or deflate')
      }
      throw new TypeError(key + ' must be true, false, 1, or 0')
    case 'number':
      parsed = Number(value)
      if ( Number.isNaN(parsed) ) throw new TypeError(key + ' must be a number')
      return parsed
    case 'string':
      return value
    default:
      parsed = Number(value)
      return value.trim() && !Number.isNaN(parsed) ? parsed : value
  }
}


function coerceOption(key, value) {
  let number,
      trimmed = value.trim()

  if ( trimmed.startsWith('{') || trimmed.startsWith('[') ) return parse(key, value)
  if ( value === 'true' ) return true
  if ( value === 'false' ) return false

  number = Number(value)
  return trimmed && !Number.isNaN(number) ? number : value
}


function parse(key, value) {
  try {
    return JSON.parse(value)
  } catch ( err ) {
    throw new TypeError(key + ' contains invalid JSON: ' + err.message)
  }
}


function toCamel(value) {
  return value.toLowerCase().replace(/_([a-z0-9])/g, (match, character) => character.toUpperCase())
}


function toEnv(configPath) {
  return 'CITIZEN_' + configPath.map( item => item.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() ).join('__')
}


// Loading and resolution

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
    throw new Error('JSON configuration files are no longer supported. Move settings from ' + configDirectory + ' to ' + path.resolve(app, '../.env') + '.')
  }
}


function loadEnv(app) {
  let file = path.resolve(app, '../.env')

  checkLegacy(app)
  if ( !fs.existsSync(file) ) return null

  validateEnv(file)
  loadEnvFile(file)
  return file
}


function validateEnv(file) {
  let lines = fs.readFileSync(file, 'utf8').split(/\r?\n/),
      quote = ''

  lines.forEach( (line, index) => {
    let value = line.trim()

    if ( quote ) {
      let end = value.indexOf(quote)

      if ( end < 0 ) return
      if ( value.slice(end + 1).trim().replace(/^#.*$/, '') ) throw new SyntaxError(file + ':' + ( index + 1 ) + ' contains invalid content after a quoted value')
      quote = ''
      return
    }

    if ( !value || value.startsWith('#') ) return
    value = value.replace(/^export\s+/, '')

    let match = value.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/)

    if ( !match ) throw new SyntaxError(file + ':' + ( index + 1 ) + ' is not a valid environment variable assignment')

    value = match[1].trimStart()
    if ( value.startsWith('"') || value.startsWith('\'') || value.startsWith('`') ) {
      quote = value[0]

      let end = value.indexOf(quote, 1)

      if ( end >= 0 ) {
        if ( value.slice(end + 1).trim().replace(/^#.*$/, '') ) throw new SyntaxError(file + ':' + ( index + 1 ) + ' contains invalid content after a quoted value')
        quote = ''
      }
    }
  })

  if ( quote ) throw new SyntaxError(file + ' contains an unterminated quoted value')
}


function resolve(env = {}, options = {}) {
  let defaults = getDefaults({
        appPath: options.appPath,
        nodeEnv: env.NODE_ENV
      }),
      result = getEnvConfig(env, defaults)

  return {
    config: helpers.extend(defaults, result.config),
    applied: result.applied,
    passthrough: result.passthrough,
    unknown: result.unknown
  }
}


function getConfig(options = {}) {
  return resolve(options.env || {}, options).config
}


function config(options = {}) {
  let appVariable = Object.hasOwn(process.env, 'CITIZEN_DIRECTORIES__APP'),
      app = path.resolve(options.appPath || process.env.CITIZEN_DIRECTORIES__APP || 'app'),
      envFile,
      result

  console.log('\n\n\x1b[1m[' + new Date().toISOString() + ']\x1b[0m Starting citizen...')
  console.log('\n\nLoading configuration:\n')

  envFile = loadEnv(app)
  if ( !appVariable && envFile && Object.hasOwn(process.env, 'CITIZEN_DIRECTORIES__APP') ) {
    delete process.env.CITIZEN_DIRECTORIES__APP
    console.warn('  Ignored CITIZEN_DIRECTORIES__APP from .env; set it in the process environment to select another app directory.')
  }
  result = resolve(process.env, { appPath: app })

  logEnv(result, envFile)
  return result.config
}


function logEnv(config, envFile) {
  if ( envFile ) {
    console.log('  Loaded project environment: ' + envFile)
  } else {
    console.log('  No project .env loaded (optional); using process environment and defaults.')
  }

  console.log('')
  console.log('  Applied ' + config.applied.length + ' CITIZEN_* environment variable' + ( config.applied.length === 1 ? '' : 's' ) + '.')
  if ( config.config.mode === 'development' ) {
    if ( config.applied.length ) console.log('  Applied env keys: ' + config.applied.join(', '))
    config.passthrough.forEach( key => console.warn('  Non-default Node server option passed through: ' + key) )
    config.unknown.forEach( key => console.warn('  Unknown citizen environment variable ignored: ' + key) )
  }
  console.log('')
}


// Scaffold

function buildEnv(defaults, overrides = {}) {
  let active = new Set(Object.keys(overrides)),
      lines = [
        '# citizen framework configuration',
        '# Uncomment any settings you want to override.',
        '# Process environment variables take precedence over this file.',
        ''
      ],
      map = getEnvMap(defaults)

  for ( const [key, setting] of [...map].sort((a, b) => a[0].localeCompare(b[0])) ) {
    if ( key === 'CITIZEN_DIRECTORIES__APP' ) continue

    let value = setting.value

    if ( Object.hasOwn(overrides, key) ) {
      value = overrides[key]
    } else if ( value instanceof RegExp ) {
      value = value.source
    } else if ( typeof value === 'string' ) {
      value = value || '""'
    } else {
      value = JSON.stringify(value)
    }
    lines.push(( active.has(key) ? '' : '# ' ) + key + '=' + value)
  }

  lines.push(
    '',
    '# Optional whole-object configuration:',
    '# CITIZEN_CORS={"Access-Control-Allow-Origin":"https://example.com","Access-Control-Allow-Methods":"GET, OPTIONS"}',
    '# CITIZEN_HTTP={"keepAliveTimeout":5000}',
    '# CITIZEN_HTTPS={"maxHeaderSize":16384}',
    '',
    '# Application configuration:',
    '# Add application-owned environment variables below.',
    ''
  )

  return lines.join('\n')
}


export {
  buildEnv,
  checkLegacy,
  getConfig,
  getDefaults,
  getEnvConfig,
  getEnvMap,
  loadEnv,
  resolve
}

export default config
