import { e as createAstro, c as createComponent, m as maybeRenderHead, b as addAttribute, a as renderTemplate } from './lt-C34taNvD.js';
import 'piccolore';
import 'clsx';

const $$Astro = createAstro("https://promontoryai.com");
const $$Arrow = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Arrow;
  const { variant = "mark", class: cls = "" } = Astro2.props;
  const uid = Math.random().toString(36).slice(2, 8);
  const SPINE = "M 700 620 L 700 340 Q 700 208 566 208 L 250 208";
  const HEAD_OUTER = "252,46 252,370 44,208";
  const HEAD_INNER = "268,78 268,338 82,208";
  return renderTemplate`${variant === "full" ? renderTemplate`${maybeRenderHead()}<svg${addAttribute(cls, "class")} viewBox="0 0 800 620" role="img" aria-label="A broad arrow curving up from below and turning left"><defs><pattern${addAttribute(`stipple-${uid}`, "id")} width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.5" fill="currentColor" opacity="0.5"></circle><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" opacity="0.5"></circle></pattern></defs><path${addAttribute(SPINE, "d")} fill="none" stroke="currentColor" stroke-width="126"></path><polygon${addAttribute(HEAD_OUTER, "points")} fill="currentColor"></polygon><path${addAttribute(SPINE, "d")} fill="none" stroke="var(--paper, #fff)" stroke-width="112"></path><polygon${addAttribute(HEAD_INNER, "points")} fill="var(--paper, #fff)"></polygon><path${addAttribute(SPINE, "d")} fill="none"${addAttribute(`url(#stipple-${uid})`, "stroke")} stroke-width="112"></path><polygon${addAttribute(HEAD_INNER, "points")}${addAttribute(`url(#stipple-${uid})`, "fill")}></polygon></svg>` : renderTemplate`<svg${addAttribute(cls, "class")} viewBox="0 0 64 52" role="img" aria-label="Left Turn"><path d="M 52 52 L 52 26 Q 52 15 41 15 L 22 15" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="butt"></path><polygon points="25,1 25,29 3,15" fill="currentColor"></polygon></svg>`}`;
}, "/Users/home/left-turn/src/components/Arrow.astro", void 0);

export { $$Arrow as $ };
