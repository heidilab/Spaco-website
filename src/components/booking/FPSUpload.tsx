'use client';

import { useState, useRef } from 'react';
import { useLocale } from 'next-intl';
import { Upload, Check, Clock, Copy } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';

interface FPSUploadProps {
  bookingId: string;
  amount: number;
  onUploadComplete: (receiptUrl: string) => void;
}

export default function FPSUpload({ bookingId, amount, onUploadComplete }: FPSUploadProps) {
  const locale = useLocale() as 'zh' | 'en';
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fpsNumber = '91234567'; // Replace with real FPS number
  const bankAccount = '012-345-6789-001'; // Replace with real bank account
  const bankName = locale === 'zh' ? '恒生銀行' : 'Hang Seng Bank';

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const storageRef = ref(storage, `receipts/${bookingId}-${Date.now()}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setUploaded(true);
      onUploadComplete(url);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadlineStr = deadline.toLocaleDateString(locale === 'zh' ? 'zh-HK' : 'en-HK', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="space-y-6">
      {/* Deadline Warning */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 flex items-start gap-3">
        <Clock size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-yellow-800">
            {locale === 'zh' ? '請於 24 小時內完成付款' : 'Complete payment within 24 hours'}
          </p>
          <p className="text-sm text-yellow-700 mt-1">
            {locale === 'zh' ? `截止時間：${deadlineStr}` : `Deadline: ${deadlineStr}`}
          </p>
          <p className="text-xs text-yellow-600 mt-2">
            {locale === 'zh' ? '逾時未上傳入數紙將自動取消預約' : 'Booking will be auto-cancelled if receipt is not uploaded in time'}
          </p>
        </div>
      </div>

      {/* Payment Info */}
      <div className="bg-white rounded-2xl p-6 border border-charcoal/5 space-y-4">
        <h3 className="font-bold">
          {locale === 'zh' ? '付款資料' : 'Payment Details'}
        </h3>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-cream rounded-xl">
            <div>
              <p className="text-xs text-muted">{locale === 'zh' ? '應付金額' : 'Amount Due'}</p>
              <p className="text-xl font-bold">HK${amount.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-cream rounded-xl">
            <div>
              <p className="text-xs text-muted">FPS {locale === 'zh' ? '轉數快號碼' : 'Number'}</p>
              <p className="font-semibold">{fpsNumber}</p>
            </div>
            <button
              onClick={() => copyToClipboard(fpsNumber, 'fps')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-sm hover:bg-charcoal/5 transition-colors"
            >
              {copied === 'fps' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied === 'fps' ? (locale === 'zh' ? '已複製' : 'Copied') : (locale === 'zh' ? '複製' : 'Copy')}
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-cream rounded-xl">
            <div>
              <p className="text-xs text-muted">{locale === 'zh' ? '銀行帳號' : 'Bank Account'} ({bankName})</p>
              <p className="font-semibold">{bankAccount}</p>
            </div>
            <button
              onClick={() => copyToClipboard(bankAccount, 'bank')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-sm hover:bg-charcoal/5 transition-colors"
            >
              {copied === 'bank' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied === 'bank' ? (locale === 'zh' ? '已複製' : 'Copied') : (locale === 'zh' ? '複製' : 'Copy')}
            </button>
          </div>
        </div>
      </div>

      {/* Upload Area */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      {uploaded ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
          <Check size={32} className="mx-auto mb-3 text-green-500" />
          <p className="font-semibold text-green-700">
            {locale === 'zh' ? '入數紙已上傳' : 'Receipt Uploaded'}
          </p>
          <p className="text-sm text-green-600 mt-1">
            {locale === 'zh' ? '我們會於確認收款後通知你' : 'We will notify you once payment is verified'}
          </p>
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-charcoal/20 rounded-2xl p-8 text-center hover:border-accent hover:bg-accent/5 transition-all disabled:opacity-50"
        >
          {uploading ? (
            <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto" />
          ) : (
            <>
              <Upload size={32} className="mx-auto mb-3 text-charcoal/30" />
              <p className="font-semibold">{locale === 'zh' ? '上傳入數紙截圖' : 'Upload Payment Receipt'}</p>
              <p className="text-sm text-muted mt-1">{locale === 'zh' ? '支援 JPG、PNG 格式' : 'JPG, PNG supported'}</p>
            </>
          )}
        </button>
      )}
    </div>
  );
}
