import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
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
  const [adminPayslips, setAdminPayslips] = useState([]);
  const [payslipModalVisible, setPayslipModalVisible] = useState(false);
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

  // Load payslips for this admin
  useEffect(() => {
    const loadPayslips = async () => {
      try {
        const payslipsJson = await AsyncStorage.getItem('generatedPayslips');
        if (payslipsJson && user?.id) {
          const allPayslips = JSON.parse(payslipsJson);
          const myPayslips = allPayslips.filter(payslip => 
            payslip.staffId === user.id && payslip.staffType === 'admin'
          );
          // Sort by generated date, most recent first
          myPayslips.sort((a, b) => new Date(b.generatedDate) - new Date(a.generatedDate));
          setAdminPayslips(myPayslips);
        }
      } catch (error) {
        console.error('Error loading admin payslips:', error);
      }
    };
    
    loadPayslips();
    // Reload payslips when screen is focused
    const interval = setInterval(loadPayslips, 3000); // Check every 3 seconds
    return () => clearInterval(interval);
  }, [user?.id]);

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
                  <MaterialCommunityIcons name="account-tie" size={40} color={COLORS.white} />
                </View>
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{formData.username}</Text>
              <Text style={styles.adminRole}>{formData.title || 'Administrator'}</Text>
              <Text style={styles.department}>{formData.department}</Text>
              <Text style={styles.employeeCode}>ID: {formData.employeeId}</Text>
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

        {/* Payslips Section */}
        <TouchableWeb 
          style={styles.sectionCard}
          onPress={() => setPayslipModalVisible(true)}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="receipt-text" size={24} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>My Payslips</Text>
            <View style={styles.payslipBadgeContainer}>
              {adminPayslips.length > 0 && (
                <View style={styles.payslipBadge}>
                  <Text style={styles.payslipBadgeText}>{adminPayslips.length}</Text>
                </View>
              )}
              <MaterialCommunityIcons name="chevron-down" size={24} color={COLORS.textLight} />
            </View>
          </View>
          
          {adminPayslips.length === 0 ? (
            <View style={styles.emptyPayslipsPreview}>
              <Text style={styles.emptyPayslipsText}>No payslips yet</Text>
              <Text style={styles.emptyPayslipsSubtext}>Payslips will appear here when generated by admin</Text>
            </View>
          ) : (
            <View style={styles.payslipsPreview}>
              <Text style={styles.payslipsPreviewText}>
                Latest: {adminPayslips[0]?.periodStart} - {adminPayslips[0]?.periodEnd}
              </Text>
              <Text style={styles.payslipsPreviewAmount}>
                J${parseFloat(adminPayslips[0]?.netPay || 0).toLocaleString()}
              </Text>
            </View>
          )}
        </TouchableWeb>

        <SectionDivider />

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

          {/* Banking Details Section */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Banking Details</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Bank Name</Text>
              <TextInput
                style={[styles.input, !isEditing && styles.inputDisabled]}
                value={formData.bankName}
                onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, bankName: text }))}
                editable={isEditing}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Account Number</Text>
              <TextInput
                style={[styles.input, !isEditing && styles.inputDisabled]}
                value={formData.accountNumber}
                onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, accountNumber: text }))}
                keyboardType="numeric"
                editable={isEditing}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Account Holder Name</Text>
              <TextInput
                style={[styles.input, !isEditing && styles.inputDisabled]}
                value={formData.accountHolderName}
                onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, accountHolderName: text }))}
                editable={isEditing}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Bank Branch</Text>
              <TextInput
                style={[styles.input, !isEditing && styles.inputDisabled]}
                value={formData.bankBranch}
                onChangeText={(text) => isEditing && setFormData(prev => ({ ...prev, bankBranch: text }))}
                editable={isEditing}
              />
            </View>
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

      {/* Payslip Modal */}
      <Modal
        visible={payslipModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPayslipModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <MaterialCommunityIcons name="receipt-text" size={24} color={COLORS.primary} />
                <Text style={styles.modalTitle}>My Payslips</Text>
              </View>
              <TouchableWeb 
                onPress={() => setPayslipModalVisible(false)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="close" size={24} color={COLORS.textLight} />
              </TouchableWeb>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {adminPayslips.length === 0 ? (
                <View style={styles.emptyPayslipsModal}>
                  <MaterialCommunityIcons name="receipt" size={64} color={COLORS.border} />
                  <Text style={styles.emptyPayslipsModalText}>No payslips yet</Text>
                  <Text style={styles.emptyPayslipsModalSubtext}>
                    Payslips will appear here when generated by admin
                  </Text>
                </View>
              ) : (
                <View style={styles.payslipsList}>
                  {adminPayslips.map((payslip, index) => (
                    <View key={index} style={styles.payslipItem}>
                      <View style={styles.payslipHeader}>
                        <View style={styles.payslipInfo}>
                          <Text style={styles.payslipPeriod}>
                            {payslip.periodStart} - {payslip.periodEnd}
                          </Text>
                          <Text style={styles.payslipDate}>
                            Generated: {new Date(payslip.generatedDate).toLocaleDateString()}
                          </Text>
                        </View>
                        <View style={styles.payslipAmount}>
                          <Text style={styles.payslipAmountLabel}>Net Pay</Text>
                          <Text style={styles.payslipAmountValue}>
                            J${parseFloat(payslip.netPay).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                      
                      <View style={styles.payslipDetails}>
                        <View style={styles.payslipDetailRow}>
                          <Text style={styles.payslipDetailLabel}>Payment Type:</Text>
                          <Text style={styles.payslipDetailValue}>
                            {payslip.payType === 'salary' ? 'Monthly Salary' : 'Hourly'}
                          </Text>
                        </View>
                        {payslip.payType === 'hourly' && payslip.hoursWorked && (
                          <View style={styles.payslipDetailRow}>
                            <Text style={styles.payslipDetailLabel}>Hours Worked:</Text>
                            <Text style={styles.payslipDetailValue}>{payslip.hoursWorked} hrs</Text>
                          </View>
                        )}
                        <View style={styles.payslipDetailRow}>
                          <Text style={styles.payslipDetailLabel}>Base Pay:</Text>
                          <Text style={styles.payslipDetailValue}>
                            J${parseFloat(payslip.basePay).toLocaleString()}
                          </Text>
                        </View>
                        {payslip.totalAllowances && parseFloat(payslip.totalAllowances) > 0 && (
                          <View style={styles.payslipDetailRow}>
                            <Text style={styles.payslipDetailLabel}>Allowances:</Text>
                            <Text style={styles.payslipDetailValue}>
                              J${parseFloat(payslip.totalAllowances).toLocaleString()}
                            </Text>
                          </View>
                        )}
                        <View style={styles.payslipDetailRow}>
                          <Text style={styles.payslipDetailLabel}>Gross Pay:</Text>
                          <Text style={styles.payslipDetailValue}>
                            J${parseFloat(payslip.grossPay).toLocaleString()}
                          </Text>
                        </View>
                        {payslip.totalDeductions && parseFloat(payslip.totalDeductions) > 0 && (
                          <View style={styles.payslipDetailRow}>
                            <Text style={styles.payslipDetailLabel}>Deductions:</Text>
                            <Text style={styles.payslipDetailValue}>
                              -J${parseFloat(payslip.totalDeductions).toLocaleString()}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
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
    marginTop: -10,
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
    marginBottom: 20,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  adminRole: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  department: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  employeeCode: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
    marginLeft: 12,
  },
  payslipBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  payslipBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginRight: 8,
  },
  payslipBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  payslipsPreview: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 12,
  },
  payslipsPreviewText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  payslipsPreviewAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  emptyPayslipsPreview: {
    paddingVertical: 16,
  },
  emptyPayslipsText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textLight,
    marginTop: 12,
  },
  emptyPayslipsSubtext: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 4,
    paddingHorizontal: 40,
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
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingTop: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginLeft: 12,
  },
  modalScroll: {
    flex: 1,
  },
  emptyPayslipsModal: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyPayslipsModalText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textLight,
    marginTop: 16,
  },
  emptyPayslipsModalSubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  payslipsList: {
    padding: 20,
    gap: 16,
  },
  payslipItem: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  payslipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  payslipInfo: {
    flex: 1,
  },
  payslipPeriod: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  payslipDate: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  payslipAmount: {
    alignItems: 'flex-end',
  },
  payslipAmountLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  payslipAmountValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  payslipDetails: {
    gap: 8,
  },
  payslipDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  payslipDetailLabel: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  payslipDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
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
