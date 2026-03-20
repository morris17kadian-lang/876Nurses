import { db, auth, storage, app, firebaseConfig } from '../config/firebase';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  getStorage,
} from 'firebase/storage';
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
} from 'firebase/firestore';
import { getBackendBaseUrl } from './backendUtils';

const USERS_COLLECTION = 'users';
const APPOINTMENTS_COLLECTION = 'appointments';
const INVOICES_COLLECTION = 'invoices';
const SHIFT_REQUESTS_COLLECTION = 'shiftRequests';
const CONSULTATION_REQUESTS_COLLECTION = 'consultationRequests';
const MEDICAL_REPORT_REQUESTS_COLLECTION = 'medicalReportRequests';
const PAYSLIPS_COLLECTION = 'payslips';
const ENABLE_USERNAME_LOOKUP_DEBUG = false;
const logUsernameLookupWarning = (...args) => {
  if (ENABLE_USERNAME_LOOKUP_DEBUG) {
    console.warn(...args);
  }
};

class FirebaseService {
  // ==================== HELPERS ====================
  
  /**
   * Recursively sanitize data for Firestore by removing undefined values
   * Firestore rejects undefined but accepts null
   */
  static sanitizeFirestoreData(value) {
    if (value === undefined) {
      return undefined;
    }
    
    if (Array.isArray(value)) {
      return value.map((item) => {
        const sanitizedItem = FirebaseService.sanitizeFirestoreData(item);
        // Convert undefined to null in arrays (Firestore-safe)
        return sanitizedItem === undefined ? null : sanitizedItem;
      });
    }
    
    if (value && typeof value === 'object' && 
        !(value instanceof Date) && !(value instanceof Timestamp)) {
      const sanitized = {};
      Object.keys(value).forEach((key) => {
        const sanitizedValue = FirebaseService.sanitizeFirestoreData(value[key]);
        // Only add key if the sanitized value is not undefined
        if (sanitizedValue !== undefined) {
          sanitized[key] = sanitizedValue;
        }
      });
      return sanitized;
    }
    
    return value;
  }

  /**
   * Normalize phone numbers for consistent lookups.
   * Current strategy: keep digits only.
   */
  static normalizePhoneNumber(phone) {
    const raw = (phone || '').toString();
    const digitsOnly = raw.replace(/\D+/g, '');
    return digitsOnly;
  }
  
  // ==================== USER OPERATIONS ====================
  
  /**
   * Create or update user profile
   */
  static async createUser(userId, userData) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      
      // Sanitize userData to remove undefined values
      const sanitizedUserData = FirebaseService.sanitizeFirestoreData(userData || {}) || {};

      const normalizedPhone =
        sanitizedUserData.phoneNormalized ||
        (sanitizedUserData.phone ? FirebaseService.normalizePhoneNumber(sanitizedUserData.phone) : '');
      
      const userWithTimestamp = {
        ...sanitizedUserData,
        ...(normalizedPhone ? { phoneNormalized: normalizedPhone } : {}),
        country: sanitizedUserData.country || 'Jamaica', // Default country
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      
      await setDoc(userRef, userWithTimestamp);
      return { success: true, user: userWithTimestamp };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Upload an image to Firebase Storage
   * @param {string} uri - The local URI of the image
   * @param {string} path - The storage path (e.g., 'profile-photos/uid/image.jpg')
   * @returns {Promise<string>} - The download URL
   */
  static async uploadImage(uri, path) {
    try {
      if (!uri) {
        return { success: false, error: 'No image URI provided' };
      }

      // Ensure we always have a stable storage path to avoid 404s from undefined segments
      const safePath = ((path || '').trim() || 'uploads/unknown/profile-photo.jpg')
        .replace(/^\/*/, '') // no leading slashes
        .replace(/\s+/g, '-');

      const configuredBucket =
        storage?.app?.options?.storageBucket ||
        firebaseConfig?.storageBucket ||
        null;

      const bucketCandidates = [configuredBucket].filter(Boolean);
      if (configuredBucket?.endsWith('.appspot.com')) {
        bucketCandidates.push(configuredBucket.replace(/\.appspot\.com$/, '.firebasestorage.app'));
      }
      if (configuredBucket?.endsWith('.firebasestorage.app')) {
        bucketCandidates.push(configuredBucket.replace(/\.firebasestorage\.app$/, '.appspot.com'));
      }
      const uniqueBuckets = [...new Set(bucketCandidates)].filter(Boolean);

      console.log('🖼️ Starting image upload:', uri);
      console.log('📁 Storage path:', safePath);
      console.log('🪣 Storage bucket candidates:', uniqueBuckets.length ? uniqueBuckets.join(' | ') : 'unknown');

      // Derive a better content type from the uri extension (fallback to jpeg)
      const extension = (uri.split('.').pop() || '').toLowerCase();
      const contentType =
        extension === 'pdf'
          ? 'application/pdf'
          : extension === 'png'
            ? 'image/png'
            : extension === 'webp'
              ? 'image/webp'
              : 'image/jpeg';

      // Convert URI to Blob with a resilient fetch/XHR fallback (Expo/React Native friendly)
      const buildBlob = async () => {
        // Handle data URLs directly
        if (uri.startsWith('data:')) {
          const base64Data = uri.split(',')[1];
          const byteChars = atob(base64Data);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i += 1) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          return new Blob([byteArray], { type: contentType });
        }

        // Try fetch first (works for file://, https://, and content:// in Expo/React Native)
        try {
          const response = await fetch(uri);
          const blob = await response.blob();
          return blob;
        } catch (fetchErr) {
          console.warn('Fetch to blob failed, retrying with XHR', fetchErr?.message || fetchErr);
        }

        // Fallback to XHR
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = function () {
            resolve(xhr.response);
          };
          xhr.onerror = function (e) {
            console.error('XHR Error:', e);
            reject(new TypeError('Network request failed'));
          };
          xhr.responseType = 'blob';
          xhr.open('GET', uri, true);
          xhr.send(null);
        });
      };

      const blob = await buildBlob();
      if (!blob) {
        return { success: false, error: 'Unable to build image blob for upload' };
      }

      console.log('📦 Blob created successfully:', blob.size, 'bytes');

      const metadata = { contentType };

      const tryUploadToStorage = async (storageInstance, bucketLabel) => {
        const storageRef = ref(storageInstance, safePath);
        console.log(`🚀 Uploading bytes to bucket: ${bucketLabel} ...`);
        await uploadBytes(storageRef, blob, metadata);
        console.log('✅ Upload completed');
        const downloadURL = await getDownloadURL(storageRef);
        console.log('🔗 URL retrieved:', downloadURL);
        return downloadURL;
      };

      // Primary attempt: use the already-initialized storage instance
      try {
        const url = await tryUploadToStorage(storage, configuredBucket || 'default');
        return { success: true, url };
      } catch (primaryError) {
        // If this is a bucket mismatch / not-provisioned bucket scenario, retry with alternate bucket naming.
        const status = primaryError?.status_;
        const serverResponse = primaryError?.customData?.serverResponse;
        const is404ish = status === 404 || (typeof serverResponse === 'string' && serverResponse.includes('404'));
        const isUnknown = primaryError?.code === 'storage/unknown';

        if (!app || !uniqueBuckets.length || (!isUnknown && !is404ish)) {
          throw primaryError;
        }

        // Retry using alternate bucket domain(s)
        for (const bucketName of uniqueBuckets) {
          if (!bucketName || bucketName === configuredBucket) continue;
          try {
            const bucketUrl = bucketName.startsWith('gs://') ? bucketName : `gs://${bucketName}`;
            const storageAlt = getStorage(app, bucketUrl);
            const url = await tryUploadToStorage(storageAlt, bucketName);
            return { success: true, url };
          } catch (retryError) {
            console.warn('Retry upload failed for bucket:', bucketName, retryError?.message || retryError);
          }
        }

        // If all retries failed, rethrow the original
        throw primaryError;
      }
    } catch (error) {
      // Log as much detail as possible to help diagnose Storage 404/unknown errors
      console.error('❌ Error uploading image (Full):', JSON.stringify(error, null, 2));
      console.error('❌ Error Message:', error?.message);
      if (error?.customData?.serverResponse) {
        console.error('❌ Server response:', error.customData.serverResponse);
      }

      // Map common Storage errors to clearer guidance
      if (error?.code === 'storage/unknown') {
        return { success: false, error: 'Storage configuration error. Verify storage bucket, path, and Firebase Storage rules.' };
      }
      if (error?.code === 'storage/unauthorized') {
        return { success: false, error: 'Permission denied. Check Firebase Storage rules or authentication.' };
      }
      if (error?.code === 'storage/canceled') {
        return { success: false, error: 'Upload canceled by user.' };
      }

      return { success: false, error: error?.message || 'Image upload failed' };
    }
  }

  /**
   * Create staff profile in role-specific collection (admins or nurses)
   */
  static async createStaffProfile(userId, userData, role) {
    try {
      const collectionName = role === 'admin' ? 'admins' : role === 'nurse' ? 'nurses' : USERS_COLLECTION;
      const staffRef = doc(db, collectionName, userId);

      const normalizedPhone =
        userData?.phoneNormalized ||
        (userData?.phone ? FirebaseService.normalizePhoneNumber(userData.phone) : '');

      const resolvedBanking = userData?.bankingDetails || (
        userData?.bankName || userData?.accountNumber || userData?.accountHolderName || userData?.bankBranch
          ? {
              bankName: userData.bankName || 'Not provided',
              accountNumber: userData.accountNumber || 'Not provided',
              accountHolderName: userData.accountHolderName || userData.fullName || userData.username || 'Not provided',
              bankBranch: userData.bankBranch || 'Not provided',
              currency: userData.bankingDetails?.currency || 'JMD',
            }
          : null
      );
      const staffWithTimestamp = {
        ...userData,
        ...(normalizedPhone ? { phoneNormalized: normalizedPhone } : {}),
        role: role || userData.role || 'nurse',
        username: userData.username || userData.code || userData.nurseCode || userData.adminCode,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...(resolvedBanking
          ? {
              bankingDetails: {
                bankName: resolvedBanking.bankName || 'Not provided',
                accountNumber: resolvedBanking.accountNumber || 'Not provided',
                accountHolderName: resolvedBanking.accountHolderName || 'Not provided',
                bankBranch: resolvedBanking.bankBranch || 'Not provided',
                currency: resolvedBanking.currency || 'JMD',
              },
              bankName: resolvedBanking.bankName || userData.bankName,
              accountNumber: resolvedBanking.accountNumber || userData.accountNumber,
              accountHolderName: resolvedBanking.accountHolderName || userData.accountHolderName,
              bankBranch: resolvedBanking.bankBranch || userData.bankBranch,
            }
          : {}),
      };
      await setDoc(staffRef, staffWithTimestamp);
      return { success: true, user: staffWithTimestamp };
    } catch (error) {
      console.error('Error creating staff profile:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user profile by UID - searches across all collections (users, nurses, admins)
   */
  static async getUser(userId) {
    try {
      // Fetch all possible profiles; prefer admins/nurses over users.
      const [adminSnap, nurseSnap, userSnap] = await Promise.all([
        getDoc(doc(db, 'admins', userId)),
        getDoc(doc(db, 'nurses', userId)),
        getDoc(doc(db, USERS_COLLECTION, userId)),
      ]);

      if (adminSnap.exists()) {
        return { success: true, user: { id: adminSnap.id, ...adminSnap.data() }, collection: 'admins' };
      }

      if (nurseSnap.exists()) {
        return { success: true, user: { id: nurseSnap.id, ...nurseSnap.data() }, collection: 'nurses' };
      }

      if (userSnap.exists()) {
        return { success: true, user: { id: userSnap.id, ...userSnap.data() }, collection: USERS_COLLECTION };
      }

      return { success: false, error: 'User not found in any collection' };
    } catch (error) {
      // Silently handle offline errors to prevent app crashes
      if (error?.code === 'unavailable' || error?.message?.includes('offline')) {
        return { success: false, error: 'offline', offline: true };
      }
      console.error('Error getting user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user profile
   */
  static async updateUser(userId, updates = {}) {
    try {
      const targets = [];
      const collectionsToCheck = ['admins', 'nurses', USERS_COLLECTION];

      // 1. Try direct document lookup by ID
      if (userId) {
        for (const col of collectionsToCheck) {
          const candidateRef = doc(db, col, userId);
          const candidateSnap = await getDoc(candidateRef);
          if (candidateSnap.exists()) {
            targets.push({ ref: candidateRef, collection: col, id: userId });
          }
        }
      }

      const identifierCandidate = (updates.code || updates.nurseCode || updates.adminCode || updates.username || '').trim();
      const emailCandidateRaw = (updates.email || '').trim();

      // 2. Fallback: look up by known identifiers (nurseCode/adminCode/username/email)
      const identifierLookups = [];
      if (!targets.length && identifierCandidate) {
        const normalized = identifierCandidate.toUpperCase();
        identifierLookups.push(
          { collectionName: 'nurses', field: 'nurseCode', value: normalized },
          { collectionName: 'admins', field: 'adminCode', value: normalized },
          { collectionName: USERS_COLLECTION, field: 'username', value: normalized }
        );
      }

      if (!targets.length && emailCandidateRaw) {
        const emailCandidates = [emailCandidateRaw, emailCandidateRaw.toLowerCase()].filter((v, idx, arr) => v && arr.indexOf(v) === idx);
        emailCandidates.forEach((value) => {
          identifierLookups.push(
            { collectionName: 'nurses', field: 'email', value },
            { collectionName: 'admins', field: 'email', value },
            { collectionName: USERS_COLLECTION, field: 'email', value }
          );
        });
      }

      for (const lookup of identifierLookups) {
        if (targets.length) break;
        const q = query(
          collection(db, lookup.collectionName),
          where(lookup.field, '==', lookup.value),
          limit(1)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          targets.push({
            ref: doc(db, lookup.collectionName, docSnap.id),
            collection: lookup.collectionName,
            id: docSnap.id
          });
        }
      }

      if (!targets.length) {
        console.warn('⚠️ FirebaseService.updateUser: No matching user document found for update', {
          userId,
          identifier: identifierCandidate,
          email: emailCandidateRaw,
        });
        return { success: false, error: 'User document not found for update' };
      }

      // 3. Apply updates to all identified documents (ensures data parity between collections)
      const payload = {
        ...updates,
        updatedAt: Timestamp.now(),
      };

      await Promise.all(targets.map(({ ref }) => setDoc(ref, payload, { merge: true })));

      return { success: true };
    } catch (error) {
      // Silently handle offline errors to prevent app crashes
      if (error?.code === 'unavailable' || error?.message?.includes('offline')) {
        return { success: false, error: 'offline', offline: true };
      }
      console.error('Error updating user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user by email
   */
  static async getUserByEmail(email) {
    try {
      const q = query(collection(db, USERS_COLLECTION), where('email', '==', email));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        const user = querySnapshot.docs[0];
        return { success: true, user: { id: user.id, ...user.data() } };
      }
      return { success: false, error: 'User not found' };
    } catch (error) {
      console.error('Error getting user by email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user by phone across collections (users, nurses, admins)
   */
  static async getUserByPhone(phone) {
    try {
      const raw = (phone || '').toString().trim();
      if (!raw) {
        return { success: false, error: 'Phone number is required' };
      }

      const normalized = FirebaseService.normalizePhoneNumber(raw);
      const collectionsToCheck = ['admins', 'nurses', USERS_COLLECTION];

      const tryLookup = async (collectionName, field, value) => {
        const q = query(collection(db, collectionName), where(field, '==', value), limit(1));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          return { id: docSnap.id, ...docSnap.data(), __collection: collectionName };
        }
        return null;
      };

      // 1) Prefer normalized match when available
      if (normalized) {
        for (const col of collectionsToCheck) {
          const found = await tryLookup(col, 'phoneNormalized', normalized);
          if (found) {
            const { __collection, ...user } = found;
            return { success: true, user, collection: __collection };
          }
        }
      }

      // 2) Fallback: raw/exact match on stored phone field
      const candidates = [...new Set([raw, normalized].filter(Boolean))];
      for (const candidate of candidates) {
        for (const col of collectionsToCheck) {
          const found = await tryLookup(col, 'phone', candidate);
          if (found) {
            const { __collection, ...user } = found;
            return { success: true, user, collection: __collection };
          }
        }
      }

      return { success: false, error: 'User not found' };
    } catch (error) {
      // Silently handle offline errors to prevent app crashes
      if (error?.code === 'unavailable' || error?.message?.includes('offline')) {
        return { success: false, error: 'offline', offline: true };
      }
      console.error('Error getting user by phone:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user by username across all user collections (users, nurses, admins)
   * Checks 'username' for users, 'nurseCode' for nurses, and 'adminCode' for admins
   */
  static async getUserByUsername(username) {
    const sanitizedUsername = (username || '').trim();
    const normalizedUsername = sanitizedUsername.toUpperCase();
    if (!sanitizedUsername) {
      return { success: false, error: 'Username is required' };
    }

    const normalizeUserForAuth = (user) => {
      if (!user || typeof user !== 'object') return user;
      const resolvedEmail = (user.email || user.contactEmail || user.contact_email || '').toString().trim();
      return {
        ...user,
        ...(resolvedEmail ? { email: resolvedEmail } : {}),
      };
    };

    const lookupViaBackend = async () => {
      const baseUrl = getBackendBaseUrl();
      if (!baseUrl) {
        throw new Error('Backend base URL is not configured');
      }

      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/lookup-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Prefer uppercase for staff codes (ADMIN001/NURSE###). Backend can still accept mixed-case.
        body: JSON.stringify({ username: normalizedUsername || sanitizedUsername }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success && data.user) {
        return { success: true, user: normalizeUserForAuth(data.user) };
      }

      const message = data?.error || 'User lookup failed';
      // Force fallback to Firestore for 404s (e.g., local admin accounts or offline)
      if (response.status === 404) {
        throw new Error('User not found in backend');
      }

      throw new Error(message);
    };

    try {
      return await lookupViaBackend();
    } catch (backendError) {
      logUsernameLookupWarning('Username lookup via backend failed, attempting Firestore fallback:', backendError?.message || backendError);

      // Try Firestore fallback regardless of auth state (rules now allow public reads)
      try {
        // Try both original casing and uppercase (covers older docs that stored lowercase).
        const fallbackResult =
          (await FirebaseService._getUserByUsernameFromFirestore(sanitizedUsername))
          || (normalizedUsername !== sanitizedUsername
            ? await FirebaseService._getUserByUsernameFromFirestore(normalizedUsername)
            : null);
        if (fallbackResult) {
          return { success: true, user: normalizeUserForAuth(fallbackResult) };
        }
        return { success: false, error: 'User not found' };
      } catch (firestoreError) {
        console.error('Error getting user by username from Firestore:', firestoreError);
        return { success: false, error: firestoreError?.message || 'Unable to lookup username' };
      }
    }
  }

  static async _getUserByUsernameFromFirestore(username) {
    // 1. Check users collection (uses 'username' field)
    const userQuery = query(collection(db, 'users'), where('username', '==', username));
    const userSnap = await getDocs(userQuery);
    if (!userSnap.empty) {
      const user = userSnap.docs[0];
      return { id: user.id, ...user.data() };
    }

    // 2. Check nurses collection (uses 'nurseCode' or 'code' field)
    // Firestore doesn't support logical OR on different fields in one query efficiently.
    const nurseQuery1 = query(collection(db, 'nurses'), where('nurseCode', '==', username));
    const nurseSnap1 = await getDocs(nurseQuery1);
    if (!nurseSnap1.empty) {
      const nurse = nurseSnap1.docs[0];
      return { id: nurse.id, ...nurse.data() };
    }

    const nurseQuery2 = query(collection(db, 'nurses'), where('code', '==', username));
    const nurseSnap2 = await getDocs(nurseQuery2);
    if (!nurseSnap2.empty) {
      const nurse = nurseSnap2.docs[0];
      return { id: nurse.id, ...nurse.data() };
    }

    // 3. Check admins collection (uses 'adminCode' or 'code' field)
    const adminQuery1 = query(collection(db, 'admins'), where('adminCode', '==', username));
    const adminSnap1 = await getDocs(adminQuery1);
    if (!adminSnap1.empty) {
      const admin = adminSnap1.docs[0];
      return { id: admin.id, ...admin.data() };
    }

    const adminQuery2 = query(collection(db, 'admins'), where('code', '==', username));
    const adminSnap2 = await getDocs(adminQuery2);
    if (!adminSnap2.empty) {
      const admin = adminSnap2.docs[0];
      return { id: admin.id, ...admin.data() };
    }
    
    // 4. Check nurses/admins/users by 'username' field as generic fallback
    for (const col of ['nurses', 'admins']) {
      const genericQuery = query(collection(db, col), where('username', '==', username));
      const genericSnap = await getDocs(genericQuery);
      if (!genericSnap.empty) {
        const doc = genericSnap.docs[0];
        return { id: doc.id, ...doc.data() };
      }
    }

    return null;
  }



  /**
   * Get all nurses from Firestore (nurses collection and users with role='nurse')
   */
  static async getAllNurses() {
    try {
      const nurses = [];
      
      // 1. Get from 'nurses' collection
      const nursesSnap = await getDocs(collection(db, 'nurses'));
      nursesSnap.forEach((doc) => {
        nurses.push({ id: doc.id, ...doc.data() });
      });

      // 2. Get from 'users' collection where role is 'nurse'
      const usersQuery = query(collection(db, 'users'), where('role', '==', 'nurse'));
      const usersSnap = await getDocs(usersQuery);
      usersSnap.forEach((doc) => {
        // Avoid duplicates if user exists in both
        if (!nurses.some(n => n.id === doc.id)) {
          nurses.push({ id: doc.id, ...doc.data() });
        }
      });

      return { success: true, nurses };
    } catch (error) {
      console.error('Error getting all nurses:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete user profile from all collections
   */
  static async deleteUser(userId) {
    try {
      await Promise.all([
        deleteDoc(doc(db, 'admins', userId)),
        deleteDoc(doc(db, 'nurses', userId)),
        deleteDoc(doc(db, USERS_COLLECTION, userId)),
      ]);
      return { success: true };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete user-related data across collections (appointments, invoices, notifications, privacy settings, data requests)
   */
  static async deleteUserData(userId) {
    try {
      if (!userId) {
        return { success: false, error: 'UserId is required' };
      }

      const collectionsToClean = [
        { name: APPOINTMENTS_COLLECTION, fields: ['userId', 'patientId', 'clientId'] },
        { name: INVOICES_COLLECTION, fields: ['userId', 'patientId', 'clientId', 'customerId'] },
        { name: 'notifications', fields: ['userId'] },
        { name: 'privacySettings', fields: ['userId'] },
        { name: 'dataRequests', fields: ['userId'] },
        { name: SHIFT_REQUESTS_COLLECTION, fields: ['requestedBy', 'clientId', 'patientId'] },
      ];

      const refMap = new Map();
      const addRefs = (snapshot) => {
        snapshot.forEach((docSnap) => {
          refMap.set(docSnap.ref.path, docSnap.ref);
        });
      };

      for (const entry of collectionsToClean) {
        const base = collection(db, entry.name);
        for (const field of entry.fields) {
          const q = query(base, where(field, '==', String(userId)));
          const snapshot = await getDocs(q);
          addRefs(snapshot);
        }
      }

      // Also delete privacySettings doc by userId if it exists
      refMap.set(doc(db, 'privacySettings', String(userId)).path, doc(db, 'privacySettings', String(userId)));

      const refs = Array.from(refMap.values());
      const batchSize = 450;
      for (let i = 0; i < refs.length; i += batchSize) {
        const batch = writeBatch(db);
        refs.slice(i, i + batchSize).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      return { success: true, deletedCount: refs.length };
    } catch (error) {
      console.error('Error deleting user data:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== APPOINTMENT OPERATIONS ====================

  static async createAppointment(appointmentId, appointmentData) {
    try {
      const appointmentRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
      const appointmentWithTimestamp = {
        ...appointmentData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      await setDoc(appointmentRef, appointmentWithTimestamp);
      return { success: true, appointment: appointmentWithTimestamp };
    } catch (error) {
      console.error('Error creating appointment:', error);
      return { success: false, error: error.message };
    }
  }

  static async getAppointments(userId) {
    try {
      const q = query(
        collection(db, APPOINTMENTS_COLLECTION),
        where('userId', '==', userId),
        orderBy('appointmentDate', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const appointments = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      return { success: true, appointments };
    } catch (error) {
      console.error('Error getting appointments:', error);
      return { success: false, error: error.message };
    }
  }

  static async updateAppointment(appointmentId, updates) {
    try {
      const appointmentRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
      await updateDoc(appointmentRef, {
        ...updates,
        updatedAt: Timestamp.now(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating appointment:', error);
      return { success: false, error: error.message };
    }
  }

  static async deleteAppointment(appointmentId) {
    try {
      const appointmentRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
      await deleteDoc(appointmentRef);
      return { success: true };
    } catch (error) {
      console.error('Error deleting appointment:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== INVOICE OPERATIONS ====================

  static async createInvoice(invoiceId, invoiceData) {
    try {
      const invoiceRef = doc(db, INVOICES_COLLECTION, invoiceId);
      const invoiceWithTimestamp = {
        ...invoiceData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      await setDoc(invoiceRef, invoiceWithTimestamp);
      return { success: true, invoice: invoiceWithTimestamp };
    } catch (error) {
      console.error('Error creating invoice:', error);
      return { success: false, error: error.message };
    }
  }

  static async getInvoices(userId) {
    try {
      const q = query(
        collection(db, INVOICES_COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const invoices = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      return { success: true, invoices };
    } catch (error) {
      console.error('Error getting invoices:', error);
      return { success: false, error: error.message };
    }
  }

  static async updateInvoice(invoiceId, updates) {
    try {
      const invoiceRef = doc(db, INVOICES_COLLECTION, invoiceId);
      await updateDoc(invoiceRef, {
        ...updates,
        updatedAt: Timestamp.now(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating invoice:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== SHIFT REQUEST OPERATIONS ====================

  // ==================== CONSULTATION REQUEST OPERATIONS ====================

  /**
   * Create a paid/scheduled consultation request (patient-facing).
   */
  static async createConsultationRequest(requestData) {
    try {
      const colRef = collection(db, CONSULTATION_REQUESTS_COLLECTION);
      const docRef = doc(colRef);

      const sanitized = FirebaseService.sanitizeFirestoreData(requestData || {}) || {};
      const payload = {
        id: docRef.id,
        status: sanitized.status || 'pending',
        ...sanitized,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      await setDoc(docRef, payload);
      return { success: true, id: docRef.id, request: payload };
    } catch (error) {
      console.error('Error creating consultation request:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get upcoming consultation requests for a patient.
   * @param {string} patientAuthUid - The Firebase Auth UID of the patient
   */
  static async getUpcomingConsultationRequestsForPatient(patientAuthUid, limitCount = 1) {
    try {
      if (!patientAuthUid) {
        return { success: true, requests: [] };
      }

      const colRef = collection(db, CONSULTATION_REQUESTS_COLLECTION);
      // Query by patientAuthUid to match Firestore security rules
      const q = query(colRef, where('patientAuthUid', '==', patientAuthUid), limit(50));

      const snapshot = await getDocs(q);
      const now = Date.now();

      const toMillis = (v) => {
        try {
          if (!v) return null;
          if (typeof v?.toDate === 'function') return v.toDate().getTime();
          if (v?.seconds != null) return v.seconds * 1000;
          const d = new Date(v);
          const ms = d.getTime();
          return Number.isNaN(ms) ? null : ms;
        } catch (_) {
          return null;
        }
      };

      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const upcoming = all
        .map((r) => ({ r, ms: toMillis(r.scheduledFor || r.scheduledForIso) }))
        .filter((x) => typeof x.ms === 'number' && x.ms >= now)
        .sort((a, b) => a.ms - b.ms)
        .slice(0, Math.max(1, Number(limitCount) || 1))
        .map((x) => x.r);

      return { success: true, requests: upcoming };
    } catch (error) {
      console.error('Error fetching upcoming consultation requests:', error);
      return { success: false, error: error.message, requests: [] };
    }
  }

  /**
   * Admin: Get newest pending consultation requests.
   */
  static async getPendingConsultationRequests(limitCount = 50) {
    try {
      const colRef = collection(db, CONSULTATION_REQUESTS_COLLECTION);
      // Avoid composite index requirements by ordering only, then filtering client-side.
      const q = query(colRef, orderBy('createdAt', 'desc'), limit(Math.max(1, Number(limitCount) || 50)));

      const snapshot = await getDocs(q);
      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Filter out completed and called requests
      const requests = all.filter((r) => {
        const status = String(r?.status || '').toLowerCase();
        return status === 'pending' || status === 'call_requested';
      });
      return { success: true, requests };
    } catch (error) {
      // Silently handle permission errors - user may need to log out/in after admin role update
      // Only log in dev mode for debugging
      if (__DEV__ && !error.message?.includes('permissions')) {
        console.error('Error fetching pending consultation requests:', error);
      }
      return { success: false, error: error.message, requests: [] };
    }
  }

  /**
   * Admin: Update a consultation request.
   */
  static async updateConsultationRequest(requestId, updates) {
    try {
      if (!requestId) {
        return { success: false, error: 'Request ID is required' };
      }

      const requestRef = doc(db, CONSULTATION_REQUESTS_COLLECTION, requestId);
      const sanitized = FirebaseService.sanitizeFirestoreData(updates || {}) || {};
      await updateDoc(requestRef, {
        ...sanitized,
        updatedAt: Timestamp.now(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating consultation request:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== MEDICAL REPORT REQUEST OPERATIONS ====================

  /**
   * Create a paid medical report request (patient-facing).
   */
  static async createMedicalReportRequest(requestData) {
    try {
      const colRef = collection(db, MEDICAL_REPORT_REQUESTS_COLLECTION);
      const docRef = doc(colRef);

      const sanitized = FirebaseService.sanitizeFirestoreData(requestData || {}) || {};
      const payload = {
        id: docRef.id,
        status: sanitized.status || 'pending',
        ...sanitized,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      console.log('💾 FirebaseService: Creating medical report request:', { docId: docRef.id, payload });
      await setDoc(docRef, payload);
      console.log('✅ FirebaseService: Medical report request created successfully');
      return { success: true, id: docRef.id, request: payload };
    } catch (error) {
      console.error('❌ FirebaseService: Error creating medical report request:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Admin: Get newest pending medical report requests.
   */
  static async getPendingMedicalReportRequests(limitCount = 50) {
    try {
      console.log('🔍 FirebaseService: getPendingMedicalReportRequests called');
      const colRef = collection(db, MEDICAL_REPORT_REQUESTS_COLLECTION);
      // Avoid composite index requirements by ordering only, then filtering client-side.
      const q = query(colRef, orderBy('createdAt', 'desc'), limit(Math.max(1, Number(limitCount) || 50)));

      const snapshot = await getDocs(q);
      const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      console.log('📋 FirebaseService: All medical report requests:', { total: all.length, all });
      const requests = all.filter((r) => String(r?.status || '').toLowerCase() === 'pending');
      console.log('📋 FirebaseService: Filtered pending requests:', { count: requests.length, requests });
      return { success: true, requests };
    } catch (error) {
      console.error('❌ FirebaseService: Error fetching pending medical report requests:', {
        message: error.message,
        code: error.code,
        isPermissionError: error.message?.toLowerCase().includes('permission')
      });
      return { success: false, error: error.message, requests: [] };
    }
  }

  static async updateMedicalReportRequest(requestId, updates) {
    try {
      if (!requestId) {
        return { success: false, error: 'Request ID is required' };
      }

      const requestRef = doc(db, MEDICAL_REPORT_REQUESTS_COLLECTION, requestId);
      const sanitized = FirebaseService.sanitizeFirestoreData(updates || {}) || {};
      await updateDoc(requestRef, {
        ...sanitized,
        updatedAt: Timestamp.now(),
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating medical report request:', error);
      return { success: false, error: error.message };
    }
  }

  static async createShiftRequest(shiftId, shiftData) {
    try {
      const shiftRef = doc(db, SHIFT_REQUESTS_COLLECTION, shiftId);
      const shiftWithTimestamp = {
        ...shiftData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      await setDoc(shiftRef, shiftWithTimestamp);
      return { success: true, shiftRequest: shiftWithTimestamp };
    } catch (error) {
      console.error('Error creating shift request:', error);
      return { success: false, error: error.message };
    }
  }

  static async getShiftRequests(userId) {
    try {
      const q = query(
        collection(db, SHIFT_REQUESTS_COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const shiftRequests = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      return { success: true, shiftRequests };
    } catch (error) {
      console.error('Error getting shift requests:', error);
      return { success: false, error: error.message };
    }
  }

  static async getShiftRequestById(shiftId) {
    try {
      const shiftRef = doc(db, SHIFT_REQUESTS_COLLECTION, shiftId);
      const shiftSnap = await getDoc(shiftRef);
      if (!shiftSnap.exists()) {
        return { success: false, error: 'Shift request not found' };
      }
      return {
        success: true,
        shiftRequest: {
          id: shiftSnap.id,
          ...shiftSnap.data(),
        },
      };
    } catch (error) {
      console.error('Error getting shift request by id:', error);
      return { success: false, error: error.message };
    }
  }

  static async getAppointmentById(appointmentId) {
    try {
      const appointmentRef = doc(db, APPOINTMENTS_COLLECTION, appointmentId);
      const appointmentSnap = await getDoc(appointmentRef);
      if (!appointmentSnap.exists()) {
        return { success: false, error: 'Appointment not found' };
      }
      return {
        success: true,
        appointment: {
          id: appointmentSnap.id,
          ...appointmentSnap.data(),
        },
      };
    } catch (error) {
      console.error('Error getting appointment by id:', error);
      return { success: false, error: error.message };
    }
  }

  static async updateShiftRequest(shiftId, updates) {
    try {
      const shiftRef = doc(db, SHIFT_REQUESTS_COLLECTION, shiftId);
      await updateDoc(shiftRef, {
        ...updates,
        updatedAt: Timestamp.now(),
      });
      return { success: true };
    } catch (error) {
      const notFound = error?.code === 'not-found'
        || /No document to update/i.test(error?.message || '');
      if (notFound) {
        try {
          const appointmentRef = doc(db, APPOINTMENTS_COLLECTION, shiftId);
          await updateDoc(appointmentRef, {
            ...updates,
            updatedAt: Timestamp.now(),
          });
          return { success: true, source: 'appointments' };
        } catch (appointmentError) {
          console.error('Error updating appointment (fallback):', appointmentError);
          return { success: false, error: appointmentError.message };
        }
      }

      console.error('Error updating shift request:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== PAYSLIP OPERATIONS ====================

  static async createPayslip(payslipId, payslipData) {
    try {
      const payslipRef = doc(db, PAYSLIPS_COLLECTION, payslipId);
      const payslipWithTimestamp = {
        ...payslipData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      await setDoc(payslipRef, payslipWithTimestamp);
      return { success: true, payslip: payslipWithTimestamp };
    } catch (error) {
      console.error('Error creating payslip:', error);
      return { success: false, error: error.message };
    }
  }

  static async getPayslips(userId) {
    try {
      const q = query(
        collection(db, PAYSLIPS_COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const payslips = querySnapshot.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
      }));
      return { success: true, payslips };
    } catch (error) {
      console.error('Error getting payslips:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== BATCH OPERATIONS ====================

  /**
   * Batch create multiple documents
   */
  static async batchCreate(operations) {
    try {
      const batch = writeBatch(db);
      
      operations.forEach(({ collection: collectionName, docId, data }) => {
        const docRef = doc(db, collectionName, docId);
        batch.set(docRef, {
          ...data,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      });

      await batch.commit();
      return { success: true };
    } catch (error) {
      console.error('Error in batch create:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete all nurses (Hard Reset)
   */
  static async deleteAllNurses() {
    try {
      const batch = writeBatch(db);
      let count = 0;

      // 1. Get all from 'nurses' collection
      const nursesSnap = await getDocs(collection(db, 'nurses'));
      nursesSnap.forEach((doc) => {
        batch.delete(doc.ref);
        count++;
      });

      // 2. Get all from 'users' collection where role is 'nurse'
      const usersQuery = query(collection(db, 'users'), where('role', '==', 'nurse'));
      const usersSnap = await getDocs(usersQuery);
      usersSnap.forEach((doc) => {
        batch.delete(doc.ref);
        count++;
      });

      if (count > 0) {
        await batch.commit();
      }
      
      return { success: true, count };
    } catch (error) {
      console.error('Error deleting all nurses:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Batch update multiple documents
   */
  static async batchUpdate(operations) {
    try {
      const batch = writeBatch(db);
      
      operations.forEach(({ collection: collectionName, docId, data }) => {
        const docRef = doc(db, collectionName, docId);
        batch.update(docRef, {
          ...data,
          updatedAt: Timestamp.now(),
        });
      });

      await batch.commit();
      return { success: true };
    } catch (error) {
      console.error('Error in batch update:', error);
      return { success: false, error: error.message };
    }
  }
}

export default FirebaseService;
