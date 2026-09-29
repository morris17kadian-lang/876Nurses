import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  Modal,
  Alert,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GRADIENTS, COLORS } from '../constants';
import InvoiceService from '../services/InvoiceService';
import { useAppointments } from '../context/AppointmentContext';

// Get screen width safely for styles
const screenWidth = Dimensions.get('window').width;

// Enhanced dashboard gradients
const DASHBOARD_GRADIENTS = {
  primary: ['#667eea', '#764ba2'],
  secondary: ['#f093fb', '#f5576c'],
  success: ['#4facfe', '#00f2fe'],
  warning: ['#43e97b', '#38f9d7'],
  info: ['#667eea', '#764ba2'],
  dark: ['#2c3e50', '#3498db'],
  // Different green shades for different periods
  greenDaily: ['#10B981', '#059669'], // Softer green (Paid-style) for daily
  greenWeekly: ['#4CAF50', '#388E3C'], // Standard green for weekly  
  greenMonthly: ['#2E7D32', '#1B5E20'], // Forest green for monthly
  greenYearly: ['#1B5E20', '#0F2027'] // Deep forest to dark green for yearly
};

const PaymentAnalyticsScreen = ({ navigation }) => {
  const { appointments = [] } = useAppointments();
  const handleClearPaymentAnalytics = async () => {
    Alert.alert(
      'Clear Payment Analytics',
      'This will clear all payment analytics data and reset to zero. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const keysToClear = [
                'paymentAnalytics',
                'analytics',
                'revenueData',
                'clientPerformance'
              ];
              await AsyncStorage.multiRemove(keysToClear);
              await AsyncStorage.setItem('analyticsCleared', 'true');
              setDataCleared(true);
              Alert.alert('Success', '✅ Payment analytics cleared! Data will reset to zero.');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          }
        }
      ]
    );
  };

  const insets = useSafeAreaInsets();
  const [dataCleared, setDataCleared] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('weekly');
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCardData, setSelectedCardData] = useState(null);
  const [targetsModalVisible, setTargetsModalVisible] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('JMD');
  const [currencyDropdownVisible, setCurrencyDropdownVisible] = useState(false);
  const [animatedValues] = useState(
    Array.from({ length: 7 }, () => new Animated.Value(0))
  );
  const [backendAnalytics, setBackendAnalytics] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Helper: wait until current interactions/animations finish to avoid UI jank
  const waitForInteractions = () => new Promise(resolve => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

  const closeDetailsModal = () => {
    setModalVisible(false);
    setSelectedCardData(null);
  };

  const closeTargetsModal = () => {
    setTargetsModalVisible(false);
  };

  useEffect(() => {
    // Check if data was cleared
    const checkClearedStatus = async () => {
      const cleared = await AsyncStorage.getItem('analyticsCleared');
      setDataCleared(cleared === 'true');
    };
    checkClearedStatus();
    
    // Reset and animate chart bars when period changes
    animatedValues.forEach(value => value.setValue(0));
    
    const animations = animatedValues.map((value, index) => 
      Animated.timing(value, {
        toValue: 1,
        duration: 1000,
        delay: index * 150,
        useNativeDriver: false,
      })
    );
    
    Animated.stagger(100, animations).start();
  }, [selectedPeriod]);

  // Fetch analytics data from backend and real app data
  const fetchAnalytics = async () => {
    // Prevent concurrent fetches
    if (loadingAnalytics) {
      console.log('[Analytics] Already loading, skipping fetch');
      return;
    }
    
    try {
      setLoadingAnalytics(true);
      if (dataCleared) {
        setBackendAnalytics(null);
        setLoadingAnalytics(false);
        return;
      }
      // Calculate from current invoice records so stale backend or local analytics
      // snapshots cannot keep showing a balance after invoices have been paid/cleared.
      const analyticsData = await calculateAnalyticsFromAppData(selectedPeriod);
      setBackendAnalytics(analyticsData);
    } catch (error) {
      console.error('[Analytics] Error:', error.message);
      setBackendAnalytics({
        totalRevenue: 0,
        totalBalance: 0,
        totalTransactions: 0,
        chartData: [],
        growthRate: '0%',
        dataSource: 'app',
      });
    } finally {
      setLoadingAnalytics(false);
    }
  };

  // Calculate analytics from real app data
  const calculateAnalyticsFromAppData = async (period) => {
    try {
      // Schedule heavy fetch after interactions to avoid jank
      await waitForInteractions();
      // Get real data from app
      const allInvoices = await InvoiceService.getAllInvoices();
      const invoices = allInvoices?.filter(inv => !inv.invoiceId?.includes('SAMPLE')) || [];

      const outstandingInvoices = invoices.filter((invoice) => {
        if (InvoiceService._isInvoicePaid(invoice)) return false;
        const outstanding = InvoiceService._getInvoiceOutstandingAmount(invoice);
        return Number.isFinite(outstanding) && outstanding > 0;
      });
      const outstandingBalance = outstandingInvoices.reduce((sum, invoice) => {
        return sum + InvoiceService._getInvoiceOutstandingAmount(invoice);
      }, 0);

      // Cache invoices for reuse elsewhere (e.g., client performance)
      const now = new Date();
      // Parse date strings in format "Feb 15, 2026" or ISO format
      const parseInvoiceDate = (dateStr) => {
        if (!dateStr) return null;
        
        // Try ISO format first (createdAt timestamps)
        if (dateStr.includes('T') || dateStr.includes('Z')) {
          return new Date(dateStr);
        }
        
        // Parse "Feb 15, 2026" format
        // Replace comma and parse
        const cleanDate = dateStr.replace(',', '');
        const parsed = new Date(cleanDate);
        
        // If still invalid, try manual parsing
        if (isNaN(parsed.getTime())) {
          const parts = dateStr.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
          if (parts) {
            const [, month, day, year] = parts;
            const monthMap = {
              'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
              'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };
            return new Date(parseInt(year), monthMap[month], parseInt(day));
          }
          return null;
        }
        
        return parsed;
      };
      
      const getPeriodBounds = (periodName, referenceDate) => {
        const start = new Date(referenceDate);
        start.setHours(0, 0, 0, 0);

        if (periodName === 'daily') {
          return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
        }
        if (periodName === 'weekly') {
          start.setDate(start.getDate() - start.getDay());
          return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
        }
        if (periodName === 'monthly') {
          start.setDate(1);
          return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
        }
        if (periodName === 'yearly') {
          start.setMonth(0, 1);
          return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
        }
        return null;
      };

      const currentPeriodBounds = getPeriodBounds(period, now);
      const previousPeriodBounds = currentPeriodBounds
        ? getPeriodBounds(period, new Date(currentPeriodBounds.start.getTime() - 1))
        : null;

      // Exclude future-dated records from current analytics.
      const isInCurrentPeriod = (invoiceDate) => {
        const invDate = parseInvoiceDate(invoiceDate);
        if (!invDate || isNaN(invDate.getTime())) return false;
        if (!currentPeriodBounds) return true;
        return invDate >= currentPeriodBounds.start && invDate < currentPeriodBounds.end && invDate <= now;
      };

      const isInPreviousPeriod = (invoiceDate) => {
        const invDate = parseInvoiceDate(invoiceDate);
        if (!invDate || isNaN(invDate.getTime())) return false;
        return Boolean(
          previousPeriodBounds &&
          invDate >= previousPeriodBounds.start &&
          invDate < previousPeriodBounds.end
        );
      };

      const toIsoString = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value.toDate === 'function') return value.toDate().toISOString();
        return '';
      };

      // Analytics count payment events, not invoices. Some older webhook-updated
      // invoices only have amountPaid/paymentTransactionId, so synthesize one
      // event for the unrepresented paid amount in those records.
      const paymentTransactions = invoices.flatMap((invoice) => {
        const fallbackDate = toIsoString(
          invoice.lastPaymentDate || invoice.paidDate || invoice.createdAt
        );
        const payments = (Array.isArray(invoice.payments) ? invoice.payments : [])
          .filter((payment) => {
            const status = String(payment?.status || '').trim().toLowerCase();
            return !['failed', 'cancelled', 'canceled', 'pending', 'processing', 'refunded', 'void'].includes(status)
              && Number(payment?.amount) > 0;
          })
          .map((payment) => ({
            invoice,
            amount: Number(payment.amount),
            date: toIsoString(payment.date || payment.paidAt) || fallbackDate,
            method: payment.method || invoice.paymentMethod || 'Payment',
          }));

        const recordedPaymentsTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
        const savedPaidAmount = [invoice.paidAmount, invoice.amountPaid, invoice.depositPaid]
          .map(Number)
          .find((amount) => Number.isFinite(amount) && amount > 0) || 0;
        const reportedPaidAmount = Math.max(recordedPaymentsTotal, savedPaidAmount);
        const unrecordedPaidAmount = reportedPaidAmount - recordedPaymentsTotal;

        if (unrecordedPaidAmount > 0 && fallbackDate) {
          payments.push({
            invoice,
            amount: unrecordedPaidAmount,
            date: fallbackDate,
            method: invoice.paymentMethod || 'Payment',
            transactionId: invoice.paymentTransactionId || null,
          });
        } else if (payments.length === 0 && InvoiceService._isInvoicePaid(invoice)) {
          const invoiceTotal = InvoiceService._getInvoiceTotal(invoice);
          if (invoiceTotal > 0 && fallbackDate) {
            payments.push({
              invoice,
              amount: invoiceTotal,
              date: fallbackDate,
              method: invoice.paymentMethod || 'Payment',
              transactionId: invoice.paymentTransactionId || null,
            });
          }
        }

        return payments;
      });

      const currentPeriodPayments = paymentTransactions.filter((payment) =>
        payment.date && isInCurrentPeriod(payment.date)
      );
      const previousPeriodPayments = paymentTransactions.filter((payment) =>
        payment.date && isInPreviousPeriod(payment.date)
      );

      const totalRevenue = currentPeriodPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const totalTransactions = currentPeriodPayments.length;
      const previousRevenue = previousPeriodPayments.reduce((sum, payment) => sum + payment.amount, 0);

      // Calculate growth rate
      let growthRate = '0%';
      if (previousRevenue > 0) {
        const growth = ((totalRevenue - previousRevenue) / previousRevenue * 100).toFixed(1);
        growthRate = growth > 0 ? `+${growth}%` : `${growth}%`;
      } else if (totalRevenue > 0) {
        growthRate = '+100%';
      }

      // Group invoices by time segments for chart data
      const chartData = (() => {
        const segments = Array(7).fill(0).map(() => ({ amount: 0, count: 0 }));
        
        currentPeriodPayments.forEach(payment => {
          const invDate = parseInvoiceDate(payment.date);
          if (!invDate || isNaN(invDate.getTime())) return;
          
          let segmentIndex = 0;

          switch (period) {
            case 'daily':
              // Group by 3-hour blocks: 6AM, 9AM, 12PM, 3PM, 6PM, 9PM, 12AM
              const hour = invDate.getHours();
              segmentIndex = Math.min(Math.floor(hour / 3), 6);
              break;
            case 'weekly':
              // Sunday = 0, Monday = 1, etc.
              segmentIndex = invDate.getDay();
              break;
            case 'monthly':
              // Group by weeks (7 segments for ~4 weeks)
              const dayOfMonth = invDate.getDate();
              segmentIndex = Math.min(Math.floor((dayOfMonth - 1) / 4.3), 6);
              break;
            case 'yearly':
              // Group by months (showing first 7 months)
              segmentIndex = Math.min(invDate.getMonth(), 6);
              break;
          }

          segments[segmentIndex].amount += payment.amount;
          segments[segmentIndex].count += 1;
        });

        const maxAmount = Math.max(...segments.map(s => s.amount), 1);
        const labels = {
          daily: ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM', '12AM'],
          weekly: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          monthly: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7'],
          yearly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']
        };

        return segments.map((seg, i) => ({
          label: labels[period][i],
          amount: Math.round(seg.amount),
          percentage: Math.round((seg.amount / maxAmount) * 100)
        }));
      })();

      // Service and payment-method totals follow the same payment events.
      const serviceBreakdown = {};
      currentPeriodPayments.forEach(({ invoice: inv, amount }) => {
        const serviceName = inv.service || (inv.items?.[0]?.description) || 'General Service';
        
        if (!serviceBreakdown[serviceName]) {
          serviceBreakdown[serviceName] = { revenue: 0, count: 0 };
        }
        serviceBreakdown[serviceName].revenue += amount;
        serviceBreakdown[serviceName].count += 1;
      });

      // Payment method breakdown
      const paymentMethods = {};
      currentPeriodPayments.forEach(({ method, amount }) => {
        if (method) {
          if (!paymentMethods[method]) paymentMethods[method] = 0;
          paymentMethods[method] += amount;
        }
      });
      
      return {
        totalRevenue,
        totalBalance: outstandingBalance,
        totalBalanceInvoices: outstandingInvoices.length,
        totalTransactions,
        chartData,
        growthRate,
        serviceBreakdown,
        paymentMethods,
        dataSource: 'app'
      };
      
      return result;
    } catch (error) {
      console.error('[Analytics] Calculation error:', error.message);
      console.error('[Analytics] Error stack:', error.stack);
      return null;
    }
  };

  // Refresh analytics when screen comes into focus or period changes
  useFocusEffect(
    React.useCallback(() => {
      fetchAnalytics();
    }, [selectedPeriod, dataCleared])
  );

  // Manual refresh handler
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await fetchAnalytics();
    setRefreshing(false);
  }, [selectedPeriod, dataCleared]);

  // Dynamic data based on selected period
  const getDataForPeriod = (period) => {
    // If backend data exists, use it
    if (backendAnalytics) {
      const total = backendAnalytics.totalRevenue || 0;
      const transactions = backendAnalytics.totalTransactions || 0;
      
      // Use real chart data if available
      const chartData = backendAnalytics.chartData || [
        { label: period === 'daily' ? '6AM' : period === 'weekly' ? 'Mon' : period === 'yearly' ? 'Jan' : 'Week 1', amount: Math.round(total / 7), percentage: 14 },
        { label: period === 'daily' ? '9AM' : period === 'weekly' ? 'Tue' : period === 'yearly' ? 'Feb' : 'Week 2', amount: Math.round(total / 7), percentage: 14 },
        { label: period === 'daily' ? '12PM' : period === 'weekly' ? 'Wed' : period === 'yearly' ? 'Mar' : 'Week 3', amount: Math.round(total / 7), percentage: 14 },
        { label: period === 'daily' ? '3PM' : period === 'weekly' ? 'Thu' : period === 'yearly' ? 'Apr' : 'Week 4', amount: Math.round(total / 7), percentage: 14 },
        { label: period === 'daily' ? '6PM' : period === 'weekly' ? 'Fri' : period === 'yearly' ? 'May' : 'Week 5', amount: Math.round(total / 7), percentage: 14 },
        { label: period === 'daily' ? '9PM' : period === 'weekly' ? 'Sat' : period === 'yearly' ? 'Jun' : '', amount: Math.round(total / 7), percentage: 14 },
        { label: period === 'daily' ? '12AM' : period === 'weekly' ? 'Sun' : period === 'yearly' ? 'Jul' : '', amount: Math.round(total / 7), percentage: 14 },
      ];
      
      return {
        chartData,
        totalRevenue: total,
        totalBalance: Number(backendAnalytics.totalBalance) || 0,
        totalBalanceInvoices: Number(backendAnalytics.totalBalanceInvoices) || 0,
        totalTransactions: transactions,
        periodLabel: period === 'daily' ? 'Today' : period === 'weekly' ? 'This Week' : period === 'yearly' ? 'This Year' : 'This Month',
        growthRate: backendAnalytics.growthRate || '0%',
      };
    }

    // If data cleared, return zero data
    if (dataCleared) {
      return {
        chartData: [
          { label: period === 'daily' ? '6AM' : period === 'weekly' ? 'Mon' : period === 'yearly' ? 'Jan' : 'Week 1', amount: 0, percentage: 0 },
          { label: period === 'daily' ? '9AM' : period === 'weekly' ? 'Tue' : period === 'yearly' ? 'Feb' : 'Week 2', amount: 0, percentage: 0 },
          { label: period === 'daily' ? '12PM' : period === 'weekly' ? 'Wed' : period === 'yearly' ? 'Mar' : 'Week 3', amount: 0, percentage: 0 },
          { label: period === 'daily' ? '3PM' : period === 'weekly' ? 'Thu' : period === 'yearly' ? 'Apr' : 'Week 4', amount: 0, percentage: 0 },
          { label: period === 'daily' ? '6PM' : period === 'weekly' ? 'Fri' : period === 'yearly' ? 'May' : 'Week 5', amount: 0, percentage: 0 },
          { label: period === 'daily' ? '9PM' : period === 'weekly' ? 'Sat' : period === 'yearly' ? 'Jun' : '', amount: 0, percentage: 0 },
          { label: period === 'daily' ? '12AM' : period === 'weekly' ? 'Sun' : period === 'yearly' ? 'Jul' : '', amount: 0, percentage: 0 },
        ],
        totalRevenue: 0,
        totalBalance: 0,
        totalBalanceInvoices: 0,
        totalTransactions: 0,
        periodLabel: period === 'daily' ? 'Today' : period === 'weekly' ? 'This Week' : period === 'yearly' ? 'This Year' : 'This Month',
        growthRate: '0%',
      };
    }
    
    const labels = {
      daily: ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM', '12AM'],
      weekly: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      monthly: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7'],
      yearly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
    };
    return {
      chartData: (labels[period] || labels.weekly).map(label => ({ label, amount: 0, percentage: 0 })),
      totalRevenue: 0,
      totalBalance: 0,
      totalBalanceInvoices: 0,
      totalTransactions: 0,
      periodLabel: period === 'daily' ? 'Today' : period === 'weekly' ? 'This Week' : period === 'yearly' ? 'This Year' : 'This Month',
      growthRate: '0%',
    };
  };

  const currentData = React.useMemo(
    () => getDataForPeriod(selectedPeriod),
    [selectedPeriod, backendAnalytics, dataCleared]
  );

  const appointmentAnalytics = React.useMemo(() => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (selectedPeriod === 'weekly') {
      periodStart.setDate(periodStart.getDate() - periodStart.getDay());
    } else if (selectedPeriod === 'monthly') {
      periodStart.setDate(1);
    } else if (selectedPeriod === 'yearly') {
      periodStart.setMonth(0, 1);
    }
    const periodEnd = new Date(periodStart);
    if (selectedPeriod === 'daily') periodEnd.setDate(periodEnd.getDate() + 1);
    else if (selectedPeriod === 'weekly') periodEnd.setDate(periodEnd.getDate() + 7);
    else if (selectedPeriod === 'monthly') periodEnd.setMonth(periodEnd.getMonth() + 1);
    else periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    const asDate = (value) => {
      if (!value) return null;
      const candidate = typeof value.toDate === 'function' ? value.toDate() : value;
      const date = candidate instanceof Date ? candidate : new Date(candidate);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const appointmentDate = (appointment) => asDate(
      appointment.completedAt || appointment.date || appointment.createdAt
    );
    const allAppointments = Array.isArray(appointments) ? appointments : [];
    const inCurrentPeriod = (appointment) => {
      const date = appointmentDate(appointment);
      return date && date >= periodStart && date < periodEnd;
    };
    const periodAppointments = allAppointments.filter(inCurrentPeriod);
    const statusOf = (appointment) => String(appointment.status || '').trim().toLowerCase();
    const completedAppointments = periodAppointments.filter((appointment) => statusOf(appointment) === 'completed');
    const cancelledAppointments = periodAppointments.filter((appointment) =>
      ['cancelled', 'canceled', 'declined', 'no-show', 'noshow'].includes(statusOf(appointment))
    );
    const resolvedCount = completedAppointments.length + cancelledAppointments.length;
    const completionRate = resolvedCount > 0
      ? (completedAppointments.length / resolvedCount) * 100
      : 0;
    const clientKey = (appointment) => String(
      appointment.clientId || appointment.patientId || appointment.userId ||
      appointment.clientEmail || appointment.patientEmail ||
      appointment.clientName || appointment.patientName || ''
    ).trim().toLowerCase();
    const firstVisitByClient = new Map();
    allAppointments.forEach((appointment) => {
      const key = clientKey(appointment);
      const date = appointmentDate(appointment);
      if (!key || !date) return;
      const firstVisit = firstVisitByClient.get(key);
      if (!firstVisit || date < firstVisit) firstVisitByClient.set(key, date);
    });
    const acquisitions = [...firstVisitByClient.values()].filter(
      (date) => date >= periodStart && date < periodEnd
    ).length;
    const completedClientCounts = new Map();
    allAppointments.filter((appointment) => statusOf(appointment) === 'completed').forEach((appointment) => {
      const key = clientKey(appointment);
      if (key) completedClientCounts.set(key, (completedClientCounts.get(key) || 0) + 1);
    });
    const completedClients = [...completedClientCounts.values()];
    const repeatClientRate = completedClients.length
      ? (completedClients.filter((count) => count > 1).length / completedClients.length) * 100
      : 0;
    const ratings = completedAppointments
      .map((appointment) => Number(
        appointment.clientRating ?? appointment.rating ?? appointment.feedback?.rating ?? appointment.review?.rating
      ))
      .filter((rating) => Number.isFinite(rating) && rating >= 0 && rating <= 5);
    const satisfaction = ratings.length
      ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
      : null;
    const clientsInPeriod = new Map();
    completedAppointments.forEach((appointment) => {
      const key = clientKey(appointment);
      if (!key) return;
      const client = clientsInPeriod.get(key) || {
        clientName: appointment.clientName || appointment.patientName || 'Client',
        appointmentCount: 0,
        totalSpent: 0,
      };
      client.appointmentCount += 1;
      clientsInPeriod.set(key, client);
    });
    const statusCounts = periodAppointments.reduce((counts, appointment) => {
      const status = statusOf(appointment);
      if (['pending', 'requested', 'pending_assignment'].includes(status)) counts.pending += 1;
      if (['confirmed', 'assigned', 'accepted', 'clocked-in', 'in-progress', 'in_progress'].includes(status)) counts.inProgress += 1;
      return counts;
    }, { pending: 0, inProgress: 0 });

    return {
      total: periodAppointments.length,
      completed: completedAppointments.length,
      cancelled: cancelledAppointments.length,
      resolved: resolvedCount,
      completionRate,
      acquisitions,
      repeatClientRate,
      satisfaction,
      frequentClients: [...clientsInPeriod.values()]
        .sort((a, b) => b.appointmentCount - a.appointmentCount)
        .slice(0, 3),
      ...statusCounts,
    };
  }, [appointments, selectedPeriod]);

  // Get gradient based on selected period
  const getWalletGradient = (period) => {
    switch(period) {
      case 'daily':
        return DASHBOARD_GRADIENTS.greenDaily;
      case 'weekly':
        return DASHBOARD_GRADIENTS.greenWeekly;
      case 'monthly':
        return DASHBOARD_GRADIENTS.greenMonthly;
      case 'yearly':
        return DASHBOARD_GRADIENTS.greenYearly;
      default:
        return DASHBOARD_GRADIENTS.greenWeekly;
    }
  };

  // Get target data based on selected period
  const getTargetsForPeriod = (period) => {
    // Return zero targets if data cleared
    if (dataCleared) {
      return {
        revenue: { current: 0, target: 0 },
        completion: { current: 0, target: 0 },
        satisfaction: { current: null, target: 4.8 },
        acquisitions: { current: 0, target: 0 }
      };
    }
    
    const baseTargets = {
      daily: {
        revenue: { current: currentData.totalRevenue, target: 150000 },
        completion: { current: appointmentAnalytics.completionRate, target: 96 },
        satisfaction: { current: appointmentAnalytics.satisfaction, target: 4.8 },
        acquisitions: { current: appointmentAnalytics.acquisitions, target: 2 }
      },
      weekly: {
        revenue: { current: currentData.totalRevenue, target: 500000 },
        completion: { current: appointmentAnalytics.completionRate, target: 96 },
        satisfaction: { current: appointmentAnalytics.satisfaction, target: 4.8 },
        acquisitions: { current: appointmentAnalytics.acquisitions, target: 10 }
      },
      monthly: {
        revenue: { current: currentData.totalRevenue, target: 1000000 },
        completion: { current: appointmentAnalytics.completionRate, target: 96 },
        satisfaction: { current: appointmentAnalytics.satisfaction, target: 4.8 },
        acquisitions: { current: appointmentAnalytics.acquisitions, target: 30 }
      },
      yearly: {
        revenue: { current: currentData.totalRevenue, target: 15000000 },
        completion: { current: appointmentAnalytics.completionRate, target: 96 },
        satisfaction: { current: appointmentAnalytics.satisfaction, target: 4.8 },
        acquisitions: { current: appointmentAnalytics.acquisitions, target: 360 }
      }
    };
    
    return baseTargets[period] || baseTargets.weekly;
  };

  // Get analytics data based on selected period
  const getAnalyticsForPeriod = (period) => {
    // Return zero analytics if data cleared
    if (dataCleared) {
      return {
        avgTransaction: 0,
        completed: 0,
        servicePerformance: '0',
        clientPerformance: '0',
        orderPerformance: 0,
        completionRate: '0'
      };
    }
    
    const data = currentData;
    const totalRevenue = Number(data?.totalRevenue ?? 0);
    const totalTransactions = Number(data?.totalTransactions ?? 0);
    const safeTotalRevenue = Number.isFinite(totalRevenue) ? totalRevenue : 0;
    const safeTotalTransactions = Number.isFinite(totalTransactions) ? totalTransactions : 0;
    const completionRate = appointmentAnalytics.completionRate;
    const servicePerformance = appointmentAnalytics.completionRate;
    const clientPerformance = appointmentAnalytics.repeatClientRate;
    
    return {
      avgTransaction: safeTotalTransactions > 0 ? Math.round(safeTotalRevenue / safeTotalTransactions) : 0,
      completed: appointmentAnalytics.completed,
      servicePerformance: servicePerformance.toFixed(1),
      clientPerformance: clientPerformance.toFixed(1),
      orderPerformance: safeTotalTransactions,
      completionRate: completionRate.toFixed(1)
    };
  };

  const analyticsData = React.useMemo(
    () => getAnalyticsForPeriod(selectedPeriod),
    [
      selectedPeriod,
      dataCleared,
      currentData?.totalRevenue,
      currentData?.totalTransactions,
      appointmentAnalytics,
    ]
  );

  // Currency conversion logic
  const exchangeRates = {
    JMD: 1,
    USD: 156.50,    // 1 USD = 156.50 JMD
    EUR: 170.20,    // 1 EUR = 170.20 JMD
    GBP: 198.50,    // 1 GBP = 198.50 JMD
    CAD: 115.30,    // 1 CAD = 115.30 JMD
  };

  const currencySymbols = {
    JMD: 'J$',
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'C$',
  };

  const convertPrice = (priceInJMD) => {
    const numeric = Number(priceInJMD);
    const safe = Number.isFinite(numeric) ? numeric : 0;

    if (selectedCurrency === 'JMD') {
      return safe.toFixed(2);
    }

    const rate = exchangeRates[selectedCurrency] || 1;
    const safeRate = Number.isFinite(rate) && rate !== 0 ? rate : 1;
    return (safe / safeRate).toFixed(2);
  };

  const getCurrencySymbol = () => {
    return currencySymbols[selectedCurrency] || 'J$';
  };

  // Updated formatCurrency function to use selected currency
  const formatCurrencyWithConverter = (amount) => {
    const convertedAmount = convertPrice(amount);
    const numeric = Number(convertedAmount);
    const safe = Number.isFinite(numeric) ? numeric : 0;
    return `${getCurrencySymbol()}${safe.toLocaleString()}`;
  };

  const serviceRevenueData = dataCleared ? [] : (() => {
    // Use real service breakdown if available from analytics
    if (backendAnalytics?.serviceBreakdown) {
      const services = Object.entries(backendAnalytics.serviceBreakdown)
        .map(([name, data]) => ({
          name,
          revenue: data.revenue,
          bookings: data.count,
          percentage: currentData.totalRevenue > 0
            ? Math.round((data.revenue / currentData.totalRevenue) * 100)
            : 0
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      // Add gradients
      const gradients = [
        COLORS.gradient1,
        COLORS.gradient2,
        COLORS.gradient3,
        COLORS.gradient4,
        ['#ffecd2', '#fcb69f']
      ];

      return services.map((service, idx) => ({
        id: idx + 1,
        ...service,
        gradient: gradients[idx] || COLORS.gradient1,
        icon: 'medical-bag'
      }));
    }

    return [];
  })();

  const paymentMethodData = dataCleared ? [] : (() => {
    // Use real payment method breakdown if available
    if (backendAnalytics?.paymentMethods) {
      const methods = Object.entries(backendAnalytics.paymentMethods)
        .map(([name, amount]) => ({
          name: name.replace(/([A-Z])/g, ' $1').trim(),
          amount: Math.round(amount),
          percentage: currentData.totalRevenue > 0
            ? Math.round((amount / currentData.totalRevenue) * 100)
            : 0
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3);

      const gradients = [COLORS.gradient1, COLORS.gradient2, COLORS.gradient3];
      const icons = {
        'Credit Card': 'credit-card',
        'Debit Card': 'credit-card',
        'Card': 'credit-card',
        'Cash': 'cash',
        'Bank Transfer': 'bank-transfer',
        'Digital Wallet': 'wallet',
        'Mobile Money': 'cellphone',
        'Check': 'checkbook'
      };

      return methods.map((method, idx) => ({
        id: idx + 1,
        ...method,
        gradient: gradients[idx] || COLORS.gradient1,
        icon: icons[method.name] || 'cash'
      }));
    }

    return [];
  })();

  const formatCurrency = (amount) => {
    const numeric = Number(amount);
    const safe = Number.isFinite(numeric) ? numeric : 0;
    return `J$${safe.toLocaleString()}`;
  };

  const FilterTabs = () => (
    <View style={styles.filterContainer}>
      {['daily', 'weekly', 'yearly'].map((period) => (
        <TouchableOpacity
          key={period}
          style={styles.filterPill}
          onPress={() => setSelectedPeriod(period)}
        >
          {selectedPeriod === period ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.filterPillGradient}
            >
              <Text style={styles.filterPillText}>
                {period.charAt(0).toUpperCase() + period.slice(1)}
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveFilterPill}>
              <Text style={styles.inactiveFilterPillText}>
                {period.charAt(0).toUpperCase() + period.slice(1)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  // Targets Management Modal
  const TargetsManagementModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      presentationStyle="overFullScreen"
      hardwareAccelerated={true}
      visible={targetsModalVisible}
      onRequestClose={closeTargetsModal}
      onDismiss={closeTargetsModal}
    >
      <TouchableWithoutFeedback onPress={closeTargetsModal}>
        <View style={styles.modalOverlay}>
          <View pointerEvents="box-none">
        <View style={[styles.modalContent, { height: '80%' }]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>Manage Performance Targets</Text>
              <Text style={styles.modalSubtitle}>Set and adjust your business goals</Text>
            </View>
            <TouchableOpacity 
              style={styles.modalCloseButton}
              onPress={closeTargetsModal}
            >
              <MaterialCommunityIcons name="close" size={18} color="#666" />
            </TouchableOpacity>
          </View>
          
          <ScrollView
            style={styles.modalBody}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            nestedScrollEnabled={true}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {(() => {
              const targets = getTargetsForPeriod(selectedPeriod);
              return [
                { 
                  title: `${selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} Revenue Goal`, 
                  current: formatCurrencyWithConverter(targets.revenue.current), 
                  target: formatCurrencyWithConverter(targets.revenue.target),
                  icon: 'currency-usd',
                  color: '#4CAF50',
                  key: 'revenue',
                  progress: targets.revenue.target > 0 ? targets.revenue.current / targets.revenue.target : 0,
                },
                { 
                  title: 'Service Completion Rate', 
                  current: `${analyticsData.completionRate}%`, 
                  target: `${targets.completion.target}%`,
                  icon: 'check-circle',
                  color: '#2196F3',
                  key: 'completion',
                  progress: targets.completion.target > 0 ? targets.completion.current / targets.completion.target : 0,
                },
                { 
                  title: 'Client Satisfaction Score', 
                  current: targets.satisfaction.current == null ? 'Not rated' : `${targets.satisfaction.current.toFixed(1)}/5`,
                  target: `${targets.satisfaction.target}/5`,
                  icon: 'star',
                  color: '#FF9800',
                  key: 'satisfaction',
                  progress: targets.satisfaction.current == null ? null : targets.satisfaction.current / targets.satisfaction.target,
                },
                { 
                  title: 'New Client Acquisition', 
                  current: targets.acquisitions.current.toString(), 
                  target: targets.acquisitions.target.toString(),
                  icon: 'account-plus',
                  color: '#9C27B0',
                  key: 'acquisition',
                  progress: targets.acquisitions.target > 0 ? targets.acquisitions.current / targets.acquisitions.target : 0,
                }
              ];
            })().map((target, index) => (
              <View key={target.key} style={styles.targetManageItem}>
                <View style={styles.targetManageHeader}>
                  <Text style={styles.targetManageTitle}>{target.title}</Text>
                </View>
                
                <View style={styles.targetManageValues}>
                  <View style={styles.targetManageValue}>
                    <Text style={styles.targetManageLabel}>Current</Text>
                    <Text
                      style={
                        typeof target.current === 'string' && target.current.includes('%')
                          ? [styles.targetManageNumber, styles.modalPercentText]
                          : [styles.targetManageNumber, { color: target.color }]
                      }
                    >
                      {target.current}
                    </Text>
                  </View>
                  
                  <View style={styles.targetManageValue}>
                    <Text style={styles.targetManageLabel}>Target</Text>
                    <TouchableOpacity style={styles.targetEditButton}>
                      <Text
                        style={
                          typeof target.target === 'string' && target.target.includes('%')
                            ? [styles.targetManageNumber, styles.modalPercentText]
                            : styles.targetManageNumber
                        }
                      >
                        {target.target}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                <View style={styles.targetProgressContainer}>
                  <View style={styles.targetProgressBar}>
                    <View 
                      style={[
                        styles.targetProgressFill, 
                        { 
                          width: `${Math.max(0, Math.min((target.progress || 0) * 100, 100))}%`,
                          backgroundColor: target.color + '40' 
                        }
                      ]} 
                    />
                  </View>
                  <Text style={[styles.targetProgressText, styles.modalPercentText]}>
                    {target.progress == null ? 'No ratings yet' : `${Math.round(Math.max(0, Math.min(target.progress * 100, 100)))}% to goal`}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
          
          <View style={styles.modalActions}>
            <TouchableOpacity 
              style={styles.modalSecondaryButton}
              onPress={closeTargetsModal}
              activeOpacity={0.7}
            >
              <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.modalPrimaryButtonContainer}
              onPress={() => {
                // Save targets logic here
                closeTargetsModal();
              }}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.modalPrimaryButtonGradient}
              >
                <Text style={styles.modalButtonText}>Save Changes</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
        </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  // Modal component for detailed analytics
  const DetailsModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      presentationStyle="overFullScreen"
      hardwareAccelerated={true}
      visible={modalVisible}
      onRequestClose={closeDetailsModal}
      onDismiss={closeDetailsModal}
    >
      <TouchableWithoutFeedback onPress={closeDetailsModal}>
        <View style={[styles.modalOverlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <View pointerEvents="box-none">
        <View style={[styles.modalContent, styles.detailsModalContent, {
          height: Math.min(Dimensions.get('window').height - insets.top - insets.bottom - 48, 620),
        }]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalIconContainer}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>{selectedCardData?.title}</Text>
                <Text
                  style={[
                    styles.modalMainValue,
                    typeof selectedCardData?.mainValue === 'string' && selectedCardData.mainValue.includes('%')
                      ? styles.modalPercentText
                      : { color: selectedCardData?.color },
                  ]}
                >
                  {selectedCardData?.mainValue}
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={styles.modalCloseButton}
              onPress={closeDetailsModal}
            >
              <MaterialCommunityIcons name="close" size={18} color="#666" />
            </TouchableOpacity>
          </View>
          
          <ScrollView
            style={[styles.modalBody, styles.detailsModalBody]}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            nestedScrollEnabled={true}
            contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
            showsVerticalScrollIndicator={true}
          >
            {selectedCardData?.details?.map((detail, index) => (
              <View key={index} style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>{detail.label}</Text>
                <Text
                  style={
                    typeof detail.value === 'string' && detail.value.includes('%')
                      ? [styles.modalDetailValue, styles.modalPercentText]
                      : styles.modalDetailValue
                  }
                >
                  {detail.value}
                </Text>
              </View>
            ))}
          </ScrollView>
          
        </View>
        </View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  // New wallet-style header component
  const WalletHeader = () => (
    <View style={styles.walletContainer}>
      <LinearGradient
        colors={getWalletGradient(selectedPeriod)}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.walletCard}
      >
        <View style={styles.walletTopRow}>
          <View>
            <Text style={styles.walletLabel}>Outstanding Balance</Text>
            <Text style={styles.walletAmount}>{formatCurrencyWithConverter(currentData.totalBalance)}</Text>
            {loadingAnalytics && (
              <Text style={[styles.walletLabel, { fontSize: 10, marginTop: 4 }]}>Loading...</Text>
            )}
            {backendAnalytics && backendAnalytics.dataSource === 'app' && (
              <Text style={[styles.walletLabel, { fontSize: 9, marginTop: 2 }]}>
                From {currentData.totalBalanceInvoices} unpaid invoice{currentData.totalBalanceInvoices !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
          <View style={styles.walletIconContainer}>
            <TouchableOpacity 
              style={styles.currencyPicker}
              onPress={() => setCurrencyDropdownVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.currencyPickerText}>{selectedCurrency}</Text>
              <MaterialCommunityIcons name="chevron-down" size={16} color="rgba(255,255,255,0.9)" />
            </TouchableOpacity>
            <View style={styles.periodIndicator}>
              <Text style={styles.periodIndicatorText}>
                {selectedPeriod.charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        
        <View style={styles.walletBottomRow}>
          <View style={styles.walletStat}>
            <MaterialCommunityIcons name="trending-up" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.walletStatText}>{currentData.growthRate}</Text>
          </View>
          <View style={styles.walletStat}>
            <MaterialCommunityIcons name="receipt" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.walletStatText}>{currentData.totalTransactions} transactions</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );

  // Analytics cards component with click handlers
  const handleCardPress = (cardType) => {
    // Don't open modal if client data is still loading
    const ACCENT_BLUE = '#2196F3';
    const cardDetails = {
      avgTransaction: {
        title: 'Average Transaction Details',
        mainValue: formatCurrencyWithConverter(analyticsData.avgTransaction),
        details: [
          { label: `Current ${selectedPeriod}`, value: formatCurrencyWithConverter(analyticsData.avgTransaction) },
          { label: 'Payments in period', value: currentData.totalTransactions.toString() },
          { label: 'Revenue in period', value: formatCurrencyWithConverter(currentData.totalRevenue) },
        ],
        icon: 'calculator',
        color: ACCENT_BLUE
      },
      completed: {
        title: 'Completed Services',
        mainValue: analyticsData.completed.toString(),
        details: [
          { label: 'Completed services', value: appointmentAnalytics.completed.toString() },
          { label: 'Resolved appointments', value: appointmentAnalytics.resolved.toString() },
          { label: 'Total Revenue', value: formatCurrencyWithConverter(currentData.totalRevenue) },
          { label: 'Success Rate', value: `${analyticsData.completionRate}%` },
        ],
        icon: 'check-circle',
        color: ACCENT_BLUE
      },
      servicePerformance: {
        title: 'Service Performance Analytics',
        mainValue: `${analyticsData.servicePerformance}%`,
        details: [
          { label: 'Completed appointments', value: appointmentAnalytics.completed.toString() },
          { label: 'Cancelled appointments', value: appointmentAnalytics.cancelled.toString() },
          { label: 'Resolved appointments', value: appointmentAnalytics.resolved.toString() },
          { label: 'Completion rate', value: `${analyticsData.servicePerformance}%` },
        ],
        icon: 'medical-bag',
        color: ACCENT_BLUE
      },
      clientPerformance: {
        title: 'Client Performance Overview',
        mainValue: `${appointmentAnalytics.repeatClientRate.toFixed(1)}%`,
        details: appointmentAnalytics.frequentClients.length ? [
          { 
            label: 'Top Client', 
            value: `${appointmentAnalytics.frequentClients[0].clientName} (${appointmentAnalytics.frequentClients[0].appointmentCount} visits)`
          },
          { 
            label: 'Second Most', 
            value: appointmentAnalytics.frequentClients[1]
              ? `${appointmentAnalytics.frequentClients[1].clientName} (${appointmentAnalytics.frequentClients[1].appointmentCount} visits)`
              : 'No other completed visits'
          },
          { 
            label: 'Third Most', 
            value: appointmentAnalytics.frequentClients[2]
              ? `${appointmentAnalytics.frequentClients[2].clientName} (${appointmentAnalytics.frequentClients[2].appointmentCount} visits)`
              : 'No other completed visits'
          },
          { label: 'Repeat client rate', value: `${appointmentAnalytics.repeatClientRate.toFixed(1)}%` },
          { label: 'Satisfaction score', value: appointmentAnalytics.satisfaction == null
            ? 'Not rated'
            : `${appointmentAnalytics.satisfaction.toFixed(1)} / 5` },
        ] : [
          { label: 'Completed clients', value: 'No completed visits in this period' },
          { label: 'Repeat client rate', value: `${appointmentAnalytics.repeatClientRate.toFixed(1)}%` },
          { label: 'Satisfaction score', value: appointmentAnalytics.satisfaction == null
            ? 'Not rated'
            : `${appointmentAnalytics.satisfaction.toFixed(1)} / 5` },
        ],
        icon: 'account-group',
        color: ACCENT_BLUE
      },
      orderPerformance: {
        title: 'Order Performance Overview',
        mainValue: appointmentAnalytics.total.toString(),
        details: [
          { label: 'Appointments in period', value: appointmentAnalytics.total.toString() },
          { label: 'Pending appointments', value: appointmentAnalytics.pending.toString() },
          { label: 'In progress / assigned', value: appointmentAnalytics.inProgress.toString() },
          { label: 'Completed appointments', value: appointmentAnalytics.completed.toString() },
          { label: 'Cancelled appointments', value: appointmentAnalytics.cancelled.toString() },
        ],
        icon: 'receipt-text',
        color: ACCENT_BLUE
      }
    };

    // Ensure no overlapping overlays are left open
    setCurrencyDropdownVisible(false);
    setTargetsModalVisible(false);

    setSelectedCardData(cardDetails[cardType] || null);
    setModalVisible(true);
  };

  const AnalyticsCards = () => (
    <View style={styles.analyticsPillsContainer}>
      <TouchableOpacity 
        style={styles.analyticsPill}
        onPress={() => handleCardPress('completed')}
        activeOpacity={0.8}
      >
        <View style={styles.analyticsPillContent}>
          <View style={styles.analyticsPillLeft}>
            <Text style={styles.analyticsPillLabel}>Completed</Text>
            <View style={styles.analyticsProgress}>
              <View style={[styles.progressBar, { width: `${analyticsData.completionRate}%` }]} />
            </View>
          </View>
          <View style={styles.analyticsPillRight}>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2196F3" />
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.analyticsPill}
        onPress={() => handleCardPress('servicePerformance')}
        activeOpacity={0.8}
      >
        <View style={styles.analyticsPillContent}>
          <View style={styles.analyticsPillLeft}>
            <Text style={styles.analyticsPillLabel}>Service Performance</Text>
            <View style={styles.analyticsProgress}>
              <View style={[styles.progressBar, { width: `${analyticsData.servicePerformance}%` }]} />
            </View>
          </View>
          <View style={styles.analyticsPillRight}>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2196F3" />
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.analyticsPill}
        onPress={() => handleCardPress('clientPerformance')}
        activeOpacity={0.8}
      >
        <View style={styles.analyticsPillContent}>
          <View style={styles.analyticsPillLeft}>
            <Text style={styles.analyticsPillLabel}>
              Client Performance
            </Text>
            <View style={styles.analyticsProgress}>
              <View style={[styles.progressBar, { width: `${analyticsData.clientPerformance}%` }]} />
            </View>
          </View>
          <View style={styles.analyticsPillRight}>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2196F3" />
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.analyticsPill}
        onPress={() => handleCardPress('orderPerformance')}
        activeOpacity={0.8}
      >
        <View style={styles.analyticsPillContent}>
          <View style={styles.analyticsPillLeft}>
            <Text style={styles.analyticsPillLabel}>Order Performance</Text>
          <View style={styles.analyticsProgress}>
              <View style={[styles.progressBar, {
                width: `${appointmentAnalytics.total > 0
                  ? (appointmentAnalytics.completed / appointmentAnalytics.total) * 100
                  : 0}%`,
              }]} />
            </View>
          </View>
          <View style={styles.analyticsPillRight}>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#2196F3" />
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );

  const ModernChart = ({ data }) => (
    <View style={styles.modernChartContainer}>
      <View style={styles.barChartContainer}>
        {data.map((item, index) => {
          const barHeight = (item.percentage / 100) * 140;
          
          return (
            <View key={index} style={styles.barColumn}>
              {/* Value on top */}
              <Text style={styles.barValue}>{formatCurrency(item.amount)}</Text>
              
              {/* Bar */}
              <View style={styles.barWrapper}>
                <LinearGradient
                  colors={['#667eea', '#764ba2']}
                  style={[styles.bar, { height: barHeight }]}
                />
              </View>
              
              {/* Label at bottom */}
              <Text style={styles.barLabel}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  const MetricCard = ({ title, value, subtitle, icon, gradient = COLORS.gradient1 }) => (
    <View style={styles.metricCard}>
      <LinearGradient colors={gradient} style={styles.metricGradient}>
        <View style={styles.metricContent}>
          <View style={styles.metricLeft}>
            <Text style={styles.metricTitle}>{title}</Text>
            <Text style={styles.metricValue}>{value}</Text>
            <Text style={styles.metricSubtitle}>{subtitle}</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );

  const ServiceItem = ({ item }) => (
    <View style={styles.modernServiceItem}>
      <View style={styles.serviceItemContent}>
        <View style={styles.serviceItemLeft}>
          <Text style={styles.serviceName}>{item.name}</Text>
          <Text style={styles.serviceBookings}>{item.bookings} bookings</Text>
        </View>
        <View style={styles.serviceItemRight}>
          <Text style={styles.serviceRevenue}>{formatCurrency(item.revenue)}</Text>
          <View style={styles.modernProgressContainer}>
            <View style={styles.progressBackground} />
            <LinearGradient
              colors={item.gradient}
              style={[styles.progressFill, { width: `${item.percentage}%` }]}
            />
          </View>
        </View>
      </View>
    </View>
  );

  const PaymentMethodItem = ({ item }) => (
    <View style={styles.modernPaymentItem}>
      <View style={styles.paymentItemContent}>
        <View style={styles.paymentItemLeft}>
          <Text style={styles.paymentMethodName}>{item.name}</Text>
          <Text style={styles.paymentMethodAmount}>{formatCurrency(item.amount)}</Text>
        </View>
        <View style={styles.paymentItemRight}>
          <Text style={styles.paymentMethodPercentage}>{item.percentage}%</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20, paddingBottom: 20 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminDashboard')}
          >
            <MaterialCommunityIcons name="arrow-left" size={26} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payment Analytics</Text>
          <View style={{ width: 44 }} />
        </View>
      </LinearGradient>

      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        <FilterTabs />
        <WalletHeader />
        
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Analytics Overview</Text>
        </View>
        
        <AnalyticsCards />



        <View style={styles.targetsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Performance Targets</Text>
            <TouchableOpacity 
              style={styles.manageButton}
              onPress={() => {
                setTargetsModalVisible(true);
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.manageButtonGradient}
              >
                <MaterialCommunityIcons name="cog" size={16} color={COLORS.white} />
                <Text style={styles.manageButtonText}>Manage</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
          
          <View style={styles.targetPillsContainer}>
            {(() => {
              const targets = getTargetsForPeriod(selectedPeriod);
              return [
                { 
                  id: 1, 
                  title: 'Revenue Goal', 
                  current: targets.revenue.current, 
                  target: targets.revenue.target, 
                  icon: 'currency-usd'
                },
                { 
                  id: 2, 
                  title: 'Completion Rate', 
                  current: targets.completion.current, 
                  target: targets.completion.target, 
                  icon: 'check-circle',
                  isPercentage: true
                },
                { 
                  id: 3, 
                  title: 'Client Satisfaction', 
                  current: targets.satisfaction.current, 
                  target: targets.satisfaction.target, 
                  icon: 'star',
                  maxValue: 5
                },
                { 
                  id: 4, 
                  title: 'New Acquisitions', 
                  current: targets.acquisitions.current, 
                  target: targets.acquisitions.target, 
                  icon: 'account-plus',
                }
              ];
            })().map((target) => {
              const progress = target.current == null
                ? 0
                : target.maxValue
                  ? (target.current / target.maxValue) * 100
                  : target.target > 0
                    ? (target.current / target.target) * 100
                    : 0;
              
              return (
                <View key={target.id} style={styles.targetPillContainer}>
                  <View style={styles.targetPill}>
                    <View style={styles.targetPillContent}>
                      <View style={styles.targetPillHeader}>
                        <Text style={styles.targetPillTitle}>
                          {target.title}
                        </Text>
                      </View>
                      
                      <Text style={styles.targetPillGoal}>
                        Now: {target.current == null
                          ? 'Not rated'
                          : target.isPercentage
                            ? `${target.current.toFixed(1)}%`
                            : target.maxValue
                              ? `${target.current.toFixed(1)}/5`
                              : target.title === 'Revenue Goal'
                                ? formatCurrencyWithConverter(target.current)
                                : target.current
                        }  ·  Goal: {target.isPercentage
                          ? `${target.target}%`
                          : target.maxValue 
                            ? `${target.target.toFixed(1)}/5`
                            : target.target > 1000 
                              ? formatCurrencyWithConverter(target.target)
                              : target.target
                        }
                      </Text>
                      
                      <View style={styles.targetPillProgressContainer}>
                        <View style={styles.targetPillProgressBg} />
                        <View 
                          style={[
                            styles.targetPillProgressFill, 
                            { 
                              width: `${Math.max(0, Math.min(progress, 100))}%`,
                              backgroundColor: '#2196F3' 
                            }
                          ]} 
                        />
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ height: 50 }} />
      </ScrollView>
      
      <TargetsManagementModal />
      <DetailsModal />
      
      {/* Currency Dropdown Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={currencyDropdownVisible}
        onRequestClose={() => setCurrencyDropdownVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setCurrencyDropdownVisible(false)}>
          <View style={styles.currencyModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.currencyDropdown}>
                {['JMD', 'USD', 'EUR', 'GBP', 'CAD'].map((currency) => (
                  <TouchableOpacity
                    key={currency}
                    style={[
                      styles.currencyOption,
                      selectedCurrency === currency && styles.currencyOptionSelected
                    ]}
                    onPress={() => {
                      setSelectedCurrency(currency);
                      setCurrencyDropdownVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.currencyCode,
                      selectedCurrency === currency && styles.currencyCodeSelected
                    ]}>
                      {currency}
                    </Text>
                    {selectedCurrency === currency && (
                      <MaterialCommunityIcons name="check" size={20} color="#667eea" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
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
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.white,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  // Wallet Header Styles
  walletContainer: {
    marginTop: 20,
    marginBottom: 24,
  },
  walletCard: {
    borderRadius: 20,
    padding: 24,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    borderWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    borderLeftColor: 'rgba(255,255,255,0.1)',
    borderRightColor: 'rgba(0,0,0,0.1)',
    borderBottomColor: 'rgba(0,0,0,0.2)',
    transform: [{ perspective: 1000 }, { rotateX: '2deg' }],
  },
  walletTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  walletLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 4,
  },
  walletAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.white,
  },
  walletBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  walletStatText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginLeft: 6,
  },
  walletIconContainer: {
    alignItems: 'center',
    position: 'relative',
  },
  periodIndicator: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  periodIndicatorText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.95)',
  },
  // Section Headers
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
  },
  viewAllButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  viewAllButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  viewAllText: {
    fontSize: 14,
    color: COLORS.white,
    marginRight: 4,
    fontWeight: '600',
  },
  // Analytics Grid
  analyticsPillsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  analyticsPill: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  analyticsPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  analyticsPillLeft: {
    flex: 1,
    marginRight: 16,
  },
  analyticsPillRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  analyticsPillLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 8,
  },
  analyticsPillValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  analyticsCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  analyticsProgress: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2196F3',
  },
  // Chart Section Styles
  chartSection: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    marginBottom: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 12,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
  },
  chartToggle: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 2,
  },
  chartToggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  chartToggleActive: {
    backgroundColor: COLORS.white,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  chartToggleText: {
    fontSize: 12,
    color: '#7f8c8d',
    fontWeight: '500',
  },
  chartToggleActiveText: {
    color: '#2c3e50',
  },
  chartContainer: {
    height: 200,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  chartGradientBg: {
    flex: 1,
    borderRadius: 16,
  },
  chartPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartPlaceholderText: {
    fontSize: 14,
    color: 'rgba(79, 172, 254, 0.6)',
    marginTop: 8,
    fontWeight: '500',
  },
  chartMetrics: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 20,
  },
  chartMetric: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chartDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  chartMetricText: {
    fontSize: 12,
    color: '#7f8c8d',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: screenWidth - 40,
    maxHeight: '80%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
  },
  detailsModalContent: {
    maxHeight: '100%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f2f6',
  },
  modalIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 15,
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#2c3e50',
  },
  modalMainValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  modalPercentText: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  modalBody: {
    padding: 20,
  },
  detailsModalBody: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
  },
  modalDetailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f8f9fa',
    gap: 12,
  },
  modalDetailLabel: {
    fontSize: 16,
    color: '#2c3e50',
    flex: 1,
    flexShrink: 1,
  },
  modalDetailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    flexShrink: 1,
    textAlign: 'right',
  },
  modalButton: {
    margin: 20,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  // Targets Section Styles
  targetsSection: {
    marginBottom: 24,
  },
  manageButton: {
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  manageButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  manageButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  targetPillsContainer: {
    gap: 12,
  },
  targetPillContainer: {
    width: '100%',
  },
  targetPill: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  targetPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  targetPillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  targetPillTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 0,
    color: '#111827',
  },
  targetPillValue: {
    fontSize: 16,
    fontWeight: '700',
    marginRight: 12,
    color: '#111827',
  },
  targetPillGoal: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginRight: 12,
  },
  targetPillProgressContainer: {
    width: 60,
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  targetPillProgressBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
  },
  targetPillProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
  },
  filterPill: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 20,
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
  },
  inactiveFilterPillText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  metricCard: {
    flex: 1,
    marginHorizontal: 5,
    borderRadius: 16,
    overflow: 'hidden',
  },
  metricGradient: {
    padding: 20,
  },
  metricContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLeft: {
    flex: 1,
  },
  metricTitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  metricSubtitle: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  metricIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  chartLegend: {
    flexDirection: 'row',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  modernChartContainer: {
    height: 200,
    paddingTop: 10,
  },
  barChartContainer: {
    flexDirection: 'row',
    height: 180,
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingBottom: 25,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
  },
  barValue: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  barWrapper: {
    width: '100%',
    maxWidth: 32,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    borderRadius: 6,
    minHeight: 20,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 20,
  },
  modernServiceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 16,
  },
  serviceIconGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  serviceItemContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serviceItemLeft: {
    flex: 1,
  },
  serviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  serviceBookings: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  serviceRevenue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 6,
  },
  serviceItemRight: {
    alignItems: 'flex-end',
    width: 100,
  },
  servicePercentage: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 6,
  },
  modernProgressContainer: {
    width: 80,
    height: 8,
    position: 'relative',
  },
  progressBackground: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.border,
    borderRadius: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  // Quick Stats Styles
  quickStatsCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 8,
  },
  quickStatItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  quickStatValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 6,
  },
  quickStatLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  // Top Card Styles
  topCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  topContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topInfo: {
    flex: 1,
  },
  topName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  topSubtext: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  topStats: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  topStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  topStatText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text,
  },
  topProgressBar: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 16,
  },
  topProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  topProgressText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  modernPaymentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 16,
  },
  paymentIconGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  paymentItemContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentItemLeft: {
    flex: 1,
  },
  paymentMethodName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  paymentMethodAmount: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  paymentItemRight: {
    alignItems: 'flex-end',
  },
  paymentMethodPercentage: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  bottomPadding: {
    height: 40,
  },
  targetManageItem: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  targetManageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  targetManageTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 12,
  },
  targetManageValues: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  targetManageValue: {
    flex: 1,
    alignItems: 'center',
  },
  targetManageLabel: {
    fontSize: 12,
    color: '#2c3e50',
    marginBottom: 4,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  targetManageNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  targetEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  targetProgressContainer: {
    marginTop: 8,
  },
  targetProgressBar: {
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    marginBottom: 8,
  },
  targetProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  targetProgressText: {
    fontSize: 12,
    color: '#2c3e50',
    textAlign: 'center',
  },
  currencyPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 8,
  },
  currencyPickerText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  currencyModalOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 275,
    paddingRight: 7,
  },
  currencyDropdown: {
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    minWidth: 120,
    overflow: 'hidden',
  },
  currencyOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  currencyOptionSelected: {
    backgroundColor: '#f8f9fa',
  },
  currencyCode: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  currencyCodeSelected: {
    fontWeight: '600',
    color: '#667eea',
  },
  modalActions: {
    flexDirection: 'row',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    backgroundColor: '#fff',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    justifyContent: 'space-between',
  },
  modalSecondaryButton: {
    width: '48%',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryButtonContainer: {
    width: '48%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalPrimaryButtonGradient: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryButtonText: {
    color: '#2c3e50',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PaymentAnalyticsScreen;
