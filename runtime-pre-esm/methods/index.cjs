module.exports = (window) => ({
  interval: require('./interval.cjs')(window),
  overwrite: require('./overwrite.cjs')(window)
})