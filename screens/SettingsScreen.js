import TouchableWeb from "../components/TouchableWeb";
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Linking,
  Image,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, TYPOGRAPHY, GRADIENTS, CONTACT_INFO } from '../constants';
import { useAuth } from '../context/AuthContext';
import Constants from 'expo-constants';

export default function SettingsScreen({ navigation }) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version || '1.0.3';
  const currentYear = new Date().getFullYear();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: logout
        }
      ]
    );
  };

  const handleProfile = () => {
    navigation.navigate('Profile');
  };

  const handlePrivacy = () => {
    navigation.navigate('PrivacySecurity');
  };

  const handleChangePassword = () => {
    navigation.navigate('ChangePassword');
  };

  const handleNotificationSettings = () => {
    navigation.navigate('NotificationSettings');
  };

  const handleUserManual = () => {
    navigation.navigate('UserManual');
  };

  const handleHelpFAQ = () => {
    navigation.navigate('Help');
  };

  const handleAbout = () => {
    navigation.navigate('About');
  };


  const SettingItem = ({ icon, title, subtitle, onPress, showChevron = true, rightContent }) => (
    <TouchableWeb
      style={styles.settingItem}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={styles.iconContainer}>
        <LinearGradient colors={GRADIENTS.primary} style={styles.iconGradient}>
          <MaterialCommunityIcons name={icon} size={18} color={COLORS.white} />
        </LinearGradient>
      </View>
      <View style={styles.settingContent}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {rightContent || (showChevron && (
        <MaterialCommunityIcons name="chevron-right" size={24} color={COLORS.textLight} />
      ))}
    </TouchableWeb>
  );

  const SectionHeader = ({ title }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.welcomeText}>Settings</Text>
        </View>
      </LinearGradient>

      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Account Section */}
        <SectionHeader title="ACCOUNT" />
        <View style={styles.section}>
          <SettingItem
            icon="account-circle"
            title="Profile"
            subtitle="Edit your personal information"
            onPress={handleProfile}
          />
          <SettingItem
            icon="shield-check"
            title="Privacy & Security"
            subtitle="Manage your privacy settings"
            onPress={handlePrivacy}
          />
          <SettingItem
            icon="lock"
            title="Change Password"
            subtitle="Update your password"
            onPress={handleChangePassword}
          />
        </View>

        {/* Admin Management Hub - Only visible for super admin (ADMIN001) */}
        {/* Notifications Section */}
        <SectionHeader title="NOTIFICATIONS" />
        <View style={styles.section}>
          <SettingItem
            icon="bell-cog"
            title="Notification Settings"
            subtitle="Manage push notifications and preferences"
            onPress={handleNotificationSettings}
          />
        </View>

        {/* Help & FAQ Section */}
        <SectionHeader title="HELP & FAQ" />
        <View style={styles.section}>
          <SettingItem
            icon="book-open-page-variant"
            title="User Manual"
            subtitle="Complete guide to using the app"
            onPress={handleUserManual}
          />
          <SettingItem
            icon="help-circle"
            title="Help & FAQ"
            subtitle="Common questions and answers"
            onPress={handleHelpFAQ}
          />
        </View>

        {/* Support Section */}
        <SectionHeader title="SUPPORT" />
        <View style={styles.section}>
          <SettingItem
            icon="information"
            title="About"
            subtitle={`Version ${appVersion}`}
            onPress={handleAbout}
          />
        </View>

        {/* Logout Button */}
        <TouchableWeb
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#FF4757', '#FF6348']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.logoutGradient}
          >
            <MaterialCommunityIcons name="logout" size={16} color={COLORS.white} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </LinearGradient>
        </TouchableWeb>

        <View style={styles.footer}>
          <Text style={styles.footerText}>876 Nurses Home Care Services Limited</Text>
          <Text style={styles.footerSubtext}>© {currentYear} All rights reserved</Text>
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
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    opacity: 0.98,
    textAlign: 'center',
    alignSelf: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    marginBottom: SPACING.xs,
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.white,
    opacity: 0.9,
  },
  headerEmail: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.white,
    opacity: 0.8,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 0,
  },
  sectionHeader: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.textLight,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
    marginHorizontal: SPACING.md,
    letterSpacing: 1,
  },
  section: {
    backgroundColor: COLORS.card,
    marginHorizontal: SPACING.md,
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
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  iconContainer: {
    marginRight: SPACING.md,
  },
  iconGradient: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  logoutButton: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.xl,
    marginBottom: SPACING.lg,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#FF4757',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  logoutGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  logoutText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  footerText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  footerSubtext: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
  // Admin Management Hub styles
  managementGrid: {
    padding: SPACING.md,
    gap: SPACING.md,
  },
  managementRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  managementCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  managementCardGradient: {
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    gap: SPACING.xs,
  },
  managementCardTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    textAlign: 'center',
  },
  managementCardSubtitle: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.white,
    opacity: 0.9,
    textAlign: 'center',
  },
  managementCardFull: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  managementCardFullGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.md,
  },
  managementCardFullContent: {
    flex: 1,
  },
});
