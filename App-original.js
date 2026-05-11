import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';

import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { AppointmentProvider } from './context/AppointmentContext';
import { NurseProvider } from './context/NurseContext';
import { ServicesProvider } from './context/ServicesContext';
import { ShiftProvider } from './context/ShiftContext';
import { ProfileEditProvider } from './context/ProfileEditContext';
import ErrorBoundary from './components/ErrorBoundary';
import AppOnboarding, { checkOnboardingStatusForUser } from './components/AppOnboarding';
import SplashScreen from './screens/SplashScreen';
import PublicWelcomeScreen from './screens/PublicWelcomeScreen';
import HomeScreen from './screens/HomeScreen';
import AppointmentsScreen from './screens/AppointmentsScreen';
import BookScreen from './screens/BookScreen';
import StoreComingSoonScreen from './screens/StoreComingSoonScreen';
import SettingsScreen from './screens/SettingsScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import ChangePasswordScreen from './screens/ChangePasswordScreen';
import PrivacySecurityScreen from './screens/PrivacySecurityScreen';
import NotificationSettingsScreen from './screens/NotificationSettingsScreen';
import ContactSupportScreen from './screens/ContactSupportScreen';
import HelpScreen from './screens/HelpScreen';
import AboutScreen from './screens/AboutScreen';
import UserManualScreen from './screens/UserManualScreen';
import TermsScreen from './screens/TermsScreen';
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen';
import NurseAppointmentsScreen from './screens/NurseAppointmentsScreen';
import NurseRequestShiftScreen from './screens/NurseRequestShiftScreen';
import NurseProfileScreen from './screens/NurseProfileScreen';
import AdminProfileScreen from './screens/AdminProfileScreen';
import AdminDashboardScreen from './screens/AdminDashboardScreen';
import AdminClientsScreen from './screens/AdminClientsScreen';
import AdminUserManagementScreen from './screens/AdminUserManagementScreen';
import AdminOperationsScreen from './screens/AdminOperationsScreen';
import AdminAnalyticsScreen from './screens/AdminAnalyticsScreen';
import AdminPaymentsScreen from './screens/AdminPaymentsScreen';
import AdminRecurringShiftScreen from './screens/AdminRecurringShiftScreen';
import InvoiceManagementScreen from './screens/InvoiceManagementScreen';
import InvoiceScreen from './screens/InvoiceScreen';
import PaymentWebviewScreen from './screens/PaymentWebviewScreen';
import TransactionDetailsScreen from './screens/TransactionDetailsScreen';
import PriceListScreen from './screens/PriceListScreen';
import InventoryManagementScreen from './screens/InventoryManagementScreen';
import CareStoreScreen from './screens/876NursesStoreScreen';
import PatientStoreOrdersScreen from './screens/PatientStoreOrdersScreen';
import AdminStoreOrdersScreen from './screens/AdminStoreOrdersScreen';
import RecentTransactionsScreen from './screens/RecentTransactionsScreen';
import PaymentAnalyticsScreen from './screens/PaymentAnalyticsScreen';
import PaymentSettingsScreen from './screens/PaymentSettingsScreen';
import AdminManagementHubScreen from './screens/AdminManagementHubScreen';
import TestPayslipScreen from './screens/TestPayslipScreen';

import { COLORS, GRADIENTS } from './constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const linking = {
  prefixes: ['nurses876://'],
  config: {
    screens: {
      InvoiceDisplay: 'invoice/:invoiceId',
      InvoiceManagement: 'invoice-management/:invoiceId?',
    },
  },
};

const BookTabBarButton = ({
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
}) => (
  <TouchableOpacity
    style={{
      top: -20,
      justifyContent: 'center',
      alignItems: 'center',
    }}
    onPress={onPress}
    onLongPress={onLongPress}
    accessibilityLabel={accessibilityLabel}
    testID={testID}
    activeOpacity={0.85}
  >
    <LinearGradient
      colors={GRADIENTS.header}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        width: 60,
        height: 60,
        borderRadius: 30,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
      }}
    >
      <MaterialCommunityIcons name="calendar-plus" size={30} color={COLORS.white} />
    </LinearGradient>
  </TouchableOpacity>
);

function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainApp">
        {() => (
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                let iconName;

                if (route.name === 'Home') {
                  iconName = focused ? 'home' : 'home-outline';
                } else if (route.name === 'Appointments') {
                  iconName = focused ? 'calendar-clock' : 'calendar-clock';
                } else if (route.name === 'Book') {
                  iconName = focused ? 'calendar-check' : 'calendar-check-outline';
                } else if (route.name === 'Store') {
                  iconName = focused ? 'storefront' : 'storefront-outline';
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'cog' : 'cog-outline';
                }

                return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: COLORS.primary,
              tabBarInactiveTintColor: COLORS.textMuted,
              tabBarStyle: {
                backgroundColor: COLORS.white,
                borderTopWidth: 0,
                elevation: 20,
                shadowColor: COLORS.text,
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                height: 62 + insets.bottom,
                paddingBottom: Math.max(insets.bottom, 8),
                paddingTop: 8,
                position: 'relative',
                zIndex: 10,
              },
              tabBarLabelStyle: {
                fontFamily: 'Poppins_600SemiBold',
                fontSize: 12,
              },
              headerShown: false,
            })}
          >
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Appointments" component={AppointmentsScreen} />
            <Tab.Screen
              name="Book"
              component={BookScreen}
              options={{
                tabBarButton: (props) => <BookTabBarButton {...props} />,
                tabBarLabel: () => null,
                tabBarIcon: () => null,
              }}
            />
            <Tab.Screen name="Store" component={StoreComingSoonScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="CareStore" component={CareStoreScreen} />
      <Stack.Screen name="PatientStoreOrders" component={PatientStoreOrdersScreen} />
      <Stack.Screen name="InvoiceDisplay" component={InvoiceScreen} />
      <Stack.Screen name="PaymentWebview" component={PaymentWebviewScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="ContactSupport" component={ContactSupportScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="UserManual" component={UserManualScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
    </Stack.Navigator>
  );
}

function NurseNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="NurseApp">
        {() => (
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                let iconName;

                if (route.name === 'Appointments') {
                  iconName = focused ? 'calendar-clock' : 'calendar-clock';
                } else if (route.name === 'RequestShift') {
                  iconName = focused ? 'calendar-plus' : 'calendar-plus';
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'cog' : 'cog-outline';
                }

                return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
              },
              tabBarActiveTintColor: COLORS.primary,
              tabBarInactiveTintColor: COLORS.textMuted,
              tabBarStyle: {
                backgroundColor: COLORS.white,
                borderTopWidth: 0,
                elevation: 20,
                shadowColor: COLORS.text,
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                height: 62 + insets.bottom,
                paddingBottom: Math.max(insets.bottom, 20),
                paddingTop: 20,
                position: 'relative',
                zIndex: 10,
              },
              tabBarLabelStyle: {
                fontFamily: 'Poppins_600SemiBold',
                fontSize: 12,
              },
              headerShown: false,
            })}
          >
            <Tab.Screen name="Appointments" component={NurseAppointmentsScreen} />
            <Tab.Screen 
              name="RequestShift" 
              component={NurseRequestShiftScreen}
              options={{
                tabBarButton: (props) => (
                  <CustomTabBarButton {...props}>
                    <MaterialCommunityIcons name="calendar-plus" size={30} color={COLORS.white} />
                  </CustomTabBarButton>
                ),
                tabBarLabel: () => null,
              }}
            />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Profile" component={NurseProfileScreen} />
      <Stack.Screen name="PaymentWebview" component={PaymentWebviewScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="ContactSupport" component={ContactSupportScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="UserManual" component={UserManualScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
    </Stack.Navigator>
  );
}

const CustomTabBarButton = ({ children, onPress }) => (
  <TouchableOpacity
    style={{
      top: -20,
      justifyContent: 'center',
      alignItems: 'center',
    }}
    onPress={onPress}
  >
    <LinearGradient
      colors={GRADIENTS.header}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
      }}
    >
      {children}
    </LinearGradient>
  </TouchableOpacity>
);

function AdminDashboardNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminApp">
        {() => (
          <Tab.Navigator
            screenOptions={({ route }) => ({
              tabBarIcon: ({ focused, color, size }) => {
                let iconName;

                if (route.name === 'Dashboard') {
                  iconName = focused ? 'view-dashboard' : 'view-dashboard-outline';
                } else if (route.name === 'Users') {
                  iconName = focused ? 'account-group' : 'account-group-outline';
                } else if (route.name === 'Operations') {
                  iconName = focused ? 'cog-box' : 'cog-box';
                } else if (route.name === 'Settings') {
                  iconName = focused ? 'cog' : 'cog-outline';
                }

                return <MaterialCommunityIcons name={iconName} size={24} color={color} />;
              },
              tabBarActiveTintColor: COLORS.primary,
              tabBarInactiveTintColor: COLORS.textMuted,
              tabBarStyle: {
                backgroundColor: COLORS.white,
                borderTopWidth: 0,
                elevation: 20,
                shadowColor: COLORS.text,
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                height: 62 + insets.bottom,
                paddingBottom: Math.max(insets.bottom, 8),
                paddingTop: 8,
                position: 'relative',
                zIndex: 10,
              },
              tabBarLabelStyle: {
                fontFamily: 'Poppins_600SemiBold',
                fontSize: 12,
              },
              headerShown: false,
            })}
          >
            <Tab.Screen name="Dashboard" component={AdminDashboardScreen} />
            <Tab.Screen name="Users" component={AdminUserManagementScreen} />
            <Tab.Screen 
              name="Recurring" 
              component={AdminRecurringShiftScreen}
              options={{
                tabBarButton: (props) => (
                  <CustomTabBarButton {...props}>
                    <MaterialCommunityIcons name="calendar-sync" size={30} color={COLORS.white} />
                  </CustomTabBarButton>
                ),
                tabBarLabel: () => null,
              }}
            />
            <Tab.Screen name="Operations" component={AdminOperationsScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        )}
      </Stack.Screen>
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="InvoiceManagement" component={InvoiceManagementScreen} />
      <Stack.Screen name="InvoiceDisplay" component={InvoiceScreen} />
      <Stack.Screen name="PaymentWebview" component={PaymentWebviewScreen} />
      <Stack.Screen name="PriceList" component={PriceListScreen} />
      <Stack.Screen name="InventoryManagement" component={InventoryManagementScreen} />
      <Stack.Screen name="CareStore" component={CareStoreScreen} />
      <Stack.Screen name="AdminStoreOrders" component={AdminStoreOrdersScreen} />
      <Stack.Screen name="RecentTransactions" component={RecentTransactionsScreen} />
      <Stack.Screen name="PaymentAnalytics" component={PaymentAnalyticsScreen} />
      <Stack.Screen name="PaymentSettings" component={PaymentSettingsScreen} />
      <Stack.Screen name="AdminManagementHub" component={AdminManagementHubScreen} />
      <Stack.Screen name="AdminPaymentsScreen" component={AdminPaymentsScreen} />
      <Stack.Screen name="TestPayslip" component={TestPayslipScreen} />
      <Stack.Screen name="AdminAnalyticsScreen" component={AdminAnalyticsScreen} />
      <Stack.Screen name="TransactionDetailsScreen" component={TransactionDetailsScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="PrivacySecurity" component={PrivacySecurityScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="ContactSupport" component={ContactSupportScreen} />
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="UserManual" component={UserManualScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
    </Stack.Navigator>
  );
}

function PublicNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PublicWelcome" component={PublicWelcomeScreen} />
      <Stack.Screen name="PublicAuth">
        {() => <SplashScreen onFinish={() => {}} />}
      </Stack.Screen>
      <Stack.Screen name="Help" component={HelpScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="UserManual" component={UserManualScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyPolicyScreen} />
      <Stack.Screen name="ContactSupport" component={ContactSupportScreen} />
    </Stack.Navigator>
  );
}

function AppNavigator() {
  const { user, isLoading } = useAuth();
  const [showSplash, setShowSplash] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const previousUserRef = useRef(user);

  useEffect(() => {
    // Check if we should show splash screen on app load or after logout
    const checkSplashState = async () => {
      try {
        const shouldShowSplash = await AsyncStorage.getItem('shouldShowSplash');
        if (shouldShowSplash === 'true') {
          setShowSplash(true);
          // Clear the flag after reading
          await AsyncStorage.removeItem('shouldShowSplash');
        } else {
          setShowSplash(false);
        }
      } catch (error) {
        console.log('Error checking splash state:', error);
      }
    };

    checkSplashState();
  }, [user]);

  useEffect(() => {
    // Detect logout and show splash screen
    const previousUser = previousUserRef.current;
    if (previousUser && !user && !isLoading) {
      // Logged-out users now fall back to the public access flow.
      setShowSplash(false);
    }
    previousUserRef.current = user;
  }, [user, isLoading]);

  // Check onboarding status when user logs in
  useEffect(() => {
    const checkOnboarding = async () => {
      if (user && !isLoading && !showSplash) {
        const completed = await checkOnboardingStatusForUser(user?.id);
        if (!completed) {
          // Show onboarding immediately after authentication.
          setShowOnboarding(true);
        }
      }
    };
    
    checkOnboarding();
  }, [user, isLoading, showSplash]);

  if (showSplash) {
    const handleSplashFinish = () => {
      if (user) {
        setShowSplash(false);
      }
    };
    return (
      <SplashScreen
        onFinish={handleSplashFinish}
        onContinueAsGuest={() => setShowSplash(false)}
      />
    );
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Check user role for navigation
  const isAdmin = user?.role === 'admin' || user?.role === 'admins' || user?.role === 'superAdmin';
  const isNurse = user?.role === 'nurse' || user?.role === 'nurses';

  return (
    <>
      <AppOnboarding 
        visible={showOnboarding} 
        onComplete={() => setShowOnboarding(false)} 
        userRole={user?.role}
        userId={user?.id}
      />
      <NavigationContainer linking={linking}>
        {user ? (
          isAdmin ? <AdminDashboardNavigator /> : 
          isNurse ? <NurseNavigator /> : 
          <MainTabs />
        ) : <PublicNavigator />}
      </NavigationContainer>
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const [fontStartupTimedOut, setFontStartupTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      setFontStartupTimedOut(false);
      return;
    }

    const timeout = setTimeout(() => {
      setFontStartupTimedOut(true);
    }, 4000);

    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError && !fontStartupTimedOut) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: COLORS.background,
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 16, color: COLORS.textLight, fontSize: 15 }}>Loading app...</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <ServicesProvider>
            <NurseProvider>
              <NotificationProvider>
                <ShiftProvider>
                  <ProfileEditProvider>
                    <AppointmentProvider>
                        <StatusBar style="light" />
                        <AppNavigator />
                    </AppointmentProvider>
                  </ProfileEditProvider>
                </ShiftProvider>
              </NotificationProvider>
            </NurseProvider>
          </ServicesProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
