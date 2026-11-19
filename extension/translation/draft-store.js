// Where the translation editor reads and writes a language. No `vscode`
// dependency, so it can be tested and used at activation cheaply.
//
// Two modes:
// - Repo: the open workspace is a clone of this extension. The editor edits
//   package.nls.<locale>.json in it directly, ready to commit.
// - Draft: anyone else, e.g. the Marketplace install. Drafts live in the
//   extension's global storage, starting from the released translation, and
//   survive extension updates. They leave as a file or an issue.
const fs = require('fs');
const path = require('path');
const { FILE_PATTERN } = require('../locales');
const { serialize } = require('./rules');

const REPO_NAME = 'vscode-vibrancy-continued';
const LOCALE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

function fileName(locale) {
	return `package.nls.${locale}.json`;
}

function readJSON(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		return null;
	}
}

function localesIn(dir) {
	try {
		return fs.readdirSync(dir)
			.map(name => FILE_PATTERN.exec(name))
			.filter(Boolean)
			.map(match => match[1].toLowerCase());
	} catch (e) {
		return [];
	}
}

/** The first folder that is a clone of this extension, or null. */
function findRepo(folders) {
	for (const folder of folders || []) {
		const pkg = readJSON(path.join(folder, 'package.json'));
		if (pkg && pkg.name === REPO_NAME && fs.existsSync(path.join(folder, 'package.nls.json'))) return folder;
	}
	return null;
}

/** A VS Code locale code, lower-cased, or null if it can't be one. */
function normalizeLocale(code) {
	const value = String(code || '').trim().toLowerCase().replace(/_/g, '-');
	return LOCALE_CODE.test(value) && value !== 'en' ? value : null;
}

class DraftStore {
	/**
	 * @param {{ extensionRoot: string, storageDir: string, repoRoot?: string | null }} options
	 */
	constructor({ extensionRoot, storageDir, repoRoot }) {
		this.extensionRoot = extensionRoot;
		this.draftDir = path.join(storageDir, 'translations');
		this.repoRoot = repoRoot || null;
	}

	get mode() {
		return this.repoRoot ? 'repo' : 'draft';
	}

	/** The folder whose package.json and English strings the editor works from. */
	get sourceRoot() {
		return this.repoRoot || this.extensionRoot;
	}

	english() {
		return readJSON(path.join(this.sourceRoot, 'package.nls.json')) || {};
	}

	/** Where saving `locale` writes. */
	target(locale) {
		return path.join(this.repoRoot || this.draftDir, fileName(locale));
	}

	/** The translation shipped with the running extension, or null. */
	released(locale) {
		return readJSON(path.join(this.extensionRoot, fileName(locale)));
	}

	hasDraft(locale) {
		return !this.repoRoot && fs.existsSync(this.target(locale));
	}

	/**
	 * The strings to start editing from, and where they came from:
	 * 'repo', 'draft', 'released' or 'new'.
	 */
	load(locale) {
		const own = readJSON(this.target(locale));
		if (own) return { messages: own, source: this.mode };
		const released = this.repoRoot ? null : this.released(locale);
		if (released) return { messages: released, source: 'released' };
		return { messages: {}, source: 'new' };
	}

	/** Writes the translation; returns the path. */
	save(locale, messages) {
		const file = this.target(locale);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, serialize(this.english(), messages));
		return file;
	}

	/** Forgets a draft, so the language starts again from the released one. */
	discard(locale) {
		if (this.repoRoot) return;
		try {
			fs.unlinkSync(this.target(locale));
		} catch (e) {
			// nothing to discard
		}
	}

	/** Every language there is something for: [{ code, released, draft }]. */
	locales() {
		const released = new Set(localesIn(this.repoRoot || this.extensionRoot));
		const drafts = new Set(this.repoRoot ? [] : localesIn(this.draftDir));
		const codes = Array.from(new Set([...released, ...drafts])).sort();
		return codes.map(code => ({ code, released: released.has(code), draft: drafts.has(code) }));
	}
}

module.exports = { DraftStore, findRepo, normalizeLocale, fileName };
