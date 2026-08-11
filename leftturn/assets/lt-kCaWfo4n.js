import { e as createAstro, c as createComponent, a as renderTemplate, r as renderComponent, F as Fragment, b as addAttribute, m as maybeRenderHead, f as renderSlot, g as renderHead } from './lt-C34taNvD.js';
import 'piccolore';
import { u } from './lt-Dqwc0ORQ.js';
import { $ as $$Arrow } from './lt-4YF-tGDJ.js';
import 'clsx';
/* empty css            */

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$Astro$2 = createAstro("https://promontoryai.com");
const $$BaseHead = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$2, $$props, $$slots);
  Astro2.self = $$BaseHead;
  const { title, description, citation, type = "website" } = Astro2.props;
  const canonical = new URL(Astro2.url.pathname, Astro2.site);
  const full = title === "Left Turn" ? title : `${title} \u2014 Left Turn`;
  const fmt = (d) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  return renderTemplate(_a || (_a = __template(['<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>', '</title><meta name="description"', '><link rel="canonical"', '><meta property="og:type"', '><meta property="og:title"', '><meta property="og:description"', '><meta property="og:site_name" content="Left Turn"><meta property="og:url"', '><meta name="twitter:card" content="summary_large_image"><link rel="alternate" type="application/rss+xml" title="Left Turn"', `><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 52'%3E%3Cpath d='M52 52V26q0-11-11-11H22' fill='none' stroke='%23d81e28' stroke-width='11'/%3E%3Cpolygon points='25,1 25,29 3,15' fill='%23d81e28'/%3E%3C/svg%3E"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:ital,wght@0,400;0,600;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">`, "<script>\n  (() => {\n    try {\n      const t = localStorage.getItem('lt:theme');\n      if (t) document.documentElement.dataset.theme = t;\n      const s = localStorage.getItem('lt:typesize');\n      if (s) document.documentElement.dataset.typesize = s;\n    } catch {}\n  })();\n<\/script>"])), full, addAttribute(description, "content"), addAttribute(canonical, "href"), addAttribute(type, "content"), addAttribute(full, "content"), addAttribute(description, "content"), addAttribute(canonical, "content"), addAttribute(u("/rss.xml"), "href"), citation && renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result2) => renderTemplate`<meta name="citation_title"${addAttribute(citation.title, "content")}>${citation.authors.map((a) => renderTemplate`<meta name="citation_author"${addAttribute(a, "content")}>`)}<meta name="citation_journal_title"${addAttribute(citation.journal, "content")}><meta name="citation_volume"${addAttribute(String(citation.volume), "content")}><meta name="citation_issue"${addAttribute(citation.issue, "content")}><meta name="citation_publication_date"${addAttribute(fmt(citation.date), "content")}>${citation.firstPage && renderTemplate`<meta name="citation_firstpage"${addAttribute(String(citation.firstPage), "content")}>`}${citation.lastPage && renderTemplate`<meta name="citation_lastpage"${addAttribute(String(citation.lastPage), "content")}>`}<meta name="citation_public_url"${addAttribute(canonical.toString(), "content")}>` })}`);
}, "/Users/home/left-turn/src/components/BaseHead.astro", void 0);

const $$Astro$1 = createAstro("https://promontoryai.com");
const $$Header = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$1, $$props, $$slots);
  Astro2.self = $$Header;
  const path = Astro2.url.pathname;
  const on = (p) => path === p || p !== "/" && path.startsWith(p) ? "page" : void 0;
  return renderTemplate`${maybeRenderHead()}<header class="masthead"> <div class="shell masthead__bar"> <a class="masthead__logo"${addAttribute(u("/"), "href")} aria-label="Left Turn — home"> ${renderComponent($$result, "Arrow", $$Arrow, {})} <span> <span class="masthead__word">Left Turn</span> <span class="masthead__tag">A Quarterly Journal of Critical Voices</span> </span> </a> <nav class="nav" aria-label="Primary"> <a${addAttribute(u("/issues/"), "href")}${addAttribute(on("/issues"), "aria-current")}>Issues</a> <a${addAttribute(u("/articles/"), "href")}${addAttribute(on("/articles"), "aria-current")}>Articles</a> <a${addAttribute(u("/topics/"), "href")}${addAttribute(on("/topics"), "aria-current")}>Topics</a> <a${addAttribute(u("/authors/"), "href")}${addAttribute(on("/authors"), "aria-current")}>Contributors</a> <a${addAttribute(u("/about/"), "href")}${addAttribute(on("/about"), "aria-current")}>About</a> <a${addAttribute(u("/search/"), "href")}${addAttribute(on("/search"), "aria-current")} aria-label="Search">Search</a> <a class="nav__cta"${addAttribute(u("/subscribe/"), "href")}>Subscribe</a> </nav> </div> </header>`;
}, "/Users/home/left-turn/src/components/Header.astro", void 0);

const $$Footer = createComponent(($$result, $$props, $$slots) => {
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  return renderTemplate`${maybeRenderHead()}<footer class="foot"> <div class="shell"> <div class="foot__cols"> <div> <h3>Read</h3> <ul> <li><a${addAttribute(u("/issues/"), "href")}>All issues</a></li> <li><a${addAttribute(u("/articles/"), "href")}>All articles</a></li> <li><a${addAttribute(u("/topics/"), "href")}>Topics</a></li> <li><a${addAttribute(u("/authors/"), "href")}>Contributors</a></li> <li><a${addAttribute(u("/rss.xml"), "href")}>RSS feed</a></li> </ul> </div> <div> <h3>Take part</h3> <ul> <li><a${addAttribute(u("/subscribe/"), "href")}>Subscribe &amp; donate</a></li> <li><a${addAttribute(u("/submissions/"), "href")}>Submit an article</a></li> <li><a${addAttribute(u("/events/"), "href")}>Weekly discussions</a></li> <li><a${addAttribute(u("/about/"), "href")}>About &amp; masthead</a></li> </ul> </div> <div> <h3>Beyond Capitalism</h3> <p style="line-height:1.6"> <em>Left Turn</em> is sponsored by the Beyond Capitalism group of the Alliance for
          Sustainable Communities&thinsp;–&thinsp;Lehigh Valley.
</p> <p style="margin-top:.6rem"> <a class="u" href="mailto:leftturn@sustainlv.org">leftturn@sustainlv.org</a> </p> </div> <div> <h3>Reuse</h3> <p style="line-height:1.6">
Licensed <a class="u" href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>. Republish freely, non-commercially, with attribution and the same licence.
</p> </div> </div> <p class="foot__legal">
&copy; ${year} Alliance for Sustainable Communities — Lehigh Valley. Individual works are also
      subject to copyright by the author. Contributed work does not necessarily represent the views
      of the Alliance.
</p> </div> </footer>`;
}, "/Users/home/left-turn/src/components/Footer.astro", void 0);

const $$Astro = createAstro("https://promontoryai.com");
const $$Base = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Base;
  const { title, description, citation, type } = Astro2.props;
  return renderTemplate`<html lang="en"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": title, "description": description, "citation": citation, "type": type })}${renderSlot($$result, $$slots["head"])}${renderHead()}</head> <body> <a class="skip" href="#main">Skip to content</a> ${renderComponent($$result, "Header", $$Header, {})} <main id="main"> ${renderSlot($$result, $$slots["default"])} </main> ${renderComponent($$result, "Footer", $$Footer, {})} </body></html>`;
}, "/Users/home/left-turn/src/layouts/Base.astro", void 0);

export { $$Base as $ };
