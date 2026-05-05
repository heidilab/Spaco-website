'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { getDocument } from '@/lib/firestore';
import { BusinessDocument, DocumentType } from '@/types';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';

const TYPE_TITLES: Record<DocumentType, { zh: string; en: string }> = {
  quotation: { zh: '報價單', en: 'QUOTATION' },
  invoice: { zh: '發票', en: 'INVOICE' },
  receipt: { zh: '收據', en: 'RECEIPT' },
};

// Bilingual labels — printed on every document regardless of locale.
const L = {
  to: { zh: '收件 / Bill To', en: 'Bill To 收件' },
  toQuote: { zh: '報價對象 / Quoted To', en: 'Quoted To 報價對象' },
  description: 'Description 描述',
  qty: 'Qty 數量',
  unitPrice: 'Unit Price 單價',
  amount: 'Amount 小計',
  subtotal: 'Subtotal 小計',
  discount: 'Discount 折扣',
  total: 'TOTAL 總額',
  notes: 'Notes 附註',
  terms: 'Terms 條款',
  issueDate: 'Issue Date 發出日期',
  dueDate: 'Due Date 到期日',
  paidDate: 'Paid Date 收款日期',
};

export default function DocumentPrintPage() {
  const params = useParams();
  const id = params.id as string;
  const locale = useLocale() as 'zh' | 'en';
  const [doc, setDoc] = useState<BusinessDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDocument(id).then((d) => {
      setDoc(d);
      setLoading(false);
    });
  }, [id]);

  /**
   * Generate a clean PDF directly from the rendered document, with no
   * browser print dialog and no site chrome. Captures the print-area
   * via html2canvas, then assembles a multi-page A4 PDF with jsPDF.
   */
  const downloadPDF = async () => {
    const el = printAreaRef.current;
    if (!el || !doc) return;
    setGenerating(true);
    try {
      // Dynamic import — keeps jspdf/html2canvas out of the initial bundle
      const [{ default: html2canvas }, jsPDFModule] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const JsPDF = jsPDFModule.default;

      const canvas = await html2canvas(el, {
        scale: 2,                  // crisp text
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        // Strip preview-only decorations (rounded corners, shadow) from the
        // cloned DOM so the PDF is plain white-edged paper.
        onclone: (clonedDoc) => {
          const cloned = clonedDoc.querySelector('.print-area') as HTMLElement | null;
          if (cloned) {
            cloned.style.borderRadius = '0';
            cloned.style.boxShadow = 'none';
            cloned.style.maxWidth = '100%';
          }
        },
      });

      const pdf = new JsPDF('p', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();   // 210
      const pageH = pdf.internal.pageSize.getHeight();  // 297
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(dataUrl, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH;

      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(dataUrl, 'JPEG', 0, position, imgW, imgH);
        heightLeft -= pageH;
      }

      pdf.save(`${doc.number}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert(locale === 'zh' ? 'PDF 產生失敗，請再試。' : 'PDF generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="pt-28 text-center text-ink-soft">Loading...</div>;
  }
  if (!doc) {
    return (
      <div className="pt-28 text-center">
        <p className="text-ink-soft mb-4">{locale === 'zh' ? '找不到單據' : 'Document not found'}</p>
        <Link href="/admin/documents" className="btn-primary">
          {locale === 'zh' ? '返回列表' : 'Back to list'}
        </Link>
      </div>
    );
  }

  const typeTitleZh = TYPE_TITLES[doc.type].zh;
  const typeTitleEn = TYPE_TITLES[doc.type].en;

  return (
    <>

      <div className="min-h-screen pt-28 pb-12">
        {/* Toolbar */}
        <div className="no-print max-w-3xl mx-auto px-6 mb-6 flex items-center justify-between">
          <Link
            href="/admin/documents"
            className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-pink"
          >
            <ArrowLeft size={16} />
            {locale === 'zh' ? '返回單據列表' : 'Back to documents'}
          </Link>
          <button
            onClick={downloadPDF}
            disabled={generating}
            className="btn-primary disabled:opacity-60"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {generating
              ? (locale === 'zh' ? '正在產生 PDF...' : 'Generating PDF...')
              : (locale === 'zh' ? '下載 PDF' : 'Download PDF')}
          </button>
        </div>

        {/* Printable doc */}
        <div
          ref={printAreaRef}
          className="max-w-3xl mx-auto bg-white rounded-3xl shadow-glass-lg p-10 md:p-14 print-area">
          {/* Header — brand logo + type */}
          <div className="flex items-start justify-between gap-6 pb-6 border-b border-ink/10">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/spaco-logo.png"
                alt="SPACO"
                style={{ width: 120, height: 'auto' }}
                className="object-contain mb-2"
              />
              <p className="text-xs text-ink-soft mt-2 leading-relaxed">
                Hong Kong 香港<br />
                spacohk@gmail.com<br />
                +852 9282 3060
              </p>
            </div>
            <div className="text-right">
              <h1 className="font-display font-bold text-3xl text-ink leading-tight">{typeTitleEn}</h1>
              <p className="text-sm text-ink-soft">{typeTitleZh}</p>
              <p className="font-mono text-sm font-semibold mt-3 text-ink">{doc.number}</p>
              <p className="text-xs text-ink-soft mt-2">
                {L.issueDate}<br />
                <span className="text-ink font-medium">{doc.issueDate}</span>
              </p>
              {doc.type === 'invoice' && doc.dueDate && (
                <p className="text-xs text-ink-soft mt-1">
                  {L.dueDate}<br />
                  <span className="text-ink font-medium">{doc.dueDate}</span>
                </p>
              )}
              {doc.type === 'receipt' && doc.paidDate && (
                <p className="text-xs text-ink-soft mt-1">
                  {L.paidDate}<br />
                  <span className="text-ink font-medium">{doc.paidDate}</span>
                </p>
              )}
            </div>
          </div>

          {/* Bill to */}
          <div className="my-6">
            <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold mb-2">
              {doc.type === 'quotation' ? L.toQuote.en : L.to.en}
            </p>
            <p className="font-bold text-ink text-lg">{doc.customerName || '—'}</p>
            {doc.customerAddress && <p className="text-sm text-ink-soft">{doc.customerAddress}</p>}
            <div className="text-sm text-ink-soft flex flex-wrap gap-x-4 mt-1">
              {doc.customerEmail && <span>{doc.customerEmail}</span>}
              {doc.customerPhone && <span>{doc.customerPhone}</span>}
            </div>
          </div>

          {/* Line items table — bilingual headers */}
          <table className="w-full mb-6 border-collapse">
            <thead>
              <tr className="border-y-2 border-ink/15">
                <th className="text-left py-3 text-xs font-bold text-ink uppercase tracking-wider">
                  {L.description}
                </th>
                <th className="text-right py-3 text-xs font-bold text-ink uppercase tracking-wider w-20">{L.qty}</th>
                <th className="text-right py-3 text-xs font-bold text-ink uppercase tracking-wider w-28">{L.unitPrice}</th>
                <th className="text-right py-3 text-xs font-bold text-ink uppercase tracking-wider w-28">{L.amount}</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => (
                <tr key={i} className="border-b border-ink/5">
                  <td className="py-3 text-sm text-ink whitespace-pre-line align-top leading-relaxed">{it.description}</td>
                  <td className="py-3 text-sm text-ink-soft text-right align-top">{it.quantity}</td>
                  <td className="py-3 text-sm text-ink-soft text-right align-top">HK${(Number(it.unitPrice) || 0).toLocaleString()}</td>
                  <td className="py-3 text-sm text-ink font-medium text-right align-top">HK${(Number(it.amount) || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mb-8">
            <div className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-soft">{L.subtotal}</span>
                <span className="text-ink">HK${doc.subtotal.toLocaleString()}</span>
              </div>
              {doc.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-soft">
                    {L.discount}
                    {doc.discountType === 'percent' && ` (${doc.discount}%)`}
                  </span>
                  <span className="text-ink">
                    -HK${(doc.discountType === 'percent'
                      ? (doc.subtotal * doc.discount) / 100
                      : doc.discount
                    ).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t-2 border-ink/15">
                <span className="font-bold text-ink">{L.total}</span>
                <span className="font-bold text-xl text-ink">HK${doc.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Notes (full width — contains payment method which is wider) */}
          {doc.notes && (
            <div className="pt-6 mt-6 border-t border-ink/10">
              <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold mb-2">{L.notes}</p>
              <p className="text-sm text-ink whitespace-pre-line leading-relaxed">{doc.notes}</p>
            </div>
          )}

          {/* Terms (full width) */}
          {doc.terms && (
            <div className="pt-5 mt-5 border-t border-ink/10">
              <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold mb-2">{L.terms}</p>
              <p className="text-sm text-ink whitespace-pre-line leading-relaxed">{doc.terms}</p>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-ink-soft mt-10 pt-6 border-t border-ink/10">
            <p className="font-medium text-ink">www.spacohk.com</p>
            <p className="mt-1">SPACO owned by Cholliman Incorporation Limited</p>
            {doc.status === 'paid' && (
              <p className="text-emerald-600 font-bold mt-3 text-base tracking-widest">✓ PAID 已付款</p>
            )}
            {doc.status === 'void' && (
              <p className="text-rose-600 font-bold mt-3 text-base tracking-widest">VOID 作廢</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
