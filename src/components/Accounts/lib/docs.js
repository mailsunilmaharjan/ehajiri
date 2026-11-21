export const DOCS = {
  // quote: no books / stock; prints as the presentation-style quotation PDF; becomes a Sales Order
  QT: { name: 'Sales Quotation', np: 'कोटेसन', side: 'sales', role: 'order', next: 'SO', print: 'QUOTATION', quote: true },
  PO: { name: 'Purchase Order', np: 'खरिद आदेश', side: 'purchase', role: 'order', next: 'PB', print: 'PURCHASE ORDER' },
  PB: { name: 'Purchase', np: 'खरिद', side: 'purchase', role: 'bill', from: 'PO', ret: 'PR', print: 'PURCHASE ENTRY' },
  PR: { name: 'Purchase Return', np: 'खरिद फिर्ता', side: 'purchase', role: 'return', of: 'PB', print: 'DEBIT NOTE' },
  SO: { name: 'Sales Order', np: 'बिक्री आदेश', side: 'sales', role: 'order', from: 'QT', next: 'SI', print: 'SALES ORDER' },
  SI: { name: 'Sales Invoice', np: 'बिक्री', side: 'sales', role: 'bill', from: 'SO', ret: 'SR', print: 'TAX INVOICE' },
  SR: { name: 'Sales Return', np: 'बिक्री फिर्ता', side: 'sales', role: 'return', of: 'SI', print: 'CREDIT NOTE' },
};

export const PAY_MODES = [['credit', 'Credit'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['bank', 'QR Payment / Bank Transfer']];
/** Short number for grids: "SI/2083-84/0002" → "SI-83/84-0002" (the saved number is unchanged). */
export const shortDocNo = (no) => {
  const m = /^([A-Z]+)\/(\d{2,4})-(\d{2,4})\/(\d+)$/.exec(no || '');
  return m ? `${m[1]}-${m[2].slice(-2)}/${m[3].slice(-2)}-${m[4]}` : no;
};
/** Status word for tags: open → pending, billed → converted (quotation) / billed (order). */
export const statusLabel = (status, type) => (status === 'open' ? 'pending' : status === 'billed' && type === 'QT' ? 'converted' : status);
export const payLabel = (m) => ({ credit: 'Credit', cash: 'Cash', cheque: 'Cheque', bank: 'QR / Bank' }[m] || m);
