// application event hooks

// node
import fs                from 'node:fs'
import fsPromises        from 'node:fs/promises'
import path              from 'node:path'
import { createRequire } from 'node:module'
// citizen
import cache             from '../cache.js'
import helpers           from '../helpers.js'
// third-party
import chokidar          from 'chokidar'


const start = async () => {
  // If file logging is enabled and the specified log directory doesn't exist, create it.
  if ( CTZN.config.citizen.logs.access || CTZN.config.citizen.logs.error || CTZN.config.citizen.logs.debug ) {
    try {
      await fsPromises.stat(CTZN.config.citizen.directories.logs)
    } catch ( err ) {
      switch ( err.code ) {
        case 'ENOENT':
          try {
            await fsPromises.mkdir(CTZN.config.citizen.directories.logs)
            console.log('\nCreating log file directory:\n')
            console.log('  ' + CTZN.config.citizen.directories.logs + '\n')
          } catch ( err ) {
            console.log('\ncitizen attempted to create a log file directory, but encountered the following error. Try creating the directory manually and starting the app again.\n\n')
            console.log(err)
            console.log('\n\nExiting...\n\n')
            process.exit()
          }
          break
        default:
          console.log('\ncitizen encountered the following error when trying to read the log file directory:\n\n')
          console.log(err)
          console.log('\n\nExiting...\n\n')
          process.exit()
      }
    }
  }

  // If max log file size is specified, watch files and rename when they hit their limit.
  if ( CTZN.config.citizen.logs.maxFileSize ) {
    chokidar.watch(CTZN.config.citizen.directories.logs + '/**.log', CTZN.config.citizen.development.watcher.options).on('change', file => {
      fs.stat(file, (err, stats) => {
        if ( stats.size >= CTZN.config.citizen.logs.maxFileSize * 1024 ) {
          fs.rename(file, file.replace('.log', '-' + stats.mtimeMs + '.log'), err => {
            if ( err ) {
              helpers.log({
                type    : 'error:server',
                label   : 'There was a problem archiving the following log file: ' + file,
                content : err
              })
            }
          })
        }
      })
    })
  }

  // Enable hot module reloading in development mode
  if ( CTZN.config.citizen.mode === 'development' ) {
    const require = createRequire(import.meta.url)
    
    console.log('\nStarting watcher for hot module reloading:\n')
    
    // Route controllers
    console.log('  ' + CTZN.config.citizen.directories.controllers + '/routes')
    const controllerWatch = chokidar.watch(CTZN.config.citizen.directories.controllers + '/routes', CTZN.config.citizen.development.watcher.options)

    controllerWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.controllers.routes[fileName] = await import(file + '?v=' + cacheBuster)
        helpers.log({
          label: 'Controller reinitialized: ' + fileName,
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following controller: \n\n' + file,
          content: err
        })
      }
    })

    // Hooks
    console.log('  ' + CTZN.config.citizen.directories.controllers + '/hooks')
    const hookWatch = chokidar.watch(CTZN.config.citizen.directories.controllers + '/hooks', CTZN.config.citizen.development.watcher.options)

    hookWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        helpers.log({
          label: 'Hook reinitialized: ' + fileName,
          content: file
        })
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.controllers.hooks[fileName] = await import(file + '?v=' + cacheBuster)
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following module: \n\n' + file,
          content: err
        })
      }
    })

    // Private controllers
    console.log('  ' + CTZN.config.citizen.directories.controllers + '/private')
    const privateWatch = chokidar.watch(CTZN.config.citizen.directories.controllers + '/private', CTZN.config.citizen.development.watcher.options)

    privateWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        helpers.log({
          label: 'Private controller reinitialized: ' + fileName,
          content: file
        })
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.controllers.private[fileName] = await import(file + '?v=' + cacheBuster)
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following module: \n\n' + file,
          content: err
        })
      }
    })

    // Models
    console.log('  ' + CTZN.config.citizen.directories.models)
    const modelWatch = chokidar.watch(CTZN.config.citizen.directories.models, CTZN.config.citizen.development.watcher.options)

    modelWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()

        cache.clear()
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.models[fileName] = await import(file + '?v=' + cacheBuster)
        helpers.log({
          label: 'Model reinitialized: ' + fileName,
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following model: \n\n' + file,
          content: err
        })
      }
    })

    // Views
    console.log('  ' + CTZN.config.citizen.directories.views)
    const viewWatch = chokidar.watch(CTZN.config.citizen.directories.views, CTZN.config.citizen.development.watcher.options)

    viewWatch.on('change', async file => {
      try {
        let pattern = file.replace(/.+\/views\/([A-Za-z0-9-_+]+)\/[A-Za-z0-9-_+]+\.[A-Za-z]+$/g, '$1'),
            extension = path.extname(file),
            fileName = path.basename(file, extension)

        cache.clear()

        // If there's no matching pattern, it's a view file in the views directory.
        if ( pattern === file ) {
          CTZN.views[fileName] = {
            path: file
          }
        } else {
          CTZN.views[pattern][fileName] = {
            path: file
          }
        }

        if ( CTZN.config.citizen.templateEngine !== 'templateLiterals' ) {
          await import('consolidate').then((consolidate) => {
            consolidate[CTZN.config.citizen.templateEngine](CTZN.views[fileName]?.path || CTZN.views[pattern][fileName].path, { cache: false })
          })
        }

        helpers.log({
          label: 'View reinitialized: ' + fileName,
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem reinitializing the following view: \n\n' + file,
          content: err
        })
      }
    })

    // User modules
    CTZN.config.citizen.development.watcher.custom.forEach(item => {
      console.log('  ' + CTZN.config.citizen.directories.app + item.watch)
      const customWatch = chokidar.watch(CTZN.config.citizen.directories.app + item.watch, CTZN.config.citizen.development.watcher.options)

      customWatch.on('change', async file => {
        try {
          let extension = path.extname(file),
              fileName = path.basename(file, extension),
              cacheBuster = Date.now()

          cache.clear()
          helpers.log({
            label: 'Module reinitialized: ' + fileName,
            content: file
          })
          delete require.cache[require.resolve(file)]
          if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
            CTZN.sessions = {}
          }
          delete require.cache[require.resolve(file)]
          if ( item.assign ) {
            let app = eval('global.' + item.assign)
            app[fileName] = await import(file + '?v=' + cacheBuster)
          }
        } catch (err) {
          helpers.log({
            label: 'There was a problem reinitializing the following module: \n\n' + file,
            content: err
          })
        }
      })
    })

    // Static assets
    if ( CTZN.config.citizen.cache.static.enabled ) {
      const staticWatch = chokidar.watch(CTZN.config.citizen.directories.web, CTZN.config.citizen.development.watcher.options)

      staticWatch.on('change', async file => {
        cache.clear({ file: file })
      })
    }

    console.log('')
  }

  // Fire the app's application start hook
  if ( CTZN.controllers.hooks.application?.start ) {
    await CTZN.controllers.hooks.application.start(CTZN.config)
  }
}


const error = async (params, request, response, context, err) => {
  if ( CTZN.controllers.hooks.application?.error ) {
    await CTZN.controllers.hooks.application.error(params, request, response, context, err)
  }
}


export default { start, error }
