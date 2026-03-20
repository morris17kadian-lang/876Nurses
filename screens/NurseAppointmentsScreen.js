import TouchableWeb from "../components/TouchableWeb";
import AppOnboarding from '../components/AppOnboarding';
import React, { useState, useContext, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Modal,
  Animated,
  PanResponder,
  StatusBar,
  TouchableWithoutFeedback,
  Keyboard,
  Pressable,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useAppointments } from '../context/AppointmentContext';
import { useNurses } from '../context/NurseContext';
import { useShifts } from '../context/ShiftContext';
import { useServices } from '../context/ServicesContext';
import RecurringShiftsList from '../components/RecurringShiftsList';
import RecurringShiftDetailsModal from '../components/RecurringShiftDetailsModal';
import NurseDetailsModal from '../components/NurseDetailsModal';
import NurseInfoCard from '../components/NurseInfoCard';
import NotesAccordionList from '../components/NotesAccordionList';
import useWindowDimensions from '../hooks/useWindowDimensions';
import { getNurseName, formatAddress } from '../utils/formatters';
import ApiService from '../services/ApiService';
import FirebaseService from '../services/FirebaseService';
import { db } from '../config/firebase';
import { collection, getDocs } from 'firebase/firestore';
import InvoiceService from '../services/InvoiceService';
import PushNotificationService from '../services/PushNotificationService';

const SAFE_GRADIENTS = {
  header: Array.isArray(GRADIENTS?.header) ? GRADIENTS.header : ['#2563eb', '#1d4ed8'],
  success: Array.isArray(GRADIENTS?.success) ? GRADIENTS.success : ['#10b981', '#059669'],
  warning: Array.isArray(GRADIENTS?.warning) ? GRADIENTS.warning : ['#f59e0b', '#d97706'],
  error: Array.isArray(GRADIENTS?.error) ? GRADIENTS.error : ['#ef4444', '#dc2626'],
};

const DAYS_OF_WEEK = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

// Utilities for reminder scheduling and normalization
const APPOINTMENT_DATE_FIELDS = [
  'date',
  'startDate',
  'startDateTime',
  'scheduledDate',
  'scheduleDate',
  'preferredDate',
  'appointmentDate',
  'serviceDate',
];

const APPOINTMENT_START_TIME_FIELDS = [
  'time',
  'startTime',
  'preferredTime',
  'scheduledTime',
  'appointmentTime',
  'serviceTime',
];

const APPOINTMENT_END_TIME_FIELDS = [
  'endTime',
  'preferredEndTime',
  'scheduledEndTime',
  'expectedEndTime',
  'completionTime',
  'serviceEndTime',
];

const REMINDER_ELIGIBLE_STATUSES = new Set(['confirmed', 'active', 'clocked-in', 'assigned']);

const SHIFT_REMINDER_ELIGIBLE_STATUSES = new Set([
  'approved',
  'active',
  'clocked-in',
  'confirmed',
  'assigned',
]);

const removeOrdinalSuffix = (value) => (typeof value === 'string'
  ? value.replace(/(\d+)(st|nd|rd|th)/gi, '$1')
  : value
);

const normalizeId = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  return s.length ? s : null;
};

const normalizeCode = (value) => {
  if (!value) return null;
  const s = String(value).trim().toUpperCase();
  return s.length ? s : null;
};

const normalizeStatus = (value) => {
  if (!value) return 'pending';
  const s = String(value).trim().toLowerCase();
  if (s.includes('accept')) return 'accepted';
  if (s.includes('declin') || s.includes('reject')) return 'declined';
  return 'pending';
};

const checkIsAcceptedCoverageForNurse = (coverageRequests, nurseId, nurseCode) => {
  if (!coverageRequests || !Array.isArray(coverageRequests) || coverageRequests.length === 0) return false;
  
  const checkNurseId = normalizeId(nurseId);
  const checkNurseCode = normalizeCode(nurseCode);
  
  if (!checkNurseId && !checkNurseCode) return false;
  
  return coverageRequests.some((entry) => {
    const status = normalizeStatus(entry?.status);
    if (status !== 'accepted') return false;
    
    const acceptedId = normalizeId(entry?.acceptedBy || entry?.acceptedById || entry?.targetBackupNurseId || entry?.backupNurseId || entry?.responseById);
    const acceptedCode = normalizeCode(entry?.acceptedByStaffCode || entry?.acceptedByCode || entry?.targetBackupNurseStaffCode || entry?.backupNurseCode);
    
    if (checkNurseId && acceptedId && checkNurseId === acceptedId) return true;
    if (checkNurseCode && acceptedCode && checkNurseCode === acceptedCode) return true;
    
    return false;
  });
};

const toDateFromValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return new Date(value);
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const normalized = removeOrdinalSuffix(value.trim());

    // Handle ISO date-only strings like "2026-03-07" as LOCAL dates.
    // JS parses YYYY-MM-DD as UTC which shifts the displayed day in negative-offset timezones.
    const isoDateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoDateOnly) {
      const d = new Date(parseInt(isoDateOnly[1], 10), parseInt(isoDateOnly[2], 10) - 1, parseInt(isoDateOnly[3], 10));
      if (!isNaN(d.getTime())) return d;
    }

    // Handle "Feb 19, 2026" format from BookScreen
    const match = normalized.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
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
    
    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }
  if (typeof value === 'object') {
    if (typeof value._seconds === 'number') {
      return new Date(value._seconds * 1000);
    }
    if (typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate();
      } catch (error) {
        // Ignore invalid timestamp objects
      }
    }
    if (value.date || value.time) {
      const combined = `${value.date || ''} ${value.time || ''}`.trim();
      if (combined) {
        const parsed = Date.parse(removeOrdinalSuffix(combined));
        if (!Number.isNaN(parsed)) {
          return new Date(parsed);
        }
      }
    }
  }
  return null;
};

const parseTimeComponents = (timeValue) => {
  if (timeValue === null || timeValue === undefined) return null;
  if (typeof timeValue === 'number' && timeValue >= 0) {
    const hours = Math.floor(timeValue / 100);
    const minutes = timeValue % 100;
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return { hours, minutes };
    }
  }
  const trimmed = timeValue.toString().trim();
  const match = trimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3]?.toUpperCase();
  if (period === 'AM' && hours === 12) {
    hours = 0;
  } else if (period === 'PM' && hours < 12) {
    hours += 12;
  }
  if (hours >= 0 && hours < 24) {
    return { hours, minutes };
  }
  return null;
};

const getAppointmentDateTime = (appointment, type = 'start') => {
  if (!appointment) return null;
  const dateFields = [...APPOINTMENT_DATE_FIELDS];
  if (type === 'end') {
    dateFields.unshift('endDate');
  }

  let dateValue = null;
  for (const fieldName of dateFields) {
    if (appointment[fieldName]) {
      dateValue = appointment[fieldName];
      break;
    }
  }

  if (!dateValue && appointment.schedule) {
    dateValue = type === 'end'
      ? appointment.schedule.endDate || appointment.schedule.date
      : appointment.schedule.startDate || appointment.schedule.date;
  }

  const baseDate = toDateFromValue(dateValue);
  if (!baseDate) return null;

  const timeFields = type === 'end' ? APPOINTMENT_END_TIME_FIELDS : APPOINTMENT_START_TIME_FIELDS;
  let timeValue = null;
  for (const fieldName of timeFields) {
    if (appointment[fieldName]) {
      timeValue = appointment[fieldName];
      break;
    }
  }

  if (!timeValue && appointment.schedule) {
    timeValue = type === 'end'
      ? appointment.schedule.endTime || appointment.schedule.expectedEndTime
      : appointment.schedule.startTime || appointment.schedule.time;
  }

  if (!timeValue) {
    return baseDate;
  }

  const components = parseTimeComponents(timeValue);
  if (!components) {
    return baseDate;
  }

  const result = new Date(baseDate);
  result.setHours(components.hours, components.minutes || 0, 0, 0);
  return result;
};

const getAppointmentIdentifier = (appointment) => {
  if (!appointment) return null;
  const candidates = ['id', 'appointmentId', 'assignmentId', 'bookingId', 'requestId', 'documentId'];
  for (const key of candidates) {
    if (appointment[key]) {
      return String(appointment[key]);
    }
  }
  return null;
};

const getShiftIdentifier = (shift) => {
  if (!shift) return null;
  const candidates = ['id', '_id', 'shiftId', 'requestId', 'documentId'];
  for (const key of candidates) {
    if (shift[key]) return String(shift[key]);
  }
  return null;
};

const isShiftLikeAppointment = (appointment) => Boolean(
  appointment?.isShift ||
  appointment?.isShiftRequest ||
  appointment?.isRecurring
);

const describeAppointment = (appointment) => {
  if (!appointment) return 'Appointment';
  const serviceName = appointment.service || appointment.serviceName || appointment.serviceType || 'Appointment';
  const patientName = appointment.patientName ||
    appointment.clientName ||
    appointment.patient?.fullName ||
    appointment.client?.fullName;
  return patientName ? `${serviceName} with ${patientName}` : serviceName;
};

const describeShift = (shift) => {
  if (!shift) return 'Shift';
  const serviceName =
    shift.service ||
    shift.serviceType ||
    shift.serviceName ||
    shift.shiftType ||
    shift.role ||
    'Shift';
  const patientName =
    shift.patientName ||
    shift.clientName ||
    shift.patient?.fullName ||
    shift.client?.fullName;
  return patientName ? `${serviceName} with ${patientName}` : serviceName;
};

export default function NurseAppointmentsScreen({ navigation, route }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const backupDetailsCardSizeStyle = useMemo(() => {
    const width = Math.min(screenWidth - 40, 380);
    const maxHeight = Math.round(screenHeight * 0.75);
    return { width, maxHeight };
  }, [screenWidth, screenHeight]);
  
  // Helper function to format time from 24-hour to 12-hour format
  const formatTimeTo12Hour = (timeString) => {
    if (!timeString) return 'N/A';
    
    // If it's already in 12-hour format, return as is
    if (timeString.includes('AM') || timeString.includes('PM')) {
      return timeString;
    }
    
    // Handle 24-hour format like "23:14" or "11:14"
    const [hours, minutes] = timeString.split(':');
    const hour24 = parseInt(hours);
    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Match AdminRecurringShiftModal date display formatting
  const formatDateDisplay = (dateValue) => {
    if (!dateValue) return 'Select date';
    const date = toDateFromValue(dateValue);
    if (!(date instanceof Date) || isNaN(date.getTime())) return 'Select date';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  
  // Add error boundary check
    const { user } = useAuth();
    const { 
      unreadCount, 
      sendNotificationToUser,
      pushPermissionStatus,
      requestPushPermissions
    } = useNotifications();
    const { nurses, updateNurse, updateNurseActiveStatus } = useNurses();
    const { 
      appointments,
      getAppointmentsByNurse, 
      acceptAppointment, 
      declineAppointment,
      completeAppointment,
      clockInAppointment,
      clearCompletedAppointments,
      updateNurseAvailability,
      updateNurseNotes,
      addCompletedAppointmentFromShift,
      refreshAppointments
    } = useAppointments();
    const { 
      submitShiftRequest: submitShiftToContext, 
      getApprovedShiftsByNurse,
      getShiftRequestsByNurse,
      clearAllShiftRequests,
      startShift,
      completeShift,
      refreshShiftRequests,
      shiftRequests,  // Add to track global context changes
      updateShiftNotes,
      cancelShiftRequest,
      updateShiftRequestDetails,
    } = useShifts();
    const { services } = useServices();
  
  // Centralized helper to update notes for both appointments and shift requests
  const updateItemNotes = async (itemId, notes, isShiftLike = false, extraUpdates = {}) => {
    const sanitizedNotes = typeof notes === 'string' ? notes : '';
    const safeExtraUpdates = extraUpdates && typeof extraUpdates === 'object' ? extraUpdates : {};

    if (isShiftLike) {
      await updateShiftRequestDetails(itemId, {
        notes: sanitizedNotes,
        nurseNotes: sanitizedNotes,
        ...safeExtraUpdates,
      });
      await updateShiftNotes(itemId, sanitizedNotes);
    } else {
      await updateNurseNotes(itemId, sanitizedNotes);
      if (Object.keys(safeExtraUpdates).length > 0) {
        await ApiService.updateAppointment(itemId, safeExtraUpdates);
      }
    }
  };

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [selectedCard, setSelectedCard] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Time tracking state
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnShift, setIsOnShift] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [shiftStartTime, setShiftStartTime] = useState(null);
  const [breakStartTime, setBreakStartTime] = useState(null);
  const [notesModalVisible, setNotesModalVisible] = useState(false);
  const [shiftNotes, setShiftNotes] = useState('');
  const [actionType, setActionType] = useState(''); // 'clockin', 'clockout', 'break'
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedItemDetails, setSelectedItemDetails] = useState(null);
  const [selectedItemForNotes, setSelectedItemForNotes] = useState(null);
  const [selectedShiftForClockOut, setSelectedShiftForClockOut] = useState(null);
  const [notePhotoUris, setNotePhotoUris] = useState([]);
  const [notePhotoPickerBusy, setNotePhotoPickerBusy] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [noteVitals, setNoteVitals] = useState({ bpSystolic: '', bpDiastolic: '', heartRate: '', temperature: '', oxygenSaturation: '' });
  const [notePhotoPreviewVisible, setNotePhotoPreviewVisible] = useState(false);
  const [notePhotoPreviewUri, setNotePhotoPreviewUri] = useState('');
  const [pendingRecurringShifts, setPendingRecurringShifts] = useState([]);
  const [recurringShiftDetailsModalVisible, setRecurringShiftDetailsModalVisible] = useState(false);
  const [selectedRecurringShift, setSelectedRecurringShift] = useState(null);
  const [hideRecurringShiftDetailsFooter, setHideRecurringShiftDetailsFooter] = useState(false);
  
  // Shift booking state
  const [hasApprovedShift, setHasApprovedShift] = useState(false); // This would come from backend in real app
  const [hasClockOut, setHasClockOut] = useState(false); // Track if user has clocked out
  const [activeShifts, setActiveShifts] = useState([]); // Track active shifts - cleared for testing
  const [completedShifts, setCompletedShifts] = useState([]); // Track completed shifts - cleared for testing
  const [shiftBookingModal, setShiftBookingModal] = useState(false);
  const [resumeShiftModalAfterDetails, setResumeShiftModalAfterDetails] = useState(false);
  const [rescheduleShiftRequestId, setRescheduleShiftRequestId] = useState(null);
  const [allPatients, setAllPatients] = useState([]);
  const appointmentRemindersRef = useRef({});
  const shiftRemindersRef = useRef({});

  // Find current nurse in NurseContext and get their availability status
  // (User profile may store the code under nurseCode/staffCode/code/username)
  const currentNurse = React.useMemo(() => {
    if (!Array.isArray(nurses) || nurses.length === 0) return null;

    const candidateCode =
      user?.nurseCode ||
      user?.staffCode ||
      user?.code ||
      user?.username ||
      null;

    if (!candidateCode) return null;
    const needle = String(candidateCode).trim().toUpperCase();
    if (!needle) return null;

    return (
      nurses.find((nurse) => {
        const hay = nurse?.code || nurse?.nurseCode || nurse?.staffCode || nurse?.username;
        if (!hay) return false;
        return String(hay).trim().toUpperCase() === needle;
      }) || null
    );
  }, [nurses, user]);

  const formatCoordinatePair = (coords) => {
    if (!coords) return null;
    const { latitude, longitude } = coords;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
    return null;
  };

  const sanitizeLocationAddressText = (value) => {
    if (!value || typeof value !== 'string') return null;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;

    const rawSegments = cleaned
      .split(/[\n,]+/)
      .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const shouldOmit = (seg) => {
      const normalized = String(seg || '')
        .replace(/^[,\s]+|[,\s]+$/g, '')
        .trim()
        .toLowerCase();
      return normalized === 'surrey' || normalized === 'surrey county';
    };

    const seen = new Set();
    const unique = [];
    for (const seg of rawSegments) {
      if (shouldOmit(seg)) continue;
      const key = seg.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(seg);
    }

    return unique.length ? unique.join(', ') : null;
  };

  const getLocationDisplayText = (location) => {
    if (!location) return null;
    if (typeof location === 'string') {
      return sanitizeLocationAddressText(location) || location.trim() || null;
    }
    if (typeof location.address === 'string' && location.address.trim()) {
      return sanitizeLocationAddressText(location.address) || location.address.trim();
    }
    return formatCoordinatePair(location);
  };

  const buildMapsUrlFromLocation = (location) => {
    if (!location) return null;
    const { latitude, longitude } = location;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  };

  const openLocationInMaps = (location) => {
    const url = buildMapsUrlFromLocation(location);
    if (!url) {
      return;
    }
    Linking.openURL(url).catch((error) => {
      console.error('Failed to open maps link:', error);
    });
  };

  const resolveAddressFromCoords = useCallback(async (latitude, longitude) => {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (Array.isArray(results) && results.length > 0) {
        const {
          streetNumber,
          street,
          name,
          city,
          district,
          region,
          postalCode,
          country,
        } = results[0];
        const streetLine = [streetNumber || name, street]
          .filter(Boolean)
          .join(' ')
          .trim();
        const cityLine = [city, district]
          .filter(Boolean)
          .join(', ')
          .trim();
        const regionLine = [region, postalCode]
          .filter(Boolean)
          .join(' ')
          .trim();
        const segments = [streetLine, cityLine, regionLine, country]
          .filter(segment => segment && segment.length > 0)
          .filter((segment) => {
            const normalized = String(segment).trim().toLowerCase();
            return normalized !== 'surrey' && normalized !== 'surrey county';
          });
        if (segments.length > 0) {
          return segments.join(', ');
        }
      }
    } catch (error) {
      console.error('Failed to reverse geocode location:', error);
    }
    return null;
  }, []);

  const createLocationPayload = useCallback(async (latitude, longitude, timestamp) => {
    const address = await resolveAddressFromCoords(latitude, longitude);
    return {
      latitude,
      longitude,
      timestamp,
      ...(address ? { address } : {}),
    };
  }, [resolveAddressFromCoords]);

  const renderLocationLinkRow = (label, location) => {
    const displayText = getLocationDisplayText(location);
    if (!displayText) return null;
    return (
      <TouchableOpacity
        style={styles.locationInfo}
        onPress={() => openLocationInMaps(location)}
        activeOpacity={0.85}
      >
        <MaterialCommunityIcons name="map-marker" size={18} color={COLORS.primary} />
        <View style={styles.locationInfoContent}>
          <Text style={styles.locationLabel}>{label}</Text>
          <Text style={styles.locationLinkText}>{displayText}</Text>
        </View>
        <MaterialCommunityIcons name="open-in-new" size={18} color={COLORS.primary} />
      </TouchableOpacity>
    );
  };

  const ensureNotificationPermission = useCallback(async () => {
    if (pushPermissionStatus === 'granted') {
      return true;
    }
    const status = await requestPushPermissions();
    return status === 'granted';
  }, [pushPermissionStatus, requestPushPermissions]);

  const getShiftScheduledStartDateTimeForReminders = useCallback((shift) => {
    if (!shift || typeof shift !== 'object') return null;

    // Check if this is a recurring shift
    const isAdminRecurring = shift?.adminRecurring === true || 
      String(shift?.adminRecurring || '').trim().toLowerCase() === 'true';
    const isPatientRecurring = shift?.isRecurring === true || 
      String(shift?.isRecurring || '').trim().toLowerCase() === 'true' || 
      (shift?.recurringSchedule && typeof shift?.recurringSchedule === 'object');
    const isRecurring = isAdminRecurring || isPatientRecurring;

    const timeCandidate =
      shift.actualStartTime ||
      shift.startedAt ||
      shift.clockInTime ||
      shift.startTime ||
      shift.time ||
      shift.preferredTime ||
      shift.scheduledTime ||
      shift.scheduledStartTime ||
      shift.recurringStartTime ||
      null;

    const dateCandidate =
      shift.scheduledDate ||
      shift.date ||
      shift.shiftDate ||
      shift.startDate ||
      shift.serviceDate ||
      shift.requestedDate ||
      null;

    // For recurring shifts, find the next occurrence
    if (isRecurring && timeCandidate) {
      const daysRaw = [
        shift.daysOfWeek,
        shift.recurringDaysOfWeek,
        shift.recurringDaysOfWeekList,
        shift.selectedDays,
        shift.recurringDays,
        shift.recurringSchedule?.daysOfWeek,
        shift.recurringSchedule?.selectedDays,
        shift.schedule?.daysOfWeek,
        shift.schedule?.selectedDays,
      ]
        .filter(Boolean)
        .flatMap((value) => (Array.isArray(value) ? value : [value]));

      const normalizeDaysOfWeekForReminders = (raw) => {
        const list = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
        const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        const out = [];

        for (const item of list) {
          if (item == null) continue;

          if (typeof item === 'number' && Number.isFinite(item)) {
            const v = ((item % 7) + 7) % 7;
            out.push(v);
            continue;
          }

          if (item instanceof Date && Number.isFinite(item.getTime())) {
            out.push(item.getDay());
            continue;
          }

          if (typeof item === 'object') {
            try {
              for (const [key, value] of Object.entries(item)) {
                if (typeof value === 'boolean') {
                  if (value) out.push(key);
                } else {
                  out.push(value);
                }
              }
            } catch (e) {
              // ignore
            }
            continue;
          }

          const s = String(item).trim();
          if (!s) continue;
          const lower = s.toLowerCase();
          if (map[lower] != null) {
            out.push(map[lower]);
            continue;
          }
          const abbrev = lower.slice(0, 3);
          if (map[abbrev] != null) {
            out.push(map[abbrev]);
            continue;
          }
          const asNum = Number(lower);
          if (Number.isFinite(asNum)) {
            const v = ((asNum % 7) + 7) % 7;
            out.push(v);
          }
        }

        return Array.from(
          new Set(
            out
              .map((v) => {
                if (typeof v === 'number' && Number.isFinite(v)) return ((v % 7) + 7) % 7;
                const s = String(v).trim().toLowerCase();
                if (map[s] != null) return map[s];
                const abbrev = s.slice(0, 3);
                if (map[abbrev] != null) return map[abbrev];
                const asNum = Number(s);
                return Number.isFinite(asNum) ? ((asNum % 7) + 7) % 7 : null;
              })
              .filter((d) => d !== null),
          ),
        ).sort((a, b) => a - b);
      };

      const days = normalizeDaysOfWeekForReminders(daysRaw);
      if (days.length === 0) return null;

      const periodStart = toDateFromValue(
        shift.recurringPeriodStart ||
        shift.recurringStartDate ||
        shift.startDate ||
        null
      );
      const periodEnd = toDateFromValue(
        shift.recurringPeriodEnd ||
        shift.recurringEndDate ||
        shift.endDate ||
        null
      );

      const components = parseTimeComponents(timeCandidate);
      if (!components) return null;
      
      const hours = components.hours;
      const minutes = components.minutes || 0;
      const now = new Date();

      // Search up to 14 days to find the next occurrence
      for (let offset = 0; offset <= 14; offset++) {
        const candidate = new Date(now);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(hours, minutes, 0, 0);

        if (!days.includes(candidate.getDay())) continue;
        
        if (periodStart) {
          const periodStartDate = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate(), 0, 0, 0, 0);
          if (candidate < periodStartDate) continue;
        }
        
        if (periodEnd) {
          const periodEndDate = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999);
          if (candidate > periodEndDate) continue;
        }

        return candidate;
      }

      return null;
    }

    // Non-recurring shift logic
    if (!timeCandidate) {
      return dateCandidate ? toDateFromValue(dateCandidate) : null;
    }

    // If it's a full datetime (ISO), keep it.
    const raw = String(timeCandidate).trim();
    if (raw.includes('T') || /\d{4}-\d{2}-\d{2}/.test(raw)) {
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    const base = dateCandidate ? toDateFromValue(dateCandidate) : new Date();
    if (!base) return null;

    const components = parseTimeComponents(timeCandidate);
    if (!components) return null;

    const result = new Date(base);
    result.setHours(components.hours, components.minutes || 0, 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }, []);

  const getShiftScheduledEndDateTime = useCallback((shift) => {
    if (!shift || typeof shift !== 'object') return null;

    const timeCandidate =
      shift.actualEndTime ||
      shift.completedAt ||
      shift.clockOutTime ||
      shift.endTime ||
      shift.preferredEndTime ||
      shift.scheduledEndTime ||
      shift.expectedEndTime ||
      shift.serviceEndTime ||
      shift.recurringEndTime ||
      null;

    const dateCandidate =
      shift.scheduledDate ||
      shift.date ||
      shift.shiftDate ||
      shift.startDate ||
      shift.serviceDate ||
      shift.requestedDate ||
      null;

    if (!timeCandidate) {
      return dateCandidate ? toDateFromValue(dateCandidate) : null;
    }

    // If it's a full datetime (ISO), keep it.
    const raw = String(timeCandidate).trim();
    if (raw.includes('T') || /\d{4}-\d{2}-\d{2}/.test(raw)) {
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    const base = dateCandidate ? toDateFromValue(dateCandidate) : new Date();
    if (!base) return null;

    const components = parseTimeComponents(timeCandidate);
    if (!components) return null;

    const result = new Date(base);
    result.setHours(components.hours, components.minutes || 0, 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }, []);

  const scheduleShiftClockReminder = useCallback(async (shift, triggerDate, action) => {
    if (!(triggerDate instanceof Date) || Number.isNaN(triggerDate.getTime())) {
      return null;
    }

    const shiftId = getShiftIdentifier(shift);
    if (!shiftId) return null;

    const descriptor = describeShift(shift);
    const title = action === 'clockout' ? 'Clock Out Reminder' : 'Clock In Reminder';
    const body = action === 'clockout'
      ? `${descriptor} is wrapping up now. Please clock out.`
      : `${descriptor} is starting now. Please clock in.`;

    try {
      return await PushNotificationService.scheduleNotification(title, body, triggerDate, {
        type: 'shift-clock',
        action,
        shiftId,
        screen: 'NurseAppointments',
      });
    } catch (error) {
      console.error('Failed to schedule shift reminder:', error);
      return null;
    }
  }, []);

  const cancelAllRemindersForShift = useCallback(async (shiftIdentifier) => {
    const shiftId = typeof shiftIdentifier === 'string'
      ? shiftIdentifier
      : getShiftIdentifier(shiftIdentifier);

    if (!shiftId) return;

    const entry = shiftRemindersRef.current[shiftId];
    if (!entry) return;

    try {
      if (entry.clockInId) {
        await PushNotificationService.cancelNotification(entry.clockInId);
      }
      if (entry.clockOutId) {
        await PushNotificationService.cancelNotification(entry.clockOutId);
      }
    } catch (error) {
      console.error('Failed to cancel scheduled shift reminder:', error);
    } finally {
      delete shiftRemindersRef.current[shiftId];
    }
  }, []);

  const cancelAllShiftReminderEntries = useCallback(async () => {
    const storedIds = Object.keys(shiftRemindersRef.current);
    for (const shiftId of storedIds) {
      await cancelAllRemindersForShift(shiftId);
    }
  }, [cancelAllRemindersForShift]);

  const manageShiftReminderForAction = useCallback(async (shift, action, now = new Date()) => {
    const shiftId = getShiftIdentifier(shift);
    if (!shiftId) return;

    const entry = shiftRemindersRef.current[shiftId] || {};
    const reminderKey = action === 'clockout' ? 'clockOutId' : 'clockInId';
    const triggerKey = action === 'clockout' ? 'clockOutTrigger' : 'clockInTrigger';

    const hasClockIn = Boolean(shift?.actualStartTime || shift?.startedAt || shift?.clockInTime || shift?.clockInLocation);
    const hasClockOut = Boolean(shift?.actualEndTime || shift?.completedAt || shift?.clockOutTime);

    if (action === 'clockin' && hasClockIn) {
      if (entry[reminderKey]) {
        try {
          await PushNotificationService.cancelNotification(entry[reminderKey]);
        } catch (error) {
          console.error('Failed to cancel fulfilled shift reminder:', error);
        }
        entry[reminderKey] = null;
        entry[triggerKey] = null;
      }
      if (entry.clockInId || entry.clockOutId) {
        shiftRemindersRef.current[shiftId] = entry;
      } else {
        delete shiftRemindersRef.current[shiftId];
      }
      return;
    }

    if (action === 'clockout' && hasClockOut) {
      if (entry[reminderKey]) {
        try {
          await PushNotificationService.cancelNotification(entry[reminderKey]);
        } catch (error) {
          console.error('Failed to cancel fulfilled shift reminder:', error);
        }
        entry[reminderKey] = null;
        entry[triggerKey] = null;
      }
      if (entry.clockInId || entry.clockOutId) {
        shiftRemindersRef.current[shiftId] = entry;
      } else {
        delete shiftRemindersRef.current[shiftId];
      }
      return;
    }

    const targetDate = action === 'clockout'
      ? getShiftScheduledEndDateTime(shift)
      : getShiftScheduledStartDateTimeForReminders(shift);

    if (!targetDate || targetDate <= now) {
      if (entry[reminderKey]) {
        try {
          await PushNotificationService.cancelNotification(entry[reminderKey]);
        } catch (error) {
          console.error('Failed to cancel expired shift reminder:', error);
        }
        entry[reminderKey] = null;
        entry[triggerKey] = null;
      }
      if (entry.clockInId || entry.clockOutId) {
        shiftRemindersRef.current[shiftId] = entry;
      } else {
        delete shiftRemindersRef.current[shiftId];
      }
      return;
    }

    const serialized = targetDate.toISOString();
    if (entry[reminderKey] && entry[triggerKey] === serialized) {
      shiftRemindersRef.current[shiftId] = entry;
      return;
    }

    if (entry[reminderKey]) {
      try {
        await PushNotificationService.cancelNotification(entry[reminderKey]);
      } catch (error) {
        console.error('Failed to reschedule shift reminder:', error);
      }
    }

    const reminderId = await scheduleShiftClockReminder(shift, targetDate, action);
    if (reminderId) {
      entry[reminderKey] = reminderId;
      entry[triggerKey] = serialized;
      shiftRemindersRef.current[shiftId] = entry;
    }
  }, [getShiftScheduledEndDateTime, getShiftScheduledStartDateTimeForReminders, scheduleShiftClockReminder]);

  const scheduleClockReminder = useCallback(async (appointment, triggerDate, action) => {
    if (!(triggerDate instanceof Date) || Number.isNaN(triggerDate.getTime())) {
      return null;
    }

    const appointmentId = getAppointmentIdentifier(appointment);
    if (!appointmentId) {
      return null;
    }

    const descriptor = describeAppointment(appointment);
    const title = action === 'clockout' ? 'Clock Out Reminder' : 'Clock In Reminder';
    const body = action === 'clockout'
      ? `${descriptor} is wrapping up now. Please clock out.`
      : `${descriptor} is starting now. Please clock in.`;

    try {
      return await PushNotificationService.scheduleNotification(title, body, triggerDate, {
        type: 'appointment-clock',
        action,
        appointmentId,
        screen: 'NurseAppointments',
      });
    } catch (error) {
      console.error('Failed to schedule appointment reminder:', error);
      return null;
    }
  }, []);

  const cancelAllRemindersForAppointment = useCallback(async (appointmentIdentifier) => {
    const appointmentId = typeof appointmentIdentifier === 'string'
      ? appointmentIdentifier
      : getAppointmentIdentifier(appointmentIdentifier);

    if (!appointmentId) {
      return;
    }

    const entry = appointmentRemindersRef.current[appointmentId];
    if (!entry) {
      return;
    }

    try {
      if (entry.clockInId) {
        await PushNotificationService.cancelNotification(entry.clockInId);
      }
      if (entry.clockOutId) {
        await PushNotificationService.cancelNotification(entry.clockOutId);
      }
    } catch (error) {
      console.error('Failed to cancel scheduled reminder:', error);
    } finally {
      delete appointmentRemindersRef.current[appointmentId];
    }
  }, []);

  const cancelAllReminderEntries = useCallback(async () => {
    const storedIds = Object.keys(appointmentRemindersRef.current);
    for (const appointmentId of storedIds) {
      await cancelAllRemindersForAppointment(appointmentId);
    }
  }, [cancelAllRemindersForAppointment]);

  const manageReminderForAction = useCallback(async (appointment, action, now = new Date()) => {
    const appointmentId = getAppointmentIdentifier(appointment);
    if (!appointmentId) {
      return;
    }

    const entry = appointmentRemindersRef.current[appointmentId] || {};
    const reminderKey = action === 'clockout' ? 'clockOutId' : 'clockInId';
    const triggerKey = action === 'clockout' ? 'clockOutTrigger' : 'clockInTrigger';
    const actualKey = action === 'clockout' ? 'actualEndTime' : 'actualStartTime';

    if (appointment[actualKey]) {
      if (entry[reminderKey]) {
        try {
          await PushNotificationService.cancelNotification(entry[reminderKey]);
        } catch (error) {
          console.error('Failed to cancel fulfilled reminder:', error);
        }
        entry[reminderKey] = null;
        entry[triggerKey] = null;
      }
      if (entry.clockInId || entry.clockOutId) {
        appointmentRemindersRef.current[appointmentId] = entry;
      } else {
        delete appointmentRemindersRef.current[appointmentId];
      }
      return;
    }

    const targetDate = getAppointmentDateTime(appointment, action === 'clockout' ? 'end' : 'start');
    if (!targetDate || targetDate <= now) {
      if (entry[reminderKey]) {
        try {
          await PushNotificationService.cancelNotification(entry[reminderKey]);
        } catch (error) {
          console.error('Failed to cancel expired reminder:', error);
        }
        entry[reminderKey] = null;
        entry[triggerKey] = null;
      }
      if (entry.clockInId || entry.clockOutId) {
        appointmentRemindersRef.current[appointmentId] = entry;
      } else {
        delete appointmentRemindersRef.current[appointmentId];
      }
      return;
    }

    const serialized = targetDate.toISOString();
    if (entry[reminderKey] && entry[triggerKey] === serialized) {
      appointmentRemindersRef.current[appointmentId] = entry;
      return;
    }

    if (entry[reminderKey]) {
      try {
        await PushNotificationService.cancelNotification(entry[reminderKey]);
      } catch (error) {
        console.error('Failed to reschedule reminder:', error);
      }
    }

    const reminderId = await scheduleClockReminder(appointment, targetDate, action);
    if (reminderId) {
      entry[reminderKey] = reminderId;
      entry[triggerKey] = serialized;
      appointmentRemindersRef.current[appointmentId] = entry;
    }
  }, [scheduleClockReminder]);

  // Don't clear selectedItemDetails when modal closes to preserve notes
  // The details will be refreshed when the modal is reopened

  // Fetch all patients/users from database on mount
  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const users = await ApiService.getUsers({ role: 'patient' });
        setAllPatients(users);
      } catch (error) {
        console.error('Error fetching patients:', error);
      }
    };
    fetchPatients();
  }, []);

  const clientsList = useMemo(() => {
    const uniqueClients = [];
    const seenIds = new Set();

    // First, add all patients from database (this is the source of truth)
    if (allPatients && Array.isArray(allPatients)) {
      allPatients.forEach((patient) => {
        if (patient.id && !seenIds.has(patient.id)) {
          seenIds.add(patient.id);
          uniqueClients.push({
            id: patient.id,
            name: patient.fullName || patient.name || `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown Client',
            address: patient.address || '',
            email: patient.email || '',
            phone: patient.phone || patient.phoneNumber || '',
            firstName: patient.firstName || '',
            lastName: patient.lastName || '',
            fullName: patient.fullName || patient.name || '',
            profilePhoto: patient.profilePhoto || patient.profileImage || patient.photoUrl || patient.photoURL || patient.imageUrl || patient.avatar || patient.avatarUrl || null,
            profileImage: patient.profileImage || patient.profilePhoto || null,
          });
        }
      });
    }

    // Then, add any clients from appointments that aren't in the database yet
    if (appointments && Array.isArray(appointments)) {
      appointments.forEach((app) => {
        const clientId = app.clientId || app.patientId;
        if (clientId && !seenIds.has(clientId)) {
          seenIds.add(clientId);
          uniqueClients.push({
            id: clientId,
            name: app.clientName || app.patientName || 'Unknown Client',
            address: app.clientAddress || app.patientAddress || app.address || '',
            email: app.clientEmail || app.patientEmail || app.email || '',
            phone: app.clientPhone || app.patientPhone || app.phone || '',
            profilePhoto: app.clientProfilePhoto || app.patientProfilePhoto || app.clientPhoto || app.patientPhoto || app.profilePhoto || app.profileImage || app.photoUrl || app.photoURL || app.imageUrl || app.avatar || app.avatarUrl || null,
            profileImage: app.profileImage || app.profilePhoto || null,
          });
        }
      });
    }

    return uniqueClients;
  }, [appointments, allPatients]);

  // Build fast lookup map for clients to avoid repeated .find scans
  const clientsById = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(clientsList)) return map;
    clientsList.forEach((client) => {
      if (!client) return;
      const idCandidates = [client.id, client.uid, client._id];
      idCandidates.forEach((raw) => {
        if (!raw) return;
        const key = String(raw).trim();
        if (key) {
          if (!map.has(key)) {
            map.set(key, client);
          }
        }
      });
    });
    return map;
  }, [clientsList]);

  const sanitizeMediaValue = useCallback((value) => {
    if (!value) return '';
    if (typeof value === 'object') {
      if (typeof value.uri === 'string') return value.uri;
      if (typeof value.url === 'string') return value.url;
      if (typeof value.downloadURL === 'string') return value.downloadURL;
    }
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (['n/a', 'na', 'none', 'null', 'undefined', 'no photo', 'no image'].includes(lower)) {
      return '';
    }
    return trimmed;
  }, []);

  const getInitials = useCallback((value) => {
    if (!value || typeof value !== 'string') return 'NA';
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'NA';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }, []);

  const getPhotoUri = useCallback((value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.uri === 'string') return value.uri;
    return null;
  }, []);

  const resolveClientProfilePhoto = useCallback((record) => {
    if (!record) return null;
    const directCandidates = [
      record.clientProfilePhoto,
      record.patientProfilePhoto,
      record.clientPhoto,
      record.patientPhoto,
      record.profilePhoto,
      record.profileImage,
      record.profileImageUrl,
      record.profilePicture,
      record.photoUrl,
      record.photoURL,
      record.photo,
      record.imageUrl,
      record.avatar,
      record.avatarUrl,
      record.clientAvatar,
      record.clientAvatarUrl,
      record.client?.profilePhoto,
      record.client?.profileImage,
      record.client?.profileImageUrl,
      record.client?.profilePicture,
      record.client?.photoUrl,
      record.client?.photoURL,
      record.client?.photo,
      record.client?.imageUrl,
      record.client?.avatar,
      record.client?.avatarUrl,
      record.patient?.profilePhoto,
      record.patient?.profileImage,
      record.patient?.profileImageUrl,
      record.patient?.profilePicture,
      record.patient?.photoUrl,
      record.patient?.photoURL,
      record.patient?.photo,
      record.patient?.imageUrl,
      record.patient?.avatar,
      record.patient?.avatarUrl,
    ].map(sanitizeMediaValue);
    const direct = directCandidates.find(Boolean);
    if (direct) return direct;

    const clientId =
      record.clientId ||
      record.patientId ||
      record.clientUid ||
      record.patientUid ||
      record.client?.id ||
      record.patient?.id ||
      record.uid ||
      null;
    const clientEmail =
      record.clientEmail ||
      record.patientEmail ||
      record.email ||
      record.client?.email ||
      record.patient?.email ||
      record.user?.email ||
      null;

    if ((clientId || clientEmail) && Array.isArray(clientsList)) {
      const found = clientsList.find((client) =>
        (clientId && (String(client.id) === String(clientId) || String(client.uid || '') === String(clientId))) ||
        (clientEmail && String(client.email || '').toLowerCase() === String(clientEmail).toLowerCase())
      );
      const foundCandidates = [
        found?.profilePhoto,
        found?.profileImage,
        found?.profileImageUrl,
        found?.profilePicture,
        found?.photoUrl,
        found?.photoURL,
        found?.photo,
        found?.imageUrl,
        found?.avatar,
        found?.avatarUrl,
      ].map(sanitizeMediaValue);
      return foundCandidates.find(Boolean) || null;
    }

    return null;
  }, [clientsList, sanitizeMediaValue]);

  const selectedItemDisplayNurseName = useMemo(() => {
    if (!selectedItemDetails) return null;

    const normalize = (value) => (value ? String(value).toLowerCase() : null);
    const findNurseById = (candidateId) => {
      if (!candidateId || !nurses || nurses.length === 0) return null;
      const normalizedCandidate = normalize(candidateId);
      return nurses.find(nurse => {
        const idsToCheck = [nurse.id, nurse._id, nurse.nurseId, nurse.code];
        return idsToCheck.some(idValue => normalize(idValue) === normalizedCandidate);
      }) || null;
    };

    // NEW: Check for accepted coverage requests - if one exists, the "Assigned Nurse" 
    // for display (especially in Service Info) should be the nurse being covered.
    const coverageList = Array.isArray(selectedItemDetails.coverageRequests) ? selectedItemDetails.coverageRequests : [];
    const acceptedCoverage = coverageList.find(cr => normalizeStatus(cr?.status) === 'accepted');
    
    if (acceptedCoverage) {
      const requestingName = acceptedCoverage.requestingNurseName || acceptedCoverage.requestedByNurseName;
      if (requestingName) return requestingName;
      
      const matched = findNurseById(acceptedCoverage.requestingNurseId || acceptedCoverage.requestedByNurseId);
      if (matched) return getNurseName(matched);
    }

    if (selectedItemDetails.nurseName && selectedItemDetails.nurseName !== 'Unassigned') {
      return selectedItemDetails.nurseName;
    }

    if (selectedItemDetails.assignedNurse && typeof selectedItemDetails.assignedNurse === 'object') {
      const formattedName = getNurseName(selectedItemDetails.assignedNurse);
      if (formattedName && formattedName !== 'Unassigned') {
        return formattedName;
      }
      const fallbackId = selectedItemDetails.assignedNurse._id || selectedItemDetails.assignedNurse.id;
      const matchedNurse = findNurseById(fallbackId);
      if (matchedNurse) {
        const matchedName = getNurseName(matchedNurse);
        if (matchedName && matchedName !== 'Unassigned') {
          return matchedName;
        }
      }
    }

    if (typeof selectedItemDetails.assignedNurse === 'string') {
      return selectedItemDetails.assignedNurse;
    }

    if (selectedItemDetails.nurseId) {
      const matchedNurse = findNurseById(selectedItemDetails.nurseId);
      if (matchedNurse) {
        const formattedName = getNurseName(matchedNurse);
        if (formattedName && formattedName !== 'Unassigned') {
          return formattedName;
        }
      }
    }

    return null;
  }, [selectedItemDetails, nurses]);

  const selectedItemHasNurseAssignment = Boolean(
    selectedItemDisplayNurseName ||
    selectedItemDetails?.assignedNurse ||
    selectedItemDetails?.assignedAt ||
    selectedItemDetails?.nurseId
  );

  const patientBookingNotes = useMemo(() => {
    if (!selectedItemDetails) return '';

    const pickFirstNonEmptyText = (values) => {
      const found = (values || []).find((val) => {
        if (val === null || val === undefined) return false;
        const text = String(val).trim();
        return Boolean(text);
      });
      return found === null || found === undefined ? '' : String(found).trim();
    };

    const clientIdCandidate =
      selectedItemDetails.patientId ||
      selectedItemDetails.clientId ||
      selectedItemDetails.patient?.id ||
      selectedItemDetails.client?.id ||
      selectedItemDetails.patientUid ||
      selectedItemDetails.clientUid ||
      null;
    const matchedClient = (() => {
      if (!clientIdCandidate) return null;
      const key = String(clientIdCandidate).trim();
      if (!key || !(clientsById instanceof Map)) return null;
      return clientsById.get(key) || null;
    })();

    const patientBookingNotesText = pickFirstNonEmptyText([
      selectedItemDetails.patientNotes,
      selectedItemDetails.patientNote,
      selectedItemDetails.bookingNotes,
      selectedItemDetails.bookingNote,
      selectedItemDetails.clientNotes,
      selectedItemDetails.specialInstructions,
      selectedItemDetails.instructions,
      selectedItemDetails.patient?.notes,
      selectedItemDetails.patient?.patientNotes,
      selectedItemDetails.client?.notes,
      selectedItemDetails.client?.patientNotes,
      selectedItemDetails.clientSnapshot?.notes,
      selectedItemDetails.clientSnapshot?.patientNotes,
      selectedItemDetails.patientSnapshot?.notes,
      selectedItemDetails.patientSnapshot?.patientNotes,
      selectedItemDetails.clientData?.notes,
      selectedItemDetails.clientData?.patientNotes,
      selectedItemDetails.patientData?.notes,
      selectedItemDetails.patientData?.patientNotes,
      matchedClient?.notes,
      matchedClient?.patientNotes,
      matchedClient?.bookingNotes,
      matchedClient?.specialInstructions,
    ]);

    // Fallback: some payloads still store patient-entered notes in the generic `notes` field.
    // Prefer explicit patient note fields first, but don't hide `notes` just because nurseNotes exists.
    const legacyNotes = (selectedItemDetails.notes && String(selectedItemDetails.notes).trim()) || '';
    const nurseNotesText = (selectedItemDetails.nurseNotes && String(selectedItemDetails.nurseNotes).trim()) || '';
    const legacyLooksLikeNurseNotes =
      Boolean(legacyNotes && nurseNotesText) && legacyNotes === nurseNotesText;

    const finalPatientNotes = patientBookingNotesText || (legacyLooksLikeNurseNotes ? '' : legacyNotes);

    return finalPatientNotes;
  }, [selectedItemDetails, clientsById]);

  const hasPatientBookingNotes = Boolean(patientBookingNotes);

  useEffect(() => {
    if (!selectedItemDetails) return;
    console.log('[PatientNotes][source]', {
      appointmentId: selectedItemDetails.id,
      patientNotes: selectedItemDetails.patientNotes,
      bookingNotes: selectedItemDetails.bookingNotes,
      clientNotes: selectedItemDetails.clientNotes,
      specialInstructions: selectedItemDetails.specialInstructions,
      legacyNotes: selectedItemDetails.notes,
      computed: patientBookingNotes,
    });
  }, [selectedItemDetails?.id, patientBookingNotes]);

  const selectedItemPatientInfo = useMemo(() => {
    if (!selectedItemDetails) return null;

    const normalizeId = (value) => (value || value === 0 ? String(value).trim().toLowerCase() : null);
    const targetIds = [
      selectedItemDetails.patientId,
      selectedItemDetails.clientId,
      selectedItemDetails.patient?.id,
      selectedItemDetails.client?.id,
      selectedItemDetails.patient?._id,
      selectedItemDetails.client?._id,
    ]
      .map(normalizeId)
      .filter(Boolean);

    const matchedClientRecord = clientsList.find((client) => {
      const clientId = normalizeId(client.id);
      return clientId && targetIds.includes(clientId);
    }) || null;

    const normalizedNames = [
      selectedItemDetails.patientName,
      selectedItemDetails.clientName,
      selectedItemDetails.patient?.fullName,
      selectedItemDetails.client?.fullName,
      [selectedItemDetails.patientFirstName, selectedItemDetails.patientLastName].filter(Boolean).join(' ').trim(),
      selectedItemDetails.patient?.name,
      selectedItemDetails.client?.name,
    ]
      .map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : null))
      .filter(Boolean);

    const matchedClientByName = clientsList.find((client) => {
      const clientName = (client.fullName || client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim()).toLowerCase();
      return clientName && normalizedNames.includes(clientName);
    }) || null;

    const emailTargets = [
      selectedItemDetails.patientEmail,
      selectedItemDetails.clientEmail,
      selectedItemDetails.email,
      selectedItemDetails.patient?.email,
      selectedItemDetails.client?.email,
    ]
      .map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : null))
      .filter(Boolean);

    const matchedClientByEmail = clientsList.find((client) => {
      const clientEmail = (client.email || client.contactEmail || '').trim().toLowerCase();
      return clientEmail && emailTargets.includes(clientEmail);
    }) || null;

    const phoneTargets = [
      selectedItemDetails.patientPhone,
      selectedItemDetails.clientPhone,
      selectedItemDetails.phone,
      selectedItemDetails.patient?.phone,
      selectedItemDetails.client?.phone,
    ]
      .map((phone) => (typeof phone === 'string' ? phone.replace(/\D+/g, '') : null))
      .filter(Boolean);

    const matchedClientByPhone = clientsList.find((client) => {
      const clientPhone = (client.phone || client.contactNumber || '').replace(/\D+/g, '');
      return clientPhone && phoneTargets.includes(clientPhone);
    }) || null;

    const candidateProfiles = [
      selectedItemDetails.patient,
      selectedItemDetails.client,
      selectedItemDetails.clientProfile,
      selectedItemDetails.patientProfile,
      selectedItemDetails.clientInfo,
      selectedItemDetails.patientInfo,
      matchedClientRecord,
      matchedClientByName,
      matchedClientByEmail,
      matchedClientByPhone,
    ].filter(Boolean);

    const deriveNameFromCandidate = (candidate) => {
      if (!candidate) return null;
      if (candidate.fullName) return candidate.fullName;
      if (candidate.name) return candidate.name;
      const firstName = candidate.firstName || candidate.givenName || candidate.first;
      const lastName = candidate.lastName || candidate.surname || candidate.last;
      const composed = [firstName, lastName].filter(Boolean).join(' ').trim();
      return composed || null;
    };

    const deriveContactFromCandidate = (candidate, fieldNames) => {
      if (!candidate) return null;
      for (const key of fieldNames) {
        if (candidate[key]) {
          return candidate[key];
        }
      }
      return null;
    };

    const firstValid = (values) => {
      for (const value of values) {
        if (!value) continue;
        const normalized = typeof value === 'string' ? value.trim() : value;
        if (typeof normalized === 'string' && normalized) {
          return normalized;
        }
        if (normalized && typeof normalized === 'object') {
          return normalized;
        }
      }
      return null;
    };

    const resolvedName = firstValid([
      selectedItemDetails.patientName,
      selectedItemDetails.clientName,
      selectedItemDetails.fullName,
      selectedItemDetails.name,
      [selectedItemDetails.patientFirstName, selectedItemDetails.patientLastName].filter(Boolean).join(' ').trim() || null,
      ...candidateProfiles.map(deriveNameFromCandidate),
    ]);

    const resolvedEmail = firstValid([
      selectedItemDetails.patientEmail,
      selectedItemDetails.clientEmail,
      selectedItemDetails.contactEmail,
      ...candidateProfiles.map((candidate) =>
        deriveContactFromCandidate(candidate, ['email', 'contactEmail', 'primaryEmail'])
      ),
      selectedItemDetails.email,
    ]);

    const resolvedPhone = firstValid([
      selectedItemDetails.patientPhone,
      selectedItemDetails.clientPhone,
      selectedItemDetails.phone,
      selectedItemDetails.contactPhone,
      selectedItemDetails.phoneNumber,
      ...candidateProfiles.map((candidate) =>
        deriveContactFromCandidate(candidate, ['phone', 'phoneNumber', 'contactNumber', 'primaryPhone'])
      ),
    ]);

    const resolveAddressValue = () => {
      const formatAddressObject = (candidateAddress) => {
        if (!candidateAddress || typeof candidateAddress !== 'object') return null;
        const formatted = formatAddress(candidateAddress);
        if (formatted && typeof formatted === 'string') {
          return formatted;
        }
        const { street, city, parish, state, zip, country } = candidateAddress;
        const parts = [street, city, parish || state, zip, country].filter(Boolean);
        return parts.length ? parts.join(', ') : null;
      };

      const addressCandidates = [
        selectedItemDetails.patientAddress,
        selectedItemDetails.clientAddress,
        selectedItemDetails.address,
        selectedItemDetails.location?.address,
        selectedItemDetails.location,
        ...candidateProfiles.map((candidate) => candidate?.address || candidate?.location),
      ];

      for (const candidate of addressCandidates) {
        if (!candidate) continue;
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (trimmed) return trimmed;
        }
        const objectAddress = formatAddressObject(candidate);
        if (objectAddress) return objectAddress;
      }
      return null;
    };

    return {
      name: resolvedName || 'N/A',
      email: resolvedEmail || 'N/A',
      phone: resolvedPhone || 'N/A',
      address: resolveAddressValue() || 'N/A',
    };
  }, [selectedItemDetails, clientsList]);

  // Check for navigation params to open modal
  useEffect(() => {
    if (route.params?.openBookingModal) {
      setShiftBookingModal(true);
      // Clear the param so it doesn't reopen on re-render
      navigation.setParams({ openBookingModal: undefined, timestamp: undefined });
    }
  }, [route.params?.openBookingModal, route.params?.timestamp]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedStartDate, setSelectedStartDate] = useState(new Date());
  const [selectedEndDate, setSelectedEndDate] = useState(new Date());
  const [selectedStartTime, setSelectedStartTime] = useState(new Date());
  const [selectedEndTime, setSelectedEndTime] = useState(new Date());
  const [backupNurses, setBackupNurses] = useState([]);
  const [nurseSearch, setNurseSearch] = useState('');
  const [isNurseFocused, setIsNurseFocused] = useState(false);
  const [shiftDetails, setShiftDetails] = useState({
    date: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    service: '',
    notes: '',
    clientId: '',
    clientName: ''
  });
  const [showServiceSelector, setShowServiceSelector] = useState(false);
  
  // Client search state
  const [clientSearchText, setClientSearchText] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [isClientFocused, setIsClientFocused] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [filteredClients, setFilteredClients] = useState([]);

  // Backup Nurse state
  const [backupNurseSearch, setBackupNurseSearch] = useState('');
  const [showBackupNurseDropdown, setShowBackupNurseDropdown] = useState(false);
  const [filteredBackupNurses, setFilteredBackupNurses] = useState([]);
  const [backupPickerVisible, setBackupPickerVisible] = useState(false);
  const [backupCandidateDetailsVisible, setBackupCandidateDetailsVisible] = useState(false);
  const [selectedBackupCandidate, setSelectedBackupCandidate] = useState(null);
  const [pendingBackupCandidateDetails, setPendingBackupCandidateDetails] = useState(false);
  const [backupPickerDidDismiss, setBackupPickerDidDismiss] = useState(true);
  const [shiftBookingDidDismiss, setShiftBookingDidDismiss] = useState(true);
  const [closeShiftAfterBackupPickerDismiss, setCloseShiftAfterBackupPickerDismiss] = useState(false);
  const [selectedDays, setSelectedDays] = useState([]);

  // Open details only after picker + shift modals are fully closed.
  // This prevents the details modal from rendering behind the picker on iOS.
  useEffect(() => {
    if (!pendingBackupCandidateDetails) return;
    if (!selectedBackupCandidate) return;
    if (backupPickerVisible) return;
    if (shiftBookingModal) return;

    const isIOS = Platform.OS === 'ios';
    if (isIOS && (!backupPickerDidDismiss || !shiftBookingDidDismiss)) return;

    const t = setTimeout(() => {
      console.log('[Backup Details] Opening details modal after dismiss');
      setPendingBackupCandidateDetails(false);
      setBackupCandidateDetailsVisible(true);
    }, 120);

    return () => clearTimeout(t);
  }, [
    pendingBackupCandidateDetails,
    selectedBackupCandidate,
    backupPickerVisible,
    shiftBookingModal,
    backupPickerDidDismiss,
    shiftBookingDidDismiss,
  ]);

  useEffect(() => {
    if (backupPickerVisible) setBackupPickerDidDismiss(false);
  }, [backupPickerVisible]);

  useEffect(() => {
    if (shiftBookingModal) setShiftBookingDidDismiss(false);
  }, [shiftBookingModal]);

  const toggleDay = (dayValue) => {
    setSelectedDays(prev => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(dayValue)) {
        return list.filter(d => d !== dayValue);
      }
      return [...list, dayValue].sort((a, b) => a - b);
    });
  };
  
  // Check for approved shifts when component mounts and periodically
  useEffect(() => {
    const actualUserId = user?.id;
    const nurseId = actualUserId === 'nurse-001' ? 'NURSE001' : actualUserId;
    
    if (nurseId) {
      let lastApprovedCount = 0;
      
      const checkApprovedShifts = () => {
        const approvedShifts = getApprovedShiftsByNurse(nurseId);
        const currentCount = approvedShifts.length;
        
        // Only log when count changes or when shifts are found
        if (currentCount !== lastApprovedCount) {
          // Approved shifts check
          if (currentCount > lastApprovedCount && lastApprovedCount >= 0) {
            // New approved shifts detected
          }
          lastApprovedCount = currentCount;
        }
        
        setHasApprovedShift(currentCount > 0);
      };
      
      // Initial check
      checkApprovedShifts();
      
      // Poll for new approved shifts every 3 seconds for real-time updates
      const interval = setInterval(checkApprovedShifts, 3000);
      
      return () => clearInterval(interval);
    }
  }, [user?.id, getApprovedShiftsByNurse]);

  // Refresh data when screen comes into focus for immediate updates
  useFocusEffect(
    React.useCallback(() => {
      const actualUserId = user?.id;
      const nurseId = actualUserId === 'nurse-001' ? 'NURSE001' : actualUserId;
      
      if (nurseId) {
        // Force refresh of shift data from context
        const approvedShifts = getApprovedShiftsByNurse(nurseId);
        setHasApprovedShift(approvedShifts.length > 0);
        // Screen focused - refreshing shifts
        
        // Force a UI refresh
        setRefreshKey(prev => prev + 1);
      }
    }, [user?.id, getApprovedShiftsByNurse])
  );
  
  // Debug log to check nurse matching (only when issues occur)
  useEffect(() => {
    if (!currentNurse && user?.nurseCode) {
      // Nurse lookup issue
    }
  }, [user?.nurseCode, nurses?.length]);

  // Initialize toggle state from nurse data only once when nurse is found
  useEffect(() => {
    if (currentNurse && currentNurse.isActive !== undefined) {
      setIsAvailable(currentNurse.isActive);
    }
  }, [currentNurse?.id, currentNurse?.isActive]);

  // Use per-nurse storage keys so active/completed shift caches don't leak between accounts
  // when testing multiple nurses on the same device/simulator.
  const nurseStorageId = React.useMemo(() => {
    const candidate =
      currentNurse?.id ||
      currentNurse?._id ||
      currentNurse?.uid ||
      currentNurse?.nurseId ||
      currentNurse?.staffCode ||
      currentNurse?.nurseCode ||
      currentNurse?.code ||
      user?.id ||
      user?._id ||
      user?.uid ||
      user?.nurseId ||
      user?.staffCode ||
      user?.nurseCode ||
      user?.code ||
      user?.email ||
      user?.username;

    const normalized = String(candidate || 'unknown').trim();
    return normalized || 'unknown';
  }, [currentNurse, user]);

  const activeShiftsStorageKey = React.useMemo(
    () => `@nurse_active_shifts:${nurseStorageId}`,
    [nurseStorageId]
  );

  const completedShiftsStorageKey = React.useMemo(
    () => `@nurse_completed_shifts:${nurseStorageId}`,
    [nurseStorageId]
  );

  // Load active shifts from AsyncStorage (per-nurse)
  useEffect(() => {
    const loadActiveShifts = async () => {
      try {
        // Reset immediately so we don't show another nurse's cached shifts
        setActiveShifts([]);

        // Clear legacy unscoped key (previous behavior) to avoid confusion
        await AsyncStorage.removeItem('@nurse_active_shifts');

        const stored = await AsyncStorage.getItem(activeShiftsStorageKey);
        if (stored) {
          setActiveShifts(JSON.parse(stored));
          // Loaded active shifts from storage
        }
      } catch (error) {
        console.error('Error loading active shifts:', error);
      }
    };
    loadActiveShifts();
  }, [activeShiftsStorageKey]);

  // Persist active shifts to AsyncStorage whenever they change (per-nurse)
  useEffect(() => {
    const saveActiveShifts = async () => {
      try {
        if (activeShifts.length > 0) {
          await AsyncStorage.setItem(activeShiftsStorageKey, JSON.stringify(activeShifts));
          // Saved active shifts to storage
        } else {
          // Clear storage if no active shifts
          await AsyncStorage.removeItem(activeShiftsStorageKey);
        }
      } catch (error) {
        console.error('Error saving active shifts:', error);
      }
    };
    saveActiveShifts();
  }, [activeShifts, activeShiftsStorageKey]);

  // Load completed shifts from AsyncStorage (per-nurse)
  useEffect(() => {
    const loadCompletedShifts = async () => {
      try {
        setCompletedShifts([]);

        // Clear legacy unscoped key (previous behavior) to avoid confusion
        await AsyncStorage.removeItem('@nurse_completed_shifts');

        const stored = await AsyncStorage.getItem(completedShiftsStorageKey);
        if (stored) {
          setCompletedShifts(JSON.parse(stored));
          // Loaded completed shifts from storage
        }
      } catch (error) {
        console.error('Error loading completed shifts:', error);
      }
    };
    loadCompletedShifts();
  }, [completedShiftsStorageKey]);

  // Persist completed shifts to AsyncStorage whenever they change (per-nurse)
  useEffect(() => {
    const saveCompletedShifts = async () => {
      try {
        if (completedShifts.length > 0) {
          await AsyncStorage.setItem(completedShiftsStorageKey, JSON.stringify(completedShifts));
          // Saved completed shifts to storage
        } else {
          await AsyncStorage.removeItem(completedShiftsStorageKey);
        }
      } catch (error) {
        console.error('Error saving completed shifts:', error);
      }
    };
    saveCompletedShifts();
  }, [completedShifts, completedShiftsStorageKey]);

  // Clear all shift requests for clean testing environment (commented out to reduce log spam)
  /*
  useEffect(() => {
    const clearShifts = async () => {
      try {
        await clearAllShiftRequests();
        // Cleared all shift requests for clean testing
      } catch (error) {
        console.error('Error clearing shift requests:', error);
      }
    };
    clearShifts();
  }, []); // Empty dependency array = runs once on mount
  */

  // Handle navigation parameters from notifications
  useEffect(() => {
    if (route?.params?.initialTab) {
      setSelectedCard(route.params.initialTab);
      
      // Clear the params after handling
      navigation.setParams({ 
        initialTab: undefined, 
        highlightShift: undefined 
      });
    }
  }, [route?.params, navigation]);

  const myNurseIdentifiers = React.useMemo(() => {
    const candidates = [
      user?.uid,
      user?.id,
      currentNurse?.uid,
      currentNurse?.id,
      currentNurse?._id,
      currentNurse?.nurseId,
      currentNurse?.code,
      currentNurse?.nurseCode,
      currentNurse?.staffCode,
      currentNurse?.email,
      currentNurse?.contactEmail,
      user?.nurseId,
      user?.nurseCode,
      user?.staffCode,
      user?.code,
      user?.username,
      user?.email,
    ];

    const normalized = candidates
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value).trim())
      .filter(Boolean);

    return [...new Set(normalized)];
  }, [currentNurse, user]);

  const myNurseIdentifiersUpper = React.useMemo(
    () => new Set(myNurseIdentifiers.map((v) => v.toUpperCase())),
    [myNurseIdentifiers]
  );

  // Recursive function for matching nurse identifiers
  const matchesMine = React.useMemo(() => {
    const matcher = (value) => {
      if (!value) return false;

      // Arrays: match any element.
      if (Array.isArray(value)) {
        return value.some((entry) => matcher(entry));
      }

      // Objects: try common identifier fields.
      if (typeof value === 'object') {
        const candidates = [
          value.id,
          value._id,
          value.uid,
          value.nurseId,
          value.primaryNurseId,
          value.nurseCode,
          value.staffCode,
          value.code,
          value.username,
        ];
        return candidates.some((candidate) => matcher(candidate));
      }

      const normalized = String(value).trim();
      if (!normalized) return false;
      return myNurseIdentifiersUpper.has(normalized.toUpperCase());
    };
    return matcher;
  }, [myNurseIdentifiersUpper]);

  // Shared clock helper functions
  const getMyClockEntry = React.useCallback((clockByNurse) => {
    if (!clockByNurse || typeof clockByNurse !== 'object') return null;

    // 1. Try generic ID keys if clockByNurse is keyed by ID
    const entryValues = Object.values(clockByNurse).filter(val => val && typeof val === 'object');
    
    // 2. Look for an entry where nurseId/code matches mine
    for (const entry of entryValues) {
      if (!entry) continue;
      const entryId =
        entry.nurseId ||
        entry.id ||
        entry._id ||
        entry.uid ||
        entry.nurseCode ||
        entry.staffCode ||
        entry.code;
      if (entryId && matchesMine(entryId)) return entry;
    }
    return null;
  }, [matchesMine]);

  const hasActiveClockInByMe = React.useCallback((req) => {
    const entry = getMyClockEntry(req?.clockByNurse);
    if (!entry || typeof entry !== 'object') return false;

    const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
    if (!inTime) return false;
    const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
    if (!outTime) return true;

    const inMs = Date.parse(inTime);
    const outMs = Date.parse(outTime);
    if (!Number.isFinite(inMs)) return false;
    if (!Number.isFinite(outMs)) return true;
    return outMs < inMs;
  }, [getMyClockEntry]);

  const getMyResponseStatusForShiftRequest = React.useCallback(
    (req) => {
      const responses = req?.nurseResponses;
      if (!responses || typeof responses !== 'object') return null;

      // 1) Direct key match using any of my known identifiers
      for (const candidate of myNurseIdentifiers) {
        const status = responses?.[candidate]?.status;
        if (status) return status;
      }

      // 2) Case-insensitive key match
      for (const [key, value] of Object.entries(responses)) {
        if (!key) continue;
        if (myNurseIdentifiersUpper.has(String(key).toUpperCase())) {
          return value?.status || null;
        }
      }

      // 3) Split-schedule mapping: if assignedNurses has an object linking my uid->staffCode,
      //    use that staffCode to read nurseResponses.
      const assigned = Array.isArray(req?.assignedNurses) ? req.assignedNurses : [];
      for (const entry of assigned) {
        if (!entry || typeof entry !== 'object') continue;
        const entryId = entry.nurseId || entry._id || entry.id;
        if (!matchesMine(entryId)) continue;
        const entryCode = entry.staffCode || entry.nurseCode || entry.code;
        if (!entryCode) continue;
        const codeTrimmed = String(entryCode).trim();
        if (!codeTrimmed) continue;

        const directStatus = responses?.[codeTrimmed]?.status;
        if (directStatus) return directStatus;

        for (const [key, value] of Object.entries(responses)) {
          if (!key) continue;
          if (String(key).toUpperCase() === codeTrimmed.toUpperCase()) {
            return value?.status || null;
          }
        }
      }

      // 4) Check coverage requests (Backup Nurse Logic)
      const coverageRequests = Array.isArray(req?.coverageRequests) ? req.coverageRequests : [];
      // Check for accepted coverage requests where I am the one who accepted
      const acceptedCoverage = coverageRequests.find(cr => 
        String(cr?.status || '').toLowerCase() === 'accepted' && 
        (matchesMine(cr.acceptedBy) || matchesMine(cr.acceptedByStaffCode))
      );
      if (acceptedCoverage) return 'accepted';

      // Check for pending/declined coverage requests explicitly targeted at me
      const myTargetedCoverage = coverageRequests.find(cr => 
        (matchesMine(cr.targetBackupNurseId) || matchesMine(cr.targetBackupNurseStaffCode)) ||
        (Array.isArray(cr.backupNursesNotified) && cr.backupNursesNotified.some(n => matchesMine(n)))
      );
      if (myTargetedCoverage && myTargetedCoverage.status) {
         // Return declared status (e.g. 'declined') if found
         return String(myTargetedCoverage.status).toLowerCase();
      }

      return null;
    },
    [matchesMine, myNurseIdentifiers, myNurseIdentifiersUpper]
  );

  // Fetch pending recurring shifts from shift requests (admin-created)
  useEffect(() => {
    const filterRecurringFromShifts = async () => {
      try {
        const DEBUG_RECURRING = false;

        // Recurring shifts are fetched from the regular shift requests endpoint
        // They're flagged with adminRecurring: true
        if (shiftRequests && Array.isArray(shiftRequests)) {

          const listIncludesMine = (list) => {
            if (!Array.isArray(list) || list.length === 0) return false;
            return list.some((entry) => {
              if (!entry) return false;
              if (typeof entry === 'string') return matchesMine(entry);
              const entryId = entry.nurseId || entry._id || entry.id;
              const entryCode = entry.staffCode || entry.nurseCode || entry.code || entry.username;
              return matchesMine(entryId) || matchesMine(entryCode);
            });
          };

          const scheduleIncludesMine = (schedule) => {
            if (!schedule || typeof schedule !== 'object') return false;
            try {
              return Object.values(schedule).some((assigned) => matchesMine(assigned));
            } catch (e) {
              return false;
            }
          };

          const recurringShifts = shiftRequests.filter((req) => {
            if (!req) return false;

            const isAdminRecurring =
              req.adminRecurring === true ||
              String(req.adminRecurring).trim().toLowerCase() === 'true';
            
            const isPatientRecurring = 
              req.isRecurring === true || 
              String(req.isRecurring).trim().toLowerCase() === 'true' ||
              (req.recurringSchedule && typeof req.recurringSchedule === 'object');
            const isAnyRecurring = isAdminRecurring || isPatientRecurring;

            // Only recurring requests belong in this list.
            if (!isAnyRecurring) return false;

            const statusNormalized = String(req.status || '').trim().toLowerCase();

            const hasPendingCoverageRequestForMe = (() => {
              const list = Array.isArray(req?.coverageRequests) ? req.coverageRequests : [];
              if (list.length === 0) return false;
              return list.some((cr) => {
                if (!cr) return false;
                const crStatus = String(cr.status || '').trim().toLowerCase();
                if (crStatus !== 'pending') return false;
                const targets = [
                  cr.targetBackupNurseId,
                  cr.targetBackupNurseStaffCode,
                  ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                ].filter(Boolean);
                return targets.some((t) => matchesMine(t));
              });
            })();

            const isBackupForThisRequest =
              hasPendingCoverageRequestForMe ||
              listIncludesMine(req.backupNursesNotified);

            // Backup nurses may need to respond even after the request is approved.
            const isEligibleStatusForPending =
              statusNormalized === 'pending'
              || statusNormalized === 'assigned'
              || statusNormalized === 'active'
              || (statusNormalized === 'approved' && hasPendingCoverageRequestForMe);

            const belongsToMeAsPrimary =
              matchesMine(req.nurseId) ||
              matchesMine(req.nurseUid) ||
              matchesMine(req.primaryNurseId) ||
              matchesMine(req.nurseCode) ||
              matchesMine(req.staffCode) ||
              matchesMine(req.assignedNurseId) ||
              matchesMine(req.assignedNurse) ||
              matchesMine(req.nurseEmail) ||
              matchesMine(req.nursePhone) ||
              matchesMine(req?.nurse?.nurseCode) ||
              matchesMine(req?.nurse?.code) ||
              matchesMine(req?.nurse?.staffCode) ||
              matchesMine(req?.nurse?.id) ||
              matchesMine(req?.nurse?._id) ||
              matchesMine(req?.nurse?.uid) ||
              listIncludesMine(req.assignedNurses) ||
              scheduleIncludesMine(req.nurseSchedule) ||
              listIncludesMine(Object.keys(req?.nurseResponses || {}));

            // Backup nurses should only see a recurring shift request when there is an explicit
            // pending coverage request targeting them (approve/deny).
            const belongsToMeAsBackup = hasPendingCoverageRequestForMe;

            const belongsToMe = belongsToMeAsPrimary || belongsToMeAsBackup;

            if (!belongsToMe) {
              return false;
            }

            const myResponseStatus = getMyResponseStatusForShiftRequest(req);
            const isStillPendingForMe = !myResponseStatus || myResponseStatus === 'pending' || (myResponseStatus !== 'accepted' && myResponseStatus !== 'declined');

            // For backup coverage requests, nurseResponses may be empty; use coverageRequests instead.
            // IMPORTANT: If I'm not the primary assigned nurse, do not surface this request unless
            // there's a pending coverage request explicitly targeting me.
            const needsActionForMe = hasPendingCoverageRequestForMe || (belongsToMeAsPrimary && isStillPendingForMe);

            // Admin often sets recurring requests to "approved" when assigning a nurse.
            // For the nurse UI, keep it under Pending until THIS nurse accepts/declines.
            if (statusNormalized === 'approved') {
              if (hasPendingCoverageRequestForMe) return true;
              
              // For nurse-created recurring shifts (isRecurring=true, adminRecurring=false),
              // once admin approves, it should go to Booked (not Pending) since the nurse already "accepted" by creating it
              const isNurseCreated = isPatientRecurring && !isAdminRecurring;
              if (isNurseCreated) return false;
              
              return isStillPendingForMe;
            }

            return isEligibleStatusForPending && needsActionForMe;
          });
          
          // ALSO check the appointments array for patient-created recurring requests
          // that have been assigned to this nurse but not yet accepted.
          // Patient-created recurring requests are stored in appointments collection
          // (they have requestedBy field), not in shiftRequests.
          const recurringAppointments = (Array.isArray(appointments) ? appointments : []).filter((apt) => {
            if (!apt) return false;
            
            // Must be a recurring appointment
            const isRecurring = apt.isRecurring === true || 
              String(apt.isRecurring).trim().toLowerCase() === 'true' ||
              (apt.recurringSchedule && typeof apt.recurringSchedule === 'object') ||
              apt.daysOfWeek || apt.selectedDays;
            if (!isRecurring) return false;
            
            // Must be assigned/approved status (admin assigned a nurse)
            const statusNorm = String(apt.status || '').trim().toLowerCase();
            const isEligibleStatus = statusNorm === 'assigned' || statusNorm === 'approved' || statusNorm === 'pending';
            if (!isEligibleStatus) return false;
            
            // Must belong to this nurse
            const belongsToMe = 
              matchesMine(apt.nurseId) ||
              matchesMine(apt.assignedNurseId) ||
              matchesMine(apt.assignedNurse) ||
              matchesMine(apt.nurseCode) ||
              matchesMine(apt.staffCode) ||
              listIncludesMine(apt.assignedNurses);
            if (!belongsToMe) return false;
            
            // If appointment status is 'assigned', nurse always needs to respond
            // (this is the status set when admin assigns a nurse to patient request)
            if (statusNorm === 'assigned') return true;
            
            // For 'approved' status, exclude nurse-created recurring shifts
            // (they're auto-accepted and should only appear in Booked)
            if (statusNorm === 'approved') {
              const isNurseCreated = apt.isRecurring && !apt.adminRecurring;
              if (isNurseCreated) return false;
            }
            
            // For 'approved' or 'pending' status, check if nurse still needs to respond
            const myResponseStatus = getMyResponseStatusForShiftRequest(apt);
            const needsResponse = myResponseStatus !== 'accepted' && myResponseStatus !== 'declined';
            
            return needsResponse;
          });
          
          // Combine recurring shifts and recurring appointments, deduplicate by ID
          const allRecurring = [...recurringShifts, ...recurringAppointments];
          const seen = new Set();
          const dedupedRecurring = allRecurring.filter((item, idx) => {
            const id =
              item?.id ||
              item?._id ||
              item?.shiftRequestId ||
              item?.requestId ||
              item?.appointmentId ||
              `no-id-${idx}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          
          setPendingRecurringShifts(dedupedRecurring);
        } else {
          // Still check appointments even if no shift requests
          const recurringAppointments = (Array.isArray(appointments) ? appointments : []).filter((apt) => {
            if (!apt) return false;
            const isRecurring = apt.isRecurring === true || 
              String(apt.isRecurring).trim().toLowerCase() === 'true' ||
              (apt.recurringSchedule && typeof apt.recurringSchedule === 'object') ||
              apt.daysOfWeek || apt.selectedDays;
            if (!isRecurring) return false;
            const statusNorm = String(apt.status || '').trim().toLowerCase();
            const isEligibleStatus = statusNorm === 'assigned' || statusNorm === 'approved' || statusNorm === 'pending';
            if (!isEligibleStatus) return false;
            const belongsToMe = 
              matchesMine(apt.nurseId) ||
              matchesMine(apt.assignedNurseId) ||
              matchesMine(apt.assignedNurse) ||
              matchesMine(apt.nurseCode) ||
              matchesMine(apt.staffCode);
            if (!belongsToMe) return false;
            
            // If appointment status is 'assigned', nurse always needs to respond
            if (statusNorm === 'assigned') return true;
            
            // For 'approved' status, exclude nurse-created recurring shifts
            // (they're auto-accepted and should only appear in Booked)
            if (statusNorm === 'approved') {
              const isNurseCreated = apt.isRecurring && !apt.adminRecurring;
              if (isNurseCreated) return false;
            }
            
            const myResponseStatus = getMyResponseStatusForShiftRequest(apt);
            return myResponseStatus !== 'accepted' && myResponseStatus !== 'declined';
          });
          setPendingRecurringShifts(recurringAppointments);
        }
      } catch (error) {
        console.error('Failed to filter recurring shifts:', error);
        setPendingRecurringShifts([]);
      }
    };

    filterRecurringFromShifts();
  }, [shiftRequests, appointments, matchesMine, getMyResponseStatusForShiftRequest, myNurseIdentifiers]);

  const acceptedRecurringShifts = React.useMemo(() => {
    if (!Array.isArray(shiftRequests) || shiftRequests.length === 0) return [];

    const listIncludesMine = (list) => {
      if (!Array.isArray(list) || list.length === 0) return false;
      return list.some((entry) => {
        if (!entry) return false;
        if (typeof entry === 'string') return matchesMine(entry);
        const entryId = entry.nurseId || entry._id || entry.id;
        const entryCode = entry.nurseCode || entry.code;
        return matchesMine(entryId) || matchesMine(entryCode);
      });
    };

    const scheduleIncludesMine = (schedule) => {
      if (!schedule || typeof schedule !== 'object') return false;
      try {
        return Object.values(schedule).some((assigned) => matchesMine(assigned));
      } catch (e) {
        return false;
      }
    };

    const getMyClockEntry = (clockByNurse) => {
      if (!clockByNurse || typeof clockByNurse !== 'object') return null;

      for (const [key, entry] of Object.entries(clockByNurse)) {
        if (matchesMine(key)) return entry || null;
        if (entry && typeof entry === 'object') {
          const entryId =
            entry.nurseId ||
            entry.id ||
            entry._id ||
            entry.uid ||
            entry.nurseCode ||
            entry.staffCode ||
            entry.code;
          if (entryId && matchesMine(entryId)) return entry;
        }
      }
      return null;
    };

    const hasActiveClockInByMe = (req) => {
      const entry = getMyClockEntry(req?.clockByNurse);
      if (!entry || typeof entry !== 'object') return false;

      const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
      if (!inTime) return false;
      const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
      if (!outTime) return true;

      const inMs = Date.parse(inTime);
      const outMs = Date.parse(outTime);
      if (!Number.isFinite(inMs)) return false;
      if (!Number.isFinite(outMs)) return true;
      return outMs < inMs;
    };

    const hasClockedOutByMe = (req) => {
      const entry = getMyClockEntry(req?.clockByNurse);
      if (!entry || typeof entry !== 'object') return false;

      const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
      const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
      
      if (!inTime || !outTime) return false;

      const inMs = Date.parse(inTime);
      const outMs = Date.parse(outTime);
      if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return false;
      
      // Clocked out if outTime is after inTime
      return outMs > inMs;
    };

    const hasAnyClockOut = (req) => {
      const clockByNurse = req?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return false;
      return Object.values(clockByNurse).some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return Boolean(
          entry.lastClockOutTime ||
            entry.actualEndTime ||
            entry.clockOutTime ||
            entry.completedAt
        );
      });
    };

    return shiftRequests
      .filter((req) => {
        if (!req) return false;

        const isAdminRecurring =
          req.adminRecurring === true ||
          String(req.adminRecurring).trim().toLowerCase() === 'true';
        const isPatientRecurring =
          req.isRecurring === true ||
          String(req.isRecurring).trim().toLowerCase() === 'true' ||
          (req.recurringSchedule && typeof req.recurringSchedule === 'object');
        const isAnyRecurring = isAdminRecurring || isPatientRecurring;
        if (!isAnyRecurring) return false;

        const belongsToMe =
          matchesMine(req.nurseId) ||
          matchesMine(req.primaryNurseId) ||
          matchesMine(req.nurseCode) ||
          listIncludesMine(req.assignedNurses) ||
          scheduleIncludesMine(req.nurseSchedule) ||
          listIncludesMine(req.backupNurses);

        if (!belongsToMe) return false;
        
        const statusNormalized = String(req.status || '').trim().toLowerCase();
        
        // For nurse-created recurring shifts that admin approved, treat as automatically accepted
        // since the nurse was the one who requested it
        const isNurseCreated = isPatientRecurring && !isAdminRecurring;
        const isApproved = statusNormalized === 'approved';
        const isAutoAccepted = isNurseCreated && isApproved;
        
        // Check if nurse explicitly accepted, OR if it's auto-accepted
        const myResponse = getMyResponseStatusForShiftRequest(req);
        if (myResponse !== 'accepted' && !isAutoAccepted) return false;

        // Exclude completed shifts
        if (statusNormalized === 'completed') return false;

        // Check if the recurring period has ended - if so, exclude from Booked
        const parseDateOnlyLocal = (val) => {
          if (!val) return null;
          if (val instanceof Date && Number.isFinite(val.getTime())) return val;
          const raw = String(val).trim();
          if (!raw) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const d = new Date(`${raw}T00:00:00`);
            return Number.isFinite(d.getTime()) ? d : null;
          }
          const d = new Date(raw);
          return Number.isFinite(d.getTime()) ? d : null;
        };

        const periodEnd = parseDateOnlyLocal(
          req?.recurringPeriodEnd ||
          req?.endDate ||
          req?.recurringEndDate ||
          req?.appointmentEndDate ||
          null
        );

        // Check if nurse has clocked out
        const hasClockOut = hasClockedOutByMe(req) || hasAnyClockOut(req);
        
        // If the period has fully ended OR if on the last day and nurse has clocked out, exclude from Booked
        if (periodEnd) {
          const now = new Date();
          const endOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999);
          const startOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 0, 0, 0, 0);
          const periodFullyEnded = now > endOfLastDay;
          const isLastDay = now >= startOfLastDay && now <= endOfLastDay;
          
          // If period ended OR on last day with clock-out, it belongs in Completed, not Booked
          if ((periodFullyEnded || (isLastDay && hasClockOut))) {
            return false;
          }
        }

        // Recurring schedules can have clock-out history per occurrence.
        // Do not exclude the whole series from Booked just because a clock-out exists.

        // Split schedules can be marked globally as "active" when ONE nurse clocks in.
        // For Booked, only exclude it when *I* clocked in (it belongs in Active for me).
        const hasClockIn = Boolean(req?.actualStartTime || req?.startedAt || req?.clockInLocation);
        
        // Handle startedBy being an object or string
        const startedByVal = req?.startedBy;
        const startedById = (typeof startedByVal === 'object' && startedByVal !== null) 
          ? (startedByVal.id || startedByVal._id || startedByVal.uid) 
          : startedByVal;
        
        // Only treat "startedByMe" as true if startedBy matches me, or I have an active clock-in record.
        const startedByMe = startedById ? matchesMine(startedById) : (hasClockIn ? hasActiveClockInByMe(req) : false);

        const isSplitSchedule = Boolean(req?.nurseSchedule && typeof req.nurseSchedule === 'object');

        // Non-split schedules: once active, it should not appear in Booked *for the nurse who started*.
        // If a backup nurse started the shift, keep it in Booked for the original assigned nurse (clock-in is disabled there).
        if (!isSplitSchedule && statusNormalized === 'active' && startedByMe) return false;
        
        // If I started this shift, it belongs in Active, not Booked
        if (hasClockIn && startedByMe) return false;

        return true;
      })
      .map((req) => {
        const isSplitSchedule = Boolean(req?.nurseSchedule && typeof req.nurseSchedule === 'object');
        const hasClockIn = Boolean(req?.actualStartTime || req?.startedAt || req?.clockInLocation);
        
        // Handle startedBy being an object or string
        const startedByVal = req?.startedBy;
        const startedById = (typeof startedByVal === 'object' && startedByVal !== null) 
          ? (startedByVal.id || startedByVal._id || startedByVal.uid) 
          : startedByVal;
        
        const startedByMe = startedById ? matchesMine(startedById) : (hasClockIn ? hasActiveClockInByMe(req) : false);
        const authorizedStart = startedByMe;

        // If someone else clocked in (split schedule OR backup coverage), hide clock-in fields
        // so Booked doesn't appear "clocked in" for me.
        if (hasClockIn && !authorizedStart) {
          const {
            actualStartTime,
            startedAt,
            clockInLocation,
            clockInCapturedAt,
            ...rest
          } = req;

          return {
            ...rest,
            status: 'approved',
          };
        }

        return {
          ...req,
          status: 'approved',
        };
      });
  }, [shiftRequests, matchesMine, getMyResponseStatusForShiftRequest]);

  const activeRecurringShifts = React.useMemo(() => {
    if (!Array.isArray(shiftRequests) || shiftRequests.length === 0) return [];

    const listIncludesMine = (list) => {
      if (!Array.isArray(list) || list.length === 0) return false;
      return list.some((entry) => {
        if (!entry) return false;
        if (typeof entry === 'string') return matchesMine(entry);
        const entryId = entry.nurseId || entry._id || entry.id;
        const entryCode = entry.nurseCode || entry.code;
        return matchesMine(entryId) || matchesMine(entryCode);
      });
    };

    const scheduleIncludesMine = (schedule) => {
      if (!schedule || typeof schedule !== 'object') return false;
      try {
        return Object.values(schedule).some((assigned) => matchesMine(assigned));
      } catch (e) {
        return false;
      }
    };

    const getMyClockEntry = (clockByNurse) => {
      if (!clockByNurse || typeof clockByNurse !== 'object') return null;

      for (const [key, entry] of Object.entries(clockByNurse)) {
        if (matchesMine(key)) return entry || null;
        if (entry && typeof entry === 'object') {
          const entryId =
            entry.nurseId ||
            entry.id ||
            entry._id ||
            entry.uid ||
            entry.nurseCode ||
            entry.staffCode ||
            entry.code;
          if (entryId && matchesMine(entryId)) return entry;
        }
      }
      return null;
    };

    const hasActiveClockInByMe = (req) => {
      const entry = getMyClockEntry(req?.clockByNurse);
      if (!entry || typeof entry !== 'object') return false;

      const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
      if (!inTime) return false;
      const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
      if (!outTime) return true;

      const inMs = Date.parse(inTime);
      const outMs = Date.parse(outTime);
      if (!Number.isFinite(inMs)) return false;
      if (!Number.isFinite(outMs)) return true;
      return outMs < inMs;
    };

    return shiftRequests
      .filter((req) => {
        if (!req) return false;

        const isAdminRecurring =
          req.adminRecurring === true ||
          String(req.adminRecurring).trim().toLowerCase() === 'true';
        const isPatientRecurring =
          req.isRecurring === true ||
          String(req.isRecurring).trim().toLowerCase() === 'true' ||
          (req.recurringSchedule && typeof req.recurringSchedule === 'object');
        const isAnyRecurring = isAdminRecurring || isPatientRecurring;
        if (!isAnyRecurring) return false;

        const belongsToMe =
          matchesMine(req.nurseId) ||
          matchesMine(req.primaryNurseId) ||
          matchesMine(req.nurseCode) ||
          listIncludesMine(req.assignedNurses) ||
          scheduleIncludesMine(req.nurseSchedule) ||
          listIncludesMine(req.backupNurses);

        if (!belongsToMe) return false;
        
        const statusNormalized = String(req.status || '').trim().toLowerCase();
        
        // For nurse-created recurring shifts that admin approved, treat as automatically accepted
        // since the nurse was the one who requested it
        const isNurseCreated = isPatientRecurring && !isAdminRecurring;
        const isApproved = statusNormalized === 'approved' || statusNormalized === 'active';
        const isAutoAccepted = isNurseCreated && isApproved;
        
        // Check if nurse explicitly accepted, OR if it's auto-accepted
        const myResponse = getMyResponseStatusForShiftRequest(req);
        if (myResponse !== 'accepted' && !isAutoAccepted) return false;

        if (statusNormalized === 'completed') return false;

        const isSplitSchedule = Boolean(req?.nurseSchedule && typeof req.nurseSchedule === 'object' && Object.keys(req.nurseSchedule).length > 0);
        const hasClockIn = Boolean(req?.actualStartTime || req?.startedAt || req?.clockInLocation);
        
        // For split schedules, check if I specifically have an active clock-in
        const iHaveClockedIn = hasActiveClockInByMe(req);
        
        // Handle startedBy being an object or string
        const startedByVal = req?.startedBy;
        const startedById = (typeof startedByVal === 'object' && startedByVal !== null) 
          ? (startedByVal.id || startedByVal._id || startedByVal.uid) 
          : startedByVal;
        
        const startedByMe = startedById ? matchesMine(startedById) : (hasClockIn ? iHaveClockedIn : false);
        
        // Only show this shift in Active if I actually clocked in
        if (isSplitSchedule) {
          // For split schedules, only show if I have an active clock-in entry
          if (!iHaveClockedIn) return false;
        } else {
          // For non-split schedules, only show if I'm the one who started it
          if (hasClockIn && !startedByMe) return false;
        }

        // Some recurring requests can have clock-in data while status lags behind.
        if (statusNormalized !== 'active' && !hasClockIn) return false;

        // Check if recurring period has ended - if so exclude from Active
        const parseDateOnlyLocal = (val) => {
          if (!val) return null;
          if (val instanceof Date && Number.isFinite(val.getTime())) return val;
          const raw = String(val).trim();
          if (!raw) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const d = new Date(`${raw}T00:00:00`);
            return Number.isFinite(d.getTime()) ? d : null;
          }
          const d = new Date(raw);
          return Number.isFinite(d.getTime()) ? d : null;
        };

        const periodEnd = parseDateOnlyLocal(
          req?.recurringPeriodEnd ||
          req?.endDate ||
          req?.recurringEndDate ||
          req?.appointmentEndDate ||
          null
        );

        // If period has ended and nurse clocked out, exclude from Active (should be in Completed)
        if (periodEnd) {
          const now = new Date();
          const endOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999);
          const periodFullyEnded = now > endOfLastDay;
          
          // If nurse clocked in and period ended, check if they also clocked out
          if (periodFullyEnded && !iHaveClockedIn) {
            return false; // Exclude from Active if no active clock-in
          }
        }

        // DEV: Debug filter decision for test shift
        if (__DEV__ && (req?.id || req?._id) === 'IFUO3HmNuZ5sO74KFQGb') {
          const myEntry = getMyClockEntry(req?.clockByNurse);
          console.log('[Active Recurring Filter][DEBUG]', {
            shiftId: req?.id || req?._id,
            status: req?.status,
            isSplitSchedule,
            hasClockIn,
            iHaveClockedIn,
            startedById,
            startedByMe,
            myClockEntry: myEntry ? {
              lastClockInTime: myEntry.lastClockInTime || null,
              lastClockOutTime: myEntry.lastClockOutTime || null,
              clockEntriesCount: Array.isArray(myEntry.clockEntries) ? myEntry.clockEntries.length : 0,
            } : null,
            willIncludeInActive: true,
          });
        }

        return true;
      })
      .map((req) => ({
        ...req,
        status: 'active',
      }));
  }, [shiftRequests, matchesMine, getMyResponseStatusForShiftRequest]);

  const completedRecurringShifts = React.useMemo(() => {
    if (!Array.isArray(shiftRequests) || shiftRequests.length === 0) return [];

    const listIncludesMine = (list) => {
      if (!Array.isArray(list) || list.length === 0) return false;
      return list.some((entry) => {
        if (!entry) return false;
        if (typeof entry === 'string') return matchesMine(entry);
        const entryId = entry.nurseId || entry._id || entry.id;
        const entryCode = entry.nurseCode || entry.code;
        return matchesMine(entryId) || matchesMine(entryCode);
      });
    };

    const scheduleIncludesMine = (schedule) => {
      if (!schedule || typeof schedule !== 'object') return false;
      try {
        return Object.values(schedule).some((assigned) => matchesMine(assigned));
      } catch (e) {
        return false;
      }
    };

    const getMyClockEntry = (clockByNurse) => {
      if (!clockByNurse || typeof clockByNurse !== 'object') return null;

      for (const [key, entry] of Object.entries(clockByNurse)) {
        if (matchesMine(key)) return entry || null;
        if (entry && typeof entry === 'object') {
          const entryId =
            entry.nurseId ||
            entry.id ||
            entry._id ||
            entry.uid ||
            entry.nurseCode ||
            entry.staffCode ||
            entry.code;
          if (entryId && matchesMine(entryId)) return entry;
        }
      }
      return null;
    };

    const hasClockedOutByMe = (req) => {
      const entry = getMyClockEntry(req?.clockByNurse);
      if (!entry || typeof entry !== 'object') return false;

      const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
      const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
      
      if (!inTime || !outTime) return false;

      const inMs = Date.parse(inTime);
      const outMs = Date.parse(outTime);
      if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return false;
      
      // Clocked out if outTime is after inTime
      return outMs > inMs;
    };

    const hasAnyClockOut = (req) => {
      const clockByNurse = req?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return false;
      return Object.values(clockByNurse).some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return Boolean(
          entry.lastClockOutTime ||
            entry.actualEndTime ||
            entry.clockOutTime ||
            entry.completedAt
        );
      });
    };

    const hasActiveClockInByMe = (req) => {
      const entry = getMyClockEntry(req?.clockByNurse);
      if (!entry || typeof entry !== 'object') return false;

      const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
      const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;

      if (!inTime) return false;
      if (!outTime) return true;

      const inMs = Date.parse(inTime);
      const outMs = Date.parse(outTime);
      if (!Number.isFinite(inMs)) return false;
      if (!Number.isFinite(outMs)) return true;

      return inMs > outMs;
    };

    return shiftRequests
      .filter((req) => {
        if (!req) return false;

        const isAdminRecurring =
          req.adminRecurring === true ||
          String(req.adminRecurring).trim().toLowerCase() === 'true';
        const isPatientRecurring =
          req.isRecurring === true ||
          String(req.isRecurring).trim().toLowerCase() === 'true' ||
          (req.recurringSchedule && typeof req.recurringSchedule === 'object');
        const isAnyRecurring = isAdminRecurring || isPatientRecurring;
        if (!isAnyRecurring) return false;

        const belongsToMe =
          matchesMine(req.nurseId) ||
          matchesMine(req.primaryNurseId) ||
          matchesMine(req.nurseCode) ||
          listIncludesMine(req.assignedNurses) ||
          scheduleIncludesMine(req.nurseSchedule) ||
          listIncludesMine(req.backupNurses);

        if (!belongsToMe) return false;
        
        const statusNormalized = String(req.status || '').trim().toLowerCase();
        
        // For nurse-created recurring shifts that admin approved, treat as automatically accepted
        // since the nurse was the one who requested it
        const isNurseCreated = isPatientRecurring && !isAdminRecurring;
        const isApproved = statusNormalized === 'approved' || statusNormalized === 'active' || statusNormalized === 'completed';
        const isAutoAccepted = isNurseCreated && isApproved;
        
        // Check if nurse explicitly accepted, OR if it's auto-accepted
        const myResponse = getMyResponseStatusForShiftRequest(req);
        if (myResponse !== 'accepted' && !isAutoAccepted) return false;
        
        // A recurring series should only be considered completed when the series is actually finished.
        // (Clock-out can happen on each occurrence and should not move the whole series to Completed.)
        if (statusNormalized === 'completed') return true;
        if (req?.finalCompletedAt) return true;

        const parseDateOnlyLocal = (val) => {
          if (!val) return null;
          if (val instanceof Date && Number.isFinite(val.getTime())) return val;
          const raw = String(val).trim();
          if (!raw) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const d = new Date(`${raw}T00:00:00`);
            return Number.isFinite(d.getTime()) ? d : null;
          }
          const d = new Date(raw);
          return Number.isFinite(d.getTime()) ? d : null;
        };

        const periodEnd = parseDateOnlyLocal(
          req?.recurringPeriodEnd ||
          req?.endDate ||
          req?.recurringEndDate ||
          req?.appointmentEndDate ||
          null
        );

        // If the period ended in the past and we have any clock-out history, treat it as completed for UI.
        if (periodEnd) {
          const now = new Date();
            const endOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999);
            const startOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 0, 0, 0, 0);
            const hasClockOut = hasClockedOutByMe(req) || hasAnyClockOut(req);
            const periodFullyEnded = now > endOfLastDay;
            const isLastDay = now >= startOfLastDay && now <= endOfLastDay;
            
            // DEV: Debug completed check for test shift
            if (__DEV__ && (req?.id || req?._id) === 'IFUO3HmNuZ5sO74KFQGb') {
              const myEntry = getMyClockEntry(req?.clockByNurse);
              console.log('[Completed Recurring Filter][DEBUG]', {
                shiftId: req?.id || req?._id,
                status: req?.status,
                periodEnd: periodEnd ? periodEnd.toISOString() : null,
                endOfLastDay: endOfLastDay.toISOString(),
                now: now.toISOString(),
                periodFullyEnded,
                hasClockOut,
                hasClockedOutByMe: hasClockedOutByMe(req),
                hasAnyClockOut: hasAnyClockOut(req),
                myClockEntry: myEntry ? {
                  lastClockInTime: myEntry.lastClockInTime || null,
                  lastClockOutTime: myEntry.lastClockOutTime || null,
                  clockEntriesCount: Array.isArray(myEntry.clockEntries) ? myEntry.clockEntries.length : 0,
                  allSessions: myEntry.clockEntries || [],
                } : null,
                willIncludeInCompleted: (periodFullyEnded || (isLastDay && hasClockOut)),
              });
            }
            
            // Mark as completed if period ended OR on last day with clock-out
            if (periodFullyEnded || (isLastDay && hasClockOut)) return true;
          }

          return false;
        })
      .map((req) => ({
        ...req,
        status: 'completed',
      }));
  }, [shiftRequests, matchesMine, getMyResponseStatusForShiftRequest]);
  
  // Get appointments for this nurse - use useMemo to ensure immediate updates
  const nurseAppointments = React.useMemo(() => {
    // Only fetch appointments if we have a valid user/nurse ID
    const targetNurseId = currentNurse?.id || user?.id;
    if (!targetNurseId) {
      return [];
    }

    // NOTE: AppointmentContext.getAppointmentsByNurse does a strict equality check
    // against appointment.nurseId, but in this app nurse identifiers can be UID,
    // staff code (e.g. NURSE003), or nested objects. Use matchesMine to avoid
    // missing assignments due to identifier mismatch.
    const sourceAppointments = Array.isArray(appointments) ? appointments : [];
    
    const strictMatches = getAppointmentsByNurse(targetNurseId) || [];

    const listIncludesMine = (list) => {
      if (!Array.isArray(list) || list.length === 0) return false;
      return list.some((entry) => {
        if (!entry) return false;
        if (typeof entry === 'string') return matchesMine(entry);
        const entryId = entry.nurseId || entry._id || entry.id;
        const entryCode = entry.staffCode || entry.nurseCode || entry.code || entry.username;
        return matchesMine(entryId) || matchesMine(entryCode);
      });
    };

    const flexibleMatches = sourceAppointments.filter((apt) => {
      if (!apt) return false;
      // Only match appointments where this nurse is the PRIMARY assigned nurse.
      // Backup/emergency nurses are surfaced separately via pendingCoverageAppointmentsForMe
      // (which requires an explicit pending coverage request targeting them).
      // Including backupNurses/emergencyBackupNurses here would make every backup nurse
      // see all appointments they are listed on, even when no coverage was requested.
      const isMatch = (
        matchesMine(apt.nurseId) ||
        matchesMine(apt.assignedNurseId) ||
        matchesMine(apt.assignedNurse) ||
        matchesMine(apt.assignedNurses) ||
        matchesMine(apt.nurse) ||
        matchesMine(apt.nurseCode) ||
        matchesMine(apt.staffCode) ||
        matchesMine(apt.nurse?.id) ||
        matchesMine(apt.nurse?._id)
      );
      return isMatch;
    });

    const combined = [...strictMatches, ...flexibleMatches];

    // Deduplicate appointments by ID to avoid duplicate keys in React
    const uniqueAppointments = [];
    const seen = new Set();
    for (const apt of combined) {
      const id = apt?.id || apt?._id || apt?.appointmentId;
      if (!id) continue;
      if (!seen.has(id)) {
        seen.add(id);
        uniqueAppointments.push(apt);
      }
    }
    // Nurse appointments recalculated
    return uniqueAppointments;
  }, [appointments, getAppointmentsByNurse, currentNurse?.id, user?.id, matchesMine, myNurseIdentifiers]);
  
  // Filter out shift requests from appointments - they have their own section
  const pendingAssignments = React.useMemo(() => {
    const result = nurseAppointments.filter(app => {
      const s = String(app.status || '').trim().toLowerCase();
      // Match 'assigned' status (case-insensitive) and ensure it's not a shift request
      return s === 'assigned' && !app.isShiftRequest;
    });
    return result;
  }, [nurseAppointments]);
  
  const bookedAppointments = React.useMemo(() => 
    nurseAppointments.filter(app => {
      const normalizedStatus = String(app.status || '').trim().toLowerCase();
      if (normalizedStatus !== 'confirmed') return false;
      if (app.isShiftRequest || app.isRecurring) return false;
      // Exclude appointments with a pending coverage request targeting me
      const coverageList = Array.isArray(app.coverageRequests) ? app.coverageRequests : [];
      const hasPendingCoverageForMe = coverageList.some((cr) => {
        if (!cr) return false;
        const crStatus = String(cr.status || '').trim().toLowerCase();
        if (crStatus !== 'pending') return false;
        const targets = [
          cr.targetBackupNurseId,
          cr.targetBackupNurseStaffCode,
          ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
        ].filter(Boolean);
        return targets.some((t) => matchesMine(t));
      });
      if (hasPendingCoverageForMe) {
        return false;
      }
      return true;
    }),
    [nurseAppointments]
  );
  
  const activeAppointments = React.useMemo(() => 
    nurseAppointments.filter(app => {
      const normalizedStatus = (app.status || '').toLowerCase();
      const isActiveStatus = normalizedStatus === 'clocked-in' || normalizedStatus === 'active';
      return isActiveStatus && !app.isShiftRequest && !app.isRecurring;
    }),
    [nurseAppointments]
  );
  
  const completedAppointments = React.useMemo(() => 
    nurseAppointments.filter(app => app.status === 'completed' && !app.isShiftRequest && !app.isRecurring),
    [nurseAppointments]
  );

  // Appointments with pending coverage targeted at me (non-shift)
  const pendingCoverageAppointmentsForMe = React.useMemo(() => {
    return nurseAppointments.filter((app) => {
      if (!app || app.isShiftRequest || app.isRecurring) return false;
      const coverageList = Array.isArray(app.coverageRequests) ? app.coverageRequests : [];
      if (coverageList.length === 0) return false;
      const matched = coverageList.some((cr) => {
        if (!cr) return false;
        const crStatus = String(cr.status || '').trim().toLowerCase();
        if (crStatus !== 'pending') return false;
        const targets = [
          cr.targetBackupNurseId,
          cr.targetBackupNurseStaffCode,
          ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
        ].filter(Boolean);
        const isMine = targets.some((t) => matchesMine(t));
        return isMine;
      });
      if (!matched) return false;
      const statusNormalized = String(app.status || '').trim().toLowerCase();
      return (
        statusNormalized === 'pending' ||
        statusNormalized === 'assigned' ||
        statusNormalized === 'approved' ||
        statusNormalized === 'confirmed' ||
        statusNormalized === 'active'
      );
    });
  }, [nurseAppointments, matchesMine]);

  // Get shift requests for this nurse
  const actualUserId = user?.id;
  // Avoid defaulting to NURSE001 if no user ID
  const nurseId = actualUserId === 'nurse-001' ? 'NURSE001' : actualUserId; 
  const rawShiftRequests = nurseId ? (getShiftRequestsByNurse(nurseId) || []) : [];

  // Also include shift requests where this nurse is a pending backup (coverage) target,
  // even if they are not the primary assigned nurse for the shift.
  const backupShiftRequestsForMe = React.useMemo(() => {
    if (!Array.isArray(shiftRequests) || shiftRequests.length === 0) return [];

    return shiftRequests.filter((req) => {
      if (!req || req.adminRecurring) return false;
      const coverageList = Array.isArray(req.coverageRequests) ? req.coverageRequests : [];
      if (coverageList.length === 0) return false;

      return coverageList.some((cr) => {
        if (!cr) return false;
        const crStatus = String(cr.status || '').trim().toLowerCase();
        if (crStatus !== 'pending') return false;
        const targets = [
          cr.targetBackupNurseId,
          cr.targetBackupNurseStaffCode,
          ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
        ].filter(Boolean);
        const matched = targets.some((t) => matchesMine(t));
        return matched;
      });
    });
  }, [shiftRequests, matchesMine]);
  
  // Deduplicate shift requests by ID to avoid duplicate keys in React
  const nurseShiftRequests = React.useMemo(() => {
    const uniqueShifts = [];
    const seen = new Set();
    const combined = [...rawShiftRequests, ...backupShiftRequestsForMe];
    for (const shift of combined) {
      if (!shift || !shift.id) continue;
      if (!seen.has(shift.id)) {
        seen.add(shift.id);
        uniqueShifts.push(shift);
      }
    }
    return uniqueShifts;
  }, [rawShiftRequests, backupShiftRequestsForMe]);
  
  // Use useMemo to ensure these update when nurseShiftRequests changes
  const pendingShiftRequests = React.useMemo(
    () =>
      nurseShiftRequests.filter((request) => {
        if (!request) return false;
        
        // Exclude ALL recurring shifts (admin-created or patient-created)
        const isRecurring = request.adminRecurring ||
          request.isRecurring === true ||
          String(request.isRecurring).trim().toLowerCase() === 'true' ||
          (request.recurringSchedule && typeof request.recurringSchedule === 'object') ||
          request.daysOfWeek ||
          request.selectedDays ||
          request.recurringPattern;
        if (isRecurring) return false;
        
        const statusNormalized = String(request.status || '').trim().toLowerCase();

        const coverageList = Array.isArray(request.coverageRequests)
          ? request.coverageRequests
          : [];
        const hasPendingCoverageForMe = coverageList.some((cr) => {
          if (!cr) return false;
          const crStatus = String(cr.status || '').trim().toLowerCase();
          if (crStatus !== 'pending') return false;
          const targets = [
            cr.targetBackupNurseId,
            cr.targetBackupNurseStaffCode,
            ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
          ].filter(Boolean);
          return targets.some((t) => matchesMine(t));
        });

        // Regular pending shift requests where I'm the assigned nurse
        if (statusNormalized === 'pending') {
          return true;
        }

        // For backup coverage, surface the shift under Pending when there's
        // a pending coverage request targeted at me, even if the shift
        // itself is already approved/active.
        if (hasPendingCoverageForMe && (statusNormalized === 'approved' || statusNormalized === 'active')) {
          return true;
        }

        return false;
      }),
    [nurseShiftRequests, matchesMine]
  );

  const isClockedInForMe = React.useCallback(
    (req) => {
      if (!req) return false;
      const statusNormalized = String(req.status || '').trim().toLowerCase();
      if (statusNormalized === 'completed') return false;

      const hasClockIn = Boolean(req?.actualStartTime || req?.startedAt || req?.clockInLocation);
      if (!hasClockIn) return false;

      const getMyClockEntry = (clockByNurse) => {
        if (!clockByNurse || typeof clockByNurse !== 'object') return null;

        for (const [key, entry] of Object.entries(clockByNurse)) {
          if (matchesMine(key)) return entry || null;
          if (entry && typeof entry === 'object') {
            const entryId =
              entry.nurseId ||
              entry.id ||
              entry._id ||
              entry.uid ||
              entry.nurseCode ||
              entry.staffCode ||
              entry.code;
            if (entryId && matchesMine(entryId)) return entry;
          }
        }
        return null;
      };

      const hasActiveClockInByMe = () => {
        const entry = getMyClockEntry(req?.clockByNurse);
        if (!entry || typeof entry !== 'object') return false;

        const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
        if (!inTime) return false;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
        if (!outTime) return true;

        const inMs = Date.parse(inTime);
        const outMs = Date.parse(outTime);
        if (!Number.isFinite(inMs)) return false;
        if (!Number.isFinite(outMs)) return true;
        return outMs < inMs;
      };

      // Determine active clock-in strictly by clock entry timestamps.
      // Do NOT classify as clocked-in solely because `startedBy` matches.
      // This prevents approved-but-completed items from reappearing as active.
      return hasActiveClockInByMe();
    },
    [matchesMine]
  );
  
  // Filter shifts by status from nurseShiftRequests
  const activeShiftsFromRequests = React.useMemo(() => {
    return nurseShiftRequests.filter((request) => {
      if (!request || request.adminRecurring) return false;
      const statusNormalized = String(request.status || '').trim().toLowerCase();
      if (statusNormalized === 'completed') return false;

      if (statusNormalized === 'active') {
        const isSplitSchedule = Boolean(
          request?.nurseSchedule &&
            typeof request.nurseSchedule === 'object' &&
            Object.keys(request.nurseSchedule).length > 0
        );

        // Only the nurse who actually started/clocked-in should see this as Active.
        // Split schedules: require an active clock-in entry for *me*.
        if (isSplitSchedule) {
          return isClockedInForMe(request);
        }

        // Non-split schedules: prefer startedBy match if present; fall back to clock entry.
        const startedByVal = request?.startedBy;
        const startedById =
          typeof startedByVal === 'object' && startedByVal !== null
            ? (startedByVal.id || startedByVal._id || startedByVal.uid || startedByVal.nurseId || startedByVal.staffCode || startedByVal.nurseCode || startedByVal.code)
            : startedByVal;

        if (startedById) {
          return matchesMine(startedById);
        }

        return isClockedInForMe(request);
      }

      // Some shift requests can still be marked approved while clocked-in.
      return isClockedInForMe(request);
    });
  }, [nurseShiftRequests, isClockedInForMe, matchesMine]);
  
  const completedShiftsFromRequests = React.useMemo(
    () => nurseShiftRequests.filter(request => request.status === 'completed'),
    [nurseShiftRequests]
  );

  // Only update contexts when user manually toggles (not on initial load)
  const handleAvailabilityToggle = async (value) => {
    setIsAvailable(value);

    if (currentNurse) {
      // Keep AppointmentContext in sync (used by some flows/screens)
      updateNurseAvailability(currentNurse.id || user?.id, value);

      // Persist + propagate to admin portal (backend/Firebase/local NurseContext)
      try {
        await updateNurse(currentNurse.id, {
          isActive: value,
          status: value ? 'available' : 'offline',
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        // Fallback: at least update local nurse context state
        updateNurseActiveStatus(currentNurse.id, value);
      }
    }

    Alert.alert(
      value ? 'Available' : 'Unavailable',
      value
        ? 'You are now available for new assignments.'
        : 'You are now unavailable and will not receive new assignments.'
    );
  };

  // Time tracking functions
  useEffect(() => {
    // Update time every 15 seconds for more responsive clock-in button
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 15000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const calculateHoursWorked = () => {
    if (!shiftStartTime) return '0.0';
    const diff = currentTime - shiftStartTime;
    const hours = diff / (1000 * 60 * 60);
    return hours.toFixed(1);
  };

  // Calculate hours worked from clock in/out times
  const calculateHoursFromClockTimes = (startTime, endTime) => {
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);
      const diffMs = end - start;
      const hours = diffMs / (1000 * 60 * 60);
      return hours.toFixed(1);
    } catch (error) {
      return '0.0';
    }
  };

  const handleClockAction = (action) => {
    if (action === 'clockin') {
      // Clock in immediately without notes
      const now = new Date();
      setIsOnShift(true);
      setShiftStartTime(now);
      
      // Move approved shift to active status using context
      const actualUserId = user?.id;
      const nurseId = actualUserId === 'nurse-001' ? 'NURSE001' : actualUserId;
      
      if (!nurseId) return;
      
      const approvedShifts = getApprovedShiftsByNurse(nurseId);
      if (approvedShifts.length > 0) {
        const currentShift = approvedShifts[0]; // Assuming first approved shift
        
        // Use context function to start the shift
        startShift(currentShift.id, now.toISOString(), nurseId);
        
        // Add to local active shifts for immediate UI update
        const activeShift = {
          ...currentShift,
          status: 'active',
          startedAt: now.toISOString()
        };
        setActiveShifts(prev => [...prev, activeShift]);

        // Immediate refresh to sync with backend
        setTimeout(() => {
          // Immediate refresh after clock-in
          refreshShiftRequests();
        }, 500);
        
        // Notify admin that nurse has started their shift
        sendNotificationToUser(
          'ADMIN001', // Admin user ID - matching your actual admin ID
          'admin',
          'Nurse Started Shift',
          `${user?.name || 'Nurse'} has clocked in and started their ${currentShift.service} shift.`,
          {
            nurseId: user?.id,
            nurseName: user?.name,
            shiftId: currentShift.id,
            type: 'shift_started'
          }
        ).catch(error => {
          console.error('Failed to send start shift notification to admin:', error);
        });
      }
      
      Alert.alert(
        'Clocked In Successfully',
        `Welcome! Your shift started at ${formatTime(now)}`
      );
    } else if (action === 'clockout') {
      // Show notes modal for clock out
      setActionType(action);
      setNotesModalVisible(true);
    }
  };

  const resetNotesModalState = useCallback(() => {
    const shouldReopenDetails = actionType === 'addnotes' && Boolean(selectedItemDetails);
    setNotesModalVisible(false);
    setActionType('');
    setShiftNotes('');
    setSelectedItemForNotes(null);
    setSelectedShiftForClockOut(null);
    setNotePhotoUris([]);
    setIsSavingNotes(false);
    setNotePhotoPickerBusy(false);
    setNoteVitals({ bpSystolic: '', bpDiastolic: '', heartRate: '', temperature: '', oxygenSaturation: '' });
    if (shouldReopenDetails) {
      setTimeout(() => {
        setDetailsModalVisible(true);
      }, 220);
    }
  }, [actionType, selectedItemDetails]);

  const openAddNotesModal = useCallback((item) => {
    const existingPhotos = Array.isArray(item?.nurseNotePhotos)
      ? item.nurseNotePhotos.filter((uri) => typeof uri === 'string' && uri.trim().length > 0)
      : [];

    setSelectedItemForNotes(item || null);
    setSelectedShiftForClockOut(null);
    setShiftNotes('');
    setNotePhotoUris(existingPhotos);
    setActionType('addnotes');
    setNotesModalVisible(true);
  }, []);

  const openAddNotesFromDetails = useCallback((item) => {
    const snapshot = item || selectedItemDetails;
    if (!snapshot) return;
    setDetailsModalVisible(false);
    setTimeout(() => {
      openAddNotesModal(snapshot);
    }, 220);
  }, [openAddNotesModal, selectedItemDetails]);

  const removeNotePhoto = useCallback((indexToRemove) => {
    setNotePhotoUris((prev) => prev.filter((_, index) => index !== indexToRemove));
  }, []);

  const openNotePhotoPreview = useCallback((uri) => {
    const target = typeof uri === 'string' ? uri.trim() : '';
    if (!target) return;
    // Defer to next tick to avoid rare Modal/touch timing issues.
    setTimeout(() => {
      setNotePhotoPreviewUri(target);
      setNotePhotoPreviewVisible(true);
    }, 0);
  }, []);

  const pickNotePhotos = useCallback(async () => {
    try {
      setNotePhotoPickerBusy(true);
      
      // Show action sheet to choose camera or gallery
      Alert.alert(
        'Add Photo',
        'Choose a source for your photo',
        [
          {
            text: 'Take Photo',
            onPress: async () => {
              try {
                const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
                if (!cameraPermission?.granted) {
                  Alert.alert('Permission required', 'Please allow camera access to take photos.');
                  setNotePhotoPickerBusy(false);
                  return;
                }

                const result = await ImagePicker.launchCameraAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: false,
                  quality: 0.85,
                });

                if (result?.canceled) {
                  setNotePhotoPickerBusy(false);
                  return;
                }

                const picked = (Array.isArray(result?.assets) ? result.assets : [])
                  .map((asset) => asset?.uri)
                  .filter(Boolean);

                if (picked.length > 0) {
                  setNotePhotoUris((prev) => {
                    const combined = [...prev, ...picked];
                    return combined.slice(0, 6);
                  });
                }
              } catch (error) {
                console.error('Error taking photo:', error);
                Alert.alert('Error', 'Failed to take photo');
              } finally {
                setNotePhotoPickerBusy(false);
              }
            },
          },
          {
            text: 'Choose from Gallery',
            onPress: async () => {
              try {
                const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!permission?.granted) {
                  Alert.alert('Permission required', 'Please allow photo library access to attach images.');
                  setNotePhotoPickerBusy(false);
                  return;
                }

                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: false,
                  allowsMultipleSelection: true,
                  quality: 0.85,
                  selectionLimit: 6,
                });

                if (result?.canceled) {
                  setNotePhotoPickerBusy(false);
                  return;
                }

                const picked = (Array.isArray(result?.assets) ? result.assets : [])
                  .map((asset) => asset?.uri)
                  .filter(Boolean);

                if (picked.length > 0) {
                  setNotePhotoUris((prev) => {
                    const combined = [...prev, ...picked];
                    return combined.slice(0, 6);
                  });
                }
              } catch (error) {
                console.error('Error picking photos:', error);
                Alert.alert('Error', 'Failed to select photos');
              } finally {
                setNotePhotoPickerBusy(false);
              }
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setNotePhotoPickerBusy(false),
          },
        ],
        { cancelable: true, onDismiss: () => setNotePhotoPickerBusy(false) }
      );
    } catch (error) {
      console.error('Error showing photo options:', error);
      Alert.alert('Error', 'Failed to open photo picker');
      setNotePhotoPickerBusy(false);
    }
  }, []);

  const uploadNotePhotos = useCallback(async (itemId, uris) => {
    const list = Array.isArray(uris) ? uris.filter(Boolean) : [];
    if (list.length === 0) return [];

    const nurseKey =
      normalizeId(user?.id || user?.uid || user?.nurseId || user?.staffCode || user?.nurseCode) || 'nurse';
    const itemKey = normalizeId(itemId) || 'note-item';

    const uploaded = await Promise.all(
      list.slice(0, 6).map(async (uri, index) => {
        try {
          const raw = String(uri || '').trim();
          if (!raw) return null;
          if (/^https?:\/\//i.test(raw)) return raw;

          const extFromUri = raw.split('?')[0].split('.').pop()?.toLowerCase();
          const fileExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(extFromUri) ? extFromUri : 'jpg';
          const safeExt = fileExt === 'jpeg' ? 'jpg' : fileExt;
          const path = `nurse-notes/${nurseKey}/${itemKey}/${Date.now()}-${index}.${safeExt}`;

          const uploadResult = await FirebaseService.uploadImage(raw, path);
          if (typeof uploadResult === 'string') return uploadResult;
          if (uploadResult?.success && uploadResult?.url) return uploadResult.url;

          console.warn('Note photo upload failed:', uploadResult?.error || uploadResult);
          return null;
        } catch (err) {
          console.warn('Note photo upload error:', err?.message || err);
          return null;
        }
      })
    );

    return [...new Set(uploaded.filter((u) => typeof u === 'string' && u.trim().length > 0))];
  }, [user]);

  const confirmClockAction = async () => {
    const now = new Date();

    const appendTimestampedNotes = (existingNotes, newNotes) => {
      const existing = typeof existingNotes === 'string' ? existingNotes.trim() : '';
      const addition = typeof newNotes === 'string' ? newNotes.trim() : '';
      if (!addition) return existing;
      if (!existing) return addition;
      return `${existing}\n\n--- ${new Date().toLocaleString()} ---\n${addition}`;
    };
    
    if (actionType === 'clockout') {
      if (isOnBreak) {
        Alert.alert('Error', 'Please end your break before clocking out.');
        setNotesModalVisible(false);
        return;
      }
      
      setIsOnShift(false);
      setHasClockOut(true); // Set clock out state to change button color
      
      // Handle clock out completion with location data for appointments/shifts
      if (selectedShiftForClockOut) {
        if (selectedShiftForClockOut.isAppointment) {
          try {
            const appointmentData = selectedShiftForClockOut;
            const endTime = appointmentData.endTime || new Date().toISOString();
            const startTimeISO = appointmentData.actualStartTime ||
              (appointmentData.date && appointmentData.time
                ? new Date(`${appointmentData.date}T${appointmentData.time}`).toISOString()
                : endTime);
            const hoursWorkedValue = Math.max(
              (new Date(endTime) - new Date(startTimeISO)) / (1000 * 60 * 60),
              0
            ).toFixed(2);

            const existingNotes = appointmentData.completionNotes || appointmentData.nurseNotes || '';
            const finalNotes = appendTimestampedNotes(existingNotes, shiftNotes);

            await completeAppointment(appointmentData.id, finalNotes || '', {
              actualEndTime: endTime,
              actualStartTime: startTimeISO,
              hoursWorked: hoursWorkedValue,
              clockOutLocation: appointmentData.clockOutLocation,
            });

            setSelectedItemDetails(prev => {
              if (!prev || prev.id !== appointmentData.id) return prev;
              return {
                ...prev,
                status: 'completed',
                actualStartTime: startTimeISO,
                actualEndTime: endTime,
                hoursWorked: hoursWorkedValue,
                completionNotes: finalNotes || '',
                nurseNotes: finalNotes || '',
                clockOutLocation: appointmentData.clockOutLocation,
              };
            });

            setDetailsModalVisible(false);
            setRefreshKey(prev => prev + 1);

            if (appointmentData.clockOutLocation) {
              const locationLabel = getLocationDisplayText(appointmentData.clockOutLocation) || 'Location unavailable';
              Alert.alert(
                'Clock Out Successful',
                `Clocked out at ${new Date(endTime).toLocaleTimeString()}\nLocation: ${locationLabel}\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.`
              );
            } else {
              Alert.alert(
                'Clock Out Successful',
                'Appointment marked as completed.\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.'
              );
            }

            setSelectedShiftForClockOut(null);
          } catch (error) {
            console.error('Error completing appointment clock out:', error);
            Alert.alert('Error', 'Failed to complete appointment');
          }
        } else {
          try {
            const shift = selectedShiftForClockOut;
            const endTime = shift.endTime;
            const startTime = new Date(shift.actualStartTime);
            const hoursWorked = ((new Date(endTime) - startTime) / (1000 * 60 * 60)).toFixed(2);

            const existingNotes =
              shift.lastCompletionNotes || shift.completionNotes || shift.nurseNotes || shift.notes || '';
            const finalNotes = appendTimestampedNotes(existingNotes, shiftNotes);
            
            // Complete the shift in ShiftContext with location data
            const completionResult = await completeShift(
              shift.id,
              endTime,
              hoursWorked,
              finalNotes || '',
              nurseId,
              { clockOutLocation: shift.clockOutLocation, keepBooked: true }
            );
            const resolvedEndTime = completionResult?.endTime || endTime;
            const resolvedHours = completionResult?.hoursWorked || hoursWorked;
            const resolvedLocation = completionResult?.clockOutLocation || shift.clockOutLocation;
            const keptBooked = Boolean(completionResult?.keepBooked);
            const resolvedNotesHistory = Array.isArray(completionResult?.notesHistory)
              ? completionResult.notesHistory
              : shift.notesHistory || [];
            
            // Create completed shift data for appointment creation
            const completedShiftData = {
              ...shift,
              actualEndTime: resolvedEndTime,
              hoursWorked: resolvedHours,
              completedAt: resolvedEndTime,
              completionNotes: shiftNotes || '',
              nurseName: getNurseName(user),
              clockOutLocation: resolvedLocation
            };

            // Add the completed shift as an appointment record for patient history
            try {
              await addCompletedAppointmentFromShift(completedShiftData);
            } catch (appointmentError) {
              console.error('Error creating appointment record:', appointmentError);
            }
            
            // Refresh shift data globally (syncs to admin dashboard)
            await refreshShiftRequests();
            
            setSelectedItemDetails(prev => {
              if (!prev || prev.id !== shift.id) return prev;
              if (!keptBooked) {
                return {
                  ...prev,
                  status: 'completed',
                  completedAt: resolvedEndTime,
                  actualEndTime: resolvedEndTime,
                  hoursWorked: resolvedHours,
                  completionNotes: shiftNotes || prev.completionNotes || '',
                  clockOutLocation: resolvedLocation,
                  notesHistory: resolvedNotesHistory,
                };
              }

              return {
                ...prev,
                status: 'approved',
                lastCompletedAt: resolvedEndTime,
                lastActualEndTime: resolvedEndTime,
                lastHoursWorked: resolvedHours,
                lastCompletionNotes: finalNotes || prev.completionNotes || '',
                lastClockOutLocation: resolvedLocation,
                notesHistory: resolvedNotesHistory,
                actualStartTime: null,
                startedAt: null,
                actualEndTime: null,
                completedAt: null,
                clockInLocation: null,
                clockOutLocation: null,
              };
            });
            
            // Close modal and refresh UI
            setDetailsModalVisible(false);
            setRefreshKey(prev => prev + 1);
            
            const locationLabel = getLocationDisplayText(resolvedLocation) || 'Location unavailable';
            Alert.alert(
              'Clock Out Successful',
              keptBooked
                ? `Clocked out at ${new Date(resolvedEndTime).toLocaleTimeString()}\nLocation: ${locationLabel}\nVisit saved. This shift is now back in your Booked tab for the next occurrence.\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.`
                : `Clocked out at ${new Date(resolvedEndTime).toLocaleTimeString()}\nLocation: ${locationLabel}\nThis was the final scheduled shift. The recurring assignment is now completed.\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.`
            );
            
            // Clear the selected shift
            setSelectedShiftForClockOut(null);
          } catch (error) {
            console.error('Error completing clock out:', error);
            Alert.alert('Error', 'Failed to complete clock out');
          }
        }
      } else {
        // Original clock out logic for older shifts
        let fallbackHoursWorked = null;
        if (activeShifts.length > 0) {
          const currentActiveShift = activeShifts[0]; // Assuming first active shift
          const actualUserId = user?.id;
          const nurseId = actualUserId === 'nurse-001' ? 'NURSE001' : actualUserId;
          
          if (!nurseId) return;
        
          // Calculate hours worked from actual start and end times
          let hoursWorked = calculateHoursWorked(); // Fallback to state-based calculation
          if (currentActiveShift.startedAt && now) {
            hoursWorked = calculateHoursFromClockTimes(currentActiveShift.startedAt, now.toISOString());
          }
          fallbackHoursWorked = hoursWorked;
        
          const existingNotes =
            currentActiveShift.completionNotes || currentActiveShift.lastCompletionNotes || currentActiveShift.nurseNotes || currentActiveShift.notes || '';
          const finalNotes = appendTimestampedNotes(existingNotes, shiftNotes);

          // Use context function to complete the shift with actual clock times
          await completeShift(currentActiveShift.id, now.toISOString(), hoursWorked, finalNotes, nurseId);
        
          // Add to local completed shifts for immediate UI update with actual clock times
          const completedShift = {
            ...currentActiveShift,
            status: 'completed',
            completedAt: now.toISOString(),
            actualEndTime: now.toISOString(),
            hoursWorked: hoursWorked,
            completionNotes: finalNotes
          };
          setCompletedShifts(prev => [...prev, completedShift]);
        
          // Remove from active shifts
          setActiveShifts(prev => prev.filter(shift => shift.id !== currentActiveShift.id));
        
          // Notify admin that nurse has completed their shift
          try {
            await sendNotificationToUser(
              'ADMIN001', // Admin user ID - matching your actual admin ID
              'admin',
              'Shift Completed',
              `${user?.name || 'Nurse'} has completed their ${currentActiveShift.service} shift. Total hours: ${hoursWorked}${finalNotes ? '. Notes: ' + finalNotes : ''}`,
              {
                nurseId: user?.id,
                nurseName: user?.name,
                shiftId: currentActiveShift.id,
                hoursWorked: hoursWorked,
                completionNotes: finalNotes,
                completedAt: now.toISOString(),
                type: 'shift_completed'
              }
            );
          } catch (error) {
            console.error('Failed to send completion notification to admin:', error);
          }
        }
      
        setShiftStartTime(null);
        setBreakStartTime(null);
      
        Alert.alert(
          'Clocked Out Successfully',
          `Shift completed! Total hours: ${fallbackHoursWorked ?? 'N/A'}${shiftNotes ? '\nNotes: ' + shiftNotes : ''}`
        );
      }
    } else if (actionType === 'addnotes') {
      // Handle saving notes for approved shifts (before they start)
      if (selectedItemForNotes) {
        try {
          setIsSavingNotes(true);
          const isShiftItem = Boolean(
            selectedItemForNotes.isShift ||
            selectedItemForNotes.isShiftRequest ||
            selectedItemForNotes.adminRecurring
          );

          // IMPORTANT: For appointments, do NOT use/overwrite the generic `notes` field here.
          // Patient-entered notes sometimes live in `notes` as a legacy fallback.
          const existingNotes = isShiftItem
            ? (selectedItemForNotes.notes || selectedItemForNotes.nurseNotes || '')
            : (selectedItemForNotes.nurseNotes || '');
          const finalNotes = appendTimestampedNotes(existingNotes, shiftNotes);
          const uploadedPhotoUrls = await uploadNotePhotos(selectedItemForNotes.id, notePhotoUris);
          const hasVitals = Object.values(noteVitals).some(v => String(v).trim().length > 0);

          // Update the notes in the appointment/shift
          await updateItemNotes(
            selectedItemForNotes.id,
            finalNotes,
            isShiftItem,
            { nurseNotePhotos: uploadedPhotoUrls, ...(hasVitals ? { nurseVitals: noteVitals } : {}) }
          );
          
          // Update local state to reflect the notes and photos
          const nowIso = new Date().toISOString();
          setSelectedItemDetails((prev) => {
            if (!prev) return prev;
            const prevId = prev?.id || prev?._id;
            const targetId = selectedItemForNotes?.id || selectedItemForNotes?._id;
            if (prevId && targetId && String(prevId) !== String(targetId)) return prev;

            const prevPhotos = Array.isArray(prev?.nurseNotePhotos)
              ? prev.nurseNotePhotos.filter((u) => typeof u === 'string' && u.trim().length > 0)
              : [];
            const combined = [...prevPhotos, ...(Array.isArray(uploadedPhotoUrls) ? uploadedPhotoUrls : [])];
            const mergedPhotos = [...new Set(combined.filter((u) => typeof u === 'string' && u.trim().length > 0))];

            return {
              ...prev,
              nurseNotes: finalNotes,
              ...(isShiftItem ? { notes: finalNotes } : null),
              nurseNotePhotos: mergedPhotos,
              ...(hasVitals ? { nurseVitals: noteVitals } : {}),
              updatedAt: nowIso,
            };
          });
          
          // Refresh appointments from backend to sync photos for future views
          try {
            if (isShiftItem) {
              await refreshShiftRequests();
            } else {
              await refreshAppointments();
            }
          } catch (err) {
            console.warn('Failed to refresh items after saving notes:', err?.message || err);
          }
          
          // Trigger UI refresh
          setRefreshKey(prev => prev + 1);
          
          Alert.alert('Success', 'Notes saved successfully!');
        } catch (error) {
          console.error('Failed to save notes:', error);
          Alert.alert('Error', 'Failed to save notes. Please try again.');
        } finally {
          setIsSavingNotes(false);
        }
      }
    } else if (actionType === 'complete') {
      // Handle completing an appointment
      if (selectedItemForNotes) {
        try {
          const existingNotes = selectedItemForNotes.completionNotes || selectedItemForNotes.nurseNotes || '';
          const finalNotes = appendTimestampedNotes(existingNotes, shiftNotes);
          await handleComplete(selectedItemForNotes.id, finalNotes || '');
          setDetailsModalVisible(false);
        } catch (error) {
          console.error('Failed to complete appointment:', error);
          Alert.alert('Error', 'Failed to complete appointment. Please try again.');
        }
      }
    }
    
    resetNotesModalState();
  };

  // Handle showing appointment/shift details
  const handleShowDetails = async (item) => {
    const itemId = item?.id || item?._id;
    console.log('[Details][open]', {
      itemId,
      itemNurseNotes: item?.nurseNotes || null,
      itemNotes: item?.notes || null,
    });
    // Check if this is a recurring shift and open the correct modal
    if (item.isRecurring || item.recurringDaysOfWeek || item.recurringScheduleId || item.adminRecurring) {
      // Try to get fresh data from backend first (mirror admin behavior)
      if (itemId) {
        try {
          const result = await FirebaseService.getShiftRequestById(itemId);
          if (result && result.success && result.shiftRequest) {
            const freshData = result.shiftRequest;
            
            // Ensure recurring status is preserved if the fresh data is missing flags
            if ((item.isRecurring || item.recurringDaysOfWeek || item.recurringScheduleId || item.adminRecurring) && 
                !(freshData.isRecurring || freshData.recurringDaysOfWeek || freshData.recurringScheduleId || freshData.adminRecurring)) {
              freshData.isRecurring = true;
              if (item.recurringPattern) freshData.recurringPattern = item.recurringPattern;
              if (item.adminRecurring) freshData.adminRecurring = true;
              if (item.recurringDaysOfWeek) freshData.recurringDaysOfWeek = item.recurringDaysOfWeek;
              if (item.recurringScheduleId) freshData.recurringScheduleId = item.recurringScheduleId;
            }

            // Preserve snapshots if missing in freshData
            if (!freshData.clientSnapshot && item.clientSnapshot) {
              freshData.clientSnapshot = item.clientSnapshot;
            }
            if (!freshData.patientSnapshot && item.patientSnapshot) {
              freshData.patientSnapshot = item.patientSnapshot;
            }

            // Normalize arrays/objects before opening modal
            const normalizedShift = {
              ...freshData,
              backupNurses: Array.isArray(freshData.backupNurses) ? freshData.backupNurses : [],
              coverageRequests: Array.isArray(freshData.coverageRequests) ? freshData.coverageRequests : [],
              assignedNurses: Array.isArray(freshData.assignedNurses) ? freshData.assignedNurses : [],
              notesHistory: Array.isArray(freshData.notesHistory) ? freshData.notesHistory : [],
              nurseSchedule: freshData.nurseSchedule && typeof freshData.nurseSchedule === 'object' ? freshData.nurseSchedule : {},
              daysOfWeek: Array.from(new Set([
                ...(Array.isArray(freshData.daysOfWeek) ? freshData.daysOfWeek : []),
                ...(Array.isArray(freshData.recurringDaysOfWeek) ? freshData.recurringDaysOfWeek : []),
                ...(Array.isArray(freshData.recurringDaysOfWeekList) ? freshData.recurringDaysOfWeekList : []),
                ...(Array.isArray(freshData.selectedDays) ? freshData.selectedDays : []),
                ...(Array.isArray(freshData.recurringPattern?.daysOfWeek) ? freshData.recurringPattern.daysOfWeek : []),
                ...(Array.isArray(freshData.recurringPattern?.selectedDays) ? freshData.recurringPattern.selectedDays : []),
                ...(Array.isArray(freshData.schedule?.daysOfWeek) ? freshData.schedule.daysOfWeek : []),
                ...(Array.isArray(freshData.schedule?.selectedDays) ? freshData.schedule.selectedDays : []),
                ...(Array.isArray(item.daysOfWeek) ? item.daysOfWeek : []),
                ...(Array.isArray(item.recurringDaysOfWeek) ? item.recurringDaysOfWeek : []),
                ...(Array.isArray(item.recurringDaysOfWeekList) ? item.recurringDaysOfWeekList : []),
                ...(Array.isArray(item.selectedDays) ? item.selectedDays : []),
              ])),
              nurseResponses: freshData.nurseResponses && typeof freshData.nurseResponses === 'object' ? freshData.nurseResponses : {},
            };

            console.log('[Recurring Modal Open] Fresh data loaded:', normalizedShift.id);
            
            if (__DEV__) {
              const clockByNurse = normalizedShift?.clockByNurse;
              const clockKeys = clockByNurse && typeof clockByNurse === 'object' ? Object.keys(clockByNurse) : [];
              const myUid = user?.uid || user?.id || nurseId;
              const myCode = user?.staffCode || user?.nurseCode || user?.code;
              const myEntry = clockKeys.length > 0 && myUid ? clockByNurse[myUid] : null;
              
              console.log('[Modal Open][DEBUG]', {
                shiftId: normalizedShift.id,
                status: normalizedShift.status,
                selectedCard,
                adminRecurring: normalizedShift.adminRecurring,
                isRecurring: normalizedShift.isRecurring,
                currentNurse: {
                  uid: myUid,
                  code: myCode,
                },
                clockByNurse: {
                  keyCount: clockKeys.length,
                  keys: clockKeys,
                  myEntry: myEntry ? {
                    lastClockInTime: myEntry.lastClockInTime || null,
                    lastClockOutTime: myEntry.lastClockOutTime || null,
                    clockInTime: myEntry.clockInTime || null,
                    clockOutTime: myEntry.clockOutTime || null,
                    clockEntriesCount: Array.isArray(myEntry.clockEntries) ? myEntry.clockEntries.length : 0,
                    allSessions: Array.isArray(myEntry.clockEntries) ? myEntry.clockEntries.map(s => ({
                      dayKey: s?.dayKey,
                      clockIn: s?.clockInTime || s?.actualStartTime || s?.startedAt || null,
                      clockOut: s?.clockOutTime || s?.actualEndTime || s?.completedAt || null,
                    })) : [],
                  } : null,
                },
                recurringPeriod: {
                  start: normalizedShift.recurringPeriodStart || normalizedShift.startDate || null,
                  end: normalizedShift.recurringPeriodEnd || normalizedShift.endDate || null,
                },
              });
            }
            
            setSelectedRecurringShift(normalizedShift);
            setHideRecurringShiftDetailsFooter(selectedCard === 'completed' || String(normalizedShift?.status || '').toLowerCase() === 'completed');
            setRecurringShiftDetailsModalVisible(true);
            return;
          }
        } catch (err) {
          console.log('[Recurring Modal Open] Failed to fetch fresh data, using cached:', err.message);
          // Fall through to use local cached data
        }
      }
      
      const stripGlobalClockFieldsIfNotMine = (shiftLike) => {
        if (!shiftLike || user?.role !== 'nurse') return shiftLike;

        const hasClockInData = Boolean(
          shiftLike?.startedAt || shiftLike?.actualStartTime || shiftLike?.clockInLocation
        );
        if (!hasClockInData) return shiftLike;

        const startedByVal = shiftLike?.startedBy;
        const startedById =
          typeof startedByVal === 'object' && startedByVal !== null
            ? (startedByVal.id || startedByVal._id || startedByVal.uid)
            : startedByVal;

        const startedByMe = startedById ? matchesMine(startedById) : false;

        const hasActiveClockInByMe = (() => {
          const clockByNurse = shiftLike?.clockByNurse;
          if (!clockByNurse || typeof clockByNurse !== 'object') return false;

          for (const [key, entry] of Object.entries(clockByNurse)) {
            if (!matchesMine(key)) {
              if (entry && typeof entry === 'object') {
                const entryId =
                  entry.nurseId || entry.id || entry._id || entry.uid || entry.nurseCode || entry.staffCode || entry.code;
                if (entryId && matchesMine(entryId)) {
                  // fall through to check timestamps
                } else {
                  continue;
                }
              } else {
                continue;
              }
            }

            if (!entry || typeof entry !== 'object') return false;
            const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt;
            if (!inTime) return false;
            const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt;
            if (!outTime) return true;
            const inMs = Date.parse(inTime);
            const outMs = Date.parse(outTime);
            if (!Number.isFinite(inMs)) return false;
            if (!Number.isFinite(outMs)) return true;
            return outMs < inMs;
          }

          return false;
        })();

        const iStarted = startedByMe || hasActiveClockInByMe;
        if (iStarted) return shiftLike;

        const {
          actualStartTime,
          startedAt,
          clockInLocation,
          clockInCapturedAt,
          ...rest
        } = shiftLike;

        return {
          ...rest,
          status: 'approved',
        };
      };

      // IMPORTANT: Get the latest data from context to ensure notes are up to date
      // The item passed here might be stale from a useMemo
      const latestFromContext = shiftRequests.find(sr => (sr.id || sr._id) === itemId);
      const mergedShiftRaw = latestFromContext 
        ? { ...item, ...latestFromContext, notes: latestFromContext.notes || item.notes }
        : item;

      const mergedShift = stripGlobalClockFieldsIfNotMine(mergedShiftRaw);
      
      // Normalize arrays/objects before opening modal (CRITICAL for preventing map() crashes)
      const normalizedShift = {
        ...mergedShift,
        backupNurses: Array.isArray(mergedShift.backupNurses) ? mergedShift.backupNurses : [],
        coverageRequests: Array.isArray(mergedShift.coverageRequests) ? mergedShift.coverageRequests : [],
        assignedNurses: Array.isArray(mergedShift.assignedNurses) ? mergedShift.assignedNurses : [],
        notesHistory: Array.isArray(mergedShift.notesHistory) ? mergedShift.notesHistory : [],
        nurseSchedule: mergedShift.nurseSchedule && typeof mergedShift.nurseSchedule === 'object' ? mergedShift.nurseSchedule : {},
        daysOfWeek: Array.isArray(mergedShift.daysOfWeek) ? mergedShift.daysOfWeek : (Array.isArray(mergedShift.recurringDaysOfWeek) ? mergedShift.recurringDaysOfWeek : []),
        nurseResponses: mergedShift.nurseResponses && typeof mergedShift.nurseResponses === 'object' ? mergedShift.nurseResponses : {},
      };
      
      console.log('[Recurring Modal Open] Using cached data:', normalizedShift.id);
      
      if (__DEV__) {
        const clockByNurse = normalizedShift?.clockByNurse;
        const clockKeys = clockByNurse && typeof clockByNurse === 'object' ? Object.keys(clockByNurse) : [];
        const myUid = user?.uid || user?.id || nurseId;
        const myCode = user?.staffCode || user?.nurseCode || user?.code;
        const myEntry = clockKeys.length > 0 && myUid ? clockByNurse[myUid] : null;
        
        console.log('[Modal Open][DEBUG]', {
          shiftId: normalizedShift.id,
          status: normalizedShift.status,
          selectedCard,
          adminRecurring: normalizedShift.adminRecurring,
          isRecurring: normalizedShift.isRecurring,
          currentNurse: {
            uid: myUid,
            code: myCode,
          },
          clockByNurse: {
            keyCount: clockKeys.length,
            keys: clockKeys,
            myEntry: myEntry ? {
              lastClockInTime: myEntry.lastClockInTime || null,
              lastClockOutTime: myEntry.lastClockOutTime || null,
              clockInTime: myEntry.clockInTime || null,
              clockOutTime: myEntry.clockOutTime || null,
              clockEntriesCount: Array.isArray(myEntry.clockEntries) ? myEntry.clockEntries.length : 0,
              allSessions: Array.isArray(myEntry.clockEntries) ? myEntry.clockEntries.map(s => ({
                dayKey: s?.dayKey,
                clockIn: s?.clockInTime || s?.actualStartTime || s?.startedAt || null,
                clockOut: s?.clockOutTime || s?.actualEndTime || s?.completedAt || null,
              })) : [],
            } : null,
          },
          recurringPeriod: {
            start: normalizedShift.recurringPeriodStart || normalizedShift.startDate || null,
            end: normalizedShift.recurringPeriodEnd || normalizedShift.endDate || null,
          },
        });
      }
      
      setSelectedRecurringShift(normalizedShift);
      setHideRecurringShiftDetailsFooter(selectedCard === 'completed' || String(normalizedShift?.status || '').toLowerCase() === 'completed');
      setRecurringShiftDetailsModalVisible(true);
      return;
    }

    // Check if this item is in activeShifts (local state) and has startedAt time
    const activeShiftMatch = activeShifts.find(shift => (shift.id || shift._id) === itemId);
    const startedAtTime = activeShiftMatch?.startedAt || item.startedAt;
    
    // Get the latest appointment data from context to ensure notes are up to date
    const latestAppointment = appointments.find(
      apt => apt.id === itemId || apt._id === itemId || apt.appointmentId === itemId
    );
    const latestShift = shiftRequests.find(shift => (shift.id || shift._id) === itemId);
    const latestItem = latestAppointment || latestShift || item;
    console.log('[Details][latest]', {
      itemId,
      latestNurseNotes: latestItem?.nurseNotes || null,
      latestNotes: latestItem?.notes || null,
    });
    const isShiftContext = Boolean(
      latestItem?.isShift ||
      latestItem?.isShiftRequest ||
      latestItem?.adminRecurring ||
      item?.isShift ||
      item?.isShiftRequest ||
      item?.adminRecurring
    );
    
    // Check if we have locally updated notes in selectedItemDetails that should be preserved
    const existingDetails = (selectedItemDetails?.id || selectedItemDetails?._id) === itemId ? selectedItemDetails : null;
    const shiftNoteFallback = isShiftContext ? (latestItem.notes || item.notes || null) : null;
    const nurseNotesToUse = existingDetails?.nurseNotes || latestItem.nurseNotes || shiftNoteFallback || item.nurseNotes || '';
    const patientNotesToUse = existingDetails?.patientNotes || latestItem.patientNotes || item.patientNotes || '';
    
    // Try to find client details from other appointments if missing in current one
    let clientDetails = {};
    const patientId = latestItem.patientId || latestItem.clientId || item.patientId || item.clientId;
    const patientName = latestItem.patientName || latestItem.clientName || item.patientName || item.clientName;

    if (patientId || patientName) {
       const allClients = getAllClients();
       // Find all matches first
       const matches = allClients.filter(c => 
         (patientId && (c.id === patientId || c.id == patientId)) || 
         (patientName && c.name && c.name.toLowerCase() === patientName.toLowerCase())
       );
       
       // Pick the best match: prefer one with email AND phone, then either, then just the first match
       const bestMatch = matches.find(c => c.email && c.phone) || 
                         matches.find(c => c.email || c.phone) || 
                         matches[0];
                         
       if (bestMatch) {
         clientDetails = bestMatch;
       }
    }

    const normalizeId = (value) => (value ? String(value).toLowerCase() : null);
    const findNurseById = (candidateId) => {
      if (!candidateId || !nurses || nurses.length === 0) return null;
      const normalizedCandidate = normalizeId(candidateId);
      return nurses.find(nurse => {
        const idsToCheck = [nurse.id, nurse._id, nurse.nurseId, nurse.code];
        return idsToCheck.some(idValue => normalizeId(idValue) === normalizedCandidate);
      }) || null;
    };

    const resolvedAssignedNurse = (() => {
      const hasNameFields = (nurseObj) => Boolean(nurseObj?.fullName || nurseObj?.name || nurseObj?.firstName || nurseObj?.lastName);

      if (latestItem.assignedNurse && typeof latestItem.assignedNurse === 'object') {
        if (hasNameFields(latestItem.assignedNurse)) {
          return latestItem.assignedNurse;
        }
        const matched = findNurseById(latestItem.assignedNurse._id || latestItem.assignedNurse.id);
        if (matched) return matched;
      }

      if (latestItem.nurse && typeof latestItem.nurse === 'object') {
        if (hasNameFields(latestItem.nurse)) {
          return latestItem.nurse;
        }
        const matched = findNurseById(latestItem.nurse._id || latestItem.nurse.id);
        if (matched) return matched;
      }

      const candidateIds = [
        latestItem.assignedNurseId,
        item.assignedNurseId,
        latestItem.nurseId,
        item.nurseId
      ];
      for (const candidate of candidateIds) {
        const matched = findNurseById(candidate);
        if (matched) return matched;
      }

      if (typeof latestItem.assignedNurse === 'string') {
        return { name: latestItem.assignedNurse };
      }
      if (typeof latestItem.nurse === 'string') {
        return { name: latestItem.nurse };
      }

      return null;
    })();

    const resolvedNurseName = (() => {
      const directName = latestItem.nurseName || item.nurseName || latestItem.assignedNurseName || item.assignedNurseName;
      if (directName && directName !== 'Unassigned') {
        return directName;
      }

      if (resolvedAssignedNurse) {
        const formattedName = getNurseName(resolvedAssignedNurse);
        if (formattedName && formattedName !== 'Unassigned') {
          return formattedName;
        }
      }

      if (latestItem.nurseId || item.nurseId) {
        const matched = findNurseById(latestItem.nurseId || item.nurseId);
        if (matched) {
          const formattedName = getNurseName(matched);
          if (formattedName && formattedName !== 'Unassigned') {
            return formattedName;
          }
        }
      }

      if (typeof latestItem.assignedNurse === 'string') {
        return latestItem.assignedNurse;
      }
      if (typeof latestItem.nurse === 'string') {
        return latestItem.nurse;
      }

      return null;
    })();

    const normalizedStatus = (latestItem.status || item.status || '').toLowerCase();
    const assignmentStatuses = ['assigned', 'approved', 'confirmed', 'in-progress', 'clocked-in', 'active', 'completed'];
    const resolvedAssignedAt = latestItem.assignedAt || item.assignedAt ||
      latestItem.assignmentDate || latestItem.assignmentTimestamp || latestItem.acceptedAt || latestItem.confirmedAt || latestItem.nurseAssignedAt ||
      (resolvedNurseName && assignmentStatuses.includes(normalizedStatus) ? (latestItem.updatedAt || item.updatedAt || latestItem.createdAt || item.createdAt || null) : null);

    const derivedNurseId = latestItem.nurseId || item.nurseId || latestItem.assignedNurseId || item.assignedNurseId ||
      resolvedAssignedNurse?._id || resolvedAssignedNurse?.id || resolvedAssignedNurse?.nurseId || resolvedAssignedNurse?.code || null;

    // Determine the actual type of item
    // isShift = nurse-requested shift (status usually 'pending' or 'approved')
    // Regular appointment = admin-assigned (status 'assigned' or 'confirmed')
    // Some legacy records may incorrectly carry isShift/isShiftRequest on appointments;
    // treat appointment-like statuses as regular appointments regardless of those flags.
    const itemIsRecurring = Boolean(latestItem?.isRecurring || item?.isRecurring);
    const appointmentLikeStatuses = ['assigned', 'confirmed', 'clocked-in'];
    const isAppointmentLike = appointmentLikeStatuses.includes(normalizedStatus);

    const isActualShift = !isAppointmentLike && (
      item.isShiftRequest === true ||
      item.isShift === true ||
      (normalizedStatus === 'pending' && !itemIsRecurring && item.nurseId)
    );

    const resolveBackupNurses = (...candidates) => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (Array.isArray(candidate) && candidate.filter(Boolean).length > 0) {
          return candidate.filter(Boolean);
        }
        if (typeof candidate === 'object' && !Array.isArray(candidate)) {
          const values = Object.values(candidate).filter(Boolean);
          if (values.length > 0) return values;
        }
      }
      return [];
    };

    const resolvedBackupNurses = (() => {
      const list = resolveBackupNurses(
        latestItem.backupNurses,
        item.backupNurses,
        latestItem.backupNursesNotified,
        item.backupNursesNotified,
        latestItem.schedule?.backupNurses,
        item.schedule?.backupNurses,
        latestItem.emergencyBackupNurses,
        item.emergencyBackupNurses,
        latestItem.backupNurseList,
        item.backupNurseList
      );

      if (list.length > 0) return list;

      const singleId = latestItem.backupNurseId || item.backupNurseId;
      const singleName = latestItem.backupNurseName || item.backupNurseName;
      const singleObj = latestItem.backupNurse || item.backupNurse;
      if (singleObj && (singleObj.nurseId || singleObj.id || singleObj._id || singleObj.name || singleObj.fullName)) {
        return [singleObj];
      }
      if (singleId || singleName) {
        return [{ nurseId: singleId || undefined, name: singleName || undefined, priority: 1 }];
      }

      return [];
    })();
    
    // Ensure patient contact info is included
    const itemWithDetails = {
      ...item,
      ...latestItem, // Merge with latest data to get updated notes
      startedAt: startedAtTime, // Include the clock in time from active shifts
      patientName: latestItem.patientName || latestItem.clientName || (latestItem.patient?.firstName ? `${latestItem.patient.firstName} ${latestItem.patient.lastName || ''}` : (item.patientName || item.clientName || clientDetails.name || 'N/A')),
      clientName: latestItem.clientName || latestItem.patientName || (latestItem.patient?.firstName ? `${latestItem.patient.firstName} ${latestItem.patient.lastName || ''}` : (item.clientName || item.patientName || clientDetails.name || 'N/A')),
      email: latestItem.email || latestItem.patientEmail || latestItem.patient?.email || latestItem.clientEmail || item.email || item.patientEmail || item.clientEmail || clientDetails.email || 'N/A',
      patientEmail: latestItem.patientEmail || latestItem.clientEmail || latestItem.patient?.email || latestItem.email || item.patientEmail || item.clientEmail || item.email || clientDetails.email || 'N/A',
      phone: latestItem.phone || latestItem.patientPhone || latestItem.patient?.phone || latestItem.clientPhone || item.phone || item.patientPhone || item.clientPhone || clientDetails.phone || 'N/A',
      patientPhone: latestItem.patientPhone || latestItem.clientPhone || latestItem.patient?.phone || latestItem.phone || item.patientPhone || item.clientPhone || item.phone || clientDetails.phone || 'N/A',
      address: formatAddress(latestItem.address || latestItem.clientAddress || latestItem.patient?.address || item.address || item.clientAddress || clientDetails.address),
      // Correctly identify if this is a shift request (nurse-initiated) vs regular appointment (admin-assigned)
      isShift: isActualShift,
      isShiftRequest: !isAppointmentLike && (item.isShiftRequest || isActualShift),
      // Separate notes
      nurseNotes: nurseNotesToUse,
      patientNotes: patientNotesToUse,
      nurseId: derivedNurseId,
      nurseName: resolvedNurseName || latestItem.nurseName || item.nurseName || null,
      assignedNurse: resolvedAssignedNurse || latestItem.assignedNurse || item.assignedNurse || null,
      assignedAt: resolvedAssignedAt,
      backupNurses: resolvedBackupNurses,
    };
    
    // DEBUG: Log all note fields for appointments
    if (item.status === 'completed') {
      // Appointment Details Modal - Note Fields
      // - completionNotes
      // - nurseNotes
      // - notes
      // - Full item
    }
    
    setSelectedItemDetails(itemWithDetails);
    setDetailsModalVisible(true);
  };

  // Shift booking functions
  const handleBookShift = () => {
    const today = new Date();
    setShiftDetails({
      ...shiftDetails,
      date: today.toISOString().split('T')[0]
    });
    setShiftBookingModal(true);
  };

  // Client selection handler
  const handleClientSelect = (client) => {
    // Client selected
    setSelectedClient(client);
    setClientSearchText('');
    setIsClientFocused(false);
    setShowClientDropdown(false);
    setShiftDetails(prev => ({
      ...prev,
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client?.phone || client?.phoneNumber || client?.contactNumber || '',
      clientAddress: client?.address || ''
    }));
    setClientSearchText(client?.name || '');
    setShowClientDropdown(false);
  };

  // Reset shift form
  const resetShiftForm = () => {
    setShiftDetails({
      date: '',
      startDate: '',
      endDate: '',
      startTime: '',
      endTime: '',
      service: '',
      notes: '',
      clientId: '',
      clientName: '',
      clientEmail: '',
      clientPhone: '',
      clientAddress: ''
    });
    setBackupNurses([]);
    setSelectedDays([]);
    setRescheduleShiftRequestId(null);
    setClientSearchText('');
    setNurseSearch('');
    setShowClientDropdown(false);
    setShowDatePicker(false);
    setShowStartDatePicker(false);
    setShowEndDatePicker(false);
    setShowStartTimePicker(false);
    setShowEndTimePicker(false);
  };

  const submitShiftRequest = async () => {
    // Submitting shift request with user details
    
    // Validate required fields
    const validDate = shiftDetails.startDate || shiftDetails.date;
    if (!validDate || !shiftDetails.startTime || !shiftDetails.endTime || !shiftDetails.service) {
      Alert.alert('Missing Information', 'Please fill in start date, start time, end time, and service.');
      return;
    }

    // Calculate total hours - handles both 12-hour (AM/PM) and 24-hour formats
    const calculateHours = (start, end) => {
      // Function to convert time string to minutes
      const timeToMinutes = (timeStr) => {
        // Check if it's 12-hour format (contains AM/PM)
        const is12Hour = /AM|PM/i.test(timeStr);
        
        if (is12Hour) {
          // Parse 12-hour format (e.g., "12:56 AM" or "3:45 PM")
          const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (!match) return 0;
          
          let hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const period = match[3].toUpperCase();
          
          // Convert to 24-hour format
          if (period === 'AM' && hours === 12) hours = 0;
          if (period === 'PM' && hours !== 12) hours += 12;
          
          return hours * 60 + minutes;
        } else {
          // Parse 24-hour format (e.g., "13:30")
          const parts = timeStr.split(':');
          const hours = parseInt(parts[0], 10) || 0;
          const minutes = parseInt(parts[1], 10) || 0;
          return hours * 60 + minutes;
        }
      };
      
      let startMinutes = timeToMinutes(start);
      let endMinutes = timeToMinutes(end);
      
      // Handle overnight shifts
      if (endMinutes < startMinutes) {
        endMinutes += 24 * 60;
      }
      
      const totalMinutes = endMinutes - startMinutes;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      // Return hours with decimal (e.g., 8.5 for 8 hours 30 minutes)
      return minutes > 0 ? `${hours}.${Math.round((minutes / 60) * 100)}` : `${hours}`;
    };

    const totalHours = calculateHours(shiftDetails.startTime, shiftDetails.endTime);

    // Create shift request data
    const isRecurringShift = Array.isArray(selectedDays) && selectedDays.length > 0;
    const resolvedStartDate = shiftDetails.startDate || shiftDetails.date;
    const resolvedEndDate = shiftDetails.endDate || resolvedStartDate;
    const requestData = {
      nurseId: user?.id === 'nurse-001' ? 'NURSE001' : user?.id,
      nurseName: getNurseName(currentNurse || user),
      nurseCode: user?.nurseCode || currentNurse?.code || 'N/A',
      date: resolvedStartDate,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      startTime: shiftDetails.startTime,
      endTime: shiftDetails.endTime,
      totalHours: totalHours,
      service: shiftDetails.service,
      notes: shiftDetails.notes,
      clientId: shiftDetails.clientId,
      clientName: shiftDetails.clientName,
      clientEmail: shiftDetails.clientEmail || 'N/A',
      clientPhone: shiftDetails.clientPhone || 'N/A',
      clientAddress: shiftDetails.clientAddress || 'N/A',
      patientName: shiftDetails.clientName, // Alias for consistent field naming
      patientEmail: shiftDetails.clientEmail || 'N/A',
      patientPhone: shiftDetails.clientPhone || 'N/A',
      address: shiftDetails.clientAddress || 'N/A',
      isShift: true, // Mark as shift request
      isRecurring: isRecurringShift,
      backupNurses: backupNurses, // Include backup nurses
      daysOfWeek: selectedDays, // Include selected days of week
      ...(isRecurringShift && {
        recurringPattern: {
          startDate: resolvedStartDate,
          endDate: resolvedEndDate,
          daysOfWeek: selectedDays,
          frequency: 'weekly',
        },
      }),
    };

    // Request data prepared

    let newRequest = null;
    try {
      if (rescheduleShiftRequestId) {
        if (!updateShiftRequestDetails) {
          throw new Error('updateShiftRequestDetails function is not available');
        }
        newRequest = await updateShiftRequestDetails(rescheduleShiftRequestId, {
          ...requestData,
          status: 'pending',
          updatedAt: new Date().toISOString(),
        });
      } else {
        // Submit the request using context
        if (!submitShiftToContext) {
          throw new Error('submitShiftToContext function is not available');
        }
        newRequest = await submitShiftToContext(requestData);
      }

      // Shift request submitted
    } catch (error) {
      console.error('❌ NURSE: Error submitting shift request:', error);

      Alert.alert('Error', 'Failed to submit shift request. Please try again.');
      return;
    }

    // Send notification to admin about the new/rescheduled shift request
    try {
      if (!newRequest) {

        throw new Error('newRequest was not returned from submitShiftToContext');
      }
      
      const clientInfo = shiftDetails.clientName ? ` for ${shiftDetails.clientName}` : '';

      
      await sendNotificationToUser(
        'ADMIN001', // Admin user ID - matching your actual admin ID
        'admin',
        rescheduleShiftRequestId ? 'Shift Request Rescheduled' : 'New Shift Request',
        rescheduleShiftRequestId
          ? `${requestData.nurseName} has rescheduled a ${requestData.service} shift to ${requestData.startDate || requestData.date} - ${requestData.endDate || requestData.startDate || requestData.date}${clientInfo}`
          : `${requestData.nurseName} has requested a ${requestData.service} shift on ${requestData.date}${clientInfo}`,
        {
          shiftRequestId: newRequest?.id || 'unknown',
          nurseId: requestData.nurseId,
          type: rescheduleShiftRequestId ? 'shift_rescheduled' : 'shift_request'
        }
      );

    } catch (error) {
      console.error('❌ Failed to send notification to admin:', error);

    }

    Alert.alert(
      rescheduleShiftRequestId ? 'Shift Request Rescheduled' : 'Shift Request Submitted',
      rescheduleShiftRequestId
        ? 'Your shift request has been updated and sent to admin for approval.'
        : 'Your shift request has been sent to admin for approval. You will be notified once it\'s reviewed.',
      [
        {
          text: 'OK',
          onPress: () => {
            setShiftBookingModal(false);
            resetShiftForm();
            // Force a refresh to show the new shift request immediately
            setRefreshKey(prev => prev + 1);
            // If pending card is already selected, keep it selected to show the new request
            if (selectedCard !== 'pending') {
              setSelectedCard('pending');
            }
          }
        }
      ]
    );
  };

  // Date and time picker handlers
  const onDateChange = (event, date) => {
    if (date) {
      setSelectedDate(date);
    }
  };

  const onStartDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowStartDatePicker(false);
      if (event?.type === 'dismissed') return;
      if (date) {
        setSelectedStartDate(date);
        setShiftDetails((prev) => ({ ...prev, startDate: date }));
      }
      return;
    }

    if (date) setSelectedStartDate(date);
  };

  const onEndDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
      if (event?.type === 'dismissed') return;
      if (date) {
        setSelectedEndDate(date);
        setShiftDetails((prev) => ({ ...prev, endDate: date }));
      }
      return;
    }

    if (date) setSelectedEndDate(date);
  };

  const confirmStartDateSelection = () => {
    setShiftDetails({ ...shiftDetails, startDate: selectedStartDate });
    setShowStartDatePicker(false);
  };

  const confirmEndDateSelection = () => {
    setShiftDetails({ ...shiftDetails, endDate: selectedEndDate });
    setShowEndDatePicker(false);
  };

  const formatTimeForShiftDetails = (dateObj) => {
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const paddedMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${paddedMinutes} ${ampm}`;
  };


  const onStartTimeChange = (event, time) => {
    if (Platform.OS === 'android') {
      setShowStartTimePicker(false);
      if (event?.type === 'dismissed') return;
      if (time) {
        setSelectedStartTime(time);
        setShiftDetails((prev) => ({ ...prev, startTime: formatTimeForShiftDetails(time) }));
      }
      return;
    }

    if (time) setSelectedStartTime(time);
  };

  const onEndTimeChange = (event, time) => {
    if (Platform.OS === 'android') {
      setShowEndTimePicker(false);
      if (event?.type === 'dismissed') return;
      if (time) {
        setSelectedEndTime(time);
        setShiftDetails((prev) => ({ ...prev, endTime: formatTimeForShiftDetails(time) }));
      }
      return;
    }

    if (time) setSelectedEndTime(time);
  };

  const confirmDateSelection = () => {
    const formattedDate = selectedDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    setShiftDetails({ ...shiftDetails, date: formattedDate });
    setShowDatePicker(false);
  };

  const confirmStartTimeSelection = () => {
    setShiftDetails({ ...shiftDetails, startTime: formatTimeForShiftDetails(selectedStartTime) });
    setShowStartTimePicker(false);
  };

  const confirmEndTimeSelection = () => {
    setShiftDetails({ ...shiftDetails, endTime: formatTimeForShiftDetails(selectedEndTime) });
    setShowEndTimePicker(false);
  };

  const handleCardPress = (cardType) => {
    setSelectedCard(selectedCard === cardType ? null : cardType);
  };

  const handleRequestBackupForShift = async (shiftRequest) => {
    if (!shiftRequest || !shiftRequest.id) {
      Alert.alert('Error', 'Invalid shift request');
      return;
    }

    const backupList = Array.isArray(shiftRequest.backupNurses) 
      ? shiftRequest.backupNurses 
      : [];

    if (backupList.length === 0) {
      Alert.alert('No Backup Nurses', 'No backup nurses are configured for this shift request.');
      return;
    }

    const candidates = backupList
      .map((b) => {
        if (!b) return null;
        return {
          nurseId: b.nurseId || b.uid || b.id || b._id || null,
          staffCode: b.staffCode || b.nurseCode || b.code || b.username || null,
          name: b.name || b.fullName || b.nurseName || b.displayName || b.staffCode || b.nurseCode || b.code || 'Backup Nurse',
        };
      })
      .filter((b) => b && b.nurseId);

    if (candidates.length === 0) {
      Alert.alert('No Backup Nurses', 'No valid backup nurses found for this shift request.');
      return;
    }

    const submit = async (selected) => {
      try {
        const dateKey = shiftRequest.startDate || shiftRequest.date;
        const nowIso = new Date().toISOString();
        
        const latest = await ApiService.getShiftRequestById(shiftRequest.id);
        if (!latest) {
          throw new Error('Unable to load shift request');
        }

        const coverageRequests = Array.isArray(latest.coverageRequests) ? [...latest.coverageRequests] : [];

        const alreadyPending = coverageRequests.some((req) => {
          if (!req) return false;
          const sameDate = req.date === dateKey;
          const status = String(req.status || '').toLowerCase();
          return sameDate && status === 'pending';
        });

        if (alreadyPending) {
          Alert.alert('Coverage Already Requested', 'A backup request is already pending for this shift.');
          return;
        }

        const coverageRequest = {
          id: `coverage_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          date: dateKey,
          status: 'pending',
          requestedAt: nowIso,
          requestingNurseId: user?.id === 'nurse-001' ? 'NURSE001' : user?.id,
          requestingNurseCode: user?.nurseCode || user?.code || 'N/A',
          requestingNurseName: user?.fullName || user?.name || 'N/A',
          reason: 'Backup requested',
          notes: shiftRequest.notes || null,
          targetBackupNurseId: selected?.nurseId || null,
          targetBackupNurseStaffCode: selected?.staffCode || null,
          targetBackupNurseName: selected?.name || null,
          backupNursesNotified: [selected?.nurseId, selected?.staffCode].filter(Boolean),
          responses: [],
        };

        coverageRequests.push(coverageRequest);
        
        const result = await ApiService.updateShiftRequest(shiftRequest.id, {
          coverageRequests,
          updatedAt: nowIso,
        });

        if (!result) {
          throw new Error('Failed to request backup');
        }

        // Send notification to backup nurse
        try {
          await sendNotificationToUser(
            selected.nurseId,
            'nurse',
            'Backup Coverage Request',
            `${user?.fullName || user?.name} has requested you as backup for ${shiftRequest.service || 'a shift'} on ${dateKey}`,
            {
              type: 'backup_coverage_request',
              shiftId: shiftRequest.id,
              coverageRequestId: coverageRequest.id,
              date: dateKey,
            }
          );
        } catch (notifError) {
          console.error('Failed to send notification:', notifError);
        }

        Alert.alert('Success', `Backup request sent to ${selected.name}`);
        setRefreshKey(prev => prev + 1);
      } catch (error) {
        console.error('Error requesting backup:', error);
        Alert.alert('Error', error?.message || 'Failed to request backup. Please try again.');
      }
    };

    if (candidates.length === 1) {
      Alert.alert(
        'Request Backup',
        `Notify ${candidates[0].name} for coverage?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Request', style: 'default', onPress: () => submit(candidates[0]) },
        ]
      );
      return;
    }

    Alert.alert(
      'Select Backup Nurse',
      'Choose who to notify for coverage:',
      [
        ...candidates.map((b) => ({
          text: b.name,
          onPress: () => submit(b),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleRequestBackupForAppointment = async (appointment) => {
    if (!appointment || !appointment.id) {
      Alert.alert('Error', 'Invalid appointment');
      return;
    }

    const backupList = Array.isArray(appointment.backupNurses)
      ? appointment.backupNurses
      : [];

    if (backupList.length === 0) {
      Alert.alert('No Backup Nurses', 'No backup nurses are configured for this appointment.');
      return;
    }

    const candidates = backupList
      .map((b) => {
        if (!b) return null;
        return {
          nurseId: b.nurseId || b.uid || b.id || b._id || null,
          staffCode: b.staffCode || b.nurseCode || b.code || b.username || null,
          name: b.name || b.fullName || b.nurseName || b.displayName || b.staffCode || b.nurseCode || b.code || 'Backup Nurse',
        };
      })
      .filter((b) => b && b.nurseId);

    if (candidates.length === 0) {
      Alert.alert('No Backup Nurses', 'No valid backup nurses found for this appointment.');
      return;
    }

    const submit = async (selected) => {
      try {
        const dateKey =
          appointment.preferredDate ||
          appointment.date ||
          appointment.scheduledDate ||
          appointment.appointmentDate ||
          null;

        const nowIso = new Date().toISOString();

        const latest = await ApiService.getAppointmentById(appointment.id);
        if (!latest) {
          throw new Error('Unable to load appointment');
        }

        // Prefer unified storage under coverageRequests; include backupCoverageRequests for backward compatibility
        const existingRequestsRaw = latest.coverageRequests || latest.backupCoverageRequests;
        const coverageRequests = Array.isArray(existingRequestsRaw) ? [...existingRequestsRaw] : [];

        const alreadyPending = coverageRequests.some((req) => {
          if (!req) return false;
          const sameDate = dateKey ? req.date === dateKey : true;
          const status = String(req.status || '').toLowerCase();
          return sameDate && status === 'pending';
        });

        if (alreadyPending) {
          Alert.alert('Coverage Already Requested', 'A backup request is already pending for this appointment.');
          return;
        }

        const coverageRequest = {
          id: `apt_coverage_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          date: dateKey,
          status: 'pending',
          requestedAt: nowIso,
          requestingNurseId: user?.id === 'nurse-001' ? 'NURSE001' : user?.id,
          requestingNurseCode: user?.nurseCode || user?.code || 'N/A',
          requestingNurseName: user?.fullName || user?.name || 'N/A',
          reason: 'Backup requested',
          notes: appointment.notes || appointment.patientNotes || appointment.nurseNotes || null,
          targetBackupNurseId: selected?.nurseId || null,
          targetBackupNurseStaffCode: selected?.staffCode || null,
          targetBackupNurseName: selected?.name || null,
          backupNursesNotified: [selected?.nurseId, selected?.staffCode].filter(Boolean),
          responses: [],
        };

        coverageRequests.push(coverageRequest);

        const result = await ApiService.updateAppointment(appointment.id, {
          coverageRequests,
          // Also mirror into backupCoverageRequests for compatibility with older records
          backupCoverageRequests: coverageRequests,
          updatedAt: nowIso,
        });

        if (!result) {
          throw new Error('Failed to request backup');
        }

        try {
          const descriptor = appointment.service || appointment.serviceName || 'an appointment';
          const when = dateKey || 'the scheduled date';
          await sendNotificationToUser(
            selected.nurseId,
            'nurse',
            'Backup Coverage Request',
            `${user?.fullName || user?.name} has requested you as backup for ${descriptor} on ${when}`,
            {
              type: 'backup_coverage_request',
              appointmentId: appointment.id,
              coverageRequestId: coverageRequest.id,
              date: dateKey,
            }
          );
        } catch (notifError) {
          console.error('Failed to send notification:', notifError);
        }

        Alert.alert('Success', `Backup request sent to ${selected.name}`);
        setRefreshKey((prev) => prev + 1);
      } catch (error) {
        console.error('Error requesting appointment backup:', error);
        Alert.alert('Error', error?.message || 'Failed to request backup. Please try again.');
      }
    };

    if (candidates.length === 1) {
      Alert.alert(
        'Request Backup',
        `Notify ${candidates[0].name} for coverage?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Request', style: 'default', onPress: () => submit(candidates[0]) },
        ]
      );
      return;
    }

    Alert.alert(
      'Select Backup Nurse',
      'Choose who to notify for coverage:',
      [
        ...candidates.map((b) => ({
          text: b.name,
          onPress: () => submit(b),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleAccept = async (appointmentId) => {
    try {
      await acceptAppointment(appointmentId);
      
      // Force immediate UI refresh after status change
      setTimeout(() => {
        // Forcing UI refresh after accept
        setRefreshKey(prev => prev + 1);
      }, 50);
      
      Alert.alert('Success', 'Appointment accepted successfully');
    } catch (error) {
      console.error('Error accepting appointment:', error);
      Alert.alert('Error', 'Failed to accept appointment');
    }
  };

  const handleDecline = async (appointmentId) => {
    try {
      await declineAppointment(appointmentId);
      
      // Force immediate UI refresh after status change
      setTimeout(() => {
        // Forcing UI refresh after decline
        setRefreshKey(prev => prev + 1);
      }, 50);
      
      Alert.alert('Success', 'Appointment declined successfully');
    } catch (error) {
      console.error('Error declining appointment:', error);
      Alert.alert('Error', 'Failed to decline appointment');
    }
  };

  // Handle accepting recurring shifts
  const handleAcceptRecurringShift = async (scheduleId) => {
    try {
      // 1. Fetch the shift request to determine the correct nurse key
      const shift = await ApiService.getShiftRequestById(scheduleId);
      
      if (!shift) throw new Error('Shift not found');

      // 2. Find the nurse record for the current user
      const roster = Array.isArray(nurses) ? nurses : [];
      const myUid = String(user?.uid || user?.id || '').trim();
      const myEmail = String(user?.email || '').trim().toLowerCase();

      const myNurseProfile = roster.find((n) => {
        if (!n) return false;
        const nUid = String(n.uid || n.id || n._id || '').trim();
        const nEmail = String(n.email || '').trim().toLowerCase();
        return (myUid && nUid === myUid) || (myEmail && nEmail === myEmail);
      });

      // 3. Determine which key format is used in assignedNurses
      const assignedNurses = Array.isArray(shift.assignedNurses) ? shift.assignedNurses : [];
      const nurseSchedule = (shift?.nurseSchedule && typeof shift.nurseSchedule === 'object') ? shift.nurseSchedule : {};

      // Only consider days that are part of this recurring request.
      // Some records store nurseSchedule for all 7 days with empty values,
      // which can incorrectly block auto-approval after acceptance.
      const toDayNumber = (value) => {
        const n = typeof value === 'string' ? Number(value) : value;
        return Number.isInteger(n) ? n : null;
      };

      const activeDays = Array.from(
        new Set(
          ([]
            .concat(shift?.daysOfWeek || [])
            .concat(shift?.recurringDaysOfWeek || [])
            .concat(shift?.recurringDaysOfWeekList || [])
            .concat(shift?.recurringPattern?.daysOfWeek || [])
            .map(toDayNumber)
            .filter((n) => n !== null && n >= 0 && n <= 6))
        )
      );

      const daysToCheck = (
        nurseSchedule && Object.keys(nurseSchedule).length > 0
          ? (activeDays.length > 0 ? activeDays.map(String) : Object.keys(nurseSchedule))
          : []
      );

      // Check if assignedNurses contains my MongoDB _id or my nurseCode
      let nurseKey = null;
      const myMongoId = myNurseProfile?._id || myNurseProfile?.id;
      const myCode = myNurseProfile?.nurseCode || myNurseProfile?.code || user?.nurseCode || user?.code;

      // Try to find exact match in assignedNurses
      if (myMongoId && assignedNurses.includes(myMongoId)) {
        nurseKey = myMongoId;
      } else if (myCode && assignedNurses.includes(myCode)) {
        nurseKey = myCode;
      } else if (myUid && assignedNurses.includes(myUid)) {
        nurseKey = myUid;
      }

      // Try nurseSchedule values
      if (!nurseKey) {
        const scheduleValues = Object.values(nurseSchedule);
        if (myMongoId && scheduleValues.includes(myMongoId)) {
          nurseKey = myMongoId;
        } else if (myCode && scheduleValues.includes(myCode)) {
          nurseKey = myCode;
        } else if (myUid && scheduleValues.includes(myUid)) {
          nurseKey = myUid;
        }
      }

      // Fallback: use MongoDB ID if available, otherwise nurseCode, otherwise uid
      if (!nurseKey) {
        nurseKey = myMongoId || myCode || myUid;
      }

      if (!nurseKey) {
        throw new Error('Could not determine nurse key for acceptance');
      }

      // 4. Construct update payload
      const nowIso = new Date().toISOString();
      const myCandidateKeys = Array.from(
        new Set([
          nurseKey,
          myMongoId,
          myCode,
          myUid,
          user?.nurseCode,
          user?.code,
        ]
          .filter((v) => v !== null && v !== undefined)
          .map((v) => String(v).trim())
          .filter(Boolean))
      );

      const updatePayload = {};
      for (const key of myCandidateKeys) {
        updatePayload[`nurseResponses.${key}.status`] = 'accepted';
        updatePayload[`nurseResponses.${key}.acceptedAt`] = nowIso;
        updatePayload[`nurseResponses.${key}.nurseId`] = key;
        updatePayload[`nurseResponses.${key}.nurseName`] = getNurseName(user) || 'Nurse';
        updatePayload[`nurseResponses.${key}.uid`] = user?.uid;
        updatePayload[`nurseResponses.${key}.email`] = user?.email;
      }

      // 5. Check if all required nurse keys are accepted to auto-approve
      const nurseResponses = (shift?.nurseResponses && typeof shift.nurseResponses === 'object')
        ? shift.nurseResponses
        : {};

      const normalizeKey = (value) => (value === null || value === undefined ? '' : String(value).trim());
      const upperKey = (value) => normalizeKey(value).toUpperCase();

      const requiredRawKeys = new Set();
      for (const entry of assignedNurses) {
        if (!entry) continue;
        if (typeof entry === 'string') {
          const k = normalizeKey(entry);
          if (k) requiredRawKeys.add(k);
          continue;
        }
        if (typeof entry === 'object') {
          const candidates = [
            entry.nurseKey,
            entry.nurseId,
            entry.uid,
            entry.id,
            entry._id,
            entry.code,
            entry.nurseCode,
            entry.staffCode,
          ];
          candidates.map(normalizeKey).filter(Boolean).forEach((k) => requiredRawKeys.add(k));
        }
      }
      if (daysToCheck.length > 0) {
        daysToCheck.forEach((day) => {
          const k = normalizeKey(nurseSchedule?.[day]);
          if (k) requiredRawKeys.add(k);
        });
      } else {
        Object.values(nurseSchedule).forEach((v) => {
          const k = normalizeKey(v);
          if (k) requiredRawKeys.add(k);
        });
      }

      const hasUnassignedScheduleSlot = (
        daysToCheck.length > 0
          ? daysToCheck.some((day) => !nurseSchedule?.[day])
          : Object.values(nurseSchedule).some((v) => !v)
      );

      // Build accepted lookup, including the keys we're accepting under right now.
      const acceptedKeysUpper = new Set(
        Object.entries(nurseResponses)
          .filter(([_, v]) => String(v?.status || '').toLowerCase() === 'accepted')
          .map(([k]) => upperKey(k))
          .filter(Boolean)
      );
      myCandidateKeys.map(upperKey).filter(Boolean).forEach((k) => acceptedKeysUpper.add(k));

      const keyGroups = [];
      const addGroup = (keys) => {
        const cleaned = (Array.isArray(keys) ? keys : [keys])
          .map(normalizeKey)
          .filter(Boolean);
        if (cleaned.length === 0) return;

        // Merge any overlapping group (case-insensitive)
        let merged = cleaned;
        for (let i = keyGroups.length - 1; i >= 0; i--) {
          const existingSet = new Set(keyGroups[i].map(upperKey).filter(Boolean));
          const overlaps = merged.some((k) => existingSet.has(upperKey(k)));
          if (overlaps) {
            merged = Array.from(new Set([...keyGroups[i], ...merged].map(normalizeKey).filter(Boolean)));
            keyGroups.splice(i, 1);
          }
        }
        keyGroups.push(merged);
      };

      for (const rawKey of requiredRawKeys) {
        const rawUpper = upperKey(rawKey);
        const rosterMatch = roster.find((n) => {
          if (!n) return false;
          const candidates = [
            n.uid,
            n.id,
            n._id,
            n.nurseId,
            n.nurseCode,
            n.staffCode,
            n.code,
            n.username,
          ]
            .map(normalizeKey)
            .filter(Boolean)
            .map(upperKey);
          return candidates.includes(rawUpper);
        });

        if (rosterMatch) {
          addGroup([
            rosterMatch.uid,
            rosterMatch.id,
            rosterMatch._id,
            rosterMatch.nurseId,
            rosterMatch.nurseCode,
            rosterMatch.staffCode,
            rosterMatch.code,
            rosterMatch.username,
            rawKey,
          ]);
        } else {
          addGroup([rawKey]);
        }
      }

      const allAccepted = keyGroups.length > 0 && keyGroups.every((group) => group.some((k) => acceptedKeysUpper.has(upperKey(k))));
      const isSplitSchedule = (
        String(shift?.assignmentType || '').toLowerCase() === 'split-schedule'
      ) || Object.keys(nurseSchedule).length > 0;

      const shouldAutoApprove = !isSplitSchedule
        ? true // Single-nurse recurring shift should move immediately
        : (!hasUnassignedScheduleSlot && allAccepted);

      if (shouldAutoApprove && String(shift?.status || '').toLowerCase() === 'pending') {
        updatePayload.status = 'approved';
        updatePayload.approvedAt = nowIso;
      }

      await ApiService.makeRequest(`/shifts/requests/${scheduleId}/approve`, {
        method: 'PUT',
        body: updatePayload
      });
      
      // Refresh pending recurring shifts
      setRefreshKey(prev => prev + 1);
      Alert.alert('Success', 'Recurring shift accepted');
    } catch (error) {
      console.error('❌ Error accepting recurring shift:', error);
      Alert.alert('Error', 'Failed to accept recurring shift: ' + (error.message || 'Unknown error'));
    }
  };

  // Handle declining recurring shifts
  const handleDeclineRecurringShift = async (scheduleId, reason = '') => {
    try {
      // 1. Fetch the shift to determine the correct nurse keys (mirrors accept flow)
      const shift = await ApiService.getShiftRequestById(scheduleId);
      if (!shift) throw new Error('Shift not found');

      const roster = Array.isArray(nurses) ? nurses : [];
      const myUid = String(user?.uid || user?.id || '').trim();
      const myEmail = String(user?.email || '').trim().toLowerCase();

      const myNurseProfile = roster.find((n) => {
        if (!n) return false;
        const nUid = String(n.uid || n.id || n._id || '').trim();
        const nEmail = String(n.email || '').trim().toLowerCase();
        return (myUid && nUid === myUid) || (myEmail && nEmail === myEmail);
      });

      const myMongoId = myNurseProfile?._id || myNurseProfile?.id;
      const myCode = myNurseProfile?.nurseCode || myNurseProfile?.code || user?.nurseCode || user?.code;

      const myCandidateKeys = Array.from(
        new Set(
          [myMongoId, myCode, myUid, user?.nurseCode, user?.code]
            .filter((v) => v !== null && v !== undefined)
            .map((v) => String(v).trim())
            .filter(Boolean)
        )
      );

      // 2. Build update payload – mark all candidate keys as declined in nurseResponses
      const nowIso = new Date().toISOString();
      const updatePayload = {};
      for (const key of myCandidateKeys) {
        updatePayload[`nurseResponses.${key}.status`] = 'declined';
        updatePayload[`nurseResponses.${key}.declinedAt`] = nowIso;
        updatePayload[`nurseResponses.${key}.nurseId`] = key;
        updatePayload[`nurseResponses.${key}.nurseName`] = getNurseName(user) || 'Nurse';
        updatePayload[`nurseResponses.${key}.uid`] = user?.uid;
        updatePayload[`nurseResponses.${key}.email`] = user?.email;
        if (reason) updatePayload[`nurseResponses.${key}.reason`] = reason;
      }
      updatePayload.reason = reason || 'Declined';

      await ApiService.makeRequest(`/shifts/requests/${scheduleId}/deny`, {
        method: 'PUT',
        body: updatePayload
      });

      // Refresh pending recurring shifts
      setRefreshKey(prev => prev + 1);
      Alert.alert('Success', 'Recurring shift declined');
    } catch (error) {
      console.error('❌ Error declining recurring shift:', error);
      Alert.alert('Error', 'Failed to decline recurring shift');
    }
  };

  const handleComplete = async (appointmentId, notes = '') => {
    try {
      await completeAppointment(appointmentId, notes);
      
      // Force refresh of appointments after completion
      setTimeout(() => {
        setRefreshKey(prev => prev + 1);
      }, 100);
      
      Alert.alert('Success', 'Appointment completed successfully');
    } catch (error) {
      console.error('Error completing appointment:', error);
      Alert.alert('Error', 'Failed to complete appointment');
    }
  };

  // Handle clock in for shifts
  const parseTimeToDateOnDay = (timeValue, baseDate) => {
    if (!timeValue) return null;
    if (timeValue instanceof Date) {
      return Number.isNaN(timeValue.getTime()) ? null : timeValue;
    }

    let raw = String(timeValue).trim();
    if (!raw) return null;

    // Full date/time string
    if (raw.includes('T') || /\d{4}-\d{2}-\d{2}/.test(raw)) {
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    // If a time range or extra text is provided, extract the first time segment.
    if (!/(\d{1,2})(?::\d{2})?\s*(AM|PM)?/i.test(raw)) {
      return null;
    }

    const timeMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (timeMatch && timeMatch[0]) {
      raw = timeMatch[0].trim();
    }

    const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;

    let hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2] || '0', 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (ampm) {
      if (hours === 12) hours = 0;
      if (ampm === 'PM') hours += 12;
    }

    const dt = new Date(baseDate);
    dt.setHours(hours, minutes, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const getShiftScheduledStartDateTime = (shift, now = new Date()) => {
    if (!shift || typeof shift !== 'object') return null;

    const isSplitSchedule = (() => {
      if (String(shift?.assignmentType || '').trim().toLowerCase() === 'split-schedule') return true;
      const schedule = shift?.nurseSchedule;
      return Boolean(schedule && typeof schedule === 'object' && Object.keys(schedule).length > 0);
    })();

    const resolveSplitAssignedDaysForMe = (schedule) => {
      if (!schedule || typeof schedule !== 'object') return [];
      const out = [];
      const dayMap = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
      const pushDayKey = (dayKey) => {
        let idx = null;
        if (typeof dayKey === 'number' && Number.isFinite(dayKey)) {
          idx = ((Math.trunc(dayKey) % 7) + 7) % 7;
        } else {
          const raw = String(dayKey).trim().toLowerCase();
          if (dayMap[raw] != null) {
            idx = dayMap[raw];
          } else {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) idx = ((Math.trunc(parsed) % 7) + 7) % 7;
          }
        }
        if (idx === null) return;
        out.push(idx);
      };

      for (const [dayKey, assignedVal] of Object.entries(schedule)) {
        if (!assignedVal) continue;
        if (!matchesMine(assignedVal)) continue;

        pushDayKey(dayKey);
      }

      // Fallback: if schedule exists but we couldn't match identifiers (data shape varies),
      // use any truthy days from the schedule rather than blocking clock-in.
      if (out.length === 0) {
        for (const [dayKey, assignedVal] of Object.entries(schedule)) {
          if (!assignedVal) continue;
          pushDayKey(dayKey);
        }
      }

      return Array.from(new Set(out)).sort((a, b) => a - b);
    };

    const isAssignedToMeForDate = (dateObj) => {
      if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
      const schedule = shift?.nurseSchedule;
      if (!schedule || typeof schedule !== 'object') return true;
      const dayIdx = dateObj.getDay();
      const numericKey = String(dayIdx);
      const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const textKey = dayKeys[dayIdx];
      const assignedVal = schedule[numericKey] ?? schedule[textKey] ?? schedule[textKey?.toUpperCase?.()] ?? null;
      if (!assignedVal) return false;
      return matchesMine(assignedVal);
    };

    const coerceToDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return Number.isFinite(val.getTime()) ? val : null;
      if (typeof val === 'number') {
        const d = new Date(val);
        return Number.isFinite(d.getTime()) ? d : null;
      }
      if (typeof val === 'string') {
        // Important: date-only strings (YYYY-MM-DD) are parsed as UTC by JS.
        // That can shift the day in local timezones and break periodEnd checks.
        const s = val.trim();
        const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
        return Number.isFinite(d.getTime()) ? d : null;
      }
      if (typeof val === 'object') {
        if (typeof val.toDate === 'function') {
          try {
            const d = val.toDate();
            return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
          } catch (e) {
            // ignore
          }
        }
        const seconds = val.seconds ?? val._seconds;
        if (typeof seconds === 'number') {
          const nanos = val.nanoseconds ?? val._nanoseconds ?? 0;
          const d = new Date(seconds * 1000 + Math.floor(nanos / 1e6));
          return Number.isFinite(d.getTime()) ? d : null;
        }
      }
      return null;
    };

    const normalizeDaysOfWeek = (raw) => {
      const list = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
      const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const out = [];
      for (const item of list) {
        if (item == null) continue;
        if (typeof item === 'number' && Number.isFinite(item)) {
          const v = ((item % 7) + 7) % 7;
          out.push(v);
          continue;
        }
        const s = String(item).trim();
        if (!s) continue;
        const lower = s.toLowerCase();
        if (map[lower] != null) {
          out.push(map[lower]);
          continue;
        }
        const abbrev = lower.slice(0, 3);
        if (map[abbrev] != null) {
          out.push(map[abbrev]);
          continue;
        }
        const asNum = Number(lower);
        if (Number.isFinite(asNum)) {
          const v = ((asNum % 7) + 7) % 7;
          out.push(v);
        }
      }
      return Array.from(new Set(out)).sort((a, b) => a - b);
    };

    const isAdminRecurring = shift?.adminRecurring === true || String(shift?.adminRecurring || '').trim().toLowerCase() === 'true';
    const isPatientRecurring =
      shift?.isRecurring === true ||
      String(shift?.isRecurring || '').trim().toLowerCase() === 'true' ||
      (shift?.recurringSchedule && typeof shift.recurringSchedule === 'object');
    const isAnyRecurring = isAdminRecurring || isPatientRecurring;

    const timeCandidate =
      shift.startTime ||
      shift.time ||
      shift.preferredTime ||
      shift.scheduledTime ||
      shift.scheduledStartTime ||
      shift.appointmentTime ||
      shift.serviceTime ||
      shift.schedule?.startTime ||
      shift.schedule?.time ||
      shift.recurringStartTime ||
      shift.recurringTime ||
      null;

    // If we were given an explicit scheduled datetime, prefer it.
    // (e.g. a concrete appointment occurrence)
    const explicitDateCandidate =
      shift.scheduledDate ||
      shift.date ||
      shift.shiftDate ||
      shift.serviceDate ||
      shift.appointmentDate ||
      shift.schedule?.scheduledDate ||
      shift.schedule?.date ||
      shift.schedule?.appointmentDate ||
      shift.scheduledStartDate ||
      shift.scheduledStart ||
      null;

    const explicitDate = coerceToDate(explicitDateCandidate);

    // Period start/end are for recurring series.
    const periodStart = coerceToDate(
      shift?.startDate ||
      shift?.recurringPeriodStart ||
      shift?.recurringStartDate ||
      shift?.appointmentStartDate ||
      null
    );
    const periodEnd = coerceToDate(
      shift?.endDate ||
      shift?.recurringPeriodEnd ||
      shift?.recurringEndDate ||
      shift?.appointmentEndDate ||
      null
    );

    const parseTime = (t, base) => {
      if (!t) return null;
      // Full datetime (ISO) supplied
      if (typeof t === 'string' && t.includes('T')) {
        const d = new Date(t);
        if (Number.isFinite(d.getTime())) return d;
      }

      const parsed = parseTimeToDateOnDay(t, base || new Date());
      if (parsed) return parsed;

      // Common case in this app: time ranges like "10:40 - 11:00" or "10:40 AM - 11:00 AM".
      // If we can't parse the full string, fall back to the start time.
      if (typeof t === 'string') {
        const raw = t.trim();
        if (!raw) return null;
        const startPart = raw.split('-')[0]?.trim();
        if (startPart) {
          const parsedStart = parseTimeToDateOnDay(startPart, base || new Date());
          if (parsedStart) return parsedStart;
        }

        // Last resort: extract the first HH:MM(+AM/PM) token.
        const token = raw.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i)?.[0];
        if (token) {
          const parsedToken = parseTimeToDateOnDay(token, base || new Date());
          if (parsedToken) return parsedToken;
        }
      }

      return null;
    };

    // If we have an explicit date, combine it with the time (if any) and return.
    if (explicitDate) {
      if (isSplitSchedule && !isAssignedToMeForDate(explicitDate)) {
        return null;
      }
      if (timeCandidate) {
        const t = parseTime(timeCandidate, explicitDate);
        if (!t) return explicitDate;
        const combined = new Date(explicitDate);
        combined.setHours(t.getHours(), t.getMinutes(), 0, 0);
        return Number.isFinite(combined.getTime()) ? combined : explicitDate;
      }
      return explicitDate;
    }

    // Recurring series: compute the next occurrence start (today/next matching weekday).
    if (isAnyRecurring) {
      const normalizeDayKey = (value) => {
        if (value == null) return null;
        if (typeof value === 'string') {
          const raw = value.trim();
          if (!raw) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
          if (/^\d{8}$/.test(raw)) {
            const yyyy = raw.slice(0, 4);
            const mm = raw.slice(4, 6);
            const dd = raw.slice(6, 8);
            return `${yyyy}-${mm}-${dd}`;
          }
          const d = new Date(raw);
          if (!Number.isFinite(d.getTime())) return null;
          const yyyy = String(d.getFullYear());
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          const raw = String(Math.trunc(value));
          if (/^\d{8}$/.test(raw)) {
            const yyyy = raw.slice(0, 4);
            const mm = raw.slice(4, 6);
            const dd = raw.slice(6, 8);
            return `${yyyy}-${mm}-${dd}`;
          }
        }
        if (value instanceof Date && Number.isFinite(value.getTime())) {
          const yyyy = String(value.getFullYear());
          const mm = String(value.getMonth() + 1).padStart(2, '0');
          const dd = String(value.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
        try {
          const d = new Date(value);
          if (!Number.isFinite(d.getTime())) return null;
          const yyyy = String(d.getFullYear());
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        } catch (e) {
          return null;
        }
      };

      const getCompletedDayKeysForCurrentNurse = (shiftLike) => {
        const completed = new Set();
        if (!shiftLike || typeof shiftLike !== 'object') return completed;

        const clockByNurse = shiftLike?.clockByNurse;
        if (clockByNurse && typeof clockByNurse === 'object') {
          for (const [key, entry] of Object.entries(clockByNurse)) {
            if (!entry || typeof entry !== 'object') continue;

            const keyMatches = matchesMine(key);
            const entryId = entry.nurseId || entry.id || entry._id || entry.uid || entry.nurseCode || entry.staffCode || entry.code;
            const entryMatches = entryId ? matchesMine(entryId) : false;
            if (!keyMatches && !entryMatches) continue;

            const sessions = Array.isArray(entry.clockEntries) ? entry.clockEntries : [];
            sessions.forEach((s) => {
              if (!s || typeof s !== 'object') return;
              const hasOut = Boolean(s.clockOutTime || s.actualEndTime || s.completedAt);
              if (!hasOut) return;
              const outKey = normalizeDayKey(s.dayKey || s.clockOutTime || s.actualEndTime || s.completedAt);
              if (outKey) completed.add(outKey);
            });

            const lastOutKey = normalizeDayKey(entry.lastClockOutTime || entry.clockOutTime || entry.actualEndTime || entry.completedAt);
            if (lastOutKey) completed.add(lastOutKey);
          }
        }

        const globalSessions = Array.isArray(shiftLike.clockEntries) ? shiftLike.clockEntries : [];
        globalSessions.forEach((s) => {
          if (!s || typeof s !== 'object') return;
          const sid = s.nurseId || s.id || s._id;
          // Only treat a global session as "mine" when it has an explicit nurse identifier.
          // Otherwise it can incorrectly block other nurses from clocking in.
          if (!sid) return;
          if (!matchesMine(sid)) return;
          const hasOut = Boolean(s.clockOutTime || s.actualEndTime || s.completedAt);
          if (!hasOut) return;
          const outKey = normalizeDayKey(s.dayKey || s.clockOutTime || s.actualEndTime || s.completedAt);
          if (outKey) completed.add(outKey);
        });

        return completed;
      };

      const daysRaw = [
        shift.daysOfWeek,
        shift.recurringDaysOfWeek,
        shift.recurringDaysOfWeekList,
        shift.selectedDays,
        shift.recurringDays,
        shift.recurringPattern?.daysOfWeek,
        shift.recurringPattern?.selectedDays,
        shift.schedule?.daysOfWeek,
        shift.schedule?.selectedDays,
        shift.recurringSchedule?.daysOfWeek,
        shift.recurringSchedule?.selectedDays,
      ]
        .filter(Boolean)
        .flatMap((value) => (Array.isArray(value) ? value : [value]));
      let days = normalizeDaysOfWeek(daysRaw);

      if (isSplitSchedule) {
        const assignedDays = resolveSplitAssignedDaysForMe(shift?.nurseSchedule);
        // For split schedules, only allow clock-in on the days assigned to *this* nurse.
        if (assignedDays.length === 0) return null;
        days = assignedDays;
      }

      const completedDayKeys = getCompletedDayKeysForCurrentNurse(shift);

      const timeParsed = parseTime(timeCandidate, now);
      if (!timeParsed) return null;
      const hours = timeParsed.getHours();
      const minutes = timeParsed.getMinutes();

      if (days.length === 0) return null;

      // Search up to 14 days out to find a valid next occurrence.
      for (let offset = 0; offset <= 14; offset += 1) {
        const candidate = new Date(now);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(hours, minutes, 0, 0);

        const candidateKey = normalizeDayKey(candidate);
        if (candidateKey && completedDayKeys.has(candidateKey)) continue;

        if (!days.includes(candidate.getDay())) continue;
        if (periodStart && candidate < new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate(), 0, 0, 0, 0)) continue;
        if (periodEnd && candidate > new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999)) continue;

        return candidate;
      }

      return null;
    }

    // Non-recurring with only periodStart/startDate: fall back to that day + time.
    const baseDate = coerceToDate(shift.startDate) || periodStart;
    if (baseDate) {
      if (isSplitSchedule && !isAssignedToMeForDate(baseDate)) {
        return null;
      }
      if (timeCandidate) {
        const t = parseTime(timeCandidate, baseDate);
        if (!t) return baseDate;
        const combined = new Date(baseDate);
        combined.setHours(t.getHours(), t.getMinutes(), 0, 0);
        return Number.isFinite(combined.getTime()) ? combined : baseDate;
      }
      return baseDate;
    }

    return null;
  };

  const canClockInForShiftNow = (shift, now = new Date()) => {
    // Check if this is a recurring shift
    const isAdminRecurring = shift?.adminRecurring === true || String(shift?.adminRecurring || '').trim().toLowerCase() === 'true';
    const isPatientRecurring =
      shift?.isRecurring === true ||
      String(shift?.isRecurring || '').trim().toLowerCase() === 'true' ||
      (shift?.recurringSchedule && typeof shift?.recurringSchedule === 'object');
    const isRecurring = isAdminRecurring || isPatientRecurring;

    const scheduled = getShiftScheduledStartDateTime(shift, now);
    if (!scheduled) {
      // For recurring shifts, if no scheduled time found, return false
      if (isRecurring) {
        return false;
      }
      
      // For regular appointments without full datetime, check if current time is past appointment time
      const appointmentTimeStr = shift?.time || shift?.startTime || shift?.appointmentTime;
      const appointmentDateStr = shift?.date || shift?.appointmentDate || shift?.scheduledStartDate;
      
      if (appointmentTimeStr && appointmentDateStr) {
        try {
          // Parse the date - handle both ISO strings and formatted dates
          let appointmentDate;
          if (appointmentDateStr.includes('T')) {
            // ISO date string
            appointmentDate = new Date(appointmentDateStr);
          } else if (appointmentDateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // YYYY-MM-DD format
            appointmentDate = new Date(appointmentDateStr + 'T00:00:00');
          } else {
            // Try parsing formatted dates like "Feb 10, 2026"
            appointmentDate = new Date(appointmentDateStr);
            // If invalid, try to construct from current date
            if (isNaN(appointmentDate.getTime())) {
              appointmentDate = new Date(now);
              appointmentDate.setHours(0, 0, 0, 0);
            }
          }
          
          // Parse the time - handle both 12-hour (with AM/PM) and 24-hour formats
          const timeParts = appointmentTimeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (timeParts && !isNaN(appointmentDate.getTime())) {
            let hours = parseInt(timeParts[1]);
            const minutes = parseInt(timeParts[2]);
            const meridiem = timeParts[3]?.toUpperCase();
            
            // Handle 12-hour format with AM/PM
            if (meridiem) {
              if (meridiem === 'PM' && hours !== 12) hours += 12;
              if (meridiem === 'AM' && hours === 12) hours = 0;
            }
            // For 24-hour format (no meridiem), hours stay as-is
            
            appointmentDate.setHours(hours, minutes, 0, 0);
            return now >= appointmentDate;
          }
        } catch (error) {
          // Silently fail
        }
      }
      return false;
    }
    return now >= scheduled;
  };

  const handleClockIn = async (shift) => {
    try {
      if (!canClockInForShiftNow(shift)) {
        const scheduled = getShiftScheduledStartDateTime(shift);
        Alert.alert(
          'Clock In Not Available Yet',
          scheduled
            ? `You can clock in once your shift starts at ${scheduled.toLocaleTimeString()}.`
            : 'You can clock in once your shift start time is reached.'
        );
        return;
      }

      // Get location permission and current location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to clock in.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      const { latitude, longitude } = location.coords;
      const startTime = new Date().toISOString();
      const locationData = await createLocationPayload(latitude, longitude, startTime);
      
      // Check if nurse is late and notify supervisor
      const scheduledStartTime = getShiftScheduledStartDateTime(shift);
      if (scheduledStartTime) {
        const actualStartTime = new Date(startTime);
        const minutesLate = (actualStartTime - scheduledStartTime) / (1000 * 60);
        
        if (minutesLate >= 10) {
          // Notify supervisor about late clock-in
          try {
            const adminsSnapshot = await getDocs(collection(db, 'admins'));
            const supervisors = adminsSnapshot.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter(admin => {
                const notificationRole = admin.emailNotificationRole?.toLowerCase();
                return notificationRole === 'full_access' || 
                       notificationRole === 'scheduling_only' ||
                       admin.title?.toLowerCase().includes('supervisor') ||
                       admin.title?.toLowerCase().includes('manager');
              });
            
            const nurseName = currentNurse?.name || user?.name || user?.username || 'A nurse';
            const shiftDescription = shift.service || shift.serviceType || 'Shift';
            const minutesLateRounded = Math.round(minutesLate);
            
            for (const supervisor of supervisors) {
              await sendNotificationToUser(
                supervisor.id,
                'Nurse Late Clock-In',
                `${nurseName} clocked in ${minutesLateRounded} minutes late for ${shiftDescription} (scheduled: ${scheduledStartTime.toLocaleTimeString()})`,
                {
                  type: 'late_clock_in',
                  shiftId: shift.id,
                  nurseId: nurseId,
                  nurseName: nurseName,
                  minutesLate: minutesLateRounded,
                  scheduledTime: scheduledStartTime.toISOString(),
                  actualTime: startTime,
                }
              );
            }
          } catch (notificationError) {
            console.error('Failed to notify supervisor about late clock-in:', notificationError);
            // Don't block clock-in if notification fails
          }
        }
      }
      
      const startResult = await startShift(shift.id, startTime, nurseId, { clockInLocation: locationData });
      const resolvedStartTime = startResult?.startTime || startTime;
      const resolvedLocation = startResult?.clockInLocation || locationData;

      setSelectedItemDetails(prev => {
        if (!prev || prev.id !== shift.id) return prev;
        return {
          ...prev,
          status: 'active',
          actualStartTime: resolvedStartTime,
          startedAt: resolvedStartTime,
          clockInLocation: resolvedLocation,
        };
      });

      setActiveShifts(prev => {
        const updatedShift = {
          ...shift,
          status: 'active',
          startedAt: resolvedStartTime,
          actualStartTime: resolvedStartTime,
          clockInLocation: resolvedLocation,
        };
        const exists = prev.some(item => item.id === shift.id);
        return exists
          ? prev.map(item => (item.id === shift.id ? { ...item, ...updatedShift } : item))
          : [...prev, updatedShift];
      });
      
      // Close modal and refresh UI
      setDetailsModalVisible(false);
      setRefreshKey(prev => prev + 1);
      
      // Refresh shift data globally after a brief delay (syncs to admin dashboard)
      setTimeout(() => {
        refreshShiftRequests();
      }, 1000);
      
      Alert.alert(
        'Clock In Successful', 
        `Clocked in at ${new Date(resolvedStartTime).toLocaleTimeString()}`
      );
    } catch (error) {
      console.error('Error clocking in:', error);
      Alert.alert('Error', 'Failed to clock in');
    }
  };

  // Handle clock out for shifts
  // Decide if a shift should return to Booked after clock out
  const shouldKeepBookedAfterClockOut = (shift) => {
    if (!shift) return false;
    const isAdminRecurring = shift?.adminRecurring === true || String(shift?.adminRecurring || '').trim().toLowerCase() === 'true';
    const isPatientRecurring = shift?.isRecurring === true || String(shift?.isRecurring || '').trim().toLowerCase() === 'true' || (shift?.recurringSchedule && typeof shift.recurringSchedule === 'object');
    const isAnyRecurring = isAdminRecurring || isPatientRecurring;
    if (!isAnyRecurring) return false;

    const parseDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return Number.isFinite(d.getTime()) ? d : null;
    };

    // Try multiple possible fields for period start/end
    const periodStart = parseDate(
      shift?.startDate ||
      shift?.recurringPeriodStart ||
      shift?.recurringStartDate ||
      shift?.appointmentStartDate
    );
    const periodEnd = parseDate(
      shift?.endDate ||
      shift?.recurringPeriodEnd ||
      shift?.recurringEndDate ||
      shift?.appointmentEndDate
    );

    const today = new Date();
    const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    // If the period ends today (or already ended), do not keep booked
    if (periodEnd && (sameDay(periodEnd, today) || periodEnd < today)) return false;

    // Otherwise, there may be future occurrences
    return true;
  };

  const handleClockOut = async (shift) => {
    console.log('💰 [Feb13] ===== NURSE CLOCK OUT BUTTON PRESSED =====', {
      shiftId: shift?.id,
      service: shift?.service,
      date: shift?.date,
    });
    
    try {
      // Get location permission and current location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to clock out.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      const { latitude, longitude } = location.coords;
      const endTime = new Date().toISOString();
      const locationData = await createLocationPayload(latitude, longitude, endTime);
      
      // Directly process clock out without modal
      setIsOnShift(false);
      setHasClockOut(true);
      
      try {
        const startTime = new Date(shift.actualStartTime);
        const hoursWorked = ((new Date(endTime) - startTime) / (1000 * 60 * 60)).toFixed(2);
        
        // Complete the shift in ShiftContext with location data
        const keepBookedFlag = shouldKeepBookedAfterClockOut(shift);
        console.log('💰 [Feb13] About to call completeShift with keepBooked:', keepBookedFlag);
        
        const completionResult = await completeShift(
          shift.id,
          endTime,
          hoursWorked,
          '', // No notes
          nurseId,
          { clockOutLocation: locationData, keepBooked: keepBookedFlag }
        );
        const resolvedEndTime = completionResult?.endTime || endTime;
        const resolvedHours = completionResult?.hoursWorked || hoursWorked;
        const resolvedLocation = completionResult?.clockOutLocation || locationData;
        const keptBooked = Boolean(completionResult?.keepBooked);
        const resolvedNotesHistory = Array.isArray(completionResult?.notesHistory)
          ? completionResult.notesHistory
          : shift.notesHistory || [];
        
        // Create completed shift data for appointment creation
        const completedShiftData = {
          ...shift,
          actualEndTime: resolvedEndTime,
          hoursWorked: resolvedHours,
          completedAt: resolvedEndTime,
          completionNotes: '',
          nurseName: getNurseName(user),
          clockOutLocation: resolvedLocation
        };

        // Add the completed shift as an appointment record for patient history
        try {
          await addCompletedAppointmentFromShift(completedShiftData);
        } catch (appointmentError) {
          console.error('Error creating appointment record:', appointmentError);
        }

        // Invoice generation is handled centrally in ShiftContext.completeShift
        // (including split-schedule "generate once after all nurses clock out" gating).
        
        // Refresh shift data globally (syncs to admin dashboard)
        await refreshShiftRequests();
        
        setSelectedItemDetails(prev => {
          if (!prev || prev.id !== shift.id) return prev;
          if (!keptBooked) {
            return {
              ...prev,
              status: 'completed',
              completedAt: resolvedEndTime,
              actualEndTime: resolvedEndTime,
              hoursWorked: resolvedHours,
              completionNotes: '',
              clockOutLocation: resolvedLocation,
              notesHistory: resolvedNotesHistory,
              isShiftRequest: true, // Preserve shift request flag
              isShift: true, // Preserve shift flag
            };
          }

          return {
            ...prev,
            status: 'approved',
            lastCompletedAt: resolvedEndTime,
            lastActualEndTime: resolvedEndTime,
            lastHoursWorked: resolvedHours,
            lastCompletionNotes: '',
            lastClockOutLocation: resolvedLocation,
            notesHistory: resolvedNotesHistory,
            actualStartTime: null,
            startedAt: null,
            actualEndTime: null,
            completedAt: null,
            clockInLocation: null,
            clockOutLocation: null,
            isShiftRequest: true, // Preserve shift request flag
            isShift: true, // Preserve shift flag
          };
        });

        // Remove from local active shifts list to prevent lingering in Active UI
        setActiveShifts(prev => (Array.isArray(prev) ? prev.filter((s) => s?.id !== shift.id) : []));
        
        // Close modal and refresh UI
        setDetailsModalVisible(false);
        setRefreshKey(prev => prev + 1);

        if (keptBooked) {
          setSelectedCard('booked');
        }
        
        const locationLabel = getLocationDisplayText(resolvedLocation) || 'Location unavailable';
        Alert.alert(
          'Clock Out Successful',
          keptBooked
            ? `Clocked out at ${new Date(resolvedEndTime).toLocaleTimeString()}\nLocation: ${locationLabel}\nVisit saved. This shift is now back in your Booked tab for the next occurrence.\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.`
            : `Clocked out at ${new Date(resolvedEndTime).toLocaleTimeString()}\nLocation: ${locationLabel}\nThis was the final scheduled shift. The recurring assignment is now completed.\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.`
        );
      } catch (error) {
        console.error('Error completing clock out:', error);
        Alert.alert('Error', 'Failed to complete clock out');
      }
      
    } catch (error) {
      console.error('Error getting location for clock out:', error);
      Alert.alert('Error', 'Failed to get location for clock out');
    }
  };

  const handleAppointmentClockIn = async (appointment) => {
    try {
      if (!canClockInForShiftNow(appointment)) {
        const scheduled = getShiftScheduledStartDateTime(appointment);
        Alert.alert(
          'Clock In Not Available Yet',
          scheduled
            ? `You can clock in once your appointment starts at ${scheduled.toLocaleTimeString()}.`
            : 'You can clock in once your appointment start time is reached.'
        );
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to clock in.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const startTime = new Date().toISOString();
      const { latitude, longitude } = location.coords;
      const locationData = await createLocationPayload(latitude, longitude, startTime);

      // Check if nurse is late and notify supervisor
      const scheduledStartTime = getShiftScheduledStartDateTime(appointment);
      if (scheduledStartTime) {
        const actualStartTime = new Date(startTime);
        const minutesLate = (actualStartTime - scheduledStartTime) / (1000 * 60);
        
        if (minutesLate >= 10) {
          // Notify supervisor about late clock-in
          try {
            const adminsSnapshot = await getDocs(collection(db, 'admins'));
            const supervisors = adminsSnapshot.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter(admin => {
                const notificationRole = admin.emailNotificationRole?.toLowerCase();
                return notificationRole === 'full_access' || 
                       notificationRole === 'scheduling_only' ||
                       admin.title?.toLowerCase().includes('supervisor') ||
                       admin.title?.toLowerCase().includes('manager');
              });
            
            const nurseName = currentNurse?.name || user?.name || user?.username || 'A nurse';
            const appointmentDescription = appointment.service || appointment.serviceType || 'Appointment';
            const patientName = appointment.patientName || appointment.clientName || '';
            const fullDescription = patientName ? `${appointmentDescription} with ${patientName}` : appointmentDescription;
            const minutesLateRounded = Math.round(minutesLate);
            
            for (const supervisor of supervisors) {
              await sendNotificationToUser(
                supervisor.id,
                'Nurse Late Clock-In',
                `${nurseName} clocked in ${minutesLateRounded} minutes late for ${fullDescription} (scheduled: ${scheduledStartTime.toLocaleTimeString()})`,
                {
                  type: 'late_clock_in',
                  appointmentId: appointment.id,
                  nurseId: nurseId,
                  nurseName: nurseName,
                  minutesLate: minutesLateRounded,
                  scheduledTime: scheduledStartTime.toISOString(),
                  actualTime: startTime,
                }
              );
            }
          } catch (notificationError) {
            console.error('Failed to notify supervisor about late clock-in:', notificationError);
            // Don't block clock-in if notification fails
          }
        }
      }

      await clockInAppointment(appointment.id, {
        startTime,
        clockInLocation: locationData,
      });

      setSelectedItemDetails(prev => {
        if (!prev || prev.id !== appointment.id) return prev;
        return {
          ...prev,
          status: 'clocked-in',
          actualStartTime: startTime,
          clockInLocation: locationData,
        };
      });

      // Close modal after successful clock in
      setDetailsModalVisible(false);
      setRefreshKey(prev => prev + 1);

      const locationLabel = getLocationDisplayText(locationData) || 'Location unavailable';
      Alert.alert(
        'Clock In Successful',
        `Clocked in at ${new Date(startTime).toLocaleTimeString()}` +
        `\nLocation: ${locationLabel}`
      );
    } catch (error) {
      console.error('Error clocking in appointment:', error);
      Alert.alert('Error', 'Failed to clock in for this appointment');
    }
  };

  const handleAppointmentClockOut = async (appointment) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to clock out.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const endTime = new Date().toISOString();
      const { latitude, longitude } = location.coords;
      const locationData = await createLocationPayload(latitude, longitude, endTime);

      const derivedStartTime = appointment.actualStartTime ||
        (appointment.date && appointment.time
          ? new Date(`${appointment.date}T${appointment.time}`).toISOString()
          : new Date().toISOString());

      // Directly process clock out without modal
      setIsOnShift(false);
      setHasClockOut(true);
      
      try {
        const startTimeISO = derivedStartTime;
        const hoursWorkedValue = Math.max(
          (new Date(endTime) - new Date(startTimeISO)) / (1000 * 60 * 60),
          0
        ).toFixed(2);

        await completeAppointment(appointment.id, '', {
          actualEndTime: endTime,
          actualStartTime: startTimeISO,
          hoursWorked: hoursWorkedValue,
          clockOutLocation: locationData,
        });

        setSelectedItemDetails(prev => {
          if (!prev || prev.id !== appointment.id) return prev;
          return {
            ...prev,
            status: 'completed',
            actualStartTime: startTimeISO,
            actualEndTime: endTime,
            hoursWorked: hoursWorkedValue,
            completionNotes: '',
            nurseNotes: '',
            clockOutLocation: locationData,
          };
        });

        setDetailsModalVisible(false);
        setRefreshKey(prev => prev + 1);

        const locationLabel = getLocationDisplayText(locationData) || 'Location unavailable';
        Alert.alert(
          'Clock Out Successful',
          `Clocked out at ${new Date(endTime).toLocaleTimeString()}\nLocation: ${locationLabel}\n\nNote: Please toggle off Active so you don’t show as available on the admin portal for appointments.`
        );
      } catch (error) {
        console.error('Error completing appointment clock out:', error);
        Alert.alert('Error', 'Failed to complete appointment');
      }
    } catch (error) {
      console.error('Error preparing appointment clock out:', error);
      Alert.alert('Error', 'Failed to get location for clock out.');
    }
  };

  // Get approved shifts for current nurse (use useMemo to update when context changes)
  const approvedShifts = React.useMemo(
    () => getApprovedShiftsByNurse(nurseId),
    [nurseId, getApprovedShiftsByNurse, shiftRequests]
  );

  // Get unique clients from both database and appointments data
  const getAllClients = () => {
    // Use clientsList which now includes all patients from database
    return clientsList.filter(client => client.name && client.name !== 'Unknown Client');
  };

  // Filter clients based on search text
  useEffect(() => {
    if (clientSearchText.trim() === '') {
      setFilteredClients([]);
      setShowClientDropdown(false);
    } else {
      const allClients = getAllClients();
      const needle = clientSearchText.toLowerCase();
      const filtered = allClients.filter(client => {
        const safeName = (client.name || client.fullName || '').toLowerCase();
        const safeEmail = (client.email || client.contactEmail || '').toLowerCase();
        const safePhone = (client.phone || client.contactNumber || '').toString();
        return (
          (safeName && safeName.includes(needle)) ||
          (safeEmail && safeEmail.includes(needle)) ||
          (safePhone && safePhone.includes(clientSearchText))
        );
      });
      setFilteredClients(filtered);
      setShowClientDropdown(filtered.length > 0);
    }
  }, [clientSearchText, appointments]);

  // Determine which appointments to display based on selected card
  const getDisplayedAppointments = () => {
    if (!selectedCard) return [];
    
    // Helper function to deduplicate items by ID
    const deduplicateByID = (items) => {
      const seen = new Map();
      const result = [];
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.set(item.id, true);
          result.push(item);
        } else {
          // Log duplicates for debugging

        }
      }
      return result;
    };
    
    switch (selectedCard) {
      case 'active':
        // Show both regular active appointments and active shifts (from nurseShiftRequests with status='active')
        // BUT: Filter out shifts from appointments if they already appear in shift requests to avoid duplicates
        const filteredActiveAppts = activeAppointments.filter(apt => 
          !activeShiftsFromRequests.some(shift => shift.id === apt.id)
        );
        // IMPORTANT: Deduplicate activeAppointments FIRST before combining with shifts
        const deduplicatedActiveAppts = deduplicateByID(filteredActiveAppts);
        // Include locally-tracked active shifts for immediate UI updates after clock-in.
        const activeItems = deduplicateByID([
          ...deduplicatedActiveAppts,
          ...(Array.isArray(activeShifts) ? activeShifts : []),
          ...activeShiftsFromRequests,
          ...activeRecurringShifts,
        ]);
        // Active items ready
        return activeItems;
      case 'pending':
        // Show pending assignments (admin-assigned appointments), pending shift requests AND pending recurring shifts sent by admin
        // Deduplicate by ID to avoid showing same item twice
        const allPendingItems = [
          ...pendingAssignments,
          ...pendingCoverageAppointmentsForMe,
          ...pendingShiftRequests,
          ...pendingRecurringShifts,
        ];
        const pendingItems = deduplicateByID(allPendingItems);
        return pendingItems;
      case 'completed':
        // Show both regular completed appointments and completed shifts (from nurseShiftRequests with status='completed')
        // BUT: Filter out shifts from appointments if they already appear in shift requests to avoid duplicates
        const filteredCompletedAppts = completedAppointments.filter(apt => 
          !completedShiftsFromRequests.some(shift => shift.id === apt.id)
        );
        // IMPORTANT: Deduplicate completedAppointments FIRST before combining with shifts
        const deduplicatedCompletedAppts = deduplicateByID(filteredCompletedAppts);
        const completedItems = deduplicateByID([...deduplicatedCompletedAppts, ...completedShiftsFromRequests, ...completedRecurringShifts]);
        // Completed items ready
        return completedItems;
      case 'booked':
        // Show confirmed appointments (booked) and approved shifts that haven't been started yet
        const getAnyId = (item) => item?.id || item?._id || null;
        const activeLocalIds = new Set((Array.isArray(activeShifts) ? activeShifts : []).map(getAnyId).filter(Boolean));
        const filteredApprovedShifts = approvedShifts.filter((shift) => {
          // Recurring requests must stay Pending until nurse accepts.
          // Once accepted, they are surfaced via acceptedRecurringShifts instead.
          const isAnyRecurring =
            shift?.adminRecurring === true ||
            String(shift?.adminRecurring || '').trim().toLowerCase() === 'true' ||
            shift?.isRecurring === true ||
            String(shift?.isRecurring || '').trim().toLowerCase() === 'true' ||
            (shift?.recurringSchedule && typeof shift.recurringSchedule === 'object') ||
            (shift?.recurringPattern && typeof shift.recurringPattern === 'object');
          if (isAnyRecurring) return false;

          const shiftId = getAnyId(shift);
          return (
            !activeLocalIds.has(shiftId) &&
            !activeShiftsFromRequests.find((active) => getAnyId(active) === shiftId) &&
            !completedShiftsFromRequests.find((completed) => getAnyId(completed) === shiftId) &&
            !isClockedInForMe(shift)
          );
        });
        
        // Include confirmed appointments (status='confirmed') and approved recurring shifts
        const activeRecurringIds = new Set((activeRecurringShifts || []).map(s => s?.id).filter(Boolean));
        const completedRecurringIds = new Set((completedRecurringShifts || []).map(s => s?.id).filter(Boolean));
        
        // Helper to check if nurse has clocked out for a shift
        const hasClockOut = (shift) => {
          const clockByNurse = shift?.clockByNurse;
          if (!clockByNurse || typeof clockByNurse !== 'object') return false;
          
          for (const [key, entry] of Object.entries(clockByNurse)) {
            if (!entry || typeof entry !== 'object') continue;
            
            // Check if this entry belongs to current nurse
            const isMyEntry = matchesMine(key) || (entry.nurseId && matchesMine(entry.nurseId));
            if (!isMyEntry) continue;
            
            // Check if there's a clock-out time
            const hasOutTime = Boolean(
              entry.lastClockOutTime ||
              entry.clockOutTime ||
              entry.completedAt ||
              entry.actualEndTime
            );
            
            if (hasOutTime) return true;
          }
          return false;
        };
        
        const filteredAcceptedRecurring = (acceptedRecurringShifts || []).filter((s) => {
          const id = getAnyId(s);
          // Exclude if active, completed, or if the nurse has already clocked out
          return !activeRecurringIds.has(id) && !activeLocalIds.has(id) && !completedRecurringIds.has(id) && !hasClockOut(s);
        });
        const bookedItems = deduplicateByID([...bookedAppointments, ...filteredApprovedShifts, ...filteredAcceptedRecurring]);
        
        // DEV: Debug tab classification for test shift
        if (__DEV__) {
          const debugShiftId = 'IFUO3HmNuZ5sO74KFQGb';
          const inBooked = bookedItems.some(s => (s?.id || s?._id) === debugShiftId);
          const inActive = activeRecurringShifts.some(s => (s?.id || s?._id) === debugShiftId);
          const inCompleted = completedRecurringShifts.some(s => (s?.id || s?._id) === debugShiftId);
          
          if (inBooked || inActive || inCompleted) {
            console.log('[Tab Classification][DEBUG]', {
              shiftId: debugShiftId,
              appearsIn: {
                booked: inBooked,
                active: inActive,
                completed: inCompleted,
              },
              bookedCount: bookedItems.length,
              activeRecurringCount: activeRecurringShifts.length,
              completedRecurringCount: completedRecurringShifts.length,
            });
          }
        }
        
        // Booked items ready
        return bookedItems;
      default:
        return [];
    }
  };

  const displayedAppointments = getDisplayedAppointments();

  const sortedDisplayedAppointments = React.useMemo(() => {
    const items = Array.isArray(displayedAppointments) ? [...displayedAppointments] : [];
    if (selectedCard !== 'completed') return items;

    const resolveLatestCompletionFromClockByNurse = (item) => {
      const map = item?.clockByNurse;
      if (!map || typeof map !== 'object') return null;

      let latest = null;
      let latestMs = -Infinity;
      for (const entry of Object.values(map)) {
        if (!entry || typeof entry !== 'object') continue;
        const time =
          entry.lastClockOutTime ||
          entry.actualEndTime ||
          entry.clockOutTime ||
          entry.completedAt ||
          null;
        if (!time) continue;
        const ms = Date.parse(time);
        if (Number.isFinite(ms) && ms > latestMs) {
          latestMs = ms;
          latest = time;
        }
      }
      return latest;
    };

    const toMs = (value) => {
      if (!value) return -Infinity;
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) return ms;
      const d = new Date(value);
      return Number.isFinite(d.getTime()) ? d.getTime() : -Infinity;
    };

    const getCompletionMs = (item) => {
      if (!item) return -Infinity;
      const candidates = [
        item?.actualEndTime,
        item?.completedAt,
        item?.clockOutTime,
        item?.lastClockOutTime,
        resolveLatestCompletionFromClockByNurse(item),
        item?.updatedAt,
        item?.createdAt,
      ];
      let best = -Infinity;
      for (const c of candidates) {
        const ms = toMs(c);
        if (ms > best) best = ms;
      }
      return best;
    };

    items.sort((a, b) => getCompletionMs(b) - getCompletionMs(a));
    return items;
  }, [displayedAppointments, matchesMine, selectedCard]);

  // Debug log for displayed appointments
  useEffect(() => {
    if (displayedAppointments.length > 0) {
      const idCounts = {};
      displayedAppointments.forEach(item => {
        idCounts[item.id] = (idCounts[item.id] || 0) + 1;
      });
      const duplicateIds = Object.entries(idCounts).filter(([id, count]) => count > 1);
      if (duplicateIds.length > 0) {
        // Duplicates found - should not happen
      } else {
        // No duplicates
      }
    }
  }, [displayedAppointments, selectedCard]);

  useEffect(() => {
    let isCancelled = false;

    const syncAppointmentReminders = async () => {
      if (!user?.id) {
        await cancelAllReminderEntries();
        return;
      }

      if (!Array.isArray(appointments) || appointments.length === 0) {
        await cancelAllReminderEntries();
        return;
      }

      const hasPermission = await ensureNotificationPermission();
      if (!hasPermission || isCancelled) {
        return;
      }

      const now = new Date();
      const trackedIds = new Set();

      for (const appointment of appointments) {
        if (isCancelled) {
          break;
        }

        const appointmentId = getAppointmentIdentifier(appointment);
        if (!appointmentId) {
          continue;
        }

        if (isShiftLikeAppointment(appointment)) {
          await cancelAllRemindersForAppointment(appointmentId);
          continue;
        }

        const normalizedStatus = (appointment.status || '').toLowerCase();
        if (!REMINDER_ELIGIBLE_STATUSES.has(normalizedStatus)) {
          await cancelAllRemindersForAppointment(appointmentId);
          continue;
        }

        trackedIds.add(appointmentId);

        await manageReminderForAction(appointment, 'clockin', now);
        await manageReminderForAction(appointment, 'clockout', now);
      }

      if (isCancelled) {
        return;
      }

      for (const storedId of Object.keys(appointmentRemindersRef.current)) {
        if (isCancelled) {
          break;
        }
        if (!trackedIds.has(storedId)) {
          await cancelAllRemindersForAppointment(storedId);
        }
      }
    };

    syncAppointmentReminders();

    return () => {
      isCancelled = true;
    };
  }, [
    appointments,
    user?.id,
    ensureNotificationPermission,
    manageReminderForAction,
    cancelAllRemindersForAppointment,
    cancelAllReminderEntries,
  ]);

  useEffect(() => {
    let isCancelled = false;

    const syncShiftReminders = async () => {
      if (!user?.id) {
        await cancelAllShiftReminderEntries();
        return;
      }

      if (!Array.isArray(nurseShiftRequests) || nurseShiftRequests.length === 0) {
        await cancelAllShiftReminderEntries();
        return;
      }

      const hasPermission = await ensureNotificationPermission();
      if (!hasPermission || isCancelled) {
        return;
      }

      const now = new Date();
      const trackedIds = new Set();

      const isAssignedToMe = (shift) => {
        if (!shift || typeof shift !== 'object') return false;

        const directCandidates = [
          shift.nurseId,
          shift.primaryNurseId,
          shift.assignedNurseId,
          shift.assignedNurse,
          shift.assignedNurseCode,
          shift.assignedNurseStaffCode,
          shift.nurseCode,
          shift.staffCode,
        ].filter(Boolean);

        if (directCandidates.some((c) => matchesMine(c))) return true;

        const assigned = Array.isArray(shift.assignedNurses) ? shift.assignedNurses : [];
        if (assigned.some((entry) => matchesMine(entry))) return true;

        // Array of objects (split schedule)
        if (assigned.some((entry) => {
          if (!entry || typeof entry !== 'object') return false;
          const entryId = entry.nurseId || entry._id || entry.id || entry.uid;
          const entryCode = entry.staffCode || entry.nurseCode || entry.code || entry.username;
          return matchesMine(entryId) || matchesMine(entryCode);
        })) {
          return true;
        }

        // nurseSchedule mapping sometimes used for split schedule
        const schedule = shift.nurseSchedule;
        if (schedule && typeof schedule === 'object') {
          try {
            return Object.values(schedule).some((assignedVal) => matchesMine(assignedVal));
          } catch (e) {
            return false;
          }
        }

        return false;
      };

      for (const shift of nurseShiftRequests) {
        if (isCancelled) break;
        const shiftId = getShiftIdentifier(shift);
        if (!shiftId) continue;

        const statusNormalized = String(shift?.status || '').trim().toLowerCase();
        if (statusNormalized === 'completed') {
          await cancelAllRemindersForShift(shiftId);
          continue;
        }

        const eligibleStatus = SHIFT_REMINDER_ELIGIBLE_STATUSES.has(statusNormalized);
        const accepted = getMyResponseStatusForShiftRequest(shift) === 'accepted';
        const assigned = isAssignedToMe(shift);
        const clockedIn = isClockedInForMe(shift);

        // Only schedule for shifts I am actually working (assigned/accepted/clocked-in)
        if (!eligibleStatus || (!assigned && !accepted && !clockedIn)) {
          await cancelAllRemindersForShift(shiftId);
          continue;
        }

        trackedIds.add(shiftId);
        await manageShiftReminderForAction(shift, 'clockin', now);
        await manageShiftReminderForAction(shift, 'clockout', now);
      }

      if (isCancelled) return;

      for (const storedId of Object.keys(shiftRemindersRef.current)) {
        if (isCancelled) break;
        if (!trackedIds.has(storedId)) {
          await cancelAllRemindersForShift(storedId);
        }
      }
    };

    syncShiftReminders();

    return () => {
      isCancelled = true;
    };
  }, [
    nurseShiftRequests,
    user?.id,
    ensureNotificationPermission,
    cancelAllShiftReminderEntries,
    cancelAllRemindersForShift,
    manageShiftReminderForAction,
    matchesMine,
    getMyResponseStatusForShiftRequest,
    isClockedInForMe,
  ]);

  // Sync selectedItemDetails when appointments/shifts data changes to ensure notes are updated
  useEffect(() => {
    if (selectedItemDetails && detailsModalVisible) {
      const latestAppointment = appointments.find(apt => apt.id === selectedItemDetails.id);
      const latestShift = shiftRequests.find(shift => shift.id === selectedItemDetails.id);
      const latestItem = latestAppointment || latestShift;
      
      if (latestItem) {
        // Merge carefully: avoid overwriting a freshly-saved local note/photos
        // with stale context data (which can happen before refresh finishes).
        const toMillis = (value) => {
          if (!value) return null;
          const dt = value instanceof Date ? value : new Date(value);
          const ms = dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.getTime() : null;
          return ms;
        };

        setSelectedItemDetails((prev) => {
          if (!prev) return prev;

          const prevUpdatedMs = toMillis(prev.updatedAt || prev.assignedAt || prev.createdAt);
          const latestUpdatedMs = toMillis(latestItem.updatedAt || latestItem.assignedAt || latestItem.createdAt);
          const isLatestNewer =
            typeof latestUpdatedMs === 'number' &&
            (typeof prevUpdatedMs !== 'number' || latestUpdatedMs > prevUpdatedMs);

          const pickText = (field) => {
            const prevValue = typeof prev?.[field] === 'string' ? prev[field] : '';
            const latestValue = typeof latestItem?.[field] === 'string' ? latestItem[field] : '';

            if (isLatestNewer) {
              return latestValue || prevValue;
            }

            // Prefer local value unless it's empty.
            return prevValue || latestValue;
          };

          const sanitizeUrls = (value) =>
            (Array.isArray(value) ? value : [])
              .filter((u) => typeof u === 'string' && u.trim().length > 0);

          const prevPhotos = sanitizeUrls(prev?.nurseNotePhotos);
          const latestPhotos = sanitizeUrls(latestItem?.nurseNotePhotos);
          const mergedPhotos = isLatestNewer
            ? (latestPhotos.length ? latestPhotos : prevPhotos)
            : (prevPhotos.length ? prevPhotos : latestPhotos);

          return {
            ...prev,
            notes: pickText('notes'),
            nurseNotes: pickText('nurseNotes'),
            completionNotes: pickText('completionNotes'),
            nurseNotePhotos: mergedPhotos,
            updatedAt: isLatestNewer ? (latestItem.updatedAt || prev.updatedAt) : prev.updatedAt,
          };
        });
      }
    }
  }, [appointments, shiftRequests, selectedItemDetails?.id, detailsModalVisible]);

  // Handle notes update from RecurringShiftDetailsModal
  const handleRecurringShiftNotesUpdate = (updatedNotes, options = {}) => {
    const resolvedClockKey = options?.clockKey ? String(options.clockKey) : String(nurseId);
    const resolvedNurseId = options?.nurseId ? String(options.nurseId) : String(nurseId);
    const resolvedNurseCode = options?.nurseCode ? String(options.nurseCode) : null;
    const containerKeys = Array.isArray(options?.containerKeys) ? options.containerKeys : [];
    const resolvedUpdatedAt = options?.updatedAt ? String(options.updatedAt) : null;
    const forceClockByNurse = Boolean(options?.forceClockByNurse);

    const isSplitScheduleShift = (shiftDoc) => {
      if (!shiftDoc) return false;
      if (String(shiftDoc?.assignmentType || '').toLowerCase() === 'split-schedule') return true;
      const serviceText = String(shiftDoc?.service || '').toLowerCase();
      if (serviceText.includes('split schedule')) return true;
      const schedule = shiftDoc?.nurseSchedule;
      if (schedule && typeof schedule === 'object' && Object.keys(schedule).length > 0) return true;
      const assigned = Array.isArray(shiftDoc?.assignedNurses) ? shiftDoc.assignedNurses : [];
      if (assigned.length > 1) return true;
      return false;
    };

    // Update the selected shift object to ensure notes persist when modal reopens
    if (selectedRecurringShift) {
      const splitSchedule = isSplitScheduleShift(selectedRecurringShift);

      const shouldWriteClockByNurse = splitSchedule || forceClockByNurse;

      const updatedShift = (() => {
        const base = { ...selectedRecurringShift, notes: updatedNotes, nurseNotes: updatedNotes };
        if (!shouldWriteClockByNurse) return base;

        const existingClockByNurse =
          base?.clockByNurse && typeof base.clockByNurse === 'object' ? base.clockByNurse : {};
        const nextClockByNurse = { ...existingClockByNurse };
        const existingEntry =
          nextClockByNurse?.[resolvedClockKey] && typeof nextClockByNurse[resolvedClockKey] === 'object'
            ? nextClockByNurse[resolvedClockKey]
            : {};

        nextClockByNurse[resolvedClockKey] = {
          ...existingEntry,
          nurseNotes: updatedNotes,
          nurseId: resolvedNurseId,
          ...(resolvedNurseCode ? { nurseCode: resolvedNurseCode } : null),
          ...(resolvedUpdatedAt ? { nurseNotesUpdatedAt: resolvedUpdatedAt } : null),
        };

        return {
          ...base,
          clockByNurse: nextClockByNurse,
        };
      })();

      if (shouldWriteClockByNurse && containerKeys.length > 0) {
        const withWrappers = { ...updatedShift };
        containerKeys.forEach((containerKey) => {
          const container = withWrappers?.[containerKey];
          if (!container || typeof container !== 'object') return;
          const existingMap =
            container?.clockByNurse && typeof container.clockByNurse === 'object' ? container.clockByNurse : {};
          const nextMap = { ...existingMap };
          const existingEntry =
            nextMap?.[resolvedClockKey] && typeof nextMap[resolvedClockKey] === 'object'
              ? nextMap[resolvedClockKey]
              : {};
          nextMap[resolvedClockKey] = {
            ...existingEntry,
            nurseNotes: updatedNotes,
            nurseId: resolvedNurseId,
            ...(resolvedNurseCode ? { nurseCode: resolvedNurseCode } : null),
            ...(resolvedUpdatedAt ? { nurseNotesUpdatedAt: resolvedUpdatedAt } : null),
          };
          withWrappers[containerKey] = {
            ...container,
            clockByNurse: nextMap,
          };
        });
        setSelectedRecurringShift(withWrappers);
      } else {
        setSelectedRecurringShift(updatedShift);
      }
      
      // Also update the pending list so the change persists across modal open/close
      setPendingRecurringShifts(prev => 
        prev.map(item => 
          item.id === updatedShift.id
            ? ((isSplitScheduleShift(item) || forceClockByNurse)
                ? (() => {
                    const base = { ...item };
                    const existingClockByNurse =
                      base?.clockByNurse && typeof base.clockByNurse === 'object' ? base.clockByNurse : {};
                    const nextClockByNurse = { ...existingClockByNurse };
                    const existingEntry =
                      nextClockByNurse?.[resolvedClockKey] && typeof nextClockByNurse[resolvedClockKey] === 'object'
                        ? nextClockByNurse[resolvedClockKey]
                        : {};
                    nextClockByNurse[resolvedClockKey] = {
                      ...existingEntry,
                      nurseNotes: updatedNotes,
                      nurseId: resolvedNurseId,
                      ...(resolvedNurseCode ? { nurseCode: resolvedNurseCode } : null),
                      ...(resolvedUpdatedAt ? { nurseNotesUpdatedAt: resolvedUpdatedAt } : null),
                    };
                    const nextBase = { ...base, clockByNurse: nextClockByNurse };

                    if (containerKeys.length > 0) {
                      containerKeys.forEach((containerKey) => {
                        const container = nextBase?.[containerKey];
                        if (!container || typeof container !== 'object') return;
                        const existingMap =
                          container?.clockByNurse && typeof container.clockByNurse === 'object' ? container.clockByNurse : {};
                        const nextMap = { ...existingMap };
                        const existingWrappedEntry =
                          nextMap?.[resolvedClockKey] && typeof nextMap[resolvedClockKey] === 'object'
                            ? nextMap[resolvedClockKey]
                            : {};
                        nextMap[resolvedClockKey] = {
                          ...existingWrappedEntry,
                          nurseNotes: updatedNotes,
                          nurseId: resolvedNurseId,
                          ...(resolvedNurseCode ? { nurseCode: resolvedNurseCode } : null),
                          ...(resolvedUpdatedAt ? { nurseNotesUpdatedAt: resolvedUpdatedAt } : null),
                        };
                        nextBase[containerKey] = { ...container, clockByNurse: nextMap };
                      });
                    }

                    return nextBase;
                  })()
                : { ...item, notes: updatedNotes, nurseNotes: updatedNotes })
            : item
        )
      );
      
      // Update any other references to ensure complete state consistency
      // Update the shift requests if this shift exists there
      if (shiftRequests) {
        const updatedRequests = shiftRequests.map(req =>
          req.id === updatedShift.id ? { ...req, notes: updatedNotes } : req
        );
        // We can't directly update shiftRequests since it comes from context,
        // but we can refresh to get the latest data from server
      }
      
      // Trigger background refresh to sync with server
      // Use a small delay to avoid race conditions
      setTimeout(() => {
        refreshShiftRequests();
      }, 500);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    
    try {
      // Refresh shift data from context
      await refreshShiftRequests();
      
      // Check for approved shifts immediately
      const actualUserId = user?.id;
      const nurseId = actualUserId === 'nurse-001' ? 'NURSE001' : actualUserId;
      if (!nurseId) return;
      
      const approvedShifts = getApprovedShiftsByNurse(nurseId);
      setHasApprovedShift(approvedShifts.length > 0);
      
      // Manual refresh completed
      
      // Force UI refresh
      setRefreshKey(prev => prev + 1);
      
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Debug logging for shift requests
  useEffect(() => {
    if (shiftRequests.length > 0) {
      // DEBUG: NurseAppointmentsScreen - Shift Requests Check
      // User ID
      // Calculated Nurse ID
      // Total Shift Requests in Context
      
      // Log first few requests to check structure
      if (shiftRequests.length > 0) {
        // Sample Request
      }
      
      const filtered = getShiftRequestsByNurse(nurseId);
      // Filtered Requests for this nurse
      
      const pending = filtered.filter(r => r.status === 'pending');
      // Pending Requests for this nurse
    }
  }, [shiftRequests, user?.id, nurseId]);

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <AppOnboarding
        visible={showOnboarding}
        userRole="nurse"
        onComplete={() => setShowOnboarding(false)}
      />

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
        pointerEvents="none"
        accessible={false}
      />
      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <LinearGradient
          colors={GRADIENTS.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerRow}>
            <TouchableWeb 
              onPress={() => navigation.navigate('Notifications')}
              style={styles.iconButton}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="bell-outline" size={24} color={COLORS.white} />
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableWeb>

            <Text style={styles.welcomeText}>My Appointments</Text>

            <View style={styles.headerRightButtons}>
              <TouchableWeb 
                onPress={() => navigation.navigate('Profile')}
                style={styles.iconButton}
                activeOpacity={0.7}
              >
              {user?.profilePhoto ? (
                <Image 
                  source={{ uri: user.profilePhoto }} 
                  style={styles.headerProfileImage}
                />
              ) : (
                <MaterialCommunityIcons name="account-circle-outline" size={24} color={COLORS.white} />
              )}
            </TouchableWeb>
            </View>
          </View>

          <View style={styles.availabilityToggle}>
            <Text style={styles.availabilityLabel}>Available</Text>
            <Switch
              value={isAvailable}
              onValueChange={handleAvailabilityToggle}
              trackColor={{ false: COLORS.lightGray, true: COLORS.success }}
              thumbColor={isAvailable ? COLORS.white : COLORS.gray}
              style={styles.headerSwitch}
            />
          </View>
        </LinearGradient>

        {/* Stats Summary */}
        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={styles.statsContainer}>
            <TouchableWeb 
              style={styles.statCard}
              onPress={() => handleCardPress('pending')}
              activeOpacity={0.8}
            >
              {selectedCard === 'pending' ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.statGradient}
                >
                  <Text style={styles.statLabel}>Pending</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveStatCard}>
                  <Text style={styles.inactiveStatLabel}>Pending</Text>
                </View>
              )}
            </TouchableWeb>
            
            <TouchableWeb 
              style={styles.statCard}
              onPress={() => handleCardPress('booked')}
              activeOpacity={0.8}
            >
              {selectedCard === 'booked' ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.statGradient}
                >
                  <Text style={styles.statLabel}>Booked</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveStatCard}>
                  <Text style={styles.inactiveStatLabel}>Booked</Text>
                </View>
              )}
            </TouchableWeb>
            
            <TouchableWeb 
              style={styles.statCard}
              onPress={() => handleCardPress('active')}
              activeOpacity={0.8}
            >
              {selectedCard === 'active' ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.statGradient}
                >
                  <Text style={styles.statLabel}>Active</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveStatCard}>
                  <Text style={styles.inactiveStatLabel}>Active</Text>
                </View>
              )}
            </TouchableWeb>
            
            <TouchableWeb 
              style={styles.statCard}
              onPress={() => handleCardPress('completed')}
              activeOpacity={0.8}
            >
              {selectedCard === 'completed' ? (
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.statGradient}
                >
                  <Text style={styles.statLabel}>Completed</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactiveStatCard}>
                  <Text style={styles.inactiveStatLabel}>Completed</Text>
                </View>
              )}
            </TouchableWeb>
          </View>

          {/* Appointments List */}
          <View style={styles.appointmentsContainer}>
            {displayedAppointments.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="calendar-blank" size={64} color={COLORS.textLight} />
                <Text style={styles.emptyStateText}>
                  {selectedCard ? `No ${selectedCard} ${selectedCard === 'booked' ? 'shifts' : 'appointments'} found` : 'Select a category above to view appointments'}
                </Text>
              </View>
            ) : (
              <View>
                {/* Separate regular shift requests from recurring */}
                {selectedCard === 'pending' && (
                  <>
                    {/* Pending Assignments Section (Admin-assigned appointments) */}
                    {pendingAssignments.length > 0 && (
                      <>
                        <Text style={styles.sectionHeaderText}>Pending Assignments</Text>
                        {pendingAssignments.map((item, index) => {
                          const uniqueKey = `assignment-${item.id}-${index}`;
                          const displayName = item.clientName || item.patientName || 'Patient Assignment';
                          const photo = resolveClientProfilePhoto(item);
                          const photoUri = getPhotoUri(photo);
                          const initials = getInitials(displayName);
                          return (
                            <View key={uniqueKey} style={styles.compactCard}>
                              <View style={styles.compactHeader}>
                                {photoUri ? (
                                  <View style={styles.compactAvatarWrapper}>
                                    <Image source={{ uri: photoUri }} style={styles.compactAvatarImage} />
                                  </View>
                                ) : (
                                  <View style={[styles.compactAvatarWrapper, styles.compactAvatarFallback]}>
                                    <Text style={styles.compactAvatarInitials}>{initials}</Text>
                                  </View>
                                )}
                                <View style={styles.compactInfo}>
                                  <Text style={styles.compactClient}>
                                    {displayName}
                                  </Text>
                                </View>
                                <TouchableOpacity 
                                  style={styles.detailsButton} 
                                  onPress={() => handleShowDetails(item)}
                                >
                                  <LinearGradient
                                    colors={GRADIENTS.header}
                                    style={styles.previewBtnGradient}
                                  >
                                    <Text style={styles.detailsButtonText}>View</Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}

                    {/* Backup Coverage Requests (Appointments) */}
                    {pendingCoverageAppointmentsForMe.length > 0 && (
                      <>
                        <Text style={styles.sectionHeaderText}>Backup Coverage Requests</Text>
                        {pendingCoverageAppointmentsForMe.map((item, index) => {
                          const uniqueKey = `coverage-${item.id}-${index}`;
                          const displayName = item.clientName || item.patientName || 'Appointment Coverage';
                          const photo = resolveClientProfilePhoto(item);
                          const photoUri = getPhotoUri(photo);
                          const initials = getInitials(displayName);
                          return (
                            <View key={uniqueKey} style={styles.compactCard}>
                              <View style={styles.compactHeader}>
                                {photoUri ? (
                                  <View style={styles.compactAvatarWrapper}>
                                    <Image source={{ uri: photoUri }} style={styles.compactAvatarImage} />
                                  </View>
                                ) : (
                                  <View style={[styles.compactAvatarWrapper, styles.compactAvatarFallback]}>
                                    <Text style={styles.compactAvatarInitials}>{initials}</Text>
                                  </View>
                                )}
                                <View style={styles.compactInfo}>
                                  <Text style={styles.compactClient}>
                                    {displayName}
                                  </Text>
                                </View>
                                <TouchableOpacity 
                                  style={styles.detailsButton} 
                                  onPress={() => handleShowDetails(item)}
                                >
                                  <LinearGradient
                                    colors={GRADIENTS.header}
                                    style={styles.previewBtnGradient}
                                  >
                                    <Text style={styles.detailsButtonText}>View</Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}

                    {/* Regular Shift Requests Section */}
                    {pendingShiftRequests.length > 0 && (
                      <>
                        <Text style={styles.sectionHeaderText}>Shift Requests</Text>
                        {pendingShiftRequests.map((item, index) => {
                          const uniqueKey = `shift-${item.id}-${index}`;
                          const displayName = item.clientName || item.patientName || 'Shift Request';
                          const photo = resolveClientProfilePhoto(item);
                          const photoUri = getPhotoUri(photo);
                          const initials = getInitials(displayName);
                          return (
                            <View key={uniqueKey} style={styles.compactCard}>
                              <View style={styles.compactHeader}>
                                {photoUri ? (
                                  <View style={styles.compactAvatarWrapper}>
                                    <Image source={{ uri: photoUri }} style={styles.compactAvatarImage} />
                                  </View>
                                ) : (
                                  <View style={[styles.compactAvatarWrapper, styles.compactAvatarFallback]}>
                                    <Text style={styles.compactAvatarInitials}>{initials}</Text>
                                  </View>
                                )}
                                <View style={styles.compactInfo}>
                                  <Text style={styles.compactClient}>
                                    {displayName}
                                  </Text>
                                </View>
                                <TouchableOpacity 
                                  style={styles.detailsButton} 
                                  onPress={() => handleShowDetails(item)}
                                >
                                  <LinearGradient
                                    colors={GRADIENTS.header}
                                    style={styles.previewBtnGradient}
                                  >
                                    <Text style={styles.detailsButtonText}>View</Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}

                    {/* Recurring Shift Requests Section */}
                    {pendingRecurringShifts.length > 0 && (
                      <>
                        <Text style={styles.sectionHeaderText}>Recurring Shift Requests</Text>
                        <RecurringShiftsList
                          shifts={pendingRecurringShifts}
                          loading={false}
                          clients={clientsList}
                          onSelectShift={(shift) => {
                            setSelectedRecurringShift(shift);
                            setHideRecurringShiftDetailsFooter(false);
                            setRecurringShiftDetailsModalVisible(true);
                          }}
                          emptyMessage="No recurring shifts"
                        />
                      </>
                    )}
                  </>
                )}

                {/* Non-pending items rendered normally */}
                {selectedCard !== 'pending' && sortedDisplayedAppointments.map((item, index) => {
                  const uniqueKey = `${selectedCard}-${item.id}-${index}`;
                  const normalizedStatus = (item.status || '').toLowerCase();
                  const clockInTimestamp = item.actualStartTime || item.startedAt;
                  const hasClockedIn = Boolean(clockInTimestamp) || normalizedStatus === 'clocked-in' || normalizedStatus === 'active';
                  const shouldShowActive = hasClockedIn && normalizedStatus !== 'completed' && selectedCard !== 'completed';
                  const displayName = item.clientName || item.patientName || 'Patient Assignment';
                  const photo = resolveClientProfilePhoto(item);
                  const photoUri = getPhotoUri(photo);
                  const initials = getInitials(displayName);
                  
                  const clockInTimeLabel = hasClockedIn
                    ? clockInTimestamp
                      ? `Clocked in at ${new Date(clockInTimestamp).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}`
                      : 'Clocked In'
                    : null;

                  const completedTimeLabel = (() => {
                    const isCompletedCard = selectedCard === 'completed' || normalizedStatus === 'completed';
                    if (!isCompletedCard) return null;

                    const resolveClockOutFromClockByNurse = () => {
                      const map = item?.clockByNurse;
                      if (!map || typeof map !== 'object') return null;

                      for (const [key, entry] of Object.entries(map)) {
                        if (matchesMine(key)) {
                          return entry?.lastClockOutTime || entry?.actualEndTime || entry?.clockOutTime || entry?.completedAt || null;
                        }
                        if (entry && typeof entry === 'object') {
                          const entryId =
                            entry.nurseId ||
                            entry.id ||
                            entry._id ||
                            entry.uid ||
                            entry.nurseCode ||
                            entry.staffCode ||
                            entry.code;
                          if (entryId && matchesMine(entryId)) {
                            return entry?.lastClockOutTime || entry?.actualEndTime || entry?.clockOutTime || entry?.completedAt || null;
                          }
                        }
                      }
                      return null;
                    };

                    const completedSource =
                      item?.actualEndTime ||
                      item?.completedAt ||
                      item?.clockOutTime ||
                      item?.lastClockOutTime ||
                      resolveClockOutFromClockByNurse() ||
                      item?.date ||
                      item?.scheduledDate ||
                      item?.startDate ||
                      null;

                    if (!completedSource) return null;

                    const dt = new Date(completedSource);
                    if (!Number.isNaN(dt.getTime())) {
                      const date = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      const time = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                      return `Completed: ${date} ${time}`;
                    }
                    return `Completed: ${String(completedSource)}`;
                  })();

                  const iconConfig = (() => {
                    if (selectedCard === 'active' && hasClockedIn) {
                      return { name: 'clock-check', color: COLORS.success };
                    }
                    if (selectedCard === 'booked') {
                      return { name: 'calendar-check', color: COLORS.primary };
                    }
                    if (selectedCard === 'active') {
                      return { name: 'clock-outline', color: COLORS.accent };
                    }
                    if (selectedCard === 'completed' || normalizedStatus === 'completed') {
                      return { name: 'check-circle', color: COLORS.success };
                    }
                    return { name: 'alert', color: COLORS.warning };
                  })();

                  return (
                    <View key={uniqueKey} style={[styles.compactCard, shouldShowActive && styles.clockedInCard]}>
                      <View style={styles.compactHeader}>
                        {photoUri ? (
                          <View style={styles.compactAvatarWrapper}>
                            <Image source={{ uri: photoUri }} style={styles.compactAvatarImage} />
                          </View>
                        ) : (
                          <View style={[styles.compactAvatarWrapper, styles.compactAvatarFallback]}>
                            <Text style={styles.compactAvatarInitials}>{initials}</Text>
                          </View>
                        )}
                        <View style={styles.compactInfo}>
                          <Text style={styles.compactClient}>
                            {displayName}
                          </Text>
                          {clockInTimeLabel && selectedCard !== 'completed' && normalizedStatus !== 'completed' && (
                            <Text style={styles.compactTimestamp}>{clockInTimeLabel}</Text>
                          )}
                          {completedTimeLabel ? (
                            <Text style={styles.compactTimestamp}>{completedTimeLabel}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity 
                          style={styles.detailsButton} 
                          onPress={() => handleShowDetails(item)}
                        >
                          <LinearGradient
                            colors={GRADIENTS.header}
                            style={styles.previewBtnGradient}
                          >
                            <Text style={styles.detailsButtonText}>View</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.bottomPadding} />
        </ScrollView>

        {/* Appointment/Shift Details Modal */}
        <Modal
          visible={detailsModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setDetailsModalVisible(false)}
        >
          <View style={styles.detailsModalOverlay}>
            <View style={styles.detailsModalContent}>
              <View style={styles.detailsModalHeader}>
                <Text style={styles.detailsModalTitle}>
                  {selectedItemDetails?.isRecurring
                    ? 'Recurring Shift Details'
                    : selectedItemDetails?.isShiftRequest
                      ? 'Shift Request Details'
                      : 'Appointment Details'}
                </Text>
                <TouchableOpacity onPress={() => setDetailsModalVisible(false)}>
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>
              
              {selectedItemDetails && (
                <>
                  <ScrollView 
                    style={styles.appointmentDetailsContent} 
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{paddingBottom: 100}}
                  >
                    {/* Patient Alerts Banner */}
                    {(() => {
                      const status = selectedItemDetails?.status;
                      // For nurses, show alerts for all appointments except completed/cancelled
                      const shouldShowAlerts = status && !['completed', 'cancelled', 'canceled', 'declined', 'rejected'].includes(status.toLowerCase());
                      if (!shouldShowAlerts) return null;

                      let patientAlerts = selectedItemDetails?.patientAlerts ||
                        selectedItemDetails?.clinicalInfo ||
                        selectedItemDetails?.appointmentDetails?.patientAlerts;

                      if (typeof patientAlerts === 'string') {
                        try {
                          patientAlerts = JSON.parse(patientAlerts);
                        } catch {
                          patientAlerts = null;
                        }
                      }

                      if (!patientAlerts || typeof patientAlerts !== 'object') return null;

                      const allergies = Array.isArray(patientAlerts.allergies) ? patientAlerts.allergies : [];
                      const allergyOther = String(patientAlerts.allergyOther || '').trim();
                      const vitals = patientAlerts.vitals || {};

                      const bpSys = String(vitals?.bloodPressureSystolic || '').trim();
                      const bpDia = String(vitals?.bloodPressureDiastolic || '').trim();
                      const hr = String(vitals?.heartRate || '').trim();
                      const temp = String(vitals?.temperature || '').trim();
                      const spo2 = String(vitals?.oxygenSaturation || '').trim();

                      const allergiesFiltered = allergies
                        .map((a) => String(a).trim())
                        .filter((a) => a && a.toLowerCase() !== 'none')
                        .filter((a) => !(a === 'Other' && allergyOther));

                      const hasAllergies = allergiesFiltered.length > 0 || Boolean(allergyOther);
                      const hasVitals = Boolean(bpSys || bpDia || hr || temp || spo2);
                      
                      if (!hasAllergies && !hasVitals) return null;

                      const allergyTextParts = [...allergiesFiltered];
                      if (allergyOther && !allergyTextParts.includes(allergyOther)) allergyTextParts.push(allergyOther);
                      const allergyText = allergyTextParts.length ? allergyTextParts.join(', ') : '';

                      const vitalsParts = [];
                      if (bpSys || bpDia) vitalsParts.push(`BP ${bpSys || '?'} / ${bpDia || '?'}`);
                      if (hr) vitalsParts.push(`HR ${hr}`);
                      if (temp) vitalsParts.push(`Temp ${temp}`);
                      if (spo2) vitalsParts.push(`SpO₂ ${spo2}%`);
                      const vitalsText = vitalsParts.join(' • ');

                      return (
                        <View style={styles.patientAlertsBanner}>
                          <MaterialCommunityIcons name="alert-circle" size={18} color={COLORS.error} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.patientAlertsTitle}>Patient Alerts</Text>
                            {hasAllergies ? (
                              <Text style={styles.patientAlertsText} numberOfLines={3}>
                                Patient is allergic to: {allergyText || '—'}
                              </Text>
                            ) : null}
                            {hasVitals ? (
                              <Text style={styles.patientAlertsText} numberOfLines={3}>
                                Vitals are: {vitalsText}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })()}

                    {/* Backup coverage banner for targeted backup nurse */}
                    {(() => {
                      // Show banner for shift requests
                      if (!selectedItemDetails.isShiftRequest || selectedItemDetails.isRecurring) return null;
                      const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                        ? selectedItemDetails.coverageRequests
                        : [];
                      if (coverageList.length === 0) return null;

                      const hasPendingCoverageForMe = coverageList.some((cr) => {
                        if (!cr) return false;
                        const crStatus = String(cr.status || '').trim().toLowerCase();
                        if (crStatus !== 'pending') return false;
                        const targets = [
                          cr.targetBackupNurseId,
                          cr.targetBackupNurseStaffCode,
                          ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                        ].filter(Boolean);
                        return targets.some((t) => matchesMine(t));
                      });

                      if (!hasPendingCoverageForMe) return null;

                      return (
                        <View style={[styles.detailsSection, { paddingBottom: 0 }] }>
                          <Text style={{ color: COLORS.error, fontWeight: '600', marginBottom: 8 }}>
                            Requesting backup coverage for this shift
                          </Text>
                        </View>
                      );
                    })()}

                    {/* Backup coverage banner for targeted backup nurse (Appointments) */}
                    {(() => {
                      if (selectedItemDetails.isShiftRequest || selectedItemDetails.isRecurring) return null;
                      const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                        ? selectedItemDetails.coverageRequests
                        : [];
                      if (coverageList.length === 0) return null;

                      const hasPendingCoverageForMe = coverageList.some((cr) => {
                        if (!cr) return false;
                        const crStatus = String(cr.status || '').trim().toLowerCase();
                        if (crStatus !== 'pending') return false;
                        const targets = [
                          cr.targetBackupNurseId,
                          cr.targetBackupNurseStaffCode,
                          ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                        ].filter(Boolean);
                        return targets.some((t) => matchesMine(t));
                      });

                      if (!hasPendingCoverageForMe) return null;

                      return (
                        <View style={[styles.detailsSection, { paddingBottom: 0 }] }>
                          <Text style={{ color: COLORS.error, fontWeight: '600', marginBottom: 8 }}>
                            Emergency backup coverage requested for this appointment
                          </Text>
                        </View>
                      );
                    })()}

                    {/* Client/Patient Information - matching admin style */}
                    <View style={styles.detailsSection}>
                      <Text style={styles.sectionTitle}>
                        {selectedItemDetails.isShiftRequest ? 'Client Information' : 'Patient Information'}
                      </Text>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>{selectedItemDetails.isShiftRequest ? 'Client Name' : 'Patient Name'}</Text>
                          <Text style={styles.detailValue}>
                            {selectedItemPatientInfo?.name || 'N/A'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Email</Text>
                          <Text style={styles.detailValue}>
                            {selectedItemPatientInfo?.email || 'N/A'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Phone</Text>
                          <Text style={styles.detailValue}>
                            {selectedItemPatientInfo?.phone || 'N/A'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Address</Text>
                          <Text style={styles.detailValue}>
                            {selectedItemPatientInfo?.address || 'N/A'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Service Information - for shift requests */}
                    {selectedItemDetails.isShiftRequest && !selectedItemDetails.isRecurring && (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Service Information</Text>

                        {(() => {
                            const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                              ? selectedItemDetails.coverageRequests
                              : [];

                            const acceptedCoverage = coverageList.find(cr => normalizeStatus(cr?.status) === 'accepted');

                            const pendingCoverageForMe = coverageList.find((cr) => {
                              if (!cr) return false;
                              const status = String(cr.status || '').trim().toLowerCase();
                              if (status !== 'pending') return false;
                              const targets = [
                                cr.targetBackupNurseId,
                                cr.targetBackupNurseStaffCode,
                                ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                              ].filter(Boolean);
                              return targets.some((t) => matchesMine(t));
                            });

                            const requestingNurseIdFromPending = pendingCoverageForMe?.requestingNurseId || null;
                            const requestingNameFromPending = pendingCoverageForMe?.requestingNurseName || null;
                            const requestingCodeFromPending = pendingCoverageForMe?.requestingNurseCode || null;

                            // Resolve assigned nurse ID - if someone accepted coverage, we show the requester
                            const assignedNurseId = 
                              acceptedCoverage?.requestingNurseId || 
                              selectedItemDetails.nurseId || 
                              selectedItemDetails.assignedNurseId || 
                              null;
                            
                            const assignedName = selectedItemDisplayNurseName || null;
                            
                            const assignedCodeFromRecord =
                              acceptedCoverage?.requestingNurseCode ||
                              selectedItemDetails.nurseCode ||
                              selectedItemDetails.nurseStaffCode ||
                              selectedItemDetails.assignedNurseCode ||
                              selectedItemDetails.assignedNurseStaffCode ||
                              selectedItemDetails.staffCode ||
                              null;

                            // Find nurse from nurses list for additional details
                            const findNurse = (nurseId, nurseCodeCandidate) => {
                              if (!nurses || nurses.length === 0) return null;
                              const normalizedId = nurseId ? String(nurseId).trim().toUpperCase() : null;
                              const normalizedCode = nurseCodeCandidate ? String(nurseCodeCandidate).trim().toUpperCase() : null;
                              return nurses.find(n => {
                                const ids = [n.id, n._id, n.uid, n.nurseId, n.code, n.staffCode, n.nurseCode].filter(Boolean);
                                return ids.some(id => String(id).trim().toUpperCase() === normalizedId) ||
                                       (normalizedCode && ids.some(id => String(id).trim().toUpperCase() === normalizedCode));
                              });
                            };

                            const assignedNurse = findNurse(assignedNurseId, assignedCodeFromRecord);
                            const requestingNurse = requestingNurseIdFromPending ? findNurse(requestingNurseIdFromPending, requestingCodeFromPending) : null;

                            // Debug: mirror AdminDashboard logging to verify Service Info nurse resolution
                            try {
                              console.log('[NurseAppointments] ServiceInfo Assigned Nurse', {
                                appointmentId: selectedItemDetails?.id || selectedItemDetails?._id || null,
                                coverageRequestingNurseName: acceptedCoverage?.requestingNurseName || pendingCoverageForMe?.requestingNurseName || null,
                                nurseDisplayName: assignedName,
                                nurseCode: assignedCodeFromRecord,
                                resolvedAssignedNurseId: assignedNurse?.id || assignedNurse?._id || null,
                                resolvedAssignedNurseCode: assignedNurse?.nurseCode || assignedNurse?.staffCode || assignedNurse?.code || null,
                              });
                            } catch (e) {}

                            return (
                              <View style={styles.splitNurseCard}>
                                {/* Nurse Card */}
                                {(() => {
                                  // Show requesting nurse if this is a pending backup coverage request targeting me
                                  if (requestingNameFromPending && (requestingCodeFromPending || requestingNurseIdFromPending)) {
                                    return (
                                      <NurseInfoCard
                                        variant="embedded"
                                        nurse={{
                                          id: requestingNurseIdFromPending,
                                          name: requestingNameFromPending,
                                          fullName: requestingNameFromPending,
                                          code: requestingCodeFromPending,
                                          staffCode: requestingCodeFromPending,
                                          specialty: requestingNurse?.specialty || 'General Nursing',
                                          profilePhoto: requestingNurse?.profilePhoto || null,
                                          profileImage: requestingNurse?.profileImage || null,
                                        }}
                                        nursesRoster={nurses}
                                        onPress={(nurse) => {
                                          console.log('View button pressed for requesting nurse:', nurse.name);
                                        }}
                                        showViewButton={true}
                                        style={{ marginBottom: 0 }}
                                      />
                                    );
                                  }

                                  // Otherwise show assigned nurse (the person being covered if someone accepted)
                                  if (assignedName || assignedNurse) {
                                    return (
                                      <NurseInfoCard
                                        variant="embedded"
                                        nurse={{
                                          id: assignedNurseId || assignedNurse?.id,
                                          name: assignedName || (assignedNurse ? getNurseName(assignedNurse) : null),
                                          fullName: assignedName || (assignedNurse ? getNurseName(assignedNurse) : null),
                                          code: assignedNurse?.nurseCode || assignedNurse?.staffCode || assignedNurse?.code || assignedCodeFromRecord,
                                          staffCode: assignedNurse?.nurseCode || assignedNurse?.staffCode || assignedNurse?.code || assignedCodeFromRecord,
                                          specialty: assignedNurse?.specialty || 'General Nursing',
                                          profilePhoto: assignedNurse?.profilePhoto || null,
                                          profileImage: assignedNurse?.profileImage || null,
                                        }}
                                        nursesRoster={nurses}
                                        onPress={(nurse) => {
                                          console.log('View button pressed for assigned nurse:', nurse.name);
                                        }}
                                        showViewButton={true}
                                        style={{ marginBottom: 0 }}
                                      />
                                    );
                                  }

                                  return null;
                                })()}

                                <View style={{ height: 1, backgroundColor: '#E5E7EB', marginVertical: 12 }} />

                                {/* Service Name */}
                                <View style={styles.splitNurseDaysContainer}>
                                  <View style={styles.splitNurseServiceRow}>
                                    <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                                    <Text style={styles.splitNurseServiceText}>
                                      {selectedItemDetails.service || selectedItemDetails.serviceName || 'N/A'}
                                    </Text>
                                  </View>
                                </View>

                                {/* Assigned Days */}
                                {(() => {
                                  const dayNameToIndex = {
                                    sun: 0, sunday: 0,
                                    mon: 1, monday: 1,
                                    tue: 2, tues: 2, tuesday: 2,
                                    wed: 3, wednesday: 3,
                                    thu: 4, thur: 4, thurs: 4, thursday: 4,
                                    fri: 5, friday: 5,
                                    sat: 6, saturday: 6,
                                  };

                                  const toDayNumber = (value) => {
                                    if (value === null || value === undefined) return null;
                                    if (typeof value === 'number' && Number.isInteger(value)) return value;
                                    const str = String(value).trim().toLowerCase();
                                    if (!str) return null;
                                    const asNum = Number(str);
                                    if (Number.isInteger(asNum)) return asNum;
                                    if (dayNameToIndex.hasOwnProperty(str)) return dayNameToIndex[str];
                                    return null;
                                  };

                                  // For single shift requests, extract day from date
                                  const getSingleShiftDay = () => {
                                    const dateField = selectedItemDetails.date || selectedItemDetails.scheduledDate || selectedItemDetails.requestDate;
                                    if (!dateField) return null;
                                    
                                    let dateObj;
                                    if (dateField?.seconds) {
                                      // Firestore timestamp
                                      dateObj = new Date(dateField.seconds * 1000);
                                    } else if (typeof dateField === 'string') {
                                      dateObj = new Date(dateField);
                                    } else if (dateField instanceof Date) {
                                      dateObj = dateField;
                                    }
                                    
                                    if (dateObj && !isNaN(dateObj)) {
                                      return dateObj.getDay(); // Returns 0-6 (Sunday-Saturday)
                                    }
                                    return null;
                                  };

                                  const singleShiftDay = getSingleShiftDay();

                                  const combined = []
                                    .concat(selectedItemDetails.daysOfWeek || [])
                                    .concat(selectedItemDetails.selectedDays || [])
                                    .concat(selectedItemDetails.requestedDays || [])
                                    .concat(selectedItemDetails.recurringDaysOfWeekList || [])
                                    .concat(selectedItemDetails.recurringDaysOfWeek || [])
                                    .concat(selectedItemDetails.recurringPattern?.daysOfWeek || [])
                                    .concat(selectedItemDetails.schedule?.daysOfWeek || [])
                                    .concat(selectedItemDetails.schedule?.selectedDays || [])
                                    .concat(singleShiftDay !== null ? [singleShiftDay] : []);

                                  const daysArray = Array.from(
                                    new Set(
                                      combined
                                        .map(toDayNumber)
                                        .filter((n) => n !== null && n >= 0 && n <= 6)
                                    )
                                  );

                                  if (!daysArray || daysArray.length === 0) return null;

                                  return (
                                    <View style={{ marginTop: 12 }}>
                                      <Text style={styles.assignedDaysLabel}>Assigned Days</Text>
                                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                                        {daysArray.map((day, index) => (
                                          <LinearGradient
                                            key={index}
                                            colors={SAFE_GRADIENTS.header}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.assignedDayPill}
                                          >
                                            <Text style={styles.assignedDayPillText}>
                                              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]}
                                            </Text>
                                          </LinearGradient>
                                        ))}
                                      </View>
                                    </View>
                                  );
                                })()}

                                {/* Start and End Time */}
                                {(() => {
                                  const startRaw = selectedItemDetails.startTime || selectedItemDetails.time;
                                  const endRaw = selectedItemDetails.endTime;
                                  
                                  if (!startRaw || !endRaw) return null;

                                  return (
                                    <View style={[styles.splitNurseTimeContainer, { marginTop: 12 }]}>
                                      <View style={styles.splitNurseTimeItem}>
                                        <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                                        <View style={styles.splitNurseTimeContent}>
                                          <Text style={styles.splitNurseTimeLabel}>Start Time</Text>
                                          <Text style={styles.splitNurseTimeValue}>{formatTimeTo12Hour(startRaw)}</Text>
                                        </View>
                                      </View>
                                      <View style={styles.splitNurseTimeDivider} />
                                      <View style={styles.splitNurseTimeItem}>
                                        <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                                        <View style={styles.splitNurseTimeContent}>
                                          <Text style={styles.splitNurseTimeLabel}>End Time</Text>
                                          <Text style={styles.splitNurseTimeValue}>{formatTimeTo12Hour(endRaw)}</Text>
                                        </View>
                                      </View>
                                    </View>
                                  );
                                      })()}

                                {/* Start and End Date */}
                                {(() => {
                                        const toDateFromValue = (value) => {
                                    if (!value) return null;
                                    if (value instanceof Date) return value;
                                    if (typeof value?.toDate === 'function') return value.toDate();
                                    if (typeof value === 'object' && typeof value.seconds === 'number') {
                                      return new Date(value.seconds * 1000);
                                    }
                                    if (typeof value === 'object' && typeof value._seconds === 'number') {
                                      return new Date(value._seconds * 1000);
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
                                    return !Number.isNaN(parsed.getTime()) ? parsed : null;
                                  };

                                  const startDateValue = selectedItemDetails.startDate || selectedItemDetails.date;
                                  const endDateValue = selectedItemDetails.endDate;
                                  
                                  if (!startDateValue) return null;

                                  const startParsed = toDateFromValue(startDateValue);
                                  const endParsed = toDateFromValue(endDateValue || startDateValue);

                                  const startStr = startParsed
                                    ? startParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                    : (typeof startDateValue === 'string' ? startDateValue : 'N/A');
                                  
                                  const endStr = endParsed
                                    ? endParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                    : (typeof endDateValue === 'string' ? endDateValue : startStr);

                                  return (
                                    <View style={[styles.splitNurseTimeContainer, { marginTop: 8 }]}>
                                      <View style={styles.splitNurseTimeItem}>
                                        <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                                        <View style={styles.splitNurseTimeContent}>
                                          <Text style={styles.splitNurseTimeLabel}>Start Date</Text>
                                          <Text style={styles.splitNurseTimeValue}>{startStr}</Text>
                                        </View>
                                      </View>
                                      <View style={styles.splitNurseTimeDivider} />
                                      <View style={styles.splitNurseTimeItem}>
                                        <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                                        <View style={styles.splitNurseTimeContent}>
                                          <Text style={styles.splitNurseTimeLabel}>End Date</Text>
                                          <Text style={styles.splitNurseTimeValue}>{endStr}</Text>
                                        </View>
                                      </View>
                                    </View>
                                  );
                                      })()}

                                {/* Duration */}
                                {(() => {
                                  const startTime = selectedItemDetails.startTime || selectedItemDetails.time;
                                  const endTime = selectedItemDetails.endTime;
                                  
                                  if (!startTime || !endTime) return null;
                                  
                                  try {
                                    const parseTime = (timeStr) => {
                                      if (!timeStr) return null;
                                      const cleaned = timeStr.trim().toUpperCase();
                                      const match = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
                                      if (!match) return null;
                                      
                                      let hours = parseInt(match[1]);
                                      const minutes = parseInt(match[2]);
                                      const meridiem = match[3];
                                      
                                      if (meridiem === 'PM' && hours !== 12) hours += 12;
                                      if (meridiem === 'AM' && hours === 12) hours = 0;
                                      
                                      return hours * 60 + minutes;
                                    };
                                    
                                    const startMinutes = parseTime(startTime);
                                    const endMinutes = parseTime(endTime);
                                    
                                    if (startMinutes === null || endMinutes === null) return null;
                                    
                                    let diffMinutes = endMinutes - startMinutes;
                                    if (diffMinutes < 0) diffMinutes += 24 * 60;
                                    
                                    const hours = Math.floor(diffMinutes / 60);
                                    const minutes = diffMinutes % 60;
                                    
                                    return (
                                      <View style={[styles.splitNurseTimeContainer, { marginTop: 8 }]}>
                                        <View style={[styles.splitNurseTimeItem, { flex: 1 }]}>
                                          <MaterialCommunityIcons name="timer-outline" size={16} color={COLORS.primary} />
                                          <View style={styles.splitNurseTimeContent}>
                                            <Text style={styles.splitNurseTimeLabel}>Duration</Text>
                                            <Text style={styles.splitNurseTimeValue}>{hours}h {minutes}m</Text>
                                          </View>
                                        </View>
                                      </View>
                                    );
                                  } catch (error) {
                                    return null;
                                  }
                                })()}
                              </View>
                            );
                          })()}
                      </View>
                    )}

                    {/* Request/Assignment Details - matching admin style */}
                    {/* Only show request details when there is no nurse assignment yet */}
                    {(selectedItemDetails.requestedAt || selectedItemDetails.createdAt) && !selectedItemHasNurseAssignment && (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>
                          {selectedItemDetails.isShiftRequest ? 'Shift Request Details' : 'Request Details'}
                        </Text>
                        <View style={styles.detailItem}>
                          <MaterialCommunityIcons name="clock-alert-outline" size={20} color={COLORS.primary} />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>
                              {selectedItemDetails.isShiftRequest ? 'Requested' : 'Created'}
                            </Text>
                            <Text style={styles.detailValue}>
                              {(() => {
                                let timestamp = selectedItemDetails.requestedAt || selectedItemDetails.assignedAt || selectedItemDetails.createdAt;
                                
                                // Handle Firestore timestamp object
                                if (timestamp && typeof timestamp === 'object' && timestamp._seconds) {
                                  timestamp = timestamp._seconds * 1000;
                                }
                                
                                const date = new Date(timestamp);
                                
                                if (isNaN(date.getTime())) {
                                  // Try to handle if it's already a formatted string or just return it
                                  if (typeof timestamp === 'string' && timestamp.length > 5) {
                                    return timestamp;
                                  }
                                  return 'Date not available';
                                }
                                
                                return `${date.toLocaleDateString('en-US', { 
                                  month: 'short', 
                                  day: 'numeric', 
                                  year: 'numeric' 
                                })} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                              })()}
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Service Information - for recurring shifts */}
                    {selectedItemDetails.isRecurring && (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Service Information</Text>

                        {(() => {
                            const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                                ? selectedItemDetails.coverageRequests
                                : [];
                            
                            const acceptedCoverage = coverageList.find(cr => normalizeStatus(cr?.status) === 'accepted');

                            const assignedNurseId = 
                              acceptedCoverage?.requestingNurseId ||
                              selectedItemDetails.nurseId || 
                              selectedItemDetails.assignedNurseId || 
                              null;
                            
                            const assignedName = selectedItemDisplayNurseName || null;
                            
                            const assignedCodeFromRecord =
                              acceptedCoverage?.requestingNurseCode ||
                              selectedItemDetails.nurseCode ||
                              selectedItemDetails.nurseStaffCode ||
                              selectedItemDetails.assignedNurseCode ||
                              selectedItemDetails.assignedNurseStaffCode ||
                              selectedItemDetails.staffCode ||
                              null;

                            // Find nurse from nurses list for additional details
                            const findNurse = (nurseId, nurseCodeCandidate) => {
                              if (!nurses || nurses.length === 0) return null;
                              const normalizedId = nurseId ? String(nurseId).trim().toUpperCase() : null;
                              const normalizedCode = nurseCodeCandidate ? String(nurseCodeCandidate).trim().toUpperCase() : null;
                              return nurses.find(n => {
                                const ids = [n.id, n._id, n.uid, n.nurseId, n.code, n.staffCode, n.nurseCode].filter(Boolean);
                                return ids.some(id => String(id).trim().toUpperCase() === normalizedId) ||
                                       (normalizedCode && ids.some(id => String(id).trim().toUpperCase() === normalizedCode));
                              });
                            };

                            const assignedNurse = findNurse(assignedNurseId, assignedCodeFromRecord);

                            // Debug: mirror AdminDashboard logging for recurring shifts
                            try {
                              console.log('[NurseAppointments] ServiceInfo Assigned Nurse (Recurring)', {
                                appointmentId: selectedItemDetails?.id || selectedItemDetails?._id || null,
                                coverageRequestingNurseName: acceptedCoverage?.requestingNurseName || null,
                                nurseDisplayName: assignedName,
                                nurseCode: assignedCodeFromRecord,
                                resolvedAssignedNurseId: assignedNurse?.id || assignedNurse?._id || null,
                                resolvedAssignedNurseCode: assignedNurse?.nurseCode || assignedNurse?.staffCode || assignedNurse?.code || null,
                              });
                            } catch (e) {}

                            return (
                              <View style={styles.splitNurseCard}>
                                {/* Nurse Card */}
                                {(assignedName || assignedNurse) && (
                                  <NurseInfoCard
                                    variant="embedded"
                                    nurse={{
                                      id: assignedNurseId || assignedNurse?.id,
                                      name: assignedName || (assignedNurse ? getNurseName(assignedNurse) : null),
                                      fullName: assignedName || (assignedNurse ? getNurseName(assignedNurse) : null),
                                      code: assignedNurse?.nurseCode || assignedNurse?.staffCode || assignedNurse?.code || assignedCodeFromRecord,
                                      staffCode: assignedNurse?.nurseCode || assignedNurse?.staffCode || assignedNurse?.code || assignedCodeFromRecord,
                                      specialty: assignedNurse?.specialty || 'General Nursing',
                                      profilePhoto: assignedNurse?.profilePhoto || null,
                                      profileImage: assignedNurse?.profileImage || null,
                                    }}
                                    nursesRoster={nurses}
                                    onPress={(nurse) => {
                                      console.log('View button pressed for assigned nurse:', nurse.name);
                                    }}
                                    showViewButton={true}
                                    style={{ marginBottom: 0 }}
                                  />
                                )}

                                <View style={{ height: 1, backgroundColor: '#E5E7EB', marginVertical: 12 }} />

                                {/* Service Name */}
                                <View style={styles.splitNurseDaysContainer}>
                                  <View style={styles.splitNurseServiceRow}>
                                    <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                                    <Text style={styles.splitNurseServiceText}>
                                      {selectedItemDetails.service || selectedItemDetails.serviceName || 'N/A'}
                                    </Text>
                                  </View>
                                </View>

                          {/* Assigned Days */}
                          {(() => {
                            const dayNameToIndex = {
                              sun: 0, sunday: 0,
                              mon: 1, monday: 1,
                              tue: 2, tues: 2, tuesday: 2,
                              wed: 3, wednesday: 3,
                              thu: 4, thur: 4, thurs: 4, thursday: 4,
                              fri: 5, friday: 5,
                              sat: 6, saturday: 6,
                            };

                            const toDayNumber = (value) => {
                              if (value === null || value === undefined) return null;
                              if (typeof value === 'number' && Number.isInteger(value)) return value;
                              const str = String(value).trim().toLowerCase();
                              if (!str) return null;
                              const asNum = Number(str);
                              if (Number.isInteger(asNum)) return asNum;
                              if (dayNameToIndex.hasOwnProperty(str)) return dayNameToIndex[str];
                              return null;
                            };

                            const combined = []
                              .concat(selectedItemDetails.recurringPattern?.daysOfWeek || [])
                              .concat(selectedItemDetails.recurringDaysOfWeekList || [])
                              .concat(selectedItemDetails.recurringDaysOfWeek || [])
                              .concat(selectedItemDetails.daysOfWeek || [])
                              .concat(selectedItemDetails.selectedDays || [])
                              .concat(selectedItemDetails.requestedDays || [])
                              .concat(selectedItemDetails.schedule?.daysOfWeek || [])
                              .concat(selectedItemDetails.schedule?.selectedDays || []);

                            const daysArray = Array.from(
                              new Set(
                                combined
                                  .map(toDayNumber)
                                  .filter((n) => n !== null && n >= 0 && n <= 6)
                              )
                            );

                            if (!daysArray || daysArray.length === 0) return null;

                            return (
                              <View style={{ marginTop: 12 }}>
                                <Text style={styles.assignedDaysLabel}>Assigned Days</Text>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                                  {daysArray.map((day, index) => (
                                    <LinearGradient
                                      key={index}
                                      colors={SAFE_GRADIENTS.header}
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 0, y: 1 }}
                                      style={styles.assignedDayPill}
                                    >
                                      <Text style={styles.assignedDayPillText}>
                                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]}
                                      </Text>
                                    </LinearGradient>
                                  ))}
                                </View>
                              </View>
                            );
                          })()}

                          {/* Start and End Time */}
                          {(() => {
                            const startRaw = selectedItemDetails.startTime || selectedItemDetails.time;
                            const endRaw = selectedItemDetails.endTime;
                            
                            if (!startRaw || !endRaw) return null;

                            return (
                              <View style={[styles.splitNurseTimeContainer, { marginTop: 12 }]}>
                                <View style={styles.splitNurseTimeItem}>
                                  <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                                  <View style={styles.splitNurseTimeContent}>
                                    <Text style={styles.splitNurseTimeLabel}>Start Time</Text>
                                    <Text style={styles.splitNurseTimeValue}>{formatTimeTo12Hour(startRaw)}</Text>
                                  </View>
                                </View>
                                <View style={styles.splitNurseTimeDivider} />
                                <View style={styles.splitNurseTimeItem}>
                                  <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                                  <View style={styles.splitNurseTimeContent}>
                                    <Text style={styles.splitNurseTimeLabel}>End Time</Text>
                                    <Text style={styles.splitNurseTimeValue}>{formatTimeTo12Hour(endRaw)}</Text>
                                  </View>
                                </View>
                              </View>
                            );
                          })()}

                          {/* Start and End Date */}
                          {selectedItemDetails.recurringPattern?.startDate && (
                            <View style={[styles.splitNurseTimeContainer, { marginTop: 8 }]}>
                              <View style={styles.splitNurseTimeItem}>
                                <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                                <View style={styles.splitNurseTimeContent}>
                                  <Text style={styles.splitNurseTimeLabel}>Start Date</Text>
                                  <Text style={styles.splitNurseTimeValue}>
                                    {(() => {
                                      const d = toDateFromValue(selectedItemDetails.recurringPattern.startDate);
                                      return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                                    })()}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.splitNurseTimeDivider} />
                              <View style={styles.splitNurseTimeItem}>
                                <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                                <View style={styles.splitNurseTimeContent}>
                                  <Text style={styles.splitNurseTimeLabel}>End Date</Text>
                                  <Text style={styles.splitNurseTimeValue}>
                                    {(() => {
                                      if (!selectedItemDetails.recurringPattern.endDate) return 'Ongoing';
                                      const d = toDateFromValue(selectedItemDetails.recurringPattern.endDate);
                                      return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                                    })()}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          )}

                          {/* Duration */}
                          {(() => {
                            const startTime = selectedItemDetails.startTime || selectedItemDetails.time;
                            const endTime = selectedItemDetails.endTime;
                            
                            if (!startTime || !endTime) return null;
                            
                            try {
                              const parseTime = (timeStr) => {
                                if (!timeStr) return null;
                                const cleaned = timeStr.trim().toUpperCase();
                                const match = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
                                if (!match) return null;
                                
                                let hours = parseInt(match[1]);
                                const minutes = parseInt(match[2]);
                                const meridiem = match[3];
                                
                                if (meridiem === 'PM' && hours !== 12) hours += 12;
                                if (meridiem === 'AM' && hours === 12) hours = 0;
                                
                                return hours * 60 + minutes;
                              };
                              
                              const startMinutes = parseTime(startTime);
                              const endMinutes = parseTime(endTime);
                              
                              if (startMinutes === null || endMinutes === null) return null;
                              
                              let diffMinutes = endMinutes - startMinutes;
                              if (diffMinutes < 0) diffMinutes += 24 * 60;
                              
                              const hours = Math.floor(diffMinutes / 60);
                              const minutes = diffMinutes % 60;
                              
                              return (
                                <View style={[styles.splitNurseTimeContainer, { marginTop: 8 }]}>
                                  <View style={[styles.splitNurseTimeItem, { flex: 1 }]}>
                                    <MaterialCommunityIcons name="timer-outline" size={16} color={COLORS.primary} />
                                    <View style={styles.splitNurseTimeContent}>
                                      <Text style={styles.splitNurseTimeLabel}>Duration</Text>
                                      <Text style={styles.splitNurseTimeValue}>{hours}h {minutes}m</Text>
                                    </View>
                                  </View>
                                </View>
                              );
                            } catch (error) {
                              return null;
                            }
                          })()}

                              </View>
                            );
                          })()}
                      </View>
                    )}

                    {/* Recurring Schedule Details - for recurring shifts only */}
                    {selectedItemDetails.isRecurring && selectedItemDetails.recurringPattern && (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Recurring Schedule Details</Text>
                        
                        {/* Frequency */}
                        <View style={styles.detailItem}>
                          <MaterialCommunityIcons name="repeat" size={20} color={COLORS.primary} />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Frequency</Text>
                            <Text style={styles.detailValue}>
                              {selectedItemDetails.recurringPattern.frequency?.charAt(0).toUpperCase() + 
                               selectedItemDetails.recurringPattern.frequency?.slice(1) || 'Weekly'}
                            </Text>
                          </View>
                        </View>

                        {/* Total Occurrences */}
                        {selectedItemDetails.recurringPattern.totalOccurrences && (
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="counter" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Total Shifts</Text>
                              <Text style={styles.detailValue}>
                                {selectedItemDetails.recurringPattern.totalOccurrences} shifts scheduled
                              </Text>
                            </View>
                          </View>
                        )}

                        {/* Schedule Duration */}
                        {selectedItemDetails.recurringPattern.startDate && (
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="calendar-range" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Schedule Period</Text>
                              <Text style={styles.detailValue}>
                                {(() => {
                                  const d = toDateFromValue(selectedItemDetails.recurringPattern.startDate);
                                  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                                })()}
                                {selectedItemDetails.recurringPattern.endDate && (() => {
                                  const d = toDateFromValue(selectedItemDetails.recurringPattern.endDate);
                                  return d ? ` - ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
                                })()}
                                {!selectedItemDetails.recurringPattern.endDate && ' (ongoing)'}
                              </Text>
                            </View>
                          </View>
                        )}

                        {/* Billing Information */}
                        {selectedItemDetails.recurringBilling && (
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="cash-multiple" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Billing Cycle</Text>
                              <Text style={styles.detailValue}>
                                {selectedItemDetails.recurringBilling.billingCycle?.charAt(0).toUpperCase() + 
                                 selectedItemDetails.recurringBilling.billingCycle?.slice(1) || 'Weekly'} billing
                              </Text>
                            </View>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Shift/Service Information - hidden for non-recurring shift requests */}
                    {!(selectedItemDetails.isShiftRequest && !selectedItemDetails.isRecurring) && (
                    <View style={styles.detailsSection}>
                      <Text style={styles.sectionTitle}>
                        {selectedItemDetails.isShiftRequest ? 'Shift Request Information' : 
                         selectedItemDetails.isRecurring ? 'Recurring Schedule Information' : 
                         'Service Information'}
                      </Text>
                      {(() => {
                        const isRegularAppointment = !selectedItemDetails.isShiftRequest && !selectedItemDetails.isRecurring;

                        if (isRegularAppointment) {
                          return (
                            <View style={styles.detailItem}>
                              <MaterialCommunityIcons name="medical-bag" size={20} color={COLORS.primary} />
                              <View style={styles.detailContent}>
                                <Text style={styles.detailLabel}>Service</Text>
                                <Text style={styles.detailValue}>
                                  {selectedItemDetails.service || selectedItemDetails.serviceName || 'General Care'}
                                </Text>
                              </View>
                            </View>
                          );
                        }

                        return (
                          <View
                            style={{
                              backgroundColor: COLORS.white,
                              borderRadius: 12,
                              borderWidth: 2,
                              borderColor: COLORS.primary,
                              padding: 16,
                              marginBottom: 12,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.1,
                              shadowRadius: 4,
                              elevation: 3,
                            }}
                          >
                            {(() => {
                              // Resolve assigned nurse details
                              const assignedNurseId = selectedItemDetails.nurseId || selectedItemDetails.assignedNurseId || null;
                              const assignedName = selectedItemDisplayNurseName || null;
                              const assignedCode =
                                selectedItemDetails.nurseCode ||
                                selectedItemDetails.nurseStaffCode ||
                                selectedItemDetails.assignedNurseCode ||
                                selectedItemDetails.assignedNurseStaffCode ||
                                selectedItemDetails.staffCode ||
                                selectedItemDetails.code ||
                                null;

                              // If we have nurse info, use NurseInfoCard (variant="embedded")
                              if (assignedName || assignedNurseId) {
                                return (
                                  <View
                                    style={{
                                      marginBottom: 12,
                                      paddingBottom: 12,
                                      borderBottomWidth: 1,
                                      borderBottomColor: COLORS.border,
                                    }}
                                  >
                                    <NurseInfoCard
                                      variant="embedded"
                                      nurse={{
                                        id: assignedNurseId,
                                        name: assignedName || 'Assigned Nurse',
                                        fullName: assignedName || 'Assigned Nurse',
                                        code: assignedCode,
                                        staffCode: assignedCode,
                                        // NurseInfoCard resolves photo/specialty from roster via ID
                                      }}
                                      nursesRoster={nurses}
                                      showViewButton={true}
                                      style={{ marginBottom: 0 }}
                                    />
                                  </View>
                                );
                              }
                              return null;
                            })()}

                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <MaterialCommunityIcons name="medical-bag" size={18} color={COLORS.primary} />
                              <Text
                                style={{
                                  fontSize: 14,
                                  fontFamily: 'Poppins_600SemiBold',
                                  color: COLORS.text,
                                }}
                              >
                                {selectedItemDetails.service || selectedItemDetails.serviceName || 'General Care'}
                              </Text>
                            </View>
                          </View>
                        );
                      })()}
                      {/* Shift Requests: Show Start/End dates above time row (supports schedule.* fallback) */}
                      {selectedItemDetails.isShiftRequest && !selectedItemDetails.isRecurring && (() => {
                        const startDateValue =
                          selectedItemDetails.startDate ||
                          selectedItemDetails.schedule?.startDate ||
                          selectedItemDetails.schedule?.date ||
                          selectedItemDetails.date ||
                          selectedItemDetails.preferredDate ||
                          selectedItemDetails.scheduledDate ||
                          selectedItemDetails.appointmentDate;

                        const endDateValue =
                          selectedItemDetails.endDate ||
                          selectedItemDetails.schedule?.endDate;

                        if (!startDateValue && !endDateValue) return null;

                        const resolvedEndDateValue = endDateValue || startDateValue;
                        const startParsed = toDateFromValue(startDateValue);
                        const endParsed = toDateFromValue(resolvedEndDateValue);

                        return (
                          <View style={styles.timeRow}>
                            <View style={[styles.timeItem, { flex: 1 }]}>
                              <MaterialCommunityIcons name="calendar-start" size={20} color={COLORS.success} />
                              <View style={styles.timeContent}>
                                <Text style={styles.timeLabel}>Start Date</Text>
                                <Text style={styles.timeValue}>
                                  {startParsed
                                    ? startParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                    : (typeof startDateValue === 'string' ? startDateValue : 'N/A')}
                                </Text>
                              </View>
                            </View>

                            <>
                              <View style={styles.timeDashContainer}>
                                <Text style={styles.timeDash}>—</Text>
                              </View>
                              <View style={[styles.timeItem, { flex: 1 }]}>
                                <MaterialCommunityIcons name="calendar-end" size={20} color={COLORS.error} />
                                <View style={styles.timeContent}>
                                  <Text style={styles.timeLabel}>End Date</Text>
                                  <Text style={styles.timeValue}>
                                    {endParsed
                                      ? endParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                      : (typeof resolvedEndDateValue === 'string' ? resolvedEndDateValue : 'N/A')}
                                  </Text>
                                </View>
                              </View>
                            </>
                          </View>
                        );
                      })()}

                      {/* Non shift-requests OR assigned appointments: show Date/Schedule Period row */}
                      {((!selectedItemDetails.isShiftRequest || selectedItemDetails.isRecurring) || selectedItemDetails.status === 'assigned') && (
                        <View style={styles.detailItem}>
                          <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>
                              {selectedItemDetails.isRecurring ? 'Schedule Period' : 'Date'}
                            </Text>
                            <Text style={styles.detailValue}>
                              {(() => {
                                if (selectedItemDetails.isRecurring && selectedItemDetails.recurringPattern) {
                                  // Show recurring schedule period
                                  const startDate = selectedItemDetails.recurringPattern.startDate;
                                  const endDate = selectedItemDetails.recurringPattern.endDate;
                                  if (startDate) {
                                    const startParsed = toDateFromValue(startDate);
                                    const endParsed = endDate ? toDateFromValue(endDate) : null;
                                    const start = startParsed
                                      ? startParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                      : 'N/A';
                                    const end = endDate
                                      ? (endParsed ? endParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A')
                                      : 'Ongoing';
                                    return `${start} - ${end}`;
                                  }
                                }
                                // Regular date display for non-recurring appointments
                                const dateValue = selectedItemDetails.isShift
                                  ? selectedItemDetails.date
                                  : (selectedItemDetails.preferredDate || selectedItemDetails.date || selectedItemDetails.scheduledDate || selectedItemDetails.appointmentDate);
                                if (!dateValue) return 'N/A';

                                if (typeof dateValue === 'string') {
                                  const trimmed = dateValue.trim();
                                  if (!trimmed) return 'N/A';
                                  // Already formatted like "Jan 9, 2026"
                                  if (trimmed.match(/^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/)) return trimmed;
                                }

                                const parsedDate = toDateFromValue(dateValue);
                                if (parsedDate) {
                                  return parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                }

                                // Fallback: show raw string if it was a string, else N/A
                                return typeof dateValue === 'string' ? dateValue : 'N/A';
                              })()}
                            </Text>
                          </View>
                        </View>
                      )}
                      {/* Horizontal Start and End Times */}
                      <View style={styles.timeRow}>
                        <View style={[styles.timeItem, { flex: 1 }]}>
                          <MaterialCommunityIcons name="clock-time-four" size={20} color={COLORS.success} />
                          <View style={styles.timeContent}>
                            <Text style={styles.timeLabel}>Start Time</Text>
                            <Text style={styles.timeValue}>
                              {formatTimeTo12Hour(selectedItemDetails.time || selectedItemDetails.startTime || selectedItemDetails.preferredTime)}
                            </Text>
                          </View>
                        </View>
                        {selectedItemDetails.endTime && (
                          <>
                            <View style={styles.timeDashContainer}>
                              <Text style={styles.timeDash}>—</Text>
                            </View>
                            <View style={[styles.timeItem, { flex: 1 }]}>
                              <MaterialCommunityIcons name="clock-time-four" size={20} color={COLORS.error} />
                              <View style={styles.timeContent}>
                                <Text style={styles.timeLabel}>End Time</Text>
                                <Text style={styles.timeValue}>{formatTimeTo12Hour(selectedItemDetails.endTime)}</Text>
                              </View>
                            </View>
                          </>
                        )}
                      </View>
                      {/* Requested Hours */}
                      {(() => {
                        const startTime = selectedItemDetails.startTime || selectedItemDetails.time || selectedItemDetails.preferredTime;
                        const endTime = selectedItemDetails.endTime;
                        
                        if (!startTime || !endTime) return null;
                        
                        try {
                          const parseTime = (timeStr) => {
                            if (!timeStr) return null;
                            const cleaned = timeStr.trim().toUpperCase();
                            const match = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
                            if (!match) return null;
                            
                            let hours = parseInt(match[1]);
                            const minutes = parseInt(match[2]);
                            const meridiem = match[3];
                            
                            if (meridiem === 'PM' && hours !== 12) hours += 12;
                            if (meridiem === 'AM' && hours === 12) hours = 0;
                            
                            return hours * 60 + minutes;
                          };
                          
                          const startMinutes = parseTime(startTime);
                          const endMinutes = parseTime(endTime);
                          
                          if (startMinutes === null || endMinutes === null) return null;
                          
                          let diffMinutes = endMinutes - startMinutes;
                          if (diffMinutes < 0) diffMinutes += 24 * 60;
                          
                          const hours = Math.floor(diffMinutes / 60);
                          const minutes = diffMinutes % 60;
                          const totalHours = (diffMinutes / 60).toFixed(2);
                          
                          return (
                            <View style={styles.detailItem}>
                              <MaterialCommunityIcons name="clock-check" size={20} color={COLORS.primary} />
                              <View style={styles.detailContent}>
                                <Text style={styles.detailLabel}>Requested Hours</Text>
                                <Text style={styles.detailValue}>
                                  {hours}h {minutes}m ({totalHours} hours)
                                </Text>
                              </View>
                            </View>
                          );
                        } catch (error) {
                          return null;
                        }
                      })()}
                    </View>
                    )}

                      {/* Assigned Nurse Section (appointments) - place above Emergency Backup Nurses */}
                      {(() => {
                        if (selectedItemDetails.isShiftRequest || selectedItemDetails.isRecurring) return null;

                        const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                          ? selectedItemDetails.coverageRequests
                          : [];

                        // If I accepted a backup coverage request for this appointment, show the nurse who requested the backup
                        // (so the backup nurse's Booked modal shows Sara Day as the Assigned Nurse).
                        const acceptedCoverageForMe = coverageList.find((cr) => {
                          if (!cr) return false;
                          const status = normalizeStatus(cr.status);
                          if (status !== 'accepted') return false;
                          return checkIsAcceptedCoverageForNurse(
                            [cr],
                            nurseId,
                            user?.staffCode || user?.nurseCode || user?.code || user?.username
                          );
                        });

                        const resolveFromRoster = (candidateId) => {
                          if (!candidateId || !Array.isArray(nurses) || nurses.length === 0) return null;
                          return nurses.find((n) =>
                            String(n?.id || '').trim() === String(candidateId).trim() ||
                            String(n?._id || '').trim() === String(candidateId).trim() ||
                            String(n?.nurseId || '').trim() === String(candidateId).trim()
                          ) || null;
                        };

                        let assignedNurseId = null;
                        let assignedName = null;
                        let assignedCode = null;

                        if (acceptedCoverageForMe) {
                          assignedNurseId = acceptedCoverageForMe.requestingNurseId || null;
                          assignedName = acceptedCoverageForMe.requestingNurseName || null;
                          assignedCode = acceptedCoverageForMe.requestingNurseCode || null;

                          if (!assignedName && assignedNurseId) {
                            const fromRoster = resolveFromRoster(assignedNurseId);
                            if (fromRoster) {
                              assignedName = getNurseName(fromRoster);
                              assignedCode = assignedCode || fromRoster.staffCode || fromRoster.nurseCode || fromRoster.code || null;
                            }
                          }
                        } else {
                          assignedNurseId =
                            selectedItemDetails.nurseId ||
                            selectedItemDetails.assignedNurseId ||
                            selectedItemDetails.assignedNurse?.id ||
                            selectedItemDetails.assignedNurse?._id ||
                            null;

                          assignedName = selectedItemDisplayNurseName || null;
                          assignedCode =
                            selectedItemDetails.nurseCode ||
                            selectedItemDetails.nurseStaffCode ||
                            selectedItemDetails.assignedNurseCode ||
                            selectedItemDetails.assignedNurseStaffCode ||
                            selectedItemDetails.staffCode ||
                            null;
                        }

                        // If we have neither ID nor name, there's nothing useful to show.
                        if (!assignedNurseId && !assignedName) return null;

                        return (
                          <View style={styles.detailsSection}>
                            <Text style={styles.sectionTitle}>Assigned Nurse</Text>
                            <NurseInfoCard
                              variant="card"
                              nurse={{
                                id: assignedNurseId,
                                nurseId: assignedNurseId,
                                name: assignedName || 'Assigned Nurse',
                                fullName: assignedName || 'Assigned Nurse',
                                nurseCode:
                                  selectedItemDetails.nurseCode ||
                                  selectedItemDetails.nurseStaffCode ||
                                  selectedItemDetails.assignedNurseCode ||
                                  selectedItemDetails.assignedNurseStaffCode ||
                                  selectedItemDetails.staffCode ||
                                  null,
                              }}
                              nursesRoster={nurses}
                              showViewButton={true}
                              style={{ marginBottom: 0 }}
                            />
                          </View>
                        );
                      })()}

                    {/* Emergency Backup Nurses Section (below Service Information) */}
                    {(() => {
                      const backupsRaw =
                        selectedItemDetails.backupNurses ||
                        selectedItemDetails.schedule?.backupNurses ||
                        selectedItemDetails.emergencyBackupNurses ||
                        selectedItemDetails.backupNurseList;

                      const backups = Array.isArray(backupsRaw)
                        ? backupsRaw
                        : (backupsRaw && typeof backupsRaw === 'object' ? Object.values(backupsRaw) : []);

                      const shouldShowWhenEmpty = Boolean(selectedItemDetails.isShiftRequest);
                      if (!shouldShowWhenEmpty && (!backups || backups.length === 0)) return null;

                      const toPriorityNumber = (value) => {
                        const n = typeof value === 'string' ? Number(value) : value;
                        return Number.isFinite(n) ? n : null;
                      };

                      const sortedBackups = Array.isArray(backups)
                        ? backups
                            .map((b, idx) => ({ b, idx, p: toPriorityNumber(b?.priority ?? b?.order ?? b?.rank) }))
                            .sort((a, c) => {
                              if (a.p === null && c.p === null) return a.idx - c.idx;
                              if (a.p === null) return 1;
                              if (c.p === null) return -1;
                              return a.p - c.p;
                            })
                            .map(({ b }) => b)
                        : [];

                      return (
                        <View style={styles.detailsSection}>
                          <Text style={styles.sectionTitle}>Emergency Backup Nurses</Text>
                          <Text style={styles.helperText}>Priority order for emergency coverage</Text>
                          {(!sortedBackups || sortedBackups.length === 0) ? (
                            <Text style={styles.detailsNotes}>No backup nurse selected</Text>
                          ) : (
                            sortedBackups.map((backup, index) => {
                              const keysToTry = [
                                backup?.nurseId,
                                backup?.id,
                                backup?.staffCode,
                                backup?.nurseCode,
                                backup?.code,
                                backup?.username,
                              ].filter(Boolean);

                              let rosterNurse = null;
                              if (nurses && Array.isArray(nurses)) {
                                rosterNurse = nurses.find((n) => {
                                  const idMatch = keysToTry.some((k) =>
                                    [n.id, n._id, n.uid, n.nurseId].some((nid) => String(nid) === String(k))
                                  );
                                  if (idMatch) return true;

                                  const codeMatch = keysToTry.some((k) =>
                                    [n.code, n.nurseCode, n.staffCode, n.username].some(
                                      (nc) => nc && String(nc).trim().toUpperCase() === String(k).trim().toUpperCase()
                                    )
                                  );
                                  return codeMatch;
                                });
                              }

                              const displayName =
                                rosterNurse?.fullName ||
                                rosterNurse?.name ||
                                rosterNurse?.displayName ||
                                `${rosterNurse?.firstName || ''} ${rosterNurse?.lastName || ''}`.trim() ||
                                backup?.name ||
                                backup?.nurseName ||
                                backup?.fullName ||
                                'Backup Nurse';

                              const displayCode =
                                rosterNurse?.staffCode ||
                                rosterNurse?.nurseCode ||
                                rosterNurse?.code ||
                                rosterNurse?.username ||
                                backup?.staffCode ||
                                backup?.nurseCode ||
                                backup?.code ||
                                '—';

                              const photoUri =
                                rosterNurse?.profilePhoto ||
                                rosterNurse?.profileImage ||
                                rosterNurse?.photoUrl ||
                                rosterNurse?.image ||
                                backup?.profilePhoto ||
                                backup?.profileImage ||
                                backup?.photoUrl ||
                                null;

                              const nurseForCard = rosterNurse || {
                                id:
                                  backup?.nurseId ||
                                  backup?.id ||
                                  backup?.staffCode ||
                                  backup?.nurseCode ||
                                  backup?.code ||
                                  String(index),
                                _id:
                                  backup?.nurseId ||
                                  backup?.id ||
                                  backup?.staffCode ||
                                  backup?.nurseCode ||
                                  backup?.code ||
                                  String(index),
                                fullName: displayName,
                                name: displayName,
                                nurseCode: displayCode,
                                staffCode: displayCode,
                                code: displayCode,
                                profilePhoto: photoUri,
                                profileImage: photoUri,
                                photoUrl: photoUri,
                              };

                              const n = nurseForCard;
                              const backupId = normalizeId(n?.id || n?._id || n?.nurseId || n?.uid);
                              const backupCode = normalizeCode(n?.staffCode || n?.nurseCode || n?.code);

                              const isAccepted = checkIsAcceptedCoverageForNurse(
                                selectedItemDetails.coverageRequests || selectedItemDetails.shift?.coverageRequests,
                                backupId,
                                backupCode
                              );

                              let isClockedIn = false;
                              const mergedClockByNurse =
                                selectedItemDetails.clockByNurse ||
                                selectedItemDetails.shift?.clockByNurse ||
                                selectedItemDetails.shiftDetails?.clockByNurse;

                              // If this appointment itself is currently clocked-in/active,
                              // highlight whichever backup nurse matches the appointment's assigned nurse fields.
                              const appointmentStatusRaw = String(
                                selectedItemDetails.status ||
                                  selectedItemDetails.shift?.status ||
                                  selectedItemDetails.shiftDetails?.status ||
                                  ''
                              )
                                .trim()
                                .toLowerCase();

                              const appointmentIsClockedIn =
                                appointmentStatusRaw === 'clocked-in' || appointmentStatusRaw === 'active';

                              if (appointmentIsClockedIn) {
                                const assignedKeys = [
                                  selectedItemDetails.nurseId,
                                  selectedItemDetails.assignedNurseId,
                                  selectedItemDetails.assignedNurse?.id,
                                  selectedItemDetails.assignedNurse?._id,
                                  selectedItemDetails.nurseCode,
                                  selectedItemDetails.nurseStaffCode,
                                  selectedItemDetails.staffCode,
                                  selectedItemDetails.assignedNurseCode,
                                  selectedItemDetails.assignedNurseStaffCode,
                                ].filter(Boolean);

                                const matchesAssigned = assignedKeys.some((k) => {
                                  const kId = normalizeId(k);
                                  const kCode = normalizeCode(k);
                                  if (backupId && kId && backupId === kId) return true;
                                  if (backupCode && kCode && backupCode === kCode) return true;
                                  return false;
                                });

                                if (matchesAssigned) {
                                  isClockedIn = true;
                                }
                              }

                              if (!isClockedIn && mergedClockByNurse) {
                                const candidates = [
                                  backupId,
                                  backupCode,
                                  normalizeId(backup?.id),
                                  normalizeId(backup?._id),
                                ]
                                  .filter(Boolean)
                                  .map((v) => String(v).trim());

                                let entry = null;
                                for (const key of candidates) {
                                  if (mergedClockByNurse[key]) {
                                    entry = mergedClockByNurse[key];
                                    break;
                                  }
                                  const upper = key.toUpperCase();
                                  if (mergedClockByNurse[upper]) {
                                    entry = mergedClockByNurse[upper];
                                    break;
                                  }
                                  const lower = key.toLowerCase();
                                  if (mergedClockByNurse[lower]) {
                                    entry = mergedClockByNurse[lower];
                                    break;
                                  }
                                }

                                if (!entry) {
                                  const values = Object.values(mergedClockByNurse);
                                  entry = values.find((v) => {
                                    if (!v || typeof v !== 'object') return false;
                                    const vId = normalizeId(v.nurseId || v.id || v._id || v.uid);
                                    const vCode = normalizeCode(v.nurseCode || v.staffCode || v.code);
                                    if (backupId && vId && backupId === vId) return true;
                                    if (backupCode && vCode && backupCode === vCode) return true;
                                    return false;
                                  });
                                }

                                if (entry) {
                                  const hasIn =
                                    entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
                                  const hasOut =
                                    entry.lastClockOutTime ||
                                    entry.actualEndTime ||
                                    entry.clockOutTime ||
                                    entry.completedAt;
                                  isClockedIn = Boolean(hasIn) && !Boolean(hasOut);
                                }
                              }

                              return (
                                <View key={backup.nurseId || backup.id || index} style={styles.backupNurseCardWrapper}>
                                  <View style={styles.backupPriorityOverlay}>
                                    <Text style={styles.backupPriorityOverlayText}>{index + 1}</Text>
                                  </View>
                                  <NurseInfoCard
                                    nurse={nurseForCard}
                                    nursesRoster={nurses}
                                    openDetailsOnPress
                                    hideSpecialty
                                    hideCode
                                    style={isClockedIn ? styles.cardClockedIn : undefined}
                                  />
                                </View>
                              );
                            })
                          )}
                        </View>
                      );
                    })()}

                    {/* Notes (dropdown style, shown at the bottom) */}
                    {(() => {
                      const patientItems = [];
                      const nurseItems = [];

                      if (hasPatientBookingNotes && patientBookingNotes) {
                        const patientSubtitle = 'From booking';
                        patientItems.push({
                          id: `patient-booking-notes-${selectedItemDetails?.id || selectedItemDetails?._id || 'note'}`,
                          date: selectedItemDetails?.createdAt || selectedItemDetails?.updatedAt || null,
                          title: selectedItemPatientInfo?.name || 'Patient Note',
                          subtitle: patientSubtitle,
                          body: patientBookingNotes,
                        });
                      }

                      const nurseNotesBody = (() => {
                        const primary =
                          (selectedItemDetails?.nurseNotes && String(selectedItemDetails.nurseNotes).trim().length)
                            ? String(selectedItemDetails.nurseNotes).trim()
                            : '';
                        if (primary) return primary;

                        return null;
                      })();

                      const nurseNotePhotos = Array.isArray(selectedItemDetails?.nurseNotePhotos)
                        ? selectedItemDetails.nurseNotePhotos.filter((uri) => typeof uri === 'string' && uri.trim().length > 0)
                        : [];

                      if (nurseNotesBody) {
                        const nurseSubtitle =
                          selectedItemDetails?.nurseCode ||
                          selectedItemDetails?.staffCode ||
                          selectedItemDetails?.assignedNurse?.code ||
                          selectedItemDetails?.assignedNurse?.staffCode ||
                          selectedItemDetails?.assignedNurseCode ||
                          selectedItemDetails?.assignedNurseId ||
                          selectedItemDetails?.nurseId ||
                          'Nurse';

                        nurseItems.push({
                          id: `nurse-notes-${selectedItemDetails?.id || selectedItemDetails?._id || 'note'}`,
                          date: selectedItemDetails?.updatedAt || selectedItemDetails?.assignedAt || null,
                          title: selectedItemDisplayNurseName || 'Nurse Note',
                          subtitle: nurseSubtitle,
                          body: nurseNotesBody,
                          photoUrls: nurseNotePhotos,
                        });
                      }

                      const completionNotesBody =
                        (selectedItemDetails?.completionNotes && String(selectedItemDetails.completionNotes).trim().length)
                          ? selectedItemDetails.completionNotes
                          : null;

                      if (completionNotesBody) {
                        const completionSubtitle =
                          selectedItemDetails?.nurseCode ||
                          selectedItemDetails?.staffCode ||
                          selectedItemDetails?.assignedNurse?.code ||
                          selectedItemDetails?.assignedNurse?.staffCode ||
                          selectedItemDetails?.assignedNurseCode ||
                          selectedItemDetails?.assignedNurseId ||
                          selectedItemDetails?.nurseId ||
                          'Nurse';

                        nurseItems.push({
                          id: `completion-notes-${selectedItemDetails?.id || selectedItemDetails?._id || 'note'}`,
                          date: selectedItemDetails?.completedAt || selectedItemDetails?.actualEndTime || null,
                          title: selectedItemDisplayNurseName || 'Nurse Note',
                          subtitle: completionSubtitle,
                          body: completionNotesBody,
                        });
                      }

                      return (
                        <>
                          <View style={styles.detailsSection}>
                            <Text style={styles.sectionTitle}>Nurses Notes</Text>
                            <NotesAccordionList
                              items={nurseItems}
                              emptyText="No notes yet"
                              showTime
                              onPhotoPress={openNotePhotoPreview}
                            />
                          </View>
                          <View style={styles.detailsSection}>
                            <Text style={styles.sectionTitle}>Patient Notes</Text>
                            <NotesAccordionList
                              items={patientItems}
                              emptyText="No patient notes provided."
                              showTime
                              onPhotoPress={openNotePhotoPreview}
                            />
                          </View>
                        </>
                      );
                    })()}
                  </ScrollView>

                  {/* Action Buttons for pending assignments */}
                  {selectedItemDetails.status === 'assigned' && (
                    <View style={styles.modalFooter}>
                      <TouchableOpacity 
                        style={styles.modalDenyButton}
                        onPress={() => {
                          Alert.alert(
                            'Decline Assignment',
                            'Are you sure you want to decline this assignment?',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Decline',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await handleDecline(selectedItemDetails.id);
                                    setDetailsModalVisible(false);
                                    Alert.alert('Success', 'Assignment declined');
                                  } catch (error) {
                                    Alert.alert('Error', 'Failed to decline assignment');
                                  }
                                }
                              }
                            ]
                          );
                        }}
                      >
                        <Text style={styles.modalDenyButtonText}>Decline</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.modalAcceptButton}
                        onPress={async () => {
                          try {
                            await handleAccept(selectedItemDetails.id);
                            setDetailsModalVisible(false);
                            Alert.alert('Success', 'Assignment accepted');
                          } catch (error) {
                            Alert.alert('Error', 'Failed to accept assignment');
                          }
                        }}
                      >
                        <LinearGradient
                          colors={['#10b981', '#059669']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.modalAcceptButtonGradient}
                        >
                          <Text style={styles.modalAcceptButtonText}>Accept</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Action Buttons for pending recurring shifts */}
                  {selectedItemDetails.status === 'pending' && selectedItemDetails.isRecurring && (
                    <View style={styles.modalFooter}>
                      <TouchableOpacity 
                        style={styles.modalDenyButton}
                        onPress={() => {
                          Alert.alert(
                            'Decline Recurring Shift',
                            'Are you sure you want to decline this recurring shift? All shifts in this series will be cancelled.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Decline',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    const recurringDocId =
                                      selectedItemDetails?.id ||
                                      selectedItemDetails?._id ||
                                      selectedItemDetails?.shiftRequestId ||
                                      selectedItemDetails?.requestId ||
                                      selectedItemDetails?.recurringScheduleId;

                                    await handleDeclineRecurringShift(recurringDocId, 'Declined by nurse');
                                    setDetailsModalVisible(false);
                                  } catch (error) {
                                    Alert.alert('Error', 'Failed to decline recurring shift');
                                  }
                                }
                              }
                            ]
                          );
                        }}
                      >
                        <Text style={styles.modalDenyButtonText}>Decline</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.modalAcceptButton}
                        onPress={async () => {
                          try {
                            const recurringDocId =
                              selectedItemDetails?.id ||
                              selectedItemDetails?._id ||
                              selectedItemDetails?.shiftRequestId ||
                              selectedItemDetails?.requestId ||
                              selectedItemDetails?.recurringScheduleId;

                            await handleAcceptRecurringShift(recurringDocId);
                            setDetailsModalVisible(false);
                          } catch (error) {
                            Alert.alert('Error', 'Failed to accept recurring shift');
                          }
                        }}
                      >
                        <LinearGradient
                          colors={['#10b981', '#059669']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.modalAcceptButtonGradient}
                        >
                          <Text style={styles.modalAcceptButtonText}>Accept</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Action Buttons for nurse-created shift requests (including backup coverage requests) */}
                  {selectedItemDetails.isShiftRequest && !selectedItemDetails.isRecurring && (() => {
                    const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                      ? selectedItemDetails.coverageRequests
                      : [];

                    const myPendingCoverage = coverageList.find((cr) => {
                      if (!cr) return false;
                      const crStatus = String(cr.status || '').trim().toLowerCase();
                      if (crStatus !== 'pending') return false;
                      const targets = [
                        cr.targetBackupNurseId,
                        cr.targetBackupNurseStaffCode,
                        ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                      ].filter(Boolean);
                      return targets.some((t) => matchesMine(t));
                    });

                    // If this is a backup coverage request targeted at me,
                    // show Accept / Decline for coverage instead of Cancel / Reschedule.
                    if (myPendingCoverage) {
                      return (
                        <View style={styles.modalFooter}>
                          <TouchableOpacity
                            style={styles.modalDenyButton}
                            onPress={async () => {
                              try {
                                const latest = await ApiService.getShiftRequestById(selectedItemDetails.id);
                                if (!latest) throw new Error('Unable to load shift');

                                const list = Array.isArray(latest.coverageRequests)
                                  ? [...latest.coverageRequests]
                                  : [];
                                const index = list.findIndex((cr) => cr && cr.id === myPendingCoverage.id);
                                if (index === -1) {
                                  Alert.alert('Not Found', 'Backup request is no longer pending.');
                                  return;
                                }

                                const entry = { ...list[index] };
                                entry.status = 'declined';
                                entry.respondedAt = new Date().toISOString();
                                entry.responseById = user?.id === 'nurse-001' ? 'NURSE001' : user?.id;

                                list[index] = entry;

                                await ApiService.updateShiftRequest(selectedItemDetails.id, {
                                  coverageRequests: list,
                                  updatedAt: entry.respondedAt,
                                });

                                Alert.alert('Response Sent', 'You declined this backup request.');
                                setDetailsModalVisible(false);
                                setRefreshKey((prev) => prev + 1);
                              } catch (error) {
                                console.error('Failed to decline backup request:', error);
                                Alert.alert('Error', 'Failed to decline backup request.');
                              }
                            }}
                          >
                            <Text style={styles.modalDenyButtonText}>Decline</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.modalAcceptButton}
                            onPress={async () => {
                              try {
                                const latest = await ApiService.getShiftRequestById(selectedItemDetails.id);
                                if (!latest) throw new Error('Unable to load shift');

                                const list = Array.isArray(latest.coverageRequests)
                                  ? [...latest.coverageRequests]
                                  : [];
                                const index = list.findIndex((cr) => cr && cr.id === myPendingCoverage.id);
                                if (index === -1) {
                                  Alert.alert('Not Found', 'Backup request is no longer pending.');
                                  return;
                                }

                                const entry = { ...list[index] };
                                const nowIso = new Date().toISOString();
                                entry.status = 'accepted';
                                entry.respondedAt = nowIso;
                                entry.acceptedBy = user?.id === 'nurse-001' ? 'NURSE001' : user?.id;
                                entry.acceptedByStaffCode = user?.nurseCode || user?.code || null;

                                list[index] = entry;

                                // When a backup nurse accepts coverage, move the assignment
                                // to this nurse and keep the shift in approved/booked state
                                // until they actually clock in.
                                await ApiService.updateShiftRequest(selectedItemDetails.id, {
                                  coverageRequests: list,
                                  assignedNurseId: entry.acceptedBy,
                                  nurseId: entry.acceptedBy,
                                  nurseCode: entry.acceptedByStaffCode,
                                  status: 'approved',
                                  updatedAt: nowIso,
                                });

                                Alert.alert('Response Sent', 'You accepted this backup request.');
                                setDetailsModalVisible(false);
                                setRefreshKey((prev) => prev + 1);
                              } catch (error) {
                                console.error('Failed to accept backup request:', error);
                                Alert.alert('Error', 'Failed to accept backup request.');
                              }
                            }}
                          >
                            <LinearGradient
                              colors={['#10b981', '#059669']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.modalAcceptButtonGradient}
                            >
                              <Text style={styles.modalAcceptButtonText}>Accept</Text>
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      );
                    }

                    // Default nurse-created shift request actions (Cancel / Reschedule)
                    // Only show when the underlying shift request itself is pending.
                    if (selectedItemDetails.status !== 'pending') return null;

                    return (
                      <View style={styles.modalFooter}>
                        <TouchableOpacity
                          style={styles.modalDenyButton}
                          onPress={() => {
                            Alert.alert(
                              'Cancel Shift Request',
                              'Are you sure you want to cancel this shift request?',
                              [
                                { text: 'No', style: 'cancel' },
                                {
                                  text: 'Yes, Cancel',
                                  style: 'destructive',
                                  onPress: async () => {
                                    try {
                                      if (cancelShiftRequest) {
                                        await cancelShiftRequest(selectedItemDetails.id, 'Cancelled by nurse');
                                      }
                                      setDetailsModalVisible(false);
                                      setRefreshKey((prev) => prev + 1);
                                    } catch (error) {
                                      Alert.alert('Error', 'Failed to cancel shift request');
                                    }
                                  },
                                },
                              ]
                            );
                          }}
                        >
                          <Text style={styles.modalDenyButtonText}>Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.modalAcceptButton}
                          onPress={() => {
                            const details = selectedItemDetails;

                            const startDateValue =
                              details.startDate ||
                              details.schedule?.startDate ||
                              details.schedule?.date ||
                              details.date ||
                              details.preferredDate ||
                              details.scheduledDate ||
                              details.appointmentDate ||
                              '';

                            const endDateValue =
                              details.endDate ||
                              details.schedule?.endDate ||
                              startDateValue ||
                              '';

                            const backupsRaw =
                              details.backupNurses ||
                              details.schedule?.backupNurses ||
                              details.emergencyBackupNurses ||
                              details.backupNurseList;

                            const backups = Array.isArray(backupsRaw)
                              ? backupsRaw.filter(Boolean)
                              : (backupsRaw && typeof backupsRaw === 'object'
                                  ? Object.values(backupsRaw).filter(Boolean)
                                  : []);

                            setRescheduleShiftRequestId(details.id);
                            setShiftDetails((prev) => ({
                              ...prev,
                              date: startDateValue,
                              startDate: startDateValue,
                              endDate: endDateValue,
                              startTime: details.startTime || details.time || details.preferredTime || '',
                              endTime: details.endTime || '',
                              service: details.service || details.serviceName || '',
                              notes: details.notes || '',
                              clientId: details.clientId || '',
                              clientName: details.clientName || details.patientName || '',
                              clientEmail: details.clientEmail || details.patientEmail || '',
                              clientPhone: details.clientPhone || details.patientPhone || '',
                              clientAddress: details.clientAddress || details.address || '',
                            }));
                            setBackupNurses(
                              backups.map((b, i) => {
                                if (b && typeof b === 'object') {
                                  return {
                                    nurseId: b.nurseId || b.id || b._id,
                                    name: b.name || b.nurseName || b.fullName,
                                    nurseCode: b.nurseCode || b.code,
                                    priority: b.priority || i + 1,
                                  };
                                }
                                return { nurseId: String(b), name: String(b), priority: i + 1 };
                              })
                            );

                            setDetailsModalVisible(false);
                            setTimeout(() => {
                              setShiftBookingModal(true);
                            }, 200);
                          }}
                        >
                          <LinearGradient
                            colors={['#10b981', '#059669']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.modalAcceptButtonGradient}
                          >
                            <Text style={styles.modalAcceptButtonText}>Reschedule</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}

                  {/* Action Buttons for appointment coverage requests (backup targeted at me) */}
                  {!selectedItemDetails.isShiftRequest && !selectedItemDetails.isRecurring && (() => {
                    const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                      ? selectedItemDetails.coverageRequests
                      : [];

                    const myPendingCoverage = coverageList.find((cr) => {
                      if (!cr) return false;
                      const crStatus = String(cr.status || '').trim().toLowerCase();
                      if (crStatus !== 'pending') return false;
                      const targets = [
                        cr.targetBackupNurseId,
                        cr.targetBackupNurseStaffCode,
                        ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                      ].filter(Boolean);
                      return targets.some((t) => matchesMine(t));
                    });

                    if (!myPendingCoverage) return null;

                    return (
                      <View style={styles.modalFooter}>
                        <TouchableOpacity
                          style={styles.modalDenyButton}
                          onPress={async () => {
                            try {
                              const latest = await ApiService.getAppointmentById(selectedItemDetails.id);
                              if (!latest) throw new Error('Unable to load appointment');

                              const existingRequestsRaw = latest.coverageRequests || latest.backupCoverageRequests;
                              const list = Array.isArray(existingRequestsRaw) ? [...existingRequestsRaw] : [];

                              const index = list.findIndex((cr) => cr && cr.id === myPendingCoverage.id);
                              if (index === -1) {
                                Alert.alert('Not Found', 'Backup request is no longer pending.');
                                return;
                              }

                              const entry = { ...list[index] };
                              entry.status = 'declined';
                              entry.respondedAt = new Date().toISOString();
                              entry.responseById = user?.id === 'nurse-001' ? 'NURSE001' : user?.id;

                              list[index] = entry;

                              await ApiService.updateAppointment(selectedItemDetails.id, {
                                coverageRequests: list,
                                backupCoverageRequests: list,
                                updatedAt: entry.respondedAt,
                              });

                              Alert.alert('Response Sent', 'You declined this backup request.');
                              setDetailsModalVisible(false);
                              setRefreshKey((prev) => prev + 1);
                            } catch (error) {
                              console.error('Failed to decline appointment backup request:', error);
                              Alert.alert('Error', 'Failed to decline backup request.');
                            }
                          }}
                        >
                          <Text style={styles.modalDenyButtonText}>Decline</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.modalAcceptButton}
                          onPress={async () => {
                            try {
                              const latest = await ApiService.getAppointmentById(selectedItemDetails.id);
                              if (!latest) throw new Error('Unable to load appointment');

                              const existingRequestsRaw = latest.coverageRequests || latest.backupCoverageRequests;
                              const list = Array.isArray(existingRequestsRaw) ? [...existingRequestsRaw] : [];

                              const index = list.findIndex((cr) => cr && cr.id === myPendingCoverage.id);
                              if (index === -1) {
                                Alert.alert('Not Found', 'Backup request is no longer pending.');
                                return;
                              }

                              const entry = { ...list[index] };
                              const nowIso = new Date().toISOString();
                              entry.status = 'accepted';
                              entry.respondedAt = nowIso;
                              entry.acceptedBy = user?.id === 'nurse-001' ? 'NURSE001' : user?.id;
                              entry.acceptedByStaffCode = user?.nurseCode || user?.code || null;

                              list[index] = entry;

                              await ApiService.updateAppointment(selectedItemDetails.id, {
                                coverageRequests: list,
                                backupCoverageRequests: list,
                                nurseId: entry.acceptedBy,
                                nurseCode: entry.acceptedByStaffCode,
                                status: latest.status || 'confirmed',
                                updatedAt: nowIso,
                              });

                              Alert.alert('Response Sent', 'You accepted this backup request.');
                              setDetailsModalVisible(false);
                              setRefreshKey((prev) => prev + 1);
                            } catch (error) {
                              console.error('Failed to accept appointment backup request:', error);
                              Alert.alert('Error', 'Failed to accept backup request.');
                            }
                          }}
                        >
                          <LinearGradient
                            colors={['#10b981', '#059669']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.modalAcceptButtonGradient}
                          >
                            <Text style={styles.modalAcceptButtonText}>Accept</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}

                  {/* Action Buttons for confirmed/active appointments */}
                  {(() => {
                    const normalizedStatus = (selectedItemDetails.status || '').toLowerCase();
                    const statusImpliesAppointment = normalizedStatus === 'confirmed' || normalizedStatus === 'clocked-in';
                    const isRegularAppointment =
                      !selectedItemDetails.isShiftRequest &&
                      !selectedItemDetails.isRecurring &&
                      (statusImpliesAppointment || !selectedItemDetails.isShift);
                    const eligibleStatuses = ['confirmed', 'clocked-in', 'active'];
                    // Don't show clock buttons for completed appointments
                    if (!isRegularAppointment || !eligibleStatuses.includes(normalizedStatus) || normalizedStatus === 'completed') {
                      return null;
                    }

                    // Hide clock/notes/backup when there is a pending coverage request targeting me
                    const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                      ? selectedItemDetails.coverageRequests
                      : [];
                    const hasPendingCoverageForMe = coverageList.some((cr) => {
                      if (!cr) return false;
                      const crStatus = String(cr.status || '').trim().toLowerCase();
                      if (crStatus !== 'pending') return false;
                      const targets = [
                        cr.targetBackupNurseId,
                        cr.targetBackupNurseStaffCode,
                        ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                      ].filter(Boolean);
                      return targets.some((t) => matchesMine(t));
                    });
                    if (hasPendingCoverageForMe) return null;

                    const hasAppointmentClockIn = Boolean(selectedItemDetails.actualStartTime || selectedItemDetails.startedAt);
                    const clockInTimeReached = canClockInForShiftNow(selectedItemDetails);
                    const clockInAllowed = !hasAppointmentClockIn && clockInTimeReached;

                    // Booked (confirmed) regular appointments: Clock In + Add Notes + Back-up
                    if (normalizedStatus === 'confirmed') {
                      return (
                        <View style={styles.modalFooter}>
                          <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                            <TouchableOpacity
                              style={[styles.modalActionButton, { flex: 1 }]}
                              onPress={() => openAddNotesFromDetails(selectedItemDetails)}
                            >
                              <Text style={styles.modalActionButtonText}>Add Notes</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.modalActionButton, { flex: 1 }]}
                              onPress={() => handleRequestBackupForAppointment(selectedItemDetails)}
                            >
                              <Text style={styles.modalActionButtonText}>Back-up</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.clockInButton, { flex: 1 }]}
                              disabled={!clockInAllowed}
                              onPress={() => {
                                if (!clockInAllowed) {
                                  const scheduled = getShiftScheduledStartDateTime(selectedItemDetails);
                                  Alert.alert(
                                    'Not Yet',
                                    scheduled
                                      ? `You can clock in once your appointment starts at ${scheduled.toLocaleTimeString()}.`
                                      : 'You can clock in once the appointment start time is reached.'
                                  );
                                  return;
                                }
                                handleAppointmentClockIn(selectedItemDetails);
                              }}
                            >
                              <LinearGradient
                                colors={clockInAllowed ? ['#10b981', '#059669'] : ['#cbd5f5', '#cbd5f5']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.clockButtonGradient}
                              >
                                <Text style={styles.clockButtonText}>Clock In</Text>
                              </LinearGradient>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    }

                    // Active/clocked-in regular appointments: Add Notes + Clock Out.
                    const isClockInDisabled = !clockInAllowed;
                    const isClockOutDisabled = !hasAppointmentClockIn || Boolean(selectedItemDetails.actualEndTime);

                    return (
                      <View style={[styles.modalFooter, { gap: 8 }]}>
                        <TouchableOpacity
                          style={[styles.modalActionButton, { flex: 1 }]}
                          onPress={() => openAddNotesFromDetails(selectedItemDetails)}
                        >
                          <Text style={styles.modalActionButtonText}>Add Notes</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.clockInButton, { flex: 1, opacity: isClockOutDisabled ? 0.5 : 1 }]}
                          disabled={isClockOutDisabled}
                          onPress={() => {
                            const item = selectedItemDetails;
                            setDetailsModalVisible(false);
                            setTimeout(() => {
                              handleAppointmentClockOut(item);
                            }, 500);
                          }}
                        >
                          <LinearGradient
                            colors={['#ef4444', '#dc2626']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.clockButtonGradient}
                          >
                            <Text style={styles.clockButtonText}>Clock Out</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}

                  {/* Action Buttons for approved/booked shifts */}
                  {(() => {
                    const normalizedStatus = (selectedItemDetails.status || '').toLowerCase();
                    const isShiftItem = !!selectedItemDetails.isShift;
                    // Don't show clock buttons for completed shifts
                    if (!isShiftItem || (normalizedStatus !== 'approved' && normalizedStatus !== 'active') || normalizedStatus === 'completed') {
                      return null;
                    }

                    // If there is a pending backup coverage request targeting this nurse,
                    // hide the Add Notes / Back-up / Clock In controls so that
                    // the nurse only sees Accept / Decline for coverage.
                    const coverageList = Array.isArray(selectedItemDetails.coverageRequests)
                      ? selectedItemDetails.coverageRequests
                      : [];
                    const hasPendingCoverageForMe = coverageList.some((cr) => {
                      if (!cr) return false;
                      const crStatus = String(cr.status || '').trim().toLowerCase();
                      if (crStatus !== 'pending') return false;
                      const targets = [
                        cr.targetBackupNurseId,
                        cr.targetBackupNurseStaffCode,
                        ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                      ].filter(Boolean);
                      return targets.some((t) => matchesMine(t));
                    });

                    if (hasPendingCoverageForMe) return null;

                    const hasClockIn = Boolean(
                      selectedItemDetails.actualStartTime ||
                      selectedItemDetails.startedAt ||
                      selectedItemDetails.clockInLocation
                    );

                    // Handle startedBy being an object or string
                    const startedByVal = selectedItemDetails?.startedBy;
                    const startedById = (typeof startedByVal === 'object' && startedByVal !== null)
                      ? (startedByVal.id || startedByVal._id || startedByVal.uid)
                      : startedByVal;

                    // Only treat startedByMe as true if startedBy matches me,
                    // or I have an active clock-in record.
                    const startedByMe = startedById
                      ? matchesMine(startedById)
                      : (hasClockIn ? hasActiveClockInByMe(selectedItemDetails) : false);

                    // In the Booked flow, we always keep the three-button footer.
                    // Only show Clock Out when *I* started this shift.
                    const showClockOut = startedByMe && hasClockIn && !selectedItemDetails.actualEndTime;

                    if (showClockOut) {
                      return (
                        <View style={styles.modalFooter}>
                          <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                            <TouchableOpacity
                              style={[styles.modalActionButton, { flex: 1 }]}
                              onPress={() => openAddNotesFromDetails(selectedItemDetails)}
                            >
                              <Text style={styles.modalActionButtonText}>Add Notes</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.clockInButton, { flex: 1 }]}
                              onPress={() => {
                                const item = selectedItemDetails;
                                setDetailsModalVisible(false);
                                setTimeout(() => {
                                  handleClockOut(item);
                                }, 500);
                              }}
                            >
                              <LinearGradient
                                colors={['#ef4444', '#dc2626']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.clockButtonGradient}
                              >
                                <Text style={styles.clockButtonText}>Clock Out</Text>
                              </LinearGradient>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    }

                    const clockInAllowed = !hasClockIn && canClockInForShiftNow(selectedItemDetails);
                    const clockInLabel = 'Clock In';

                    return (
                      <View style={styles.modalFooter}>
                        <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                          <TouchableOpacity
                            style={[styles.modalActionButton, { flex: 1 }]}
                            onPress={() => openAddNotesFromDetails(selectedItemDetails)}
                          >
                            <Text style={styles.modalActionButtonText}>Add Notes</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.modalActionButton, { flex: 1 }]}
                            onPress={() => handleRequestBackupForShift(selectedItemDetails)}
                          >
                            <Text style={styles.modalActionButtonText}>Back-up</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.clockInButton, { flex: 1 }]}
                            disabled={!clockInAllowed}
                            onPress={() => {
                              if (clockInAllowed) {
                                handleClockIn(selectedItemDetails);
                              } else if (hasClockIn && !startedByMe) {
                                Alert.alert('Already Started', 'This shift was already started by another nurse.');
                              } else {
                                const scheduled = getShiftScheduledStartDateTime(selectedItemDetails);
                                Alert.alert(
                                  'Not Yet',
                                  scheduled
                                    ? `You can clock in once your shift starts at ${scheduled.toLocaleTimeString()}.`
                                    : 'You can clock in once your shift start time is reached.'
                                );
                              }
                            }}
                          >
                            <LinearGradient
                              colors={clockInAllowed ? ['#10b981', '#059669'] : ['#cbd5f5', '#cbd5f5']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.clockButtonGradient}
                            >
                              <Text style={styles.clockButtonText}>{clockInLabel}</Text>
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })()}
                </>
              )}

              {/* Photo preview shown inside the Appointment Details modal */}
              {notePhotoPreviewVisible && notePhotoPreviewUri ? (
                <View style={styles.photoPreviewOverlayInModal}>
                  <TouchableOpacity
                    style={styles.photoPreviewOverlayTapArea}
                    activeOpacity={1}
                    onPress={() => {
                      setNotePhotoPreviewVisible(false);
                      setNotePhotoPreviewUri('');
                    }}
                  >
                    <View style={styles.photoPreviewImageFrame}>
                      <Image
                        source={{ uri: notePhotoPreviewUri }}
                        style={styles.photoPreviewImage}
                        resizeMode="contain"
                      />
                    </View>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        </Modal>

        {/* Time Tracking Notes Modal */}
        {/* Notes Modal - styled like RecurringShiftDetailsModal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={notesModalVisible}
          onRequestClose={resetNotesModalState}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.notesModalOverlay}>
            <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={styles.notesModalContainer}>
              {/* Header */}
              <Text style={styles.notesModalTitle}>
                {actionType === 'clockin' ? 'Starting Shift' : 
                 actionType === 'clockout' ? 'Ending Shift' : 
                 actionType === 'complete' ? 'Complete Appointment' : 'Add Notes'}
              </Text>
              
              {/* Scrollable Content */}
              <ScrollView 
                style={styles.notesModalContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Service Information Section */}
                {selectedItemForNotes && (
                  <View style={styles.serviceInfoSection}>
                    <Text style={styles.serviceInfoTitle}>Service Information</Text>
                    <View style={styles.serviceInfoCard}>
                      <MaterialCommunityIcons name="medical-bag" size={20} color={COLORS.primary} />
                      <Text style={styles.serviceInfoText}>
                        {selectedItemForNotes.service || selectedItemForNotes.serviceName || 'N/A'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Nurse Clock Details for completion */}
                {actionType === 'complete' && selectedItemForNotes && (() => {
                  const clockInTime = selectedItemForNotes.actualStartTime || selectedItemForNotes.clockInTime || selectedItemForNotes.startedAt;
                  const clockOutTime = new Date().toISOString(); // Current time as clock out
                  
                  // Calculate total hours
                  const calculateHours = () => {
                    if (!clockInTime) return 'N/A';
                    const clockIn = new Date(clockInTime);
                    const clockOut = new Date(clockOutTime);
                    const diffMs = clockOut - clockIn;
                    const diffHours = diffMs / (1000 * 60 * 60);
                    return `${diffHours.toFixed(2)} hours`;
                  };

                  return (
                    <View style={styles.nurseClockCard}>
                      <View style={styles.nurseClockHeader}>
                        <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                        <Text style={styles.nurseClockTitle}>Your Shift Summary</Text>
                      </View>
                      
                      <View style={styles.clockTimesContainer}>
                        <View style={styles.clockTimeRow}>
                          <View style={styles.clockTimeItem}>
                            <MaterialCommunityIcons name="clock-check" size={16} color={COLORS.success} />
                            <Text style={styles.clockTimeLabel}>Clock In</Text>
                            <Text style={styles.clockTimeValue}>
                              {clockInTime ? new Date(clockInTime).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              }) : 'N/A'}
                            </Text>
                          </View>
                          
                          <View style={styles.clockTimeItem}>
                            <MaterialCommunityIcons name="clock-check-outline" size={16} color={COLORS.primary} />
                            <Text style={styles.clockTimeLabel}>Clock Out</Text>
                            <Text style={styles.clockTimeValue}>
                              {new Date(clockOutTime).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </Text>
                          </View>
                        </View>
                        
                        <View style={styles.totalHoursRow}>
                          <MaterialCommunityIcons name="clock" size={16} color={COLORS.accent} />
                          <Text style={styles.totalHoursLabel}>Total Hours:</Text>
                          <Text style={styles.totalHoursValue}>{calculateHours()}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                <TextInput
                  style={[
                    styles.notesModalInput,
                    shiftNotes ? { 
                      textAlign: 'left', 
                      textAlignVertical: 'top',
                      fontSize: 16 
                    } : { 
                      fontSize: 14 
                    }
                  ]}
                  placeholder={
                    actionType === 'clockin' 
                      ? 'Add any notes for the start of your shift...'
                      : actionType === 'clockout'
                      ? selectedShiftForClockOut ? 'Add notes for shift completion...' : 'Add any notes for the end of your shift...'
                      : actionType === 'complete'
                      ? 'Add completion notes for this appointment...'
                      : actionType === 'addnotes'
                      ? (selectedItemForNotes && !(selectedItemForNotes.isShift || selectedItemForNotes.isShiftRequest || selectedItemForNotes.adminRecurring)
                          ? 'Add notes about this appointment...'
                          : 'Add notes about this shift...')
                      : 'Add notes...'
                  }
                  placeholderTextColor="#D1D5DB"
                  value={shiftNotes}
                  onChangeText={setShiftNotes}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  autoFocus={true}
                />

                {actionType === 'addnotes' && (
                  <View style={styles.vitalsModalSection}>
                    <Text style={styles.vitalsModalSectionTitle}>
                      Patient Vitals{' '}
                      <Text style={styles.vitalsModalOptional}>(optional)</Text>
                    </Text>
                    <View style={styles.vitalsModalRow}>
                      <View style={styles.vitalsModalField}>
                        <Text style={styles.vitalsModalLabel}>BP (Sys)</Text>
                        <TextInput
                          style={styles.vitalsModalInput}
                          placeholder="120"
                          placeholderTextColor={COLORS.textMuted}
                          value={noteVitals.bpSystolic}
                          onChangeText={(t) => setNoteVitals(prev => ({ ...prev, bpSystolic: t }))}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                          returnKeyType="done"
                        />
                      </View>
                      <View style={styles.vitalsModalField}>
                        <Text style={styles.vitalsModalLabel}>BP (Dia)</Text>
                        <TextInput
                          style={styles.vitalsModalInput}
                          placeholder="80"
                          placeholderTextColor={COLORS.textMuted}
                          value={noteVitals.bpDiastolic}
                          onChangeText={(t) => setNoteVitals(prev => ({ ...prev, bpDiastolic: t }))}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                          returnKeyType="done"
                        />
                      </View>
                    </View>
                    <View style={styles.vitalsModalRow}>
                      <View style={styles.vitalsModalField}>
                        <Text style={styles.vitalsModalLabel}>HR (bpm)</Text>
                        <TextInput
                          style={styles.vitalsModalInput}
                          placeholder="72"
                          placeholderTextColor={COLORS.textMuted}
                          value={noteVitals.heartRate}
                          onChangeText={(t) => setNoteVitals(prev => ({ ...prev, heartRate: t }))}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                          returnKeyType="done"
                        />
                      </View>
                      <View style={styles.vitalsModalField}>
                        <Text style={styles.vitalsModalLabel}>Temp (°F)</Text>
                        <TextInput
                          style={styles.vitalsModalInput}
                          placeholder="98.6"
                          placeholderTextColor={COLORS.textMuted}
                          value={noteVitals.temperature}
                          onChangeText={(t) => setNoteVitals(prev => ({ ...prev, temperature: t }))}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                          returnKeyType="done"
                        />
                      </View>
                    </View>
                    <View style={styles.vitalsModalRow}>
                      <View style={styles.vitalsModalField}>
                        <Text style={styles.vitalsModalLabel}>SpO₂ (%)</Text>
                        <TextInput
                          style={styles.vitalsModalInput}
                          placeholder="98"
                          placeholderTextColor={COLORS.textMuted}
                          value={noteVitals.oxygenSaturation}
                          onChangeText={(t) => setNoteVitals(prev => ({ ...prev, oxygenSaturation: t }))}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                          returnKeyType="done"
                        />
                      </View>
                      <View style={{ flex: 1 }} />
                    </View>
                  </View>
                )}

                {actionType === 'addnotes' && (
                  <View style={styles.notePhotosSection}>
                    <TouchableOpacity
                      style={styles.notePhotosAddButton}
                      onPress={pickNotePhotos}
                      disabled={notePhotoPickerBusy || isSavingNotes}
                    >
                      <MaterialCommunityIcons name="camera-plus" size={18} color={COLORS.primary} />
                      <Text style={styles.notePhotosAddButtonText}>
                        {notePhotoPickerBusy ? 'Opening...' : 'Add Photo'}
                      </Text>
                    </TouchableOpacity>

                    {notePhotoUris.length > 0 && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.notePhotosList}
                      >
                        {notePhotoUris.map((uri, index) => (
                          <View key={`${uri}-${index}`} style={styles.notePhotoThumbWrap}>
                            <TouchableOpacity onPress={() => openNotePhotoPreview(uri)}>
                              <Image source={{ uri }} style={styles.notePhotoThumb} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.notePhotoRemoveButton}
                              onPress={() => removeNotePhoto(index)}
                              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                            >
                              <MaterialCommunityIcons name="close-circle" size={20} color={COLORS.error} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
              </ScrollView>

              {/* Fixed button row */}
              <View style={styles.notesModalButtonRow}>
                  <TouchableOpacity
                    style={styles.notesModalCancelButton}
                    onPress={resetNotesModalState}
                  >
                    <Text style={styles.notesModalCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.notesModalSaveButton, isSavingNotes ? { opacity: 0.6 } : null]}
                    disabled={isSavingNotes}
                    onPress={confirmClockAction}
                  >
                    <LinearGradient
                      colors={['#10b981', '#059669']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.notesModalSaveButtonGradient}
                    >
                      <Text style={styles.notesModalSaveButtonText}>
                        {isSavingNotes
                          ? 'Saving...'
                          : actionType === 'clockin' ? 'Clock In' : 
                         actionType === 'clockout' ? 'Clock Out' : 
                         actionType === 'complete' ? 'Complete' : 'Save'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>

                {/* Photo preview shown inside the Add Notes modal */}
                {notePhotoPreviewVisible && notePhotoPreviewUri ? (
                  <View style={styles.photoPreviewOverlayInModal}>
                    <TouchableOpacity
                      style={styles.photoPreviewOverlayTapArea}
                      activeOpacity={1}
                      onPress={() => {
                        setNotePhotoPreviewVisible(false);
                        setNotePhotoPreviewUri('');
                      }}
                    >
                      <View style={styles.photoPreviewImageFrame}>
                        <Image
                          source={{ uri: notePhotoPreviewUri }}
                          style={styles.photoPreviewImage}
                          resizeMode="contain"
                        />
                      </View>
                    </TouchableOpacity>
                  </View>
                ) : null}
            </View>
            </TouchableWithoutFeedback>
          </View>
          </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {/* Shift Booking Modal */}
        <Modal
          visible={shiftBookingModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShiftBookingModal(false)}
          presentationStyle="overFullScreen"
          statusBarTranslucent={true}
          onDismiss={() => {
            // iOS only: used to sequence opening the backup details modal safely.
            setShiftBookingDidDismiss(true);
            console.log('[Shift Booking] onDismiss fired');
          }}
        >
          <View style={styles.detailsModalOverlay}>
            <View style={styles.shiftRequestModalContent}>
              <View style={styles.detailsModalHeader}>
                <Text style={styles.detailsModalTitle}>Request New Shift</Text>
                <TouchableOpacity
                  onPress={() => {
                    resetShiftForm();
                    setShiftBookingModal(false);
                  }}
                >
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              <ScrollView 
                style={styles.appointmentDetailsContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.modalSubtitle}>
                  Submit a shift request for admin approval
                </Text>

                {/* Client Selection - New Style */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Select Client (Optional)</Text>
                  <View style={styles.clientSearchContainer}>
                    <View style={styles.pickerInputContainer}>
                      {selectedClient ? (
                        (() => {
                          const clientPhoto =
                            selectedClient?.profilePhoto ||
                            selectedClient?.profileImage ||
                            selectedClient?.photoUrl ||
                            selectedClient?.image ||
                            null;
                          const initials = (selectedClient?.name || '')
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() || '')
                            .join('') || 'C';

                          return clientPhoto ? (
                            <Image source={{ uri: clientPhoto }} style={styles.clientAvatar} />
                          ) : (
                            <View style={styles.clientAvatarFallback}>
                              <Text style={styles.clientInitials}>{initials}</Text>
                            </View>
                          );
                        })()
                      ) : (
                        <MaterialCommunityIcons name="account-group" size={20} color={COLORS.primary} />
                      )}
                      <TextInput
                        style={styles.clientSearchInput}
                        value={selectedClient ? selectedClient.name : clientSearchText}
                        onChangeText={(text) => {
                          setClientSearchText(text);
                          setSelectedClient(null);
                        }}
                        onFocus={() => setIsClientFocused(true)}
                        onBlur={() => setTimeout(() => setIsClientFocused(false), 200)}
                        placeholder="Search client name..."
                        placeholderTextColor={COLORS.textLight}
                      />
                      {selectedClient && (
                        <TouchableWeb
                          onPress={() => {
                            setSelectedClient(null);
                            setClientSearchText('');
                            setShiftDetails({
                              ...shiftDetails,
                              clientId: '',
                              clientName: ''
                            });
                          }}
                          style={styles.clearButton}
                        >
                          <MaterialCommunityIcons name="close-circle" size={20} color={COLORS.textLight} />
                        </TouchableWeb>
                      )}
                    </View>
                    
                    {(isClientFocused || (clientSearchText.length > 0 && !selectedClient)) && (
                      <View style={styles.clientDropdown}>
                        <ScrollView 
                          style={styles.clientDropdownScroll} 
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                        >
                          {filteredClients.length > 0 ? filteredClients.map((client) => {
                            const clientPhoto = client.profilePhoto || client.profileImage || client.photoUrl || client.image;
                            const initials = client.name
                              .split(' ')
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0]?.toUpperCase() || '')
                              .join('') || 'C';
                            
                            return (
                              <TouchableOpacity
                                key={client.id}
                                style={styles.clientItem}
                                onPress={() => handleClientSelect(client)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.clientItemContent}>
                                  {clientPhoto ? (
                                    <Image source={{ uri: clientPhoto }} style={styles.clientAvatar} />
                                  ) : (
                                    <View style={styles.clientAvatarFallback}>
                                      <Text style={styles.clientInitials}>{initials}</Text>
                                    </View>
                                  )}
                                  <View style={styles.clientInfo}>
                                    <Text style={styles.clientName}>{client.name}</Text>
                                    {client.email && <Text style={styles.clientEmail}>{client.email}</Text>}
                                  </View>
                                </View>
                              </TouchableOpacity>
                            );
                          }) : (
                            <View style={styles.clientItem}>
                              <Text style={styles.clientEmail}>No clients found</Text>
                            </View>
                          )}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>

                {/* Backup Nurse Selection */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Emergency Backup Nurses</Text>
                    {backupNurses.map((backup, index) => {
                      const keysToTry = [
                        backup?.nurseId,
                        backup?.id,
                        backup?.staffCode,
                        backup?.nurseCode,
                        backup?.code,
                        backup?.username,
                      ].filter(Boolean);

                      let rosterNurse = null;
                      if (Array.isArray(nurses) && nurses.length > 0) {
                        rosterNurse = nurses.find((nurse) => {
                          const matchesId = keysToTry.some((key) =>
                            [nurse.id, nurse._id, nurse.uid, nurse.nurseId].some((candidate) =>
                              candidate && key && String(candidate).trim() === String(key).trim()
                            )
                          );
                          if (matchesId) return true;

                          return keysToTry.some((key) =>
                            [nurse.code, nurse.nurseCode, nurse.staffCode, nurse.username].some((candidate) =>
                              candidate && key && String(candidate).trim().toUpperCase() === String(key).trim().toUpperCase()
                            )
                          );
                        });
                      }

                      const displayName =
                        rosterNurse?.fullName ||
                        rosterNurse?.name ||
                        `${rosterNurse?.firstName || ''} ${rosterNurse?.lastName || ''}`.trim() ||
                        backup?.name ||
                        backup?.nurseName ||
                        backup?.fullName ||
                        'Backup Nurse';

                      const displayCode =
                        rosterNurse?.staffCode ||
                        rosterNurse?.nurseCode ||
                        rosterNurse?.code ||
                        rosterNurse?.username ||
                        backup?.staffCode ||
                        backup?.nurseCode ||
                        backup?.code ||
                        '—';

                      const photoUri =
                        rosterNurse?.profilePhoto ||
                        rosterNurse?.profileImage ||
                        rosterNurse?.photoUrl ||
                        rosterNurse?.image ||
                        backup?.profilePhoto ||
                        backup?.profileImage ||
                        backup?.photoUrl ||
                        null;

                      const initials = displayName
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() || '')
                        .join('') || 'BN';

                      return (
                        <View key={backup.nurseId || backup.id || index} style={styles.backupNurseCard}>
                          <View style={styles.priorityBadge}>
                            <Text style={styles.priorityBadgeText}>{index + 1}</Text>
                          </View>
                          {photoUri ? (
                            <Image source={{ uri: photoUri }} style={styles.backupNurseAvatar} />
                          ) : (
                            <View style={styles.backupNurseAvatarFallback}>
                              <Text style={styles.backupNurseInitials}>{initials}</Text>
                            </View>
                          )}
                          <View style={styles.backupNurseInfo}>
                            <Text style={styles.backupNurseName}>{displayName}</Text>
                            <Text style={styles.backupNurseMeta}>Staff Code: {displayCode}</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.removeBackupButton}
                            onPress={() => {
                              const newBackups = backupNurses.filter((_, i) => i !== index);
                              setBackupNurses(newBackups);
                            }}
                            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                          >
                            <MaterialCommunityIcons name="close-circle" size={22} color={COLORS.error} />
                          </TouchableOpacity>
                        </View>
                      );
                    })}

                   <TouchableOpacity 
                      style={styles.pickerInputContainer}
                      onPress={() => {
                        setBackupPickerVisible(true);
                        setShowBackupNurseDropdown(false);
                      }}
                   >
                      <MaterialCommunityIcons name="account-search" size={20} color={COLORS.primary} />
                      <Text style={[styles.clientSearchInput, { color: backupNurseSearch ? COLORS.text : COLORS.textLight }]}>
                        {backupNurseSearch || 'Add backup nurse...'}
                      </Text>
                   </TouchableOpacity>
                   {/* Backup nurse picker overlay modal */}
                   <Modal
                     visible={backupPickerVisible}
                     transparent={true}
                     animationType="fade"
                     onRequestClose={() => setBackupPickerVisible(false)}
                     presentationStyle="overFullScreen"
                     statusBarTranslucent={true}
                     onDismiss={() => {
                       // iOS only: ensure picker is fully dismissed before showing details
                       setBackupPickerDidDismiss(true);
                       if (pendingBackupCandidateDetails && selectedBackupCandidate) {
                         console.log('[Backup Picker] onDismiss fired');
                       }

                        // IMPORTANT: if the shift booking modal was open, close it only AFTER
                        // the picker has fully dismissed; otherwise iOS can unmount the picker
                        // without ever firing this onDismiss callback.
                        if (closeShiftAfterBackupPickerDismiss) {
                          setCloseShiftAfterBackupPickerDismiss(false);
                          setShiftBookingModal(false);
                        }
                     }}
                   >
                     <TouchableWeb style={styles.detailsModalOverlay} activeOpacity={1} onPress={() => setBackupPickerVisible(false)}>
                       <TouchableWeb activeOpacity={1} onPress={(e) => e.stopPropagation()}>
                         <View style={styles.pickerModalContent}>
                           <View style={styles.detailsModalHeader}>
                             <Text style={styles.detailsModalTitle}>Select Backup Nurse</Text>
                             <TouchableWeb onPress={() => setBackupPickerVisible(false)}>
                               <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                             </TouchableWeb>
                           </View>
                           <View style={styles.appointmentDetailsContent}>
                             <View style={styles.pickerInputContainer}>
                               <MaterialCommunityIcons name="account-search" size={20} color={COLORS.primary} />
                               <TextInput
                                 style={styles.clientSearchInput}
                                 placeholder="Search by name or code"
                                 value={backupNurseSearch}
                                 onChangeText={(text) => {
                                   setBackupNurseSearch(text);
                                   const relevant = nurses.filter(n => {
                                     const name = ((n.firstName || '') + ' ' + (n.lastName || '')).toLowerCase();
                                     const code = (n.code || n.nurseCode || n.staffCode || '').toLowerCase();
                                     const q = text.toLowerCase();
                                     // Filter out: current user, inactive nurses, already selected backup nurses
                                     const isCurrentUser = n.id === user?.id || n._id === user?.id;
                                     const isInactive = n.isActive === false || n.active === false;
                                     const isAlreadySelected = backupNurses.some(b => (b.nurseId === n.id || b.id === n.id || b.id === n._id));
                                     return (name.includes(q) || code.includes(q)) && !isCurrentUser && !isInactive && !isAlreadySelected;
                                   });
                                   setFilteredBackupNurses(relevant);
                                 }}
                                 placeholderTextColor={COLORS.textLight}
                               />
                             </View>
                             <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                               {(filteredBackupNurses.length ? filteredBackupNurses : nurses.filter(n => {
                                 // Filter out: current user, inactive nurses, already selected backup nurses
                                 const isCurrentUser = n.id === user?.id || n._id === user?.id;
                                 const isInactive = n.isActive === false || n.active === false;
                                 const isAlreadySelected = backupNurses.some(b => (b.nurseId === n.id || b.id === n.id || b.id === n._id));
                                 return !isCurrentUser && !isInactive && !isAlreadySelected;
                               })).map((nurse, index) => {
                                 const displayName = `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim() || nurse.fullName || nurse.name || 'Backup Nurse';
                                 const displayCode = nurse.code || nurse.nurseCode || nurse.staffCode || '—';
                                 const photoUri = nurse.profilePhoto || nurse.profileImage || nurse.photoUrl || null;
                                 const key = nurse.id || nurse._id || `backup-${index}`;
                                 return (
                                   <View key={key} style={styles.compactCard}>
                                     <View style={styles.compactHeader}>
                                       {photoUri ? (
                                         <Image source={{ uri: photoUri }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                                       ) : (
                                         <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' }}>
                                           <MaterialCommunityIcons name="account-heart" size={20} color={COLORS.white} />
                                         </View>
                                       )}
                                       <View style={styles.compactInfo}>
                                         <Text style={styles.compactClient}>{displayName}</Text>
                                         <Text style={styles.clientEmail}>Staff Code: {displayCode}</Text>
                                       </View>
                                       <TouchableWeb
                                         style={styles.detailsButton}
                                         onPress={() => {
                                           console.log('View button pressed for backup nurse:', displayName);
                                           setSelectedBackupCandidate({
                                             ...nurse,
                                             displayName,
                                             displayCode,
                                             photoUri,
                                           });
                                           setPendingBackupCandidateDetails(true);
                                           setBackupCandidateDetailsVisible(false);
                                           // If the shift booking modal is open, close it ONLY after the picker dismisses.
                                           // Closing the parent modal first can prevent the picker onDismiss from firing.
                                           if (shiftBookingModal) {
                                             setResumeShiftModalAfterDetails(true);
                                             setCloseShiftAfterBackupPickerDismiss(true);
                                           }

                                           setBackupPickerVisible(false);
                                         }}
                                         activeOpacity={0.8}
                                       >
                                         <LinearGradient
                                           colors={SAFE_GRADIENTS.header}
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
                                 );
                               })}
                             </ScrollView>
                           </View>
                         </View>
                       </TouchableWeb>
                     </TouchableWeb>
                   </Modal>
                </View>

                {/* Service */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Service</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.serviceScrollView}
                    contentContainerStyle={styles.serviceScrollContent}
                  >
                    {services.map((service) => {
                      const isSelected = shiftDetails.service === service.title;

                      return (
                        <TouchableWeb
                          key={service.id}
                          style={styles.serviceChip}
                          onPress={() => setShiftDetails({ ...shiftDetails, service: service.title })}
                          activeOpacity={0.7}
                        >
                          {isSelected ? (
                            <LinearGradient
                              colors={SAFE_GRADIENTS.header}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.serviceChipGradient}
                              pointerEvents="none"
                            >
                              <MaterialCommunityIcons name={service.icon} size={16} color={COLORS.white} />
                              <Text style={styles.serviceChipTextSelected}>{service.title}</Text>
                            </LinearGradient>
                          ) : (
                            <View style={styles.inactiveServiceChip} pointerEvents="none">
                              <MaterialCommunityIcons name={service.icon} size={16} color={COLORS.primary} />
                              <Text style={styles.serviceChipText}>{service.title}</Text>
                            </View>
                          )}
                        </TouchableWeb>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* Days of Week Selection */}
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Days of Week (Optional)</Text>
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    style={styles.daysScroll}
                  >
                    {DAYS_OF_WEEK.map(day => (
                      <TouchableOpacity
                        key={day.value}
                        style={styles.dayPill}
                        onPress={() => toggleDay(day.value)}
                      >
                        {selectedDays.includes(day.value) ? (
                          <LinearGradient
                            colors={SAFE_GRADIENTS.header}
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
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Date Selection - Start and End Date */}
                <View style={[styles.inputRow, { marginTop: 12, marginBottom: 10 }]}>
                   <View style={[styles.inputContainer, { flex: 1, marginRight: 8, marginBottom: 0 }]}>
                    <Text style={styles.inputLabel}>Start Date</Text>
                    <TouchableWeb 
                      style={[styles.pickerInputContainer, { marginBottom: 0 }]}
                      onPress={() => setShowStartDatePicker(true)}
                    >
                      <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                      <Text style={[styles.pickerInput, { color: shiftDetails.startDate ? COLORS.textDark : COLORS.textLight }]}>
                        {shiftDetails.startDate ? formatDateDisplay(shiftDetails.startDate) : 'Select date'}
                      </Text>
                    </TouchableWeb>
                  </View>

                  <View style={[styles.inputContainer, { flex: 1, marginLeft: 8, marginBottom: 0 }]}>
                    <Text style={styles.inputLabel}>End Date</Text>
                    <TouchableWeb 
                      style={[styles.pickerInputContainer, { marginBottom: 0 }]}
                      onPress={() => setShowEndDatePicker(true)}
                    >
                      <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                      <Text style={[styles.pickerInput, { color: shiftDetails.endDate ? COLORS.textDark : COLORS.textLight }]}>
                        {shiftDetails.endDate ? formatDateDisplay(shiftDetails.endDate) : 'Select date'}
                      </Text>
                    </TouchableWeb>
                  </View>
                </View>

                {/* Time Selection - Start and End Time */}
                <View style={styles.inputRow}>
                  <View style={[styles.inputContainer, { flex: 1, marginRight: 8, marginBottom: 0 }]}>
                    <Text style={styles.inputLabel}>Start Time</Text>
                    <TouchableWeb 
                      style={[styles.pickerInputContainer, { marginBottom: 0 }]}
                      onPress={() => setShowStartTimePicker(true)}
                    >
                      <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                      <Text style={[styles.pickerInput, { color: shiftDetails.startTime ? COLORS.textDark : COLORS.textLight }]}>
                        {shiftDetails.startTime || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>
                  
                  <View style={[styles.inputContainer, { flex: 1, marginLeft: 8, marginBottom: 0 }]}>
                    <Text style={styles.inputLabel}>End Time</Text>
                    <TouchableWeb 
                      style={[styles.pickerInputContainer, { marginBottom: 0 }]}
                      onPress={() => setShowEndTimePicker(true)}
                    >
                      <MaterialCommunityIcons name="clock" size={20} color={COLORS.primary} />
                      <Text style={[styles.pickerInput, { color: shiftDetails.endTime ? COLORS.textDark : COLORS.textLight }]}>
                        {shiftDetails.endTime || 'Select'}
                      </Text>
                    </TouchableWeb>
                  </View>
                </View>
              </ScrollView>

              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    resetShiftForm();
                    setShiftBookingModal(false);
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmButton]}
                  onPress={() => {
                    // Submit button pressed
                    submitShiftRequest();
                  }}
                >
                  <LinearGradient
                    colors={SAFE_GRADIENTS.header}
                    style={styles.confirmButtonGradient}
                  >
                    <Text style={styles.confirmButtonText}>Submit Request</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>

            {/* Date Picker - Inside Modal */}
            {/* Start Date Picker */}
            {showStartDatePicker && (
              <View style={styles.inlinePickerOverlay}>
                <View style={styles.inlinePickerContainer}>
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
                    value={selectedStartDate}
                    mode="date"
                    display="spinner"
                    onChange={onStartDateChange}
                    minimumDate={new Date()}
                    style={{ backgroundColor: COLORS.white }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableWeb
                      style={styles.pickerConfirmButton}
                      onPress={confirmStartDateSelection}
                    >
                      <LinearGradient
                        colors={SAFE_GRADIENTS.header}
                        style={styles.pickerConfirmGradient}
                      >
                        <Text style={styles.pickerConfirmText}>Done</Text>
                      </LinearGradient>
                    </TouchableWeb>
                  )}
                </View>
              </View>
            )}

            {/* End Date Picker */}
            {showEndDatePicker && (
              <View style={styles.inlinePickerOverlay}>
                <View style={styles.inlinePickerContainer}>
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
                    value={selectedEndDate}
                    mode="date"
                    display="spinner"
                    onChange={onEndDateChange}
                    minimumDate={selectedStartDate}
                    style={{ backgroundColor: COLORS.white }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableWeb
                      style={styles.pickerConfirmButton}
                      onPress={confirmEndDateSelection}
                    >
                      <LinearGradient
                        colors={SAFE_GRADIENTS.header}
                        style={styles.pickerConfirmGradient}
                      >
                        <Text style={styles.pickerConfirmText}>Done</Text>
                      </LinearGradient>
                    </TouchableWeb>
                  )}
                </View>
              </View>
            )}

            {/* Start Time Picker - Inside Modal */}
            {showStartTimePicker && (
              <View style={styles.inlinePickerOverlay}>
                <View style={styles.inlinePickerContainer}>
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
                    value={selectedStartTime}
                    mode="time"
                    display="spinner"
                    onChange={onStartTimeChange}
                    style={{ backgroundColor: COLORS.white }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableWeb
                      style={styles.pickerConfirmButton}
                      onPress={confirmStartTimeSelection}
                    >
                      <LinearGradient
                        colors={SAFE_GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.pickerConfirmGradient}
                      >
                        <Text style={styles.pickerConfirmText}>Done</Text>
                      </LinearGradient>
                    </TouchableWeb>
                  )}
                </View>
              </View>
            )}

            {/* End Time Picker - Inside Modal */}
            {showEndTimePicker && (
              <View style={styles.inlinePickerOverlay}>
                <View style={styles.inlinePickerContainer}>
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
                    value={selectedEndTime}
                    mode="time"
                    display="spinner"
                    onChange={onEndTimeChange}
                    style={{ backgroundColor: COLORS.white }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableWeb
                      style={styles.pickerConfirmButton}
                      onPress={confirmEndTimeSelection}
                    >
                      <LinearGradient
                        colors={SAFE_GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.pickerConfirmGradient}
                      >
                        <Text style={styles.pickerConfirmText}>Done</Text>
                      </LinearGradient>
                    </TouchableWeb>
                  )}
                </View>
              </View>
            )}
          </View>
        </Modal>

        {/* Backup Nurse Details Modal - reuse shared NurseDetailsModal for consistent styling */}
        {selectedBackupCandidate && (
          <NurseDetailsModal
            visible={backupCandidateDetailsVisible}
            onClose={() => {
              setBackupCandidateDetailsVisible(false);
              if (resumeShiftModalAfterDetails) {
                setResumeShiftModalAfterDetails(false);
                setTimeout(() => setShiftBookingModal(true), 200);
              }
            }}
            showQualificationsRequest={false}
            nurse={{
              name: selectedBackupCandidate.displayName,
              fullName: selectedBackupCandidate.displayName,
              nurseCode: selectedBackupCandidate.displayCode,
              staffCode: selectedBackupCandidate.displayCode,
              specialization: selectedBackupCandidate.specialization || selectedBackupCandidate.specialty,
              specialty: selectedBackupCandidate.specialization || selectedBackupCandidate.specialty,
              email: selectedBackupCandidate.email,
              phone: selectedBackupCandidate.phone,
              profilePhoto: selectedBackupCandidate.photoUri || selectedBackupCandidate.profilePhoto,
              profileImage: selectedBackupCandidate.profileImage,
              photoUrl: selectedBackupCandidate.photoUrl,
              id: selectedBackupCandidate.id || selectedBackupCandidate._id,
              _id: selectedBackupCandidate._id,
            }}
            nursesRoster={nurses}
            footer={(
              <TouchableWeb
                style={styles.selectNurseButton}
                onPress={() => {
                  if (!selectedBackupCandidate) return;
                  const nurse = selectedBackupCandidate;
                  const displayName = nurse.displayName;
                  const displayCode = nurse.displayCode;
                  const exists = backupNurses.some(
                    (b) => b.nurseId === nurse.id || b.id === nurse.id || b.id === nurse._id
                  );
                  if (!exists) {
                    setBackupNurses([
                      ...backupNurses,
                      {
                        nurseId: nurse.id || nurse._id,
                        id: nurse.id || nurse._id,
                        name: displayName,
                        nurseName: displayName,
                        fullName: displayName,
                        firstName: nurse.firstName,
                        lastName: nurse.lastName,
                        staffCode: displayCode,
                        nurseCode: displayCode,
                        code: displayCode,
                        profilePhoto: nurse.profilePhoto,
                        profileImage: nurse.profileImage,
                        photoUrl: nurse.photoUrl,
                        priority: backupNurses.length + 1,
                      },
                    ]);
                  }
                  setBackupNurseSearch('');
                  setFilteredBackupNurses([]);
                  setBackupCandidateDetailsVisible(false);
                  if (resumeShiftModalAfterDetails) {
                    setResumeShiftModalAfterDetails(false);
                    setTimeout(() => setShiftBookingModal(true), 200);
                  }
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
            )}
          />
        )}

        {/* Recurring Shift Details Modal */}
        <RecurringShiftDetailsModal
          visible={recurringShiftDetailsModalVisible}
          shift={selectedRecurringShift || {}}
          // Provide preloaded clients so client details resolve immediately
          clients={clientsList || []}
          nurses={nurses || []}
          contextType="nurse"
          hideFooter={hideRecurringShiftDetailsFooter}
          currentNurseId={nurseId}
          currentNurseCode={user?.staffCode || user?.nurseCode || user?.code || user?.username || nurseId}
          onAddNote={(shiftPayload) => {
            const target = shiftPayload || selectedRecurringShift;
            if (!target) return;
            setRecurringShiftDetailsModalVisible(false);
            setSelectedRecurringShift(null);
            setHideRecurringShiftDetailsFooter(false);
            setTimeout(() => {
              openAddNotesModal(target);
            }, 220);
          }}
          onRequestBackup={(shiftPayload) => {
            const target = shiftPayload || selectedRecurringShift;
            if (!target) return;
            handleRequestBackupForShift(target);
          }}
          onClockIn={async (shiftPayload) => {
            const target = shiftPayload || selectedRecurringShift;
            const shiftId = target?.id || target?._id;
            if (!shiftId) return;
            try {
              if (!canClockInForShiftNow(target)) {
                const scheduled = getShiftScheduledStartDateTime(target);
                if (__DEV__) {
                  const nowIso = new Date().toISOString();
                  const scheduledIso = scheduled && typeof scheduled.toISOString === 'function' ? scheduled.toISOString() : null;
                  console.log('[ClockInBlocked]', {
                    shiftId,
                    now: nowIso,
                    scheduled: scheduledIso,
                    assignmentType: target?.assignmentType,
                    adminRecurring: target?.adminRecurring,
                    isRecurring: target?.isRecurring,
                    time: target?.time,
                    startTime: target?.startTime,
                    scheduledStartTime: target?.scheduledStartTime,
                    recurringStartTime: target?.recurringStartTime,
                    scheduledDate: target?.scheduledDate,
                    date: target?.date,
                    shiftDate: target?.shiftDate,
                    startDate: target?.startDate,
                    recurringPeriodStart: target?.recurringPeriodStart,
                    recurringPeriodEnd: target?.recurringPeriodEnd,
                    daysOfWeek: target?.daysOfWeek,
                    recurringDaysOfWeek: target?.recurringDaysOfWeek,
                    selectedDays: target?.selectedDays,
                    nurseScheduleKeys: target?.nurseSchedule && typeof target.nurseSchedule === 'object' ? Object.keys(target.nurseSchedule) : null,
                    clockByNurseKeys: target?.clockByNurse && typeof target.clockByNurse === 'object' ? Object.keys(target.clockByNurse) : null,
                  });
                }
                Alert.alert(
                  'Clock In Not Available Yet',
                  scheduled
                    ? `You can clock in once your shift starts at ${scheduled.toLocaleTimeString()}.`
                    : 'You can clock in once your shift start time is reached.'
                );
                return;
              }

              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('Permission Required', 'Location permission is required to clock in.');
                return;
              }

              const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });

              const { latitude, longitude } = location.coords;
              const startTime = new Date().toISOString();
              const locationData = await createLocationPayload(latitude, longitude, startTime);

              // Check if nurse is late and notify supervisor
              const scheduledStartTime = getShiftScheduledStartDateTime(target);
              if (scheduledStartTime) {
                const actualStartTime = new Date(startTime);
                const minutesLate = (actualStartTime - scheduledStartTime) / (1000 * 60);
                
                if (minutesLate >= 10) {
                  // Notify supervisor about late clock-in for recurring shift
                  try {
                    const adminsSnapshot = await getDocs(collection(db, 'admins'));
                    const supervisors = adminsSnapshot.docs
                      .map(doc => ({ id: doc.id, ...doc.data() }))
                      .filter(admin => {
                        const notificationRole = admin.emailNotificationRole?.toLowerCase();
                        return notificationRole === 'full_access' || 
                               notificationRole === 'scheduling_only' ||
                               admin.title?.toLowerCase().includes('supervisor') ||
                               admin.title?.toLowerCase().includes('manager');
                      });
                    
                    const nurseName = currentNurse?.name || user?.name || user?.username || 'A nurse';
                    const shiftDescription = target.service || target.serviceType || target.shiftType || 'Recurring Shift';
                    const patientName = target.patientName || target.clientName || '';
                    const fullDescription = patientName ? `${shiftDescription} with ${patientName}` : shiftDescription;
                    const minutesLateRounded = Math.round(minutesLate);
                    
                    for (const supervisor of supervisors) {
                      await sendNotificationToUser(
                        supervisor.id,
                        'Nurse Late Clock-In',
                        `${nurseName} clocked in ${minutesLateRounded} minutes late for ${fullDescription} (scheduled: ${scheduledStartTime.toLocaleTimeString()})`,
                        {
                          type: 'late_clock_in',
                          shiftId: shiftId,
                          nurseId: nurseId,
                          nurseName: nurseName,
                          minutesLate: minutesLateRounded,
                          scheduledTime: scheduledStartTime.toISOString(),
                          actualTime: startTime,
                          isRecurring: true,
                        }
                      );
                    }
                  } catch (notificationError) {
                    console.error('Failed to notify supervisor about late clock-in:', notificationError);
                    // Don't block clock-in if notification fails
                  }
                }
              }

              const startResult = await startShift(shiftId, startTime, nurseId, { clockInLocation: locationData });
              const resolvedStartTime = startResult?.startTime || startTime;
              const resolvedLocation = startResult?.clockInLocation || locationData;

              setActiveShifts((prev) => {
                const list = Array.isArray(prev) ? prev : [];
                const updatedShift = {
                  ...(target || {}),
                  id: shiftId,
                  status: 'active',
                  startedAt: resolvedStartTime,
                  actualStartTime: resolvedStartTime,
                  clockInLocation: resolvedLocation,
                };
                const exists = list.some((item) => (item?.id || item?._id) === shiftId);
                return exists
                  ? list.map((item) => ((item?.id || item?._id) === shiftId ? { ...item, ...updatedShift } : item))
                  : [...list, updatedShift];
              });

              setSelectedCard('active');
              setRecurringShiftDetailsModalVisible(false);
              setSelectedRecurringShift(null);
              setHideRecurringShiftDetailsFooter(false);
              setRefreshKey((prev) => prev + 1);

              setTimeout(() => {
                refreshShiftRequests();
              }, 800);

              Alert.alert('Clock In Successful', `Clocked in at ${new Date(resolvedStartTime).toLocaleTimeString()}`);
            } catch (error) {
              console.error('Error clocking in (recurring):', error);
              Alert.alert('Error', 'Failed to clock in');
            }
          }}
          onClockOut={async (shiftPayload) => {
            const target = shiftPayload || selectedRecurringShift;
            if (!target) return;
            try {
              // Close the details modal immediately when clocking out
              setRecurringShiftDetailsModalVisible(false);
              setSelectedRecurringShift(null);
              setHideRecurringShiftDetailsFooter(false);
              await handleClockOut(target);
            } catch (error) {
              console.error('Clock out failed from recurring details modal:', error);
              Alert.alert('Error', 'Failed to clock out. Please try again.');
            }
          }}
          onAccept={async (shiftPayload) => {
            try {
              const scheduleId =
                shiftPayload?.id ||
                shiftPayload?._id ||
                shiftPayload?.shiftId ||
                shiftPayload?.requestId ||
                selectedRecurringShift?.id ||
                selectedRecurringShift?._id;

              if (!scheduleId) return;
              await handleAcceptRecurringShift(scheduleId);
              setRecurringShiftDetailsModalVisible(false);
              setSelectedRecurringShift(null);
              setHideRecurringShiftDetailsFooter(false);
              refreshShiftRequests();
            } catch (e) {
              console.error('Failed to accept recurring shift from modal:', e);
            }
          }}
          onDecline={async (shiftPayload) => {
            try {
              const scheduleId =
                shiftPayload?.id ||
                shiftPayload?._id ||
                shiftPayload?.shiftId ||
                shiftPayload?.requestId ||
                selectedRecurringShift?.id ||
                selectedRecurringShift?._id;

              if (!scheduleId) return;
              await handleDeclineRecurringShift(scheduleId, 'Declined by nurse');
              setRecurringShiftDetailsModalVisible(false);
              setSelectedRecurringShift(null);
              setHideRecurringShiftDetailsFooter(false);
              refreshShiftRequests();
            } catch (e) {
              console.error('Failed to decline recurring shift from modal:', e);
            }
          }}
          onCoverageDecline={async (shiftPayload, coverageEntry) => {
            try {
              const scheduleId =
                shiftPayload?.id ||
                shiftPayload?._id ||
                shiftPayload?.shiftId ||
                shiftPayload?.requestId ||
                selectedRecurringShift?.id ||
                selectedRecurringShift?._id;

              if (!scheduleId) return;

              const latest = await ApiService.getShiftRequestById(scheduleId);
              if (!latest) throw new Error('Unable to load shift');

              const list = Array.isArray(latest.coverageRequests)
                ? [...latest.coverageRequests]
                : [];

              const currentId = String(nurseId || '').trim();
              const currentCode = String(user?.staffCode || user?.nurseCode || user?.code || user?.username || '').trim().toUpperCase();

              const matchesCurrent = (value) => {
                if (!value) return false;
                if (Array.isArray(value)) return value.some(matchesCurrent);
                if (typeof value === 'object') {
                  const id = String(value.id || value._id || value.uid || value.nurseId || '').trim();
                  const code = String(value.staffCode || value.nurseCode || value.code || value.username || '').trim().toUpperCase();
                  if (currentId && id && id === currentId) return true;
                  if (currentCode && code && code === currentCode) return true;
                  return false;
                }
                const id = String(value).trim();
                const code = String(value).trim().toUpperCase();
                if (currentId && id && id === currentId) return true;
                if (currentCode && code && code === currentCode) return true;
                return false;
              };

              const findIndex = () => {
                if (coverageEntry?.id) {
                  const idx = list.findIndex((cr) => cr && cr.id === coverageEntry.id);
                  if (idx !== -1) return idx;
                }
                return list.findIndex((cr) => {
                  if (!cr) return false;
                  const status = String(cr.status || '').trim().toLowerCase();
                  if (status !== 'pending') return false;
                  const targets = [
                    cr.targetBackupNurseId,
                    cr.targetBackupNurseStaffCode,
                    ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                  ].filter(Boolean);
                  return targets.some((t) => matchesCurrent(t));
                });
              };

              const index = findIndex();
              if (index === -1) {
                Alert.alert('Not Found', 'Backup request is no longer pending.');
                return;
              }

              const entry = { ...list[index] };
              entry.status = 'declined';
              entry.respondedAt = new Date().toISOString();
              entry.responseById = user?.id === 'nurse-001' ? 'NURSE001' : user?.id;

              list[index] = entry;

              await ApiService.updateShiftRequest(scheduleId, {
                coverageRequests: list,
                updatedAt: entry.respondedAt,
              });

              Alert.alert('Response Sent', 'You declined this backup request.');
              setRecurringShiftDetailsModalVisible(false);
              setSelectedRecurringShift(null);
              setHideRecurringShiftDetailsFooter(false);
              setRefreshKey((prev) => prev + 1);
            } catch (error) {
              console.error('Failed to decline backup request (recurring):', error);
              Alert.alert('Error', 'Failed to decline backup request.');
            }
          }}
          onCoverageAccept={async (shiftPayload, coverageEntry) => {
            try {
              const scheduleId =
                shiftPayload?.id ||
                shiftPayload?._id ||
                shiftPayload?.shiftId ||
                shiftPayload?.requestId ||
                selectedRecurringShift?.id ||
                selectedRecurringShift?._id;

              if (!scheduleId) return;

              const latest = await ApiService.getShiftRequestById(scheduleId);
              if (!latest) throw new Error('Unable to load shift');

              const list = Array.isArray(latest.coverageRequests)
                ? [...latest.coverageRequests]
                : [];

              const currentId = String(nurseId || '').trim();
              const currentCode = String(user?.staffCode || user?.nurseCode || user?.code || user?.username || '').trim().toUpperCase();

              const matchesCurrent = (value) => {
                if (!value) return false;
                if (Array.isArray(value)) return value.some(matchesCurrent);
                if (typeof value === 'object') {
                  const id = String(value.id || value._id || value.uid || value.nurseId || '').trim();
                  const code = String(value.staffCode || value.nurseCode || value.code || value.username || '').trim().toUpperCase();
                  if (currentId && id && id === currentId) return true;
                  if (currentCode && code && code === currentCode) return true;
                  return false;
                }
                const id = String(value).trim();
                const code = String(value).trim().toUpperCase();
                if (currentId && id && id === currentId) return true;
                if (currentCode && code && code === currentCode) return true;
                return false;
              };

              const findIndex = () => {
                if (coverageEntry?.id) {
                  const idx = list.findIndex((cr) => cr && cr.id === coverageEntry.id);
                  if (idx !== -1) return idx;
                }
                return list.findIndex((cr) => {
                  if (!cr) return false;
                  const status = String(cr.status || '').trim().toLowerCase();
                  if (status !== 'pending') return false;
                  const targets = [
                    cr.targetBackupNurseId,
                    cr.targetBackupNurseStaffCode,
                    ...(Array.isArray(cr.backupNursesNotified) ? cr.backupNursesNotified : []),
                  ].filter(Boolean);
                  return targets.some((t) => matchesCurrent(t));
                });
              };

              const index = findIndex();
              if (index === -1) {
                Alert.alert('Not Found', 'Backup request is no longer pending.');
                return;
              }

              const entry = { ...list[index] };
              const nowIso = new Date().toISOString();
              entry.status = 'accepted';
              entry.respondedAt = nowIso;
              entry.acceptedBy = user?.id === 'nurse-001' ? 'NURSE001' : user?.id;
              entry.acceptedByStaffCode = user?.staffCode || user?.nurseCode || user?.code || null;

              list[index] = entry;

              await ApiService.updateShiftRequest(scheduleId, {
                coverageRequests: list,
                assignedNurseId: entry.acceptedBy || nurseId,
                nurseId: entry.acceptedBy || nurseId,
                nurseCode: entry.acceptedByStaffCode || currentCode || null,
                status: 'approved',
                updatedAt: nowIso,
              });

              Alert.alert('Response Sent', 'You accepted this backup request.');
              setRecurringShiftDetailsModalVisible(false);
              setSelectedRecurringShift(null);
              setHideRecurringShiftDetailsFooter(false);
              setRefreshKey((prev) => prev + 1);
            } catch (error) {
              console.error('Failed to accept backup request (recurring):', error);
              Alert.alert('Error', 'Failed to accept backup request.');
            }
          }}
          onClose={() => {
            setRecurringShiftDetailsModalVisible(false);
            setSelectedRecurringShift(null);
            setHideRecurringShiftDetailsFooter(false);
          }}
          onClockInSuccess={(payload) => {
            try {
              const shiftId = payload?.shiftId || selectedRecurringShift?.id || selectedRecurringShift?._id;
              if (!shiftId) return;

              const startTime = payload?.startTime || new Date().toISOString();
              const updated = {
                ...(selectedRecurringShift || {}),
                id: selectedRecurringShift?.id || shiftId,
                status: 'active',
                startedAt: startTime,
                actualStartTime: startTime,
                clockInLocation: payload?.clockInLocation || selectedRecurringShift?.clockInLocation || null,
              };

              setActiveShifts((prev) => {
                const list = Array.isArray(prev) ? prev : [];
                const exists = list.some((item) => (item?.id || item?._id) === (updated.id || updated._id));
                return exists
                  ? list.map((item) => ((item?.id || item?._id) === (updated.id || updated._id) ? { ...item, ...updated } : item))
                  : [...list, updated];
              });

              setSelectedCard('active');
              setRefreshKey((prev) => prev + 1);
            } catch (e) {
              console.error('Failed to sync recurring clock-in locally:', e);
            }
          }}
          onSuccess={() => {
            // Refresh shifts after approval/denial
            setRecurringShiftDetailsModalVisible(false);
            setSelectedRecurringShift(null);
            setHideRecurringShiftDetailsFooter(false);
            // The context should handle refresh via its own mechanisms
            refreshShiftRequests();
          }}
          onNotesUpdated={handleRecurringShiftNotesUpdate}
        />

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// AppointmentCard component
const AppointmentCard = ({ 
  appointment, 
  onAccept, 
  onDecline, 
  onComplete,
  onUpdateNotes,
  onShowDetails,
  showActions = false,
  showCompleteAction = false,
  showDetailsButton = false
}) => {
  const { updateNurseNotes } = useAppointments();
  const [notes, setNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [originalNotes, setOriginalNotes] = useState(appointment.nurseNotes || '');

  // Sync notes when appointment data changes (for persistence)
  useEffect(() => {
    setOriginalNotes(appointment.nurseNotes || '');
    if (!showNotesInput) setNotes('');
  }, [appointment.nurseNotes]);

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'confirmed':
        return COLORS.success;
      case 'assigned':
        return COLORS.warning;
      case 'completed':
        return COLORS.primary;
      case 'cancelled':
        return COLORS.error;
      default:
        return COLORS.textMuted;
    }
  };

  const handleCompleteWithNotes = () => {
    if (onComplete) {
      onComplete(appointment.id, notes);
    }
  };

  const handleOpenMaps = (address) => {
    if (!address || address === 'Home Visit') {
      Alert.alert('No Address', 'No specific address provided for this appointment.');
      return;
    }

    const encodedAddress = encodeURIComponent(address);
    const url = Platform.OS === 'ios' 
      ? `http://maps.apple.com/?q=${encodedAddress}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open maps application.');
    });
  };

  const handleSaveNotes = async () => {
    try {
      const existing = (originalNotes || '').trim();
      const addition = (notes || '').trim();
      if (!addition) {
        setShowNotesInput(false);
        return;
      }
      const finalNotes = existing
        ? `${existing}\n\n--- ${new Date().toLocaleString()} ---\n${addition}`
        : addition;

      if (onUpdateNotes) {
        await onUpdateNotes(appointment.id, finalNotes);
      } else {
        // Direct context usage if prop not provided
        await updateItemNotes(appointment.id, finalNotes, Boolean(appointment?.isShift || appointment?.isShiftRequest || appointment?.adminRecurring));
      }
      setOriginalNotes(finalNotes);
      setNotes('');
      Alert.alert('Success', 'Notes saved successfully!');
      setShowNotesInput(false);
    } catch (error) {

      Alert.alert('Error', 'Failed to save notes');
    }
  };

  const handleDeleteNotes = () => {
    Alert.alert(
      'Delete Notes',
      'Are you sure you want to delete these notes?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (onUpdateNotes) {
                await onUpdateNotes(appointment.id, '');
              } else {
                await updateItemNotes(appointment.id, '', Boolean(appointment?.isShift || appointment?.isShiftRequest || appointment?.adminRecurring));
              }
              setNotes('');
              setOriginalNotes('');
              Alert.alert('Success', 'Notes deleted successfully!');
            } catch (error) {

              Alert.alert('Error', 'Failed to delete notes');
            }
          }
        }
      ]
    );
  };

  const handleCancelEdit = () => {
    setNotes(originalNotes);
    setShowNotesInput(false);
  };

  const formatDate = (dateString) => {
    try {
      // Check if the date is already formatted (contains month abbreviation)
      if (!dateString) return 'N/A';
      
      // If it's already formatted like "Nov 02, 2025", return it
      if (dateString.match(/^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/)) {
        return dateString;
      }
      
      // Try to parse and format the date
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        // If parsing fails, return the original string
        return dateString;
      }
      
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateString || 'N/A';
    }
  };

  const hasNotesChanged = notes !== originalNotes;

  return (
    <View style={styles.appointmentCard}>
      <View style={styles.appointmentHeader}>
        {appointment.status === 'assigned' && (
          <MaterialCommunityIcons 
            name="alert" 
            size={20} 
            color={COLORS.warning} 
            style={{ marginRight: 8 }}
          />
        )}
        <View style={styles.appointmentInfo}>
          <Text style={styles.patientName}>{appointment.patientName}</Text>
          <Text style={styles.serviceName}>{appointment.service}</Text>
        </View>
        <View style={styles.headerRightContainer}>
          {appointment.status !== 'assigned' && (
            <LinearGradient
              colors={[getStatusColor(appointment.status), getStatusColor(appointment.status) + 'CC']}
              style={styles.statusBadge}
            >
              <Text style={styles.statusText}>
                {appointment.status === 'assigned' ? 'ASSIGNED' : appointment.status.toUpperCase()}
              </Text>
            </LinearGradient>
          )}
          {(appointment.status === 'completed' || appointment.status === 'assigned') && (
            <TouchableWeb
              style={styles.detailsButton}
              onPress={() => {
                const details = [
                  `Patient: ${appointment.patientName}`,
                  `Service: ${appointment.service}`,
                  `Date: ${appointment.date}`,
                  `Time: ${appointment.time}`,
                  `Completion Notes: ${appointment.completionNotes || 'No completion notes'}`
                ];
                
                // Only add patient notes if they exist
                if (appointment.notes && appointment.notes.trim()) {
                  details.push(`Patient Notes: ${appointment.notes}`);
                }
                
                Alert.alert('Appointment Details', details.join('\n'));
              }}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.detailsButtonGradient}
              >
                <Text style={styles.detailsButtonText}>View</Text>
              </LinearGradient>
            </TouchableWeb>
          )}
        </View>
      </View>

      {/* Patient Details Section - Hide for pending appointments */}
      {appointment.status !== 'assigned' && (
        <View style={styles.patientDetailsSection}>
          <View style={styles.detailRow}>
            <MaterialCommunityIcons name="calendar" size={16} color={COLORS.textLight} />
            <Text style={styles.detailText}>
              {formatDate(appointment.date || appointment.scheduledDate)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <MaterialCommunityIcons name="clock-outline" size={16} color={COLORS.textLight} />
            <Text style={styles.detailText}>
              {appointment.time || appointment.scheduledTime}
            </Text>
          </View>
          <TouchableWeb 
            style={styles.detailRow}
            onPress={() => handleOpenMaps(appointment.address || 'Home Visit')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="map-marker" size={16} color={COLORS.primary} />
            <Text style={[styles.detailText, styles.clickableAddress]}>
              {appointment.address || 'Home Visit'}
            </Text>
            <MaterialCommunityIcons name="open-in-new" size={14} color={COLORS.primary} />
          </TouchableWeb>
          {appointment.phone && (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="phone" size={16} color={COLORS.textLight} />
              <Text style={styles.detailText}>{appointment.phone}</Text>
            </View>
          )}
          {appointment.specialRequests && (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons name="note-text" size={16} color={COLORS.textLight} />
              <Text style={styles.detailText}>{appointment.specialRequests}</Text>
            </View>
          )}
        </View>
      )}

      {/* Notes Section */}
      {(showCompleteAction || appointment.status === 'completed') && (
        <View style={styles.notesSection}>
          <TouchableWeb 
            style={styles.notesHeader}
            onPress={() => {
              setShowNotesInput((prev) => {
                const next = !prev;
                if (next) setNotes('');
                return next;
              });
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="note-edit" size={18} color={COLORS.primary} />
            <Text style={styles.notesHeaderText}>
              {appointment.status === 'completed' ? 'Completion Notes' : 'Add Notes'}
            </Text>
            <MaterialCommunityIcons 
              name={showNotesInput ? "chevron-up" : "chevron-down"} 
              size={18} 
              color={COLORS.textLight} 
            />
          </TouchableWeb>
          
          {showNotesInput && (
            <View>
              <TextInput
                style={styles.notesInput}
                placeholder="Add notes about this appointment..."
                placeholderTextColor={COLORS.textLight}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                editable={appointment.status !== 'completed'}
              />
              
              {appointment.status !== 'completed' && (
                <View style={styles.notesButtonContainer}>
                  {hasNotesChanged && (
                    <TouchableWeb 
                      style={styles.saveNotesButton}
                      onPress={handleSaveNotes}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="check" size={20} color={COLORS.white} />
                    </TouchableWeb>
                  )}
                  
                  {(notes.length > 0 || originalNotes.length > 0) && (
                    <TouchableWeb 
                      style={styles.deleteNotesButton}
                      onPress={handleDeleteNotes}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="delete" size={20} color={COLORS.white} />
                    </TouchableWeb>
                  )}
                  
                  {hasNotesChanged && (
                    <TouchableWeb 
                      style={styles.cancelNotesButton}
                      onPress={handleCancelEdit}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="close" size={20} color={COLORS.white} />
                    </TouchableWeb>
                  )}
                </View>
              )}
            </View>
          )}
          
          {/* Display patient booking notes if they exist */}
          {appointment.notes && appointment.notes.trim() && (
            <View style={styles.existingNotes}>
              <Text style={styles.notesLabel}>Patient Notes (from booking):</Text>
              <Text style={styles.existingNotesText}>
                {appointment.notes}
              </Text>
            </View>
          )}
          
          {/* Display nurse/completion notes if they exist */}
          {(appointment.completionNotes || appointment.nurseNotes) && (
            <View style={styles.existingNotes}>
              <Text style={styles.notesLabel}>
                {appointment.status === 'completed' ? 'Completion Notes:' : 'Nurse Notes:'}
              </Text>
              <Text style={styles.existingNotesText}>
                {appointment.completionNotes || appointment.nurseNotes}
              </Text>
            </View>
          )}
        </View>
      )}
      
      {showActions && (
        <View style={styles.actionContainer}>
          <TouchableWeb 
            style={styles.acceptButton} 
            onPress={() => onAccept(appointment.id)}
          >
            <Text style={styles.acceptButtonText}>Accept</Text>
          </TouchableWeb>
          <TouchableWeb 
            style={styles.declineButton} 
            onPress={() => onDecline(appointment.id)}
          >
            <Text style={styles.declineButtonText}>Decline</Text>
          </TouchableWeb>
        </View>
      )}

      {showCompleteAction && (
        <View style={styles.actionContainer}>
          <TouchableWeb 
            style={styles.completeButton} 
            onPress={handleCompleteWithNotes}
          >
            <Text style={styles.completeButtonText}>Mark Complete</Text>
          </TouchableWeb>
        </View>
      )}

      {showDetailsButton && (
        <View style={styles.actionContainer}>
          <TouchableWeb 
            style={styles.detailsButton} 
            onPress={() => onShowDetails(appointment)}
          >
            <Text style={styles.detailsButtonText}>View</Text>
          </TouchableWeb>
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
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 20 : 60,
    paddingBottom: 10,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: -10,
  },
  headerRightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.white,
    opacity: 0.98,
    textAlign: 'center',
    flex: 1,
    marginHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerProfileImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  availabilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  clockButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
  },
  clockButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.lightGray,
    gap: 12,
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
  clockedInCard: {
    backgroundColor: COLORS.success + '10',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  compactAvatarWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginLeft: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E6ECF5',
  },
  compactAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  compactAvatarFallback: {
    backgroundColor: COLORS.primary + '20',
  },
  compactAvatarInitials: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
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
  compactTimestamp: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.success,
    marginTop: 2,
  },
  compactSubInfo: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.accent,
    marginTop: 4,
  },
  recurringBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
    gap: 4,
  },
  recurringBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  compactService: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  confirmedButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  confirmedButtonGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmedButtonText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  notesActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 10,
    gap: 6,
  },
  notesActionButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  completeActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderRadius: 8,
    paddingVertical: 10,
    gap: 6,
  },
  completeActionButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  detailsActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 10,
    gap: 6,
  },
  detailsActionButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.accent,
  },
  previewBtn: {
    borderRadius: 6,
    overflow: 'hidden',
  },
  previewBtnGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  activeIndicator: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '600',
  },
  compactClockButton: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  compactClockOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
    borderRadius: 999,
  },
  redClockOutButton: {
    backgroundColor: COLORS.error,
  },
  compactClockButtonText: {
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  availabilitySection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  availabilityLabel: {
    color: COLORS.white,
    fontSize: 14,
  },
  headerSwitch: {
    transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }],
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: COLORS.error,
    borderRadius: 12,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  notificationBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 2,
    marginTop: 16,
    marginBottom: 20,
    gap: 8,
  },
  statCard: {
    flex: 1,
  },
  statGradient: {
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
  inactiveStatCard: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  selectedCard: {
    transform: [{ scale: 1.02 }],
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  inactiveStatLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  statNumber: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: 1,
  },
  inactiveStatNumber: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 1,
  },
  content: {
    flex: 1,
  },
  appointmentsSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  clearFilter: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.primary + '20',
    borderRadius: 16,
  },
  clearFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  appointmentsContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sectionContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
    paddingLeft: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    marginTop: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 16,
  },
  appointmentCard: {
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
  appointmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  appointmentInfo: {
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
  appointmentDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  statusBadge: {
    paddingHorizontal: 16,
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
  statusText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    textAlign: 'center',
  },
  pendingBadge: {
    backgroundColor: COLORS.warning,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerRightContainer: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
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
  
  // Appointment Details Modal Styles (matching admin)
  appointmentDetailsContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  patientAlertsBanner: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.errorLight,
    borderWidth: 1,
    borderColor: COLORS.error,
    marginBottom: 14,
  },
  patientAlertsTitle: {
    fontSize: 13,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.error,
    marginBottom: 2,
  },
  patientAlertsText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.error,
  },
  detailsSection: {
    marginBottom: 20,
  },
  detailsSectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 12,
    paddingBottom: 6,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 12,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  // Horizontal time row styles
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 12,
  },
  timeItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeContent: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  timeValue: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  timeDash: {
    fontSize: 18,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  timeDashContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  detailsNotes: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 22,
    marginTop: 8,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  detailsLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    minWidth: 60,
  },
  detailsValue: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    flex: 1,
  },
  notesContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 12,
  },
  notesContent: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 18,
  },
  
  patientDetailsSection: {
    marginBottom: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  detailText: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },
  clickableAddress: {
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
  notesSection: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  notesHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    flex: 1,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: COLORS.textDark,
    textAlignVertical: 'top',
    minHeight: 80,
    marginBottom: 20,
  },
  // Notes Modal Styles (styled like RecurringShiftDetailsModal)
  notesModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  notesModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '90%',
    maxWidth: 400,
    maxHeight: '85%',
    padding: 24,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  notesModalHeader: {
    backgroundColor: COLORS.white,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  notesModalTitle: {
    fontSize: 22,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  notesModalContent: {
    width: '100%',
  },
  serviceInfoSection: {
    marginBottom: 16,
  },
  serviceInfoTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 8,
  },
  serviceInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundLight,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  serviceInfoText: {
    fontSize: 14,
    color: COLORS.text,
    marginLeft: 8,
    flex: 1,
    fontFamily: 'Poppins_500Medium',
  },
  nurseClockCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  nurseClockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  nurseClockTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginLeft: 8,
  },
  clockTimesContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  clockTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  clockTimeItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  clockTimeLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: 'Poppins_400Regular',
    marginTop: 4,
    marginBottom: 2,
  },
  clockTimeValue: {
    fontSize: 14,
    color: COLORS.text,
    fontFamily: 'Poppins_600SemiBold',
  },
  totalHoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent + '10',
    padding: 8,
    borderRadius: 8,
  },
  totalHoursLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontFamily: 'Poppins_500Medium',
    marginLeft: 6,
    marginRight: 6,
  },
  totalHoursValue: {
    fontSize: 14,
    color: COLORS.accent,
    fontFamily: 'Poppins_700Bold',
  },
  notesModalSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  notesModalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    textAlign: 'center',
    textAlignVertical: 'center',
    minHeight: 120,
    marginBottom: 20,
    backgroundColor: COLORS.white,
  },
  notePhotosSection: {
    marginBottom: 16,
  },
  notePhotosAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundLight,
  },
  notePhotosAddButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
  },
  notePhotosList: {
    paddingTop: 10,
    gap: 10,
  },
  notePhotoThumbWrap: {
    width: 84,
    height: 84,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  notePhotoThumb: {
    width: '100%',
    height: '100%',
  },
  notePhotoRemoveButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: COLORS.white,
    borderRadius: 10,
  },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  photoPreviewOverlayInModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 50,
    elevation: 50,
  },
  photoPreviewOverlayTapArea: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPreviewImageFrame: {
    width: '100%',
    height: '85%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPreviewImage: {
    width: '100%',
    height: '100%',
  },
  vitalsModalSection: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.backgroundLight,
  },
  vitalsModalSectionTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 10,
  },
  vitalsModalOptional: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
  },
  vitalsModalRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  vitalsModalField: {
    flex: 1,
  },
  vitalsModalLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  vitalsModalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    backgroundColor: COLORS.white,
    textAlign: 'center',
  },
  notesModalButtonRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 16,
  },
  notesModalCancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  notesModalCancelButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  notesModalSaveButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  notesModalSaveButtonGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  notesModalSaveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
  },
  notesModalConfirmButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  notesModalConfirmButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  notesModalConfirmButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  modalButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cancelButton: {
    backgroundColor: COLORS.border,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: 12,
  },
  cancelButtonText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  confirmButtonGradient: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  // Floating Action Button styles
  floatingActionButton: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    elevation: 4,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    zIndex: 1000,
  },
  fabTouchable: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Shift booking modal styles
  inputContainer: {
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: COLORS.textDark,
    backgroundColor: COLORS.white,
  },
  textArea: {
    textAlignVertical: 'top',
    minHeight: 80,
  },
  // Date/Time picker input styles
  pickerInputContainer: {
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
  pickerInput: {
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
  },
  // Client search styles
  clientSearchContainer: {
    position: 'relative',
  },
  clientSearchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
  },
  clearButton: {
    padding: 4,
    marginRight: 8,
  },
  clientDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 100,
  },
  clientDropdownScroll: {
    maxHeight: 200,
  },
  clientItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  clientItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clientAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.background,
  },
  clientAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clientInitials: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textDark,
  },
  clientEmail: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  clientAddress: {
    fontSize: 11,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  // Date/Time picker overlay styles (from BookScreen)
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  pickerContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 15,
    padding: 20,
    width: '95%',
    maxWidth: 380,
    minWidth: 350,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 10,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  pickerCloseButton: {
    padding: 5,
  },
  pickerConfirmButton: {
    borderRadius: 8,
    marginTop: 20,
    overflow: 'hidden',
  },
  pickerConfirmGradient: {
    padding: 12,
    alignItems: 'center',
  },
  pickerConfirmText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
  // Inline picker styles (within modal)
  inlinePickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3000,
  },
  inlinePickerContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxWidth: 380,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 15,
  },
  // Service selector styles (BookScreen pill style)
  serviceScrollView: {
    marginTop: 8,
  },
  serviceScrollContent: {
    paddingRight: 20,
  },
  serviceChip: {
    borderRadius: 999,
    marginRight: 8,
    overflow: 'hidden',
  },
  serviceChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  inactiveServiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  serviceChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  serviceChipTextSelected: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalHeaderContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalCloseButton: {
    fontSize: 24,
    color: COLORS.text,
    fontWeight: '600',
  },
  modalScrollContent: {
    flex: 1,
    padding: 20,
  },
  // Details Modal Styles (matching admin)
  detailsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  detailsModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '100%',
    maxWidth: 380,
    maxHeight: Platform.OS === 'android' ? '93%' : '85%',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  // Wider modal content for picker overlays
  pickerModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: 350,
    maxHeight: '97%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  shiftRequestModalContent: {
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
  },
  detailsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailsModalTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    alignItems: 'stretch',
  },
  clockInButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  clockOutButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  clockButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  clockButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  modalActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.primary,
    gap: 8,
    overflow: 'hidden',
  },
  modalActionButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  modalCompleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.success,
    gap: 6,
  },

  // Backup Nurses Styles (matching RecurringShiftDetailsModal)
  backupNurseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backupPriorityBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  backupPriorityText: {
    fontSize: 13,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  backupNurseIcon: {
    marginRight: SPACING.sm,
  },
  backupNurseAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: SPACING.sm,
    backgroundColor: COLORS.border,
  },
  backupNurseInfo: {
    flex: 1,
  },
  backupNurseName: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  backupNurseCode: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  backupNurseMeta: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: SPACING.sm,
    fontFamily: 'Poppins_400Regular',
  },
  detailsSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  backupNurseCardWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  backupPriorityOverlay: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  backupPriorityOverlayText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  backupNurseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  backupNurseAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  backupNurseInitials: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  removeBackupButton: {
    padding: 6,
    marginLeft: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCompleteButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Accept/Deny button styles (matching admin)
  modalDenyButton: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDenyButtonText: {
    color: COLORS.error,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  modalAcceptButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalAcceptButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAcceptButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Shift Booking Modal Styles
  shiftModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  shiftModalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
    overflow: 'hidden',
  },
  shiftModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  shiftModalTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 20,
  },
  sectionHeaderText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  // Location Info Styles
  locationInfoWrapper: {
    marginBottom: 16,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    borderRadius: 10,
    gap: 10,
  },
  locationInfoContent: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  locationLinkText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: '#2563eb',
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  locationDetailsWrapper: {
    marginTop: 12,
    gap: 8,
  },
  // Split Schedule Nurse Card Styles (match admin modal)
  splitNurseCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardClockedIn: {
    borderColor: '#4caf50',
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
  },
  splitNurseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  splitNurseAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E6ECF5',
    marginRight: SPACING.md,
  },
  splitNurseAvatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  splitNurseInfo: {
    flex: 1,
  },
  splitNurseName: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  splitNurseMeta: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  splitNurseCode: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
  },
  splitNurseDaysContainer: {
    marginBottom: SPACING.md,
  },
  splitNurseServiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SPACING.sm,
  },
  splitNurseServiceText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  splitNurseTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: SPACING.sm,
  },
  splitNurseTimeItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  splitNurseTimeContent: {
    flex: 1,
  },
  splitNurseTimeLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  splitNurseTimeValue: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  splitNurseTimeDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  // Requested Days styles
  assignedDaysLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  assignedDayPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  assignedDayPillText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Days picker styles
  daysScroll: {
    marginBottom: 0,
  },
  dayPill: {
    marginRight: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  dayPillGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactiveDayPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  dayChipTextSelected: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  dayBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Nurse Card Modal Styles (matching BookScreen)
  nurseCardModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  nurseCardModalContainer: {
    width: '85%',
    maxHeight: '75%',
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
    zIndex: 10000,
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