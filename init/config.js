// config
//
// Generates the framework configuration based on defaults that can be
// extended by optional config files.

// node
import fs from 'node:fs'
import os from 'node:os'
// citizen
import helpers from '../lib/helpers.js'


const appPath       = new URL('../../../app', import.meta.url).pathname,
      defaultConfig = {
        host                 : '',
        citizen: {
          mode               : process.env.NODE_ENV || 'production',
          global             : 'app',
          http: {
            enabled          : true,
            hostname         : '127.0.0.1',
            port             : 80
          },
          https: {
            enabled          : false,
            hostname         : '127.0.0.1',
            port             : 443,
            secureCookies    : true
          },
          connectionQueue    : null,
          templateEngine     : 'templateLiterals',
          compression: {
            enabled          : false,
            force            : false,
            // Mimetypes that should be sent in compressed format
            mimeTypes        : [
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
            enabled          : false,
            lifespan         : 20 // minutes
          },
          layout: {
            controller       : '',
            view             : ''
          },
          // Allowable response content types
          contentTypes       : [
                                'text/html',
                                'text/plain',
                                'application/json',
                                'application/javascript'
                               ],
          forms: {
            enabled          : true,
            maxPayloadSize   : 524288 // 0.5MB
          },
          cache: {
            application: {
              enabled        : true,
              lifespan       : 15, // minutes
              resetOnAccess  : true,
              encoding       : 'utf-8',
              synchronous    : false
            },
            static: {
              enabled        : false,
              lifespan       : 15, // minutes
              resetOnAccess  : true
            },
            invalidUrlParams : 'warn',
            control          : {}
          },
          errors             : 'capture',
          logs: {
            access           : false, // performance-intensive, opt-in only
            error: {
              client         : true, // 400 errors
              server         : true // 500 errors
            },
            debug            : false,
            maxFileSize      : 10000,
            watcher: {
              interval       : 60000
            }
          },
          development: {
            debug: {
              scope: {
                config       : true,
                context      : true,
                cookie       : true,
                form         : true,
                payload      : true,
                route        : true,
                session      : true,
                url          : true,
              },
              depth          : 4,
              showHidden     : false,
              view           : false
            },
            watcher: {
              custom         : [],
              killSession    : false,
              ignored        : /(^|[/\\])\../ // Ignore dotfiles
            }
          },
          urlPath            : '/',
          directories: {
            app              : appPath,
            controllers      : appPath + '/controllers',
            helpers          : appPath + '/helpers',
            models           : appPath + '/models',
            views            : appPath + '/views',
            logs             : new URL('../../../logs', import.meta.url).pathname,
            web              : new URL('../../../web', import.meta.url).pathname
          }
        }
      },
      config = getConfig()


function getConfig() {
  let configDirectory = appPath + '/config',
      configRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/),
      files           = [],
      appConfig       = {}

  console.log('\n\n\x1b[1m[' + new Date().toISOString() + ']\x1b[0m' + ' Starting citizen...')
  console.log('\n\nLoading configuration:\n')
  // If there isn't a config directory, return an empty config. citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory)
    files = files.filter( (file) => configRegex.test(file) )
  } catch {
    console.log('  No configuration files found. Loading default config.\n')
    return defaultConfig
  }

  if ( files.length ) {
    for ( const file of files ) {
      let parsedConfig
  
      parsedConfig = JSON.parse(fs.readFileSync(configDirectory + '/' + file))
      if ( parsedConfig.host === os.hostname() ) {
        appConfig = parsedConfig
        console.log('  [host: ' + parsedConfig.host + '] ' + configDirectory + '/' + file + '\n\n')
      }
    }
  
    if ( !appConfig.host && files.indexOf('citizen.json') >= 0 ) {
      try {
        appConfig = JSON.parse(fs.readFileSync(configDirectory + '/citizen.json'))
        console.log('  ' + configDirectory + '/citizen.json\n')
      } catch ( err ) {
        console.log('  There was a problem parsing your config file.\n\n')
        console.log(err)
      }
    }

    return helpers.extend(defaultConfig, appConfig)
  } else {
    console.log('  No configuration files found. Loading default config.\n')
    return defaultConfig
  }
}

export default config
