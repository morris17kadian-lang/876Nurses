import TouchableWeb from "../components/TouchableWeb";
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, GRADIENTS, SPACING } from '../constants';
import { useAuth } from '../context/AuthContext';
import ApiService from '../services/ApiService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FirebaseService from '../services/FirebaseService';


export default function PrivacySecurityScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const handleDownloadData = async () => {
    try {
      if (!user?.id) {
        Alert.alert('Error', 'No user found for data export');
        return;
      }

      await ApiService.createDataRequest({
        userId: user.id,
        type: 'access',
        source: 'app',
      });

      const profileResult = await FirebaseService.getUser(user.id);
      const profile = profileResult?.user || {};
      const appointmentsResult = await FirebaseService.getAppointments(user.id);
      const appointments = appointmentsResult?.appointments || [];
      const invoices = await ApiService.getInvoices({ userId: user.id });
      const notifications = await ApiService.getNotifications(user.id, { limit: 500 });
      const privacySettings = await ApiService.getPrivacySettings(user.id);

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        user: profile,
        privacySettings,
        appointments,
        invoices,
        notifications,
      };

      const fileUri = `${FileSystem.documentDirectory}876nurses-data-${user.id}-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(exportPayload, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'Download My Data',
        });
      } else {
        Alert.alert('Saved', `Your data export is saved at: ${fileUri}`);
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to export your data. Please try again.');
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'No user found for deletion');
      return;
    }

    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await ApiService.deleteOwnAccount();

              await AsyncStorage.clear();
              await logout();
              Alert.alert('Account Deleted', 'Your account has been deleted.');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete account. Please contact support.');
            }
          },
        },
      ]
    );
  };

  const InfoCard = ({ title, description }) => (
    <View style={[styles.settingItem, { alignItems: 'flex-start' }]}>
      <View style={styles.settingContent}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.infoDescription}>{description}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerRow}>
          <TouchableWeb 
            style={styles.iconButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={26} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.welcomeText}>Privacy & Security</Text>
          <View style={{ width: 44 }} />
        </View>
      </LinearGradient>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Security Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security Settings</Text>
          <View style={styles.settingsCard}>
            <InfoCard
              title="Your Data is Encrypted"
              description="All your personal and medical information is encrypted using industry-standard security protocols."
            />
            <View style={styles.divider} />
            <InfoCard
              title="Account Security"
              description="We use advanced security measures to protect your account from unauthorized access."
            />
            <View style={styles.divider} />
            <InfoCard
              title="Data Protection"
              description="Your data is stored securely and never sold to third parties. View our privacy policy for details."
            />
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.section}>
          <TouchableWeb
            style={styles.actionButton}
            onPress={handleDownloadData}
          >
            <MaterialCommunityIcons name="download" size={20} color={COLORS.primary} />
            <Text style={styles.actionButtonText}>Download My Data</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textLight} />
          </TouchableWeb>

          <TouchableWeb
            style={styles.actionButton}
            onPress={() => navigation.navigate('Privacy')}
          >
            <MaterialCommunityIcons name="file-document" size={20} color={COLORS.primary} />
            <Text style={styles.actionButtonText}>View Privacy Policy</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textLight} />
          </TouchableWeb>

          <TouchableWeb
            style={styles.deleteAccountButton}
            onPress={handleDeleteAccount}
          >
            <LinearGradient
              colors={['#FF4757', '#FF6348']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.deleteAccountGradient}
            >
              <MaterialCommunityIcons name="delete-forever" size={16} color={COLORS.white} />
              <Text style={styles.deleteAccountText}>Delete Account</Text>
            </LinearGradient>
          </TouchableWeb>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  welcomeText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    opacity: 0.98,
    textAlign: 'center',
    flex: 1,
    marginHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  notificationBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
  section: {
    padding: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  settingsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.md,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    gap: SPACING.md,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  infoDescription: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.md,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  actionButtonText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: COLORS.errorLight,
  },
  dangerText: {
    color: COLORS.error,
  },
  deleteAccountButton: {
    marginTop: SPACING.sm,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  deleteAccountGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  deleteAccountText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
});
