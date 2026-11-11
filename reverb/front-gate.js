// ReVerb front page — decided before the page is drawn: which way in this visitor gets, from what
// this browser last heard about sign-in, or (first visit) nothing until the server says.
(function () {
    var h = document.documentElement, state = 'entry-wait';
    try {
        if (/(^#|&)signin=/.test(location.hash)) state = 'auth-arriving';
        else {
            var a = JSON.parse(localStorage.getItem('reverb.auth') || 'null');
            var signedIn = a && a.session && a.expiresAt > Date.now();
            var mode = localStorage.getItem('reverb.authMode');
            if (mode === 'off') state = 'auth-off';
            else if (mode === 'required' || mode === 'optional') state = signedIn ? 'auth-signed-in' : 'auth-' + mode;
        }
    } catch (e) { state = 'auth-off'; }
    h.classList.add(state);
    if (state === 'entry-wait') setTimeout(function () { h.classList.remove('entry-wait'); }, 4000);
})();
