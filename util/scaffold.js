// Generates files and directories needed for citizen apps

import { program } from 'commander'
import fs                from 'node:fs'
import path              from 'node:path'
import { fileURLToPath } from 'node:url'
// citizen
import { buildEnv, getDefaults } from '../init/config.js'

const scaffoldPath = fileURLToPath(new URL('./', import.meta.url)),
      projectPath  = process.cwd(),
      appPath      = path.join(projectPath, 'app')

      
const buildController = (options) => {
  var template  = fs.readFileSync(scaffoldPath + '/templates/controller.js'),
      pattern   = options.pattern,
      appName   = options.appName,
      name      = pattern + '.js'

  template = template.toString()
  template = template.replace(/\[pattern\]/g, pattern)
  template = template.replace(/\[appName\]/g, appName)

  return {
    name     : name,
    contents : template
  }
}


const buildModel = (options) => {
  var template  = fs.readFileSync(scaffoldPath + '/templates/model.js'),
      pattern   = options.pattern,
      header    = options.main && options.main.header ? options.main.header : pattern + ' pattern template',
      text      = options.main && options.main.text ? options.main.text : 'This is a template for the ' + pattern + ' pattern.'

  template = template.toString()
  template = template.replace(/\[pattern\]/g, pattern)
  template = template.replace(/\[header\]/g, header)
  template = template.replace(/\[text\]/g, text)

  return {
    name     : pattern + '.js',
    contents : template
  }
}


const buildView = (options) => {
  var pattern   = options.pattern,
      template  = fs.readFileSync(scaffoldPath + '/templates/view.html'),
      directory = pattern,
      name      = pattern + '.html'

  return {
    directory : directory,
    name      : name,
    contents  : template.toString()
  }
}


program
  .version('1.0.0')
  .on('--help', function () {
    console.log('')
    console.log('This utility creates templates for citizen apps and patterns.')
    console.log('')
    console.log('For help with each command, enter "scaffold [command] --help"')
    console.log('')
  })

// Create the skeleton of an app
program
  .command('skeleton')
  .option('-n, --network-port [port number]', 'Default HTTP port is 3000, but if that\'s taken, use this option to set your config')
  .option('-m, --mode [mode]', 'Set the config mode to development (default) or production')
  .action( function (options) {
    var gitignore,
        mode          = options.mode || 'development',
        port          = options.networkPort || 3000,
        gitignorePath = projectPath + '/.gitignore',
        packagePath   = projectPath + '/package.json',
        templates = {
          application : fs.readFileSync(scaffoldPath + '/templates/hooks/application.js'),
          error       : fs.readdirSync(scaffoldPath +  '/templates/error'),
          gitignore   : fs.readFileSync(scaffoldPath + '/templates/gitignore'),
          request     : fs.readFileSync(scaffoldPath + '/templates/hooks/request.js'),
          response    : fs.readFileSync(scaffoldPath + '/templates/hooks/response.js'),
          session     : fs.readFileSync(scaffoldPath + '/templates/hooks/session.js'),
          start       : fs.readFileSync(scaffoldPath + '/templates/start.js')
        },
        webPath = path.resolve(appPath, '../web'),
        application = templates.application.toString(),
        controller = buildController({
          pattern: 'index',
          appName: 'app'
        }),
        env = buildEnv(getDefaults({ appPath: appPath, nodeEnv: mode }), {
          CITIZEN_HTTP__PORT: port,
          CITIZEN_MODE: mode
        }),
        model = buildModel({
          pattern: 'index',
          appName: 'app',
          main: {
            header: 'Hello, world!',
            text:   'How easy was that?'
          }
        }),
        packageJSON = JSON.parse(fs.readFileSync(packagePath, 'utf8')),
        request     = templates.request.toString(),
        response    = templates.response.toString(),
        session     = templates.session.toString(),
        start       = templates.start.toString(),
        view = buildView({
          pattern: 'index'
        })

    packageJSON.engines = packageJSON.engines || {}
    packageJSON.engines.node = '>=22.0.0'
    packageJSON.type = 'module'

    fs.mkdirSync(appPath)
    fs.writeFileSync(projectPath + '/.env', env)
    fs.writeFileSync(projectPath + '/.env.example', env)
    if ( fs.existsSync(gitignorePath) ) {
      gitignore = fs.readFileSync(gitignorePath, 'utf8')
      if ( !gitignore.split(/\r?\n/).includes('.env') ) fs.appendFileSync(gitignorePath, `${gitignore.endsWith('\n') ? '' : '\n'}.env\n`)
    } else {
      fs.writeFileSync(gitignorePath, templates.gitignore)
    }
    fs.writeFileSync(packagePath, JSON.stringify(packageJSON, null, 2) + '\n')
    fs.writeFileSync(appPath + '/start.js', start)
    fs.mkdirSync(appPath +     '/controllers')
    fs.mkdirSync(appPath +     '/controllers/hooks')
    fs.writeFileSync(appPath + '/controllers/hooks/application.js', application)
    fs.writeFileSync(appPath + '/controllers/hooks/request.js', request)
    fs.writeFileSync(appPath + '/controllers/hooks/response.js', response)
    fs.writeFileSync(appPath + '/controllers/hooks/session.js', session)
    fs.mkdirSync(appPath +     '/controllers/routes')
    fs.writeFileSync(appPath + '/controllers/routes/' + controller.name, controller.contents)
    fs.mkdirSync(appPath +     '/helpers')
    fs.mkdirSync(appPath +     '/models')
    fs.writeFileSync(appPath + '/models/' + model.name, model.contents)
    fs.mkdirSync(appPath +     '/views')
    fs.mkdirSync(appPath +     '/views/' + view.directory)
    fs.writeFileSync(appPath + '/views/' + view.directory + '/' + view.name, view.contents)
    fs.mkdirSync(appPath +     '/views/error')
    templates.error.forEach( function (file) {
      var template,
          viewRegex = new RegExp(/.+\.html$/)

      if ( viewRegex.test(file) ) {
        template = fs.readFileSync(scaffoldPath + '/templates/error/' + file)
      }

      fs.writeFileSync(appPath + '/views/error/' + file, template)
    })
    fs.mkdirSync(webPath)

    console.log('')
    console.log('Your app\'s skeleton was successfully created in ' + path.resolve(appPath, '../'))
    console.log('')
    console.log('To start your app:')
    console.log('')
    console.log('  $ node ' + appPath + '/start.js')
    console.log('')
  })
  .on('--help', function(){
    console.log('')
    console.log('  The skeleton command creates files and folders for a functional citizen web app.')
    console.log('')
    console.log('  Examples:')
    console.log('')
    console.log('    $ node scaffold skeleton')
    console.log('')
    console.log('    Creates or updates the following files:')
    console.log('')
    console.log('    .env')
    console.log('    .env.example')
    console.log('    .gitignore')
    console.log('    package.json')
    console.log('    app/')
    console.log('      controllers/')
    console.log('        hooks/')
    console.log('          application.js')
    console.log('          request.js')
    console.log('          response.js')
    console.log('          session.js')
    console.log('        routes/')
    console.log('          index.js')
    console.log('      helpers/')
    console.log('      models/')
    console.log('        index.js')
    console.log('      views/')
    console.log('        error/')
    console.log('          404.html')
    console.log('          500.html')
    console.log('          ENOENT.html')
    console.log('          error.html')
    console.log('        index.html')
    console.log('      start.js')
    console.log('    web/')
    console.log('')
    console.log('  After creating the skeleton:')
    console.log('')
    console.log('    $ node app/start.js')
    console.log('')
  })

// Create an MVC pattern
program
  .command('pattern [pattern]')
  .option('-a, --app-name [name]', 'Specify a custom global app variable name (default is "app")')
  .option('-M, --no-model', 'Skip creation of the model')
  .option('-T, --no-view', 'Skip creation of the view')
  .action( function (pattern, options) {
    var appName = options.appName || 'app',
        controller = buildController({
          pattern: pattern,
          appName: appName
        }),
        model = buildModel({
          pattern: pattern,
          appName: appName
        }),
        view = buildView({
          pattern: pattern
        })

    fs.writeFileSync(appPath + '/controllers/routes/' + controller.name, controller.contents)
    if ( options.model ) {
      fs.writeFileSync(appPath + '/models/' + model.name, model.contents)
    }
    if ( options.view ) {
      fs.writeFileSync(appPath + '/views/' + view.name, view.contents)
    }

    console.log(pattern + ' pattern created')
  })
  .on('--help', function(){
      console.log('')
      console.log('  The pattern command creates the files and folders needed for a working citizen MVC pattern.')
      console.log('')
      console.log('  Examples:')
      console.log('')
      console.log('    $ node scaffold pattern foo')
      console.log('')
      console.log('    Creates the following pattern:')
      console.log('')
      console.log('    app/')
      console.log('      controllers/')
      console.log('        routes/')
      console.log('          foo.js')
      console.log('      models/')
      console.log('        foo.js')
      console.log('      views/')
      console.log('        foo.html')
      console.log('')
    })

program.parse(process.argv)
