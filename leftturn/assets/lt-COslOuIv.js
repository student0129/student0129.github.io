import { e as createAstro, c as createComponent, r as renderComponent, a as renderTemplate, m as maybeRenderHead } from './lt-C34taNvD.js';
import 'piccolore';
import { u } from './lt-Dqwc0ORQ.js';
import { $ as $$Arrow } from './lt-4YF-tGDJ.js';
import { f as issueLabel } from './lt-BjGuazmd.js';

const $$Astro = createAstro("https://promontoryai.com");
const $$Cover = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Cover;
  const { issue, linked = true } = Astro2.props;
  const Tag = linked ? "a" : "div";
  return renderTemplate`<!-- The cover is regenerated from issue metadata rather than stored as a
     flat scan, so every back issue gets a consistent, legible, selectable
     plate — and a new issue needs no design work to appear in the archive. -->${renderComponent($$result, "Tag", Tag, { "class": "cover", "href": linked ? u(`/issues/${issue.id}/`) : void 0 }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="cover__band"> <span class="v">${issueLabel(issue)}</span> <span class="t">Left Turn</span> <span class="s">A Quarterly Journal of Critical Voices</span> </div> <div class="cover__arrow">${renderComponent($$result2, "Arrow", $$Arrow, { "variant": "full" })}</div> <div class="cover__foot"> <span>${issue.data.season}</span> <span>${issue.data.year}</span> </div> ` })}`;
}, "/Users/home/left-turn/src/components/Cover.astro", void 0);

export { $$Cover as $ };
