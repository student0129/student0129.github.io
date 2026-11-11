// ReVerb app — runs before anything is drawn: someone who has to sign in first is sent to do it
// without the app flashing up on the way.
(function () {
    if (document.documentElement.classList.contains('migrating')) return;   // reloads with the sign-in in place
    try {
        var a = JSON.parse(localStorage.getItem('reverb.auth') || 'null');
        if (a && a.session && a.expiresAt > Date.now()) return;
        var mode = localStorage.getItem('reverb.authMode');
        if (mode === 'required') { location.replace('../#signin-required'); return; }
        if (mode !== 'off' && mode !== 'optional') {
            document.documentElement.classList.add('auth-pending');
            setTimeout(function () { document.documentElement.classList.remove('auth-pending'); }, 4000);
        }
    } catch (e) { /* storage blocked: the server still checks every request */ }
})();
