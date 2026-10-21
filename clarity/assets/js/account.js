/* ==========================================================================
   Clarity — the pages that Clarity's emails open: verify/ and reset/.

   The email link carries a single-use token after "#". Browsers never send
   that part to this site's server, so only this script and the Clarity API
   ever see it. The API address is fixed here on purpose: if a link could
   name it, a crafted link could send someone's token elsewhere.
   ========================================================================== */

(function () {
  'use strict';

  var API = 'https://clarity-api.promontoryai.com';
  var page = document.body.getAttribute('data-page');
  var token = location.hash.slice(1);
  var tokenLooksRight = /^[0-9a-f]{32,256}$/i.test(token);

  /** Shows the section with data-state="name" and hides the others. */
  function show(name) {
    var sections = document.querySelectorAll('[data-state]');
    for (var i = 0; i < sections.length; i++) {
      sections[i].hidden = sections[i].getAttribute('data-state') !== name;
    }
  }

  /** POSTs JSON; resolves { status, body }. Rejects only when the API can't be reached. */
  function post(path, payload) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    });
  }

  // ── verify/ ──────────────────────────────────────────────────────────────

  function verify() {
    show('working');
    post('/api/verify-email', { token: token }).then(function (r) {
      if (r.status === 200) show(r.body.alreadyVerified ? 'already' : 'done');
      else if (r.status === 400) show('expired');
      else show('offline');
    }, function () {
      show('offline');
    });
  }

  // ── reset/ ───────────────────────────────────────────────────────────────

  function reset() {
    // The token stays usable until the password is set, so keep it out of the
    // address bar, history and any screenshot. It lives on in `token`.
    history.replaceState(null, '', location.pathname + location.search);

    var form = document.getElementById('reset-form');
    var password = document.getElementById('password');
    var confirm = document.getElementById('confirm');
    var alert = document.getElementById('reset-alert');
    var button = form.querySelector('button[type="submit"]');

    function fail(message) {
      alert.textContent = message;
      alert.hidden = false;
      button.disabled = false;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      alert.hidden = true;
      var value = password.value;

      // The server applies the same rules; checking here saves a round trip.
      if (value.length < 10) return fail('Use at least 10 characters.');
      if (value.length > 128) return fail('Use at most 128 characters.');
      if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return fail('Include at least one letter and one number.');
      if (confirm.value !== value) return fail("Those passwords don't match.");

      button.disabled = true;
      post('/api/reset-password', { token: token, password: value }).then(function (r) {
        if (r.status === 200) return show('done');
        var errors = r.body.errors || [];
        var passwordError = errors.filter(function (e) { return e.path === 'password'; })[0];
        if (passwordError) return fail(passwordError.msg);
        if (r.status === 400) return show('expired');
        if (r.status === 429 && r.body.message) return fail(r.body.message);
        fail('Something went wrong on our side. Try again in a minute.');
      }, function () {
        fail("We couldn't reach Clarity. Check your connection and try again.");
      });
    });

    show('form');
  }

  // Opening another emailed link in a tab that already shows this page only
  // changes the part after "#", which doesn't reload it. Start over for it.
  window.addEventListener('hashchange', function () { location.reload(); });

  if (!tokenLooksRight) {
    show('missing');
  } else if (page === 'verify') {
    document.getElementById('retry').addEventListener('click', verify);
    verify();
  } else if (page === 'reset') {
    reset();
  }
})();
