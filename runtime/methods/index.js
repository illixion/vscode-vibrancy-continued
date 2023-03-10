module.exports = (window) => ({
  interval: require('./interval')(window),
  overwrite: require('./overwrite')(window)
})