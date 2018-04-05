// Generates files and directories needed for citizen apps

'use strict';

var program      = require('commander'),
    fs           = require('fs'),
    path         = require('path'),
    scaffoldPath = path.dirname(module.filename),
    appPath      = path.resolve(scaffoldPath, '../../../app');

program
  .version('0.0.2');

// Create the skeleton of an app
program
  .command('skeleton')
  .option('-n, --network-port [port number]', 'Default HTTP port is 80, but if that\'s taken, use this option to set your config')
  .option('-m, --mode [mode]', 'Set the config mode to debug, development, or production (default)')
  .option('-U, --no-use-strict', 'Don\'t include the \'use strict\'; statement in any of the modules')
  .action( function (options) {
    var webPath = path.resolve(appPath, '../web'),
        templates = {
          application: fs.readFileSync(scaffoldPath + '/templates/on/application.js'),
          request:     fs.readFileSync(scaffoldPath + '/templates/on/request.js'),
          response:    fs.readFileSync(scaffoldPath + '/templates/on/response.js'),
          session:     fs.readFileSync(scaffoldPath + '/templates/on/session.js'),
          start:       fs.readFileSync(scaffoldPath + '/templates/start.js'),
          error:       fs.readdirSync(scaffoldPath + '/templates/error')
        },
        useStrict = options.useStrict ? '\'use strict\';\n' : '',
        controller = buildController({
          pattern:   'index',
          appName:   'app',
          useStrict: useStrict
        }),
        model = buildModel({
          pattern:   'index',
          appName:   'app',
          useStrict: useStrict,
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
        request     = templates.request.toString(),
        response    = templates.response.toString(),
        session     = templates.session.toString(),
        start       = templates.start.toString();

    application = application.replace(/\[useStrict\]/g, useStrict);
    request     = request.replace(/\[useStrict\]/g, useStrict);
    response    = response.replace(/\[useStrict\]/g, useStrict);
    session     = session.replace(/\[useStrict\]/g, useStrict);
    start       = start.replace(/\[useStrict\]/g, useStrict);

    fs.mkdirSync(appPath);
    fs.writeFileSync(appPath + '/start.js', start);
    fs.mkdirSync(appPath + '/config');
    fs.writeFileSync(appPath + '/config/' + config.name, config.contents);
    fs.mkdirSync(appPath + '/logs');
    fs.mkdirSync(appPath + '/on');
    fs.writeFileSync(appPath + '/on/application.js', application);
    fs.writeFileSync(appPath + '/on/request.js', request);
    fs.writeFileSync(appPath + '/on/response.js', response);
    fs.writeFileSync(appPath + '/on/session.js', session);
    fs.mkdirSync(appPath + '/patterns');
    fs.mkdirSync(appPath + '/patterns/controllers');
    fs.writeFileSync(appPath + '/patterns/controllers/' + controller.name, controller.contents);
    fs.mkdirSync(appPath + '/patterns/models');
    fs.writeFileSync(appPath + '/patterns/models/' + model.name, model.contents);
    fs.mkdirSync(appPath + '/patterns/views');
    fs.mkdirSync(appPath + '/patterns/views/' + view.directory);
    fs.writeFileSync(appPath + '/patterns/views/' + view.directory + '/' + view.name, view.contents);
    fs.mkdirSync(appPath + '/patterns/views/error');
    templates.error.forEach( function (file, index, array) {
      var template,
          viewRegex = new RegExp(/.+\.hbs$/);

      if ( viewRegex.test(file) ) {
        template = fs.readFileSync(scaffoldPath + '/templates/error/' + file);
      }

      fs.writeFileSync(appPath + '/patterns/views/error/' + file, template);
    });
    fs.mkdirSync(webPath);

    console.log('');
    console.log('Your app\'s skeleton was successfully created in ' + path.resolve(appPath, '../'));
    console.log('');
    console.log('To start your app:');
    console.log('');
    console.log('  $ node ' + appPath + '/start.js');
    console.log('');
  })
  .on('--help', function(){
      console.log('  The skeleton command creates files and folders for a functional citizen web app.');
      console.log('');
      console.log('  Examples:');
      console.log('');
      console.log('    $ node scaffold skeleton');
      console.log('');
      console.log('    Creates the following files:');
      console.log('');
      console.log('    app/');
      console.log('      config/');
      console.log('        citizen.json');
      console.log('      logs/');
      console.log('      on/');
      console.log('        application.js');
      console.log('        request.js');
      console.log('        response.js');
      console.log('        session.js');
      console.log('      patterns/');
      console.log('        controllers/');
      console.log('          index.js');
      console.log('        models/');
      console.log('          index.js');
      console.log('        views/');
      console.log('          error/');
      console.log('            404.hbs');
      console.log('            500.hbs');
      console.log('            ENOENT.hbs');
      console.log('            error.hbs');
      console.log('          index/');
      console.log('            index.hbs');
      console.log('      start.js');
      console.log('    web/');
      console.log('');
      console.log('  After creating the skeleton:');
      console.log('');
      console.log('    $ node start.js');
      console.log('');
    });

// Create an MVC pattern
program
  .command('pattern [pattern]')
  .option('-a, --app-name [name]', 'Specify a custom global app variable name (default is "app")')
  .option('-p, --private', 'Make the controller private (inaccessible via HTTP)')
  .option('-U, --no-use-strict', 'Don\'t include the \'use strict\'; statement in the controller and model')
  .option('-M, --no-model', 'Skip creation of the model')
  .option('-T, --no-view-template', 'Skip creation of the view')
  .action( function (pattern, options) {
    var appName = options.appName || 'app',
        useStrict = options.useStrict ? '\'use strict\';\n' : '',
        controller = buildController({
          pattern: pattern,
          appName: appName,
          useStrict: useStrict,
          private: options.private
        }),
        model = buildModel({
          pattern: pattern,
          appName: appName,
          useStrict: useStrict,
          private: options.private
        }),
        view = buildView({
          pattern: pattern,
          private: options.private
        });

    fs.writeFileSync(appPath + '/patterns/controllers/' + controller.name, controller.contents);
    if ( options.model ) {
      fs.writeFileSync(appPath + '/patterns/models/' + model.name, model.contents);
    }
    if ( options.viewTemplate ) {
      fs.mkdirSync(appPath + '/patterns/views/' + view.directory);
      fs.writeFileSync(appPath + '/patterns/views/' + view.directory + '/' + view.name, view.contents);
    }

    console.log(pattern + ' pattern created');
  })
  .on('--help', function(){
      console.log('  The pattern command creates the files and folders needed for a working citizen MVC pattern.');
      console.log('');
      console.log('  Examples:');
      console.log('');
      console.log('    $ node scaffold pattern foo');
      console.log('');
      console.log('    Creates the following pattern:');
      console.log('');
      console.log('    app/');
      console.log('      patterns/');
      console.log('        controllers/');
      console.log('          foo.js');
      console.log('        models/');
      console.log('          foo.js');
      console.log('        views/');
      console.log('          foo/');
      console.log('            foo.hbs');
      console.log('');
    });

program.parse(process.argv);


function buildController(options) {
  var template = fs.readFileSync(scaffoldPath + '/templates/controller.js'),
      pattern = options.pattern,
      appName = options.appName,
      isPrivate = options.private || false,
      useStrict = options.useStrict,
      name = pattern + '.js';

  if ( isPrivate ) {
    name = '+' + name;
  }

  template = template.toString();
  template = template.replace(/\[pattern\]/g, pattern);
  template = template.replace(/\[useStrict\]/g, useStrict);
  template = template.replace(/\[appName\]/g, appName);

  return {
    name: name,
    contents: template
  };
}


function buildModel(options) {
  var template = fs.readFileSync(scaffoldPath + '/templates/model.js'),
      pattern = options.pattern,
      useStrict = options.useStrict,
      header = options.main && options.main.header ? options.main.header : pattern + ' pattern template',
      text = options.main && options.main.text ? options.main.text : 'This is a template for the ' + pattern + ' pattern.';

  template = template.toString();
  template = template.replace(/\[pattern\]/g, pattern);
  template = template.replace(/\[useStrict\]/g, useStrict);
  template = template.replace(/\[header\]/g, header);
  template = template.replace(/\[text\]/g, text);

  return {
    name: pattern + '.js',
    contents: template
  };
}


function buildView(options) {
  var pattern = options.pattern,
      isPrivate = options.private || false,
      template = fs.readFileSync(scaffoldPath + '/templates/view.hbs'),
      directory = pattern,
      name = pattern + '.hbs';

  if ( isPrivate ) {
    directory = '+' + directory;
    name = '+' + name;
  }

  return {
    directory: directory,
    name: name,
    contents: template.toString()
  };
}


function buildConfig(options) {
  var template = fs.readFileSync(scaffoldPath + '/templates/config.json'),
      mode = options.mode || 'production',
      port = options.port || 80,
      name = options.name || 'citizen';

  template = template.toString();
  template = template.replace(/\[mode\]/g, mode);
  template = template.replace(/\[port\]/g, port);

  return {
    name: name + '.json',
    contents: template
  };
}
