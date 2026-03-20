import TouchableWeb from "../components/TouchableWeb";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  Image,
  TextInput,
  Keyboard,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { buttonStyles } from '../styles/ButtonStyles';
import { useAuth } from '../context/AuthContext';
import { useAppointments } from '../context/AppointmentContext';
import { useShifts } from '../context/ShiftContext';
import { useNotifications } from '../context/NotificationContext';
import { useNurses } from '../context/NurseContext';
import { useServices } from '../context/ServicesContext';
import RecurringShiftDetailsModal from '../components/RecurringShiftDetailsModal';
import InvoiceService from '../services/InvoiceService';
import ApiService from '../services/ApiService';
import FygaroPaymentService from '../services/FygaroPaymentService';
import FirebaseService from '../services/FirebaseService';
import { getNurseName, formatTimeTo12Hour } from '../utils/formatters';
import NurseInfoCard from '../components/NurseInfoCard';
import NotesAccordionList from '../components/NotesAccordionList';

export default function AppointmentsScreen({ navigation, route }) {
  const { user } = useAuth();
  const { getUpcomingAppointments, getAppointmentHistory, appointments, clearAllAppointments, cancelAppointment, refreshAppointments } = useAppointments();
  const { shiftRequests } = useShifts(); // Add shift context to show approved shifts to patient
  const { sendNotificationToUser } = useNotifications();
  const { nurses } = useNurses(); // Get nurses list to resolve nurse names
  const { services } = useServices();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('upcoming');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [recurringShiftDetailsModalVisible, setRecurringShiftDetailsModalVisible] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [appointmentInvoices, setAppointmentInvoices] = useState([]);
  const [selectedInvoicePreview, setSelectedInvoicePreview] = useState(null);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const lastAutoInvoiceAttemptRef = useRef({ key: null, at: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  
  // Nurse Notes Access Control
  const [nurseNotesUnlocked, setNurseNotesUnlocked] = useState({});
  const [showConfidentialityModal, setShowConfidentialityModal] = useState(false);
  const [confidentialityAccepted, setConfidentialityAccepted] = useState(false);
  const [currentAppointmentForNotes, setCurrentAppointmentForNotes] = useState(null);
  const [shouldReopenDetailsAfterConfidentiality, setShouldReopenDetailsAfterConfidentiality] = useState(false);

  // Medical Report Request (paid)
  const [medicalReportModalVisible, setMedicalReportModalVisible] = useState(false);
  const [medicalReportEmail, setMedicalReportEmail] = useState('');
  const [medicalReportSubmitting, setMedicalReportSubmitting] = useState(false);
  
  // Date/Time Picker State
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());
  const [pickerTime, setPickerTime] = useState(new Date());

  const companyDetails = {
    companyName: '876 Nurses Home Care Services Limited',
    fullName: '876 NURSES HOME CARE SERVICES LIMITED',
    address: '60 Knutsford Blvd, Panjam Building, 9th Floor - Regus, Kingston 5, Jamaica, West Indies',
    phone: '(876) 618-9876',
    email: '876nurses@gmail.com',
    taxId: '',
    website: 'www.876nurses.com'
  };

  const paymentInfo = {
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
  };

  // Handle deep linking/navigation from other screens
  useEffect(() => {
    if (route.params?.highlightId || route.params?.openAppointmentDetails) {
      const highlightId = route.params.highlightId || route.params.appointmentId;
      const requestedTab = route.params?.appointmentTab || null;
      const requestedModalType = route.params?.appointmentModalType || null; // 'details' | 'recurring'

      const normalizeClockMs = (value) => {
        if (!value) return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;

        // Firestore Timestamp
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

      const hasClockedOutForAnyNurse = (shift) => {
        const clockMap = shift?.clockByNurse;
        if (!clockMap || typeof clockMap !== 'object') return false;
        const entries = Object.values(clockMap).filter((v) => v && typeof v === 'object');
        if (entries.length === 0) return false;

        return entries.some((entry) => {
          const inTime = entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
          const outTime = entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt;
          if (!outTime) return false;
          const inMs = normalizeClockMs(inTime);
          const outMs = normalizeClockMs(outTime);
          if (!Number.isFinite(outMs)) return false;
          if (Number.isFinite(inMs)) return outMs > inMs;
          return true;
        });
      };
      
      // Find the appointment in upcoming or past lists
      // We need to wait for appointments to be loaded, but since we're using context, 
      // we can try to find it in the current lists
      
      const findAndHighlight = () => {
        const upcoming = getUpcomingAppointments();
        const past = getAppointmentHistory();
        const shifts = shiftRequests || [];

        const openRequestedModal = (record) => {
          if (!record) return;
          setSelectedAppointment(record);

          if (requestedModalType === 'details') {
            setDetailsModalVisible(true);
            return;
          }
          if (requestedModalType === 'recurring') {
            setRecurringShiftDetailsModalVisible(true);
            return;
          }

          const isRecurring = record.isRecurring || record.recurringScheduleId || record.recurringSchedule;
          if (isRecurring) {
            setRecurringShiftDetailsModalVisible(true);
          } else {
            setDetailsModalVisible(true);
          }
        };

        const findInUpcoming = () => upcoming.find((a) => a?.id === highlightId) || null;
        const findInPast = () => past.find((a) => a?.id === highlightId) || null;
        const findInShifts = () => shifts.find((s) => s?.id === highlightId) || null;
        
        // If caller explicitly wants the details modal, do NOT fall back to shifts
        // (prevents reopening the wrong recurring/shift modal when IDs overlap).
        const allowShiftLookup = requestedModalType !== 'details';

        const setTabIfProvided = (tab, record) => {
          if (requestedTab === 'past' || requestedTab === 'upcoming') {
            setActiveTab(requestedTab);
            return;
          }
          if (tab) setActiveTab(tab);
          if (record && allowShiftLookup && (record?.clockByNurse || record?.nurseSchedule)) {
            const isPast =
              String(record.status || '').toLowerCase() === 'completed' ||
              hasClockedOutForAnyNurse(record);
            setActiveTab(isPast ? 'past' : 'upcoming');
          }
        };

        // Priority order:
        // - If modalType explicitly recurring: shifts first
        // - Else if tab explicitly set: that tab first
        // - Else: upcoming -> shifts -> past (legacy behavior)
        if (requestedModalType === 'recurring') {
          const shift = allowShiftLookup ? findInShifts() : null;
          if (shift) {
            setTabIfProvided(null, shift);
            openRequestedModal(shift);
            return;
          }
        }

        if (requestedTab === 'past') {
          const foundPast = findInPast();
          if (foundPast) {
            setActiveTab('past');
            openRequestedModal(foundPast);
            return;
          }
          const foundUpcoming = findInUpcoming();
          if (foundUpcoming) {
            setActiveTab('upcoming');
            openRequestedModal(foundUpcoming);
            return;
          }
          if (allowShiftLookup) {
            const shift = findInShifts();
            if (shift) {
              setTabIfProvided(null, shift);
              openRequestedModal(shift);
              return;
            }
          }
          return;
        }

        if (requestedTab === 'upcoming') {
          const foundUpcoming = findInUpcoming();
          if (foundUpcoming) {
            setActiveTab('upcoming');
            openRequestedModal(foundUpcoming);
            return;
          }
          if (allowShiftLookup) {
            const shift = findInShifts();
            if (shift) {
              setTabIfProvided(null, shift);
              openRequestedModal(shift);
              return;
            }
          }
          const foundPast = findInPast();
          if (foundPast) {
            setActiveTab('past');
            openRequestedModal(foundPast);
            return;
          }
          return;
        }

        // Legacy fallback
        const foundUpcoming = findInUpcoming();
        if (foundUpcoming) {
          setActiveTab('upcoming');
          openRequestedModal(foundUpcoming);
          return;
        }

        if (allowShiftLookup) {
          const shift = findInShifts();
          if (shift) {
            setTabIfProvided(null, shift);
            openRequestedModal(shift);
            return;
          }
        }

        const foundPast = findInPast();
        if (foundPast) {
          setActiveTab('past');
          openRequestedModal(foundPast);
          return;
        }
      };

      // Small delay to ensure data is ready if coming from a fresh load
      setTimeout(findAndHighlight, 500);
      
      // Clear the param so it doesn't trigger again on simple re-renders
      navigation.setParams({
        highlightId: null,
        openAppointmentDetails: null,
        appointmentId: null,
        appointmentTab: null,
        appointmentModalType: null,
      });
    }
  }, [route.params?.highlightId, route.params?.openAppointmentDetails, appointments, shiftRequests]);

  // Refresh appointments when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      // Throttle refresh to prevent rapid API calls
      const now = Date.now();
      const lastRefresh = global.lastAppointmentRefresh || 0;
      
      if (now - lastRefresh > 2000) { // Only refresh if 2+ seconds since last call
        global.lastAppointmentRefresh = now;
        refreshAppointments();
      }
    }, [refreshAppointments])
  );

  // Helper function to format address object to string
  const formatAddress = (address) => {
    if (!address) return 'Address on file';
    
    // If it's already a string, return it
    if (typeof address === 'string') return address;
    
    // If it's an object, format it
    if (typeof address === 'object') {
      const parts = [];
      if (address.street) parts.push(address.street);
      if (address.parish) parts.push(address.parish);
      if (address.city) parts.push(address.city);
      if (address.postalCode) parts.push(address.postalCode);
      if (address.country) parts.push(address.country);
      
      return parts.length > 0 ? parts.join(', ') : 'Address on file';
    }
    
    return 'Address on file';
  };

  // Helper function to resolve nurse name from nurseId if nurseName is missing
  const resolveNurseName = (appointment) => {
    if (appointment.nurseName) {
      return appointment.nurseName;
    }
    
    if (appointment.nurseId) {
      // Try to find nurse in nurses list
      const foundNurse = nurses.find(n => n.id === appointment.nurseId);
      if (foundNurse) {
        return getNurseName(foundNurse);
      }
    }
    
    return null;
  };

  const resolveAssignedNurse = (appointment) => {
    if (!appointment) return null;

    const normalizeId = (value) => {
      if (value === undefined || value === null) return null;
      const str = String(value).trim();
      return str ? str : null;
    };

    const normalizeCode = (value) => {
      if (value === undefined || value === null) return null;
      const str = String(value).trim();
      return str ? str.toUpperCase() : null;
    };

    // For backup coverage flows, keep Assigned Nurse = the nurse who requested backup (if present).
    const coverageList = Array.isArray(appointment.coverageRequests) ? appointment.coverageRequests : [];
    const acceptedCoverage = coverageList.find((cr) => {
      if (!cr) return false;
      const s = String(cr.status || '').toLowerCase();
      return s.includes('accept');
    }) || null;

    if (acceptedCoverage?.requestingNurseId || acceptedCoverage?.requestingNurseName) {
      const requestingId = acceptedCoverage.requestingNurseId || null;
      const requestingCode = acceptedCoverage.requestingNurseCode || null;

      const matched = (requestingId || requestingCode)
        ? nurses.find((nurse) => {
            const nId = normalizeId(nurse.id || nurse._id || nurse.uid || nurse.nurseId);
            const nCode = normalizeCode(nurse.nurseCode || nurse.staffCode || nurse.code || nurse.username);
            const wantId = requestingId ? String(requestingId).trim() : null;
            const wantCode = requestingCode ? String(requestingCode).trim().toUpperCase() : null;
            if (wantId && nId && String(nId) === wantId) return true;
            if (wantCode && nCode && String(nCode) === wantCode) return true;
            return false;
          })
        : null;

      if (matched) return matched;

      return {
        id: requestingId || 'requesting-nurse',
        nurseId: requestingId || 'requesting-nurse',
        name: acceptedCoverage.requestingNurseName || 'Assigned Nurse',
        nurseName: acceptedCoverage.requestingNurseName || 'Assigned Nurse',
        nurseCode: requestingCode || null,
        staffCode: requestingCode || null,
        code: requestingCode || null,
      };
    }

    const candidateId =
      appointment.nurseId ||
      appointment.assignedNurseId ||
      appointment.assignedNurse?.id ||
      appointment.assignedNurse?._id ||
      appointment.nurse?.id ||
      appointment.nurse?._id;

    const matchedNurse = nurses.find((nurse) =>
      String(nurse.id || nurse._id || nurse.nurseId) === String(candidateId)
    );

    if (matchedNurse) {
      return matchedNurse;
    }

    const fallbackName =
      resolveNurseName(appointment) ||
      appointment.assignedNurse?.name ||
      appointment.nurse?.name;

    if (!fallbackName) {
      return null;
    }

    return {
      id: candidateId || appointment.nurseId || appointment.assignedNurseId,
      name: fallbackName,
      nurseName: fallbackName,
      nurseCode:
        appointment.assignedNurse?.nurseCode ||
        appointment.nurseCode ||
        appointment.nurse?.nurseCode,
      nurseIdPhoto:
        appointment.assignedNurse?.nurseIdPhoto ||
        appointment.nurseIdPhoto,
      profilePhoto:
        appointment.assignedNurse?.profilePhoto ||
        appointment.profilePhoto,
      profileImage:
        appointment.assignedNurse?.profileImage ||
        appointment.profileImage,
      photoUrl: appointment.assignedNurse?.photoUrl || appointment.photoUrl,
      specialty:
        appointment.assignedNurse?.specialty ||
        appointment.nurse?.specialty,
      specialization:
        appointment.assignedNurse?.specialization ||
        appointment.nurse?.specialization,
      phone: appointment.assignedNurse?.phone || appointment.nurse?.phone,
      email: appointment.assignedNurse?.email || appointment.nurse?.email,
    };
  };

  const resolveRequestedNurse = (appointment) => {
    if (!appointment) return null;

    const candidateId =
      appointment.preferredNurseId ||
      appointment.requestedNurseId ||
      appointment.preferredNurse?.id ||
      appointment.preferredNurse?._id ||
      appointment.requestedNurse?.id ||
      appointment.requestedNurse?._id ||
      appointment.primaryNurseId ||
      null;

    const matchedNurse = candidateId
      ? nurses.find((nurse) =>
          String(nurse.id || nurse._id || nurse.nurseId) === String(candidateId)
        )
      : null;

    if (matchedNurse) {
      return matchedNurse;
    }

    const fallbackName =
      appointment.preferredNurseName ||
      appointment.requestedNurseName ||
      appointment.primaryNurseName ||
      appointment.selectedNurseName ||
      appointment.requestedNurse ||
      appointment.preferredNurse?.name ||
      appointment.requestedNurse?.name ||
      appointment.primaryNurse?.name ||
      null;

    if (!fallbackName) {
      return null;
    }

    return {
      id: candidateId,
      name: fallbackName,
      nurseName: fallbackName,
      nurseCode:
        appointment.preferredNurseCode ||
        appointment.requestedNurseCode ||
        appointment.preferredNurse?.nurseCode ||
        appointment.requestedNurse?.nurseCode,
    };
  };

  const assignedNurseForModal = selectedAppointment
    ? resolveAssignedNurse(selectedAppointment)
    : null;

  const requestedNurseForModal = selectedAppointment
    ? resolveRequestedNurse(selectedAppointment)
    : null;

  const selectedAppointmentStatusLower = String(selectedAppointment?.status || '').toLowerCase();
  const isPendingLikeAppointment = ['pending', 'assigned', 'requested', 'awaiting', 'unassigned'].includes(selectedAppointmentStatusLower);

  const parseDateValue = (value) => {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }

    if (typeof value?.toDate === 'function') {
      try {
        const date = value.toDate();
        return Number.isNaN(date?.getTime()) ? null : date;
      } catch (error) {
        return null;
      }
    }

    if (typeof value === 'object' && typeof value.seconds === 'number') {
      const millis = value.seconds * 1000 + (typeof value.nanoseconds === 'number' ? Math.floor(value.nanoseconds / 1e6) : 0);
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      // Handle YYYY-MM-DD strings as local dates to avoid timezone shifts
      const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const [, yearStr, monthStr, dayStr] = dateOnlyMatch;
        const year = Number(yearStr);
        const month = Number(monthStr) - 1;
        const day = Number(dayStr);
        const date = new Date(year, month, day, 0, 0, 0, 0);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed);
      }
    }

    return null;
  };

  const formatCompactCardDate = (value) => {
    const date = parseDateValue(value);
    if (!date) return null;
    try {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch (e) {
      return null;
    }
  };

  const resolveLatestClockOutValue = (clockByNurse) => {
    if (!clockByNurse || typeof clockByNurse !== 'object') return null;
    try {
      const entries = Object.values(clockByNurse).filter((v) => v && typeof v === 'object');
      let best = null;
      let bestMs = null;

      for (const entry of entries) {
        const raw =
          entry.lastClockOutTime ||
          entry.actualEndTime ||
          entry.clockOutTime ||
          entry.completedAt ||
          null;
        if (!raw) continue;
        const ms = parseDateValue(raw)?.getTime?.();
        if (!Number.isFinite(ms)) continue;
        if (bestMs === null || ms > bestMs) {
          bestMs = ms;
          best = raw;
        }
      }

      return best;
    } catch (e) {
      return null;
    }
  };

  const getPastCardDateLabel = (appointment) => {
    if (!appointment) return null;

    const completionRaw =
      appointment.completedAt ||
      appointment.actualEndTime ||
      appointment.clockOutTime ||
      appointment.lastClockOutTime ||
      appointment.lastActualEndTime ||
      appointment.lastCompletedAt ||
      resolveLatestClockOutValue(appointment.clockByNurse) ||
      null;

    const completionText = completionRaw ? formatCompactCardDate(completionRaw) : null;
    if (completionText) {
      return `Completed: ${completionText}`;
    }

    const scheduledRaw =
      appointment.date ||
      appointment.appointmentDate ||
      appointment.scheduledDate ||
      appointment.startDate ||
      appointment.shiftDate ||
      null;

    const scheduledText = scheduledRaw ? formatCompactCardDate(scheduledRaw) : null;
    return scheduledText ? `Date: ${scheduledText}` : 'Date: N/A';
  };

  const getShiftScheduleBounds = (shift) => {
    if (!shift) {
      return { startDate: null, endDate: null, isRecurringShift: false };
    }

    const startFieldCandidates = [
      shift.date,
      shift.startDate,
      shift.recurringStartDate,
      shift.recurringPeriodStart,
      shift.recurringStart,
      shift.scheduledDate,
      shift.shiftDate,
      shift.preferredDate,
      shift.appointmentDate,
    ];

    let startDate = null;
    for (const field of startFieldCandidates) {
      const parsed = parseDateValue(field);
      if (parsed) {
        startDate = parsed;
        break;
      }
    }

    const endFieldCandidates = [
      shift.recurringEndDate,
      shift.recurringPeriodEnd,
      shift.recurringEnd,
      shift.endDate,
      shift.shiftEndDate,
      shift.expectedEndDate,
    ];

    let endDate = null;
    for (const field of endFieldCandidates) {
      const parsed = parseDateValue(field);
      if (parsed) {
        endDate = parsed;
        break;
      }
    }

    const isRecurringShift = Boolean(
      shift.isRecurring ||
      shift.adminRecurring ||
      shift.recurringScheduleId ||
      shift.recurringDaysOfWeek?.length ||
      (typeof shift.assignmentType === 'string' && shift.assignmentType.toLowerCase().includes('split')) ||
      (typeof shift.service === 'string' && shift.service.toLowerCase().includes('recurring'))
    );

    return { startDate, endDate, isRecurringShift };
  };

  const normalizeIdentifier = (value) => {
    if (value === undefined || value === null) {
      return null;
    }
    const stringValue = String(value).trim();
    return stringValue ? stringValue.toLowerCase() : null;
  };

  const patientIdCandidates = React.useMemo(() => {
    const ids = new Set();
    const addId = (val) => {
      const normalized = normalizeIdentifier(val);
      if (normalized) {
        ids.add(normalized);
      }
    };

    addId(patientId);
    addId(user?.id);
    addId(user?._id);
    addId(user?.uid);
    addId(user?.userId);
    addId(user?.clientId);
    addId(user?.patientId);
    addId(user?.profileId);
    addId(user?.legacyPatientId);

    if (Array.isArray(user?.linkedPatientIds)) {
      user.linkedPatientIds.forEach(addId);
    }

    const username = user?.username ? String(user.username).toLowerCase() : '';
    if (username === 'testpatient') {
      ['PATIENT001', 'patient-001', 'patient001', '1'].forEach(addId);
    }

    if (patientId && String(patientId).toUpperCase() === 'PATIENT001') {
      ['PATIENT001', 'patient-001', 'patient001', '1'].forEach(addId);
    }

    return ids;
  }, [patientId, user]);

  const patientNameCandidates = React.useMemo(() => {
    const names = new Set();
    const addName = (val) => {
      if (!val) {
        return;
      }
      const name = String(val).trim();
      if (!name) {
        return;
      }
      names.add(name.toLowerCase());
    };

    addName(user?.name);
    addName(user?.displayName);
    addName(user?.legalName);
    addName(user?.username && !user.username.includes('@') ? user.username : null);

    if (user?.firstName || user?.lastName) {
      addName(`${user?.firstName || ''} ${user?.lastName || ''}`);
    }

    if (Array.isArray(user?.knownAliases)) {
      user.knownAliases.forEach(addName);
    }

    return names;
  }, [user]);

  const patientEmailCandidates = React.useMemo(() => {
    const emails = new Set();
    const addEmail = (val) => {
      if (!val) {
        return;
      }
      const email = String(val).trim().toLowerCase();
      if (!email) {
        return;
      }
      emails.add(email);
    };

    addEmail(user?.email);
    addEmail(user?.contactEmail);

    if (Array.isArray(user?.emails)) {
      user.emails.forEach(addEmail);
    }

    return emails;
  }, [user]);

  const matchesCurrentPatient = React.useCallback(
    (record) => {
      if (!record) {
        return false;
      }

      const recordIdCandidates = [
        record.clientId,
        record.client?._id,
        record.client?.id,
        record.clientUid,
        record.clientUserId,
        record.patientId,
        record.patient?._id,
        record.patient?.id,
        record.patientUid,
        record.patientUserId,
        record.patientProfileId,
        record.patientProfile?._id,
        record.patientProfile?.id,
        record.userId,
        record.user?._id,
        record.user?.id,
        record.userUid,
        record.contactId,
        record.contact?._id,
        record.contact?.id,
        record.contactUid,
      ]
        .map(normalizeIdentifier)
        .filter(Boolean);

      if (recordIdCandidates.some((id) => patientIdCandidates.has(id))) {
        return true;
      }

      const recordNames = [
        record.clientName,
        record.client?.name,
        record.clientFullName,
        record.patientName,
        record.patient?.name,
        record.patientFullName,
        record.contactName,
        record.contact?.name,
      ]
        .filter(Boolean)
        .map((name) => name.toString().trim().toLowerCase())
        .filter(Boolean);

      if (recordNames.some((name) => patientNameCandidates.has(name))) {
        return true;
      }

      const recordEmails = [
        record.clientEmail,
        record.client?.email,
        record.patientEmail,
        record.patient?.email,
        record.contactEmail,
        record.contact?.email,
      ]
        .filter(Boolean)
        .map((email) => email.toString().trim().toLowerCase())
        .filter(Boolean);

      if (recordEmails.some((email) => patientEmailCandidates.has(email))) {
        return true;
      }

      return false;
    },
    [patientEmailCandidates, patientIdCandidates, patientNameCandidates]
  );

  // Log user and context state on mount and updates
  // useEffect(() => {
  //   console.log('📱 AppointmentsScreen mounted/updated');
  //   console.log('  User:', user ? `${user.id} (${user.role})` : 'null');
  //   console.log('  ShiftRequests from context:', shiftRequests?.length || 0);
  // }, [user, shiftRequests]);

  // Clear all appointments function
  const handleClearAllAppointments = () => {
    Alert.alert(
      'Clear All Appointments',
      'Are you sure you want to delete ALL appointments? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear All', 
          style: 'destructive',
          onPress: async () => {
            await clearAllAppointments();
            Alert.alert('Success', 'All appointments have been cleared');
          }
        }
      ]
    );
  };

  // Handle viewing invoice with full data generation
  const handleViewInvoice = async (appointment) => {
    try {
      // Check if appointment is recurring
      const isRecurring = appointment.isRecurring || 
                         appointment.recurring || 
                         (appointment.serviceType && appointment.serviceType.includes('Recurring')) ||
                         (appointment.service && appointment.service.includes('Recurring'));

      const isShiftLike = Boolean(
        appointment?.isShiftRequest ||
        appointment?.isShift ||
        appointment?.clockByNurse ||
        appointment?.nurseSchedule ||
        String(appointment?.assignmentType || '').toLowerCase() === 'split-schedule'
      );

      // Allow invoice generation for shift-like items even if flagged recurring.
      if (isRecurring && !isShiftLike) {
        Alert.alert(
          'Recurring Appointment',
          'Invoices for recurring appointments are generated biweekly and sent via email. You can view them in your email or the Invoices section.',
          [{ text: 'OK' }]
        );
        return;
      }

      const resolvedShiftId =
        appointment?.shiftRequestId ||
        appointment?.shiftId ||
        appointment?.requestId ||
        appointment?.assignmentId ||
        appointment?.documentId ||
        appointment?.id ||
        appointment?._id ||
        null;

      const dateKey = (() => {
        const raw = appointment?.date || appointment?.appointmentDate || appointment?.startDate || appointment?.scheduledDate || null;
        if (!raw) return null;
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
        const d = new Date(raw);
        if (!Number.isFinite(d.getTime())) return null;
        const yyyy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      })();

      const visitKey = resolvedShiftId && dateKey ? `${resolvedShiftId}:${dateKey}` : null;

      const resolvedAppointmentId =
        (isShiftLike && visitKey) ||
        appointment?.id ||
        appointment?.appointmentId ||
        appointment?._id ||
        resolvedShiftId;

      // Create comprehensive appointment data for invoice
      const appointmentData = {
        id: resolvedAppointmentId,
        relatedAppointmentId: resolvedAppointmentId,
        shiftRequestId: resolvedShiftId,
        clientId: user?.id || 'patient-current',
        clientName: appointment.patientName || user?.name || 'Valued Client',
        clientEmail: appointment.patientEmail || user?.email || 'client@example.com',
        clientPhone: appointment.patientPhone || user?.phone || appointment.phone || 'N/A',
        clientAddress: appointment.address || user?.address || 'Address on file',
        serviceName: appointment.service,
        serviceType: appointment.service,
        appointmentDate: appointment.date,
        appointmentTime: formatTimeTo12Hour(appointment.time || appointment.scheduledTime) || '10:00 AM',
        status: 'completed',
        notes: appointment.completionNotes || appointment.nurseNotes || appointment.notes || 'Professional nursing services provided',
        duration: appointment.duration || '1 hour',
        hoursWorked: appointment.hoursWorked || 1,
        nurseId: appointment.nurseId || 'NURSE001',
        nurseName: resolveNurseName(appointment) || 'Care Professional',
        paymentMethod: 'Credit Card',
        isRecurring: false,
        totalSessions: 1
      };

      // No tap-to-generate invoices: only view an existing invoice if it exists.
      const allInvoices = await InvoiceService.getAllInvoices();
      const matching = (allInvoices || []).filter((inv) => {
        const invAppointmentId = String(inv?.appointmentId || inv?.relatedAppointmentId || inv?.appointmentID || '');
        const matchByApptId = invAppointmentId && invAppointmentId === String(resolvedAppointmentId);
        // Fallback: the appointment stores the invoiceId from the deposit flow, so find
        // the matching invoice even if its appointmentId is a temp value.
        const matchByInvoiceId = appointment?.invoiceId && inv?.invoiceId === appointment.invoiceId;
        return matchByApptId || matchByInvoiceId;
      });

      const invoice = matching.length > 0 ? matching[0] : null;
      if (!invoice) {
        Alert.alert('No Invoice Yet', 'No invoice has been generated for this appointment yet.');
        return;
      }

      setDetailsModalVisible(false);
      setTimeout(() => {
        navigation.navigate('InvoiceDisplay', {
          invoiceData: invoice,
          clientName: appointmentData.clientName,
          returnToAppointmentModal: true,
          appointmentId: selectedAppointment?.id || appointment?.id,
          appointmentTab: activeTab,
          appointmentModalType: 'details',
        });
      }, 300);
    } catch (error) {
      console.error('Error viewing invoice:', error);
      Alert.alert('Error', 'Failed to load invoice');
    }
  };

  // Force refresh when appointments change
  useEffect(() => {
    setRefreshKey(prev => prev + 1);
  }, [appointments, shiftRequests]);

  // Reset states when modal closes
  useEffect(() => {
    if (!detailsModalVisible && !recurringShiftDetailsModalVisible) {
      // Use setTimeout to defer state updates and prevent UI freeze during modal close animation
      const timer = setTimeout(() => {
        setIsEditing(false);
        setShowDatePicker(false);
        setShowTimePicker(false);
        setAppointmentInvoices([]);
        setSelectedInvoicePreview(null);
        setIsLoadingInvoices(false);
      }, 300); // Wait for animation to complete
      return () => clearTimeout(timer);
    }
  }, [detailsModalVisible, recurringShiftDetailsModalVisible]);

  // Load invoices when selectedAppointment changes or modal opens
  useEffect(() => {
    const loadInvoicesForAppointment = async () => {
      if (!selectedAppointment) {
        return;
      }

      setIsLoadingInvoices(true);
      try {
        const isShiftLike = Boolean(
          selectedAppointment?.isShiftRequest ||
            selectedAppointment?.isShift ||
            selectedAppointment?.clockByNurse ||
            selectedAppointment?.nurseSchedule ||
            String(selectedAppointment?.assignmentType || '').toLowerCase() === 'split-schedule'
        );

        const dateKey = (() => {
          const raw =
            selectedAppointment?.date ||
            selectedAppointment?.appointmentDate ||
            selectedAppointment?.startDate ||
            selectedAppointment?.scheduledDate ||
            selectedAppointment?.shiftDetails?.date ||
            selectedAppointment?.shiftDetails?.startDate ||
            selectedAppointment?.shift?.date ||
            selectedAppointment?.shift?.startDate ||
            selectedAppointment?.completedAt ||
            selectedAppointment?.actualEndTime ||
            null;

          if (!raw) return null;

          // Already normalized
          if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();

          // Firestore Timestamp
          if (typeof raw === 'object') {
            if (typeof raw.toDate === 'function') {
              const d = raw.toDate();
              if (d instanceof Date && Number.isFinite(d.getTime())) {
                const yyyy = String(d.getFullYear());
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
              }
            }
            if (typeof raw.seconds === 'number') {
              const d = new Date(raw.seconds * 1000);
              if (Number.isFinite(d.getTime())) {
                const yyyy = String(d.getFullYear());
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
              }
            }
          }

          // Handle "Feb 10, 2026" format defensively
          if (typeof raw === 'string') {
            const match = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
            if (match) {
              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const monthIndex = monthNames.findIndex((m) => m === match[1]);
              if (monthIndex !== -1) {
                const d = new Date(parseInt(match[3], 10), monthIndex, parseInt(match[2], 10));
                if (Number.isFinite(d.getTime())) {
                  const yyyy = String(d.getFullYear());
                  const mm = String(d.getMonth() + 1).padStart(2, '0');
                  const dd = String(d.getDate()).padStart(2, '0');
                  return `${yyyy}-${mm}-${dd}`;
                }
              }
            }
          }

          // ISO string / date string
          const d = new Date(raw);
          if (!Number.isFinite(d.getTime())) return null;
          const yyyy = String(d.getFullYear());
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        })();

        const shiftId =
          selectedAppointment?.shiftRequestId ||
          selectedAppointment?.shiftId ||
          selectedAppointment?.requestId ||
          selectedAppointment?.assignmentId ||
          selectedAppointment?.documentId ||
          selectedAppointment?.id ||
          selectedAppointment?._id ||
          null;

        const finalInvoiceIdFromShift =
          selectedAppointment?.finalInvoiceId ||
          selectedAppointment?.finalInvoice ||
          null;

        const visitKey = shiftId && dateKey ? `${shiftId}:${dateKey}` : null;

        // If the appointment has its own id (and we have a dateKey), also try the common
        // visitKey format built from that id. This helps when different screens store
        // the primary identifier under different keys.
        const appointmentIdVisitKey = (selectedAppointment?.id && dateKey)
          ? `${String(selectedAppointment.id)}:${dateKey}`
          : null;

        const appointmentIdentifiers = [
          selectedAppointment?.id,
          selectedAppointment?.appointmentId,
          selectedAppointment?._id,
          selectedAppointment?.shiftId,
          selectedAppointment?.shiftRequestId,
          selectedAppointment?.requestId,
          selectedAppointment?.assignmentId,
          selectedAppointment?.documentId,
          selectedAppointment?.seriesId,
          selectedAppointment?.relatedAppointmentId,
          selectedAppointment?.relatedShiftId,
          selectedAppointment?.originalShiftId,
          selectedAppointment?.sourceShiftId,
          selectedAppointment?.shift?.id,
          selectedAppointment?.shift?._id,
          selectedAppointment?.shiftDetails?.id,
          selectedAppointment?.shiftDetails?._id,
          finalInvoiceIdFromShift,
          visitKey,
          appointmentIdVisitKey,
        ]
          .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
          .map((v) => String(v));

        const collectPrimitiveValuesDeep = (input, maxDepth = 3) => {
          const out = new Set();
          const visited = new Set();

          const visit = (node, depth) => {
            if (node === null || node === undefined) return;
            if (depth > maxDepth) return;

            const t = typeof node;
            if (t === 'string') {
              const trimmed = node.trim();
              if (trimmed) out.add(trimmed);
              return;
            }
            if (t === 'number') {
              if (Number.isFinite(node)) out.add(String(node));
              return;
            }
            if (t !== 'object') return;

            if (visited.has(node)) return;
            visited.add(node);

            if (Array.isArray(node)) {
              node.forEach((item) => visit(item, depth + 1));
              return;
            }

            Object.values(node).forEach((val) => visit(val, depth + 1));
          };

          visit(input, 0);
          return out;
        };

        const selectedAppointmentValueSet = collectPrimitiveValuesDeep(selectedAppointment, 3);

        const normalizeDateValue = (value) => {
          if (!value) return null;

          // Firestore Timestamp
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

          // ISO string / date string
          const ms = Date.parse(value);
          return Number.isFinite(ms) ? ms : null;
        };

        const extractInvoiceSequence = (invoiceIdValue) => {
          if (!invoiceIdValue || typeof invoiceIdValue !== 'string') return null;
          const match = invoiceIdValue.match(/(\d{1,})\s*$/);
          if (!match) return null;
          const seq = parseInt(match[1], 10);
          return Number.isFinite(seq) ? seq : null;
        };

        // Fetch fresh data directly from service (backend) to ensure status is up to date
        // This mirrors the logic in AdminClientsScreen handleShowClientDetails
        const allInvoices = await InvoiceService.getAllInvoices();

        const appointmentClientEmails = [
          selectedAppointment?.patientEmail,
          selectedAppointment?.clientEmail,
          user?.email,
        ]
          .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
          .map((v) => String(v).trim().toLowerCase());

        const normalizeToDayKey = (value) => {
          const ms = normalizeDateValue(value);
          if (ms === null) return null;
          const d = new Date(ms);
          if (!Number.isFinite(d.getTime())) return null;
          const yyyy = String(d.getFullYear());
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        };

        const appointmentDayKey =
          dateKey ||
          normalizeToDayKey(selectedAppointment?.date) ||
          normalizeToDayKey(selectedAppointment?.startDate) ||
          normalizeToDayKey(selectedAppointment?.appointmentDate) ||
          null;

        const normalizeText = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

        let matchingInvoices = allInvoices.filter((inv) => {
          const invoiceIds = [
            inv?.invoiceId,
            inv?.invoiceNumber,
            inv?.relatedAppointmentId,
            inv?.appointmentId,
            inv?.shiftRequestId,
            inv?.shiftRequestID,
            inv?.shiftId,
            inv?.relatedShiftId,
            inv?.visitKey,
            inv?.appointmentKey,
            inv?.sourceAppointmentId,
            inv?.sourceShiftId,
            inv?.originalShiftId,
            inv?.firestoreId,
            inv?.id,
            inv?.metadata?.appointmentId,
            inv?.metadata?.shiftRequestId,
            inv?.meta?.appointmentId,
            inv?.meta?.shiftRequestId,
            inv?.paymentMetadata?.appointmentId,
            inv?.paymentMetadata?.shiftRequestId,
          ]
            .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
            .map((v) => String(v));

          if (invoiceIds.length === 0) return false;

          // First: check if finalInvoiceId matches this invoice's invoiceId
          if (finalInvoiceIdFromShift && (inv?.invoiceId === finalInvoiceIdFromShift || inv?.invoiceNumber === finalInvoiceIdFromShift)) {
            return true;
          }

          // Second: explicit identifiers (preferred)
          if (invoiceIds.some((id) => appointmentIdentifiers.includes(id))) return true;

          // Fallback: sometimes the appointment record stores the shift/invoice linkage
          // under a different field (e.g., seriesId). We treat any nested primitive value
          // on the appointment as a candidate only for matching invoice IDs.
          if (invoiceIds.some((id) => selectedAppointmentValueSet.has(id))) return true;

          // Last resort (read-only): match by client email + service day + service name.
          if (!appointmentDayKey) return false;

          const invoiceDayKey =
            normalizeToDayKey(inv?.serviceDate) ||
            normalizeToDayKey(inv?.date) ||
            normalizeToDayKey(inv?.issueDate) ||
            normalizeToDayKey(inv?.createdAt) ||
            null;

          if (!invoiceDayKey || invoiceDayKey !== appointmentDayKey) return false;

          const invEmail = String(inv?.clientEmail || '').trim().toLowerCase();
          if (invEmail && appointmentClientEmails.length > 0 && !appointmentClientEmails.includes(invEmail)) return false;

          const invService = String(inv?.service || '').trim().toLowerCase();
          const aptService = String(selectedAppointment?.service || selectedAppointment?.serviceType || selectedAppointment?.appointmentType || '').trim().toLowerCase();
          if (invService && aptService && invService !== aptService) return false;

          return true;
        });

        // If no ID-based match exists, try a deterministic fallback using:
        // - same service day
        // - same client email (if invoice email present)
        // - service name similarity (loose contains match)
        if (matchingInvoices.length === 0 && appointmentDayKey) {
          const aptEmailSet = new Set(appointmentClientEmails);
          const aptServiceNorm = normalizeText(
            selectedAppointment?.service || selectedAppointment?.serviceType || selectedAppointment?.appointmentType
          );

          const fallbackCandidates = allInvoices.filter((inv) => {
            const invoiceDayKey =
              normalizeToDayKey(inv?.serviceDate) ||
              normalizeToDayKey(inv?.date) ||
              normalizeToDayKey(inv?.issueDate) ||
              normalizeToDayKey(inv?.createdAt) ||
              null;

            if (!invoiceDayKey || invoiceDayKey !== appointmentDayKey) return false;

            const invEmail = normalizeText(inv?.clientEmail);
            if (invEmail && aptEmailSet.size > 0 && !aptEmailSet.has(invEmail)) return false;

            const invServiceNorm = normalizeText(inv?.service);
            if (invServiceNorm && aptServiceNorm) {
              const serviceMatches = invServiceNorm.includes(aptServiceNorm) || aptServiceNorm.includes(invServiceNorm);
              if (!serviceMatches) return false;
            }

            return true;
          });

          if (fallbackCandidates.length > 0) {
            matchingInvoices = fallbackCandidates;
          }
        }

        const canCreateInvoiceFromClient = ['admin', 'superAdmin', 'nurse'].includes(String(user?.role || '').trim());

        // Auto-backfill: only for staff roles (admin/nurse). Patients should never attempt
        // client-side invoice generation; they should only view invoices already created.
        if (canCreateInvoiceFromClient && activeTab === 'past' && isShiftLike && visitKey && matchingInvoices.length === 0) {
          const lastAttempt = lastAutoInvoiceAttemptRef.current;
          const now = Date.now();
          const canAttempt = lastAttempt.key !== visitKey || now - (lastAttempt.at || 0) > 15000;

          const clockMap = selectedAppointment?.clockByNurse;
          const clockEntries =
            clockMap && typeof clockMap === 'object'
              ? Object.entries(clockMap)
                  .filter(([, v]) => v && typeof v === 'object')
                  .map(([key, entry]) => ({ key, entry }))
              : [];

          const isSplitSchedule =
            String(selectedAppointment?.assignmentType || '').toLowerCase() === 'split-schedule' ||
            (selectedAppointment?.nurseSchedule && typeof selectedAppointment.nurseSchedule === 'object') ||
            clockEntries.length > 1;

          const normalizeClockMs = (value) => {
            if (!value) return null;

            if (typeof value === 'number') {
              return Number.isFinite(value) ? value : null;
            }

            // Firestore Timestamp
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

            // ISO string / date string
            const ms = Date.parse(value);
            return Number.isFinite(ms) ? ms : null;
          };

          const allClockedOut = (() => {
            if (!isSplitSchedule) return false;
            if (clockEntries.length < 2) return false;
            return clockEntries.every(({ entry }) => {
              const inTime = entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
              const outTime = entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt;
              if (!outTime) return false;
              const inMs = normalizeClockMs(inTime);
              const outMs = normalizeClockMs(outTime);
              if (!Number.isFinite(outMs)) return false;
              if (Number.isFinite(inMs)) return outMs > inMs;
              return true;
            });
          })();

          // No automatic invoice generation from the client view.
        }

        // Pick the latest invoice deterministically (handles Firestore Timestamp values and sequencing)
        const sortedInvoices = matchingInvoices.sort((a, b) => {
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

        const primaryInvoice = sortedInvoices.length > 0 ? sortedInvoices[0] : null;

        // Targeted debug for specific shift
        if (__DEV__ && shiftId === 'IFUO3HmNuZ5sO74KFQGb') {
          console.log('[Invoice Match Debug][IFUO3HmNuZ5sO74KFQGb]', {
            shiftId,
            dateKey,
            finalInvoiceIdFromShift,
            appointmentIdentifiers: appointmentIdentifiers.slice(0, 5),
            totalInvoices: allInvoices.length,
            matchingInvoicesCount: matchingInvoices.length,
            matchingInvoiceIds: matchingInvoices.map(i => i?.invoiceId || i?.invoiceNumber).slice(0, 3),
            primaryInvoiceId: primaryInvoice?.invoiceId || primaryInvoice?.invoiceNumber || null,
            selectedAppointmentKeys: Object.keys(selectedAppointment || {}).slice(0, 10),
          });

          if (matchingInvoices.length === 0 && allInvoices.length > 0) {
            const sample = allInvoices.slice(0, 3).map(inv => ({
              invoiceId: inv?.invoiceId || inv?.invoiceNumber,
              shiftRequestId: inv?.shiftRequestId,
              relatedAppointmentId: inv?.relatedAppointmentId,
              appointmentId: inv?.appointmentId,
            }));
            console.log('[Invoice Match Debug][IFUO3HmNuZ5sO74KFQGb][Sample Invoices]', sample);
          }
        }

        setAppointmentInvoices(primaryInvoice ? [primaryInvoice] : []);
        setSelectedInvoicePreview(null); // No preview in modal
      } catch (error) {
        console.error('Error loading invoices for appointment:', error);
        setAppointmentInvoices([]);
        setSelectedInvoicePreview(null);
      } finally {
        setIsLoadingInvoices(false);
      }
    };

    // Only load when a details modal is visible to ensure freshest data when viewing
    if (detailsModalVisible || recurringShiftDetailsModalVisible) {
      loadInvoicesForAppointment();
    }
  }, [activeTab, selectedAppointment, detailsModalVisible, recurringShiftDetailsModalVisible]);

  // Get patient ID first
  const patientId = user?.id;
  
  // Get real appointment data from context
  const upcomingAppointments = getUpcomingAppointments();
  // AppointmentContext history can include shift-request items as appointments.
  // We merge in shiftRequests separately, so filter those out here to avoid duplicates.
  const pastAppointments = (getAppointmentHistory() || []).filter((apt) => !apt?.isShiftRequest);

  const hasAnyAcceptedNurseForShift = React.useCallback((shift) => {
    if (!shift || typeof shift !== 'object') return false;

    const isAccepted = (raw) => {
      const s = String(raw || '').trim().toLowerCase();
      return s === 'accepted' || s.includes('accept');
    };

    const responses = shift?.nurseResponses;
    if (responses && typeof responses === 'object') {
      try {
        for (const entry of Object.values(responses)) {
          if (!entry) continue;
          const status = typeof entry === 'object' ? entry.status : entry;
          if (isAccepted(status)) return true;
        }
      } catch (e) {
        // ignore
      }
    }

    const coverage = Array.isArray(shift?.coverageRequests) ? shift.coverageRequests : [];
    if (coverage.some((cr) => isAccepted(cr?.status))) {
      return true;
    }

    return false;
  }, []);
  
  // Get pending appointments that need patient action
  const pendingAppointments = React.useMemo(() => {
    return appointments.filter(appointment => {
      const matchesPatient = 
        appointment.patientId === patientId ||
        String(appointment.patientId) === String(patientId) ||
        appointment.clientId === patientId ||
        String(appointment.clientId) === String(patientId) ||
        appointment.userId === patientId ||
        String(appointment.userId) === String(patientId) ||
        (appointment.patientName === user?.name) ||
        (appointment.patientName && user?.name && appointment.patientName.toLowerCase() === user.name.toLowerCase());
      
      // Show both pending (no nurse assigned) and assigned (nurse assigned but not accepted) appointments
      return (appointment.status === 'pending' || appointment.status === 'assigned') && matchesPatient;
    });
  }, [appointments, patientId, user?.name, user?.role]);
  
  const approvedShifts = React.useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Set to start of today for comparison
    
    const hasClockedOutForAnyNurse = (shift) => {
      const clockByNurse = shift?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return false;
      const entries = Object.values(clockByNurse);
      if (!Array.isArray(entries) || entries.length === 0) return false;

      return entries.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt || entry.actualStartTime;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt || entry.actualEndTime;
        if (!inTime || !outTime) return false;
        const inMs = Date.parse(inTime);
        const outMs = Date.parse(outTime);
        if (!Number.isFinite(outMs)) return false;
        if (Number.isFinite(inMs)) return outMs > inMs;
        return true;
      });
    };

    const hasAnyActiveClockIn = (shift) => {
      const clockByNurse = shift?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return false;
      const entries = Object.values(clockByNurse);
      if (!Array.isArray(entries) || entries.length === 0) return false;

      return entries.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt || entry.actualStartTime;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt || entry.actualEndTime;
        if (!inTime) return false;
        if (!outTime) return true;
        const inMs = Date.parse(inTime);
        const outMs = Date.parse(outTime);
        if (!Number.isFinite(inMs)) return false;
        if (!Number.isFinite(outMs)) return true;
        return inMs > outMs;
      });
    };

    const resolveLatestClockOutMs = (shift) => {
      const clockByNurse = shift?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return null;
      const entries = Object.values(clockByNurse);
      if (!Array.isArray(entries) || entries.length === 0) return null;

      let latestMs = -Infinity;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt || entry.actualEndTime;
        if (!outTime) continue;
        const ms = Date.parse(outTime);
        if (Number.isFinite(ms) && ms > latestMs) latestMs = ms;
      }
      return Number.isFinite(latestMs) ? latestMs : null;
    };

    const shouldTreatShiftAsCompleted = (shift, schedule) => {
      const normalizedStatus = String(shift?.status || '').trim().toLowerCase();
      if (normalizedStatus === 'completed') return true;

      const { endDate, isRecurringShift, startDate } = schedule || {};
      if (!isRecurringShift) return hasClockedOutForAnyNurse(shift);

      const hasFinalizedRecurring = Boolean(
        shift?.finalCompletedAt ||
          shift?.finalInvoiceSentAt ||
          shift?.finalInvoiceGeneratedAt ||
          shift?.finalInvoiceId
      );
      if (hasFinalizedRecurring) return hasClockedOutForAnyNurse(shift);

      // Recurring schedules should only be treated as completed when the series is finished.
      // For single-day recurring schedules, a clock-out can be treated as completed.
      if (startDate && endDate) {
        try {
          if (
            startDate.getFullYear() === endDate.getFullYear() &&
            startDate.getMonth() === endDate.getMonth() &&
            startDate.getDate() === endDate.getDate()
          ) {
            return hasClockedOutForAnyNurse(shift);
          }
        } catch (e) {
          // ignore
        }
      }

      if (!endDate) return false;

      const startOfLastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
      const endOfLastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);

      const hasClockOut = hasClockedOutForAnyNurse(shift);
      const latestOutMs = resolveLatestClockOutMs(shift);
      const clockedOutOnLastDay =
        Number.isFinite(latestOutMs) &&
        latestOutMs >= startOfLastDay.getTime() &&
        latestOutMs <= endOfLastDay.getTime();

      // If the whole period has ended, any clock-out history means it's completed.
      if (new Date() > endOfLastDay) return hasClockOut;

      // On the last day, consider it completed once the final clock-out happens (and nobody is still clocked-in).
      if (new Date() >= startOfLastDay && hasClockOut && clockedOutOnLastDay && !hasAnyActiveClockIn(shift)) return true;

      return false;
    };

    const filtered = shiftRequests.filter(shift => {
      const normalizedStatus = String(shift?.status || '').trim().toLowerCase();

      // Active/clocked-in shifts should remain visible regardless of historical clock-out values.
      const isActiveByStatus =
        normalizedStatus === 'active' ||
        normalizedStatus === 'clocked-in' ||
        normalizedStatus === 'clockedin' ||
        normalizedStatus === 'in-progress' ||
        normalizedStatus === 'in progress';
      const isActiveClockedIn = isActiveByStatus || hasAnyActiveClockIn(shift);
      
      // Keep patient-created requests under Pending.
      // Only treat 'pending' as viewable in Upcoming once at least one nurse has accepted.
      // This avoids split-schedule recurring services showing in both Pending and Upcoming.
      const pendingAdminRecurringAccepted =
        normalizedStatus === 'pending' &&
        shift.adminRecurring === true &&
        hasAnyAcceptedNurseForShift(shift);

      const isApproved =
        normalizedStatus === 'approved' ||
        normalizedStatus === 'confirmed' ||
        normalizedStatus === 'in-progress' ||
        normalizedStatus === 'in progress' ||
        normalizedStatus === 'clocked-in' ||
        normalizedStatus === 'clockedin' ||
        normalizedStatus === 'active' ||
        Boolean(shift.recurringApproved) ||
        Boolean(shift.approvedAt) ||
        pendingAdminRecurringAccepted;
      
      // Enhanced client matching logic
      const matchesClient = matchesCurrentPatient(shift);
      
      const { startDate, endDate, isRecurringShift } = getShiftScheduleBounds(shift);

      // Exclude completed shifts from Upcoming - they belong in Past.
      // BUT: never exclude a shift that is currently active/clocked-in.
      if (!isActiveClockedIn && shouldTreatShiftAsCompleted(shift, { startDate, endDate, isRecurringShift })) {
        return false;
      }

      let dateValid = false;
      try {
        if (isActiveClockedIn) {
          dateValid = true; // Keep active shifts visible even if date is in the past
        } else if (startDate) {
          const startClone = new Date(startDate.getTime());
          startClone.setHours(0, 0, 0, 0);
          if (startClone >= now) {
            dateValid = true;
          }
        }

        if (!dateValid && isRecurringShift) {
          if (!endDate) {
            dateValid = true; // Ongoing recurring schedule
          } else {
            const endClone = new Date(endDate.getTime());
            endClone.setHours(0, 0, 0, 0);
            dateValid = endClone >= now;
          }
        }
      } catch (e) {
        dateValid = false;
      }

      // Debug logging for Feb 11 shift
      if (shift.date === '2026-02-11' || (startDate && startDate.toISOString().includes('2026-02-11'))) {
        console.log('[PatientUpcoming][Feb11Shift]', {
          shiftId: shift.id || shift._id,
          service: shift.service,
          status: shift.status,
          date: shift.date,
          startDate: startDate?.toISOString(),
          isApproved,
          matchesClient,
          dateValid,
          isActiveClockedIn,
          willShow: isApproved && matchesClient && dateValid,
          clockByNurse: shift.clockByNurse ? Object.keys(shift.clockByNurse) : null,
        });
      }
      
      return isApproved && matchesClient && dateValid;
    });
    
    return filtered;
  }, [shiftRequests, matchesCurrentPatient, user?.role, hasAnyAcceptedNurseForShift]);

  // Get completed shifts assigned to this patient for past appointments
  const completedShifts = React.useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Helper to check if any nurse has clocked out
    const hasClockedOut = (shift) => {
      if (!shift?.clockByNurse || typeof shift.clockByNurse !== 'object') return false;

      const entries = Object.values(shift.clockByNurse);
      if (!Array.isArray(entries) || entries.length === 0) return false;

      return entries.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;

        const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt || entry.actualStartTime;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt || entry.actualEndTime;

        if (!inTime || !outTime) return false;

        const inMs = Date.parse(inTime);
        const outMs = Date.parse(outTime);

        if (!Number.isFinite(outMs)) return false;
        if (Number.isFinite(inMs)) return outMs > inMs;
        return true;
      });
    };
    
    const hasAnyActiveClockIn = (shift) => {
      const clockByNurse = shift?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return false;
      const entries = Object.values(clockByNurse);
      if (!Array.isArray(entries) || entries.length === 0) return false;

      return entries.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const inTime = entry.lastClockInTime || entry.clockInTime || entry.startedAt || entry.actualStartTime;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt || entry.actualEndTime;
        if (!inTime) return false;
        if (!outTime) return true;
        const inMs = Date.parse(inTime);
        const outMs = Date.parse(outTime);
        if (!Number.isFinite(inMs)) return false;
        if (!Number.isFinite(outMs)) return true;
        return inMs > outMs;
      });
    };

    const resolveLatestClockOutMs = (shift) => {
      const clockByNurse = shift?.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return null;
      const entries = Object.values(clockByNurse);
      if (!Array.isArray(entries) || entries.length === 0) return null;

      let latestMs = -Infinity;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const outTime = entry.lastClockOutTime || entry.clockOutTime || entry.completedAt || entry.actualEndTime;
        if (!outTime) continue;
        const ms = Date.parse(outTime);
        if (Number.isFinite(ms) && ms > latestMs) latestMs = ms;
      }
      return Number.isFinite(latestMs) ? latestMs : null;
    };

    const shouldTreatShiftAsCompleted = (shift, schedule) => {
      const normalizedStatus = String(shift?.status || '').trim().toLowerCase();
      if (normalizedStatus === 'completed') return true;

      const { endDate, isRecurringShift, startDate } = schedule || {};
      if (!isRecurringShift) return hasClockedOut(shift);

      const hasFinalizedRecurring = Boolean(
        shift?.finalCompletedAt ||
          shift?.finalInvoiceSentAt ||
          shift?.finalInvoiceGeneratedAt ||
          shift?.finalInvoiceId
      );
      if (hasFinalizedRecurring) return hasClockedOut(shift);

      // Single-day recurring schedules can be treated as completed after a valid clock-out.
      if (startDate && endDate) {
        try {
          if (
            startDate.getFullYear() === endDate.getFullYear() &&
            startDate.getMonth() === endDate.getMonth() &&
            startDate.getDate() === endDate.getDate()
          ) {
            return hasClockedOut(shift);
          }
        } catch (e) {
          // ignore
        }
      }

      if (!endDate) return false;

      const startOfLastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
      const endOfLastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);

      const hasClockOut = hasClockedOut(shift);
      const latestOutMs = resolveLatestClockOutMs(shift);
      const clockedOutOnLastDay =
        Number.isFinite(latestOutMs) &&
        latestOutMs >= startOfLastDay.getTime() &&
        latestOutMs <= endOfLastDay.getTime();

      // If the whole period has ended, any clock-out history means it's completed.
      if (new Date() > endOfLastDay) return hasClockOut;

      // On the last day, consider it completed once the final clock-out happens (and nobody is still clocked-in).
      if (new Date() >= startOfLastDay && hasClockOut && clockedOutOnLastDay && !hasAnyActiveClockIn(shift)) return true;

      return false;
    };

    const filtered = shiftRequests.filter(shift => {
      const { endDate, isRecurringShift, startDate } = getShiftScheduleBounds(shift);

      const isCompleted = shouldTreatShiftAsCompleted(shift, { startDate, endDate, isRecurringShift });

      // Match client
      const matchesClient = matchesCurrentPatient(shift);

      return isCompleted && matchesClient;
    });
    
    return filtered;
  }, [shiftRequests, matchesCurrentPatient, user?.role, getShiftScheduleBounds]);
  
  // Filter out appointments that have corresponding active shifts to avoid duplicates
  const filteredUpcomingAppointments = upcomingAppointments.filter(appointment => {
    const toDateKey = (raw) => {
      if (!raw) return null;
      if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
      const d = new Date(raw);
      if (!Number.isFinite(d.getTime())) return null;
      const yyyy = String(d.getFullYear());
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const appointmentShiftId =
      appointment?.shiftRequestId ||
      appointment?.shiftId ||
      appointment?.requestId ||
      appointment?.assignmentId ||
      appointment?.documentId ||
      null;

    const appointmentDateKey = toDateKey(
      appointment?.date || appointment?.appointmentDate || appointment?.startDate || appointment?.scheduledDate || null
    );

    // Check if there's an active shift for this appointment
    const hasActiveShift = approvedShifts.some(shift => {
      const isActive = shift.status === 'active' || shift.status === 'clocked-in' || shift.status === 'in-progress';
      const sameService = shift.service === appointment.service;
      const sameDate = shift.date === appointment.date;
      return isActive && sameService && sameDate;
    });

    // If the visit has already been completed (shift completed/clocked-out), do NOT show
    // the original appointment under Upcoming as well.
    const hasCompletedShift = completedShifts.some((shift) => {
      const shiftId = shift?.id || shift?.shiftRequestId || shift?.shiftId || shift?.requestId || shift?.assignmentId || shift?.documentId || null;
      if (appointmentShiftId && shiftId && String(appointmentShiftId) === String(shiftId)) {
        return true;
      }

      if (shift?.service !== appointment?.service) return false;

      const schedule = getShiftScheduleBounds(shift);
      const shiftDateKey = toDateKey(shift?.date || shift?.appointmentDate || shift?.startDate || schedule?.startDate || null);
      if (!shiftDateKey || !appointmentDateKey) return false;
      return shiftDateKey === appointmentDateKey;
    });

    // Also exclude appointments that already look completed locally.
    const appointmentLooksCompleted =
      String(appointment?.status || '').toLowerCase() === 'completed' ||
      Boolean(appointment?.completedAt);

    return !hasActiveShift && !hasCompletedShift && !appointmentLooksCompleted;
  });

  // Get pending shift requests (including recurring shifts) for the patient
  const pendingShiftRequests = React.useMemo(() => {
    return shiftRequests.filter(shift => {
      // Admin-created recurring schedules are not patient-confirmation items.
      // Hide them from Pending until a nurse accepts (they'll then show in Upcoming).
      if (shift?.adminRecurring === true) {
        return false;
      }

      const isPending = shift.status === 'pending' && !hasAnyAcceptedNurseForShift(shift);
      const matchesClient = matchesCurrentPatient(shift);
      
      return isPending && matchesClient;
    });
  }, [shiftRequests, matchesCurrentPatient, hasAnyAcceptedNurseForShift]);

  // Combine filtered appointments with approved shifts for patient
  const allUpcomingAppointments = [...filteredUpcomingAppointments, ...approvedShifts];

  // Debug: Log upcoming shifts count
  React.useEffect(() => {
    if (activeTab === 'upcoming') {
      console.log('[PatientUpcoming][Counts]', {
        filteredAppointments: filteredUpcomingAppointments.length,
        approvedShifts: approvedShifts.length,
        total: allUpcomingAppointments.length,
        shiftServices: approvedShifts.map(s => ({ service: s.service, date: s.date, status: s.status })),
      });
    }
  }, [activeTab, approvedShifts.length, filteredUpcomingAppointments.length]);
  
  // Deduplicate past appointments by service + date to avoid showing same shift twice
  const allPastAppointmentsCombined = [...pastAppointments, ...completedShifts];
  const allPastAppointments = allPastAppointmentsCombined.filter((item, index, self) => {
    // Find the first occurrence with matching service and date
    const firstIndex = self.findIndex(other => 
      other.service === item.service && 
      other.date === item.date &&
      (other.startTime === item.startTime || other.time === item.time)
    );
    // Keep only if this is the first occurrence
    return firstIndex === index;
  });
  
  const allPendingItems = [...pendingAppointments, ...pendingShiftRequests];
  
  // Get displayed appointments based on active tab
  const displayedAppointments = activeTab === 'upcoming' 
    ? allUpcomingAppointments 
    : activeTab === 'pending' 
    ? allPendingItems 
    : allPastAppointments;

  const displayedAppointmentsSorted = React.useMemo(() => {
    if (activeTab !== 'past') {
      return displayedAppointments;
    }

    const items = Array.isArray(displayedAppointments) ? [...displayedAppointments] : [];

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
      const directMs = direct ? Date.parse(direct) : NaN;
      if (Number.isFinite(directMs)) return directMs;

      const clockMs = resolveClockOutMsFromMap(item.clockByNurse);
      if (typeof clockMs === 'number') return clockMs;

      const fallback = item.date || item.scheduledDate || item.startDate || null;
      const fallbackMs = fallback ? Date.parse(fallback) : NaN;
      if (Number.isFinite(fallbackMs)) return fallbackMs;
      const d = fallback ? new Date(fallback) : null;
      return d && Number.isFinite(d.getTime()) ? d.getTime() : 0;
    };

    items.sort((a, b) => getCompletionMs(b) - getCompletionMs(a));
    return items;
  }, [activeTab, displayedAppointments]);

  const displayedAppointmentsSearched = useMemo(() => {
    const rawQuery = String(searchQuery || '').trim().toLowerCase();
    if (!rawQuery) return displayedAppointmentsSorted;

    const terms = rawQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return displayedAppointmentsSorted;

    const safeText = (value) => {
      if (value === null || value === undefined) return '';
      return String(value);
    };

    const buildHaystack = (item) => {
      const nurseCandidate =
        item?.nurse ||
        item?.nurseName ||
        item?.assignedNurse ||
        item?.requestedNurse ||
        item?.selectedNurse ||
        null;

      const nurseText = getNurseName(nurseCandidate);
      const serviceText = safeText(item?.service || item?.serviceName || item?.serviceTitle || item?.title);
      const statusText = safeText(item?.status);
      const dateText = safeText(item?.date || item?.appointmentDate || item?.scheduledDate || item?.startDate);
      const timeText = safeText(item?.time || item?.startTime);
      const endTimeText = safeText(item?.endTime);
      const idText = safeText(item?.id || item?._id || item?.appointmentId || item?.shiftRequestId || item?.shiftId);

      const locationText = safeText(
        item?.location ||
          item?.address ||
          item?.parish ||
          item?.city ||
          item?.addressLine1 ||
          item?.addressLine
      );

      const notesText = safeText(item?.notes || item?.reason || item?.description);

      return `${serviceText} ${nurseText} ${statusText} ${dateText} ${timeText} ${endTimeText} ${locationText} ${notesText} ${idText}`
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    };

    return displayedAppointmentsSorted.filter((item) => {
      const haystack = buildHaystack(item);
      if (!haystack) return false;
      return terms.every((t) => haystack.includes(t));
    });
  }, [displayedAppointmentsSorted, searchQuery]);

  const suggestionSearchResults = useMemo(() => {
    const rawQuery = String(searchQuery || '').trim().toLowerCase();
    if (!rawQuery) return [];

    const terms = rawQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const safeText = (value) => {
      if (value === null || value === undefined) return '';
      return String(value);
    };

    const buildHaystack = (item) => {
      const nurseCandidate =
        item?.nurse ||
        item?.nurseName ||
        item?.assignedNurse ||
        item?.requestedNurse ||
        item?.selectedNurse ||
        null;

      const nurseText = getNurseName(nurseCandidate);
      const serviceText = safeText(item?.service || item?.serviceName || item?.serviceTitle || item?.title);
      const statusText = safeText(item?.status);
      const dateText = safeText(item?.date || item?.appointmentDate || item?.scheduledDate || item?.startDate);
      const timeText = safeText(item?.time || item?.startTime);
      const endTimeText = safeText(item?.endTime);
      const idText = safeText(item?.id || item?._id || item?.appointmentId || item?.shiftRequestId || item?.shiftId);

      const locationText = safeText(
        item?.location ||
          item?.address ||
          item?.parish ||
          item?.city ||
          item?.addressLine1 ||
          item?.addressLine
      );

      const notesText = safeText(item?.notes || item?.reason || item?.description);

      return `${serviceText} ${nurseText} ${statusText} ${dateText} ${timeText} ${endTimeText} ${locationText} ${notesText} ${idText}`
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    };

    const dedupe = new Set();
    const results = [];
    const pushAll = (items, tab) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const id = item?.id || item?._id || item?.appointmentId || item?.shiftRequestId || item?.shiftId || null;
        const key = id
          ? String(id)
          : `${String(item?.service || '')}-${String(item?.date || item?.appointmentDate || '')}-${String(item?.startTime || item?.time || '')}`;
        if (dedupe.has(key)) continue;
        const haystack = buildHaystack(item);
        if (!haystack) continue;
        if (!terms.every((t) => haystack.includes(t))) continue;
        dedupe.add(key);
        results.push({ item, tab, key });
        if (results.length >= 8) return;
      }
    };

    pushAll(allUpcomingAppointments, 'upcoming');
    pushAll(allPendingItems, 'pending');
    pushAll(allPastAppointments, 'past');

    return results;
  }, [allPastAppointments, allPendingItems, allUpcomingAppointments, getNurseName, searchQuery]);

  const openAppointmentRecord = (record) => {
    if (!record) return;
    setSelectedAppointment(record);

    const hasShiftRequestMarkers = Boolean(
      record?.isShiftRequest ||
        record?.shiftRequestId ||
        record?.shiftId ||
        record?.requestId ||
        record?.assignmentId ||
        record?.approvedAt ||
        (Array.isArray(record?.coverageRequests) && record.coverageRequests.length > 0) ||
        Boolean(record?.clockByNurse)
    );

    const hasShiftTimes = Boolean(
      record?.startTime &&
        record?.endTime &&
        (
          record.status === 'approved' ||
          record.status === 'active' ||
          record.status === 'clocked-in' ||
          record.status === 'in-progress' ||
          record.status === 'pending' ||
          record.status === 'completed' ||
          record.nurseId ||
          record.nurseName
        )
    );

    const isShift = Boolean(record?.isShift || hasShiftRequestMarkers || hasShiftTimes);
    const isRecurring = Boolean(
      record.isRecurring ||
        record.isRecurringInstance ||
        record.recurringScheduleId ||
        record.recurringSchedule ||
        record.recurringFrequency ||
        record.seriesId ||
        isShift
    );

    if (isRecurring) {
      setRecurringShiftDetailsModalVisible(true);
    } else {
      setDetailsModalVisible(true);
    }
  };

  const searchSuggestions = useMemo(() => {
    const rawQuery = String(searchQuery || '').trim();
    if (!rawQuery) return [];
    if (!Array.isArray(suggestionSearchResults) || suggestionSearchResults.length === 0) return [];

    const formatDate = (item) => String(item?.date || item?.appointmentDate || item?.scheduledDate || item?.startDate || '').trim();
    const formatTime = (item) => {
      const t = item?.time || item?.startTime || '';
      return t ? formatTimeTo12Hour(t) : '';
    };

    const results = [];

    for (const match of suggestionSearchResults) {
      const item = match?.item;
      if (!item) continue;

      const serviceText = String(item?.service || item?.serviceName || item?.serviceTitle || 'Appointment');
      const nurseCandidate =
        item?.nurse || item?.nurseName || item?.assignedNurse || item?.requestedNurse || item?.selectedNurse || null;
      const nurseText = getNurseName(nurseCandidate);
      const dateText = formatDate(item);
      const timeText = formatTime(item);
      const statusText = String(item?.status || '').trim();

      const subtitleParts = [dateText, timeText, nurseText, statusText].filter(Boolean);

      results.push({
        key: match.key,
        item,
        tab: match.tab,
        title: serviceText,
        subtitle: subtitleParts.join(' • '),
      });
      if (results.length >= 6) break;
    }

    return results;
  }, [suggestionSearchResults, searchQuery, formatTimeTo12Hour, getNurseName]);

  // Helper to check if appointment is recurring
  const isRecurringAppointment = (appointment) => {
    if (!appointment) return false;
    return appointment.isRecurring || 
           appointment.recurring || 
           (appointment.serviceType && appointment.serviceType.includes('Recurring')) ||
           (appointment.service && appointment.service.includes('Recurring'));
  };

  // Helper to format currency for invoices
  const formatInvoiceCurrency = (amount, currency = 'USD', service = '') => {
    const numericAmount = parseFloat(amount) || 0;
    const symbol = currency === 'JMD' ? 'J$' : '$';
    
    // If it's a recurring service and amount is 0, show "Bi-weekly Billing"
    if (numericAmount === 0 && service.toLowerCase().includes('recurring')) {
      return 'Bi-weekly Billing';
    }
    
    return `${symbol}${numericAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Helper to format date for invoices
  const formatInvoiceDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  };

  // Helper to get status styles for invoices
  const getInvoiceStatusStyles = (status) => {
    const s = status?.toLowerCase() || 'pending';
    switch (s) {
      case 'paid':
        return { backgroundColor: COLORS.success + '15', textColor: COLORS.success, icon: 'check-circle' };
      case 'overdue':
        return { backgroundColor: COLORS.error + '15', textColor: COLORS.error, icon: 'alert-circle' };
      case 'sent':
      case 'pending':
        return { backgroundColor: COLORS.warning + '15', textColor: COLORS.warning, icon: null };
      default:
        return { backgroundColor: COLORS.border + '30', textColor: COLORS.textLight, icon: 'file-document-outline' };
    }
  };

  // Render the invoice preview component
  const renderInvoicePreview = () => {
    if (!selectedInvoicePreview) return null;

    const invoice = selectedInvoicePreview;
    const statusStyles = getInvoiceStatusStyles(invoice.status);
    const items = invoice.items || [
      { 
        description: invoice.service || 'Nursing Services', 
        quantity: 1, 
        rate: invoice.total || invoice.amount || 0, 
        amount: invoice.total || invoice.amount || 0 
      }
    ];

    return (
      <View style={styles.invoicePreviewContainer}>
        <View style={styles.invoicePreviewHeader}>
          <Text style={styles.invoicePreviewTitle}>Invoice Preview</Text>
          <TouchableWeb
            onPress={() => {
              setDetailsModalVisible(false);
              setTimeout(() => {
                navigation.navigate('InvoiceDisplay', {
                  invoiceData: invoice,
                  clientName: user?.name,
                  returnToAppointmentModal: true,
                  appointmentId: selectedAppointment?.id,
                  appointmentTab: activeTab,
                  appointmentModalType: 'details',
                });
              }, 300);
            }}
            style={styles.previewShareButton}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="share-variant" size={16} color={COLORS.primary} />
            <Text style={styles.previewShareText}>Share PDF</Text>
          </TouchableWeb>
        </View>

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
                <Text style={styles.pdfInvoiceNumber}>{invoice.invoiceId?.replace('CARE-INV', 'NUR-INV')}</Text>
                <Text style={styles.pdfInvoiceDate}>Issue Date: {InvoiceService.formatDateForInvoice(invoice.issueDate || invoice.createdAt)}</Text>
                <Text style={styles.pdfInvoiceDate}>Due Date: {InvoiceService.formatDateForInvoice(invoice.dueDate)}</Text>
              </View>
            </View>
            <View style={styles.pdfBlueLine} />
          </View>

          {/* Bill To and Service Provider */}
          <View style={styles.pdfClientSection}>
            <View style={styles.pdfClientRow}>
              <View style={styles.pdfBillTo}>
                <Text style={styles.pdfSectionTitle}>BILL TO:</Text>
                <Text style={styles.pdfClientName}>{user?.name || invoice.clientName}</Text>
                <Text style={styles.pdfClientInfo}>{user?.email || invoice.clientEmail}</Text>
                <Text style={styles.pdfClientInfo}>{user?.phone || invoice.clientPhone}</Text>
                <Text style={styles.pdfClientInfo}>{user?.address || invoice.clientAddress}</Text>
              </View>
              <View style={styles.pdfServiceProvider}>
                <Text style={styles.pdfSectionTitle}>SERVICE PROVIDED BY:</Text>
                <Text style={styles.pdfProviderName}>{companyDetails.companyName}</Text>
                <Text style={styles.pdfProviderInfo}>{companyDetails.address}</Text>
                <Text style={styles.pdfProviderInfo}>Phone: {companyDetails.phone}</Text>
                <Text style={styles.pdfProviderInfo}>Email: {companyDetails.email}</Text>
              </View>
            </View>
          </View>

          {/* Service Table */}
          <View style={styles.pdfServiceSection}>
            <View style={styles.pdfTable}>
              <View style={styles.pdfTableHeader}>
                <Text style={[styles.pdfTableHeaderText, { flex: 2 }]}>Description</Text>
                <Text style={styles.pdfTableHeaderText}>Qty</Text>
                <Text style={styles.pdfTableHeaderText}>Rate</Text>
                <Text style={styles.pdfTableHeaderText}>Amount</Text>
              </View>
              {items.map((item, index) => (
                <View key={index} style={styles.pdfTableRow}>
                  <Text style={[styles.pdfTableCell, { flex: 2 }]}>{item.description}</Text>
                  <Text style={styles.pdfTableCell}>{item.quantity || 1}</Text>
                  <Text style={styles.pdfTableCell}>{InvoiceService.formatCurrency(item.rate || item.price || (invoice.total / (item.quantity || 1)))}</Text>
                  <Text style={styles.pdfTableCellAmount}>{InvoiceService.formatCurrency(item.amount || item.total || invoice.total)}</Text>
                </View>
              ))}
            </View>

            {/* Bottom Section */}
            <View style={styles.pdfBottomSection}>
              <View style={styles.pdfPaymentSection}>
                <Text style={styles.pdfPaymentTitle}>Payment Information</Text>
                {paymentInfo.bankAccounts.map((account) => (
                  <View key={account.id} style={styles.bankAccountGroup}>
                    <Text style={styles.pdfPaymentInfo}>{account.bankName}</Text>
                    {account.accountNumbers.map((accNum) => (
                      <Text key={accNum.id} style={styles.pdfPaymentInfo}>
                        {accNum.currency}: {accNum.number}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>

              <View style={styles.pdfTotalsSection}>
                <View style={styles.pdfTotalRow}>
                  <Text style={styles.pdfTotalLabel}>Deposit:</Text>
                  <Text style={styles.pdfTotalValue}>${invoice.total || invoice.amount}</Text>
                </View>
                <View style={styles.pdfBlueLine} />
                <View style={styles.pdfFinalTotalRow}>
                  <Text style={styles.pdfFinalTotalLabel}>Total Amount:</Text>
                  <Text style={styles.pdfFinalTotalAmount}>${invoice.total || invoice.amount}</Text>
                </View>
                
                {invoice.status === 'Paid' && (
                  <View style={styles.paidStampContainer}>
                    <View style={styles.paidStamp}>
                      <Text style={styles.paidStampText}>PAID</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
        return COLORS.success;
      case 'pending':
        return COLORS.warning;
      case 'completed':
        return COLORS.primary;
      default:
        return COLORS.textLight;
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'confirmed':
        return 'check-circle';
      case 'pending':
        return 'clock-outline';
      case 'completed':
        return 'checkbox-marked-circle';
      default:
        return 'circle-outline';
    }
  };

  // Check if patient is non-recurring (for invoice button visibility)
  const isNonRecurringPatient = (appointment) => {
    // For appointments, check if user has recurring appointments property set to false
    // This would typically come from user profile or appointment data
    // Since this is for completed appointments, we show invoice for non-recurring patients
    // If appointment doesn't explicitly indicate it's recurring, treat as non-recurring
    const isRecurring = appointment.isRecurring || 
                       appointment.hasRecurringAppointments || 
                       appointment.recurring ||
                       (user?.hasRecurringAppointments === true) ||
                       (appointment.serviceType && appointment.serviceType.includes('Recurring')) ||
                       (appointment.service && appointment.service.includes('Recurring'));
    
    return !isRecurring;
  };

  // Handle appointment cancellation
  const handleCancelAppointment = (appointment) => {
    const hasDeposit = appointment.depositPaid || appointment.depositAmount > 0;
    const depositMessage = hasDeposit 
      ? `\n\n⚠️ Note: Your deposit of J$${appointment.depositAmount?.toLocaleString() || '0'} is non-refundable.`
      : '';
    
    Alert.alert(
      'Cancel Appointment',
      `Are you sure you want to cancel your appointment for ${appointment.service} on ${appointment.date}?${depositMessage}`,
      [
        { text: 'No', style: 'cancel' },
        { 
          text: 'Yes, Cancel', 
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelAppointment(appointment.id, 'Cancelled by user');
              Alert.alert(
                'Appointment Cancelled',
                'Your appointment has been cancelled successfully.',
                [
                  { text: 'OK' }
                ]
              );
            } catch (error) {
              console.error('Error cancelling appointment:', error);
              Alert.alert('Error', 'Failed to cancel appointment. Please try again.');
            }
          }
        }
      ]
    );
  };

  // Handle appointment rescheduling
  const handleRescheduleAppointment = (appointment) => {
    Alert.alert(
      'Reschedule Appointment',
      `Reschedule your appointment for ${appointment.service}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reschedule', 
          onPress: () => {
            // Navigate to booking screen with pre-filled data
            navigation.navigate('Book', {
              reschedule: true,
              appointmentId: appointment.id,
              service: appointment.service,
              originalDate: appointment.date,
              originalTime: appointment.time
            });
          }
        }
      ]
    );
  };

  const canEditAppointment = (appointment) => {
    if (!appointment || typeof appointment !== 'object') return false;

    // Patients should only edit their own ad-hoc appointment requests.
    // Shift-like / admin-recurring / split-schedule items are staffing workflows and must be read-only here.
    const isShiftLike = Boolean(
      appointment?.isShift ||
      appointment?.isShiftRequest ||
      appointment?.shiftRequestId ||
      appointment?.adminRecurring === true ||
      Boolean(appointment?.recurringApproved) ||
      Boolean(appointment?.approvedAt) ||
      Boolean(appointment?.clockByNurse) ||
      (appointment?.nurseSchedule && typeof appointment.nurseSchedule === 'object' && Object.keys(appointment.nurseSchedule).length > 0) ||
      String(appointment?.assignmentType || '').toLowerCase() === 'split-schedule'
    );
    if (isShiftLike) return false;

    const timestamp = appointment.createdAt || appointment.requestedAt;
    if (!timestamp) return false;

    let createdTime;
    
    // Handle Firestore Timestamp objects (which have seconds/nanoseconds or toDate())
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      createdTime = timestamp.toDate().getTime();
    } else if (timestamp.seconds) {
      createdTime = timestamp.seconds * 1000;
    } else if (timestamp instanceof Date) {
      createdTime = timestamp.getTime();
    } else {
      // Handle string or number timestamps
      createdTime = new Date(timestamp).getTime();
    }

    if (isNaN(createdTime)) return false;

    const now = new Date().getTime();
    const oneHour = 60 * 60 * 1000;
    return (now - createdTime) < oneHour;
  };

  const handleEdit = (appointment) => {
    setEditForm({
      service: appointment.service,
      date: appointment.date,
      time: appointment.time || appointment.scheduledTime,
      location: appointment.location || appointment.address || '',
      notes: appointment.notes || '',
    });
    
    // Initialize pickers
    if (appointment.date) {
      setPickerDate(new Date(appointment.date));
    } else {
      setPickerDate(new Date());
    }
    
    // Initialize time picker
    // Try to parse time string "10:00 AM" or similar
    const timeStr = appointment.time || appointment.scheduledTime;
    if (timeStr) {
      const now = new Date();
      try {
        // Simple parsing for "HH:MM AM/PM"
        const [time, period] = timeStr.split(' ');
        if (time && period) {
          let [hours, minutes] = time.split(':');
          hours = parseInt(hours);
          minutes = parseInt(minutes);
          
          if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
          if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
          
          const date = new Date();
          date.setHours(hours, minutes, 0, 0);
          setPickerTime(date);
        } else {
          setPickerTime(new Date());
        }
      } catch (e) {
        setPickerTime(new Date());
      }
    } else {
      setPickerTime(new Date());
    }

    setIsEditing(true);
    setSelectedAppointment(appointment);
    setDetailsModalVisible(true);
  };

  const onDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && date) {
        setPickerDate(date);
        const formattedDate = date.toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric'
        });
        setEditForm(prev => ({ ...prev, date: formattedDate }));
      }
    } else {
      if (date) setPickerDate(date);
    }
  };

  const onTimeChange = (event, time) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
      if (event.type === 'set' && time) {
        setPickerTime(time);
        const formattedTime = time.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        setEditForm(prev => ({ ...prev, time: formattedTime }));
      }
    } else {
      if (time) setPickerTime(time);
    }
  };

  const confirmDateSelection = () => {
    const formattedDate = pickerDate.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    });
    setEditForm(prev => ({ ...prev, date: formattedDate }));
    setShowDatePicker(false);
  };

  const confirmTimeSelection = () => {
    const formattedTime = pickerTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    setEditForm(prev => ({ ...prev, time: formattedTime }));
    setShowTimePicker(false);
  };

  const handleSaveEdit = async () => {
    try {
      if (!editForm.service || !editForm.date || !editForm.time) {
        Alert.alert('Error', 'Please fill in all required fields');
        return;
      }

      await ApiService.updateAppointment(selectedAppointment.id, editForm);
      
      await sendNotificationToUser(
        'ADMIN001', 
        'admin', 
        'Appointment Updated', 
        `${user?.name} updated their appointment for ${editForm.service} on ${editForm.date}.`,
        {
          type: 'appointment_update',
          appointmentId: selectedAppointment.id,
          patientId: user?.id
        }
      );

      Alert.alert('Success', 'Appointment updated successfully');
      setIsEditing(false);
      setDetailsModalVisible(false);
      refreshAppointments();
    } catch (error) {
      console.error('Error updating appointment:', error);
      Alert.alert('Error', 'Failed to update appointment');
    }
  };

  // Temporarily close the appointment details modal before showing the confidentiality agreement
  const handleUnlockNurseNotes = () => {
    if (!selectedAppointment) {
      console.log('No selected appointment');
      return;
    }
    
    // Show payment confirmation
    Alert.alert(
      'Unlock Nurse Notes',
      'Pay JMD $500 to unlock nurse notes for this completed appointment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay Now',
          onPress: async () => {
            try {
              const paymentResult = await FygaroPaymentService.initializePayment({
                amount: 500,
                currency: 'JMD',
                appointmentId: selectedAppointment.id,
                customerId: user?.id,
                customerName: user?.fullName || user?.name,
                customerEmail: user?.email,
                customerPhone: user?.phone,
                description: 'Nurse Notes Access Fee',
                metadata: {
                  type: 'nurse_notes',
                  appointmentId: selectedAppointment.id,
                }
              });

              if (paymentResult.success) {
                // For web, open in new tab
                if (Platform.OS === 'web') {
                  window.open(paymentResult.paymentUrl, '_blank');
                  Alert.alert(
                    'Payment Window Opened',
                    'Complete your payment in the new window. Once done, the nurse notes will be unlocked.',
                    [{ text: 'OK' }]
                  );
                } else {
                  // For mobile, navigate to payment webview
                  navigation.navigate('PaymentWebview', {
                    paymentUrl: paymentResult.paymentUrl,
                    sessionId: paymentResult.sessionId,
                    transactionId: paymentResult.transactionId,
                    appointmentId: selectedAppointment.id,
                    onSuccess: async () => {
                      setNurseNotesUnlocked(prev => ({
                        ...prev,
                        [selectedAppointment.id]: true
                      }));
                      Alert.alert(
                        'Success',
                        'Payment successful! You now have access to the nurse notes.',
                        [{ text: 'OK' }]
                      );
                    }
                  });
                }
              } else {
                Alert.alert(
                  'Payment Error',
                  paymentResult.error || 'Failed to initialize payment. Please try again.'
                );
              }
            } catch (error) {
              console.error('Payment Error:', error);
              Alert.alert(
                'Payment Error',
                'An error occurred while processing your payment. Please try again.'
              );
            }
          },
        },
      ],
    );
  };

  const handleCloseConfidentialityModal = (reopenDetails = true) => {
    if (!showConfidentialityModal) {
      console.log('Confidentiality modal not showing');
      return;
    }

    console.log('Closing confidentiality modal, reopen details:', reopenDetails);
    setShowConfidentialityModal(false);
    
    setTimeout(() => {
      setConfidentialityAccepted(false);
      setCurrentAppointmentForNotes(null);
      
      if (reopenDetails && shouldReopenDetailsAfterConfidentiality) {
        console.log('Reopening details modal');
        setTimeout(() => {
          setDetailsModalVisible(true);
          setShouldReopenDetailsAfterConfidentiality(false);
        }, 100);
      } else {
        setShouldReopenDetailsAfterConfidentiality(false);
      }
    }, 100);
  };

  const openMedicalReportRequestModal = () => {
    setMedicalReportEmail((user?.email || '').trim());
    setMedicalReportModalVisible(true);
  };

  const closeMedicalReportRequestModal = () => {
    if (medicalReportSubmitting) return;
    setMedicalReportModalVisible(false);
  };

  const createMedicalReportRequest = async ({ transactionId, sessionId }) => {
    const email = String(medicalReportEmail || '').trim();
    if (!email) {
      throw new Error('Email address is required');
    }

    const payload = {
      patientId: user?.id || email,
      patientAuthUid: user?.id || null,
      patientName: user?.fullName || user?.displayName || user?.name || 
        (user?.firstName || user?.lastName ? `${user?.firstName || ''} ${user?.lastName || ''}`.trim() : null) || 
        'Patient',
      patientEmail: email,
      currency: 'JMD',
      amountJmd: 500,
      paymentTransactionId: transactionId || null,
      paymentSessionId: sessionId || null,
      paymentProvider: 'fygaro',
      paymentStatus: transactionId ? 'paid' : 'not_collected',
      status: 'pending',
      source: 'AppointmentsScreen',
    };

    const res = await FirebaseService.createMedicalReportRequest(payload);
    console.log('✅ Medical report request created:', { success: res?.success, id: res?.id, payload });
    if (!res?.success) {
      throw new Error(res?.error || 'Failed to save request');
    }
    return res;
  };

  const handlePayAndSubmitMedicalReportRequest = async () => {
    if (medicalReportSubmitting) return;

    const email = String(medicalReportEmail || '').trim();
    if (!email) {
      Alert.alert('Email Required', 'Please enter the email address to receive the medical report.');
      return;
    }

    setMedicalReportSubmitting(true);
    try {
      const initResult = await FygaroPaymentService.initializePayment({
        amount: 500,
        currency: 'JMD',
        appointmentId: null,
        customerId: user?.id || email,
        customerName: user?.name || 'Patient',
        customerEmail: email,
        customerPhone: user?.phone || '',
        description: 'Medical Report Request',
        metadata: {
          type: 'medical_report',
          patientAuthUid: user?.id || null,
        },
      });

      // If Fygaro is disabled, still submit the request (no payment captured).
      if (!initResult?.success && String(initResult?.error || '').toLowerCase().includes('temporarily disabled')) {
        closeMedicalReportRequestModal();
        await createMedicalReportRequest({ transactionId: null, sessionId: null });
        setTimeout(() => {
          Alert.alert('Request Submitted', 'Your medical report request has been submitted.');
        }, 250);
        return;
      }

      if (!initResult?.success || !initResult?.paymentUrl) {
        throw new Error(initResult?.error || 'Failed to initialize payment');
      }

      closeMedicalReportRequestModal();

      if (Platform.OS === 'web') {
        try {
          window.open(initResult.paymentUrl, '_blank');
        } catch (_) {
          // ignore
        }

        Alert.alert(
          'Payment Opened',
          'Complete payment in the new tab. Then return here and tap “Verify Payment” to submit your request.',
          [
            {
              text: 'Verify Payment',
              onPress: async () => {
                try {
                  const verification = await FygaroPaymentService.verifyPayment(initResult.transactionId);
                  if (!verification?.success) {
                    throw new Error(verification?.error || 'Payment verification failed');
                  }
                  await createMedicalReportRequest({
                    transactionId: verification.transactionId || initResult.transactionId,
                    sessionId: initResult.sessionId,
                  });
                  Alert.alert('Request Submitted', 'Your medical report request has been submitted.');
                } catch (e) {
                  Alert.alert('Verification Error', e?.message || 'Failed to verify payment.');
                }
              },
            },
            { text: 'OK' },
          ]
        );
        return;
      }

      navigation.navigate('PaymentWebview', {
        paymentUrl: initResult.paymentUrl,
        sessionId: initResult.sessionId,
        transactionId: initResult.transactionId,
        onSuccess: async (verificationResult) => {
          try {
            await createMedicalReportRequest({
              transactionId: verificationResult?.transactionId || initResult.transactionId,
              sessionId: initResult.sessionId,
            });
            setTimeout(() => {
              Alert.alert('Request Submitted', 'Your medical report request has been submitted.');
            }, 250);
          } catch (e) {
            setTimeout(() => {
              Alert.alert('Request Error', 'Payment succeeded, but we could not save your request. Please contact support.');
            }, 250);
          }
        },
        onPaymentSuccess: async (verificationResult) => {
          try {
            await createMedicalReportRequest({
              transactionId: verificationResult?.transactionId || initResult.transactionId,
              sessionId: initResult.sessionId,
            });
            setTimeout(() => {
              Alert.alert('Request Submitted', 'Your medical report request has been submitted.');
            }, 250);
          } catch (e) {
            setTimeout(() => {
              Alert.alert('Request Error', 'Payment succeeded, but we could not save your request. Please contact support.');
            }, 250);
          }
        },
      });
    } catch (error) {
      Alert.alert('Payment Error', error?.message || 'Failed to process payment');
    } finally {
      setMedicalReportSubmitting(false);
    }
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
          <TouchableWeb
            style={styles.clearButton}
            activeOpacity={0.8}
            onPress={openMedicalReportRequestModal}
          >
            <MaterialCommunityIcons
              name="file-document-outline"
              size={22}
              color={COLORS.white}
            />
          </TouchableWeb>
          <Text style={styles.welcomeText}>My Appointments</Text>
          <TouchableWeb
            style={styles.clearButton}
            activeOpacity={0.8}
            onPress={() => {
              setIsSearchOpen((prev) => {
                const next = !prev;
                if (!next) {
                  Keyboard.dismiss();
                  setSearchQuery('');
                } else {
                  setTimeout(() => {
                    try {
                      searchInputRef.current?.focus?.();
                    } catch (e) {}
                  }, 0);
                }
                return next;
              });
            }}
          >
            <MaterialCommunityIcons
              name={isSearchOpen ? 'close' : 'magnify'}
              size={22}
              color={COLORS.white}
            />
          </TouchableWeb>
        </View>

        {isSearchOpen && (
          <>
            <View style={styles.headerSearchBar}>
              <TextInput
                ref={searchInputRef}
                style={styles.headerSearchInput}
                placeholder="Search appointments..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholderTextColor={COLORS.white + '80'}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {String(searchQuery || '').length > 0 && (
                <TouchableWeb onPress={() => setSearchQuery('')} style={styles.clearSearchButton} activeOpacity={0.8}>
                  <MaterialCommunityIcons name="close" size={20} color={COLORS.white} />
                </TouchableWeb>
              )}
            </View>

            {searchSuggestions.length > 0 && (
              <View style={styles.headerSuggestionsContainer}>
                {searchSuggestions.map((s) => (
                  <TouchableWeb
                    key={s.key}
                    activeOpacity={0.75}
                    style={styles.headerSuggestionItem}
                    onPress={() => {
                      Keyboard.dismiss();
                      setSearchQuery('');
                      setIsSearchOpen(false);
                      if (s.tab === 'pending' || s.tab === 'upcoming' || s.tab === 'past') {
                        setActiveTab(s.tab);
                      }
                      setTimeout(() => {
                        openAppointmentRecord(s.item);
                      }, 0);
                    }}
                  >
                    <View style={styles.headerSuggestionTextWrap}>
                      <Text style={styles.headerSuggestionTitle} numberOfLines={1}>
                        {s.title}
                      </Text>
                      <Text style={styles.headerSuggestionSubtitle} numberOfLines={1}>
                        {s.subtitle}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.white} />
                  </TouchableWeb>
                ))}
              </View>
            )}
          </>
        )}
      </LinearGradient>

      {/* Medical Report Request Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={medicalReportModalVisible}
        presentationStyle="overFullScreen"
        onRequestClose={closeMedicalReportRequestModal}
      >
        <View style={styles.detailsModalOverlay}>
          <TouchableWeb
            style={styles.modalOverlayTouchable}
            activeOpacity={1}
            onPress={closeMedicalReportRequestModal}
          />
          <View style={styles.detailsModalContainer}>
            <View style={styles.detailsModalHeader}>
              <Text style={styles.detailsModalTitle}>Medical Report</Text>
              <TouchableWeb onPress={closeMedicalReportRequestModal} disabled={medicalReportSubmitting}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <ScrollView
              style={styles.detailsModalContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={true}
              removeClippedSubviews={false}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.confidentialityContent}>
                <View style={styles.confidentialityIconContainer}>
                  <MaterialCommunityIcons name="file-document" size={60} color={COLORS.primary} />
                </View>

                <Text style={styles.confidentialityTitle}>Request a Medical Report</Text>
                <Text style={styles.confidentialityText}>
                  A one-time fee of JMD $1.00 applies. Enter the email address where you want to receive the report.
                </Text>

                <Text style={[styles.formLabel, { marginTop: 6 }]}>Email</Text>
                <View style={styles.formInput}>
                  <MaterialCommunityIcons name="email-outline" size={18} color={COLORS.textLight} />
                  <TextInput
                    style={styles.input}
                    value={medicalReportEmail}
                    onChangeText={setMedicalReportEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={COLORS.textLight}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!medicalReportSubmitting}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableWeb
                style={styles.modalCancelButton}
                onPress={closeMedicalReportRequestModal}
                disabled={medicalReportSubmitting}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableWeb>
              <TouchableWeb
                style={[styles.modalRescheduleButton, medicalReportSubmitting && styles.buttonDisabled]}
                onPress={handlePayAndSubmitMedicalReportRequest}
                disabled={medicalReportSubmitting}
              >
                <LinearGradient
                  colors={['#10b981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.modalRescheduleButtonGradient}
                >
                  <MaterialCommunityIcons name="cash" size={18} color={COLORS.white} />
                  <Text style={styles.modalRescheduleButtonText}>
                    {medicalReportSubmitting ? 'Processing…' : 'Pay J$1.00'}
                  </Text>
                </LinearGradient>
              </TouchableWeb>
            </View>
          </View>
        </View>
      </Modal>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableWeb
          style={styles.tab}
          onPress={() => setActiveTab('pending')}
          activeOpacity={0.7}
        >
          {activeTab === 'pending' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.activeTabGradient}
            >
              <Text style={styles.activeTabText}>
                Pending
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveTabContent}>
              <Text style={styles.tabText}>
                Pending
              </Text>
            </View>
          )}
        </TouchableWeb>
        <TouchableWeb
          style={styles.tab}
          onPress={() => setActiveTab('upcoming')}
          activeOpacity={0.7}
        >
          {activeTab === 'upcoming' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.activeTabGradient}
            >
              <Text style={styles.activeTabText}>
                Upcoming
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveTabContent}>
              <Text style={styles.tabText}>
                Upcoming
              </Text>
            </View>
          )}
        </TouchableWeb>
        <TouchableWeb
          style={styles.tab}
          onPress={() => setActiveTab('past')}
          activeOpacity={0.7}
        >
          {activeTab === 'past' ? (
            <LinearGradient
              colors={GRADIENTS.header}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.activeTabGradient}
            >
              <Text style={styles.activeTabText}>
                Past
              </Text>
            </LinearGradient>
          ) : (
            <View style={styles.inactiveTabContent}>
              <Text style={styles.tabText}>
                Past
              </Text>
            </View>
          )}
        </TouchableWeb>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {displayedAppointmentsSearched.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-blank" size={80} color={COLORS.border} />
            <Text style={styles.emptyTitle}>
              {String(searchQuery || '').trim().length > 0
                ? 'No matching appointments'
                : `No ${activeTab === 'pending' ? 'pending' : activeTab} appointments`}
            </Text>
            <Text style={styles.emptyText}>
              {String(searchQuery || '').trim().length > 0
                ? 'Try a different search or clear it.'
                : activeTab === 'upcoming'
                ? 'Book a service to get started'
                : activeTab === 'pending'
                ? 'No appointments waiting for your confirmation'
                : 'Your completed appointments will appear here'}
            </Text>
            {String(searchQuery || '').trim().length > 0 ? (
              <TouchableWeb style={styles.bookButton} onPress={() => setSearchQuery('')} activeOpacity={0.8}>
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.bookButtonGradient}
                >
                  <MaterialCommunityIcons name="close" size={20} color={COLORS.white} />
                  <Text style={styles.bookButtonText}>Clear Search</Text>
                </LinearGradient>
              </TouchableWeb>
            ) : (activeTab === 'upcoming' || activeTab === 'pending') && (
              <TouchableWeb
                style={styles.bookButton}
                onPress={() => navigation.navigate('Book')}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.bookButtonGradient}
                >
                  <MaterialCommunityIcons name="plus" size={20} color={COLORS.white} />
                  <Text style={styles.bookButtonText}>Book Appointment</Text>
                </LinearGradient>
              </TouchableWeb>
            )}
          </View>
        ) : (
          <View style={styles.appointmentsList}>
            {displayedAppointmentsSearched.map((appointment, index) => {
              // Enhanced shift detection: Check for shift-request indicators
              const hasShiftRequestMarkers = Boolean(
                appointment?.isShiftRequest ||
                appointment?.shiftRequestId ||
                appointment?.adminRecurring === true ||
                Boolean(appointment?.recurringApproved) ||
                Boolean(appointment?.approvedAt) ||
                (Array.isArray(appointment?.coverageRequests) && appointment.coverageRequests.length > 0) ||
                Boolean(appointment?.clockByNurse)
              );

              const hasShiftTimes = Boolean(
                appointment?.startTime && appointment?.endTime &&
                (
                  appointment.status === 'approved' ||
                  appointment.status === 'active' ||
                  appointment.status === 'clocked-in' ||
                  appointment.status === 'in-progress' ||
                  appointment.status === 'pending' ||
                  appointment.status === 'completed' ||
                  appointment.nurseId ||
                  appointment.nurseName
                )
              );

              const isShift = Boolean(
                appointment?.isShift ||
                hasShiftRequestMarkers ||
                hasShiftTimes
              );

              const isConfirmed = appointment.status === 'confirmed' || appointment.status === 'approved' || appointment.status === 'assigned' || appointment.status === 'scheduled';
              const isRecurringInstance = appointment.isRecurringInstance || false;
              const recurringInfo = isRecurringInstance ? {
                instanceNumber: appointment.instanceNumber,
                totalInstances: appointment.totalInstances,
                frequency: appointment.recurringFrequency,
                seriesId: appointment.seriesId
              } : null;
              
              // Generate a unique key to prevent duplicates when mixing appointments and shifts
              const uniqueKey = appointment.id ? `${appointment.id}-${isShift ? 'shift' : 'appt'}-${index}` : `item-${index}`;
              
              // Check if shift is clocked in/active
              const isClockedIn = appointment.status === 'active' || appointment.status === 'clocked-in' || appointment.status === 'in-progress';
              const cardStyle = isClockedIn ? [styles.appointmentCard, styles.clockedInCard] : styles.appointmentCard;

              // Debug logging for Feb 11
              if (appointment.date === '2026-02-11') {
                console.log('[PatientCard][Feb11]', {
                  service: appointment.service,
                  status: appointment.status,
                  isShift,
                  hasShiftRequestMarkers,
                  hasShiftTimes,
                  willOpenRecurringModal: isShift,
                  hasCoverageRequests: Array.isArray(appointment?.coverageRequests) && appointment.coverageRequests.length > 0,
                  hasClockByNurse: Boolean(appointment?.clockByNurse),
                });
              }

              return (
              <View key={uniqueKey} style={cardStyle}>
                {/* Compact card for all appointments - matching admin style */}
                <View style={styles.compactHeader}>
                  <MaterialCommunityIcons 
                    name={activeTab === 'pending' ? "alert" : (isShift ? "repeat" : (isRecurringInstance ? "calendar-refresh" : "medical-bag"))} 
                    size={20} 
                    color={activeTab === 'past' ? COLORS.textLight : activeTab === 'pending' ? COLORS.warning : (isClockedIn ? COLORS.success : (isShift ? COLORS.primary : COLORS.primary))} 
                  />
                  <View style={styles.compactInfo}>
                    <Text style={styles.compactClient}>
                      {appointment.service}
                      {isRecurringInstance && ` (${recurringInfo.instanceNumber}/${recurringInfo.totalInstances})`}
                    </Text>
                    {activeTab === 'past' && (
                      <Text style={styles.compactDate}>
                        {getPastCardDateLabel(appointment)}
                      </Text>
                    )}
                  </View>
                  
                  {activeTab === 'pending' && canEditAppointment(appointment) && (
                    <TouchableWeb
                      style={[styles.detailsButton, { marginRight: 8 }]}
                      activeOpacity={0.7}
                      onPress={() => handleEdit(appointment)}
                    >
                      <LinearGradient
                        colors={['#f59e0b', '#d97706']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.detailsButtonGradient}
                      >
                        <Text style={styles.detailsButtonText}>Edit</Text>
                      </LinearGradient>
                    </TouchableWeb>
                  )}

                  <TouchableWeb
                    style={styles.detailsButton}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedAppointment(appointment);
                      const isRecurring = appointment.isRecurring || appointment.isRecurringInstance || appointment.recurringScheduleId || appointment.recurringSchedule || appointment.recurringFrequency || appointment.seriesId || isShift;
                      
                      // Debug: Log modal selection for Feb 11
                      if (appointment.date === '2026-02-11') {
                        console.log('[PatientView][Feb11]', {
                          service: appointment.service,
                          willOpenRecurringModal: isRecurring || isShift,
                          isShift,
                          isRecurring,
                          modalType: (isRecurring || isShift) ? 'RecurringShiftDetails' : 'RegularDetails',
                        });
                      }
                      
                      if (isRecurring || isShift) {
                        setRecurringShiftDetailsModalVisible(true);
                      } else {
                        setDetailsModalVisible(true);
                      }
                    }}
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
                {/* Patient cards now only show icon, title, and details button like admin cards */}
              </View>
            );
            })}
          </View>
        )}



        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={detailsModalVisible}
        onRequestClose={() => setDetailsModalVisible(false)}
      >
        <TouchableWeb 
          style={styles.detailsModalOverlay}
          activeOpacity={1}
          onPress={() => setDetailsModalVisible(false)}
        >
          <TouchableWeb 
            style={styles.detailsModalContainer}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.detailsModalHeader}>
              <Text style={styles.detailsModalTitle}>Appointment Details</Text>
              <TouchableWeb onPress={() => setDetailsModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <ScrollView 
              style={styles.detailsModalContent} 
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
              scrollEventThrottle={16}
            >
              {selectedAppointment && (
                <>
                  {(() => {
                    const statusLower = String(selectedAppointment?.status || '').trim().toLowerCase();
                    const isPendingModal =
                      activeTab === 'pending' ||
                      ['pending', 'requested', 'awaiting', 'unassigned', 'assigned'].includes(statusLower);
                    
                    if (!isPendingModal) return null;

                    let patientAlerts =
                      selectedAppointment?.patientAlerts ||
                      selectedAppointment?.clinicalInfo ||
                      selectedAppointment?.appointmentDetails?.patientAlerts ||
                      selectedAppointment?.bookingDetails?.patientAlerts ||
                      selectedAppointment?.requestDetails?.patientAlerts ||
                      null;

                    if (typeof patientAlerts === 'string') {
                      try {
                        patientAlerts = JSON.parse(patientAlerts);
                      } catch (e) {
                        patientAlerts = null;
                      }
                    }

                    const allergiesRaw =
                      patientAlerts?.allergies ||
                      patientAlerts?.allergyList ||
                      selectedAppointment?.allergies ||
                      selectedAppointment?.allergyList ||
                      null;
                    const allergies = Array.isArray(allergiesRaw)
                      ? allergiesRaw.map((a) => String(a).trim()).filter(Boolean)
                      : [];
                    const allergyOther = String(
                      patientAlerts?.allergyOther ||
                        selectedAppointment?.allergyOther ||
                        selectedAppointment?.allergyOtherText ||
                        ''
                    ).trim();

                    let vitals =
                      patientAlerts?.vitals ||
                      patientAlerts?.vitalSigns ||
                      selectedAppointment?.vitals ||
                      selectedAppointment?.vitalSigns ||
                      null;

                    if (typeof vitals === 'string') {
                      try {
                        vitals = JSON.parse(vitals);
                      } catch (e) {
                        vitals = null;
                      }
                    }
                    const bpSys = String(vitals?.bpSystolic || '').trim();
                    const bpDia = String(vitals?.bpDiastolic || '').trim();
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
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Service Information</Text>
                    <View style={styles.detailItem}>
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>Service Type</Text>
                        {isEditing ? (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{ marginTop: 8 }}
                          >
                            {services.map((service) => (
                              <TouchableWeb
                                key={`${service.id}-${service.title}`}
                                style={[
                                  styles.serviceChip,
                                  editForm.service === service.title && { overflow: 'hidden' },
                                  { marginRight: 8, marginBottom: 4 }
                                ]}
                                onPress={() => setEditForm({ ...editForm, service: service.title })}
                                activeOpacity={0.7}
                              >
                                {editForm.service === service.title ? (
                                  <LinearGradient
                                    colors={GRADIENTS.header}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 0, y: 1 }}
                                    style={styles.serviceChipGradient}
                                  >
                                    <Text
                                      style={styles.serviceChipTextSelected}
                                      numberOfLines={1}
                                    >
                                      {service.title}
                                    </Text>
                                  </LinearGradient>
                                ) : (
                                  <View style={styles.inactiveServiceChip}>
                                    <Text
                                      style={styles.serviceChipText}
                                      numberOfLines={1}
                                    >
                                      {service.title}
                                    </Text>
                                  </View>
                                )}
                              </TouchableWeb>
                            ))}
                          </ScrollView>
                        ) : (
                          <Text style={styles.detailValue}>{selectedAppointment.service || 'N/A'}</Text>
                        )}
                      </View>
                    </View>

                    {isEditing ? (
                      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20, marginLeft: 16 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailLabel}>Date</Text>
                          <TouchableWeb 
                            style={styles.editInputContainer}
                            onPress={() => setShowDatePicker(true)}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <MaterialCommunityIcons name="calendar" size={20} color={COLORS.primary} />
                              <Text style={styles.editInput}>
                                {editForm.date || 'Select Date'}
                              </Text>
                            </View>
                          </TouchableWeb>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailLabel}>Time</Text>
                          <TouchableWeb 
                            style={styles.editInputContainer}
                            onPress={() => setShowTimePicker(true)}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <MaterialCommunityIcons name="clock-outline" size={20} color={COLORS.primary} />
                              <Text style={styles.editInput}>
                                {editForm.time ? formatTimeTo12Hour(editForm.time) : 'Select Time'}
                              </Text>
                            </View>
                          </TouchableWeb>
                        </View>
                      </View>
                    ) : (
                      <>
                        {/* Date & Time Display - Enhanced Schedule (works even if isRecurring is missing) */}
                        {(() => {
                          const apt = selectedAppointment;
                          const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== '';
                          const hasDays =
                            (Array.isArray(apt.daysOfWeek) && apt.daysOfWeek.length > 0) ||
                            (Array.isArray(apt.selectedDays) && apt.selectedDays.length > 0);

                          const showEnhancedSchedule =
                            !!apt.isRecurring ||
                            !!apt.isRecurringInstance ||
                            hasValue(apt.startDate) ||
                            hasValue(apt.endDate) ||
                            hasValue(apt.startTime) ||
                            hasValue(apt.endTime) ||
                            hasValue(apt.recurringFrequency) ||
                            hasValue(apt.recurringDuration) ||
                            hasDays;

                          if (!showEnhancedSchedule) {
                            return (
                              <>
                                <View style={styles.detailItem}>
                                  <View style={styles.detailContent}>
                                    <Text style={styles.detailLabel}>Date</Text>
                                    <Text style={styles.detailValue}>
                                      {apt.date && !isNaN(new Date(apt.date))
                                        ? new Date(apt.date).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                          })
                                        : apt.date || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                                <View style={styles.detailItem}>
                                  <View style={styles.detailContent}>
                                    <Text style={styles.detailLabel}>Time</Text>
                                    <Text style={styles.detailValue}>
                                      {formatTimeTo12Hour(apt.time || apt.scheduledTime) || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                              </>
                            );
                          }

                          const pickFirstDate = (candidates) => {
                            for (const value of candidates) {
                              if (value === undefined || value === null) continue;
                              if (String(value).trim() === '') continue;
                              return value;
                            }
                            return null;
                          };

                          const startDateRaw = pickFirstDate([
                            apt.scheduledDate,
                            apt.date,
                            apt.shiftDate,
                            apt.startDate,
                            apt.start_date,
                            apt.start,
                            apt.serviceDate,
                            apt.appointmentDate,
                            apt.requestedDate,
                            apt.preferredDate,
                            apt.shiftDetails?.startDate,
                            apt.shiftDetails?.date,
                            apt.shift?.startDate,
                            apt.shift?.date,
                            apt.recurringStartDate,
                            apt.recurringPeriodStart,
                            apt.requestedAt,
                            apt.createdAt,
                          ]);

                          const endDateRaw = pickFirstDate([
                            apt.endDate,
                            apt.end,
                            apt.serviceEndDate,
                            apt.appointmentEndDate,
                            apt.requestedEndDate,
                            apt.shiftDetails?.endDate,
                            apt.shift?.endDate,
                            apt.recurringEndDate,
                            apt.recurringPeriodEnd,
                          ]);
                          const startTimeRaw = apt.startTime || apt.time || apt.scheduledTime;
                          const endTimeRaw = apt.endTime;

                          const isTrulyRecurring =
                            !!apt.isRecurring ||
                            !!apt.isRecurringInstance ||
                            hasValue(apt.recurringFrequency) ||
                            hasValue(apt.recurringDuration) ||
                            hasDays;

                          const formatDateMaybe = (raw) => {
                            if (!raw) return null;
                            
                            // Handle "Feb 19, 2026" format from BookScreen
                            if (typeof raw === 'string') {
                              const match = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
                              if (match) {
                                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                const monthIndex = monthNames.findIndex(m => m === match[1]);
                                if (monthIndex !== -1) {
                                  const d = new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
                                  if (!isNaN(d.getTime())) {
                                    return d.toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    });
                                  }
                                }
                              }
                            }
                            
                            const d = new Date(raw);
                            if (isNaN(d)) return String(raw);
                            return d.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            });
                          };

                          return (
                            <View style={styles.recurringDetailsContainer}>
                              {/* Start Date & Time */}
                              <View style={styles.recurringTimeContainer}>
                                <View style={styles.recurringTimeItem}>
                                  <MaterialCommunityIcons name="calendar-start" size={16} color={COLORS.success} />
                                  <View style={styles.recurringTimeContent}>
                                    <Text style={styles.recurringTimeLabel}>Start Date</Text>
                                    <Text style={styles.recurringTimeValue}>
                                      {formatDateMaybe(startDateRaw) || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                                <View style={styles.recurringTimeDivider} />
                                <View style={styles.recurringTimeItem}>
                                  <MaterialCommunityIcons name="clock-start" size={16} color={COLORS.primary} />
                                  <View style={styles.recurringTimeContent}>
                                    <Text style={styles.recurringTimeLabel}>Start Time</Text>
                                    <Text style={styles.recurringTimeValue}>
                                      {formatTimeTo12Hour(startTimeRaw) || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* End Date & Time */}
                              <View style={styles.recurringTimeContainer}>
                                <View style={styles.recurringTimeItem}>
                                  <MaterialCommunityIcons name="calendar-end" size={16} color={COLORS.error} />
                                  <View style={styles.recurringTimeContent}>
                                    <Text style={styles.recurringTimeLabel}>End Date</Text>
                                    <Text style={styles.recurringTimeValue}>
                                        {isTrulyRecurring
                                          ? (formatDateMaybe(endDateRaw) || 'Ongoing')
                                          : (formatDateMaybe(endDateRaw || startDateRaw) || 'N/A')}
                                      </Text>
                                  </View>
                                </View>
                                <View style={styles.recurringTimeDivider} />
                                <View style={styles.recurringTimeItem}>
                                  <MaterialCommunityIcons name="clock-end" size={16} color={COLORS.primary} />
                                  <View style={styles.recurringTimeContent}>
                                    <Text style={styles.recurringTimeLabel}>End Time</Text>
                                    <Text style={styles.recurringTimeValue}>
                                      {formatTimeTo12Hour(endTimeRaw) || 'N/A'}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Recurring Info */}
                              {isTrulyRecurring && (apt.recurringFrequency || apt.recurringDuration) && (
                                <View style={styles.recurringTimeContainer}>
                                  <View style={styles.recurringTimeItem}>
                                    <MaterialCommunityIcons name="calendar-refresh" size={16} color={COLORS.info} />
                                    <View style={styles.recurringTimeContent}>
                                      <Text style={styles.recurringTimeLabel}>Frequency</Text>
                                      <Text style={styles.recurringTimeValue}>
                                        {apt.recurringFrequency === 'weekly'
                                          ? `Weekly for ${apt.recurringDuration} week${apt.recurringDuration > 1 ? 's' : ''}`
                                          : apt.recurringFrequency === 'biweekly'
                                          ? `Every 2 weeks for ${apt.recurringDuration} period${apt.recurringDuration > 1 ? 's' : ''}`
                                          : 'Recurring'}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              )}
                            </View>
                          );
                        })()}
                      </>
                    )}
                    
                    {/* Requested/Preferred Nurse (Pending tab only) */}
                    {selectedAppointment && activeTab === 'pending' && (isPendingLikeAppointment || Boolean(requestedNurseForModal)) && (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Requested Nurse</Text>
                        {requestedNurseForModal ? (
                          <NurseInfoCard
                            nurse={requestedNurseForModal}
                            nursesRoster={nurses}
                            style={styles.assignedNurseCard}
                            contextType="patient"
                          />
                        ) : (
                          <Text style={styles.assignedNurseEmptyText}>
                            Any nurse
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Assigned + Backup Nurses (Upcoming & Past only) */}
                    {selectedAppointment && (activeTab === 'upcoming' || activeTab === 'past') && (
                      <>
                        {/* Assigned Nurse */}
                        <View style={styles.detailsSection}>
                          <Text style={styles.sectionTitle}>Assigned Nurse</Text>
                          {assignedNurseForModal ? (
                            <NurseInfoCard
                              nurse={assignedNurseForModal}
                              nursesRoster={nurses}
                              style={styles.assignedNurseCard}
                              contextType="patient"
                            />
                          ) : (
                            <Text style={styles.assignedNurseEmptyText}>
                              No nurse assigned yet
                            </Text>
                          )}
                        </View>

                        {/* Backup Nurses (read-only) */}
                        {(() => {
                          const d = selectedAppointment || {};

                          const normalizeId = (value) => {
                            if (value === undefined || value === null) return null;
                            const str = String(value).trim();
                            return str ? str.toLowerCase() : null;
                          };

                          const normalizeCode = (value) => {
                            if (value === undefined || value === null) return null;
                            const str = String(value).trim();
                            return str ? str.toUpperCase() : null;
                          };

                          const rawLists = [
                            d.backupNurses,
                            d.emergencyBackupNurses,
                          ].filter((v) => Array.isArray(v));

                          const merged = rawLists.flat();

                          const coverageBuckets = [d.coverageRequests].filter((v) => Array.isArray(v));
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

                          // Avoid showing the currently assigned/working nurse again inside the Backup Nurses list.
                          const assignedIdForFilter =
                            assignedNurseForModal?.id ||
                            assignedNurseForModal?._id ||
                            assignedNurseForModal?.nurseId ||
                            d.nurseId ||
                            d.assignedNurseId ||
                            d.assignedNurse?.id ||
                            d.assignedNurse?._id ||
                            null;

                          const assignedCodeForFilter =
                            assignedNurseForModal?.staffCode ||
                            assignedNurseForModal?.nurseCode ||
                            assignedNurseForModal?.code ||
                            d.nurseCode ||
                            d.staffCode ||
                            d.assignedNurseCode ||
                            d.assignedNurseStaffCode ||
                            null;

                          const assignedIdNorm = normalizeId(assignedIdForFilter);
                          const assignedCodeNorm = normalizeCode(assignedCodeForFilter);

                          const filtered = (assignedIdNorm || assignedCodeNorm)
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
                              <Text style={styles.sectionTitle}>Backup Nurses</Text>
                              {filtered.length === 0 ? (
                                <Text style={styles.assignedNurseEmptyText}>
                                  No backup nurses added yet
                                </Text>
                              ) : (
                                filtered.map((backup, index) => {
                                  const backupId = backup?.nurseId || backup?.id || backup?._id;
                                  const backupCode = backup?.staffCode || backup?.nurseCode || backup?.code;

                                  let rosterData = null;
                                  if (Array.isArray(nurses)) {
                                    rosterData = nurses.find((n) => {
                                      const nId = String(n?.id || n?._id || n?.uid || n?.nurseId || '').trim();
                                      const nCode = String(n?.nurseCode || n?.staffCode || n?.code || '').trim().toUpperCase();
                                      const wantId = backupId ? String(backupId).trim() : '';
                                      const wantCode = backupCode ? String(backupCode).trim().toUpperCase() : '';
                                      if (wantId && nId && nId === wantId) return true;
                                      if (wantCode && nCode && nCode === wantCode) return true;
                                      return false;
                                    }) || null;
                                  }

                                  const mergedEntry = {
                                    ...(typeof backup === 'object' ? backup : {}),
                                    ...(rosterData || {}),
                                  };

                                  const sanitize = (val, isSpecialty = false) => {
                                    if (!val) return null;
                                    const str = String(val).trim();
                                    const invalid = ['n/a', 'na', 'not provided', 'undefined', 'null', 'none'];
                                    if (isSpecialty) invalid.push('backup nurse');
                                    if (invalid.includes(str.toLowerCase())) return null;
                                    return str;
                                  };

                                  const nurseForCard = {
                                    ...mergedEntry,
                                    fullName:
                                      mergedEntry.fullName ||
                                      mergedEntry.name ||
                                      mergedEntry.nurseName ||
                                      'Backup Nurse',
                                    name:
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

                                  const key = backupId || backupCode || index;

                                  const isClockedIn = (() => {
                                    // 1) If the visit itself is clocked-in/active, highlight the nurse that matches
                                    // the appointment's assigned nurse fields (this mirrors the nurse-side modal logic).
                                    const status = String(selectedAppointment?.status || '').trim().toLowerCase();
                                    const statusImpliesClockedIn =
                                      status === 'clocked-in' || status === 'active' || status === 'in-progress';

                                    if (statusImpliesClockedIn) {
                                      const assignedKeys = [
                                        selectedAppointment?.nurseId,
                                        selectedAppointment?.assignedNurseId,
                                        selectedAppointment?.assignedNurse?.id,
                                        selectedAppointment?.assignedNurse?._id,
                                        selectedAppointment?.nurseCode,
                                        selectedAppointment?.staffCode,
                                        selectedAppointment?.nurseStaffCode,
                                        selectedAppointment?.assignedNurseCode,
                                        selectedAppointment?.assignedNurseStaffCode,
                                      ].filter(Boolean);

                                      const backupIdNorm = backupId ? String(backupId).trim() : null;
                                      const backupCodeNorm = backupCode ? String(backupCode).trim().toUpperCase() : null;

                                      const matchesAssigned = assignedKeys.some((k) => {
                                        const kId = k ? String(k).trim() : null;
                                        const kCode = k ? String(k).trim().toUpperCase() : null;
                                        if (backupIdNorm && kId && backupIdNorm === kId) return true;
                                        if (backupCodeNorm && kCode && backupCodeNorm === kCode) return true;
                                        return false;
                                      });

                                      if (matchesAssigned) return true;
                                    }

                                    // 2) Otherwise (or additionally), infer from clockByNurse when present.
                                    const clockMap =
                                      selectedAppointment?.clockByNurse ||
                                      selectedAppointment?.shift?.clockByNurse ||
                                      selectedAppointment?.shiftDetails?.clockByNurse ||
                                      selectedAppointment?.nurseSchedule?.clockByNurse ||
                                      null;
                                    if (!clockMap || typeof clockMap !== 'object') return false;

                                    const wantIds = [backupId, backup?.uid, backup?.nurseId, backup?.id, backup?._id].filter(Boolean).map(String);
                                    const wantCodes = [backupCode, backup?.staffCode, backup?.nurseCode, backup?.code].filter(Boolean).map((v) => String(v).trim().toUpperCase());

                                    // First try direct key lookup (many payloads store nurse id/code as the map key)
                                    const keyCandidates = [];
                                    wantIds.forEach((v) => {
                                      const s = String(v).trim();
                                      if (!s) return;
                                      keyCandidates.push(s, s.toUpperCase(), s.toLowerCase());
                                    });
                                    wantCodes.forEach((v) => {
                                      const s = String(v).trim();
                                      if (!s) return;
                                      keyCandidates.push(s, s.toUpperCase(), s.toLowerCase());
                                    });

                                    let entry = null;
                                    for (const k of keyCandidates) {
                                      if (clockMap[k]) {
                                        entry = clockMap[k];
                                        break;
                                      }
                                    }

                                    const values = Object.values(clockMap).filter((v) => v && typeof v === 'object');
                                    if (!entry) {
                                      entry = values.find((v) => {
                                        const vId = [v.nurseId, v.uid, v.id, v._id].filter(Boolean).map(String);
                                        const vCode = [v.staffCode, v.nurseCode, v.code].filter(Boolean).map((c) => String(c).trim().toUpperCase());
                                        const idMatch = wantIds.some((id) => vId.includes(id));
                                        const codeMatch = wantCodes.some((c) => vCode.includes(c));
                                        return idMatch || codeMatch;
                                      });
                                    }

                                    if (!entry) return false;
                                    const hasIn = entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
                                    const hasOut = entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt;
                                    return Boolean(hasIn) && !Boolean(hasOut);
                                  })();

                                  return (
                                    <View key={String(key)} style={{ marginTop: index === 0 ? 8 : 10 }}>
                                      <NurseInfoCard
                                        nurse={nurseForCard}
                                        nursesRoster={nurses}
                                        hideSpecialty
                                        hideCode
                                        style={isClockedIn ? styles.cardClockedIn : undefined}
                                        contextType="patient"
                                      />
                                    </View>
                                  );
                                })
                              )}
                            </View>
                          );
                        })()}
                      </>
                    )}

                    {/* Patient Notes (dropdown card w/ timestamp like other notes accordions) */}
                    {selectedAppointment && (
                      <View style={styles.detailsSection}>
                        <Text style={styles.sectionTitle}>Patient Notes</Text>
                        <NotesAccordionList
                          showTime
                          emptyText="No patient notes provided."
                          items={(() => {
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

                              const found = (values || [])
                                .map(normalizeVal)
                                .find((text) => Boolean(text));

                              return found || '';
                            };

                            const patientBookingNotesText = pickFirstNonEmptyText([
                              selectedAppointment.patientNotes,
                              selectedAppointment.patientNote,
                              selectedAppointment.bookingNotes,
                              selectedAppointment.bookingNote,
                              selectedAppointment.clientNotes,
                              selectedAppointment.specialInstructions,
                              selectedAppointment.instructions,
                              selectedAppointment.patient?.notes,
                              selectedAppointment.patient?.patientNotes,
                              selectedAppointment.client?.notes,
                              selectedAppointment.client?.patientNotes,
                              selectedAppointment.clientSnapshot?.notes,
                              selectedAppointment.clientSnapshot?.patientNotes,
                              selectedAppointment.patientSnapshot?.notes,
                              selectedAppointment.patientSnapshot?.patientNotes,
                              selectedAppointment.clientData?.notes,
                              selectedAppointment.clientData?.patientNotes,
                              selectedAppointment.patientData?.notes,
                              selectedAppointment.patientData?.patientNotes,
                            ]);

                            const legacyNotes = pickFirstNonEmptyText([selectedAppointment.notes]);
                            const nurseNotesText = pickFirstNonEmptyText([
                              selectedAppointment.nurseNotes,
                              selectedAppointment.completionNotes,
                            ]);
                            const legacyLooksLikeNurseNotes =
                              Boolean(legacyNotes && nurseNotesText) && legacyNotes === nurseNotesText;

                            const text = patientBookingNotesText || (legacyLooksLikeNurseNotes ? '' : legacyNotes);

                            if (!String(text || '').trim()) {
                              return [];
                            }

                            // Use booking/request timestamps for note time (not the scheduled appointment start time).
                            // `updatedAt` can drift due to later admin/nurse updates, so prefer `requestedAt`/`createdAt`.
                            const dateCandidate =
                              selectedAppointment.requestedAt ||
                              selectedAppointment.createdAt ||
                              selectedAppointment.updatedAt ||
                              null;

                            return [
                              {
                                id: `patient-notes-${selectedAppointment.id || selectedAppointment.appointmentId || 'note'}`,
                                date: dateCandidate,
                                title: 'Patient Note',
                                subtitle: 'From booking',
                                body: String(text).trim(),
                              },
                            ];
                          })()}
                        />
                      </View>
                    )}

                    {/* Always show invoices in Past tab (past/completed visits) */}
                    {activeTab === 'past' && !['cancelled', 'canceled', 'declined', 'rejected'].includes(String(selectedAppointment?.status || '').toLowerCase()) && (
                      <View style={styles.invoiceSection}>
                        <Text style={styles.invoiceLabel}>Recent Invoices</Text>

                        {isLoadingInvoices ? (
                          <View style={styles.noInvoicesContainer}>
                            <MaterialCommunityIcons name="progress-clock" size={32} color={COLORS.border} />
                            <Text style={styles.invoiceLoadingText}>Loading invoices...</Text>
                            <Text style={styles.noInvoicesSubText}>Please hold while we pull your latest billing info</Text>
                          </View>
                        ) : appointmentInvoices.length > 0 ? (
                          <TouchableWeb
                            style={styles.invoiceCard}
                            onPress={() => {
                              const invoice = appointmentInvoices[0];
                              setDetailsModalVisible(false);
                              setTimeout(() => {
                                navigation.navigate('InvoiceDisplay', {
                                  invoiceData: invoice,
                                  clientName: user?.name,
                                  returnToAppointmentModal: true,
                                  appointmentId: selectedAppointment?.id,
                                  appointmentTab: activeTab,
                                  appointmentModalType: 'details',
                                });
                              }, 300);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={styles.invoiceCardHeader}>
                              <View style={styles.invoiceCardLeft}>
                                <View style={styles.invoiceCardInfo}>
                                  <Text style={styles.invoiceCardNumber}>
                                    {appointmentInvoices[0].invoiceId?.replace('CARE-INV', 'NUR-INV') || '#Pending'}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.invoiceCardRight}>
                                {(appointmentInvoices[0].status || 'Pending').toLowerCase() === 'pending' ? (
                                  <View style={styles.invoiceStatusChip}>
                                    <LinearGradient
                                      colors={GRADIENTS.warning}
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 0, y: 1 }}
                                      style={styles.invoiceStatusChipGradient}
                                    >
                                      <Text style={styles.invoiceStatusChipText}>Pending</Text>
                                    </LinearGradient>
                                  </View>
                                ) : (appointmentInvoices[0].status || '').toLowerCase() === 'paid' ? (
                                  <View style={styles.invoiceStatusChip}>
                                    <LinearGradient
                                      colors={['#10b981', '#059669']}
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 0, y: 1 }}
                                      style={styles.invoiceStatusChipGradient}
                                    >
                                      <Text style={styles.invoiceStatusChipText}>Paid</Text>
                                    </LinearGradient>
                                  </View>
                                ) : (appointmentInvoices[0].status || '').toLowerCase() === 'overdue' ? (
                                  <View style={styles.invoiceStatusChip}>
                                    <LinearGradient
                                      colors={['#ef4444', '#dc2626']}
                                      start={{ x: 0, y: 0 }}
                                      end={{ x: 0, y: 1 }}
                                      style={styles.invoiceStatusChipGradient}
                                    >
                                      <Text style={styles.invoiceStatusChipText}>Overdue</Text>
                                    </LinearGradient>
                                  </View>
                                ) : (
                                  <View style={[
                                    styles.invoiceCardStatus,
                                    { backgroundColor: getInvoiceStatusStyles(appointmentInvoices[0].status).backgroundColor }
                                  ]}>
                                    <Text style={[
                                      styles.invoiceCardStatusText,
                                      { color: getInvoiceStatusStyles(appointmentInvoices[0].status).textColor }
                                    ]}>
                                      {appointmentInvoices[0].status || 'Pending'}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          </TouchableWeb>
                        ) : (
                          <View style={styles.noInvoicesContainer}>
                            <MaterialCommunityIcons name="receipt-text-outline" size={32} color={COLORS.border} />
                            <Text style={styles.noInvoicesText}>No invoices generated yet</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>



                  {/* Visit History for Recurring Shifts */}
                  {selectedAppointment.visitHistory && selectedAppointment.visitHistory.length > 0 && (
                    <View style={styles.detailsSection}>
                      <Text style={styles.sectionTitle}>Visit History</Text>
                      {selectedAppointment.visitHistory.map((visit, index) => (
                        <View key={index} style={styles.visitHistoryItem}>
                          <View style={styles.visitHistoryHeader}>
                            <View style={styles.visitHistoryDateContainer}>
                              <MaterialCommunityIcons name="calendar-check" size={16} color={COLORS.primary} />
                              <Text style={styles.visitHistoryDate}>
                                {new Date(visit.date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
                              </Text>
                            </View>
                            <View style={styles.visitHistoryStatusBadge}>
                              <Text style={styles.visitHistoryStatusText}>Completed</Text>
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {activeTab === 'past' && !['cancelled', 'canceled', 'declined', 'rejected'].includes(String(selectedAppointment?.status || '').toLowerCase()) && (
                    <View style={styles.detailsSection}>
                      {/* Nurse Card with Clock Details */}
                      {(() => {
                        const assignedNurse = resolveAssignedNurse(selectedAppointment);
                        const clockInTime = selectedAppointment.actualStartTime || selectedAppointment.clockInTime || selectedAppointment.startedAt;
                        const clockOutTime = selectedAppointment.actualEndTime || selectedAppointment.clockOutTime || selectedAppointment.completedAt;
                        
                        // Calculate total hours if both times are available
                        const calculateHours = () => {
                          if (!clockInTime || !clockOutTime) return 'N/A';
                          const clockIn = new Date(clockInTime);
                          const clockOut = new Date(clockOutTime);
                          const diffMs = clockOut - clockIn;
                          const diffHours = diffMs / (1000 * 60 * 60);
                          return `${diffHours.toFixed(2)} hours`;
                        };

                        return null;
                      })()}

                      {nurseNotesUnlocked[selectedAppointment?.id] ? (
                        <View
                          style={styles.nurseNotesContainer}
                          onStartShouldSetResponder={() => true}
                        >
                          <View style={styles.secureNotesHeader}>
                            <View style={styles.secureNotesHeaderLeft}>
                              <MaterialCommunityIcons name="shield-lock" size={16} color={COLORS.success} />
                              <Text style={styles.secureNotesLabel}>Secured Medical Notes</Text>
                            </View>
                            <TouchableWeb
                              onPress={() => {
                                setNurseNotesUnlocked(prev => ({
                                  ...prev,
                                  [selectedAppointment.id]: false
                                }));
                              }}
                              style={styles.secureNotesCloseButton}
                              activeOpacity={0.6}
                            >
                              <MaterialCommunityIcons name="close" size={18} color={COLORS.textLight} />
                            </TouchableWeb>
                          </View>
                          <Text style={styles.nurseNotesText}>
                            {selectedAppointment.nurseNotes || selectedAppointment.completionNotes || 'No additional notes provided by the nurse.'}
                          </Text>
                          <View style={styles.screenshotWarning}>
                            <Text style={styles.screenshotWarningText}>Screenshots are not permitted</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.lockedNotesCard}>
                          <View style={styles.lockedNotesCardContent}>
                            <MaterialCommunityIcons name="file-document-outline" size={24} color={COLORS.primary} />
                            <View style={styles.lockedNotesCardTextContainer}>
                              <Text style={styles.lockedNotesCardTitle}>Medical Notes</Text>
                              <Text style={styles.lockedNotesCardSubtitle}>JMD $500 to unlock</Text>
                            </View>
                          </View>
                          <TouchableWeb
                            style={buttonStyles.warningPillButton}
                            onPress={handleUnlockNurseNotes}
                            activeOpacity={0.8}
                          >
                            <LinearGradient
                              colors={GRADIENTS.warning}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 0, y: 1 }}
                              style={buttonStyles.warningPillGradient}
                            >
                              <Text style={buttonStyles.warningPillText}>Unlock</Text>
                            </LinearGradient>
                          </TouchableWeb>
                        </View>
                      )}
                    </View>
                  )}

                </>
              )}
            </ScrollView>

              {/* Action Buttons for Pending Appointments */}
              {selectedAppointment && selectedAppointment.status === 'pending' && (
                <View style={styles.modalFooter}>
                  {isEditing ? (
                    <>
                      <TouchableWeb
                        style={styles.modalCancelButton}
                        onPress={() => setIsEditing(false)}
                      >
                        <Text style={styles.modalCancelButtonText}>Cancel Edit</Text>
                      </TouchableWeb>
                      <TouchableWeb
                        style={styles.modalRescheduleButton}
                        onPress={handleSaveEdit}
                      >
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.modalRescheduleButtonGradient}
                        >
                          <MaterialCommunityIcons name="content-save" size={18} color={COLORS.white} />
                          <Text style={styles.modalRescheduleButtonText}>Save Changes</Text>
                        </LinearGradient>
                      </TouchableWeb>
                    </>
                  ) : (
                    <>
                      <TouchableWeb
                        style={styles.modalCancelButton}
                        onPress={() => {
                          Alert.alert(
                            'Cancel Appointment',
                            'Are you sure you want to cancel this appointment?',
                            [
                              { text: 'No', style: 'cancel' },
                              {
                                text: 'Yes, Cancel',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await cancelAppointment(selectedAppointment.id);
                                    
                                    // Send notification to admin about cancellation
                                    try {
                                      await sendNotificationToUser(
                                        'ADMIN001',
                                        'admin',
                                        'Appointment Cancelled by Patient',
                                        `${user?.name || 'A patient'} has cancelled their appointment for ${selectedAppointment.service} on ${selectedAppointment.date}`,
                                        {
                                          type: 'appointment_cancelled',
                                          appointmentId: selectedAppointment.id,
                                          patientId: user?.id,
                                          patientName: user?.name,
                                          service: selectedAppointment.service,
                                          date: selectedAppointment.date,
                                          time: selectedAppointment.time || selectedAppointment.scheduledTime,
                                          targetRole: 'admin'
                                        }
                                      );
                                    } catch (notifError) {
                                      console.error('Failed to send cancellation notification:', notifError);
                                    }
                                    
                                    setDetailsModalVisible(false);
                                    Alert.alert('Success', 'Appointment cancelled. Admin has been notified.');
                                  } catch (error) {
                                    Alert.alert('Error', 'Failed to cancel appointment');
                                  }
                                }
                              }
                            ]
                          );
                        }}
                      >
                        <Text style={styles.modalCancelButtonText}>Cancel</Text>
                      </TouchableWeb>

                      <TouchableWeb
                        style={styles.modalRescheduleButton}
                        onPress={async () => {
                          setDetailsModalVisible(false);
                          
                          // Send notification to admin about reschedule request
                          try {
                            await sendNotificationToUser(
                              'ADMIN001',
                              'admin',
                              'Appointment Reschedule Requested',
                              `${user?.name || 'A patient'} is rescheduling their appointment for ${selectedAppointment.service} (originally ${selectedAppointment.date})`,
                              {
                                type: 'appointment_reschedule',
                                appointmentId: selectedAppointment.id,
                                patientId: user?.id,
                                patientName: user?.name,
                                service: selectedAppointment.service,
                                originalDate: selectedAppointment.date,
                                originalTime: selectedAppointment.time || selectedAppointment.scheduledTime,
                                targetRole: 'admin'
                              }
                            );
                          } catch (notifError) {
                            console.error('Failed to send reschedule notification:', notifError);
                          }
                          
                          navigation.navigate('Book', { 
                            rescheduleAppointment: selectedAppointment 
                          });
                        }}
                      >
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.modalRescheduleButtonGradient}
                        >
                          <MaterialCommunityIcons name="calendar-edit" size={18} color={COLORS.white} />
                          <Text style={styles.modalRescheduleButtonText}>Reschedule</Text>
                        </LinearGradient>
                      </TouchableWeb>
                    </>
                  )}
                </View>
              )}
            </TouchableWeb>
          </TouchableWeb>
      </Modal>

      {/* Date Picker */}
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal 
          transparent={true} 
          animationType="fade"
          visible={true}
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Select Date</Text>
                <TouchableWeb
                  onPress={() => setShowDatePicker(false)}
                  style={styles.pickerCloseButton}
                >
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableWeb>
              </View>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="spinner"
                onChange={onDateChange}
                minimumDate={new Date()}
                textColor={COLORS.text}
              />
              <TouchableWeb
                style={styles.pickerConfirmButton}
                onPress={confirmDateSelection}
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
        </Modal>
      )}

      {/* Android Date Picker */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          onChange={onDateChange}
          minimumDate={new Date()}
        />
      )}

      {/* Time Picker */}
      {showTimePicker && Platform.OS === 'ios' && (
        <Modal 
          transparent={true} 
          animationType="fade"
          visible={true}
          onRequestClose={() => setShowTimePicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Select Time</Text>
                <TouchableWeb
                  onPress={() => setShowTimePicker(false)}
                  style={styles.pickerCloseButton}
                >
                  <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
                </TouchableWeb>
              </View>
              <DateTimePicker
                value={pickerTime}
                mode="time"
                display="spinner"
                onChange={onTimeChange}
                textColor={COLORS.text}
              />
              <TouchableWeb
                style={styles.pickerConfirmButton}
                onPress={confirmTimeSelection}
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
        </Modal>
      )}

      {/* Android Time Picker */}
      {showTimePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={pickerTime}
          mode="time"
          display="default"
          onChange={onTimeChange}
        />
      )}

      {/* Confidentiality Agreement Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showConfidentialityModal}
        presentationStyle="overFullScreen"
        onRequestClose={handleCloseConfidentialityModal}
      >
        <View style={styles.detailsModalOverlay}>
          <TouchableWeb 
            style={styles.modalOverlayTouchable}
            activeOpacity={1}
            onPress={handleCloseConfidentialityModal}
          />
          <View style={styles.detailsModalContainer}>
            <View style={styles.detailsModalHeader}>
              <Text style={styles.detailsModalTitle}>Confidentiality Agreement</Text>
              <TouchableWeb onPress={handleCloseConfidentialityModal}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <ScrollView 
              style={styles.detailsModalContent} 
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={true}
              removeClippedSubviews={false}
              scrollEventThrottle={16}
            >
              <View style={styles.confidentialityContent}>
                <View style={styles.confidentialityIconContainer}>
                  <MaterialCommunityIcons name="shield-lock-outline" size={60} color={COLORS.primary} />
                </View>

                <Text style={styles.confidentialityTitle}>Medical Information Confidentiality</Text>
                
                <Text style={styles.confidentialityText}>
                  By accessing the nurse's professional notes, you acknowledge and agree to the following terms:
                </Text>

                <View style={styles.confidentialityTerms}>
                  <View style={styles.termItem}>
                    <MaterialCommunityIcons name="circle-small" size={20} color={COLORS.text} />
                    <Text style={styles.termText}>
                      The information contained in these notes is confidential medical information intended solely for your personal health record.
                    </Text>
                  </View>

                  <View style={styles.termItem}>
                    <MaterialCommunityIcons name="circle-small" size={20} color={COLORS.text} />
                    <Text style={styles.termText}>
                      You will not share, copy, reproduce, or distribute this information to any third party without proper authorization.
                    </Text>
                  </View>

                  <View style={styles.termItem}>
                    <MaterialCommunityIcons name="circle-small" size={20} color={COLORS.text} />
                    <Text style={styles.termText}>
                      Screenshots and screen recordings of this information are strictly prohibited and may violate privacy laws.
                    </Text>
                  </View>

                  <View style={styles.termItem}>
                    <MaterialCommunityIcons name="circle-small" size={20} color={COLORS.text} />
                    <Text style={styles.termText}>
                      This information is subject to healthcare privacy regulations and professional nursing standards.
                    </Text>
                  </View>

                  <View style={styles.termItem}>
                    <MaterialCommunityIcons name="circle-small" size={20} color={COLORS.text} />
                    <Text style={styles.termText}>
                      A non-refundable access fee of JMD $500 applies to unlock these professional notes.
                    </Text>
                  </View>
                </View>

                <TouchableWeb
                  style={styles.confidentialityCheckbox}
                  onPress={() => setConfidentialityAccepted(!confidentialityAccepted)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, confidentialityAccepted && styles.checkboxChecked]}>
                    {confidentialityAccepted && (
                      <MaterialCommunityIcons name="check" size={18} color={COLORS.white} />
                    )}
                  </View>
                  <Text style={styles.checkboxLabel}>
                    I accept the terms and conditions of this confidentiality agreement
                  </Text>
                </TouchableWeb>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableWeb
                style={styles.modalCancelButton}
                onPress={() => handleCloseConfidentialityModal()}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableWeb>
              <TouchableWeb
                style={[styles.modalRescheduleButton, !confidentialityAccepted && styles.buttonDisabled]}
                disabled={!confidentialityAccepted}
                onPress={async () => {
                  if (!confidentialityAccepted) {
                    Alert.alert('Agreement Required', 'Please accept the confidentiality agreement to proceed.');
                    return;
                  }

                  Alert.alert(
                    'Confirm Payment',
                    'Pay JMD $500 to unlock nurse notes for this visit?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Pay Now',
                        onPress: async () => {
                          try {
                            const paymentResult = await FygaroPaymentService.initializePayment({
                              appointmentId: currentAppointmentForNotes.id,
                              patientId: user?.id,
                              patientName: user?.name,
                              patientEmail: user?.email,
                              patientPhone: user?.phone,
                              amount: 500,
                            });

                            if (paymentResult.success) {
                              // Open payment URL in browser or webview
                              handleCloseConfidentialityModal();
                              
                              // For web, open in new tab
                              if (Platform.OS === 'web') {
                                window.open(paymentResult.paymentUrl, '_blank');
                              } else {
                                // For mobile, navigate to payment webview
                                navigation.navigate('PaymentWebview', {
                                  paymentUrl: paymentResult.paymentUrl,
                                  sessionId: paymentResult.sessionId,
                                  transactionId: paymentResult.transactionId,
                                  appointmentId: currentAppointmentForNotes.id,
                                  onSuccess: async () => {
                                    setNurseNotesUnlocked(prev => ({
                                      ...prev,
                                      [currentAppointmentForNotes.id]: true
                                    }));
                                    
                                    // Notify admin about successful payment
                                    try {
                                      await sendNotificationToUser(
                                        'ADMIN001',
                                        'admin',
                                        'Nurse Notes Payment Received',
                                        `${user?.name} paid JMD $500 to unlock nurse notes for appointment ${currentAppointmentForNotes.id}`,
                                        {
                                          type: 'payment_success',
                                          appointmentId: currentAppointmentForNotes.id,
                                          patientId: user?.id,
                                          patientName: user?.name,
                                          amount: 500,
                                          currency: 'JMD',
                                          transactionId: paymentResult.transactionId,
                                          targetRole: 'admin'
                                        }
                                      );
                                    } catch (notifError) {
                                      console.error('Failed to notify admin:', notifError);
                                    }
                                    
                                    Alert.alert(
                                      'Success',
                                      'Payment successful! You now have access to the nurse notes.',
                                      [{ text: 'OK' }]
                                    );
                                  }
                                });
                              }
                            } else {
                              Alert.alert(
                                'Payment Error',
                                paymentResult.error || 'Failed to initialize payment. Please try again.'
                              );
                            }
                          } catch (error) {
                            console.error('Payment Error:', error);
                            Alert.alert(
                              'Payment Error',
                              'An error occurred while processing your payment. Please try again.'
                            );
                          }
                        },
                      },
                    ],
                  );
                }}
              >
                <LinearGradient
                  colors={confidentialityAccepted ? ['#10b981', '#059669'] : ['#ccc', '#999']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.modalRescheduleButtonGradient}
                >
                  <MaterialCommunityIcons name="cash" size={18} color={COLORS.white} />
                  <Text style={styles.modalRescheduleButtonText}>Pay JMD $500</Text>
                </LinearGradient>
              </TouchableWeb>
            </View>
          </View>
        </View>
      </Modal>

      {/* Recurring Shift Details Modal */}
      <RecurringShiftDetailsModal
        visible={recurringShiftDetailsModalVisible}
        onClose={() => setRecurringShiftDetailsModalVisible(false)}
        shift={selectedAppointment || {}}
        nurses={nurses || []}
        contextType="patient"
        navigation={navigation}
        showPatientPostVisitSections={
          activeTab === 'past' &&
          !['cancelled', 'canceled', 'declined', 'rejected'].includes(String(selectedAppointment?.status || '').toLowerCase())
        }
        patientInvoices={appointmentInvoices}
        patientIsLoadingInvoices={isLoadingInvoices}
        onOpenPatientInvoice={(invoice) => {
          if (!invoice) return;
          setRecurringShiftDetailsModalVisible(false);
          setTimeout(() => {
            navigation.navigate('InvoiceDisplay', {
              invoiceData: invoice,
              clientName: user?.name,
              returnToAppointmentModal: true,
              appointmentId: selectedAppointment?.id,
              appointmentTab: activeTab,
              appointmentModalType: 'recurring',
            });
          }, 300);
        }}
        medicalNotesUnlocked={Boolean(nurseNotesUnlocked[selectedAppointment?.id])}
        onUnlockMedicalNotes={handleUnlockNurseNotes}
        onLockMedicalNotes={() => {
          if (!selectedAppointment?.id) return;
          setNurseNotesUnlocked((prev) => ({
            ...prev,
            [selectedAppointment.id]: false,
          }));
        }}
        onSuccess={() => {
          setRecurringShiftDetailsModalVisible(false);
          refreshAppointments();
        }}
      />
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
    color: COLORS.text,
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
  headerSearchBar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerSearchInput: {
    flex: 1,
    minHeight: 20,
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    paddingVertical: 0,
  },
  clearSearchButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSuggestionsContainer: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
  },
  headerSuggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.white + '22',
  },
  headerSuggestionTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  headerSuggestionTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  headerSuggestionSubtitle: {
    marginTop: 2,
    color: COLORS.white,
    opacity: 0.9,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
  },
  clearButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
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
  },
  tabContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
  },
  activeTabGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  inactiveTabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 36,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  tabText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
  },
  activeTabText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  scrollView: {
    flex: 1,
  },
  appointmentsList: {
    paddingHorizontal: 20,
    paddingTop: 16,
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
  clockedInCard: {
    backgroundColor: COLORS.success + '10',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  cardClockedIn: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '10',
    borderWidth: 2,
  },
  appointmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  appointmentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  appointmentService: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusBadgeGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  appointmentDetails: {
    gap: 10,
    marginBottom: 16,
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
  appointmentFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  priceLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  priceValue: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.success, // Green color for money
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  centeredActionButtons: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.error + '15',
  },
  rebookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  rebookText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.accent,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  bookButton: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  bookButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
  },
  bookButtonText: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  addMoreButton: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  addMoreGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  addMoreText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  bottomPadding: {
    height: 24,
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
  invoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.accent,
    marginRight: 8,
  },
  invoiceButtonText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.accent,
    marginLeft: 4,
  },
  rescheduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
    marginRight: 8,
  },
  rescheduleButtonText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
    marginLeft: 4,
  },
  cancelAppointmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.error + '15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  cancelAppointmentButtonText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.error,
    marginLeft: 4,
  },
  // Compact confirmed appointment styles
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
  recurringBadge: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
    marginTop: 2,
  },
  compactDate: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
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
  // Details Modal Styles
  detailsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalOverlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  detailsModalContainer: {
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
    flexDirection: 'column',
    overflow: 'hidden',
  },
  detailsModalContent: {
    padding: 20,
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
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  detailsSection: {
    marginBottom: 32,
  },
  nurseCompletionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  nurseCompletionHeader: {
    marginBottom: 12,
  },
  nurseInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nurseCompletionPhoto: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  nurseCompletionPhotoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nurseCompletionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  nurseCompletionName: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  nurseCompletionCode: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: 'Poppins_400Regular',
  },
  clockCompletionContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  clockCompletionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  clockCompletionItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  clockCompletionLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: 'Poppins_400Regular',
    marginTop: 4,
    marginBottom: 2,
  },
  clockCompletionValue: {
    fontSize: 14,
    color: COLORS.text,
    fontFamily: 'Poppins_600SemiBold',
  },
  totalCompletionHoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent + '10',
    padding: 8,
    borderRadius: 8,
  },
  totalCompletionHoursLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontFamily: 'Poppins_500Medium',
    marginLeft: 6,
    marginRight: 6,
  },
  totalCompletionHoursValue: {
    fontSize: 14,
    color: COLORS.accent,
    fontFamily: 'Poppins_700Bold',
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 20,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingHorizontal: 0,
  },
  detailContent: {
    marginLeft: 16,
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
    lineHeight: 22,
  },
  detailsNotes: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 22,
    marginTop: 8,
  },
  assignedNurseCard: {
    marginTop: 4,
  },
  assignedNurseEmptyText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  recurringDetailsContainer: {
    marginBottom: 12,
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
  // Invoice Section Styles
  invoiceSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  invoiceLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
    marginBottom: 12,
  },
  invoiceCard: {
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
  invoiceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  invoiceCardInfo: {
    gap: 2,
  },
  invoiceCardNumber: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  invoiceCardDate: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  invoiceCardRight: {
    alignItems: 'flex-end',
  },
  invoiceCardStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  invoiceCardStatusText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
  },
  invoiceStatusChip: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  invoiceStatusChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  invoiceStatusChipText: {
    marginLeft: 0,
    color: COLORS.white,
    fontWeight: '600',
    fontSize: 12,
  },
  invoiceHistorySection: {
    marginTop: 15,
  },
  invoiceHistoryTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 10,
  },
  invoiceHistoryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  activeInvoiceHistoryItem: {
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  invoiceHistoryInfo: {
    flex: 1,
  },
  invoiceHistoryId: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  invoiceHistoryDate: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  invoiceHistoryRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  invoiceHistoryAmount: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  invoiceHistoryStatus: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  invoiceHistoryStatusText: {
    fontSize: 10,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
  },
  invoiceHistoryService: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  // Invoice Preview Styles
  invoicePreviewContainer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  invoicePreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  invoicePreviewTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  invoicePaidDate: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  invoicePendingDate: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#FF9800',
    marginTop: 2,
  },
  noInvoicesContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 15,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noInvoicesText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginTop: 8,
  },
  noInvoicesSubText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
  },
  // Invoice Information Styles
  invoiceInfoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.success + '10',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  invoiceInfoTextContainer: {
    flex: 1,
  },
  invoiceInfoTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
    marginBottom: 4,
  },
  invoiceInfoDescription: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 18,
  },
  invoiceDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
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
  // Modal Footer Action Buttons
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButtonText: {
    color: COLORS.error,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  modalRescheduleButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalRescheduleButtonGradient: {
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modalRescheduleButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Visit History Styles
  visitHistoryItem: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  visitHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  visitHistoryDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  visitHistoryDate: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  visitHistoryStatusBadge: {
    backgroundColor: COLORS.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  visitHistoryStatusText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
  },
  visitHistoryDetails: {
    gap: 6,
  },
  visitHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  visitHistoryTime: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  visitHistoryNotesContainer: {
    marginTop: 4,
    backgroundColor: COLORS.white,
    padding: 8,
    borderRadius: 8,
  },
  visitHistoryNotesLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  visitHistoryNotes: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    fontStyle: 'italic',
  },
  visitInvoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.accent,
    marginTop: 8,
    gap: 6,
  },
  visitInvoiceButtonText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.accent,
  },
  // Service Chip Styles
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
  // Picker Styles
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000, // Higher than modal
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
    width: '90%',
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
  // PDF Invoice Preview Styles
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
    width: '100%',
    minHeight: 500,
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
  pdfInvoiceInfo: {
    alignItems: 'flex-end',
  },
  pdfInvoiceTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfInvoiceNumber: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfInvoiceDate: {
    fontSize: 9,
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
  pdfSectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  pdfClientName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfClientInfo: {
    fontSize: 9,
    color: COLORS.textLight,
    marginBottom: 1,
  },
  pdfProviderName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  pdfProviderInfo: {
    fontSize: 9,
    color: COLORS.textLight,
    marginBottom: 1,
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
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pdfTableHeaderText: {
    flex: 1,
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfTableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  pdfTableCell: {
    flex: 1,
    fontSize: 9,
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfTableCellAmount: {
    flex: 1,
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  pdfBottomSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 10,
    gap: 10,
  },
  pdfPaymentSection: {
    flex: 1,
  },
  pdfPaymentTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  bankAccountGroup: {
    marginBottom: 4,
  },
  pdfPaymentInfo: {
    fontSize: 8,
    color: COLORS.textLight,
    lineHeight: 12,
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
    fontSize: 10,
    color: COLORS.text,
  },
  pdfTotalValue: {
    fontSize: 10,
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
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  pdfFinalTotalAmount: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  paidStampContainer: {
    marginTop: 10,
    alignItems: 'center',
  },
  paidStamp: {
    borderWidth: 2,
    borderColor: COLORS.success,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    transform: [{ rotate: '-15deg' }],
  },
  paidStampText: {
    color: COLORS.success,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  previewShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  previewShareText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  editInputContainer: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: COLORS.white,
  },
  editInput: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    padding: 0,
  },
  // Nurse Notes Styles
  nurseNotesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  lockedNotesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 12,
  },
  lockedNotesCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  lockedNotesCardTextContainer: {
    flex: 1,
  },
  lockedNotesCardTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  lockedNotesCardSubtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  nurseNotesContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.success + '30',
  },
  secureNotesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  secureNotesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secureNotesCloseButton: {
    padding: 4,
  },
  secureNotesLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.success,
  },
  nurseNotesText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  screenshotWarning: {
    alignItems: 'center',
    paddingTop: 8,
  },
  screenshotWarningText: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.error,
  },
  // Confidentiality Modal Styles
  confidentialityContent: {
    padding: 4,
  },
  confidentialityIconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  confidentialityTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  confidentialityText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: 20,
  },
  confidentialityTerms: {
    marginBottom: 24,
  },
  termItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  termText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 20,
  },
  confidentialityCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.background,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
