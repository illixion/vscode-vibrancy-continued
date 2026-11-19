var vscode = require('vscode');
var path = require('path');
const { loadMessages, pickLocale } = require('./locales');

const i18nMessages = loadMessages(path.join(__dirname, '..'));
const locale = pickLocale(vscode.env.language, Object.keys(i18nMessages));
const localize = (info) => {
	if (info in i18nMessages[locale]) {
		return i18nMessages[locale][info]
	} else {
		return i18nMessages.en[info]
	}
}

module.exports = localize;
