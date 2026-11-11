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
