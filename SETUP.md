# Setup guide

## 1. Create the special profile repo

GitHub only renders a profile README from a repo named **exactly** like your username.

1. Go to https://github.com/new
2. Repository name: `RajeshRathodcom` (must match your username exactly)
3. Public, initialize with a README (you'll overwrite it)
4. Create it — GitHub will show a banner confirming it's your profile repo

## 2. Push these files

```bash
git clone https://github.com/RajeshRathodcom/RajeshRathodcom.git
cd RajeshRathodcom
# copy in README.md, assets/, scripts/, .github/ from this delivery
git add .
git commit -m "Set up profile README with live stats card"
git push
```

## 3. Create a Personal Access Token (so the Action can read your stats)

The default `GITHUB_TOKEN` in Actions can't query the GraphQL user API broadly enough, so the workflow needs its own token:

1. Go to https://github.com/settings/tokens?type=beta (fine-grained tokens)
2. **Generate new token** → Resource owner: your account → Expiration: 1 year (set a calendar reminder to rotate it)
3. Repository access: **Only select repositories** → pick this `RajeshRathodcom` repo
4. Permissions → Account permissions → nothing needed here; under **Repository permissions**, no extra scopes needed since we're only reading public user/repo data via GraphQL — the classic token path below is simpler in practice:
   - Easier alternative: use a **classic token** (https://github.com/settings/tokens/new) with just the `read:user` and `public_repo` scopes. This is what the GraphQL query in `scripts/generate-stats.js` needs.
5. Copy the token — you won't see it again.

## 4. Add the token as a repo secret

1. In the `RajeshRathodcom` repo → **Settings → Secrets and variables → Actions**
2. **New repository secret**
   - Name: `STATS_PAT`
   - Value: the token from step 3
3. Save

## 5. Enable the Action

1. Go to the **Actions** tab in the repo → you should see "Update stats card"
2. Click **Run workflow** once manually to generate the real card immediately (otherwise it waits for the daily 03:00 UTC cron)
3. After it runs, `assets/stats.svg` will be replaced with your real numbers — the one currently in this delivery is a placeholder with sample data so the README doesn't look broken before the first run

## 6. Pin your best repos (separate from the README)

This is a native GitHub feature, not something a README controls:

1. Go to your profile → **Customize your pins**
2. Since your personal account currently shows only one public repo, pin your best **WordPlus-io** org repos here too — pinned items can come from any org you belong to
3. Aim for a mix that matches the "balanced" positioning: one design-systems/WordPress repo, one full-stack build, one smaller tool (like PixelLens)

## 7. Optional: make more repos public

The stats card only counts what's public. If AuthKit, PixelLens, NarratIQ, or OTPulse are currently private, consider making at least read-only public mirrors (even without full source) so the "Repositories" and "Top languages" numbers reflect your actual output rather than just one PHP repo.

---

### Customizing later

- Colors and layout live in `scripts/generate-stats.js` under the `COLORS` and `FONT` constants at the top — change `COLORS.accent` to swap the single accent color.
- Card width/height are the `width`/`height` constants inside `renderSvg`.
- To add a second card (e.g., a contribution heatmap), duplicate the pattern in `renderSvg` rather than pulling in a third-party badge generator — keeps the whole profile visually consistent.
