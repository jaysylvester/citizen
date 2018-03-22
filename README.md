# citizen

citizen is an event-driven MVC and caching framework for Node.js web applications. It's for people who are more interested in quickly building fast, scalable apps than digging around Node's guts or building a Jenga tower made out of 20 different packages. Use it as a foundation for a traditional server-side web application, a modular single-page app, or a RESTful API to be consumed by your front end framework.


## Benefits

- Very high performance (even without caching)
- Zero-configuration server-side routing with SEO-friendly URLs
- Serve HTML, JSON, and JSONP from the same controller/view with a single URL flag
- Optional in-memory caching of entire routes, individual controllers, files, and objects
- Directives that make it easy to set cookies, sessions, redirects, caches, and more
- Easily chain controllers or include controllers within other controllers
- Do it all on the server or roll in your favorite client-side templating engine
- Support for Pug and Handlebars templates


__citizen's API is stabilizing, but it's still subject to change.__ Always consult [the change log](https://github.com/jaysylvester/citizen/blob/master/CHANGELOG.txt) before upgrading. Version 0.7.0 has many breaking changes.

Have questions, suggestions, or need help? [Send me an e-mail](http://jaysylvester.com/contact). Want to contribute? Pull requests are welcome.


## Quick Start (Recommended)

These commands will create a new directory for your web app, install citizen, use its scaffolding CLI to create the app's skeleton, and start citizen with the web server listening on port 8080 (you can change the port to whatever you want):

    $ mkdir mywebapp
    $ cd mywebapp
    $ npm install citizen
    $ node node_modules/citizen/util/scaffold skeleton -n 8080
    $ node app/start.js

If everything went well, you'll see confirmation in the console that citizen is listening on the specified port. Go to http://127.0.0.1:8080 in your browser and you'll see a bare index template.

For configuration options, see [Configuration](#configuration). For more utilities, see [Utilities](#utilities).

Please see Github for [the complete readme](https://github.com/jaysylvester/citizen), because npmjs.com truncates it, which breaks all these nice links I've created for you.


### App Directory Structure

    app/
      config/
        citizen.json        // Optional default config
        local.json          // Optional configs for different environments
        qa.json
        production.json
      logs/                 // Log files created by citizen and your app
        app.txt
        citizen.txt
      on/                   // Optional application events
        application.js
        request.js
        response.js
        session.js
      patterns/
        controllers/
          index.js
        models/
          index.js          // Optional for each controller
        views/              // You can use Pug (.pug), Handlebars (.hbs), or HTML files
          error/            // Optional views for error handling
            404.pug
            500.pug
            error.pug      // Default error template
          index/
            index.pug      // Default index view
            index-alt.pug  // Optional alternate index view
      start.js
    web/                    // public static assets



### Initializing citizen and starting the web server

The start.js file in your app directory can be as simple as this:

    // start.js

    global.app = require('citizen');

    app.start();


Run start.js from the command line:

    $ node start.js



### Configuration

citizen prefers convention over configuration, but sometimes configuration is a necessity. citizen has a default configuration and accepts your configuration as an extension of its own, based on a config file and/or passed inline via `app.start()`.

The following represents citizen's default configuration, which is extended by your configuration:

    {
      "host":                 "",
      "citizen": {
        "mode":               "production",
        "http": {
          "enable":           true,
          "hostname":         "127.0.0.1",
          "port":             80
        },
        "https": {
          "enable":           false,
          "hostname":         "127.0.0.1",
          "port":             443,
          "secureCookies":    true
        },
        "connectionQueue":    null,
        "fallbackController": "",
        "compression": {
          "enable":           false,
          "force":            false,
          "mimeTypes":        "text/plain text/html text/css application/x-javascript application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml"
        },
        "sessions":           false,
        "sessionTimeout":     20, // 20 minutes
        "requestTimeout":     0.5, // 30 seconds
        "layout": {
          "controller":       "",
          "view":             ""
        },
        "formats": {
          "html": {
            "enable":         true
          },
          "json": {
            "enable":         false,
            "urlDelimiter":   "-"
          },
          "jsonp": {
            "enable":         false
            "urlDelimiter":   "-"
          }
        },
        "forms": {
          "global": {},
          "controller": {}
        },
        "cache": {
          "application": {
            "enable":         true,
            "lifespan":       15,
            "resetOnAccess":  true,
            "overwrite":      false,
            "encoding":       "utf-8",
            "synchronous":    false
          },
          "static": {
            "enable":         false,
            "lifespan":       15,
            "resetOnAccess":  true
          },
          "invalidUrlParams": "warn",
          "control": {}
        },
        "log": {
          "toConsole":        false,
          "toFile":           false,
          "path":             path.join(appPath, "/logs"),
          "defaultFile":      "citizen.txt",
          "application": {
            "status":         true,
            "errors":         true
          },
          "static": {
            "status":         true,
            "errors":         true
          }
        },
        "debug": {
          "output":           "console",
          "depth":            2,
          "disableCache":     true,
          "pug":             false
        },
        "urlPaths":  {
          "app":              "/"
        },
        "directories":  {
          "app":              "[resolved based on location of start.js]",
          "logs":             "[directories.app]/logs",
          "on":               "[directories.app]/on",
          "controllers":      "[directories.app]/patterns/controllers",
          "models":           "[directories.app]/patterns/models",
          "views":            "[directories.app]/patterns/views",
          "web":              "[parent directory of directories.app]/web"
        }
      }
    }

Here's a complete rundown of citizen's settings and what they mean:

<table>
  <caption>citizen config options</caption>
  <thead>
    <tr>
      <th>
        Setting
      </th>
      <th>
        Values
      </th>
      <th>
        Description
      </th>
    </tr>
  </thead>
  <tr>
    <td>
      <code>host</code>
    </td>
    <td>
      <p>
        The operating system's hostname
      </p>
    </td>
    <td>
      To load different config files in different environments, citizen relies upon the server's hostname as a key. At startup, if citizen finds a config file with a <code>host</code> key that matches the server's hostname, it chooses that config file. This is different from the HTTP hostname setting under the <code>citizen</code> node (see below).
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen
    </td>
  </tr>
  <tr>
    <td>
      <code>mode</code>
    </td>
    <td>
      <ul>
        <li>
          <code>production</code>
        </li>
        <li>
          <code>development</code>
        </li>
        <li>
          <code>debug</code>
        </li>
      </ul>
      <p>
        Default: <code>production</code>
      </p>
    </td>
    <td>
      The application mode determines certain runtime behaviors. Production mode silences most logging and enables all application features. Development mode also silences most logs, but allows you to edit view templates on the fly without restarting the app. In addition to on-the-fly view editing, debug mode enables verbose logging and disables caching.
    </td>
  </tr>
  <tr>
    <td>
      <code>connectionQueue</code>
    </td>
    <td>
      <p>
        A positive integer
      </p>
      <p>
        Default: <code>null</code>
      </p>
    </td>
    <td>
      The maximum number of incoming requests to queue. If left unspecified, the operating system determines the queue limit.
    </td>
  </tr>
  <tr>
    <td>
      <code>sessions</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      Enables the user session scope, which assigns each visitor a unique ID and allows you to store data associated with that ID on the server.
    </td>
  </tr>
  <tr>
    <td>
      <code>sessionTimeout</code>
    </td>
    <td>
      <p>
        Positive integer
      </p>
      <p>
        Default: <code>20</code>
      </p>
    </td>
    <td>
      If sessions are enabled, this number represents the length of a user's session in minutes. Sessions automatically expire once this time limit is reached.
    </td>
  </tr>
  <tr>
    <td>
      <code>requestTimeout</code>
    </td>
    <td>
      <p>
        Positive integer
      </p>
      <p>
        Default: <code>0.5</code> (30 seconds)
      </p>
    </td>
    <td>
      Determines how long the server will wait for a response from your controllers before timing out, in minutes.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.layout
    </td>
  </tr>
  <tr>
    <td>
      <code>controller</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: (empty)
      </p>
    </td>
    <td>
      If you use a global layout controller, you can specify the name of that controller here instead of using the handoff directive in all your controllers.
    </td>
  </tr>
  <tr>
    <td>
      <code>view</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: (empty)
      </p>
    </td>
    <td>
      By default, the layout controller will use the default layout view, but you can specify a different view here. Use the file name without the file extension.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.formats
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.formats.html
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      By default, rendered HTML sourced from Pug templates includes the original whitespace and line breaks. Change this setting to <code>false</code> to remove whitespace and minimize file size.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.formats.json
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      JSON output is disabled by default. Set this value to <code>true</code> to enable global JSON output from all controllers.
    </td>
  </tr>
  <tr>
    <td>
      <code>urlDelimiter</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>-</code>
      </p>
    </td>
    <td>
      When using the <code>output</code> URL parameter, this setting determines how to parse a JSON request. See "JSON and JSONP" for details.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.formats.jsonp
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      JSONP output is disabled by default. Set this value to <code>true</code> to enable global JSONP output from all controllers.
    </td>
  </tr>
  <tr>
    <td>
      <code>urlDelimiter</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>-</code>
      </p>
    </td>
    <td>
      When using the <code>output</code> URL parameter, this setting determines how to parse a JSON request. See "JSON and JSONP" for details.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.forms
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.forms.global
    </td>
  </tr>
  <tr>
    <td>
      <code>{ options }</code>
    </td>
    <td>
      <p>
        Object
      </p>
      <p>
        Default: Same as formidable
      </p>
    </td>
    <td>
      citizen uses <a href="https://www.npmjs.com/package/formidable">formidable</a> to parse form data. The defaults match that of formidable. Provide settings in <code>citizen.forms.global</code> to set global settings for all your forms. See <a href="#forms">Forms</a> for details.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.forms.controller
    </td>
  </tr>
  <tr>
    <td>
      <code>{ "controllerName": { "controllerAction": { { options } } }</code>
    </td>
    <td>
      <p>
        Object
      </p>
      <p>
        Default: <code>citizen.forms.global</code>
      </p>
    </td>
    <td>
      Use this setting to set different options for formidable for a specific controller action, overriding the global settings. See <a href="#forms">Forms</a> for details.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.compression
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      Enables gzip and deflate compression for rendered views and static assets. Compression occurs on the fly, but compressed routes can be cached with the cache directive, and static assets can be cached using the cache setting below.
    </td>
  </tr>
  <tr>
    <td>
      <code>force</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      Forces gzip or deflate encoding for all clients, even if they don't report accepting compressed formats. Many proxies and firewalls break the Accept-Encoding header that determines gzip support, and since all modern clients support gzip, it's usually safe to force it by setting this to <code>gzip</code>, but you can also force <code>deflate</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>mimeTypes</code>
    </td>
    <td>
      <p>
        String
      </p>
    </td>
    <td>
      A space-delimited list of MIME types that should be compressed if compression is enabled. See the sample config above for the default list. If you want to add or remove items, you must replace the list in its entirety.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.cache
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.cache.application
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      Enables the in-memory cache, accessed via the <code>cache.set()</code> and <code>cache.get()</code> methods. Set this to <code>false</code> to disable the cache when in production mode, which is useful for debugging when not in debug mode.
    </td>
  </tr>
  <tr>
    <td>
      <code>lifespan</code>
    </td>
    <td>
      <p>
        Number (minutes)
      </p>
      <p>
        Default: <code>15</code>
      </p>
    </td>
    <td>
      The length of time a cached application asset remains in memory, in minutes.
    </td>
  </tr>
  <tr>
    <td>
      <code>resetOnAccess</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      Determines whether to reset the cache timer on a cached application asset whenever the cache is accessed. When set to <code>false</code>, cached items expire when the <code>lifespan</code> is reached.
    </td>
  </tr>
  <tr>
    <td>
      <code>overwrite</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      Determines whether a call to cache.set() will overwrite an existing cache key. By default, an error is thrown if the cache key already exists. You can either pass the overwrite flag as an option in cache.set() or set this to <code>true</code> to always overwrite.
    </td>
  </tr>
  <tr>
    <td>
      <code>encoding</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>utf-8</code>
      </p>
    </td>
    <td>
      When you pass a file path to cache.set(), the encoding setting determines what encoding should be used when reading the file.
    </td>
  </tr>
  <tr>
    <td>
      <code>synchronous</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      When you pass a file path to cache.set(), this setting determines whether the file should be read synchronously or asynchronously. By default, file reads are asynchronous.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.cache.static
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      When serving static files, citizen normally reads the file from disk for each request. You can speed up static file serving considerably by setting this to <code>true</code>, which enables the static file cache.
    </td>
  </tr>
  <tr>
    <td>
      <code>lifespan</code>
    </td>
    <td>
      <p>
        Number (minutes)
      </p>
      <p>
        Default: <code>15</code>
      </p>
    </td>
    <td>
      The length of time a cached static asset remains in memory, in minutes.
    </td>
  </tr>
  <tr>
    <td>
      <code>resetOnAccess</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      Determines whether to reset the cache timer on a cached static asset whenever the cache is accessed. When set to <code>false</code>, cached items expire when the <code>lifespan</code> is reached.
    </td>
  </tr>
  <tr>
    <td>
      <code>control</code>
    </td>
    <td>
      <p>
        Key/value pairs
      </p>
      <p>
        Default: <code>{}</code>
      </p>
    </td>
    <td>
      Use this setting to set Cache-Control headers for static assets. The key is the pathname of the asset, and the value is the Cache-Control header. See <a href="#client-side-caching">Client-Side Caching</a> for details.
    </td>
  </tr>
  <tr>
    <td>
      <code>invalidUrlParams</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>warn</code>
      </p>
    </td>
    <td>
      Determines the outcome when citizen attempts to cache a route or controller based on a URL with invalid cache parameters. The default is to log a warning and continue serving the request without caching. Set this to <code>throw</code> to throw an error instead. See the Cache section for instructions on caching.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.log
    </td>
  </tr>
  <tr>
    <td>
      <code>toConsole</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      citizen only writes to the console when in debug mode. To override this behavior, set this to <code>true</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>toFile</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      citizen only writes to a log file when in debug mode. To override this behavior, set this to <code>true</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>path</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>/path/to/app/logs</code>
      </p>
    </td>
    <td>
      citizen writes log files to the <code>logs</code> directory in your app folder by default. Enter a different absolute path in this setting to change the location.
    </td>
  </tr>
  <tr>
    <td>
      <code>defaultFile</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>citizen.txt</code>
      </p>
    </td>
    <td>
      When file logging is enabled, citizen will write a file to the logs directory using this name. Change this setting to write your app logs to a different file. citizen will continue to write framework logs to citizen.txt, however.
    </td>
  </tr>
  <tr>
    <td>
      <code>application.status</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      If logging is enabled, all application events considered status updates are logged. To disable status logging, set this to <code>false</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>application.errors</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      If logging is enabled, all application events flagged as errors are logged. To disable error logging, set this to <code>false</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>static.status</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      If logging is enabled, all events related to serving static assets considered status updates are logged. To disable status logging, set this to <code>false</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>static.errors</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      If logging is enabled, all events related to serving static assets flagged as errors are logged. To disable error logging, set this to <code>false</code>.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.debug
    </td>
  </tr>
  <tr>
    <td>
      <code>output</code>
    </td>
    <td>
      <ul>
        <li>
          <code>view</code>
        </li>
        <li>
          <code>console</code>
        </li>
      </ul>
      <p>
        Default: <code>console</code>
      </p>
    </td>
    <td>
      In debug mode, citizen dumps debug info to the console. Change this setting to <code>view</code> to display the debug output in your browser.
    </td>
  </tr>
  <tr>
    <td>
      <code>depth</code>
    </td>
    <td>
      <p>
        Positive integer
      </p>
      <p>
        Default: <code>2</code>
      </p>
    </td>
    <td>
      When citizen dumps an object in the debug content, it inspects it using Node's util.inspect. This setting determines the depth of the inspection, meaning the number of nodes that will be inspected and displayed.
    </td>
  </tr>
  <tr>
    <td>
      <code>disableCache</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      Debug mode disables the cache. Change this setting to <code>false</code> to enable the cache in debug mode.
    </td>
  </tr>
  <tr>
    <td>
      <code>pug</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      Pug's template debugging is quite verbose, so it's disabled by default, but you can enable it with this setting if citizen is failing to start due to template parsing errors and you need additional info.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.urlPaths
    </td>
  </tr>
  <tr>
    <td>
      <code>app</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>/</code>
      </p>
    </td>
    <td>
      Denotes the URL path leading to your app. If you want your app to be located at http://yoursite.com/my/app, this setting should be <code>/my/app</code> (don't forget the leading slash). This setting is required for the router to work.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.http
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      This setting controls the HTTP server, which is enabled by default.
    </td>
  </tr>
  <tr>
    <td>
      <code>hostname</code>
    </td>
    <td>
      <p>
        A valid hostname
      </p>
      <p>
        Default: <code>127.0.0.1</code>
      </p>
    </td>
    <td>
      The hostname at which your app can be accessed via HTTP. You need to configure your server's DNS settings to support this setting. The default is localhost, but you can specify an empty string to accept requests at any hostname. Don't confuse this with the host machine's <code>host</code> setting above, which is different.
    </td>
  </tr>
  <tr>
    <td>
      <code>port</code>
    </td>
    <td>
      <p>
        A valid port number
      </p>
      <p>
        Default: <code>80</code>
      </p>
    </td>
    <td>
      The port number on which citizen's HTTP server should listen for requests.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      citizen.https
    </td>
  </tr>
  <tr>
    <td>
      <code>enable</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>false</code>
      </p>
    </td>
    <td>
      This setting controls the HTTPS server, which is disabled by default.
    </td>
  </tr>
  <tr>
    <td>
      <code>hostname</code>
    </td>
    <td>
      <p>
        A valid hostname
      </p>
      <p>
        Default: <code>127.0.0.1</code>
      </p>
    </td>
    <td>
      The hostname at which your app can be accessed via HTTPS. You need to configure your server's DNS settings to support this setting. The default is localhost, but you can specify an empty string to accept requests at any hostname. Don't confuse this with the host machine's <code>host</code> setting above, which is different.
    </td>
  </tr>
  <tr>
    <td>
      <code>port</code>
    </td>
    <td>
      <p>
        A valid port number
      </p>
      <p>
        Default: <code>443</code>
      </p>
    </td>
    <td>
      The port number on which citizen's HTTPS server should listen for requests.
    </td>
  </tr>
  <tr>
    <td>
      <code>secureCookies</code>
    </td>
    <td>
      <p>
        Boolean
      </p>
      <p>
        Default: <code>true</code>
      </p>
    </td>
    <td>
      By default, all cookies set during an HTTPS request are secure. Set this option to <code>false</code> to override that behavior, making all cookies insecure and requiring you to manually set the <code>secure</code> option in the cookie directive.
    </td>
  </tr>
</table>


These settings are exposed publicly via `app.config.host` and `app.config.citizen`.

**Note:** This documentation assumes your global app variable name is "app", but you can call it whatever you want. Adjust accordingly.


#### Config files

The config directory is optional and contains configuration files that drive both citizen and your app in JSON format. You can have multiple citizen configuration files within this directory, allowing different configurations based on environment. citizen retrieves its configuration file from this directory based on the following logic:

1. citizen parses each JSON file looking for a `host` key that matches the machine's hostname. If it finds one, it loads that configuration.
2. If it can't find a matching `host` key, it looks for a file named citizen.json and loads that configuration.
3. If it can't find citizen.json or you don't have a config directory, it runs under its default configuration.

Let's say you want to run an app on port 8080 in your local dev environment and you have a local database your app will connect to. You could create a config file called local.json (or myconfig.json, whatever you want) with the following:

    {
      "host":                 "My-MacBook-Pro.local",
      "citizen": {
        "mode":               "development",
        "http": {
          "port":             8080
        }
      },
      "db": {
        "server":             "localhost",
        "username":           "dbuser",
        "password":           "dbpassword"
      }
    }

This config would extend the default configuration only when running on your local machine; you'll never accidentally push a test config to production again ;)

The database settings would be accessible within your app via `app.config.db`. **The `citizen` and `host` nodes are reserved for the framework.** Create your own node(s) to store your custom settings.


#### Inline config

You can also pass your app's configuration directly to citizen through `app.start()`. If there is a config file, an inline config will extend the config file. If there's no config file, the inline configuration extends the default citizen config.

    // Start an HTTP server on port 8080 accepting requests at www.mysite.com
    app.start({
      citizen: {
        hostname: 'www.mysite.com',
        port: 8080
      }
    });

    // Start an HTTPS server with key and cert PEM files
    app.start({
      citizen: {
        http: {
          enable: false
        },
        https: {
          enable: true,
          key: '/absolute/path/to/key.pem',
          cert: '/absolute/path/to/cert.pem'
        }
      }
    });

    // Start an HTTPS server with a PFX file running on port 3000,
    // and add a custom namespace for your app's database config
    app.start({
      citizen: {
        http: {
          enable: false
        },
        https: {
          enable: true,
          port:   3000,
          pfx:    '/absolute/path/to/site.pfx'
        }
      },
      db: {
        server:   "localhost",  // app.config.db.server
        username: "dbuser",     // app.config.db.username
        password: "dbpassword"  // app.config.db.password
      }
    });

#### HTTPS

When starting an HTTPS server, in addition to the `hostname` and `port` options, citizen takes the same options as [Node's https.createServer()](http://nodejs.org/api/https.html#https_https_createserver_options_requestlistener) (which takes the same options as [tls.createServer()](http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener)).

The only difference is how you pass key files. As you can see in the examples above, you pass citizen the file paths for your key files. citizen reads the files for you.


### citizen methods and objects

<table>
  <tr>
    <td>
      <code>app.start()</code>
    </td>
    <td>
      Starts either an HTTP or HTTPS server.
    </td>
  </tr>
  <tr>
    <td>
      <code>app.cache.set()</code><br />
      <code>app.cache.exists()</code><br />
      <code>app.cache.get()</code><br />
      <code>app.cache.clear()</code><br />
      <code>app.listen()</code><br />
      <code>app.copy()</code><br />
      <code>app.extend()</code><br />
      <code>app.isNumeric()</code><br />
      <code>app.size()</code>
      <code>app.log()</code><br />
    </td>
    <td>
      <a href="#helpers">Helpers</a> used internally by citizen, exposed publicly since you might find them useful
    </td>
  </tr>
  <tr>
    <td>
      <code>app.controllers</code>
      <code>app.models</code>
      <code>app.views</code>
    </td>
    <td>
      Contains your supplied patterns, which you can use instead of <code>require</code>.
    </td>
  </tr>
  <tr>
    <td>
      <code>app.handlebars</code>
    </td>
    <td>
      A pointer to the citizen Handlebars global, allowing you full access to Handlebars methods such as <code>app.handlebars.registerHelper()</code>
    </td>
  </tr>
  <tr>
    <td>
      <code>app.pug</code>
    </td>
    <td>
      A pointer to the citizen Pug global
    </td>
  </tr>
  <tr>
    <td>
      <code>app.config</code>
    </td>
    <td>
      The configuration settings you supplied at startup
    </td>
  </tr>
  <tr>
    <td>
      <code>CTZN</code>
    </td>
    <td>
      The global namespace used by citizen for internal objects, user sessions, and cache. You should not access or modify this namespace directly; anything you might need in your application will be exposed by the server to your controllers through local scopes.
    </td>
  </tr>
</table>



## Routing and URLs

Apps using citizen have a simple URL structure that determines which controller and action to fire, passes URL parameters, and makes a bit of room for SEO-friendly content that can double as a unique identifier. The structure looks like this:

    http://www.site.com/controller/content-description/action/myAction/param/val/param2/val2

For example, let's say your site's base URL is:

    http://www.cleverna.me

Requesting that URL would cause the `index` controller's default action to fire, because the index controller is the default. The following URL would also cause the index controller to fire:

    http://www.cleverna.me/index

If you have an `article` controller, you'd request it like this:

    http://www.cleverna.me/article

Instead of query strings, citizen uses an SEO-friendly method of passing URL parameters consisting of name/value pairs. If you had to pass an article ID of 237 and a page number of 2, you'd append name/value pairs to the URL:

    http://www.cleverna.me/article/id/237/page/2

Valid parameter names may contain letters, numbers, underscores, and dashes, but must start with a letter or underscore.

The default controller action is `handler()`, but you can specify alternate actions with the `action` parameter (more on this later):

    http://www.cleverna.me/article/action/edit

citizen also lets you optionally insert relevant content into your URLs, like so:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2

This SEO content must always follow the pattern name and precede any name/value pairs. You can access it generically via `route.descriptor` or specifically via the  `url` scope (`url.article` in this case), which means you can use it as a unique identifier (more on URL parameters in the [Controllers section](#controllers)).



## MVC Patterns

citizen relies on a simple model-view-controller convention. The article pattern mentioned above might use the following structure:

    app/
      patterns/
        controllers/
          article.js
        models/
          article.js
        views/
          article/        // Matches the controller name
            article.pug  // Matches the controller name, making it the default view
            edit.pug     // Secondary view for editing an article

At least one controller is required for a given URL, and a controller's default view directory and default view file must share its name. Additional views should reside in this same directory. More on views in the [Views section](#views).

Models and views are optional and don't necessarily need to be associated with a particular controller. If your controller doesn't need a model, you don't need to create one. If your controller is going to pass its output to another controller for further processing and final rendering, you don't need to include a matching view. (See the [controller handoff directive](#controller-handoff).)



### Controllers

A citizen controller is just a Node module. Each controller requires at least one public method to serve as an action for the requested route. The default action should be named `handler()`, which is called by citizen when no action is specified in the URL.

    // article controller

    module.exports = {
      handler: handler
    };

    // Required if no action is specified in the route
    function handler(params, context, emitter) {

      // do some stuff

      emitter.emit('ready', {
        // content and directives for the server
      });
    }

The citizen server calls `handler()` after it processes the initial request and passes it 3 arguments: an object containing the parameters of the request, the current request's context generated by the app up to this point, and an emitter for the controller to emit when it's ready to pass the results to the server.

<table>
  <caption>Contents of the <code>params</code> argument</caption>
  <tr>
    <td><code>request</code></td>
    <td>The request object generated by the server, just in case you need direct access</td>
  </tr>
  <tr>
    <td><code>response</code></td>
    <td>The response object generated by the server</td>
  </tr>
  <tr>
    <td><code>route</code></td>
    <td>Details of the route, such as the requested URL and the name of the route (controller)</td>
  </tr>
  <tr>
    <td><code>url</code></td>
    <td>Any URL parameters that were passed including the descriptor, if provided</td>
  </tr>
  <tr>
    <td><code>form</code></td>
    <td>Data collected from a POST</td>
  </tr>
  <tr>
    <td><code>payload</code></td>
    <td>Data collected from a PUT</td>
  </tr>
  <tr>
    <td><code>cookie</code></td>
    <td>An object containing any cookies that were sent with the request</td>
  </tr>
  <tr>
    <td><code>session</code></td>
    <td>An object containing any session variables, if sessions are enabled</td>
  </tr>
</table>


In addition to having access to these objects within your controller, they are also included in your view context automatically so you can reference them within your view templates as local variables (more details in the <a href="#views">Views section</a>).

For example, based on the previous article URL...

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2

...you'll have the following `params.url` object passed to your controller:

    {
      article: 'My-Clever-Article-Title',
      page: '2'
    }

Note that "numeric" URL parameters are stored as strings in the `url` scope; this is because there are too many factors for citizen to make a reasonable assumption regarding your app's expectations. For example:

    http://www.cleverna.me/user/activationCode/023498721250

Your app would likely expect the leading zero to remain intact in this case, but this value is technically numeric in JavaScript, and if stored as a number would see the zero dropped. Large integers beyond what JavaScript can accurately represent also present issues.

The controller name becomes a property in the URL scope that contains the descriptor, which makes it well-suited for use as a unique identifier. This content is also available in the `route` object as `route.descriptor`.

The `context` argument contains any output that's been generated by the request up to this point. There are various events that can populate this argument with content and directives, which are then passed to your controller so you can access that content or see what directives have been set by previous events.

The `emitter` argument is the method by which the controller lets the server know that it's done with its tasks and ready to render the result. The emitter should emit a `ready` event when the controller has accomplished its task. This lets the server know it's okay to proceed. As part of this event, the emitter should include any view content and [directives](#emitter-directives) for the server.

Using the above URL parameters, I can retrieve the article content from the model and pass it back to the server:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      // Get the article content
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      // Emit the 'ready' event and pass any objects you want added to the view
      // context via the content object
      emitter.emit('ready', {
        content: article
      });
    };

Alternate actions can be requested using the `action` URL parameter. For example, maybe we want a different action and view to edit an article:

    // http://www.cleverna.me/article/My-Clever-Article-Title/page/2/action/edit

    // article controller

    module.exports = {
      handler: handler,
      edit: edit
    };

    function handler(params, context, emitter) {
      // Get the article content
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      // Emit the 'ready' event and pass any objects you want added to the view
      // context via the content object
      emitter.emit('ready', {
        content: article
      });
    };

    function edit(params, context, emitter) {
      // Get the article content
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      // Use the /patterns/views/article/edit.pug view for this action (more on
      // alternate views in later sections).
      emitter.emit('ready', {
        content: article,
        view: 'edit'
      });
    };

The second argument in `emitter.emit` is an object containing any data you want to pass back to citizen. All the content you want to render in your view should be passed to citizen within an object called `content`, as shown above. Additional objects can be passed to citizen to set directives that provide instructions to the server (explained later in the [Emitter Directives](#emitter-directives) section). You can even add your own objects to the request context and pass them from controller to controller (more in the [Controller Handoff section](#controller-handoff).)


#### Handling Errors

The emitter has an `error` event that gives you more control over how errors are handled. The `error` event throws a JavaScript error to enable debugging; citizen prevents the error from bubbling up to the Node process, however, so your app won't crash.

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      // Get the article content
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      // If everything is fine, emit ready
      if ( article ) {
        emitter.emit('ready', {
          content: article
        });

      // If there's a problem, handle the error
      } else {
        emitter.emit('error', {

          // Optional. Default status code is 500 (server error).
          statusCode: 404,

          // Optional message you want to display, which overrides citizen's messaging
          message: 'The requested article does not exist.'
        });
      }

    };


If you use the [listen()](#listen) method for asynchronous functional calls, the status output in `output.listen` is formatted to coincide with citizen's error structure, allowing you to dump it straight into an `error` emitter:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      // Get the article content using listen()
      app.listen({
        article: function (emitter) {
          app.models.article.getArticle(params.url.article, params.url.page, emitter);
        }
      }, function (output) {

        if ( output.listen.success && output.article ) {

          emitter.emit('ready', {
            content: output.article
          });

        } else {

          emitter.emit('error', output.listen);

        }
      });
    };


Errors are returned in the format requested by the route. If you request [JSON](#json-and-jsonp) with the `/format/json` URL parameter and the route throws an error, the error will be in JSON format.

The app skeleton created by the [scaffold utility](#scaffold) includes optional error view templates for common client and server errors, but you can create templates for any HTTP error code (more in the [Views section](#views) under [Error Views](#error-views)).


#### Private controllers

To make a controller private—inaccessible via HTTP, but accessible within your app—add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          +_header.js  // Partial, only accessible internally
          _head.js     // Partial, accessible via www.cleverna.me/_head
          article.js   // Accessible via www.cleverna.me/article


#### Cross domain requests

If you want to make a controller available to third party sites, see the [CORS section](#cross-origin-resource-sharing-cors).



### Models

Models are optional and their structure is completely up to you. citizen doesn't talk to your models directly; it only stores them in `app.models` for your convenience.

Here's a simple static model for the article pattern (just an example, because storing content this way is awful):

    // article model

    exports.getArticle = getArticle;

    function getArticle(article, page) {
      var articles = {
        'My-Clever-Article-Title': {
          title: 'My Clever Article Title',
          summary: 'Am I not terribly clever?',
          pages: {
            '1': 'First page content',
            '2': 'Second page content'
          }
        },
        'Clever-Part-II-The-Sequel': {
          title: 'Clever Part II: The Sequel',
          summary: 'Too clever for just one article.',
          pages: {
            '1': 'First page content',
            '2': 'Second page content'
          }
        }
      };

      return {
        title: articles[article]['title'],
        summary: articles[article]['summary'],
        text: articles[article]['pages'][page]
      };
    };


### Views

citizen supports [Pug](https://www.npmjs.org/package/pug) and [Handlebars](https://npmjs.org/package/handlebars) templates, as well as good old HTML. You can even mix and match Pug, Handlebars, and HTML templates as you see fit; just use the appropriate file extensions (.pug, .hbs, or .html) and citizen will compile and render each view with the appropriate engine.

You have direct access to each engine's methods via `app.handlebars` and `app.pug`, allowing you to use methods like `app.handlebars.registerHelper()` to create global helpers. Keep in mind that you're extending the global Handlebars and Pug objects, potentially affecting citizen's view rendering if you do anything wacky because citizen relies on these same objects.

In `article.pug`, you can reference objects you placed within the `content` object passed by the emitter. citizen also injects the `params` object into your view context automatically, so you have access to those objects as local variables (such as the `url` scope):

    // article.pug

    doctype html
    html
      body
        main
          h1 #{title} - Page #{url.page}
          p#summary #{summary}
          #text #{text}

citizen sends HTML to the client by default, but you can also return JSON and JSONP with no extra work on your part.


#### JSON and JSONP

You don't need a custom view just for JSON. You can tell a controller to return its content as plain text JSON by adding the `format` URL parameter, letting the same resource act as both a complete HTML view and JSON for AJAX requests and RESTful APIs.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json

Returns...

    {
      "title": "My Clever Article Title",
      "summary": "Am I not terribly clever?",
      "pages": {
        "1": "First page content",
        "2": "Second page content",
        "3": "Third page content"
      },
      "last modified": "2015 Mar 03"
    }

Whatever you've added to the controller's emitter `content` object will be returned.

To enable JSON output at the controller level:

    emitter.emit('ready', {
      formats: {
        json: {
          enable: true
        }
      }
    });

You can also specify specific top-level nodes to return instead of returning the entire content object by using the `output` URL parameter:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json/output/pages

Returns...

    {
      "1": "First page content",
      "2": "Second page content",
      "3": "Third page content"
    }


Use dash notation in the output parameter to go deeper into the node tree:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json/output/pages-2

Returns...

    Second page content


The output parameter can be URL-encoded, allowing for dashes in your keys or whitespace characters if necessary:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json/output/last%20modified

Returns...

    2015 Mar 03


For JSONP, use `format` paired with `callback` in the URL:

    http://www.cleverna.me/article/My-Clever-Article-Title/format/jsonp/callback/foo

Returns:

    foo({
      "title": "My Clever Article Title",
      "summary": "Am I not terribly clever?",
      "pages": {
        "1": "First page content",
        "2": "Second page content",
        "3": "Third page content"
      },
      "last modified": "2015 Mar 03"
    });

To enable JSONP output at the controller level:

    emitter.emit('ready', {
      formats: {
        jsonp: {
          enable: true
        }
      }
    });

The `output` URL parameter works with JSONP as well.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/jsonp/callback/foo/output/pages-2

Returns...

    foo("Second page content");


Do you always want a particular controller action to return JSON without the URL flag? Simple:

    function handler(params, context, emitter) {

      // All requests handled by this controller action will output JSON
      params.route.format = 'json';

      emitter.emit('ready', {
        formats: {
          json: {
            enable: true
          }
        }
      });
    }


Are you building a RESTful API and want every request to return JSON without using the URL flag? Also simple:

    // File: /app/on/request.js
    // All requests will be returned in JSON format because this function runs
    // at the beginning of every request. Learn more in the "Application Events
    // and the Context Argument" section.

    function start(params, context, emitter) {
      params.route.format = 'json';

      emitter.emit('ready');
    }

For this to work without manually enabling JSON or JSONP in every controller action, you can enable them in the global config with `citizen.formats.json.enable` and `citizen.formats.jsonp.enable`.



##### JSON security risks

The JSON output from any controller action is driven by the emitter's content object. Anything you place in the content object will be present in the JSON output -- whether it's present in the HTML view or not.

**Take care not to place sensitive data in the content object thinking it will never be exposed because you don't reference it in your view template, because it WILL show up in your JSON.**


#### Rendering alternate views

By default, the server renders the view whose name matches that of the controller. To render a different view, [use the `view` directive in your emitter](#alternate-views).


#### Error Views

To create custom error views for server errors, create a directory called `/app/patterns/views/error` and populate it with templates named after the HTTP response code or Node.js error code (or just use the [scaffold utility](#scaffold) to create your app, whose boilerplate includes some error templates to start with).

    app/
      patterns/
        views/
          error/
            404.pug        // Handles 404 errors
            500.pug        // Handles 500 errors
            ENOENT.pug     // Handles bad file read operations
            error.pug      // Handles any error without its own template


These error views are only used when citizen is in `production` mode. In `development` and `debug` modes, citizen dumps the error directly.


## Emitter Directives

In addition to the view content, the controller's `ready` emitter can also pass directives to render alternate views, set cookies and session variables, initiate redirects, call and render includes, cache views (or entire routes), and hand off the request to another controller for further processing.


### Alternate Views

By default, the server renders the view whose name matches that of the controller. To render a different view, use the `view` directive in your emitter:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      emitter.emit('ready', {
        content: article,

        // This tells the server to render app/patterns/views/article/edit.pug
        view: 'edit'
      });
    }


### Cookies

You set cookies by appending a `cookie` object to the emitter context.

Here's an example of a complete cookie object's default values:

    cookie.foo = {
      value: '',
      // Valid expiration options are:
      // 'now' - deletes an existing cookie
      // 'never' - current time plus 30 years, so effectively never
      // 'session' - expires at the end of the browser session (default)
      // [time in minutes] - expires this many minutes from now
      expires: 'session',

      // By default, a cookie's path is the same as the app path in your config
      path: app.config.citizen.urlPaths.app,

      // citizen's cookies are accessible via HTTP only by default. To access a
      // cookie via JavaScript, set this to false.
      httpOnly: true,

      // Cookies are insecure over HTTP. By default, they're made secure over HTTPS.
      // You can override that behavior globally with the https.secureCookies setting
      // in your config or on a case-by-case basis with this setting.
      secure: false
    }

The following sample login controller tells the server to set `username` and `passwordHash` cookies that expire in 20 minutes:

    // login controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var authenticate = app.models.login.authenticate({
            // Form values, just like URL parameters, are passed via the params
            // argument
            username: params.form.username,
            password: params.form.password
          }),
          // If a directive is an empty object, that's fine. citizen just ignores it.
          cookie = {};

      if ( authenticate.success ) {
        cookie = {
          // The cookie gets its name from the property name
          username: {
            value: authenticate.username,
            expires: 20
          },
          passwordHash: {
            value: authenticate.passwordHash,
            expires: 20
          }
        };
      }

      emitter.emit('ready', {
        content: {
          authenticate: authenticate
        },
        cookie: cookie
      });
    };

Alternatively, you can pass the cookie directive strings, which will create cookies using the default attributes. The following code sets the same cookies, but they expire at the end of the browser session:

    emitter.emit('ready', {
      cookie: {
        username: authenticate.username,
        passwordHash: authenticate.passwordHash
      }
    });

Cookies sent by the client are available in `params.cookie` within the controller and simply `cookie` within the view context:

    doctype html
    html
      body
        #welcome
          if cookie.username
            | Welcome, #{cookie.username}.
          else
            a(href="/login") Login

Cookie variables you set within your controller aren't immediately available within the `params.cookie` scope. citizen's server has to receive the emitter's ready event from the controller before it can send the cookie to the client, so use a local instance of the variable if you need to access it during the same request.



### Session Variables

If sessions are enabled, you can access session variables via `params.session` in your controller or simply `session` within views. These local scopes reference the current user's session without having to pass a session ID.

By default, a session has four properties: `id`, `started`, `expires`, and `timer`. The session ID is also sent to the client as a cookie called `ctzn_sessionID`.

Setting session variables is pretty much the same as setting cookie variables:

    emitter.emit('ready', {
      session: {
        username: 'Danny',
        nickname: 'Doc'
      }
    });

Sessions expire based on the `sessionTimeout` config property, which represents the length of a session in minutes. The default is 20 minutes. The `timer` is reset with each request from the user. When the `timer` runs out, the session is deleted. Any client requests after that time will generate a new session ID and send a new session ID cookie to the client. Remember that the browser's session is separate from the server's session, so any cookies you've set with an expiration of `session` are untouched if the user's session expires on the server. You need to clear those cookies manually at the start of the next server session if you don't want them hanging around.

To forcibly clear and expire the current user's session:

    emitter.emit('ready', {
      session: {
        expires: 'now'
      }
    });

This won't end the session immediately. citizen has to receive your controller's response before it can act on this directive.

Like cookies, session variables you've just assigned aren't available during the same request within the `params.session` scope, so use a local instance if you need to access this data right away.



### Redirects

You can pass redirect instructions to the server that will be initiated after the request is complete. Redirects using this method within the controller are not immediate, so the controller will do everything it's been asked to do before the redirect is processed.

The `redirect` object takes a URL string in its shorthand version, or three options: `statusCode`, `url`, and `refresh`. If you don't provide a status code, citizen uses 302 (temporary redirect). The `refresh` option determines whether the redirect uses a [Location header](http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.30) or the non-standard [Refresh header](https://en.wikipedia.org/wiki/List_of_HTTP_header_fields#Refresh).

    // Initiate a temporary redirect using the Location header
    emitter.emit('ready', {
      redirect: 'http://cleverna.me/login'
    });

    // Initiate a permanent redirect using the Refresh header, delaying the redirect
    // by 5 seconds
    emitter.emit('ready', {
      redirect: {
        url: 'http://cleverna.me/new-url',
        statusCode: 301,
        refresh: 5
      }
    });

Unlike the Location header, if you use the `refresh` option, citizen will send a rendered view to the client because the redirect occurs client-side.

Using the Location header breaks (in my opinion) the Referer header because the Referer ends up being not the resource that initiated the redirect, but the resource prior to the page that initiated it. To get around this problem, citizen stores a session variable called `ctzn_referer` that contains the URL of the resource that initiated the redirect, which you can use to redirect users properly. For example, if an unauthenticated user attempts to access a secure page and you redirect them to a login form, the address of the secure page will be stored in `ctzn_referer` so you can send them there instead of the page containing the link to the secure page.

If you haven't enabled sessions, citizen falls back to creating a cookie named `ctzn_referer` instead.



### Including Controllers

citizen lets you use complete MVC patterns as includes. These includes are more than just chunks of code that you can reuse because each has its own controller, model, and view(s). Here's the syntax:

    function handler(params, context, emitter) {
      emitter.emit('ready', {
        include: {

          // The include name referenced in your view gets its name from the
          // property name. This include calls the _header controller with the
          // default action and view.
          header: {
            controller: '_header'
          },

          // This include calls the _footer controller using the "myAction" action.
          footer: {
            controller: '_footer',
            action: 'myAction'
          },

          // This include calls the _login-form controller using the "myAction"
          // action and "myView" view.
          loginForm: {
            controller: '_login-form',
            action: 'myAction',
            view: 'myView'
          },

          // This include calls the index controller, but processes it as if it
          // had been requested from a different URL. In this case, the include
          // will return JSON.
          index: {
            route: '/index/format/json/output/myNode'
          },

          // This include calls the index controller, but processes it as if it
          // had been requested from a different URL and uses an alternate view.
          index: {
            route: '/index/format/json/output/myNode',
            view: 'myView'
          }
        }
      });
    }


Let's say our article pattern's Pug template has the following contents. The head section contains dynamic meta data, and the header nav's content changes depending on whether the user is logged in or not:

    doctype html
    html
      head
        title #{metaData.title}
        meta(name="description" content="#{metaData.description}")
        meta(name="keywords" content="#{metaData.keywords}")
        link(rel="stylesheet" type="text/css" href="app.css")
      body
        header
          a#logo Home page
          if cookie.username
            p Welcome, #{cookie.username}
          nav
            ul
              li
                a(href="/") Home
              li
                a(href="/articles") Articles
              if cookie.username
                li
                  a(href="/admin") Site Administration
        main
          h1 #{title} - Page #{url.page}
          p#summary #{summary}
          #text #{text}

It probably makes sense to use includes for the head section and header because you'll use that code everywhere, but rather than simple partials, you can create citizen includes. The head section can use its own model for populating the meta data, and since the header is different for authenticated users, let's pull that logic out of the template and put it in the header's controller. I like to follow the convention of starting partials with an underscore, but that's up to you:

    app/
      patterns/
        controllers/
          _head.js
          _header.js   // Doesn't pull data, so it doesn't need a model
          article.js
        models/
          _head.js
          article.js
        views/
          _head/
            _head.pug
          _header/
            _header.pug
            _header-authenticated.pug // A different header for logged in users
          article/
            article.pug

When the article controller is fired, it has to tell citizen which includes it needs. We do that with the `include` directive, which we pass via the context in the emitter:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      emitter.emit('ready', {
        content: article,
        include: {
          head: {
            // If only the controller is specified, the default action handler() is
            // called and the default view is rendered (_head.pug in this case).
            controller: '_head'
          },
          header: {
            controller: '_header',
            // If the username cookie exists, use the authenticated action. If not,
            // use handler.
            action: params.cookie.username ? 'authenticated' : 'handler'

            // You can also specify the view here like this:
            // view: '_header-authenticated'
            // But we'll do that in the header controller instead. If you do specify
            // a view here, it will override whatever view is set in the controller.
          }
        }
      });
    }

citizen include patterns have the same requirements as regular patterns, including a controller with a `handler()` function. The `include` directive above tells citizen to call the _head and _header controllers, pass them the same arguments that were passed to the article controller (params, context, and emitter), render their respective views, and add the resulting views to the view context.

Here's what our header controller looks like:

    // _header controller

    module.exports = {
      handler: handler,
      authenticated: authenticated
    };

    function handler(params, context, emitter) {
      emitter.emit('ready', {
        view: '_header'
      });
    }

    function authenticated(params, context, emitter) {
      emitter.emit('ready', {
        view: '_header-authenticated'
      });
    }


And the header views:

    // _header view (/patterns/views/_header/_header.pug)

    header
      a#logo Home page
      nav
        ul
          li
            a(href="/") Home
          li
            a(href="/articles") Articles



    // _header-authenticated view  (/patterns/views/_header/_header-authenticated.pug)

    header
      a#logo Home page
      p Welcome, #{cookie.username}
      nav
        ul
          li
            a(href="/") Home
          li
            a(href="/articles") Articles
          li
            a(href="/admin") Site Administration


The rendered includes are stored in the `include` scope. The `include` object contains rendered HTML views, so you need to skip escaping (`!=` in Pug, `{{{...}}}` in Handlebars):

    doctype html
    html
      != include.head
      body
        != include.header
        main
          h1 #{title} - Page #{url.page}
          p#summary #{summary}
          #text #{text}

citizen includes are self-contained and sandboxed. Content you generate in the calling controller isn't passed to its include controllers, and content generated inside an include isn't passed back to the parent. citizen includes also can't make use of cookie, session, redirect, or handoff directives. They only use the content directive (to populate their own views), the view directive for setting the view used by the include, and the cache directive for controller caching.

**A pattern meant to be used as an include can be accessed via HTTP just like any other controller.** You could request the `_head` controller like so:

    http://cleverna.me/_head

Perhaps you'd have it return meta data as JSON for the article pattern:

    // http://cleverna.me/_head/article/My-Clever-Article-Title/format/json

    {
      "metaData": {
        "title": "My Clever Article Title",
        "description": "My article's description.",
        "keywords": "clever, article, keywords"
      }
    }


Of course, if you don't write the controller in a manner to accept direct requests and return content, it'll return nothing (or throw an error). When accessed via HTTP, the controller has access to all emitter directives.

**Reminder:** To make a controller private—inaccessible via HTTP, but accessible within your app—add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          +_header.js  // Only accessible internally
          _head.js     // Accessible via www.cleverna.me/_head
          article.js   // Accessible via www.cleverna.me/article


#### Should I use a citizen include or a Pug include/Handlebars partial?

citizen includes provide rich functionality, but they do have limitations and can be overkill in certain situations.

* **Do you only need to share a chunk of markup across different views?** Use a standard Handlebars partial, Pug template, or HTML document. The syntax is easy and you don't have to create a full MVC pattern like you would with a citizen include.
* **Do you need to loop over a chunk of markup to render a data set?** The server processes citizen includes and returns them as fully-rendered HTML (or JSON), not compiled templates. You can't loop over them and inject data like you can with Handlebars partials or Pug includes.
* **Do you need the ability to render different includes based on logic?** citizen includes can have multiple views because they're full MVC patterns. Using a citizen include, you can call different actions and views based on logic and keep that logic in the controller where it belongs. Using Handlebars partials or Pug includes would require registering multiple partials and putting the logic in the view template.
* **Do you want the include to be accessible from the web?** Since a citizen include has a controller, you can request it via HTTP like any other controller and get back HTML, JSON, or JSONP, which is great for AJAX requests and single page apps.


### Controller Handoff

citizen allows the requested controller to give another controller the responsibility of handling the request and rendering its own view via a directive called `handoff`. The requested controller passes its content and directives to a secondary controller that assumes responsibility for the request, adding its own content and directives and rendering its own view. This is also a method for passing your own custom content and directives to the receiving controller.

A common use case for `handoff` would be to create a layout controller that serves as a template for every page on your site, rendering all the includes necessary and leaving only the core content and markup to the initially requested controller. Let's modify the article controller and view so it hands off rendering responsibility to a separate layout controller:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      emitter.emit('ready', {
        content: article,
        handoff: {
          // Pass this request to app/patterns/controller/+_layout.js
          controller: '+_layout',

          // Specifying the action is optional. The layout controller will use its
          // default action, handler(), unless you specify a different action here.
          action: 'handler',

          // Specifying the view is optional. The layout controller will use its
          // default view unless you tell it to use a different one.
          view: '+_layout'
        },

        // A custom directive to drive some logic in the layout controller.
        // You could even pass a function here for layout to call.
        // Just don't use any reserved citizen directive names!
        myDirective: {
          doSomething: true
        }
      });
    }


The view of the originally requested controller (article.pug in this case) is rendered and stored in the `route.chain` object:

    // article.pug, which is stored in the route.chain scope

    h1 #{title}
    p#summary #{summary}
    #text #{text}


The layout controller handles the includes, follows your custom directive, and renders its own view:

    // layout controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      // Access my custom directive using the context argument
      if ( context.myDirective && context.myDirective.doSomething ) {
        doSomething();
      }

      emitter.emit('ready', {
        // No need to specify previous directives, such as content, here because
        // citizen keeps track of the article pattern's request context throughout
        // the handoff process.
        include: {
          head: {
            controller: '_head'
          },
          header: {
            controller: '_header',
            action: params.cookie.username ? 'authenticated' : 'handler'
          }
        }
      });
    }

    function doSomething() {
      // do something
    }


As mentioned in the config section at the beginning of this document, you can specify a default layout controller in your config so you don't have to specify it in every controller:

    {
      "citizen": {
        "layout": {
          "controller": "+_layout",
          "view":       "+_layout"
        }
      }
    }


You can use `handoff` to chain requests across as many controllers as you want, with each controller's directives added to the request context. All controllers in the chain are stored in the `route` object as an array called `route.chain`:

    [
      { controller: 'article',
        action: 'handler',
        view: 'article',
        viewContent: '<h1>My Article Title</h1><p id="summary">The article summary.</p><div id="text">The article text.</div>'
      },
      { controller: '+_layout',
        action: 'handler',
        view: '+_layout'
      }
    ]

You can loop over this object to render all the chained views:

    // +_layout.pug

    doctype html
    html
      != include.head
      body
        != include.header
        main
          // Loop over each controller in the chain and incorporate its rendered view
          each controller in route.chain
            != controller.viewContent


It's assumed the last controller in the chain provides the master view, so it has no `viewContent`; that's what the server sends to the client.

You can skip rendering a controller's view in the handoff chain by setting view to false:

    // article controller

    emitter.emit('ready', {
      // Don't render the article controller's view as part of the chain
      view: false,
      handoff: {
        controller: 'next-controller'
      }
    });


## Performance

citizen provides several ways for you to improve your app's performance, most of which come at the cost of system resources (memory or CPU). You'll definitely want to do some performance monitoring to make sure the benefits are worth the cost.


### Compression

Both dynamic routes and static assets can be compressed before sending them to the browser. To enable compression for clients that support it:

    {
      "citizen": {
        "compression": {
          "enable": true
        }
      }
    }

Proxies, firewalls, and other network circumstances can strip the request header that tells the server to provide compressed assets. You can force gzip or deflate for all clients like this:

    {
      "citizen": {
        "compression": {
          "enable": true,
          "force":  "gzip"
        }
      }
    }

If you have [route caching](#caching-dynamic-requests-controllers-and-routes) enabled, both the original and compressed versions of the route will be cached, so your cache's memory utilization will increase.


### Caching Dynamic Requests (Controllers and Routes)

In many cases, a requested route or controller will generate the same view every time based on the same input parameters, so it doesn't make sense to run the controller chain and render the view from scratch for each request. citizen provides flexible caching capabilities to speed up your server side rendering via the `cache` directive.


#### cache.route

If a given route (URL) will result in the exact same rendered view with every request, you can cache that view with the `route` attribute. This is the fastest cache option because it pulls a fully rendered view from memory and skips all controller processing.

Let's say you chain the article controller with the layout controller like we did above. If you put the following cache directive in your article emitter, the requested route will be cached and subsequent requests will skip the article and layout controllers entirely.

    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: true
      }
    });

Each of the following routes would generate its own cache item:

http://cleverna.me/article
http://cleverna.me/article/My-Article
http://cleverna.me/article/My-Article/page/2

Note that if you put the `cache.route` directive *anywhere* in your controller chain, the route will be cached.

The example above is shorthand for default cache settings. The `cache.route` directive can also be an object with options:

    // Cache the requested route with some additional options
    emitter.emit('ready', {
      cache: {
        route: {
          // Optional. Set the HTTP Cache-Control header for this route, caching it
          // on the client for the specified time in seconds.
          control: 'max-age=86400',

          // Optional. This setting lets the server respond with a 304 Not Modified
          // status if the cache content hasn't been updated since the client last
          // accessed the route. Defaults to the current time if not specified.
          lastModified: new Date().toISOString(),

          // Optional. List of valid URL parameters that protects against accidental
          // caching of malformed URLs.
          urlParams: ['article', 'page'],

          // Optional. Life of cached item in minutes. Default is the life of the
          // application (no expiration).
          lifespan: 15,

          // Optional. Reset the cached item's expiration timer whenever the item is
          // accessed, keeping it in the cache until traffic subsides.
          resetOnAccess: true
        }
    });


#### cache.controller

If a given route chain will vary across requests, you can still cache individual controllers to speed up rendering. The `controller` property tells citizen to cache the controller, while the `scope` option determines how the controller and its resulting view are cached.

    // Cache this controller using the default settings
    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        controller: true
      }
    });

    // Cache this controller with additional options
    emitter.emit('ready', {
      cache: {
        controller: {

          // Optional. If caching the controller, 'global' (default) will cache one
          // instance of the controller and use it globally, while 'route' will cache
          // a unique instance of the controller for every route that calls it.
          scope: 'route',

          // Optional. List of directives to cache with the controller.
          directives: ['handoff', 'cookie'],

          // These options function the same as in route caching (see above)
          urlParams: ['article', 'page'],
          lifespan: 15,
          resetOnAccess: true
        }
    });


#### cache.route and cache.controller options

##### `control` (route cache only)

Use this option to set the Cache-Control header for the requested route:

    emitter.emit('ready', {
      cache: {
        route: {
          // Set the HTTP Cache-Control header for this route, caching it on the
          // client for 1 day (86400 seconds)
          control: 86400
        }
    });

The client will pull this route from its local cache until the cache expires.


##### `lastModified` (route cache only)

This setting lets the server respond with a faster `304 Not Modified` response if the content of the route cache hasn't changed since the client last accessed it. By default, it's set to the time at which the route was cached, but you can specify a custom date in ISO format that reflects the last modification to the route's content. This way, if you restart your app or clear the cache for some reason, returning clients will still get a 304.

    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: {

          // Use toISOString() to format your date appropriately
          lastModified: myDate.toISOString()       // 2015-03-05T08:59:51.491Z
        }
      }
    });


##### `urlParams`

The `urlParams` property helps protect against invalid cache items (or worse: an attack meant to flood your server's resources by overloading the cache).

    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: {
          urlParams: ['article', 'page']
        }
      }
    });

If we used the example above in our article controller, the following URLs would be cached because the "article" and "page" URL parameters are permitted:

http://cleverna.me/article
http://cleverna.me/article/My-Article-Title
http://cleverna.me/article/My-Article-Title/page/2

The following URLs wouldn't be cached, which is a good thing because it wouldn't take long for an attacker's script to loop over a URL and flood the cache:

http://cleverna.me/article/My-Article-Title/dosattack/1
http://cleverna.me/article/My-Article-Title/dosattack/2

"page" is valid, but "dosattack" isn't, so this URL wouldn't be cached either:

http://cleverna.me/article/My-Article-Title/page/2/dosattack/3

By default, the server logs a warning when invalid URL parameters are present and continues processing without caching the result. To throw an error instead, set "invalidUrlParams" to "throw" in the config file:

    {
      "citizen": {
        "cache": {
          "invalidUrlParams": "throw"
        }
      }
    }


##### `directives` (controller cache only)

By default, any directives you specify in a cached controller aren't cached; they're implemented the first time the controller is called and then ignored after that. This is to prevent accidental storage of private data in the cache through session or cookie directives.

If you want directives to persist within the cache, include them in the `directives` property as an array:

    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cookie: {
        myCookie: {
          value: 'howdy',
          expires: 'never'
        }
      },
      myCustomDirective: {
        doSomething: true
      },
      cache: {
        controller: {
          scope: 'route',

          // Cache handoff and myCustomDirective so that if this controller is
          // called from the cache, it hands off to the layout controller and acts
          // upon myCustomDirective every time. The cookie directive will only be
          // acted upon the first time the controller is called, however.
          directives: ['handoff', 'myCustomDirective']
        }
      }
    });


##### `lifespan`

This setting determines how long the route or controller should remain in the cache, in minutes.

    emitter.emit('ready', {
      cache: {
        route: {

          // This route cache will expire in 10 minutes
          lifespan: 10
        }
    });


##### `resetOnAccess`

Used with the `lifespan` setting, `resetOnAccess` will reset the timer of the route or controller cache whenever it's accessed, keeping it in the cache until traffic subsides.

    emitter.emit('ready', {
      cache: {
        route: {

          // This route cache will expire in 10 minutes, but if a request accesses it
          // before then, the cache timer will be reset to 10 minutes from now
          lifespan: 10,
          resetOnAccess: true
        }
    });


#### Cache Limitations and Warnings

As mentioned previously, if you use the handoff directive to call a series of controllers and any one of those controllers sets `cache.route` to true, the final view will be cached. Therefore, caching any controllers in that chain might be redundant. In most cases, you'll want to choose between caching an entire route or caching individual controllers, but not both.

When caching an include controller, the view directive doesn't work. Set the view within the include directive of the calling controller.

citizen's cache is a RAM cache stored in the heap, so be careful with your caching strategy. Use the lifespan option so URLs that aren't receiving regular traffic naturally fall out of the cache and free up resources for frequently accessed pages.


### Caching Static Assets

By caching static assets in memory, you speed up file serving considerably. To enable static asset caching for your app's public (web) directory, set "static" to `true` in your config:

    {
      "citizen": {
        "cache": {
          "static": true
        }
      }
    }

Any static files citizen serves will be cached, so keep an eye on your app's memory usage to make sure you're not using too many resources. citizen handles all the caching and response headers (ETags, 304 status codes, etc.) for you using each file's modified date. Note that if a file changes after it's been cached, you'll need to clear the file cache using [cache.clear()](#clear-options) or restart the app.

To clear a file from the cache in a running app:

    app.cache.clear({ file: '/absolute/path/to/file.jpg' });


### Client-Side Caching

citizen automatically sets ETag headers for cached routes and static assets. You don't need to do anything to make them work. The Cache-Control header is entirely manual, however.

We already looked at setting Cache-Control for routes above. To do it for static assets, use the "control" setting in your config:

    {
      "citizen": {
        "cache": {
          "static":             true,
          "control": {
            "/css/global.css":  "max-age=86400",
            "/css/index.css":   "max-age=86400",
            "/js/global.js":    "max-age=86400",
            "/js/index.js":     "max-age=86400",
            "/images/logo.png": "max-age=31536000"
          }
        }
      }
    }

The key name is the pathname that points to the static asset in your web directory. If your app's URL path is `/my/app`, then this value should be something like `/my/app/styles.css`. The value is the Cache-Control header value you want to assign to that asset.

You can use strings that match the exact pathname like above, or you can also use regular expressions. Mixing the two is fine:

    {
      "citizen": {
        "cache": {
          "static":             true,
          "control": {
            "/css/*":           "max-age=86400",
            "/js/*":            "max-age=86400",
            "/images/logo.png": "max-age=31536000"
          }
        }
      }
    }

Here's [a great tutorial on client-side caching](https://developers.google.com/web/fundamentals/performance/optimizing-content-efficiency/http-caching) to help explain ETag and Cache-Control headers.


## Forms

citizen uses [formidable](https://www.npmjs.com/package/formidable) to parse form data. When a user submits a form, the resulting form data is available in your controller via `params.form`.

    // login controller

    function handler(params, context, emitter) {
      // Set some defaults for the login view
      params.form.username = '';
      params.form.password = '';
      params.form.remember = false;

      emitter.emit('ready');
    }

    // Using a separate action in your controller for form submissions
    // is probably a good idea
    function form(params, context, emitter) {
      var authenticate = app.models.user.authenticate({
            username: params.form.username,
            password: params.form.password
          }),
          cookie = {};

      if ( authenticate.success ) {
        if ( params.form.remember ) {
          cookie = {
            username: params.form.username
          };
        }

        emitter.emit('ready', {
          cookie: cookie,
          redirect: '/'
        });
      } else {
        emitter.emit('ready', {
          content: {
            message: 'Login failed.'
          }
        });
      }
    }

If it's a multipart form containing a file, the form object passed to your controller will look something like this:

    {
      foo: 'bar',
      fizz: 'buzz',
      imageFieldName: {
        size: 280,
        path: '/tmp/upload_6d9c4e3121f244abdff36311a3b19a16',
        name: 'image.png',
        type: 'image/png',
        hash: null,
        lastModifiedDate: Fri Feb 27 2015 06:01:36 GMT-0500 (EST)
      }
    }

See the [formidable documentation](https://www.npmjs.com/package/formidable) for available form settings. You can pass form settings via `citizen.forms` in the config. Set global form settings via `citizen.forms.global` and options for individual controller form actions via `citizen.forms.controller`.

The following config sets the upload directory for all forms to the path specified. It also sets the `maxFieldsSize` setting for the editForm() action in the article controller to 5MB:

    {
      "citizen": {
        "forms": {
          "global": {
            "uploadDir":  '/absolute/path/to/upload/directory'
          },
          "controller": {
            "article": {
              "editForm": {
                "maxFieldsSize": 5
              }
            }
          }
        }
      }
    }

Unlike formidable, the `maxFieldsSize` option includes images in a multipart form in its calculations. citizen includes this enhancement because formidable provides no built-in way of limiting file upload sizes.



### AJAX form submissions

citizen makes it easy to build progressively enhanced HTML forms that work both server-side and client-side. Here's a login form that will submit to the login controller and fire the `form()` action:

    section.login-form
      p#message
        if message
          = message
        else
          | Please log in below.
      form#login-form(action="/login/action/form" method="post" novalidate)
        .data
          ul
            li.username
              label(for="username") Username
              input(id="username" name="username" type="text" value="#{form.username}" required autofocus)
            li.password
              label(for="password") Password
              input(id="password" name="password" type="password" value="#{form.password}" required)
        .actions
          ul
            li.primary
              input(name="formAction" type="submit" value="Sign in")


This will perform a traditional POST to the server and reload the login page to display any messages. You can easily enhance this with a little JavaScript on the client to submit via AJAX and return a JSON response:

    var loginForm = document.querySelector('#login-form'),
        message = document.querySelector('#message');

    loginForm.addEventListener('submit', function (e) {
      var request = new XMLHttpRequest(),
          formData = new FormData(loginForm);

      e.preventDefault();

      // Appending /format/json to the form action tells the server to
      // respond with JSON instead of a rendered HTML view
      request.open('POST', loginForm.action + '/format/json', true);

      request.send(formData);

      request.onload = function() {
        var loginResponse = JSON.parse(request.responseText);

        message.innerHTML = loginResponse.message;
      };
    });


By appending `/format/json` to the action URL via JavaScript, we receive a JSON response from the controller and can then parse this response and update the view on the client. This is a form that provides a good user experience, but still works without JavaScript.


## Application Events and the Context Argument

Certain events will occur throughout the life of your citizen application. You can act on these application events, execute functions, set directives, and pass the results to the next event or your controller via the `context` argument. For example, you might set a custom cookie at the beginning of every new session, or check for cookies at the beginning of every request and redirect the user to a login page if they're not authenticated.

To take advantage of these events, include a directory called "on" in your app with any or all of following modules and exports:

    app/
      on/
        application.js // exports start(), end(), and error()
        request.js     // exports start() and end()
        response.js    // exports start() and end()
        session.js     // exports start() and end()

`request.start()`, `request.end()`, and `response.start()` are called before your controller is fired, so the output from those events is passed from each one to the next, and ultimately to your controller via the `context` argument. Exactly what they output—content, citizen directives, custom directives—is up to you.

All files and exports are optional. citizen only calls them if they exist. For example, you could have only a request.js module that exports `start()`.

_Note: As of this version, session end() and application end() aren't functional. They'll be in a future version._

Here's an example of a request module that checks for a username cookie at the beginning of every request and redirects the user to the login page if it doesn't exist. We also avoid a redirect loop by making sure the requested controller isn't the login controller:

    // app/on/request.js

    exports.start = start;

    function start(params, context, emitter) {
      var redirect = {};

      if ( !params.cookie.username && params.route.controller !== 'login' ) {
        redirect = '/login';
      }

      emitter.emit('ready', {
        redirect: redirect
      });
    };



## Cross-Origin Resource Sharing (CORS) _[deprecated]_

_Note: this method for enabling CORS has been deprecated and will be removed from v0.8.0. It will be replaced with a similar method of setting headers that can be specified within each controller action for more granular control._

citizen supports cross-domain HTTP requests via access control headers. By default, all controllers respond to requests from the host only. This includes POST requests, which makes any controller that accepts form input safe from cross-site form submissions.

To enable cross-domain access, add an `access` object with the necessary headers to your controller's exports:

    module.exports = {
      handler: handler,
      access: {
        // citizen expects header names in lowercase (per the spec, HTTP headers
        // are case-insensitive)
        'access-control-allow-origin': 'http://www.foreignhost.com',
        'access-control-expose-headers': 'X-My-Custom-Header, X-Another-Custom-Header',
        'access-control-max-age': 1728000,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'OPTIONS, PUT',
        'access-control-allow-headers': 'Content-Type',
        'vary': 'Origin'
      }
    };

For more details on CORS, check out [the W3C spec](http://www.w3.org/TR/cors/) and [the Mozilla Developer Network](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS).


## Helpers

citizen has helper functions that it uses internally, but might be of use to you, so it returns them for public use.


### cache.set(options)

You can store any object in citizen's cache. The primary benefits of using cache() over storing content in your own global app variables are built-in timeout functionality and wrappers for reading, parsing, and storing file content.

citizen's default cache time is 15 minutes, which you can change in the config (see [Configuration](#configuration)). Cached item lifespans are extended whenever they are accessed unless you pass `resetOnAccess: false` or change that setting in the config.

    // Cache a string in the default app scope for 15 minutes (default). Keys
    // must be unique within a given scope.
    app.cache.set({
      key: 'welcome message',
      value: 'Welcome to my site.'
    });

    // Cache a string under a custom scope, which is used for retrieving or clearing
    // multiple cache items at once. Keys must be unique within a given scope.
    // Reserved scope names are "app", "controllers", "routes", and "files".
    app.cache.set({
      key: 'welcome message',
      scope: 'site messages',
      value: 'Welcome to our site.'
    });

    // Cache a string for the life of the application.
    app.cache.set({
      key: 'welcome message',
      value: 'Welcome to my site.',
      lifespan: 'application'
    });

    // Cache a string for the life of the application, and overwrite the
    // existing key. The overwrite property is required any time you want to
    // write to an existing key. This prevents accidental overwrites.
    app.cache.set({
      key: 'welcome message',
      value: 'Welcome to our site.',
      lifespan: 'application',
      overwrite: true
    });

    // Cache a file buffer using the file path as the key. This is a wrapper for
    // fs.readFile and fs.readFileSync paired with citizen's cache function.
    // Optionally, tell citizen to perform a synchronous file read operation and
    // use an encoding different from the default (UTF-8).
    app.cache.set({
      file: '/path/to/articles.txt',
      synchronous: true,
      encoding: 'CP-1252'
    });

    // Cache a file with a custom key. Optionally, parse the JSON and store the
    // parsed object in the cache instead of the raw buffer. Expire the cache
    // after 10 minutes, regardless of whether the cache is accessed or not.
    app.cache.set({
      file: '/path/to/articles.json',
      key: 'articles',
      parseJSON: true,
      lifespan: 10,
      resetOnAccess: false
    });

`app`, `controllers`, `routes`, and `files` are reserved scope names, so you can't use them for your own custom scopes.


### cache.exists(options)

This is a way to check for the existence of a given key or scope in the cache without resetting the cache timer on that item. Returns `false` if a match isn't found.

    // Check for the existence of the specified key
    var keyExists = app.cache.exists({ key: 'welcome message' })          // keyExists is true
    var keyExists = app.cache.exists({ file: '/path/to/articles.txt' })   // keyExists is true
    var keyExists = app.cache.exists({ file: 'articles' })                // keyExists is true
    var keyExists = app.cache.exists({ key: 'foo' })                      // keyExists is false

    // Check the specified scope for the specified key
    var keyExists = app.cache.exists({
      scope: 'site messages',
      key: 'welcome message'
    });
    // keyExists is true

    // Check if the specified scope exists and contains items
    var scopeExists = app.cache.exists({
      scope: 'site messages'
    });
    // scopeExists is true

    // Check if the controller cache has any instances of the specified controller
    var controllerExists = app.cache.exists({
      controller: 'article'
    });

    // Check if the controller cache has any instances of the specified controller
    // and action
    var controllerExists = app.cache.exists({
      controller: 'article',
      action: 'edit'
    });

    // Check if the controller cache has any instances of the specified controller,
    // action, and view
    var controllerExists = app.cache.exists({
      controller: 'article',
      action: 'edit',
      view: 'edit'
    });

    // Check if the controller cache has an instance of the specified controller,
    // action, and view for a given route
    var controllerExists = app.cache.exists({
      controller: 'article',
      action: 'edit',
      view: 'edit',
      route: '/article/My-Article/page/2'
    });


### cache.get(options)

Retrieve an individual key or an entire scope. Returns `false` if the requested item doesn't exist. If `resetOnAccess` was true when the item was cached, using retrieve() will reset the cache clock and extend the life of the cached item. If a scope is retrieved, all items in that scope will have their cache timers reset.

Optionally, you can override the `resetOnAccess` attribute when retrieving a cache item by specifying it inline.

    // Retrieve the specified key from the default (app) scope
    var welcomeMessage = app.cache.get({
      key: 'welcome message'
    });

    // Retrieve the specified key from the specified scope and reset its cache timer
    // even if resetOnAccess was initially set to false when it was stored
    var welcomeMessage = app.cache.get({
      scope: 'site messages',
      key: 'welcome message',
      resetOnAccess: true
    });

    // Retrieve all keys from the specified scope
    var siteMessages = app.cache.get({
      scope: 'site messages'
    });

    // Retrieve a cached file
    var articles = app.cache.get({
      file: '/path/to/articles.txt'
    });

    // Retrieve a cached file with its custom key
    var articles = app.cache.get({
      file: 'articles'
    });


### cache.clear(options)

Clear a cache object using a key or a scope.

    // Store some cache items

    app.cache.set({
      key: 'welcome message',
      scope: 'site messages',
      value: 'Welcome to our site.'
    });

    app.cache.set({
      key: 'goodbye message',
      scope: 'site messages',
      value: 'Thanks for visiting!'
    });

    app.cache.set({
      file: '/path/to/articles.txt',
      synchronous: true
    });

    // Clear the welcome message from its custom scope cache
    app.cache.clear({ scope: 'site messages', key: 'welcome message' });

    // Clear all messages from the cache using their custom scope
    app.cache.clear({ scope: 'site messages' });

    // Clear the articles cache from the file scope
    app.cache.clear({ file: '/path/to/articles.txt' });


`clear()` can also be used to remove cached routes and controllers from their respective caches.

    // Clear the specified route from the cache
    app.cache.clear({
      route: '/article/My-Article/page/2/action/edit'
    });

    // Clear the specified controller from the cache, including all actions and views
    app.cache.clear({
      controller: 'article'
    });

    // Clear the specified controller/action pairing from the cache. All cached views
    // related to this pairing will be deleted.
    app.cache.clear({
      controller: 'article',
      action: 'edit'
    });

    // Clear the specified controller/action/view combination from the cache
    app.cache.clear({
      controller: 'article',
      action: 'edit',
      view: 'edit'
    });

    // Clear the specified controller/action/view/route combination from the cache
    app.cache.clear({
      controller: 'article',
      action: 'edit',
      view: 'edit',
      route: '/article/My-Article/page/2/action/edit'
    });

    // Clear the entire controller scope
    app.cache.clear({ scope: 'controllers' });

    // Clear the entire route scope
    app.cache.clear({ scope: 'routes' });

    // Clear the entire file scope
    app.cache.clear({ scope: 'files' });

    // Clear the entire app scope
    app.cache.clear({ scope: 'app' });


### listen()

The article example we've been using has only simple methods that return static content immediately, but things are rarely that simple. The `listen()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listen()` functions for very powerful asynchronous function calls.

`listen()` takes up to three arguments: the type of flow control you'd like to use (optional), an object containing one or more methods you want to call, and a callback to process the output (optional). `listen()` requires that your asynchronous functions be written to accept an `emitter` argument, which is how your function notifies `listen()` that it's ready.


#### Parallel function calls

`listen()` defaults to parallel processing. It fires all the functions you provide, then returns the output of all functions in a single output object. This is the option to use if none of the functions you're calling depend on each other in any way, but you need all of them to return before proceeding.

Let's say our article controller needs to call several methods that hit the database asynchronously. Use `listen()` to call them all and proceed only after all are complete:

      // listen() defaults to parallel processing, so the flow option is optional
      app.listen({

        // The property contains the action you want to listen for, which is
        // wrapped in an anonymous function in order to pass the emitter
        article: function (emitter) {

          // Pass the emitter into the function you call
          app.models.article.getArticle(params.url.article, params.url.page, emitter);
        },
        viewers: function (emitter) {
          app.models.article.getViewers(params.url.article, emitter);
        }
      }, function (output) {

        // This callback fires after both functions' emitters fire.
        // Access the returned data via the output argument:
        //
        // output.listen    - Contains status of all methods in listen()
        //                    Each method's status can be 'waiting', 'ready', 'timeout', 'skipped', or 'error'
        //
        //                    {
        //                      success: true,
        //                      status: {
        //                        article: 'ready',
        //                        viewers: 'ready'
        //                      }
        //                    }
        //
        // output.article   - Contains output from the article method
        // output.viewers   - Contains output from the viewers method

      });


And the model:

    // Methods called via listen() must be written to accept the emitter
    function getArticle(article, page, emitter) {
      app.db.article({ article: article, page: page }, function (err, data) {

        if ( err ) {

          // If there's an error, use the emitter's error event
          emitter.emit('error', err);

        } else {

          // When the database returns the data, emit `ready` and pass the
          // data back to listen()
          emitter.emit('ready', data);

        }

      });
    };

    function getViewers(article, emitter) {
      app.db.viewers({ article: article }, function (data) {
        emitter.emit('ready', data);
      });
    };


After `getArticle()` and `getViewers()` both emit ready, the callback is fired.

If the `listen()` emitter syntax in the model example looks familiar, it should, because it's the same emitter syntax you use in your controller to pass the request context to the server. citizen uses `listen()` internally for this event.


#### Series function calls

If you need functions to fire and return in order, use `series`. The syntax is the same as `parallel` except for the inclusion of the series option:

    app.listen('series', {

      // article fires first
      article: function (emitter) {
        app.models.article.getArticle(params.url.article, params.url.page, emitter);
      },

      // viewers fires only after the article function emits 'ready'
      viewers: function (emitter) {
        app.models.article.getViewers(params.url.article, emitter);
      }
    }, function (output) {

        // output.article
        // output.viewers

    });


#### Waterfall function calls

Use `waterfall` to fire and return functions in order and then pass all previous functions' results to the next function in line. Functions after the first function must be written to accept two arguments: the result from the previous function(s) and the emitter.

    app.listen('waterfall', {

      // article fires first
      article: function (emitter) {
        app.models.article.getArticle(params.url.article, params.url.page, emitter);
      },

      // viewers will not fire until the previous article function is complete.
      // It accepts an object that contains the emitted result from the previous
      // function.
      viewers: function (previous, emitter) {

        // previous.article

        app.models.article.getViewers(previous.article.id, emitter);
      },

      // details fires after viewers is complete and its output is added to the
      // collection
      details: function (previous, emitter) {

        // previous.article
        // previous.viewers

        app.models.article.getDetails(previous.viewers, emitter);
      }
    }, function (output) {

        // output.article
        // output.viewers
        // output.details

    });


#### Flow control

You use the `skip`, `end`, and `error` emitter events to control the flow of embedded listen() methods in series and waterfall executions.


##### skip (series and waterfall only)

Use `skip` to skip the next method in the chain. If the next method is the last method, the callback is fired. In the following example, secondMethod uses the output from firstMethod to determine whether to execute thirdMethod or skip it.

    app.listen('waterfall', {
      firstMethod: function (emitter) {
        var something = doSomething();

        emitter.emit('ready', {
          something: something
        });
      },
      secondMethod: function (previous, emitter) {
        var somethingElse;

        // If firstMethod provides something, fire thirdMethod
        if ( previous.something ) {
          somethingElse = doSomethingElse();

          emitter.emit('ready', {
            somethingElse: somethingElse
          });
        // If there's no result from firstMethod, skip thirdMethod
        } else {
          emitter.emit('skip');
        }
      },
      thirdMethod: function (previous, emitter) {
        var lastThing;

        if ( previous.somethingElse ) {
          lastThing = lastThing();
        }

        emitter.emit('ready', {
          lastThing: lastThing
        });
      }
    }, function (output) {

      output.listen.success;              // true
      output.listen.status.firstMethod;   // 'ready'
      output.listen.status.secondMethod;  // 'ready'
      output.listen.status.thirdMethod;   // 'skipped'

    });


##### end (series and waterfall only)

Use `end` to skip all remaining methonds and fire the callback. In the following example, firstMethod tells listen() to go straight to the callback, skipping secondMethod and thirdMethod.

    app.listen('waterfall', {
      firstMethod: function (emitter) {
        var something = doSomething();

        if ( something ) {
          emitter.emit('ready', something);
        } else {
          emitter.emit('end');
        }

      },
      secondMethod: function (previous, emitter) {
        var somethingElse = doSomethingElse();

        emitter.emit('ready', somethingElse);
      },
      thirdMethod: function (previous, emitter) {
        var lastThing = lastThing();

        emitter.emit('ready', lastThing);
      }
    }, function (output) {

      output.listen.success;              // true
      output.listen.status.firstMethod;   // 'ready'
      output.listen.status.secondMethod;  // 'skipped'
      output.listen.status.thirdMethod;   // 'skipped'

    });


##### error

Use `error` to throw an error and fire the callback, which is responsible for handling the error. In series and waterfall executions, emitting `error` skips the remaining methods in the chain. In parallel executions, there's no way to stop the remaining methods from firing. In the following example, firstMethod fires, but secondMethod throws an error, skipping thirdMethod.

    app.listen('waterfall', {
      firstMethod: function (emitter) {
        var something = doSomething();

        if ( something ) {
          emitter.emit('ready', something);
        } else {
          emitter.emit('end');
        }

      },
      secondMethod: function (previous, emitter) {
        var somethingElse = doSomethingElse();

        if ( somethingElse ) {
          emitter.emit('ready', somethingElse);
        } else {
          emitter.emit('error');
        }

      },
      thirdMethod: function (previous, emitter) {
        var lastThing = lastThing();

        emitter.emit('ready', lastThing);
      }
    }, function (output) {

      output.listen.success;              // false
      output.listen.status.firstMethod;   // 'ready'
      output.listen.status.secondMethod;  // 'error'
      output.listen.status.thirdMethod;   // 'skipped'

    });


### copy(object)

Creates a deep copy of an object.

    var myCopy = app.copy(myObject);


### extend(object, extension)

Extends an object with another object, effectively merging the two objects. extend() creates a copy of the original before extending it, creating a new object. Nested objects are also merged, but properties in the original object containing arrays are overwritten by the extension (arrays aren't merged).

    var newObject = app.extend(originalObject, extensionObject);


### isNumeric(object)

Returns `true` if the object is a number, `false` if not.

    if ( app.isNumeric(params.url.id) ) {
      // pass it to the db
    } else {
      return 'Naughty naughty...';
    }


### dashes(string)

Convert strings into SEO-friendly versions that you can use in your URLs.

    var seoTitle = app.dashes("Won't You Read My Article?"); // 'Wont-You-Read-My-Article'


### size(object)

Returns the number of properties contained within an object literal. Uses `hasOwnProperty()` to return a valid count. If the provided object isn't an object literal, size() throws an error.

    var cars = {
          first: 'Volkswagen',
          second: 'Ford',
          third: 'BMW'
        },
        count = app.size(cars); // count equals 3


### log(options)

Makes it easy to log comments to either the console or a file (or both) in a way that's dependent on the mode of the framework.

When citizen is in production or development mode, log() does nothing by default. In debug mode, log() will log whatever you pass to it. This means you can place it throughout your application's code and it will only write to the log in debug mode. You can override this behavior globally with the `toConsole` and `toFile` settings in your config file or inline with the `toConsole` or `toFile` options when calling log().

    app.log({
      // Optional. Valid settings are "status" (default) or "error".
      type: 'error',

      // Optional string. Applies a label to your log item.
      label: 'Log output',

      // The content of your log. If it's anything other than a string or
      // number, log() will run util.inspect on it and dump the contents.
      contents: someObject,

      // Optional. By default, log() uses the config.citizen.log.toConsole setting
      // to determine whether to log to the console, but this option overrides it.
      toConsole: false,

      // Optional. By default, log() uses the config.citizen.log.toFile setting
      // to determine whether to log to a file, but this option overrides it.
      toFile: false,

      // Optional. By default, log() uses "app.txt" as the file name for your logs.
      // Use the config.citizen.log.defaultFile setting to change the default.
      // Use this option to override the default inline.
      file: 'my-log-file.txt',

      // Optional. Disables the timestamp that normally appears in front of the log
      timestamp: false
    });

When file logging is enabled, citizen writes its logs to citizen.txt. Log files appear in the folder you specify in `config.citizen.log.path`.



## Debugging

**Warning: `debug` and `development` modes are inherently insecure. Don't use them in a production environment.**

If you set `"mode": "debug"` in your config file, citizen dumps the current pattern's context and request parameters to the console. You can dump it to the view instead by setting `debug.output` in your config file to `view`, or use the `ctzn_dump` URL parameter on a per-request basis:

    // config file: always dumps debug output in the view
    {
      "citizen": {
        "debug": {
          "output": "view"
        }
      }
    }

    // URL
    http://www.cleverna.me/article/id/237/page/2/ctzn_dump/view


By default, the pattern's complete output is dumped. You can specify the exact object to debug with the `ctzn_debug` URL parameter. You can access globals, `pattern` (which is the current controller chain), and request `params`:

    // Dumps pattern.content
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/pattern.content

    // Dumps the server params object
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params

    // Dumps the user's session scope
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session

    // Dumps the user's session scope to the view
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session/ctzn_dump/view

    // Dumps the CTZN global object
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/CTZN


The debug output traverses objects 2 levels deep by default. To display deeper output, use the `debug.depth` setting in your config file or append `ctzn_debugDepth` to the URL. Debug rendering will take longer the deeper you go.

    // config file: debug 4 levels deep
    {
      "citizen": {
        "debug": {
          "depth": 4
        }
      }
    }

    // URL
    http://www.cleverna.me/article/id/237/page/2/ctzn_debugDepth/4


In `development` mode, you must specify the `ctzn_debug` URL parameter to display debug output. Debug output is disabled in production mode.


## Utilities

The util directory within the citizen package has some helpful CLI utilities.

### scaffold

#### skeleton

Creates a complete skeleton of a citizen app with a functional index pattern and error templates.

    $ node node_modules/citizen/util/scaffold skeleton

Resulting file structure:

    app/
      config/
        citizen.json
      logs/
      on/
        application.js
        request.js
        response.js
        session.js
      patterns/
        controllers/
          index.js
        models/
          index.js
        views/
          error/
            404.pug
            500.pug
            ENOENT.pug
            error.pug
          index/
            index.pug
      start.js
    web/

Run `node node_modules/citizen/util/scaffold skeleton -h` for options.


#### pattern

Creates a complete citizen MVC pattern. The pattern command takes a pattern name and options:

    $ node node_modules/citizen/util/scaffold pattern [options] [pattern]

For example, `node scaffold pattern -f hbs article` will create the following pattern with a view file in Handlebars format:

    app/
      patterns/
        controllers/
          article.js
        models/
          article.js
        views/
          article/
            article.hbs

Use `node node_modules/citizen/util/scaffold pattern -h` to see all available options for customizing your patterns.


## License

(The MIT License)

Copyright (c) 2014 [Jason Sylvester](http://jaysylvester.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
