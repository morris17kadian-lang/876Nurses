import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, GRADIENTS } from '../constants';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useProfileEdit } from '../context/ProfileEditContext';
import TouchableWeb from '../components/TouchableWeb';
import { clearAllAdminData } from '../utils/clearAllData';

export default function AdminProfileScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const { sendNotificationToUser } = useNotifications();
  const { createEditRequest, canEditProfile, revokeEditPermission } = useProfileEdit();
  const insets = useSafeAreaInsets();
  const isAdmin001 = ((user?.code || user?.adminCode || user?.username || '') + '').toUpperCase() === 'ADMIN001';
  const displayEmail = user?.contactEmail || user?.email || '';
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhoto || null);
  const [adminStaffData, setAdminStaffData] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    username: user?.fullName || user?.username || '',
    email: displayEmail,
    phone: user?.phone || '',
    title: user?.title || 'Administrator',
    department: user?.department || 'Administration',
    employeeId: user?.code || '',
    bankName: user?.bankingDetails?.bankName || user?.bankName || '',
    accountNumber: user?.bankingDetails?.accountNumber || user?.accountNumber || '',
    accountHolderName: user?.bankingDetails?.accountHolderName || user?.accountHolderName || '',
    bankBranch: user?.bankingDetails?.bankBranch || user?.bankBranch || '',
  });

  // Load admin data from staff management
  useEffect(() => {
    const loadAdminData = async () => {
      try {
        // First, use data from the user object (which comes from API login response)
        if (user?.fullName || user?.username) {
          setFormData({
            username: user?.fullName || user?.username || '',
            email: user?.contactEmail || user?.email || '',
            phone: user?.phone || '',
            title: user?.title || 'Administrator',
            department: user?.department || 'Administration',
            employeeId: user?.code || '',
            bankName: user?.bankingDetails?.bankName || user?.bankName || '',
            accountNumber: user?.bankingDetails?.accountNumber || user?.accountNumber || '',
            accountHolderName: user?.bankingDetails?.accountHolderName || user?.accountHolderName || '',
            bankBranch: user?.bankingDetails?.bankBranch || user?.bankBranch || '',
          });
        }

        // Also try to load from local storage for additional data
        const usersData = await AsyncStorage.getItem('users');
        if (usersData && user?.id) {
          const allUsers = JSON.parse(usersData);
          const adminRecord = allUsers.find(u => 
            u.id === user.id || u.email === user.email || u.code === user.code
          );
          
          if (adminRecord) {
            setAdminStaffData(adminRecord);
            // Update form data with admin record (but give priority to API data)
            setFormData(prev => ({
              ...prev,
              username: adminRecord.username || adminRecord.fullName || prev.username || '',
              email: adminRecord.contactEmail || adminRecord.email || prev.email || '',
              phone: adminRecord.phone || prev.phone || '',
              title: adminRecord.title || prev.title || 'Administrator',
              department: adminRecord.department || prev.department || 'Administration',
              employeeId: adminRecord.code || prev.employeeId || '',
              bankName: adminRecord.bankName || prev.bankName || '',
              accountNumber: adminRecord.accountNumber || prev.accountNumber || '',
              accountHolderName: adminRecord.accountHolderName || prev.accountHolderName || '',
              bankBranch: adminRecord.bankBranch || prev.bankBranch || '',
            }));
          }
        }
      } catch (error) {
        console.error('Error loading admin data:', error);
      }
    };

    if (user?.role === 'admin') {
      loadAdminData();
    }
  }, [user]);

  const handleSave = async () => {
    try {
      // Get the API URL based on environment
      const API_URL = __DEV__ 
        ? 'http://192.168.100.82:5000/api' 
        : 'https://shielded-coast-08850-f496a70eafdb.herokuapp.com/api';
      
      // Prepare update data for backend
      const updateData = {
        fullName: formData.username,
        email: isAdmin001 ? (user?.email || formData.email) : formData.email,
        phone: formData.phone,
        title: formData.title,
        department: formData.department,
        bankingDetails: {
          bankName: formData.bankName,
          accountNumber: formData.accountNumber,
          accountHolderName: formData.accountHolderName,
          bankBranch: formData.bankBranch
        }
      };

      // Get the token from storage
      const token = await AsyncStorage.getItem('authToken');
      
      // Send update to backend
      const response = await fetch(`${API_URL}/staff/admin/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to update profile');
      }

      // Update user in context with new data
      updateUser({
        ...user,
        fullName: formData.username,
        ...(isAdmin001 ? { contactEmail: formData.email } : { email: formData.email }),
        phone: formData.phone,
        title: formData.title,
        department: formData.department,
        bankingDetails: {
          bankName: formData.bankName,
          accountNumber: formData.accountNumber,
          accountHolderName: formData.accountHolderName,
          bankBranch: formData.bankBranch
        }
      });

      // Save to local storage as backup
      await AsyncStorage.setItem('adminProfile', JSON.stringify(formData));

      setIsEditing(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', error.message || 'Failed to update profile');
    }
  };

  const handleCancel = () => {
    setFormData({
      username: user?.fullName || user?.username || '',
      email: user?.email || '',
      phone: user?.phone || '',
      title: user?.title || 'Administrator',
      department: user?.department || 'Administration',
      employeeId: user?.code || '',
      address: user?.address || '',
      bankName: user?.bankingDetails?.bankName || user?.bankName || '',
      accountNumber: user?.bankingDetails?.accountNumber || user?.accountNumber || '',
      accountHolderName: user?.bankingDetails?.accountHolderName || user?.accountHolderName || '',
      bankBranch: user?.bankingDetails?.bankBranch || user?.bankBranch || '',
    });
    setIsEditing(false);
  };

  const handleClearAllData = async () => {
    Alert.alert(
      'Clear All Sample Data',
      'This will clear all analytics, services, transactions, and profile data. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllAdminData();
              // Reset form data
              setFormData({
                username: user?.fullName || user?.username || '',
                email: user?.email || '',
                phone: user?.phone || '',
                title: '',
                department: '',
                employeeId: user?.code || '',
                bankName: '',
                accountNumber: '',
                accountHolderName: '',
                bankBranch: '',
              });
              Alert.alert('Success', '✅ All sample data has been cleared!');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          }
        }
      ]
    );
  };

  const SectionDivider = () => (
    <LinearGradient
      colors={GRADIENTS.header}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.sectionDivider}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <KeyboardAvoidingView 
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      {/* Header */}
      <LinearGradient 
        colors={GRADIENTS.header} 
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerContent}>
          <TouchableWeb
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.headerTitle}>Admin Profile</Text>
          <TouchableWeb
            onPress={isEditing ? handleSave : () => setIsEditing(true)}
            style={styles.editButton}
          >
            <MaterialCommunityIcons 
              name={isEditing ? "check" : "pencil"} 
              size={24} 
              color={COLORS.white} 
            />
          </TouchableWeb>
        </View>
      </LinearGradient>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View style={styles.avatarContainer}>
              {profilePhoto ? (
                <Image source={{ uri: profilePhoto }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <MaterialCommunityIcons name="account-tie" size={64} color={COLORS.white} />
                </View>
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{formData.username || 'Administrator'}</Text>
              <Text style={styles.adminRole}>{formData.title || 'Administrator'}</Text>
              <Text style={styles.department}>{formData.department}</Text>
              {!!formData.employeeId && <Text style={styles.employeeCode}>ID: {formData.employeeId}</Text>}
            </View>
          </View>
        </View>

        <SectionDivider />

        {/* Edit Mode Info */}
        {isEditing && (
          <View style={styles.editInfo}>
            <MaterialCommunityIcons name="information" size={20} color={COLORS.accent} />
            <View style={styles.editInfoText}>
              <Text style={styles.editingTitle}>Editing Mode Active</Text>
              <Text style={styles.editingDescription}>
                You can now edit your profile. Changes will be submitted for approval.
              </Text>
            </View>
          </View>
        )}

        {/* Profile Details */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Contact Information</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={formData.username}
              onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, username: text }))}
              editable={isEditing}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={formData.email}
              onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, email: text }))}
              keyboardType="email-address"
              editable={isEditing && !isAdmin001}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={formData.phone}
              onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, phone: text }))}
              keyboardType="phone-pad"
              editable={isEditing}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Job Title</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={formData.title}
              onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, title: text }))}
              editable={isEditing}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Department</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.inputDisabled]}
              value={formData.department}
              onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, department: text }))}
              editable={isEditing}
            />
          </View>

        </View>



        {/* Cancel button when editing */}
        {isEditing && (
          <TouchableWeb style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel Changes</Text>
          </TouchableWeb>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
      </KeyboardAvoidingView>

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
  keyboardContainer: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    flex: 1,
    textAlign: 'center',
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionDivider: {
    height: 2,
    borderRadius: 2,
    marginHorizontal: 20,
    marginVertical: 12,
  },
  profileCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    paddingVertical: 30,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  profileHeader: {
    alignItems: 'center',
    width: '100%',
  },
  avatarContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: COLORS.white,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 16,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 60,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    alignItems: 'center',
    width: '100%',
  },
  profileName: {
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  adminRole: {
    fontSize: 16,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: 2,
    textAlign: 'center',
  },
  department: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textMuted,
    marginBottom: 2,
    textAlign: 'center',
  },
  employeeCode: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    fontWeight: '500',
    textAlign: 'center',
  },
  editInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.accent + '15',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  editInfoText: {
    flex: 1,
    marginLeft: 12,
  },
  editingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  editingDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'left',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.white,
  },
  inputDisabled: {
    backgroundColor: COLORS.background,
    color: COLORS.textMuted,
  },
  cancelButton: {
    backgroundColor: COLORS.error,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  cancelButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  bottomPadding: {
    height: 80,
  },
  clearDataButton: {
    marginHorizontal: 20,
    marginVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    gap: 8,
  },
  clearDataButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
