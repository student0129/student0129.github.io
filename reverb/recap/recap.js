// ReVerb recap — renders a recap carried in the link's #fragment. Everything in it is shown as text.
// Another recap opened in this same tab changes only the #fragment; read it afresh.
window.addEventListener('hashchange', () => location.reload());
(async () => {
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

    function fromBase64Url(s) {
        const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
        return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }
    async function decode(code) {
        const bytes = fromBase64Url(code.slice(1));
        if (code[0] === 'z') {
            const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return JSON.parse(await new Response(out).text());
        }
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    let r = null;
    try {
        const code = new URLSearchParams(location.hash.slice(1)).get('r');
        if (code) r = await decode(code);
    } catch (err) { r = null; }
    if (!r || typeof r !== 'object' || typeof r.title !== 'string') { $('empty').hidden = false; return; }

    const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
    const objects = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    const when = Number.isFinite(r.date) ? new Date(r.date).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
    document.title = `${r.title} — recap`;

    const paper = $('recap');
    paper.append(el('p', 'kicker', 'Meeting recap'), el('h1', '', r.title));
    const meta = [when, Number.isFinite(r.minutes) && r.minutes ? `${r.minutes} min` : '', strings(r.people).join(', ')].filter(Boolean).join(' · ');
    if (meta) paper.append(el('p', 'meta', meta));
    if (typeof r.headline === 'string' && r.headline.trim()) paper.append(el('p', 'headline', r.headline));

    const listSection = (label, items) => {
        if (!items.length) return;
        const sec = el('section');
        const ul = el('ul');
        for (const i of items) ul.append(el('li', '', i));
        sec.append(el('h2', '', label), ul);
        paper.append(sec);
    };
    listSection('Decided', strings(r.decisions));

    const todos = objects(r.todos).filter((t) => typeof t.task === 'string' && t.task.trim());
    if (todos.length) {
        const sec = el('section');
        const ul = el('ul');
        for (const t of todos) {
            const li = el('li', 'todo' + (t.done ? ' done' : ''));
            li.append(el('span', 'what', t.task));
            const who = [t.owner, t.due ? `due ${t.due}` : ''].filter((x) => typeof x === 'string' && x).join(' · ');
            if (who) li.append(el('span', 'who', who));
            ul.append(li);
        }
        sec.append(el('h2', '', 'To-dos'), ul);
        paper.append(sec);
    }
    listSection('Still open', strings(r.open));
    listSection('Key points', strings(r.points));

    const terms = objects(r.glossary).filter((g) => typeof g.term === 'string' && typeof g.definition === 'string');
    if (terms.length) {
        const sec = el('section');
        const dl = el('dl');
        for (const g of terms) dl.append(el('dt', '', g.term), el('dd', '', g.definition));
        sec.append(el('h2', '', 'Glossary'), dl);
        paper.append(sec);
    }
    paper.hidden = false;

    // The same recap as plain text, for pasting somewhere that doesn't take links.
    const copy = $('copy');
    copy.hidden = false;
    copy.addEventListener('click', async () => {
        const lines = [r.title, meta, ''];
        if (r.headline) lines.push(r.headline, '');
        const add = (label, items) => { if (items.length) lines.push(`${label}:`, ...items.map((i) => `  ${i}`), ''); };
        add('Decided', strings(r.decisions).map((d) => `• ${d}`));
        add('To-dos', todos.map((t) => `${t.done ? '☑' : '☐'} ${t.task}${t.owner || t.due ? ` — ${[t.owner, t.due ? `due ${t.due}` : ''].filter(Boolean).join(', ')}` : ''}`));
        add('Still open', strings(r.open).map((o) => `• ${o}`));
        add('Key points', strings(r.points).map((k) => `• ${k}`));
        add('Glossary', terms.map((g) => `• ${g.term} — ${g.definition}`));
        try {
            await navigator.clipboard.writeText(lines.join('\n').trim());
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy as text'; }, 1500);
        } catch (err) { copy.textContent = 'Copy failed'; }
    });
})();
