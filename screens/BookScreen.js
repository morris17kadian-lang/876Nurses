import TouchableWeb from "../components/TouchableWeb";
import React, { useState, useContext, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  Platform,
  FlatList,
  Pressable,
  Keyboard,
  Modal,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Timestamp } from 'firebase/firestore';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { useServices } from '../context/ServicesContext';
import { getAddressSuggestions } from '../utils/addressData';
import { useAppointments } from '../context/AppointmentContext';
import { useAuth } from '../context/AuthContext';
import NurseDetailsModal from '../components/NurseDetailsModal';
import InvoiceService from '../services/InvoiceService';
import FygaroPaymentService from '../services/FygaroPaymentService';
import FirebaseService from '../services/FirebaseService';
import ApiService from '../services/ApiService';
import PushNotificationService from '../services/PushNotificationService';

const DAYS_OF_WEEK = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

const CONSULTATION_SERVICE_TITLE = 'Consultation Call (Phone Advice)';
const CONSULTATION_FEE_JMD = 1500;
const CONSULTATION_PHONE_NUMBER = '8766189876';
const CONSULTATION_SCHEDULE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

const ALLERGY_GROUPS = [
  { title: 'Basics', options: ['None'] },
  {
    title: 'Medications',
    options: [
      'Penicillin',
      'Amoxicillin',
      'Cephalosporins',
      'Sulfa (Sulfonamides)',
      'Aspirin',
      'NSAIDs (Ibuprofen/Naproxen)',
      'Opioids (Morphine/Codeine)',
      'Anesthesia',
      'Iodine / Contrast Dye',
    ],
  },
  {
    title: 'Foods',
    options: [
      'Shellfish',
      'Fish',
      'Seafood',
      'Peanuts',
      'Tree Nuts',
      'Sesame',
      'Dairy / Milk',
      'Eggs',
      'Soy',
      'Wheat / Gluten',
    ],
  },
  {
    title: 'Environmental',
    options: ['Pollen', 'Dust Mites', 'Pet Dander', 'Mold', 'Insect Stings (Bee/Wasp)'],
  },
  {
    title: 'Contact / Topical',
    options: ['Latex', 'Adhesive / Tape', 'Chlorhexidine', 'Fragrances / Perfume', 'Nickel'],
  },
  { title: 'Other', options: ['Other'] },
];

export default function BookScreen({ navigation, route }) {
  const { services } = useServices();
  const { bookAppointment, cancelAppointment } = useAppointments();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const addressInputRef = useRef(null);

  const NON_BOOKABLE_SERVICE_TITLES = useMemo(
    () =>
      new Set([
        'Home Care Assistance',
        'Alternative Post Op Care',
        'Alternative Post-Op Care',
        'Alternate Post Op Care',
        'Alternate Post-Op Care',
      ].map((t) => String(t).trim().toLowerCase())),
    []
  );

  const bookableServices = useMemo(() => {
    const list = Array.isArray(services) ? services : [];
    return list.filter((s) => {
      const title = String(s?.title || '').trim().toLowerCase();
      return title && !NON_BOOKABLE_SERVICE_TITLES.has(title);
    });
  }, [services, NON_BOOKABLE_SERVICE_TITLES]);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    services: [], // Changed from single service to array
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    notes: '',
    patientAlerts: {
      allergies: [],
      allergyOther: '',
      vitals: {
        bpSystolic: '',
        bpDiastolic: '',
        heartRate: '',
        temperature: '',
        oxygenSaturation: '',
      },
    },
    subscriptionPlan: '',
    preferredNurseId: null,
    preferredNurseName: '',
    preferredNurseCode: '',
    preferredNursePhoto: '',
  });
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositRequiredSetting, setDepositRequiredSetting] = useState(true);
  const [depositPercentSetting, setDepositPercentSetting] = useState(20);
  const [totalAmount, setTotalAmount] = useState(0);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [processingConsultationPayment, setProcessingConsultationPayment] = useState(false);
  const [consultationModalVisible, setConsultationModalVisible] = useState(false);
  const [consultationScheduledDate, setConsultationScheduledDate] = useState(null);
  const [consultationScheduledHour, setConsultationScheduledHour] = useState(null);
  const [consultationScheduledMinute, setConsultationScheduledMinute] = useState(null);
  const [showConsultationDatePicker, setShowConsultationDatePicker] = useState(false);
  const [showConsultationTimePicker, setShowConsultationTimePicker] = useState(false);
  const [consultationPickerDate, setConsultationPickerDate] = useState(new Date());
  const [consultationPickerTime, setConsultationPickerTime] = useState(new Date());
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showSubscriptionDropdown, setShowSubscriptionDropdown] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState('weekly');
  const [recurringDuration, setRecurringDuration] = useState(1);
  const [selectedDays, setSelectedDays] = useState([]);
  const [autoEmailInvoices, setAutoEmailInvoices] = useState(false);
  const [showAllergyPicker, setShowAllergyPicker] = useState(false);
  const [allergySearchQuery, setAllergySearchQuery] = useState('');

  const filteredAllergyItems = useMemo(() => {
    const q = String(allergySearchQuery || '').trim().toLowerCase();
    const matches = (label) => {
      if (!q) return true;
      return String(label || '').toLowerCase().includes(q);
    };

    const items = [];
    ALLERGY_GROUPS.forEach((group) => {
      const visible = Array.isArray(group?.options) ? group.options.filter(matches) : [];
      if (visible.length === 0) return;
      items.push({ type: 'header', label: group.title });
      visible.forEach((opt) => items.push({ type: 'option', label: opt }));
    });

    return items;
  }, [allergySearchQuery]);

  const toggleAllergy = (label) => {
    const value = String(label || '').trim();
    if (!value) return;

    setFormData((prev) => {
      const current = prev?.patientAlerts?.allergies;
      const allergies = Array.isArray(current) ? current : [];

      if (value === 'None') {
        return {
          ...prev,
          patientAlerts: {
            ...(prev.patientAlerts || {}),
            allergies: [],
            allergyOther: '',
          },
        };
      }

      const next = allergies.includes(value)
        ? allergies.filter((a) => a !== value)
        : [...allergies.filter((a) => a !== 'None'), value];

      const shouldClearOther = value === 'Other' ? false : next.includes('Other') === false;

      return {
        ...prev,
        patientAlerts: {
          ...(prev.patientAlerts || {}),
          allergies: next,
          allergyOther: shouldClearOther ? '' : (prev?.patientAlerts?.allergyOther || ''),
        },
      };
    });
  };

  const setVitalField = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      patientAlerts: {
        ...(prev.patientAlerts || {}),
        vitals: {
          ...((prev.patientAlerts && prev.patientAlerts.vitals) || {}),
          [key]: value,
        },
      },
    }));
  };
  const [isEditingUserDetails, setIsEditingUserDetails] = useState(false);

  // Nurse selection
  const [nurses, setNurses] = useState([]);
  const [loadingNurses, setLoadingNurses] = useState(false);
  const [showNurseModal, setShowNurseModal] = useState(false);
  const [nurseSearch, setNurseSearch] = useState('');
  const [nurseDetailsModalVisible, setNurseDetailsModalVisible] = useState(false);
  const [selectedNurseDetails, setSelectedNurseDetails] = useState(null);

  const preferredNurseFromList = useMemo(() => {
    const id = formData?.preferredNurseId;
    if (!id || !Array.isArray(nurses)) return null;
    return nurses.find((n) => String(n?.id) === String(id)) || null;
  }, [formData?.preferredNurseId, nurses]);

  const preferredNursePhotoUri =
    formData?.preferredNursePhoto ||
    preferredNurseFromList?.profilePhoto ||
    preferredNurseFromList?.profileImage ||
    preferredNurseFromList?.photoUrl ||
    preferredNurseFromList?.photo ||
    '';

  const preferredNurseInitials = (formData?.preferredNurseName || 'N')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => (p[0] || '').toUpperCase())
    .join('') || 'N';
  
  // Reschedule state
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [originalAppointmentId, setOriginalAppointmentId] = useState(null);

  // Handle reschedule params
  useEffect(() => {
    if (route?.params?.reschedule) {
      setIsRescheduling(true);
      setOriginalAppointmentId(route.params.appointmentId);
      
      setFormData(prev => ({
        ...prev,
        services:
          route.params.service && !NON_BOOKABLE_SERVICE_TITLES.has(String(route.params.service).trim().toLowerCase())
            ? [route.params.service]
            : [],
        // We don't set date/time here as the user needs to pick NEW ones
      }));
      
      // Alert user they are rescheduling
      Alert.alert(
        'Rescheduling Appointment',
        `Please select a new date and time for your ${route.params.service} appointment.`
      );
    }
  }, [route?.params]);

  // If anything non-bookable slips in (storage/older params), remove it.
  useEffect(() => {
    setFormData((prev) => {
      const current = Array.isArray(prev?.services) ? prev.services : [];
      const filtered = current.filter(
        (t) => !NON_BOOKABLE_SERVICE_TITLES.has(String(t).trim().toLowerCase())
      );
      if (filtered.length === current.length) return prev;
      return { ...prev, services: filtered };
    });
  }, [NON_BOOKABLE_SERVICE_TITLES]);

  // Autofill form data from user profile
  useEffect(() => {
    if (user) {
      // Build name from available fields
      const name = user.fullName || 
                   (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : '') ||
                   user.name || 
                   user.username || '';
      
      // Handle address - could be object or string
      const address = typeof user.address === 'object' && user.address?.street 
        ? user.address.street 
        : (typeof user.address === 'string' ? user.address : '');
      
      setFormData(prev => ({
        ...prev,
        name: name,
        email: user.email || '',
        phone: user.phone || '',
        address: address,
      }));
    }
  }, [user]);

  // Sync user details when they change (email, phone, address)
  useEffect(() => {
    if (!isEditingUserDetails && user) {
      const address = typeof user.address === 'object' && user.address?.street 
        ? user.address.street 
        : (typeof user.address === 'string' ? user.address : '');
      
      setFormData(prev => ({
        ...prev,
        email: user.email || '',
        phone: user.phone || '',
        address: address,
      }));
    }
  }, [user?.email, user?.phone, user?.address, isEditingUserDetails]);

  // Load admin-configured deposit defaults
  useEffect(() => {
    let isMounted = true;
    const loadDepositPolicy = async () => {
      try {
        const raw = await AsyncStorage.getItem('adminPaymentGeneralSettings');
        if (!raw) return;
        const parsed = JSON.parse(raw);

        if (typeof parsed?.depositRequired === 'boolean' && isMounted) {
          setDepositRequiredSetting(parsed.depositRequired);
        }
        if (Number.isFinite(parsed?.depositPercent) && isMounted) {
          const pct = Math.max(0, Math.min(100, Number(parsed.depositPercent)));
          setDepositPercentSetting(pct);
        }
      } catch (error) {
        console.error('Error loading deposit settings:', error);
      }
    };
    loadDepositPolicy();
    return () => {
      isMounted = false;
    };
  }, []);

  // Calculate total amount whenever services change
  useEffect(() => {
    if (formData.services.length > 0) {
      const total = formData.services.reduce((sum, serviceName) => {
        const service = services.find(s => s.title === serviceName);
        // Parse price from string format (e.g., "J$7,500" or "J$15,000/hr")
        const priceStr = service?.price || '';
        const priceMatch = priceStr.match(/[\d,]+/);
        const numericPrice = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : 0;
        return sum + numericPrice;
      }, 0);
      
      // For recurring appointments, calculate total for all instances
      if (isRecurring) {
        const numOccurrences = recurringFrequency === 'weekly' ? recurringDuration : recurringDuration;
        const recurringTotal = total * numOccurrences;
        setTotalAmount(recurringTotal);
        const depositRate = depositRequiredSetting ? (depositPercentSetting / 100) : 0;
        setDepositAmount(recurringTotal * depositRate);
      } else {
        setTotalAmount(total);
        const depositRate = depositRequiredSetting ? (depositPercentSetting / 100) : 0;
        setDepositAmount(total * depositRate);
      }
    } else {
      setTotalAmount(0);
      setDepositAmount(0);
    }
  }, [formData.services, services, isRecurring, recurringFrequency, recurringDuration, depositRequiredSetting, depositPercentSetting]);

  // Load nurses from Firebase
  useEffect(() => {
    let isMounted = true;

    const normalizeNurse = (n) => {
      const rawId = n?.id || n?._id?.$oid || n?.nurseCode || n?.code || n?.email;
      const fullName =
        n?.fullName ||
        n?.name ||
        `${n?.firstName || ''} ${n?.lastName || ''}`.trim() ||
        n?.email ||
        'Nurse';

      return {
        id: String(rawId || fullName),
        name: fullName,
        nurseCode: n?.nurseCode || n?.code || n?.staffCode || '',
        email: n?.email || '',
        phone: n?.phone || n?.phoneNumber || '',
        specialization: n?.specialization || n?.specialty || '',
        qualifications:
          n?.qualifications ||
          n?.qualification ||
          n?.certifications ||
          n?.certification ||
          n?.licenses ||
          n?.license ||
          '',
        nurseIdPhoto: n?.nurseIdPhoto || null,
        photoUrl: n?.profilePhoto || n?.profileImage || n?.photoUrl || n?.photo || n?.avatar || '',
        isActive: n?.isActive !== false,
      };
    };

    const load = async () => {
      setLoadingNurses(true);
      try {
        const result = await FirebaseService.getAllNurses();
        const fromFirebase = result?.success && Array.isArray(result.nurses) ? result.nurses : [];
        const source = fromFirebase;

        const normalized = source
          .map(normalizeNurse)
          .filter((n) => n?.id && n?.name && n?.isActive);

        const map = new Map();
        for (const n of normalized) {
          if (!map.has(n.id)) map.set(n.id, n);
        }

        const finalList = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        if (isMounted) setNurses(finalList);
      } catch (e) {
        if (isMounted) setNurses([]);
      } finally {
        if (isMounted) setLoadingNurses(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const subscriptionPlans = [
    { id: 'none', label: 'One-time Service', price: 'Pay per visit', popular: false },
    { id: 'basic', label: 'Basic Care', price: 'J$15,000/month', popular: false },
    { id: 'premium', label: 'Premium Care', price: 'J$30,000/month', popular: true },
    { id: 'elite', label: 'Elite Care', price: 'J$52,500/month', popular: false },
  ];

  const handleAddressChange = (text) => {
    setFormData((prev) => ({ ...prev, address: text }));
    if (text.length >= 2) {
      const suggestions = getAddressSuggestions(text);
      setAddressSuggestions(suggestions);
      setShowSuggestions(suggestions.length > 0);
    } else {
      setShowSuggestions(false);
      setAddressSuggestions([]);
    }
  };

  const selectAddress = (address) => {
    setFormData((prev) => ({ ...prev, address }));
    setShowSuggestions(false);
    setAddressSuggestions([]);
  };

  const handleAddressFocus = () => {
    if (formData.address.length >= 2) {
      const suggestions = getAddressSuggestions(formData.address);
      setAddressSuggestions(suggestions);
      setShowSuggestions(suggestions.length > 0);
    }
  };

  const handleAddressBlur = () => {
    // Delay hiding suggestions to allow for selection
    setTimeout(() => {
      setShowSuggestions(false);
    }, 300);
  };

  const handleOutsidePress = () => {
    setShowSubscriptionDropdown(false);
    setShowNurseModal(false);
  };

  const toggleDay = (dayValue) => {
    if (selectedDays.includes(dayValue)) {
      setSelectedDays(selectedDays.filter(d => d !== dayValue));
    } else {
      setSelectedDays([...selectedDays, dayValue]);
    }
  };

      const handleSubmit = async () => {
    // Validate form
    const baseMissing = !formData.name || !formData.email || !formData.phone || !formData.address || formData.services.length === 0 || !formData.startDate || !formData.startTime;
    const recurringMissing = isRecurring && (!formData.endDate || !formData.endTime);
    if (baseMissing || recurringMissing) {
      Alert.alert(
        'Error',
        isRecurring
          ? 'Please fill in all required fields including start and end date/time, and select at least one service'
          : 'Please fill in all required fields including date/time, and select at least one service'
      );
      return;
    }

    // For non-recurring appointments, show deposit payment modal
    if (!isRecurring) {
      setShowDepositModal(true);
      return;
    }

    // For recurring appointments, process directly (existing flow)
    await processRecurringAppointment();
  };

  const bookAppointmentWithoutPayment = async () => {
    const appointmentData = {
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      services: formData.services,
      service: formData.services.length > 0 ? formData.services.join(', ') : 'N/A', // Convert array to string
      preferredDate: formData.startDate,
      preferredTime: formData.startTime,
      date: formData.startDate,
      time: formData.startTime,
      startDate: formData.startDate,
      startTime: formData.startTime,
      endDate: formData.endDate || formData.startDate,
      endTime: formData.endTime || formData.startTime,
      notes: formData.notes,
      patientAlerts: formData.patientAlerts || null,
      subscriptionPlan: formData.subscriptionPlan,
      preferredNurseId: formData.preferredNurseId,
      preferredNurseName: formData.preferredNurseName || null,
      preferredNurseCode: formData.preferredNurseCode || null,
      isRecurring: false,
      patientId: user?.id || formData.email,
      patientName: formData.name,
      totalAmount: totalAmount,
      depositAmount: 0,
      paidAmount: 0,
      outstandingAmount: totalAmount,
      depositPaid: false,
      paymentStatus: 'pending',
    };

    try {
      await bookAppointment(appointmentData);
      
      Alert.alert(
        'Success',
        'Your appointment has been booked successfully! (Payment temporarily disabled for testing)',
        [{ text: 'OK', onPress: () => resetForm() }]
      );
    } catch (error) {
      console.error('Error booking appointment:', error);
      Alert.alert('Error', 'Failed to book appointment. Please try again.');
    }
  };

  const processRecurringAppointment = async () => {
    const appointmentData = {
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      services: formData.services,
      service: formData.services.length > 0 ? formData.services.join(', ') : 'N/A', // Convert array to string
      preferredDate: formData.startDate,
      preferredTime: formData.startTime,
      date: formData.startDate,
      time: formData.startTime,
      startDate: formData.startDate,
      startTime: formData.startTime,
      endDate: formData.endDate,
      endTime: formData.endTime,
      notes: formData.notes,
      patientAlerts: formData.patientAlerts || null,
      subscriptionPlan: formData.subscriptionPlan,
      preferredNurseId: formData.preferredNurseId,
      preferredNurseName: formData.preferredNurseName || null,
      preferredNurseCode: formData.preferredNurseCode || null,
      isRecurring: true,
      recurringFrequency: recurringFrequency,
      recurringDuration: recurringDuration,
      selectedDays: selectedDays,
      daysOfWeek: selectedDays,
      patientId: user?.id || formData.email,
      patientName: formData.name,
      totalAmount: totalAmount,
    };

    try {
      const nowIso = new Date().toISOString();
      const serviceLabel = formData.services.length > 0 ? formData.services.join(', ') : 'Recurring Care';

      // Create a recurring SHIFT REQUEST (not individual appointment instances).
      // This aligns patient recurring requests with the admin recurring shift request flow.
      const shiftRequestData = {
        // Patient/client info
        clientId: user?.id || formData.email,
        clientName: formData.name,
        clientEmail: formData.email,
        clientPhone: formData.phone,
        clientAddress: formData.address,
        patientId: user?.id || formData.email,
        patientName: formData.name,

        // Assignment preferences (so it can route to a nurse like admin-created schedules)
        nurseId: formData.preferredNurseId || null,
        primaryNurseId: formData.preferredNurseId || null,
        nurseName: formData.preferredNurseName || null,
        nurseCode: formData.preferredNurseCode || null,

        // Recurring schedule details
        isRecurring: true,
        adminRecurring: false,
        status: 'pending',
        service: serviceLabel,
        serviceName: serviceLabel,
        startDate: formData.startDate,
        endDate: formData.endDate,
        startTime: formData.startTime,
        endTime: formData.endTime,
        recurringFrequency,
        recurringDuration,
        daysOfWeek: selectedDays,
        selectedDays: selectedDays,
        recurringDaysOfWeek: selectedDays,
        recurringDaysOfWeekList: selectedDays,
        recurringStartTime: formData.startTime,
        recurringEndTime: formData.endTime,
        recurringPeriodStart: formData.startDate,
        recurringPeriodEnd: formData.endDate,
        recurringPattern: {
          frequency: recurringFrequency,
          daysOfWeek: selectedDays,
          startDate: formData.startDate,
          endDate: formData.endDate,
        },

        // Metadata
        notes: formData.notes,
        patientAlerts: formData.patientAlerts || null,
        requestedBy: user?.id || user?.uid || formData.email,
        requestedAt: nowIso,
        requestDate: nowIso,

        // Keep existing pricing metadata (even if payment is disabled)
        totalAmount,
        subscriptionPlan: formData.subscriptionPlan,
      };

      await ApiService.createShiftRequest(shiftRequestData);

      Alert.alert(
        'Success',
        'Your recurring care request has been submitted. You will be notified once it is accepted and scheduled.',
        [{ text: 'OK', onPress: () => resetForm() }]
      );
    } catch (error) {
      console.error('Error creating recurring shift request:', error);
      Alert.alert('Error', 'Failed to submit recurring care request. Please try again.');
    }
  };

  const openConsultationDialer = async () => {
    try {
      const telUrl = `tel:${CONSULTATION_PHONE_NUMBER}`;
      const supported = await Linking.canOpenURL(telUrl);
      if (!supported) {
        Alert.alert('Call Unavailable', 'Your device cannot place phone calls.');
        return;
      }
      await Linking.openURL(telUrl);
    } catch (error) {
      Alert.alert('Call Failed', 'Unable to open the phone dialer.');
    }
  };

  const resetConsultationSchedule = () => {
    setConsultationScheduledDate(null);
    setConsultationScheduledHour(null);
    setConsultationScheduledMinute(null);
    setShowConsultationDatePicker(false);
    setShowConsultationTimePicker(false);
  };

  const formatConsultationHourLabel = (hour, minute = 0) => {
    if (hour == null) return '';
    const h = Number(hour);
    const m = Number(minute || 0);
    if (Number.isNaN(h)) return '';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    const paddedMinute = String(m).padStart(2, '0');
    return `${display}:${paddedMinute} ${ampm}`;
  };

  const buildConsultationScheduledFor = () => {
    if (!consultationScheduledDate || consultationScheduledHour == null) return null;
    const d = new Date(consultationScheduledDate);
    const minute = consultationScheduledMinute != null ? Number(consultationScheduledMinute) : 0;
    d.setHours(Number(consultationScheduledHour), minute, 0, 0);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  };

  const openConsultationDatePicker = () => {
    const base = consultationScheduledDate ? new Date(consultationScheduledDate) : new Date();
    setConsultationPickerDate(base);
    setShowConsultationDatePicker(true);
  };

  const openConsultationTimePicker = () => {
    const base = consultationScheduledDate ? new Date(consultationScheduledDate) : new Date();
    const pickerBase = new Date(base);
    // Default to 9 AM if no time selected yet, otherwise use the stored hour
    const hour = consultationScheduledHour == null ? 9 : Number(consultationScheduledHour);
    const safeHour = Number.isNaN(hour) ? 9 : Math.min(Math.max(hour, 9), 17);
    pickerBase.setHours(safeHour, 0, 0, 0);
    setConsultationPickerTime(pickerBase);
    setShowConsultationTimePicker(true);
  };

  const onConsultationDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowConsultationDatePicker(false);
      if (event?.type === 'dismissed') return;
      const chosen = date || consultationPickerDate;
      if (!chosen || Number.isNaN(new Date(chosen).getTime())) return;
      setConsultationPickerDate(new Date(chosen));
      setConsultationScheduledDate(new Date(chosen));
      return;
    }

    if (date && !Number.isNaN(new Date(date).getTime())) {
      setConsultationPickerDate(new Date(date));
    }
  };

  const confirmConsultationDateSelection = () => {
    if (!consultationPickerDate || Number.isNaN(new Date(consultationPickerDate).getTime())) {
      setShowConsultationDatePicker(false);
      return;
    }
    setConsultationScheduledDate(new Date(consultationPickerDate));
    setShowConsultationDatePicker(false);
  };

  const onConsultationTimeChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowConsultationTimePicker(false);
      if (event?.type === 'dismissed') return;
      const chosen = date || consultationPickerTime;
      if (!chosen || Number.isNaN(new Date(chosen).getTime())) return;
      const d = new Date(chosen);
      const clampedHour = Math.min(Math.max(d.getHours(), 9), 17);
      d.setHours(clampedHour, 0, 0, 0);
      setConsultationPickerTime(d);
      setConsultationScheduledHour(clampedHour);
      return;
    }

    // For iOS: only track the selection, don't update state until user confirms (Done)
    // Updating consultationPickerTime during onChange interferes with the picker
    if (date && !Number.isNaN(new Date(date).getTime())) {
      setConsultationPickerTime(new Date(date));
    }
  };

  const confirmConsultationTimeSelection = () => {
    if (!consultationPickerTime || Number.isNaN(new Date(consultationPickerTime).getTime())) {
      setShowConsultationTimePicker(false);
      return;
    }
    const d = new Date(consultationPickerTime);
    const clampedHour = Math.min(Math.max(d.getHours(), 9), 17);
    const minute = d.getMinutes();
    setConsultationScheduledHour(clampedHour);
    setConsultationScheduledMinute(minute);
    setShowConsultationTimePicker(false);
  };

  const startPaidConsultationPayment = async () => {
    if (processingConsultationPayment) return;

    const scheduledFor = buildConsultationScheduledFor();
    const scheduledHour = consultationScheduledHour;
    const scheduledDate = consultationScheduledDate;
    const attemptingSchedule = Boolean(consultationScheduledDate || consultationScheduledHour != null);

    if (attemptingSchedule && !scheduledFor) {
      Alert.alert('Missing Schedule', 'Please select both a date and a time slot (9am–5pm), or clear the schedule to call now.');
      return;
    }
    if (scheduledFor && scheduledFor.getTime() <= Date.now()) {
      Alert.alert('Invalid Time', 'Please choose a future date and time for your scheduled consultation call.');
      return;
    }

    const email = String(formData?.email || '').trim();
    const name = String(formData?.name || '').trim();

    if (!name || !email) {
      Alert.alert('Missing Info', 'Please enter your name and email address before scheduling a consultation.');
      return;
    }

    setProcessingConsultationPayment(true);
    try {
      const isScheduled = Boolean(scheduledFor);
      const scheduleDesc = isScheduled 
        ? `scheduled for ${scheduledFor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${formatConsultationHourLabel(scheduledHour, consultationScheduledMinute)}`
        : 'immediate call';

      // Initialize Fygaro payment for consultation
      const paymentResult = await FygaroPaymentService.initializePayment({
        amount: CONSULTATION_FEE_JMD,
        currency: 'JMD',
        customerId: user?.id || email,
        customerName: name,
        customerEmail: email,
        customerPhone: formData?.phone || '',
        description: `Consultation call (${scheduleDesc})`,
        metadata: {
          type: 'consultation',
          isScheduled: isScheduled,
          scheduledFor: isScheduled ? scheduledFor.toISOString() : null,
          scheduledHour: scheduledHour ?? null,
          consultationFee: CONSULTATION_FEE_JMD,
        }
      });

      if (paymentResult.success) {
        // Store consultation details for after payment verification
        const consultationDetails = {
          scheduledFor,
          scheduledHour,
          scheduledDate,
          isScheduled,
          name,
          email,
        };

        // For web, open payment in new tab
        if (Platform.OS === 'web') {
          window.open(paymentResult.paymentUrl, '_blank');
          
          Alert.alert(
            'Payment Window Opened',
            'Complete your consultation payment in the new window. Once done, return here and click "Verify Payment" to continue.',
            [
              {
                text: 'Verify Payment',
                onPress: () => handleVerifyConsultationPayment(paymentResult.transactionId, consultationDetails)
              },
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: () => {
                  setConsultationModalVisible(false);
                  setProcessingConsultationPayment(false);
                }
              }
            ]
          );
        } else {
          // For mobile, navigate to webview
          setConsultationModalVisible(false);
          setProcessingConsultationPayment(false);
          
          navigation.navigate('PaymentWebview', {
            paymentUrl: paymentResult.paymentUrl,
            sessionId: paymentResult.sessionId,
            transactionId: paymentResult.transactionId,
            onSuccess: () => handleVerifyConsultationPayment(paymentResult.transactionId, consultationDetails)
          });
        }
      } else {
        Alert.alert('Payment Error', paymentResult.error || 'Failed to initialize consultation payment');
        setProcessingConsultationPayment(false);
      }
    } catch (error) {
      console.error('Consultation payment error:', error);
      Alert.alert('Error', 'Failed to process consultation payment');
      setProcessingConsultationPayment(false);
    }
  };

  const handleVerifyConsultationPayment = async (transactionId, consultationDetails) => {
    try {
      setProcessingConsultationPayment(true);

      // Verify payment with Fygaro
      const verificationResult = await FygaroPaymentService.verifyPayment(transactionId);

      if (verificationResult.success && verificationResult.status === 'completed') {
        // Payment verified, create consultation request
        await createConsultationRequestAfterPayment(transactionId, consultationDetails);
      } else {
        Alert.alert('Verification Failed', 'Payment could not be verified. Please contact support.');
        setProcessingConsultationPayment(false);
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      Alert.alert('Error', 'Failed to verify consultation payment');
      setProcessingConsultationPayment(false);
    }
  };

  const createConsultationRequestAfterPayment = async (transactionId, consultationDetails) => {
    try {
      const { scheduledFor, scheduledHour, scheduledDate, isScheduled, name, email } = consultationDetails;
      const patientId = user?.id || user?.uid || email;

      // Save consultation request to Firebase with payment info
      await FirebaseService.createConsultationRequest({
        patientId,
        patientAuthUid: user?.uid || null,
        patientName: name,
        patientEmail: email,
        patientPhone: formData?.phone || '',
        address: formData?.address || '',
        consultationFeeJmd: CONSULTATION_FEE_JMD,
        currency: 'JMD',
        consultationPhone: CONSULTATION_PHONE_NUMBER,
        scheduledFor: isScheduled ? Timestamp.fromDate(scheduledFor) : null,
        scheduledForIso: isScheduled ? scheduledFor.toISOString() : null,
        scheduledHour: scheduledHour ?? null,
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : null,
        createdByUid: user?.uid || undefined,
        status: isScheduled ? 'pending' : 'call_requested',
        source: 'BookScreen',
        preferredNurseId: formData?.preferredNurseId || null,
        preferredNurseName: formData?.preferredNurseName || null,
        preferredNurseCode: formData?.preferredNurseCode || null,
        // Payment information
        isPaid: true,
        paymentMethod: 'fygaro',
        transactionId: transactionId,
        paidAt: new Date().toISOString(),
      });

      // If scheduled: add a local push notification reminder + save to AsyncStorage for the patient's reminder list
      if (isScheduled) {
        try {
          const reminderTime = new Date(scheduledFor.getTime() - 30 * 60 * 1000); // 30 min before
          const notifyAt = reminderTime > new Date() ? reminderTime : scheduledFor;
          const reminderBody = `Your consultation call with 876 Nurses is scheduled for ${scheduledFor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${formatConsultationHourLabel(scheduledHour, consultationScheduledMinute)}.`;

          let notificationId = null;
          try {
            notificationId = await PushNotificationService.scheduleNotification(
              'Consultation Reminder',
              reminderBody,
              notifyAt,
              { type: 'consultation_reminder', screen: 'Appointments' }
            );
          } catch (_) {
            // Push notification may fail in Expo Go — still save the reminder
          }

          // Save reminder to AsyncStorage so it appears in the Home screen reminder list
          if (user?.id) {
            try {
              const storageKey = `@876_home_reminders_${user.id}`;
              const existing = await AsyncStorage.getItem(storageKey);
              const reminders = existing ? JSON.parse(existing) : [];
              const newReminder = {
                id: Date.now(),
                text: reminderBody,
                date: scheduledFor.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                time: formatConsultationHourLabel(scheduledHour, consultationScheduledMinute),
                completed: false,
                notificationId,
                scheduledDateTime: notifyAt.toISOString(),
                type: 'consultation',
              };
              await AsyncStorage.setItem(storageKey, JSON.stringify([...reminders, newReminder]));
            } catch (_) {
              // Non-critical
            }
          }
        } catch (_) {
          // Non-critical — don't block the flow
        }
      }

      // Notify admin via Firestore notification
      try {
        await ApiService.createNotification({
          userId: 'admin',
          type: 'consultation_request',
          title: isScheduled ? 'New Paid Consultation Scheduled' : 'New Paid Consultation Request',
          body: isScheduled
            ? `${name} has paid J$${CONSULTATION_FEE_JMD.toLocaleString()} and scheduled a consultation call for ${scheduledFor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${formatConsultationHourLabel(scheduledHour, consultationScheduledMinute)}.`
            : `${name} has paid J$${CONSULTATION_FEE_JMD.toLocaleString()} and is requesting a consultation call now. Phone: ${formData?.phone || 'N/A'}.`,
          patientId,
          patientName: name,
          patientEmail: email,
          patientPhone: formData?.phone || '',
          scheduledFor: isScheduled ? scheduledFor.toISOString() : null,
          screen: 'AdminConsultations',
        });
      } catch (_) {
        // Non-critical — don't block the flow if admin notification fails
      }

      setConsultationModalVisible(false);
      resetConsultationSchedule();
      setProcessingConsultationPayment(false);

      setTimeout(() => {
        if (isScheduled) {
          Alert.alert(
            'Payment Successful',
            `Your consultation call is scheduled for ${scheduledFor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${formatConsultationHourLabel(scheduledHour, consultationScheduledMinute)}. We will call you at that time.`
          );
        } else {
          Alert.alert(
            'Payment Successful',
            'Your consultation has been paid and confirmed. A nurse will call you shortly.',
            [
              { text: 'Call Now', onPress: openConsultationDialer },
              { text: 'OK' },
            ]
          );
        }
      }, 250);
    } catch (error) {
      console.error('Consultation creation error:', error);
      Alert.alert('Error', error?.message || 'Unable to complete your consultation request. Please contact support with your transaction ID.');
      setProcessingConsultationPayment(false);
    }
  };

  const handleDepositPayment = async () => {
    setProcessingPayment(true);
    
    try {
      // Initialize Fygaro payment for deposit
      const paymentResult = await FygaroPaymentService.initializePayment({
        amount: depositAmount,
        currency: 'JMD',
        customerId: user?.id,
        customerName: formData.name,
        customerEmail: formData.email,
        customerPhone: formData.phone,
        description: `Deposit for ${formData.services.join(', ')} - ${formData.startDate} at ${formData.startTime}`,
        metadata: {
          type: 'deposit',
          services: formData.services,
          appointmentDate: formData.startDate,
          appointmentTime: formData.startTime,
          appointmentEndDate: formData.endDate,
          appointmentEndTime: formData.endTime,
          totalAmount: totalAmount,
          depositAmount: depositAmount,
        }
      });

      if (paymentResult.success) {
        // For web, open payment in new tab
        if (Platform.OS === 'web') {
          window.open(paymentResult.paymentUrl, '_blank');
          
          Alert.alert(
            'Payment Window Opened',
            'Complete your payment in the new window. Once done, return here and click "Verify Payment" to continue.',
            [
              {
                text: 'Verify Payment',
                onPress: () => handleVerifyDepositPayment(paymentResult.transactionId)
              },
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: () => {
                  setShowDepositModal(false);
                  setProcessingPayment(false);
                }
              }
            ]
          );
        } else {
          // For mobile, navigate to webview
          setShowDepositModal(false);
          setProcessingPayment(false);
          
          navigation.navigate('PaymentWebview', {
            paymentUrl: paymentResult.paymentUrl,
            sessionId: paymentResult.sessionId,
            transactionId: paymentResult.transactionId,
            onSuccess: () => handleVerifyDepositPayment(paymentResult.transactionId)
          });
        }
      } else {
        Alert.alert('Payment Error', paymentResult.error || 'Failed to initialize payment');
        setProcessingPayment(false);
      }
    } catch (error) {
      console.error('Deposit payment error:', error);
      Alert.alert('Error', 'Failed to process deposit payment');
      setProcessingPayment(false);
    }
  };

  const handleVerifyDepositPayment = async (transactionId) => {
    try {
      // Verify payment with Fygaro
      const verificationResult = await FygaroPaymentService.verifyPayment(transactionId);

      if (verificationResult.success && verificationResult.status === 'completed') {
        // Payment verified, create appointment with partial invoice
        await createAppointmentWithDeposit(transactionId);
      } else {
        Alert.alert('Verification Failed', 'Payment could not be verified. Please contact support.');
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      Alert.alert('Error', 'Failed to verify payment');
    } finally {
      setProcessingPayment(false);
      setShowDepositModal(false);
    }
  };

  const createAppointmentWithDeposit = async (transactionId) => {
    try {
      // Generate a temp ID that will be replaced once the real appointment is created
      const tempAppointmentId = `appointment-${Date.now()}`;

      // Create partial invoice first
      const invoiceResult = await InvoiceService.createPartialInvoice(
        {
          id: tempAppointmentId,
          patientId: user?.id || formData.email,
          patientName: formData.name,
          patientEmail: formData.email,
          patientPhone: formData.phone,
          clientName: formData.name,
          clientEmail: formData.email,
          clientPhone: formData.phone,
          address: formData.address,
          services: formData.services.map(serviceName => {
            const service = services.find(s => s.title === serviceName);
            // Parse price from string format
            const priceStr = service?.price || '';
            const priceMatch = priceStr.match(/[\d,]+/);
            const numericPrice = priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : 0;
            return {
              name: serviceName,
              price: numericPrice,
              description: service?.description || '',
              hours: 1
            };
          }),
          appointmentDate: formData.startDate,
          hoursWorked: 1,
        },
        {
          amount: depositAmount,
          transactionId: transactionId,
          method: 'fygaro',
          type: 'deposit'
        }
      );

      if (!invoiceResult.success) {
        throw new Error(invoiceResult.error || 'Failed to create invoice');
      }

      // Create appointment with invoice data
      const primaryService = formData.services?.[0] || formData.service || 'General Care';
      const appointmentData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        address: formData.address,
        services: formData.services,
        service: primaryService,
        preferredDate: formData.startDate,
        preferredTime: formData.startTime,
        date: formData.startDate,
        time: formData.startTime,
        startDate: formData.startDate,
        startTime: formData.startTime,
        endDate: formData.endDate,
        endTime: formData.endTime,
        notes: formData.notes,
        patientAlerts: formData.patientAlerts || null,
        subscriptionPlan: formData.subscriptionPlan,
        preferredNurseId: formData.preferredNurseId || null,
        preferredNurseName: formData.preferredNurseName || null,
        preferredNurseCode: formData.preferredNurseCode || null,
        requestedNurseId: formData.preferredNurseId || null,
        requestedNurseName: formData.preferredNurseName || null,
        requestedNurseCode: formData.preferredNurseCode || null,
        isRecurring: false,
        patientId: user?.id || formData.email,
        patientName: formData.name,
        totalAmount: totalAmount,
        depositAmount: depositAmount,
        paidAmount: depositAmount,
        outstandingAmount: totalAmount - depositAmount,
        depositPaid: true,
        depositTransactionId: transactionId,
        invoiceId: invoiceResult.invoice.invoiceId,
        paymentStatus: 'partial',
      };

      // If rescheduling, cancel the old one first
      if (isRescheduling && originalAppointmentId) {
        try {
          await cancelAppointment(originalAppointmentId, 'Rescheduled to new date/time');
        } catch (cancelError) {
          console.error('Error cancelling original appointment:', cancelError);
        }
      }

      const newAppointment = await bookAppointment(appointmentData);
      // Back-patch the invoice with the real Firestore appointment ID so it can be
      // found when the patient opens their appointment details.
      if (newAppointment?.id && newAppointment.id !== tempAppointmentId && invoiceResult.invoice?.invoiceId) {
        InvoiceService.patchAppointmentId(invoiceResult.invoice.invoiceId, newAppointment.id).catch(console.warn);
      }
      
      Alert.alert(
        'Success',
        `Your appointment has been booked successfully!\n\nDeposit of J$${depositAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid.\nRemaining balance of J$${(totalAmount - depositAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} will be due after service completion.`,
        [{ 
          text: 'OK', 
          onPress: () => {
            resetForm();
            if (isRescheduling) {
              setIsRescheduling(false);
              setOriginalAppointmentId(null);
              navigation.navigate('Appointments');
            }
          } 
        }]
      );
    } catch (error) {
      console.error('Error creating appointment:', error);
      Alert.alert('Error', error.message || 'Failed to create appointment. Please contact support.');
    } finally {
      setProcessingPayment(false);
      setShowDepositModal(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      address: '',
      services: [],
      startDate: '',
      startTime: '',
      endDate: '',
      endTime: '',
      notes: '',
      patientAlerts: {
        allergies: [],
        allergyOther: '',
        vitals: {
          bpSystolic: '',
          bpDiastolic: '',
          heartRate: '',
          temperature: '',
          oxygenSaturation: '',
        },
      },
      subscriptionPlan: '',
      preferredNurseId: null,
      preferredNurseName: '',
      preferredNurseCode: '',
      preferredNursePhoto: '',
    });
    setSelectedDate(new Date());
    setSelectedTime(new Date());
    setIsRecurring(false);
    setRecurringFrequency('weekly');
    setRecurringDuration(1);
    setSelectedDays([]);
    setAutoEmailInvoices(false);
    setShowDepositModal(false);
    setProcessingPayment(false);
  };

  const onStartDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowStartDatePicker(false);
      if (event.type === 'set' && date) {
        setSelectedDate(date);
        const formattedDate = date.toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric'
        });
        setFormData((prev) => ({ ...prev, startDate: formattedDate }));
      }
    } else {
      if (date) {
        setSelectedDate(date);
      }
    }
  };

  const onStartTimeChange = (event, time) => {
    if (Platform.OS === 'android') {
      setShowStartTimePicker(false);
      if (event.type === 'set' && time) {
        setSelectedTime(time);
        const hours = time.getHours();
        const minutes = time.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        setFormData((prev) => ({ ...prev, startTime: formattedTime }));
      }
    } else {
      if (time) {
        setSelectedTime(time);
      }
    }
  };

  const onEndDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
      if (event.type === 'set' && date) {
        setSelectedDate(date);
        const formattedDate = date.toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric'
        });
        setFormData((prev) => ({ ...prev, endDate: formattedDate }));
      }
    } else {
      if (date) {
        setSelectedDate(date);
      }
    }
  };

  const onEndTimeChange = (event, time) => {
    if (Platform.OS === 'android') {
      setShowEndTimePicker(false);
      if (event.type === 'set' && time) {
        setSelectedTime(time);
        const hours = time.getHours();
        const minutes = time.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        setFormData((prev) => ({ ...prev, endTime: formattedTime }));
      }
    } else {
      if (time) {
        setSelectedTime(time);
      }
    }
  };

  const confirmStartDateSelection = () => {
    const formattedDate = selectedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    });
    setFormData((prev) => ({ ...prev, startDate: formattedDate }));
    setShowStartDatePicker(false);
  };

  const confirmStartTimeSelection = () => {
    const hours = selectedTime.getHours();
    const minutes = selectedTime.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    setFormData((prev) => ({ ...prev, startTime: formattedTime }));
    setShowStartTimePicker(false);
  };

  const confirmEndDateSelection = () => {
    const formattedDate = selectedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    });
    setFormData((prev) => ({ ...prev, endDate: formattedDate }));
    setShowEndDatePicker(false);
  };

  const confirmEndTimeSelection = () => {
    const hours = selectedTime.getHours();
    const minutes = selectedTime.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    setFormData((prev) => ({ ...prev, endTime: formattedTime }));
    setShowEndTimePicker(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.welcomeText}>Book Appointment</Text>
        </View>
      </LinearGradient>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onScrollBeginDrag={handleOutsidePress}
      >
        <View style={styles.formCard}>
          {/* Contact Information Header */}
          <View style={styles.contactHeader}>
            <Text style={styles.contactHeaderTitle}>Contact Information</Text>
            <View style={styles.contactHeaderActions}>
              <TouchableWeb
                style={styles.pillButton}
                onPress={() => setConsultationModalVisible(true)}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.pillButtonGradient}
                >
                  <MaterialCommunityIcons name="phone-in-talk" size={18} color={COLORS.white} />
                  <Text style={styles.pillButtonText}>Consult</Text>
                </LinearGradient>
              </TouchableWeb>

              <TouchableWeb
                style={styles.pillButton}
                onPress={() => setIsEditingUserDetails(!isEditingUserDetails)}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.pillButtonGradient}
                >
                  <MaterialCommunityIcons
                    name={isEditingUserDetails ? 'check' : 'pencil'}
                    size={18}
                    color={COLORS.white}
                  />
                  <Text style={styles.pillButtonText}>
                    {isEditingUserDetails ? 'Save' : 'Edit'}
                  </Text>
                </LinearGradient>
              </TouchableWeb>
            </View>
          </View>

          {/* Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Full Name <Text style={styles.required}>*</Text>
            </Text>
            <View style={[styles.inputContainer, isEditingUserDetails ? styles.editableInput : styles.autofilledInput]}>
              <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
              <TextInput
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor={COLORS.textMuted}
                value={formData.name}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, name: text }))}
                editable={isEditingUserDetails}
              />
              <MaterialCommunityIcons 
                name={isEditingUserDetails ? "pencil-outline" : "lock"} 
                size={16} 
                color={isEditingUserDetails ? COLORS.primary : COLORS.textMuted} 
              />
            </View>
          </View>

          {/* Email Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={[styles.inputContainer, isEditingUserDetails ? styles.editableInput : styles.autofilledInput]}>
              <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
              <TextInput
                style={styles.input}
                placeholder="your.email@example.com"
                placeholderTextColor={COLORS.textMuted}
                value={formData.email}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, email: text }))}
                editable={isEditingUserDetails}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <MaterialCommunityIcons 
                name={isEditingUserDetails ? "pencil-outline" : "lock"} 
                size={16} 
                color={isEditingUserDetails ? COLORS.primary : COLORS.textMuted} 
              />
            </View>
          </View>

          {/* Phone Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Phone Number <Text style={styles.required}>*</Text>
            </Text>
            <View style={[styles.inputContainer, isEditingUserDetails ? styles.editableInput : styles.autofilledInput]}>
              <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
              <TextInput
                style={styles.input}
                placeholder="876-XXX-XXXX"
                placeholderTextColor={COLORS.textMuted}
                value={formData.phone}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, phone: text }))}
                editable={isEditingUserDetails}
                keyboardType="phone-pad"
              />
              <MaterialCommunityIcons 
                name={isEditingUserDetails ? "pencil-outline" : "lock"} 
                size={16} 
                color={isEditingUserDetails ? COLORS.primary : COLORS.textMuted} 
              />
            </View>
          </View>

          {/* Address Input with Enhanced Autocomplete */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Service Address <Text style={styles.required}>*</Text>
            </Text>
            <Text style={styles.subtitle}>Address from your profile</Text>
            <View style={styles.addressWrapper}>
              <View style={[styles.inputContainer, isEditingUserDetails ? styles.editableInput : styles.autofilledInput]}>
                <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.primary} />
                <TextInput
                  ref={addressInputRef}
                  style={styles.input}
                  placeholder="e.g., Half Way Tree, New Kingston, Portmore..."
                  placeholderTextColor={COLORS.textMuted}
                  value={formData.address}
                  onChangeText={handleAddressChange}
                  editable={isEditingUserDetails}
                  autoCorrect={false}
                  autoCapitalize="words"
                />
                <MaterialCommunityIcons 
                  name={isEditingUserDetails ? "pencil-outline" : "lock"} 
                  size={16} 
                  color={isEditingUserDetails ? COLORS.primary : COLORS.textMuted} 
                />
              </View>
            </View>
          </View>

          {/* Consultation button moved to top beside Edit */}

          {/* Service Selection - Multiple */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Services Required <Text style={styles.required}>*</Text>
            </Text>
            <Text style={styles.subtitle}>Select one or more services</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.serviceScrollContainer}
              contentContainerStyle={styles.serviceScrollContent}
            >
              {bookableServices.map((service) => {
                const isSelected = formData.services.includes(service.title);
                return (
                  <TouchableWeb
                    key={`${service.id}-${service.title}`}
                    style={styles.serviceChipWrapper}
                    onPress={() => {
                      setFormData((prev) => {
                        const currentServices = Array.isArray(prev?.services) ? prev.services : [];
                        const currentlySelected = currentServices.includes(service.title);
                        const newServices = currentlySelected
                          ? currentServices.filter((s) => s !== service.title)
                          : [...currentServices, service.title];
                        return { ...prev, services: newServices };
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    {isSelected ? (
                      <LinearGradient
                        colors={GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.serviceChip}
                      >
                        <MaterialCommunityIcons
                          name={service.icon}
                          size={20}
                          color={COLORS.white}
                        />
                        <Text style={styles.serviceChipTextSelected}>
                          {service.title}
                        </Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.serviceChip}>
                        <MaterialCommunityIcons
                          name={service.icon}
                          size={20}
                          color={COLORS.primary}
                        />
                        <Text style={styles.serviceChipText}>
                          {service.title}
                        </Text>
                      </View>
                    )}
                  </TouchableWeb>
                );
              })}
            </ScrollView>
            
            {/* Total Amount Display */}
            {formData.services.length > 0 && (
              <View style={styles.totalAmountContainer}>
                <View style={styles.totalAmountRow}>
                  <Text style={styles.totalAmountLabel}>Total Amount:</Text>
                  <Text style={styles.totalAmountValue}>
                    J${totalAmount.toLocaleString()}
                  </Text>
                </View>
                {depositRequiredSetting && depositPercentSetting > 0 && depositAmount > 0 && (
                  <View style={styles.depositInfoRow}>
                    <MaterialCommunityIcons name="information" size={16} color="#EF4444" />
                    <Text style={styles.depositInfoText}>
                      {depositPercentSetting}% deposit (J${depositAmount.toLocaleString()}) required to confirm booking
                    </Text>
                  </View>
                )}
              </View>
            )}

            {!isRecurring && (
              <>
                {/* Date & Time Rows */}
                <View style={[styles.rowContainer, styles.nonRecurringDateRow]}>
                  <View style={[styles.inputGroup, styles.nonRecurringInputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Select Date</Text>
                    <TouchableWeb 
                      style={styles.inputContainer}
                      onPress={() => setShowStartDatePicker(true)}
                    >
                      <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                      <Text style={[styles.input, { color: formData.startDate ? COLORS.text : COLORS.textMuted }]}>
                        {formData.startDate || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>

                  <View style={[styles.inputGroup, styles.nonRecurringInputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Select Time</Text>
                    <TouchableWeb 
                      style={styles.inputContainer}
                      onPress={() => setShowStartTimePicker(true)}
                    >
                      <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                      <Text style={[styles.input, { color: formData.startTime ? COLORS.text : COLORS.textMuted }]}>
                        {formData.startTime || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Nurse Selection (Optional) */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Preferred Nurse (Optional)</Text>
            <Text style={styles.subtitle}>Choose a nurse or leave as Any Nurse</Text>
            <TouchableWeb
              style={styles.inputContainer}
              onPress={() => setShowNurseModal(true)}
              activeOpacity={0.7}
            >
              {preferredNursePhotoUri ? (
                <Image
                  source={{ uri: preferredNursePhotoUri }}
                  style={styles.preferredNurseAvatar}
                />
              ) : (
                <View style={styles.preferredNurseAvatarFallback}>
                  <Text style={styles.preferredNurseAvatarFallbackText}>{preferredNurseInitials}</Text>
                </View>
              )}
              <Text style={[styles.input, { color: formData.preferredNurseName ? COLORS.text : COLORS.textMuted }]}>
                {formData.preferredNurseName || 'Any Nurse'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
            </TouchableWeb>

            {!!formData.preferredNurseName && (
              <View style={styles.selectedNursePreviewCard}>
                {preferredNursePhotoUri ? (
                  <Image
                    source={{ uri: preferredNursePhotoUri }}
                    style={styles.selectedNursePreviewAvatar}
                  />
                ) : (
                  <View style={styles.selectedNursePreviewAvatarFallback}>
                    <Text style={styles.selectedNursePreviewAvatarFallbackText}>{preferredNurseInitials}</Text>
                  </View>
                )}
                <View style={styles.selectedNursePreviewInfo}>
                  <Text style={styles.selectedNursePreviewName} numberOfLines={1}>
                    {formData.preferredNurseName}
                  </Text>
                  {!!formData.preferredNurseCode && (
                    <Text style={styles.selectedNursePreviewMeta}>
                      Code: {formData.preferredNurseCode}
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Patient Alerts (Allergies + Vitals) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Patient Alerts (Optional)</Text>

            <View style={styles.inputGroup}>
              <View style={styles.allergyHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Allergies</Text>
                </View>

                <TouchableWeb
                  style={styles.allergyAddButton}
                  activeOpacity={0.8}
                  onPress={() => {
                    setAllergySearchQuery('');
                    setShowAllergyPicker(true);
                  }}
                >
                  <LinearGradient
                    colors={GRADIENTS.header}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.allergyAddButtonGradient}
                  >
                    <MaterialCommunityIcons name="plus" size={16} color={COLORS.white} />
                    <Text style={styles.allergyAddButtonText}>Add</Text>
                  </LinearGradient>
                </TouchableWeb>
              </View>

              {(() => {
                const allergies = Array.isArray(formData?.patientAlerts?.allergies)
                  ? formData.patientAlerts.allergies
                  : [];
                const otherText = String(formData?.patientAlerts?.allergyOther || '').trim();
                const hasAny = allergies.length > 0 || Boolean(otherText);
                if (!hasAny) return null;

                const pills = [];
                allergies.forEach((label) => {
                  const l = String(label || '').trim();
                  if (!l) return;
                  if (l === 'Other') return;
                  pills.push(l);
                });
                if (otherText) {
                  pills.push(otherText);
                } else if (allergies.includes('Other')) {
                  pills.push('Other');
                }

                if (pills.length === 0) return null;

                return (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 10 }}
                  >
                    <View style={styles.allergySelectedChipsRow}>
                      {pills.map((label, index) => {
                        const isOtherText = otherText && label === otherText;
                        const isOther = label === 'Other' || isOtherText;

                        return (
                          <TouchableWeb
                            key={`${label}-${index}`}
                            activeOpacity={0.8}
                            style={styles.allergyOptionChip}
                            onPress={() => {
                              if (isOther) {
                                toggleAllergy('Other');
                                return;
                              }
                              toggleAllergy(label);
                            }}
                          >
                            <LinearGradient
                              colors={GRADIENTS.header}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.allergyOptionChipGradient}
                            >
                              <Text
                                style={styles.allergyOptionChipTextSelected}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                              >
                                {label}
                              </Text>
                              <MaterialCommunityIcons name="close" size={14} color={COLORS.white} />
                            </LinearGradient>
                          </TouchableWeb>
                        );
                      })}
                    </View>
                  </ScrollView>
                );
              })()}

              {Array.isArray(formData?.patientAlerts?.allergies) && formData.patientAlerts.allergies.includes('Other') && (
                <View style={[styles.inputContainer, { marginTop: 10 }]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Describe allergy (e.g., iodine, adhesive)..."
                    placeholderTextColor={COLORS.textMuted}
                    value={formData?.patientAlerts?.allergyOther || ''}
                    onChangeText={(text) =>
                      setFormData((prev) => ({
                        ...prev,
                        patientAlerts: {
                          ...(prev.patientAlerts || {}),
                          allergyOther: text,
                        },
                      }))
                    }
                    autoCorrect={false}
                    autoCapitalize="sentences"
                  />
                </View>
              )}
            </View>

          </View>

          {/* Allergy Picker Modal (Dropdown) */}
          <Modal
            transparent
            animationType="fade"
            visible={showAllergyPicker}
            onRequestClose={() => setShowAllergyPicker(false)}
          >
            <Pressable style={styles.allergyModalOverlay} onPress={() => setShowAllergyPicker(false)}>
              <Pressable style={styles.allergyModalCard} onPress={(e) => e.stopPropagation()}>
                <View style={styles.allergyModalHeader}>
                  <Text style={styles.allergyModalTitle}>Select Allergies</Text>
                  <TouchableWeb
                    style={styles.allergyModalClose}
                    activeOpacity={0.8}
                    onPress={() => setShowAllergyPicker(false)}
                  >
                    <MaterialCommunityIcons name="close" size={22} color={COLORS.text} />
                  </TouchableWeb>
                </View>

                <View style={styles.allergyModalSearchRow}>
                  <MaterialCommunityIcons name="magnify" size={20} color={COLORS.textMuted} />
                  <TextInput
                    style={styles.allergyModalSearchInput}
                    placeholder="Search allergies..."
                    placeholderTextColor={COLORS.textMuted}
                    value={allergySearchQuery}
                    onChangeText={setAllergySearchQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                  />
                  {String(allergySearchQuery || '').length > 0 && (
                    <TouchableWeb
                      style={styles.allergyModalClearSearch}
                      activeOpacity={0.8}
                      onPress={() => setAllergySearchQuery('')}
                    >
                      <MaterialCommunityIcons name="close" size={18} color={COLORS.textMuted} />
                    </TouchableWeb>
                  )}
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
                  {filteredAllergyItems.map((item) => {
                    if (item?.type === 'header') {
                      return (
                        <View key={`header-${item.label}`} style={styles.allergyModalSectionHeader}>
                          <Text style={styles.allergyModalSectionHeaderText}>{item.label}</Text>
                        </View>
                      );
                    }

                    const label = item?.label;
                    const allergies = Array.isArray(formData?.patientAlerts?.allergies)
                      ? formData.patientAlerts.allergies
                      : [];
                    const otherText = String(formData?.patientAlerts?.allergyOther || '').trim();

                    const selected =
                      label === 'None'
                        ? allergies.length === 0 && !otherText
                        : allergies.includes(label);

                    return (
                      <TouchableWeb
                        key={`option-${label}`}
                        activeOpacity={0.75}
                        style={styles.allergyModalOptionRow}
                        onPress={() => {
                          toggleAllergy(label);
                          if (label === 'None') {
                            setShowAllergyPicker(false);
                          }
                        }}
                      >
                        <MaterialCommunityIcons
                          name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={20}
                          color={selected ? COLORS.primary : COLORS.textMuted}
                        />
                        <Text style={styles.allergyModalOptionText}>{label}</Text>
                      </TouchableWeb>
                    );
                  })}
                </ScrollView>

                {Array.isArray(formData?.patientAlerts?.allergies) && formData.patientAlerts.allergies.includes('Other') && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.vitalLabel}>Other (describe)</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        placeholder="Describe allergy (e.g., iodine, adhesive)..."
                        placeholderTextColor={COLORS.textMuted}
                        value={formData?.patientAlerts?.allergyOther || ''}
                        onChangeText={(text) =>
                          setFormData((prev) => ({
                            ...prev,
                            patientAlerts: {
                              ...(prev.patientAlerts || {}),
                              allergyOther: text,
                            },
                          }))
                        }
                        autoCorrect={false}
                        autoCapitalize="sentences"
                      />
                    </View>
                  </View>
                )}

                <TouchableWeb
                  style={[styles.pickerConfirmButton, { marginTop: 14 }]}
                  activeOpacity={0.8}
                  onPress={() => setShowAllergyPicker(false)}
                >
                  <LinearGradient
                    colors={GRADIENTS.header}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.pickerConfirmGradient}
                  >
                    <Text style={styles.pickerConfirmText}>Done</Text>
                  </LinearGradient>
                </TouchableWeb>
              </Pressable>
            </Pressable>
          </Modal>

          {/* Notes Input - Compact */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Additional Notes</Text>
            <View style={styles.notesContainer}>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, styles.notesInput]}
                  placeholder="Care/health needs..."
                  placeholderTextColor={COLORS.textMuted}
                  value={formData.notes}
                  onChangeText={(text) => setFormData((prev) => ({ ...prev, notes: text }))}
                  multiline
                  numberOfLines={2}
                />
              </View>
              <View style={styles.notesActions}>
                <TouchableWeb
                  style={styles.notesActionButton}
                  onPress={() => {
                    // Save notes - you can add additional save logic here if needed
                    Alert.alert('Success', 'Notes saved!');
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="check" size={24} color={COLORS.success} />
                </TouchableWeb>
                <TouchableWeb
                  style={styles.notesActionButton}
                  onPress={() => {
                    setFormData((prev) => ({ ...prev, notes: '' }));
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.error} />
                </TouchableWeb>
              </View>
            </View>
          </View>

          {/* Recurring Appointment Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recurring Appointment</Text>
            
            <TouchableWeb
              style={styles.recurringToggle}
              onPress={() => setIsRecurring(!isRecurring)}
              activeOpacity={0.7}
            >
              <View style={styles.recurringToggleContent}>
                <View style={styles.recurringToggleLeft}>
                  <Text style={[styles.recurringToggleText, { color: isRecurring ? COLORS.primary : COLORS.text }]}>
                    Make this a recurring appointment
                  </Text>
                </View>
                <View style={[styles.toggleSwitch, { backgroundColor: isRecurring ? COLORS.primary : COLORS.border }]}>
                  <View style={[styles.toggleKnob, { marginLeft: isRecurring ? 27 : 3 }]} />
                </View>
              </View>
            </TouchableWeb>

            {isRecurring && (
              <View style={styles.recurringOptions}>
                <View style={styles.recurringRow}>
                  <Text style={styles.recurringLabel}>Frequency</Text>
                  <View style={styles.frequencyButtons}>
                    <TouchableWeb
                      style={[
                        styles.frequencyButton,
                        recurringFrequency === 'weekly' && { overflow: 'hidden' }
                      ]}
                      onPress={() => setRecurringFrequency('weekly')}
                      activeOpacity={0.7}
                    >
                      {recurringFrequency === 'weekly' ? (
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.frequencyButtonGradient}
                        >
                          <Text style={styles.frequencyButtonTextActive}>
                            Weekly
                          </Text>
                        </LinearGradient>
                      ) : (
                        <View style={styles.inactiveFrequencyButton}>
                          <Text style={styles.frequencyButtonText}>
                            Weekly
                          </Text>
                        </View>
                      )}
                    </TouchableWeb>
                    <TouchableWeb
                      style={[
                        styles.frequencyButton,
                        recurringFrequency === 'biweekly' && { overflow: 'hidden' }
                      ]}
                      onPress={() => setRecurringFrequency('biweekly')}
                      activeOpacity={0.7}
                    >
                      {recurringFrequency === 'biweekly' ? (
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.frequencyButtonGradient}
                        >
                          <Text style={styles.frequencyButtonTextActive}>
                            Every 2 Weeks
                          </Text>
                        </LinearGradient>
                      ) : (
                        <View style={styles.inactiveFrequencyButton}>
                          <Text style={styles.frequencyButtonText}>
                            Every 2 Weeks
                          </Text>
                        </View>
                      )}
                    </TouchableWeb>
                  </View>
                </View>

                {/* Date & Time Rows */}
                <View style={styles.rowContainer}>
                  {/* Start Date */}
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Start Date</Text>
                    <TouchableWeb 
                      style={styles.inputContainer}
                      onPress={() => setShowStartDatePicker(true)}
                    >
                      <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                      <Text style={[styles.input, { color: formData.startDate ? COLORS.text : COLORS.textMuted }]}>
                        {formData.startDate || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>

                  {/* End Date */}
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>End Date</Text>
                    <TouchableWeb 
                      style={styles.inputContainer}
                      onPress={() => setShowEndDatePicker(true)}
                    >
                      <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                      <Text style={[styles.input, { color: formData.endDate ? COLORS.text : COLORS.textMuted }]}>
                        {formData.endDate || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>
                </View>

                <View style={styles.rowContainer}>
                  {/* Start Time */}
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Start Time</Text>
                    <TouchableWeb 
                      style={styles.inputContainer}
                      onPress={() => setShowStartTimePicker(true)}
                    >
                      <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                      <Text style={[styles.input, { color: formData.startTime ? COLORS.text : COLORS.textMuted }]}>
                        {formData.startTime || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>

                  {/* End Time */}
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.label}>End Time</Text>
                    <TouchableWeb 
                      style={styles.inputContainer}
                      onPress={() => setShowEndTimePicker(true)}
                    >
                      <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                      <Text style={[styles.input, { color: formData.endTime ? COLORS.text : COLORS.textMuted }]}>
                        {formData.endTime || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>
                </View>

                {/* Days of Week Selection */}
                <View style={styles.recurringRow}>
                  <Text style={styles.recurringLabel}>Days of Week</Text>
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    style={styles.daysScroll}
                  >
                    {DAYS_OF_WEEK.map(day => (
                      <TouchableWeb
                        key={day.value}
                        style={styles.dayPill}
                        onPress={() => toggleDay(day.value)}
                        activeOpacity={0.7}
                      >
                        {selectedDays.includes(day.value) ? (
                          <LinearGradient
                            colors={GRADIENTS.header}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.dayPillGradient}
                          >
                            <Text style={styles.dayChipTextSelected}>
                              {day.label}
                            </Text>
                          </LinearGradient>
                        ) : (
                          <View style={styles.inactiveDayPill}>
                            <Text style={styles.dayChipText}>
                              {day.label}
                            </Text>
                          </View>
                        )}
                      </TouchableWeb>
                    ))}
                  </ScrollView>
                </View>

                {/* Duration Selection */}
                <View style={styles.recurringRow}>
                  <Text style={styles.recurringLabel}>Duration</Text>
                  <View style={styles.durationContainer}>
                    <TouchableWeb
                      style={styles.durationButton}
                      onPress={() => setRecurringDuration(Math.max(1, recurringDuration - 1))}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="minus" size={20} color={COLORS.primary} />
                    </TouchableWeb>
                    <View style={styles.durationDisplay}>
                      <Text style={styles.durationText}>{recurringDuration}</Text>
                      <Text style={styles.durationUnit}>
                        {recurringFrequency === 'weekly' ? 'weeks' : 'periods'}
                      </Text>
                    </View>
                    <TouchableWeb
                      style={styles.durationButton}
                      onPress={() => setRecurringDuration(recurringDuration + 1)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="plus" size={20} color={COLORS.primary} />
                    </TouchableWeb>
                  </View>
                </View>

                {/* Summary */}
                <View style={styles.recurringSummary}>
                  <MaterialCommunityIcons name="information" size={16} color={COLORS.info} />
                  <Text style={styles.recurringSummaryText}>
                    {recurringFrequency === 'weekly' 
                      ? `Appointment will repeat weekly for ${recurringDuration} week${recurringDuration > 1 ? 's' : ''}`
                      : `Appointment will repeat every 2 weeks for ${recurringDuration} period${recurringDuration > 1 ? 's' : ''} (${recurringDuration * 2} weeks total)`
                    }
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Submit Button */}
          <TouchableWeb
            style={styles.submitButton}
            onPress={handleSubmit}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.submitGradient}
            >
              <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.white} />
              <Text style={styles.submitText}>Submit Appointment Request</Text>
            </LinearGradient>
          </TouchableWeb>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="information" size={20} color={COLORS.info} />
            <Text style={styles.infoText}>
              We'll contact you within 24 hours to confirm your appointment. For urgent needs,
              please call our 24/7 emergency line.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Start Date Picker - iOS */}
      {showStartDatePicker && Platform.OS === 'ios' && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Start Date</Text>
              <TouchableWeb
                onPress={() => setShowStartDatePicker(false)}
                style={styles.pickerCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="spinner"
              onChange={onStartDateChange}
              minimumDate={new Date()}
              textColor={COLORS.text}
            />
            <TouchableWeb
              style={styles.pickerConfirmButton}
              onPress={confirmStartDateSelection}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.pickerConfirmGradient}
              >
                <Text style={styles.pickerConfirmText}>Done</Text>
              </LinearGradient>
            </TouchableWeb>
          </View>
        </View>
      )}

      {/* Start Date Picker - Android */}
      {showStartDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          onChange={onStartDateChange}
          minimumDate={new Date()}
        />
      )}

      {/* Start Time Picker - iOS */}
      {showStartTimePicker && Platform.OS === 'ios' && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Start Time</Text>
              <TouchableWeb
                onPress={() => setShowStartTimePicker(false)}
                style={styles.pickerCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            <DateTimePicker
              value={selectedTime}
              mode="time"
              display="spinner"
              onChange={onStartTimeChange}
              textColor={COLORS.text}
            />
            <TouchableWeb
              style={styles.pickerConfirmButton}
              onPress={confirmStartTimeSelection}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.pickerConfirmGradient}
              >
                <Text style={styles.pickerConfirmText}>Done</Text>
              </LinearGradient>
            </TouchableWeb>
          </View>
        </View>
      )}

      {/* Start Time Picker - Android */}
      {showStartTimePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedTime}
          mode="time"
          display="default"
          onChange={onStartTimeChange}
        />
      )}

      {/* End Date Picker - iOS */}
      {showEndDatePicker && Platform.OS === 'ios' && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select End Date</Text>
              <TouchableWeb
                onPress={() => setShowEndDatePicker(false)}
                style={styles.pickerCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="spinner"
              onChange={onEndDateChange}
              minimumDate={new Date()}
              textColor={COLORS.text}
            />
            <TouchableWeb
              style={styles.pickerConfirmButton}
              onPress={confirmEndDateSelection}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.pickerConfirmGradient}
              >
                <Text style={styles.pickerConfirmText}>Done</Text>
              </LinearGradient>
            </TouchableWeb>
          </View>
        </View>
      )}

      {/* End Date Picker - Android */}
      {showEndDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          onChange={onEndDateChange}
          minimumDate={new Date()}
        />
      )}

      {/* End Time Picker - iOS */}
      {showEndTimePicker && Platform.OS === 'ios' && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select End Time</Text>
              <TouchableWeb
                onPress={() => setShowEndTimePicker(false)}
                style={styles.pickerCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            <DateTimePicker
              value={selectedTime}
              mode="time"
              display="spinner"
              onChange={onEndTimeChange}
              textColor={COLORS.text}
            />
            <TouchableWeb
              style={styles.pickerConfirmButton}
              onPress={confirmEndTimeSelection}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.pickerConfirmGradient}
              >
                <Text style={styles.pickerConfirmText}>Done</Text>
              </LinearGradient>
            </TouchableWeb>
          </View>
        </View>
      )}

      {/* End Time Picker - Android */}
      {showEndTimePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedTime}
          mode="time"
          display="default"
          onChange={onEndTimeChange}
        />
      )}

      {/* Consultation Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={consultationModalVisible}
        onRequestClose={() => {
          if (processingConsultationPayment) return;
          resetConsultationSchedule();
          setConsultationModalVisible(false);
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            if (processingConsultationPayment) return;
            resetConsultationSchedule();
            setConsultationModalVisible(false);
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.consultationModalContainer}
          >
            <ScrollView
              style={styles.consultationModalBody}
              contentContainerStyle={styles.consultationModalBodyContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.consultationRequestText}>
                {`You are requesting a non-refundable consultation call for a cost of J$${CONSULTATION_FEE_JMD.toLocaleString()}.`}
              </Text>

              <View style={styles.consultationScheduleSection}>
                <Text style={styles.consultationScheduleTitle}>Schedule a time (optional)</Text>

                <View style={[styles.rowContainer, styles.consultationPickerRow]}>
                  <View style={[styles.inputGroup, styles.consultationPickerGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Select Date</Text>
                    <TouchableWeb
                      style={styles.inputContainer}
                      onPress={openConsultationDatePicker}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                      <Text
                        style={[
                          styles.input,
                          { color: consultationScheduledDate ? COLORS.text : COLORS.textMuted },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {consultationScheduledDate
                          ? new Date(consultationScheduledDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>

                  <View style={[styles.inputGroup, styles.consultationPickerGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Select Time</Text>
                    <TouchableWeb
                      style={styles.inputContainer}
                      onPress={openConsultationTimePicker}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                      <Text
                        style={[
                          styles.input,
                          { color: consultationScheduledHour != null ? COLORS.text : COLORS.textMuted },
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {consultationScheduledHour != null ? formatConsultationHourLabel(consultationScheduledHour, consultationScheduledMinute) : 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>
                </View>

                <Text style={styles.consultationScheduleHint}>Available slots: 9:00 AM – 5:00 PM</Text>
              </View>

              <View style={{ height: 14 }} />

              <TouchableWeb
                style={styles.consultationButton}
                onPress={startPaidConsultationPayment}
                disabled={processingConsultationPayment}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={processingConsultationPayment ? [COLORS.lightGray, COLORS.gray] : GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.consultationButtonGradient}
                >
                  {processingConsultationPayment ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <>
                      <MaterialCommunityIcons
                        name={buildConsultationScheduledFor() ? 'calendar-clock' : 'phone'}
                        size={16}
                        color={COLORS.white}
                      />
                      <Text style={styles.consultationButtonText}>
                        {buildConsultationScheduledFor() ? 'Schedule Consultation' : 'Request Call'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableWeb>

              <View style={{ height: 12 }} />
            </ScrollView>
          </Pressable>

          {/* Consultation Date Picker - iOS */}
          {showConsultationDatePicker && Platform.OS === 'ios' && (
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerContainer}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>Select Date</Text>
                  <TouchableWeb
                    onPress={() => setShowConsultationDatePicker(false)}
                    style={styles.pickerCloseButton}
                  >
                    <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                  </TouchableWeb>
                </View>
                <DateTimePicker
                  value={consultationPickerDate}
                  mode="date"
                  display="spinner"
                  onChange={onConsultationDateChange}
                  minimumDate={new Date()}
                  textColor={COLORS.text}
                />
                <TouchableWeb
                  style={styles.pickerConfirmButton}
                  onPress={confirmConsultationDateSelection}
                >
                  <LinearGradient
                    colors={GRADIENTS.header}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.pickerConfirmGradient}
                  >
                    <Text style={styles.pickerConfirmText}>Done</Text>
                  </LinearGradient>
                </TouchableWeb>
              </View>
            </View>
          )}

          {/* Consultation Date Picker - Android */}
          {showConsultationDatePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={consultationPickerDate}
              mode="date"
              display="default"
              onChange={onConsultationDateChange}
              minimumDate={new Date()}
            />
          )}

          {/* Consultation Time Picker - iOS */}
          {showConsultationTimePicker && Platform.OS === 'ios' && (
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerContainer}>
                <View style={styles.pickerHeader}>
                  <Text style={styles.pickerTitle}>Select Time</Text>
                  <TouchableWeb
                    onPress={() => setShowConsultationTimePicker(false)}
                    style={styles.pickerCloseButton}
                  >
                    <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                  </TouchableWeb>
                </View>
                <DateTimePicker
                  value={consultationPickerTime}
                  mode="time"
                  display="spinner"
                  onChange={onConsultationTimeChange}
                  textColor={COLORS.text}
                />
                <TouchableWeb
                  style={styles.pickerConfirmButton}
                  onPress={confirmConsultationTimeSelection}
                >
                  <LinearGradient
                    colors={GRADIENTS.header}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.pickerConfirmGradient}
                  >
                    <Text style={styles.pickerConfirmText}>Done</Text>
                  </LinearGradient>
                </TouchableWeb>
              </View>
            </View>
          )}

          {/* Consultation Time Picker - Android */}
          {showConsultationTimePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={consultationPickerTime}
              mode="time"
              display="default"
              onChange={onConsultationTimeChange}
            />
          )}
        </Pressable>
      </Modal>

      {/* Nurse Selection Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showNurseModal}
        onRequestClose={() => setShowNurseModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.nurseModalContent}>
            <View style={styles.nurseModalHeader}>
              <Text style={styles.nurseModalTitle}>Select Nurse</Text>
              <TouchableWeb onPress={() => setShowNurseModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <View style={styles.nurseModalBody}>
              <View style={styles.nurseSearchBox}>
                <MaterialCommunityIcons name="magnify" size={18} color={COLORS.textMuted} />
                <TextInput
                  style={styles.nurseSearchInput}
                  placeholder="Search nurse..."
                  placeholderTextColor={COLORS.textMuted}
                  value={nurseSearch}
                  onChangeText={setNurseSearch}
                />
              </View>

              {loadingNurses ? (
                <View style={styles.nurseLoading}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.nurseLoadingText}>Loading nurses...</Text>
                </View>
              ) : (
                <FlatList
                  data={nurses.filter((n) => {
                    const q = nurseSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      n.name.toLowerCase().includes(q) ||
                      (n.nurseCode || '').toLowerCase().includes(q) ||
                      (n.email || '').toLowerCase().includes(q)
                    );
                  })}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => (
                    <View style={styles.compactCard}>
                      <View style={styles.compactHeader}>
                        {item?.profilePhoto || item?.profileImage || item?.photoUrl || item?.photo || item?.avatar ? (
                          <Image
                            source={{
                              uri:
                                item?.profilePhoto ||
                                item?.profileImage ||
                                item?.photoUrl ||
                                item?.photo ||
                                item?.avatar,
                            }}
                            style={{ width: 40, height: 40, borderRadius: 20 }}
                          />
                        ) : (
                          <View style={styles.compactAvatarFallback}>
                            <MaterialCommunityIcons name="account-heart" size={20} color={COLORS.white} />
                          </View>
                        )}
                        <View style={styles.compactInfo}>
                          <Text style={styles.compactClient}>
                            {item?.name || item?.fullName || item?.displayName || 'Nurse'}
                          </Text>
                          {!!item?.nurseCode && (
                            <Text style={styles.compactMeta}>Code: {item.nurseCode}</Text>
                          )}
                        </View>
                        <TouchableWeb
                          style={styles.detailsButton}
                          onPress={() => {
                            console.log('View button pressed for:', item?.name);
                            const nurseData = { ...item };
                            setSelectedNurseDetails(nurseData);
                            setShowNurseModal(false);
                            setTimeout(() => {
                              console.log('Opening nurse details modal');
                              setNurseDetailsModalVisible(true);
                            }, 300);
                          }}
                          activeOpacity={0.8}
                        >
                          <LinearGradient
                            colors={GRADIENTS.header}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.detailsButtonGradient}
                            pointerEvents="none"
                          >
                            <Text style={styles.detailsButtonText}>View</Text>
                          </LinearGradient>
                        </TouchableWeb>
                      </View>
                    </View>
                  )}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.nurseList}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Nurse Details Modal */}
      <NurseDetailsModal
        visible={nurseDetailsModalVisible}
        onClose={() => setNurseDetailsModalVisible(false)}
        nurse={selectedNurseDetails}
        nursesRoster={nurses}
        footer={
          <TouchableWeb
            style={styles.selectNurseButton}
            onPress={() => {
              const selectedPhoto =
                selectedNurseDetails?.profilePhoto ||
                selectedNurseDetails?.profileImage ||
                selectedNurseDetails?.photoUrl ||
                selectedNurseDetails?.photo ||
                '';
              setFormData((prev) => ({
                ...prev,
                preferredNurseId: selectedNurseDetails?.id,
                preferredNurseName: selectedNurseDetails?.name,
                preferredNurseCode: selectedNurseDetails?.nurseCode || '',
                preferredNursePhoto: selectedPhoto,
              }));
              setNurseDetailsModalVisible(false);
              setShowNurseModal(false);
            }}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={GRADIENTS.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.selectNurseButtonGradient}
            >
              <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.white} />
              <Text style={styles.selectNurseButtonText}>Select This Nurse</Text>
            </LinearGradient>
          </TouchableWeb>
        }
      />

      {/* Deposit Payment Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showDepositModal}
        onRequestClose={() => !processingPayment && setShowDepositModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Booking</Text>
              {!processingPayment && (
                <TouchableWeb onPress={() => setShowDepositModal(false)}>
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableWeb>
              )}
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.depositInfoCard}>
                <MaterialCommunityIcons name="information-outline" size={24} color={COLORS.primary} />
                <Text style={styles.depositInfoTitle}>Deposit Payment Required</Text>
                <Text style={styles.depositInfoDescription}>
                  A {depositPercentSetting}% deposit is required to confirm your appointment. The remaining balance will be due after service completion.
                </Text>
                <Text style={[styles.depositInfoDescription, { color: '#EF4444', marginTop: 8, fontFamily: 'Poppins_600SemiBold' }]}>
                  Note: Deposit is non-refundable if service is cancelled.
                </Text>
              </View>

              {/* Selected Services Summary */}
              <View style={styles.summarySection}>
                <Text style={styles.summaryTitle}>Selected Services</Text>
                {formData.services.map((serviceName, index) => {
                  const service = services.find(s => s.title === serviceName);
                  // Parse price from string format (e.g., "J$7,500" or "J$15,000/hr")
                  const priceStr = service?.price || '';
                  const priceDisplay = priceStr || 'Price TBD';
                  return (
                    <View key={index} style={styles.summaryItem}>
                      <View style={styles.summaryItemLeft}>
                        <MaterialCommunityIcons 
                          name={service?.icon || 'medical-bag'} 
                          size={18} 
                          color={COLORS.primary} 
                        />
                        <Text style={styles.summaryItemText}>{serviceName}</Text>
                      </View>
                      <Text style={styles.summaryItemPrice}>
                        {priceDisplay}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Payment Breakdown */}
              <View style={styles.paymentBreakdown}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Subtotal</Text>
                  <Text style={styles.breakdownValue}>J${totalAmount.toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownDivider} />
                <View style={styles.breakdownRow}>
                  <View>
                    <Text style={styles.breakdownLabel}>Deposit (20%)</Text>
                    <Text style={styles.breakdownSubtext}>Pay now to confirm</Text>
                  </View>
                  <Text style={styles.breakdownDepositValue}>J${depositAmount.toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <View>
                    <Text style={styles.breakdownLabel}>Balance</Text>
                    <Text style={styles.breakdownSubtext}>Pay after service</Text>
                  </View>
                  <Text style={styles.breakdownValue}>J${(totalAmount - depositAmount).toLocaleString()}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={[styles.breakdownSubtext, { color: '#EF4444', fontFamily: 'Poppins_500Medium' }]}>
                      Deposit is non-refundable if cancelled
                    </Text>
                  </View>
                </View>
              </View>

              {/* Appointment Details */}
              <View style={styles.appointmentDetails}>
                <Text style={styles.appointmentDetailsTitle}>
                  {isRecurring ? 'Recurring Details' : 'Appointment Details'}
                </Text>
                
                {/* Start Date & Time */}
                <View style={styles.recurringTimeContainer}>
                  <View style={styles.recurringTimeItem}>
                    <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                    <View style={styles.recurringTimeContent}>
                      <Text style={styles.recurringTimeLabel}>Start Date</Text>
                      <Text style={styles.recurringTimeValue}>{formData.startDate}</Text>
                    </View>
                  </View>
                  <View style={styles.recurringTimeDivider} />
                  <View style={styles.recurringTimeItem}>
                    <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.primary} />
                    <View style={styles.recurringTimeContent}>
                      <Text style={styles.recurringTimeLabel}>Start Time</Text>
                      <Text style={styles.recurringTimeValue}>{formData.startTime}</Text>
                    </View>
                  </View>
                </View>

                {/* End Date & Time */}
                <View style={styles.recurringTimeContainer}>
                  <View style={styles.recurringTimeItem}>
                    <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                    <View style={styles.recurringTimeContent}>
                      <Text style={styles.recurringTimeLabel}>End Date</Text>
                      <Text style={styles.recurringTimeValue}>{formData.endDate}</Text>
                    </View>
                  </View>
                  <View style={styles.recurringTimeDivider} />
                  <View style={styles.recurringTimeItem}>
                    <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.primary} />
                    <View style={styles.recurringTimeContent}>
                      <Text style={styles.recurringTimeLabel}>End Time</Text>
                      <Text style={styles.recurringTimeValue}>{formData.endTime}</Text>
                    </View>
                  </View>
                </View>

                {/* Address */}
                <View style={styles.recurringTimeContainer}>
                  <View style={styles.recurringTimeItem}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={COLORS.primary} />
                    <View style={styles.recurringTimeContent}>
                      <Text style={styles.recurringTimeLabel}>Location</Text>
                      <Text style={styles.recurringTimeValue}>{formData.address}</Text>
                    </View>
                  </View>
                </View>

                {/* Recurring Info */}
                {isRecurring && (
                  <View style={styles.recurringTimeContainer}>
                    <View style={styles.recurringTimeItem}>
                      <MaterialCommunityIcons name="calendar-refresh" size={16} color={COLORS.info} />
                      <View style={styles.recurringTimeContent}>
                        <Text style={styles.recurringTimeLabel}>Frequency</Text>
                        <Text style={styles.recurringTimeValue}>
                          {recurringFrequency === 'weekly' 
                            ? `Weekly for ${recurringDuration} week${recurringDuration > 1 ? 's' : ''}`
                            : `Every 2 weeks for ${recurringDuration} period${recurringDuration > 1 ? 's' : ''}`
                          }
                        </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.modalFooter}>
              {!processingPayment && (
                <TouchableWeb
                  style={styles.modalCancelButton}
                  onPress={() => setShowDepositModal(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </TouchableWeb>
              )}
              <TouchableWeb
                style={[styles.modalPayButton, processingPayment && styles.buttonDisabled]}
                onPress={handleDepositPayment}
                disabled={processingPayment}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={processingPayment ? ['#ccc', '#999'] : ['#10b981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.modalPayButtonGradient}
                >
                  {processingPayment ? (
                    <View style={styles.processingContainer}>
                      <Text style={styles.modalPayButtonText}>Processing...</Text>
                    </View>
                  ) : (
                    <>
                      <MaterialCommunityIcons name="credit-card" size={18} color={COLORS.white} />
                      <Text style={styles.modalPayButtonText}>Pay J${depositAmount.toLocaleString()}</Text>
                    </>
                  )}
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
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    opacity: 0.98,
    textAlign: 'center',
    alignSelf: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.white,
    opacity: 0.9,
    textAlign: 'center',
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  formCard: {
    backgroundColor: 'transparent',
    padding: 0,
  },
  rowContainer: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: 0,
  },
  nonRecurringDateRow: {
    marginTop: SPACING.lg,
  },
  nonRecurringInputGroup: {
    marginBottom: SPACING.sm,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  required: {
    color: COLORS.error,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Platform.OS === 'android' ? 6 : SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
    backgroundColor: COLORS.white,
    borderRadius: 8,
  },
  allergyOptionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  allergyCheckboxList: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    columnGap: 10,
  },
  allergyCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    width: '48%',
  },
  allergyCheckboxLabel: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    flex: 1,
  },
  allergyOptionChip: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  allergyOptionChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  allergyOptionChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  allergyOptionChipText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  allergyOptionChipTextSelected: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  allergySelectedChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 6,
  },
  vitalsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: 10,
  },
  vitalField: {
    flex: 1,
  },
  vitalLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textMuted,
    marginBottom: 6,
  },
  allergyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  allergyAddButton: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  allergyAddButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  allergyAddButtonText: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    marginTop: 1,
  },
  allergySelectedText: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  allergyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  allergyModalCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  allergyModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  allergyModalTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    flex: 1,
  },
  allergyModalClose: {
    padding: 6,
    marginLeft: 10,
  },
  allergyModalSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  allergyModalSearchInput: {
    flex: 1,
    minHeight: 20,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    paddingVertical: 0,
  },
  allergyModalClearSearch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  allergyModalOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  allergyModalOptionText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    flex: 1,
  },
  allergyModalSectionHeader: {
    marginTop: 10,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  allergyModalSectionHeaderText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  preferredNurseAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  preferredNurseAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preferredNurseAvatarFallbackText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  selectedNursePreviewCard: {
    marginTop: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedNursePreviewAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: COLORS.white,
    backgroundColor: COLORS.white,
  },
  selectedNursePreviewAvatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    borderColor: COLORS.white,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedNursePreviewAvatarFallbackText: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  selectedNursePreviewInfo: {
    flex: 1,
    minWidth: 0,
  },
  selectedNursePreviewName: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  selectedNursePreviewMeta: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  autofilledInput: {
    backgroundColor: '#F9FAFB',
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  contactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    paddingHorizontal: 5,
  },
  contactHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillButton: {
    borderRadius: 999,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
  },
  pillButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  pillButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },
  consultationModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '88%',
    maxWidth: 360,
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  consultationModalHeader: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  consultationModalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  consultationModalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  consultationModalSubtitle: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: 'rgba(255,255,255,0.9)',
  },
  consultationModalBody: {
    padding: 16,
  },
  consultationModalBodyContent: {
    paddingBottom: 8,
  },
  consultationRequestText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 14,
    textAlign: 'center',
  },
  consultationRequestSubtext: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 17,
    marginBottom: 6,
    textAlign: 'center',
  },
  consultationScheduleSection: {
    marginTop: 14,
    marginBottom: 6,
    alignItems: 'center',
  },
  consultationScheduleTitle: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  consultationSchedulePill: {
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  consultationPickerRow: {
    alignSelf: 'stretch',
    marginBottom: 8,
  },
  consultationPickerGroup: {
    marginBottom: 0,
  },
  consultationScheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 10,
    marginBottom: 10,
  },
  consultationSchedulePillRow: {
    marginBottom: 0,
    minWidth: 140,
    maxWidth: 160,
  },
  consultationSchedulePillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  consultationSchedulePillText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },
  consultationSlotWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  consultationSlotScroll: {
    flex: 1,
  },
  consultationSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    paddingRight: 2,
  },
  consultationSlotPill: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  consultationSlotPillGradient: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  consultationSlotPillText: {
    color: COLORS.white,
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    textAlign: 'center',
  },
  consultationScheduleHint: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    textAlign: 'center',
  },
  consultationDetailCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  consultationIntroText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 12,
    lineHeight: 18,
  },
  consultationDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  consultationStepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  consultationStepNumber: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    lineHeight: 14,
  },
  consultationDetailText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 18,
  },
  editableInput: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 8,
  },
  addressWrapper: {
    position: 'relative',
    zIndex: 10,
  },
  clearButton: {
    padding: 4,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 220,
    shadowColor: COLORS.dark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10000,
    overflow: 'hidden',
  },
  suggestionsHeader: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.lightGray,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  suggestionsList: {
    maxHeight: 200,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.sm,
    backgroundColor: '#FFFFFF',
  },
  lastSuggestionItem: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
  },
  noSuggestionsContainer: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    shadowColor: COLORS.dark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 999,
  },
  noSuggestionsText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  consultationCard: {
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  consultationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  consultationIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.infoLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consultationTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  consultationTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  consultationSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  consultationButton: {
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  consultationButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
  },
  consultationButtonText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    paddingVertical: Platform.OS === 'android' ? 2 : 0,
  },
  textAreaContainer: {
    alignItems: 'flex-start',
    minHeight: 100,
    paddingTop: SPACING.md,
  },
  textAreaIcon: {
    marginTop: 2,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  serviceScroll: {
    marginTop: SPACING.sm,
  },
  serviceChip: {
    marginRight: SPACING.sm,
  },
  serviceChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    minHeight: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  inactiveServiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    minHeight: 36,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  serviceChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
  },
  serviceChipTextSelected: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
  },
  submitButton: {
    marginTop: SPACING.md,
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  submitText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: `${COLORS.info}10`,
    borderRadius: 12,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: SPACING.sm,
    marginTop: 2,
  },
  notesContainer: {
    gap: SPACING.sm,
  },
  notesInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  notesActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
  notesActionButton: {
    padding: SPACING.xs,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  // Dropdown Styles
  dropdownButton: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: SPACING.md,
  },
  dropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  dropdownText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  placeholderText: {
    color: COLORS.textMuted,
    fontFamily: 'Poppins_400Regular',
  },
  planInfo: {
    flex: 1,
  },
  planPrice: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.accent,
    marginTop: 2,
  },
  dropdownMenu: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 200,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
    gap: SPACING.sm,
  },
  dropdownItemSelected: {
    backgroundColor: `${COLORS.primary}10`,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  popularItem: {
    backgroundColor: `${COLORS.accent}05`,
  },
  planDetails: {
    flex: 1,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  planName: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  planPriceText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginTop: 2,
  },
  popularBadge: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  popularText: {
    fontSize: 9,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  pickerContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    margin: SPACING.lg,
    shadowColor: COLORS.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    maxHeight: '80%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pickerTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  pickerCloseButton: {
    padding: SPACING.sm,
  },
  pickerConfirmButton: {
    borderRadius: 10,
    marginTop: SPACING.md,
    overflow: 'hidden',
  },
  pickerConfirmGradient: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  pickerConfirmText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  recurringToggle: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  recurringToggleContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    minHeight: 24,
  },
  recurringToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flex: 1,
    minWidth: 0,
    paddingRight: SPACING.sm,
  },
  recurringToggleText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  toggleSwitch: {
    width: 50,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    shadowColor: COLORS.black,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  recurringOptions: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  recurringRow: {
    gap: SPACING.sm,
  },
  recurringLabel: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  frequencyButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  frequencyButton: {
    flex: 1,
    marginHorizontal: 1,
  },
  frequencyButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  frequencyButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
    textAlign: 'center',
  },
  frequencyButtonTextActive: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    textAlign: 'center',
  },
  frequencyButtonGradient: {
    paddingHorizontal: 10,
    paddingVertical: 2,
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
  inactiveFrequencyButton: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  durationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  durationButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  durationDisplay: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    minWidth: 80,
  },
  durationText: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  durationUnit: {
    fontSize: 10,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  daysScroll: {
    marginTop: SPACING.xs,
  },
  dayPill: {
    marginRight: SPACING.sm,
    borderRadius: 20,
    minWidth: 50,
  },
  dayPillGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactiveDayPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dayChipText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  dayChipTextSelected: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
  },
  recurringSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: COLORS.white,
    padding: SPACING.sm,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  recurringSummaryText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 16,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.lg,
  },
  // Service Selection Styles (Horizontal Scroll)
  serviceScrollContainer: {
    marginTop: SPACING.sm,
  },
  serviceScrollContent: {
    paddingRight: SPACING.md,
  },
  serviceChipWrapper: {
    marginRight: SPACING.sm,
  },
  serviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  serviceChipText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
    marginLeft: SPACING.xs,
  },
  serviceChipTextSelected: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
    marginLeft: SPACING.xs,
  },
  totalAmountContainer: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  totalAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  totalAmountLabel: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  totalAmountValue: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: '#10B981',
  },
  depositInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.xs,
  },
  depositInfoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#EF4444',
  },
  // Deposit Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  nurseModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '100%',
    maxWidth: 380,
    maxHeight: Platform.OS === 'android' ? '93%' : '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  nurseModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  nurseModalTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  nurseModalBody: {
    padding: 20,
  },
  nurseDetailsModalContainer: {
    maxHeight: '80%',
  },
  nurseDetailsModalContainer: {
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  modalContent: {
    padding: 20,
  },

  nurseSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  nurseSearchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
  },
  nurseList: {
    paddingTop: 8,
    paddingBottom: 10,
  },
  nursePickerCard: {
    marginBottom: 10,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 0,
  },
  compactCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  compactAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactInfo: {
    flex: 1,
    marginLeft: 8,
  },
  compactClient: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  compactMeta: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  detailsButton: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  detailsButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 4,
  },
  detailsButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },
  anyNurseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    marginBottom: 10,
  },
  anyNurseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  anyNurseName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  anyNurseMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  nurseLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  nurseLoadingText: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
  depositInfoCard: {
    backgroundColor: COLORS.primary + '10',
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    alignItems: 'center',
  },
  depositInfoTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  depositInfoDescription: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 20,
  },
  summarySection: {
    marginBottom: SPACING.md,
  },
  summaryTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  summaryItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  summaryItemText: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  summaryItemPrice: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  paymentBreakdown: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  breakdownLabel: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  breakdownSubtext: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  breakdownValue: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  breakdownDepositValue: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.xs,
  },
  appointmentDetails: {
    marginBottom: SPACING.md,
  },
  appointmentDetailsTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  detailText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  recurringTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  recurringTimeItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recurringTimeContent: {
    flex: 1,
  },
  recurringTimeLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  recurringTimeValue: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  recurringTimeDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  modalPayButton: {
    flex: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  modalPayButtonGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  modalPayButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nurseCardModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nurseCardModalContainer: {
    width: '85%',
    maxHeight: '75%',
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
  },
  nurseCardModalHeader: {
    paddingTop: 50,
    paddingBottom: 25,
    alignItems: 'center',
    position: 'relative',
  },
  nurseCardModalCloseButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 1,
    padding: 5,
  },
  nurseCardModalPhotoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  nurseCardModalPhoto: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  nurseCardModalTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  nurseCardModalBody: {
    padding: 20,
  },
  nurseCardInfoSection: {
    gap: 15,
  },
  nurseCardInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  nurseCardInfoContent: {
    flex: 1,
  },
  nurseCardInfoLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  nurseCardInfoValue: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  nurseCardInfoHint: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  selectNurseButton: {
    marginTop: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  selectNurseButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  selectNurseButtonText: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
});
