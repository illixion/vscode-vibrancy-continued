import interval from './interval.mjs';
import overwrite from './overwrite.mjs';

export default (window) => ({
  interval: interval(window),
  overwrite: overwrite(window),
});