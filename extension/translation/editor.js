// The translation editor: a webview panel that lists every string with where
// it appears, previews it in a copy of its real surroundings as you type, and
// can show the real VS Code notification, dialog, terminal or Command Palette
// with your text. Loaded only when opened (or when the draft setting is on).
const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DraftStore, findRepo, normalizeLocale, fileName } = require('./draft-store');
const { buildCatalog } = require('./catalog');
const rules = require('./rules');
const languages = require('./languages');

const SECTION = 'vscode_vibrancy';
const DRAFT_SETTING = 'useTranslationDraft';
const LOCALE_STATE = 'translation.locale';
const ISSUE_URL = 'https://github.com/illixion/vscode-vibrancy-continued/issues/new?template=translation.yml';

let current = null;

function createStore(context) {
	const folders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
	return new DraftStore({
		extensionRoot: context.extensionPath,
		storageDir: context.globalStorageUri.fsPath,
		repoRoot: findRepo(folders),
	});
}

function draftSettingOn() {
	return vscode.workspace.getConfiguration(SECTION).get(DRAFT_SETTING) === true;
}

/**
 * Points localize at the translator's draft while the setting is on, so
 * Vibrancy's real notifications show it. Manifest strings (setting
 * descriptions, command names) can't follow: VS Code reads those itself.
 */
function applyDraftOverride(context, localize) {
	const locale = context.globalState.get(LOCALE_STATE);
	if (!draftSettingOn() || !locale) {
		localize.setOverride(null);
		return;
	}
	try {
		localize.setOverride(createStore(context).load(locale).messages);
	} catch (error) {
		console.warn('Vibrancy: could not load the translation draft:', error);
		localize.setOverride(null);
	}
}

function open(context, localize) {
	if (current) {
		current.panel.reveal();
		return;
	}

	const store = createStore(context);
	const catalog = buildCatalog(store.sourceRoot);
	const english = catalog.english;
	const root = vscode.Uri.file(path.join(context.extensionPath, 'extension', 'translation'));
	const panel = vscode.window.createWebviewPanel(
		'vibrancyTranslate',
		'Translate Vibrancy',
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [root] },
	);
	panel.webview.html = pageHtml(panel.webview, root);

	const disposables = [];
	current = { panel };
	const send = (message) => panel.webview.postMessage(message);

	function sendLocale(code) {
		const loaded = code ? store.load(code) : null;
		send({
			type: 'locale',
			locale: code || null,
			messages: loaded ? loaded.messages : {},
			source: loaded ? loaded.source : null,
			target: code ? store.target(code) : null,
			released: !!(code && store.released(code)),
			hasDraft: !!(code && store.hasDraft(code)),
			locales: store.locales(),
		});
	}

	const lookupIn = (messages) => (key) => (rules.isTranslated(messages[key]) ? messages[key] : english[key]);

	async function nativePreview(key, messages) {
		const entry = catalog.entries.find(e => e.key === key);
		if (!entry) return;
		const lookup = lookupIn(messages);

		if (entry.group === 'settings') {
			await vscode.commands.executeCommand('workbench.action.openSettings', entry.setting);
		} else if (entry.group === 'commands') {
			const pick = vscode.window.createQuickPick();
			pick.placeholder = 'Preview of the Command Palette with your translation. Nothing runs.';
			pick.items = catalog.commands.map(c => ({ label: lookup(c.titleKey), key: c.titleKey }));
			pick.activeItems = pick.items.filter(item => item.key === key);
			pick.onDidAccept(() => pick.hide());
			pick.onDidHide(() => pick.dispose());
			pick.show();
		} else if (entry.group === 'terminal') {
			const write = new vscode.EventEmitter();
			const close = new vscode.EventEmitter();
			const text = lookup('terminal.elevationPrompt').replace(/\r?\n/g, '\r\n');
			const terminal = vscode.window.createTerminal({
				name: lookup('terminal.elevationTitle'),
				pty: {
					onDidWrite: write.event,
					onDidClose: close.event,
					open: () => write.fire(`${text}\r\n\r\n[sudo] password for you: \r\n\r\n\x1b[2m(Preview from the translation editor. Press any key to close.)\x1b[0m`),
					close: () => {},
					handleInput: () => close.fire(),
				},
			});
			terminal.show();
		} else if (catalog.messages[key] && catalog.messages[key].kind === 'progress') {
			vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: lookup(key) },
				() => new Promise(resolve => setTimeout(resolve, 5000)),
			);
		} else if (catalog.messages[key]) {
			const n = rules.composeNotification(catalog.messages, key, lookup);
			const show = {
				info: vscode.window.showInformationMessage,
				warning: vscode.window.showWarningMessage,
				error: vscode.window.showErrorMessage,
			}[n.kind] || vscode.window.showInformationMessage;
			const options = n.modal ? { modal: true, detail: n.detail ? rules.segmentsText(n.detail) : undefined } : {};
			show(rules.segmentsText(n.message), options, ...n.buttons.map(b => b.text));
		}
	}

	async function handle(message) {
		switch (message.type) {
			case 'ready': {
				send({
					type: 'init',
					catalog,
					languages,
					mode: store.mode,
					repoRoot: store.repoRoot,
					displayLanguage: vscode.env.language,
					useDraft: draftSettingOn(),
				});
				sendLocale(context.globalState.get(LOCALE_STATE) || null);
				break;
			}
			case 'selectLocale': {
				const code = normalizeLocale(message.code);
				if (!code) {
					send({ type: 'error', message: `"${message.code}" isn't a language code VS Code uses. Codes look like de, ko or zh-tw.` });
					return;
				}
				await context.globalState.update(LOCALE_STATE, code);
				sendLocale(code);
				if (draftSettingOn()) applyDraftOverride(context, localize);
				break;
			}
			case 'save': {
				const code = normalizeLocale(message.locale);
				if (!code) return;
				try {
					const file = store.save(code, message.messages || {});
					send({ type: 'saved', locale: code, path: file, locales: store.locales(), hasDraft: store.hasDraft(code) });
					if (draftSettingOn() && context.globalState.get(LOCALE_STATE) === code) localize.setOverride(message.messages);
				} catch (error) {
					send({ type: 'error', message: `Couldn't save: ${error.message}` });
				}
				break;
			}
			case 'preview':
				await nativePreview(message.key, message.messages || {});
				break;
			case 'saveCopy': {
				const code = normalizeLocale(message.locale);
				if (!code) return;
				const uri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(path.join(os.homedir(), fileName(code))),
					filters: { JSON: ['json'] },
				});
				if (uri) fs.writeFileSync(uri.fsPath, rules.serialize(english, message.messages || {}));
				break;
			}
			case 'submit': {
				const code = normalizeLocale(message.locale);
				if (!code) return;
				await vscode.env.clipboard.writeText(rules.serialize(english, message.messages || {}));
				const title = encodeURIComponent(`[Translation]: ${message.languageName || code} (${code})`);
				await vscode.env.openExternal(vscode.Uri.parse(`${ISSUE_URL}&title=${title}`));
				vscode.window.showInformationMessage(`Your ${fileName(code)} is copied. Paste it into the issue, or attach the file from Save a Copy.`);
				break;
			}
			case 'reveal': {
				const code = normalizeLocale(message.locale);
				if (code && fs.existsSync(store.target(code))) {
					await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.target(code)));
				}
				break;
			}
			case 'discard': {
				const code = normalizeLocale(message.locale);
				if (!code) return;
				const discard = 'Discard Draft';
				const choice = await vscode.window.showWarningMessage(
					`Discard your draft for ${message.languageName || code}?`,
					{ modal: true, detail: store.released(code) ? 'The language starts again from the translation released with Vibrancy.' : 'The language starts again empty.' },
					discard,
				);
				if (choice !== discard) return;
				store.discard(code);
				sendLocale(code);
				if (draftSettingOn()) applyDraftOverride(context, localize);
				break;
			}
			case 'setUseDraft':
				await vscode.workspace.getConfiguration(SECTION).update(DRAFT_SETTING, !!message.on, vscode.ConfigurationTarget.Global);
				break;
		}
	}

	disposables.push(panel.webview.onDidReceiveMessage((message) => {
		handle(message).catch((error) => send({ type: 'error', message: String(error && error.message || error) }));
	}));
	disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(`${SECTION}.${DRAFT_SETTING}`)) send({ type: 'useDraft', on: draftSettingOn() });
	}));
	panel.onDidDispose(() => {
		current = null;
		disposables.forEach(d => d.dispose());
	});
}

function pageHtml(webview, root) {
	const nonce = crypto.randomBytes(16).toString('base64');
	const uri = (...parts) => webview.asWebviewUri(vscode.Uri.joinPath(root, ...parts));
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('webview', 'editor.css')}">
<title>Translate Vibrancy</title>
</head>
<body>
<header class="topbar">
	<div class="brand">Translate Vibrancy</div>
	<label class="locale-picker">Language
		<select id="locale"></select>
	</label>
	<div class="progress" id="progress" hidden>
		<div class="bar"><span id="bar"></span></div>
		<span id="progressText"></span>
	</div>
	<div class="spacer"></div>
	<span class="save-state" id="saveState" aria-live="polite"></span>
	<button class="secondary" id="saveCopy" disabled>Save a Copy…</button>
	<button id="submit" disabled title="Copies the file and opens a GitHub issue to send it">Send to Vibrancy…</button>
</header>
<div class="banner" id="banner" role="alert" hidden></div>
<div class="layout">
	<nav class="sidebar" aria-label="Strings">
		<div class="filters">
			<input type="search" id="search" placeholder="Search English or your text" aria-label="Search">
			<div class="chips" role="group" aria-label="Show">
				<button class="chip" data-filter="all">All</button>
				<button class="chip" data-filter="todo">To do <span class="count" id="countTodo"></span></button>
				<button class="chip" data-filter="problems">Problems <span class="count" id="countProblems"></span></button>
			</div>
		</div>
		<div class="list" id="list"></div>
	</nav>
	<main class="detail" id="detail"></main>
</div>
<footer class="footer" id="footer"></footer>
<script nonce="${nonce}" src="${uri('rules.js')}"></script>
<script nonce="${nonce}" src="${uri('webview', 'editor.js')}"></script>
</body>
</html>`;
}

module.exports = { open, applyDraftOverride, DRAFT_SETTING };
