# How To Debug the Extension

Follow these steps to debug the extension:

1. **Clone the Repository**
   ```sh
   git clone https://github.com/illixion/vscode-vibrancy-continued.git && cd vscode-vibrancy-continued
   code .
   ```

2. **Install Dependencies**
   ```sh
   npm i
   ```

3. **Open the Main Extension File**
   - In VSCode, open `extension/index.js`.

4. **Start Debugging**
   - Press `F5` to launch a new VSCode window in Extension Development Host mode.
   - When prompted, select **VS Code Extension Development**.

5. **Reload the Extension**
   - In the new window, open the Command Palette (`Cmd+Shift+P`), search for and run `Reload Vibrancy`.

6. **Debugging**
   - Set breakpoints and use debugging tools in the original VSCode window.
   - All IDE functionality (breakpoints, variable inspection, etc.) will work from the original window.
