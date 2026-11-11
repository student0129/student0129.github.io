// ReVerb front page — sign-in when the server asks for it, and the way back to an unfinished meeting.
// Sign-in, when the server asks for it. Off by default: the page then reads exactly as it did,
// one button straight into the app. When it is on, the server emails a link back to this page
// (#signin=…); the page trades it for a session the app sends with every request.
(() => {
    const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin : 'https://api-promontory.onrender.com';
    const AUTH_KEY = 'reverb.auth';
    const $ = (id) => document.getElementById(id);
    const post = (path, body) => fetch(`${API_BASE}/api/reverb/auth/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));
    const readAuth = () => {
        try {
            const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
            return a && a.session && a.expiresAt > Date.now() ? a : null;
        } catch (err) { return null; }
    };
    const message = (text, error, link) => {
        const msg = $('signin-msg');
        msg.hidden = !text;
        msg.className = 'signin__msg' + (error ? ' error' : '');
        msg.textContent = text || '';
        if (link) {
            const a = document.createElement('a');
            a.href = link;
            a.textContent = ' Open the link (test mode)';
            msg.append(a);
        }
    };

    const STATES = ['entry-wait', 'auth-off', 'auth-optional', 'auth-required', 'auth-signed-in', 'auth-arriving'];
    function setState(state) {
        const h = document.documentElement;
        h.classList.remove(...STATES);
        h.classList.add(state);
        // Required and signed out: the calls to action lead to the form, not to the app.
        for (const a of document.querySelectorAll('a.cta, #open-app')) {
            a.setAttribute('href', state === 'auth-required' ? '#entry' : 'app/');
        }
    }

    function showSignedIn(auth) {
        setState('auth-signed-in');
        const line = $('who-line');
        line.replaceChildren(`Signed in as ${auth.email} · `);
        const out = document.createElement('button');
        out.type = 'button';
        out.textContent = 'Sign out';
        out.addEventListener('click', () => {
            try { localStorage.removeItem(AUTH_KEY); } catch (err) { /* ignore */ }
            location.reload();
        });
        line.append(out);
        line.hidden = false;
    }

    function askToSignIn(required) {
        setState(required ? 'auth-required' : 'auth-optional');
    }

    // The emailed link opened in a tab already showing this page changes only the #fragment.
    window.addEventListener('hashchange', () => { if (/(^#|&)signin=/.test(location.hash)) location.reload(); });

    $('signin').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('signin-email').value.trim();
        if (!email) { $('signin-email').focus(); return; }
        $('signin-send').disabled = true;
        message('Sending…');
        try {
            const { ok, data } = await post('start', { email });
            // The same reply for every address: the page can't tell, and shouldn't say, who is on the list.
            if (ok) message(`If ${email} can use ReVerb, a sign-in link is on its way — it works for 15 minutes. Nothing after a few minutes? Check spam, or ask whoever invited you to add this address.`, false, data.link);
            else message(data.error || 'Couldn’t send the link. Try again in a moment.', true);
        } catch (err) { message('Couldn’t reach ReVerb. Check your connection and try again.', true); }
        $('signin-send').disabled = false;
    });

    (async () => {
        // Arrived from the emailed link.
        const token = new URLSearchParams(location.hash.slice(1)).get('signin');
        if (token) {
            history.replaceState(null, '', location.pathname + location.search);
            setState('auth-arriving');
            message('Signing you in…');
            try {
                const { ok, data } = await post('verify', { token });
                if (ok && data.session) {
                    localStorage.setItem(AUTH_KEY, JSON.stringify({ session: data.session, email: data.email, expiresAt: data.expiresAt }));
                    location.replace('app/');
                    return;
                }
                message(data.error || 'That link didn’t work. Ask for a new one.', true);
            } catch (err) { message('Couldn’t reach ReVerb to finish signing in. Try the link again.', true); }
        }

        let mode = null;
        try {
            const r = await fetch(`${API_BASE}/api/reverb/auth/config`, { signal: AbortSignal.timeout(4000) });
            if (r.ok) mode = (await r.json()).mode || 'off';
            // Remembered for the next visit, here and in the app, so neither waits to decide.
            if (mode) try { localStorage.setItem('reverb.authMode', mode); } catch (err) { /* ignore */ }
        } catch (err) { /* unreachable: keep what this browser last knew */ }
        if (!mode) {
            if (document.documentElement.classList.contains('entry-wait')) setState('auth-off');
            return;
        }
        if (mode === 'off') { setState('auth-off'); return; }
        const auth = readAuth();
        if (auth) { showSignedIn(auth); return; }
        askToSignIn(mode === 'required' || location.hash === '#signin-required');
        if (location.hash === '#signin-required') message('Sign in to use ReVerb.');
    })();
})();

// A meeting left unfinished — a closed tab, a crash — is still saved in this browser. Say so
// here, so the way back to it is the first thing on the page rather than a surprise inside.
// Mirrors what the app looks for: one save per tab, and nothing older than two weeks.
(() => {
    const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
    let best = null;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || (key !== 'reverb.transcript' && !key.startsWith('reverb.transcript.'))) continue;
            const data = JSON.parse(localStorage.getItem(key) || 'null');
            if (!data || !Array.isArray(data.segments) || !data.segments.length) continue;
            if (Date.now() - (data.savedAt || 0) > MAX_AGE_MS) continue;
            if (!best || (data.savedAt || 0) > (best.savedAt || 0)) best = data;
        }
    } catch (err) { return; }   // storage blocked: nothing to offer
    if (!best) return;

    const when = new Date(best.savedAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const lines = best.segments.length;
    const objective = best.brief && typeof best.brief.objective === 'string' ? best.brief.objective.trim() : '';
    const text = document.getElementById('resume-text');
    const strong = document.createElement('b');
    strong.textContent = objective ? `“${objective.length > 80 ? objective.slice(0, 79) + '…' : objective}”` : 'An unfinished session';
    text.append(strong, ` from ${when} (${lines} line${lines === 1 ? '' : 's'}) is still saved in this browser.`);
    document.getElementById('resume').hidden = false;
    document.getElementById('open-label').textContent = 'Pick up where you left off';
})();

// On a shared computer: everything ReVerb keeps in this browser, gone in one go — the meeting in
// progress, past meetings, settings and the sign-in. Offered only when there is something to clear.
(() => {
    const site = window.REVERB_SITE;
    if (!site || !site.clearBrowser) return;
    const done = () => { history.replaceState(null, '', location.pathname + location.search + '#cleared'); location.reload(); };
    if (location.hash === '#cleared') {
        history.replaceState(null, '', location.pathname + location.search);
        document.getElementById('clear-done').hidden = false;
    }
    // Cleared from another tab: this page's resume offer and sign-in line are out of date.
    window.addEventListener('storage', (e) => { if (e.key === site.clearedSignal && e.newValue) done(); });
    if (!site.storedKeys().length) return;
    document.getElementById('clear-line').hidden = false;
    document.getElementById('clear-browser').addEventListener('click', () => {
        const sure = confirm('Clear ReVerb from this browser?\n\n'
            + 'This removes the meeting in progress, past meetings, your settings and your sign-in. '
            + 'A meeting open in another ReVerb tab ends too. Recordings you saved as files stay where you saved them.\n\n'
            + 'This can’t be undone.');
        if (!sure) return;
        site.clearBrowser();
        done();
    });
})();
