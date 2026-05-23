'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from '@/i18n/routing';
import {
  createDocument,
  updateDocument,
  getAllDocuments,
  deleteDocument,
  getAllBookings,
  getAllUsers,
  getUserProfile,
} from '@/lib/firestore';
import {
  addOns as addOnConfig,
  calculateSecurityDeposit,
  bbqStandardPriceByVenue,
  freeDrinksVenues,
  adultEquivalent,
  calcShishaPrice,
  SHISHA_MAX_PIPES,
} from '@/lib/pricing';
import { venues } from '@/lib/venues';
import {
  BusinessDocument,
  DocumentType,
  DocumentStatus,
  DocumentLineItem,
  BookingRecord,
} from '@/types';
import {
  FileText, Plus, Search, Edit2, Trash2, Printer, X,
  Receipt as ReceiptIcon, FileSignature, ClipboardList, Eye, History, Wallet,
  Download, CalendarDays, MapPin, Users, Link as LinkIcon, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PRESET_ITEMS,
  PAYMENT_TERMS,
  PaymentTermKey,
  buildDefaultNotes,
  STANDARD_TERMS,
  RECEIPT_THANK_YOU,
} from '@/lib/documentPresets';
import { buildCsv, downloadCsv } from '@/lib/csvExport';

const TYPE_LABELS: Record<DocumentType, { zh: string; en: string }> = {
  quotation: { zh: '報價單 Quotation', en: 'Quotation' },
  invoice: { zh: '發票 Invoice', en: 'Invoice' },
  receipt: { zh: '收據 Receipt', en: 'Receipt' },
};

const TYPE_ICONS: Record<DocumentType, typeof FileText> = {
  quotation: ClipboardList,
  invoice: FileSignature,
  receipt: ReceiptIcon,
};

const TYPE_GRADIENTS: Record<DocumentType, string> = {
  quotation: 'bg-gradient-cool',
  invoice: 'bg-gradient-pink',
  receipt: 'bg-gradient-warm',
};

const STATUS_LABELS: Record<DocumentStatus, { zh: string; en: string; color: string }> = {
  draft: { zh: '草稿', en: 'Draft', color: 'bg-amber-100/80 text-amber-700 border-amber-200' },
  issued: { zh: '已發出', en: 'Issued', color: 'bg-sky-100/80 text-sky-700 border-sky-200' },
  paid: { zh: '已付款', en: 'Paid', color: 'bg-emerald-100/80 text-emerald-700 border-emerald-200' },
  void: { zh: '作廢', en: 'Void', color: 'bg-rose-100/80 text-rose-700 border-rose-200' },
};

/**
 * Empty document template — `today` and `dueDate` are filled at the time of
 * the user click (event handler), NOT at module/render time, so SSR vs CSR
 * dates can never disagree.
 */
function emptyDoc(type: DocumentType): Omit<BusinessDocument, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'revisions'> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return {
    type,
    status: 'draft',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    customerAddress: '',
    bookingId: null,
    venueId: null,
    items: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
    subtotal: 0,
    discount: 0,
    discountType: 'amount',
    tax: 0,
    total: 0,
    issueDate: today,
    dueDate: due,
    paidDate: null,
    // Default to "full payment" terms — user can switch in the editor
    notes: buildDefaultNotes('full'),
    terms: STANDARD_TERMS,
    createdBy: '',
    updatedBy: '',
  };
}

// A stable "blank" template safe to use as initial state during SSR.
// (Uses fixed empty strings — no `new Date()` — so SSR === CSR.)
const BLANK_FORM: ReturnType<typeof emptyDoc> = {
  type: 'quotation',
  status: 'draft',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  customerAddress: '',
  bookingId: null,
  venueId: null,
  items: [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
  subtotal: 0,
  discount: 0,
  discountType: 'amount',
  tax: 0,
  total: 0,
  issueDate: '',
  dueDate: '',
  paidDate: null,
  notes: '',
  terms: '',
  createdBy: '',
  updatedBy: '',
};

export default function AdminDocumentsPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('documents');

  // mounted gate prevents SSR/CSR mismatch from any time-derived UI
  const [mounted, setMounted] = useState(false);
  const [docs, setDocs] = useState<BusinessDocument[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof emptyDoc> & { id?: string }>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [paymentTerm, setPaymentTerm] = useState<PaymentTermKey>('full');

  // Export state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportType, setExportType] = useState<DocumentType | 'all'>('all');

  // Booking picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerStatus, setPickerStatus] = useState<'all' | 'active' | 'pending' | 'confirmed' | 'completed'>('active');
  const [pickerLoading, setPickerLoading] = useState<string | null>(null); // booking id being fetched
  const [usersById, setUsersById] = useState<Record<string, { displayName?: string; email?: string; phone?: string }>>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (canAccess && mounted) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, mounted]);

  const loadAll = async () => {
    setLoading(true);
    const [d, b, u] = await Promise.all([
      getAllDocuments(),
      getAllBookings(),
      getAllUsers(),
    ]);
    setDocs(d);
    setBookings(b);
    // Build a uid -> profile lookup for the booking picker
    const map: Record<string, { displayName?: string; email?: string; phone?: string }> = {};
    for (const user of u as Array<{ uid: string; displayName?: string; email?: string; phone?: string }>) {
      map[user.uid] = {
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
      };
    }
    setUsersById(map);
    setLoading(false);
  };

  // ===== Filters =====
  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !d.number.toLowerCase().includes(s) &&
          !d.customerName.toLowerCase().includes(s) &&
          !(d.customerEmail || '').toLowerCase().includes(s)
        ) return false;
      }
      return true;
    });
  }, [docs, typeFilter, statusFilter, search]);

  // ===== Totals =====
  const recompute = (f: typeof form) => {
    const subtotal = f.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
    const discountAmt = f.discountType === 'percent' ? (subtotal * (Number(f.discount) || 0)) / 100 : Number(f.discount) || 0;
    const total = Math.max(0, subtotal - discountAmt);
    // tax field is kept on the type for backwards compatibility but always 0
    return { ...f, subtotal, total, tax: 0 };
  };

  const updateForm = (patch: Partial<typeof form>) => {
    setForm((prev) => recompute({ ...prev, ...patch }));
  };

  const updateItem = (idx: number, patch: Partial<DocumentLineItem>) => {
    setForm((prev) => {
      const items = prev.items.map((it, i) => {
        if (i !== idx) return it;
        const merged = { ...it, ...patch };
        merged.amount = (Number(merged.quantity) || 0) * (Number(merged.unitPrice) || 0);
        return merged;
      });
      return recompute({ ...prev, items });
    });
  };

  const addItem = () => {
    setForm((prev) => recompute({ ...prev, items: [...prev.items, { description: '', quantity: 1, unitPrice: 0, amount: 0 }] }));
  };

  const removeItem = (idx: number) => {
    setForm((prev) => recompute({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  // Pre-fill from a booking
  /**
   * Pull every relevant field from a booking + its customer profile into the
   * current document form. Builds line items in the same bilingual preset
   * format as the manual presets (Place / Date / Time / People), so a
   * booking-derived doc looks identical to one filled by hand.
   */
  const prefillFromBooking = async (bookingId: string) => {
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return;
    setPickerLoading(bookingId);

    try {
      // Fetch the freshest user profile (cached map may be stale)
      const profile =
        (await getUserProfile(b.userId).catch(() => null)) ||
        usersById[b.userId] ||
        {};

      const venue = venues.find((v) => v.id === b.venueId);
      const venueName = venue?.name[locale] || b.venueId;

      // Item 1 — Venue rental, with bilingual placeholders filled in
      const baseCharge = b.pricing.baseCharge ?? b.pricing.subtotal - (b.pricing.addOnTotal || 0);
      const venueRentalItem: DocumentLineItem = {
        description:
          'Venue Rental Fee 場地租用費\n' +
          `Place 場地: ${venueName}\n` +
          `Date 日期: ${b.date}\n` +
          `Time 時間: ${b.startTime} - ${b.endTime} (${b.hours}h)\n` +
          `No. of People 人數: ${b.guestCount}`,
        quantity: 1,
        unitPrice: baseCharge,
        amount: baseCharge,
      };

      const items: DocumentLineItem[] = [venueRentalItem];

      // Item(s) — Add-ons (BBQ / Hotpot / Drinks etc.). Pricing MUST
      // mirror calculatePricing() in lib/pricing.ts exactly: per-head
      // items charge against adult-equivalent headcount (kids = 0.5),
      // per-unit items multiply by the stored quantity, and BBQ uses a
      // venue-specific unit price. Failing to mirror this is what made
      // the BBQ receipt line read $158 × 1 instead of $158 × 7 pax.
      const adults = Math.max(0, b.guestCount - (b.childCount || 0));
      const equiv = adultEquivalent(adults, b.childCount || 0);
      const hasBBQPackage = (b.addOns || []).some(
        (a) => a.id === 'bbq-standard' || a.id === 'bbq-premium',
      );

      for (const addOn of b.addOns || []) {
        // Admin-defined custom items live OUTSIDE the catalog — their
        // name + price ride on `addOn.options`. Pull those through to
        // the receipt line so the document mirrors what the customer
        // was charged. Heidi spec 2026-05-23.
        if (addOn.id.startsWith('custom-')) {
          const customName = addOn.options?.customName?.trim() || '自訂項目';
          const customPrice = Math.max(0, Math.floor(addOn.options?.customPrice ?? 0));
          if (customPrice > 0) {
            items.push({
              description: customName,
              quantity: 1,
              unitPrice: customPrice,
              amount: customPrice,
            });
          }
          continue;
        }

        const cfg = addOnConfig.find((a) => a.id === addOn.id);
        if (!cfg) continue;

        let unitPrice: number;
        let quantity: number;
        let amount: number;

        if (addOn.id === 'bbq-standard') {
          // Per-head, venue-specific. SW: $158, TST: $138, CWB: $158.
          unitPrice = bbqStandardPriceByVenue[b.venueId] || cfg.pricePerUnit;
          quantity = equiv;
          amount = Math.round(unitPrice * equiv);
        } else if (addOn.id === 'bbq-premium') {
          unitPrice = 328;
          quantity = equiv;
          amount = Math.round(unitPrice * equiv);
        } else if (addOn.id === 'bbq-grill') {
          // Grill rental is bundled when a BBQ package is also selected.
          if (hasBBQPackage) continue;
          unitPrice = 500;
          quantity = addOn.quantity;
          amount = unitPrice * quantity;
        } else if (addOn.id === 'hotpot-standard') {
          unitPrice = 168;
          quantity = equiv;
          amount = Math.round(unitPrice * equiv);
        } else if (addOn.id === 'hotpot-seafood') {
          unitPrice = 348;
          quantity = equiv;
          amount = Math.round(unitPrice * equiv);
        } else if (addOn.id === 'hotpot-extra-soup') {
          unitPrice = 108;
          quantity = addOn.quantity;
          amount = unitPrice * quantity;
        } else if (addOn.id === 'drinks') {
          // Skip drinks for venues with unlimited drinks bundled (e.g. TST).
          if (freeDrinksVenues.includes(b.venueId)) continue;
          // Skip if customer redeemed a "free drinks" promo on this booking.
          if (b.promoFreeDrinksCost && b.promoFreeDrinksCost > 0) continue;
          unitPrice = 25;
          quantity = equiv;
          amount = Math.round(unitPrice * equiv);
        } else if (addOn.id === 'shisha') {
          // Shisha tiered pricing — MUST mirror calcShishaPrice in
          // lib/pricing.ts (Heidi caught a $640 vs $780 mismatch on
          // a 1-pipe/2-heads booking where the receipt used the old
          // pricePerUnit × heads formula). Stored quantity = head
          // count; pipes + staffSetup live on options.
          const heads = addOn.quantity;
          const pipes = Math.min(
            SHISHA_MAX_PIPES,
            Math.max(1, addOn.options?.pipes ?? Math.min(2, heads)),
          );
          const staffSetup = !!addOn.options?.staffSetup;
          amount = calcShishaPrice(pipes, heads, staffSetup);
          // Render as "1 × $640" so the receipt math matches the line
          // total. Storing heads as quantity would print "2 × $390 =
          // $780" again on PDFs that re-derive amount.
          quantity = 1;
          unitPrice = amount;
        } else {
          // Fallback: per-unit
          unitPrice = cfg.pricePerUnit;
          quantity = addOn.quantity;
          amount = unitPrice * quantity;
        }

        // Build a richer description for shisha so the receipt
        // explains why $640 (vs the base $390 single tier) was charged.
        let description = `${cfg.name.en} ${cfg.name.zh}`;
        if (addOn.id === 'shisha') {
          const heads = addOn.quantity;
          const pipes = Math.min(
            SHISHA_MAX_PIPES,
            Math.max(1, addOn.options?.pipes ?? Math.min(2, heads)),
          );
          const staffSetup = !!addOn.options?.staffSetup;
          const suffix = `(${pipes} pipe${pipes > 1 ? 's' : ''} / ${heads} head${heads > 1 ? 's' : ''}${staffSetup ? ' + staff setup' : ''})`;
          description = `${cfg.name.en} ${cfg.name.zh} ${suffix}`;
        }
        items.push({
          description,
          quantity,
          unitPrice,
          amount,
        });
      }

      // Item — Refundable security deposit (按金).
      // `pricing.deposit` is the UPFRONT payment (full / 50%), NOT the
      // refundable deposit. The refundable amount is `securityDeposit` —
      // tiered HK$1k / 2k / 4k against subtotal. Legacy bookings (created
      // before the field existed) recompute the tier from subtotal so old
      // invoices/receipts still reconcile correctly.
      const securityDeposit =
        b.pricing.securityDeposit ?? calculateSecurityDeposit(b.pricing.subtotal);
      if (securityDeposit > 0) {
        items.push({
          description: 'Refundable Venue Deposit 可退場地按金',
          quantity: 1,
          unitPrice: securityDeposit,
          amount: securityDeposit,
        });
      }

      // For invoice: due date = 2 days before booking date (matches Payment Terms B)
      let dueDate = form.dueDate;
      if (form.type === 'invoice' && b.date) {
        const bookingDay = new Date(b.date);
        bookingDay.setDate(bookingDay.getDate() - 2);
        dueDate = bookingDay.toISOString().split('T')[0];
      }
      // For receipt: paid date = today
      let paidDate = form.paidDate;
      if (form.type === 'receipt' && !paidDate) {
        paidDate = new Date().toISOString().split('T')[0];
      }

      // Auto-pick payment terms based on total
      const total = items.reduce((s, it) => s + (it.amount || 0), 0);
      const suggestedTerm: PaymentTermKey = total >= 10000 ? 'half' : 'full';
      setPaymentTerm(suggestedTerm);

      // Receipts: short thank-you note, blank terms. Quotation /
      // invoice: full payment-terms boilerplate.
      const isReceipt = form.type === 'receipt';
      updateForm({
        bookingId: b.id,
        venueId: b.venueId,
        customerName:
          form.customerName ||
          (profile as { displayName?: string }).displayName ||
          '',
        customerEmail:
          form.customerEmail || (profile as { email?: string }).email || '',
        customerPhone:
          form.customerPhone || (profile as { phone?: string }).phone || '',
        items,
        dueDate,
        paidDate,
        notes: isReceipt ? RECEIPT_THANK_YOU : buildDefaultNotes(suggestedTerm),
        ...(isReceipt ? { terms: '' } : {}),
      });
      setPickerOpen(false);
    } finally {
      setPickerLoading(null);
    }
  };

  const openCreate = (type: DocumentType) => {
    setForm(emptyDoc(type));
    setEditingId(null);
    setShowHistory(false);
    setPaymentTerm('full');
    setEditorOpen(true);
  };

  const openEdit = (d: BusinessDocument) => {
    setForm({
      type: d.type,
      status: d.status,
      customerName: d.customerName || '',
      customerEmail: d.customerEmail || '',
      customerPhone: d.customerPhone || '',
      customerAddress: d.customerAddress || '',
      bookingId: d.bookingId,
      venueId: d.venueId,
      items: d.items.length ? d.items : [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }],
      subtotal: d.subtotal,
      discount: d.discount,
      discountType: d.discountType,
      tax: d.tax,
      total: d.total,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      paidDate: d.paidDate,
      notes: d.notes,
      terms: d.terms,
      createdBy: d.createdBy,
      updatedBy: d.updatedBy,
    });
    setEditingId(d.id);
    setShowHistory(false);
    setEditorOpen(true);
  };

  // Add a preset line item from the picker. If the first row is still blank,
  // replace it; otherwise append.
  const addPresetItem = (presetKey: string) => {
    const preset = PRESET_ITEMS.find((p) => p.key === presetKey);
    if (!preset) return;
    const item = preset.build();
    setForm((prev) => {
      const items = [...prev.items];
      const firstIsBlank =
        items.length === 1 &&
        !items[0].description &&
        !items[0].unitPrice;
      const next = firstIsBlank ? [item] : [...items, item];
      return recompute({ ...prev, items: next });
    });
  };

  // Apply a payment-term preset to notes
  const applyPaymentTerm = (key: PaymentTermKey) => {
    setPaymentTerm(key);
    updateForm({ notes: buildDefaultNotes(key) });
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.customerName.trim()) {
      alert(locale === 'zh' ? '請輸入客戶名稱' : 'Please enter a customer name');
      return;
    }
    if (!form.issueDate) {
      // Fill in missing date now (in case the user opened the form but somehow
      // dates ended up empty)
      const today = new Date().toISOString().split('T')[0];
      const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      form.issueDate = today;
      if (!form.dueDate) form.dueDate = due;
    }
    setSaving(true);
    try {
      const staff = { uid: user.uid, email: user.email || '' };
      if (editingId) {
        await updateDocument(editingId, form, staff);
      } else {
        await createDocument(form, staff);
      }
      setEditorOpen(false);
      await loadAll();
    } finally {
      setSaving(false);
    }
  };

  // ===== Excel / CSV export =====
  const openExport = () => {
    // Default: this calendar year so far
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    setExportFrom(yearStart);
    setExportTo(today);
    setExportType('all');
    setExportOpen(true);
  };

  const handleExport = () => {
    if (!exportFrom || !exportTo) {
      alert(locale === 'zh' ? '請選擇日期範圍' : 'Please select a date range');
      return;
    }
    // Filter docs by issueDate within range and (optional) type
    const filtered = docs.filter((d) => {
      if (exportType !== 'all' && d.type !== exportType) return false;
      if (!d.issueDate) return false;
      return d.issueDate >= exportFrom && d.issueDate <= exportTo;
    });

    if (filtered.length === 0) {
      alert(locale === 'zh' ? '此期間內無單據紀錄' : 'No documents found in this period');
      return;
    }

    // Header row (bilingual)
    const headers: (string | number)[] = [
      'Number 編號',
      'Type 類型',
      'Status 狀態',
      'Issue Date 發出日期',
      'Due Date 到期日',
      'Paid Date 收款日期',
      'Customer Name 客戶',
      'Customer Email',
      'Customer Phone 電話',
      'Customer Address 地址',
      'Items 項目摘要',
      'Subtotal 小計 (HK$)',
      'Discount 折扣',
      'Total 總額 (HK$)',
      'Notes 附註',
      'Created By 建立人',
      'Last Updated By 最後修改人',
    ];

    const rows: (string | number | null | undefined)[][] = [headers];
    for (const d of filtered) {
      // Compose item summary: "qty × desc-first-line @ price"
      const itemsSummary = d.items
        .map((it) => `${it.quantity}× ${(it.description || '').split('\n')[0]} @ HK$${it.unitPrice}`)
        .join(' | ');
      const discountLabel =
        d.discount > 0
          ? d.discountType === 'percent'
            ? `${d.discount}% (HK$${((d.subtotal * d.discount) / 100).toLocaleString()})`
            : `HK$${d.discount}`
          : '';
      rows.push([
        d.number,
        d.type,
        d.status,
        d.issueDate,
        d.dueDate || '',
        d.paidDate || '',
        d.customerName,
        d.customerEmail,
        d.customerPhone,
        d.customerAddress,
        itemsSummary,
        d.subtotal,
        discountLabel,
        d.total,
        (d.notes || '').replace(/\n+/g, ' / '),
        d.createdByEmail || d.createdBy || '',
        d.updatedByEmail || d.updatedBy || '',
      ]);
    }

    const csv = buildCsv(rows);
    const filename = `SPACO_documents_${exportFrom}_to_${exportTo}.csv`;
    downloadCsv(filename, csv);
    setExportOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(locale === 'zh' ? '確認刪除此單據？此操作無法還原。' : 'Delete this document? This cannot be undone.')) return;
    await deleteDocument(id);
    await loadAll();
  };

  if (!canAccess) {
    return (
      <div className="glass-card p-10 text-center max-w-md mx-auto">
        <p className="text-ink-soft">{locale === 'zh' ? '無權限存取' : 'No permission'}</p>
      </div>
    );
  }

  // Pre-mount placeholder — keeps SSR and CSR identical
  if (!mounted) {
    return (
      <div>
        <div className="mb-8">
          <span className="chip mb-3">Documents</span>
          <h1 className="text-heading font-display text-ink">Document Center</h1>
        </div>
        <div className="animate-pulse text-ink-soft p-8 text-center">Loading...</div>
      </div>
    );
  }

  // ============ List View ============
  return (
    <div>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="chip mb-3">
            <FileText size={12} className="text-pink" />
            Documents
          </span>
          <h1 className="text-heading font-display">
            <span className="text-ink">{locale === 'zh' ? '單據' : 'Document'}</span>
            <span>{'\u00A0'}</span>
            <span className="text-gradient-pink">{locale === 'zh' ? '管理' : 'Center'}</span>
          </h1>
          <p className="text-ink-soft mt-2 text-sm">
            {locale === 'zh' ? '建立、編輯、列印報價單／發票／收據，所有變更會自動保留紀錄。' : 'Create, edit and print quotations, invoices and receipts. All changes are tracked.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={openExport}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-pill text-sm font-semibold text-ink bg-white/70 backdrop-blur-md border border-white/80 hover:bg-white shadow-glass transition-all hover:-translate-y-0.5"
            title={locale === 'zh' ? '匯出 Excel / CSV' : 'Export Excel / CSV'}
          >
            <Download size={14} />
            {locale === 'zh' ? '匯出 Excel' : 'Export Excel'}
          </button>
          {(['quotation', 'invoice', 'receipt'] as DocumentType[]).map((t) => {
            const Icon = TYPE_ICONS[t];
            return (
              <button
                key={t}
                onClick={() => openCreate(t)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-pill text-sm font-semibold text-white ${TYPE_GRADIENTS[t]} shadow-glow hover:-translate-y-0.5 transition-transform`}
              >
                <Plus size={14} />
                <Icon size={14} />
                {locale === 'zh' ? `新增${t === 'quotation' ? '報價單' : t === 'invoice' ? '發票' : '收據'}` : `New ${t.charAt(0).toUpperCase() + t.slice(1)}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft z-10" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={locale === 'zh' ? '搜尋編號 / 客戶 / 電郵...' : 'Search number / customer / email...'}
            className="w-full pl-11 pr-4 py-3 rounded-pill border border-white/70 bg-white/60 backdrop-blur-md focus:outline-none focus:border-pink/40 focus:bg-white/80 text-ink placeholder:text-ink-soft/60"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-1.5 bg-white/50 backdrop-blur-md border border-white/70 rounded-pill p-1.5">
          {(['all', 'quotation', 'invoice', 'receipt'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-4 py-1.5 rounded-pill text-xs font-semibold transition-all ${
                typeFilter === t
                  ? 'bg-gradient-pink text-white shadow-glow'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t === 'all'
                ? (locale === 'zh' ? '全部' : 'All')
                : (locale === 'zh' ? (t === 'quotation' ? '報價' : t === 'invoice' ? '發票' : '收據') : t.charAt(0).toUpperCase() + t.slice(1))}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DocumentStatus | 'all')}
          className="px-5 py-3 rounded-pill bg-white/60 backdrop-blur-md border border-white/70 text-ink focus:outline-none focus:border-pink/40"
        >
          <option value="all">{locale === 'zh' ? '所有狀態' : 'All status'}</option>
          {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s][locale]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="animate-pulse text-ink-soft p-8 text-center">Loading...</div>
      ) : filteredDocs.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FileText size={40} className="mx-auto mb-3 text-ink-soft/40" />
          <p className="text-ink-soft">{locale === 'zh' ? '暫無單據' : 'No documents yet'}</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/40">
                  {[
                    locale === 'zh' ? '編號' : 'Number',
                    locale === 'zh' ? '類型' : 'Type',
                    locale === 'zh' ? '客戶' : 'Customer',
                    locale === 'zh' ? '日期' : 'Date',
                    locale === 'zh' ? '金額' : 'Total',
                    locale === 'zh' ? '狀態' : 'Status',
                    locale === 'zh' ? '操作' : 'Actions',
                  ].map((h) => (
                    <th key={h} className="text-left px-5 py-4 text-xs font-semibold text-ink-soft uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((d) => {
                  const Icon = TYPE_ICONS[d.type];
                  const statusInfo = STATUS_LABELS[d.status];
                  return (
                    <tr key={d.id} className="border-b border-white/40 last:border-0 hover:bg-white/40 transition-colors">
                      <td className="px-5 py-4">
                        <span className="font-mono font-semibold text-ink text-sm">{d.number}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-2 text-sm text-ink">
                          <span className={`w-7 h-7 rounded-xl ${TYPE_GRADIENTS[d.type]} flex items-center justify-center text-white`}>
                            <Icon size={13} />
                          </span>
                          {TYPE_LABELS[d.type][locale].split(' ')[0]}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <p className="font-medium text-ink">{d.customerName || '—'}</p>
                        <p className="text-xs text-ink-soft">{d.customerEmail || ''}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-ink">{d.issueDate}</td>
                      <td className="px-5 py-4 text-sm font-bold font-display text-gradient-pink">
                        HK${d.total.toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`px-3 py-1 rounded-pill text-xs font-medium border ${statusInfo.color}`}>
                          {statusInfo[locale]}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex gap-1">
                          <button
                            onClick={() => openEdit(d)}
                            className="w-8 h-8 rounded-xl bg-sky-100/80 text-sky-700 flex items-center justify-center hover:bg-sky-200 transition-colors"
                            title={locale === 'zh' ? '編輯' : 'Edit'}
                          >
                            <Edit2 size={13} />
                          </button>
                          <Link
                            href={`/admin/documents/${d.id}/print`}
                            className="w-8 h-8 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center hover:bg-emerald-200 transition-colors"
                            title={locale === 'zh' ? '預覽 / 列印' : 'Preview / Print'}
                          >
                            <Printer size={13} />
                          </Link>
                          <button
                            onClick={() => handleDelete(d.id)}
                            className="w-8 h-8 rounded-xl bg-rose-100/80 text-rose-700 flex items-center justify-center hover:bg-rose-200 transition-colors"
                            title={locale === 'zh' ? '刪除' : 'Delete'}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============ Editor Modal ============ */}
      <AnimatePresence>
        {editorOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/55 backdrop-blur-md"
              onClick={() => setEditorOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.22 }}
              className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto"
            >
              <div className="glass-strong rounded-[28px] p-6 md:p-7">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-2xl ${TYPE_GRADIENTS[form.type]} flex items-center justify-center text-white shadow-glow`}>
                      {(() => { const Ic = TYPE_ICONS[form.type]; return <Ic size={20} />; })()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold font-display text-ink">
                        {editingId
                          ? (locale === 'zh' ? '編輯' : 'Edit') + ' ' + TYPE_LABELS[form.type][locale]
                          : (locale === 'zh' ? '新增' : 'New') + ' ' + TYPE_LABELS[form.type][locale]}
                      </h2>
                      {editingId && (
                        <p className="text-xs text-ink-soft">
                          {docs.find((d) => d.id === editingId)?.number}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setEditorOpen(false)}
                    className="w-9 h-9 rounded-full bg-white/60 flex items-center justify-center hover:bg-white/90 transition-colors text-ink-soft"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Top fields: type, status, dates */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '類型' : 'Type'}</label>
                    <select
                      value={form.type}
                      onChange={(e) => {
                        const newType = e.target.value as DocumentType;
                        // When switching to receipt, swap the payment-
                        // terms boilerplate for the thank-you note and
                        // clear the terms column. Switching back to
                        // quotation / invoice restores boilerplate notes.
                        if (newType === 'receipt' && form.type !== 'receipt') {
                          updateForm({ type: newType, notes: RECEIPT_THANK_YOU, terms: '' });
                        } else if (newType !== 'receipt' && form.type === 'receipt') {
                          updateForm({
                            type: newType,
                            notes: buildDefaultNotes(paymentTerm),
                            terms: STANDARD_TERMS,
                          });
                        } else {
                          updateForm({ type: newType });
                        }
                      }}
                      disabled={!!editingId}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink disabled:opacity-60"
                    >
                      <option value="quotation">{TYPE_LABELS.quotation[locale]}</option>
                      <option value="invoice">{TYPE_LABELS.invoice[locale]}</option>
                      <option value="receipt">{TYPE_LABELS.receipt[locale]}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '狀態' : 'Status'}</label>
                    <select
                      value={form.status}
                      onChange={(e) => updateForm({ status: e.target.value as DocumentStatus })}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    >
                      {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s][locale]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '發出日期' : 'Issue date'}</label>
                    <input
                      type="date"
                      value={form.issueDate}
                      onChange={(e) => updateForm({ issueDate: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                  {form.type === 'invoice' && (
                    <div>
                      <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '到期日' : 'Due date'}</label>
                      <input
                        type="date"
                        value={form.dueDate}
                        onChange={(e) => updateForm({ dueDate: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                      />
                    </div>
                  )}
                  {form.type === 'receipt' && (
                    <div>
                      <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '收款日期' : 'Paid date'}</label>
                      <input
                        type="date"
                        value={form.paidDate || form.issueDate}
                        onChange={(e) => updateForm({ paidDate: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                      />
                    </div>
                  )}
                </div>

                {/* Linked booking */}
                <div className="mb-5">
                  <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">
                    {locale === 'zh' ? '關聯預訂' : 'Linked booking'}
                  </label>
                  {form.bookingId
                    ? (() => {
                        const linked = bookings.find((b) => b.id === form.bookingId);
                        const v = linked && venues.find((vn) => vn.id === linked.venueId);
                        return (
                          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-pink/10 border border-pink/30">
                            <div className="text-sm text-ink min-w-0">
                              <div className="font-semibold flex items-center gap-2">
                                <LinkIcon size={14} className="text-pink flex-shrink-0" />
                                {linked
                                  ? `${linked.date} · ${v?.name[locale] || linked.venueId} · ${linked.startTime}-${linked.endTime}`
                                  : (locale === 'zh' ? '已連結預訂（已刪除）' : 'Linked booking (removed)')}
                              </div>
                              {linked && (
                                <div className="text-xs text-ink-soft mt-0.5 truncate">
                                  {usersById[linked.userId]?.displayName ||
                                    usersById[linked.userId]?.email ||
                                    `User: ${linked.userId.slice(0, 8)}`}
                                  {' · '}
                                  HK${linked.pricing.subtotal.toLocaleString()}
                                  {' + '}
                                  {locale === 'zh' ? '按金 ' : 'Deposit '}
                                  HK${(linked.pricing.securityDeposit
                                      ?? calculateSecurityDeposit(linked.pricing.subtotal)
                                    ).toLocaleString()}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => setPickerOpen(true)}
                                className="px-3 py-1.5 rounded-pill text-xs font-medium bg-white/80 hover:bg-white text-ink-soft hover:text-pink border border-white/80"
                              >
                                {locale === 'zh' ? '更換' : 'Change'}
                              </button>
                              <button
                                type="button"
                                onClick={() => updateForm({ bookingId: null, venueId: null })}
                                className="px-3 py-1.5 rounded-pill text-xs font-medium bg-white/80 hover:bg-rose-50 text-ink-soft hover:text-rose-600 border border-white/80"
                              >
                                {locale === 'zh' ? '取消連結' : 'Unlink'}
                              </button>
                            </div>
                          </div>
                        );
                      })()
                    : (
                      <button
                        type="button"
                        onClick={() => {
                          setPickerSearch('');
                          setPickerStatus('active');
                          setPickerOpen(true);
                        }}
                        className="w-full px-4 py-3 rounded-2xl border-2 border-dashed border-pink/40 bg-pink/5 hover:bg-pink/10 text-pink font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                      >
                        <LinkIcon size={14} />
                        {locale === 'zh' ? '從預訂載入（自動填寫客戶與項目）' : 'Load from booking (auto-fill)'}
                      </button>
                    )}
                </div>

                {/* Customer info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '客戶名稱' : 'Customer name'} *</label>
                    <input
                      type="text"
                      value={form.customerName}
                      onChange={(e) => updateForm({ customerName: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '電郵' : 'Email'}</label>
                    <input
                      type="email"
                      value={form.customerEmail}
                      onChange={(e) => updateForm({ customerEmail: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '電話' : 'Phone'}</label>
                    <input
                      type="text"
                      value={form.customerPhone}
                      onChange={(e) => updateForm({ customerPhone: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '地址' : 'Address'}</label>
                    <input
                      type="text"
                      value={form.customerAddress}
                      onChange={(e) => updateForm({ customerAddress: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                </div>

                {/* Preset items quick-pick */}
                <div className="mb-3">
                  <label className="text-xs text-ink-soft font-semibold uppercase tracking-wider mb-2 block">
                    {locale === 'zh' ? '快速加入預設項目' : 'Quick presets'}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_ITEMS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => addPresetItem(p.key)}
                        className="px-3 py-1.5 rounded-pill bg-white/60 backdrop-blur-md border border-white/80 text-ink-soft hover:text-pink hover:bg-white/90 text-xs font-medium transition-colors"
                      >
                        + {p.label[locale]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Line items */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-ink-soft font-semibold uppercase tracking-wider">{locale === 'zh' ? '項目' : 'Line items'}</label>
                    <button
                      type="button"
                      onClick={addItem}
                      className="text-xs text-pink font-semibold hover:underline inline-flex items-center gap-1"
                    >
                      <Plus size={12} /> {locale === 'zh' ? '加空白行' : 'Add blank row'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.items.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <textarea
                          value={it.description}
                          onChange={(e) => updateItem(idx, { description: e.target.value })}
                          placeholder={locale === 'zh' ? '描述（支援多行 / 中英對照）' : 'Description (multi-line supported)'}
                          rows={Math.max(1, (it.description.match(/\n/g) || []).length + 1)}
                          className="col-span-6 px-4 py-2 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink text-sm leading-relaxed resize-none"
                        />
                        <input
                          type="number"
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                          placeholder="Qty"
                          className="col-span-2 px-3 py-2 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink text-sm"
                        />
                        <input
                          type="number"
                          value={it.unitPrice}
                          onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                          placeholder="Price"
                          className="col-span-2 px-3 py-2 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink text-sm"
                        />
                        <span className="col-span-1 text-sm font-bold text-ink text-right pr-1 mt-2">${(it.amount || 0).toLocaleString()}</span>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="col-span-1 w-8 h-8 rounded-xl bg-rose-100/80 text-rose-700 flex items-center justify-center hover:bg-rose-200 mx-auto mt-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals + adjustments */}
                <div className="bg-white/40 backdrop-blur-md rounded-2xl border border-white/60 p-4 mb-5">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-ink-soft">{locale === 'zh' ? '小計' : 'Subtotal'}</span>
                    <span className="font-medium text-ink">HK${form.subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <span className="text-ink-soft flex-1">{locale === 'zh' ? '折扣' : 'Discount'}</span>
                    <input
                      type="number"
                      value={form.discount}
                      onChange={(e) => updateForm({ discount: Number(e.target.value) })}
                      className="w-24 px-3 py-1.5 rounded-pill bg-white/80 border border-white/80 text-ink text-right text-sm"
                    />
                    <select
                      value={form.discountType}
                      onChange={(e) => updateForm({ discountType: e.target.value as 'amount' | 'percent' })}
                      className="px-3 py-1.5 rounded-pill bg-white/80 border border-white/80 text-ink text-sm"
                    >
                      <option value="amount">HK$</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                  <div className="flex justify-between items-baseline pt-2 border-t border-white/60">
                    <span className="font-bold text-ink">{locale === 'zh' ? '總額' : 'Total'}</span>
                    <span className="font-bold font-display text-2xl text-gradient-pink">HK${form.total.toLocaleString()}</span>
                  </div>
                </div>

                {/* Payment Terms picker — quotation / invoice only.
                 *  Receipts are issued post-payment, so the terms
                 *  picker is hidden and the Notes block is replaced
                 *  with a short thank-you (Heidi's 2026-05-23 spec). */}
                {form.type !== 'receipt' && (
                  <div className="mb-3">
                    <label className="text-xs text-ink-soft mb-2 block font-semibold uppercase tracking-wider inline-flex items-center gap-1.5">
                      <Wallet size={12} className="text-pink" />
                      {locale === 'zh' ? '付款條款 (一鍵套用至附註)' : 'Payment terms (auto-fills notes)'}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      {(Object.keys(PAYMENT_TERMS) as PaymentTermKey[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => applyPaymentTerm(k)}
                          className={`flex-1 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all border text-left ${
                            paymentTerm === k
                              ? 'bg-gradient-pink text-white border-transparent shadow-glow'
                              : 'bg-white/60 text-ink-soft border-white/80 hover:bg-white/90 hover:text-ink backdrop-blur-md'
                          }`}
                        >
                          {PAYMENT_TERMS[k].label[locale]}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateForm({ terms: STANDARD_TERMS })}
                        className="px-4 py-2.5 rounded-2xl text-xs font-medium border bg-white/60 text-ink-soft border-white/80 hover:bg-white/90 hover:text-ink backdrop-blur-md"
                        title={locale === 'zh' ? '套用標準條款' : 'Apply standard terms'}
                      >
                        {locale === 'zh' ? '↻ 重設條款' : '↻ Reset terms'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Notes & terms — receipt skips the terms column
                 *  entirely and uses a single thank-you notes box. */}
                {form.type === 'receipt' ? (
                  <div className="mb-5">
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">
                      {locale === 'zh' ? '附註 Notes (中英對照)' : 'Notes (bilingual)'}
                    </label>
                    <textarea
                      value={form.notes}
                      onChange={(e) => updateForm({ notes: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink text-xs leading-relaxed font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => updateForm({ notes: RECEIPT_THANK_YOU })}
                      className="mt-2 text-[11px] text-pink hover:underline"
                    >
                      {locale === 'zh' ? '↻ 重設為標準感謝語' : '↻ Reset to default thank-you'}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                    <div>
                      <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '附註 Notes (中英對照)' : 'Notes (bilingual)'}</label>
                      <textarea
                        value={form.notes}
                        onChange={(e) => updateForm({ notes: e.target.value })}
                        rows={8}
                        className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink text-xs leading-relaxed font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">{locale === 'zh' ? '條款 Terms (中英對照)' : 'Terms (bilingual)'}</label>
                      <textarea
                        value={form.terms}
                        onChange={(e) => updateForm({ terms: e.target.value })}
                        rows={8}
                        className="w-full px-4 py-3 rounded-2xl bg-white/70 backdrop-blur-md border border-white/80 text-ink text-xs leading-relaxed font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Edit history */}
                {editingId && (
                  <div className="mb-5">
                    <button
                      type="button"
                      onClick={() => setShowHistory((s) => !s)}
                      className="text-xs font-semibold text-ink-soft hover:text-pink inline-flex items-center gap-1"
                    >
                      <History size={12} />
                      {locale === 'zh' ? '修改紀錄' : 'Revision history'} ({docs.find((d) => d.id === editingId)?.revisions?.length || 0})
                    </button>
                    {showHistory && (
                      <div className="mt-3 max-h-40 overflow-y-auto bg-white/40 backdrop-blur-md rounded-2xl border border-white/60 p-3 space-y-2">
                        {(docs.find((d) => d.id === editingId)?.revisions || []).map((r, i) => {
                          const ts = (r.timestamp as { seconds?: number; toDate?: () => Date }) ?? null;
                          const date = ts && typeof ts === 'object' && 'seconds' in ts && ts.seconds
                            ? new Date(ts.seconds * 1000)
                            : ts && typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function'
                            ? ts.toDate()
                            : new Date();
                          return (
                            <div key={i} className="text-xs text-ink-soft flex justify-between">
                              <span>{date.toLocaleString(locale === 'zh' ? 'zh-HK' : 'en-HK')}</span>
                              <span>{r.editedByEmail || r.editedBy}</span>
                            </div>
                          );
                        })}
                        {(docs.find((d) => d.id === editingId)?.revisions?.length || 0) === 0 && (
                          <p className="text-xs text-ink-soft italic">{locale === 'zh' ? '尚未有修改紀錄' : 'No revisions yet'}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Footer actions */}
                <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2 border-t border-white/40">
                  <button
                    onClick={() => setEditorOpen(false)}
                    className="btn-glass justify-center sm:flex-1"
                  >
                    {locale === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  {editingId && (
                    <Link
                      href={`/admin/documents/${editingId}/print`}
                      className="btn-glass justify-center inline-flex items-center sm:flex-1"
                    >
                      <Eye size={16} /> {locale === 'zh' ? '預覽 / 列印' : 'Preview / Print'}
                    </Link>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary justify-center sm:flex-1 disabled:opacity-50"
                  >
                    {saving ? '...' : (editingId ? (locale === 'zh' ? '儲存修改' : 'Save changes') : (locale === 'zh' ? '建立' : 'Create'))}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============ Booking Picker Modal ============ */}
      <AnimatePresence>
        {pickerOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/55 backdrop-blur-md"
              onClick={() => setPickerOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.22 }}
              className="relative w-full max-w-2xl"
            >
              <div className="glass-strong rounded-[28px] p-6 max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-4 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow">
                      <LinkIcon size={20} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold font-display text-ink">
                        {locale === 'zh' ? '從預訂載入' : 'Load from Booking'}
                      </h2>
                      <p className="text-xs text-ink-soft">
                        {locale === 'zh' ? '揀一個預訂自動填寫客戶資料、項目同價錢' : 'Pick a booking to auto-fill customer, items and pricing'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPickerOpen(false)}
                    className="w-9 h-9 rounded-full bg-white/60 flex items-center justify-center hover:bg-white/90 transition-colors text-ink-soft"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Search + status filter */}
                <div className="flex flex-col sm:flex-row gap-2 mb-3 flex-shrink-0">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" />
                    <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder={locale === 'zh' ? '搜尋日期、場地、客戶...' : 'Search date, venue, customer...'}
                      className="w-full pl-10 pr-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink text-sm"
                    />
                  </div>
                  <select
                    value={pickerStatus}
                    onChange={(e) => setPickerStatus(e.target.value as typeof pickerStatus)}
                    className="px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink text-sm"
                  >
                    <option value="active">{locale === 'zh' ? '可用 (待處理 + 已確認 + 已完成)' : 'Active (pending + confirmed + completed)'}</option>
                    <option value="pending">{locale === 'zh' ? '待處理' : 'Pending'}</option>
                    <option value="confirmed">{locale === 'zh' ? '已確認' : 'Confirmed'}</option>
                    <option value="completed">{locale === 'zh' ? '已完成' : 'Completed'}</option>
                    <option value="all">{locale === 'zh' ? '全部 (含取消)' : 'All (incl. cancelled)'}</option>
                  </select>
                </div>

                {/* Booking list */}
                <div className="flex-1 overflow-y-auto -mx-2 px-2">
                  {(() => {
                    const filtered = bookings
                      .filter((b) => {
                        if (pickerStatus === 'active') {
                          if (b.status === 'cancelled') return false;
                        } else if (pickerStatus !== 'all' && b.status !== pickerStatus) {
                          return false;
                        }
                        if (pickerSearch) {
                          const s = pickerSearch.toLowerCase();
                          const v = venues.find((vn) => vn.id === b.venueId);
                          const u = usersById[b.userId];
                          const haystack = [
                            b.date,
                            b.venueId,
                            v?.name.zh,
                            v?.name.en,
                            u?.displayName,
                            u?.email,
                            u?.phone,
                          ]
                            .filter(Boolean)
                            .join(' ')
                            .toLowerCase();
                          if (!haystack.includes(s)) return false;
                        }
                        return true;
                      })
                      .sort((a, b) => (a.date < b.date ? 1 : -1));

                    if (filtered.length === 0) {
                      return (
                        <div className="text-center py-12 text-ink-soft text-sm">
                          {locale === 'zh' ? '沒有符合條件的預訂' : 'No matching bookings'}
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2 pb-2">
                        {filtered.map((b) => {
                          const v = venues.find((vn) => vn.id === b.venueId);
                          const profile = usersById[b.userId];
                          const isLoading = pickerLoading === b.id;
                          const statusStyle =
                            b.status === 'confirmed'
                              ? 'bg-emerald-100/80 text-emerald-700 border-emerald-200'
                              : b.status === 'pending' || b.status === 'awaiting_payment'
                              ? 'bg-amber-100/80 text-amber-700 border-amber-200'
                              : b.status === 'completed'
                              ? 'bg-sky-100/80 text-sky-700 border-sky-200'
                              : 'bg-rose-100/80 text-rose-700 border-rose-200';
                          return (
                            <button
                              key={b.id}
                              onClick={() => prefillFromBooking(b.id)}
                              disabled={isLoading}
                              className="w-full text-left p-4 rounded-2xl bg-white/60 hover:bg-white/90 border border-white/80 hover:border-pink/40 hover:shadow-glow transition-all disabled:opacity-60 group"
                            >
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                                  <CalendarDays size={14} className="text-pink" />
                                  {b.date}
                                  <span className="text-ink-soft font-normal">·</span>
                                  <span className="font-normal">{b.startTime}-{b.endTime}</span>
                                </div>
                                <span className={`px-2 py-0.5 rounded-pill text-[10px] font-medium border ${statusStyle}`}>
                                  {b.status}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-ink-soft">
                                <div className="flex items-center gap-1.5 truncate">
                                  <MapPin size={12} className="text-coral flex-shrink-0" />
                                  <span className="truncate">{v?.name[locale] || b.venueId}</span>
                                </div>
                                <div className="flex items-center gap-1.5 truncate">
                                  <Users size={12} className="text-lavender flex-shrink-0" />
                                  <span className="truncate">
                                    {profile?.displayName || profile?.email || `(uid ${b.userId.slice(0, 6)})`}
                                    {' · '}
                                    {b.guestCount} pax
                                  </span>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-xs">
                                <span className="text-ink-soft">
                                  {locale === 'zh' ? '總額' : 'Total'}{' '}
                                  <span className="font-bold text-gradient-pink">HK${b.pricing.subtotal.toLocaleString()}</span>
                                  {(() => {
                                    // Show the REFUNDABLE security deposit (按金),
                                    // not the upfront payment amount.
                                    const sd =
                                      b.pricing.securityDeposit
                                      ?? calculateSecurityDeposit(b.pricing.subtotal);
                                    return sd > 0 ? (
                                      <span className="text-ink-soft">
                                        {' + '}
                                        {locale === 'zh' ? '按金' : 'Deposit'} HK${sd.toLocaleString()}
                                      </span>
                                    ) : null;
                                  })()}
                                </span>
                                <span className="text-pink font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                                  {isLoading ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <>
                                      {locale === 'zh' ? '使用' : 'Use'}
                                      <span>→</span>
                                    </>
                                  )}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ============ Export Modal ============ */}
      <AnimatePresence>
        {exportOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/55 backdrop-blur-md"
              onClick={() => setExportOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.22 }}
              className="relative w-full max-w-md"
            >
              <div className="glass-strong rounded-[28px] p-7">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-cool flex items-center justify-center text-white shadow-glow-purple">
                      <Download size={20} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold font-display text-ink">
                        {locale === 'zh' ? '匯出單據紀錄' : 'Export Documents'}
                      </h2>
                      <p className="text-xs text-ink-soft">
                        {locale === 'zh' ? '匯出為 CSV / Excel 檔案' : 'Export as CSV / Excel-compatible file'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setExportOpen(false)}
                    className="w-9 h-9 rounded-full bg-white/60 flex items-center justify-center hover:bg-white/90 transition-colors text-ink-soft"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Date range */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">
                      {locale === 'zh' ? '開始日期' : 'From date'}
                    </label>
                    <input
                      type="date"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">
                      {locale === 'zh' ? '結束日期' : 'To date'}
                    </label>
                    <input
                      type="date"
                      value={exportTo}
                      onChange={(e) => setExportTo(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                    />
                  </div>
                </div>

                {/* Type filter */}
                <div className="mb-5">
                  <label className="text-xs text-ink-soft mb-1 block font-semibold uppercase tracking-wider">
                    {locale === 'zh' ? '單據類型' : 'Document type'}
                  </label>
                  <select
                    value={exportType}
                    onChange={(e) => setExportType(e.target.value as DocumentType | 'all')}
                    className="w-full px-4 py-2.5 rounded-pill bg-white/70 backdrop-blur-md border border-white/80 text-ink"
                  >
                    <option value="all">{locale === 'zh' ? '全部類型' : 'All types'}</option>
                    <option value="quotation">{locale === 'zh' ? '報價單' : 'Quotations'}</option>
                    <option value="invoice">{locale === 'zh' ? '發票' : 'Invoices'}</option>
                    <option value="receipt">{locale === 'zh' ? '收據' : 'Receipts'}</option>
                  </select>
                </div>

                {/* Quick range presets */}
                <div className="mb-5">
                  <label className="text-xs text-ink-soft mb-2 block font-semibold uppercase tracking-wider">
                    {locale === 'zh' ? '快速範圍' : 'Quick range'}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { key: 'thisMonth', zh: '本月', en: 'This month' },
                      { key: 'lastMonth', zh: '上月', en: 'Last month' },
                      { key: 'thisYear', zh: '今年', en: 'This year' },
                      { key: 'lastYear', zh: '去年', en: 'Last year' },
                    ] as const).map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          const now = new Date();
                          const y = now.getFullYear();
                          const m = now.getMonth();
                          const pad = (n: number) => String(n).padStart(2, '0');
                          if (p.key === 'thisMonth') {
                            setExportFrom(`${y}-${pad(m + 1)}-01`);
                            setExportTo(now.toISOString().split('T')[0]);
                          } else if (p.key === 'lastMonth') {
                            const d1 = new Date(y, m - 1, 1);
                            const d2 = new Date(y, m, 0);
                            setExportFrom(d1.toISOString().split('T')[0]);
                            setExportTo(d2.toISOString().split('T')[0]);
                          } else if (p.key === 'thisYear') {
                            setExportFrom(`${y}-01-01`);
                            setExportTo(`${y}-12-31`);
                          } else if (p.key === 'lastYear') {
                            setExportFrom(`${y - 1}-01-01`);
                            setExportTo(`${y - 1}-12-31`);
                          }
                        }}
                        className="px-3 py-1.5 rounded-pill bg-white/60 backdrop-blur-md border border-white/80 text-ink-soft hover:text-pink hover:bg-white/90 text-xs font-medium transition-colors"
                      >
                        {p[locale]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2 pt-4 border-t border-white/40">
                  <button
                    onClick={() => setExportOpen(false)}
                    className="btn-glass justify-center sm:flex-1"
                  >
                    {locale === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button onClick={handleExport} className="btn-primary justify-center sm:flex-1">
                    <Download size={16} />
                    {locale === 'zh' ? '下載 CSV' : 'Download CSV'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
