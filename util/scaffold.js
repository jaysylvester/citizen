// Generates files and directories needed for citizen apps

import program from 'commander'
import fs      from 'fs'
import path    from 'path'

const scaffoldPath = new URL('../util/', import.meta.url).pathname,
      appPath      = path.resolve(scaffoldPath, '../../../app')

      
const buildController = (options) => {
  var template  = fs.readFileSync(scaffoldPath + '/templates/controller.js'),
      pattern   = options.pattern,
      appName   = options.appName,
      isPrivate = options.private || false,
      name      = pattern + '.js'

  if ( isPrivate ) {
    name = '+' + name
  }

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
      isPrivate = options.private || false,
      template  = fs.readFileSync(scaffoldPath + '/templates/view.hbs'),
      directory = pattern,
      name      = pattern + '.hbs'

  if ( isPrivate ) {
    directory = '+' + directory
    name      = '+' + name
  }

  return {
    directory : directory,
    name      : name,
    contents  : template.toString()
  }
}


const buildConfig = (options) => {
  var template = fs.readFileSync(scaffoldPath + '/templates/config.json'),
      mode     = options.mode || 'development',
      port     = options.port || 80,
      name     = options.name || 'citizen'

  template = template.toString()
  template = template.replace(/\[mode\]/g, mode)
  template = template.replace(/\[port\]/g, port)

  return {
    name     : name + '.json',
    contents : template
  }
}


program
  .version('0.0.3')
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
  .option('-n, --network-port [port number]', 'Default HTTP port is 80, but if that\'s taken, use this option to set your config')
  .option('-m, --mode [mode]', 'Set the config mode to development (default) or production')
  .action( function (options) {
    var webPath = path.resolve(appPath, '../web'),
        templates = {
          application : fs.readFileSync(scaffoldPath + '/templates/hooks/application.js'),
          package     : fs.readFileSync(scaffoldPath + '/templates/package.json'),
          request     : fs.readFileSync(scaffoldPath + '/templates/hooks/request.js'),
          response    : fs.readFileSync(scaffoldPath + '/templates/hooks/response.js'),
          session     : fs.readFileSync(scaffoldPath + '/templates/hooks/session.js'),
          start       : fs.readFileSync(scaffoldPath + '/templates/start.js'),
          error       : fs.readdirSync(scaffoldPath + '/templates/error')
        },
        controller = buildController({
          pattern: 'index',
          appName: 'app'
        }),
        model = buildModel({
          pattern: 'index',
          appName: 'app',
          main: {
            header: 'Hello, world!',
            text:   'How easy was that?'
          }
        }),
        view = buildView({
          pattern: 'index'
        }),
        config = buildConfig({
          mode: options.mode,
          port: options.networkPort
        }),
        application = templates.application.toString(),
        packageJSON = templates.package.toString(),
        request     = templates.request.toString(),
        response    = templates.response.toString(),
        session     = templates.session.toString(),
        start       = templates.start.toString()

    fs.mkdirSync(appPath)
    fs.writeFileSync(appPath + '/package.json', packageJSON)
    fs.writeFileSync(appPath + '/start.js', start)
    fs.mkdirSync(appPath + '/config')
    fs.writeFileSync(appPath + '/config/' + config.name, config.contents)
    fs.mkdirSync(appPath + '/logs')
    fs.mkdirSync(appPath + '/hooks')
    fs.writeFileSync(appPath + '/hooks/application.js', application)
    fs.writeFileSync(appPath + '/hooks/request.js', request)
    fs.writeFileSync(appPath + '/hooks/response.js', response)
    fs.writeFileSync(appPath + '/hooks/session.js', session)
    fs.mkdirSync(appPath + '/patterns')
    fs.mkdirSync(appPath + '/patterns/controllers')
    fs.writeFileSync(appPath + '/patterns/controllers/' + controller.name, controller.contents)
    fs.mkdirSync(appPath + '/patterns/models')
    fs.writeFileSync(appPath + '/patterns/models/' + model.name, model.contents)
    fs.mkdirSync(appPath + '/patterns/views')
    fs.mkdirSync(appPath + '/patterns/views/' + view.directory)
    fs.writeFileSync(appPath + '/patterns/views/' + view.directory + '/' + view.name, view.contents)
    fs.mkdirSync(appPath + '/patterns/views/error')
    templates.error.forEach( function (file) {
      var template,
          viewRegex = new RegExp(/.+\.hbs$/)

      if ( viewRegex.test(file) ) {
        template = fs.readFileSync(scaffoldPath + '/templates/error/' + file)
      }

      fs.writeFileSync(appPath + '/patterns/views/error/' + file, template)
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
    console.log('    Creates the following files:')
    console.log('')
    console.log('    app/')
    console.log('      config/')
    console.log('        citizen.json')
    console.log('      logs/')
    console.log('      hooks/')
    console.log('        application.js')
    console.log('        request.js')
    console.log('        response.js')
    console.log('        session.js')
    console.log('      patterns/')
    console.log('        controllers/')
    console.log('          index.js')
    console.log('        models/')
    console.log('          index.js')
    console.log('        views/')
    console.log('          error/')
    console.log('            404.hbs')
    console.log('            500.hbs')
    console.log('            ENOENT.hbs')
    console.log('            error.hbs')
    console.log('          index/')
    console.log('            index.hbs')
    console.log('      start.js')
    console.log('    web/')
    console.log('')
    console.log('  After creating the skeleton:')
    console.log('')
    console.log('    $ node start.js')
    console.log('')
  })

// Create an MVC pattern
program
  .command('pattern [pattern]')
  .option('-a, --app-name [name]', 'Specify a custom global app variable name (default is "app")')
  .option('-p, --private', 'Make the controller private (inaccessible via HTTP)')
  .option('-M, --no-model', 'Skip creation of the model')
  .option('-T, --no-view-template', 'Skip creation of the view')
  .action( function (pattern, options) {
    var appName = options.appName || 'app',
        controller = buildController({
          pattern: pattern,
          appName: appName,
          private: options.private
        }),
        model = buildModel({
          pattern: pattern,
          appName: appName,
          private: options.private
        }),
        view = buildView({
          pattern: pattern,
          private: options.private
        })

    fs.writeFileSync(appPath + '/patterns/controllers/' + controller.name, controller.contents)
    if ( options.model ) {
      fs.writeFileSync(appPath + '/patterns/models/' + model.name, model.contents)
    }
    if ( options.viewTemplate ) {
      fs.mkdirSync(appPath + '/patterns/views/' + view.directory)
      fs.writeFileSync(appPath + '/patterns/views/' + view.directory + '/' + view.name, view.contents)
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
      console.log('      patterns/')
      console.log('        controllers/')
      console.log('          foo.js')
      console.log('        models/')
      console.log('          foo.js')
      console.log('        views/')
      console.log('          foo/')
      console.log('            foo.hbs')
      console.log('')
    })

program.parse(process.argv)
