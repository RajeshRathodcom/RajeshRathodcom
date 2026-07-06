/**
 * generate-stats.js
 * Pulls live GitHub stats via the GraphQL API and renders them into a
 * monochrome + single-accent SVG card, styled after Apple's spec-sheet pages.
 *
 * Requires env vars:
 *   GH_USERNAME   - the profile username (e.g. RajeshRathodcom)
 *   GH_TOKEN      - classic PAT with `read:user` + `repo` scopes.
 *                   `repo` is required to see your private repo COUNT.
 *                   Private repo names/content are never rendered — only
 *                   the aggregate number is used.
 *
 * Output: assets/stats.svg
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const USERNAME = process.env.GH_USERNAME || "RajeshRathodcom";
const TOKEN = process.env.GH_TOKEN;

// ---- design tokens -------------------------------------------------------
const COLORS = {
  bg: "#1D1D1F",
  hairline: "#333336",
  textPrimary: "#F5F5F7",
  textSecondary: "#86868B",
  accent: "#0071E3",
  trackDim1: "#48484A",
  trackDim2: "#2C2C2E",
};
const FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Helvetica, Arial, sans-serif";

// ---- GraphQL query --------------------------------------------------------
// Two repository connections:
//  - `allRepos`: every owned repo (public + private) — used ONLY for counts
//  - `publicRepos`: public owned repos — used for stars + language mix
//    (nothing about private repos beyond their count is ever read)
const query = `
query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      contributionCalendar { totalContributions }
    }
    allRepos: repositories(ownerAffiliations: OWNER, isFork: false) {
      totalCount
    }
    privateRepos: repositories(ownerAffiliations: OWNER, isFork: false, privacy: PRIVATE) {
      totalCount
    }
    publicRepos: repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 5, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name } }
        }
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
      "Authorization": `bearer ${TOKEN}`,
      "User-Agent": "profile-stats-card",
      "Content-Length": Buffer.byteLength(data),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

async function main() {
  if (!TOKEN) {
    console.error("Missing GH_TOKEN env var.");
    process.exit(1);
  }
  const data = await graphql(query, { login: USERNAME });
  const user = data.user;

  const totalContributions =
    user.contributionsCollection.contributionCalendar.totalContributions;
  const publicRepoCount = user.publicRepos.totalCount;
  const privateRepoCount = user.privateRepos.totalCount;
  const totalStars = user.publicRepos.nodes.reduce(
    (sum, r) => sum + r.stargazerCount,
    0
  );
  const followers = user.followers.totalCount;

  // Aggregate language byte-size across all owned public repos
  const langTotals = {};
  for (const repo of user.publicRepos.nodes) {
    for (const edge of repo.languages.edges) {
      langTotals[edge.node.name] = (langTotals[edge.node.name] || 0) + edge.size;
    }
  }
  const totalBytes = Object.values(langTotals).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, size]) => ({ name, pct: (size / totalBytes) * 100 }));

  const svg = renderSvg({
    totalContributions,
    publicRepoCount,
    privateRepoCount,
    totalStars,
    followers,
    topLangs,
  });

  const outPath = path.join(__dirname, "..", "assets", "stats.svg");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg, "utf8");
  console.log(`Wrote ${outPath}`);
}

function renderSvg({
  totalContributions,
  publicRepoCount,
  privateRepoCount,
  totalStars,
  followers,
  topLangs,
}) {
  const width = 400;
  const height = 610;
  const padX = 32;
  const contentW = width - padX * 2;

  // ---- 2x2 stat grid --------------------------------------------------
  const gridTop = 178;
  const rowH = 78;
  const colL = padX;
  const colR = width - padX;
  const cell = (x, anchor, y, value, label) => `
    <text x="${x}" y="${y}" font-family="${FONT}" font-size="30" font-weight="600" letter-spacing="-0.5" fill="${COLORS.textPrimary}" text-anchor="${anchor}">${escapeXml(value)}</text>
    <text x="${x}" y="${y + 20}" font-family="${FONT}" font-size="10.5" letter-spacing="1" fill="${COLORS.textSecondary}" text-anchor="${anchor}">${escapeXml(label.toUpperCase())}</text>`;

  const row1Y = gridTop;
  const row2Y = gridTop + rowH;

  const statGrid = `
  ${cell(colL, "start", row1Y, formatNumber(publicRepoCount), "Public repos")}
  ${cell(colR, "end", row1Y, formatNumber(privateRepoCount), "Private repos")}
  ${cell(colL, "start", row2Y, formatNumber(totalStars), "Stars earned")}
  ${cell(colR, "end", row2Y, formatNumber(followers), "Followers")}
  <line x1="${padX}" y1="${row1Y + 34}" x2="${width - padX}" y2="${row1Y + 34}" stroke="${COLORS.hairline}" stroke-width="1" />`;

  // ---- Segmented language bar ------------------------------------------
  const barY = gridTop + rowH + 70;
  const barH = 14;
  const barR = 7;
  const gap = 3;
  const usableW = contentW - gap * (topLangs.length - 1);
  let cursorX = padX;
  const segments = topLangs.map((l, i) => {
    const w = Math.max((l.pct / 100) * usableW, 6);
    const seg = {
      x: cursorX,
      w,
      color: i === 0 ? COLORS.accent : i === 1 ? COLORS.trackDim1 : COLORS.trackDim2,
    };
    cursorX += w + gap;
    return seg;
  });

  const legendRows = topLangs
    .map((l, i) => {
      const y = barY + 40 + i * 22;
      const dotColor = i === 0 ? COLORS.accent : i === 1 ? COLORS.trackDim1 : COLORS.trackDim2;
      return `
    <circle cx="${padX + 5}" cy="${y - 4}" r="4" fill="${dotColor}" />
    <text x="${padX + 18}" y="${y}" font-family="${FONT}" font-size="13" fill="${COLORS.textPrimary}">${escapeXml(l.name)}</text>
    <text x="${width - padX}" y="${y}" font-family="${FONT}" font-size="13" fill="${COLORS.textSecondary}" text-anchor="end">${l.pct.toFixed(1)}%</text>`;
    })
    .join("");

  const footerY = barY + 40 + topLangs.length * 22 + 24;
  const updated = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub activity stats for ${escapeXml(USERNAME)}">
  <rect width="${width}" height="${height}" rx="20" fill="${COLORS.bg}" />
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="19.5" fill="none" stroke="${COLORS.hairline}" />

  <text x="${padX}" y="48" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="2" fill="${COLORS.textSecondary}">GITHUB ACTIVITY</text>

  <text x="${padX}" y="112" font-family="${FONT}" font-size="60" font-weight="700" letter-spacing="-1.5" fill="${COLORS.accent}">${formatNumber(totalContributions)}</text>
  <text x="${padX}" y="136" font-family="${FONT}" font-size="13" fill="${COLORS.textSecondary}">contributions in the past year</text>

  <line x1="${padX}" y1="160" x2="${width - padX}" y2="160" stroke="${COLORS.hairline}" stroke-width="1" />

  ${statGrid}

  <text x="${padX}" y="${barY - 24}" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="2" fill="${COLORS.textSecondary}">TOP LANGUAGES</text>

  ${segments
    .map(
      (s) =>
        `<rect x="${s.x}" y="${barY}" width="${s.w}" height="${barH}" rx="${barR}" fill="${s.color}" />`
    )
    .join("")}

  ${legendRows}

  <line x1="${padX}" y1="${footerY - 18}" x2="${width - padX}" y2="${footerY - 18}" stroke="${COLORS.hairline}" stroke-width="1" />
  <text x="${padX}" y="${footerY + 10}" font-family="${FONT}" font-size="11" fill="${COLORS.textSecondary}">Building at</text>
  <text x="${padX + 52}" y="${footerY + 10}" font-family="${FONT}" font-size="11" font-weight="600" fill="${COLORS.textPrimary}">@WordPlus-io</text>
  <text x="${width - padX}" y="${footerY + 10}" font-family="${FONT}" font-size="11" fill="${COLORS.textSecondary}" text-anchor="end">Updated ${updated}</text>
</svg>`;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { renderSvg };
