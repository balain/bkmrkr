// Private and Secure Bookmark Manager

const debug = require('debug')('server-js')
const config = require('config')

const fs = require('fs')

const jsdom = require('jsdom')
const { JSDOM } = jsdom

var express = require('express')
var session = require('express-session')
var RateLimit = require('express-rate-limit')
var limiter = new RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5
})

var passport = require('passport')
var Strategy = require('passport-local').Strategy
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn

const bcrypt = require('bcrypt')
const crypto = require('crypto')

const https = require('https')
const http = require('http')
const got = require('got')

const fetchFavicon = require('@meltwater/fetch-favicon').fetchFavicon

var userConfig = require('./users');

const useHttps = config.has('useHttps') && config.useHttps ? true : false

let auth
if (useHttps) {
  auth = require('./config/auth.js')
}

const sqlite3 = require('sqlite3').verbose()
const dbFile = config.has('dbFile') ? config.dbFile : 'bkmrks.sqlite'

const bkmrksDb = new sqlite3.Database(dbFile, err => {
  if (err) {
    return console.error(err.message)
  }
  debug(`Connected to db: ${dbFile}`)
})


/*
Configure the local strategy for use by Passport.
  The local strategy require a `verify` function which receives the credentials
  (`username` and `password`) submitted by the user.  The function must verify
  that the password is correct and then invoke `cb` with a user object, which
  will be set at `req.user` in route handlers after authentication.
 */

passport.use(new Strategy(
  function(username, password, cb) {
    userConfig.users.findByUsername(username, function(err, user) {
      if (err) {
        debug(`err in findByUsername: ${err}`)
        return cb(err);
      }
      if (!user) {
        debug(`!user found`)
        return cb(null, false);
      }
      debug(`Found user... Comparing supplied password with hashedPwd`)
      if (!bcrypt.compareSync(password, user.hashedPwd)) {
        debug(`...***NO*** MATCH`)
        return cb(null, false);
      }
      debug(`...MATCH !!!!`)
      return cb(null, user);
    });
  }));


/*
Configure Passport authenticated session persistence.
  In order to restore authentication state across HTTP requests, Passport needs
  to serialize users into and deserialize users out of the session.  The
  typical implementation of this is as simple as supplying the user ID when
  serializing, and querying the user record by ID from the database when
  deserializing.
*/
passport.serializeUser(function(user, cb) {
  cb(null, user.id);
});

passport.deserializeUser(function(id, cb) {
  userConfig.users.findById(id, function (err, user) {
    if (err) { return cb(err); }
    cb(null, user);
  });
});

var app = express();
app.use(limiter);

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(require('morgan')('combined'));
app.use(require('body-parser').urlencoded({ extended: true }));
let sessionConfig = {
  secret: userConfig.sec.getSessionKey(),
  resave: true,
  name: 'bkmrkr',
  proxy: false,
  saveUninitialized: false,
  cookie: {
    domain: config.has('cookie') && config.cookie.has('domain')
      ? config.cookie.domain
      : '',
    httpOnly: true,
    path: '/',
    sameSite: false,
    secure: false,
    maxAge: (config.has('cookie') && config.cookie.has('maxAgeDays')
      ? config.cookie.maxAgeDays
      : 7) * 24 * 60 * 60 * 1000
  }
}
if (useHttps) {
  sessionConfig.cookie.httpOnly = false
  sessionConfig.cookie.secure = true
}
app.use(session(sessionConfig));

app.use(passport.initialize());
app.use(passport.session());

// Routes

app.get('/', (req, res) => { res.send('ok') })

app.get('/bkmrkr/',
  function (req, res) {
    debug(`get//req.session: `, req.session)
    debug(`req.user: `, req.user ? req.user.username : '')
    res.render('home', { user: req.user });
  }
);

app.get('/bkmrkr/login',
  function(req, res){
    debug(`get/login/req.session: `, req.session)
    debug(`req.user: `, req.user ? req.user.username : '')
    res.render('login', { user: req.user ? req.user : { username: 'unset' } });
  }
);
  
app.post('/bkmrkr/login', 
  passport.authenticate('local', {
    successReturnToOrRedirect: '/',
    failureRedirect: '/bkmrkr/login?msg=failed'
  }),
  function(req, res) {
    debug(`post/login/req.session: `, req.session)
    res.redirect('/bkmrkr/');
  }
);
  
app.get('/bkmrkr/logout',
  function(req, res){
    req.logout();
    res.redirect('/bkmrkr');
  }
);

app.get('/bkmrkr/profile',
  ensureLoggedIn('/bkmrkr/login'),
  function(req, res){
    debug(`profile/req.session: `, req.session)
    res.render('profile', { user: req.user });
  }
);

function getUrlMeta(link, counter = 1) {
  debug(`getUrlMeta(${link}, ${counter}) called...`)
  return new Promise((resolve, reject) => {
    got(link, {
      followRedirect: false,
      headers: {
        'user-agent': `custom bkmrkr${config.has('contact') ? ` (${config.contact})` : ''}`,
        'Accept': 'text/html' // So it will work with crates.io
      }
    })
      .then((response) => {
        debug(`...have response (len: ${response.statusCode})`)
        // Redirect?
        if (response.statusCode >= 300 && response.statusCode < 400 && counter <= 5) {
          debug(`...redirecting to ${response.headers.location}`)
          resolve(getUrlMeta(response.headers.location, ++counter))
        } else { // Valid URL
          debug(`...got valid URL; now parsing response.body (len: ${response.body.length})`)

          fetchFavicon(response.url).then((favicon) => {

          // Now get the page title and H1
          const dom = new JSDOM(response.body)

          debug(`...returning ${response.url}`)
          resolve({
                'statusMessage': response.statusMessage,
                'statusCode': response.statusCode,
                'ip': response.ip,
                'url': response.url,
                'timings': response.timings,
                'title': dom.window.document.querySelector("title").textContent,
                'favicon': favicon,
                'timestamp': new Date().getTime()
              })
          })
        }
      })
      .catch((err) => {
        console.error(err)
        reject(err)
    })
  })
}

/* TODO:
   1. Check for redirects & bookmark the final URL, not the original URL
    (look in headers.location)
 */
app.get('/bkmrkr/add',
  ensureLoggedIn('/bkmrkr/login'),
  async function (req, res) {
    debug(`req.user: `, req.user ? req.user.username : '')
    try {
      const linkMeta = await getUrlMeta(req.query.url)

      // const hash = crypto.createHash('sha256').update(req.query.url).digest('base64')
      const hash = crypto.createHash('sha256').update(linkMeta.url).digest('hex')
      const sql = 'INSERT INTO bkmrks (url, user, title, hash, favicon, created) VALUES (?, ?, ?, ?, ?, ?)'

      const data = [
        linkMeta.url,
        req.user.username,
        linkMeta.title,
        hash,
        linkMeta.favicon,
        linkMeta.timestamp]
      
      debug(`...sql: ${sql}, data: ${data}`)
      
      bkmrksDb.run(sql, data, err => {
        if (err) {
          res.send({ 'err': err.message })
        } else {          
          fs.writeFileSync(`./cache/${hash}.json`, JSON.stringify(linkMeta))
          res.type('html')
          res.write(`<H1>Saved</h1><div>link recorded (<em>${linkMeta.title ? linkMeta.title : linkMeta.url}</em>) and cache saved.</div><div>Window closing in <span id='counter'>5</span> seconds...</div>
          <script type='text/javascript'>
          function countdown() {
            var i = document.getElementById('counter');
            i.innerHTML = parseInt(i.innerHTML)-1;
     
            var isiPad = navigator.userAgent.match(/iPad/i) != null;
            var isiPhone = navigator.userAgent.match(/iPhone/i) != null;
            if (parseInt(i.innerHTML)<=0) { 
              if (isiPad || isiPhone) {
                setTimeout(window.close, 300 );
              } else {
                window.close();
              }
            }
          }          
          setInterval(function(){ countdown(); }, 1000);
          </script>`)
          res.end()
        }
      })
    } catch (err) {
      console.error(`@ 213: Caught error: ${err}`)
      res.send({ err: err })
    }
  }
)

app.get('/bkmrkr/visit/:hash',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    if (req.params.hash && req.params.hash.length == 64) {
      const hash = req.params.hash
      debug(`hash is ok! ${hash}`)
      const sqlUpdate = `UPDATE bkmrks SET toread='${new Date().getTime()}' WHERE hash='${hash}';`
      debug(`sqlUpdate: ${sqlUpdate}`)
      bkmrksDb.run(sqlUpdate, [], err => {
        const sqlSelect = `SELECT url FROM bkmrks WHERE hash='${hash}';`
        debug(`sqlSelect: ${sqlSelect}`)
        bkmrksDb.all(sqlSelect, [], (err, rowsSelect) => {
          debug(`rowsSelect: `, rowsSelect)
          debug(`redirecting to ${rowsSelect[0].url}`)
          res.redirect(rowsSelect[0].url)
        })
      })
    } else {
      console.error(`Invalid hash supplied: ${req.params.hash}`)
      res.send({err: `Invalid hash`})
    }
  }
)

app.get('/bkmrkr/count',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    bkmrksDb.all("SELECT count(*) as counter FROM bkmrks WHERE user = ?;",
      [
        req.user.username
      ], (err, rows) => {
      res.send(rows)
    })
  }
)

app.get('/bkmrkr/list',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    debug(`req.user: `, req.user ? req.user.username : '')
    bkmrksDb.all("SELECT * FROM bkmrks WHERE user = ? ORDER BY created DESC LIMIT 100;",
      [
        req.user.username
      ], (err, rows) => {
      res.send(rows)
    })
  }
)

app.get('/bkmrkr/latest',
  ensureLoggedIn('/bkmrkr/login'),
  (req, res) => {
    debug(`req.user: `, req.user ? req.user.username : '')
    res.type(`html`)
    bkmrksDb.all("SELECT url, title, hash, toread, favicon, created FROM bkmrks WHERE user = ? ORDER BY created DESC LIMIT 100;",
      [
        req.user.username
      ], (err, rows) => {
        res.write(startHtml('Latest 100 Bookmarks'))
        if (rows && rows.length) {
          res.write(`<ul>`)
          rows.forEach((row) => {
            const dCreated = new Date(+row.created)
            let dRead = new Date(+row.toread)
            if (dRead.getFullYear() == 2021) {
              dRead = `${dRead.getMonth() + 1}/${dRead.getDate()}`
            } else {
              dRead = dRead.toLocaleDateString("en-US")
            }
            let favicon = ""
            if (row.favicon) {
              favicon = `<img src='${row.favicon}' width='10px'>`
            }

            if (row.hash) {
              res.write(`<li><a href='./visit/${row.hash}' target='_blank'>${favicon}${row.title ? row.title : row.url}</a> (+:${dCreated.getFullYear() == 2021 ? `${dCreated.getMonth() + 1}/${dCreated.getDate()}` : dCreated.toLocaleDateString("en-US")}${row.toread && row.toread.length == 13 ? `; &#128065: ${dRead}` : ''})`)
            } else {
              res.write(`<li><a href='./visitlink/${encodeURIComponent(row.url)}' target='_blank'>${favicon}${row.title ? row.title : row.url}</a> (+:${dCreated.getFullYear() == 2021 ? `${dCreated.getMonth() + 1}/${dCreated.getDate()}` : dCreated.toLocaleDateString("en-US")}${row.toread && row.toread.length == 13 ? `; &#128065: ${dRead}` : ''})`)
            }
          })
          res.write(`</ul>`)
        } else {
          res.write(`<em>No bookmarks found</em>`)
        }
        res.write(endHtml())
        res.end()
    })
  }
)

function startHtml(title = '') {
  return (`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-BmbxuPwQa2lc/FVzBcNJ7UAyJxM6wuqIj61tLrc4wSX0szH/Ev+nYRRuWlolflfl" crossorigin="anonymous"><title>${title}</title> </head> <body> <h1>${title}</h1>`)
}

function endHtml() {
    return(`<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta2/dist/js/bootstrap.bundle.min.js" integrity="sha384-b5kHyXgcpbZJO/tY9Ul7kGkf1S0CWuKcCD38l8YkeH8z8QjE0GmW1gYU5S9FOnJ0" crossorigin="anonymous"></script></body></html>`)
}

var options = {}

if (useHttps) {
  // SSL Keys
  options = {
    key: auth.key,
    cert: auth.cert
  };
  
  // Start the server
  var httpsServer = https.createServer(options, app)
  httpsServer.listen(config.port, () => {
    console.log(`HTTPS Server started on port ${config.port}`)
  })
} else {
  // Start the server
  var httpServer = http.createServer(options, app)
  httpServer.listen(config.port, () => {
    console.log(`HTTP Server started on port ${config.port}`)
  })
}