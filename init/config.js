// config
//
// Generates the framework configuration based on defaults that can be
// extended by optional config files.

// node
import fs      from 'fs'
import os      from 'os'
import path    from 'path'
import url     from 'url'
// citizen
import helpers from '../lib/helpers.js'

const appPath       = path.resolve(url.fileURLToPath(import.meta.url), '../../../../app'),
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
            watcher: {
              custom          : [],
              killSession     : false,
              options: {
                ignored       : /(^|[/\\])\../ // Ignore dotfiles
              }
            }
          },
          urlPaths: {
            app               : '/'
          },
          directories: {
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
      config = getConfig()


function getConfig() {
  let configDirectory = path.join(appPath, '/config'),
      files           = [],
      appConfig        = {}

  console.log('\n\nLoading configuration:\n')
  // If there isn't a config directory, return an empty config.
  // citizen will start under its default configuration.
  try {
    files = fs.readdirSync(configDirectory)
  } catch ( err ) {
    console.log('  No configuration files found. Loading default config.\n')
    return defaultConfig
  }

  for ( const file of files ) {
    let parsedConfig,
        configRegex = new RegExp(/^[A-Za-z0-9_-]*\.json$/)

    if ( configRegex.test(file) ) {
      parsedConfig = JSON.parse(fs.readFileSync(path.join(configDirectory, '/', file)))
      if ( parsedConfig.host === os.hostname() ) {
        appConfig = parsedConfig
        console.log('  [host: ' + parsedConfig.host + '] ' + configDirectory + '/' + file + '\n')
      }
    }
  }

  if ( !appConfig.host ) {
    try {
      appConfig = JSON.parse(fs.readFileSync(path.join(configDirectory, '/citizen.json')))
      console.log('  ' + configDirectory + '/citizen.json\n')
    } catch ( err ) {
      console.log('  There was a problem parsing your config file.\n')
      console.log(err)
    }
  }

  return helpers.extend(defaultConfig, appConfig)
}

export default config
