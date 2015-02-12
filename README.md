# citizen

citizen is an event-driven MVC framework for Node.js web applications. It's for people who are more interested in quickly building fast, scalable apps than digging around Node's guts or building a tower of cards made out of 20 different packages.

Favoring convention over configuration, citizen's purpose is to handle server-side routing, view rendering, file serving, and caching, while providing some useful helpers to get you on your way. It takes the pain out of building a Node web app, but doesn't stop you from using native Node methods.

Future plans include tight integration with client-side rendering through a custom JS library that shares MVC patterns between the client and server, but this will be optional.

citizen is in beta. Your comments, criticisms, and (pull) requests are appreciated. Please see [Github](https://github.com/jaysylvester/citizen) for the complete readme. npmjs.com truncates it.


## Benefits

- Very high performance (even without caching)
- Zero-configuration dynamic routing with SEO-friendly URLs
- Optional in-memory caching of entire routes, individual controllers, and objects
- Directives that make it easy to set cookies, sessions, redirects, caches, and more
- Serve HTML, JSON, or JSONP from the same controller/view with a single URL flag
- Easily chain controllers or include controllers within other controllers
- Do it all on the server or roll in your favorite client-side templating engine
- Support for Jade and Handlebars templates with more on the way


## Quick Start

These commands will create a new directory for your web app, install citizen, use its scaffolding CLI to create the app's skeleton, and start citizen with the web server listening on port 8080 (you can change the port to whatever you want):

    $ mkdir mywebapp
    $ cd mywebapp
    $ npm install citizen
    $ node node_modules/citizen/util/scaffold skeleton -n 8080
    $ cd app
    $ node start.js

If everything went well, you'll see confirmation in the console that citizen is listening on the specified port. Go to http://127.0.0.1:8080 in your browser and you'll see a bare index template.

For configuration options, see [Configuration](#configuration). For more utilities, see [Utilities](#utilities).



### App Directory Structure

    app/
      config/               // Optional configs for different environments
        local.json
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
        views/
          index/
            index.jade      // You can use Jade (.jade), Handlebars (.hbs), or HTML files
            index-alt.jade  // Optional alternate view
      start.js
    web/                    // public static assets



### Configuration

citizen follows convention over configuration, but some things are best handled by a config file.

The `config` directory is optional and contains configuration files that drive both citizen and your app in JSON format. You can have multiple citizen configuration files within this directory, allowing different configurations based on environment. citizen retrieves its configuration file from this directory based on the following logic:

1. citizen parses each JSON file looking for a `hostname` key that matches the machine's hostname. If it finds one, it loads that configuration.
2. If it can't find a matching hostname key, it looks for a file named citizen.json and loads that configuration.
3. If it can't find citizen.json or you don't have a `config` directory, it runs under its default configuration.

The following represents citizen's default configuration, which is extended by your configuration file:

    {
      "hostname":             "",
      "citizen": {
        "mode":               "production",
        "httpPort":           80,
        "hostname":           "127.0.0.1",
        "connectionQueue":    undefined,
        "sessions":           false,
        "sessionTimeout":     1200000,
        "requestTimeout":     30000,
        "prettyHTML":         true,
        "log": {
          "toConsole":        false,
          "toFile":           false,
          "defaultFile":      "citizen.txt"
        },
        "debug": {
          "output":           "view",
          "depth":            2,
          "disableCache":     true,
          "jade":             false
        },
        "urlPaths": {
          "app":              "",
          "404":              "404.html",
          "50x":              "50x.html"
        }
      }
    }

These settings are exposed publicly via `app.config.hostname` and `app.config.citizen`.

**Note:** This documentation assumes your global app variable name is "app", but you can call it whatever you want. Adjust accordingly.

Let's say you want to run an app on port 8080 in your local dev environment and you have a local database your app will connect to. You could create a config file called local.json (or myconfig.json, whatever you want) with the following:

    {
      "hostname":             "My-MacBook-Pro.local",
      "citizen": {
        "mode":               "development",
        "httpPort":           8080
      },
      "db": {
        "server":             "localhost",
        "username":           "dbuser",
        "password":           "dbpassword"
      }
    }

This config would extend the default configuration only when running on your local machine; you'll never accidentally push a test config to production again ;)

The database settings would be accessible within your app via `app.config.db`. **The citizen and hostname nodes are reserved for the framework.** Create your own node(s) to store your custom settings.

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
      <code>hostname</code>
    </td>
    <td>
      <p>
        The operating system's hostname
      </p>
    </td>
    <td>
      To load different config files in different environments, citizen relies upon the server's hostname as a key. At startup, if citizen finds a config file with a <code>hostname</code> key that matches the server's hostname, it chooses that config file. This is different from the HTTP hostname setting under the <code>citizen</code> node (see below).
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
      <code>httpPort</code>
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
      The port number on which citizen's web server should listen for requests.
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
      The hostname at which your app can be accessed via HTTP. You need to configure your server's DNS settings to support this setting. Don't confuse this with the host machine's <code>hostname</code> setting above, which is different.
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
        Default: <code>1200000</code>
      </p>
    </td>
    <td>
      If sessions are enabled, this number represents the length of a user's session in milliseconds. Sessions automatically expire once this time limit is reached.
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
        Default: <code>30000</code>
      </p>
    </td>
    <td>
      Determines how long the server will wait for a response from your controllers before timing out, in milliseconds.
    </td>
  </tr>
  <tr>
    <td>
      <code>prettyHTML</code>
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
      By default, rendered HTML sourced from Jade templates includes the original whitespace and line breaks. Change this setting to <code>false</code> to remove whitespace and minimize file size.
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
        Default: <code>view</code>
      </p>
    </td>
    <td>
      In debug mode, citizen dumps debug info to the view so you can see it in your browser. Change this setting to dump to the console instead.
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
      <code>jade</code>
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
      Jade's template debugging is quite verbose, so it's disabled by default, but you can enable it with this setting if citizen is failing to start due to template parsing errors and you need additional info.
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
        Default: empty
      </p>
    </td>
    <td>
      Denotes the URL path leading to your app. If you want your app to be located at http://yoursite.com/my/app, this setting should be <code>/my/app</code> (don't forget the leading slash). This setting is required for the router to work.
    </td>
  </tr>
  <tr>
    <td>
      <code>404</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>/404.html</code>
      </p>
    </td>
    <td>
      The path pointing to a 404 error handler. By default, it's a static file in your app's web directory. If you want to write an error handling pattern, you can do that and change this to <code>/error</code> or whatever you want.
    </td>
  </tr>
  <tr>
    <td>
      <code>50x</code>
    </td>
    <td>
      <p>
        String
      </p>
      <p>
        Default: <code>/50x.html</code>
      </p>
    </td>
    <td>
      The path pointing to a 50x error handler. By default, it's a static file in your app's web directory. If you want to write an error handling pattern, you can do that and change this to <code>/error</code> or whatever you want.
    </td>
  </tr>
</table>



### Initializing citizen and starting the web server

The start.js file in your app directory can be as simple as this:

    // start.js

    global.app = require('citizen');

    app.start();

Run start.js from the command line:

    $ node start.js


<table>
  <caption>Objects created by citizen</caption>
  <tr>
    <td>
      <code>app.start()</code>
    </td>
    <td>
      Starts the web server
    </td>
  </tr>
  <tr>
    <td>
      <code>app.cache()</code><br />
      <code>app.exists()</code><br />
      <code>app.retrieve()</code><br />
      <code>app.clear()</code><br />
      <code>app.listen()</code><br />
      <code>app.copy()</code><br />
      <code>app.extend()</code><br />
      <code>app.isNumeric()</code><br />
      <code>app.size()</code>
      <code>app.log()</code><br />
      <code>app.dashes()</code><br />
    </td>
    <td>
      <a href="#helpers">Helpers</a> used internally by citizen, exposed publicly since you might find them useful
    </td>
  </tr>
  <tr>
    <td>
      <code>app.models</code>
    </td>
    <td>
      Contains models from your supplied patterns, which you can use instead of <code>require</code>. Controllers and views aren't exposed this way because you don't need to access them directly.
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
      <code>app.jade</code>
    </td>
    <td>
      A pointer to the citizen Jade global
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

    http://www.site.com/controller/content-description/param/val/param2/val2

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
            article.jade  // Matches the controller name, making it the default view
            edit.jade     // Secondary view for editing an article

At least one controller is required for a given URL, and a controller's default view directory and default view file must share its name. Additional views should reside in this same directory. More on views in the [Views section](#views).

Models and views are optional and don't necessarily need to be associated with a particular controller. If your controller doesn't need a model, you don't need to create one. If your controller is going to pass its output to another controller for further processing and final rendering, you don't need to include a matching view. (See the [controller handoff directive](#controller-handoff).)



### Controllers

Each controller requires at least one public function. The default action is named `handler()`, which is called by citizen when no action is specified in the URL.

    // article controller

    module.exports = {
      handler: handler
    };

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
      page: 2
    }

The controller name becomes a property in the URL scope that contains the descriptor, which makes it well-suited for use as a unique identifier. This content is also available in the `route` object as `route.descriptor`.

The `context` argument contains any output that's been generated by the request up to this point. There are various events that can populate this argument with content and directives, which are then passed to your controller so you can access that content or see what directives have been set by previous events.

The `emitter` argument is the method by which the controller lets the server know that it's done with its tasks and ready to render the result. The emitter should emit a "ready" event when the controller has accomplished its task. This lets the server know it's okay to proceed. As part of this event, the emitter should include any view content and [directives](#emitter-directives) for the server.

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
        content: {
          article: article
        }
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
        content: {
          article: article
        }
      });
    };

    function edit(params, context, emitter) {
      // Get the article content
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      // Use the /patterns/views/article/edit.jade view for this action (more on
      // alternate views in later sections).
      emitter.emit('ready', {
        content: {
          article: article
        },
        view: 'edit'
      });
    };

The second argument in `emitter.emit` is an object containing any data you want to pass back to citizen. All the content you want to render in your view should be passed to citizen within an object called `content`, as shown above. Additional objects can be passed to citizen to set directives that provide instructions to the server (explained later in the [Emitter Directives](#emitter-directives) section). You can even add your own objects to the request context and pass them from controller to controller (more in the [Controller Handoff section](#controller-handoff).)

#### Private controllers

To make a controller private—inaccessible via HTTP, but accessible within your app—add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          +_header.js  // Partial, only accessible internally
          _head.js     // Partial, accessible via www.cleverna.me/_head
          article.js   // Accessible via www.cleverna.me/article



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

citizen supports [Jade](https://www.npmjs.org/package/jade) and [Handlebars](https://npmjs.org/package/handlebars) templates, as well as good old HTML. You can even mix and match Jade, Handlebars, and HTML templates as you see fit; just use the appropriate file extensions (.jade, .hbs, or .html) and citizen will compile and render each view with the appropriate engine.

You have direct access to each engine's methods via `app.handlebars` and `app.jade`, allowing you to use methods like `app.handlebars.registerHelper()` to create global helpers. Keep in mind that you're extending the global Handlebars and Jade objects, potentially affecting citizen's view rendering if you do anything wacky because citizen relies on these same objects.

In `article.jade`, you can reference objects you placed within the `content` object passed by the emitter. citizen also injects the `params` object into your view context automatically, so you have access to those objects as local variables (such as the `url` scope):

    // article.jade

    doctype html
    html
      body
        main
          h1 #{article.title} - Page #{url.page}
          p#summary #{article.summary}
          #text #{article.text}

citizen sends HTML to the client by default, but you can also return JSON and JSONP with no extra work on your part.

#### JSON

You don't need a custom view just for JSON. You can tell a controller to return its content as plain text JSON by adding the `format` URL parameter.

    http://www.cleverna.me/article/My-Clever-Article-Title/page/2/format/json

Returns...

    {
      "article": {
        "My-Clever-Article-Title": {
          "title": "My Clever Article Title",
          "summary": "Am I not terribly clever?",
          "text": "Second page content"
        }
      }
    }

Whatever you've added to the controller's emitter `content` object will be returned. (The line breaks are just for readability. The actual output is compressed.)

#### JSONP

JSONP is pretty much the same. Use `format` and `callback` in the URL:

    http://www.cleverna.me/article/My-Clever-Article-Title/format/jsonp/callback/foo

Returns:

    foo({
      "article": {
        "My-Clever-Article-Title": {
          "title": "My Clever Article Title",
          "summary": "Am I not terribly clever?",
          "text": "Second page content"
        }
      }
    });

If you want to make a controller available to third party sites, see the [CORS section](#cross-origin-resource-sharing-cors).

### Rendering alternate views

By default, the server renders the view whose name matches that of the controller. To render a different view, [use the `view` directive in your emitter](#alternate-views).



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
        content: {
          article: article
        },
        // This tells the server to render app/patterns/views/article/edit.jade
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
      // [time in milliseconds] - added to current time for a specific expiration date
      expires: 'session',
      path: '/',
      httpOnly: true,
      secure: false
    }

The following sample login controller tells the server to set `username` and `passwordHash` cookies that never expire:

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
            expires: 'never'
          },
          passwordHash: {
            value: authenticate.passwordHash,
            expires: 'never'
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

By default, a session has four properties: `id`, `started`, `expires`, and `timer`. The session ID is also sent to the client as a cookie called `ctznSessionID`.

Setting session variables is pretty much the same as setting cookie variables:

    emitter.emit('ready', {
      session: {
        username: 'Danny',
        nickname: 'Doc'
      }
    });

Sessions expire based on the `sessionTimeout` config property, which represents the length of a session in milliseconds. The default is 1200000 (20 minutes). The `timer` is reset with each request from the user. When the `timer` runs out, the session is deleted. Any client requests after that time will generate a new session ID and send a new session ID cookie to the client. Remember that the browser's session is separate from the server's session, so any cookies you've set with an expiration of `session` are untouched if the user's session expires on the server. You need to clear those cookies manually at the start of the next server session if you don't want them hanging around.

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

The `redirect` object takes three properties: `statusCode`, `url`, and `refresh`. If you don't provide a status code, citizen uses 302 (temporary redirect). The `refresh` option determines whether the redirect uses a [Location header](http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.30) or the non-standard [Refresh header](https://en.wikipedia.org/wiki/List_of_HTTP_header_fields#Refresh).

    // Initiate a temporary redirect using the Location header
    emitter.emit('ready', {
      redirect: {
        url: 'http://cleverna.me/login'
      }
    });

    // Initiate a permanent redirect using the Refresh header, delaying the redirect
    // by 5 seconds
    emitter.emit('ready', {
      redirect: {
        statusCode: 301,
        url: 'http://cleverna.me/new-url',
        refresh: 5
      }
    });

Unlike the Location header, if you use the `refresh` option, citizen will send a rendered view to the client because the redirect occurs client-side.

Using the Location header breaks (in my opinion) the Referer header because the Referer ends up being not the resource that initiated the redirect, but the resource prior to the page that initiated it. To get around this problem, citizen stores a session variable called `ctznReferer` that contains the URL of the resource that initiated the redirect, which you can use to redirect users properly. For example, if an unauthenticated user attempts to access a secure page and you redirect them to a login form, the address of the secure page will be stored in `ctznReferer` so you can send them there instead of the page containing the link to the secure page.

If you haven't enabled sessions, citizen falls back to creating a cookie named `ctznReferer` instead.



### Include Patterns

citizen lets you use complete MVC patterns as includes. These includes are more than just chunks of code that you can reuse because each has its own controller, model, and view(s).

Let's say our article pattern's Jade template has the following contents. The head section contains dynamic meta data, and the header nav's content changes depending on whether the user is logged in or not:

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
          h1 #{article.title} - Page #{url.page}
          p#summary #{article.summary}
          #text #{article.text}

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
            _head.jade
          _header/
            _header.jade
            _header-authenticated.jade // A different header for logged in users
          article/
            article.jade

When the article controller is fired, it has to tell citizen which includes it needs. We do that with the `include` directive, which we pass via the context in the emitter:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var article = app.models.article.getArticle(params.url.article, params.url.page);

      emitter.emit('ready', {
        content: {
          article: article
        },
        include: {
          _head: {
            // If only the controller is specified, the default action handler() is
            // called and the default view is rendered (_head.jade in this case).
            controller: '_head'
          },
          _header: {
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

    // _header view (/patterns/views/_header/_header.jade)

    header
      a#logo Home page
      nav
        ul
          li
            a(href="/") Home
          li
            a(href="/articles") Articles



    // _header-authenticated view  (/patterns/views/_header/_header-authenticated.jade)

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


The rendered includes are stored in the `include` scope. The `include` object contains rendered HTML views, so you need to skip escaping (`!=` in Jade, `{{{...}}}` in Handlebars):

    doctype html
    html
      != include._head
      body
        != include._header
        main
          h1 #{article.title} - Page #{url.page}
          p#summary #{article.summary}
          #text #{article.text}

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

Here's an example of the `_head` controller written as both an include and a handler of direct requests:

    // _head controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var metaData = {},
          // If the article URL param exists, use that. Otherwise, assume _head is
          // being used as an include and use the requested route.
          getMetaDataFor = params.url.article || params.route.controller;

      if ( app.models[getMetaDataFor] && app.models[getMetaDataFor].getMetaData ) {
        metaData = app.models[getMetaDataFor].getMetaData();
      }

      emitter.emit('ready', {
        content: {
          metaData: metaData
        }
      });
    }

Of course, if you don't write the controller in a manner to accept direct requests and return content, it'll return nothing (or throw an error). When accessed via HTTP, the controller has access to all emitter directives.

**Reminder:** To make a controller private—inaccessible via HTTP, but accessible within your app—add a plus sign (`+`) to the beginning of the file name:

    app/
      patterns/
        controllers/
          +_header.js  // Only accessible internally
          _head.js     // Accessible via www.cleverna.me/_head
          article.js   // Accessible via www.cleverna.me/article

#### Should I use a citizen include or a Jade include/Handlebars partial?

citizen includes provide rich functionality, but they do have limitations and can be overkill in certain situations.

* **Do you only need to share a chunk of markup across different views?** Use a standard Handlebars partial, Jade template, or HTML document. The syntax is easy and you don't have to create a full MVC pattern like you would with a citizen include.
* **Do you need to loop over a chunk of markup to render a data set?** The server processes citizen includes and returns them as fully-rendered HTML (or JSON), not compiled templates. You can't loop over them and inject data like you can with Handlebars partials or Jade includes.
* **Do you need the ability to render different includes based on logic?** citizen includes can have multiple views because they're full MVC patterns. Using a citizen include, you can call different actions and views based on logic and keep that logic in the controller where it belongs. Using Handlebars partials or Jade includes would require registering multiple partials and putting the logic in the view template.
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
        content: {
          article: article
        },
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


The view of the originally requested controller (article.jade in this case) is rendered and stored in the `route.chain` object:

    // article.jade, which is stored in the route.chain scope

    h1 #{article.title}
    p#summary #{article.summary}
    #text #{article.text}


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
          _head: {
            controller: '_head'
          },
          _header: {
            controller: '_header',
            action: params.cookie.username ? 'authenticated' : 'handler'
          }
        }
      });
    }

    function doSomething() {
      // do something
    }


You can use `handoff` to chain requests across as many controllers as you want, with each controller's directives added to the request context. All controllers in the chain are stored in the `route` object as an array called `route.chain`:

    [
      { controller: 'article',
        action: 'handler',
        view: 'articles',
        viewContent: '<h1>My Article Title</h1><p id="summary">The article summary.</p><div id="text">The article text.</div>'
      },
      { controller: '+_layout',
        action: 'handler',
        view: '+_layout'
      }
    ]

You can loop over this object to render all the chained views:

    // +_layout.jade

    doctype html
    html
      != include._head
      body
        != include._header
        main
          // Loop over each controller in the chain and incorporate its rendered view
          each controller in route.chain
            if controller.viewContent
              | <!-- controller: #{controller.controller}, action: #{controller.action}, view: #{controller.view} -->
              != controller.viewContent


It's assumed the last controller in the chain provides the master view, so it has no `viewContent`; that's what the server sends to the client.


### Caching Routes and Controllers

In many cases, a requested route or controller will generate the same view every time based on the same input parameters, so it doesn't make sense to run the controller and render the view from scratch for each request. citizen provides flexible caching capabilities to speed up your server side rendering via the `cache` directive. Caching works in both typical controllers and include controllers.

Here's an example `cache` directive (more details after the code sample):

    emitter.emit('ready', {
      cache: {
        // Cache the final rendered view for this route (URL)
        route: true,

        // Cache just this controller
        controller: true,

        // Optional. If caching the controller, 'global' (default) will cache one
        // instance of the controller and use it globally, while 'route' will cache a
        // unique instance of the controller for every route that calls it.
        scope: 'route',

        // Optional. List of valid URL parameters that protects against accidental
        // caching of malformed URLs.
        urlParams: ['article', 'page'],

        // Optional. List of directives to cache with the controller.
        directives: ['handoff', 'cookie'],

        // Optional. Life of cached item in milliseconds. Default is the life of the
        // application (no expiration).
        lifespan: 600000,

        // Reset the cached item's expiration timer whenever the item is accessed,
        // keeping it in the cache until traffic subsides.
        resetOnAccess: true
    });

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

Note that if you put the `route` cache directive *anywhere* in your controller chain, the route will be cached.

Also note that you can't cache directives in a route cache. Only controller caches can store directives.


#### cache.controller and cache.scope

If a given route will have variations, you can still cache individual controllers to speed up rendering. The `controller` property tells citizen to cache the controller, while the `scope` property determines how the controller and its resulting view are cached.

    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        controller: true,
        scope: 'route'
      }
    });

<table>
  <caption>Values for <code>cache.scope</code></caption>
  <tr>
    <td>
      route
    </td>
    <td>
      <p>
        Setting cache scope to "route" caches an instance of the controller, action, and view for every unique route that calls the controller. If the following URLs are requested and the article controller's cache scope is set to "route", each URL will get its own unique cached instance of the article controller:
      </p>
      <ul>
        <li>
          <code>http://cleverna.me/article/My-Article</code>
        </li>
        <li>
          <code>http://cleverna.me/article/My-Clever-Article/page/2</code>
        </li>
        <li>
          <code>http://cleverna.me/article/Another-Article/action/edit</code>
        </li>
      </ul>
      <p>
         Use this scope if you're chaining multiple controllers and you want to cache each of those controllers, but not cache the final rendered view (like the previous layout controller example).
      </p>
    </td>
  </tr>
  <tr>
    <td>
      global
    </td>
    <td>
      A cache scope of "global" caches a single instance of a given controller and uses it everywhere, regardless of context or the requested route. If you have a controller whose output and rendering won't change across requests regardless of the context or route, "global" is a good option. It's perfect for caching citizen includes.
    </td>
  </tr>
</table>


#### cache.urlParams

The `urlParams` property helps protect against invalid cache items (or worse: an attack meant to flood your server's resources by overloading the cache).

    emitter.emit('ready', {
      handoff: {
        controller: '+_layout'
      },
      cache: {
        route: true,
        urlParams: ['article', 'page']
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

The server will throw an error when an invalid URL is requested with a cache directive. Additionally, any URL that results in an error won't be cached, whether it's valid or not.


#### cache.directives

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
        scope: 'route',

        // Cache handoff and myCustomDirective so that if this controller is
        // called from the cache, it hands off to the layout controller and acts
        // upon myCustomDirective every time. The cookie directive will only be
        // acted upon the first time the controller is called, however.
        directives: ['handoff', 'myCustomDirective']
      }
    });


#### Cache Limitations and Warnings

Controllers that use the `include` directive can't use global or route cache scopes due to the way citizen renders includes, but it's on the roadmap for a future release. In the meantime, you can get around it by using the cache directive within the included controllers. The `cache.route` property works fine.

As mentioned previously, if you use the handoff directive to call a series of controllers and any one of those controllers sets `cache.route` to true, the final view will be cached. Therefore, caching any controllers in that chain would be redundant. In most cases, you'll want to choose between caching an entire route or caching individual controllers, but not both.

citizen's cache is a RAM cache, so be careful with your caching strategy. You could very quickly find yourself out of memory. Use the lifespan option so URLs that aren't receiving a ton of traffic naturally fall out of the cache and free up resources for frequently accessed pages.

Cache defensively. Place logic in your controllers that combines the urlParams validation with some simple checks so invalid URLs don't result in junk pages clogging your cache:

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      var article = app.model.article.getArticle(params.url.article, params.url.page);

      // If the article exists, cache the result. citizen will compare the
      // existing URL parameters against the urlParams list you provide. If
      // there's a mismatch, citizen won't cache the result.
      if ( article.title ) {
        emitter.emit('ready', {
          content: {
            article: article
          },
          cache: {
            scope: 'route',
            urlParams: ['article', 'page']
          }
        });
      // Throw a 404 if the article doesn't exist. Nothing will be cached.
      } else {
        throw {
          statusCode: 404
        };
      }

    }


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
        redirect.url = '/login';
      }

      emitter.emit('ready', {
        redirect: redirect
      });
    };



## Cross-Origin Resource Sharing (CORS)

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


### cache(options)

You can store any object in citizen's cache. The primary benefits of using cache() over storing content in your own global app variables are  built-in timeout functionality and wrappers for reading, parsing, and storing file content.

    // Cache a string in the default app scope for the life of the application. Keys
    // must be unique within a given scope.
    app.cache({
      key: 'welcome message',
      value: 'Welcome to my site.'
    });

    // Cache a string for the life of the application, and overwrite the
    // existing key. The overwrite property is required any time you want to
    // write to an existing key. This prevents accidental overwrites.
    app.cache({
      key: 'welcome message',
      value: 'Welcome to our site.',
      overwrite: true
    });

    // Cache a string under a custom scope, which is used for retrieving or clearing
    // multiple cache items at once. Keys must be unique within a given scope.
    // Reserved scope names are "app", "controllers", and "routes".
    app.cache({
      key: 'welcome message',
      scope: 'site messages',
      value: 'Welcome to our site.'
    });

    // Cache a file buffer using the file path as the key. This is a wrapper for
    // fs.readFile and fs.readFileSync paired with citizen's cache function.
    // Optionally, tell citizen to perform a synchronous file read operation and
    // use an encoding different from the default (UTF-8).
    app.cache({
      file: '/path/to/articles.txt',
      synchronous: true,
      encoding: 'CP-1252'
    });

    // Cache a file with a custom key. Optionally, parse the JSON and store the
    // parsed object in the cache instead of the raw buffer. Expire the cache
    // after 60000 ms (60 seconds), but reset the timer whenever the key is
    // retrieved.
    app.cache({
      file: '/path/to/articles.json',
      key: 'articles',
      parseJSON: true,
      lifespan: 60000,
      resetOnAccess: true
    });

`controllers`, `routes`, and `app` are reserved scope names, so don't use them for your own custom scopes.


### exists(options)

This is a way to check for the existence of a given key or scope in the cache without resetting the cache timer on that item. Returns `false` if a match isn't found.

    // Check the default scope (app) for the specified key
    var keyExists = app.exists({ key: 'welcome message' })         // keyExists is true
    var keyExists = app.exists({ key: '/path/to/articles.txt' })   // keyExists is true
    var keyExists = app.exists({ key: 'articles' })                // keyExists is true
    var keyExists = app.exists({ key: 'foo' })                     // keyExists is false

    // Check the specified scope for the specified key
    var keyExists = app.exists({
      scope: 'site messages',
      key: 'welcome message'
    });
    // keyExists is true

    // Check if the specified scope exists and contains items
    var scopeExists = app.exists({
      scope: 'site messages'
    });
    // scopeExists is true

    // Check if the controller cache has any instances of the specified controller
    var controllerExists = app.exists({
      controller: 'article'
    });

    // Check if the controller cache has any instances of the specified controller
    // and action
    var controllerExists = app.exists({
      controller: 'article',
      action: 'edit'
    });

    // Check if the controller cache has any instances of the specified controller,
    // action, and view
    var controllerExists = app.exists({
      controller: 'article',
      action: 'edit',
      view: 'edit'
    });

    // Check if the controller cache has an instance of the specified controller,
    // action, and view for a given route
    var controllerExists = app.exists({
      controller: 'article',
      action: 'edit',
      view: 'edit',
      route: '/article/My-Article/page/2'
    });


### retrieve(options)

Retrieve an individual key or an entire scope. Returns `false` if the requested item doesn't exist. If `resetOnAccess` was true when the item was cached, using retrieve() will reset the cache clock and extend the life of the cached item. If a scope is retrieved, all items in that scope will have their cache timers reset.

Optionally, you can override the `resetOnAccess` attribute when retrieving a cache item by specifying it now.

    // Retrieve the specified key from the default (app) scope
    var welcomeMessage = app.retrieve({
      key: 'welcome message'
    });

    // Retrieve the specified key from the specified scope and reset its cache timer
    // even if resetOnAccess was initially set to false when it was stored
    var welcomeMessage = app.retrieve({
      scope: 'site messages',
      key: 'welcome message',
      resetOnAccess: true
    });

    // Retrieve all keys from the specified scope
    var siteMessages = app.retrieve({
      scope: 'site messages'
    });


### clear(options)

Clear a cache object using a key or a scope.

    // Store some cache items

    app.cache({
      key: 'welcome message',
      scope: 'site messages',
      value: 'Welcome to our site.'
    });

    app.cache({
      key: 'goodbye message',
      scope: 'site messages',
      value: 'Thanks for visiting!'
    });

    app.cache({
      file: '/path/to/articles.txt',
      synchronous: true
    });

    // Clear the welcome message from its custom scope cache
    app.clear({ scope: 'site messages', key: 'welcome message' });

    // Clear all messages from the cache using their custom scope
    app.clear({ scope: 'site messages' });

    // Clear the articles cache from the default app scope
    app.clear({ key: '/path/to/articles.txt' });


`clear()` can also be used to remove cached controllers and routes from their respective caches.

    // Clear the specified controller from the cache, including all actions and views
    app.clear({
      controller: 'article'
    });

    // Clear the specified controller/action pairing from the cache. All cached views
    // related to this pairing will be deleted.
    app.clear({
      controller: 'article',
      action: 'edit'
    });

    // Clear the specified controller/action/view combination from the cache
    app.clear({
      controller: 'article',
      action: 'edit',
      view: 'edit'
    });

    // Clear the specified controller/action/view/route combination from the cache
    app.clear({
      controller: 'article',
      action: 'edit',
      view: 'edit',
      route: '/article/My-Article/page/2/action/edit'
    });

    // Clear the entire controller scope
    app.clear({ scope: 'controllers' });

    // Clear the entire route scope
    app.clear({ scope: 'routes' });

    // Clear the entire app scope
    app.clear({ scope: 'app' });


### listen({ functions }, callback)

The article example we've been using has only simple methods that return static content immediately, but things are rarely that simple. The `listen()` function takes advantage of the asynchronous, event-driven nature of Node.js, letting you wrap a single function or multiple asynchronous functions within it and firing a callback when they're done. You can also chain and nest multiple `listen()` functions for very powerful asynchronous function calls.

`listen()` takes two arguments: an object containing one or more methods you want to call, and a callback to handle the output. `listen()` requires that your functions be written to accept an `emitter` argument, which is how your function notifies `listen()` that it's ready.

Let's say our article model has two methods that need to be called before returning the results to the controller. One is called `getArticle()` and the other is `getViewers()`. Assume both methods make an asynchronous call to a database and can't be relied upon to return their output immediately, so we have to listen for when they're ready and then react.

    // article controller

    module.exports = {
      handler: handler
    };

    function handler(params, context, emitter) {
      app.listen({
        // The property contains the action you want to listen for, which is
        // wrapped in an anonymous function in order to pass the emitter
        article: function (emitter) {
          app.models.article.getArticle(params.url.article, params.url.page, emitter);
        },
        viewers: function (emitter) {
          app.models.article.getViewers(params.url.article, emitter);
        }
      }, function (output) {
        // Emit `ready` now that we have the output from article and viewers and
        // pass the context back to the server
        emitter.emit('ready', {
          content: {
            // The property names you assign to the methods above become the names
            // of the output objects
            article: output.article,
            viewers: output.viewers
          }
        });
      });
    }

And the model:

    // article model

    module.exports = {
      getArticle: getArticle,
      getViewers: getViewers
    };

    // Methods called via listen() must be written to accept an emitter
    function getArticle(article, page, emitter) {
      app.db.article({ article: article, page: page }, function (data) {
        // When the database returns the data, emit `ready` and pass the
        // data back to listen()
        emitter.emit('ready', data);
      });
    };

    function getViewers(article, emitter) {
      app.db.viewers({ article: article }, function (data) {
        emitter.emit('ready', data);
      });
    };

`listen()` currently fires all functions asynchronously and returns the results for every function in a single output object after all functions have completed. A waterfall-type execution is being worked on, but in the meantime, you can nest `listen()` functions to achieve the same effect:

    app.listen({
      first: function (emitter) {
        doSomething(emitter);
      }
    }, function (output) {
      app.listen({
        second: function (emitter) {
          doNextThing(output.first, emitter);
        }
      }, function (output) {
        app.listen({
          third: function (emitter) {
            doOneMoreThing(output.second, emitter);
          }
        }, function (output) {
          thisIsExhausting(output.third);
        });
      });
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

When file logging is enabled, citizen writes its logs to citizen.txt. Log files appear in the folder you specify in `config.citizen.directories.logs`.



## Debugging

**Warning: `debug` and `development` modes are inherently insecure. Don't use them in a production environment.**

If you set `"mode": "debug"` in your config file, citizen dumps the current pattern's output to the console by default. You can also dump it to the view by setting `debug.output` in your config file to `view`, or use the `ctzn_dump` URL parameter on a per-request basis:

    // config file: always dumps debug output in the view
    {
      "debug": {
        "output": "view"
      }
    }

    // URL
    http://www.cleverna.me/article/id/237/page/2/ctzn_dump/view

By default, the pattern's complete output is dumped. You can specify the exact object to debug with the `ctzn_debug` URL parameter. You can access globals, `pattern`, and server `params`:

    // Dumps pattern.content to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/pattern.content

    // Dumps the server params object to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params

    // Dumps the user's session to the console
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session

    // Dumps the user's session to the view
    http://www.cleverna.me/article/id/237/page/2/ctzn_debug/params.session/ctzn_dump/view

In `development` mode, you must specify the `ctzn_debug` URL parameter to enable debug output. Debug output is disabled in production mode.


## Utilities

The util directory within the citizen package has some helpful CLI utilities.

### scaffold

#### skeleton

Creates a complete skeleton of a citizen app with a functional index pattern.

    $ node scaffold skeleton

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
          index/
            index.jade
      start.js
    web/

Run `node scaffold skeleton -h` for options.


#### pattern

Creates a complete citizen MVC pattern. The pattern command takes a pattern name and options:

    $ node scaffold pattern [options] [pattern]

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

Use `node scaffold pattern -h` to see all available options for customizing your patterns.


## License

(The MIT License)

Copyright (c) 2014 Jason Sylvester <jay@jaysylvester.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
