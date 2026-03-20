import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  updateEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db, app } from '../config/firebase';
import FirebaseService from '../services/FirebaseService';
import PushNotificationService from '../services/PushNotificationService';
import { clearAllSequenceCache } from '../clear-sequence-cache';
import { queueWelcomeEmail } from '../services/welcomeEmail';

export const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Helper function to register push notification token
const registerPushToken = async (userId) => {
  try {
    const pushToken = await PushNotificationService.initialize();
    
    if (pushToken) {
      // Update user profile with FCM token
      const updateResult = await FirebaseService.updateUser(userId, { fcmToken: pushToken });
      if (!updateResult.offline) {
        console.log('✅ Push token successfully saved to user profile');
      }
    }
  } catch (error) {
    console.error('Push notification initialization failed:', error.message);
    // Don't fail login if push notifications fail
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // Prevent onAuthStateChanged from signing out mid-signup.
  const signupInProgressRef = useRef(false);

  // Option (c): allow staff accounts (admins/nurses) to bypass email verification.
  // This is less strict than patient verification and should be used intentionally.
  const looksLikeStaffCode = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    return /^(ADMIN|NURSE)\d+$/.test(normalized);
  };

  const isStaffProfile = (profile, collection) => {
    if (collection === 'admins' || collection === 'nurses') return true;

    const role = String(profile?.role || '').trim().toLowerCase();
    if (['admin', 'superadmin', 'nurse', 'admins', 'nurses'].includes(role)) return true;

    const codeCandidate = String(
      profile?.code || profile?.adminCode || profile?.nurseCode || profile?.username || ''
    ).trim();
    return looksLikeStaffCode(codeCandidate);
  };

  // Option 2 verification: email a 6-digit code and verify it in-app.
  // This avoids Firebase-hosted verification links entirely.
  const requestEmailVerificationCode = async (email) => {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return { success: false, error: 'Missing email address' };
      }

      const functions = getFunctions(app, 'us-central1');
      const requestFn = httpsCallable(functions, 'requestEmailVerificationCode');
      const result = await requestFn({ email: normalizedEmail });
      return { success: true, ...(result?.data || {}) };
    } catch (error) {
      console.error('Request email verification code error:', error);
      return {
        success: false,
        error: 'Unable to send verification code right now. Please try again.',
      };
    }
  };

  const verifyEmailVerificationCode = async (email, code) => {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedCode = String(code || '').trim();

      if (!normalizedEmail) {
        return { success: false, error: 'Missing email address' };
      }

      if (!normalizedCode) {
        return { success: false, error: 'Missing verification code' };
      }

      const functions = getFunctions(app, 'us-central1');
      const verifyFn = httpsCallable(functions, 'verifyEmailVerificationCode');
      const result = await verifyFn({ email: normalizedEmail, code: normalizedCode });
      return { success: true, ...(result?.data || {}) };
    } catch (error) {
      console.error('Verify email code error:', error);
      const message =
        error?.message ||
        'Unable to verify your code right now. Please request a new code and try again.';
      return { success: false, error: message };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        return { success: false, error: 'No authenticated user' };
      }

      if (!firebaseUser.email) {
        return { success: false, error: 'No email found for this account' };
      }

      // Firebase requires recent authentication for sensitive actions.
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
      return { success: true };
    } catch (error) {
      console.error('Change password error:', error);
      let errorMessage = error?.message || 'Failed to change password';
      if (error?.code === 'auth/wrong-password') {
        errorMessage = 'Current password is incorrect';
      } else if (error?.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak';
      } else if (error?.code === 'auth/requires-recent-login') {
        errorMessage = 'Please log out and log back in, then try again';
      }
      return { success: false, error: errorMessage };
    }
  };

  // Monitor Firebase auth state
  useEffect(() => {
    let unsubscribeSnapshot = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (unsubscribeSnapshot) {
          unsubscribeSnapshot();
          unsubscribeSnapshot = null;
        }

        if (firebaseUser) {
          const needsEmailVerification = !!(firebaseUser?.email && !firebaseUser.emailVerified);

          // User is logged in
          const userResult = await FirebaseService.getUser(firebaseUser.uid);

          // HARD email verification enforcement (with staff bypass).
          // Do not allow unverified non-staff accounts to be treated as authenticated in-app.
          if (needsEmailVerification) {
            const staffByProfile = userResult?.success && isStaffProfile(userResult.user, userResult.collection);
            if (!staffByProfile) {
              // Avoid interrupting the signup flow (profile creation + verification email).
              if (!signupInProgressRef.current) {
                try {
                  await signOut(auth);
                } catch (e) {
                  // Ignore sign out failures.
                }
              }

              setUser(null);
              await AsyncStorage.removeItem('user');
              await AsyncStorage.removeItem('authToken');
              return;
            }
          }
          
          // If offline, continue with cached user data
          if (userResult.offline) {
            console.log('📡 Offline - using cached user data');
            setIsLoading(false);
            return;
          }
          
          if (userResult.success) {
            const userData = {
              id: firebaseUser.uid,
              email: firebaseUser.email,
              ...userResult.user,
            };
            setUser(userData);
            // Save to AsyncStorage for offline access
            await AsyncStorage.setItem('user', JSON.stringify(userData));
            await AsyncStorage.setItem('authToken', firebaseUser.accessToken);

            // Setup Realtime Listener
            if (userResult.collection) {
              unsubscribeSnapshot = onSnapshot(doc(db, userResult.collection, firebaseUser.uid), async (docSnap) => {
                if (docSnap.exists()) {
                   const updatedData = { ...userData, ...docSnap.data() };
                   // console.log('🔄 AuthContext: Realtime profile update received', updatedData);
                   setUser(updatedData);
                   await AsyncStorage.setItem('user', JSON.stringify(updatedData));
                }
              });
            }
          }
        } else {
          // User is logged out
          setUser(null);
          await AsyncStorage.removeItem('user');
          await AsyncStorage.removeItem('authToken');
        }
      } catch (error) {
        console.error('Error in auth state change:', error);
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }
    };
  }, []);

  const login = async (usernameOrEmail, password) => {
    try {
      const DEBUG_AUTH = false;
      setIsLoading(true);
      if (__DEV__ && DEBUG_AUTH) {
        console.log('Attempting login for:', usernameOrEmail);
      }

      // Check if input is email or username
      let emailToUse = usernameOrEmail;
      let lookedUpProfile = null;
      let existingProfileResult = null;
      
      // If input doesn't contain @, treat it as username and look it up
      if (!usernameOrEmail.includes('@')) {
        if (__DEV__ && DEBUG_AUTH) {
          console.log('Detected username, looking up email...');
        }
        // Query Firestore for user with this username
        const usersCollection = await FirebaseService.getUserByUsername(usernameOrEmail);
        const resolvedLookupUser = usersCollection?.user;
        const resolvedEmail = (resolvedLookupUser?.email || resolvedLookupUser?.contactEmail || '').toString().trim();
        if (!usersCollection.success || !resolvedEmail) {
          console.error('Username lookup failed:', usersCollection.error);
          return { success: false, error: usersCollection?.error || 'Username not found' };
        }
        emailToUse = resolvedEmail;
        lookedUpProfile = usersCollection.user;
        if (__DEV__ && DEBUG_AUTH) {
          console.log('Username resolved to email:', emailToUse);
        }
      }

      // Sign in with Firebase using email
      if (__DEV__ && DEBUG_AUTH) {
        console.log('Signing in with Firebase Auth...');
      }
      const userCredential = await signInWithEmailAndPassword(auth, emailToUse, password);
      const firebaseUser = userCredential.user;

      // Ensure we have the latest emailVerified value.
      try {
        await firebaseUser.reload();
      } catch (e) {
        // Non-fatal if reload fails.
      }

      // HARD email verification enforcement (with staff bypass).
      if (firebaseUser?.email && !firebaseUser.emailVerified) {
        const loginLooksLikeStaff = looksLikeStaffCode(usernameOrEmail);
        const lookupLooksLikeStaff = lookedUpProfile ? isStaffProfile(lookedUpProfile) : false;

        let bypassVerification = loginLooksLikeStaff || lookupLooksLikeStaff;

        // If they signed in via email, best-effort check their profile collection.
        if (!bypassVerification) {
          try {
            existingProfileResult = await FirebaseService.getUser(firebaseUser.uid);
            if (existingProfileResult?.success && isStaffProfile(existingProfileResult.user, existingProfileResult.collection)) {
              bypassVerification = true;
            }
          } catch (e) {
            // Ignore lookup failures; fall back to enforcing verification.
          }
        }

        if (!bypassVerification) {
          // Best-effort: send a new verification code to help the user recover.
          try {
            await requestEmailVerificationCode(emailToUse);
          } catch (e) {
            // Ignore resend failures (rate limiting, network, etc.).
          }

          try {
            await signOut(auth);
          } catch (e) {
            // Ignore sign out failures.
          }

          return {
            success: false,
            needsEmailVerification: true,
            verificationEmail: emailToUse,
            error: 'Please verify your email before signing in. We sent a 6-digit verification code to your email address.',
          };
        }
      }
      if (__DEV__ && DEBUG_AUTH) {
        console.log('Firebase Auth success, UID:', firebaseUser.uid);
      }

      // Get user profile from Firestore.
      // IMPORTANT: if we logged in via username (ADMIN001/NURSE###), prefer the looked-up profile.
      let resolvedProfile = null;
      if (lookedUpProfile?.id && lookedUpProfile.id === firebaseUser.uid) {
        resolvedProfile = lookedUpProfile;
      } else if (existingProfileResult?.success) {
        resolvedProfile = existingProfileResult.user;
      } else {
        const userResult = await FirebaseService.getUser(firebaseUser.uid);
        if (userResult.offline) {
          // Can't fetch user profile while offline during login
          throw new Error('Cannot complete login while offline. Please check your connection.');
        }
        if (userResult.success) {
          resolvedProfile = userResult.user;
        }
      }

      if (!resolvedProfile) {
        // User exists in Auth but not in Firestore, create profile (patient default).
        // Staff accounts should never land here if Firestore contains their admin/nurse profile.
        const newUserData = {
          id: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || 'User',
          role: 'patient',
          createdAt: new Date().toISOString(),
        };

        await FirebaseService.createUser(firebaseUser.uid, newUserData);
        resolvedProfile = newUserData;
      }

      // Queue the welcome email ONLY after the user has verified their email AND successfully signed in.
      // To avoid sending to legacy accounts, we only queue when the profile explicitly opts-in
      // via `welcomeEmailQueued === false` (new signups).
      try {
        const shouldQueueWelcomeEmail = resolvedProfile?.welcomeEmailQueued === false;
        if (shouldQueueWelcomeEmail) {
          await queueWelcomeEmail(firebaseUser);
          const queuedAt = new Date().toISOString();
          await FirebaseService.updateUser(firebaseUser.uid, {
            welcomeEmailQueued: true,
            welcomeEmailQueuedAt: queuedAt,
          });
          resolvedProfile = {
            ...(resolvedProfile || {}),
            welcomeEmailQueued: true,
            welcomeEmailQueuedAt: queuedAt,
          };
        }
      } catch (emailError) {
        // Non-fatal if welcome email queuing fails.
        console.warn('Failed to queue welcome email after login:', emailError);
      }

      // Normalize the built-in super admin display details (ADMIN001).
      // This protects against old cached/profile values (e.g., "Shertonia Walker") lingering in Firestore/AsyncStorage.
      const normalizedLoginInput = (usernameOrEmail || '').toString().trim().toUpperCase();
      const normalizedUsername = (resolvedProfile?.username || '').toString().trim().toUpperCase();
      const normalizedCode = (resolvedProfile?.code || resolvedProfile?.adminCode || '').toString().trim().toUpperCase();
      const isAdmin001 = normalizedLoginInput === 'ADMIN001' || normalizedUsername === 'ADMIN001' || normalizedCode === 'ADMIN001';

      if (isAdmin001) {
        const desiredFullName = 'Nurse Bernard';
        const desiredEmail = 'nurse@876.com';

        const shouldUpdateFullName =
          !resolvedProfile?.fullName ||
          resolvedProfile.fullName === 'Shertonia Walker' ||
          resolvedProfile.fullName !== desiredFullName;

        const shouldUpdateDisplayName =
          resolvedProfile?.displayName === 'Shertonia Walker' ||
          (resolvedProfile?.displayName && resolvedProfile.displayName !== desiredFullName);

        const profileUpdates = {
          ...(shouldUpdateFullName ? { fullName: desiredFullName } : {}),
          ...(shouldUpdateDisplayName ? { displayName: desiredFullName } : {}),
          // Best-effort normalization if these fields exist.
          ...(resolvedProfile?.firstName === 'Shertonia' || !resolvedProfile?.firstName ? { firstName: 'Nurse' } : {}),
          ...(resolvedProfile?.lastName === 'Walker' || !resolvedProfile?.lastName ? { lastName: 'Bernard' } : {}),
        };

        // Best-effort: migrate ADMIN001 email to the new address.
        // IMPORTANT: Only update Firestore email after Auth email update succeeds,
        // otherwise username->email login would break on next login.
        let adminEmailUpdatedInAuth = false;
        try {
          if (firebaseUser?.email && firebaseUser.email.toLowerCase() !== desiredEmail.toLowerCase()) {
            await updateEmail(firebaseUser, desiredEmail);
            adminEmailUpdatedInAuth = true;
          }
        } catch (e) {
          // Don't block login if email update fails (can fail if requires recent login).
          adminEmailUpdatedInAuth = false;
        }

        const updatesToPersist = {
          ...profileUpdates,
          // Used for display throughout the app even if the Auth sign-in email cannot be migrated.
          contactEmail: desiredEmail,
          ...(adminEmailUpdatedInAuth ? { email: desiredEmail } : {}),
        };

        if (Object.keys(updatesToPersist).length > 0) {
          try {
            const updateResult = await FirebaseService.updateUser(firebaseUser.uid, updatesToPersist);
            if (updateResult.offline) {
              console.log('📡 Offline - profile updates will sync when online');
            } else {
              resolvedProfile = { ...resolvedProfile, ...updatesToPersist };
            }
          } catch (e) {
            // Don't block login if profile normalization fails.
          }
        }

        // Update local cached admin profile used by chat avatar/name.
        try {
          const existingAdminProfile = await AsyncStorage.getItem('adminProfile_ADMIN001');
          const parsed = existingAdminProfile ? JSON.parse(existingAdminProfile) : {};
          const updatedAdminProfile = {
            ...parsed,
            code: 'ADMIN001',
            email: adminEmailUpdatedInAuth ? desiredEmail : (parsed?.email || firebaseUser.email),
            contactEmail: desiredEmail,
            // NOTE: chat screens treat adminData.username as display label.
            username: desiredFullName,
          };
          await AsyncStorage.setItem('adminProfile_ADMIN001', JSON.stringify(updatedAdminProfile));
        } catch (e) {
          // Ignore local cache issues.
        }

        // Update any locally cached users list entry for ADMIN001.
        try {
          const usersData = await AsyncStorage.getItem('users');
          if (usersData) {
            const users = JSON.parse(usersData);
            if (Array.isArray(users)) {
              const updatedUsers = users.map(u => {
                const uUsername = (u?.username || '').toString().trim().toUpperCase();
                const uCode = (u?.code || '').toString().trim().toUpperCase();
                const uEmail = (u?.email || '').toString().trim().toLowerCase();
                const matchesAdmin001 = uUsername === 'ADMIN001' || uCode === 'ADMIN001' || uEmail === 'nurse@876.com' || uEmail === 'shertonia@care.com';
                if (!matchesAdmin001) return u;
                return {
                  ...u,
                  fullName: desiredFullName,
                  contactEmail: desiredEmail,
                  ...(adminEmailUpdatedInAuth ? { email: desiredEmail } : {}),
                };
              });
              await AsyncStorage.setItem('users', JSON.stringify(updatedUsers));
            }
          }
        } catch (e) {
          // Ignore local cache issues.
        }
      }

      // Best-effort: backfill phoneNormalized for legacy profiles (improves phone lookup + duplicate detection).
      try {
        const profilePhone = (resolvedProfile?.phone || '').toString().trim();
        const profilePhoneNormalized = (resolvedProfile?.phoneNormalized || '').toString().trim();
        if (profilePhone && !profilePhoneNormalized) {
          const computed = FirebaseService.normalizePhoneNumber(profilePhone);
          if (computed) {
            // Fire-and-forget: don't slow down login.
            FirebaseService.updateUser(firebaseUser.uid, { phoneNormalized: computed }).catch(() => {});
            resolvedProfile = { ...resolvedProfile, phoneNormalized: computed };
          }
        }
      } catch (e) {
        // Ignore normalization issues.
      }

      setUser({
        id: firebaseUser.uid,
        email: firebaseUser.email,
        ...resolvedProfile,
      });

      // Register push notification token
      await registerPushToken(firebaseUser.uid);

      // Clear sequence cache for admin users
      if (resolvedProfile?.role === 'admin' || resolvedProfile?.role === 'superAdmin') {
        await clearAllSequenceCache();
      }

      return { success: true, user: resolvedProfile };
    } catch (error) {
      console.error('Login error:', error);
      let errorMessage = 'An error occurred during login';
      
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'Email not found';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/user-disabled') {
        errorMessage = 'User account is disabled';
      }

      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (username, email, password, phone, address, country) => {
    signupInProgressRef.current = true;
    try {
      setIsLoading(true);

      // Check if email already exists
      const existingUser = await FirebaseService.getUserByEmail(email);
      if (existingUser.success) {
        return { success: false, error: 'Email already registered', errorCode: 'email-already-registered' };
      }

      // Check if username already exists
      const existingUsername = await FirebaseService.getUserByUsername(username);
      if (existingUsername.success) {
        return { success: false, error: 'Username already taken', errorCode: 'username-already-taken' };
      }

      // Check if phone already exists (only if provided)
      const normalizedPhoneInput = (phone || '').toString().trim();
      if (normalizedPhoneInput) {
        const existingPhone = await FirebaseService.getUserByPhone(normalizedPhoneInput);
        if (existingPhone.success) {
          return { success: false, error: 'Phone number already registered', errorCode: 'phone-already-registered' };
        }
      }

      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      // Update Firebase Auth profile
      await updateProfile(firebaseUser, {
        displayName: username,
      });

      // Determine user role based on username pattern
      let userRole = 'patient'; // Default to patient
      
      if (username.match(/^ADMIN\d{3}$/i)) {
        userRole = username.toUpperCase() === 'ADMIN001' ? 'superAdmin' : 'admin';
      } else if (username.match(/^NURSE\d{3}$/i)) {
        userRole = 'nurse';
      }

      // Create user profile in Firestore
      const userData = {
        id: firebaseUser.uid,
        username,
        email,
        phone,
        address,
        country,
        role: userRole,
        displayName: username,
        // Welcome email should be sent only after verified sign-in.
        welcomeEmailQueued: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const createResult = await FirebaseService.createUser(firebaseUser.uid, userData);

      if (createResult.success) {
        // Send verification code email (HARD verification required before login).
        try {
          await requestEmailVerificationCode(email);
        } catch (verificationError) {
          console.warn('Failed to send verification code email:', verificationError);
        }

        // Ensure the newly created user cannot remain signed in until verified.
        try {
          await signOut(auth);
        } catch (e) {
          // Ignore sign out failures.
        }

        return { success: true, needsEmailVerification: true, verificationEmail: email };
      } else {
        // Delete the Firebase Auth user if Firestore creation failed
        await firebaseUser.delete();
        return { success: false, error: 'Failed to create user profile' };
      }
    } catch (error) {
      console.error('Signup error:', error);
      let errorMessage = 'An error occurred during signup';
      
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Email already registered';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak (minimum 6 characters)';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      }

      return { success: false, error: errorMessage };
    } finally {
      signupInProgressRef.current = false;
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      await signOut(auth);
      setUser(null);
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('authToken');
      // Set flag to show splash screen after logout
      await AsyncStorage.setItem('shouldShowSplash', 'true');
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async (email) => {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();

      // Preferred: branded reset email via Cloud Function (custom template + sender).
      // Fallback: Firebase Auth built-in reset email.
      try {
        const functions = getFunctions(app, 'us-central1');
        const requestPasswordResetEmail = httpsCallable(functions, 'requestPasswordResetEmail');
        await requestPasswordResetEmail({ email: normalizedEmail });
      } catch (fnErr) {
        await sendPasswordResetEmail(auth, normalizedEmail);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Password reset error:', error);
      let errorMessage = 'An error occurred';
      
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'Email not found';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      }

      return { success: false, error: errorMessage };
    }
  };

  const persistUserUpdates = async (targetUserId, updates = {}) => {
    try {
      const result = await FirebaseService.updateUser(targetUserId, updates);
      if (result.offline) {
        console.log('📡 Offline - user updates will sync when online');
        return { success: false, offline: true };
      }
      if (result.success && targetUserId === user?.id) {
        const updatedUser = { ...(user || {}), ...updates };
        setUser(updatedUser);
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      }
      return result;
    } catch (error) {
      console.error('Update profile error:', error);
      return { success: false, error: error.message };
    }
  };

  const updateUser = async (updates = {}) => {
    if (!user?.id) {
      return { success: false, error: 'No authenticated user' };
    }
    return persistUserUpdates(user.id, updates);
  };

  const updateUserProfile = async (userId, updates = {}) => {
    if (!userId) {
      return { success: false, error: 'Missing userId' };
    }
    return persistUserUpdates(userId, updates);
  };

  const value = {
    user,
    isLoading,
    login,
    signup,
    logout,
    resetPassword,
    changePassword,
    updateUser,
    updateUserProfile,
    requestEmailVerificationCode,
    verifyEmailVerificationCode,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
