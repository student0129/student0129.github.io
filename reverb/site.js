// Loaded first by every ReVerb page: where ReVerb lives, never running inside another site's
// frame, and clearing everything it keeps in this browser.

// Where ReVerb lives. It is moving from promontoryai.com/reverb to its own subdomain, so that its
// sign-in and saved meetings sit in storage no other page on promontoryai.com can read.
//
// `moved` is the switch. Until it is true, both addresses work and nothing is redirected. Once
// reverb.promontoryai.com is live, setting it to true sends every visit to the old address over
// to the same page there (the #fragment kept, so emailed sign-in links and recap links still
// work), and the old address's copy of each person's meetings is erased once it has been copied.
window.REVERB_SITE = {
    home: 'https://reverb.promontoryai.com',
    legacy: 'https://promontoryai.com',
    moved: false,
};
(function () {
    var site = window.REVERB_SITE;
    if (!site.moved) return;
    if (location.hostname !== 'promontoryai.com' && location.hostname !== 'www.promontoryai.com') return;
    var path = location.pathname.replace(/^\/reverb(\/|$)/, '/');
    if (/\/bridge\.html$/.test(path)) return;      // the bridge has to stay where the old data is
    location.replace(site.home + path + location.search + location.hash);
})();

// Never inside another site's frame. A site that could frame ReVerb could lay its own page over it
// and trick a click on Start, Share or Clear. The header that forbids framing can't be sent from
// GitHub Pages, so the page refuses instead: it hides, and asks to take over the whole window.
(function () {
    if (/\/recap\//.test(location.pathname)) return;     // a recap is only text: embedding one is fine
    var topOrigin = null;
    try {
        if (window.top === window.self) return;
        topOrigin = window.top.location.origin;          // throws when the frame is another site's
    } catch (e) { /* another site */ }
    if (topOrigin === location.origin) return;
    document.documentElement.style.setProperty('display', 'none', 'important');
    try { window.top.location.replace(location.href); } catch (e) { /* refused without a click; stays hidden */ }
})();

// Everything ReVerb keeps in this browser, gone in one go — for a shared computer. Two things stay,
// because neither is about anyone: whether the server asks for sign-in, and whether the move to
// the new address has run (without it, the move would copy the old meetings straight back).
(function () {
    var KEEP = { 'reverb.authMode': true, 'reverb.migrated': true };
    var SIGNAL = 'reverb.cleared';
    function keysIn(store) {
        var keys = [];
        for (var i = 0; i < store.length; i++) {
            var key = store.key(i);
            if (key && key.indexOf('reverb.') === 0 && !KEEP[key] && key !== SIGNAL) keys.push(key);
        }
        return keys;
    }
    function each(fn) {
        try { fn(localStorage); } catch (e) { /* storage blocked */ }
        try { fn(sessionStorage); } catch (e) { /* storage blocked */ }
    }
    window.REVERB_SITE.storedKeys = function () {
        var keys = [];
        each(function (store) { keys = keys.concat(keysIn(store)); });
        return keys;
    };
    // `quiet` is for a tab that is already reacting to the signal: no need to send it again.
    window.REVERB_SITE.clearBrowser = function (quiet) {
        each(function (store) { keysIn(store).forEach(function (key) { store.removeItem(key); }); });
        if (quiet) return;
        // Another ReVerb tab open in this browser would write its meeting straight back. Setting a
        // key tells every other tab (a 'storage' event); the app hears it, ends without saving and
        // leaves. Removed at once, so nothing of it stays behind.
        try { localStorage.setItem(SIGNAL, String(Date.now())); localStorage.removeItem(SIGNAL); } catch (e) { /* storage blocked */ }
    };
    window.REVERB_SITE.clearedSignal = SIGNAL;
})();
