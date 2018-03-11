'use strict';
(function () {
    /** indexHtml - file in www directory that launches main application. the one that was specified in config.xml 
     * in <content src=""/> before it was replaced with 'cordova-app-loader/update.html'
     * */
    var indexHtml = 'index.html';
    /** path to cordova-app-loader dir relative to www */
    var cordovaAppLoaderDir = 'cordova-app-loader';

    var errorElement = document.getElementById('error');
    var statusElement = document.getElementById('status');
    var errorTextElement = document.getElementById('error-text');
    var stepElement = document.getElementById('step');
    var progressElement = document.getElementById('progress');

    var showError = function (error) {
        statusElement.style.display = 'none';
        errorElement.style.display = 'block';
        errorTextElement.innerHTML = error.message || error;
    }

    var showStatus = function () {
        errorElement.style.display = 'none';
        statusElement.style.display = 'block';
        showStep1();
    }

    var showStep1 = function () {
        progressElement.style.display = 'none';
        stepElement.innerHTML = 'Step 1/3';
    }

    var showStep2 = function (progress) {
        progressElement.style.display = 'inline';
        stepElement.innerHTML = 'Step 2/3';
        progressElement.innerHTML = " - " + progress + '%';
    }

    var showStep3 = function (progress) {
        progressElement.style.display = 'none';
        stepElement.innerHTML = 'Step 3/3';
    }

    var sync = function () {
        showStatus();
        var loader = new CordovaAppLoader({
            serverRoot: 'http://localhost:3000/www/',
            debug: true
        });
        // step 1/3 - check
        // step 2/3 - sync if needed
        // step 3/3 - redirect to index.html
        loader.check()
            .then(function (needUpdate) {
                if (!needUpdate)
                    return false;
                showStep2(0);
                return loader.download(function (progress) {
                    showStep2(Math.round(progress.percentage * 100));
                }, true);
            })
            .then(function(){
                showStep3();
                return loader.storageFileExists(indexHtml);
            })
            .then(function (fileEntry) {
                if (fileEntry) {
                    // files were copied by update to phone storage,
                    // launch from phone storage to run on updated assets
                    window.location = fileEntry.toURL();
                } else {
                    // there were no updates so far and index.html wasn't copied to 
                    // phone storage yet, hence launch from assets embedded into binary
                    window.location = window.location.href.replace(cordovaAppLoaderDir + '/update.html', indexHtml);
                }
            })
            .catch(function (e) {
                showError(e);
            });
    }

    sync();

    document.getElementById('try-again').onclick = function () {
        sync();
    }
})();