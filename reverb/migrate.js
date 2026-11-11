// On the first visit to ReVerb's own address, bring over what this browser kept for it at the old
// one — saved meetings, past meetings, the brief, the sign-in — through a small bridge page served
// from the old address. Nothing that already exists here is overwritten. Once the move is final
// (REVERB_SITE.moved), the old address's copy is erased, so no page there can read it any more.
// The page stays hidden while this happens (a second or two, once) and then reloads.
(function () {
    var site = window.REVERB_SITE;
    if (!site || location.origin !== site.home) return;
    var state;
    try { state = localStorage.getItem('reverb.migrated'); } catch (e) { return; }
    if (state === 'done' || (state === 'copied' && !site.moved)) return;

    var root = document.documentElement;
    root.classList.add('migrating');
    var frame = document.createElement('iframe');
    var finished = false;
    var finish = function () {
        if (finished) return;
        finished = true;
        try { localStorage.setItem('reverb.migrated', site.moved ? 'done' : 'copied'); } catch (e) { /* ignore */ }
        location.reload();
    };
    // A bridge that never answers (blocked, offline) must not hold the page hostage.
    var timer = setTimeout(finish, 3500);

    window.addEventListener('message', function (e) {
        if (e.origin !== site.legacy || !e.data || e.source !== frame.contentWindow) return;
        if (e.data.type === 'reverb-bridge-ready') {
            frame.contentWindow.postMessage({ type: 'reverb-bridge-get' }, site.legacy);
        } else if (e.data.type === 'reverb-bridge-data') {
            var items = e.data.items || {};
            for (var key in items) {
                if (!Object.prototype.hasOwnProperty.call(items, key) || key.indexOf('reverb.') !== 0 || key === 'reverb.migrated') continue;
                try { if (localStorage.getItem(key) === null) localStorage.setItem(key, String(items[key])); } catch (err) { /* full */ }
            }
            if (site.moved) frame.contentWindow.postMessage({ type: 'reverb-bridge-clear' }, site.legacy);
            else { clearTimeout(timer); finish(); }
        } else if (e.data.type === 'reverb-bridge-cleared') {
            clearTimeout(timer);
            finish();
        }
    });
    frame.src = site.legacy + '/reverb/bridge.html';
    frame.title = 'ReVerb data bridge';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.display = 'none';
    root.appendChild(frame);
})();
