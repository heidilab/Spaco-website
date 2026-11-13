# SPACO website — standing instructions

## Test links for the owner: always `spaco-test.vercel.app`

When the owner (Heidi) needs to try a change, give her ONE address, every time:

    https://spaco-test.vercel.app/...

Never hand her a random Vercel deployment hostname
(`spaco-website-<hash>-heidilabs-projects.vercel.app`) or a branch alias
(`spaco-website-git-<branch>-…`). Staff sign in with Google, and Firebase Auth
only accepts hostnames on its authorized-domains list; a new hostname means
she has to add a domain in the Firebase console again. `spaco-test.vercel.app`
is the one address she agreed to authorize, once (2026-11-13).

How:

1. Push the branch and wait for its Vercel preview deployment to be READY
   (project `spaco-website`, team `heidilabs-projects`).
2. Point the alias at that deployment — Vercel MCP `assign_alias` with
   `{"alias": "spaco-test.vercel.app"}`, or
   `vercel alias set <deployment-url> spaco-test.vercel.app`.
3. Share the `spaco-test.vercel.app` link. Say which commit it now shows.

Only one preview sits on it at a time — if it is showing someone else's
change she is still testing, ask before taking it over.

### Since 2026-11-13: the address is tied to a Git branch

The Vercel connector was unavailable in the session that day, so the alias
could not be re-pointed and Heidi was left looking at an old version (a page
that did not exist there yet rendered blank). She then added
`spaco-test.vercel.app` to the project herself — Vercel → `spaco-website` →
Settings → Domains — connected to **Preview**, Git Branch
`claude/bold-goldberg-7zkepd`.

- While that setting stands, a push to that branch moves the test address to
  the new deployment by itself (Vercel applies a branch domain on the next
  push, not at the moment it is saved). No `assign_alias` needed.
- A session on a DIFFERENT branch does not move it by pushing. Check the
  Domains list first (`list_project_domains`); then either re-point with
  `assign_alias` if Vercel allows it for a branch-bound domain (not tried
  yet), or ask Heidi to change the Git Branch field on that domain to the
  session's branch — one field, Edit → Save — and push once more.
- Always tell her which commit the address now shows, and say so plainly
  when you could not confirm it (the cloud session cannot open
  `spaco-test.vercel.app` itself).

If the address cannot be moved to the new version, say so and ask her — do
not fall back to a new hostname silently, and do not send her a link to a
page that the version on the test address does not have.

Previews share the LIVE Firebase database. See `docs/operations.md`.
