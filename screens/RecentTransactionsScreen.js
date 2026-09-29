import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { isJamaicanHoliday, getHolidayName } from '../constants/JamaicanHolidays';
import { useAppointments } from '../context/AppointmentContext';
import { useShifts } from '../context/ShiftContext';
import { useNurses } from '../context/NurseContext';
import TouchableWeb from '../components/TouchableWeb';
import ApiService from '../services/ApiService';
import PayslipGenerator from '../services/PayslipGenerator';
import PayslipComponent from '../components/PayslipComponent';
import SharedSettingsService from '../services/SharedSettingsService';

const getEmptyReviewForm = () => ({
  status: 'pending',
  regularHours: '',
  overtimeHours: '',
  basePay: '',
  manualAdjustment: '0',
  allowances: { transport: '0', meal: '0', phone: '0', other: '0' },
  deductions: {},
  notes: '',
});

const sanitizeNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (!value && value !== 0) {
    return 0;
  }
  const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatCurrencyValue = (amount) => {
  const numeric = sanitizeNumber(amount);
  return `J$${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDisplayDate = (value) => {
  if (!value) {
    return 'Pending';
  }
  
  // Handle "Feb 19, 2026" format from BookScreen
  if (typeof value === 'string') {
    const match = value.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
    if (match) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = monthNames.findIndex(m => m === match[1]);
      if (monthIndex !== -1) {
        const parsed = new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
        if (!isNaN(parsed.getTime())) {
          return parsed.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
        }
      }
    }
  }
  
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const sumObjectValues = (object = {}) => {
  return Object.values(object || {}).reduce((sum, value) => sum + sanitizeNumber(value), 0);
};

const parseWorkedHours = (record) => {
  const directHours = sanitizeNumber(record?.hoursWorked ?? record?.totalHours ?? record?.workedHours);
  if (directHours > 0) return directHours;

  const clockIn = record?.actualStartTime || record?.clockInTime || record?.startTime;
  const clockOut = record?.actualEndTime || record?.clockOutTime || record?.endTime;
  if (clockIn && clockOut) {
    const elapsed = new Date(clockOut).getTime() - new Date(clockIn).getTime();
    if (Number.isFinite(elapsed) && elapsed > 0) return elapsed / 3600000;
  }

  const duration = record?.duration ?? record?.estimatedDuration;
  if (typeof duration === 'number' && duration > 0) return duration / 60;
  if (typeof duration === 'string') {
    const match = duration.match(/([\d.]+)\s*(hours?|hrs?|minutes?|mins?)?/i);
    if (match) {
      const amount = Number(match[1]);
      return /min/i.test(match[2] || '') ? amount / 60 : amount;
    }
  }
  return 0;
};

const toPayrollDateKey = (value) => {
  if (!value) return '';
  const text = String(value);
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRecordId = (value) => String(typeof value === 'object'
  ? (value.id || value._id || value.uid || '')
  : (value || ''));

const FILTER_OPTIONS = [
  { key: 'available', label: 'Available' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

const FILTER_LABELS = FILTER_OPTIONS.reduce((map, option) => {
  map[option.key] = option.label;
  return map;
}, {});

const RecentTransactionsScreen = ({ navigation }) => {
  const handleClearTransactionData = async () => {
    Alert.alert(
      'Clear Transaction Data',
      'This will clear all payslips, transactions, and payment records. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const keysToClear = [
                'payslips',
                'generatedPayslips',
                'nursePayslips',
                'recentTransactions',
                'transactions',
                'staffTransactions',
                'staffPayments',
                'paymentRecords',
                'adminPayrollSettings',
                'paymentMethods'
              ];
              await AsyncStorage.multiRemove(keysToClear);
              await AsyncStorage.setItem('transactionsCleared', 'true');
              setTransactionsCleared(true);
              setAdminStaff([]);
              setAdminPayrollSettings(null);
              setPaymentMethods([]);
              setGeneratedPayslips([]);
              Alert.alert('Success', '✅ Transaction data cleared!');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          }
        }
      ]
    );
  };
  const insets = useSafeAreaInsets();
  const { nurses } = useNurses();
  const [transactionsCleared, setTransactionsCleared] = useState(false);
  const [sortBy, setSortBy] = useState('date'); // 'date', 'amount', 'status'
  const [selectedFilter, setSelectedFilter] = useState('available'); // 'available', 'past', 'all'
  const [newPaymentModalVisible, setNewPaymentModalVisible] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [companyDetails, setCompanyDetails] = useState({
    companyName: '876Nurses Home Care Services Limited',
    address: 'Kingston, Jamaica',
    city: 'Kingston, Jamaica',
    phone: '876-288-7304',
    email: 'care@nursingcareja.com',
    website: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pastPayslipsModalVisible, setPastPayslipsModalVisible] = useState(false);
  const [selectedStaffForHistory, setSelectedStaffForHistory] = useState(null);
  const [staffPayslipHistory, setStaffPayslipHistory] = useState([]);
  const [generatePayslipModalVisible, setGeneratePayslipModalVisible] = useState(false);
  const [selectedStaffType, setSelectedStaffType] = useState('all'); // 'all', 'nurses', 'admin'
  const [selectedStaff, setSelectedStaff] = useState([]);
  const [adminStaff, setAdminStaff] = useState([]);
  const [adminPayrollSettings, setAdminPayrollSettings] = useState(null);
  const [paymentMethodModalVisible, setPaymentMethodModalVisible] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [payslipToPay, setPayslipToPay] = useState(null);
  const { appointments } = useAppointments();
  const { shiftRequests = [] } = useShifts();
  const [paymentForm, setPaymentForm] = useState({
    staffName: '',
    amount: '',
    description: '',
    paymentMethod: 'Bank Transfer',
    category: 'Salary'
  });
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewPayslip, setReviewPayslip] = useState(null);
  const [payslipReviewForm, setPayslipReviewForm] = useState(getEmptyReviewForm());
  const [payrollValidation, setPayrollValidation] = useState({
    status: 'idle',
    issues: [],
    totals: { gross: 0, net: 0 },
    lastRun: null,
  });

  // Load admin staff, payroll settings, and payment methods
  React.useEffect(() => {
    const loadAdminData = async () => {
      try {
        // Check if data was cleared
        const cleared = await AsyncStorage.getItem('transactionsCleared');
        if (cleared === 'true') {
          setTransactionsCleared(true);
          setAdminStaff([]);
          setAdminPayrollSettings(null);
          setPaymentMethods([]);
          return;
        }
        
        // Load admin staff from backend
        let adminUsers = [];
        try {
          const response = await ApiService.makeRequest('/staff/admins', { method: 'GET' });
          if (response.success && response.data) {
             adminUsers = response.data.filter(user => 
                user.id !== 'admin-001' && // Exclude main admin
                user.role === 'admin'
             );
          }
        } catch (err) {
           // Failed to fetch admin staff from backend, using local storage
        }

        if (adminUsers.length === 0) {
          // Fallback to local storage
          const usersData = await AsyncStorage.getItem('users');
          if (usersData) {
            const allUsers = JSON.parse(usersData);
            adminUsers = allUsers.filter(user => 
              user.role === 'admin' && 
              user.id !== 'admin-001' && 
              user.code && 
              user.code.startsWith('ADMIN')
            );
          }
        }
        
        setAdminStaff(adminUsers);

        // Load payment methods from backend
        let methods = [];
        try {
          const response = await ApiService.makeRequest('/payments/methods', { method: 'GET' });
          if (response.success && response.data) {
            methods = response.data;
            // Update local storage
            await AsyncStorage.setItem('paymentMethods', JSON.stringify(methods));
          }
        } catch (err) {
           // Failed to fetch payment methods from backend, using local storage
        }

        if (methods.length === 0) {
           // Fallback to local storage
           const savedPaymentMethods = await AsyncStorage.getItem('paymentMethods');
           if (savedPaymentMethods) {
             methods = JSON.parse(savedPaymentMethods);
           }
        }

        if (methods.length > 0) {
          setPaymentMethods(methods);
        } else {
          // Default payment methods if none saved
          setPaymentMethods([
            { 
              id: '1', 
              type: 'Credit Card', 
              name: 'Visa ****1234', 
              cardType: 'visa',
              lastFour: '1234',
              default: true, 
              icon: 'credit-card',
              bgColor: '#1976d2'
            },
            { 
              id: '2', 
              type: 'Bank Account', 
              name: 'Checking ****9012', 
              bankName: 'Chase Bank',
              default: false, 
              icon: 'bank',
              bgColor: '#4caf50'
            },
          ]);
        }

        const payrollSettings = await SharedSettingsService.read('payroll');

        if (payrollSettings) {
          setAdminPayrollSettings(payrollSettings);
        } else {
          // Default settings if none exist
          setAdminPayrollSettings({
            defaultPayType: 'hourly',
            salaryFrequency: 'monthly',
            defaultSalaryAmount: '180000',
            defaultHourlyRate: '625',
            shiftRates: {
              eightHours: 5000,
              twelveHours: 7000
            },
            holidayMultiplier: 2,
            allowances: { transport: '0', meal: '0', phone: '0' },
          });
        }
      } catch (error) {
        console.error('Error loading admin data:', error);
      }
    };

    loadAdminData();
  }, []);

  React.useEffect(() => {
    const loadCompanyDetails = async () => {
      try {
        const parsed = await SharedSettingsService.read('company');
        if (parsed) {
          setCompanyDetails((prev) => ({ ...prev, ...parsed }));
        }
      } catch (error) {
        console.error('Error loading company details:', error);
      }
    };

    loadCompanyDetails();
  }, []);

  // Get all staff members (nurses + admin staff)
  const allStaffMembers = useMemo(() => {
    // Return empty array if data cleared
    if (transactionsCleared) {
      return [];
    }
    
    const nursingStaff = (nurses || []).map(nurse => ({
          id: nurse.id,
          name: nurse.name,
          role: nurse.specialization || nurse.title || 'Nurse',
          hourlyRate: nurse.hourlyRate || adminPayrollSettings?.defaultHourlyRate || 0,
          employeeId: nurse.code || nurse.id,
          code: nurse.code,
          staffType: 'nursing',
          payType: 'hourly'
        }));

    const administrativeStaff = adminStaff.map(admin => ({
      id: admin.id,
      name: admin.username || `${admin.firstName || ''} ${admin.lastName || ''}`.trim(),
      role: admin.title || 'Administrator',
      salary: admin.salary || (adminPayrollSettings?.defaultSalaryAmount || 180000),
      hourlyRate: admin.hourlyRate || (adminPayrollSettings?.defaultHourlyRate || 0),
      employeeId: admin.code || admin.id,
      code: admin.code,
      staffType: 'admin',
      payType: admin.payType || adminPayrollSettings?.defaultPayType || 'salary'
    }));

    return [...nursingStaff, ...administrativeStaff];
  }, [nurses, adminStaff, adminPayrollSettings, transactionsCleared]);

  // Keep backward compatibility - staffMembers for nursing staff only
  const staffMembers = useMemo(() => {
    return allStaffMembers.filter(staff => staff.staffType === 'nursing');
  }, [allStaffMembers]);

  const selectedStaffContact = React.useMemo(() => {
    if (!selectedPayslip) {
      return null;
    }

    const findMatch = (collection = []) => collection.find((staff) => {
      const candidateId = staff.id || staff._id;
      const employeeIdentifier = staff.employeeId || staff.code || staff.nurseCode;
      return (
        candidateId === selectedPayslip.staffId ||
        employeeIdentifier === (selectedPayslip.employeeId || selectedPayslip.staffId) ||
        staff.name === selectedPayslip.staffName ||
        staff.fullName === selectedPayslip.staffName
      );
    });

    const nurseMatch = findMatch(nurses || []);
    if (nurseMatch) {
      return {
        role: nurseMatch.specialization || selectedPayslip.role || 'Nurse',
        phone: nurseMatch.phone || 'Not provided',
        email: nurseMatch.email || 'Not provided',
        address: nurseMatch.address || nurseMatch.homeAddress || nurseMatch.location || 'Address on file',
      };
    }

    const adminMatch = findMatch(adminStaff || []);
    if (adminMatch) {
      return {
        role: adminMatch.title || selectedPayslip.role || 'Administrator',
        phone: adminMatch.phone || adminMatch.contactNumber || 'Not provided',
        email: adminMatch.email || 'Not provided',
        address: adminMatch.address || adminMatch.officeLocation || 'Address on file',
      };
    }

    return {
      role: selectedPayslip.role || 'Team Member',
      phone: 'Not provided',
      email: 'Not provided',
      address: 'Address on file',
    };
  }, [selectedPayslip, nurses, adminStaff]);

  const previewFieldRows = React.useMemo(() => {
    if (!selectedPayslip) {
      return [];
    }

    const staffNumber = selectedPayslip.employeeId || selectedPayslip.staffId || 'Pending';
    const payDateDisplay = formatDisplayDate(selectedPayslip.payDate || selectedPayslip.generatedDate);
    const payFrequency = selectedPayslip.payType === 'salary' ? 'Monthly' : 'Weekly';

    return [
      [
        { label: 'EMPLOYEE', value: selectedPayslip.staffName, flex: 2 },
        { label: 'NUMBER', value: staffNumber, flex: 1 },
      ],
      [
        { label: 'ADDRESS', value: selectedStaffContact?.address || 'Address on file' },
        { label: 'PHONE', value: selectedStaffContact?.phone || 'Not provided' },
        { label: 'EMAIL', value: selectedStaffContact?.email || 'Not provided' },
      ],
      [
        { label: 'OTHER', value: selectedStaffContact?.role || selectedPayslip.role || 'Role on file' },
        { label: 'PAY DATE', value: payDateDisplay },
        { label: 'TIP', value: payFrequency },
      ],
    ];
  }, [selectedPayslip, selectedStaffContact]);

  const companyNameDisplay = companyDetails.companyName || 'Company Name';
  const companyAddressDisplay = companyDetails.address || 'Street Address';
  const companyEmailDisplay = companyDetails.email || 'company@company.com';
  const companyPhoneDisplay = companyDetails.phone || '(000) 000-0000';
  const companyCityDisplay = companyDetails.city || 'City, ST, ZIP';

  // Calculate worked hours from completed records; never synthesize payroll hours.
  const calculateStaffHours = (staffId, periodStart, periodEnd) => {
    // Return zero hours if data cleared
    if (transactionsCleared) {
      return {
        totalHours: 0,
        regularHours: 0,
        overtimeHours: 0,
        appointmentHours: 0,
        shiftHours: 0,
        sessionsCompleted: 0,
        shiftsCompleted: 0,
      };
    }
    
    // Get approved appointments for this staff member in the pay period
    const startKey = periodStart;
    const endKey = periodEnd;
    const staffAppointments = appointments?.filter(appointment => {
      const appointmentDate = toPayrollDateKey(appointment.date || appointment.completedAt);
      const assignedId = appointment.nurseId || appointment.assignedNurseId || appointment.assignedNurse || appointment.staffId;
      return getRecordId(assignedId) === String(staffId) && appointment.status === 'completed'
        && appointmentDate >= startKey && appointmentDate <= endKey;
    }) || [];

    const shiftAppointments = staffAppointments.filter((appointment) => appointment.isFromShift || appointment.shiftId || appointment.shiftRequestId);
    const ordinaryAppointments = staffAppointments.filter((appointment) => !shiftAppointments.includes(appointment));
    const appointmentHours = ordinaryAppointments.reduce((total, appointment) => total + parseWorkedHours(appointment), 0);

    const shiftBreakdown = {
      eightHourShifts: 0,
      twelveHourShifts: 0,
      holidayEightHourShifts: 0,
      holidayTwelveHourShifts: 0,
    };

    const completedShiftIds = new Set();
    const completedShifts = shiftAppointments.map((appointment) => ({
      ...appointment,
      id: appointment.shiftId || appointment.shiftRequestId || appointment.id,
      date: toPayrollDateKey(appointment.date || appointment.completedAt),
    }));
    (shiftRequests || []).forEach((shift) => {
      const shiftDate = toPayrollDateKey(shift.completedAt || shift.date || shift.scheduledDate || shift.appointmentDate);
      const shiftStaffId = shift.nurseId || shift.staffId || shift.assignedNurseId;
      const shiftId = getRecordId(shift.id || shift._id);
      if (shift.status === 'completed' && getRecordId(shiftStaffId) === String(staffId)
        && shiftDate >= startKey && shiftDate <= endKey
        && !completedShifts.some((appointment) => String(appointment.id) === shiftId)) {
        completedShifts.push({ ...shift, id: shiftId, date: shiftDate });
      }
    });

    const shiftHours = completedShifts.reduce((total, shift) => {
      const hours = parseWorkedHours(shift);
      if (hours <= 0) return total;
      completedShiftIds.add(String(shift.id));
      const normalizedHours = hours >= 10 ? 12 : 8;
      const shiftDate = shift.date;
      const isHoliday = isJamaicanHoliday(shiftDate) || Boolean(shift.isHoliday || shift.holiday || shift.isHolidayShift || shift.holidayPay);

      if (normalizedHours === 12) {
        shiftBreakdown.twelveHourShifts += 1;
        if (isHoliday) shiftBreakdown.holidayTwelveHourShifts += 1;
      } else {
        shiftBreakdown.eightHourShifts += 1;
        if (isHoliday) shiftBreakdown.holidayEightHourShifts += 1;
      }

      return total + hours;
    }, 0);

    const totalHours = appointmentHours + shiftHours;
    const regularHours = totalHours;
    const overtimeHours = 0;

    return {
      totalHours: parseFloat(totalHours.toFixed(2)),
      regularHours: parseFloat(regularHours.toFixed(1)),
      overtimeHours: parseFloat(overtimeHours.toFixed(1)),
      appointmentHours: parseFloat(appointmentHours.toFixed(1)),
      shiftHours: parseFloat(shiftHours.toFixed(1)),
      sessionsCompleted: staffAppointments.length,
      shiftsCompleted: completedShiftIds.size,
      shiftBreakdown,
    };
  };

  const paymentCategories = ['Salary', 'Overtime', 'Bonus', 'Commission', 'Allowance', 'Reimbursement'];
  const paymentMethodOptions = ['Bank Transfer', 'Mobile Money', 'Cash', 'Check'];

  const handleNewPayment = () => {
    setNewPaymentModalVisible(true);
  };

  const handleSubmitPayment = () => {
    if (!paymentForm.staffName || !paymentForm.amount || !paymentForm.description) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const newTransaction = {
      id: Date.now().toString(),
      patient: paymentForm.staffName,
      service: `${paymentForm.category} - ${paymentForm.description}`,
      amount: `J$${parseFloat(paymentForm.amount).toLocaleString()}`,
      date: new Date().toISOString().split('T')[0],
      status: 'pending',
      paymentMethod: paymentForm.paymentMethod,
      icon: 'account-cash',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      type: 'staff_payment'
    };

    // In a real app, you would add this to your transactions list/database
    Alert.alert(
      'Payment Initiated',
      `Payment of J$${parseFloat(paymentForm.amount).toLocaleString()} for ${paymentForm.staffName} has been submitted for processing.`,
      [{ text: 'OK', onPress: () => {
        setNewPaymentModalVisible(false);
        setPaymentForm({
          staffName: '',
          amount: '',
          description: '',
          paymentMethod: 'Bank Transfer',
          category: 'Salary'
        });
      }}]
    );
  };

  // Generate admin staff payslips with salary-based calculations
  const generateAdminPayslip = (staff, period) => {
    if (!adminPayrollSettings) return null;

    const periodStart = new Date(period.start);
    const periodEnd = new Date(period.end);
    
    let basePay = 0;
    let hoursWorked = 0;

    if (staff.payType === 'salary') {
      // Prorate each portion of the pay period against its own calendar month.
      const monthlySalary = sanitizeNumber(staff.salary);
      for (let cursor = new Date(periodStart); cursor <= periodEnd; cursor.setDate(cursor.getDate() + 1)) {
        const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        basePay += monthlySalary / daysInMonth;
      }
    } else if (staff.payType === 'hourly') {
      // Hourly admin staff need a recorded timesheet; no hours are fabricated here.
      return null;
    }

    const allowances = {};
    const totalAllowances = 0;
    const grossPay = basePay;

    // Calculate deductions
    const deductions = {};
    const totalDeductions = 0;
    const netPay = grossPay;

    return {
      id: `${staff.id}-admin-${Date.now()}`,
      staffId: staff.id,
      employeeId: staff.employeeId,
      staffName: staff.name,
      role: staff.role,
      staffType: 'admin',
      payType: staff.payType,
      periodStart: period.start,
      periodEnd: period.end,
      basePay: basePay.toFixed(2),
      allowances: allowances,
      totalAllowances: totalAllowances.toFixed(2),
      deductions: deductions,
      totalDeductions: totalDeductions.toFixed(2),
      grossPay: grossPay.toFixed(2),
      netPay: netPay.toFixed(2),
      status: 'pending',
      paymentMethod: 'Bank Transfer',
      generatedDate: new Date().toISOString().split('T')[0],
      payDate: null,
      hoursWorked: hoursWorked || 'N/A'
    };
  };

  // Generate payslips for selected staff
  const generatePayslipsForStaff = async (selectedStaff) => {
    try {
      const getLastTuesdayStart = (baseDate = new Date()) => {
        const d = new Date(baseDate);
        d.setHours(0, 0, 0, 0);
        const diff = (d.getDay() - 2 + 7) % 7; // 2 = Tuesday
        d.setDate(d.getDate() - diff);
        return d;
      };

      const currentDate = new Date();
      // Nurses are paid weekly on Tuesday.
      // Pay period: Tue–Mon, Pay date: Tuesday.
      const nursePayRunDate = getLastTuesdayStart(currentDate);
      const nursePeriodEnd = new Date(nursePayRunDate);
      nursePeriodEnd.setDate(nursePeriodEnd.getDate() - 1); // Monday
      const nursePeriodStart = new Date(nursePayRunDate);
      nursePeriodStart.setDate(nursePeriodStart.getDate() - 7); // previous Tuesday

      // Keep admin payroll generation unchanged (still uses 2-week window here).
      const adminPeriodEnd = new Date(currentDate);
      const adminPeriodStart = new Date(adminPeriodEnd);
      adminPeriodStart.setDate(adminPeriodStart.getDate() - 13);

      const newPayslips = [];
      const skippedWithoutHours = [];
      const storedPayslipsJson = await AsyncStorage.getItem('generatedPayslips');
      const existingPayslips = storedPayslipsJson ? JSON.parse(storedPayslipsJson) : [];
      const periodAlreadyExists = (staffId, start, end) => existingPayslips.some((payslip) =>
        String(payslip.staffId) === String(staffId)
        && payslip.periodStart === start && payslip.periodEnd === end
      );

      for (const staff of selectedStaff) {
        if (staff.staffType === 'admin') {
          const periodStart = adminPeriodStart.toISOString().split('T')[0];
          const periodEnd = adminPeriodEnd.toISOString().split('T')[0];
          if (periodAlreadyExists(staff.id, periodStart, periodEnd)) continue;
          const adminPayslip = generateAdminPayslip(staff, {
            start: periodStart,
            end: periodEnd,
          });
          if (adminPayslip) {
            newPayslips.push(adminPayslip);
          } else {
            skippedWithoutHours.push(staff.name);
          }
        } else {
          const periodStart = nursePeriodStart.toISOString().split('T')[0];
          const periodEnd = nursePeriodEnd.toISOString().split('T')[0];
          const payDate = nursePayRunDate.toISOString().split('T')[0];

          if (periodAlreadyExists(staff.id, periodStart, periodEnd)) continue;

          // Generate nursing payslip using shift-based payroll rules
          const hoursData = calculateStaffHours(
            staff.id,
            periodStart,
            periodEnd
          );

          if (hoursData.totalHours <= 0) {
            skippedWithoutHours.push(staff.name);
            continue;
          }

          const shiftRates = adminPayrollSettings?.shiftRates || { eightHours: 5000, twelveHours: 7000 };
          const holidayMultiplier = parseFloat(adminPayrollSettings?.holidayMultiplier) || 2;
          const hourlyRate = sanitizeNumber(adminPayrollSettings?.defaultHourlyRate);
          const breakdown = hoursData.shiftBreakdown || {};

          const baseShiftPay =
            (breakdown.eightHourShifts || 0) * parseFloat(shiftRates.eightHours || 0) +
            (breakdown.twelveHourShifts || 0) * parseFloat(shiftRates.twelveHours || 0);

          // Holiday shifts get paid at holidayMultiplier rate (default 2x)
          // This is the ONLY overtime nurses receive in Jamaica
          const holidayExtra =
            (breakdown.holidayEightHourShifts || 0) * parseFloat(shiftRates.eightHours || 0) * (holidayMultiplier - 1) +
            (breakdown.holidayTwelveHourShifts || 0) * parseFloat(shiftRates.twelveHours || 0) * (holidayMultiplier - 1);

          const appointmentPay = (hoursData.appointmentHours || 0) * hourlyRate;

          const regularPay = baseShiftPay + appointmentPay + holidayExtra;
          const overtimePay = 0; // Overtime is only for holidays, already included in holidayExtra
          const grossPay = regularPay + overtimePay;
          const allowances = {};
          const totalAllowances = 0;
          const deductions = {};
          const totalDeductions = 0;
          const netPay = grossPay;
          
          newPayslips.push({
            id: `${staff.id}-nurse-${Date.now()}`,
            staffId: staff.id,
            employeeId: staff.employeeId,
            staffName: staff.name,
            role: staff.role,
            staffType: 'nursing',
            payType: 'hourly',
            periodStart,
            periodEnd,
            hourlyRate: hourlyRate,
            hoursWorked: hoursData.totalHours,
            regularHours: hoursData.regularHours,
            overtimeHours: hoursData.overtimeHours,
            regularPay: regularPay.toFixed(2),
            overtimePay: overtimePay.toFixed(2),
            shiftPay: baseShiftPay.toFixed(2),
            appointmentPay: appointmentPay.toFixed(2),
            holidayPremium: holidayExtra.toFixed(2),
            shiftBreakdown: breakdown,
            appointmentHours: hoursData.appointmentHours,
            shiftHours: hoursData.shiftHours,
            allowances,
            totalAllowances: totalAllowances.toFixed(2),
            deductions,
            totalDeductions: totalDeductions.toFixed(2),
            grossPay: grossPay.toFixed(2),
            netPay: netPay.toFixed(2),
            status: 'pending',
            paymentMethod: 'Bank Transfer',
            generatedDate: payDate,
            payDate
          });
        }
      }

      // Save to Firestore and get generated IDs
      const savedPayslips = [];
      for (const payslip of newPayslips) {
        try {
          const { id: tempId, ...payslipData } = payslip; // Remove temp ID
          const createdPayslip = await ApiService.createPayslip(payslipData);
          savedPayslips.push(createdPayslip);
        } catch (error) {
          console.error('Error saving payslip to Firestore:', error);
          // Still save to local storage if Firestore fails
          savedPayslips.push(payslip);
        }
      }

      // Save to AsyncStorage as cache
      const allPayslips = [...existingPayslips, ...savedPayslips];
      await AsyncStorage.setItem('generatedPayslips', JSON.stringify(allPayslips));

      // Update local state to show new payslips immediately
      setGeneratedPayslips(allPayslips);

      const skippedMessage = skippedWithoutHours.length
        ? ` Skipped ${skippedWithoutHours.length} staff without recorded work hours or timesheets.`
        : '';
      Alert.alert(
        newPayslips.length ? 'Success' : 'No payslips generated',
        newPayslips.length
          ? `Generated ${newPayslips.length} payslips successfully.${skippedMessage}`
          : `No new payslips were created. The period may already have a payslip, or staff may have no recorded work hours. ${skippedMessage}`
      );
      setGeneratePayslipModalVisible(false);
      setSelectedStaff([]);

    } catch (error) {
      console.error('Error generating payslips:', error);
      Alert.alert('Error', 'Failed to generate payslips. Please try again.');
    }
  };

  // Load persisted payslips. The screen does not invent historical or paid records.
  const [generatedPayslips, setGeneratedPayslips] = React.useState([]);
  
  React.useEffect(() => {
    const loadGeneratedPayslips = async () => {
      try {
        // Check if data was cleared
        const cleared = await AsyncStorage.getItem('transactionsCleared');
        if (cleared === 'true') {
          setGeneratedPayslips([]);
          return;
        }
        
        // Load from Firestore (primary source)
        try {
          const payslips = await ApiService.getPayslips({});
          setGeneratedPayslips(payslips);
          // Update AsyncStorage cache
          await AsyncStorage.setItem('generatedPayslips', JSON.stringify(payslips));
        } catch (firestoreError) {
          console.error('Error loading from Firestore, using cache:', firestoreError);
          // Fallback to AsyncStorage cache if Firestore fails
          const stored = await AsyncStorage.getItem('generatedPayslips');
          if (stored) {
            setGeneratedPayslips(JSON.parse(stored));
          }
        }
      } catch (error) {
        console.error('Error loading generated payslips:', error);
      }
    };
    loadGeneratedPayslips();
  }, [transactionsCleared]);

  const payslips = React.useMemo(() => {
    const byId = new Map();
    generatedPayslips.forEach((p) => byId.set(p.id, p));
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.periodEnd || b.generatedDate) - new Date(a.periodEnd || a.generatedDate)
    );
  }, [generatedPayslips]);

  const filterCounts = useMemo(() => {
    const counts = {
      all: payslips.length,
      available: 0,
      past: 0,
    };

    const currentDate = new Date();
    payslips.forEach((p) => {
      const periodEnd = new Date(p.periodEnd || p.generatedDate);
      const daysSinceEnd = Math.floor((currentDate - periodEnd) / (1000 * 60 * 60 * 24));
      
      if (daysSinceEnd <= 14 && p.status !== 'paid') {
        counts.available += 1;
      } else {
        counts.past += 1;
      }
    });

    return counts;
  }, [payslips]);

  // Refresh functionality
  const onRefresh = async () => {
    setRefreshing(true);
    // Simulate data refresh - in real app, this would fetch new data
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
    Alert.alert('Success', 'Payslips refreshed successfully');
  };

  // Filter and search payslips with useMemo for performance
  const filteredAndSearchedPayslips = useMemo(() => {
    let filtered = [...payslips];
    
    // Apply status filter
    if (selectedFilter !== 'all') {
      const currentDate = new Date();
      if (selectedFilter === 'available') {
        filtered = filtered.filter(p => {
          const periodEnd = new Date(p.periodEnd || p.generatedDate);
          const daysSinceEnd = Math.floor((currentDate - periodEnd) / (1000 * 60 * 60 * 24));
          return daysSinceEnd <= 14 && p.status !== 'paid';
        });
      } else if (selectedFilter === 'past') {
        filtered = filtered.filter(p => {
          const periodEnd = new Date(p.periodEnd || p.generatedDate);
          const daysSinceEnd = Math.floor((currentDate - periodEnd) / (1000 * 60 * 60 * 24));
          return daysSinceEnd > 14 || p.status === 'paid';
        });
      }
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(payslip => 
        payslip.staffName.toLowerCase().includes(query) ||
        payslip.role.toLowerCase().includes(query) ||
        payslip.employeeId.toLowerCase().includes(query) ||
        payslip.id.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    switch (sortBy) {
      case 'amount':
        return filtered.sort((a, b) => parseFloat(b.netPay) - parseFloat(a.netPay));
      case 'status':
        return filtered.sort((a, b) => {
          const statusOrder = { 'paid': 0, 'pending': 1, 'failed': 2 };
          return statusOrder[a.status] - statusOrder[b.status];
        });
      case 'date':
      default:
        return filtered.sort((a, b) => new Date(b.periodEnd) - new Date(a.periodEnd));
    }
  }, [payslips, selectedFilter, searchQuery, sortBy]);

  // Filtering and sorting logic for payslips - DEPRECATED (replaced by useMemo above)
  const getFilteredPayslips = () => {
    let filtered = [...payslips];
    
    // Apply status filter
    if (selectedFilter !== 'all') {
      const currentDate = new Date();
      if (selectedFilter === 'available') {
        filtered = filtered.filter(p => {
          const periodEnd = new Date(p.periodEnd || p.generatedDate);
          const daysSinceEnd = Math.floor((currentDate - periodEnd) / (1000 * 60 * 60 * 24));
          return daysSinceEnd <= 14 && p.status !== 'paid';
        });
      } else if (selectedFilter === 'past') {
        filtered = filtered.filter(p => {
          const periodEnd = new Date(p.periodEnd || p.generatedDate);
          const daysSinceEnd = Math.floor((currentDate - periodEnd) / (1000 * 60 * 60 * 24));
          return daysSinceEnd > 14 || p.status === 'paid';
        });
      }
    }
    
    return filtered;
  };

  const getSortedPayslips = () => {
    const filtered = getFilteredPayslips();
    switch (sortBy) {
      case 'amount':
        return filtered.sort((a, b) => parseFloat(b.netPay) - parseFloat(a.netPay));
      case 'status':
        return filtered.sort((a, b) => {
          const statusOrder = { 'paid': 0, 'pending': 1, 'failed': 2 };
          return statusOrder[a.status] - statusOrder[b.status];
        });
      case 'date':
      default:
        return filtered.sort((a, b) => new Date(b.periodEnd) - new Date(a.periodEnd));
    }
  };

  const sortedPayslips = filteredAndSearchedPayslips; // Use the new filtered results

  const runPayrollValidation = React.useCallback(() => {
    if (!sortedPayslips || sortedPayslips.length === 0) {
      setPayrollValidation((prev) => ({
        ...prev,
        status: 'idle',
        issues: [],
        totals: { gross: 0, net: 0 },
        lastRun: new Date().toISOString(),
      }));
      return;
    }

    let grossTotal = 0;
    let netTotal = 0;
    const issues = [];

    sortedPayslips.forEach((payslip) => {
      const allowancesTotal =
        sumObjectValues(payslip.allowances) ||
        sanitizeNumber(payslip.totalAllowances);

      const manualAdjustment = sanitizeNumber(payslip.manualAdjustment);
      const hourlyRate = sanitizeNumber(payslip.hourlyRate);
      const regularHours = sanitizeNumber(payslip.regularHours);
      const overtimeHours = sanitizeNumber(payslip.overtimeHours);
      const deductionsTotal = 0;

      let expectedGross = sanitizeNumber(payslip.grossPay);
      if (payslip.staffType === 'nursing' && payslip.shiftPay !== undefined) {
        expectedGross = sanitizeNumber(payslip.shiftPay)
          + sanitizeNumber(payslip.appointmentPay)
          + sanitizeNumber(payslip.holidayPremium)
          + allowancesTotal + manualAdjustment;
      } else if ((payslip.staffType === 'nursing' || payslip.payType === 'hourly') && !payslip.shiftPay) {
        const regularPay = regularHours * hourlyRate;
        const overtimePay = overtimeHours * hourlyRate * 1.5;
        expectedGross = regularPay + overtimePay + allowancesTotal + manualAdjustment;
      } else {
        expectedGross =
          sanitizeNumber(payslip.basePay || payslip.grossPay) + allowancesTotal + manualAdjustment;
      }

      const expectedNet = expectedGross - deductionsTotal;

      grossTotal += sanitizeNumber(payslip.grossPay);
      netTotal += sanitizeNumber(payslip.netPay);

      if (Math.abs(expectedGross - sanitizeNumber(payslip.grossPay)) > 1) {
        issues.push({
          id: payslip.id,
          field: 'gross',
          message: `${payslip.staffName}: expected gross ${formatCurrencyValue(expectedGross)} (current ${formatCurrencyValue(payslip.grossPay)})`,
        });
      }

      if (Math.abs(expectedNet - sanitizeNumber(payslip.netPay)) > 1) {
        issues.push({
          id: payslip.id,
          field: 'net',
          message: `${payslip.staffName}: expected net ${formatCurrencyValue(expectedNet)}`,
        });
      }

      if (sanitizeNumber(payslip.netPay) < 0) {
        issues.push({
          id: payslip.id,
          field: 'negativeNet',
          message: `${payslip.staffName}: net pay is negative`,
        });
      }
    });

    setPayrollValidation({
      status: issues.length ? 'issues' : 'clean',
      issues: issues.slice(0, 6),
      totals: {
        gross: parseFloat(grossTotal.toFixed(2)),
        net: parseFloat(netTotal.toFixed(2)),
      },
      lastRun: new Date().toISOString(),
    });
  }, [sortedPayslips, adminPayrollSettings]);

  React.useEffect(() => {
    runPayrollValidation();
  }, [runPayrollValidation]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid': return COLORS.success;
      case 'pending': return COLORS.warning;
      case 'failed': return COLORS.error;
      default: return COLORS.textMuted;
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'paid': return 'check-circle';
      case 'pending': return 'clock';
      case 'failed': return 'alert-circle';
      default: return 'help-circle';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'paid':
        return 'Recorded Offline';
      case 'pending':
        return 'Needs Review';
      case 'failed':
        return 'Action Needed';
      default:
        return 'Info';
    }
  };

  const handlePayslipPress = (payslip) => {
    setSelectedPayslip(payslip);
  };

  const handleGeneratePayslip = async (payslip) => {
    Alert.alert(
      'Generate Payslip PDF',
      `Generate payslip for ${payslip.staffName} for period ${payslip.periodStart} to ${payslip.periodEnd}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Generate',
          onPress: async () => {
            try {
              const pdfUri = await PayslipGenerator.generatePayslipPDF(payslip);
              await PayslipGenerator.sharePayslip(pdfUri, payslip.staffName);
              Alert.alert('Success', 'Payslip PDF generated and shared successfully');
            } catch (error) {
              console.error('Error generating payslip PDF:', error);
              Alert.alert('Error', 'Failed to generate payslip PDF. Please try again.');
            }
          }
        }
      ]
    );
  };

  // Save payslip to nurse profile when marked as paid
  const savePayslipToNurseProfile = async (payslip) => {
    try {
      const buildPayslipIdentity = (p) => {
        if (!p) return '';
        const explicit = p.id || p.payslipNumber || p.mongoId;
        if (explicit) return String(explicit);
        const staff = p.staffId || p.employeeId || p.nurseCode || p.code || p.staffName || 'unknown';
        const periodStart = p.periodStart || '';
        const periodEnd = p.periodEnd || '';
        const amount = p.netPay ?? '';
        return `${staff}-${periodStart}-${periodEnd}-${amount}`;
      };

      // Get existing nurse payslips
      const existingPayslipsJson = await AsyncStorage.getItem('nursePayslips');
      const existingPayslips = existingPayslipsJson ? JSON.parse(existingPayslipsJson) : {};
      
      // Find the nurse ID from staffMembers
      const nurse = staffMembers.find(
        (s) => s.employeeId === payslip.employeeId || s.code === payslip.employeeId || s.name === payslip.staffName
      );
      if (!nurse) return false;

      const keyCandidates = [
        nurse.id,
        nurse.employeeId,
        nurse.code,
        payslip.employeeId,
        payslip.nurseCode,
        payslip.code,
        payslip.staffId,
      ].filter(Boolean);

      // Avoid writing to the same bucket multiple times (some IDs overlap).
      const uniqueKeyCandidates = Array.from(new Set(keyCandidates.map((k) => String(k))));
      
      // Add payslip to nurse's array
      const payslipRecord = {
        ...payslip,
        status: 'paid',
        paidDate: payslip.paidDate || new Date().toISOString(),
      };

      const identity = buildPayslipIdentity(payslipRecord);

      // Save under all candidate keys so NurseProfileScreen can find it regardless of id format.
      uniqueKeyCandidates.forEach((key) => {
        if (!existingPayslips[key]) {
          existingPayslips[key] = [];
        }

        const list = Array.isArray(existingPayslips[key]) ? existingPayslips[key] : [];
        const existingIndex = list.findIndex((p) => buildPayslipIdentity(p) === identity);
        if (existingIndex >= 0) {
          list[existingIndex] = {
            ...list[existingIndex],
            ...payslipRecord,
          };
        } else {
          list.push(payslipRecord);
        }
        existingPayslips[key] = list;
      });
      
      // Save back to AsyncStorage
      await AsyncStorage.setItem('nursePayslips', JSON.stringify(existingPayslips));
      
      return true;
    } catch (error) {
      console.error('Error saving payslip to nurse profile:', error);
      return false;
    }
  };

  const updateReviewForm = (field, value, group) => {
    setPayslipReviewForm((prev) => {
      if (group) {
        return {
          ...prev,
          [group]: {
            ...prev[group],
            [field]: value,
          },
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const openReviewModal = (payslip) => {
    if (!payslip) {
      return;
    }

    setReviewPayslip(payslip);
    setPayslipReviewForm({
      status: payslip.status || 'pending',
      regularHours: payslip.regularHours !== undefined ? String(payslip.regularHours) : '',
      overtimeHours: payslip.overtimeHours !== undefined ? String(payslip.overtimeHours) : '',
      basePay: payslip.basePay !== undefined ? String(payslip.basePay) : String(payslip.grossPay || ''),
      manualAdjustment: payslip.manualAdjustment !== undefined ? String(payslip.manualAdjustment) : '0',
      allowances: {
        transport: String(payslip.allowances?.transport ?? 0),
        meal: String(payslip.allowances?.meal ?? 0),
        phone: String(payslip.allowances?.phone ?? 0),
        other: String(payslip.allowances?.other ?? 0),
      },
      deductions: {},
      notes: payslip.notes || '',
    });
    setReviewModalVisible(true);
  };

  const recalcPayslipFromForm = (payslip, form, payrollSettings) => {
    if (!payslip) {
      return null;
    }

    const isHourly = payslip.staffType === 'nursing' || payslip.payType === 'hourly';
    const hourlyRate = sanitizeNumber(payslip.hourlyRate);

    const regularHours = sanitizeNumber(form.regularHours || payslip.regularHours);
    const overtimeHours = sanitizeNumber(form.overtimeHours || payslip.overtimeHours);
    const basePayInput = sanitizeNumber(form.basePay || payslip.basePay || payslip.grossPay);
    const manualAdjustment = sanitizeNumber(form.manualAdjustment);

    const allowances = {
      transport: sanitizeNumber(form.allowances?.transport),
      meal: sanitizeNumber(form.allowances?.meal),
      phone: sanitizeNumber(form.allowances?.phone),
      other: sanitizeNumber(form.allowances?.other),
    };

    const deductions = {};

    let regularPay = basePayInput;
    let overtimePay = 0;

    if (payslip.staffType === 'nursing' && payslip.shiftPay !== undefined) {
      const shiftHours = sanitizeNumber(payslip.shiftHours);
      const appointmentHours = Math.max(0, regularHours - shiftHours);
      regularPay = sanitizeNumber(payslip.shiftPay)
        + appointmentHours * hourlyRate
        + sanitizeNumber(payslip.holidayPremium);
    } else if (isHourly) {
      regularPay = regularHours * hourlyRate;
      overtimePay = overtimeHours * hourlyRate * 1.5;
    }

    const totalAllowances = sumObjectValues(allowances);
    const totalDeductions = 0;
    const grossPay = regularPay + overtimePay + totalAllowances + manualAdjustment;
    const netPay = grossPay;

    return {
      ...payslip,
      status: form.status,
      regularHours: isHourly ? parseFloat(regularHours.toFixed(2)) : payslip.regularHours,
      overtimeHours: isHourly ? parseFloat(overtimeHours.toFixed(2)) : payslip.overtimeHours,
      basePay: parseFloat(regularPay.toFixed(2)),
      regularPay: parseFloat(regularPay.toFixed(2)),
      overtimePay: parseFloat(overtimePay.toFixed(2)),
      appointmentHours: payslip.staffType === 'nursing' && payslip.shiftPay !== undefined
        ? Math.max(0, regularHours - sanitizeNumber(payslip.shiftHours))
        : payslip.appointmentHours,
      appointmentPay: payslip.staffType === 'nursing' && payslip.shiftPay !== undefined
        ? Math.max(0, regularHours - sanitizeNumber(payslip.shiftHours)) * hourlyRate
        : payslip.appointmentPay,
      allowances,
      totalAllowances: parseFloat(totalAllowances.toFixed(2)),
      manualAdjustment: parseFloat(manualAdjustment.toFixed(2)),
      deductions,
      totalDeductions: parseFloat(totalDeductions.toFixed(2)),
      grossPay: parseFloat(grossPay.toFixed(2)),
      netPay: parseFloat(netPay.toFixed(2)),
      reviewedByAdmin: true,
      reviewedAt: new Date().toISOString(),
      notes: form.notes || '',
    };
  };

  const previewReviewPayslip = React.useMemo(() => {
    if (!reviewPayslip) {
      return null;
    }
    return recalcPayslipFromForm(reviewPayslip, payslipReviewForm, adminPayrollSettings);
  }, [reviewPayslip, payslipReviewForm, adminPayrollSettings]);

  const persistReviewedPayslip = async (updatedPayslip) => {
    try {
      const stored = await AsyncStorage.getItem('generatedPayslips');
      let updatedList = [];
      if (stored) {
        const parsed = JSON.parse(stored);
        updatedList = parsed.map((p) => (p.id === updatedPayslip.id ? updatedPayslip : p));
        if (!parsed.find((p) => p.id === updatedPayslip.id)) {
          updatedList.push(updatedPayslip);
        }
      } else {
        updatedList = [updatedPayslip];
      }

      await AsyncStorage.setItem('generatedPayslips', JSON.stringify(updatedList));
      setGeneratedPayslips(updatedList);

      if (updatedPayslip.status === 'paid') {
        await savePayslipToNurseProfile(updatedPayslip);
      }
    } catch (error) {
      console.error('Error updating payslip locally:', error);
    }

    try {
      await ApiService.updatePayslip(updatedPayslip.id, {
        status: updatedPayslip.status,
        grossPay: updatedPayslip.grossPay,
        netPay: updatedPayslip.netPay,
        regularHours: updatedPayslip.regularHours,
        overtimeHours: updatedPayslip.overtimeHours,
        allowances: updatedPayslip.allowances,
        deductions: updatedPayslip.deductions,
        reviewedByAdmin: true,
        reviewedAt: updatedPayslip.reviewedAt,
        notes: updatedPayslip.notes,
      });
    } catch (error) {
      console.warn('Unable to sync payslip update to backend:', error?.message || error);
    }
  };

  const handleReviewSave = async () => {
    if (!reviewPayslip) {
      return;
    }
    const recalculated = recalcPayslipFromForm(reviewPayslip, payslipReviewForm, adminPayrollSettings);
    await persistReviewedPayslip(recalculated);
    setSelectedPayslip((prev) => (prev && prev.id === recalculated.id ? recalculated : prev));
    setReviewModalVisible(false);
    setReviewPayslip(null);
    setPayslipReviewForm(getEmptyReviewForm());
    runPayrollValidation();
    Alert.alert('Payslip updated', `${recalculated.staffName}'s payslip has been updated.`);
  };

  const handleReviewCancel = () => {
    setReviewModalVisible(false);
    setReviewPayslip(null);
    setPayslipReviewForm(getEmptyReviewForm());
  };

  const handlePayNow = async (payslip) => {
    try {
      const paidAtIso = new Date().toISOString();
      const paidAtDate = paidAtIso.split('T')[0];

      // Mark payslip as paid and add paid stamp
      const paidPayslip = {
        ...payslip,
        status: 'paid',
        // Keep both fields: the UI stamp uses paidDate, some lists use payDate.
        paidDate: paidAtIso,
        payDate: payslip.payDate || paidAtDate,
      };

      // Persist so paid status survives refresh AND overrides mock weekly payslips.
      const storedPayslips = await AsyncStorage.getItem('generatedPayslips');
      const list = storedPayslips ? JSON.parse(storedPayslips) : [];
      const existingIndex = list.findIndex((p) => p.id === payslip.id);
      const updatedList = [...list];
      if (existingIndex >= 0) {
        updatedList[existingIndex] = paidPayslip;
      } else {
        updatedList.push(paidPayslip);
      }

      await AsyncStorage.setItem('generatedPayslips', JSON.stringify(updatedList));
      setGeneratedPayslips(updatedList);
      setSelectedPayslip((prev) => (prev && prev.id === payslip.id ? paidPayslip : prev));

      // Sync to Firestore
      try {
        await ApiService.updatePayslip(paidPayslip.id, {
          status: 'paid',
          paidDate: paidAtIso,
          payDate: payslip.payDate || paidAtDate,
        });
      } catch (firestoreError) {
        console.error('Error syncing paid status to Firestore:', firestoreError);
      }

      // Save stamped payslip to nurse profile
      const saved = await savePayslipToNurseProfile(paidPayslip);
      
      if (saved) {
        Alert.alert(
          'Payslip Marked as Paid ✅',
          `Payslip for ${payslip.staffName} has been marked as paid and sent to their profile.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Warning',
          'Payslip marked as paid but could not be saved to nurse profile.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error marking payslip as paid:', error);
      Alert.alert('Error', 'Failed to mark payslip as paid. Please try again.');
    }
  };

  const processPayment = async (payslip, paymentMethod) => {
    try {
      // Simulate payment processing
      const isSuccess = Math.random() > 0.1; // 90% success rate
      
      if (isSuccess) {
        // Update payslip status to paid
        const updatedPayslips = await AsyncStorage.getItem('generatedPayslips');
        if (updatedPayslips) {
          const payslips = JSON.parse(updatedPayslips);
          const updatedList = payslips.map(p => 
            p.id === payslip.id 
              ? { ...p, status: 'paid', payDate: new Date().toISOString().split('T')[0], paymentMethod: paymentMethod.name }
              : p
          );
          await AsyncStorage.setItem('generatedPayslips', JSON.stringify(updatedList));
          setGeneratedPayslips(updatedList);
        }

        // Sync to Firestore
        try {
          await ApiService.updatePayslip(payslip.id, {
            status: 'paid',
            payDate: new Date().toISOString().split('T')[0],
            paymentMethod: paymentMethod.name,
          });
        } catch (firestoreError) {
          console.error('Error syncing payment to Firestore:', firestoreError);
        }

        // Save to staff profile
        await savePayslipToNurseProfile({ ...payslip, status: 'paid', payDate: new Date().toISOString().split('T')[0] });
        
        Alert.alert(
          'Payment Successful! 💳',
          `Payment of J$${parseFloat(payslip.netPay).toLocaleString()} sent to ${payslip.staffName} via ${paymentMethod.name}`,
          [{ text: 'OK' }]
        );
      } else {
        // Update payslip status to failed
        const updatedPayslips = await AsyncStorage.getItem('generatedPayslips');
        if (updatedPayslips) {
          const payslips = JSON.parse(updatedPayslips);
          const updatedList = payslips.map(p => 
            p.id === payslip.id 
              ? { ...p, status: 'failed', paymentMethod: paymentMethod.name }
              : p
          );
          await AsyncStorage.setItem('generatedPayslips', JSON.stringify(updatedList));
          setGeneratedPayslips(updatedList);
        }

        // Sync to Firestore
        try {
          await ApiService.updatePayslip(payslip.id, {
            status: 'failed',
            paymentMethod: paymentMethod.name,
          });
        } catch (firestoreError) {
          console.error('Error syncing failed payment to Firestore:', firestoreError);
        }

        Alert.alert(
          'Payment Failed ❌',
          'Payment could not be processed. Please try again or use a different payment method.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error processing payment:', error);
      Alert.alert('Error', 'Failed to process payment. Please try again.');
    }
  };

  const handleViewStaffHistory = async (staffId, staffName) => {
    try {
      // In a real app, you'd fetch this from a persistent source.
      // For now, we'll filter the generated payslips.
      const history = payslips.filter(p => (p.staffId === staffId || p.employeeId === staffId) && p.status === 'paid');
      
      // Sort by most recent first
      history.sort((a, b) => new Date(b.payDate) - new Date(a.payDate));

      setStaffPayslipHistory(history);
      setSelectedStaffForHistory(staffName);
      setPastPayslipsModalVisible(true);
    } catch (error) {
      console.error('Error loading staff payslip history:', error);
      Alert.alert('Error', 'Failed to load payslip history.');
    }
  };

  const getTotalPayroll = () => {
    return sortedPayslips
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + parseFloat(p.netPay), 0)
      .toFixed(2);
  };

  const FilterPills = () => (
    <View style={styles.filterPillContainer}>
      {FILTER_OPTIONS.map((filter) => (
        <TouchableOpacity
          key={filter.key}
          style={styles.filterPill}
          onPress={() => setSelectedFilter(filter.key)}
        >
          {selectedFilter === filter.key ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.filterPillGradient}
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
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <LinearGradient 
        colors={GRADIENTS.header} 
        style={[styles.header, { paddingTop: insets.top + 20, paddingBottom: 20 }]}
      >
        <View style={styles.headerContent}>
          <TouchableWeb
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.headerTitle}>Staff Transactions</Text>
          <TouchableOpacity
            style={styles.validationRefreshButton}
            onPress={runPayrollValidation}
          >
            <MaterialCommunityIcons name="refresh" size={18} color={COLORS.white} />
            <Text style={styles.validationRefreshText}>Run</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerSubtitleRow}>
          <MaterialCommunityIcons
            name={payrollValidation.status === 'issues' ? 'alert-octagon' : 'check-circle'}
            size={18}
            color={payrollValidation.status === 'issues' ? COLORS.warning : COLORS.success}
            style={styles.headerSubtitleIcon}
          />
          <Text
            style={[
              styles.headerSubtitle,
              payrollValidation.status === 'issues' ? styles.headerSubtitleWarning : styles.headerSubtitleSuccess,
            ]}
          >
            Payroll validation {payrollValidation.lastRun ? `updated ${new Date(payrollValidation.lastRun).toLocaleTimeString()}` : 'awaiting first run'}
          </Text>
        </View>
      </LinearGradient>

      {/* Main Scrollable Content */}
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Payroll Validation */}
      {payrollValidation.issues.length > 0 && (
        <View style={styles.validationSection}>
          <View style={styles.validationHeaderRow}>
            <View style={styles.validationTitleGroup}>
              <MaterialCommunityIcons name="alert-octagon" size={18} color={COLORS.warning} />
              <Text style={styles.validationTitle}>Payroll Validation</Text>
              {payrollValidation.lastRun && (
                <Text style={styles.validationTimestamp}>
                  Updated {new Date(payrollValidation.lastRun).toLocaleTimeString()}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.validationSummaryRow}>
            <View>
              <Text style={styles.validationLabel}>Gross</Text>
              <Text style={styles.validationValue}>{formatCurrencyValue(payrollValidation.totals.gross)}</Text>
            </View>
            <View>
              <Text style={styles.validationLabel}>Net</Text>
              <Text style={styles.validationValue}>{formatCurrencyValue(payrollValidation.totals.net)}</Text>
            </View>
            <View>
              <Text style={styles.validationLabel}>Issues</Text>
              <Text style={[styles.validationValue, styles.validationValueWarning]}>
                {payrollValidation.issues.length}
              </Text>
            </View>
          </View>
          <View style={styles.validationIssuesContainer}>
            {payrollValidation.issues.slice(0, 3).map((issue, index) => (
              <TouchableOpacity
                key={`${issue.id}-${issue.field}-${index}`}
                style={styles.validationIssueRow}
                onPress={() => {
                  const targetPayslip = sortedPayslips.find((p) => p.id === issue.id);
                  if (targetPayslip) {
                    setSelectedPayslip(targetPayslip);
                    openReviewModal(targetPayslip);
                  }
                }}
              >
                <MaterialCommunityIcons name="alert-circle" size={16} color={COLORS.warning} />
                <Text style={styles.validationIssueText}>{issue.message}</Text>
              </TouchableOpacity>
            ))}
            {payrollValidation.issues.length > 3 && (
              <Text style={styles.validationMoreText}>
                +{payrollValidation.issues.length - 3} more items need attention
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Payslip Preview Section */}
      <View style={styles.previewSection}>
        <View style={styles.previewHeader}>
          <TouchableWeb
            onPress={() => setSelectedPayslip(null)}
            style={styles.closeIconButton}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="close" size={18} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.previewTitle}>
            {selectedPayslip ? `Payslip Preview - ${selectedPayslip.employeeId || selectedPayslip.staffId}` : 'Payslip Preview'}
          </Text>
          <TouchableWeb
            onPress={() => {
              // PDF share feature temporarily disabled
            }}
            style={styles.shareIconButtonDisabled}
            activeOpacity={1}
            disabled
          >
            <MaterialCommunityIcons name="file-pdf-box" size={18} color="#999" />
          </TouchableWeb>
        </View>

        {selectedPayslip ? (
          <View style={styles.payslipPreviewBackdrop}>
            <View style={styles.payslipPreviewCard}>
              <PayslipComponent
                payslip={selectedPayslip}
                companyDetails={companyDetails}
                staffContact={selectedStaffContact}
                payslipEmployeeBenefits={payslipEmployeeBenefits}
              />
            </View>
          </View>
        ) : (
          <View style={styles.noPayslipSelected}>
            <MaterialCommunityIcons name="receipt-text-outline" size={80} color={COLORS.border} />
            <Text style={styles.noPayslipText}>Select a payslip below to preview</Text>
          </View>
        )}
      </View>

      {/* Filter Pills */}
      <FilterPills />
      
      <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Payslip Review Modal */}
      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={handleReviewCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.reviewModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {reviewPayslip ? `Review ${reviewPayslip.staffName}` : 'Review Payslip'}
              </Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={handleReviewCancel}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              {reviewPayslip && (
                <View style={styles.reviewSummaryRow}>
                  <View>
                    <Text style={styles.reviewLabel}>Period</Text>
                    <Text style={styles.reviewValue}>
                      {reviewPayslip.periodStart} → {reviewPayslip.periodEnd}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.reviewLabel}>Current Net</Text>
                    <Text style={styles.reviewValue}>{formatCurrencyValue(reviewPayslip.netPay)}</Text>
                  </View>
                  <View>
                    <Text style={styles.reviewLabel}>New Net</Text>
                    <Text style={[styles.reviewValue, styles.reviewValuePrimary]}>
                      {formatCurrencyValue(previewReviewPayslip?.netPay ?? reviewPayslip.netPay)}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={styles.formLabel}>Status</Text>
              <View style={styles.statusToggleRow}>
                {['pending', 'paid', 'failed'].map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusToggle,
                      payslipReviewForm.status === status && styles.statusToggleActive,
                    ]}
                    onPress={() => updateReviewForm('status', status)}
                  >
                    <Text
                      style={[
                        styles.statusToggleText,
                        payslipReviewForm.status === status && styles.statusToggleTextActive,
                      ]}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {reviewPayslip && (reviewPayslip.staffType === 'nursing' || reviewPayslip.payType === 'hourly') ? (
                <View style={styles.formRow}>
                  <View style={styles.formColumn}>
                    <Text style={styles.formLabelSmall}>Regular Hours</Text>
                    <TextInput
                      style={styles.textInput}
                      value={payslipReviewForm.regularHours}
                      onChangeText={(text) => updateReviewForm('regularHours', text)}
                      placeholder="70"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.formColumn}>
                    <Text style={styles.formLabelSmall}>Overtime Hours</Text>
                    <TextInput
                      style={styles.textInput}
                      value={payslipReviewForm.overtimeHours}
                      onChangeText={(text) => updateReviewForm('overtimeHours', text)}
                      placeholder="5"
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Base Pay (J$)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={payslipReviewForm.basePay}
                    onChangeText={(text) => updateReviewForm('basePay', text)}
                    keyboardType="numeric"
                    placeholder="180000"
                  />
                </View>
              )}

              <Text style={styles.formLabel}>Allowances</Text>
              <View style={styles.formRow}>
                <View style={styles.formColumn}>
                  <Text style={styles.formLabelSmall}>Transport</Text>
                  <TextInput
                    style={styles.textInput}
                    value={payslipReviewForm.allowances.transport}
                    onChangeText={(text) => updateReviewForm('transport', text, 'allowances')}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.formColumn}>
                  <Text style={styles.formLabelSmall}>Meal</Text>
                  <TextInput
                    style={styles.textInput}
                    value={payslipReviewForm.allowances.meal}
                    onChangeText={(text) => updateReviewForm('meal', text, 'allowances')}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={styles.formRow}>
                <View style={styles.formColumn}>
                  <Text style={styles.formLabelSmall}>Phone</Text>
                  <TextInput
                    style={styles.textInput}
                    value={payslipReviewForm.allowances.phone}
                    onChangeText={(text) => updateReviewForm('phone', text, 'allowances')}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.formColumn}>
                  <Text style={styles.formLabelSmall}>Other</Text>
                  <TextInput
                    style={styles.textInput}
                    value={payslipReviewForm.allowances.other}
                    onChangeText={(text) => updateReviewForm('other', text, 'allowances')}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Manual Adjustment</Text>
                <TextInput
                  style={styles.textInput}
                  value={payslipReviewForm.manualAdjustment}
                  onChangeText={(text) => updateReviewForm('manualAdjustment', text)}
                  keyboardType="numeric"
                  placeholder="0"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Notes</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={payslipReviewForm.notes}
                  onChangeText={(text) => updateReviewForm('notes', text)}
                  placeholder="Add internal notes"
                  multiline
                  numberOfLines={3}
                />
              </View>

              {previewReviewPayslip && (
                <View style={styles.reviewTotalsRow}>
                  <View>
                    <Text style={styles.reviewLabel}>Gross (calc)</Text>
                    <Text style={styles.reviewValue}>{formatCurrencyValue(previewReviewPayslip.grossPay)}</Text>
                  </View>
                  <View>
                    <Text style={styles.reviewLabel}>Net (calc)</Text>
                    <Text style={[styles.reviewValue, styles.reviewValuePrimary]}>
                      {formatCurrencyValue(previewReviewPayslip.netPay)}
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.reviewModalActions}>
                <TouchableOpacity style={styles.reviewCancelButton} onPress={handleReviewCancel}>
                  <Text style={styles.reviewCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.reviewSaveButton} onPress={handleReviewSave}>
                  <Text style={styles.reviewSaveText}>Save Changes</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* New Payment Modal */}
      <Modal
        visible={newPaymentModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setNewPaymentModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.paymentModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Staff Payment</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setNewPaymentModalVisible(false)}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {/* Staff Selection */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Staff Member *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.staffSelector}>
                  {staffMembers.map((staff) => (
                    <TouchableOpacity
                      key={staff.id}
                      style={[
                        styles.staffCard,
                        paymentForm.staffName === staff.name && styles.selectedStaffCard
                      ]}
                      onPress={() => setPaymentForm({...paymentForm, staffName: staff.name})}
                    >
                      <Text style={[
                        styles.staffName,
                        paymentForm.staffName === staff.name && styles.selectedStaffName
                      ]}>
                        {staff.name}
                      </Text>
                      <Text style={styles.staffRole}>{staff.role}</Text>
                      <Text style={styles.staffRate}>J${staff.hourlyRate}/hr</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Payment Category */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Payment Category *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categorySelector}>
                  {paymentCategories.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryChip,
                        paymentForm.category === category && styles.selectedCategoryChip
                      ]}
                      onPress={() => setPaymentForm({...paymentForm, category})}
                    >
                      <Text style={[
                        styles.categoryText,
                        paymentForm.category === category && styles.selectedCategoryText
                      ]}>
                        {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Amount */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Amount (J$) *</Text>
                <TextInput
                  style={styles.textInput}
                  value={paymentForm.amount}
                  onChangeText={(text) => setPaymentForm({...paymentForm, amount: text})}
                  placeholder="Enter amount"
                  keyboardType="numeric"
                />
              </View>

              {/* Description */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Description *</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={paymentForm.description}
                  onChangeText={(text) => setPaymentForm({...paymentForm, description: text})}
                  placeholder="Payment description"
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Payment Method */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Payment Method</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.methodSelector}>
                  {paymentMethodOptions.map((method) => (
                    <TouchableOpacity
                      key={method}
                      style={[
                        styles.methodChip,
                        paymentForm.paymentMethod === method && styles.selectedMethodChip
                      ]}
                      onPress={() => setPaymentForm({...paymentForm, paymentMethod: method})}
                    >
                      <Text style={[
                        styles.methodText,
                        paymentForm.paymentMethod === method && styles.selectedMethodText
                      ]}>
                        {method}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Submit Button */}
              <TouchableOpacity style={styles.submitButton} onPress={handleSubmitPayment}>
                <LinearGradient
                  colors={['#2196F3', '#1976D2']}
                  style={styles.submitGradient}
                >
                  <MaterialCommunityIcons name="cash" size={20} color={COLORS.white} />
                  <Text style={styles.submitButtonText}>Submit Payment</Text>
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Past Payslips Modal */}
      <Modal
        visible={pastPayslipsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPastPayslipsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.paymentModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedStaffForHistory ? `${selectedStaffForHistory} - Payslip History` : 'Payslip History'}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setPastPayslipsModalVisible(false)}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {staffPayslipHistory.length === 0 ? (
                <View style={styles.emptyHistoryState}>
                  <MaterialCommunityIcons name="receipt" size={80} color={COLORS.border} />
                  <Text style={styles.emptyTitle}>No Payslip History</Text>
                  <Text style={styles.emptyText}>
                    No past payslips found for this staff member
                  </Text>
                </View>
              ) : (
                <View style={styles.historyList}>
                  {staffPayslipHistory.map((payslip) => (
                    <TouchableOpacity
                      key={payslip.id}
                      style={styles.historyCard}
                      onPress={() => {
                        setSelectedPayslip(payslip);
                        setPastPayslipsModalVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.historyCardHeader}>
                        <View style={styles.historyMainInfo}>
                          <MaterialCommunityIcons name="receipt" size={16} color={COLORS.primary} />
                          <Text style={styles.historyPeriod}>
                            {payslip.periodStart} - {payslip.periodEnd}
                          </Text>
                        </View>
                        <Text style={styles.historyAmount}>
                          J${parseFloat(payslip.netPay).toLocaleString()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Generate Payslip Staff Selection Modal */}
      <Modal
        visible={generatePayslipModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setGeneratePayslipModalVisible(false);
          setSelectedStaff([]);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.paymentModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Generate Payslips</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setGeneratePayslipModalVisible(false);
                  setSelectedStaff([]);
                }}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Select staff members to generate payslips for the current pay period
            </Text>

            <ScrollView style={styles.staffSelectionContainer} showsVerticalScrollIndicator={false}>
              {/* Nursing Staff Section */}
              {allStaffMembers.filter(staff => staff.staffType === 'nursing').length > 0 && (
                <>
                  <Text style={styles.staffTypeHeader}>🩺 Nursing Staff</Text>
                  <View style={styles.staffListContainer}>
                    <TouchableOpacity
                      style={styles.selectAllButton}
                      onPress={() => {
                        const nursingStaff = allStaffMembers.filter(staff => staff.staffType === 'nursing');
                        const allNursesSelected = nursingStaff.every(staff => (selectedStaff || []).includes(staff.id));
                        
                        if (allNursesSelected) {
                          setSelectedStaff(prev => prev.filter(id => !nursingStaff.find(staff => staff.id === id)));
                        } else {
                          setSelectedStaff(prev => [
                            ...prev.filter(id => !nursingStaff.find(staff => staff.id === id)),
                            ...nursingStaff.map(staff => staff.id)
                          ]);
                        }
                      }}
                    >
                      <View style={[
                        styles.staffCheckbox,
                        allStaffMembers.filter(staff => staff.staffType === 'nursing').every(staff => (selectedStaff || []).includes(staff.id)) && styles.staffCheckboxSelected
                      ]}>
                        {allStaffMembers.filter(staff => staff.staffType === 'nursing').every(staff => (selectedStaff || []).includes(staff.id)) && (
                          <MaterialCommunityIcons name="check" size={14} color={COLORS.white} />
                        )}
                      </View>
                      <Text style={styles.selectAllText}>Select All Nursing Staff</Text>
                    </TouchableOpacity>

                    {allStaffMembers
                      .filter(staff => staff.staffType === 'nursing')
                      .map(staff => (
                        <StaffSelectionItem 
                          key={staff.id} 
                          staff={staff} 
                          selected={(selectedStaff || []).includes(staff.id)}
                          onToggle={(staffId) => {
                            setSelectedStaff(prev => 
                              (prev || []).includes(staffId) 
                                ? (prev || []).filter(id => id !== staffId)
                                : [...(prev || []), staffId]
                            );
                          }}
                        />
                      ))}
                  </View>
                </>
              )}

              {/* Admin Staff Section */}
              {allStaffMembers.filter(staff => staff.staffType === 'admin').length > 0 && (
                <>
                  <Text style={styles.staffTypeHeader}>👔 Administrative Staff</Text>
                  <View style={styles.staffListContainer}>
                    <TouchableOpacity
                      style={styles.selectAllButton}
                      onPress={() => {
                        const adminStaffList = allStaffMembers.filter(staff => staff.staffType === 'admin');
                        const allAdminSelected = adminStaffList.every(staff => (selectedStaff || []).includes(staff.id));
                        
                        if (allAdminSelected) {
                          setSelectedStaff(prev => prev.filter(id => !adminStaffList.find(staff => staff.id === id)));
                        } else {
                          setSelectedStaff(prev => [
                            ...prev.filter(id => !adminStaffList.find(staff => staff.id === id)),
                            ...adminStaffList.map(staff => staff.id)
                          ]);
                        }
                      }}
                    >
                      <View style={[
                        styles.staffCheckbox,
                        allStaffMembers.filter(staff => staff.staffType === 'admin').every(staff => (selectedStaff || []).includes(staff.id)) && styles.staffCheckboxSelected
                      ]}>
                        {allStaffMembers.filter(staff => staff.staffType === 'admin').every(staff => (selectedStaff || []).includes(staff.id)) && (
                          <MaterialCommunityIcons name="check" size={14} color={COLORS.white} />
                        )}
                      </View>
                      <Text style={styles.selectAllText}>Select All Admin Staff</Text>
                    </TouchableOpacity>

                    {allStaffMembers
                      .filter(staff => staff.staffType === 'admin')
                      .map(staff => (
                        <StaffSelectionItem 
                          key={staff.id} 
                          staff={staff} 
                          selected={(selectedStaff || []).includes(staff.id)}
                          onToggle={(staffId) => {
                            setSelectedStaff(prev => 
                              (prev || []).includes(staffId) 
                                ? (prev || []).filter(id => id !== staffId)
                                : [...(prev || []), staffId]
                            );
                          }}
                        />
                      ))}
                  </View>
                </>
              )}

              {allStaffMembers.length === 0 && (
                <View style={styles.emptyHistoryState}>
                  <MaterialCommunityIcons name="account-off" size={48} color={COLORS.textMuted} />
                  <Text style={styles.emptyStateText}>No staff members found</Text>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.generateButton,
                (selectedStaff || []).length === 0 && styles.generateButtonDisabled
              ]}
              disabled={(selectedStaff || []).length === 0}
              onPress={() => {
                const staffToGenerate = allStaffMembers.filter(staff => 
                  (selectedStaff || []).includes(staff.id)
                );
                generatePayslipsForStaff(staffToGenerate);
              }}
            >
              <Text style={styles.generateButtonText}>
                Generate Payslips ({(selectedStaff || []).length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Payment Method Selection Modal */}
      <Modal
        visible={paymentMethodModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setPaymentMethodModalVisible(false);
          setPayslipToPay(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.paymentModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Payment Method</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setPaymentMethodModalVisible(false);
                  setPayslipToPay(null);
                }}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {payslipToPay && (
              <View style={styles.paymentInfoSection}>
                <Text style={styles.paymentInfoText}>
                  Pay <Text style={styles.paymentAmount}>J${parseFloat(payslipToPay.netPay).toLocaleString()}</Text> to {payslipToPay.staffName}
                </Text>
              </View>
            )}

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalSubtitle}>Choose your payment method:</Text>
              
              {paymentMethods.map((method) => (
                <TouchableOpacity
                  key={method.id}
                  style={styles.paymentMethodCard}
                  onPress={() => {
                    setSelectedPaymentMethod(method);
                    Alert.alert(
                      'Confirm Payment',
                      `Pay J$${parseFloat(payslipToPay.netPay).toLocaleString()} to ${payslipToPay.staffName} using ${method.name}?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { 
                          text: 'Pay Now',
                          onPress: async () => {
                            setPaymentMethodModalVisible(false);
                            await processPayment(payslipToPay, method);
                            setPayslipToPay(null);
                          }
                        }
                      ]
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.paymentCardPreview, { backgroundColor: method.bgColor }]}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardTypeContainer}>
                        <MaterialCommunityIcons name={method.icon} size={24} color="white" />
                        <Text style={styles.cardTypeText}>{method.type.toUpperCase()}</Text>
                      </View>
                      {method.default && (
                        <View style={styles.defaultBadge}>
                          <Text style={styles.defaultBadgeText}>Default</Text>
                        </View>
                      )}
                    </View>
                    
                    <View style={styles.cardMiddle}>
                      <Text style={styles.cardName}>{method.name}</Text>
                      {method.bankName && (
                        <Text style={styles.bankDetails}>{method.bankName}</Text>
                      )}
                    </View>
                    
                    <View style={styles.cardFooter}>
                      <MaterialCommunityIcons name="chevron-right" size={20} color="white" />
                    </View>
                  </View>
                </TouchableOpacity>
              ))}

              {paymentMethods.length === 0 && (
                <View style={styles.emptyPaymentMethods}>
                  <MaterialCommunityIcons name="credit-card-off" size={48} color={COLORS.textMuted} />
                  <Text style={styles.emptyPaymentText}>No payment methods configured</Text>
                  <TouchableOpacity 
                    style={styles.addPaymentMethodButton}
                    onPress={() => {
                      setPaymentMethodModalVisible(false);
                      navigation.navigate('PaymentSettings');
                    }}
                  >
                    <Text style={styles.addPaymentMethodText}>Add Payment Method</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// Staff Selection Item Component
const StaffSelectionItem = ({ staff, selected, onToggle }) => {
  if (!staff) return null;
  
  return (
    <TouchableOpacity
      style={[styles.staffItem, selected && styles.staffItemSelected]}
      onPress={() => onToggle && onToggle(staff.id)}
    >
      <View style={[styles.staffCheckbox, selected && styles.staffCheckboxSelected]}>
        {selected && (
          <MaterialCommunityIcons name="check" size={14} color={COLORS.white} />
        )}
      </View>
      <View style={styles.staffInfo}>
        <Text style={styles.staffName}>{staff.name || 'Unknown Staff'}</Text>
        <Text style={styles.staffRole}>
          {staff.role || 'Unknown Role'} • {staff.payType === 'salary' ? 'Salary' : 'Hourly'}
        </Text>
        <Text style={styles.staffIdentifier}>{staff.code || staff.id}</Text>
      </View>
      <View style={styles.payTypeIndicator}>
        <MaterialCommunityIcons 
          name={staff.staffType === 'admin' ? 'account-tie' : 'medical-bag'} 
          size={20} 
          color={staff.staffType === 'admin' ? (COLORS.accent || COLORS.primary) : COLORS.primary} 
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
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
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.white,
    opacity: 0.85,
  },
  headerSubtitleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerSubtitleIcon: {
    marginTop: 0,
  },
  headerSubtitleWarning: {
    color: COLORS.warning,
  },
  headerSubtitleSuccess: {
    color: COLORS.success,
  },
  exportButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchToggle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 25,
    marginHorizontal: 20,
    marginTop: 15,
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  headerSearchInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: 16,
    marginLeft: 10,
    marginRight: 10,
  },
  clearSearchButton: {
    padding: 4,
  },
  filterSection: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
  },
  validationSection: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  validationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  validationTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  validationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  validationTimestamp: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  validationRefreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: '#ff8a00',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  validationRefreshText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
    textTransform: 'uppercase',
  },
  validationSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  validationLabel: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  validationValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  validationValueWarning: {
    color: COLORS.warning,
  },
  validationCleanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.success + '15',
  },
  validationCleanText: {
    fontSize: 13,
    color: COLORS.success,
    fontWeight: '600',
  },
  validationIssuesContainer: {
    gap: 8,
  },
  validationIssueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: COLORS.warning + '10',
  },
  validationIssueText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
  },
  validationMoreText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  filterPillContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
    marginTop: 16,
    marginBottom: 20,
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
  // Payslip Preview Section Styles (matching Invoice Management)
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
  shareIconButtonDisabled: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  payslipPreviewBackdrop: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payslipPreviewCard: {
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
  noPayslipSelected: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginTop: 12,
  },
  noPayslipText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
    textAlign: 'center',
  },
  samplePreviewContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  samplePayslipCard: {
    opacity: 0.9,
  },
  sampleBanner: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '08',
    marginBottom: 12,
  },
  sampleBannerCopy: {
    flex: 1,
    gap: 4,
  },
  sampleBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  sampleBannerText: {
    fontSize: 12,
    color: COLORS.primary,
    lineHeight: 16,
  },
  filterContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  filterContent: {
    paddingRight: 20,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    minHeight: 36,
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  filterTabActive: {
    backgroundColor: 'transparent',
  },
  filterTabText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
  },
  filterTabTextActive: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  transactionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  transactionLeft: {
    flex: 1,
  },
  transactionInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  serviceName: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
    textTransform: 'capitalize',
  },
  paymentMethod: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  newTransactionButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 20,
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  newTransactionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 8,
  },
  newTransactionText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  bottomPadding: {
    height: 40,
  },
  // Payment Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    margin: 20,
    maxHeight: '80%',
    width: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  reviewModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    margin: 20,
    width: '95%',
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
    marginRight: -30,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalContent: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  formColumn: {
    flex: 1,
  },
  formLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  formLabelSmall: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  staffSelector: {
    flexDirection: 'row',
  },
  staffCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    minWidth: 120,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedStaffCard: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  staffName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  selectedStaffName: {
    color: COLORS.primary,
  },
  staffRole: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  staffRate: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.success,
  },
  categorySelector: {
    flexDirection: 'row',
  },
  categoryChip: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedCategoryChip: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  selectedCategoryText: {
    color: COLORS.white,
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
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  methodSelector: {
    flexDirection: 'row',
  },
  methodChip: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedMethodChip: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  methodText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  selectedMethodText: {
    color: COLORS.white,
  },
  submitButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 20,
  },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  reviewSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  reviewLabel: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  reviewValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  reviewValuePrimary: {
    color: COLORS.primary,
  },
  statusToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  statusToggle: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: 'center',
  },
  statusToggleActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  statusToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  statusToggleTextActive: {
    color: COLORS.primary,
  },
  reviewTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 20,
  },
  reviewModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  reviewCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  reviewSaveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  reviewCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  reviewSaveText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  
  // Payslip Preview Styles (similar to invoice management)
  previewSection: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  previewShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '10',
  },
  previewShareText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  payslipScrollView: {
    maxHeight: 450,
  },
  payslipPreviewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    marginBottom: 12,
  },
  payTemplateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 8,
  },
  payTemplateTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#0066CC',
  },
  payTemplateCompany: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  payTemplateLogo: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    backgroundColor: COLORS.white,
  },
  payTemplateLogoText: {
    fontSize: 11,
    color: '#FFA500',
    fontWeight: '600',
  },
  payTemplateCompanyInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 18,
  },
  payTemplateCompanyColumn: {
    flex: 1,
  },
  payTemplateCompanyColumnRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  payTemplateCompanyDetail: {
    fontSize: 11,
    color: '#666',
    marginTop: 3,
    lineHeight: 16,
  },
  payTemplateDivider: {
    height: 2,
    backgroundColor: '#333',
    marginHorizontal: 24,
    marginBottom: 24,
  },
  payTemplateFieldGrid: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    gap: 14,
  },
  payTemplateFieldRow: {
    flexDirection: 'row',
    gap: 14,
  },
  payTemplateField: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#CCCCCC',
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    minHeight: 68,
    justifyContent: 'space-between',
  },
  payTemplateFieldLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#888',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payTemplateFieldValue: {
    fontSize: 15,
    fontWeight: '400',
    color: '#222',
    lineHeight: 20,
  },
  employeeInfoSection: {
    marginBottom: 0,
  },
  earningsSection: {
    marginBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.white,
    flex: 1,
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  tableCell: {
    fontSize: 10,
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 40,
  },
  totalValue: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    minWidth: 80,
    textAlign: 'center',
  },
  deductionsSection: {
    marginBottom: 0,
  },
  netPaySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  netPayLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  netPayAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  pdfHeader: {
    backgroundColor: COLORS.white,
    paddingTop: 16,
  },
  pdfHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pdfCompanyInfo: {
    flex: 1,
  },
  pdfCompanyName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00B8D4',
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
    backgroundColor: '#00B8D4',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  pdfClientSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pdfClientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pdfBillTo: {
    flex: 1,
    marginRight: 16,
  },
  pdfServiceProvider: {
    flex: 1,
  },
  pdfSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pdfTable: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    marginBottom: 16,
  },
  pdfTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5',
    paddingVertical: 8,
    paddingHorizontal: 8,
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
    paddingVertical: 8,
    paddingHorizontal: 8,
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
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  pdfPaymentInfo: {
    fontSize: 9,
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
  closePreviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
    marginHorizontal: 16,
    gap: 8,
  },
  closePreviewText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  noPayslipSelected: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: 12,
  },
  noPayslipText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
    textAlign: 'center',
  },
  
  // Payslip Card Styles
  payslipsList: {
    padding: 16,
  },
  payslipCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  payslipCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  payslipCardInfo: {
    flex: 1,
  },
  payslipCardId: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 4,
  },
  payslipCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  payslipHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  payslipInfo: {
    flex: 1,
  },
  staffIdentifier: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  roleName: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 2,
  },
  periodDate: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  periodDateSmall: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  payslipMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.background,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  payslipAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  amountBreakdown: {
    alignItems: 'flex-end',
  },
  breakdownLabel: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  sessionInfo: {
    fontSize: 11,
    color: COLORS.primary,
    marginTop: 2,
    fontWeight: '500',
  },
  cardActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardActionButton: {
    overflow: 'hidden',
    borderRadius: 20,
  },
  cardActionGradient: {
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
    flexDirection: 'row',
    gap: 6,
  },
  cardActionText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  cardActionDisabled: {
    backgroundColor: COLORS.textLight,
  },
  cardActionSolidTextDisabled: {
    color: COLORS.white,
    opacity: 0.9,
  },
  payslipDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  payslipAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  amountLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  reviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: COLORS.success + '15',
  },
  reviewBadgeText: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: '600',
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
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
  // Work Activity Breakdown Styles
  pdfWorkActivitySection: {
    backgroundColor: COLORS.background,
    padding: 16,
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pdfWorkActivityList: {
    marginTop: 12,
  },
  pdfWorkActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  pdfWorkActivityText: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
    marginLeft: 8,
  },
  pdfWorkActivityTextBold: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: 'bold',
    flex: 1,
    marginLeft: 8,
  },
  pdfWorkActivityValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    minWidth: 30,
    textAlign: 'right',
  },
  pdfWorkActivityValueBold: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    minWidth: 50,
    textAlign: 'right',
  },
  pdfWorkActivityHours: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
    minWidth: 45,
  },
  pdfWorkActivityDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  // Search Results Styles
  searchResultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchResultsText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  clearSearchSmall: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: COLORS.border,
  },
  clearSearchInline: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  clearSearchText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  // History Modal Styles
  historyList: {
    padding: 16,
  },
  historyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  historyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: COLORS.lightGray,
  },
  historyMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  historyPeriod: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  historyAmount: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  emptyHistoryState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  // Generate Payslip Modal Styles
  staffSelectionContainer: {
    maxHeight: 400,
  },
  staffTypeHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  staffListContainer: {
    paddingHorizontal: 16,
  },
  staffItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  staffItemSelected: {
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary,
  },
  staffCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffCheckboxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  staffInfo: {
    flex: 1,
  },
  staffName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  staffRole: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  staffCode: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '500',
  },
  generateButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    margin: 16,
    alignItems: 'center',
  },
  generateButtonDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  generateButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary,
    marginLeft: 8,
  },
  payTypeIndicator: {
    marginLeft: 8,
  },
  // Payment Method Selection Styles
  paymentInfoSection: {
    backgroundColor: COLORS.background,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  paymentInfoText: {
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
  },
  paymentAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 16,
  },
  paymentMethodCard: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  paymentCardPreview: {
    padding: 16,
    minHeight: 100,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTypeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 1,
  },
  defaultBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  defaultBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  cardMiddle: {
    flex: 1,
    justifyContent: 'center',
  },
  cardName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  bankDetails: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '400',
  },
  cardFooter: {
    alignItems: 'flex-end',
  },
  emptyPaymentMethods: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyPaymentText: {
    fontSize: 16,
    color: COLORS.textMuted,
    marginTop: 12,
    marginBottom: 20,
  },
  addPaymentMethodButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  addPaymentMethodText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default RecentTransactionsScreen;
