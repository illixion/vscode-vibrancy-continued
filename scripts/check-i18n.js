#!/usr/bin/env node
// Checks every package.nls.<locale>.json against package.nls.json (English).
//
//   node scripts/check-i18n.js            report problems, exit 1 on errors
//   node scripts/check-i18n.js --strict   untranslated keys are errors too
//
// Errors:   a file that isn't valid JSON, keys English doesn't have, empty
//           values, {0}/%1 placeholders or link targets that differ from
//           English, and backticks or ** where VS Code shows plain text.
// Warnings: keys not translated yet. They fall back to English at runtime, so
//           a new English string never breaks a translation until it is done.
//
// The rules live in extension/translation/rules.js, which the in-editor
// translation page uses too ("Vibrancy: Translate Vibrancy").
const fs = require('fs');
const path = require('path');
const { FILE_PATTERN } = require('../extension/locales');
const { checkFile, isMeta } = require('../extension/translation/rules');
const { buildCatalog, markdownKeys } = require('../extension/translation/catalog');

function checkLocales(dir) {
	const english = JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8'));
	const total = Object.keys(english).filter(k => !isMeta(k)).length;
	const markdown = markdownKeys(buildCatalog(dir));
	const results = [];

	for (const name of fs.readdirSync(dir).sort()) {
		const match = FILE_PATTERN.exec(name);
		if (!match) continue;
		let messages;
		try {
			messages = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
		} catch (e) {
			results.push({ file: name, locale: match[1], errors: [`not valid JSON: ${e.message}`], missing: [] });
			continue;
		}
		const { errors, missing } = checkFile(english, messages, markdown);
		results.push({ file: name, locale: match[1], errors, missing });
	}
	return { results, total };
}

function main() {
	const strict = process.argv.includes('--strict');
	const { results, total } = checkLocales(path.join(__dirname, '..'));
	let failed = false;
	for (const r of results) {
		const translated = total - r.missing.length;
		console.log(`${r.file}: ${translated}/${total} keys`);
		for (const e of r.errors) console.log(`  error: ${e}`);
		for (const k of r.missing) console.log(`  ${strict ? 'error' : 'untranslated'}: ${k}`);
		if (r.errors.length || (strict && r.missing.length)) failed = true;
	}
	process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { checkLocales };
