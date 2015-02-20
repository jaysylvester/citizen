// Generates files and directories needed for citizen apps

'use strict';

var program = require('commander'),
    fs = require('fs'),
    path = require('path'),
    appPath = path.resolve(path.dirname(module.filename), '../../../app');

program
  .version('0.0.1');

// Create the skeleton of an app
program
  .command('skeleton')
  .option('-n, --network-port [port number]', 'Default HTTP port is 80, but if that\'s taken, use this option to set your config')
  .option('-f, --format [format]', 'Set the view template format (jade, hbs, or html)')
  .option('-m, --mode [mode]', 'Set the config mode to debug, development, or production (default)')
  .option('-U, --no-use-strict', 'Don\'t include the \'use strict\'; statement in any of the modules')
  .action( function (options) {
    var webPath = path.resolve(appPath, '../web'),
        format = options.format || 'jade',
        useStrict = options.useStrict ? "'use strict';\n\n" : '',
        controller = buildController({
          pattern: 'index',
          appName: 'app',
          useStrict: useStrict
        }),
        model = buildModel({
          pattern: 'index',
          appName: 'app',
          useStrict: useStrict
        }),
        view = buildView({
          pattern: 'index',
          format: format
        }),
        config = buildConfig({
          mode: options.mode,
          port: options.networkPort
        }),
        application = "// application events\n\n// This module optionally exports the following methods:\n// start(context, emitter) - Called when the application starts\n// end(context, emitter) - Called when the application shuts down (not functional yet)\n// error(e, context, emitter) - Called on every application error\n\n// If you have no use for this file, you can delete it.\n\n" + useStrict + "module.exports = {\n  start: start,\n  end: end,\n  error: error\n};\n\n\nfunction start(context, emitter) {\n  emitter.emit('ready');\n}\n\n\nfunction end(context, emitter) {\n  emitter.emit('ready');\n}\n\n\nfunction error(e, params, context, emitter) {\n  emitter.emit('ready');\n}\n",
        request = "// request events\n\n// This module optionally exports the following methods:\n// start(params, context, emitter) - Called at the beginning of every request\n// end(params, context, emitter) - Called at the end of every request\n\n// If you have no use for this file, you can delete it.\n\n" + useStrict + "module.exports = {\n  start: start,\n  end: end\n};\n\n\nfunction start(params, context, emitter) {\n  emitter.emit('ready');\n}\n\n\nfunction end(params, context, emitter) {\n  emitter.emit('ready');\n}\n",
        response = "// response events\n\n// This module optionally exports the following methods:\n// start(params, context, emitter) - Called at the beginning of every response\n// end(params, context, emitter) - Called at the end of every response (after the response has been sent to the client)\n\n// If you have no use for this file, you can delete it.\n\n" + useStrict + "module.exports = {\n  start: start,\n  end: end\n};\n\n\nfunction start(params, context, emitter) {\n  emitter.emit('ready');\n}\n\n\nfunction end(params, context, emitter) {\n  emitter.emit('ready');\n}\n",
        session = "// session events\n\n// This module optionally exports the following methods:\n// start(params, context, emitter) - Called at the beginning of every user session\n// end(params, context, emitter) - Called at the end of every user session\n\n// If you have no use for this file, you can delete it.\n\n" + useStrict + "module.exports = {\n  start: start,\n  end: end\n};\n\n\nfunction start(params, context, emitter) {\n  emitter.emit('ready');\n}\n\n\nfunction end(params, context, emitter) {\n  emitter.emit('ready');\n}\n";

    fs.mkdirSync(appPath);
    fs.writeFileSync(appPath + '/start.js', "// app start\n\n" + useStrict + "global.app = require('citizen');\n\napp.start();\n");
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
      console.log('          index/');
      console.log('            index.jade');
      console.log('');
      console.log('  After creating the skeleton:');
      console.log('');
      console.log('    $ cd app');
      console.log('    $ node start.js');
      console.log('');
    });

// Create an MVC pattern
program
  .command('pattern [pattern]')
  .option('-a, --app-name [name]', 'Specify a custom global app variable name (default is "app")')
  .option('-f, --format [format]', 'Set the view template format (jade, hbs, or html)')
  .option('-p, --private', 'Make the controller private (inaccessible via HTTP)')
  .option('-U, --no-use-strict', 'Don\'t include the \'use strict\'; statement in the controller and model')
  .option('-M, --no-model', 'Skip creation of the model')
  .option('-T, --no-view-template', 'Skip creation of the view')
  .action( function (pattern, options) {
    var appName = options.appName || 'app',
        format = options.format || 'jade',
        useStrict = options.useStrict ? "'use strict';\n\n" : '',
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
          private: options.private,
          format: format
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
      console.log('  The resulting pattern is fully functional, but feel free to modify it to suit your needs.');
      console.log('');
      console.log('  Examples:');
      console.log('');
      console.log('    $ node scaffold pattern foo');
      console.log('');
      console.log('    Creates the following pattern:');
      console.log('');
      console.log('    /app');
      console.log('      /patterns');
      console.log('        /controllers');
      console.log('          foo.js');
      console.log('        /models');
      console.log('          foo.js');
      console.log('        /views');
      console.log('          /foo');
      console.log('            foo.jade');
      console.log('');
    });

program.parse(process.argv);


function buildController(options) {
  var pattern = options.pattern,
      appName = options.appName,
      isPrivate = options.private || false,
      useStrict = options.useStrict,
      name = pattern + '.js';

  if ( isPrivate ) {
    name = '+' + name;
  }

  return {
    name: name,
    contents: "// " + pattern + " controller\n\n" + useStrict + "module.exports = {\n  handler: handler\n};\n\n\n// default action\nfunction handler(params, context, emitter) {\n\n  " + appName + ".listen({\n    content: function (emitter) {\n      " + appName + ".models." + pattern + ".content(emitter);\n    }\n  }, function (output) {\n  \n    emitter.emit('ready', {\n      content: output.content\n    });\n    \n  });\n\n}\n"
  };
}


function buildModel(options) {
  var pattern = options.pattern,
      appName = options.appName,
      isPrivate = options.private || false,
      useStrict = options.useStrict,
      title = pattern;

  if ( isPrivate ) {
    title = '+' + title;
  }

  return {
    name: pattern + '.js',
    contents: "// " + pattern + " model\n\n" + useStrict + "module.exports = {\n  content: content\n};\n\n\nfunction content(emitter) {\n\n  " + appName + ".listen({\n    metaData: function (emitter) {\n      emitter.emit('ready', {\n        title: '" + title + " pattern template',\n        description: 'An example of a citizen MVC pattern',\n        keywords: 'citizen, mvc, template'\n      });\n    },\n    main: function (emitter) {\n      emitter.emit('ready', {\n        header: '" + title + " pattern',\n        text: 'This is a template for the " + title + " pattern.'\n      });\n    }\n  }, function (output) {\n  \n    emitter.emit('ready', output);\n    \n  });\n\n}\n"
  };
}


function buildView(options) {
  var pattern = options.pattern,
      isPrivate = options.private || false,
      format = options.format || 'jade',
      directory = pattern,
      name = pattern + '.' + format,
      contents = '';

  if ( isPrivate ) {
    directory = '+' + directory;
    name = '+' + name;
  }

  switch ( format ) {
    case 'hbs':
      contents = '<!doctype html>\n<html>\n  <head>\n    <meta charsate="utf-8">\n    <title>{{metaData.title}}</title>\n    <meta name="description" content="{{metaData.description}}">\n    <meta name="keywords" content="{{metaData.keywords}}">\n  </head>\n  <body>\n    <main>\n      <h1>{{main.header}}</h1>\n      <p>{{main.text}}</p>\n    </main>\n  </body>\n</html>\n';
      break;
    case 'html':
      contents = '<!doctype html>\n<html>\n  <head>\n    <meta charsate="utf-8">\n    <title>Page Title</title>\n    <meta name="description" content="Meta description.">\n    <meta name="keywords" content="keyword, list">\n  </head>\n  <body>\n    <main>\n      <h1>Static Page</h1>\n      <p>This is a static HTML view.</p>\n    </main>\n  </body>\n</html>\n';
      break;
    case 'jade':
      contents = '//- ' + pattern + ' view\n\ndoctype html\nhtml\n  head\n    meta(charset="utf-8")\n    title #{metaData.title}\n    meta(name="description" content="#{metaData.description}")\n    meta(name="keywords" content="#{metaData.keywords}")\n  body\n    main\n      h1 #{main.header}\n      p #{main.text}';
  }

  return {
    directory: directory,
    name: name,
    contents: contents
  };
}


function buildConfig(options) {
  var port = options.port || 80,
      mode = options.mode || 'production',
      name = options.name || 'citizen';

  return {
    name: name + '.json',
    contents: '{\n  "citizen": {\n    "mode":             "' + mode + '",\n    "http": {\n      "port":           ' + port + '\n    }\n  }\n}\n'
  };
}
