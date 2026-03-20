import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import InvoiceImageGenerator from './InvoiceImageGenerator';
import ApiService from './ApiService';
import EmailService from './EmailService';
import FirebaseEmailQueueService from './FirebaseEmailQueueService';

class InvoiceService {
  static ADMIN_PAYMENT_GENERAL_SETTINGS_KEY = 'adminPaymentGeneralSettings';

  static async _getAdminPaymentGeneralSettings() {
    try {
      const raw = await AsyncStorage.getItem(this.ADMIN_PAYMENT_GENERAL_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  static ADMIN_NOTIFICATION_CATEGORIES = {
    ALL: 'all',
    SCHEDULING: 'scheduling',
    FINANCIAL: 'financial',
  };

  static normalizeInvoiceId(invoiceId) {
    if (typeof invoiceId !== 'string') return invoiceId;
    const trimmed = invoiceId.trim();
    if (/^CARE-INV-/i.test(trimmed)) return trimmed.replace(/^CARE-INV-/i, 'NUR-INV-');
    return trimmed;
  }

  static getInvoiceIdVariants(invoiceId) {
    if (typeof invoiceId !== 'string') return [];
    const trimmed = invoiceId.trim();
    if (!trimmed) return [];

    if (/^CARE-INV-/i.test(trimmed)) {
      return [trimmed, trimmed.replace(/^CARE-INV-/i, 'NUR-INV-')];
    }
    if (/^NUR-INV-/i.test(trimmed)) {
      return [trimmed, trimmed.replace(/^NUR-INV-/i, 'CARE-INV-')];
    }
    return [trimmed];
  }

  static invoiceIdsMatch(a, b) {
    const aNorm = this.normalizeInvoiceId(a);
    const bNorm = this.normalizeInvoiceId(b);
    if (typeof aNorm !== 'string' || typeof bNorm !== 'string') return false;
    return aNorm.toUpperCase() === bNorm.toUpperCase();
  }

  static _normalizeNotificationRole(value) {
    return String(value || '').trim().toLowerCase();
  }

  static _getAdminDisplayName(record) {
    return (
      record?.fullName ||
      record?.name ||
      `${record?.firstName || ''} ${record?.lastName || ''}`.trim()
    );
  }

  static _inferNotificationRole(adminUser) {
    const email = this._normalizeNotificationRole(adminUser?.email);
    const name = this._normalizeNotificationRole(this._getAdminDisplayName(adminUser));

    if (email === 'prince@876nurses.com' || name.includes('prince')) {
      return 'scheduling_only';
    }

    return 'full_access';
  }

  static _getEffectiveNotificationRole(adminUser) {
    const explicitRole = this._normalizeNotificationRole(adminUser?.emailNotificationRole);
    if (
      explicitRole === 'full_access' ||
      explicitRole === 'scheduling_only' ||
      explicitRole === 'financial_only'
    ) {
      return explicitRole;
    }

    return this._inferNotificationRole(adminUser);
  }

  static _selectAdminRecipientsByCategory(adminUsers = [], category = this.ADMIN_NOTIFICATION_CATEGORIES.ALL) {
    return (Array.isArray(adminUsers) ? adminUsers : []).filter((adminUser) => {
      if (!adminUser?.email) return false;
      if (adminUser?.isActive === false) return false;

      const role = this._getEffectiveNotificationRole(adminUser);

      if (category === this.ADMIN_NOTIFICATION_CATEGORIES.SCHEDULING) {
        return role === 'full_access' || role === 'scheduling_only';
      }

      if (category === this.ADMIN_NOTIFICATION_CATEGORIES.FINANCIAL) {
        return role === 'full_access' || role === 'financial_only';
      }

      return true;
    });
  }

  static async _notifyFinancialAdminsOverduePayment({ invoiceId, invoiceData, paymentMethod }) {
    try {
      const adminsSnapshot = await getDocs(collection(db, 'admins'));
      const admins = adminsSnapshot.docs.map((adminDoc) => ({
        id: adminDoc.id,
        ...adminDoc.data(),
      }));

      const recipients = this._selectAdminRecipientsByCategory(
        admins,
        this.ADMIN_NOTIFICATION_CATEGORIES.FINANCIAL
      );

      if (!recipients.length) return;

      const safeInvoiceId = invoiceData?.invoiceId || invoiceId || '';
      const amount = Number(invoiceData?.total ?? invoiceData?.amount ?? 0);
      const amountLabel = Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
      const clientName = invoiceData?.clientName || invoiceData?.patientName || 'Client';
      const appInvoiceUrl = `nurses876://invoice/${encodeURIComponent(String(safeInvoiceId))}`;

      const formatDateLabel = (value) => {
        if (!value) return 'N/A';
        let date;
        let asString;
        if (value instanceof Date) {
          date = value;
          asString = value.toISOString();
        } else if (value && typeof value.toDate === 'function') {
          date = value.toDate();
          asString = date.toISOString();
        } else {
          asString = String(value);
          date = new Date(asString);
        }
        if (Number.isNaN(date.getTime())) return asString;
        try {
          return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
        } catch (_) {
          return asString;
        }
      };

      const dueDateLabel = formatDateLabel(
        invoiceData?.dueDate || invoiceData?.due || invoiceData?.dueDateLabel
      );
      const paymentDateLabel = formatDateLabel(
        invoiceData?.paidDate || invoiceData?.paidAt || new Date().toISOString()
      );
      const paymentMethodLabel = paymentMethod || invoiceData?.paymentMethod || 'N/A';

      const subject = `Payment Confirmation - Overdue Invoice ${safeInvoiceId}`;
      const buildHtml = (adminName) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,sans-serif;color:#1f2a44;">
          <div style="max-width:600px;margin:0 auto;padding:32px 20px;line-height:1.7;">
            <p style="margin:0 0 14px 0;">Hi ${adminName},</p>
            <p style="margin:0 0 14px 0;">Payment has been received for an invoice that was previously overdue.</p>
            <p style="margin:0 0 10px 0;">Client Name: ${clientName}</p>
            <p style="margin:0 0 10px 0;">Invoice Number: ${safeInvoiceId}</p>
            <p style="margin:0 0 10px 0;">Amount Due: JMD $${amountLabel}</p>
            <p style="margin:0 0 10px 0;">Due Date: ${dueDateLabel}</p>
            <p style="margin:0 0 10px 0;">Payment Date: ${paymentDateLabel}</p>
            <p style="margin:0 0 14px 0;">Payment Method: ${paymentMethodLabel}</p>
            <p style="margin:0 0 14px 0;">The client’s account balance has been updated automatically and no further action is required unless additional follow-up is needed.</p>
            <p style="margin:0 0 16px 0;"><a href="${appInvoiceUrl}" style="color:#2f62d7;text-decoration:underline;font-weight:700;">Click here to view invoice</a></p>

            <p style="margin:18px 0 0 0;color:#9ca3af;font-size:12px;line-height:1.6;text-align:center;">
              876 Nurses Home Care Services · Kingston, Jamaica<br />
              Need help? Email <a href="mailto:876nurses@gmail.com" style="color:#6b7280;text-decoration:underline;">876nurses@gmail.com</a>
            </p>
          </div>
        </body>
        </html>
      `;

      const buildText = (adminName) => [
        `Hi ${adminName},`,
        '',
        'Payment has been received for an invoice that was previously overdue.',
        '',
        `Client Name: ${clientName}`,
        `Invoice Number: ${safeInvoiceId}`,
        `Amount Due: JMD $${amountLabel}`,
        `Due Date: ${dueDateLabel}`,
        `Payment Date: ${paymentDateLabel}`,
        `Payment Method: ${paymentMethodLabel}`,
        '',
        'The client’s account balance has been updated automatically and no further action is required unless additional follow-up is needed.',
        '',
        `Click here to view invoice: ${appInvoiceUrl}`,
        '',
        'Need help? Email 876nurses@gmail.com',
        '876 Nurses Home Care Services · Kingston, Jamaica',
      ].join('\n');

      await Promise.allSettled(
        recipients.map((recipient) => {
          const adminName = this._getAdminDisplayName(recipient) || 'Admin';

          return FirebaseEmailQueueService.enqueueEmail({
            to: recipient.email,
            subject,
            html: buildHtml(adminName),
            text: buildText(adminName),
            attachments: [],
            meta: {
              type: 'overdue_payment_confirmation_admin',
              invoiceId: safeInvoiceId,
              recipientRole: this._getEffectiveNotificationRole(recipient),
            },
          });
        })
      );
    } catch (error) {
      console.warn('Failed to queue overdue payment confirmation for financial admins:', error);
    }
  }

    static async getAppointmentStorageKeys() {
      try {
        const keys = await AsyncStorage.getAllKeys();
        return keys.filter(key => key.startsWith('@876_appointments_'));
      } catch (error) {
        return [];
      }
    }

  static STORAGE_KEY = '@876_invoices';
  static INVOICE_COUNTER_KEY = '@876_invoice_counter';
  static SYNC_QUEUE_KEY = '@876_invoice_sync_queue';
  static RECURRING_SCHEDULES_KEY = '@876_recurring_schedules';

  static COUNTERS_COLLECTION = 'counters';
  // Use a dedicated counter for nurse invoices to avoid colliding with legacy/migrated
  // generic invoice counters (which commonly start at 1000).
  static INVOICE_COUNTER_DOC_ID = 'nurseInvoiceNumber';

  static _autoSeedAttempted = false;
  static _firestoreInvoiceCounterBlocked = false;

  static _invoiceLogoDataUriCache = null;

  static async _getInvoiceLogoDataUri() {
    try {
      if (this._invoiceLogoDataUriCache) return this._invoiceLogoDataUriCache;

      const asset = Asset.fromModule(require('../assets/Images/Nurses-logo.png'));
      await asset.downloadAsync();

      const logoUri = asset.localUri || asset.uri;
      if (!logoUri) return null;

      const base64 = await FileSystem.readAsStringAsync(logoUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!base64) return null;
      this._invoiceLogoDataUriCache = `data:image/png;base64,${base64}`;
      return this._invoiceLogoDataUriCache;
    } catch (e) {
      return null;
    }
  }

  static _extractNurseInvoiceSequence(invoiceId) {
    if (typeof invoiceId !== 'string') return null;
    const match = invoiceId.match(/^NUR-INV-(\d+)$/i);
    if (!match) return null;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  static async _inferLastNurseInvoiceSequenceFromFirestore() {
    try {
      const invoicesRef = collection(db, 'invoices');
      // Invoice IDs are zero-padded (NUR-INV-0001), so ordering by invoiceId desc
      // gives us the highest sequence in typical usage.
      const q = query(invoicesRef, orderBy('invoiceId', 'desc'), limit(25));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const seq = this._extractNurseInvoiceSequence(d.data()?.invoiceId);
        if (seq !== null) return seq;
      }
      return null;
    } catch {
      return null;
    }
  }

  static async _ensureFirestoreInvoiceCounterSeeded(localCounter) {
    // Best-effort: if the counter doc doesn't exist yet, initialize it automatically.
    // This makes invoice numbering behave like staff codes (admin/nurse counters) without
    // requiring an admin to manually set the last invoice number.
    if (this._autoSeedAttempted) return;
    this._autoSeedAttempted = true;

    try {
      const counterRef = doc(db, this.COUNTERS_COLLECTION, this.INVOICE_COUNTER_DOC_ID);
      const snap = await getDoc(counterRef);
      if (snap.exists()) return;

      const inferred = await this._inferLastNurseInvoiceSequenceFromFirestore();
      const seedValue = Math.max(Number.isFinite(localCounter) ? localCounter : 0, inferred ?? 0);

      await setDoc(
        counterRef,
        {
          sequence: seedValue,
          updatedAt: serverTimestamp(),
          autoSeeded: true,
          autoSeedSource: inferred !== null ? 'invoices' : 'local',
          seededAt: serverTimestamp(),
        },
        { merge: true }
      );

      await this._setLocalInvoiceCounter(seedValue);
    } catch {
      // Ignore auto-seed failures (offline / rules). Transaction path will still work when possible.
    }
  }

  static _parseCounterValue(counterStr) {
    const parsed = counterStr ? parseInt(counterStr, 10) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  static async _getLocalInvoiceCounter() {
    try {
      const counterStr = await AsyncStorage.getItem(this.INVOICE_COUNTER_KEY);
      return this._parseCounterValue(counterStr);
    } catch {
      return 0;
    }
  }

  static async _setLocalInvoiceCounter(value) {
    try {
      if (Number.isFinite(value) && value >= 0) {
        await AsyncStorage.setItem(this.INVOICE_COUNTER_KEY, String(value));
      }
    } catch {
      // Ignore local storage failures
    }
  }

  static formatAddressForStorage(addressValue) {
    if (!addressValue) return '';
    if (typeof addressValue === 'string') return addressValue;
    if (typeof addressValue !== 'object') return String(addressValue);

    const parts = [];
    if (addressValue.street) parts.push(addressValue.street);
    if (addressValue.city) parts.push(addressValue.city);
    if (addressValue.parish) parts.push(addressValue.parish);
    if (addressValue.postalCode) parts.push(addressValue.postalCode);
    if (addressValue.country) parts.push(addressValue.country);
    return parts.filter(Boolean).join(', ');
  }
  
  /**
   * Add item to sync queue for offline changes
   */
  static async queueForSync(action, data) {
    try {
      const queue = await AsyncStorage.getItem(this.SYNC_QUEUE_KEY);
      const syncQueue = queue ? JSON.parse(queue) : [];
      
      syncQueue.push({
        id: `${action}-${Date.now()}`,
        action, // 'create', 'update', 'delete', 'create_schedule'
        data,
        timestamp: new Date().toISOString(),
        retries: 0
      });
      
      await AsyncStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
      // Queued for sync
    } catch (error) {
      // Error adding to sync queue
    }
  }

  /**
   * Process sync queue when connection is restored
   */
  static async processSyncQueue() {
    try {
      const queue = await AsyncStorage.getItem(this.SYNC_QUEUE_KEY);
      if (!queue) return;

      const syncQueue = JSON.parse(queue);
      if (syncQueue.length === 0) return;

      // Processing queued changes
      
      const processed = [];
      const failed = [];

      for (const item of syncQueue) {
        try {
          let success = false;
          const normalizedInvoiceId = this.normalizeInvoiceId(item?.data?.invoiceId);
          
          switch (item.action) {
            case 'create':
              await ApiService.post('/api/invoices', item.data);
              success = true;
              break;
            case 'update':
              await ApiService.put(`/api/invoices/${normalizedInvoiceId}`, item.data);
              success = true;
              break;
            case 'delete':
              await ApiService.delete(`/api/invoices/${normalizedInvoiceId}`);
              success = true;
              break;
            case 'create_schedule':
              await ApiService.post('/api/recurring-invoices/schedules', item.data);
              success = true;
              break;
            case 'update_schedule':
              await ApiService.put(`/api/recurring-invoices/schedules/${item.data.id}`, item.data);
              success = true;
              break;
          }

          if (success) {
            processed.push(item.id);
            // Synced
          }
        } catch (error) {
          item.retries = (item.retries || 0) + 1;
          if (item.retries > 3) {
            failed.push(item.id);
            // Failed after 3 retries
          } else {
            // Retry for sync item
          }
        }
      }

      // Remove successfully processed items
      const remainingQueue = syncQueue.filter(item => !processed.includes(item.id));
      
      if (remainingQueue.length > 0) {
        await AsyncStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(remainingQueue));
      } else {
        await AsyncStorage.removeItem(this.SYNC_QUEUE_KEY);
      }

      // Sync complete
      return {
        synced: processed.length,
        failed: failed.length,
        remaining: remainingQueue.length
      };
    } catch (error) {
      // Error processing sync queue
    }
  }
  
  /**
   * Get sync queue status
   */
  static async getSyncQueueStatus() {
    try {
      const queue = await AsyncStorage.getItem(this.SYNC_QUEUE_KEY);
      const syncQueue = queue ? JSON.parse(queue) : [];
      return {
        hasPendingChanges: syncQueue.length > 0,
        pendingCount: syncQueue.length,
        items: syncQueue
      };
    } catch (error) {
      return { hasPendingChanges: false, pendingCount: 0, items: [] };
    }
  }
  

  static formatDateForInvoice(dateString) {
    if (!dateString) {
      const today = new Date();
      return today.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    const formatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

    try {
      if (dateString instanceof Date) {
        return !isNaN(dateString.getTime())
          ? dateString.toLocaleDateString('en-US', formatOptions)
          : new Date().toLocaleDateString('en-US', formatOptions);
      }

      // If already in "MMM D, YYYY" format (e.g., "Dec 23, 2025"), return as is
      if (typeof dateString === 'string' && /^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/.test(dateString)) {
        return dateString;
      }
      
      // Try to parse as Date
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', formatOptions);
      }
      
      // If can't parse, return today's date
      return new Date().toLocaleDateString('en-US', formatOptions);
    } catch (error) {
      return new Date().toLocaleDateString('en-US', formatOptions);
    }
  }

  /**
   * Format currency with thousand separators (e.g., J$1,234.56)
   */
  static formatCurrency(amount, currencyCode = 'JMD') {
    const numericAmount = typeof amount === 'number'
      ? amount
      : parseFloat(amount || 0) || 0;

    const currencyMap = {
      JMD: 'J$',
      USD: 'US$',
      CAD: 'CA$',
      EUR: '€',
      GBP: '£'
    };

    const symbol = currencyMap[currencyCode] || currencyCode || 'J$';
    // Add thousand separators with toLocaleString
    return `${symbol}${numericAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  static parseDateInput(value) {
    if (!value) return null;

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        const parsed = value.toDate();
        return parsed && !isNaN(parsed.getTime()) ? parsed : null;
      }

      if (typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000);
      }

      if (value.$date) {
        const parsed = new Date(value.$date);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
    }

    // Handle "Feb 19, 2026" format from BookScreen
    if (typeof value === 'string') {
      const match = value.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
      if (match) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = monthNames.findIndex(m => m === match[1]);
        if (monthIndex !== -1) {
          const d = new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
          if (!isNaN(d.getTime())) {
            return d;
          }
        }
      }
    }

    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  
  // Service rates configuration - UPDATED JAN 21, 2026 per Nurse Bernard's pricing
  static SERVICE_RATES = {
    // Wound Care Services
    'Wound Care - With Supplies': 15000,
    'Wound Care - Without Supplies': 9500,
    'Wound Care': 9500, // Default without supplies
    
    // NG Tube Services
    'NG Tube Repass - With Supplies': 15000,
    'NG Tube Repass - Without Supplies': 8500,
    'NG Tubes': 8500, // Default without supplies
    
    // Urinary Catheter Services
    'Repass Urine Catheter - With Supplies': 16500,
    'Repass Urine Catheter - Without Supplies': 10000,
    'Urinary Catheter': 10000, // Default without supplies
    
    // IV Services
    'IV Therapy Monitoring (2hrs)': 27350,
    'IV Cannulation': 8500,
    'IV Access': 8500, // Alias for IV Cannulation
    
    // Nursing Services - Practical Nurse (PN)
    'PN - 8 Hour Service': 7500,
    'PN - 12 Hour Service': 9500,
    'PN - 8 Hour Shift': 7500, // Alias
    'PN - 12 Hour Shift': 9500, // Alias
    'Practical Nurse Shift': 7500, // Default to 8hr rate
    
    // Registered Nurse (RN)
    'RN - Hourly': 4500,
    'Registered Nurse Hourly': 4500,
    'RN - Hourly (1-4hrs)': 4500, // Legacy alias
    'RN - Hourly (5+ hrs)': 4500, // Updated to flat rate
    
    // Physiotherapy
    'Physiotherapy (2hrs)': 10000,
    'Physiotherapy': 10000,
    'Physical Therapy': 10000, // Alias
    
    // Doctors Visits
    'Doctors Visits': 0, // Location-based pricing - to be calculated
    
    // Live-in Care Services
    'Weekly Live-in Care (7 days)': 55000,
    'Monthly Live-in Care (4 weeks)': 170000,
    'PN - Weekly Live-in': 55000, // Alias
    'PN - Monthly Live-in': 170000, // Alias
    'Caregiver - Weekly Live-in': 55000, // Alias
    'Caregiver - Monthly Live-in': 170000, // Alias
    
    // Legacy/Backward Compatibility Services
    'Dressings': 6750,
    'Medication Administration': 5275,
    'Tracheostomy Care': 14300,
    'Blood Draws': 6025,
    'Injection Services': 5275,
    'Home Nursing': 18100,
    'Elderly Care': 16575,
    'Hospital Sitter': 15075,
    'Post-Surgery Care': 22575,
    'Post-Surgical Care': 22575, // Alias
    'Palliative Care': 19575,
    'Vital Signs': 4525,
    'Health Assessments': 13575,
    'Health Assessment': 13575, // Alias
    'Diabetic Care': 8300,
    'PN - Daily Live-in (24hrs)': 9000, // Legacy
    'Caregiver - Daily Live-in (24hrs)': 9000, // Legacy
    
    // Legacy/Generic services (fallback)
    'Home Visit': 18100,
    'Health Monitoring': 8300,
    'General Nursing': 18100,
    'Emergency Care': 22575,
    'Consultation': 13575,
    'Consultation Call (Phone Advice)': 1500,
  };

  // Company information
  static COMPANY_INFO = {
    name: '876Nurses Home Care Services Limited',
    address: '15 Oaklands Ave, Kingston 10, Jamaica, W.I.',
    phone: '876-288-7304',
    email: 'care@nursingcareja.com',
    website: 'www.nursingcareja.com',
    paymentInfo: 'NCB Bank Account Details:\nJMD Account: 380111365078\nUSD Account: 380111365086\nPayee: Nurse Bernard\nBranch: Liguanea\nSwift Code: JNCBJMKX\nSort Code: 380111\n\nCash accepted for home visits\nPOS machine available'
  };

  /**
   * Fetch and update company payment info from backend
   */
  static async updateCompanyInfo() {
    try {
      const response = await ApiService.getPaymentSettings();
      if (response.success && response.data) {
        const settings = response.data;
        // Construct payment info string from settings
        let paymentInfoStr = '';
        
        if (settings.bankName) paymentInfoStr += `${settings.bankName} Bank Account Details:\n`;
        if (settings.accountNumber) paymentInfoStr += `Account: ${settings.accountNumber}\n`;
        if (settings.accountName) paymentInfoStr += `Payee: ${settings.accountName}\n`;
        if (settings.branch) paymentInfoStr += `Branch: ${settings.branch}\n`;
        
        // Add any custom instructions
        if (settings.paymentInstructions) {
          paymentInfoStr += `\n${settings.paymentInstructions}`;
        }
        
        // Only update if we got valid data
        if (paymentInfoStr) {
          this.COMPANY_INFO.paymentInfo = paymentInfoStr;
          // Updated invoice payment info from backend settings
        }
      }
    } catch (error) {
      // Failed to fetch payment settings for invoice, using defaults
    }
  }

  /**
   * Get service price - tries to match service name, falls back to default
   */
  static getServicePrice(serviceName) {
    if (!serviceName) return 18100; // Default to Home Nursing rate
    
    // Direct match
    if (this.SERVICE_RATES[serviceName]) {
      return this.SERVICE_RATES[serviceName];
    }
    
    // Case-insensitive match
    const serviceKey = Object.keys(this.SERVICE_RATES).find(
      key => key.toLowerCase() === serviceName.toLowerCase()
    );
    
    if (serviceKey) {
      return this.SERVICE_RATES[serviceKey];
    }
    
    // Partial match (e.g., "Wound Care" matches "wound")
    const partialMatch = Object.keys(this.SERVICE_RATES).find(
      key => key.toLowerCase().includes(serviceName.toLowerCase()) ||
             serviceName.toLowerCase().includes(key.toLowerCase())
    );
    
    if (partialMatch) {
      return this.SERVICE_RATES[partialMatch];
    }
    
    // Default fallback
    // No price found for service, using default rate
    return 18100;
  }

  /**
   * Calculate Registered Nurse (RN) rate based on hours worked
   * @param {number} hours - Number of hours worked
   * @returns {number} Total cost for RN services
   */
  static calculateRNRate(hours) {
    if (!hours || hours <= 0) return 0;
    
    if (hours <= 4) {
      // Up to 4 hours: $4500/hr
      return hours * 4500;
    } else {
      // First 4 hours at $4500/hr, remaining hours at $3500/hr
      return (4 * 4500) + ((hours - 4) * 3500);
    }
  }

  /**
   * Get hourly rate for Registered Nurse based on total hours
   * @param {number} totalHours - Total hours to be worked
   * @returns {number} Hourly rate (4500 for ≤4hrs, 3500 for 5+hrs)
   */
  static getRNHourlyRate(totalHours) {
    return totalHours <= 4 ? 4500 : 3500;
  }

  /**
   * Get Practical Nurse shift rate
   * @param {string} shiftType - '8hr', '12hr', '24hr_live_in', or 'weekly_live_in'
   * @returns {number} Shift rate
   */
  static getPNShiftRate(shiftType) {
    const rates = {
      '8hr': 6500,
      '8hour': 6500,
      '8 hour': 6500,
      '12hr': 8500, 
      '12hour': 8500,
      '12 hour': 8500,
      '24hr': 9000,
      '24hr_live_in': 9000,
      '24 hour': 9000,
      'daily_live_in': 9000,
      'weekly_live_in': 45000,
      'weekly': 45000
    };
    
    const normalizedType = shiftType?.toLowerCase().replace(/[_\s-]/g, '');
    return rates[normalizedType] || rates[shiftType] || 6500; // Default to 8hr rate
  }

  /**
   * Initialize invoice counter from existing business system
  * Call this once to continue from Nurse Bernard's last invoice number
   */
  static async initializeInvoiceCounter(lastInvoiceNumber) {
    try {
      // Extract number from invoice ID (e.g., "NUR-INV-1234" -> 1234)
      let startingNumber = 0;
      
      if (typeof lastInvoiceNumber === 'string') {
        const match = lastInvoiceNumber.match(/(\d+)$/);
        if (match) {
          startingNumber = parseInt(match[1]);
        }
      } else if (typeof lastInvoiceNumber === 'number') {
        startingNumber = lastInvoiceNumber;
      }
      
      // Set the counter to continue from the last used number
      await this._setLocalInvoiceCounter(startingNumber);

      // Also set the Firestore counter so the sequence is global and atomic
      const counterRef = doc(db, this.COUNTERS_COLLECTION, this.INVOICE_COUNTER_DOC_ID);
      await setDoc(
        counterRef,
        {
          sequence: startingNumber,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      
      return {
        success: true,
        message: `Invoice counter initialized. Next invoice will be NUR-INV-${(startingNumber + 1).toString().padStart(4, '0')}`,
        startingNumber,
        nextNumber: startingNumber + 1
      };
    } catch (error) {
      // Error initializing invoice counter
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current invoice counter status
   */
  static async getInvoiceCounterStatus() {
    try {
      const localCounter = await this._getLocalInvoiceCounter();

      let firestoreCounter = null;
      try {
        const counterRef = doc(db, this.COUNTERS_COLLECTION, this.INVOICE_COUNTER_DOC_ID);
        const snap = await getDoc(counterRef);
        if (snap.exists()) {
          const seq = snap.data()?.sequence;
          firestoreCounter = Number.isFinite(seq) && seq >= 0 ? seq : null;
        }
      } catch {
        // Ignore Firestore issues here; fall back to local
      }

      const currentCounter = Math.max(localCounter, firestoreCounter ?? 0);
      
      return {
        currentCounter,
        nextInvoiceId: `NUR-INV-${(currentCounter + 1).toString().padStart(4, '0')}`,
        lastInvoiceId: currentCounter > 0 ? `NUR-INV-${currentCounter.toString().padStart(4, '0')}` : 'None'
      };
    } catch (error) {
      // Error getting invoice counter status
      return null;
    }
  }

  /**
   * Generate unique invoice ID
   */
  static async generateInvoiceId() {
    try {
      if (this._firestoreInvoiceCounterBlocked) {
        // Use local-only sequencing once we know Firestore counter access is blocked.
        const counter = (await this._getLocalInvoiceCounter()) + 1;
        await this._setLocalInvoiceCounter(counter);
        return `NUR-INV-${String(counter).padStart(4, '0')}`;
      }

      const localCounter = await this._getLocalInvoiceCounter();
      const counterRef = doc(db, this.COUNTERS_COLLECTION, this.INVOICE_COUNTER_DOC_ID);

      // Auto-initialize the counter doc once if it's missing, seeded from existing invoices when possible.
      await this._ensureFirestoreInvoiceCounterSeeded(localCounter);

      const result = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(counterRef);

        const existingSeqRaw = snap.exists() ? snap.data()?.sequence : null;
        const existingSeq = Number.isFinite(existingSeqRaw) && existingSeqRaw >= 0 ? existingSeqRaw : 0;

        // Ensure we never go backwards if the device has a higher local counter.
        const base = Math.max(existingSeq, localCounter);
        const nextSequence = base + 1;

        if (snap.exists()) {
          transaction.update(counterRef, {
            sequence: nextSequence,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(counterRef, {
            sequence: nextSequence,
            updatedAt: serverTimestamp(),
          });
        }

        return {
          nextSequence,
          invoiceId: `NUR-INV-${String(nextSequence).padStart(4, '0')}`,
        };
      });

      await this._setLocalInvoiceCounter(result.nextSequence);
      return result.invoiceId;
    } catch (error) {
      // Error generating invoice ID
      if (error?.code === 'permission-denied') {
        this._firestoreInvoiceCounterBlocked = true;
      }
      try {
        // Fallback to local-only sequencing when offline or blocked by rules.
        const counter = (await this._getLocalInvoiceCounter()) + 1;
        await this._setLocalInvoiceCounter(counter);
        return `NUR-INV-${String(counter).padStart(4, '0')}`;
      } catch {
        return `NUR-INV-${Date.now()}`;
      }
    }
  }

  /**
   * Generate invoice HTML template
   */
  static generateInvoiceHTML(invoiceData) {
    const {
      invoiceId,
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      nurseName,
      service,
      date,
      hours,
      rate,
      total,
      issueDate,
      dueDate
    } = invoiceData;

    // Format currency as Jamaican dollars
    const formatJMD = (amount) => `J$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${invoiceId}</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 20px;
            color: #333;
            line-height: 1.6;
          }
          .invoice-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 40px;
            border-bottom: 3px solid #00D4FF;
            padding-bottom: 20px;
          }
          .company-info {
            flex: 1;
          }
          .company-name {
            font-size: 28px;
            font-weight: bold;
            color: #00D4FF;
            margin-bottom: 10px;
          }
          .company-details {
            font-size: 14px;
            color: #666;
            line-height: 1.4;
          }
          .invoice-title {
            text-align: right;
            flex: 1;
          }
          .invoice-number {
            font-size: 24px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
          }
          .invoice-dates {
            font-size: 14px;
            color: #666;
          }
          .billing-section {
            display: flex;
            justify-content: space-between;
            margin-bottom: 40px;
          }
          .bill-to, .service-provider {
            flex: 1;
            margin-right: 20px;
          }
          .section-title {
            font-size: 16px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
            text-transform: uppercase;
          }
          .section-content {
            font-size: 14px;
            color: #666;
            line-height: 1.5;
          }
          .service-details {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          .service-details th {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 15px;
            text-align: left;
            font-weight: bold;
            color: #333;
          }
          .service-details td {
            border: 1px solid #dee2e6;
            padding: 15px;
            color: #666;
          }
          .total-section {
            text-align: right;
            margin-bottom: 40px;
          }
          .total-row {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
          }
          .total-label {
            width: 150px;
            font-weight: bold;
            color: #333;
          }
          .total-amount {
            width: 100px;
            text-align: right;
            color: #333;
          }
          .grand-total {
            border-top: 2px solid #00D4FF;
            padding-top: 10px;
            font-size: 18px;
            font-weight: bold;
            color: #00D4FF;
          }
          .payment-info {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
          }
          .payment-title {
            font-size: 16px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
          }
          .payment-details {
            font-size: 14px;
            color: #666;
            white-space: pre-line;
          }
          .footer {
            text-align: center;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 20px;
          }
          @media print {
            body { margin: 0; }
            .invoice-container { 
              box-shadow: none; 
              padding: 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header">
            <div class="company-info">
              <div class="company-name">${this.COMPANY_INFO.name}</div>
              <div class="company-details">
                ${this.COMPANY_INFO.address}<br>
                Phone: ${this.COMPANY_INFO.phone}<br>
                Email: ${this.COMPANY_INFO.email}<br>
                Web: ${this.COMPANY_INFO.website}
              </div>
            </div>
            <div class="invoice-title">
              <div class="invoice-number">INVOICE</div>
              <div class="invoice-number">${invoiceId}</div>
              <div class="invoice-dates">
                Issue Date: ${issueDate}<br>
                Due Date: ${dueDate}
              </div>
            </div>
          </div>

          <div class="billing-section">
            <div class="bill-to">
              <div class="section-title">Bill To:</div>
              <div class="section-content">
                <strong>${clientName}</strong><br>
                ${clientEmail}<br>
                ${clientPhone}<br>
                ${clientAddress}
              </div>
            </div>
            <div class="service-provider">
              <div class="section-title">Service Provider:</div>
              <div class="section-content">
                <strong>${nurseName}</strong><br>
                Registered Nurse<br>
                ${this.COMPANY_INFO.name}
              </div>
            </div>
          </div>

          <table class="service-details">
            <thead>
              <tr>
                <th>Service Description</th>
                <th>Date</th>
                <th>Hours</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${service}</td>
                <td>${date}</td>
                <td>${hours || 1}</td>
                <td>${formatJMD(rate)}</td>
                <td>${formatJMD(total)}</td>
              </tr>
            </tbody>
          </table>

          <div class="total-section">
            <div class="total-row">
              <div class="total-label">Deposit:</div>
              <div class="total-amount">${formatJMD(total)}</div>
            </div>
            <div class="total-row grand-total">
              <div class="total-label">Total Amount:</div>
              <div class="total-amount">${formatJMD(total)}</div>
            </div>
          </div>

          <div class="payment-info">
            <div class="payment-title">Payment Information</div>
            <div class="payment-details">${this.COMPANY_INFO.paymentInfo}</div>
          </div>

          <div class="footer">
            <p>Thank you for choosing ${this.COMPANY_INFO.name}!</p>
            <p>For questions regarding this invoice, please contact us at ${this.COMPANY_INFO.email}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Set up automatic email invoicing for recurring patients
   */
  static async setupRecurringInvoiceSchedule(clientData, frequency = 'monthly') {
    try {
      const scheduleData = {
        clientId: clientData.id,
        clientName: clientData.name || clientData.clientName,
        email: clientData.email,
        serviceType: clientData.serviceType || clientData.service,
        frequency: frequency, // 'weekly', 'monthly', 'quarterly'
        isActive: true,
        lastSent: null,
        nextScheduled: this.calculateNextInvoiceDate(frequency),
        createdAt: new Date().toISOString(),
        recurringSettings: {
          autoGenerate: true,
          autoEmail: true,
          emailTemplate: 'recurring_invoice',
          rate: clientData.rate || this.SERVICE_RATES[clientData.serviceType] || 50
        }
      };

      // Save to AsyncStorage
      const existingSchedules = await this.getRecurringSchedules();
      const updatedSchedules = existingSchedules.filter(s => s.clientId !== clientData.id);
      updatedSchedules.push(scheduleData);
      
      await AsyncStorage.setItem('@876_recurring_schedules', JSON.stringify(updatedSchedules));
      
      return scheduleData;
    } catch (error) {
      // Error setting up recurring invoice schedule
      throw error;
    }
  }

  /**
   * Calculate next invoice date based on frequency
   */
  static calculateNextInvoiceDate(frequency) {
    const now = new Date();
    switch (frequency.toLowerCase()) {
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      case 'monthly':
        return new Date(now.setMonth(now.getMonth() + 1)).toISOString();
      case 'quarterly':
        return new Date(now.setMonth(now.getMonth() + 3)).toISOString();
      case 'yearly':
        return new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
      default:
        return new Date(now.setMonth(now.getMonth() + 1)).toISOString();
    }
  }

  /**
   * Get all recurring invoice schedules
   */
  static async getRecurringSchedules() {
    try {
      const schedules = await AsyncStorage.getItem('@876_recurring_schedules');
      return schedules ? JSON.parse(schedules) : [];
    } catch (error) {
      // Error getting recurring schedules
      return [];
    }
  }

  /**
   * Process due recurring invoices
   */
  static async processDueRecurringInvoices() {
    try {
      const schedules = await this.getRecurringSchedules();
      const now = new Date();
      
      // Generate invoices 3 days before due date instead of on due date
      const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
      
      const dueInvoices = schedules.filter(schedule => 
        schedule.isActive && 
        new Date(schedule.nextScheduled) <= threeDaysFromNow &&
        new Date(schedule.nextScheduled) > now
      );

      for (const schedule of dueInvoices) {
        try {
          // Generate invoice data for recurring client
          const invoiceData = {
            id: `RECURRING-${schedule.clientId}-${Date.now()}`,
            clientName: schedule.clientName,
            email: schedule.email,
            service: schedule.serviceType,
            appointmentDate: schedule.nextScheduled, // Use the actual scheduled date
            scheduledDate: schedule.nextScheduled, // For due date calculation
            hoursWorked: 2, // Default for recurring
            isRecurring: true,
            frequency: schedule.frequency,
            status: 'pending'
          };

          // Create the invoice
          const invoice = await this.createInvoice(invoiceData);
          
          // Send email notification (simulated)
          await this.sendRecurringInvoiceEmail(invoice, schedule);
          
          // Update schedule for next invoice
          schedule.lastSent = now.toISOString();
          schedule.nextScheduled = this.calculateNextInvoiceDate(schedule.frequency);
        } catch (error) {
          // Failed to process recurring invoice
        }
      }

      // Save updated schedules
      await AsyncStorage.setItem('@876_recurring_schedules', JSON.stringify(schedules));
      
      return dueInvoices.length;
    } catch (error) {
      // Error processing due recurring invoices
      throw error;
    }
  }

  /**
   * Send recurring invoice email (simulated)
   */
  static async sendRecurringInvoiceEmail(invoice, schedule) {
    try {
      // In a real app, this would integrate with an email service like SendGrid, Mailgun, etc.
      // Calculate actual due date (3 days from now)
      const actualDueDate = new Date(schedule.nextScheduled);
      
      const emailData = {
        to: schedule.email,
        subject: `Upcoming Recurring Invoice - ${invoice.invoiceId} (Due in 3 days)`,
        template: 'recurring_invoice_early',
        data: {
          clientName: schedule.clientName,
          invoiceId: invoice.invoiceId,
          amount: invoice.total,
          service: schedule.serviceType,
          frequency: schedule.frequency,
          dueDate: this.formatDateForInvoice(actualDueDate),
          earlyNotice: true,
          daysUntilDue: 3,
          pdfAttachment: invoice.pdfUri
        }
      };

      // Simulate email sending
      
      // Queue email via Firebase (Cloud Function mail queue)
      const emailResult = await FirebaseEmailQueueService.enqueueInvoiceEmail({
        to: schedule.email,
        invoiceData: {
          ...invoice,
          clientName: schedule.clientName,
          service: schedule.serviceType,
          invoiceNumber: invoice.invoiceId,
          date: this.formatDateForInvoice(actualDueDate)
        },
        pdfUri: invoice.pdfUri,
        meta: { kind: 'recurring-early' },
      });
      
      return emailResult;
    } catch (error) {
      // Error sending recurring invoice email
      throw error;
    }
  }

  /**
   * Create a sample invoice for testing/preview purposes
   */
  static async createSampleInvoice() {
    try {
      const sampleAppointmentData = {
        id: 'SAMPLE-001',
        patientName: 'John Smith',
        clientName: 'John Smith',
        email: 'john.smith@example.com',
        phone: '+1 (555) 123-4567',
        address: '123 Main Street, Anytown, State 12345',
        nurseName: 'Sarah Johnson, RN',
        service: 'Home Nursing',
        date: new Date().toISOString(),
        hoursWorked: 2.5,
        actualStartTime: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
        actualEndTime: new Date().toISOString(),
        status: 'completed'
      };

      const invoice = await this.createInvoice(sampleAppointmentData);
      return invoice;
    } catch (error) {
      // Error creating sample invoice
      throw error;
    }
  }

  /**
   * Create and save invoice from appointment data
   */
  /**
   * Create a partial invoice with deposit payment
   * Used when patient makes upfront deposit before appointment
   */
  static async createPartialInvoice(appointmentData, depositInfo) {
    try {
      // Ensure company info is up to date
      await this.updateCompanyInfo();

      const invoiceId = await this.generateInvoiceId();
      
      // Handle multiple services
      const services = appointmentData.services || [];
      const items = services.map(service => {
        // Use the price passed from the booking screen (from Firestore service config) if available,
        // otherwise fall back to the hardcoded SERVICE_RATES table.
        const passedPrice = typeof service.price === 'number'
          ? service.price
          : (typeof service.price === 'string' ? parseFloat(String(service.price).replace(/,/g, '')) || 0 : 0);
        const rate = passedPrice > 0 ? passedPrice : this.getServicePrice(service.name || service);
        const hours = service.hours || appointmentData.hoursWorked || 1;
        return {
          description: service.name || service,
          detailedDescription: service.description || `Professional ${(service.name || service).toLowerCase()} services`,
          quantity: hours,
          price: rate,
          total: rate * hours,
          serviceDates: '',
          nurseNames: ''
        };
      });

      const subtotal = items.reduce((sum, item) => sum + item.total, 0);
      const paidAmount = depositInfo.amount || 0;
      const outstandingAmount = subtotal - paidAmount;

      const issueDate = this.formatDateForInvoice(new Date());

      const invoiceData = {
        invoiceId,
        clientName: appointmentData.patientName || appointmentData.clientName || 'Client',
        clientEmail: appointmentData.patientEmail || appointmentData.email || appointmentData.clientEmail || 'client@care.com',
        clientPhone: appointmentData.clientPhone || appointmentData.patientPhone || appointmentData.phone || 'N/A',
        clientAddress: this.formatAddressForStorage(appointmentData.address || appointmentData.clientAddress) || 'Address on file',
        nurseName: 'To be assigned',
        service: services.map(s => s.name || s).join(', '),
        date: this.formatDateForInvoice(appointmentData.appointmentDate),
        hours: 1,
        rate: subtotal,
        total: subtotal,
        issueDate,
        dueDate: this.formatDateForInvoice(appointmentData.appointmentDate),
        status: 'Partial',
        paymentStatus: 'partial',
        isConsultation: true, // Allows patient-created deposit invoices per Firestore rule line 109
        createdAt: new Date().toISOString(),
        appointmentId: appointmentData.id,
        relatedAppointmentId: appointmentData.id,
        items,
        serviceDate: this.formatDateForInvoice(appointmentData.appointmentDate),
        subtotal,
        tax: 0,
        finalTotal: subtotal,
        paidAmount,
        outstandingAmount,
        payments: [{
          amount: paidAmount,
          transactionId: depositInfo.transactionId,
          type: 'deposit',
          date: new Date().toISOString(),
          method: depositInfo.method || 'fygaro',
          status: 'completed'
        }]
      };

      invoiceData.logoDataUri = await this._getInvoiceLogoDataUri();

      // Generate PDF using InvoiceImageGenerator
      const html = InvoiceImageGenerator.createInvoiceHTML(invoiceData);
      const { uri } = await Print.printToFileAsync({ 
        html,
        base64: false,
        width: 612,
        height: 792,
      });

      // Save PDF to local storage
      const fileName = `${invoiceId}.pdf`;
      const fileUri = `${FileSystem.documentDirectory}invoices/${fileName}`;
      
      // Create invoices directory if it doesn't exist
      const dirInfo = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}invoices/`);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}invoices/`, { intermediates: true });
      }

      // Copy PDF to permanent location
      await FileSystem.copyAsync({
        from: uri,
        to: fileUri
      });

      // Save invoice record
      const invoiceRecord = {
        ...invoiceData,
        pdfUri: fileUri,
        fileName
      };

      const savedInvoice = await this.saveInvoiceRecord(invoiceRecord);

      return {
        success: true,
        invoice: savedInvoice
      };
    } catch (error) {
      // Error creating partial invoice
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async createInvoice(appointmentData) {
    try {
      // Ensure company info is up to date
      await this.updateCompanyInfo();

      const invoiceId = await this.generateInvoiceId();
      const serviceType = appointmentData.serviceType || appointmentData.serviceName || appointmentData.service;
      
      // Get the actual service price using our lookup method
      const rate = this.getServicePrice(serviceType);
      
      const hours = appointmentData.hoursWorked || 1;
      const total = rate * hours;
      
      // Calculate dates correctly based on service/appointment date
      const serviceDate = this.parseDateInput(appointmentData.appointmentDate) || new Date();
      const issueDate = this.formatDateForInvoice(serviceDate); // Use service date as issue date

      const explicitDueDate = this.parseDateInput(
        appointmentData.dueDate || appointmentData.paymentDueDate || appointmentData.invoiceDueDate
      );

      // Determine billing frequency from appointment data
      const billingFrequency = appointmentData.billingFrequency || 
                              appointmentData.recurringBilling?.frequency || 
                              appointmentData.frequency || 
                              'weekly';

      const billingAnchors = [
        appointmentData.recurringBilling?.nextBillingDate,
        appointmentData.recurringBilling?.cycleStartDate,
        appointmentData.recurringBilling?.cycleEndDate,
        appointmentData.billingCycleDate,
        appointmentData.billingPeriodStart,
        appointmentData.billingPeriodEnd,
        appointmentData.recurringPeriodStart,
        appointmentData.recurringPeriodEnd,
        appointmentData.scheduledDate,
        appointmentData.nextServiceDate,
      ];

      let nextServiceDate = null;
      for (const candidate of billingAnchors) {
        const parsed = this.parseDateInput(candidate);
        if (parsed) {
          nextServiceDate = parsed;
          break;
        }
      }

      // If no explicit next service date, calculate from service date + billing frequency
      if (!nextServiceDate) {
        const daysToAdd = billingFrequency === 'fortnightly' ? 14 : 
                         billingFrequency === 'weekly' ? 7 : 
                         billingFrequency === 'monthly' ? 30 : 7;
        nextServiceDate = new Date(serviceDate.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
      }

      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      let dueDateBase;

      if (explicitDueDate) {
        dueDateBase = explicitDueDate;
      } else {
        // Due date = 3 days before next service date
        dueDateBase = new Date(nextServiceDate.getTime() - threeDaysMs);
      }

      const generalSettings = await this._getAdminPaymentGeneralSettings();
      const termsDaysRaw = generalSettings?.defaultPaymentTermsDays;
      const termsDays = Number.isFinite(termsDaysRaw) && Number(termsDaysRaw) > 0 ? Number(termsDaysRaw) : 7;
      const termsMs = termsDays * 24 * 60 * 60 * 1000;

      if (!(dueDateBase instanceof Date) || isNaN(dueDateBase.getTime())) {
        // Fallback: use default payment terms from settings
        dueDateBase = new Date(serviceDate.getTime() + termsMs);
      }

      // Ensure due date is after service date
      if (dueDateBase.getTime() <= serviceDate.getTime()) {
        dueDateBase = new Date(serviceDate.getTime() + termsMs);
      }

      const dueDate = this.formatDateForInvoice(dueDateBase); // Use same format as service date

      const periodStartDate = this.parseDateInput(
        appointmentData.billingPeriodStart ||
          appointmentData.recurringBilling?.cycleStartDate ||
          appointmentData.recurringPeriodStart
      );
      const periodEndDate = this.parseDateInput(
        appointmentData.billingPeriodEnd ||
          appointmentData.recurringBilling?.cycleEndDate ||
          appointmentData.recurringPeriodEnd
      );

      const invoiceData = {
        invoiceId,
        clientName: appointmentData.patientName || appointmentData.clientName || 'Client',
        clientEmail: appointmentData.patientEmail || appointmentData.email || appointmentData.clientEmail || '',
        clientPhone: appointmentData.clientPhone || appointmentData.patientPhone || appointmentData.phone || 'N/A',
        clientAddress: this.formatAddressForStorage(appointmentData.address || appointmentData.clientAddress) || 'Address on file',
        nurseName: appointmentData.nurseName || 'Assigned Nurse',
        service: serviceType,
        date: this.formatDateForInvoice(appointmentData.appointmentDate),
        hours,
        rate,
        total,
        issueDate,
        dueDate,
        periodStart: periodStartDate ? periodStartDate.toISOString() : null,
        periodEnd: periodEndDate ? periodEndDate.toISOString() : null,
        status: 'Pending',
        createdAt: new Date().toISOString(),
        appointmentId: appointmentData.id,
        relatedAppointmentId: appointmentData.relatedAppointmentId || appointmentData.appointmentId || appointmentData.id, // For backend compatibility
        shiftRequestId: appointmentData.shiftRequestId || null,
        visitKey: appointmentData.visitKey || null,
        patientId: appointmentData.patientId || appointmentData.clientId || appointmentData.userId || null,
        clientId: appointmentData.patientId || appointmentData.clientId || appointmentData.userId || null,
        // Add items array for compatibility with InvoiceImageGenerator
        items: [{
          description: serviceType,
          detailedDescription: `Professional ${serviceType.toLowerCase()} services provided`,
          quantity: hours,
          price: rate,
          total: total,
          serviceDates: this.formatDateForInvoice(appointmentData.appointmentDate),
          nurseNames: appointmentData.nurseName || 'Care Professional'
        }],
        // Additional fields for invoice display
        serviceDate: this.formatDateForInvoice(appointmentData.appointmentDate),
        subtotal: total,
        tax: 0, // No tax charged
        finalTotal: total
      };

      invoiceData.logoDataUri = await this._getInvoiceLogoDataUri();

      // Generate PDF using InvoiceImageGenerator
      const html = InvoiceImageGenerator.createInvoiceHTML(invoiceData);
      const { uri } = await Print.printToFileAsync({ 
        html,
        base64: false,
        width: 612,
        height: 792,
      });

      // Save PDF to local storage
      const fileName = `${invoiceId}.pdf`;
      const fileUri = `${FileSystem.documentDirectory}invoices/${fileName}`;
      
      // Create invoices directory if it doesn't exist
      const dirInfo = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}invoices/`);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}invoices/`, { intermediates: true });
      }

      // Copy PDF to permanent location
      await FileSystem.copyAsync({
        from: uri,
        to: fileUri
      });

      // Save invoice record
      const invoiceRecord = {
        ...invoiceData,
        pdfUri: fileUri,
        fileName
      };

      const savedInvoice = await this.saveInvoiceRecord(invoiceRecord);

      return {
        success: true,
        invoice: savedInvoice,
      };
    } catch (error) {
      // Error creating invoice
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save invoice record to AsyncStorage and sync to backend
   */
  static async saveInvoiceRecord(invoice) {
    // PRIMARY: Save to Firestore first (source of truth)
    const currentUid = auth?.currentUser?.uid || null;

    const invoiceData = {
      ...invoice,
      createdByUid: invoice?.createdByUid || currentUid,
      createdBySource: invoice?.createdBySource || 'mobile',
      createdAt: invoice.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // Save to Firestore
      const invoicesRef = collection(db, 'invoices');
      const docRef = await addDoc(invoicesRef, invoiceData);

      // Add Firestore document ID to invoice
      const savedInvoice = {
        ...invoiceData,
        firestoreId: docRef.id,
      };

      // SECONDARY: Cache locally in AsyncStorage for offline access
      await this._upsertCachedInvoice(savedInvoice);

      return savedInvoice;
    } catch (error) {
      console.error('Error saving invoice to Firestore:', error);

      const errorCode = error?.code || '';
      const isPermissionOrOffline = errorCode === 'permission-denied' || errorCode === 'unavailable';

      // Graceful fallback: keep booking flow alive when Firestore write is blocked.
      if (isPermissionOrOffline) {
        const fallbackInvoice = {
          ...invoiceData,
          firestoreId: null,
          syncStatus: 'local-only',
          saveErrorCode: errorCode || 'unknown',
        };

        await this._upsertCachedInvoice(fallbackInvoice);
        return fallbackInvoice;
      }

      throw error;
    }
  }

  /**
   * Get all invoices from Firestore (primary) with local cache fallback
   */
  static async getAllInvoices() {
    try {
      // PRIMARY: Fetch from Firestore
      const invoicesRef = collection(db, 'invoices');
      const q = query(invoicesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const invoices = [];
      snapshot.forEach((doc) => {
        invoices.push({
          firestoreId: doc.id,
          ...doc.data(),
        });
      });

      // Update local cache with fresh data
      try {
        await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(invoices));
      } catch (cacheError) {
        console.warn('Failed to update invoice cache:', cacheError);
      }

      return invoices;
    } catch (firestoreError) {
      console.warn('Failed to fetch from Firestore, using cache:', firestoreError);
      
      // FALLBACK: Use local cache if Firestore fails
      return await this._getCachedInvoices();
    }
  }

  /**
   * Subscribe to invoices in Firestore (realtime).
   * @param {(invoices: any[]) => void} onInvoices
   * @param {(error: any) => void} [onError]
   * @returns {() => void} unsubscribe
   */
  static subscribeToInvoices(onInvoices, onError) {
    const invoicesRef = collection(db, 'invoices');
    const q = query(invoicesRef, orderBy('createdAt', 'desc'));

    return onSnapshot(
      q,
      async (snapshot) => {
        const invoices = [];
        snapshot.forEach((d) => {
          invoices.push({
            firestoreId: d.id,
            ...d.data(),
          });
        });

        // Best-effort cache update for offline usage
        try {
          await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(invoices));
        } catch {
          // ignore cache errors
        }

        if (typeof onInvoices === 'function') onInvoices(invoices);
      },
      (error) => {
        if (typeof onError === 'function') onError(error);
      }
    );
  }

  /**
   * Upsert one invoice in local cache for offline-first behavior.
   */
  static async _upsertCachedInvoice(invoice) {
    try {
      const existingInvoices = await this._getCachedInvoices();
      const exists = existingInvoices.some((inv) => this.invoiceIdsMatch(inv.invoiceId, invoice.invoiceId));

      let updatedInvoices;
      if (!exists) {
        updatedInvoices = [...existingInvoices, invoice];
      } else {
        updatedInvoices = existingInvoices.map((inv) =>
          this.invoiceIdsMatch(inv.invoiceId, invoice.invoiceId) ? invoice : inv
        );
      }

      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedInvoices));
    } catch (cacheError) {
      console.warn('Failed to update invoice cache:', cacheError);
    }
  }

  /**
   * Get cached invoices from AsyncStorage (private helper)
   */
  static async _getCachedInvoices() {
    try {
      const invoicesStr = await AsyncStorage.getItem(this.STORAGE_KEY);
      return invoicesStr ? JSON.parse(invoicesStr) : [];
    } catch (error) {
      console.error('Error reading invoice cache:', error);
      return [];
    }
  }

  /**
   * Get invoice by ID from Firestore
   */
  static async getInvoiceById(invoiceId) {
    try {
      // Query Firestore for invoice with matching invoiceId
      const invoicesRef = collection(db, 'invoices');
      const variants = this.getInvoiceIdVariants(invoiceId);
      const q = variants.length > 1
        ? query(invoicesRef, where('invoiceId', 'in', variants), limit(1))
        : query(invoicesRef, where('invoiceId', '==', invoiceId), limit(1));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return {
          firestoreId: doc.id,
          ...doc.data(),
        };
      }

      // Fallback to cache if not found in Firestore
      const cachedInvoices = await this._getCachedInvoices();
      return cachedInvoices.find(invoice => this.invoiceIdsMatch(invoice.invoiceId, invoiceId)) || null;
    } catch (error) {
      console.error('Error getting invoice by ID:', error);
      return null;
    }
  }

  /**
   * Update invoice status in Firestore
   */
  static async updateInvoiceStatus(invoiceId, status, paymentMethod = null) {
    try {
      const isMarkingPaid = String(status || '').trim().toLowerCase() === 'paid';
      const paidDate = status === 'Paid' 
        ? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;

      const updateData = {
        status,
        ...(status === 'Paid' && { paymentStatus: 'paid' }),
        ...(paymentMethod && { paymentMethod }),
        ...(paidDate && { paidDate }),
        updatedAt: new Date().toISOString()
      };

      // PRIMARY: Update in Firestore
      const invoicesRef = collection(db, 'invoices');
      const variants = this.getInvoiceIdVariants(invoiceId);
      const q = variants.length > 1
        ? query(invoicesRef, where('invoiceId', 'in', variants), limit(1))
        : query(invoicesRef, where('invoiceId', '==', invoiceId), limit(1));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const existingInvoiceData = snapshot.docs[0].data() || {};
        const previousStatus = String(existingInvoiceData?.status || '').trim().toLowerCase();
        const docRef = doc(db, 'invoices', snapshot.docs[0].id);
        await setDoc(docRef, updateData, { merge: true });

        // Update local cache
        try {
          const cachedInvoices = await this._getCachedInvoices();
          const updatedInvoices = cachedInvoices.map(inv => 
            this.invoiceIdsMatch(inv.invoiceId, invoiceId) ? { ...inv, ...updateData } : inv
          );
          await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedInvoices));
        } catch (cacheError) {
          console.warn('Failed to update invoice cache:', cacheError);
        }

        // Update corresponding appointment
        await this.updateAppointmentInvoiceStatus(invoiceId, status, paymentMethod);

        if (isMarkingPaid && previousStatus === 'overdue') {
          await this._notifyFinancialAdminsOverduePayment({
            invoiceId,
            invoiceData: {
              ...existingInvoiceData,
              ...updateData,
              invoiceId: existingInvoiceData?.invoiceId || invoiceId,
            },
            paymentMethod,
          });
        }
      } else {
        throw new Error(`Invoice ${invoiceId} not found in Firestore`);
      }
    } catch (error) {
      console.error('Error updating invoice status:', error);
      throw error;
    }
  }

  /**
   * Update the appointmentId/relatedAppointmentId on a deposit invoice after the real
   * appointment Firestore document ID is known.
   */
  static async patchAppointmentId(invoiceId, realAppointmentId) {
    try {
      const invoicesRef = collection(db, 'invoices');
      const q = query(invoicesRef, where('invoiceId', '==', invoiceId), limit(1));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const docRef = doc(db, 'invoices', snapshot.docs[0].id);
        await setDoc(docRef, {
          appointmentId: realAppointmentId,
          relatedAppointmentId: realAppointmentId,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
    } catch (e) {
      console.warn('patchAppointmentId failed:', e);
    }
  }

  /**
   * Update appointment invoice status when invoice status changes
   */
  static async updateAppointmentInvoiceStatus(invoiceId, status, paymentMethod = null) {
    try {
      const variants = this.getInvoiceIdVariants(invoiceId);
      // Get all appointments
      const appointmentKeys = await this.getAppointmentStorageKeys();
      if (appointmentKeys.length === 0) {
        return;
      }

      const entries = await AsyncStorage.multiGet(appointmentKeys);

      for (const [storageKey, value] of entries) {
        if (!value) {
          continue;
        }

        let updated = false;
        let appointments;
        try {
          appointments = JSON.parse(value);
        } catch (error) {
          // Error parsing appointments for key
          continue;
        }

        const updatedAppointments = appointments.map(appointment => {
          const matches = variants.length > 0
            ? variants.some(v => this.invoiceIdsMatch(appointment?.invoiceId, v))
            : this.invoiceIdsMatch(appointment?.invoiceId, invoiceId);

          if (matches) {
            updated = true;
            const updates = {
              ...appointment,
              invoiceStatus: status,
              invoiceUpdatedAt: new Date().toISOString()
            };
            
            // Add payment details if marking as paid
            if (status === 'Paid') {
              updates.paidDate = new Date().toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              });
              if (paymentMethod) {
                updates.paymentMethod = paymentMethod;
              }
            }
            
            return updates;
          }
          return appointment;
        });

        if (updated) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(updatedAppointments));
          break;
        }
      }
    } catch (error) {
      // Error updating appointment invoice status
    }
  }

  /**
   * Share invoice via email/other apps
   */
  static async shareInvoice(invoice) {
    try {
      if (!invoice || typeof invoice !== 'object') throw new Error('Missing invoice');
      if (!(await Sharing.isAvailableAsync())) {
        return;
      }

      const invoiceId = invoice.invoiceId || invoice.invoiceNumber || 'Invoice';

      // Always generate a fresh PDF from the current invoice object so the shared
      // document matches what the UI is previewing (avoids stale/mismatched pdfUri).
      let uriToShare = null;
      try {
        const items = Array.isArray(invoice.items) && invoice.items.length > 0
          ? invoice.items
          : [
              {
                description: invoice.service || 'Service',
                detailedDescription: invoice.service
                  ? `Professional ${String(invoice.service).toLowerCase()} services provided`
                  : 'Professional healthcare services',
                quantity: Number(invoice.hours || 1),
                price: Number(invoice.rate || invoice.total || 0),
                total: Number(invoice.total || 0),
                serviceDates: invoice.serviceDate || invoice.date || '',
                nurseNames: invoice.nurseName || 'Care Professional',
              },
            ];

        const invoiceDataForPdf = {
          ...invoice,
          invoiceId: invoice.invoiceId || invoice.invoiceNumber || invoiceId,
          items,
        };

        invoiceDataForPdf.logoDataUri = await this._getInvoiceLogoDataUri();

        const html = InvoiceImageGenerator.createInvoiceHTML(invoiceDataForPdf);
        const { uri } = await Print.printToFileAsync({
          html,
          base64: false,
          width: 612,
          height: 792,
        });
        uriToShare = uri;
      } catch (pdfError) {
        // Fall back to any stored pdfUri if PDF regeneration fails.
        uriToShare = invoice.pdfUri || null;
      }

      if (!uriToShare) {
        throw new Error('Invoice PDF is not available to share');
      }

      await Sharing.shareAsync(uriToShare, {
        mimeType: 'application/pdf',
        dialogTitle: `Invoice ${invoiceId}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (error) {
      // Error sharing invoice
      throw error;
    }
  }

  /**
   * Delete invoice
   */
  static async deleteInvoice(invoiceId) {
    try {
      const invoices = await this.getAllInvoices();
      const invoice = invoices.find(inv => this.invoiceIdsMatch(inv.invoiceId, invoiceId));
      
      if (invoice) {
        // Delete PDF file if it exists and path is valid
        if (invoice.pdfUri) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(invoice.pdfUri);
            if (fileInfo.exists) {
              await FileSystem.deleteAsync(invoice.pdfUri, { idempotent: true });
            }
          } catch (fileError) {
            console.warn('Error deleting PDF file:', fileError);
            // Continue with record deletion even if file deletion fails
          }
        }
        
        // Remove from records
        const updatedInvoices = invoices.filter(inv => !this.invoiceIdsMatch(inv.invoiceId, invoiceId));
        await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedInvoices));
      }
    } catch (error) {
      console.error('Error deleting invoice:', error);
      throw error;
    }
  }

  /**
   * Remove all sample invoices from storage
   */
  static async removeSampleInvoices() {
    try {
      const invoices = await this.getAllInvoices();
      
      // Track unique appointmentIds to detect duplicates
      const seenAppointmentIds = new Map();
      
      // Filter out sample invoices and duplicates
      const realInvoices = invoices.filter(inv => {
        // Check if it's a sample invoice
        const isSample = 
          inv.appointmentId === 'SAMPLE-001' ||
          inv.appointmentId?.includes('SAMPLE') ||
          inv.invoiceId?.includes('SAMPLE') ||
          inv.clientName === 'John Smith (Sample)' ||
          inv.clientName === 'Sample Client' ||
          (inv.clientName === 'John Smith' && inv.clientEmail === 'john.smith@example.com');
        
        if (isSample) {
          return false;
        }
        
        // Check for duplicate appointmentIds (keep only the first one, which is usually the latest)
        if (seenAppointmentIds.has(inv.appointmentId)) {
          return false;
        }
        
        seenAppointmentIds.set(inv.appointmentId, inv.invoiceId);
        return true;
      });
      
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(realInvoices));
    } catch (error) {
      // Error removing sample invoices
      throw error;
    }
  }

  /**
   * Get invoice statistics
   */
  static async getInvoiceStats() {
    try {
      const invoices = await this.getAllInvoices();
      const total = invoices.length;
      const pending = invoices.filter(inv => inv.status === 'Pending').length;
      const paid = invoices.filter(inv => inv.status === 'Paid').length;
      const overdue = invoices.filter(inv => inv.status === 'Overdue').length;
      const totalAmount = invoices.reduce((sum, inv) => sum + inv.total, 0);
      const paidAmount = invoices.filter(inv => inv.status === 'Paid').reduce((sum, inv) => sum + inv.total, 0);
      const pendingAmount = invoices.filter(inv => inv.status === 'Pending').reduce((sum, inv) => sum + inv.total, 0);

      return {
        total,
        pending,
        paid,
        overdue,
        totalAmount,
        paidAmount,
        pendingAmount
      };
    } catch (error) {
      // Error getting invoice stats
      return {
        total: 0,
        pending: 0,
        paid: 0,
        overdue: 0,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0
      };
    }
  }

  // Legacy methods for backward compatibility
  static generateInvoiceNumber() {
    return this.generateInvoiceId();
  }

  static createInvoiceFromAppointment(appointment, patientInfo = null) {
    return this.createInvoice(appointment);
  }

  static formatPrice(amount) {
    if (!amount && amount !== 0) return 'J$0.00';
    return `J$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  static formatCurrency(amount) {
    if (!amount && amount !== 0) return 'J$0.00';
    return `J$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  static calculateTotals(items) {
    const subtotal = items.reduce((sum, item) => sum + (item.total || item.price * item.quantity), 0);
    const tax = 0;
    const total = subtotal + tax;
    return { subtotal, tax, total };
  }

  static _normalizeInvoiceStatus(invoice) {
    const raw = invoice?.status ?? invoice?.paymentStatus ?? '';
    return String(raw).trim().toLowerCase();
  }

  static _toNumber(value) {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(num) ? num : null;
  }

  static _getInvoiceTotal(invoice) {
    const candidates = [invoice?.finalTotal, invoice?.total, invoice?.subtotal, invoice?.amount, invoice?.totalAmount];
    for (const candidate of candidates) {
      const parsed = this._toNumber(candidate);
      if (parsed !== null) return parsed;
    }
    return 0;
  }

  static _getInvoicePaidAmount(invoice) {
    const paidCandidates = [invoice?.paidAmount, invoice?.amountPaid, invoice?.paid, invoice?.depositPaid];
    let paid = null;
    for (const candidate of paidCandidates) {
      const parsed = this._toNumber(candidate);
      if (parsed !== null) {
        paid = parsed;
        break;
      }
    }

    const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
    const paymentsTotal = payments.reduce((sum, payment) => {
      const amount = this._toNumber(payment?.amount);
      return sum + (amount ?? 0);
    }, 0);

    if (paid === null) return paymentsTotal;
    return Math.max(paid, paymentsTotal);
  }

  static _getInvoiceOutstandingAmount(invoice) {
    const explicitOutstanding = this._toNumber(invoice?.outstandingAmount ?? invoice?.balance ?? invoice?.amountDue);
    if (explicitOutstanding !== null) return explicitOutstanding;
    const total = this._getInvoiceTotal(invoice);
    const paid = this._getInvoicePaidAmount(invoice);
    return Math.max(0, total - (paid ?? 0));
  }

  static _isInvoicePaid(invoice) {
    const status = this._normalizeInvoiceStatus(invoice);
    if (status === 'paid' || status === 'complete' || status === 'completed') return true;
    if (String(invoice?.paymentStatus ?? '').trim().toLowerCase() === 'paid') return true;
    if (invoice?.isPaid === true) return true;
    if (invoice?.paid === true) return true;
    return this._getInvoiceOutstandingAmount(invoice) <= 0;
  }

  static _invoiceMatchesUser(invoice, userId) {
    if (!userId) return true;
    const invoiceClientId = invoice?.clientId ?? invoice?.patientId ?? invoice?.userId ?? null;
    if (!invoiceClientId) return false;
    return String(invoiceClientId) === String(userId);
  }

  // Check for overdue invoices
  static async getOverdueInvoices(options = null) {
    try {
      const opts = options && typeof options === 'object' ? options : {};
      const userId = opts.userId ?? opts.clientId ?? null;
      const allInvoices = await this.getAllInvoices();
      const today = new Date();
      
      const overdueInvoices = allInvoices.filter(invoice => {
        if (userId && !this._invoiceMatchesUser(invoice, userId)) return false;
        if (this._isInvoicePaid(invoice)) return false;

        const outstanding = this._getInvoiceOutstandingAmount(invoice);
        if (!(outstanding > 0)) return false;

        const dueDate = this.parseDateInput(invoice?.dueDate) || new Date(invoice?.dueDate);
        if (!(dueDate instanceof Date) || isNaN(dueDate.getTime())) return false;

        return dueDate < today;
      });

      return overdueInvoices;
    } catch (error) {
      // Error getting overdue invoices
      return [];
    }
  }

  // Send overdue payment notifications
  static async sendOverdueNotifications(options = null) {
    try {
      const opts = options && typeof options === 'object' ? options : {};
      const role = String(opts.role ?? '').trim().toLowerCase();
      const overdueInvoices = Array.isArray(opts.overdueInvoices)
        ? opts.overdueInvoices
        : await this.getOverdueInvoices(opts);
      
      if (overdueInvoices.length === 0) return [];

      const notifications = [];
      
      for (const invoice of overdueInvoices) {
        const total = this._getInvoiceTotal(invoice);
        const outstanding = this._getInvoiceOutstandingAmount(invoice);

        const patientNotification = role === 'patient' || !role
          ? {
              title: 'Payment Overdue',
              body: `Your payment for invoice ${invoice.invoiceId} is overdue. Please settle your account.`,
              data: {
                type: 'overdue_payment',
                invoiceId: invoice.invoiceId,
                amount: outstanding,
              },
            }
          : null;

        const adminNotification = role && role !== 'patient'
          ? {
              title: 'Overdue Payment Alert',
              body: `Invoice ${invoice.invoiceId} for ${invoice.clientName} is overdue ($${total})`,
              data: {
                type: 'overdue_payment_admin',
                invoiceId: invoice.invoiceId,
                clientName: invoice.clientName,
                amount: outstanding,
              },
            }
          : null;

        notifications.push({ patient: patientNotification, admin: adminNotification, invoice });
      }

      return notifications;
    } catch (error) {
      // Error sending overdue notifications
      return [];
    }
  }

  // Clear all invoices (for testing/reset purposes)
  static async clearAllInvoices() {
    try {
      await AsyncStorage.removeItem(this.STORAGE_KEY);
      await AsyncStorage.removeItem(this.INVOICE_COUNTER_KEY);
      
      // Also delete all invoice PDF files
      const invoiceDir = `${FileSystem.documentDirectory}invoices/`;
      try {
        const dirInfo = await FileSystem.getInfoAsync(invoiceDir);
        if (dirInfo.exists) {
          await FileSystem.deleteAsync(invoiceDir, { idempotent: true });
        }
      } catch (fileError) {
        // No invoice directory to clear
      }
      
      return { success: true, message: 'All invoices cleared' };
    } catch (error) {
      // Error clearing invoices
      throw error;
    }
  }

  /**
   * Update existing invoices to use new pricing structure
   * This will recalculate all invoice totals based on the current SERVICE_RATES
   */
  static async updateInvoicePricing() {
    try {
      const invoices = await this.getAllInvoices();
      
      if (invoices.length === 0) {
        return { success: true, updated: 0, total: 0 };
      }
      
      let updatedCount = 0;
      
      const updatedInvoices = invoices.map(invoice => {
        const service = invoice.service;
        const hours = invoice.hours || 1;
        const oldRate = invoice.rate;
        const oldTotal = invoice.total;
        
        // Get new rate based on current pricing
        const newRate = this.getServicePrice(service);
        const newTotal = newRate * hours;
        
        // Only update if prices have changed
        if (oldRate !== newRate || oldTotal !== newTotal) {
          updatedCount++;
          
          return {
            ...invoice,
            rate: newRate,
            total: newTotal,
            subtotal: newTotal,
            finalTotal: newTotal,
            // Update items array if it exists
            items: invoice.items ? invoice.items.map(item => ({
              ...item,
              price: newRate,
              total: newTotal
            })) : [{
              description: service,
              detailedDescription: `Professional ${service.toLowerCase()} services provided`,
              quantity: hours,
              price: newRate,
              total: newTotal,
              serviceDates: invoice.serviceDate || invoice.date,
              nurseNames: invoice.nurseName || 'Care Professional'
            }]
          };
        }
        
        return invoice;
      });
      
      // Save updated invoices
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedInvoices));
      
      return { 
        success: true, 
        updated: updatedCount, 
        total: invoices.length,
        message: `Updated ${updatedCount} of ${invoices.length} invoices`
      };
      
    } catch (error) {
      // Error updating invoice pricing
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

export default InvoiceService;