// ReVerb — the live meeting companion. Loaded as a file, not inline, so the page's security policy
// can refuse any inline script outright.
(() => {
    'use strict';

    // Served from a different origin than the API in production; same-origin locally
    // so the whole thing can be exercised against a dev server.
    const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? location.origin
        : 'https://api-promontory.onrender.com';

    const apiUrl = `${API_BASE}/api/analyze`;
    const stateUrl = `${API_BASE}/api/reverb/state`;
    const speakersUrl = `${API_BASE}/api/reverb/speakers`;
    const sweepUrl = `${API_BASE}/api/reverb/sweep`;
    const questionsUrl = `${API_BASE}/api/reverb/questions`;
    const voiceUrl = `${API_BASE}/api/reverb/voice`;
    const outcomeUrl = `${API_BASE}/api/reverb/outcome`;
    const chatUrl = `${API_BASE}/api/reverb/chat`;
    const improveUrl = `${API_BASE}/api/reverb/improve`;
    const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/ws/reverb`;

    // Wake the server on page load — it sleeps on the free tier.
    fetch(API_BASE, { method: 'GET' }).catch(() => {});

    // ---------- sign-in ----------
    // Off unless the server turns it on. When it is on, the session the front page got from the
    // emailed link goes with every request and with the start of the audio stream.
    const AUTH_KEY = 'reverb.auth';
    // Set when another tab clears ReVerb from this browser: from then on this tab saves nothing.
    let clearedElsewhere = false;
    function readAuth() {
        try {
            const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
            return a && a.session && a.expiresAt > Date.now() ? a : null;
        } catch (err) { return null; }
    }
    const authHeader = () => { const a = readAuth(); return a ? { Authorization: `Bearer ${a.session}` } : {}; };
    const signInPage = () => location.replace('../#signin-required');

    // Every API call goes through here: it adds the session, and turns the two refusals that
    // aren't about this one request — signed out, or the day's budget spent — into a notice.
    async function apiFetch(url, opts = {}) {
        const resp = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...authHeader() } });
        if (resp.status === 401 || resp.status === 429) {
            resp.clone().json().then((d) => {
                if (d && d.auth === 'required') {
                    // Mid-meeting, the transcript keeps going and nothing is lost; say so rather
                    // than navigate away from it.
                    if (!isListening && !segments.length) signInPage();
                    else setNotice('Your sign-in has run out. Stop, then open ReVerb’s front page to sign in again — this meeting is saved.');
                } else if (d && d.limit === 'daily') { setNotice(d.error); if (replay) replay.spent = true; }
            }).catch(() => {});
        }
        return resp;
    }

    // Required and not signed in: off to the front page before anything starts. The answer is
    // kept, so the check at the top of the page can decide on the next visit without waiting.
    const revealApp = () => document.documentElement.classList.remove('auth-pending');
    fetch(`${API_BASE}/api/reverb/auth/config`, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).then((c) => {
        if (c && c.mode) { try { localStorage.setItem('reverb.authMode', c.mode); } catch (err) { /* ignore */ } }
        if (c && c.mode === 'required' && !readAuth()) signInPage();
        else revealApp();
    }).catch(revealApp);

    const $ = (id) => document.getElementById(id);
    const startBtn = $('start-btn'), stopBtn = $('stop-btn'), pauseBtn = $('pause-btn'), briefBtn = $('brief-btn'), endBtn = $('end-btn');
    const statusLight = $('status-light'), statusEl = $('status'), errorEl = $('error');
    const segmentsEl = $('segments'), pendingEl = $('pending-transcript'), interimEl = $('interim-transcript');
    const insightsContainer = $('insights-container'), placeholderCard = $('placeholder-card');
    const transcriptContainer = $('transcript-container');
    const modeBadge = $('mode-badge'), recordingBadge = $('recording-badge');
    const recordingDot = $('recording-dot'), recordingLabel = $('recording-label');
    const setupModal = $('setup-modal');
    const stateBar = $('state-bar'), stateBody = $('state-body'), stateChevron = $('state-chevron');
    const stateObjective = $('state-objective'), stateUpdated = $('state-updated');
    const topicTree = $('topic-tree'), summaryBody = $('summary-body');
    const restoreBar = $('restore-bar'), restoreDetail = $('restore-detail');
    const sessionEnd = $('session-end'), endMeta = $('end-meta'), endAudio = $('end-audio');
    const typeFilters = $('type-filters'), filterToggle = $('filter-toggle');
    const insightsActivity = $('insights-activity');
    const noticeEl = $('notice');
    const panels = $('panels'), insightsUnread = $('insights-unread');
    const transcriptJump = $('transcript-jump'), insightsJump = $('insights-jump');
    const liveCaption = $('live-caption'), liveCaptionText = $('live-caption-text');
    const sheetScrim = $('sheet-scrim'), sheetObjective = $('sheet-objective');
    const chatLog = $('chat-log'), chatEmpty = $('chat-empty'), chatForm = $('chat-form');
    const chatInput = $('chat-input'), chatSend = $('chat-send'), chatClear = $('chat-clear');
    const notesBox = $('notes-box'), notesInput = $('notes-input'), notesToggle = $('notes-toggle');
    const speakerEditor = $('speaker-editor'), speakerName = $('speaker-name');

    // Must match the max-width of the phone layout in the stylesheet.
    const phoneLayout = matchMedia('(max-width: 767px)');
    let unreadInsights = 0;

    // --- Segmentation tuning ---
    // A sentence ending is a weak signal on its own: both transcribers put a full stop on
    // nearly every final, which used to chop "Let me ask something. How does sharding
    // work?" into two analyses, the first of them noise. So a full stop only buys a short
    // grace period; a question mark is the one boundary worth acting on immediately.
    const FLUSH_PAUSE_MS = 1200;      // silence after an unfinished thought
    const BOUNDARY_PAUSE_MS = 700;    // grace after a full stop — the thought may continue
    const MIN_ANALYZE_WORDS = 4;      // fewer words than this is never worth a round trip
    const MAX_UTTERANCE = 420;        // force a flush before it grows unwieldy
    const CONTEXT_CHARS = 2200;       // rolling verbatim context sent with each utterance

    // --- Analysis lane ---
    const MAX_ANALYZE_CONCURRENCY = 2;   // bounded so streaming answers can't swamp capture
    const REPLAY_CONCURRENCY = 4;        // reading a recording, there is no capture to protect
    const MAX_ANALYZE_QUEUE = 6;         // beyond this the meeting has moved on
    // A flat 40s budget was killing healthy answers: a grounded one spends its first
    // seconds searching, and a long one legitimately streams for a while. What actually
    // signals a dead request is silence, so the clock is reset by every byte that
    // arrives and only a genuine gap trips it. The hard cap is the backstop.
    const ANALYZE_STALL_MS = 30000;
    const ANALYZE_MAX_MS = 150000;
    const ANALYZE_MAX_ATTEMPTS = 3;
    const ANALYZE_BACKOFF_MS = [2000, 6000];
    const ANSWERED_MEMORY = 40;
    const DISMISSED_MEMORY = 20;
    // The server asks to hold the types the room most often handles itself in the next breath;
    // this caps how long, whatever it asks.
    const MAX_HOLD_MS = 15000;

    // --- Card types ---
    // Mirrors CARD_TYPES on the server. `cooldown` is noise control: a type that just raised
    // a card is sent as cooling, and the server holds it to a much higher bar until the
    // cooldown runs out. The rates differ by how much each type costs when it is wrong — a
    // fact-check every time someone cites a number is welcome; "here is what you're not
    // considering" every ninety seconds is a nag. `utterance` types come from each line as it
    // is said, `sweep` types from the read of the last few minutes; "Ask this" comes from both.
    const CARD_TYPE_UI = {
        question:      { label: 'Question',     cooldown: 0,      utterance: true },
        // A question the meeting already answered: answered from the transcript, with the minute.
        recall:        { label: 'From earlier', cooldown: 0,      utterance: true },
        explanation:   { label: 'Jargon',       cooldown: 0,      utterance: true },
        factcheck:     { label: 'Fact check',   cooldown: 45000,  utterance: true },
        contradiction: { label: 'Conflict',     cooldown: 150000, utterance: true },
        gap:           { label: 'Dig deeper',   cooldown: 180000, utterance: true },
        ask:           { label: 'Ask this',     cooldown: 60000,  utterance: true, sweep: true },
        action:        { label: 'Action',       cooldown: 0,      utterance: true },
        unanswered:    { label: 'Unanswered',   cooldown: 120000, sweep: true },
        loop:          { label: 'Going round',  cooldown: 300000, sweep: true },
        confirm:       { label: 'Confirm it',   cooldown: 180000, sweep: true },
        talkpast:      { label: 'Talking past', cooldown: 300000, sweep: true },
        drift:         { label: 'Off track',    cooldown: 600000, sweep: true },
        // Raised here, from who has and hasn't been talking — the server never sees this type.
        quiet:         { label: 'Quiet voice',  cooldown: 0 },
    };
    const CARD_TYPE_ORDER = Object.keys(CARD_TYPE_UI);
    const UTTERANCE_TYPE_ORDER = CARD_TYPE_ORDER.filter((t) => CARD_TYPE_UI[t].utterance);
    const SWEEP_TYPE_ORDER = CARD_TYPE_ORDER.filter((t) => CARD_TYPE_UI[t].sweep);
    // Saved as the muted types, so a type added later starts on. The old key held the enabled
    // ones, which would have quietly muted every newer type for anyone who ever used a filter.
    const FILTER_KEY = 'reverb.types.muted';
    const LEGACY_FILTER_KEY = 'reverb.types';
    const LEGACY_FILTER_TYPES = ['question', 'explanation', 'factcheck', 'contradiction', 'gap', 'action'];

    // --- Slow lane (topic tree + rolling summary) ---
    // Folding new speech into the existing state costs a fraction of rebuilding from the
    // whole transcript, so it runs every half minute that brings new speech, and sooner
    // after a burst of talk. The summary should be current whenever someone looks at it,
    // and the conflict and dig-deeper cards are only as good as how current the state is.
    const STATE_INTERVAL_MS = 30 * 1000;
    const STATE_MIN_NEW_CHARS = 400;
    const STATE_FULL_EVERY_MS = 5 * 60 * 1000;   // a pass this long after the last rebuild re-reads everything, clearing drift

    // --- Sweep (what no single line shows) ---
    // A loop or a question the room moved past only shows across minutes, so this reads the
    // last stretch as a whole. Every two minutes that brought real speech: often enough to
    // catch an unanswered question while it can still be asked, rarely enough not to nag.
    const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
    const SWEEP_MIN_NEW_CHARS = 600;
    const SWEEP_CONTEXT_CHARS = 9000;    // ~8 minutes of speech
    const SWEEP_TIMEOUT_MS = 45000;      // the server allows the call 40s

    // --- Suggested questions ---
    // Looked for again every half-minute that brought a couple of sentences of new talk, and sooner
    // when fewer than two are open: that is exactly when someone looks for the next question.
    // Before anyone speaks, openers.
    const QUESTIONS_INTERVAL_MS = 30 * 1000;
    const QUESTIONS_MIN_NEW_CHARS = 250;
    const QUESTIONS_REFILL_MS = 15 * 1000;
    const QUESTIONS_REFILL_CHARS = 120;
    const QUESTIONS_MAX_OPEN = 3;        // open question cards at once; the oldest is quieted past this
    const QUESTIONS_CONTEXT_CHARS = 30000;   // ~25 minutes of speech
    const QUESTIONS_TIMEOUT_MS = 45000;      // the server allows the call 40s

    // --- Kinds of meeting ---
    // What the brief's menu offers, and what each kind of meeting is for. The server's MEETING_TYPES
    // (promontory-api, routes/reverb.js) holds what each kind tells the AI under the same keys: its
    // focus, what a great question looks like, and the checklist the summary tracks.
    const MEETING_KINDS = [
        { group: 'Decide & plan', kinds: [
            { key: 'strategy', name: 'Decision or strategy', goal: 'Reach a decision everyone can stand behind, with the trade-offs on the table.', example: 'e.g. Decide build vs. buy for identity, and who owns the rollout', role: 'e.g. I’m the one making the call' },
            { key: 'planning', name: 'Planning or kickoff', goal: 'Agree on scope, owners and milestones, and on what could derail it.', example: 'e.g. Kick off the billing migration: scope, owners, first milestone', role: 'e.g. Project lead' },
            { key: 'technical', name: 'Technical review', goal: 'Find the risks and weak spots before they’re built, and agree on the approach.', example: 'e.g. Sign off the ledger design, or know exactly what blocks it', role: 'e.g. Reviewer from the platform team' },
            { key: 'design', name: 'Brainstorm', goal: 'Explore the problem, generate lots of options, then pick the few worth trying.', example: 'e.g. Three ideas worth testing to cut onboarding drop-off', role: 'e.g. Facilitator' },
        ] },
        { group: 'Check in', kinds: [
            { key: 'general', name: 'General meeting', goal: 'Leave with clear outcomes: what was decided, and who does what next.', example: 'e.g. Agree the launch date and who owns the announcement', role: 'e.g. I run this meeting' },
            { key: 'status', name: 'Status update or standup', goal: 'Know where everything stands, surface blockers early, and keep it short.', example: 'e.g. Know what’s blocking launch, and who’s unblocking it', role: 'e.g. Engineering manager' },
            { key: 'oneonone', name: 'One-on-one', goal: 'A real conversation about how things are going: progress, blockers, feedback and growth.', example: 'e.g. Talk through Sam’s workload and the path to promotion', role: 'e.g. I’m Sam’s manager (or: I’m meeting my manager)' },
            { key: 'retro', name: 'Retrospective or post-mortem', goal: 'Understand what happened and why, and agree on a few changes, without blame.', example: 'e.g. Why checkout went down on Tuesday, and two fixes with owners', role: 'e.g. Facilitator' },
        ] },
        { group: 'With people outside', kinds: [
            { key: 'sales', name: 'Sales or discovery call', goal: 'Understand the customer’s problem, what it costs them and how they decide, then agree a next step.', example: 'e.g. Learn how Acme’s finance team closes the books, and book a demo', role: 'e.g. Account executive on our side' },
            { key: 'research', name: 'Customer or user interview', goal: 'Learn what people actually do and why, without leading them.', example: 'e.g. How small agencies get client sign-off today, and where it hurts', role: 'e.g. Product researcher' },
            { key: 'interview', name: 'Job interview (you’re hiring)', goal: 'Get real evidence of how the candidate works: specific examples, not rehearsed answers.', example: 'e.g. Evidence of system design and ownership for the senior backend role', role: 'e.g. Hiring manager for the role' },
            { key: 'negotiation', name: 'Negotiation', goal: 'Understand what both sides really need, and reach terms you can accept.', example: 'e.g. Renew the data contract under $120k with a two-year price lock', role: 'e.g. Buyer for our side' },
            { key: 'board', name: 'Board or investor update', goal: 'Give an honest picture, handle the hard questions, and leave with the guidance you need.', example: 'e.g. Agreement on the runway plan, and intros for the enterprise pivot', role: 'e.g. CEO, presenting' },
        ] },
        { group: 'Learn', kinds: [
            { key: 'learning', name: 'Class, lecture or training', goal: 'Understand the material, and catch what you’d otherwise miss.', example: 'e.g. Understand how Raft elects a leader', role: 'e.g. Student in the class' },
        ] },
    ];
    // The document each kind of meeting ends in (written on request, from the recap dialog), and
    // roughly how much of the talking the person running it should be doing.
    const KIND_EXTRAS = {
        strategy: { doc: 'Decision Record' }, planning: { doc: 'Plan' }, technical: { doc: 'Review Record' }, design: { doc: 'Ideas Board' },
        general: { doc: 'Meeting Notes' }, status: { doc: 'Status Report' }, retro: { doc: 'Retro Summary' }, board: { doc: 'Board Follow-Up' },
        learning: { doc: 'Study Notes' }, negotiation: { doc: 'Terms Summary', talkMax: 50, talkWhy: 'you learn what they need by listening' },
        oneonone: { doc: '1:1 Notes', talkMax: 50, talkWhy: 'it’s their time as much as yours' },
        interview: { doc: 'Scorecard', talkMax: 35, talkWhy: 'the candidate should do most of the talking' },
        sales: { doc: 'Call Notes', talkMax: 45, talkWhy: 'discovery works when the customer does most of the talking' },
        research: { doc: 'Synthesis', talkMax: 30, talkWhy: 'the participant should do nearly all of the talking' },
    };
    for (const g of MEETING_KINDS) for (const k of g.kinds) Object.assign(k, KIND_EXTRAS[k.key] || { doc: 'Meeting Notes' });

    // The languages a meeting can be held in: what the transcriber listens for, and what ReVerb
    // writes in. The server keeps the same codes. ReVerb's own buttons and labels stay in English.
    const LANGUAGES = [
        ['en', 'English', 'en-US'], ['es', 'Spanish', 'es-ES'], ['fr', 'French', 'fr-FR'], ['de', 'German', 'de-DE'],
        ['pt', 'Portuguese', 'pt-BR'], ['it', 'Italian', 'it-IT'], ['nl', 'Dutch', 'nl-NL'], ['sv', 'Swedish', 'sv-SE'],
        ['da', 'Danish', 'da-DK'], ['no', 'Norwegian', 'nb-NO'], ['fi', 'Finnish', 'fi-FI'], ['pl', 'Polish', 'pl-PL'],
        ['cs', 'Czech', 'cs-CZ'], ['ro', 'Romanian', 'ro-RO'], ['el', 'Greek', 'el-GR'], ['tr', 'Turkish', 'tr-TR'],
        ['uk', 'Ukrainian', 'uk-UA'], ['ru', 'Russian', 'ru-RU'], ['ar', 'Arabic', 'ar-SA'], ['he', 'Hebrew', 'he-IL'],
        ['fa', 'Persian', 'fa-IR'], ['hi', 'Hindi', 'hi-IN'], ['bn', 'Bengali', 'bn-IN'], ['ur', 'Urdu', 'ur-PK'],
        ['id', 'Indonesian', 'id-ID'], ['ms', 'Malay', 'ms-MY'], ['vi', 'Vietnamese', 'vi-VN'], ['th', 'Thai', 'th-TH'],
        ['zh', 'Chinese', 'zh-CN'], ['ja', 'Japanese', 'ja-JP'], ['ko', 'Korean', 'ko-KR'],
    ].map(([code, name, speech]) => ({ code, name, speech }));
    const languageOf = (code) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];

    const KINDS = Object.fromEntries(MEETING_KINDS.flatMap((g) => g.kinds).map((k) => [k.key, k]));
    const kindOf = (key) => KINDS[key] || KINDS.general;

    // --- Speaker attribution ---
    const SPEAKER_INTERVAL_MS = 45000;
    const SPEAKER_MIN_NEW = 3;         // one stray line isn't worth a round trip
    const SPEAKER_MAX_TURNS = 60;      // per call; older unattributed lines wait their turn
    const SPEAKER_TIMEOUT_MS = 30000;
    // A rebuild reads the whole meeting, about four hours of speech at this length (it
    // also has to fit the API's 1MB body limit). Beyond it, the rebuild also gets the
    // previous state, which is then the only record of the opening hours.
    const STATE_CONTEXT_CHARS = 250000;
    const STATE_TIMEOUT_MS = 45000;
    const STATE_REBUILD_TIMEOUT_MS = 90000;      // the server allows a rebuild 80s

    // --- Chat with the session ---
    // An answer reads the whole meeting before its first word, so the stall window is
    // longer than a card's. The server allows a stall of 60s and 150s in all.
    const CHAT_STALL_MS = 75000;
    const CHAT_MAX_MS = 180000;
    const CHAT_HISTORY_TURNS = 8;        // earlier exchanges sent along, for follow-ups
    const CHAT_SAVED_TURNS = 60;
    const CHAT_QUESTION_MAX = 2000;
    const CHAT_INSIGHTS = 30;
    // Corrections: what the user says the transcript got wrong. After the meeting, the
    // summary is rebuilt once the fixes stop coming, not after every keystroke.
    const NOTES_MAX = 4000;
    const CORRECTION_SETTLE_MS = 5000;

    // --- Conversation balance ---
    // A named person who has taken part, then said nothing for this long while the meeting
    // carried on, is worth bringing back in. Only in a room of three or more: with two,
    // the silence of one is the other one talking, and that is plain to both.
    const QUIET_AFTER_MS = 15 * 60 * 1000;
    const QUIET_MIN_LINES = 3;          // they really took part before going quiet
    const QUIET_GAP_LINES = 12;         // and the room has really kept talking since
    const QUIET_RENAG_MS = 20 * 60 * 1000;

    // --- Past meetings: recaps the user chose to keep, in this browser only ---
    const LIBRARY_KEY = 'reverb.library';
    const LIBRARY_MAX = 30;
    // A saved meeting keeps its transcript too, so it can be asked about later: about two hours of speech.
    const LIBRARY_TRANSCRIPT_CHARS = 150000;

    // --- Staying alive ---
    // A phone screen going dark is the most common way a meeting quietly stops being
    // captured: the page is frozen, the AudioContext is suspended, and nothing on
    // screen says so. The wake lock prevents it; the watchdog catches everything else
    // — a call coming in, a headset unplugged, another app grabbing the microphone.
    const CAPTURE_WATCHDOG_MS = 5000;
    const SILENCE_WARN_MS = 90000;     // live but hearing nothing this long => say so

    // "Is anything being heard" cannot be one absolute number: a lapel mic in a quiet
    // room and a laptop mic in a café have noise floors two orders of magnitude apart,
    // so any fixed threshold is wrong for one of them — either crying silence over a
    // clean mic, or missing a muted one whose self-noise sits above the line. Instead
    // the room's own floor is measured, and speech is whatever rises clearly above it.
    const LEVEL_WINDOW = 120;          // ~2 min of per-second peaks
    const LEVEL_MIN_SAMPLES = 15;      // before that, fall back to the absolute floor
    const NOISE_FLOOR_PCT = 0.1;       // the 10th percentile is the room, not the talking
    const SPEECH_OVER_FLOOR = 4;       // a peak this many times the floor is someone talking
    const ABSOLUTE_SILENCE = 0.004;    // backstop for a floor that is itself ~0 (muted)

    // --- Resilience ---
    const SPEECH_RESTART_MS = 400;     // Chrome throws if you restart too eagerly
    const SPEECH_WATCHDOG_MS = 2000;   // how often we check the engine is actually up
    const SPEECH_STALL_MS = 120000;    // "running" but silent this long => bounce it

    // --- Persistence ---
    // Each tab saves under its own key (see claimTab), so two ReVerb tabs in one browser
    // can't overwrite each other's meeting. Pages before that used one shared key.
    const STORE_PREFIX = 'reverb.transcript.';
    const LEGACY_STORE_KEY = 'reverb.transcript';
    const SAVED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;   // an abandoned tab's meeting is dropped after this
    let STORE_KEY = STORE_PREFIX + newTabId();
    let offeredSave = null;         // { key, data } — the unfinished session the restore bar offers
    const PERSIST_DEBOUNCE_MS = 1500;
    const MAX_PERSIST_CHARS = 200000;

    const MATERIALS_MAX = 16000;
    const lastLanguage = () => { try { return localStorage.getItem('reverb.language') || 'en'; } catch (err) { return 'en'; } };
    const freshBrief = () => ({
        objective: '', type: 'general', role: '', language: lastLanguage(), me: '', keywords: [], roster: [],
        agenda: [], durationMin: null, materials: '',
        accurate: false, record: false, tabAudio: false, voiceId: false, followUp: null,
    });
    const session = freshBrief();

    const segments = [];            // { id, text, edited, low, t } — one per analysed utterance; t is meeting time
    const answeredTitles = [];      // { type, title } — what the classifier has already covered
    const dismissedTitles = [];     // { type, title } — cards the user thumbed down
    // Per-type nudges from the thumbs on each card, sent with every analysis. Down makes a
    // type harder to raise for the rest of the session; up makes it a little easier.
    const typeBias = Object.create(null);
    // The server caps the nudge at 0.2: at 0.3 one thumbs-down could mute "Ask this" for the meeting.
    const BIAS_DOWN = 0.1, BIAS_UP = 0.05, BIAS_MIN = -0.15, BIAS_MAX = 0.2;
    let cardOrder = 0;
    let meetingState = null;
    let isListening = false, isPaused = false;
    let provider = null, recorder = null, micStream = null;
    // A video call's audio, from a shared browser tab, and the context that mixes it with the mic.
    let tabStream = null, mixer = null;
    // Every recording this meeting made: { name, offsetMs, durationMs } in meeting time. A Stop
    // and a Continue start a new file, so a meeting can have several.
    const recordings = [];
    let improveRun = null, improveUndo = null;
    let pendingUtterance = '';      // finalized text not yet flushed for analysis
    let pendingLow = false;
    let flushTimer = null;
    let stateTimer = null, stateRunning = false, charsSinceState = 0;
    let lastStateSegment = 0, statePasses = 0;
    let lastFullAt = 0, lastPassFull = false, closingPassQueued = false, stateStampedAt = 0;
    const enabledTypes = new Set(CARD_TYPE_ORDER);
    const typeLastShown = Object.create(null);
    let startedAt = null, lastAudio = null, segmentSeq = 0;
    let markResumeSeam = false;
    let wakeLock = null, captureTimer = null, captureWarned = false;
    let speakersRunning = false, lastSpeakerRun = 0;
    let sweepRunning = false, lastSweepAt = 0, charsSinceSweep = 0, sweepUnsupported = false;
    const heldTimers = new Set();   // cards waiting a few seconds to hear what the room says next
    // Meeting time: what has been listened to, not what the wall clock says. A Stop and a
    // Continue an hour later is still a forty-minute meeting, and "time is running out" has
    // to be judged against that.
    let activeMs = 0, activeSince = 0;
    // A recording being read through sets `replay`: meeting time is then the place it has reached
    // in the recording, and the lanes that pace themselves by the clock pace themselves by that.
    let replay = null;
    const meetingClock = () => (replay ? replay.clockMs : activeMs + (activeSince ? Date.now() - activeSince : 0));
    const lanesNow = () => (replay ? replay.epoch0 + replay.clockMs : Date.now());
    const lanesLive = () => Boolean(replay) || (isListening && !isPaused);
    function runClock(on) {
        if (on && !activeSince) activeSince = Date.now();
        else if (!on && activeSince) { activeMs += Date.now() - activeSince; activeSince = 0; }
    }
    let participants = [];
    // Corrections. Notes go to every lane as part of the brief. Aliases record a speaker the
    // user renamed everywhere, so a label the speaker pass keeps using ("Speaker 2") lands
    // under the name the user gave it.
    let sessionNotes = '';
    const speakerAliases = Object.create(null);
    let correctionTimer = 0;
    // { question, answer, status: 'streaming'|'done'|'failed'|'stopped', error, el }
    const chatTurns = [];
    let chatActive = null;          // { controller, turn } while an answer streams
    // What the meeting produced beyond the summary. To-dos come from the action cards and from
    // the user; the glossary from the jargon cards. Both outlive the cards, which aren't saved.
    const todos = [];               // { id, title, task, owner, due, done, t, seg, byUser }
    const glossary = [];            // { term, definition, t }
    let todoSeq = 0, todoEditing = null;
    const quietNudged = Object.create(null);   // name -> meeting time of the last nudge
    // Bumped by End session. Every request in flight remembers the epoch it started in
    // and discards its result if that has moved on — otherwise a reply landing a second
    // after the wipe would put a card or a summary back on screen.
    let sessionEpoch = 0;
    const inflight = new Set();     // AbortControllers for every request in flight

    // Every timing threshold in this file was reasoned about, not measured. This records
    // what a real meeting does to them — how long answers actually take, how often the
    // stall clock fires, where this room's noise floor really sits — so after one session
    // they can be set from evidence instead of from a good guess.
    const freshStats = () => ({
        answers: [],                    // { ms, firstTokenMs }
        stalls: 0, truncated: 0, retries: 0, errors: 0,
        cards: {}, filtered: 0, dropped: 0, merged: 0, useful: 0, notUseful: 0,
        held: 0, heldDropped: 0, resolved: 0, sweeps: 0, sweepFails: 0,
        interruptions: {}, longestSilenceMs: 0,
        noiseFloor: null, threshold: null, wakeLock: 'not requested',
        statePasses: 0, stateFulls: 0, stateFails: 0,
        speakerRuns: 0, speakerFails: 0,
        questions: 0, questionRuns: 0, questionFails: 0,
        voiceChecks: 0, voiceFails: 0, voiceYou: 0,
    });
    const stats = freshStats();
    const bumpStat = (bag, key) => { stats[bag][key] = (stats[bag][key] || 0) + 1; };

    const committedTranscript = () => segments.map(s => s.text).join(' ');

    // The same transcript with speaker labels folded in, marked only where the speaker
    // changes. This is what goes to the models: "Dana said X but Tom established Y" is a
    // far better card than the same observation with nobody attached to either half.
    // Timed, it also marks each new minute of meeting time — "[14m]" — which is what lets
    // the summary say when a decision was made and the sweep say how long ago a question was.
    function attributedTranscript(from = 0, opts) {
        const timed = Boolean(opts && opts.timed);
        const out = [];
        let last = null, lastMin = -1;
        for (let i = from; i < segments.length; i++) {
            const seg = segments[i];
            const min = timed && Number.isFinite(seg.t) ? Math.floor(seg.t / 60000) : null;
            const newMin = min != null && min !== lastMin;
            const newSpeaker = Boolean(seg.speaker) && seg.speaker !== last;
            if (newMin) lastMin = min;
            if (newMin || newSpeaker) {
                const who = seg.speaker || (newMin ? last : null);
                out.push(`\n${newMin ? `[${min}m] ` : ''}${who ? `${who}: ` : ''}`);
            }
            last = seg.speaker || last;
            out.push(seg.text, ' ');
        }
        return out.join('').trim();
    }

    // The brief as the server reads it. The background material is most of its size and no
    // help in telling voices apart, so the speaker pass goes without it.
    function briefForServer(opts) {
        const withMaterials = !(opts && opts.materials === false);
        return {
            objective: session.objective,
            type: session.type,
            ...(session.role ? { role: session.role.slice(0, 200) } : {}),
            ...(voiceIdOn() || segments.some((seg) => seg.voice === 'you') ? { voice: true } : {}),
            ...(session.language && session.language !== 'en' ? { language: session.language } : {}),
            keywords: session.keywords.slice(0, 100),
            roster: session.roster.slice(0, 40),
            agenda: (session.agenda || []).slice(0, 20),
            durationMin: session.durationMin || null,
            elapsedMin: startedAt ? Math.round(meetingClock() / 60000) : null,
            ...(withMaterials && session.materials ? { materials: session.materials.slice(0, MATERIALS_MAX) } : {}),
            ...(sessionNotes.trim() ? { notes: sessionNotes.trim().slice(0, NOTES_MAX) } : {}),
        };
    }
    // Chinese, Japanese and Thai don't put spaces between words: a run of their characters counts
    // as about one word per two characters, or a whole sentence would count as a single word.
    const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;
    const wordCount = (s) => {
        let n = 0;
        for (const w of String(s).match(/[\p{L}\p{N}'’-]+/gu) || []) {
            const c = (w.match(UNSPACED) || []).length;
            n += c ? Math.max(1, Math.round(c / 2)) : 1;
        }
        return n;
    };

    // ---------- small helpers ----------
    function escapeHtmlText(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function el(tag, className, text) {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text != null) n.textContent = text;
        return n;
    }

    function setStatus(text, tone) {
        statusEl.textContent = text;
        statusLight.className = 'w-3 h-3 rounded-full ' + ({
            live: 'bg-green-500 animate-pulse',
            warn: 'bg-amber-500 animate-pulse',
            paused: 'bg-amber-400',
            idle: 'bg-gray-400',
        }[tone] || 'bg-gray-400');
    }

    // Separate from #error: a notice is something to act on while the session keeps
    // running, not a failure that ended it.
    function setNotice(text) {
        if (noticeEl.textContent !== text) noticeEl.textContent = text;
    }
    function clearNotice() { setNotice(''); }

    const formatBytes = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;

    // With no objective of its own, the meeting is held to what its kind of meeting is for.
    function setStateObjective() {
        const empty = !session.objective;
        const kind = kindOf(session.type);
        $('state-label').textContent = empty ? 'Goal' : 'Objective';
        stateObjective.textContent = empty ? kind.goal : session.objective;
        stateObjective.dataset.empty = 'false';
        stateObjective.title = empty ? `${kind.name}: ${kind.goal}` : session.objective;
        sheetObjective.textContent = stateObjective.textContent;
        sheetObjective.dataset.empty = 'false';
    }

    // Minimal, safe markdown -> HTML (escapes first, then formats a useful subset).
    function renderMarkdown(src) {
        const inline = (s) => escapeHtmlText(s)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="underline text-google-green">$1</a>');

        const lines = src.replace(/\r/g, '').split('\n');
        let html = '', list = null, inCode = false, code = '';
        const closeList = () => { if (list) { html += `</${list}>`; list = null; } };

        for (const raw of lines) {
            const line = raw.replace(/\s+$/, '');
            if (/^\s*```/.test(line)) {
                if (inCode) { html += `<pre><code>${escapeHtmlText(code)}</code></pre>`; code = ''; inCode = false; }
                else { closeList(); inCode = true; }
                continue;
            }
            if (inCode) { code += line + '\n'; continue; }

            let m;
            if ((m = line.match(/^#{1,4}\s+(.*)/))) { closeList(); html += `<h4>${inline(m[1])}</h4>`; }
            else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
            else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
            else if (line.trim() === '') { closeList(); }
            else { closeList(); html += `<p>${inline(line)}</p>`; }
        }
        if (inCode) html += `<pre><code>${escapeHtmlText(code)}</code></pre>`;
        closeList();
        return html;
    }

    // Re-rendering the whole answer on every streamed token was the main-thread work that
    // competed with audio capture. Now every card marks itself dirty and one animation
    // frame repaints all of them — at most 60 renders a second, in practice far fewer.
    const dirtyAnswers = new Set();
    let renderFrame = 0;

    function markAnswerDirty(entry) {
        dirtyAnswers.add(entry);
        if (!renderFrame) renderFrame = requestAnimationFrame(flushAnswerRenders);
    }

    function flushAnswerRenders() {
        renderFrame = 0;
        const atTop = insightsAtTop();
        for (const entry of dirtyAnswers) {
            if (entry.card.isConnected) renderAnswer(entry);
        }
        dirtyAnswers.clear();
        if (atTop) pinInsightsTop();
    }

    const spinnerSvg = `<svg class="animate-spin h-5 w-5 text-google-green" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

    // Newest cards are at the top. Following the bottom as answers streamed in scrolled the
    // newest card out of view; now a reader at the top stays there, and one who scrolled down
    // to re-read an older card isn't yanked away from it.
    function insightsAtTop() {
        return insightsContainer.scrollTop < 80;
    }
    function transcriptAtBottom() {
        return transcriptContainer.scrollHeight - transcriptContainer.scrollTop - transcriptContainer.clientHeight < 50;
    }
    function scrollTranscript() { transcriptScroll.write(transcriptContainer.scrollHeight); }

    // iOS stops a flick dead when script writes scrollTop mid-gesture, and with updates
    // arriving several times a second that happened on nearly every swipe. So following
    // the live edge waits while a finger is dragging and until the momentum has run out.
    // A thumb merely resting on the screen doesn't count — that's how phones get held.
    function scrollOwner(container) {
        let touching = false, dragged = false, settling = 0, written = -1;
        const settle = () => {
            clearTimeout(settling);
            settling = setTimeout(() => { settling = 0; }, 200);
        };
        container.addEventListener('touchstart', () => { touching = true; dragged = false; }, { passive: true });
        for (const type of ['touchend', 'touchcancel']) {
            container.addEventListener(type, () => { touching = false; if (dragged) settle(); }, { passive: true });
        }
        container.addEventListener('scroll', () => {
            if (container.scrollTop === written) return;   // our own write, not the finger
            if (touching) dragged = true;
            if (settling) settle();
        }, { passive: true });
        return {
            inHand: () => (touching && dragged) || settling !== 0,
            write: (top) => { container.scrollTop = top; written = container.scrollTop; },
        };
    }
    const transcriptScroll = scrollOwner(transcriptContainer);
    const insightsScroll = scrollOwner(insightsContainer);

    function followTranscript(wasAtBottom) {
        if (!wasAtBottom) transcriptJump.hidden = false;
        else if (!transcriptScroll.inHand()) scrollTranscript();
    }
    function pinInsightsTop() {
        if (insightsContainer.scrollTop !== 0 && !insightsScroll.inHand()) insightsScroll.write(0);
    }

    // A short confirmation that floats up and goes, like the system's own "Copied".
    let toastTimer = 0;
    function toast(text) {
        const t = $('toast');
        t.textContent = text;
        t.hidden = false;
        t.classList.remove('show');
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove('show'); }, 1900);
    }

    async function copyToClipboard(text, button, what) {
        if (!text) { toast('Nothing to copy yet'); return; }
        try {
            await navigator.clipboard.writeText(text);
            toast(what ? `${what} copied` : 'Copied');
        } catch { errorEl.textContent = 'Could not copy to clipboard.'; }
    }

    // ---------- improve the transcript from the recording ----------
    // Live transcription can't tell voices apart; a recording can. On request — the audio
    // never leaves the device otherwise — the recording is decoded here, cut at quiet moments
    // into ~10-minute 16 kHz pieces (the model takes ~25 MB and ~25 minutes per request), and
    // each piece is transcribed with the voices separated. Short samples of up to four voices
    // go along with every later piece so each person keeps one label throughout. The voices are
    // then named by lining them up with who the live transcript said was talking at the time,
    // and the new transcript replaces the recorded stretch — with Undo.
    const IMPROVE_RATE = 16000;
    const IMPROVE_SEARCH_S = 30;          // look this far back from a cut for a quiet moment
    const IMPROVE_SAMPLE_S = [2.5, 8];    // a known-speaker sample: long enough to recognise, under the model's 10s
    const improvePieceSeconds = () => {
        // A testing knob, read from this browser only; ten minutes otherwise.
        let v = NaN;
        try { v = Number(localStorage.getItem('reverb.improvePieceSeconds')); } catch (err) { /* ignore */ }
        return Number.isFinite(v) && v >= 3 && v <= 1200 ? v : 600;
    };

    function reflectImprove() {
        const source = Boolean(lastAudio && lastAudio.url) || recordings.length > 0;
        $('improve-btn').hidden = isListening || Boolean(improveRun) || !segments.length || !source;
        $('end-improve').classList.toggle('hidden', !(lastAudio && lastAudio.url) || Boolean(improveRun));
    }

    function improveStatus(text, { progress = null, cancel = false, undo = false, retry = null } = {}) {
        $('improve-bar').classList.remove('hidden');
        $('improve-text').textContent = text;
        const bar = $('improve-progress');
        bar.hidden = progress == null;
        if (progress != null) bar.firstElementChild.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
        $('improve-cancel').textContent = cancel ? 'Cancel' : 'Dismiss';
        $('improve-undo').hidden = !undo;
        $('improve-retry').hidden = !retry;
        $('improve-retry').onclick = retry;
    }

    function startImprove() {
        if (improveRun || isListening || !segments.length) return;
        const ask = (source) => showAlert({
            title: 'Improve the Transcript?',
            message: 'ReVerb sends the recording to OpenAI to transcribe it again, telling each voice apart, then replaces the transcript for the recorded part. Line edits there are replaced; names you gave are kept. It takes about a minute for every ten minutes of audio, and you can undo it.',
            actions: [{ label: 'Cancel', style: 'cancel' }, { label: 'Improve', style: 'default', run: () => runImprove(source) }],
        });
        if (lastAudio && lastAudio.url) ask({ url: lastAudio.url, offsetMs: lastAudio.offsetMs || 0 });
        else $('improve-file').click();     // after a reload: the file the recording was saved to
    }

    function onImproveFile(file) {
        if (!file) return;
        // Its place in the meeting, from the recordings remembered with it.
        const rec = recordings.find((r) => r.name && r.name === file.name) || recordings[recordings.length - 1] || { offsetMs: 0 };
        showAlert({
            title: 'Improve the Transcript?',
            message: `ReVerb sends “${file.name}” to OpenAI to transcribe it again, telling each voice apart, then replaces the transcript for the part it covers. You can undo it.`,
            actions: [{ label: 'Cancel', style: 'cancel' }, { label: 'Improve', style: 'default', run: () => runImprove({ file, offsetMs: rec.offsetMs }) }],
        });
    }

    // Decoded straight to 16 kHz: a context resamples to its own rate, and an hour at 16 kHz is
    // a third of the memory it would take at the recording's 48 kHz.
    async function decodeMono16k(blob) {
        const ctx = new OfflineAudioContext(1, 1, IMPROVE_RATE);
        const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (audio.numberOfChannels === 1) return audio.getChannelData(0);
        const out = new Float32Array(audio.length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
            const ch = audio.getChannelData(c);
            for (let i = 0; i < out.length; i++) out[i] += ch[i] / audio.numberOfChannels;
        }
        return out;
    }

    // Cut where nobody is talking: the quietest 200ms in the stretch before each mark.
    function cutPieces(pcm, pieceS) {
        const step = Math.round(pieceS * IMPROVE_RATE);
        const search = Math.min(IMPROVE_SEARCH_S * IMPROVE_RATE, Math.floor(step / 2));
        const win = IMPROVE_RATE / 5;
        const pieces = [];
        let start = 0;
        while (pcm.length - start > step + search) {
            const target = start + step;
            let best = target, quietest = Infinity;
            for (let w = target - search; w + win <= target; w += win / 2) {
                let e = 0;
                for (let i = w; i < w + win; i++) e += pcm[i] * pcm[i];
                if (e < quietest) { quietest = e; best = w + win / 2; }
            }
            pieces.push({ start, end: best });
            start = best;
        }
        pieces.push({ start, end: pcm.length });
        return pieces;
    }

    function wavBlob(f32) {
        const n = f32.length;
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
        str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, IMPROVE_RATE, true); v.setUint32(28, IMPROVE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) {
            const x = Math.max(-1, Math.min(1, f32[i]));
            v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
        }
        return new Blob([buf], { type: 'audio/wav' });
    }

    const blobDataUrl = (blob) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });

    // The server takes a couple of these at a time; when it's full it says so, and this waits its
    // turn — up to a couple of minutes — rather than failing. Other hiccups get two more tries.
    async function improvePiece(form, signal, onWait) {
        let tries = 0, waits = 0;
        for (;;) {
            const resp = await apiFetch(improveUrl, { method: 'POST', body: form, signal });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok) return Array.isArray(data.segments) ? data.segments : [];
            const busy = resp.status === 503 && data.busy;
            if (busy ? waits++ < 24 : (data.retryable && tries++ < 2)) {
                if (busy && onWait) onWait();
                await new Promise((r) => setTimeout(r, busy ? 5000 : 4000 * tries));
                if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
                continue;
            }
            throw new Error(data.error || `Server error ${resp.status}`);
        }
    }

    // The recording, a piece at a time, through the model that tells voices apart. Resolves with
    // every stretch of speech as { voice, piece, start, end, text } (seconds into the recording).
    // `known` starts the list of voices the model is told to recognise: the user's own, as "You".
    async function transcribeRecording(pcm, signal, status, known0 = []) {
        const pieces = cutPieces(pcm, improvePieceSeconds());
        const known = known0.slice(0, 4);   // { name, sample } — voices carried to later pieces
        const all = [];
        let voices = 0;
        for (let i = 0; i < pieces.length; i++) {
            if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
            status(pieces.length > 1 ? `Transcribing part ${i + 1} of ${pieces.length}, telling the voices apart…` : 'Transcribing, telling the voices apart…', (i + 0.15) / pieces.length);
            const p = pieces[i];
            const form = new FormData();
            form.append('audio', wavBlob(pcm.subarray(p.start, p.end)), `part-${i + 1}.wav`);
            if (known.length) form.append('known', JSON.stringify(known));
            const segs = await improvePiece(form, signal, () => status('Waiting for a turn — other recordings are being transcribed…', (i + 0.1) / pieces.length));
            const offsetS = p.start / IMPROVE_RATE;
            // A known voice comes back under its name; a new one as a letter, which means
            // nothing outside this piece — so each gets a name of its own here.
            const local = new Map();
            for (const g of segs) {
                let voice = known.some((k) => k.name === g.speaker) ? g.speaker : local.get(g.speaker);
                if (!voice) { voice = `Voice ${++voices}`; local.set(g.speaker, voice); }
                all.push({ voice, piece: i, start: g.start + offsetS, end: g.end + offsetS, text: g.text });
            }
            // Samples of the newly heard voices, most talkative first, while there's room.
            if (i < pieces.length - 1) {
                const talk = new Map();
                for (const v of local.values()) talk.set(v, 0);
                for (const g of all) if (talk.has(g.voice)) talk.set(g.voice, talk.get(g.voice) + (g.end - g.start));
                for (const [voice] of [...talk].sort((a, b) => b[1] - a[1])) {
                    if (known.length >= 4) break;
                    // Their turns in this piece, longest first, joined until there's enough
                    // to recognise them by: someone who only spoke in short bursts counts too.
                    const turns = all.filter((g) => g.voice === voice && g.piece === i).sort((a, b) => (b.end - b.start) - (a.end - a.start));
                    const parts = [];
                    let have = 0;
                    for (const g of turns) {
                        if (have >= IMPROVE_SAMPLE_S[1]) break;
                        const len = Math.min(g.end - g.start, IMPROVE_SAMPLE_S[1] - have);
                        const from = Math.round(((g.start + g.end) / 2 - len / 2) * IMPROVE_RATE);
                        parts.push(pcm.subarray(from, from + Math.round(len * IMPROVE_RATE)));
                        have += len;
                    }
                    if (have < IMPROVE_SAMPLE_S[0]) continue;
                    const sample = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
                    let at = 0;
                    for (const a of parts) { sample.set(a, at); at += a.length; }
                    known.push({ name: voice, sample: await blobDataUrl(wavBlob(sample)) });
                }
            }
        }
        return all;
    }

    async function runImprove(source) {
        if (improveRun) return;
        const controller = new AbortController();
        const epoch = sessionEpoch;
        improveRun = { controller };
        reflectImprove();
        improveStatus('Reading the recording…', { progress: 0, cancel: true });
        try {
            const blob = source.file || await (await fetch(source.url)).blob();
            const pcm = await decodeMono16k(blob);
            if (!pcm.length) throw new Error('The recording is empty.');
            const all = await transcribeRecording(pcm, controller.signal, (text, progress) => improveStatus(text, { progress, cancel: true }));
            if (epoch !== sessionEpoch) return;
            if (!all.length) throw new Error('No speech came back from the recording.');
            const named = applyImproved(all, source.offsetMs || 0, pcm.length / IMPROVE_RATE);
            const matchedNote = named.matched === named.speakers ? ', all matched to names' : named.matched ? `, ${named.matched} matched to names` : '';
            improveStatus(`Transcript improved — ${named.speakers} speaker${named.speakers === 1 ? '' : 's'} told apart${matchedNote}. The summary is being rebuilt.`, { undo: true });
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            if (err.name === 'AbortError') { improveStatus('Cancelled — the transcript is unchanged.'); return; }
            console.error('ReVerb improve error:', err);
            improveStatus(`${err.message || 'Something went wrong.'} The transcript is unchanged.`, { retry: () => runImprove(source) });
        } finally {
            if (epoch === sessionEpoch) improveRun = null;
            reflectImprove();
        }
    }

    // Name each voice by who the live transcript said was speaking while it spoke: the overlap
    // in time, weighted up for names the user set and down for placeholders. Two voices heard in
    // the same piece are two people, so a name never covers both; a voice first heard in a later
    // piece may well be someone from an earlier one, so across pieces it can. A voice nobody can
    // be matched to keeps a numbered label the user can rename.
    function applyImproved(all, offsetMs, durationS) {
        const spanStart = offsetMs, spanEnd = offsetMs + durationS * 1000;
        // When each live line was spoken: it was logged as it ended, and it began after the line
        // before it ended — or, for the first, about as long before as its words take to say.
        const spoken = [];
        let prevT = -Infinity;
        for (const s of segments) {
            if (!Number.isFinite(s.t)) continue;
            const start = Math.max(prevT, s.t - Math.min(30000, Math.max(1200, wordCount(s.text) * 380)));
            if (s.speaker) spoken.push({ s, sa: start, sb: s.t });
            prevT = s.t;
        }
        const votes = new Map();
        for (const g of all) {
            const a = spanStart + g.start * 1000, b = spanStart + g.end * 1000;
            for (const { s, sa, sb } of spoken) {
                const overlap = Math.min(b, sb) - Math.max(a, sa);
                if (overlap <= 0) continue;
                const name = resolveSpeaker(s.speaker);
                const w = overlap * (s.byUser ? 2 : isPlaceholder(name) ? 0.5 : 1);
                const m = votes.get(g.voice) || new Map();
                m.set(name, (m.get(name) || 0) + w);
                votes.set(g.voice, m);
            }
        }
        const pairs = [];
        for (const [voice, m] of votes) {
            const total = [...m.values()].reduce((x, y) => x + y, 0);
            for (const [name, w] of m) pairs.push({ voice, name, w, share: w / total });
        }
        pairs.sort((x, y) => y.w - x.w);
        const piecesOf = new Map();
        for (const g of all) piecesOf.set(g.voice, (piecesOf.get(g.voice) || new Set()).add(g.piece));
        const nameOf = new Map(), holders = new Map();    // name -> voices it already covers
        const clash = (voice, name) => (holders.get(name) || []).some((v) => [...piecesOf.get(v)].some((pc) => piecesOf.get(voice).has(pc)));
        const give = (p) => { nameOf.set(p.voice, p.name); holders.set(p.name, [...(holders.get(p.name) || []), p.voice]); };
        for (const p of pairs) {
            if (!nameOf.has(p.voice) && p.share >= 0.4 && !clash(p.voice, p.name)) give(p);
        }
        // A voice whose likeliest name went to someone else in the same piece — a slice of speech
        // cut at a piece boundary, say — takes its best remaining name on a lower bar: the model
        // has already said it isn't that other person.
        for (const p of pairs) {
            if (!nameOf.has(p.voice) && p.share >= 0.15 && !clash(p.voice, p.name)) give(p);
        }
        const taken = new Set(holders.keys());
        const used = new Set([...segments.map((s) => s.speaker).filter(Boolean), ...taken]);
        let n = 1;
        const distinct = [...new Set(all.map((g) => g.voice))];
        for (const voice of distinct) {
            if (nameOf.has(voice)) continue;
            while (used.has(`Speaker ${n}`)) n++;
            nameOf.set(voice, `Speaker ${n}`);
            used.add(`Speaker ${n}`);
        }

        improveUndo = {
            segments: segments.map(({ el, tag, ...s }) => ({ ...s })),
            participants: participants.map((p) => ({ ...p })),
            todos: todos.map((t) => ({ ...t })),
        };
        const kept = segments.filter((s) => !Number.isFinite(s.t) || s.t < spanStart || s.t > spanEnd + 2000);
        const fresh = all.map((g) => ({
            id: `seg-${segmentSeq++}`, text: g.text, edited: false, low: false,
            speaker: nameOf.get(g.voice), confident: true, byUser: false, improved: true,
            t: Math.round(spanStart + g.end * 1000),
        }));
        const order = (s) => (Number.isFinite(s.t) ? s.t : -1);
        replaceSegments([...kept, ...fresh].sort((x, y) => order(x) - order(y)));
        const realNames = [...nameOf.values()].filter((nm) => !isPlaceholder(nm));
        participants = dedupeParticipants([...participants, ...realNames.map((name) => ({ name }))]);
        afterTranscriptReplaced();
        const finalNames = new Set(distinct.map((v) => nameOf.get(v)));
        return { speakers: finalNames.size, matched: [...finalNames].filter((nm) => !isPlaceholder(nm)).length };
    }

    function replaceSegments(list) {
        segments.length = 0;
        segmentsEl.replaceChildren();
        for (const seg of list) {
            seg.tag = null;
            segments.push(seg);
            segmentsEl.append(renderSegment(seg), document.createTextNode(' '));
        }
        refreshSpeakerTags();
        // To-dos point at the line nearest to when they were said.
        for (const todo of todos) {
            if (!Number.isFinite(todo.t)) continue;
            let best = null;
            for (const s of segments) if (Number.isFinite(s.t) && (!best || Math.abs(s.t - todo.t) < Math.abs(best.t - todo.t))) best = s;
            todo.seg = best ? best.id : null;
        }
        renderTodos();
    }

    // The summary was built from the old words: rebuild it from the new ones, whole.
    function afterTranscriptReplaced() {
        renderMeetingState();
        persistTranscript(true);
        lastStateSegment = 0;
        lastFullAt = 0;
        charsSinceState = Math.max(charsSinceState, 1);
        runState({ full: true });
    }

    function undoImprove() {
        if (!improveUndo) return;
        const snap = improveUndo;
        improveUndo = null;
        const list = snap.segments.map((s) => ({ ...s }));
        for (const s of list) {
            const n = Number(String(s.id).replace('seg-', ''));
            if (Number.isFinite(n) && n >= segmentSeq) segmentSeq = n + 1;
        }
        todos.length = 0;
        todos.push(...snap.todos);
        replaceSegments(list);
        participants = snap.participants;
        afterTranscriptReplaced();
        improveStatus('Back to the live transcript.');
        setTimeout(() => { if (!improveRun && !improveUndo) $('improve-bar').classList.add('hidden'); }, 4000);
    }

    // ---------- alerts ----------
    // For the decisions that can't be undone. The safe choice is the easy one: Escape and a
    // click outside both cancel, and focus starts on the default, never on a destructive button.
    let alertDone = null;
    function showAlert({ title, message, actions }) {
        const box = $('alert'), list = $('alert-actions');
        $('alert-title').textContent = title;
        $('alert-message').textContent = message || '';
        list.replaceChildren();
        list.classList.toggle('pair', actions.length === 2);
        let focus = null;
        const close = () => { box.classList.add('hidden'); alertDone = null; };
        for (const a of actions) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = a.label;
            if (a.style === 'default') b.className = 'default';
            if (a.style === 'destructive') b.className = 'destructive';
            b.addEventListener('click', () => { close(); if (a.run) a.run(); });
            list.append(b);
            if (a.style === 'default' || (!focus && a.style === 'cancel')) focus = b;
        }
        alertDone = () => { close(); const c = actions.find((a) => a.style === 'cancel'); if (c && c.run) c.run(); };
        box.classList.remove('hidden');
        (focus || list.firstChild).focus();
    }

    // Ending erases the meeting, so it asks once — and offers to keep the recap first, the
    // way a document asks before closing unsaved.
    function confirmEnd() {
        if (!segments.length) { endSession(); return; }
        const saved = readLibrary().some((e) => e.id === meetingId());
        const erases = 'This clears the transcript, insights, to-dos and brief from this screen and this browser.';
        showAlert(saved ? {
            title: 'End This Session?',
            message: `${erases} The copy you saved stays in Past Meetings, where you can open it and ask about it.`,
            actions: [{ label: 'Cancel', style: 'cancel' }, { label: 'End Session', style: 'destructive', run: endSession }],
        } : {
            title: 'End This Session?',
            message: `${erases} Save it to Past Meetings to keep the recap and transcript, and ask about it later.`,
            actions: [
                { label: 'Save and End', style: 'default', run: () => { recapShown = null; saveToLibrary(); endSession(); } },
                { label: 'End Without Saving', style: 'destructive', run: endSession },
                { label: 'Cancel', style: 'cancel' },
            ],
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // ---------- transcript segments ----------
    function addSegment(text, opts) {
        const clean = text.trim();
        if (!clean) return;

        // `at` is when the line arrived, by the wall clock: what lines it up with the audio for
        // telling the user's voice apart. Not saved: after a reload there is no audio to match.
        const segment = { id: `seg-${segmentSeq++}`, text: clean, edited: false, low: Boolean(opts && opts.low), t: meetingClock(), at: Date.now() };
        segments.push(segment);

        const atBottom = transcriptAtBottom();
        if (markResumeSeam) {
            markResumeSeam = false;
            segmentsEl.append(el('span', 'resume-mark', '— resumed —'), document.createTextNode(' '));
        }
        segmentsEl.append(renderSegment(segment), document.createTextNode(' '));
        followTranscript(atBottom);

        charsSinceState += clean.length;
        charsSinceSweep += clean.length;
        charsSinceQuestions += clean.length;
        persistTranscript();
        if (segments.length === 1) reflectChatReady();
    }

    // Attribution arrives up to a minute after the words did, so every segment keeps a
    // handle on its own node and the labels are threaded in afterwards. Re-rendering the
    // whole transcript instead would discard whatever line the user is mid-way through
    // correcting.
    function refreshSpeakerTags() {
        let last = null;
        for (const seg of segments) {
            const wanted = seg.speaker && seg.speaker !== last ? seg.speaker : null;
            last = seg.speaker || last;

            if (!wanted) {
                if (seg.tag) { seg.tag.remove(); seg.tag = null; }
                continue;
            }
            if (!seg.tag) {
                seg.tag = el('span', 'speaker-tag');
                seg.tag.setAttribute('role', 'button');
                seg.tag.tabIndex = 0;
                if (seg.el && seg.el.parentNode) seg.el.parentNode.insertBefore(seg.tag, seg.el);
            }
            seg.tag.dataset.seg = seg.id;
            seg.tag.textContent = wanted;
            seg.tag.classList.toggle('tentative', seg.confident === false);
            seg.tag.title = (seg.byUser ? 'Set by you'
                : seg.voice === 'you' && wanted === 'You' ? 'Recognised by your voice'
                : seg.confident === false ? 'Grouped by turn-taking — not positively identified'
                : 'Identified from the conversation') + ' · click to change who said this';
        }
    }

    function renderSegment(segment) {
        const span = el('span', 'segment' + (segment.edited ? ' edited' : '') + (segment.low ? ' low-conf' : ''), segment.text);
        span.dataset.id = segment.id;
        segment.el = span;
        span.title = segment.low ? 'Low confidence — click to correct' : 'Click to correct';

        span.addEventListener('click', () => {
            if (span.isContentEditable) return;
            span.contentEditable = 'true';
            span.focus();
        });
        span.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
            else if (e.key === 'Escape') { span.textContent = segment.text; span.blur(); }
        });
        span.addEventListener('blur', () => commitEdit(span, segment));
        return span;
    }

    function commitEdit(span, segment) {
        span.contentEditable = 'false';
        const next = span.textContent.trim();
        if (!next) { span.textContent = segment.text; return; }   // don't allow deletion by emptying
        if (next === segment.text) return;

        const learned = newTerms(segment.text, next);
        segment.text = next;
        segment.edited = true;
        segment.low = false;              // a human has vouched for it now
        span.classList.add('edited');
        span.classList.remove('low-conf');
        span.title = 'Corrected';
        correctionsChanged();

        // The payoff: a term you fix once stops being mangled for the rest of the meeting.
        if (learned.length) learnKeywords(learned);
    }

    // ---------- to-dos and glossary ----------
    const clipText = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const plainText = (md) => clipText(String(md || '').replace(/\*\*|__|`|^#+\s*/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), 400);

    function noteTodo(meta, seg) {
        const title = clipText(meta.title || meta.claim, 160);
        if (!title || todos.some((t) => t.title.toLowerCase() === title.toLowerCase())) return;
        todos.push({
            id: `todo-${todoSeq++}`, title,
            task: clipText(meta.claim || meta.title, 240), owner: clipText(meta.owner, 60), due: clipText(meta.due, 60),
            done: false, t: seg && Number.isFinite(seg.t) ? seg.t : meetingClock(), seg: seg ? seg.id : null, byUser: false,
        });
        renderTodos();
        stateBar.classList.remove('hidden');
        persistTranscript();
    }

    // Accepted, handed over or re-dated in the room. A to-do the user has edited keeps their version.
    function updateTodo(meta) {
        const want = clipText(meta.supersedes, 160).toLowerCase();
        const todo = todos.find((t) => t.title.toLowerCase() === want);
        if (!todo || todo.byUser) return;
        if (meta.claim) todo.task = clipText(meta.claim, 240);
        if (meta.owner) todo.owner = clipText(meta.owner, 60);
        if (meta.due) todo.due = clipText(meta.due, 60);
        renderTodos();
        persistTranscript();
    }

    function noteGlossary(term, definition, seg) {
        const t = clipText(term, 80), d = plainText(definition);
        if (!t || !d || glossary.some((g) => g.term.toLowerCase() === t.toLowerCase())) return;
        glossary.push({ term: t, definition: d, t: seg && Number.isFinite(seg.t) ? seg.t : meetingClock() });
        renderGlossary();
        persistTranscript();
    }

    // "Not useful" on a card means its to-do or its definition wasn't wanted either.
    function forgetCardProducts(card) {
        const title = (card.dataset.title || '').trim().toLowerCase();
        if (!title) return;
        if (card.dataset.type === 'action') {
            const i = todos.findIndex((t) => !t.byUser && t.title.toLowerCase() === title);
            if (i >= 0) { todos.splice(i, 1); renderTodos(); }
        } else if (card.dataset.type === 'explanation') {
            const i = glossary.findIndex((g) => g.term.toLowerCase() === title);
            if (i >= 0) { glossary.splice(i, 1); renderGlossary(); }
        }
    }

    function renderTodos() {
        if (todoEditing) return;     // never pull a form out from under the person typing in it
        const list = $('todo-list');
        list.replaceChildren(...todos.map(todoRow));
        $('todo-empty').hidden = todos.length > 0;
    }

    function todoRow(todo) {
        const li = el('li', 'todo' + (todo.done ? ' done' : ''));
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = todo.done;
        box.setAttribute('aria-label', `Done: ${todo.task}`);
        box.addEventListener('change', () => {
            todo.done = box.checked;
            li.classList.toggle('done', todo.done);
            persistTranscript();
        });
        const text = el('span', 'todo-text');
        text.append(el('span', 'todo-main', todo.task));
        const meta = el('span', 'todo-meta', [todo.owner, todo.due ? `due ${todo.due}` : ''].filter(Boolean).join(' · '));
        const seg = todo.seg && segments.find((s) => s.id === todo.seg);
        if (seg && Number.isFinite(seg.t)) {
            const when = el('button', 'cite', `${Math.floor(seg.t / 60000)}m`);
            when.type = 'button';
            when.dataset.seg = seg.id;
            when.title = 'Show where this was said';
            meta.append(' ', when);
        }
        if (meta.childNodes.length) text.append(meta);
        const actions = el('span', 'todo-actions');
        const edit = el('button', '', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', () => openTodoForm(todo, li));
        const del = el('button', '', 'Remove');
        del.type = 'button';
        del.addEventListener('click', () => {
            todos.splice(todos.indexOf(todo), 1);
            renderTodos();
            persistTranscript();
        });
        actions.append(edit, del);
        li.append(box, text, actions);
        return li;
    }

    // One small form, for a new to-do or an existing one.
    function openTodoForm(todo, replace) {
        if (todoEditing) return;
        todoEditing = todo ? todo.id : 'new';
        const form = el('li', 'todo-form');
        const field = (label, value) => {
            const i = document.createElement('input');
            i.type = 'text';
            i.placeholder = label;
            i.setAttribute('aria-label', label);
            i.value = value || '';
            i.maxLength = label === 'What' ? 240 : 60;
            return i;
        };
        const task = field('What', todo && todo.task), owner = field('Who', todo && todo.owner), due = field('By when', todo && todo.due);
        const row = el('div', 'row');
        row.append(owner, due);
        const buttons = el('div', 'buttons');
        const cancel = el('button', 'cancel', 'Cancel');
        const save = el('button', 'save', 'Save');
        cancel.type = save.type = 'button';
        buttons.append(cancel, save);
        form.append(task, row, buttons);
        const close = () => { todoEditing = null; renderTodos(); };
        const commit = () => {
            const t = clipText(task.value, 240);
            if (!t) { close(); return; }
            if (todo) Object.assign(todo, { task: t, owner: clipText(owner.value, 60), due: clipText(due.value, 60), byUser: true });
            else todos.push({ id: `todo-${todoSeq++}`, title: t, task: t, owner: clipText(owner.value, 60), due: clipText(due.value, 60), done: false, t: meetingClock(), seg: null, byUser: true });
            close();
            persistTranscript();
        };
        cancel.addEventListener('click', close);
        save.addEventListener('click', commit);
        form.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        if (replace) replace.replaceWith(form);
        else $('todo-list').append(form);
        $('todo-empty').hidden = true;
        task.focus();
    }

    function renderGlossary() {
        const dl = $('glossary-list');
        dl.replaceChildren();
        for (const g of glossary) dl.append(el('dt', '', g.term), el('dd', '', g.definition));
        $('glossary-block').hidden = !glossary.length;
    }

    // ---------- conversation balance ----------
    // Share of the words said, by speaker — a fair stand-in for airtime, since lines are cut
    // where people pause — and how long since each last spoke.
    function talkShares() {
        const by = new Map();
        let total = 0;
        segments.forEach((s, i) => {
            if (!s.speaker) return;
            const n = wordCount(s.text);
            const row = by.get(s.speaker) || { name: s.speaker, words: 0, lines: 0, confident: false };
            row.words += n;
            row.lines += 1;
            row.lastIdx = i;
            row.last = s;
            row.confident = row.confident || s.confident !== false;
            by.set(s.speaker, row);
            total += n;
        });
        return [...by.values()].map((r) => ({ ...r, share: total ? r.words / total : 0 })).sort((a, b) => b.share - a.share);
    }

    function renderBalance() {
        const rows = talkShares();
        const now = meetingClock();
        const list = $('balance-list');
        list.replaceChildren();
        for (const r of rows.slice(0, 8)) {
            const lastT = r.last && Number.isFinite(r.last.t) ? r.last.t : null;
            const ago = lastT != null ? Math.floor((now - lastT) / 60000) : null;
            const row = el('li', 'balance-row' + (ago != null && ago * 60000 >= QUIET_AFTER_MS ? ' quiet' : ''));
            const bar = el('span', 'balance-bar');
            const fill = el('span');
            fill.style.width = `${Math.max(2, Math.round(r.share * 100))}%`;
            bar.append(fill);
            row.append(el('span', 'balance-name', r.name), bar,
                el('span', 'balance-when', `${Math.round(r.share * 100)}%${ago != null && ago >= 1 ? ` · ${ago}m ago` : ''}`));
            row.title = `${r.name}: ${Math.round(r.share * 100)}% of what was said${ago != null ? `, last heard ${ago < 1 ? 'just now' : `${ago} min ago`}` : ''}`;
            list.append(row);
        }
        list.hidden = rows.length < 2;
        $('balance-empty').hidden = rows.length >= 2;

        // The clock against the plan, and the agenda against the clock.
        const line = $('time-line');
        const mins = Math.round(now / 60000);
        const planned = session.durationMin;
        const agenda = meetingState && Array.isArray(meetingState.agenda) ? meetingState.agenda.filter((a) => a && a.item) : [];
        if (!startedAt || (!planned && !agenda.length)) { line.hidden = true; return; }
        line.hidden = false;
        line.replaceChildren();
        const covered = agenda.filter((a) => a.status === 'covered').length;
        line.append(el('span', '', [
            planned ? `${mins} of ${planned} min` : `${mins} min so far`,
            agenda.length ? `${covered} of ${agenda.length} agenda item${agenda.length === 1 ? '' : 's'} covered` : '',
        ].filter(Boolean).join(' · ')));
        line.classList.toggle('over', Boolean(planned && mins > planned));
        if (planned) {
            const bar = el('span', 'balance-bar');
            bar.style.display = 'block';
            const fill = el('span');
            fill.style.width = `${Math.min(100, Math.round((mins / planned) * 100))}%`;
            bar.append(fill);
            line.append(bar);
        }
    }

    function checkQuietVoices() {
        if (!lanesLive() || !enabledTypes.has('quiet')) return;
        const rows = talkShares();
        if (rows.length < 3) return;
        const now = meetingClock();
        for (const r of rows) {
            if (isPlaceholder(r.name) || !r.confident || r.lines < QUIET_MIN_LINES || !r.last) continue;
            if (!Number.isFinite(r.last.t) || now - r.last.t < QUIET_AFTER_MS) continue;
            if (segments.length - 1 - r.lastIdx < QUIET_GAP_LINES) continue;
            if (quietNudged[r.name] && now - quietNudged[r.name] < QUIET_RENAG_MS) continue;
            quietNudged[r.name] = now;
            showQuietCard(r.name, Math.floor((now - r.last.t) / 60000), r.last);
            return;     // one at a time
        }
    }

    function showQuietCard(name, mins, seg) {
        const card = placeCard(++cardOrder);
        const refs = renderSkeleton(card, { type: 'quiet', title: `${name} hasn’t spoken in ${mins} minutes` });
        const topics = meetingState && Array.isArray(meetingState.topics) ? meetingState.topics.filter((t) => t && t.name) : [];
        const topic = topics.length ? topics[topics.length - 1].name : '';
        const first = name.split(/\s+/)[0];
        refs.gist.innerHTML = renderMarkdown(`Last heard at ${Math.floor(seg.t / 60000)}m.${topic ? ` Worth bringing ${first} in on **${topic}**.` : ` Worth bringing ${first} back in.`}`)
            + askLine(`${first}, what’s your take?`);
        refs.toggle.hidden = true;
        addCardSource(card, seg);
        bumpStat('cards', 'quiet');
    }

    // ---------- corrections ----------
    // The summary was written from the record as it stood. A fixed line is caught by the
    // next pass that reads it; a renamed speaker or a new note changes how the whole meeting
    // reads, so while listening the next pass re-reads everything. After the meeting nothing
    // else would ever refresh it, so a rebuild follows a few seconds after the last fix —
    // which is what makes the copied summary come out corrected.
    function correctionsChanged(opts) {
        persistTranscript();
        const wholeRecord = Boolean(opts && opts.wholeRecord);
        if (isListening) {
            if (wholeRecord) { lastFullAt = 0; charsSinceState = Math.max(charsSinceState, 1); }
            return;
        }
        if (!segments.length) return;
        clearTimeout(correctionTimer);
        const epoch = sessionEpoch;
        correctionTimer = setTimeout(() => {
            correctionTimer = 0;
            if (epoch === sessionEpoch && !isListening && segments.length) runState({ full: true });
        }, CORRECTION_SETTLE_MS);
    }

    const isPlaceholder = (name) => /^speaker\s*\d+$/i.test(String(name || '').trim());
    const resolveSpeaker = (label) => speakerAliases[label] || label;

    // One entry per name, the first role given kept.
    function dedupeParticipants(list) {
        const seen = new Map();
        for (const p of list) {
            if (!p || !p.name) continue;
            const key = p.name.trim().toLowerCase();
            const had = seen.get(key);
            if (!had) seen.set(key, { ...p, name: p.name.trim() });
            else if (!had.role && p.role) had.role = p.role;
        }
        return [...seen.values()];
    }

    function knownSpeakerNames() {
        const names = new Set();
        for (const n of session.roster || []) if (n) names.add(n);
        for (const p of participants) if (p && p.name) names.add(p.name);
        for (const s of segments) if (s.speaker) names.add(s.speaker);
        return [...names];
    }

    let speakerEditing = null;      // { seg, label }

    function openSpeakerEditor(tag) {
        const seg = segments.find((s) => s.id === tag.dataset.seg);
        if (!seg || !seg.speaker) return;
        speakerEditing = { seg, label: seg.speaker, tag };
        const count = segments.filter((s) => s.speaker === seg.speaker).length;
        $('speaker-current').textContent = seg.speaker;
        $('speaker-scope-all').textContent = `Everywhere — all ${count} line${count === 1 ? '' : 's'} labelled “${seg.speaker}”`;
        speakerEditor.querySelector('input[value="all"]').checked = true;
        const list = $('speaker-names');
        list.replaceChildren(...knownSpeakerNames().filter((n) => n !== seg.speaker).map((n) => {
            const o = document.createElement('option');
            o.value = n;
            return o;
        }));
        speakerName.value = isPlaceholder(seg.speaker) ? '' : seg.speaker;
        speakerName.placeholder = isPlaceholder(seg.speaker) ? 'Their name' : '';
        speakerEditor.hidden = false;

        // Under the label, or above it when it sits low on the screen; never off the edge.
        const r = tag.getBoundingClientRect();
        const box = speakerEditor.getBoundingClientRect();
        const left = Math.min(Math.max(8, r.left), window.innerWidth - box.width - 8);
        const below = r.bottom + 6;
        const top = below + box.height > window.innerHeight - 8 ? Math.max(8, r.top - box.height - 6) : below;
        speakerEditor.style.left = `${left}px`;
        speakerEditor.style.top = `${top}px`;
        speakerName.focus();
        speakerName.select();
    }

    function closeSpeakerEditor() {
        if (speakerEditor.hidden) return;
        speakerEditor.hidden = true;
        const tag = speakerEditing && speakerEditing.tag;
        speakerEditing = null;
        if (tag && tag.isConnected) tag.focus({ preventScroll: true });
    }

    function saveSpeakerEditor() {
        const editing = speakerEditing;
        const name = speakerName.value.replace(/\s+/g, ' ').trim().slice(0, 60);
        const scope = (speakerEditor.querySelector('input[name="speaker-scope"]:checked') || {}).value || 'all';
        closeSpeakerEditor();
        if (!editing || !name || name === editing.label) return;
        renameSpeaker(editing.seg, editing.label, name, scope);
    }

    // Everywhere: every line with that label, and the label remembered as an alias so the
    // speaker pass can't bring it back. Just this turn: the run of lines it heads, up to the
    // next speaker — the fix for a turn the turn-taking grouped under the wrong person.
    function renameSpeaker(seg, from, to, scope) {
        const set = (s) => { s.speaker = to; s.confident = true; s.byUser = true; };
        if (scope === 'turn') {
            for (let i = segments.indexOf(seg); i >= 0 && i < segments.length; i++) {
                const s = segments[i];
                if (s.speaker && s.speaker !== from) break;
                if (s.speaker === from) set(s);
            }
        } else {
            for (const s of segments) if (s.speaker === from) set(s);
            delete speakerAliases[to];
            for (const k of Object.keys(speakerAliases)) if (speakerAliases[k] === from) speakerAliases[k] = to;
            speakerAliases[from] = to;
            participants = participants.map((p) => (p && p.name === from ? { ...p, name: to } : p));
            if (meetingState) {
                for (const p of meetingState.positions || []) if (p && p.person === from) p.person = to;
                for (const f of meetingState.figures || []) if (f && f.who === from) f.who = to;
            }
        }
        if (!isPlaceholder(to)) {
            if (!participants.some((p) => p && p.name === to)) participants.push({ name: to });
            // A name in the roster is a name the speech model is told to expect.
            if (!(session.roster || []).includes(to)) { session.roster = [...(session.roster || []), to]; persistSession(); }
            learnKeywords([to]);
        }
        participants = dedupeParticipants(participants);
        refreshSpeakerTags();
        renderMeetingState();
        correctionsChanged({ wholeRecord: true });
    }

    let notesTimer = 0;
    function reflectNotes() {
        const lines = sessionNotes.split('\n').filter((l) => l.trim()).length;
        notesToggle.textContent = lines ? `Corrections (${lines})` : 'Corrections';
    }
    function toggleNotes(open) {
        const show = open != null ? open : notesBox.hidden;
        notesBox.hidden = !show;
        notesToggle.setAttribute('aria-expanded', String(show));
        if (show) notesInput.focus();
    }

    // Words in the correction that weren't in the original — likely what was misheard.
    // Only proper-noun-shaped or jargon-shaped tokens qualify: feeding "the" and "data"
    // to the speech model as keyword hints dilutes the biasing that makes it work.
    const STOPWORDS = new Set(['the','and','that','this','with','from','for','you','are','was','were','have','has','had','not','but','they','their','there','then','than','what','when','which','into','about','would','could','should','been','some','just','like','also','because','very','more','most','over','after','before','while','where','your','our','his','her','its','it’s','one','two','can','will','all','any','how','why','who','use','using','get','got','make','made','need','want','know','think','really','okay','yeah','right','well']);

    function newTerms(before, after) {
        const wordsOf = (s) => new Set((s.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) || []));
        const had = wordsOf(before);
        const candidates = [...new Set(after.match(/[\p{L}\p{N}'’-]+/gu) || [])];
        return candidates.filter((w) => {
            if (w.length < 3 || had.has(w.toLowerCase())) return false;
            if (STOPWORDS.has(w.toLowerCase())) return false;
            // Keep proper nouns, acronyms, CamelCase, hyphenated and digit-bearing terms —
            // the shapes a speech model actually mangles.
            return /^[A-Z]/.test(w) || /[A-Z]{2,}/.test(w) || /[0-9]/.test(w) || /-/.test(w) || w.length >= 8;
        });
    }

    function learnKeywords(terms) {
        const known = new Set(session.keywords.map(k => k.toLowerCase()));
        const added = terms.filter(t => !known.has(t.toLowerCase()));
        if (!added.length) return;
        session.keywords.push(...added);
        if (session.keywords.length > 200) session.keywords.splice(0, session.keywords.length - 200);
        persistSession();
        provider && provider.updateKeywords && provider.updateKeywords(session.keywords);
    }

    // ---------- utterance flushing ----------
    // Flush at a real boundary, not at every full stop.
    function scheduleFlush() {
        const t = pendingUtterance.trim();
        if (!t) return;
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

        if (t.length >= MAX_UTTERANCE) { flushUtterance(); return; }
        // A question mark is the one thing worth acting on immediately — that's the
        // utterance the user is waiting on an answer for.
        if (/[?？؟]["')\]]?\s*$/.test(t) && wordCount(t) >= MIN_ANALYZE_WORDS) { flushUtterance(); return; }

        const endsSentence = /[.!。！｡।]["')\]]?\s*$/.test(t);
        flushTimer = setTimeout(flushUtterance, endsSentence ? BOUNDARY_PAUSE_MS : FLUSH_PAUSE_MS);
    }

    function flushUtterance() {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        const utterance = pendingUtterance.trim();
        const low = pendingLow;
        pendingUtterance = '';
        pendingLow = false;
        pendingEl.textContent = '';
        if (!utterance) return;

        const context = attributedTranscript().slice(-CONTEXT_CHARS);
        addSegment(utterance, { low });
        maybeRunState();
        maybeRunSpeakers();
        maybeRunQuestions();
        if (wordCount(utterance) >= MIN_ANALYZE_WORDS) enqueueAnalysis(utterance, context);
    }

    function onFinalText(text, opts) {
        pendingUtterance += text.endsWith(' ') ? text : text + ' ';
        if (opts && opts.low) pendingLow = true;
        pendingEl.textContent = pendingUtterance;
        followTranscript(transcriptAtBottom());
        scheduleFlush();
    }

    function onInterimText(text) {
        interimEl.textContent = text;
        followTranscript(transcriptAtBottom());
    }

    /** Pull whatever is still on screen as interim text into the pending utterance. */
    function absorbInterim() {
        const trailing = interimEl.textContent.trim();
        if (!trailing) return;
        pendingUtterance += (pendingUtterance.endsWith(' ') || !pendingUtterance ? '' : ' ') + trailing + ' ';
        interimEl.textContent = '';
    }

    // ---------- card type filters ----------
    function loadTypePrefs() {
        try {
            let muted = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
            // From before the newer types: the enabled list of the original six.
            if (!Array.isArray(muted)) {
                const enabled = JSON.parse(localStorage.getItem(LEGACY_FILTER_KEY) || 'null');
                if (Array.isArray(enabled)) muted = LEGACY_FILTER_TYPES.filter((t) => !enabled.includes(t));
            }
            // Absent means never chose, and the default is everything on. Muting every
            // type is a real choice and stays honoured — the filter row shows the greyed
            // chips, so an empty panel explains itself.
            if (Array.isArray(muted)) {
                for (const t of muted) enabledTypes.delete(t);
                persistTypePrefs();
            }
        } catch (err) { /* private mode */ }
    }

    function persistTypePrefs() {
        try {
            localStorage.setItem(FILTER_KEY, JSON.stringify(CARD_TYPE_ORDER.filter((t) => !enabledTypes.has(t))));
            localStorage.removeItem(LEGACY_FILTER_KEY);
        } catch (err) { /* ignore */ }
    }

    // The chips used to change only what the classifier was asked for next, so a card
    // already on screen stayed put and the filter looked broken. Now the muted list sits
    // on the panel and the stylesheet hides those cards, present and future alike.
    function applyTypeFilters() {
        const muted = CARD_TYPE_ORDER.filter((t) => !enabledTypes.has(t));
        insightsContainer.dataset.muted = muted.join(' ');
        filterToggle.textContent = muted.length ? `Filters · ${muted.length} muted` : 'Filters';
        reflectQuestionsButton();
    }

    function resetTypePrefs() {
        enabledTypes.clear();
        for (const t of CARD_TYPE_ORDER) enabledTypes.add(t);
        try { localStorage.removeItem(FILTER_KEY); localStorage.removeItem(LEGACY_FILTER_KEY); } catch (err) { /* ignore */ }
        renderTypeFilters();
        applyTypeFilters();
        typeFilters.classList.add('hidden');
    }

    function renderTypeFilters() {
        typeFilters.replaceChildren();
        for (const type of CARD_TYPE_ORDER) {
            const btn = el('button', 'type-filter', CARD_TYPE_UI[type].label);
            btn.dataset.type = type;
            btn.type = 'button';
            btn.setAttribute('aria-pressed', String(enabledTypes.has(type)));
            btn.addEventListener('click', () => {
                if (enabledTypes.has(type)) enabledTypes.delete(type);
                else enabledTypes.add(type);
                btn.setAttribute('aria-pressed', String(enabledTypes.has(type)));
                persistTypePrefs();
                applyTypeFilters();
            });
            typeFilters.append(btn);
        }
    }

    /**
     * Types that raised a card recently. They are still offered to the classifier, but the
     * server holds them to a much higher bar: leaving them out entirely once let a trivial
     * fact-check hide the one claim in the meeting that was actually wrong.
     */
    function coolingTypes() {
        const now = lanesNow();
        return CARD_TYPE_ORDER.filter((t) => {
            const cd = CARD_TYPE_UI[t].cooldown;
            return enabledTypes.has(t) && cd && now - (typeLastShown[t] || 0) < cd;
        });
    }

    // A card starts its type's cooldown only if it was the kind worth rationing: a fact-check
    // that confirmed a claim, or one retracted before anyone saw it, costs the room nothing.
    function startCooldown(meta, verdict) {
        if (!meta || !CARD_TYPE_UI[meta.type]) return;
        if (meta.type === 'factcheck' && !['incorrect', 'partly'].includes(verdict)) return;
        typeLastShown[meta.type] = lanesNow();
    }

    // ---------- analysis lane (queued, bounded, streamed over SSE) ----------
    const analyzeQueue = [];
    let analyzeActive = 0;

    function parseSse(chunk) {
        let event = 'message', data = '';
        for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        return { event, data: data ? JSON.parse(data) : null };
    }

    // Most lines aren't questions, and only a question (or a held card) needs the whole meeting
    // sent with it — a hundred kilobytes, for a long one.
    const looksLikeQuestion = (t) => /[?？؟]/.test(t)
        || /^\s*(what|who|whom|whose|when|where|why|how|which|did|do|does|is|are|was|were|can|could|should|would|will|have|has|remind)\b/i.test(t);
    const RECORD_CHARS = 100000;
    function meetingRecord() {
        const text = attributedTranscript(0, { timed: true });
        if (text.length <= RECORD_CHARS) return text;
        const tail = text.slice(-RECORD_CHARS);
        const nl = tail.indexOf('\n');
        return nl >= 0 && nl < 2000 ? tail.slice(nl + 1) : tail;
    }

    function enqueueAnalysis(utterance, context) {
        // Every type is muted — there is nothing this utterance could produce, so don't
        // spend the round trip finding that out.
        const types = UTTERANCE_TYPE_ORDER.filter((t) => enabledTypes.has(t));
        if (!types.length) return;

        // No card yet: it appears only once the classifier says there is one. The order is
        // fixed now, though, so cards still sit in the order things were said even when a
        // short answer finishes before a long one that started earlier. segIndex marks
        // where this utterance's "what was said next" begins, for a card that is held.
        queueJob({
            utterance, context, types,
            cooling: coolingTypes(),
            order: ++cardOrder,
            card: null,
            slots: [],
            segIndex: segments.length,
            state: meetingState,
            answered: onScreen(),
            attempt: 0,
        });
    }

    // Beyond MAX_ANALYZE_QUEUE the meeting has moved on, and the oldest fresh utterance goes.
    // A card that already has its type — held, or being retried — is kept over one that
    // may well turn out to be nothing.
    function queueJob(job, front) {
        if (front) analyzeQueue.unshift(job); else analyzeQueue.push(job);
        while (analyzeQueue.length > MAX_ANALYZE_QUEUE) {
            const i = analyzeQueue.findIndex((j) => !j.forced);
            const [dropped] = analyzeQueue.splice(i >= 0 ? i : 0, 1);
            if (dropped.card) removeCard(dropped.card);
            for (const slot of dropped.slots || []) retireSlot(slot);
        }
        pumpAnalysis();
    }

    // A card already classified, sent back to be answered on its own: after a hold, with what
    // the room said in the meantime, or to retry an answer without re-reading the utterance.
    function answerJob(job, slot, attempt, after) {
        slot.finished = false;
        slot.entry = null;
        slot.sourcesEl = null;
        const { hold, card, ...meta } = slot.meta;
        return {
            utterance: job.utterance, context: job.context, types: job.types,
            cooling: [], order: job.order, card: null,
            segIndex: job.segIndex, state: meetingState, answered: [],
            attempt, forced: meta, after: after != null ? after : (job.after || ''),
            slots: [slot],
        };
    }

    function pumpAnalysis() {
        while (analyzeActive < (replay ? REPLAY_CONCURRENCY : MAX_ANALYZE_CONCURRENCY) && analyzeQueue.length) {
            const job = analyzeQueue.shift();
            analyzeActive++;
            runAnalysis(job).finally(() => { analyzeActive--; pumpAnalysis(); });
        }
        reflectActivity();
    }

    function reflectActivity() {
        const pending = analyzeActive + analyzeQueue.length;
        insightsActivity.hidden = pending === 0;
        if (pending) insightsActivity.innerHTML = `${spinnerSvg}<span>Analyzing${pending > 1 ? ` ${pending}` : ''}…</span>`;
    }

    // One utterance can now raise two cards, each streamed on the same response. A slot is one
    // of them: { meta, card, entry, sourcesEl, label, finished }.
    function showSlot(job, slot, meta) {
        slot.meta = meta;
        // A request and its acceptance are one commitment: the second updates the card the
        // first one made instead of adding another.
        const existing = meta.type === 'action' && meta.supersedes && findActionCard(meta.supersedes);
        if (existing) {
            stats.merged++;
            updateActionCard(existing, meta);
            updateTodo(meta);
            retireSlot(slot);
            return;
        }
        // The line that raised it. Analysis is queued right after the line is added.
        slot.source = segments[job.segIndex - 1] || null;
        // Held: nothing on screen yet. The title is remembered now, so a second utterance
        // about the same thing can't raise it while this one waits.
        if (meta.hold) {
            stats.held++;
            if (!slot.label) slot.label = rememberAnswered(meta);
            slot.finished = true;
            scheduleHeld(job, slot);
            return;
        }
        if (!slot.card) slot.card = placeCard(job.order);
        const refs = renderSkeleton(slot.card, meta);
        addCardSource(slot.card, slot.source);
        if (meta.type === 'action') noteTodo(meta, slot.source);
        // An action item is complete as classified — owner, task, deadline — so the server
        // sends no answer and there is nothing to stream into.
        slot.entry = refs.gist ? { ...refs, card: slot.card, type: meta.type, text: '', hasSources: false } : null;
        slot.sourcesEl = refs.sources;
        if (!slot.counted) { slot.counted = true; bumpStat('cards', meta.type); }
        if (!slot.label) slot.label = rememberAnswered(meta);
        if (!slot.entry) finishSlot(slot);
    }

    function finishSlot(slot) {
        if (slot.finished) return;
        slot.finished = true;
        const verdict = slot.entry ? parseVerdict(slot.entry.text).verdict : null;
        startCooldown(slot.meta, verdict);
        if (slot.meta && slot.meta.type === 'explanation' && slot.entry) {
            noteGlossary(slot.meta.term || slot.meta.title, splitGist(slot.entry.text)[0], slot.source);
        }
    }

    // Gone before anyone read it — retracted, superseded, or the meeting moved on. Its subject
    // must not stay suppressed on the strength of a card nobody saw.
    function retireSlot(slot) {
        slot.finished = true;
        forgetAnswered(slot.label);
        slot.label = null;
        if (slot.card) { removeCard(slot.card); slot.card = null; }
    }

    function scheduleHeld(job, slot) {
        const epoch = sessionEpoch;
        const wait = Math.min(Number(slot.meta.hold) || 0, MAX_HOLD_MS);
        const release = () => {
            if (epoch !== sessionEpoch) return;
            if (!enabledTypes.has(slot.meta.type)) { retireSlot(slot); return; }
            // Everything said since, including the sentence still being spoken.
            const after = [attributedTranscript(job.segIndex), pendingUtterance, interimEl.textContent]
                .join(' ').replace(/\s+/g, ' ').trim();
            queueJob(answerJob(job, slot, 0, after), true);
        };
        if (replay) { replay.held.push({ due: replay.clockMs + wait, release }); return; }
        const timer = setTimeout(() => { heldTimers.delete(timer); release(); }, wait);
        heldTimers.add(timer);
    }

    // The stream died on this card. What did arrive is real, and is kept under an honest
    // marker; with nothing yet, the answer is retried on its own — the classify already
    // happened, and repeating it could just as well come back with a different card.
    function salvageSlot(job, slot, why, retryable) {
        if (slot.finished) return;
        if (slot.entry && slot.entry.text.trim()) {
            stats.truncated++;
            slot.finished = true;
            renderIncomplete(job, slot);
            return;
        }
        slot.finished = true;
        if (retryable && job.attempt < ANALYZE_MAX_ATTEMPTS - 1) {
            const wait = ANALYZE_BACKOFF_MS[Math.min(job.attempt, ANALYZE_BACKOFF_MS.length - 1)];
            stats.retries++;
            if (slot.card) resetCardToPending(slot.card, `${why} — retrying…`);
            const epoch = sessionEpoch;
            setTimeout(() => { if (epoch === sessionEpoch) queueJob(answerJob(job, slot, job.attempt + 1), true); }, wait);
            return;
        }
        stats.errors++;
        forgetAnswered(slot.label);
        slot.label = null;
        renderSlotError(job, slot, why);
    }

    async function runAnalysis(job) {
        const controller = new AbortController();
        const epoch = sessionEpoch;
        inflight.add(controller);
        // Two clocks. `stall` is reset by every chunk, so a long-but-alive answer is
        // never cut off; `cap` is the backstop for a connection that trickles forever.
        let stalled = false, expired = false, stallTimer = null;
        const bump = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, ANALYZE_STALL_MS);
        };
        const capTimer = setTimeout(() => { expired = true; controller.abort(); }, ANALYZE_MAX_MS);

        const slots = job.slots || (job.slots = []);
        // A server that predates two-card replies sends no index: everything is card 0.
        const slotAt = (data) => {
            const i = data && Number.isInteger(data.card) && data.card >= 0 && data.card < 4 ? data.card : 0;
            return slots[i] || (slots[i] = { meta: null, card: null, label: null, finished: false });
        };
        let sawMeta = false, sawDone = false;
        const startedAtMs = Date.now();
        let firstTokenAt = 0;

        try {
            bump();
            const resp = await apiFetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    utterance: job.utterance,
                    context: job.context,
                    // roster included: knowing who is in the room is what lets a
                    // conflict card name both sides instead of describing one.
                    session: briefForServer(),
                    state: job.state,
                    answered: job.answered,
                    dismissed: dismissedTitles.slice(-DISMISSED_MEMORY),
                    types: job.types,
                    cooling: job.cooling,
                    bias: { ...typeBias },
                    multi: true,
                    canHold: !job.forced,
                    ...(job.forced ? { card: job.forced, after: job.after || '' } : {}),
                    // The whole meeting, for the cards that must check it: a question that may
                    // already have been answered, and every held card (ask, gap…) before it speaks.
                    ...(job.forced || looksLikeQuestion(job.utterance) ? { transcript: meetingRecord() } : {}),
                })
            });
            if (resp.status === 429) {
                const d = await resp.json().catch(() => ({}));
                throw Object.assign(new Error(d.error || 'Busy — too many requests'), { retryable: d.limit !== 'daily' });
            }
            if (!resp.ok || !resp.body) {
                throw Object.assign(new Error(`Server error ${resp.status}`), { retryable: resp.status >= 500 });
            }

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';

            while (true) {
                const { done, value } = await reader.read();
                if (epoch !== sessionEpoch) return;   // ended while this was streaming
                if (done) break;
                bump();
                buf += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    if (!chunk.trim()) continue;
                    const { event, data } = parseSse(chunk);

                    if (event === 'meta') {
                        sawMeta = true;
                        if (data.type === 'none') {
                            stats.filtered++;
                            if (job.card) { removeCard(job.card); job.card = null; }
                            for (const slot of slots) retireSlot(slot);
                            return;
                        }
                        showSlot(job, slotAt(data), data);
                    } else if (event === 'drop') {
                        // The answer model looked at the full picture — including, for a held
                        // card, what the room said next — and decided this wasn't worth
                        // raising. Better a card that never appears than a confident
                        // non-observation.
                        stats.dropped++;
                        if (job.after) stats.heldDropped++;
                        retireSlot(slotAt(data));
                    } else if (event === 'delta') {
                        const slot = slotAt(data);
                        if (!slot.entry) continue;
                        if (!firstTokenAt) firstTokenAt = Date.now();
                        slot.entry.text += data.text || '';
                        markAnswerDirty(slot.entry);
                    } else if (event === 'sources') {
                        const slot = slotAt(data);
                        if (!slot.sourcesEl) continue;
                        renderSources(slot.sourcesEl, data.sources || []);
                        if (slot.entry && data.sources && data.sources.length) { slot.entry.hasSources = true; markAnswerDirty(slot.entry); }
                    } else if (event === 'end') {
                        finishSlot(slotAt(data));
                    } else if (event === 'done') {
                        sawDone = true;
                        for (const slot of slots) if (slot.meta && !slot.finished) finishSlot(slot);
                        if (slots.some((slot) => slot.entry)) {
                            stats.answers.push({
                                ms: Date.now() - startedAtMs,
                                firstTokenMs: firstTokenAt ? firstTokenAt - startedAtMs : null,
                            });
                        }
                    } else if (event === 'error') {
                        // The server now says whether it is worth another go, and, with two
                        // cards in flight, which card it was about.
                        const message = (data && data.message) || 'Analysis failed';
                        const retryable = Boolean(data && data.retryable);
                        if (data && Number.isInteger(data.card)) salvageSlot(job, slotAt(data), message, retryable);
                        else throw Object.assign(new Error(message), { retryable });
                    }
                }
            }

            // The stream ended without the server saying it was finished. Everything
            // above this line succeeded, so there may be a usable partial answer —
            // which is worth more than replacing it with an error.
            if (!sawDone) {
                if (!sawMeta && !job.forced) throw Object.assign(new Error('Connection dropped'), { retryable: true });
                for (const slot of slots) if (slot.meta) salvageSlot(job, slot, 'Answer was cut off', true);
            }
        } catch (err) {
            if (epoch !== sessionEpoch) return;   // aborted by End session, not a failure
            console.error('ReVerb analyze error:', err);

            // A stall or the hard cap present as AbortError, so the flags say which.
            const why = stalled ? 'The answer stopped partway'
                : expired ? 'Took too long'
                : err.name === 'AbortError' ? 'Timed out'
                : err.message || 'Analysis failed';
            // Network failures throw TypeError. Those, stalls and 5xx are all worth
            // retrying; a 4xx or a malformed response is not.
            const retryable = stalled || expired || err.retryable === true || err.name === 'TypeError';

            if (stalled) stats.stalls++;

            // Cards that already have their type are retried one by one, answer only.
            const open = slots.filter((slot) => slot.meta && !slot.finished);
            if (open.length) { for (const slot of open) salvageSlot(job, slot, why, retryable); return; }
            if (sawMeta || job.forced) return;

            // Nothing classified yet: the whole utterance goes round again.
            if (retryable && job.attempt < ANALYZE_MAX_ATTEMPTS - 1) {
                const wait = ANALYZE_BACKOFF_MS[Math.min(job.attempt, ANALYZE_BACKOFF_MS.length - 1)];
                job.attempt++;
                stats.retries++;
                // Before the classifier answered there is no card to reset; the header
                // indicator already says work is in flight.
                if (job.card) resetCardToPending(job.card, `${why} — retrying…`);
                setTimeout(() => { if (epoch === sessionEpoch) { job.slots = []; queueJob(job, true); } }, wait);
            } else {
                stats.errors++;
                renderCardError(job, why);
            }
        } finally {
            clearTimeout(stallTimer);
            clearTimeout(capTimer);
            inflight.delete(controller);
            reflectActivity();
        }
    }

    function rememberAnswered(meta) {
        // claim covers fact-check, conflict, dig-deeper and action — without it those
        // four would fall through and the classifier would happily raise them twice.
        const label = meta.title || meta.question || meta.term || meta.claim;
        if (!label) return null;
        // Typed, so the classifier can tell an [action] it may update from a card it must
        // not repeat.
        const stored = { type: meta.type, title: String(label).slice(0, 120) };
        answeredTitles.push(stored);
        if (answeredTitles.length > ANSWERED_MEMORY * 2) answeredTitles.splice(0, answeredTitles.length - ANSWERED_MEMORY);
        persistTranscript();
        return stored;
    }

    // A card is remembered the moment its title arrives, so two analyses in flight can't
    // both raise the same thing. If that card then gets dropped or fails, the memory has
    // to be undone — otherwise the subject is suppressed for the rest of the meeting on
    // the strength of a card nobody ever saw.
    function forgetAnswered(entry) {
        if (!entry) return;
        const i = answeredTitles.lastIndexOf(entry);
        if (i >= 0) answeredTitles.splice(i, 1);
    }

    // ---------- slow lane: who is speaking ----------
    // Runs behind the transcript rather than in front of it: a label that appears a
    // minute late is fine, a wrong label shown instantly is not.
    function maybeRunSpeakers(force) {
        if (speakersRunning) return;
        const pending = [];
        segments.forEach((seg, i) => { if (!seg.speaker) pending.push(i); });
        if (!pending.length) return;
        if (!force) {
            if (pending.length < SPEAKER_MIN_NEW) return;
            if (Date.now() - lastSpeakerRun < SPEAKER_INTERVAL_MS) return;
        }
        runSpeakers(pending);
    }

    async function runSpeakers(pending) {
        speakersRunning = true;
        lastSpeakerRun = Date.now();
        stats.speakerRuns++;

        // Oldest first: the unattributed lines nearest the already-labelled ones are the
        // ones the model can place from context, and a backlog drains in order.
        const window = pending.slice(0, SPEAKER_MAX_TURNS);
        const turns = window.map((i) => ({ i, text: segments[i].text }));
        const attributed = segments
            .filter((seg) => seg.speaker)
            .slice(-12)
            .map((seg) => ({ speaker: seg.speaker, text: seg.text }));

        const controller = new AbortController();
        const epoch = sessionEpoch;
        inflight.add(controller);
        const timeout = setTimeout(() => controller.abort(), SPEAKER_TIMEOUT_MS);
        try {
            const resp = await apiFetch(speakersUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({ turns, attributed, session: briefForServer({ materials: false }) }),
            });
            const data = await resp.json().catch(() => ({}));
            if (epoch !== sessionEpoch) return;
            if (!resp.ok) throw new Error(data.error || `server ${resp.status}`);

            for (const t of data.turns || []) {
                const seg = segments[t.i];
                // A line labelled meanwhile — by the user — keeps that label.
                if (!seg || !t.speaker || seg.speaker) continue;
                const label = String(t.speaker).slice(0, 60);
                seg.speaker = resolveSpeaker(label);
                // A renamed placeholder is a person the user has identified.
                seg.confident = seg.speaker !== label || t.confident !== false;
            }
            if (Array.isArray(data.participants) && data.participants.length) {
                // The model only knows the labels it used; names the user gave stay in.
                const named = segments.filter((s) => s.byUser && !isPlaceholder(s.speaker)).map((s) => ({ name: s.speaker }));
                participants = dedupeParticipants([
                    ...data.participants.map((p) => (p && p.name ? { ...p, name: resolveSpeaker(String(p.name).slice(0, 60)) } : null)),
                    ...named,
                ]);
            }
            refreshSpeakerTags();
            renderMeetingState();
            persistTranscript(true);
        } catch (err) {
            // Silent on purpose: an unlabelled transcript is still a good transcript,
            // and this lane must never be the thing that puts an error on screen.
            if (epoch !== sessionEpoch) return;
            stats.speakerFails++;
            console.error('ReVerb speakers error:', err);
        } finally {
            clearTimeout(timeout);
            inflight.delete(controller);
            speakersRunning = false;
        }
    }

    // ---------- slow lane: the sweep ----------
    // What no single line shows: a question the room moved past, an argument on its third
    // lap, a decision everyone is acting on that nobody made, two people meaning different
    // things by one word, time going to the wrong thing. Silent when it fails, like the
    // other slow lanes — a missed sweep costs nothing the next one won't catch.
    function maybeRunSweep() {
        if (sweepRunning || sweepUnsupported || !lanesLive()) return;
        if (charsSinceSweep < SWEEP_MIN_NEW_CHARS) return;
        if (lanesNow() - lastSweepAt < SWEEP_INTERVAL_MS) return;
        runSweep();
    }

    async function runSweep() {
        const types = SWEEP_TYPE_ORDER.filter((t) => enabledTypes.has(t));
        if (!types.length) return;
        sweepRunning = true;
        lastSweepAt = lanesNow();
        const spent = charsSinceSweep;
        charsSinceSweep = 0;
        stats.sweeps++;

        // Cut at a line start, so the stretch never opens mid-sentence with no speaker.
        let transcript = attributedTranscript(0, { timed: true });
        if (transcript.length > SWEEP_CONTEXT_CHARS) {
            const tail = transcript.slice(-SWEEP_CONTEXT_CHARS);
            const nl = tail.indexOf('\n');
            transcript = nl >= 0 && nl < 2000 ? tail.slice(nl + 1) : tail;
        }

        const controller = new AbortController();
        const epoch = sessionEpoch;
        inflight.add(controller);
        const timeout = setTimeout(() => controller.abort(), SWEEP_TIMEOUT_MS);
        try {
            const resp = await apiFetch(sweepUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    transcript,
                    session: briefForServer(),
                    state: meetingState,
                    answered: onScreen(),
                    dismissed: dismissedTitles.slice(-DISMISSED_MEMORY),
                    types,
                    cooling: coolingTypes(),
                    bias: { ...typeBias },
                }),
            });
            const data = await resp.json().catch(() => ({}));
            if (epoch !== sessionEpoch) return;
            // A server from before the sweep existed. Stop asking rather than fail every time.
            if (resp.status === 404) { sweepUnsupported = true; return; }
            if (!resp.ok) throw new Error(data.error || `server ${resp.status}`);

            for (const title of data.resolved || []) markResolved(title);
            for (const c of data.cards || []) showSweepCard(c);
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            stats.sweepFails++;
            charsSinceSweep += spent;   // the next pass reads this stretch too
            console.error('ReVerb sweep error:', err);
        } finally {
            clearTimeout(timeout);
            inflight.delete(controller);
            sweepRunning = false;
        }
    }

    // Written whole by the sweep — observation, evidence, and the question to ask — so it
    // goes up complete, the way an action item does.
    function showSweepCard(c) {
        if (!c || !CARD_TYPE_UI[c.type] || !c.title) return;
        const card = placeCard(++cardOrder);
        const refs = renderSkeleton(card, { type: c.type, title: c.title });
        refs.gist.innerHTML = renderMarkdown(c.gist || '') + (c.ask ? askLine(c.ask) : '');
        refs.moreText.innerHTML = renderMarkdown(c.detail || '');
        refs.toggle.hidden = !(c.detail || '').trim();
        bumpStat('cards', c.type);
        rememberAnswered({ type: c.type, title: c.title });
        startCooldown({ type: c.type });
    }

    function askLine(question) {
        return `<p class="card-ask"><span class="card-ask-label">Ask</span>${escapeHtmlText(question)}</p>`;
    }

    // The sweep saw the room deal with something a card raised. The card stays, as a record,
    // but quietly — and an action item never counts as dealt with just by being discussed.
    function markResolved(title) {
        const want = String(title).trim().toLowerCase();
        for (const card of insightsContainer.querySelectorAll('[data-card][data-type]')) {
            if (card.dataset.type === 'action' || card.classList.contains('card-resolved')) continue;
            if ((card.dataset.title || '').trim().toLowerCase() !== want) continue;
            card.classList.add('card-resolved');
            const chip = card.querySelector('.card-chip');
            if (chip) chip.after(el('span', 'card-resolved-mark', 'Addressed'));
            stats.resolved++;
        }
    }


    // ---------- suggested questions ----------
    // Every half-minute or so of talk, ReVerb reads the recent stretch as a whole and asks what is
    // most worth asking next, for this person in this kind of meeting. Each new question becomes an
    // "Ask this" card, alongside the ones the card lane raises from a single line, and the filters
    // treat them alike. Asked or Skip settles a question for good. One the room asked anyway is
    // marked Asked, and one a later look passed over is quieted as Earlier rather than removed, so
    // the panel stays a record of the meeting. Before anyone speaks, it offers openers.
    const askNext = { open: [], asked: [], skipped: [], earlier: [] };   // open: { text, kind, why, to, card }
    let questionsRunning = false, lastQuestionsAt = 0, charsSinceQuestions = 0, questionsUnsupported = false;
    const QUESTION_KIND_LABEL = {
        clarify: 'Clarify', probe: 'Dig in', 'follow-up': 'Follow up', challenge: 'Challenge',
        connect: 'Connect', 'next-step': 'Next step', opener: 'To open',
    };
    const normQuestion = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const questionsOn = () => enabledTypes.has('ask') && !questionsUnsupported;

    // What the card lane is told is already on screen: the cards, and the open questions, so a
    // card from a single line doesn't repeat a question already suggested.
    function onScreen() {
        return [...answeredTitles.slice(-ANSWERED_MEMORY), ...askNext.open.map((q) => ({ type: 'ask', title: q.text }))];
    }

    function maybeRunQuestions() {
        if (questionsRunning || !questionsOn() || !lanesLive()) return;
        const since = lanesNow() - lastQuestionsAt;
        if (charsSinceQuestions >= QUESTIONS_MIN_NEW_CHARS && since >= QUESTIONS_INTERVAL_MS) runQuestions();
        else if (askNext.open.length < 2 && charsSinceQuestions >= QUESTIONS_REFILL_CHARS && since >= QUESTIONS_REFILL_MS) runQuestions();
    }

    async function runQuestions(opts) {
        const manual = Boolean(opts && opts.manual);
        if (questionsRunning || !questionsOn()) return;
        questionsRunning = true;
        lastQuestionsAt = lanesNow();
        const spent = charsSinceQuestions;
        charsSinceQuestions = 0;
        stats.questionRuns++;
        reflectQuestionsButton();

        // Cut at a line start, so the stretch never opens mid-sentence with no speaker.
        let transcript = segments.length ? attributedTranscript(0, { timed: true }) : '';
        if (transcript.length > QUESTIONS_CONTEXT_CHARS) {
            const tail = transcript.slice(-QUESTIONS_CONTEXT_CHARS);
            const nl = tail.indexOf('\n');
            transcript = nl >= 0 && nl < 2000 ? tail.slice(nl + 1) : tail;
        }
        const opening = transcript.length < 200;

        const controller = new AbortController();
        const epoch = sessionEpoch;
        inflight.add(controller);
        const timeout = setTimeout(() => controller.abort(), QUESTIONS_TIMEOUT_MS);
        try {
            const resp = await apiFetch(questionsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    transcript,
                    session: briefForServer(),
                    state: meetingState,
                    answered: answeredTitles.slice(-ANSWERED_MEMORY),
                    shown: askNext.open.map((q) => q.text),
                    asked: askNext.asked.slice(-30),
                    skipped: askNext.skipped.slice(-20),
                    earlier: askNext.earlier.slice(-20),
                }),
            });
            const data = await resp.json().catch(() => ({}));
            if (epoch !== sessionEpoch) return;
            // A server from before suggested questions existed. Stop asking rather than fail every time.
            if (resp.status === 404) { questionsUnsupported = true; return; }
            if (!resp.ok) throw new Error(data.error || `server ${resp.status}`);
            applyQuestions(data, { opening, manual });
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            stats.questionFails++;
            charsSinceQuestions += spent;   // the next look reads this stretch too
            if (manual) toast('Couldn’t get questions just now');
            console.error('ReVerb questions error:', err);
        } finally {
            clearTimeout(timeout);
            inflight.delete(controller);
            questionsRunning = false;
            reflectQuestionsButton();
        }
    }

    function applyQuestions(data, opts) {
        const done = new Set((Array.isArray(data.done) ? data.done : []).map(normQuestion));
        for (const q of [...askNext.open]) if (done.has(normQuestion(q.text))) settleQuestion(q, 'room');

        const settled = new Set([...askNext.asked, ...askNext.skipped].map(normQuestion));
        const keep = new Set();
        const fresh = [];
        for (const q of Array.isArray(data.questions) ? data.questions : []) {
            if (!q || typeof q.text !== 'string' || !q.text.trim()) continue;
            const key = normQuestion(q.text);
            const open = askNext.open.find((o) => normQuestion(o.text) === key);
            if (open) keep.add(open);
            else if (!settled.has(key) && !fresh.some((f) => normQuestion(f.text) === key)) fresh.push(q);
        }
        // Passed over by this look: quieted, not removed.
        for (const q of [...askNext.open]) if (!keep.has(q)) settleQuestion(q, 'earlier');

        // A couple of new cards at a time, the best on top; the rest can come next time.
        const adding = fresh.slice(0, opts && opts.opening ? 3 : 2);
        for (const q of adding.reverse()) showQuestionCard(q);
        while (askNext.open.length > QUESTIONS_MAX_OPEN) settleQuestion(askNext.open[0], 'earlier');
        if (opts && opts.manual && !adding.length) toast(askNext.open.length ? 'Nothing better to ask yet' : 'No questions worth asking yet');

        askNext.asked = askNext.asked.slice(-60);
        askNext.skipped = askNext.skipped.slice(-40);
        askNext.earlier = askNext.earlier.slice(-40);
        persistTranscript();
    }

    // The question is the card's headline; who to ask, the kind of question and why sit around it.
    function showQuestionCard(q) {
        const card = placeCard(++cardOrder);
        renderSkeleton(card, { type: 'ask', title: q.text.trim(), to: q.to || '' });
        const kind = QUESTION_KIND_LABEL[q.kind];
        if (kind) card.querySelector('.card-chip').after(el('span', 'card-kind', kind));
        const gist = card.querySelector('.card-gist');
        gist.replaceChildren();
        if (q.why) gist.append(el('p', 'card-why', q.why));
        askNext.open.push({ text: q.text.trim(), kind: q.kind || 'probe', why: q.why || '', to: q.to || '', card });
        bumpStat('cards', 'ask');
        stats.questions++;
    }

    function markQuestionCard(card, label) {
        if (!card || card.classList.contains('card-resolved')) return;
        card.classList.add('card-resolved');
        if (label === 'Earlier') card.classList.add('card-compact');
        const mark = el('span', 'card-resolved-mark', label);
        if (label === 'Earlier') mark.dataset.mark = 'earlier';
        (card.querySelector('.card-kind') || card.querySelector('.card-chip')).after(mark);
    }

    // how: 'asked' (by the user), 'room' (asked by someone, or answered, anyway), 'skipped', 'earlier'.
    function settleQuestion(q, how) {
        askNext.open = askNext.open.filter((o) => o !== q);
        if (how === 'skipped') {
            askNext.skipped.push(q.text);
            dismissedTitles.push({ type: 'ask', title: q.text.slice(0, 120) });
            removeCard(q.card);
            return;
        }
        (how === 'earlier' ? askNext.earlier : askNext.asked).push(q.text);
        markQuestionCard(q.card, how === 'earlier' ? 'Earlier' : 'Asked');
    }

    // Asked or Skip, on any "Ask this" card: a suggested question, or one the card lane raised from
    // a single line (whose question is the bold line of its answer).
    function onAskAct(card, act) {
        const q = askNext.open.find((o) => o.card === card);
        if (q) settleQuestion(q, act === 'asked' ? 'asked' : 'skipped');
        else {
            const strong = card.querySelector('.card-gist strong');
            const text = (strong && strong.textContent.trim()) || card.dataset.title || '';
            if (act === 'asked') {
                askNext.asked.push(text);
                markQuestionCard(card, 'Asked');
            } else {
                askNext.skipped.push(text);
                if (card.dataset.title) dismissedTitles.push({ type: 'ask', title: card.dataset.title.slice(0, 120) });
                forgetCardProducts(card);
                removeCard(card);
            }
        }
        if (act === 'asked') stats.useful++; else stats.notUseful++;
        persistTranscript();
        maybeRunQuestions();
    }

    // "Suggest Questions", beside Filters: there whenever a meeting is on screen and the "Ask this"
    // cards aren't muted.
    function reflectQuestionsButton() {
        const button = $('questions-refresh');
        button.hidden = !questionsOn() || !(isListening || segments.length);
        button.disabled = questionsRunning;
        button.textContent = questionsRunning ? 'Thinking…' : 'Suggest Questions';
    }

    // How far the meeting has got through what its kind of meeting needs, on the summary bar.
    function reflectCoverage() {
        const cover = meetingState && Array.isArray(meetingState.coverage) ? meetingState.coverage.filter((c) => c && c.item) : [];
        const chip = $('cover-chip');
        chip.hidden = !cover.length;
        if (!cover.length) return;
        const covered = cover.filter((c) => c.status === 'covered').length;
        chip.textContent = `${covered} of ${cover.length} covered`;
        const left = cover.filter((c) => c.status !== 'covered').map((c) => c.item);
        chip.title = left.length ? `Still to cover: ${left.join(', ')}` : 'Everything this meeting needs has been covered';
    }



    // ---------- use a recording ----------
    // A meeting that already happened: the recording is transcribed with the voices told apart (as
    // Improve Transcript does), the voices are named, and then ReVerb reads through it line by line
    // as if it had been listening — the same cards, to-dos, summary and suggested questions, paced
    // by the recording's own clock instead of the wall's. So what comes out is what a live session
    // would have shown, which is also how a real meeting can be used to judge and tune the cards.
    const RECORDING_MAX_S = 3 * 60 * 60;
    const RECORDING_MAX_BYTES = 800e6;
    const REPLAY_STATE_EVERY_MS = 60000;      // meeting time between summary updates while reading
    let pickedRecording = null;               // the file chosen in the brief

    function reflectRecordingPick() {
        const file = pickedRecording;
        $('recording-pick').hidden = segments.length > 0 || Boolean(file);
        $('recording-row').hidden = !file;
        $('tab-option').hidden = Boolean(file) || !canShareTab;
        $('accurate-option').hidden = Boolean(file);
        $('record-option').hidden = Boolean(file);
        if (file) $('recording-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
        $('setup-start').textContent = segments.length ? 'Continue' : file ? 'Read It' : 'Start';
    }

    // The model returns speech in short stretches; a line is one person's stretch of them.
    function recordingLines(all) {
        const lines = [];
        for (const g of all) {
            const text = g.text.trim();
            if (!text) continue;
            const last = lines[lines.length - 1];
            if (last && last.voice === g.voice && g.start - last.end < 2 && last.text.length + text.length < 320) {
                last.text += ` ${text}`;
                last.end = g.end;
            } else lines.push({ voice: g.voice, start: g.start, end: g.end, text });
        }
        return lines;
    }

    // Voices are told apart by sound; names come from the words. The speaker pass reads the opening
    // lines the way it reads a live meeting ("Sam here", "over to you, Priya"), and each voice takes
    // the name most of its lines were given. A voice nobody names keeps a number, to rename by hand.
    async function nameVoices(lines, signal) {
        const names = new Map();
        const voices = [...new Set(lines.map((l) => l.voice))];
        if (voices.includes('You')) names.set('You', 'You');
        const votes = new Map(), attributed = [];
        try {
            for (let from = 0; from < Math.min(lines.length, 180); from += 60) {
                const chunk = lines.slice(from, from + 60);
                const resp = await apiFetch(speakersUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal,
                    body: JSON.stringify({
                        turns: chunk.map((l, k) => ({ i: from + k, text: l.text })),
                        attributed: attributed.slice(-12),
                        session: briefForServer({ materials: false }),
                    }),
                });
                if (!resp.ok) break;
                const data = await resp.json().catch(() => ({}));
                for (const t of data.turns || []) {
                    const line = lines[t.i];
                    if (!line || !t.speaker) continue;
                    const name = String(t.speaker).slice(0, 60);
                    attributed.push({ speaker: name, text: line.text });
                    if (t.confident === false || isPlaceholder(name) || name === 'You' || line.voice === 'You') continue;
                    const m = votes.get(line.voice) || new Map();
                    m.set(name, (m.get(name) || 0) + 1);
                    votes.set(line.voice, m);
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.error('ReVerb naming error:', err);   // unnamed voices get numbers
        }
        const claims = [];
        for (const [voice, m] of votes) {
            const total = [...m.values()].reduce((a, b) => a + b, 0);
            const said = lines.filter((l) => l.voice === voice).length;
            for (const [name, n] of m) claims.push({ voice, name, n, share: n / total, said });
        }
        claims.sort((a, b) => b.n - a.n);
        const taken = new Set(names.values());
        for (const c of claims) {
            // Most of the voice's named lines, and more than a single guess unless it barely spoke.
            if (names.has(c.voice) || taken.has(c.name) || c.share < 0.5 || (c.n < 2 && !(c.share === 1 && c.said <= 3))) continue;
            names.set(c.voice, c.name);
            taken.add(c.name);
        }
        let n = 1;
        for (const voice of voices) {
            if (names.has(voice)) continue;
            while (taken.has(`Speaker ${n}`)) n++;
            names.set(voice, `Speaker ${n}`);
            taken.add(`Speaker ${n}`);
        }
        return names;
    }

    async function runRecording(file) {
        if (improveRun || isListening || segments.length) return;
        const controller = new AbortController();
        const epoch = sessionEpoch;
        improveRun = { controller, recording: true };
        reflectImprove();
        errorEl.textContent = '';
        sessionEnd.classList.add('hidden');
        restoreBar.classList.add('hidden');
        if (offeredSave) {
            if (offeredSave.key !== STORE_KEY) { try { localStorage.removeItem(offeredSave.key); } catch (err) { /* ignore */ } }
            offeredSave = null;
        }
        const status = (text, progress) => improveStatus(text, { progress, cancel: true });
        let lines, durationS;
        try {
            if (file.size > RECORDING_MAX_BYTES) throw new Error('That file is over 800 MB. Export just the audio (MP3 or M4A) and try that.');
            status('Opening the recording…', 0);
            let pcm;
            try { pcm = await decodeMono16k(file); }
            catch (err) { throw new Error('This browser couldn’t read that file. An MP3, M4A or WAV should work.'); }
            durationS = pcm.length / IMPROVE_RATE;
            if (durationS < 3) throw new Error('That recording is too short to read.');
            if (durationS > RECORDING_MAX_S) throw new Error('That recording is over three hours. Split it, and read the parts one at a time.');
            const voice = session.voiceId ? readVoiceSample() : null;
            const all = await transcribeRecording(pcm, controller.signal, (t, p) => status(t, p * 0.5), voice ? [{ name: 'You', sample: voice.sample }] : []);
            if (epoch !== sessionEpoch) return;
            lines = recordingLines(all);
            if (!lines.length) throw new Error('No speech was found in that recording.');
            status('Working out who is who…', 0.5);
            const names = await nameVoices(lines, controller.signal);
            if (epoch !== sessionEpoch) return;
            for (const l of lines) l.speaker = names.get(l.voice);
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            improveRun = null;
            reflectImprove();
            if (err.name === 'AbortError') improveStatus('Cancelled. Nothing was read.');
            else { console.error('ReVerb recording error:', err); improveStatus(err.message || 'Something went wrong.', { retry: () => runRecording(file) }); }
            return;
        }

        // From here the recording is a meeting being read through.
        const totalMs = Math.round(durationS * 1000);
        startedAt = (Number.isFinite(file.lastModified) && file.lastModified > 0 ? file.lastModified : Date.now()) - totalMs;
        replay = { clockMs: 0, epoch0: Date.now(), held: [], spent: false, skip: false };
        lastSweepAt = lanesNow();
        lastQuestionsAt = lanesNow();
        const speakers = [...new Set(lines.map((l) => l.speaker))];
        participants = dedupeParticipants(speakers.filter((nm) => !isPlaceholder(nm)).map((name) => (name === 'You' ? { name, role: 'using ReVerb' } : { name })));
        setStateObjective();
        stateBar.classList.remove('hidden');
        $('replay-skip').hidden = false;
        reflectSessionButtons();
        reflectQuestionsButton();
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const gone = () => epoch !== sessionEpoch;
        const fireHeld = (all) => {
            const due = replay.held.filter((h) => all || h.due <= replay.clockMs);
            replay.held = replay.held.filter((h) => !due.includes(h));
            for (const h of due) h.release();
        };
        let lastStateClock = 0, stoppedAt = null, readTo = 0;
        try {
            for (const line of lines) {
                if (gone()) return;
                if (controller.signal.aborted) { stoppedAt = replay.clockMs; break; }
                replay.clockMs = Math.round(line.end * 1000);
                const reading = !replay.skip && !replay.spent;
                if (reading) fireHeld(false);
                const context = attributedTranscript().slice(-CONTEXT_CHARS);
                addSegment(line.text);
                const seg = segments[segments.length - 1];
                seg.speaker = line.speaker;
                seg.confident = true;
                if (line.speaker === 'You') seg.voice = 'you';
                delete seg.at;
                if (!reading) continue;
                readTo = replay.clockMs;
                refreshSpeakerTags();
                if (wordCount(line.text) >= MIN_ANALYZE_WORDS) enqueueAnalysis(line.text, context);
                // Room in the queue before the next line: nothing is dropped, and the order holds.
                while (analyzeQueue.length >= 2 && !controller.signal.aborted && !gone()) await pause(40);
                if (charsSinceState > 0 && (!meetingState ? charsSinceState >= STATE_MIN_NEW_CHARS : replay.clockMs - lastStateClock >= REPLAY_STATE_EVERY_MS)) {
                    lastStateClock = replay.clockMs;
                    await runState();
                    if (gone()) return;
                }
                maybeRunSweep();
                maybeRunQuestions();
                checkQuietVoices();
                status(`Reading the meeting… ${Math.floor(replay.clockMs / 60000)} of ${Math.max(1, Math.round(durationS / 60))} min`, 0.5 + 0.5 * (replay.clockMs / totalMs));
            }
            refreshSpeakerTags();
            if (stoppedAt == null) {
                status('Finishing the last cards…', 0.99);
                // A card can still ask to be held after the last line was read: the end of the
                // recording is as much "what was said next" as it will ever hear.
                const deadline = Date.now() + 60000;
                const busy = () => analyzeActive || analyzeQueue.length || sweepRunning || questionsRunning || replay.held.length;
                while (busy() && Date.now() < deadline && !gone() && !controller.signal.aborted) {
                    if (!replay.skip && !replay.spent) fireHeld(true); else replay.held.length = 0;
                    await pause(100);
                }
            }
        } finally {
            const state = replay;
            replay = null;
            if (!gone()) {
                // Back on the wall clock, with the meeting as long as what was read.
                activeMs = stoppedAt != null ? stoppedAt : totalMs;
                activeSince = 0;
                lastSweepAt = lastQuestionsAt = lastFullAt = Date.now();
                for (const key of Object.keys(typeLastShown)) delete typeLastShown[key];
                $('replay-skip').hidden = true;
                improveRun = null;
                reflectImprove();
                $('improve-bar').classList.add('hidden');
                // The summary people keep covers everything that was read.
                charsSinceState = Math.max(charsSinceState, 1);
                runState({ full: true });
                reflectSessionButtons();
                reflectQuestionsButton();
                renderMeetingState();
                reflectChatReady();
                persistTranscript(true);
                const partial = state.skip || state.spent;
                $('end-title').textContent = stoppedAt != null ? 'Stopped reading the recording' : 'Finished reading the recording';
                endMeta.textContent = [
                    `${segments.length} line${segments.length === 1 ? '' : 's'}`,
                    `${Math.max(1, Math.round(activeMs / 60000))} min`,
                    `${speakers.length} speaker${speakers.length === 1 ? '' : 's'} told apart`,
                    stoppedAt != null ? 'Stopped partway: what was read so far is here.'
                        : partial ? `${state.spent ? 'Today’s allowance ran out, so cards' : 'Cards'} and to-dos cover the first ${Math.max(1, Math.round(readTo / 60000))} min; the transcript and summary cover all of it.`
                        : 'Read through as if ReVerb had been listening. Click a name in the transcript to correct who is who.',
                ].join(' · ');
                endAudio.replaceChildren();
                $('end-diagnostics').classList.add('hidden');
                sessionEnd.classList.remove('hidden');
            }
        }
    }

    // ---------- your voice: telling your lines from everyone else's ----------
    // Live transcription can't tell voices apart, so ReVerb couldn't tell the person using it from
    // anyone else: an "Ask this" card could suggest the question they had just asked. When they turn
    // this on, a short sample of their voice (recorded once, kept in this browser) goes with each
    // stretch of the meeting's audio, every half-minute or so, to OpenAI's speaker-separating model
    // through /reverb/voice. The stretches are cut where lines end, so each line is checked once.
    // What comes back is lined up with the transcript by the words, and the user's lines are
    // labelled "You". A line the user labelled themselves keeps their label.
    const VOICE_KEY = 'reverb.voice';          // { sample: "data:audio/wav;base64,…", seconds, at }
    const VOICE_SAMPLE_S = [2.5, 9.5];         // the model takes references of up to ten seconds
    const VOICE_RECORD_S = 9;
    const VOICE_TEST_S = 5;
    const VOICE_TICK_MS = 5000;
    const VOICE_LAG_MS = 1800;                 // a line arrives about this long after it was said
    const VOICE_BATCH_MS = 25000;              // speech to gather before a check…
    const VOICE_WAIT_MS = 30000;               // …or this long after the oldest unchecked line
    const VOICE_MAX_MS = 45000;
    const VOICE_KEEP_MS = 120000;              // audio kept in memory, for the checks only
    let voiceTimer = null, voiceRunning = false, voiceFailures = 0, voiceUnsupported = false, voiceNextAt = 0;

    function readVoiceSample() {
        try {
            const v = JSON.parse(localStorage.getItem(VOICE_KEY) || 'null');
            return v && typeof v.sample === 'string' && v.sample.startsWith('data:audio/wav;base64,') ? v : null;
        } catch (err) { return null; }
    }
    const voiceIdOn = () => Boolean(session.voiceId && isListening && voiceTap.on && readVoiceSample() && !voiceUnsupported);

    // The microphone frames, as they go to the transcriber, kept for the last two minutes.
    const voiceTap = {
        on: false, since: 0, rate: 24000, chunks: [],   // { at, pcm: Int16Array }
        start() { this.on = true; this.since = Date.now(); this.chunks = []; },
        stop() { this.on = false; this.chunks = []; },
        push(buf, rate) {
            const at = Date.now();
            this.rate = rate || this.rate;
            this.chunks.push({ at, pcm: new Int16Array(buf.slice(0)) });
            let drop = 0;
            while (drop < this.chunks.length && this.chunks[drop].at < at - VOICE_KEEP_MS) drop++;
            if (drop) this.chunks.splice(0, drop);
        },
        // The audio between two wall-clock times, at 16 kHz.
        slice16k(from, to) {
            const parts = this.chunks.filter((c) => c.at > from && c.at - (c.pcm.length / this.rate) * 1000 < to);
            const n = parts.reduce((k, c) => k + c.pcm.length, 0);
            const src = new Float32Array(n);
            let o = 0;
            for (const c of parts) for (let i = 0; i < c.pcm.length; i++) src[o++] = c.pcm[i] / 32768;
            const ratio = this.rate / IMPROVE_RATE;
            const out = new Float32Array(Math.floor(n / ratio));
            for (let i = 0; i < out.length; i++) {
                const x = i * ratio, j = Math.floor(x), f = x - j;
                out[i] = j + 1 < n ? src[j] * (1 - f) + src[j + 1] * f : src[j] || 0;
            }
            return out;
        },
    };

    function startVoiceId() {
        stopVoiceId();
        if (!session.voiceId || !readVoiceSample() || voiceUnsupported || !(provider instanceof RealtimeProvider)) return;
        voiceTap.start();
        voiceTimer = setInterval(maybeCheckVoices, VOICE_TICK_MS);
    }
    function stopVoiceId() {
        if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; }
        voiceTap.stop();
    }

    // When each line was said, roughly: it ends a moment before it arrived, and lasts about as
    // long as its words take to say.
    const lineEnd = (seg) => seg.at - VOICE_LAG_MS;
    const lineStart = (seg) => lineEnd(seg) - Math.min(25000, Math.max(1000, wordCount(seg.text) / 2.5 * 1000)) - 300;

    function maybeCheckVoices() {
        if (voiceRunning || !voiceIdOn() || isPaused || Date.now() < voiceNextAt) return;
        const now = Date.now();
        // Lines that arrived since the audio started being kept; a stretch before that has no audio.
        const pending = segments.filter((seg) => seg.at && seg.at > voiceTap.since && !seg.voice && !seg.byUser);
        if (!pending.length) return;
        const first = pending[0];
        const gathered = lineEnd(pending[pending.length - 1]) - lineStart(first);
        if (gathered < VOICE_BATCH_MS && now - first.at < VOICE_WAIT_MS) return;
        const from = Math.max(voiceTap.since, lineStart(first) - 1500);
        const batch = [];
        for (const seg of pending) {
            if (batch.length && lineEnd(seg) + 1000 - from > VOICE_MAX_MS) break;
            batch.push(seg);
        }
        const to = Math.min(now, lineEnd(batch[batch.length - 1]) + 1000);
        checkVoices(batch, from, to);
    }

    async function checkVoices(batch, from, to) {
        const voice = readVoiceSample();
        if (!voice) return;
        const pcm = voiceTap.slice16k(from, to);
        if (pcm.length < IMPROVE_RATE * 1.5) { for (const seg of batch) seg.voice = 'unsure'; return; }
        voiceRunning = true;
        stats.voiceChecks++;
        const controller = new AbortController();
        const epoch = sessionEpoch;
        inflight.add(controller);
        const timeout = setTimeout(() => controller.abort(), 70000);
        try {
            const form = new FormData();
            form.append('audio', wavBlob(pcm), 'stretch.wav');
            form.append('sample', voice.sample);
            const resp = await apiFetch(voiceUrl, { method: 'POST', body: form, signal: controller.signal });
            const data = await resp.json().catch(() => ({}));
            if (epoch !== sessionEpoch) return;
            if (resp.status === 404) { voiceUnsupported = true; return; }
            // Busy: this stretch waits for the next tick rather than being sent again at once.
            if (resp.status === 503 && data.busy) { voiceNextAt = Date.now() + VOICE_TICK_MS * 2; return; }
            if (!resp.ok) throw new Error(data.error || `server ${resp.status}`);
            voiceFailures = 0;
            applyVoices(batch, Array.isArray(data.segments) ? data.segments : []);
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            stats.voiceFails++;
            for (const seg of batch) seg.voice = seg.voice || 'unsure';   // not sent twice: it costs
            if (++voiceFailures === 3) setNotice('Recognising your voice isn’t working right now — your lines won’t be marked “You”.');
            console.error('ReVerb voice error:', err);
        } finally {
            clearTimeout(timeout);
            inflight.delete(controller);
            voiceRunning = false;
        }
    }

    // The model's transcript of the stretch and ReVerb's own are of the same audio, so each line is
    // matched to whichever voice said most of its words. Short words and filler say nothing about
    // who spoke, so only the content words count; a line too short to tell stays unlabelled.
    const VOICE_STOP = new Set('the and that this with for you are was were but have has had not what about just like they them there their then than from will would can could should our your his her its it’s it\'s yes yeah okay well also into been being because which when where who how why all any some one two get got going know think really very much more most here over only out off one'.split(' '));
    const contentWords = (t) => {
        const out = [];
        for (const w of String(t).toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) {
            // Unspaced scripts: pairs of characters stand in for words.
            if (w.search(UNSPACED) >= 0) { for (let i = 0; i + 2 <= w.length; i++) out.push(w.slice(i, i + 2)); }
            else if (w.length >= 3 && !VOICE_STOP.has(w)) out.push(w);
        }
        return out;
    };

    function applyVoices(batch, segs) {
        const bags = new Map();   // voice → Set of content words
        for (const g of segs) {
            const key = g.speaker === 'You' ? 'You' : `other:${g.speaker}`;
            if (!bags.has(key)) bags.set(key, new Set());
            for (const w of contentWords(g.text)) bags.get(key).add(w);
        }
        let anyYou = false;
        for (const seg of batch) {
            const words = contentWords(seg.text);
            if (words.length < 2) { seg.voice = 'unsure'; continue; }
            const cover = (bag) => (bag ? words.filter((w) => bag.has(w)).length / words.length : 0);
            const you = cover(bags.get('You'));
            let other = 0;
            for (const [key, bag] of bags) if (key !== 'You') other = Math.max(other, cover(bag));
            if (you >= 0.5 && you - other >= 0.2) {
                seg.voice = 'you';
                if (!seg.byUser) { seg.speaker = 'You'; seg.confident = true; }
                anyYou = true;
            } else if (other >= 0.5 && other - you >= 0.2) {
                seg.voice = 'other';
                // Labelled "You" by an earlier guess that this check contradicts: back to the speaker pass.
                if (!seg.byUser && seg.speaker === 'You') seg.speaker = null;
            } else seg.voice = 'unsure';
        }
        stats.voiceYou = segments.filter((seg) => seg.voice === 'you').length;
        if (anyYou && !participants.some((p) => p && p.name === 'You')) {
            participants = dedupeParticipants([{ name: 'You', role: 'using ReVerb' }, ...participants]);
        }
        refreshSpeakerTags();
        renderMeetingState();
        persistTranscript();
        // Someone else's line with no name yet would read as a continuation of the last label —
        // often "You" — so it gets one now rather than at the next scheduled pass.
        maybeRunSpeakers(batch.some((seg) => seg.voice === 'other' && !seg.speaker));
    }

    // ---- recording the sample, once, in the brief ----
    function voiceResult(text, tone) {
        const r = $('voice-result');
        r.textContent = text || '';
        if (tone) r.dataset.tone = tone; else delete r.dataset.tone;
    }

    function reflectVoicePanel() {
        const on = $('setup-voice').checked;
        $('voice-panel').hidden = !on;
        const v = readVoiceSample();
        $('voice-status').textContent = v
            ? `Your voice sample: ${v.seconds.toFixed(1)} seconds, recorded ${new Date(v.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}.`
            : 'No voice sample yet.';
        $('voice-script').hidden = Boolean(v);
        $('voice-record').textContent = v ? 'Record Again' : 'Record Sample';
        for (const id of ['voice-play', 'voice-test', 'voice-delete']) $(id).hidden = !v;
    }

    // Records the microphone for up to `seconds` (the button stops it sooner), at 16 kHz.
    let voiceRecording = null;
    async function recordMic(seconds, button, label) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        const format = pickAudioFormat();
        const rec = new MediaRecorder(stream, format.mimeType ? { mimeType: format.mimeType } : undefined);
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const done = new Promise((resolve) => rec.addEventListener('stop', resolve, { once: true }));
        const started = Date.now();
        let left = seconds;
        button.classList.add('recording');
        button.textContent = `${label}… ${left}`;
        const tick = setInterval(() => { left -= 1; button.textContent = `${label}… ${Math.max(0, left)}`; }, 1000);
        const stop = () => { if (rec.state !== 'inactive') rec.stop(); };
        const cap = setTimeout(stop, seconds * 1000);
        voiceRecording = { stop, started };
        rec.start();
        await done;
        clearInterval(tick);
        clearTimeout(cap);
        voiceRecording = null;
        stream.getTracks().forEach((t) => t.stop());
        button.classList.remove('recording');
        return decodeMono16k(new Blob(chunks, { type: format.accept }));
    }

    // Leading and trailing quiet trimmed, so the sample is the voice and not the room.
    function trimQuiet(pcm) {
        const frame = IMPROVE_RATE / 20;
        const energy = [];
        for (let i = 0; i + frame <= pcm.length; i += frame) {
            let e = 0;
            for (let j = i; j < i + frame; j++) e += pcm[j] * pcm[j];
            energy.push(Math.sqrt(e / frame));
        }
        if (!energy.length) return pcm;
        const sorted = [...energy].sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length * 0.2)];
        const loud = Math.max(0.01, floor * 3);
        const first = energy.findIndex((e) => e > loud);
        let last = energy.length - 1;
        while (last > 0 && energy[last] <= loud) last--;
        if (first < 0) return new Float32Array(0);
        return pcm.subarray(Math.max(0, (first - 4) * frame), Math.min(pcm.length, (last + 6) * frame));
    }

    async function recordVoiceSample() {
        const button = $('voice-record');
        if (voiceRecording) {
            if (Date.now() - voiceRecording.started > 3000) voiceRecording.stop();
            return;
        }
        voiceResult('Recording — read the sentence aloud. Press again to stop.');
        try {
            let pcm = trimQuiet(await recordMic(VOICE_RECORD_S, button, 'Recording'));
            const seconds = pcm.length / IMPROVE_RATE;
            if (seconds < VOICE_SAMPLE_S[0]) {
                voiceResult('That was too short or too quiet. Record again, a little closer to the microphone.', 'bad');
                reflectVoicePanel();
                return;
            }
            if (seconds > VOICE_SAMPLE_S[1]) pcm = pcm.subarray(0, Math.round(VOICE_SAMPLE_S[1] * IMPROVE_RATE));
            const sample = await blobDataUrl(wavBlob(pcm));
            try {
                localStorage.setItem(VOICE_KEY, JSON.stringify({ sample, seconds: Math.min(seconds, VOICE_SAMPLE_S[1]), at: Date.now() }));
            } catch (err) {
                voiceResult('This browser’s storage is full or blocked, so the sample couldn’t be kept.', 'bad');
                return;
            }
            reflectVoicePanel();
            voiceResult('Saved. Press Test It to check ReVerb recognises you.', 'good');
        } catch (err) {
            console.error('ReVerb voice sample error:', err);
            voiceResult(err.name === 'NotAllowedError' ? 'ReVerb wasn’t allowed to use the microphone.' : 'Couldn’t record. Check the microphone and try again.', 'bad');
            reflectVoicePanel();
        }
    }

    // A fresh recording, checked against the sample by the same model the meeting uses.
    async function testVoiceSample() {
        const voice = readVoiceSample();
        if (!voice || voiceRecording) return;
        const button = $('voice-test');
        voiceResult('Say anything for a few seconds…');
        try {
            const pcm = trimQuiet(await recordMic(VOICE_TEST_S, button, 'Listening'));
            button.textContent = 'Test It';
            if (pcm.length < IMPROVE_RATE) { voiceResult('Nothing was heard. Check the microphone and try again.', 'bad'); return; }
            voiceResult('Checking…');
            const form = new FormData();
            form.append('audio', wavBlob(pcm), 'test.wav');
            form.append('sample', voice.sample);
            const resp = await apiFetch(voiceUrl, { method: 'POST', body: form });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) { voiceResult(data.error || 'The check didn’t work just now. Try again in a moment.', 'bad'); return; }
            const segs = Array.isArray(data.segments) ? data.segments : [];
            if (segs.some((g) => g.speaker === 'You')) voiceResult('✓ Recognised you. You’re all set.', 'good');
            else if (segs.length) voiceResult('It heard you but didn’t match your sample. Record the sample again, somewhere quieter and a little closer to the microphone.', 'bad');
            else voiceResult('Nothing was heard. Check the microphone and try again.', 'bad');
        } catch (err) {
            button.textContent = 'Test It';
            voiceResult(err.name === 'NotAllowedError' ? 'ReVerb wasn’t allowed to use the microphone.' : 'Couldn’t reach ReVerb to check. Try again in a moment.', 'bad');
        }
    }

    // ---------- slow lane: topic tree + rolling summary ----------
    function maybeRunState(force) {
        if (stateRunning || !segments.length) return;
        if (!force && charsSinceState < STATE_MIN_NEW_CHARS) return;
        if (force && charsSinceState === 0) return;
        runState();
    }

    // opts.full forces a rebuild: the closing pass at Stop is the summary people keep.
    async function runState(opts) {
        if (stateRunning) {
            // Running two passes at once would let the older one land last.
            if (opts && opts.full) closingPassQueued = true;
            return;
        }
        stateRunning = true;
        const spent = charsSinceState;
        charsSinceState = 0;

        // Two modes. Normally we send the state we already have plus only the speech
        // since, which is small enough to run every couple of minutes — and that
        // freshness is what the conflict and dig-deeper cards live on. Every
        // STATE_FULL_EVERY passes we re-read the whole transcript instead: incremental
        // updates each carry a little error, and only a full pass clears the buildup.
        const full = !meetingState || Boolean(opts && opts.full) || lanesNow() - lastFullAt >= STATE_FULL_EVERY_MS;
        const upTo = segments.length;
        // Sliced by segment rather than by character count, so correcting a line
        // upstream can't shift the window and duplicate or skip speech.
        const raw = full ? attributedTranscript(0, { timed: true }) : attributedTranscript(lastStateSegment, { timed: true });
        const transcript = raw.length > STATE_CONTEXT_CHARS
            ? `[The transcript starts partway through the meeting.]\n${raw.slice(-STATE_CONTEXT_CHARS)}`
            : raw;

        if (!transcript.trim()) { stateRunning = false; return; }

        const controller = new AbortController();
        const epoch = sessionEpoch;
        inflight.add(controller);
        const timeout = setTimeout(() => controller.abort(), full ? STATE_REBUILD_TIMEOUT_MS : STATE_TIMEOUT_MS);
        try {
            // A rebuild still gets the previous state: it keeps topic names steady, and it
            // is the only record of anything before a truncated transcript.
            const resp = await apiFetch(stateUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(full
                    ? { transcript, session: briefForServer(), full: true, ...(meetingState ? { previous: meetingState } : {}) }
                    : { transcript, session: briefForServer(), previous: meetingState })
            });
            const data = await resp.json().catch(() => ({}));
            if (epoch !== sessionEpoch) return;
            if (!resp.ok) {
                // A retired model fails silently otherwise — this is what hid an outage before.
                if (data.modelUnavailable) errorEl.textContent = data.error;
                throw new Error(data.error || `server ${resp.status}`);
            }
            meetingState = data;
            lastStateSegment = upTo;
            statePasses++;
            stats.statePasses++;
            lastPassFull = full;
            if (full) { stats.stateFulls++; lastFullAt = lanesNow(); }
            renderMeetingState();
            // Stamped here rather than in the render, which also runs when speakers
            // land or a session is restored — neither of which is a fresh summary.
            stampState(Date.now());
            persistTranscript(true);
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            console.error('ReVerb state error:', err);
            stats.stateFails++;
            charsSinceState += spent;     // don't lose the trigger because a call failed
            // lastStateSegment is deliberately left where it was: the speech this pass
            // covered folds into the next one instead of falling through the gap.
        } finally {
            clearTimeout(timeout);
            inflight.delete(controller);
            stateRunning = false;
            if (closingPassQueued && epoch === sessionEpoch) {
                closingPassQueued = false;
                runState({ full: true });
            }
        }
    }

    // Relative, so a glance says how current the summary is without reading a clock.
    function stampState(when) {
        stateStampedAt = when;
        renderStateStamp();
    }
    function renderStateStamp() {
        if (!stateStampedAt) { stateUpdated.textContent = ''; return; }
        const mins = Math.floor((Date.now() - stateStampedAt) / 60000);
        stateUpdated.textContent = mins < 1 ? 'updated just now'
            : mins < 60 ? `updated ${mins} min ago`
            : `updated ${new Date(stateStampedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    setInterval(renderStateStamp, 15000);

    // Someone opening the summary or coming back to the tab is about to read it: fold in
    // whatever was said since the last pass rather than make them wait for the timer.
    function refreshStateForReader() {
        if (charsSinceState > 0) maybeRunState(true);
    }

    function renderMeetingState() {
        renderBalance();
        // Participants land before the first state update does, so this no longer bails
        // out when there is no summary yet — it renders what it has.
        if (!meetingState && !participants.length) return;
        stateBar.classList.remove('hidden');

        topicTree.replaceChildren();
        if (meetingState && meetingState.topics && meetingState.topics.length) {
            for (const topic of meetingState.topics) {
                const block = el('div');
                block.append(el('div', 'text-gray-800', topic.name));
                if (topic.subtopics && topic.subtopics.length) {
                    const list = el('ul', 'mt-0.5 ml-3 space-y-0.5');
                    for (const sub of topic.subtopics) list.append(el('li', 'text-xs text-gray-500', `— ${sub}`));
                    block.append(list);
                }
                if (topic.terms && topic.terms.length) {
                    const tags = el('div', 'mt-1 ml-3 flex flex-wrap gap-1');
                    for (const term of topic.terms) {
                        tags.append(el('span', 'px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600', term));
                    }
                    block.append(tags);
                }
                topicTree.append(block);
            }
        } else {
            topicTree.append(el('p', 'text-gray-400 italic font-light', 'No distinct topics yet.'));
        }

        summaryBody.replaceChildren();
        appendSummaryList('In the room', participantLines());
        if (meetingState) {
            if (meetingState.headline) summaryBody.append(el('p', 'text-gray-700 mt-2', meetingState.headline));
            if (meetingState.objectiveProgress) summaryBody.append(el('p', 'text-xs text-gray-500 mt-1', meetingState.objectiveProgress));
            for (const [label, items] of stateSections(meetingState)) appendSummaryList(label, items);
        }
        reflectCoverage();
    }

    // Everything in the state past the headline, as labelled lists — shared by the panel and
    // the copied summary so the two never disagree about what the meeting produced.
    function stateSections(state) {
        const list = (v) => (Array.isArray(v) ? v : []);
        const mark = { covered: '✓', partly: '◐' };
        return [
            ['What this meeting needs', list(state.coverage).filter((c) => c && c.item)
                .map((c) => `${mark[c.status] || '○'} ${c.item}${c.note ? ` — ${c.note}` : ''}`)],
            ['Agenda', list(state.agenda).filter((a) => a && a.item).map((a) => `${a.item} — ${a.status || '?'}`)],
            ['Key points', list(state.keyPoints)],
            ['Decided', list(state.decisions)],
            ['Still open', list(state.openThreads)],
            ['Positions', list(state.positions).filter((p) => p && p.person && p.stance).map((p) => `${p.person}: ${p.stance}`)],
            ['Assumed, not checked', list(state.assumptions)],
            ['Numbers said', list(state.figures).filter((f) => f && f.figure)
                .map((f) => `${f.figure} — ${f.about || '?'}${f.who ? ` (${f.who})` : ''}`)],
        ];
    }

    function appendSummaryList(label, items) {
        if (!items || !items.length) return;
        const block = el('div', 'mt-2');
        block.append(el('div', 'text-xs uppercase tracking-wide text-gray-400', label));
        const list = el('ul', 'mt-1 space-y-0.5');
        // Checklist lines carry their own mark.
        for (const item of items) list.append(el('li', 'text-xs text-gray-600', /^[✓◐○] /.test(item) ? item : `• ${item}`));
        block.append(list);
        summaryBody.append(block);
    }

    function participantLines() {
        return participants.map((p) => (p && p.name ? (p.role ? `${p.name} — ${p.role}` : p.name) : null)).filter(Boolean);
    }

    // Everything the "Meeting so far" panel shows, in the order it shows it: the objective,
    // the topic tree with its subtopics and terms, then "Where we are". The copy used to
    // start at the headline and reduce the topics to a list of names at the bottom, so most
    // of what sits above the Copy button never made it out.
    function summaryAsText(opts) {
        const standalone = Boolean(opts && opts.standalone);
        const state = meetingState;
        const topics = state && Array.isArray(state.topics) ? state.topics.filter((t) => t && t.name) : [];
        const people = participantLines();
        if (!state && !people.length && !todos.length && !glossary.length) return '';

        const parts = [];
        if (standalone) {
            const mins = startedAt ? Math.round(meetingClock() / 60000) : 0;
            parts.push(`Meeting summary — ${new Date(startedAt || Date.now()).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}${mins ? ` · ${mins} min` : ''}`, '');
        }
        // The download already opens with the objective; the copy has to carry it itself.
        if (standalone && session.objective) parts.push(`Objective: ${session.objective}`, '');

        if (topics.length) {
            parts.push('Topics:');
            for (const t of topics) {
                parts.push(`  • ${t.name}`);
                for (const sub of Array.isArray(t.subtopics) ? t.subtopics : []) if (sub) parts.push(`      – ${sub}`);
                const terms = (Array.isArray(t.terms) ? t.terms : []).filter(Boolean);
                if (terms.length) parts.push(`      Terms: ${terms.join(', ')}`);
            }
            parts.push('');
        }

        const section = (label, items) => {
            if (!items || !items.length) return;
            parts.push(`${label}:`);
            for (const i of items) parts.push(`  • ${i}`);
            parts.push('');
        };
        section('In the room', people);
        if (state && state.headline) parts.push(`Where we are: ${state.headline}`, '');
        if (state && state.objectiveProgress) parts.push(`Against the objective: ${state.objectiveProgress}`, '');
        if (state) for (const [label, items] of stateSections(state)) section(label, items);
        section('To-dos', todos.map(todoLine));
        const talk = talkShares();
        if (talk.length >= 2) parts.push(`Who talked: ${talk.slice(0, 8).map((r) => `${r.name} ${Math.round(r.share * 100)}%`).join(', ')}`, '');
        section('Glossary', glossary.map((g) => `${g.term} — ${g.definition}`));
        return parts.join('\n').trim();
    }

    // ---------- chat with the session ----------
    // Questions about the meeting, answered only from its own record. The server gets the
    // whole attributed transcript, the summary, the cards on screen and the user's
    // corrections, and nothing to search; answers cite the minute each point was said, and
    // a citation opens that stretch of the transcript so it can be checked.
    function chatTranscript() {
        // Speech already final but not yet flushed into a line still counts as said.
        const live = pendingUtterance.trim();
        const text = [attributedTranscript(0, { timed: true }), live].filter(Boolean).join(' ');
        return text.length > STATE_CONTEXT_CHARS
            ? `[The transcript starts partway through the meeting.]\n${text.slice(-STATE_CONTEXT_CHARS)}`
            : text;
    }

    // What the cards on screen say, newest first. Muted types are left out, as on screen.
    function insightsForChat() {
        const out = [];
        const textOf = (card, sel) => {
            const n = card.querySelector(sel);
            return n && !n.hidden ? n.textContent.replace(/\s+/g, ' ').trim() : '';
        };
        for (const card of insightsContainer.querySelectorAll('[data-card][data-type]')) {
            const type = card.dataset.type;
            if (!enabledTypes.has(type) || !card.dataset.title || card.classList.contains('fade-out')) continue;
            const text = [textOf(card, '.card-verdict'), textOf(card, '.card-subject'), textOf(card, '.card-gist'),
                (card.querySelector('.card-more-text') || {}).textContent || '']
                .map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' — ');
            out.push({ type, title: card.dataset.title, text: text.slice(0, 600), addressed: card.classList.contains('card-resolved') });
            if (out.length >= CHAT_INSIGHTS) break;
        }
        // The to-do list and glossary outlive the cards (a restored meeting has neither card).
        const have = new Set(out.map((c) => c.title.toLowerCase()));
        for (const t of todos) {
            if (out.length >= CHAT_INSIGHTS + 20 || have.has(t.title.toLowerCase())) continue;
            out.push({ type: 'action', title: t.task, text: [t.owner, t.due ? `due ${t.due}` : '', t.done ? 'done' : 'open', t.byUser ? 'entered by the user' : ''].filter(Boolean).join(' · ') });
        }
        for (const g of glossary) {
            if (out.length >= CHAT_INSIGHTS + 30 || have.has(g.term.toLowerCase())) continue;
            out.push({ type: 'explanation', title: g.term, text: g.definition });
        }
        return out;
    }

    const chatReady = () => segments.length > 0;

    // Earlier exchanges that got a full answer: what lets "and what did Tom say about it?" work.
    function chatHistory(before) {
        const out = [];
        for (const t of chatTurns) {
            if (t === before) break;
            if (t.status === 'done' && t.answer.trim()) out.push({ role: 'user', text: t.question }, { role: 'assistant', text: t.answer });
        }
        return out.slice(-CHAT_HISTORY_TURNS * 2);
    }

    // "[14m]", and the variants a model drifts into — "[~14m]", "[14m, 22m]", "[14m–16m]" —
    // become chips that open the transcript at that minute.
    function citeMinutes(html) {
        return html.replace(/\[(~?\d{1,4}m(?:\s*(?:[,–—-]|and)\s*~?\d{1,4}m)*)\]/g, (_, inner) =>
            inner.match(/\d{1,4}(?=m)/g).map((m) =>
                `<button type="button" class="cite" data-min="${m}" title="Show minute ${m} in the transcript">${m}m</button>`).join(''));
    }

    // Scroll the transcript to the first of these lines and light them all up for a moment.
    function showInTranscript(lines) {
        const target = lines[0];
        if (!target || !target.el) return;
        if (phoneLayout.matches) showPane('transcript');
        if (!stateBody.classList.contains('hidden') && phoneLayout.matches) toggleStateBody();
        const top = target.el.getBoundingClientRect().top - transcriptContainer.getBoundingClientRect().top
            + transcriptContainer.scrollTop - transcriptContainer.clientHeight / 3;
        transcriptContainer.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        for (const s of lines) if (s.el) s.el.classList.add('cite-flash');
        setTimeout(() => { for (const s of lines) if (s.el) s.el.classList.remove('cite-flash'); }, 2400);
    }

    function jumpToMinute(min) {
        const inMinute = segments.filter((s) => Number.isFinite(s.t) && Math.floor(s.t / 60000) === min);
        const target = inMinute[0]
            || segments.find((s) => Number.isFinite(s.t) && s.t >= min * 60000)
            || segments[segments.length - 1];
        if (target) showInTranscript(inMinute.length ? inMinute : [target]);
    }

    function jumpToSegment(id) {
        const seg = segments.find((s) => s.id === id);
        if (seg) showInTranscript([seg]);
    }

    // The minute a card was raised, as a chip beside its type: one click shows the line.
    function addCardSource(card, seg) {
        if (!card || !seg || !Number.isFinite(seg.t) || card.querySelector('.card-when')) return;
        const anchor = card.querySelector('.card-verdict') || card.querySelector('.card-chip');
        if (!anchor) return;
        const b = el('button', 'cite card-when', `${Math.floor(seg.t / 60000)}m`);
        b.type = 'button';
        b.dataset.seg = seg.id;
        b.title = 'Show where this was said';
        anchor.after(b);
    }

    function chatAtBottom() {
        return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 60;
    }

    function renderTurn(turn) {
        if (!turn.el) {
            turn.el = el('div', 'chat-turn');
            turn.el.append(el('div', 'chat-q', turn.question));
            const a = el('div', 'chat-a');
            a.append(el('div', 'reverb-answer'), el('div', 'chat-a-foot'));
            turn.el.append(a);
            chatLog.append(turn.el);
        }
        const body = turn.el.querySelector('.reverb-answer');
        const foot = turn.el.querySelector('.chat-a-foot');
        foot.replaceChildren();

        if (turn.answer.trim()) body.innerHTML = citeMinutes(renderMarkdown(turn.answer));
        else if (turn.status === 'streaming') body.innerHTML = `<span class="chat-thinking">${spinnerSvg}<span>Reading the meeting…</span></span>`;
        else body.replaceChildren();

        const button = (label, act) => {
            const b = el('button', '', label);
            b.type = 'button';
            b.dataset.act = act;
            foot.append(b);
        };
        if (turn.status === 'failed' || turn.status === 'stopped') {
            foot.append(el('span', 'chat-a-error', turn.status === 'stopped'
                ? (turn.answer.trim() ? 'Stopped before the end.' : 'Stopped.')
                : turn.error || 'Something went wrong.'));
            button('Try again', 'retry');
        }
        if (turn.status !== 'streaming' && turn.answer.trim()) button('Copy', 'copy');
        foot.hidden = !foot.childElementCount;
    }

    let chatFrame = 0;
    function markTurnDirty(turn) {
        if (chatFrame) return;
        chatFrame = requestAnimationFrame(() => {
            chatFrame = 0;
            const follow = chatAtBottom();
            renderTurn(turn);
            if (follow) chatLog.scrollTop = chatLog.scrollHeight;
        });
    }

    function renderChat() {
        for (const t of chatTurns) { if (t.el) t.el.remove(); t.el = null; }
        for (const t of chatTurns) renderTurn(t);
        chatEmpty.hidden = chatTurns.length > 0;
        chatClear.hidden = chatTurns.length === 0;
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function reflectChatReady() {
        const ready = chatReady();
        chatInput.disabled = !ready;
        chatInput.placeholder = ready ? 'Ask about the meeting…' : 'Chat opens once something has been recorded';
        for (const b of chatEmpty.querySelectorAll('[data-ask]')) b.disabled = !ready || Boolean(chatActive);
        chatSend.disabled = !chatActive && (!ready || !chatInput.value.trim());
        chatSend.textContent = chatActive ? 'Stop' : 'Ask';
        chatSend.classList.toggle('stop', Boolean(chatActive));
    }

    function sizeChatInput() {
        chatInput.style.height = 'auto';
        chatInput.style.height = `${Math.min(chatInput.scrollHeight + 2, 144)}px`;
    }

    // Ask the chat and read its answer as it streams: onDelta(text) for each piece, onBytes()
    // whenever anything arrives (it keeps the stall timer quiet). Resolves true once the server
    // says it is done, false if alive() says the answer is no longer wanted; throws otherwise.
    const streamChat = (body, signal, handlers) => streamSse(chatUrl, body, signal, handlers);
    async function streamSse(url, body, signal, { onDelta, onBytes, alive }) {
        const resp = await apiFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify(body),
        });
        if (resp.status === 404) throw new Error('That isn’t available on the server yet');
        if (resp.status === 429) {
            const d = await resp.json().catch(() => ({}));
            throw new Error(d.error || 'Busy — too many requests. Try again in a moment.');
        }
        if (!resp.ok || !resp.body) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `Server error ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', sawDone = false;
        while (true) {
            const { done, value } = await reader.read();
            if (alive && !alive()) return false;
            if (done) break;
            if (onBytes) onBytes();
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
                const chunk = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                if (!chunk.trim()) continue;
                const { event, data } = parseSse(chunk);
                if (event === 'delta') onDelta((data && data.text) || '');
                else if (event === 'done') sawDone = true;
                else if (event === 'error') throw new Error((data && data.message) || 'Chat failed');
            }
        }
        if (!sawDone) throw new Error('The connection dropped before the answer finished');
        return true;
    }

    async function askChat(question, retryOf) {
        if (chatActive || !chatReady()) return;
        const q = String(question || '').trim().slice(0, CHAT_QUESTION_MAX);
        if (!q) return;

        let turn = retryOf;
        if (turn) {
            Object.assign(turn, { answer: '', status: 'streaming', error: '' });
        } else {
            turn = { question: q, answer: '', status: 'streaming', error: '', el: null };
            chatTurns.push(turn);
            if (chatTurns.length > CHAT_SAVED_TURNS) {
                const old = chatTurns.splice(0, chatTurns.length - CHAT_SAVED_TURNS);
                for (const t of old) if (t.el) t.el.remove();
            }
        }
        chatEmpty.hidden = true;
        chatClear.hidden = false;
        renderTurn(turn);
        chatLog.scrollTop = chatLog.scrollHeight;

        const controller = new AbortController();
        const epoch = sessionEpoch;
        chatActive = { controller, turn };
        inflight.add(controller);
        reflectChatReady();

        let stalled = false, expired = false, stopped = false, stallTimer = null;
        const bump = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, CHAT_STALL_MS);
        };
        const capTimer = setTimeout(() => { expired = true; controller.abort(); }, CHAT_MAX_MS);
        chatActive.stop = () => { stopped = true; controller.abort(); };

        try {
            bump();
            const finished = await streamChat({
                question: turn.question,
                history: chatHistory(turn),
                transcript: chatTranscript(),
                state: meetingState,
                insights: insightsForChat(),
                session: briefForServer({ materials: false }),
            }, controller.signal, {
                onBytes: bump,
                alive: () => epoch === sessionEpoch,
                onDelta: (text) => { turn.answer += text; markTurnDirty(turn); },
            });
            if (!finished) return;
            turn.status = 'done';
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            if (stopped) turn.status = 'stopped';
            else {
                console.error('ReVerb chat error:', err);
                turn.status = 'failed';
                turn.error = stalled ? 'The answer stopped partway.'
                    : expired ? 'That took too long.'
                    : err.name === 'TypeError' ? 'Couldn’t reach the server.'
                    : err.message || 'Something went wrong.';
            }
        } finally {
            clearTimeout(stallTimer);
            clearTimeout(capTimer);
            inflight.delete(controller);
            if (epoch === sessionEpoch) {
                if (chatFrame) { cancelAnimationFrame(chatFrame); chatFrame = 0; }
                const follow = chatAtBottom();
                chatActive = null;
                renderTurn(turn);
                if (follow) chatLog.scrollTop = chatLog.scrollHeight;
                reflectChatReady();
                persistTranscript();
            }
        }
    }

    function submitChat() {
        if (chatActive) { chatActive.stop(); return; }
        const q = chatInput.value.trim();
        if (!q || !chatReady()) return;
        chatInput.value = '';
        sizeChatInput();
        askChat(q);
    }

    function clearChat() {
        if (chatActive) chatActive.stop();
        for (const t of chatTurns) if (t.el) t.el.remove();
        chatTurns.length = 0;
        renderChat();
        reflectChatReady();
        persistTranscript();
    }


    // ---------- after the meeting: the kind's own document, the follow-up email, and you ----------
    // Beside the recap, written when asked: the document this kind of meeting ends in (a scorecard
    // for an interview, call notes for a sales call…), the follow-up email, and "How You Did" — a
    // private note on the user's own side of the conversation, with a few numbers counted here.
    // The numbers and the note need to know which lines are the user's: "You" when their voice is
    // recognised, otherwise the speaker they pick.
    const docs = { notes: '', email: '', coach: '' };
    let docRun = null, docError = '', recapTab = 'recap', docFrame = 0;
    const DOC_ABOUT = {
        notes: () => `${kindOf(session.type).doc}: what a ${kindOf(session.type).name.replace(/\s*\(.*\)$/, '').toLowerCase()} should leave you with, written from what was said, with the minute for each point.`,
        email: () => 'A follow-up email, drafted from what was said and agreed. Yours to edit before it goes anywhere.',
        coach: () => 'A private note on how you handled your side: what worked, what to try next time, and one moment worth a second look. Only you see it.',
    };
    const DOC_BUTTON = { notes: () => `Write the ${kindOf(session.type).doc}`, email: () => 'Draft the Email', coach: () => 'Write My Feedback' };
    const RECAP_NOTE = {
        recap: 'A share link carries the recap inside the link itself — it isn’t stored anywhere, and anyone with the link can read it. Past meetings are kept in this browser only.',
        notes: 'Written by AI from this meeting’s record. Worth a read before you rely on it or pass it on.',
        email: 'A draft, from this meeting’s record. Read it before you send it — names and dates most of all.',
        coach: 'Only you see this. It isn’t part of the recap, the share link or the follow-up email.',
    };

    function mineLabel() {
        if (segments.some((seg) => seg.speaker === 'You')) return 'You';
        return session.me && segments.some((seg) => seg.speaker === session.me) ? session.me : '';
    }

    // What can be counted without asking anyone: how much of the talking was yours, the longest
    // you went without anyone else speaking, and the questions you asked.
    function coachStats() {
        const me = mineLabel();
        if (!me) return null;
        let mine = 0, total = 0, questions = 0, run = 0, runStart = null, longest = 0, longestAt = null, last = null;
        const others = new Map();
        for (const seg of segments) {
            const who = seg.speaker || last;
            last = who;
            const n = wordCount(seg.text);
            total += n;
            if (who === me) {
                mine += n;
                questions += (seg.text.match(/[?？؟]/g) || []).length;
                if (!run) runStart = seg;
                run += n;
                if (run > longest) { longest = run; longestAt = runStart; }
            } else {
                run = 0;
                if (who) others.set(who, (others.get(who) || 0) + n);
            }
        }
        if (!total || !mine) return null;
        return {
            me, share: mine / total, people: others.size + 1,
            others: [...others].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, n]) => ({ name, share: n / total })),
            longestS: Math.round(longest / 2.5), longestMin: longestAt && Number.isFinite(longestAt.t) ? Math.floor(longestAt.t / 60000) : null,
            questions, asked: askNext.asked.length, suggested: stats.questions,
        };
    }
    const spanText = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim() : `${s} s`);

    function renderCoachNumbers() {
        const box = $('coach-numbers');
        box.replaceChildren();
        const c = coachStats();
        if (!c) {
            // No line is known to be the user's: they say which speaker they were.
            const names = [...new Set(segments.map((seg) => seg.speaker).filter(Boolean))];
            if (!names.length) { box.append('Once speakers are told apart, this shows how much of the talking was yours.'); return; }
            const label = el('label', '', 'Which speaker were you?');
            const select = document.createElement('select');
            select.id = 'coach-me';
            select.append(new Option('Choose…', ''));
            for (const name of names) select.append(new Option(name, name));
            select.addEventListener('change', () => {
                session.me = select.value;
                persistSession();
                reflectOutcome();
            });
            label.append(select);
            box.append(label, el('div', '', 'Or turn on “Recognise my voice” next time, and ReVerb will know.'));
            return;
        }
        const kind = kindOf(session.type);
        const pct = Math.round(c.share * 100);
        const list = el('ul');
        const line = (...parts) => { const li = el('li'); li.append(...parts); list.append(li); };
        const guide = kind.talkMax
            ? `In a ${kind.name.replace(/\s*\(.*\)$/, '').toLowerCase()}, aim for under about ${kind.talkMax}% — ${kind.talkWhy}.`
            : `An even share among ${c.people} would be ${Math.round(100 / c.people)}%.`;
        const share = el('b', kind.talkMax && pct > kind.talkMax ? 'over' : '', `${pct}% of the talking`);
        line(c.me === 'You' ? 'You did ' : `${c.me} (you) did `, share, `. ${guide}`);
        if (c.longestS >= 20) line('Longest stretch without anyone else speaking: ', el('b', '', `about ${spanText(c.longestS)}`), c.longestMin != null ? `, around ${c.longestMin}m.` : '.');
        line('Questions you asked: ', el('b', '', String(c.questions)), '.');
        if (c.suggested) line('Suggested questions that got asked: ', el('b', '', `${c.asked} of ${c.suggested}`), '.');
        box.append(list);
    }

    // The same counts, as a sentence for the model writing the note.
    function coachNumbersText() {
        const c = coachStats();
        if (!c) return '';
        return [
            `"${c.me}" spoke about ${Math.round(c.share * 100)}% of the words${c.others.length ? ` (${c.others.map((o) => `${o.name} ${Math.round(o.share * 100)}%`).join(', ')})` : ''}.`,
            c.longestS >= 20 ? `Longest uninterrupted stretch about ${spanText(c.longestS)}${c.longestMin != null ? ` at [${c.longestMin}m]` : ''}.` : '',
            `Asked ${c.questions} question${c.questions === 1 ? '' : 's'}.`,
        ].filter(Boolean).join(' ');
    }

    function renderDoc(target, what, text, cite) {
        const plain = what === 'recap' || what === 'email';
        target.classList.toggle('plain', plain);
        if (plain) target.textContent = text;
        else target.innerHTML = cite(renderMarkdown(text));
    }

    function reflectOutcome() {
        for (const tab of $('recap-tabs').querySelectorAll('[role="tab"]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === recapTab));
        $('recap-tabs').querySelector('[data-tab="notes"]').textContent = kindOf(session.type).doc;
        const isRecap = recapTab === 'recap';
        $('recap-preview').hidden = !isRecap;
        $('outcome-pane').hidden = isRecap;
        $('recap-link').hidden = !isRecap;
        $('recap-email').hidden = !(isRecap || (recapTab === 'email' && docs.email && !docRun));
        $('recap-email').textContent = isRecap ? 'Email' : 'Open in Mail';
        $('recap-note').textContent = RECAP_NOTE[recapTab];
        $('outcome-rewrite').hidden = true;
        if (isRecap) return;

        const text = docs[recapTab];
        const running = Boolean(docRun && docRun.what === recapTab);
        $('coach-numbers').hidden = recapTab !== 'coach';
        if (recapTab === 'coach') renderCoachNumbers();
        // The note is about the user's own lines, so it waits until ReVerb knows which they are.
        const blocked = recapTab === 'coach' && !mineLabel();
        $('outcome-empty').hidden = Boolean(text) || running || blocked;
        $('outcome-about').textContent = DOC_ABOUT[recapTab]();
        $('outcome-write').textContent = DOC_BUTTON[recapTab]();
        $('outcome-write').disabled = Boolean(docRun);
        const out = $('outcome-text');
        out.hidden = !(text || running);
        if (text) renderDoc(out, recapTab, text, citeMinutes);
        else if (running) out.innerHTML = `<span class="chat-thinking">${spinnerSvg}<span>Reading the meeting…</span></span>`;
        $('outcome-error').hidden = !(docError && !running && docErrorFor === recapTab);
        $('outcome-error').textContent = docError;
        $('outcome-rewrite').hidden = !text || Boolean(docRun);
    }

    let docErrorFor = '';
    async function writeDoc(what) {
        if (docRun || !segments.length || !docs.hasOwnProperty(what)) return;
        const controller = new AbortController();
        const epoch = sessionEpoch;
        docRun = { what, controller };
        docs[what] = '';
        docError = '';
        inflight.add(controller);
        const cap = setTimeout(() => controller.abort(), CHAT_MAX_MS);
        reflectOutcome();
        try {
            await streamSse(outcomeUrl, {
                what,
                transcript: chatTranscript(),
                state: meetingState,
                session: briefForServer({ materials: false }),
                todos: todos.map(todoLine).join('\n'),
                ...(what === 'coach' ? { me: mineLabel(), numbers: coachNumbersText() } : {}),
            }, controller.signal, {
                alive: () => epoch === sessionEpoch,
                onDelta: (text) => {
                    docs[what] += text;
                    if (!docFrame) docFrame = requestAnimationFrame(() => { docFrame = 0; if (recapTab === what) reflectOutcome(); });
                },
            });
        } catch (err) {
            if (epoch !== sessionEpoch) return;
            console.error('ReVerb outcome error:', err);
            docErrorFor = what;
            docError = `${err.name === 'AbortError' ? 'That took too long.' : err.name === 'TypeError' ? 'Couldn’t reach the server.' : err.message || 'Something went wrong.'} ${docs[what] ? 'What arrived is above.' : 'Try again.'}`;
        } finally {
            clearTimeout(cap);
            inflight.delete(controller);
            if (epoch === sessionEpoch) {
                docRun = null;
                docs[what] = docs[what].trim();
                reflectOutcome();
                persistTranscript();
                // A meeting already saved keeps what is written for it afterwards.
                const saved = readLibrary();
                const entry = saved.find((e) => e.id === meetingId());
                if (entry && docs[what]) { entry.docs = savedDocs(); writeLibrary(saved); }
            }
        }
    }
    const savedDocs = () => Object.fromEntries(Object.entries(docs).filter(([, text]) => text));

    // "Subject: …" on the first line of the draft becomes the mail's subject.
    function mailDraft() {
        const m = /^\s*Subject:\s*(.*)\n+([\s\S]*)$/i.exec(docs.email);
        const subject = m ? m[1].trim() : `Follow-up: ${session.objective || 'our meeting'}`;
        let body = (m ? m[2] : docs.email).replace(/\n+Check before sending:[\s\S]*$/i, '').trim();
        if (body.length > 1800) body = `${body.slice(0, 1800).replace(/\n[^\n]*$/, '')}\n…`;
        location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    // ---------- recap: what the meeting produced, to send on ----------
    // Shorter than the summary: what was decided, who is doing what, and what is still open —
    // the part people actually forward.
    function buildRecap() {
        const state = meetingState || {};
        const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
        const firstTopic = Array.isArray(state.topics) && state.topics[0] && state.topics[0].name;
        return {
            v: 1,
            title: session.objective || firstTopic || 'Meeting',
            date: startedAt || Date.now(),
            minutes: Math.round(meetingClock() / 60000),
            people: participants.map((p) => p && p.name).filter((n) => n && !isPlaceholder(n)),
            headline: state.headline || '',
            decisions: list(state.decisions),
            todos: todos.map((t) => ({ task: t.task, owner: t.owner, due: t.due, done: t.done })),
            open: list(state.openThreads),
            points: list(state.keyPoints),
            glossary: glossary.map((g) => ({ term: g.term, definition: g.definition })),
        };
    }

    const todoLine = (t) => `${t.done ? '☑' : '☐'} ${t.task}${t.owner || t.due ? ` — ${[t.owner, t.due ? `due ${t.due}` : ''].filter(Boolean).join(', ')}` : ''}`;

    function recapText(r, opts) {
        const withTodos = !(opts && opts.todos === false);
        const parts = [r.title];
        const when = new Date(r.date).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
        parts.push([when, r.minutes ? `${r.minutes} min` : '', (r.people || []).join(', ')].filter(Boolean).join(' · '), '');
        if (r.headline) parts.push(r.headline, '');
        const section = (label, items) => {
            if (!items || !items.length) return;
            parts.push(`${label}:`, ...items.map((i) => `  ${i}`), '');
        };
        section('Decided', (r.decisions || []).map((d) => `• ${d}`));
        if (withTodos) section('To-dos', (r.todos || []).map(todoLine));
        section('Still open', (r.open || []).map((o) => `• ${o}`));
        section('Key points', (r.points || []).map((k) => `• ${k}`));
        section('Glossary', (r.glossary || []).map((g) => `• ${g.term} — ${g.definition}`));
        return parts.join('\n').trim();
    }

    // The recap travels inside the link — compressed, in the part of the URL after "#", which
    // browsers never send to a server. Nothing is stored anywhere to make the link work.
    function toBase64Url(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    async function recapLink(r) {
        const bytes = new TextEncoder().encode(JSON.stringify(r));
        let code = 'j' + toBase64Url(bytes);
        if (typeof CompressionStream === 'function') {
            const zipped = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            code = 'z' + toBase64Url(new Uint8Array(await new Response(zipped).arrayBuffer()));
        }
        return `${new URL('../recap/', location.href).href}#r=${code}`;
    }

    let recapShown = null, recapUrl = '';
    function openRecap() {
        recapShown = buildRecap();
        recapUrl = '';
        const shown = recapShown;
        recapLink(shown).then((url) => { if (recapShown === shown) recapUrl = url; }).catch(() => {});
        $('recap-preview').textContent = recapText(recapShown);
        const saved = readLibrary().some((e) => e.id === meetingId());
        $('recap-save').textContent = saved ? 'Update Saved Copy' : 'Save to Past Meetings';
        recapTab = 'recap';
        reflectOutcome();
        $('recap-modal').classList.remove('hidden');
        $('recap-copy').focus();
    }
    const closeModal = (id) => $(id).classList.add('hidden');

    async function emailRecap() {
        const r = recapShown || buildRecap();
        const link = await recapLink(r).catch(() => '');
        let body = recapText(r);
        // Mail apps cut long mailto bodies short; past this, the link carries the rest.
        if (body.length > 1800) body = `${body.slice(0, 1800).replace(/\n[^\n]*$/, '')}\n…`;
        if (link) body += `\n\nFull recap: ${link}`;
        location.href = `mailto:?subject=${encodeURIComponent(`Recap: ${r.title}`)}&body=${encodeURIComponent(body)}`;
    }

    // ---------- past meetings ----------
    // Kept only when the user asks — End session still erases the meeting itself. One entry
    // per meeting, keyed by when it started, so saving again updates rather than duplicates.
    const meetingId = () => `m-${startedAt || 0}`;
    function readLibrary() {
        try {
            const v = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
            return Array.isArray(v) ? v.filter((e) => e && e.id && e.recap && e.recap.title) : [];
        } catch (err) { return []; }
    }
    // When the browser's storage is full, the oldest meetings give up their transcripts first;
    // their recaps stay, and can still be asked about.
    function writeLibrary(list) {
        let entries = list.slice(0, LIBRARY_MAX);
        for (;;) {
            try {
                localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
                reflectLibrary();
                return true;
            } catch (err) {
                let oldest = -1;
                entries.forEach((e, i) => { if (e.transcript) oldest = i; });
                if (oldest < 0) break;
                entries = entries.map((e, i) => (i === oldest ? { ...e, transcript: '' } : e));
            }
        }
        errorEl.textContent = 'Could not save — this browser’s storage is full or blocked.';
        reflectLibrary();
        return false;
    }
    // A saved meeting keeps its recap and, so it can be asked about later, its transcript, its
    // summary and the corrections made to it. In this browser only, until it is deleted.
    function saveToLibrary() {
        if (!segments.length) return;
        const transcript = attributedTranscript(0, { timed: true });
        const entry = {
            id: meetingId(), savedAt: Date.now(), recap: recapShown || buildRecap(),
            roster: (session.roster || []).slice(0, 40), keywords: session.keywords.slice(0, 100), type: session.type,
            objective: session.objective || '',
            transcript: transcript.length > LIBRARY_TRANSCRIPT_CHARS
                ? `[The transcript starts partway through the meeting.]\n${transcript.slice(-LIBRARY_TRANSCRIPT_CHARS)}`
                : transcript,
            state: meetingState || null,
            notes: sessionNotes.trim().slice(0, NOTES_MAX),
            ...(Object.keys(savedDocs()).length ? { docs: savedDocs() } : {}),
        };
        if (!writeLibrary([entry, ...readLibrary().filter((e) => e.id !== entry.id)])) return;
        $('recap-save').textContent = 'Saved';
        toast('Saved to Past Meetings');
    }
    function reflectLibrary() {
        $('library-btn').classList.toggle('hidden', isListening);
        reflectChatReady();
    }

    function openLibrary() {
        const list = $('library-list');
        list.replaceChildren();
        for (const entry of readLibrary()) {
            const r = entry.recap;
            const li = el('li', 'library-item');
            const info = el('button', 'open-meeting');
            info.type = 'button';
            info.title = 'Open its recap and ask about it';
            info.append(el('div', 'title', r.title), el('div', 'when',
                [new Date(r.date).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
                    r.minutes ? `${r.minutes} min` : '', `${(r.todos || []).filter((t) => !t.done).length} open to-dos`].filter(Boolean).join(' · ')));
            info.addEventListener('click', () => showPastMeeting(entry));
            const actions = el('div', 'actions');
            const view = el('button', '', 'Open');
            view.type = 'button';
            view.addEventListener('click', () => showPastMeeting(entry));
            const follow = el('button', '', 'Follow up');
            follow.type = 'button';
            follow.disabled = segments.length > 0;
            if (follow.disabled) follow.title = 'End the current session first';
            follow.addEventListener('click', () => { closeModal('library-modal'); startFollowUp(entry); });
            const del = el('button', 'delete', 'Delete');
            del.type = 'button';
            let armed = 0;
            del.addEventListener('click', () => {
                if (!armed) { del.textContent = 'Delete?'; armed = setTimeout(() => { armed = 0; del.textContent = 'Delete'; }, 3000); return; }
                clearTimeout(armed);
                writeLibrary(readLibrary().filter((e) => e.id !== entry.id));
                li.remove();
                if (!readLibrary().length) openLibrary();
            });
            actions.append(view, follow, del);
            li.append(info, actions);
            list.append(li);
        }
        const n = list.childElementCount;
        $('library-empty').hidden = n > 0;
        $('library-backup').hidden = !n;
        $('library-index').hidden = false;
        $('library-meeting').hidden = true;
        $('library-modal').classList.remove('hidden');
    }

    // ---------- backup: saved meetings as a file ----------
    // Saved meetings live in this one browser. A backup file is the way to keep them safe, or to
    // carry them to another browser or computer: everything a saved meeting holds, and nothing
    // else — not the sign-in, not the voice sample.
    function backupLibrary() {
        const meetings = readLibrary();
        if (!meetings.length) return;
        const file = { app: 'ReVerb', kind: 'backup', v: 1, exportedAt: new Date().toISOString(), meetings };
        downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `reverb-meetings-${fileStamp().slice(0, 10)}.json`);
        toast(`Backed up ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`);
    }

    // A backup is a file from outside: every field is checked and clipped before it is kept, and
    // nothing in it is ever treated as markup.
    function cleanMeeting(m) {
        if (!m || typeof m !== 'object' || !m.recap || typeof m.recap !== 'object') return null;
        const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
        const list = (v, n, len) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => x.slice(0, len)) : []);
        const r = m.recap;
        const title = str(r.title, 300).trim();
        if (!title) return null;
        const date = Number.isFinite(r.date) ? r.date : Date.now();
        const recap = {
            v: 1, title, date,
            minutes: Number.isFinite(r.minutes) ? Math.max(0, Math.min(1440, Math.round(r.minutes))) : 0,
            people: list(r.people, 40, 80), headline: str(r.headline, 600),
            decisions: list(r.decisions, 40, 400), open: list(r.open, 40, 400), points: list(r.points, 40, 400),
            todos: (Array.isArray(r.todos) ? r.todos : []).filter((t) => t && typeof t.task === 'string' && t.task.trim()).slice(0, 80)
                .map((t) => ({ task: t.task.slice(0, 300), owner: str(t.owner, 80), due: str(t.due, 80), done: Boolean(t.done) })),
            glossary: (Array.isArray(r.glossary) ? r.glossary : []).filter((g) => g && typeof g.term === 'string' && typeof g.definition === 'string').slice(0, 80)
                .map((g) => ({ term: g.term.slice(0, 120), definition: g.definition.slice(0, 600) })),
        };
        let state = null;
        try { if (m.state && typeof m.state === 'object' && JSON.stringify(m.state).length <= 60000) state = m.state; } catch (err) { /* not kept */ }
        const docs = {};
        for (const key of ['notes', 'email', 'coach']) {
            const text = m.docs && str(m.docs[key], 12000).trim();
            if (text) docs[key] = text;
        }
        return {
            id: typeof m.id === 'string' && /^m-\d{1,16}$/.test(m.id) ? m.id : `m-${date}`,
            savedAt: Number.isFinite(m.savedAt) ? m.savedAt : Date.now(),
            recap, roster: list(m.roster, 40, 80), keywords: list(m.keywords, 100, 80),
            type: KINDS[m.type] ? m.type : 'general', objective: str(m.objective, 600),
            transcript: str(m.transcript, LIBRARY_TRANSCRIPT_CHARS + 100), state, notes: str(m.notes, NOTES_MAX),
            ...(Object.keys(docs).length ? { docs } : {}),
        };
    }

    async function restoreLibrary(file) {
        if (!file) return;
        if (file.size > 25e6) { toast('That file is too large to be a ReVerb backup'); return; }
        let data;
        try { data = JSON.parse(await file.text()); } catch (err) { toast('That isn’t a ReVerb backup file'); return; }
        if (!data || data.app !== 'ReVerb' || data.kind !== 'backup' || !Array.isArray(data.meetings)) { toast('That isn’t a ReVerb backup file'); return; }
        const incoming = data.meetings.slice(0, 200).map(cleanMeeting).filter(Boolean);
        if (!incoming.length) { toast('No meetings in that backup'); return; }
        // The same meeting in both: the copy saved later wins.
        const byId = new Map(readLibrary().map((e) => [e.id, e]));
        let added = 0, updated = 0;
        for (const m of incoming) {
            const have = byId.get(m.id);
            if (!have) { byId.set(m.id, m); added++; }
            else if (m.savedAt > (have.savedAt || 0)) { byId.set(m.id, m); updated++; }
        }
        const merged = [...byId.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        const dropped = Math.max(0, merged.length - LIBRARY_MAX);
        if (!writeLibrary(merged)) return;
        openLibrary();
        toast(added || updated
            ? `Restored ${added + updated} meeting${added + updated === 1 ? '' : 's'}${dropped ? ` — the ${dropped} oldest didn’t fit` : ''}`
            : 'Those meetings are already here');
    }

    // ---------- one past meeting: its recap, and a chat about it alone ----------
    // Past meetings are rarely about the same thing, so each is asked about on its own, from its
    // own screen, with only its own record: the transcript, summary and corrections saved with it.
    // A meeting saved before transcripts were kept is answered from its recap.
    const pastChats = new Map();   // meeting id → [{ question, answer, status, error, el }]
    let pastOpen = null, pastActive = null;
    const pastTurns = (entry) => {
        if (!pastChats.has(entry.id)) pastChats.set(entry.id, []);
        return pastChats.get(entry.id);
    };

    function showPastMeeting(entry) {
        if (pastActive) pastActive.stop();
        pastOpen = entry;
        const r = entry.recap;
        $('library-index').hidden = true;
        $('library-meeting').hidden = false;
        $('pm-title').textContent = r.title;
        $('pm-when').textContent = [
            new Date(r.date).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
            r.minutes ? `${r.minutes} min` : '', (r.people || []).join(', '),
        ].filter(Boolean).join(' · ');
        // The title and date are already above the recap. Anything written for the meeting — its
        // notes, the email draft, the private feedback — was saved with it, each behind a tab.
        const views = { recap: recapText(r).split('\n').slice(2).join('\n').trim(), ...(entry.docs || {}) };
        const labels = { recap: 'Recap', notes: kindOf(entry.type).doc, email: 'Follow-Up Email', coach: 'How You Did' };
        const tabs = $('pm-tabs');
        tabs.replaceChildren();
        const show = (key) => {
            for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === key));
            renderDoc($('pm-recap'), key, views[key], (html) => pastCites(html, entry));
        };
        for (const key of ['recap', 'notes', 'email', 'coach']) {
            if (!views[key]) continue;
            const b = el('button', '', labels[key]);
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.dataset.tab = key;
            b.addEventListener('click', () => show(key));
            tabs.append(b);
        }
        tabs.hidden = tabs.childElementCount < 2;
        show('recap');
        $('pm-chat-note').textContent = entry.transcript
            ? 'Answered only from this meeting’s transcript, summary and corrections, with the minute each point was said.'
            : 'Saved before transcripts were kept, so answers come from its recap only.';
        $('pm-follow').disabled = segments.length > 0;
        $('pm-follow').title = segments.length ? 'End the current session first' : 'Start a new meeting that picks up from this one';
        $('pm-delete').textContent = 'Delete';
        const log = $('pm-log');
        log.replaceChildren();
        for (const t of pastTurns(entry)) { t.el = null; renderPastTurn(t); }
        reflectPastChat();
        $('pm-input').focus();
    }

    function showLibraryIndex() {
        if (pastActive) pastActive.stop();
        pastOpen = null;
        openLibrary();
    }

    // Minutes in a past meeting's answer can't jump to a transcript on screen, so each shows the
    // line it points at when hovered.
    function pastCites(html, entry) {
        const text = (entry && entry.transcript) || '';
        const lineAt = (m) => {
            const i = text.indexOf(`[${m}m]`);
            return i < 0 ? `Minute ${m}` : `${text.slice(i + m.length + 3, i + 200).replace(/\s+/g, ' ').trim()}…`;
        };
        return html.replace(/\[(~?\d{1,4}m(?:\s*(?:[,–—-]|and)\s*~?\d{1,4}m)*)\]/g, (_, inner) =>
            inner.match(/\d{1,4}(?=m)/g).map((m) =>
                `<span class="cite cite-static" title="${escapeHtmlText(lineAt(m))}">${m}m</span>`).join(''));
    }

    function renderPastTurn(turn) {
        const log = $('pm-log');
        if (!turn.el) {
            turn.el = el('div', 'chat-turn');
            turn.el.append(el('div', 'chat-q', turn.question));
            const a = el('div', 'chat-a');
            a.append(el('div', 'reverb-answer'), el('div', 'chat-a-foot'));
            turn.el.append(a);
            log.append(turn.el);
        }
        const body = turn.el.querySelector('.reverb-answer');
        const foot = turn.el.querySelector('.chat-a-foot');
        foot.replaceChildren();
        if (turn.answer.trim()) body.innerHTML = pastCites(renderMarkdown(turn.answer), pastOpen);
        else if (turn.status === 'streaming') body.innerHTML = `<span class="chat-thinking">${spinnerSvg}<span>Reading the meeting…</span></span>`;
        else body.replaceChildren();
        const button = (label, act) => {
            const b = el('button', '', label);
            b.type = 'button';
            b.dataset.act = act;
            foot.append(b);
        };
        if (turn.status === 'failed' || turn.status === 'stopped') {
            foot.append(el('span', 'chat-a-error', turn.status === 'stopped' ? 'Stopped.' : turn.error || 'Something went wrong.'));
            button('Try again', 'retry');
        }
        if (turn.status !== 'streaming' && turn.answer.trim()) button('Copy', 'copy');
        foot.hidden = !foot.childElementCount;
    }

    function reflectPastChat() {
        const input = $('pm-input'), send = $('pm-send');
        send.textContent = pastActive ? 'Stop' : 'Ask';
        send.classList.toggle('stop', Boolean(pastActive));
        send.disabled = !pastActive && !input.value.trim();
    }

    async function askPast(question, retryOf) {
        const entry = pastOpen;
        if (!entry || pastActive) return;
        const q = String(question || '').trim().slice(0, CHAT_QUESTION_MAX);
        if (!q) return;
        const turns = pastTurns(entry);
        let turn = retryOf;
        if (turn) Object.assign(turn, { answer: '', status: 'streaming', error: '' });
        else {
            turn = { question: q, answer: '', status: 'streaming', error: '', el: null };
            turns.push(turn);
        }
        renderPastTurn(turn);
        turn.el.scrollIntoView({ block: 'nearest' });

        const controller = new AbortController();
        let stalled = false, stopped = false, stallTimer = null;
        const bump = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, CHAT_STALL_MS);
        };
        const capTimer = setTimeout(() => controller.abort(), CHAT_MAX_MS);
        pastActive = { controller, turn, stop: () => { stopped = true; controller.abort(); } };
        reflectPastChat();

        const history = [];
        for (const t of turns) {
            if (t === turn) break;
            if (t.status === 'done' && t.answer.trim()) history.push({ role: 'user', text: t.question }, { role: 'assistant', text: t.answer });
        }
        const r = entry.recap;
        const date = new Date(r.date).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        let frame = 0;
        try {
            bump();
            await streamChat({
                question: turn.question,
                history: history.slice(-CHAT_HISTORY_TURNS * 2),
                transcript: entry.transcript || '',
                state: entry.state || null,
                insights: [],
                session: {
                    type: entry.type, objective: entry.objective || r.title,
                    roster: entry.roster || [], keywords: (entry.keywords || []).slice(0, 100),
                    ...(entry.notes ? { notes: entry.notes } : {}),
                },
                // Saved before transcripts were kept: its recap is all there is to answer from.
                ...(entry.transcript ? {} : { earlier: [{
                    title: r.title, date,
                    summary: recapText(r, { todos: false }).slice(0, 6000),
                    todos: (r.todos || []).map(todoLine).join('\n').slice(0, 2000),
                }] }),
            }, controller.signal, {
                onBytes: bump,
                onDelta: (text) => {
                    turn.answer += text;
                    if (!frame && pastOpen === entry) frame = requestAnimationFrame(() => { frame = 0; renderPastTurn(turn); });
                },
            });
            turn.status = 'done';
        } catch (err) {
            if (stopped) turn.status = 'stopped';
            else {
                console.error('ReVerb past-meeting chat error:', err);
                turn.status = 'failed';
                turn.error = stalled ? 'The answer stopped partway.'
                    : err.name === 'TypeError' ? 'Couldn’t reach the server.'
                    : err.message || 'Something went wrong.';
            }
        } finally {
            clearTimeout(stallTimer);
            clearTimeout(capTimer);
            if (frame) cancelAnimationFrame(frame);
            pastActive = null;
            if (pastOpen === entry) renderPastTurn(turn);
            reflectPastChat();
        }
    }

    function submitPast() {
        if (pastActive) { pastActive.stop(); return; }
        const input = $('pm-input');
        const q = input.value.trim();
        if (!q) return;
        input.value = '';
        reflectPastChat();
        askPast(q);
    }

    // A follow-up starts with the last meeting's outcome in the brief: its decisions, what was
    // left open and the to-dos, as background the cards and the chat can check against.
    function startFollowUp(entry) {
        const r = entry.recap;
        const when = new Date(r.date).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        const block = (label, items) => (items && items.length ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : '');
        session.objective = '';
        session.type = entry.type || session.type;
        session.roster = Array.isArray(entry.roster) ? entry.roster.slice() : [];
        session.keywords = Array.isArray(entry.keywords) ? entry.keywords.slice() : [];
        session.agenda = [];
        session.materials = [
            `FROM THE LAST MEETING — ${r.title} (${when})`,
            block('Decided', r.decisions),
            block('Still open', r.open),
            block('To-dos', (r.todos || []).map((t) => todoLine(t).replace(/^[☐☑] /, t.done ? '[done] ' : ''))),
        ].filter(Boolean).join('\n\n').slice(0, MATERIALS_MAX);
        session.followUp = { id: entry.id, title: r.title };
        openSetup();
    }

    // ---------- calendar invites ----------
    // An .ics file, or whatever gets pasted out of a calendar: the title, the guests, the
    // description. No calendar sign-in — it works with any calendar that can show an invite.
    const VIDEO_NOISE = /(zoom\.us|meet\.google|teams\.microsoft|webex|join with|meeting id|passcode|password:|dial[- ]in|one tap|tel:|^-::~|^\+?\d[\d\s().-]{7,}$|invitation from google|reply for|learn more about|view all guest|^─|^_{5,})/i;
    function personFromAddress(s) {
        const m = /^(.*?)<\s*([^>]+@[^>]+)>/.exec(s);
        if (m && m[1].replace(/["']/g, '').trim()) return m[1].replace(/["']/g, '').trim();
        const email = (s.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [])[0];
        if (!email || /resource\.calendar|group\.calendar|noreply|no-reply|calendar-notification/i.test(email)) return '';
        return email.split('@')[0].split(/[._+-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    }

    function parseIcsDate(v) {
        const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?/.exec(v || '');
        if (!m) return null;
        const parts = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
        return m[7] ? Date.UTC(...parts) : new Date(...parts).getTime();
    }

    function parseInvite(text) {
        const out = { title: '', people: [], agenda: [], notes: '', durationMin: null };
        if (/BEGIN:VEVENT/i.test(text)) {
            const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
            const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
            let start = null, end = null, description = '';
            for (const line of lines) {
                const i = line.indexOf(':');
                if (i < 0) continue;
                const head = line.slice(0, i), value = line.slice(i + 1);
                const name = head.split(';')[0].toUpperCase();
                if (name === 'SUMMARY' && !out.title) out.title = unescape(value).trim();
                else if (name === 'DESCRIPTION' && !description) description = unescape(value);
                else if (name === 'DTSTART' && start == null) start = parseIcsDate(value);
                else if (name === 'DTEND' && end == null) end = parseIcsDate(value);
                else if (name === 'ATTENDEE' || name === 'ORGANIZER') {
                    const cn = /CN=("?)([^";:]+)\1/i.exec(head);
                    const who = cn ? cn[2].trim() : personFromAddress(value.replace(/^mailto:/i, ''));
                    if (who && !/@/.test(who)) out.people.push(who);
                    else if (who) out.people.push(personFromAddress(who));
                }
            }
            if (start != null && end != null && end > start) out.durationMin = Math.round((end - start) / 60000);
            text = description;
        } else {
            const lines = text.replace(/\r\n?/g, '\n').split('\n');
            const first = lines.find((l) => l.trim());
            out.title = first ? first.trim() : '';
            text = lines.slice(lines.indexOf(first) + 1).join('\n');
        }
        // Guests and agenda sections, then whatever is left as background.
        let mode = '';
        const rest = [];
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            if (!line) { mode = mode === 'agenda' || mode === 'guests' ? '' : mode; rest.push(''); continue; }
            if (VIDEO_NOISE.test(line)) continue;
            if (/^(guests|attendees|participants|invitees|who)\s*:?\s*$/i.test(line)) { mode = 'guests'; continue; }
            if (/^agenda\s*:?\s*$/i.test(line)) { mode = 'agenda'; continue; }
            if (mode === 'guests' || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(line)) {
                const who = /@/.test(line) ? personFromAddress(line) : line.replace(/\s*[-–(].*$/, '').trim();
                if (who) out.people.push(who);
                continue;
            }
            if (mode === 'agenda') { out.agenda.push(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')); continue; }
            rest.push(line);
        }
        out.notes = rest.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        out.people = [...new Set(out.people.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p && p.length <= 60))];
        return out;
    }

    // Fills what is empty; never overwrites what the user already typed.
    function applyInvite(text) {
        const info = parseInvite(text || '');
        if (!info.title && !info.people.length && !info.agenda.length && !info.notes) {
            $('followup-note').textContent = 'Couldn’t find anything to use in that invite.';
            return;
        }
        const set = (id, value) => { if (value && !$(id).value.trim()) $(id).value = value; };
        set('setup-objective', info.title);
        if (info.people.length) {
            const roster = $('setup-roster');
            const have = roster.value.split(',').map((n) => n.trim()).filter(Boolean);
            for (const person of info.people) {
                // "Dana" already in the brief is "Dana Whitfield" from the invite, not someone else.
                const first = person.split(/\s+/)[0].toLowerCase();
                const i = have.findIndex((h) => h.toLowerCase() === person.toLowerCase() || (!/\s/.test(h) && h.toLowerCase() === first));
                if (i >= 0) have[i] = person; else have.push(person);
            }
            roster.value = [...new Set(have)].join(', ');
        }
        if (info.agenda.length) set('setup-agenda', info.agenda.slice(0, 20).join('\n'));
        if (info.durationMin) set('setup-duration', String(Math.min(600, info.durationMin)));
        if (info.notes) {
            const box = $('setup-materials');
            if (!box.value.includes(info.notes.slice(0, 80))) box.value = [box.value.trim(), info.notes].filter(Boolean).join('\n\n').slice(0, MATERIALS_MAX);
            reflectMaterialsCount();
        }
        if (info.agenda.length || info.durationMin || info.notes) $('setup-more').open = true;
        $('invite-box').hidden = true;
        $('followup-note').textContent = `Filled from the invite${info.people.length ? ` · ${info.people.length} ${info.people.length === 1 ? 'person' : 'people'}` : ''}`;
    }

    // ---------- right column: AI Insights | Chat ----------
    // A phone shows one pane at a time; a desktop keeps the transcript and swaps the right
    // column. Both remember the last choice, so turning the device keeps you where you were.
    const insightsHidden = () => (phoneLayout.matches ? panels.dataset.pane !== 'insights' : panels.dataset.side === 'chat');

    function reflectUnread() {
        const label = unreadInsights > 9 ? '9+' : String(unreadInsights);
        insightsUnread.textContent = label;
        insightsUnread.hidden = !unreadInsights;
        for (const b of document.querySelectorAll('.side-unread')) { b.textContent = label; b.hidden = !unreadInsights; }
    }

    function showSide(side) {
        panels.dataset.side = side;
        for (const tab of document.querySelectorAll('.side-tabs [role="tab"]')) {
            tab.setAttribute('aria-selected', String(tab.dataset.side === side));
        }
        if (!insightsHidden()) { unreadInsights = 0; reflectUnread(); }
    }

    function openChat(prefill) {
        if (phoneLayout.matches) showPane('chat');
        else showSide('chat');
        if (prefill) {
            chatInput.value = prefill;
            sizeChatInput();
            reflectChatReady();
        }
        if (!chatInput.disabled) {
            chatInput.focus();
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        }
    }

    // ---------- diagnostics ----------
    function percentile(values, p) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    }

    // Written so each measured number sits next to the threshold it should inform, and
    // says which way to move it. A column of raw figures nobody can act on is no better
    // than the guesses it replaces.
    function diagnosticsText() {
        const secs = (n) => (n == null ? '—' : `${(n / 1000).toFixed(1)}s`);
        const totals = stats.answers.map(a => a.ms);
        const firsts = stats.answers.map(a => a.firstTokenMs).filter(n => n != null);
        const max = (arr) => (arr.length ? Math.max(...arr) : null);
        const tally = (bag, label) => Object.entries(bag)
            .map(([k, v]) => `${label ? label(k) : k} ${v}`).join(' · ') || 'none';
        const cardLabel = (k) => (CARD_TYPE_UI[k] ? CARD_TYPE_UI[k].label : k);
        const attributed = segments.filter(s => s.speaker).length;
        const distinct = new Set(segments.map(s => s.speaker).filter(Boolean)).size;

        return [
            `ANSWERS — ${stats.answers.length} completed`,
            `  first token   median ${secs(percentile(firsts, 0.5))}   p90 ${secs(percentile(firsts, 0.9))}   max ${secs(max(firsts))}`,
            `  full answer   median ${secs(percentile(totals, 0.5))}   p90 ${secs(percentile(totals, 0.9))}   max ${secs(max(totals))}`,
            `  stalled ${stats.stalls} · cut off ${stats.truncated} · retried ${stats.retries} · gave up ${stats.errors}`,
            `  → stall window is ${secs(ANALYZE_STALL_MS)}; it should sit clear of the p90 first-token`,
            `    figure above. Stalls above zero with a healthy p90 means raise it.`,
            '',
            `CARDS — ${tally(stats.cards, cardLabel)}`,
            `  filtered as not worth raising ${stats.filtered} · retracted at answer time ${stats.dropped} · action updates merged ${stats.merged}`,
            `  held to hear what came next ${stats.held} · of those dropped because the room covered it ${stats.heldDropped}`,
            `  sweeps ${stats.sweeps} (${stats.sweepFails} failed) · cards the room later addressed ${stats.resolved}`,
            `  your voice: ${session.voiceId ? `${stats.voiceChecks} checks (${stats.voiceFails} failed) · ${stats.voiceYou} lines recognised as yours` : 'off'}`,
            `  suggested questions: ${stats.questionRuns} looks (${stats.questionFails} failed) · ${stats.questions} suggested · ${askNext.asked.length} asked · ${askNext.skipped.length} skipped`,
            `  → a held card dropped is a card that would have been noise; if that is most`,
            `    of them, the hold is earning its delay.`,
            `  feedback: useful ${stats.useful} · not useful ${stats.notUseful} · bias now ${tally(typeBias, cardLabel)}`,
            `  → mostly filtered means the salience bars are right; a panel you ignored`,
            `    means raise them, an empty one means lower them.`,
            '',
            `CAPTURE`,
            `  room noise floor ${stats.noiseFloor == null ? '—' : stats.noiseFloor.toFixed(4)} · speech counted above ${stats.threshold == null ? '—' : stats.threshold.toFixed(4)}`,
            `  longest gap with no speech ${secs(stats.longestSilenceMs)} · warning fires at ${secs(SILENCE_WARN_MS)}`,
            `  → a false "hearing nothing" means that gap was real speech below the`,
            `    threshold: raise SILENCE_WARN_MS, or lower SPEECH_OVER_FLOOR.`,
            `  interruptions: ${tally(stats.interruptions)}`,
            `  screen wake lock: ${stats.wakeLock}`,
            '',
            `SUMMARY — ${stats.statePasses} passes, ${stats.stateFulls} full rebuilds, ${stats.stateFails} failed`,
            `SPEAKERS — ${stats.speakerRuns} passes, ${stats.speakerFails} failed`,
            `  ${attributed}/${segments.length} lines attributed across ${distinct} distinct speaker${distinct === 1 ? '' : 's'}`,
            `  → more distinct speakers than people in the room means the placeholders`,
            `    are fragmenting: put everyone in the roster next time.`,
        ].join('\n');
    }

    function transcriptAsText() {
        const parts = ['ReVerb transcript'];
        if (session.objective) parts.push(`Objective: ${session.objective}`);
        parts.push(`Exported: ${new Date().toLocaleString()}`, '');
        const summary = summaryAsText();
        if (summary) parts.push(summary, '', '—'.repeat(20), '');
        parts.push(attributedTranscript());
        parts.push('', '—'.repeat(20), '', diagnosticsText());
        return parts.join('\n');
    }

    // ---------- cards ----------
    // Created only once the classifier has said there is a card, and slotted in by the order
    // the utterance was spoken: newest first, but a quick answer to something said later
    // never jumps above a slow answer to something said earlier.
    function placeCard(order) {
        placeholderCard.classList.add('hidden');
        const card = document.createElement('div');
        card.dataset.card = 'insight';
        card.dataset.order = String(order);
        card.className = 'p-4 bg-white rounded-xl border border-gray-200 shadow-sm';
        const atTop = insightsAtTop();
        const older = [...insightsContainer.querySelectorAll('[data-card]')].find((c) => Number(c.dataset.order) < order);
        insightsContainer.insertBefore(card, older || null);
        if (atTop) pinInsightsTop();
        else insightsJump.hidden = false;
        if (insightsHidden()) {
            unreadInsights++;
            reflectUnread();
        }
        return card;
    }

    // The line under the title, saying what the card is actually about. It differs per
    // type because "the question someone asked" and "the earlier point this contradicts"
    // are not the same shape of thing, and collapsing them into one generic subtitle is
    // what made every card read the same.
    function cardSubject(meta) {
        const q = escapeHtmlText;
        switch (meta.type) {
            case 'question':      return meta.question ? q(meta.question) : '';
            case 'recall':        return meta.question ? q(meta.question) : '';
            case 'explanation':   return meta.term ? `<b>${q(meta.term)}</b>` : '';
            case 'factcheck':     return meta.claim ? `Claim: “${q(meta.claim)}”` : '';
            case 'contradiction': return [
                meta.reference ? `<b>Earlier:</b> ${q(meta.reference)}` : '',
                meta.claim ? `<b>Just now:</b> ${q(meta.claim)}` : '',
            ].filter(Boolean).join('<br>');
            // A dig-deeper card's gist already names what is being skipped; repeating it as a
            // subject line only doubled the text.
            case 'gap':           return '';
            // From a single line, the gist is the question and this says what it would clear up;
            // a suggested question is its own title, and this says who to ask.
            case 'ask':           return meta.claim ? `Unclear: ${q(meta.claim)}` : meta.to ? `Ask ${q(meta.to)}` : '';
            default:              return '';
        }
    }

    // An action item is already complete as classified — the task, who owns it, and when.
    function actionBody(meta) {
        const who = [meta.owner, meta.due ? `due ${meta.due}` : ''].filter(Boolean).join(' · ');
        return `<p>${escapeHtmlText(meta.claim || meta.title || 'Commitment noted.')}</p>`
            + (who ? `<p class="card-action-meta">${escapeHtmlText(who)}</p>` : '');
    }

    const thumbUp = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V2.75a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" /></svg>';
    const thumbDown = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 01-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398C20.613 14.547 19.833 15 19 15h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 00.303-.54m.023-8.25H16.48a4.5 4.5 0 01-1.423-.23l-3.114-1.04a4.5 4.5 0 00-1.423-.23H6.504c-.618 0-1.217.247-1.605.729A11.95 11.95 0 002.25 12c0 .434.023.863.068 1.285C2.427 14.306 3.346 15 4.372 15h3.126c.618 0 .991.724.725 1.282A7.471 7.471 0 007.5 19.5a2.25 2.25 0 002.25 2.25.75.75 0 00.75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 002.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384" /></svg>';

    const chatBubble = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>';

    function renderSkeleton(card, meta) {
        const ui = CARD_TYPE_UI[meta.type] || { label: 'Insight' };
        const title = meta.title || ui.label;
        const subject = cardSubject(meta);
        const isAction = meta.type === 'action';
        // A question to ask is settled by asking it or skipping it, not by thumbs.
        const isAsk = meta.type === 'ask';
        const foot = isAsk
            ? `<div class="card-ask-actions">
                        <button type="button" data-ask-act="asked" title="I asked it: don’t suggest it again">Asked</button>
                        <button type="button" data-ask-act="skip" title="Not useful: nothing like it will come back">Skip</button>
                    </div>`
            : `<div class="card-feedback">
                        <button type="button" data-ask-card aria-label="Ask about this in chat" title="Ask about this in chat">${chatBubble}</button>
                        <button type="button" data-feedback="up" aria-pressed="false" aria-label="Useful" title="Useful">${thumbUp}</button>
                        <button type="button" data-feedback="down" aria-label="Not useful — hide, and show fewer like this" title="Not useful — hide, and show fewer like this">${thumbDown}</button>
                    </div>`;

        // Drives the accent colour, via the [data-type] custom properties in the stylesheet.
        card.dataset.type = meta.type;
        card.dataset.title = title;
        card.classList.remove('opacity-75');
        card.innerHTML = `
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <span class="card-chip">${escapeHtmlText(ui.label)}</span><span class="card-verdict" hidden></span>
                    <h3 class="card-title text-lg font-medium mt-1">${escapeHtmlText(title)}</h3>
                </div>
                <button data-toggle="collapse" class="p-1 rounded-full text-gray-400 hover:bg-gray-100 flex-shrink-0" aria-label="Collapse card">
                    <svg class="w-5 h-5 chevron-up" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                    <svg class="w-5 h-5 hidden chevron-down" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                </button>
            </div>
            <div class="card-body mt-2 pr-2">
                ${subject ? `<p class="card-subject">${subject}</p>` : ''}
                <div class="reverb-answer text-gray-600 leading-relaxed">
                    <div class="card-gist">${isAction ? actionBody(meta) : '<span class="text-gray-400">…</span>'}</div>
                    <div class="card-more" hidden>
                        <div class="card-more-text"></div>
                        <div class="reverb-sources mt-3 flex flex-wrap gap-2"></div>
                    </div>
                </div>
                <div class="card-foot">
                    <button type="button" class="card-more-toggle" aria-expanded="false" hidden>More</button>
                    ${foot}
                </div>
            </div>`;
        return {
            gist: isAction ? null : card.querySelector('.card-gist'),
            moreText: card.querySelector('.card-more-text'),
            toggle: card.querySelector('.card-more-toggle'),
            verdictEl: card.querySelector('.card-verdict'),
            sources: card.querySelector('.reverb-sources'),
        };
    }

    // The server asks for a gist line, a blank line, then detail. Older answers without the
    // blank line are simply all gist.
    function splitGist(text) {
        const t = text.replace(/^\s+/, '');
        const m = /\n\s*\n/.exec(t);
        return m ? [t.slice(0, m.index), t.slice(m.index + m[0].length)] : [t, ''];
    }

    const VERDICTS = { 'correct': 'correct', 'partly correct': 'partly', 'incorrect': 'incorrect', 'unverified': 'unverified' };
    function parseVerdict(text) {
        const m = /^\s*\*\*(Correct|Partly correct|Incorrect|Unverified)\*\*\s*[—–:-]?\s*/i.exec(text);
        return m ? { verdict: VERDICTS[m[1].toLowerCase()], label: m[1], rest: text.slice(m[0].length) } : { verdict: null, rest: text };
    }

    function renderAnswer(entry) {
        let [gist, more] = splitGist(entry.text);
        if (entry.type === 'factcheck') {
            const v = parseVerdict(gist);
            if (v.verdict) {
                gist = v.rest;
                entry.verdictEl.hidden = false;
                entry.verdictEl.textContent = v.label;
                entry.verdictEl.dataset.verdict = v.verdict;
                entry.card.dataset.verdict = v.verdict;
                entry.card.classList.toggle('card-compact', v.verdict === 'correct' || v.verdict === 'unverified');
            }
        }
        // "[14m]" in an answer becomes a chip that shows that moment in the transcript.
        entry.gist.innerHTML = gist.trim() ? citeMinutes(renderMarkdown(gist)) : '<span class="text-gray-400">…</span>';
        entry.moreText.innerHTML = citeMinutes(renderMarkdown(more));
        entry.toggle.hidden = !more.trim() && !entry.hasSources;
    }

    function findActionCard(title) {
        const want = String(title).trim().toLowerCase();
        return [...insightsContainer.querySelectorAll('[data-card][data-type="action"]')]
            .find((c) => (c.dataset.title || '').trim().toLowerCase() === want) || null;
    }

    function updateActionCard(card, meta) {
        const gist = card.querySelector('.card-gist');
        if (gist) gist.innerHTML = actionBody(meta);
        card.classList.remove('card-updated');
        void card.offsetWidth;   // restart the highlight if it is updated twice in a row
        card.classList.add('card-updated');
    }

    // Thumbs up keeps the card and makes its type a little easier to raise; thumbs down
    // hides it and makes the type harder to raise for the rest of the session. The title
    // stays remembered either way, so a hidden card doesn't come straight back.
    function onFeedback(card, vote) {
        const type = card && card.dataset.type;
        if (!CARD_TYPE_UI[type]) return;
        const current = typeBias[type] || 0;
        if (vote === 'down') {
            typeBias[type] = Math.min(BIAS_MAX, current + BIAS_DOWN);
            stats.notUseful++;
            // The bias only knows the type was unwelcome; the title says which kind.
            if (card.dataset.title) {
                dismissedTitles.push({ type, title: card.dataset.title.slice(0, 120) });
                if (dismissedTitles.length > DISMISSED_MEMORY * 2) dismissedTitles.splice(0, dismissedTitles.length - DISMISSED_MEMORY);
            }
            forgetCardProducts(card);
            removeCard(card);
        } else {
            const button = card.querySelector('[data-feedback="up"]');
            if (button.getAttribute('aria-pressed') === 'true') return;
            typeBias[type] = Math.max(BIAS_MIN, current - BIAS_UP);
            button.setAttribute('aria-pressed', 'true');
            stats.useful++;
        }
        persistTranscript();
    }

    // Back to the spinner, for a retry. The type accent goes with it: a card still
    // wearing its old colour while it re-analyses looks like it is showing an answer.
    function resetCardToPending(card, message) {
        delete card.dataset.type;
        card.classList.add('opacity-75');
        card.innerHTML = `<div class="flex items-center space-x-3">${spinnerSvg}<span class="text-sm text-gray-500">${escapeHtmlText(message)}</span></div>`;
    }

    // The stream died mid-answer, but what did arrive is real. Keeping it under an honest
    // marker beats both of the alternatives: throwing away a good partial answer, or
    // leaving a sentence that stops dead and looks finished.
    function renderIncomplete(job, slot) {
        const body = slot.card && slot.card.querySelector('.card-body');
        if (!body) return;
        const bar = el('div', 'card-incomplete');
        bar.append(el('span', '', 'Cut off before the end.'));
        const btn = el('button', 'card-retry', 'Finish it');
        btn.type = 'button';
        btn.addEventListener('click', () => {
            resetCardToPending(slot.card, 'Retrying…');
            queueJob(answerJob(job, slot, 0), true);
        });
        bar.append(btn);
        body.append(bar);
    }

    // One card of an utterance failed after it was classified. Retry answers just that card.
    function renderSlotError(job, slot, message) {
        if (!slot.card) slot.card = placeCard(job.order);
        const card = slot.card;
        delete card.dataset.type;
        card.classList.remove('opacity-75');
        const subject = slot.meta && (slot.meta.title || slot.meta.question || slot.meta.term || slot.meta.claim);
        card.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm text-amber-600">${escapeHtmlText(message)}</p>
                    <p class="mt-1 text-xs text-gray-500 truncate">${escapeHtmlText(subject || `"${job.utterance}"`)}</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <button data-act="retry" class="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-600 hover:border-google-green hover:text-google-green">Retry</button>
                    <button data-act="dismiss" class="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
                </div>
            </div>`;
        card.querySelector('[data-act="retry"]').addEventListener('click', () => {
            resetCardToPending(card, 'Retrying…');
            queueJob(answerJob(job, slot, 0), true);
        });
        card.querySelector('[data-act="dismiss"]').addEventListener('click', () => { removeCard(card); slot.card = null; });
    }

    // A failed analysis used to vanish, which is indistinguishable from the AI deciding
    // the utterance didn't matter. Now it says so, and offers the retry.
    function renderCardError(job, message) {
        if (!job.card) job.card = placeCard(job.order);
        delete job.card.dataset.type;
        job.card.classList.remove('opacity-75');
        job.card.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm text-amber-600">${escapeHtmlText(message)}</p>
                    <p class="mt-1 text-xs text-gray-500 truncate">"${escapeHtmlText(job.utterance)}"</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                    <button data-act="retry" class="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-600 hover:border-google-green hover:text-google-green">Retry</button>
                    <button data-act="dismiss" class="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
                </div>
            </div>`;
        job.card.querySelector('[data-act="retry"]').addEventListener('click', () => {
            job.attempt = 0;
            job.slots = [];
            resetCardToPending(job.card, 'Retrying…');
            queueJob(job, true);
        });
        job.card.querySelector('[data-act="dismiss"]').addEventListener('click', () => { removeCard(job.card); job.card = null; });
    }

    function renderSources(el2, sources) {
        if (!sources.length) return;
        el2.innerHTML = '';
        const label = document.createElement('span');
        label.className = 'w-full text-xs uppercase tracking-wide text-gray-400';
        label.textContent = 'Sources';
        el2.appendChild(label);
        sources.forEach((s, i) => {
            const a = document.createElement('a');
            a.href = s.uri;
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 truncate max-w-[14rem]';
            a.textContent = `${i + 1}. ${s.title || s.uri}`;
            el2.appendChild(a);
        });
    }

    function removeCard(card) {
        card.classList.add('fade-out');
        setTimeout(() => {
            card.remove();
            if (!insightsContainer.querySelector('[data-card]')) placeholderCard.classList.remove('hidden');
        }, 500);
    }

    // ---------- transcription: browser (free) ----------
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Chrome ends a continuous session on its own — on silence, on a network blip, on a
    // timer. The old restart called start() straight from onend, which throws
    // InvalidStateError while the engine is still releasing; the throw escaped, the
    // restart never happened, and the UI kept showing a healthy green light over a dead
    // recognizer. That is the "it stopped in the middle" failure.
    class WebSpeechProvider {
        static get supported() { return Boolean(SpeechRecognition); }
        static label = 'Browser transcription';

        constructor() {
            this.wantRunning = false;
            this.running = false;
            this.starting = false;
            this.lastResultAt = 0;
            this.watchdog = null;
            this.build();
        }

        build() {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = languageOf(session.language).speech;

            recognition.onstart = () => {
                this.running = true;
                this.starting = false;
                this.lastResultAt = Date.now();
                if (this.wantRunning) setStatus('Listening…', 'live');
            };

            recognition.onresult = (event) => {
                this.lastResultAt = Date.now();
                let interim = '', newFinal = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i].isFinal) newFinal += event.results[i][0].transcript + ' ';
                    else interim += event.results[i][0].transcript;
                }
                if (newFinal) onFinalText(newFinal);
                onInterimText(interim);
            };

            recognition.onend = () => {
                this.running = false;
                this.starting = false;
                if (!this.wantRunning) return;
                setTimeout(() => this.safeStart(), SPEECH_RESTART_MS);
            };

            recognition.onerror = (event) => {
                const kind = event.error;
                // Routine during a quiet meeting — don't tear the session down.
                if (kind === 'no-speech' || kind === 'aborted') return;
                if (kind === 'not-allowed' || kind === 'service-not-allowed') {
                    this.wantRunning = false;
                    errorEl.textContent = 'Microphone access was denied for speech recognition.';
                    setStatus('Blocked', 'warn');
                    return;
                }
                // 'network' and friends: onend follows, the watchdog gets us back up.
                errorEl.textContent = `Speech recognition hiccup (${kind}) — reconnecting…`;
                setStatus('Reconnecting…', 'warn');
            };

            this.recognition = recognition;
        }

        safeStart() {
            if (!this.wantRunning || this.running || this.starting) return;
            clearTimeout(this.retryTimer);
            this.starting = true;
            try {
                this.recognition.start();
            } catch (err) {
                // The engine hasn't released yet — Chrome throws InvalidStateError here.
                // Retry promptly rather than waiting on the watchdog, so a bounce costs a
                // few hundred milliseconds of audio instead of a couple of seconds. What
                // must never happen is this escaping: a throw out of the old onend handler
                // is precisely what left a dead recognizer under a green "Listening" light.
                this.starting = false;
                this.retryTimer = setTimeout(() => this.safeStart(), SPEECH_RESTART_MS);
            }
        }

        async start() {
            this.wantRunning = true;
            this.safeStart();
            this.watchdog = setInterval(() => {
                if (!this.wantRunning) return;
                if (!this.running && !this.starting) { this.safeStart(); return; }
                // Claims to be running but has delivered nothing for a very long time:
                // bounce it. onend then brings it back.
                if (this.running && Date.now() - this.lastResultAt > SPEECH_STALL_MS) {
                    this.lastResultAt = Date.now();
                    try { this.recognition.abort(); } catch (err) { /* onend handles it */ }
                }
            }, SPEECH_WATCHDOG_MS);
        }

        pause() {
            this.wantRunning = false;
            clearTimeout(this.retryTimer);
            try { this.recognition.stop(); } catch (err) { /* already stopped */ }
        }

        resume() {
            this.wantRunning = true;
            this.lastResultAt = Date.now();
            this.safeStart();
        }

        stop() {
            this.wantRunning = false;
            clearInterval(this.watchdog);
            clearTimeout(this.retryTimer);
            try { this.recognition.abort(); } catch (err) { /* already stopped */ }
        }

        updateKeywords() { /* Web Speech has no biasing hook — that's why the paid path exists */ }
    }

    // ---------- transcription: high accuracy (keyword biasing) ----------
    // The AudioWorklet spec only accepts a URL, but a Blob URL counts — which keeps this
    // page a single file. The AudioContext runs at 24 kHz so the browser resamples and
    // this only changes format.
    const WORKLET_SOURCE = `
const CHUNK_SAMPLES = 2048;
// ~1s of audio at 24kHz. The peak over that window is what tells the page apart a
// microphone that is genuinely live from one that is open but hearing nothing —
// muted in hardware, muted in the meeting app, or pointed at a dead input.
const LEVEL_EVERY = 12;
class PCMEncoder extends AudioWorkletProcessor {
constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SAMPLES);
    this.offset = 0;
    this.peak = 0;
    this.since = 0;
}
process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
        this.buffer[this.offset++] = channel[i];
        if (this.offset === CHUNK_SAMPLES) this.flush();
    }
    return true;
}
flush() {
    if (this.offset === 0) return;
    const pcm = new Int16Array(this.offset);
    for (let i = 0; i < this.offset; i++) {
        const s = Math.max(-1, Math.min(1, this.buffer[i]));
        if (s > this.peak) this.peak = s; else if (-s > this.peak) this.peak = -s;
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    this.offset = 0;
    // Sent as a separate, non-transferred message so the audio path stays zero-copy.
    if (++this.since >= LEVEL_EVERY) {
        this.port.postMessage({ level: this.peak });
        this.peak = 0;
        this.since = 0;
    }
}
}
registerProcessor('pcm-encoder', PCMEncoder);
`;

    // Audio egress lives in a worker. Previously the main thread base64-encoded every
    // chunk and wrote it to the socket, so a burst of markdown rendering in the insights
    // pane delayed the mic stream. Now the main thread only re-transfers an ArrayBuffer
    // (zero copy) and the worker owns the socket, the buffering and the reconnect.
    // Frames go out as raw PCM16: no base64 in the browser, a third fewer bytes on the wire.
    const AUDIO_WORKER_SOURCE = `
let ws = null, url = '', hello = null;
let paused = false, closing = false, attempt = 0, timer = null;
const MAX_BUFFER = 200;
const buffered = [];

function sendJson(obj) { if (obj && ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
if (closing || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
ws.onopen = function () {
    attempt = 0;
    sendJson(hello);
    if (paused) sendJson({ type: 'pause' });
    self.postMessage({ type: 'link', state: 'open' });
    while (buffered.length && ws.readyState === 1) ws.send(buffered.shift());
};
ws.onmessage = function (e) {
    try { self.postMessage({ type: 'server', payload: JSON.parse(e.data) }); } catch (err) { /* ignore */ }
};
ws.onclose = function () { ws = null; if (!closing) schedule(); };
ws.onerror = function () { /* close follows */ };
}

function schedule() {
if (timer || closing) return;
attempt += 1;
if (attempt > 12) { self.postMessage({ type: 'link', state: 'failed' }); return; }
self.postMessage({ type: 'link', state: 'reconnecting', attempt: attempt });
const delay = Math.min(600 * Math.pow(2, attempt - 1), 8000);
timer = setTimeout(function () { timer = null; connect(); }, delay);
}

self.onmessage = function (e) {
const m = e.data;
if (m.type === 'init') { url = m.url; hello = m.hello; connect(); return; }
if (m.type === 'audio') {
    if (paused) return;
    if (ws && ws.readyState === 1) { ws.send(m.buffer); return; }
    buffered.push(m.buffer);
    while (buffered.length > MAX_BUFFER) buffered.shift();
    connect();
    return;
}
if (m.type === 'keywords') {
    if (hello) hello.keywords = m.keywords;
    sendJson({ type: 'keywords', keywords: m.keywords });
    return;
}
if (m.type === 'pause') { paused = true; buffered.length = 0; sendJson({ type: 'pause' }); return; }
if (m.type === 'resume') { paused = false; sendJson({ type: 'resume' }); if (!ws) connect(); return; }
if (m.type === 'close') {
    closing = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (ws) { try { ws.close(); } catch (err) { /* ignore */ } ws = null; }
    self.postMessage({ type: 'closed' });
}
};
`;

    class RealtimeProvider {
        static label = 'High accuracy';

        // `stream` is what gets transcribed — the microphone, or the microphone mixed with a
        // meeting tab. `watched` is the microphone itself: a mix never "ends" or "mutes", so
        // the capture watchdog has to look at the real input to notice one that has.
        constructor(stream, watched) {
            this.stream = stream;
            this.watched = watched || stream;
            this.partials = new Map();
            this.level = 0;
            this.lastSoundAt = Date.now();
            this.levels = [];
            this.noiseFloor = 0;
        }

        hello() {
            const meetingLabel = kindOf(session.type).name.replace(/\s*\(.*\)$/, '');
            return {
                type: 'start',
                prompt: `Meeting type: ${meetingLabel}.${session.objective ? ' Objective: ' + session.objective : ''}`,
                keywords: session.keywords,
                languages: [languageOf(session.language).code],
                ...(readAuth() ? { token: readAuth().session } : {}),
            };
        }

        async start() {
            this.workerUrl = URL.createObjectURL(new Blob([AUDIO_WORKER_SOURCE], { type: 'application/javascript' }));
            this.worker = new Worker(this.workerUrl);
            this.worker.onmessage = (e) => this.onWorker(e.data);
            this.worker.postMessage({ type: 'init', url: wsUrl, hello: this.hello() });
            await this.startCapture();
        }

        onWorker(msg) {
            if (msg.type === 'server') { this.handle(msg.payload); return; }
            if (msg.type === 'link') {
                if (msg.state === 'open') { errorEl.textContent = ''; }
                else if (msg.state === 'reconnecting') { setStatus('Reconnecting…', 'warn'); }
                else if (msg.state === 'failed') {
                    errorEl.textContent = 'Lost the transcription connection. Stop and start the session to reconnect.';
                    setStatus('Disconnected', 'warn');
                }
            }
        }

        handle(msg) {
            switch (msg.type) {
                case 'ready':
                    this.partials.clear();
                    if (!isPaused) setStatus('Listening…', 'live');
                    errorEl.textContent = '';
                    break;
                case 'reconnecting':
                    setStatus('Reconnecting…', 'warn');
                    break;
                case 'paused':
                    break;
                case 'partial_transcript':
                    this.partials.set(msg.itemId, msg.text);
                    onInterimText([...this.partials.values()].join(' '));
                    break;
                case 'final_transcript':
                    this.partials.delete(msg.itemId);
                    onInterimText([...this.partials.values()].join(' '));
                    onFinalText(msg.text, { low: Boolean(msg.lowConfidence) });
                    break;
                case 'discard_transcript':
                    // A live line that turned out not to be speech.
                    this.partials.delete(msg.itemId);
                    onInterimText([...this.partials.values()].join(' '));
                    break;
                case 'error':
                    errorEl.textContent = msg.message || 'Transcription error.';
                    break;
            }
        }

        updateKeywords(keywords) {
            if (this.worker) this.worker.postMessage({ type: 'keywords', keywords });
        }

        async startCapture() {
            this.audioContext = new AudioContext({ sampleRate: 24000 });
            const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
            try { await this.audioContext.audioWorklet.addModule(url); }
            finally { URL.revokeObjectURL(url); }

            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.encoder = new AudioWorkletNode(this.audioContext, 'pcm-encoder');
            this.encoder.port.onmessage = (e) => {
                // Two message shapes now. A transferred PCM buffer goes straight on to
                // the worker — no encoding, no allocation on this thread. The periodic
                // peak level stays here, as the evidence that audio is really flowing.
                if (e.data instanceof ArrayBuffer) {
                    if (voiceTap.on) voiceTap.push(e.data, this.audioContext.sampleRate);
                    this.worker.postMessage({ type: 'audio', buffer: e.data }, [e.data]);
                } else if (e.data && typeof e.data.level === 'number') {
                    this.noteLevel(e.data.level);
                }
            };

            // A worklet only runs while connected to the destination, but routing the mic
            // to the speakers would howl. Zero gain keeps the graph pulling in silence.
            const mute = this.audioContext.createGain();
            mute.gain.value = 0;
            source.connect(this.encoder);
            this.encoder.connect(mute);
            mute.connect(this.audioContext.destination);
        }

        // One peak per second from the worklet. The rolling low percentile of those is
        // this room's noise floor; anything well above it is a person talking.
        noteLevel(level) {
            this.level = level;
            this.levels.push(level);
            if (this.levels.length > LEVEL_WINDOW) this.levels.shift();

            if (this.levels.length >= LEVEL_MIN_SAMPLES) {
                const sorted = [...this.levels].sort((a, b) => a - b);
                this.noiseFloor = sorted[Math.floor(sorted.length * NOISE_FLOOR_PCT)];
            }
            if (level > this.speechThreshold()) this.lastSoundAt = Date.now();
        }

        speechThreshold() {
            return Math.max(this.noiseFloor * SPEECH_OVER_FLOOR, ABSOLUTE_SILENCE);
        }

        // iOS suspends an AudioContext on a phone call, a route change, or the screen
        // locking, and does not resume it on the way back. A suspended context pulls no
        // audio, so capture stops while everything on screen still says "Listening".
        async wake() {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                    this.lastSoundAt = Date.now();   // don't fault it for the gap it just had
                } catch (err) { /* the next check will catch it */ }
            }
        }

        health() {
            const track = this.watched && this.watched.getAudioTracks()[0];
            return {
                context: this.audioContext ? this.audioContext.state : 'none',
                track: track ? track.readyState : 'none',
                muted: Boolean(track && track.muted),
                lastSoundAt: this.lastSoundAt,
                noiseFloor: this.noiseFloor,
                threshold: this.speechThreshold(),
                level: this.level,
            };
        }

        pause() {
            this.partials.clear();
            // Closing the upstream is the point: a break costs nothing while paused.
            if (this.worker) this.worker.postMessage({ type: 'pause' });
        }

        resume() {
            if (this.worker) this.worker.postMessage({ type: 'resume' });
        }

        stop() {
            if (this.worker) {
                this.worker.postMessage({ type: 'close' });
                setTimeout(() => { this.worker.terminate(); this.worker = null; }, 250);
            }
            if (this.workerUrl) { URL.revokeObjectURL(this.workerUrl); this.workerUrl = null; }
            if (this.encoder) { this.encoder.port.onmessage = null; this.encoder.disconnect(); }
            if (this.audioContext) this.audioContext.close().catch(() => {});
        }
    }

    // ---------- recording ----------
    function pickAudioFormat() {
        const candidates = [
            { mimeType: 'audio/webm;codecs=opus', ext: 'webm', accept: 'audio/webm' },
            { mimeType: 'audio/webm', ext: 'webm', accept: 'audio/webm' },
            { mimeType: 'audio/mp4', ext: 'm4a', accept: 'audio/mp4' },
            { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg', accept: 'audio/ogg' },
        ];
        return candidates.find(c => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c.mimeType))
            || { mimeType: '', ext: 'webm', accept: 'audio/webm' };
    }

    const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

    class DiskRecorder {
        constructor() { this.chunks = []; this.writeChain = Promise.resolve(); this.result = null; }

        async start(stream) {
            this.format = pickAudioFormat();
            this.filename = `reverb-${fileStamp()}.${this.format.ext}`;
            this.streaming = typeof window.showSaveFilePicker === 'function';

            if (this.streaming) {
                this.handle = await window.showSaveFilePicker({
                    suggestedName: this.filename,
                    types: [{ description: 'Audio', accept: { [this.format.accept]: ['.' + this.format.ext] } }],
                });
                this.filename = this.handle.name || this.filename;
                this.writable = await this.handle.createWritable();
            }

            this.recorder = new MediaRecorder(stream, this.format.mimeType ? { mimeType: this.format.mimeType } : undefined);
            this.recorder.ondataavailable = (e) => {
                if (!e.data || !e.data.size) return;
                if (this.streaming) {
                    // Serialise writes; concurrent write() calls on one stream interleave.
                    this.writeChain = this.writeChain.then(() => this.writable.write(e.data));
                } else {
                    this.chunks.push(e.data);
                }
            };
            this.recorder.start(3000);   // flush to disk every 3s
            return { streaming: this.streaming, name: this.filename };
        }

        // Pausing the recorder rather than stopping it keeps one continuous file with the
        // break removed, so a mid-meeting pause doesn't leave you with two half-recordings.
        pause() { if (this.recorder && this.recorder.state === 'recording') this.recorder.pause(); }
        resume() { if (this.recorder && this.recorder.state === 'paused') this.recorder.resume(); }

        async stop() {
            if (!this.recorder) return null;
            if (this.recorder.state !== 'inactive') {
                await new Promise(resolve => {
                    this.recorder.addEventListener('stop', resolve, { once: true });
                    if (this.recorder.state === 'paused') this.recorder.resume();
                    this.recorder.stop();
                });
            }

            if (this.streaming) {
                await this.writeChain;
                await this.writable.close();
                // The browser will not disclose where the user put it, but it will hand
                // the file back — which is enough to offer a link to it.
                const file = await this.handle.getFile();
                this.result = { name: this.handle.name, url: URL.createObjectURL(file), size: file.size, streamed: true };
            } else {
                const blob = new Blob(this.chunks, { type: this.format.accept });
                this.result = { name: this.filename, url: URL.createObjectURL(blob), size: blob.size, streamed: false };
                downloadBlob(blob, this.filename);
            }
            return this.result;
        }
    }

    // ---------- persistence ----------
    function persistSession() {
        if (clearedElsewhere) return;
        try { localStorage.setItem('reverb.session', JSON.stringify(session)); } catch (err) { /* private mode */ }
    }
    function restoreSessionBrief() {
        try { Object.assign(session, JSON.parse(localStorage.getItem('reverb.session') || '{}')); } catch (err) { /* ignore */ }
        normalizeBrief();
    }

    // Briefs saved before the agenda and background material existed have neither.
    function normalizeBrief() {
        if (!Array.isArray(session.agenda)) session.agenda = [];
        if (typeof session.materials !== 'string') session.materials = '';
        if (!Number.isFinite(session.durationMin) || session.durationMin <= 0) session.durationMin = null;
    }

    let persistTimer = null;
    function persistTranscript(immediate) {
        if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
        if (!immediate) { persistTimer = setTimeout(() => persistTranscript(true), PERSIST_DEBOUNCE_MS); return; }
        if (!segments.length || clearedElsewhere) return;
        try {
            let kept = segments;
            let total = 0;
            for (let i = segments.length - 1; i >= 0; i--) {
                total += segments[i].text.length;
                if (total > MAX_PERSIST_CHARS) { kept = segments.slice(i + 1); break; }
            }
            localStorage.setItem(STORE_KEY, JSON.stringify({
                savedAt: Date.now(),
                startedAt,
                activeMs: meetingClock(),
                brief: {
                    objective: session.objective, type: session.type, keywords: session.keywords, roster: session.roster,
                    agenda: session.agenda, durationMin: session.durationMin, materials: session.materials,
                },
                segments: kept.map(s => ({ text: s.text, edited: s.edited, low: s.low, speaker: s.speaker, confident: s.confident, byUser: s.byUser || undefined, voice: s.voice || undefined, t: s.t })),
                meetingState,
                participants,
                notes: sessionNotes,
                aliases: { ...speakerAliases },
                todos: todos.map(({ id, ...t }) => t),
                glossary,
                recordings,
                // An answer still streaming is saved as stopped: a reload ends it.
                chat: chatTurns.slice(-CHAT_SAVED_TURNS).map((t) => ({
                    question: t.question,
                    answer: t.answer.slice(0, 12000),
                    status: t.status === 'streaming' ? 'stopped' : t.status,
                    error: t.error || '',
                })),
                answered: answeredTitles.slice(-ANSWERED_MEMORY),
                dismissed: dismissedTitles.slice(-DISMISSED_MEMORY),
                bias: { ...typeBias },
                // The cards themselves aren't kept, like every other card; what was asked, skipped and
                // passed over is, so none of it is suggested again after a reload.
                askNext: { asked: askNext.asked, skipped: askNext.skipped, earlier: askNext.earlier },
                docs: savedDocs(),
            }));
        } catch (err) { /* quota or private mode — the session still runs */ }
    }

    function readSaved(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data && Array.isArray(data.segments) && data.segments.length ? data : null;
        } catch (err) { return null; }
    }

    function clearSaved() {
        try {
            localStorage.removeItem(STORE_KEY);
            if (offeredSave) localStorage.removeItem(offeredSave.key);
        } catch (err) { /* ignore */ }
        offeredSave = null;
    }

    // ---------- one saved meeting per tab ----------
    // The tab's id lives in sessionStorage, which survives a reload of the same tab — the
    // case restore exists for. Duplicating a tab copies sessionStorage too, so each tab also
    // holds a Web Lock named after its id for as long as it is open: a tab that finds its id
    // already locked is a duplicate, and takes a fresh one.
    function newTabId() {
        return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 18);
    }

    function holdTabLock(id) {
        return new Promise((resolve) => {
            navigator.locks.request(`reverb.tab.${id}`, { ifAvailable: true }, (lock) => {
                resolve(Boolean(lock));
                if (lock) return new Promise(() => {});   // released only when the tab closes
            }).catch(() => resolve(true));
        });
    }

    async function claimTab() {
        let id = null;
        try { id = sessionStorage.getItem('reverb.tab'); } catch (err) { /* ignore */ }
        if (!id) id = STORE_KEY.slice(STORE_PREFIX.length);
        if ('locks' in navigator && !(await holdTabLock(id))) {
            id = newTabId();
            await holdTabLock(id);
        }
        try { sessionStorage.setItem('reverb.tab', id); } catch (err) { /* ignore */ }
        STORE_KEY = STORE_PREFIX + id;
    }

    // What the restore bar offers: this tab's own meeting after a reload, otherwise the most
    // recent one that no open tab is still running — a tab that was closed or crashed.
    // Saves that have sat untouched for SAVED_MAX_AGE_MS are cleared out on the way.
    async function findSaved() {
        const live = new Set();
        if ('locks' in navigator) {
            try { for (const l of (await navigator.locks.query()).held || []) live.add(l.name); } catch (err) { /* ignore */ }
        }
        const keys = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key === LEGACY_STORE_KEY || (key && key.startsWith(STORE_PREFIX))) keys.push(key);
            }
        } catch (err) { return null; }

        let best = null;
        for (const key of keys) {
            const data = readSaved(key);
            if (key === STORE_KEY) {
                if (data) return { key, data };
                continue;
            }
            if (live.has(`reverb.tab.${key.slice(STORE_PREFIX.length)}`)) continue;
            if (!data || Date.now() - (data.savedAt || 0) > SAVED_MAX_AGE_MS) {
                try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
                continue;
            }
            if (!best || (data.savedAt || 0) > (best.data.savedAt || 0)) best = { key, data };
        }
        return best;
    }

    function restoreSaved(data) {
        Object.assign(session, data.brief || {});
        normalizeBrief();
        startedAt = data.startedAt || null;
        activeMs = Number.isFinite(data.activeMs) ? data.activeMs : 0;
        activeSince = 0;
        segments.length = 0;
        segmentSeq = 0;
        segmentsEl.replaceChildren();
        for (const s of data.segments) {
            const segment = {
                id: `seg-${segmentSeq++}`, text: s.text,
                edited: Boolean(s.edited), low: Boolean(s.low),
                speaker: s.speaker || null, confident: s.confident !== false, byUser: Boolean(s.byUser),
                voice: ['you', 'other', 'unsure'].includes(s.voice) ? s.voice : undefined,
                t: Number.isFinite(s.t) ? s.t : undefined,
            };
            segments.push(segment);
            segmentsEl.append(renderSegment(segment), document.createTextNode(' '));
        }
        participants = Array.isArray(data.participants) ? data.participants : [];
        sessionNotes = typeof data.notes === 'string' ? data.notes.slice(0, NOTES_MAX) : '';
        notesInput.value = sessionNotes;
        reflectNotes();
        for (const key of Object.keys(speakerAliases)) delete speakerAliases[key];
        if (data.aliases && typeof data.aliases === 'object') {
            for (const [from, to] of Object.entries(data.aliases)) if (typeof to === 'string' && to) speakerAliases[from] = to;
        }
        for (const t of chatTurns) if (t.el) t.el.remove();
        chatTurns.length = 0;
        for (const t of Array.isArray(data.chat) ? data.chat : []) {
            if (!t || typeof t.question !== 'string') continue;
            chatTurns.push({
                question: t.question, answer: typeof t.answer === 'string' ? t.answer : '',
                status: ['done', 'failed', 'stopped'].includes(t.status) ? t.status : 'stopped',
                error: typeof t.error === 'string' ? t.error : '', el: null,
            });
        }
        renderChat();
        reflectChatReady();
        todos.length = 0;
        todoEditing = null;
        for (const t of Array.isArray(data.todos) ? data.todos : []) {
            if (t && typeof t.task === 'string' && t.task.trim()) {
                // Line ids are renumbered on restore; the meeting time finds the line again.
                const line = Number.isFinite(t.t) ? segments.find((x) => x.t === t.t) : null;
                todos.push({ title: t.title || t.task, owner: '', due: '', t: null, ...t, seg: line ? line.id : null, done: Boolean(t.done), id: `todo-${todoSeq++}` });
            }
        }
        glossary.length = 0;
        for (const g of Array.isArray(data.glossary) ? data.glossary : []) {
            if (g && typeof g.term === 'string' && typeof g.definition === 'string') glossary.push(g);
        }
        renderTodos();
        renderGlossary();
        recordings.length = 0;
        for (const r of Array.isArray(data.recordings) ? data.recordings : []) {
            if (r && Number.isFinite(r.offsetMs)) recordings.push({ name: String(r.name || ''), offsetMs: r.offsetMs, durationMs: Number(r.durationMs) || 0 });
        }
        refreshSpeakerTags();
        answeredTitles.length = 0;
        // Saved before cards were typed, entries were bare titles; both still suppress repeats.
        if (Array.isArray(data.answered)) {
            answeredTitles.push(...data.answered.filter((a) => typeof a === 'string' || (a && typeof a.title === 'string')));
        }
        dismissedTitles.length = 0;
        if (Array.isArray(data.dismissed)) {
            dismissedTitles.push(...data.dismissed.filter((a) => a && typeof a.title === 'string'));
        }
        for (const key of Object.keys(docs)) docs[key] = data.docs && typeof data.docs[key] === 'string' ? data.docs[key].slice(0, 12000) : '';
        const savedAsk = data.askNext && typeof data.askNext === 'object' ? data.askNext : {};
        const texts = (v, n) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()).slice(-n) : []);
        askNext.asked = texts(savedAsk.asked, 60);
        askNext.skipped = texts(savedAsk.skipped, 40);
        askNext.earlier = texts(savedAsk.earlier, 40);
        askNext.open = [];
        reflectQuestionsButton();
        for (const key of Object.keys(typeBias)) delete typeBias[key];
        if (data.bias && typeof data.bias === 'object') {
            for (const [type, value] of Object.entries(data.bias)) {
                if (CARD_TYPE_UI[type] && Number.isFinite(value)) typeBias[type] = Math.min(BIAS_MAX, Math.max(BIAS_MIN, value));
            }
        }
        meetingState = data.meetingState || null;
        setStateObjective();
        stateBar.classList.remove('hidden');
        if (meetingState) { renderMeetingState(); stampState(data.savedAt || Date.now()); }
        charsSinceState = 0;
        charsSinceSweep = 0;
        lastSweepAt = 0;
        // The saved state may trail the saved transcript by a few segments. Rather than
        // guess the overlap, make the first pass after a restore a full rebuild.
        lastStateSegment = 0;
        statePasses = 0;
        lastFullAt = 0;
        lastPassFull = false;
        markResumeSeam = true;
        scrollTranscript();
        reflectSessionButtons();
    }

    // ---------- staying alive ----------
    async function acquireWakeLock() {
        if (!('wakeLock' in navigator) || wakeLock) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            // The browser drops the lock every time the page is hidden, so this only
            // clears the handle — checkCapture requests a fresh one on the way back.
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (err) {
            // Refused: no user activation, battery saver, or an unsupported browser.
            wakeLock = null;
        }
    }

    function releaseWakeLock() {
        const held = wakeLock;
        wakeLock = null;
        if (held) held.release().catch(() => {});
    }

    // Everything that can silently end a capture, checked on a loop and repaired where
    // repair is possible. The rule is that the status light must never say "Listening"
    // while no audio is arriving — a transcript with a hole in it is the failure that
    // gets noticed hours later, if at all.
    async function checkCapture() {
        if (!isListening || isPaused || !provider) return;

        if (provider.wake) await provider.wake();
        // The mixer is a second AudioContext, and is suspended by the same things.
        if (mixer && mixer.context.state === 'suspended') await mixer.context.resume().catch(() => {});
        if (document.visibilityState === 'visible') await acquireWakeLock();

        if (!provider.health) return;
        const h = provider.health();

        if (typeof h.noiseFloor === 'number') {
            stats.noiseFloor = h.noiseFloor;
            stats.threshold = h.threshold;
        }
        const quiet = Date.now() - h.lastSoundAt;
        if (quiet > stats.longestSilenceMs) stats.longestSilenceMs = quiet;
        stats.wakeLock = wakeLock ? 'held' : ('wakeLock' in navigator ? 'refused' : 'unsupported');

        const warn = (status, message, kind) => {
            if (!captureWarned) bumpStat('interruptions', kind);
            captureWarned = true;
            setStatus(status, 'warn');
            setNotice(message);
        };

        if (h.track === 'ended') {
            warn('Microphone lost', 'The microphone was disconnected. Stop and start the session to reconnect it.', 'disconnected');
        } else if (h.muted) {
            warn('Interrupted', 'The microphone is muted — another app may have taken it.', 'muted');
        } else if (h.context === 'suspended') {
            warn('Interrupted', 'Audio is suspended. Tap the page to resume capture.', 'suspended');
        } else if (quiet > SILENCE_WARN_MS) {
            warn('Hearing nothing', 'The microphone is live but completely silent — check it is not muted in hardware or in your meeting app.', 'silent');
        } else if (captureWarned) {
            // Only take the status back if this watchdog was the one that changed it;
            // the relay sets its own "Reconnecting…" that must not be stomped on.
            captureWarned = false;
            clearNotice();
            setStatus('Listening…', 'live');
        }
    }

    // ---------- session lifecycle ----------
    // The kind-of-meeting menu, grouped, and what the chosen kind is for right under it.
    function fillKindMenu() {
        const select = $('setup-type');
        select.replaceChildren();
        for (const g of MEETING_KINDS) {
            const group = document.createElement('optgroup');
            group.label = g.group;
            for (const k of g.kinds) {
                const option = document.createElement('option');
                option.value = k.key;
                option.textContent = k.name;
                group.append(option);
            }
            select.append(group);
        }
        select.addEventListener('change', reflectKind);
        const language = $('setup-language');
        for (const l of LANGUAGES) {
            const option = document.createElement('option');
            option.value = l.code;
            option.textContent = l.name;
            language.append(option);
        }
    }
    function reflectKind() {
        const kind = kindOf($('setup-type').value);
        $('setup-goal').replaceChildren(el('b', '', 'Goal'), ` · ${kind.goal}`);
        $('setup-objective').placeholder = session.followUp ? `Follow-up: ${session.followUp.title}` : kind.example;
        $('setup-role').placeholder = kind.role;
    }

    function openSetup() {
        $('setup-objective').value = session.objective;
        $('setup-type').value = KINDS[session.type] ? session.type : 'general';
        reflectKind();
        $('setup-role').value = session.role || '';
        $('setup-language').value = languageOf(session.language).code;
        $('setup-roster').value = (session.roster || []).join(', ');
        $('setup-keywords').value = session.keywords.join(', ');
        $('setup-agenda').value = (session.agenda || []).join('\n');
        $('setup-duration').value = session.durationMin || '';
        $('setup-materials').value = session.materials || '';
        reflectMaterialsCount();
        // Open when there is something in it, so a filled-in brief doesn't look empty.
        $('setup-more').open = Boolean((session.agenda || []).length || session.durationMin || session.materials || session.role || (session.language && session.language !== 'en'));
        $('setup-accurate').checked = session.accurate;
        $('setup-record').checked = session.record;
        $('setup-voice').checked = Boolean(session.voiceId);
        reflectVoicePanel();
        // Only a desktop browser can share a tab's audio.
        $('tab-option').hidden = !canShareTab;
        $('setup-tab').checked = canShareTab && Boolean(session.tabAudio);
        pickedRecording = null;
        reflectRecordingPick();
        $('setup-title').textContent = segments.length ? 'Session Brief' : session.followUp ? 'Follow-Up Session' : 'New Session';
        $('followup-note').textContent = session.followUp ? `Following up on “${session.followUp.title}”` : '';
        $('invite-box').hidden = true;

        if (!WebSpeechProvider.supported) {
            $('setup-accurate').checked = true;
            $('setup-accurate').disabled = true;
            $('accurate-note').textContent =
                'Required — this browser has no built-in speech recognition, so high accuracy is the only option here.';
        }
        if (typeof window.showSaveFilePicker !== 'function') {
            $('record-note').textContent =
                'This browser cannot stream to disk, so audio is held in memory and downloaded when you stop. A crash would lose it.';
        }

        setupModal.classList.remove('hidden');
        $('setup-objective').focus();
    }

    const closeSetup = () => setupModal.classList.add('hidden');

    // ---------- a meeting tab's audio ----------
    // On a video call with headphones the microphone hears only you. Chrome and Edge can
    // share a tab's audio — the call in Meet, Zoom or Teams on the web — and that is mixed
    // with the microphone so both sides of the conversation are transcribed.
    const canShareTab = Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
        && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    async function captureMeetingTab() {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            // Chrome will not share audio without video. The picture is never used.
            video: { frameRate: 1 },
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude',
            systemAudio: 'include',
            surfaceSwitching: 'include',
        });
        for (const t of stream.getVideoTracks()) t.enabled = false;
        if (!stream.getAudioTracks().length) {
            stream.getTracks().forEach((t) => t.stop());
            return null;
        }
        stream.getAudioTracks()[0].addEventListener('ended', () => {
            if (!isListening) return;
            setNotice('The meeting tab stopped sharing — only your microphone is being heard now.');
        });
        return stream;
    }

    // One stream out of several: what the transcriber and the recorder both take.
    function mixAudio(streams) {
        const context = new AudioContext();
        const dest = context.createMediaStreamDestination();
        for (const s of streams) if (s && s.getAudioTracks().length) context.createMediaStreamSource(s).connect(dest);
        return { context, stream: dest.stream };
    }

    function releaseTab() {
        if (tabStream) { tabStream.getTracks().forEach((t) => t.stop()); tabStream = null; }
        if (mixer) { mixer.context.close().catch(() => {}); mixer = null; }
    }

    function reflectMaterialsCount() {
        const n = $('setup-materials').value.length;
        $('materials-count').textContent = n ? `${n.toLocaleString()} / ${MATERIALS_MAX.toLocaleString()} characters` : '';
    }

    // Text files only: reading a PDF or a Word file needs a parser this page doesn't carry,
    // and pasting from either works.
    async function loadMaterialsFile(file) {
        if (!file) return;
        if (file.size > 2e6) { $('materials-count').textContent = 'That file is too large — paste the part that matters.'; return; }
        const text = (await file.text()).replace(/\r\n?/g, '\n').trim();
        const box = $('setup-materials');
        const joined = [box.value.trim(), text].filter(Boolean).join('\n\n');
        box.value = joined.slice(0, MATERIALS_MAX);
        reflectMaterialsCount();
        if (joined.length > MATERIALS_MAX) $('materials-count').textContent += ' — the rest was cut off';
    }

    async function beginSession() {
        session.objective = $('setup-objective').value.trim();
        session.type = KINDS[$('setup-type').value] ? $('setup-type').value : 'general';
        session.role = $('setup-role').value.replace(/\s+/g, ' ').trim().slice(0, 200);
        session.language = languageOf($('setup-language').value).code;
        try { localStorage.setItem('reverb.language', session.language); } catch (err) { /* ignore */ }
        const typed = $('setup-keywords').value.split(',').map(k => k.trim()).filter(Boolean);
        session.keywords = [...new Set(typed)];
        session.roster = [...new Set($('setup-roster').value.split(',').map(n => n.trim()).filter(Boolean))];
        session.agenda = $('setup-agenda').value.split('\n').map(a => a.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 20);
        const duration = Math.round(Number($('setup-duration').value));
        session.durationMin = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 600) : null;
        session.materials = $('setup-materials').value.trim().slice(0, MATERIALS_MAX);
        session.accurate = $('setup-accurate').checked;
        session.record = $('setup-record').checked;
        session.tabAudio = canShareTab && $('setup-tab').checked;
        // Recognising your voice needs a sample; asking for one rather than starting without it.
        session.voiceId = $('setup-voice').checked;
        if (session.voiceId && !readVoiceSample()) {
            $('voice-panel').hidden = false;
            voiceResult('Record a voice sample first, or turn “Recognise my voice” off.', 'bad');
            $('voice-record').focus();
            return;
        }
        // The voice check works from the audio the high-accuracy path captures.
        if (session.voiceId) session.accurate = true;
        if (!session.objective && session.followUp) session.objective = `Follow-up: ${session.followUp.title}`;
        // The browser's own recogniser only ever hears the microphone.
        if (session.tabAudio) session.accurate = true;
        // Names are the single thing a speech model mangles most, and the roster is a
        // list of them — so it doubles as transcription biasing at no extra cost.
        session.keywords = [...new Set([...session.keywords, ...session.roster])];
        persistSession();
        closeSetup();
        // A recording was chosen: read it, rather than listen.
        if (pickedRecording && !segments.length) {
            const file = pickedRecording;
            pickedRecording = null;
            runRecording(file);
            return;
        }
        await startListening();
    }

    function reflectSessionButtons() {
        reflectImprove();
        const resuming = segments.length > 0 && !isListening;
        startBtn.textContent = resuming ? 'Continue Session' : 'Start Listening';
        briefBtn.classList.toggle('hidden', !resuming);
        endBtn.classList.toggle('hidden', !resuming);
        reflectLibrary();
    }

    async function startListening() {
        if (isListening) return;
        if (improveRun) { toast('Wait for the transcript to finish improving'); return; }
        errorEl.textContent = '';
        sessionEnd.classList.add('hidden');
        restoreBar.classList.add('hidden');
        // Starting fresh past the restore bar discards what it offered, as it always has:
        // this tab's own save is overwritten by the next persist, a closed tab's is removed.
        if (offeredSave) {
            if (offeredSave.key !== STORE_KEY) {
                try { localStorage.removeItem(offeredSave.key); } catch (err) { /* ignore */ }
            }
            offeredSave = null;
        }

        try {
            if (session.accurate || session.record) {
                // Explicit constraints rather than whatever the browser defaults to: mono
                // at the rate the encoder wants, with the processing chain a room mic needs.
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                });
            }
            let captureStream = micStream;
            if (session.tabAudio && canShareTab) {
                try { tabStream = await captureMeetingTab(); }
                catch (err) { tabStream = null; }   // the picker was cancelled
                if (tabStream) {
                    mixer = mixAudio([micStream, tabStream]);
                    captureStream = mixer.stream;
                } else {
                    setNotice('No tab audio was shared, so only your microphone is being heard. To add the call, stop, then start again and turn on “Share tab audio”.');
                }
            }
            if (session.record) {
                recorder = new DiskRecorder();
                recorder.offsetMs = meetingClock();
                const { streaming } = await recorder.start(captureStream);
                recordingBadge.classList.remove('hidden');
                recordingBadge.classList.add('flex');
                recordingBadge.title = streaming
                    ? 'Audio is being written to disk continuously'
                    : 'Audio is held in memory and saved when you stop';
            }

            if (!session.accurate && !WebSpeechProvider.supported) {
                throw new Error('This browser has no built-in speech recognition. Turn on high-accuracy transcription instead.');
            }

            provider = session.accurate ? new RealtimeProvider(captureStream, micStream) : new WebSpeechProvider();
            await provider.start();

            isListening = true;
            isPaused = false;
            document.body.classList.add('listening');
            if (!startedAt) startedAt = Date.now();
            runClock(true);
            // The first sweep needs a stretch to read, not the opening pleasantries.
            if (!lastSweepAt) lastSweepAt = Date.now();
            pendingUtterance = '';
            pendingLow = false;
            modeBadge.textContent = provider.constructor.label;
            modeBadge.classList.remove('hidden');

            // The bar carries the topic tree and the rolling summary, not just the
            // objective — so a session without one still needs it. It used to stay
            // hidden until the first state update landed, which is minutes in.
            setStateObjective();
            stateBar.classList.remove('hidden');
            startVoiceId();
            // Openers from the brief, before anyone has said a word.
            reflectQuestionsButton();
            if (!segments.length && !askNext.open.length) runQuestions();

            stateTimer = setInterval(() => {
                maybeRunState(true);
                maybeRunSweep();
                maybeRunQuestions();
                checkQuietVoices();
                if (!stateBody.classList.contains('hidden')) renderBalance();
            }, STATE_INTERVAL_MS);
            captureTimer = setInterval(checkCapture, CAPTURE_WATCHDOG_MS);

            // Requested inside the click that started the session, which is the user
            // activation some browsers require before they will grant it.
            await acquireWakeLock();
            if (session.tabAudio && !tabStream) {
                // Already said: the tab wasn't shared. That outranks the screen notices.
            } else if (!('wakeLock' in navigator)) {
                setNotice('This browser can’t hold the screen awake — keep ReVerb in the foreground, or the phone will stop listening when the screen sleeps.');
            } else if (!wakeLock) {
                setNotice('The screen may still sleep — the browser refused to keep it awake.');
            } else {
                clearNotice();
            }

            startBtn.classList.add('hidden');
            briefBtn.classList.add('hidden');
            endBtn.classList.add('hidden');
            $('library-btn').classList.add('hidden');
            stopBtn.classList.remove('hidden');
            pauseBtn.classList.remove('hidden');
            pauseBtn.textContent = 'Pause';
            setStatus('Listening…', 'live');
        } catch (err) {
            console.error('ReVerb start error:', err);
            errorEl.textContent = err.name === 'AbortError'
                ? 'Cancelled — no file chosen for the recording.'
                : `Could not start: ${err.message}`;
            await stopListening({ silent: true });
        }
    }

    // Pause keeps every bit of state — segments, keywords learned so far, the topic tree,
    // the recording file. Only capture stops.
    function pauseSession() {
        if (!isListening || isPaused) return;
        isPaused = true;

        absorbInterim();
        flushUtterance();              // don't strand half a sentence across the break
        interimEl.textContent = '';
        maybeRunSpeakers(true);        // label the backlog while nobody is talking

        if (provider && provider.pause) provider.pause();
        if (recorder) recorder.pause();
        runClock(false);
        // A paused session doesn't need the screen; the phone can sleep through a break.
        releaseWakeLock();
        clearNotice();
        captureWarned = false;

        pauseBtn.textContent = 'Resume';
        recordingDot.classList.remove('animate-pulse');
        recordingLabel.textContent = 'PAUSED';
        setStatus('Paused', 'paused');
        persistTranscript(true);
    }

    function resumeSession() {
        if (!isListening || !isPaused) return;
        isPaused = false;
        markResumeSeam = true;

        if (recorder) recorder.resume();
        if (provider && provider.resume) provider.resume();
        runClock(true);
        acquireWakeLock();
        checkCapture();

        pauseBtn.textContent = 'Pause';
        recordingDot.classList.add('animate-pulse');
        recordingLabel.textContent = 'REC';
        setStatus('Listening…', 'live');
    }

    async function stopListening(opts) {
        const wasListening = isListening;
        isListening = false;
        document.body.classList.remove('listening');
        isPaused = false;
        runClock(false);
        clearInterval(stateTimer);
        clearInterval(captureTimer);
        captureTimer = null;
        releaseWakeLock();
        captureWarned = false;
        clearNotice();

        absorbInterim();
        flushUtterance();                // don't lose a trailing question
        maybeRunSpeakers(true);          // start a last pass over whatever is unlabelled

        if (provider) { provider.stop(); provider = null; }

        let audio = null;
        if (recorder) {
            try {
                audio = await recorder.stop();
                if (audio) {
                    audio.offsetMs = recorder.offsetMs || 0;
                    audio.durationMs = Math.max(0, meetingClock() - audio.offsetMs);
                    recordings.push({ name: audio.name, offsetMs: audio.offsetMs, durationMs: audio.durationMs });
                }
            }
            catch (err) { errorEl.textContent = `Recording could not be finalised: ${err.message}`; }
            recorder = null;
        }
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        releaseTab();

        recordingBadge.classList.add('hidden');
        recordingBadge.classList.remove('flex');
        recordingDot.classList.add('animate-pulse');
        recordingLabel.textContent = 'REC';
        interimEl.textContent = '';
        updateLiveCaption();

        stopBtn.classList.add('hidden');
        pauseBtn.classList.add('hidden');
        startBtn.classList.remove('hidden');
        setStatus('Not listening', 'idle');
        reflectSessionButtons();
        reflectQuestionsButton();
        stopVoiceId();

        persistTranscript(true);

        // A closing rebuild so the summary reflects the whole meeting, read in one go.
        if (segments.length && (charsSinceState > 0 || !lastPassFull)) runState({ full: true });

        if (wasListening && !(opts && opts.silent)) showSessionEnd(audio);
    }

    // ---------- end-of-session panel ----------
    function releaseLastAudio() {
        if (lastAudio && lastAudio.url) URL.revokeObjectURL(lastAudio.url);
        lastAudio = null;
    }

    function showSessionEnd(audio) {
        $('end-title').textContent = 'Stopped listening';
        releaseLastAudio();
        lastAudio = audio || null;
        $('end-diagnostics').classList.add('hidden');

        const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60000)) : null;
        endMeta.textContent = [
            `${segments.length} transcript segment${segments.length === 1 ? '' : 's'}`,
            minutes ? `${minutes} min` : null,
            session.record
                ? 'Nothing is lost: Continue Session picks up where you left off, in a new recording file (use Pause for a break), and End Session clears the meeting from this browser — the recording on disk is kept.'
                : 'Nothing is lost: Continue Session picks up where you left off, and End Session clears the meeting from this browser.',
        ].filter(Boolean).join(' · ');

        endAudio.replaceChildren();
        if (audio && audio.url) {
            const link = document.createElement('a');
            link.href = audio.url;
            link.download = audio.name;
            link.className = 'text-google-green underline break-all';
            link.textContent = audio.name;

            const row = el('div', 'text-gray-600');
            row.append(
                el('span', '', 'Recording: '),
                link,
                el('span', 'text-xs text-gray-400', ` (${formatBytes(audio.size)})`)
            );
            endAudio.append(row);
            endAudio.append(el('p', 'text-xs text-gray-400 mt-1',
                audio.streamed
                    ? 'Saved where you chose at the start. Browsers don’t reveal the folder — use the link above to open or re-save it. It stays available until you reload this page.'
                    : 'Downloaded to your browser’s downloads folder. Use the link above to save another copy.'));
        } else if (session.record) {
            endAudio.append(el('p', 'text-sm text-amber-600', 'The recording could not be finalised.'));
        }

        sessionEnd.classList.remove('hidden');
        reflectImprove();     // the recording is known only now
    }

    // ---------- ending a session ----------
    // Stop keeps everything so the meeting can pick up again, even across a reload. End
    // is the opposite promise: nothing from this meeting survives it, on screen or in
    // storage, and the next Start opens a blank brief with every card type back on.
    // Discard on the restore bar is the same promise made before anything was restored.
    async function endSession() {
        if (isListening) await stopListening({ silent: true });
        sessionEpoch++;

        // Cut every request loose and drop the work that was waiting for a turn.
        for (const controller of inflight) controller.abort();
        inflight.clear();
        analyzeQueue.length = 0;
        for (const timer of heldTimers) clearTimeout(timer);
        heldTimers.clear();
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
        if (renderFrame) { cancelAnimationFrame(renderFrame); renderFrame = 0; }
        dirtyAnswers.clear();
        clearTimeout(correctionTimer);
        correctionTimer = 0;
        clearTimeout(notesTimer);
        notesTimer = 0;
        if (chatFrame) { cancelAnimationFrame(chatFrame); chatFrame = 0; }
        chatActive = null;

        // Storage first: whatever happens below, a reload finds nothing to restore.
        clearSaved();
        try { localStorage.removeItem('reverb.session'); } catch (err) { /* ignore */ }

        // The brief, back to what a first visit sees.
        Object.assign(session, freshBrief());

        // Transcript.
        segments.length = 0;
        segmentSeq = 0;
        segmentsEl.replaceChildren();
        pendingUtterance = '';
        pendingLow = false;
        pendingEl.textContent = '';
        interimEl.textContent = '';
        transcriptJump.hidden = true;
        markResumeSeam = false;
        startedAt = null;
        activeMs = 0;
        activeSince = 0;

        // Insights, and everything the classifier had learned about this room.
        insightsContainer.querySelectorAll('[data-card]').forEach((card) => card.remove());
        placeholderCard.classList.remove('hidden');
        insightsJump.hidden = true;
        unreadInsights = 0;
        reflectUnread();
        answeredTitles.length = 0;
        dismissedTitles.length = 0;
        for (const key of Object.keys(typeBias)) delete typeBias[key];
        for (const key of Object.keys(typeLastShown)) delete typeLastShown[key];
        cardOrder = 0;
        resetTypePrefs();

        // Topic tree and rolling summary.
        meetingState = null;
        participants = [];
        charsSinceState = 0;
        lastStateSegment = 0;
        statePasses = 0;
        lastFullAt = 0;
        lastPassFull = false;
        closingPassQueued = false;
        lastSpeakerRun = 0;
        charsSinceSweep = 0;
        lastSweepAt = 0;
        sweepUnsupported = false;
        stopVoiceId();
        voiceFailures = 0;
        voiceUnsupported = false;
        for (const key of Object.keys(docs)) docs[key] = '';
        docError = '';
        recapTab = 'recap';
        askNext.open = [];
        askNext.asked = [];
        askNext.skipped = [];
        askNext.earlier = [];
        lastQuestionsAt = 0;
        charsSinceQuestions = 0;
        questionsUnsupported = false;
        reflectQuestionsButton();
        reflectCoverage();
        if (!stateBody.classList.contains('hidden')) toggleStateBody();
        stateBar.classList.add('hidden');
        topicTree.replaceChildren(el('p', 'text-gray-400 italic font-light', 'Listening for the shape of the discussion…'));
        summaryBody.replaceChildren(el('p', 'text-gray-400 italic font-light', 'A summary appears a few minutes in.'));
        stampState(0);
        setStateObjective();

        // The chat about this meeting, and every correction made to it.
        for (const t of chatTurns) if (t.el) t.el.remove();
        chatTurns.length = 0;
        renderChat();
        chatInput.value = '';
        sizeChatInput();
        sessionNotes = '';
        notesInput.value = '';
        reflectNotes();
        toggleNotes(false);
        for (const key of Object.keys(speakerAliases)) delete speakerAliases[key];
        closeSpeakerEditor();
        todos.length = 0;
        todoEditing = null;
        glossary.length = 0;
        for (const key of Object.keys(quietNudged)) delete quietNudged[key];
        renderTodos();
        renderGlossary();
        renderBalance();
        closeModal('recap-modal');
        if (improveRun) improveRun.controller.abort();
        improveRun = null;
        improveUndo = null;
        recordings.length = 0;
        $('improve-bar').classList.add('hidden');
        reflectChatReady();

        // The diagnostics behind the panel that is closing, and its recording link.
        Object.assign(stats, freshStats());
        releaseLastAudio();

        sessionEnd.classList.add('hidden');
        restoreBar.classList.add('hidden');
        modeBadge.classList.add('hidden');
        errorEl.textContent = '';
        clearNotice();
        setStatus('Not listening', 'idle');
        reflectSessionButtons();
        updateLiveCaption();
    }

    // ---------- wiring ----------
    startBtn.addEventListener('click', () => {
        // The brief is already set for a session in progress — continuing shouldn't
        // make you walk back through the modal.
        if (segments.length) startListening();
        else openSetup();
    });
    briefBtn.addEventListener('click', openSetup);
    pauseBtn.addEventListener('click', () => (isPaused ? resumeSession() : pauseSession()));
    stopBtn.addEventListener('click', () => stopListening());
    $('setup-cancel').addEventListener('click', closeSetup);
    $('setup-start').addEventListener('click', beginSession);
    $('setup-materials').addEventListener('input', reflectMaterialsCount);
    $('materials-load').addEventListener('click', () => $('materials-file').click());
    $('materials-file').addEventListener('change', (e) => {
        loadMaterialsFile(e.target.files && e.target.files[0]).catch((err) => {
            $('materials-count').textContent = `Could not read that file: ${err.message}`;
        });
        e.target.value = '';
    });

    $('improve-btn').addEventListener('click', startImprove);
    $('end-improve').addEventListener('click', startImprove);
    $('improve-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onImproveFile(f); });
    $('improve-undo').addEventListener('click', undoImprove);
    $('recording-pick').addEventListener('click', () => $('recording-file').click());
    $('recording-file').addEventListener('change', (e) => {
        pickedRecording = e.target.files[0] || null;
        e.target.value = '';
        reflectRecordingPick();
    });
    $('recording-clear').addEventListener('click', () => { pickedRecording = null; reflectRecordingPick(); });
    $('replay-skip').addEventListener('click', () => {
        if (!replay) return;
        replay.skip = true;
        $('replay-skip').hidden = true;
    });
    $('improve-cancel').addEventListener('click', () => {
        if (improveRun) improveRun.controller.abort();
        else $('improve-bar').classList.add('hidden');
    });
    endBtn.addEventListener('click', confirmEnd);
    $('alert').addEventListener('click', (e) => { if (e.target === $('alert') && alertDone) alertDone(); });
    $('alert').addEventListener('keydown', (e) => { if (e.key === 'Escape' && alertDone) { e.stopPropagation(); alertDone(); } });
    // The empty transcript's own Start button does what the header's does.
    document.querySelector('#transcript-empty [data-start]').addEventListener('click', () => startBtn.click());
    setupModal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeSetup(); } });
    $('end-dismiss').addEventListener('click', () => sessionEnd.classList.add('hidden'));
    $('end-diagnostics-toggle').addEventListener('click', () => {
        const box = $('end-diagnostics');
        const showing = !box.classList.contains('hidden');
        if (!showing) box.textContent = diagnosticsText();
        box.classList.toggle('hidden', showing);
    });

    $('end-transcript').addEventListener('click', () => {
        downloadBlob(new Blob([transcriptAsText()], { type: 'text/plain' }), `reverb-transcript-${fileStamp()}.txt`);
    });

    $('restore-yes').addEventListener('click', () => {
        const offered = offeredSave;
        offeredSave = null;
        if (offered) {
            restoreSaved(offered.data);
            // Adopted from a closed tab: it is this tab's meeting now, saved under its key.
            if (offered.key !== STORE_KEY) {
                try {
                    localStorage.setItem(STORE_KEY, JSON.stringify(offered.data));
                    localStorage.removeItem(offered.key);
                } catch (err) { /* quota — the next save writes it */ }
            }
        }
        restoreBar.classList.add('hidden');
    });
    $('restore-no').addEventListener('click', () => showAlert({
        title: 'Discard This Session?',
        message: 'The unfinished session will be erased from this browser.',
        actions: [{ label: 'Cancel', style: 'cancel' }, { label: 'Discard', style: 'destructive', run: endSession }],
    }));

    // On a phone the same body opens as a sheet, with a scrim and Done to close it.
    function toggleStateBody() {
        const hidden = stateBody.classList.toggle('hidden');
        if (!hidden) { refreshStateForReader(); renderBalance(); }
        stateChevron.style.transform = hidden ? '' : 'rotate(180deg)';
        sheetScrim.hidden = hidden;
    }
    $('state-toggle').addEventListener('click', toggleStateBody);
    $('state-done').addEventListener('click', toggleStateBody);
    sheetScrim.addEventListener('click', toggleStateBody);

    // ---------- phone: one panel at a time ----------
    function showPane(pane) {
        panels.dataset.pane = pane;
        for (const tab of document.querySelectorAll('#pane-switch [role="tab"]')) {
            tab.setAttribute('aria-selected', String(tab.dataset.pane === pane));
        }
        // The right-hand pick carries over to a wider screen.
        if (pane === 'insights' || pane === 'chat') showSide(pane);
        if (pane === 'insights') {
            unreadInsights = 0;
            reflectUnread();
        }
    }
    $('pane-switch').addEventListener('click', (e) => {
        const tab = e.target.closest('[role="tab"]');
        if (tab) showPane(tab.dataset.pane);
    });

    // On the Insights view, the last two lines of speech sit under the cards, so the
    // view you're on still shows the room is being heard.
    function updateLiveCaption() {
        if (!phoneLayout.matches) return;
        const live = `${pendingEl.textContent} ${interimEl.textContent}`.trim();
        const text = !isListening ? '' : live || (segments.length ? segments[segments.length - 1].text : '');
        liveCaptionText.textContent = text.slice(-240);
        liveCaption.hidden = !text;
    }
    new MutationObserver(updateLiveCaption).observe(transcriptContainer, { childList: true, characterData: true, subtree: true });
    phoneLayout.addEventListener('change', updateLiveCaption);
    liveCaption.addEventListener('click', () => showPane('transcript'));

    transcriptJump.addEventListener('click', () => {
        transcriptJump.hidden = true;
        scrollTranscript();   // not smooth: the edge keeps moving, and an animation would land short of it
    });
    insightsJump.addEventListener('click', () => {
        insightsJump.hidden = true;
        insightsContainer.scrollTo({ top: 0, behavior: 'smooth' });
    });
    transcriptContainer.addEventListener('scroll', () => {
        if (!transcriptJump.hidden && transcriptAtBottom()) transcriptJump.hidden = true;
    }, { passive: true });
    insightsContainer.addEventListener('scroll', () => {
        if (!insightsJump.hidden && insightsAtTop()) insightsJump.hidden = true;
    }, { passive: true });

    $('copy-transcript').addEventListener('click', (e) => copyToClipboard(attributedTranscript(), e.currentTarget, 'Transcript'));
    $('copy-summary').addEventListener('click', (e) => copyToClipboard(summaryAsText({ standalone: true }), e.currentTarget, 'Summary'));

    // ---------- recap, past meetings, invites ----------
    $('recap-open').addEventListener('click', openRecap);
    $('end-recap').addEventListener('click', openRecap);
    $('recap-copy').addEventListener('click', (e) => (recapTab === 'recap'
        ? copyToClipboard($('recap-preview').textContent, e.currentTarget, 'Recap')
        : copyToClipboard(docs[recapTab], e.currentTarget)));
    $('recap-email').addEventListener('click', () => { if (recapTab === 'email') mailDraft(); else emailRecap(); });
    $('recap-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('[role="tab"]');
        if (!tab) return;
        recapTab = tab.dataset.tab;
        reflectOutcome();
    });
    $('outcome-write').addEventListener('click', () => writeDoc(recapTab));
    $('outcome-rewrite').addEventListener('click', () => writeDoc(recapTab));
    $('outcome-text').addEventListener('click', (e) => {
        const cite = e.target.closest('.cite[data-min]');
        if (!cite) return;
        closeModal('recap-modal');
        jumpToMinute(Number(cite.dataset.min));
    });
    $('recap-link').addEventListener('click', async (e) => {
        const button = e.currentTarget;
        try { await copyToClipboard(recapUrl || await recapLink(recapShown || buildRecap()), button, 'Link'); }
        catch (err) { errorEl.textContent = 'Could not make a link for this recap.'; }
    });
    $('recap-save').addEventListener('click', saveToLibrary);
    $('library-btn').addEventListener('click', () => { openLibrary(); });

    fillKindMenu();
    $('setup-voice').addEventListener('change', () => { voiceResult(''); reflectVoicePanel(); });
    $('voice-record').addEventListener('click', recordVoiceSample);
    $('voice-test').addEventListener('click', testVoiceSample);
    $('voice-play').addEventListener('click', () => {
        const v = readVoiceSample();
        if (v) new Audio(v.sample).play().catch(() => {});
    });
    $('voice-delete').addEventListener('click', () => {
        try { localStorage.removeItem(VOICE_KEY); } catch (err) { /* ignore */ }
        voiceResult('Deleted.');
        reflectVoicePanel();
    });
    $('library-backup').addEventListener('click', backupLibrary);
    $('library-restore').addEventListener('click', () => $('library-file').click());
    $('library-file').addEventListener('change', (e) => { restoreLibrary(e.target.files[0]); e.target.value = ''; });
    $('pm-back').addEventListener('click', showLibraryIndex);
    $('pm-form').addEventListener('submit', (e) => { e.preventDefault(); submitPast(); });
    $('pm-input').addEventListener('input', reflectPastChat);
    $('pm-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitPast(); }
    });
    $('pm-log').addEventListener('click', (e) => {
        const act = e.target.closest('.chat-a-foot [data-act]');
        if (!act || !pastOpen) return;
        const turn = pastTurns(pastOpen).find((t) => t.el && t.el.contains(act));
        if (!turn) return;
        if (act.dataset.act === 'retry') askPast(turn.question, turn);
        else if (act.dataset.act === 'copy') copyToClipboard(turn.answer.trim(), act);
    });
    $('pm-link').addEventListener('click', async () => {
        if (!pastOpen) return;
        const url = await recapLink(pastOpen.recap).catch(() => '');
        copyToClipboard(url, $('pm-link'), 'Link');
    });
    $('pm-follow').addEventListener('click', () => {
        if (!pastOpen || segments.length) return;
        const entry = pastOpen;
        closeModal('library-modal');
        startFollowUp(entry);
    });
    let pmDeleteArmed = 0;
    $('pm-delete').addEventListener('click', () => {
        if (!pastOpen) return;
        const button = $('pm-delete');
        if (!pmDeleteArmed) {
            button.textContent = 'Delete? Click again';
            pmDeleteArmed = setTimeout(() => { pmDeleteArmed = 0; button.textContent = 'Delete'; }, 3000);
            return;
        }
        clearTimeout(pmDeleteArmed);
        pmDeleteArmed = 0;
        const id = pastOpen.id;
        pastChats.delete(id);
        writeLibrary(readLibrary().filter((e) => e.id !== id));
        showLibraryIndex();
    });
    $('questions-refresh').addEventListener('click', () => runQuestions({ manual: true }));
    for (const modal of [$('recap-modal'), $('library-modal')]) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-close]')) modal.classList.add('hidden');
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        for (const id of ['recap-modal', 'library-modal']) closeModal(id);
    });
    $('todo-add').addEventListener('click', () => openTodoForm(null));
    $('todo-list').addEventListener('click', (e) => {
        const cite = e.target.closest('.cite[data-seg]');
        if (cite) jumpToSegment(cite.dataset.seg);
    });
    $('invite-load').addEventListener('click', () => {
        const box = $('invite-box');
        box.hidden = !box.hidden;
        if (!box.hidden) $('invite-text').focus();
    });
    $('invite-file-pick').addEventListener('click', () => $('invite-file').click());
    $('invite-file').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 1e6) { $('followup-note').textContent = 'That file is too large to be an invite.'; return; }
        applyInvite(await file.text());
    });
    $('invite-apply').addEventListener('click', () => applyInvite($('invite-text').value));

    // ---------- chat wiring ----------
    for (const tabs of document.querySelectorAll('.side-tabs')) {
        tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('[role="tab"]');
            if (tab) showSide(tab.dataset.side);
        });
    }
    chatForm.addEventListener('submit', (e) => { e.preventDefault(); submitChat(); });
    chatInput.addEventListener('input', () => { sizeChatInput(); reflectChatReady(); });
    chatInput.addEventListener('keydown', (e) => {
        // Enter sends on a keyboard; on a phone, Return is a new line and the button sends.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !phoneLayout.matches) {
            e.preventDefault();
            submitChat();
        }
    });
    chatEmpty.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ask]');
        if (b && !b.disabled) askChat(b.dataset.ask);
    });
    chatLog.addEventListener('click', (e) => {
        const cite = e.target.closest('.cite');
        if (cite) { jumpToMinute(Number(cite.dataset.min)); return; }
        const act = e.target.closest('.chat-a-foot [data-act]');
        if (!act) return;
        const turn = chatTurns.find((t) => t.el && t.el.contains(act));
        if (!turn) return;
        if (act.dataset.act === 'retry') askChat(turn.question, turn);
        else if (act.dataset.act === 'copy') copyToClipboard(turn.answer.trim(), act);
    });
    chatClear.addEventListener('click', clearChat);

    // Corrections: saved as they are typed; the rebuild waits for the typing to stop.
    notesToggle.addEventListener('click', () => toggleNotes());
    notesInput.addEventListener('input', () => {
        sessionNotes = notesInput.value.slice(0, NOTES_MAX);
        reflectNotes();
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => { notesTimer = 0; correctionsChanged({ wholeRecord: true }); }, 1200);
    });

    // Who said it: a speaker label opens the editor.
    segmentsEl.addEventListener('click', (e) => {
        const tag = e.target.closest('.speaker-tag');
        if (tag) openSpeakerEditor(tag);
    });
    segmentsEl.addEventListener('keydown', (e) => {
        const tag = e.target.closest('.speaker-tag');
        if (tag && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSpeakerEditor(tag); }
    });
    $('speaker-save').addEventListener('click', saveSpeakerEditor);
    $('speaker-cancel').addEventListener('click', closeSpeakerEditor);
    speakerEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeSpeakerEditor(); }
        else if (e.key === 'Enter' && e.target === speakerName) { e.preventDefault(); saveSpeakerEditor(); }
    });
    // A click anywhere else, or the transcript scrolling the label away, closes it.
    document.addEventListener('pointerdown', (e) => {
        if (!speakerEditor.hidden && !speakerEditor.contains(e.target) && !e.target.closest('.speaker-tag')) closeSpeakerEditor();
    });
    transcriptContainer.addEventListener('scroll', () => {
        if (!speakerEditor.hidden && !speakerEditor.contains(document.activeElement)) closeSpeakerEditor();
    }, { passive: true });

    // "More" on a card, the thumbs, and asking about it in chat.
    insightsContainer.addEventListener('click', (e) => {
        const source = e.target.closest('.card-when[data-seg]');
        if (source) { jumpToSegment(source.dataset.seg); return; }
        const minute = e.target.closest('.cite[data-min]');
        if (minute) { jumpToMinute(Number(minute.dataset.min)); return; }
        const ask = e.target.closest('[data-ask-card]');
        if (ask) {
            const card = ask.closest('[data-card]');
            const label = CARD_TYPE_UI[card.dataset.type] ? CARD_TYPE_UI[card.dataset.type].label : 'insight';
            openChat(`About the “${card.dataset.title}” ${label.toLowerCase()} card: `);
            return;
        }
        const more = e.target.closest('.card-more-toggle');
        if (more) {
            const card = more.closest('[data-card]');
            const panel = card.querySelector('.card-more');
            panel.hidden = !panel.hidden;
            more.textContent = panel.hidden ? 'More' : 'Less';
            more.setAttribute('aria-expanded', String(!panel.hidden));
            return;
        }
        const vote = e.target.closest('[data-feedback]');
        if (vote) { onFeedback(vote.closest('[data-card]'), vote.dataset.feedback); return; }
        const settle = e.target.closest('[data-ask-act]');
        if (settle) onAskAct(settle.closest('[data-card]'), settle.dataset.askAct);
    });

    // Collapse / expand insight cards
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-toggle="collapse"]');
        if (!btn) return;
        const card = btn.closest('.rounded-xl');
        card.querySelector('.card-body').classList.toggle('hidden');
        btn.querySelector('.chevron-up').classList.toggle('hidden');
        btn.querySelector('.chevron-down').classList.toggle('hidden');
    });

    window.addEventListener('beforeunload', (e) => {
        if (!isListening) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // Cleared from another tab — "Clear ReVerb From This Browser" on the front page. A meeting open
    // here would write itself straight back, so it ends instead: the recording file is closed
    // properly, nothing is saved, and the tab goes to the front page, which says it's done.
    window.addEventListener('storage', async (e) => {
        const site = window.REVERB_SITE;
        if (!site || e.key !== site.clearedSignal || !e.newValue || clearedElsewhere) return;
        clearedElsewhere = true;
        try { if (isListening) await stopListening({ silent: true }); } catch (err) { /* leaving anyway */ }
        site.clearBrowser(true);
        location.replace('../#cleared');
    });

    // beforeunload doesn't fire reliably on mobile or on a tab discard; pagehide does.
    window.addEventListener('pagehide', () => persistTranscript(true));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { persistTranscript(true); return; }
        // Back in the foreground: the wake lock was dropped on the way out and the
        // AudioContext may have been suspended. Repair both immediately rather than
        // waiting up to CAPTURE_WATCHDOG_MS for the next sweep.
        checkCapture();
        refreshStateForReader();
    });

    filterToggle.addEventListener('click', () => typeFilters.classList.toggle('hidden'));

    loadTypePrefs();
    renderTypeFilters();
    applyTypeFilters();
    restoreSessionBrief();
    reflectSessionButtons();
    reflectNotes();
    reflectChatReady();

    claimTab().then(findSaved).then((saved) => {
        // Starting a session before this resolves means the offer no longer applies.
        if (!saved || isListening || segments.length) return;
        offeredSave = saved;
        const when = new Date(saved.data.savedAt).toLocaleString();
        const words = saved.data.segments.reduce((n, s) => n + s.text.length, 0);
        restoreDetail.textContent = `An unfinished session from ${when} is still here (${saved.data.segments.length} segments, ~${Math.round(words / 5)} words).`;
        restoreBar.classList.remove('hidden');
    });

    if (!WebSpeechProvider.supported) {
        errorEl.textContent = 'This browser has no built-in speech recognition — start a session with high-accuracy transcription enabled.';
    }
})();
