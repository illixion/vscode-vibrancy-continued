// Locale discovery for the extension's messages. Kept free of the `vscode`
// module so tests and scripts/check-i18n.js can use it.
//
// A language is added by dropping a `package.nls.<locale>.json` file next to
// `package.nls.json`; nothing here (or in i18n.js) needs editing. VS Code
// reads the same file for the manifest strings (command titles, setting
// descriptions), so one file covers both.
const fs = require('fs');
const path = require('path');

const FILE_PATTERN = /^package\.nls\.([A-Za-z0-9-]+)\.json$/;

// Locale code -> parsed messages, for every package.nls.<locale>.json in `dir`,
// plus 'en' from package.nls.json. Codes are lower-cased to match
// vscode.env.language. A file that doesn't parse is skipped, so one broken
// translation can't stop the extension from loading.
function loadMessages(dir) {
	const messages = {
		en: JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8')),
	};
	for (const name of fs.readdirSync(dir)) {
		const match = FILE_PATTERN.exec(name);
		if (!match) continue;
		try {
			messages[match[1].toLowerCase()] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
		} catch (e) {
			// fall back to English for this locale
		}
	}
	return messages;
}

// The best available locale for a VS Code display language: the exact code
// ('zh-tw'), else its base language ('pt-br' -> 'pt'), else English.
function pickLocale(language, available) {
	const code = String(language || 'en').toLowerCase();
	if (available.includes(code)) return code;
	const base = code.split('-')[0];
	if (available.includes(base)) return base;
	return 'en';
}

module.exports = { FILE_PATTERN, loadMessages, pickLocale };
