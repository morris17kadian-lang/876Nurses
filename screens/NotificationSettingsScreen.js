import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import TouchableWeb from '../components/TouchableWeb';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { COLORS, GRADIENTS, SPACING } from '../constants';

export default function NotificationSettingsScreen({ navigation }) {
  const { 
    pushPermissionStatus, 
    requestPushPermissions,
    notificationPreferences,
    saveNotificationPreferences,
  } = useNotifications();
  const { user } = useAuth();

  const [settings, setSettings] = useState({
    pushNotifications: false,
    // chatMessages: true, // REMOVED
    appointments: true,
    reminders: true,
    serviceUpdates: true,
    payments: true,
    systemNotifications: false,
    emailNotifications: true,
  });

  // Preferences are loaded per user by NotificationProvider and synced to Firestore.
  useEffect(() => {
    setSettings(prev => ({
      ...prev,
      ...notificationPreferences,
      pushNotifications: pushPermissionStatus === 'granted' && notificationPreferences.pushNotifications !== false,
    }));
  }, [user?.id, notificationPreferences, pushPermissionStatus]);

  const saveNotificationPreference = async (key, value) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await saveNotificationPreferences({ [key]: value });
  };

  const handlePushNotificationToggle = async (value) => {
    if (value && pushPermissionStatus !== 'granted') {
      Alert.alert(
        'Enable Push Notifications',
        'Allow 876Nurses to send you important notifications about appointments, payments, and health reminders.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Enable',
            onPress: async () => {
              const status = await requestPushPermissions();
              if (status === 'granted') {
                setSettings(prev => ({ ...prev, pushNotifications: true }));
                await saveNotificationPreferences({ pushNotifications: true });
              } else {
                Alert.alert(
                  'Permission Denied',
                  'You can enable notifications later in your device settings.',
                  [{ text: 'OK' }]
                );
              }
            },
          },
        ]
      );
    } else {
      setSettings(prev => ({ ...prev, pushNotifications: value }));
      await saveNotificationPreferences({ pushNotifications: value });
      if (!value) {
        Alert.alert(
          'Notifications Disabled',
          'You can re-enable notifications anytime in Settings.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const handleSettingToggle = (key, value) => {
    saveNotificationPreference(key, value);
  };

  const SettingRow = ({ icon, title, subtitle, value, onToggle, iconColor = COLORS.primary }) => (
    <View style={styles.settingRow}>
      <View style={styles.settingLeft}>
        <View style={styles.settingText}>
          <Text style={styles.settingTitle}>{title}</Text>
          {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: COLORS.border, true: COLORS.primary }}
        thumbColor={COLORS.white}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <TouchableWeb
            style={styles.iconButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.headerTitle}>Notification Settings</Text>
          <View style={styles.iconButton} />
        </View>
      </LinearGradient>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
        pointerEvents="none"
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Push Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Push Notifications</Text>

          <View style={styles.settingsCard}>
            <SettingRow
              icon="bell-ring"
              title="Push Notifications"
              subtitle={
                pushPermissionStatus === 'granted' 
                  ? "Enabled - you'll receive notifications on your device"
                  : pushPermissionStatus === 'denied'
                  ? "Disabled - enable in device settings"
                  : "Not configured - tap to enable"
              }
              value={settings.pushNotifications}
              onToggle={handlePushNotificationToggle}
              iconColor={COLORS.accent}
            />
            <View style={styles.divider} />
          </View>
        </View>

        {/* Notification Types */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notification Types</Text>

          {/* Chat Messages Setting REMOVED */}

          <View style={styles.settingsCard}>
            <SettingRow
              icon="calendar-clock"
              title="Appointments"
              subtitle="Appointment reminders and updates"
              value={settings.appointments}
              onToggle={(value) => handleSettingToggle('appointments', value)}
              iconColor={COLORS.primary}
            />

            {/* Medication Reminders - Only show for patients */}
            {user?.role === 'patient' && (
              <>
                <View style={styles.divider} />
                <SettingRow
                  icon="pill"
                  title="Medication Reminders"
                  subtitle="Reminders to take medication"
                  value={settings.reminders}
                  onToggle={(value) => handleSettingToggle('reminders', value)}
                  iconColor={COLORS.accent}
                />
              </>
            )}

            <View style={styles.divider} />
            <SettingRow
              icon="medical-bag"
              title="Service Updates"
              subtitle="New healthcare services and updates"
              value={settings.serviceUpdates}
              onToggle={(value) => handleSettingToggle('serviceUpdates', value)}
              iconColor="#95E1D3"
            />

            <View style={styles.divider} />
            <SettingRow
              icon="credit-card-outline"
              title="Payments and Invoices"
              subtitle="Payment receipts, invoice updates, and overdue notices"
              value={settings.payments}
              onToggle={(value) => handleSettingToggle('payments', value)}
              iconColor="#10B981"
            />

            <View style={styles.divider} />
            <SettingRow
              icon="information"
              title="System Notifications"
              subtitle="App updates and maintenance notices"
              value={settings.systemNotifications}
              onToggle={(value) => handleSettingToggle('systemNotifications', value)}
              iconColor="#6C5CE7"
            />
            <View style={styles.divider} />
          </View>
        </View>

        {/* Email Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Email Notifications</Text>

          <View style={styles.settingsCard}>
            <SettingRow
              icon="email-outline"
              title="Email Updates"
              subtitle="Receive appointment confirmations and updates via email"
              value={settings.emailNotifications}
              onToggle={(value) => handleSettingToggle('emailNotifications', value)}
              iconColor="#FFA726"
            />
            <View style={styles.divider} />
          </View>
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
  watermarkLogo: {
    position: 'absolute',
    width: 250,
    height: 250,
    alignSelf: 'center',
    top: '40%',
    opacity: 0.05,
    zIndex: 0,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  content: {
    flex: 1,
    padding: SPACING.md,
    zIndex: 1,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: SPACING.lg,
    lineHeight: 20,
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
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.md,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 18,
  },
});
