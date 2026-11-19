#!/usr/bin/env node
// Checks every package.nls.<locale>.json against package.nls.json (English).
//
//   node scripts/check-i18n.js            report problems, exit 1 on errors
//   node scripts/check-i18n.js --strict   untranslated keys are errors too
//
// Errors:   a file that isn't valid JSON, keys English doesn't have, empty
//           values, and {0}/{1} placeholders that differ from English.
// Warnings: keys not translated yet. They fall back to English at runtime, so
//           a new English string never breaks a translation until it is done.
const fs = require('fs');
const path = require('path');
const { FILE_PATTERN } = require('../extension/locales');

const META_KEYS = new Set(['$schema']);

function placeholders(text) {
	return (String(text).match(/\{\d+\}/g) || []).sort().join(' ');
}

function checkLocales(dir) {
	const english = JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8'));
	const englishKeys = Object.keys(english).filter(k => !META_KEYS.has(k));
	const results = [];

	for (const name of fs.readdirSync(dir).sort()) {
		const match = FILE_PATTERN.exec(name);
		if (!match) continue;
		const result = { file: name, locale: match[1], errors: [], missing: [] };
		results.push(result);

		let messages;
		try {
			messages = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
		} catch (e) {
			result.errors.push(`not valid JSON: ${e.message}`);
			continue;
		}

		for (const key of Object.keys(messages)) {
			if (META_KEYS.has(key)) continue;
			if (!(key in english)) result.errors.push(`"${key}" is not an English key (renamed or removed?)`);
		}
		for (const key of englishKeys) {
			if (!(key in messages)) {
				result.missing.push(key);
				continue;
			}
			const value = messages[key];
			if (typeof value !== 'string' || value.trim() === '') {
				result.errors.push(`"${key}" is empty (delete the line to use the English text)`);
			} else if (placeholders(value) !== placeholders(english[key])) {
				result.errors.push(`"${key}" must contain the same placeholders as English: ${placeholders(english[key]) || 'none'}`);
			}
		}
	}
	return { results, total: englishKeys.length };
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
module.exports = { checkLocales, placeholders };
