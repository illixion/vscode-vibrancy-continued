/**
 * @type {{
 *  os: string,
 *  config: {
 *    type:  "auto" | "acrylic" | "under-window" | "fullscreen-ui" | "titlebar" | "selection" | "menu" | "popover" | "sidebar" | "content" | "header" | "hud" | "sheet" | "tooltip" | "under-page" | "window" | "appearance-based" | "dark" | "ultra-dark" | "light" | "medium-light",
 *    opacity: number,
 *    theme: "Default Dark" | "Dark (Only Subbar)" | "Default Light" | "Light (Only Subbar)" | "Tokyo Night Storm" | "Tokyo Night Storm (Outer)" | "Noir et blanc" | "Dark (Exclude Tab Line)" | "Solarized Dark+",
 *    imports: string[],
 *    refreshInterval: number,
 *    preventFlash: boolean
 *  },
 *  themeCSS: string,
 *  theme: any,
 *  imports: {
 *    css: string,
 *    js: string
 *  }
 * }}
 */
const app = global.vscode_vibrancy_plugin;
let backgroundColorTimer;
module.exports = (window) => ({
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
