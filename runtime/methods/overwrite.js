let overwritten
module.exports = window => ({
	install() {
		overwritten = window.setBackgroundColor
		const original = window.setBackgroundColor.bind(window)
		window.setBackgroundColor = (bg) => original('#00000000')
	},
	uninstall() {
		window.setBackgroundColor = overwritten
	}
})
