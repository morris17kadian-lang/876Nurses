import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import PushNotificationService from '../services/PushNotificationService';
import ApiService from '../services/ApiService';
import { COLORS } from '../constants';

const NotificationContext = createContext();

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushToken, setPushToken] = useState(null);
  const [pushPermissionStatus, setPushPermissionStatus] = useState('undetermined');

  const STORAGE_KEY = '@876_notifications';

  const READ_LEDGER_KEY = '@876_notifications_read_ledger';

  const getUserStorageKey = (userId) => `${STORAGE_KEY}_${userId}`;
  const getUserReadLedgerKey = (userId) => `${READ_LEDGER_KEY}_${userId}`;

  const toTimestampMillis = (value) => {
    if (!value) return 0;

    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }

    // Firestore Timestamp
    if (typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : 0;
      }

      const seconds =
        typeof value.seconds === 'number'
          ? value.seconds
          : typeof value._seconds === 'number'
            ? value._seconds
            : null;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        return Math.round(seconds * 1000);
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      // treat < 1e12 as seconds, else millis
      return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? Math.round(asNumber * 1000) : Math.round(asNumber);
      }
      const d = new Date(trimmed);
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }

    const d = new Date(value);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const sortNotificationsNewestFirst = (list) => {
    const arr = Array.isArray(list) ? [...list] : [];
    arr.sort((a, b) => {
      const aMs = toTimestampMillis(a?.timestamp);
      const bMs = toTimestampMillis(b?.timestamp);
      if (bMs !== aMs) return bMs - aMs;
      // Tie-breaker for stable ordering
      return String(b?.id || '').localeCompare(String(a?.id || ''));
    });
    return arr;
  };

  // Load notifications from storage
  const loadNotifications = async () => {
    if (!user?.id) return;
    
    try {
      const userKey = getUserStorageKey(user.id);
      const stored = await AsyncStorage.getItem(userKey);
      if (stored) {
        const notificationList = sortNotificationsNewestFirst(JSON.parse(stored));
        setNotifications(notificationList);
        updateUnreadCount(notificationList);

        // Best-effort: hydrate the read ledger from stored notifications
        try {
          const ledgerKey = getUserReadLedgerKey(user.id);
          const nextLedger = {};
          notificationList.forEach((n) => {
            if (n?.read || n?.isRead) {
              if (n.id) nextLedger[`id:${String(n.id)}`] = true;
              const legacyKey = `${n.title}|${n.message}|${n.data?.type || n.type}`;
              nextLedger[`legacy:${legacyKey}`] = true;

              const data = n?.data || {};
              const type = data?.type || n?.type || '';
              const ids = [
                data?.notificationId,
                data?.conversationId,
                data?.appointmentId,
                data?.shiftRequestId,
                data?.shiftId,
                data?.invoiceId,
                data?.orderId,
                data?.requestId,
                data?.assignmentId,
                data?.messageId,
              ]
                .filter(Boolean)
                .map((v) => String(v));
              const richKey = `${type}|${ids.join('|')}|${n?.title || ''}|${n?.message || ''}`;
              nextLedger[`rich:${richKey}`] = true;
            }
          });
          await AsyncStorage.mergeItem(ledgerKey, JSON.stringify(nextLedger));
        } catch (e) {
          // Ignore ledger hydration errors
        }
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  // Refresh notifications from storage (used to detect new notifications from other sources)
  const refreshNotifications = async () => {
    if (!user?.id) return;
    
    try {
      // First try to fetch from Firebase
      try {
        const firebaseNotifs = await ApiService.getNotifications(user.id, { limit: 50 });
        if (Array.isArray(firebaseNotifs)) {
          // Get current local notifications to preserve read status
          // This prevents "unread" status from server overwriting local "read" status
          // before the server has processed the read update
          const userKey = getUserStorageKey(user.id);
          const storedLocal = await AsyncStorage.getItem(userKey);
          const localReadStatus = {};

          const notificationReadKey = (n) => {
            const data = n?.data || {};
            const type = data?.type || n?.type || '';

            const ids = [
              data?.notificationId,
              data?.conversationId,
              data?.appointmentId,
              data?.shiftRequestId,
              data?.shiftId,
              data?.invoiceId,
              data?.orderId,
              data?.requestId,
              data?.assignmentId,
              data?.messageId,
            ]
              .filter(Boolean)
              .map((v) => String(v));

            // Title/message are fallbacks (may be unstable); IDs in data are preferred.
            return `${type}|${ids.join('|')}|${n?.title || ''}|${n?.message || ''}`;
          };

          // Merge in the persisted read ledger first (most reliable)
          try {
            const ledgerKey = getUserReadLedgerKey(user.id);
            const ledgerRaw = await AsyncStorage.getItem(ledgerKey);
            if (ledgerRaw) {
              const ledger = JSON.parse(ledgerRaw);
              if (ledger && typeof ledger === 'object') {
                Object.keys(ledger).forEach((k) => {
                  if (ledger[k]) localReadStatus[k] = true;
                });
              }
            }
          } catch (e) {
            // Ignore ledger read errors
          }
          
          if (storedLocal) {
            try {
              const localList = JSON.parse(storedLocal);
              if (Array.isArray(localList)) {
                localList.forEach(n => {
                  if (n?.read || n?.isRead) {
                    if (n.id) localReadStatus[`id:${String(n.id)}`] = true;

                    // Title/message/type dedupe key (legacy fallback)
                    const legacyKey = `${n.title}|${n.message}|${n.data?.type || n.type}`;
                    localReadStatus[`legacy:${legacyKey}`] = true;

                    // More stable key using IDs embedded in data (preferred)
                    const richKey = notificationReadKey(n);
                    localReadStatus[`rich:${richKey}`] = true;
                  }
                });
              }
            } catch (e) {
              console.warn('Error parsing local notifications for read status preservation', e);
            }
          }

          const notificationList = firebaseNotifs.map(notif => {
            const id = notif.id?.toString() || (notif._id ? String(notif._id) : null) || `notif_${Date.now()}`;
            const legacyKey = `${notif.title}|${notif.message}|${notif.data?.type || notif.type}`;
            const richKey = notificationReadKey({
              id,
              title: notif.title,
              message: notif.message,
              type: notif.type,
              data: notif.data || {},
            });
            
            // Check if locally read
            const isLocallyRead =
              localReadStatus[`id:${id}`] ||
              localReadStatus[`rich:${richKey}`] ||
              localReadStatus[`legacy:${legacyKey}`];

            const isReadFromServer = Boolean(notif.isRead) || Boolean(notif.read);
            const isRead = Boolean(isLocallyRead || isReadFromServer);

            return {
              id: id,
              timestamp: notif.sentAt || notif.createdAt || new Date().toISOString(),
              read: isRead,
              isRead: isRead,
              title: notif.title,
              message: notif.message,
              type: notif.type || 'system',
              icon: 'bell-ring',
              color: '#6C5CE7',
              data: notif.data || {},
              pushSent: true
            };
          });
          
          // Deduplicate by title+message+type within 5 seconds - more robust than ID matching
          const deduplicatedNotifications = [];
          const seen = new Set();
          
          for (const notif of notificationList) {
            // Create a key based on title, message, and type
            const key = `${notif.title}|${notif.message}|${notif.data?.type || notif.type}`;
            if (!seen.has(key)) {
              seen.add(key);
              deduplicatedNotifications.push(notif);
            }
          }
          
          const sorted = sortNotificationsNewestFirst(deduplicatedNotifications);
          setNotifications(sorted);
          updateUnreadCount(sorted);
          
          // Also save to local storage for offline access
          await AsyncStorage.setItem(userKey, JSON.stringify(sorted));

          // Update the read ledger based on whatever is now considered read
          try {
            const ledgerKey = getUserReadLedgerKey(user.id);
            const nextLedger = {};
            sorted.forEach((n) => {
              if (n?.read || n?.isRead) {
                if (n.id) nextLedger[`id:${String(n.id)}`] = true;
                const legacyKey = `${n.title}|${n.message}|${n.data?.type || n.type}`;
                nextLedger[`legacy:${legacyKey}`] = true;
                const richKey = notificationReadKey(n);
                nextLedger[`rich:${richKey}`] = true;
              }
            });
            await AsyncStorage.mergeItem(ledgerKey, JSON.stringify(nextLedger));
          } catch (e) {
            // Ignore ledger write errors
          }
          return;
        }
      } catch (backendError) {
        // Firebase notification fetch failed, using local storage
      }
      
      // Fallback to local storage
      const userKey = getUserStorageKey(user.id);
      const stored = await AsyncStorage.getItem(userKey);
      if (stored) {
        let notificationList = JSON.parse(stored);
        
        // Deduplicate notifications in storage by ID
        notificationList = Array.from(
          new Map(notificationList.map(item => [item.id, item])).values()
        );

        notificationList = sortNotificationsNewestFirst(notificationList);
        
        // Only update if there are new notifications
        if (notificationList.length !== notifications.length || 
            (notificationList.length > 0 && notificationList[0].id !== notifications[0]?.id)) {
          
          // Check for new notifications (ones we haven't seen before)
          const newNotifications = notificationList.filter(newNotif => 
            !notifications.find(existing => existing.id === newNotif.id)
          );
          
          // Only send local push notifications for truly new notifications
          if (newNotifications.length > 0) {
            // Only log if we actually have new content (not just the same notifications)
            const hasNewContent = newNotifications.some(notif => !notif.pushSent);
            if (hasNewContent) {
              // Found new notifications
            }
            
            for (const newNotif of newNotifications) {
              try {
                // Only send push notification if we haven't already sent one for this notification
                if (!newNotif.pushSent) {
                  let permissionStatus = pushPermissionStatus;
                  if (permissionStatus !== 'granted') {
                    permissionStatus = await requestPushPermissions();
                  }
                  
                  await PushNotificationService.sendLocalNotification(
                    newNotif.title,
                    newNotif.message,
                    { notificationId: newNotif.id, ...newNotif.data }
                  );
                  
                  // Mark this notification as having had its push notification sent
                  newNotif.pushSent = true;
                  // Push notification sent
                }
              } catch (error) {
                console.error('Failed to send push notification for new message:', error);
              }
            }
            
            // Update storage with pushSent flags
            await AsyncStorage.setItem(userKey, JSON.stringify(notificationList));
          }
          
          setNotifications(notificationList);
          updateUnreadCount(notificationList);
        }
      }
    } catch (error) {
      console.error('Failed to refresh notifications:', error);
    }
  };

  // Save notifications to storage
  const saveNotifications = async (notificationList) => {
    if (!user?.id) return;
    
    try {
      const userKey = `${STORAGE_KEY}_${user.id}`;
      await AsyncStorage.setItem(userKey, JSON.stringify(notificationList));
    } catch (error) {
      console.error('Failed to save notifications:', error);
    }
  };

  // Initialize push notifications
  const initializePushNotifications = async () => {
    try {
      const token = await PushNotificationService.initialize();
      setPushToken(token);
      
      const status = await PushNotificationService.getPermissionStatus();
      setPushPermissionStatus(status);
    } catch (error) {
      console.error('Failed to initialize push notifications:', error);
    }
  };

  // Request push notification permissions
  const requestPushPermissions = async () => {
    try {
      const status = await PushNotificationService.requestPermissions();
      setPushPermissionStatus(status);
      
      if (status === 'granted') {
        const token = await PushNotificationService.initialize();
        setPushToken(token);
      }
      
      return status;
    } catch (error) {
      console.error('Failed to request push permissions:', error);
      return 'denied';
    }
  };

  // Update unread count
  const updateUnreadCount = (notificationList) => {
    // Filter notifications based on user role (same logic as NotificationsScreen)
    const userNotifications = notificationList.filter(notification => {
      return !notification.data?.targetRole || notification.data?.targetRole === user?.role;
    });
    
    const unread = userNotifications.filter(n => !n.read).length;
    setUnreadCount(unread);
    
    // Update app badge count for push notifications
    PushNotificationService.setBadgeCount(unread);
  };

  // Add new notification
  const addNotification = async (notificationData) => {
    const newNotification = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      read: false,
      ...notificationData,
    };

    // Deduplicate - check if this notification already exists
    const alreadyExists = notifications.some(notif => 
      notif.id === newNotification.id || 
      (notif.title === newNotification.title && 
       notif.message === newNotification.message &&
       Math.abs(new Date(notif.timestamp) - new Date(newNotification.timestamp)) < 1000) // Within 1 second
    );

    if (alreadyExists) {
      // console.log('⚠️ Notification already exists, skipping duplicate:', newNotification.title);
      return newNotification;
    }

    const updatedNotifications = sortNotificationsNewestFirst([newNotification, ...notifications]);
    setNotifications(updatedNotifications);
    updateUnreadCount(updatedNotifications);
    await saveNotifications(updatedNotifications);

    // Send local push notification - request permissions if needed
    try {
      let permissionStatus = pushPermissionStatus;
      if (permissionStatus !== 'granted') {
        // Requesting notification permissions for local notification
        permissionStatus = await requestPushPermissions();
      }
      
      // Send local notification
      await PushNotificationService.sendLocalNotification(
        newNotification.title,
        newNotification.message,
        { notificationId: newNotification.id, ...newNotification.data }
      );
      // Local notification sent
    } catch (error) {
      console.error('Failed to send local notification:', error);
    }

    return newNotification;
  };

  // Mark notification as read
  const markAsRead = async (notificationId) => {
    // Update local state
    const updatedNotifications = notifications.map(notification => 
      notification.id === notificationId 
        ? { ...notification, read: true, isRead: true }
        : notification
    );
    
    setNotifications(updatedNotifications);
    updateUnreadCount(updatedNotifications);
    await saveNotifications(updatedNotifications);

    // Persist to read ledger so refresh/polling cannot revert it
    try {
      if (user?.id) {
        const ledgerKey = getUserReadLedgerKey(user.id);
        const n = updatedNotifications.find((x) => x?.id === notificationId);
        if (n) {
          const data = n?.data || {};
          const type = data?.type || n?.type || '';
          const ids = [
            data?.notificationId,
            data?.conversationId,
            data?.appointmentId,
            data?.shiftRequestId,
            data?.shiftId,
            data?.invoiceId,
            data?.orderId,
            data?.requestId,
            data?.assignmentId,
            data?.messageId,
          ]
            .filter(Boolean)
            .map((v) => String(v));
          const richKey = `${type}|${ids.join('|')}|${n?.title || ''}|${n?.message || ''}`;
          const legacyKey = `${n.title}|${n.message}|${n.data?.type || n.type}`;
          const patch = {
            [`id:${String(notificationId)}`]: true,
            [`legacy:${legacyKey}`]: true,
            [`rich:${richKey}`]: true,
          };
          await AsyncStorage.mergeItem(ledgerKey, JSON.stringify(patch));
        }
      }
    } catch (e) {
      // Ignore ledger update errors
    }

    // Also update on backend (Firestore)
    try {
      await ApiService.markNotificationRead(notificationId);
    } catch (error) {
      console.warn('⚠️ Failed to mark notification as read in Firestore:', error.message);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    const updatedNotifications = notifications.map(notification => ({
      ...notification,
      read: true,
      isRead: true
    }));
    
    setNotifications(updatedNotifications);
    updateUnreadCount(updatedNotifications);
    await saveNotifications(updatedNotifications);

    // Persist all read keys into the ledger so refresh/polling cannot revert
    try {
      if (user?.id) {
        const ledgerKey = getUserReadLedgerKey(user.id);
        const patch = {};
        updatedNotifications.forEach((n) => {
          if (!n) return;
          if (n.id) patch[`id:${String(n.id)}`] = true;
          const legacyKey = `${n.title}|${n.message}|${n.data?.type || n.type}`;
          patch[`legacy:${legacyKey}`] = true;
          const data = n?.data || {};
          const type = data?.type || n?.type || '';
          const ids = [
            data?.notificationId,
            data?.conversationId,
            data?.appointmentId,
            data?.shiftRequestId,
            data?.shiftId,
            data?.invoiceId,
            data?.orderId,
            data?.requestId,
            data?.assignmentId,
            data?.messageId,
          ]
            .filter(Boolean)
            .map((v) => String(v));
          const richKey = `${type}|${ids.join('|')}|${n?.title || ''}|${n?.message || ''}`;
          patch[`rich:${richKey}`] = true;
        });
        await AsyncStorage.mergeItem(ledgerKey, JSON.stringify(patch));
      }
    } catch (e) {
      // Ignore ledger update errors
    }

    // Also update on backend (Firestore)
    try {
      const unreadIds = notifications
        .filter((n) => !n?.read)
        .map((n) => n.id)
        .filter(Boolean);

      if (unreadIds.length > 0) {
        await Promise.allSettled(unreadIds.map((id) => ApiService.markNotificationRead(id)));
      }
    } catch (error) {
      console.warn('⚠️ Failed to mark all notifications as read in Firestore:', error.message);
    }
  };

  // Delete notification
  const deleteNotification = async (notificationId) => {
    const updatedNotifications = notifications.filter(n => n.id !== notificationId);
    setNotifications(updatedNotifications);
    updateUnreadCount(updatedNotifications);
    await saveNotifications(updatedNotifications);
  };

  // Clear all notifications
  const clearAllNotifications = async () => {
    setNotifications([]);
    setUnreadCount(0);
    if (user?.id) {
      const userKey = `${STORAGE_KEY}_${user.id}`;
      await AsyncStorage.removeItem(userKey);
    }
  };

  // Clear notifications for a specific user (utility function)
  const clearNotificationsForUser = async (userId) => {
    try {
      const userKey = `${STORAGE_KEY}_${userId}`;
      await AsyncStorage.removeItem(userKey);
      // Cleared notifications for user
    } catch (error) {
      console.error('Failed to clear notifications for user:', error);
    }
  };

  // Clear all notifications for all users (testing utility)
  const clearAllUserNotifications = async () => {
    try {
      // Clear for common user IDs
      const userIds = ['NURSE001', 'ADMIN001', 'user_001'];
      await Promise.all(userIds.map(userId => clearNotificationsForUser(userId)));
      // Cleared all notifications for testing
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
    }
  };

  // Get relative time string
  const getRelativeTime = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return time.toLocaleDateString();
  };

  // Predefined notification types
  const NotificationTypes = {
    MESSAGE: {
      type: 'message',
      icon: 'message-text',
      color: '#4ECDC4',
    },
    APPOINTMENT: {
      type: 'appointment',
      icon: 'calendar-clock',
      color: '#FFD93D',
    },
    REMINDER: {
      type: 'reminder',
      icon: 'bell-ring',
      color: COLORS.accent,
    },
    SERVICE: {
      type: 'service',
      icon: 'medical-bag',
      color: '#95E1D3',
    },
    SYSTEM: {
      type: 'system',
      icon: 'information',
      color: '#6C5CE7',
    },
    ALERT: {
      type: 'alert',
      icon: 'alert-circle',
      color: '#FF7675',
    },
  };

  // Helper functions to create specific notification types
  const createMessageNotification = (senderName, message, conversationId) => {
    return addNotification({
      ...NotificationTypes.MESSAGE,
      title: `New message from ${senderName}`,
      message: message.length > 50 ? `${message.substring(0, 50)}...` : message,
      data: { conversationId, type: 'chat' },
    });
  };

  const createAppointmentNotification = (title, message, appointmentData) => {
    // Only create notifications for the current user (no cross-user targeting)
    return addNotification({
      ...NotificationTypes.APPOINTMENT,
      title,
      message,
      data: { ...appointmentData, type: 'appointment' },
    });
  };

  const createReminderNotification = (title, message, reminderData) => {
    return addNotification({
      ...NotificationTypes.REMINDER,
      title,
      message,
      data: { ...reminderData, type: 'reminder' },
    });
  };

  const createServiceNotification = (title, message, serviceData) => {
    return addNotification({
      ...NotificationTypes.SERVICE,
      title,
      message,
      data: { ...serviceData, type: 'service' },
    });
  };

  const createSystemNotification = (title, message, systemData) => {
    // Route system notifications based on targetRole
    const targetRole = systemData?.targetRole;
    
    if (targetRole && targetRole !== user?.role) {
      return Promise.resolve(); // Don't show to users not in target role
    }
    
    // Show assignment notifications to nurses only
    if (systemData?.type === 'assignment_received' && user?.role !== 'nurse') {
      return Promise.resolve();
    }
    
    // Show assignment accepted/declined notifications to admins only
    if ((systemData?.type === 'assignment_accepted' || systemData?.type === 'assignment_declined') && user?.role !== 'admin') {
      return Promise.resolve();
    }
    
    return addNotification({
      ...NotificationTypes.SYSTEM,
      title,
      message,
      data: { ...systemData, type: 'system' },
    });
  };

  const createAlertNotification = (title, message, alertData) => {
    return addNotification({
      ...NotificationTypes.ALERT,
      title,
      message,
      data: { ...alertData, type: 'alert' },
    });
  };

  // Schedule appointment reminder notifications
  const scheduleAppointmentReminder = async (appointmentTitle, appointmentTime, reminderMinutes = 30) => {
    const reminderTime = new Date(appointmentTime);
    reminderTime.setMinutes(reminderTime.getMinutes() - reminderMinutes);

    if (reminderTime > new Date()) {
      await PushNotificationService.scheduleNotification(
        'Appointment Reminder',
        `${appointmentTitle} in ${reminderMinutes} minutes`,
        reminderTime,
        { type: 'appointment', appointmentTime: appointmentTime.toISOString() }
      );
    }
  };

  // Send cross-user notification (simplified for demo - would require backend in real app)
  const sendNotificationToUser = async (targetUserId, targetRole, title, message, data = {}) => {
    try {
      let backendSuccess = false;

      // All authenticated users can create notifications in Firestore per security rules.
      // The previous admin-only gate meant nurse→nurse notifications (e.g. backup coverage
      // requests) were only written to AsyncStorage on the sender's device and never reached
      // the recipient on their own device.
      try {
        const result = await ApiService.sendNotification({
          userId: targetUserId,
          title,
          message,
          type: data.type || 'general',
          data,
          sentAt: new Date().toISOString()
        });

        if (result && result.id) {
          backendSuccess = true;
          return result;
        }
      } catch (apiError) {
        // Non-fatal; fall back to local storage
        console.warn('Failed to send notification via Firebase (fallback to local):', apiError?.message || apiError);
      }

      // Only save locally if Firestore write failed (to avoid duplicates)
      if (backendSuccess) {
        return null;
      }

      const targetUserKey = `${STORAGE_KEY}_${targetUserId}`;

      const existingNotifications = await AsyncStorage.getItem(targetUserKey);
      let notificationList = existingNotifications ? JSON.parse(existingNotifications) : [];
      
      // Check if this exact notification already exists (deduplicate)
      const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const alreadyExists = notificationList.some(notif => 
        notif.title === title && 
        notif.message === message && 
        notif.data?.type === data.type &&
        Math.abs(new Date(notif.timestamp) - new Date()) < 60000 // Within 60 seconds (increased window)
      );
      
      if (alreadyExists) {
        return null;
      }
      
      // Determine notification type based on data.type or default to SYSTEM
      let notificationType = NotificationTypes.SYSTEM;
      if (data.type === 'shift_request' || data.type === 'shift_approved' || data.type === 'shift_denied') {
        notificationType = NotificationTypes.APPOINTMENT;
      } else if (data.type === 'appointment_approved' || data.type === 'appointment_assigned') {
        notificationType = NotificationTypes.APPOINTMENT;
      } else if (data.type === 'chat') {
        notificationType = NotificationTypes.MESSAGE;
      }
      
      const newNotification = {
        id: notificationId,
        timestamp: new Date().toISOString(),
        read: false,
        title,
        message,
        ...notificationType,
        data: { ...data, targetRole },
        pushSent: false
      };
      
      const updatedNotifications = [newNotification, ...notificationList];
      
      // Deduplicate the entire list by ID
      const deduplicatedNotifications = Array.from(
        new Map(updatedNotifications.map(item => [item.id, item])).values()
      );
      
      await AsyncStorage.setItem(targetUserKey, JSON.stringify(deduplicatedNotifications));
      
      // Also store in global pool for better cross-device sync
      try {
        const globalNotificationKey = `@876_notifications_global`;
        const globalNotifications = await AsyncStorage.getItem(globalNotificationKey);
        let allNotifications = globalNotifications ? JSON.parse(globalNotifications) : [];
        
        // Check if this notification is already in global pool
        const alreadyInGlobal = allNotifications.some(notif =>
          notif.title === title &&
          notif.message === message &&
          notif.targetUserId === targetUserId
        );
        
        if (!alreadyInGlobal) {
          allNotifications.push({
            ...newNotification,
            targetUserId,
            targetRole,
            sentAt: new Date().toISOString()
          });
          await AsyncStorage.setItem(globalNotificationKey, JSON.stringify(allNotifications));
          // console.log('📨 Notification stored in global pool for cross-device sync');
        }
      } catch (globalError) {
        console.error('Failed to store in global notification pool:', globalError);
      }
      
      // console.log(`📨 Notification sent to ${targetUserId}:`, { title, type: data.type });
      
      // If this is for the current user, also send a local push notification
      if (targetUserId === user?.id) {
        try {
          // First ensure we have permissions for local notifications
          let permissionStatus = pushPermissionStatus;
          if (permissionStatus !== 'granted') {
            // console.log('Requesting notification permissions...');
            permissionStatus = await requestPushPermissions();
          }
          
          // Send local notification regardless of permission status (for demo purposes)
          await PushNotificationService.sendLocalNotification(title, message, {
            notificationId: newNotification.id,
            ...data
          });
          // console.log('📱 Local notification sent:', title);
        } catch (error) {
          console.error('Failed to send local notification:', error);
        }
      }
      
      return newNotification;
    } catch (error) {
      console.error('Failed to send notification to user:', error);
      return null;
    }
  };

  // Load notifications on user change
  useEffect(() => {
    if (user) {
      loadNotifications();
      initializePushNotifications();

      // Poll for new notifications every 15 seconds (reduced frequency to prevent log spam)
      // This ensures notification delivery while reducing excessive polling
      const pollInterval = setInterval(() => {
        refreshNotifications();
      }, 15000); // Increased from 5 seconds to 15 seconds

      return () => {
        clearInterval(pollInterval);
      };
    } else {
      setNotifications([]);
      setUnreadCount(0);
      PushNotificationService.setBadgeCount(0);
    }
  }, [user]);

  const value = {
    notifications,
    unreadCount,
    pushToken,
    pushPermissionStatus,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
    getRelativeTime,
    NotificationTypes,
    createMessageNotification,
    createAppointmentNotification,
    createReminderNotification,
    createServiceNotification,
    createSystemNotification,
    createAlertNotification,
    scheduleAppointmentReminder,
    sendNotificationToUser,
    clearAllNotifications,
    clearNotificationsForUser,
    clearAllUserNotifications,
    requestPushPermissions,
    refreshNotifications,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};