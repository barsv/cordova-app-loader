'use strict';
(function(){
    var errorElement = document.getElementById('error');
    var statusElement = document.getElementById('status');
    var errorTextElement = document.getElementById('error-text');

    var showError = function(error) {
        statusElement.style.display = 'none';
        errorElement.style.display = 'block';
        errorTextElement.innerHTML = error.message || error;
    }

    var showStatus = function() {
        errorElement.style.display = 'none';
        statusElement.style.display = 'block';
    }

    var check = function() {
        var loader = new CordovaAppLoader({
            serverRoot: 'http://localhost:3000/',
            debug: true
        });
        loader.check()
        .then(function(m) {
            setTimeout(function(){
                showError('Timeout :)');
            }, 3*1000);
        })
        .catch(function(e){
            showError(e);
        });
    }

    check();

    document.getElementById('try-again').onclick = function () {
        showStatus();
        check();
    }
})();