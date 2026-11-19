// The translation editor page. Everything it shows comes from the catalog the
// extension sends; it keeps the translation in memory, saves it through the
// extension (debounced), and asks the extension for the real previews.
(function () {
	'use strict';

	const api = acquireVsCodeApi();
	const R = window.VibrancyTranslationRules;
	const isMac = /Mac/.test(navigator.platform);
	const MOD = isMac ? '⌘' : 'Ctrl';

	const state = {
		catalog: null,
		mode: 'draft',
		useDraft: false,
		displayLanguage: 'en',
		languages: [],
		locale: null,
		messages: {},
		source: null,
		target: null,
		released: false,
		hasDraft: false,
		locales: [],
		selected: null,
		filter: 'all',
		query: '',
		dirty: false,
	};
	Object.assign(state, pick(api.getState() || {}, ['selected', 'filter', 'query']));

	const $ = (id) => document.getElementById(id);
	let entries = [];
	let byKey = {};
	let saveTimer = null;

	// ---- helpers -----------------------------------------------------------

	function pick(object, keys) {
		const out = {};
		for (const k of keys) if (object[k] !== undefined) out[k] = object[k];
		return out;
	}

	/** Creates an element. `attrs.class`, `attrs.on<event>`, others as attributes. */
	function h(tag, attrs, ...children) {
		const el = document.createElement(tag);
		for (const [name, value] of Object.entries(attrs || {})) {
			if (value === undefined || value === null || value === false) continue;
			if (name === 'class') el.className = value;
			else if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
			else if (name === 'text') el.textContent = value;
			else el.setAttribute(name, value === true ? '' : value);
		}
		for (const child of children.flat()) {
			if (child === null || child === undefined || child === false) continue;
			el.append(child instanceof Node ? child : document.createTextNode(String(child)));
		}
		return el;
	}

	function saveViewState() {
		api.setState({ selected: state.selected, filter: state.filter, query: state.query });
	}

	function languageName(code, inLanguage) {
		try {
			const tag = code.replace(/-([a-z0-9]+)$/i, (m, r) => '-' + r.toUpperCase());
			return new Intl.DisplayNames([inLanguage || 'en'], { type: 'language' }).of(tag) || code;
		} catch (e) {
			return code;
		}
	}

	function bothNames(code) {
		const english = languageName(code, 'en');
		const own = languageName(code, code);
		return own && own !== english && own !== code ? `${english} · ${own}` : english;
	}

	function translated(key) {
		return R.isTranslated(state.messages[key]);
	}

	/** Text shown for a key: the translation, or English. */
	function lookup(key) {
		return translated(key) ? state.messages[key] : state.catalog.english[key];
	}

	function problemsFor(key) {
		const entry = byKey[key];
		return R.checkEntry(entry.english, state.messages[key], { markdown: entry.markdown });
	}

	function status(key) {
		if (!translated(key)) return 'todo';
		return problemsFor(key).length ? 'problem' : 'done';
	}

	// ---- saving ------------------------------------------------------------

	function scheduleSave() {
		state.dirty = true;
		$('saveState').textContent = 'Editing…';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSave, 500);
	}

	function flushSave() {
		clearTimeout(saveTimer);
		if (!state.dirty || !state.locale) return;
		state.dirty = false;
		api.postMessage({ type: 'save', locale: state.locale, messages: state.messages });
	}

	window.addEventListener('blur', flushSave);

	// ---- messages from the extension --------------------------------------

	window.addEventListener('message', (event) => {
		const message = event.data;
		switch (message.type) {
			case 'init':
				state.catalog = message.catalog;
				state.languages = message.languages;
				state.mode = message.mode;
				state.repoRoot = message.repoRoot;
				state.useDraft = message.useDraft;
				state.displayLanguage = message.displayLanguage;
				entries = message.catalog.entries;
				byKey = Object.fromEntries(entries.map(e => [e.key, e]));
				if (!byKey[state.selected]) state.selected = entries[0].key;
				break;
			case 'locale':
				state.locale = message.locale;
				state.messages = Object.assign({}, message.messages);
				state.source = message.source;
				state.target = message.target;
				state.released = message.released;
				state.hasDraft = message.hasDraft;
				state.locales = message.locales;
				state.dirty = false;
				$('saveState').textContent = '';
				hideBanner();
				renderAll();
				break;
			case 'saved':
				if (message.locale !== state.locale) return;
				state.locales = message.locales;
				state.hasDraft = message.hasDraft;
				state.target = message.path;
				$('saveState').textContent = state.dirty ? 'Editing…' : 'Saved';
				$('saveState').title = message.path;
				renderLocalePicker();
				renderFooter();
				break;
			case 'useDraft':
				state.useDraft = message.on;
				renderFooter();
				break;
			case 'error':
				showBanner(message.message);
				break;
		}
	});

	function showBanner(text) {
		const banner = $('banner');
		banner.textContent = text;
		banner.hidden = false;
	}

	function hideBanner() {
		$('banner').hidden = true;
	}

	// ---- rendering ---------------------------------------------------------

	function renderAll() {
		renderLocalePicker();
		renderProgress();
		renderChips();
		renderList();
		renderDetail();
		renderFooter();
		const item = state.locale && document.querySelector(`.item[data-key="${CSS.escape(state.selected)}"]`);
		if (item) item.scrollIntoView({ block: 'center' });
		const ready = !!state.locale;
		$('saveCopy').disabled = !ready;
		$('submit').disabled = !ready;
	}

	function renderLocalePicker() {
		const select = $('locale');
		select.replaceChildren();
		if (!state.locale) select.append(h('option', { value: '', selected: true, disabled: true, text: 'Choose a language…' }));
		for (const l of state.locales) {
			const tag = l.draft ? ' · your draft' : '';
			select.append(h('option', { value: l.code, selected: l.code === state.locale, text: `${bothNames(l.code)} (${l.code})${tag}` }));
		}
		if (state.locale && !state.locales.some(l => l.code === state.locale)) {
			select.append(h('option', { value: state.locale, selected: true, text: `${bothNames(state.locale)} (${state.locale}) · new` }));
		}
		select.append(h('option', { value: '__new', text: 'Add a language…' }));
	}

	$('locale').addEventListener('change', (event) => {
		const value = event.target.value;
		if (value === '__new') {
			flushSave();
			state.locale = null;
			renderAll();
			const picker = document.querySelector('#newLocale');
			if (picker) picker.focus();
			return;
		}
		flushSave();
		api.postMessage({ type: 'selectLocale', code: value });
	});

	function renderProgress() {
		const progress = $('progress');
		progress.hidden = !state.locale;
		if (!state.locale) return;
		const done = entries.filter(e => translated(e.key)).length;
		$('bar').style.width = `${(done / entries.length) * 100}%`;
		$('progressText').textContent = `${done} of ${entries.length} translated`;
	}

	function renderChips() {
		const todo = entries.filter(e => status(e.key) === 'todo').length;
		const problems = entries.filter(e => status(e.key) === 'problem').length;
		$('countTodo').textContent = state.locale ? todo : '';
		$('countProblems').textContent = state.locale ? problems : '';
		for (const chip of document.querySelectorAll('.chip')) {
			chip.classList.toggle('active', chip.dataset.filter === state.filter);
			chip.setAttribute('aria-pressed', chip.dataset.filter === state.filter);
		}
	}

	for (const chip of document.querySelectorAll('.chip')) {
		chip.addEventListener('click', () => {
			state.filter = chip.dataset.filter;
			saveViewState();
			renderChips();
			renderList();
		});
	}

	$('search').value = state.query;
	$('search').addEventListener('input', (event) => {
		state.query = event.target.value;
		saveViewState();
		renderList();
	});

	function visibleEntries() {
		const q = state.query.trim().toLowerCase();
		return entries.filter((e) => {
			if (state.locale && state.filter === 'todo' && status(e.key) !== 'todo') return false;
			if (state.locale && state.filter === 'problems' && status(e.key) !== 'problem') return false;
			if (!q) return true;
			return [e.key, e.english, e.label, state.messages[e.key] || ''].some(s => s.toLowerCase().includes(q));
		});
	}

	function renderList() {
		const list = $('list');
		list.replaceChildren();
		list.classList.toggle('inactive', !state.locale);
		const visible = visibleEntries();
		for (const group of state.catalog.groups) {
			const items = visible.filter(e => e.group === group.id);
			if (!items.length) continue;
			const all = entries.filter(e => e.group === group.id);
			const done = all.filter(e => translated(e.key)).length;
			list.append(h('div', { class: 'group' },
				h('span', { text: group.label }),
				state.locale ? h('span', { class: 'group-count', text: `${done}/${all.length}` }) : null));
			for (const e of items) list.append(listItem(e));
		}
		if (!visible.length) list.append(h('p', { class: 'empty', text: state.filter === 'todo' ? 'Everything is translated.' : state.filter === 'problems' ? 'No problems.' : 'Nothing matches.' }));
	}

	function listItem(e) {
		const s = state.locale ? status(e.key) : 'none';
		const text = (state.locale && translated(e.key) ? state.messages[e.key] : e.english)
			.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');
		return h('button', {
			class: `item ${s}${state.locale && e.key === state.selected ? ' selected' : ''}`,
			'data-key': e.key,
			title: e.key,
			onclick: () => select(e.key, true),
		},
		h('span', { class: `dot ${s}`, 'aria-label': { done: 'Translated', todo: 'To do', problem: 'Has a problem', none: '' }[s] }),
		h('span', { class: 'item-text' },
			h('span', { class: 'item-label', text: e.group === 'settings' || e.group === 'terminal' ? e.label : text }),
			e.group === 'settings' ? h('span', { class: 'item-sub', text }) : null));
	}

	function refreshListItem(key) {
		const old = document.querySelector(`.item[data-key="${CSS.escape(key)}"]`);
		if (old) old.replaceWith(listItem(byKey[key]));
	}

	function select(key, focus) {
		flushSave();
		state.selected = key;
		saveViewState();
		for (const item of document.querySelectorAll('.item')) item.classList.toggle('selected', item.dataset.key === key);
		const item = document.querySelector(`.item[data-key="${CSS.escape(key)}"]`);
		if (item) item.scrollIntoView({ block: 'nearest' });
		renderDetail();
		if (focus) {
			const area = $('translation');
			if (area) area.focus();
		}
	}

	function move(step, todoOnly) {
		const list = visibleEntries();
		const pool = todoOnly ? entries : list;
		let index = pool.findIndex(e => e.key === state.selected);
		for (let i = 0; i < pool.length; i++) {
			index = (index + step + pool.length) % pool.length;
			if (!todoOnly || status(pool[index].key) !== 'done') {
				select(pool[index].key, true);
				return;
			}
		}
	}

	// ---- detail ------------------------------------------------------------

	function renderDetail() {
		const detail = $('detail');
		detail.replaceChildren();
		if (!state.locale) {
			detail.append(welcome());
			return;
		}
		const e = byKey[state.selected];
		const groupLabel = state.catalog.groups.find(g => g.id === e.group).label;

		detail.append(
			h('div', { class: 'crumbs' }, h('span', { text: groupLabel }), ' › ', h('span', { text: shortLabel(e) })),
			h('p', { class: 'where', text: e.where }),
			h('section', { class: 'pane source' },
				h('div', { class: 'pane-head' },
					h('span', { class: 'pane-title', text: 'English' }),
					h('button', { class: 'link', title: 'Start from the English text, for strings with many placeholders or links', onclick: copyEnglish, text: 'Copy to translation' })),
				h('div', { class: 'english', lang: 'en' }, withPlaceholders(e.english))),
			h('section', { class: 'pane target' },
				h('div', { class: 'pane-head' },
					h('label', { class: 'pane-title', for: 'translation', text: `${bothNames(state.locale)} (${state.locale})` }),
					e.markdown ? h('span', { class: 'hint', text: 'Markdown: keep [text](link) targets as they are' }) : h('span', { class: 'hint', text: 'Plain text' })),
				h('textarea', { id: 'translation', lang: state.locale, dir: 'auto', rows: 3, spellcheck: 'true', placeholder: 'Type the translation. Leave empty to show English.' }),
				placeholderChips(e),
				h('ul', { class: 'problems', id: 'problems' })),
			h('div', { class: 'nav-row' },
				h('button', { class: 'secondary', onclick: () => move(-1), text: '← Previous' }),
				h('button', { class: 'secondary', onclick: () => move(1), text: 'Next →' }),
				h('button', { onclick: () => move(1, true), text: 'Next to do' }),
				h('span', { class: 'hint', text: `${MOD}+Enter next to do · Alt+↑/↓ previous/next` })),
			h('section', { class: 'pane preview' },
				h('div', { class: 'pane-head' },
					h('span', { class: 'pane-title', text: 'Preview' }),
					nativeButton(e)),
				h('div', { id: 'previewBody' })),
		);

		const area = $('translation');
		area.value = state.messages[e.key] || '';
		autoGrow(area);
		area.addEventListener('input', () => {
			if (area.value === '') delete state.messages[e.key];
			else state.messages[e.key] = area.value;
			autoGrow(area);
			scheduleSave();
			update(e.key);
		});
		area.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				move(1, true);
			}
		});
		renderProblems(e.key);
		renderPreview(e);
	}

	const KIND_LABELS = {
		info: 'Information notification',
		warning: 'Warning notification',
		error: 'Error notification',
		progress: 'Progress notification',
		button: 'Button',
		detail: 'Dialog text',
	};

	/** What the string is, briefly: "Error dialog", "Button", a setting's name. */
	function shortLabel(e) {
		if (e.group !== 'notifications') return e.label;
		const meta = state.catalog.messages[e.key];
		if (meta.modal) return { info: 'Information dialog', warning: 'Warning dialog', error: 'Error dialog' }[meta.kind];
		if (meta.wrappedBy) return 'Error, shown inside "' + state.catalog.english[meta.wrappedBy].replace(/[:\s]+$/, '') + '"';
		return KIND_LABELS[meta.kind] || e.label;
	}

	function update(key) {
		renderProblems(key);
		renderPreview(byKey[key]);
		refreshListItem(key);
		renderProgress();
		renderChips();
	}

	function autoGrow(area) {
		area.style.height = 'auto';
		area.style.height = `${Math.max(area.scrollHeight + 2, 64)}px`;
	}

	function copyEnglish() {
		const area = $('translation');
		const e = byKey[state.selected];
		area.value = e.english;
		state.messages[e.key] = e.english;
		autoGrow(area);
		scheduleSave();
		update(e.key);
		area.focus();
		area.select();
	}

	function withPlaceholders(text) {
		const parts = [];
		const re = /%\d+|\{\d+\}/g;
		let last = 0;
		let match;
		while ((match = re.exec(text)) !== null) {
			parts.push(text.slice(last, match.index), h('span', { class: 'ph', title: 'Placeholder: keep it in your translation', text: match[0] }));
			last = match.index + match[0].length;
		}
		parts.push(text.slice(last));
		return parts;
	}

	function placeholderChips(e) {
		if (!e.placeholders.length) return null;
		const samples = (state.catalog.messages[e.key] || {}).samples || {};
		return h('div', { class: 'tokens' },
			h('span', { class: 'hint', text: 'Placeholders (click to insert):' }),
			e.placeholders.map(p => h('button', {
				class: 'ph ph-button',
				title: samples[p] ? `Filled in with a value like "${samples[p]}"` : 'Filled in when shown',
				onclick: () => insertAtCursor(p),
				text: p,
			})));
	}

	function insertAtCursor(text) {
		const area = $('translation');
		const start = area.selectionStart;
		const end = area.selectionEnd;
		area.setRangeText(text, start, end, 'end');
		area.dispatchEvent(new Event('input'));
		area.focus();
	}

	function renderProblems(key) {
		const list = $('problems');
		if (!list) return;
		list.replaceChildren(...problemsFor(key).map(p => h('li', { text: p })));
	}

	function nativeButton(e) {
		let label;
		let title;
		if (e.group === 'settings') {
			label = 'Open in Settings';
			title = 'Shows the real setting for context. It has the installed text, not yours: VS Code reads setting descriptions only when it starts.';
		} else if (e.group === 'commands') {
			label = 'Show in VS Code';
			title = 'Opens a Command Palette list with your text. Nothing runs.';
		} else if (e.group === 'terminal') {
			label = 'Open Real Terminal';
			title = 'Opens a terminal like the one Vibrancy uses on Linux, with your text.';
		} else {
			const meta = state.catalog.messages[byKey[e.key].key];
			const main = meta.usedBy ? state.catalog.messages[meta.usedBy[0]] : meta;
			label = main.modal ? 'Show Real Dialog' : meta.kind === 'progress' ? 'Show Real Progress' : 'Show Real Notification';
			title = 'Shows it with VS Code\'s own notifications, with your text and example values. Buttons do nothing.';
		}
		return h('button', {
			class: 'secondary',
			title,
			onclick: () => {
				flushSave();
				api.postMessage({ type: 'preview', key: e.key, messages: state.messages });
			},
			text: label,
		});
	}

	// ---- previews ----------------------------------------------------------

	function renderPreview(e) {
		const body = $('previewBody');
		if (!body) return;
		let view;
		if (e.group === 'settings') view = settingPreview(e);
		else if (e.group === 'commands') view = commandPreview(e);
		else if (e.group === 'terminal') view = terminalPreview(e);
		else if (state.catalog.messages[e.key]) view = notificationPreview(e);
		else view = h('p', { class: 'hint', text: 'No preview for this string.' });
		body.replaceChildren(view);
	}

	/** Text for `key`, marked when it falls back to English. */
	function textOf(key, current) {
		return h('span', {
			class: [translated(key) ? '' : 'fallback', key === current ? 'hl' : ''].join(' ').trim() || null,
			title: translated(key) ? null : 'Not translated yet, so it shows in English',
			text: lookup(key),
		});
	}

	function markdownOf(key, current) {
		const span = h('span', { class: [translated(key) ? '' : 'fallback', key === current ? 'hl' : ''].join(' ').trim() || null });
		const paragraphs = lookup(key).split(/\n{2,}/);
		paragraphs.forEach((p, i) => {
			const block = h('span', { class: 'md-p' });
			inlineMarkdown(p, block);
			span.append(block);
			if (i < paragraphs.length - 1) span.append(h('br'), h('br'));
		});
		return span;
	}

	function inlineMarkdown(text, into) {
		const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
		let last = 0;
		let match;
		while ((match = re.exec(text)) !== null) {
			into.append(text.slice(last, match.index));
			if (match[1] !== undefined) into.append(h('a', { class: 'mock-link', title: match[2], text: match[1] }));
			else if (match[3] !== undefined) into.append(h('code', { text: match[3] }));
			else into.append(h('strong', { text: match[4] }));
			last = match.index + match[0].length;
		}
		into.append(text.slice(last));
	}

	function linkified(text) {
		const span = h('span');
		const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
		let last = 0;
		let match;
		while ((match = re.exec(text)) !== null) {
			span.append(text.slice(last, match.index), h('a', { class: 'mock-link', title: match[2], text: match[1] }));
			last = match.index + match[0].length;
		}
		span.append(text.slice(last));
		return span;
	}

	function settingPreview(e) {
		const s = state.catalog.settings[e.setting];
		const desc = (key) => (byKey[key] && byKey[key].markdown ? markdownOf(key, e.key) : textOf(key, e.key));
		const item = h('div', { class: 'mock-settings' },
			h('div', { class: 's-item' },
				h('div', { class: 's-title' },
					h('span', { class: 's-cat', text: `${s.category}: ` }),
					h('span', { class: 's-name', text: s.name })),
				s.deprecationKey ? h('div', { class: 's-deprecation' }, h('span', { class: 'icon warn', text: '⚠ ' }), desc(s.deprecationKey)) : null,
				s.type === 'boolean'
					? h('div', { class: 's-bool' }, h('span', { class: `s-check${s.default ? ' on' : ''}`, text: s.default ? '✓' : '' }), s.descriptionKey ? h('span', { class: 's-desc' }, desc(s.descriptionKey)) : null)
					: s.descriptionKey ? h('div', { class: 's-desc' }, desc(s.descriptionKey)) : null,
				s.type === 'boolean' ? null : settingControl(s, e)));
		return item;
	}

	function settingControl(s, e) {
		if (s.enum) {
			const open = e.field === 'enum';
			const index = open ? e.enumIndex : Math.max(0, s.enum.indexOf(s.default));
			return h('div', { class: 's-enum' },
				h('div', { class: `s-select${open ? ' open' : ''}` }, h('span', { text: String(s.enum[index]) }), h('span', { class: 'chev', text: '⌄' })),
				open ? h('div', { class: 's-dropdown' },
					enumWindow(s.enum.length, index).map(i => (i === null
						? h('div', { class: 's-opt more', text: '⋯' })
						: h('div', { class: `s-opt${i === index ? ' active' : ''}`, text: String(s.enum[i]) }))),
					s.enumDescriptionKeys[index] ? h('div', { class: 's-dd-desc' }, textOf(s.enumDescriptionKeys[index], e.key)) : null) : null);
		}
		if (s.type === 'array' || s.type === 'object') return h('div', { class: 's-json', text: 'Edit in settings.json' });
		return h('div', { class: 's-input', text: s.default === undefined || s.default === null ? '' : String(s.default) });
	}

	/** Indexes of the options to draw around `index`, with null for a gap. */
	function enumWindow(count, index) {
		const span = 3;
		const from = Math.max(0, Math.min(index - span, count - 2 * span - 1));
		const to = Math.min(count - 1, from + 2 * span);
		const indexes = [];
		if (from > 0) indexes.push(null);
		for (let i = from; i <= to; i++) indexes.push(i);
		if (to < count - 1) indexes.push(null);
		return indexes;
	}

	function commandPreview(e) {
		return h('div', { class: 'mock-palette' },
			h('div', { class: 'qi-input' }, h('span', { text: '>' }), h('span', { class: 'caret' })),
			h('div', { class: 'qi-list' },
				state.catalog.commands.map(c => h('div', { class: `qi-row${c.titleKey === e.key ? ' active' : ''}` },
					c.category ? `${c.category}: ` : null,
					textOf(c.titleKey, e.key)))));
	}

	function terminalPreview(e) {
		return h('div', { class: 'mock-terminal' },
			h('div', { class: 'term-tabs' },
				h('span', { class: 'term-tab' }, h('span', { class: 'term-icon', text: '>_ ' }), textOf('terminal.elevationTitle', e.key))),
			h('div', { class: 'term-body' },
				textOf('terminal.elevationPrompt', e.key),
				'\n\n[sudo] password for you: ',
				h('span', { class: 'term-cursor' })));
	}

	const ICONS = { info: 'ⓘ', warning: '⚠', error: '⊗', progress: '⟳' };

	function segments(list, current) {
		return list.map((s) => {
			if (s.fixed) return h('span', { class: 'fixed', title: 'Added by the extension, in English' }, linkified(s.text));
			const span = h('span', {
				class: [translated(s.key) ? '' : 'fallback', s.key === current ? 'hl' : ''].join(' ').trim() || null,
				title: translated(s.key) ? null : 'Not translated yet, so it shows in English',
			}, linkified(s.text));
			return span;
		});
	}

	function notificationPreview(e) {
		const meta = state.catalog.messages;
		if (meta[e.key].kind === 'progress') {
			return h('div', { class: 'mock-toasts' },
				h('div', { class: 'mock-toast' },
					h('div', { class: 't-row' }, h('span', { class: 't-icon info', text: ICONS.info }), h('div', { class: 't-msg' }, textOf(e.key, e.key))),
					h('div', { class: 't-progress' }, h('span'))));
		}
		const n = R.composeNotification(meta, e.key, lookup);
		const buttons = n.buttons.map((b, i) => h('span', {
			class: `m-button${i === 0 ? ' primary' : ''}${b.fixed ? ' fixed' : ''}${b.key === e.key ? ' hl' : ''}${b.key && !translated(b.key) ? ' fallback' : ''}`,
			title: b.fixed ? 'Added by the extension, in English' : null,
			text: b.text,
		}));
		const message = h('div', { class: 't-msg' }, segments(n.message, e.key));

		if (n.modal) {
			return h('div', { class: 'mock-dialog-backdrop' },
				h('div', { class: 'mock-dialog' },
					h('div', { class: `m-icon ${n.kind}`, text: ICONS[n.kind] }),
					h('div', { class: 'm-text' },
						h('div', { class: 'm-title' }, segments(n.message, e.key)),
						n.detail ? h('div', { class: 'm-detail' }, segments(n.detail, e.key)) : null),
					h('div', { class: 'm-buttons' }, buttons, h('span', { class: 'm-button builtin', title: 'VS Code adds this button in its own language', text: 'Cancel' }))));
		}
		return h('div', { class: 'mock-toasts' },
			h('div', { class: 'mock-toast' },
				h('div', { class: 't-row' }, h('span', { class: `t-icon ${n.kind}`, text: ICONS[n.kind] }), message),
				h('div', { class: 't-foot' },
					h('span', { class: 't-source', text: 'Source: Vibrancy Continued' }),
					h('div', { class: 't-buttons' }, buttons))));
	}

	// ---- welcome and footer ------------------------------------------------

	function welcome() {
		const have = new Set(state.locales.map(l => l.code));
		const english = (code) => languageName(code, 'en');
		const options = state.languages.filter(code => !have.has(code))
			.sort((a, b) => english(a).localeCompare(english(b)));
		const display = options.includes(state.displayLanguage) ? state.displayLanguage : null;

		const select = h('select', { id: 'newLocale', 'aria-label': 'Language to add' },
			h('option', { value: '', text: 'Choose a language…', selected: !display, disabled: true }),
			display ? h('optgroup', { label: 'Your VS Code language' },
				h('option', { value: display, selected: true, text: `${bothNames(display)} (${display})` })) : null,
			h('optgroup', { label: 'All languages' },
				options.map(code => h('option', { value: code, text: `${bothNames(code)} (${code})` }))),
			h('option', { value: '__other', text: 'Another language code…' }));

		const other = h('input', { id: 'otherLocale', type: 'text', placeholder: 'e.g. de-at', 'aria-label': 'Language code', autocomplete: 'off', spellcheck: 'false', hidden: true });
		const otherName = h('span', { class: 'hint' });
		const start = h('button', { text: 'Start', disabled: !display });
		const valid = (v) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(v) && v !== 'en';
		const chosen = () => (select.value === '__other' ? other.value.trim().toLowerCase().replace(/_/g, '-') : select.value);
		const refresh = () => {
			other.hidden = select.value !== '__other';
			const code = chosen();
			start.disabled = !valid(code);
			otherName.textContent = select.value === '__other' && valid(code) ? bothNames(code) : '';
		};
		const go = () => {
			if (valid(chosen())) api.postMessage({ type: 'selectLocale', code: chosen() });
		};
		select.addEventListener('change', () => {
			refresh();
			if (!other.hidden) other.focus();
		});
		other.addEventListener('input', refresh);
		other.addEventListener('keydown', (event) => { if (event.key === 'Enter') go(); });
		start.addEventListener('click', go);

		const existing = state.locales.map(l => h('button', {
			class: 'secondary',
			onclick: () => api.postMessage({ type: 'selectLocale', code: l.code }),
			text: `${bothNames(l.code)}${l.draft ? ' (your draft)' : ''}`,
		}));

		return h('div', { class: 'welcome' },
			h('h1', { text: 'Translate Vibrancy into your language' }),
			h('p', { text: 'Every string Vibrancy shows is listed on the left with where it appears. Type a translation and the preview below it updates as you type. Buttons next to the preview show the real notification, dialog, terminal or Command Palette with your text.' }),
			h('p', { text: state.mode === 'repo'
				? `You're working in a clone of the repository (${state.repoRoot}), so your changes are written to its package.nls.<code>.json files, ready to commit.`
				: 'Your work is saved on this computer as you type, and kept across Vibrancy updates. When you\'re done, Send to Vibrancy copies the file and opens a GitHub issue for it, or Save a Copy writes it anywhere.' }),
			existing.length ? h('h2', { text: 'Improve a translation' }) : null,
			existing.length ? h('div', { class: 'button-row' }, existing) : null,
			h('h2', { text: 'Add a language' }),
			h('div', { class: 'new-locale' }, select, other, start, otherName),
			h('p', { class: 'hint', text: 'Write from the English text, the way your language is used in your region.' }));
	}

	function renderFooter() {
		const footer = $('footer');
		footer.replaceChildren();
		if (!state.locale) return;
		const where = state.mode === 'repo' ? 'Saving to' : state.hasDraft ? 'Draft saved at' : state.released ? 'Starting from the released translation. Your draft will be saved at' : 'Your draft will be saved at';
		const toggle = h('input', { type: 'checkbox', id: 'useDraft', checked: state.useDraft });
		toggle.addEventListener('change', () => api.postMessage({ type: 'setUseDraft', on: toggle.checked }));
		footer.append(
			h('span', { class: 'path' }, `${where} `, h('code', { text: state.target || '' })),
			state.hasDraft || state.mode === 'repo' ? h('button', { class: 'link', onclick: () => api.postMessage({ type: 'reveal', locale: state.locale }), text: isMac ? 'Reveal in Finder' : 'Show in folder' }) : null,
			state.hasDraft ? h('button', { class: 'link', onclick: () => api.postMessage({ type: 'discard', locale: state.locale, languageName: bothNames(state.locale) }), text: 'Discard draft' }) : null,
			h('span', { class: 'spacer' }),
			h('label', { class: 'toggle', title: 'Vibrancy\'s real notifications use this translation while it is on, so you can check it where it appears. Setting descriptions and command names keep the installed text.' },
				toggle, ' Use for Vibrancy\'s notifications'));
	}

	// ---- top bar and keys --------------------------------------------------

	$('saveCopy').addEventListener('click', () => {
		flushSave();
		api.postMessage({ type: 'saveCopy', locale: state.locale, messages: state.messages });
	});
	$('submit').addEventListener('click', () => {
		flushSave();
		api.postMessage({ type: 'submit', locale: state.locale, messages: state.messages, languageName: languageName(state.locale, 'en') });
	});

	document.addEventListener('keydown', (event) => {
		if (!state.locale || !event.altKey || event.metaKey || event.ctrlKey) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			move(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			move(-1);
		}
	});

	api.postMessage({ type: 'ready' });
})();
