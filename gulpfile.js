var gulp = require('gulp');
var through2 = require('through2');
var gutil = require('gulp-util');
var path = require('path');

var manifestFileName = 'manifest.json';
var manifestVersionFileName = 'manifest-version.json';
// relative path to the folder with update.html for cordova-app-loader
var cordovaAppLoaderFolderName = 'cordova-app-loader';

// creates manifest.json for https://github.com/markmarijnissen/cordova-app-loader
// should be run from folder that contains www
// inspired by https://gist.github.com/arieljake/19447838b29a3e2da92b
// 
// for debugging put debugger; somewhere and run: node-debug gulp manifest
// see https://github.com/node-inspector/node-inspector
var manifestTask = function () {
    var allFiles = [];
    var getManifestVersion = function (allHashes) {
        var hasher = require('crypto').createHash('sha256');
        var sha256 = hasher.update(allHashes).digest("hex");
        return sha256;
    };
    var getManifestJson = function () {
        var json = {};

        json.files = {};
        // sort all files because gulp enumerates files not deterministic
        // but I need them to be in the same order every time to calculate the same total hash
        allFiles.sort(function (a, b) {
            return a.filename.localeCompare(b.filename);
        });
        var allHashes = '';
        allFiles.forEach(function (file) {
            var filename = file.filename.split('\\').join('/');
            var key = filename;
            json.files[key] = {};
            json.files[key]['filename'] = filename;
            json.files[key]['version'] = file.hash;
            allHashes += file.hash;// combine all hashes to create total hash for manifest.version
        });

        // json.load will be empty because I don't plan to use reloading functionality. 
        // I'll create a separate 'update.html' page instead that I don't plan to ever update.
        // update.html will be loading updates and once done redirect to updated index.html
        json.load = [];

        json.version = getManifestVersion(allHashes);
        return json;
    };

    return gulp.src([
        // web server may not return some file extensions. for example, *.config.
        // if such file appears in manifest.json then update process fails because
        // mobile app update process is not able to get the updated version of
        // the file. instead of excluding such files i prefer to specify supported
        // extensions so that if a new file appears in the project then it doesn't
        // break the update process.
        //'./www/**', '!./www/**/*.config', '!./www/**/*.gzip',
        './www/**/*.html'
        , './www/**/*.js'
        , './www/**/*.css'
        , './www/**/*.svg'
        , './www/**/*.png'
        , './www/**/*.map'
        , './www/**/*.eot'
        , './www/**/*.ttf'
        , './www/**/*.woff'
        , './www/**/*.woff2'
        , './www/**/*.gif'
        , './www/**/*.jpg'
        , './www/**/*.json'
        , './www/**/*.otf'
        , './www/**/*.json'
        , './www/**/*.ico'
        , './www/**/*.txt'
        // don't include files related to cordova-app-loader because we are not going to ever update them
        , '!./www/' + cordovaAppLoaderFolderName + '/**'
    ])
        //.pipe(gulpHeader('\ufeff'))
        // custom pipe http://stackoverflow.com/a/27928475/292787
        .pipe(through2.obj(function (file, enc, cb) {// transformFunction. see https://github.com/rvagg/through2
            // collect all filenames and hashes
            if (file.contents != null) { // not a directory
                console.log('hashing: ' + file.path); // to see kind of progress while running
                var hasher = require('crypto').createHash('sha256');
                var sha256 = hasher.update(file.contents).digest("hex");
                allFiles.push({
                    filename: path.relative(file.base, file.path),
                    hash: sha256
                });
            }
            cb();
        },
            function (cb) {// flush function. see https://github.com/rvagg/through2
                // write out all collected filenames and hashes into manifest.json
                var manifestJson = getManifestJson();
                var jsonString = JSON.stringify(manifestJson, null, 2);
                var cwd = process.cwd();
                var manifestFile = new gutil.File({
                    cwd: cwd,
                    base: cwd,
                    path: path.join(cwd, cordovaAppLoaderFolderName + '/' + manifestFileName),
                    contents: new Buffer(jsonString)
                });
                this.push(manifestFile);
                // separate small file with manifest version to speed up application start time
                var manifestVersionFile = new gutil.File({
                    cwd: cwd,
                    base: cwd,
                    path: path.join(cwd, cordovaAppLoaderFolderName + '/' + manifestVersionFileName),
                    contents: new Buffer('{ "version" : "' + manifestJson.version + '" }')
                });
                this.push(manifestVersionFile);
                console.log('Number of processed files: ' + allFiles.length);
                cb();
            }))
        .pipe(gulp.dest('./www/'));
};

gulp.task('manifest', manifestTask);

gulp.task('default', manifestTask);