// Loads script.js as a Node module. script.js guards its browser bootstrap
// behind `typeof GM_addStyle !== 'undefined'`, so requiring it here just
// defines the pure-logic exports without touching the DOM.
const path = require("node:path");
module.exports = require(path.resolve(__dirname, "../script.js"));
