(function(){
    var error = document.getElementById('error');
    var status = document.getElementById('status');

    var showError = function() {
        status.style.display = 'none';
        error.style.display = 'block';
    }

    var showStatus = function() {
        error.style.display = 'none';
        status.style.display = 'block';
    }

    var check = function() {
        setTimeout(function(){
            showError();
        }, 3*1000);
    }

    check();

    document.getElementById('try-again').onclick = function () {
        showStatus();
        check();
    }
})();