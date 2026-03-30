// Sample VSCode main.js (pre-1.95 format, separate from electron main)
'use strict';

const perf = require('./vs/base/common/performance');
perf.mark('code/didStartMain');

const { app } = require('electron');
app.once('ready', function () {
  perf.mark('code/mainAppReady');
});
