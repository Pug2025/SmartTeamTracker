module.exports = async function handler(req, res) {
  const seasonReport = require("./season-report.js");
  return seasonReport(req, res);
};
