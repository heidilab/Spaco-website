# Phase 3 — customer-facing polish and operations

Scope: footer, metadata, bilingual home controls, mobile navigation, accessibility and operations documentation. Preview first; production approval is separate.

- Replaced the non-functional newsletter input with an Instagram follow link. No email is collected or sent.
- Footer phone and email links now use tel/mailto; social links have larger touch targets. Copyright uses the current year.
- Localised home actions, status chips and stat labels. Preserved the intentional GATHERING branding and existing visual direction.
- Metadata titles containing SPACO no longer receive a duplicate root-template brand suffix; existing CMS titles are preserved.
- Promo images fall back to readable labels when alt equals their internal key/id, and lazy-load below the hero. Editors still need to supply meaningful offer-specific descriptions.
- Mobile menu has an accessible name/expanded state, scrollable content and Escape support. Added visible keyboard focus and anchor offsets. Reduced small-screen hero padding.
- Replaced starter README and added operations guidance for deployment, shared Firebase risks, payment review, retry jobs, cron schedules, rollback and content maintenance.

Checks: 143 existing unit tests passed; TypeScript/Next build passed; focused ESLint has no errors and one existing hero image optimisation warning. Local CMS reads can fall back under network restrictions. Responsive browser verification is recorded in the Notion release entry.

Content limitation: the audited BBQ claim lives in live CMS content, not the source. No live article was changed through this preview. Verify current venue facilities before publishing a factual correction; this remains a content follow-up, not a completed fix.
