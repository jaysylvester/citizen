// initialize controllers and models

// node
import fs   from 'fs'
import path from 'path'


const getControllers = async (controllerPath) => {
  let controllers = {},
      controllerFiles = [],
      regex = new RegExp(/.*\.(js)|(cjs)$/)
      
  console.log('Importing controllers:\n')

  try {
    controllerFiles = fs.readdirSync(controllerPath)
    if ( controllerFiles.length ) {
      let count = 0
      for ( const file of controllerFiles ) {
        if ( regex.test(file) ) {
          count++
          console.log('  ' + controllerPath + '/' + file)
          controllers[path.basename(file, path.extname(file))] = await import(path.join(controllerPath, '/', file))
        }
      }
      if ( !count ) {
        console.log('   No controllers found. citizen requires at least one controller in the controller directory (' + controllerPath + ').\n')
        process.exit()
      }
    } else {
      console.log('   No controllers found. citizen requires at least one controller in the controller directory (' + controllerPath + ').\n')
      process.exit()
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('   No controllers found. citizen requires at least one controller in the controller directory (' + controllerPath + ').\n')
        process.exit()
        break
      default:
        console.log('   There was an error while attempting to traverse the controller directory (' + controllerPath + ').\n')
        console.log(err)
        console.log('/n')
        process.exit()
    }
  }

  return controllers
}


const getModels = async (modelPath) => {
  let models = {},
      modelFiles = [],
      regex = new RegExp(/.*\.(js)|(cjs)$/)

  console.log('\n\nImporting models:\n')

  try {
    modelFiles = fs.readdirSync(modelPath)
    if ( modelFiles.length ) {
      let count = 0
      for ( const file of modelFiles ) {
        if ( regex.test(file) ) {
          count++
          console.log('  ' + modelPath + '/' + file)
          models[path.basename(file, path.extname(file))] = await import(path.join(modelPath, '/', file))
        }
      }
      if ( !count ) {
        console.log('   No models found.')
      }
    } else {
      console.log('   No models found.')
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('   No models found.')
        break
      default:
        console.log('   There was an error while attempting to traverse the model directory (' + modelPath + ').\n')
        console.log(err)
        process.exit()
    }
  }

  return models
}


const getViews = async (viewPath) => {
  let views = {},
      viewFiles = [],
      regex = new RegExp(/.+\.(.+)/)
  
  console.log('\n\nValidating views:\n')

  try {
    viewFiles = fs.readdirSync(viewPath)
    if ( viewFiles.length ) {
      for ( const directory of viewFiles ) {
        let viewFiles
        if ( fs.statSync(path.join(viewPath, '/', directory)).isDirectory() ) {
          viewFiles = fs.readdirSync(path.join(viewPath, '/', directory))
          views[directory] = {}
          for ( const file of viewFiles ) {
            let filePath,
                fileExtension,
                viewName
            
            if ( regex.test(file) ) {
              console.log('  ' + viewPath + '/' + directory + '/' + file)
              filePath = path.join(viewPath, '/', directory, '/', file)
              fileExtension = path.extname(file)
              viewName = path.basename(file, fileExtension)
              views[directory][viewName] = {
                path: filePath
              }
            }
          }
        }
      }
    } else {
      console.log('   No views found.')
    }
  } catch ( err ) {
    switch ( err.code ) {
      case 'ENOENT':
        console.log('   No views found.')
        break
      default:
        console.log('   There was an error while attempting to traverse the view directory (' + viewPath + ').\n')
        console.log(err)
        process.exit()
    }
  }

  console.log('')

  return views
}


export default { getControllers, getModels, getViews }
