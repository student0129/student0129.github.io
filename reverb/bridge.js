// Runs at promontoryai.com/reverb/bridge.html, inside a hidden frame on ReVerb's own address. It
// answers that address — and only that address — with what this browser kept for ReVerb here, and
// erases it when asked. Any other site that frames this page gets nothing: every message is checked
// for where it came from, and every reply can only be delivered to ReVerb's address.
(function () {
    var HOME = 'https://reverb.promontoryai.com';
    if (window.parent === window) return;
    var keys = function () {
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf('reverb.') === 0) out.push(k);
            }
        } catch (e) { /* storage blocked */ }
        return out;
    };
    window.addEventListener('message', function (e) {
        if (e.origin !== HOME || e.source !== window.parent || !e.data) return;
        if (e.data.type === 'reverb-bridge-get') {
            var items = {};
            keys().forEach(function (k) { items[k] = localStorage.getItem(k); });
            window.parent.postMessage({ type: 'reverb-bridge-data', items: items }, HOME);
        } else if (e.data.type === 'reverb-bridge-clear') {
            keys().forEach(function (k) { try { localStorage.removeItem(k); } catch (err) { /* ignore */ } });
            window.parent.postMessage({ type: 'reverb-bridge-cleared' }, HOME);
        }
    });
    window.parent.postMessage({ type: 'reverb-bridge-ready' }, HOME);
})();
