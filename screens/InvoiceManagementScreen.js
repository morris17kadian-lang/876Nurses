import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { TouchableWeb } from '../components/TouchableWeb';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import InvoiceService from '../services/InvoiceService';
import { useAppointments } from '../context/AppointmentContext';
import SharedSettingsService from '../services/SharedSettingsService';

export default function InvoiceManagementScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const appointments = useAppointments();
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceDetailsVisible, setInvoiceDetailsVisible] = useState(false);
  const [filterStatus, setFilterStatus] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('invoices');
  const [recurringSchedules, setRecurringSchedules] = useState([]);
  const [searchVisible, setSearchVisible] = useState(false);
  const [paymentMethodModalVisible, setPaymentMethodModalVisible] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');
  const [invoiceToMarkPaid, setInvoiceToMarkPaid] = useState(null);
  const invoicePreviewInitialized = useRef(false);

  const closePaymentMethodModal = () => {
    setPaymentMethodModalVisible(false);
    setSelectedPaymentMethod('');
    setInvoiceToMarkPaid(null);
  };

  const coerceInvoiceDateString = (value) => {
    const parsed = InvoiceService.parseDateInput(value);
    return parsed ? InvoiceService.formatDateForInvoice(parsed) : null;
  };

  const resolveInvoicePeriod = (invoice) => {
    if (!invoice || typeof invoice !== 'object') return invoice;

    const existingStart = coerceInvoiceDateString(
      invoice.periodStart || invoice.billingPeriodStart || invoice.recurringPeriodStart
    );
    const existingEnd = coerceInvoiceDateString(
      invoice.periodEnd || invoice.billingPeriodEnd || invoice.recurringPeriodEnd
    );
    if (existingStart && existingEnd) {
      return {
        ...invoice,
        periodStart: existingStart,
        periodEnd: existingEnd,
      };
    }

    const allAppointments = appointments?.appointments;
    const lookupId = invoice.relatedAppointmentId ?? invoice.appointmentId ?? invoice.shiftRequestId ?? null;
    if (!lookupId || !Array.isArray(allAppointments) || allAppointments.length === 0) return invoice;

    const apt = allAppointments.find((a) => a?.id === lookupId || a?.appointmentId === lookupId);
    if (!apt) return invoice;

    const aptStart = coerceInvoiceDateString(
      apt.billingPeriodStart ||
        apt.recurringBilling?.cycleStartDate ||
        apt.recurringPeriodStart ||
        apt.recurringBilling?.periodStart ||
        apt.recurringStartDate
    );
    const aptEnd = coerceInvoiceDateString(
      apt.billingPeriodEnd ||
        apt.recurringBilling?.cycleEndDate ||
        apt.recurringPeriodEnd ||
        apt.recurringBilling?.periodEnd ||
        apt.recurringEndDate
    );

    if (aptStart && aptEnd) {
      return {
        ...invoice,
        periodStart: aptStart,
        periodEnd: aptEnd,
      };
    }

    return invoice;
  };

  // Keep the preview using the latest invoice object after status changes.
  useEffect(() => {
    if (!selectedInvoice?.invoiceId) return;
    const latest = invoices.find((inv) => inv?.invoiceId === selectedInvoice.invoiceId);
    if (!latest) return;

    // Avoid unnecessary state churn.
    const latestUpdatedAt = latest?.updatedAt || latest?.invoiceUpdatedAt;
    const selectedUpdatedAt = selectedInvoice?.updatedAt || selectedInvoice?.invoiceUpdatedAt;
    const shouldReplace =
      latest !== selectedInvoice &&
      (latest?.status !== selectedInvoice?.status ||
        latest?.paymentMethod !== selectedInvoice?.paymentMethod ||
        latest?.paidDate !== selectedInvoice?.paidDate ||
        (latestUpdatedAt && latestUpdatedAt !== selectedUpdatedAt));

    if (shouldReplace) {
      const merged = {
        ...latest,
        periodStart: latest?.periodStart || selectedInvoice?.periodStart,
        periodEnd: latest?.periodEnd || selectedInvoice?.periodEnd,
      };
      setSelectedInvoice(merged);
    }
  }, [invoices, selectedInvoice?.invoiceId]);

  // Format date to a cleaner format (e.g., "Nov 4, 2025")
  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      // If it's already in "MMM DD, YYYY" format, return as is
      if (typeof dateString === 'string' && /^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/.test(dateString)) {
        return dateString;
      }
      
      // Handle various date formats
      const date = new Date(dateString);
      // Check if date is valid
      if (isNaN(date.getTime())) return dateString;
      const options = { year: 'numeric', month: 'short', day: 'numeric' };
      return date.toLocaleDateString('en-US', options);
    } catch (error) {
      return dateString; // Return original if parsing fails
    }
  };

  const formatCurrency = (amount, currencyCode, serviceType) => {
    const numericAmount = typeof amount === 'number'
      ? amount
      : parseFloat(amount || 0) || 0;

    const currencyMap = {
      JMD: '$',
      USD: 'US$',
      CAD: 'CA$',
      EUR: '€',
    };

    const symbol = currencyMap[currencyCode] || currencyCode || '$';
    // Add thousand separators with toLocaleString
    return `${symbol}${numericAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const stripServiceDate = (value) => {
    if (!value || typeof value !== 'string') return value;
    return value
      .replace(/\s*\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const formatAddress = (addressValue) => {
    if (!addressValue) return '';
    if (typeof addressValue === 'string') return addressValue;

    // Sometimes we persist address as an object: { parish, street, postalCode, country, city }
    if (typeof addressValue === 'object') {
      const parts = [];
      if (addressValue.street) parts.push(addressValue.street);
      if (addressValue.city) parts.push(addressValue.city);
      if (addressValue.parish) parts.push(addressValue.parish);
      if (addressValue.postalCode) parts.push(addressValue.postalCode);
      if (addressValue.country) parts.push(addressValue.country);
      return parts.filter(Boolean).join(', ');
    }

    return String(addressValue);
  };

  const toDisplayText = (value, fallback = '') => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      const maybeAddress = formatAddress(value);
      if (maybeAddress) return maybeAddress;
      try {
        return JSON.stringify(value);
      } catch (err) {
        return fallback;
      }
    }
    return fallback;
  };

  const getClientAccountType = React.useCallback((invoice) => {
    const explicitType = String(
      invoice?.clientAccountType ||
      invoice?.accountType ||
      invoice?.customerType ||
      ''
    ).trim().toLowerCase();
    const clientId = String(invoice?.clientId || invoice?.patientId || invoice?.userId || '').trim().toLowerCase();
    const appointmentId = invoice?.relatedAppointmentId || invoice?.appointmentId || invoice?.shiftRequestId;
    const linkedAppointment = Array.isArray(appointments?.appointments)
      ? appointments.appointments.find((appointment) => {
          const ids = [appointment?.id, appointment?.appointmentId, appointment?.shiftRequestId]
            .filter(Boolean)
            .map(String);
          return appointmentId != null && ids.includes(String(appointmentId));
        })
      : null;

    const isGuest =
      invoice?.isGuestBooking === true ||
      invoice?.isGuest === true ||
      invoice?.guestBooking === true ||
      linkedAppointment?.isGuestBooking === true ||
      explicitType === 'guest' ||
      clientId.startsWith('guest_') ||
      clientId.includes('@');

    return isGuest
      ? { key: 'guest', label: 'Guest' }
      : { key: 'registered', label: 'Account Holder' };
  }, [appointments?.appointments]);

  const [companyDetails, setCompanyDetails] = useState({
    companyName: '876 Nurses Home Care Services Limited',
    fullName: '876 NURSES HOME CARE SERVICES LIMITED',
    address: '60 Knutsford Blvd, Panjam Building, 9th Floor - Regus, Kingston 5, Jamaica, West Indies',
    phone: '(876) 618-9876',
    email: '876nurses@gmail.com',
    taxId: '',
    website: 'www.876nurses.com'
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

  useEffect(() => {
    loadCompanyDetails();
    loadPaymentInfo();
  }, []);

  const prepareInvoicesForDisplay = React.useCallback((allInvoices) => {
    const updatedAllInvoices = Array.isArray(allInvoices) ? allInvoices : [];

    const realInvoices = updatedAllInvoices.filter((inv) => {
      const isSample =
        inv.appointmentId === 'SAMPLE-001' ||
        inv.appointmentId?.includes('SAMPLE') ||
        inv.invoiceId?.includes('SAMPLE') ||
        inv.clientName === 'John Smith (Sample)' ||
        inv.clientName === 'Sample Client' ||
        (inv.clientName === 'John Smith' && inv.clientEmail === 'john.smith@example.com');

      if (isSample) return false;

      if (inv.service === 'Store Purchase' && inv.relatedOrderId) {
        return true;
      }

      const invoiceAppointmentId = inv.relatedAppointmentId ?? inv.appointmentId ?? inv.shiftRequestId;
      if (invoiceAppointmentId !== undefined && invoiceAppointmentId !== null) {
        return true;
      }

      return Boolean(inv.invoiceId || inv.invoiceNumber) && Boolean(inv.clientName || inv.patientName || inv.clientEmail || inv.patientEmail);
    });

    const normalizeDateValue = (value) => {
      if (!value) return null;

      if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
          const date = value.toDate();
          const ms = date instanceof Date ? date.getTime() : NaN;
          return Number.isFinite(ms) ? ms : null;
        }
        if (typeof value.seconds === 'number') {
          const ms = value.seconds * 1000 + (typeof value.nanoseconds === 'number' ? Math.floor(value.nanoseconds / 1e6) : 0);
          return Number.isFinite(ms) ? ms : null;
        }
      }

      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : null;
    };

    const formatOptionalDate = (value) => {
      const ms = normalizeDateValue(value);
      if (ms === null) return null;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? InvoiceService.formatDateForInvoice(d) : null;
    };

    const normalizedInvoices = realInvoices.map((inv) => {
      const issueDateSource = inv.issueDate || inv.date || inv.createdAt;
      const dueDateSource = inv.dueDate || inv.paymentDueDate || inv.billingDueDate || inv.billingPeriodEnd;

      const periodStartSource =
        inv.periodStart ||
        inv.billingPeriodStart ||
        inv.recurringPeriodStart ||
        inv.recurringBilling?.cycleStartDate ||
        inv.recurringBilling?.periodStart ||
        inv.recurringBilling?.startDate ||
        inv.recurringStartDate ||
        null;

      const periodEndSource =
        inv.periodEnd ||
        inv.billingPeriodEnd ||
        inv.recurringPeriodEnd ||
        inv.recurringBilling?.cycleEndDate ||
        inv.recurringBilling?.periodEnd ||
        inv.recurringBilling?.endDate ||
        inv.recurringEndDate ||
        null;

      const periodStart = formatOptionalDate(periodStartSource);
      const periodEnd = formatOptionalDate(periodEndSource);

      return {
        ...inv,
        issueDate: InvoiceService.formatDateForInvoice(issueDateSource),
        dueDate: InvoiceService.formatDateForInvoice(dueDateSource || issueDateSource),
        ...(periodStart && periodEnd ? { periodStart, periodEnd } : null),
      };
    });

    const extractInvoiceSequence = (invoiceIdValue) => {
      if (!invoiceIdValue || typeof invoiceIdValue !== 'string') return null;
      const match = invoiceIdValue.match(/(\d{1,})\s*$/);
      if (!match) return null;
      const seq = parseInt(match[1], 10);
      return Number.isFinite(seq) ? seq : null;
    };

    return normalizedInvoices.sort((a, b) => {
      const aMs = normalizeDateValue(a?.updatedAt) ?? normalizeDateValue(a?.createdAt) ?? normalizeDateValue(a?.issueDate) ?? normalizeDateValue(a?.date);
      const bMs = normalizeDateValue(b?.updatedAt) ?? normalizeDateValue(b?.createdAt) ?? normalizeDateValue(b?.issueDate) ?? normalizeDateValue(b?.date);

      if (aMs !== null && bMs !== null && aMs !== bMs) return bMs - aMs;
      if (aMs !== null && bMs === null) return -1;
      if (aMs === null && bMs !== null) return 1;

      const aSeq = extractInvoiceSequence(a?.invoiceId || a?.invoiceNumber);
      const bSeq = extractInvoiceSequence(b?.invoiceId || b?.invoiceNumber);
      if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return bSeq - aSeq;
      if (aSeq !== null && bSeq === null) return -1;
      if (aSeq === null && bSeq !== null) return 1;

      return String(b?.invoiceId || '').localeCompare(String(a?.invoiceId || ''));
    });
  }, []);

  const updateInvoiceList = React.useCallback((allInvoices) => {
    const preparedInvoices = prepareInvoicesForDisplay(allInvoices);
    setInvoices(preparedInvoices);
    setSelectedInvoice((current) => {
      if (current?.invoiceId) {
        return preparedInvoices.find((invoice) => invoice?.invoiceId === current.invoiceId)
          || preparedInvoices[0]
          || null;
      }

      if (!invoicePreviewInitialized.current && preparedInvoices.length > 0) {
        invoicePreviewInitialized.current = true;
        return preparedInvoices[0];
      }

      return null;
    });
  }, [prepareInvoicesForDisplay]);

  const loadPaymentInfo = async () => {
    try {
      const shared = await SharedSettingsService.read('paymentInfo');
      if (shared) {
        setPaymentInfo(shared);
      }
    } catch (error) {
      // Error loading payment info
    }
  };

  const loadCompanyDetails = async () => {
    try {
      const parsed = await SharedSettingsService.read('company');
      if (parsed) {
        setCompanyDetails({
          ...parsed,
          address: formatAddress(parsed?.address) || companyDetails.address,
        });
      }
    } catch (error) {
      // Error loading company details
    }
  };

  // Load invoices when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadInvoices();
    }, [])
  );

  // Live updates so payment webhooks (Fygaro) reflect immediately.
  useFocusEffect(
    React.useCallback(() => {
      const unsubscribe = InvoiceService.subscribeToInvoices(
        async (liveInvoices) => {
          updateInvoiceList(liveInvoices);
          try {
            const invoiceStats = await InvoiceService.getInvoiceStats();
            setStats(invoiceStats);
          } catch {
            // ignore stats errors
          }
        },
        () => {
          // ignore subscription errors (screen can still use manual refresh)
        }
      );

      return () => {
        try {
          if (typeof unsubscribe === 'function') unsubscribe();
        } catch {
          // ignore
        }
      };
    }, [updateInvoiceList])
  );

  const loadInvoices = async () => {
    try {
      
      // Remove sample invoices from storage first
      await InvoiceService.removeSampleInvoices();

      // Delete Kaddy Holmes and Unknown Patient invoices as requested
      const currentInvoices = await InvoiceService.getAllInvoices();
      const invoicesToDelete = currentInvoices.filter(inv => {
        if (!inv.clientName) return false;
        const name = inv.clientName.toLowerCase();
        return name.includes('kaddy holmes') || 
               name.includes('unknown patient') || 
               name.includes('unknown client');
      });
      
      if (invoicesToDelete.length > 0) {
        for (const inv of invoicesToDelete) {
          if (inv && inv.invoiceId) {
            try {
              await InvoiceService.deleteInvoice(inv.invoiceId);
            } catch (err) {
              console.warn(`Failed to delete invoice ${inv.invoiceId}:`, err);
            }
          }
        }
      }
      
      const allInvoices = await InvoiceService.getAllInvoices();
      
      // Get all appointments to sync with real completed appointments
      const { appointments: allAppointments } = appointments;
      const completedAppointments = allAppointments
        ?.filter(apt => apt.status === 'completed') || [];
      const completedAppointmentIds = completedAppointments.map(apt => apt.id);
      
      
      // Create invoices from completed appointments that don't have one yet
      const invoiceAppointmentIds = allInvoices
        .filter(inv => !inv.appointmentId?.includes('SAMPLE'))
        .map(inv => inv.appointmentId);
      
      const appointmentsNeedingInvoices = completedAppointments.filter(
        apt => !invoiceAppointmentIds.includes(apt.id)
      );
      
      
      // Auto-generate invoices for completed appointments
      for (const apt of appointmentsNeedingInvoices) {
        try {
          // InvoiceService.createInvoice expects appointment-like data with an `id` and `appointmentDate`.
          // If we pass only `appointmentId`, the invoice won't link back to the appointment and will look "missing".
          const invoiceData = {
            id: apt.id,
            appointmentDate: apt.date || apt.appointmentDate || apt.preferredDate || new Date().toISOString(),
            patientName: apt.patientName || 'Unknown Patient',
            patientEmail: apt.patientEmail || apt.email || '',
            patientPhone: apt.patientPhone || apt.phone || '',
            address: formatAddress(apt.address || apt.clientAddress) || 'Address on file',
            nurseName: apt.nurseName || apt.assignedNurseName || 'Assigned Nurse',
            service: apt.service || 'Professional Care',
            serviceType: apt.serviceType || apt.service || 'Professional Care',
            billingFrequency: apt.billingFrequency || apt.recurringBilling?.frequency,
            recurringBilling: apt.recurringBilling,
            billingPeriodStart: apt.billingPeriodStart,
            billingPeriodEnd: apt.billingPeriodEnd,
            recurringPeriodStart: apt.recurringPeriodStart,
            recurringPeriodEnd: apt.recurringPeriodEnd,
            completionNotes: apt.completionNotes,
            nurseNotes: apt.nurseNotes,
            notes: apt.notes,
            createdAt: new Date().toISOString()
          };

          await InvoiceService.createInvoice(invoiceData);
        } catch (invError) {
          // Failed to auto-generate invoice
        }
      }
      
      const invoiceStats = await InvoiceService.getInvoiceStats();
      const schedules = await InvoiceService.getRecurringSchedules();

      // Reload all invoices after auto-generation
      const updatedAllInvoices = await InvoiceService.getAllInvoices();
      updateInvoiceList(updatedAllInvoices);
      setStats(invoiceStats);
      setRecurringSchedules(schedules);
    } catch (error) {
      Alert.alert('Error', 'Failed to load invoices');
    }
  };

  const handleClearAllInvoices = () => {
    Alert.alert(
      'Clear All Invoices',
      'This will delete ALL invoices and reset the counter. This action cannot be undone. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await InvoiceService.clearAllInvoices();
              await loadInvoices();
              Alert.alert('Success', 'All invoices have been cleared');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear invoices');
            }
          }
        }
      ]
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInvoices();
    setRefreshing(false);
  };

  // Filter and search invoices
  const filteredInvoices = useMemo(() => {
    let filtered = invoices;

    // Filter by status
    if (filterStatus !== 'All') {
      filtered = filtered.filter(invoice => invoice.status === filterStatus);
    }

    // Search by client name, invoice ID, or account type.
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((invoice) => {
        const accountType = getClientAccountType(invoice);
        return [
          invoice.clientName,
          invoice.patientName,
          invoice.invoiceId,
          invoice.relatedOrderId,
          accountType.label,
          accountType.key,
        ].some((value) => String(value || '').toLowerCase().includes(query));
      });
    }

    return filtered;
  }, [invoices, filterStatus, searchQuery, getClientAccountType]);

  const handleStatusUpdate = async (invoiceId, newStatus, paymentMethod = null) => {
    try {
      await InvoiceService.updateInvoiceStatus(invoiceId, newStatus, paymentMethod);
      
      // If this is a store invoice, sync with order status
      const invoice = invoices.find(inv => inv.invoiceId === invoiceId);
      if (invoice && invoice.service === 'Store Purchase' && invoice.relatedOrderId) {
        const ordersData = await AsyncStorage.getItem('@876_store_orders');
        if (ordersData) {
          const orders = JSON.parse(ordersData);
          const updatedOrders = orders.map(order => {
            if (order.orderNumber === invoice.relatedOrderId) {
              // If invoice is paid, mark order as completed (if it wasn't already)
              if (newStatus === 'Paid' && order.status === 'pending') {
                return {
                  ...order,
                  status: 'completed',
                  completedDate: new Date().toISOString()
                };
              }
            }
            return order;
          });
          await AsyncStorage.setItem('@876_store_orders', JSON.stringify(updatedOrders));
        }
      }
      
      await loadInvoices(); // Reload to reflect changes
      Alert.alert('Success', `Invoice status updated to ${newStatus}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to update invoice status');
    }
  };

  const handleMarkAsPaid = (invoice) => {
    setInvoiceToMarkPaid(invoice);
    setPaymentMethodModalVisible(true);
  };

  const confirmMarkAsPaid = async () => {
    if (!selectedPaymentMethod) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }

    const invoice = invoiceToMarkPaid;
    const method = selectedPaymentMethod;
    closePaymentMethodModal();

    if (!invoice?.invoiceId) return;
    await handleStatusUpdate(invoice.invoiceId, 'Paid', method);
  };

  const handleShareInvoice = async (invoice) => {
    try {
      await InvoiceService.shareInvoice({ ...invoice, companyDetails, paymentInfo });
    } catch (error) {
      Alert.alert('Error', 'Could not share invoice: ' + error.message);
    }
  };

  const handleViewInvoice = (invoice) => {
    setSelectedInvoice(resolveInvoicePeriod(invoice));
    // Scroll to the preview section at the top
    // You can add scroll functionality here if needed
  };

  const handleDeleteInvoice = async (invoiceId) => {
    Alert.alert(
      'Delete Invoice',
      'Are you sure you want to delete this invoice? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await InvoiceService.deleteInvoice(invoiceId);
              await loadInvoices();
              setInvoiceDetailsVisible(false);
              Alert.alert('Success', 'Invoice deleted successfully');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete invoice');
            }
          }
        }
      ]
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Paid': return COLORS.success;
      case 'Pending': return COLORS.warning;
      case 'Overdue': return COLORS.error;
      default: return COLORS.textLight;
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Paid': return 'check-circle';
      case 'Pending': return null;
      case 'Overdue': return 'alert-circle';
      default: return 'circle-outline';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20, paddingBottom: 20 }]}
      >
        <View style={styles.headerRow}>
          <TouchableWeb onPress={() => navigation.goBack()} style={styles.iconButton}>
            <MaterialCommunityIcons name="arrow-left" size={26} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.headerTitle}>Invoice Management</Text>
          <View style={styles.headerActions}>
            <TouchableWeb onPress={() => setSearchVisible(!searchVisible)} style={styles.iconButton}>
              <MaterialCommunityIcons name="magnify" size={24} color={COLORS.white} />
            </TouchableWeb>
          </View>
        </View>
        
        {/* Search Bar in Header */}
        {searchVisible && (
          <View style={styles.headerSearchBar}>
            <MaterialCommunityIcons name="magnify" size={20} color={COLORS.white} />
            <TextInput
              style={styles.headerSearchInput}
              placeholder="Search invoices..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor={COLORS.white + '80'}
            />
            <TouchableWeb onPress={() => setSearchQuery('')} style={styles.clearSearchButton}>
              <MaterialCommunityIcons name="close" size={20} color={COLORS.white} />
            </TouchableWeb>
          </View>
        )}
      </LinearGradient>

      {/* Main Scrollable Content */}
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Invoice Preview Section */}
        <View style={styles.previewSection}>
          <View style={styles.previewHeader}>
            <TouchableWeb
              onPress={() => setSelectedInvoice(null)}
              style={styles.closeIconButton}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="close" size={18} color={COLORS.white} />
            </TouchableWeb>
            <Text style={styles.previewTitle}>
              {selectedInvoice ? `Invoice Preview - ${selectedInvoice.invoiceId}` : 'Invoice Preview'}
            </Text>
            <TouchableWeb
              onPress={() => selectedInvoice && handleShareInvoice(selectedInvoice)}
              style={selectedInvoice ? styles.shareIconButton : styles.shareIconButtonDisabled}
              activeOpacity={selectedInvoice ? 0.7 : 1}
              disabled={!selectedInvoice}
            >
              <MaterialCommunityIcons name="file-pdf-box" size={18} color={selectedInvoice ? COLORS.primary : '#999'} />
            </TouchableWeb>
          </View>
          
          {selectedInvoice ? (
            <>
              <View style={styles.invoicePreviewBackdrop}>
                <View style={styles.invoicePreviewCard}>
                {/* PDF Header */}
                <View style={styles.pdfHeader}>
                  <View style={styles.pdfHeaderTop}>
                    <View style={styles.pdfCompanyInfo}>
                      <Image 
                        source={require('../assets/Images/Nurses-logo.png')} 
                        style={styles.nursesLogoHeader}
                        resizeMode="cover"
                      />
                    </View>
                    <View style={styles.pdfInvoiceInfo}>
                      <Text style={styles.pdfInvoiceTitle}>INVOICE</Text>
                      <Text style={styles.pdfInvoiceNumber}>
                        {toDisplayText(selectedInvoice.invoiceId, '')?.replace?.('CARE-INV', 'NUR-INV') || toDisplayText(selectedInvoice.invoiceId, '')}
                      </Text>
                      {(selectedInvoice?.service !== 'Store Purchase') &&
                      (selectedInvoice?.periodStart || selectedInvoice?.billingPeriodStart || selectedInvoice?.recurringPeriodStart) &&
                      (selectedInvoice?.periodEnd || selectedInvoice?.billingPeriodEnd || selectedInvoice?.recurringPeriodEnd) ? (
                        <Text style={styles.pdfInvoiceDate}>
                          Period: {formatDate(selectedInvoice?.periodStart || selectedInvoice?.billingPeriodStart || selectedInvoice?.recurringPeriodStart)} - {formatDate(selectedInvoice?.periodEnd || selectedInvoice?.billingPeriodEnd || selectedInvoice?.recurringPeriodEnd)}
                        </Text>
                      ) : null}
                      <Text style={styles.pdfInvoiceDate}>Issue Date: {formatDate(selectedInvoice.issueDate)}</Text>
                      <Text style={styles.pdfInvoiceDate}>Due Date: {formatDate(selectedInvoice.dueDate)}</Text>
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
                        {selectedInvoice.service === 'Store Purchase' 
                          ? toDisplayText(selectedInvoice.patientName || selectedInvoice.clientName, 'Client')
                          : toDisplayText(selectedInvoice.clientName, 'Client')
                        }
                      </Text>
                      <Text style={styles.pdfClientInfo}>
                        {selectedInvoice.service === 'Store Purchase'
                          ? toDisplayText(selectedInvoice.patientEmail || selectedInvoice.clientEmail, 'N/A')
                          : toDisplayText(selectedInvoice.clientEmail, 'N/A')
                        }
                      </Text>
                      <Text style={styles.pdfClientInfo}>
                        {selectedInvoice.service === 'Store Purchase'
                          ? toDisplayText(selectedInvoice.patientPhone || selectedInvoice.clientPhone, 'N/A')
                          : toDisplayText(selectedInvoice.clientPhone, 'N/A')
                        }
                      </Text>
                      {selectedInvoice.service === 'Store Purchase' ? (
                        <Text style={styles.pdfClientInfo}>Order #{selectedInvoice.relatedOrderId}</Text>
                      ) : (
                        <Text style={styles.pdfClientInfo}>
                          {formatAddress(selectedInvoice.clientAddress) || '123 Main Street, Anytown, State 12345'}
                        </Text>
                      )}
                    </View>
                    <View style={styles.pdfServiceProvider}>
                      <Text style={styles.pdfSectionTitle}>SERVICE PROVIDED BY:</Text>
                      <Text style={styles.pdfProviderName}>{companyDetails.companyName}</Text>
                      <Text style={styles.pdfProviderInfo}>{formatAddress(companyDetails.address)}</Text>
                      <Text style={styles.pdfProviderInfo}>Phone: {companyDetails.phone}</Text>
                      <Text style={styles.pdfProviderInfo}>Email: {companyDetails.email}</Text>
                      {companyDetails.website && <Text style={styles.pdfProviderInfo}>Web: {companyDetails.website}</Text>}
                    </View>
                  </View>
                </View>

                {/* Service/Order Table */}
                <View style={styles.pdfServiceSection}>
                  <View style={styles.pdfTable}>
                    <View style={styles.pdfTableHeader}>
                      <Text style={[styles.pdfTableHeaderText, { flex: 2 }]}>
                        {selectedInvoice.service === 'Store Purchase' ? 'Item Description' : 'Service Description'}
                      </Text>
                      {selectedInvoice.service === 'Store Purchase' ? (
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
                    {selectedInvoice.service === 'Store Purchase' ? (
                      // Store Purchase Items
                      selectedInvoice.items && selectedInvoice.items.length > 0 ? (
                        selectedInvoice.items.map((item, index) => (
                          <View key={index} style={styles.pdfTableRow}>
                            <Text style={[styles.pdfTableCell, { flex: 2 }]}>{stripServiceDate(item.description)}</Text>
                            <Text style={styles.pdfTableCell}>{item.quantity}</Text>
                            <Text style={styles.pdfTableCell}>{formatCurrency(item.unitPrice || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                            <Text style={styles.pdfTableCellAmount}>{formatCurrency(item.total || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                          </View>
                        ))
                      ) : (
                        <View style={styles.pdfTableRow}>
                          <Text style={[styles.pdfTableCell, { flex: 2 }]}>{stripServiceDate(selectedInvoice.description || selectedInvoice.service)}</Text>
                          <Text style={styles.pdfTableCell}>1</Text>
                          <Text style={styles.pdfTableCell}>{formatCurrency(selectedInvoice.total || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                          <Text style={styles.pdfTableCellAmount}>{formatCurrency(selectedInvoice.total || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                        </View>
                      )
                    ) : (
                      // Appointment Service
                      <View style={styles.pdfTableRow}>
                        <Text style={[styles.pdfTableCell, { flex: 2 }]}>{stripServiceDate(selectedInvoice.service)}</Text>
                        <Text style={styles.pdfTableCell}>{selectedInvoice.hours || 'N/A'}</Text>
                        <Text style={styles.pdfTableCell}>{formatCurrency(selectedInvoice.rate || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                        <Text style={styles.pdfTableCellAmount}>{formatCurrency(selectedInvoice.total || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                      </View>
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

                    {/* Invoice Totals */}
                    <View style={styles.pdfTotalsSection}>
                      <View style={styles.pdfTotalRow}>
                        <Text style={styles.pdfTotalLabel}>Deposit:</Text>
                        <Text style={styles.pdfTotalValue}>
                          {formatCurrency(
                            selectedInvoice.subtotal || selectedInvoice.total || selectedInvoice.amount || 0,
                            selectedInvoice?.currencyCode || selectedInvoice?.currency,
                            selectedInvoice?.serviceType || selectedInvoice?.service
                          )}
                        </Text>
                      </View>
                      <View style={styles.pdfBlueLine} />
                      <View style={styles.pdfFinalTotalRow}>
                        <Text style={styles.pdfFinalTotalLabel}>Total Amount:</Text>
                        <Text style={styles.pdfFinalTotalAmount}>
                          {formatCurrency(
                            selectedInvoice.finalTotal || selectedInvoice.total || selectedInvoice.amount || 0,
                            selectedInvoice?.currencyCode || selectedInvoice?.currency,
                            selectedInvoice?.serviceType || selectedInvoice?.service
                          )}
                        </Text>
                      </View>
                      
                      {/* Paid Stamp below Total */}
                      {selectedInvoice.status === 'Paid' && (
                        <View style={styles.paidStampContainer}>
                          <View style={styles.paidStamp}>
                            <Text style={styles.paidStampText}>PAID</Text>
                            {selectedInvoice.paymentMethod && (
                              <Text style={styles.paidMethodText}>{selectedInvoice.paymentMethod}</Text>
                            )}
                            {selectedInvoice.paidDate && (
                              <Text style={styles.paidDateText}>{formatDate(selectedInvoice.paidDate)}</Text>
                            )}
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.noInvoiceSelected}>
              <MaterialCommunityIcons name="file-document-outline" size={60} color={COLORS.border} />
              <Text style={styles.noInvoiceText}>Select an invoice below to preview</Text>
            </View>
          )}
        </View>

        {/* Filter Pills */}
        <View style={styles.filterContainer}>
          {[
            { key: 'All', label: 'All' },
            { key: 'Pending', label: 'Pending' },
            { key: 'Paid', label: 'Paid' },
            { key: 'Overdue', label: 'Overdue' }
          ].map((filter) => (
            <TouchableWeb
              key={filter.key}
              style={styles.filterPill}
              onPress={() => setFilterStatus(filter.key)}
              activeOpacity={0.8}
            >
              {filterStatus === filter.key ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  style={styles.filterPillGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                >
                  <Text style={styles.filterPillText}>
                    {filter.label}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveFilterPill}>
                  <Text style={styles.inactiveFilterPillText}>
                    {filter.label}
                  </Text>
                </View>
              )}
            </TouchableWeb>
          ))}
        </View>

        {/* Invoice List */}
        {filteredInvoices.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="file-document-outline" size={80} color={COLORS.border} />
            <Text style={styles.emptyTitle}>No invoices found</Text>
            <Text style={styles.emptyText}>
              {searchQuery || filterStatus !== 'All' 
                ? 'Try adjusting your search or filter'
                : 'Invoices will appear here when generated'
              }
            </Text>
          </View>
        ) : (
          <View style={styles.invoicesList}>
            {/* Grouped by Status Sectional Flow */}
            {['Pending', 'Paid', 'Overdue'].map((status) => {
              const statusInvoices = filteredInvoices.filter(inv => inv.status === status);
              if (statusInvoices.length === 0 && filterStatus !== 'All') return null;
              if (statusInvoices.length === 0) return null;

              return (
                <View key={status} style={styles.statusSection}>
                  {statusInvoices.map((invoice) => (
                    <View
                      key={invoice.invoiceId}
                      style={styles.invoiceCard}
                    >
                      <View style={styles.invoiceHeader}>
                        <View style={styles.invoiceInfo}>
                          <View style={styles.invoiceCardInfo}>
                            <Text style={styles.invoiceId}>
                              {invoice.service === 'Store Purchase'
                                ? `Order #${invoice.relatedOrderId || invoice.invoiceId}`
                                : (invoice.invoiceId?.replace('CARE-INV', 'NUR-INV') || invoice.invoiceId)}
                            </Text>
                            {invoice.service !== 'Store Purchase' && (invoice.patientName || invoice.clientName) && (
                              <Text style={styles.invoicePatientName}>
                                {invoice.patientName || invoice.clientName}
                              </Text>
                            )}
                            {invoice.service !== 'Store Purchase' && (() => {
                              const accountType = getClientAccountType(invoice);
                              return (
                                <View style={[
                                  styles.accountTypeBadge,
                                  accountType.key === 'guest' ? styles.guestAccountBadge : styles.registeredAccountBadge,
                                ]}>
                                  <MaterialCommunityIcons
                                    name={accountType.key === 'guest' ? 'account-clock-outline' : 'account-check-outline'}
                                    size={12}
                                    color={accountType.key === 'guest' ? '#C75B00' : '#087F5B'}
                                  />
                                  <Text style={[
                                    styles.accountTypeBadgeText,
                                    accountType.key === 'guest' ? styles.guestAccountBadgeText : styles.registeredAccountBadgeText,
                                  ]}>
                                    {accountType.label}
                                  </Text>
                                </View>
                              );
                            })()}
                          </View>
                        </View>
                        <View style={styles.invoiceActions}>
                          <TouchableWeb
                            style={styles.viewButton}
                            onPress={() => handleViewInvoice(invoice)}
                          >
                            <LinearGradient
                              colors={GRADIENTS.header}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.viewButtonGradient}
                            >
                              <Text style={styles.viewButtonText}>View</Text>
                            </LinearGradient>
                          </TouchableWeb>
                          
                          {(invoice.status === 'Pending' || invoice.status === 'Overdue') && (
                            <TouchableWeb
                              style={styles.paidButton}
                              onPress={() => handleMarkAsPaid(invoice)}
                            >
                              <LinearGradient
                                colors={['#10b981', '#059669']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.paidButtonGradient}
                              >
                                <Text style={styles.paidButtonText}>Paid</Text>
                              </LinearGradient>
                            </TouchableWeb>
                          )}
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Invoice Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={invoiceDetailsVisible}
        onRequestClose={() => setInvoiceDetailsVisible(false)}
      >
        <TouchableWeb 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setInvoiceDetailsVisible(false)}
        >
          <TouchableWeb 
            activeOpacity={1} 
            onPress={(e) => e.stopPropagation()}
            style={{ flex: 1, justifyContent: 'flex-end' }}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Invoice Details</Text>
                <TouchableWeb onPress={() => setInvoiceDetailsVisible(false)}>
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableWeb>
              </View>

              {selectedInvoice && (
                <ScrollView style={styles.modalBody}>
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Invoice Information</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Invoice ID:</Text>
                      <Text style={styles.detailValue}>{toDisplayText(selectedInvoice.invoiceId, '')}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Issue Date:</Text>
                      <Text style={styles.detailValue}>{formatDate(selectedInvoice.issueDate)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Due Date:</Text>
                      <Text style={styles.detailValue}>{formatDate(selectedInvoice.dueDate)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Status:</Text>
                      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedInvoice.status) + '20' }]}>
                        <Text style={[styles.statusText, { color: getStatusColor(selectedInvoice.status) }]}>
                          {selectedInvoice.status}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Client Information</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Account:</Text>
                      <Text style={styles.detailValue}>{getClientAccountType(selectedInvoice).label}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Name:</Text>
                      <Text style={styles.detailValue}>{toDisplayText(selectedInvoice.clientName, '')}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Email:</Text>
                      <Text style={styles.detailValue}>{toDisplayText(selectedInvoice.clientEmail, '')}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Phone:</Text>
                      <Text style={styles.detailValue}>{toDisplayText(selectedInvoice.clientPhone, '')}</Text>
                    </View>
                  </View>

                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Service Details</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Service:</Text>
                      <Text style={styles.detailValue}>{stripServiceDate(selectedInvoice.service)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Date:</Text>
                      <Text style={styles.detailValue}>{formatDate(selectedInvoice.date)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Hours:</Text>
                      <Text style={styles.detailValue}>{selectedInvoice.hours}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Rate:</Text>
                      <Text style={styles.detailValue}>{formatCurrency(selectedInvoice.rate || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Total:</Text>
                      <Text style={[styles.detailValue, styles.totalAmount]}>{formatCurrency(selectedInvoice.total || 0, selectedInvoice?.currencyCode || selectedInvoice?.currency, selectedInvoice?.serviceType || selectedInvoice?.service)}</Text>
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actionButtons}>
                    <TouchableWeb
                      style={styles.actionButton}
                      onPress={() => handleShareInvoice(selectedInvoice)}
                    >
                      <LinearGradient
                        colors={[COLORS.primary, COLORS.accent]}
                        style={styles.actionButtonGradient}
                      >
                        <MaterialCommunityIcons name="share" size={18} color={COLORS.white} />
                        <Text style={styles.actionButtonText}>Share</Text>
                      </LinearGradient>
                    </TouchableWeb>

                    {selectedInvoice.status === 'Pending' && (
                      <TouchableWeb
                        style={[styles.actionButton, styles.paidActionButton]}
                        onPress={() => handleMarkAsPaid(selectedInvoice)}
                      >
                        <LinearGradient
                          colors={['#10b981', '#059669']}
                          style={[styles.actionButtonGradient, styles.paidActionButtonGradient]}
                        >
                          <MaterialCommunityIcons name="check" size={18} color={COLORS.white} />
                          <Text style={[styles.actionButtonText, styles.paidActionButtonText]}>Mark Paid</Text>
                        </LinearGradient>
                      </TouchableWeb>
                    )}

                    <TouchableWeb
                      style={styles.deleteButton}
                      onPress={() => handleDeleteInvoice(selectedInvoice.invoiceId)}
                    >
                      <MaterialCommunityIcons name="delete" size={18} color={COLORS.error} />
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableWeb>
                  </View>
                </ScrollView>
              )}
            </View>
          </TouchableWeb>
        </TouchableWeb>
      </Modal>

      {/* Payment Method Modal */}
      <Modal
        visible={paymentMethodModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closePaymentMethodModal}
      >
        <View style={styles.paymentMethodOverlay}>
          <TouchableOpacity
            style={styles.paymentMethodBackdrop}
            activeOpacity={1}
            onPress={closePaymentMethodModal}
          />

          <View style={styles.paymentMethodModal}>
            <Text style={styles.paymentMethodTitle}>Select Payment Method</Text>
            <Text style={styles.paymentMethodSubtitle}>
              How did the client pay for this invoice?
            </Text>

            <View style={styles.paymentMethods}>
              {['Debit/Credit Card', 'Bank Transfer', 'Cash'].map((method) => {
                const isSelected = selectedPaymentMethod === method;
                return (
                  <TouchableWeb
                    key={method}
                    style={[styles.paymentMethodOption, isSelected && styles.paymentMethodOptionSelected]}
                    onPress={() => setSelectedPaymentMethod(method)}
                  >
                    {isSelected && (
                      <LinearGradient
                        colors={GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.paymentMethodOptionGradient}
                      />
                    )}
                    <MaterialCommunityIcons
                      name={
                        method === 'Debit/Credit Card'
                          ? 'credit-card'
                          : method === 'Bank Transfer'
                            ? 'bank-transfer'
                            : 'cash'
                      }
                      size={24}
                      color={isSelected ? COLORS.white : COLORS.primary}
                    />
                    <Text style={[styles.paymentMethodText, isSelected && styles.paymentMethodTextSelected]}>
                      {method}
                    </Text>
                  </TouchableWeb>
                );
              })}
            </View>

            <View style={styles.paymentMethodButtons}>
              <TouchableWeb style={styles.paymentMethodCancelButton} onPress={closePaymentMethodModal}>
                <Text style={styles.paymentMethodCancelText}>Cancel</Text>
              </TouchableWeb>
              <TouchableWeb
                style={[
                  styles.paidActionButton,
                  styles.paymentMethodConfirmButton,
                ]}
                onPress={confirmMarkAsPaid}
              >
                <LinearGradient
                  colors={['#10b981', '#059669']}
                  style={[styles.paidActionButtonGradient, styles.paymentMethodConfirmGradient]}
                >
                  <Text style={[styles.paymentMethodConfirmText, styles.paidActionButtonText]}>
                    Confirm Payment
                  </Text>
                </LinearGradient>
              </TouchableWeb>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  headerSearchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.white,
  },
  clearSearchButton: {
    padding: 4,
  },
  previewSection: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  previewHeader: {
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 6,
  },
  closeIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EF5350',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  shareIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  shareIconButtonDisabled: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  previewShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '10',
  },
  previewShareText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  invoicePreviewBackdrop: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoicePreviewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: SPACING.sm,
    width: '100%',
    maxWidth: 520,
    aspectRatio: 8.5 / 11, // US Letter
    alignSelf: 'center',
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
  paymentMethodOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  paymentMethodBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  paymentMethodModal: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  paymentMethodTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  paymentMethodSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: 24,
    textAlign: 'center',
  },
  paymentMethods: {
    gap: 12,
    marginBottom: 24,
  },
  paymentMethodOption: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: 12,
  },
  paymentMethodOptionSelected: {
    borderColor: COLORS.primary,
  },
  paymentMethodOptionGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
  },
  paymentMethodText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  paymentMethodTextSelected: {
    color: COLORS.white,
  },
  paymentMethodButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentMethodCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  paymentMethodCancelText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  paymentMethodConfirmButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  paymentMethodConfirmGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  paymentMethodConfirmText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  pdfHeader: {
    backgroundColor: COLORS.white,
    paddingTop: 4,
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
    width: 70,
    height: 70,
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
    backgroundColor: '#2196F3',
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
  pdfNurseName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfNurseTitle: {
    fontSize: 10,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  pdfNurseCompany: {
    fontSize: 10,
    color: COLORS.textLight,
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
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },
  filterPill: {
    flex: 1,
  },
  filterPillGradient: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  inactiveFilterPill: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  filterPillText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  inactiveFilterPillText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: SPACING.md,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  invoicesList: {
    padding: SPACING.md,
  },
  statusSection: {
    marginBottom: 24,
  },
  statusSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  statusSectionTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  invoiceCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  invoiceMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border + '80',
    paddingTop: SPACING.sm,
  },
  invoiceMetaBlock: {
    flex: 1,
  },
  invoiceMetaLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    fontFamily: 'Poppins_500Medium',
  },
  invoiceMetaValue: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  invoiceMetaOverdue: {
    color: COLORS.error,
  },
  invoiceMetaAmountBlock: {
    alignItems: 'flex-end',
  },
  invoiceMetaAmount: {
    marginTop: 2,
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  invoiceInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  invoiceCardInfo: {
    flex: 1,
  },
  invoiceId: {
    fontSize: 15,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  invoicePatientName: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  accountTypeBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  guestAccountBadge: {
    backgroundColor: '#FFF4E6',
    borderColor: '#FFD8A8',
  },
  registeredAccountBadge: {
    backgroundColor: '#E6FCF5',
    borderColor: '#96F2D7',
  },
  accountTypeBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
  },
  guestAccountBadgeText: {
    color: '#C75B00',
  },
  registeredAccountBadgeText: {
    color: '#087F5B',
  },
  clientName: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  invoiceSubInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  statusBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusTextSmall: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    textTransform: 'uppercase',
  },
  invoiceService: {
    fontSize: 12,
    color: COLORS.primary,
    marginTop: 2,
    fontFamily: 'Poppins_500Medium',
  },
  invoiceAmount: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: '#10B981',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Platform.OS === 'android' ? '93%' : '85%',
    minHeight: '50%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalBody: {
    flex: 1,
    padding: SPACING.lg,
  },
  detailsSection: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '30',
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  actionButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: SPACING.xs,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  paidActionButton: {
    borderRadius: 20,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  paidActionButtonGradient: {
    borderRadius: 20,
  },
  paidActionButtonText: {
    fontFamily: 'Poppins_700Bold',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    backgroundColor: COLORS.error + '20',
    gap: SPACING.xs,
  },
  deleteButtonText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '600',
  },
  invoiceActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  viewButton: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  viewButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 4,
  },
  viewButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },
  paidButton: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  paidButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    minWidth: 56,
  },
  paidButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
  },
  paidStatusPill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  paidStatusPillText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
  },
  noInvoiceSelected: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: SPACING.sm,
  },
  noInvoiceText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  closePreviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 8,
    marginTop: SPACING.sm,
    marginHorizontal: SPACING.md,
    gap: SPACING.xs,
  },
  closePreviewText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
