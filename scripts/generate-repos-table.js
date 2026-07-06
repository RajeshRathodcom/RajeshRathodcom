/**
 * generate-repos-table.js
 * Builds a markdown table of public repos (name, language, stars, updated)
 * plus a one-line private repo count, and injects it into README.md between
 *   <!-- REPOS:START --> ... <!-- REPOS:END -->
 *
 * Private repo NAMES are never written anywhere — only the total count.
 *
 * Requires env vars: GH_USERNAME, GH_TOKEN (same token as generate-stats.js)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const USERNAME = process.env.GH_USERNAME || "RajeshRathodcom";
const TOKEN = process.env.GH_TOKEN;

const query = `
query ($login: String!) {
  user(login: $login) {
    privateRepos: repositories(ownerAffiliations: OWNER, isFork: false, privacy: PRIVATE) {
      totalCount
    }
    publicRepos: repositories(
      first: 15
      ownerAffiliations: OWNER
      privacy: PUBLIC
      isFork: false
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      totalCount
      nodes {
        name
        url
        description
        stargazerCount
        updatedAt
        primaryLanguage { name }
      }
    }
  }
}`;

function graphql(query, variables) {
  const data = JSON.stringify({ query, variables });
  const options = {
    hostname: "api.github.com",
    path: "/graphql",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${TOKEN}`,
      "User-Agent": "profile-repos-table",
      "Content-Length": Buffer.byteLength(data),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.errors) return reject(new Error(JSON.stringify(parsed.errors)));
          resolve(parsed.data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

async function main() {
  if (!TOKEN) {
    console.error("Missing GH_TOKEN env var.");
    process.exit(1);
  }
  const data = await graphql(query, { login: USERNAME });
  const user = data.user;
  const publicCount = user.publicRepos.totalCount;
  const privateCount = user.privateRepos.totalCount;
  const totalCount = publicCount + privateCount;

  const totalLine = `📦 **${totalCount} repositories** — ${publicCount} public, ${privateCount} private`;

  const rows = user.publicRepos.nodes
    .map((r) => {
      const lang = r.primaryLanguage ? r.primaryLanguage.name : "—";
      const desc = (r.description || "").replace(/\|/g, "\\|");
      return `| [${r.name}](${r.url}) | ${lang} | ${r.stargazerCount} | ${fmtDate(r.updatedAt)} |\n${desc ? `<sub>${desc}</sub> | | | |\n` : ""}`;
    })
    .join("");

  const tableBlock = `_${publicCount} public repos shown below · ${privateCount} private repos exist but aren't listed here, only counted above_

| Repo | Language | Stars | Last updated |
|---|---|---|---|
${rows}`;

  const readmePath = path.join(__dirname, "..", "README.md");
  let readme = fs.readFileSync(readmePath, "utf8");

  readme = replaceBetween(readme, "<!-- REPO_TOTAL:START -->", "<!-- REPO_TOTAL:END -->", totalLine);
  readme = replaceBetween(readme, "<!-- REPOS:START -->", "<!-- REPOS:END -->", tableBlock);

  fs.writeFileSync(readmePath, readme, "utf8");
  console.log("README.md repo sections updated");
}

function replaceBetween(text, startMarker, endMarker, content) {
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    console.error(`Markers ${startMarker} / ${endMarker} not found in README.md`);
    process.exit(1);
  }
  return (
    text.slice(0, startIdx + startMarker.length) +
    "\n\n" +
    content +
    "\n\n" +
    text.slice(endIdx)
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
