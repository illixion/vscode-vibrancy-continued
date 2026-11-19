// Translation rules shared by the translation editor (extension host and
// webview) and scripts/check-i18n.js, so the page and CI agree on what is a
// problem. No dependencies: the webview loads this file as a plain script.
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.VibrancyTranslationRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// Keys in a package.nls file that are not strings to translate.
	const META_KEYS = ['$schema'];
	const SCHEMA = './nls-schema.json';

	// The code fills these in at runtime: '%1' through String.replace, '{0}' the
	// same way. A translation must keep every one English has, in any order.
	const PLACEHOLDER = /%\d+|\{\d+\}/g;

	// Appended in English to several error messages by the code that shows them.
	const KNOWN_ERRORS_TAIL = '. Click here for more info: [Known Errors](https://github.com/illixion/vscode-vibrancy-continued/blob/main/docs/known-errors.md)';

	function isMeta(key) {
		return META_KEYS.indexOf(key) !== -1;
	}

	function isTranslated(value) {
		return typeof value === 'string' && value.trim() !== '';
	}

	/** Distinct placeholders in `text`, sorted. A placeholder used twice counts once. */
	function placeholders(text) {
		const found = String(text == null ? '' : text).match(PLACEHOLDER) || [];
		return found.filter((p, i) => found.indexOf(p) === i).sort();
	}

	/** Targets of Markdown links, '[text](target)', in `text`. */
	function linkTargets(text) {
		const targets = [];
		const re = /\]\(([^)\s]+)\)/g;
		let match;
		while ((match = re.exec(String(text))) !== null) targets.push(match[1]);
		return targets;
	}

	// Markdown that VS Code shows literally where a string is plain text: in a
	// setting's `description`, a command title or a notification. (Notification
	// links do render, so [text](url) is allowed.)
	const PLAIN_TEXT_MARKUP = /`|\*\*|__/;

	/**
	 * Problems with one translated string, as sentences for a translator.
	 * An empty translation has none: it just isn't translated yet.
	 * `options.markdown` is true where VS Code renders Markdown.
	 */
	function checkEntry(english, translation, options) {
		if (!isTranslated(translation)) return [];
		const problems = [];
		if (!(options && options.markdown) && PLAIN_TEXT_MARKUP.test(translation) && !PLAIN_TEXT_MARKUP.test(english)) {
			problems.push('VS Code shows this text as it is, so backticks and ** would appear literally. Leave them out.');
		}
		const expected = placeholders(english);
		const actual = placeholders(translation);
		const missing = expected.filter(p => actual.indexOf(p) === -1);
		const unknown = actual.filter(p => expected.indexOf(p) === -1);
		if (missing.length) {
			problems.push(`Missing ${missing.join(', ')}. The editor puts a value there when it shows the message, so the translation needs ${missing.length === 1 ? 'it' : 'them'} too.`);
		}
		if (unknown.length) {
			problems.push(`${unknown.join(', ')} ${unknown.length === 1 ? 'isn\'t a placeholder' : 'aren\'t placeholders'} in the English text, so ${unknown.length === 1 ? 'it' : 'they'} would show literally.`);
		}
		const lostLinks = linkTargets(english).filter(t => linkTargets(translation).indexOf(t) === -1);
		if (lostLinks.length) {
			problems.push(`Keep the link: [your text](${lostLinks[0]}). Only the text in square brackets is translated.`);
		}
		return problems;
	}

	/**
	 * Every problem in a translation file's contents, for the checker script.
	 * Untranslated keys are listed separately: they fall back to English.
	 */
	function checkFile(english, messages, markdownKeys) {
		const markdown = markdownKeys || [];
		const errors = [];
		const missing = [];
		for (const key of Object.keys(messages)) {
			if (isMeta(key)) continue;
			if (!(key in english)) errors.push(`"${key}" is not an English key (renamed or removed?)`);
		}
		for (const key of Object.keys(english)) {
			if (isMeta(key)) continue;
			if (!(key in messages)) {
				missing.push(key);
				continue;
			}
			const value = messages[key];
			if (!isTranslated(value)) {
				errors.push(`"${key}" is empty (delete the line to use the English text)`);
				continue;
			}
			const options = { markdown: markdown.indexOf(key) !== -1 };
			for (const problem of checkEntry(english[key], value, options)) errors.push(`"${key}": ${problem}`);
		}
		return { errors, missing };
	}

	/**
	 * A translation file's text: English key order, only translated strings,
	 * two-space indent and a final newline, like the files in the repo.
	 */
	function serialize(english, messages) {
		const out = { $schema: SCHEMA };
		for (const key of Object.keys(english)) {
			if (isMeta(key)) continue;
			if (isTranslated(messages[key])) out[key] = messages[key];
		}
		return JSON.stringify(out, null, 2) + '\n';
	}

	/** `text` with each placeholder replaced by its sample value. */
	function fillPlaceholders(text, samples) {
		let result = String(text);
		for (const p of Object.keys(samples || {})) result = result.split(p).join(samples[p]);
		return result;
	}

	/**
	 * What a notification looks like, given the string being previewed.
	 *
	 * `meta` maps each runtime key to how the extension shows it (see
	 * extension/translation/messages-meta.js). A button or a modal's detail
	 * is previewed as part of the message it belongs to. `lookup(key)` gives
	 * the text to show for a key: the translation, or English.
	 *
	 * Returns { kind, modal, message: [segments], detail: [segments] | null,
	 * buttons: [{ key, text }], highlight } where a segment is
	 * { text, key } for translated text or { text, fixed: true } for text the
	 * code adds in English.
	 */
	function composeNotification(meta, key, lookup) {
		let main = key;
		let highlight = 'message';
		if (meta[key].kind === 'button' || meta[key].kind === 'detail') {
			main = meta[key].usedBy[0];
			highlight = meta[key].kind === 'button' ? key : 'detail';
		}
		const m = meta[main];
		const own = (k) => ({ key: k, text: fillPlaceholders(lookup(k), meta[k] && meta[k].samples) });
		const fixed = (text) => ({ text, fixed: true });

		let message;
		if (m.wrappedBy) {
			// Thrown as an Error and caught by the generic failure message.
			message = [own(m.wrappedBy), fixed('Error: '), own(main), fixed(KNOWN_ERRORS_TAIL)];
		} else if (m.appended !== undefined) {
			// The code appends details (an error, a path) to this text.
			message = [own(main), fixed(m.appended)];
			if (m.knownErrorsLink) message.push(fixed(KNOWN_ERRORS_TAIL));
		} else {
			message = [own(main)];
		}
		return {
			kind: m.kind,
			modal: !!m.modal,
			message,
			detail: m.detail ? [own(m.detail)] : null,
			buttons: (m.buttons || []).map(b => ({ key: b, text: lookup(b) }))
				.concat((m.fixedButtons || []).map(text => ({ text, fixed: true }))),
			highlight,
			main,
		};
	}

	function segmentsText(segments) {
		return segments.map(s => s.text).join('');
	}

	return {
		META_KEYS,
		SCHEMA,
		KNOWN_ERRORS_TAIL,
		isMeta,
		isTranslated,
		placeholders,
		checkEntry,
		checkFile,
		serialize,
		fillPlaceholders,
		composeNotification,
		segmentsText,
	};
});
