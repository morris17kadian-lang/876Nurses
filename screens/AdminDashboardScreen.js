import { TouchableWeb } from "../components/TouchableWeb";
import AppOnboarding from '../components/AppOnboarding';
import React, { useState, useContext, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Image,
  RefreshControl,
  PanResponder,
  Animated,
  TouchableOpacity,
  Platform,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { clearAllAdminData } from '../utils/clearAllData';
import { useAppointments } from '../context/AppointmentContext';
import { useNurses } from '../context/NurseContext';
import { useShifts } from '../context/ShiftContext';
import { useProfileEdit } from '../context/ProfileEditContext';
import { formatTimeTo12Hour } from '../utils/formatters';
import AdminRecurringShiftModal from '../components/AdminRecurringShiftModal';
import RecurringShiftDetailsModal from '../components/RecurringShiftDetailsModal';
import NurseDetailsModal from '../components/NurseDetailsModal';
import NurseInfoCard from '../components/NurseInfoCard';
import NotesAccordionList from '../components/NotesAccordionList';
import InvoiceService from '../services/InvoiceService';
import ApiService from '../services/ApiService';
import FirebaseService from '../services/FirebaseService';
import PushNotificationService from '../services/PushNotificationService';
import EmailService from '../services/EmailService';
import RecurringAppointmentService from '../services/RecurringAppointmentService';
import SmartLogger from '../utils/SmartLogger';
import { getNurseName as formatNurseName } from '../utils/formatters';
import useWindowDimensions from '../hooks/useWindowDimensions';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatDisplayTime = (timeStr) => {
  if (!timeStr) return 'N/A';

  const normalized = String(timeStr).trim();
  if (!normalized) return 'N/A';
  // Guard against placeholder values that sometimes get stored for optional time fields.
  // These should not show up as a literal dash in the UI.
  if (/^(?:n\/?a|na|none|null|undefined|[-–—]+)$/i.test(normalized)) return 'N/A';
  if (/\b(am|pm)\b/i.test(normalized)) return normalized;

  const parts = normalized.split(':');
  if (parts.length < 2) return normalized;

  const rawHours = Number.parseInt(parts[0], 10);
  const rawMinutes = Number.parseInt(parts[1], 10);
  if (Number.isNaN(rawHours) || Number.isNaN(rawMinutes)) return normalized;

  const period = rawHours >= 12 ? 'PM' : 'AM';
  const hours12 = ((rawHours % 12) || 12);
  const minutes = String(Math.max(0, Math.min(59, rawMinutes))).padStart(2, '0');
  return `${hours12}:${minutes} ${period}`;
};

const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return null;

  const normalized = String(timeStr).trim();
  if (!normalized) return null;

  // Handle already formatted times like "9:00 AM" / "09:00 PM"
  const ampmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number.parseInt(ampmMatch[1], 10);
    const minutes = Number.parseInt(ampmMatch[2] || '0', 10);
    const period = String(ampmMatch[3] || '').toUpperCase();
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    hours = hours % 12;
    if (period === 'PM') hours += 12;
    return hours * 60 + Math.max(0, Math.min(59, minutes));
  }

  // Handle 24-hour "HH:mm" / "H:mm"
  const parts = normalized.split(':');
  if (parts.length >= 2) {
    const hours = Number.parseInt(parts[0], 10);
    const minutes = Number.parseInt(parts[1], 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23) return null;
    return hours * 60 + Math.max(0, Math.min(59, minutes));
  }

  return null;
};

const buildDurationLabel = (startRaw, endRaw) => {
  const startMin = parseTimeToMinutes(startRaw);
  const endMin = parseTimeToMinutes(endRaw);
  if (startMin === null || endMin === null) return null;

  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;

  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (minutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${minutes}m`;
};

const formatDaysOfWeekList = (daysSource) => {
  if (!daysSource) return '';

  const raw = Array.isArray(daysSource)
    ? daysSource
    : typeof daysSource === 'string'
      ? daysSource.split(',')
      : [];

  const dayIndexes = raw
    .map((d) => {
      if (typeof d === 'number') return d;
      const s = String(d).trim();
      if (!s) return null;
      const n = Number.parseInt(s, 10);
      if (!Number.isNaN(n)) return n;

      const lowered = s.toLowerCase();
      const idx = DAY_NAMES.findIndex((name) => name.toLowerCase().startsWith(lowered));
      return idx >= 0 ? idx : null;
    })
    .filter((n) => typeof n === 'number' && n >= 0 && n <= 6);

  const uniqueSorted = Array.from(new Set(dayIndexes)).sort((a, b) => a - b);
  if (uniqueSorted.length === 0) return '';

  // Use short labels like Mon, Tue, etc.
  const short = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return uniqueSorted.map((i) => short[i] || DAY_NAMES[i]).join(', ');
};

const coerceToDateSafe = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    // Fix date-only strings (YYYY-MM-DD) to parse as local date instead of UTC
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      const localDateOnly = new Date(`${value.trim()}T00:00:00`);
      return Number.isNaN(localDateOnly.getTime()) ? null : localDateOnly;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object') {
    // Firestore Timestamp
    if (typeof value.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    // Serialized timestamp-like { seconds }
    if (typeof value.seconds === 'number') {
      const d = new Date(value.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
};

const formatShortDateLabel = (value) => {
  const d = coerceToDateSafe(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateRangeDisplay = (startValue, endValue) => {
  const startLabel = formatShortDateLabel(startValue);
  const endLabel = formatShortDateLabel(endValue);

  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  if (startLabel) return `From ${startLabel}`;
  if (endLabel) return `Until ${endLabel}`;
  return '';
};

const formatLocationAddress = (location) => {
  if (!location) return null;

  const normalizeLocationSegment = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const shouldOmitLocationSegment = (value) => {
    const normalized = normalizeLocationSegment(value)
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .trim()
      .toLowerCase();
    if (!normalized) return true;
    return normalized === 'surrey' || normalized === 'surrey county';
  };
  const stripFullStringDuplication = (value) => {
    const cleaned = normalizeLocationSegment(value);
    if (!cleaned) return '';
    const match = cleaned.match(/^(.+?)\s+\1$/i);
    return match ? normalizeLocationSegment(match[1]) : cleaned;
  };
  const dedupeAddressString = (value) => {
    const cleaned = stripFullStringDuplication(value);
    if (!cleaned) return null;

    const rawSegments = cleaned
      .split(/[\n,]+/)
      .map((s) => stripFullStringDuplication(s))
      .map((s) => normalizeLocationSegment(s))
      .filter(Boolean)
      .filter((seg) => !shouldOmitLocationSegment(seg));

    if (rawSegments.length <= 1) return rawSegments[0] || null;

    const seen = new Set();
    const unique = [];
    for (const seg of rawSegments) {
      const key = seg.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(seg);
    }
    return unique.join(', ');
  };

  if (typeof location === 'string') {
    return dedupeAddressString(location);
  }

  if (typeof location !== 'object') return null;

  const addressLike =
    location.address ||
    location.formattedAddress ||
    location.formatted_address ||
    location.displayAddress ||
    location.label ||
    null;
  if (typeof addressLike === 'string') {
    const deduped = dedupeAddressString(addressLike);
    if (deduped) return deduped;
  }

  const parts = [
    location.street || location.addressLine1 || location.line1,
    location.addressLine2 || location.line2,
    location.city || location.town,
    location.parish || location.state,
    location.postalCode || location.zip,
    location.country,
  ]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean);

  if (parts.length) {
    const seen = new Set();
    const uniqueParts = [];
    for (const part of parts) {
      if (shouldOmitLocationSegment(part)) continue;
      const normalized = normalizeLocationSegment(part).toLowerCase();
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      uniqueParts.push(normalizeLocationSegment(part));
    }
    return uniqueParts.length ? uniqueParts.join(', ') : null;
  }

  if (typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
  }

  return null;
};

const coerceToDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value?.toDate === 'function') {
    const resolved = value.toDate();
    if (resolved instanceof Date && !Number.isNaN(resolved.getTime())) return resolved;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const resolved = new Date(value.seconds * 1000);
    if (!Number.isNaN(resolved.getTime())) return resolved;
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    // Parse date-only strings as LOCAL time to avoid UTC day shift.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsedLocal = new Date(`${raw}T00:00:00`);
      if (!Number.isNaN(parsedLocal.getTime())) return parsedLocal;
    }
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
};

const formatFriendlyDate = (value) => {
  if (!value) return null;
  
  // Handle "Feb 19, 2026" format manually if basic parsing fails or if we want to be safe
  if (typeof value === 'string') {
     const dateMatch = value.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/);
     if (dateMatch) {
       const [_, monthStr, dayStr, yearStr] = dateMatch;
       const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthStr);
       if (monthIndex >= 0) {
         const d = new Date(parseInt(yearStr, 10), monthIndex, parseInt(dayStr, 10));
         if (!Number.isNaN(d.getTime())) {
           return d.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
           });
         }
       }
     }
  }

  const date = coerceToDateValue(value);
  if (!date) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const formatFriendlyTime = (value) => {
  if (!value) return null;
  const normalized = coerceToDateValue(value);
  if (normalized) {
    return normalized.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
  return formatDisplayTime(value);
};

const formatLocationLabel = (location) => {
  if (!location) return 'Location not captured';
  if (typeof location === 'string') {
    const trimmed = location.trim();
    if (trimmed) return trimmed;
  }
  const friendlyAddress = formatLocationAddress(location);
  if (friendlyAddress) return friendlyAddress;
  if (typeof location?.latitude === 'number' && typeof location?.longitude === 'number') {
    return 'Location captured';
  }
  return 'Location captured';
};

const extractClockDetailsFromRecord = (record) => {
  if (!record || typeof record !== 'object') return null;

  const pick = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return null;
    for (const key of keys) {
      if (obj[key]) return obj[key];
    }
    return null;
  };

  const normalizeClockEntry = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const clockInTime = pick(obj, ['lastClockInTime', 'actualStartTime', 'clockInTime', 'startedAt', 'startTime']);
    // Only treat actual clock-out values as clock-out; exclude scheduled/completed fields
    const clockOutTime = pick(obj, ['lastClockOutTime', 'actualEndTime', 'clockOutTime']);
    const clockInLocation = pick(obj, ['clockInLocation', 'lastClockInLocation', 'startLocation']);
    const clockOutLocation = pick(obj, ['clockOutLocation', 'lastClockOutLocation', 'endLocation']);
    if (!clockInTime && !clockOutTime && !clockInLocation && !clockOutLocation) return null;
    return { clockInTime, clockOutTime, clockInLocation, clockOutLocation };
  };

  const primary = normalizeClockEntry(record);

  const rawEntries =
    (Array.isArray(record.clockEntries) && record.clockEntries) ||
    (Array.isArray(record.clockHistory) && record.clockHistory) ||
    (Array.isArray(record.clockSessions) && record.clockSessions) ||
    (Array.isArray(record.clockLogs) && record.clockLogs) ||
    (Array.isArray(record.clockLog) && record.clockLog) ||
    null;

  const clockEntries =
    rawEntries && rawEntries.length
      ? rawEntries.map((e) => normalizeClockEntry(e)).filter(Boolean)
      : null;

  if (!primary && (!clockEntries || clockEntries.length === 0)) return null;

  return {
    ...(primary || {}),
    ...(clockEntries && clockEntries.length ? { clockEntries } : {}),
  };
};

const getClockEntryByNurse = (record, nurseKey, nurseData, options = {}) => {
  if (!record) return null;

  const clockMap =
    record.clockByNurse ||
    record.activeShift?.clockByNurse ||
    record.shiftDetails?.clockByNurse ||
    record.shift?.clockByNurse ||
    null;

  if (!clockMap || typeof clockMap !== 'object') return null;

  const includeRecordFallbackKeys = options?.includeRecordFallbackKeys !== false;

  const candidates = [
    nurseKey,
    nurseData?.nurseId,
    nurseData?.nurseCode,
    nurseData?.staffCode,
    nurseData?.id,
    nurseData?._id,
  ]
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (includeRecordFallbackKeys) {
    [
      record.nurseId,
      record.assignedNurseId,
      record.nurseCode,
      record.staffCode,
      record.assignedNurse?.nurseCode,
      record.nurse?.nurseCode,
    ]
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .map((value) => String(value).trim())
      .filter(Boolean)
      .forEach((value) => candidates.push(value));
  }

  for (const key of candidates) {
    if (clockMap[key]) return clockMap[key];
    const upper = key.toUpperCase();
    if (clockMap[upper]) return clockMap[upper];
    const lower = key.toLowerCase();
    if (clockMap[lower]) return clockMap[lower];
  }

  return null;
};

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

const isClockedOut = (clockEntry) => {
  if (!clockEntry) return true;
  return Boolean(
    clockEntry.actualEndTime ||
    clockEntry.clockOutTime ||
    clockEntry.clockOutLocation
  );
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

export default function AdminDashboardScreen({ navigation, route }) {
  const { user } = useAuth();
  const isAdminUser = ['admin', 'superAdmin'].includes(user?.role);
  const { unreadCount, sendNotificationToUser, refreshNotifications } = useNotifications();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const lastFocusRefreshRef = useRef(0);
  
  const medicalReportModalHeight = useMemo(() => {
    const base = Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : 700;
    const targetPercentage = Platform.OS === 'android' ? 0.93 : 0.85;
    return Math.floor(base * targetPercentage);
  }, [windowHeight]);
  
  const { 
    appointments,
    getAppointmentsByNurse, 
    acceptAppointment, 
    declineAppointment,
    cancelAppointment,
    completeAppointment,
    clearCompletedAppointments,
    updateNurseAvailability,
    updateAppointmentNotes,
    addCompletedAppointmentFromShift,
    getAppointmentsByStatus,
    refreshAppointments,
    assignNurse
  } = useAppointments();

  const { nurses, getAvailableNurses: getAvailableNursesFromContext, deleteNurse, addNurse } = useNurses();
  const { 
    getPendingShiftRequests, 
    approveShiftRequest, 
    denyShiftRequest,
    shiftRequests,
    refreshShiftRequests,
    clearAllShiftRequests,
    updateShiftRequestDetails
  } = useShifts();
  const { 
    editRequests,
    approveEditRequest, 
    denyEditRequest, 
    loading: editRequestsLoading,
    refreshRequests
  } = useProfileEdit();

  const [allClientProfiles, setAllClientProfiles] = useState([]);
  useEffect(() => {
    let mounted = true;
    ApiService.getAllUsers().then(all => {
      if (mounted && Array.isArray(all)) {
        setAllClientProfiles(all.filter(u => u.type === 'user'));
      }
    }).catch(err => console.warn('Failed to load clients', err));
    return () => { mounted = false; };
  }, []);

  // Derive unique clients list from appointments for the modal
  const clientsList = React.useMemo(() => {
    const uniqueClients = [];
    const seenIds = new Set();
    const addClientEntry = (id, data = {}) => {
      if (!id) return;
      const normalizedId = String(id).trim();
      if (!normalizedId || seenIds.has(normalizedId)) return;
      seenIds.add(normalizedId);
      uniqueClients.push({
        id: normalizedId,
        name:
          data.name ||
          data.fullName ||
          data.displayName ||
          data.clientName ||
          data.patientName ||
          (data.firstName || data.lastName ? `${data.firstName || ''} ${data.lastName || ''}`.trim() : '') ||
          'Unknown Client',
        address:
          data.address ||
          data.location ||
          data.clientAddress ||
          data.patientAddress ||
          data.streetAddress ||
          data.homeAddress ||
          data.addressLine1 ||
          data.address1 ||
          '',
        email:
          data.email ||
          data.clientEmail ||
          data.patientEmail ||
          data.userEmail ||
          data.contactEmail ||
          '',
        phone:
          data.phone ||
          data.phoneNumber ||
          data.mobile ||
          data.mobileNumber ||
          data.contactNumber ||
          data.clientPhone ||
          data.patientPhone ||
          '',
        profilePhoto:
          data.profilePhoto ||
          data.profileImage ||
          data.profileImageUrl ||
          data.profilePicture ||
          data.photoUrl ||
          data.photoURL ||
          data.image ||
          data.imageUrl ||
          data.avatar ||
          data.avatarUrl ||
          data.profileImageUrl ||
          data.clientPhoto ||
          data.patientPhoto ||
          data.clientProfilePhoto ||
          data.patientProfilePhoto ||
          '',
      });
    };

    // 0. Pre-populate from authoritative allClientProfiles
    if (allClientProfiles && Array.isArray(allClientProfiles)) {
      allClientProfiles.forEach(c => {
        addClientEntry(c.id || c.uid || c._id, c);
      });
    }

    if (appointments && Array.isArray(appointments)) {
      appointments.forEach(app => {
        addClientEntry(app.clientId || app.patientId, app);
      });
    }

    if (shiftRequests && Array.isArray(shiftRequests)) {
      shiftRequests.forEach((shift) => {
        const payload = {
          clientName: shift.clientName,
          patientName: shift.patientName,
          address: shift.clientAddress || shift.patientAddress || shift.location,
          email: shift.clientEmail || shift.patientEmail,
          phone: shift.clientPhone || shift.patientPhone,
          profilePhoto:
            shift.clientProfilePhoto ||
            shift.patientProfilePhoto ||
            shift.clientPhoto ||
            shift.patientPhoto ||
            shift.profilePhoto ||
            shift.profileImage ||
            shift.profileImageUrl ||
            shift.profilePicture ||
            shift.photoUrl ||
            shift.photoURL ||
            shift.image ||
            shift.imageUrl ||
            shift.avatar,
        };
        addClientEntry(shift.clientId || shift.patientId || shift.client?.id || shift.patient?.id, payload);
      });
    }
    return uniqueClients;
  }, [appointments, shiftRequests, allClientProfiles]);

  // Build fast lookup maps for clients to avoid repeated .find scans
  const clientsById = React.useMemo(() => {
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

  const clientsByEmailLower = React.useMemo(() => {
    const map = new Map();
    if (!Array.isArray(clientsList)) return map;
    clientsList.forEach((client) => {
      if (!client) return;
      const emailCandidates = [client.email, client.clientEmail];
      emailCandidates.forEach((raw) => {
        if (!raw) return;
        const key = String(raw).trim().toLowerCase();
        if (key) {
          if (!map.has(key)) {
            map.set(key, client);
          }
        }
      });
    });
    return map;
  }, [clientsList]);


  
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [createNurseModalVisible, setCreateNurseModalVisible] = useState(false);
  const [appointmentDetailsModalVisible, setAppointmentDetailsModalVisible] = useState(false);
  const [nurseDetailsModalVisible, setNurseDetailsModalVisible] = useState(false);
  const [shiftRequestInlineNurseDetailsVisible, setShiftRequestInlineNurseDetailsVisible] = useState(false);
  const [shiftRequestInlineNurseDetails, setShiftRequestInlineNurseDetails] = useState(null);
  const [shiftRequestModalVisible, setShiftRequestModalVisible] = useState(false);
  const [clockDetailsModalVisible, setClockDetailsModalVisible] = useState(false);
  const [clockDetailsPayload, setClockDetailsPayload] = useState(null);
  const [clockDetailsExpandedDayKey, setClockDetailsExpandedDayKey] = useState(null);
  const [reopenAppointmentDetailsAfterClock, setReopenAppointmentDetailsAfterClock] = useState(false);
  const [reopenRecurringDetailsAfterClock, setReopenRecurringDetailsAfterClock] = useState(false);
  const [reopenAppointmentDetailsAfterNurseModal, setReopenAppointmentDetailsAfterNurseModal] = useState(false);
  const [appointmentClockDetailsVisible, setAppointmentClockDetailsVisible] = useState(false);
  const [appointmentShowNotes, setAppointmentShowNotes] = useState(false);
  const [appointmentShiftNotes, setAppointmentShiftNotes] = useState('');
  const [appointmentClockOutLocation, setAppointmentClockOutLocation] = useState(null);
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [notePhotoPreviewVisible, setNotePhotoPreviewVisible] = useState(false);
  const [notePhotoPreviewUri, setNotePhotoPreviewUri] = useState(null);
  const [adminRecurringShiftModalVisible, setAdminRecurringShiftModalVisible] = useState(false);
  const [adminViewRecurringShiftModalVisible, setAdminViewRecurringShiftModalVisible] = useState(false);
  const [reassignNurseModalVisible, setReassignNurseModalVisible] = useState(false);
  const [reassignFromNurseKey, setReassignFromNurseKey] = useState(null);
  const [reassignNurseSearch, setReassignNurseSearch] = useState('');
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedAppointmentDetails, setSelectedAppointmentDetails] = useState(null);
  const [selectedNurseDetails, setSelectedNurseDetails] = useState(null);
  const [selectedShiftRequest, setSelectedShiftRequest] = useState(null);

  const DEBUG_ADMIN_APPT_NOTES = __DEV__ === true;
  const adminApptNotesDebugLoggedRef = React.useRef(new Set());
  const autoFinalShiftInvoiceAttemptedRef = React.useRef(new Set());

  const openNotePhotoPreview = useCallback((uri) => {
    if (!uri) return;
    const normalized = String(uri).trim();
    if (!normalized) return;
    setNotePhotoPreviewUri(normalized);
    setNotePhotoPreviewVisible(true);
  }, []);

  const closeNotePhotoPreview = useCallback(() => {
    setNotePhotoPreviewVisible(false);
    setNotePhotoPreviewUri(null);
  }, []);

  useEffect(() => {
    if (!DEBUG_ADMIN_APPT_NOTES) return;
    if (!appointmentDetailsModalVisible) return;
    if (!selectedAppointmentDetails) return;

    const d = selectedAppointmentDetails;
    const idCandidates = [
      d?.id,
      d?._id,
      d?.appointmentId,
      d?.documentId,
      d?.requestId,
      d?.shiftId,
      d?.assignmentId,
      d?.relatedAppointmentId,
    ]
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .map((v) => String(v));
    const debugKey = idCandidates[0] || `no-id:${String(d?.patientId || d?.clientId || d?.patientName || d?.clientName || 'unknown')}`;

    if (adminApptNotesDebugLoggedRef.current.has(debugKey)) return;
    adminApptNotesDebugLoggedRef.current.add(debugKey);

    const readTrim = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const noteFields = {
      notes: readTrim(d?.notes),
      patientNotes: readTrim(d?.patientNotes),
      bookingNotes: readTrim(d?.bookingNotes),
      clientNotes: readTrim(d?.clientNotes),
      specialInstructions: readTrim(d?.specialInstructions),
      instructions: readTrim(d?.instructions),
      patient_note: readTrim(d?.patient?.notes),
      patient_patientNotes: readTrim(d?.patient?.patientNotes),
      client_note: readTrim(d?.client?.notes),
      client_patientNotes: readTrim(d?.client?.patientNotes),
      clientSnapshot_notes: readTrim(d?.clientSnapshot?.notes),
      clientSnapshot_patientNotes: readTrim(d?.clientSnapshot?.patientNotes),
      patientSnapshot_notes: readTrim(d?.patientSnapshot?.notes),
      patientSnapshot_patientNotes: readTrim(d?.patientSnapshot?.patientNotes),
    };

    // Debug logging removed per request to stop console debugging
  }, [DEBUG_ADMIN_APPT_NOTES, appointmentDetailsModalVisible, selectedAppointmentDetails]);

  // If the modal is open and appointments refresh, rehydrate notes from the latest record.
  useEffect(() => {
    if (!appointmentDetailsModalVisible) return;
    if (!selectedAppointmentDetails) return;
    if (!Array.isArray(appointments) || appointments.length === 0) return;

    const selectedId =
      selectedAppointmentDetails.id ||
      selectedAppointmentDetails._id ||
      selectedAppointmentDetails.appointmentId ||
      null;
    if (!selectedId) return;

    const latest = appointments.find((apt) => {
      if (!apt) return false;
      return (
        apt.id === selectedId ||
        apt._id === selectedId ||
        apt.appointmentId === selectedId
      );
    });
    if (!latest) return;

    const nextNotes = {
      nurseNotes: latest.nurseNotes,
      completionNotes: latest.completionNotes,
      notes: latest.notes,
      patientNotes: latest.patientNotes,
      bookingNotes: latest.bookingNotes,
      clientNotes: latest.clientNotes,
      specialInstructions: latest.specialInstructions,
      updatedAt: latest.updatedAt,
    };

    const hasAnyChange = Object.keys(nextNotes).some((k) => nextNotes[k] !== selectedAppointmentDetails[k]);
    if (!hasAnyChange) return;

    setSelectedAppointmentDetails((prev) => ({
      ...prev,
      ...nextNotes,
    }));
  }, [appointmentDetailsModalVisible, selectedAppointmentDetails, appointments]);
  const [nurseName, setNurseName] = useState('');
  const [nurseEmail, setNurseEmail] = useState('');
  const [nursePhone, setNursePhone] = useState('');
  const [nurseSpecialization, setNurseSpecialization] = useState('');
  const [nurseCode, setNurseCode] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [nurseBankName, setNurseBankName] = useState('');
  const [nurseAccountNumber, setNurseAccountNumber] = useState('');
  const [nurseAccountHolderName, setNurseAccountHolderName] = useState('');
  const [nurseBankBranch, setNurseBankBranch] = useState('');
  const [nurseIdPhoto, setNurseIdPhoto] = useState(null); // For nurse ID photo upload
  const [staffRole, setStaffRole] = useState('nurse'); // 'nurse' or 'admin'
  const [selectedCard, setSelectedCard] = useState(null);
  const [pendingConsultationRequests, setPendingConsultationRequests] = useState([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [pendingMedicalReportRequests, setPendingMedicalReportRequests] = useState([]);
  const [medicalReportRequestModalVisible, setMedicalReportRequestModalVisible] = useState(false);
  const [selectedMedicalReportRequest, setSelectedMedicalReportRequest] = useState(null);
  const [medicalReportToEmail, setMedicalReportToEmail] = useState('');
  const [medicalReportSubject, setMedicalReportSubject] = useState('');
  const [medicalReportBody, setMedicalReportBody] = useState('');
  const [medicalReportPreviewVisible, setMedicalReportPreviewVisible] = useState(false);
  const [medicalReportPatientName, setMedicalReportPatientName] = useState('');
  const [medicalReportPatientEmail, setMedicalReportPatientEmail] = useState('');
  const [medicalReportPatientPhone, setMedicalReportPatientPhone] = useState('');
  const [medicalReportPatientAddress, setMedicalReportPatientAddress] = useState('');
  const [medicalReportPatientDob, setMedicalReportPatientDob] = useState('');
  const [medicalReportReportDate, setMedicalReportReportDate] = useState('');
  const [medicalReportMedicalHistory, setMedicalReportMedicalHistory] = useState('');
  const [medicalReportNurseNotes, setMedicalReportNurseNotes] = useState('');
  const [medicalReportNurseSignature, setMedicalReportNurseSignature] = useState('');
  const [medicalReportRecommendations, setMedicalReportRecommendations] = useState('');
  const [medicalReportAllergies, setMedicalReportAllergies] = useState('');
  const [medicalReportVitals, setMedicalReportVitals] = useState('');
  const [medicalHistoryInputHeight, setMedicalHistoryInputHeight] = useState(120);
  const [nurseNotesInputHeight, setNurseNotesInputHeight] = useState(120);
  const [recommendationsInputHeight, setRecommendationsInputHeight] = useState(100);
  const [sendingMedicalReport, setSendingMedicalReport] = useState(false);
  const [nurseSequence, setNurseSequence] = useState(1); // Sequential counter for nurses
  const [adminSequence, setAdminSequence] = useState(1); // Sequential counter for admins
  const [sequencesInitialized, setSequencesInitialized] = useState(false); // Flag to prevent multiple initializations
  const [refreshKey, setRefreshKey] = useState(0); // Add refresh trigger
  const [lastShiftCount, setLastShiftCount] = useState(0); // Track changes
  const [refreshing, setRefreshing] = useState(false);
  const [freshNurseDataMap, setFreshNurseDataMap] = useState(new Map());
  const [freshClientDataMap, setFreshClientDataMap] = useState(new Map());
  // Backup nurse management state
  const [backupNurseModalVisible, setBackupNurseModalVisible] = useState(false);
  const [currentBackupNurses, setCurrentBackupNurses] = useState([]);
  const [backupNurseTargetId, setBackupNurseTargetId] = useState(null);
  const [backupNurseSearch, setBackupNurseSearch] = useState('');
  const [primaryNurseModalVisible, setPrimaryNurseModalVisible] = useState(false);
  const [nurseSelectionMode, setNurseSelectionMode] = useState(null); // null | 'primary' | 'backup' | 'assign'
  const [primaryNurseSearch, setPrimaryNurseSearch] = useState('');
  const [assignNurseSearch, setAssignNurseSearch] = useState('');
  const [assignContext, setAssignContext] = useState('appointment'); // 'appointment' or 'recurring'
  
  // Debug logging for primaryNurseModalVisible removed per request
  
  // Old recurring schedule form state - REMOVED (using AdminRecurringShiftModal component instead)

  // OLD: Pickers for recurring schedule - DEPRECATED (replaced with AdminRecurringShiftModal)

  // Floating button for recurring schedule - REMOVED (Moved to Tab Bar)


  // Initialize sequences based on existing users in AsyncStorage
  useEffect(() => {
    const DEBUG_ADMIN_DASHBOARD = false;
    if (__DEV__ && DEBUG_ADMIN_DASHBOARD) {
      console.log('Nurses updated in AdminDashboard:', nurses ? nurses.length : 'null');
    }
  }, [nurses]);

  useEffect(() => {
    let active = true;

    const loadPendingConsultations = async () => {
      try {
        if (selectedCard !== 'pending') return;
        // Only fetch if user has admin role to avoid permission errors
        if (user?.role !== 'admin') return;
        const res = await FirebaseService.getPendingConsultationRequests(50);
        if (!active) return;
        setPendingConsultationRequests(res?.success && Array.isArray(res.requests) ? res.requests : []);
      } catch (e) {
        if (!active) return;
        setPendingConsultationRequests([]);
      }
    };

    loadPendingConsultations();
    return () => {
      active = false;
    };
  }, [selectedCard, user?.role]);

  // Keep a lightweight time tick so scheduled consult cards can flip Pending -> Call without a manual refresh.
  useEffect(() => {
    if (selectedCard !== 'pending') return;
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, [selectedCard]);

  const getConsultationScheduledDate = useCallback((req) => {
    const v = req?.scheduledFor || req?.scheduledForIso || null;
    try {
      if (!v) return null;
      if (typeof v?.toDate === 'function') return v.toDate();
      if (v?.seconds != null) return new Date(v.seconds * 1000);
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch (_) {
      return null;
    }
  }, []);

  const openDialerForPhone = useCallback(async (rawPhone, consultRequestId = null, patientAuthUid = null) => {
    try {
      const phone = String(rawPhone || '').trim();
      if (!phone) {
        Alert.alert('Missing Phone', 'No patient phone number is available for this consultation request.');
        return;
      }
      const url = `tel:${phone}`;
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Cannot Call', 'This device cannot open the phone dialer.');
        return;
      }
      await Linking.openURL(url);
      
      // Mark consultation request as completed after opening dialer
      if (consultRequestId) {
        try {
          await FirebaseService.updateConsultationRequest(consultRequestId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            completedBy: user?.id || 'admin'
          });
          
          // Mark patient's home screen reminder as complete
          if (patientAuthUid) {
            try {
              const storageKey = `@876_home_reminders_${patientAuthUid}`;
              const existing = await AsyncStorage.getItem(storageKey);
              if (existing) {
                const reminders = JSON.parse(existing);
                const updated = reminders.map(reminder => {
                  if (reminder.type === 'consultation' && !reminder.completed) {
                    return { ...reminder, completed: true };
                  }
                  return reminder;
                });
                await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
              }
            } catch (reminderError) {
              console.error('Failed to update patient reminder:', reminderError);
            }
          }
          
          // Refresh the consultation requests list to remove the completed card
          setPendingConsultationRequests(prev => 
            prev.filter(req => req.id !== consultRequestId)
          );
        } catch (updateError) {
          console.error('Failed to mark consultation as completed:', updateError);
        }
      }
    } catch (_) {
      Alert.alert('Cannot Call', 'Unable to open the phone dialer.');
    }
  }, [user?.id]);

  const scheduleAdminConsultReminders = useCallback(async (requests) => {
    if (!user?.id) return;
    if (!Array.isArray(requests) || requests.length === 0) return;

    const storageKey = `@876_admin_consult_reminders_${user.id}`;
    let existingMap = {};
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      existingMap = raw ? (JSON.parse(raw) || {}) : {};
    } catch (_) {
      existingMap = {};
    }

    const now = new Date();
    let changed = false;

    for (const req of requests) {
      const requestId = req?.id;
      if (!requestId || existingMap[requestId]) continue;

      const scheduledDate = getConsultationScheduledDate(req);
      if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) continue;

      const notifyAt = new Date(scheduledDate.getTime() - 5 * 60 * 1000);
      if (notifyAt <= now) continue;

      const displayName = req?.patientName || req?.clientName || req?.patientEmail || req?.email || 'Patient';
      const timeLabel = scheduledDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const dateLabel = scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      try {
        const notificationId = await PushNotificationService.scheduleNotification(
          'Consultation Call Reminder',
          `Call ${displayName} at ${timeLabel} (${dateLabel}).`,
          notifyAt,
          { type: 'admin_consultation_reminder', requestId, screen: 'AdminDashboard' }
        );
        existingMap[requestId] = notificationId || true;
        changed = true;
      } catch (_) {
        // Non-critical (Expo Go / permissions) — don't block
      }
    }

    if (changed) {
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify(existingMap));
      } catch (_) {
        // ignore
      }
    }
  }, [getConsultationScheduledDate, user?.id]);

  // When pending consultations load, schedule admin reminders 5 minutes before.
  useEffect(() => {
    if (selectedCard !== 'pending') return;
    if (user?.role !== 'admin') return;
    scheduleAdminConsultReminders(pendingConsultationRequests);
  }, [pendingConsultationRequests, scheduleAdminConsultReminders, selectedCard, user?.role]);

  useEffect(() => {
    let active = true;

    const loadPendingMedicalReports = async () => {
      console.log('🔍 loadPendingMedicalReports called:', { selectedCard, userRole: user?.role, userName: user?.fullName });
      try {
        if (selectedCard !== 'pending') {
          console.log('⏭️  Skipping medical reports: selectedCard is', selectedCard, 'not "pending"');
          return;
        }
        if (user?.role !== 'admin' && user?.role !== 'superAdmin') {
          console.log('⏭️  Skipping medical reports: user.role is', user?.role, '(need "admin" or "superAdmin")');
          return;
        }
        console.log('✅ Fetching medical reports for admin:', user?.fullName || user?.email);
        const res = await FirebaseService.getPendingMedicalReportRequests(50);
        console.log('📋 Fetched medical report requests:', { success: res?.success, count: res?.requests?.length || 0, error: res?.error, requests: res?.requests });
        if (!active) return;
        setPendingMedicalReportRequests(res?.success && Array.isArray(res.requests) ? res.requests : []);
      } catch (e) {
        console.error('❌ Error loading medical report requests:', e);
        if (!active) return;
        setPendingMedicalReportRequests([]);
      }
    };

    loadPendingMedicalReports();
    return () => {
      active = false;
    };
  }, [selectedCard, user?.role, user?.fullName, user?.email]);

  const openMedicalReportRequestModal = (req) => {
    const nextReq = req || null;
    setSelectedMedicalReportRequest(nextReq);

    const to = String(nextReq?.patientEmail || nextReq?.email || '').trim();
    const patientName = String(nextReq?.patientName || '').trim();
    const patientIdKey = String(nextReq?.patientId || nextReq?.patientAuthUid || '').trim();
    const reqEmailLower = String(nextReq?.patientEmail || nextReq?.email || '').trim().toLowerCase();
    const resolvedClient =
      (patientIdKey ? clientsById.get(patientIdKey) : null) ||
      (reqEmailLower ? clientsByEmailLower.get(reqEmailLower) : null) ||
      null;

    const resolvedName =
      patientName ||
      String(resolvedClient?.name || '').trim() ||
      String(nextReq?.clientName || '').trim() ||
      'N/A';

    const resolvedEmail =
      String(nextReq?.patientEmail || nextReq?.email || '').trim() ||
      String(resolvedClient?.email || '').trim();

    const resolvedPhone =
      String(nextReq?.patientPhone || nextReq?.phone || '').trim() ||
      String(resolvedClient?.phone || '').trim();

    const resolvedAddress =
      String(nextReq?.patientAddress || nextReq?.address || '').trim() ||
      String(resolvedClient?.address || '').trim();

    const resolvedDob =
      String(resolvedClient?.dob || resolvedClient?.dateOfBirth || resolvedClient?.birthDate || '').trim();

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    const defaultReportDate = `${mm}/${dd}/${yyyy}`;

    setMedicalReportToEmail(to);
    setMedicalReportSubject(`Medical Report${resolvedName && resolvedName !== 'N/A' ? ` - ${resolvedName}` : ''}`);
    setMedicalReportBody('');
    setMedicalReportPatientName(resolvedName);
    setMedicalReportPatientEmail(resolvedEmail);
    setMedicalReportPatientPhone(resolvedPhone);
    setMedicalReportPatientAddress(resolvedAddress);
    setMedicalReportPatientDob(resolvedDob);
    setMedicalReportReportDate(defaultReportDate);
    setMedicalReportMedicalHistory('');
    setMedicalReportNurseNotes('');
    setMedicalReportNurseSignature('');
    setMedicalReportRecommendations('');
    
    // Fetch and populate allergies and vitals from patient appointments
    let allergiesText = '';
    let vitalsText = '';
    
    if (patientIdKey || resolvedClient) {
      try {
        // Get patient's appointments to extract allergies and vitals
        const patientShifts = appointments.filter(shift => 
          shift.patientId === patientIdKey || 
          shift.patientEmail?.toLowerCase() === reqEmailLower ||
          shift.patientAuthUid === patientIdKey
        );
        
        // Collect allergies and vitals from the most recent appointments
        const allergiesSet = new Set();
        let latestVitals = null;
        
        patientShifts.forEach(shift => {
          // Collect allergies
          if (shift.allergies) {
            const allergiesList = Array.isArray(shift.allergies) ? shift.allergies : [shift.allergies];
            allergiesList.forEach(allergy => {
              const allergyStr = String(allergy).trim();
              if (allergyStr && allergyStr !== 'None') allergiesSet.add(allergyStr);
            });
          }
          if (shift.allergyOther) {
            const otherStr = String(shift.allergyOther).trim();
            if (otherStr) allergiesSet.add(otherStr);
          }
          
          // Get most recent vitals (nurse-recorded takes priority over booking vitals)
          if ((shift.nurseVitals || shift.vitals) && !latestVitals) {
            latestVitals = shift.nurseVitals || shift.vitals;
          }
        });
        
        // Format allergies
        if (allergiesSet.size > 0) {
          allergiesText = Array.from(allergiesSet).join(', ');
        } else {
          allergiesText = 'No known allergies';
        }
        
        // Format vitals
        if (latestVitals) {
          const vitalsParts = [];
          const bpSys = String(latestVitals.bloodPressureSystolic || latestVitals.bpSystolic || '').trim();
          const bpDia = String(latestVitals.bloodPressureDiastolic || latestVitals.bpDiastolic || '').trim();
          const hr = String(latestVitals.heartRate || '').trim();
          const temp = String(latestVitals.temperature || '').trim();
          const spo2 = String(latestVitals.oxygenSaturation || '').trim();
          
          if (bpSys || bpDia) vitalsParts.push(`Blood Pressure: ${bpSys || '?'}/${bpDia || '?'} mmHg`);
          if (hr) vitalsParts.push(`Heart Rate: ${hr} bpm`);
          if (temp) vitalsParts.push(`Temperature: ${temp}°F`);
          if (spo2) vitalsParts.push(`Oxygen Saturation: ${spo2}%`);
          
          vitalsText = vitalsParts.length > 0 ? vitalsParts.join('\n') : 'No vitals recorded';
        } else {
          vitalsText = 'No vitals recorded';
        }
      } catch (err) {
        console.error('Error extracting allergies/vitals:', err);
      }
    }
    
    setMedicalReportAllergies(allergiesText);
    setMedicalReportVitals(vitalsText);
    setMedicalHistoryInputHeight(120);
    setNurseNotesInputHeight(120);

    setMedicalReportRequestModalVisible(true);
  };

  const closeMedicalReportRequestModal = () => {
    if (sendingMedicalReport) return;
    setMedicalReportRequestModalVisible(false);
  };

  const openMedicalReportGenerateModal = () => {
    if (sendingMedicalReport) return;
    if (!selectedMedicalReportRequest) return;

    const req = selectedMedicalReportRequest;
    const patientIdKey = String(req?.patientId || req?.patientAuthUid || '').trim();
    const reqEmailLower = String(req?.patientEmail || req?.email || '').trim().toLowerCase();
    const resolvedClient =
      (patientIdKey ? clientsById.get(patientIdKey) : null) ||
      (reqEmailLower ? clientsByEmailLower.get(reqEmailLower) : null) ||
      null;

    const resolvedPatientName =
      (req?.patientName && String(req.patientName).trim()) ||
      (req?.clientName && String(req.clientName).trim()) ||
      (resolvedClient?.name && String(resolvedClient.name).trim()) ||
      '';

    const to = String(medicalReportToEmail || '').trim();
    const subject = String(medicalReportSubject || '').trim();
    const patientName = String(resolvedPatientName || medicalReportPatientName || '').trim();
    const reportDate = String(medicalReportReportDate || '').trim();
    const medicalHistory = String(medicalReportMedicalHistory || '').trim();
    const nurseNotes = String(medicalReportNurseNotes || '').trim();
    const nurseSignature = String(medicalReportNurseSignature || '').trim();
    const recommendations = String(medicalReportRecommendations || '').trim();

    if (!to) {
      Alert.alert('Missing Email', 'Please enter the recipient email address.');
      return;
    }
    if (!subject) {
      Alert.alert('Missing Subject', 'Please enter an email subject.');
      return;
    }
    if (!patientName || patientName === 'N/A') {
      Alert.alert('Missing Patient Name', 'Please enter the patient name.');
      return;
    }
    if (!reportDate) {
      Alert.alert('Missing Report Date', 'Please enter the report date.');
      return;
    }
    if (!medicalHistory) {
      Alert.alert('Missing Medical History', 'Please enter the medical history.');
      return;
    }
    if (!nurseNotes) {
      Alert.alert("Missing Nurse's Notes", "Please enter the nurse's notes.");
      return;
    }
    if (!nurseSignature) {
      Alert.alert("Missing Nurse Signature", "Please enter the nurse's name/signature.");
      return;
    }
    if (!recommendations) {
      Alert.alert("Missing Recommendations", "Please enter recommendations.");
      return;
    }

    // Close the request modal first so the preview behaves like a separate screen
    // (avoids stacked Modals where only the scrim/overlay is visible).
    setMedicalReportRequestModalVisible(false);
    setTimeout(() => {
      setMedicalReportPreviewVisible(true);
    }, 250);
  };

  const closeMedicalReportPreviewModal = () => {
    if (sendingMedicalReport) return;
    setMedicalReportPreviewVisible(false);
  };

  const ensureFirebaseEmailEnabled = async () => {
    const config = await EmailService.getConfig();
    const next = {
      ...(config || {}),
      provider: 'firebase',
      enabled: true,
    };
    if (config?.enabled && String(config?.provider || '').toLowerCase() === 'firebase') {
      return next;
    }
    await EmailService.saveConfig(next);
    return next;
  };

  const sendMedicalReportEmailAndComplete = async () => {
    if (sendingMedicalReport) return;
    const req = selectedMedicalReportRequest;
    const requestId = req?.id;

    const patientIdKey = String(req?.patientId || req?.patientAuthUid || '').trim();
    const reqEmailLower = String(req?.patientEmail || req?.email || '').trim().toLowerCase();
    const resolvedClient =
      (patientIdKey ? clientsById.get(patientIdKey) : null) ||
      (reqEmailLower ? clientsByEmailLower.get(reqEmailLower) : null) ||
      null;

    const resolvedPatientName =
      (req?.patientName && String(req.patientName).trim()) ||
      (req?.clientName && String(req.clientName).trim()) ||
      (resolvedClient?.name && String(resolvedClient.name).trim()) ||
      '';

    const resolvedPatientEmail =
      (req?.patientEmail && String(req.patientEmail).trim()) ||
      (req?.email && String(req.email).trim()) ||
      (resolvedClient?.email && String(resolvedClient.email).trim()) ||
      '';

    const resolvedPatientPhone =
      (req?.patientPhone && String(req.patientPhone).trim()) ||
      (req?.phone && String(req.phone).trim()) ||
      (resolvedClient?.phone && String(resolvedClient.phone).trim()) ||
      '';

    const resolvedPatientAddress =
      (req?.patientAddress && String(req.patientAddress).trim()) ||
      (req?.address && String(req.address).trim()) ||
      (resolvedClient?.address && String(resolvedClient.address).trim()) ||
      '';

    const to = String(medicalReportToEmail || '').trim();
    const subject = String(medicalReportSubject || '').trim();
    const patientName = String(resolvedPatientName || medicalReportPatientName || '').trim();
    const patientDob = String(medicalReportPatientDob || '').trim();
    const reportDate = String(medicalReportReportDate || '').trim();
    const patientEmail = String(resolvedPatientEmail || medicalReportPatientEmail || '').trim();
    const patientPhone = String(resolvedPatientPhone || medicalReportPatientPhone || '').trim();
    const patientAddress = String(resolvedPatientAddress || medicalReportPatientAddress || '').trim();
    const medicalHistory = String(medicalReportMedicalHistory || '').trim();
    const nurseNotes = String(medicalReportNurseNotes || '').trim();
    const nurseSignature = String(medicalReportNurseSignature || '').trim();
    const recommendations = String(medicalReportRecommendations || '').trim();

    if (!to) {
      Alert.alert('Missing Email', 'Please enter the recipient email address.');
      return;
    }
    if (!subject) {
      Alert.alert('Missing Subject', 'Please enter an email subject.');
      return;
    }
    if (!patientName || patientName === 'N/A') {
      Alert.alert('Missing Patient Name', 'Please enter the patient name.');
      return;
    }
    if (!reportDate) {
      Alert.alert('Missing Report Date', 'Please enter the report date.');
      return;
    }
    if (!medicalHistory) {
      Alert.alert('Missing Medical History', 'Please enter the medical history.');
      return;
    }
    if (!nurseNotes) {
      Alert.alert("Missing Nurse's Notes", "Please enter the nurse's notes.");
      return;
    }
    if (!nurseSignature) {
      Alert.alert('Missing Nurse Signature', "Please enter the nurse's name/signature.");
      return;
    }
    if (!recommendations) {
      Alert.alert('Missing Recommendations', 'Please enter the recommendations.');
      return;
    }

    setSendingMedicalReport(true);
    try {
      await ensureFirebaseEmailEnabled();

      const escapeHtml = (value) =>
        String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

      const nl2br = (value) => escapeHtml(value).replace(/\r\n|\r|\n/g, '<br />');

      const safeFirstName = (String(patientName || '').trim().split(' ')[0] || 'there').trim();

      // Load logo for PDF
      const getLogoDataUri = async () => {
        try {
          const asset = Asset.fromModule(require('../assets/Images/Nurses-logo.png'));
          await asset.downloadAsync();
          let uri = asset.localUri || asset.uri;
          if (!uri) return null;

          if (!uri.startsWith('file://') && FileSystem.cacheDirectory) {
            const targetUri = `${FileSystem.cacheDirectory}876nurses-logo.png`;
            try {
              const downloadResult = await FileSystem.downloadAsync(uri, targetUri);
              uri = downloadResult?.uri || targetUri;
            } catch {
              // Keep original URI
            }
          }

          const base64Encoding =
            (FileSystem.EncodingType && (FileSystem.EncodingType.Base64 || FileSystem.EncodingType.BASE64)) ||
            'base64';

          const base64 = await FileSystem.readAsStringAsync(uri, { encoding: base64Encoding });
          return `data:image/png;base64,${base64}`;
        } catch (error) {
          console.warn('Unable to load logo for PDF:', error?.message || error);
          return null;
        }
      };

      const logoDataUri = await getLogoDataUri();

      // Company details for consistent footer styling
      const companyLegalName = '876 Nurses Home Care Services Limited';
      const companyAddress = '60 Knutsford Blvd, Panjam Building, 9th Floor - Regus, Kingston 5, Jamaica, West Indies';
      const companyWebsite = 'https://www.876nurses.com';
      const instagramUrl = 'https://instagram.com/876_nurses';
      const facebookUrl = 'https://facebook.com/876nurses';
      const whatsAppUrl = 'https://wa.me/8766189876';

      const instagramIconUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/icon-instagram.png';
      const facebookIconUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/icon-facebook.png';
      const whatsAppIconUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/icon-whatsapp.png';

      const fileSafe = (value) =>
        String(value || '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/[^a-zA-Z0-9._-]/g, '')
          .slice(0, 80);

      // 1) Build PDF (attachment) containing the full report content (match preview screen layout)
      const reportPdfHtml = `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Medical Reports of Patients</title>
            <style>
              * { box-sizing: border-box; }
              body { font-family: Arial, sans-serif; color: #1f2a44; background: #ffffff; margin: 0; padding: 0; }
              .page { padding: 28px 26px; max-width: 650px; margin: 0 auto; }
              .header { text-align: center; margin-bottom: 12px; }
              .logo { width: 90px; height: 70px; margin: 0 auto 6px; display: block; }
              .title { font-size: 18px; font-weight: 700; color: #2f62d7; margin: 0; text-align: center; }
              .bar { height: 2px; background: #2f62d7; margin: 10px 0 18px 0; }
              .section-title { font-size: 14px; font-weight: 700; color: #1f2a44; margin-top: 10px; margin-bottom: 8px; }
              .info-row { display: flex; margin-bottom: 6px; font-size: 13px; }
              .info-label { width: 140px; font-weight: 600; color: #1f2a44; }
              .info-value { flex: 1; color: #1f2a44; }
              .notes-box { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; background: #f3f4f6; min-height: 80px; margin-bottom: 14px; }
              .notes-text { font-size: 13px; line-height: 1.4; color: #1f2a44; }
              .spacer { height: 10px; }
              .footer { margin-top: 18px; font-size: 11px; color: #6b7280; text-align: center; line-height: 1.5; border-top: 1px solid #e5e7eb; padding-top: 14px; }
            </style>
          </head>
          <body>
            <div class="page">
              <div class="header">
                ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="876 Nurses" />` : ''}
                <h1 class="title">Medical Reports of Patients</h1>
              </div>
              <div class="bar"></div>

              <div class="section-title">Patient Information:</div>
              <div class="info-row">
                <span class="info-label">Name:</span>
                <span class="info-value">${escapeHtml(patientName)}</span>
              </div>
              ${patientDob ? `<div class="info-row"><span class="info-label">Date of Birth:</span><span class="info-value">${escapeHtml(patientDob)}</span></div>` : ''}
              <div class="info-row">
                <span class="info-label">Date of Report:</span>
                <span class="info-value">${escapeHtml(reportDate)}</span>
              </div>
              ${patientEmail ? `<div class="info-row"><span class="info-label">Email:</span><span class="info-value">${escapeHtml(patientEmail)}</span></div>` : ''}
              ${patientPhone ? `<div class="info-row"><span class="info-label">Phone:</span><span class="info-value">${escapeHtml(patientPhone)}</span></div>` : ''}
              ${patientAddress ? `<div class="info-row"><span class="info-label">Address:</span><span class="info-value">${escapeHtml(patientAddress)}</span></div>` : ''}

              ${medicalReportAllergies ? `<div class="spacer"></div>
              <div class="section-title">Allergies:</div>
              <div class="notes-box">
                <div class="notes-text">${nl2br(medicalReportAllergies)}</div>
              </div>` : ''}

              ${medicalReportVitals ? `<div class="section-title">Recent Vitals:</div>
              <div class="notes-box">
                <div class="notes-text">${nl2br(medicalReportVitals)}</div>
              </div>` : ''}

              <div class="spacer"></div>
              <div class="section-title">Medical History:</div>
              <div class="notes-box">
                <div class="notes-text">${nl2br(medicalHistory)}</div>
              </div>

              <div class="section-title">Nurse's Notes:</div>
              <div class="notes-box">
                <div class="notes-text">${nl2br(nurseNotes)}</div>
              </div>

              <div class="spacer"></div>
              <div class="section-title">Recommendations:</div>
              <div class="notes-box">
                <div class="notes-text">${nl2br(recommendations)}</div>
              </div>

              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <div style="font-size: 13px; font-weight: 600; color: #1f2a44; margin-bottom: 4px;">Prepared by:</div>
                <div style="font-size: 13px; color: #1f2a44;">${escapeHtml(nurseSignature)}</div>
              </div>
            </div>
          </body>
        </html>`;

      const pdf = await Print.printToFileAsync({
        html: reportPdfHtml,
        base64: false,
        width: 612,
        height: 792,
      });
      const pdfUri = pdf?.uri;
      if (!pdfUri) throw new Error('Failed to generate PDF for medical report');

      const baseFileName = `Medical-Report-${fileSafe(patientName) || 'Patient'}-${fileSafe(reportDate) || 'Report'}.pdf`;
      const storagePath = `medical-reports/${fileSafe(requestId) || 'adhoc'}/${Date.now()}-${baseFileName}`;

      const uploadRes = await FirebaseService.uploadImage(pdfUri, storagePath);
      if (!uploadRes?.success) {
        throw new Error(uploadRes?.error || 'Failed to upload medical report PDF');
      }

      // 2) Email body should be short (do not embed medical notes)
      const html = `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Medical Report Ready</title>
          </head>
          <body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,sans-serif;color:#111827;">
            <div style="max-width:600px;margin:0 auto;padding:28px 20px;line-height:1.7;">
              <p style="margin:0 0 14px 0;">Hi ${escapeHtml(safeFirstName)},</p>
              <p style="margin:0 0 10px 0;">Your medical report is ready for viewing.</p>
              <p style="margin:0 0 14px 0;">Please see the attached PDF.</p>

              <div style="margin-top:26px;">
                <div style="text-align:center;color:#9ca3af;font-size:11px;line-height:1.6;padding:10px 10px 0 10px;">
                  <span style="white-space:nowrap;">This email was sent by: ${escapeHtml(companyLegalName)}</span><br />
                  ${escapeHtml(companyAddress)}<br />
                  <a href="${escapeHtml(companyWebsite)}" style="color:#9ca3af;text-decoration:underline;font-weight:600;">${escapeHtml(
                    companyWebsite.replace(/^https?:\/\//, '').replace(/\/$/, '')
                  )}</a>
                </div>

                <div style="border-top:1px solid #e5e7eb;margin:18px 0 16px 0;"></div>

                <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    <td align="center" style="padding:0 10px;">
                      <a href="${escapeHtml(instagramUrl)}" target="_blank" rel="noopener noreferrer"
                        style="display:inline-block;width:28px;height:28px;text-decoration:none;">
                        <img src="${escapeHtml(instagramIconUrl)}" width="28" height="28" alt="Instagram"
                          style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                      </a>
                    </td>
                    <td align="center" style="padding:0 10px;">
                      <a href="${escapeHtml(facebookUrl)}" target="_blank" rel="noopener noreferrer"
                        style="display:inline-block;width:28px;height:28px;text-decoration:none;">
                        <img src="${escapeHtml(facebookIconUrl)}" width="28" height="28" alt="Facebook"
                          style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                      </a>
                    </td>
                    <td align="center" style="padding:0 10px;">
                      <a href="${escapeHtml(whatsAppUrl)}" target="_blank" rel="noopener noreferrer"
                        style="display:inline-block;width:28px;height:28px;text-decoration:none;">
                        <img src="${escapeHtml(whatsAppIconUrl)}" width="28" height="28" alt="WhatsApp"
                          style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                      </a>
                    </td>
                  </tr>
                </table>
              </div>
            </div>
          </body>
        </html>`;

      const text = [
        `Hi ${safeFirstName},`,
        '',
        'Your medical report is ready for viewing.',
        'Please see the attached PDF.',
        '',
        `This email was sent by: ${companyLegalName}`,
        companyAddress,
        `Website: ${companyWebsite}`,
        `Instagram: ${instagramUrl}`,
        `WhatsApp: ${whatsAppUrl}`,
      ].join('\n');

      const sendRes = await EmailService.send({
        to,
        subject,
        html,
        text,
        attachments: [
          {
            storagePath,
            filename: baseFileName,
            contentType: 'application/pdf',
          },
        ],
        meta: {
          type: 'medical_report',
          requestId: requestId || null,
          patientId: req?.patientId || null,
          reportStoragePath: storagePath,
          reportPdfUrl: uploadRes?.url || null,
        },
      });

      if (!sendRes?.success) {
        throw new Error(sendRes?.error || 'Failed to queue email');
      }

      if (requestId) {
        await FirebaseService.updateMedicalReportRequest(requestId, {
          status: 'completed',
          completedAtIso: new Date().toISOString(),
          generatedByUid: user?.id || user?.uid || null,
          generatedById: user?.id || null,
          emailQueuedId: sendRes?.id || null,
          reportStoragePath: storagePath,
          reportPdfUrl: uploadRes?.url || null,
          reportFileName: baseFileName,
        });
      }

      setPendingMedicalReportRequests((prev) => (Array.isArray(prev) ? prev.filter((r) => r?.id !== requestId) : []));
      setMedicalReportPreviewVisible(false);
      setMedicalReportRequestModalVisible(false);
      setSelectedMedicalReportRequest(null);
      Alert.alert('Queued', 'Medical report email has been queued to send.');
    } catch (e) {
      Alert.alert('Send Failed', e?.message || 'Failed to send medical report email.');
    } finally {
      setSendingMedicalReport(false);
    }
  };

  useEffect(() => {
    // Reset initialization flag when user changes so the sequences reinitialize
    const initializeSequences = async () => {
      if (sequencesInitialized) {
        // Sequences already initialized
        return;
      }
      
      // Starting sequence initialization
      try {
        // Get or initialize persistent sequence counters
        const storedNurseSequence = await AsyncStorage.getItem('nurseSequenceCounter');
        const storedAdminSequence = await AsyncStorage.getItem('adminSequenceCounter');
        
        // Also check existing data to ensure we don't go backwards
        const allKeys = await AsyncStorage.getAllKeys();
        const existingNurses = nurses || [];

        // Fetch authoritative lists from backend when possible
        let backendAdmins = [];
        let backendNurses = [];
        if (user) {
          try {
            // Use the proper staff endpoints
            const adminResp = await ApiService.getAdmins({ limit: 1000 });
            if (adminResp && adminResp.success && Array.isArray(adminResp.users)) {
              backendAdmins = adminResp.users;
            }
          } catch (e) {
            // Could not fetch admin users
          }
          try {
            const nurseResp = await ApiService.getNurses({ limit: 1000 });
            if (nurseResp && nurseResp.success && Array.isArray(nurseResp.users)) backendNurses = nurseResp.users;
          } catch (e) {
            // Could not fetch nurse users
          }
        }
        
        // Find all nurse and admin codes that have ever been used
        const existingNurseCodes = [...existingNurses, ...backendNurses]
          .filter(nurse => (nurse.code || nurse.nurseCode) && (nurse.code || nurse.nurseCode).match(/^NURSE\d{3}$/))
          .map(nurse => {
            const code = nurse.code || nurse.nurseCode;
            const match = code.match(/NURSE(\d{3})/);
            return match ? parseInt(match[1]) : 0;
          })
          .filter(num => num > 0);

        // Check for adminCode field (backend admins use adminCode, not code)
        const existingAdminCodes = [...backendAdmins]
          .filter(admin => (admin.adminCode || admin.code) && (admin.adminCode || admin.code).match(/^ADMIN\d{3}$/))
          .map(admin => {
            const code = admin.adminCode || admin.code;
            const match = code.match(/ADMIN(\d{3})/);
            return match ? parseInt(match[1]) : 0;
          })
          .filter(num => num > 0);
        
        // Ensure ADMIN001 is always recognized as existing (Nurse Bernard)
        if (!existingAdminCodes.includes(1)) {
          existingAdminCodes.push(1);
          // Added ADMIN001 to existing admin codes
        }
        
        // Also check AsyncStorage keys for historical usage
        const nurseKeys = allKeys.filter(key => key.match(/^NURSE\d{3}$/));
        const adminKeys = allKeys.filter(key => key.match(/^ADMIN\d{3}$/));
        
        const storageNurseNumbers = nurseKeys.map(key => {
          const match = key.match(/NURSE(\d{3})/);
          return match ? parseInt(match[1]) : 0;
        }).filter(num => num > 0);
        
        const storageAdminNumbers = adminKeys.map(key => {
          const match = key.match(/ADMIN(\d{3})/);
          return match ? parseInt(match[1]) : 0;
        }).filter(num => num > 0);
        
        // Combine all sources to find the highest ever used numbers
        const allNurseNumbers = [...new Set([...existingNurseCodes, ...storageNurseNumbers])];
        const allAdminNumbers = [...new Set([...existingAdminCodes, ...storageAdminNumbers])];
        
        // Calculate what the next sequence should be based on highest usage
        const highestNurseUsed = allNurseNumbers.length > 0 ? Math.max(...allNurseNumbers) : 0;
        const highestAdminUsed = allAdminNumbers.length > 0 ? Math.max(...allAdminNumbers) : 0; // No sample data default
        
        // Get stored counters or initialize them. Prefer backend data when available.
        const backendFetched = backendAdmins.length > 0 || backendNurses.length > 0;
        let nextNurseSequence;
        let nextAdminSequence;
        if (backendFetched) {
          nextNurseSequence = highestNurseUsed + 1;
          nextAdminSequence = highestAdminUsed + 1;
        } else {
          nextNurseSequence = storedNurseSequence ? parseInt(storedNurseSequence) : (highestNurseUsed + 1);
          nextAdminSequence = storedAdminSequence ? parseInt(storedAdminSequence) : (highestAdminUsed + 1);
        }
        
        // Ensure we never go backwards (in case storage is out of sync)
        // Ensure we never go backwards
        nextNurseSequence = Math.max(nextNurseSequence, highestNurseUsed + 1);
        nextAdminSequence = Math.max(nextAdminSequence, highestAdminUsed + 1);
        
        // Ensure admin sequence is never less than 2 (ADMIN001 is taken by Nurse Bernard)
        nextAdminSequence = Math.max(nextAdminSequence, 2);
        

        // Stored nurse sequence
        // Stored admin sequence
        // Highest nurse used
        // Highest admin used
        // Next nurse sequence
        // Next admin sequence
        
        // Save the counters back to storage
        await AsyncStorage.setItem('nurseSequenceCounter', nextNurseSequence.toString());
        await AsyncStorage.setItem('adminSequenceCounter', nextAdminSequence.toString());
        
        setNurseSequence(nextNurseSequence);
        setAdminSequence(nextAdminSequence);
        setSequencesInitialized(true);
        
        // Sequence initialization complete
      } catch (error) {
        // Error initializing sequences
        // Fallback to safe numbers if there's an error
        setNurseSequence(4);
        setAdminSequence(4);
      }
    };
    
    initializeSequences();
  }, [user]);
  
  // Reinitialize sequences whenever the user changes (e.g., admin login)
  useEffect(() => {
    setSequencesInitialized(false);
  }, [user?.id]);

  // Auto-generate code when staffRole changes OR when modal becomes visible
  useEffect(() => {
    // staffRole changed
    if (sequencesInitialized && nurseSequence > 0 && adminSequence > 0) { // Only after sequences are initialized
      // Triggering auto-generation
      generateNurseCode();
    } else {
      // Sequences not ready yet
    }
  }, [staffRole, sequencesInitialized, nurseSequence, adminSequence, generateNurseCode]); // Added all dependencies

  // Also auto-generate when the create staff modal becomes visible
  useEffect(() => {
    if (createNurseModalVisible && sequencesInitialized && nurseSequence > 0 && adminSequence > 0) {
      // Modal opened, generating code for current role
      generateNurseCode();
    }
  }, [createNurseModalVisible, sequencesInitialized, nurseSequence, adminSequence, generateNurseCode]);

  // Function to pick nurse ID photo
  const pickNurseIdPhoto = async () => {
    try {
      // Request permission to access photo library
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Sorry, we need camera roll permissions to upload nurse ID photos.');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setNurseIdPhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Error picking nurse ID photo:', error);
      Alert.alert('Error', 'Failed to select photo. Please try again.');
    }
  };

  // Function to remove selected photo
  const removeNurseIdPhoto = () => {
    setNurseIdPhoto(null);
  };

  // Generate initial code when sequences are ready - always regenerate when sequences change
  useEffect(() => {
    if (sequencesInitialized && nurseSequence > 0 && adminSequence > 0) {
      // Sequences ready, generating code with Admin: adminSequence, Nurse: nurseSequence
      generateNurseCode();
    }
  }, [sequencesInitialized, nurseSequence, adminSequence, staffRole, generateNurseCode]);

  // Debug: Log whenever nurseCode changes
  useEffect(() => {
    // nurseCode state changed
  }, [nurseCode]);

  // Pull to refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    // Pull to refresh triggered
    try {
      await Promise.all([
        refreshAppointments(),
        refreshShiftRequests(),
        refreshRequests(),
        refreshNotifications()
      ]);
      // Clear fresh nurse data cache to refetch
      setFreshNurseDataMap(new Map());
      // Refresh complete
    } catch (error) {
      // Refresh error
    } finally {
      setRefreshing(false);
    }
  };

  // Fetch fresh nurse data when viewing appointment details
  useEffect(() => {
    const fetchFreshNurseData = async () => {
      if (!selectedAppointmentDetails?.nurseId) return;
      
      const nurseId = selectedAppointmentDetails.nurseId || selectedAppointmentDetails.assignedNurseId;
      if (!nurseId || freshNurseDataMap.has(nurseId)) return;

      try {
        const result = await FirebaseService.getUser(nurseId);
        if (result.success && result.user) {
          setFreshNurseDataMap(prev => new Map(prev).set(nurseId, result.user));
        }
      } catch (error) {
        console.error('Failed to fetch fresh nurse data:', error);
      }
    };

    fetchFreshNurseData();
  }, [selectedAppointmentDetails?.nurseId, selectedAppointmentDetails?.assignedNurseId]);

  useEffect(() => {
    const fetchShiftNurseProfiles = async () => {
      if (!selectedShiftRequest) return;

      const ids = new Set();
      if (selectedShiftRequest.nurseId) {
        ids.add(selectedShiftRequest.nurseId);
      }

      if (Array.isArray(selectedShiftRequest.assignedNurses)) {
        selectedShiftRequest.assignedNurses.forEach((entry) => {
          if (!entry) return;
          if (typeof entry === 'string') {
            ids.add(entry);
            return;
          }
          const entryId = entry.nurseId || entry._id || entry.id;
          if (entryId) ids.add(entryId);
        });
      }

      if (selectedShiftRequest.nurseSchedule) {
        Object.values(selectedShiftRequest.nurseSchedule).forEach((value) => {
          if (value) ids.add(value);
        });
      }

      const mapInstance = freshNurseDataMap instanceof Map ? freshNurseDataMap : new Map();
      const missingIds = Array.from(ids).filter((id) => id && !mapInstance.has(id));
      if (!missingIds.length) return;

      try {
        await Promise.all(
          missingIds.map(async (nurseId) => {
            try {
              const result = await FirebaseService.getUser(nurseId);
              if (result.success && result.user) {
                setFreshNurseDataMap((prev) => {
                  const next = new Map(prev);
                  next.set(nurseId, result.user);
                  return next;
                });
              }
            } catch (error) {
              console.error('Failed to fetch recurring shift nurse:', error);
            }
          })
        );
      } catch (error) {
        console.error('Failed to resolve shift nurses:', error);
      }
    };

    fetchShiftNurseProfiles();
  }, [selectedShiftRequest, freshNurseDataMap]);

  // Fetch client/patient profiles for pending shift requests so Pending cards can show the actual patient name.
  useEffect(() => {
    const fetchPendingClientProfiles = async () => {
      const sources = [];
      if (Array.isArray(pendingShiftRequests)) sources.push(...pendingShiftRequests);
      if (Array.isArray(pendingRecurringShiftRequests)) sources.push(...pendingRecurringShiftRequests);
      if (Array.isArray(finalActiveAppointments)) sources.push(...finalActiveAppointments);
      if (Array.isArray(finalCompletedAppointments)) sources.push(...finalCompletedAppointments);

      if (!sources.length) return;

      const ids = new Set();
      const emails = new Set();
      sources.forEach((req) => {
        if (!req) return;
        const hasName =
          req.patientName ||
          req.clientName ||
          req.patientFullName ||
          req.clientFullName ||
          req.clientSnapshot?.name ||
          req.clientSnapshot?.fullName ||
          req.patient?.fullName ||
          req.client?.name;
        const hasPhoto =
          req.clientProfilePhoto ||
          req.patientProfilePhoto ||
          req.clientPhoto ||
          req.patientPhoto ||
          req.profilePhoto ||
          req.profileImage ||
          req.profileImageUrl ||
          req.profilePicture ||
          req.photoUrl ||
          req.photoURL ||
          req.photo ||
          req.imageUrl ||
          req.avatar ||
          req.avatarUrl ||
          req.clientAvatar ||
          req.clientAvatarUrl ||
          req.client?.profilePhoto ||
          req.client?.profileImage ||
          req.client?.profileImageUrl ||
          req.client?.profilePicture ||
          req.client?.photoUrl ||
          req.client?.photoURL ||
          req.client?.photo ||
          req.client?.imageUrl ||
          req.client?.avatar ||
          req.client?.avatarUrl ||
          req.patient?.profilePhoto ||
          req.patient?.profileImage ||
          req.patient?.profileImageUrl ||
          req.patient?.profilePicture ||
          req.patient?.photoUrl ||
          req.patient?.photoURL ||
          req.patient?.photo ||
          req.patient?.imageUrl ||
          req.patient?.avatar ||
          req.patient?.avatarUrl ||
          req.clientSnapshot?.profilePhoto ||
          req.clientSnapshot?.profileImage ||
          req.clientSnapshot?.profileImageUrl ||
          req.clientSnapshot?.profilePicture ||
          req.clientSnapshot?.photoUrl ||
          req.clientSnapshot?.photoURL ||
          req.clientSnapshot?.photo ||
          req.clientSnapshot?.imageUrl ||
          req.clientSnapshot?.avatar ||
          req.clientSnapshot?.avatarUrl ||
          req.patientSnapshot?.profilePhoto ||
          req.patientSnapshot?.profileImage ||
          req.patientSnapshot?.profileImageUrl ||
          req.patientSnapshot?.profilePicture ||
          req.patientSnapshot?.photoUrl ||
          req.patientSnapshot?.photoURL ||
          req.patientSnapshot?.photo ||
          req.patientSnapshot?.imageUrl ||
          req.patientSnapshot?.avatar ||
          req.patientSnapshot?.avatarUrl;
        if (hasName && hasPhoto) return;

        const key = req.clientId || req.patientId;
        if (key) ids.add(String(key));

        const emailKey =
          req.clientEmail ||
          req.patientEmail ||
          req.email ||
          req.client?.email ||
          req.patient?.email ||
          req.user?.email ||
          null;
        if (emailKey) emails.add(String(emailKey).toLowerCase());
      });

      const mapInstance = freshClientDataMap instanceof Map ? freshClientDataMap : new Map();
      const missing = Array.from(ids).filter((id) => id && !mapInstance.has(id));
      const missingEmails = Array.from(emails).filter((email) => email && !mapInstance.has(email));
      if (!missing.length && !missingEmails.length) return;

      await Promise.all(
        [
          ...missing.map((clientId) => ({ type: 'id', value: clientId })),
          ...missingEmails.map((email) => ({ type: 'email', value: email })),
        ].map(async ({ type, value }) => {
          try {
            if (type === 'id') {
              // Try direct doc lookup first
              const result = await FirebaseService.getUser(value);
              if (result?.success && result.user) {
                setFreshClientDataMap((prev) => {
                  const next = new Map(prev);
                  next.set(value, result.user);
                  if (result.user?.id || result.user?._id || result.user?.uid) {
                    const primaryId = result.user.id || result.user._id || result.user.uid;
                    next.set(String(primaryId), result.user);
                  }
                  if (result.user?.email) {
                    next.set(String(result.user.email).toLowerCase(), result.user);
                  }
                  return next;
                });
                return;
              }
            }
          } catch (e) {
            // ignore
          }

          // Fallback: patient codes may be like PATIENT001
          try {
            if (type === 'id') {
              const res2 = await FirebaseService.getUserByUsername(value);
              if (res2?.success && res2.user) {
                setFreshClientDataMap((prev) => {
                  const next = new Map(prev);
                  next.set(value, res2.user);
                  if (res2.user?.id || res2.user?._id || res2.user?.uid) {
                    const primaryId = res2.user.id || res2.user._id || res2.user.uid;
                    next.set(String(primaryId), res2.user);
                  }
                  if (res2.user?.email) {
                    next.set(String(res2.user.email).toLowerCase(), res2.user);
                  }
                  return next;
                });
              }
            }
          } catch (e) {
            // ignore
          }

          if (type === 'email') {
            try {
              const res3 = await FirebaseService.getUserByEmail(value);
              if (res3?.success && res3.user) {
                setFreshClientDataMap((prev) => {
                  const next = new Map(prev);
                  next.set(String(value).toLowerCase(), res3.user);
                  if (res3.user?.id || res3.user?._id || res3.user?.uid) {
                    const primaryId = res3.user.id || res3.user._id || res3.user.uid;
                    next.set(String(primaryId), res3.user);
                  }
                  if (res3.user?.email) {
                    next.set(String(res3.user.email).toLowerCase(), res3.user);
                  }
                  return next;
                });
              }
            } catch (e) {
              // ignore
            }
          }
        })
      );
    };

    fetchPendingClientProfiles();
  }, [pendingShiftRequests, pendingRecurringShiftRequests, finalActiveAppointments, finalCompletedAppointments, freshClientDataMap]);

  // Clear all AsyncStorage data for testing
  const clearAllData = async () => {
    Alert.alert('Clear All Data', 'This will clear all appointments and shift data. Are you sure?', [
      {
        text: 'Cancel',
        onPress: () => {},
        style: 'cancel'
      },
      {
        text: 'Clear All',
        onPress: async () => {
          try {
            const DEBUG_ADMIN_STORAGE = false;
            // Clear from contexts first
            await clearAllAppointments();
            await clearAllShiftRequests();
            
            // Get ALL keys from AsyncStorage
            const allKeys = await AsyncStorage.getAllKeys();
            // Debug logging removed per request
            
            // Filter keys related to appointments, shifts, nurses, transactions, etc.
            const keysToDelete = allKeys.filter(key => 
              key.includes('appointment') || 
              key.includes('shift') || 
              key.includes('nurse') ||
              key.includes('care') ||
              key.includes('transaction') ||
              key.includes('payslip')
            );
            
            // Debug logging removed per request
            
            // Delete all matching keys
            await Promise.all(keysToDelete.map(key => AsyncStorage.removeItem(key)));
            
            // Force refresh appointments from backend
            await refreshAppointments();
            
            Alert.alert(
              'Success', 
              'All local data cleared!\n\n⚠️ Important: Please fully close and restart the app to clear all cached data.',
              [{ text: 'OK' }]
            );
          } catch (error) {
            console.error('Clear data error:', error);
            Alert.alert('Error', 'Failed to clear data: ' + error.message);
          }
        },
        style: 'destructive'
      }
    ]);
  };

  // Handle navigation parameters from notifications
  useEffect(() => {
    if (route?.params?.initialTab) {
      setSelectedCard(route.params.initialTab);
      
      // If highlighting a specific shift request, open the modal
      if (route.params.highlightShiftRequest && route.params.initialTab === 'pending') {
        const shiftRequest = getPendingShiftRequests().find(
          request => request.id === route.params.highlightShiftRequest
        );
        if (shiftRequest) {
          setSelectedShiftRequest(shiftRequest);
          setShiftRequestModalVisible(true);
        }
      }
      
      // Clear the params after handling
      navigation.setParams({ 
        initialTab: undefined, 
        highlightShiftRequest: undefined 
      });
    }
  }, [route?.params, navigation]);

  // Get appointments from context - Fix duplicate and count issues
  const allAppointments = appointments || [];
  // IMPORTANT: Filter out shift requests from regular appointments - they have their own section
  const pendingAssignments = (getAppointmentsByStatus('pending') || []).filter(apt => 
    !apt.isShiftRequest && 
    !apt.isRecurring && 
    !apt.recurringPattern && 
    !apt.adminRecurring && 
    !apt.recurringFrequency
  ); // Only unassigned appointments
  const nurseAssignedAppointments = (getAppointmentsByStatus('assigned') || []).filter(apt => 
    !apt.isShiftRequest && 
    !apt.isRecurring && 
    !apt.recurringPattern && 
    !apt.adminRecurring && 
    !apt.recurringFrequency
  ); // Assigned but waiting for nurse response
  const confirmedAppointments = (getAppointmentsByStatus('confirmed') || []).filter(apt => !apt.isShiftRequest); // Filter out shift requests
  const activeAppointments = allAppointments.filter(
    (apt) =>
      !apt.isShiftRequest &&
      (apt.status === 'active' || apt.status === 'clocked-in' || apt.status === 'in-progress')
  );
  const completedAppointments = (getAppointmentsByStatus('completed') || []).filter(apt => !apt.isShiftRequest); // Filter out shift requests
  const availableNurses = getAvailableNursesFromContext() || []; // Use NurseContext instead of AppointmentContext
  
  const isRecurringRequest = (request) => {
    if (!request) {
      return false;
    }

    if (request.adminRecurring) {
      return true;
    }

    if (request.isRecurring) {
      return true;
    }

    if (request.recurringPattern) {
      return true;
    }

    if (request.recurringFrequency) {
      return true;
    }

    if (request.recurringApprovalStatus) {
      return true;
    }

    return false;
  };

  const doesRecurringNeedMoreAssignmentsOrResponses = (request) => {
    if (!isRecurringRequest(request)) {
      return false;
    }

    // If the shift is already approved or active, it doesn't need admin attention
    const shiftStatus = String(request?.status || '').toLowerCase();
    if (shiftStatus === 'approved' || shiftStatus === 'active') {
      return false;
    }

    // Coverage requests take priority: if one is pending, the shift needs attention.
    const coverageRequests = Array.isArray(request?.coverageRequests) ? request.coverageRequests : [];
    if (coverageRequests.some((cr) => String(cr?.status || '').toLowerCase() === 'pending')) {
      return true;
    }
    if (coverageRequests.some((cr) => String(cr?.status || '').toLowerCase() === 'accepted')) {
      return false; // It's covered, so not pending admin action.
    }

    const nurseSchedule = (request?.nurseSchedule && typeof request.nurseSchedule === 'object')
      ? request.nurseSchedule
      : null;

    const toDayNumber = (value) => {
      const n = typeof value === 'string' ? Number(value) : value;
      return Number.isInteger(n) ? n : null;
    };

    const activeDays = Array.from(
      new Set(
        ([]
          .concat(request?.daysOfWeek || [])
          .concat(request?.recurringDaysOfWeek || [])
          .concat(request?.recurringDaysOfWeekList || [])
          .concat(request?.recurringPattern?.daysOfWeek || [])
          .map(toDayNumber)
          .filter((n) => n !== null && n >= 0 && n <= 6))
      )
    );

    // Get all unique nurse identifiers that are required for this shift.
    let requiredNurseRawIds = [];
    if (nurseSchedule) {
      const daysToCheck = activeDays.length > 0 ? activeDays.map(String) : Object.keys(nurseSchedule);
      // If a scheduled day is unassigned, it needs action.
      if (daysToCheck.some(day => !nurseSchedule[day])) {
        return true;
      }
      requiredNurseRawIds = daysToCheck.map(day => nurseSchedule[day]);
    } else {
      const assigned = Array.isArray(request?.assignedNurses) ? request.assignedNurses : [];
      requiredNurseRawIds = assigned.map(entry => {
        if (typeof entry === 'string') return entry;
        return entry?.nurseId || entry?.uid || entry?.id || entry?._id || entry?.nurseKey;
      });
      
      // If no assignedNurses array, check single assignment fields (patient-created shifts)
      if (requiredNurseRawIds.length === 0) {
        const singleNurseId = request?.nurseId || request?.primaryNurseId || request?.nurseUid;
        if (singleNurseId) {
          requiredNurseRawIds.push(singleNurseId);
        }
      }
    }

    const uniqueRequiredRawIds = [...new Set(requiredNurseRawIds.filter(Boolean))];

    // If no one is assigned at all, it needs action.
    if (uniqueRequiredRawIds.length === 0) {
      return true;
    }

    // --- ID Normalization ---
    // Create a map from ANY known nurse ID to their primary DB ID (_id).
    const roster = Array.isArray(nurses) ? nurses : [];
    const aliasToPrimaryIdMap = new Map();
    roster.forEach(nurse => {
      if (!nurse) return;
      const primaryId = nurse._id || nurse.id;
      if (!primaryId) return;

      const aliases = [
        primaryId,
        nurse.uid,
        nurse.nurseId,
        nurse.code,
        nurse.nurseCode,
        nurse.staffCode,
        nurse.username,
        nurse.email,
      ].filter(Boolean).map(id => String(id).trim().toUpperCase());
      
      aliases.forEach(alias => aliasToPrimaryIdMap.set(alias, primaryId));
    });

    // Convert all required raw IDs to their primary DB IDs.
    // KEY FIX: If a nurse is not found in the roster map, use the RAW ID as the primary ID.
    // This handles cases where the nurse might not be in the loaded list but is assigned by ID.
    const requiredPrimaryIds = new Set(
      uniqueRequiredRawIds.map(id => {
        const raw = String(id).trim().toUpperCase();
        return aliasToPrimaryIdMap.get(raw) || raw;
      }).filter(Boolean)
    );

    // If, after all attempts, there are no valid required nurses, something is wrong. Treat as pending.
    if (requiredPrimaryIds.size === 0) {
      return true;
    }

    // Get all nurse responses and normalize their keys to primary DB IDs.
    const acceptedPrimaryIds = new Set();
    const nurseResponses = (request?.nurseResponses && typeof request.nurseResponses === 'object') ? request.nurseResponses : {};

    for (const [key, response] of Object.entries(nurseResponses)) {
      if (String(response?.status || '').toLowerCase() !== 'accepted') continue;
      
      // The key itself might be the ID we need.
      const rawKey = String(key).trim().toUpperCase();
      const primaryIdFromKey = aliasToPrimaryIdMap.get(rawKey) || rawKey;
      if (primaryIdFromKey) {
        acceptedPrimaryIds.add(primaryIdFromKey);
      }
      
      // The response object might contain other IDs.
      const idsInResponse = [response.uid, response.nurseId, response.nurseCode, response.email].filter(Boolean);
      for (const id of idsInResponse) {
        const rawId = String(id).trim().toUpperCase();
        const primaryId = aliasToPrimaryIdMap.get(rawId) || rawId;
        if (primaryId) {
          acceptedPrimaryIds.add(primaryId);
        }
      }
    }

    // Finally, check if AT LEAST ONE of the required primary IDs has accepted.
    // RELAXED LOGIC: Because sometimes the "single" nurse shift might have "Requested" vs "Assigned",
    // or ID mismatches, if we find ANY valid acceptance for a single-nurse shift, we can consider it handled.
    // For Split Schedule, we still stricly need all assignments covered.

    // If it is NOT a split schedule (or explicitly single), we can be lenient.
    const isSplitSchedule = request?.assignmentType === 'split-schedule' || (nurseSchedule && Object.keys(nurseSchedule).length > 0);
    
    if (!isSplitSchedule) {
      // For single nurse shifts, if ANY matching acceptance is found, we're good.
      for (const requiredId of requiredPrimaryIds) {
        if (acceptedPrimaryIds.has(requiredId)) {
          return false; // Found at least one acceptance for the required nurse.
        }
      }
      // If we are here, none of the required nurses accepted.
      return true;
    } else {
      // For split schedule, ALL required slots must be filled and accepted.
      for (const requiredId of requiredPrimaryIds) {
        if (!acceptedPrimaryIds.has(requiredId)) {
          return true; // Found a required nurse who hasn't accepted.
        }
      }
    }

    return false; // All required nurses have accepted.
  };

  // Get shift data to include in appointment sections - MEMOIZED
  const hasValidClockOut = useCallback((shift) => {
    if (!shift || typeof shift !== 'object') return false;

    const clockMaps = [
      shift.clockByNurse,
      shift.activeShift?.clockByNurse,
      shift.shiftDetails?.clockByNurse,
      shift.shift?.clockByNurse,
    ].filter((m) => m && typeof m === 'object');

    if (clockMaps.length === 0) return false;

    const hasClockOutInMap = (clockMap) => {
      const entries = Object.values(clockMap);
      if (entries.length === 0) return false;

      return entries.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const inTime = entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
        const outTime = entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt;
        if (!inTime || !outTime) return false;

        const inMs = Date.parse(inTime);
        const outMs = Date.parse(outTime);
        if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return false;
        return outMs > inMs;
      });
    };

    return clockMaps.some(hasClockOutInMap);
  }, []);

  const isSingleDayRecurringShift = useCallback((shift) => {
    if (!shift || typeof shift !== 'object') return false;
    if (!isRecurringRequest(shift)) return false;

    const pattern = (shift?.recurringPattern && typeof shift.recurringPattern === 'object') ? shift.recurringPattern : {};

    const shiftCore = shift?.shift && typeof shift.shift === 'object' ? shift.shift : null;
    const detailsCore = shift?.shiftDetails && typeof shift.shiftDetails === 'object' ? shift.shiftDetails : null;
    const activeCore = shift?.activeShift && typeof shift.activeShift === 'object' ? shift.activeShift : null;

    const startRaw =
      shift?.recurringPeriodStart ||
      activeCore?.recurringPeriodStart ||
      detailsCore?.recurringPeriodStart ||
      shiftCore?.recurringPeriodStart ||
      shift?.recurringStartDate ||
      activeCore?.recurringStartDate ||
      detailsCore?.recurringStartDate ||
      shiftCore?.recurringStartDate ||
      pattern?.startDate ||
      shift?.startDate ||
      activeCore?.startDate ||
      detailsCore?.startDate ||
      shiftCore?.startDate ||
      shift?.scheduledDate ||
      activeCore?.scheduledDate ||
      detailsCore?.scheduledDate ||
      shiftCore?.scheduledDate ||
      shift?.date ||
      activeCore?.date ||
      detailsCore?.date ||
      shiftCore?.date ||
      shift?.serviceDate ||
      activeCore?.serviceDate ||
      detailsCore?.serviceDate ||
      shiftCore?.serviceDate ||
      null;

    const endRaw =
      shift?.recurringPeriodEnd ||
      activeCore?.recurringPeriodEnd ||
      detailsCore?.recurringPeriodEnd ||
      shiftCore?.recurringPeriodEnd ||
      shift?.recurringEndDate ||
      activeCore?.recurringEndDate ||
      detailsCore?.recurringEndDate ||
      shiftCore?.recurringEndDate ||
      pattern?.endDate ||
      shift?.endDate ||
      activeCore?.endDate ||
      detailsCore?.endDate ||
      shiftCore?.endDate ||
      shift?.scheduledEndDate ||
      activeCore?.scheduledEndDate ||
      detailsCore?.scheduledEndDate ||
      shiftCore?.scheduledEndDate ||
      shift?.shiftEndDate ||
      activeCore?.shiftEndDate ||
      detailsCore?.shiftEndDate ||
      shiftCore?.shiftEndDate ||
      null;

    const start = coerceToDateValue(startRaw);
    const end = coerceToDateValue(endRaw);
    if (!start || !end) return false;

    return (
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate()
    );
  }, [isRecurringRequest]);

  const shouldTreatShiftAsCompletedVisit = useCallback((request) => {
    if (!request) return false;
    if (String(request?.status || '').toLowerCase() === 'completed') return true;
    if (request?.finalCompletedAt || request?.finalCompletedDate) return true;

    const recurring = isRecurringRequest(request);
    if (!recurring) return hasValidClockOut(request);

    // Recurring:
    // - single-day recurring can be treated as completed after a valid clock-out
    // - multi-day recurring should NOT move to Completed after the first occurrence
    if (isSingleDayRecurringShift(request)) return hasValidClockOut(request);

    const pattern = (request?.recurringPattern && typeof request.recurringPattern === 'object') ? request.recurringPattern : {};
    const shiftCore = request?.shift && typeof request.shift === 'object' ? request.shift : null;
    const detailsCore = request?.shiftDetails && typeof request.shiftDetails === 'object' ? request.shiftDetails : null;
    const activeCore = request?.activeShift && typeof request.activeShift === 'object' ? request.activeShift : null;

    const endRaw =
      request?.recurringPeriodEnd ||
      activeCore?.recurringPeriodEnd ||
      detailsCore?.recurringPeriodEnd ||
      shiftCore?.recurringPeriodEnd ||
      request?.recurringEndDate ||
      activeCore?.recurringEndDate ||
      detailsCore?.recurringEndDate ||
      shiftCore?.recurringEndDate ||
      pattern?.endDate ||
      request?.endDate ||
      activeCore?.endDate ||
      detailsCore?.endDate ||
      shiftCore?.endDate ||
      request?.scheduledEndDate ||
      activeCore?.scheduledEndDate ||
      detailsCore?.scheduledEndDate ||
      shiftCore?.scheduledEndDate ||
      request?.shiftEndDate ||
      activeCore?.shiftEndDate ||
      detailsCore?.shiftEndDate ||
      shiftCore?.shiftEndDate ||
      null;

    const end = coerceToDateValue(endRaw);
    if (!end) return false;

    const startOfLastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
    const endOfLastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    const now = new Date();

    const clockMaps = [
      request.clockByNurse,
      activeCore?.clockByNurse,
      detailsCore?.clockByNurse,
      shiftCore?.clockByNurse,
      request.shift?.clockByNurse,
      request.shiftDetails?.clockByNurse,
      request.activeShift?.clockByNurse,
    ].filter((m) => m && typeof m === 'object');

    const resolveLatestClockOutMs = () => {
      let latestMs = -Infinity;
      for (const map of clockMaps) {
        for (const entry of Object.values(map)) {
          if (!entry || typeof entry !== 'object') continue;
          const outTime =
            entry.lastClockOutTime ||
            entry.actualEndTime ||
            entry.clockOutTime ||
            entry.completedAt ||
            null;
          if (!outTime) continue;
          const ms = Date.parse(outTime);
          if (Number.isFinite(ms) && ms > latestMs) latestMs = ms;
        }
      }
      return Number.isFinite(latestMs) ? latestMs : null;
    };

    const hasAnyActiveClockIn = () => {
      for (const map of clockMaps) {
        for (const entry of Object.values(map)) {
          if (!entry || typeof entry !== 'object') continue;
          const inTime =
            entry.lastClockInTime ||
            entry.actualStartTime ||
            entry.clockInTime ||
            entry.startedAt ||
            null;
          const outTime =
            entry.lastClockOutTime ||
            entry.actualEndTime ||
            entry.clockOutTime ||
            entry.completedAt ||
            null;

          if (!inTime) continue;
          if (!outTime) return true;

          const inMs = Date.parse(inTime);
          const outMs = Date.parse(outTime);
          if (!Number.isFinite(inMs)) continue;
          if (!Number.isFinite(outMs)) return true;
          if (inMs > outMs) return true;
        }
      }
      return false;
    };

    const hasClockOut = hasValidClockOut(request);
    const latestOutMs = resolveLatestClockOutMs();
    const clockedOutOnLastDay =
      Number.isFinite(latestOutMs) &&
      latestOutMs >= startOfLastDay.getTime() &&
      latestOutMs <= endOfLastDay.getTime();

    // If the full series period has ended: any clock-out means it's completed.
    if (now > endOfLastDay) return hasClockOut;

    // If we're on/after the last day: treat as completed as soon as we have a clock-out
    // on the last day and there are no active clock-ins.
    if (now >= startOfLastDay && hasClockOut && clockedOutOnLastDay && !hasAnyActiveClockIn()) return true;

    return false;
  }, [hasValidClockOut, isRecurringRequest, isSingleDayRecurringShift]);

  const activeShifts = useMemo(
    () => (shiftRequests?.filter(request => request.status === 'active' && !shouldTreatShiftAsCompletedVisit(request)) || []),
    [shiftRequests, shouldTreatShiftAsCompletedVisit]
  );
  
  const completedShifts = useMemo(() => {
    // Completed list:
    // - Include requests explicitly marked completed
    // - Include non-recurring shifts with a valid clock-out
    // - Include recurring shifts only when the series is actually finished (status completed/finalCompletedAt/period ended)
    return (
      shiftRequests?.filter((request) => {
        return shouldTreatShiftAsCompletedVisit(request);
      }) || []
    );
  }, [shiftRequests, shouldTreatShiftAsCompletedVisit]);

  // Auto-generate final invoice once a recurring series is treated as completed.
  // This is admin-side only and uses a ref guard to avoid duplicate attempts.
  useEffect(() => {
    if (!Array.isArray(completedShifts) || completedShifts.length === 0) return;

    let cancelled = false;

    const normalizeClockMs = (value) => {
      if (!value) return null;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;

      if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
          const d = value.toDate();
          const ms = d instanceof Date ? d.getTime() : NaN;
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

    const extractLatestClockOutMs = (request) => {
      const candidates = [
        request?.clockByNurse,
        request?.shift?.clockByNurse,
        request?.shiftDetails?.clockByNurse,
        request?.activeShift?.clockByNurse,
      ].filter((m) => m && typeof m === 'object');

      let best = null;
      for (const map of candidates) {
        for (const entry of Object.values(map)) {
          if (!entry || typeof entry !== 'object') continue;
          const outRaw = entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt || null;
          const outMs = normalizeClockMs(outRaw);
          if (outMs === null) continue;
          if (best === null || outMs > best) best = outMs;

          const sessions = Array.isArray(entry.clockEntries) ? entry.clockEntries : [];
          for (const s of sessions) {
            if (!s || typeof s !== 'object') continue;
            const sm = normalizeClockMs(s.clockOutTime || s.actualEndTime || s.completedAt);
            if (sm === null) continue;
            if (best === null || sm > best) best = sm;
          }
        }
      }
      return best;
    };

    const computeTotalHoursFromClock = (request) => {
      const maps = [
        request?.clockByNurse,
        request?.shift?.clockByNurse,
        request?.shiftDetails?.clockByNurse,
        request?.activeShift?.clockByNurse,
      ].filter((m) => m && typeof m === 'object');

      let totalMs = 0;
      let foundAny = false;

      for (const map of maps) {
        for (const entry of Object.values(map)) {
          if (!entry || typeof entry !== 'object') continue;
          const sessions = Array.isArray(entry.clockEntries) ? entry.clockEntries : [];

          if (sessions.length > 0) {
            for (const s of sessions) {
              if (!s || typeof s !== 'object') continue;
              const inMs = normalizeClockMs(s.clockInTime || s.actualStartTime || s.startedAt);
              const outMs = normalizeClockMs(s.clockOutTime || s.actualEndTime || s.completedAt);
              if (inMs === null || outMs === null) continue;
              if (outMs > inMs) {
                totalMs += (outMs - inMs);
                foundAny = true;
              }
            }
            continue;
          }

          const inMs = normalizeClockMs(entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt);
          const outMs = normalizeClockMs(entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt);
          if (inMs === null || outMs === null) continue;
          if (outMs > inMs) {
            totalMs += (outMs - inMs);
            foundAny = true;
          }
        }
      }

      if (foundAny) {
        const hours = totalMs / (1000 * 60 * 60);
        return Math.max(0, Math.round(hours * 100) / 100);
      }

      const fallback =
        request?.hoursWorked ||
        request?.lastHoursWorked ||
        request?.totalHours ||
        request?.hours ||
        0;
      const n = typeof fallback === 'number' ? fallback : parseFloat(String(fallback));
      if (Number.isFinite(n) && n > 0) return n;
      return 1;
    };

    const getClientFields = (request) => {
      const base = request || {};
      const shiftSnapshot = base?.shiftSnapshot || base?.shift || base?.shiftDetails || {};

      const clientEmail =
        base?.clientEmail ||
        base?.patientEmail ||
        base?.email ||
        base?.clientSnapshot?.email ||
        base?.patientSnapshot?.email ||
        shiftSnapshot?.clientEmail ||
        shiftSnapshot?.patientEmail ||
        shiftSnapshot?.email ||
        shiftSnapshot?.clientSnapshot?.email ||
        shiftSnapshot?.patientSnapshot?.email ||
        '';

      const clientName =
        base?.clientName ||
        base?.patientName ||
        base?.clientSnapshot?.name ||
        base?.patientSnapshot?.name ||
        shiftSnapshot?.clientName ||
        shiftSnapshot?.patientName ||
        shiftSnapshot?.clientSnapshot?.name ||
        shiftSnapshot?.patientSnapshot?.name ||
        'Client';

      const clientPhone =
        base?.clientPhone ||
        base?.patientPhone ||
        base?.phone ||
        shiftSnapshot?.clientPhone ||
        shiftSnapshot?.patientPhone ||
        shiftSnapshot?.phone ||
        'N/A';

      const address =
        base?.address ||
        base?.clientAddress ||
        shiftSnapshot?.address ||
        shiftSnapshot?.clientAddress ||
        'Address on file';

      return { clientEmail, clientName, clientPhone, address };
    };

    (async () => {
      try {
        const allInvoices = await InvoiceService.getAllInvoices();
        const invoices = Array.isArray(allInvoices) ? allInvoices : [];

        // if (__DEV__) {
        //   console.log('[Admin Invoice AutoGen] Starting scan', {
        //     completedShiftsCount: completedShifts.length,
        //     totalInvoices: invoices.length,
        //   });
        // }

        const invoiceByShiftId = new Map();
        for (const inv of invoices) {
          const sid = inv?.shiftRequestId ? String(inv.shiftRequestId) : null;
          if (!sid) continue;
          if (!invoiceByShiftId.has(sid)) invoiceByShiftId.set(sid, inv);
        }

        for (const request of completedShifts) {
          if (cancelled) return;

          const shiftId = request?.id || request?._id || null;
          if (!shiftId) continue;

          const shiftIdKey = String(shiftId);

          // if (__DEV__ && shiftIdKey === 'IFUO3HmNuZ5sO74KFQGb') {
          //   console.log('[Admin Invoice AutoGen][IFUO3HmNuZ5sO74KFQGb] Checking', {
          //     alreadyAttempted: autoFinalShiftInvoiceAttemptedRef.current.has(shiftIdKey),
          //     finalInvoiceId: request?.finalInvoiceId || null,
          //     finalInvoiceGeneratedAt: request?.finalInvoiceGeneratedAt || null,
          //     finalInvoiceSentAt: request?.finalInvoiceSentAt || null,
          //     isRecurring: isRecurringRequest(request),
          //     status: request?.status,
          //     existingInvoice: invoiceByShiftId.has(shiftIdKey) ? invoiceByShiftId.get(shiftIdKey)?.invoiceId : null,
          //   });
          // }

          if (autoFinalShiftInvoiceAttemptedRef.current.has(shiftIdKey)) continue;

          const alreadyHasFinal = Boolean(
            request?.finalInvoiceId ||
              request?.finalInvoiceGeneratedAt ||
              request?.finalInvoiceSentAt
          );
          if (alreadyHasFinal) continue;

          if (!isRecurringRequest(request)) continue;

          const existing = invoiceByShiftId.get(shiftIdKey) || null;
          if (existing?.invoiceId) {
            autoFinalShiftInvoiceAttemptedRef.current.add(shiftIdKey);
            try {
              await ApiService.updateShiftRequest(shiftIdKey, {
                finalInvoiceId: existing.invoiceId,
                finalInvoiceGeneratedAt: request?.finalInvoiceGeneratedAt || new Date().toISOString(),
              });
            } catch (e) {
              // ignore
            }
            continue;
          }

          autoFinalShiftInvoiceAttemptedRef.current.add(shiftIdKey);

          const { clientEmail, clientName, clientPhone, address } = getClientFields(request);

          const serviceType =
            request?.service ||
            request?.serviceType ||
            request?.serviceName ||
            request?.appointmentType ||
            null;
          if (!serviceType) continue;

          const nurseName = request?.nurseName || request?.assignedNurseName || 'Assigned Nurse';

          const latestOutMs = extractLatestClockOutMs(request);
          const completedAtIso = Number.isFinite(latestOutMs) ? new Date(latestOutMs).toISOString() : new Date().toISOString();

          const hoursWorked = computeTotalHoursFromClock(request);

          // if (__DEV__ && shiftIdKey === 'IFUO3HmNuZ5sO74KFQGb') {
          //   console.log('[Admin Invoice AutoGen][IFUO3HmNuZ5sO74KFQGb] Creating invoice', {
          //     clientEmail,
          //     clientName,
          //     serviceType,
          //     hoursWorked,
          //     completedAtIso,
          //   });
          // }

          const invoiceRes = await InvoiceService.createInvoice({
            ...(request || {}),
            id: shiftIdKey,
            relatedAppointmentId: shiftIdKey,
            shiftRequestId: shiftIdKey,
            clientName,
            patientName: clientName,
            clientEmail,
            patientEmail: clientEmail,
            clientPhone,
            patientPhone: clientPhone,
            address,
            clientAddress: address,
            nurseName,
            service: serviceType,
            serviceType,
            serviceName: serviceType,
            appointmentDate: completedAtIso,
            scheduledDate: completedAtIso,
            hoursWorked,
          });

          // if (__DEV__ && shiftIdKey === 'IFUO3HmNuZ5sO74KFQGb') {
          //   console.log('[Admin Invoice AutoGen][IFUO3HmNuZ5sO74KFQGb] Invoice creation result', {
          //     success: invoiceRes?.success,
          //     invoiceId: invoiceRes?.invoice?.invoiceId,
          //     error: invoiceRes?.error || null,
          //   });
          // }

          if (invoiceRes?.success && invoiceRes?.invoice?.invoiceId) {
            await ApiService.updateShiftRequest(shiftIdKey, {
              finalInvoiceId: invoiceRes.invoice.invoiceId,
              finalInvoiceGeneratedAt: new Date().toISOString(),
              finalCompletedAt: completedAtIso,
            });

            // if (__DEV__ && shiftIdKey === 'IFUO3HmNuZ5sO74KFQGb') {
            //   console.log('[Admin Invoice AutoGen][IFUO3HmNuZ5sO74KFQGb] Updated shift request with finalInvoiceId', {
            //     finalInvoiceId: invoiceRes.invoice.invoiceId,
            //   });
            // }
          } else {
            console.warn('⚠️ Admin final shift invoice auto-generation failed:', invoiceRes?.error || 'Unknown error');
          }
        }
      } catch (error) {
        console.warn('⚠️ Admin final shift invoice auto-generation failed:', error?.message || error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [completedShifts, isRecurringRequest]);
  
  const confirmedShifts = useMemo(
    () => shiftRequests?.filter(request => request.status === 'approved' && !shouldTreatShiftAsCompletedVisit(request)) || [],
    [shiftRequests, shouldTreatShiftAsCompletedVisit]
  );
  
  // Get pending shift requests - MEMOIZED
  // These are requests FROM nurses TO admins
  const pendingShiftRequests = useMemo(() => {
    const pending = getPendingShiftRequests() || [];
    // Filter out recurring shift requests (from admin to nurses)
    return pending.filter(req => !isRecurringRequest(req));
  }, [shiftRequests, getPendingShiftRequests]);

  // Get pending recurring shift requests - MEMOIZED
  // These are requests FROM admin TO nurses for approval OR patient-created recurring requests
  const pendingRecurringShiftRequests = useMemo(() => {
    const pending = getPendingShiftRequests() || [];
    const pendingAppts = getAppointmentsByStatus('pending') || [];
    
    // Keep recurring requests visible while any nurse slot still needs action,
    // even if overall status moved to active/approved due to another nurse clock-in.
    const byId = new Map();

    // 1. Process Shift Requests that are recurring
    for (const req of pending.filter(req => isRecurringRequest(req))) {
      const id = req?.id || req?._id;
      // Only keep as "pending" if it still needs nurse assignment/response.
      if (id && doesRecurringNeedMoreAssignmentsOrResponses(req)) {
        byId.set(String(id), req);
      }
    }

    // 2. Process ACTIVE/APPROVED Shift Requests that still need attention (partial assignment)
    // DISABLED: If a shift is approved/active, do NOT show it in pending, even if some slots are open.
    // This allows partially filled shifts to move to "Recurring Shifts" tab instead of cluttering Pending.
    /*
    for (const req of (shiftRequests || [])) {
      if (!isRecurringRequest(req)) continue;

      const status = String(req?.status || '').toLowerCase();
      if (status === 'completed' || status === 'cancelled' || status === 'canceled') continue;

      // Only keep it in the Pending tab when it still needs nurse assignment/response.
      if (!doesRecurringNeedMoreAssignmentsOrResponses(req)) continue;

      const id = req?.id || req?._id;
      if (id && !byId.has(String(id))) {
        byId.set(String(id), req);
      }
    }
    */
    // REPLACEMENT: Only show explicitly PENDING shifts
    // Active/Approved recurring shifts will be managed in the "Recurring Shifts" section


    // 3. Process Patient-Created Recurring Appointments (pending)
    // These were filtered out of "Assignment Requests" so MUST appear here
    for (const apt of pendingAppts) {
      if (!isRecurringRequest(apt)) continue;
      
      const id = apt?.id || apt?._id;

      // CRITICAL FIX: If this ID is already APPROVED in shiftRequests, ignore this pending appointment artifact.
      if (id) {
        const alreadyApproved = (shiftRequests || []).find(r => 
          (String(r.id) === String(id) || String(r._id) === String(id)) && 
          ['approved', 'active'].includes(String(r.status || '').toLowerCase())
        );
        if (alreadyApproved) continue;
      }

      if (id && !byId.has(String(id))) {
        // Only if it really needs assignment (it should, since it is pending)
        if (doesRecurringNeedMoreAssignmentsOrResponses(apt)) {
           byId.set(String(id), { ...apt, isPatientRecurring: true }); // Tag it if needed
        }
      }
    }

    return Array.from(byId.values());
  }, [shiftRequests, getPendingShiftRequests, getAppointmentsByStatus]);

  // Get pending profile edit requests - MEMOIZED
  const pendingProfileEditRequests = useMemo(
    () => {
      if (!editRequests) {

        return [];
      }
      const pending = editRequests.filter(req => req.status === 'pending');

      if (pending.length > 0) {

      }
      return pending;
    },
    [editRequests]
  );
  
  // Combined data for admin display
  const allConfirmedAppointments = [...confirmedAppointments, ...confirmedShifts];
  const allActiveAppointments = [...confirmedAppointments, ...activeAppointments, ...activeShifts]; // Active includes confirmed + active shifts
  const allCompletedAppointments = [...completedAppointments, ...completedShifts];
  
  // Helper function to format shift data to look like appointment data
  const formatShiftAsAppointment = (shift) => {
    // Mock client data lookup - in real app this would fetch from client management
    const getClientDetails = (clientId, clientName) => {
      // Mock client database - updated with PATIENT001 details
      const clients = {
        '1': { email: 'testpatient@care.com', phone: '+1 (555) 987-6543', address: '456 Oak Ave, Town, State 67890' },
        'PATIENT001': { email: 'testpatient@care.com', phone: '+1 (555) 987-6543', address: '456 Oak Ave, Town, State 67890' },
        'patient-001': { email: 'testpatient@care.com', phone: '+1 (555) 987-6543', address: '456 Oak Ave, Town, State 67890' }
      };
      
      return clients[clientId] || clients[clientName] || {
        email: 'client@care.com',
        phone: '+1 (555) 000-0000', 
        address: 'Address on file'
      };
    };

    const clientDetails = getClientDetails(shift.clientId, shift.clientName);

    const coerceToDate = (value) => {
      if (!value) return null;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof value === 'object') {
        // Firestore Timestamp
        if (typeof value.toDate === 'function') {
          const d = value.toDate();
          return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
        }
        // Serialized timestamp-like { seconds, nanoseconds }
        if (typeof value.seconds === 'number') {
          const d = new Date(value.seconds * 1000);
          return Number.isNaN(d.getTime()) ? null : d;
        }
      }
      return null;
    };

    const formatShortDate = (value) => {
      if (!value) return '';
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return '';
        // Already in the desired format
        if (/^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/.test(trimmed)) return trimmed;
      }
      const d = coerceToDate(value);
      if (d) {
        return d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
      return typeof value === 'string' ? value : '';
    };

    // Format the date consistently with other dates in the app
    const formattedDate = formatShortDate(shift.date);

    const formattedShift = {
      ...shift,
      patientName: shift.clientName || 'Shift Assignment',
      serviceName: shift.service,
      scheduledTime: `${formattedDate} ${shift.startTime || ''}`.trim(),
      duration: '1 hour', // default duration
      nurseAssigned: shift.nurseName || 'Assigned Nurse',
      // Include client contact details
      email: clientDetails.email,
      phone: clientDetails.phone,
      address: clientDetails.address,
      // Include completion notes from nurse
      completionNotes: shift.completionNotes,
      nurseNotes: shift.completionNotes, // Also map to nurseNotes for compatibility
      isShift: true, // flag to identify shifts
      type: shift.status === 'active' ? 'active_shift' : 
            shift.status === 'completed' ? 'completed_shift' : 
            'approved_shift'
    };

    return formattedShift;
  };
  
  // Format shifts before combining - MEMOIZED to prevent re-renders
  const formattedConfirmedShifts = useMemo(
    () => confirmedShifts.map(formatShiftAsAppointment),
    [confirmedShifts]
  );
  const formattedActiveShifts = useMemo(
    () => activeShifts.map(formatShiftAsAppointment),
    [activeShifts]
  );
  const formattedCompletedShifts = useMemo(
    () => completedShifts.map(formatShiftAsAppointment),
    [completedShifts]
  );
  
  // Update combined arrays with formatted data - MEMOIZED
  const finalConfirmedAppointments = useMemo(
    () => [...confirmedAppointments, ...formattedConfirmedShifts],
    [confirmedAppointments, formattedConfirmedShifts]
  );
  const finalActiveAppointments = useMemo(
    () => [...confirmedAppointments, ...activeAppointments, ...formattedActiveShifts],
    [confirmedAppointments, activeAppointments, formattedActiveShifts]
  );
  const finalCompletedAppointments = useMemo(
    () => [...completedAppointments, ...formattedCompletedShifts],
    [completedAppointments, formattedCompletedShifts]
  );

  const sortedFinalCompletedAppointments = useMemo(() => {
    const items = Array.isArray(finalCompletedAppointments) ? [...finalCompletedAppointments] : [];

    const resolveClockOutMsFromMap = (clockByNurse) => {
      if (!clockByNurse || typeof clockByNurse !== 'object') return null;
      try {
        const entries = Object.values(clockByNurse);
        let best = null;
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue;
          const outRaw =
            entry.lastClockOutTime ||
            entry.actualEndTime ||
            entry.clockOutTime ||
            entry.completedAt ||
            null;
          if (!outRaw) continue;
          const ms = Date.parse(outRaw);
          if (!Number.isFinite(ms)) continue;
          if (best === null || ms > best) best = ms;
        }
        return best;
      } catch (e) {
        return null;
      }
    };

    const getCompletionMs = (item) => {
      if (!item) return 0;

      const direct =
        item.completedAt ||
        item.actualEndTime ||
        item.clockOutTime ||
        item.lastClockOutTime ||
        item.lastActualEndTime ||
        item.lastCompletedAt ||
        null;

      const directDate = coerceToDateValue(direct);
      if (directDate) return directDate.getTime();

      const clockMs =
        resolveClockOutMsFromMap(item.clockByNurse) ||
        resolveClockOutMsFromMap(item.activeShift?.clockByNurse) ||
        resolveClockOutMsFromMap(item.shiftDetails?.clockByNurse) ||
        resolveClockOutMsFromMap(item.shift?.clockByNurse) ||
        null;
      if (typeof clockMs === 'number') return clockMs;

      const fallback = item.date || item.scheduledDate || item.startDate || null;
      const fallbackDate = coerceToDateValue(fallback);
      return fallbackDate ? fallbackDate.getTime() : 0;
    };

    items.sort((a, b) => getCompletionMs(b) - getCompletionMs(a));
    return items;
  }, [finalCompletedAppointments]);

  const selectedShiftTimes = useMemo(() => {
    if (!selectedShiftRequest) {
      return { start: null, end: null, durationLabel: null };
    }
    const startRaw = selectedShiftRequest.startTime || selectedShiftRequest.time;
    const endRaw = selectedShiftRequest.endTime;
    return {
      start: startRaw ? formatDisplayTime(startRaw) : null,
      end: endRaw ? formatDisplayTime(endRaw) : null,
      durationLabel: buildDurationLabel(startRaw, endRaw)
    };
  }, [selectedShiftRequest]);

  const isRecurringSchedule = useMemo(
    () => isRecurringRequest(selectedShiftRequest),
    [selectedShiftRequest]
  );

  // Distinguish admin-created recurring shifts (need nurse assignment) from nurse-created recurring shift requests (need approval)
  const isAdminCreatedRecurring = useMemo(() => {
    if (!isRecurringSchedule) return false;
    return selectedShiftRequest?.adminRecurring === true || 
      String(selectedShiftRequest?.adminRecurring || '').trim().toLowerCase() === 'true';
  }, [isRecurringSchedule, selectedShiftRequest?.adminRecurring]);

  const selectedShiftActualTimes = useMemo(() => {
    if (!selectedShiftRequest?.actualStartTime || !selectedShiftRequest?.actualEndTime) {
      return null;
    }

    const startDate = new Date(selectedShiftRequest.actualStartTime);
    const endDate = new Date(selectedShiftRequest.actualEndTime);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return null;
    }

    const durationMs = Math.max(endDate.getTime() - startDate.getTime(), 0);
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const totalHours = (durationMs / (1000 * 60 * 60)).toFixed(2);

    return {
      startLabel: startDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      endLabel: endDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }),
      durationLabel: `${hours}h ${minutes}m (${totalHours} hours)`
    };
  }, [selectedShiftRequest?.actualStartTime, selectedShiftRequest?.actualEndTime]);

  const appointmentClockDetails = useMemo(
    () => extractClockDetailsFromRecord(selectedAppointmentDetails),
    [selectedAppointmentDetails]
  );

  const openNurseDetailsModal = (details) => {
    if (!details) return;
    setSelectedNurseDetails(details);
    setNurseDetailsModalVisible(true);
  };

  const openShiftRequestInlineNurseDetailsModal = (details) => {
    if (!details) return;
    setShiftRequestInlineNurseDetails(details);
    setShiftRequestInlineNurseDetailsVisible(true);
  };

  useEffect(() => {
    if (!shiftRequestModalVisible) {
      setShiftRequestInlineNurseDetailsVisible(false);
      setShiftRequestInlineNurseDetails(null);
    }
  }, [shiftRequestModalVisible]);

  const renderAppointmentNurseActions = () => {
    const details = selectedAppointmentDetails || {};
    const statusValue = String(
      details.status || details.appointmentStatus || details.requestStatus || ''
    ).toLowerCase();
    const isDeclined = statusValue === 'declined' || statusValue === 'rejected';

    const nurseKey =
      details.nurseId ||
      details.assignedNurseId ||
      details.assignedNurse?.id ||
      details.nurse?.id ||
      details.assignedNurse?.nurseId ||
      details.nurse?.nurseId ||
      details.nurseCode ||
      details.staffCode ||
      details.assignedNurse?.nurseCode ||
      details.assignedNurse?.staffCode ||
      details.nurse?.nurseCode ||
      details.nurse?.staffCode ||
      null;

    if (!nurseKey) return null;

    const nurseLabel =
      freshNurseDataMap.get(details.nurseId || details.assignedNurseId)?.fullName ||
      details.nurseName ||
      details.assignedNurseName ||
      details.assignedNurse?.name ||
      details.nurse?.name ||
      'Assigned Nurse';

    const nurseData =
      freshNurseDataMap.get(details.nurseId || details.assignedNurseId) ||
      details.assignedNurse ||
      details.nurse ||
      {
        nurseId: details.nurseId || details.assignedNurseId,
        nurseCode: details.nurseCode || details.assignedNurse?.nurseCode,
        staffCode: details.staffCode || details.assignedNurse?.staffCode,
      };

    const clockEntry = getClockEntryByNurse(details, nurseKey, nurseData);
    const fallbackClockDetails =
      appointmentClockDetails ||
      extractClockDetailsFromRecord(details.clockDetails || details.activeShift || details.shiftDetails || details.shift || details) ||
      {};

    const clockDetailsPayload = {
      clockInTime:
        clockEntry?.lastClockInTime ||
        clockEntry?.clockInTime ||
        fallbackClockDetails.clockInTime ||
        details.actualStartTime ||
        details.clockInTime ||
        details.startedAt ||
        null,
      clockOutTime:
        clockEntry?.lastClockOutTime ||
        clockEntry?.clockOutTime ||
        fallbackClockDetails.clockOutTime ||
        details.actualEndTime ||
        details.clockOutTime ||
        details.completedAt ||
        null,
      clockInLocation:
        clockEntry?.lastClockInLocation ||
        clockEntry?.clockInLocation ||
        fallbackClockDetails.clockInLocation ||
        details.clockInLocation ||
        details.startLocation ||
        null,
      clockOutLocation:
        clockEntry?.lastClockOutLocation ||
        clockEntry?.clockOutLocation ||
        fallbackClockDetails.clockOutLocation ||
        details.clockOutLocation ||
        details.endLocation ||
        null,
    };

    // Note: we intentionally do not show a "View" chip here anymore.
    // The only action shown under the Assigned Nurse card is "Reassign" when declined.

    // If reassign modal is open for this nurse, show close button
    if (reassignFromNurseKey === nurseKey && reassignNurseModalVisible) {
      return (
        <TouchableOpacity 
          onPress={closeReassignNurseModal}
          style={{ padding: 5 }}
        >
          <MaterialCommunityIcons name="close-circle" size={24} color={COLORS.textSecondary} />
        </TouchableOpacity>
      );
    }

    // If nurse declined, show Reassign button
    if (isDeclined) {
      return (
        <TouchableWeb
          style={styles.reassignChip}
          onPress={() => openReassignNurseModal(nurseKey)}
          disabled={reassignSubmitting}
        >
          <LinearGradient
            colors={GRADIENTS.warning}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.reassignChipGradient}
          >
            <MaterialCommunityIcons name="account-switch" size={16} color={COLORS.white} />
            <Text style={styles.reassignChipText}>Reassign</Text>
          </LinearGradient>
        </TouchableWeb>
      );
    }

    // Otherwise, no action button.
    return null;
  };

  const shiftRequestClockDetails = useMemo(
    () => {
      if (!selectedShiftRequest) return null;
      const source =
        selectedShiftRequest.clockDetails ||
        selectedShiftRequest.activeShift ||
        selectedShiftRequest.shiftDetails ||
        selectedShiftRequest.shift ||
        selectedShiftRequest;
      return extractClockDetailsFromRecord(source);
    },
    [selectedShiftRequest]
  );

  const selectedRecurringDetails = useMemo(() => {
    if (!isRecurringSchedule) {
      return null;
    }

    const pattern = selectedShiftRequest?.recurringPattern || {};
    const rawFrequency = selectedShiftRequest?.recurringFrequency || pattern.frequency || '';
    let frequencyLabel = rawFrequency
      ? rawFrequency.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
      : 'Recurring';
      
    if (selectedShiftRequest?.adminRecurring && !rawFrequency) {
      frequencyLabel = 'Weekly';
    }

    const daysSource = selectedShiftRequest?.recurringDaysOfWeekList?.length
      ? selectedShiftRequest.recurringDaysOfWeekList
      : (selectedShiftRequest?.recurringDaysOfWeek?.length
        ? selectedShiftRequest.recurringDaysOfWeek
        : pattern.daysOfWeek || []);
        
    const startSource = selectedShiftRequest?.recurringPeriodStart || selectedShiftRequest?.recurringStartDate || pattern.startDate || null;
    const endSource = selectedShiftRequest?.recurringPeriodEnd || selectedShiftRequest?.recurringEndDate || pattern.endDate || null;
    const totalOccurrences = pattern.totalOccurrences ?? selectedShiftRequest?.totalOccurrences ?? null;

    return {
      frequencyLabel,
      daysLabel: formatDaysOfWeekList(daysSource),
      periodLabel: formatDateRangeDisplay(startSource, endSource),
      totalOccurrences
    };
  }, [isRecurringSchedule, selectedShiftRequest]);

  const resolveNurseDisplayInfo = useCallback(
    (targetNurseId) => {
      if (!targetNurseId && selectedShiftRequest?.nurseId) {
        targetNurseId = selectedShiftRequest.nurseId;
      }
      if (!targetNurseId) return null;

      const assignedList = Array.isArray(selectedShiftRequest?.assignedNurses)
        ? selectedShiftRequest.assignedNurses
        : [];

      let matchedEntry = assignedList.find((entry) => {
        if (!entry) return false;
        if (typeof entry === 'string') {
          return entry === targetNurseId;
        }
        const entryId = entry.nurseId || entry._id || entry.id;
        return entryId === targetNurseId;
      });

      if (typeof matchedEntry === 'string') {
        matchedEntry = { nurseId: matchedEntry };
      }

      const rosterMatch =
        (Array.isArray(nurses) ? nurses : []).find((nurse) => {
          const id = nurse._id || nurse.id || nurse.nurseId;
          // Check all possible code fields
          const code = nurse.code || nurse.staffCode || nurse.nurseCode || nurse.username;
          return (id && id === targetNurseId) || (code && code === targetNurseId);
        }) || null;

      const cachedEntry = freshNurseDataMap instanceof Map ? freshNurseDataMap.get(targetNurseId) : null;

      const fallbackPrimary =
        targetNurseId === selectedShiftRequest?.nurseId
          ? {
              nurseName:
                selectedShiftRequest?.nurseName || selectedShiftRequest?.nurseFullName,
              nurseCode:
                selectedShiftRequest?.nurseCode || selectedShiftRequest?.nurseId,
              profilePhoto:
                selectedShiftRequest?.nurseProfilePhoto ||
                selectedShiftRequest?.nursePhoto ||
                selectedShiftRequest?.nurseProfileImage,
            }
          : null;

      const resolvedName =
        matchedEntry?.nurseName ||
        matchedEntry?.fullName ||
        cachedEntry?.fullName ||
        cachedEntry?.nurseName ||
        rosterMatch?.fullName ||
        rosterMatch?.name ||
        rosterMatch?.nurseName ||
        (rosterMatch?.firstName ? `${rosterMatch.firstName} ${rosterMatch.lastName}`.trim() : null) ||
        fallbackPrimary?.nurseName ||
        `${fallbackPrimary?.firstName || ''} ${fallbackPrimary?.lastName || ''}`.trim();

      const resolvedCode =
        matchedEntry?.nurseCode ||
        cachedEntry?.nurseCode ||
        rosterMatch?.code ||
        rosterMatch?.nurseCode ||
        rosterMatch?.staffCode ||
        fallbackPrimary?.nurseCode ||
        fallbackPrimary?.code ||
        targetNurseId;

      const resolvedPhoto =
        matchedEntry?.profilePhoto ||
        matchedEntry?.profileImage ||
        cachedEntry?.profilePhoto ||
        cachedEntry?.profileImage ||
        rosterMatch?.profilePhoto ||
        rosterMatch?.profileImage ||
        rosterMatch?.photoUrl ||
        rosterMatch?.image ||
        fallbackPrimary?.profilePhoto ||
        fallbackPrimary?.nurseProfilePhoto ||
        fallbackPrimary?.profileImage ||
        null;

      const resolvedSpecialty =
        matchedEntry?.nurseSpecialty ||
        matchedEntry?.specialization ||
        matchedEntry?.specialty ||
        cachedEntry?.specialization ||
        cachedEntry?.specialty ||
        cachedEntry?.nurseSpecialty ||
        rosterMatch?.specialization ||
        rosterMatch?.specialty ||
        rosterMatch?.nurseSpecialty ||
        fallbackPrimary?.nurseSpecialty ||
        selectedShiftRequest?.nurseSpecialty ||
        selectedShiftRequest?.specialty ||
        null;

      const rawKeys = [
        targetNurseId,
        matchedEntry?.nurseId,
        matchedEntry?.id,
        matchedEntry?._id,
        cachedEntry?.id,
        cachedEntry?._id,
        cachedEntry?.uid,
        cachedEntry?.nurseId,
        rosterMatch?._id,
        rosterMatch?.id,
        rosterMatch?.uid,
        rosterMatch?.nurseId,
        rosterMatch?.code,
        rosterMatch?.staffCode,
        rosterMatch?.nurseCode,
        rosterMatch?.username,
        resolvedCode,
      ];
      
      const lookupKeys = rawKeys
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .map((v) => String(v).trim())
        .filter(Boolean);

      return {
        nurseId: targetNurseId,
        nurseName: (resolvedName && resolvedName.trim()) || 'Assigned Nurse',
        nurseCode: resolvedCode || targetNurseId,
        profilePhoto: resolvedPhoto,
        nurseSpecialty: resolvedSpecialty,
        lookupKeys: [...new Set(lookupKeys)],
      };
    },
    [nurses, freshNurseDataMap, selectedShiftRequest]
  );

  const nurseAssignmentCards = useMemo(() => {
    if (!selectedShiftRequest || !isRecurringSchedule) {
      return [];
    }

    const schedule = selectedShiftRequest.nurseSchedule;
    if (schedule && Object.keys(schedule).length > 0) {
      const daysByNurse = {};
      Object.entries(schedule).forEach(([dayValue, nurseId]) => {
        if (!nurseId) return;
        if (!daysByNurse[nurseId]) {
          daysByNurse[nurseId] = [];
        }
        daysByNurse[nurseId].push(dayValue);
      });

      return Object.entries(daysByNurse).map(([nurseId, days]) => {
        const info = resolveNurseDisplayInfo(nurseId) || { nurseId };
        const normalizedDays = days
          .map((day) => (typeof day === 'string' ? parseInt(day, 10) : day))
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
          .sort((a, b) => a - b);

        const dayLabel = normalizedDays.length
          ? normalizedDays.map((day) => DAY_LABELS[day] || day).join(', ')
          : 'No days assigned';

        return {
          ...info,
          nurseId,
          dayLabel,
          dayValues: normalizedDays,
        };
      });
    }

    const primaryInfo = resolveNurseDisplayInfo(selectedShiftRequest.nurseId);
    if (!primaryInfo) return [];

    const fallbackDaysSource = selectedShiftRequest?.recurringDaysOfWeekList?.length
      ? selectedShiftRequest.recurringDaysOfWeekList
      : (selectedShiftRequest?.recurringDaysOfWeek?.length
        ? selectedShiftRequest.recurringDaysOfWeek
        : selectedShiftRequest?.recurringPattern?.daysOfWeek || []);

    const fallbackDayValues = (Array.isArray(fallbackDaysSource) ? fallbackDaysSource : [])
      .map((day) => (typeof day === 'string' ? parseInt(day, 10) : day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);

    return [
      {
        ...primaryInfo,
        dayLabel: selectedRecurringDetails?.daysLabel || 'All selected days',
        dayValues: fallbackDayValues,
      },
    ];
  }, [
    selectedShiftRequest,
    isRecurringSchedule,
    resolveNurseDisplayInfo,
    selectedRecurringDetails,
  ]);

  const selectedShiftLocationSummary = useMemo(() => {
    if (!selectedShiftRequest) {
      return null;
    }

    const directLocation = selectedShiftRequest.locationDetails || selectedShiftRequest.location;
    const directSummary = formatLocationAddress(directLocation);
    if (directSummary && directSummary.toUpperCase() !== 'TBD') {
      return directSummary;
    }

    if (selectedShiftRequest.clientLocation) {
      const clientSummary = formatLocationAddress({ address: selectedShiftRequest.clientLocation });
      if (clientSummary && clientSummary.toUpperCase() !== 'TBD') {
        return clientSummary;
      }
    }

    if (selectedShiftRequest.clientAddress && selectedShiftRequest.clientAddress.toUpperCase() !== 'TBD') {
      return selectedShiftRequest.clientAddress;
    }

    return null;
  }, [selectedShiftRequest]);

  const selectedRecurringBilling = useMemo(() => {
    if (!isRecurringSchedule) {
      return null;
    }

    const billing = selectedShiftRequest?.recurringBilling || null;
    const cycleValue = billing?.billingCycle || selectedShiftRequest?.billingCycle || null;
    const cycleLabel = cycleValue
      ? cycleValue.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
      : null;

    const cyclePeriodLabel = billing?.cycleStartDate || billing?.cycleEndDate
      ? formatDateRangeDisplay(billing?.cycleStartDate, billing?.cycleEndDate)
      : null;

    if (!cycleLabel && !cyclePeriodLabel) {
      return null;
    }

    return {
      cycleLabel: cycleLabel || 'Not specified',
      cyclePeriodLabel
    };
  }, [isRecurringSchedule, selectedShiftRequest]);

  const recurringInfoBanner = useMemo(() => {
    if (!isRecurringSchedule) {
      return null;
    }

    const status = selectedShiftRequest?.recurringApprovalStatus || 'pending_nurse_approval';
    const nurseDisplayName = selectedShiftRequest?.nurseName || 'the assigned nurse';

    switch (status) {
      case 'nurse_declined':
        return {
          icon: 'alert-circle-outline',
          iconColor: COLORS.error,
          title: 'Nurse Declined',
          message: `${nurseDisplayName} declined this recurring schedule. Please follow up or assign another nurse.`
        };
      case 'nurse_approved':
        return {
          icon: 'check-circle-outline',
          iconColor: COLORS.success,
          title: 'Nurse Approved',
          message: `${nurseDisplayName} approved this recurring schedule. It will activate automatically once processing completes.`
        };
      default:
        return {
          icon: 'information-outline',
          iconColor: COLORS.success,
          title: 'Waiting on Nurse Approval',
          message: `${nurseDisplayName} will approve or decline this schedule directly from their portal.`
        };
    }
  }, [isRecurringSchedule, selectedShiftRequest?.recurringApprovalStatus, selectedShiftRequest?.nurseName]);
  
  // Only log when shift counts change to avoid spam - with reduced frequency
  useEffect(() => {
    const currentCount = shiftRequests?.length || 0;
    const currentPendingCount = pendingShiftRequests.length;
    const currentActiveCount = formattedActiveShifts.length;
    const currentCompletedCount = formattedCompletedShifts.length;
    
    // Use smart logging to reduce spam
    const summaryText = `Total: ${currentCount}, Pending: ${currentPendingCount}, Active: ${currentActiveCount}, Completed: ${currentCompletedCount}`;
    // SmartLogger.logOnChange('admin_shift_summary', summaryText, '🏥 ADMIN: Shift Summary -');
    
    // Always show pending requests (important for admin)
    if (currentPendingCount > 0) {
      // SmartLogger.throttleLog(
      //   `⚠️ ADMIN: ${currentPendingCount} pending requests need attention`, 
      //   'warn', 
      //   30000 // Show warning every 30 seconds max
      // );
    }
    
    setLastShiftCount(currentCount);
  }, [shiftRequests?.length, pendingShiftRequests.length, lastShiftCount, formattedActiveShifts.length, formattedCompletedShifts.length]);

  // Add smart polling for new shift requests and profile edit requests
  useEffect(() => {
    // Immediate refresh when admin dashboard loads
    const initialRefresh = async () => {
      await refreshShiftRequests();
      await refreshRequests();
    };
    initialRefresh();
    
    // Smart polling - faster if there are pending requests, slower if none
    // Check both shift requests and profile edit requests
    const hasPendingItems = pendingShiftRequests.length > 0 || pendingRecurringShiftRequests.length > 0 || pendingProfileEditRequests.length > 0;
    let intervalTime = hasPendingItems ? 30000 : 60000; // 30 sec if pending, 1 min if none
    
    const interval = setInterval(async () => {
      // Only refresh if admin dashboard is visible and app is active
      // In React Native, document.visibilityState might not be reliable or available in the same way as web
      // But since this is likely running in a web context or we want it to run anyway:
      try {
        await Promise.all([
          refreshShiftRequests(),
          refreshRequests()
        ]);
        setRefreshKey(prev => prev + 1);
      } catch (e) {
        // Polling error
      }
    }, intervalTime);
    
    return () => clearInterval(interval);
  }, [pendingShiftRequests.length, pendingRecurringShiftRequests.length, pendingProfileEditRequests.length]); // Adjust polling based on pending requests

  // Refresh data when screen comes into focus - throttled
  useFocusEffect(
    React.useCallback(() => {
      // Throttle focus refreshes to prevent excessive API calls
      const now = Date.now();
      if (!lastFocusRefreshRef.current || now - lastFocusRefreshRef.current > 30000) { // Max once per 30 seconds
        lastFocusRefreshRef.current = now;
        
        const refreshData = async () => {
          await refreshAppointments();
          await refreshShiftRequests();
          await refreshNotifications();
          await refreshRequests(); // Force refresh profile edit requests
          setRefreshKey(prev => prev + 1);
          
          // Process any due recurring invoices when admin accesses dashboard
          try {
            const processedCount = await InvoiceService.processDueRecurringInvoices();
            if (processedCount > 0) {
              // Processed recurring invoices
            }
          } catch (error) {
            // Error processing recurring invoices
          }
        };
        refreshData();
      }
    }, [user])
  );

  // Total appointments count (including shifts)
  const totalAppointmentsCount = pendingAssignments.length + nurseAssignedAppointments.length + finalConfirmedAppointments.length + finalCompletedAppointments.length;

  // Combine pending and assigned for display purposes, but track them separately for counts
  const allPendingForDisplay = [...pendingAssignments, ...nurseAssignedAppointments];

  // Clean logging - only show counts when issues occur
  useEffect(() => {
    // Only log critical issues, not routine operations
    if (completedAppointments.length > 0 && completedAppointments.some(apt => !apt.completionNotes && !apt.nurseNotes)) {
      // Some completed appointments missing notes
    }
  }, [completedAppointments.length]);

  const activeNurses = (() => {
    const raw = getAvailableNursesFromContext();
    const list = Array.isArray(raw) ? [...raw] : [];
    list.sort((a, b) => {
      const aName = String(
        a?.fullName || a?.name || a?.displayName || `${a?.firstName || ''} ${a?.lastName || ''}`.trim() || ''
      ).trim();
      const bName = String(
        b?.fullName || b?.name || b?.displayName || `${b?.firstName || ''} ${b?.lastName || ''}`.trim() || ''
      ).trim();

      return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    });
    return list;
  })();

  // Helper function to get nurse name from appointment or nurses list
  const getNurseName = (appointment) => {
    if (appointment.nurseName) {
      return appointment.nurseName;
    }
    
    if (appointment.nurseId) {
      // Try to find nurse in nurses list
      const foundNurse = nurses.find(n => n.id === appointment.nurseId);
      if (foundNurse) {
        return foundNurse.name;
      }
    }
    
    if (appointment.assignedNurse) {
      // Handle case where assignedNurse is an object
      if (typeof appointment.assignedNurse === 'object') {
        const formattedName = formatNurseName(appointment.assignedNurse);
        if (formattedName !== 'Unassigned' && formattedName !== 'Assigned Nurse') {
            return formattedName;
        }
        // Fallback to existing logic if formatNurseName returns default
        return appointment.assignedNurse.name || appointment.assignedNurse.fullName || formattedName;
      }
      // Handle case where assignedNurse is just an ID
      const foundNurse = nurses.find(n => n.id === appointment.assignedNurse);
      if (foundNurse) {
        return foundNurse.name;
      }
    }
    
    return null;
  };

  const handleAssignNurse = (appointment) => {
    // Opening assign modal for appointment
    // Available nurses from context
    setSelectedAppointment(appointment);
    setAssignContext('appointment');
    setAssignModalVisible(true);
  };

  const handleViewAppointmentDetails = async (appointment) => {
    // Check if this is a recurring appointment/shift or a regular appointment
    const isRecurring = appointment.isRecurring || appointment.recurringPattern || appointment.frequency;
    
    // Normalize and load full recurring shift data when available
    if (isRecurring) {
      // Try to resolve an ID from several possible fields
      const idCandidate = appointment?.id || appointment?._id || appointment?.shiftId || appointment?.requestId || appointment?.shift?.id || appointment?.shift?._id || null;
      if (idCandidate) {
        try {
          const result = await FirebaseService.getShiftRequestById(idCandidate);
          if (result && result.success && result.shiftRequest) {
            setSelectedAppointmentDetails(result.shiftRequest);
          } else {
            setSelectedAppointmentDetails(appointment);
          }
        } catch (fetchErr) {
          // If fetching fails, fall back to the passed object
          setSelectedAppointmentDetails(appointment);
        }
      } else {
        // No clear id: try to find matching shift in locally cached shiftRequests
        const match = (shiftRequests || []).find((r) => {
          try {
            if (!r) return false;
            if (r.id && (r.id === appointment.id || r.id === appointment._id)) return true;
            if (r._id && (r._id === appointment.id || r._id === appointment._id)) return true;
            // Fuzzy match: same client/patient name and start time
            if ((r.clientName || r.patientName) && (appointment.clientName || appointment.patientName)) {
              const rName = (r.clientName || r.patientName || '').trim().toLowerCase();
              const aName = (appointment.clientName || appointment.patientName || '').trim().toLowerCase();
              if (rName && aName && rName === aName) {
                if ((r.startTime || '') === (appointment.startTime || '')) return true;
                if ((r.recurringStartTime || '') === (appointment.startTime || '')) return true;
              }
            }
            return false;
          } catch (err) {
            return false;
          }
        });
        if (match) {
          setSelectedAppointmentDetails(match);
        } else {
          setSelectedAppointmentDetails(appointment);
        }
      }

      // Open the recurring shift modal after we set the selected data
      setAdminViewRecurringShiftModalVisible(true);
    } else {
      // Use regular appointment details modal for regular appointments
      // IMPORTANT: set selected details before opening modal so header/content render correctly.
      setSelectedAppointmentDetails(appointment);
      setAppointmentDetailsModalVisible(true);

      // Fetch the latest appointment from Firestore so nurse notes saved moments ago show up.
      const appointmentDocId =
        appointment?.id ||
        appointment?._id ||
        appointment?.appointmentId ||
        appointment?.documentId ||
        appointment?.requestId ||
        appointment?.shiftId ||
        appointment?.assignmentId ||
        appointment?.relatedAppointmentId ||
        null;
      if (appointmentDocId) {
        const attemptFreshFetch = async () => {
          try {
            const fresh = await ApiService.getAppointmentById(appointmentDocId);
            if (!fresh) return;

            // Debug logging for fresh-fetch result removed per request

            setSelectedAppointmentDetails((prev) => {
              if (!prev) return prev;
              const prevId =
                prev.id ||
                prev._id ||
                prev.appointmentId ||
                prev.documentId ||
                prev.requestId ||
                prev.shiftId ||
                prev.assignmentId ||
                prev.relatedAppointmentId ||
                null;
              if (prevId && prevId !== appointmentDocId) return prev;

              return {
                ...prev,
                nurseNotes: fresh.nurseNotes ?? prev.nurseNotes,
                completionNotes: fresh.completionNotes ?? prev.completionNotes,
                notes: fresh.notes ?? prev.notes,
                patientNotes: fresh.patientNotes ?? prev.patientNotes,
                bookingNotes: fresh.bookingNotes ?? prev.bookingNotes,
                clientNotes: fresh.clientNotes ?? prev.clientNotes,
                specialInstructions: fresh.specialInstructions ?? prev.specialInstructions,
                updatedAt: fresh.updatedAt ?? prev.updatedAt,
                actualStartTime: fresh.actualStartTime ?? prev.actualStartTime,
                actualEndTime: fresh.actualEndTime ?? prev.actualEndTime,
                startedAt: fresh.startedAt ?? prev.startedAt,
                clockInTime: fresh.clockInTime ?? prev.clockInTime,
                clockOutTime: fresh.clockOutTime ?? prev.clockOutTime,
              };
            });
          } catch (primaryError) {

            try {
              const shiftFallback = await ApiService.getShiftRequestById(appointmentDocId);
              if (!shiftFallback) return;

              // Debug logging for shift-fallback removed per request

              setSelectedAppointmentDetails((prev) => {
                if (!prev) return prev;
                const prevId =
                  prev.id ||
                  prev._id ||
                  prev.appointmentId ||
                  prev.documentId ||
                  prev.requestId ||
                  prev.shiftId ||
                  prev.assignmentId ||
                  prev.relatedAppointmentId ||
                  null;
                if (prevId && prevId !== appointmentDocId) return prev;

                const writableNurseNotes =
                  shiftFallback.nurseNotes ??
                  shiftFallback.completionNotes ??
                  shiftFallback.notes ??
                  prev.nurseNotes ??
                  prev.completionNotes ??
                  prev.notes;

                return {
                  ...prev,
                  nurseNotes: writableNurseNotes,
                  completionNotes: shiftFallback.completionNotes ?? prev.completionNotes ?? writableNurseNotes,
                  notes: shiftFallback.notes ?? prev.notes,
                  patientNotes: prev.patientNotes,
                  bookingNotes: prev.bookingNotes,
                  clientNotes: prev.clientNotes,
                  specialInstructions: shiftFallback.specialInstructions ?? prev.specialInstructions,
                  updatedAt: shiftFallback.updatedAt ?? prev.updatedAt,
                  actualStartTime:
                    shiftFallback.actualStartTime ||
                    shiftFallback.startTime ||
                    shiftFallback.recurringStartTime ||
                    prev.actualStartTime,
                  actualEndTime:
                    shiftFallback.actualEndTime ||
                    shiftFallback.endTime ||
                    shiftFallback.recurringEndTime ||
                    prev.actualEndTime,
                  startedAt: shiftFallback.startedAt || shiftFallback.actualStartTime || prev.startedAt,
                  clockInTime: shiftFallback.clockInTime || shiftFallback.actualStartTime || prev.clockInTime,
                  clockOutTime: shiftFallback.clockOutTime || shiftFallback.actualEndTime || prev.clockOutTime,
                };
              });
            } catch (fallbackError) {
              // Debug logging for shift-fallback-error removed per request
            }
          }
        };

        attemptFreshFetch();
      }

      // Check if we need to fetch patient details
      const patientId = appointment.patientId || appointment.clientId;
      // Check if email/phone are missing or N/A in the appointment object
      const hasMissingDetails = !appointment.email || !appointment.phone || 
                               appointment.email === 'N/A' || appointment.phone === 'N/A';
                               
      if (patientId && hasMissingDetails) {
        try {
          let userDetails = null;
          
          // Try fetching from Users collection first
          try {
            userDetails = await ApiService.getUserById(patientId);
          } catch (e) {
            // User not found in users collection, trying patients...
          }
          
          // If not found, try Patients collection
          if (!userDetails) {
             userDetails = await ApiService.getPatientById(patientId);
          }
          
          if (userDetails) {
            // Merge the fetched details
            const updatedAppointment = {
              ...appointment,
              patientEmail: userDetails.email || appointment.email,
              patientPhone: userDetails.phone || appointment.phone,
              email: userDetails.email || appointment.email,
              phone: userDetails.phone || appointment.phone,
              // Also try to get address if missing
              address: appointment.address || userDetails.address
            };
            
            setSelectedAppointmentDetails(updatedAppointment);
          }
        } catch (error) {
          // Error fetching patient details
        }
      }
    }
  };

  const confirmAssignment = async (nurse, options = {}) => {
    // Confirming assignment with nurse details
    const isRecurringContext = assignContext === 'recurring';

    const targetLabel = isRecurringContext
      ? (selectedShiftRequest?.clientName || selectedShiftRequest?.patientName || 'this recurring shift')
      : (selectedAppointment?.patientName || selectedAppointment?.client || 'this appointment');
    
    Alert.alert(
      'Confirm Assignment',
      `Assign ${targetLabel} to ${nurse.name || nurse.fullName || 'this nurse'}?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            if (typeof options?.onCancel === 'function') {
              options.onCancel();
            }
          },
        },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              if (options?.closeNurseDetailsOnConfirm) {
                setNurseDetailsModalVisible(false);
              }
              if (options?.clearSelectionModeOnConfirm) {
                setNurseSelectionMode(null);
              }

              if (isRecurringContext) {
                // Use recurring shift primary nurse assignment logic
                setAssignModalVisible(false);
                await handleAssignPrimaryNurse(nurse);
                return;
              }

              // Regular one-off appointment assignment
              await assignNurse(selectedAppointment.id, nurse.id);
              
              // Send notification to the assigned nurse
              try {
                await sendNotificationToUser(
                  nurse.id,
                  'nurse',
                  'New Appointment Assignment',
                  `You have been assigned to ${selectedAppointment.patientName || 'a patient'} for ${selectedAppointment.service || 'an appointment'} on ${selectedAppointment.date || selectedAppointment.preferredDate || 'TBD'}`,
                  {
                    type: 'appointment_assigned',
                    appointmentId: selectedAppointment.id,
                    patientName: selectedAppointment.patientName,
                    service: selectedAppointment.service,
                    date: selectedAppointment.date || selectedAppointment.preferredDate
                  }
                );
                // Notification sent to nurse
              } catch (notifError) {
                // Failed to send notification to nurse
              }
              
              Alert.alert('Success', `Appointment has been assigned to ${nurse.name}!`);
              setAssignModalVisible(false);
              setSelectedAppointment(null);
            } catch (error) {
              Alert.alert('Error', 'Failed to assign nurse. Please try again.');
            }
          },
        },
      ]
    );
  };

  const generateNurseCode = useCallback(() => {
    // Generating code - Current sequences
    
    // Generate sequential code based on role (without incrementing the counter)
    if (staffRole === 'admin') {
      const code = `ADMIN${adminSequence.toString().padStart(3, '0')}`;
      // Setting nurseCode
      setNurseCode(code);
    } else {
      const code = `NURSE${nurseSequence.toString().padStart(3, '0')}`;
      // Setting nurseCode
      setNurseCode(code);
    }
  }, [adminSequence, nurseSequence, staffRole]);

  const handleCreateNurse = async () => {
    if (!nurseName || !nurseEmail || !nursePhone) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (!nurseCode) {
      Alert.alert('Error', `Please generate a ${staffRole} code`);
      return;
    }

    // Create staff account in the system with all details
    const staffData = {
      name: nurseName,
      fullName: nurseName,
      email: nurseEmail,
      phone: nursePhone,
      role: staffRole,
      emergencyContact: emergencyContact || null,
      emergencyPhone: emergencyPhone || null,
      nurseIdPhoto: nurseIdPhoto || null, // Add nurse ID photo
      bankingDetails: {
        bankName: nurseBankName || 'Not provided',
        accountNumber: nurseAccountNumber || 'Not provided',
        accountHolderName: nurseAccountHolderName || nurseName,
        bankBranch: nurseBankBranch || 'Main Branch',
        currency: 'JMD'
      }
    };

    // Add specialization for nurses
    if (staffRole === 'nurse') {
      staffData.specialization = nurseSpecialization || 'General Nursing';
      staffData.nurseCode = nurseCode;
    } else {
      staffData.code = nurseCode;
      staffData.adminCode = nurseCode;
    }

    const result = await addNurse(staffData);

    if (result.success) {
      // Increment the sequence counter for next staff member and persist
      try {
        if (staffRole === 'admin') {
          const nextAdmin = adminSequence + 1;
          setAdminSequence(nextAdmin);
          await AsyncStorage.setItem('adminSequenceCounter', nextAdmin.toString());
        } else {
          const nextNurse = nurseSequence + 1;
          setNurseSequence(nextNurse);
          await AsyncStorage.setItem('nurseSequenceCounter', nextNurse.toString());
        }
      } catch (e) {
        // Failed to persist sequence updates
      }
      
      const roleTitle = staffRole === 'admin' ? 'Admin' : 'Nurse';
      Alert.alert(
        `${roleTitle} Account Created`,
        `${nurseName} has been created with:\n\nCode: ${result.code || nurseCode}\nTemporary Password: temp123\n\nShare these credentials with the ${staffRole} for first login. They should change the password after logging in.`,
        [
          {
            text: 'OK',
            onPress: () => {
              setCreateNurseModalVisible(false);
              setNurseName('');
              setNurseEmail('');
              setNursePhone('');
              setNurseSpecialization('');
              setNurseCode('');
              setEmergencyContact('');
              setEmergencyPhone('');
              setNurseBankName('');
              setNurseAccountNumber('');
              setNurseAccountHolderName('');
              setNurseBankBranch('');
              setNurseIdPhoto(null); // Clear selected photo
              setStaffRole('nurse');
              // Auto-generate code for the default role
              generateNurseCode();
            },
          },
        ]
      );
    } else {
      Alert.alert('Error', result.error);
    }
  };

  const handleDeleteStaff = async (staffMember) => {
    const staffType = staffMember.code?.startsWith('ADMIN') ? 'Admin' : 'Nurse';
    
    Alert.alert(
      `Delete ${staffType}`,
      `Are you sure you want to delete ${staffMember.name}?\n\nThis action cannot be undone and will:\n• Remove their account access\n• Clear all their data\n• Remove them from all assignments`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete from NurseContext (works for both nurses and admins)
              deleteNurse(staffMember.id);
              
              // Delete their AsyncStorage user account data
              const userKey = staffMember.code;
              if (userKey) {
                await AsyncStorage.removeItem(userKey);
              }
              
              // Close the details modal
              setNurseDetailsModalVisible(false);
              setSelectedNurseDetails(null);
              
              Alert.alert(
                'Success', 
                `${staffMember.name} has been deleted successfully.`,
                [{ text: 'OK' }]
              );
              
              // Refresh the data to update the UI
              onRefresh();
            } catch (error) {
              Alert.alert(
                'Error', 
                'Failed to delete staff member. Please try again.',
                [{ text: 'OK' }]
              );
            }
          },
        },
      ]
    );
  };

  // Recurring schedule handler
  // DEPRECATED: Old recurring date/time handlers - no longer used (replaced with AdminRecurringShiftModal)
  /*
  const onRecurringStartDateChange = (event, date) => {
    if (date) {
      setSelectedRecurringStartDate(date);
    }
  };

  const onRecurringEndDateChange = (event, date) => {
    if (date) {
      setSelectedRecurringEndDate(date);
    }
  };

  const onRecurringStartTimeChange = (event, time) => {
    if (time) {
      setSelectedRecurringStartTime(time);
    }
  };

  const onRecurringEndTimeChange = (event, time) => {
    if (time) {
      setSelectedRecurringEndTime(time);
    }
  };

  const confirmRecurringStartDateSelection = () => {
    setRecurringStartDate(selectedRecurringStartDate);
    setShowStartDatePicker(false);
  };

  const confirmRecurringEndDateSelection = () => {
    setRecurringEndDate(selectedRecurringEndDate);
    setShowEndDatePicker(false);
  };

  const confirmRecurringStartTimeSelection = () => {
    const hours = selectedRecurringStartTime.getHours();
    const minutes = selectedRecurringStartTime.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const formattedTime = `${displayHours}:${paddedMinutes} ${ampm}`;
    
    setRecurringTime(formattedTime);
    setShowStartTimePicker(false);
  };

  const confirmRecurringEndTimeSelection = () => {
    const hours = selectedRecurringEndTime.getHours();
    const minutes = selectedRecurringEndTime.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const formattedTime = `${displayHours}:${paddedMinutes} ${ampm}`;
    
    setRecurringEndTime(formattedTime);
    setShowEndTimePicker(false);
  };
  */

  // DEPRECATED: Old recurring functions - no longer used (replaced with AdminRecurringShiftModal component)
  /*
  const handleRecurringClientSelect = (client) => {
    setRecurringClient(client);
    setRecurringClientSearchText(client.name);
    setShowRecurringClientDropdown(false);
  };

  const filteredRecurringClients = useMemo(() => {
    if (recurringClientSearchText.trim() === '') {
      return [];
    }
    
    const filtered = appointments.filter(appt => {
      const client = {
        clientId: appt.clientId || appt.patientId || appt.id,
        clientName: appt.clientName || appt.patientName,
        clientEmail: appt.clientEmail || '',
        clientPhone: appt.clientPhone || ''
      };
      
      const matches = (
        (client.clientName && client.clientName.toLowerCase().includes(recurringClientSearchText.toLowerCase())) ||
        (client.clientEmail && client.clientEmail.toLowerCase().includes(recurringClientSearchText.toLowerCase())) ||
        (client.clientPhone && client.clientPhone.includes(recurringClientSearchText))
      );
      
      return matches;
    });
    
    // Deduplicate by clientId
    const seen = new Set();
    return filtered.filter(appt => {
      const clientId = appt.clientId || appt.patientId || appt.id;
      if (seen.has(clientId)) return false;
      seen.add(clientId);
      return true;
    });
  }, [recurringClientSearchText, appointments]);
  */

  // DEPRECATED: handleCreateRecurringSchedule - no longer used
  /*
  const handleCreateRecurringSchedule = async () => {
    // Validate required fields
    if (!recurringNurse || !recurringClient || !recurringService || !recurringFrequency) {
      Alert.alert('Error', 'Please fill in all required fields (Nurse, Client, Service, Frequency)');
      return;
    }

    // Validate nurse has ID
    if (!recurringNurse.id) {
      Alert.alert('Error', 'Selected nurse is missing an ID. Please select a different nurse.');
      return;
    }

    // Validate client has ID
    if (!recurringClient.id) {
      Alert.alert('Error', 'Selected client is missing an ID. Please select a different client.');
      return;
    }

    // Validate days for weekly/fortnightly schedules
    if ((recurringFrequency === 'weekly' || recurringFrequency === 'fortnightly') && (!recurringDays || recurringDays.length === 0)) {
      Alert.alert('Error', 'Please select at least one day for the recurring schedule');
      return;
    }

    // Validate dates
    if (!recurringStartDate || !recurringEndDate) {
      Alert.alert('Error', 'Please select start and end dates');
      return;
    }

    if (new Date(recurringEndDate) <= new Date(recurringStartDate)) {
      Alert.alert('Error', 'End date must be after start date');
      return;
    }

    // Validate times
    if (!recurringTime || !recurringEndTime) {
      Alert.alert('Error', 'Please select start and end times');
      return;
    }

    try {
      const scheduleData = {
        nurseId: recurringNurse.id,
        nurseName: recurringNurse.name,
        clientId: recurringClient.id,
        clientName: recurringClient.name,
        service: recurringService,
        frequency: recurringFrequency,
        daysOfWeek: recurringDays || [],
        startDate: recurringStartDate.toISOString(),
        endDate: recurringEndDate.toISOString(),
        time: recurringTime,
        endTime: recurringEndTime,
        billingCycle: recurringBillingCycle,
        notes: recurringNotes,
      };

      const result = await ApiService.createRecurringSchedule(scheduleData);

      if (result.success) {
        Alert.alert(
          'Success',
          `Recurring schedule created successfully!\n\n${result.totalOccurrences} shifts have been generated for ${recurringNurse.name}.`,
          [{ text: 'OK' }]
        );

        // Reset form
        setRecurringNurse(null);
        setRecurringClient(null);
        setRecurringService('');
        setRecurringFrequency('weekly');
        setRecurringDays([]);
        setRecurringStartDate(new Date());
        setRecurringEndDate(new Date());
        setRecurringTime('');
        setRecurringEndTime('');
        setRecurringBillingCycle('weekly');
        setRecurringNotes('');

        // Close modal (old endpoint - no longer used)
        // setRecurringScheduleModalVisible(false);

        // Refresh shift requests
        onRefresh();
      } else {
        Alert.alert('Error', result.error || 'Failed to create recurring schedule');
      }
    } catch (error) {
      // console.error('Error creating recurring schedule:', error);
      Alert.alert('Error', 'Failed to create recurring schedule. Please try again.');
    }
  };
  */

  // Shift request handlers
  const handleShiftRequestDetails = async (shiftRequest) => {
    // Try to get the authoritative shift record from backend when possible
    const idCandidate = shiftRequest?.id || shiftRequest?._id || shiftRequest?.shiftId || shiftRequest?.requestId || shiftRequest?.shift?.id || shiftRequest?.shift?._id || null;
    if (idCandidate) {
      try {
        const result = await FirebaseService.getShiftRequestById(idCandidate);
        if (result && result.success && result.shiftRequest) {
          const freshData = result.shiftRequest;
          // Ensure recurring status is preserved if the fresh data is missing flags
          if (isRecurringRequest(shiftRequest) && !isRecurringRequest(freshData)) {
            freshData.isRecurring = true;
            if (shiftRequest.recurringPattern) freshData.recurringPattern = shiftRequest.recurringPattern;
            if (shiftRequest.adminRecurring) freshData.adminRecurring = true;
          }

          // Preserve snapshots if missing in freshData (crucial for email/phone display)
          if (!freshData.clientSnapshot && shiftRequest.clientSnapshot) {
            freshData.clientSnapshot = shiftRequest.clientSnapshot;
          }
          if (!freshData.patientSnapshot && shiftRequest.patientSnapshot) {
            freshData.patientSnapshot = shiftRequest.patientSnapshot;
          }

          setSelectedShiftRequest(freshData);
          setShiftRequestModalVisible(true);
          return;
        }
      } catch (err) {
        // Fall back to passed object
      }
    }

    // If we couldn't fetch fresh data, fall back to finding a match in local cache
    const localMatch = (shiftRequests || []).find((r) => (r?.id || r?._id) === (shiftRequest?.id || shiftRequest?._id));
    if (localMatch) {
      setSelectedShiftRequest(localMatch);
      setShiftRequestModalVisible(true);
      return;
    }

    // Last resort: use provided object
    setSelectedShiftRequest(shiftRequest);
    setShiftRequestModalVisible(true);
  };

  const openClockDetailsModal = (label, payload, options = {}) => {
    // Set data captured from the moment the button was pressed
    setClockDetailsPayload({ label, ...payload });
    setClockDetailsExpandedDayKey(null);
    setReopenAppointmentDetailsAfterClock(Boolean(options?.reopenAppointmentDetails));
    setReopenRecurringDetailsAfterClock(Boolean(options?.reopenRecurringDetails));
    
    // Close appointment details modal first
    setAppointmentDetailsModalVisible(false);

    // Open clock details modal after a short delay to allow the first modal to close cleanly
    setTimeout(() => {
      setClockDetailsModalVisible(true);
    }, 500);
  };

  const closeClockDetailsModal = () => {
    setClockDetailsModalVisible(false);
    setClockDetailsPayload(null);
    setClockDetailsExpandedDayKey(null);
    if (reopenAppointmentDetailsAfterClock) {
      setReopenAppointmentDetailsAfterClock(false);
      setTimeout(() => {
        setAppointmentDetailsModalVisible(true);
      }, 150);
    }

    if (reopenRecurringDetailsAfterClock) {
      setReopenRecurringDetailsAfterClock(false);
      setTimeout(() => {
        setAdminViewRecurringShiftModalVisible(true);
      }, 150);
    }
  };

  const clockDaySections = useMemo(() => {
    if (!clockDetailsPayload || typeof clockDetailsPayload !== 'object') return [];

    const rawEntries = Array.isArray(clockDetailsPayload.clockEntries)
      ? clockDetailsPayload.clockEntries
      : [clockDetailsPayload];

    const normalized = rawEntries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const clockInTime = entry.clockInTime || null;
        const clockOutTime = entry.clockOutTime || null;
        const clockInLocation = entry.clockInLocation || null;
        const clockOutLocation = entry.clockOutLocation || null;

        if (!clockInTime && !clockOutTime && !clockInLocation && !clockOutLocation) return null;

        const daySource = clockInTime || clockOutTime || null;
        const dayLabel = formatFriendlyDate(daySource) || 'Date not captured';
        const dayMs = (() => {
          const d = coerceToDateValue(daySource);
          return d ? d.getTime() : null;
        })();

        return {
          key: `${dayLabel}-${dayMs || 'unknown'}-${Math.random().toString(36).slice(2, 7)}`,
          dayLabel,
          dayMs,
          clockInTime,
          clockOutTime,
          clockInLocation,
          clockOutLocation,
        };
      })
      .filter(Boolean);

    normalized.sort((a, b) => {
      const ams = typeof a.dayMs === 'number' ? a.dayMs : -1;
      const bms = typeof b.dayMs === 'number' ? b.dayMs : -1;
      return bms - ams;
    });

    return normalized;
  }, [clockDetailsPayload]);

  useEffect(() => {
    if (!clockDetailsModalVisible) return;
    if (!clockDaySections || clockDaySections.length === 0) return;
    setClockDetailsExpandedDayKey((prev) => {
      if (prev && clockDaySections.some((s) => s.key === prev)) return prev;
      return clockDaySections[0].key;
    });
  }, [clockDetailsModalVisible, clockDaySections]);

  const handleAppointmentClockOut = async () => {
    try {
      setAppointmentLoading(true);

      const appointmentId = selectedAppointmentDetails?.id || selectedAppointmentDetails?._id;
      if (!appointmentId) {
        Alert.alert('Error', 'Unable to clock out: missing appointment id.');
        return;
      }
      
      // Get location permission and current location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Location permission is required to clock out.');
        setAppointmentLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      const { latitude, longitude } = location.coords;
      let formattedAddress = null;
      try {
        const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geocode && geocode.length > 0) {
          const geocodeResult = geocode[0];
          const parts = [];
          if (geocodeResult.streetNumber) parts.push(geocodeResult.streetNumber);
          if (geocodeResult.street) parts.push(geocodeResult.street);
          if (geocodeResult.city) parts.push(geocodeResult.city);
          if (geocodeResult.region) parts.push(geocodeResult.region);
          formattedAddress = parts.join(', ');
        }
      } catch (geoError) {
        console.warn('Reverse geocode failed for clock-out:', geoError?.message || geoError);
      }
      const locationData = {
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
        address: formattedAddress,
        formattedAddress,
      };
      
      setAppointmentClockOutLocation(locationData);
      setAppointmentShowNotes(true);
    } catch (error) {
      console.error('Clock out error:', error);
      Alert.alert('Error', error.message || 'Failed to clock out');
    } finally {
      setAppointmentLoading(false);
    }
  };

  const handleAppointmentUpdateNotes = async () => {
    try {
      setAppointmentLoading(true);

      const appointmentId = selectedAppointmentDetails?.id || selectedAppointmentDetails?._id;
      if (!appointmentId) {
        Alert.alert('Error', 'Unable to update: missing appointment id.');
        return;
      }

      // If we have clock out location, complete the appointment
      if (appointmentClockOutLocation) {
        const clockOutTime = new Date().toISOString();
        const startTimeISO = selectedAppointmentDetails.actualStartTime || 
                             selectedAppointmentDetails.startedAt || 
                             selectedAppointmentDetails.clockInTime || 
                             selectedAppointmentDetails.startTime;
        const startTimeObj = startTimeISO ? new Date(startTimeISO) : null;
        const endTimeObj = new Date(clockOutTime);
        const hoursWorked = startTimeObj && !isNaN(startTimeObj.getTime())
          ? ((endTimeObj - startTimeObj) / (1000 * 60 * 60)).toFixed(2)
          : '0';

        // Update appointment to completed status with clock out data
        const updateData = {
          status: 'completed',
          completedAt: clockOutTime,
          actualEndTime: clockOutTime,
          clockOutTime: clockOutTime,
          clockOutLocation: appointmentClockOutLocation,
          hoursWorked: hoursWorked,
          completionNotes: appointmentShiftNotes || '',
          nurseNotes: appointmentShiftNotes || ''
        };

        await ApiService.updateAppointment(appointmentId, updateData);

        // Auto-generate invoice for completed non-recurring appointments (no tap-to-generate).
        try {
          const base = selectedAppointmentDetails || {};
          const isShiftLike = Boolean(
            base?.isShiftRequest ||
              base?.isShift ||
              base?.clockByNurse ||
              base?.nurseSchedule ||
              String(base?.assignmentType || '').toLowerCase() === 'split-schedule'
          );
          const isRecurring = Boolean(base?.isRecurring || base?.recurringScheduleId || base?.recurringSchedule || base?.recurring);

          if (!isShiftLike && !isRecurring) {
            const existingInvoices = await InvoiceService.getAllInvoices();
            const alreadyHasInvoice = (existingInvoices || []).some((inv) => {
              const invAppointmentId = String(inv?.appointmentId || inv?.relatedAppointmentId || inv?.appointmentID || '');
              return invAppointmentId && invAppointmentId === String(appointmentId);
            });

            if (!alreadyHasInvoice) {
              const serviceType = base?.service || base?.serviceType || base?.appointmentType || base?.serviceName || null;
              if (serviceType) {
                await InvoiceService.updateCompanyInfo();
                await InvoiceService.createInvoice({
                  id: appointmentId,
                  relatedAppointmentId: appointmentId,
                  shiftRequestId: base?.shiftRequestId || base?.shiftId || null,
                  patientName: base?.patientName || base?.clientName || 'Client',
                  patientEmail: base?.patientEmail || base?.email || base?.clientEmail || '',
                  patientPhone: base?.patientPhone || base?.phone || base?.clientPhone || 'N/A',
                  address: base?.address || base?.clientAddress || 'Address on file',
                  nurseName: base?.nurseName || 'Assigned Nurse',
                  service: serviceType,
                  serviceType,
                  serviceName: serviceType,
                  appointmentDate: base?.date || base?.appointmentDate || base?.scheduledDate || clockOutTime,
                  hoursWorked: Number(hoursWorked) || 1,
                  notes: appointmentShiftNotes || base?.notes || 'Professional nursing services provided',
                });
              }
            }
          }
        } catch (invoiceError) {
          console.warn('⚠️ Admin auto-invoice failed:', invoiceError?.message || invoiceError);
        }

        const locationLabel =
          formatLocationLabel(appointmentClockOutLocation) ||
          `${appointmentClockOutLocation.latitude.toFixed(6)}, ${appointmentClockOutLocation.longitude.toFixed(6)}`;

        Alert.alert(
          'Clock Out Successful',
          `Clocked out at ${endTimeObj.toLocaleTimeString()}\nLocation: ${locationLabel}\n\nAppointment completed successfully.`
        );

        // Refresh data and close modals
        onRefresh();
        setAppointmentShowNotes(false);
        setAppointmentDetailsModalVisible(false);
        setAppointmentClockOutLocation(null);
        setAppointmentShiftNotes('');
      } else {
        // Just update notes without completing
        await ApiService.updateAppointment(appointmentId, {
          nurseNotes: appointmentShiftNotes || ''
        });
        
        Alert.alert('Success', 'Notes updated successfully');
        setAppointmentShowNotes(false);
      }
    } catch (error) {
      console.error('Update notes error:', error);
      Alert.alert('Error', error.message || 'Failed to update notes');
    } finally {
      setAppointmentLoading(false);
    }
  };

  const handleApproveEditRequest = async (request) => {

    Alert.alert(
      'Approve Edit Request',
      `Allow ${request.nurseName} to edit their profile?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              // Approve the edit request

              await approveEditRequest(request.id, request.nurseId);
              
              // Send notification to nurse
              await sendNotificationToUser(
                request.nurseId,
                'nurse',
                'Profile Edit Approved',
                'Your profile edit request has been approved. You can now edit your profile for the next 30 minutes.',
                {
                  type: 'profile_edit_approved',
                  requestId: request.id
                }
              );
              
              Alert.alert('Success', 'Edit request approved. The nurse can now edit their profile.');
            } catch (error) {
              Alert.alert('Error', 'Failed to approve edit request. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleDenyEditRequest = async (request) => {
    Alert.alert(
      'Deny Edit Request',
      `Deny edit request from ${request.nurseName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deny',
          style: 'destructive',
          onPress: async () => {
            try {
              // Deny the edit request
              await denyEditRequest(request.id);
              
              // Send notification to nurse
              await sendNotificationToUser(
                request.nurseId,
                'nurse',
                'Profile Edit Request Denied',
                'Your profile edit request was not approved at this time. Please contact the administrator for more information.',
                {
                  type: 'profile_edit_denied',
                  requestId: request.id
                }
              );
              
              Alert.alert('Request Denied', 'The edit request has been denied.');
            } catch (error) {
              Alert.alert('Error', 'Failed to deny edit request. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleApproveShift = (shiftRequest) => {
    const formattedDate = (() => {
      const dateValue = shiftRequest.date || shiftRequest.startDate;
      if (!dateValue) return '';
      
      // Handle Firestore Timestamp
      if (typeof dateValue?.toDate === 'function') {
        return dateValue.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      
      // Handle object with seconds
      if (typeof dateValue === 'object' && typeof dateValue.seconds === 'number') {
        return new Date(dateValue.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      
      // Handle Date object or string
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      
      return dateValue;
    })();
    
    Alert.alert(
      'Approve Shift Request',
      `Approve shift for ${shiftRequest.nurseName}${formattedDate ? ` on ${formattedDate}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            // Approving shift for nurse
            const adminId = user?.id === 'admin-001' ? 'ADMIN001' : (user?.id || 'ADMIN001'); // Convert admin-001 to ADMIN001
            approveShiftRequest(shiftRequest.id, adminId);
            setShiftRequestModalVisible(false);
            
            // Send notification to nurse about approval
            try {
              const clientInfo = shiftRequest.clientName ? ` for ${shiftRequest.clientName}` : '';
              const targetNurseId = shiftRequest.nurseId === 'nurse-001' ? 'NURSE001' : shiftRequest.nurseId; // Convert nurse-001 to NURSE001
              // Sending approval notification to nurse
              await sendNotificationToUser(
                targetNurseId,
                'nurse',
                'Shift Request Approved',
                `Your ${shiftRequest.service} shift on ${shiftRequest.date}${clientInfo} has been approved!`,
                {
                  shiftRequestId: shiftRequest.id,
                  type: 'shift_approved'
                }
              );
              // Approval notification sent successfully
              
              // Send notification to patient if there's a specific client
              if (shiftRequest.clientId && shiftRequest.clientName) {
                // Sending appointment notification to patient
                await sendNotificationToUser(
                  shiftRequest.clientId,
                  'patient',
                  'Appointment Confirmed',
                  `Your ${shiftRequest.service} appointment with ${shiftRequest.nurseName} on ${shiftRequest.date} has been confirmed!`,
                  {
                    shiftRequestId: shiftRequest.id,
                    appointmentId: shiftRequest.id,
                    nurseId: shiftRequest.nurseId,
                    nurseName: shiftRequest.nurseName,
                    type: 'appointment_approved'
                  }
                );
                // Patient notification sent successfully
              }
            } catch (error) {
              // Failed to send approval notification
            }
            
            Alert.alert('Success', 'Shift request approved successfully!');
          }
        }
      ]
    );
  };

  const handleDenyShift = (shiftRequest) => {
    Alert.alert(
      'Deny Shift Request',
      `Deny shift for ${shiftRequest.nurseName} on ${shiftRequest.date}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deny',
          style: 'destructive',
          onPress: async () => {
            const adminId = user?.id === 'admin-001' ? 'ADMIN001' : (user?.id || 'ADMIN001'); // Convert admin-001 to ADMIN001
            denyShiftRequest(shiftRequest.id, adminId);
            setShiftRequestModalVisible(false);
            
            // Send notification to nurse about denial
            try {
              const clientInfo = shiftRequest.clientName ? ` for ${shiftRequest.clientName}` : '';
              const targetNurseId = shiftRequest.nurseId === 'nurse-001' ? 'NURSE001' : shiftRequest.nurseId; // Convert nurse-001 to NURSE001
              await sendNotificationToUser(
                targetNurseId,
                'nurse',
                'Shift Request Denied',
                `Your ${shiftRequest.service} shift request on ${shiftRequest.date}${clientInfo} has been denied.`,
                {
                  shiftRequestId: shiftRequest.id,
                  type: 'shift_denied'
                }
              );
            } catch (error) {
              // Failed to send denial notification
            }
            
            Alert.alert('Denied', 'Shift request has been denied.');
          }
        }
      ]
    );
  };

  // Backup nurse management handlers
  const openBackupNurseModal = (overrideRecord = null) => {
    // Ensure details modals are closed first
    if (shiftRequestModalVisible) {
      setShiftRequestModalVisible(false);
    }
    if (appointmentDetailsModalVisible) {
      setAppointmentDetailsModalVisible(false);
    }

    setReopenAppointmentDetailsAfterNurseModal(Boolean(overrideRecord));

    const source = overrideRecord || selectedShiftRequest;

    // Capture a stable target id for backend updates (important when launching from
    // Appointment Details, where selectedShiftRequest may not update synchronously).
    const targetId =
      source?.shiftRequestId ||
      source?.requestId ||
      source?.shiftId ||
      source?.id ||
      source?._id ||
      null;
    setBackupNurseTargetId(targetId);

    if (overrideRecord) {
      setSelectedShiftRequest(overrideRecord);
    }

    setCurrentBackupNurses(source?.backupNurses || source?.emergencyBackupNurses || []);
    setPrimaryNurseSearch('');
    setNurseSelectionMode('backup');
    // Small delay to ensure previous modal is fully closed
    setTimeout(() => {
      setPrimaryNurseModalVisible(true);
    }, 150);
  };

  const handleClosePrimaryNurseModal = () => {
    setPrimaryNurseModalVisible(false);

    if (reopenAppointmentDetailsAfterNurseModal) {
      setReopenAppointmentDetailsAfterNurseModal(false);
      setTimeout(() => {
        setAppointmentDetailsModalVisible(true);
      }, 150);
      return;
    }

    if (nurseSelectionMode === 'backup' || nurseSelectionMode === 'primary') {
      setTimeout(() => {
        setShiftRequestModalVisible(true);
      }, 150);
    }
  };

  const handleAddBackupNurse = (nurse) => {
    const nurseId = nurse._id || nurse.id;
    const exists = currentBackupNurses.some(b => b.nurseId === nurseId);
    if (exists) {
      Alert.alert('Already Added', 'This nurse is already in the backup list');
      return;
    }

    const newBackup = {
      nurseId,
      priority: currentBackupNurses.length + 1,
      fullName: nurse.fullName || nurse.name || `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim(),
      nurseName: nurse.fullName || nurse.name || `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim(),
      staffCode: nurse.nurseCode || nurse.code || nurse.username,
      nurseCode: nurse.nurseCode || nurse.code || nurse.username,
      email: nurse.email || nurse.contactEmail,
      phone: nurse.phone || nurse.contactNumber,
      profilePhoto: nurse.profilePhoto || nurse.profileImage || nurse.photoUrl
    };

    setCurrentBackupNurses([...currentBackupNurses, newBackup]);
    setBackupNurseSearch('');
  };

  const handleRemoveBackupNurse = (nurseId) => {
    const updated = currentBackupNurses
      .filter(b => b.nurseId !== nurseId)
      .map((b, index) => ({ ...b, priority: index + 1 }));
    setCurrentBackupNurses(updated);
  };

  const saveBackupNurses = async () => {
    try {
      const targetId = backupNurseTargetId || selectedShiftRequest?.id;
      if (!targetId) {
        throw new Error('Missing target shift/appointment id for saving backup nurses');
      }

      await ApiService.updateShiftRequest(targetId, {
        backupNurses: currentBackupNurses,
      });

      // Send notifications to newly added backup nurses
      const existingIds = new Set((selectedShiftRequest?.backupNurses || []).map(b => b.nurseId));
      const newBackups = currentBackupNurses.filter(b => !existingIds.has(b.nurseId));

      for (const backup of newBackups) {
        try {
          await sendNotificationToUser(
            backup.nurseId,
            'nurse',
            'Emergency Backup Assignment',
            `You are priority ${backup.priority} backup for ${selectedShiftRequest.clientName || 'recurring care schedule'}`,
            {
              type: 'backup_nurse_assignment',
              shiftRequestId: targetId,
              priority: backup.priority
            }
          );
        } catch (err) {
          console.error('Failed to notify backup nurse:', err);
        }
      }

      setBackupNurseModalVisible(false);
      refreshShiftRequests();
      
      // Refresh the current shift request details
      const updated = await FirebaseService.getShiftRequestById(targetId);
      if (updated?.success && updated.shiftRequest) {
        setSelectedShiftRequest(updated.shiftRequest);
      }

      Alert.alert('Success', 'Backup nurses updated successfully');
    } catch (error) {
      console.error('Error saving backup nurses:', error);
      Alert.alert('Error', 'Failed to update backup nurses');
    }
  };

  // Primary nurse assignment for recurring requests
  const openPrimaryNurseModal = () => {
    console.log('openPrimaryNurseModal called');
    // Ensure shift modal is closed first
    if (shiftRequestModalVisible) {
      setShiftRequestModalVisible(false);
    }
    setPrimaryNurseSearch('');
    setNurseSelectionMode('primary');
    // Small delay to ensure previous modal is fully closed
    setTimeout(() => {
      setPrimaryNurseModalVisible(true);
    }, 150);
  };

  const handleSelectBackupNurse = async (nurse) => {
    try {
        const nurseId = nurse._id || nurse.id;
        const exists = currentBackupNurses.some(b => b.nurseId === nurseId);
        
        let updated;

        if (exists) {
            // If already exists, remove it (toggle)
            updated = currentBackupNurses.filter(b => b.nurseId !== nurseId)
                .map((b, index) => ({ ...b, priority: index + 1 }));
        } else {
             const newBackup = {
                nurseId,
                priority: currentBackupNurses.length + 1,
                fullName: nurse.fullName || nurse.name || `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim(),
                nurseName: nurse.fullName || nurse.name || `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim(),
                staffCode: nurse.nurseCode || nurse.code || nurse.username,
                nurseCode: nurse.nurseCode || nurse.code || nurse.username,
                email: nurse.email || nurse.contactEmail,
                phone: nurse.phone || nurse.contactNumber,
                profilePhoto: nurse.profilePhoto || nurse.profileImage || nurse.photoUrl
            };
            updated = [...currentBackupNurses, newBackup];
        }

        console.log('Updating backup nurses:', updated);

        // Update local modal state immediately
        setCurrentBackupNurses(updated);
        
        // Update selectedShiftRequest with the new backup nurses - create new object to trigger re-render
        setSelectedShiftRequest(prev => {
          const updatedRequest = { ...(prev || {}), backupNurses: updated };
          console.log('Updated shift request:', updatedRequest);

          // If this backup-nurse flow was launched from Appointment Details,
          // keep the appointment details modal in sync so the newly selected
          // backup nurses show immediately when it reopens.
          if (reopenAppointmentDetailsAfterNurseModal) {
            setSelectedAppointmentDetails(updatedRequest);
          }

          return updatedRequest;
        });

        // Persist to backend/global state using the stable target id.
        const targetId = backupNurseTargetId || selectedShiftRequest?.id;
        if (!targetId) {
          throw new Error('Missing target shift/appointment id for backup nurse update');
        }

        await updateShiftRequestDetails(targetId, {
          backupNurses: updated,
        });
        
        console.log('Backup nurse update complete');
        
    } catch (error) {
        console.error('Failed to update backup nurse:', error);
        Alert.alert('Error', 'Failed to update backup nurse list');
    }
  };

  const handleAssignPrimaryNurse = async (nurse) => {
    try {
      const nurseId = nurse._id || nurse.id;
      const nurseName = nurse.fullName || nurse.name || `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim();
      const nurseCode = nurse.nurseCode || nurse.code || nurse.username;
      const nowIso = new Date().toISOString();

      console.log('🔵 ASSIGNING NURSE TO RECURRING SHIFT:', {
        nurseId,
        nurseName,
        nurseCode,
        nurseUid: nurse.uid,
        nurseEmail: nurse.email || nurse.contactEmail,
        shiftRequestId: selectedShiftRequest?.id,
        shiftStatus: selectedShiftRequest?.status,
        patientName: selectedShiftRequest?.patientName || selectedShiftRequest?.clientName,
      });

      // Check if this is a pending recurring shift request that needs approval
      // Force it to stay pending until explicitly approved
      const isPendingRequest = selectedShiftRequest?.status === 'pending';

      // PRESERVE ORIGINAL REQUESTED NURSE DATA
      // If this is a patient-created shift (has requestedBy) and we're assigning a different nurse,
      // save the original requested nurse info in preferredNurse* fields
      const isPatientCreated = !!selectedShiftRequest?.requestedBy;
      const currentNurseId = selectedShiftRequest?.nurseId || selectedShiftRequest?.primaryNurseId;
      const isDifferentNurse = currentNurseId && currentNurseId !== nurseId;
      
      const preserveOriginal = isPatientCreated && currentNurseId && !selectedShiftRequest?.preferredNurseId;

      if (preserveOriginal) {
        console.log('💾 PRESERVING ORIGINAL REQUESTED NURSE:', {
          fromNurseId: currentNurseId,
          fromNurseName: selectedShiftRequest?.nurseName,
          fromNurseCode: selectedShiftRequest?.nurseCode,
          toNurseId: nurseId,
          toNurseName: nurseName,
          toNurseCode: nurseCode,
        });
      }

      const updates = {
        primaryNurseId: nurseId,
        nurseId: nurseId,
        nurseName,
        nurseCode,
        nurseEmail: nurse.email || nurse.contactEmail,
        nursePhone: nurse.phone || nurse.contactNumber,
        // Preserve original requested nurse before overwriting
        ...(preserveOriginal ? {
          preferredNurseId: currentNurseId,
          preferredNurseName: selectedShiftRequest?.nurseName,
          preferredNurseCode: selectedShiftRequest?.nurseCode,
        } : {}),
        // CRITICAL: Explicitly ensure status remains pending and NOT approved
        ...(isPendingRequest ? { 
          status: 'pending', 
          recurringApproved: false,
          approvedAt: null,
          approvedBy: null
        } : {})
      };

      // Don't auto-approve - let admin explicitly approve after assigning
      // Just add nurse response tracking - set as pending (waiting for nurse acceptance)
      // Store by both nurseId AND nurseCode for better matching
      const responseData = {
        status: 'pending',
        respondedAt: nowIso,
        nurseId: nurseId,
        nurseName: nurseName,
        nurseCode: nurseCode,
      };
      
      if (nurse.uid) {
        responseData.uid = nurse.uid;
      }
      if (nurse.email) {
        responseData.email = nurse.email;
      }
      
      // Set response by nurseId
      updates[`nurseResponses.${nurseId}.status`] = responseData.status;
      updates[`nurseResponses.${nurseId}.respondedAt`] = responseData.respondedAt;
      updates[`nurseResponses.${nurseId}.nurseId`] = responseData.nurseId;
      updates[`nurseResponses.${nurseId}.nurseName`] = responseData.nurseName;
      updates[`nurseResponses.${nurseId}.nurseCode`] = responseData.nurseCode;
      if (responseData.uid) updates[`nurseResponses.${nurseId}.uid`] = responseData.uid;
      if (responseData.email) updates[`nurseResponses.${nurseId}.email`] = responseData.email;
      
      // Also set by nurseCode if available (for better matching)
      if (nurseCode) {
        updates[`nurseResponses.${nurseCode}.status`] = responseData.status;
        updates[`nurseResponses.${nurseCode}.respondedAt`] = responseData.respondedAt;
        updates[`nurseResponses.${nurseCode}.nurseId`] = responseData.nurseId;
        updates[`nurseResponses.${nurseCode}.nurseName`] = responseData.nurseName;
        updates[`nurseResponses.${nurseCode}.nurseCode`] = responseData.nurseCode;
        if (responseData.uid) updates[`nurseResponses.${nurseCode}.uid`] = responseData.uid;
        if (responseData.email) updates[`nurseResponses.${nurseCode}.email`] = responseData.email;
      }

      // Check if document exists first, then update or upsert
      const existingDoc = await ApiService.getShiftRequestById(selectedShiftRequest.id);
      
      if (existingDoc && existingDoc.id) {
        // Document exists, update it
        await ApiService.updateShiftRequest(selectedShiftRequest.id, updates);
      } else {
        // Document doesn't exist, recreate it with upsert
        console.warn('Shift request document missing, recreating via upsert:', selectedShiftRequest.id);
        
        // Clean the selectedShiftRequest to remove undefined values before spreading
        const cleanBase = Object.fromEntries(
          Object.entries(selectedShiftRequest).filter(([_, v]) => v !== undefined)
        );
        
        await ApiService.upsertShiftRequest(selectedShiftRequest.id, {
          ...cleanBase,
          ...updates
        });
      }

      // Notify the newly assigned nurse
      try {
        const notificationTitle = 'New Recurring Shift Assignment';
        const notificationMessage = `You have been assigned to ${selectedShiftRequest.clientName || 'a recurring care schedule'}`;
        
        await sendNotificationToUser(
          nurseId,
          'nurse',
          notificationTitle,
          notificationMessage,
          {
            type: 'recurring_shift_assignment',
            shiftRequestId: selectedShiftRequest.id,
          }
        );
      } catch (err) {
        console.error('Failed to notify nurse:', err);
      }

      setPrimaryNurseModalVisible(false);
      refreshShiftRequests();
      
      // Refresh the current shift request details
      const updated = await FirebaseService.getShiftRequestById(selectedShiftRequest.id);
      if (updated?.success && updated.shiftRequest) {
        setSelectedShiftRequest(updated.shiftRequest);
      }

      setShiftRequestModalVisible(true);

      Alert.alert('Success', `${nurseName} has been assigned to this recurring shift`);
    } catch (error) {
      console.error('Error assigning primary nurse:', error);
      Alert.alert('Error', 'Failed to assign primary nurse');
    }
  };

  // Check nurse availability for recurring schedule
  const checkNurseAvailability = async () => {
    if (!selectedShiftRequest?.nurseId) {
      Alert.alert('No Nurse Assigned', 'Please assign a primary nurse first');
      return;
    }

    try {
      // This would call a backend endpoint to check conflicts
      // For now, show a placeholder
      Alert.alert(
        'Availability Check',
        `Checking availability for ${selectedShiftRequest.nurseName || 'assigned nurse'}...\n\nThis feature requires backend integration to check schedule conflicts.`,
        [
          {
            text: 'OK'
          }
        ]
      );
    } catch (error) {
      console.error('Error checking availability:', error);
      Alert.alert('Error', 'Failed to check nurse availability');
    }
  };

  // Approve recurring shift request
  const handleApproveRecurringShift = async () => {
    if (!selectedShiftRequest?.primaryNurseId && !selectedShiftRequest?.nurseId) {
      Alert.alert(
        'Missing Assignment',
        'Please assign a primary nurse before approving.',
        [
          {
            text: 'Assign Nurse',
            onPress: () => openPrimaryNurseModal()
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
      return;
    }

    // Optionally prompt for backup nurses
    if (!selectedShiftRequest.backupNurses || selectedShiftRequest.backupNurses.length === 0) {
      Alert.alert(
        'Add Backup Coverage?',
        'Would you like to add emergency backup nurses for this recurring shift?',
        [
          {
            text: 'Add Backups',
            onPress: () => openBackupNurseModal()
          },
          {
            text: 'Approve Without Backups',
            onPress: () => approveRecurringShift()
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
    } else {
      await approveRecurringShift();
    }
  };

  const approveRecurringShift = async () => {
    try {
      // Step 1: Update the shift request status to approved
      await ApiService.updateShiftRequest(selectedShiftRequest.id, {
        status: 'approved',
        approvedBy: user?.id,
        approvedAt: new Date().toISOString()
      });

      // Step 2: Generate recurring appointment instances
      // Calculate duration based on recurring pattern
      const startDate = selectedShiftRequest.startDate || selectedShiftRequest.recurringPeriodStart;
      const endDate = selectedShiftRequest.endDate || selectedShiftRequest.recurringPeriodEnd;
      const frequency = selectedShiftRequest.recurringFrequency || selectedShiftRequest.recurringPattern?.frequency || 'weekly';
      
      // Calculate number of occurrences
      let duration = 12; // Default to 12 weeks if no end date
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const weeks = Math.ceil((end - start) / (7 * 24 * 60 * 60 * 1000));
        duration = Math.max(1, weeks);
      }

      // Prepare appointment data for each day in the recurring pattern
      const daysOfWeek = selectedShiftRequest.recurringDaysOfWeek || 
                         selectedShiftRequest.recurringDaysOfWeekList || 
                         selectedShiftRequest.daysOfWeek || 
                         [];
      
      const appointmentData = {
        patientId: selectedShiftRequest.clientId,
        patientName: selectedShiftRequest.clientName || selectedShiftRequest.patientName,
        name: selectedShiftRequest.clientName || selectedShiftRequest.patientName,
        email: selectedShiftRequest.clientEmail,
        phone: selectedShiftRequest.clientPhone,
        service: selectedShiftRequest.service || selectedShiftRequest.serviceName || 'Recurring Care',
        date: startDate || new Date().toISOString().split('T')[0],
        time: selectedShiftRequest.startTime || selectedShiftRequest.recurringStartTime || '09:00 AM',
        startTime: selectedShiftRequest.startTime || selectedShiftRequest.recurringStartTime || '09:00 AM',
        endTime: selectedShiftRequest.endTime || selectedShiftRequest.recurringEndTime || '10:00 AM',
        address: selectedShiftRequest.clientAddress || selectedShiftRequest.location?.address || '',
        notes: selectedShiftRequest.notes || '',
        daysOfWeek: daysOfWeek,
        selectedDays: daysOfWeek,
        preferredNurseId: selectedShiftRequest.nurseId || selectedShiftRequest.primaryNurseId,
        preferredNurseName: selectedShiftRequest.nurseName,
        preferredNurseCode: selectedShiftRequest.nurseCode,
        recurringShiftRequestId: selectedShiftRequest.id,
        backupNurses: selectedShiftRequest.backupNurses || []
      };

      // Generate recurring appointments using RecurringAppointmentService
      const recurringResult = await RecurringAppointmentService.createRecurringAppointments(
        appointmentData,
        frequency,
        duration
      );

      if (recurringResult.success) {
        console.log(`✅ Generated ${recurringResult.totalInstances} appointment instances for recurring shift`);
      }

      // Step 3: Notify patient/client
      const clientId = selectedShiftRequest.clientId;
      if (clientId) {
        try {
          const daysText = daysOfWeek.map(d => DAY_NAMES[d]).join(', ');
          await sendNotificationToUser(
            clientId,
            'patient',
            'Recurring Care Schedule Confirmed',
            `Your recurring ${selectedShiftRequest.service || 'care'} appointments have been approved! ${recurringResult.totalInstances || duration} appointments scheduled on ${daysText}.`,
            {
              type: 'recurring_shift_approved',
              shiftRequestId: selectedShiftRequest.id,
              totalAppointments: recurringResult.totalInstances || duration,
              seriesId: recurringResult.seriesId,
              nurseName: selectedShiftRequest.nurseName,
              service: selectedShiftRequest.service
            }
          );
        } catch (err) {
          console.error('Failed to notify patient:', err);
        }
      }

      // Step 4: Notify primary nurse
      const nurseId = selectedShiftRequest.primaryNurseId || selectedShiftRequest.nurseId;
      if (nurseId) {
        try {
          await sendNotificationToUser(
            nurseId,
            'nurse',
            'Recurring Shift Approved',
            `Your recurring shift assignment for ${selectedShiftRequest.clientName || 'patient care'} has been approved. ${recurringResult.totalInstances || duration} appointments have been scheduled.`,
            {
              type: 'recurring_shift_approved',
              shiftRequestId: selectedShiftRequest.id,
              totalAppointments: recurringResult.totalInstances || duration,
              seriesId: recurringResult.seriesId
            }
          );
        } catch (err) {
          console.error('Failed to notify nurse:', err);
        }
      }

      // Step 5: Notify backup nurses if any
      if (selectedShiftRequest.backupNurses && selectedShiftRequest.backupNurses.length > 0) {
        for (const backup of selectedShiftRequest.backupNurses) {
          if (backup.nurseId) {
            try {
              await sendNotificationToUser(
                backup.nurseId,
                'nurse',
                'Emergency Backup Assignment',
                `You are priority ${backup.priority} backup for ${selectedShiftRequest.clientName || 'patient care'} recurring shift`,
                {
                  type: 'backup_assignment',
                  shiftRequestId: selectedShiftRequest.id,
                  priority: backup.priority
                }
              );
            } catch (err) {
              console.error(`Failed to notify backup nurse ${backup.nurseId}:`, err);
            }
          }
        }
      }

      Alert.alert(
        'Success', 
        `Recurring shift approved! ${recurringResult.totalInstances || duration} appointments have been scheduled and all parties notified.`
      );
      setShiftRequestModalVisible(false);
      refreshShiftRequests();
    } catch (error) {
      console.error('Error approving recurring shift:', error);
      Alert.alert('Error', error.message || 'Failed to approve recurring shift');
    }
  };

  const getNurseAssignmentKey = (nurse) => {
    if (!nurse) return null;
    return (
      nurse.code ||
      nurse.nurseCode ||
      nurse.staffCode ||
      nurse.nurseId ||
      nurse.userId ||
      nurse.id ||
      nurse._id ||
      nurse.uid ||
      null
    );
  };

  const getNurseDisplayName = (nurse) => {
    if (!nurse) return 'Nurse';
    return (
      nurse.fullName ||
      nurse.name ||
      nurse.displayName ||
      `${nurse.firstName || ''} ${nurse.lastName || ''}`.trim() ||
      'Nurse'
    );
  };

  const sanitizeMediaValue = useCallback((value) => {
    if (!value) return '';
    if (typeof value === 'object') {
      if (value.uri && typeof value.uri === 'string' && value.uri.trim()) return value.uri;
      if (value.url && typeof value.url === 'string' && value.url.trim()) return value.url;
      if (value.downloadURL && typeof value.downloadURL === 'string' && value.downloadURL.trim()) return value.downloadURL;
      // Support nested objects like { asset: { uri: ... } } if needed, but not common here
      return '';
    }
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (['n/a', 'na', 'none', 'null', 'undefined', 'no photo', 'no image'].includes(lower)) {
      return '';
    }
    return trimmed;
  }, []);

  const resolveClientProfilePhoto = useCallback(
    (record) => {
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
        record.clientSnapshot?.profilePhoto,
        record.clientSnapshot?.profileImage,
        record.clientSnapshot?.profileImageUrl,
        record.clientSnapshot?.profilePicture,
        record.clientSnapshot?.photoUrl,
        record.clientSnapshot?.photoURL,
        record.clientSnapshot?.photo,
        record.clientSnapshot?.imageUrl,
        record.clientSnapshot?.avatar,
        record.clientSnapshot?.avatarUrl,
        record.patientSnapshot?.profilePhoto,
        record.patientSnapshot?.profileImage,
        record.patientSnapshot?.profileImageUrl,
        record.patientSnapshot?.profilePicture,
        record.patientSnapshot?.photoUrl,
        record.patientSnapshot?.photoURL,
        record.patientSnapshot?.photo,
        record.patientSnapshot?.imageUrl,
        record.patientSnapshot?.avatar,
        record.patientSnapshot?.avatarUrl,
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

      const cachedClient =
        clientId && freshClientDataMap instanceof Map
          ? freshClientDataMap.get(String(clientId)) || freshClientDataMap.get(clientId)
          : null;
      if (cachedClient) {
        const cachedCandidates = [
          cachedClient.profilePhoto,
          cachedClient.profileImage,
          cachedClient.profileImageUrl,
          cachedClient.profilePicture,
          cachedClient.photoUrl,
          cachedClient.photoURL,
          cachedClient.photo,
          cachedClient.imageUrl,
          cachedClient.avatar,
          cachedClient.avatarUrl,
        ].map(sanitizeMediaValue);
        return cachedCandidates.find(Boolean) || null;
      }

      if (clientId || clientEmail) {
        let found = null;
        if (clientId && clientsById instanceof Map) {
          const key = String(clientId).trim();
          if (key) {
            found = clientsById.get(key) || found;
          }
        }
        if (!found && clientEmail && clientsByEmailLower instanceof Map) {
          const emailKey = String(clientEmail).trim().toLowerCase();
          if (emailKey) {
            found = clientsByEmailLower.get(emailKey) || found;
          }
        }
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
    },
    [clientsById, clientsByEmailLower, freshClientDataMap, sanitizeMediaValue]
  );

  const resolveClientDisplayName = useCallback(
    (record) => {
      if (!record) return 'Unknown Patient';
      const direct =
        record.patientName ||
        record.clientName ||
        record.patientFullName ||
        record.clientFullName ||
        record.name ||
        record.fullName ||
        record.patientDisplayName ||
        record.clientDisplayName ||
        record.displayName ||
        record.patient?.displayName ||
        record.client?.displayName ||
        record.patientSnapshot?.displayName ||
        record.patient?.fullName ||
        record.patient?.name ||
        record.client?.name ||
        record.client?.fullName ||
        record.clientSnapshot?.name ||
        record.clientSnapshot?.fullName ||
        record.patientSnapshot?.name ||
        record.patientSnapshot?.fullName ||
        (record.patient?.firstName || record.patient?.lastName
          ? `${record.patient?.firstName || ''} ${record.patient?.lastName || ''}`.trim()
          : null) ||
        (record.client?.firstName || record.client?.lastName
          ? `${record.client?.firstName || ''} ${record.client?.lastName || ''}`.trim()
          : null) ||
        (record.clientSnapshot?.firstName || record.clientSnapshot?.lastName
          ? `${record.clientSnapshot?.firstName || ''} ${record.clientSnapshot?.lastName || ''}`.trim()
          : null) ||
        (record.patientSnapshot?.firstName || record.patientSnapshot?.lastName
          ? `${record.patientSnapshot?.firstName || ''} ${record.patientSnapshot?.lastName || ''}`.trim()
          : null) ||
        (record.firstName || record.lastName
          ? `${record.firstName || ''} ${record.lastName || ''}`.trim()
          : null);
      if (direct) return direct;

      const clientId = record.clientId || record.patientId || record.clientUid || record.patientUid || record.uid || null;
      const clientEmail =
        record.clientEmail ||
        record.patientEmail ||
        record.email ||
        record.patient?.email ||
        record.client?.email ||
        record.user?.email ||
        null;

      const cachedClient =
        clientId && freshClientDataMap instanceof Map
          ? freshClientDataMap.get(String(clientId)) || freshClientDataMap.get(clientId)
          : null;
      if (cachedClient) {
        return (
          cachedClient.fullName ||
          cachedClient.name ||
          (cachedClient.firstName || cachedClient.lastName
            ? `${cachedClient.firstName || ''} ${cachedClient.lastName || ''}`.trim()
            : null) ||
          cachedClient.username ||
          cachedClient.id ||
          'Unknown Patient'
        );
      }

      if (clientId || clientEmail) {
        let found = null;
        if (clientId && clientsById instanceof Map) {
          const key = String(clientId).trim();
          if (key) {
            found = clientsById.get(key) || found;
          }
        }
        if (!found && clientEmail && clientsByEmailLower instanceof Map) {
          const emailKey = String(clientEmail).trim().toLowerCase();
          if (emailKey) {
            found = clientsByEmailLower.get(emailKey) || found;
          }
        }
        if (found?.name || found?.fullName) return found.name || found.fullName;
        if (found?.firstName || found?.lastName) {
          return `${found.firstName || ''} ${found.lastName || ''}`.trim();
        }
      }

      return clientEmail || clientId || 'Unknown Patient';
    },
    [clientsById, clientsByEmailLower, freshClientDataMap]
  );

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

  const openReassignNurseModal = (fromNurseKey) => {
    const DEBUG_REASSIGN = false;
    if (__DEV__ && DEBUG_REASSIGN) {
      console.log('Opening Reassign Modal for:', fromNurseKey);
      console.log('Total nurses available:', nurses ? nurses.length : 0);
    }
    setReassignFromNurseKey(fromNurseKey || null);
    setReassignNurseSearch('');
    setReassignSubmitting(false);
    setReassignNurseModalVisible(true);
  };

  const closeReassignNurseModal = () => {
    setReassignNurseModalVisible(false);
    setReassignFromNurseKey(null);
    setReassignNurseSearch('');
    setReassignSubmitting(false);
  };

  const reassignCandidateNurses = React.useMemo(() => {
    if (!reassignNurseModalVisible) return [];
    
    // Use full 'nurses' list from context
    const allNurses = Array.isArray(nurses) ? nurses : [];

    const query = (reassignNurseSearch || '').trim().toLowerCase();
    const fromKey = reassignFromNurseKey ? String(reassignFromNurseKey) : null;

    const DEBUG_REASSIGN = false;
    if (__DEV__ && DEBUG_REASSIGN) {
      console.log('Filtering nurses:', allNurses.length, 'Query:', query, 'Excluding:', fromKey);
    }

    const filtered = allNurses
      .filter((n) => {
        if (!n) return false;
        
        // Calculate identifiers for filtering
        const nId = String(n.id || n._id || n.nurseId || n.uid || '');
        const nCode = String(n.code || n.nurseCode || n.staffCode || '');
        
        // Exclude the nurse we are reassigning from
        if (fromKey) {
            if (nId && nId === fromKey) return false;
            if (nCode && nCode === fromKey) return false;
        }

        // Search filter
        if (!query) return true;
        
        const name = (getNurseDisplayName(n) || '').toLowerCase();
        const email = (n.email || n.contactEmail || '').toLowerCase();
        const code = nCode.toLowerCase();
        
        return name.includes(query) || email.includes(query) || code.includes(query);
      })
      .sort((a, b) => (getNurseDisplayName(a) || '').localeCompare(getNurseDisplayName(b) || ''));

    if (__DEV__ && DEBUG_REASSIGN) {
      console.log('Filtered nurses count:', filtered.length);
    }
    return filtered;
  }, [reassignNurseModalVisible, nurses, reassignNurseSearch, reassignFromNurseKey]);

  const performSplitScheduleReassignment = async ({ shiftId, fromKey, toNurse }) => {
    const latest = await FirebaseService.getShiftRequestById(shiftId);
    if (!latest?.success || !latest.shiftRequest) {
      throw new Error(latest?.error || 'Unable to load shift request');
    }

    const shiftRequest = latest.shiftRequest;
    const toKey = getNurseAssignmentKey(toNurse);
    if (!toKey) throw new Error('Selected nurse is missing an identifier');

    const fromKeyString = String(fromKey);
    const toKeyString = String(toKey);
    if (fromKeyString === toKeyString) throw new Error('Please select a different nurse');

    const updatedNurseResponses = {
      ...(shiftRequest.nurseResponses && typeof shiftRequest.nurseResponses === 'object' ? shiftRequest.nurseResponses : {}),
    };
    delete updatedNurseResponses[fromKeyString];
    delete updatedNurseResponses[toKeyString];

    // Split schedule: swap nurse key in the day->nurseSchedule mapping
    const updatedNurseSchedule = {
      ...(shiftRequest.nurseSchedule && typeof shiftRequest.nurseSchedule === 'object' ? shiftRequest.nurseSchedule : {}),
    };
    Object.keys(updatedNurseSchedule).forEach((dayKey) => {
      const value = updatedNurseSchedule[dayKey];
      if (typeof value === 'string' && value.trim() === fromKeyString) {
        updatedNurseSchedule[dayKey] = toKeyString;
      }
    });

    const toName = getNurseDisplayName(toNurse);
    const toCode = toNurse?.code || toNurse?.nurseCode || toNurse?.staffCode || toKeyString;
    const toSpecialty = toNurse?.specialization || toNurse?.specialty || 'General Nursing';
    const toPhoto = toNurse?.profilePhoto || toNurse?.profileImage || toNurse?.photoUrl || null;

    // Keep assignedNurses aligned for display
    const assignedList = Array.isArray(shiftRequest.assignedNurses) ? [...shiftRequest.assignedNurses] : [];
    const updatedAssigned = assignedList
      .map((entry) => {
        if (!entry) return entry;
        if (typeof entry === 'string') {
          return entry.trim() === fromKeyString ? toKeyString : entry;
        }
        if (typeof entry === 'object') {
          const entryId = entry.nurseId || entry._id || entry.id;
          const entryCode = entry.staffCode || entry.nurseCode || entry.code;
          const matchesFrom =
            (typeof entryId === 'string' && entryId.trim() === fromKeyString)
            || (typeof entryCode === 'string' && entryCode.trim() === fromKeyString);
          if (!matchesFrom) return entry;
          return {
            ...entry,
            nurseId: toKeyString,
            nurseName: toName,
            nurseCode: toCode,
            nurseSpecialty: toSpecialty,
            profilePhoto: toPhoto,
          };
        }
        return entry;
      })
      .filter(Boolean);

    const alreadyHasTo = updatedAssigned.some((entry) => {
      if (!entry) return false;
      if (typeof entry === 'string') return entry.trim() === toKeyString;
      const entryId = entry.nurseId || entry._id || entry.id;
      const entryCode = entry.staffCode || entry.nurseCode || entry.code;
      return (
        (typeof entryId === 'string' && entryId.trim() === toKeyString)
        || (typeof entryCode === 'string' && entryCode.trim() === toKeyString)
      );
    });

    const normalizedAssigned = alreadyHasTo
      ? updatedAssigned
      : [
          ...updatedAssigned,
          {
            nurseId: toKeyString,
            nurseName: toName,
            nurseCode: toCode,
            nurseSpecialty: toSpecialty,
            profilePhoto: toPhoto,
          },
        ];

    const updates = {
      nurseSchedule: updatedNurseSchedule,
      assignedNurses: normalizedAssigned,
      nurseResponses: updatedNurseResponses,
    };

    const updateResult = await FirebaseService.updateShiftRequest(shiftId, updates);
    if (!updateResult?.success) {
      throw new Error(updateResult?.error || 'Failed to update shift request');
    }

    // Notify the newly assigned nurse (best-effort)
    try {
      const notifyTargetId = toNurse?.id || toNurse?._id || toNurse?.uid;
      if (notifyTargetId) {
        await sendNotificationToUser(
          notifyTargetId,
          'nurse',
          'Recurring Schedule Reassigned',
          `You have been assigned to a recurring schedule (${shiftRequest.service || 'Care'}) for ${shiftRequest.clientName || 'a client'}.`,
          {
            type: 'recurring_reassigned',
            shiftRequestId: shiftId,
          }
        );
      }
    } catch (e) {
      // Ignore notification failures
    }

    return true;
  };

  const handleReassignNurse = async (toNurse) => {
    const shiftId = selectedShiftRequest?.id;
    const fromKey = reassignFromNurseKey;
    if (!shiftId || !fromKey) return;

    const toKey = getNurseAssignmentKey(toNurse);
    if (!toKey) {
      Alert.alert('Error', 'Selected nurse is missing an identifier');
      return;
    }

    Alert.alert(
      'Reassign Nurse',
      `Reassign this schedule from ${fromKey} to ${getNurseDisplayName(toNurse)} (${toKey})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reassign',
          onPress: async () => {
            try {
              const hasSplitSchedule = Boolean(selectedShiftRequest?.nurseSchedule && typeof selectedShiftRequest.nurseSchedule === 'object');
              if (!hasSplitSchedule) {
                Alert.alert('Not Supported', 'Reassign is currently available for split schedules only.');
                return;
              }

              setReassignSubmitting(true);

              await performSplitScheduleReassignment({ shiftId, fromKey, toNurse });

              await refreshShiftRequests();
              const refreshed = await FirebaseService.getShiftRequestById(shiftId);
              if (refreshed?.success && refreshed.shiftRequest) {
                setSelectedShiftRequest(refreshed.shiftRequest);
              }

              Alert.alert('Success', 'Nurse reassigned successfully.');
              closeReassignNurseModal();
            } catch (error) {
              Alert.alert('Error', error?.message || 'Failed to reassign nurse');
            } finally {
              setReassignSubmitting(false);
            }
          },
        },
      ]
    );
  };



  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <AppOnboarding
        visible={showOnboarding}
        userRole={user?.role || 'admin'}
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
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerRow}>
          <TouchableWeb 
            style={styles.iconButton}
            onPress={() => navigation.navigate('Notifications')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="bell-outline" size={26} color={COLORS.white} />
            {unreadCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableWeb>

          <View style={styles.headerTitleContainer}>
            <Text style={styles.welcomeLabel}>Welcome</Text>
            <Text style={styles.userName}>{user?.firstName || user?.username || 'Admin'}!</Text>
          </View>

          <TouchableWeb 
            style={styles.iconButton}
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.7}
          >
            {user?.profilePhoto ? (
              <Image 
                source={{ uri: user.profilePhoto }} 
                style={styles.headerProfileImage}
              />
            ) : (
              <MaterialCommunityIcons name="account-circle-outline" size={26} color={COLORS.white} />
            )}
          </TouchableWeb>
        </View>
      </LinearGradient>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <TouchableWeb 
          style={styles.statCard}
          onPress={() => {
            const newSelection = selectedCard === 'pending' ? null : 'pending';
            setSelectedCard(newSelection);
            if (newSelection === 'pending') {
              refreshRequests(); // Force refresh when opening pending tab
              refreshShiftRequests();
            }
          }}
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
          onPress={() => setSelectedCard(selectedCard === 'nurses' ? null : 'nurses')}
          activeOpacity={0.8}
        >
          {selectedCard === 'nurses' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.statGradient}
            >
              <Text style={styles.statLabel}>Active Nurses</Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveStatCard}>
              <Text style={styles.inactiveStatLabel}>Active Nurses</Text>
            </View>
          )}
        </TouchableWeb>
        
        <TouchableWeb 
          style={styles.statCard}
          onPress={() => setSelectedCard(selectedCard === 'appointments' ? null : 'appointments')}
          activeOpacity={0.8}
        >
          {selectedCard === 'appointments' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.statGradient}
            >
              <Text style={styles.statLabel}>Appointments</Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveStatCard}>
              <Text style={styles.inactiveStatLabel}>Appointments</Text>
            </View>
          )}
        </TouchableWeb>

        <TouchableWeb 
          style={styles.statCard}
          onPress={() => setSelectedCard(selectedCard === 'completed' ? null : 'completed')}
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

      {/* Content Area */}
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
        {selectedCard === 'appointments' && (
          <View style={styles.contentSection}>
            {finalActiveAppointments.map((appointment, index) => {
              const isClockedIn = appointment.status === 'active' || appointment.status === 'clocked-in' || appointment.status === 'in-progress';
              const displayName = resolveClientDisplayName(appointment);
              const photo = resolveClientProfilePhoto(appointment);
              const photoUri = getPhotoUri(photo);
              const initials = getInitials(displayName);
              return (
              <View key={appointment.id ? `${appointment.id}-${index}` : `appt-${index}`} style={[styles.compactCard, isClockedIn && styles.clockedInCard]}>
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
                  <TouchableWeb
                    style={styles.detailsButton}
                    onPress={() => handleViewAppointmentDetails(appointment)}
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
                </View>
              </View>
              );
            })}
          </View>
        )}

        {selectedCard === 'nurses' && (
          <View style={styles.contentSection}>
            {activeNurses.map((nurse, index) => (
              <View key={nurse.id || `nurse-${index}`} style={styles.compactCard}>
                <View style={styles.compactHeader}>
                  {nurse.profilePhoto || nurse.profileImage || nurse.photoUrl ? (
                    <Image 
                      source={{ uri: nurse.profilePhoto || nurse.profileImage || nurse.photoUrl }} 
                      style={{ 
                        width: 40, 
                        height: 40, 
                        borderRadius: 20, 
                        marginRight: 10,
                        backgroundColor: '#E6ECF5' 
                      }} 
                    />
                  ) : (
                    <MaterialCommunityIcons name="account-heart" size={20} color={COLORS.accent} />
                  )}
                  <View style={styles.compactInfo}>
                    <Text style={styles.compactClient}>{nurse.name}</Text>
                  </View>
                  <TouchableWeb
                    style={styles.detailsButton}
                    onPress={() => {
                      setNurseSelectionMode(null);
                      openNurseDetailsModal(nurse);
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
                </View>
              </View>
            ))}
          </View>
        )}

        {selectedCard === 'pending' && (
          <View style={styles.contentSection}>

            {/* Pending Consultation Calls */}
            {pendingConsultationRequests.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Consultation Calls</Text>
                {pendingConsultationRequests.map((req, index) => {
                  const displayName =
                    req.patientName ||
                    req.clientName ||
                    req.patientEmail ||
                    req.email ||
                    req.patientId ||
                    'Unknown Patient';

                  const dateObj = getConsultationScheduledDate(req);
                  const isCallRequested = String(req?.status || '').toLowerCase() === 'call_requested';
                  const isCallTime = Boolean(dateObj && dateObj.getTime() <= nowTick);
                  const showCall = isCallRequested || isCallTime;
                  const callPhone = req?.patientPhone || req?.phone || '';

                  const dateLabel = dateObj
                    ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Date TBD';
                  const timeLabel = dateObj
                    ? dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : 'Time TBD';

                  return (
                    <View key={req.id || `consult-${index}`} style={styles.compactCard}>
                      <View style={styles.compactHeader}>
                        <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                        <View style={styles.compactInfo}>
                          <Text style={styles.compactClient}>{displayName}</Text>
                          <Text style={styles.compactService}>{dateLabel} at {timeLabel}</Text>
                        </View>

                        {showCall ? (
                          <TouchableWeb
                            style={styles.reassignChip}
                            onPress={() => openDialerForPhone(callPhone, req.id, req.patientAuthUid || req.patientId)}
                            activeOpacity={0.8}
                          >
                            <LinearGradient
                              colors={GRADIENTS.header}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.reassignChipGradient}
                            >
                              <Text style={styles.reassignChipText}>Call</Text>
                            </LinearGradient>
                          </TouchableWeb>
                        ) : (
                          <View style={styles.reassignChip}>
                            <LinearGradient
                              colors={GRADIENTS.warning}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.reassignChipGradient}
                            >
                              <Text style={styles.reassignChipText}>Pending</Text>
                            </LinearGradient>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {/* Medical Report Requests */}
            {pendingMedicalReportRequests.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Medical Report Requests</Text>
                {pendingMedicalReportRequests.map((req, index) => {
                  const displayName =
                    req.patientName ||
                    req.clientName ||
                    'Unknown Patient';

                  const createdObj = (() => {
                    const v = req.createdAt || null;
                    try {
                      if (!v) return null;
                      if (typeof v?.toDate === 'function') return v.toDate();
                      if (v?.seconds != null) return new Date(v.seconds * 1000);
                      const d = new Date(v);
                      return Number.isNaN(d.getTime()) ? null : d;
                    } catch (_) {
                      return null;
                    }
                  })();

                  const createdLabel = createdObj
                    ? createdObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Recently';

                  return (
                    <TouchableWeb
                      key={req.id || `medrep-${index}`}
                      style={styles.compactCard}
                      activeOpacity={0.8}
                      onPress={() => openMedicalReportRequestModal(req)}
                    >
                      <View style={styles.compactHeader}>
                        <MaterialCommunityIcons name="file-document-outline" size={20} color={COLORS.primary} />
                        <View style={styles.compactInfo}>
                          <Text style={styles.compactClient}>{displayName}</Text>
                        </View>
                        <View style={styles.reassignChip}>
                          <LinearGradient
                            colors={GRADIENTS.warning}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.reassignChipGradient}
                          >
                            <Text style={styles.reassignChipText}>Pending</Text>
                          </LinearGradient>
                        </View>
                      </View>
                    </TouchableWeb>
                  );
                })}
              </>
            )}

            {/* Pending Shift Requests (from nurses) */}
            {pendingShiftRequests.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Shift Requests</Text>
                {pendingShiftRequests.map((shiftRequest, index) => {
                  const displayName = resolveClientDisplayName(shiftRequest);
                  const photo = resolveClientProfilePhoto(shiftRequest);
                  const photoUri = getPhotoUri(photo);
                  const initials = getInitials(displayName);

                  return (
                    <View key={shiftRequest.id || `shift-req-${index}`} style={styles.compactCard}>
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
                          <Text style={styles.compactClient}>{displayName}</Text>
                        </View>
                        <TouchableWeb
                          style={styles.detailsButton}
                          onPress={() => handleShiftRequestDetails(shiftRequest)}
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
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {/* Pending Recurring Shift Requests (from admin to nurses) */}
            {pendingRecurringShiftRequests.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Recurring Shift Requests</Text>
                {pendingRecurringShiftRequests.map((shiftRequest, index) => {
                  const displayName = resolveClientDisplayName(shiftRequest);
                  const photo = resolveClientProfilePhoto(shiftRequest);
                  const photoUri = getPhotoUri(photo);
                  const initials = getInitials(displayName);

                  return (
                    <View key={shiftRequest.id || `recurring-req-${index}`} style={styles.compactCard}>
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
                          <Text style={styles.compactClient}>{displayName}</Text>
                        </View>
                        <TouchableWeb
                          style={styles.detailsButton}
                          onPress={() => handleShiftRequestDetails(shiftRequest)}
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
                      </View>
                    </View>
                  );
                })}
              </>
            )}
            
            {/* Pending Assignment Requests - ONLY show if NO shift requests (shift requests replace assignments) */}
            {allPendingForDisplay.length > 0 && pendingShiftRequests.length === 0 && (
              <>
                <Text style={styles.subsectionTitle}>Assignment Requests</Text>
                {allPendingForDisplay.map((assignment, index) => {
                  const hasInvoice = assignment.invoiceId || (assignment.services && assignment.services.length > 0 && assignment.depositAmount > 0);
                  
                  // Extract clientId and clientEmail
                  const clientId = assignment.clientId || 
                                   assignment.userId || 
                                   assignment.patientId || 
                                   assignment.patient?.id || 
                                   assignment.client?.id || 
                                   assignment.uid;

                  const clientEmail = assignment.clientEmail || 
                                      assignment.patientEmail || 
                                      assignment.email || 
                                      assignment.patient?.email || 
                                      assignment.client?.email || 
                                      assignment.userEmail ||
                                      assignment.user?.email;

                  // Comprehensive patient name resolution
                  const patientName = assignment.patientName ||
                    assignment.clientName ||
                    assignment.name ||
                    assignment.fullName ||
                    assignment.patientFullName ||
                    assignment.clientFullName ||
                    assignment.patientDisplayName ||
                    assignment.clientDisplayName ||
                    assignment.displayName ||
                    assignment.patient?.fullName ||
                    assignment.patient?.name ||
                    assignment.patient?.displayName ||
                    assignment.client?.name ||
                    assignment.client?.fullName ||
                    assignment.client?.displayName ||
                    assignment.patientSnapshot?.name ||
                    assignment.patientSnapshot?.fullName ||
                    assignment.clientSnapshot?.name ||
                    assignment.clientSnapshot?.fullName ||
                    (assignment.patient?.firstName || assignment.patient?.lastName
                      ? `${assignment.patient?.firstName || ''} ${assignment.patient?.lastName || ''}`.trim()
                      : null) ||
                    (assignment.client?.firstName || assignment.client?.lastName
                      ? `${assignment.client?.firstName || ''} ${assignment.client?.lastName || ''}`.trim()
                      : null) ||
                    (assignment.firstName || assignment.lastName
                      ? `${assignment.firstName || ''} ${assignment.lastName || ''}`.trim()
                      : null) ||
                    // Try freshClientDataMap
                    (clientId && freshClientDataMap instanceof Map
                      ? freshClientDataMap.get(String(clientId))?.name || 
                        freshClientDataMap.get(String(clientId))?.fullName || 
                        freshClientDataMap.get(clientId)?.name || 
                        freshClientDataMap.get(clientId)?.fullName
                      : null) ||
                    // Try client maps
                    (() => {
                      if (!clientId && !clientEmail) return null;
                      let found = null;
                      if (clientId && clientsById instanceof Map) {
                        const key = String(clientId).trim();
                        if (key) {
                          found = clientsById.get(key) || found;
                        }
                      }
                      if (!found && clientEmail && clientsByEmailLower instanceof Map) {
                        const emailKey = String(clientEmail).trim().toLowerCase();
                        if (emailKey) {
                          found = clientsByEmailLower.get(emailKey) || found;
                        }
                      }
                      return found?.name || found?.fullName || found?.displayName || null;
                    })() ||
                    clientEmail ||
                    clientId ||
                    'Unknown Patient';

                  const displayName = patientName;
                  const photo = resolveClientProfilePhoto(assignment);
                  const photoUri = getPhotoUri(photo);
                  const initials = getInitials(displayName);

                  return (
                    <View key={assignment.id || `assignment-${index}`} style={styles.compactCard}>
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
                        <TouchableWeb
                          style={styles.detailsButton}
                          onPress={() => handleViewAppointmentDetails(assignment)}
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
                      </View>
                      {/* Invoice Card for Deposit Payments */}
                      {hasInvoice && (
                        <View style={styles.invoiceCardContainer}>
                          <View style={styles.invoiceCard}>
                            <View style={styles.invoiceCardHeader}>
                              <MaterialCommunityIcons 
                                name="receipt" 
                                size={18} 
                                color={COLORS.primary} 
                              />
                              <Text style={styles.invoiceCardTitle}>Deposit Invoice</Text>
                              {assignment.depositAmount && (
                                <View style={styles.partialBadge}>
                                  <Text style={styles.partialBadgeText}>PARTIAL</Text>
                                </View>
                              )}
                            </View>
                            <View style={styles.invoiceCardRow}>
                              <Text style={styles.invoiceCardLabel}>Services:</Text>
                              <Text style={styles.invoiceCardValue} numberOfLines={2}>
                                {assignment.services 
                                  ? assignment.services.map(s => s.name || s).join(', ') 
                                  : assignment.service || assignment.serviceType || 'N/A'}
                              </Text>
                            </View>
                            {assignment.depositAmount && (
                              <>
                                <View style={styles.invoiceCardRow}>
                                  <Text style={styles.invoiceCardLabel}>Paid (Deposit):</Text>
                                  <Text style={[styles.invoiceCardValue, styles.paidText]}>
                                    J${assignment.depositAmount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                                  </Text>
                                </View>
                                <View style={styles.invoiceCardRow}>
                                  <Text style={styles.invoiceCardLabel}>Outstanding:</Text>
                                  <Text style={[styles.invoiceCardValue, styles.outstandingText]}>
                                    J${((assignment.totalAmount || 0) - (assignment.depositAmount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </Text>
                                </View>
                              </>
                            )}
                            <TouchableWeb
                              style={styles.viewInvoiceButton}
                              onPress={() => {
                                if (assignment.invoiceId) {
                                  navigation.navigate('InvoiceDisplay', { 
                                    invoiceId: assignment.invoiceId,
                                    appointmentId: assignment.id
                                  });
                                }
                              }}
                              activeOpacity={0.7}
                            >
                              <LinearGradient
                                colors={GRADIENTS.header}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.viewInvoiceButtonGradient}
                              >
                                <Text style={styles.viewInvoiceButtonText}>View Invoice</Text>
                                <MaterialCommunityIcons 
                                  name="arrow-right" 
                                  size={16} 
                                  color={COLORS.white} 
                                />
                              </LinearGradient>
                            </TouchableWeb>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </>
            )}

            {/* Profile Edit Requests */}
            {pendingProfileEditRequests.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Profile Edit Requests</Text>
                {pendingProfileEditRequests.map((request, index) => {
                  const requestName = (request?.nurseName || '').trim();
                  const fallbackName = requestName || request?.nurseCode || 'Nurse';
                  const requestNurseId = String(request?.nurseId || request?.userId || request?.uid || '').trim();
                  const requestNurseCode = String(request?.nurseCode || request?.code || request?.nurseCodeValue || '').trim();

                  const matchedNurse = (Array.isArray(nurses) ? nurses : []).find((n) => {
                    if (!n) return false;
                    const nId = String(n?.id || n?._id || n?.nurseId || n?.userId || n?.uid || '').trim();
                    const nCode = String(n?.code || n?.nurseCode || n?.staffCode || '').trim();
                    if (requestNurseId && nId && nId === requestNurseId) return true;
                    if (requestNurseCode && nCode && nCode === requestNurseCode) return true;
                    return false;
                  });

                  const photoUri =
                    sanitizeMediaValue(
                      request?.profilePhoto ||
                        request?.profileImage ||
                        request?.photoUrl ||
                        request?.photoURL ||
                        request?.nurseProfilePhoto
                    ) ||
                    sanitizeMediaValue(
                      matchedNurse?.profilePhoto ||
                        matchedNurse?.profileImage ||
                        matchedNurse?.photoUrl ||
                        matchedNurse?.photoURL
                    ) ||
                    null;

                  return (
                    <View key={request.id || `edit-request-${index}`} style={styles.compactCard}>
                      <View style={styles.compactHeader}>
                        {photoUri ? (
                          <View style={styles.compactAvatarWrapper}>
                            <Image source={{ uri: photoUri }} style={styles.compactAvatarImage} />
                          </View>
                        ) : (
                          <View style={[styles.compactAvatarWrapper, styles.compactAvatarFallback]}>
                            <Text style={styles.compactAvatarInitials}>{getInitials(fallbackName)}</Text>
                          </View>
                        )}
                        <View style={styles.compactInfo}>
                          <Text style={styles.compactClient}>{request.nurseName || 'Unknown'}</Text>
                          <Text style={styles.compactService}>Code: {request.nurseCode || 'N/A'}</Text>
                        </View>
                        <View style={styles.editRequestButtons}>
                          <TouchableWeb 
                            style={styles.denyBtn} 
                            onPress={() => handleDenyEditRequest(request)}
                            activeOpacity={0.8}
                          >
                            <LinearGradient
                              colors={[COLORS.error, COLORS.error]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.denyBtnGradient}
                            >
                              <Text style={styles.denyBtnText}>Deny</Text>
                            </LinearGradient>
                          </TouchableWeb>
                          <TouchableWeb 
                            style={styles.approveBtn} 
                            onPress={() => handleApproveEditRequest(request)}
                            activeOpacity={0.8}
                          >
                            <LinearGradient
                              colors={['#10b981', '#059669']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.approveBtnGradient}
                            >
                              <Text style={styles.approveBtnText}>Approve</Text>
                            </LinearGradient>
                          </TouchableWeb>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
            
            {pendingConsultationRequests.length === 0 && pendingMedicalReportRequests.length === 0 && pendingShiftRequests.length === 0 && pendingRecurringShiftRequests.length === 0 && allPendingForDisplay.length === 0 && pendingProfileEditRequests.length === 0 && (
              <Text style={styles.emptyText}>No pending items</Text>
            )}
          </View>
        )}

        {selectedCard === 'completed' && (
          <View key={`completed-${refreshKey}`} style={styles.contentSection}>
            {sortedFinalCompletedAppointments.map((appointment, index) => {
              const statusLower = String(appointment.status || '').toLowerCase();
              const hasClockInData = Boolean(
                appointment.startedAt ||
                  appointment.actualStartTime ||
                  appointment.clockInTime ||
                  appointment.lastClockInTime
              );
              const hasClockOutData = Boolean(
                appointment.completedAt ||
                  appointment.actualEndTime ||
                  appointment.clockOutTime ||
                  appointment.lastClockOutTime ||
                  appointment.lastActualEndTime ||
                  appointment.lastCompletedAt
              );
              const isClockedIn = !hasClockOutData && (['active', 'clocked-in', 'in-progress'].includes(statusLower) || hasClockInData);
              const displayName = resolveClientDisplayName(appointment);
              const serviceLabel =
                appointment.serviceName ||
                appointment.serviceType ||
                appointment.service ||
                appointment.appointmentType ||
                'Care Visit';

              const completedDateSource =
                appointment.completedAt ||
                appointment.actualEndTime ||
                appointment.clockOutTime ||
                appointment.lastClockOutTime ||
                appointment.lastActualEndTime ||
                appointment.lastCompletedAt ||
                appointment.date ||
                appointment.scheduledDate ||
                appointment.startDate ||
                null;

              const completedDateLabel = formatFriendlyDate(completedDateSource);
              const photo = resolveClientProfilePhoto(appointment);
              const photoUri = getPhotoUri(photo);
              const initials = getInitials(displayName);
              return (
              <View key={appointment.id ? `${appointment.id}-${index}` : `completed-${index}`} style={[styles.compactCard, isClockedIn && styles.clockedInCard]}>
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
                    <Text style={styles.compactService} numberOfLines={1}>
                      {serviceLabel}
                    </Text>
                    {completedDateLabel ? (
                      <Text style={styles.compactDate}>
                        {`Completed: ${completedDateLabel}`}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableWeb
                    style={styles.detailsButton}
                    onPress={() => handleViewAppointmentDetails(appointment)}
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
                </View>
              </View>
              );
            })}
          </View>
        )}



      </ScrollView>

      {/* Medical Report Request Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        presentationStyle="overFullScreen"
        visible={medicalReportRequestModalVisible}
        onRequestClose={closeMedicalReportRequestModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: medicalReportModalHeight }]}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Medical Report Request</Text>
                <TouchableWeb onPress={closeMedicalReportRequestModal} disabled={sendingMedicalReport}>
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableWeb>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={[styles.createNurseForm, { paddingBottom: 140 }]}
              >
                {/* Client Information */}
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionTitle}>Client Information</Text>

                {(() => {
                  const req = selectedMedicalReportRequest || {};

                  const patientIdKey = String(req.patientId || req.patientAuthUid || '').trim();
                  const reqEmailLower = String(req.patientEmail || req.email || '').trim().toLowerCase();
                  const resolvedClient =
                    (patientIdKey ? clientsById.get(patientIdKey) : null) ||
                    (reqEmailLower ? clientsByEmailLower.get(reqEmailLower) : null) ||
                    null;

                  const name =
                    (req.patientName && String(req.patientName).trim()) ||
                    (req.clientName && String(req.clientName).trim()) ||
                    (resolvedClient?.name && String(resolvedClient.name).trim()) ||
                    'N/A';

                  const email =
                    (req.patientEmail && String(req.patientEmail).trim()) ||
                    (req.email && String(req.email).trim()) ||
                    (resolvedClient?.email && String(resolvedClient.email).trim()) ||
                    'Not provided';

                  const phone =
                    (req.patientPhone && String(req.patientPhone).trim()) ||
                    (req.phone && String(req.phone).trim()) ||
                    (resolvedClient?.phone && String(resolvedClient.phone).trim()) ||
                    'Not provided';

                  const address =
                    (req.patientAddress && String(req.patientAddress).trim()) ||
                    (req.address && String(req.address).trim()) ||
                    (resolvedClient?.address && String(resolvedClient.address).trim()) ||
                    'Not provided';

                  return (
                    <>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Name</Text>
                          <Text style={styles.detailValue}>{name}</Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Email</Text>
                          <Text style={styles.detailValue}>{email}</Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Phone</Text>
                          <Text style={styles.detailValue}>{phone}</Text>
                        </View>
                      </View>
                      <View style={styles.detailItem}>
                        <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.primary} />
                        <View style={styles.detailContent}>
                          <Text style={styles.detailLabel}>Address</Text>
                          <Text style={styles.detailValue}>{address}</Text>
                        </View>
                      </View>
                    </>
                  );
                })()}
                </View>

                {/* Report Details (fill in here, then Generate to preview) */}
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionTitle}>Report Details</Text>

                  <Text style={styles.formLabel}>Send To Email</Text>
                  <View style={styles.formInput}>
                    <MaterialCommunityIcons name="email-outline" size={18} color={COLORS.textLight} />
                    <TextInput
                      style={styles.input}
                      value={medicalReportToEmail}
                      onChangeText={setMedicalReportToEmail}
                      placeholder="Recipient email"
                      placeholderTextColor={COLORS.textLight}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!sendingMedicalReport}
                    />
                  </View>

                  <Text style={styles.formLabel}>Subject</Text>
                  <View style={styles.formInput}>
                    <MaterialCommunityIcons name="text" size={18} color={COLORS.textLight} />
                    <TextInput
                      style={styles.input}
                      value={medicalReportSubject}
                      onChangeText={setMedicalReportSubject}
                      placeholder="Email subject"
                      placeholderTextColor={COLORS.textLight}
                      editable={!sendingMedicalReport}
                    />
                  </View>

                  <Text style={styles.formLabel}>Date of Birth</Text>
                  <View style={styles.formInput}>
                    <MaterialCommunityIcons name="calendar" size={18} color={COLORS.textLight} />
                    <TextInput
                      style={styles.input}
                      value={medicalReportPatientDob}
                      onChangeText={setMedicalReportPatientDob}
                      placeholder="MM/DD/YYYY"
                      placeholderTextColor={COLORS.textLight}
                      editable={!sendingMedicalReport}
                    />
                  </View>

                  <Text style={styles.formLabel}>Date of Report</Text>
                  <View style={styles.formInput}>
                    <MaterialCommunityIcons name="calendar-check" size={18} color={COLORS.textLight} />
                    <TextInput
                      style={styles.input}
                      value={medicalReportReportDate}
                      onChangeText={setMedicalReportReportDate}
                      placeholder="MM/DD/YYYY"
                      placeholderTextColor={COLORS.textLight}
                      editable={!sendingMedicalReport}
                    />
                  </View>
                </View>

                <View style={styles.detailsSection}>
                  <Text style={styles.sectionTitle}>Medical History</Text>
                  <TextInput
                    style={[styles.notesInput, { height: Math.max(120, medicalHistoryInputHeight) }]}
                    value={medicalReportMedicalHistory}
                    onChangeText={setMedicalReportMedicalHistory}
                    placeholder="Enter medical history..."
                    placeholderTextColor={COLORS.textLight}
                    multiline
                    editable={!sendingMedicalReport}
                    onContentSizeChange={(e) => {
                      const nextHeight = e?.nativeEvent?.contentSize?.height;
                      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
                        setMedicalHistoryInputHeight(nextHeight + 24);
                      }
                    }}
                  />
                </View>

                <View style={styles.detailsSection}>
                  <Text style={styles.sectionTitle}>Nurse's Notes</Text>
                  <TextInput
                    style={[styles.notesInput, { height: Math.max(120, nurseNotesInputHeight) }]}
                    value={medicalReportNurseNotes}
                    onChangeText={setMedicalReportNurseNotes}
                    placeholder="Enter nurse's notes..."
                    placeholderTextColor={COLORS.textLight}
                    multiline
                    editable={!sendingMedicalReport}
                    onContentSizeChange={(e) => {
                      const nextHeight = e?.nativeEvent?.contentSize?.height;
                      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
                        setNurseNotesInputHeight(nextHeight + 24);
                      }
                    }}
                  />
                </View>

                <View style={styles.detailsSection}>
                  <Text style={styles.sectionTitle}>Recommendations</Text>
                  <TextInput
                    style={[styles.notesInput, { height: Math.max(100, recommendationsInputHeight) }]}
                    value={medicalReportRecommendations}
                    onChangeText={setMedicalReportRecommendations}
                    placeholder="Enter recommendations..."
                    placeholderTextColor={COLORS.textLight}
                    multiline
                    editable={!sendingMedicalReport}
                    onContentSizeChange={(e) => {
                      const nextHeight = e?.nativeEvent?.contentSize?.height;
                      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
                        setRecommendationsInputHeight(nextHeight + 24);
                      }
                    }}
                  />
                </View>

                <View style={styles.detailsSection}>
                  <Text style={styles.sectionTitle}>Nurse Signature</Text>
                  <TextInput
                    style={[styles.notesInput, styles.signatureInput]}
                    value={medicalReportNurseSignature}
                    onChangeText={setMedicalReportNurseSignature}
                    placeholder="Enter nurse's name/signature..."
                    placeholderTextColor={COLORS.textLight}
                    editable={!sendingMedicalReport}
                  />
                </View>

                {/* Medical Notes */}
                <View style={styles.detailsSection}>
                  {(() => {
                  const req = selectedMedicalReportRequest || {};
                  const patientId = req.patientId || req.patientAuthUid || null;
                  const patientEmailLower = String(req.patientEmail || req.email || '').trim().toLowerCase();

                  const normalizeId = (value) => {
                    if (value === null || value === undefined) return null;
                    const str = String(value).trim();
                    return str ? str : null;
                  };

                  const normalizeEmailLower = (value) => {
                    if (value === null || value === undefined) return '';
                    const str = String(value).trim().toLowerCase();
                    return str;
                  };

                  const matchesRequest = (apt) => {
                    if (!apt) return false;

                    const idCandidates = [
                      apt?.patientId,
                      apt?.clientId,
                      apt?.userId,
                      apt?.patient?.id,
                      apt?.client?.id,
                      apt?.patient?._id,
                      apt?.client?._id,
                      apt?.patientAuthUid,
                    ]
                      .map(normalizeId)
                      .filter(Boolean);

                    if (patientId) {
                      const pid = normalizeId(patientId);
                      if (pid && idCandidates.includes(pid)) return true;
                    }

                    if (patientEmailLower) {
                      const emailCandidates = [
                        apt?.patientEmail,
                        apt?.clientEmail,
                        apt?.email,
                        apt?.patient?.email,
                        apt?.client?.email,
                      ]
                        .map(normalizeEmailLower)
                        .filter(Boolean);
                      if (emailCandidates.includes(patientEmailLower)) return true;
                    }

                    return false;
                  };

                  const related = (Array.isArray(appointments) ? appointments : []).filter(matchesRequest);

                  const pickFirstText = (values) => {
                    const normalizeVal = (val) => {
                      if (val === null || val === undefined) return '';
                      if (Array.isArray(val)) {
                        const inner = val
                          .map((v) => {
                            if (v === null || v === undefined) return '';
                            if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
                            if (typeof v === 'object') {
                              const candidate = v.text ?? v.body ?? v.note ?? v.value ?? '';
                              return candidate === null || candidate === undefined ? '' : String(candidate).trim();
                            }
                            return '';
                          })
                          .find((t) => Boolean(t));
                        return inner || '';
                      }
                      if (typeof val === 'object') {
                        const candidate = val.text ?? val.body ?? val.note ?? val.value ?? '';
                        return candidate === null || candidate === undefined ? '' : String(candidate).trim();
                      }
                      return String(val).trim();
                    };
                    return (values || []).map(normalizeVal).find((t) => Boolean(t)) || '';
                  };

                  const normalizePhotoUrls = (raw) => {
                    const flatten = (val) => {
                      if (!val) return [];
                      if (Array.isArray(val)) return val.flatMap(flatten);
                      return [val];
                    };

                    const arr = flatten(raw);

                    return arr
                      .map((p) => {
                        if (typeof p === 'string') return p.trim();
                        if (p && typeof p === 'object') {
                          const candidate = p.url || p.uri || p.downloadURL || p.downloadUrl;
                          return candidate ? String(candidate).trim() : '';
                        }
                        return '';
                      })
                      .filter((u) => typeof u === 'string' && u.length > 0)
                      .filter((u) => /^https?:\/\//i.test(u));
                  };

                  const nurseNoteItems = [];
                  const patientNoteItems = [];

                  related.forEach((apt, idx) => {
                    const nurseNotesText = pickFirstText([
                      apt?.nurseNotes,
                      apt?.completionNotes,
                      apt?.lastCompletionNotes,
                    ]);

                    const nursePhotos = normalizePhotoUrls([
                      apt?.notePhotos,
                      apt?.nurseNotePhotos,
                      apt?.completionPhotos,
                      apt?.photoUrls,
                      apt?.photos,
                    ]);

                    if (String(nurseNotesText || '').trim() || nursePhotos.length > 0) {
                      nurseNoteItems.push({
                        id: `nurse-note-${apt?.id || apt?._id || apt?.appointmentId || idx}`,
                        date: apt?.completedAt || apt?.updatedAt || apt?.createdAt || apt?.date || null,
                        title: String(apt?.nurseName || apt?.assignedNurseName || 'Nurse Note').trim() || 'Nurse Note',
                        subtitle: String(apt?.service || apt?.appointmentType || '').trim(),
                        body: String(nurseNotesText || nursePhotos.length ? (nurseNotesText || 'Photos attached.') : '').trim(),
                        photoUrls: nursePhotos,
                      });
                    }

                    const patientBookingNotesText = pickFirstText([
                      apt?.patientNotes,
                      apt?.patientNote,
                      apt?.bookingNotes,
                      apt?.bookingNote,
                      apt?.clientNotes,
                      apt?.specialInstructions,
                      apt?.instructions,
                      apt?.patient?.notes,
                      apt?.client?.notes,
                      apt?.clientSnapshot?.notes,
                      apt?.patientSnapshot?.notes,
                      apt?.clientData?.notes,
                      apt?.patientData?.notes,
                    ]);

                    const legacyNotes = pickFirstText([apt?.notes]);
                    const text = patientBookingNotesText || legacyNotes;

                    const patientPhotos = normalizePhotoUrls([
                      apt?.patientNotePhotos,
                      apt?.bookingNotePhotos,
                      apt?.clientNotePhotos,
                      apt?.photoUrls,
                      apt?.photos,
                    ]);

                    if (String(text || '').trim() || patientPhotos.length > 0) {
                      patientNoteItems.push({
                        id: `patient-note-${apt?.id || apt?._id || apt?.appointmentId || idx}`,
                        date: apt?.createdAt || apt?.updatedAt || apt?.date || apt?.scheduledDate || null,
                        title: String(apt?.patientName || apt?.clientName || req?.patientName || 'Patient').trim() || 'Patient',
                        subtitle: String(apt?.service || apt?.appointmentType || 'From booking').trim(),
                        body: String(text || (patientPhotos.length ? 'Photos attached.' : '')).trim(),
                        photoUrls: patientPhotos,
                      });
                    }
                  });

                  const toEpochMs = (value) => {
                    if (!value) return 0;
                    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
                    if (typeof value === 'object') {
                      if (typeof value.toDate === 'function') {
                        const d = value.toDate();
                        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
                      }
                      const seconds = typeof value.seconds === 'number' ? value.seconds : typeof value._seconds === 'number' ? value._seconds : null;
                      if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
                    }
                    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
                    const parsed = Date.parse(String(value));
                    return Number.isFinite(parsed) ? parsed : 0;
                  };

                  const allNoteItems = [...nurseNoteItems, ...patientNoteItems].sort((a, b) => toEpochMs(b?.date) - toEpochMs(a?.date));

                  return (
                    <>
                      <Text style={styles.sectionTitle}>Medical Notes ({allNoteItems.length})</Text>
                      <NotesAccordionList
                        items={allNoteItems}
                        emptyText="No medical notes available yet"
                        showTime
                        onPhotoPress={openNotePhotoPreview}
                      />
                    </>
                  );
                  })()}
                </View>
              </ScrollView>

              <View
                style={[
                  styles.modalFooter,
                  styles.modalFooterSingle,
                  { position: 'absolute', left: 0, right: 0, bottom: 0 },
                ]}
              >
                <TouchableWeb
                  style={[styles.modalAssignButton, (!selectedMedicalReportRequest || sendingMedicalReport) && styles.buttonDisabled]}
                  onPress={openMedicalReportGenerateModal}
                  disabled={!selectedMedicalReportRequest || sendingMedicalReport}
                >
                  <LinearGradient
                    colors={GRADIENTS.header}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.modalAssignButtonGradient}
                  >
                    <Text style={styles.modalAssignButtonText}>Generate</Text>
                  </LinearGradient>
                </TouchableWeb>
              </View>
            </KeyboardAvoidingView>
            </View>
          </View>
      </Modal>

      {/* Medical Report Preview (invoice-style) */}
      <Modal
        visible={medicalReportPreviewVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={closeMedicalReportPreviewModal}
      >
        <SafeAreaView style={styles.reportModalContainer} edges={['bottom']}>
          <Image
            source={require('../assets/Images/Nurses-logo.png')}
            style={styles.watermarkLogo}
            resizeMode="contain"
            pointerEvents="none"
            accessible={false}
          />
          <LinearGradient
            colors={GRADIENTS.header}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.reportModalHeader, { paddingTop: insets.top + 20 }]}
          >
            <View style={styles.reportHeaderRow}>
              <View style={{ width: 44, height: 44 }} />
              <Text style={styles.reportHeaderTitle} numberOfLines={1}>Report Preview</Text>
              <TouchableWeb
                onPress={closeMedicalReportPreviewModal}
                style={styles.iconButton}
                disabled={sendingMedicalReport}
              >
                <MaterialCommunityIcons name="close" size={26} color={COLORS.white} />
              </TouchableWeb>
            </View>
          </LinearGradient>

          <ScrollView
            style={{ flex: 1, backgroundColor: '#F3F4F6' }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 160 }}
          >
            <View style={styles.reportDocCard}>
              <View style={styles.reportDocHeader}>
                <Image
                  source={require('../assets/Images/Nurses-logo.png')}
                  style={styles.reportLogo}
                  resizeMode="contain"
                />
                <Text style={styles.reportDocTitle}>Medical Reports of Patients</Text>
                <View style={styles.reportDocLine} />
              </View>

              <Text style={styles.reportSectionTitle}>Patient Information:</Text>
              <View style={styles.reportRow}>
                <Text style={styles.reportLabel}>Name:</Text>
                <Text style={styles.reportValue}>{medicalReportPatientName || 'N/A'}</Text>
              </View>
              <View style={styles.reportRow}>
                <Text style={styles.reportLabel}>Date of Birth:</Text>
                <Text style={styles.reportValue}>{medicalReportPatientDob || 'N/A'}</Text>
              </View>
              <View style={styles.reportRow}>
                <Text style={styles.reportLabel}>Date of Report:</Text>
                <Text style={styles.reportValue}>{medicalReportReportDate || 'N/A'}</Text>
              </View>

              {medicalReportAllergies && (
                <>
                  <View style={styles.reportSpacer} />
                  <Text style={styles.reportSectionTitle}>Allergies:</Text>
                  <View style={styles.reportNotesBox}>
                    <Text style={styles.reportNotesText}>{medicalReportAllergies}</Text>
                  </View>
                </>
              )}

              {medicalReportVitals && (
                <>
                  <Text style={styles.reportSectionTitle}>Recent Vitals:</Text>
                  <View style={styles.reportNotesBox}>
                    <Text style={styles.reportNotesText}>{medicalReportVitals}</Text>
                  </View>
                </>
              )}

              <View style={styles.reportSpacer} />
              <Text style={styles.reportSectionTitle}>Medical History:</Text>
              <View style={styles.reportNotesBox}>
                <Text style={styles.reportNotesText}>{medicalReportMedicalHistory || 'N/A'}</Text>
              </View>

              <View style={styles.reportSpacer} />
              <Text style={styles.reportSectionTitle}>Nurse's Notes:</Text>
              <View style={styles.reportNotesBox}>
                <Text style={styles.reportNotesText}>{medicalReportNurseNotes || 'N/A'}</Text>
              </View>

              <Text style={styles.reportSectionTitle}>Recommendations:</Text>
              <View style={styles.reportNotesBox}>
                <Text style={styles.reportNotesText}>{medicalReportRecommendations || 'N/A'}</Text>
              </View>

              <View style={{ marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#E0E0E0' }}>
                <Text style={styles.reportNotesText}>
                  <Text style={{ fontWeight: '600' }}>Prepared by:</Text> {medicalReportNurseSignature || 'N/A'}
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.reportModalFooter}>
            <TouchableWeb
              style={styles.modalDenyButton}
              onPress={closeMedicalReportPreviewModal}
              disabled={sendingMedicalReport}
            >
              <Text style={styles.modalDenyButtonText}>Back</Text>
            </TouchableWeb>

            <TouchableWeb
              style={[styles.modalAssignButton, sendingMedicalReport && styles.buttonDisabled]}
              onPress={sendMedicalReportEmailAndComplete}
              disabled={sendingMedicalReport}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.modalAssignButtonGradient}
              >
                <Text style={styles.modalAssignButtonText}>{sendingMedicalReport ? 'Sending…' : 'Send'}</Text>
              </LinearGradient>
            </TouchableWeb>
          </View>
        </SafeAreaView>
      </Modal>



      {/* Create Nurse Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={createNurseModalVisible}
        onRequestClose={() => setCreateNurseModalVisible(false)}
      >
        <TouchableWeb 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setCreateNurseModalVisible(false)}
        >
          <TouchableWeb activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Staff</Text>
              <TouchableWeb onPress={() => setCreateNurseModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.createNurseForm}>
              {/* Role Selection and Code Generation - Horizontal Layout */}
              <Text style={styles.formLabel}>Staff Type & Code Generation</Text>
              <View style={styles.horizontalBoxContainer}>
                {/* Box 1: Role Selection Dropdown */}
                <View style={styles.staffBox}>
                  <Text style={styles.boxLabel}>Select Role</Text>
                  <View style={styles.roleSelector}>
                    <TouchableWeb
                      style={[
                        styles.roleOption,
                        staffRole === 'nurse' && styles.roleOptionSelected
                      ]}
                      onPress={() => {
                        // Nurse role button pressed
                        setStaffRole('nurse');
                      }}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons 
                        name="hospital-box" 
                        size={20} 
                        color={staffRole === 'nurse' ? COLORS.primary : COLORS.textLight} 
                      />
                      <Text style={[
                        styles.roleOptionText,
                        staffRole === 'nurse' && styles.roleOptionTextSelected
                      ]}>Nurse</Text>
                    </TouchableWeb>

                    <TouchableWeb
                      style={[
                        styles.roleOption,
                        staffRole === 'admin' && styles.roleOptionSelected
                      ]}
                      onPress={() => {
                        // Admin role button pressed
                        setStaffRole('admin');
                      }}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons 
                        name="shield-account" 
                        size={20} 
                        color={staffRole === 'admin' ? COLORS.primary : COLORS.textLight} 
                      />
                      <Text style={[
                        styles.roleOptionText,
                        staffRole === 'admin' && styles.roleOptionTextSelected
                      ]}>Admin</Text>
                    </TouchableWeb>
                  </View>
                </View>

                {/* Box 2: Auto-Generated Code Display */}
                <View style={styles.staffBox}>
                  <Text style={styles.boxLabel}>Auto-Generated Code</Text>
                  <View style={styles.codeGenerationContainer}>
                    <View style={styles.sequenceInfo}>
                      <MaterialCommunityIcons 
                        name="identifier" 
                        size={16} 
                        color={COLORS.primary} 
                      />
                      <Text style={styles.sequenceText}>
                        Code: {nurseCode ? nurseCode : `${staffRole === 'admin' ? 
                          `ADMIN${adminSequence.toString().padStart(3, '0')}` : 
                          `NURSE${nurseSequence.toString().padStart(3, '0')}`
                        }`}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <Text style={styles.formLabel}>Full Name</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="account" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder={staffRole === 'nurse' ? "e.g., Sarah Johnson, RN" : "e.g., John Doe"}
                  placeholderTextColor={COLORS.textLight}
                  value={nurseName}
                  onChangeText={setNurseName}
                />
              </View>

              <Text style={styles.formLabel}>Email</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="email" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="johndoe@nurse.com"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseEmail}
                  onChangeText={setNurseEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <Text style={styles.formLabel}>Phone Number</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="phone" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="876-555-0123"
                  placeholderTextColor={COLORS.textLight}
                  value={nursePhone}
                  onChangeText={setNursePhone}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Specialization Field */}
              {staffRole === 'nurse' && (
                <>
                  <Text style={styles.formLabel}>Specialization</Text>
                  <View style={styles.formInput}>
                    <MaterialCommunityIcons name="hospital-box" size={20} color={COLORS.textLight} />
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., General Nursing, Pediatrics, Geriatrics"
                      placeholderTextColor={COLORS.textLight}
                      value={nurseSpecialization}
                      onChangeText={setNurseSpecialization}
                    />
                  </View>
                </>
              )}

              {/* Emergency Contact Section */}
              <Text style={styles.sectionTitle}>Emergency Contact</Text>
              
              <Text style={styles.formLabel}>Emergency Contact Name</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="contacts" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Jane Doe"
                  placeholderTextColor={COLORS.textLight}
                  value={emergencyContact}
                  onChangeText={setEmergencyContact}
                />
              </View>

              <Text style={styles.formLabel}>Emergency Contact Phone</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="phone-urgent" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="876-555-9999"
                  placeholderTextColor={COLORS.textLight}
                  value={emergencyPhone}
                  onChangeText={setEmergencyPhone}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Nurse ID Photo Upload Section */}
              <Text style={styles.sectionTitle}>Nurse ID Photo</Text>
              <Text style={styles.formLabel}>Upload Nurse ID Photo</Text>
              <View style={styles.photoUploadContainer}>
                {!nurseIdPhoto ? (
                  <TouchableWeb style={styles.photoUploadButton} onPress={pickNurseIdPhoto}>
                    <MaterialCommunityIcons name="camera-plus" size={32} color={COLORS.primary} />
                    <Text style={styles.photoUploadText}>Tap to upload nurse ID photo</Text>
                    <Text style={styles.photoUploadSubtext}>Required for staff identification</Text>
                  </TouchableWeb>
                ) : (
                  <View style={styles.photoPreviewContainer}>
                    <Image source={{ uri: nurseIdPhoto.uri }} style={styles.photoPreview} />
                    <View style={styles.photoActions}>
                      <TouchableWeb style={styles.changePhotoButton} onPress={pickNurseIdPhoto}>
                        <MaterialCommunityIcons name="camera" size={16} color={COLORS.white} />
                        <Text style={styles.changePhotoText}>Change Photo</Text>
                      </TouchableWeb>
                      <TouchableWeb style={styles.removePhotoButton} onPress={removeNurseIdPhoto}>
                        <MaterialCommunityIcons name="trash-can" size={16} color={COLORS.white} />
                        <Text style={styles.removePhotoText}>Remove</Text>
                      </TouchableWeb>
                    </View>
                  </View>
                )}
              </View>

              {/* Banking Details Section */}
              <Text style={styles.sectionTitle}>Banking Details</Text>

              <Text style={styles.formLabel}>Bank Name</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="bank" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g., National Commercial Bank"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseBankName}
                  onChangeText={setNurseBankName}
                />
              </View>

              <Text style={styles.formLabel}>Account Number</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="numeric" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="Account number"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseAccountNumber}
                  onChangeText={setNurseAccountNumber}
                  keyboardType="number-pad"
                />
              </View>

              <Text style={styles.formLabel}>Account Holder Name</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="account" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name on account"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseAccountHolderName}
                  onChangeText={setNurseAccountHolderName}
                />
              </View>

              <Text style={styles.formLabel}>Bank Branch</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Downtown Branch"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseBankBranch}
                  onChangeText={setNurseBankBranch}
                />
              </View>

              {/* Generated Code Display */}
              {nurseCode && (
                <>
                  <Text style={styles.formLabel}>Generated {staffRole === 'admin' ? 'Admin' : 'Nurse'} Code</Text>
                  <View style={styles.generatedCodeDisplay}>
                    <MaterialCommunityIcons name="key-variant" size={20} color={COLORS.primary} />
                    <Text style={styles.generatedCodeText}>{nurseCode}</Text>
                    <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.success} />
                  </View>
                </>
              )}

              <TouchableWeb
                style={styles.createButton}
                onPress={handleCreateNurse}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={GRADIENTS.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.createButtonGradient}
                >
                  <MaterialCommunityIcons name="account-plus" size={20} color={COLORS.white} />
                  <Text style={styles.createButtonText}>Create {staffRole === 'admin' ? 'Admin' : 'Nurse'}</Text>
                </LinearGradient>
              </TouchableWeb>
            </ScrollView>
          </View>
        </TouchableWeb>
        </TouchableWeb>
      </Modal>


      {/* Old Recurring Schedule Modal - Replaced with AdminRecurringShiftModal (see bottom of file) */}

      {/* Assign Nurse Modal - Real Implementation Below */}
      {false && (
      <Modal
        animationType="slide"
        transparent={true}
        visible={false}
        onRequestClose={() => {}}
      >
      </Modal>
      )}

      {/* Assign Nurse Modal - REAL (styled like other nurse selection modals) */}
      <Modal
        animationType="slide"
        visible={assignModalVisible}
        transparent={true}
        onRequestClose={() => {
          setAssignModalVisible(false);
          setAssignNurseSearch('');
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: SPACING.lg,
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{
              backgroundColor: COLORS.white,
              borderRadius: 20,
              width: '100%',
              maxWidth: 500,
              maxHeight: '80%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 10,
              overflow: 'hidden',
            }}
          >
            <View style={styles.detailsModalHeader}>
              <Text style={styles.detailsModalTitle}>
                Assign Nurse - {selectedAppointment?.patientName}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setAssignModalVisible(false);
                  setAssignNurseSearch('');
                }}
                style={{ padding: 4 }}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View
              style={{
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.border,
              }}
            >
              <View style={[styles.inputContainer, { marginBottom: 0 }]}>
                <TextInput
                  placeholder="Search nurse name or code..."
                  style={styles.input}
                  value={assignNurseSearch}
                  onChangeText={setAssignNurseSearch}
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.sectionTitle, { marginBottom: 12, paddingHorizontal: 4 }]}>
                Available Nurses
              </Text>

              {availableNurses
                .filter((nurse) => nurse?.status === 'available')
                .filter((nurse) => {
                  const search = String(assignNurseSearch || '').toLowerCase();
                  if (!search) return true;
                  const name = String(nurse.name || nurse.fullName || '').toLowerCase();
                  const code = String(nurse.code || nurse.nurseCode || nurse.staffCode || '').toLowerCase();
                  return name.includes(search) || code.includes(search);
                })
                .map((nurse) => {
                  const key = nurse.id || nurse._id || nurse.uid || nurse.nurseId;
                  return (
                    <View key={String(key)} style={styles.primaryNurseCard}>
                      {nurse.profilePhoto || nurse.profileImage || nurse.photoUrl ? (
                        <Image
                          source={{ uri: nurse.profilePhoto || nurse.profileImage || nurse.photoUrl }}
                          style={styles.primaryNurseAvatar}
                        />
                      ) : (
                        <View style={[styles.primaryNurseAvatar, styles.primaryNurseAvatarFallback]}>
                          <MaterialCommunityIcons name="account-heart" size={24} color={COLORS.white} />
                        </View>
                      )}

                      <View style={styles.primaryNurseInfo}>
                        <Text style={styles.primaryNurseName} numberOfLines={1}>
                          {nurse.name || nurse.fullName}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.primaryNurseSelectButton}
                        onPress={() => {
                          const nurseDetails =
                            nurses.find(
                              (n) =>
                                n.id === nurse.id ||
                                n._id === nurse.id ||
                                n.id === nurse._id ||
                                n._id === nurse._id
                            ) || nurse;

                          setNurseSelectionMode('assign');
                          setAssignModalVisible(false);
                          setTimeout(() => {
                            openNurseDetailsModal(nurseDetails);
                          }, 250);
                        }}
                      >
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.primaryNurseSelectGradient}
                        >
                          <Text style={styles.primaryNurseSelectText}>View</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  );
                })}

              <View style={{ height: 20 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Appointment Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        presentationStyle="overFullScreen"
        visible={appointmentDetailsModalVisible}
        onRequestClose={() => {
          setAppointmentDetailsModalVisible(false);
          setAppointmentClockDetailsVisible(false);
          closeNotePhotoPreview();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {(() => {
                  const d = selectedAppointmentDetails || {};
                  const isShiftRequest = Boolean(d.isShiftRequest || d.isShift || d?.shiftRequest);
                  const isRecurring = Boolean(d.isRecurring || d.recurringPattern || d.frequency);
                  if (isRecurring) return 'Recurring Shift Details';
                  return isShiftRequest ? 'Shift Request Details' : 'Appointment Details';
                })()}
              </Text>
              <TouchableWeb
                onPress={() => {
                  setAppointmentDetailsModalVisible(false);
                  setAppointmentClockDetailsVisible(false);
                  closeNotePhotoPreview();
                }}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            {notePhotoPreviewVisible && (
              <View style={styles.notePhotoPreviewOverlayInModal}>
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.notePhotoPreviewOverlayTapArea}
                  onPress={closeNotePhotoPreview}
                >
                  <TouchableOpacity
                    activeOpacity={1}
                    style={styles.notePhotoPreviewImageFrame}
                    onPress={() => {}}
                  >
                    {notePhotoPreviewUri ? (
                      <Image
                        source={{ uri: notePhotoPreviewUri }}
                        style={styles.notePhotoPreviewImage}
                        resizeMode="contain"
                      />
                    ) : null}
                  </TouchableOpacity>
                </TouchableOpacity>
              </View>
            )}
            
            {selectedAppointmentDetails && (
              <>
                <ScrollView
                  contentContainerStyle={styles.appointmentDetailsContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Patient Alerts Banner */}
                  {(() => {
                    const status = selectedAppointmentDetails?.status;
                    // Show alerts for all appointments except completed/cancelled
                    const shouldShowAlerts = status && !['completed', 'cancelled', 'canceled', 'declined', 'rejected'].includes(status.toLowerCase());
                    if (!shouldShowAlerts) return null;

                    let patientAlerts = selectedAppointmentDetails?.patientAlerts ||
                      selectedAppointmentDetails?.clinicalInfo ||
                      selectedAppointmentDetails?.appointmentDetails?.patientAlerts;

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

                  {/* Client Information (Moved to Top & Renamed) */}
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Client Information</Text>
                    {(() => {
                      const getVal = (v) => {
                        if (!v) return null;
                        const s = String(v).trim();
                        if (!s) return null;
                        const invalid = ['na', 'n/a', 'none', 'null', 'undefined'];
                        if (invalid.includes(s.toLowerCase())) return null;
                        return s;
                      };
                      const clientId = selectedAppointmentDetails.patientId || selectedAppointmentDetails.clientId || selectedAppointmentDetails.client?.id;
                      const matchedClient = (() => {
                        if (!clientId) return null;
                        const key = String(clientId).trim();
                        if (!key || !(clientsById instanceof Map)) return null;
                        return clientsById.get(key) || null;
                      })();
                      const clientName = getVal(matchedClient?.name) ||
                        getVal(selectedAppointmentDetails.patientName) ||
                        getVal(selectedAppointmentDetails.clientName) ||
                        getVal(selectedAppointmentDetails.name) ||
                        (selectedAppointmentDetails.patient?.firstName
                          ? `${selectedAppointmentDetails.patient.firstName} ${selectedAppointmentDetails.patient.lastName || ''}`
                          : null) ||
                        'N/A';
                      const clientEmail = getVal(matchedClient?.email) ||
                        getVal(selectedAppointmentDetails.patientEmail) ||
                        getVal(selectedAppointmentDetails.clientEmail) ||
                        getVal(selectedAppointmentDetails.email) ||
                        getVal(selectedAppointmentDetails.patient?.email) ||
                        getVal(selectedAppointmentDetails.clientSnapshot?.email) ||
                        getVal(selectedAppointmentDetails.patientSnapshot?.email) ||
                        getVal(selectedAppointmentDetails.clientSnapshot?.contactEmail) ||
                        getVal(selectedAppointmentDetails.patientSnapshot?.contactEmail) ||
                        getVal(selectedAppointmentDetails.clientData?.email) ||
                        getVal(selectedAppointmentDetails.clientData?.contactEmail) ||
                        getVal(selectedAppointmentDetails.contactData?.email) ||
                        getVal(selectedAppointmentDetails.contactData?.contactEmail) ||
                        'N/A';
                      const clientPhone = getVal(matchedClient?.phone) ||
                        getVal(selectedAppointmentDetails.patientPhone) ||
                        getVal(selectedAppointmentDetails.clientPhone) ||
                        getVal(selectedAppointmentDetails.phone) ||
                        getVal(selectedAppointmentDetails.patient?.phone) ||
                        getVal(selectedAppointmentDetails.clientSnapshot?.phone) ||
                        getVal(selectedAppointmentDetails.patientSnapshot?.phone) ||
                        getVal(selectedAppointmentDetails.clientSnapshot?.phoneNumber) ||
                        getVal(selectedAppointmentDetails.patientSnapshot?.phoneNumber) ||
                        getVal(selectedAppointmentDetails.patientSnapshot?.contactNumber) ||
                        getVal(selectedAppointmentDetails.clientSnapshot?.contactNumber) ||
                        getVal(selectedAppointmentDetails.clientData?.phone) ||
                        getVal(selectedAppointmentDetails.clientData?.contactNumber) ||
                        getVal(selectedAppointmentDetails.clientData?.phoneNumber) ||
                        getVal(selectedAppointmentDetails.contactData?.phone) ||
                        getVal(selectedAppointmentDetails.contactData?.contactNumber) ||
                        getVal(selectedAppointmentDetails.contactData?.phoneNumber) ||
                        'N/A';
                      const resolveAddressDisplay = (value) => {
                        if (!value) return null;
                        if (typeof value === 'string') {
                          const trimmed = value.trim();
                          return trimmed.length ? trimmed : null;
                        }

                        const formatted = formatLocationAddress(value);
                        if (formatted) return formatted;

                        if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number') {
                          return `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`;
                        }

                        return null;
                      };

                      const clientAddress = (() => {
                        const candidates = [
                          matchedClient?.address,
                          selectedAppointmentDetails.clientSnapshot?.address,
                          selectedAppointmentDetails.patientSnapshot?.address,
                          selectedAppointmentDetails.clientSnapshot?.location,
                          selectedAppointmentDetails.patientSnapshot?.location,
                          selectedAppointmentDetails.clientData?.address,
                          selectedAppointmentDetails.clientData?.location,
                          selectedAppointmentDetails.contactData?.address,
                          selectedAppointmentDetails.contactData?.location,
                          selectedAppointmentDetails.clientAddress,
                          selectedAppointmentDetails.patientAddress,
                          selectedAppointmentDetails.address,
                          selectedAppointmentDetails.location?.address,
                          selectedAppointmentDetails.location,
                        ];

                        for (const candidate of candidates) {
                          const resolved = resolveAddressDisplay(candidate);
                          if (resolved) return resolved;
                        }

                        return null;
                      })() || 'N/A';

                      return (
                        <>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Name</Text>
                              <Text style={styles.detailValue}>{clientName}</Text>
                            </View>
                          </View>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Email</Text>
                              <Text style={styles.detailValue}>{clientEmail}</Text>
                            </View>
                          </View>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Phone</Text>
                              <Text style={styles.detailValue}>{clientPhone}</Text>
                            </View>
                          </View>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Address</Text>
                              <Text style={styles.detailValue}>{clientAddress}</Text>
                            </View>
                          </View>
                        </>
                      );
                    })()}
                  </View>

                  {/* Service Information */}
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Service Information</Text>

                    {(() => {
                      const d = selectedAppointmentDetails || {};

                      const serviceName =
                        d.service ||
                        d.appointmentType ||
                        d.serviceType ||
                        d.serviceName ||
                        'General Care';

                      // Resolve actual assigned nurse using roster and fresh map
                      const assignedId =
                        d.nurseId ||
                        d.assignedNurseId ||
                        d.assignedNurse?.id ||
                        d.assignedNurse?._id ||
                        d.nurse?.id ||
                        d.nurse?._id ||
                        null;

                      const assignedCode =
                        d.nurseCode ||
                        d.staffCode ||
                        d.assignedNurse?.nurseCode ||
                        d.assignedNurse?.staffCode ||
                        d.nurse?.nurseCode ||
                        d.nurse?.staffCode ||
                        null;

                      const coverageRequests = Array.isArray(d.coverageRequests)
                        ? d.coverageRequests
                        : Array.isArray(d.shift?.coverageRequests)
                          ? d.shift.coverageRequests
                          : Array.isArray(d.shiftDetails?.coverageRequests)
                            ? d.shiftDetails.coverageRequests
                            : (Array.isArray(d.recurringSchedule?.coverageRequests)
                              ? d.recurringSchedule.coverageRequests
                              : []);

                      const acceptedCoverage = coverageRequests.find((entry) => {
                        if (!entry) return false;
                        const status = normalizeStatus(entry?.status);
                        return status === 'accepted';
                      }) || null;

                      const coverageRequestingNurse = acceptedCoverage?.requestingNurse || null;
                      const coverageRequestingNurseId =
                        acceptedCoverage?.requestingNurseId ||
                        acceptedCoverage?.requestedByNurseId ||
                        coverageRequestingNurse?.id ||
                        coverageRequestingNurse?._id ||
                        coverageRequestingNurse?.nurseId ||
                        coverageRequestingNurse?.uid ||
                        null;

                      const coverageRequestingNurseName =
                        acceptedCoverage?.requestingNurseName ||
                        acceptedCoverage?.requestedByNurseName ||
                        coverageRequestingNurse?.fullName ||
                        coverageRequestingNurse?.name ||
                        coverageRequestingNurse?.nurseName ||
                        null;

                      const coverageRequestingNurseCode =
                        acceptedCoverage?.requestingNurseCode ||
                        acceptedCoverage?.requestingNurseStaffCode ||
                        coverageRequestingNurse?.nurseCode ||
                        coverageRequestingNurse?.staffCode ||
                        coverageRequestingNurse?.code ||
                        null;

                      const coverageRequestingNursePhoto =
                        coverageRequestingNurse?.profilePhoto ||
                        coverageRequestingNurse?.photoUrl ||
                        coverageRequestingNurse?.nurseIdPhoto ||
                        null;

                      const resolvedAssignedNurseId = coverageRequestingNurseId || assignedId;
                      const resolvedAssignedNurseCode = coverageRequestingNurseCode || assignedCode;

                      const rosterNurse = (() => {
                        if (!Array.isArray(nurses)) return null;
                        const wantId = resolvedAssignedNurseId ? String(resolvedAssignedNurseId).trim() : null;
                        const wantCode = resolvedAssignedNurseCode ? String(resolvedAssignedNurseCode).trim().toUpperCase() : null;
                        return nurses.find((n) => {
                          const nId = String(n?.id || n?._id || n?.uid || n?.nurseId || '').trim();
                          const nCode = String(n?.nurseCode || n?.staffCode || n?.code || '').trim().toUpperCase();
                          if (wantId && nId && nId === wantId) return true;
                          if (wantCode && nCode && nCode === wantCode) return true;
                          return false;
                        }) || null;
                      })();

                      const freshMapKey = resolvedAssignedNurseId || assignedId;
                      const freshMapNurse = freshMapKey && freshNurseDataMap instanceof Map ? (freshNurseDataMap.get(freshMapKey) || null) : null;

                      const nurseDisplayName =
                        coverageRequestingNurseName ||
                        freshMapNurse?.fullName ||
                        freshMapNurse?.name ||
                        rosterNurse?.fullName ||
                        rosterNurse?.name ||
                        d.assignedNurseName ||
                        d.nurseName ||
                        (typeof d.assignedNurse === 'object' ? formatNurseName(d.assignedNurse) : null) ||
                        (typeof d.nurse === 'object' ? formatNurseName(d.nurse) : null) ||
                        'Assigned Nurse';

                      const nursePhoto =
                        coverageRequestingNursePhoto ||
                        freshMapNurse?.profilePhoto ||
                        freshMapNurse?.photoUrl ||
                        rosterNurse?.profilePhoto ||
                        rosterNurse?.photoUrl ||
                        d.assignedNurse?.profilePhoto ||
                        d.nurse?.profilePhoto ||
                        d.assignedNurse?.photoUrl ||
                        d.nurse?.photoUrl ||
                        d.nurseIdPhoto ||
                        d.nursePhoto ||
                        null;

                      const nurseSpecialty =
                        freshMapNurse?.specialization ||
                        rosterNurse?.specialization ||
                        d.assignedNurse?.specialization ||
                        d.nurse?.specialization ||
                        d.assignedNurse?.specialty ||
                        d.nurse?.specialty ||
                        'General Nursing';

                      const nurseCode =
                        coverageRequestingNurseCode ||
                        freshMapNurse?.nurseCode ||
                        freshMapNurse?.code ||
                        rosterNurse?.nurseCode ||
                        rosterNurse?.staffCode ||
                        d.assignedNurse?.nurseCode ||
                        d.assignedNurse?.staffCode ||
                        d.nurse?.nurseCode ||
                        d.nurse?.staffCode ||
                        d.nurseCode ||
                        d.staffCode ||
                        null;

                      const appointmentDateLabel = (() => {
                        const raw =
                          d.date ||
                          d.startDate ||
                          d.scheduledDate ||
                          d.appointmentDate ||
                          d.shiftDate ||
                          d.preferredDate ||
                          d.requestedDate ||
                          null;
                        const formatted = formatFriendlyDate(raw);
                        if (formatted) return formatted;
                        if (typeof raw === 'string') {
                          const trimmed = raw.trim();
                          if (trimmed.length) return trimmed;
                        }
                        return 'N/A';
                      })();

                      const endDateLabel = (() => {
                        const raw =
                          d.endDate ||
                          d.scheduledEndDate ||
                          d.shiftEndDate ||
                          d.completionDate ||
                          null;
                        const formatted = formatFriendlyDate(raw);
                        if (formatted) return formatted;
                        return appointmentDateLabel || 'N/A';
                      })();

                      const actualStartTime = d.actualStartTime || d.clockInTime || d.startedAt;
                      const actualEndTime = d.actualEndTime || d.clockOutTime || d.completedAt;
                      const scheduledStart = d.startTime || d.preferredTime || d.time || d.scheduledTime;
                      const scheduledEnd = d.endTime || d.preferredEndTime || d.scheduledEndTime;

                      const resolveTime = (value) => {
                        if (!value) return 'N/A';
                        const formatted = formatFriendlyTime(value);
                        return formatted || 'N/A';
                      };

                      // For Service Information, always prioritize the scheduled service time.
                      // Actual clock-in/clock-out times are shown separately in the Clock Details modal.
                      const startTimeLabel = resolveTime(scheduledStart || actualStartTime);
                      const endTimeLabel = resolveTime(scheduledEnd || actualEndTime);
                      // For regular appointments, show only the requested/scheduled time (no range).
                      const requestedTimeLabel = resolveTime(scheduledStart);

                      // Determine clock-in status for chip styling and action
                      const nurseKeyForClock = resolvedAssignedNurseId || (nurseCode ? String(nurseCode).trim() : null);
                      const clockEntryForAssigned = nurseKeyForClock
                        ? getClockEntryByNurse(d, nurseKeyForClock, rosterNurse || freshMapNurse || {}, { includeRecordFallbackKeys: false })
                        : null;
                      const hasClockIn = Boolean(
                        clockEntryForAssigned?.lastClockInTime ||
                        clockEntryForAssigned?.actualStartTime ||
                        clockEntryForAssigned?.clockInTime ||
                        clockEntryForAssigned?.startedAt
                      );
                      const hasClockOut = Boolean(
                        clockEntryForAssigned?.lastClockOutTime ||
                        clockEntryForAssigned?.actualEndTime ||
                        clockEntryForAssigned?.clockOutTime
                      );

                      const durationValue =
                        d.estimatedDuration || d.duration || d.serviceDuration || d.estimatedMinutes || null;

                      const formattedDuration = (() => {
                        if (!durationValue) return null;
                        const minutes = Number(durationValue);
                        if (minutes) {
                          const hours = Math.floor(minutes / 60);
                          const mins = minutes % 60;
                          return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                        }
                        return String(durationValue);
                      })();

                      const isShiftLikeAppointment = Boolean(
                        d.isRecurring ||
                        d.recurringScheduleId ||
                        d.recurringSchedule ||
                        d.shiftId ||
                        d.shiftDetails ||
                        d.clockByNurse ||
                        d.nurseSchedule ||
                        (Array.isArray(d.splitNurseServices) && d.splitNurseServices.length > 0)
                      );

                      // Regular appointments: show compact rows (no shift-style card)
                      if (!isShiftLikeAppointment) {
                        const servicesLabel = Array.isArray(d.services) && d.services.length
                          ? d.services.map((s) => (s?.name || s)).join(', ')
                          : serviceName;

                        return (
                          <>
                            <View style={styles.detailItem}>
                              <MaterialCommunityIcons name="medical-bag" size={20} color={COLORS.primary} />
                              <View style={styles.detailContent}>
                                <Text style={styles.detailLabel}>Service</Text>
                                <Text style={styles.detailValue}>{servicesLabel || 'General Care'}</Text>
                              </View>
                            </View>
                            <View style={styles.detailItem}>
                              <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                              <View style={styles.detailContent}>
                                <Text style={styles.detailLabel}>Date</Text>
                                <Text style={styles.detailValue}>{appointmentDateLabel}</Text>
                              </View>
                            </View>
                            <View style={styles.detailItem}>
                              <MaterialCommunityIcons name="clock-outline" size={20} color={COLORS.primary} />
                              <View style={styles.detailContent}>
                                <Text style={styles.detailLabel}>Time</Text>
                                <Text style={styles.detailValue}>{requestedTimeLabel || 'N/A'}</Text>
                              </View>
                            </View>
                            {formattedDuration ? (
                              <View style={styles.detailItem}>
                                <MaterialCommunityIcons name="timer-outline" size={20} color={COLORS.primary} />
                                <View style={styles.detailContent}>
                                  <Text style={styles.detailLabel}>Duration</Text>
                                  <Text style={styles.detailValue}>{formattedDuration}</Text>
                                </View>
                              </View>
                            ) : null}
                          </>
                        );
                      }

                      return (
                        <View style={styles.shiftCard}>
                          <View style={styles.shiftCardHeader}>
                            {nursePhoto ? (
                              <Image source={{ uri: nursePhoto }} style={styles.shiftAvatar} resizeMode="cover" />
                            ) : (
                              <View style={styles.shiftAvatarFallback}>
                                <MaterialCommunityIcons name="account" size={30} color={COLORS.primary} />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.shiftNurseName}>{nurseDisplayName}</Text>
                              <Text style={styles.shiftNurseMeta}>{nurseSpecialty}</Text>
                              {nurseCode ? <Text style={styles.shiftNurseCode}>{nurseCode}</Text> : null}
                            </View>
                            <TouchableWeb
                              style={styles.shiftStatusChip}
                              onPress={() => {
                                const nurseForDetails = rosterNurse || freshMapNurse || d.assignedNurse || d.nurse || {
                                  fullName: nurseDisplayName,
                                  name: nurseDisplayName,
                                  nurseCode,
                                  staffCode: nurseCode,
                                };
                                // In admin completed modal, still show clock details when any clock activity exists
                                if (hasClockIn || hasClockOut) {
                                  const payload = extractClockDetailsFromRecord(clockEntryForAssigned);
                                  if (payload) {
                                    openClockDetailsModal('Clock Details', payload, { reopenAppointmentDetails: true });
                                    return;
                                  }
                                }
                                openNurseDetailsModal(nurseForDetails);
                              }}
                            >
                              <LinearGradient
                                colors={(hasClockIn || hasClockOut) ? GRADIENTS.warning : GRADIENTS.primary}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.shiftStatusChipGradient}
                              >
                                <MaterialCommunityIcons name="eye" size={14} color={COLORS.white} />
                                <Text style={styles.shiftStatusChipText}>View</Text>
                              </LinearGradient>
                            </TouchableWeb>
                          </View>

                          <View style={styles.shiftRow}>
                            <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                            <Text style={styles.shiftRowText}>{serviceName}</Text>
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

                            const getSingleShiftDay = () => {
                              const dateField = d.date || d.scheduledDate || d.appointmentDate || d.shiftDate || d.startDate;
                              if (!dateField) return null;
                              let dateObj;
                              if (dateField?.seconds) {
                                dateObj = new Date(dateField.seconds * 1000);
                              } else if (typeof dateField === 'string') {
                                dateObj = new Date(dateField);
                              } else if (dateField instanceof Date) {
                                dateObj = dateField;
                              }
                              if (dateObj && !isNaN(dateObj)) {
                                return dateObj.getDay();
                              }
                              return null;
                            };

                            const singleShiftDay = getSingleShiftDay();

                            const combined = []
                              .concat(d.daysOfWeek || [])
                              .concat(d.selectedDays || [])
                              .concat(d.requestedDays || [])
                              .concat(d.recurringDaysOfWeekList || [])
                              .concat(d.recurringDaysOfWeek || [])
                              .concat(d.recurringPattern?.daysOfWeek || [])
                              .concat(d.schedule?.daysOfWeek || [])
                              .concat(d.schedule?.selectedDays || [])
                              .concat(singleShiftDay !== null ? [singleShiftDay] : []);

                            const daysArray = Array.from(
                              new Set(
                                combined
                                  .map(toDayNumber)
                                  .filter((n) => n !== null && n >= 0 && n <= 6)
                              )
                            ).sort((a,b) => a-b);

                            if (!daysArray || daysArray.length === 0) {
                              return null;
                            }

                            const DAYS_MAP = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                            return (
                              <View style={styles.shiftDaysContainer}>
                                <Text style={styles.shiftDaysLabel}>Assigned Days</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                  {daysArray.map((dayIndex, idx) => (
                                    <View key={idx} style={styles.shiftDayPill}>
                                      <LinearGradient
                                        colors={GRADIENTS.header}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 0, y: 1 }}
                                        style={styles.shiftDayPillGradient}
                                      >
                                        <Text style={styles.shiftDayPillText}>{DAYS_MAP[dayIndex]}</Text>
                                      </LinearGradient>
                                    </View>
                                  ))}
                                </ScrollView>
                              </View>
                            );
                          })()}

                          <View style={styles.shiftTimeGrid}>
                            <View style={styles.shiftTimeItem}>
                              <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                              <View style={styles.shiftTimeContent}>
                                <Text style={styles.shiftTimeLabel}>Start Time</Text>
                                <Text style={styles.shiftTimeValue}>{startTimeLabel}</Text>
                              </View>
                            </View>
                            <View style={styles.shiftTimeDivider} />
                            <View style={styles.shiftTimeItem}>
                              <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                              <View style={styles.shiftTimeContent}>
                                <Text style={styles.shiftTimeLabel}>End Time</Text>
                                <Text style={styles.shiftTimeValue}>{endTimeLabel}</Text>
                              </View>
                            </View>
                          </View>

                          <View style={styles.shiftTimeGrid}>
                            <View style={styles.shiftTimeItem}>
                              <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                              <View style={styles.shiftTimeContent}>
                                <Text style={styles.shiftTimeLabel}>Start Date</Text>
                                <Text style={styles.shiftTimeValue}>{appointmentDateLabel}</Text>
                              </View>
                            </View>
                            <View style={styles.shiftTimeDivider} />
                            <View style={styles.shiftTimeItem}>
                              <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                              <View style={styles.shiftTimeContent}>
                                <Text style={styles.shiftTimeLabel}>End Date</Text>
                                <Text style={styles.shiftTimeValue}>{endDateLabel}</Text>
                              </View>
                            </View>
                          </View>

                          <View>
                            <Text style={styles.shiftTimeLabel}>Duration</Text>
                            <Text style={styles.shiftDurationText}>{formattedDuration || '1 hour'}</Text>
                          </View>
                        </View>
                      );
                    })()}
                  </View>

                  {/* Requested Nurse (from booking) */}
                  {(() => {
                    const d = selectedAppointmentDetails || {};
                    const statusLower = String(d.status || '').toLowerCase();
                    const isPendingLike = ['pending', 'requested', 'awaiting', 'unassigned'].includes(statusLower);
                    
                    // Hide this section if nurse has already clocked in
                    const hasClockedIn = Boolean(
                      d.actualStartTime || 
                      d.startedAt || 
                      d.clockInTime || 
                      statusLower === 'clocked-in' || 
                      statusLower === 'active'
                    );
                    if (hasClockedIn) return null;

                    const requestedId =
                      d.preferredNurseId ||
                      d.requestedNurseId ||
                      (typeof d.preferredNurse === 'object' ? (d.preferredNurse.id || d.preferredNurse._id) : null) ||
                      (typeof d.requestedNurse === 'object' ? (d.requestedNurse.id || d.requestedNurse._id) : null) ||
                      null;

                    const requestedName =
                      d.preferredNurseName ||
                      d.requestedNurseName ||
                      (typeof d.preferredNurse === 'object' ? d.preferredNurse.name : null) ||
                      (typeof d.requestedNurse === 'object' ? d.requestedNurse.name : null) ||
                      (typeof d.requestedNurse === 'string' ? d.requestedNurse : null) ||
                      null;

                    const requestedCode =
                      d.preferredNurseCode ||
                      d.requestedNurseCode ||
                      (typeof d.preferredNurse === 'object' ? (d.preferredNurse.nurseCode || d.preferredNurse.staffCode || d.preferredNurse.code) : null) ||
                      (typeof d.requestedNurse === 'object' ? (d.requestedNurse.nurseCode || d.requestedNurse.staffCode || d.requestedNurse.code) : null) ||
                      null;

                    // Only show section when pending-like OR when a nurse was explicitly requested.
                    if (!isPendingLike && !requestedId && !requestedName) return null;

                    const normalize = (v) => (v === undefined || v === null ? null : String(v).trim());
                    const requestedIdNorm = normalize(requestedId);
                    const requestedCodeNorm = normalize(requestedCode)?.toUpperCase() || null;

                    const rosterNurse = (requestedIdNorm || requestedCodeNorm)
                      ? (Array.isArray(nurses)
                        ? nurses.find((n) => {
                            const nId = normalize(n?.id || n?._id || n?.uid || n?.nurseId);
                            const nCode = normalize(n?.nurseCode || n?.staffCode || n?.code)?.toUpperCase() || null;
                            if (requestedIdNorm && nId && nId === requestedIdNorm) return true;
                            if (requestedCodeNorm && nCode && nCode === requestedCodeNorm) return true;
                            // Some payloads store nurseCode in preferredNurseId
                            if (requestedIdNorm && nCode && nCode === requestedIdNorm.toUpperCase()) return true;
                            return false;
                          })
                        : null)
                      : null;

                    const nurseForCard = rosterNurse || (requestedIdNorm || requestedName)
                      ? {
                          id: requestedIdNorm || 'requested',
                          _id: requestedIdNorm || 'requested',
                          fullName: requestedName || 'Requested Nurse',
                          name: requestedName || 'Requested Nurse',
                          nurseCode: requestedCodeNorm || null,
                          staffCode: requestedCodeNorm || null,
                          code: requestedCodeNorm || null,
                        }
                      : null;

                    return (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Requested Nurse</Text>
                        {nurseForCard ? (
                          <NurseInfoCard
                            nurse={nurseForCard}
                            nursesRoster={nurses}
                            openDetailsOnPress
                            hideSpecialty
                            hideCode
                          />
                        ) : (
                          <Text style={styles.detailsNotes}>Any nurse</Text>
                        )}
                      </View>
                    );
                  })()}

                  {/* Assigned Nurse (explicit section for admin clarity) */}
                  {(() => {
                    const d = selectedAppointmentDetails || {};

                    const coverageRequests = Array.isArray(d.coverageRequests)
                      ? d.coverageRequests
                      : Array.isArray(d.shift?.coverageRequests)
                        ? d.shift.coverageRequests
                        : Array.isArray(d.shiftDetails?.coverageRequests)
                          ? d.shiftDetails.coverageRequests
                          : (Array.isArray(d.recurringSchedule?.coverageRequests)
                            ? d.recurringSchedule.coverageRequests
                            : []);

                    const acceptedCoverage = coverageRequests.find((entry) => {
                      if (!entry) return false;
                      const status = normalizeStatus(entry?.status);
                      return status === 'accepted';
                    }) || null;

                    const coverageRequestingNurse = acceptedCoverage?.requestingNurse || null;

                    const assignedIdRaw =
                      acceptedCoverage?.requestingNurseId ||
                      acceptedCoverage?.requestedByNurseId ||
                      coverageRequestingNurse?.id ||
                      coverageRequestingNurse?._id ||
                      coverageRequestingNurse?.nurseId ||
                      coverageRequestingNurse?.uid ||
                      d.nurseId ||
                      d.assignedNurseId ||
                      d.assignedNurse?.id ||
                      d.assignedNurse?._id ||
                      d.nurse?.id ||
                      d.nurse?._id ||
                      null;

                    const assignedCodeRaw =
                      acceptedCoverage?.requestingNurseCode ||
                      acceptedCoverage?.requestingNurseStaffCode ||
                      coverageRequestingNurse?.nurseCode ||
                      coverageRequestingNurse?.staffCode ||
                      coverageRequestingNurse?.code ||
                      d.nurseCode ||
                      d.staffCode ||
                      d.assignedNurse?.nurseCode ||
                      d.assignedNurse?.staffCode ||
                      d.assignedNurseCode ||
                      d.assignedNurseStaffCode ||
                      d.nurse?.nurseCode ||
                      d.nurse?.staffCode ||
                      null;

                    const assignedNameRaw =
                      acceptedCoverage?.requestingNurseName ||
                      acceptedCoverage?.requestedByNurseName ||
                      coverageRequestingNurse?.fullName ||
                      coverageRequestingNurse?.name ||
                      coverageRequestingNurse?.nurseName ||
                      d.assignedNurseName ||
                      d.nurseName ||
                      (typeof d.assignedNurse === 'object' ? formatNurseName(d.assignedNurse) : null) ||
                      (typeof d.nurse === 'object' ? formatNurseName(d.nurse) : null) ||
                      null;

                    const normalize = (v) => (v === undefined || v === null ? null : String(v).trim());
                    const assignedId = normalize(assignedIdRaw);
                    const assignedCode = normalize(assignedCodeRaw)?.toUpperCase() || null;
                    const assignedName = normalize(assignedNameRaw);

                    if (!assignedId && !assignedCode && !assignedName) return null;

                    const rosterNurse = (assignedId || assignedCode)
                      ? (Array.isArray(nurses)
                        ? nurses.find((n) => {
                            const nId = normalize(n?.id || n?._id || n?.uid || n?.nurseId);
                            const nCode = normalize(n?.nurseCode || n?.staffCode || n?.code)?.toUpperCase() || null;
                            if (assignedId && nId && nId === assignedId) return true;
                            if (assignedCode && nCode && nCode === assignedCode) return true;
                            return false;
                          })
                        : null)
                      : null;

                    const freshMapNurse = assignedId && freshNurseDataMap instanceof Map
                      ? (freshNurseDataMap.get(assignedId) || null)
                      : null;

                    const merged = {
                      ...(typeof d.assignedNurse === 'object' ? d.assignedNurse : {}),
                      ...(typeof d.nurse === 'object' ? d.nurse : {}),
                      ...(coverageRequestingNurse && typeof coverageRequestingNurse === 'object' ? coverageRequestingNurse : {}),
                      ...(rosterNurse && typeof rosterNurse === 'object' ? rosterNurse : {}),
                      ...(freshMapNurse && typeof freshMapNurse === 'object' ? freshMapNurse : {}),
                    };

                    const nurseForCard = {
                      ...merged,
                      id: assignedId || merged.id || merged._id || merged.uid || merged.nurseId || 'assigned',
                      _id: assignedId || merged._id || merged.id || merged.uid || merged.nurseId || 'assigned',
                      fullName:
                        assignedName ||
                        merged.fullName ||
                        merged.name ||
                        merged.nurseName ||
                        'Assigned Nurse',
                      name:
                        assignedName ||
                        merged.name ||
                        merged.fullName ||
                        merged.nurseName ||
                        'Assigned Nurse',
                      nurseCode:
                        assignedCode ||
                        merged.nurseCode ||
                        merged.staffCode ||
                        merged.code ||
                        null,
                      staffCode:
                        assignedCode ||
                        merged.staffCode ||
                        merged.nurseCode ||
                        merged.code ||
                        null,
                      code:
                        assignedCode ||
                        merged.code ||
                        merged.staffCode ||
                        merged.nurseCode ||
                        null,
                    };

                    const nurseKeyForClock =
                      assignedId ||
                      assignedCode ||
                      nurseForCard.id ||
                      nurseForCard.nurseCode ||
                      nurseForCard.staffCode ||
                      nurseForCard.code ||
                      null;

                    const clockEntryForAssigned = nurseKeyForClock
                      ? getClockEntryByNurse(d, nurseKeyForClock, nurseForCard, { includeRecordFallbackKeys: true })
                      : null;

                    const assignedClockInTime =
                      clockEntryForAssigned?.lastClockInTime ||
                      clockEntryForAssigned?.actualStartTime ||
                      clockEntryForAssigned?.clockInTime ||
                      clockEntryForAssigned?.startedAt ||
                      d.actualStartTime ||
                      d.clockInTime ||
                      d.startedAt ||
                      null;

                    const assignedClockOutTime =
                      clockEntryForAssigned?.lastClockOutTime ||
                      clockEntryForAssigned?.actualEndTime ||
                      clockEntryForAssigned?.clockOutTime ||
                      clockEntryForAssigned?.completedAt ||
                      d.actualEndTime ||
                      d.clockOutTime ||
                      d.completedAt ||
                      null;

                    const hasAssignedClockActivity = Boolean(assignedClockInTime || assignedClockOutTime);
                    const isAssignedCurrentlyClockedIn = Boolean(assignedClockInTime) && !Boolean(assignedClockOutTime);
                    const assignedClockPayload = hasAssignedClockActivity
                      ? {
                          clockInTime: assignedClockInTime,
                          clockInLocation:
                            clockEntryForAssigned?.clockInLocation ||
                            clockEntryForAssigned?.startLocation ||
                            d.clockInLocation ||
                            d.startLocation ||
                            null,
                          clockOutTime: assignedClockOutTime,
                          clockOutLocation:
                            clockEntryForAssigned?.clockOutLocation ||
                            clockEntryForAssigned?.endLocation ||
                            d.clockOutLocation ||
                            d.endLocation ||
                            null,
                          label: `${assignedName || nurseForCard.fullName || 'Assigned Nurse'} - Clock Details`,
                        }
                      : null;

                    return (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Assigned Nurse</Text>
                        <NurseInfoCard
                          nurse={nurseForCard}
                          nursesRoster={nurses}
                          openDetailsOnPress={!hasAssignedClockActivity}
                          hideSpecialty={!hasAssignedClockActivity}
                          hideCode={!hasAssignedClockActivity}
                          showViewButton={false}
                          style={isAssignedCurrentlyClockedIn ? styles.cardClockedIn : undefined}
                          actionButton={
                            <TouchableWeb
                              onPress={() => {
                                if (hasAssignedClockActivity && assignedClockPayload) {
                                  openClockDetailsModal('Clock Details', assignedClockPayload, {
                                    reopenAppointmentDetails: true,
                                  });
                                } else {
                                  openNurseDetailsModal(nurseForCard);
                                }
                              }}
                              style={{
                                borderRadius: 20,
                                overflow: 'hidden',
                                marginTop: 8,
                                shadowColor: COLORS.shadow,
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.15,
                                shadowRadius: 4,
                                elevation: 3,
                              }}
                            >
                              <LinearGradient
                                colors={hasAssignedClockActivity ? GRADIENTS.warning : GRADIENTS.primary}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={{
                                  paddingVertical: 6,
                                  paddingHorizontal: 14,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: 20,
                                }}
                              >
                                <Text
                                  style={{
                                    color: '#fff',
                                    fontWeight: 'bold',
                                    fontSize: 13,
                                    fontFamily: 'Poppins_600SemiBold',
                                  }}
                                >
                                  View
                                </Text>
                              </LinearGradient>
                            </TouchableWeb>
                          }
                        />
                      </View>
                    );
                  })()}

                  {appointmentClockDetailsVisible && (
                    <View style={styles.clockDetailsCard}>
                      <View style={styles.clockDetailsCardHeader}>
                        <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                        <Text style={styles.clockDetailsCardHeaderText}>
                          {formatFriendlyDate(selectedAppointmentDetails?.date)}
                        </Text>
                        <TouchableWeb
                          onPress={() => setAppointmentClockDetailsVisible(false)}
                          style={{ marginLeft: 'auto' }}
                        >
                          <MaterialCommunityIcons name="close-circle" size={20} color={COLORS.textLight} />
                        </TouchableWeb>
                      </View>

                      <View style={styles.clockDetailsSection}>
                        <Text style={styles.clockDetailsSectionTitle}>Clock In</Text>
                        <View style={styles.detailItem}>
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Time</Text>
                            <Text style={styles.detailValue}>
                              {formatFriendlyTime(clockDetailsPayload?.clockInTime) || 'Not captured'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.detailItem}>
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Location</Text>
                            <Text style={styles.detailValue}>
                              {formatLocationLabel(clockDetailsPayload?.clockInLocation)}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.clockDetailsDivider} />

                      <View style={styles.clockDetailsSection}>
                        <Text style={styles.clockDetailsSectionTitle}>Clock Out</Text>
                        <View style={styles.detailItem}>
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Time</Text>
                            <Text style={styles.detailValue}>
                              {formatFriendlyTime(clockDetailsPayload?.clockOutTime) || 'Not captured'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.detailItem}>
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Location</Text>
                            <Text style={styles.detailValue}>
                              {formatLocationLabel(clockDetailsPayload?.clockOutLocation)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Emergency Backup Nurses */}
                  {(() => {
                    const d = selectedAppointmentDetails || {};

                    // If we have an accepted coverage request, use requesting nurse for de-dupe (not the working backup nurse).
                    const coverageList = Array.isArray(d.coverageRequests)
                      ? d.coverageRequests
                      : (Array.isArray(d.shift?.coverageRequests) ? d.shift.coverageRequests : (Array.isArray(d.shiftDetails?.coverageRequests) ? d.shiftDetails.coverageRequests : []));

                    const acceptedCoverage = coverageList.find((cr) => {
                      if (!cr) return false;
                      const s = String(cr.status || '').toLowerCase();
                      return s.includes('accept');
                    }) || null;

                    const statusLower = String(d.status || '').trim().toLowerCase();
                    const appointmentHasClockedIn = Boolean(
                      d.actualStartTime ||
                        d.startedAt ||
                        d.clockInTime ||
                        statusLower === 'clocked-in' ||
                        statusLower === 'active'
                    );

                    const assignedIdNorm = normalizeId(
                      acceptedCoverage?.requestingNurseId ||
                        d.assignedNurseId ||
                        d.assignedNurse?.id ||
                        d.assignedNurse?._id ||
                        d.nurseId ||
                        d.nurse?.id ||
                        d.nurse?._id ||
                        null
                    );

                    const assignedCodeNorm = normalizeCode(
                      acceptedCoverage?.requestingNurseCode ||
                        d.assignedNurse?.nurseCode ||
                        d.assignedNurse?.staffCode ||
                        d.assignedNurseCode ||
                        d.assignedNurseStaffCode ||
                        d.nurseCode ||
                        d.staffCode ||
                        d.nurse?.nurseCode ||
                        d.nurse?.staffCode ||
                        null
                    );

                    const rawLists = [
                      d.backupNurses,
                      d.emergencyBackupNurses,
                      d.shift?.backupNurses,
                      d.shiftDetails?.backupNurses,
                      d.recurringSchedule?.backupNurses,
                    ].filter((v) => Array.isArray(v));

                    const merged = rawLists.flat();

                    // Also pull any notified/target backup nurses from coverage requests.
                    const coverageBuckets = [
                      d.coverageRequests,
                      d.shift?.coverageRequests,
                      d.shiftDetails?.coverageRequests,
                    ].filter((v) => Array.isArray(v));

                    coverageBuckets.flat().forEach((req) => {
                      if (!req || typeof req !== 'object') return;
                      const maybe = []
                        .concat(req.targetBackupNurseId || [])
                        .concat(req.targetBackupNurseStaffCode || [])
                        .concat(req.targetBackupNurse || [])
                        .concat(req.backupNurseId || [])
                        .concat(req.backupNurseCode || [])
                        .concat(req.backupNurse || [])
                        .concat(Array.isArray(req.backupNursesNotified) ? req.backupNursesNotified : []);

                      maybe.forEach((value) => {
                        if (!value) return;
                        if (typeof value === 'object') {
                          merged.push(value);
                          return;
                        }
                        merged.push({ nurseId: value });
                      });
                    });

                    const deduped = [];
                    const seen = new Set();

                    const looksLikeStaffCode = (value) => {
                      if (!value) return false;
                      const s = String(value).trim();
                      if (!s) return false;
                      // Typical patterns: NURSE001, NUR001, ABC123
                      return /^[A-Za-z]{2,}\d{1,}$/.test(s);
                    };

                    const identityKeys = (entry) => {
                      const keys = [];
                      const idRaw = entry?.nurseId || entry?.uid || entry?.id || entry?._id || entry;
                      const codeRaw = entry?.staffCode || entry?.nurseCode || entry?.code || entry?.username;

                      const idNorm = normalizeId(idRaw);
                      const codeNorm = normalizeCode(codeRaw);

                      if (idNorm) keys.push(`id:${String(idNorm).trim().toLowerCase()}`);
                      if (codeNorm) keys.push(`code:${String(codeNorm).trim().toUpperCase()}`);

                      // If something is stored in nurseId but it looks like a staff code, treat it as a code too.
                      if (idRaw && looksLikeStaffCode(idRaw)) {
                        const asCode = normalizeCode(idRaw);
                        if (asCode) keys.push(`code:${String(asCode).trim().toUpperCase()}`);
                      }

                      return keys;
                    };

                    merged.forEach((entry) => {
                      const keys = identityKeys(entry);
                      if (keys.length > 0 && keys.some((k) => seen.has(k))) return;
                      keys.forEach((k) => seen.add(k));
                      deduped.push(entry);
                    });

                    // When the appointment is clocked-in/active, the working nurse is already shown in the Assigned Nurse section.
                    // Avoid showing the same nurse again inside Emergency Backup Nurses.
                    const displayBackups = (appointmentHasClockedIn && (assignedIdNorm || assignedCodeNorm))
                      ? deduped.filter((entry) => {
                          const id = normalizeId(entry?.nurseId || entry?.uid || entry?.id || entry?._id || entry);
                          const code = normalizeCode(entry?.staffCode || entry?.nurseCode || entry?.code);
                          if (assignedIdNorm && id && assignedIdNorm === id) return false;
                          if (assignedCodeNorm && code && assignedCodeNorm === code) return false;
                          return true;
                        })
                      : deduped;

                    return (
                      <View style={styles.detailsSection}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={styles.sectionTitle}>Emergency Backup Nurses</Text>
                          </View>
                          {isAdminUser && !appointmentHasClockedIn && (
                            <TouchableWeb
                              onPress={() => openBackupNurseModal(selectedAppointmentDetails)}
                              activeOpacity={0.7}
                              style={styles.reassignChip}
                            >
                              <LinearGradient
                                colors={GRADIENTS.warning}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.reassignChipGradient}
                              >
                                <MaterialCommunityIcons name="account-multiple-plus" size={18} color={COLORS.white} />
                              </LinearGradient>
                            </TouchableWeb>
                          )}
                        </View>
                        <Text style={styles.helperText}>Priority order for emergency coverage</Text>
                        {displayBackups.length === 0 ? (
                          <Text style={styles.detailsNotes}>No emergency backup nurses added.</Text>
                        ) : (
                          displayBackups.map((backup, index) => {
                            const backupId = normalizeId(backup?.nurseId || backup?.id || backup?._id || backup?.uid);
                            const backupCode = normalizeCode(backup?.staffCode || backup?.nurseCode || backup?.code);

                            const isAccepted = checkIsAcceptedCoverageForNurse(
                              d.coverageRequests || d.shift?.coverageRequests || d.shiftDetails?.coverageRequests,
                              backupId,
                              backupCode
                            );

                            let isClockedIn = false;
                            let clockEntry = null;
                            let hasIn = null;
                            let hasOut = null;
                            let hasClockHistory = false;

                            const mergedClockByNurse =
                              d.clockByNurse ||
                              d.activeShift?.clockByNurse ||
                              d.shift?.clockByNurse ||
                              d.shiftDetails?.clockByNurse ||
                              d.nurseSchedule?.clockByNurse ||
                              d.shift?.nurseSchedule?.clockByNurse ||
                              d.shiftDetails?.nurseSchedule?.clockByNurse;

                            if (mergedClockByNurse && typeof mergedClockByNurse === 'object') {
                              const candidates = [
                                backupId,
                                backupCode,
                                normalizeId(backup?.id),
                                normalizeId(backup?._id),
                              ]
                                .filter(Boolean)
                                .map((v) => String(v).trim());

                              for (const key of candidates) {
                                if (mergedClockByNurse[key]) {
                                  clockEntry = mergedClockByNurse[key];
                                  break;
                                }
                                const upper = key.toUpperCase();
                                if (mergedClockByNurse[upper]) {
                                  clockEntry = mergedClockByNurse[upper];
                                  break;
                                }
                                const lower = key.toLowerCase();
                                if (mergedClockByNurse[lower]) {
                                  clockEntry = mergedClockByNurse[lower];
                                  break;
                                }
                              }

                              // Last resort scan values
                              if (!clockEntry) {
                                const values = Object.values(mergedClockByNurse);
                                clockEntry = values.find((v) => {
                                  if (!v || typeof v !== 'object') return false;
                                  const vId = normalizeId(v.nurseId || v.id || v._id || v.uid);
                                  const vCode = normalizeCode(v.nurseCode || v.staffCode || v.code);
                                  if (backupId && vId && backupId === vId) return true;
                                  if (backupCode && vCode && backupCode === vCode) return true;
                                  return false;
                                });
                              }

                              if (clockEntry) {
                                hasIn =
                                  clockEntry.lastClockInTime ||
                                  clockEntry.actualStartTime ||
                                  clockEntry.clockInTime ||
                                  clockEntry.startedAt;
                                hasOut =
                                  clockEntry.lastClockOutTime ||
                                  clockEntry.actualEndTime ||
                                  clockEntry.clockOutTime ||
                                  clockEntry.completedAt;
                              }
                            }

                            hasClockHistory = Boolean(hasIn || hasOut);
                            isClockedIn = isClockedIn || (Boolean(hasIn) && !Boolean(hasOut));

                            return (
                              <View key={`${backupId || backupCode || index}`} style={{ marginBottom: 10 }}>
                                <View
                                  style={{
                                    position: 'absolute',
                                    right: -5,
                                    top: -5,
                                    zIndex: 10,
                                    backgroundColor: COLORS.primary,
                                    width: 24,
                                    height: 24,
                                    borderRadius: 12,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderWidth: 2,
                                    borderColor: COLORS.white,
                                    shadowColor: '#000',
                                    shadowOffset: { width: 0, height: 2 },
                                    shadowOpacity: 0.2,
                                    shadowRadius: 2,
                                    elevation: 3,
                                  }}
                                >
                                  <Text style={{ color: COLORS.white, fontSize: 12, fontWeight: 'bold' }}>
                                    {backup.priority || index + 1}
                                  </Text>
                                </View>

                                <NurseInfoCard
                                  nurse={(() => {
                                    const rosterKey = backup?.nurseId || backup?._id || backup?.id || backupId;
                                    const rosterData = rosterKey
                                      ? freshNurseDataMap.get(rosterKey) || {}
                                      : {};
                                    const mergedEntry = { ...backup, ...rosterData };

                                    const sanitize = (val, isSpecialty = false) => {
                                      if (!val) return null;
                                      const str = String(val).trim();
                                      const invalid = ['n/a', 'na', 'not provided', 'undefined', 'null', 'none'];
                                      if (isSpecialty) invalid.push('backup nurse');
                                      if (invalid.includes(str.toLowerCase())) return null;
                                      return str;
                                    };

                                    return {
                                      ...mergedEntry,
                                      fullName:
                                        mergedEntry.fullName ||
                                        mergedEntry.name ||
                                        mergedEntry.nurseName ||
                                        'Backup Nurse',
                                      specialty:
                                        sanitize(mergedEntry.specialty, true) ||
                                        sanitize(mergedEntry.role, true),
                                      phone: sanitize(mergedEntry.phone),
                                      email: sanitize(mergedEntry.email),
                                    };
                                  })()}
                                  nursesRoster={nurses}
                                  openDetailsOnPress={!hasClockHistory}
                                  hideSpecialty
                                  hideCode
                                  style={isClockedIn ? styles.cardClockedIn : undefined}
                                  showViewButton={!hasClockHistory}
                                  actionButton={
                                    hasClockHistory ? (
                                      <TouchableWeb
                                        onPress={() => {
                                          const payload = {
                                            clockInTime: hasIn,
                                            clockInLocation:
                                              clockEntry?.clockInLocation || clockEntry?.startLocation || d.clockInLocation || d.startLocation,
                                            clockOutTime: hasOut,
                                            clockOutLocation:
                                              clockEntry?.clockOutLocation || clockEntry?.endLocation || d.clockOutLocation || d.endLocation,
                                            label: `${backup?.nurseName || 'Backup Nurse'} - Coverage`,
                                          };
                                          openClockDetailsModal('Emergency Coverage', payload, {
                                            reopenAppointmentDetails: true,
                                          });
                                        }}
                                        style={{
                                          borderRadius: 20,
                                          overflow: 'hidden',
                                          marginTop: 8,
                                          shadowColor: COLORS.shadow,
                                          shadowOffset: { width: 0, height: 2 },
                                          shadowOpacity: 0.15,
                                          shadowRadius: 4,
                                          elevation: 3,
                                        }}
                                      >
                                        <LinearGradient
                                          colors={GRADIENTS.warning}
                                          start={{ x: 0, y: 0 }}
                                          end={{ x: 0, y: 1 }}
                                          style={{
                                            paddingVertical: 6,
                                            paddingHorizontal: 14,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: 20,
                                          }}
                                        >
                                          <Text
                                            style={{
                                              color: '#fff',
                                              fontWeight: 'bold',
                                              fontSize: 13,
                                              fontFamily: 'Poppins_600SemiBold',
                                            }}
                                          >
                                            View
                                          </Text>
                                        </LinearGradient>
                                      </TouchableWeb>
                                    ) : null
                                  }
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
                    const d = selectedAppointmentDetails || {};
                    const nurseItems = [];

                    const nurseNotePhotos = (() => {
                      const raw =
                        d.nurseNotePhotos ||
                        d.shiftDetails?.nurseNotePhotos ||
                        d.shift?.nurseNotePhotos ||
                        d.activeShift?.nurseNotePhotos ||
                        d.shiftRequest?.nurseNotePhotos ||
                        null;
                      if (!raw) return [];
                      const arr = Array.isArray(raw) ? raw : [raw];
                      return arr
                        .map((p) => {
                          if (typeof p === 'string') return p.trim();
                          if (p && typeof p === 'object') {
                            const candidate = p.url || p.uri || p.downloadURL || p.downloadUrl || p.path;
                            return candidate ? String(candidate).trim() : '';
                          }
                          return '';
                        })
                        .filter((u) => typeof u === 'string' && u.length > 0)
                        .filter((u) => /^https?:\/\//i.test(u));
                    })();

                    const pushNurseNote = (rawItem) => {
                      if (!rawItem || !rawItem.body) return;
                      const normalizedBody = String(rawItem.body).trim();
                      if (!normalizedBody.length) return;
                      const duplicate = nurseItems.some((existing) => {
                        return String(existing.body || '').trim() === normalizedBody;
                      });
                      if (duplicate) return;
                      nurseItems.push({ ...rawItem, body: normalizedBody, photoUrls: nurseNotePhotos });
                    };

                    const nurseNotesBody = (d.nurseNotes && String(d.nurseNotes).trim().length)
                      ? String(d.nurseNotes).trim()
                      : null;

                    const workingNurseForNotes = (() => {
                      const fromObj = (obj) => {
                        if (!obj || typeof obj !== 'object') return null;
                        const name =
                          formatNurseName(obj) ||
                          obj.fullName ||
                          obj.name ||
                          obj.nurseName ||
                          null;
                        const code =
                          obj.nurseCode ||
                          obj.staffCode ||
                          obj.code ||
                          obj.username ||
                          null;
                        const id = obj.id || obj._id || obj.uid || obj.nurseId || null;
                        return { name, code, id };
                      };

                      const base = fromObj(d.nurse) || null;
                      const id = d.nurseId || d.nurse?.id || d.nurse?._id || base?.id || null;
                      const cached = id && freshNurseDataMap instanceof Map ? freshNurseDataMap.get(id) : null;
                      const cachedFromObj = fromObj(cached);

                      const name =
                        cachedFromObj?.name ||
                        base?.name ||
                        (d.nurseName ? String(d.nurseName).trim() : null) ||
                        null;

                      const code =
                        (d.nurseCode ? String(d.nurseCode).trim() : null) ||
                        (d.staffCode ? String(d.staffCode).trim() : null) ||
                        cachedFromObj?.code ||
                        base?.code ||
                        null;

                      return { name, code, id };
                    })();

                    if (nurseNotesBody) {
                      const nurseSubtitle = workingNurseForNotes.code || workingNurseForNotes.id || 'Nurse';

                      pushNurseNote({
                        id: `nurse-notes-${d.id || d._id || d.appointmentId || 'note'}`,
                        date: d.updatedAt || d.assignedAt || null,
                        title: workingNurseForNotes.name || 'Nurse Note',
                        subtitle: nurseSubtitle,
                        body: nurseNotesBody,
                      });
                    }

                    const completionNotesBody = (d.completionNotes && String(d.completionNotes).trim().length)
                      ? String(d.completionNotes).trim()
                      : null;
                    if (completionNotesBody) {
                      const completionSubtitle = workingNurseForNotes.code || workingNurseForNotes.id || 'Nurse';

                      pushNurseNote({
                        id: `completion-notes-${d.id || d._id || d.appointmentId || 'note'}`,
                        date: d.completedAt || d.actualEndTime || null,
                        title: workingNurseForNotes.name || 'Nurse Note',
                        subtitle: completionSubtitle,
                        body: completionNotesBody,
                      });
                    }

                    // If photos exist but no text notes were captured, still render a note card so thumbnails show.
                    if (nurseItems.length === 0 && nurseNotePhotos.length > 0) {
                      const nurseSubtitle = workingNurseForNotes.code || workingNurseForNotes.id || 'Nurse';
                      pushNurseNote({
                        id: `nurse-photos-${d.id || d._id || d.appointmentId || 'note'}`,
                        date: d.updatedAt || d.completedAt || d.actualEndTime || null,
                        title: workingNurseForNotes.name || 'Nurse Note',
                        subtitle: nurseSubtitle,
                        body: 'Photos attached.',
                      });
                    }

                    return (
                      <>
                        {nurseItems.length > 0 && (
                          <View style={styles.detailsSection}>
                            <Text style={styles.sectionTitle}>Nurses Notes</Text>
                            <NotesAccordionList
                              items={nurseItems}
                              emptyText="No notes yet"
                              showTime
                              onPhotoPress={openNotePhotoPreview}
                            />
                          </View>
                        )}
                      </>
                    );
                  })()}

                  {/* Patient Notes (from booking) - keep as last section */}
                  {(() => {
                    const d = selectedAppointmentDetails || {};

                    const pickFirstNonEmptyText = (values) => {
                      const normalizeVal = (val) => {
                        if (val === null || val === undefined) return '';
                        if (Array.isArray(val)) {
                          const inner = val
                            .map((v) => {
                              if (v === null || v === undefined) return '';
                              if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
                              if (typeof v === 'object') {
                                const candidate = v.text ?? v.body ?? v.note ?? v.value ?? '';
                                return candidate === null || candidate === undefined ? '' : String(candidate).trim();
                              }
                              return '';
                            })
                            .find((t) => Boolean(t));
                          return inner || '';
                        }
                        if (typeof val === 'object') {
                          const candidate = val.text ?? val.body ?? val.note ?? val.value ?? '';
                          return candidate === null || candidate === undefined ? '' : String(candidate).trim();
                        }
                        return String(val).trim();
                      };

                      const found = (values || []).map(normalizeVal).find((text) => Boolean(text));
                      return found || '';
                    };

                    const patientBookingNotesText = pickFirstNonEmptyText([
                      d.patientNotes,
                      d.patientNote,
                      d.bookingNotes,
                      d.bookingNote,
                      d.clientNotes,
                      d.specialInstructions,
                      d.instructions,
                      d.patient?.notes,
                      d.patient?.patientNotes,
                      d.client?.notes,
                      d.client?.patientNotes,
                      d.clientSnapshot?.notes,
                      d.clientSnapshot?.patientNotes,
                      d.patientSnapshot?.notes,
                      d.patientSnapshot?.patientNotes,
                      d.clientData?.notes,
                      d.clientData?.patientNotes,
                      d.patientData?.notes,
                      d.patientData?.patientNotes,
                    ]);

                    const legacyNotes = pickFirstNonEmptyText([d.notes]);
                    const nurseNotesText = pickFirstNonEmptyText([d.nurseNotes, d.completionNotes]);
                    const legacyLooksLikeNurseNotes =
                      Boolean(legacyNotes && nurseNotesText) && legacyNotes === nurseNotesText;

                    const text = patientBookingNotesText || (legacyLooksLikeNurseNotes ? '' : legacyNotes);
                    if (!String(text || '').trim()) return null;

                    const dateCandidate = d.requestedAt || d.createdAt || d.updatedAt || null;

                    return (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Patient Notes</Text>
                        <NotesAccordionList
                          showTime
                          emptyText="No patient notes provided."
                          items={[
                            {
                              id: `patient-notes-${d.id || d._id || d.appointmentId || 'note'}`,
                              date: dateCandidate,
                              title: 'Patient Note',
                              subtitle: 'From booking',
                              body: String(text).trim(),
                            },
                          ]}
                        />
                      </View>
                    );
                  })()}
                </ScrollView>

                {/* Action Buttons for Nurses */}
                {user?.role === 'nurse' && selectedAppointmentDetails.status === 'approved' && (
                  <View style={styles.modalFooter}>
                    <TouchableWeb
                      style={styles.modalNotesButton}
                      onPress={() => {
                        setAppointmentShiftNotes(selectedAppointmentDetails.nurseNotes || '');
                        setAppointmentShowNotes(true);
                      }}
                      disabled={appointmentLoading}
                    >
                      <MaterialCommunityIcons name="note-plus" size={20} color={COLORS.primary} />
                      <Text style={styles.modalNotesButtonText}>Add Notes</Text>
                    </TouchableWeb>
                    
                    {/* Show Clock In or Clock Out based on appointment status */}
                    {(() => {
                      const hasClockInData = Boolean(
                        selectedAppointmentDetails.startedAt ||
                        selectedAppointmentDetails.actualStartTime ||
                        selectedAppointmentDetails.clockInLocation ||
                        selectedAppointmentDetails.clockInTime
                      );
                      const hasClockOutData = Boolean(
                        selectedAppointmentDetails.completedAt ||
                        selectedAppointmentDetails.actualEndTime ||
                        selectedAppointmentDetails.clockOutLocation ||
                        selectedAppointmentDetails.clockOutTime
                      );
                      
                      if (hasClockOutData) {
                        return (
                          <TouchableWeb style={[styles.modalDenyButton, styles.disabledButton]} disabled>
                            <Text style={styles.modalDenyButtonText}>Completed</Text>
                          </TouchableWeb>
                        );
                      } else if (hasClockInData) {
                        return (
                          <TouchableWeb
                            style={styles.modalDenyButton}
                            onPress={handleAppointmentClockOut}
                            disabled={appointmentLoading}
                          >
                            <MaterialCommunityIcons name="clock-end" size={20} color={COLORS.white} />
                            <Text style={styles.modalDenyButtonText}>Clock Out</Text>
                          </TouchableWeb>
                        );
                      } else {
                        return (
                          <TouchableWeb
                            style={styles.modalAssignButton}
                            onPress={() => {
                              // TODO: Implement clock in functionality
                              Alert.alert('Clock In', 'Clock in functionality to be implemented');
                            }}
                            disabled={appointmentLoading}
                          >
                            <LinearGradient
                              colors={['#10b981', '#059669']}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.modalAssignButtonGradient}
                            >
                              <MaterialCommunityIcons name="clock-start" size={20} color={COLORS.white} />
                              <Text style={styles.modalAssignButtonText}>Clock In</Text>
                            </LinearGradient>
                          </TouchableWeb>
                        );
                      }
                    })()
                    }
                  </View>
                )}

                {/* Action Buttons for Pending Appointments (not recurring - nurse handles those) */}
                {isAdminUser && selectedAppointmentDetails.status === 'pending' && !selectedAppointmentDetails.isRecurring && (
                <View style={styles.modalFooter}>
                  <TouchableWeb
                    style={styles.modalDenyButton}
                    onPress={() => {
                      Alert.alert(
                        'Deny Appointment',
                        'Are you sure you want to deny this appointment request?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Deny',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await cancelAppointment(selectedAppointmentDetails.id);
                                setAppointmentDetailsModalVisible(false);
                                Alert.alert('Success', 'Appointment denied');
                              } catch (error) {
                                Alert.alert('Error', 'Failed to deny appointment');
                              }
                            }
                          }
                        ]
                      );
                    }}
                  >
                    <Text style={styles.modalDenyButtonText}>Deny</Text>
                  </TouchableWeb>

                  <TouchableWeb
                    style={styles.modalAssignButton}
                    onPress={() => {
                      setAppointmentDetailsModalVisible(false);
                      // Ensure the full appointment object is passed
                      handleAssignNurse(selectedAppointmentDetails);
                    }}
                  >
                    <LinearGradient
                      colors={['#10b981', '#059669']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.modalAssignButtonGradient}
                    >
                      <Text style={styles.modalAssignButtonText}>Assign Nurse</Text>
                    </LinearGradient>
                  </TouchableWeb>
                </View>
              )}
              </>
            )}
          </View>
        </View>
      </Modal>

      <NurseDetailsModal
        visible={nurseDetailsModalVisible}
        onClose={() => {
          setNurseDetailsModalVisible(false);
          if (nurseSelectionMode === 'assign') {
            setNurseSelectionMode(null);
            setTimeout(() => {
              setAssignModalVisible(true);
            }, 150);
          }
        }}
        nurse={selectedNurseDetails}
        nursesRoster={nurses}
        showQualificationsRequest={false}
        footer={
          nurseSelectionMode ? (
            <TouchableOpacity
              onPress={async () => {
                if (nurseSelectionMode === 'assign') {
                  confirmAssignment(selectedNurseDetails, {
                    closeNurseDetailsOnConfirm: true,
                    clearSelectionModeOnConfirm: true,
                  });
                  return;
                }

                setNurseDetailsModalVisible(false);
                await new Promise((resolve) => setTimeout(resolve, 300));

                if (nurseSelectionMode === 'backup') {
                  await handleSelectBackupNurse(selectedNurseDetails);
                } else {
                  await handleAssignPrimaryNurse(selectedNurseDetails);
                }

                await new Promise((resolve) => setTimeout(resolve, 100));

                if (nurseSelectionMode === 'backup' && reopenAppointmentDetailsAfterNurseModal) {
                  setReopenAppointmentDetailsAfterNurseModal(false);
                  setTimeout(() => {
                    setAppointmentDetailsModalVisible(true);
                  }, 150);
                  return;
                }

                setShiftRequestModalVisible(true);
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 16, color: COLORS.white, fontWeight: '600' }}>
                  {nurseSelectionMode === 'backup' ? 'Add Backup Nurse' : 'Select this nurse'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null
        }
      />


      {/* Shift Assignment Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={shiftRequestModalVisible}
        onRequestClose={() => {
          // Close underlying shift modal and any stacked nurse details modal
          setShiftRequestModalVisible(false);
          setNurseDetailsModalVisible(false);
          setShiftRequestInlineNurseDetailsVisible(false);
        }}
      >
        <NurseDetailsModal
          visible={shiftRequestInlineNurseDetailsVisible}
          onClose={() => setShiftRequestInlineNurseDetailsVisible(false)}
          nurse={shiftRequestInlineNurseDetails}
          nursesRoster={nurses}
          showQualificationsRequest={false}
        />
        <View style={styles.detailsModalOverlay}>
          <View style={styles.detailsModalContent}>
            <View style={styles.detailsModalHeader}>
              <Text style={styles.detailsModalTitle}>
                {isRecurringSchedule ? 'Recurring Shift Details' : 'Shift Request Details'}
              </Text>
              <TouchableWeb onPress={() => {
                setShiftRequestModalVisible(false);
                setNurseDetailsModalVisible(false);
              }}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            
            {selectedShiftRequest && (
              <>
                <ScrollView
                  contentContainerStyle={styles.appointmentDetailsContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Patient Alerts Banner */}
                  {(() => {
                    const status = String(selectedShiftRequest?.status || '').toLowerCase();
                    if (['completed', 'cancelled', 'canceled', 'declined', 'rejected'].includes(status)) return null;

                    let pa =
                      selectedShiftRequest?.patientAlerts ||
                      selectedShiftRequest?.shiftDetails?.patientAlerts ||
                      selectedShiftRequest?.appointmentDetails?.patientAlerts ||
                      selectedShiftRequest?.clinicalInfo ||
                      selectedShiftRequest?.shiftDetails?.clinicalInfo ||
                      null;

                    if (typeof pa === 'string') {
                      try { pa = JSON.parse(pa); } catch { pa = null; }
                    }
                    if (!pa || typeof pa !== 'object') pa = null;

                    const allergiesRaw = pa?.allergies || selectedShiftRequest?.allergies || null;
                    const allergies = Array.isArray(allergiesRaw)
                      ? allergiesRaw.map((a) => String(a).trim()).filter(Boolean)
                      : [];
                    const allergyOther = String(pa?.allergyOther || '').trim();

                    const vitals = pa?.vitals || selectedShiftRequest?.vitals || null;
                    const bpSys = String(vitals?.bpSystolic || vitals?.bloodPressureSystolic || '').trim();
                    const bpDia = String(vitals?.bpDiastolic || vitals?.bloodPressureDiastolic || '').trim();
                    const hr = String(vitals?.heartRate || '').trim();
                    const temp = String(vitals?.temperature || '').trim();
                    const spo2 = String(vitals?.oxygenSaturation || '').trim();

                    const filtered = allergies
                      .map((a) => String(a).trim())
                      .filter((a) => a && a.toLowerCase() !== 'none')
                      .filter((a) => !(a === 'Other' && allergyOther));

                    const hasAllergies = filtered.length > 0 || Boolean(allergyOther);
                    const hasVitals = Boolean(bpSys || bpDia || hr || temp || spo2);
                    if (!hasAllergies && !hasVitals) return null;

                    const allergyParts = [...filtered];
                    if (allergyOther && !allergyParts.includes(allergyOther)) allergyParts.push(allergyOther);

                    const vitalsParts = [];
                    if (bpSys || bpDia) vitalsParts.push(`BP ${bpSys || '?'} / ${bpDia || '?'}`);
                    if (hr) vitalsParts.push(`HR ${hr}`);
                    if (temp) vitalsParts.push(`Temp ${temp}`);
                    if (spo2) vitalsParts.push(`SpO₂ ${spo2}%`);

                    return (
                      <View style={styles.patientAlertsBanner}>
                        <MaterialCommunityIcons name="alert-circle" size={18} color={COLORS.error} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.patientAlertsTitle}>Patient Alerts</Text>
                          {hasAllergies ? (
                            <Text style={styles.patientAlertsText} numberOfLines={3}>
                              Patient is allergic to: {allergyParts.join(', ') || '—'}
                            </Text>
                          ) : null}
                          {hasVitals ? (
                            <Text style={styles.patientAlertsText} numberOfLines={3}>
                              Vitals: {vitalsParts.join(' • ')}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Client Information */}
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Client Information</Text>
                    {(() => {
                      // Try to resolve the underlying client using multiple identifiers
                      const clientId =
                        selectedShiftRequest.clientId ||
                        selectedShiftRequest.patientId ||
                        selectedShiftRequest.clientUid ||
                        selectedShiftRequest.patientUid ||
                        selectedShiftRequest.client?.id ||
                        selectedShiftRequest.patient?.id ||
                        selectedShiftRequest.uid ||
                        null;
                      const rawClientEmail =
                        selectedShiftRequest.clientEmail ||
                        selectedShiftRequest.patientEmail ||
                        selectedShiftRequest.email ||
                        selectedShiftRequest.client?.email ||
                        selectedShiftRequest.patient?.email ||
                        selectedShiftRequest.user?.email ||
                        null;

                      const cachedClient =
                        (clientId && freshClientDataMap instanceof Map
                          ? freshClientDataMap.get(String(clientId)) || freshClientDataMap.get(clientId)
                          : null) ||
                        (rawClientEmail && freshClientDataMap instanceof Map
                          ? freshClientDataMap.get(String(rawClientEmail).toLowerCase())
                          : null);

                      let matchedClient = null;
                      if (clientId && clientsById instanceof Map) {
                        const key = String(clientId).trim();
                        if (key) {
                          matchedClient = clientsById.get(key) || null;
                        }
                      }
                      if (!matchedClient && rawClientEmail && clientsByEmailLower instanceof Map) {
                        const emailKey = String(rawClientEmail).trim().toLowerCase();
                        if (emailKey) {
                          matchedClient = clientsByEmailLower.get(emailKey) || null;
                        }
                      }

                      const clientName =
                        cachedClient?.fullName ||
                        cachedClient?.name ||
                        (cachedClient?.firstName || cachedClient?.lastName
                          ? `${cachedClient.firstName || ''} ${cachedClient.lastName || ''}`.trim()
                          : null) ||
                        matchedClient?.name ||
                        matchedClient?.fullName ||
                        matchedClient?.displayName ||
                        selectedShiftRequest.clientName ||
                        selectedShiftRequest.patientName ||
                        selectedShiftRequest.name ||
                        (selectedShiftRequest.patient?.firstName || selectedShiftRequest.patient?.lastName
                          ? `${selectedShiftRequest.patient?.firstName || ''} ${selectedShiftRequest.patient?.lastName || ''}`.trim()
                          : null) ||
                        (selectedShiftRequest.client?.firstName || selectedShiftRequest.client?.lastName
                          ? `${selectedShiftRequest.client?.firstName || ''} ${selectedShiftRequest.client?.lastName || ''}`.trim()
                          : null) ||
                        'N/A';

                      const normalizeField = (value) => {
                        if (!value) return null;
                        const str = String(value).trim();
                        if (!str) return null;
                        const invalid = ['na', 'n/a', 'none', 'null', 'undefined'];
                        if (invalid.includes(str.toLowerCase())) return null;
                        return str;
                      };

                      const clientEmail =
                        normalizeField(
                          cachedClient?.email ||
                            cachedClient?.clientEmail ||
                            cachedClient?.userEmail ||
                            cachedClient?.contactEmail
                        ) ||
                        normalizeField(matchedClient?.email || matchedClient?.clientEmail) ||
                        normalizeField(rawClientEmail) ||
                        normalizeField(selectedShiftRequest.clientSnapshot?.email) ||
                        normalizeField(selectedShiftRequest.patientSnapshot?.email) ||
                        normalizeField(selectedShiftRequest.clientSnapshot?.contactEmail) ||
                        normalizeField(selectedShiftRequest.patientSnapshot?.contactEmail) ||
                        normalizeField(selectedShiftRequest.clientEmail) ||
                        normalizeField(selectedShiftRequest.patientEmail) ||
                        normalizeField(selectedShiftRequest.email) ||
                        normalizeField(selectedShiftRequest.client?.email) ||
                        normalizeField(selectedShiftRequest.patient?.email) ||
                        normalizeField(selectedShiftRequest.user?.email) ||
                        'N/A';

                      const rawClientPhone =
                        selectedShiftRequest.clientSnapshot?.phone ||
                        selectedShiftRequest.patientSnapshot?.phone ||
                        selectedShiftRequest.clientSnapshot?.contactNumber ||
                        selectedShiftRequest.patientSnapshot?.contactNumber ||
                        selectedShiftRequest.clientSnapshot?.phoneNumber ||
                        selectedShiftRequest.patientSnapshot?.phoneNumber ||
                        selectedShiftRequest.clientPhone ||
                        selectedShiftRequest.patientPhone ||
                        selectedShiftRequest.phone ||
                        selectedShiftRequest.client?.phone ||
                        selectedShiftRequest.patient?.phone ||
                        selectedShiftRequest.user?.phone ||
                        null;

                      const clientPhone =
                        normalizeField(
                          cachedClient?.phone ||
                            cachedClient?.mobile ||
                            cachedClient?.cell ||
                            cachedClient?.contactNumber ||
                            cachedClient?.clientPhone
                        ) ||
                        normalizeField(matchedClient?.phone || matchedClient?.clientPhone) ||
                        normalizeField(rawClientPhone) ||
                        normalizeField(selectedShiftRequest.clientSnapshot?.phone) ||
                        normalizeField(selectedShiftRequest.patientSnapshot?.phone) ||
                        normalizeField(selectedShiftRequest.clientSnapshot?.phoneNumber) ||
                        normalizeField(selectedShiftRequest.patientSnapshot?.phoneNumber) ||
                        normalizeField(selectedShiftRequest.clientSnapshot?.contactNumber) ||
                        normalizeField(selectedShiftRequest.patientSnapshot?.contactNumber) ||
                        normalizeField(selectedShiftRequest.clientPhone) ||
                        normalizeField(selectedShiftRequest.patientPhone) ||
                        normalizeField(selectedShiftRequest.phone) ||
                        normalizeField(selectedShiftRequest.client?.phone) ||
                        normalizeField(selectedShiftRequest.patient?.phone) ||
                        normalizeField(selectedShiftRequest.user?.phone) ||
                        'N/A';

                      return (
                        <>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Name</Text>
                              <Text style={styles.detailValue}>{clientName}</Text>
                            </View>
                          </View>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Email</Text>
                              <Text style={styles.detailValue}>{clientEmail}</Text>
                            </View>
                          </View>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Phone</Text>
                              <Text style={styles.detailValue}>{clientPhone}</Text>
                            </View>
                          </View>
                          <View style={styles.detailItem}>
                            <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.primary} />
                            <View style={styles.detailContent}>
                              <Text style={styles.detailLabel}>Service Location</Text>
                                <Text style={styles.detailValue}>
                                  {(() => {
                                    const resolveAddressDisplay = (value) => {
                                      if (!value) return null;
                                      if (typeof value === 'string') {
                                        const trimmed = value.trim();
                                        return trimmed.length ? trimmed : null;
                                      }
                                      const formatted = formatLocationAddress(value);
                                      if (formatted) return formatted;
                                      if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number') {
                                        return `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`;
                                      }
                                      return null;
                                    };

                                    const candidates = [
                                      selectedShiftLocationSummary,
                                      matchedClient?.address,
                                      selectedShiftRequest.clientSnapshot?.address,
                                      selectedShiftRequest.patientSnapshot?.address,
                                      selectedShiftRequest.clientSnapshot?.location,
                                      selectedShiftRequest.patientSnapshot?.location,
                                      selectedShiftRequest.serviceLocation,
                                      selectedShiftRequest.clientAddress,
                                      selectedShiftRequest.patientAddress,
                                      selectedShiftRequest.address,
                                      selectedShiftRequest.location?.address,
                                      selectedShiftRequest.location,
                                    ];

                                    for (const candidate of candidates) {
                                      const resolved = resolveAddressDisplay(candidate);
                                      if (resolved) return resolved;
                                    }

                                    return 'Not provided';
                                  })()}
                                </Text>
                            </View>
                          </View>
                        </>
                      );
                    })()}
                  </View>

                  {/* Requested Nurse Card for Recurring Shifts */}
                  {(() => {
                    if (!isRecurringSchedule) {
                      return null;
                    }
                    
                    const d = selectedShiftRequest;
                    
                    // For patient-created recurring shifts, the requested nurse data is in the standard fields
                    // Check for nurse data - try preferred/requested fields first, then fall back to standard fields
                    // IMPORTANT: Use primaryNurseId (preserves original request) over nurseId (gets updated on assignment)
                    const requestedId = 
                      d.preferredNurseId || 
                      d.requestedNurseId || 
                      d.preferredNurse || 
                      // For patient-created shifts, prefer primaryNurseId which preserves the original request
                      (d.requestedBy ? d.primaryNurseId : null) ||
                      null;
                      
                    const requestedName = 
                      d.preferredNurseName || 
                      d.requestedNurseName || 
                      d.requestedNurse || 
                      d.preferredNurseFullName ||
                      // For patient-created shifts, use nurseName as it contains the requested nurse name
                      (d.requestedBy ? d.nurseName : null) ||
                      null;
                      
                    const requestedCode = 
                      d.preferredNurseCode || 
                      d.requestedNurseCode ||
                      // For patient-created shifts:
                      (d.requestedBy ? d.nurseCode : null) ||
                      null;

                    // DEBUG: Log the requested nurse data
                    console.log('🔍 REQUESTED NURSE DEBUG:', {
                      isRecurringSchedule,
                      requestedId,
                      requestedName,
                      requestedCode,
                      requestedBy: d.requestedBy,
                      shiftFields: {
                        preferredNurseId: d.preferredNurseId,
                        requestedNurseId: d.requestedNurseId,
                        preferredNurseName: d.preferredNurseName,
                        requestedNurseName: d.requestedNurseName,
                        primaryNurseId: d.primaryNurseId,
                        nurseId: d.nurseId,
                        nurseName: d.nurseName,
                        nurseCode: d.nurseCode,
                      },
                      allShiftKeys: Object.keys(d || {}).filter(k => k.toLowerCase().includes('nurse') || k.toLowerCase().includes('prefer') || k.toLowerCase().includes('request'))
                    });

                    // Try to find the nurse in the roster
                    const rosterNurse = requestedId ? nurses.find(n => 
                      n.id === requestedId || 
                      n._id === requestedId || 
                      n.nurseCode === requestedId ||
                      n.code === requestedId ||
                      n.staffCode === requestedId
                    ) : null;

                    // Show the requested nurse if we have data
                    if (requestedId || requestedName) {
                      console.log('✅ SHOWING REQUESTED NURSE SECTION');
                      const nurseForCard = rosterNurse || {
                        id: requestedId || 'requested',
                        _id: requestedId || 'requested',
                        fullName: requestedName || 'Requested Nurse',
                        name: requestedName || 'Requested Nurse',
                        nurseCode: requestedCode || rosterNurse?.staffCode,
                        staffCode: requestedCode || rosterNurse?.staffCode,
                        code: requestedCode,
                        profilePhoto: rosterNurse?.profilePhoto,
                        profileImage: rosterNurse?.profileImage,
                        photoUrl: rosterNurse?.photoUrl,
                        specialization: rosterNurse?.specialization || 'General Nursing',
                      };

                      return (
                        <View style={styles.detailsSection}>
                          <Text style={styles.sectionTitle}>Requested Nurse</Text>
                          <NurseInfoCard
                            nurse={nurseForCard}
                            nursesRoster={nurses}
                            openDetailsOnPress
                          />
                        </View>
                      );
                    }

                    console.log('❌ REQUESTED NURSE SECTION HIDDEN - No requestedId or requestedName found');
                    return null;
                  })()}

                  {isRecurringSchedule && (
                    <>

                      {/* Service Information Section - Card Style */}
                      {(() => {
                        // For patient-created pending shifts, only hide nurse if admin hasn't assigned anyone yet
                        // (if still showing the originally requested nurse with no admin assignment)
                        const isPatientCreated = !!selectedShiftRequest?.requestedBy;
                        const isPending = selectedShiftRequest?.status === 'pending' || !selectedShiftRequest?.recurringApproved;
                        
                        // Get the requested nurse ID (from patient's original request)
                        const requestedNurseId = selectedShiftRequest?.preferredNurseId || selectedShiftRequest?.requestedNurseId;
                        
                        // Get the currently assigned nurse ID (from admin assignment or nurse response)
                        const currentNurseId = selectedShiftRequest?.nurseId || selectedShiftRequest?.primaryNurseId;
                        
                        // Check if any nurse has formally accepted via coverage requests
                        const hasAcceptedCoverage = Array.isArray(selectedShiftRequest?.coverageRequests) && 
                          selectedShiftRequest.coverageRequests.some(cr => 
                            String(cr?.status || '').toLowerCase() === 'accepted'
                          );
                        
                        // Hide nurse from service card ONLY if:
                        // 1. Patient-created shift
                        // 2. Still pending
                        // 3. Current nurse is same as requested nurse (no admin reassignment) OR no nurse assigned
                        // 4. No accepted coverage
                        const adminHasReassigned = requestedNurseId && currentNurseId && requestedNurseId !== currentNurseId;
                        const isPatientCreatedPending = isPatientCreated && isPending && !adminHasReassigned && !hasAcceptedCoverage;
                        
                        const hasAssignedNurseContext = !isPatientCreatedPending && 
                          (selectedShiftRequest?.adminRecurring || selectedShiftRequest?.nurseId || selectedShiftRequest?.primaryNurseId);

                        const renderServiceCard = ({
                          nurseData,
                          nurseName,
                          nurseCode,
                          nurseKey,
                          serviceName,
                          assignedDays,
                          startTime,
                          endTime,
                          startDate,
                          endDate,
                        }) => {
                          return (
                            <View style={{
                              backgroundColor: COLORS.white,
                              borderRadius: 12,
                              borderWidth: 2,
                              borderColor: COLORS.primary,
                              padding: 16,
                              marginBottom: 16,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.1,
                              shadowRadius: 4,
                              elevation: 3,
                            }}>
                              {/* Nurse Info */}
                              {(nurseKey || nurseData || nurseName) && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                                  {nurseData?.profilePhoto || nurseData?.profileImage ? (
                                    <Image
                                      source={{ uri: nurseData.profilePhoto || nurseData.profileImage }}
                                      style={{ width: 56, height: 56, borderRadius: 28, marginRight: 12, backgroundColor: '#E6ECF5' }}
                                    />
                                  ) : (
                                    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#E6ECF5', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                      <MaterialCommunityIcons name="account" size={30} color={COLORS.primary} />
                                    </View>
                                  )}
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: '#000000', marginBottom: 4 }}>
                                      {nurseData?.fullName || nurseData?.name || nurseName || 'Assigned Nurse'}
                                    </Text>
                                    <Text style={{ fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#808080', marginBottom: 4 }}>
                                      {nurseData?.specialization || nurseData?.specialty || 'General Nursing'}
                                    </Text>
                                    {(nurseCode || nurseData?.staffCode || nurseData?.code || nurseData?.nurseCode) && (
                                      <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: '#2196F3' }}>
                                        {nurseCode || nurseData?.staffCode || nurseData?.code || nurseData?.nurseCode}
                                      </Text>
                                    )}
                                  </View>
                                  {(() => {
                                    const normalizeStatus = (s) => {
                                      const normalized = String(s || '').trim().toLowerCase();
                                      if (['accepted', 'approve', 'approved', 'assigned', 'booked', 'confirmed'].includes(normalized)) return 'accepted';
                                      if (['declined', 'decline', 'rejected', 'reject', 'canceled', 'cancelled'].includes(normalized)) return 'declined';
                                      return 'pending';
                                    };

                                    const status = selectedShiftRequest?.status;
                                    const nurseStatus = selectedShiftRequest?.nurseStatus;
                                    const nurseResponses = selectedShiftRequest?.nurseResponses || {};

                                    // Try direct lookup first, then fallback matching by staffCode/nurseCode/uid
                                    let responseForKey = nurseKey && nurseResponses?.[nurseKey];
                                    if (!responseForKey && nurseKey) {
                                      const normalizeId = (v) => (typeof v === 'string' ? v.trim() : '');
                                      responseForKey = Object.values(nurseResponses).find((r) => {
                                        if (!r || typeof r !== 'object') return false;
                                        const rStaffCode = normalizeId(r.staffCode || r.nurseCode || r.code);
                                        const rUid = normalizeId(r.uid || r.nurseId || r.id);
                                        const keyNormalized = normalizeId(nurseKey);
                                        return (rStaffCode && rStaffCode === keyNormalized) || (rUid && rUid === keyNormalized);
                                      });
                                    }

                                    const responseStatus = responseForKey?.status;
                                    const normalizedResponseStatus = normalizeStatus(responseStatus);
                                    const normalizedStatus = normalizeStatus(status);
                                    const normalizedNurseStatus = normalizeStatus(nurseStatus);

                                    if (normalizedResponseStatus === 'accepted') {
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={['#10b981', '#059669']}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Accepted</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    if (normalizedResponseStatus === 'declined' || normalizedNurseStatus === 'declined') {
                                      return (
                                        <TouchableWeb
                                          style={styles.reassignChip}
                                          onPress={() => {
                                            setShiftRequestModalVisible(false);
                                            setTimeout(() => {
                                              setSelectedShiftRequest(selectedShiftRequest);
                                              openPrimaryNurseModal();
                                            }, 100);
                                          }}
                                        >
                                          <LinearGradient
                                            colors={GRADIENTS.warning}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <MaterialCommunityIcons name="account-switch" size={16} color={COLORS.white} />
                                            <Text style={styles.reassignChipText}>Reassign</Text>
                                          </LinearGradient>
                                        </TouchableWeb>
                                      );
                                    }

                                    if (normalizedResponseStatus === 'pending') {
                                      // For nurse-created recurring shift requests, show "View" button instead of "Pending" badge
                                      const isNurseCreatedRecurring = !selectedShiftRequest?.adminRecurring && 
                                        (selectedShiftRequest?.isRecurring || selectedShiftRequest?.recurringPattern);
                                      
                                      if (isNurseCreatedRecurring) {
                                        return (
                                          <TouchableWeb
                                            style={styles.detailsButton}
                                            onPress={() => {
                                              setTimeout(() => {
                                                setNurseSelectionMode(null);
                                                openShiftRequestInlineNurseDetailsModal(nurseData || { 
                                                  id: nurseKey, 
                                                  fullName: nurseName,
                                                  staffCode: nurseCode 
                                                });
                                              }, 100);
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
                                        );
                                      }
                                      
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={GRADIENTS.warning}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Pending</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    if (normalizedStatus === 'declined') {
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={GRADIENTS.error}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Declined</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    if (normalizedStatus === 'accepted') {
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={['#10b981', '#059669']}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Accepted</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    if (normalizedStatus === 'pending') {
                                      // For nurse-created recurring shift requests, show "View" button instead of "Pending" badge
                                      const isNurseCreatedRecurring = !selectedShiftRequest?.adminRecurring && 
                                        (selectedShiftRequest?.isRecurring || selectedShiftRequest?.recurringPattern);
                                      
                                      if (isNurseCreatedRecurring) {
                                        return (
                                          <TouchableWeb
                                            style={styles.detailsButton}
                                            onPress={() => {
                                              setTimeout(() => {
                                                setNurseSelectionMode(null);
                                                openShiftRequestInlineNurseDetailsModal(nurseData || { 
                                                  id: nurseKey, 
                                                  fullName: nurseName,
                                                  staffCode: nurseCode 
                                                });
                                              }, 100);
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
                                        );
                                      }
                                      
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={GRADIENTS.warning}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Pending</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    return null;
                                  })()}
                                </View>
                              )}

                              {/* Service Row */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                                <Text style={{ fontSize: 12, fontWeight: '500', color: COLORS.text }}>
                                  {serviceName || 'General Care'}
                                </Text>
                              </View>

                              {/* Assigned Days */}
                              <View style={{ marginBottom: 12 }}>
                                <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.text, marginBottom: 8 }}>Assigned Days</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                  {(() => {
                                    const days = Array.isArray(assignedDays) ? assignedDays : [];
                                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                                    if (days.length === 0) {
                                      return <Text style={{ color: COLORS.textLight, fontStyle: 'italic', fontSize: 12 }}>Not specified</Text>;
                                    }
                                    // Sort days relative to period start date
                                    const periodStart = coerceToDateSafe(startDate);
                                    const baseDay = periodStart ? periodStart.getDay() : 0;
                                    const sortedDays = days.slice().sort((a, b) => {
                                      const aOffset = (a - baseDay + 7) % 7;
                                      const bOffset = (b - baseDay + 7) % 7;
                                      return aOffset - bOffset;
                                    });
                                    return sortedDays.map(d => (
                                        <View key={`${nurseKey || 'n'}-${d}`} style={{ marginRight: 8, borderRadius: 20, overflow: 'hidden' }}>
                                          <LinearGradient
                                            colors={GRADIENTS.header}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                                          >
                                            <Text style={{ color: COLORS.white, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{dayNames[d]}</Text>
                                          </LinearGradient>
                                        </View>
                                      ));
                                  })()}
                                </ScrollView>
                              </View>

                              {/* Start/End Time Row */}
                              <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: COLORS.background,
                                borderRadius: 10,
                                padding: 12,
                                marginBottom: 12,
                              }}>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Start</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {formatTimeTo12Hour(startTime) || startTime || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                                <View style={{ width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: 8 }} />
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>End</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {formatTimeTo12Hour(endTime) || endTime || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Start/End Date Row */}
                              <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: COLORS.background,
                                borderRadius: 10,
                                padding: 12,
                                marginBottom: 12,
                              }}>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Start Date</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {(() => {
                                        const dateStr = startDate;
                                        if (!dateStr) return 'N/A';
                                        if (typeof dateStr !== 'string') { const _d = coerceToDateSafe(dateStr); return !_d ? 'N/A' : _d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                        const match = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
                                        if (match) {
                                          const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                                          const monthStr = match[1].toLowerCase().substring(0, 3);
                                          const day = parseInt(match[2], 10);
                                          const year = parseInt(match[3], 10);
                                          const monthNum = monthMap[monthStr];
                                          if (monthNum !== undefined && !isNaN(day) && !isNaN(year)) {
                                            const date = new Date(year, monthNum, day);
                                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                          }
                                        }
                                        const date = coerceToDateSafe(dateStr);
                                        return !date ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                      })()}
                                    </Text>
                                  </View>
                                </View>
                                <View style={{ width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: 8 }} />
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>End Date</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {(() => {
                                        const dateStr = endDate;
                                        if (!dateStr) return 'Ongoing';
                                        if (typeof dateStr !== 'string') { const _d = coerceToDateSafe(dateStr); return !_d ? 'Ongoing' : _d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                        const match = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
                                        if (match) {
                                          const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                                          const monthStr = match[1].toLowerCase().substring(0, 3);
                                          const day = parseInt(match[2], 10);
                                          const year = parseInt(match[3], 10);
                                          const monthNum = monthMap[monthStr];
                                          if (monthNum !== undefined && !isNaN(day) && !isNaN(year)) {
                                            const date = new Date(year, monthNum, day);
                                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                          }
                                        }
                                        const date = coerceToDateSafe(dateStr);
                                        return !date ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                      })()}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </View>
                          );
                        };

                        // If no nurse assigned context, show the generic service card (unchanged)
                        if (!hasAssignedNurseContext) {
                          return (
                            <View style={styles.detailsSection}>
                              <Text style={styles.sectionTitle}>Service Information</Text>
                              <View style={{
                                backgroundColor: COLORS.white,
                                borderRadius: 12,
                                borderWidth: 2,
                                borderColor: COLORS.primary,
                                padding: 16,
                                marginBottom: 16,
                                shadowColor: '#000',
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.1,
                                shadowRadius: 4,
                                elevation: 3,
                              }}>
                                {/* Service Row */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                  <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                                  <Text style={{ fontSize: 12, fontWeight: '500', color: COLORS.text }}>
                                    {selectedShiftRequest.service || 'General Care'}
                                  </Text>
                                </View>

                                {/* Assigned Days */}
                                <View style={{ marginBottom: 16 }}>
                                  <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.text, marginBottom: 8 }}>Assigned Days</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {(() => {
                                      const toDayNumber = (value) => {
                                        const n = typeof value === 'string' ? Number(value) : value;
                                        return Number.isInteger(n) ? n : null;
                                      };

                                      const combined = []
                                        .concat(selectedShiftRequest.daysOfWeek || [])
                                        .concat(selectedShiftRequest.recurringDaysOfWeekList || [])
                                        .concat(selectedShiftRequest.recurringDaysOfWeek || []);

                                      const days = Array.from(
                                        new Set(
                                          combined
                                            .map(toDayNumber)
                                            .filter((n) => n !== null && n >= 0 && n <= 6)
                                        )
                                      );

                                      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                                      if (days.length === 0) {
                                        return <Text style={{ color: COLORS.textLight, fontStyle: 'italic', fontSize: 12 }}>Not specified</Text>;
                                      }
                                      return days.map(d => (
                                        <View key={d} style={{ marginRight: 8, borderRadius: 20, overflow: 'hidden' }}>
                                          <LinearGradient
                                            colors={GRADIENTS.header}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                                          >
                                            <Text style={{ color: COLORS.white, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{dayNames[d]}</Text>
                                          </LinearGradient>
                                        </View>
                                      ));
                                    })()}
                                  </ScrollView>
                                </View>

                                {/* Start/End Time Row (formatted to 12-hour) */}
                                <View style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  backgroundColor: COLORS.background,
                                  borderRadius: 10,
                                  padding: 12,
                                  marginBottom: 12,
                                }}>
                                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Start Time</Text>
                                      <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                        {formatTimeTo12Hour(selectedShiftRequest.startTime || selectedShiftRequest.time) || 'N/A'}
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={{ width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: 8 }} />
                                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>End Time</Text>
                                      <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                        {formatTimeTo12Hour(selectedShiftRequest.endTime) || 'N/A'}
                                      </Text>
                                    </View>
                                  </View>
                                </View>

                                {/* Start/End Date Row */}
                                <View style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  backgroundColor: COLORS.background,
                                  borderRadius: 10,
                                  padding: 12,
                                  marginBottom: 12,
                                }}>
                                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Start Date</Text>
                                      <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                        {(() => {
                                          const dateStr = selectedShiftRequest.date || selectedShiftRequest.startDate;
                                          if (!dateStr) return 'N/A';
                                          if (typeof dateStr !== 'string') { const _d = coerceToDateSafe(dateStr); return !_d ? 'N/A' : _d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                          const match = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
                                          if (match) {
                                            const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                                            const monthStr = match[1].toLowerCase().substring(0, 3);
                                            const day = parseInt(match[2], 10);
                                            const year = parseInt(match[3], 10);
                                            const monthNum = monthMap[monthStr];
                                            if (monthNum !== undefined && !isNaN(day) && !isNaN(year)) {
                                              const date = new Date(year, monthNum, day);
                                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                            }
                                          }
                                          const date = new Date(dateStr);
                                          return isNaN(date.getTime()) ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                        })()}
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={{ width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: 8 }} />
                                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>End Date</Text>
                                      <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                        {(() => {
                                          const dateStr = selectedShiftRequest.endDate;
                                          if (!dateStr) return 'Ongoing';
                                          if (typeof dateStr !== 'string') { const _d = coerceToDateSafe(dateStr); return !_d ? 'Ongoing' : _d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                          const match = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
                                          if (match) {
                                            const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                                            const monthStr = match[1].toLowerCase().substring(0, 3);
                                            const day = parseInt(match[2], 10);
                                            const year = parseInt(match[3], 10);
                                            const monthNum = monthMap[monthStr];
                                            if (monthNum !== undefined && !isNaN(day) && !isNaN(year)) {
                                              const date = new Date(year, monthNum, day);
                                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                            }
                                          }
                                          const date = new Date(dateStr);
                                          return isNaN(date.getTime()) ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                        })()}
                                      </Text>
                                    </View>
                                  </View>
                                </View>

                                {/* Duration Row */}
                                <View style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  backgroundColor: COLORS.background,
                                  borderRadius: 10,
                                  padding: 12,
                                  gap: 8,
                                }}>
                                  <MaterialCommunityIcons name="timer-outline" size={16} color={COLORS.primary} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Duration</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {(() => {
                                        const start = selectedShiftRequest.startTime || selectedShiftRequest.time;
                                        const end = selectedShiftRequest.endTime;
                                        if (start && end) {
                                          const parseTime = (timeStr) => {
                                            const [time, period] = timeStr.split(' ');
                                            let [hours, minutes] = time.split(':').map(Number);
                                            if (period?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
                                            if (period?.toUpperCase() === 'AM' && hours === 12) hours = 0;
                                            return hours * 60 + (minutes || 0);
                                          };
                                          const startMins = parseTime(start);
                                          const endMins = parseTime(end);
                                          const diffMins = endMins - startMins;
                                          const hours = Math.floor(diffMins / 60);
                                          const mins = diffMins % 60;
                                          return `${hours}h ${mins}m`;
                                        }
                                        return 'N/A';
                                      })()}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </View>
                          );
                        }

                        // Determine if split schedule: nurseSchedule present OR splitNurseServices has multiple entries OR assignmentType indicates split
                        const splitServices = Array.isArray(selectedShiftRequest?.splitNurseServices) ? selectedShiftRequest.splitNurseServices : [];
                        const nurseSchedule = selectedShiftRequest?.nurseSchedule;
                        const scheduleKeys = nurseSchedule && typeof nurseSchedule === 'object' ? Object.keys(nurseSchedule) : [];
                        const shouldRenderSplit = selectedShiftRequest?.assignmentType === 'split-schedule' || splitServices.length > 1 || scheduleKeys.length > 0;

                        if (shouldRenderSplit) {
                          const normalizeId = (v) => (typeof v === 'string' ? v.trim() : '');
                          const isLikelyUid = (v) => {
                            const s = normalizeId(v);
                            return !!s && s.length >= 20 && !s.toUpperCase().includes('NURSE');
                          };

                          const daysByNurseKey = {};
                          if (nurseSchedule && typeof nurseSchedule === 'object') {
                            Object.entries(nurseSchedule).forEach(([dayKey, nurseKeyRaw]) => {
                              const nurseKey = normalizeId(nurseKeyRaw);
                              const dayNum = parseInt(dayKey, 10);
                              if (!nurseKey || Number.isNaN(dayNum)) return;
                              if (!daysByNurseKey[nurseKey]) daysByNurseKey[nurseKey] = [];
                              daysByNurseKey[nurseKey].push(dayNum);
                            });
                          }

                          const nurseResponses = selectedShiftRequest?.nurseResponses || {};

                          // If nurseSchedule is empty but splitNurseServices exists, build nurse list from splitNurseServices
                          const scheduleCards = Object.keys(daysByNurseKey).map((nurseKey) => {
                            const nurseData = nurses.find(n => (
                              (isLikelyUid(nurseKey) && (n.id === nurseKey || n._id === nurseKey)) ||
                              (!isLikelyUid(nurseKey) && (n.staffCode === nurseKey || n.code === nurseKey || n.nurseCode === nurseKey))
                            ));

                            const response = nurseResponses?.[nurseKey] || Object.values(nurseResponses).find(r => {
                              const code = normalizeId(r?.staffCode || r?.nurseCode || r?.code);
                              const uid = normalizeId(r?.uid || r?.nurseId || r?.id);
                              return (code && code === nurseKey) || (uid && uid === nurseKey);
                            });

                            const nurseName = response?.nurseName || response?.name || nurseData?.fullName || nurseData?.name;
                            const nurseCode = response?.staffCode || response?.nurseCode || response?.code || nurseData?.staffCode || nurseData?.code || nurseData?.nurseCode;

                            const serviceName = (() => {
                              const byMap = selectedShiftRequest?.nurseServices?.[nurseKey];
                              if (typeof byMap === 'string') return byMap;
                              if (byMap?.service) return byMap.service;
                              // try to match in splitServices
                              const match = splitServices.find(s => normalizeId(s?.nurseId) === nurseKey || normalizeId(s?.nurseCode) === nurseKey);
                              return match?.service || selectedShiftRequest?.service;
                            })();

                            return {
                              nurseKey,
                              nurseData,
                              nurseName,
                              nurseCode,
                              serviceName,
                              assignedDays: daysByNurseKey[nurseKey] || [],
                              startTime: selectedShiftRequest?.startTime || selectedShiftRequest?.time,
                              endTime: selectedShiftRequest?.endTime,
                              startDate: selectedShiftRequest?.recurringPeriodStart || selectedShiftRequest?.recurringStartDate || selectedShiftRequest?.date || selectedShiftRequest?.startDate,
                              endDate: selectedShiftRequest?.recurringPeriodEnd || selectedShiftRequest?.recurringEndDate || selectedShiftRequest?.endDate,
                            };
                          });

                          const serviceCards = scheduleCards.length > 0 ? scheduleCards : splitServices.map((nurseService) => {
                            const nurseKey = normalizeId(nurseService?.nurseId || nurseService?.nurseCode);
                            const nurseData = nurses.find(n =>
                              n.staffCode === nurseService.nurseCode ||
                              n.code === nurseService.nurseCode ||
                              n.nurseCode === nurseService.nurseCode ||
                              n.id === nurseService.nurseId ||
                              n._id === nurseService.nurseId
                            );
                            return {
                              nurseKey,
                              nurseData,
                              nurseName: nurseService?.nurseName,
                              nurseCode: nurseService?.nurseCode,
                              serviceName: nurseService?.service || selectedShiftRequest?.service,
                              assignedDays: nurseService?.daysOfWeek || [],
                              startTime: nurseService?.startTime || selectedShiftRequest?.startTime || selectedShiftRequest?.time,
                              endTime: nurseService?.endTime || selectedShiftRequest?.endTime,
                              startDate: selectedShiftRequest?.recurringPeriodStart || selectedShiftRequest?.recurringStartDate || selectedShiftRequest?.date || selectedShiftRequest?.startDate,
                              endDate: selectedShiftRequest?.recurringPeriodEnd || selectedShiftRequest?.recurringEndDate || selectedShiftRequest?.endDate,
                            };
                          });

                          return serviceCards.map((card, idx) => (
                            <View key={`${card.nurseKey || 'nurse'}-${idx}`} style={styles.detailsSection}>
                              <Text style={styles.sectionTitle}>Service Information</Text>
                              {renderServiceCard(card)}
                            </View>
                          ));
                        }

                        // Single nurse case - existing card
                        const nurseId = selectedShiftRequest?.nurseId || selectedShiftRequest?.primaryNurseId || selectedShiftRequest?.assignedNurseId;
                        const nurseName = selectedShiftRequest?.nurseName || selectedShiftRequest?.primaryNurseName || selectedShiftRequest?.assignedNurseName;
                        const nurseCode = selectedShiftRequest?.nurseCode || selectedShiftRequest?.primaryNurseCode || selectedShiftRequest?.staffCode;

                        const nurseData = nurses.find(n =>
                          n.id === nurseId ||
                          n._id === nurseId ||
                          n.staffCode === nurseCode ||
                          n.code === nurseCode ||
                          n.nurseCode === nurseCode ||
                          n.fullName === nurseName ||
                          n.name === nurseName
                        );

                        return (
                          <View style={styles.detailsSection}>
                            <Text style={styles.sectionTitle}>Service Information</Text>
                            <View style={{
                              backgroundColor: COLORS.white,
                              borderRadius: 12,
                              borderWidth: 2,
                              borderColor: COLORS.primary,
                              padding: 16,
                              marginBottom: 16,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.1,
                              shadowRadius: 4,
                              elevation: 3,
                            }}>
                              {/* Nurse Info */}
                              {(nurseId || nurseData || nurseName) && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                                  {nurseData?.profilePhoto || nurseData?.profileImage ? (
                                    <Image
                                      source={{ uri: nurseData.profilePhoto || nurseData.profileImage }}
                                      style={{ width: 56, height: 56, borderRadius: 28, marginRight: 12, backgroundColor: '#E6ECF5' }}
                                    />
                                  ) : (
                                    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#E6ECF5', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                      <MaterialCommunityIcons name="account" size={30} color={COLORS.primary} />
                                    </View>
                                  )}
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: '#000000', marginBottom: 4 }}>
                                      {nurseData?.fullName || nurseData?.name || nurseName || 'Assigned Nurse'}
                                    </Text>
                                    <Text style={{ fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#808080', marginBottom: 4 }}>
                                      {nurseData?.specialization || nurseData?.specialty || 'General Nursing'}
                                    </Text>
                                    {(nurseCode || nurseData?.staffCode || nurseData?.code || nurseData?.nurseCode) && (
                                      <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: '#2196F3' }}>
                                        {nurseCode || nurseData?.staffCode || nurseData?.code || nurseData?.nurseCode}
                                      </Text>
                                    )}
                                  </View>
                                  {(() => {
                                    const normalizeStatus = (s) => {
                                      const normalized = String(s || '').trim().toLowerCase();
                                      if (['accepted', 'approve', 'approved', 'assigned', 'booked', 'confirmed'].includes(normalized)) return 'accepted';
                                      if (['declined', 'decline', 'rejected', 'reject', 'canceled', 'cancelled'].includes(normalized)) return 'declined';
                                      return 'pending';
                                    };

                                    const status = selectedShiftRequest?.status;
                                    const nurseStatus = selectedShiftRequest?.nurseStatus;
                                    const nurseResponses = selectedShiftRequest?.nurseResponses || {};

                                    // Try direct lookup first
                                    let responseForKey = nurseId && nurseResponses?.[nurseId];
                                    if (!responseForKey && nurseCode) {
                                      responseForKey = nurseResponses?.[nurseCode];
                                    }
                                    if (!responseForKey) {
                                      const normalizeId = (v) => (typeof v === 'string' ? v.trim() : '');
                                      responseForKey = Object.values(nurseResponses).find((r) => {
                                        if (!r || typeof r !== 'object') return false;
                                        const rStaffCode = normalizeId(r.staffCode || r.nurseCode || r.code);
                                        const rUid = normalizeId(r.uid || r.nurseId || r.id);
                                        return (rStaffCode && rStaffCode === nurseCode) || (rUid && rUid === nurseId);
                                      });
                                    }

                                    const responseStatus = responseForKey?.status;
                                    const normalizedResponseStatus = normalizeStatus(responseStatus);
                                    const normalizedStatus = normalizeStatus(status);
                                    const normalizedNurseStatus = normalizeStatus(nurseStatus);

                                    if (normalizedResponseStatus === 'accepted') {
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={['#10b981', '#059669']}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Accepted</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    if (normalizedResponseStatus === 'declined' || normalizedNurseStatus === 'declined') {
                                      return (
                                        <TouchableWeb
                                          style={styles.reassignChip}
                                          onPress={() => {
                                            setShiftRequestModalVisible(false);
                                            setTimeout(() => {
                                              setSelectedShiftRequest(selectedShiftRequest);
                                              openPrimaryNurseModal();
                                            }, 100);
                                          }}
                                        >
                                          <LinearGradient
                                            colors={GRADIENTS.warning}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <MaterialCommunityIcons name="account-switch" size={16} color={COLORS.white} />
                                            <Text style={styles.reassignChipText}>Reassign</Text>
                                          </LinearGradient>
                                        </TouchableWeb>
                                      );
                                    }

                                    if (normalizedResponseStatus === 'pending') {
                                      // For nurse-created recurring shift requests, show "View" button instead of "Pending" badge
                                      const isNurseCreatedRecurring = !selectedShiftRequest?.adminRecurring && 
                                        (selectedShiftRequest?.isRecurring || selectedShiftRequest?.recurringPattern);
                                      
                                      if (isNurseCreatedRecurring) {
                                        return (
                                          <TouchableWeb
                                            style={styles.detailsButton}
                                            onPress={() => {
                                              setTimeout(() => {
                                                setNurseSelectionMode(null);
                                                openShiftRequestInlineNurseDetailsModal(nurseData || { 
                                                  id: nurseId, 
                                                  fullName: nurseName,
                                                  staffCode: nurseCode 
                                                });
                                              }, 100);
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
                                        );
                                      }
                                      
                                      return (
                                        <View style={styles.reassignChip}>
                                          <LinearGradient
                                            colors={GRADIENTS.warning}
                                            start={{ x: 0, y: 0 }}
                                            end={{ x: 0, y: 1 }}
                                            style={styles.reassignChipGradient}
                                          >
                                            <Text style={styles.reassignChipText}>Pending</Text>
                                          </LinearGradient>
                                        </View>
                                      );
                                    }

                                    return null;
                                  })()}
                                </View>
                              )}

                              {/* Service Row */}
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                                <Text style={{ fontSize: 12, fontWeight: '500', color: COLORS.text }}>
                                  {selectedShiftRequest.service || 'General Care'}
                                </Text>
                              </View>

                              {/* Assigned Days */}
                              <View style={{ marginBottom: 12 }}>
                                <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.text, marginBottom: 8 }}>Assigned Days</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                  {(() => {
                                    const toDayNumber = (value) => {
                                      const n = typeof value === 'string' ? Number(value) : value;
                                      return Number.isInteger(n) ? n : null;
                                    };

                                    const combined = []
                                      .concat(selectedShiftRequest.daysOfWeek || [])
                                      .concat(selectedShiftRequest.recurringDaysOfWeekList || [])
                                      .concat(selectedShiftRequest.recurringDaysOfWeek || []);

                                    const days = Array.from(
                                      new Set(
                                        combined
                                          .map(toDayNumber)
                                          .filter((n) => n !== null && n >= 0 && n <= 6)
                                      )
                                    );

                                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                                    if (days.length === 0) {
                                      return <Text style={{ color: COLORS.textLight, fontStyle: 'italic', fontSize: 12 }}>Not specified</Text>;
                                    }
                                    // Sort days relative to period start date
                                    const periodStart = coerceToDateSafe(
                                      selectedShiftRequest.recurringPeriodStart ||
                                      selectedShiftRequest.recurringStartDate ||
                                      selectedShiftRequest.date ||
                                      selectedShiftRequest.startDate
                                    );
                                    const baseDay = periodStart ? periodStart.getDay() : 0;
                                    const sortedDays = days.sort((a, b) => {
                                      const aOffset = (a - baseDay + 7) % 7;
                                      const bOffset = (b - baseDay + 7) % 7;
                                      return aOffset - bOffset;
                                    });
                                    return sortedDays.map(d => (
                                      <View key={d} style={{ marginRight: 8, borderRadius: 20, overflow: 'hidden' }}>
                                        <LinearGradient
                                          colors={GRADIENTS.header}
                                          start={{ x: 0, y: 0 }}
                                          end={{ x: 0, y: 1 }}
                                          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                                        >
                                          <Text style={{ color: COLORS.white, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{dayNames[d]}</Text>
                                        </LinearGradient>
                                      </View>
                                    ));
                                  })()}
                                </ScrollView>
                              </View>

                              {/* Start/End Time Row */}
                              <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: COLORS.background,
                                borderRadius: 10,
                                padding: 12,
                                marginBottom: 12,
                              }}>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Start</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {formatTimeTo12Hour(selectedShiftRequest.startTime || selectedShiftRequest.time) || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                                <View style={{ width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: 8 }} />
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>End</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {formatTimeTo12Hour(selectedShiftRequest.endTime) || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Start/End Date Row */}
                              <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: COLORS.background,
                                borderRadius: 10,
                                padding: 12,
                                marginBottom: 12,
                              }}>
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>Start Date</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {(() => {
                                        const dateStr = selectedShiftRequest.recurringPeriodStart || selectedShiftRequest.recurringStartDate || selectedShiftRequest.date || selectedShiftRequest.startDate;
                                        if (!dateStr) return 'N/A';
                                        if (typeof dateStr !== 'string') { const _d = coerceToDateSafe(dateStr); return !_d ? 'N/A' : _d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                        const match = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
                                        if (match) {
                                          const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                                          const monthStr = match[1].toLowerCase().substring(0, 3);
                                          const day = parseInt(match[2], 10);
                                          const year = parseInt(match[3], 10);
                                          const monthNum = monthMap[monthStr];
                                          if (monthNum !== undefined && !isNaN(day) && !isNaN(year)) {
                                            const date = new Date(year, monthNum, day);
                                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                          }
                                        }
                                        const date = coerceToDateSafe(dateStr);
                                        return !date ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                      })()}
                                    </Text>
                                  </View>
                                </View>
                                <View style={{ width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: 8 }} />
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                  <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 10, fontWeight: '500', color: COLORS.textLight }}>End Date</Text>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>
                                      {(() => {
                                        const dateStr = selectedShiftRequest.recurringPeriodEnd || selectedShiftRequest.recurringEndDate || selectedShiftRequest.endDate;
                                        if (!dateStr) return 'Ongoing';
                                        if (typeof dateStr !== 'string') { const _d = coerceToDateSafe(dateStr); return !_d ? 'Ongoing' : _d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
                                        const match = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
                                        if (match) {
                                          const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
                                          const monthStr = match[1].toLowerCase().substring(0, 3);
                                          const day = parseInt(match[2], 10);
                                          const year = parseInt(match[3], 10);
                                          const monthNum = monthMap[monthStr];
                                          if (monthNum !== undefined && !isNaN(day) && !isNaN(year)) {
                                            const date = new Date(year, monthNum, day);
                                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                          }
                                        }
                                        const date = coerceToDateSafe(dateStr);
                                        return !date ? dateStr : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                      })()}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Duration (styled like Service Info card) */}
                              <View>
                                <Text style={styles.shiftTimeLabel}>Duration</Text>
                                <Text style={styles.shiftDurationText}>
                                {(() => {
                                  const start = selectedShiftRequest.startTime || selectedShiftRequest.time;
                                  const end = selectedShiftRequest.endTime;
                                  if (start && end) {
                                    const parseTime = (timeStr) => {
                                      const [time, period] = String(timeStr).split(' ');
                                      let [hours, minutes] = time.split(':').map(Number);
                                      if (period?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
                                      if (period?.toUpperCase() === 'AM' && hours === 12) hours = 0;
                                      return hours * 60 + (minutes || 0);
                                    };
                                    const startMins = parseTime(start);
                                    const endMins = parseTime(end);
                                    let diffMins = endMins - startMins;
                                    if (diffMins < 0) diffMins += 24 * 60;
                                    const hours = Math.floor(diffMins / 60);
                                    const mins = diffMins % 60;
                                    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                                  }
                                  return '1 hour';
                                })()}
                                </Text>
                              </View>
                            </View>
                          </View>
                        );
                      })()}

                    {/* Emergency Backup Nurses Section */}
                    <View style={styles.detailsSection}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <Text style={styles.sectionTitle}>Emergency Backup Nurses</Text>
                        {isAdminUser && (
                          <TouchableWeb
                            onPress={() => {
                              setShiftRequestModalVisible(false);
                              setTimeout(() => openBackupNurseModal(), 100);
                            }}
                            activeOpacity={0.7}
                            style={styles.reassignChip}
                          >
                            <LinearGradient
                              colors={GRADIENTS.warning}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.reassignChipGradient}
                            >
                              <MaterialCommunityIcons name="account-multiple-plus" size={18} color={COLORS.white} />
                            </LinearGradient>
                          </TouchableWeb>
                        )}
                      </View>
                      <Text style={styles.helperText}>Priority order for emergency coverage</Text>
                      
                      {selectedShiftRequest.backupNurses && selectedShiftRequest.backupNurses.length > 0 ? (
                        selectedShiftRequest.backupNurses.map((backup, index) => {
                          const resolvedBackup = resolveNurseDisplayInfo(
                            backup?.staffCode || backup?.nurseCode || backup?.code || backup?.nurseId
                          );
                          
                          const backupId = normalizeId(backup?.nurseId || backup?.id || backup?._id);
                          const backupCode = normalizeCode(backup?.staffCode || backup?.nurseCode || backup?.code);
                          
                          const isAccepted = checkIsAcceptedCoverageForNurse(
                              selectedShiftRequest.coverageRequests || selectedShiftRequest.shift?.coverageRequests,
                              backupId, 
                              backupCode
                          );

                          let isClockedIn = false;
                          let clockEntry = null;
                          let hasClockActivity = false;
                          const mergedClockByNurse = selectedShiftRequest.clockByNurse || 
                                                    selectedShiftRequest.shift?.clockByNurse || 
                                                    selectedShiftRequest.shiftDetails?.clockByNurse;
                                                    
                          if (isAccepted && mergedClockByNurse) {
                             const candidates = [
                             backupId, 
                             backupCode, 
                             normalizeId(backup?.id), 
                             normalizeId(backup?._id)
                           ].filter(Boolean).map(v => String(v).trim());
                           
                           for (const key of candidates) {
                                 if (mergedClockByNurse[key]) { clockEntry = mergedClockByNurse[key]; break; }
                                 const upper = key.toUpperCase();
                                 if (mergedClockByNurse[upper]) { clockEntry = mergedClockByNurse[upper]; break; }
                                 const lower = key.toLowerCase();
                                 if (mergedClockByNurse[lower]) { clockEntry = mergedClockByNurse[lower]; break; }
                           }
                            
                            if (!clockEntry) {
                               const values = Object.values(mergedClockByNurse);
                               clockEntry = values.find(v => {
                                  if (!v || typeof v !== 'object') return false;
                                  const vId = normalizeId(v.nurseId || v.id || v._id || v.uid);
                                  const vCode = normalizeCode(v.nurseCode || v.staffCode || v.code);
                                  if (backupId && vId && backupId === vId) return true;
                                  if (backupCode && vCode && backupCode === vCode) return true;
                                  return false;
                               });
                            }
                            
                             hasClockActivity = false;
                             if (clockEntry) {
                               const hasIn = clockEntry.lastClockInTime || clockEntry.actualStartTime || clockEntry.clockInTime || clockEntry.startedAt;
                               const hasOut = clockEntry.lastClockOutTime || clockEntry.actualEndTime || clockEntry.clockOutTime || clockEntry.completedAt;
                               isClockedIn = Boolean(hasIn) && !Boolean(hasOut);
                               hasClockActivity = Boolean(hasIn) || Boolean(hasOut);
                             }
                          }

                          return (
                            <View key={backup.nurseId || index} style={{ marginBottom: 10 }}>
                              <View style={{
                                  position: 'absolute',
                                  right: -5,
                                  top: -5,
                                  zIndex: 10,
                                  backgroundColor: COLORS.primary,
                                  width: 28,
                                  height: 28,
                                  borderRadius: 14,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderWidth: 2,
                                  borderColor: COLORS.white,
                                  shadowColor: "#000",
                                  shadowOffset: { width: 0, height: 2 },
                                  shadowOpacity: 0.2,
                                  shadowRadius: 2,
                                  elevation: 3
                              }}>
                                <Text style={{ color: COLORS.white, fontSize: 13, fontWeight: 'bold' }}>
                                  {index + 1}
                                </Text>
                              </View>
                              <NurseInfoCard 
                                  nurse={(() => {
                                      const sanitize = (val, isSpecialty = false) => {
                                          if (!val) return null;
                                          const str = String(val).trim();
                                          const invalid = ['n/a', 'na', 'not provided', 'undefined', 'null', 'none'];
                                          if (isSpecialty) invalid.push('backup nurse');
                                          if (invalid.includes(str.toLowerCase())) return null;
                                          return str;
                                      };
                                      
                                      const nurseId = backup?.nurseId || backup?.id || backup?._id;
                                      const rosterNurse = nurseId ? (freshNurseDataMap.get(nurseId) || {}) : {};
                                      const merged = { ...backup, ...rosterNurse };

                                      return {
                                          ...merged,
                                          fullName: resolvedBackup?.resolvedName || merged.fullName || merged.nurseName || 'Backup Nurse',
                                          nurseCode: resolvedBackup?.resolvedCode || merged.nurseCode || merged.staffCode || merged.nurseId,
                                          photoUrl: resolvedBackup?.resolvedPhoto || merged.profilePhoto || merged.profileImage || merged.photoUrl,
                                          specialty: sanitize(merged.specialty, true) || sanitize(merged.role, true),
                                          email: sanitize(merged.email),
                                          phone: sanitize(merged.phone)
                                      };
                                  })()}
                                  nursesRoster={nurses}
                                  openDetailsOnPress={!hasClockActivity}
                                  style={isClockedIn ? styles.cardClockedIn : undefined}
                                  showViewButton={!hasClockActivity}
                                  actionButton={hasClockActivity ? (
                                    <TouchableWeb
                                      onPress={() => {
                                        const payload = {
                                           clockInTime: clockEntry.lastClockInTime || clockEntry.actualStartTime || clockEntry.clockInTime || clockEntry.startedAt,
                                           clockInLocation: clockEntry.clockInLocation || clockEntry.startLocation,
                                           clockOutTime: clockEntry.lastClockOutTime || clockEntry.actualEndTime || clockEntry.clockOutTime || clockEntry.completedAt,
                                           clockOutLocation: clockEntry.clockOutLocation || clockEntry.endLocation,
                                           label: `${backup.nurseName || 'Backup Nurse'} - Coverage`
                                        };
                                        openClockDetailsModal('Emergency Coverage', payload);
                                      }}
                                      style={{
                                          borderRadius: 20,
                                          overflow: 'hidden',
                                          marginTop: 8,
                                          shadowColor: COLORS.shadow,
                                          shadowOffset: { width: 0, height: 2 },
                                          shadowOpacity: 0.15,
                                          shadowRadius: 4,
                                          elevation: 3,
                                      }}
                                    >
                                      <LinearGradient
                                          colors={GRADIENTS.warning}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 0, y: 1 }}
                                        style={{
                                            paddingVertical: 6,
                                            paddingHorizontal: 14,
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                            borderRadius: 20,
                                        }}
                                      >
                                        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13, fontFamily: 'Poppins_600SemiBold' }}>View</Text>
                                      </LinearGradient>
                                    </TouchableWeb>
                                  ) : null}
                              />
                            </View>
                          );
                        })
                      ) : null}
                    </View>
                  </>
                  )}

                  {/* Patient Notes Section - For patient-created recurring shifts */}
                  {isRecurringSchedule && selectedShiftRequest?.requestedBy && (() => {
                    const notes = selectedShiftRequest?.notes || 
                                  selectedShiftRequest?.patientNotes || 
                                  selectedShiftRequest?.clientNotes ||
                                  selectedShiftRequest?.specialInstructions ||
                                  selectedShiftRequest?.additionalNotes;
                    
                    if (!notes) return null;
                    
                    const patientName = selectedShiftRequest?.patientName || 
                                       selectedShiftRequest?.clientName || 
                                       'Patient';
                    
                    const createdDate = selectedShiftRequest?.createdAt || 
                                       selectedShiftRequest?.requestedAt || 
                                       selectedShiftRequest?.timestamp;
                    
                    const patientNotesItems = [{
                      id: `patient-notes-${selectedShiftRequest?.id || 'note'}`,
                      date: createdDate,
                      title: patientName,
                      subtitle: 'Patient Request',
                      body: notes,
                    }];
                    
                    return (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Patient Notes</Text>
                        <NotesAccordionList items={patientNotesItems} emptyText="No notes yet" showTime />
                      </View>
                    );
                  })()}

                  {/* Assigned Nurses Cards - HIDDEN for pending recurring requests per requirements to only show Requested Nurse */}
                  {(() => {
                    // Forcefully skip for recurring schedule to prevent duplication
                    if (isRecurringSchedule) return null;

                    if (nurseAssignmentCards.length === 0) return null;
                    const pendingCards = nurseAssignmentCards.filter((card) => {
                      const responses = selectedShiftRequest?.nurseResponses;
                      const status = (() => {
                        if (!responses || typeof responses !== 'object') return null;
                        const candidates = [
                          card?.nurseId,
                          card?.nurseCode,
                          ...(Array.isArray(card?.lookupKeys) ? card.lookupKeys : []),
                        ]
                          .filter((v) => typeof v === 'string' || typeof v === 'number')
                          .map((v) => String(v).trim())
                          .filter(Boolean);

                        for (const key of candidates) {
                          const entry = responses?.[key];
                          const direct = entry?.status;
                          if (direct) return direct;
                        }

                        const upperSet = new Set(candidates.map((v) => v.toUpperCase()));
                        for (const [key, entry] of Object.entries(responses)) {
                          if (!key) continue;
                          if (upperSet.has(String(key).toUpperCase())) {
                            return entry?.status || null;
                          }
                        }

                        return null;
                      })();
                      return status !== 'accepted';
                    });

                    if (pendingCards.length === 0) return null;

                    return (
                    <View style={styles.detailsSection}>
                      <Text style={styles.sectionTitle}>
                        {pendingCards.length > 1 ? 'Assigned Nurses' : 'Assigned Nurse'}
                      </Text>

                      {pendingCards.map((card, index) => (
                        <View key={card.nurseId || index} style={styles.splitNurseCard}>
                          <View style={styles.splitNurseHeader}>
                            {card.profilePhoto ? (
                              <Image
                                source={{ uri: card.profilePhoto }}
                                style={styles.splitNurseAvatar}
                              />
                            ) : (
                              <View style={[styles.splitNurseAvatar, styles.splitNurseAvatarFallback]}>
                                <MaterialCommunityIcons name="account-heart" size={24} color={COLORS.white} />
                              </View>
                            )}
                            <View style={styles.splitNurseInfo}>
                              <Text style={styles.splitNurseName}>
                                {card.nurseName || 'Assigned Nurse'}
                              </Text>
                              <Text style={styles.splitNurseMeta}>
                                {card.nurseSpecialty || 'General Nursing'}
                              </Text>
                              {(card.nurseCode || card.nurseId) && (
                                <Text style={styles.splitNurseCode}>
                                  Staff Code: {card.nurseCode || card.nurseId}
                                </Text>
                              )}
                            </View>

                            {/* Reassign / Status Actions */}
                            {(() => {
                              const responses = selectedShiftRequest?.nurseResponses;
                              const status = (() => {
                                if (!responses || typeof responses !== 'object') return null;
                                const candidates = [
                                  card?.nurseId,
                                  card?.nurseCode,
                                  ...(Array.isArray(card?.lookupKeys) ? card.lookupKeys : []),
                                ]
                                  .filter((v) => typeof v === 'string' || typeof v === 'number')
                                  .map((v) => String(v).trim())
                                  .filter(Boolean);

                                for (const key of candidates) {
                                  const entry = responses?.[key];
                                  const direct = entry?.status;
                                  if (direct) return direct;
                                }

                                const upperSet = new Set(candidates.map((v) => v.toUpperCase()));
                                for (const [key, entry] of Object.entries(responses)) {
                                  if (!key) continue;
                                  if (upperSet.has(String(key).toUpperCase())) {
                                    return entry?.status || null;
                                  }
                                }

                                return null;
                              })();
                                
                              // If this specific nurse card is currently expanding "Reassign" list
                              if (reassignFromNurseKey === card.nurseId && reassignNurseModalVisible) {
                                  return (
                                    <TouchableOpacity 
                                        onPress={closeReassignNurseModal}
                                        style={{ padding: 5 }}
                                    >
                                        <MaterialCommunityIcons name="close-circle" size={24} color={COLORS.textSecondary} />
                                    </TouchableOpacity>
                                  );
                              }

                              if (status === 'accepted') {
                                return (
                                  <MaterialCommunityIcons
                                    name="check-circle"
                                    size={22}
                                    color={COLORS.success}
                                    style={styles.splitNurseResponseIcon}
                                  />
                                );
                              }
                              if (status === 'declined') {
                                return (
                                  <TouchableWeb
                                    style={styles.reassignChip}
                                    onPress={() => openReassignNurseModal(card.nurseId)}
                                    disabled={reassignSubmitting}
                                  >
                                    <LinearGradient
                                      colors={GRADIENTS.warning}
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 0, y: 1 }}
                                      style={styles.reassignChipGradient}
                                    >
                                      <MaterialCommunityIcons name="account-switch" size={16} color={COLORS.white} />
                                      <Text style={styles.reassignChipText}>Reassign</Text>
                                    </LinearGradient>
                                  </TouchableWeb>
                                );
                              }
                              return null;
                            })()}
                          </View>

                          {/* REASSIGN INLINE LIST */}
                          {reassignFromNurseKey === card.nurseId && reassignNurseModalVisible && (
                             <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12 }}>
                                <View style={styles.reassignSearchRow}>
                                    <MaterialCommunityIcons name="magnify" size={20} color={COLORS.textSecondary} />
                                    <TextInput
                                        style={styles.reassignSearchInput}
                                        placeholder="Search replacement..."
                                        placeholderTextColor={COLORS.textSecondary}
                                        value={reassignNurseSearch}
                                        onChangeText={setReassignNurseSearch}
                                        editable={!reassignSubmitting}
                                        autoFocus
                                    />
                                </View>
                                
                                <View style={{ height: 200, backgroundColor: COLORS.background, borderRadius: 8, overflow: 'hidden' }}>
                                  <ScrollView
                                    style={{ flex: 1 }}
                                    showsVerticalScrollIndicator={false}
                                    keyboardShouldPersistTaps="handled"
                                  >
                                    {Array.isArray(reassignCandidateNurses) && reassignCandidateNurses.length > 0 ? (
                                      reassignCandidateNurses.map((item, index) => {
                                        const key = getNurseAssignmentKey(item);
                                        const label = getNurseDisplayName(item);
                                        const code = item?.code || item?.nurseCode || item?.staffCode || key;

                                        return (
                                          <TouchableOpacity
                                            key={key ? String(key) : `nurse-${index}`}
                                            style={styles.reassignRow}
                                            onPress={() => handleReassignNurse(item)}
                                            disabled={reassignSubmitting}
                                          >
                                            <View style={styles.reassignRowLeft}>
                                              <LinearGradient
                                                colors={[COLORS.primary + '20', COLORS.primary + '10']}
                                                style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}
                                              >
                                                <Text style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.primary }}>
                                                  {label.charAt(0)}
                                                </Text>
                                              </LinearGradient>
                                              <View style={styles.reassignRowText}>
                                                <Text style={styles.reassignRowName} numberOfLines={1}>{label}</Text>
                                                <Text style={styles.reassignRowMeta}>Code: {code}</Text>
                                              </View>
                                            </View>
                                            <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textSecondary} />
                                          </TouchableOpacity>
                                        );
                                      })
                                    ) : (
                                      <View style={{ padding: 20, alignItems: 'center' }}>
                                        <Text style={styles.helperText}>No nurses found.</Text>
                                      </View>
                                    )}
                                  </ScrollView>
                                </View>
                                {reassignSubmitting && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
                                        <ActivityIndicator size="small" color={COLORS.primary} />
                                        <Text style={{ marginLeft: 8, fontSize: 12, color: COLORS.textSecondary }}>Processing...</Text>
                                    </View>
                                )}
                             </View>
                          )}

                          <View style={styles.splitNurseDaysContainer}>
                            <View style={styles.splitNurseServiceRow}>
                              <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                              <Text style={styles.splitNurseServiceText}>
                                {(() => {
                                  const map = selectedShiftRequest?.nurseServices;
                                  if (map && typeof map === 'object') {
                                    const candidates = [
                                      card?.nurseId,
                                      card?.nurseCode,
                                      ...(Array.isArray(card?.lookupKeys) ? card.lookupKeys : []),
                                      (typeof card?.nurseCode === 'string' ? card.nurseCode.toUpperCase() : null),
                                      (typeof card?.nurseCode === 'string' ? card.nurseCode.toLowerCase() : null),
                                    ]
                                      .filter((v) => typeof v === 'string' || typeof v === 'number')
                                      .map((v) => String(v).trim())
                                      .filter(Boolean);

                                    for (const key of candidates) {
                                      const raw = map?.[key];
                                      if (typeof raw === 'string' && raw.trim()) return raw.trim();
                                      if (raw && typeof raw === 'object') {
                                        const t = raw.title || raw.service || raw.name;
                                        if (typeof t === 'string' && t.trim()) return t.trim();
                                      }
                                    }

                                    const upperSet = new Set(candidates.map((v) => v.toUpperCase()));
                                    for (const [key, raw] of Object.entries(map)) {
                                      if (!key) continue;
                                      if (!upperSet.has(String(key).toUpperCase())) continue;
                                      if (typeof raw === 'string' && raw.trim()) return raw.trim();
                                      if (raw && typeof raw === 'object') {
                                        const t = raw.title || raw.service || raw.name;
                                        if (typeof t === 'string' && t.trim()) return t.trim();
                                      }
                                    }
                                  }

                                  const global = typeof selectedShiftRequest?.service === 'string' ? selectedShiftRequest.service.trim() : '';
                                  if (global.toLowerCase().includes('split schedule') || !global) return 'General Care';
                                  return global;
                                })()}
                              </Text>
                            </View>

                            <Text style={styles.splitNurseDaysLabel}>Assigned Days</Text>
                            {Array.isArray(card.dayValues) && card.dayValues.length > 0 ? (
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={styles.splitNurseDaysScroll}
                              >
                                {card.dayValues.map((dayValue) => (
                                  <View key={dayValue} style={styles.splitNurseDayPill}>
                                    <LinearGradient
                                      colors={GRADIENTS.header}
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 0, y: 1 }}
                                      style={styles.splitNurseDayPillGradient}
                                    >
                                      <Text style={styles.splitNurseDayPillText}>
                                        {DAY_LABELS[dayValue].substring(0, 3)}
                                      </Text>
                                    </LinearGradient>
                                  </View>
                                ))}
                              </ScrollView>
                            ) : (
                              <Text style={styles.helperText}>{card.dayLabel}</Text>
                            )}
                          </View>

                          <View style={styles.splitNurseTimeContainer}>
                            <View style={styles.splitNurseTimeItem}>
                              <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.success} />
                              <View style={styles.splitNurseTimeContent}>
                                <Text style={styles.splitNurseTimeLabel}>Start Time</Text>
                                <Text style={styles.splitNurseTimeValue}>{selectedShiftTimes.start || 'N/A'}</Text>
                              </View>
                            </View>
                            <View style={styles.splitNurseTimeDivider} />
                            <View style={styles.splitNurseTimeItem}>
                              <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.error} />
                              <View style={styles.splitNurseTimeContent}>
                                <Text style={styles.splitNurseTimeLabel}>End Time</Text>
                                <Text style={styles.splitNurseTimeValue}>{selectedShiftTimes.end || 'N/A'}</Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                    );
                  })()}

                  {/* Service Information - for non-recurring shift requests */}
                  {!isRecurringSchedule && (() => {
                    const d = selectedShiftRequest;
                    
                    // Get the requesting nurse ID from various possible fields
                    const requestingNurseId = 
                      d.nurseId || 
                      d.requestingNurseId || 
                      d.requestedByNurseId ||
                      d.assignedNurseId ||
                      d.nurse?.id ||
                      d.nurse?._id ||
                      null;

                    const requestingNurseName = 
                      d.nurseName || 
                      d.requestingNurseName || 
                      d.nurse?.name ||
                      d.nurse?.fullName ||
                      null;

                    const requestingNurseCode = 
                      d.nurseCode || 
                      d.requestingNurseCode || 
                      d.nurse?.nurseCode ||
                      d.nurse?.staffCode ||
                      null;

                    // Find the nurse in the roster
                    const rosterNurse = requestingNurseId ? nurses.find(n => 
                      n.id === requestingNurseId || 
                      n._id === requestingNurseId || 
                      n.nurseCode === requestingNurseId ||
                      n.code === requestingNurseId ||
                      n.staffCode === requestingNurseId
                    ) : null;

                    return (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Service Information</Text>
                        <View style={styles.splitNurseCard}>
                          {/* Requesting Nurse - inline display without NurseInfoCard wrapper */}
                          {(requestingNurseId || requestingNurseName) && (() => {
                            const nurseForCard = rosterNurse || {
                              id: requestingNurseId || 'requesting',
                              _id: requestingNurseId || 'requesting',
                              fullName: requestingNurseName || 'Requesting Nurse',
                              name: requestingNurseName || 'Requesting Nurse',
                              nurseCode: requestingNurseCode || rosterNurse?.staffCode,
                              staffCode: requestingNurseCode || rosterNurse?.staffCode,
                              code: requestingNurseCode,
                              profilePhoto: d.nursePhoto || d.nurse?.profilePhoto || rosterNurse?.profilePhoto,
                              profileImage: rosterNurse?.profileImage,
                              photoUrl: rosterNurse?.photoUrl,
                              specialization: rosterNurse?.specialization || 'General Nursing',
                              email:
                                d.nurseEmail ||
                                d.requestingNurseEmail ||
                                d.assignedNurse?.email ||
                                rosterNurse?.email ||
                                null,
                              phone:
                                d.nursePhone ||
                                d.requestingNursePhone ||
                                d.assignedNurse?.phone ||
                                d.assignedNurse?.contactNumber ||
                                rosterNurse?.phone ||
                                rosterNurse?.contactNumber ||
                                null,
                            };

                            const photoUri = nurseForCard.profilePhoto || nurseForCard.profileImage || nurseForCard.photoUrl;
                            const displayName = nurseForCard.fullName || nurseForCard.name || 'Requesting Nurse';
                            const displayCode = nurseForCard.nurseCode || nurseForCard.staffCode || nurseForCard.code || 'N/A';
                            const displaySpecialty = nurseForCard.specialization || 'General Nursing';

                            return (
                              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                                {/* Avatar */}
                                <View style={{ width: 50, height: 50, borderRadius: 25, overflow: 'hidden', marginRight: 12 }}>
                                  {photoUri ? (
                                    <Image 
                                      source={{ uri: photoUri }} 
                                      style={{ width: 50, height: 50 }}
                                    />
                                  ) : (
                                    <View style={{ width: 50, height: 50, backgroundColor: COLORS.primary, borderRadius: 25, justifyContent: 'center', alignItems: 'center' }}>
                                      <MaterialCommunityIcons name="account-heart" size={28} color={COLORS.white} />
                                    </View>
                                  )}
                                </View>
                                
                                {/* Nurse Info */}
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 }}>
                                    {displayName}
                                  </Text>
                                  <Text style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 2 }}>
                                    {displaySpecialty}
                                  </Text>
                                  <Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: '600' }}>
                                    {displayCode}
                                  </Text>
                                </View>

                                {/* View Button */}
                                <TouchableOpacity
                                  onPress={() => {
                                    // Slight delay improves iOS modal stacking reliability
                                    setTimeout(() => {
                                      setNurseSelectionMode(null);
                                      openNurseDetailsModal(nurseForCard);
                                    }, 100);
                                  }}
                                  style={{ marginLeft: 12 }}
                                  activeOpacity={0.8}
                                >
                                  <LinearGradient
                                    colors={GRADIENTS.header}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 0, y: 1 }}
                                    style={{
                                      paddingHorizontal: 16,
                                      paddingVertical: 8,
                                      borderRadius: 20,
                                      minWidth: 60,
                                      alignItems: 'center'
                                    }}
                                  >
                                    <Text style={{ color: COLORS.white, fontSize: 13, fontWeight: '600' }}>
                                      View
                                    </Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                              </View>
                            );
                          })()}

                          {/* Service Name */}
                          <View style={styles.splitNurseServiceRow}>
                            <MaterialCommunityIcons name="medical-bag" size={16} color={COLORS.primary} />
                            <Text style={styles.splitNurseServiceText}>
                              {selectedShiftRequest.service || 
                               selectedShiftRequest.serviceName || 
                               selectedShiftRequest.shiftType ||
                               'General Care'}
                            </Text>
                          </View>

                          {/* Requested Days Pills */}
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
                              const dateField = selectedShiftRequest.date || selectedShiftRequest.scheduledDate || selectedShiftRequest.requestDate;
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
                              .concat(selectedShiftRequest.daysOfWeek || [])
                              .concat(selectedShiftRequest.selectedDays || [])
                              .concat(selectedShiftRequest.requestedDays || [])
                              .concat(selectedShiftRequest.recurringDaysOfWeekList || [])
                              .concat(selectedShiftRequest.recurringDaysOfWeek || [])
                              .concat(selectedShiftRequest.recurringPattern?.daysOfWeek || [])
                              .concat(selectedShiftRequest.schedule?.daysOfWeek || [])
                              .concat(selectedShiftRequest.schedule?.selectedDays || [])
                              .concat(singleShiftDay !== null ? [singleShiftDay] : []);

                            const daysArray = Array.from(
                              new Set(
                                combined
                                  .map(toDayNumber)
                                  .filter((n) => n !== null && n >= 0 && n <= 6)
                              )
                            );

                            if (!daysArray || daysArray.length === 0) {
                              return null;
                            }

                            const DAYS_MAP = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                            return (
                              <View style={{ marginTop: 12 }}>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 }}>
                                  Requested Days
                                </Text>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                                  {daysArray.map((dayIndex, idx) => {
                                    const dayLabel = DAYS_MAP[dayIndex];
                                    
                                    return (
                                      <View key={idx} style={{ marginRight: 8, marginBottom: 8, borderRadius: 16, overflow: 'hidden' }}>
                                        <LinearGradient
                                          colors={GRADIENTS.header}
                                          start={{ x: 0, y: 0 }}
                                          end={{ x: 1, y: 1 }}
                                          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }}
                                        >
                                          <Text style={{ color: COLORS.white, fontSize: 12, fontWeight: '600' }}>
                                            {dayLabel}
                                          </Text>
                                        </LinearGradient>
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            );
                          })()}

                          {/* Time Row */}
                          <View style={[styles.splitNurseTimeContainer, { marginTop: 12 }]}>
                            <View style={styles.splitNurseTimeItem}>
                              <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.primary} />
                              <View style={styles.splitNurseTimeContent}>
                                <Text style={styles.splitNurseTimeLabel}>Start Time</Text>
                                <Text style={styles.splitNurseTimeValue}>
                                  {formatTimeTo12Hour(selectedShiftRequest.startTime || selectedShiftRequest.time) || 'N/A'}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.splitNurseTimeDivider} />
                            <View style={styles.splitNurseTimeItem}>
                              <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.primary} />
                              <View style={styles.splitNurseTimeContent}>
                                <Text style={styles.splitNurseTimeLabel}>End Time</Text>
                                <Text style={styles.splitNurseTimeValue}>
                                  {formatTimeTo12Hour(selectedShiftRequest.endTime) || 'N/A'}
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Date Row */}
                          <View style={styles.splitNurseTimeContainer}>
                            <View style={styles.splitNurseTimeItem}>
                              <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.primary} />
                              <View style={styles.splitNurseTimeContent}>
                                <Text style={styles.splitNurseTimeLabel}>Start Date</Text>
                                <Text style={styles.splitNurseTimeValue}>
                                  {(() => {
                                    const raw =
                                      selectedShiftRequest.startDate ||
                                      selectedShiftRequest.date ||
                                      selectedShiftRequest.scheduledDate ||
                                      selectedShiftRequest.appointmentDate ||
                                      selectedShiftRequest.preferredDate ||
                                      null;
                                    if (!raw) return 'N/A';
                                    
                                    // Handle Firebase Timestamp objects
                                    if (raw && typeof raw === 'object' && raw.seconds !== undefined) {
                                      const date = new Date(raw.seconds * 1000);
                                      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                    }
                                    
                                    // Handle string dates
                                    if (typeof raw === 'string') {
                                      try {
                                        const date = new Date(raw);
                                        return isNaN(date.getTime()) ? raw : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                      } catch {
                                        return raw;
                                      }
                                    }
                                    
                                    return 'N/A';
                                  })()}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.splitNurseTimeDivider} />
                            <View style={styles.splitNurseTimeItem}>
                              <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.primary} />
                              <View style={styles.splitNurseTimeContent}>
                                <Text style={styles.splitNurseTimeLabel}>End Date</Text>
                                <Text style={styles.splitNurseTimeValue}>
                                  {(() => {
                                    // Try to get end date, fallback to start date
                                    let raw =
                                      selectedShiftRequest.endDate ||
                                      selectedShiftRequest.scheduledEndDate ||
                                      selectedShiftRequest.startDate ||
                                      selectedShiftRequest.date ||
                                      selectedShiftRequest.scheduledDate ||
                                      selectedShiftRequest.appointmentDate ||
                                      selectedShiftRequest.preferredDate ||
                                      null;
                                    
                                    if (!raw) return 'N/A';
                                    
                                    // Handle Firebase Timestamp objects
                                    if (raw && typeof raw === 'object' && raw.seconds !== undefined) {
                                      const date = new Date(raw.seconds * 1000);
                                      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                    }
                                    
                                    // Handle string dates
                                    if (typeof raw === 'string') {
                                      try {
                                        const date = new Date(raw);
                                        return isNaN(date.getTime()) ? raw : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                      } catch {
                                        return raw;
                                      }
                                    }
                                    
                                    return 'N/A';
                                  })()}
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Duration */}
                          {(() => {
                            const start = selectedShiftRequest.startTime || selectedShiftRequest.time;
                            const end = selectedShiftRequest.endTime;
                            if (!start || !end) return null;

                            const parseTime = (timeStr) => {
                              if (!timeStr) return 0;
                              const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                              if (!match) return 0;
                              let hours = parseInt(match[1], 10);
                              const minutes = parseInt(match[2], 10);
                              const period = match[3].toUpperCase();
                              if (period === 'PM' && hours !== 12) hours += 12;
                              if (period === 'AM' && hours === 12) hours = 0;
                              return hours * 60 + minutes;
                            };

                            const startMins = parseTime(start);
                            const endMins = parseTime(end);
                            let durationMins = endMins - startMins;
                            if (durationMins < 0) durationMins += 24 * 60;

                            const hours = Math.floor(durationMins / 60);
                            const mins = durationMins % 60;
                            const durationText = hours > 0 
                              ? `${hours}h ${mins}m` 
                              : `${mins}m`;

                            return (
                              <View style={styles.splitNurseTimeContainer}>
                                <View style={styles.splitNurseTimeItem}>
                                  <MaterialCommunityIcons name="timer-outline" size={16} color={COLORS.primary} />
                                  <View style={styles.splitNurseTimeContent}>
                                    <Text style={styles.splitNurseTimeLabel}>Duration</Text>
                                    <Text style={styles.splitNurseTimeValue}>{durationText}</Text>
                                  </View>
                                </View>
                              </View>
                            );
                          })()}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Emergency Backup Nurses - for non-recurring shift requests */}
                  {!isRecurringSchedule && (() => {
                    const backupsRaw =
                      selectedShiftRequest.backupNurses ||
                      selectedShiftRequest.schedule?.backupNurses ||
                      selectedShiftRequest.emergencyBackupNurses ||
                      selectedShiftRequest.backupNurseList;

                    const backups = Array.isArray(backupsRaw)
                      ? backupsRaw
                      : (backupsRaw && typeof backupsRaw === 'object' ? Object.values(backupsRaw) : []);

                    if (!backups || backups.length === 0) return null;

                    return (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Emergency Backup Nurses</Text>
                        <Text style={styles.helperText}>Priority order for emergency coverage</Text>
                        {backups.map((backup, index) => {
                          const sanitize = (val, isSpecialty = false) => {
                            if (!val) return null;
                            const str = String(val).trim();
                            const invalid = ['n/a', 'na', 'not provided', 'undefined', 'null', 'none'];
                            if (isSpecialty) invalid.push('backup nurse');
                            if (invalid.includes(str.toLowerCase())) return null;
                            return str;
                          };

                          // Get data from roster if available
                          const nurseId = backup.nurseId || backup._id || backup.id;
                          const rosterData = nurseId ? (freshNurseDataMap.get(nurseId) || {}) : {};
                          const merged = { ...backup, ...rosterData };
                          
                          // NEW LOGIC
                          const backupId = normalizeId(nurseId);
                          const backupCode = normalizeCode(merged.staffCode || merged.nurseCode || merged.code);
                          
                          // Check isAcceptedCoverageForNurse
                          const isAccepted = checkIsAcceptedCoverageForNurse(
                              selectedShiftRequest.coverageRequests || selectedShiftRequest.shift?.coverageRequests,
                              backupId, 
                              backupCode
                          );
                          
                          let isClockedIn = false;
                          let clockEntry = null;
                          let hasClockActivity = false;
                          const mergedClockByNurse = selectedShiftRequest.clockByNurse || 
                                                    selectedShiftRequest.shift?.clockByNurse || 
                                                    selectedShiftRequest.shiftDetails?.clockByNurse;
                                                    
                          if (isAccepted && mergedClockByNurse) {
                             const candidates = [
                             backupId, 
                             backupCode, 
                             normalizeId(backup?.id), 
                             normalizeId(backup?._id)
                           ].filter(Boolean).map(v => String(v).trim());
                           
                           for (const key of candidates) {
                                 if (mergedClockByNurse[key]) { clockEntry = mergedClockByNurse[key]; break; }
                                 const upper = key.toUpperCase();
                                 if (mergedClockByNurse[upper]) { clockEntry = mergedClockByNurse[upper]; break; }
                                 const lower = key.toLowerCase();
                                 if (mergedClockByNurse[lower]) { clockEntry = mergedClockByNurse[lower]; break; }
                           }
                            
                            // Last resort scan values
                            if (!clockEntry) {
                               const values = Object.values(mergedClockByNurse);
                               clockEntry = values.find(v => {
                                  if (!v || typeof v !== 'object') return false;
                                  const vId = normalizeId(v.nurseId || v.id || v._id || v.uid);
                                  const vCode = normalizeCode(v.nurseCode || v.staffCode || v.code);
                                  if (backupId && vId && backupId === vId) return true;
                                  if (backupCode && vCode && backupCode === vCode) return true;
                                  return false;
                               });
                            }
                            
                             hasClockActivity = false;
                             if (clockEntry) {
                               const hasIn = clockEntry.lastClockInTime || clockEntry.actualStartTime || clockEntry.clockInTime || clockEntry.startedAt;
                               const hasOut = clockEntry.lastClockOutTime || clockEntry.actualEndTime || clockEntry.clockOutTime || clockEntry.completedAt;
                               isClockedIn = Boolean(hasIn) && !Boolean(hasOut);
                               hasClockActivity = Boolean(hasIn) || Boolean(hasOut);
                             }
                          }

                          return (
                            <View key={backup.nurseId || backup.id || index} style={{ marginBottom: 12 }}>
                              <Text style={styles.helperText}>Priority {index + 1}</Text>
                              <NurseInfoCard 
                                nurse={{
                                  ...merged,
                                  fullName: merged.fullName || merged.name || merged.nurseName || 'Backup Nurse',
                                  specialty: sanitize(merged.specialty, true) || sanitize(merged.role, true),
                                  phone: sanitize(merged.phone),
                                  email: sanitize(merged.email),
                                }}
                                nursesRoster={nurses}
                                openDetailsOnPress={!hasClockActivity}
                                style={isClockedIn ? styles.cardClockedIn : undefined}
                                showViewButton={!hasClockActivity}
                                actionButton={hasClockActivity ? (
                                    <TouchableWeb
                                      onPress={() => {
                                        const payload = {
                                           clockInTime: clockEntry.lastClockInTime || clockEntry.actualStartTime || clockEntry.clockInTime || clockEntry.startedAt,
                                           clockInLocation: clockEntry.clockInLocation || clockEntry.startLocation,
                                           clockOutTime: clockEntry.lastClockOutTime || clockEntry.actualEndTime || clockEntry.clockOutTime || clockEntry.completedAt,
                                           clockOutLocation: clockEntry.clockOutLocation || clockEntry.endLocation,
                                           label: `${merged.nurseName || 'Backup Nurse'} - Coverage`
                                        };
                                        openClockDetailsModal('Emergency Coverage', payload);
                                      }}
                                      style={{
                                          borderRadius: 20,
                                          overflow: 'hidden',
                                          marginTop: 8,
                                          shadowColor: COLORS.shadow,
                                          shadowOffset: { width: 0, height: 2 },
                                          shadowOpacity: 0.15,
                                          shadowRadius: 4,
                                          elevation: 3,
                                      }}
                                    >
                                      <LinearGradient
                                          colors={GRADIENTS.warning}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 0, y: 1 }}
                                        style={{
                                            paddingVertical: 6,
                                            paddingHorizontal: 14,
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                            borderRadius: 20,
                                        }}
                                      >
                                        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13, fontFamily: 'Poppins_600SemiBold' }}>View</Text>
                                      </LinearGradient>
                                    </TouchableWeb>
                                  ) : null}
                              />
                            </View>
                          );
                        })}
                      </View>
                    );
                  })()}

                  {/* Backup / emergency nurses (priority order)
                      NOTE: Duplicate summary section removed. The detailed
                      Emergency Backup Nurses block above (with the add
                      button) now handles both display and editing of
                      backup nurses for recurring shifts. */}

                  {/* Notes */}
                  {!isRecurringSchedule && selectedShiftRequest.notes && (
                    <View style={styles.detailsSection}>
                      <Text style={styles.sectionTitle}>Notes</Text>
                      <Text style={styles.detailsNotes}>{selectedShiftRequest.notes}</Text>
                    </View>
                  )}
                </ScrollView>
                
                {/* Action buttons for shift requests */}
                {isAdminUser && selectedShiftRequest?.status === 'pending' && (
                <View style={styles.modalFooter}>
                      <TouchableWeb
                        style={styles.modalDenyButton}
                        onPress={() => handleDenyShift(selectedShiftRequest)}
                      >
                        <Text style={styles.modalDenyButtonText}>Cancel</Text>
                      </TouchableWeb>
                      
                      <TouchableWeb
                        style={styles.modalAssignButton}
                        onPress={() => {
                          console.log('Button clicked, isAdminCreatedRecurring:', isAdminCreatedRecurring);
                          if (isAdminCreatedRecurring) {
                            // For admin-created recurring shifts, open nurse selection modal
                            console.log('Opening primary nurse modal...');
                            openPrimaryNurseModal();
                          } else {
                            // For regular shifts and nurse-created recurring shift requests, approve
                            console.log('Approving shift...');
                            handleApproveShift(selectedShiftRequest);
                          }
                        }}
                      >
                        <LinearGradient
                          colors={['#10b981', '#059669']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.modalAssignButtonGradient}
                        >
                          <Text style={styles.modalAssignButtonText}>
                            {isAdminCreatedRecurring ? 'Assign Nurse' : 'Approve'}
                          </Text>
                        </LinearGradient>
                      </TouchableWeb>
                </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Shared Clock Details Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        presentationStyle="overFullScreen"
        visible={clockDetailsModalVisible}
        onRequestClose={closeClockDetailsModal}
        statusBarTranslucent={true}
      >
        <View style={styles.clockDetailsModalOverlay}>
          <View style={styles.clockDetailsModalContent}>
            <View style={styles.clockDetailsModalHeader}>
              <Text style={styles.clockDetailsModalTitle}>
                {clockDetailsPayload?.label || 'Clock Details'}
              </Text>
              <TouchableWeb onPress={closeClockDetailsModal}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {clockDaySections.map((section) => {
                const isExpanded = clockDetailsExpandedDayKey === section.key;
                return (
                  <View key={section.key} style={styles.clockDetailsSectionCard}>
                    <TouchableWeb
                      onPress={() => setClockDetailsExpandedDayKey(isExpanded ? null : section.key)}
                      activeOpacity={0.75}
                      style={styles.clockDetailsAccordionHeader}
                    >
                      <Text style={styles.clockDetailsSectionTitle}>{section.dayLabel}</Text>
                      <MaterialCommunityIcons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={22}
                        color={COLORS.textLight}
                      />
                    </TouchableWeb>

                    {isExpanded ? (
                      <>
                        <View style={[styles.timeRow, { marginBottom: SPACING.sm }]}>
                          <View style={styles.timeItem}>
                            <MaterialCommunityIcons name="clock-start" size={18} color={COLORS.success} />
                            <View style={styles.timeContent}>
                              <Text style={styles.timeLabel}>Clock In</Text>
                              <Text style={styles.timeValue}>{formatFriendlyTime(section.clockInTime) || 'Not captured'}</Text>
                            </View>
                          </View>

                          <View style={styles.timeDivider} />

                          <View style={styles.timeItem}>
                            <MaterialCommunityIcons name="clock-end" size={18} color={COLORS.error} />
                            <View style={styles.timeContent}>
                              <Text style={styles.timeLabel}>Clock Out</Text>
                              <Text style={styles.timeValue}>{formatFriendlyTime(section.clockOutTime) || 'Not captured'}</Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.detailItem}>
                          <MaterialCommunityIcons name="map-marker" size={18} color={COLORS.success} />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Clock In Location</Text>
                            <Text style={styles.detailValue}>{formatLocationLabel(section.clockInLocation)}</Text>
                          </View>
                        </View>

                        <View style={[styles.detailItem, { paddingBottom: 0 }]}>
                          <MaterialCommunityIcons name="map-marker" size={18} color={COLORS.error} />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Clock Out Location</Text>
                            <Text style={styles.detailValue}>{formatLocationLabel(section.clockOutLocation)}</Text>
                          </View>
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Appointment Notes Modal */}
      <Modal
        visible={appointmentShowNotes}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setAppointmentShowNotes(false);
          if (appointmentClockOutLocation) {
            setAppointmentClockOutLocation(null);
          }
        }}
      >
        <View style={styles.notesOverlay}>
          <View style={styles.notesContainer}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle}>
                {appointmentClockOutLocation ? 'Add Notes & Complete Appointment' : 'Add Appointment Notes'}
              </Text>
              <TouchableWeb onPress={() => {
                setAppointmentShowNotes(false);
                if (appointmentClockOutLocation) {
                  setAppointmentClockOutLocation(null);
                }
              }}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            {appointmentClockOutLocation && (
              <View style={styles.locationInfo}>
                <MaterialCommunityIcons name="map-marker" size={16} color={COLORS.primary} />
                <Text style={styles.locationText}>
                  Location: {appointmentClockOutLocation.latitude.toFixed(6)}, {appointmentClockOutLocation.longitude.toFixed(6)}
                </Text>
              </View>
            )}
            
            {/* Service Information Section */}
            <View style={styles.serviceInfoSection}>
              <Text style={styles.serviceInfoTitle}>Service Information</Text>
              <View style={styles.serviceInfoCard}>
                <MaterialCommunityIcons name="medical-bag" size={20} color={COLORS.primary} />
                <Text style={styles.serviceInfoText}>
                  {selectedAppointmentDetails?.service || selectedAppointmentDetails?.serviceName || 'N/A'}
                </Text>
              </View>
            </View>

            {/* Nurse Card with Clock Details */}
            {appointmentClockOutLocation && selectedNurseDetails && (() => {
              const clockDetails = extractClockDetailsFromRecord(selectedAppointmentDetails);
              const clockInTime = clockDetails?.clockInTime;
              const clockOutTime = appointmentClockOutLocation ? new Date().toISOString() : clockDetails?.clockOutTime;
              
              // Calculate total hours if both clock in and clock out times are available
              const calculateHours = () => {
                if (!clockInTime || !clockOutTime) return 'N/A';
                const clockIn = new Date(clockInTime);
                const clockOut = new Date(clockOutTime);
                const diffMs = clockOut - clockIn;
                const diffHours = diffMs / (1000 * 60 * 60);
                return `${diffHours.toFixed(2)} hours`;
              };

              return (
                <View style={styles.nurseClockCard}>
                  <View style={styles.nurseClockHeader}>
                    <View style={styles.nurseInfo}>
                      {selectedNurseDetails?.nurseIdPhoto || selectedNurseDetails?.profilePhoto ? (
                        <Image
                          source={{ 
                            uri: selectedNurseDetails?.nurseIdPhoto || selectedNurseDetails?.profilePhoto 
                          }}
                          style={styles.nurseClockPhoto}
                        />
                      ) : (
                        <View style={styles.nurseClockPhotoPlaceholder}>
                          <MaterialCommunityIcons name="account" size={24} color={COLORS.textMuted} />
                        </View>
                      )}
                      <View style={styles.nurseClockInfo}>
                        <Text style={styles.nurseClockName}>
                          {selectedNurseDetails?.fullName || selectedNurseDetails?.name || 'Staff Member'}
                        </Text>
                        <Text style={styles.nurseClockCode}>
                          {selectedNurseDetails?.nurseCode || selectedNurseDetails?.code || 'N/A'}
                        </Text>
                      </View>
                    </View>
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
                          {clockOutTime ? new Date(clockOutTime).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          }) : 'In Progress'}
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
              style={styles.notesInput}
              placeholder={appointmentClockOutLocation ? "Enter notes for appointment completion..." : "Enter any notes for this appointment..."}
              value={appointmentShiftNotes}
              onChangeText={setAppointmentShiftNotes}
              multiline={true}
              numberOfLines={4}
              placeholderTextColor={COLORS.textMuted}
              textAlignVertical="top"
            />
            <TouchableWeb
              style={styles.notesSaveButton}
              onPress={handleAppointmentUpdateNotes}
              disabled={appointmentLoading}
            >
              {appointmentLoading ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <Text style={styles.notesSaveButtonText}>
                  {appointmentClockOutLocation ? 'Complete Appointment' : 'Save Notes'}
                </Text>
              )}
            </TouchableWeb>
          </View>
        </View>
      </Modal>

      {/* Old Backup Nurse Modal Removed */}



      {/* Admin Recurring Shift Modal */}
      {/* Admin Recurring Shift Modal - for viewing existing recurring shifts */}
      <RecurringShiftDetailsModal
        visible={adminViewRecurringShiftModalVisible}
        shift={selectedAppointmentDetails || {}}
        clients={clientsList || []}
        contextType="admin"
        onClose={() => setAdminViewRecurringShiftModalVisible(false)}
        onOpenClockDetails={(info) => {
          const record = info?.shift || selectedAppointmentDetails || {};
          const nurseKey =
            (info?.nurseId || info?.nurseCode || info?.nurse?.id || info?.nurse?._id || info?.nurse?.code || '').toString();
          const nurseLabel =
            info?.nurse?.name ||
            info?.nurse?.fullName ||
            info?.nurse?.nurseName ||
            info?.nurse?.title ||
            'Nurse';

          const clockEntry = getClockEntryByNurse(record, nurseKey, {
            nurseId: info?.nurseId,
            nurseCode: info?.nurseCode,
            id: info?.nurseId,
            _id: info?.nurseId,
            staffCode: info?.nurseCode,
          });

          if (!clockEntry) {
            if (info?.nurse) {
              setSelectedNurseDetails(info.nurse);
              setNurseDetailsModalVisible(true);
            }
            return;
          }

          const details = extractClockDetailsFromRecord(clockEntry);

          if (!details) {
            if (info?.nurse) {
              setSelectedNurseDetails(info.nurse);
              setNurseDetailsModalVisible(true);
            }
            return;
          }

          setAdminViewRecurringShiftModalVisible(false);
          setTimeout(() => {
            openClockDetailsModal(
              'Clock Details',
              {
                ...details,
                nurseKey,
                nurseLabel,
              },
              { reopenAppointmentDetails: false, reopenRecurringDetails: true }
            );
          }, 150);
        }}
        onOpenAssignNurseModal={(shiftData) => {
          const payload = shiftData || selectedAppointmentDetails || {};
          setSelectedShiftRequest(payload);
          setSelectedAppointment({
            ...payload,
            patientName:
              payload?.clientName ||
              payload?.patientName ||
              payload?.name ||
              payload?.fullName ||
              'Recurring Care Schedule',
            id: payload?.id || payload?._id || payload?.appointmentId || 'recurring',
          });
          setAssignContext('recurring');
          setAdminViewRecurringShiftModalVisible(false); // Close recurring modal first
          // Use setTimeout to ensure modal transition happens smoothly
          setTimeout(() => {
            setAssignModalVisible(true);
          }, 100);
        }}
        onSuccess={() => {
          // Refresh shift requests after successful creation
          refreshShiftRequests();
          onRefresh();
          setAdminRecurringShiftModalVisible(false);
        }}
        onManageBackupNurses={(shiftData) => {
          // Set the shift request and open backup nurse modal
          setSelectedShiftRequest(shiftData);
          setCurrentBackupNurses(shiftData?.backupNurses || []);
          setPrimaryNurseSearch('');
          setNurseSelectionMode('backup');
          setPrimaryNurseModalVisible(true);
        }}
        nurses={nurses}
        clients={clientsList}
      />

      {/* Primary Nurse / Backup Nurse Selection Modal (Top Level) */}
      <Modal
        animationType="slide"
        visible={primaryNurseModalVisible}
        transparent={true}
        onRequestClose={handleClosePrimaryNurseModal}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: SPACING.lg,
        }}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{
              backgroundColor: COLORS.white,
              borderRadius: 20,
              width: '100%',
              maxWidth: 500,
              maxHeight: '80%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 10,
              overflow: 'hidden',
            }}
          >
            {/* Same content as above (kept for other use cases) */}
                   <View style={styles.detailsModalHeader}>
                      <Text style={styles.detailsModalTitle}>
                          {nurseSelectionMode === 'backup' ? 'Add Backup Nurse' : 'Select Nurse'}
                      </Text>
                      <TouchableOpacity 
                        onPress={handleClosePrimaryNurseModal}
                        style={{ padding: 4 }}
                      >
                         <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                      </TouchableOpacity>
                   </View>
  
                   <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                      <View style={[styles.inputContainer, { marginBottom: 0 }]}>
                        <TextInput 
                          placeholder={nurseSelectionMode === 'backup' ? "Search nurse to add..." : "Search nurse name..."} 
                          style={styles.input}
                          value={primaryNurseSearch}
                          onChangeText={setPrimaryNurseSearch}
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </View>
                   </View>
  
                   <ScrollView 
                     contentContainerStyle={{ padding: 16 }}
                     showsVerticalScrollIndicator={false}
                   >
                      <Text style={[styles.sectionTitle, { marginBottom: 12, paddingHorizontal: 4 }]}>
                        Available Nurses
                      </Text>
                      {availableNurses
                      .filter(nurse => {
                        const search = primaryNurseSearch.toLowerCase();
                        const name = (nurse.name || nurse.fullName || '').toLowerCase();
                        const code = (nurse.code || nurse.nurseCode || '').toLowerCase();
                        return name.includes(search) || code.includes(search);
                      })
                      .map((nurse) => {
                        const isBackupSelected = nurseSelectionMode === 'backup' && currentBackupNurses.some(b => b.nurseId === (nurse.id || nurse._id));
                        
                        return (
                        <View key={nurse.id} style={styles.primaryNurseCard}>
                           {nurse.profilePhoto || nurse.profileImage ? (
                             <Image 
                               source={{ uri: nurse.profilePhoto || nurse.profileImage }}
                               style={styles.primaryNurseAvatar}
                             />
                           ) : (
                             <View style={[styles.primaryNurseAvatar, styles.primaryNurseAvatarFallback]}>
                                <MaterialCommunityIcons name="account-heart" size={24} color={COLORS.white} />
                             </View>
                           )}
                          <View style={styles.primaryNurseInfo}>
                            <Text style={styles.primaryNurseName} numberOfLines={1}>
                              {nurse.name || nurse.fullName}
                            </Text>
                          </View>
                          <TouchableOpacity 
                            style={styles.primaryNurseSelectButton}
                            onPress={() => {
                              const nurseDetails = nurses.find(n => 
                                n.id === nurse.id || 
                                n._id === nurse.id || 
                                n.id === nurse._id || 
                                n._id === nurse._id
                              ) || nurse;
                              
                              setPrimaryNurseModalVisible(false);
                              setTimeout(() => {
                                openNurseDetailsModal(nurseDetails);
                              }, 300);
                            }}
                          >
                            <LinearGradient
                              colors={GRADIENTS.header}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={styles.primaryNurseSelectGradient}
                            >
                              <Text style={styles.primaryNurseSelectText}>
                                View
                              </Text>
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      );
                      })}
                      <View style={{ height: 20 }} />
                   </ScrollView>
                </KeyboardAvoidingView>
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
  reassignChip: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  reassignChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  reassignChipText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 12,
    textAlign: 'center',
  },
  reassignSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: 0,
    marginBottom: 12,
    backgroundColor: COLORS.white,
  },
  reassignSearchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    color: COLORS.text,
  },
  reassignList: {
    paddingHorizontal: 0,
    paddingBottom: 12,
  },
  reassignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    marginBottom: 10,
  },
  reassignRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  reassignRowText: {
    marginLeft: 10,
    flex: 1,
  },
  reassignRowName: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 14,
  },
  reassignRowMeta: {
    color: COLORS.textSecondary,
    marginTop: 2,
    fontSize: 12,
  },
  reassignSubmittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 10,
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
    justifyContent: 'space-between',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  welcomeLabel: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
    opacity: 0.9,
  },
  userName: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    opacity: 0.98,
    textAlign: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  headerProfileImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: COLORS.error,
    borderRadius: 12,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  notificationBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  statsContainer: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 20,
    paddingHorizontal: -1,
    backgroundColor: 'transparent',
  },
  statCard: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  statGradient: {
    paddingHorizontal: 2,
    paddingVertical: 6,
    borderRadius: 20,
    paddingHorizontal: -1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  inactiveStatCard: {
    paddingHorizontal: 2,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedCard: {
    transform: [{ scale: 1.02 }],
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  inactiveStatLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    marginTop: -8,
  },
  contentSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  contentCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  appointmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  appointmentInfo: {
    flex: 1,
    marginLeft: 12,
  },
  appointmentClient: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  appointmentService: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  appointmentDateTime: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textMuted,
    marginTop: 4,
  },
  appointmentTime: {
    alignItems: 'flex-end',
  },
  timeText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
  },
  appointmentDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nurseAssigned: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
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
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  nurseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  nurseInfo: {
    flex: 1,
    marginLeft: 12,
  },
  nurseName: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  nurseSpecialization: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  nurseStats: {
    alignItems: 'flex-end',
  },
  clientCount: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  availableBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  availableText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  nurseContact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  nurseEmail: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  nurseCode: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pendingInfo: {
    flex: 1,
    marginLeft: 12,
  },
  pendingClient: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  pendingService: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  assignBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  assignBtnText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  editRequestButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  denyBtn: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  denyBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    minWidth: 86,
  },
  denyBtnText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  approveBtn: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  approveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    minWidth: 86,
  },
  approveBtnText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  pendingDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pendingTime: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  pendingDuration: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  tabContainer: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  tab: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
    marginRight: 0,
  },
  activeTab: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  activeTabText: {
    color: COLORS.white,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },
  listContainer: {
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  titleWithBadge: {
    flex: 1,
  },
  subscriberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD70020',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#FFD70040',
  },
  subscriberBadgeText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: '#B8860B',
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.error + '10',
  },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    textAlign: 'center',
  },
  cardDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    flex: 1,
  },
  paymentInfoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 12,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success + '10',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
    flex: 1,
  },
  priceText: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.success,
  },
  paymentMethodContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accent + '10',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
    flex: 1,
  },
  paymentMethodText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.accent,
  },
  assignButton: {
    borderRadius: 10,
    overflow: 'hidden',
    minWidth: 80,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  assignButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 6,
  },
  assignButtonText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  assignedBadge: {
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
  assignedBadgeText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  assignmentInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.success + '05',
    padding: 12,
    borderRadius: 8,
  },
  assignedToText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
    marginBottom: 4,
  },
  assignedAtText: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  bottomPadding: {
    height: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
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
  notePhotoPreviewOverlayInModal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  notePhotoPreviewOverlayTapArea: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  notePhotoPreviewImageFrame: {
    width: '100%',
    height: '75%',
    maxWidth: 360,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  notePhotoPreviewImage: {
    width: '100%',
    height: '100%',
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
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    padding: 20,
  },
  nurseList: {
    padding: 20,
    paddingBottom: 30,
  },
  nurseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    marginBottom: 12,
  },
  nurseItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  nurseItemName: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  nurseItemSpecialization: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },

  createNurseForm: {
    padding: 20,
  },
  formLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 12,
  },
  formInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
  },
  codeContainer: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  codeDisplay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  codeText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    flex: 1,
  },
  generateButton: {
    borderRadius: 12,
    overflow: 'hidden',
    minWidth: 100,
  },
  generateButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 6,
  },
  generateButtonText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  createButton: {
    marginTop: 24,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  createButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  createButtonText: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Role selector styles
  roleSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  roleOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    gap: 8,
  },
  roleOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.card,
  },
  roleOptionText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
  },
  roleOptionTextSelected: {
    color: COLORS.primary,
  },
  // Horizontal Box Layout Styles
  horizontalBoxContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  staffBox: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  boxLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    marginBottom: 8,
    textAlign: 'center',
  },
  codeGenerationContainer: {
    alignItems: 'center',
    gap: 8,
  },
  sequenceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sequenceText: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  debugText: {
    fontSize: 9,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 4,
  },
  generateButtonSmall: {
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  generateButtonGradientSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  generateButtonTextSmall: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  generatedCodeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.success + '10',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.success + '30',
    gap: 8,
    marginBottom: 20,
  },
  generatedCodeText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.success,
    textAlign: 'center',
  },
  // New Tab Styles
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginTop: 8,
    marginBottom: 12,
  },
  analyticsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  analyticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  analyticsLabel: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  analyticsValue: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  serviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  serviceName: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  serviceCount: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  appointmentItem: {
    flexDirection: 'row',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 16,
  },
  appointmentLeft: {
    alignItems: 'center',
    paddingRight: 16,
    borderRightWidth: 2,
    borderRightColor: COLORS.primary,
  },
  appointmentDate: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  appointmentTime: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  appointmentRight: {
    flex: 1,
  },
  appointmentClient: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  appointmentService: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  appointmentNurse: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.accent,
  },
  completedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  completedDetails: {
    flex: 1,
  },
  completedClient: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  completedTime: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  paymentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  paymentLeft: {
    flex: 1,
  },
  paymentClient: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  paymentDate: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  paymentRight: {
    alignItems: 'flex-end',
  },
  paymentAmount: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  paymentStatus: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },
  renewalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  renewalDetails: {
    flex: 1,
  },
  renewalClient: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  renewalDate: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  renewalAmount: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  serviceManageItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  serviceManageInfo: {
    flex: 1,
  },
  serviceManageName: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  serviceManagePrice: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  serviceManageDesc: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  serviceManageToggle: {
    paddingLeft: 12,
  },
  serviceStatus: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Completed assignments styles
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  completedInfo: {
    flex: 1,
    marginLeft: 12,
  },
  completedClient: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  completedService: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  completedTime: {
    alignItems: 'flex-end',
  },
  completedDate: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
  },
  completedAtText: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.success,
    marginTop: 2,
  },
  completedDetails: {
    gap: 8,
    marginBottom: 12,
  },
  notesSection: {
    backgroundColor: COLORS.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  notesLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 18,
  },
  satisfactionSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  satisfactionLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  starsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  satisfactionScore: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginLeft: 6,
  },
  
  // Compact Completed Appointments Styles
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
  compactAvatarWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactAvatarImage: {
    width: '100%',
    height: '100%',
  },
  compactAvatarFallback: {
    backgroundColor: COLORS.primary,
  },
  compactAvatarInitials: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  assignModalScroll: {
    flex: 1,
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
  compactService: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  compactMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  compactDate: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  compactNurse: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
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

  // Active Button Styles (for shift appointments)
  activeButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  activeButtonGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeButtonText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
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
  
  // Invoice Card Styles (for pending appointments with deposits)
  invoiceCardContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  invoiceCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.primary + '20',
  },
  invoiceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  invoiceCardTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  partialBadge: {
    backgroundColor: COLORS.warning + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  partialBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.warning,
  },
  invoiceCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  invoiceCardLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    flex: 1,
  },
  invoiceCardValue: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    flex: 2,
    textAlign: 'right',
  },
  paidText: {
    color: COLORS.success,
  },
  outstandingText: {
    color: COLORS.warning,
  },
  viewInvoiceButton: {
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  viewInvoiceButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },
  viewInvoiceButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },

  // Appointment Details Modal Styles

  // Active Nurses -> View Modal (match NurseInfoCard modal styling)
  nurseCardModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  nurseCardModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  nurseCardModalHeader: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  nurseCardModalCloseButton: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.md,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 20,
    padding: SPACING.xs,
  },
  nurseCardModalPhotoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  nurseCardModalPhoto: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  nurseCardModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
    textAlign: 'center',
  },
  nurseCardModalBody: {
    maxHeight: '60%',
  },
  nurseCardInfoSection: {
    padding: SPACING.lg,
  },
  nurseCardInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  nurseCardInfoContent: {
    marginLeft: SPACING.md,
    flex: 1,
  },
  nurseCardInfoLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
    fontWeight: '500',
  },
  nurseCardInfoValue: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
  },
  nurseCardInfoHint: {
    marginTop: 3,
    fontSize: 11,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  appointmentDetailsContent: {
    padding: 20,
    paddingBottom: 30,
  },
  appointmentDetailsScroll: {
    // Intentionally no flex to avoid forcing modal height
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
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 20,
  },
  detailsSectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 12,
    paddingBottom: 6,
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
  clockDetailsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  clockDetailsModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    padding: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  clockDetailsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  clockDetailsModalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  clockDetailsSectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.background,
  },
  clockDetailsSectionTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  clockDetailsAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clockDetailsCloseAction: {
    marginTop: SPACING.sm,
    borderRadius: 12,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  clockDetailsCloseText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },

  // Client Management Styles
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
  cardClockedIn: {
    borderColor: '#4caf50',
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
  },
  compactStatusBadge: {
    backgroundColor: COLORS.success + '15',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  compactStatusText: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
  },
  // Shift request styles
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
    marginTop: 16,
    marginBottom: 8,
  },
  reviewBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  reviewBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginTop: 20,
  },
  modalDetailRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
    width: 80,
  },
  modalValue: {
    fontSize: 14,
    color: COLORS.textDark,
    flex: 1,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  denyButton: {
    backgroundColor: COLORS.border,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  denyButtonText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '600',
  },
  approveButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  approveButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  approveButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  autoInvoiceInfo: {
    flexDirection: 'row',
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 16,
    marginTop: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
    gap: 12,
  },
  recurringInvoiceInfo: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    marginTop: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    gap: 12,
  },
  autoInvoiceTextContainer: {
    flex: 1,
  },
  autoInvoiceTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  autoInvoiceDescription: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 20,
  },
  // Invoice Preview Styles
  invoicePreview: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginTop: 8,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 16,
  },
  invoiceCompanyName: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  invoiceCompanyDetails: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  invoiceNumberContainer: {
    alignItems: 'flex-end',
  },
  invoiceNumberLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textLight,
  },
  invoiceNumber: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  invoiceDetailsGrid: {
    marginBottom: 16,
  },
  invoiceDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  invoiceDetailLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
  },
  invoiceDetailValue: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  invoiceTable: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
  },
  invoiceTableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGray,
    padding: 12,
  },
  invoiceTableHeaderText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  invoiceTableRow: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  invoiceTableCell: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
  },
  invoiceTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: COLORS.primary + '10',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  invoiceTotalLabel: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  invoiceTotalAmount: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  invoiceStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success + '15',
    borderRadius: 8,
    padding: 8,
    gap: 6,
  },
  invoiceStatusText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
  },
  invoiceButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: SPACING.md,
  },
  invoiceButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  invoiceButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  // Staff Details Modal Styles
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
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
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
  detailsModalBody: {
    padding: 20,
  },
  // Medical Report Form / Preview (full-screen)
  reportModalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  reportModalHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  reportHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportHeaderTitle: {
    flex: 1,
    marginHorizontal: 12,
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    opacity: 0.98,
  },
  reportModalTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
  },
  reportModalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportModalScroll: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  reportModalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    gap: 12,
  },
  reportDocCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    marginBottom: 12,
    backgroundColor: COLORS.white,
    borderRadius: 0,
    overflow: 'hidden',
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  reportDocHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  reportLogo: {
    width: 90,
    height: 70,
    marginBottom: 6,
  },
  reportDocTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
    textAlign: 'center',
  },
  reportDocLine: {
    height: 2,
    width: '100%',
    backgroundColor: COLORS.primary,
    marginTop: 10,
  },
  reportSectionTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginTop: 10,
    marginBottom: 8,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  reportLabel: {
    width: 140,
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  reportValue: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
  },
  reportBodyText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 18,
  },
  reportNotesBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: COLORS.lightGray,
    minHeight: 80,
  },
  reportNotesText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 18,
  },
  reportSpacer: {
    height: 10,
  },
  nurseDetailsSection: {
    gap: 16,
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
  detailSubValue: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  clientDetailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  clientDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  clientAvatarWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    overflow: 'hidden',
  },
  clientAvatarImage: {
    width: '100%',
    height: '100%',
  },
  clientAvatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientDetailsInfo: {
    flex: 1,
  },
  clientDetailsName: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  clientDetailsMeta: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginTop: 2,
  },
  clientDetailsMetaSmall: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  clientDetailsDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
  clientDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 6,
  },
  clientDetailsRowContent: {
    flex: 1,
  },
  clientDetailsRowLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  clientDetailsRowValue: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  // Assignment type summary
  assignmentTypeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '0D',
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '26',
  },
  assignmentTypeContent: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  assignmentTypeLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  assignmentTypeValue: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: SPACING.sm,
    fontFamily: 'Poppins_400Regular',
  },
  // Split Schedule Nurse Card Styles (match nurse modal)
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
  splitNurseResponseIcon: {
    marginLeft: SPACING.sm,
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
  splitNurseDaysLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  splitNurseDaysScroll: {
    marginTop: SPACING.xs,
  },
  splitNurseDayPill: {
    marginRight: SPACING.sm,
    borderRadius: 20,
    overflow: 'hidden',
  },
  splitNurseDayPillGradient: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitNurseDayPillText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
    textAlign: 'center',
  },
  splitNurseTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
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
  // Backup nurses display
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
    width: 32,
    height: 32,
    borderRadius: 16,
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
  // Horizontal time row styles
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: 20,
  },
  timeItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timeContent: {
    flex: 1,
  },
  timeLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  timeValue: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  timeSecondary: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  timeDashContainer: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeDash: {
    fontSize: 20,
    color: COLORS.border,
    marginHorizontal: SPACING.xs,
  },
  timeDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  clockDetailsButton: {
    marginTop: SPACING.sm,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  clockDetailsButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.xs,
  },
  clockDetailsButtonText: {
    color: COLORS.white,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
  },
  detailsNotes: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 22,
    marginTop: 8,
  },
  // Modal Footer Action Buttons
  modalNotesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginRight: 10,
    flex: 1,
  },
  modalNotesButtonText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  notesOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notesContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    margin: 20,
    width: '90%',
    maxWidth: 400,
  },
  notesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  notesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundLight,
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  locationText: {
    fontSize: 14,
    color: COLORS.text,
    marginLeft: 8,
    flex: 1,
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
  shiftCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  shiftCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  shiftAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12,
    backgroundColor: '#E6ECF5',
    overflow: 'hidden',
  },
  shiftAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 12,
    backgroundColor: '#E6ECF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftNurseName: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  shiftNurseMeta: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  shiftNurseCode: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
  },
  shiftStatusChip: {
    borderRadius: 16,
    overflow: 'hidden',
    marginLeft: 8,
  },
  shiftStatusChipGradient: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shiftStatusChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  shiftRowText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
    flex: 1,
  },
  shiftDaysContainer: {
    marginBottom: 12,
  },
  shiftDaysLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 6,
  },
  shiftDayPill: {
    marginRight: 8,
  },
  shiftDayPillGradient: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  shiftDayPillText: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  shiftTimeGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  shiftTimeDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  shiftTimeItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shiftTimeContent: {
    flex: 1,
  },
  shiftTimeLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  shiftTimeValue: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  shiftHelperText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  shiftDurationText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
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
    marginBottom: 12,
  },
  nurseInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nurseClockPhoto: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  nurseClockPhotoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nurseClockInfo: {
    flex: 1,
    marginLeft: 12,
  },
  nurseClockName: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  nurseClockCode: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: 'Poppins_400Regular',
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
  clockDetailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  clockDetailsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  clockDetailsCardHeaderText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  clockDetailsSection: {
    marginTop: 8,
  },
  clockDetailsDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  clockDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  clockDetailsTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginLeft: 8,
  },
  clockDetailsContent: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  clockDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  clockDetailsItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  clockDetailsLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: 'Poppins_400Regular',
    marginTop: 4,
    marginBottom: 2,
  },
  clockDetailsValue: {
    fontSize: 14,
    color: COLORS.text,
    fontFamily: 'Poppins_600SemiBold',
  },
  clockDetailsTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent + '10',
    padding: 8,
    borderRadius: 8,
  },
  clockDetailsTotalLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontFamily: 'Poppins_500Medium',
    marginLeft: 6,
    marginRight: 6,
  },
  clockDetailsTotalValue: {
    fontSize: 14,
    color: COLORS.accent,
    fontFamily: 'Poppins_700Bold',
  },
  notesInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 100,
    marginBottom: 16,
    textAlignVertical: 'top',
  },
  signatureInput: {
    minHeight: 44,
    height: 44,
    marginBottom: 0,
    textAlignVertical: 'center',
  },
  notesSaveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesSaveButtonText: {
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 16,
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
  modalFooterSingle: {
    flexDirection: 'column',
  },
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
  modalAssignButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalAssignButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAssignButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  recurringInfoBanner: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 12,
  },
  recurringInfoBannerError: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  recurringInfoIcon: {
    marginTop: 4,
  },
  recurringInfoTextWrapper: {
    flex: 1,
  },
  recurringInfoTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
    marginBottom: 6,
  },
  recurringInfoTitleError: {
    color: COLORS.error,
  },
  recurringInfoText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 19,
  },
  deleteButtonContainer: {
    marginTop: 30,
    marginBottom: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF4444',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Recurring Schedule Day Selection Styles
  daysContainerCompact: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 20,
    gap: 6,
  },
  dayPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillSelected: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  dayPillTextSelected: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  daysContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  dayButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  dayButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.card,
  },
  dayButtonText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
  },
  dayButtonTextSelected: {
    color: COLORS.primary,
  },
  // Billing Management Styles
  // Floating Action Button styles

  // Form input styles for recurring schedule modal
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
  pickerInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: COLORS.white,
  },
  pickerInput: {
    fontSize: 14,
    marginLeft: 10,
  },
  // Service chip styles
  serviceScrollView: {
    marginTop: 8,
  },
  serviceScrollContent: {
    paddingRight: 20,
  },
  serviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    gap: 6,
  },
  serviceChipSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    gap: 6,
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
  // Frequency Pill Styles
  frequencyScrollView: {
    marginBottom: 20,
  },
  frequencyScrollContent: {
    paddingRight: 20,
    gap: 8,
  },
  frequencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  frequencyPillSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  frequencyPillText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  frequencyPillTextSelected: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Billing Cycle Chip Styles
  billingCycleScrollView: {
    marginBottom: 20,
  },
  billingCycleScrollContent: {
    paddingRight: 20,
    gap: 8,
  },
  cycleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  cycleChipSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  cycleChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  cycleChipTextSelected: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Inline Picker Styles
  inlinePickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
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
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  pickerCloseButton: {
    padding: 8,
  },
  pickerConfirmButton: {
    marginTop: 16,
    borderRadius: 10,
    overflow: 'hidden',
  },
  pickerConfirmGradient: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerConfirmText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Client search styles
  clientSearchContainer: {
    position: 'relative',
  },
  clientSearchInput: {
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
    paddingVertical: 12,
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
  // Photo Upload Styles
  photoUploadContainer: {
    marginBottom: SPACING.lg,
  },
  photoUploadButton: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary + '10',
    minHeight: 120,
  },
  photoUploadText: {
    fontSize: 16,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  photoUploadSubtext: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  photoPreviewContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  photoPreview: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  photoActions: {
    flexDirection: 'row',
    padding: SPACING.sm,
    backgroundColor: COLORS.background,
  },
  changePhotoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.sm,
    marginRight: SPACING.xs,
  },
  removePhotoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error,
    borderRadius: 8,
    padding: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  changePhotoText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
    marginLeft: SPACING.xs,
  },
  removePhotoText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
    marginLeft: SPACING.xs,
  },
  // Split Nurse Card Styles (for shift requests)
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
  splitNurseCardActive: {
    borderColor: '#10B981',
    backgroundColor: '#ECFDF5',
  },
  splitNurseCardFaded: {
    opacity: 0.45,
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
  splitNurseHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginBottom: SPACING.sm,
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
  // Primary Nurse Selection Styles (inline modal)
  primaryNurseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    gap: SPACING.md,
  },
  primaryNurseAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E6ECF5',
  },
  primaryNurseAvatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  primaryNurseInfo: {
    flex: 1,
  },
  primaryNurseName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  primaryNurseMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  primaryNurseCode: {
    fontSize: 12,
    color: COLORS.primary,
    marginTop: 2,
  },
  primaryNurseSelectButton: {
    borderRadius: 20,
    overflow: 'hidden',
    minWidth: 80,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryNurseSelectGradient: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryNurseSelectText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
