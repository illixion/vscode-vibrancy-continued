// Sample VSCode main.js (1.95+ format, merged with electron main)
'use strict';

const perf = require('./vs/base/common/performance');
perf.mark('code/didStartMain');

const { app, BrowserWindow } = require('electron');

function createWindow(options) {
  const windowOptions = Object.assign({}, {experimentalDarkMode:true,width:1024,height:768}, options);
  return new BrowserWindow(windowOptions);
}

app.once('ready', function () {
  perf.mark('code/mainAppReady');
  createWindow();
});
