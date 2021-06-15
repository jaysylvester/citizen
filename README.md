STUFF TO ADD
- Use 'Accept': 'application/json' header to receive JSON responses
- Reformat all examples using ES module syntax
- Explain ESM vs CJS and file extensions (.js vs .cjs)
- replace app.start() with app.server.start()
- replace app.log() with app.helpers.log()
- new controller config for CORS, forms, etc.
- options to specify keepAliveTimeout, maxHeadersCount, requestTimeout, timeout in both http and https
- replace /type/direct with /direct/true
- Update the scaffold util and docs
- chokidar options
  - Add note to use polling (options: { usePolling: true }) if necessary for hot module reloading to work correctly
- Application cache enabled by default, static is not
- Make a note in the route cache section that HTTP headers are preserved in the cache
- legalFormats changed to contentTypes, all enabled by default
- url.format deprecated
- cache overwrite removed, default behavior is to overwrite
- new logging options
- ctzn_debug and ctzn_inspect (get rid of ctzn_dump)


# citizen

citizen is an MVC-based web application framework designed for people interested in quickly building fast, scalable web sites instead of digging around Node's guts or cobbling together a Jenga tower made out of 20 different packages.

Use citizen as the foundation for a traditional server-side web application, a modular single-page application (SPA), or a REST API.


## Benefits

- High performance and stability
- Zero-configuration server-side routing with SEO-friendly URLs
- Server-side session management
- Caching for routes, individual controllers, objects, and static files
- Simple directives for managing cookies, sessions, redirects, caches, and more
- Powerful code reuse options via controller-based includes and chaining
- HTML, JSON, and JSONP served from the same pattern
- `async await` support
- ES module and Node (CommonJS) module support
- Hot module reloading in development mode
- Support for many template engines with [consolidate](https://github.com/tj/consolidate.js)
- Few direct dependencies

Have questions, suggestions, or need help? Want to contribute? [Get in touch](https://jaysylvester.com/contact). Pull requests are welcome.


## Is it production-ready?

I use citizen on [my personal site](https://jaysylvester.com) and [originaltrilogy.com](https://originaltrilogy.com). OT.com gets a moderate amount of traffic (between 300K and 400K page views per month) and runs for months on end on a $20 cloud hosting plan without the app/process crashing. It's very stable.


## Quick Start

These commands will create a new directory for your web app, install citizen, use its scaffolding utility to create the app's skeleton, and start citizen with the web server listening on port 8080 (citizen defaults to port 80, but it's often in use already, so change it to whatever you want):

    $ mkdir myapp && cd myapp
    $ npm install citizen
    $ node node_modules/citizen/util/scaffold skeleton -n 8080
    $ node app/start.js

If everything went well, you'll see confirmation in the console that the web server is running. Go to http://127.0.0.1:8080 in your browser and you'll see a bare index template.

citizen installs [Handlebars](http://handlebarsjs.com) as its default template engine, but you can install any template engine supported by [consolidate.js](https://github.com/tj/consolidate.js), update the [config template settings](#config-settings), and modify the default view templates accordingly.

For configuration options, see [Configuration](#configuration). For more utilities to help you get started, see [Utilities](#utilities).

### Demo App

Check out [model-citizen](https://github.com/jaysylvester/model-citizen), a basic responsive web site built with citizen that demonstrates some of the framework's functionality.


### App Directory Structure

    /app
      /config             // These files are all optional
        citizen.json      // Default config file
        local.json        // Examples of environment configs
        qa.json
        prod.json
      /hooks              // Application event hooks (optional)
        application.js
        request.js
        response.js
        session.js
      /logs               // Log files created by citizen and your app
        app.log
        citizen.log
      /patterns
        /controllers      // Controllers
          index.js
        /models           // Models (optional)
          index.js
        /views
          /error
            error.hbs     // Default error view
          /index
            index.hbs     // Default index view
            other.hbs     // Alternate index view (optional)
      start.js
    /web                  // public static assets



### Initializing citizen and starting the web server

The start.js file in your app directory can be as simple as this:

    // start.js

    import citizen from 'citizen'

    global.app = citizen

    app.server.start()


Run start.js from the command line:

    $ node start.js



### Configuration

The config directory is optional and contains configuration files that drive both citizen and your app in JSON format. You can have multiple citizen configuration files within this directory, allowing different configurations based on environment. citizen retrieves its configuration file from this directory based on the following logic:

1. citizen parses each JSON file looking for a `host` key that matches the machine's hostname. If it finds one, it loads that configuration.
2. If it can't find a matching `host` key, it looks for a file named citizen.json and loads that configuration.
3. If it can't find citizen.json or you don't have a config directory, it runs under its default configuration.

Let's say you want to run citizen on port 8080 in your local dev environment and you have a local database your app will connect to. You could create a config file called local.json (or myconfig.json, whatever you want) with the following:

    {
      "host":       "My-MacBook-Pro.local",
      "citizen": {
        "mode":     "development",
        "http": {
          "port":   8080
        }
      },
      "db": {
        "server":   "localhost",
        "username": "dbuser",
        "password": "dbpassword"
      }
    }

This config would extend the default configuration only when running on your local machine. If you were to push this to a production environment accidentally, it wouldn't do anything. Using this method, you can commit multiple config files from different environments to the same repository.

The database settings would be accessible within your app via `app.config.db`. The `citizen` and `host` nodes are reserved for the framework; create your own node(s) to store your custom settings.


#### Inline config

You can also pass your app's configuration directly to citizen through `app.start()`. If there is a config file, an inline config will extend the config file. If there's no config file, the inline configuration extends the default citizen config.

    // Start an HTTP server on port 8080 accepting requests at www.mysite.com
    app.start({
      citizen: {
        http: {
          hostname: 'www.mysite.com',
          port:     8080
        }
      }
    })

    // Start an HTTPS server with key and cert PEM files
    app.start({
      citizen: {
        http: {
          enable: false
        },
        https: {
          enable: true,
          key:    '/absolute/path/to/key.pem',
          cert:   '/absolute/path/to/cert.pem'
        }
      }
    })

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
    })


#### Default configuration

The following represents citizen's default configuration, which is extended by your configuration:

    {
      host                  : "",
      citizen: {
        mode                : "production",
        http: {
          enable            : true,
          hostname          : "127.0.0.1",
          port              : 80
        },
        https: {
          enable            : false,
          hostname          : "127.0.0.1",
          port              : 443,
          secureCookies     : true
        },
        connectionQueue     : null,
        fallbackController  : "",
        templateEngine      : "handlebars",
        compression: {
          enable            : false,
          force             : false,
          mimeTypes         : "text/plain text/html text/css application/x-javascript application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml"
        },
        sessions            : false,
        sessionTimeout      : 20,
        layout: {
          controller        : "",
          view              : ""
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
            encoding        : "utf-8",
            synchronous     : false
          },
          static: {
            enable          : false,
            lifespan        : 15,
            resetOnAccess   : true
          },
          control           : {}
        },
        log: {
          console: {
            colors          : true,
            error           : false,
            status          : false
          },
          file: {
            error           : false,
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
              request       : true,
              response      : true,
              route         : true,
              session       : true,
              url           : true,
            },
            depth           : 3,
            showHidden      : false,
            view            : false
          },
          enableCache       : false,
          watcher: {
            custom          : [],
            interval        : 500,
            killSession     : false
          }
        },
        urlPaths:  {
          app               : "/"
        },
        directories:  {
          app               : "[resolved based on location of start.js]",
          hooks             : "[directories.app]/hooks",
          logs              : "[directories.app]/logs",
          controllers       : "[directories.app]/patterns/controllers",
          models            : "[directories.app]/patterns/models",
          views             : "[directories.app]/patterns/views",
          web               : "web"
        }
      }
    }

#### HTTPS

When starting an HTTPS server, in addition to the `hostname` and `port` options, citizen takes the same options as [Node's https.createServer()](http://nodejs.org/api/https.html#https_https_createserver_options_requestlistener) (which takes the same options as [tls.createServer()](http://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener)).

The only difference is how you pass key files. As you can see in the examples above, you pass citizen the file paths for your key files. citizen reads the files for you.


#### Config settings

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
      </ul>
      <p>
        Default: <code>production</code>
      </p>
    </td>
    <td>
      The application mode determines certain runtime behaviors. Production mode silences console logs and enables all application features. Development mode enables verbose console logs, disables caching, and enables the file watcher for hot module reloading for controllers, models, and hooks.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      http
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
        String
      </p>
      <p>
        Default: <code>127.0.0.1</code>
      </p>
    </td>
    <td>
      The hostname at which your app can be accessed via HTTP. The default is localhost, but you can specify an empty string to accept requests at any hostname.
    </td>
  </tr>
  <tr>
    <td>
      <code>port</code>
    </td>
    <td>
      <p>
        Number
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
      https
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
        String
      </p>
      <p>
        Default: <code>127.0.0.1</code>
      </p>
    </td>
    <td>
      The hostname at which your app can be accessed via HTTPS. The default is localhost, but you can specify an empty string to accept requests at any hostname.
    </td>
  </tr>
  <tr>
    <td>
      <code>port</code>
    </td>
    <td>
      <p>
        Number
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
      If sessions are enabled, this number represents the length of a user's session in minutes. Sessions automatically expire if a user has been inactive for this amount of time.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      layout
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
    <td>
      <code>templateEngine</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>handlebars</code>
      </p>
    </td>
    <td>
      citizen installs Handlebars by default, but you can change the template engine to any engine supported by <a href="https://github.com/tj/consolidate.js">consolidate.js</a>.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      legalFormat
    </td>
  </tr>
  <tr>
    <td>
      <code>html</code>
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
      citizen provides HTML output by default based on your views. You can disable HTML entirely if you plan to use citizen for building an API that returns JSON or JSONP only.
    </td>
  </tr>
  <tr>
    <td>
      <code>json</code>
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
      JSON output is disabled by default. Set this value to <code>true</code> to enable global JSON output from all controllers. To enable JSON at the controller action level, see the <a href="#formats">legalFormat directive</a> and  <a href="#json-and-jsonp">JSON and JSONP</a> for details.
    </td>
  </tr>
  <tr>
    <td>
      <code>jsonp</code>
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
      JSONP output is disabled by default. Set this value to <code>true</code> to enable global JSONP output from all controllers. To enable JSONP at the controller action level, see the <a href="#formats">legalFormat directive</a> and  <a href="#json-and-jsonp">JSON and JSONP</a> for details.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      form
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
        Default: Same as <a href="https://www.npmjs.com/package/formidable">formidable</a>
      </p>
    </td>
    <td>
      citizen uses <a href="https://www.npmjs.com/package/formidable">formidable</a> to parse form data. The defaults match that of formidable. Provide settings in the form node to set default settings for all your forms. See <a href="#forms">Forms</a> for details.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      compression
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
      Enables gzip and deflate compression for rendered views and static assets.
    </td>
  </tr>
  <tr>
    <td>
      <code>force</code>
    </td>
    <td>
      <p>
        Boolean or String
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
      cache
    </td>
  </tr>
  <tr>
    <td colspan="3">
      application
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
      Enables the in-memory cache, accessed via the <code>cache.set()</code> and <code>cache.get()</code> methods. Set this to <code>false</code> to disable the cache when in production mode, which is useful for debugging when not in development mode.
    </td>
  </tr>
  <tr>
    <td>
      <code>lifespan</code>
    </td>
    <td>
      <p>
        Number
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
      Determines whether to reset the cache timer on a cached asset whenever the cache is accessed. When set to <code>false</code>, cached items expire when the <code>lifespan</code> is reached.
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
      static
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
      When serving static files, citizen normally reads the file from disk for each request. You can speed up static file serving considerably by setting this to <code>true</code>, which caches file buffers in memory.
    </td>
  </tr>
  <tr>
    <td>
      <code>lifespan</code>
    </td>
    <td>
      <p>
        Number
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
    <td colspan="3">
      log
    </td>
  </tr>
  <tr>
    <td>
      console
    </td>
  </tr>
  <tr>
    <td>
      <code>colors</code>
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
      Enables color coding in console logs.
    </td>
  </tr>
  <tr>
    <td>
      <code>error</code>
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
      Controls whether errors should be logged to the console.
    </td>
  </tr>
  <tr>
    <td>
      <code>status</code>
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
      Controls whether status messages should be logged to the console when in production mode. (Development mode always logs to the console.)
    </td>
  </tr>
  <tr>
    <td colspan="3">
      file
    </td>
  </tr>
  <tr>
    <td>
      <code>error</code>
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
      Controls whether errors should be logged to a file.
    </td>
  </tr>
  <tr>
    <td>
      <code>status</code>
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
      Controls whether status messages should be logged to a file. Applies to both development and production modes.
    </td>
  </tr>
  <tr>
    <td>
      <code>maxFileSize</code>
    </td>
    <td>
      <p>
        Number
      </p>
      <p>
        Default: <code>10000</code>
      </p>
    </td>
    <td>
      Determines the maximum file size of log files in kilobytes. Default is 10000 (10 megs). When the limit is reached, the log file is renamed and a new log file is created.
    </td>
  </tr>
  <tr>
    <td colspan="3">watcher</td>
  </tr>
  <tr>
    <td>
      <code>interval</code>
    </td>
    <td>
      <p>
        Number
      </p>
      <p>
        Default: <code>60000</code>
      </p>
    </td>
    <td>
      For operating systems that don't support file events, this timer (in milliseconds) determines how often log files will be polled for changes prior to archiving.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      development
    </td>
  </tr>
  <tr>
    <td colspan="3">
      debug
    </td>
  </tr>
  <tr>
    <td>
      <code>scope</code>
    </td>
    <td>
      <p>
        Object
      </p>
    </td>
    <td>
      This setting determines which scopes are logged in the debug output in development mode. By default, all scopes are enabled.
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
        Default: <code>3</code>
      </p>
    </td>
    <td>
      When citizen dumps an object in the debug content, it inspects it using Node's util.inspect. This setting determines the depth of the inspection, meaning the number of nodes that will be inspected and displayed. Larger numbers mean deeper inspection and slower performance.
    </td>
  </tr>
  <tr>
    <td>
      <code>view</code>
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
      Set this to true to dump debug info directly into the HTML view.
    </td>
  </tr>
  <tr>
    <td>
      <code>enableCache</code>
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
      Development mode disables the cache. Change this setting to <code>true</code> to enable the cache in development mode.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      watcher
    </td>
  </tr>
  <tr>
    <td>
      <code>custom</code>
    </td>
    <td>
      <p>
        Array
      </p>
    </td>
    <td>
      You can tell citizen's hot module reloader to watch your own custom modules. This array can contain objects with <code>watch</code> (relative directory path to your modules within the app directory) and <code>assign</code> (the variable to which you assign these modules) properties. Example:
      <br><br>
      <code>[ { "watch": "/toolbox", "assign": "app.toolbox" } ]</code>
    </td>
  </tr>
  <tr>
    <td>
      <code>interval</code>
    </td>
    <td>
      <p>
        Number
      </p>
      <p>
        Default: <code>500</code>
      </p>
    </td>
    <td>
      Determines the polling interval in milliseconds for hot module reloading on operating systems that don't support file system events. Shorter intervals are more CPU intensive.
    </td>
  </tr>
  <tr>
    <td colspan="3">
      urlPaths
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
      Denotes the URL path leading to your app. If you want your app to be accessible via http://yoursite.com/my/app and you're not using another server as a front end to proxy the request, this setting should be <code>/my/app</code> (don't forget the leading slash). This setting is required for the router to work.
    </td>
  </tr>
</table>


These settings are exposed publicly via `app.config.host` and `app.config.citizen`.

**Note:** This documentation assumes your global app variable name is "app", but you can call it whatever you want. Adjust accordingly.


### citizen methods and objects

<table>
  <tr>
    <td>
      <code>app.start()</code>
    </td>
    <td>
      Starts a citizen web application server.
    </td>
  </tr>
  <tr>
    <td>
      <code>app.cache.set()</code><br />
      <code>app.cache.exists()</code><br />
      <code>app.cache.get()</code><br />
      <code>app.cache.clear()</code><br />
      <code>app.log()</code>
    </td>
    <td>
      <a href="#helpers">Helpers</a> used internally by citizen, exposed publicly since you might find them useful.
    </td>
  </tr>
  <tr>
    <td>
      <code>app.controllers</code><br />
      <code>app.models</code>
    </td>
    <td>
      Contains your supplied patterns, which you can use instead of <code>require</code>.
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
</table>



## Routing and URLs

The citizen URL structure determines which controller and action to fire, passes URL parameters, and makes a bit of room for SEO-friendly content that can double as a unique identifier. The structure looks like this:

    http://www.site.com/controller/seo-content/action/myAction/param/val/param2/val2

For example, let's say your site's base URL is:

    http://www.cleverna.me

The default controller is `index`, so the above is the equivalent of the following:

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

This SEO content must always follow the controller name and precede any name/value pairs. You can access it generically via `route.descriptor` or within the `url` scope (`url.article` in this case), which means you can use it as a unique identifier (more on URL parameters in the [Controllers section](#controllers)).

The SEO content can consist of letters, numbers, dots (.), and the tilde (~) character.



## MVC Patterns

citizen relies on a simple model-view-controller convention. The article pattern mentioned above might use the following structure:

    app/
      patterns/
        controllers/
          article.js
        models/
          article.js
        views/
          article/       // Directory name matches the controller name
            article.hbs  // Default view name matches the controller name
            edit.hbs     // Secondary view, which must be called explicitly

At least one controller is required for a given URL, and a controller's default view directory and default view file must share its name. Additional views should reside in this same directory. More on views in the [Views section](#views).

Models and views are optional and don't necessarily need to be associated with a particular controller. If your controller doesn't need a model, you don't need to create one. If your controller is going to pass its output to another controller for further processing and final rendering, you don't need to include a matching view. (See the [controller handoff directive](#controller-handoff).)



### Controllers

A citizen controller is just a Node module. Each controller requires at least one public  method to serve as an action for the requested route. The default action should be named `handler()`, which is called by citizen when no action is specified in the URL.

    // article controller

    module.exports = {
      handler: handler
    }

    // Default action
    async function handler(params, context) {

      // Do some stuff

      return {
        // Send content and directives to the server
      }
    }

The citizen server calls `handler()` after it processes the initial request and passes it 2 arguments: an object containing the parameters of the request and the current request's context.

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
    <td>An object containing any cookies sent with the request</td>
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

The controller name becomes a property in the URL scope that references the descriptor, which makes it well-suited for use as a unique identifier. This content is also available in the `params.route` object as `route.descriptor`.

The `context` argument contains any data that's been generated by the request up to this point. There are various events that can populate this argument with content and directives, which are then passed to your controller so you can access that content or see what directives have been set by previous events.

To return the results of the controller action, include a `return` statement with any content and [directives](#controller-directives) you want to pass to citizen.

Using the above URL parameters, I can retrieve the article content from the model and pass it back to the server:

    // article controller

    module.exports = {
      handler: handler
    }

    async function handler(params, context) {
      // Get the article
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })
      const author = await app.models.article.getAuthor({
        author: article.author
      })

      // Return the article for view rendering using the content directive
      return {
        content: {
          article: article,
          author: author
        }
      }
    }

Alternate actions can be requested using the `action` URL parameter. For example, maybe we want a different action and view to edit an article:

    // http://www.cleverna.me/article/My-Clever-Article-Title/page/2/action/edit

    // article controller

    module.exports = {
      handler: handler,
      edit: edit
    }

    async function handler(params, context) {
      // Get the article
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })
      const author = await app.models.article.getAuthor({
        author: article.author
      })

      // Return the article for view rendering using the content directive
      return {
        content: {
          article: article,
          author: author
        }
      }
    }

    async function edit(params, context) {
      // Get the article
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })

      // Use the /patterns/views/article/edit.hbs view for this action (more on
      // alternate views in later sections).
      return {
        content: {
          article: article
        },
        view: 'edit'
      }
    }

You place any data you want to pass back to citizen within the `return` statement. All the content you want to render in your view should be passed to citizen within an object called `content`, as shown above. Additional objects can be passed to citizen to set directives that provide instructions to the server (explained later in the [Controller Directives](#controller-directives) section). You can even add your own objects to the request context and pass them from controller to controller (more in the [Controller Handoff section](#controller-handoff).)


#### Private controllers

To make a controller private—inaccessible via HTTP, but accessible within your app—add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          +_header.js  // Partial, only accessible internally
          _head.js     // Partial, accessible via www.cleverna.me/_head
          article.js   // Accessible via www.cleverna.me/article


#### Cross domain requests

If you want to make a controller action available to third parties, see the [CORS section](#cross-origin-resource-sharing-cors).



### Models

Models are optional and their structure is completely up to you. citizen doesn't talk to your models directly; it only stores them in `app.models` for your convenience.

Here's what a simple model for the article pattern might look like:

    // article model

    module.exports = {
      getArticle: getArticle
    }

    async function getArticle(article, page) {
      const client = await app.db.connect()
      const result = await client.query({
        text: 'select title, summary, text, author, published from articles where id = $1 and page = $2;',
        values: [ article, page ]
      })
      client.release()

      return result.rows
    }

    async function getAuthor(author) {
      const client = await app.db.connect()
      const result = await client.query({
        text: 'select name, email from users where id = $1;',
        values: [ author ]
      })
      client.release()

      return result.rows
    }


### Views

citizen installs [Handlebars](https://npmjs.org/package/handlebars) by default, but you can install any engine supported by [consolidate.js](https://github.com/tj/consolidate.js) and set the `templateEngine` config setting accordingly. Make sure you use the correct file extension with your views so citizen knows how to parse them. citizen only supports one template engine at a time; you can't mix and match templates.

In `article.hbs`, you can reference objects you placed within the `content` object passed into the controller's return statement. citizen also injects the `params` object into your view context automatically, so you have access to those objects as local variables (such as the `url` scope):

    {{! article.hbs }}

    <!doctype html>
    <html>
      <body>
        <main>
          <h1>
            {{article.title}} — Page {{url.page}}
          </h1>
          <h2>{{author.name}}, {{article.published}}</h2>
          <p>
            {{article.summary}}
          </p>
          <section>
            {{article.text}}
          </section>
        </main>
      </body>
    </html>


#### Rendering alternate views

By default, the server renders the view whose name matches that of the controller. To render a different view, [use the `view` directive in your return statement](#alternate-views).


#### JSON and JSONP

You can tell a controller to return its content as JSON by adding the `format` URL parameter, letting the same resource serve both a complete HTML view and JSON for AJAX requests and RESTful APIs.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json

Returns...

    {
      "article": {
        "title": "My Clever Article Title",
        "summary": "Am I not terribly clever?",
        "text": "This is my article text."
      },
      "author": {
        "name": "John Smith",
        "email": "jsmith@cleverna.me"
      }
    }

Whatever you've added to the controller's return statement `content` object will be returned.

To enable JSON output at the controller level:

    return {
      content: {
        article: article,
        author: author
      },
      legalFormat: {
        json: true
      }
    }

You can also specify indivdidual nodes to return instead of returning the entire content object by using the `output` URL parameter:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json/output/author

Returns...

    {
      "name": "John Smith",
      "email": "jsmith@cleverna.me"
    }


Use dash notation in the output parameter to go deeper into the node tree:

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json/output/author-email

Returns...

    jsmith@cleverna.me


For JSONP, use `format` paired with `callback` in the URL:

    http://www.cleverna.me/article/My-Clever-Article-Title/format/jsonp/callback/foo

Returns:

    foo({
      "article": {
        "title": "My Clever Article Title",
        "summary": "Am I not terribly clever?",
        "text": "This is my article text."
      },
      "author": {
        "name": "John Smith",
        "email": "jsmith@cleverna.me"
      }
    })

To enable JSONP output at the controller level:

    return {
      legalFormat: {
        jsonp: true
      }
    }

The `output` URL parameter works with JSONP as well.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/jsonp/callback/foo/output/author-email

Returns...

    foo("jsmith@cleverna.me")


Do you always want a particular controller action to return JSON without the URL flag? Simple:

    async function handler(params) {

      // All requests handled by this controller action will output JSON
      params.route.format = 'json'

      return {
        content: {
          article: article,
          author: author
        },
        legalFormat: {
          json: true
        }
      }
    }


Are you building a RESTful API and want every request across all controllers to return JSON without using the URL flag? Also simple, via optional hooks such as `request.js`:

    // File: /app/hooks/request.js
    // All requests will be returned in JSON format because this function runs
    // at the beginning of every request. Learn more in the "Application Event Hooks
    // and the Context Argument" section.

    function start(params) {
      // Set the output format to JSON
      params.route.format = 'json'

      return {
        // Set JSON as a legal output format
        legalFormat: {
          json: true
        }
      }
    }


##### JSON security risks

The JSON output from any controller action is driven by the returned content object. Anything you place in the content object will be present in the JSON output — whether it's present in the HTML view or not.

**Take care not to place sensitive data in the content object thinking it will never be exposed because you don't reference it in your view template, because it WILL show up in your JSON.**


## Handling Errors

citizen does a great job of handling unexpected errors without exiting the process (and thereby crashing your server). The following controller action will throw an error, but the server will respond with a 500 and keep running:

    async function handler(params, context) {
      // app.models.article.foo() throws an error
      const foo = await app.models.article.foo()

      return {
        content: foo
      }
    }

You can also throw an error manually and customize the error message:

    async function handler(params, context) {
      // Get the article
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })

      // If everything is fine, return the content
      if ( article ) {
        return {
          content: article
        }
      // If there's a problem, throw an error
      } else {
        let err = new Error('The requested article does not exist.')
        // The default error code is 500, but you can specify a different code
        err.statusCode = 404
        throw err
      }
    }

Errors are returned in the format requested by the route. If you request [JSON](#json-and-jsonp) and the route throws an error, the error will be in JSON format.

The app skeleton created by the [scaffold utility](#scaffold) includes optional error view templates for common client and server errors, but you can create templates for any HTTP error code.


### Error Views

To create custom error views for server errors, create a directory called `/app/patterns/views/error` and populate it with templates named after the HTTP response code or Node error code.

    app/
      patterns/
        views/
          error/
            404.hbs      // Handles 404 errors
            500.hbs      // Handles 500 errors
            ENOENT.hbs   // Handles bad file read operations
            error.hbs    // Handles any error without its own template


These error views are only used when citizen is in `production` mode. In `development` mode, citizen dumps the raw error/stack to the view.


## Controller Directives

In addition to the view content, the controller action's return statement can also pass directives to render alternate views, set cookies and session variables, initiate redirects, call and render includes, cache views (or entire routes), and hand off the request to another controller for further processing.


### Alternate Views

By default, the server renders the view whose name matches that of the controller. To render a different view, use the `view` directive in your return statement:

    // article controller

    module.exports = {
      handler: handler
    }

    async function handler(params, context) {
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })

      return {
        content: article,
        // This tells the server to render app/patterns/views/article/edit.hbs
        view: 'edit'
      }
    }


### Formats

citizen returns HTML by default, and you can enable JSON or JSONP in the global config. However, if you want to enable custom formats at the controller action level, use the `legalFormat` directive.

If you don't enable a format, either in the controller action or global config, trying to use that format will throw an error.

    return {
      legalFormat: {
        html: false,
        json: true,
        jsonp: true
      }
    }


### Cookies

You set cookies by returning a `cookie` object within the controller action.

Here's an example of a complete cookie object's default settings:

    cookie.foo = {
      value: 'myValue',

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

      // Cookies are insecure when set over HTTP and secure when set over HTTPS.
      // You can override that behavior globally with the https.secureCookies setting
      // in your config or on a case-by-case basis with this setting.
      secure: false
    }

The following sample login controller tells the server to set `username` and `passwordHash` cookies that expire in 20 minutes:

    // login controller

    module.exports = {
      handler: handler
    }

    async function loginForm(params, context) {
      let authenticate = await app.models.login.authenticate({
            // Form values, just like URL parameters, are passed via the params
            // argument
            username: params.form.username,
            password: params.form.password
          }),
          // If a directive is an empty object, that's fine. citizen just ignores it.
          cookie = {}

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
        }
      }

      return {
        content: {
          authenticate: authenticate
        },
        cookie: cookie
      }
    }

Alternatively, you can pass strings into the cookie directive, which will create cookies using the default attributes. The following code sets the same cookies, but they expire at the end of the browser session:

    return {
      cookie: {
        username: authenticate.username,
        passwordHash: authenticate.passwordHash
      }
    }

Cookies sent by the client are available in `params.cookie` within the controller and simply `cookie` within the view context:

    <!doctype html>
    <html>
      <body>
        <section>
          {{#if cookie.username}}
            Welcome, {{cookie.username}}.
          {{else}}
            <a href="/login">Login</a>
          {{/if}}
        </section>
      </body>
    </html>

Cookie variables you set within your controller aren't immediately available within the `params.cookie` scope. citizen has to receive the context from the controller before it can send the cookie to the client, so use a local instance of the variable if you need to access it during the same request.

#### Proxy Header

If you use citizen behind a proxy, such as NGINX or Apache, make sure you have `X-Forwarded-Host` and `X-Forwarded-Proto` headers in your server configuration so citizen's handling of secure cookies works correctly.

Here's an example of how you might set this up in NGINX:

    location / {
      proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Host   $host;
      proxy_set_header X-Forwarded-Proto  $scheme;
      proxy_pass                          http://127.0.0.1:8080;
    }



### Session Variables

If sessions are enabled, you can access session variables via `params.session` in your controller or simply `session` within views. These local scopes reference the current user's session without having to pass a session ID.

By default, a session has four properties: `id`, `started`, `expires`, and `timer`. The session ID is also sent to the client as a cookie called `ctzn_sessionID`.

Setting session variables is pretty much the same as setting cookie variables:

    return {
      session: {
        username: 'Danny',
        nickname: 'Doc'
      }
    }

Like cookies, session variables you've just assigned aren't available during the same request within the `params.session` scope, so use a local instance if you need to access this data right away.

Sessions expire based on the `sessionTimeout` config property, which represents the length of a session in minutes. The default is 20 minutes. The `timer` is reset with each request from the user. When the `timer` runs out, the session is deleted. Any client requests after that time will generate a new session ID and send a new session ID cookie to the client.

To forcibly clear and expire the current user's session:

    return {
      session: {
        expires: 'now'
      }
    }


### Redirects

You can pass redirect instructions to the server that will be initiated after the controller action is processed.

The `redirect` object takes a URL string in its shorthand version, or three options: `statusCode`, `url`, and `refresh`. If you don't provide a status code, citizen uses 302 (temporary redirect). The `refresh` option determines whether the redirect uses a [Location header](http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.30) or the non-standard [Refresh header](https://en.wikipedia.org/wiki/List_of_HTTP_header_fields#Refresh).

    // Initiate a temporary redirect using the Location header
    return {
      redirect: 'http://cleverna.me/login'
    }

    // Initiate a permanent redirect using the Refresh header, delaying the redirect
    // by 5 seconds
    return {
      redirect: {
        url: 'http://cleverna.me/new-url',
        statusCode: 301,
        refresh: 5
      }
    }

Unlike the Location header, if you use the `refresh` option, citizen will send a rendered view to the client because the redirect occurs client-side.

Using the Location header breaks (in my opinion) the Referer header because the Referer ends up being not the resource that initiated the redirect, but the resource prior to the page that initiated it. To get around this problem, citizen stores a session variable called `ctzn_referer` that contains the URL of the resource that initiated the redirect, which you can use to redirect users properly. For example, if an unauthenticated user attempts to access a secure page and you redirect them to a login form, the address of the secure page will be stored in `ctzn_referer` so you can send them there instead of the page containing the link to the secure page.

If you haven't enabled sessions, citizen falls back to creating a cookie named `ctzn_referer` instead.

#### Proxy Header

If you use citizen behind a proxy, such as NGINX or Apache, make sure you have `X-Forwarded-Host` and `X-Forwarded-Proto` headers in your server configuration so `ctzn_referer` works correctly.

Here's an example of how you might set this up in NGINX:

    location / {
      proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Host   $host;
      proxy_set_header X-Forwarded-Proto  $scheme;
      proxy_pass                          http://127.0.0.1:8080;
    }



### HTTP Headers

You can set HTTP headers using the `header` directive:

    return {
      header: {
        'Cache-Control':  'max-age=86400',
        'Date':           new Date().toISOString()
      }
    }



### Including Controllers

citizen lets you use complete MVC patterns as includes. These includes are more than just chunks of code that you can reuse because each has its own controller, model, and view(s). Here's the syntax:

    async function handler(params, context) {
      return {
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
            route: '/index/format/json'
          },

          // This include calls the index controller, but processes it as if it
          // had been requested from a different URL and uses an alternate view.
          index: {
            route: '/index/format/json',
            view: 'myView'
          }
        }
      }
    }


Let's say our article pattern's template has the following contents. The head section contains dynamic meta data, and the header's content changes depending on whether the user is logged in or not:

    <!doctype html>
    <html>
      <head>
        <title>{{metaData.title}}</title>
        <meta name="description" content="{{metaData.description}}">
        <meta name="keywords" content="{{metaData.keywords}}">
        <link rel="stylesheet" type="text/css" href="site.css">
      </head>
      <body>
        <header>
          {{#if cookie.username}}
            <p>Welcome, {{cookie.username}}</p>
          {{else}}
            <a href="/login">Login</a>
          {{/if}}
        </header>
        <main>
          <h1>{{title}} — Page {{url.page}}</h1>
          <p>{{summary}}</p>
          <section>{{text}}</section>
        </main>
      </body>
    </html>

It probably makes sense to use includes for the head section and header because you'll use that code everywhere, but rather than simple partials, you can create citizen includes. The head section can use its own model for populating the meta data, and since the header is different for authenticated users, let's pull that logic out of the view and put it in the header's controller. I like to follow the convention of starting partials with an underscore, but that's up to you:

    app/
      patterns/
        controllers/
          _head.js
          _header.js  // Doesn't pull data, so it doesn't need a model
          article.js
        models/
          _head.js
          article.js
        views/
          _head/
            _head.hbs
          _header/
            _header.hbs
            _header-authenticated.hbs  // A different header for logged in users
          article/
            article.hbs

When the article controller is fired, it has to tell citizen which includes it needs. We do that with the `include` directive:

    // article controller

    module.exports = {
      handler: handler
    }

    async function handler(params, context) {
      // Get the article
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })

      return {
        content: article,
        include: {
          head: {
            // If only the controller is specified, the default action handler() is
            // called and the default view is rendered (_head.hbs in this case).
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
      }
    }

citizen include patterns have the same requirements as regular patterns, including a controller with a public action. The `include` directive above tells citizen to call the _head and _header controllers, pass them the same arguments that were passed to the article controller (params and context), render their respective views, and add the resulting views to the view context.

Here's what our head section controller might look like:

    // _head controller

    module.exports = {
      handler: handler
    }

    async function handler(params, context) {
      let metaData = await app.models._head({ article: params.url.article })

      return {
        content: metaData
      }
    }

And the head section view:

    <head>
      <title>{{title}}</title>
      <meta name="description" content="{{description}}">
      <meta name="keywords" content="{{keywords}}">
      <link rel="stylesheet" type="text/css" href="site.css">
    </head>

Here's what our header controller might look like:

    // _header controller

    module.exports = {
      handler: handler,
      authenticated: authenticated
    }

    function handler(params, context) {
      return {
        view: '_header'
      }
    }

    function authenticated(params, context) {
      return {
        view: '_header-authenticated'
      }
    }


And the header views:

    {{! _header view (/patterns/views/_header/_header.hbs) }}

    <header>
      <a href="/login">Login</a>
    </header>


    {{! _header-authenticated view  (/patterns/views/_header/_header-authenticated.hbs) }}

    <header>
      <p>Welcome, {{cookie.username}}</p>
    </header>


The rendered includes are stored in the `include` scope. The `include` object contains rendered HTML views, so you need to skip escaping (`{{{...}}}` in Handlebars) within the article view:

    {{! article.hbs }}

    <!doctype html>
    <html>
      {{{include.head}}}
      <body>
        {{{include.header}}}
        <main>
          <h1>{{title}} — Page {{url.page}}</h1>
          <p>{{summary}}</p>
          <section>{{text}}</section>
        </main>
      </body>
    </html>

citizen includes are self-contained. While they receive the same request context (URL parameters, form inputs, etc.) as the calling controller, content generated by the calling controller isn't automatically passed to its includes, and content generated inside an include isn't passed back to the caller. citizen includes also can't make use of cookie, session, redirect, or handoff directives, nor can they use their own includes (nested includes). Any of these directives within an include will be ignored. They only use the content directive (to populate their own views), the view directive for setting the view used by the include, and the cache directive for controller caching.

A pattern meant to be used as an include can be accessed via HTTP just like any other controller. You could request the `_head` controller like so:

    http://cleverna.me/_head

Perhaps you'd have it return meta data as JSON for the article pattern:

    // http://cleverna.me/_head/article/My-Clever-Article-Title/format/json

    {
      "title": "My Clever Article Title",
      "description": "My article's description.",
      "keywords": "clever, article, keywords"
    }


Of course, if you don't write the controller in a manner to accept direct requests and return content, it'll return nothing (or throw an error). When accessed via HTTP, the controller has access to all controller directives.

**Reminder:** To make a controller private — inaccessible via HTTP, but accessible within your app — add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          +_header.js  // Only accessible internally
          _head.js     // Accessible via www.cleverna.me/_head
          article.js   // Accessible via www.cleverna.me/article


#### Should I use a citizen include or a view partial?

citizen includes provide rich functionality, but they do have limitations and can be overkill in certain situations.

* **Do you only need to share a chunk of markup across different views?** Use a standard view partial. The syntax is easy and you don't have to create a full MVC pattern like you would with a citizen include.
* **Do you need to loop over a chunk of markup to render a data set?** The server processes citizen includes and returns them as fully-rendered HTML (or JSON), not compiled templates. You can't loop over them and inject data like you can with view partials.
* **Do you need the ability to render different includes based on logic?** citizen includes can have multiple views because they're full MVC patterns. Using a citizen include, you can call different actions and views based on logic and keep that logic in the controller where it belongs. Using view partials would require registering multiple partials and putting the logic in the view template.
* **Do you want the include to be accessible from the web?** Since a citizen include has a controller, you can request it via HTTP like any other controller and get back HTML, JSON, or JSONP, which is great for AJAX requests and single page apps.


### Controller Handoff

citizen allows the requested controller to give another controller the responsibility of handling the request and rendering its own view via a directive called `handoff`. The requested controller passes its content and directives to a secondary controller that assumes responsibility for the request, adding its own content and directives and rendering its own view. This is also a method for passing your own custom content and directives to the receiving controller.

A common use case for `handoff` would be to create a layout controller that serves as a template for every page on your site, rendering all the includes necessary and leaving only the core content and markup to the initially requested controller. Let's modify the article controller and view so it hands off rendering responsibility to a separate layout controller:

    // article controller

    module.exports = {
      handler: handler
    }

    async function handler(params, context) {
      const article = await app.models.article.getArticle({
        article: params.url.article,
        page: params.url.page
      })

      return {
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
        // Just don't use any reserved citizen directive names.
        myDirective: {
          doSomething: true
        }
      }
    }


The view of the originally requested controller (article.hbs in this case) is rendered and stored in the `route.chain` object:

    {{! article.hbs, which is stored in the route.chain scope }}

    <h1>{{title}}</h1>
    <p>{{summary}}</p>
    <section>{{text}}</section>


The layout controller handles the includes, follows your custom directive, and renders its own view:

    // layout controller

    module.exports = {
      handler: handler
    }

    async function handler(params, context) {
      // Access my custom directive using the context argument
      if ( context.myDirective && context.myDirective.doSomething ) {
        await doSomething()
      }

      return {
        // No need to specify previous directives here, such as content, because
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
      }
    }

    async function doSomething() {
      // do something
    }


You can use `handoff` to chain requests across as many controllers as you want, with each controller's directives added to the request context. All controllers in the chain are stored in the `route` object as an array called `route.chain`:

    [
      { controller: 'article',
        action: 'handler',
        view: 'article',
        viewContent: '<h1>My Article Title</h1><p>The article summary.</p><section>The article text.</section>'
      },
      { controller: '+_layout',
        action: 'handler',
        view: '+_layout'
      }
    ]

You can loop over this object to render all the chained views:

    {{! +_layout.hbs }}

    <!doctype html>
    <html>
      {{{include.head}}}
      <body>
        {{{include.header}}}
        <main>
          {{! Loop over each controller in the chain and incorporate its rendered view }}
          {{#each route.chain}}
            {{viewContent}}
          {{/each}}
        </main>
      </body>
    </html>



It's assumed the last controller in the chain provides the master view, so it has no `viewContent`; that's what the server sends to the client.

You can skip rendering a controller's view in the handoff chain by setting view to false:

    // article controller

    return {
      // Don't render the article controller's view as part of the chain
      view: false,
      handoff: {
        controller: 'next-controller'
      }
    }


### Default Layout

As mentioned in the config section at the beginning of this document, you can specify a default layout controller in your config so you don't have to specify it in every controller:

    {
      "citizen": {
        "layout": {
          "controller": "+_layout",
          "view":       "+_layout"
        }
      }
    }

If you use this method, there's no need to use handoff for the layout.


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

Let's say you chain the article controller with the layout controller like we did above. If you put the following cache directive in your controller action, the requested route's view will be cached and subsequent requests will skip the article and layout controllers entirely.

    return {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: true
      }
    }

Each of the following routes would generate its own cache item:

http://cleverna.me/article

http://cleverna.me/article/My-Article

http://cleverna.me/article/My-Article/page/2

Note that if you put the `cache.route` directive *anywhere* in your controller chain, the route will be cached.

The example above is shorthand for default cache settings. The `cache.route` directive can also be an object with options:

    // Cache the requested route with some additional options
    return {
      cache: {
        route: {
          // Optional. This setting lets the server respond with a 304 Not Modified
          // status if the cache content hasn't been updated since the client last
          // accessed the route. Defaults to the current time if not specified.
          lastModified: new Date().toISOString(),

          // Optional. List of valid URL parameters that protects against accidental
          // caching of malformed URLs.
          urlParams: ['article', 'page'],

          // Optional. Life of cached item in minutes. Default is 15 minutes.
          // For no expiration, set to 'application'.
          lifespan: 30,

          // Optional. Reset the cached item's expiration timer whenever the item is
          // accessed, keeping it in the cache until traffic subsides.
          resetOnAccess: true
        }
      }
    }


#### cache.controller

If a given route chain will vary across requests, you can still cache individual controllers to speed up rendering. The `controller` property tells citizen to cache the controller, while the `scope` option determines how the controller and its resulting view are cached.

    // Cache this controller using the default settings
    return {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        controller: true
      }
    }

    // Cache this controller with additional options
    return {
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
      }
    }


#### cache.route and cache.controller options


##### `lastModified` (route cache only)

This setting lets the server respond with a faster `304 Not Modified` response if the content of the route cache hasn't changed since the client last accessed it. By default, it's set to the time at which the route was cached, but you can specify a custom date in ISO format that reflects the last modification to the route's content. This way, if you restart your app or clear the cache for some reason, returning clients will still get a 304.

    return {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: {
          // Use toISOString() to format your date appropriately
          lastModified: myDate.toISOString()   // 2015-03-05T08:59:51.491Z
        }
      }
    }


##### `urlParams`

The `urlParams` property helps protect against invalid cache items (or worse: an attack meant to flood your server's resources by overloading the cache).

    return {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: {
          urlParams: ['article', 'page']
        }
      }
    }

If we used the example above in our article controller, the following URLs would be cached because the "article" and "page" URL parameters are permitted:

http://cleverna.me/article

http://cleverna.me/article/My-Article-Title

http://cleverna.me/article/My-Article-Title/page/2

The following URLs wouldn't be cached, which is a good thing because it wouldn't take long for an attacker's script to loop over a URL and flood the cache:

http://cleverna.me/article/My-Article-Title/dosattack/1

http://cleverna.me/article/My-Article-Title/dosattack/2

http://cleverna.me/article/My-Article-Title/page/2/dosattack/3

The server logs an error when invalid URL parameters are present, but continues processing without caching the result.


##### `directives` (controller cache only)

By default, any directives you specify in a cached controller aren't cached; they're implemented the first time the controller is called and then ignored after that. This is to prevent accidental storage of private data in the cache through session or cookie directives.

If you want directives to persist within the cache, include them in the `directives` property as an array:

    return {
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
    }


##### `lifespan`

This setting determines how long the route or controller should remain in the cache, in minutes.

    return {
      cache: {
        route: {
          // This route cache will expire in 10 minutes
          lifespan: 10
        }
      }
    }


##### `resetOnAccess`

Used with the `lifespan` setting, `resetOnAccess` will reset the timer of the route or controller cache whenever it's accessed, keeping it in the cache until traffic subsides.

    return {
      cache: {
        route: {
          // This route cache will expire in 10 minutes, but if a request accesses it
          // before then, the cache timer will be reset to 10 minutes from now
          lifespan: 10,
          resetOnAccess: true
        }
      }
    }


#### Cache Limitations and Warnings

As mentioned previously, if you use the handoff directive to call a series of controllers and any one of those controllers sets `cache.route` to true, the final view will be cached. Therefore, caching any controllers in that chain might be redundant. In most cases, you'll want to choose between caching an entire route or caching individual controllers, but not both.

When caching an include controller, the view directive doesn't work. Set the view within the include directive of the calling controller.

citizen's cache is a RAM cache stored in the V8 heap, so be careful with your caching strategy. Use the `lifespan` and `resetOnAccess` options so URLs that receive a lot of traffic stay in the cache, while less popular URLs naturally fall out of the cache over time.


### Caching Static Assets

By caching static assets in memory, you speed up file serving considerably. To enable static asset caching for your app's public (web) directory, set "static" to `true` in your config:

    {
      "citizen": {
        "cache": {
          "static": {
            "enable": true
          }
        }
      }
    }

With static caching enabled, all static files citizen serves will be cached in the V8 heap, so keep an eye on your app's memory usage to make sure you're not using too many resources. citizen handles all the caching and response headers (ETags, 304 status codes, etc.) for you using each file's modified date. Note that if a file changes after it's been cached, you'll need to clear the file cache using [cache.clear()](#clear-options) or restart the app.

To clear a file from the cache in a running app:

    app.cache.clear({ file: '/absolute/path/to/file.jpg' })


### Client-Side Caching

citizen automatically sets ETag headers for cached routes and static assets. You don't need to do anything to make them work. The Cache-Control header is entirely manual, however.

To set the Cache-Control header for static assets, use the `citizen.cache.control` setting in your config:

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

    function handler(params, context) {
      // Set some defaults for the login view
      params.form.username = ''
      params.form.password = ''
      params.form.remember = false
    }

    // Using a separate action in your controller for form submissions
    // is probably a good idea
    async function form(params, context) {
      let authenticate = await app.models.user.authenticate({
            username: params.form.username,
            password: params.form.password
          }),
          cookie = {}

      if ( authenticate.success ) {
        if ( params.form.remember ) {
          cookie.username: params.form.username
        }

        return {
          cookie: cookie,
          redirect: '/'
        }
      } else {
        return {
          content: {
            message: 'Login failed.'
          }
        }
      }
    }

If it's a multipart form containing a file, the form object passed to your controller will look something like this:

    {
      foo: 'bar',
      fizz: 'buzz',
      fileFieldName: {
        size: 280,
        path: '/tmp/upload_6d9c4e3121f244abdff36311a3b19a16',
        name: 'image.png',
        type: 'image/png',
        hash: null,
        lastModifiedDate: Fri Feb 27 2015 06:01:36 GMT-0500 (EST)
      }
    }

See the [formidable documentation](https://www.npmjs.com/package/formidable) for available form settings. You can pass global form settings via `citizen.form` in the config or at the controller action level via controller config (see below).

The following config sets the upload directory for all forms to the path specified. It also sets the `maxFieldsSize` setting for the editForm() action in the article controller to 500k:

    {
      "citizen": {
        "form": {
          "uploadDir":  '/absolute/path/to/upload/directory',
          "maxFieldsSize": 500
        }
      }
    }

Unlike formidable, the `maxFieldsSize` option includes images in a multipart form in its calculations. citizen includes this enhancement because formidable provides no built-in way of limiting file upload sizes.

You can also set options for individual form actions within controllers using the `config` export. These settings extend and override the global form settings.

    // login controller

    module.exports = {
      config: {
        form: {
          // Options for the loginForm() controller action
          loginForm: {
            maxFieldsSize: 1000
          }
        }
      }
    }



### AJAX form submissions

citizen makes it easy to build progressively enhanced HTML forms that work both server-side and client-side. Here's a login form that will submit to the login controller and fire the `form()` action:

    <section class="login-form">
      <p id="message">
        {{#if message}}
          {{message}}
        {{else}}
          Please log in below.
        {{/if}}
      </p>
      <form id="login-form" action="/login/action/form" method="post" novalidate>
        <section class="data">
          <ul>
            <li>
              <label for="username">Username</label>
              <input id="username" name="username" value="{{form.username}}" required autofocus>
            </li>
            <li>
              <label for="password">Password</label>
              <input id="password" name="password" value="{{form.password}}" required>
            </li>
          </ul>
        </section>
        <section class="actions">
          <input name="submit" type="submit" value="Sign in">
        </section>
      </form>
    </section>


This will perform a traditional POST to the server and reload the login page to display any messages. You can easily enhance this with a little JavaScript on the client to submit via AJAX and return a JSON response:

    var loginForm = document.querySelector('#login-form'),
        message = document.querySelector('#message')

    loginForm.addEventListener('submit', function (e) {
      var request = new XMLHttpRequest(),
          formData = new FormData(loginForm)

      e.preventDefault()

      // Appending /format/json to the form action tells the server to
      // respond with JSON instead of a rendered HTML view
      request.open(loginForm.method, loginForm.action + '/format/json', true)

      request.send(formData)

      request.onload = function() {
        var loginResponse = JSON.parse(request.responseText)

        message.innerHTML = loginResponse.message
      }
    })


By appending `/format/json` to the action URL via JavaScript, we receive a JSON response from the controller and can then parse this response and update the view on the client. This is a form that provides a good user experience, but still works without JavaScript.


## Application Event Hooks and the Context Argument

Certain events will occur throughout the life of your citizen application. You can act on these application events, execute functions, set directives, and pass the results to the next event or your controller via the `context` argument. For example, you might set a custom cookie at the beginning of every new session, or check for cookies at the beginning of every request and redirect the user to a login page if they're not authenticated.

To take advantage of these events, include a directory called "hooks" in your app with any or all of following modules and exports:

    app/
      hooks/
        application.js // exports start() and error()
        request.js     // exports start() and end()
        response.js    // exports start() and end()
        session.js     // exports start() and end()

`request.start()`, `request.end()`, and `response.start()` are called before your controller is fired, so the output from those events is passed from each one to the next, and ultimately to your controller via the `context` argument. Exactly what they output—content, citizen directives, custom directives—is up to you.

All files and exports are optional. citizen parses them at app start and only calls them if they exist. For example, you could have only a request.js module that exports `start()`.

Here's an example of a request module that checks for a username cookie at the beginning of every request and redirects the user to the login page if it doesn't exist. We also avoid a redirect loop by making sure the requested controller isn't the login controller:

    // app/hooks/request.js

    module.exports = {
      start: start
    }

    function start(params, context) {
      let redirect = {}

      if ( !params.cookie.username && params.route.controller !== 'login' ) {
        redirect = '/login'
      }

      return {
        redirect: redirect
      }
    }

`session.end` is slightly different in terms of the arguments in receives, which consist of a copy of the expired session (no longer active) and any context passed from citizen:

    // app/hooks/session.js

    module.exports = {
      end: end
    }

    function end(expiredSession, context) {
      // do something whenever a session ends
    }



## Cross-Origin Resource Sharing (CORS)

By default, all controllers respond to requests from the host only. citizen supports cross-domain HTTP requests via access control headers.

To enable cross-domain access for individual controller actions, add a `cors` object with the necessary headers to your controller's exports:

    module.exports = {
      handler: handler,
      cors: {
        // Each controller action has its own CORS headers
        handler: {
          'Access-Control-Allow-Origin': 'http://www.foreignhost.com',
          'Access-Control-Expose-Headers': 'X-My-Custom-Header, X-Another-Custom-Header',
          'Access-Control-Max-Age': 600,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'OPTIONS, PUT',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Vary': 'Origin'
        }
      }
    }

Why not just use the [HTTP Headers](#http-headers) directive within the controller action itself? When citizen receives a request from an origin other than the host, it checks for the `cors` export in your controller to provide a preflight response without you having to write your own logic within the controller action.

For more details on CORS, check out [the W3C spec](http://www.w3.org/TR/cors/) and [the Mozilla Developer Network](https://developer.mozilla.org/en-US/docs/HTTP/Access_control_CORS).



### Proxy Header

If you use citizen behind a proxy, such as NGINX or Apache, make sure you have `X-Forwarded-Host` and `X-Forwarded-Proto` headers in your server configuration so citizen handles CORS requests correctly. Different protocols (HTTPS on your load balancer and HTTP in your citizen app) will cause CORS requests to fail without these headers.

Here's an example of how you might set this up in NGINX:

    location / {
      proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Host   $host;
      proxy_set_header X-Forwarded-Proto  $scheme;
      proxy_pass                          http://127.0.0.1:8080;
    }


## Helpers

citizen has helper functions that it uses internally, but might be of use to you, so it returns them for public use.


### cache.set(options)

You can store any object in citizen's cache. The primary benefits of using cache() over storing content in your own global app variables are built-in cache expiration and extension, as well as wrappers for reading, parsing, and storing file content.

citizen's default cache time is 15 minutes, which you can change in the config (see [Configuration](#configuration)). Cached item lifespans are extended whenever they are accessed unless you pass `resetOnAccess: false` or change that setting in the config.

    // Cache a string in the default app scope for 15 minutes (default). Keys
    // must be unique within a given scope.
    app.cache.set({
      key: 'welcome-message',
      value: 'Welcome to my site.'
    })

    // Cache a string under a custom scope, which is used for retrieving or clearing
    // multiple cache items at once. Keys must be unique within a given scope.
    // Reserved scope names are "app", "controllers", "routes", and "files".
    app.cache.set({
      key: 'welcome-message',
      scope: 'site-messages',
      value: 'Welcome to our site.'
    })

    // Cache a string for the life of the application.
    app.cache.set({
      key: 'welcome-message',
      value: 'Welcome to my site.',
      lifespan: 'application'
    })

    // Cache a string for the life of the application, and overwrite the
    // existing key. The overwrite property is required any time you want to
    // write to an existing key. This prevents accidental overwrites.
    app.cache.set({
      key: 'welcome-message',
      value: 'Welcome to our site.',
      lifespan: 'application',
      overwrite: true
    })

    // Cache a file buffer using the file path as the key. This is a wrapper for
    // fs.readFile and fs.readFileSync paired with citizen's cache function.
    // Optionally, tell citizen to perform a synchronous file read operation and
    // use an encoding different from the default (UTF-8).
    app.cache.set({
      file: '/path/to/articles.txt',
      synchronous: true,
      encoding: 'CP-1252'
    })

    // Cache a file with a custom key. Optionally, parse the JSON and store the
    // parsed object in the cache instead of the raw buffer. Expire the cache
    // after 10 minutes, regardless of whether the cache is accessed or not.
    app.cache.set({
      file: '/path/to/articles.json',
      key: 'articles',
      parseJSON: true,
      lifespan: 10,
      resetOnAccess: false
    })

`app`, `controllers`, `routes`, and `files` are reserved scope names, so you can't use them for your own custom scopes.


### cache.exists(options)

This is a way to check for the existence of a given key or scope in the cache without resetting the cache timer on that item. Returns `false` if a match isn't found.

    // Check for the existence of the specified key
    var keyExists = app.cache.exists({ key: 'welcome-message' })          // keyExists is true
    var keyExists = app.cache.exists({ file: '/path/to/articles.txt' })   // keyExists is true
    var keyExists = app.cache.exists({ file: 'articles' })                // keyExists is true
    var keyExists = app.cache.exists({ key: 'foo' })                      // keyExists is false

    // Check the specified scope for the specified key
    var keyExists = app.cache.exists({
      scope: 'site-messages',
      key: 'welcome-message'
    })
    // keyExists is true

    // Check if the specified scope exists and contains items
    var scopeExists = app.cache.exists({
      scope: 'site-messages'
    })
    // scopeExists is true

    // Check if the controller cache has any instances of the specified controller
    var controllerExists = app.cache.exists({
      controller: 'article'
    })

    // Check if the controller cache has any instances of the specified controller
    // and action
    var controllerExists = app.cache.exists({
      controller: 'article',
      action: 'edit'
    })

    // Check if the controller cache has any instances of the specified controller,
    // action, and view
    var controllerExists = app.cache.exists({
      controller: 'article',
      action: 'edit',
      view: 'edit'
    })

    // Check if the controller cache has an instance of the specified controller,
    // action, and view for a given route
    var controllerExists = app.cache.exists({
      controller: 'article',
      action: 'edit',
      view: 'edit',
      route: '/article/My-Article/page/2'
    })


### cache.get(options)

Retrieve an individual key or an entire scope. Returns `false` if the requested item doesn't exist. If `resetOnAccess` was true when the item was cached, using retrieve() will reset the cache clock and extend the life of the cached item. If a scope is retrieved, all items in that scope will have their cache timers reset.

Optionally, you can override the `resetOnAccess` attribute when retrieving a cache item by specifying it inline.

    // Retrieve the specified key from the default (app) scope
    var welcomeMessage = app.cache.get({
      key: 'welcome-message'
    })

    // Retrieve the specified key from the specified scope and reset its cache timer
    // even if resetOnAccess was initially set to false when it was stored
    var welcomeMessage = app.cache.get({
      scope: 'site-messages',
      key: 'welcome-message',
      resetOnAccess: true
    })

    // Retrieve all keys from the specified scope
    var siteMessages = app.cache.get({
      scope: 'site-messages'
    })

    // Retrieve a cached file
    var articles = app.cache.get({
      file: '/path/to/articles.txt'
    })

    // Retrieve a cached file with its custom key
    var articles = app.cache.get({
      file: 'articles'
    })


### cache.clear(options)

Clear a cache object using a key or a scope.

    // Store some cache items

    app.cache.set({
      key: 'welcome-message',
      scope: 'site-messages',
      value: 'Welcome to our site.'
    })

    app.cache.set({
      key: 'goodbye-message',
      scope: 'site-messages',
      value: 'Thanks for visiting!'
    })

    app.cache.set({
      file: '/path/to/articles.txt',
      synchronous: true
    })

    // Clear the welcome message from its custom scope cache
    app.cache.clear({ scope: 'site-messages', key: 'welcome-message' })

    // Clear all messages from the cache using their custom scope
    app.cache.clear({ scope: 'site-messages' })

    // Clear the articles cache from the file scope
    app.cache.clear({ file: '/path/to/articles.txt' })


`clear()` can also be used to remove cached routes and controllers from their respective caches.

    // Clear the specified route from the cache
    app.cache.clear({
      route: '/article/My-Article/page/2/action/edit'
    })

    // Clear the specified controller from the cache, including all actions and views
    app.cache.clear({
      controller: 'article'
    })

    // Clear the specified controller/action pairing from the cache. All cached views
    // related to this pairing will be deleted.
    app.cache.clear({
      controller: 'article',
      action: 'edit'
    })

    // Clear the specified controller/action/view combination from the cache
    app.cache.clear({
      controller: 'article',
      action: 'edit',
      view: 'edit'
    })

    // Clear the specified controller/action/view/route combination from the cache
    app.cache.clear({
      controller: 'article',
      action: 'edit',
      view: 'edit',
      route: '/article/My-Article/page/2/action/edit'
    })

    // Clear the entire controller scope
    app.cache.clear({ scope: 'controllers' })

    // Clear the entire route scope
    app.cache.clear({ scope: 'routes' })

    // Clear the entire file scope
    app.cache.clear({ scope: 'files' })

    // Clear the entire app scope
    app.cache.clear({ scope: 'app' })


### log(options)

Makes it easy to log comments to either the console or a file (or both) in a way that's dependent on the mode of the framework.

When citizen is in production mode, log() does nothing by default. In development mode, log() will log whatever you pass to it. This means you can place it throughout your application's code and it will only write to the log in development mode. You can override this behavior globally with the log settings in your config file or inline with the `console` or `file` options when calling log().

    app.log({
      // Optional. Valid settings are "status" (default) or "error".
      type: 'error',

      // Optional string. Applies a label to your log item.
      label: 'Log output',

      // The content of your log. If it's anything other than a string or
      // number, log() will run util.inspect on it and dump the contents.
      contents: someObject,

      // Optional. By default, log() uses the config.citizen.log.console setting
      // to determine whether to log to the console, but this option overrides it.
      console: false,

      // Optional. By default, log() uses the config.citizen.log.file setting
      // to determine whether to log to a file, but this option overrides it.
      file: false,

      // Optional. By default, log() uses "citizen.log" as the file name for your logs.
      // Use this option to override the default inline.
      file: 'my-log-file.log',

      // Optional. Disables the timestamp that normally appears in front of the log
      timestamp: false
    })

Log files appear in the folder you specify in `config.citizen.directories.logs`.


## Debugging

**Warning: `development` mode is inherently insecure. Don't use it in a production environment.**

If you set `"mode": "development"` in your config file, citizen dumps the current pattern's context and request parameters to the console. You can dump it to the view instead by setting `development.debug.view` in your config file to `true`, or use the `ctzn_dump` URL parameter on a per-request basis:

    // config file: always dumps debug output in the view
    {
      "citizen": {
        "development": {
          "debug": {
            "view": true
          }
        }
      }
    }


By default, the pattern's complete context is dumped. You can specify the exact object to debug with the `ctzn_debug` URL parameter:

    // Dumps the server params object
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params

    // Dumps the user's session scope
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session

    // Dumps the user's session scope to the view
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session/ctzn_dump/view


The debug output traverses objects 3 levels deep by default. To display deeper output, use the `development.debug.depth` setting in your config file or append `ctzn_debugDepth` to the URL. Debug rendering will take longer the deeper you go.

    // config file: debug 4 levels deep
    {
      "citizen": {
        "development": {
          "debug": {
            "depth": 4
          }
        }
      }
    }

    // URL
    http://www.cleverna.me/article/id/237/page/2/ctzn_debugDepth/4


In `development` mode, you must specify the `ctzn_debug` URL parameter to display debug output. Debug output is disabled in production mode.


## Utilities

The util directory within the citizen package has some helpful utilities.

### scaffold

#### skeleton

Creates a complete skeleton of a citizen app with a functional index pattern and error templates.

    $ node node_modules/citizen/util/scaffold skeleton

Resulting file structure:

    app/
      config/
        citizen.json
      logs/
      hooks/
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
            404.hbs
            500.hbs
            ENOENT.hbs
            error.hbs
          index/
            index.hbs
      start.js
    web/

Run `node node_modules/citizen/util/scaffold skeleton -h` for options.


#### pattern

Creates a complete citizen MVC pattern. The pattern command takes a pattern name and options:

    $ node node_modules/citizen/util/scaffold pattern [options] [pattern]

For example, `node scaffold pattern article` will create the following pattern:

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

Copyright (c) 2014-2019 [Jay Sylvester](http://jaysylvester.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
