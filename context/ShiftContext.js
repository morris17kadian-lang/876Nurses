import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { useNotifications } from './NotificationContext';
import ApiService from '../services/ApiService';
import InvoiceService from '../services/InvoiceService';
import FirebaseEmailQueueService from '../services/FirebaseEmailQueueService';

const ShiftContext = createContext();

// React Native doesn't guarantee a global `window`. Use module state instead.
let _shiftContextInitialized = false;
let _lastSaveCount = 0;

export function ShiftProvider({ children }) {
  const { user } = useAuth(); // Add auth context to track user changes
  const { sendNotificationToUser } = useNotifications();
  // Mock shift requests data - cleared for testing
  const [shiftRequests, setShiftRequests] = useState([]);
  const [lastPendingCount, setLastPendingCount] = useState(0); // Track pending count changes
  const [isOnline, setIsOnline] = useState(true); // Track API availability
  const lastOfflineLogRef = useRef(0); // Track timestamp of last offline log
  const STORAGE_KEY = '@876_shift_requests_global'; // Global key for all users
  const OFFLINE_LOG_THROTTLE = 120000; // Only log offline message once every 2 minutes

  const normalizeTimestamp = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch (error) {
        return null;
      }
    }
    if (typeof value === 'object') {
      const seconds = value.seconds ?? value._seconds;
      if (typeof seconds === 'number') {
        const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
        const millis = seconds * 1000 + Math.floor(nanos / 1e6);
        try {
          return new Date(millis).toISOString();
        } catch (error) {
          return null;
        }
      }
    }
    return null;
  };

  const sanitizeForFirestore = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeForFirestore(item));
    }

    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).reduce((acc, [key, val]) => {
        const sanitized = sanitizeForFirestore(val);
        if (sanitized !== undefined) {
          acc[key] = sanitized;
        }
        return acc;
      }, {});
    }

    if (value === undefined) {
      return null;
    }

    return value;
  };

  const enhanceShiftRequest = (rawRequest = {}) => {
    if (!rawRequest) return rawRequest;
    const baseRequest = {
      ...rawRequest,
      isShift: true,
      clientLocation: rawRequest.clientLocation || rawRequest.location?.address || null,
      locationDetails: rawRequest.locationDetails || rawRequest.location || null,
      clientEmail: rawRequest.clientEmail || rawRequest.patient?.email || rawRequest.client?.email || null,
      clientPhone: rawRequest.clientPhone || rawRequest.patient?.phone || rawRequest.client?.phone || null,
      clientAddress: rawRequest.clientAddress || rawRequest.patient?.address || rawRequest.client?.address || null,
    };

    const normalizedStart = normalizeTimestamp(baseRequest.actualStartTime) || normalizeTimestamp(baseRequest.startedAt);
    const normalizedEnd = normalizeTimestamp(baseRequest.actualEndTime) || normalizeTimestamp(baseRequest.completedAt);

    return {
      ...baseRequest,
      requestDate: normalizeTimestamp(baseRequest.requestDate),
      approvedAt: normalizeTimestamp(baseRequest.approvedAt),
      deniedAt: normalizeTimestamp(baseRequest.deniedAt),
      createdAt: normalizeTimestamp(baseRequest.createdAt),
      updatedAt: normalizeTimestamp(baseRequest.updatedAt),
      startedAt: normalizedStart || null,
      actualStartTime: normalizedStart || null,
      completedAt: normalizedEnd || null,
      actualEndTime: normalizedEnd || null,
    };
  };

  // Load shift requests from API with AsyncStorage fallback
  const loadShiftRequests = async () => {
    // Loading shift requests
    
    // Don't make API calls if user is not authenticated
    if (!user) {
      // User not authenticated, skipping shift requests API call
      setShiftRequests([]);
      return;
    }
    
    // First, try to load from AsyncStorage to have data immediately
    let storedRequests = [];
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const requests = JSON.parse(stored);
        storedRequests = requests.map(enhanceShiftRequest);
        setShiftRequests(storedRequests);
        // Shift requests loaded from AsyncStorage
      } else {
        // No shift requests found in AsyncStorage
      }
    } catch (error) {
      console.error('Failed to load shift requests from storage:', error);
    }

    // Immediately try to get fresh data from API (don't wait for polling)
    setTimeout(() => refreshShiftRequests(), 100);

    // Then try to sync with API
    try {
      const role = user?.role;
      const userId = user?.id || user?.uid || null;

      const queryParams = (() => {
        if (!userId) return {};
        if (role === 'patient') return { clientId: userId };
        // Nurses need shiftRequests they are assigned to *and* shiftRequests where they are a backup coverage target.
        // Firestore doesn't support querying nested coverage arrays easily, and rules allow authenticated reads.
        // So fetch all shiftRequests for nurses and filter client-side.
        if (role === 'nurse') return {};
        if (role === 'admin' || role === 'superAdmin') return {};
        return { nurseId: userId };
      })();

      const response = await ApiService.getShiftRequests(queryParams);
      
      // Handle array response directly (ApiService returns array of docs)
      const shiftRequestsData = Array.isArray(response) ? response : (response?.success ? response.shiftRequests : []);
      
      if (shiftRequestsData) {
        // Ensure all shift requests have isShift property
        const shiftRequestsWithFlag = shiftRequestsData.map(enhanceShiftRequest);

        // Source of truth: if API returns an empty list, clear local cache.
        if (shiftRequestsWithFlag.length === 0) {
          setShiftRequests([]);
          setIsOnline(true);
          lastOfflineLogRef.current = 0;
          await saveShiftRequests([]);
          return;
        }
        
        // Only update if API has data OR if we had no local data
        if (shiftRequestsWithFlag.length > 0 || storedRequests.length === 0) {
          setShiftRequests(shiftRequestsWithFlag);
          setIsOnline(true);
          lastOfflineLogRef.current = 0;
          // Shift requests synced from API
          
          // Save to AsyncStorage as backup
          await saveShiftRequests(shiftRequestsWithFlag);
        } else {
          // API returned empty but we have local data - keep local data
          // API returned empty, keeping local shift requests
          setIsOnline(true);
        }
        return;
      }
    } catch (error) {
      // Silent fallback to offline mode
      const now = Date.now();
      if (now - lastOfflineLogRef.current > OFFLINE_LOG_THROTTLE) {
        lastOfflineLogRef.current = now;
        setIsOnline(false);
        // Using offline mode with cached shift requests
      }
    }
  };

  // Save shift requests to AsyncStorage
  const saveShiftRequests = async (requests) => {
    try {
      if (!requests || requests.length === 0) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        return;
      }

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
      // Only log saves when there's a meaningful change
      if (_lastSaveCount !== requests.length) {
        // Shift requests saved to AsyncStorage
        _lastSaveCount = requests.length;
      }
    } catch (error) {
      console.error('Failed to save shift requests:', error);
    }
  };

  // Refresh shift requests from API with storage fallback
  const refreshShiftRequests = async () => {
    // Don't make API calls if user is not authenticated
    if (!user) {
      return [];
    }
    
    // If we're offline and recently tried, skip API call
    const now = Date.now();
    // Force API call even if offline flag is set, to retry connection
    // if (!isOnline && now - lastOfflineLogRef.current < OFFLINE_LOG_THROTTLE) {
    //   // Silently use cached data when offline
    //   return shiftRequests;
    // }

    try {
      const role = user?.role;
      const userId = user?.id || user?.uid || null;

      const queryParams = (() => {
        if (!userId) return {};
        if (role === 'patient') return { clientId: userId };
        // Nurses need shiftRequests they are assigned to *and* shiftRequests where they are a backup coverage target.
        // Fetch all for nurse role and filter client-side.
        if (role === 'nurse') return {};
        if (role === 'admin' || role === 'superAdmin') return {};
        return { nurseId: userId };
      })();

      const response = await ApiService.getShiftRequests(queryParams);

      // Handle array response directly (ApiService returns array of docs)
      const shiftRequestsData = Array.isArray(response)
        ? response
        : (response?.success ? response.shiftRequests : []);

      const shiftRequestsWithFlag = Array.isArray(shiftRequestsData)
        ? shiftRequestsData.map(enhanceShiftRequest)
        : [];

      // Source of truth: if API returns an empty list, clear local cache.
      if (shiftRequestsWithFlag.length === 0) {
        setShiftRequests([]);
        setIsOnline(true);
        lastOfflineLogRef.current = 0;
        await saveShiftRequests([]);
        return [];
      }

      // If we were offline, mark as back online
      if (!isOnline) {
        setIsOnline(true);
        lastOfflineLogRef.current = 0;
      }

      const getRequestId = (item) => item?.id || item?._id || null;

      // Merge with existing state to preserve recently-updated fields
      const existingById = new Map(
        (Array.isArray(shiftRequests) ? shiftRequests : [])
          .map((item) => [getRequestId(item), item])
          .filter(([id]) => Boolean(id))
      );

      const merged = shiftRequestsWithFlag.map((freshItem) => {
        const id = getRequestId(freshItem);
        const existing = id ? existingById.get(id) : null;
        if (!existing) return freshItem;

        const next = { ...freshItem };

        const preserveIfMissing = (field) => {
          if (Object.prototype.hasOwnProperty.call(next, field)) {
            if (typeof next[field] !== 'undefined') return;
          }
          if (typeof existing[field] === 'undefined' || existing[field] === null) return;
          next[field] = existing[field];
        };

        preserveIfMissing('actualStartTime');
        preserveIfMissing('startedAt');
        preserveIfMissing('clockInLocation');
        preserveIfMissing('clockInCapturedAt');
        preserveIfMissing('actualEndTime');
        preserveIfMissing('completedAt');
        preserveIfMissing('clockOutLocation');
        preserveIfMissing('clockOutCapturedAt');

        return next;
      });

      setShiftRequests(merged);
      await saveShiftRequests(merged); // Keep local backup
      return merged;
    } catch (error) {
      // Silent fallback to offline mode
      if (now - lastOfflineLogRef.current > OFFLINE_LOG_THROTTLE) {
        lastOfflineLogRef.current = now;
        setIsOnline(false);
      }
    }
    
    // Fallback to local refresh - don't log every poll
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const requests = JSON.parse(stored).map(enhanceShiftRequest);
        setShiftRequests(requests);
        return requests;
      }
    } catch (error) {
      console.error('Failed to refresh shift requests:', error);
    }
    return [];
  };

  // Load data on initialization and when user changes
  useEffect(() => {
    if (user) {
      // Only log initial load, not every effect run
      if (!_shiftContextInitialized) {
        _shiftContextInitialized = true;
      }
      
      loadShiftRequests();
      
      // Set up smart polling - less aggressive to reduce log spam
      let pollCount = 0;
      const pollInterval = setInterval(() => {
        // Only log every 10th poll to reduce spam
        if (pollCount % 10 === 0) {

        }
        refreshShiftRequests();
        pollCount++;
      }, isOnline ? 60000 : 120000); // 1 minute when online, 2 minutes when offline
      
      // Set up fortnightly billing check (admin only, runs every 6 hours)
      let billingInterval;
      if (user.role === 'admin') {
        billingInterval = setInterval(() => {

          processFortnightlyBilling().catch(error => {
            console.error('Fortnightly billing check failed:', error);
          });
        }, 6 * 60 * 60 * 1000); // Check every 6 hours (less frequent)
      }
      
      return () => {
        clearInterval(pollInterval);
        if (billingInterval) {
          clearInterval(billingInterval);
        }
      };
    } else {
      // Reset initialization flag when user logs out
      _shiftContextInitialized = false;
    }
    // Don't clear data when user is temporarily unavailable - keep cached data
  }, [user?.id, user?.role, isOnline]); // Depend on user ID, role, and online status

  const submitShiftRequest = async (requestData) => {
    const sanitizedBackupNurses = Array.isArray(requestData?.backupNurses)
      ? requestData.backupNurses.map((nurse, index) => sanitizeForFirestore({
          priority: nurse?.priority ?? index + 1,
          ...nurse,
        }))
      : [];

    const safeRequestData = sanitizeForFirestore({
      ...requestData,
      backupNurses: sanitizedBackupNurses,
    });

    const normalizedStartTime = safeRequestData.startTime || safeRequestData.time;
    const normalizedEndTime = safeRequestData.endTime || safeRequestData.time;
    const normalizedAddress = safeRequestData.clientAddress || safeRequestData.address || safeRequestData.location?.address || 'TBD';
    const nowIso = new Date().toISOString();

    try {

      // Transform data to match Firestore format
      const isRecurring = safeRequestData.isRecurring === true ||
        (Array.isArray(safeRequestData.daysOfWeek) && safeRequestData.daysOfWeek.length > 0);
      const apiData = sanitizeForFirestore({
        nurseId: safeRequestData.nurseId || user?.id || null,
        nurseName: safeRequestData.nurseName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Assigned Nurse',
        nurseCode: safeRequestData.nurseCode || user?.nurseCode || null,
        nurseEmail: safeRequestData.nurseEmail || user?.email || null,
        nursePhone: safeRequestData.nursePhone || user?.phone || null,
        clientId: safeRequestData.clientId || null,
        clientName: safeRequestData.clientName || null,
        clientEmail: safeRequestData.clientEmail || null,
        clientPhone: safeRequestData.clientPhone || null,
        clientAddress: normalizedAddress,
        service: safeRequestData.service,
        appointmentType: safeRequestData.service,
        date: safeRequestData.startDate || safeRequestData.date,
        startDate: safeRequestData.startDate || safeRequestData.date || null,
        endDate: safeRequestData.endDate || null,
        scheduledDate: safeRequestData.startDate || safeRequestData.date,
        scheduledTime: normalizedStartTime,
        startTime: normalizedStartTime,
        time: normalizedStartTime,
        endTime: normalizedEndTime,
        totalHours: safeRequestData.totalHours || null,
        notes: safeRequestData.notes || null,
        backupNurses: sanitizedBackupNurses,
        daysOfWeek: safeRequestData.daysOfWeek || [],
        isRecurring: isRecurring,
        recurringPattern: safeRequestData.recurringPattern || null,
        location: safeRequestData.location || { address: normalizedAddress },
        clientLocation: safeRequestData.clientLocation || safeRequestData.location?.address || normalizedAddress,
        locationDetails: safeRequestData.location || null,
        priority: safeRequestData.priority || 'medium',
        status: 'pending',
        requestDate: nowIso,
        isShift: true,
        adminRecurring: safeRequestData.adminRecurring || false,
      });
      

      const response = await ApiService.submitShiftRequest(apiData);
      
      if (response.success && response.shiftRequest) {

        setIsOnline(true);
        const shiftDoc = response.shiftRequest;
        const docId = shiftDoc.id || shiftDoc._id || `shift_${Date.now()}`;
        const resolvedDate = shiftDoc.date || shiftDoc.scheduledDate || apiData.date;
        const resolvedTime = shiftDoc.time || shiftDoc.startTime || shiftDoc.scheduledTime || apiData.time;
        const newRequest = {
          id: docId,
          nurseId: shiftDoc.nurseId || apiData.nurseId,
          nurseName: shiftDoc.nurseName || apiData.nurseName,
          clientId: shiftDoc.clientId || apiData.clientId,
          clientName: shiftDoc.clientName || apiData.clientName,
          clientEmail: shiftDoc.clientEmail || apiData.clientEmail,
          clientPhone: shiftDoc.clientPhone || apiData.clientPhone,
          clientAddress: shiftDoc.clientAddress || apiData.clientAddress,
          service: shiftDoc.service || apiData.service,
          date: resolvedDate,
          time: resolvedTime,
          startTime: shiftDoc.startTime || apiData.startTime,
          endTime: shiftDoc.endTime || apiData.endTime,
          totalHours: shiftDoc.totalHours || apiData.totalHours,
          location: shiftDoc.location || apiData.location,
          clientLocation: shiftDoc.clientLocation || apiData.clientLocation,
          locationDetails: shiftDoc.locationDetails || apiData.locationDetails,
          notes: shiftDoc.notes || apiData.notes,
          backupNurses: shiftDoc.backupNurses || apiData.backupNurses || [],
          status: shiftDoc.status || 'pending',
          requestedAt: shiftDoc.requestDate || shiftDoc.createdAt || apiData.requestDate,
          approvedBy: shiftDoc.approvedBy || null,
          approvedAt: shiftDoc.approvedAt || null,
          isShift: true,
        };
        
        // Update local state and storage
        setShiftRequests(prev => {
          const updated = [newRequest, ...prev];
          saveShiftRequests(updated);
          return updated;
        });
        
        // Send notification to admin
        try {
          await sendNotificationToUser(
            'admin-001',
            'admin',
            'New Shift Request',
            `${newRequest.nurseName} has requested a ${newRequest.service} shift for ${newRequest.date} at ${newRequest.time}`,
            {
              shiftRequestId: newRequest.id,
              nurseId: newRequest.nurseId,
              type: 'shift_request'
            }
          );
        } catch (notifError) {
          console.error('Failed to send shift request notification:', notifError);
        }
        
        // Immediate refresh to ensure data is synced
        setTimeout(() => {

          refreshShiftRequests();
        }, 500);
        
        return newRequest;
      }
    } catch (error) {

      setIsOnline(false);
    }
    
    // Fallback to local storage
    const newRequest = {
      id: `shift_${Date.now()}`,
      ...safeRequestData,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
      clientId: safeRequestData.clientId || null,
      clientName: safeRequestData.clientName || null,
      isShift: true,
      clientLocation: safeRequestData.location?.address || null,
      locationDetails: safeRequestData.location || null,
      backupNurses: sanitizedBackupNurses,
    };
    
    setShiftRequests(prev => {
      const updated = [newRequest, ...prev];
      // console.log('✅ NURSE: Added shift request locally. Total requests:', updated.length);
      // console.log('📝 NURSE: New request details:', {
      //   id: newRequest.id,
      //   nurseId: newRequest.nurseId,
      //   service: newRequest.service,
      //   date: newRequest.date,
      //   status: newRequest.status
      // });
      // Save to AsyncStorage
      saveShiftRequests(updated);
      return updated;
    });

    // Send notification to admin
    try {
      await sendNotificationToUser(
        'admin-001',
        'admin',
        'New Shift Request',
        `${newRequest.nurseName || user?.firstName + ' ' + user?.lastName} has requested a ${newRequest.service} shift for ${newRequest.date} at ${newRequest.time}`,
        {
          shiftRequestId: newRequest.id,
          nurseId: newRequest.nurseId,
          type: 'shift_requested'
        }
      );
    } catch (notifError) {
      console.error('Failed to send shift request notification:', notifError);
    }

    // Immediate refresh to sync with server
    setTimeout(() => {
      // console.log('🔄 Immediate refresh after local shift request submission...');
      refreshShiftRequests();
    }, 500);

    return newRequest;
  };

  const approveShiftRequest = async (requestId, adminId) => {
    const getBackupNotificationTargets = (request) => {
      const list = Array.isArray(request?.backupNurses) ? request.backupNurses : [];
      if (!list.length) return [];
      return list
        .map((backup, index) => ({
          id: backup?.nurseId || backup?.id || backup?.uid || null,
          priority: index + 1,
        }))
        .filter((entry) => entry.id);
    };

    const formatDateLabel = (value) => {
      if (!value) return '';
      if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (typeof value === 'object' && typeof value.seconds === 'number') {
        return new Date(value.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (typeof value === 'object' && typeof value._seconds === 'number') {
        return new Date(value._seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
              return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
          }
        }
      }
      
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return value;
    };
    try {
      // console.log('📡 Approving shift request via API:', requestId);
      
      const response = await ApiService.approveShiftRequest(requestId);
      
      if (response.success && response.shiftRequest) {
        // console.log('✅ Shift request approved successfully via API');
        setIsOnline(true);
        
        // Update local state
        setShiftRequests(prev => {
          const updated = prev.map(request => 
            request.id === requestId 
              ? {
                  ...request,
                  status: 'approved',
                  approvedBy: adminId,
                  approvedAt: response.shiftRequest.approvedAt,
                  backupNursesNotified: Array.isArray(request?.backupNurses)
                    ? request.backupNurses
                        .map((backup) => (
                          backup?.nurseId ||
                          backup?.id ||
                          backup?.staffCode ||
                          backup?.nurseCode ||
                          backup?.code ||
                          backup?.username ||
                          null
                        ))
                        .filter(Boolean)
                    : request.backupNursesNotified || []
                }
              : request
          );
          saveShiftRequests(updated);
          return updated;
        });

        // Send notification to nurse about approval
        const approvedRequest = shiftRequests.find(request => request.id === requestId);
        if (approvedRequest) {
          try {
            await sendNotificationToUser(
              approvedRequest.nurseId,
              'nurse',
              'Shift Request Approved',
              `Your ${approvedRequest.service} shift request for ${approvedRequest.date} at ${approvedRequest.time} has been approved!`,
              {
                shiftRequestId: requestId,
                type: 'shift_approved'
              }
            );
            // console.log('✅ Sent approval notification to nurse:', approvedRequest.nurseId);
          } catch (notifError) {
            console.error('Failed to send shift approval notification:', notifError);
          }

          if (typeof sendNotificationToUser === 'function') {
            const targets = getBackupNotificationTargets(approvedRequest);
            if (targets.length) {
              const dateLabel = formatDateLabel(approvedRequest.startDate || approvedRequest.date);
              const timeWindow = `${approvedRequest.startTime || approvedRequest.time || ''} - ${approvedRequest.endTime || ''}`.trim();
              const clientName = approvedRequest.clientName || approvedRequest.patientName || 'Client';
              const serviceTitle = approvedRequest.service || 'Care';

              await Promise.allSettled(
                targets.map((target) =>
                  sendNotificationToUser(
                    target.id,
                    'nurse',
                    'Emergency backup assignment',
                    `You are priority ${target.priority} backup for ${clientName} (${serviceTitle}) on ${dateLabel || 'the scheduled date'}${timeWindow ? ` (${timeWindow})` : ''}.`,
                    {
                      type: 'backup_nurse_assignment',
                      shiftRequestId: requestId,
                      clientId: approvedRequest.clientId || null,
                      priority: target.priority,
                      service: serviceTitle,
                      date: approvedRequest.startDate || approvedRequest.date || null,
                      startTime: approvedRequest.startTime || approvedRequest.time || null,
                      endTime: approvedRequest.endTime || null,
                    }
                  )
                )
              );
            }
          }
        }
        
        // Refresh data to get latest from API
        await refreshShiftRequests();
        return;
      }
    } catch (error) {
      // console.log('🔴 API approval failed, using local storage:', error.message);
      setIsOnline(false);
    }
    
    // Fallback to local storage
    const approvedRequest = shiftRequests.find(request => request.id === requestId);
    setShiftRequests(prev => {
      const updated = prev.map(request => 
        request.id === requestId 
          ? {
              ...request,
              status: 'approved',
              approvedBy: adminId,
              approvedAt: new Date().toISOString(),
              backupNursesNotified: Array.isArray(request?.backupNurses)
                ? request.backupNurses
                    .map((backup) => (
                      backup?.nurseId ||
                      backup?.id ||
                      backup?.staffCode ||
                      backup?.nurseCode ||
                      backup?.code ||
                      backup?.username ||
                      null
                    ))
                    .filter(Boolean)
                : request.backupNursesNotified || []
            }
          : request
      );
      // Save to AsyncStorage
      saveShiftRequests(updated);
      return updated;
    });

    // Send notification to nurse about approval (local fallback)
    if (approvedRequest) {
      try {
        await sendNotificationToUser(
          approvedRequest.nurseId,
          'nurse',
          'Shift Request Approved',
          `Your ${approvedRequest.service} shift request for ${approvedRequest.date} at ${approvedRequest.time} has been approved!`,
          {
            shiftRequestId: requestId,
            type: 'shift_approved'
          }
        );
        // console.log('✅ Sent approval notification to nurse (local):', approvedRequest.nurseId);
      } catch (notifError) {
        console.error('Failed to send shift approval notification (local):', notifError);
      }

      if (typeof sendNotificationToUser === 'function') {
        const targets = getBackupNotificationTargets(approvedRequest);
        if (targets.length) {
          const dateLabel = formatDateLabel(approvedRequest.startDate || approvedRequest.date);
          const timeWindow = `${approvedRequest.startTime || approvedRequest.time || ''} - ${approvedRequest.endTime || ''}`.trim();
          const clientName = approvedRequest.clientName || approvedRequest.patientName || 'Client';
          const serviceTitle = approvedRequest.service || 'Care';

          await Promise.allSettled(
            targets.map((target) =>
              sendNotificationToUser(
                target.id,
                'nurse',
                'Emergency backup assignment',
                `You are priority ${target.priority} backup for ${clientName} (${serviceTitle}) on ${dateLabel || 'the scheduled date'}${timeWindow ? ` (${timeWindow})` : ''}.`,
                {
                  type: 'backup_nurse_assignment',
                  shiftRequestId: requestId,
                  clientId: approvedRequest.clientId || null,
                  priority: target.priority,
                  service: serviceTitle,
                  date: approvedRequest.startDate || approvedRequest.date || null,
                  startTime: approvedRequest.startTime || approvedRequest.time || null,
                  endTime: approvedRequest.endTime || null,
                }
              )
            )
          );
        }
      }
    }
  };

  const denyShiftRequest = async (requestId, adminId, reason = '') => {
    try {
      // console.log('📡 Denying shift request via API:', requestId);
      
      const response = await ApiService.denyShiftRequest(requestId, reason);
      
      if (response.success) {
        // console.log('✅ Shift request denied and deleted successfully via API');
        setIsOnline(true);
        
        // Remove from local state
        setShiftRequests(prev => {
          const updated = prev.filter(request => request.id !== requestId);
          saveShiftRequests(updated);
          return updated;
        });
        
        // Refresh data to get latest from API
        await refreshShiftRequests();
        return;
      }
    } catch (error) {
      // console.log('🔴 API denial failed, using local storage:', error.message);
      setIsOnline(false);
    }
    
    // Fallback to local storage - remove the request
    setShiftRequests(prev => {
      const updated = prev.filter(request => request.id !== requestId);
      // Save to AsyncStorage
      saveShiftRequests(updated);
      return updated;
    });
  };

  // Nurse cancels their own pending shift request
  const cancelShiftRequest = async (requestId, reason = 'Cancelled by nurse') => {
    try {
      // Delete the shift request from database
      await ApiService.deleteShiftRequest(requestId);
      
      setIsOnline(true);
      setShiftRequests(prev => {
        const next = prev.filter(req => req.id !== requestId);
        saveShiftRequests(next);
        return next;
      });
      await refreshShiftRequests();
      return { success: true };
    } catch (error) {
      console.error('Error deleting shift request:', error);
      setIsOnline(false);
    }

    // Fallback to local storage - remove from local state
    setShiftRequests(prev => {
      const updated = prev.filter(req => req.id !== requestId);
      saveShiftRequests(updated);
      return updated;
    });
    return { success: true };
  };

  // Update an existing shift request (used for rescheduling)
  const updateShiftRequestDetails = async (requestId, updates = {}) => {
    try {
      const updated = await ApiService.updateShiftRequest(requestId, {
        ...updates,
      });

      if (updated) {
        setIsOnline(true);
        setShiftRequests(prev => {
          const next = prev.map(req => req.id === requestId ? { ...req, ...updated } : req);
          saveShiftRequests(next);
          return next;
        });
        await refreshShiftRequests();
        return { success: true, shiftRequest: updated, id: updated.id || requestId };
      }
    } catch (error) {
      setIsOnline(false);
    }

    // Fallback to local storage
    setShiftRequests(prev => {
      const next = prev.map(req => req.id === requestId ? { ...req, ...updates } : req);
      saveShiftRequests(next);
      return next;
    });
    return { success: true, id: requestId };
  };

  const getPendingShiftRequests = () => {
    const pending = shiftRequests.filter(request => request.status === 'pending');
    return pending;
  };

  // Track pending count changes in useEffect instead of during render
  useEffect(() => {
    const pending = shiftRequests.filter(request => request.status === 'pending');
    
    // Only log when pending count changes
    if (pending.length !== lastPendingCount) {
      // console.log('🔍 Getting pending shift requests:', pending.length, 'out of total:', shiftRequests.length);
      if (pending.length > 0) {
        // console.log('📋 Pending requests:', pending.map(r => ({ id: r.id, nurseId: r.nurseId, service: r.service })));
      }
      setLastPendingCount(pending.length);
    }
  }, [shiftRequests, lastPendingCount]);

  const getShiftRequestsByNurse = (nurseId) => {
    return shiftRequests.filter(request => {
      // Robust comparison for IDs (handle string/object differences)
      const rId = request.nurseId ? request.nurseId.toString() : '';
      const nId = nurseId ? nurseId.toString() : '';
      return rId === nId;
    });
  };

  const getApprovedShiftsByNurse = (nurseId) => {
    return shiftRequests.filter(request => 
      request.nurseId === nurseId && request.status === 'approved'
    );
  };

  // Function to start a shift (when nurse clocks in)
  const startShift = async (shiftId, startTime, nurseId, metadata = {}) => {
    const requestedStartTime = startTime || new Date().toISOString();
    const clockInLocation = metadata.clockInLocation || null;

    const dateKeyFromTime = (value) => {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value);
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const upsertClockSession = (sessions, patch) => {
      const base = Array.isArray(sessions) ? [...sessions] : [];
      const dayKey = patch?.dayKey || dateKeyFromTime(patch?.clockInTime || patch?.clockOutTime);
      const nextPatch = { ...patch, ...(dayKey ? { dayKey } : {}) };

      for (let i = base.length - 1; i >= 0; i--) {
        const s = base[i];
        if (!s || typeof s !== 'object') continue;
        if (dayKey && s.dayKey && s.dayKey !== dayKey) continue;
        const hasIn = Boolean(s.clockInTime);
        const hasOut = Boolean(s.clockOutTime);
        if (hasIn && !hasOut) {
          base[i] = { ...s, ...nextPatch };
          return base.slice(-60);
        }
      }

      base.push(nextPatch);
      return base.slice(-60);
    };

    try {
      const response = await ApiService.startShift(shiftId, {
        startTime: requestedStartTime,
        nurseId,
        clockInLocation,
      });
      
      if (response.success) {
        console.log('💰 [Feb13] API response success:', {
          keepBooked: response.keepBooked,
          status: response.status,
        });
        setIsOnline(true);
        const resolvedStartTime = response.startTime || requestedStartTime;
        const resolvedLocation = response.clockInLocation || clockInLocation;
        const dayKey = dateKeyFromTime(resolvedStartTime);
        
        setShiftRequests(prev => {
          const updated = prev.map(request => 
            request.id === shiftId 
              ? { 
                  ...request, 
                  status: 'active', 
                  startedAt: resolvedStartTime,
                  actualStartTime: resolvedStartTime,
                  clockInLocation: resolvedLocation || request.clockInLocation || null,
                  startedBy: nurseId || request.startedBy || null,
                  clockByNurse: {
                    ...(request.clockByNurse || {}),
                    ...(nurseId
                      ? {
                          [nurseId]: {
                            ...((request.clockByNurse || {})[nurseId] || {}),
                            lastClockInTime: resolvedStartTime,
                            lastClockInCapturedAt: resolvedLocation?.timestamp || resolvedStartTime,
                            ...(resolvedLocation ? { lastClockInLocation: resolvedLocation } : {}),
                            clockEntries: upsertClockSession(
                              ((request.clockByNurse || {})[nurseId] || {}).clockEntries,
                              {
                                dayKey,
                                nurseId,
                                clockInTime: resolvedStartTime,
                                clockInLocation: resolvedLocation || null,
                                clockInCapturedAt: resolvedLocation?.timestamp || resolvedStartTime,
                              }
                            ),
                          },
                        }
                      : {}),
                  },
                  clockEntries: upsertClockSession(request.clockEntries, {
                    dayKey,
                    nurseId,
                    clockInTime: resolvedStartTime,
                    clockInLocation: resolvedLocation || null,
                    clockInCapturedAt: resolvedLocation?.timestamp || resolvedStartTime,
                  }),
                }
              : request
          );
          saveShiftRequests(updated);
          return updated;
        });
        
        return { startTime: resolvedStartTime, clockInLocation: resolvedLocation };
      }
    } catch (error) {
      setIsOnline(false);
    }
    
    setShiftRequests(prev => {
      const updated = prev.map(request => 
        request.id === shiftId 
          ? { 
              ...request, 
              status: 'active', 
              startedAt: requestedStartTime,
              actualStartTime: requestedStartTime,
              clockInLocation: clockInLocation || request.clockInLocation || null
            }
          : request
      );
      saveShiftRequests(updated);
      return updated;
    });

    return { startTime: requestedStartTime, clockInLocation };
  };

  // Function to complete a shift (when nurse clocks out)
  const completeShift = async (shiftId, endTime, hoursWorked, notes, nurseId, metadata = {}) => {
    console.log('💰 [Feb13] ===== CLOCK OUT STARTED =====', {
      shiftId,
      endTime,
      hoursWorked,
      nurseId,
      keepBooked: metadata.keepBooked,
    });
    
    const requestedEndTime = endTime || new Date().toISOString();
    const clockOutLocation = metadata.clockOutLocation || null;
    const keepBooked = Boolean(metadata.keepBooked);
    const normalizedNotes = typeof notes === 'string' ? notes : '';
    const trimmedNotes = normalizedNotes.trim();

    const dateKeyFromTime = (value) => {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value);
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const upsertClockSession = (sessions, patch) => {
      const base = Array.isArray(sessions) ? [...sessions] : [];
      const dayKey = patch?.dayKey || dateKeyFromTime(patch?.clockInTime || patch?.clockOutTime);
      const nextPatch = { ...patch, ...(dayKey ? { dayKey } : {}) };

      for (let i = base.length - 1; i >= 0; i--) {
        const s = base[i];
        if (!s || typeof s !== 'object') continue;
        if (dayKey && s.dayKey && s.dayKey !== dayKey) continue;
        const hasIn = Boolean(s.clockInTime);
        const hasOut = Boolean(s.clockOutTime);
        if (hasIn && !hasOut) {
          base[i] = { ...s, ...nextPatch };
          return base.slice(-60);
        }
      }

      base.push(nextPatch);
      return base.slice(-60);
    };

    const parseHours = (value) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };

    const appendNoteHistoryEntry = (history, recordedAt) => {
      if (!trimmedNotes) {
        return Array.isArray(history) ? history : [];
      }
      const timestamp = recordedAt || new Date().toISOString();
      const fallbackIdSeed = Date.parse(timestamp) || Date.now();
      const entryId = `note_${fallbackIdSeed}_${nurseId || 'nurse'}`;
      const base = Array.isArray(history) ? [...history] : [];
      if (!base.some((entry) => entry?.id === entryId)) {
        base.push({
          id: entryId,
          text: trimmedNotes,
          recordedAt: timestamp,
          recordedBy: nurseId || null,
        });
      }
      if (base.length > 50) {
        return base.slice(-50);
      }
      return base;
    };

    const shiftSnapshot = shiftRequests.find(r => r?.id === shiftId) || null;

    try {
      const response = await ApiService.completeShift(shiftId, hoursWorked, normalizedNotes, {
        endTime: requestedEndTime,
        nurseId,
        clockOutLocation,
        keepBooked,
      });
      
      if (response.success) {
        console.log('💰 [Feb13] Clock-out API response received, processing...', {
          keepBooked: response.keepBooked,
          status: response.status,
        });
        setIsOnline(true);
        const resolvedEndTime = response.endTime || requestedEndTime;
        const resolvedLocation = response.clockOutLocation || clockOutLocation;
        const dayKey = dateKeyFromTime(resolvedEndTime);
        const resolvedHours =
          typeof response.hoursWorked === 'number' ? response.hoursWorked : parseHours(hoursWorked);

        const effectiveKeepBooked =
          typeof response.keepBooked === 'boolean' ? response.keepBooked : keepBooked;
        const resolvedStatus = response.status || (effectiveKeepBooked ? 'approved' : 'completed');
        const isFinalCompletion = Boolean(response.isFinalCompletion);
        const resolvedNotesHistory = Array.isArray(response.notesHistory)
          ? response.notesHistory
          : appendNoteHistoryEntry(shiftSnapshot?.notesHistory, resolvedEndTime);
        
        setShiftRequests(prev => {
          const updated = prev.map(request => 
            request.id === shiftId 
              ? (effectiveKeepBooked
                  ? {
                      ...request,
                      status: 'approved',
                      lastCompletedAt: resolvedEndTime,
                      lastActualEndTime: resolvedEndTime,
                      lastHoursWorked: resolvedHours,
                      lastCompletionNotes: normalizedNotes,
                      lastClockOutLocation: resolvedLocation || request.clockOutLocation || null,
                      notesHistory: resolvedNotesHistory,
                      clockByNurse: {
                        ...(request.clockByNurse || {}),
                        ...(nurseId
                          ? {
                              [nurseId]: {
                                ...((request.clockByNurse || {})[nurseId] || {}),
                                lastClockOutTime: resolvedEndTime,
                                lastClockOutCapturedAt: resolvedLocation?.timestamp || resolvedEndTime,
                                lastHoursWorked: resolvedHours,
                                lastCompletionNotes: normalizedNotes,
                                ...(resolvedLocation ? { lastClockOutLocation: resolvedLocation } : {}),
                                clockEntries: upsertClockSession(
                                  ((request.clockByNurse || {})[nurseId] || {}).clockEntries,
                                  {
                                    dayKey,
                                    nurseId,
                                    clockOutTime: resolvedEndTime,
                                    clockOutLocation: resolvedLocation || null,
                                    clockOutCapturedAt: resolvedLocation?.timestamp || resolvedEndTime,
                                  }
                                ),
                              },
                            }
                          : {}),
                      },
                      clockEntries: upsertClockSession(request.clockEntries, {
                        dayKey,
                        nurseId,
                        clockOutTime: resolvedEndTime,
                        clockOutLocation: resolvedLocation || null,
                        clockOutCapturedAt: resolvedLocation?.timestamp || resolvedEndTime,
                      }),
                      completedAt: null,
                      actualEndTime: null,
                      startedAt: null,
                      actualStartTime: null,
                      startedBy: null,
                      completedBy: null,
                      clockInLocation: null,
                      clockOutLocation: null,
                    }
                  : { 
                      ...request, 
                      status: resolvedStatus,
                      completedAt: resolvedEndTime,
                      actualEndTime: resolvedEndTime,
                      hoursWorked: resolvedHours,
                      notesHistory: resolvedNotesHistory,
                      completionNotes: normalizedNotes,
                      clockOutLocation: resolvedLocation || request.clockOutLocation || null,
                      ...(isFinalCompletion ? { finalCompletedAt: resolvedEndTime } : {}),
                      clockByNurse: {
                        ...(request.clockByNurse || {}),
                        ...(nurseId
                          ? {
                              [nurseId]: {
                                ...((request.clockByNurse || {})[nurseId] || {}),
                                lastClockOutTime: resolvedEndTime,
                                lastClockOutCapturedAt: resolvedLocation?.timestamp || resolvedEndTime,
                                lastHoursWorked: resolvedHours,
                                lastCompletionNotes: normalizedNotes,
                                ...(resolvedLocation ? { lastClockOutLocation: resolvedLocation } : {}),
                                clockEntries: upsertClockSession(
                                  ((request.clockByNurse || {})[nurseId] || {}).clockEntries,
                                  {
                                    dayKey,
                                    nurseId,
                                    clockOutTime: resolvedEndTime,
                                    clockOutLocation: resolvedLocation || null,
                                    clockOutCapturedAt: resolvedLocation?.timestamp || resolvedEndTime,
                                  }
                                ),
                              },
                            }
                          : {}),
                      },
                      clockEntries: upsertClockSession(request.clockEntries, {
                        dayKey,
                        nurseId,
                        clockOutTime: resolvedEndTime,
                        clockOutLocation: resolvedLocation || null,
                        clockOutCapturedAt: resolvedLocation?.timestamp || resolvedEndTime,
                      }),
                    })
              : request
          );
          saveShiftRequests(updated);
          return updated;
        });

        const resolveOccurrenceDateKey = (raw) => {
          if (!raw) return null;
          // Prefer explicit shift date if it's already a date-only string.
          if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
          const d = new Date(raw);
          if (!Number.isFinite(d.getTime())) return null;
          const yyyy = String(d.getFullYear());
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        };

        // Invoice generation:
        // - For normal shifts: generate when actually completed (not kept booked).
        // - For split schedules: generate per-visit invoice once ALL nurses have clocked out,
        //   even if the schedule is kept booked for future occurrences.
        try {
          console.log('💰 [Feb13] Starting invoice check for shift:', shiftId);
          const latest = await ApiService.getShiftRequestById(shiftId);
          console.log('💰 [Feb13] Shift:', {
            service: latest?.service,
            date: latest?.date,
            recurringScheduleId: latest?.recurringScheduleId,
            nurseSchedule: latest?.nurseSchedule,
            visitInvoiceKeys: latest?.visitInvoiceKeys,
          });
          const alreadySent = Boolean(latest?.finalInvoiceSentAt);
          const alreadyGenerated = Boolean(latest?.finalInvoiceGeneratedAt || latest?.finalInvoiceId);

          const isSplitSchedule = (() => {
            const raw = latest || shiftSnapshot || {};
            if (String(raw?.assignmentType || '').toLowerCase() === 'split-schedule') return true;
            const schedule = raw?.nurseSchedule;
            if (schedule && typeof schedule === 'object' && Object.keys(schedule).length > 0) {
              const normalized = Object.values(schedule)
                .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
                .map((v) => String(v).trim().toUpperCase());
              const unique = new Set(normalized);
              if (unique.size > 1) return true;
            }
            const clockMap = raw?.clockByNurse;
            if (clockMap && typeof clockMap === 'object' && Object.keys(clockMap).length > 1) return true;
            const assigned = Array.isArray(raw?.assignedNurses) ? raw.assignedNurses : [];
            if (assigned.length > 1) return true;
            const serviceText = String(raw?.service || '').toLowerCase();
            if (serviceText.includes('split schedule')) return true;
            return false;
          })();

          const isRecurringShift = (() => {
            const raw = latest || shiftSnapshot || {};
            return Boolean(
              raw?.recurringScheduleId ||
                raw?.recurringPeriodStart ||
                raw?.recurringPeriodEnd ||
                raw?.recurringStartDate ||
                raw?.recurringEndDate ||
                raw?.recurringDaysOfWeekList ||
                raw?.recurringDaysOfWeek ||
                (!isSplitSchedule && raw?.nurseSchedule && typeof raw.nurseSchedule === 'object' && Object.keys(raw.nurseSchedule).length > 0)
            );
          })();

          // Only attempt per-visit invoices for TRUE split schedules (multiple nurses work same day)
          // Recurring shifts without split get one final invoice at the end of the period
          const shouldAttemptVisitInvoice = Boolean(isSplitSchedule);
          
          console.log('💰 [Feb13] Invoice conditions:', {
            isSplitSchedule,
            isRecurringShift,
            shouldAttemptVisitInvoice,
            effectiveKeepBooked,
            isFinalCompletion,
          });

          // For non-recurring, non-split shifts, skip invoice work when kept booked and not final.
          if (!shouldAttemptVisitInvoice && !isRecurringShift && effectiveKeepBooked && !isFinalCompletion) {
            console.log('💰 [Feb13] SKIPPED - not recurring/split and kept booked');
            // no-op
            return {
              endTime: resolvedEndTime,
              hoursWorked: resolvedHours,
              clockOutLocation: resolvedLocation,
              keepBooked: effectiveKeepBooked,
              status: resolvedStatus,
              isFinalCompletion,
              notesHistory: resolvedNotesHistory,
            };
          }

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

          const allSplitNursesClockedOut = (() => {
            if (!isSplitSchedule) return true;
            const clockMap = (latest || shiftSnapshot || {})?.clockByNurse;
            console.log('💰 [Feb13] clockByNurse map:', JSON.stringify(clockMap, null, 2));
            if (!clockMap || typeof clockMap !== 'object') return false;
            const entries = Object.values(clockMap).filter((v) => v && typeof v === 'object');
            console.log('💰 [Feb13] clockByNurse entries:', entries.length);
            if (entries.length < 2) return false;

            const hasClockIn = (entry) => {
              const inTime = entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
              return !!inTime && normalizeClockMs(inTime) !== null;
            };

            const isClockedOutEntry = (entry) => {
              const inTime = entry.lastClockInTime || entry.actualStartTime || entry.clockInTime || entry.startedAt;
              const outTime = entry.lastClockOutTime || entry.actualEndTime || entry.clockOutTime || entry.completedAt;
              if (!outTime) return false;
              const inMs = normalizeClockMs(inTime);
              const outMs = normalizeClockMs(outTime);
              if (!Number.isFinite(outMs)) return false;
              if (Number.isFinite(inMs)) return outMs > inMs;
              return true;
            };

            // Only check nurses who actually clocked in (backup coverage: original nurse may never clock in)
            const nursesWhoWorked = entries.filter(hasClockIn);
            console.log('💰 [Feb13] Nurses who clocked in:', nursesWhoWorked.length);
            
            // If no nurses clocked in, can't generate invoice yet
            if (nursesWhoWorked.length === 0) return false;
            
            const result = nursesWhoWorked.every((entry) => isClockedOutEntry(entry));
            entries.forEach((entry, idx) => {
              console.log(`💰 [Feb13] Entry ${idx}:`, {
                hasClockIn: hasClockIn(entry),
                clockedOut: isClockedOutEntry(entry),
                hasClockOut: !!entry.lastClockOutTime || !!entry.actualEndTime || !!entry.clockOutTime || !!entry.completedAt
              });
            });
            console.log('💰 [Feb13] allSplitNursesClockedOut result:', result);
            return { allClockedOut: result, nursesWhoWorked: nursesWhoWorked.length };
          })();
          
          // True split schedule = multiple nurses actually worked on this occurrence
          // Recurring with backup = only one nurse worked (others didn't clock in)
          const splitResult = typeof allSplitNursesClockedOut === 'object' ? allSplitNursesClockedOut : { allClockedOut: allSplitNursesClockedOut, nursesWhoWorked: isSplitSchedule ? 2 : 1 };
          const isTrueSplitSchedule = isSplitSchedule && splitResult.nursesWhoWorked > 1;
          const allNursesClockedOut = splitResult.allClockedOut;
          
          console.log('💰 [Feb13] Split schedule analysis:', {
            isSplitSchedule,
            isTrueSplitSchedule,
            nursesWhoWorked: splitResult.nursesWhoWorked,
            allNursesClockedOut
          });

            const occurrenceDateKey =
              dayKey ||
              resolveOccurrenceDateKey(
                latest?.date ||
                  shiftSnapshot?.date ||
                  latest?.startDate ||
                  shiftSnapshot?.startDate ||
                  resolvedEndTime
              );

            const visitInvoiceKey = occurrenceDateKey ? `${shiftId}:${occurrenceDateKey}` : `${shiftId}:${resolveOccurrenceDateKey(resolvedEndTime) || 'unknown'}`;

            const existingVisitKeys = Array.isArray(latest?.visitInvoiceKeys)
              ? latest.visitInvoiceKeys.map((v) => String(v))
              : [];
            const visitAlreadyGenerated = existingVisitKeys.includes(visitInvoiceKey);
            
            console.log('💰 [Feb13] Visit invoice key info:', {
              dayKey,
              occurrenceDateKey,
              visitInvoiceKey,
              existingVisitKeys,
              visitAlreadyGenerated,
              allNursesClockedOut,
            });
            
            console.log('💰 [Feb13] Visit invoice key:', {
              dayKey,
              occurrenceDateKey,
              visitInvoiceKey,
              existingVisitKeys,
              visitAlreadyGenerated,
              allNursesClockedOut,
            });
            const clientEmail =
              latest?.clientEmail ||
              latest?.patientEmail ||
              latest?.email ||
              latest?.clientSnapshot?.email ||
              latest?.patientSnapshot?.email ||
              shiftSnapshot?.clientEmail ||
              shiftSnapshot?.patientEmail ||
              shiftSnapshot?.email ||
              shiftSnapshot?.clientSnapshot?.email ||
              shiftSnapshot?.patientSnapshot?.email ||
              null;

            const clientName =
              latest?.clientName ||
              latest?.patientName ||
              latest?.clientSnapshot?.name ||
              latest?.patientSnapshot?.name ||
              shiftSnapshot?.clientName ||
              shiftSnapshot?.patientName ||
              shiftSnapshot?.clientSnapshot?.name ||
              shiftSnapshot?.patientSnapshot?.name ||
              'Client';

            // Final invoice: generate once at true completion.
            if (!effectiveKeepBooked && !alreadySent && !alreadyGenerated && (isFinalCompletion || !isSplitSchedule)) {
              const invoiceRes = await InvoiceService.createInvoice({
                ...(latest || shiftSnapshot || {}),
                id: shiftId,
                shiftRequestId: shiftId,
                clientName,
                patientName: clientName,
                ...(clientEmail ? { clientEmail, patientEmail: clientEmail } : {}),
                appointmentDate: resolvedEndTime,
                scheduledDate: resolvedEndTime,
                hoursWorked: resolvedHours,
              });

              if (invoiceRes?.success && invoiceRes?.invoice) {
                await ApiService.updateShiftRequest(shiftId, {
                  finalInvoiceId: invoiceRes.invoice.invoiceId,
                  finalInvoiceGeneratedAt: new Date().toISOString(),
                });

                if (clientEmail) {
                  const emailRes = await FirebaseEmailQueueService.enqueueInvoiceEmail({
                    to: clientEmail,
                    invoiceData: {
                      ...invoiceRes.invoice,
                      invoiceNumber: invoiceRes.invoice.invoiceId,
                      amount: invoiceRes.invoice.total,
                      clientName,
                    },
                    pdfUri: invoiceRes.invoice.pdfUri,
                    meta: { shiftRequestId: shiftId, kind: 'final' },
                  });

                  if (emailRes?.success) {
                    await ApiService.updateShiftRequest(shiftId, {
                      finalInvoiceSentAt: new Date().toISOString(),
                    });
                  }
                }
              }
            }

            // Per-visit invoice (TRUE split schedules only):
            // - Generate once ALL nurses (who actually worked) have clocked out for the visit.
            // - Recurring shifts without split get final invoice at period end only.
            console.log('💰 [Feb13] Creating per-visit invoice?', {
              isTrueSplitSchedule,
              allNursesClockedOut,
              visitAlreadyGenerated,
              willCreate: isTrueSplitSchedule && allNursesClockedOut && !visitAlreadyGenerated,
            });
            
            if (isTrueSplitSchedule && allNursesClockedOut && !visitAlreadyGenerated) {
              console.log('💰 [Feb13] CREATING invoice for:', visitInvoiceKey);
              const invoiceRes = await InvoiceService.createInvoice({
                ...(latest || shiftSnapshot || {}),
                id: visitInvoiceKey,
                relatedAppointmentId: visitInvoiceKey,
                appointmentId: visitInvoiceKey,
                visitKey: visitInvoiceKey,
                shiftRequestId: shiftId,
                clientName,
                patientName: clientName,
                ...(clientEmail ? { clientEmail, patientEmail: clientEmail } : {}),
                appointmentDate: occurrenceDateKey || resolvedEndTime,
                scheduledDate: occurrenceDateKey || resolvedEndTime,
                hoursWorked: resolvedHours,
              });

              if (invoiceRes?.success && invoiceRes?.invoice) {
                console.log('💰 [Feb13] Invoice created:', invoiceRes.invoice.invoiceId);
                await ApiService.updateShiftRequest(shiftId, {
                  visitInvoiceKeys: [...existingVisitKeys, visitInvoiceKey],
                  lastVisitInvoiceId: invoiceRes.invoice.invoiceId,
                  lastVisitInvoiceGeneratedAt: new Date().toISOString(),
                  lastVisitInvoiceKey: visitInvoiceKey,
                });
                console.log('💰 [Feb13] Shift updated with invoice key');
              } else {
                console.log('💰 [Feb13] Invoice creation FAILED:', invoiceRes?.error);
              }
            } else {
              console.log('💰 [Feb13] Invoice creation SKIPPED');
            }
        } catch (invoiceError) {
          console.warn('Final invoice trigger failed:', invoiceError?.message || invoiceError);
        }
        
        return {
          endTime: resolvedEndTime,
          hoursWorked: resolvedHours,
          clockOutLocation: resolvedLocation,
          keepBooked: effectiveKeepBooked,
          status: resolvedStatus,
          isFinalCompletion,
          notesHistory: resolvedNotesHistory,
        };
      }
    } catch (error) {
      setIsOnline(false);
    }
    
    const offlineNotesHistory = appendNoteHistoryEntry(shiftSnapshot?.notesHistory, requestedEndTime);

    setShiftRequests(prev => {
      const updated = prev.map(request => 
        request.id === shiftId 
          ? (keepBooked
              ? {
                  ...request,
                  status: 'approved',
                  lastCompletedAt: requestedEndTime,
                  lastActualEndTime: requestedEndTime,
                  lastHoursWorked: hoursWorked,
                  lastCompletionNotes: normalizedNotes,
                  lastClockOutLocation: clockOutLocation || request.clockOutLocation || null,
                  notesHistory: offlineNotesHistory,
                  completedAt: null,
                  actualEndTime: null,
                  startedAt: null,
                  actualStartTime: null,
                  startedBy: null,
                  completedBy: null,
                  clockInLocation: null,
                  clockOutLocation: null,
                }
              : { 
                  ...request, 
                  status: 'completed', 
                  completedAt: requestedEndTime,
                  actualEndTime: requestedEndTime,
                  hoursWorked: hoursWorked,
                  completionNotes: normalizedNotes,
                  notesHistory: offlineNotesHistory,
                  clockOutLocation: clockOutLocation || request.clockOutLocation || null
                })
          : request
      );
      
      const completedShift = updated.find(r => r.id === shiftId);
      if (completedShift && !keepBooked) {
        import('../utils/ShiftPayoutValidator').then(({ default: ShiftPayoutValidator }) => {
          ShiftPayoutValidator.validateShiftPayout(completedShift).catch(err => console.warn('Validation failed:', err));
        });
      }
      
      saveShiftRequests(updated);
      return updated;
    });

    return {
      endTime: requestedEndTime,
      hoursWorked,
      clockOutLocation,
      keepBooked,
      status: keepBooked ? 'approved' : 'completed',
      isFinalCompletion: false,
      notesHistory: offlineNotesHistory,
    };
  };

  // Update shift notes locally after a successful API save
  const updateShiftNotes = async (shiftId, notes) => {
    const normalizedNotes = typeof notes === 'string' ? notes : '';
    setShiftRequests(prev => {
      const updated = prev.map(request =>
        request.id === shiftId
          ? {
              ...request,
              notes: normalizedNotes,
              nurseNotes: normalizedNotes,
              completionNotes: request.completionNotes || ''
            }
          : request
      );
      saveShiftRequests(updated);
      return updated;
    });
  };

  // Process fortnightly billing for completed shifts
  const processFortnightlyBilling = async () => {
    try {
      // console.log('🧾 Processing fortnightly shift billing...');
      
      const completedShifts = shiftRequests.filter(shift => 
        shift.status === 'completed' && 
        shift.completedAt &&
        !shift.invoiced // Only shifts that haven't been invoiced yet
      );

      if (completedShifts.length === 0) {
        // console.log('ℹ️  No completed shifts to bill');
        return { success: true, invoicesGenerated: 0 };
      }

      // Group completed shifts by client and billing period
      const fortnightlyGroups = groupShiftsByFortnightlyPeriod(completedShifts);
      
      let invoicesGenerated = 0;
      
      for (const [clientKey, periodGroups] of Object.entries(fortnightlyGroups)) {
        for (const [period, shifts] of Object.entries(periodGroups)) {
          try {
            // Generate consolidated invoice for this client's fortnight
            const invoice = await generateFortnightlyInvoice(shifts, period);
            
            if (invoice.success) {
              // Mark shifts as invoiced
              await markShiftsAsInvoiced(shifts.map(s => s.id), invoice.invoice.invoiceId);
              invoicesGenerated++;
              
              // console.log(`✅ Generated fortnightly invoice ${invoice.invoice.invoiceId} for ${shifts[0].clientName} (${shifts.length} shifts)`);
            }
          } catch (error) {
            console.error(`❌ Failed to generate fortnightly invoice for ${clientKey}:`, error);
          }
        }
      }

      return { success: true, invoicesGenerated };
    } catch (error) {
      console.error('Error processing fortnightly billing:', error);
      return { success: false, error: error.message };
    }
  };

  // Group shifts by client and fortnightly billing periods
  const groupShiftsByFortnightlyPeriod = (shifts) => {
    const groups = {};
    
    shifts.forEach(shift => {
      const clientKey = shift.clientId || shift.clientName || 'unknown-client';
      const billingPeriod = getFortnightlyPeriod(shift.completedAt);
      
      if (!groups[clientKey]) {
        groups[clientKey] = {};
      }
      
      if (!groups[clientKey][billingPeriod]) {
        groups[clientKey][billingPeriod] = [];
      }
      
      groups[clientKey][billingPeriod].push(shift);
    });
    
    return groups;
  };

  // Calculate fortnightly billing period for a date
  const getFortnightlyPeriod = (dateStr) => {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    
    // Get the start of the year
    const yearStart = new Date(year, 0, 1);
    
    // Calculate days since start of year
    const daysSinceStart = Math.floor((date - yearStart) / (24 * 60 * 60 * 1000));
    
    // Calculate fortnightly period (14-day periods)
    const fortnightNumber = Math.floor(daysSinceStart / 14) + 1;
    
    // Calculate period start and end dates
    const periodStart = new Date(yearStart.getTime() + (fortnightNumber - 1) * 14 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() + 13 * 24 * 60 * 60 * 1000);
    
    return `${year}-F${fortnightNumber.toString().padStart(2, '0')}`; // e.g., "2024-F12"
  };

  // Generate consolidated invoice for fortnightly period
  const generateFortnightlyInvoice = async (shifts, period) => {
    try {
      if (!shifts || shifts.length === 0) {
        throw new Error('No shifts provided for invoice generation');
      }

      // Get client info from first shift
      const firstShift = shifts[0];
      const totalHours = shifts.reduce((sum, shift) => sum + (shift.hoursWorked || 0), 0);
      
      // Calculate period dates for display
      const [year, fortnightStr] = period.split('-F');
      const fortnightNumber = parseInt(fortnightStr);
      const yearStart = new Date(parseInt(year), 0, 1);
      const periodStart = new Date(yearStart.getTime() + (fortnightNumber - 1) * 14 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(periodStart.getTime() + 13 * 24 * 60 * 60 * 1000);
      
      const periodStartStr = periodStart.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
      const periodEndStr = periodEnd.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });

      // Create consolidated appointment data for invoice generation
      const consolidatedData = {
        id: `FORTNIGHT-${period}-${firstShift.clientId || Date.now()}`,
        clientName: firstShift.clientName || 'Shift Client',
        patientName: firstShift.clientName || 'Shift Client',
        email: firstShift.clientEmail || 'client@care.com',
        phone: firstShift.clientPhone || 'N/A',
        address: firstShift.clientAddress || 'Address on file',
        service: `Fortnightly Shift Services (${periodStartStr} - ${periodEndStr})`,
        serviceType: 'Shift Services',
        appointmentDate: periodEnd.toISOString(), // Use period end as service date
        hoursWorked: totalHours,
        nurseName: 'Various Nurses', // Multiple nurses may be involved
        isFortnightly: true,
        billingPeriod: period,
        shiftCount: shifts.length,
        // Add detailed breakdown
        shiftDetails: shifts.map(shift => ({
          date: shift.date,
          service: shift.service,
          nurseName: shift.nurseName,
          hours: shift.hoursWorked || 0,
          notes: shift.completionNotes
        }))
      };

      // Import InvoiceService dynamically
      const { default: InvoiceService } = await import('../services/InvoiceService');
      
      // Validate fortnightly billing calculations before generating invoice
      const { default: ShiftPayoutValidator } = await import('../utils/ShiftPayoutValidator');
      const validation = await ShiftPayoutValidator.validateFortnightlyBilling(shifts, period);
      
      // console.log('💰 Fortnightly billing validation:', {
      //   period,
      //   totalHours: validation.calculations?.totals?.totalHours,
      //   clientBilling: validation.calculations?.formatted?.totalClientBilling,
      //   nursePayout: validation.calculations?.formatted?.totalNursePayout,
      //   businessMargin: validation.calculations?.formatted?.businessMargin
      // });
      
      // Generate the invoice
      const result = await InvoiceService.createInvoice(consolidatedData);
      
      // If invoice was created successfully, automatically set up recurring schedule
      if (result.success) {
        try {
          // Create recurring schedule for 3-day advance delivery
          const recurringScheduleData = {
            clientId: firstShift.clientId || consolidatedData.id,
            clientName: consolidatedData.clientName,
            email: consolidatedData.email,
            serviceType: 'Fortnightly Shift Services',
            frequency: 'fortnightly', // Every 2 weeks
            isActive: true,
            lastSent: new Date().toISOString(), // Mark as sent
            nextScheduled: getNextFortnightlyDate(),
            createdAt: new Date().toISOString(),
            invoiceType: 'fortnightly_shift_billing'
          };
          
          // Add to recurring schedules for 3-day advance delivery
          await InvoiceService.setupRecurringInvoiceSchedule(recurringScheduleData, 'fortnightly');
          
          // console.log('📧 Recurring schedule created for 3-day advance delivery of fortnightly invoices');
        } catch (scheduleError) {
          console.warn('⚠️ Failed to create recurring schedule, but invoice was generated:', scheduleError);
          // Don't fail the entire process if scheduling fails
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error generating fortnightly invoice:', error);
      return { success: false, error: error.message };
    }
  };

  // Mark shifts as invoiced
  const markShiftsAsInvoiced = async (shiftIds, invoiceId) => {
    try {
      setShiftRequests(prev => {
        const updated = prev.map(shift => 
          shiftIds.includes(shift.id) 
            ? { ...shift, invoiced: true, invoiceId: invoiceId, invoicedAt: new Date().toISOString() }
            : shift
        );
        saveShiftRequests(updated);
        return updated;
      });
      
      // console.log(`📋 Marked ${shiftIds.length} shifts as invoiced with invoice ${invoiceId}`);
    } catch (error) {
      console.error('Error marking shifts as invoiced:', error);
    }
  };

  // Setup automatic fortnightly billing schedule
  const setupFortnightlyBilling = async (clientData) => {
    try {
      const { default: InvoiceService } = await import('../services/InvoiceService');
      
      const scheduleData = {
        clientId: clientData.id || clientData.clientId,
        clientName: clientData.name || clientData.clientName,
        email: clientData.email || clientData.clientEmail,
        serviceType: 'Shift Services',
        frequency: 'fortnightly', // Every 2 weeks
        isActive: true,
        lastProcessed: null,
        nextScheduled: getNextFortnightlyDate(),
        createdAt: new Date().toISOString(),
        billingSettings: {
          autoGenerate: true,
          consolidateShifts: true,
          includeShiftDetails: true,
          minHoursForBilling: 1 // Minimum hours to trigger billing
        }
      };

      // Save fortnightly billing schedule
      const existingSchedules = await getFortnightlySchedules();
      const updatedSchedules = existingSchedules.filter(s => s.clientId !== clientData.id);
      updatedSchedules.push(scheduleData);
      
      await AsyncStorage.setItem('@876_fortnightly_schedules', JSON.stringify(updatedSchedules));
      
      // console.log('📅 Fortnightly billing schedule set up for:', clientData.name);
      return scheduleData;
    } catch (error) {
      console.error('Error setting up fortnightly billing:', error);
      throw error;
    }
  };

  // Get next fortnightly billing date (every 2 weeks on Monday)
  const getNextFortnightlyDate = () => {
    const now = new Date();
    const daysToMonday = (8 - now.getDay()) % 7; // Days until next Monday (0 = Sunday)
    const nextMonday = new Date(now.getTime() + daysToMonday * 24 * 60 * 60 * 1000);
    
    // Add 14 days to get the fortnightly date
    const fortnightlyDate = new Date(nextMonday.getTime() + 14 * 24 * 60 * 60 * 1000);
    return fortnightlyDate.toISOString();
  };

  // Get fortnightly billing schedules
  const getFortnightlySchedules = async () => {
    try {
      const schedules = await AsyncStorage.getItem('@876_fortnightly_schedules');
      return schedules ? JSON.parse(schedules) : [];
    } catch (error) {
      console.error('Error getting fortnightly schedules:', error);
      return [];
    }
  };

  // Clear all shift requests
  const clearAllShiftRequests = async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      setShiftRequests([]);
      // console.log('✅ All shift requests cleared');
    } catch (error) {
      console.error('Failed to clear shift requests:', error);
    }
  };

  // Clear only completed shift requests
  const clearCompletedShiftRequests = async () => {
    try {
      const nonCompletedRequests = shiftRequests.filter(request => request.status !== 'completed');
      setShiftRequests(nonCompletedRequests);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nonCompletedRequests));
    } catch (error) {
      console.error('Failed to clear completed shift requests:', error);
    }
  };

  // Force refresh data from storage - useful for cross-device sync
  const forceRefresh = async () => {
    // console.log('🔄 Force refreshing shift data...');
    await loadShiftRequests();
  };

  const value = {
    shiftRequests,
    submitShiftRequest,
    approveShiftRequest,
    denyShiftRequest,
    cancelShiftRequest,
    updateShiftRequestDetails,
    getPendingShiftRequests,
    getShiftRequestsByNurse,
    getApprovedShiftsByNurse,
    startShift,
    completeShift,
    clearAllShiftRequests,
    clearCompletedShiftRequests,
    refreshShiftRequests,
    forceRefresh,
    // Fortnightly billing functions
    processFortnightlyBilling,
    setupFortnightlyBilling,
    getFortnightlySchedules,
    updateShiftNotes
  };

  return (
    <ShiftContext.Provider value={value}>
      {children}
    </ShiftContext.Provider>
  );
}

export function useShifts() {
  const context = useContext(ShiftContext);
  if (!context) {
    throw new Error('useShifts must be used within a ShiftProvider');
  }
  return context;
}