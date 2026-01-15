module.exports = async function handler(req, res) {
  const teamReport = require("./team-report.js");
  return teamReport(req, res);
};
