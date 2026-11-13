# SPACO website — standing instructions

## Test links for the owner: always `spaco-test.vercel.app`

When the owner (Heidi) needs to try a change, give her ONE address, every time:

    https://spaco-test.vercel.app/...

Never hand her a random Vercel deployment hostname
(`spaco-website-<hash>-heidilabs-projects.vercel.app`) or a branch alias
(`spaco-website-git-<branch>-…`). Staff sign in with Google, and Firebase Auth
only accepts hostnames on its authorized-domains list; a new hostname means
she has to add a domain in the Firebase console again. `spaco-test.vercel.app`
is already on that list (owner decision 2026-11-13).

How:

1. Push the branch and wait for its Vercel preview deployment to be READY
   (project `spaco-website`, team `heidilabs-projects`).
2. Point the alias at that deployment — Vercel MCP `assign_alias` with
   `{"alias": "spaco-test.vercel.app"}`, or
   `vercel alias set <deployment-url> spaco-test.vercel.app`.
3. Share the `spaco-test.vercel.app` link. Say which commit it now shows.

The alias does not follow a branch: re-point it after every new commit she
should see. Only one preview sits on it at a time — if it is showing someone
else's change she is still testing, ask before taking it over.

If the alias cannot be re-pointed (no Vercel access in the session), say so
and ask her — do not fall back to a new hostname silently.

Previews share the LIVE Firebase database. See `docs/operations.md`.
