# Read this first: this directory is staged, not homed

**This code does not belong in tg-widgets.** It is here for one reason only:
Claude Code could not create the standalone GitHub repo from its session (the
GitHub App returned `403 Resource not accessible by integration` on
`POST /user/repos`), and the container it was built in is wiped when the session
ends. The 28 May 2026 build of this exact project was lost that way. Committing
it to a branch was the only way to stop that happening twice.

The decision of 28 May 2026 stands and has not been revisited: **AI Search
Readiness ships as a standalone private repo with its own Vercel project, public
and with no login, separate from tg-widgets.** The reasons are unchanged. It has
a different security posture (public, unauthenticated, SSRF-guarded fetching of
arbitrary URLs) and it is an independently shareable, sellable product.

## What to do with it

1. Create the private GitHub repo `andyspeight/ai-search-readiness`.
2. Move this directory to the root of that repo:

   ```bash
   git clone git@github.com:andyspeight/ai-search-readiness.git
   cp -R ai-search-readiness/. ai-search-readiness-repo/
   cd ai-search-readiness-repo
   git add . && git commit -m "AI Visibility Score: initial engine, endpoint and front end"
   git push -u origin main
   ```

   `CLAUDE.md` goes at the root of that repo. It is already in this directory.

3. Delete this directory from the `claude/new-project-71k85l` branch, and never
   merge that branch into `tg-widgets` main.

## Two things that stop it being finished here

- **Outbound egress.** The build environment blocks requests to arbitrary hosts
  (`Host not in allowlist`), so the three live benchmark scans could not be run.
  Everything that can be tested offline is tested and green. See `DEPLOY.md`.
- **Repo creation.** As above. Nothing else was blocked.
