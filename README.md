# bkmrkr
Private and personal bookmark manager

## Motivation
I've been a pinboard.in user for 10 years. I have really enjoyed the service and appreciate that it was so cheap to join back then. Recently, the creator of that service asked me (and others who had paid a one-time fee) to switch to a subscription model. A completely reasonable request/model that will help him continue to develop and enhance the application.

If you want social networking and don't mind a "no-frills" service, pinboard.in is really great. It's cheap, easy to use, and rock solid. And he's promising more features. But it bills itself as "Social Bookmarking for Introverts" - and I don't need the "Social" part. In fact, I don't want my bookmarks in a service that is advertised and designed to be shared.

So I created this simple node app to save *my* bookmarks. It takes just a few minutes to set up and works great for me, without having to set all my bookmarks to "private" by default or ignoring how many other people have already bookmarked what I just added. If this is what you want, feel free to download and set up this app for yourself.

## Features
* Local, password-protected bookmark storage (in a sqlite3 database)
* HTML for each bookmark is fetched and the metadata is cached locally (the filename is hashed)
* Bookmarklet (Javascript) to save from a browser
* Simple view of the latest 100 bookmarks with an "added" date & a "seen" flag/date
* Multi-user (Note: there is _no_ connection between users (and there never will be). See "What is missing?" below.)

### What is missing?
* Social networking features: This tool is not meant to connect people. (See "Motivation" above for explanation.)
* A full API. (Only an "add" method exists today. Others may be added later.)

## Setup
1. Create a user
   1. Rename `users/users-template.js` to `users/users.js`
   1. Run `node generatePassword.js <_password_>` and save the output in `users/users.js` as _hashedPwd_
1. Create the database: `sqlite bkmrks.db < bkmrks.sql` (Note: change to the _dbFile_ location as set in the configuration file. See below.)
1. Configure the server
   * Required
      1. Rename `default-template.json` to `default.json`
      1. Set the _sessionKey_ with any unique string
      1. Set the _port_ to an open port value (default: 8000)
      1. Set _dbFile_ as the database name (default: `./data/bkmrks.sqlite`)      
      1. Set _cookie.maxAgeDays_ (default: 7)

   * Optional
       1. Set _cookie.domain_ to your domain. (Delete this entry if you don't want to set it.)
       1. Set _useHttps_ to _true_ (default: false)
       1. Set _contact_ with an email address (must be set in the header to add links to https://crates.io)

1. Add the node modules: `npm i`
1. Start the server: `node server.js`
1. Open your browser: `http://localhost:8000/bkmrkr/`

# Requirements
* [sqlite3](https://github.com/kriasoft/node-sqlite)
* [debug](https://github.com/visionmedia/debug) - Flexible debugging output
* [config](https://github.com/lorenwest/node-config) - Easy configuration tool
* [jsdom](https://github.com/jsdom/jsdom) - Parse the HTML
* [express](https://github.com/expressjs/express) - Web app framework
* [express-session](https://github.com/expressjs/session) - Track logged in users
* [passport](https://github.com/jaredhanson/passport) - Authentication framework
* [passport-local](https://github.com/jaredhanson/passport-local) - Local user management
* [connect-ensure-login](https://github.com/jaredhanson/connect-ensure-login) - Middleware to make sure users are logged in
* [bcrypt](https://github.com/kelektiv/node.bcrypt.js) - Encrypt the password
* [got](https://github.com/sindresorhus/got) - Fetch the HTML
* [@meltwater/fetch-favicon](https://github.com/gkovacs/fetch-favicon) - Gets the favicon from the remote site

# License
MIT. See the LICENSE file for the full license.

# Final Notes
Initial starting point: https://github.com/passport/express-4.x-local-example