/**
 * Static payment / contact details displayed on the offline-payment page
 * and used in templated WhatsApp / email links throughout the site.
 *
 * Kept in code (not Firestore) because they change rarely and the values
 * are needed during SSR before any client fetch can run.
 */

export const PAYMENT_DETAILS = {
  fps: {
    /** Display string (with country code) shown on the page. */
    display: '+852-92823060',
    /** Bare digits — used in `wa.me/` links. */
    digitsOnly: '85292823060',
  },
  bank: {
    name: 'BEA Bank',
    accountNumber: '015-266-68001768',
    accountHolder: 'Cholliman Incorporation Limited',
  },
  /** Time a `pending` booking holds its slot before the cron auto-cancels. */
  pendingHoldMinutes: 30,
} as const;
