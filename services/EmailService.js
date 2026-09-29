import AsyncStorage from '@react-native-async-storage/async-storage';
import FirebaseEmailQueueService from './FirebaseEmailQueueService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../config/firebase';

/**
 * Email Service for sending emails via Gmail API or SMTP
 * This service handles all email communications for the app including:
 * - Invoice emails
 * - Payment confirmations
 * - Appointment reminders
 * - System notifications
 */
class EmailService {
  static GMAIL_CONFIG_KEY = '@876_gmail_config';
  
  // Default email configuration
  static defaultConfig = {
    // provider:
    // - 'firebase' (recommended): enqueue emails into Firestore `/mail` for Cloud Functions to send
    // - 'backend': call a separate backend server (Express) via HTTP
    provider: 'firebase',
    fromEmail: '876nurses@gmail.com',
    fromName: '876 Nurses Home Care Services',
    replyTo: '876nurses@gmail.com',
    backendUrl: 'http://localhost:3000', // Update this for production
    apiKey: '', // Set via config UI / AsyncStorage; never hard-code secrets in repo
    enabled: false
  };

  /**
   * Save Gmail configuration
   * @param {Object} config - Gmail configuration
   */
  static async saveConfig(config) {
    try {
      await AsyncStorage.setItem(this.GMAIL_CONFIG_KEY, JSON.stringify(config));
      return { success: true };
    } catch (error) {
      console.error('Error saving email config:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get Gmail configuration
   */
  static async getConfig() {
    try {
      const stored = await AsyncStorage.getItem(this.GMAIL_CONFIG_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
      return this.defaultConfig;
    } catch (error) {
      console.error('Error loading email config:', error);
      return this.defaultConfig;
    }
  }

  static async isNotificationEmailAllowed(meta = {}) {
    const userId = meta.notificationUserId;
    const category = meta.notificationCategory;
    if (!userId || !category) return true;

    const checkPreference = httpsCallable(
      getFunctions(app, 'us-central1'),
      'canSendEmailNotification'
    );
    const response = await checkPreference({ userId: String(userId), category });
    return response?.data?.allowed === true;
  }

  /**
   * Send email via backend API
   * @param {Object} emailData - Email data
   */
  static async send(emailData) {
    try {
      const config = await this.getConfig();

      const provider = config.provider || 'backend';
      
      if (!config.enabled) {
        console.log('Email service is disabled');
        return { success: false, error: 'Email service is not enabled' };
      }

      const { to, subject, html, text, attachments = [], meta } = emailData || {};

      if (meta?.notificationUserId && meta?.notificationCategory) {
        const allowed = await this.isNotificationEmailAllowed(meta);
        if (!allowed) {
          return { success: true, skipped: true, reason: 'Recipient email notifications are disabled.' };
        }
      }

      if (!to || !subject || (!html && !text)) {
        return { success: false, error: 'Missing required email fields' };
      }

      // Provider A: Firebase mail-queue (Firestore -> Cloud Function)
      if (provider === 'firebase') {
        const result = await FirebaseEmailQueueService.enqueueEmail({
          to,
          subject,
          html,
          text,
          attachments,
          meta: meta && typeof meta === 'object' ? meta : {},
        });

        return {
          success: true,
          provider: 'firebase',
          queued: true,
          id: result?.id || null,
        };
      }

      // Prepare email payload for backend
      const payload = {
        from: {
          email: config.fromEmail || this.defaultConfig.fromEmail,
          name: config.fromName || this.defaultConfig.fromName
        },
        to: Array.isArray(to) ? to : [to],
        replyTo: config.replyTo || this.defaultConfig.replyTo,
        subject,
        html: html || text,
        text: text || html,
        attachments,
        meta: meta && typeof meta === 'object' ? meta : undefined
      };

      // Get backend URL from config or use default
      const backendUrl = config.backendUrl || 'http://localhost:3000';
      const apiKey = config.apiKey;

      if (!apiKey) {
        return {
          success: false,
          error: 'Missing email API key. Configure Email Service before sending.'
        };
      }

      console.log('📧 Sending email via backend:', {
        to: payload.to,
        subject: payload.subject,
        from: payload.from.email
      });

      // Call backend API
      const response = await fetch(`${backendUrl}/api/email/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to send email');
      }

      return result;
    } catch (error) {
      console.error('Error sending email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send invoice email
   */
  static async sendInvoiceEmail({ to, invoiceData, pdfUri }) {
    try {
      const config = await this.getConfig();
      const provider = config.provider || 'backend';

      if (!config.enabled) {
        console.log('Email service is disabled');
        return { success: false, error: 'Email service is not enabled' };
      }

      if (provider === 'firebase') {
        const queued = await FirebaseEmailQueueService.enqueueInvoiceEmail({
          to,
          invoiceData,
          pdfUri,
        });

        return {
          success: true,
          provider: 'firebase',
          queued: true,
          id: queued?.id || null,
        };
      }

      const subject = `Invoice ${invoiceData.invoiceNumber} - 876 Nurses Home Care Services`;
      const invoiceIdForLink =
        invoiceData?.invoiceId ||
        invoiceData?.id ||
        invoiceData?.firestoreId ||
        invoiceData?.invoiceNumber ||
        '';
      const appInvoiceUrl =
        invoiceData?.appInvoiceUrl ||
        invoiceData?.deepLink ||
        `nurses876://invoice/${encodeURIComponent(String(invoiceIdForLink))}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44; margin:0; padding:0; background:#ffffff; }
            .container { max-width: 600px; margin: 0 auto; padding: 32px 20px; }
            .invoice-details { background: #f8faff; padding: 16px; border: 1px solid rgba(47,98,215,0.2); border-radius: 12px; margin: 16px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
            .detail-row:last-child { border-bottom: none; }
            .amount { color: #2f62d7; font-weight: 800; }
            .footer { text-align: center; padding: 18px 10px 0 10px; color: #9ca3af; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;">Hi ${invoiceData.clientName || 'Client'},</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;">Your invoice <strong>${invoiceData.invoiceNumber}</strong> from 876 Nurses Home Care Services is ready.</p>
              
              <div class="invoice-details">
                <div class="detail-row">
                  <span>Invoice Number:</span>
                  <strong>${invoiceData.invoiceNumber}</strong>
                </div>
                <div class="detail-row">
                  <span>Date:</span>
                  <strong>${invoiceData.date}</strong>
                </div>
                <div class="detail-row">
                  <span>Service:</span>
                  <strong>${invoiceData.service || invoiceData.services?.join(', ') || 'Professional Care'}</strong>
                </div>
                <div class="detail-row">
                  <span>Amount:</span>
                  <span class="amount">JMD $${(invoiceData.amount || invoiceData.total || 0).toFixed(2)}</span>
                </div>
                ${invoiceData.paymentStatus === 'partial' ? `
                  <div class="detail-row">
                    <span>Paid Amount:</span>
                    <strong style="color: #10B981;">JMD $${(invoiceData.paidAmount || 0).toFixed(2)}</strong>
                  </div>
                  <div class="detail-row">
                    <span>Outstanding:</span>
                    <strong style="color: #F59E0B;">JMD $${(invoiceData.outstandingAmount || 0).toFixed(2)}</strong>
                  </div>
                ` : ''}
              </div>

              ${invoiceData.paymentStatus === 'paid' ? `
                <p style="text-align: center; color: #10B981; font-weight: bold;">✓ PAID</p>
              ` : ''}

              <p style="margin:16px 0 0 0;font-size:15px;line-height:1.7;">
                <a href="${appInvoiceUrl}" style="color:#2f62d7;text-decoration:underline;font-weight:700;">Click here to view invoice</a>
              </p>

              <div class="footer">
                876 Nurses Home Care Services · Kingston, Jamaica<br />
                Need help? Email <a href="mailto:876nurses@gmail.com" style="color:#6b7280;text-decoration:underline;">876nurses@gmail.com</a>
              </div>
          </div>
        </body>
        </html>
      `;

      return await this.send({
        to,
        subject,
        html,
        text: `Invoice ${invoiceData.invoiceNumber} from 876 Nurses Home Care Services\n\nHi ${invoiceData.clientName || 'Client'},\n\nService: ${invoiceData.service || invoiceData.services?.join(', ') || 'Professional Care'}\nAmount: JMD $${(invoiceData.amount || invoiceData.total || 0).toFixed(2)}\n\nClick here to view invoice: ${appInvoiceUrl}\n\nNeed help? Email 876nurses@gmail.com`,
        attachments: []
      });
    } catch (error) {
      console.error('Error sending invoice email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send payment confirmation email
   */
  static async sendPaymentConfirmation({ to, paymentData, invoiceData }) {
    try {
      const subject = `Payment Confirmation - Invoice ${invoiceData.invoiceNumber}`;
      const invoiceIdForLink =
        invoiceData?.invoiceId ||
        invoiceData?.id ||
        invoiceData?.firestoreId ||
        invoiceData?.invoiceNumber ||
        '';
      const appInvoiceUrl =
        invoiceData?.appInvoiceUrl ||
        invoiceData?.deepLink ||
        `nurses876://invoice/${encodeURIComponent(String(invoiceIdForLink))}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44; margin:0; padding:0; background:#ffffff; }
            .container { max-width: 600px; margin: 0 auto; padding: 32px 20px; }
            .footer { text-align: center; padding: 18px 10px 0 10px; color: #9ca3af; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
              <p style="margin:0 0 10px 0;font-size:22px;font-weight:700;line-height:1.4;">Payment Successful!</p>
              <p style="margin:0 0 12px 0;font-size:15px;line-height:1.7;">We have received your payment of JMD $${(paymentData.amount || 0).toFixed(2)} for Invoice ${invoiceData.invoiceNumber}.</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;">Thank you for choosing 876 Nurses Home Care Services.</p>

              <p style="margin:0 0 16px 0;"><a href="${appInvoiceUrl}" style="color:#2f62d7;text-decoration:underline;font-weight:700;">Click here to view invoice</a></p>

              <div class="footer">
                876 Nurses Home Care Services · Kingston, Jamaica<br />
                Need help? Email <a href="mailto:876nurses@gmail.com" style="color:#6b7280;text-decoration:underline;">876nurses@gmail.com</a>
              </div>
          </div>
        </body>
        </html>
      `;

      return await this.send({
        to,
        subject,
        html,
        text: `Payment Successful!\n\nWe have received your payment of JMD $${(paymentData.amount || 0).toFixed(2)} for Invoice ${invoiceData.invoiceNumber}.\nThank you for choosing 876 Nurses Home Care Services.\n\nClick here to view invoice: ${appInvoiceUrl}\n\nNeed help? Email 876nurses@gmail.com`
      });
    } catch (error) {
      console.error('Error sending payment confirmation:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send appointment reminder email
   */
  static async sendAppointmentReminder({ to, appointmentData }) {
    try {
      const subject = `Appointment Reminder - ${appointmentData.date} at ${appointmentData.time}`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44; margin:0; padding:0; background:#ffffff; }
            .container { max-width: 600px; margin: 0 auto; padding: 32px 20px; }
            .footer { text-align: center; padding: 18px 10px 0 10px; color: #9ca3af; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;">Hi ${appointmentData.patientName || 'Client'},</p>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;">This is a reminder for your upcoming appointment with 876 Nurses Home Care Services.</p>

              <p style="margin:0 0 8px 0;"><strong>Date:</strong> ${appointmentData.date}</p>
              <p style="margin:0 0 8px 0;"><strong>Time:</strong> ${appointmentData.time}</p>
              <p style="margin:0 0 8px 0;"><strong>Service:</strong> ${appointmentData.service}</p>
              <p style="margin:0 0 8px 0;"><strong>Location:</strong> ${appointmentData.address}</p>
              ${appointmentData.notes ? `<p style="margin:0 0 8px 0;"><strong>Notes:</strong> ${appointmentData.notes}</p>` : ''}

              <p style="margin:16px 0 0 0;font-size:15px;line-height:1.7;">If you need to reschedule, please contact us as soon as possible.</p>

              <div class="footer">
                876 Nurses Home Care Services · Kingston, Jamaica<br />
                Need help? Email <a href="mailto:876nurses@gmail.com" style="color:#6b7280;text-decoration:underline;">876nurses@gmail.com</a>
              </div>
          </div>
        </body>
        </html>
      `;

      return await this.send({
        to,
        subject,
        html,
        text: `Appointment Reminder\n\nPatient: ${appointmentData.patientName || 'Client'}\nDate: ${appointmentData.date}\nTime: ${appointmentData.time}\nService: ${appointmentData.service}\nLocation: ${appointmentData.address}\n\nNeed help? Email 876nurses@gmail.com`,
        meta: {
          type: 'appointment_reminder',
          notificationUserId: appointmentData.userId || appointmentData.patientId || appointmentData.clientId || appointmentData.createdByUid,
          notificationCategory: 'appointments',
        }
      });
    } catch (error) {
      console.error('Error sending appointment reminder:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test email configuration
   */
  static async testConfiguration(testEmail) {
    try {
      const config = await this.getConfig();
      
      return await this.send({
        to: testEmail || config.fromEmail,
        subject: 'Test Email - 876 Nurses Email Service',
        html: `
          <h2>Email Service Test</h2>
          <p>This is a test email from 876 Nurses Home Care Services.</p>
          <p>If you received this email, your email service is configured correctly!</p>
          <p><strong>Configuration:</strong></p>
          <ul>
            <li>From: ${config.fromEmail}</li>
            <li>Name: ${config.fromName}</li>
            <li>Status: ${config.enabled ? 'Enabled' : 'Disabled'}</li>
          </ul>
          <p>Timestamp: ${new Date().toISOString()}</p>
        `
      });
    } catch (error) {
      console.error('Error testing email configuration:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send password reset email
   */
  static async sendPasswordReset({ to, resetLink, userName }) {
    try {
      const subject = 'Password Reset Request - 876 Nurses';
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44; margin:0; padding:0; background:#ffffff; }
            .container { max-width: 600px; margin: 0 auto; padding: 32px 20px; }
            .footer { text-align: center; padding: 18px 10px 0 10px; color: #9ca3af; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <p style="margin:0 0 12px 0;">Hello${userName ? ' ' + userName : ''},</p>
            <p style="margin:0 0 12px 0;">We received a request to reset your password for your 876 Nurses account.</p>
            <p style="margin:0 0 12px 0;"><a href="${resetLink}" style="color:#2f62d7;text-decoration:underline;font-weight:700;">Click here to reset your password</a></p>
            <p style="margin:0 0 12px 0;">This link will expire in 1 hour for security reasons.</p>
            <p style="margin:0 0 12px 0;">If you didn't request this reset, please ignore this email.</p>

            <div class="footer">
              876 Nurses Home Care Services · Kingston, Jamaica<br />
              Need help? Email <a href="mailto:876nurses@gmail.com" style="color:#6b7280;text-decoration:underline;">876nurses@gmail.com</a>
            </div>
          </div>
        </body>
        </html>
      `;

      return await this.send({
        to,
        subject,
        html,
        text: `Password Reset Request\n\nHello${userName ? ' ' + userName : ''},\n\nReset your password: ${resetLink}\nThis link expires in 1 hour.\n\nNeed help? Email 876nurses@gmail.com`
      });
    } catch (error) {
      console.error('Error sending password reset email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send password changed confirmation email
   */
  static async sendPasswordChanged({ to, userName }) {
    try {
      const subject = 'Password Changed Successfully - 876 Nurses';
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a44; margin:0; padding:0; background:#ffffff; }
            .container { max-width: 600px; margin: 0 auto; padding: 32px 20px; }
            .footer { text-align: center; padding: 18px 10px 0 10px; color: #9ca3af; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <p style="margin:0 0 12px 0;">Hello${userName ? ' ' + userName : ''},</p>
            <p style="margin:0 0 12px 0;">Your password has been changed successfully.</p>
            <p style="margin:0 0 12px 0;"><strong>Changed:</strong> ${new Date().toLocaleString()}</p>
            <p style="margin:0 0 12px 0;"><strong>Account:</strong> ${to}</p>
            <p style="margin:0 0 12px 0;">If you did not make this change, contact us immediately.</p>

            <div class="footer">
              876 Nurses Home Care Services · Kingston, Jamaica<br />
              Need help? Email <a href="mailto:876nurses@gmail.com" style="color:#6b7280;text-decoration:underline;">876nurses@gmail.com</a>
            </div>
          </div>
        </body>
        </html>
      `;

      return await this.send({
        to,
        subject,
        html,
        text: `Password Changed Successfully\n\nHello${userName ? ' ' + userName : ''},\n\nYour password has been changed for account ${to}.\nIf you did not make this change, contact us immediately at 876nurses@gmail.com.`
      });
    } catch (error) {
      console.error('Error sending password changed email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send welcome email
   */
  static async sendWelcomeEmail({ email, name }) {
    try {
      // Note: In Firebase mode, a welcome email is already sent automatically
      // via the `sendWelcomeEmailOnAuthCreate` Cloud Function when a new Auth user is created.
      // This method can still be used for manual/administrative welcome emails.
      const firstName = (name || '').trim().split(' ')[0] || 'there';
      const subject = 'Welcome to 876 Nurses';
      const html = `
        <h2>Welcome to 876 Nurses</h2>
        <p>Hi ${firstName},</p>
        <p>Welcome to 876 Nurses Home Care Services.</p>
        <p>Regards,<br/>876 Nurses</p>
      `;

      return await this.send({
        to: email,
        subject,
        html,
        meta: { type: 'welcome' }
      });
    } catch (error) {
      console.error('Error sending welcome email:', error);
      return { success: false, error: error.message };
    }
  }
}

export default EmailService;
