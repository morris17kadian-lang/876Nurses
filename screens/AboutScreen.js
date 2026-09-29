import TouchableWeb from "../components/TouchableWeb";
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  Image,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, GRADIENTS, SPACING, CONTACT_INFO, COMPANY_INFO } from '../constants';
import Constants from 'expo-constants';

export default function AboutScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version || '1.0.3';
  const currentYear = new Date().getFullYear();

  const [expandedSections, setExpandedSections] = useState({
    mission: true,
  });

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const ContactItem = ({ icon, title, value, onPress }) => (
    <TouchableWeb style={styles.contactItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.contactIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={COLORS.primary} />
      </View>
      <View style={styles.contactContent}>
        <Text style={styles.contactTitle}>{title}</Text>
        <Text style={styles.contactValue}>{value}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textLight} />
    </TouchableWeb>
  );

  const AccordionSection = ({ sectionKey, title, children }) => {
    const isExpanded = !!expandedSections[sectionKey];
    return (
      <View style={styles.section}>
        <TouchableWeb
          style={styles.accordionHeader}
          onPress={() => toggleSection(sectionKey)}
          activeOpacity={0.8}
        >
          <Text style={styles.accordionTitle}>{title}</Text>
          <MaterialCommunityIcons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textLight}
          />
        </TouchableWeb>
        {isExpanded ? <View style={styles.accordionBody}>{children}</View> : null}
      </View>
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

  const FeatureCard = ({ emoji, title, description }) => (
    <View style={styles.featureCard}>
      <View style={styles.featureEmojiContainer}>
        <Text style={styles.featureEmoji}>{emoji}</Text>
      </View>
      <View style={styles.featureTextContainer}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
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
          <TouchableWeb onPress={() => navigation.goBack()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={26} color={COLORS.white} />
          </TouchableWeb>
          <Text style={styles.headerTitle}>About {COMPANY_INFO.displayName}</Text>
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo Section */}
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <Image 
              source={require('../assets/Images/Nurses-logo.png')} 
              style={styles.ceoImage}
              resizeMode="cover"
            />
          </View>
          <Text style={styles.appName}>{COMPANY_INFO.legalName}</Text>
          <Text style={styles.tagline}>
            {COMPANY_INFO.tagline}
          </Text>
        </View>

        <SectionDivider />

        <AccordionSection sectionKey="mission" title="Our Mission">
          <View style={styles.missionCard}>
            <Text style={styles.missionText}>
              At 876 Nurses Home Care Services Limited, we are committed to bringing you premium healthcare services
              to Jamaicans islandwide.{"\n\n"}
              We serve:{"\n"}
              • Elderly Jamaicans{"\n"}
              • Those within our disabled communities{"\n"}
              • And post-operative patients{"\n\n"}
              In need of assistance with the activities of daily living.
            </Text>
          </View>
        </AccordionSection>

        <SectionDivider />

        <AccordionSection
          sectionKey="whyChoose"
          title={`Why Choose ${COMPANY_INFO.displayName}`}
        >
          <View style={styles.whyChooseContainer}>
            <FeatureCard
              emoji="✅"
              title="Licensed & Certified"
              description="All nurses are fully licensed by the Nursing Council of Jamaica"
            />
            <FeatureCard
              emoji="⏰"
              title="24/7 Availability"
              description="After-hours and weekend support when needed"
            />
            <FeatureCard
              emoji="❤️"
              title="Compassionate Care"
              description="Patient-centered approach with dignity and respect"
            />
            <FeatureCard
              emoji="👥"
              title="Experienced Team"
              description="Skilled professionals with years of healthcare experience"
            />
          </View>
        </AccordionSection>

        <SectionDivider />

        <AccordionSection sectionKey="contact" title="Get in Touch">
          <View style={styles.contactCard}>
            <ContactItem
              icon="phone"
              title="Phone"
              value={CONTACT_INFO.phoneWeekday || CONTACT_INFO.phone}
              onPress={() =>
                Linking.openURL(
                  `tel:${String(CONTACT_INFO.phoneWeekday || CONTACT_INFO.phone).replace(/\D/g, '')}`
                )
              }
            />
            <View style={styles.divider} />
            <ContactItem
              icon="email"
              title="Email"
              value={CONTACT_INFO.email}
              onPress={() => Linking.openURL(`mailto:${CONTACT_INFO.email}`)}
            />
            <View style={styles.divider} />
            <ContactItem
              icon="instagram"
              title="Instagram"
              value={CONTACT_INFO.instagram}
              onPress={() => Linking.openURL(`https://instagram.com/${CONTACT_INFO.instagram.replace('@', '')}`)}
            />
            <View style={styles.divider} />
            <ContactItem
              icon="whatsapp"
              title="WhatsApp"
              value={CONTACT_INFO.whatsapp}
              onPress={() => Linking.openURL(`https://wa.me/${CONTACT_INFO.whatsapp.replace(/\D/g, '')}`)}
            />
          </View>
        </AccordionSection>

        <SectionDivider />

        <AccordionSection sectionKey="legal" title="Legal & Help">
          <TouchableWeb
            style={styles.legalButton}
            onPress={() => navigation.navigate('UserManual')}
          >
            <Text style={styles.legalButtonText}>User Manual</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textLight} />
          </TouchableWeb>
          <TouchableWeb
            style={styles.legalButton}
            onPress={() => navigation.navigate('Terms')}
          >
            <Text style={styles.legalButtonText}>Terms of Service</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textLight} />
          </TouchableWeb>
          <TouchableWeb
            style={styles.legalButton}
            onPress={() => navigation.navigate('Privacy')}
          >
            <Text style={styles.legalButtonText}>Privacy Policy</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.textLight} />
          </TouchableWeb>
        </AccordionSection>

        {/* Copyright */}
        <View style={styles.footer}>
          <Text style={styles.copyright}>
            © {currentYear} {COMPANY_INFO.legalName}. All rights reserved.
          </Text>
          <Text style={styles.version}>Version {appVersion}</Text>
          <Text style={styles.footerText}>
            Made with ❤️ in Jamaica
          </Text>
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
    justifyContent: 'space-between',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.white,
    flex: 1,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: SPACING.xl,
  },
  sectionDivider: {
    height: 2,
    marginHorizontal: SPACING.md,
    marginVertical: 2,
    borderRadius: 2,
  },
  logoSection: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  logoContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  ceoImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginTop: 10,
  },
  appName: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  version: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: SPACING.sm,
  },
  tagline: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  section: {
    padding: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: SPACING.sm,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  accordionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    flex: 1,
  },
  accordionBody: {
    marginTop: SPACING.xs,
  },
  missionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: SPACING.lg,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  missionText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 24,
  },
  whyChooseContainer: {
    gap: SPACING.sm,
  },
  featureCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.md,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureEmojiContainer: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
    flexShrink: 0,
  },
  featureTextContainer: {
    flex: 1,
  },
  featureEmoji: {
    fontSize: 18,
    lineHeight: 20,
    textAlign: 'center',
  },
  featureTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    lineHeight: 20,
  },
  contactCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.md,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactContent: {
    flex: 1,
  },
  contactTitle: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  contactValue: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.md,
  },
  legalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  legalButtonText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.text,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  copyright: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
    marginBottom: SPACING.xs,
  },
  footerText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.textLight,
  },
});
