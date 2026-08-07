'use client';

// A4-styled tax invoice. Doubles as the on-screen preview and the print output.

import { QRCodeSVG } from 'qrcode.react';
import { useAppStore } from '@/lib/store';
import { formatINR } from '@/lib/money';
import { stateName } from '@/lib/tax/gst';

/** Amount in words — Indian numbering (lakh/crore), used on every tax invoice. */
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n: number): string =>
    n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`;
  const three = (n: number): string =>
    n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n);

  if (num === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(num / 1_00_00_000);
  const lakh = Math.floor((num % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((num % 1_00_000) / 1000);
  const rest = num % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(' ');
}

export function InvoicePrintSheet({ invoiceId }: { invoiceId: string }) {
  const s = useAppStore();
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) return null;
  const customer = s.contacts.find((c) => c.id === inv.customerId);
  const branch = s.branches.find((b) => b.id === inv.branchId);
  const org = s.org;

  const rupees = Math.floor(inv.totalPaise / 100);
  const paise = inv.totalPaise % 100;
  const isIntra = inv.tax.cgstPaise > 0;

  return (
    <div className="print-sheet mx-auto max-w-[820px] bg-white p-8 text-[13px] text-neutral-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-neutral-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{org?.name}</h1>
          <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-neutral-600">
            {branch?.address}
          </p>
          <p className="mt-1 text-[11px] text-neutral-600">
            GSTIN: <span className="font-mono font-semibold">{branch?.gstin}</span> · PAN: {org?.pan}
          </p>
          <p className="text-[11px] text-neutral-600">
            {org?.email} · {org?.phone}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase tracking-wide">Tax Invoice</p>
          <p className="mt-1 text-[11px] text-neutral-600">
            {inv.supplyType === 'export_lut' && 'SUPPLY MEANT FOR EXPORT UNDER LUT — WITHOUT PAYMENT OF IGST'}
            {inv.supplyType === 'sez' && 'SUPPLY TO SEZ UNIT — WITHOUT PAYMENT OF IGST'}
          </p>
          {inv.einvoice.qrPayload && (
            <div className="mt-2 flex flex-col items-end">
              <QRCodeSVG value={inv.einvoice.qrPayload} size={78} level="M" />
              <p className="mt-1 text-[9px] text-neutral-500">Signed QR (IRP)</p>
            </div>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-6 border-b border-neutral-300 py-3 text-[11px]">
        <div className="space-y-0.5">
          <p><span className="text-neutral-500">Invoice No:</span> <span className="font-semibold">{inv.number}</span></p>
          <p><span className="text-neutral-500">Invoice Date:</span> {new Date(inv.date).toLocaleDateString('en-IN')}</p>
          <p><span className="text-neutral-500">Due Date:</span> {new Date(inv.dueDate).toLocaleDateString('en-IN')}</p>
        </div>
        <div className="space-y-0.5">
          <p><span className="text-neutral-500">Place of Supply:</span> {inv.placeOfSupply} — {stateName(inv.placeOfSupply)}</p>
          {inv.einvoice.ackNo && <p><span className="text-neutral-500">Ack No:</span> {inv.einvoice.ackNo}</p>}
          {inv.ewayBillNo && <p><span className="text-neutral-500">E-Way Bill:</span> {inv.ewayBillNo}</p>}
        </div>
      </div>

      {inv.einvoice.irn && (
        <p className="break-all border-b border-neutral-300 py-2 text-[10px]">
          <span className="text-neutral-500">IRN:</span> <span className="font-mono">{inv.einvoice.irn}</span>
        </p>
      )}

      {/* Bill to */}
      <div className="border-b border-neutral-300 py-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Bill To</p>
        <p className="font-semibold">{customer?.displayName}</p>
        <p className="text-[11px] leading-relaxed text-neutral-600">
          {customer?.billingAddress.line1}, {customer?.billingAddress.city} {customer?.billingAddress.pincode}
        </p>
        <p className="text-[11px] text-neutral-600">
          {customer?.gstin ? <>GSTIN: <span className="font-mono">{customer.gstin}</span></> : 'Unregistered'}
          {' · '}State: {stateName(customer?.stateCode ?? '')}
        </p>
      </div>

      {/* Lines */}
      <table className="mt-3 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-y border-neutral-800 bg-neutral-100">
            <th className="px-1.5 py-1.5 text-left font-semibold">#</th>
            <th className="px-1.5 py-1.5 text-left font-semibold">Description</th>
            <th className="px-1.5 py-1.5 text-left font-semibold">HSN/SAC</th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Qty</th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Rate</th>
            <th className="px-1.5 py-1.5 text-right font-semibold">Taxable</th>
            {isIntra ? (
              <>
                <th className="px-1.5 py-1.5 text-right font-semibold">CGST</th>
                <th className="px-1.5 py-1.5 text-right font-semibold">SGST</th>
              </>
            ) : (
              <th className="px-1.5 py-1.5 text-right font-semibold">IGST</th>
            )}
            <th className="px-1.5 py-1.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, idx) => (
            <tr key={l.id} className="border-b border-neutral-200">
              <td className="px-1.5 py-1.5">{idx + 1}</td>
              <td className="px-1.5 py-1.5">{l.description}</td>
              <td className="px-1.5 py-1.5 font-mono">{l.hsnSac}</td>
              <td className="px-1.5 py-1.5 text-right">{l.qty} {l.uqc}</td>
              <td className="px-1.5 py-1.5 text-right">{formatINR(l.ratePaise)}</td>
              <td className="px-1.5 py-1.5 text-right">{formatINR(l.tax.taxablePaise)}</td>
              {isIntra ? (
                <>
                  <td className="px-1.5 py-1.5 text-right">
                    {formatINR(l.tax.cgstPaise)}<br />
                    <span className="text-[9px] text-neutral-500">{l.gstRatePct / 2}%</span>
                  </td>
                  <td className="px-1.5 py-1.5 text-right">
                    {formatINR(l.tax.sgstPaise)}<br />
                    <span className="text-[9px] text-neutral-500">{l.gstRatePct / 2}%</span>
                  </td>
                </>
              ) : (
                <td className="px-1.5 py-1.5 text-right">
                  {formatINR(l.tax.igstPaise)}<br />
                  <span className="text-[9px] text-neutral-500">{l.gstRatePct}%</span>
                </td>
              )}
              <td className="px-1.5 py-1.5 text-right font-medium">{formatINR(l.totalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-4 flex justify-between gap-8">
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Amount in words</p>
          <p className="mt-0.5 text-[11px] font-medium">
            Indian Rupees {numberToWords(rupees)}
            {paise > 0 && ` and ${numberToWords(paise)} Paise`} Only
          </p>
          {inv.terms && (
            <>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Terms</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-600">{inv.terms}</p>
            </>
          )}
        </div>
        <div className="w-64 shrink-0 space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span className="text-neutral-600">Taxable value</span>
            <span>{formatINR(inv.tax.taxablePaise)}</span>
          </div>
          {inv.tax.cgstPaise > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-neutral-600">CGST</span>
                <span>{formatINR(inv.tax.cgstPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">SGST</span>
                <span>{formatINR(inv.tax.sgstPaise)}</span>
              </div>
            </>
          )}
          {inv.tax.igstPaise > 0 && (
            <div className="flex justify-between">
              <span className="text-neutral-600">IGST</span>
              <span>{formatINR(inv.tax.igstPaise)}</span>
            </div>
          )}
          {inv.roundOffPaise !== 0 && (
            <div className="flex justify-between">
              <span className="text-neutral-600">Round off</span>
              <span>{formatINR(inv.roundOffPaise)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-neutral-800 pt-1.5 text-sm font-bold">
            <span>Total</span>
            <span>{formatINR(inv.totalPaise)}</span>
          </div>
          {inv.amountPaidPaise > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-neutral-600">Paid</span>
                <span>{formatINR(inv.amountPaidPaise)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance due</span>
                <span>{formatINR(inv.totalPaise - inv.amountPaidPaise)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 flex items-end justify-between border-t border-neutral-300 pt-4">
        <p className="max-w-xs text-[9px] leading-relaxed text-neutral-500">
          This is a computer-generated invoice.
          {inv.supplyType === 'export_lut' && ' Exported under LUT without payment of integrated tax.'}
        </p>
        <div className="text-center">
          <div className="h-12" />
          <p className="border-t border-neutral-400 px-8 pt-1 text-[10px]">
            For <span className="font-semibold">{org?.name}</span>
          </p>
          <p className="mt-0.5 text-[9px] text-neutral-500">Authorised Signatory</p>
        </div>
      </div>
    </div>
  );
}
