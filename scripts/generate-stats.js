/**
 * generate-stats.js
 * Pulls live GitHub stats via the GraphQL API and renders them into a
 * transparent, borderless SVG — monochrome + single accent, styled after
 * Apple's spec-sheet pages. No background panel, no card border: the text
 * sits directly on the page, so it needs a light and dark variant.
 *
 * Counts repos from your personal account PLUS any organization where you
 * are an owner/admin (viewerCanAdminister) — e.g. wordplus-in.
 *
 * Requires env vars:
 *   GH_USERNAME   - the profile username (e.g. RajeshRathodcom)
 *   GH_TOKEN      - classic PAT with `read:user`, `repo`, and `read:org` scopes.
 *                   `repo` + `read:org` are required to see private repo COUNTS
 *                   (personal and org-owned). Private repo names/content are
 *                   never rendered — only the aggregate numbers are used.
 *
 * Output: assets/stats-dark.svg, assets/stats-light.svg
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const USERNAME = process.env.GH_USERNAME || "RajeshRathodcom";
const TOKEN = process.env.GH_TOKEN;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Helvetica, Arial, sans-serif";

// ---- GraphQL query --------------------------------------------------------
// Personal repos (public + private counts, public repo details for stars/langs)
// plus, for every org the viewer administers, the same shape of data.
const query = `
query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      contributionCalendar { totalContributions }
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
    organizations(first: 20) {
      nodes {
        login
        viewerCanAdminister
        privateRepos: repositories(isFork: false, privacy: PRIVATE) {
          totalCount
        }
        publicRepos: repositories(first: 100, privacy: PUBLIC, isFork: false) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 5, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name } }
            }
          }
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
  const followers = user.followers.totalCount;

  // Start with personal account totals
  let publicRepoCount = user.publicRepos.totalCount;
  let privateRepoCount = user.privateRepos.totalCount;
  let publicRepoNodes = [...user.publicRepos.nodes];

  // Fold in every organization the viewer administers (owns)
  const ownedOrgs = user.organizations.nodes.filter((o) => o.viewerCanAdminister);
  for (const org of ownedOrgs) {
    publicRepoCount += org.publicRepos.totalCount;
    privateRepoCount += org.privateRepos.totalCount;
    publicRepoNodes.push(...org.publicRepos.nodes);
  }

  const totalStars = publicRepoNodes.reduce((sum, r) => sum + r.stargazerCount, 0);

  // Aggregate language byte-size across all public repos, personal + owned orgs
  const langTotals = {};
  for (const repo of publicRepoNodes) {
    for (const edge of repo.languages.edges) {
      langTotals[edge.node.name] = (langTotals[edge.node.name] || 0) + edge.size;
    }
  }
  const totalBytes = Object.values(langTotals).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, size]) => ({ name, pct: (size / totalBytes) * 100 }));

  const svgDark = renderSvg({
    totalContributions,
    publicRepoCount,
    privateRepoCount,
    totalStars,
    followers,
    topLangs,
    theme: "dark",
  });
  const svgLight = renderSvg({
    totalContributions,
    publicRepoCount,
    privateRepoCount,
    totalStars,
    followers,
    topLangs,
    theme: "light",
  });

  const outDir = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "stats-dark.svg"), svgDark, "utf8");
  fs.writeFileSync(path.join(outDir, "stats-light.svg"), svgLight, "utf8");
  console.log(`Wrote ${outDir}/stats-dark.svg and stats-light.svg`);
}

function renderSvg({
  totalContributions,
  publicRepoCount,
  privateRepoCount,
  totalStars,
  followers,
  topLangs,
  theme,
}) {
  const palette =
    theme === "light"
      ? {
          textPrimary: "#1D1D1F",
          textSecondary: "#6E6E73",
          accent: "#0071E3",
          hairline: "#D2D2D7",
          trackDim1: "#C7C7CC",
          trackDim2: "#E5E5EA",
        }
      : {
          textPrimary: "#F5F5F7",
          textSecondary: "#86868B",
          accent: "#2997FF",
          hairline: "#333336",
          trackDim1: "#48484A",
          trackDim2: "#2C2C2E",
        };
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
    <text x="${x}" y="${y}" font-family="${FONT}" font-size="30" font-weight="600" letter-spacing="-0.5" fill="${palette.textPrimary}" text-anchor="${anchor}">${escapeXml(value)}</text>
    <text x="${x}" y="${y + 20}" font-family="${FONT}" font-size="10.5" letter-spacing="1" fill="${palette.textSecondary}" text-anchor="${anchor}">${escapeXml(label.toUpperCase())}</text>`;

  const row1Y = gridTop;
  const row2Y = gridTop + rowH;

  const statGrid = `
  ${cell(colL, "start", row1Y, formatNumber(publicRepoCount), "Public repos")}
  ${cell(colR, "end", row1Y, formatNumber(privateRepoCount), "Private repos")}
  ${cell(colL, "start", row2Y, formatNumber(totalStars), "Stars earned")}
  ${cell(colR, "end", row2Y, formatNumber(followers), "Followers")}
  <line x1="${padX}" y1="${row1Y + 34}" x2="${width - padX}" y2="${row1Y + 34}" stroke="${palette.hairline}" stroke-width="1" />`;

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
      color: i === 0 ? palette.accent : i === 1 ? palette.trackDim1 : palette.trackDim2,
    };
    cursorX += w + gap;
    return seg;
  });

  const legendRows = topLangs
    .map((l, i) => {
      const y = barY + 40 + i * 22;
      const dotColor = i === 0 ? palette.accent : i === 1 ? palette.trackDim1 : palette.trackDim2;
      return `
    <circle cx="${padX + 5}" cy="${y - 4}" r="4" fill="${dotColor}" />
    <text x="${padX + 18}" y="${y}" font-family="${FONT}" font-size="13" fill="${palette.textPrimary}">${escapeXml(l.name)}</text>
    <text x="${width - padX}" y="${y}" font-family="${FONT}" font-size="13" fill="${palette.textSecondary}" text-anchor="end">${l.pct.toFixed(1)}%</text>`;
    })
    .join("");

  const footerY = barY + 40 + topLangs.length * 22 + 24;
  const updated = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub activity stats for ${escapeXml(USERNAME)}">
  <text x="${padX}" y="48" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="2" fill="${palette.textSecondary}">GITHUB ACTIVITY</text>

  <text x="${padX}" y="112" font-family="${FONT}" font-size="60" font-weight="700" letter-spacing="-1.5" fill="${palette.accent}">${formatNumber(totalContributions)}</text>
  <text x="${padX}" y="136" font-family="${FONT}" font-size="13" fill="${palette.textSecondary}">contributions in the past year</text>


  <line x1="${padX}" y1="160" x2="${width - padX}" y2="160" stroke="${palette.hairline}" stroke-width="1" />

  ${statGrid}

  <text x="${padX}" y="${barY - 24}" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="2" fill="${palette.textSecondary}">TOP LANGUAGES</text>

  ${segments
    .map(
      (s) =>
        `<rect x="${s.x}" y="${barY}" width="${s.w}" height="${barH}" rx="${barR}" fill="${s.color}" />`
    )
    .join("")}

  ${legendRows}

  <line x1="${padX}" y1="${footerY - 18}" x2="${width - padX}" y2="${footerY - 18}" stroke="${palette.hairline}" stroke-width="1" />
  <text x="${padX}" y="${footerY + 10}" font-family="${FONT}" font-size="11" fill="${palette.textSecondary}">Building at</text>
  <text x="${padX + 52}" y="${footerY + 10}" font-family="${FONT}" font-size="11" font-weight="600" fill="${palette.textPrimary}">@wordplus-in</text>
  <text x="${width - padX}" y="${footerY + 10}" font-family="${FONT}" font-size="11" fill="${palette.textSecondary}" text-anchor="end">Updated ${updated}</text>
</svg>`;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { renderSvg };
