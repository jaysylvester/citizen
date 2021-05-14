// application event hooks

// node
import fs                from 'fs'
import fsPromises        from 'fs/promises'
import path              from 'path'
import { createRequire } from 'module'
// citizen
import cache             from '../cache.js'
import helpers           from '../helpers.js'
// third-party
import chokidar          from 'chokidar'
import consolidate       from 'consolidate'

const start = async () => {
  // If file logging is enabled and the specified log directory doesn't exist, create it.
  if ( CTZN.config.citizen.log.file.error || CTZN.config.citizen.log.file.request || CTZN.config.citizen.log.file.status ) {
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
            console.log('\ncitizen attempted to create a log file directory, but encountered the following error. Try creating the directory manually and starting the app again.\n')
            console.log(err)
            process.exit()
          }
          break
        default:
          console.log('\ncitizen encountered the following error when trying to read the log file directory:\n')
          console.log(err)
          process.exit()
      }
    }
  }

  // If max log file size is specified, watch files and rename when they hit their limit.
  if ( CTZN.config.citizen.log.file.maxFileSize ) {
    chokidar.watch(CTZN.config.citizen.directories.logs + '/**.log', CTZN.config.citizen.development.watcher.options).on('change', file => {
      fs.stat(file, (err, stats) => {
        if ( stats.size >= CTZN.config.citizen.log.file.maxFileSize * 1024 ) {
          fs.rename(file, file.replace('.log', '-' + stats.mtimeMs + '.log'), err => {
            if ( err ) {
              helpers.log({
                label: 'There was a problem archiving this log file:',
                content: err
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
    
    // Controllers
    console.log('  ' + CTZN.config.citizen.directories.controllers)
    const controllerWatch = chokidar.watch(CTZN.config.citizen.directories.controllers, CTZN.config.citizen.development.watcher.options)
    
    controllerWatch.on('add', async file => {
      let extension = path.extname(file),
          fileName = path.basename(file, extension),
          cacheBuster = Date.now()
      CTZN.patterns.controllers[fileName] = await import(file + '?v=' + cacheBuster)
    })

    controllerWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()
        cache.clear({ controller: fileName })
        cache.clear({ scope: 'routes' })
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.patterns.controllers[fileName] = await import(file + '?v=' + cacheBuster)
        helpers.log({
          label: 'Controller reinitialized: ' + fileName + '\n',
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing the following controller: \n\n' + file,
          content: err
        })
      }
    })

    // Models
    console.log('  ' + CTZN.config.citizen.directories.models)
    const modelWatch = chokidar.watch(CTZN.config.citizen.directories.models, CTZN.config.citizen.development.watcher.options)
    
    modelWatch.on('add', async file => {
      let extension = path.extname(file),
          fileName = path.basename(file, extension),
          cacheBuster = Date.now()
      CTZN.patterns.models[fileName] = await import(file + '?v=' + cacheBuster)
    })

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
        CTZN.patterns.models[fileName] = await import(file + '?v=' + cacheBuster)
        helpers.log({
          label: 'Model reinitialized: ' + fileName + '\n',
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing the following model: \n\n' + file,
          content: err
        })
      }
    })

    // Views
    console.log('  ' + CTZN.config.citizen.directories.views)
    const viewWatch = chokidar.watch(CTZN.config.citizen.directories.views, CTZN.config.citizen.development.watcher.options)
    
    viewWatch.on('add', async file => {
      let pattern = file.replace(/.+\/views\/([A-Za-z0-9-_+]+)\/[A-Za-z0-9-_+]+\.[A-Za-z]+$/g, '$1'),
          extension = path.extname(file),
          fileName = path.basename(file, extension)
      await consolidate[CTZN.config.citizen.templateEngine](CTZN.patterns.views[pattern][fileName].path, { cache: false })
    })

    viewWatch.on('change', async file => {
      try {
        let pattern = file.replace(/.+\/views\/([A-Za-z0-9-_]+)\/[A-Za-z0-9-_]+\.[A-Za-z]+$/g, '$1'),
            extension = path.extname(file),
            fileName = path.basename(file, extension)
        cache.clear({ scope: 'controllers' })
        cache.clear({ scope: 'routes' })
        CTZN.patterns.views[pattern][fileName] = {
          path: file
        }
        await consolidate[CTZN.config.citizen.templateEngine](CTZN.patterns.views[pattern][fileName].path, { cache: false })
        helpers.log({
          label: 'View reinitialized: ' + fileName + '\n',
          content: file
        })
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing the following view: \n\n' + file,
          content: err
        })
      }
    })

    // Hooks
    console.log('  ' + CTZN.config.citizen.directories.hooks)
    const hookWatch = chokidar.watch(CTZN.config.citizen.directories.hooks, CTZN.config.citizen.development.watcher.options)
    
    hookWatch.on('add', async file => {
      let extension = path.extname(file),
          fileName = path.basename(file, extension),
          cacheBuster = Date.now()
      CTZN.hooks.app[fileName] = await import(file + '?v=' + cacheBuster)
    })

    hookWatch.on('change', async file => {
      try {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()
        cache.clear()
        helpers.log({
          label: 'Initializing ' + fileName + ' module\n',
          content: file
        })
        if ( CTZN.sessions && CTZN.config.citizen.development.watcher.killSession ) {
          CTZN.sessions = {}
        }
        delete require.cache[require.resolve(file)]
        CTZN.hooks.app[fileName] = await import(file + '?v=' + cacheBuster)
      } catch (err) {
        helpers.log({
          label: 'There was a problem initializing the following module: \n\n' + file,
          content: err
        })
      }
    })

    // User modules
    CTZN.config.citizen.development.watcher.custom.forEach(item => {
      console.log('  ' + CTZN.config.citizen.directories.app + item.watch)
      const customWatch = chokidar.watch(CTZN.config.citizen.directories.app + item.watch, CTZN.config.citizen.development.watcher.options)
    
      customWatch.on('add', async file => {
        let extension = path.extname(file),
            fileName = path.basename(file, extension),
            cacheBuster = Date.now()
        CTZN.hooks.app[fileName] = await import(file + '?v=' + cacheBuster)
        if ( item.assign ) {
          let app = eval('global.' + item.assign)
          app[fileName] = await import(file + '?v=' + Math.random())
        }
      })

      customWatch.on('change', async file => {
        try {
          let extension = path.extname(file),
              fileName = path.basename(file, extension),
              cacheBuster = Date.now()
          cache.clear()
          helpers.log({
            label: 'Initializing ' + fileName + ' module\n',
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
            label: 'There was a problem initializing the following module: \n\n' + file,
            content: err
          })
        }
      })
    })

    // Static assets
    if ( CTZN.config.citizen.cache.static.enable ) {
      const staticWatch = chokidar.watch(CTZN.config.citizen.directories.web, CTZN.config.citizen.development.watcher.options)

      staticWatch.on('change', async file => {
        cache.clear({ file: file })
      })
    }

    console.log('')
  }
}


const error = async () => {

}


export default { start, error }