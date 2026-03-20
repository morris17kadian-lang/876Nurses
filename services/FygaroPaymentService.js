import ApiService from './ApiService';
import { getBackendBaseUrl } from './backendUtils';
import { Platform } from 'react-native';

/**
 * Fygaro Payment Service
 * Handles payment processing through Fygaro payment gateway
 * Documentation: https://www.fygaro.com
 */
class FygaroPaymentService {
  // Global kill-switch for Fygaro payments.
  // Set to true only when Fygaro backend + redirects are confirmed working.
  static PAYMENTS_ENABLED = true;

  static disabledResult() {
    return {
      success: false,
      error: 'Online payment processing is temporarily disabled. Please contact support for alternative payment arrangements.',
    };
  }

  static getBackendPaymentUrl(path = '') {
    // If an explicit API base URL is configured (local dev or custom host), use it.
    // Otherwise route payment calls directly to the deployed Cloud Function.
    const envUrl = (typeof process !== 'undefined' && process.env)
      ? (process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL)
      : undefined;
    const base = envUrl
      ? envUrl.replace(/\/$/, '')
      : 'https://us-central1-nurses-afb7e.cloudfunctions.net/payments';
    const normalizedPath = path ? `/${path.replace(/^\//, '')}` : '';
    // When using the Cloud Function URL the path segment is appended directly;
    // when using a local backend the /api/payments prefix is needed.
    if (envUrl) {
      return `${base}/api/payments${normalizedPath}`;
    }
    return `${base}${normalizedPath}`;
  }

  /**
   * Initialize a payment session
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} - Payment session details
   */
  static async initializePayment(paymentData) {
    try {
      if (!FygaroPaymentService.PAYMENTS_ENABLED) {
        return FygaroPaymentService.disabledResult();
      }

      const {
        amount,
        currency = 'JMD',
        invoiceId,
        invoiceFirestoreId,
        appointmentId,
        customerId,
        customerName,
        customerEmail,
        customerPhone,
        description,
        returnUrl,
        cancelUrl,
        metadata: additionalMetadata,
      } = paymentData;

      // Validate required fields
      if (!amount || !customerEmail) {
        return {
          success: false,
          error: 'Missing required payment information'
        };
      }

      const defaultReturnUrl = 'https://876nurses.app/payment-success';
      const defaultCancelUrl = 'https://876nurses.app/payment-cancel';

      // Create payment payload
      const payload = {
        amount: parseFloat(amount).toFixed(2),
        currency,
        invoiceId,
        invoiceFirestoreId,
        appointmentId,
        customerId,
        customerName,
        customerEmail,
        customerPhone,
        description: description || `Payment for 876 Nurses services`,
        returnUrl: returnUrl || defaultReturnUrl,
        cancelUrl: cancelUrl || defaultCancelUrl,
        metadata: {
          platform: Platform.OS,
          ...additionalMetadata,
        },
      };

      const initUrl = this.getBackendPaymentUrl('initialize');

      // Call backend to initialize Fygaro payment
      const response = await fetch(initUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      const paymentUrl = result.paymentUrl || result.payment_url || result.checkout_url;
      const sessionId = result.sessionId || result.session_id || result.id;
      const transactionId = result.transactionId || result.transaction_id;

      if (result.success || paymentUrl) {
        return {
          success: true,
          paymentUrl,
          sessionId,
          transactionId,
          expiresAt: result.expiresAt || result.expires_at,
        };
      } else {
        return {
          success: false,
          error: result.error || result.message || 'Failed to initialize payment'
        };
      }
    } catch (error) {
      try {
        console.error('Fygaro Payment Initialization Error:', {
          message: error?.message,
          name: error?.name,
          backendBaseUrl: getBackendBaseUrl(),
          initializeUrl: this.getBackendPaymentUrl('initialize'),
        });
      } catch (e) {
        console.error('Fygaro Payment Initialization Error:', error);
      }
      return {
        success: false,
        error: error.message || 'Failed to initialize payment'
      };
    }
  }

  /**
   * Verify payment status
   * @param {string} transactionId - Transaction ID to verify
   * @returns {Promise<Object>} - Payment verification result
   */
  static async verifyPayment(transactionId) {
    try {
      if (!FygaroPaymentService.PAYMENTS_ENABLED) {
        return FygaroPaymentService.disabledResult();
      }

      if (!transactionId) {
        return {
          success: false,
          error: 'Transaction ID is required'
        };
      }

      const verifyUrl = this.getBackendPaymentUrl(`verify/${transactionId}`);

      // Verify payment through backend
      const response = await fetch(
        verifyUrl,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();

      const status = String(result.status || '').toLowerCase();
      if (result.success || status === 'completed' || status === 'paid' || status === 'success') {
        return {
          success: true,
          status: result.status,
          transactionId: result.transactionId || result.transaction_id || transactionId,
          amount: result.amount,
          currency: result.currency,
          paidAt: result.paidAt || result.paid_at,
          metadata: result.metadata,
        };
      } else {
        return {
          success: false,
          status: result.status,
          error: result.error || result.message || 'Payment verification failed'
        };
      }
    } catch (error) {
      console.error('Fygaro Payment Verification Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to verify payment'
      };
    }
  }

  /**
   * Process payment for unlocking nurse notes
   * @param {Object} paymentData - Payment data for nurse notes
   * @returns {Promise<Object>} - Payment result
   */
  static async processNurseNotesPayment(paymentData) {
    try {
      const {
        appointmentId,
        patientId,
        patientName,
        patientEmail,
        patientPhone,
        amount = 500, // JMD $500 for nurse notes
      } = paymentData;

      // Initialize payment
      const initResult = await this.initializePayment({
        amount,
        currency: 'JMD',
        appointmentId,
        customerId: patientId,
        customerName: patientName,
        customerEmail: patientEmail,
        customerPhone: patientPhone,
        description: `Unlock nurse notes for appointment ${appointmentId}`,
      });

      if (!initResult.success) {
        return initResult;
      }

      // Return payment URL for user to complete payment
      return {
        success: true,
        paymentUrl: initResult.paymentUrl,
        sessionId: initResult.sessionId,
        transactionId: initResult.transactionId,
      };
    } catch (error) {
      console.error('Nurse Notes Payment Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to process payment'
      };
    }
  }

  /**
   * Process payment for an invoice
   * @param {Object} invoiceData - Invoice data
   * @returns {Promise<Object>} - Payment result
   */
  static async processInvoicePayment(invoiceData) {
    try {
      const {
        invoiceId,
        invoiceFirestoreId,
        amount,
        customerId,
        customerName,
        customerEmail,
        customerPhone,
        description,
      } = invoiceData;

      // Initialize payment
      const initResult = await this.initializePayment({
        amount,
        currency: 'JMD',
        invoiceId,
        invoiceFirestoreId,
        customerId,
        customerName,
        customerEmail,
        customerPhone,
        description: description || `Payment for invoice ${invoiceId}`,
      });

      if (!initResult.success) {
        return initResult;
      }

      // Record payment attempt in Firebase
      try {
        await ApiService.createNotification({
          userId: customerId,
          title: 'Payment Initiated',
          message: `Payment of JMD $${amount} for invoice ${invoiceId} has been initiated.`,
          type: 'payment',
          data: {
            invoiceId,
            sessionId: initResult.sessionId,
            transactionId: initResult.transactionId,
          }
        });
      } catch (notifError) {
        console.warn('Failed to create payment notification:', notifError);
      }

      return {
        success: true,
        paymentUrl: initResult.paymentUrl,
        sessionId: initResult.sessionId,
        transactionId: initResult.transactionId,
      };
    } catch (error) {
      console.error('Invoice Payment Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to process payment'
      };
    }
  }

  /**
   * Sync a completed transaction to Firestore via backend.
   * This stamps the invoice as Paid server-side (no client write).
   */
  static async syncCompletedPayment({ transactionId, customReference, invoiceId, invoiceFirestoreId, appointmentId, amount, currency } = {}) {
    try {
      if (!transactionId) {
        return { success: false, error: 'Transaction ID is required' };
      }

      const syncUrl = this.getBackendPaymentUrl('sync');
      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionId,
          customReference,
          invoiceId,
          invoiceFirestoreId,
          appointmentId,
          amount,
          currency,
        }),
      });

      const result = await response.json();
      if (result?.success) {
        return { success: true, status: result.status, transactionId: result.transactionId, applied: result.applied };
      }

      return { success: false, status: result?.status, error: result?.error || 'Failed to sync payment' };
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to sync payment' };
    }
  }

  /**
   * Handle payment webhook from Fygaro
   * This should be implemented on your backend
   * @param {Object} webhookData - Webhook payload from Fygaro
   * @returns {Promise<Object>} - Webhook processing result
   */
  static async handleWebhook(webhookData) {
    try {
      const { event, transaction_id, status, metadata } = webhookData;

      console.log('Fygaro Webhook Received:', { event, transaction_id, status });

      // Verify webhook signature (implement this on backend)
      // const isValid = await this.verifyWebhookSignature(webhookData);
      // if (!isValid) {
      //   return { success: false, error: 'Invalid webhook signature' };
      // }

      // Handle different payment events
      switch (event) {
        case 'payment.completed':
          // Update invoice/appointment status
          if (metadata.invoiceId) {
            await ApiService.updateInvoiceStatus(metadata.invoiceId, 'paid');
          }
          if (metadata.appointmentId) {
            // Unlock nurse notes or update appointment
            await ApiService.unlockNurseNotes(metadata.appointmentId);
          }
          
          // Notify admin about successful payment
          try {
            const paymentType = metadata.invoiceId ? 'invoice' : 'nurse notes';
            await ApiService.createNotification({
              userId: 'ADMIN001',
              title: 'Payment Received',
              message: `${metadata.customerName || 'A patient'} completed payment for ${paymentType} (Transaction: ${transaction_id})`,
              type: 'payment_success',
              data: {
                transactionId: transaction_id,
                status,
                metadata,
              }
            });
          } catch (notifError) {
            console.warn('Failed to send admin notification:', notifError);
          }
          break;

        case 'payment.failed':
          // Handle failed payment
          console.error('Payment failed:', transaction_id);
          break;

        case 'payment.cancelled':
          // Handle cancelled payment
          console.log('Payment cancelled:', transaction_id);
          break;

        default:
          console.log('Unknown webhook event:', event);
      }

      return { success: true };
    } catch (error) {
      console.error('Webhook Handler Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to process webhook'
      };
    }
  }

  /**
   * Get payment history for a user
   * @param {string} userId - User ID
   * @param {number} limit - Number of records to fetch
   * @returns {Promise<Object>} - Payment history
   */
  static async getPaymentHistory(userId, limit = 20) {
    try {
      // This should query your Firebase transactions collection
      // For now, returning a placeholder
      console.log('Getting payment history for user:', userId);
      
      return {
        success: true,
        payments: [],
        message: 'Payment history retrieval - implement with Firebase'
      };
    } catch (error) {
      console.error('Get Payment History Error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get payment history'
      };
    }
  }
}

export default FygaroPaymentService;
