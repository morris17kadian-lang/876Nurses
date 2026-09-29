import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

class InvoiceImageGenerator {
  static async generateInvoiceImage(invoiceData) {
    try {
      
      // Generate HTML invoice and convert to PDF using Expo Print
      const pdfUri = await this.generatePDFInvoice(invoiceData);
      
      // Invoice PDF generated
      return pdfUri;
      
    } catch (error) {
      console.error('❌ Error generating invoice image:', error);
      throw error;
    }
  }

  static async shareInvoice(invoiceUri, clientName) {
    try {
      if (await Sharing.isAvailableAsync()) {
        const fileExtension = invoiceUri.includes('.pdf') ? 'PDF' : 'SVG';
        await Sharing.shareAsync(invoiceUri, {
          mimeType: invoiceUri.includes('.pdf') ? 'application/pdf' : 'image/svg+xml',
          dialogTitle: `876Nurses Invoice for ${clientName} (${fileExtension})`,
        });
      } else {
        // Sharing not available on this platform
      }
    } catch (error) {
      console.error('Error sharing invoice:', error);
      throw error;
    }
  }

  static async generatePDFInvoice(invoiceData) {
    try {
      const htmlContent = this.createInvoiceHTML(invoiceData);
      
      const { uri } = await Print.printToFileAsync({
        html: htmlContent,
        base64: false,
        width: 612, // A4 width in points
        height: 792, // A4 height in points
      });

      // PDF Invoice created
      return uri;
      
    } catch (error) {
      console.error('❌ Error creating PDF invoice:', error);
      // Fallback to SVG file (which can be shared/viewed)
      return await this.generateSVGInvoice(invoiceData);
    }
  }

  // SVG-based invoice (more reliable fallback)
  static async generateSVGInvoice(invoiceData) {
    try {
      const svgContent = this.createSVGInvoice(invoiceData);
      
      const fileName = `876Nurses_Invoice_${invoiceData.invoiceNumber}_${Date.now()}.svg`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      
      await FileSystem.writeAsStringAsync(fileUri, svgContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      
      // SVG Invoice created
      return fileUri;
      
    } catch (error) {
      console.error('❌ Error creating SVG invoice:', error);
      throw error;
    }
  }

  static createSVGInvoice(invoiceData) {
    const width = 794;
    const height = 1123;
    
    const formatDate = (dateString) => {
            if (!dateString) return 'N/A';

            let date;
            if (dateString instanceof Date) {
                date = dateString;
            } else if (typeof dateString === 'string' || typeof dateString === 'number') {
                date = new Date(dateString);
            } else if (typeof dateString === 'object') {
                // Firestore Timestamp (or Timestamp-like)
                if (typeof dateString.toDate === 'function') {
                    date = dateString.toDate();
                } else if (typeof dateString.seconds === 'number') {
                    date = new Date(dateString.seconds * 1000);
                } else {
                    date = new Date(String(dateString));
                }
            } else {
                date = new Date(String(dateString));
            }

            if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    };

    const formatCurrency = (amount) => {
      if (!amount && amount !== 0) return 'J$0.00';
      return `J$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    };

        const resolveBillTo = (data) => {
            const base = data?.billTo && typeof data.billTo === 'object' ? data.billTo : {};
            return {
                name: base.name || data?.clientName || data?.patientName || data?.customerName || 'N/A',
                address: base.address || data?.clientAddress || data?.patientAddress || data?.address || 'N/A',
                phone: base.phone || data?.clientPhone || data?.patientPhone || data?.phone || '',
                email: base.email || data?.clientEmail || data?.patientEmail || data?.email || '',
            };
        };

        const billTo = resolveBillTo(invoiceData);
        const invoiceDisplayNumber = (invoiceData?.invoiceId || invoiceData?.invoiceNumber || '').replace(
            'CARE-INV',
            'NUR-INV'
        );

    // Create service rows for SVG
    let serviceRowsY = 420;
    const serviceRowsHTML = invoiceData.items.map((item, index) => {
      const currentY = serviceRowsY + (index * 80);
      const serviceDates = item.serviceDates || formatDate(invoiceData.serviceDate);
      const nurseNames = item.nurseNames || invoiceData.nurseName || 'Care Professional';
      
      return `
        <!-- Service Row ${index + 1} -->
        <rect x="60" y="${currentY}" width="674" height="80" fill="#ffffff" stroke="#ddd"/>
        <text x="80" y="${currentY + 25}" class="body-text" font-size="14" fill="#333">${item.description}</text>
        <text x="80" y="${currentY + 45}" class="body-text" font-size="12" fill="#666">${item.detailedDescription || 'Professional healthcare services'}</text>
        <text x="80" y="${currentY + 65}" class="body-text" font-size="11" fill="#888">Dates: ${serviceDates} | Nurse: ${nurseNames}</text>
        <text x="500" y="${currentY + 35}" class="body-text" font-size="14" fill="#333">${item.quantity}</text>
        <text x="580" y="${currentY + 35}" class="body-text" font-size="14" fill="#333">${formatCurrency(item.price)}</text>
        <text x="710" y="${currentY + 35}" class="amount-text" font-size="16" text-anchor="end">${formatCurrency(item.total)}</text>
      `;
    }).join('');

    const totalSectionY = serviceRowsY + (invoiceData.items.length * 80) + 60;
    const paymentSectionY = totalSectionY + 160;
    const footerY = paymentSectionY + 260;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .header-text { font-family: Arial, sans-serif; font-weight: bold; }
      .body-text { font-family: Arial, sans-serif; }
      .amount-text { font-family: Arial, sans-serif; font-weight: bold; fill: #2196F3; }
      .primary-color { fill: #2196F3; }
    </style>
  </defs>
  
  <!-- Background -->
  <rect width="100%" height="100%" fill="#ffffff"/>
  
  <!-- Header -->
  <rect x="0" y="0" width="100%" height="120" fill="#f8f9fa"/>
  <text x="60" y="50" class="header-text primary-color" font-size="36">876NURSES</text>
  <text x="60" y="80" class="body-text" font-size="16" fill="#666">Professional Home Nursing Care</text>
  <text x="60" y="100" class="body-text" font-size="12" fill="#666">Phone: (876) 618-9876 | Email: info@876nurses.com</text>
  
  <!-- Invoice Header -->
  <text x="650" y="50" class="header-text primary-color" font-size="32" text-anchor="end">INVOICE</text>
    <text x="650" y="80" class="header-text" font-size="18" fill="#333" text-anchor="end">#${invoiceDisplayNumber}</text>
    <text x="650" y="100" class="body-text" font-size="14" fill="#666" text-anchor="end">${formatDate(invoiceData.date || invoiceData.issueDate || invoiceData.createdAt)}</text>
  
  <!-- Bill To Section -->
  <rect x="60" y="140" width="320" height="140" fill="#f8f9fa" stroke="#2196F3" stroke-width="1"/>
  <text x="80" y="165" class="header-text primary-color" font-size="14">BILL TO:</text>
  <line x1="80" y1="170" x2="200" y2="170" stroke="#2196F3" stroke-width="1"/>
    <text x="80" y="195" class="header-text" font-size="16" fill="#333">${billTo.name}</text>
    <text x="80" y="215" class="body-text" font-size="13" fill="#666">${billTo.address}</text>
    <text x="80" y="235" class="body-text" font-size="13" fill="#666">${billTo.phone}</text>
    <text x="80" y="255" class="body-text" font-size="13" fill="#666">${billTo.email}</text>
  
  <!-- Service Information -->
  <rect x="400" y="140" width="334" height="140" fill="#f8f9fa" stroke="#2196F3" stroke-width="1"/>
  <text x="420" y="165" class="header-text primary-color" font-size="14">SERVICE INFORMATION:</text>
  <line x1="420" y1="170" x2="600" y2="170" stroke="#2196F3" stroke-width="1"/>
  <text x="420" y="190" class="body-text" font-size="13" fill="#666">Service Date: ${formatDate(invoiceData.serviceDate)}</text>
  <text x="420" y="210" class="body-text" font-size="13" fill="#666">Total Sessions: ${invoiceData.totalSessions || 1}</text>
  <text x="420" y="230" class="body-text" font-size="13" fill="#666">Nurse: ${invoiceData.nurseName || 'Care Professional'}</text>
  <text x="420" y="250" class="body-text" font-size="13" fill="#666">Status: Completed</text>
  <text x="420" y="270" class="body-text" font-size="13" fill="#666">Due Date: ${formatDate(invoiceData.dueDate)}</text>
  
  <!-- Services Table Header -->
  <rect x="60" y="320" width="674" height="40" fill="#2196F3"/>
  <text x="80" y="345" class="header-text" font-size="14" fill="white">SERVICE DESCRIPTION</text>
  <text x="500" y="345" class="header-text" font-size="14" fill="white">QTY</text>
  <text x="580" y="345" class="header-text" font-size="14" fill="white">RATE</text>
  <text x="710" y="345" class="header-text" font-size="14" fill="white" text-anchor="end">AMOUNT</text>
  
  <!-- Service Rows -->
  ${serviceRowsHTML}
  
  <!-- Total Section -->
  <rect x="500" y="${totalSectionY}" width="234" height="120" fill="#f8f9fa" stroke="#ddd"/>
    <text x="520" y="${totalSectionY + 25}" class="body-text" font-size="14" fill="#333">Deposit:</text>
  <text x="710" y="${totalSectionY + 25}" class="body-text" font-size="14" fill="#333" text-anchor="end">${formatCurrency(invoiceData.subtotal)}</text>
  <text x="520" y="${totalSectionY + 50}" class="body-text" font-size="14" fill="#333">Tax (Healthcare):</text>
  <text x="710" y="${totalSectionY + 50}" class="body-text" font-size="14" fill="#333" text-anchor="end">${formatCurrency(invoiceData.tax || 0)}</text>
  <line x1="520" y1="${totalSectionY + 65}" x2="710" y2="${totalSectionY + 65}" stroke="#2196F3" stroke-width="2"/>
  <text x="520" y="${totalSectionY + 90}" class="header-text primary-color" font-size="18">TOTAL DUE:</text>
  <text x="710" y="${totalSectionY + 90}" class="amount-text" font-size="20" text-anchor="end">${formatCurrency(invoiceData.total)}</text>
  
  <!-- Payment Instructions -->
  <rect x="60" y="${paymentSectionY}" width="674" height="220" fill="#f8f9fa" stroke="#2196F3" stroke-width="2"/>
  <text x="80" y="${paymentSectionY + 25}" class="header-text primary-color" font-size="16">PAYMENT INSTRUCTIONS</text>
  <line x1="80" y1="${paymentSectionY + 30}" x2="300" y2="${paymentSectionY + 30}" stroke="#2196F3" stroke-width="2"/>
  
  <!-- Payment Terms -->
  <text x="80" y="${paymentSectionY + 55}" class="body-text" font-size="12" fill="#666">Payment due within 24 hours | Include invoice #${invoiceData.invoiceNumber} in reference</text>
  
  <!-- Banking Details -->
  <text x="80" y="${paymentSectionY + 80}" class="header-text" font-size="13" fill="#333">876Nurses Banking Details:</text>
  
  <text x="80" y="${paymentSectionY + 100}" class="header-text" font-size="11" fill="#333">Bank:</text>
  <text x="180" y="${paymentSectionY + 100}" class="body-text" font-size="11" fill="#666">National Commercial Bank (NCB)</text>
  <text x="400" y="${paymentSectionY + 100}" class="header-text" font-size="11" fill="#333">Branch:</text>
  <text x="480" y="${paymentSectionY + 100}" class="body-text" font-size="11" fill="#666">Knutsford Branch</text>
  
  <text x="80" y="${paymentSectionY + 120}" class="header-text" font-size="11" fill="#333">Account Holder:</text>
  <text x="180" y="${paymentSectionY + 120}" class="body-text" font-size="11" fill="#666">876 Nurses Home Care Services Limited</text>
  <text x="400" y="${paymentSectionY + 120}" class="header-text" font-size="11" fill="#333">Account Type:</text>
  <text x="480" y="${paymentSectionY + 120}" class="body-text" font-size="11" fill="#666">NCB Saving</text>
  
  <text x="80" y="${paymentSectionY + 140}" class="header-text" font-size="11" fill="#333">JMD Account:</text>
  <text x="180" y="${paymentSectionY + 140}" class="body-text" font-size="11" fill="#666">JMD354756226</text>
  <text x="400" y="${paymentSectionY + 140}" class="header-text" font-size="11" fill="#333">USD Account:</text>
  <text x="480" y="${paymentSectionY + 140}" class="body-text" font-size="11" fill="#666">USD354756234</text>
  
  <text x="80" y="${paymentSectionY + 160}" class="header-text" font-size="11" fill="#333">Swift Code:</text>
  <text x="180" y="${paymentSectionY + 160}" class="body-text" font-size="11" fill="#666">JNCBXX</text>
  <text x="400" y="${paymentSectionY + 160}" class="header-text" font-size="11" fill="#333">Contact:</text>
  <text x="480" y="${paymentSectionY + 160}" class="body-text" font-size="11" fill="#666">876-288-7304</text>
  
  <text x="80" y="${paymentSectionY + 180}" class="header-text" font-size="11" fill="#333">Email:</text>
  <text x="180" y="${paymentSectionY + 180}" class="body-text" font-size="10" fill="#666">info@876nurses.com</text>
  
  <!-- Footer -->
  <text x="397" y="${footerY + 20}" class="header-text primary-color" font-size="16" text-anchor="middle">Thank you for choosing 876NURSES Home Care Services</text>
  <text x="397" y="${footerY + 40}" class="body-text" font-size="10" fill="#999" text-anchor="middle">This invoice was generated electronically and is valid without signature.</text>
  <text x="397" y="${footerY + 55}" class="body-text" font-size="10" fill="#999" text-anchor="middle">Professional healthcare services provided with care and compassion.</text>
  <text x="397" y="${footerY + 70}" class="body-text" font-size="10" fill="#999" text-anchor="middle">For questions about this invoice, please contact us at 876-288-7304</text>
</svg>`;
  }

  static createInvoiceHTML(invoiceData) {
    const formatDate = (value) => {
      if (!value) return 'N/A';

      let date;
      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        const formattedDate = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
        if (formattedDate) {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthIndex = monthNames.indexOf(formattedDate[1]);
          if (monthIndex >= 0) {
            date = new Date(Number(formattedDate[3]), monthIndex, Number(formattedDate[2]));
          }
        }
        if (!date) date = new Date(value);
      } else if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
          date = value.toDate();
        } else if (typeof value.seconds === 'number') {
          date = new Date(value.seconds * 1000);
        } else {
          date = new Date(String(value));
        }
      } else {
        date = new Date(String(value));
      }

      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const resolveBillTo = (data) => {
      const base = data?.billTo && typeof data.billTo === 'object' ? data.billTo : {};
      const isStoreInvoice = data?.service === 'Store Purchase' || data?.serviceType === 'Store Purchase';
      return {
        name: base.name || (isStoreInvoice
          ? data?.patientName || data?.clientName || data?.customerName
          : data?.clientName || data?.patientName || data?.customerName) || 'N/A',
        address: base.address || data?.clientAddress || data?.patientAddress || data?.address || 'N/A',
        phone: base.phone || (isStoreInvoice ? data?.patientPhone || data?.clientPhone : data?.clientPhone || data?.patientPhone) || data?.phone || '',
        email: base.email || (isStoreInvoice ? data?.patientEmail || data?.clientEmail : data?.clientEmail || data?.patientEmail) || data?.email || '',
      };
    };

    const safeText = (value) => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const formatCurrency = (amount) => {
      const numericAmount = typeof amount === 'number' ? amount : parseFloat(amount || 0) || 0;
      const currencyCode = invoiceData?.currencyCode || invoiceData?.currency;
      const currencyMap = { JMD: 'J$', USD: 'US$', CAD: 'CA$', EUR: '€' };
      const symbol = currencyMap[currencyCode] || (currencyCode ? `${currencyCode} ` : 'J$');
      return `${symbol}${numericAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const billTo = resolveBillTo(invoiceData);
    const invoiceReference = invoiceData?.invoiceNumber || invoiceData?.invoiceId || '';
    const isStorePurchase = invoiceData?.service === 'Store Purchase' || invoiceData?.serviceType === 'Store Purchase';

    const logoDataUri = invoiceData?.logoDataUri || invoiceData?.logoUri || null;

    const invoiceNumberDisplay =
      (invoiceData?.invoiceId || invoiceData?.invoiceNumber || '')?.replace?.('CARE-INV', 'NUR-INV') ||
      (invoiceData?.invoiceId || invoiceData?.invoiceNumber || '');

    const issueDateDisplay = formatDate(invoiceData?.issueDate || invoiceData?.date || invoiceData?.createdAt);
    const dueDateDisplay = formatDate(
      invoiceData?.dueDate ||
      invoiceData?.paymentDueDate ||
      invoiceData?.billingDueDate ||
      invoiceData?.issueDate ||
      invoiceData?.date ||
      invoiceData?.createdAt
    );

    const periodStart = invoiceData?.periodStart || invoiceData?.billingPeriodStart || invoiceData?.recurringPeriodStart;
    const periodEnd = invoiceData?.periodEnd || invoiceData?.billingPeriodEnd || invoiceData?.recurringPeriodEnd;
    const showPeriod = !isStorePurchase && periodStart && periodEnd;

    const companyName = invoiceData?.companyDetails?.companyName || invoiceData?.companyDetails?.fullName || '876 Nurses Home Care Services Limited';
    const companyAddress =
      invoiceData?.companyDetails?.address ||
      '60 Knutsford Blvd, Panjam Building, 9th Floor - Regus, Kingston 5, Jamaica, West Indies';
    const companyPhone = invoiceData?.companyDetails?.phone || '(876) 618-9876';
    const companyEmail = invoiceData?.companyDetails?.email || '876nurses@gmail.com';
    const companyWebsite = invoiceData?.companyDetails?.website || 'www.876nurses.com';

    const paymentMethodDisplay = invoiceData?.paymentMethod || 'Bank Transfer';
    const paymentInfo = invoiceData?.paymentInfo || {};
    const bankAccounts = Array.isArray(paymentInfo.bankAccounts) ? paymentInfo.bankAccounts : [];

    const rawItems = Array.isArray(invoiceData?.items) ? invoiceData.items : [];
    const items = rawItems.length > 0
      ? rawItems
      : [
          {
            description: invoiceData?.service || 'Service',
            quantity: invoiceData?.hours || 1,
            unitPrice: invoiceData?.rate || invoiceData?.total || 0,
            total: invoiceData?.total || 0,
          },
        ];

    const serviceRowsHTML = items
      .map((item) => {
        const description = item?.description || invoiceData?.service || '';
        const quantity = item?.quantity || item?.hours || invoiceData?.hours || 1;
        const unitPrice = item?.unitPrice || item?.price || item?.rate || invoiceData?.rate || 0;
        const total = item?.amount || item?.total || (Number(quantity) * Number(unitPrice));

        return `
          <tr>
            <td>${safeText(description)}</td>
            <td class="num">${safeText(quantity)}</td>
            <td class="num">${safeText(formatCurrency(unitPrice))}</td>
            <td class="num">${safeText(formatCurrency(total))}</td>
          </tr>
        `;
      })
      .join('');

    const paymentDetailsHTML = bankAccounts.map((account) => {
      const accountNumbers = Array.isArray(account?.accountNumbers) ? account.accountNumbers : [];
      return `
        <div class="pdfPaymentInfo">${safeText(account?.bankName || '')}</div>
        ${account?.payee ? `<div class="pdfPaymentInfo">Payee: ${safeText(account.payee)}</div>` : ''}
        ${account?.branch ? `<div class="pdfPaymentInfo">Branch: ${safeText(account.branch)}</div>` : ''}
        ${accountNumbers.map((number) => `<div class="pdfPaymentInfo">${safeText(number.currency || '')}: ${safeText(number.number || '')}</div>`).join('')}
        ${account?.swiftCode ? `<div class="pdfPaymentInfo">Swift: ${safeText(account.swiftCode)}</div>` : ''}
      `;
    }).join('');
    const paidStatus = String(invoiceData?.status || '').toLowerCase() === 'paid';
    const paymentHistoryHTML = Array.isArray(invoiceData?.payments)
      ? invoiceData.payments.map((payment) => `<div class="pdfPaymentInfo">${safeText(payment?.type === 'deposit' ? 'Deposit' : 'Payment')} - ${safeText(formatDate(payment?.date))}: ${safeText(formatCurrency(payment?.amount || 0))}</div>`).join('')
      : '';
    const orderDetailsHTML = isStorePurchase && invoiceData?.orderDetails
      ? `<div class="pdfPaymentInfo">Order status: ${safeText(String(invoiceData.orderDetails.status || '').toUpperCase())}</div>${invoiceData.orderDetails.completedDate ? `<div class="pdfPaymentInfo">Delivered: ${safeText(formatDate(invoiceData.orderDetails.completedDate))}</div>` : ''}`
      : '';

    return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      @page { size: letter; margin: 0; }
      html, body { width: 612px; min-height: 792px; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        color: #1f2937;
        background: #ffffff;
        padding: 28px;
        width: 612px;
        min-height: 792px;
      }
      .invoicePreviewCard { border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; min-height: 736px; display: flex; flex-direction: column; }
      .headerLogoWrap { display: flex; justify-content: center; align-items: center; margin-bottom: 10px; }
      .headerLogo { height: 34px; width: auto; object-fit: contain; }
      .pdfHeaderTop { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      .logoBox { width: 140px; }
      .logoText { font-size: 22px; font-weight: 800; color: #111827; letter-spacing: 1px; }
      .pdfInvoiceInfo { text-align: right; flex: 1; }
      .pdfInvoiceTitle { font-size: 28px; font-weight: 800; color: #111827; letter-spacing: 1px; }
      .pdfInvoiceNumber { font-size: 16px; font-weight: 700; margin-top: 6px; color: #111827; }
      .pdfInvoiceDate { font-size: 12px; color: #6b7280; margin-top: 4px; }
      .pdfBlueLine { height: 1px; background: #e5e7eb; margin-top: 12px; }
      .pdfClientRow { display: flex; justify-content: space-between; margin-top: 18px; gap: 18px; }
      .pdfBillTo, .pdfServiceProvider { flex: 1; }
      .pdfSectionTitle { font-size: 12px; font-weight: 800; color: #374151; margin-bottom: 10px; letter-spacing: 0.5px; }
      .pdfClientName { font-size: 16px; font-weight: 800; color: #111827; margin-bottom: 6px; }
      .pdfClientInfo, .pdfProviderInfo { font-size: 12px; color: #374151; margin-bottom: 4px; line-height: 1.35; }
      .pdfProviderName { font-size: 12px; font-weight: 700; color: #111827; margin-bottom: 6px; }
      .pdfTable { margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
      table { width: 100%; border-collapse: collapse; }
      thead { background: #f3f4f6; }
      th { color: #111827; font-size: 12px; font-weight: 800; text-align: left; padding: 10px 10px; border-bottom: 1px solid #e5e7eb; }
      th.num, td.num { text-align: right; }
      td { font-size: 12px; color: #111827; padding: 10px 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
      .pdfBottomSection { display: flex; justify-content: space-between; gap: 18px; margin-top: 18px; }
      .pdfPaymentSection { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
      .pdfPaymentTitle { font-size: 13px; font-weight: 800; color: #111827; margin-bottom: 8px; }
      .pdfPaymentInfo { font-size: 12px; color: #374151; margin-bottom: 4px; line-height: 1.35; }
      .pdfTotalsSection { width: 220px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
      .pdfTotalRow, .pdfFinalTotalRow { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
      .pdfTotalLabel { font-size: 12px; color: #374151; }
      .pdfTotalValue { font-size: 12px; font-weight: 700; color: #111827; }
      .pdfFinalTotalLabel { font-size: 12px; font-weight: 800; color: #111827; }
      .pdfFinalTotalAmount { font-size: 14px; font-weight: 900; color: #111827; }
      .paidStamp { margin-top: 10px; border: 2px solid #16a34a; border-radius: 8px; padding: 8px; text-align: center; }
      .paidStampText { font-size: 18px; font-weight: 900; color: #16a34a; letter-spacing: 2px; }
      .paidMeta { font-size: 11px; color: #166534; margin-top: 4px; }
      .pdfFooter { margin-top: auto; padding-top: 24px; text-align: center; }
      .pdfFooterTitle { color: #1d8fe1; font-size: 13px; font-weight: 800; }
      .pdfFooterText { color: #6b7280; font-size: 10px; margin-top: 5px; }
    </style>
  </head>
  <body>
    <div class="invoicePreviewCard">
      <div class="pdfHeaderTop">
        <div class="logoBox">
          ${logoDataUri ? `<img class="headerLogo" src="${safeText(logoDataUri)}" />` : `<div class="logoText">876 Nurses</div>`}
        </div>
        <div class="pdfInvoiceInfo">
          <div class="pdfInvoiceTitle">INVOICE</div>
          <div class="pdfInvoiceNumber">${safeText(invoiceNumberDisplay)}</div>
          ${showPeriod ? `<div class="pdfInvoiceDate">Period: ${safeText(formatDate(periodStart))} - ${safeText(formatDate(periodEnd))}</div>` : ''}
          <div class="pdfInvoiceDate">Issue Date: ${safeText(issueDateDisplay)}</div>
          <div class="pdfInvoiceDate">Due Date: ${safeText(dueDateDisplay)}</div>
        </div>
      </div>
      <div class="pdfBlueLine"></div>

      <div class="pdfClientRow">
        <div class="pdfBillTo">
          <div class="pdfSectionTitle">BILL TO:</div>
          <div class="pdfClientName">${safeText(billTo.name)}</div>
          <div class="pdfClientInfo">${safeText(billTo.email || 'N/A')}</div>
          <div class="pdfClientInfo">${safeText(billTo.phone || 'N/A')}</div>
          ${isStorePurchase && invoiceData?.relatedOrderId ? `<div class="pdfClientInfo">Order #${safeText(invoiceData.relatedOrderId)}</div>` : ''}
          ${!isStorePurchase ? `<div class="pdfClientInfo">${safeText(billTo.address || 'N/A')}</div>` : ''}
        </div>
        <div class="pdfServiceProvider">
          <div class="pdfSectionTitle">SERVICE PROVIDED BY:</div>
          <div class="pdfProviderName">${safeText(companyName)}</div>
          <div class="pdfProviderInfo">${safeText(companyAddress)}</div>
          <div class="pdfProviderInfo">Phone: ${safeText(companyPhone)}</div>
          <div class="pdfProviderInfo">Email: ${safeText(companyEmail)}</div>
          ${companyWebsite ? `<div class="pdfProviderInfo">Web: ${safeText(companyWebsite)}</div>` : ''}
        </div>
      </div>

      <div class="pdfTable">
        <table>
          <thead>
            <tr>
              <th style="width: 55%">${isStorePurchase ? 'Item Description' : 'Service Description'}</th>
              <th class="num" style="width: 15%">${isStorePurchase ? 'Qty' : 'Hours'}</th>
              <th class="num" style="width: 15%">${isStorePurchase ? 'Unit Price' : 'Rate'}</th>
              <th class="num" style="width: 15%">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${serviceRowsHTML}
          </tbody>
        </table>
      </div>

      <div class="pdfBottomSection">
        <div class="pdfPaymentSection">
          <div class="pdfPaymentTitle">Payment Information</div>
          <div class="pdfPaymentInfo">Payment Method: ${safeText(paymentMethodDisplay)}</div>
          <div class="pdfPaymentInfo">Invoice Reference: ${safeText(invoiceReference)}</div>
          ${paymentDetailsHTML}
          ${paymentInfo.cashAccepted ? '<div class="pdfPaymentInfo">Cash accepted for home visits</div>' : ''}
          ${paymentInfo.posAvailable ? '<div class="pdfPaymentInfo">POS Machine Available</div>' : ''}
          ${orderDetailsHTML}
          ${paymentHistoryHTML ? `<div class="pdfPaymentTitle" style="margin-top:8px">Payment History</div>${paymentHistoryHTML}` : ''}
        </div>
        <div class="pdfTotalsSection">
          <div class="pdfTotalRow">
            <div class="pdfTotalLabel">Subtotal:</div>
              <div class="pdfTotalValue">${safeText(formatCurrency(invoiceData.subtotal || invoiceData.amount || invoiceData.total || 0))}</div>
          </div>
          ${invoiceData?.paymentStatus === 'partial' && Number(invoiceData?.paidAmount) > 0 ? `
            <div class="pdfTotalRow"><div class="pdfTotalLabel">Paid Amount:</div><div class="pdfTotalValue">${safeText(formatCurrency(invoiceData.paidAmount))}</div></div>
            <div class="pdfTotalRow"><div class="pdfTotalLabel">Outstanding:</div><div class="pdfTotalValue">${safeText(formatCurrency(invoiceData.outstandingAmount ?? Math.max(0, Number(invoiceData.total || invoiceData.amount || 0) - Number(invoiceData.paidAmount || 0))))}</div></div>
            <div class="pdfPaymentInfo" style="color:#b45309;font-weight:700">PARTIAL PAYMENT</div>
          ` : ''}
          <div class="pdfBlueLine"></div>
          <div class="pdfFinalTotalRow">
            <div class="pdfFinalTotalLabel">Total Amount:</div>
            <div class="pdfFinalTotalAmount">${safeText(formatCurrency(invoiceData.finalTotal || invoiceData.amount || invoiceData.total || 0))}</div>
          </div>
          ${paidStatus ? `
            <div class="paidStamp">
              <div class="paidStampText">PAID</div>
              ${invoiceData?.paymentMethod ? `<div class="paidMeta">${safeText(invoiceData.paymentMethod)}</div>` : ''}
              ${invoiceData?.paidDate ? `<div class="paidMeta">${safeText(formatDate(invoiceData.paidDate))}</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="pdfFooter">
        <div class="pdfFooterTitle">Thank you for choosing 876 Nurses Home Care Services</div>
        <div class="pdfFooterText">This invoice was generated electronically and is valid without a signature.</div>
      </div>
    </div>
  </body>
</html>`;
  }
}

export default InvoiceImageGenerator;
