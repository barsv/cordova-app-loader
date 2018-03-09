'use strict';
/**
 * notes:
 * 
 * there are 2 manifest files: manifest.json and manifest-version.json
 * 
 * manifest.json is almost the same as in original cordova-app-loader project. it's a file with the list of
 * all application files and their hashes.
 * 
 * manifest-version.json contains hash of manifest.json. this is to speedup loading. manifest.json can be huge and
 * usually it's not changed (if application updates are relatively rare compared to application launches).
 * 
 */
(function () {

    // Retrieved and slightly modified from: https://github.com/typicode/pegasus
    // --------------------------------------------------------------------------
    // a   url (naming it a, because it will be reused to store callbacks)
    // xhr placeholder to avoid using var, not to be used
    var pegasus = function pegasus(a, xhr) {
        xhr = new XMLHttpRequest();
        // Open url
        xhr.open('GET', a);
        // Reuse a to store callbacks
        a = [];
        // onSuccess handler
        // onError   handler
        // cb        placeholder to avoid using var, should not be used
        xhr.onreadystatechange = xhr.then = function (onSuccess, onError, cb, result) {
            // Test if onSuccess is a function or a load event
            if (onSuccess.call) a = [onSuccess, onError];
            // Test if request is complete
            if (xhr.readyState == 4) {
                try {
                    if (xhr.status === 200) {
                        result = JSON.parse(xhr.responseText);
                        cb = a[0];
                    } else {
                        result = new Error('Status: ' + xhr.status);
                        result.httpStatus = xhr.status;
                        cb = a[1];
                    }
                } catch (e) {
                    result = e;
                    cb = a[1];
                }
                // Safari doesn't support xhr.responseType = 'json' so the response is parsed
                if (cb) cb(result);
            }
        };
        xhr.send();
        return xhr;
    };

    var pegasusAsync = function (a, xhr) {
        return new Promise(function (resolve, reject) {
            pegasus(a).then(resolve, reject);
        });
    };

    var isCordova = typeof cordova !== 'undefined';

    var fs = new CordovaPromiseFS({
        persistent: isCordova, // Chrome should use temporary storage.
        Promise: Promise
    });

    function CordovaAppLoader(options) {
        var self = this;
        if (!options) throw new Error('CordovaAppLoader has no options!');
        if (!options.serverRoot) throw new Error('CordovaAppLoader has no "serverRoot" option.');

        // for dependency injection from tests
        if (options.pegasus) pegasus = options.pegasus;
        if (options.fs) fs = options.fs;

        // serverRoot is url to the server with up-to-date application files
        self.serverRoot = options.serverRoot.endsWith('/') ? options.serverRoot : options.serverRoot + '/';
        // localRoot is name of the folder where we are going to store application files
        self.localRoot = fs.normalize(options.localRoot || 'app');
        // manifest.json is the list of files and hashes on server
        self.manifestFileName = options.manifestFileName || 'manifest.json';
        // manifest-version.json contains hash of manifest.json
        self.manifestVersionFileName = options.manifestVersionFileName || 'manifest-version.json';
        // loaderFolderName is name of the folder with manifests (relative to serverRoot)
        self.loaderFolderName = options.loaderFolderName || 'loader';
        // when we load files from server we add timestamp at the end to avoid caching
        self.useCacheBuster = options.useCacheBuster || true;
        // timeout in ms is used for each file loading
        self.timeout = options.timeout || 10 * 1000;
        // if debug is enabled then it prints traces to console.debug (note: not console.log)
        self.debug = options.debug || false;
    }

    CordovaAppLoader.prototype._debug = function (message) {
        var self = this;
        if (self.debug)
            console.debug(message);
    }

    CordovaAppLoader.prototype.cacheBoostUrl = function (url) {
        var self = this;
        return self.useCacheBuster ? url + '?' + Date.now() : url;
    };

    // /** creates a new Promise with timeout */
    // CordovaAppLoader.prototype._newPromiseWithTimeout = function(executor) {
    //     var self = this;
    //     var caller = null;
    //     if (self.debug){
    //         caller = (new Error()).stack.split(' at')[2];
    //         self._debug('starting: ' + caller);
    //     }
    //     return new Promise(function(resolve, reject) {
    //         var isCompleted = false;
    //         executor(function(){
    //             isCompleted = true;
    //             self._debug('resolved: ' + caller);
    //             resolve(arguments);
    //         }, function() {
    //             isCompleted = true;
    //             self._debug('rejected: ' + caller);
    //             reject(arguments);
    //         });
    //         setTimeout(function() {
    //             if (!isCompleted){
    //                 self._debug('timed out after ' + self.timeout + ' ms : ' + caller);
    //                 reject('Promise timed out after ' + self.timeout + ' ms');
    //             }
    //         }, self.timeout);
    //     });
    // }

    /** wraps existing Promise with timeout */
    CordovaAppLoader.prototype._wrapPromiseWithTimeout = function (promise) {
        var self = this;
        var caller = null;
        if (self.debug) {
            caller = (new Error()).stack.split(' at')[2];
            self._debug('starting: ' + caller);
        }
        return new Promise(function (resolve, reject) {
            var isCompleted = false;
            promise.then(
                function () {
                    isCompleted = true;
                    self._debug('resolved: ' + caller);
                    resolve.apply(this, arguments);
                },
                function () {
                    isCompleted = true;
                    self._debug('rejected: ' + caller);
                    reject(arguments);
                }
            );
            setTimeout(function () {
                if (!isCompleted) {
                    self._debug('timed out after ' + self.timeout + ' ms : ' + caller);
                    reject('Promise timed out after ' + self.timeout + ' ms');
                }
            }, self.timeout);
        });
    }

    // CordovaAppLoader.prototype._retryPromise = function(promiseFactory, attempts){
    //     // retry promise https://stackoverflow.com/a/31630063/292787
    //     function recurs(i) {
    //         return promiseFactory().catch(function (e) {
    //             if (i < attempts) {
    //                 return recurs(++i);
    //             }
    //             throw e;
    //         });
    //     }
    //     return recurs(1);
    // }

    /** gets manifest-version.json from server */
    CordovaAppLoader.prototype._getServerManifestVersion = function () {
        var self = this;
        var serverManifestVersionUrl = self.cacheBoostUrl(self.serverRoot
            + self.loaderFolderName + '/' + self.manifestVersionFileName);
        return self._wrapPromiseWithTimeout(pegasusAsync(serverManifestVersionUrl));
    };

    /** gets fresh manifest.json from server */
    CordovaAppLoader.prototype._getServerManifest = function () {
        var self = this;
        var serverManifestUrl = self.cacheBoostUrl(self.serverRoot
            + self.loaderFolderName + '/' + self.manifestFileName);
        return self._wrapPromiseWithTimeout(pegasusAsync(serverManifestUrl));
    }

    /** if app/loader/manifest.json exists on device storage then returns its content otherwise returns null.
     * note: if synchronization with server has been run before 
     * then app/loader/manifest.json already exists on device storage.
    */
    CordovaAppLoader.prototype._getStorageManifest = function () {
        var self = this;
        return fs.read(self.localRoot + self.manifestFileName).then(
            function (storageManifestContent) {
                self._debug('loaded manifest from storage.');
                var storageManifest = JSON.parse(storageManifestContent);
                return storageManifest;
            },
            function () {
                // if manifest does not exist on storage i don't want to reject because reject will reject Promise.all
                // i just resolve as null and handle it in Promise.all
                self._debug('storage manifest does not exist. yet.');
                return null;
            }
        );
        // i don't put timeout here because it's not a communication with a remote server, 
        // it's a local file, it shouldn't hang
    }

    /** gets manifest.json from application bundle */
    CordovaAppLoader.prototype._getBundledManifest = function () {
        var self = this;
        var bundledManifestUrl = self.manifestFileName;
        return new Promise(function (resolve, reject) {
            // bundled manifest is immutable, so it's fine to use value from cache
            if (self.bundledManifestContent) {
                resolve(self.bundledManifestContent);
            } else {
                pegasus(bundledManifestUrl).then(function (bundledManifestContent) {
                    // bundled manifest is immutable, so it's fine to cache it
                    self.bundledManifestContent = bundledManifestContent;
                    self._debug('loaded bundled manifest.');
                    resolve(bundledManifestContent);
                }, function () {
                    var message = 'Unexpected error. Bundled manifest not found.';
                    self._debug(message);
                    reject(new Error(message));
                });
            }
        });
        // i don't put timeout here because it's not a communication with a remote server, 
        // it's a local file, it shouldn't hang
    };

    /**
     * returns an array of full paths for all files on device storage
     */
    CordovaAppLoader.prototype._listStorageFiles = function () {
        var self = this;
        return fs.list(self.localRoot, 'rfe').then(
            function (entries) {
                var fullPaths = entries.map(function (entry) {
                    var fullPath = fs.normalize(entry.fullPath);
                    return fullPath;
                });
                return fullPaths;
            },
            function(){
                // if for example folder doesn't exist then just return no files
                return [];
            }
        );
    };

    /** returns true if there are updates available on server for sync */
    CordovaAppLoader.prototype.check = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            Promise.all(
                [self._getServerManifestVersion(), self._getBundledManifest(), self._getStorageManifest()]
            ).then(function ([serverManifestVersion, bundledManifest, storageManifest]) {
                serverManifestVersion = serverManifestVersion ? serverManifestVersion.version : null;
                // if we already have up to date version then we don't need to update
                var dontNeedToSync = bundledManifest.version === serverManifestVersion
                    // storageManifest may be null if no updates were ever made.
                    || storageManifest && storageManifest.version === serverManifestVersion;
                resolve(!dontNeedToSync);
            });
        });
    };

    /** performs sync with remote server */
    CordovaAppLoader.prototype.download = function () {
        var self = this;
        return Promise.all(
            [self._listStorageFiles(), self._getServerManifest()]
        ).then(function ([storageFiles, serverManifest]) {
            // save serverManifest so that at the end of the download process we check that it is not changed
            // because if it's changed then it means that there was a redeployment while we were downloading files
            self.serverManifestBeforeDownload = serverManifest;

            // Check if new manifest is valid
            if (!serverManifest.files) {
                return Promise.reject(new Error('Downloaded manifest doesn\'t have "files" attribute.'));
            }
        });
    };

    // "export"
    window.CordovaAppLoader = CordovaAppLoader;
})();