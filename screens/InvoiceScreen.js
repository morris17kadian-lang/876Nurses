import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  StatusBar,
  Alert,
  ActivityIndicator,
  Image,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as Clipboard from 'expo-clipboard';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import InvoiceService from '../services/InvoiceService';
import FygaroPaymentService from '../services/FygaroPaymentService';
import ApiService from '../services/ApiService';
import EmailService from '../services/EmailService';
import { useAuth } from '../context/AuthContext';
import SharedSettingsService from '../services/SharedSettingsService';

const InvoiceDisplayScreen = ({ route, navigation }) => {
  const insets = useSafeAreaInsets();
  const invoiceViewRef = useRef();
  const { user } = useAuth();
  const { 
    invoiceData: initialInvoiceData, 
    clientName,
    clientPhone, 
    returnToClientDetails,
    returnToClientModal, 
    clientId, 
    invoiceId,
    returnToAppointmentModal,
    appointmentId,
    paymentSuccess
  } = route.params;
  const [invoiceData, setInvoiceData] = useState(initialInvoiceData);
  const [loading, setLoading] = useState(!initialInvoiceData && !!invoiceId);
  const [isSharing, setIsSharing] = useState(false);
  const [orderDetails, setOrderDetails] = useState(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentLink, setPaymentLink] = useState(null);
  const [paymentSession, setPaymentSession] = useState(null);
  
  // Determine if this is a store purchase invoice
  const isStoreInvoice = invoiceData?.service === 'Store Purchase';

  const periodStartRaw = invoiceData?.periodStart || invoiceData?.billingPeriodStart || invoiceData?.recurringPeriodStart;
  const periodEndRaw = invoiceData?.periodEnd || invoiceData?.billingPeriodEnd || invoiceData?.recurringPeriodEnd;

  const periodStartDate = InvoiceService.parseDateInput(periodStartRaw);
  const periodEndDate = InvoiceService.parseDateInput(periodEndRaw);

  const formatInvoiceMoney = (value) => {
    const numeric = typeof value === 'string' ? Number(value.replace(/[^0-9.\-]/g, '')) : Number(value);
    const safe = Number.isFinite(numeric) ? numeric : 0;
    return InvoiceService.formatCurrency(safe, invoiceData?.currencyCode || invoiceData?.currency || 'JMD');
  };

  // Payment summary helpers
  const totalAmount = invoiceData?.amount ?? invoiceData?.total ?? 0;
  const paidAmount = invoiceData?.paidAmount ?? 0;
  const calculatedOutstanding = Math.max(totalAmount - paidAmount, 0);
  const outstandingAmount =
    typeof invoiceData?.outstandingAmount === 'number'
      ? Math.max(invoiceData.outstandingAmount, 0)
      : calculatedOutstanding;
  const isFullyPaid = invoiceData?.paymentStatus === 'paid' || outstandingAmount <= 0;
  const payNowDisabled = processingPayment || isFullyPaid;
  const payNowAmount = outstandingAmount > 0 ? outstandingAmount : totalAmount;
  const payNowType = invoiceData?.paymentStatus === 'partial' && outstandingAmount > 0 ? 'balance' : 'full';
  const paySectionTitle = isFullyPaid
    ? 'Invoice Paid'
    : invoiceData?.paymentStatus === 'partial'
      ? 'Outstanding Balance'
      : 'Total Amount Due';
  const paySectionNote = isFullyPaid
    ? 'Payment received. No further action required.'
    : invoiceData?.paymentStatus === 'partial'
      ? 'Complete your payment to finalize this invoice'
      : 'Complete your payment securely through Fygaro';
  const payAlertTitle = invoiceData?.paymentStatus === 'partial' && !isFullyPaid ? 'Pay Balance' : 'Pay Invoice';
  const baseAlertMessage = invoiceData?.paymentStatus === 'partial' && !isFullyPaid
    ? `Pay the remaining balance of ${formatInvoiceMoney(payNowAmount)}?`
    : `Pay ${formatInvoiceMoney(payNowAmount)}?`;
  const payAlertMessage = `${baseAlertMessage}\n\n${paySectionNote}`;
  const payButtonColors = payNowDisabled ? ['#E5E7EB', '#D1D5DB'] : ['#10B981', '#059669'];

  useEffect(() => {
    if (!paymentSession?.paymentUrl) return;
    const sameType = paymentSession.type === payNowType;
    const sameAmount = Math.abs(Number(paymentSession.amount) - Number(payNowAmount)) < 0.01;
    if (!sameType || !sameAmount) {
      setPaymentSession(null);
      setPaymentLink(null);
    }
  }, [payNowAmount, payNowType, paymentSession?.paymentUrl]);

  const openPaymentWebview = (session) => {
    if (!session?.paymentUrl) return;

    navigation.navigate('PaymentWebview', {
      paymentUrl: session.paymentUrl,
      sessionId: session.sessionId,
      transactionId: session.transactionId,
      amount: session.amount,
      invoiceId: invoiceData.invoiceId || invoiceId,
      invoiceFirestoreId: invoiceData?.firestoreId || invoiceData?.id || null,
      appointmentId: appointmentId,
      type: session.type,
      returnScreen: 'InvoiceDisplay',
      returnParams: {
        invoiceId: invoiceData.invoiceId || invoiceId,
        clientName: clientName,
        returnToClientDetails: returnToClientDetails,
        clientId: clientId,
        returnToAppointmentModal: returnToAppointmentModal,
        appointmentId: appointmentId,
      },
      onSuccess: async (transactionData) => {
        await handlePaymentComplete(transactionData, session.amount, session.type);
      },
      // Back-compat if any callers still use the old name
      onPaymentSuccess: async (transactionData) => {
        await handlePaymentComplete(transactionData, session.amount, session.type);
      },
    });
  };

  // Format date to a cleaner format (e.g., "Nov 4, 2025")
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      // Handle various date formats
      // If it's already in "MMM DD, YYYY" format, return as is
      if (typeof dateString === 'string' && /^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/.test(dateString)) {
        return dateString;
      }
      
      const date = new Date(dateString);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        // Try to parse as ISO date
        const isoDate = new Date(dateString.split('T')[0]);
        if (!isNaN(isoDate.getTime())) {
          const options = { year: 'numeric', month: 'short', day: 'numeric' };
          return isoDate.toLocaleDateString('en-US', options);
        }
        return dateString; // Return original if still can't parse
      }
      const options = { year: 'numeric', month: 'short', day: 'numeric' };
      return date.toLocaleDateString('en-US', options);
    } catch (error) {
      return dateString; // Return original if parsing fails
    }
  };

  const [companyDetails, setCompanyDetails] = useState({
    companyName: '876 Nurses Home Care Services Limited',
    fullName: '876 NURSES HOME CARE SERVICES LIMITED',
    address: '60 Knutsford Blvd, Panjam Building, 9th Floor - Regus, Kingston 5, Jamaica, West Indies',
    phone: '(876) 618-9876',
    email: '876nurses@gmail.com',
    taxId: '',
    website: 'www.876nurses.com',
  });

  const [paymentInfo, setPaymentInfo] = useState({
    bankAccounts: [
      { 
        id: '1', 
        bankName: 'NCB', 
        recipientType: 'Individual',
        accountNumbers: [
          { id: '1', number: '123456789', currency: 'JMD' }
        ],
        payee: '',
        branch: '',
        swiftCode: '',
        sortCode: ''
      }
    ],
    cashAccepted: true,
    posAvailable: false
  });
  
  // Load company details and payment info
  useEffect(() => {
    loadCompanyDetails();
    loadPaymentInfo();
    
    if (!invoiceData && invoiceId) {
      loadInvoiceById(invoiceId);
    } else if (isStoreInvoice && invoiceData?.relatedOrderId) {
      loadOrderDetails(invoiceData);
    }
  }, []);

  // Handle payment success callback
  useEffect(() => {
    if (paymentSuccess && invoiceId) {
      handlePaymentSuccess();
    }
  }, [paymentSuccess]);

  const loadInvoiceById = async (id) => {
    try {
      setLoading(true);
      const invoice = await InvoiceService.getInvoiceById(id);
      if (invoice) {
        setInvoiceData(invoice);
        // If it's a store invoice, load order details
        if (invoice.service === 'Store Purchase' && invoice.relatedOrderId) {
           loadOrderDetails(invoice);
        }
      } else {
        Alert.alert('Error', 'Invoice not found');
      }
    } catch (error) {
      console.error('Error loading invoice:', error);
      Alert.alert('Error', 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  };
  
  const loadOrderDetails = async (invoice = invoiceData) => {
    if (!invoice) return;
    try {
      const ordersData = await AsyncStorage.getItem('@876_store_orders');
      if (ordersData) {
        const orders = JSON.parse(ordersData);
        const order = orders.find(o => o.orderNumber === invoice.relatedOrderId);
        if (order) {
          setOrderDetails(order);
        }
      }
    } catch (error) {
      console.error('Error loading order details:', error);
    }
  };

  const loadPaymentInfo = async () => {
    try {
      const shared = await SharedSettingsService.read('paymentInfo');
      if (shared) {
        setPaymentInfo(shared);
      }
    } catch (error) {
      console.error('Error loading payment info:', error);
    }
  };

  const loadCompanyDetails = async () => {
    try {
      const shared = await SharedSettingsService.read('company');
      if (shared) {
        setCompanyDetails(shared);
      }
    } catch (error) {
      console.error('Error loading company details:', error);
    }
  };

  const handlePaymentSuccess = async () => {
    try {
      setProcessingPayment(true);
      
      // Reload invoice to get latest data
      if (invoiceId) {
        await loadInvoiceById(invoiceId);
      }
      
      Alert.alert(
        'Payment Successful',
        'Your payment has been processed successfully. The invoice has been updated.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error handling payment success:', error);
    } finally {
      setProcessingPayment(false);
    }
  };

  const handlePayNow = async (amount, type = 'full') => {
    if (processingPayment) return;

    try {
      setProcessingPayment(true);

      // Prepare payment data
      const paymentData = {
        invoiceId: invoiceData.invoiceId || invoiceId,
         invoiceFirestoreId: invoiceData?.firestoreId || invoiceData?.id || null,
        amount: amount,
        customerId: user?.id || clientId || invoiceData.clientId,
        customerName: user?.fullName || user?.name || clientName || invoiceData.clientName,
        customerEmail: user?.email || invoiceData.clientEmail,
        customerPhone: user?.phone || invoiceData.clientPhone,
        description: type === 'balance' 
          ? `Balance payment for invoice ${invoiceData.invoiceNumber}`
          : `Payment for invoice ${invoiceData.invoiceNumber}`,
      };

      // Initialize Fygaro payment
      const result = await FygaroPaymentService.processInvoicePayment(paymentData);

      if (result.success) {
        const session = {
          paymentUrl: result.paymentUrl,
          sessionId: result.sessionId,
          transactionId: result.transactionId,
          amount,
          type,
        };

        setPaymentLink(result.paymentUrl);
        setPaymentSession(session);
      } else {
        Alert.alert('Payment Error', result.error || 'Failed to initialize payment');
      }
    } catch (error) {
      console.error('Error initiating payment:', error);
      Alert.alert('Error', 'Failed to initiate payment. Please try again.');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handlePaymentComplete = async (transactionData, amount, type) => {
    try {
      // Calculate new amounts
      const currentPaid = invoiceData.paidAmount || 0;
      const totalAmount = invoiceData.amount || invoiceData.total || 0;
      const newPaidAmount = currentPaid + amount;
      const newOutstanding = Math.max(0, totalAmount - newPaidAmount);
      const isFullyPaid = newOutstanding === 0;
      const invoiceIdentifier = invoiceData.invoiceId || invoiceId;
      const paymentMethodLabel = 'Fygaro Card';
      const paymentTimestamp = new Date().toISOString();

      const role = String(user?.role || '').trim();
      const canWriteInvoices = role === 'admin' || role === 'superAdmin';

      // Update invoice in Firebase
      const updatedInvoice = {
        ...invoiceData,
        paymentStatus: isFullyPaid ? 'paid' : 'partial',
        status: isFullyPaid ? 'paid' : invoiceData.status,
        paidAmount: newPaidAmount,
        outstandingAmount: newOutstanding,
        lastPaymentDate: paymentTimestamp,
        paymentMethod: paymentMethodLabel,
        paidDate: isFullyPaid ? paymentTimestamp : invoiceData.paidDate,
        payments: [
          ...(invoiceData.payments || []),
          {
            amount: amount,
            transactionId: transactionData.transactionId || transactionData.id,
            type: type,
            date: new Date().toISOString(),
            method: 'fygaro',
            status: 'completed'
          }
        ]
      };

      // IMPORTANT:
      // Patients should not attempt to write invoice/notification updates directly to Firestore.
      // These collections are admin-only by rules, and payments are reconciled by webhook/backend.
      if (canWriteInvoices) {
        await ApiService.updateInvoice(invoiceIdentifier, updatedInvoice);

        // Sync status for admin invoice management list
        try {
          await InvoiceService.updateInvoiceStatus(
            invoiceIdentifier,
            isFullyPaid ? 'Paid' : 'Pending',
            paymentMethodLabel
          );
        } catch (syncError) {
          console.warn('Failed to sync invoice status for management view:', syncError);
        }
      }

      // Notification delivery is handled by the authenticated Cloud Function.
      if (user?.id || clientId || invoiceData.clientId) {
        try {
          await ApiService.createNotification({
          userId: user?.id || clientId || invoiceData.clientId,
          title: 'Payment Successful',
          message: `Your payment of ${InvoiceService.formatCurrency(amount)} for invoice ${invoiceData.invoiceNumber || invoiceIdentifier} has been processed successfully.${isFullyPaid ? ' Invoice is now fully paid.' : ''}`,
          type: 'payment',
          data: {
            invoiceId: invoiceIdentifier,
            transactionId: transactionData.transactionId || transactionData.id,
            amount: amount,
            paymentType: type,
            isFullyPaid: isFullyPaid,
          },
          });
        } catch (notificationError) {
          console.warn('Payment completed but customer notification failed:', notificationError?.message || notificationError);
        }
      }

      // Send notification to all admins
      try {
        const admins = await ApiService.getAdmins();
        const patientName = invoiceData.patientName || invoiceData.clientName || user?.fullName || user?.name || clientName || 'Patient';
        
        for (const admin of admins) {
          await ApiService.createNotification({
              userId: admin.id,
              title: 'Invoice Payment Received',
              message: `Payment of ${InvoiceService.formatCurrency(amount)} received for invoice ${invoiceData.invoiceNumber || invoiceIdentifier} from ${patientName}.${isFullyPaid ? ' Invoice is now fully paid.' : ''}`,
              type: 'payment',
              priority: 'high',
              data: {
                invoiceId: invoiceIdentifier,
                transactionId: transactionData.transactionId || transactionData.id,
                amount: amount,
                paymentType: type,
                clientId: user?.id || clientId || invoiceData.clientId,
                clientName: patientName,
                isFullyPaid: isFullyPaid,
              },
          });
        }
      } catch (adminError) {
        console.error('Error notifying admins:', adminError);
      }

      // Update local state
      setInvoiceData(updatedInvoice);

      // Show success message
      const followUpHint = canWriteInvoices
        ? ''
        : '\n\nInvoice status will update shortly.';

      Alert.alert(
        'Payment Complete',
        `Payment of ${InvoiceService.formatCurrency(amount)} has been processed successfully.${isFullyPaid ? '\n\nInvoice is now fully paid!' : ''}${followUpHint}`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error completing payment:', error);
      Alert.alert('Warning', 'Payment was successful but there was an error updating the invoice. Please contact support.');
    }
  };

  const handleShareInvoice = async () => {
    if (isSharing || !invoiceData) return;
    
    setIsSharing(true);
    try {
      await InvoiceService.shareInvoice({
        ...invoiceData,
        companyDetails,
        paymentInfo,
        orderDetails,
      });
    } catch (error) {
      console.error('Error sharing invoice:', error);
      Alert.alert('Error', `Failed to create or share the current invoice PDF: ${error?.message || 'Please try again.'}`);
    } finally {
      setIsSharing(false);
    }
  };

  const handleBackPress = () => {
    if (returnToClientModal) {
      // Return to Users screen and reopen the client details modal
      navigation.navigate('Users', { 
        openClientDetails: true,
        clientId: clientId 
      });
    } else if (returnToClientDetails) {
      // Return to Users screen (AdminUserManagement), which will keep the client details modal open
      navigation.navigate('Users', { 
        openClientDetails: true,
        clientId: clientId 
      });
    } else if (returnToAppointmentModal) {
      // Return to Appointments screen and reopen the specific appointment modal
      navigation.navigate('Appointments', {
        openAppointmentDetails: true,
        appointmentId: appointmentId,
        appointmentTab: route.params?.appointmentTab || null,
        appointmentModalType: route.params?.appointmentModalType || null,
      });
    } else {
      // Just go back to previous screen (order details)
      navigation.goBack();
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 20, color: COLORS.text }}>Loading Invoice...</Text>
      </View>
    );
  }

  if (!invoiceData) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No invoice data available</Text>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Invoice Preview</Text>
          <TouchableOpacity 
            onPress={handleShareInvoice} 
            style={styles.shareButton}
            disabled={isSharing}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <MaterialCommunityIcons name="share" size={24} color={COLORS.white} />
            )}
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      {/* Invoice Preview */}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 }}
      >
        <View style={styles.invoiceContainer}>
          
          {/* PDF Invoice Preview */}
          <View style={styles.invoicePreviewCard}>
            {/* PDF Header */}
            <View style={styles.pdfHeader}>
              <View style={styles.pdfHeaderTop}>
                <View style={styles.pdfCompanyInfo}>
                  <Image 
                    source={require('../assets/Images/Nurses-logo.png')} 
                    style={styles.nursesLogoHeader}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.pdfInvoiceInfo}>
                  <Text style={styles.pdfInvoiceTitle}>INVOICE</Text>
                  <Text style={styles.pdfInvoiceNumber}>{invoiceData.invoiceId?.replace('CARE-INV', 'NUR-INV')}</Text>
                  {!isStoreInvoice && periodStartDate && periodEndDate ? (
                    <Text style={styles.pdfInvoiceDate}>
                      Period: {InvoiceService.formatDateForInvoice(periodStartDate)} - {InvoiceService.formatDateForInvoice(periodEndDate)}
                    </Text>
                  ) : null}
                  <Text style={styles.pdfInvoiceDate}>Issue Date: {InvoiceService.formatDateForInvoice(invoiceData.issueDate)}</Text>
                  <Text style={styles.pdfInvoiceDate}>Due Date: {InvoiceService.formatDateForInvoice(invoiceData.dueDate)}</Text>
                </View>
              </View>
              <View style={styles.pdfBlueLine} />
            </View>

            {/* Bill To and Service Provider */}
            <View style={styles.pdfClientSection}>
              <View style={styles.pdfClientRow}>
                <View style={styles.pdfBillTo}>
                  <Text style={styles.pdfSectionTitle}>BILL TO:</Text>
                  <Text style={styles.pdfClientName}>
                    {isStoreInvoice ? invoiceData.patientName : invoiceData.clientName}
                  </Text>
                  <Text style={styles.pdfClientInfo}>
                    {isStoreInvoice ? (invoiceData.patientEmail || 'N/A') : invoiceData.clientEmail}
                  </Text>
                  <Text style={styles.pdfClientInfo}>
                    {isStoreInvoice ? (invoiceData.patientPhone || 'N/A') : (clientPhone || invoiceData.clientPhone || 'N/A')}
                  </Text>
                  {!isStoreInvoice && <Text style={styles.pdfClientInfo}>{invoiceData.clientAddress}</Text>}
                  {isStoreInvoice && orderDetails && (
                    <Text style={styles.pdfClientInfo}>Order #{orderDetails.orderNumber}</Text>
                  )}
                </View>
                <View style={styles.pdfServiceProvider}>
                  <Text style={styles.pdfSectionTitle}>SERVICE PROVIDED BY:</Text>
                  <Text style={styles.pdfProviderName}>{companyDetails.companyName}</Text>
                  <Text style={styles.pdfProviderInfo}>{companyDetails.address}</Text>
                  <Text style={styles.pdfProviderInfo}>Phone: {companyDetails.phone}</Text>
                  <Text style={styles.pdfProviderInfo}>Email: {companyDetails.email}</Text>
                  {companyDetails.website && <Text style={styles.pdfProviderInfo}>Web: {companyDetails.website}</Text>}
                </View>
              </View>
            </View>

            {/* Service/Order Details Table */}
            <View style={styles.pdfServiceSection}>
              <View style={styles.pdfTable}>
                <View style={styles.pdfTableHeader}>
                  <Text style={[styles.pdfTableHeaderText, { flex: 2 }]}>Description</Text>
                  {isStoreInvoice ? (
                    <>
                      <Text style={styles.pdfTableHeaderText}>Qty</Text>
                      <Text style={styles.pdfTableHeaderText}>Unit Price</Text>
                      <Text style={styles.pdfTableHeaderText}>Amount</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.pdfTableHeaderText}>Hours</Text>
                      <Text style={styles.pdfTableHeaderText}>Rate</Text>
                      <Text style={styles.pdfTableHeaderText}>Amount</Text>
                    </>
                  )}
                </View>
                {isStoreInvoice ? (
                  // Store Purchase Items
                  invoiceData.items && invoiceData.items.length > 0 ? (
                    invoiceData.items.map((item, index) => (
                      <View key={index} style={styles.pdfTableRow}>
                        <Text style={[styles.pdfTableCell, { flex: 2 }]}>{item.description}</Text>
                        <Text style={styles.pdfTableCell}>{item.quantity}</Text>
                        <Text style={styles.pdfTableCell}>
                          {formatInvoiceMoney(item.unitPrice || 0)}
                        </Text>
                        <Text style={styles.pdfTableCellAmount}>
                          {formatInvoiceMoney(item.total || 0)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.pdfTableRow}>
                      <Text style={[styles.pdfTableCell, { flex: 2 }]}>{invoiceData.description || invoiceData.service}</Text>
                      <Text style={styles.pdfTableCell}>1</Text>
                      <Text style={styles.pdfTableCell}>
                        {formatInvoiceMoney(invoiceData.amount || 0)}
                      </Text>
                      <Text style={styles.pdfTableCellAmount}>
                        {formatInvoiceMoney(invoiceData.amount || 0)}
                      </Text>
                    </View>
                  )
                ) : (
                  // Appointment Service Items
                  invoiceData.items && invoiceData.items.length > 0 ? (
                    invoiceData.items.map((item, index) => (
                      <View key={index} style={styles.pdfTableRow}>
                        <Text style={[styles.pdfTableCell, { flex: 2 }]}>{item.description}</Text>
                        <Text style={styles.pdfTableCell}>{item.quantity || item.hours || invoiceData.hours || 1}</Text>
                        <Text style={styles.pdfTableCell}>
                          {formatInvoiceMoney(item.price || item.unitPrice || item.rate || invoiceData.rate || 0)}
                        </Text>
                        <Text style={styles.pdfTableCellAmount}>
                          {formatInvoiceMoney(item.amount || item.total || ((item.quantity || item.hours || invoiceData.hours || 1) * (item.price || item.unitPrice || item.rate || invoiceData.rate || 0)) || 0)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.pdfTableRow}>
                      <Text style={[styles.pdfTableCell, { flex: 2 }]}>{invoiceData.service}</Text>
                      <Text style={styles.pdfTableCell}>{invoiceData.hours}</Text>
                      <Text style={styles.pdfTableCell}>
                        {formatInvoiceMoney(invoiceData.rate || 0)}
                      </Text>
                      <Text style={styles.pdfTableCellAmount}>
                        {formatInvoiceMoney(invoiceData.total || 0)}
                      </Text>
                    </View>
                  )
                )}
              </View>

              {/* Bottom Section: Payment Info and Totals Side by Side */}
              <View style={styles.pdfBottomSection}>
                {/* Payment Information */}
                <View style={styles.pdfPaymentSection}>
                  <Text style={styles.pdfPaymentTitle}>Payment Information</Text>
                  {paymentInfo.bankAccounts.map((account) => (
                    <View key={account.id} style={styles.bankAccountGroup}>
                      <Text style={styles.pdfPaymentInfo}>{account.bankName}</Text>
                      {account.payee && (
                        <Text style={styles.pdfPaymentInfo}>Payee: {account.payee}</Text>
                      )}
                      {account.branch && (
                        <Text style={styles.pdfPaymentInfo}>Branch: {account.branch}</Text>
                      )}
                      {account.accountNumbers.map((accNum) => (
                        <Text key={accNum.id} style={styles.pdfPaymentInfo}>
                          {accNum.currency}: {accNum.number}
                        </Text>
                      ))}
                      {account.swiftCode && (
                        <Text style={styles.pdfPaymentInfo}>Swift: {account.swiftCode}</Text>
                      )}
                    </View>
                  ))}
                  {paymentInfo.cashAccepted && (
                    <Text style={styles.pdfPaymentInfo}>Cash accepted for home visits</Text>
                  )}
                  {paymentInfo.posAvailable && (
                    <Text style={styles.pdfPaymentInfo}>POS Machine Available</Text>
                  )}
                </View>

                {/* Totals Section */}
                <View style={styles.pdfTotalsSection}>
                  <View style={styles.pdfTotalRow}>
                    <Text style={styles.pdfTotalLabel}>Deposit:</Text>
                    <Text style={styles.pdfTotalValue}>
                      {formatInvoiceMoney(invoiceData.subtotal || invoiceData.amount || invoiceData.total || 0)}
                    </Text>
                  </View>
                  
                  {/* Partial Payment Details */}
                  {invoiceData.paymentStatus === 'partial' && invoiceData.paidAmount > 0 && (
                    <>
                      <View style={styles.pdfPaymentDetailRow}>
                        <Text style={styles.pdfPaymentDetailLabel}>Paid Amount:</Text>
                        <Text style={styles.pdfPaidAmount}>
                          {formatInvoiceMoney(invoiceData.paidAmount || 0)}
                        </Text>
                      </View>
                      <View style={styles.pdfPaymentDetailRow}>
                        <Text style={styles.pdfPaymentDetailLabel}>Outstanding:</Text>
                        <Text style={styles.pdfOutstandingAmount}>
                          {formatInvoiceMoney(invoiceData.outstandingAmount || 0)}
                        </Text>
                      </View>
                    </>
                  )}
                  
                  <View style={styles.pdfBlueLine} />
                  <View style={styles.pdfFinalTotalRow}>
                    <Text style={styles.pdfFinalTotalLabel}>Total Amount:</Text>
                    <Text style={styles.pdfFinalTotalAmount}>
                      {formatInvoiceMoney(invoiceData.finalTotal || invoiceData.amount || invoiceData.total || 0)}
                    </Text>
                  </View>
                  
                  {/* Paid Stamp below Total */}
                  {(invoiceData.status === 'Paid' || invoiceData.status === 'paid') && (
                    <View style={styles.paidStampContainer}>
                      <View style={styles.paidStamp}>
                        <Text style={styles.paidStampText}>PAID</Text>
                        {invoiceData.paymentMethod && (
                          <Text style={styles.paidMethodText}>{invoiceData.paymentMethod}</Text>
                        )}
                        {invoiceData.paidDate && (
                          <Text style={styles.paidDateText}>{InvoiceService.formatDateForInvoice(invoiceData.paidDate)}</Text>
                        )}
                      </View>
                    </View>
                  )}
                  
                  {/* Partial Payment Badge */}
                  {invoiceData.paymentStatus === 'partial' && (
                    <View style={styles.partialBadgeContainer}>
                      <View style={styles.partialPaymentBadge}>
                        <MaterialCommunityIcons name="information" size={16} color="#F59E0B" />
                        <Text style={styles.partialPaymentText}>PARTIAL PAYMENT</Text>
                      </View>
                      {invoiceData.payments && invoiceData.payments.length > 0 && (
                        <View style={styles.paymentHistory}>
                          <Text style={styles.paymentHistoryTitle}>Payment History:</Text>
                          {invoiceData.payments.map((payment, idx) => (
                            <View key={idx} style={styles.paymentHistoryRow}>
                              <Text style={styles.paymentHistoryLabel}>
                                {payment.type === 'deposit' ? 'Deposit' : 'Payment'} - {formatDate(payment.date)}
                              </Text>
                              <Text style={styles.paymentHistoryAmount}>
                                {formatInvoiceMoney(payment.amount || 0)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  
                  {/* Order Details for Store Invoices */}
                  {isStoreInvoice && orderDetails && (
                    <View style={styles.orderDetailsSection}>
                      <Text style={styles.orderDetailTitle}>Order Status</Text>
                      <View style={[styles.orderStatusBadge, {
                        backgroundColor: orderDetails.status === 'pending' ? '#FFA500' :
                                       orderDetails.status === 'completed' ? '#10B981' : '#EF4444'
                      }]}>
                        <Text style={styles.orderStatusText}>{orderDetails.status.toUpperCase()}</Text>
                      </View>
                      {orderDetails.completedDate && (
                        <Text style={styles.orderDetailText}>
                          Delivered: {formatDate(orderDetails.completedDate)}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Pay Now Footer (patient portal) */}
      {(returnToAppointmentModal || user?.role === 'patient') && totalAmount > 0 && (
        <View style={[styles.payNowFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={[styles.payBalanceSection, styles.payBalanceSectionFooter]}>
            <Text style={styles.payBalanceTitle}>{paySectionTitle}</Text>
            <Text
              style={[
                styles.payBalanceAmount,
                isFullyPaid && styles.payBalanceAmountPaid
              ]}
            >
              {formatInvoiceMoney(Math.max(isFullyPaid ? 0 : payNowAmount, 0))}
            </Text>

            <Text style={styles.payBalanceNote}>{paySectionNote}</Text>

            {!!paymentLink && (
              <View style={styles.paymentLinkBox}>
                <Text style={styles.paymentLinkLabel}>Fygaro Payment Link</Text>
                <Text selectable style={styles.paymentLinkText}>
                  {paymentLink}
                </Text>
                <View style={styles.paymentLinkActions}>
                  <TouchableOpacity
                    style={styles.paymentLinkActionButton}
                    onPress={async () => {
                      try {
                        await Clipboard.setStringAsync(paymentLink);
                        Alert.alert('Copied', 'Payment link copied to clipboard.');
                      } catch (e) {
                        Alert.alert('Error', 'Could not copy the payment link.');
                      }
                    }}
                  >
                    <MaterialCommunityIcons name="content-copy" size={18} color={COLORS.primary} />
                    <Text style={styles.paymentLinkActionText}>Copy</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.paymentLinkActionButton}
                    onPress={async () => {
                      try {
                        await Share.share({
                          message: `Payment link for invoice ${invoiceData.invoiceId || invoiceId}: ${paymentLink}`,
                        });
                      } catch (e) {
                        // Share sheet can be dismissed
                      }
                    }}
                  >
                    <MaterialCommunityIcons name="share-variant" size={18} color={COLORS.primary} />
                    <Text style={styles.paymentLinkActionText}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.paymentLinkActionButton}
                    onPress={() => openPaymentWebview(paymentSession)}
                    disabled={!paymentSession?.paymentUrl}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={18} color={COLORS.primary} />
                    <Text style={styles.paymentLinkActionText}>Open</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.payBalanceButtonWrapper}
              onPress={() => {
                if (payNowDisabled) return;

                // If we already generated a link for the current amount/type,
                // treat Pay Now as "Open Payment".
                if (
                  paymentSession?.paymentUrl &&
                  Math.abs(Number(paymentSession?.amount) - Number(payNowAmount)) < 0.01 &&
                  paymentSession?.type === payNowType
                ) {
                  openPaymentWebview(paymentSession);
                  return;
                }

                // Otherwise generate the Fygaro link, which will appear in the box below.
                handlePayNow(payNowAmount, payNowType);
              }}
              disabled={payNowDisabled}
            >
              <LinearGradient
                colors={payButtonColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.payBalanceButtonGradient}
              >
                {processingPayment && !isFullyPaid ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name={isFullyPaid ? 'check-circle' : 'cash-multiple'}
                      size={20}
                      color={payNowDisabled ? '#4B5563' : COLORS.white}
                    />
                    <Text
                      style={[
                        styles.payBalanceButtonText,
                        payNowDisabled && styles.payBalanceButtonDisabledText
                      ]}
                    >
                      Pay Now
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  watermarkLogo: {
    position: 'absolute',
    width: 250,
    height: 250,
    alignSelf: 'center',
    top: '40%',
    opacity: 0.05,
    zIndex: 0,
  },
  header: {
    paddingBottom: SPACING.md,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },

  payBalanceNote: {
    marginTop: 6,
    marginBottom: 10,
    fontSize: 13,
    color: '#374151',
    textAlign: 'center',
  },

  paymentLinkBox: {
    width: '100%',
    backgroundColor: '#F8FAFF',
    borderWidth: 1,
    borderColor: 'rgba(33, 150, 243, 0.25)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  paymentLinkLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 6,
  },
  paymentLinkText: {
    fontSize: 12,
    color: '#111827',
    lineHeight: 16,
  },
  paymentLinkActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  paymentLinkActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(33, 150, 243, 0.12)',
  },
  paymentLinkActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
  },
  backButton: {
    padding: SPACING.sm,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  shareButton: {
    padding: SPACING.sm,
  },
  scrollView: {
    flex: 1,
  },
  invoiceContainer: {
    padding: SPACING.md,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.primary,
  },
  // PDF Invoice Preview Styles (same as InvoiceManagementScreen)
  invoicePreviewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    maxWidth: 600,
    width: '100%',
  },
  pdfHeader: {
    backgroundColor: COLORS.white,
    paddingTop: SPACING.md,
  },
  pdfHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  pdfCompanyInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  nursesLogoHeader: {
    width: 50,
    height: 50,
    marginLeft: 24,
  },
  pdfCompanyName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00B8D4', // Teal blue from PDF
    marginBottom: 6,
  },
  pdfCompanyDetails: {
    fontSize: 10,
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfInvoiceInfo: {
    alignItems: 'flex-end',
  },
  pdfInvoiceTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  pdfInvoiceNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfInvoiceDate: {
    fontSize: 10,
    color: COLORS.textLight,
    marginBottom: 1,
  },
  pdfBlueLine: {
    height: 2,
    backgroundColor: COLORS.primary,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
  },
  pdfClientSection: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  pdfClientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pdfBillTo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  pdfServiceProvider: {
    flex: 1,
  },
  careLogo: {
    width: 120,
    height: 60,
    marginTop: 5,
  },
  pdfSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  pdfClientName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfClientInfo: {
    fontSize: 10,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  pdfProviderName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfProviderInfo: {
    fontSize: 10,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  pdfServiceSection: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  pdfTable: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    marginBottom: SPACING.md,
  },
  pdfTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pdfTableHeaderText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfTableRow: {
    flexDirection: 'row',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.xs,
  },
  pdfTableCell: {
    flex: 1,
    fontSize: 10,
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfTableCellAmount: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfBottomSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 20,
    gap: 20,
  },
  pdfPaymentSection: {
    flex: 1,
    paddingRight: 10,
  },
  pdfPaymentTitle: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 8,
  },
  bankAccountGroup: {
    marginBottom: 10,
  },
  pdfPaymentInfo: {
    fontSize: 9,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 14,
  },
  pdfTotalsSection: {
    alignItems: 'flex-end',
    minWidth: 160,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#F9F9F9',
  },
  pdfTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 160,
    paddingVertical: 2,
  },
  pdfTotalLabel: {
    fontSize: 11,
    color: COLORS.text,
  },
  pdfTotalValue: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.text,
  },
  pdfFinalTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 160,
    paddingVertical: 4,
    marginTop: 4,
  },
  pdfFinalTotalLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  pdfFinalTotalAmount: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  paidStampContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  paidStamp: {
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    transform: [{ rotate: '-5deg' }],
  },
  paidStampText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: '#4CAF50',
    textAlign: 'center',
    letterSpacing: 3,
  },
  paidDateText: {
    fontSize: 9,
    fontFamily: 'Poppins_600SemiBold',
    color: '#4CAF50',
    textAlign: 'center',
    marginTop: 1,
  },
  paidMethodText: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: '#4CAF50',
    textAlign: 'center',
    marginTop: 2,
  },
  orderDetailsSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'center',
  },
  orderDetailTitle: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 6,
  },
  orderStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  orderStatusText: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    letterSpacing: 1,
  },
  orderDetailText: {
    fontSize: 9,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  
  // Partial Payment Styles
  pdfPaymentDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 160,
    paddingVertical: 3,
    marginTop: 6,
  },
  pdfPaymentDetailLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  pdfPaidAmount: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: '#10B981',
  },
  pdfOutstandingAmount: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: '#F59E0B',
  },
  partialBadgeContainer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'center',
    width: '100%',
  },
  partialPaymentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 8,
  },
  partialPaymentText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: '#F59E0B',
    letterSpacing: 1,
  },
  paymentHistory: {
    marginTop: 8,
    width: '100%',
  },
  paymentHistoryTitle: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 6,
  },
  paymentHistoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  paymentHistoryLabel: {
    fontSize: 9,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    flex: 1,
  },
  paymentHistoryAmount: {
    fontSize: 9,
    fontFamily: 'Poppins_600SemiBold',
    color: '#10B981',
  },
  payBalanceSection: {
    marginTop: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 20,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F59E0B',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  payNowFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
    paddingTop: 10,
  },
  payBalanceSectionFooter: {
    marginTop: 0,
    marginBottom: 0,
  },
  payBalanceTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 8,
  },
  payBalanceAmount: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: '#10B981',
    marginBottom: 16,
  },
  payBalanceAmountPaid: {
    color: '#10B981',
  },
  payBalanceButtonWrapper: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  payBalanceButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  payBalanceButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  payBalanceButtonDisabledText: {
    color: '#4B5563',
  },
});

export default InvoiceDisplayScreen;
