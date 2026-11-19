// Everything the translation editor needs to know about each string: where it
// appears and how to preview it. Settings and commands come from walking
// package.json for its "%key%" references, so their previews follow the
// manifest without upkeep; runtime strings come from messages-meta.js.
const fs = require('fs');
const path = require('path');
const messagesMeta = require('./messages-meta');
const { isMeta, placeholders } = require('./rules');

const GROUPS = [
	{ id: 'settings', label: 'Settings' },
	{ id: 'commands', label: 'Commands' },
	{ id: 'notifications', label: 'Notifications' },
	{ id: 'terminal', label: 'Terminal (Linux)' },
	{ id: 'other', label: 'Other' },
];

const NLS_REF = /^%(.+)%$/;

function nlsKey(value) {
	const match = typeof value === 'string' ? NLS_REF.exec(value) : null;
	return match ? match[1] : null;
}

// The Settings editor's label for a setting: 'vscode_vibrancy.enableAutoTheme'
// shows as "Vscode_vibrancy: Enable Auto Theme".
function settingLabel(id) {
	const parts = id.split('.');
	const name = parts.pop();
	const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
	const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map(capital).join(' ');
	return { category: parts.map(capital).join(' › '), name: words };
}

function configurationProperties(pkg) {
	const configuration = pkg.contributes && pkg.contributes.configuration;
	const sections = Array.isArray(configuration) ? configuration : configuration ? [configuration] : [];
	const properties = [];
	for (const section of sections) {
		for (const id of Object.keys(section.properties || {})) properties.push([id, section.properties[id]]);
	}
	return properties;
}

/**
 * @param {string} root  the extension's folder (package.json, package.nls.json)
 */
function buildCatalog(root) {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const english = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));

	const entries = [];
	const seen = new Set();
	// A key used in both a plain and a Markdown field is treated as plain.
	const plainUse = new Set();
	const markdownUse = new Set();

	function add(key, entry) {
		if (!key || !(key in english) || seen.has(key)) return;
		seen.add(key);
		entries.push(Object.assign({ key, english: english[key], placeholders: placeholders(english[key]) }, entry));
	}

	const settings = {};
	for (const [id, schema] of configurationProperties(pkg)) {
		const label = settingLabel(id);
		const setting = {
			id,
			category: label.category,
			name: label.name,
			type: Array.isArray(schema.type) ? schema.type[0] : schema.type,
			enum: schema.enum || null,
			default: schema.default,
			descriptionKey: nlsKey(schema.markdownDescription) || nlsKey(schema.description),
			enumDescriptionKeys: (schema.markdownEnumDescriptions || schema.enumDescriptions || []).map(nlsKey),
			deprecationKey: nlsKey(schema.markdownDeprecationMessage) || nlsKey(schema.deprecationMessage),
		};
		settings[id] = setting;

		for (const field of ['description', 'deprecationMessage']) {
			if (nlsKey(schema[field])) plainUse.add(nlsKey(schema[field]));
		}
		for (const field of ['markdownDescription', 'markdownDeprecationMessage']) {
			if (nlsKey(schema[field])) markdownUse.add(nlsKey(schema[field]));
		}
		(schema.enumDescriptions || []).forEach(v => nlsKey(v) && plainUse.add(nlsKey(v)));
		(schema.markdownEnumDescriptions || []).forEach(v => nlsKey(v) && markdownUse.add(nlsKey(v)));

		const title = `${label.name}`;
		add(setting.descriptionKey, {
			group: 'settings', setting: id, field: 'description', label: `${title}`,
			where: setting.type === 'boolean'
				? `The ${title} setting's description, shown next to its checkbox in Settings.`
				: `The ${title} setting's description in Settings.`,
		});
		setting.enumDescriptionKeys.forEach((key, i) => {
			const value = setting.enum ? setting.enum[i] : String(i);
			add(key, {
				group: 'settings', setting: id, field: 'enum', enumIndex: i, label: `${title}: ${value}`,
				where: `Describes the "${value}" choice in the ${title} setting's list. It appears under the list while that choice is highlighted.`,
			});
		});
		add(setting.deprecationKey, {
			group: 'settings', setting: id, field: 'deprecation', label: `${title} (deprecated)`,
			where: `The warning on the ${title} setting, which is no longer used.`,
		});
	}

	const commands = [];
	for (const command of (pkg.contributes && pkg.contributes.commands) || []) {
		const titleKey = nlsKey(command.title);
		commands.push({ id: command.command, titleKey, category: command.category || null });
		if (titleKey) plainUse.add(titleKey);
		add(titleKey, {
			group: 'commands', command: command.command, label: english[titleKey],
			where: `The "${english[titleKey]}" command, as listed in the Command Palette.`,
		});
	}

	for (const key of Object.keys(english)) {
		if (isMeta(key) || seen.has(key)) continue;
		const meta = messagesMeta[key];
		if (!meta) {
			add(key, { group: 'other', label: key, where: 'Not described yet.' });
			continue;
		}
		plainUse.add(key);
		const terminal = meta.kind === 'terminalTitle' || meta.kind === 'terminalText';
		add(key, {
			group: terminal ? 'terminal' : 'notifications',
			kind: meta.kind,
			label: meta.kind === 'terminalTitle' ? 'Terminal name' : meta.kind === 'terminalText' ? 'Text above the password prompt' : english[key],
			where: meta.where,
		});
	}

	for (const entry of entries) entry.markdown = markdownUse.has(entry.key) && !plainUse.has(entry.key);

	return {
		groups: GROUPS.filter(g => entries.some(e => e.group === g.id)),
		entries,
		english,
		settings,
		commands,
		messages: messagesMeta,
	};
}

/** Keys of strings shown as Markdown, for the checker. */
function markdownKeys(catalog) {
	return catalog.entries.filter(e => e.markdown).map(e => e.key);
}

module.exports = { buildCatalog, markdownKeys, settingLabel };
