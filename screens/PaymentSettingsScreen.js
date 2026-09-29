import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, GRADIENTS } from '../constants';
import InvoiceService from '../services/InvoiceService';
import { db } from '../config/firebase';
import SharedSettingsService from '../services/SharedSettingsService';

const PaymentSettingsScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState('general'); // 'general', 'payroll', 'company'

  // State for settings
  const [paymentRemindersEnabled, setPaymentRemindersEnabled] = useState(true);

  // General invoice/payment defaults
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState(7);
  const [defaultInvoiceCurrency, setDefaultInvoiceCurrency] = useState('JMD');
  const [reminderDaysBeforeDue, setReminderDaysBeforeDue] = useState(3);
  const [reminderDaysAfterDue, setReminderDaysAfterDue] = useState(1);
  const [depositRequired, setDepositRequired] = useState(true);
  const [depositPercent, setDepositPercent] = useState(20);

  // Invoice counter/status
  const [invoiceCounterStatus, setInvoiceCounterStatus] = useState(null);
  const [invoiceCounterModalVisible, setInvoiceCounterModalVisible] = useState(false);
  const [nextInvoiceNumberInput, setNextInvoiceNumberInput] = useState('');
  
  // Inline pickers
  const [termsPickerOpen, setTermsPickerOpen] = useState(false);
  const [reminderPickerTarget, setReminderPickerTarget] = useState(null); // 'before' | 'after'

  // Inline currency picker
  const [currencyPickerTarget, setCurrencyPickerTarget] = useState(null);
  
  // Payroll settings (used to calculate payslip amounts)
  const [payrollSettings, setPayrollSettings] = useState({
    defaultPayType: 'hourly',
    defaultHourlyRate: 625,
    defaultSalaryAmount: 180000,
    shiftRates: {
      eightHours: 5000,
      twelveHours: 7000,
    },
    holidayMultiplier: 2,
    allowances: { transport: 0, meal: 0, phone: 0 },
  });

  // Company details for invoices
  const [companyDetails, setCompanyDetails] = useState({
    companyName: '876Nurses Home Care Services Limited',
    fullName: 'NURSING SERVICES AND MORE',
    address: 'Kingston, Jamaica',
    phone: '876-288-7304',
    email: 'care@nursingcareja.com',
    taxId: '',
    website: '',
  });

  // Payment information for invoices
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

  // Load shared company, payment, and payroll settings on mount.
  useEffect(() => {
    loadCompanyDetails();
    loadPaymentInfo();
    loadPayrollSettings();
    loadGeneralSettings();
    refreshInvoiceCounterStatus();
  }, []);

  const loadGeneralSettings = async () => {
    try {
      const parsed = (await SharedSettingsService.read('general')) || {};

      if (typeof parsed?.paymentRemindersEnabled === 'boolean') {
        setPaymentRemindersEnabled(parsed.paymentRemindersEnabled);
      }
      if (Number.isFinite(parsed?.defaultPaymentTermsDays)) {
        setDefaultPaymentTermsDays(Number(parsed.defaultPaymentTermsDays));
      }
      if (typeof parsed?.defaultInvoiceCurrency === 'string' && parsed.defaultInvoiceCurrency.trim()) {
        setDefaultInvoiceCurrency(parsed.defaultInvoiceCurrency.trim());
      }
      if (Number.isFinite(parsed?.reminderDaysBeforeDue)) {
        setReminderDaysBeforeDue(Number(parsed.reminderDaysBeforeDue));
      }
      if (Number.isFinite(parsed?.reminderDaysAfterDue)) {
        setReminderDaysAfterDue(Number(parsed.reminderDaysAfterDue));
      }
      if (typeof parsed?.depositRequired === 'boolean') {
        setDepositRequired(parsed.depositRequired);
      }
      if (Number.isFinite(parsed?.depositPercent)) {
        setDepositPercent(Number(parsed.depositPercent));
      }

      // Migrate the previous device-only booking policy once so guest bookings
      // on other devices can use the admin's saved setting too.
      const policyRef = doc(db, 'paymentSettings', 'bookingPolicy');
      const policySnapshot = await getDoc(policyRef);
      if (policySnapshot.exists()) {
        const policy = policySnapshot.data();
        if (typeof policy.depositRequired === 'boolean') setDepositRequired(policy.depositRequired);
        if (Number.isFinite(policy.depositPercent)) setDepositPercent(Number(policy.depositPercent));
      } else if (
        typeof parsed.depositRequired === 'boolean' || Number.isFinite(parsed.depositPercent)
      ) {
        await setDoc(policyRef, {
          depositRequired: typeof parsed.depositRequired === 'boolean' ? parsed.depositRequired : true,
          depositPercent: Number.isFinite(parsed.depositPercent) ? Number(parsed.depositPercent) : 20,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Error loading general payment settings:', error);
    }
  };

  const saveGeneralSettings = async () => {
    try {
      const payload = {
        paymentRemindersEnabled,
        defaultPaymentTermsDays,
        defaultInvoiceCurrency,
        reminderDaysBeforeDue,
        reminderDaysAfterDue,
        depositRequired,
        depositPercent,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'paymentSettings', 'bookingPolicy'), {
        depositRequired,
        depositPercent,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await SharedSettingsService.save('general', payload);
      Alert.alert('Success', 'General payment settings saved successfully');
    } catch (error) {
      console.error('Error saving general payment settings:', error);
      Alert.alert('Error', 'Failed to save general payment settings');
    }
  };

  const refreshInvoiceCounterStatus = async () => {
    try {
      const status = await InvoiceService.getInvoiceCounterStatus();
      setInvoiceCounterStatus(status);
    } catch (error) {
      console.error('Error loading invoice counter status:', error);
    }
  };

  const formatTermsLabel = (days) => {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) return 'Custom';
    return `Net ${n}`;
  };

  const formatDaysLabel = (days) => {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0) return '0 days';
    return `${n} day${n === 1 ? '' : 's'}`;
  };

  const reminderDayOptions = Array.from({ length: 15 }, (_, i) => i);
  const currencyOptions = ['JMD', 'USD', 'CAD', 'GBP', 'EUR'];
  const termsOptions = [1, 3, 7, 14, 30];

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

  const savePaymentInfo = async () => {
    try {
      await SharedSettingsService.save('paymentInfo', paymentInfo);
      Alert.alert('Success', 'Payment information saved successfully');
    } catch (error) {
      console.error('Error saving payment info:', error);
      Alert.alert('Error', 'Failed to save payment information');
    }
  };

  // Load shared company details.

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

  const saveCompanyDetails = async () => {
    try {
      await SharedSettingsService.save('company', companyDetails);
      Alert.alert('Success', 'Company details saved successfully');
    } catch (error) {
      console.error('Error saving company details:', error);
      Alert.alert('Error', 'Failed to save company details');
    }
  };

  const saveSettings = () => {
    saveGeneralSettings();
  };

  const loadPayrollSettings = async () => {
    try {
      const parsed = await SharedSettingsService.read('payroll');
      if (parsed) {
        // Merge with defaults to ensure all keys exist
        setPayrollSettings((prev) => ({
          ...prev,
          ...parsed,
          shiftRates: { ...prev.shiftRates, ...(parsed.shiftRates || {}) },
          allowances: { ...prev.allowances, ...(parsed.allowances || {}) },
          deductions: { ...prev.deductions, ...(parsed.deductions || {}) },
        }));
      }
    } catch (error) {
      console.error('Error loading payroll settings:', error);
    }
  };

  const savePayrollSettings = async () => {
    try {
      await SharedSettingsService.save('payroll', payrollSettings);
      Alert.alert('Success', 'Payroll settings saved successfully');
    } catch (error) {
      console.error('Error saving payroll settings:', error);
      Alert.alert('Error', 'Failed to save payroll settings');
    }
  };

  const renderSettingRow = (title, subtitle, value, onValueChange, type = 'switch', linkIconName = 'chevron-right') => (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {type === 'switch' ? (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: COLORS.border, true: GRADIENTS.header?.[0] || COLORS.primary }}
          thumbColor={value ? COLORS.white : COLORS.textMuted}
        />
      ) : (
        <TouchableOpacity onPress={onValueChange} style={styles.settingLink}>
          <Text style={styles.settingValue} numberOfLines={1}>{value}</Text>
          <MaterialCommunityIcons name={linkIconName} size={20} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderSettingInputRow = (title, subtitle, value, onChangeText) => (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      <TextInput
        style={styles.settingRightInput}
        value={String(value)}
        onChangeText={onChangeText}
        placeholderTextColor={COLORS.textMuted}
        keyboardType="numeric"
      />
    </View>
  );



  const renderCompanyField = (key, label, value, placeholder, keyboardType = 'default') => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={styles.textInput}
        value={value}
        onChangeText={(text) => setCompanyDetails(prev => ({ ...prev, [key]: text }))}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        keyboardType={keyboardType}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <LinearGradient 
        colors={GRADIENTS.header} 
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payment Settings</Text>
          <TouchableOpacity
            onPress={() => {
              if (viewMode === 'company') {
                saveCompanyDetails();
                savePaymentInfo();
              } else if (viewMode === 'payroll') {
                savePayrollSettings();
              } else {
                saveSettings();
              }
            }}
            style={styles.saveButton}
          >
            <MaterialCommunityIcons name="check" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* View Mode Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={styles.tab}
          onPress={() => setViewMode('general')}
        >
          {viewMode === 'general' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.tabGradient}
            >
              <Text style={styles.tabText}>General</Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveTab}>
              <Text style={styles.inactiveTabText}>General</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.tab}
          onPress={() => setViewMode('payroll')}
        >
          {viewMode === 'payroll' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.tabGradient}
            >
              <Text style={styles.tabText}>Payroll</Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveTab}>
              <Text style={styles.inactiveTabText}>Payroll</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.tab}
          onPress={() => setViewMode('company')}
        >
          {viewMode === 'company' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.tabGradient}
            >
              <Text style={styles.tabText}>Invoice</Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveTab}>
              <Text style={styles.inactiveTabText}>Invoice</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Conditional Content Based on View Mode */}
        {viewMode === 'general' && (
          <>
            {/* General Settings Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>General Settings</Text>
              {renderSettingRow(
                'Payment Reminders',
                'Send notifications for upcoming payments',
                paymentRemindersEnabled,
                setPaymentRemindersEnabled
              )}

              {paymentRemindersEnabled && (
                <>
                  {renderSettingRow(
                    'Reminder Before Due',
                    'How many days before the due date',
                    formatDaysLabel(reminderDaysBeforeDue),
                    () => {
                      setCurrencyPickerTarget(null);
                      setTermsPickerOpen(false);
                      setReminderPickerTarget((prev) => (prev === 'before' ? null : 'before'));
                    },
                    'link',
                    'chevron-down'
                  )}
                  {reminderPickerTarget === 'before' && (
                    <View style={styles.inlineDropdownContainer}>
                      <ScrollView style={styles.inlineDropdownScroll} showsVerticalScrollIndicator={false}>
                        {reminderDayOptions.map((days) => {
                          const selected = reminderDaysBeforeDue === days;
                          return (
                            <TouchableOpacity
                              key={`before-${days}`}
                              style={styles.inlineDropdownOption}
                              onPress={() => {
                                setReminderDaysBeforeDue(days);
                                setReminderPickerTarget(null);
                              }}
                            >
                              <Text
                                style={[
                                  styles.inlineDropdownText,
                                  selected ? styles.inlineDropdownTextSelected : null,
                                ]}
                              >
                                {formatDaysLabel(days)}
                              </Text>
                              {selected && (
                                <MaterialCommunityIcons name="check" size={18} color={COLORS.primary} />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}

                  {renderSettingRow(
                    'Reminder After Due',
                    'How many days after the due date',
                    formatDaysLabel(reminderDaysAfterDue),
                    () => {
                      setCurrencyPickerTarget(null);
                      setTermsPickerOpen(false);
                      setReminderPickerTarget((prev) => (prev === 'after' ? null : 'after'));
                    },
                    'link',
                    'chevron-down'
                  )}
                  {reminderPickerTarget === 'after' && (
                    <View style={styles.inlineDropdownContainer}>
                      <ScrollView style={styles.inlineDropdownScroll} showsVerticalScrollIndicator={false}>
                        {reminderDayOptions.map((days) => {
                          const selected = reminderDaysAfterDue === days;
                          return (
                            <TouchableOpacity
                              key={`after-${days}`}
                              style={styles.inlineDropdownOption}
                              onPress={() => {
                                setReminderDaysAfterDue(days);
                                setReminderPickerTarget(null);
                              }}
                            >
                              <Text
                                style={[
                                  styles.inlineDropdownText,
                                  selected ? styles.inlineDropdownTextSelected : null,
                                ]}
                              >
                                {formatDaysLabel(days)}
                              </Text>
                              {selected && (
                                <MaterialCommunityIcons name="check" size={18} color={COLORS.primary} />
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                </>
              )}

              {renderSettingRow(
                'Default Payment Terms',
                'Used when due date is not provided',
                formatTermsLabel(defaultPaymentTermsDays),
                () => {
                  setReminderPickerTarget(null);
                  setCurrencyPickerTarget(null);
                  setTermsPickerOpen((prev) => !prev);
                },
                'link',
                'chevron-down'
              )}

              {termsPickerOpen && (
                <View style={styles.inlineDropdownContainer}>
                  <ScrollView style={styles.inlineDropdownScroll} showsVerticalScrollIndicator={false}>
                    {termsOptions.map((days) => {
                      const selected = defaultPaymentTermsDays === days;
                      return (
                        <TouchableOpacity
                          key={`terms-${days}`}
                          style={styles.inlineDropdownOption}
                          onPress={() => {
                            setDefaultPaymentTermsDays(days);
                            setTermsPickerOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.inlineDropdownText,
                              selected ? styles.inlineDropdownTextSelected : null,
                            ]}
                          >
                            {formatTermsLabel(days)}
                          </Text>
                          {selected && (
                            <MaterialCommunityIcons name="check" size={18} color={COLORS.primary} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {renderSettingRow(
                'Default Currency',
                'Used as the default for new invoices',
                defaultInvoiceCurrency,
                () => {
                  setReminderPickerTarget(null);
                  setTermsPickerOpen(false);
                  setCurrencyPickerTarget((prev) => (prev === 'default' ? null : 'default'));
                },
                'link',
                'chevron-down'
              )}

              {currencyPickerTarget === 'default' && (
                <View style={styles.inlineDropdownContainer}>
                  <ScrollView style={styles.inlineDropdownScroll} showsVerticalScrollIndicator={false}>
                    {currencyOptions.map((currency) => {
                      const selected = defaultInvoiceCurrency === currency;
                      return (
                        <TouchableOpacity
                          key={`default-currency-${currency}`}
                          style={styles.inlineDropdownOption}
                          onPress={() => {
                            setDefaultInvoiceCurrency(currency);
                            setCurrencyPickerTarget(null);
                          }}
                        >
                          <Text
                            style={[
                              styles.inlineDropdownText,
                              selected ? styles.inlineDropdownTextSelected : null,
                            ]}
                          >
                            {currency}
                          </Text>
                          {selected && (
                            <MaterialCommunityIcons name="check" size={18} color={COLORS.primary} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {renderSettingRow(
                'Require Deposit',
                'Apply a deposit requirement at booking',
                depositRequired,
                setDepositRequired
              )}

              {depositRequired && (
                renderSettingInputRow(
                  'Default Deposit (%)',
                  'Used to calculate the booking deposit',
                  depositPercent,
                  (text) => {
                    const n = Number(text);
                    if (!Number.isFinite(n)) {
                      setDepositPercent(0);
                      return;
                    }
                    setDepositPercent(Math.max(0, Math.min(100, n)));
                  }
                )
              )}

              <View style={styles.sectionDivider} />

              {renderSettingRow(
                'Next Invoice ID',
                invoiceCounterStatus?.lastInvoiceId ? `Last: ${invoiceCounterStatus.lastInvoiceId}` : ' ',
                invoiceCounterStatus?.nextInvoiceId || 'Loading…',
                () => setInvoiceCounterModalVisible(true),
                'link'
              )}
            </View>
          </>
        )}
        {viewMode === 'payroll' && (
          <>
            {/* Payroll Settings Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Payroll Settings</Text>
              <Text style={styles.sectionSubtitle}>These settings are used to calculate payslip amounts</Text>

              {/* Pay Type */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Default Pay Type</Text>
                <View style={styles.textInput}>
                  <Text style={styles.inputText}>HOURLY</Text>
                </View>
              </View>

              {/* Shift Rates */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>8 Hour Shift Rate (J$)</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(payrollSettings.shiftRates?.eightHours ?? 5000)}
                  onChangeText={(text) => setPayrollSettings(prev => ({
                    ...prev,
                    shiftRates: { ...prev.shiftRates, eightHours: Number(text) || 0 }
                  }))}
                  placeholder="Enter 8-hour shift rate"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>12 Hour Shift Rate (J$)</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(payrollSettings.shiftRates?.twelveHours ?? 7000)}
                  onChangeText={(text) => setPayrollSettings(prev => ({
                    ...prev,
                    shiftRates: { ...prev.shiftRates, twelveHours: Number(text) || 0 }
                  }))}
                  placeholder="Enter 12-hour shift rate"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                />
              </View>

              {/* Holiday */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Holiday Pay Multiplier</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(payrollSettings.holidayMultiplier ?? 2)}
                  onChangeText={(text) => setPayrollSettings(prev => ({
                    ...prev,
                    holidayMultiplier: Number(text) || 1
                  }))}
                  placeholder="e.g., 2"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                />
              </View>

              {/* Hourly Rate (derived) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Default Hourly Rate (J$)</Text>
                <TextInput
                  style={styles.textInput}
                  value={String(payrollSettings.defaultHourlyRate)}
                  onChangeText={(text) => setPayrollSettings(prev => ({ ...prev, defaultHourlyRate: Number(text) || 0 }))}
                  placeholder="Enter hourly rate"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="numeric"
                />
              </View>

            </View>
          </>
        )}

        {viewMode === 'company' && (
          <>
            {/* Company Details for Invoices */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Company Information</Text>
              <Text style={styles.sectionSubtitle}>This information will appear on all invoices</Text>
              
              {renderCompanyField('companyName', 'Company Name', companyDetails.companyName, 'Enter company name')}
              {renderCompanyField('fullName', 'Full Business Name', companyDetails.fullName, 'Enter full business name')}
              {renderCompanyField('address', 'Business Address', companyDetails.address, 'Enter business address')}
              {renderCompanyField('phone', 'Phone Number', companyDetails.phone, 'Enter phone number', 'phone-pad')}
              {renderCompanyField('email', 'Email Address', companyDetails.email, 'Enter email address', 'email-address')}
              {renderCompanyField('taxId', 'Tax ID / Registration Number', companyDetails.taxId, 'Enter tax ID or registration number')}
              {renderCompanyField('website', 'Website (Optional)', companyDetails.website, 'Enter website URL')}
            </View>

            {/* Payment Information Section */}
            <View style={styles.section}>
              <View>
                <Text style={styles.sectionTitle}>Bank Account Information</Text>
                <Text style={styles.sectionSubtitle}>Bank accounts will appear on invoices</Text>
              </View>
              
              {paymentInfo.bankAccounts.map((account, index) => (
                <View key={account.id} style={styles.bankAccountCard}>
                  <View style={styles.bankAccountHeader}>
                    <Text style={styles.bankAccountTitle}>Bank Account {index + 1}</Text>
                    {paymentInfo.bankAccounts.length > 1 && (
                      <TouchableOpacity 
                        onPress={() => {
                          setPaymentInfo({
                            ...paymentInfo,
                            bankAccounts: paymentInfo.bankAccounts.filter(a => a.id !== account.id)
                          });
                        }}
                      >
                        <MaterialCommunityIcons name="delete" size={20} color={COLORS.error} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Bank Name */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Recipient's Bank</Text>
                    <TextInput
                      style={styles.textInput}
                      value={account.bankName}
                      onChangeText={(text) => {
                        const updated = [...paymentInfo.bankAccounts];
                        updated[index].bankName = text;
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                      placeholder="Enter bank name"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  {/* Recipient Type */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Recipient Type</Text>
                    <TextInput
                      style={styles.textInput}
                      value={account.recipientType}
                      onChangeText={(text) => {
                        const updated = [...paymentInfo.bankAccounts];
                        updated[index].recipientType = text;
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                      placeholder="e.g., Individual, Business"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  {/* Account Numbers with Currency */}
                  <View style={styles.accountNumbersContainer}>
                    {account.accountNumbers.map((accNum, accIndex) => (
                      <View key={accNum.id} style={styles.accountNumberRow}>
                        <View style={[styles.inputGroup, { flex: 2, marginBottom: 0 }]}>
                          <Text style={styles.inputLabel}>Bank Account Number {accIndex + 1}</Text>
                          <TextInput
                            style={styles.textInput}
                            value={accNum.number}
                            onChangeText={(text) => {
                              const updated = [...paymentInfo.bankAccounts];
                              updated[index].accountNumbers[accIndex].number = text;
                              setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                            }}
                            placeholder="Enter account number"
                            placeholderTextColor={COLORS.textMuted}
                            keyboardType="numeric"
                          />
                        </View>
                        <View style={[styles.inputGroup, { flex: 1, marginBottom: 0 }]}>
                          <Text style={styles.inputLabel}>Currency</Text>
                          <TouchableOpacity 
                            style={[styles.textInput, styles.textInputDropdown]}
                            onPress={() => {
                              setReminderPickerTarget(null);
                              setPaymentInfo({ 
                                ...paymentInfo, 
                                selectedAccountIndex: index,
                                selectedAccountNumberIndex: accIndex 
                              });
                              setCurrencyPickerTarget((prev) => {
                                const next = { type: 'bankAccount', accountIndex: index, accountNumberIndex: accIndex };
                                if (
                                  prev &&
                                  typeof prev === 'object' &&
                                  prev.type === next.type &&
                                  prev.accountIndex === next.accountIndex &&
                                  prev.accountNumberIndex === next.accountNumberIndex
                                ) {
                                  return null;
                                }
                                return next;
                              });
                            }}
                          >
                            <Text style={styles.inputText}>{accNum.currency}</Text>
                            <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
                          </TouchableOpacity>
                        </View>
                        {account.accountNumbers.length > 1 && (
                          <TouchableOpacity 
                            style={styles.deleteAccountNumberButton}
                            onPress={() => {
                              const updated = [...paymentInfo.bankAccounts];
                              updated[index].accountNumbers = updated[index].accountNumbers.filter(a => a.id !== accNum.id);
                              setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                            }}
                          >

                          {currencyPickerTarget && typeof currencyPickerTarget === 'object' &&
                            currencyPickerTarget.type === 'bankAccount' &&
                            currencyPickerTarget.accountIndex === index &&
                            currencyPickerTarget.accountNumberIndex === accIndex && (
                              <View style={styles.inlineDropdownContainerCompact}>
                                <ScrollView style={styles.inlineDropdownScroll} showsVerticalScrollIndicator={false}>
                                  {currencyOptions.map((currency) => {
                                    const selected = accNum.currency === currency;
                                    return (
                                      <TouchableOpacity
                                        key={`bank-${index}-${accIndex}-${currency}`}
                                        style={styles.inlineDropdownOption}
                                        onPress={() => {
                                          const updated = [...paymentInfo.bankAccounts];
                                          updated[index].accountNumbers[accIndex].currency = currency;
                                          setPaymentInfo({
                                            ...paymentInfo,
                                            bankAccounts: updated,
                                          });
                                          setCurrencyPickerTarget(null);
                                        }}
                                      >
                                        <Text
                                          style={[
                                            styles.inlineDropdownText,
                                            selected ? styles.inlineDropdownTextSelected : null,
                                          ]}
                                        >
                                          {currency}
                                        </Text>
                                        {selected && (
                                          <MaterialCommunityIcons name="check" size={18} color={COLORS.primary} />
                                        )}
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                            )}
                            <MaterialCommunityIcons name="close-circle" size={20} color={COLORS.error} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    
                    {/* Add Account Number Button */}
                    <TouchableOpacity 
                      style={styles.addAccountButton}
                      onPress={() => {
                        const updated = [...paymentInfo.bankAccounts];
                        const newAccNumId = (updated[index].accountNumbers.length + 1).toString();
                        updated[index].accountNumbers.push({ 
                          id: newAccNumId, 
                          number: '', 
                          currency: defaultInvoiceCurrency 
                        });
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                    >
                      <MaterialCommunityIcons name="plus" size={24} color={COLORS.primary} />
                    </TouchableOpacity>
                  </View>

                  {/* Payee */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Payee</Text>
                    <TextInput
                      style={styles.textInput}
                      value={account.payee}
                      onChangeText={(text) => {
                        const updated = [...paymentInfo.bankAccounts];
                        updated[index].payee = text;
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                      placeholder="Enter payee name"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  {/* Branch */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Branch</Text>
                    <TextInput
                      style={styles.textInput}
                      value={account.branch}
                      onChangeText={(text) => {
                        const updated = [...paymentInfo.bankAccounts];
                        updated[index].branch = text;
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                      placeholder="Enter branch name"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  {/* Swift Code */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Bank Swift Code</Text>
                    <TextInput
                      style={styles.textInput}
                      value={account.swiftCode}
                      onChangeText={(text) => {
                        const updated = [...paymentInfo.bankAccounts];
                        updated[index].swiftCode = text;
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                      placeholder="Enter swift code"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  {/* Sort Code */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Bank Sort Code</Text>
                    <TextInput
                      style={styles.textInput}
                      value={account.sortCode}
                      onChangeText={(text) => {
                        const updated = [...paymentInfo.bankAccounts];
                        updated[index].sortCode = text;
                        setPaymentInfo({ ...paymentInfo, bankAccounts: updated });
                      }}
                      placeholder="Enter sort code"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                </View>
              ))}

              {/* Cash and POS Options */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Other Payment Methods</Text>
                {renderSettingRow(
                  'Cash Accepted',
                  'Cash accepted for home visits',
                  paymentInfo.cashAccepted,
                  (value) => setPaymentInfo({ ...paymentInfo, cashAccepted: value })
                )}
                {renderSettingRow(
                  'POS Machine Available',
                  'Accept card payments via POS machine',
                  paymentInfo.posAvailable,
                  (value) => setPaymentInfo({ ...paymentInfo, posAvailable: value })
                )}
              </View>
            </View>
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Invoice Counter Modal */}
      <Modal
        visible={invoiceCounterModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setInvoiceCounterModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.centeredOverlay}
          activeOpacity={1}
          onPress={() => setInvoiceCounterModalVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={styles.smallModalCard}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, styles.modalTitleNoMargin]}>Set Next Invoice Number</Text>
              <TouchableOpacity
                onPress={() => setInvoiceCounterModalVisible(false)}
                style={styles.modalCloseButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelperText}>
              Current next: {invoiceCounterStatus?.nextInvoiceId || 'Loading…'}
            </Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Next Invoice Number (digits only)</Text>
              <TextInput
                style={styles.textInput}
                value={nextInvoiceNumberInput}
                onChangeText={setNextInvoiceNumberInput}
                placeholder="e.g., 123"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
              />
            </View>
            <TouchableOpacity
              style={styles.primaryActionButton}
              onPress={async () => {
                const nextNum = Number(nextInvoiceNumberInput);
                if (!Number.isFinite(nextNum) || nextNum <= 0) {
                  Alert.alert('Invalid Number', 'Please enter a valid next invoice number.');
                  return;
                }
                const lastUsed = Math.max(0, Math.floor(nextNum) - 1);
                const result = await InvoiceService.initializeInvoiceCounter(`NUR-INV-${String(lastUsed).padStart(4, '0')}`);
                if (!result?.success) {
                  Alert.alert('Error', result?.error || 'Failed to update invoice counter');
                  return;
                }
                setInvoiceCounterModalVisible(false);
                setNextInvoiceNumberInput('');
                await refreshInvoiceCounterStatus();
                Alert.alert('Success', result.message);
              }}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.primaryActionGradient}
              >
                <Text style={styles.primaryActionText}>Update</Text>
              </LinearGradient>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>


    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    flex: 1,
    textAlign: 'center',
  },
  saveButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    margin: 20,
    marginBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 16,
    lineHeight: 20,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
  },
  tabGradient: {
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
  inactiveTab: {
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
  tabText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  inactiveTabText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  settingValue: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  settingRightInput: {
    width: 84,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.white,
  },
  settingLink: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginTop: 8,
    marginBottom: 8,
  },
  modalHelperText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 6,
    marginBottom: 14,
  },
  smallModalCard: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 8,
  },
  primaryActionButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 6,
  },
  primaryActionGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  primaryActionText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 15,
  },
  centeredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  inlineDropdownContainer: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    marginTop: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  inlineDropdownContainerCompact: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    marginTop: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  inlineDropdownScroll: {
    maxHeight: 210,
  },
  inlineDropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  inlineDropdownText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
  },
  inlineDropdownTextSelected: {
    color: COLORS.primary,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  inputText: {
    fontSize: 16,
    color: COLORS.text,
    flex: 1,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.white,
  },
  textInputDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  dropdownText: {
    fontSize: 16,
    color: COLORS.text,
  },
  dropdownHelper: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  securityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  securityInfo: {
    flex: 1,
    marginLeft: 12,
  },
  securityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  securitySubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  bottomPadding: {
    height: 20,
  },
  bankAccountCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bankAccountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  bankAccountTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  accountNumberRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  accountNumbersContainer: {
    marginBottom: 16,
  },
  deleteAccountNumberButton: {
    padding: 8,
    marginBottom: 8,
  },
  addAccountButton: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  dropdownInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
  },
  paymentInfoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  paymentInfoInputs: {
    flex: 1,
    gap: 12,
  },
  deletePaymentButton: {
    padding: 8,
    marginTop: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '50%',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 20,
  },
  modalTitleNoMargin: {
    marginBottom: 0,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalOptionText: {
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
  },
  modalOptionTextSelected: {
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },

  invoiceInitButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  invoiceInitButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
});


export default PaymentSettingsScreen;
