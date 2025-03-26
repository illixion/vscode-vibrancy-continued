// This script will alert the user on uninstalling Vibrancy without prior cleanup
// TODO: investigate if we can perform all cleanup steps here including VSCode settings update

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

(async () => {
    const envPaths = (await import('env-paths')).default;
    const paths = envPaths('vscode-vibrancy');
    const activeFlagPath = path.join(paths.config, 'active');
    
    function isActive() {
        return fs.existsSync(activeFlagPath);
    }
    
    function showWarning(message) {
        // Escape quotes for macOS/Linux
        const escapedMessageUnix = message.replace(/"/g, '\\"');
    
        if (process.platform === 'win32') {
            // Use VBScript to generate the alert
            // PowerShell wasn't used as VSCode terminates the nodejs process, which then closes the alert
            const vbsPath = path.join(__dirname, 'uninstallHookAlert.vbs');
    
            exec(`cscript //nologo "${vbsPath}"`, (err, stdout, stderr) => {
                if (err) {
                    console.error('Error executing VBScript:', err);
                    return;
                }
                if (stderr) {
                    console.error('VBScript error:', stderr);
                    return;
                }
                console.log('VBScript executed successfully:', stdout);
            });        
        } else if (process.platform === 'darwin') {
            // Use AppleScript to show a message box
            exec(`osascript -e 'display alert "Warning" message "${escapedMessageUnix}" as critical'`);
        } else {
            // Use Zenity to show a message box, assumes Linux
            exec(`zenity --warning --title="Warning" --text="${escapedMessageUnix}"`);
        }
    }
    
    if (isActive()) {
        showWarning("Uninstalling Vibrancy Continued without disabling it first will NOT remove the effect! Please reinstall the extension and disable it using the command palette action \"Disable Vibrancy\" first.\n\nCheck Vibrancy Continued description for more information.");
    }
})();  
