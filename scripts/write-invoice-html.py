import os

html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice DEV-2026-001</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; color: #2d2d2d; background: #f4f6f9; padding: 40px 20px; }
    .page { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.10); overflow: hidden; }
    .invoice-top { padding: 36px 48px 28px; border-bottom: 1px solid #e8edf2; display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; }
    .invoice-meta { flex: 1; }
    .invoice-meta h1 { font-size: 32px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #0a7fb8; }
    .invoice-meta p { font-size: 13px; margin-top: 6px; color: #555; }
    .badge { display: inline-block; margin-top: 10px; background: #22d0cd; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 4px 14px; border-radius: 20px; }
    .billed-from-inline { flex: 1; padding-top: 4px; }
    .body { padding: 36px 48px; }
    .parties { display: flex; flex-direction: column; gap: 20px; margin-bottom: 36px; }
    .party { }
    .party-label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #0a7fb8; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 2px solid #0a7fb8; display: inline-block; }
    .party p { line-height: 1.7; }
    .party strong { font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #0a7fb8; color: #fff; }
    thead th { padding: 11px 16px; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    thead th:last-child { text-align: right; }
    tbody tr { border-bottom: 1px solid #e8edf2; }
    tbody td { padding: 13px 16px; vertical-align: top; line-height: 1.5; }
    tbody td:last-child { text-align: right; font-weight: 600; }
    .services-list { list-style: none; margin-top: 6px; padding: 0; }
    .services-list li { font-size: 12px; color: #666; padding: 2px 0; }
    .services-list li::before { content: "\\2713  "; color: #22d0cd; }
    .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 36px; }
    .totals { width: 320px; border: 1px solid #e8edf2; border-radius: 6px; overflow: hidden; }
    .totals-row { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #e8edf2; font-size: 13px; }
    .totals-row:last-child { border-bottom: none; }
    .totals-row.balance { background: #0a7fb8; color: #fff; font-weight: 700; font-size: 14px; }
    .totals-row.paid-row { background: #f0fdf8; color: #16a34a; }
    .totals-row.paid-row span:last-child { font-weight: 700; }
    .footer { background: #f4f6f9; border-top: 1px solid #e8edf2; padding: 20px 48px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #888; }
    .footer strong { color: #0a7fb8; }
    @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; border-radius: 0; } }
  </style>
</head>
<body>
<div class="page">
  <div class="invoice-top">
    <div class="billed-from-inline">
      <div class="party-label">Billed From</div>
      <p><strong>Kadian Morris</strong></p>
      <p>morris.kadian@yahoo.com</p>
      <p>(876) 397-0760</p>
    </div>
    <div class="invoice-meta" style="text-align:right;">
      <h1>Invoice</h1>
      <p>Invoice No: <strong>DEV-2026-001</strong></p>
      <p>Date: <strong>June 26, 2026</strong></p>
      <span class="badge">Paid in Full</span>
    </div>
  </div>
  <div class="body">
    <div class="parties">
      <div class="party">
        <div class="party-label">Billed To</div>
        <p><strong>876 Nurses Home Care Services</strong></p>
        <p>876nurses@gmail.com</p>
        <p>(876) 378-2038</p>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="text-align:left;width:60%">Description</th>
          <th style="text-align:right">Amount (JMD)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>Mobile Application &amp; Backend Development</strong>
            <ul class="services-list">
              <li>Appointment booking workflows</li>
              <li>Nurse scheduling &amp; shift management</li>
              <li>Invoice &amp; payment handling</li>
              <li>Admin dashboard functionality</li>
              <li>Email notification integration</li>
            </ul>
          </td>
          <td>300,000.00</td>
        </tr>
      </tbody>
    </table>
    <div class="totals-wrap">
      <div class="totals">
        <div class="totals-row"><span>Subtotal</span><span>300,000.00 JMD</span></div>
        <div class="totals-row paid-row"><span>Amount Paid</span><span>300,000.00 JMD</span></div>
        <div class="totals-row balance"><span>Balance Due</span><span>0.00 JMD</span></div>
      </div>
    </div>
  </div>
  <div class="footer">
    <div>Payment received in full on <strong>June 26, 2026</strong>. Thank you!</div>
    <div>Questions? <strong>morris.kadian@yahoo.com</strong></div>
  </div>
</div>
</body>
</html>"""

out = os.path.join(os.path.dirname(__file__), '..', 'INVOICE-KADIAN-300K.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print("Written:", os.path.abspath(out))
