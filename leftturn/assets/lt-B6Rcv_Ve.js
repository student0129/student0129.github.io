import { e as createAstro, c as createComponent, m as maybeRenderHead, b as addAttribute, a as renderTemplate } from './lt-C34taNvD.js';
import 'piccolore';
import 'clsx';
import { u } from './lt-Dqwc0ORQ.js';
import { b as bylineNames, K as KIND_LABEL, j as joinNames } from './lt-BjGuazmd.js';

const $$Astro = createAstro("https://promontoryai.com");
const $$ArticleCard = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$ArticleCard;
  const { article, showSummary = true } = Astro2.props;
  const names = await bylineNames(article);
  const d = article.data;
  return renderTemplate`${maybeRenderHead()}<a class="card"${addAttribute(u(`/articles/${article.id}/`), "href")}> <span class="kind"${addAttribute(d.kind, "data-kind")}>${KIND_LABEL[d.kind]}</span> <h3>${d.title}</h3> ${names.length > 0 && renderTemplate`<p class="byline">by <strong>${joinNames(names)}</strong></p>`} ${showSummary && renderTemplate`<p style="margin-top:.4rem">${d.summary}</p>`} </a>`;
}, "/Users/home/left-turn/src/components/ArticleCard.astro", void 0);

export { $$ArticleCard as $ };
