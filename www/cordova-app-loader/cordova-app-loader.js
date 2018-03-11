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
        // storageRoot is name of the folder where we are going to store application files
        self.storageRoot = fs.normalize(options.storageRoot || 'app');
        // manifest.json is the list of files and hashes on server
        self.manifestFileName = options.manifestFileName || 'manifest.json';
        // manifest-version.json contains hash of manifest.json
        self.manifestVersionFileName = options.manifestVersionFileName || 'manifest-version.json';
        // loaderFolderName is name of the folder with manifests (relative to serverRoot)
        self.loaderFolderName = options.loaderFolderName || 'cordova-app-loader';
        // when we load files from server we add timestamp at the end to avoid caching
        self.useCacheBuster = options.useCacheBuster || true;
        // timeout in ms is used for each file loading
        self.timeout = options.timeout || 10 * 1000;
        // if debug is enabled then it prints traces to console.debug (note: not console.log)
        self.debug = options.debug || false;
        setBundleRoot(self);
    }

    function setBundleRoot(self) {
        self.bundleRoot = location.href.replace(location.hash, '');
        self.bundleRoot = self.bundleRoot.substr(0, self.bundleRoot.lastIndexOf('/' + self.loaderFolderName) + 1);
        if (/ip(hone|ad|od)/i.test(navigator.userAgent)) {
            self.bundleRoot = location.pathname.substr(location.pathname.indexOf('/www/'));
            self.bundleRoot = self.bundleRoot.substr(0, self.bundleRoot.lastIndexOf('/' + self.loaderFolderName) + 1);
            self.bundleRoot = 'cdvfile://localhost/bundle' + self.bundleRoot;
        }
    }

    function debug(self, message) {
        if (self.debug)
            console.debug(message);
    }

    function cacheBoostUrl(self, url) {
        return self.useCacheBuster ? url + '?' + Date.now() : url;
    };

    // /** creates a new Promise with timeout */
    // function newPromiseWithTimeout(self, executor) {
    //     var caller = null;
    //     if (self.debug){
    //         caller = (new Error()).stack.split(' at')[2];
    //         debug(self, 'starting: ' + caller);
    //     }
    //     return new Promise(function(resolve, reject) {
    //         var isCompleted = false;
    //         executor(function(){
    //             isCompleted = true;
    //             debug(self, 'resolved: ' + caller);
    //             resolve(arguments);
    //         }, function() {
    //             isCompleted = true;
    //             debug(self, 'rejected: ' + caller);
    //             reject(arguments);
    //         });
    //         setTimeout(function() {
    //             if (!isCompleted){
    //                 debug(self, 'timed out after ' + self.timeout + ' ms : ' + caller);
    //                 reject('Promise timed out after ' + self.timeout + ' ms');
    //             }
    //         }, self.timeout);
    //     });
    // }

    /** wraps existing Promise with timeout */
    function wrapPromiseWithTimeout(self, promise) {
        var caller = null;
        if (self.debug) {
            caller = (new Error()).stack.split(' at')[2];
            debug(self, 'starting: ' + caller);
        }
        return new Promise(function (resolve, reject) {
            var isCompleted = false;
            promise.then(
                function () {
                    isCompleted = true;
                    debug(self, 'resolved: ' + caller);
                    resolve.apply(this, arguments);
                },
                function () {
                    isCompleted = true;
                    debug(self, 'rejected: ' + caller);
                    reject.apply(this, arguments);
                }
            );
            setTimeout(function () {
                if (!isCompleted) {
                    debug(self, 'timed out after ' + self.timeout + ' ms : ' + caller);
                    reject('Promise timed out after ' + self.timeout + ' ms');
                }
            }, self.timeout);
        });
    }

    // function retryPromise(self, promiseFactory, attempts){
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
    function getServerManifestVersionJson(self) {
        var serverManifestVersionUrl = cacheBoostUrl(self,
            self.serverRoot + self.loaderFolderName + '/' + self.manifestVersionFileName);
        return wrapPromiseWithTimeout(self, pegasusAsync(serverManifestVersionUrl))
            .catch(function (err) {
                if (err.httpStatus !== 404) {
                    return Promise.reject(err);
                }
                console.log('404 for manifest-version.json means that it\'s deleted on server.'
                    + ' usually this happens at the start of the deployment process and'
                    + ' the file doesn\'t exist until deployment process is over.'
                    + ' it\'s required to restart the update process later.');
                var error = new Error('Server update is in progress. Please try again later.');
                error.type = 'tryAgainLater';
                error.innerError = err;
                throw error;
            });
    };

    /** gets fresh manifest.json from server */
    function getServerManifest(self) {
        var serverManifestUrl = cacheBoostUrl(self,
            self.serverRoot + self.loaderFolderName + '/' + self.manifestFileName);
        return wrapPromiseWithTimeout(self, pegasusAsync(serverManifestUrl));
    }

    /** if app/loader/manifest.json exists on device storage then returns its content otherwise returns null.
     * note: if synchronization with server has been run before 
     * then app/loader/manifest.json already exists on device storage.
    */
    function getStorageManifest(self) {
        return fs.read(self.storageRoot + self.loaderFolderName + '/' + self.manifestFileName).then(
            function (storageManifestContent) {
                debug(self, 'loaded manifest from storage.');
                var storageManifest = JSON.parse(storageManifestContent);
                return storageManifest;
            },
            function () {
                // if manifest does not exist on storage i don't want to reject because reject will reject Promise.all
                // i just resolve as null and handle it in Promise.all
                debug(self, 'storage manifest does not exist. yet.');
                return null;
            }
        );
        // i don't put timeout here because it's not a communication with a remote server, 
        // it's a local file, it shouldn't hang
    }

    /** gets manifest.json from application bundle */
    function getBundleManifest(self) {
        var bundleManifestUrl = self.manifestFileName;
        return new Promise(function (resolve, reject) {
            // bundle manifest is immutable, so it's fine to use value from cache
            if (self.bundleManifestContent) {
                resolve(self.bundleManifestContent);
            } else {
                pegasus(bundleManifestUrl).then(function (bundleManifestContent) {
                    // bundle manifest is immutable, so it's fine to cache it
                    self.bundleManifestContent = bundleManifestContent;
                    debug(self, 'loaded bundle manifest.');
                    resolve(bundleManifestContent);
                }, function () {
                    var message = 'Unexpected error. Bundle manifest not found.';
                    debug(self, message);
                    reject(new Error(message));
                });
            }
        });
        // i don't put timeout here because it's not a communication with a remote server, 
        // it's a local file, it shouldn't hang
    };

    // /**
    //  * returns an array of full paths for all files on device storage
    //  */
    // function listStorageFiles(self) {
    //     return fs.list(self.storageRoot, 'rfe').then(
    //         function (entries) {
    //             var fullPaths = entries.map(function (entry) {
    //                 var fullPath = fs.normalize(entry.fullPath);
    //                 return fullPath;
    //             });
    //             return fullPaths;
    //         },
    //         function () {
    //             // if for example folder doesn't exist then just return no files
    //             return [];
    //         }
    //     );
    // };

    /** returns true if there are updates available on server for sync */
    CordovaAppLoader.prototype.check = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            Promise.all(
                [getServerManifestVersionJson(self), getBundleManifest(self), getStorageManifest(self)]
            ).then(function ([serverManifestVersionJson, bundleManifest, storageManifest]) {
                // save bundleManifest, storageManifest to be reused later in CordovaAppLoader.prototype.download()
                self.bundleManifest = bundleManifest;
                self.storageManifest = storageManifest;// NB: can be null
                if (!serverManifestVersionJson || !serverManifestVersionJson.version) {
                    reject(new Error('Server manifest-version.json is broken.'));
                }
                var serverManifestVersion = serverManifestVersionJson.version;
                // if we already have up to date version then we don't need to update
                var dontNeedToSync = bundleManifest.version === serverManifestVersion
                    // storageManifest may be null if no updates were ever made.
                    || storageManifest && storageManifest.version === serverManifestVersion;
                resolve(!dontNeedToSync);
            }, function (err) {
                reject(err);
            });
        });
    };

    function hash(files) {
        var keys = Object.keys(files);
        keys.sort();
        var str = '';
        keys.forEach(function (key) {
            if (files[key] && files[key].version);
            str += '@' + files[key].version;
        });
        return CordovaFileCache.hash(str) + '';
    }

    /** wrapper for fs.download for better error handling */
    function fsDownload(from, to, onprogress) {
        return new Promise(function (resolve, reject) {
            fs.download(from, to, {}, onprogress).then(resolve,
                function (err) {
                    var error = new Error("Failed to download from [" + from + "] to [" + to + "]."
                        + "See innerError for details. Error: " + err);
                    error.innerError = err;
                    reject(error);
                }
            );
        });
    }

    /** wrapper for fs.write for better error handling */
    function fsWrite(path, content) {
        return new Promise(function (resolve, reject) {
            fs.write(path, content).then(resolve,
                function (err) {
                    var error = new Error("Failed to write to [" + to + "]."
                        + "See innerError for details. Error: " + err);
                    error.innerError = err;
                    reject(error);
                }
            );
        });
    }

    var downloadQueue;
    var downloadCounter = 0;
    var incompleteFiles = {};
    function addToDownloadQueue(self, fileName, onprogress, includeFileProgressEvents) {
        var from = cacheBoostUrl(self, self.serverRoot + fileName);
        var to = self.storageRoot + fileName;
        debug(self, "download from [" + from + "] to [" + to + "].");
        var onSingleFileProgress = !includeFileProgressEvents ? undefined : function (ev) {
            if (ev.loaded > 0 && ev.total > 0) {
                if (ev.loaded === ev.total) {// if loading finished
                    delete incompleteFiles[fileName]; // remove it from the list of incomplete files
                    return;// because it will be reported a bit later in resolved promise
                }
                incompleteFiles[fileName] = ev.loaded / ev.total;
                reportTotalProgress();
            }
        }
        function reportTotalProgress() {
            var ev = new ProgressEvent();
            ev.queueIndex = downloadCounter;
            ev.queueSize = downloadQueue.length;
            ev.url = from;
            ev.path = to;
            ev.percentage = downloadCounter / downloadQueue.length;
            if (includeFileProgressEvents) {
                Object.keys(incompleteFiles).forEach(incompleteFile => {
                    ev.percentage += incompleteFiles[incompleteFile] / downloadQueue.length;
                });
            }
            onprogress(ev);
        }
        var downloadPromise = fsDownload(from, to, onSingleFileProgress).then(function (result) {
            delete incompleteFiles[to];
            downloadCounter++;
            reportTotalProgress();
        });
        downloadQueue.push(downloadPromise);
    }

    var copyQueue;
    function addToCopyQueue(self, fileName) {
        var from = self.bundleRoot + fileName;
        var to = self.storageRoot + fileName;
        debug(self, "copy from [" + from + "] to [" + to + "].");
        var copyPromise = fsDownload(from, to);
        copyQueue.push(copyPromise);
    }

    var deleteQueue;
    function addToDeleteQueue(self, fullPath) {
        debug(self, "delete [" + fullPath + "].");
        var removePromise = fs.remove(fullPath);
        deleteQueue.push(removePromise);
    }

    /** pseudo code of the algorithm below:
     * if (server file exists in storage)
     * then { 
     *     1) remove it from the list of storage files, so that in the end the list of storage 
     *         files will have only items that we need to delete.
     *     2)  if (server file version doesn't match version on storage) {
     *             download update from server and replace the file
     *         }
     * } else { // server file doesn't exist on storage, but maybe we have it in the bundle
     *     if (server file exists in the bundle and version matches) {
     *         copy it from the bundle
     *     } else { // it's a new file that doesn't exist in the bundle
     *         download it from server
     *     }
     * }
     * delete all files that remain in the list of storage files, because we were deleting items from this
     * list while we were enumerating the list of server files.
     */
    function fillSyncQueues(self, bundleFileVersions, storageFileVersions, serverFileVersions,
        onprogress, includeFileProgressEvents) {
        downloadQueue = [];
        copyQueue = [];
        deleteQueue = [];
        Object.keys(serverFileVersions).forEach(serverFileName => {
            var serverFileVersion = serverFileVersions[serverFileName];
            var storageFileVersion = storageFileVersions[serverFileName];
            if (storageFileVersion) {
                delete storageFileVersions[serverFileName];
                if (serverFileVersion !== storageFileVersion) {
                    addToDownloadQueue(self, serverFileName, onprogress, includeFileProgressEvents);
                }
            } else {
                var bundleFileVersion = bundleFileVersions[serverFileName];
                if (bundleFileVersion === serverFileVersion) {
                    addToCopyQueue(self, serverFileName);
                } else {
                    addToDownloadQueue(self, serverFileName, onprogress, includeFileProgressEvents);
                }
            }
        });
        Object.keys(storageFileVersions).forEach(filePath => {
            addToDeleteQueue(self, filePath);
        });
    }

    /** check that manifest-version.json is same as it was before we started the update process.
     * if manifest-version.json is modified then we have to restart the update process.
     * if it's not modified then copy current server manifest to storage so that next time we will
     * be downloading only updates compared to current version.
     */
    function saveUpdatedManifest(self) {
        return getServerManifestVersionJson(self)
            .then(function (serverManifestVersionJson) {
                if (!serverManifestVersionJson || !serverManifestVersionJson.version) {
                    return Promise.reject(new Error('Server manifest-version.json is broken.'));
                }
                if (serverManifestVersionJson.version !== self.serverManifestBeforeDownload.version) {
                    var error = new Error('Server was updated during synchronization process.'
                        + ' Please try again.');
                    error.type = 'tryAgain';
                    return Promise.reject(error);
                }
                var manifestPath = self.storageRoot + self.loaderFolderName + '/' + self.manifestFileName;
                return fsWrite(manifestPath, JSON.stringify(self.serverManifestBeforeDownload));
            });
    }

    /** downloads updates from remote server */
    CordovaAppLoader.prototype.download = function (onprogress, includeFileProgressEvents) {
        var self = this;
        return getServerManifest(self)
            // Promise.all(
            //     [listStorageFiles(self), getServerManifest(self)]
            // )
            .then(function (serverManifest) {//([storageFileList, serverManifest]) {
                // save serverManifest so that at the end of the download process we check that it is not changed
                // because if it's changed then it means that server was updated while we were downloading files
                self.serverManifestBeforeDownload = serverManifest;
                // Check if new manifest is valid
                if (!serverManifest.files) {
                    return Promise.reject(new Error('Downloaded manifest doesn\'t have "files" attribute.'));
                }
                var serverFileVersions = serverManifest.files;
                if (!self.bundleManifest) {
                    return Promise.reject(new Error('Bundle manifest is missing.'
                        + ' loader.download should be called after loader.check!'));
                }
                var bundleFileVersions = self.bundleManifest.files;
                // NB: self.storageManifest can be null
                var storageFileVersions = self.storageManifest ? self.storageManifest.files : {};
                fillSyncQueues(self, bundleFileVersions, storageFileVersions, serverFileVersions,
                    onprogress, includeFileProgressEvents);
                return fs.ensure(self.storageRoot).then(
                    function () {
                        return Promise.all(downloadQueue.concat(copyQueue).concat(deleteQueue));
                    })
                    .then(function () {
                        return saveUpdatedManifest(self);
                    });
            });
    };

    /** returns file entry if file exists, null otherwise
     * @param {string} relativeFilePath - file path relative to storageRoot
     */
    CordovaAppLoader.prototype.storageFileExists = function (relativeFilePath) {
        var self = this;
        return fs.exists(self.storageRoot + relativeFilePath).then(
            function (fileEntry) {
                return fileEntry
            },
            function () {
                return null;
            });
    }

    // kind of "export"
    window.CordovaAppLoader = CordovaAppLoader;
})();