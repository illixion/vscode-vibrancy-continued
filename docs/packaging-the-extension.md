
# How To Package Extension As VSIX

Follow these steps to package the extension into a VSIX file using `vsce`:

1. **Select the Desired Branch**
   - Use `git checkout <branch-name>` to switch to the branch you want to package.

2. **Install Dependencies**

> Note: if you are on Windows, make sure to rename `bindings.gyp.dist` to `bindings.gyp` before running the install command, as this is required for building native modules. You may also need to install Visual Studio Build Tools if you haven't already, as they are required for compiling native modules on Windows. Alternatively, download latest pre-built binaries from our GitHub Actions artifacts and place them in the `runtime` directory to avoid needing to build locally.

   - Run the following command to install dependencies and build native modules:
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
