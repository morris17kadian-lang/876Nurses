import TouchableWeb from "../components/TouchableWeb";
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Keyboard,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { useAuth } from '../context/AuthContext';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAppointments } from '../context/AppointmentContext';
import { useNurses } from '../context/NurseContext';
import { useShifts } from '../context/ShiftContext';
import InvoiceService from '../services/InvoiceService';
import EmailService from '../services/EmailService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNurseName } from '../utils/formatters';
import NotesAccordionList from '../components/NotesAccordionList';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function AdminClientsScreen({ navigation, route, isEmbedded = false, searchQuery = '' }) {
  const { logout } = useAuth();
  const { appointments: allAppointments, getAppointmentsByStatus } = useAppointments();
  const { nurses: nursesFromContext } = useNurses();
  const { shiftRequests } = useShifts();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  
  const medicalNotesReportModalHeight = useMemo(() => {
    const base = Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : 700;
    return Math.min(620, Math.max(340, Math.floor(base * 0.82)));
  }, [windowHeight]);
  
  const [isAddClientModalVisible, setIsAddClientModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [clientDetailsModalVisible, setClientDetailsModalVisible] = useState(false);
  const [fullInvoiceModalVisible, setFullInvoiceModalVisible] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [recentInvoicesExpanded, setRecentInvoicesExpanded] = useState(false);
  const [notePhotoPreviewVisible, setNotePhotoPreviewVisible] = useState(false);
  const [notePhotoPreviewUri, setNotePhotoPreviewUri] = useState(null);
  const [medicalNotesReportModalVisible, setMedicalNotesReportModalVisible] = useState(false);
  const [medicalNotesReportEmail, setMedicalNotesReportEmail] = useState('');
  const [medicalNotesReportSending, setMedicalNotesReportSending] = useState(false);
  const [medicalNotesReportItems, setMedicalNotesReportItems] = useState([]);
  const [medicalNotesReportClient, setMedicalNotesReportClient] = useState(null);
  const [medicalNotesReportPeriod, setMedicalNotesReportPeriod] = useState('all');
  const [medicalNotesReportFromDate, setMedicalNotesReportFromDate] = useState(null);
  const [medicalNotesReportToDate, setMedicalNotesReportToDate] = useState(null);
  const [medicalNotesReportShowFromPicker, setMedicalNotesReportShowFromPicker] = useState(false);
  const [medicalNotesReportShowToPicker, setMedicalNotesReportShowToPicker] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);
  const [currentInvoiceData, setCurrentInvoiceData] = useState(null);
  const [clients, setClients] = useState([]);

  const normalizedSearchQuery = useMemo(() => String(searchQuery || '').trim().toLowerCase(), [searchQuery]);
  const displayedClients = useMemo(() => {
    const list = Array.isArray(clients) ? clients : [];
    if (!normalizedSearchQuery) return list;

    return list.filter((client) => {
      const name = String(client?.name || '').toLowerCase();
      const email = String(client?.email || '').toLowerCase();
      const phone = String(client?.phone || '').toLowerCase();
      const address = String(client?.address || '').toLowerCase();
      return (
        name.includes(normalizedSearchQuery) ||
        email.includes(normalizedSearchQuery) ||
        phone.includes(normalizedSearchQuery) ||
        address.includes(normalizedSearchQuery)
      );
    });
  }, [clients, normalizedSearchQuery]);
  const [clientForm, setClientForm] = useState({
    name: '',
    email: '',
    phone: '',
    serviceType: '',
    paymentMethod: ''
  });
  
  // Company details and payment info for invoice display
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

  useEffect(() => {
    if (clientDetailsModalVisible) {
      setRecentInvoicesExpanded(false);
    }
  }, [clientDetailsModalVisible, selectedClient?.id]);

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

  const openMedicalNotesReportModal = useCallback((client, items) => {
    setMedicalNotesReportClient(client || null);
    setMedicalNotesReportItems(Array.isArray(items) ? items : []);
    setMedicalNotesReportEmail('');
    setMedicalNotesReportPeriod('all');
    setMedicalNotesReportFromDate(null);
    setMedicalNotesReportToDate(null);
    setMedicalNotesReportShowFromPicker(false);
    setMedicalNotesReportShowToPicker(false);
    setMedicalNotesReportModalVisible(true);
  }, []);

  const closeMedicalNotesReportModal = useCallback(() => {
    setMedicalNotesReportModalVisible(false);
    setMedicalNotesReportSending(false);
    setMedicalNotesReportShowFromPicker(false);
    setMedicalNotesReportShowToPicker(false);
  }, []);

  const isValidEmail = (value) => {
    const v = String(value || '').trim();
    if (!v) return false;
    // Simple, pragmatic validation
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  };

  const formatReportDateTime = (value) => {
    if (!value) return '';
    try {
      const d = value instanceof Date
        ? value
        : typeof value === 'object' && typeof value.toDate === 'function'
          ? value.toDate()
          : new Date(value);
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const formatReportDateOnly = (value) => {
    if (!value) return '';
    try {
      const d = value instanceof Date
        ? value
        : typeof value === 'object' && typeof value.toDate === 'function'
          ? value.toDate()
          : new Date(value);
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  };

  const toEpochMs = (value) => {
    if (!value) return 0;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 0 : value.getTime();
    }

    if (typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      }

      const seconds =
        typeof value.seconds === 'number'
          ? value.seconds
          : typeof value._seconds === 'number'
            ? value._seconds
            : null;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        return seconds * 1000;
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getMedicalNotesReportItemsForPeriod = (items) => {
    const list = Array.isArray(items) ? items : [];
    if (medicalNotesReportPeriod === 'all') return list;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    if (medicalNotesReportPeriod === '7d') {
      const start = now - 7 * dayMs;
      return list.filter((n) => {
        const t = toEpochMs(n?.date);
        return t >= start && t <= now;
      });
    }

    if (medicalNotesReportPeriod === '30d') {
      const start = now - 30 * dayMs;
      return list.filter((n) => {
        const t = toEpochMs(n?.date);
        return t >= start && t <= now;
      });
    }

    if (medicalNotesReportPeriod === 'custom') {
      const fromMs = medicalNotesReportFromDate ? toEpochMs(medicalNotesReportFromDate) : 0;
      const toMs = medicalNotesReportToDate ? toEpochMs(medicalNotesReportToDate) : now;
      if (fromMs && toMs && fromMs > toMs) return [];
      return list.filter((n) => {
        const t = toEpochMs(n?.date);
        return t >= (fromMs || 0) && t <= (toMs || now);
      });
    }

    return list;
  };

  const getMedicalNotesReportPeriodLabel = () => {
    if (medicalNotesReportPeriod === '7d') return 'Last 7 days';
    if (medicalNotesReportPeriod === '30d') return 'Last 30 days';
    if (medicalNotesReportPeriod === 'custom') {
      const fromLabel = medicalNotesReportFromDate ? formatReportDateOnly(medicalNotesReportFromDate) : '';
      const toLabel = medicalNotesReportToDate ? formatReportDateOnly(medicalNotesReportToDate) : '';
      if (fromLabel && toLabel) return `${fromLabel} – ${toLabel}`;
      if (fromLabel) return `From ${fromLabel}`;
      if (toLabel) return `Up to ${toLabel}`;
      return 'Custom range';
    }
    return 'All time';
  };

  const escapeHtml = (unsafe) => {
    const s = String(unsafe ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const buildMedicalNotesReportHtml = ({ client, items }) => {
    const safeClientName = escapeHtml(client?.name || 'Client');
    const safeClientEmail = escapeHtml(client?.email || '');
    const generatedAt = formatReportDateTime(new Date());
    const safeGeneratedAt = escapeHtml(generatedAt);

    const rows = (Array.isArray(items) ? items : []).map((n) => {
      const dateLabel = escapeHtml(formatReportDateTime(n?.date) || '');
      const title = escapeHtml(n?.title || 'Note');
      const subtitle = escapeHtml(n?.subtitle || '');
      const body = escapeHtml(n?.body || '');
      const photos = Array.isArray(n?.photoUrls) ? n.photoUrls : [];
      const photoLinks = photos
        .filter((u) => typeof u === 'string' && u.trim().length > 0)
        .map((u) => {
          const href = escapeHtml(u.trim());
          return `<li style="margin:0 0 6px 0;"><a href="${href}" style="color:#2f62d7;text-decoration:underline;">${href}</a></li>`;
        })
        .join('');

      return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 14px;margin:0 0 12px 0;">
          <div style="font-size:12px;color:#6b7280;margin:0 0 6px 0;">${dateLabel}</div>
          <div style="font-size:14px;font-weight:700;color:#111827;margin:0 0 2px 0;">${title}</div>
          ${subtitle ? `<div style="font-size:12px;color:#374151;margin:0 0 10px 0;">${subtitle}</div>` : ''}
          <div style="font-size:13px;white-space:pre-wrap;line-height:1.6;color:#111827;">${body || '&nbsp;'}</div>
          ${photoLinks ? `
            <div style="margin-top:12px;">
              <div style="font-size:12px;font-weight:700;color:#111827;margin:0 0 6px 0;">Photos</div>
              <ul style="padding-left:18px;margin:0;">${photoLinks}</ul>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Medical Notes Report</title>
        </head>
        <body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,sans-serif;color:#111827;">
          <div style="max-width:700px;margin:0 auto;padding:28px 18px;">
            <div style="margin:0 0 18px 0;">
              <div style="font-size:18px;font-weight:800;margin:0 0 4px 0;">Medical Notes Report</div>
              <div style="font-size:12px;color:#6b7280;">Generated: ${safeGeneratedAt}</div>
            </div>
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 14px;margin:0 0 16px 0;background:#fafafa;">
              <div style="font-size:12px;color:#6b7280;margin:0 0 6px 0;">Client</div>
              <div style="font-size:14px;font-weight:800;">${safeClientName}</div>
              ${safeClientEmail ? `<div style="font-size:12px;color:#374151;">${safeClientEmail}</div>` : ''}
            </div>
            ${rows || '<div style="font-size:13px;color:#6b7280;">No notes found for this client.</div>'}
            <div style="margin-top:22px;font-size:11px;color:#9ca3af;line-height:1.6;">
              This report was generated from the 876 Nurses admin app.
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const buildMedicalNotesReportText = ({ client, items }) => {
    const safeClientName = String(client?.name || 'Client');
    const generatedAt = formatReportDateTime(new Date());
    const list = (Array.isArray(items) ? items : []).map((n) => {
      const when = formatReportDateTime(n?.date) || '';
      const title = String(n?.title || 'Note');
      const subtitle = String(n?.subtitle || '');
      const body = String(n?.body || '');
      const photos = Array.isArray(n?.photoUrls)
        ? n.photoUrls.filter((u) => typeof u === 'string' && u.trim().length > 0)
        : [];
      const photoBlock = photos.length ? `\nPhotos:\n- ${photos.join('\n- ')}` : '';
      return `\n[${when}] ${title}${subtitle ? ` (${subtitle})` : ''}\n${body}${photoBlock}\n`;
    }).join('\n');

    return `Medical Notes Report\nGenerated: ${generatedAt}\nClient: ${safeClientName}\n\n${list || 'No notes found.'}\n`;
  };

  const sendMedicalNotesReport = useCallback(async () => {
    if (medicalNotesReportSending) return;

    const to = String(medicalNotesReportEmail || '').trim();
    if (!isValidEmail(to)) {
      Alert.alert('Invalid email', 'Please enter a valid recipient email address.');
      return;
    }

    const client = medicalNotesReportClient || selectedClient;
    const baseItems = Array.isArray(medicalNotesReportItems) ? medicalNotesReportItems : [];
    const items = getMedicalNotesReportItemsForPeriod(baseItems);
    if (!client) {
      Alert.alert('Missing client', 'Please select a client first.');
      return;
    }

    if (items.length === 0) {
      Alert.alert('No notes', 'There are no medical notes to include in this report.');
      return;
    }

    if (medicalNotesReportPeriod === 'custom') {
      const fromMs = medicalNotesReportFromDate ? toEpochMs(medicalNotesReportFromDate) : 0;
      const toMs = medicalNotesReportToDate ? toEpochMs(medicalNotesReportToDate) : Date.now();
      if (fromMs && toMs && fromMs > toMs) {
        Alert.alert('Invalid range', 'The “From” date must be on or before the “To” date.');
        return;
      }
    }

    setMedicalNotesReportSending(true);
    try {
      const config = await EmailService.getConfig();
      const provider = config?.provider || 'firebase';

      // Silent auto-config:
      // - If email is disabled, enable it.
      // - If set to backend without an API key, switch to Firebase mail queue.
      // This avoids any "email service disabled" popup and just queues the report.
      if (!config?.enabled || (provider === 'backend' && !config?.apiKey)) {
        const saveRes = await EmailService.saveConfig({
          ...(config || {}),
          provider: 'firebase',
          enabled: true,
        });

        if (!saveRes?.success) {
          throw new Error(saveRes?.error || 'Could not enable email sending.');
        }
      }

      const periodLabel = getMedicalNotesReportPeriodLabel();
      const subject = `Medical Notes Report - ${client?.name || 'Client'} - ${periodLabel} (${items.length} notes)`;
      const html = buildMedicalNotesReportHtml({ client, items });
      const text = buildMedicalNotesReportText({ client, items });

      const res = await EmailService.send({
        to,
        subject,
        html,
        text,
        meta: {
          type: 'medical_notes_report',
          clientId: client?.id || null,
          clientName: client?.name || null,
          noteCount: items.length,
          period: medicalNotesReportPeriod,
          periodLabel,
        },
      });

      if (!res?.success) {
        Alert.alert('Failed to send', res?.error || 'Could not send the medical notes report.');
        setMedicalNotesReportSending(false);
        return;
      }

      Alert.alert('Queued', `Medical notes report queued to send to ${to}.`);
      setMedicalNotesReportSending(false);
      closeMedicalNotesReportModal();
    } catch (e) {
      Alert.alert('Failed to send', e?.message || 'Could not send the medical notes report.');
      setMedicalNotesReportSending(false);
    }
  }, [
    medicalNotesReportSending,
    medicalNotesReportEmail,
    medicalNotesReportClient,
    medicalNotesReportItems,
    medicalNotesReportPeriod,
    medicalNotesReportFromDate,
    medicalNotesReportToDate,
    selectedClient,
    closeMedicalNotesReportModal,
  ]);

  const sanitizeContactValue = (value) => {
    if (!value && value !== 0) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (['no email provided', 'no phone provided', 'not provided', 'n/a', 'na'].includes(lower)) {
      return '';
    }
    return trimmed;
  };

  const sanitizeMediaValue = (value) => {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    if (['n/a', 'na', 'none', 'null', 'undefined', 'no photo', 'no image'].includes(lower)) {
      return '';
    }
    return trimmed;
  };

  const resolvePatientPhoto = (appointment) => {
    if (!appointment) return '';
    
    const candidates = [
      appointment.patientPhoto,
      appointment.patientProfilePhoto,
      appointment.patient?.photoUrl,
      appointment.patient?.profilePhoto,
      appointment.patient?.profileImage,
      appointment.patient?.profilePicture,
      appointment.patient?.photo,
      appointment.patient?.avatar,
      appointment.patient?.imageUrl,
      appointment.patient?.photoURL,
      appointment.profilePhoto,
      appointment.clientPhoto,
      appointment.clientAvatar,
      appointment.client?.photoUrl,
      appointment.client?.profilePhoto,
      appointment.client?.profileImage,
      appointment.client?.profilePicture,
      appointment.client?.photo,
      appointment.client?.avatar,
      appointment.client?.imageUrl,
      appointment.client?.photoURL,
      appointment.avatarUrl,
      appointment.photoUrl
    ].map(sanitizeMediaValue);

    return candidates.find(Boolean) || '';
  };

  const buildUserLookups = (usersList = []) => {
    const byId = new Map();
    const byEmail = new Map();
    const byName = new Map();

    usersList.forEach(profile => {
      if (!profile) return;
      const possibleIds = [profile.id, profile._id, profile.uid, profile.userId];
      possibleIds.filter(Boolean).forEach(id => byId.set(String(id), profile));

      if (profile.email) {
        byEmail.set(profile.email.toLowerCase(), profile);
      }
      if (profile.contactEmail) {
        byEmail.set(profile.contactEmail.toLowerCase(), profile);
      }

      const usernames = [profile.username, profile.code, profile.adminCode];
      const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
      usernames.filter(Boolean).forEach(name => byName.set(name.toLowerCase(), profile));
      if (fullName) {
        byName.set(fullName.toLowerCase(), profile);
      }
      if (profile.fullName) {
        byName.set(profile.fullName.toLowerCase(), profile);
      }
    });

    return { byId, byEmail, byName };
  };

  const resolveProfileForAppointment = (apt, lookup) => {
    if (!apt || !lookup) return null;
    const candidates = [];
    const potentialIds = [
      apt.patientId,
      apt.patient?.id,
      apt.patient?._id,
      apt.patient,
      apt.clientId,
      apt.client?.id,
      apt.client?._id
    ];
    potentialIds.filter(Boolean).forEach(id => candidates.push(lookup.byId.get(String(id))));

    if (apt.patientEmail) {
      candidates.push(lookup.byEmail.get(apt.patientEmail.toLowerCase()));
    }
    if (apt.email) {
      candidates.push(lookup.byEmail.get(String(apt.email).toLowerCase()));
    }

    const possibleNames = [apt.patientName, apt.clientName];
    possibleNames.filter(Boolean).forEach(name => {
      candidates.push(lookup.byName.get(name.toLowerCase()));
    });

    return candidates.find(Boolean) || null;
  };

  const [firebaseUsers, setFirebaseUsers] = useState([]);
  
  // Fetch users from Firebase to get updated profile photos
  useEffect(() => {
    const fetchFirebaseUsers = async () => {
      try {
        const usersCollection = collection(db, 'users');
        const usersSnapshot = await getDocs(usersCollection);
        const usersData = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setFirebaseUsers(usersData);
      } catch (error) {
        console.error('Error fetching Firebase users:', error);
      }
    };
    
    fetchFirebaseUsers();
  }, []);

  // Build clients list from completed appointments - load on focus
  useFocusEffect(
    React.useCallback(() => {
      buildClientsFromAppointments();
    }, [allAppointments, firebaseUsers, shiftRequests])
  );

  // Handle reopening client details modal when returning from invoice
  useEffect(() => {
    if (route?.params?.openClientDetails && route?.params?.clientId) {
      const clientToOpen = clients.find(c => c.id === route.params.clientId);
      if (clientToOpen) {
        handleShowClientDetails(clientToOpen);
        // Clear the params after handling
        navigation.setParams({ openClientDetails: undefined, clientId: undefined });
      }
    }
  }, [route?.params?.openClientDetails, route?.params?.clientId, clients]);

  // Load company details and payment info
  useEffect(() => {
    loadCompanyDetails();
    loadPaymentInfo();
  }, []);

  // Handle navigation params to reopen client details modal after invoice view
  useEffect(() => {
    if (route?.params?.openClientDetails && route?.params?.clientId) {
      const clientToOpen = clients.find(c => c.id === route.params.clientId);
      if (clientToOpen) {
        setSelectedClient(clientToOpen);
        setClientDetailsModalVisible(true);
      }
      // Clear the params to prevent reopening on subsequent renders
      navigation.setParams({ openClientDetails: false, clientId: null });
    }
  }, [route?.params, clients]);

  const loadCompanyDetails = async () => {
    try {
      const stored = await AsyncStorage.getItem('companyDetails');
      if (stored) {
        setCompanyDetails(JSON.parse(stored));
      }
    } catch (error) {
      // Error loading company details
    }
  };

  const loadPaymentInfo = async () => {
    try {
      const stored = await AsyncStorage.getItem('paymentInfo');
      if (stored) {
        setPaymentInfo(JSON.parse(stored));
      }
    } catch (error) {
      // Error loading payment info
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      // Handle Firestore Timestamp
      if (typeof dateString === 'object' && dateString.seconds) {
        return new Date(dateString.seconds * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
      
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return String(dateString); // Convert to string to avoid object render error
      const options = { year: 'numeric', month: 'short', day: 'numeric' };
      return date.toLocaleDateString('en-US', options);
    } catch (error) {
      return String(dateString); // Ensure we return a string
    }
  };

  const buildClientsFromAppointments = async () => {
    // IMPORTANT: User Management should not be derived from appointments.
    // Build the client list from actual user records (patients/users), then attach
    // appointment counts and invoice history as enrichment.
    const allInvoices = await InvoiceService.getAllInvoices();
    const invoices = Array.isArray(allInvoices) ? allInvoices : [];

    const allApts = Array.isArray(allAppointments) ? allAppointments : [];

    const getUserId = (profile, index) => {
      const candidates = [
        profile?.id,
        profile?.uid,
        profile?.userId,
        profile?._id?.$oid,
        profile?._id,
      ].filter(Boolean);
      if (candidates.length > 0) return String(candidates[0]);
      const email = sanitizeContactValue(profile?.email || profile?.contactEmail || '');
      if (email) return email.toLowerCase();
      return `user-${index}`;
    };

    const getUserName = (profile) => {
      const fullName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
      return (
        profile?.name ||
        profile?.fullName ||
        profile?.username ||
        profile?.displayName ||
        (fullName || '')
      );
    };

    const isClientUser = (profile) => {
      const role = String(profile?.role || profile?.type || profile?.userType || '').toLowerCase();
      if (role === 'patient' || role === 'user' || role === 'client') return true;
      // If role is missing, keep it out by default to avoid mixing in nurses/admins.
      return false;
    };

    // Build from Firebase users only (offline JSON exports are not included in EAS cloud builds).
    const mergedById = new Map();
    (Array.isArray(firebaseUsers) ? firebaseUsers : []).forEach((u, idx) => {
      if (!u || !isClientUser(u)) return;
      const id = getUserId(u, idx);
      const existing = mergedById.get(id);
      mergedById.set(id, existing ? { ...existing, ...u } : { ...u });
    });

    const clientsMap = new Map();

    Array.from(mergedById.entries()).forEach(([id, profile], index) => {
      const name = String(getUserName(profile) || '').trim();
      if (!name || name.toLowerCase().includes('unknown')) return;

      const email = sanitizeContactValue(profile?.email || profile?.contactEmail || '');
      const phone = [
        profile?.phone,
        profile?.contactNumber,
        profile?.mobile,
        profile?.phoneNumber,
      ].map(sanitizeContactValue).find(Boolean) || '';

      const addressObj = profile?.address;
      const address =
        (typeof addressObj === 'string' ? addressObj : '') ||
        profile?.location ||
        profile?.clientAddress ||
        profile?.patientAddress ||
        '';

      const photoUrl = sanitizeMediaValue(
        profile?.profilePhoto ||
          profile?.profileImage ||
          profile?.photoUrl ||
          profile?.imageUrl ||
          profile?.photoURL ||
          profile?.avatar ||
          profile?.profilePicture ||
          ''
      );

      clientsMap.set(id, {
        id,
        name,
        email,
        phone,
        photoUrl,
        profilePhoto: photoUrl,
        profileImage: photoUrl,
        address: String(address || 'Address on file'),
        serviceType: 'General Care',
        paymentMethod: 'Insurance',
        isSubscriber: false,
        hasRecurringAppointments: false,
        appointments: { upcoming: 0, completed: 0 },
        totalPaid: 'J$0',
        medicalNotes: [],
        invoiceHistory: [],
        completedAppointments: [],
      });
    });

    // Attach related appointments + derive medical notes for the Client Details modal.
    // (Previously `medicalNotes` and `completedAppointments` stayed empty, so the modal showed no notes.)
    const normalizeId = (value) => {
      if (value === null || value === undefined) return null;
      const str = String(value).trim();
      return str ? str : null;
    };
    const normalizeEmailLower = (value) => {
      const trimmed = sanitizeContactValue(value);
      return trimmed ? String(trimmed).trim().toLowerCase() : '';
    };
    const normalizeNameLower = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value).trim().toLowerCase();
      return str;
    };

    const clientsById = new Map();
    const clientsByEmail = new Map();
    const clientsByName = new Map();
    clientsMap.forEach((client) => {
      const idKey = normalizeId(client?.id);
      if (idKey) clientsById.set(idKey, client);
      const emailKey = normalizeEmailLower(client?.email);
      if (emailKey) clientsByEmail.set(emailKey, client);
      const nameKey = normalizeNameLower(client?.name);
      if (nameKey) clientsByName.set(nameKey, client);
    });

    const findClientForAppointment = (apt) => {
      if (!apt) return null;
      const idCandidates = [
        apt?.patientId,
        apt?.clientId,
        apt?.userId,
        apt?.patient?.id,
        apt?.client?.id,
        apt?.patient?._id,
        apt?.client?._id,
      ]
        .map(normalizeId)
        .filter(Boolean);

      for (const idCandidate of idCandidates) {
        const matched = clientsById.get(idCandidate);
        if (matched) return matched;
      }

      const emailCandidates = [
        apt?.patientEmail,
        apt?.clientEmail,
        apt?.email,
        apt?.patient?.email,
        apt?.client?.email,
      ]
        .map(normalizeEmailLower)
        .filter(Boolean);
      for (const emailCandidate of emailCandidates) {
        const matched = clientsByEmail.get(emailCandidate);
        if (matched) return matched;
      }

      const nameCandidates = [apt?.patientName, apt?.clientName, apt?.name]
        .map(normalizeNameLower)
        .filter(Boolean);
      for (const nameCandidate of nameCandidates) {
        const matched = clientsByName.get(nameCandidate);
        if (matched) return matched;
      }

      return null;
    };

    // First, attach every appointment to its client.
    (Array.isArray(allApts) ? allApts : []).forEach((apt) => {
      const client = findClientForAppointment(apt);
      if (!client) return;
      client.completedAppointments = Array.isArray(client.completedAppointments) ? client.completedAppointments : [];
      client.completedAppointments.push(apt);
    });

    // Then compute counts + nurse medical notes from completed appointments.
    const pickFirstText = (values) => {
      const normalizeVal = (val) => {
        if (val === null || val === undefined) return '';
        if (Array.isArray(val)) {
          const inner = val
            .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
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

    const resolveNurseDisplayName = (apt) => {
      const fromObj = (obj) => {
        if (!obj || typeof obj !== 'object') return '';
        return (
          getNurseName(obj) ||
          obj.fullName ||
          obj.name ||
          obj.nurseName ||
          ''
        );
      };
      return (
        String(apt?.nurseName || '').trim() ||
        String(apt?.assignedNurseName || '').trim() ||
        fromObj(apt?.assignedNurse) ||
        fromObj(apt?.nurse) ||
        ''
      );
    };

    const parseDateOnlyLocal = (value) => {
      if (!value) return null;
      if (value instanceof Date && Number.isFinite(value.getTime())) return value;
      const raw = String(value).trim();
      if (!raw) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parsed = new Date(`${raw}T00:00:00`);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
      }
      const parsed = new Date(raw);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    };

    const hasAnyShiftClockOut = (shift) => {
      if (!shift || typeof shift !== 'object') return false;
      if (shift.actualEndTime || shift.clockOutTime || shift.completedAt || shift.lastClockOutTime) {
        return true;
      }

      const clockByNurse = shift.clockByNurse;
      if (!clockByNurse || typeof clockByNurse !== 'object') return false;

      return Object.values(clockByNurse).some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return Boolean(
          entry.lastClockOutTime ||
          entry.clockOutTime ||
          entry.completedAt ||
          entry.actualEndTime
        );
      });
    };

    const isShiftCompletedForClient = (shift) => {
      if (!shift || typeof shift !== 'object') return false;

      const statusNormalized = String(shift?.status || '').trim().toLowerCase();
      if (statusNormalized === 'completed' || shift?.finalCompletedAt) return true;

      const hasClockOut = hasAnyShiftClockOut(shift);
      if (!hasClockOut) return false;

      const periodEnd = parseDateOnlyLocal(
        shift?.recurringPeriodEnd ||
          shift?.endDate ||
          shift?.recurringEndDate ||
          shift?.appointmentEndDate ||
          shift?.date ||
          shift?.scheduledDate ||
          null
      );

      if (!periodEnd) return false;

      const now = new Date();
      const startOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 0, 0, 0, 0);
      const endOfLastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate(), 23, 59, 59, 999);
      const periodFullyEnded = now > endOfLastDay;
      const isLastDay = now >= startOfLastDay && now <= endOfLastDay;

      return periodFullyEnded || isLastDay;
    };

    const isShiftUpcomingForClient = (shift) => {
      if (!shift || typeof shift !== 'object') return false;
      if (isShiftCompletedForClient(shift)) return false;

      const statusNormalized = String(shift?.status || '').trim().toLowerCase();
      return (
        statusNormalized === 'pending' ||
        statusNormalized === 'approved' ||
        statusNormalized === 'active'
      );
    };

    clientsMap.forEach((client) => {
      const related = Array.isArray(client.completedAppointments) ? client.completedAppointments : [];

      const allShifts = Array.isArray(shiftRequests) ? shiftRequests : [];
      const matchingShifts = allShifts.filter((shift) => {
        if (!shift) return false;
        return (
          normalizeId(shift?.clientId) === normalizeId(client.id) ||
          normalizeId(shift?.patientId) === normalizeId(client.id) ||
          normalizeEmailLower(shift?.clientEmail) === normalizeEmailLower(client.email) ||
          normalizeEmailLower(shift?.patientEmail) === normalizeEmailLower(client.email) ||
          normalizeNameLower(shift?.clientName) === normalizeNameLower(client.name) ||
          normalizeNameLower(shift?.patientName) === normalizeNameLower(client.name)
        );
      });

      const completedAppointmentCount = related.filter((a) => String(a?.status || '').toLowerCase() === 'completed').length;
      const upcomingAppointmentCount = related.filter((a) => {
        const s = String(a?.status || '').toLowerCase();
        return s && s !== 'completed' && s !== 'cancelled' && s !== 'canceled' && s !== 'declined';
      }).length;

      const completedShiftCount = matchingShifts.filter((shift) => isShiftCompletedForClient(shift)).length;
      const upcomingShiftCount = matchingShifts.filter((shift) => isShiftUpcomingForClient(shift)).length;

      client.appointments.completed = completedAppointmentCount + completedShiftCount;
      client.appointments.upcoming = upcomingAppointmentCount + upcomingShiftCount;

      const completed = related.filter((a) => String(a?.status || '').toLowerCase() === 'completed');
      const notes = [];

      const normalizePhotoUrls = (raw) => {
        if (!raw) return [];
        const arr = Array.isArray(raw) ? raw : [raw];
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

      completed.forEach((apt, idx) => {
        const text = pickFirstText([
          apt?.nurseNotes,
          apt?.completionNotes,
          apt?.lastCompletionNotes,
        ]);
        if (!text) return;

        const nurseName = resolveNurseDisplayName(apt) || 'Assigned Nurse';
        const dateCandidate =
          apt?.completedAt ||
          apt?.actualEndTime ||
          apt?.updatedAt ||
          apt?.date ||
          apt?.scheduledDate ||
          null;

        notes.push({
          id: apt?.id || apt?._id || apt?.appointmentId || `apt-note-${client.id}-${idx}`,
          date: dateCandidate,
          nurseName,
          appointmentType: apt?.service || apt?.serviceType || apt?.appointmentType || '',
          notes: String(text).trim(),
          photoUrls: normalizePhotoUrls(
            apt?.nurseNotePhotos ||
              apt?.shiftDetails?.nurseNotePhotos ||
              apt?.shift?.nurseNotePhotos ||
              apt?.activeShift?.nurseNotePhotos ||
              null
          ),
        });
      });

      // Also include notes from shift requests (recurring shifts)
      matchingShifts.forEach((shift, idx) => {
        // Extract notes from split schedule nurse notes
        const splitNotes = shift?.splitScheduleNurseNotes || [];
        if (Array.isArray(splitNotes)) {
          splitNotes.forEach((noteEntry, noteIdx) => {
            const noteText = pickFirstText([
              noteEntry?.note,
              noteEntry?.notes,
              noteEntry?.text,
              noteEntry?.body,
            ]);
            if (!noteText) return;

            const nurseName = resolveNurseDisplayName(noteEntry) || 'Assigned Nurse';
            const dateCandidate = noteEntry?.timestamp || noteEntry?.date || noteEntry?.createdAt || shift?.createdAt || null;

            notes.push({
              id: `shift-split-note-${shift?.id || idx}-${noteIdx}`,
              date: dateCandidate,
              nurseName,
              appointmentType: shift?.service || shift?.serviceType || shift?.shiftType || 'Recurring Shift',
              notes: String(noteText).trim(),
              photoUrls: normalizePhotoUrls(noteEntry?.photoUrls || noteEntry?.photos),
            });
          });
        }

        // Extract notes from general nurse notes field
        const generalNoteText = pickFirstText([
          shift?.nurseNotes,
          shift?.notes,
          shift?.completionNotes,
        ]);
        if (generalNoteText) {
          const nurseName = resolveNurseDisplayName(shift) || 'Assigned Nurse';
          const dateCandidate = shift?.completedAt || shift?.actualEndTime || shift?.updatedAt || shift?.createdAt || null;

          notes.push({
            id: shift?.id || shift?._id || `shift-note-${client.id}-${idx}`,
            date: dateCandidate,
            nurseName,
            appointmentType: shift?.service || shift?.serviceType || shift?.shiftType || 'Recurring Shift',
            notes: String(generalNoteText).trim(),
            photoUrls: normalizePhotoUrls(
              shift?.nurseNotePhotos ||
                shift?.shiftDetails?.nurseNotePhotos ||
                shift?.shift?.nurseNotePhotos ||
                null
            ),
          });
        }
      });

      client.medicalNotes = notes;

      // Keep most recent appointments first for modal rendering.
      client.completedAppointments = related.sort((a, b) => {
        const aDate = a?.date || a?.scheduledDate || a?.createdAt || a?.updatedAt || a?.completedAt || null;
        const bDate = b?.date || b?.scheduledDate || b?.createdAt || b?.updatedAt || b?.completedAt || null;
        const aMs = aDate ? Date.parse(aDate) : 0;
        const bMs = bDate ? Date.parse(bDate) : 0;
        if (!Number.isFinite(aMs) && !Number.isFinite(bMs)) return 0;
        if (!Number.isFinite(aMs)) return 1;
        if (!Number.isFinite(bMs)) return -1;
        return bMs - aMs;
      });
    });

    // Attach invoices for each client by id/email/name match
    const extractInvoiceSequence = (invoiceIdValue) => {
      if (!invoiceIdValue || typeof invoiceIdValue !== 'string') return null;
      const match = invoiceIdValue.match(/(\d{1,})\s*$/);
      if (!match) return null;
      const num = Number(match[1]);
      return Number.isFinite(num) ? num : null;
    };

    clientsMap.forEach((client) => {
      const idKey = String(client.id);
      const emailKey = sanitizeContactValue(client.email).toLowerCase();
      const nameKey = String(client.name || '').trim().toLowerCase();

      const matched = invoices.filter((inv) => {
        const invId = inv?.clientId || inv?.patientId || inv?.userId;
        if (invId !== undefined && invId !== null && String(invId) === idKey) return true;

        const invEmail = sanitizeContactValue(inv?.clientEmail || inv?.patientEmail || inv?.email || '').toLowerCase();
        if (emailKey && invEmail && invEmail === emailKey) return true;

        const invName = String(inv?.clientName || inv?.patientName || '').trim().toLowerCase();
        if (nameKey && invName && invName === nameKey) return true;

        return false;
      });

      if (matched.some((inv) => Boolean(inv?.isRecurring || inv?.recurringBilling))) {
        client.hasRecurringAppointments = true;
      }

      matched.forEach((inv) => {
        const invoiceId = inv?.invoiceId || inv?.id;
        if (!invoiceId) return;
        const alreadyAdded = client.invoiceHistory.some((existing) => String(existing.id) === String(invoiceId));
        if (alreadyAdded) return;
        client.invoiceHistory.push({
          id: invoiceId,
          date: inv?.createdAt || inv?.issueDate,
          amount: inv?.total,
          status: inv?.status || 'Pending',
          paidDate: inv?.paidDate || null,
          paymentMethod: inv?.paymentMethod || null,
          invoiceRecord: inv,
        });
      });

      client.invoiceHistory.sort((a, b) => {
        const aSeq = extractInvoiceSequence(a?.id);
        const bSeq = extractInvoiceSequence(b?.id);
        if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return bSeq - aSeq;
        if (aSeq !== null && bSeq === null) return -1;
        if (aSeq === null && bSeq !== null) return 1;
        return String(b?.id || '').localeCompare(String(a?.id || ''));
      });
    });
      
      const clientsList = Array.from(clientsMap.values()).filter(client => {
        const name = client.name ? client.name.toLowerCase() : '';
        const isFiltered = name.includes('unknown patient') || name.includes('unknown client');
        return !isFiltered;
      });
      
      clientsList.forEach(client => {
        client.email = sanitizeContactValue(client.email);
        client.phone = sanitizeContactValue(client.phone);
        client.photoUrl = sanitizeMediaValue(client.photoUrl);
        if (client.photoUrl) {
          client.profilePhoto = client.profilePhoto || client.photoUrl;
          client.profileImage = client.profileImage || client.photoUrl;
        }
      });

      // Debug invoice history logs removed
      
      setClients(clientsList);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      // Error logging out
    }
  };

  const handleAddClient = () => {
    if (!clientForm.name || !clientForm.email || !clientForm.phone) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    // Add client to data (in a real app, this would be an API call)
    const newClient = {
      id: Date.now(),
      name: clientForm.name,
      email: clientForm.email,
      phone: clientForm.phone,
      serviceType: clientForm.serviceType || 'General Care',
      paymentMethod: clientForm.paymentMethod || 'Insurance',
      isSubscriber: false,
      appointments: {
        upcoming: 0,
        completed: 0
      },
      totalPaid: 'J$0'
    };

    Alert.alert('Success', 'Client added successfully!');
    
    // Reset form
    setClientForm({
      name: '',
      email: '',
      phone: '',
      serviceType: '',
      paymentMethod: ''
    });
    setIsAddClientModalVisible(false);
  };

  const handleDeleteClient = (client) => {
    setClientToDelete(client);
    setDeleteModalVisible(true);
  };

  const handleShowClientDetails = (client) => {
    // Use the client object as built by buildClientsFromAppointments,
    // which already includes completed appointments and invoiceHistory.
    setSelectedClient(client);
    setClientDetailsModalVisible(true);
  };

  // Enhanced invoice generation system
  const generateInvoiceData = (client) => {
    const currentDate = new Date();
    const formatDate = (date) => {
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    };

    // Calculate service pricing based on service type
    const getServicePricing = (serviceType) => {
      const servicePrices = {
        'Physical Therapy': { unitPrice: 7500, sessions: 6 },
        'Wound Care': { unitPrice: 5000, sessions: 4 },
        'Home Care': { unitPrice: 8000, sessions: 8 },
        'Medication Administration': { unitPrice: 3000, sessions: 5 },
        'Blood Pressure Monitoring': { unitPrice: 2500, sessions: 3 },
        'Post-Surgery Care': { unitPrice: 9000, sessions: 5 },
        'Diabetic Care': { unitPrice: 6000, sessions: 4 },
        'General Care': { unitPrice: 4000, sessions: 3 }
      };
      return servicePrices[serviceType] || { unitPrice: 4000, sessions: 3 };
    };

    // Get completed appointments from the last billing period
    const getCompletedAppointments = (client) => {
      // For recurring patients, calculate based on their recent completed sessions
      if (client.hasRecurringAppointments) {
        const pricing = getServicePricing(client.serviceType);
        return {
          sessions: pricing.sessions,
          unitPrice: pricing.unitPrice,
          dates: client.medicalNotes.slice(-pricing.sessions).map(note => note.date)
        };
      } else {
        // For non-recurring, use actual completed appointments
        const pricing = getServicePricing(client.serviceType);
        return {
          sessions: Math.min(client.appointments.completed, pricing.sessions),
          unitPrice: pricing.unitPrice,
          dates: client.medicalNotes.slice(-Math.min(client.appointments.completed, pricing.sessions)).map(note => note.date)
        };
      }
    };

    const appointmentData = getCompletedAppointments(client);
    const subtotal = appointmentData.sessions * appointmentData.unitPrice;
    const tax = 0; // No tax for healthcare services
    const total = subtotal + tax;

    // Generate invoice number
    const invoiceNumber = Math.floor(Math.random() * 900) + 100;

    return {
      invoiceNumber,
      client: {
        name: client.name,
        address: client.address || '6 Reece Road, Kingston 10',
        email: client.email,
        phone: client.phone
      },
      company: {
        name: '876 Nurses Home Care Services Limited',
        phone: '8766189876',
        email: '876nurses@gmail.com'
      },
      dates: {
        invoiceDate: formatDate(currentDate),
        dueDate: formatDate(new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)), // Next day
        serviceDates: appointmentData.dates.join(', ')
      },
      services: {
        description: client.serviceType,
        unitPrice: appointmentData.unitPrice,
        quantity: appointmentData.sessions,
        amount: subtotal,
        serviceDates: appointmentData.dates
      },
      billing: {
        subtotal,
        tax,
        total,
        paid: client.hasRecurringAppointments ? total : 0, // Auto-pay for recurring
        balanceDue: client.hasRecurringAppointments ? 0 : total
      },
      paymentInstructions: {
        method: 'Bank Transfer',
        payee: '876NURSES',
        bank: 'NCB Saving',
        accountNumber: 'JMD354756226 / USD354756234',
        branch: 'Knutsford Branch',
        swiftCode: 'JNCBXX'
      },
      isRecurring: client.hasRecurringAppointments,
      paymentMethod: client.paymentMethod
    };
  };

  const handleViewInvoice = async (client) => {
    
    // Close the client details modal before navigating
    setClientDetailsModalVisible(false);
    closeNotePhotoPreview();
    
    try {
      // First, try to fetch existing invoice for this client from InvoiceService
      const allInvoices = await InvoiceService.getAllInvoices();
      
      // Find most recent invoice for this client
      const clientInvoices = allInvoices.filter(inv => 
        inv.clientName === client.name || 
        inv.clientEmail === client.email ||
        inv.clientId === client.id
      );
      
      if (clientInvoices.length > 0) {
        // Sort by creation date and get most recent
        const sortedInvoices = clientInvoices.sort((a, b) => {
          const dateA = new Date(a.createdAt || a.issueDate);
          const dateB = new Date(b.createdAt || b.issueDate);
          return dateB - dateA; // Most recent first
        });
        const mostRecentInvoice = sortedInvoices[0];
        
        // Navigate to invoice display - modal already closed
        navigation.navigate('InvoiceDisplay', {
          invoiceData: mostRecentInvoice,
          clientName: client.name
        });
        return;
      }
      
      // If no existing invoice, generate new one
      const completedAppointments = client.medicalNotes || [];

      if (completedAppointments.length === 0) {
        // If no completed appointments, create a sample invoice
        const result = await InvoiceService.createSampleInvoice();
        
        if (result.success) {
          // Modal already closed - just navigate
          navigation.navigate('InvoiceDisplay', {
            invoiceData: result.invoice,
            clientName: client.name
          });
        } else {
          Alert.alert('Error', result.error || 'Failed to generate sample invoice');
        }
        return;
      }

      // Get the most recent completed appointment or create invoice for recent period
      const recentAppointments = completedAppointments.slice(-3); // Last 3 appointments for billing period
      
      // Create comprehensive appointment data for invoice
      const appointmentData = {
        id: recentAppointments[recentAppointments.length - 1]?.id || `appointment-${client.id}-${Date.now()}`,
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email,
        clientPhone: client.phone,
        clientAddress: client.address || '6 Reece Road, Kingston 10',
        serviceName: client.serviceType,
        serviceType: client.serviceType,
        // Use most recent appointment details
        appointmentDate: recentAppointments[recentAppointments.length - 1]?.date || new Date().toISOString().split('T')[0],
        appointmentTime: '10:00 AM',
        status: 'completed',
        notes: recentAppointments[recentAppointments.length - 1]?.notes || 'Professional nursing services provided',
        duration: '45 mins',
        nurseId: recentAppointments[recentAppointments.length - 1]?.nurseId || 'NURSE001',
        nurseName: recentAppointments[recentAppointments.length - 1]?.nurseName || 'Care Professional',
        // Include all recent appointments for billing
        billingPeriodAppointments: recentAppointments.map(note => ({
          date: note.date,
          serviceType: note.appointmentType,
          nurseId: note.nurseId,
          nurseName: note.nurseName,
          notes: note.notes,
          duration: '45 mins'
        })),
        paymentMethod: client.paymentMethod,
        isRecurring: client.hasRecurringAppointments,
        totalSessions: recentAppointments.length
      };

      const result = await InvoiceService.createInvoice(appointmentData);
      
      if (result.success) {
        
        // Modal already closed - just navigate
        navigation.navigate('InvoiceDisplay', {
          invoiceData: result.invoice,
          clientName: client.name
        });
      } else {
        Alert.alert('Error', result.error || 'Failed to generate invoice');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to generate invoice');
    }
  };

  const handleSendInvoice = async (client) => {
    
    try {
      // Generate real appointment data from client's completed sessions (same as view invoice)
      const completedAppointments = client.medicalNotes || [];

      if (completedAppointments.length === 0) {
        Alert.alert('No Completed Services', 'This client has no completed appointments to generate an invoice for.');
        return;
      }

      // Get the most recent completed appointment or create invoice for recent period
      const recentAppointments = completedAppointments.slice(-3); // Last 3 appointments for billing period
      
      // Create comprehensive appointment data for invoice (same structure as view)
      const appointmentData = {
        id: recentAppointments[recentAppointments.length - 1]?.id || `appointment-${client.id}-${Date.now()}`,
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email,
        clientPhone: client.phone,
        clientAddress: client.address || '6 Reece Road, Kingston 10',
        serviceName: client.serviceType,
        serviceType: client.serviceType,
        appointmentDate: recentAppointments[recentAppointments.length - 1]?.date || new Date().toISOString().split('T')[0],
        appointmentTime: '10:00 AM',
        status: 'completed',
        notes: recentAppointments[recentAppointments.length - 1]?.notes || 'Professional nursing services provided',
        duration: '45 mins',
        nurseId: recentAppointments[recentAppointments.length - 1]?.nurseId || 'NURSE001',
        nurseName: recentAppointments[recentAppointments.length - 1]?.nurseName || 'Care Professional',
        billingPeriodAppointments: recentAppointments.map(note => ({
          date: note.date,
          serviceType: note.appointmentType,
          nurseId: note.nurseId,
          nurseName: note.nurseName,
          notes: note.notes,
          duration: '45 mins'
        })),
        paymentMethod: client.paymentMethod,
        isRecurring: client.hasRecurringAppointments,
        totalSessions: recentAppointments.length
      };

      // Generate invoice using same service as invoice management screen
      const result = await InvoiceService.generateInvoiceFromCompletedAppointment(appointmentData);
      
      if (result.success) {
        const invoice = result.invoice;
        
        const message = client.hasRecurringAppointments 
          ? `Auto-generated invoice for recurring ${client.serviceType} services`
          : `Invoice for completed ${client.serviceType} services`;

        Alert.alert(
          'Send Invoice',
          `${message}\n\nTo: ${client.email}\nInvoice #: ${invoice.invoiceId}\nAmount: $${invoice.total}\n${client.hasRecurringAppointments ? '🔄 Recurring billing active' : ''}`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Send Email', 
              onPress: async () => {
                try {
                  // Use the same email functionality as invoice management
                  await InvoiceService.shareInvoice(invoice);
                  Alert.alert(
                    'Success', 
                    `Invoice #${invoice.invoiceId} sent to ${client.email}\n` +
                    `${client.hasRecurringAppointments ? 'Next invoice will be auto-generated for recurring services.' : ''}`
                  );
                } catch (emailError) {
                  Alert.alert('Error', 'Failed to send invoice email');
                }
              }
            }
          ]
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to generate invoice');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to generate invoice for emailing');
    }
  };

  // Auto-generate invoices for recurring patients (would run on a schedule in real app)
  const processRecurringInvoices = () => {
    const recurringClients = clients.filter(client => client.hasRecurringAppointments);
    
    Alert.alert(
      'Process Recurring Invoices',
      `Found ${recurringClients.length} recurring patients. Generate invoices for all?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate All',
          onPress: () => {
            recurringClients.forEach(client => {
              const invoiceData = generateInvoiceData(client);
            });
            
            Alert.alert(
              'Batch Processing Complete',
              `Generated ${recurringClients.length} invoices for recurring patients.\nAll invoices have been automatically sent.`
            );
          }
        }
      ]
    );
  };

  const confirmDelete = () => {
    // In real app, this would delete from database
    setDeleteModalVisible(false);
    setClientToDelete(null);
    Alert.alert('Success', `${clientToDelete?.name} has been removed from your clients.`);
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

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {!isEmbedded && (
        <LinearGradient
          colors={GRADIENTS.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.header, { paddingTop: insets.top + 20 }]}
        >
          <View style={styles.headerRow}>
            <TouchableWeb
              style={styles.iconButton}
              onPress={() => {}}
            >
              <MaterialCommunityIcons name="magnify" size={24} color="#fff" />
            </TouchableWeb>
            
            <Text style={styles.welcomeText}>Client Management</Text>
          </View>
        </LinearGradient>
      )}

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      <View style={styles.content}>
        <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {displayedClients.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="account-group" size={80} color={COLORS.border} />
              <Text style={styles.emptyText}>
                {normalizedSearchQuery ? 'No matching clients found' : 'Subscribed clients will appear here'}
              </Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {displayedClients.map((client, index) => {
                const photoUri = client.profilePhoto || client.profileImage || client.photoUrl || client.avatar || client.photo || client.imageUrl || client.photoURL;
                
                return (
                  <View key={client.id || `client-${index}`} style={styles.compactCard}>
                    <View style={styles.compactHeader}>
                      {photoUri ? (
                        <Image 
                          source={{ uri: photoUri }} 
                          style={styles.clientProfilePhoto}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.clientProfilePhotoPlaceholder}>
                          <MaterialCommunityIcons name="account" size={20} color={COLORS.white} />
                        </View>
                      )}
                    <View style={styles.compactInfo}>
                      <View style={styles.clientNameRow}>
                        <Text style={styles.compactClient}>{client.name}</Text>
                        {client.hasRecurringAppointments && (
                          <MaterialCommunityIcons 
                            name="recycle" 
                            size={14} 
                            color="#4CAF50" 
                            style={{ marginLeft: 6 }}
                          />
                        )}
                      </View>
                    </View>
                    <TouchableWeb
                      style={styles.detailsButton}
                      onPress={() => handleShowClientDetails(client)}
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
          <View style={styles.bottomPadding} />
        </ScrollView>
      </View>

      {/* Add Client Modal */}
      <Modal
        visible={isAddClientModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsAddClientModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Client</Text>
              <TouchableWeb
                style={styles.closeButton}
                onPress={() => setIsAddClientModalVisible(false)}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter client's full name"
                  value={clientForm.name}
                  onChangeText={(text) => setClientForm({ ...clientForm, name: text })}
                  placeholderTextColor={COLORS.textLight}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Email Address *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter email address"
                  value={clientForm.email}
                  onChangeText={(text) => setClientForm({ ...clientForm, email: text })}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={COLORS.textLight}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter phone number"
                  value={clientForm.phone}
                  onChangeText={(text) => setClientForm({ ...clientForm, phone: text })}
                  keyboardType="phone-pad"
                  placeholderTextColor={COLORS.textLight}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Service Type</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Physical Therapy, Home Care"
                  value={clientForm.serviceType}
                  onChangeText={(text) => setClientForm({ ...clientForm, serviceType: text })}
                  placeholderTextColor={COLORS.textLight}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Payment Method</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Insurance, Private Pay, Medicare"
                  value={clientForm.paymentMethod}
                  onChangeText={(text) => setClientForm({ ...clientForm, paymentMethod: text })}
                  placeholderTextColor={COLORS.textLight}
                />
              </View>

              <TouchableWeb
                style={styles.submitButton}
                onPress={handleAddClient}
              >
                <LinearGradient
                  colors={GRADIENTS.header}
                  style={styles.submitButtonGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                >
                  <MaterialCommunityIcons name="account-plus" size={20} color="#fff" />
                  <Text style={styles.submitButtonText}>Add Client</Text>
                </LinearGradient>
              </TouchableWeb>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={deleteModalVisible}
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModal}>
            <MaterialCommunityIcons name="alert-circle" size={48} color={COLORS.error} />
            <Text style={styles.deleteTitle}>Remove Client</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to remove {clientToDelete?.name} from your clients? This action cannot be undone.
            </Text>
            <View style={styles.deleteActions}>
              <TouchableWeb 
                style={styles.cancelButton}
                onPress={() => setDeleteModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableWeb>
              <TouchableWeb 
                style={styles.confirmButton}
                onPress={confirmDelete}
              >
                <Text style={styles.confirmButtonText}>Remove</Text>
              </TouchableWeb>
            </View>
          </View>
        </View>
      </Modal>

      {/* Client Details Modal */}
      <Modal
        visible={clientDetailsModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setClientDetailsModalVisible(false);
          closeNotePhotoPreview();
          closeMedicalNotesReportModal();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Client Details</Text>
              <TouchableWeb
                style={styles.closeButton}
                onPress={() => {
                  setClientDetailsModalVisible(false);
                  closeNotePhotoPreview();
                  closeMedicalNotesReportModal();
                }}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            {notePhotoPreviewVisible && notePhotoPreviewUri ? (
              <View style={styles.notePhotoPreviewOverlayInModal}>
                <TouchableOpacity
                  style={styles.notePhotoPreviewOverlayTapArea}
                  activeOpacity={1}
                  onPress={closeNotePhotoPreview}
                >
                  <TouchableOpacity
                    activeOpacity={1}
                    style={styles.notePhotoPreviewImageFrame}
                    onPress={() => {}}
                  >
                    <Image
                      source={{ uri: notePhotoPreviewUri }}
                      style={styles.notePhotoPreviewImage}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              </View>
            ) : null}

            {medicalNotesReportModalVisible ? (
              <View style={styles.medicalNotesReportOverlayInModal}>
                <TouchableOpacity
                  style={styles.medicalNotesReportOverlayTapArea}
                  activeOpacity={1}
                  onPress={() => {
                    Keyboard.dismiss();
                    closeMedicalNotesReportModal();
                  }}
                >
                  <KeyboardAvoidingView
                    style={styles.medicalNotesReportKav}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
                  >
                    <TouchableOpacity
                      activeOpacity={1}
                      style={[styles.medicalNotesReportModal, { height: medicalNotesReportModalHeight }]}
                      onPress={() => Keyboard.dismiss()}
                    >
                      <View style={styles.medicalNotesReportContent}>
                        <ScrollView
                          style={styles.medicalNotesReportScroll}
                          showsVerticalScrollIndicator={false}
                          keyboardShouldPersistTaps="handled"
                          contentContainerStyle={styles.medicalNotesReportScrollContent}
                        >
                          <Text style={styles.medicalNotesReportTitle}>Email Medical Notes Report</Text>
                          <Text style={styles.medicalNotesReportSubtitle}>
                            Enter the recipient email address.
                          </Text>

                          <View style={styles.medicalNotesReportPeriodRow}>
                            <TouchableWeb
                              style={styles.medicalNotesReportPeriodPill}
                              onPress={() => setMedicalNotesReportPeriod('all')}
                              activeOpacity={0.85}
                            >
                              {medicalNotesReportPeriod === 'all' ? (
                                <LinearGradient
                                  colors={GRADIENTS.header}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 0, y: 1 }}
                                  style={styles.medicalNotesReportPeriodPillGradient}
                                >
                                  <Text style={styles.medicalNotesReportPeriodPillTextActive}>All</Text>
                                </LinearGradient>
                              ) : (
                                <View style={styles.medicalNotesReportPeriodPillInner}>
                                  <Text style={styles.medicalNotesReportPeriodPillText}>All</Text>
                                </View>
                              )}
                            </TouchableWeb>

                            <TouchableWeb
                              style={styles.medicalNotesReportPeriodPill}
                              onPress={() => setMedicalNotesReportPeriod('7d')}
                              activeOpacity={0.85}
                            >
                              {medicalNotesReportPeriod === '7d' ? (
                                <LinearGradient
                                  colors={GRADIENTS.header}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 0, y: 1 }}
                                  style={styles.medicalNotesReportPeriodPillGradient}
                                >
                                  <Text style={styles.medicalNotesReportPeriodPillTextActive}>7d</Text>
                                </LinearGradient>
                              ) : (
                                <View style={styles.medicalNotesReportPeriodPillInner}>
                                  <Text style={styles.medicalNotesReportPeriodPillText}>7d</Text>
                                </View>
                              )}
                            </TouchableWeb>

                            <TouchableWeb
                              style={styles.medicalNotesReportPeriodPill}
                              onPress={() => setMedicalNotesReportPeriod('30d')}
                              activeOpacity={0.85}
                            >
                              {medicalNotesReportPeriod === '30d' ? (
                                <LinearGradient
                                  colors={GRADIENTS.header}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 0, y: 1 }}
                                  style={styles.medicalNotesReportPeriodPillGradient}
                                >
                                  <Text style={styles.medicalNotesReportPeriodPillTextActive}>30d</Text>
                                </LinearGradient>
                              ) : (
                                <View style={styles.medicalNotesReportPeriodPillInner}>
                                  <Text style={styles.medicalNotesReportPeriodPillText}>30d</Text>
                                </View>
                              )}
                            </TouchableWeb>

                            <TouchableWeb
                              style={styles.medicalNotesReportPeriodPill}
                              onPress={() => setMedicalNotesReportPeriod('custom')}
                              activeOpacity={0.85}
                            >
                              {medicalNotesReportPeriod === 'custom' ? (
                                <LinearGradient
                                  colors={GRADIENTS.header}
                                  start={{ x: 0, y: 0 }}
                                  end={{ x: 0, y: 1 }}
                                  style={styles.medicalNotesReportPeriodPillGradient}
                                >
                                  <Text style={styles.medicalNotesReportPeriodPillTextActive}>Custom</Text>
                                </LinearGradient>
                              ) : (
                                <View style={styles.medicalNotesReportPeriodPillInner}>
                                  <Text style={styles.medicalNotesReportPeriodPillText}>Custom</Text>
                                </View>
                              )}
                            </TouchableWeb>
                          </View>

                          {medicalNotesReportPeriod === 'custom' ? (
                            <View style={styles.medicalNotesReportRangeColumns}>
                              <View style={styles.medicalNotesReportRangeColumn}>
                                <Text style={styles.medicalNotesReportRangeLabel}>From</Text>
                                <TouchableWeb
                                  style={styles.medicalNotesReportRangeButton}
                                  onPress={() => setMedicalNotesReportShowFromPicker(true)}
                                  activeOpacity={0.85}
                                >
                                  <Text style={styles.medicalNotesReportRangeButtonText}>
                                    {medicalNotesReportFromDate
                                      ? formatReportDateOnly(medicalNotesReportFromDate)
                                      : 'Select date'}
                                  </Text>
                                </TouchableWeb>
                              </View>

                              <View style={styles.medicalNotesReportRangeColumn}>
                                <Text style={styles.medicalNotesReportRangeLabel}>To</Text>
                                <TouchableWeb
                                  style={styles.medicalNotesReportRangeButton}
                                  onPress={() => setMedicalNotesReportShowToPicker(true)}
                                  activeOpacity={0.85}
                                >
                                  <Text style={styles.medicalNotesReportRangeButtonText}>
                                    {medicalNotesReportToDate
                                      ? formatReportDateOnly(medicalNotesReportToDate)
                                      : 'Select date'}
                                  </Text>
                                </TouchableWeb>
                              </View>
                            </View>
                          ) : null}

                          <TextInput
                            style={[styles.input, styles.medicalNotesReportEmailInput]}
                            placeholder="Recipient email"
                            value={medicalNotesReportEmail}
                            onChangeText={setMedicalNotesReportEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            placeholderTextColor={COLORS.textLight}
                            returnKeyType="done"
                            onSubmitEditing={() => Keyboard.dismiss()}
                          />

                          <Text style={styles.medicalNotesReportHint}>
                            Notes included: {getMedicalNotesReportItemsForPeriod(medicalNotesReportItems).length}
                          </Text>
                        </ScrollView>

                        <View style={styles.medicalNotesReportFooter}>
                          <View style={styles.medicalNotesReportActions}>
                            <TouchableWeb
                              style={styles.cancelButton}
                              onPress={closeMedicalNotesReportModal}
                              activeOpacity={0.8}
                              disabled={medicalNotesReportSending}
                            >
                              <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableWeb>

                            <TouchableWeb
                              style={styles.medicalNotesReportSendButton}
                              onPress={sendMedicalNotesReport}
                              activeOpacity={0.8}
                              disabled={medicalNotesReportSending}
                            >
                              <LinearGradient
                                colors={GRADIENTS.header}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.medicalNotesReportSendButtonGradient}
                              >
                                {medicalNotesReportSending ? (
                                  <ActivityIndicator color={COLORS.white} />
                                ) : (
                                  <Text style={styles.medicalNotesReportSendButtonText}>Send</Text>
                                )}
                              </LinearGradient>
                            </TouchableWeb>
                          </View>
                        </View>
                      </View>

                      {/* Android pickers (native modal) */}
                      {medicalNotesReportShowFromPicker && Platform.OS === 'android' ? (
                        <DateTimePicker
                          value={medicalNotesReportFromDate || new Date()}
                          mode="date"
                          display="default"
                          onChange={(event, date) => {
                            setMedicalNotesReportShowFromPicker(false);
                            if (event?.type === 'dismissed') return;
                            if (date) setMedicalNotesReportFromDate(date);
                          }}
                        />
                      ) : null}

                      {medicalNotesReportShowToPicker && Platform.OS === 'android' ? (
                        <DateTimePicker
                          value={medicalNotesReportToDate || new Date()}
                          mode="date"
                          display="default"
                          onChange={(event, date) => {
                            setMedicalNotesReportShowToPicker(false);
                            if (event?.type === 'dismissed') return;
                            if (date) setMedicalNotesReportToDate(date);
                          }}
                        />
                      ) : null}

                      {/* iOS pickers styled like other screens */}
                      {medicalNotesReportShowFromPicker && Platform.OS === 'ios' ? (
                        <View style={styles.medicalNotesReportPickerOverlay}>
                          <View style={styles.medicalNotesReportPickerContainer}>
                            <View style={styles.medicalNotesReportPickerHeader}>
                              <Text style={styles.medicalNotesReportPickerTitle}>Select From Date</Text>
                              <TouchableWeb
                                onPress={() => setMedicalNotesReportShowFromPicker(false)}
                                style={styles.medicalNotesReportPickerCloseButton}
                              >
                                <MaterialCommunityIcons name="close" size={22} color={COLORS.text} />
                              </TouchableWeb>
                            </View>
                            <DateTimePicker
                              value={medicalNotesReportFromDate || new Date()}
                              mode="date"
                              display="spinner"
                              onChange={(event, date) => {
                                if (event?.type === 'dismissed') return;
                                if (date) setMedicalNotesReportFromDate(date);
                              }}
                              textColor={COLORS.text}
                            />
                            <TouchableWeb
                              style={styles.medicalNotesReportPickerConfirmButton}
                              onPress={() => setMedicalNotesReportShowFromPicker(false)}
                            >
                              <LinearGradient
                                colors={GRADIENTS.header}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.medicalNotesReportPickerConfirmGradient}
                              >
                                <Text style={styles.medicalNotesReportPickerConfirmText}>Done</Text>
                              </LinearGradient>
                            </TouchableWeb>
                          </View>
                        </View>
                      ) : null}

                      {medicalNotesReportShowToPicker && Platform.OS === 'ios' ? (
                        <View style={styles.medicalNotesReportPickerOverlay}>
                          <View style={styles.medicalNotesReportPickerContainer}>
                            <View style={styles.medicalNotesReportPickerHeader}>
                              <Text style={styles.medicalNotesReportPickerTitle}>Select To Date</Text>
                              <TouchableWeb
                                onPress={() => setMedicalNotesReportShowToPicker(false)}
                                style={styles.medicalNotesReportPickerCloseButton}
                              >
                                <MaterialCommunityIcons name="close" size={22} color={COLORS.text} />
                              </TouchableWeb>
                            </View>
                            <DateTimePicker
                              value={medicalNotesReportToDate || new Date()}
                              mode="date"
                              display="spinner"
                              onChange={(event, date) => {
                                if (event?.type === 'dismissed') return;
                                if (date) setMedicalNotesReportToDate(date);
                              }}
                              textColor={COLORS.text}
                            />
                            <TouchableWeb
                              style={styles.medicalNotesReportPickerConfirmButton}
                              onPress={() => setMedicalNotesReportShowToPicker(false)}
                            >
                              <LinearGradient
                                colors={GRADIENTS.header}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.medicalNotesReportPickerConfirmGradient}
                              >
                                <Text style={styles.medicalNotesReportPickerConfirmText}>Done</Text>
                              </LinearGradient>
                            </TouchableWeb>
                          </View>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  </KeyboardAvoidingView>
                </TouchableOpacity>
              </View>
            ) : null}

            <ScrollView style={styles.detailsModalContent} showsVerticalScrollIndicator={false}>
              {selectedClient && (
                <>
                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Client Information</Text>
                    <View style={styles.detailItem}>
                      <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>Name</Text>
                        <Text style={styles.detailValue}>{selectedClient.name}</Text>
                      </View>
                    </View>
                    <View style={styles.detailItem}>
                      <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>Email</Text>
                        <Text style={styles.detailValue}>
                          {selectedClient.email && selectedClient.email !== 'No email provided' && selectedClient.email !== 'N/A' 
                            ? selectedClient.email 
                            : 'Not provided'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.detailItem}>
                      <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>Phone</Text>
                        <Text style={styles.detailValue}>
                          {selectedClient.phone && selectedClient.phone !== 'No phone provided' && selectedClient.phone !== 'N/A' 
                            ? selectedClient.phone 
                            : 'Not provided'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.detailItem}>
                      <MaterialCommunityIcons name="map-marker" size={20} color={COLORS.primary} />
                      <View style={styles.detailContent}>
                        <Text style={styles.detailLabel}>Address</Text>
                        <Text style={styles.detailValue}>{selectedClient.address || 'Not provided'}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailsSection}>
                    <View style={styles.invoiceSection}>
                      <View style={styles.invoiceHeaderRow}>
                        <Text style={styles.invoiceLabel}>Recent Invoices</Text>
                        {selectedClient?.invoiceHistory && selectedClient.invoiceHistory.length > 3 ? (
                          <TouchableWeb
                            onPress={() => setRecentInvoicesExpanded((prev) => !prev)}
                            style={styles.invoiceDropdownToggle}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.viewAllText}>
                              {recentInvoicesExpanded ? 'Hide' : 'Show All'}
                            </Text>
                            <MaterialCommunityIcons
                              name={recentInvoicesExpanded ? 'chevron-up' : 'chevron-down'}
                              size={18}
                              color={COLORS.primary}
                            />
                          </TouchableWeb>
                        ) : null}
                      </View>
                      
                      {/* Invoice History */}
                      <View style={styles.invoiceHistorySection}>
                        {selectedClient.invoiceHistory && selectedClient.invoiceHistory.length > 0 ? (
                          (selectedClient.invoiceHistory.length > 3
                            ? (recentInvoicesExpanded ? selectedClient.invoiceHistory : selectedClient.invoiceHistory.slice(0, 3))
                            : selectedClient.invoiceHistory.slice(0, 3)
                          ).map((invoice, index) => {
                            const statusStyles = getInvoiceStatusStyles(invoice.status);
                            return (
                              <View key={invoice.id || `invoice-${index}`} style={styles.invoiceItemContainer}>
                                <TouchableWeb
                                  style={styles.invoiceCard}
                                  onPress={() => {
                                    setClientDetailsModalVisible(false);
                                    closeNotePhotoPreview();
                                    setTimeout(() => {
                                      navigation.navigate('InvoiceDisplay', {
                                        invoiceData: invoice.invoiceRecord,
                                        clientName: selectedClient.name,
                                        clientPhone: selectedClient.phone,
                                        returnToClientModal: true,
                                        clientId: selectedClient.id
                                      });
                                    }, 300);
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.invoiceCardHeader}>
                                    <View style={styles.invoiceCardLeft}>
                                      <View style={styles.invoiceCardInfo}>
                                        <Text style={styles.invoiceCardNumber}>
                                          {String(invoice.id || '').replace('CARE-INV', 'NUR-INV')}
                                        </Text>
                                      </View>
                                    </View>
                                    <View style={styles.invoiceCardRight}>
                                      {invoice.status?.toLowerCase() === 'pending' ? (
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
                                      ) : invoice.status?.toLowerCase() === 'paid' ? (
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
                                      ) : invoice.status?.toLowerCase() === 'overdue' ? (
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
                                          { backgroundColor: statusStyles.backgroundColor }
                                        ]}>
                                          <Text style={[
                                            styles.invoiceCardStatusText,
                                            { color: statusStyles.textColor }
                                          ]}>
                                            {invoice.status}
                                          </Text>
                                        </View>
                                      )}
                                    </View>
                                  </View>
                                </TouchableWeb>
                              </View>
                            );
                          })
                        ) : (
                          <View style={styles.noInvoicesContainer}>
                            <MaterialCommunityIcons name="file-document-outline" size={40} color={COLORS.border} />
                            <Text style={styles.noInvoicesText}>No invoices generated yet</Text>
                            <Text style={styles.noInvoicesSubText}>Tap to generate and view invoice</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailsSection}>
                    <Text style={styles.sectionTitle}>Appointments</Text>
                    <View style={styles.appointmentStats}>
                      <TouchableWeb style={styles.statPill} activeOpacity={0.7}>
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.statPillGradient}
                        >
                          <Text style={styles.statPillNumber}>{selectedClient.appointments.upcoming}</Text>
                          <Text style={styles.statPillLabel}>Upcoming</Text>
                        </LinearGradient>
                      </TouchableWeb>
                      <TouchableWeb style={styles.statPill} activeOpacity={0.7}>
                        <LinearGradient
                          colors={GRADIENTS.header}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={styles.statPillGradient}
                        >
                          <Text style={styles.statPillNumber}>{selectedClient.appointments.completed}</Text>
                          <Text style={styles.statPillLabel}>Completed</Text>
                        </LinearGradient>
                      </TouchableWeb>
                    </View>
                  </View>

                  <View style={styles.detailsSection}>
                    {(() => {
                      const nurseNoteItems = (selectedClient.medicalNotes || []).map((note, index) => ({
                        id: note?.id || `nurse-note-${index}`,
                        date: note?.date || null,
                        title: note?.nurseName || 'Assigned Nurse',
                        subtitle: note?.appointmentType || '',
                        body: note?.notes || '',
                        photoUrls: Array.isArray(note?.photoUrls) ? note.photoUrls : [],
                      }));

                      const patientNoteItems = (selectedClient.completedAppointments || []).map((apt, index) => {
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
                          apt?.patientNotes,
                          apt?.patientNote,
                          apt?.bookingNotes,
                          apt?.bookingNote,
                          apt?.clientNotes,
                          apt?.specialInstructions,
                          apt?.instructions,
                          apt?.patient?.notes,
                          apt?.patient?.patientNotes,
                          apt?.client?.notes,
                          apt?.client?.patientNotes,
                          apt?.clientSnapshot?.notes,
                          apt?.clientSnapshot?.patientNotes,
                          apt?.patientSnapshot?.notes,
                          apt?.patientSnapshot?.patientNotes,
                          apt?.clientData?.notes,
                          apt?.clientData?.patientNotes,
                          apt?.patientData?.notes,
                          apt?.patientData?.patientNotes,
                        ]);

                        const legacyNotes = pickFirstNonEmptyText([apt?.notes]);
                        const nurseNotesText = pickFirstNonEmptyText([
                          apt?.nurseNotes,
                          apt?.completionNotes,
                          apt?.lastCompletionNotes,
                        ]);

                        // If legacy `notes` is actually the same as the nurse note, treat it as nurse-side and don't show it under Patient Notes.
                        const legacyLooksLikeNurseNotes =
                          Boolean(legacyNotes && nurseNotesText) && legacyNotes === nurseNotesText;

                        const text = patientBookingNotesText || (legacyLooksLikeNurseNotes ? '' : legacyNotes);

                        if (!text) return null;

                        return {
                          id: `patient-note-${apt?.id || apt?._id || apt?.appointmentId || index}`,
                          date: apt?.createdAt || apt?.updatedAt || apt?.date || apt?.scheduledDate || null,
                          title: apt?.patientName || apt?.clientName || selectedClient.name || 'Patient',
                          subtitle: apt?.service || apt?.appointmentType || 'From booking',
                          body: text,
                        };
                      }).filter(Boolean);

                      // De-duplicate any patient notes that are effectively the same as a nurse note
                      const dedupedPatientNotes = patientNoteItems.filter((pItem) => {
                        const pBody = (pItem.body || '').trim();
                        if (!pBody) return true;

                        return !nurseNoteItems.some((nItem) => {
                          const nBody = (nItem.body || '').trim();
                          if (!nBody) return false;
                          if (nBody !== pBody) return false;

                          const sameDate =
                            nItem.date && pItem.date && String(nItem.date) === String(pItem.date);

                          const normalizeIdRoot = (id) => {
                            if (!id) return '';
                            return String(id)
                              .replace(/^nurse-note-/, '')
                              .replace(/^patient-note-/, '')
                              .trim();
                          };

                          const sameRoot =
                            normalizeIdRoot(nItem.id) &&
                            normalizeIdRoot(nItem.id) === normalizeIdRoot(pItem.id);

                          return sameDate || sameRoot;
                        });
                      });

                      const toEpochMs = (value) => {
                        if (!value) return 0;

                        if (value instanceof Date) {
                          return Number.isNaN(value.getTime()) ? 0 : value.getTime();
                        }

                        if (typeof value === 'object') {
                          if (typeof value.toDate === 'function') {
                            const d = value.toDate();
                            return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
                          }

                          const seconds =
                            typeof value.seconds === 'number'
                              ? value.seconds
                              : typeof value._seconds === 'number'
                                ? value._seconds
                                : null;
                          if (typeof seconds === 'number' && Number.isFinite(seconds)) {
                            return seconds * 1000;
                          }
                        }

                        if (typeof value === 'number' && Number.isFinite(value)) {
                          return value < 1e12 ? value * 1000 : value;
                        }

                        if (typeof value === 'string') {
                          const trimmed = value.trim();
                          if (!trimmed) return 0;
                          const asNumber = Number(trimmed);
                          if (Number.isFinite(asNumber)) {
                            return asNumber < 1e12 ? asNumber * 1000 : asNumber;
                          }
                          const parsed = Date.parse(trimmed);
                          return Number.isFinite(parsed) ? parsed : 0;
                        }

                        const parsed = Date.parse(String(value));
                        return Number.isFinite(parsed) ? parsed : 0;
                      };

                      const allNoteItems = [...nurseNoteItems, ...dedupedPatientNotes].sort((a, b) => {
                        const aTime = toEpochMs(a?.date);
                        const bTime = toEpochMs(b?.date);
                        return bTime - aTime;
                      });

                      return (
                        <>
                          <View style={styles.medicalNotesHeaderRow}>
                            <Text style={[styles.sectionTitle, styles.medicalNotesHeaderTitle]}>
                              Medical Notes ({allNoteItems.length})
                            </Text>
                          </View>
                          <NotesAccordionList
                            items={allNoteItems}
                            emptyText="No medical notes available yet"
                            onPhotoPress={openNotePhotoPreview}
                          />
                          {allNoteItems.length === 0 && (
                      <View style={styles.noNotesContainer}>
                        <MaterialCommunityIcons name="note-outline" size={24} color={COLORS.textLight} />
                        <Text style={styles.noNotesText}>No medical notes available yet</Text>
                      </View>
                          )}
                        </>
                      );
                    })()}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Full Invoice Modal */}
      <Modal
        visible={fullInvoiceModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setFullInvoiceModalVisible(false)}
      >
        <SafeAreaView style={styles.invoiceModalContainer} edges={['top', 'bottom']}>
          <View style={styles.invoiceModalHeader}>
            <Text style={styles.invoiceModalTitle}>Invoice Preview</Text>
            <TouchableWeb
              onPress={() => setFullInvoiceModalVisible(false)}
              style={styles.invoiceCloseButton}
            >
              <MaterialCommunityIcons name="close" size={24} color={COLORS.white} />
            </TouchableWeb>
          </View>

          <ScrollView style={styles.invoiceScrollView} showsVerticalScrollIndicator={false}>
            {currentInvoiceData && (
              <View style={styles.invoicePreviewCard}>
                {/* Invoice Header */}
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
                      <Text style={styles.pdfInvoiceNumber}>{currentInvoiceData.invoiceId?.replace('CARE-INV', 'NUR-INV')}</Text>
                      <Text style={styles.pdfInvoiceDate}>Issue Date: {InvoiceService.formatDateForInvoice(currentInvoiceData.issueDate)}</Text>
                      <Text style={styles.pdfInvoiceDate}>Due Date: {InvoiceService.formatDateForInvoice(currentInvoiceData.dueDate)}</Text>
                    </View>
                  </View>
                  <View style={styles.pdfBlueLine} />
                </View>

                {/* Bill To and Service Provider */}
                <View style={styles.pdfClientSection}>
                  <View style={styles.pdfClientRow}>
                    <View style={styles.pdfBillTo}>
                      <Text style={styles.pdfSectionTitle}>BILL TO:</Text>
                      <Text style={styles.pdfClientName}>{currentInvoiceData.clientName}</Text>
                      <Text style={styles.pdfClientInfo}>{currentInvoiceData.clientEmail}</Text>
                      <Text style={styles.pdfClientInfo}>{selectedClient?.phone || currentInvoiceData.clientPhone || 'N/A'}</Text>
                      <Text style={styles.pdfClientInfo}>{currentInvoiceData.clientAddress || '123 Main Street, Anytown, State 12345'}</Text>
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

                {/* Service Table */}
                <View style={styles.pdfServiceSection}>
                  <View style={styles.pdfTable}>
                    <View style={styles.pdfTableHeader}>
                      <Text style={[styles.pdfTableHeaderText, { flex: 2 }]}>Service Description</Text>
                      <Text style={styles.pdfTableHeaderText}>Date</Text>
                      <Text style={styles.pdfTableHeaderText}>Hours</Text>
                      <Text style={styles.pdfTableHeaderText}>Rate</Text>
                      <Text style={styles.pdfTableHeaderText}>Amount</Text>
                    </View>
                    <View style={styles.pdfTableRow}>
                      <Text style={[styles.pdfTableCell, { flex: 2 }]}>{currentInvoiceData.service}</Text>
                      <Text style={styles.pdfTableCell}>{InvoiceService.formatDateForInvoice(currentInvoiceData.date)}</Text>
                      <Text style={styles.pdfTableCell}>{currentInvoiceData.hours}</Text>
                      <Text style={styles.pdfTableCell}>{InvoiceService.formatCurrency(currentInvoiceData.rate)}</Text>
                      <Text style={styles.pdfTableCellAmount}>{InvoiceService.formatCurrency(currentInvoiceData.total)}</Text>
                    </View>
                  </View>

                  {/* Bottom Section: Payment Info and Totals */}
                  <View style={styles.pdfBottomSection}>
                    <View style={styles.pdfPaymentSection}>
                      <Text style={styles.pdfPaymentTitle}>Payment Information</Text>
                      {paymentInfo.bankAccounts.map((account, index) => (
                        <View key={account.id || `account-${index}`} style={styles.bankAccountGroup}>
                          <Text style={styles.pdfPaymentInfo}>{account.bankName}</Text>
                          {account.payee && (
                            <Text style={styles.pdfPaymentInfo}>Payee: {account.payee}</Text>
                          )}
                          {account.branch && (
                            <Text style={styles.pdfPaymentInfo}>Branch: {account.branch}</Text>
                          )}
                          {account.accountNumbers.map((accNum, idx) => (
                            <Text key={accNum.id || `accNum-${idx}`} style={styles.pdfPaymentInfo}>
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

                    <View style={styles.pdfTotalsSection}>
                      <View style={styles.pdfTotalRow}>
                        <Text style={styles.pdfTotalLabel}>Deposit:</Text>
                        <Text style={styles.pdfTotalValue}>{InvoiceService.formatCurrency(currentInvoiceData.total)}</Text>
                      </View>
                      <View style={styles.pdfBlueLine} />
                      <View style={styles.pdfFinalTotalRow}>
                        <Text style={styles.pdfFinalTotalLabel}>Total Amount:</Text>
                        <Text style={styles.pdfFinalTotalAmount}>${currentInvoiceData.total}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
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
    justifyContent: 'space-between',
  },
  welcomeText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
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
    position: 'relative',
  },
  recurringInvoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  recurringInvoiceText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
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
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
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
  },
  listContainer: {
    padding: 20,
    gap: 8,
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
  profilePhoto: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.lightGray,
  },
  clientProfilePhoto: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    marginRight: 10,
  },
  clientProfilePhotoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  compactInfo: {
    flex: 1,
    marginLeft: 8,
  },
  clientNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  subscriberBadge: {
    backgroundColor: COLORS.accent,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  bottomPadding: {
    height: 20,
  },
  // Modal styles
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
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
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
  modalContent: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  submitButton: {
    marginTop: 8,
    marginBottom: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  submitButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Delete modal styles
  deleteModal: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    minWidth: 300,
  },
  deleteTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  deleteMessage: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  deleteActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: COLORS.error,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  cardFooter: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  detailButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 6,
  },
  detailButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  detailsModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    flexDirection: 'column',
    position: 'relative',
  },
  medicalNotesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  medicalNotesHeaderTitle: {
    flex: 1,
    marginBottom: 0,
  },
  medicalNotesReportOverlayInModal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 10000,
    elevation: 10000,
  },
  medicalNotesReportOverlayTapArea: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  medicalNotesReportKav: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalNotesReportModal: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    width: '100%',
    maxWidth: 380,
    minHeight: 340,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  medicalNotesReportContent: {
    flex: 1,
  },
  medicalNotesReportScroll: {
    flex: 1,
  },
  medicalNotesReportScrollContent: {
    paddingBottom: 16,
  },
  medicalNotesReportTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 6,
  },
  medicalNotesReportSubtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: 12,
  },
  medicalNotesReportPeriodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  medicalNotesReportPeriodPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  medicalNotesReportPeriodPillInner: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalNotesReportPeriodPillGradient: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalNotesReportPeriodPillText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  medicalNotesReportPeriodPillTextActive: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  medicalNotesReportRangeColumns: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  medicalNotesReportRangeColumn: {
    flex: 1,
    gap: 6,
  },
  medicalNotesReportRangeLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
  },
  medicalNotesReportRangeButton: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalNotesReportRangeButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  medicalNotesReportHint: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  medicalNotesReportEmailInput: {
    marginTop: 2,
  },
  medicalNotesReportFooter: {
    paddingTop: 12,
  },
  medicalNotesReportActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 0,
  },
  medicalNotesReportSendButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
  },
  medicalNotesReportSendButtonGradient: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalNotesReportSendButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },

  medicalNotesReportPickerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 20000,
    elevation: 20000,
  },
  medicalNotesReportPickerContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    width: '100%',
    maxWidth: 380,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  medicalNotesReportPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  medicalNotesReportPickerTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
  },
  medicalNotesReportPickerCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  medicalNotesReportPickerConfirmButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 10,
  },
  medicalNotesReportPickerConfirmGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalNotesReportPickerConfirmText: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
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
  detailsModalContent: {
    padding: 20,
  },
  clientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#FFE7CC',
    borderRadius: 12,
  },
  clientAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFD7B0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  clientAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    resizeMode: 'cover',
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  subscriberText: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
    marginLeft: 4,
  },
  detailsSection: {
    marginBottom: 32,
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
  appointmentStats: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statPill: {
    flex: 1,
    marginHorizontal: 1,
  },
  statPillGradient: {
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
  statPillNumber: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    marginBottom: 1,
  },
  statPillLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  notesText: {
    marginLeft: 16,
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 22,
    flex: 1,
  },
  noteItem: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  compactNoteItem: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  noteToggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: COLORS.lightGray,
  },
  noteMainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  compactNoteDate: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  compactNurseName: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.accent,
    marginLeft: 'auto',
  },
  expandedNoteContent: {
    padding: 12,
    paddingTop: 8,
    backgroundColor: COLORS.white,
  },
  noteTypeLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  expandedNoteText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 20,
  },
  // Billing section styles
  billingSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  billingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  billingTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  autoBillingInfo: {
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  autoBillingText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.success,
    marginBottom: 4,
  },
  autoBillingSubText: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  billingStats: {
    flexDirection: 'row',
    gap: 16,
  },
  billingStat: {
    flex: 1,
  },
  billingStatLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  billingStatValue: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
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
  invoiceActions: {
    gap: 8,
  },
  invoiceButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  invoiceButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  invoiceButtonText: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Invoice History Styles
  invoiceHistorySection: {
    marginTop: 15,
  },
  invoiceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  viewAllText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  invoiceDropdownToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  invoiceHistoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  invoiceHistoryActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewButtonSmall: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  viewButtonGradientSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 4,
  },
  viewButtonTextSmall: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
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
  },
  invoiceHistorySubInfo: {
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
  invoicePaidDate: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: '#4CAF50',
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
  noInvoicesContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 15,
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
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  noteDate: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  noteType: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    backgroundColor: COLORS.white,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 'auto',
  },
  nurseName: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.accent,
    marginBottom: 8,
  },
  noteContent: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 20,
  },
  noNotesContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
  },
  noNotesText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginTop: 8,
  },
  invoicePreviewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    margin: 16,
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
  // Invoice Card Styles (Synced with Patient Modal)
  invoiceItemContainer: {
    marginBottom: 16,
  },
  invoiceCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
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
  noNotesContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
  },
  noNotesText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginTop: 8,
  },
});