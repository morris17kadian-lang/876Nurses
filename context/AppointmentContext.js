import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { useNotifications } from './NotificationContext';
import { useNurses } from './NurseContext';
import InvoiceService from '../services/InvoiceService';
import ApiService from '../services/ApiService';
import { getNurseName, formatAddress } from '../utils/formatters';

const AppointmentContext = createContext();

export const useAppointments = () => {
  const context = useContext(AppointmentContext);
  if (!context) {
    throw new Error('useAppointments must be used within an AppointmentProvider');
  }
  return context;
};

export const AppointmentProvider = ({ children }) => {
  const { user } = useAuth();
  const { createAppointmentNotification, createSystemNotification, sendNotificationToUser, scheduleAppointmentReminder } = useNotifications();
  const { nurses: nursesFromContext, incrementAssignedClients } = useNurses();
  
  const [appointments, setAppointments] = useState([]);
  const [nurses, setNurses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const refreshInProgressRef = useRef(false); // Prevent concurrent refreshes (ref avoids unstable dep)
  const [lastRefreshTime, setLastRefreshTime] = useState(0); // Track last refresh time
  const appointmentsRef = useRef(appointments);
  useEffect(() => { appointmentsRef.current = appointments; }, [appointments]);

  const getAppointmentsStorageKey = () => `@876_appointments_${user?.id || 'guest'}`;
  const getNursesStorageKey = () => `@876_nurses_${user?.id || 'guest'}`;

  // No initial nurses - load from backend only
  const initialNurses = [];

  // Sample appointments data for client search functionality - cleared for testing with John Smith
  const sampleAppointments = [];  // Load data from storage
  const loadData = async () => {
    try {
      setIsLoading(true);
      
      const [storedAppointments, storedNurses] = await Promise.all([
        AsyncStorage.getItem(getAppointmentsStorageKey()),
        AsyncStorage.getItem(getNursesStorageKey()),
      ]);

      if (storedAppointments) {
        const parsedAppointments = JSON.parse(storedAppointments);
        const migratedAppointments = Array.isArray(parsedAppointments)
          ? parsedAppointments.map(migrateLegacyNotes)
          : [];
        setAppointments(migratedAppointments);
        const hasChanges = Array.isArray(parsedAppointments)
          && migratedAppointments.some((apt, index) => apt !== parsedAppointments[index]);
        if (hasChanges) {
          await saveAppointments(migratedAppointments);
        }
      } else {
        // Initialize with sample appointments for client search functionality
        setAppointments(sampleAppointments);
        await AsyncStorage.setItem(getAppointmentsStorageKey(), JSON.stringify(sampleAppointments));
      }

      if (storedNurses) {
        setNurses(JSON.parse(storedNurses));
      } else {
        // Start with empty nurses - load from backend only
        setNurses([]);
      }
    } catch (error) {
      console.error('Failed to load appointment data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Save appointments to storage
  const saveAppointments = async (updatedAppointments) => {
    try {
      await AsyncStorage.setItem(getAppointmentsStorageKey(), JSON.stringify(updatedAppointments));
    } catch (error) {
      console.error('Failed to save appointments:', error);
    }
  };

  // Save nurses to storage
  const saveNurses = async (updatedNurses) => {
    try {
      await AsyncStorage.setItem(getNursesStorageKey(), JSON.stringify(updatedNurses));
    } catch (error) {
      console.error('Failed to save nurses:', error);
    }
  };

  const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
  const hasText = (value) => normalizeText(value).length > 0;

  const migrateLegacyNotes = (appointment) => {
    if (!appointment || typeof appointment !== 'object') return appointment;
    const patientNotes = normalizeText(appointment.patientNotes) ||
      normalizeText(appointment.bookingNotes) ||
      normalizeText(appointment.clientNotes) ||
      normalizeText(appointment.specialInstructions);
    const nurseNotes = normalizeText(appointment.nurseNotes);
    const legacyNotes = normalizeText(appointment.notes);

    if (!patientNotes && !nurseNotes && legacyNotes) {
      return {
        ...appointment,
        patientNotes: legacyNotes,
        notes: ''
      };
    }

    return appointment;
  };

  useEffect(() => {
    if (!Array.isArray(appointments) || appointments.length === 0) return;
    let hasChanges = false;
    const migrated = appointments.map((appointment) => {
      const migratedAppointment = migrateLegacyNotes(appointment);
      if (migratedAppointment !== appointment) {
        hasChanges = true;
      }
      return migratedAppointment;
    });
    if (hasChanges) {
      setAppointments(migrated);
      saveAppointments(migrated);
    }
  }, [appointments]);

  // Refresh appointments from API
  const refreshAppointments = useCallback(async () => {
    if (!user) {
      setAppointments([]);
      return;
    }
    
    // Prevent concurrent refresh calls
    if (refreshInProgressRef.current) {
      // Refresh already in progress
      return;
    }
    
    try {
      // Refreshing appointments from backend
      refreshInProgressRef.current = true;
      setIsLoading(true);

      // Primary source: backend endpoint.
      // Fallback: Firestore (ApiService.getAppointments) because some flows (e.g. assigning
      // patient-created recurring requests) update Firestore directly.
      let rawAppointments = null;
      try {
        const response = await ApiService.makeRequest('/appointments');
        if (response?.success && Array.isArray(response.data)) {
          rawAppointments = response.data;
        }
      } catch (e) {
        rawAppointments = null;
      }

      if (!Array.isArray(rawAppointments)) {
        const firestoreAppointments = await ApiService.getAppointments();
        rawAppointments = Array.isArray(firestoreAppointments) ? firestoreAppointments : [];
      }

      if (Array.isArray(rawAppointments) && rawAppointments.length > 0) {
        const cachedAppointments = Array.isArray(appointmentsRef.current) ? appointmentsRef.current : [];

        // If a nurse saved notes locally (older builds) but they never reached Firestore,
        // we backfill them here so admins (and other devices) can see them.
        const shouldBackfillNurseNotes =
          (user?.role === 'nurse' || user?.role === 'nurses') && cachedAppointments.length > 0;
        const nurseNotesBackfillQueue = [];

        // Transform appointments to local format
        const transformedAppointments = rawAppointments.map(apt => {
          const patientFullName = apt.patientName || apt.clientName || (apt.patient?.firstName && apt.patient?.lastName
            ? `${apt.patient.firstName} ${apt.patient.lastName}`
            : 'Unknown Patient');

          // Resolve nurse ID from various possible fields
          const nurseId = apt.assignedNurse?.id || apt.assignedNurse?._id || (typeof apt.assignedNurse === 'string' ? apt.assignedNurse : null) || apt.nurseId || apt.nurse?.id || apt.nurse?._id || apt.nurse || null;

          const resolvedPatientId = apt.patientId || apt.patient?.id || apt.patient?._id || apt.patient || apt.clientId || null;
          const resolvedClientId = apt.clientId || apt.client?.id || apt.client?._id || resolvedPatientId;

          // Resolve nurse name with fallback to context lookup
          let assignedNurseName = apt.nurseName;
          
          if (!assignedNurseName) {
            // Try to get name from assignedNurse object
            if (apt.assignedNurse && typeof apt.assignedNurse === 'object') {
               assignedNurseName = getNurseName(apt.assignedNurse);
            }
            
            // If still no valid name (or it was 'Unassigned'), try looking up by ID
            if ((!assignedNurseName || assignedNurseName === 'Unassigned') && nurseId) {
               const foundNurse = nursesFromContext.find(n => n.id === nurseId || n._id === nurseId) || 
                                  nurses.find(n => n.id === nurseId || n._id === nurseId);
               if (foundNurse) {
                   assignedNurseName = getNurseName(foundNurse);
               }
            }
          }

          const locationAddress = apt.location?.address || apt.address || null;

          const cachedMatch = cachedAppointments.find((cached) => {
            if (!cached) return false;
            const apiId = apt.id || apt._id || apt.appointmentId;
            if (apiId && (cached.id === apiId || cached.appointmentId === apiId)) return true;
            if (cached.seriesId && apt.seriesId && cached.seriesId === apt.seriesId) {
              const cachedDate = cached.date || cached.startDate;
              const apiDate = apt.scheduledDate || apt.date || apt.startDate;
              const cachedTime = cached.time || cached.startTime;
              const apiTime = apt.scheduledTime || apt.time || apt.startTime;
              if (cachedDate === apiDate && cachedTime === apiTime) return true;
            }
            return false;
          });

          if (shouldBackfillNurseNotes) {
            const apiNotes = typeof apt?.nurseNotes === 'string' ? apt.nurseNotes.trim() : '';
            const cachedNotes = typeof cachedMatch?.nurseNotes === 'string' ? cachedMatch.nurseNotes.trim() : '';
            const backendId = apt?.id || apt?._id || null;
            if (!apiNotes && cachedNotes && backendId) {
              nurseNotesBackfillQueue.push({ appointmentId: backendId, nurseNotes: cachedNotes });
            }
          }

          return {
            id: apt.id || apt._id,
            appointmentId: apt.appointmentId,
            patientId: resolvedPatientId,
            clientId: resolvedClientId,
            patient: typeof apt.patient === 'object' ? apt.patient : null,
            patientName: patientFullName,
            patientEmail: apt.patientEmail || apt.patient?.email || apt.clientEmail || '',
            patientPhone: apt.patientPhone || apt.patient?.phone || apt.clientPhone || '',
            clientName: apt.clientName || patientFullName,
            clientEmail: apt.clientEmail || apt.patient?.email || '',
            clientPhone: apt.clientPhone || apt.patient?.phone || '',
            service: apt.service || apt.appointmentType || apt.serviceName || (Array.isArray(apt.services) && apt.services[0]) || apt.serviceType || 'General Care',
            appointmentType: apt.appointmentType || null,
            serviceType: apt.serviceType || null,
            date: apt.scheduledDate || apt.date,
            time: apt.scheduledTime || apt.time,
            address: formatAddress(locationAddress),
            locationDetails: apt.location || null,
            notes: apt.notes || '',
            patientNotes: apt.patientNotes || '',
            bookingNotes: apt.bookingNotes || '',
            clientNotes: apt.clientNotes || '',
            specialInstructions: apt.specialInstructions || '',
            nurseNotes: apt.nurseNotes || cachedMatch?.nurseNotes || '',
            nurseNotePhotos:
              (Array.isArray(apt.nurseNotePhotos) ? apt.nurseNotePhotos : null) ||
              (Array.isArray(cachedMatch?.nurseNotePhotos) ? cachedMatch.nurseNotePhotos : []),
            completionNotes: apt.completionNotes || '',
            patientAlerts: apt.patientAlerts || cachedMatch?.patientAlerts || null,
            status: apt.status || 'pending',
            nurseId: nurseId,
            nurseName: assignedNurseName,
            isShiftRequest: Boolean(apt.isShiftRequest),
            clientLocation: apt.clientLocation || locationAddress || null,
            billingCycle: apt.billingCycle || null,
            assignedAt: apt.assignedAt || null,
            actualStartTime: apt.actualStartTime || null,
            actualEndTime: apt.actualEndTime || null,
            clockInLocation: apt.clockInLocation || null,
            clockOutLocation: apt.clockOutLocation || null,
            hoursWorked: apt.hoursWorked || null,
            createdAt: apt.createdAt,
            updatedAt: apt.updatedAt || apt.createdAt,
            // Preserve recurring appointment fields
            startDate: apt.startDate || apt.recurringPeriodStart || cachedMatch?.startDate || null,
            startTime: apt.startTime || apt.scheduledStartTime || apt.appointmentStartTime || cachedMatch?.startTime || null,
            endDate: apt.endDate || apt.recurringPeriodEnd || cachedMatch?.endDate || null,
            endTime: apt.endTime || apt.scheduledEndTime || apt.appointmentEndTime || apt.end || apt.end_time || cachedMatch?.endTime || null,
            isRecurring: apt.isRecurring || false,
            isRecurringInstance: apt.isRecurringInstance || false,
            recurringFrequency: apt.recurringFrequency || null,
            recurringDuration: apt.recurringDuration || null,
            seriesId: apt.seriesId || null,
            instanceNumber: apt.instanceNumber || null,
            totalInstances: apt.totalInstances || null,
            daysOfWeek: apt.daysOfWeek || apt.recurringDaysOfWeek || apt.recurringDaysOfWeekList || cachedMatch?.daysOfWeek || null,
            selectedDays: apt.selectedDays || apt.daysOfWeek || apt.recurringDaysOfWeek || apt.recurringDaysOfWeekList || cachedMatch?.selectedDays || null,
            preferredNurseId: apt.preferredNurseId || apt.requestedNurseId || apt.primaryNurseId || apt.selectedNurseId || apt.primaryNurse?.id || cachedMatch?.preferredNurseId || null,
            preferredNurseName: apt.preferredNurseName || apt.requestedNurseName || apt.primaryNurseName || apt.selectedNurseName || apt.primaryNurse?.name || cachedMatch?.preferredNurseName || null,
            preferredNurseCode: apt.preferredNurseCode || apt.requestedNurseCode || apt.primaryNurseCode || apt.selectedNurseCode || apt.primaryNurse?.nurseCode || cachedMatch?.preferredNurseCode || null,
            requestedNurseId: apt.requestedNurseId || apt.preferredNurseId || apt.primaryNurseId || apt.selectedNurseId || cachedMatch?.requestedNurseId || null,
            requestedNurseName: apt.requestedNurseName || apt.preferredNurseName || apt.primaryNurseName || apt.selectedNurseName || cachedMatch?.requestedNurseName || null,
            requestedNurseCode: apt.requestedNurseCode || apt.preferredNurseCode || apt.primaryNurseCode || apt.selectedNurseCode || cachedMatch?.requestedNurseCode || null,

            // Preserve backup nurse fields (used by admin/nurse details modals)
            backupNurses:
              apt.backupNurses ||
              apt.shift?.backupNurses ||
              apt.shiftDetails?.backupNurses ||
              apt.emergencyBackupNurses ||
              cachedMatch?.backupNurses ||
              null,
            emergencyBackupNurses:
              apt.emergencyBackupNurses ||
              apt.shift?.emergencyBackupNurses ||
              apt.shiftDetails?.emergencyBackupNurses ||
              cachedMatch?.emergencyBackupNurses ||
              null,
            coverageRequests:
              apt.coverageRequests ||
              // Some emergency backup flows store requests under backupCoverageRequests;
              // surface them here so UI logic sees pending coverage consistently.
              apt.backupCoverageRequests ||
              apt.shift?.coverageRequests ||
              apt.shiftDetails?.coverageRequests ||
              cachedMatch?.coverageRequests ||
              null,
          };
        });

        // DEBUG: Log completed appointments with notes
        const completedWithNotes = transformedAppointments.filter(apt => apt.status === 'completed' && (apt.completionNotes || apt.nurseNotes));
        if (completedWithNotes.length > 0) {
          // Processing completed appointments with notes
          completedWithNotes.forEach(apt => {
            // Completed appointment item
          });
        }

        const migratedAppointments = transformedAppointments.map(migrateLegacyNotes);
        setAppointments(migratedAppointments);
        await saveAppointments(migratedAppointments);

        if (shouldBackfillNurseNotes && nurseNotesBackfillQueue.length > 0) {
          const unique = new Map();
          nurseNotesBackfillQueue.forEach((item) => {
            if (!item?.appointmentId) return;
            const text = typeof item.nurseNotes === 'string' ? item.nurseNotes.trim() : '';
            if (!text) return;
            if (!unique.has(item.appointmentId)) {
              unique.set(item.appointmentId, text);
            }
          });

          const entries = Array.from(unique.entries()).slice(0, 15);
          if (entries.length > 0) {
            await Promise.allSettled(
              entries.map(([id, nurseNotes]) =>
                ApiService.updateAppointment(id, { nurseNotes })
              )
            );
          }
        }

      } else {
        // No appointments returned from API - set empty (avoid stale cached data)
        setAppointments([]);
        await saveAppointments([]);
      }
    } catch (error) {
      console.error('❌ Failed to refresh appointments from API:', error.message);
      // On error, clear local cache rather than showing stale data from another user
      setAppointments([]);
      await saveAppointments([]);
    } finally {
      setIsLoading(false);
      refreshInProgressRef.current = false; // Mark refresh as complete
    }
  }, [nurses, nursesFromContext, user, createAppointmentNotification, createSystemNotification, sendNotificationToUser, scheduleAppointmentReminder, incrementAssignedClients]);

  // Book new appointment (Patient action)
  // Map service names to valid serviceType enum values
  const mapServiceType = (service) => {
    const serviceMap = {
      // Mobile app services to backend enum values
      'Dressings': 'Wound Care',
      'Medication Administration': 'Medication Administration',
      'NG Tubes': 'Wound Care', // No direct match, use Wound Care
      'Urinary Catheter': 'Wound Care', // No direct match, use Wound Care
      'IV Access': 'Medication Administration', // No direct match, use Medication Administration
      'Tracheostomy Care': 'Post-Surgery Care', // No direct match, use Post-Surgery Care
      'Physiotherapy': 'Physiotherapy',
      'Home Nursing': 'Home Nursing',
      'Hospital Sitter': 'Elder Care', // Hospital sitter is similar to elderly care support
      'Blood Draw': 'Blood Draw',
      'Wound Care': 'Wound Care',
      'Chronic Disease Monitoring': 'Chronic Disease Monitoring',
      'Post-Surgery Care': 'Post-Surgery Care',
      'Pediatric Care': 'Pediatric Care',
      'Mental Health Support': 'Mental Health Support',
      'Health Assessment': 'Health Assessment',
      'Palliative Care': 'Palliative Care',
      'Elder Care': 'Elder Care',
      // Aliases
      'General Care': 'Home Nursing',
      'Medication': 'Medication Administration',
      'Chronic Disease': 'Chronic Disease Monitoring',
      'Post-Surgery': 'Post-Surgery Care',
      'Pediatric': 'Pediatric Care',
      'Mental Health': 'Mental Health Support'
    };
    return serviceMap[service] || 'Home Nursing'; // Default to Home Nursing
  };

  // Convert 12-hour time format (e.g., "6:16 PM") to 24-hour format (e.g., "18:16")
  const convertTo24HourFormat = (time12) => {
    if (!time12) return '00:00';
    
    // Trim whitespace and normalize
    time12 = time12.trim().replace(/\s+/g, ' ');

    
    // Check if already in 24-hour format (HH:MM)
    const timeRegex24 = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (timeRegex24.test(time12)) {

      return time12;
    }

    // Handle 12-hour format (e.g., "6:16 PM" or "6:16 AM")
    const timeParts = time12.split(' ').filter(p => p.length > 0);
    if (timeParts.length < 2) {
      console.warn('⚠️ Invalid time format (no AM/PM found), attempting to parse:', time12);
      // Try extracting the time and period with regex
      const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const period = match[3].toUpperCase();
        
        if (period === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period === 'AM' && hours === 12) {
          hours = 0;
        }
        
        const result = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        return result;
      }
      
      console.warn('⚠️ Could not parse time format, returning as-is:', time12);
      return time12;
    }

    const [timeStr, period] = [timeParts[0], timeParts[1]];
    let [hours, minutes] = timeStr.split(':').map(Number);

    if (isNaN(hours) || isNaN(minutes)) {
      console.warn('⚠️ Could not parse hours/minutes:', { timeStr, hours, minutes });
      return time12;
    }

    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    const result = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    return result;
  };

  const bookAppointment = async (appointmentData) => {
    try {
      // Try to create appointment via API first
      const convertedTime = convertTo24HourFormat(appointmentData.time);

      const preferredNurseId =
        appointmentData?.preferredNurseId ||
        appointmentData?.requestedNurseId ||
        appointmentData?.primaryNurseId ||
        appointmentData?.nurseId ||
        null;

      const preferredNurseName =
        appointmentData?.preferredNurseName ||
        appointmentData?.requestedNurseName ||
        appointmentData?.nurseName ||
        null;

      const preferredNurseCode =
        appointmentData?.preferredNurseCode ||
        appointmentData?.requestedNurseCode ||
        appointmentData?.nurseCode ||
        null;

      const preferredNursePhoto = appointmentData?.preferredNursePhoto || null;

      const apiData = {
        patientId: user?.id,
        patientName: appointmentData.patientName || appointmentData.name || user?.fullName || user?.name, // Ensure patient name is sent
        clientName: appointmentData.patientName || appointmentData.name || user?.fullName || user?.name, // Add clientName for compatibility
        appointmentType: appointmentData.service,
        service: appointmentData.service, // Add service field for compatibility
        scheduledDate: appointmentData.date,
        appointmentDate: appointmentData.date, // Add appointmentDate for compatibility
        scheduledTime: convertedTime,
        appointmentTime: convertedTime, // Add appointmentTime for compatibility
        location: appointmentData.address,
        address: appointmentData.address, // Add address field for compatibility
        notes: appointmentData.notes || '',
        patientAlerts: appointmentData.patientAlerts || null,
        status: 'pending', // Ensure status is set so it appears in Admin dashboard
        priority: 'medium',
        estimatedDuration: 60, // Default 1 hour (60 minutes)

        // Preferred/requested nurse (patient-selected at booking)
        preferredNurseId: preferredNurseId,
        preferredNurseName: preferredNurseName,
        preferredNurseCode: preferredNurseCode,
        // Some backends use requestedNurse*; send both for compatibility.
        requestedNurseId: preferredNurseId,
        requestedNurseName: preferredNurseName,
        requestedNurseCode: preferredNurseCode,
      };
      
      const response = await ApiService.makeRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify(apiData),
      });
      
      console.log('📍 Booking response:', response);
      
      if (response.success) {
        // Handle response based on backend format
        let created;
        if (response.appointment) {
          created = response.appointment;
        } else if (response.data && response.data.length > 0) {
          created = response.data[0]; // Take first appointment if array
        } else if (response.data && !Array.isArray(response.data)) {
          created = response.data; // Direct object
        } else {
          // Backend created successfully but didn't return appointment data
          // Use the original appointment data with generated ID
          created = {
            _id: `apt_${Date.now()}`,
            patientId: user?.id,
            service: appointmentData.service,
            scheduledDate: appointmentData.date,
            scheduledTime: convertedTime,
            address: appointmentData.address,
            notes: appointmentData.notes || '',
            status: 'pending',
            createdAt: new Date().toISOString(),
            preferredNurseId,
            preferredNurseName,
            preferredNurseCode,
            preferredNursePhoto,
          };
        }
        // Also save locally for offline support
        const newAppointment = {
          id: created._id || created.id || `apt_${Date.now()}`,
          patientId: created.patientId || user?.id || 'PATIENT001',
          patientName: created.patientName || user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Patient',
          patientEmail: created.patientEmail || user?.email || 'patient@care.com',
          patientPhone: created.patientPhone || user?.phone || '',
          service: created.service || appointmentData.service,
          date: created.scheduledDate || appointmentData.date,
          time: created.scheduledTime || appointmentData.time,
          address: created.address || appointmentData.address,
          notes: created.notes || appointmentData.notes || '',
          patientAlerts: created.patientAlerts || appointmentData.patientAlerts || null,
          status: created.status || 'pending',
          nurseId: created.nurseId || null,
          nurseName: created.nurseName || null,
          // Preserve preferred/requested nurse selection for Pending details modal.
          preferredNurseId:
            created.preferredNurseId ||
            created.requestedNurseId ||
            preferredNurseId ||
            null,
          preferredNurseName:
            created.preferredNurseName ||
            created.requestedNurseName ||
            preferredNurseName ||
            null,
          preferredNurseCode:
            created.preferredNurseCode ||
            created.requestedNurseCode ||
            preferredNurseCode ||
            null,
          preferredNursePhoto:
            created.preferredNursePhoto ||
            preferredNursePhoto ||
            null,
          requestedNurseId:
            created.requestedNurseId ||
            created.preferredNurseId ||
            preferredNurseId ||
            null,
          requestedNurseName:
            created.requestedNurseName ||
            created.preferredNurseName ||
            preferredNurseName ||
            null,
          requestedNurseCode:
            created.requestedNurseCode ||
            created.preferredNurseCode ||
            preferredNurseCode ||
            null,
          createdAt: created.createdAt || new Date().toISOString(),
          updatedAt: created.updatedAt || created.createdAt || new Date().toISOString(),
        };

        const updatedAppointments = [...appointments, newAppointment];
        setAppointments(updatedAppointments);
        await saveAppointments(updatedAppointments);

        // Refresh appointments from backend to get the latest state
        setTimeout(() => {
          console.log('📍 Triggering appointment refresh after booking...');
          refreshAppointments();
        }, 1000);

        return newAppointment;
      }
    } catch (error) {
      console.error('⚠️ API call failed, saving locally:', error.message);
      
      // Fallback to local storage if API fails
      const newAppointment = {
        id: `apt_${Date.now()}`,
        patientId: user?.id || 'PATIENT001',
        patientName: user?.name || 'John Smith',
        patientEmail: user?.email || 'john@example.com',
        patientPhone: user?.phone || '876-555-0123',
        service: appointmentData.service,
        date: appointmentData.date,
        time: appointmentData.time,
        address: appointmentData.address,
        notes: appointmentData.notes || '',
        patientAlerts: appointmentData.patientAlerts || null,
        status: 'pending',
        nurseId: null,
        nurseName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const updatedAppointments = [...appointments, newAppointment];

      setAppointments(updatedAppointments);
      await saveAppointments(updatedAppointments);

      // Try to send notification to admin
      try {
        await sendNotificationToUser(
          'admin-001',
          'admin',
          'New Appointment Request',
          `${newAppointment.patientName} has requested a ${newAppointment.service} appointment for ${newAppointment.date}`,
          {
            appointmentId: newAppointment.id,
            patientId: newAppointment.patientId,
            type: 'appointment_booked'
          }
        );
      } catch (notifError) {
        console.error('Failed to send notification:', notifError);
      }

      return newAppointment;
    }
  };

  // Assign appointment to nurse (Admin action)
  const assignNurse = async (appointmentId, nurseId) => {
    // Find the nurse from NurseContext instead of local nurses array
    const nurse = nursesFromContext.find(n => n.id === nurseId);
    
    if (!nurse) {
      console.error('❌ Nurse assignment failed - Nurse not found with ID:', nurseId);
      console.error('Available nurses:', nursesFromContext.map(n => ({ id: n.id, name: n.name, code: n.code })));
      throw new Error('Nurse not found');
    }

    console.log('✅ Assigning appointment', appointmentId, 'to nurse:', { id: nurse.id, name: nurse.name, code: nurse.code || nurse.nurseCode });
    
    // First, call backend API to persist the assignment
    try {
      console.log('📡 Calling backend to assign nurse...');
      const response = await ApiService.makeRequest(`/appointments/${appointmentId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ nurseId, status: 'assigned' })
      });
      
      if (response.success) {
        console.log('✅ Backend assignment successful:', response);
        
        // Get appointment data from the backend response
        const backendAppointment = response.data || response.appointment;
        console.log('📋 Backend appointment data:', backendAppointment);
        
        const appointmentData = {
          patientName: backendAppointment?.patientName || backendAppointment?.clientName || (backendAppointment?.patient?.firstName && backendAppointment?.patient?.lastName
            ? `${backendAppointment.patient.firstName} ${backendAppointment.patient.lastName}`
            : 'Patient'),
          service: backendAppointment?.serviceType || backendAppointment?.service || 'Service'
        };
        
        console.log('📧 Sending notification to nurse...');
        
        // Send notification to specific nurse about assignment
        await sendNotificationToUser(
          nurseId,
          'nurse',
          'New Assignment',
          `You have been assigned to ${appointmentData.patientName} for ${appointmentData.service}`,
          {
            appointmentId,
            type: 'appointment_assigned',
            patientName: appointmentData.patientName,
            service: appointmentData.service
          }
        );

        // Note: Admin will be notified when nurse accepts/declines, not on assignment
        console.log('🔄 Refreshing appointments...');
        
        // Refresh appointments in background (don't wait for it)
        refreshAppointments().catch(err => {
          console.error('Failed to refresh appointments:', err);
        });
        
        return;
      } else {
        console.warn('⚠️ Backend assignment response:', response);
      }
    } catch (error) {
      console.error('❌ Backend assignment failed:', error.message);
      // Continue with local update anyway for offline support
    }

    // Update local state
    const updatedAppointments = appointments.map(appointment => 
      appointment.id === appointmentId 
        ? {
            ...appointment,
            nurseId,
            nurseName: nurse.name,
            status: 'assigned', // Nurse assigned, waiting for acceptance
            assignedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        : appointment
    );

    setAppointments(updatedAppointments);
    await saveAppointments(updatedAppointments);

    const appointment = updatedAppointments.find(apt => apt.id === appointmentId);

    // Send notification to specific nurse about assignment
    await sendNotificationToUser(
      nurseId, // Send to the specific nurse
      'nurse',
      'New Assignment',
      `You have been assigned to ${appointment.patientName} for ${appointment.service}`,
      {
        appointmentId,
        type: 'assignment_received',
        nurseId
      }
    );

    // Send confirmation notification to admin about successful assignment
    const adminTargetId = user?.id || user?._id || 'admin-001';
    await sendNotificationToUser(
      adminTargetId,
      'admin',
      'Nurse Assigned',
      `${nurse.name} has been assigned to ${appointment.patientName} for ${appointment.service}`,
      {
        appointmentId,
        type: 'nurse_assignment_confirmed',
        nurseId
      }
    );

    return appointment;
  };

  // Accept assignment (Nurse action)
  const acceptAppointment = async (appointmentId) => {
    try {

      
      // Call backend to update status
      const response = await ApiService.makeRequest(`/appointments/${appointmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'confirmed' })
      });

      if (response.success) {

        
        // Update local state IMMEDIATELY for instant UI feedback
        const updatedAppointments = appointments.map(appointment => 
          appointment.id === appointmentId 
            ? {
                ...appointment,
                status: 'confirmed',
                acceptedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            : appointment
        );

        setAppointments(updatedAppointments);
        await saveAppointments(updatedAppointments);
        
        const appointment = updatedAppointments.find(apt => apt.id === appointmentId);

        // Refresh from backend to ensure all users see the update
        setTimeout(() => {
          refreshAppointments().catch(err => console.error('Failed to refresh after accept:', err));
        }, 500);

        // Send notifications (non-blocking)
        Promise.all([
          sendNotificationToUser(
            'admin-001',
            'admin',
            'Assignment Accepted',
            `${appointment.nurseName} has accepted the appointment with ${appointment.patientName}`,
            {
              appointmentId,
              type: 'assignment_accepted'
            }
          ),
          sendNotificationToUser(
            appointment.patientId,
            'patient',
            'Appointment Confirmed',
            `Your appointment for ${appointment.service} has been confirmed with ${appointment.nurseName}`,
            {
              appointmentId,
              type: 'appointment_confirmed'
            }
          )
        ]).catch(err => console.error('Notification error:', err));

        // Schedule reminder (non-blocking)
        try {
          const appointmentDateTime = new Date(`${appointment.date}T${appointment.time}`);
          await scheduleAppointmentReminder(
            `${appointment.service} Appointment`,
            appointmentDateTime,
            30
          );
        } catch (error) {
          console.error('Failed to schedule appointment reminder:', error);
        }

        return appointment;
      } else {
        console.error('❌ Failed to accept appointment:', response.error);
        throw new Error(response.error || 'Failed to accept appointment');
      }
    } catch (error) {
      console.error('❌ Error accepting appointment:', error.message);
      throw error;
    }
  };

  // Decline assignment (Nurse action)
  const declineAppointment = async (appointmentId, reason = '') => {
    try {
      // Call backend to update status
      const response = await ApiService.makeRequest(`/appointments/${appointmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          status: 'pending',
          assignedNurse: null,
          notes: reason
        })
      });

      if (response.success) {
        const updatedAppointments = appointments.map(appointment => 
          appointment.id === appointmentId 
            ? {
                ...appointment,
                status: 'pending',
                nurseId: null,
                nurseName: null,
                declinedAt: new Date().toISOString(),
                declineReason: reason,
                updatedAt: new Date().toISOString()
              }
            : appointment
        );

        setAppointments(updatedAppointments);
        await saveAppointments(updatedAppointments);
        
        const appointment = updatedAppointments.find(apt => apt.id === appointmentId);

        // Refresh from backend to ensure all users see the update
        setTimeout(() => {
          refreshAppointments().catch(err => console.error('Failed to refresh after decline:', err));
        }, 500);

        // Send notifications (non-blocking)
        Promise.all([
          sendNotificationToUser(
            'admin-001',
            'admin',
            'Assignment Declined',
            `Assignment declined for ${appointment.patientName}. ${reason ? 'Reason: ' + reason : ''}`,
            {
              appointmentId,
              type: 'assignment_declined'
            }
          ),
          sendNotificationToUser(
            appointment.patientId,
            'patient',
            'Appointment Needs Reassignment',
            `Your appointment for ${appointment.service} needs to be reassigned to another nurse. We'll notify you once a new nurse is assigned.`,
            {
              appointmentId,
              type: 'appointment_declined'
            }
          )
        ]).catch(err => console.error('Notification error:', err));

        return appointment;
      } else {
        console.error('❌ Failed to decline appointment:', response.error);
        throw new Error(response.error || 'Failed to decline appointment');
      }
    } catch (error) {
      console.error('❌ Error declining appointment:', error.message);
      throw error;
    }
  };

  // Clock-in appointment (Nurse action)
  const clockInAppointment = async (appointmentId, { startTime, clockInLocation } = {}) => {
    try {
      const clockInTimestamp = startTime || new Date().toISOString();
      const response = await ApiService.makeRequest(`/appointments/${appointmentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'clocked-in',
          actualStartTime: clockInTimestamp,
          clockInLocation: clockInLocation || null,
        })
      });

      if (response.success) {
        const updatedAppointments = appointments.map(appointment =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                status: 'clocked-in',
                actualStartTime: clockInTimestamp,
                clockInLocation: clockInLocation || appointment.clockInLocation,
                updatedAt: new Date().toISOString(),
              }
            : appointment
        );

        setAppointments(updatedAppointments);
        await saveAppointments(updatedAppointments);

        return { success: true, clockInTime: clockInTimestamp };
      } else {
        console.error('❌ Failed to clock in appointment:', response.error);
        throw new Error(response.error || 'Failed to clock in appointment');
      }
    } catch (error) {
      console.error('❌ Error clocking in appointment:', error.message);
      throw error;
    }
  };

  // Complete appointment (Nurse action)
  const completeAppointment = async (appointmentId, notes = '', extraData = {}) => {
    try {
      const completionTimestamp = extraData.actualEndTime || new Date().toISOString();
      // Call backend to update status
      const response = await ApiService.makeRequest(`/appointments/${appointmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          status: 'completed',
          completionNotes: notes,
          actualEndTime: completionTimestamp,
          ...extraData,
        })
      });

      if (response.success) {
        const updatedAppointments = appointments.map(appointment => 
          appointment.id === appointmentId 
            ? {
                ...appointment,
                status: 'completed',
                completedAt: completionTimestamp,
                completionNotes: notes,
                nurseNotes: notes, // Also set nurseNotes for consistent display
                actualEndTime: completionTimestamp,
                actualStartTime: extraData.actualStartTime || appointment.actualStartTime,
                clockOutLocation: extraData.clockOutLocation || appointment.clockOutLocation,
                updatedAt: new Date().toISOString()
              }
            : appointment
        );

        setAppointments(updatedAppointments);
        await saveAppointments(updatedAppointments);
        
        const appointment = updatedAppointments.find(apt => apt.id === appointmentId);

        // Auto-generate invoice on completion (no user action), for non-recurring non-shift appointments.
        // This ensures patient Past modals can display invoices without any tap-to-generate behavior.
        try {
          if (appointment) {
            const isShiftLike = Boolean(
              appointment?.isShiftRequest ||
                appointment?.isShift ||
                appointment?.clockByNurse ||
                appointment?.nurseSchedule ||
                String(appointment?.assignmentType || '').toLowerCase() === 'split-schedule'
            );

            const isRecurring = Boolean(
              appointment?.isRecurring ||
                appointment?.recurring ||
                appointment?.recurringScheduleId ||
                appointment?.recurringSchedule
            );

            if (!isShiftLike && !isRecurring) {
              const existingInvoices = await InvoiceService.getAllInvoices();
              const alreadyHasInvoice = (existingInvoices || []).some((inv) => {
                const invAppointmentId = String(inv?.appointmentId || inv?.relatedAppointmentId || inv?.appointmentID || '');
                return invAppointmentId && invAppointmentId === String(appointmentId);
              });

              if (!alreadyHasInvoice) {
                const serviceType =
                  appointment?.service ||
                  appointment?.serviceType ||
                  appointment?.appointmentType ||
                  appointment?.serviceName ||
                  null;

                const startRaw =
                  appointment?.actualStartTime ||
                  appointment?.startedAt ||
                  appointment?.clockInTime ||
                  appointment?.startTime ||
                  null;
                const endRaw =
                  appointment?.actualEndTime ||
                  appointment?.completedAt ||
                  appointment?.clockOutTime ||
                  appointment?.endTime ||
                  completionTimestamp ||
                  null;
                const startMs = startRaw ? Date.parse(startRaw) : NaN;
                const endMs = endRaw ? Date.parse(endRaw) : NaN;
                const computedHours =
                  Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
                    ? Math.max(0, (endMs - startMs) / (1000 * 60 * 60))
                    : null;

                const hoursWorked =
                  appointment?.hoursWorked ||
                  appointment?.totalHours ||
                  (computedHours !== null ? Number(computedHours.toFixed(2)) : 1);

                if (serviceType) {
                  await InvoiceService.updateCompanyInfo();
                  await InvoiceService.createInvoice({
                    id: appointmentId,
                    relatedAppointmentId: appointmentId,
                    shiftRequestId: appointment?.shiftRequestId || appointment?.shiftId || null,
                    patientName: appointment?.patientName || appointment?.clientName || 'Client',
                    patientEmail: appointment?.patientEmail || appointment?.email || appointment?.clientEmail || '',
                    patientPhone: appointment?.patientPhone || appointment?.phone || appointment?.clientPhone || 'N/A',
                    address: formatAddress(appointment?.address || appointment?.clientAddress || appointment?.patientAddress) || 'Address on file',
                    nurseName: getNurseName(appointment) || appointment?.nurseName || 'Assigned Nurse',
                    service: serviceType,
                    serviceType,
                    serviceName: serviceType,
                    appointmentDate:
                      appointment?.date ||
                      appointment?.appointmentDate ||
                      appointment?.scheduledDate ||
                      appointment?.startDate ||
                      completionTimestamp,
                    hoursWorked,
                    notes:
                      appointment?.completionNotes ||
                      appointment?.nurseNotes ||
                      appointment?.notes ||
                      notes ||
                      'Professional nursing services provided',
                  });
                }
              }
            }
          }
        } catch (invoiceError) {
          console.warn('⚠️ Invoice auto-generation failed:', invoiceError?.message || invoiceError);
        }

        // Increment the nurse's assigned clients count (safely, without breaking if context unavailable)
        try {
          if (appointment.nurseId) {
            incrementAssignedClients(appointment.nurseId);
          }
        } catch (err) {
          console.warn('⚠️ Could not update nurse stats:', err.message);
        }

        // Send notification to admin (non-blocking)
        Promise.all([
          sendNotificationToUser(
            'admin-001',
            'admin',
            'Appointment Completed',
            `${appointment.nurseName} has completed the appointment with ${appointment.patientName}`,
            {
              appointmentId,
              type: 'appointment_completed'
            }
          )
        ]).catch(err => console.error('Notification error:', err));

        return appointment;
      } else {
        console.error('❌ Failed to complete appointment:', response.error || response.details);
        throw new Error(response.error || response.details || 'Failed to complete appointment');
      }
    } catch (error) {
      console.error('❌ Error completing appointment:', error.message);
      throw error;
    }
  };

  // Clear all completed appointments (for testing)
  const clearCompletedAppointments = async () => {
    const nonCompletedAppointments = appointments.filter(apt => apt.status !== 'completed');
    setAppointments(nonCompletedAppointments);
    await saveAppointments(nonCompletedAppointments);
  };

  // Clear ALL appointments (for testing)
  const clearAllAppointments = async () => {
    setAppointments([]);
    await AsyncStorage.setItem(getAppointmentsStorageKey(), JSON.stringify([]));
  };

  // Cancel appointment
  const cancelAppointment = async (appointmentId, reason = '') => {
    try {
      // Call backend to update status
      const response = await ApiService.makeRequest(`/appointments/${appointmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          status: 'cancelled',
          notes: reason
        })
      });

      if (response.success) {
        const updatedAppointments = appointments.map(apt => 
          apt.id === appointmentId 
            ? { 
                ...apt, 
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
                cancellationReason: reason,
                updatedAt: new Date().toISOString(),
              }
            : apt
        );

        setAppointments(updatedAppointments);
        await saveAppointments(updatedAppointments);
        
        const appointment = updatedAppointments.find(apt => apt.id === appointmentId);

        // Send notifications (non-blocking)
        Promise.all([
          sendNotificationToUser(
            appointment.patientId,
            'patient',
            'Appointment Cancelled',
            `Your appointment on ${new Date(appointment.appointmentDate).toLocaleDateString()} has been cancelled${reason ? ': ' + reason : ''}`,
            {
              appointmentId,
              type: 'appointment_cancelled'
            }
          ),
          sendNotificationToUser(
            'admin-001',
            'admin',
            'Appointment Cancelled',
            `Appointment with ${appointment.patientName} has been cancelled${reason ? ': ' + reason : ''}`,
            {
              appointmentId,
              type: 'appointment_cancelled'
            }
          )
        ]).catch(err => console.error('Notification error:', err));

        return appointment;
      } else {
        console.error('❌ Failed to cancel appointment:', response.error);
        throw new Error(response.error || 'Failed to cancel appointment');
      }
    } catch (error) {
      console.error('❌ Error cancelling appointment:', error.message);
      throw error;
    }
  };

  // Get appointments by patient ID (for patient screens)
  const getPatientAppointments = (patientId = null) => {
    const targetPatientId = patientId || user?.id;
    return appointments
      .filter((apt) => {
        if (!apt) return false;
        return (
          apt.patientId === targetPatientId ||
          String(apt.patientId) === String(targetPatientId) ||
          apt.clientId === targetPatientId ||
          String(apt.clientId) === String(targetPatientId) ||
          apt.userId === targetPatientId ||
          String(apt.userId) === String(targetPatientId) ||
          (apt.patientName && user?.name && String(apt.patientName).toLowerCase() === String(user.name).toLowerCase())
        );
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };

  // Get upcoming appointments for patient (confirmed, scheduled, or assigned status)
  const getUpcomingAppointments = (patientId = null) => {
    const targetPatientId = patientId || user?.id;
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Set to start of today for comparison

    const coerceToDateSafe = (value) => {
      if (!value) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      
      // Handle formatted date strings like "Feb 10, 2026"
      if (typeof value === 'string') {
        const dateMatch = value.match(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})/);
        if (dateMatch) {
          const [_, monthStr, dayStr, yearStr] = dateMatch;
          const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthStr);
          if (monthIndex >= 0) {
            const d = new Date(parseInt(yearStr, 10), monthIndex, parseInt(dayStr, 10));
            if (!Number.isNaN(d.getTime())) {
              return d;
            }
          }
        }
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
        // Serialized timestamp-like { seconds }
        if (typeof value.seconds === 'number') {
          const d = new Date(value.seconds * 1000);
          return Number.isNaN(d.getTime()) ? null : d;
        }
      }
      return null;
    };
    
    const filtered = appointments.filter(apt => {
      const matches =
        apt.patientId === targetPatientId ||
        String(apt.patientId) === String(targetPatientId) ||
        apt.clientId === targetPatientId ||
        String(apt.clientId) === String(targetPatientId) ||
        apt.userId === targetPatientId ||
        String(apt.userId) === String(targetPatientId) ||
        (apt.patientName && user?.name && String(apt.patientName).toLowerCase() === String(user.name).toLowerCase());
      
      // Only show confirmed/scheduled and in-progress states in Upcoming (not 'assigned' - nurse hasn't accepted yet)
      const statusMatch =
        apt.status === 'confirmed' ||
        apt.status === 'scheduled' ||
        apt.status === 'active' ||
        apt.status === 'clocked-in' ||
        apt.status === 'in-progress';
      
      // Parse the date safely - default to false to exclude unparseable dates from upcoming
      let dateValid = false;
      try {
        const rawDate =
          apt.date ||
          apt.scheduledDate ||
          apt.startDate ||
          apt.appointmentDate ||
          null;
        const aptDate = coerceToDateSafe(rawDate);
        if (aptDate) {
          aptDate.setHours(0, 0, 0, 0);
          // Appointment is upcoming if it's today or in the future
          dateValid = aptDate >= now;
        }
      } catch (e) {
        console.log('Date parse error for upcoming appointment:', apt.date, e);
        // Default to false - don't show appointments we can't parse dates for
        dateValid = false;
      }
      
      return matches && statusMatch && dateValid;
    });
    
    return filtered.sort((a, b) => {
      try {
        const dateA = coerceToDateSafe(a.date || a.scheduledDate || a.startDate || a.appointmentDate || null);
        const dateB = coerceToDateSafe(b.date || b.scheduledDate || b.startDate || b.appointmentDate || null);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA - dateB;
      } catch (e) {
        return 0;
      }
    });
  };

  // Get appointment history for patient (completed appointments)
  const getAppointmentHistory = (patientId = null) => {
    const targetPatientId = patientId || user?.id;
    
    return appointments.filter(apt => 
      (apt.patientId === targetPatientId || String(apt.patientId) === String(targetPatientId)) && 
      apt.status === 'completed'
    ).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  };

  // Get appointments by role and filters
  const getAppointmentsByRole = (role, filters = {}) => {
    let filtered = appointments;

    switch (role) {
      case 'patient':
        filtered = getPatientAppointments();
        break;
      case 'nurse':
        filtered = appointments.filter(apt => apt.nurseId === user?.id);
        break;
      case 'admin':
        // Admin sees all appointments
        break;
      default:
        filtered = [];
    }

    // Apply additional filters
    if (filters.status) {
      filtered = filtered.filter(apt => apt.status === filters.status);
    }

    if (filters.date) {
      filtered = filtered.filter(apt => apt.date === filters.date);
    }

    return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };

  // Get available nurses
  const getAvailableNurses = () => {
    return nurses.filter(nurse => nurse.status === 'available');
  };

  // Update nurse status
  const updateNurseStatus = async (nurseId, status) => {
    const updatedNurses = nurses.map(nurse => 
      nurse.id === nurseId 
        ? { ...nurse, status, updatedAt: new Date().toISOString() }
        : nurse
    );

    setNurses(updatedNurses);
    await saveNurses(updatedNurses);
  };

  // Get appointment statistics for admin dashboard
  const getAppointmentStats = () => {
    const today = new Date().toISOString().split('T')[0];
    
    return {
      total: appointments.length,
      pending: appointments.filter(apt => apt.status === 'pending').length,
      confirmed: appointments.filter(apt => apt.status === 'confirmed').length,
      completed: appointments.filter(apt => apt.status === 'completed').length,
      cancelled: appointments.filter(apt => apt.status === 'cancelled').length,
      todayAppointments: appointments.filter(apt => apt.date === today).length,
    };
  };

  // Get appointments by status
  const getAppointmentsByStatus = (status) => {
    if (!appointments || !Array.isArray(appointments)) {
      return [];
    }
    return appointments.filter(appointment => appointment.status === status);
  };

  // Get appointments by nurse ID
  const getAppointmentsByNurse = (nurseId) => {
    if (!appointments || !Array.isArray(appointments)) {
      return [];
    }
    return appointments.filter(appointment => appointment.nurseId === nurseId);
  };

  // Update nurse availability status
  const updateNurseAvailability = async (nurseId, isAvailable) => {
    const status = isAvailable ? 'available' : 'offline';
    const updatedNurses = nurses.map(nurse =>
      nurse.id === nurseId
        ? {
            ...nurse,
            status,
            isAvailable,
            isActive: isAvailable,
            updatedAt: new Date().toISOString(),
          }
        : nurse
    );

    setNurses(updatedNurses);
    await saveNurses(updatedNurses);
  };

  // Update appointment notes
  const updateAppointmentNotes = async (appointmentId, notes) => {
    const sanitizedNotes = typeof notes === 'string' ? notes : '';
    const updatedAppointments = appointments.map(appointment => {
      const matches = appointment.id === appointmentId
        || appointment._id === appointmentId
        || appointment.appointmentId === appointmentId;
      if (!matches) {
        return appointment;
      }

      return {
        ...appointment,
        notes: sanitizedNotes,
        updatedAt: new Date().toISOString()
      };
    });

    setAppointments(updatedAppointments);
    await saveAppointments(updatedAppointments);
    return updatedAppointments.find(apt => apt.id === appointmentId || apt._id === appointmentId || apt.appointmentId === appointmentId);
  };

  const updateNurseNotes = async (appointmentId, notes) => {
    const sanitizedNotes = typeof notes === 'string' ? notes : '';

    const existingAppointment = appointments.find((appointment) => {
      if (!appointment) return false;
      return (
        appointment.id === appointmentId ||
        appointment._id === appointmentId ||
        appointment.appointmentId === appointmentId
      );
    });

    const backendAppointmentId =
      existingAppointment?.id || existingAppointment?._id || appointmentId;

    const updatedAppointments = appointments.map(appointment => {
      const matches = appointment.id === appointmentId
        || appointment._id === appointmentId
        || appointment.appointmentId === appointmentId;
      if (!matches) {
        return appointment;
      }

      return {
        ...appointment,
        nurseNotes: sanitizedNotes,
        updatedAt: new Date().toISOString()
      };
    });

    setAppointments(updatedAppointments);
    await saveAppointments(updatedAppointments);

    // Persist nurse notes to backend so admins (and other devices) can see them.
    // If this fails, keep the local save but surface the error so the UI can prompt retry.
    try {
      await ApiService.updateAppointment(backendAppointmentId, {
        nurseNotes: sanitizedNotes,
      });
    } catch (error) {
      const err = new Error('Failed to sync nurse notes to the server. Notes were saved locally; please try again.');
      err.cause = error;
      throw err;
    }

    return updatedAppointments.find(apt => apt.id === appointmentId || apt._id === appointmentId || apt.appointmentId === appointmentId);
  };

  // Add completed appointment from shift (for patient history)
  const addCompletedAppointmentFromShift = async (shiftData) => {
    const completedAppointment = {
      id: `appointment-${shiftData.id}-${Date.now()}`,
      patientId: shiftData.clientId || 'PATIENT001',
      patientName: shiftData.clientName || shiftData.patientName || 'Patient',
      patientEmail: shiftData.clientEmail || shiftData.patientEmail || 'patient@care.com',
      patientPhone: shiftData.clientPhone || shiftData.patientPhone || 'N/A',
      address: shiftData.clientAddress || shiftData.address || 'N/A',
      service: shiftData.service,
      date: shiftData.date,
      time: shiftData.startTime,
      actualStartTime: shiftData.actualStartTime,
      actualEndTime: shiftData.actualEndTime || new Date().toISOString(),
      duration: `${shiftData.hoursWorked || '0'} hours`,
      hoursWorked: shiftData.hoursWorked,
      nurseId: shiftData.nurseId,
      nurseName: shiftData.nurseName,
      status: 'completed',
      completedAt: shiftData.completedAt || new Date().toISOString(),
      notes: shiftData.completionNotes || shiftData.notes || '',
      isFromShift: true,
      shiftId: shiftData.id
    };

    const updatedAppointments = [...appointments, completedAppointment];
    setAppointments(updatedAppointments);
    await saveAppointments(updatedAppointments);
    
    return completedAppointment;
  };

  // Load data on mount and refresh from API
  // Load data on mount
  useEffect(() => {
    if (user) {
      // Clear any stale data from previous sessions first
      setAppointments([]);
      
      // Then fetch fresh data from API
      refreshAppointments();
      
      // Set up periodic refresh every 30 seconds to catch assignment updates
      const refreshInterval = setInterval(() => {
        // 30-second auto-refresh interval
        refreshAppointments();
      }, 30000);
      
      return () => clearInterval(refreshInterval);
    } else {
      // Clear appointments if no user
      setAppointments([]);
      // Also clear from storage
      AsyncStorage.removeItem(getAppointmentsStorageKey()).catch(err => 
        console.error('Failed to clear appointments storage:', err)
      );
    }
  }, [user?.id]); // Only trigger when user ID changes, not on every user object change

  const value = useMemo(() => ({
    appointments,
    nurses,
    isLoading,
    bookAppointment,
    assignNurse,
    acceptAppointment,
    declineAppointment,
    clockInAppointment,
    completeAppointment,
    cancelAppointment,
    clearCompletedAppointments,
    clearAllAppointments,
    refreshAppointments,
    getAppointmentsByRole,
    getAppointmentsByStatus,
    getAppointmentsByNurse,
    getPatientAppointments,
    getUpcomingAppointments,
    getAppointmentHistory,
    getAvailableNurses,
    updateNurseStatus,
    updateNurseAvailability,
    updateAppointmentNotes,
    updateNurseNotes,
    getAppointmentStats,
    addCompletedAppointmentFromShift,
  }), [
    appointments,
    nurses,
    isLoading,
    bookAppointment,
    assignNurse,
    acceptAppointment,
    declineAppointment,
    clockInAppointment,
    completeAppointment,
    cancelAppointment,
    clearCompletedAppointments,
    clearAllAppointments,
    refreshAppointments,
    getAppointmentsByRole,
    getAppointmentsByStatus,
    getAppointmentsByNurse,
    getPatientAppointments,
    getUpcomingAppointments,
    getAppointmentHistory,
    getAvailableNurses,
    updateNurseStatus,
    updateNurseAvailability,
    updateAppointmentNotes,
    updateNurseNotes,
    getAppointmentStats,
    addCompletedAppointmentFromShift,
  ]);

  return (
    <AppointmentContext.Provider value={value}>
      {children}
    </AppointmentContext.Provider>
  );
};