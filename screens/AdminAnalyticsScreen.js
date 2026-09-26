import TouchableWeb from "../components/TouchableWeb";
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Modal, Alert, Animated, PanResponder, KeyboardAvoidingView, Platform, Image, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { useAuth } from '../context/AuthContext';
import { useNurses } from '../context/NurseContext';
import ApiService from '../services/ApiService';
import FirebaseService from '../services/FirebaseService';
import { clearAllAdminData, checkCurrentData } from '../utils/clearData';
import BankAutocomplete from '../components/BankAutocomplete';

export default function AdminAnalyticsScreen({ navigation, route, isEmbedded = false, onAddPress, searchQuery = '' }) {
  const { createNurseAccount, user } = useAuth();
  const { nurses, addNurse, updateNurse, updateNurseStatus, deleteNurse, getNursesByStatus } = useNurses();
  const insets = useSafeAreaInsets();
  const [adminStaff, setAdminStaff] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [createNurseModalVisible, setCreateNurseModalVisible] = useState(false);
  const [editMode, setEditMode] = useState(false); // Edit mode state
  const [nurseDetailsModalVisible, setNurseDetailsModalVisible] = useState(false);
  const [nurseToDelete, setNurseToDelete] = useState(null);
  const [selectedNurseDetails, setSelectedNurseDetails] = useState(null);
  const [nurseName, setNurseName] = useState('');
  const [nurseEmail, setNurseEmail] = useState('');
  const [nursePhone, setNursePhone] = useState('');
  const [nurseSpecialization, setNurseSpecialization] = useState('');
  const [nurseQualifications, setNurseQualifications] = useState('');
  const [nurseCode, setNurseCode] = useState('');
  const [nurseBankName, setNurseBankName] = useState('');
  const [nurseAccountNumber, setNurseAccountNumber] = useState('');
  const [nurseAccountHolderName, setNurseAccountHolderName] = useState('');
  const [nurseBankBranch, setNurseBankBranch] = useState('');
  const [nurseIdPhoto, setNurseIdPhoto] = useState(null); // For nurse ID photo upload
  const [staffRole, setStaffRole] = useState('nurse'); // 'nurse' or 'admin'
  const [nurseSequence, setNurseSequence] = useState(1); // Sequential counter for nurses
  const [adminSequence, setAdminSequence] = useState(1); // Sequential counter for admins
  const [sequencesInitialized, setSequencesInitialized] = useState(false); // Flag to prevent multiple initializations
  const [showRoleModal, setShowRoleModal] = useState(false); // Role selection modal

  const loadAdminStaff = useCallback(async () => {
    try {
      const admins = await ApiService.getAdmins();
      const mappedAdmins = admins.map((admin) => ({
        id: admin.id,
        _id: admin.id,
        name: admin.fullName || admin.name || admin.username || admin.adminCode || admin.code || 'Unknown Admin',
        fullName: admin.fullName || admin.name || admin.username || admin.adminCode || admin.code || 'Unknown Admin',
        email: admin.email || '',
        phone: admin.phone || '',
        code: admin.adminCode || admin.code || admin.username || '',
        adminCode: admin.adminCode || admin.code || admin.username || '',
        role: 'admin',
        profilePhoto: admin.profilePhoto || admin.profileImage || null,
        specialization: admin.title || 'Administrative Staff',
        emergencyContact: admin.emergencyContact || 'Not provided',
        emergencyPhone: admin.emergencyPhone || 'Not provided',
        bankName: admin.bankingDetails?.bankName || 'Not provided',
        accountNumber: admin.bankingDetails?.accountNumber || 'Not provided',
        accountHolderName: admin.bankingDetails?.accountHolderName || 'Not provided',
        bankBranch: admin.bankingDetails?.bankBranch || 'Not provided',
        status: admin.isActive === false ? 'offline' : 'available',
        assignedClients: 0,
        isActive: admin.isActive !== false,
        dateAdded: admin.createdAt?.seconds
          ? new Date(admin.createdAt.seconds * 1000).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : new Date().toLocaleDateString(),
      }));
      setAdminStaff(mappedAdmins);
    } catch (error) {
      console.error('Error loading admins for staff management:', error);
      setAdminStaff([]);
    }
  }, []);

  const initializeSequences = useCallback(async () => {
    // console.log('🔄 Analytics: Starting sequence initialization with persistent tracking...');
    try {
      // Get or initialize persistent sequence counters
      const storedNurseSequence = await AsyncStorage.getItem('nurseSequenceCounter');
      const storedAdminSequence = await AsyncStorage.getItem('adminSequenceCounter');
      
      // Also check existing data to ensure we don't go backwards
      const allKeys = await AsyncStorage.getAllKeys();
      const existingNurses = nurses || [];
      // Try to fetch admins/nurses from backend for accurate sequencing
      let backendAdmins = [];
      let backendNurses = [];
      try {
        const adminResp = await ApiService.makeRequest('/staff/admins?limit=1000');
        if (adminResp && adminResp.success && Array.isArray(adminResp.data)) backendAdmins = adminResp.data;
      } catch (e) {
        // console.log('⚠️ Could not fetch admin users:', e.message || e);
      }
      try {
        const nurseResp = await ApiService.makeRequest('/staff/nurses?limit=1000');
        if (nurseResp && nurseResp.success && Array.isArray(nurseResp.data)) backendNurses = nurseResp.data;
      } catch (e) {
        // console.log('⚠️ Could not fetch nurse users:', e.message || e);
      }
      
      // Find all nurse and admin codes that have ever been used
      const existingNurseCodes = [...existingNurses, ...backendNurses]
        .filter(nurse => {
          const code = nurse.nurseCode || nurse.code; // Check both new and old field names
          return code && code.match(/^NURSE\d{3}$/);
        })
        .map(nurse => {
          const code = nurse.nurseCode || nurse.code;
          const match = code.match(/NURSE(\d{3})/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(num => num > 0);

      const existingAdminCodes = [...backendAdmins]
        .filter(admin => {
          const code = admin.adminCode || admin.code; // Check both new and old field names  
          return code && code.match(/^ADMIN\d{3}$/);
        })
        .map(admin => {
          const code = admin.adminCode || admin.code;
          const match = code.match(/ADMIN(\d{3})/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(num => num > 0);
      
      // Ensure ADMIN001 is always recognized as existing (Nurse Bernard)
      if (!existingAdminCodes.includes(1)) {
        existingAdminCodes.push(1);
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
      const highestAdminUsed = allAdminNumbers.length > 0 ? Math.max(...allAdminNumbers) : 0;
      
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
      
      // Ensure we never go backwards
      nextNurseSequence = Math.max(nextNurseSequence, highestNurseUsed + 1);
      nextAdminSequence = Math.max(nextAdminSequence, highestAdminUsed + 1);
      
      // Ensure admin sequence is never less than 2 (ADMIN001 is taken by Nurse Bernard)
      nextAdminSequence = Math.max(nextAdminSequence, 2);
      
      // Save the counters back to storage
      await AsyncStorage.setItem('nurseSequenceCounter', nextNurseSequence.toString());
      await AsyncStorage.setItem('adminSequenceCounter', nextAdminSequence.toString());
      
      setNurseSequence(nextNurseSequence);
      setAdminSequence(nextAdminSequence);
      setSequencesInitialized(true);
    } catch (error) {
      console.error('❌ Analytics: Error initializing sequences:', error);
      setNurseSequence(4);
      setAdminSequence(4);
      setSequencesInitialized(true);
    }
  }, [nurses]);

  // Initialize sequences based on persistent sequence tracking
  useEffect(() => {
    // Reset initialization flag when user context changes
    setSequencesInitialized(false);
    initializeSequences();
  }, [user, initializeSequences]);

  useEffect(() => {
    loadAdminStaff();
  }, [loadAdminStaff]);

  useFocusEffect(
    useCallback(() => {
      loadAdminStaff();
    }, [loadAdminStaff])
  );

  // Auto-generate the next sequential code based on role
  const getNextCode = () => {
    if (staffRole === 'admin') {
      return `ADMIN${adminSequence.toString().padStart(3, '0')}`;
    } else {
      return `NURSE${nurseSequence.toString().padStart(3, '0')}`;
    }
  };

  // Initialize the code when component mounts
  useEffect(() => {
    setNurseCode(getNextCode());
  }, [staffRole, nurseSequence, adminSequence]);

  // Memoize the add function to prevent infinite re-renders
  const handleAddStaff = useCallback(async () => {
    // Wait for sequence refresh so the modal opens with the latest code.
    await initializeSequences();
    setCreateNurseModalVisible(true);
  }, [initializeSequences]);

  // Expose add function to parent component when embedded
  useEffect(() => {
    if (isEmbedded && onAddPress) {
      onAddPress(handleAddStaff);
    }
  }, [isEmbedded, onAddPress, handleAddStaff]);

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

  const handleCardPress = (cardType) => {
    if (selectedCard === cardType) {
      // If same card is pressed, deselect and show all
      setSelectedCard(null);
    } else {
      // Select new card to filter nurses
      setSelectedCard(cardType);
    }
  };

  // Get nurses to display based on selection
  const getDisplayedNurses = () => {
    const normalizedQuery = String(searchQuery || '').trim().toLowerCase();

    const getNameKey = (nurse) =>
      String(nurse?.name || nurse?.fullName || nurse?.displayName || '')
        .trim()
        .toLowerCase();

    const matchesQuery = (nurse) => {
      if (!normalizedQuery) return true;
      const haystack = [
        nurse?.name,
        nurse?.fullName,
        nurse?.displayName,
        nurse?.email,
        nurse?.phone,
        nurse?.contactNumber,
        nurse?.code,
        nurse?.specialization,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    };

    let base = [];
    const combinedStaff = new Map();
    const nurseSource = Array.isArray(nurses) ? nurses : [];
    const adminSource = Array.isArray(adminStaff) ? adminStaff : [];

    [...nurseSource, ...adminSource].forEach((staffMember) => {
      const key = staffMember?.code || staffMember?.adminCode || staffMember?.id;
      if (key) {
        combinedStaff.set(key, staffMember);
      }
    });

    const source = Array.from(combinedStaff.values());

    switch (selectedCard) {
      case 'available':
        base = source.filter((nurse) => nurse.status === 'available' && nurse.isActive === true);
        break;
      case 'offline':
        base = source.filter((nurse) => nurse.isActive === false);
        break;
      case 'total':
      default:
        base = source;
        break;
    }

    const filtered = normalizedQuery ? base.filter(matchesQuery) : base;
    return [...filtered].sort((a, b) => {
      const aKey = getNameKey(a);
      const bKey = getNameKey(b);
      if (aKey && bKey) return aKey.localeCompare(bKey);
      if (aKey) return -1;
      if (bKey) return 1;
      return 0;
    });
  };

  const handleDeleteNurse = (nurse) => {
    setNurseToDelete(nurse);
    setDeleteModalVisible(true);
  };

  const confirmDelete = () => {
    deleteNurse(nurseToDelete.id);
    setDeleteModalVisible(false);
    setNurseToDelete(null);
    Alert.alert('Success', `${nurseToDelete?.name} has been removed from the staff.`);
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
              
            } catch (error) {
              console.error('Error deleting staff member:', error);
              Alert.alert(
                'Error', 
                'Failed to delete staff member. Please try again.',
                [{ text: 'OK' }]
              );
            }
          }
        }
      ]
    );
  };

  // Initialize the code when component mounts
  useEffect(() => {
    setNurseCode(getNextCode());
  }, [staffRole, nurseSequence, adminSequence]);

  // Handle role selection and auto-update code
  const handleRoleSelection = (role) => {
    setStaffRole(role);
    setShowRoleModal(false);
    // Auto-set the next sequential code
    if (role === 'admin') {
      setNurseCode(`ADMIN${adminSequence.toString().padStart(3, '0')}`);
    } else {
      setNurseCode(`NURSE${nurseSequence.toString().padStart(3, '0')}`);
    }
  };

  // Temporary function to clear all sample data
  const handleClearSampleData = async () => {
    Alert.alert(
      'Clear Sample Data',
      'This will remove all sample ADMIN001 data and reset the app. You will need to restart after this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All Data',
          style: 'destructive',
          onPress: async () => {
            const result = await clearAllAdminData();
            if (result.success) {
              Alert.alert(
                'Data Cleared',
                'All sample data cleared! Please restart the app with:\nnpx expo start --clear',
                [{ text: 'OK' }]
              );
            } else {
              Alert.alert('Error', `Failed to clear data: ${result.error}`);
            }
          }
        }
      ]
    );
  };

  const handleClearAnalyticsData = async () => {
    Alert.alert(
      'Clear Analytics Data',
      'This will clear all staff analytics, sequences, and management data. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const keysToClear = [
                'nurseSequenceCounter',
                'adminSequenceCounter',
                'staffSequence',
                'staffManagement',
                'nurses',
                'admins'
              ];
              await AsyncStorage.multiRemove(keysToClear);
              setNurseSequence(1);
              setAdminSequence(1);
              Alert.alert('Success', '✅ Analytics data cleared!');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          }
        }
      ]
    );
  };

  const handleResetAllNurses = async () => {
    Alert.alert(
      '⚠️ HARD RESET NURSES',
      'This will PERMANENTLY DELETE ALL NURSES from the database and reset the staff code counter to NURSE001.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'DELETE ALL',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Delete from Firebase
              const result = await FirebaseService.deleteAllNurses();
              
              if (result.success) {
                // 2. Reset Sequence in AsyncStorage
                await AsyncStorage.setItem('nurseSequenceCounter', '1');
                setNurseSequence(1);
                
                // 3. Clear local cache
                await AsyncStorage.removeItem('nurses');
                
                // 4. Refresh Context
                // We can't easily force refresh context from here without a refresh method exposed, 
                // but we can reload the app or show success message.
                
                Alert.alert(
                  'Reset Complete', 
                  `Deleted ${result.count} nurse profiles.\nNext nurse will be NURSE001.\n\nPlease restart the app to see changes.`
                );
              } else {
                Alert.alert('Error', 'Failed to delete nurses: ' + result.error);
              }
            } catch (error) {
              Alert.alert('Error', 'An unexpected error occurred');
              console.error(error);
            }
          }
        }
      ]
    );
  };

  const handleEditNurse = (nurse) => {
    setEditMode(true);
    setSelectedNurseDetails(nurse);
    setNurseName(nurse.name);
    setNurseEmail(nurse.email);
    setNursePhone(nurse.phone);
    setNurseCode(nurse.code || nurse.nurseCode);
    setNurseSpecialization(nurse.specialization || 'General Nursing');
    setNurseQualifications(nurse.qualifications || nurse.qualification || '');
    
    // Banking
    setNurseBankName(nurse.bankName || nurse.bankingDetails?.bankName || '');
    setNurseAccountNumber(nurse.accountNumber || nurse.bankingDetails?.accountNumber || '');
    setNurseAccountHolderName(nurse.accountHolderName || nurse.bankingDetails?.accountHolderName || '');
    setNurseBankBranch(nurse.bankBranch || nurse.bankingDetails?.bankBranch || '');
    
    // Photo
    if (nurse.profilePhoto) {
      setNurseIdPhoto({ uri: nurse.profilePhoto });
    } else {
      setNurseIdPhoto(null);
    }
    
    // Determine role (to set code correctly if needed)
    const isAdmin = (nurse.code || '').startsWith('ADMIN');
    setStaffRole(isAdmin ? 'admin' : 'nurse');
    
    setNurseDetailsModalVisible(false); // Close details modal
    setCreateNurseModalVisible(true); // Open form modal
  };

  const handleCreateNurse = async () => {
    if (!nurseName || !nurseEmail || !nursePhone || !nurseCode || !nurseBankName || !nurseAccountNumber || !nurseAccountHolderName) {
      Alert.alert('Error', 'Please fill in all fields including banking details');
      return;
    }

    // Validate that staff code starts with ADMIN or NURSE
    const upperCode = nurseCode.toUpperCase();
    if (!upperCode.startsWith('ADMIN') && !upperCode.startsWith('NURSE')) {
      Alert.alert('Error', 'Staff code must start with ADMIN or NURSE (e.g., ADMIN002 or NURSE001)');
      return;
    }

    // Determine role based on code prefix
    const isAdmin = upperCode.startsWith('ADMIN');
    const role = isAdmin ? 'admin' : 'nurse';
    
    // Create staff account in the system
    const nurseData = {
      name: nurseName,
      fullName: nurseName,
      email: nurseEmail,
      phone: nursePhone,
      specialization: nurseSpecialization || 'General Nursing',
      qualifications: nurseQualifications || 'Not specified',
      nurseCode: upperCode,
      code: upperCode, // Add code field for admins
      role: role, // Explicitly set the role
      nurseIdPhoto: nurseIdPhoto || null, // Add nurse ID photo
      bankingDetails: {
        bankName: nurseBankName,
        accountNumber: nurseAccountNumber,
        accountHolderName: nurseAccountHolderName,
        bankBranch: nurseBankBranch || 'Main Branch',
        currency: 'JMD'
      }
    };

    let result;
    try {
      if (editMode && selectedNurseDetails) {
         // Updating existing staff
         // Confirm we have an ID
         if (!selectedNurseDetails.id) {
           Alert.alert('Error', 'Cannot update staff: Missing ID');
           return;
         }
         // Preserve original ID
         const updatePayload = { ...nurseData };
         // If backend supports partial update, good. For now sending full data.
         result = await updateNurse(selectedNurseDetails.id, updatePayload);
      } else {
         // Creating new staff
         result = await addNurse(nurseData);
      }
      
      // Check result - handle potential undefined result if context fails
      if (!result) {
        throw new Error('No result returned from staff operation');
      }

      const authResult = result; // Keep variable name for compatibility

      if (authResult.success) {
        await loadAdminStaff();
        // Increment the sequence counter for next time (Only if creating new)
        if (!editMode) {
          try {
            if (upperCode.startsWith('ADMIN')) {
              const nextAdminSequence = adminSequence + 1;
              setAdminSequence(nextAdminSequence);
              await AsyncStorage.setItem('adminSequenceCounter', nextAdminSequence.toString());
              // console.log('✅ Incremented admin sequence to:', nextAdminSequence);
            } else if (upperCode.startsWith('NURSE')) {
              const nextNurseSequence = nurseSequence + 1;
              setNurseSequence(nextNurseSequence);
              await AsyncStorage.setItem('nurseSequenceCounter', nextNurseSequence.toString());
              // console.log('✅ Incremented nurse sequence to:', nextNurseSequence);
            }
          } catch (error) {
            console.error('❌ Error updating sequence counter:', error);
          }
        }
        
        Alert.alert(
          editMode ? 'Staff Details Updated' : 'Staff Account Created',
          editMode 
            ? `${nurseName}'s information has been updated successfully.`
            : `${nurseName} has been created with:\n\nUsername: ${nurseCode.toUpperCase()}\nTemporary Password: temp123\n\nShare these credentials with the staff member for first login. They should change the password after logging in.`,
          [
            {
              text: 'OK',
              onPress: () => {
                setCreateNurseModalVisible(false);
                setEditMode(false);
                setNurseName('');
                setNurseEmail('');
                setNursePhone('');
                setNurseSpecialization('');
                setNurseQualifications('');
                setNurseCode('');
                setNurseBankName('');
                setNurseAccountNumber('');
                setNurseAccountHolderName('');
                setNurseBankBranch('');
                setNurseIdPhoto(null);
              },
            },
          ]
        );
      } else {
        // Handle errors from either staff creation or auth account creation
        const errorMessage = result.error || 'Failed to create staff account';
        console.error('Staff update/create error:', errorMessage);
        Alert.alert('Error', errorMessage);
      }
    } catch (e) {
      console.error('Exception in handleCreateNurse:', e);
      Alert.alert('Error', e.message || 'An unexpected error occurred');
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
            <View style={{ width: 44 }} />
            <Text style={styles.welcomeText}>Staff Management</Text>
            <TouchableWeb 
              style={styles.iconButton}
              onPress={() => setCreateNurseModalVisible(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus" size={28} color={COLORS.white} />
            </TouchableWeb>
          </View>
        </LinearGradient>
      )}

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <TouchableWeb 
            style={styles.statCard}
            onPress={() => handleCardPress('total')}
            activeOpacity={0.8}
          >
            {selectedCard === 'total' ? (
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.statGradient}
              >
                <Text style={styles.statLabel}>Total Staff</Text>
              </LinearGradient>
            ) : (
              <View style={styles.inactiveStatCard}>
                <Text style={styles.inactiveStatLabel}>Total Staff</Text>
              </View>
            )}
          </TouchableWeb>
          
          <TouchableWeb 
            style={styles.statCard}
            onPress={() => handleCardPress('available')}
            activeOpacity={0.8}
          >
            {selectedCard === 'available' ? (
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.statGradient}
              >
                <Text style={styles.statLabel}>Available</Text>
              </LinearGradient>
            ) : (
              <View style={styles.inactiveStatCard}>
                <Text style={styles.inactiveStatLabel}>Available</Text>
              </View>
            )}
          </TouchableWeb>
          
          <TouchableWeb 
            style={styles.statCard}
            onPress={() => handleCardPress('offline')}
            activeOpacity={0.8}
          >
            {selectedCard === 'offline' ? (
              <LinearGradient
                colors={GRADIENTS.header}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.statGradient}
              >
                <Text style={styles.statLabel}>Unavailable</Text>
              </LinearGradient>
            ) : (
              <View style={styles.inactiveStatCard}>
                <Text style={styles.inactiveStatLabel}>Unavailable</Text>
              </View>
            )}
          </TouchableWeb>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {selectedCard ? 
              `${selectedCard.charAt(0).toUpperCase() + selectedCard.slice(1)} Staff Members` :
              'All Staff Members'
            }
          </Text>
          {getDisplayedNurses().map((nurse, index) => (
            <View key={`nurse-${nurse.id || nurse.code || nurse.name || 'unknown'}-${index}`} style={styles.compactCard}>
              <TouchableWeb
                onLongPress={() => {
                  setNurseToDelete(nurse);
                  setDeleteModalVisible(true);
                }}
                delayLongPress={500}
                activeOpacity={0.7}
              >
                <View style={styles.compactHeader}>
                  {nurse.profilePhoto || nurse.profileImage || nurse.photoUrl ? (
                    <Image 
                      source={{ uri: nurse.profilePhoto || nurse.profileImage || nurse.photoUrl }} 
                      style={{ 
                        width: 40, 
                        height: 40, 
                        borderRadius: 20, 
                        marginRight: 10,
                        backgroundColor: COLORS.lightGray 
                      }} 
                    />
                  ) : (
                    <MaterialCommunityIcons 
                      name="account-heart" 
                      size={20} 
                      color={nurse.status === 'available' ? COLORS.success : COLORS.warning} 
                    />
                  )}
                  <View style={styles.compactInfo}>
                    <Text style={styles.compactClient}>{nurse.name}</Text>
                    <Text style={styles.compactService}>{nurse.specialization || 'General Nursing'}</Text>
                  </View>
                  <TouchableWeb
                    style={styles.detailsButton}
                    onPress={() => {
                      setSelectedNurseDetails(nurse);
                      setNurseDetailsModalVisible(true);
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
              </TouchableWeb>
            </View>
          ))}
        </View>

        <View style={{ padding: 20, paddingBottom: 40 }}>
          <TouchableWeb
            style={{
              backgroundColor: '#FFEBEE',
              padding: 15,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#FFCDD2',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10
            }}
            onPress={handleResetAllNurses}
          >
            <MaterialCommunityIcons name="nuke" size={24} color="#D32F2F" />
            <Text style={{ 
              color: '#D32F2F', 
              fontFamily: 'Poppins_600SemiBold',
              fontSize: 14
            }}>
              RESET ALL NURSES (Start Fresh)
            </Text>
          </TouchableWeb>
        </View>
      </ScrollView>

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
            <Text style={styles.deleteTitle}>Remove Staff Member</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to remove {nurseToDelete?.name} from your staff? This action cannot be undone.
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

      {/* Nurse Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={nurseDetailsModalVisible}
        onRequestClose={() => setNurseDetailsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModalContent}>
            <View style={styles.detailsModalHeader}>
              <Text style={styles.detailsModalTitle}>Staff Member Details</Text>
              <TouchableWeb
                style={styles.closeButton}
                onPress={() => setNurseDetailsModalVisible(false)}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>

            <ScrollView style={styles.detailsModalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.detailsSection}>
                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="account" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Full Name</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.name}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="email" size={20} color={COLORS.primary} />
                  <TouchableWeb
                    style={styles.detailContent}
                    onPress={() => {
                      const email = selectedNurseDetails?.email;
                      if (!email) return;
                      const url = `mailto:${String(email).trim()}`;
                      Linking.openURL(url).catch(() => {});
                    }}
                    activeOpacity={selectedNurseDetails?.email ? 0.7 : 1}
                    disabled={!selectedNurseDetails?.email}
                  >
                    <Text style={styles.detailLabel}>Email</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.email || 'Not provided'}</Text>
                  </TouchableWeb>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="phone" size={20} color={COLORS.primary} />
                  <TouchableWeb
                    style={styles.detailContent}
                    onPress={() => {
                      const phone = selectedNurseDetails?.phone;
                      if (!phone) return;
                      const sanitized = String(phone).trim().replace(/[^\d+]/g, '');
                      const url = `tel:${sanitized}`;
                      Linking.openURL(url).catch(() => {});
                    }}
                    activeOpacity={selectedNurseDetails?.phone ? 0.7 : 1}
                    disabled={!selectedNurseDetails?.phone}
                  >
                    <Text style={styles.detailLabel}>Phone</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.phone || 'Not provided'}</Text>
                  </TouchableWeb>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="doctor" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Specialization</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.specialization || 'General Nursing'}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="map-marker-outline" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Bank Branch</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.bankBranch || 'Not provided'}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="badge-account" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Staff Code</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.code}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="calendar-plus" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Date Added</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.dateAdded}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="account-group" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Clients Assigned</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.assignedClients || 0}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="bank" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Bank Name</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.bankName || 'Not provided'}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="credit-card-outline" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Account Number</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.accountNumber ? `****${selectedNurseDetails.accountNumber.slice(-4)}` : 'Not provided'}</Text>
                  </View>
                </View>

                <View style={styles.detailItem}>
                  <MaterialCommunityIcons name="account-outline" size={20} color={COLORS.primary} />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Account Holder</Text>
                    <Text style={styles.detailValue}>{selectedNurseDetails?.accountHolderName || 'Not provided'}</Text>
                  </View>
                </View>
              </View>

            </ScrollView>

            {/* Edit and Delete Buttons - Fixed at bottom */}
            <View style={styles.modalFooter}>
              <TouchableWeb 
                style={styles.modalEditButton}
                onPress={() => handleEditNurse(selectedNurseDetails)}
              >
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.modalButtonGradient}
                >
                  <MaterialCommunityIcons name="pencil" size={20} color="#FFFFFF" />
                  <Text style={styles.modalButtonText}>Edit</Text>
                </LinearGradient>
              </TouchableWeb>

              <TouchableWeb 
                style={styles.modalDeleteButton}
                onPress={() => handleDeleteStaff(selectedNurseDetails)}
              >
                <LinearGradient
                  colors={['#ef4444', '#dc2626']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.modalButtonGradient}
                >
                  <MaterialCommunityIcons name="delete" size={20} color="#FFFFFF" />
                  <Text style={styles.modalButtonText}>Delete</Text>
                </LinearGradient>
              </TouchableWeb>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Nurse Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={createNurseModalVisible}
        onRequestClose={() => setCreateNurseModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editMode ? 'Edit Staff Member' : 'Add New Staff Member'}</Text>
              <TouchableWeb onPress={() => setCreateNurseModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
              </TouchableWeb>
            </View>
            <ScrollView 
              style={styles.createNurseForm}
              contentContainerStyle={styles.createNurseFormContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.formLabel}>Full Name</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="account" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Sarah Johnson, RN"
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

              <Text style={styles.formLabel}>Specialization</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="doctor" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Critical Care, Pediatric, General"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseSpecialization}
                  onChangeText={setNurseSpecialization}
                />
              </View>

              <Text style={styles.formLabel}>Qualifications</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="certificate" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. RN, BSN, MSN, ACLS Certified"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseQualifications}
                  onChangeText={setNurseQualifications}
                  multiline
                />
              </View>

              {/* Staff Role Selection - Simple Toggle */}
              <Text style={styles.formLabel}>Staff Role</Text>
              <View style={styles.roleToggleContainer}>
                <TouchableWeb
                  style={[
                    styles.roleToggleOption,
                    staffRole === 'nurse' && styles.roleToggleSelected,
                    { paddingVertical: 0, paddingHorizontal: 0, borderWidth: 0 } // Reset default button styles
                  ]}
                  onPress={() => handleRoleSelection('nurse')}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={staffRole === 'nurse' ? GRADIENTS.header : [COLORS.card, COLORS.card]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 12,
                      width: '100%',
                      gap: 8
                    }}
                  >
                    <MaterialCommunityIcons 
                      name="hospital-box" 
                      size={18} 
                      color={staffRole === 'nurse' ? COLORS.white : COLORS.primary} 
                    />
                    <Text style={[
                      styles.roleToggleText,
                      staffRole === 'nurse' && styles.roleToggleTextSelected
                    ]}>Nurse</Text>
                  </LinearGradient>
                </TouchableWeb>
                
                <TouchableWeb
                  style={[
                    styles.roleToggleOption,
                    staffRole === 'admin' && styles.roleToggleSelected,
                    { paddingVertical: 0, paddingHorizontal: 0, borderWidth: 0 }
                  ]}
                  onPress={() => handleRoleSelection('admin')}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={staffRole === 'admin' ? GRADIENTS.header : [COLORS.card, COLORS.card]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 12,
                      width: '100%',
                      gap: 8
                    }}
                  >
                    <MaterialCommunityIcons 
                      name="shield-account" 
                      size={18} 
                      color={staffRole === 'admin' ? COLORS.white : COLORS.primary} 
                    />
                    <Text style={[
                      styles.roleToggleText,
                      staffRole === 'admin' && styles.roleToggleTextSelected
                    ]}>Admin</Text>
                  </LinearGradient>
                </TouchableWeb>
              </View>

              {/* Auto-Generated Staff Code Field */}
              <Text style={styles.formLabel}>Staff Code (Auto-Generated)</Text>
              <View style={styles.codeDisplayField}>
                <MaterialCommunityIcons name="key-variant" size={20} color={COLORS.primary} />
                <Text style={styles.autoCodeText}>
                  {getNextCode()}
                </Text>
                <View style={styles.autoLabel}>
                  <Text style={styles.autoLabelText}>AUTO</Text>
                </View>
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
                    <TouchableWeb 
                      style={styles.actionButtonWrapper} // Use common wrapper
                      onPress={pickNurseIdPhoto}
                    >
                      <LinearGradient
                        colors={GRADIENTS.header}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.actionButtonContent}
                      >
                        <MaterialCommunityIcons name="camera" size={16} color={COLORS.white} />
                        <Text style={styles.deleteButtonText}>Change</Text>
                      </LinearGradient>
                    </TouchableWeb>
                    
                    <TouchableWeb 
                      style={styles.actionButtonWrapper} // Use common wrapper
                      onPress={removeNurseIdPhoto}
                    >
                      <View style={[styles.actionButtonContent, { backgroundColor: '#ff4444' }]}>
                        <MaterialCommunityIcons name="trash-can" size={16} color={COLORS.white} />
                        <Text style={styles.deleteButtonText}>Remove</Text>
                      </View>
                    </TouchableWeb>
                  </View>
                  </View>
                )}
              </View>

              <BankAutocomplete
                label="Bank Name"
                icon="bank"
                value={nurseBankName}
                onSelect={(bankName) => {
                  setNurseBankName(bankName);
                  setNurseBankBranch(''); // Clear branch when bank changes
                }}
                placeholder="Select your bank (e.g., NCB, Scotiabank, JMMB)"
              />

              <Text style={styles.formLabel}>Account Number</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="credit-card-outline" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="Bank account number"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseAccountNumber}
                  onChangeText={setNurseAccountNumber}
                  keyboardType="numeric"
                />
              </View>

              <Text style={styles.formLabel}>Account Holder Name</Text>
              <View style={styles.formInput}>
                <MaterialCommunityIcons name="account-outline" size={20} color={COLORS.textLight} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name as on bank account"
                  placeholderTextColor={COLORS.textLight}
                  value={nurseAccountHolderName}
                  onChangeText={setNurseAccountHolderName}
                />
              </View>

              <BankAutocomplete
                label="Bank Branch"
                icon="map-marker-outline"
                value={nurseBankBranch}
                onSelect={(branchName) => setNurseBankBranch(branchName)}
                placeholder="Select branch (e.g., Liguanea, Half Way Tree)"
                isBranch={true}
                selectedBank={nurseBankName}
              />
            </ScrollView>
            
            <View style={styles.modalFooter}>
              <TouchableWeb
                style={styles.modalCancelButton}
                onPress={() => setCreateNurseModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableWeb>
              <TouchableWeb
                style={styles.createButton}
                onPress={handleCreateNurse}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={GRADIENTS.header}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.createButtonGradient}
                >
                  <MaterialCommunityIcons name={editMode ? "content-save" : "account-plus"} size={20} color={COLORS.white} />
                  <Text style={styles.createButtonText}>{editMode ? "Update Staff" : "Add Staff"}</Text>
                </LinearGradient>
              </TouchableWeb>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Role Selection Modal */}
      <Modal
        transparent={true}
        visible={showRoleModal}
        animationType="fade"
        onRequestClose={() => {
          setShowRoleModal(false);
        }}
      >
        <View style={styles.roleModalOverlay}>
          <TouchableWeb 
            style={styles.roleModalBackdrop}
            activeOpacity={1}
            onPress={() => setShowRoleModal(false)}
          />
          <View style={styles.roleModalContainer}>
            <TouchableWeb 
              activeOpacity={1} 
              onPress={(e) => e.stopPropagation()}
              style={styles.roleModalContent}
            >
              <Text style={styles.roleModalTitle}>Select Staff Role</Text>
              
              <TouchableWeb
                style={styles.roleModalOption}
                onPress={() => handleRoleSelection('nurse')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="hospital-box" size={24} color={COLORS.primary} />
                <View style={styles.roleModalOptionText}>
                  <Text style={styles.roleModalOptionTitle}>Nurse</Text>
                  <Text style={styles.roleModalOptionSubtitle}>Healthcare professional</Text>
                </View>
                {staffRole === 'nurse' && (
                  <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.success} />
                )}
              </TouchableWeb>

              <TouchableWeb
                style={styles.roleModalOption}
                onPress={() => handleRoleSelection('admin')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="shield-account" size={24} color={COLORS.primary} />
                <View style={styles.roleModalOptionText}>
                  <Text style={styles.roleModalOptionTitle}>Administrator</Text>
                  <Text style={styles.roleModalOptionSubtitle}>System administrator</Text>
                </View>
                {staffRole === 'admin' && (
                  <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.success} />
                )}
              </TouchableWeb>
            </TouchableWeb>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  watermarkLogo: {
    position: 'absolute',
    width: 250,
    height: 250,
    alignSelf: 'center',
    top: '40%',
    opacity: 0.05,
    zIndex: 0,
  },
  header: { paddingHorizontal: 20, paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { width: 44 }, // Same width as iconButton to balance
  welcomeText: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: COLORS.white, flex: 1, textAlign: 'center' },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.2)', justifyContent: 'center', alignItems: 'center', position: 'relative' },
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
  content: { flex: 1 },
  statsContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
  },
  statGradient: {
    paddingHorizontal: 10,
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
  inactiveStatCard: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  inactiveStatLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  section: { 
    padding: 20,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 450,
  },
  sectionTitle: { fontSize: 18, fontFamily: 'Poppins_600SemiBold', color: COLORS.text, marginBottom: 12 },
  card: { backgroundColor: COLORS.white, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: COLORS.text },
  titleWithBadge: { flex: 1 },
  cardSubtitle: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: COLORS.textLight, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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
  deleteButton: { padding: 6, borderRadius: 8, backgroundColor: 'rgba(244, 67, 54, 0.1)' },
  cardDetails: { gap: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: COLORS.text, flex: 1 },
  clientInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  clientCount: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: COLORS.primary },
  
  // Compact Card Styles (matching dashboard completed appointments)
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
  
  // Details Modal Styles
  detailsModalContent: {
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
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsModalBody: {
    padding: 20,
  },
  detailsSection: {
    gap: 16,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0, 0, 0, 0.5)', 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: 20,
  },
  deleteModal: { backgroundColor: COLORS.white, borderRadius: 20, padding: 24, margin: 20, alignItems: 'center', maxWidth: 320 },
  deleteTitle: { fontSize: 18, fontFamily: 'Poppins_600SemiBold', color: COLORS.text, marginTop: 16, marginBottom: 8 },
  deleteMessage: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: COLORS.textLight, textAlign: 'center', marginBottom: 24 },
  deleteActions: { flexDirection: 'row', gap: 12 },
  cancelButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, backgroundColor: COLORS.background },
  cancelButtonText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: COLORS.text, textAlign: 'center' },
  confirmButton: { flex: 1, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, backgroundColor: COLORS.error },
  confirmButtonText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: COLORS.white, textAlign: 'center' },
  modalContent: {
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
    overflow: 'hidden',
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
  createNurseForm: {
    maxHeight: Platform.OS === 'android' ? '93%' : '85%',
  },
  createNurseFormContent: {
    padding: 20,
    paddingBottom: 20,
  },
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
    color: COLORS.textLight,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
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
    flex: 1,
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
  // Horizontal Box Layout Styles
  horizontalBoxContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  staffBox: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  boxLabel: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    marginBottom: 8,
    textAlign: 'center',
  },
  roleSelector: {
    flexDirection: 'column',
    gap: 6,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    gap: 6,
  },
  roleOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.card,
  },
  roleOptionText: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
  },
  roleOptionTextSelected: {
    color: COLORS.primary,
  },
  codeGenerationContainer: {
    alignItems: 'center',
    gap: 6,
  },
  sequenceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.background,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sequenceText: {
    fontSize: 9,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  generateButtonSmall: {
    borderRadius: 6,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  generateButtonGradientSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 3,
  },
  generateButtonTextSmall: {
    fontSize: 9,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  generatedCodeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.success + '10',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.success + '30',
    gap: 8,
    marginBottom: 16,
  },
  generatedCodeText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.success,
    textAlign: 'center',
  },
  // Dropdown Styles
  dropdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
    gap: 12,
  },
  dropdownText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  // Auto-Generated Code Field Styles
  codeDisplayField: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary + '40',
    marginBottom: 16,
    gap: 12,
  },
  autoCodeText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.primary,
  },
  autoLabel: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  autoLabelText: {
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  // Role Toggle Styles (simpler approach)
  roleToggleContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  roleToggleOption: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1, // Reduced border width
    borderColor: COLORS.border, // Default border is neutral
    backgroundColor: COLORS.card,
    overflow: 'hidden', // Required for child gradient
  },
  roleToggleSelected: {
    borderColor: 'transparent', // Gradient handles the border look
    backgroundColor: COLORS.primary, // Fallback
  },
  roleToggleText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
  },
  roleToggleTextSelected: {
    color: COLORS.white,
  },
  // Role Selection Modal Styles
  roleModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleModalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  roleModalContainer: {
    width: '80%',
    maxWidth: 300,
  },
  roleModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  roleModalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  roleModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  roleModalOptionText: {
    flex: 1,
  },
  roleModalOptionTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  roleModalOptionSubtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 2,
  },
  // Delete Button Styles
  deleteButtonContainer: {
    marginTop: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 12,
  },
  actionButtonWrapper: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  actionButtonContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Modal Footer Buttons (matching shift request details modal)
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    alignItems: 'stretch',
  },
  modalEditButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalDeleteButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  modalButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  // Photo Upload Styles
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 8,
  },
  photoUploadContainer: {
    marginBottom: 20,
  },
  photoUploadButton: {
    backgroundColor: COLORS.background,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  photoUploadText: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
    marginTop: 8,
    textAlign: 'center',
  },
  photoUploadSubtext: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
  photoPreviewContainer: {
    alignItems: 'center',
  },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginBottom: 12,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 12,
  },
  changePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  changePhotoText: {
    color: COLORS.white,
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
  },
  removePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff4444',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  removePhotoText: {
    color: COLORS.white,
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
  },
});
