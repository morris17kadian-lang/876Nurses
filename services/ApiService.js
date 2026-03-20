// Firebase-based API Service for 876Nurses
import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch,
  serverTimestamp,
  startAfter,
  addDoc,
  onSnapshot,
} from 'firebase/firestore';

// Collection names
const COLLECTIONS = {
  APPOINTMENTS: 'appointments',
  NURSES: 'nurses',
  USERS: 'users',
  ADMINS: 'admins',
  SHIFTS: 'shifts',
  SHIFT_REQUESTS: 'shiftRequests',
  NOTIFICATIONS: 'notifications',
  STORE_PRODUCTS: 'storeProducts',
  STORE_ORDERS: 'storeOrders',
  INVOICES: 'invoices',
  PATIENTS: 'patients',
  SERVICES: 'services',
  PAYSLIPS: 'payslips',
  PAYMENTS: 'payments',
  PAYMENT_SETTINGS: 'paymentSettings',
};

class ApiService {
  static _dateKeyFromTime(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  static _upsertClockSession(sessions, patch) {
    const base = Array.isArray(sessions) ? [...sessions] : [];
    const dayKey = patch?.dayKey || ApiService._dateKeyFromTime(patch?.clockInTime || patch?.clockOutTime);
    const nextPatch = { ...patch, ...(dayKey ? { dayKey } : {}) };

    // Find most recent open session for the same day (clock-in exists, clock-out missing)
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
  }

  // Legacy compatibility method for old makeRequest calls
  static async makeRequest(endpoint, options = {}) {
    // Intentionally silent: callers are being migrated off makeRequest.
    
    try {
      // For now, return empty results to prevent crashes
      // These should be gradually replaced with proper Firebase methods
      if (endpoint.includes('/staff/admins')) {
        const result = await this.getAdmins();
        return { success: true, data: result };
      }
      if (endpoint.includes('/staff/nurses')) {
        const result = await this.getNurses();
        return { success: true, data: result };
      }
      if (endpoint.includes('/profile-edit-requests')) {
        if (endpoint.includes('/pending')) {
          const data = await this.getPendingProfileEditRequests();
          return { success: true, data };
        }

        // Optional status filtering: /profile-edit-requests?status=pending
        const statusMatch = endpoint.match(/[?&]status=([^&]+)/);
        const status = statusMatch ? decodeURIComponent(statusMatch[1]) : null;
        const data = await this.getProfileEditRequests({ status });
        return { success: true, data };
      }
      if (endpoint.includes('/appointments')) {
        // Handle POST for creating appointments
        if (options.method === 'POST') {
          // Check if it's an assignment endpoint: /appointments/:id/assign
          if (endpoint.includes('/assign')) {
            // Extract ID from /appointments/ID/assign
            const parts = endpoint.split('/');
            const idIndex = parts.indexOf('appointments') + 1;
            const appointmentId = parts[idIndex];
            const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
            
            // Assuming updateAppointment can handle assignment fields
            const result = await this.updateAppointment(appointmentId, body);
            return { success: true, data: result };
          }
          
          // Regular creation
          const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          const result = await this.createAppointment(body);
          return { success: true, data: result };
        }
        
        // Handle PUT/PATCH for updating appointments
        if (options.method === 'PUT' || options.method === 'PATCH') {
          // Extract ID from /appointments/ID
          const parts = endpoint.split('/');
          const idIndex = parts.indexOf('appointments') + 1;
          const appointmentId = parts[idIndex];
          
          if (appointmentId && appointmentId !== 'stats') {
             const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
             const result = await this.updateAppointment(appointmentId, body);
             return { success: true, data: result };
          }
        }

        // Default to GET
        const result = await this.getAppointments();
        return { success: true, data: result };
      }
      if (endpoint.includes('/invoices')) {
        const result = await this.getInvoices();
        return { success: true, data: result };
      }
      if (endpoint.includes('/shifts')) {
        // Handle POST for creating shift requests (including admin-recurring)
        if (options.method === 'POST') {
          const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          
          // Admin recurring shift request creation
          if (endpoint.includes('/request/admin-recurring') || endpoint.includes('/admin-recurring')) {
            const nowIso = new Date().toISOString();
            const shiftRequestData = {
              ...body,
              adminRecurring: true,
              isRecurring: true,
              status: 'pending',
              requestDate: nowIso,
              requestedAt: body.requestedAt || nowIso,
              recurringDaysOfWeek: body.daysOfWeek || [],
              recurringStartTime: body.startTime,
              recurringEndTime: body.endTime,
              recurringPeriodStart: body.startDate,
              recurringPeriodEnd: body.endDate || null,
            };
            const result = await this.createShiftRequest(shiftRequestData);
            return { success: true, shiftRequest: result };
          }
          
          // Regular shift request creation
          const result = await this.createShiftRequest(body);
          return { success: true, shiftRequest: result };
        }
        
        // Handle PUT for updating shift requests (approve/deny/notes)
        if (options.method === 'PUT' || options.method === 'PATCH') {
          const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          
          // Extract ID from endpoint like /shifts/requests/ID/approve or /shifts/recurring/ID/approve
          const parts = endpoint.split('/');
          const approveIndex = parts.indexOf('approve');
          const denyIndex = parts.indexOf('deny');
          const declineIndex = parts.indexOf('decline');
          const notesIndex = parts.indexOf('notes');
          
          let shiftId = null;
          if (approveIndex > 0) shiftId = parts[approveIndex - 1];
          else if (denyIndex > 0) shiftId = parts[denyIndex - 1];
          else if (declineIndex > 0) shiftId = parts[declineIndex - 1];
          else if (notesIndex > 0) shiftId = parts[notesIndex - 1];
          else {
            // Try to find ID after /shifts/ or /requests/
            const requestsIdx = parts.indexOf('requests');
            const recurringIdx = parts.indexOf('recurring');
            if (requestsIdx > 0 && parts[requestsIdx + 1]) shiftId = parts[requestsIdx + 1];
            else if (recurringIdx > 0 && parts[recurringIdx + 1]) shiftId = parts[recurringIdx + 1];
          }
          
          if (shiftId) {
            const result = await this.updateShiftRequest(shiftId, body);
            return { success: true, shiftRequest: result };
          }
        }
        
        // Default to GET for fetching shifts
        const result = await this.getShifts();
        return { success: true, data: result };
      }
      if (endpoint.includes('/notifications')) {
        const limitMatch = endpoint.match(/[?&]limit=(\d+)/);
        const limitCount = limitMatch ? Number(limitMatch[1]) : 50;
        const userId = options?.userId;
        const notifications = userId
          ? await this.getNotifications(userId, { limit: limitCount })
          : [];
        return { success: true, notifications, data: notifications };
      }
      if (endpoint.includes('/payslips')) {
        const result = await this.getPayslips();
        return { success: true, data: result };
      }
      if (endpoint.includes('/settings/preferences')) {
        return { success: true, data: { preferences: {} } };
      }
      if (endpoint.includes('/payments')) {
        return { success: true, data: [] };
      }
      
      // Default fallback - return empty array or success response
      return { success: true, data: [] };
    } catch (error) {
      console.error(`Error in legacy API wrapper for ${endpoint}:`, error);
      return { success: false, data: [], error: error.message };
    }
  }

  // ==================== PROFILE EDIT REQUESTS ====================
  static _profileEditCollections() {
    // Migration wrote to "profileeditrequests" (lowercase), but some app code expects "profileEditRequests".
    return ['profileEditRequests', 'profileeditrequests'];
  }

  static async getProfileEditRequests({ status } = {}) {
    try {
      const all = [];
      for (const collName of this._profileEditCollections()) {
        const constraints = [];
        if (status) constraints.push(where('status', '==', status));
        constraints.push(orderBy('createdAt', 'desc'));
        const q = query(collection(db, collName), ...constraints);
        const snap = await getDocs(q);
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
      }
      // Deduplicate by id (in case both collections used)
      return Array.from(new Map(all.map(r => [r.id, r])).values());
    } catch (error) {
      console.error('Error fetching profile edit requests:', error);
      return [];
    }
  }

  static async getPendingProfileEditRequests() {
    return this.getProfileEditRequests({ status: 'pending' });
  }

  static async createProfileEditRequest({ nurseId, nurseName, nurseCode, requestedBy } = {}) {
    try {
      const docRef = await addDoc(collection(db, 'profileEditRequests'), {
        nurseId,
        nurseName,
        nurseCode,
        requestedBy: requestedBy || null,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(docRef);
      return { id: snap.id, ...snap.data() };
    } catch (error) {
      console.error('Error creating profile edit request:', error);
      throw error;
    }
  }

  static async approveProfileEditRequest(requestId) {
    try {
      const ref = doc(db, 'profileEditRequests', requestId);
      await updateDoc(ref, {
        status: 'approved',
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(ref);
      return { id: snap.id, ...snap.data() };
    } catch (error) {
      console.error('Error approving profile edit request:', error);
      throw error;
    }
  }

  static async denyProfileEditRequest(requestId) {
    try {
      const ref = doc(db, 'profileEditRequests', requestId);
      await updateDoc(ref, {
        status: 'denied',
        deniedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(ref);
      return { id: snap.id, ...snap.data() };
    } catch (error) {
      console.error('Error denying profile edit request:', error);
      throw error;
    }
  }

  static async canEditProfile(nurseId) {
    try {
      const q = query(
        collection(db, 'profileEditRequests'),
        where('nurseId', '==', nurseId),
        where('status', '==', 'approved'),
        limit(1)
      );
      const snap = await getDocs(q);
      return { success: true, canEdit: !snap.empty };
    } catch (error) {
      console.error('Error checking edit permission:', error);
      return { success: false, canEdit: false, error: error.message };
    }
  }

  static async revokeEditPermission(nurseId) {
    try {
      // Revoke any approved permissions by setting them to revoked.
      const q = query(
        collection(db, 'profileEditRequests'),
        where('nurseId', '==', nurseId),
        where('status', '==', 'approved')
      );
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      snap.forEach(d => {
        batch.update(d.ref, { status: 'revoked', revokedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await batch.commit();
      return { success: true, data: { revoked: snap.size } };
    } catch (error) {
      console.error('Error revoking edit permission:', error);
      return { success: false, error: error.message };
    }
  }
  // ==================== APPOINTMENTS ====================
  static async getAppointments(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.APPOINTMENTS);
      
      // Apply filters
      const constraints = [];
      if (filters.nurseId) {
        constraints.push(where('nurseId', '==', filters.nurseId));
      }
      if (filters.patientId) {
        constraints.push(where('patientId', '==', filters.patientId));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      // Add ordering
      // Use scheduledDate if available, otherwise fallback to createdAt
      // Note: Firestore requires the field to exist for orderBy to work
      constraints.push(orderBy('createdAt', 'desc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.APPOINTMENTS), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching appointments:', error);
      return [];
    }
  }

  static async getAppointmentById(appointmentId) {
    try {
      const docRef = doc(db, COLLECTIONS.APPOINTMENTS, appointmentId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Appointment not found');
      }
    } catch (error) {
      const message = error?.message || String(error);
      // "Appointment not found" is an expected outcome in parts of the admin flow
      // where we intentionally fall back to shiftRequests.
      if (String(message).toLowerCase().includes('appointment not found')) {
        if (__DEV__) {
          console.log('Appointment not found (will fall back to shift request):', appointmentId);
        }
      } else {
        console.error('Error fetching appointment by ID:', error);
      }
      throw error;
    }
  }

  static async createAppointment(appointmentData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.APPOINTMENTS), {
        ...appointmentData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      
      const newDoc = await getDoc(docRef);
      return {
        id: newDoc.id,
        ...newDoc.data()
      };
    } catch (error) {
      console.error('Error creating appointment:', error);
      throw error;
    }
  }

  static async updateAppointment(appointmentId, updateData) {
    try {
      const docRef = doc(db, COLLECTIONS.APPOINTMENTS, appointmentId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating appointment:', error);
      throw error;
    }
  }

  static async updateAppointmentStatus(appointmentId, status) {
    return this.updateAppointment(appointmentId, { status });
  }

  static async deleteAppointment(appointmentId) {
    try {
      const docRef = doc(db, COLLECTIONS.APPOINTMENTS, appointmentId);
      await deleteDoc(docRef);
      return { success: true };
    } catch (error) {
      console.error('Error deleting appointment:', error);
      throw error;
    }
  }

  static async cancelAppointment(appointmentId) {
    return this.updateAppointmentStatus(appointmentId, 'cancelled');
  }

  // ==================== NURSES ====================
  static async getNurses(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.NURSES);
      
      const constraints = [];
      if (filters.specialty) {
        constraints.push(where('specialty', '==', filters.specialty));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      constraints.push(orderBy('name', 'asc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.NURSES), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching nurses:', error);
      return [];
    }
  }

  static async getNurseById(nurseId) {
    try {
      const docRef = doc(db, COLLECTIONS.NURSES, nurseId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Nurse not found');
      }
    } catch (error) {
      console.error('Error fetching nurse by ID:', error);
      throw error;
    }
  }

  static async updateNurse(nurseId, updateData) {
    try {
      const docRef = doc(db, COLLECTIONS.NURSES, nurseId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating nurse:', error);
      throw error;
    }
  }

  static async updateNurseStatus(nurseId, status) {
    return this.updateNurse(nurseId, { status });
  }

  // ==================== USERS ====================
  static async getUsers(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.USERS);
      
      const constraints = [];
      if (filters.role) {
        constraints.push(where('role', '==', filters.role));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      // Only add orderBy if there are no filter constraints to avoid composite index requirement
      if (constraints.length === 0) {
        constraints.push(orderBy('name', 'asc'));
      }
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.USERS), ...constraints);
      }

      const snapshot = await getDocs(q);
      let users = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort in memory if we had filter constraints
      if (filters.role || filters.status) {
        users.sort((a, b) => {
          const nameA = (a.name || a.fullName || '').toLowerCase();
          const nameB = (b.name || b.fullName || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
      }
      
      return users;
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    }
  }

  static async getUserById(userId) {
    try {
      const docRef = doc(db, COLLECTIONS.USERS, userId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('User not found');
      }
    } catch (error) {
      console.error('Error fetching user by ID:', error);
      throw error;
    }
  }

  static async updateUser(userId, updateData) {
    try {
      const adminRef = doc(db, COLLECTIONS.ADMINS, userId);
      const nurseRef = doc(db, COLLECTIONS.NURSES, userId);
      const userRef = doc(db, COLLECTIONS.USERS, userId);

      const [adminSnap, nurseSnap, userSnap] = await Promise.all([
        getDoc(adminRef),
        getDoc(nurseRef),
        getDoc(userRef),
      ]);

      const targetRef = adminSnap.exists()
        ? adminRef
        : nurseSnap.exists()
          ? nurseRef
          : userRef;

      // If none exist yet, create a user doc so callers don't crash.
      if (!adminSnap.exists() && !nurseSnap.exists() && !userSnap.exists()) {
        await setDoc(
          targetRef,
          {
            ...updateData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await updateDoc(targetRef, {
          ...updateData,
          updatedAt: serverTimestamp(),
        });
      }

      const updatedDoc = await getDoc(targetRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data(),
      };
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  // ==================== ADMINS ====================
  static async getAdmins() {
    try {
      const q = query(collection(db, COLLECTIONS.ADMINS), orderBy('name', 'asc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching admins:', error);
      return [];
    }
  }

  static async getAdminById(adminId) {
    try {
      const docRef = doc(db, COLLECTIONS.ADMINS, adminId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Admin not found');
      }
    } catch (error) {
      console.error('Error fetching admin by ID:', error);
      throw error;
    }
  }

  // ==================== SHIFTS ====================
  static async getShifts(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.SHIFTS);
      
      const constraints = [];
      if (filters.nurseId) {
        constraints.push(where('nurseId', '==', filters.nurseId));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      constraints.push(orderBy('date', 'desc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.SHIFTS), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching shifts:', error);
      return [];
    }
  }

  static async createShift(shiftData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.SHIFTS), {
        ...shiftData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      
      const newDoc = await getDoc(docRef);
      return {
        id: newDoc.id,
        ...newDoc.data()
      };
    } catch (error) {
      console.error('Error creating shift:', error);
      throw error;
    }
  }

  static async updateShift(shiftId, updateData) {
    try {
      const docRef = doc(db, COLLECTIONS.SHIFTS, shiftId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating shift:', error);
      throw error;
    }
  }

  static async deleteShift(shiftId) {
    try {
      const docRef = doc(db, COLLECTIONS.SHIFTS, shiftId);
      await deleteDoc(docRef);
      return { success: true };
    } catch (error) {
      console.error('Error deleting shift:', error);
      throw error;
    }
  }

  // ==================== SHIFT REQUESTS ====================
  static async getShiftRequests(filters = {}) {
    try {
      const constraints = [];

      if (filters.nurseId) {
        constraints.push(where('nurseId', '==', filters.nurseId));
      }
      if (filters.clientId) {
        constraints.push(where('clientId', '==', filters.clientId));
      }
      if (filters.patientId) {
        constraints.push(where('patientId', '==', filters.patientId));
      }
      if (filters.userId) {
        constraints.push(where('userId', '==', filters.userId));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }

      // Avoid composite-index requirements: only apply ordering when no equality filters are used.
      if (constraints.length === 0) {
        constraints.push(orderBy('requestDate', 'desc'));
      }

      const q = constraints.length > 0
        ? query(collection(db, COLLECTIONS.SHIFT_REQUESTS), ...constraints)
        : collection(db, COLLECTIONS.SHIFT_REQUESTS);

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching shift requests:', error);
      return [];
    }
  }

  static async createShiftRequest(shiftRequestData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.SHIFT_REQUESTS), {
        ...shiftRequestData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      
      const newDoc = await getDoc(docRef);
      return {
        id: newDoc.id,
        ...newDoc.data()
      };
    } catch (error) {
      console.error('Error creating shift request:', error);
      throw error;
    }
  }

  static sanitizeData(obj) {
    if (obj === undefined) return undefined;
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(v => {
        const cleaned = ApiService.sanitizeData(v);
        return cleaned === undefined ? null : cleaned;
    });
    
    const res = {};
    for (const key in obj) {
      const val = ApiService.sanitizeData(obj[key]);
      if (val !== undefined) res[key] = val;
    }
    return res;
  }

  static async updateShiftRequest(shiftRequestId, updateData) {
    try {
      const finalData = ApiService.sanitizeData(updateData);
      const docRef = doc(db, COLLECTIONS.SHIFT_REQUESTS, shiftRequestId);
      await updateDoc(docRef, {
        ...finalData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      const notFound = error?.code === 'not-found'
        || /No document to update/i.test(error?.message || '');
      if (notFound) {
        try {
          return await this.updateAppointment(shiftRequestId, updateData);
        } catch (appointmentError) {
          console.error('Error updating appointment (fallback):', appointmentError);
          throw appointmentError;
        }
      }

      console.error('Error updating shift request:', error);
      throw error;
    }
  }

  static async upsertShiftRequest(shiftRequestId, data) {
    try {
      const finalData = ApiService.sanitizeData(data);

      const docRef = doc(db, COLLECTIONS.SHIFT_REQUESTS, shiftRequestId);
      await setDoc(docRef, {
        ...finalData,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error upserting shift request:', error);
      throw error;
    }
  }

  static async getShiftRequestById(shiftRequestId) {
    try {
      if (!shiftRequestId) return null;
      const docRef = doc(db, COLLECTIONS.SHIFT_REQUESTS, shiftRequestId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;
      return {
        id: snap.id,
        ...snap.data(),
      };
    } catch (error) {
      console.error('Error fetching shift request:', error);
      return null;
    }
  }

  static async deleteShiftRequest(shiftRequestId) {
    try {
      const docRef = doc(db, COLLECTIONS.SHIFT_REQUESTS, shiftRequestId);
      await deleteDoc(docRef);
      return { success: true };
    } catch (error) {
      console.error('Error deleting shift request:', error);
      throw error;
    }
  }

  // Legacy compatibility helpers for shift request flows (submit/approve/deny/start/complete)
  static _normalizeShiftRequest(doc) {
    if (!doc) return null;
    const id = doc.id || doc._id;
    const normalized = { ...doc };
    normalized.id = id;
    normalized._id = id;
    return normalized;
  }

  static async submitShiftRequest(shiftData) {
    try {
      const payload = {
        status: shiftData.status || 'pending',
        requestDate: shiftData.requestDate || new Date().toISOString(),
        isShift: typeof shiftData.isShift === 'boolean' ? shiftData.isShift : true,
        ...shiftData,
      };
      const created = await this.createShiftRequest(payload);
      return {
        success: true,
        shiftRequest: this._normalizeShiftRequest(created),
      };
    } catch (error) {
      console.error('Error submitting shift request:', error);
      return { success: false, error: error.message };
    }
  }

  static async approveShiftRequest(shiftId, updates = {}) {
    try {
      const now = new Date().toISOString();
      const updated = await this.updateShiftRequest(shiftId, {
        status: 'approved',
        approvedAt: updates.approvedAt || now,
        approvedBy: updates.approvedBy || null,
        ...updates,
      });
      return { success: true, shiftRequest: this._normalizeShiftRequest(updated) };
    } catch (error) {
      console.error('Error approving shift request:', error);
      return { success: false, error: error.message };
    }
  }

  static async denyShiftRequest(shiftId, reason = '') {
    try {
      // Delete the shift request instead of just updating status
      await this.deleteShiftRequest(shiftId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting denied shift request:', error);
      return { success: false, error: error.message };
    }
  }

  static async startShift(shiftId, options = {}) {
    try {
      const startTime = options.startTime || new Date().toISOString();
      const dayKey = ApiService._dateKeyFromTime(startTime);
      const updatePayload = {
        status: 'active',
        startedAt: startTime,
        actualStartTime: startTime,
      };

      if (options.clockInLocation) {
        updatePayload.clockInLocation = options.clockInLocation;
        updatePayload.clockInCapturedAt = options.clockInLocation.timestamp || startTime;
      }

      if (options.nurseId) {
        const nurseKey = options.nurseId;
        updatePayload.startedBy = nurseKey;

        // Load existing sessions so we can persist multi-day history without Firestore FieldValue helpers.
        let existing = null;
        try {
          existing = await this.getShiftRequestById(shiftId);
        } catch (e) {
          existing = null;
        }

        const rootSessions = Array.isArray(existing?.clockEntries) ? existing.clockEntries : [];
        const nurseSessions = Array.isArray(existing?.clockByNurse?.[nurseKey]?.clockEntries)
          ? existing.clockByNurse[nurseKey].clockEntries
          : [];

        const sessionPatch = {
          dayKey,
          nurseId: nurseKey,
          clockInTime: startTime,
          clockInLocation: options.clockInLocation || null,
          clockInCapturedAt: options.clockInLocation?.timestamp || startTime,
        };

        updatePayload.clockEntries = ApiService._upsertClockSession(rootSessions, sessionPatch);
        updatePayload[`clockByNurse.${nurseKey}.clockEntries`] = ApiService._upsertClockSession(
          nurseSessions,
          sessionPatch
        );

        // Per-nurse clock data (supports split schedules)
        updatePayload[`clockByNurse.${nurseKey}.lastClockInTime`] = startTime;
        updatePayload[`clockByNurse.${nurseKey}.lastClockInCapturedAt`] =
          options.clockInLocation?.timestamp || startTime;
        if (options.clockInLocation) {
          updatePayload[`clockByNurse.${nurseKey}.lastClockInLocation`] = options.clockInLocation;
        }
      }

      await this.updateShiftRequest(shiftId, updatePayload);
      return { success: true, startTime, clockInLocation: updatePayload.clockInLocation || null };
    } catch (error) {
      console.error('Error starting shift request:', error);
      return { success: false, error: error.message };
    }
  }

  static async completeShift(shiftId, hoursWorked = 0, completionNotes = '', options = {}) {
    try {
      const endTime = options.endTime || new Date().toISOString();
      const dayKey = ApiService._dateKeyFromTime(endTime);
      const requestedKeepBooked = Boolean(options.keepBooked);

      const shiftDoc = await this.getShiftRequestById(shiftId);
      const normalizedCompletionNotes =
        typeof completionNotes === 'string' ? completionNotes.trim() : '';
      const existingNotesHistory = Array.isArray(shiftDoc?.notesHistory)
        ? [...shiftDoc.notesHistory]
        : [];
      const isAdminRecurring =
        shiftDoc?.adminRecurring === true ||
        String(shiftDoc?.adminRecurring || '').trim().toLowerCase() === 'true';
      const isPatientRecurring =
        shiftDoc?.isRecurring === true ||
        String(shiftDoc?.isRecurring || '').trim().toLowerCase() === 'true' ||
        (shiftDoc?.recurringSchedule && typeof shiftDoc.recurringSchedule === 'object') ||
        (shiftDoc?.recurringPattern && typeof shiftDoc.recurringPattern === 'object');

      // Detect recurring series across both admin-created and patient-created formats.
      const isRecurring = Boolean(
        isAdminRecurring ||
          isPatientRecurring ||
          shiftDoc?.recurringScheduleId ||
          shiftDoc?.recurringPeriodStart ||
          shiftDoc?.recurringPeriodEnd ||
          shiftDoc?.recurringDaysOfWeekList ||
          shiftDoc?.recurringDaysOfWeek ||
          shiftDoc?.nurseSchedule ||
          (shiftDoc?.startDate && shiftDoc?.endDate && (shiftDoc?.daysOfWeek || shiftDoc?.selectedDays))
      );

      const parseDateOnlyKey = (value) => {
        if (!value) return null;
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
          const d = new Date(`${value.trim()}T00:00:00`);
          if (isNaN(d.getTime())) return null;
          return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        }
        const d = new Date(value);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      };

      const endDateCandidate =
        shiftDoc?.recurringPeriodEnd || shiftDoc?.endDate || shiftDoc?.recurringEndDate || null;
      const endDateKey = parseDateOnlyKey(endDateCandidate);
      const endTimeKey = parseDateOnlyKey(endTime);
      const endReached =
        typeof endDateKey === 'number' && typeof endTimeKey === 'number' && endTimeKey >= endDateKey;

      const normalizeKey = (v) => (v === null || v === undefined ? '' : String(v)).trim().toUpperCase();
      const nurseKey = normalizeKey(options.nurseId);
      const isSplitSchedule = Boolean(shiftDoc?.nurseSchedule && typeof shiftDoc.nurseSchedule === 'object');

      let expectedFinalNurseKey = '';
      if (endDateCandidate) {
        const endDateObj = (typeof endDateCandidate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDateCandidate.trim()))
          ? new Date(`${endDateCandidate.trim()}T00:00:00`)
          : new Date(endDateCandidate);
        if (!isNaN(endDateObj.getTime())) {
          const dow = endDateObj.getDay();
          const raw =
            (isSplitSchedule &&
              (shiftDoc.nurseSchedule?.[dow] ?? shiftDoc.nurseSchedule?.[String(dow)])) ||
            shiftDoc?.nurseId ||
            null;
          expectedFinalNurseKey = normalizeKey(raw);
        }
      }

      const nurseMatchesFinal = !expectedFinalNurseKey || nurseKey === expectedFinalNurseKey;
      const isFinalCompletion = Boolean(isRecurring && endReached && nurseMatchesFinal);

      // For recurring shifts, default to "keep booked" until the final scheduled day.
      // For non-recurring shifts, respect requestedKeepBooked.
      const keepBooked = isRecurring ? !isFinalCompletion : requestedKeepBooked;

      const updatePayload = {
        status: keepBooked ? 'approved' : 'completed',
        ...(keepBooked
          ? {
              lastCompletedAt: endTime,
              lastActualEndTime: endTime,
              lastHoursWorked: hoursWorked,
              lastCompletionNotes: completionNotes,
              completedAt: null,
              actualEndTime: null,
              startedAt: null,
              actualStartTime: null,
              startedBy: null,
              completedBy: null,
              clockInLocation: null,
              clockInCapturedAt: null,
            }
          : {
              completedAt: endTime,
              actualEndTime: endTime,
              hoursWorked,
              completionNotes,
            }),
      };

      if (isFinalCompletion) {
        updatePayload.finalCompletedAt = endTime;
      }

      if (options.clockOutLocation) {
        updatePayload.clockOutLocation = options.clockOutLocation;
        updatePayload.clockOutCapturedAt = options.clockOutLocation.timestamp || endTime;
        if (keepBooked) {
          updatePayload.lastClockOutLocation = options.clockOutLocation;
          updatePayload.clockOutLocation = null;
          updatePayload.clockOutCapturedAt = null;
        }
      }

      let updatedNotesHistory = existingNotesHistory;
      if (normalizedCompletionNotes) {
        const noteEntry = {
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          text: normalizedCompletionNotes,
          recordedAt: endTime,
          recordedBy: options.nurseId || shiftDoc?.nurseId || null,
        };
        updatedNotesHistory = [...existingNotesHistory, noteEntry];
        if (updatedNotesHistory.length > 50) {
          updatedNotesHistory = updatedNotesHistory.slice(-50);
        }
        updatePayload.notesHistory = updatedNotesHistory;
      }

      if (options.nurseId) {
        if (!keepBooked) {
          updatePayload.completedBy = options.nurseId;
        }

        const nurseKey = options.nurseId;

        const rootSessions = Array.isArray(shiftDoc?.clockEntries) ? shiftDoc.clockEntries : [];
        const nurseSessions = Array.isArray(shiftDoc?.clockByNurse?.[nurseKey]?.clockEntries)
          ? shiftDoc.clockByNurse[nurseKey].clockEntries
          : [];

        const sessionPatch = {
          dayKey,
          nurseId: nurseKey,
          clockOutTime: endTime,
          clockOutLocation: options.clockOutLocation || null,
          clockOutCapturedAt: options.clockOutLocation?.timestamp || endTime,
        };

        updatePayload.clockEntries = ApiService._upsertClockSession(rootSessions, sessionPatch);
        updatePayload[`clockByNurse.${nurseKey}.clockEntries`] = ApiService._upsertClockSession(
          nurseSessions,
          sessionPatch
        );

        // Per-nurse clock data (supports split schedules)
        updatePayload[`clockByNurse.${nurseKey}.lastClockOutTime`] = endTime;
        updatePayload[`clockByNurse.${nurseKey}.lastHoursWorked`] = hoursWorked;
        updatePayload[`clockByNurse.${nurseKey}.lastCompletionNotes`] = completionNotes;
        if (options.clockOutLocation) {
          updatePayload[`clockByNurse.${nurseKey}.lastClockOutLocation`] = options.clockOutLocation;
          updatePayload[`clockByNurse.${nurseKey}.lastClockOutCapturedAt`] =
            options.clockOutLocation.timestamp || endTime;
        }
      }

      await this.updateShiftRequest(shiftId, updatePayload);
      return {
        success: true,
        endTime,
        hoursWorked,
        clockOutLocation: updatePayload.clockOutLocation || null,
        keepBooked,
        status: keepBooked ? 'approved' : 'completed',
        isFinalCompletion,
        notesHistory: updatePayload.notesHistory || existingNotesHistory,
      };
    } catch (error) {
      console.error('Error completing shift request:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== NOTIFICATIONS ====================
  static async getNotifications(userId, { limit: limitCount = 50 } = {}) {
    if (!userId) return [];

    const normalize = (docSnap) => {
      const data = docSnap.data();
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt;
      return {
        id: docSnap.id,
        ...data,
        sentAt: data.sentAt || createdAt,
        isRead: typeof data.isRead === 'boolean' ? data.isRead : !!data.read,
      };
    };

    try {
      // Preferred query (requires composite index: userId + createdAt desc)
      const q = query(
        collection(db, COLLECTIONS.NOTIFICATIONS),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(normalize);
    } catch (error) {
      const message = (error?.message || '').toLowerCase();
      const code = error?.code || '';

      // If the Firestore composite index isn't created yet, fall back to a simpler query
      // that does not require the composite index. We'll sort client-side.
      const isMissingIndex =
        code === 'failed-precondition' || message.includes('requires an index');

      if (!isMissingIndex) {
        console.error('Error fetching notifications:', error);
        return [];
      }

      try {
        const fallbackQuery = query(
          collection(db, COLLECTIONS.NOTIFICATIONS),
          where('userId', '==', userId),
          limit(limitCount)
        );

        const snapshot = await getDocs(fallbackQuery);
        const items = snapshot.docs.map(normalize);

        // Sort by createdAt/sentAt descending
        items.sort((a, b) => {
          const aTime = new Date(a.createdAt || a.sentAt || 0).getTime();
          const bTime = new Date(b.createdAt || b.sentAt || 0).getTime();
          return bTime - aTime;
        });

        return items;
      } catch (fallbackError) {
        console.error('Error fetching notifications (fallback):', fallbackError);
        return [];
      }
    }
  }

  static async createNotification(notificationData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
        ...notificationData,
        createdAt: serverTimestamp(),
        read: false,
        isRead: false,
      });
      
      const newDoc = await getDoc(docRef);
      return {
        id: newDoc.id,
        ...newDoc.data()
      };
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  static async markNotificationRead(notificationId) {
    try {
      const docRef = doc(db, COLLECTIONS.NOTIFICATIONS, notificationId);
      await updateDoc(docRef, {
        read: true,
        isRead: true,
        readAt: serverTimestamp(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  static async getUnreadNotifications(userId) {
    try {
      const q = query(
        collection(db, COLLECTIONS.NOTIFICATIONS),
        where('userId', '==', userId),
        where('read', '==', false),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching unread notifications:', error);
      return [];
    }
  }

  // ==================== STORE PRODUCTS ====================
  static async getStoreProducts(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.STORE_PRODUCTS);
      
      const constraints = [];
      if (filters.category) {
        constraints.push(where('category', '==', filters.category));
      }
      if (filters.inStock !== undefined) {
        constraints.push(where('inStock', '==', filters.inStock));
      }
      
      constraints.push(orderBy('name', 'asc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.STORE_PRODUCTS), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching store products:', error);
      return [];
    }
  }

  static async getProductById(productId) {
    try {
      const docRef = doc(db, COLLECTIONS.STORE_PRODUCTS, productId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Product not found');
      }
    } catch (error) {
      console.error('Error fetching product by ID:', error);
      throw error;
    }
  }

  static async updateProduct(productId, updateData) {
    try {
      const docRef = doc(db, COLLECTIONS.STORE_PRODUCTS, productId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating product:', error);
      throw error;
    }
  }

  // ==================== STORE ORDERS ====================
  static async getStoreOrders(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.STORE_ORDERS);
      
      const constraints = [];
      if (filters.userId) {
        constraints.push(where('userId', '==', filters.userId));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      constraints.push(orderBy('orderDate', 'desc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.STORE_ORDERS), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching store orders:', error);
      return [];
    }
  }

  static async getOrderById(orderId) {
    try {
      const docRef = doc(db, COLLECTIONS.STORE_ORDERS, orderId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Order not found');
      }
    } catch (error) {
      console.error('Error fetching order by ID:', error);
      throw error;
    }
  }

  static async createOrder(orderData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.STORE_ORDERS), {
        ...orderData,
        orderDate: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      
      const newDoc = await getDoc(docRef);
      return {
        id: newDoc.id,
        ...newDoc.data()
      };
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  static async updateOrderStatus(orderId, status) {
    try {
      const docRef = doc(db, COLLECTIONS.STORE_ORDERS, orderId);
      await updateDoc(docRef, {
        status,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating order status:', error);
      throw error;
    }
  }

  static async cancelOrder(orderId) {
    return this.updateOrderStatus(orderId, 'cancelled');
  }

  // ==================== INVOICES ====================
  static async getInvoices(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.INVOICES);
      
      const constraints = [];
      if (filters.userId) {
        constraints.push(where('userId', '==', filters.userId));
      }
      if (filters.nurseId) {
        constraints.push(where('nurseId', '==', filters.nurseId));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      constraints.push(orderBy('createdAt', 'desc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.INVOICES), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching invoices:', error);
      return [];
    }
  }

  static async getInvoiceById(invoiceId) {
    try {
      const docRef = doc(db, COLLECTIONS.INVOICES, invoiceId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Invoice not found');
      }
    } catch (error) {
      console.error('Error fetching invoice by ID:', error);
      throw error;
    }
  }

  static async createInvoice(invoiceData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.INVOICES), {
        ...invoiceData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      
      const newDoc = await getDoc(docRef);
      return {
        id: newDoc.id,
        ...newDoc.data()
      };
    } catch (error) {
      console.error('Error creating invoice:', error);
      throw error;
    }
  }

  static async createBulkInvoices(invoices) {
    try {
      const batch = writeBatch(db);
      const invoiceRefs = [];

      invoices.forEach((invoiceData) => {
        const docRef = doc(collection(db, COLLECTIONS.INVOICES));
        batch.set(docRef, {
          ...invoiceData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        invoiceRefs.push(docRef);
      });

      await batch.commit();
      
      // Return created invoice IDs
      return {
        success: true,
        invoiceIds: invoiceRefs.map(ref => ref.id)
      };
    } catch (error) {
      console.error('Error creating bulk invoices:', error);
      throw error;
    }
  }

  static async updateInvoice(invoiceId, updateData) {
    try {
      const docRef = doc(db, COLLECTIONS.INVOICES, invoiceId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating invoice:', error);
      throw error;
    }
  }

  static async updateInvoiceStatus(invoiceId, status) {
    return this.updateInvoice(invoiceId, { status });
  }

  static async deleteInvoice(invoiceId) {
    try {
      const docRef = doc(db, COLLECTIONS.INVOICES, invoiceId);
      await deleteDoc(docRef);
      return { success: true };
    } catch (error) {
      console.error('Error deleting invoice:', error);
      throw error;
    }
  }

  static async getInvoiceStats() {
    try {
      const snapshot = await getDocs(collection(db, COLLECTIONS.INVOICES));
      const invoices = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        total: invoices.length,
        pending: invoices.filter(inv => inv.status === 'pending').length,
        paid: invoices.filter(inv => inv.status === 'paid').length,
        overdue: invoices.filter(inv => inv.status === 'overdue').length,
        totalAmount: invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
        paidAmount: invoices
          .filter(inv => inv.status === 'paid')
          .reduce((sum, inv) => sum + (inv.amount || 0), 0),
      };

      return stats;
    } catch (error) {
      console.error('Error getting invoice stats:', error);
      return {
        total: 0,
        pending: 0,
        paid: 0,
        overdue: 0,
        totalAmount: 0,
        paidAmount: 0,
      };
    }
  }

  static async getInvoiceSeries(seriesId) {
    try {
      const q = query(
        collection(db, COLLECTIONS.INVOICES),
        where('seriesId', '==', seriesId),
        orderBy('invoiceNumber', 'asc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching invoice series:', error);
      return [];
    }
  }

  // ==================== AUTHENTICATION ====================
  static async changePassword(currentPassword, newPassword) {
    // This should be handled by Firebase Auth, not Firestore
    // Left as placeholder to maintain API compatibility
    console.warn('Password change should be handled through Firebase Auth');
    throw new Error('Password change must be handled through Firebase Auth');
  }

  // ==================== PAYMENT SETTINGS ====================
  static async getPaymentSettings() {
    try {
      const q = query(collection(db, COLLECTIONS.PAYMENT_SETTINGS), limit(1));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return {
          id: doc.id,
          ...doc.data()
        };
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error fetching payment settings:', error);
      return null;
    }
  }

  // ==================== PRIVACY SETTINGS ====================
  static async getPrivacySettings(userId) {
    try {
      if (!userId) return null;
      const docRef = doc(db, 'privacySettings', String(userId));
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
      console.error('Error fetching privacy settings:', error);
      return null;
    }
  }

  static async updatePrivacySettings(userId, updates = {}) {
    try {
      if (!userId) throw new Error('UserId is required');
      const docRef = doc(db, 'privacySettings', String(userId));
      await setDoc(
        docRef,
        {
          userId: String(userId),
          ...updates,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      throw error;
    }
  }

  // ==================== DATA RIGHTS REQUESTS ====================
  static async createDataRequest(requestData = {}) {
    try {
      const payload = {
        ...requestData,
        createdAt: serverTimestamp(),
        status: requestData.status || 'submitted',
      };
      const docRef = await addDoc(collection(db, 'dataRequests'), payload);
      return { id: docRef.id, ...payload };
    } catch (error) {
      console.error('Error creating data request:', error);
      throw error;
    }
  }

  // ==================== USER MANAGEMENT ====================
  static async getAllUsers() {
    try {
      // Get users from all user collections
      const [usersSnapshot, nursesSnapshot, adminsSnapshot] = await Promise.all([
        getDocs(collection(db, COLLECTIONS.USERS)),
        getDocs(collection(db, COLLECTIONS.NURSES)),
        getDocs(collection(db, COLLECTIONS.ADMINS)),
      ]);

      const allUsers = [
        ...usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'user' })),
        ...nursesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'nurse' })),
        ...adminsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'admin' })),
      ];

      return allUsers;
    } catch (error) {
      console.error('Error fetching all users:', error);
      return [];
    }
  }

  // ==================== PROFILE EDIT REQUESTS ====================
  static async getProfileEditRequests() {
    try {
      const q = query(
        collection(db, 'profileEditRequests'),
        orderBy('createdAt', 'desc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching profile edit requests:', error);
      return [];
    }
  }

  // ==================== PATIENTS ====================
  static async getPatients(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.PATIENTS);
      
      const constraints = [];
      if (filters.nurseId) {
        constraints.push(where('assignedNurseId', '==', filters.nurseId));
      }
      if (filters.status) {
        constraints.push(where('status', '==', filters.status));
      }
      
      constraints.push(orderBy('name', 'asc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.PATIENTS), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching patients:', error);
      return [];
    }
  }

  static async getPatientById(patientId) {
    try {
      const docRef = doc(db, COLLECTIONS.PATIENTS, patientId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error fetching patient by ID:', error);
      return null;
    }
  }

  static async getUsersByRole(role) {
    try {
      const baseCollection = collection(db, COLLECTIONS.USERS);
      const constraintList = [];
      if (role) {
        constraintList.push(where('role', '==', role));
      }
      const q = constraintList.length > 0 ? query(baseCollection, ...constraintList) : baseCollection;
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error fetching users by role:', error);
      return [];
    }
  }

  // ==================== SERVICES ====================
  static async getServices() {
    try {
      const q = query(collection(db, COLLECTIONS.SERVICES), orderBy('title', 'asc')); // Changed to title to match schema
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching services:', error);
      return [];
    }
  }

  static subscribeToServices(callback) {
    try {
      const q = query(collection(db, COLLECTIONS.SERVICES), orderBy('title', 'asc'));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const services = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
          }));
          callback?.(services);
        },
        (error) => {
          console.error('Error listening to services:', error);
        }
      );
      return unsubscribe;
    } catch (error) {
      console.error('Failed to subscribe to services:', error);
      return null;
    }
  }

  static async createService(serviceData) {
    try {
      // If the service has a specific ID (like '1', '2'), use it as the doc ID
      // otherwise allow auto-generated ID
      if (serviceData.id && typeof serviceData.id === 'string') {
        const docRef = doc(db, COLLECTIONS.SERVICES, serviceData.id);
        await setDoc(docRef, serviceData);
        return { ...serviceData };
      } else {
        const docRef = await addDoc(collection(db, COLLECTIONS.SERVICES), serviceData);
        return { id: docRef.id, ...serviceData };
      }
    } catch (error) {
      console.error('Error creating service:', error);
      throw error;
    }
  }

  static async updateService(serviceId, serviceData) {
    try {
      if (!serviceId) throw new Error('Service ID is required');
      const docRef = doc(db, COLLECTIONS.SERVICES, String(serviceId));
      await setDoc(docRef, serviceData, { merge: true }); // Use setDoc with merge to handle explicit IDs
      return { id: serviceId, ...serviceData };
    } catch (error) {
      console.error('Error updating service:', error);
      throw error;
    }
  }

  static async deleteService(serviceId) {
    try {
      if (!serviceId) throw new Error('Service ID is required');
      const docRef = doc(db, COLLECTIONS.SERVICES, String(serviceId));
      await deleteDoc(docRef);
      return true;
    } catch (error) {
      console.error('Error deleting service:', error);
      throw error;
    }
  }

  static async sendNotification(notificationData) {
    try {
      const { userId, title, message, type, data, sentAt } = notificationData;
      
      if (!userId) throw new Error('UserId is required for notification');

      // Firestore rejects documents containing `undefined` values.
      // Strip them from the nested data object before writing.
      const sanitizeData = (obj) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj ?? null;
        return Object.fromEntries(
          Object.entries(obj)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitizeData(v)])
        );
      };

      const docData = {
        userId,
        title,
        message,
        type: type || 'system',
        data: sanitizeData(data || {}),
        isRead: false,
        sentAt: sentAt || new Date().toISOString(),
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), docData);
      return { id: docRef.id, ...docData };
    } catch (error) {
      const code = error?.code || '';
      const message = (error?.message || '').toLowerCase();
      const isPermissionDenied =
        code === 'permission-denied' ||
        message.includes('missing or insufficient permissions');

      if (isPermissionDenied) {
        // In this app, /notifications writes are restricted to admins by Firestore rules.
        // Treat this as a non-fatal condition so callers can fall back.
        return null;
      }

      console.error('Error sending notification:', error);
      throw error;
    }
  }

  // ==================== PAYSLIPS ====================
  static async getPayslips(filters = {}) {
    try {
      let q = collection(db, COLLECTIONS.PAYSLIPS);
      
      const constraints = [];
      if (filters.nurseId) {
        constraints.push(where('nurseId', '==', filters.nurseId));
      }
      if (filters.period) {
        constraints.push(where('period', '==', filters.period));
      }
      
      constraints.push(orderBy('period', 'desc'));
      
      if (constraints.length > 0) {
        q = query(collection(db, COLLECTIONS.PAYSLIPS), ...constraints);
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
      }));
    } catch (error) {
      console.error('Error fetching payslips:', error);
      return [];
    }
  }

  static async createPayslip(payslipData) {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS.PAYSLIPS), {
        ...payslipData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      
      return {
        id: docRef.id,
        ...payslipData,
      };
    } catch (error) {
      console.error('Error creating payslip:', error);
      throw error;
    }
  }

  static async updatePayslip(payslipId, updateData) {
    try {
      const docRef = doc(db, COLLECTIONS.PAYSLIPS, payslipId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
      
      const updatedDoc = await getDoc(docRef);
      return {
        id: updatedDoc.id,
        ...updatedDoc.data()
      };
    } catch (error) {
      console.error('Error updating payslip:', error);
      throw error;
    }
  }

  static async getPayslipById(payslipId) {
    try {
      const docRef = doc(db, COLLECTIONS.PAYSLIPS, payslipId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        throw new Error('Payslip not found');
      }
    } catch (error) {
      console.error('Error fetching payslip by ID:', error);
      throw error;
    }
  }
}

export default ApiService;