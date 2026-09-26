import TouchableWeb from "../components/TouchableWeb";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, GRADIENTS, SPACING } from '../constants';

// Import the existing screens as components
import AdminClientsScreen from './AdminClientsScreen';
import AdminAnalyticsScreen from './AdminAnalyticsScreen';

export default function AdminUserManagementScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState('clients');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const addStaffFunctionRef = useRef(null);
  const searchInputRef = useRef(null);
  const handleCloseSearch = () => {
    setShowSearch(false);
    setSearchQuery('');
  };

  // Get client and staff counts (you can enhance this with real data)
  const [clientCount, setClientCount] = useState(0);
  const [staffCount, setStaffCount] = useState(0);

  // Function to handle setting the add staff function
  const handleSetAddStaffFunction = useCallback((addFunction) => {
    addStaffFunctionRef.current = addFunction;
  }, []);

  const handleStaffDebugUpdate = useCallback((info) => {
    setDebugInfo(info || null);
  }, []);

  useEffect(() => {
    if (!showSearch) return;
    const t = setTimeout(() => {
      if (searchInputRef?.current?.focus) {
        searchInputRef.current.focus();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [showSearch]);

  // Filter Pills Component
  const FilterPills = () => (
    <View style={styles.filterContainer}>
      <TouchableWeb 
        style={[styles.filterPill, activeFilter === 'clients' && styles.activeFilter]}
        onPress={() => setActiveFilter('clients')}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons 
          name="account-group" 
          size={16} 
          color={activeFilter === 'clients' ? COLORS.primary : COLORS.white} 
        />
        <Text style={[
          styles.filterText, 
          activeFilter === 'clients' && styles.activeFilterText
        ]}>
          Clients
        </Text>
        {clientCount > 0 && (
          <View style={[styles.badge, activeFilter === 'clients' && styles.activeBadge]}>
            <Text style={[
              styles.badgeText, 
              activeFilter === 'clients' && styles.activeBadgeText
            ]}>
              {clientCount}
            </Text>
          </View>
        )}
      </TouchableWeb>
      
      <TouchableWeb 
        style={[styles.filterPill, activeFilter === 'staff' && styles.activeFilter]}
        onPress={() => setActiveFilter('staff')}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons 
          name="account-tie" 
          size={16} 
          color={activeFilter === 'staff' ? COLORS.primary : COLORS.white} 
        />
        <Text style={[
          styles.filterText, 
          activeFilter === 'staff' && styles.activeFilterText
        ]}>
          Staff
        </Text>
        {staffCount > 0 && (
          <View style={[styles.badge, activeFilter === 'staff' && styles.activeBadge]}>
            <Text style={[
              styles.badgeText, 
              activeFilter === 'staff' && styles.activeBadgeText
            ]}>
              {staffCount}
            </Text>
          </View>
        )}
      </TouchableWeb>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Watermark Logo */}
      <Image
        source={require('../assets/Images/Nurses-logo.png')}
        style={styles.watermarkLogo}
        resizeMode="contain"
      />
      
      {/* Header */}
      <LinearGradient
        colors={GRADIENTS.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.headerRow}>
          <TouchableWeb
            style={styles.actionButton}
            onPress={() => setShowSearch((prev) => !prev)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="magnify" size={24} color={COLORS.white} />
          </TouchableWeb>

          <Text style={styles.welcomeText}>User Management</Text>
          {/* Add action button based on active filter */}
          {activeFilter === 'staff' ? (
            <TouchableWeb
              style={styles.actionButton}
              onPress={() => {
                if (addStaffFunctionRef.current) {
                  addStaffFunctionRef.current();
                }
              }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus" size={24} color={COLORS.white} />
            </TouchableWeb>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {/* Header Search (toggled) */}
        {showSearch && (
          <View style={styles.searchRow}>
            <TextInput
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={activeFilter === 'staff' ? 'Search staff...' : 'Search clients...'}
              placeholderTextColor="rgba(255,255,255,0.75)"
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <TouchableWeb
              style={styles.searchCloseButton}
              onPress={handleCloseSearch}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="close" size={20} color={COLORS.white} />
            </TouchableWeb>
          </View>
        )}

        {activeFilter === 'staff' && debugInfo && (
          <View style={styles.debugCard}>
            <Text style={styles.debugTitle}>Staff Debug</Text>
            <Text style={styles.debugText}>Loaded admins: {debugInfo.adminCount ?? 0}</Text>
            <Text style={styles.debugText}>Admin codes: {debugInfo.adminCodes?.join(', ') || 'none'}</Text>
            <Text style={styles.debugText}>Visible staff rows: {debugInfo.visibleCount ?? 0}</Text>
            <Text style={styles.debugText}>Filter: {debugInfo.selectedCard || 'all'}</Text>
          </View>
        )}
        
        {/* Filter Pills */}
        <FilterPills />
      </LinearGradient>

      {/* Content - Render the appropriate screen based on active filter */}
      <View style={styles.contentContainer}>
        {activeFilter === 'clients' ? (
          <AdminClientsScreen 
            navigation={navigation} 
            route={route}
            isEmbedded={true}
            searchQuery={searchQuery}
          />
        ) : (
          <AdminAnalyticsScreen 
            navigation={navigation} 
            route={route}
            isEmbedded={true}
            onAddPress={handleSetAddStaffFunction}
            onDebugUpdate={handleStaffDebugUpdate}
            searchQuery={searchQuery}
          />
        )}
      </View>
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
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  welcomeText: {
    fontSize: 20,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
    textAlign: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 25,
    padding: 4,
    marginHorizontal: SPACING.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    marginHorizontal: SPACING.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
    paddingVertical: 0,
  },
  searchCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  debugCard: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: 'rgba(139,0,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(139,0,0,0.25)',
  },
  debugTitle: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  debugText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: COLORS.text,
    lineHeight: 18,
  },
  filterPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
    borderRadius: 20,
    gap: 6,
  },
  activeFilter: {
    backgroundColor: COLORS.white,
  },
  filterText: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: COLORS.white,
  },
  activeFilterText: {
    color: COLORS.primary,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  activeBadge: {
    backgroundColor: COLORS.primary,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
    color: COLORS.white,
  },
  activeBadgeText: {
    color: COLORS.white,
  },
  contentContainer: {
    flex: 1,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});