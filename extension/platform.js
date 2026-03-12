let os = 'unknown';
if (/^win/.test(process.platform)) {
	if (require('os').release().split(".").map(Number)[0] === 10) {
		os = 'win10';
	}
}
if (process.platform === 'darwin') {
	os = 'macos';
}
if (process.platform === 'linux') {
	os = 'linux';
}

module.exports = os;