export default window => {
  let overwritten;

  return {
    install() {
      overwritten = window.setBackgroundColor;
      const original = window.setBackgroundColor.bind(window);
      window.setBackgroundColor = (bg) => original('#00000000');
    },
    uninstall() {
      window.setBackgroundColor = overwritten;
    }
  };
};
