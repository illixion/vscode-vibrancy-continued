const path = require('path');
const arch = process.arch; // 'x64', 'arm64', etc.

try {
    const addonPath = path.resolve(
        __dirname,
        `./vibrancy-${arch}.node`
    );
    const addon = require(addonPath);
    module.exports = addon;
} catch (err) {
    throw new Error(
        `Failed to load displayconfig for arch ${arch}. Error: ${err.message}`
    );
}