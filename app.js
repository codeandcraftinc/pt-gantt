var _ = require('lodash');
var URI = require('URIjs');
var unirest = require('unirest');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var Promise = require('bluebird');
var moment = require('moment');
var swig = require('swig');
var pivotal = require('pivotal');
var app = express();
require('moment-range');


Promise.promisifyAll(pivotal);


app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');
app.set('view cache', false);
swig.setDefaults({ cache: false });
app.use(session({
  secret: process.env.SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: false
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));


app.get('/login', function ensureTokenDoesNotExist(req, res, next) {
  if (req.session.token) {
    return res.redirect('/');
  }

  next();
}, function renderView(req, res) {
  res.render('login');
});


app.post('/login', function (req, res, next) {
  if ([undefined, null, ''].indexOf(req.body.token.trim()) > -1) {
    return res.redirect('/login');
  }

  req.session.token = req.body.token;
  res.redirect('/');
});


app.get('/', function ensureTokenExists(req, res, next) {
  if (!req.session.token) {
    return res.redirect('/login');
  }

  next();
}, function renderView(req, res, next) {

  pivotal.useToken(req.session.token);

  Promise.resolve(pivotal.getProjectsAsync()).then(function (results) {
    var promises = [];

    results.project.forEach(function (project) {
      var promise = pivotal.getStoriesAsync(project.id, {
        filter: 'type:release state:unstarted'
      });

      promises.push(Promise.resolve(promise));
    });

    return [results.project, Promise.all(promises)];
  }).spread(function (projects, results) {
    var days = [];
    var releases;
    var deadlines;
    var range;

    // ensure releases are an array of arrays
    releases = _.map(results, function (result) {
      return _.isObject(result) ? result.story : [];
    });

    // get deadlines as `moment()`s
    deadlines = _(releases)
      .flatten()
      .pluck('deadline')
      .map(Date.parse)
      .sort()
      .map(function (v) { return moment.utc(v); })
      .value();

    // collect complete range of days from today to latest release
    range = moment.range(moment.utc(), deadlines.pop().add(1, 'day'));
    range.by('days', days.push.bind(days));

    // compile projects/releases
    projects = projects.map(function (project, k) {
      project.releases = releases[k].map(function (release) {
        release.deadlineMoment = moment.utc(release.deadline);
        return release;
      });

      return project;
    });

    res.render('gantt', {
      today: moment.utc(),
      days: days,
      projects: projects
    });
  }).catch(next);
});


app.use(function (err, req, res, next) {
  console.log(err);
  res.render('error');
});


app.listen(3000);
