// ─────────────────────────────────────────────────────────────────────────────
// A stand-in for TallyPrime's data port, for building and testing without it.
//
// It answers the connector's reports the way TallyPrime does — XML over HTTP,
// in UTF-16, rows of numbered tags, debits negative, dates as YYYY-MM-DD — from
// the sample company, with balances worked out for whatever period is asked.
// It recognises a request by its report name and honours the period, the
// company and the AlterID filter, which is enough to exercise every path the
// connector takes: the first full sync, an incremental one, and deletions.
//
// It is not TallyPrime. It proves the connector reads and sends correctly; the
// first run against a real Tally proves the TDL is right.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import type { TallyVoucher } from '../../lib/tally/protocol';
import { SAMPLE_COMPANY_GUID, SAMPLE_COMPANY_NAME, SAMPLE_FY_FROM, sampleCompany } from '../../scripts/tally/sample-company';
import { NULL_MARK, xmlEscape } from './tally-requests';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1-Apr-2026" → "2026-04-01". */
function fromTdlDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Paise with debits positive → rupees as Tally writes them, debits negative. */
const tallyAmount = (paise: number) => (-paise / 100).toFixed(2);

export class FakeTallyData {
  readonly booksFrom = '2024-04-01';
  readonly name = SAMPLE_COMPANY_NAME;
  vouchers: TallyVoucher[];
  private readonly sample;
  private readonly revenueGroups: Set<string>;

  constructor(today: string) {
    this.sample = sampleCompany(today);
    this.vouchers = [...this.sample.vouchers];
    this.revenueGroups = new Set(this.sample.masters.groups.filter((g) => g.nature === 'income' || g.nature === 'expenses').map((g) => g.name));
  }

  get altVchId() {
    return this.vouchers.reduce((t, v) => Math.max(t, v.alterId), 0);
  }

  /** A voucher entered in Tally after the first sync. */
  addVoucher(v: Omit<TallyVoucher, 'alterId'>) {
    this.vouchers.push({ ...v, alterId: this.altVchId + 1 });
  }

  deleteVoucher(guid: string) {
    this.vouchers = this.vouchers.filter((v) => v.guid !== guid);
  }

  private counted = (v: TallyVoucher) => !v.isCancelled && !v.isOptional;

  /** A ledger's balance as Tally reports it on `to`: running for balance sheet ledgers, the year so far for the rest. */
  private closing(ledger: { name: string; parent: string; openingPaise: number }, to: string): number {
    const revenue = this.revenueGroups.has(ledger.parent);
    const fyStart = to.slice(5) >= '04-01' ? `${to.slice(0, 4)}-04-01` : `${Number(to.slice(0, 4)) - 1}-04-01`;
    let balance = revenue ? 0 : ledger.openingPaise;
    for (const v of this.vouchers) {
      if (!this.counted(v) || v.date > to || (revenue && v.date < fyStart)) continue;
      for (const e of v.entries) if (e.ledger === ledger.name) balance += e.debitPaise - e.creditPaise;
    }
    return balance;
  }

  rows(id: string, from: string | null, to: string | null, afterAlterId: number): string[][] {
    const inPeriod = (v: TallyVoucher) => (!from || v.date >= from) && (!to || v.date <= to);
    const asAt = to ?? '9999-12-31';
    switch (id) {
      case 'RekonzaCompanies':
        return [[SAMPLE_COMPANY_GUID, this.name, this.booksFrom, this.booksFrom, '500', String(this.altVchId)]];
      case 'RekonzaGroups':
        return this.sample.masters.groups.map((g) => [
          g.guid ?? '', g.name, g.parent ?? '',
          g.nature === 'income' || g.nature === 'expenses' ? '1' : '0',
          g.nature === 'assets' || g.nature === 'expenses' ? '1' : '0',
          g.affectsGrossProfit ? '1' : '0',
        ]);
      case 'RekonzaLedgers':
        return this.sample.masters.ledgers.map((l) => [
          l.guid ?? '', l.name, l.parent === 'Primary' ? '' : l.parent,
          tallyAmount(l.openingPaise), tallyAmount(this.closing(l, asAt)), l.gstin ?? '', l.stateName ?? '',
        ]);
      case 'RekonzaStockItems':
        return this.sample.masters.stockItems.map((s) => {
          // Before the year began, stock stood where it opened; after, where the sample closes.
          const before = asAt < SAMPLE_FY_FROM;
          return [
            s.guid ?? '', s.name, s.parent ?? '', s.unit ?? '', s.hsn ?? '',
            String(s.openingQty), tallyAmount(s.openingValuePaise),
            String(before ? s.openingQty : s.closingQty), tallyAmount(before ? s.openingValuePaise : s.closingValuePaise),
          ];
        });
      case 'RekonzaVoucherTypes':
        return [...new Set(this.vouchers.map((v) => v.voucherType))].map((t) => [t, t]);
      case 'RekonzaVouchers':
        return this.vouchers
          .filter((v) => inPeriod(v) && v.alterId > afterAlterId)
          .map((v) => [
            v.guid, String(v.alterId), v.voucherType, v.date, v.number ?? '', v.party ?? '', v.narration ?? '', v.reference ?? '',
            v.isCancelled ? '1' : '0', v.isOptional ? '1' : '0',
          ]);
      case 'RekonzaEntries':
        return this.vouchers
          .filter((v) => inPeriod(v) && v.alterId > afterAlterId && !v.isCancelled)
          .flatMap((v) => v.entries.map((e) => [v.guid, e.ledger, tallyAmount(e.debitPaise - e.creditPaise)]));
      case 'RekonzaVoucherGuids':
        return this.vouchers.filter(inPeriod).map((v) => [v.guid]);
      default:
        throw new Error(`Unknown report ${id}`);
    }
  }
}

function reply(rows: string[][]): string {
  const body = rows
    .map((r) => r.map((v, i) => `<F${String(i + 1).padStart(2, '0')}>${v === '' && i > 0 ? '' : xmlEscape(v)}</F${String(i + 1).padStart(2, '0')}>`).join(''))
    .join('\r\n');
  return `<ENVELOPE>\r\n${body}\r\n</ENVELOPE>`;
}

export interface FakeTally {
  port: number;
  data: FakeTallyData;
  /** Every report asked for, in order: what a test checks the connector did. */
  requests: string[];
  close(): Promise<void>;
}

export function startFakeTally(opts: { port?: number; today: string; host?: string }): Promise<FakeTally> {
  const data = new FakeTallyData(opts.today);
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const xml = Buffer.concat(chunks).toString('utf16le');
      const id = xml.match(/<ID>([^<]+)<\/ID>/)?.[1] ?? '';
      const company = xml.match(/<SVCURRENTCOMPANY>([^<]*)<\/SVCURRENTCOMPANY>/)?.[1];
      const from = fromTdlDate(xml.match(/<SVFROMDATE>([^<]+)<\/SVFROMDATE>/)?.[1]);
      const to = fromTdlDate(xml.match(/<SVTODATE>([^<]+)<\/SVTODATE>/)?.[1]);
      const after = Number(xml.match(/\$AlterID &gt; (\d+)/)?.[1] ?? 0);
      seen.push(id);

      let out: string;
      if (company !== undefined && company !== xmlEscape(data.name)) {
        out = `<ENVELOPE><LINEERROR>Could not find Company '${company}'</LINEERROR></ENVELOPE>`;
      } else {
        try {
          out = reply(data.rows(id, from, to, after));
        } catch (err) {
          out = `<ENVELOPE><LINEERROR>${xmlEscape((err as Error).message)}</LINEERROR></ENVELOPE>`;
        }
      }
      const buf = Buffer.from(out, 'utf16le');
      res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-16', 'Content-Length': buf.length });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : (opts.port ?? 0),
        data,
        requests: seen,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

export { NULL_MARK };
