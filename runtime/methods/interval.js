let backgroundColorTimer;
module.exports = window => ({
	install() {
		clearInterval(backgroundColorTimer);
		// https://github.com/microsoft/vscode/blob/9f8431f7fccf7a048531043eb6b6d24819482781/src/vs/platform/theme/electron-main/themeMainService.ts#L80
		backgroundColorTimer = setInterval(() => {
			window.setBackgroundColor('#00000000');
		}, app.config.refreshInterval);
	},
	uninstall() {
		clearInterval(backgroundColorTimer);
	}
})
