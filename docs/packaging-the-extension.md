
# How To Package Extension As VSIX

Follow these steps to package the extension into a VSIX file using `vsce`:

1. **Select the Desired Branch**
   - Use `git checkout <branch-name>` to switch to the branch you want to package.

2. **Install Dependencies**
   ```sh
   npm i
   ```

3. **Package the Extension**
   - Run the following command:
   ```sh
   npx @vscode/vsce package --allow-star-activation
   ```
   - This will generate a `.vsix` file in your current directory.

4. **Install the VSIX (Optional)**
   - To install the packaged extension, run:
   ```sh
   code --install-extension *.vsix
   ```
