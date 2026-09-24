import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import ApiService from '../services/ApiService';
import FirebaseService from '../services/FirebaseService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllSequenceCache } from '../clear-sequence-cache';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, getAuth } from 'firebase/auth';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { auth, firebaseConfig } from '../config/firebase';

const NurseContext = createContext();

export const useNurses = () => {
  const context = useContext(NurseContext);
  if (!context) {
    throw new Error('useNurses must be used within a NurseProvider');
  }
  return context;
};

export const NurseProvider = ({ children }) => {
  const [nurses, setNurses] = useState([]);
  const { user } = useAuth();

  // Load nurses from backend when user is authenticated
  const loadNursesFromBackend = async () => {
    if (!user) {
      // User not authenticated, skipping nurses API call
      setNurses([]);
      return;
    }
    
    let backendNurses = [];
    
    try {
      // Loading nurses from new staff endpoint
      const response = await ApiService.makeRequest('/staff/nurses?limit=1000');
      
      if (response.success && response.data) {
        backendNurses = response.data.map(nurse => ({
          id: nurse._id || nurse.id,
          _id: nurse._id || nurse.id,
          name: nurse.fullName || nurse.name, // New model uses fullName instead of firstName/lastName
          fullName: nurse.fullName || nurse.name,
          firstName: nurse.firstName || (nurse.fullName || nurse.name || '').split(' ')[0] || '',
          lastName: nurse.lastName || (nurse.fullName || nurse.name || '').split(' ').slice(1).join(' ') || '',
          email: nurse.email,
          phone: nurse.phone,
          code: nurse.nurseCode || nurse.code || nurse.username, // Handle varies code fields
          profilePhoto: nurse.profilePhoto || nurse.profileImage || nurse.nurseIdPhoto,
          // Professional details
          specialization: nurse.specialization || 'General Nursing',
          // Emergency contact
          emergencyContact: nurse.emergencyContact || 'Not provided',
          emergencyPhone: nurse.emergencyPhone || 'Not provided',
          // Banking details from the new model
          bankName: nurse.bankingDetails?.bankName || 'Not provided',
          accountNumber: nurse.bankingDetails?.accountNumber || 'Not provided',
          accountHolderName: nurse.bankingDetails?.accountHolderName || 'Not provided',
          bankBranch: nurse.bankingDetails?.bankBranch || 'Not provided',
          // Status and activity
          status: 'available',
          assignedClients: 0,
          isActive: nurse.isActive !== false,
          dateAdded: new Date(nurse.createdAt || nurse.dateAdded).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
          })
        }));
      }
    } catch (error) {
      console.error('Error loading nurses from backend:', error);
    }

    // Load nurses from Firestore (Authentication Source)
    let firestoreNurses = [];
    try {
      const fsResult = await FirebaseService.getAllNurses();
      if (fsResult.success) {
        firestoreNurses = fsResult.nurses.map(doc => ({
          id: doc.id,
          _id: doc.id,
          name: doc.fullName || doc.displayName || doc.username || 'Unknown Nurse',
          fullName: doc.fullName || doc.displayName || doc.username,
          firstName: doc.firstName || (doc.fullName || '').split(' ')[0],
          lastName: doc.lastName || (doc.fullName || '').split(' ').slice(1).join(' '),
          email: doc.email,
          phone: doc.phone,
          code: doc.nurseCode || doc.code || doc.username,
          profilePhoto: doc.profilePhoto || doc.profileImage || doc.nurseIdPhoto,
          specialization: doc.specialization || 'General Nursing',
          emergencyContact: doc.emergencyContact || 'Not provided',
          emergencyPhone: doc.emergencyPhone || 'Not provided',
          bankName: doc.bankingDetails?.bankName || 'Not provided',
          accountNumber: doc.bankingDetails?.accountNumber || 'Not provided',
          accountHolderName: doc.bankingDetails?.accountHolderName || 'Not provided',
          bankBranch: doc.bankingDetails?.bankBranch || 'Not provided',
          status: doc.status || 'available',
          assignedClients: doc.assignedClients || 0,
          isActive: doc.isActive !== false,
          dateAdded: doc.createdAt && doc.createdAt.seconds 
            ? new Date(doc.createdAt.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : new Date().toLocaleDateString()
        }));
      }
    } catch (error) {
      console.error('Error loading nurses from Firestore:', error);
    }

    // Load local nurses from AsyncStorage (Legacy Support)
    let localNurses = [];
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const nurseKeys = allKeys.filter(key => key.match(/^NURSE\d{3}$/));
      
      if (nurseKeys.length > 0) {
        const pairs = await AsyncStorage.multiGet(nurseKeys);
        localNurses = pairs.map(([key, value]) => {
          try {
            const data = JSON.parse(value);
            if (!data) return null;
            
            return {
              id: data.id || key,
              _id: data._id || data.id || key,
              name: data.name || data.fullName || 'Unknown Nurse',
              fullName: data.fullName || data.name,
              firstName: data.firstName || (data.name || '').split(' ')[0],
              lastName: data.lastName || (data.name || '').split(' ').slice(1).join(' '),
              email: data.email,
              phone: data.phone,
              code: data.nurseCode || data.code || key,
              profilePhoto: data.profilePhoto || data.profileImage || data.nurseIdPhoto,
              specialization: data.specialization || 'General Nursing',
              emergencyContact: data.emergencyContact || 'Not provided',
              emergencyPhone: data.emergencyPhone || 'Not provided',
              bankName: data.bankingDetails?.bankName || data.bankName || 'Not provided',
              accountNumber: data.bankingDetails?.accountNumber || data.accountNumber || 'Not provided',
              accountHolderName: data.bankingDetails?.accountHolderName || data.accountHolderName || 'Not provided',
              bankBranch: data.bankingDetails?.bankBranch || data.bankBranch || 'Not provided',
              status: data.status || 'available',
              assignedClients: data.assignedClients || 0,
              isActive: data.isActive !== false,
              dateAdded: data.dateAdded || new Date().toLocaleDateString()
            };
          } catch (e) {
            return null;
          }
        }).filter(n => n !== null);
      }
    } catch (error) {
      console.error('Error loading local nurses:', error);
    }

    // Merge: Backend > Firestore > Local
    // Use a Map keyed by nurse code to ensure uniqueness
    const nurseMap = new Map();

    // 1. Add Local (lowest priority)
    localNurses.forEach(n => {
      if (n.code) nurseMap.set(n.code, n);
    });

    // 2. Add Firestore (medium priority)
    firestoreNurses.forEach(n => {
      if (n.code) nurseMap.set(n.code, n);
    });

    // 3. Add Backend (highest priority)
    backendNurses.forEach(n => {
      if (n.code) nurseMap.set(n.code, n);
    });
    
    const allNurses = Array.from(nurseMap.values());
    setNurses(allNurses);
  };

  // Load nurses data only when user is authenticated
  useEffect(() => {
    if (user) {
      loadNursesFromBackend();
    } else {
      setNurses([]);
    }
  }, [user]);

  // Refresh nurses from backend
  const refreshNurses = () => {
    if (user) {
      loadNursesFromBackend();
    }
  };

  const addNurse = async (newNurse) => {
    try {
      console.log('🔄 [addNurse] Starting admin/nurse creation...', { newNurse });
      const role = newNurse.role || 'nurse';
      
      // Format data for new staff-specific endpoints
      const staffData = {
        fullName: newNurse.name, // Use full name as expected by new models
        email: newNurse.email,
        password: 'temp123', // Temporary password - staff should change it
        phone: newNurse.phone.startsWith('+') ? newNurse.phone : `+1${newNurse.phone.replace(/\D/g, '')}`,
        bankingDetails: newNurse.bankingDetails || {
          bankName: 'Default Bank',
          accountNumber: '000000000',
          accountHolderName: newNurse.name,
          bankBranch: 'Main Branch',
          currency: 'JMD'
        }
      };
      
      // Add role-specific fields and determine endpoint
      let apiEndpoint;
      if (role === 'nurse') {
        staffData.nurseCode = newNurse.nurseCode || newNurse.code;
        staffData.experience = 0;
        apiEndpoint = '/staff/register/nurse';
      } else {
        staffData.adminCode = newNurse.nurseCode || newNurse.code;
        staffData.adminLevel = 'admin';
        staffData.isSuperAdmin = false;
        apiEndpoint = '/staff/register/admin';
      }
      
      console.log(`✏️ [addNurse] Creating ${role.toUpperCase()} with code: ${newNurse.nurseCode || newNurse.code}`);
      console.log('📝 [addNurse] Staff data:', staffData);
      
      // Try API endpoint first (may not exist for admin)
      let apiSuccess = false;
      try {
        console.log(`📡 [addNurse] Calling API: ${apiEndpoint}`);
        const response = await ApiService.makeRequest(apiEndpoint, {
          method: 'POST',
          body: JSON.stringify(staffData)
        });
        console.log(`📡 [addNurse] API Response:`, response);
        apiSuccess = response.success;
      } catch (error) {
        console.warn('⚠️ Backend API call failed, proceeding to Firebase:', error);
      }
      
      // Always create Firebase Auth + Firestore profile for login access
      const codeValue = newNurse.nurseCode || newNurse.code;
      console.log(`🔑 [addNurse] Creating Firebase Auth user for: ${newNurse.email}`);
      
      // Use a secondary app to create user without logging in the current user
      const appName = 'SecondaryApp';
      let secondaryApp;
      try {
        secondaryApp = getApp(appName);
      } catch (e) {
        secondaryApp = initializeApp(firebaseConfig, appName);
      }
      
      let uid;
      const secondaryAuth = getAuth(secondaryApp);
      console.log(`🔑 [addNurse] Creating Firebase Auth account...`);
      
      try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, newNurse.email, 'temp123');
        uid = cred.user.uid;
        console.log(`✅ [addNurse] Firebase Auth user created. UID: ${uid}`);
      } catch (authError) {
        console.warn(`⚠️ [addNurse] Auth creation error: ${authError.code} - ${authError.message}`);
        
        // If email already exists, try to get the existing user
        if (authError.code === 'auth/email-already-in-use') {
          console.log(`📧 [addNurse] Email already in use, trying to get existing user...`);
          try {
            // We can't query by email directly with client auth, so we'll try to sign in
            const signInCred = await signInWithEmailAndPassword(secondaryAuth, newNurse.email, 'temp123');
            uid = signInCred.user.uid;
            console.log(`✅ [addNurse] Using existing user. UID: ${uid}`);
          } catch (signInError) {
            console.error(`❌ [addNurse] Cannot use existing user:`, signInError.message);
            throw new Error(`Email ${newNurse.email} is already registered. Cannot create new account.`);
          }
        } else {
          throw authError;
        }
      }
      
      // Image Upload Logic (Non-blocking - continues even if upload fails)
      let profilePhotoUrl = null;
      if (newNurse.nurseIdPhoto && newNurse.nurseIdPhoto.uri) {
        try {
          const uploadResult = await FirebaseService.uploadImage(
            newNurse.nurseIdPhoto.uri, 
            `staff-profiles/${uid}/profile-photo.jpg`
          );
          if (uploadResult.success) {
            profilePhotoUrl = uploadResult.url;
            console.log('✅ Profile photo uploaded successfully');
          } else {
            console.warn('⚠️ Photo upload failed, continuing without photo:', uploadResult.error);
          }
        } catch (uploadError) {
          console.warn('⚠️ Photo upload exception, continuing without photo:', uploadError.message);
        }
      }

      const bankingDetails = staffData.bankingDetails || {
        bankName: 'Default Bank',
        accountNumber: '000000000',
        accountHolderName: newNurse.name,
        bankBranch: 'Main Branch',
        currency: 'JMD'
      };

      const profileData = {
        fullName: newNurse.name,
        email: newNurse.email,
        phone: newNurse.phone,
        role,
        profilePhoto: profilePhotoUrl,
        code: codeValue,
        nurseCode: role === 'nurse' ? codeValue : null,
        adminCode: role === 'admin' ? codeValue : null,
        username: codeValue,
        isActive: true,
        bankingDetails,
        bankName: bankingDetails.bankName,
        accountNumber: bankingDetails.accountNumber,
        accountHolderName: bankingDetails.accountHolderName,
        bankBranch: bankingDetails.bankBranch,
        specialization: newNurse.specialization || 'General Nursing',
      };
      
      console.log(`💾 [addNurse] Saving Firestore profile...`, profileData);
      await FirebaseService.createStaffProfile(uid, profileData, role);
      console.log(`✅ [addNurse] Firestore profile created successfully for ${role}: ${profileData.adminCode || profileData.nurseCode}`);
      
      // Refresh from backend if API succeeded
      if (apiSuccess) {
        refreshNurses();
      }
      
      console.log(`✅ [addNurse] SUCCESS: ${role} created successfully`);
      return { success: true };
    } catch (error) {
      console.error('❌ [addNurse] FAILED:', error.message, error);
      return { success: false, error: error.message || 'Failed to add nurse' };
    }
  };

  const updateNurse = async (nurseId, updates) => {
    try {
      // Handle Photo Upload if present (Non-blocking)
      if (updates.nurseIdPhoto && updates.nurseIdPhoto.uri) {
        try {
          const pathId = updates.code || updates.nurseCode || nurseId;
          const uploadResult = await FirebaseService.uploadImage(
            updates.nurseIdPhoto.uri, 
            `staff-profiles/${pathId}/profile-photo.jpg`
          );
          if (uploadResult.success) {
            updates.profilePhoto = uploadResult.url;
            console.log('✅ Profile photo updated successfully');
          } else {
            console.warn('⚠️ Photo upload failed, continuing update without photo:', uploadResult.error);
          }
        } catch (uploadError) {
          console.warn('⚠️ Photo upload exception, continuing update without photo:', uploadError.message);
        }
        // Remove the local URI object before saving
        delete updates.nurseIdPhoto;
      }

      // 1. Try to update in Backend
      try {
        await ApiService.makeRequest(`/staff/nurses/${nurseId}`, {
          method: 'PUT',
          body: JSON.stringify(updates)
        });
      } catch (backendError) {
        console.log('Backend update skipped/failed, proceeding to Firebase/Local', backendError.message);
      }

      // 2. Update in Firebase
      try {
        await FirebaseService.updateUser(nurseId, updates);
      } catch (firebaseError) {
        console.log('Firebase update skipped/failed', firebaseError.message);
      }

      // 3. Update local state
      const updatedNurses = nurses.map(n => n.id === nurseId ? { ...n, ...updates } : n);
      setNurses(updatedNurses);
      
      return { success: true };
    } catch (error) {
       console.error("Update failed", error);
       return { success: false, error: error.message };
    }
  };

  const updateNurseStatus = async (nurseId, newStatus) => {
    try {
      // Update in backend first, then refresh local state
      // For now, update locally and refresh from backend
      const updatedNurses = nurses.map(nurse => 
        nurse.id === nurseId 
          ? { ...nurse, status: newStatus }
          : nurse
      );
      setNurses(updatedNurses);
      // TODO: Add backend API call to update nurse status
    } catch (error) {
      console.error('Error updating nurse status:', error);
    }
  };

  const updateNurseActiveStatus = async (nurseId, isActive) => {
    try {
      // Update locally first, backend integration pending
      const updatedNurses = nurses.map(nurse => 
        nurse.id === nurseId 
          ? { ...nurse, isActive: isActive }
          : nurse
      );
      setNurses(updatedNurses);
      // TODO: Add backend API call to update nurse active status
    } catch (error) {
      console.error('Error updating nurse active status:', error);
    }
  };

  const deleteNurse = async (nurseId) => {
    try {
      // Deleting nurse from database
      
      // 1. Call backend API to delete nurse (Main Backend)
      const response = await ApiService.makeRequest(`/staff/nurse/${nurseId}`, {
        method: 'DELETE'
      });
      
      // 2. Call Firebase Service to delete nurse profile (Firestore)
      // We do this regardless of backend success to ensure cleanup of "orphaned" Firebase accounts
      await FirebaseService.deleteUser(nurseId);
      
      if (response.success) {
        // Nurse deleted from database successfully
        // Remove from local state
        const updatedNurses = nurses.filter(nurse => nurse.id !== nurseId);
        setNurses(updatedNurses);
        return { success: true };
      } else {
        // Even if backend failed (maybe user didn't exist there), we removed from Firebase
        // So we should still remove from local state if it was a Firebase-only user
        const updatedNurses = nurses.filter(nurse => nurse.id !== nurseId);
        setNurses(updatedNurses);
        
        if (response.error && response.error.includes('not found')) {
           // It was likely a Firebase-only user, so treat as success
           return { success: true };
        }
        
        console.error('❌ Backend delete failed:', response.error);
        return { success: false, error: response.error };
      }
    } catch (error) {
      console.error('❌ Error deleting nurse:', error);
      // If backend fails, still remove from local state as fallback
      const updatedNurses = nurses.filter(nurse => nurse.id !== nurseId);
      setNurses(updatedNurses);
      return { success: false, error: 'Network error during deletion' };
    }
  };

  const getAvailableNurses = () => {
    const available = nurses.filter(nurse => nurse.status === 'available' && nurse.isActive === true);
    return available;
  };

  const getNursesByStatus = (status) => {
    if (status === 'offline') {
      return nurses.filter(nurse => nurse.isActive === false);
    }
    return nurses.filter(nurse => nurse.status === status && nurse.isActive === true);
  };

  const incrementAssignedClients = (nurseId) => {
    const updatedNurses = nurses.map(nurse => 
      nurse.id === nurseId 
        ? { ...nurse, assignedClients: (nurse.assignedClients || 0) + 1 }
        : nurse
    );
    setNurses(updatedNurses);
    // TODO: Add backend API call to update assigned clients count
  };

  const value = {
    nurses,
    addNurse,
    updateNurse,
    updateNurseStatus,
    updateNurseActiveStatus,
    deleteNurse,
    getAvailableNurses,
    getNursesByStatus,
    incrementAssignedClients,
    refreshNurses
  };

  return (
    <NurseContext.Provider value={value}>
      {children}
    </NurseContext.Provider>
  );
};