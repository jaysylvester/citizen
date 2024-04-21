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
        host                  : '',
        citizen: {
          mode                : process.env.NODE_ENV || 'production',
          http: {
            enabled           : true,
            hostname          : '127.0.0.1',
            port              : 80
          },
          https: {
            enabled           : false,
            hostname          : '127.0.0.1',
            port              : 443,
            secureCookies     : true
          },
          connectionQueue     : null,
          templateEngine      : 'templateLiterals',
          compression: {
            enabled           : false,
            force             : false,
            mimeTypes         : [
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
            enabled           : false,
            lifespan          : 20 // minutes
          },
          layout: {
            controller        : '',
            view              : ''
          },
          contentTypes        : [
                                'text/html',
                                'text/plain',
                                'application/json',
                                'application/javascript'
                                ],
          forms: {
            enabled           : true,
            maxPayloadSize    : 524288 // 0.5MB
          },
          cache: {
            application: {
              enabled         : true,
              lifespan        : 15, // minutes
              resetOnAccess   : true,
              encoding        : 'utf-8',
              synchronous     : false
            },
            static: {
              enabled         : false,
              lifespan        : 15, // minutes
              resetOnAccess   : true
            },
            invalidUrlParams  : 'warn',
            control           : {}
          },
          errors              : 'capture',
          logs: {
            access            : false, // performance-intensive, opt-in only
            error             : true,
            debug             : false,
            maxFileSize       : 10000,
            watcher: {
              options: {
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
                route         : true,
                session       : true,
                url           : true,
              },
              depth           : 4,
              showHidden      : false,
              view            : false
            },
            watcher: {
              custom          : [],
              killSession     : false,
              options: {
                ignored       : /(^|[/\\])\../ // Ignore dotfiles
              }
            }
          },
          urlPath             : '/',
          directories: {
            app               : appPath,
            hooks             : appPath + '/hooks',
            logs              : appPath + '/logs',
            models            : appPath + '/models',
            routes            : appPath + '/routes',
            views             : appPath + '/views',
            web               : new URL('../../../web', import.meta.url).pathname
          }
        }
      },
      config = getConfig()


function getConfig() {
  let configDirectory = appPath + '/config',
      files           = [],
      appConfig       = {}

  console.log('\n\n\x1b[1m[' + new Date().toISOString() + ']\x1b[0m' + ' Starting citizen...')
  console.log('\n\nLoading configuration:\n')
  // If there isn't a config directory, return an empty config.
  // citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory)
  } catch {
    console.log('  No configuration files found. Loading default config.\n')
    return defaultConfig
  }

  for ( const file of files ) {
    let parsedConfig,
        configRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/)

    if ( configRegex.test(file) ) {
      parsedConfig = JSON.parse(fs.readFileSync(configDirectory + '/' + file))
      if ( parsedConfig.host === os.hostname() ) {
        appConfig = parsedConfig
        console.log('  [host: ' + parsedConfig.host + '] ' + configDirectory + '/' + file + '\n')
      }
    }
  }

  if ( !appConfig.host ) {
    try {
      appConfig = JSON.parse(fs.readFileSync(configDirectory + '/citizen.json'))
      console.log('  ' + configDirectory + '/citizen.json\n')
    } catch ( err ) {
      console.log('  There was a problem parsing your config file.\n')
      console.log(err)
    }
  }

  return helpers.extend(defaultConfig, appConfig)
}

export default config
