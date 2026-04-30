const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "public", "index.template.html");
const indexPath = path.join(__dirname, "public", "index.html");

if (!fs.existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

const version = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 14); // YYYYMMDDHHMMSS

let html = fs.readFileSync(templatePath, "utf8");
html = html.replace(/__APP_VERSION__/g, version);

fs.writeFileSync(indexPath, html, "utf8");

console.log(`Generated public/index.html with version: ${version}`);