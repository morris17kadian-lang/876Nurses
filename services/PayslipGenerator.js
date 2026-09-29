import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

class PayslipGenerator {
  static async getLogoDataUri() {
    try {
      const asset = Asset.fromModule(require('../assets/Images/Nurses-logo.png'));
      await asset.downloadAsync();
      let uri = asset.localUri || asset.uri;
      if (!uri) return null;

      // Ensure we always read from a local file URI (especially on iOS).
      if (!uri.startsWith('file://') && FileSystem.cacheDirectory) {
        const targetUri = `${FileSystem.cacheDirectory}876nurses-logo.png`;
        try {
          const downloadResult = await FileSystem.downloadAsync(uri, targetUri);
          uri = downloadResult?.uri || targetUri;
        } catch {
          // If download fails, keep the original URI and try reading it as-is.
        }
      }

      const base64Encoding =
        (FileSystem.EncodingType && (FileSystem.EncodingType.Base64 || FileSystem.EncodingType.BASE64)) ||
        'base64';

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: base64Encoding,
      });

      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn('PayslipGenerator: Unable to load logo for PDF:', error?.message || error);
      return null;
    }
  }

  static async generatePayslipPDF(payslip) {
    try {
      const logoDataUri = await this.getLogoDataUri();
      const htmlContent = this.createPayslipHTML(payslip, { logoDataUri });
      
      const { uri } = await Print.printToFileAsync({
        html: htmlContent,
        base64: false,
        width: 612, // US Letter width in points (8.5 inches)
        height: 792, // US Letter height in points (11 inches)
      });

      return uri;
      
    } catch (error) {
      console.error('❌ Error creating PDF payslip:', error);
      throw error;
    }
  }

  static async sharePayslip(payslipUri, staffName) {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(payslipUri, {
          mimeType: 'application/pdf',
          dialogTitle: `876Nurses Payslip for ${staffName}`,
        });
      } else {
        console.log('Sharing not available on this platform');
      }
    } catch (error) {
      console.error('Error sharing payslip:', error);
      throw error;
    }
  }

  static createPayslipHTML(payslip, { logoDataUri } = {}) {
    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    };

    const formatCurrency = (amount) => {
      const num = parseFloat(amount || 0);
      // Match the in-app preview formatting.
      return `$${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    };

    const staffCode = payslip.nurseCode || payslip.code || payslip.employeeId || payslip.staffId || 'N/A';
    const payslipNumber = payslip.payslipNumber || 
      `NUR-PAY-${String(payslip.employeeId || '0001').padStart(4, '0')}`;

    const periodStart = formatDate(payslip.periodStart);
    const periodEnd = formatDate(payslip.periodEnd);
    const generatedDate = formatDate(payslip.generatedDate || new Date().toISOString());

    // Build service rows
    let serviceRows = '';
    
    if (payslip.shiftPay === undefined && parseFloat(payslip.regularHours || 0) > 0) {
      serviceRows += `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">Home Care Assistance</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${payslip.regularHours}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${formatCurrency(payslip.hourlyRate)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-weight: 600;">${formatCurrency(payslip.regularPay)}</td>
        </tr>
      `;
    }

    if (payslip.shiftPay !== undefined) {
      const addRow = (description, hours, rate, amount) => {
        if (parseFloat(amount || 0) <= 0) return '';
        return `<tr><td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">${description}</td><td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${hours}</td><td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${rate}</td><td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-weight: 600;">${formatCurrency(amount)}</td></tr>`;
      };
      serviceRows += addRow(`Completed shifts (${payslip.shiftsCompleted || 0})`, payslip.shiftHours || 0, 'Shift rates', payslip.shiftPay);
      serviceRows += addRow('Completed appointments', payslip.appointmentHours || 0, formatCurrency(payslip.hourlyRate), payslip.appointmentPay);
      serviceRows += addRow('Public holiday premium', '—', '—', payslip.holidayPremium);
    }

    if (parseFloat(payslip.overtimeHours || 0) > 0) {
      serviceRows += `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">Overtime (1.5x)</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${payslip.overtimeHours}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${formatCurrency(payslip.hourlyRate * 1.5)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-weight: 600;">${formatCurrency(payslip.overtimePay)}</td>
        </tr>
      `;
    }

    if (payslip.shiftPay === undefined && parseFloat(payslip.regularHours || 0) === 0) {
      serviceRows += `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">${payslip.payType === 'salary' ? 'Salary' : 'Recorded work'}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${payslip.hoursWorked || '—'}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">${payslip.hourlyRate ? formatCurrency(payslip.hourlyRate) : '—'}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-weight: 600;">${formatCurrency(payslip.basePay ?? payslip.grossPay)}</td>
        </tr>
      `;
    }

    const companyBrandHTML = logoDataUri
      ? `<img class="company-logo-img" src="${logoDataUri}" alt="876Nurses" />`
      : `<div class="company-logo-text">876NURSES</div>`;

    const paidDateValue = payslip.paidDate || payslip.payDate;
    const paidDateLabel = paidDateValue ? formatDate(paidDateValue) : null;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          @page {
            size: 612pt 792pt; /* US Letter */
            margin: 0;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.5;
            color: #333;
            background: #fff;
            padding: 28px;
            width: 612px;
            min-height: 792px;
          }
          .payslip-card {
            background: #fff;
            border-radius: 6px;
            padding: 24px;
            border: 1px solid #eee;
          }
          .company-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
          }
          .company-info {
            flex: 1;
            padding-right: 16px;
          }
          .company-logo-img {
            height: 36px;
            width: 36px;
            display: block;
            margin-bottom: 6px;
          }
          .company-logo-text {
            color: #2196F3;
            font-size: 18pt;
            font-weight: 700;
            margin-bottom: 6px;
            letter-spacing: 1px;
          }
          .company-details {
            color: #666;
            font-size: 9pt;
            margin: 1px 0;
          }
          .invoice-info {
            text-align: right;
          }
          .invoice-label {
            font-size: 20pt;
            font-weight: 700;
            color: #333;
            margin-bottom: 3px;
          }
          .invoice-number {
            font-size: 12pt;
            font-weight: 600;
            color: #333;
            margin-bottom: 6px;
          }
          .date-text {
            font-size: 10pt;
            color: #666;
            margin-bottom: 2px;
          }
          .divider {
            height: 2px;
            background: #2196F3;
            margin: 14px 0;
          }
          .pay-to-section {
            background: #f8f9fa;
            border: 1px solid #2196F3;
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
          }
          .pay-to-col {
            flex: 1;
          }
          .pay-to-col.right {
            text-align: right;
            flex: 0.7;
          }
          .section-label {
            color: #2196F3;
            font-size: 10pt;
            font-weight: 700;
            letter-spacing: 0.3px;
          }
          .pay-to-name {
            font-size: 14pt;
            font-weight: 700;
            color: #333;
          }
          .table {
            width: 100%;
            border-collapse: collapse;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 18px;
          }
          .table thead {
            background: #f5f5f5;
            color: #333;
          }
          .table th {
            padding: 6px;
            font-size: 10pt;
            font-weight: 600;
            text-align: center;
            border-bottom: 1px solid #e0e0e0;
          }
          .table th:first-child {
            text-align: left;
          }
          .table td {
            padding: 6px;
            font-size: 10pt;
            color: #333;
            border-bottom: 1px solid #f0f0f0;
            text-align: center;
          }
          .table td:first-child {
            text-align: left;
          }
          .table tr:last-child td {
            border-bottom: none;
          }
          .payment-section {
            display: flex;
            justify-content: flex-end;
            margin-top: 16px;
          }
          .total-section {
            width: 62%;
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            padding: 14px 16px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            font-size: 12pt;
          }
          .total-label {
            color: #666;
          }
          .total-value {
            color: #333;
            font-weight: 500;
          }
          .final-total-row {
            display: flex;
            justify-content: space-between;
            padding-top: 10px;
            border-top: 2px solid #000;
            margin-top: 6px;
          }
          .final-total-label {
            color: #000;
            font-size: 13pt;
            font-weight: 700;
          }
          .final-total-value {
            color: #2196F3;
            font-size: 13pt;
            font-weight: 700;
          }
          .paid-date-below {
            margin-top: 12px;
            text-align: center;
            color: #4CAF50;
            font-size: 12pt;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <div class="payslip-card">
          <div class="company-header">
            <div class="company-info">
              ${companyBrandHTML}
              <div class="company-details">Phone: (876) 618-9876</div>
              <div class="company-details">Email: info@876nurses.com</div>
            </div>
            <div class="invoice-info">
              <div class="invoice-label">PAYSLIP</div>
              <div class="invoice-number">${payslipNumber}</div>
              <div class="date-text">Generated: ${generatedDate}</div>
              <div class="date-text">Period: ${periodStart} - ${periodEnd}</div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="pay-to-section">
            <div class="pay-to-col">
              <div class="section-label">PAY TO:</div>
              <div class="pay-to-name">${payslip.staffName}</div>
            </div>
            <div class="pay-to-col right">
              <div class="section-label">STAFF CODE:</div>
              <div class="pay-to-name">${staffCode}</div>
            </div>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th style="width: 40%">Service Description</th>
                <th style="width: 20%">Hours</th>
                <th style="width: 20%">Rate</th>
                <th style="width: 20%">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${serviceRows}
            </tbody>
          </table>

          <div class="payment-section">
            <div class="total-section">
              <div class="total-row">
                <span class="total-label">Base Pay:</span>
                <span class="total-value">${formatCurrency(payslip.staffType === 'nursing' ? payslip.regularPay : payslip.basePay)}</span>
              </div>
              ${Object.entries(payslip.allowances || {}).filter(([, amount]) => parseFloat(amount || 0) > 0).map(([name, amount]) => `
                <div class="total-row"><span class="total-label">${name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())} allowance:</span><span class="total-value">+${formatCurrency(amount)}</span></div>
              `).join('')}
              <div class="total-row"><span class="total-label">Gross Pay:</span><span class="total-value">${formatCurrency(payslip.grossPay)}</span></div>
              <div class="final-total-row">
                <span class="final-total-label">Net Pay:</span>
                <span class="final-total-value">${formatCurrency(payslip.netPay)}</span>
              </div>

              ${payslip.status === 'paid' && paidDateLabel ? `<div class="paid-date-below">Paid on: ${paidDateLabel}</div>` : ''}
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export default PayslipGenerator;
