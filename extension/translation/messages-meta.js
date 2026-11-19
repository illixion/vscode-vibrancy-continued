// How the extension shows each runtime string (everything in package.nls.json
// that isn't referenced from package.json), so the translation editor can
// preview it as it really appears and fire the real notification on demand.
//
// Keep this in step with the call sites in extension/index.js and
// extension/vscode-settings.js. test/unit/translation.test.js fails when a
// runtime key has no entry here, or an entry names a key that doesn't exist.
//
// kind:        info | warning | error   a notification of that severity
//              progress                 a progress notification's title
//              button                   a button label; previewed on usedBy[0]
//              detail                   a modal's second line; previewed on usedBy[0]
//              terminalTitle | terminalText   the Linux password terminal
// modal:       shown as a dialog instead of a toast
// buttons:     keys of its translated button labels
// fixedButtons: button labels the code passes in English
// detail:      key of the modal's second line
// samples:     example values for its placeholders
// wrappedBy:   thrown as an error and shown after that message and "Error: "
// appended:    example of what the code appends after the text
// knownErrorsLink: the code also appends the English "Known Errors" link
// where:       when it appears, for the translator

const SAMPLE_APP = 'Visual Studio Code';

module.exports = {
	'messages.firstload': {
		kind: 'info',
		buttons: ['messages.installIde'],
		where: 'Shown once after Vibrancy is installed from the Marketplace, before it has changed anything.',
	},
	'messages.updateNeeded': {
		kind: 'info',
		buttons: ['messages.installIde'],
		where: 'Shown after the extension updates, when the editor still has the previous version\'s changes.',
	},
	'messages.configupdate': {
		kind: 'info',
		buttons: ['messages.reloadIde'],
		where: 'Shown when a Vibrancy setting is changed.',
	},
	'messages.windowSettingsChanged': {
		kind: 'info',
		buttons: ['messages.reloadIde'],
		where: 'macOS: shown at startup when the editor\'s window settings changed since Vibrancy was enabled.',
	},
	'messages.enabled': {
		kind: 'info',
		buttons: ['messages.restartIde'],
		where: 'Shown after Enable Vibrancy succeeds.',
	},
	'messages.disabled': {
		kind: 'info',
		buttons: ['messages.restartIde'],
		where: 'Shown after Disable Vibrancy succeeds.',
	},
	'messages.smthingwrong': {
		kind: 'error',
		appended: 'Error: EBUSY: resource busy or locked',
		knownErrorsLink: true,
		where: 'The start of the error shown when enabling, reloading or disabling fails. The error itself follows it.',
	},
	'messages.unsupported': {
		kind: 'info',
		where: 'Shown when enabling on an operating system Vibrancy doesn\'t support.',
	},
	'messages.unsupportedEditor': {
		kind: 'error',
		wrappedBy: 'messages.smthingwrong',
		where: 'Shown when enabling in an editor Vibrancy can\'t change, as the error in "Something went wrong".',
	},
	'messages.linuxFramedNoEffect': {
		kind: 'warning',
		where: 'Linux: shown after enabling with the window mode set to framed.',
	},
	'messages.forceFramelessUnsupportedEditor': {
		kind: 'error',
		wrappedBy: 'messages.smthingwrong',
		where: 'Shown when a frameless window is forced in an editor Vibrancy doesn\'t know, as the error in "Something went wrong".',
	},
	'messages.patchWontLoad': {
		kind: 'error',
		wrappedBy: 'messages.smthingwrong',
		samples: { '%1': 'main.js', '%2': 'SyntaxError: Unexpected token \'}\'' },
		where: 'Shown when Vibrancy refuses to enable because its change would stop a file loading. %1 is a file name, %2 the error.',
	},
	'messages.brokenBeforePatch': {
		kind: 'error',
		wrappedBy: 'messages.smthingwrong',
		samples: { '%1': 'main.js', '%2': 'SyntaxError: Unexpected token \'}\'' },
		where: 'Shown when Vibrancy refuses to enable because a file was already broken. %1 is a file name, %2 the error.',
	},
	'messages.editorWontStartRestorable': {
		kind: 'error',
		modal: true,
		buttons: ['messages.restartAnyway'],
		samples: { '%1': SAMPLE_APP, '%2': 'main.js', '%3': 'SyntaxError: Unexpected token \'}\'' },
		where: 'A dialog shown instead of the restart prompt when a file the editor needs no longer loads, and Vibrancy has a backup of it. %1 is the editor\'s name, %2 a file name, %3 the error.',
	},
	'messages.editorWontStartOther': {
		kind: 'error',
		modal: true,
		buttons: ['messages.restartAnyway'],
		samples: { '%1': SAMPLE_APP, '%2': 'product.json', '%3': 'Unexpected end of JSON input' },
		where: 'A dialog shown instead of the restart prompt when a file the editor needs no longer loads and something else changed it. %1 is the editor\'s name, %2 a file name, %3 the error.',
	},
	'messages.restartAnyway': {
		kind: 'button',
		usedBy: ['messages.editorWontStartRestorable', 'messages.editorWontStartOther'],
		where: 'A button on the dialog warning that the editor won\'t start.',
	},
	'messages.untestedEditor': {
		kind: 'warning',
		samples: { '%1': 'Cursor' },
		where: 'Shown when enabling in an editor that isn\'t on Vibrancy\'s tested list. %1 is the editor\'s name.',
	},
	'messages.admin': {
		kind: 'error',
		buttons: ['messages.retryElevated'],
		appended: 'Error: EACCES: permission denied, open \'/usr/share/code/resources/app/out/main.js\'',
		knownErrorsLink: true,
		where: 'Shown when the editor\'s files can\'t be written. The error follows it.',
	},
	'messages.recommendedColorTheme': {
		kind: 'info',
		buttons: ['messages.changeColorThemeIde', 'messages.noIde'],
		samples: { '%1': 'Default Light Modern', '%2': 'Default Dark Modern' },
		where: 'Shown when the color theme doesn\'t suit the chosen Vibrancy theme. %1 is the current color theme, %2 the recommended one.',
	},
	'messages.restartIde': {
		kind: 'button',
		usedBy: ['messages.enabled', 'messages.disabled'],
		where: 'A button after enabling or disabling Vibrancy.',
	},
	'messages.installIde': {
		kind: 'button',
		usedBy: ['messages.firstload', 'messages.updateNeeded'],
		where: 'A button on the welcome and update messages.',
	},
	'messages.reloadIde': {
		kind: 'button',
		usedBy: ['messages.configupdate', 'messages.windowSettingsChanged'],
		where: 'A button when settings changed.',
	},
	'messages.changeColorThemeIde': {
		kind: 'button',
		usedBy: ['messages.recommendedColorTheme'],
		where: 'A button on the color theme suggestion.',
	},
	'messages.noIde': {
		kind: 'button',
		usedBy: ['messages.recommendedColorTheme'],
		where: 'A button on the color theme suggestion, declining it.',
	},
	'messages.importError': {
		kind: 'warning',
		samples: { '%1': '/home/you/vibrancy.css' },
		where: 'Shown when a file listed in the Imports setting can\'t be read. %1 is its path.',
	},
	'messages.electronDeprecatedType': {
		kind: 'warning',
		fixedButtons: ['Default', 'Transparent'],
		samples: { '%1': 'sidebar' },
		where: 'macOS: shown when the Type setting uses a value this editor version no longer supports. %1 is that value.',
	},
	'messages.applyToAllProfiles': {
		kind: 'info',
		where: 'Shown once, when Vibrancy changes the setting that shares color customizations across profiles.',
	},
	'messages.elevationRequired': {
		kind: 'warning',
		buttons: ['messages.elevationYes', 'messages.elevationNo'],
		where: 'Shown before asking for administrator privileges.',
	},
	'messages.elevationYes': {
		kind: 'button',
		usedBy: ['messages.elevationRequired'],
		where: 'A button accepting the request for administrator privileges.',
	},
	'messages.elevationNo': {
		kind: 'button',
		usedBy: ['messages.elevationRequired'],
		where: 'A button declining the request for administrator privileges.',
	},
	'messages.retryElevated': {
		kind: 'button',
		usedBy: ['messages.admin'],
		where: 'A button on the error shown when the editor\'s files can\'t be written.',
	},
	'messages.elevationFailed': {
		kind: 'error',
		appended: 'Elevation failed: the request was dismissed',
		knownErrorsLink: true,
		where: 'Shown when getting administrator privileges fails. The error follows it.',
	},
	'messages.noElevationMethod': {
		kind: 'error',
		appended: '/usr/share/code',
		where: 'Linux: shown when neither pkexec nor sudo is available. The editor\'s folder follows it, completing the command.',
	},
	'terminal.elevationTitle': {
		kind: 'terminalTitle',
		where: 'Linux: the name of the terminal Vibrancy opens to ask for a password.',
	},
	'terminal.elevationPrompt': {
		kind: 'terminalText',
		where: 'Linux: printed in that terminal above the password prompt.',
	},
	'messages.snapImmutable': {
		kind: 'error',
		where: 'Linux: shown when the editor is installed as a Snap.',
	},
	'messages.noNewPrivs': {
		kind: 'error',
		where: 'Linux: shown when administrator privileges are blocked until the editor is restarted.',
	},
	'messages.immutableUnsupported': {
		kind: 'error',
		where: 'Linux: shown when the editor is on a read-only filesystem Vibrancy can\'t work around.',
	},
	'messages.nixMirrorProgress': {
		kind: 'progress',
		where: 'NixOS: shown while Vibrancy copies the editor to your home folder.',
	},
	'messages.nixRelaunchTitle': {
		kind: 'info',
		modal: true,
		detail: 'messages.nixRelaunch',
		where: 'NixOS: the heading of the dialog shown after enabling.',
	},
	'messages.nixRelaunch': {
		kind: 'detail',
		usedBy: ['messages.nixRelaunchTitle'],
		samples: { '%1': SAMPLE_APP },
		where: 'NixOS: the text of the dialog shown after enabling. %1 is the editor\'s name.',
	},
	'messages.nixStale': {
		kind: 'warning',
		buttons: ['messages.nixStaleReenable'],
		where: 'NixOS: shown when the editor was updated since Vibrancy copied it.',
	},
	'messages.nixStaleReenable': {
		kind: 'button',
		usedBy: ['messages.nixStale'],
		where: 'A button on the NixOS update message.',
	},
	'messages.profileMismatch': {
		kind: 'warning',
		modal: true,
		buttons: ['messages.profileMismatchDisableAnyway'],
		where: 'A dialog shown when disabling from a different profile than the one that enabled Vibrancy.',
	},
	'messages.profileMismatchDisableAnyway': {
		kind: 'button',
		usedBy: ['messages.profileMismatch'],
		where: 'A button on the profile dialog.',
	},
	'messages.profileTakeover': {
		kind: 'warning',
		where: 'Shown when enabling from a different profile than the one that enabled Vibrancy before.',
	},
	'messages.profileTip': {
		kind: 'info',
		samples: { '{0}': 'Work, Writing' },
		where: 'Shown once when you have more than one profile. {0} is a list of profile names.',
	},
	'messages.profileLeftovers': {
		kind: 'warning',
		samples: { '{0}': 'Work', '{1}': '3' },
		where: 'Shown when another profile still has Vibrancy\'s colors. {0} is a profile name, {1} a number.',
	},
	'messages.profileLeftoversUnreachable': {
		kind: 'warning',
		samples: { '{0}': 'Work', '{1}': '3' },
		where: 'Shown when another profile has Vibrancy\'s colors but can\'t remove them. {0} is a profile name, {1} a number.',
	},
};
