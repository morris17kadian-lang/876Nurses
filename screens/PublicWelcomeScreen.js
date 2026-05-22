import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import TouchableWeb from '../components/TouchableWeb';
import { COLORS, COMPANY_INFO, CONTACT_INFO, GRADIENTS, SERVICES, SPACING } from '../constants';

const FEATURED_SERVICE_COUNT = 6;

export default function PublicWelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  const featuredServices = useMemo(() => {
    const services = Array.isArray(SERVICES) ? SERVICES : [];
    return services.slice(0, FEATURED_SERVICE_COUNT);
  }, []);

  const handleDial = (phoneNumber) => {
    const digits = String(phoneNumber || '').replace(/[^\d+]/g, '');
    if (digits) {
      Linking.openURL(`tel:${digits}`);
    }
  };

  const handleEmail = () => {
    Linking.openURL(`mailto:${CONTACT_INFO.email}`);
  };

  const QuickAction = ({ icon, title, subtitle, onPress }) => (
    <TouchableWeb style={styles.actionCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.actionIconWrap}>
        <MaterialCommunityIcons name={icon} size={20} color={COLORS.primary} />
      </View>
      <View style={styles.actionTextWrap}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textMuted} />
    </TouchableWeb>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={GRADIENTS.header} style={styles.heroCard}>
          <Text style={styles.eyebrow}>PUBLIC ACCESS</Text>
          <Text style={styles.heroTitle}>{COMPANY_INFO.displayName}</Text>
          <Text style={styles.heroSubtitle}>{COMPANY_INFO.tagline}</Text>
          <Text style={styles.heroBody}>
            Browse services, contact the care team, and review help and legal information without creating an account.
          </Text>

          <View style={styles.heroButtonsRow}>
            <TouchableWeb
              style={styles.primaryButton}
              onPress={() => navigation.navigate('PublicAuth')}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryButtonText}>Sign In or Register</Text>
            </TouchableWeb>
            <TouchableWeb
              style={styles.secondaryButton}
              onPress={() => handleDial(CONTACT_INFO.phone)}
              activeOpacity={0.9}
            >
              <Text style={styles.secondaryButtonText}>Call Us</Text>
            </TouchableWeb>
          </View>

          <TouchableWeb onPress={() => {}} activeOpacity={0.7} style={styles.guestLinkWrap}>
            <Text style={styles.guestLinkText}>Continue as guest</Text>
          </TouchableWeb>
        </LinearGradient>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Featured Services</Text>
          <Text style={styles.sectionSubtitle}>
            Account creation is only required when you need patient-specific booking, appointments, or profile features.
          </Text>
          <View style={styles.serviceGrid}>
            {featuredServices.map((service, index) => (
              <View key={`${service?.id || service?.title || index}`} style={styles.serviceCard}>
                <Text style={styles.serviceTitle}>{service?.title || 'Service'}</Text>
                <Text style={styles.serviceMeta}>
                  {service?.duration ? `${service.duration} hrs` : 'Custom duration'}
                </Text>
                <Text style={styles.servicePrice}>
                  {service?.price ? `JMD ${service.price}` : 'Price on request'}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Access</Text>
          <QuickAction
            icon="file-document-outline"
            title="Privacy Policy"
            subtitle="Review how patient and service data is handled"
            onPress={() => navigation.navigate('Privacy')}
          />
          <QuickAction
            icon="shield-account-outline"
            title="Terms of Service"
            subtitle="See service terms before creating an account"
            onPress={() => navigation.navigate('Terms')}
          />
          <QuickAction
            icon="help-circle-outline"
            title="Help & FAQ"
            subtitle="General information for new and existing clients"
            onPress={() => navigation.navigate('Help')}
          />
          <QuickAction
            icon="information-outline"
            title="About 876Nurses"
            subtitle="Company information and support details"
            onPress={() => navigation.navigate('About')}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <View style={styles.contactCard}>
            <Text style={styles.contactLabel}>Main line</Text>
            <TouchableWeb onPress={() => handleDial(CONTACT_INFO.phone)}>
              <Text style={styles.contactValue}>{CONTACT_INFO.phone}</Text>
            </TouchableWeb>
            <Text style={styles.contactLabel}>Email</Text>
            <TouchableWeb onPress={handleEmail}>
              <Text style={styles.contactValue}>{CONTACT_INFO.email}</Text>
            </TouchableWeb>
            <Text style={styles.contactLabel}>Address</Text>
            <Text style={styles.contactAddress}>{CONTACT_INFO.address}</Text>
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
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.lg,
  },
  heroCard: {
    borderRadius: 28,
    padding: SPACING.lg,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 6,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: {
    color: COLORS.white,
    fontSize: 30,
    fontFamily: 'Poppins_700Bold',
  },
  heroSubtitle: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    marginTop: 6,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 14,
    fontFamily: 'Poppins_400Regular',
  },
  heroButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    flexWrap: 'wrap',
  },
  primaryButton: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: COLORS.primaryDark,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  guestLinkWrap: {
    alignItems: 'center',
    marginTop: 14,
  },
  guestLinkText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    textDecorationLine: 'underline',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
  },
  sectionSubtitle: {
    color: COLORS.textLight,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Poppins_400Regular',
  },
  serviceGrid: {
    gap: 12,
  },
  serviceCard: {
    backgroundColor: '#F7FBFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D9ECFF',
    padding: 16,
  },
  serviceTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
  },
  serviceMeta: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 6,
    fontFamily: 'Poppins_400Regular',
  },
  servicePrice: {
    color: COLORS.primaryDark,
    fontSize: 14,
    marginTop: 8,
    fontFamily: 'Poppins_700Bold',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EAF4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
  },
  actionSubtitle: {
    color: COLORS.textLight,
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'Poppins_400Regular',
  },
  contactCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  contactLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    marginTop: 8,
  },
  contactValue: {
    color: COLORS.primaryDark,
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    marginTop: 4,
  },
  contactAddress: {
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 4,
    fontFamily: 'Poppins_400Regular',
  },
});