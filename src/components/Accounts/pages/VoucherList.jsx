import { useParams } from '../lib/router';
import DayBook from './DayBook';
import { KINDS } from './SimpleVoucher';

/** Posting → Vouchers: every voucher menu opens the list of that voucher type first; "+ New …" (F1) opens the entry form. */
export default function VoucherList() {
  const { kind } = useParams();
  const m = KINDS[kind];
  if (!m) return <DayBook title="Vouchers" />;
  return <DayBook key={kind} fixedKind={kind} title={`${m.icon} ${m.title}`} sub={m.hint} newTo={`/entry/${kind}`} newLabel={m.title.toLowerCase()} />;
}
