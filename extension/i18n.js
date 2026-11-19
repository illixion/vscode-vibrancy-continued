var vscode = require('vscode');
var path = require('path');
const { loadMessages, pickLocale } = require('./locales');

const i18nMessages = loadMessages(path.join(__dirname, '..'));
const locale = pickLocale(vscode.env.language, Object.keys(i18nMessages));

// A translator's draft from the translation editor, used instead of the
// built-in text while vscode_vibrancy.useTranslationDraft is on. Strings the
// draft doesn't have fall through to the built-in translation.
let override = null;

const localize = (info) => {
	if (override && typeof override[info] === 'string' && override[info].trim() !== '') {
		return override[info]
	} else if (info in i18nMessages[locale]) {
		return i18nMessages[locale][info]
	} else {
		return i18nMessages.en[info]
	}
}

/** @param {Record<string, string> | null} messages */
localize.setOverride = (messages) => {
	override = messages || null;
};

module.exports = localize;
