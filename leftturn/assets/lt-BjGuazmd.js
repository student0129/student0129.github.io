import { a as getEntry, g as getCollection } from './lt-BVyQR4iD.js';

const KIND_LABEL = {
  essay: "Essay",
  testimony: "Testimony",
  document: "Document",
  dossier: "Dossier",
  commentary: "Commentary",
  poetry: "Poetry",
  interstitial: "Interstitial"
};
async function allArticles() {
  const list = await getCollection("articles", ({ data }) => !data.draft);
  return list.sort(
    (a, b) => b.data.publishedDate.getTime() - a.data.publishedDate.getTime() || a.data.order - b.data.order
  );
}
async function articlesInIssue(issueId) {
  const list = await getCollection("articles", ({ data }) => !data.draft && data.issue.id === issueId);
  return list.sort((a, b) => a.data.order - b.data.order);
}
async function notesInIssue(issueId) {
  const list = await getCollection("notes", ({ data }) => data.issue.id === issueId);
  const seq = (n) => n.data.order ?? Number(n.id.split("/").pop()?.match(/^(\d+)/)?.[1] ?? 999);
  return list.sort((a, b) => seq(a) - seq(b));
}
async function currentIssue() {
  const issues = await getCollection("issues");
  return issues.find((i) => i.data.current) ?? issues.sort((a, b) => b.data.publishedDate.getTime() - a.data.publishedDate.getTime())[0];
}
async function allIssues() {
  const issues = await getCollection("issues");
  return issues.sort((a, b) => b.data.publishedDate.getTime() - a.data.publishedDate.getTime());
}
async function bylineNames(a) {
  const names = [];
  for (const ref of a.data.authors) {
    const author = await getEntry(ref);
    if (author) names.push(author.data.name);
  }
  if (a.data.corporateAuthor) names.push(a.data.corporateAuthor);
  return names;
}
function joinNames(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
function invertName(name) {
  if (!name.includes(" ")) return name;
  const parts = name.split(" ");
  const last = parts.pop();
  return `${last}, ${parts.join(" ")}`;
}
function inlineMarkdown(s) {
  const escaped = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/_([^_]+)_/g, "<em>$1</em>");
}
function stripMarkdown(s) {
  return s.replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/_([^_]+)_/g, "$1");
}
function readingTime(body) {
  if (!body) return 0;
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}
function pageRange(a) {
  const { startPage, endPage } = a.data;
  if (!startPage) return null;
  return endPage && endPage !== startPage ? `${startPage}–${endPage}` : String(startPage);
}
function issueLabel(i) {
  return `Vol. ${i.data.volume}, No. ${i.data.number}`;
}
async function topicIndex() {
  const [list, vocab] = await Promise.all([allArticles(), getCollection("topics")]);
  const counts = /* @__PURE__ */ new Map();
  for (const a of list) for (const t of a.data.topics) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  return vocab.filter((t) => !t.data.aliasOf).map((t) => ({
    slug: t.id,
    name: t.data.name,
    description: t.data.description,
    count: counts.get(t.id) ?? 0
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
async function topicsOf(a) {
  const out = [];
  for (const ref of a.data.topics) {
    const t = await getEntry(ref);
    if (t) out.push({ slug: t.id, name: t.data.name });
  }
  return out;
}
function citations(opts) {
  const { names, title, volume, number, season, year, pages, url } = opts;
  const inverted = names.length ? invertName(names[0]) : "Left Turn";
  const rest = names.slice(1);
  const chicagoAuthors = [inverted, ...rest].join(", ");
  const apaAuthors = names.length ? names.map((n) => {
    const p = n.split(" ");
    if (p.length < 2) return n;
    const last = p.pop();
    return `${last}, ${p.map((x) => x[0] + ".").join(" ")}`;
  }).join(", & ") : "Left Turn";
  const pp = pages ? `: ${pages}` : "";
  const ppApa = pages ? `, ${pages}` : "";
  return {
    Chicago: `${chicagoAuthors}. “${title}.” Left Turn ${volume}, no. ${number} (${season} ${year})${pp}. ${url}.`,
    MLA: `${chicagoAuthors}. “${title}.” Left Turn, vol. ${volume}, no. ${number}, ${year}${ppApa}, ${url}.`,
    APA: `${apaAuthors} (${year}). ${title}. Left Turn, ${volume}(${number})${ppApa}. ${url}`
  };
}

export { KIND_LABEL as K, articlesInIssue as a, bylineNames as b, citations as c, allArticles as d, currentIssue as e, issueLabel as f, allIssues as g, topicIndex as h, inlineMarkdown as i, joinNames as j, notesInIssue as n, pageRange as p, readingTime as r, stripMarkdown as s, topicsOf as t };
